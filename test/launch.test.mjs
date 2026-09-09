import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, lstat, chmod, symlink, realpath, link } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fixture } from './helpers.mjs';
import { defaultConfigPath, loadLaunchConfig, parseServeArgs } from '../src/launch.mjs';
import { serializeConfig } from '../src/config-file.mjs';
import { clientConfiguration } from '../src/setup.mjs';
import { VERSION } from '../src/version.mjs';

const values = { CLOUDBASE_ENV_ID: 'wizard-env', CLOUDBASE_REGION: 'ap-shanghai', CLOUDBASE_API_KEY: 'offline-wizard-key' };
const cli = fileURLToPath(new URL('../bin/cli.mjs', import.meta.url));
const preload = new URL('./fixtures/setup-cloud.mjs', import.meta.url).href;
async function homeFor(t) { return realpath((await fixture(t)).directory); }
async function configAt(home, text = serializeConfig(values), mode = 0o600) {
  const file = defaultConfigPath(home);
  await mkdir(join(file, '..'), { recursive: true, mode: 0o700 });
  await writeFile(file, text, { mode });
  return file;
}

test('launch options are explicit and reject mixed sources, relative paths and unsupported flags', () => {
  assert.deepEqual(parseServeArgs([]), {});
  assert.deepEqual(parseServeArgs(['--env']), { environment: true });
  for (const args of [['--config', 'relative.env'], ['--env', '--config', '/a'], ['--config'], ['--wat'], ['--env', '--env']]) assert.throws(() => parseServeArgs(args));
});

test('default file wins over inherited cloud settings, and no source is merged or falls back', async (t) => {
  const home = await homeFor(t);
  let result = await loadLaunchConfig({}, { home, env: values });
  assert.equal(result.error.code, 'CONFIG_FILE_MISSING');
  const file = await configAt(home);
  result = await loadLaunchConfig({}, { home, env: { ...values, CLOUDBASE_ENV_ID: 'wrong-env', CLOUDBASE_REGISTRY_DIR: 'off' } });
  assert.equal(result.config.envId, 'wizard-env');
  assert.ok(result.config.registryDir);
  assert.deepEqual(result.configuration, { source: 'default_file', path: file });
  result = await loadLaunchConfig({ environment: true }, { home, env: { ...values, CLOUDBASE_ENV_ID: 'env-mode' } });
  assert.equal(result.config.envId, 'env-mode');
  assert.equal(result.configuration.path, undefined);
  result = await loadLaunchConfig({ configFile: join(home, 'missing.env') }, { home, env: values });
  assert.equal(result.error.code, 'CONFIG_FILE_MISSING');
  await writeFile(file, 'CLOUDBASE_ENV_ID=wizard-env\n');
  assert.equal((await loadLaunchConfig({}, { home, env: values })).error.code, 'CONFIG_REQUIRED');
});

test('default received file permissions are tightened without rewriting contents; explicit files are not changed', { skip: process.platform === 'win32' }, async (t) => {
  if (process.platform === 'win32') return;
  const home = await homeFor(t), file = await configAt(home);
  await chmod(join(file, '..'), 0o755); await chmod(file, 0o644);
  const before = await readFile(file);
  const explicit = await loadLaunchConfig({ configFile: file });
  assert.equal(explicit.error.code, 'PRIVATE_DIRECTORY_REQUIRED');
  assert.equal((await lstat(file)).mode & 0o777, 0o644);
  const normal = await loadLaunchConfig({}, { home });
  assert.ok(normal.config);
  assert.equal((await lstat(join(file, '..'))).mode & 0o777, 0o700);
  assert.equal((await lstat(file)).mode & 0o777, 0o600);
  assert.deepEqual(await readFile(file), before);
});

test('default config refuses Git paths, linked files and redirected directories without chmod', { skip: process.platform === 'win32' }, async (t) => {
  if (process.platform === 'win32') return;
  for (const kind of ['git', 'symlink', 'hardlink', 'directory-alias']) {
    const home = await homeFor(t), file = await configAt(home);
    const target = join(home, 'target.env');
    await writeFile(target, serializeConfig(values), { mode: 0o644 });
    if (kind === 'git') await mkdir(join(home, '.git'));
    else {
      const { unlink, rm } = await import('node:fs/promises');
      await unlink(file);
      if (kind === 'symlink') await symlink(target, file);
      if (kind === 'hardlink') await link(target, file);
      if (kind === 'directory-alias') {
        await rm(join(file, '..'), { recursive: true });
        const outside = join(home, 'elsewhere'); await mkdir(outside, { mode: 0o755 });
        await writeFile(join(outside, 'credentials.env'), serializeConfig(values), { mode: 0o644 });
        await symlink(outside, join(file, '..'));
      }
    }
    const result = await loadLaunchConfig({}, { home });
    assert.ok(result.error, kind);
    assert.equal((await lstat(target)).mode & 0o777, 0o644);
  }
});

test('invalid, unreadable and incomplete configs give structured diagnostics without their secret or cloud access', async (t) => {
  const home = await homeFor(t), file = await configAt(home);
  for (const text of ['not a configuration', serializeConfig({ ...values, UNKNOWN_SECRET: 'ignored' }) + 'BAD_KEY=do-not-print\n', serializeConfig({ ...values, CLOUDBASE_REGION: 'bad/region' })]) {
    await writeFile(file, text);
    const result = await loadLaunchConfig({}, { home });
    assert.ok(result.error);
    assert.ok(!JSON.stringify(result.error).includes('do-not-print'));
    assert.ok(!JSON.stringify(result.error).includes(values.CLOUDBASE_API_KEY));
  }
  if (process.platform !== 'win32') {
    await chmod(file, 0);
    assert.ok((await loadLaunchConfig({}, { home })).error);
    await chmod(file, 0o600);
  }
});

async function session(t, home, args, connected) {
  const client = new Client({ name: 'launch-test', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: ['--import', preload, cli, ...args],
    cwd: home, env: { HOME: home, USERPROFILE: home, CLOUDBASE_ENV_ID: 'wrong-env', CLOUDBASE_REGION: 'bad-region', CLOUDBASE_API_KEY: 'wrong-key' }, stderr: 'pipe' });
  let diagnostics = ''; transport.stderr.on('data', (chunk) => { diagnostics += chunk; });
  try { await client.connect(transport); await connected(client); }
  catch (error) { t.diagnostic(diagnostics.replaceAll(values.CLOUDBASE_API_KEY, '[redacted]')); throw error; }
  finally { await client.close(); }
  assert.ok(!diagnostics.includes(values.CLOUDBASE_API_KEY));
}

test('production CLI initializes six tools with missing config; file placement and restart recover without wizard', async (t) => {
  const home = await homeFor(t);
  await session(t, home, [], async (client) => {
    assert.equal((await client.listTools()).tools.length, 6);
    const result = await client.callTool({ name: 'hosting_status', arguments: {} });
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.code, 'CONFIG_FILE_MISSING');
    assert.equal(result.structuredContent.configuration.path, defaultConfigPath(home));
  });
  await configAt(home);
  await session(t, home, ['serve'], async (client) => {
    const result = await client.callTool({ name: 'hosting_status', arguments: {} });
    assert.equal(result.isError, false);
    assert.equal(result.structuredContent.envId, 'wizard-env');
    assert.equal(result.structuredContent.configuration.source, 'default_file');
    assert.ok(!JSON.stringify(result).includes(values.CLOUDBASE_API_KEY));
  });
});

test('help/version and generated desktop entries avoid config reads and package cache paths', () => {
  for (const option of ['--help', '--version']) {
    const result = spawnSync(process.execPath, [cli, option], { encoding: 'utf8' });
    assert.equal(result.status, 0);
    if (option === '--version') assert.equal(result.stdout.trim(), VERSION);
  }
  for (const platform of ['darwin', 'win32']) {
    const entry = clientConfiguration(defaultConfigPath(), platform).json.mcpServers.cloudbase_html;
    assert.equal(entry.command, platform === 'win32' ? 'cmd.exe' : 'npx');
    assert.ok(entry.args.includes(`cloudbase-html-mcp@${VERSION}`));
    if (platform !== 'win32') {
      assert.equal(entry.args.at(-2), '--config');
      assert.equal(entry.args.at(-1), defaultConfigPath());
    } else assert.equal(entry.args.at(-1), 'serve');
    assert.ok(!JSON.stringify(entry).includes('scripts/start.mjs'));
  }
});

test('malformed or duplicate dotenv fields are rejected even if the required values appear present', async (t) => {
  const home = await homeFor(t), file = await configAt(home);
  for (const extra of ['unrecognized text', 'CLOUDBASE_API_KEY=duplicate', 'EXTRA="unterminated']) {
    await writeFile(file, serializeConfig(values) + extra + '\n');
    assert.equal((await loadLaunchConfig({}, { home })).error.code, 'INVALID_CONFIG_FILE');
  }
});

test('non-owner and failed chmod are rejected before file contents can be used', { skip: process.platform === 'win32' }, async (t) => {
  const home = await homeFor(t), file = await configAt(home);
  await chmod(join(file, '..'), 0o755); await chmod(file, 0o644);
  const uid = process.getuid();
  const owner = t.mock.method(process, 'getuid', () => uid + 1);
  assert.equal((await loadLaunchConfig({}, { home })).error.code, 'PRIVATE_DIRECTORY_REQUIRED');
  owner.mock.restore();
  assert.equal((await lstat(file)).mode & 0o777, 0o644);
  const { open } = await import('node:fs/promises');
  const handle = await open(file, 'r');
  const proto = Object.getPrototypeOf(handle); await handle.close();
  t.mock.method(proto, 'chmod', async () => { throw Object.assign(new Error('must-not-appear'), { code: 'EPERM' }); });
  const failure = await loadLaunchConfig({}, { home });
  assert.equal(failure.error.code, 'CONFIG_FILE_UNREADABLE');
  assert.ok(!JSON.stringify(failure.error).includes('must-not-appear'));
  assert.equal((await lstat(file)).mode & 0o777, 0o644);
});

test('Windows wizard rejects shell-interpreted custom paths and accepts ordinary spaced paths', () => {
  for (const path of ['C:\\A&B\\credentials.env', 'C:\\%SECRET%\\credentials.env', 'C:\\(group)\\credentials.env']) {
    assert.throws(() => clientConfiguration(path, 'win32'), { code: 'UNSAFE_WINDOWS_CONFIG_PATH' });
  }
  assert.equal(clientConfiguration('C:\\Users\\中文 User\\credentials.env', 'win32').json.mcpServers.cloudbase_html.args.at(-1), 'C:\\Users\\中文 User\\credentials.env');
});

test('UTF-8 BOM, CRLF, comments and quoted values remain usable for received files', async (t) => {
  const home = await homeFor(t);
  await configAt(home, '\uFEFF# 管理员配置\r\n' + serializeConfig(values).replaceAll('\n', '\r\n'));
  const result = await loadLaunchConfig({}, { home });
  assert.equal(result.config?.apiKey, values.CLOUDBASE_API_KEY, result.error?.code);
});

test('explicit directory alias reports the physical file it actually reads', { skip: process.platform === 'win32' }, async (t) => {
  const home = await homeFor(t), target = await configAt(home);
  const alias = join(home, 'alias'); await symlink(join(target, '..'), alias, 'dir');
  const result = await loadLaunchConfig({ configFile: join(alias, 'credentials.env') });
  assert.equal(result.config.envId, 'wizard-env');
  assert.equal(result.configuration.path, await realpath(target));
});
