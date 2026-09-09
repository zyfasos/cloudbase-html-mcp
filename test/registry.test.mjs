import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PageRegistry } from '../src/registry.mjs';
import { Publisher, sha256 } from '../src/publisher.mjs';
import { PublishError, readConfig } from '../src/cloudbase.mjs';
import { FakeCloud, fixture, html, scope } from './helpers.mjs';

test('registration survives a new publisher and resolves current cloud hash, never a stale local hash', async (t) => {
  const { registryDir, localPath } = await fixture(t);
  const cloud = new FakeCloud();
  const first = await new Publisher(cloud, cloud.fetch, new PageRegistry(registryDir, scope)).publish({ localPath });
  assert.equal(first.registry.state, 'SAVED');
  const registry = new PageRegistry(registryDir, scope);
  const second = new Publisher(cloud, cloud.fetch, registry);
  const changed = Buffer.from('<html>new cloud content</html>');
  await cloud.put(`sites/${first.siteId}/index.html`, changed, sha256(changed));
  await unlink(localPath);
  const found = await second.get({ localPath });
  assert.equal(found.siteId, first.siteId);
  assert.equal(found.sha256, sha256(changed));
  assert.equal((await registry.lookup(localPath)).sha256, first.sha256);
  const recordFile = registry.file;
  assert.equal((await stat(recordFile)).mode & 0o777, 0o600);
  assert.deepEqual((await readdir(registryDir)).filter((x) => !x.endsWith('.json')), []);
});

test('registered path rejects implicit duplicate creation and only newPage explicitly changes its ID', async (t) => {
  const { registryDir, localPath } = await fixture(t);
  const cloud = new FakeCloud();
  const registry = new PageRegistry(registryDir, scope);
  const publisher = new Publisher(cloud, cloud.fetch, registry);
  const first = await publisher.publish({ localPath });
  await assert.rejects(publisher.publish({ localPath }), { code: 'LOCAL_SITE_EXISTS' });
  assert.equal(cloud.puts.length, 1);
  const second = await publisher.publish({ localPath, newPage: true });
  assert.notEqual(second.siteId, first.siteId);
  assert.equal((await publisher.get({ localPath })).siteId, second.siteId);
  assert.ok(cloud.objects.has(`sites/${first.siteId}/index.html`));
  await assert.rejects(publisher.publish({ localPath, siteId: first.siteId, expectedSha256: first.sha256 }), { code: 'LOCAL_BINDING_CONFLICT' });
  assert.equal(cloud.puts.length, 2);
});

test('same path in another environment or region has an independent registration', async (t) => {
  const { registryDir, localPath } = await fixture(t);
  const registry = new PageRegistry(registryDir, scope);
  const cloud = new FakeCloud();
  const first = await new Publisher(cloud, cloud.fetch, registry).publish({ localPath });
  for (const otherScope of [{ ...scope, envId: 'other-env' }, { ...scope, region: 'ap-beijing' }]) {
    assert.equal(await new PageRegistry(registryDir, otherScope).lookup(localPath), null);
  }
  assert.equal((await registry.lookup(localPath)).siteId, first.siteId);
});

test('corrupt or scope-mismatched registration is not overwritten and causes no cloud writes', async (t) => {
  const { registryDir, localPath } = await fixture(t);
  await mkdir(registryDir);
  const registry = new PageRegistry(registryDir, scope);
  const file = registry.entry(localPath).file;
  const cloud = new FakeCloud();
  const publisher = new Publisher(cloud, cloud.fetch, registry);
  for (const content of ['invalid JSON', JSON.stringify({ version: 1, ...scope, envId: 'other-env', localPath, siteId: `s-${'a'.repeat(32)}`, sha256: 'a'.repeat(64), state: 'PENDING' })]) {
    await writeFile(file, content);
    await assert.rejects(publisher.publish({ localPath }), { code: 'REGISTRY_CORRUPT' });
    assert.equal(await readFile(file, 'utf8'), content);
  }
  assert.equal(cloud.puts.length, 0);
  assert.equal((await readdir(registryDir)).some((x) => x.endsWith('.lock')), false);
});

test('environment lock excludes another registry instance even for a different path', async (t) => {
  const { registryDir, localPath } = await fixture(t);
  const one = new PageRegistry(registryDir, scope);
  const two = new PageRegistry(registryDir, scope);
  const lock = await one.acquire(localPath);
  await assert.rejects(two.acquire(localPath), { code: 'REGISTRY_BUSY' });
  await assert.rejects(two.acquire(`${localPath}.other`), { code: 'REGISTRY_BUSY' });
  await lock.release();
  const retried = await two.acquire(localPath);
  await retried.release();
});

test('registry directory inside a Git repository or an unwritable target blocks before cloud writes', async (t) => {
  const { directory, localPath } = await fixture(t);
  await mkdir(join(directory, '.git'));
  const cloud = new FakeCloud();
  const inside = new Publisher(cloud, cloud.fetch, new PageRegistry(join(directory, 'pages'), scope));
  await assert.rejects(inside.publish({ localPath }), { code: 'REGISTRY_INSIDE_REPOSITORY' });
  assert.equal(cloud.puts.length, 0);
  const other = await fixture(t);
  await writeFile(other.registryDir, 'not a directory');
  const broken = new Publisher(cloud, cloud.fetch, new PageRegistry(other.registryDir, scope));
  await assert.rejects(broken.publish({ localPath: other.localPath }), { code: 'REGISTRY_WRITE_FAILED' });
  assert.equal(cloud.puts.length, 0);
});

test('partial cloud failure retains reserved site ID across a fresh registry', async (t) => {
  const { registryDir, localPath } = await fixture(t);
  const cloud = new FakeCloud(); cloud.failAt = 'COS_CURRENT_PUT';
  const publisher = new Publisher(cloud, cloud.fetch, new PageRegistry(registryDir, scope));
  let failedId;
  await assert.rejects(publisher.publish({ localPath }), (e) => {
    failedId = e.details.siteId;
    assert.equal(e.details.writeState, 'CURRENT_WRITE_ATTEMPTED');
    return true;
  });
  const record = await new PageRegistry(registryDir, scope).lookup(localPath);
  assert.equal(record.siteId, failedId);
  assert.equal(record.state, 'UNCERTAIN');
  await assert.rejects(publisher.get({ localPath }), (e) => e.code === 'SITE_NOT_FOUND' && e.details.siteId === failedId);
});

test('registry finalization failure preserves published result and the earlier pending record', async (t) => {
  const { registryDir, localPath } = await fixture(t);
  class FailingFinalize extends PageRegistry {
    async save(entry, data) {
      if (data.state === 'STORAGE_VERIFIED') throw new Error('disk full');
      return super.save(entry, data);
    }
  }
  const cloud = new FakeCloud();
  const publisher = new Publisher(cloud, cloud.fetch, new FailingFinalize(registryDir, scope));
  const result = await publisher.publish({ localPath });
  assert.equal(result.status, 'PUBLISHED');
  assert.equal(result.writeState, 'STORAGE_VERIFIED');
  assert.equal(result.registry.state, 'UPDATE_FAILED');
  assert.equal(result.registry.warnings.length, 1);
  assert.equal((await publisher.get({ localPath })).sha256, result.sha256);
});

test('page selectors, explicit creation flags and disabled registry return actionable errors', async (t) => {
  const { localPath } = await fixture(t);
  const cloud = new FakeCloud();
  const publisher = new Publisher(cloud, cloud.fetch);
  await assert.rejects(publisher.get({}), { code: 'ONE_PAGE_SELECTOR_REQUIRED' });
  await assert.rejects(publisher.get({ localPath, siteId: `s-${'a'.repeat(32)}` }), { code: 'ONE_PAGE_SELECTOR_REQUIRED' });
  await assert.rejects(publisher.get({ localPath }), { code: 'REGISTRY_DISABLED' });
  await assert.rejects(publisher.publish({ localPath, newPage: true, siteId: `s-${'a'.repeat(32)}` }), { code: 'NEW_PAGE_WITH_SITE_ID' });
  await assert.rejects(publisher.publish({ localPath, expectedSha256: 'a'.repeat(64) }), { code: 'EXPECTED_HASH_WITHOUT_SITE_ID' });
  const config = readConfig({ CLOUDBASE_ENV_ID: scope.envId, CLOUDBASE_REGION: scope.region, CLOUDBASE_API_KEY: 'test', CLOUDBASE_REGISTRY_DIR: 'off' });
  assert.equal(config.registryDir, null);
  assert.equal(cloud.puts.length, 0);
});

test('reservation failure blocks upload and releases the lock for a corrected retry', async (t) => {
  const { registryDir, localPath } = await fixture(t);
  class NoReservation extends PageRegistry {
    async save() { throw new PublishError('REGISTRY', 'REGISTRY_WRITE_FAILED'); }
  }
  const cloud = new FakeCloud();
  await assert.rejects(new Publisher(cloud, cloud.fetch, new NoReservation(registryDir, scope)).publish({ localPath }), { code: 'REGISTRY_WRITE_FAILED' });
  assert.equal(cloud.puts.length, 0);
  const retried = await new Publisher(cloud, cloud.fetch, new PageRegistry(registryDir, scope)).publish({ localPath });
  assert.equal(retried.status, 'PUBLISHED');
});

for (const stage of ['COS_CURRENT_PUT']) {
  test(`failed newPage at ${stage} preserves the active binding and pending ID after restart`, async (t) => {
    const { registryDir, localPath } = await fixture(t);
    const cloud = new FakeCloud();
    const publisher = new Publisher(cloud, cloud.fetch, new PageRegistry(registryDir, scope));
    const first = await publisher.publish({ localPath });
    cloud.failAt = stage;
    let attemptedId;
    await assert.rejects(publisher.publish({ localPath, newPage: true }), (e) => {
      attemptedId = e.details.siteId;
      return e.stage === stage;
    });
    const registry = new PageRegistry(registryDir, scope);
    const record = await registry.lookup(localPath);
    assert.equal(record.siteId, first.siteId);
    assert.equal(record.state, 'STORAGE_VERIFIED');
    assert.equal(record.pending.siteId, attemptedId);
    assert.equal(record.pending.state, 'UNCERTAIN');
    const restarted = new Publisher(cloud, cloud.fetch, registry);
    const found = await restarted.get({ localPath });
    assert.equal(found.siteId, first.siteId);
    assert.equal(found.publicCheck.verified, true);
    assert.equal(found.pendingRegistration.siteId, attemptedId);
    cloud.failAt = undefined;
    await restarted.publish({ localPath, siteId: first.siteId, expectedSha256: first.sha256 });
    assert.equal((await registry.lookup(localPath)).pending.siteId, attemptedId);
  });
}

test('an uncertain new page that exists can be verified and promoted without losing the prior binding early', async (t) => {
  const { registryDir, localPath } = await fixture(t);
  class UncertainCloud extends FakeCloud {
    async put(...args) {
      await super.put(...args);
      if (this.timeout && args[3] === 'COS_CURRENT_PUT') throw new PublishError('COS_CURRENT_PUT', 'ETIMEDOUT');
    }
  }
  const cloud = new UncertainCloud();
  const registry = new PageRegistry(registryDir, scope);
  const publisher = new Publisher(cloud, cloud.fetch, registry);
  const first = await publisher.publish({ localPath });
  cloud.timeout = true;
  await assert.rejects(publisher.publish({ localPath, newPage: true }), { code: 'ETIMEDOUT' });
  const restarted = new Publisher(cloud, cloud.fetch, new PageRegistry(registryDir, scope));
  const active = await restarted.get({ localPath });
  assert.equal(active.siteId, first.siteId);
  const pending = await restarted.get(active.pendingRegistration.siteId);
  assert.equal(pending.publicCheck.verified, true);
  cloud.timeout = false;
  const promoted = await restarted.publish({ localPath, siteId: pending.siteId, expectedSha256: pending.sha256 });
  assert.equal(promoted.status, 'PUBLISHED');
  assert.equal((await restarted.get({ localPath })).siteId, pending.siteId);
  assert.equal((await registry.lookup(localPath)).pending, undefined);
});

test('failed registration promotion keeps both the old binding and the successfully published new ID', async (t) => {
  const { registryDir, localPath } = await fixture(t);
  class FailingPromotion extends PageRegistry {
    async save(entry, data) {
      if (this.fail && data.state === 'STORAGE_VERIFIED') throw new PublishError('REGISTRY', 'REGISTRY_WRITE_FAILED');
      return super.save(entry, data);
    }
  }
  const cloud = new FakeCloud();
  const registry = new FailingPromotion(registryDir, scope);
  const publisher = new Publisher(cloud, cloud.fetch, registry);
  const first = await publisher.publish({ localPath });
  registry.fail = true;
  const second = await publisher.publish({ localPath, newPage: true });
  assert.equal(second.status, 'PUBLISHED');
  assert.equal(second.registry.state, 'UPDATE_FAILED');
  const record = await new PageRegistry(registryDir, scope).lookup(localPath);
  assert.equal(record.siteId, first.siteId);
  assert.equal(record.pending.siteId, second.siteId);
  assert.equal((await publisher.get(second.siteId)).publicCheck.verified, true);
});

test('invalid v2 metadata is rejected without overwriting the catalogue', async (t) => {
  const { registryDir, localPath } = await fixture(t);
  const registry = new PageRegistry(registryDir, scope);
  const cloud = new FakeCloud();
  const publisher = new Publisher(cloud, cloud.fetch, registry);
  await publisher.publish({ localPath });
  const catalog = await registry.readCatalog();
  catalog.bindings[localPath].pendingSiteId = 's-' + 'b'.repeat(32);
  const corrupted = JSON.stringify(catalog);
  await writeFile(registry.file, corrupted);
  await assert.rejects(publisher.publish({ localPath, newPage: true }), { code: 'REGISTRY_CORRUPT' });
  assert.equal(cloud.puts.length, 1);
  assert.equal(await readFile(registry.file, 'utf8'), corrupted);
});
