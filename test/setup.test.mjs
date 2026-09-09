import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, lstat, mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { PassThrough, Writable } from 'node:stream';
import { spawnSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fixture } from './helpers.mjs';
import { configLocation, readConfigFile, saveConfigFile, serializeConfig } from '../src/config-file.mjs';
import { clientConfiguration, connectionOptions, parseSetupArgs, runSetup, setupFailure, terminalPrompt } from '../src/setup.mjs';
import { PublishError } from '../src/errors.mjs';
import { recoveryFor } from '../src/recovery.mjs';

const key = 'offline-wizard-key';
const values = { CLOUDBASE_ENV_ID: 'wizard-env', CLOUDBASE_REGION: 'ap-shanghai', CLOUDBASE_API_KEY: key };
const preset = { envId: 'wizard-env', region: 'ap-shanghai' };
const script = fileURLToPath(new URL('../scripts/setup.mjs', import.meta.url));
const preload = fileURLToPath(new URL('./fixtures/setup-cloud.mjs', import.meta.url));
function interaction(answers, verify = async () => ({ domainDiscovery: 'COMPLETE' })) {
  const prompts = [], output = [], checked = [];
  return { prompts, output, checked, ask: async (label, options = {}) => {
    prompts.push({ label, secret: options.secret });
    assert.ok(answers.length, `unexpected prompt: ${label}`);
    return answers.shift() || options.defaultValue || '';
  }, report: (message) => output.push(message), verify: async (config) => { checked.push(config); return verify(config); } };
}
async function pathFor(t) { return join((await fixture(t)).directory, 'private setup', 'credentials.env'); }

test('prefilled setup needs only hidden key and confirmation, saves private config and secret-free launch entries', async (t) => {
  const envFile = await pathFor(t);
  const io = interaction([key, 'y']);
  const result = await runSetup({ ...preset, envFile }, io);
  assert.equal(io.prompts.length, 2);
  assert.equal(io.prompts[0].secret, true);
  assert.equal(io.checked[0].apiKey, key);
  assert.deepEqual(parseEnv(await readFile(envFile, 'utf8')), Object.assign(Object.create(null), values));
  if (process.platform !== 'win32') {
    assert.equal((await lstat(envFile)).mode & 0o777, 0o600);
    assert.equal((await lstat(join(envFile, '..'))).mode & 0o777, 0o700);
  }
  assert.ok(!JSON.stringify({ result, output: io.output, prompts: io.prompts }).includes(key));
  assert.equal(result.json.mcpServers.cloudbase_html.args[1], result.envFile);
  assert.ok(result.toml.includes('offline_html'));
});

test('empty start collects environment and region without guessing and can import administrator connection JSON', async (t) => {
  const envFile = await pathFor(t);
  const io = interaction(['wizard-env', 'ap-shanghai', key, 'yes']);
  await runSetup({ envFile }, io);
  assert.equal(io.prompts.length, 4);
  const connection = join((await fixture(t)).directory, 'connection.json');
  await writeFile(connection, JSON.stringify(preset));
  assert.deepEqual(await connectionOptions({ connection }), preset);
  const target = await pathFor(t);
  const imported = interaction([key, 'y']);
  await runSetup({ connection, envFile: target }, imported);
  assert.equal(imported.prompts.length, 2);
});

test('existing config is reused byte-for-byte without requesting key or discarding optional settings', async (t) => {
  const envFile = await pathFor(t);
  await saveConfigFile(envFile, { ...values, CLOUDBASE_REGISTRY_DIR: 'off', CLOUDBASE_PUBLIC_BASE_URL: 'https://example.com' }, null);
  const original = await readFile(envFile, 'utf8');
  const modified = (await lstat(envFile)).mtimeMs;
  const io = interaction(['', '']);
  await runSetup({ ...preset, envFile }, io);
  assert.equal(await readFile(envFile, 'utf8'), original);
  assert.equal((await lstat(envFile)).mtimeMs, modified);
  assert.equal(io.checked[0].registryDir, null);
  assert.equal(io.checked[0].publicBaseUrl, 'https://example.com');
  assert.ok(io.prompts.every((p) => !p.secret));
});

test('explicit edit completes empty files, rotates keys and preserves optional values', async (t) => {
  const envFile = await pathFor(t);
  await saveConfigFile(envFile, {}, null);
  await runSetup({ ...preset, envFile }, interaction(['edit', key, 'y']));
  let before = await readConfigFile(envFile);
  await saveConfigFile(envFile, { ...before.values, CLOUDBASE_REGISTRY_DIR: 'off' }, before);
  await runSetup({ ...preset, envFile }, interaction(['edit', 'replacement', 'y']));
  before = await readConfigFile(envFile);
  assert.equal(before.values.CLOUDBASE_API_KEY, 'replacement');
  assert.equal(before.values.CLOUDBASE_REGISTRY_DIR, 'off');
  await runSetup({ ...preset, envFile }, interaction(['edit', '', 'y']));
  assert.equal((await readConfigFile(envFile)).values.CLOUDBASE_API_KEY, 'replacement');
});

test('cancelled setup and invalid input do not check cloud or write credentials', async (t) => {
  const envFile = await pathFor(t);
  for (const answers of [[key, 'n'], ['', 'y']]) {
    const io = interaction(answers);
    await assert.rejects(runSetup({ ...preset, envFile }, io));
    assert.equal(io.checked.length, 0);
    assert.equal(await readConfigFile(envFile), null);
  }
  const io = interaction([]);
  await assert.rejects(runSetup({ envFile, ...preset, envId: '../wrong' }, io), { code: 'INVALID_ENV_OR_REGION' });
  assert.equal(io.prompts.length, 0);
});

test('failed credential/hosting checks preserve old file, while new failures leave no credential or lock', async (t) => {
  for (const stage of ['CREDENTIAL_EXCHANGE', 'STATIC_STORE']) {
    const envFile = await pathFor(t);
    const fail = async () => { throw new PublishError(stage, 'HTTP_403'); };
    await assert.rejects(runSetup({ ...preset, envFile }, interaction([key, 'y'], fail)));
    assert.equal(await readConfigFile(envFile), null);
    await saveConfigFile(envFile, values, null);
    const before = await readFile(envFile, 'utf8');
    await assert.rejects(runSetup({ ...preset, envFile }, interaction(['edit', 'new-key', 'y'], fail)));
    assert.equal(await readFile(envFile, 'utf8'), before);
    assert.deepEqual(await readdir(join(envFile, '..')), ['credentials.env']);
  }
});

test('conflicting prefills cannot silently switch an existing environment', async (t) => {
  const envFile = await pathFor(t);
  await saveConfigFile(envFile, values, null);
  const io = interaction(['reuse']);
  await assert.rejects(runSetup({ ...preset, envId: 'other-env', envFile }, io), { code: 'EXISTING_CONFIG_CONFLICT' });
  assert.equal(io.checked.length, 0);
  assert.equal((await readConfigFile(envFile)).values.CLOUDBASE_ENV_ID, 'wizard-env');
  const connection = join((await fixture(t)).directory, 'connection.json');
  for (const data of [{ ...preset, apiKey: key }, { ...preset, region: 1 }, [preset], null]) {
    await writeFile(connection, JSON.stringify(data));
    await assert.rejects(connectionOptions({ connection }));
  }
  await writeFile(connection, JSON.stringify(preset));
  await assert.rejects(connectionOptions({ connection, envId: 'other' }), { code: 'CONFLICTING_CONNECTION_OPTIONS' });
});

test('Git directories, worktrees and symlinked destinations cannot receive credentials', async (t) => {
  const { directory } = await fixture(t);
  const repo = join(directory, 'repo');
  await mkdir(repo, { mode: 0o700 });
  await writeFile(join(repo, '.git'), 'gitdir: elsewhere');
  const alias = join(directory, 'alias');
  await symlink(repo, alias, 'dir');
  for (const file of [join(repo, 'private', 'c.env'), join(alias, 'private', 'c.env')]) {
    await assert.rejects(configLocation(file, true), { code: 'CONFIG_INSIDE_REPOSITORY' });
  }
  const target = join(directory, 'real.env');
  await writeFile(target, serializeConfig(values), { mode: 0o600 });
  const link = join(directory, 'linked.env');
  await symlink(target, link);
  await assert.rejects(readConfigFile(link), { code: 'REGULAR_CONFIG_FILE_REQUIRED' });
  await assert.rejects(saveConfigFile(link, values, null), { code: 'REGULAR_CONFIG_FILE_REQUIRED' });
});

test('private permissions and absolute paths are enforced without chmod of existing user files', async (t) => {
  await assert.rejects(readConfigFile('relative.env'), { code: 'ABSOLUTE_CONFIG_PATH_REQUIRED' });
  if (process.platform === 'win32') return;
  const envFile = await pathFor(t);
  await saveConfigFile(envFile, values, null);
  await chmod(envFile, 0o644);
  await assert.rejects(readConfigFile(envFile), { code: 'PRIVATE_FILE_REQUIRED' });
  assert.equal((await lstat(envFile)).mode & 0o777, 0o644);
  await chmod(envFile, 0o600);
  await chmod(join(envFile, '..'), 0o755);
  await assert.rejects(readConfigFile(envFile), { code: 'PRIVATE_DIRECTORY_REQUIRED' });
});

test('competing writes and changed files abort without losing the latest config', async (t) => {
  const envFile = await pathFor(t);
  await saveConfigFile(envFile, values, null);
  const old = await readConfigFile(envFile);
  const io = interaction(['edit', 'my-new-key', 'y'], async () => {
    await saveConfigFile(envFile, { ...values, CLOUDBASE_API_KEY: 'other-writer' }, old);
    return {};
  });
  await assert.rejects(runSetup({ ...preset, envFile }, io), { code: 'CONFIG_CHANGED' });
  assert.equal((await readConfigFile(envFile)).values.CLOUDBASE_API_KEY, 'other-writer');
  await writeFile(envFile + '.lock', '');
  await assert.rejects(saveConfigFile(envFile, values, await readConfigFile(envFile)), { code: 'SETUP_BUSY' });
});

test('dotenv quoting round-trips special characters and does not inject additional fields', () => {
  for (const apiKey of ['token#suffix', "token'quoted", 'token"quoted', 'token\\suffix']) {
    const text = serializeConfig({ ...values, CLOUDBASE_API_KEY: apiKey });
    assert.equal(parseEnv(text).CLOUDBASE_API_KEY, apiKey);
    assert.equal(Object.keys(parseEnv(text)).length, 3);
  }
  assert.throws(() => serializeConfig({ ...values, CLOUDBASE_API_KEY: 'key\nEVIL=1' }));
  assert.throws(() => serializeConfig({ ...values, CLOUDBASE_API_KEY: 'x'.repeat(65536) }), { code: 'CONFIG_TOO_LARGE' });
});

function fakeTerminal() {
  const input = new PassThrough();
  input.isTTY = true;
  input.isRaw = false;
  input.setRawMode = (value) => { input.isRaw = value; };
  let text = '';
  const output = new Writable({ write(chunk, _, callback) { text += chunk; callback(); } });
  output.isTTY = true;
  return { input, output, text: () => text };
}

test('terminal input hides typed/pasted keys, handles backspace, and restores terminal on cancellation/EOF', async () => {
  for (const end of ['\r', '\x03', '\x04', null]) {
    const tty = fakeTerminal();
    const ask = terminalPrompt(tty.input, tty.output);
    const pending = ask('API Key', { secret: true });
    tty.input.write(key + 'x\x7f');
    if (end === null) tty.input.end(); else tty.input.write(end);
    if (end === '\r') assert.equal(await pending, key);
    else await assert.rejects(pending, { code: 'SETUP_CANCELLED' });
    assert.equal(tty.input.isRaw, false);
    assert.equal(tty.text(), 'API Key: \n');
    assert.equal(tty.input.listenerCount('keypress'), 0);
  }
  assert.throws(() => terminalPrompt(new PassThrough(), new PassThrough()), { code: 'INTERACTIVE_TERMINAL_REQUIRED' });
});

test('terminal echo is already disabled when the hidden-input prompt becomes visible', async () => {
  const tty = fakeTerminal();
  const output = new Writable({ write(chunk, _, callback) {
    if (chunk.toString().includes('API Key')) {
      assert.equal(tty.input.isRaw, true);
      tty.input.write(key + '\r');
    }
    callback();
  } });
  output.isTTY = true;
  assert.equal(await terminalPrompt(tty.input, output)('API Key', { secret: true }), key);
  assert.equal(tty.input.isRaw, false);
});

test('CLI rejects key arguments, duplicate/unknown flags and pipes without exposing their content', () => {
  assert.deepEqual(parseSetupArgs(['--env-id', 'env', '--region', 'ap-shanghai']), { envId: 'env', region: 'ap-shanghai' });
  for (const args of [['--api-key', key], ['--env-id', 'a', '--env-id', 'b'], ['--region'], ['__proto__', key]]) {
    const child = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', input: key });
    assert.equal(child.status, 1);
    assert.equal(child.stdout, '');
    assert.ok(!child.stderr.includes(key));
  }
  const pipe = spawnSync(process.execPath, [script], { encoding: 'utf8', input: key });
  assert.equal(pipe.status, 1);
  assert.match(pipe.stderr, /INTERACTIVE_TERMINAL_REQUIRED/);
  // --env-file is consumed early by some Node versions, even after the script path.
  const configured = spawnSync(process.execPath, [script, '--config', '/unused/private/credentials.env'], { encoding: 'utf8' });
  assert.equal(configured.status, 1);
  assert.match(configured.stderr, /INTERACTIVE_TERMINAL_REQUIRED/);
  assert.deepEqual(parseSetupArgs(['--config', '/private/config.env']), { envFile: '/private/config.env' });
  const help = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /--connection/);
  assert.ok(!setupFailure(new Error(key)).includes(key));
  assert.ok(!setupFailure(new PublishError('CREDENTIAL_EXCHANGE', 'SECRET_KEY')).includes('SECRET_KEY'));
});

test('generated config starts the production six-tool server and file values override inherited CloudBase settings', async (t) => {
  const envFile = await pathFor(t);
  await saveConfigFile(envFile, values, null);
  const entry = clientConfiguration(envFile).json.mcpServers.cloudbase_html;
  const client = new Client({ name: 'wizard-integration', version: '1.0.0' });
  const transport = new StdioClientTransport({ ...entry, args: ['--import', preload, ...entry.args],
    env: { CLOUDBASE_ENV_ID: 'wrong-env', CLOUDBASE_REGION: 'wrong-region', CLOUDBASE_API_KEY: 'wrong-key',
      CLOUDBASE_PUBLIC_BASE_URL: 'invalid domain', CLOUDBASE_REGISTRY_DIR: 'off' }, stderr: 'pipe' });
  let diagnostic = '';
  transport.stderr.on('data', (chunk) => { diagnostic += chunk; });
  try {
    await client.connect(transport);
    assert.equal((await client.listTools()).tools.length, 6);
    const response = await client.callTool({ name: 'hosting_status', arguments: {} });
    assert.equal(response.isError, false);
    assert.equal(response.structuredContent.envId, 'wizard-env');
    assert.equal(response.structuredContent.registry.enabled, true);
    assert.equal(response.structuredContent.uploadPermission, 'NOT_TESTED');
    assert.equal(response.structuredContent.publicVerification, 'NOT_TESTED');
    assert.ok(!JSON.stringify(response).includes(key));
    assert.equal(diagnostic, '');
  } finally { await client.close(); }
});

test('launcher failure leaves stdout empty and missing-config recovery points to the terminal wizard', async (t) => {
  const envFile = await pathFor(t);
  const entry = clientConfiguration(envFile).json.mcpServers.cloudbase_html;
  const child = spawnSync(entry.command, entry.args, { encoding: 'utf8' });
  assert.equal(child.status, 1);
  assert.equal(child.stdout, '');
  assert.match(child.stderr, /npm run setup/);
  const step = recoveryFor(new PublishError('CONFIG', 'CONFIG_REQUIRED')).next_step;
  assert.equal(step.setup_guide.local_setup.interactive, true);
  assert.equal(step.setup_guide.local_setup.secret_input, 'terminal_only');
  await saveConfigFile(envFile, values, null);
  const call = fileURLToPath(new URL('../scripts/call.mjs', import.meta.url));
  const listed = spawnSync(process.execPath, [call, '--config', envFile, 'list'], { encoding: 'utf8' });
  assert.equal(listed.status, 0);
  assert.equal(JSON.parse(listed.stdout).tools.length, 6);
});
