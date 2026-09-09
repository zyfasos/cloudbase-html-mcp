import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { Publisher } from '../src/publisher.mjs';
import { PageRegistry } from '../src/registry.mjs';
import { PublishError } from '../src/errors.mjs';
import { currentKey } from '../src/cleanup.mjs';
import { FakeCloud, fixture, scope } from './helpers.mjs';

async function setup(t, Registry = PageRegistry) {
  const files = await fixture(t);
  const cloud = new FakeCloud();
  const registry = new Registry(files.registryDir, scope);
  return { ...files, cloud, registry, publisher: new Publisher(cloud, cloud.fetch, registry) };
}

test('rebound paths are not offered as selectors for the former site, whose source history remains available', async (t) => {
  const { publisher, cloud, localPath } = await setup(t);
  const first = await publisher.publish({ localPath });
  const second = await publisher.publish({ localPath, newPage: true });
  const listed = (await publisher.list({})).sites;
  const oldSite = listed.find((s) => s.siteId === first.siteId);
  const newSite = listed.find((s) => s.siteId === second.siteId);
  assert.deepEqual(oldSite.localPaths, []);
  assert.deepEqual(oldSite.sourcePaths, [localPath]);
  assert.deepEqual(newSite.localPaths, [localPath]);
  for (const site of listed) {
    for (const path of site.localPaths) assert.equal((await publisher.get({ localPath: path })).siteId, site.siteId);
  }
  await publisher.offline({ siteId: first.siteId, expectedSha256: first.sha256 });
  assert.equal(cloud.objects.has(currentKey(first.siteId)), false);
  assert.equal(cloud.objects.has(currentKey(second.siteId)), true);
});

test('existing v2 stale paths are repaired in the read view without rewriting the catalogue', async (t) => {
  const { publisher, registry, localPath } = await setup(t);
  const first = await publisher.publish({ localPath });
  const second = await publisher.publish({ localPath, newPage: true });
  const catalog = JSON.parse(await readFile(registry.file, 'utf8'));
  for (const site of Object.values(catalog.sites)) {
    site.localPaths = [localPath];
    delete site.sourcePaths;
  }
  const original = JSON.stringify(catalog);
  await writeFile(registry.file, original);
  const fresh = new PageRegistry(registry.directory, scope);
  assert.deepEqual((await fresh.lookupSite(first.siteId)).localPaths, []);
  assert.deepEqual((await fresh.lookupSite(first.siteId)).sourcePaths, [localPath]);
  assert.deepEqual((await fresh.lookupSite(second.siteId)).localPaths, [localPath]);
  assert.equal(await readFile(registry.file, 'utf8'), original);
  const lock = await fresh.acquire();
  await lock.release();
  assert.deepEqual(JSON.parse(await readFile(registry.file, 'utf8')).sites[first.siteId].localPaths, []);
});

test('failed promotion keeps active paths on the original site until the pending site is promoted', async (t) => {
  class FailPromotion extends PageRegistry {
    async save(entry, data, catalog) {
      if (this.fail && data.state === 'STORAGE_VERIFIED') throw new PublishError('REGISTRY', 'REGISTRY_WRITE_FAILED');
      return super.save(entry, data, catalog);
    }
  }
  const { publisher, registry, localPath } = await setup(t, FailPromotion);
  const first = await publisher.publish({ localPath });
  registry.fail = true;
  const pending = await publisher.publish({ localPath, newPage: true });
  assert.equal(pending.registry.state, 'UPDATE_FAILED');
  assert.deepEqual((await registry.lookupSite(first.siteId)).localPaths, [localPath]);
  assert.deepEqual((await registry.lookupSite(pending.siteId)).localPaths, []);
  assert.deepEqual((await registry.lookupSite(pending.siteId)).sourcePaths, [localPath]);
  registry.fail = false;
  await publisher.publish({ siteId: pending.siteId, localPath, expectedSha256: pending.sha256 });
  assert.deepEqual((await registry.lookupSite(first.siteId)).localPaths, []);
  assert.deepEqual((await registry.lookupSite(pending.siteId)).localPaths, [localPath]);
});

for (const [name, override] of [
  ['another resource', { UpstreamResourceName: 'other-bucket' }],
  ['disabled', { Enable: false }],
  ['authentication', { EnableAuth: true }],
]) {
  test('directory URL cannot borrow a valid index.html route when its own route uses ' + name, async (t) => {
    const { publisher, cloud, localPath } = await setup(t);
    const first = await publisher.publish({ localPath });
    const base = { Path: '/', UpstreamResourceType: 'STATIC_STORE', UpstreamResourceName: 'test-bucket' };
    cloud.store.domainDiscovery = { state: 'COMPLETE', domains: [{ Domain: 'example.com', Routes: [
      { ...base, ...override },
      { ...base, Path: '/sites/' + first.siteId + '/index.html', EnablePathTransmission: true },
    ] }] };
    const folder = first.url.replace('index.html', '') + '#section';
    const puts = cloud.puts.length;
    await assert.rejects(publisher.get({ siteUrl: folder }), { code: 'SITE_URL_UNCONFIRMED' });
    await assert.rejects(publisher.publish({ localPath, siteUrl: folder, expectedSha256: first.sha256 }), { code: 'SITE_URL_UNCONFIRMED' });
    await assert.rejects(publisher.offline({ siteUrl: folder, expectedSha256: first.sha256 }), { code: 'SITE_URL_UNCONFIRMED' });
    await assert.rejects(publisher.online({ localPath, siteUrl: folder }), { code: 'SITE_URL_UNCONFIRMED' });
    assert.equal(cloud.puts.length, puts);
    assert.equal(cloud.deletes.length, 0);
    const legacy = await publisher.get({ siteUrl: first.url + 'index.html' });
    assert.equal(legacy.siteId, first.siteId);
    assert.equal(legacy.publicCheck.reason, 'NO_ACCESS_CANDIDATE');
  });
}

test('a directory alias also requires the canonical current-object route to remain valid', async (t) => {
  const { publisher, cloud, localPath } = await setup(t);
  const first = await publisher.publish({ localPath });
  const base = { Path: '/', UpstreamResourceType: 'STATIC_STORE', UpstreamResourceName: 'test-bucket' };
  cloud.store.domainDiscovery = { state: 'COMPLETE', domains: [{ Domain: 'example.com', Routes: [
    base, { ...base, Path: '/sites/' + first.siteId + '/index.html', Enable: false },
  ] }] };
  await assert.rejects(publisher.get({ siteUrl: first.url.replace('index.html', '') }), { code: 'SITE_URL_UNCONFIRMED' });
  cloud.store.domainDiscovery.domains[0].Routes.pop();
  assert.equal((await publisher.get({ siteUrl: first.url.replace('index.html', '') + '#ok' })).siteId, first.siteId);
});

test('corrupt catalogue permits only known-target cloud queries and reports unavailable metadata without repairing disk', async (t) => {
  const { publisher, cloud, registry, localPath } = await setup(t);
  const first = await publisher.publish({ localPath });
  await writeFile(registry.file, '{broken json');
  for (const selector of [{ siteId: first.siteId }, { siteUrl: first.url }]) {
    const found = await publisher.get(selector);
    assert.equal(found.siteId, first.siteId);
    assert.equal(found.sha256, first.sha256);
    assert.equal(found.publicCheck.verified, true);
    assert.equal(found.registeredLifecycle, null);
    assert.deepEqual(found.registryDiagnostic, { state: 'UNAVAILABLE', code: 'REGISTRY_CORRUPT' });
  }
  await assert.rejects(publisher.get({ localPath }), { code: 'REGISTRY_CORRUPT' });
  await assert.rejects(publisher.list({}), { code: 'REGISTRY_CORRUPT' });
  await assert.rejects(publisher.publish({ localPath, siteId: first.siteId, expectedSha256: first.sha256 }), { code: 'REGISTRY_CORRUPT' });
  await assert.rejects(publisher.offline({ siteId: first.siteId, expectedSha256: first.sha256 }), { code: 'REGISTRY_CORRUPT' });
  await assert.rejects(publisher.online({ localPath, siteId: first.siteId }), { code: 'REGISTRY_CORRUPT' });
  assert.equal(await readFile(registry.file, 'utf8'), '{broken json');
  assert.equal(cloud.puts.length, 1);
  assert.equal(cloud.deletes.length, 0);
  cloud.objects.delete(currentKey(first.siteId));
  await assert.rejects(publisher.get({ siteId: first.siteId }), (e) => {
    assert.equal(e.code, 'SITE_NOT_FOUND');
    assert.equal(e.details.registryDiagnostic.code, 'REGISTRY_CORRUPT');
    assert.equal(e.details.lifecycle, undefined);
    return true;
  });
});

test('read failure diagnostics do not expose raw errors, and cannot bypass URL ownership or hide programming errors', async (t) => {
  class FailLookup extends PageRegistry {
    async lookupSite() {
      if (this.unexpected) throw new Error('unexpected bug');
      throw new PublishError('REGISTRY', 'REGISTRY_READ_FAILED', { privateValue: 'do-not-return' });
    }
  }
  const { publisher, registry, cloud, localPath } = await setup(t, FailLookup);
  const first = await publisher.publish({ localPath });
  const found = await publisher.get({ siteId: first.siteId });
  assert.deepEqual(found.registryDiagnostic, { state: 'UNAVAILABLE', code: 'REGISTRY_READ_FAILED' });
  assert.equal(JSON.stringify(found).includes('do-not-return'), false);
  cloud.store.domainDiscovery = { state: 'UNAVAILABLE', domains: [] };
  await assert.rejects(publisher.get({ siteUrl: first.url }), { code: 'SITE_URL_UNCONFIRMED' });
  registry.unexpected = true;
  await assert.rejects(publisher.get({ siteId: first.siteId }), /unexpected bug/);
});

test('rebinding one of several paths preserves other active selectors and moves only the selected binding', async (t) => {
  const { publisher, cloud, localPath } = await setup(t);
  const first = await publisher.publish({ localPath });
  const alias = localPath.replace('.html', '-alias.html');
  await writeFile(alias, '<!doctype html><html><body>another local source</body></html>');
  const updated = await publisher.publish({ localPath: alias, siteId: first.siteId, expectedSha256: first.sha256 });
  const second = await publisher.publish({ localPath, newPage: true });
  const listed = (await publisher.list({})).sites;
  const oldSite = listed.find((s) => s.siteId === first.siteId);
  assert.deepEqual(oldSite.localPaths, [alias]);
  assert.deepEqual(new Set(oldSite.sourcePaths), new Set([localPath, alias]));
  assert.deepEqual(listed.find((s) => s.siteId === second.siteId).localPaths, [localPath]);
  await publisher.offline({ localPath: alias, expectedSha256: updated.sha256 });
  assert.equal(cloud.objects.has(currentKey(first.siteId)), false);
  assert.equal(cloud.objects.has(currentKey(second.siteId)), true);
});

for (const otherOffline of [false, true]) {
  test(`explicit restore preserves another site's ${otherOffline ? 'offline' : 'online'} default binding and contents`, async (t) => {
    const { publisher, registry, cloud, localPath } = await setup(t);
    const a = await publisher.publish({ localPath });
    const b = await publisher.publish({ localPath, newPage: true });
    await publisher.offline({ siteId: a.siteId, expectedSha256: a.sha256 });
    if (otherOffline) await publisher.offline({ siteId: b.siteId, expectedSha256: b.sha256 });
    const before = await registry.readCatalog();
    const objectB = structuredClone(cloud.objects.get(currentKey(b.siteId)));
    const restarted = new Publisher(cloud, cloud.fetch, new PageRegistry(registry.directory, scope));
    const restored = await restarted.online({ siteUrl: a.url, localPath });
    assert.equal(restored.siteId, a.siteId);
    assert.equal(restored.url, a.url);
    assert.equal(restored.lifecycle, 'online');
    assert.deepEqual(restored.pathBinding, { localPath, defaultSiteId: b.siteId, pendingSiteId: null, matchesTarget: false });
    const after = await registry.readCatalog();
    assert.deepEqual(after.bindings, before.bindings);
    assert.deepEqual(after.sites[b.siteId], before.sites[b.siteId]);
    assert.deepEqual(after.sites[a.siteId].localPaths, []);
    assert.deepEqual(after.sites[a.siteId].sourcePaths, [localPath]);
    assert.deepEqual(cloud.objects.get(currentKey(b.siteId)), objectB);
    assert.equal((await restarted.get({ localPath })).siteId, b.siteId);
    assert.equal((await restarted.get({ siteId: a.siteId })).sha256, a.sha256);
    assert.equal(cloud.puts.every((key) => key.startsWith('sites/')), true);
  });
}

test('explicit URL updates the requested site while stale hashes and lifecycle errors keep that same target', async (t) => {
  const { recoveryFor } = await import('../src/recovery.mjs');
  const { publisher, registry, cloud, localPath } = await setup(t);
  const a = await publisher.publish({ localPath });
  const b = await publisher.publish({ localPath, newPage: true });
  const before = await registry.readCatalog();
  await writeFile(localPath, '<html>new content for A only</html>');
  const puts = cloud.puts.length;
  for (const [method, args, code] of [
    ['publish', { siteUrl: a.url, expectedSha256: '0'.repeat(64) }, 'VERSION_CONFLICT'],
    ['publish', { siteUrl: a.url }, 'EXPECTED_HASH_REQUIRED'],
    ['online', { siteUrl: a.url }, 'PAGE_NOT_OFFLINE'],
  ]) {
    await assert.rejects(publisher[method]({ ...args, localPath }), (error) => {
      assert.equal(error.code, code);
      assert.equal(error.details.siteId, a.siteId);
      assert.equal(error.details.pathBinding.defaultSiteId, b.siteId);
      assert.deepEqual(recoveryFor(error, args).next_step.suggested_args, { siteId: a.siteId });
      return true;
    });
  }
  assert.equal(cloud.puts.length, puts);
  const updated = await publisher.publish({ siteUrl: a.url, localPath, expectedSha256: a.sha256 });
  assert.equal(updated.url, a.url);
  assert.notEqual(updated.sha256, a.sha256);
  assert.equal((await publisher.get({ localPath })).sha256, b.sha256);
  const after = await registry.readCatalog();
  assert.deepEqual(after.bindings, before.bindings);
  assert.deepEqual(after.sites[b.siteId], before.sites[b.siteId]);
});

for (const failure of ['put', 'timeout', 'head', 'final-save']) {
  test(`explicit restore ${failure} failure and retry preserve the default and an unrelated pending page`, async (t) => {
    class FailSave extends PageRegistry {
      async save(entry, data, catalog) {
        if (this.fail && data.state === 'STORAGE_VERIFIED') throw new PublishError('REGISTRY', 'REGISTRY_WRITE_FAILED');
        return super.save(entry, data, catalog);
      }
    }
    const { publisher, registry, cloud, localPath } = await setup(t, FailSave);
    const a = await publisher.publish({ localPath });
    const b = await publisher.publish({ localPath, newPage: true });
    await publisher.offline({ siteId: a.siteId, expectedSha256: a.sha256 });
    cloud.failAt = 'COS_CURRENT_PUT';
    await assert.rejects(publisher.publish({ localPath, newPage: true }), { code: 'AccessDenied' });
    cloud.failAt = undefined;
    const before = await registry.readCatalog();
    const pending = before.bindings[localPath].pendingSiteId;
    const put = cloud.put.bind(cloud), head = cloud.head.bind(cloud);
    let written = false;
    cloud.put = async (...args) => {
      if (failure === 'put') throw new PublishError('COS_CURRENT_PUT', 'AccessDenied');
      await put(...args); written = true;
      if (failure === 'timeout') throw new PublishError('COS_CURRENT_PUT', 'ETIMEDOUT');
    };
    cloud.head = async (key) => {
      if (failure === 'head' && written) throw new PublishError('COS_HEAD', 'ETIMEDOUT');
      return head(key);
    };
    registry.fail = failure === 'final-save';
    if (failure === 'final-save') {
      const result = await publisher.online({ siteId: a.siteId, localPath });
      assert.equal(result.registry.state, 'UPDATE_FAILED');
      assert.equal(result.lifecycle, 'online');
      assert.equal(result.pathBinding.defaultSiteId, b.siteId);
      assert.equal(result.pathBinding.pendingSiteId, pending);
    } else {
      await assert.rejects(publisher.online({ siteId: a.siteId, localPath }), (error) => {
        assert.equal(error.details.siteId, a.siteId);
        assert.equal(error.details.pathBinding.defaultSiteId, b.siteId);
        assert.equal(error.details.pathBinding.pendingSiteId, pending);
        return true;
      });
    }
    for (const id of [b.siteId, pending]) assert.deepEqual((await registry.lookupSite(id)), before.sites[id]);
    assert.deepEqual((await registry.readCatalog()).bindings, before.bindings);
    assert.equal((await registry.lookupSite(a.siteId)).operation.action, 'online');
    cloud.put = put; cloud.head = head;
    const restarted = new Publisher(cloud, cloud.fetch, new PageRegistry(registry.directory, scope));
    const restored = await restarted.online({ siteId: a.siteId, localPath });
    assert.equal(restored.url, a.url);
    assert.equal(restored.registry.state, 'SAVED');
    assert.equal((await registry.lookupSite(a.siteId)).operation, null);
    for (const id of [b.siteId, pending]) assert.deepEqual((await registry.lookupSite(id)), before.sites[id]);
    assert.deepEqual((await registry.readCatalog()).bindings, before.bindings);
    assert.equal((await restarted.get({ localPath })).siteId, b.siteId);
  });
}
