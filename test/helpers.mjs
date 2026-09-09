import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PublishError } from '../src/cloudbase.mjs';

export const html = Buffer.from('<!doctype html><html><body>离线测试</body></html>');
export const scope = { envId: 'test-env', region: 'ap-shanghai' };
export async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'html-enhancements-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const localPath = join(directory, '报告.html');
  await writeFile(localPath, html);
  return { directory, localPath, registryDir: join(directory, 'pages') };
}
export class FakeCloud {
  config = scope;
  objects = new Map();
  puts = [];
  deletes = [];
  versioning = undefined;
  store = { baseUrl: 'https://example.com', bucket: 'test-bucket', region: scope.region };
  async connect() {
    return { ...this.store, domainDiscovery: this.store.domainDiscovery ?? { state: 'COMPLETE', domains: [
      { Domain: 'example.com', Routes: [{ Path: '/', UpstreamResourceType: 'STATIC_STORE', UpstreamResourceName: 'test-bucket' }] },
    ] } };
  }
  async assertDeletionSafe() {
    if (this.versioning) throw new PublishError('COS_VERSIONING', 'VERSIONING_UNSAFE');
    if (this.failAt === 'COS_VERSIONING') throw new PublishError('COS_VERSIONING', 'AccessDenied');
  }
  async listObjects(prefix, marker) {
    if (this.failAt === 'COS_LIST') throw new PublishError('COS_LIST', 'AccessDenied');
    const keys = [...this.objects.keys()].filter((key) => key.startsWith(prefix) && (!marker || key > marker)).sort();
    const page = keys.slice(0, this.pageSize ?? 1000);
    return { objects: page.map((key) => ({ key, bytes: this.objects.get(key).bytes, etag: this.objects.get(key).sha256 })),
      nextMarker: page.length < keys.length ? page.at(-1) : undefined };
  }
  async deleteCurrent(key) {
    if (this.failAt === 'COS_DELETE') throw new PublishError('COS_DELETE', 'AccessDenied');
    this.deletes.push(key); this.objects.delete(key);
  }
  async deleteObjects(keys) {
    if (this.failAt === 'COS_DELETE_SNAPSHOTS') throw new PublishError('COS_DELETE', 'DELETE_INCOMPLETE');
    for (const key of keys) { this.deletes.push(key); this.objects.delete(key); }
  }
  async head(key) {
    const object = this.objects.get(key);
    return object ? { bytes: object.bytes, sha256: object.sha256 } : null;
  }
  async put(key, bytes, sha256, stage) {
    this.puts.push(key);
    if (this.failAt && this.failAt === stage) throw new PublishError(stage, 'AccessDenied');
    this.objects.set(key, { bytes: bytes.length, sha256, body: bytes.toString('base64') });
  }
  fetch = async (url) => {
    const object = this.objects.get(new URL(url).pathname.slice(1));
    return object ? new Response(Buffer.from(object.body, 'base64'), { headers: { 'content-type': 'text/html' } }) : new Response('', { status: 404 });
  };
}
