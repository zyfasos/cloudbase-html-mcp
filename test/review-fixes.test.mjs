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
    assert.equal((await publisher.get({ siteUrl: first.url })).siteId, first.siteId);
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
