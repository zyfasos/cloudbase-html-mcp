// Test preload outside the tarball. No production code reads these switches.
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const { CloudBase } = await import(pathToFileURL(join(process.env.TEST_PACKAGE_ROOT, 'src/cloudbase.mjs')));
const state = join(process.env.TEST_PACKAGE_STATE, 'objects.json');
async function objects() {
  try { return JSON.parse(await readFile(state, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return {}; throw error; }
}
CloudBase.prototype.connect = async function () {
  if (this.config.envId !== 'package-env' || this.config.apiKey !== 'offline-package-key') throw new Error('wrong configuration');
  return { bucket: 'package-bucket', region: 'ap-shanghai', baseUrl: 'https://package.example', domainDiscovery: { state: 'COMPLETE', domains: [
    { Domain: 'package.example', Routes: [{ Path: '/', UpstreamResourceType: 'STATIC_STORE', UpstreamResourceName: 'package-bucket' }] },
  ] } };
};
CloudBase.prototype.head = async function (key) { const o = (await objects())[key]; return o ? { bytes: Buffer.from(o.body, 'base64').length, sha256: o.sha256 } : null; };
CloudBase.prototype.put = async function (key, body, sha256) {
  const all = await objects(); all[key] = { body: body.toString('base64'), sha256 }; await writeFile(state, JSON.stringify(all));
};
CloudBase.prototype.assertDeletionSafe = async function () {};
CloudBase.prototype.listObjects = async function () { return { objects: [] }; };
CloudBase.prototype.deleteCurrent = async function (key) { const all = await objects(); delete all[key]; await writeFile(state, JSON.stringify(all)); };
CloudBase.prototype.deleteObjects = async function () { throw new Error('no snapshots expected'); };
globalThis.fetch = async (url) => {
  const parsed = new URL(url);
  if (parsed.origin !== 'https://package.example') throw new Error('network prohibited');
  const o = (await objects())[parsed.pathname.slice(1)];
  return o ? new Response(Buffer.from(o.body, 'base64'), { headers: { 'content-type': 'text/html' } }) : new Response('', { status: 404 });
};
