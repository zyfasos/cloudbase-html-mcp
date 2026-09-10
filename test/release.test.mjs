import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { syncVersion, checkVersions, checkPackage, verifyMetadata, unpack } from '../scripts/release.mjs';
import { fixture } from './helpers.mjs';
import { root } from './npm-helper.mjs';

async function copyInputs(t) {
  const { directory } = await fixture(t);
  for (const file of ['package.json', 'npm-shrinkwrap.json', 'README.md', 'README.en.md', 'PROJECT.md', 'docs/clients.md', 'docs/getting-started.md', 'templates/mcp.macos.json', 'templates/mcp.windows.json']) {
    await mkdir(join(directory, file, '..'), { recursive: true }); await cp(join(root, file), join(directory, file));
  }
  return directory;
}

test('release version preparation synchronizes current entry points but preserves historical evidence', async (t) => {
  const directory = await copyInputs(t);
  const project = await readFile(join(directory, 'PROJECT.md'), 'utf8');
  const old = (await checkVersions(directory)).version;
  await syncVersion('8.0.0-beta.1', directory);
  assert.equal((await checkVersions(directory)).version, '8.0.0-beta.1');
  const after = await readFile(join(directory, 'PROJECT.md'), 'utf8');
  const removeCurrent = (s) => s.replace(/<!-- release:version -->[\s\S]*?<!-- \/release:version -->/, '');
  assert.equal(removeCurrent(after), removeCurrent(project));
  assert.ok(!(await readFile(join(directory, 'docs/getting-started.md'), 'utf8')).includes(`cloudbase-html-mcp@${old}`));
  assert.deepEqual(await syncVersion('8.0.0-beta.1', directory), { version: '8.0.0-beta.1', changed: [] });
});

test('release checker rejects stale snippets, divergent JSON and malformed current-version markers', async (t) => {
  for (const mutate of [
    (s) => s.replace(/cloudbase-html-mcp@\d[^"\s]+/, 'cloudbase-html-mcp@0.0.1'),
    (s) => s.replace('"command": "npx"', '"command": "wrong"'),
    (s) => s.replace('<!-- release:version -->', '<!-- missing -->'),
  ]) {
    const directory = await copyInputs(t); const path = join(directory, 'README.md');
    await writeFile(path, mutate(await readFile(path, 'utf8')));
    await assert.rejects(checkVersions(directory));
  }
});

test('version preparation rejects invalid versions and mismatched inputs before any writes', async (t) => {
  const directory = await copyInputs(t); const path = join(directory, 'package.json'); const before = await readFile(path, 'utf8');
  for (const version of ['latest', '1.0', '01.0.0', '1.0.0;echo bad', '1.0.0-beta.01']) await assert.rejects(syncVersion(version, directory));
  assert.equal(await readFile(path, 'utf8'), before);
  const template = join(directory, 'templates/mcp.macos.json'); await writeFile(template, '{}');
  await assert.rejects(syncVersion('8.0.0', directory));
  assert.equal(await readFile(path, 'utf8'), before);
});

test('release package checks block sensitive paths even when accidentally allowlisted and detect missing files', () => {
  assert.throws(() => checkPackage(new Map([['docs/implementation/private.md', Buffer.from('private')]]), { files: ['docs/'], version: '1.0.0' }), /禁止发布/);
  assert.throws(() => checkPackage(new Map([['unexpected.txt', Buffer.from('x')]]), { files: [], version: '1.0.0' }), /白名单/);
  assert.throws(() => checkPackage(new Map(), { files: [], version: '1.0.0' }), /缺失/);
  for (const file of ['.env', '.env.production', 'src/business.html', 'src/private.local.json']) {
    assert.throws(() => checkPackage(new Map([[file, Buffer.from('private')]]), { files: [file], version: '1.0.0' }), /禁止发布/);
  }
  assert.throws(() => unpack(Buffer.from('not-gzip')));
});

test('public release verification rejects wrong integrity, versions and tags; it does not assume latest follows beta', () => {
  const manifest = { version: '1.0.0-beta.1', integrity: 'sha512-example' };
  const metadata = { name: 'cloudbase-html-mcp', version: manifest.version, dist: { integrity: manifest.integrity } };
  const tags = { beta: manifest.version, latest: '0.4.0-beta.6' };
  verifyMetadata(metadata, tags, manifest, ['beta']);
  assert.throws(() => verifyMetadata(metadata, tags, manifest, ['beta', 'latest']));
  assert.throws(() => verifyMetadata({ ...metadata, version: '2.0.0' }, tags, manifest, ['beta']));
  assert.throws(() => verifyMetadata({ ...metadata, dist: { integrity: 'different' } }, tags, manifest, ['beta']));
});

test('release CLI refuses network verification without explicit network mode and exposes no publish command', () => {
  const script = fileURLToPath(new URL('../scripts/release.mjs', import.meta.url));
  for (const args of [['verify', 'missing.json'], ['verify', 'missing.json', '--network'], ['publish'], ['push']]) {
    const r = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 10000 });
    assert.equal(r.status, 1); assert.match(r.stderr, /用法/);
  }
});

test('version markers and JSON snippets work in a CRLF source checkout', async (t) => {
  const directory = await copyInputs(t);
  for (const file of ['README.md', 'README.en.md', 'PROJECT.md', 'docs/clients.md', 'docs/getting-started.md']) {
    const path = join(directory, file); await writeFile(path, (await readFile(path, 'utf8')).replace(/\r?\n/g, '\r\n'));
  }
  await checkVersions(directory);
  await syncVersion('8.0.0', directory);
  assert.equal((await checkVersions(directory)).version, '8.0.0');
});
