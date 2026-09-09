import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdir, readFile, readdir, realpath, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { fixture } from './helpers.mjs';
import { configLocation, readConfigFile, saveConfigFile, serializeConfig } from '../src/config-file.mjs';
import { runSetup } from '../src/setup.mjs';

const values = { CLOUDBASE_ENV_ID: 'path-test', CLOUDBASE_REGION: 'ap-shanghai', CLOUDBASE_API_KEY: 'offline-only' };
async function paths(t) {
  const root = await realpath((await fixture(t)).directory);
  const outside = join(root, 'outside'), physical = join(root, 'physical');
  await mkdir(outside, { mode: 0o700 });
  await mkdir(physical, { mode: 0o700 });
  await mkdir(join(physical, 'nested'), { mode: 0o700 });
  await symlink(join(physical, 'nested'), join(outside, 'link'), 'dir');
  return { root, outside, physical, supplied: outside + '/link/../credentials.env' };
}

test('Windows parent-segment guard rejects both separators before reads, writes or setup checks', async (t) => {
  const root = await realpath((await fixture(t)).directory);
  const target = join(root, 'credentials.env');
  const original = serializeConfig(values);
  await writeFile(target, original, { mode: 0o600 });
  const platform = Object.getOwnPropertyDescriptor(process, 'platform');
  // Exercise the input guard locally too; native Windows path behavior is covered by CI.
  Object.defineProperty(process, 'platform', { ...platform, value: 'win32' });
  try {
    for (const file of [root + '/missing/../credentials.env', root + '\\missing\\..\\credentials.env']) {
      await assert.rejects(readConfigFile(file), { code: 'INVALID_CONFIG_PATH' });
      await assert.rejects(saveConfigFile(file, values, null), { code: 'INVALID_CONFIG_PATH' });
      await assert.rejects(runSetup({ envFile: file }, {
        ask: async () => assert.fail('must reject before prompting'),
        verify: async () => assert.fail('must reject before cloud access'),
      }), { code: 'INVALID_CONFIG_PATH' });
    }
  } finally { Object.defineProperty(process, 'platform', platform); }
  assert.equal(await readFile(target, 'utf8'), original);
  assert.deepEqual((await readdir(root)).sort(), ['credentials.env', '报告.html'].sort());
});

test('parent traversal resolves on POSIX or rejects on Windows without modifying the neighbour', async (t) => {
  const { outside, physical, supplied } = await paths(t);
  const target = join(physical, 'credentials.env'), neighbour = join(outside, 'credentials.env');
  await writeFile(target, serializeConfig(values), { mode: 0o600 });
  const other = serializeConfig({ ...values, CLOUDBASE_ENV_ID: 'unrelated-env' });
  await writeFile(neighbour, other, { mode: 0o600 });
  if (process.platform === 'win32') {
    await assert.rejects(configLocation(supplied), { code: 'INVALID_CONFIG_PATH' });
    await assert.rejects(readConfigFile(supplied), { code: 'INVALID_CONFIG_PATH' });
    await assert.rejects(saveConfigFile(supplied, values, null), { code: 'INVALID_CONFIG_PATH' });
    await assert.rejects(runSetup({ envFile: supplied }, {
      ask: async () => assert.fail('must reject before prompting'),
      verify: async () => assert.fail('must reject before cloud access'),
    }), { code: 'INVALID_CONFIG_PATH' });
    assert.equal(await readFile(target, 'utf8'), serializeConfig(values));
    assert.equal(await readFile(neighbour, 'utf8'), other);
    return;
  }
  assert.equal(await configLocation(supplied), await realpath(supplied));
  const before = await readConfigFile(supplied);
  assert.equal(before.values.CLOUDBASE_ENV_ID, 'path-test');
  let checked = false;
  const result = await runSetup({ envFile: supplied }, {
    ask: async (_, options) => options.defaultValue,
    verify: async (config) => { checked = true; assert.equal(config.envId, 'path-test'); return {}; },
  });
  assert.equal(checked, true);
  assert.equal(result.envFile, target);
  const updated = { ...values, CLOUDBASE_API_KEY: 'replacement-offline-only' };
  assert.equal(await saveConfigFile(supplied, updated, before), target);
  assert.equal((await readConfigFile(target)).values.CLOUDBASE_API_KEY, updated.CLOUDBASE_API_KEY);
  assert.equal(await readFile(neighbour, 'utf8'), other);
});

for (const kind of ['directory', 'worktree']) {
  test(`physical Git ${kind} is rejected through symlink/.. by read, save, wizard and production launcher`, async (t) => {
    const { outside, physical, supplied } = await paths(t);
    if (kind === 'directory') await mkdir(join(physical, '.git'));
    else await writeFile(join(physical, '.git'), 'gitdir: elsewhere');
    const original = serializeConfig(values);
    await writeFile(join(physical, 'credentials.env'), original, { mode: 0o600 });
    for (const file of [supplied, outside + '/link/../new/private/credentials.env']) {
      const code = process.platform === 'win32' ? 'INVALID_CONFIG_PATH' : 'CONFIG_INSIDE_REPOSITORY';
      await assert.rejects(readConfigFile(file), { code });
      await assert.rejects(saveConfigFile(file, values, null), { code });
      await assert.rejects(runSetup({ envFile: file }, {
        ask: async () => assert.fail('must reject before prompting'),
        verify: async () => assert.fail('must reject before cloud access'),
      }), { code });
    }
    const launcher = fileURLToPath(new URL('../scripts/start.mjs', import.meta.url));
    const child = spawnSync(process.execPath, [launcher, supplied], { encoding: 'utf8', timeout: 5000 });
    assert.equal(child.status, 1);
    assert.equal(child.stdout, '');
    assert.ok(!child.stderr.includes(values.CLOUDBASE_API_KEY));
    assert.equal(await readFile(join(physical, 'credentials.env'), 'utf8'), original);
    assert.deepEqual(await readdir(outside), ['link']);
    assert.deepEqual((await readdir(physical)).sort(), ['.git', 'credentials.env', 'nested']);
  });
}

test('missing child directories after symlink/.. resolve on POSIX or stay untouched on Windows', async (t) => {
  const { outside, physical } = await paths(t);
  const supplied = outside + '/link/../new/private/credentials.env';
  const target = join(physical, 'new/private/credentials.env');
  if (process.platform === 'win32') {
    await assert.rejects(configLocation(supplied), { code: 'INVALID_CONFIG_PATH' });
    await assert.rejects(readConfigFile(supplied), { code: 'INVALID_CONFIG_PATH' });
    await assert.rejects(saveConfigFile(supplied, values, null), { code: 'INVALID_CONFIG_PATH' });
    assert.deepEqual(await readdir(outside), ['link']);
    assert.deepEqual(await readdir(physical), ['nested']);
    return;
  }
  assert.equal(await configLocation(supplied), target);
  assert.equal(await readConfigFile(supplied), null);
  assert.equal(await saveConfigFile(supplied, values, null), target);
  assert.equal((await readConfigFile(supplied)).values.CLOUDBASE_ENV_ID, values.CLOUDBASE_ENV_ID);
  assert.deepEqual(await readdir(outside), ['link']);
});

test('an unresolved missing directory before .. is not silently collapsed into a different target', async (t) => {
  const { outside } = await paths(t);
  const supplied = outside + '/missing/../credentials.env';
  await assert.rejects(configLocation(supplied));
  await assert.rejects(saveConfigFile(supplied, values, null));
  assert.deepEqual(await readdir(outside), ['link']);
});

test('private directory checks apply to the physical parent, not the lexical parent', async (t) => {
  if (process.platform === 'win32') return;
  const { physical, supplied } = await paths(t);
  await writeFile(join(physical, 'credentials.env'), serializeConfig(values), { mode: 0o600 });
  await chmod(physical, 0o755);
  await assert.rejects(readConfigFile(supplied), { code: 'PRIVATE_DIRECTORY_REQUIRED' });
  await assert.rejects(saveConfigFile(supplied, values, null), { code: 'PRIVATE_DIRECTORY_REQUIRED' });
});

test('ordinary directory aliases remain usable while directory-only destinations are rejected', async (t) => {
  const { outside, physical } = await paths(t);
  const aliasFile = join(outside, 'link', 'credentials.env');
  const target = join(physical, 'nested', 'credentials.env');
  assert.equal(await saveConfigFile(aliasFile, values, null), target);
  assert.equal((await readConfigFile(aliasFile)).values.CLOUDBASE_API_KEY, values.CLOUDBASE_API_KEY);
  const dotted = outside + '/link/./new/./credentials.env';
  assert.equal(await saveConfigFile(dotted, values, null), join(physical, 'nested/new/credentials.env'));
  for (const file of [target + '/', outside + '/.', outside + '/link/..']) {
    await assert.rejects(configLocation(file), { code: 'INVALID_CONFIG_PATH' });
  }
});
