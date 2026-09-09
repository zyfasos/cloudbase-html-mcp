import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile, unlink, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { Publisher, sha256 } from '../src/publisher.mjs';
import { PageRegistry } from '../src/registry.mjs';
import { CloudBase, PublishError } from '../src/cloudbase.mjs';
import { parseSiteUrl } from '../src/domains.mjs';
import { currentKey, snapshotManifest } from '../src/cleanup.mjs';
import { runCleanup } from '../scripts/cleanup-snapshots.mjs';
import { FakeCloud, fixture, html, scope } from './helpers.mjs';

const id = (n) => 's-' + n.repeat(32);
async function setup(t, Cloud = FakeCloud, Registry = PageRegistry) {
  const f = await fixture(t);
  const cloud = new Cloud();
  const registry = new Registry(f.registryDir, scope);
  return { ...f, cloud, registry, publisher: new Publisher(cloud, cloud.fetch, registry) };
}
const snapshot = (siteId, hash) => 'deployments/' + siteId + '/' + hash + '/index.html';

test('new content and URL updates overwrite one object, while newPage retains the former site in the catalogue', async (t) => {
  const { publisher, cloud, localPath } = await setup(t);
  const first = await publisher.publish({ localPath });
  const changed = Buffer.from('<html>iteration two</html>');
  await writeFile(localPath, changed);
  const query = await publisher.get({ siteUrl: first.url.replace('index.html', '') + '#section' });
  const update = await publisher.publish({ localPath, siteUrl: first.url, expectedSha256: query.sha256 });
  assert.equal(update.url, first.url);
  assert.equal(cloud.objects.size, 1);
  assert.ok(cloud.puts.every((key) => key === currentKey(first.siteId)));
  const second = await publisher.publish({ localPath, newPage: true });
  const list = await publisher.list({ limit: 1 });
  assert.equal(list.total, 2);
  assert.equal(list.nextOffset, 1);
  assert.equal(list.cloudVerified, false);
  assert.equal((await publisher.list({ offset: 1 })).sites.length, 1);
  assert.equal((await publisher.get({ localPath })).siteId, second.siteId);
  assert.equal((await publisher.get({ siteId: first.siteId })).sha256, sha256(changed));
});

test('URL parsing rejects normalization tricks and all unconfirmed environment routes before writes', async (t) => {
  const { publisher, cloud, localPath } = await setup(t);
  const url = 'https://example.com/sites/' + id('a') + '/index.html';
  for (const bad of [url + '?v=1', url.replace('https:', 'http:'), url.replace('example.com', 'user@example.com'),
    url.replace('/sites/', '/x/../sites/'), url.replace('/sites/', '/%73ites/'), url.replace('/index.html', '/%2e/index.html'),
    url.replace('example.com', 'example.com\\evil'), url + '\n']) {
    assert.throws(() => parseSiteUrl(bad), { code: 'INVALID_SITE_URL' }, bad);
  }
  const validDomain = { Domain: 'example.com', Routes: [{ Path: '/', UpstreamResourceType: 'STATIC_STORE', UpstreamResourceName: 'test-bucket' }] };
  for (const discovery of [
    { state: 'UNAVAILABLE', domains: [] }, { state: 'INCOMPLETE', domains: [] },
    { state: 'COMPLETE', domains: [{ ...validDomain, Domain: 'other.example' }] },
    { state: 'COMPLETE', domains: [{ ...validDomain, Enable: false }] },
    { state: 'COMPLETE', domains: [{ ...validDomain, Routes: [{ ...validDomain.Routes[0], UpstreamResourceName: 'another-bucket' }] }] },
    { state: 'COMPLETE', domains: [{ ...validDomain, Routes: [...validDomain.Routes, { Path: '/sites', Enable: false, UpstreamResourceName: 'test-bucket', UpstreamResourceType: 'STATIC_STORE' }] }] },
  ]) {
    cloud.store.domainDiscovery = discovery;
    await assert.rejects(publisher.publish({ siteUrl: url, expectedSha256: sha256(html), localPath }), { code: 'SITE_URL_UNCONFIRMED' });
  }
  assert.equal(cloud.puts.length, 0);
});

test('an unregistered but route-confirmed URL can be updated and registered; a missing unregistered target cannot be claimed offline', async (t) => {
  const { publisher, cloud, localPath } = await setup(t);
  await cloud.put(currentKey(id('a')), html, sha256(html));
  const siteUrl = 'https://example.com/sites/' + id('a') + '/';
  await publisher.publish({ siteUrl, localPath, expectedSha256: sha256(html) });
  assert.equal((await publisher.list({})).total, 1);
  await assert.rejects(publisher.offline({ siteId: id('b'), expectedSha256: sha256(html) }), { code: 'SITE_NOT_FOUND' });
  assert.equal((await publisher.list({})).total, 1);
});

test('offline deletes only current and strict legacy snapshots across pages, then restores the same URL from specified bytes', async (t) => {
  const { publisher, cloud, localPath, registryDir } = await setup(t);
  const first = await publisher.publish({ localPath });
  cloud.pageSize = 1;
  const targets = [snapshot(first.siteId, 'a'.repeat(64)), snapshot(first.siteId, 'b'.repeat(64))];
  const preserved = [snapshot(id('f'), 'c'.repeat(64)), 'deployments/' + first.siteId + '/notes.txt', currentKey(id('f'))];
  for (const key of [...targets, ...preserved]) await cloud.put(key, html, sha256(html));
  const result = await publisher.offline({ siteUrl: first.url, expectedSha256: first.sha256 });
  assert.equal(result.lifecycle, 'offline');
  assert.equal(result.cleanup.complete, true);
  assert.equal(result.cleanup.deletedSnapshots, 2);
  assert.deepEqual([...cloud.objects.keys()].sort(), preserved.sort());
  await assert.rejects(publisher.publish({ localPath, siteId: first.siteId, expectedSha256: first.sha256 }), { code: 'PAGE_OFFLINE' });
  const fresh = new Publisher(cloud, cloud.fetch, new PageRegistry(registryDir, scope));
  assert.equal((await fresh.list({ lifecycle: 'offline' })).total, 1);
  assert.equal((await fresh.get({ localPath })).observedStorage, 'absent');
  await unlink(localPath);
  const putsBeforeMissing = cloud.puts.length;
  await assert.rejects(fresh.online({ siteId: first.siteId, localPath }), { code: 'FILE_NOT_READABLE' });
  assert.equal(cloud.puts.length, putsBeforeMissing);
  await writeFile(localPath, '<html>restored content</html>');
  const restored = await fresh.online({ siteId: first.siteId, localPath });
  assert.equal(restored.url, first.url);
  assert.notEqual(restored.sha256, first.sha256);
  assert.equal((await fresh.list({ lifecycle: 'online' })).total, 1);
  await assert.rejects(fresh.online({ siteId: first.siteId, localPath }), { code: 'PAGE_NOT_OFFLINE' });
});

test('a stale delete hash does not remove objects or poison the next legitimate operation', async (t) => {
  const { publisher, cloud, localPath, registry } = await setup(t);
  const first = await publisher.publish({ localPath });
  await assert.rejects(publisher.offline({ siteId: first.siteId, expectedSha256: 'f'.repeat(64) }), { code: 'VERSION_CONFLICT' });
  assert.equal(cloud.deletes.length, 0);
  assert.equal((await registry.lookupSite(first.siteId)).operation, null);
  assert.equal((await publisher.offline({ siteId: first.siteId, expectedSha256: first.sha256 })).cleanup.complete, true);
});

test('native versioning enabled, suspended, or denied prevents every destructive action', async (t) => {
  const { publisher, cloud, localPath } = await setup(t);
  const first = await publisher.publish({ localPath });
  for (const versioning of ['Enabled', 'Suspended']) {
    cloud.versioning = versioning;
    await assert.rejects(publisher.offline({ siteId: first.siteId, expectedSha256: first.sha256 }), { code: 'VERSIONING_UNSAFE' });
  }
  cloud.versioning = undefined;
  cloud.failAt = 'COS_VERSIONING';
  await assert.rejects(publisher.offline({ siteId: first.siteId, expectedSha256: first.sha256 }), { code: 'AccessDenied' });
  assert.equal(cloud.deletes.length, 0);
  assert.ok(cloud.objects.has(currentKey(first.siteId)));
});

test('cleanup failure persists offline with pending work; retry completes before online is permitted', async (t) => {
  const { publisher, cloud, localPath, registryDir } = await setup(t);
  const first = await publisher.publish({ localPath });
  await cloud.put(snapshot(first.siteId, 'b'.repeat(64)), html, sha256(html));
  cloud.failAt = 'COS_DELETE_SNAPSHOTS';
  await assert.rejects(publisher.offline({ siteId: first.siteId, expectedSha256: first.sha256 }), (e) => {
    assert.equal(e.details.lifecycle, 'offline');
    assert.equal(e.details.cleanup.complete, false);
    return e.code === 'DELETE_INCOMPLETE';
  });
  const fresh = new Publisher(cloud, cloud.fetch, new PageRegistry(registryDir, scope));
  await assert.rejects(fresh.online({ siteId: first.siteId, localPath }), { code: 'CLEANUP_PENDING' });
  cloud.failAt = undefined;
  assert.equal((await fresh.offline({ siteId: first.siteId, expectedSha256: first.sha256 })).cleanup.complete, true);
  assert.equal((await fresh.online({ siteId: first.siteId, localPath })).lifecycle, 'online');
});

test('delete and restore timeouts after cloud success are recoverable after a fresh publisher', async (t) => {
  class UncertainCloud extends FakeCloud {
    async deleteCurrent(key) { await super.deleteCurrent(key); if (this.timeoutDelete) throw new PublishError('COS_DELETE', 'ETIMEDOUT'); }
    async put(...args) { await super.put(...args); if (this.timeoutPut) throw new PublishError('COS_CURRENT_PUT', 'ETIMEDOUT'); }
  }
  const { publisher, cloud, localPath, registryDir } = await setup(t, UncertainCloud);
  const first = await publisher.publish({ localPath });
  cloud.timeoutDelete = true;
  await assert.rejects(publisher.offline({ siteId: first.siteId, expectedSha256: first.sha256 }), { code: 'ETIMEDOUT' });
  cloud.timeoutDelete = false;
  let fresh = new Publisher(cloud, cloud.fetch, new PageRegistry(registryDir, scope));
  await fresh.offline({ siteId: first.siteId, expectedSha256: first.sha256 });
  cloud.timeoutPut = true;
  await assert.rejects(fresh.online({ siteId: first.siteId, localPath }), { code: 'ETIMEDOUT' });
  cloud.timeoutPut = false;
  fresh = new Publisher(cloud, cloud.fetch, new PageRegistry(registryDir, scope));
  const before = cloud.puts.length;
  assert.equal((await fresh.online({ siteId: first.siteId, localPath })).url, first.url);
  assert.equal(cloud.puts.length, before);
});

test('external recreation prevents restoration and registry-disabled management has no cloud mutations', async (t) => {
  const { publisher, cloud, localPath } = await setup(t);
  const first = await publisher.publish({ localPath });
  await publisher.offline({ siteId: first.siteId, expectedSha256: first.sha256 });
  await cloud.put(currentKey(first.siteId), html, sha256(html));
  await assert.rejects(publisher.online({ siteId: first.siteId, localPath }), { code: 'VERSION_CONFLICT' });
  const disabled = new Publisher(cloud, cloud.fetch);
  await assert.rejects(disabled.list({}), { code: 'REGISTRY_DISABLED' });
  await assert.rejects(disabled.online({ siteId: first.siteId, localPath }), { code: 'REGISTRY_DISABLED' });
  await assert.rejects(disabled.offline({ siteId: first.siteId, expectedSha256: first.sha256 }), { code: 'REGISTRY_DISABLED' });
});

test('legacy migration keeps current and pending IDs, merges paths, and flags conflicting hashes without choosing a winner', async (t) => {
  const { registryDir, localPath } = await fixture(t);
  const registry = new PageRegistry(registryDir, scope);
  await mkdir(registryDir);
  const paths = [localPath, localPath + '.alias'];
  for (const [i, path] of paths.entries()) {
    await writeFile(registry.entry(path).file, JSON.stringify({ version: 1, ...scope, localPath: path, siteId: id('a'),
      sha256: (i ? 'b' : 'a').repeat(64), state: 'STORAGE_VERIFIED',
      ...(i ? {} : { pending: { siteId: id('c'), sha256: 'c'.repeat(64), state: 'UNCERTAIN' } }) }));
  }
  assert.equal((await registry.lookup(localPath)).lifecycle, null);
  const lock = await registry.acquire();
  await lock.release();
  assert.equal((await stat(registry.file)).mode & 0o777, 0o600);
  const migrated = await registry.readCatalog();
  assert.equal(migrated.sites[id('a')].sha256, null);
  assert.deepEqual(migrated.sites[id('a')].localPaths.sort(), paths.sort());
  assert.equal(migrated.bindings[localPath].pendingSiteId, id('c'));
  assert.equal(migrated.sites[id('c')].operation.action, 'publish');
  assert.ok(await readFile(registry.entry(localPath).file, 'utf8'));
});

test('cloud deletion finalization failure preserves facts and can finish by retrying', async (t) => {
  class Registry extends PageRegistry {
    async save(entry, data, catalog) {
      if (this.fail && data.action === 'offline' && data.state === 'STORAGE_VERIFIED') throw new PublishError('REGISTRY', 'REGISTRY_WRITE_FAILED');
      return super.save(entry, data, catalog);
    }
  }
  const { publisher, registry, localPath } = await setup(t, FakeCloud, Registry);
  const first = await publisher.publish({ localPath });
  registry.fail = true;
  const result = await publisher.offline({ siteId: first.siteId, expectedSha256: first.sha256 });
  assert.equal(result.cleanup.complete, true);
  assert.equal(result.registry.state, 'UPDATE_FAILED');
  assert.equal((await registry.lookupSite(first.siteId)).operation.action, 'offline');
  registry.fail = false;
  await publisher.offline({ siteId: first.siteId, expectedSha256: first.sha256 });
  assert.equal((await registry.lookupSite(first.siteId)).operation, null);
});

test('cleanup script defaults to read-only, validates manifest and deletes only unchanged listed snapshots', async (t) => {
  const { cloud, registryDir, directory } = await setup(t);
  const config = { ...scope, registryDir };
  const siteId = id('a');
  const old = snapshot(siteId, 'a'.repeat(64));
  const added = snapshot(siteId, 'b'.repeat(64));
  await cloud.put(currentKey(siteId), html, sha256(html));
  await cloud.put(old, html, sha256(html));
  const argv = ['--env-id', scope.envId, '--site-id', siteId];
  const manifest = await runCleanup(argv, config, cloud);
  assert.equal(manifest.count, 1);
  assert.equal(cloud.deletes.length, 0);
  const path = join(directory, 'manifest.json');
  await writeFile(path, JSON.stringify({ ...manifest, objects: [{ ...manifest.objects[0], key: currentKey(siteId) }] }));
  await assert.rejects(runCleanup([...argv, '--apply', '--manifest', path], config, cloud), { code: 'INVALID_CLEANUP_MANIFEST' });
  await writeFile(path, JSON.stringify(manifest));
  await cloud.put(old, Buffer.from('<html>changed snapshot</html>'), 'f'.repeat(64));
  await assert.rejects(runCleanup([...argv, '--apply', '--manifest', path], config, cloud), { code: 'CLEANUP_MANIFEST_STALE' });
  await cloud.put(old, html, sha256(html));
  await cloud.put(added, html, sha256(html));
  const applied = await runCleanup([...argv, '--apply', '--manifest', path], config, cloud);
  assert.equal(applied.complete, true);
  assert.ok(cloud.objects.has(currentKey(siteId)));
  assert.ok(cloud.objects.has(added));
  assert.equal(cloud.objects.has(old), false);
});

test('production COS adapter refuses unknown versioning and detects per-object batch failure', async () => {
  const cloud = new CloudBase(scope);
  cloud.invoke = async () => ({});
  await assert.rejects(cloud.assertDeletionSafe(), { code: 'VERSIONING_UNCONFIRMED' });
  cloud.invoke = async () => ({ VersioningConfiguration: {} });
  await cloud.assertDeletionSafe();
  for (const Status of ['Enabled', 'Suspended']) {
    cloud.invoke = async () => ({ VersioningConfiguration: { Status } });
    await assert.rejects(cloud.assertDeletionSafe(), { code: 'VERSIONING_UNSAFE' });
  }
  cloud.invoke = async () => ({ Deleted: [{ Key: 'one' }], Error: [{ Key: 'two' }] });
  await assert.rejects(cloud.deleteObjects(['one', 'two']), { code: 'DELETE_INCOMPLETE' });
  cloud.invoke = async () => ({ IsTruncated: 'true', Contents: [{ Key: 'a', Size: '1' }], NextMarker: 'a' });
  assert.equal((await cloud.listObjects('a')).nextMarker, 'a');
  await assert.rejects(cloud.listObjects('a', 'a'), { code: 'INVALID_LIST_CURSOR' });
});
