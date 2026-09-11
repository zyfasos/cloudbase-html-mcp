import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { Publisher } from '../src/publisher.mjs';
import { PageRegistry } from '../src/registry.mjs';
import { siteMetadata } from '../src/site-metadata.mjs';
import { PublishError } from '../src/errors.mjs';
import { FakeCloud, fixture, scope } from './helpers.mjs';
const html = (title, body = '') => `<html><head><title>${title}</title></head><body>${body}</body></html>`;
async function setup(t) {
  const files = await fixture(t); const cloud = new FakeCloud(); const registry = new PageRegistry(files.registryDir, scope);
  return { ...files, cloud, registry, p: new Publisher(cloud, cloud.fetch, registry) };
}

test('names and titles persist through update, unchanged publish, offline and restore without changing URL', async (t) => {
  const { p, localPath, cloud } = await setup(t); await writeFile(localPath, html('标题一', '<img src="missing.png">'));
  const a = await p.publish({ localPath, displayName: '  给领导的报告  ' });
  assert.equal(a.displayName, '给领导的报告'); assert.equal(a.htmlTitle, '标题一'); assert.equal(a.label, '给领导的报告');
  assert.equal(a.resourceDiagnostics.details[0].localCheck.state, 'MISSING'); assert.equal(a.metadataPersisted, true);
  const before = cloud.puts.length;
  const renamed = await p.publish({ localPath, siteId: a.siteId, expectedSha256: a.sha256, displayName: '正式分享' });
  assert.equal(cloud.puts.length, before); assert.equal(renamed.label, '正式分享');
  await writeFile(localPath, html('标题二'));
  const updated = await p.publish({ localPath, siteId: a.siteId, expectedSha256: a.sha256 });
  assert.equal(updated.displayName, '正式分享'); assert.equal(updated.htmlTitle, '标题二');
  const offline = await p.offline({ siteId: a.siteId, expectedSha256: updated.sha256 }); assert.equal(offline.label, '正式分享');
  assert.equal((await p.get({ siteId: a.siteId })).htmlTitle, '标题二');
  const restored = await p.online({ localPath, siteId: a.siteId }); assert.equal(restored.url, a.url); assert.equal(restored.label, '正式分享');
  await writeFile(localPath, '<html>no title</html>');
  await p.publish({ localPath, siteId: a.siteId, expectedSha256: restored.sha256 });
  assert.equal((await p.get({ siteId: a.siteId })).htmlTitle, null);
});

test('failed update keeps old confirmed metadata; same-hash retry promotes pending name even when omitted', async (t) => {
  const { p, registry, cloud, localPath } = await setup(t); await writeFile(localPath, html('Old'));
  const a = await p.publish({ localPath, displayName: 'Old name' }); await writeFile(localPath, html('New'));
  cloud.failAt = 'COS_CURRENT_PUT';
  await assert.rejects(p.publish({ localPath, siteId: a.siteId, expectedSha256: a.sha256, displayName: 'New name' }));
  const pending = await registry.lookupSite(a.siteId);
  assert.equal(pending.htmlTitle, 'Old'); assert.equal(pending.displayName, 'Old name'); assert.equal(pending.operation.metadata.htmlTitle, 'New');
  assert.equal((await p.list({ query: 'New' })).total, 0);
  const disk = await readFile(registry.file, 'utf8');
  assert.equal((await p.get({ siteId: a.siteId })).label, 'Old name'); assert.equal(await readFile(registry.file, 'utf8'), disk);
  cloud.failAt = null;
  const fresh = new Publisher(cloud, cloud.fetch, new PageRegistry(registry.directory, scope));
  const result = await fresh.publish({ localPath, siteId: a.siteId, expectedSha256: a.sha256 });
  assert.equal(result.htmlTitle, 'New'); assert.equal(result.label, 'New name');
});

test('final registry failure reports cloud metadata without claiming it persisted; retry recovers operation metadata', async (t) => {
  const { p, registry, localPath, cloud } = await setup(t); await writeFile(localPath, html('Old'));
  const a = await p.publish({ localPath, displayName: 'Old name' }); await writeFile(localPath, html('New'));
  const original = registry.save.bind(registry);
  const mock = t.mock.method(registry, 'save', async (entry, data, catalog) => { if (data.state === 'STORAGE_VERIFIED') throw new PublishError('REGISTRY', 'REGISTRY_WRITE_FAILED'); return original(entry, data, catalog); });
  const r = await p.publish({ localPath, siteId: a.siteId, expectedSha256: a.sha256, displayName: 'New name' });
  assert.equal(r.registry.state, 'UPDATE_FAILED'); assert.equal(r.metadataPersisted, false); assert.equal(r.label, 'New name');
  const record = await registry.lookupSite(a.siteId); assert.equal(record.label, undefined); assert.equal(record.htmlTitle, 'Old'); assert.equal(record.operation.metadata.displayName, 'New name');
  mock.mock.restore();
  const fresh = new Publisher(cloud, cloud.fetch, new PageRegistry(registry.directory, scope));
  const recovered = await fresh.publish({ localPath, siteId: a.siteId, expectedSha256: r.sha256 });
  assert.equal(recovered.label, 'New name'); assert.equal(recovered.metadataPersisted, true);
});

test('shared path operations on A preserve B names, title, content and binding', async (t) => {
  const { p, localPath } = await setup(t); await writeFile(localPath, html('V1'));
  const a = await p.publish({ localPath, displayName: 'A report' });
  const b = await p.publish({ localPath, newPage: true, displayName: 'B report' });
  const before = (await p.list({ query: 'B' })).sites[0];
  await writeFile(localPath, html('V2'));
  const update = await p.publish({ localPath, siteId: a.siteId, expectedSha256: a.sha256 });
  assert.equal(update.label, 'A report');
  await p.offline({ siteId: a.siteId, expectedSha256: update.sha256 }); await p.online({ localPath, siteId: a.siteId });
  assert.deepEqual((await p.list({ query: 'B' })).sites[0], before);
  assert.equal((await p.get({ localPath })).siteId, b.siteId);
  assert.equal((await p.get({ siteId: a.siteId })).htmlTitle, 'V2');
});

test('search normalizes Unicode, uses AND across fields, filters before paging and never reads source HTML or writes catalogue', async (t) => {
  const { p, localPath, registry, directory, cloud } = await setup(t);
  await writeFile(localPath, html('经营报告'));
  const a = await p.publish({ localPath, displayName: 'ＡＢＣ 领导' });
  const b = await p.publish({ localPath, newPage: true, displayName: 'ABC 同事' });
  const c = await p.publish({ localPath, newPage: true, displayName: 'ABC 同事' });
  await p.offline({ siteId: b.siteId, expectedSha256: b.sha256 });
  const before = await readFile(registry.file, 'utf8');
  t.mock.method(cloud, 'connect', () => { throw new Error('no network'); });
  await writeFile(localPath, 'unreadable as html');
  assert.equal((await p.list({ query: 'abc 经营 领导' })).sites[0].siteId, a.siteId);
  assert.equal((await p.list({ query: basename(localPath) })).total, 3);
  const listed = await p.list({ query: 'abc', lifecycle: 'online', limit: 1 }); assert.equal(listed.total, 2); assert.equal(listed.nextOffset, 1);
  assert.equal((await p.list({ query: 'abc', lifecycle: 'online', offset: 1, limit: 1 })).nextOffset, null);
  assert.equal((await p.list({ query: '   ' })).total, 3);
  assert.equal((await p.list({ query: directory })).total, 0);
  assert.equal((await p.list({ query: '同事' })).total, 2);
  assert.equal(await readFile(registry.file, 'utf8'), before);
});

test('metadata input limits count Unicode code points and fail before cloud writes', async (t) => {
  const { p, localPath, cloud } = await setup(t);
  for (const displayName of ['', ' ', 'a\n', '\u0000x', 'a'.repeat(121), null]) await assert.rejects(p.publish({ localPath, displayName }), { code: 'INVALID_DISPLAY_NAME' });
  assert.equal(cloud.puts.length, 0);
  const r = await p.publish({ localPath, displayName: '😀'.repeat(120) }); assert.equal([...r.displayName].length, 120);
  await assert.rejects(p.list({ query: '😀'.repeat(201) }), { code: 'INVALID_LIST_OPTIONS' });
  assert.equal((await p.list({ query: '😀'.repeat(200) })).total, 0);
});

test('old v2 metadata defaults and label fallback are deterministic and query does not backfill files', async (t) => {
  const { p, registry, localPath } = await setup(t); const a = await p.publish({ localPath });
  const catalog = JSON.parse(await readFile(registry.file, 'utf8')); delete catalog.sites[a.siteId].displayName; delete catalog.sites[a.siteId].htmlTitle;
  await writeFile(registry.file, JSON.stringify(catalog)); const before = await readFile(registry.file, 'utf8');
  assert.equal((await p.list({})).sites[0].label, basename(localPath)); assert.equal((await p.get({ siteId: a.siteId })).htmlTitle, null);
  assert.equal(await readFile(registry.file, 'utf8'), before);
  assert.equal(siteMetadata({ siteId: 'id', localPaths: ['/x/z.html', '/x/a.html'], sourcePaths: ['/x/0.html'] }).label, 'a.html');
  assert.equal(siteMetadata({ siteId: 'id', sourcePaths: ['/x/z.html', '/x/a.html'] }).label, 'a.html');
  assert.equal(siteMetadata({ siteId: 'id' }).label, 'id');
});

test('registry-disabled publishing returns per-call metadata without pretending it is queryable later', async (t) => {
  const { cloud, localPath } = await setup(t); const p = new Publisher(cloud, cloud.fetch, null); await writeFile(localPath, html('Title'));
  const r = await p.publish({ localPath, displayName: 'Name' }); assert.equal(r.label, 'Name'); assert.equal(r.metadataPersisted, false);
  assert.equal((await p.get({ siteId: r.siteId })).label, r.siteId);
});

test('legacy v1 migration preserves pending identities and supplies labels without reading or writing HTML', async (t) => {
  const { mkdir } = await import('node:fs/promises');
  const { localPath, registry, p } = await setup(t); await mkdir(registry.directory, { recursive: true });
  const first = 's-' + '1'.repeat(32), pending = 's-' + '2'.repeat(32);
  const entry = registry.entry(localPath);
  await writeFile(entry.file, JSON.stringify({ version: 1, ...scope, localPath, siteId: first, sha256: 'a'.repeat(64), state: 'STORAGE_VERIFIED', pending: { siteId: pending, sha256: 'b'.repeat(64), state: 'PENDING' } }));
  const result = await p.list({ query: basename(localPath) }); assert.equal(result.total, 2);
  assert.ok(result.sites.every((s) => s.label === basename(localPath) && s.htmlTitle === null));
  await assert.rejects(readFile(registry.file), { code: 'ENOENT' });
  const lock = await registry.acquire(); await lock.release();
  assert.equal((await registry.lookup(localPath)).pending.siteId, pending);
  assert.ok((await readFile(entry.file, 'utf8')).includes(first));
});

test('failed restore keeps confirmed metadata until retry; invalid optional metadata is detected', async (t) => {
  const { p, registry, localPath, cloud } = await setup(t); await writeFile(localPath, html('Old'));
  const a = await p.publish({ localPath, displayName: 'Name' }); await p.offline({ siteId: a.siteId, expectedSha256: a.sha256 });
  await writeFile(localPath, html('Restored')); cloud.failAt = 'COS_CURRENT_PUT';
  await assert.rejects(p.online({ localPath, siteId: a.siteId, displayName: 'Restore name' }));
  assert.equal((await p.get({ siteId: a.siteId })).label, 'Name');
  cloud.failAt = null; const restored = await p.online({ localPath, siteId: a.siteId });
  assert.equal(restored.label, 'Restore name'); assert.equal(restored.htmlTitle, 'Restored');
  const record = JSON.parse(await readFile(registry.file, 'utf8')); record.sites[a.siteId].displayName = 42;
  await writeFile(registry.file, JSON.stringify(record));
  await assert.rejects(p.list({}), { code: 'REGISTRY_CORRUPT' });
});
