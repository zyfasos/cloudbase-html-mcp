import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, realpath, rm, cp } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fixture } from './helpers.mjs';
import { VERSION } from '../src/version.mjs';
import { defaultConfigPath } from '../src/launch.mjs';
import { npm, root } from './npm-helper.mjs';

test('packed artifact installs offline, preserves default config and catalog across reinstall, and runs the six-tool lifecycle', { timeout: 180000 }, async (t) => {
  const temporary = await realpath((await fixture(t)).directory);
  const packed = JSON.parse(npm(['pack', '--json', '--ignore-scripts', '--pack-destination', temporary], root))[0];
  const files = packed.files.map((f) => f.path);
  for (const name of ['bin/cli.mjs', 'src/launch.mjs', 'src/version.mjs', 'npm-shrinkwrap.json', 'LICENSE', 'README.md']) assert.ok(files.includes(name), name);
  for (const file of files) assert.ok(!/^(?:test|artifacts|node_modules|docs\/implementation)\/|(?:^|\/)credentials\.env$|^AGENTS\.md$/.test(file), file);
  const install = join(temporary, '安装 空间');
  const home = join(temporary, '用户 Home');
  await mkdir(install); await mkdir(home);
  const tgz = join(temporary, packed.filename);
  const installArgs = ['install', '--prefix', install, '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', tgz];
  npm(installArgs, temporary);
  const installed = join(install, 'node_modules/cloudbase-html-mcp');
  const cli = join(installed, 'bin/cli.mjs');
  assert.equal(spawnSync(process.execPath, [cli, '--version'], { encoding: 'utf8', cwd: temporary }).stdout.trim(), VERSION);
  assert.equal(npm(['exec', '--offline', '--', 'cloudbase-html-mcp', '--version'], install).trim(), VERSION);
  // A synthetic previous candidate proves a version change as well as a reinstall; it is never published.
  const previous = join(temporary, 'previous-candidate');
  await cp(installed, previous, { recursive: true, filter: (source) => !source.includes(join(installed, 'node_modules')) });
  for (const name of ['package.json', 'npm-shrinkwrap.json']) {
    const p = join(previous, name), data = JSON.parse(await readFile(p, 'utf8'));
    data.version = '0.4.0-beta.0';
    if (data.packages) data.packages[''].version = data.version;
    await writeFile(p, JSON.stringify(data));
  }
  const older = JSON.parse(npm(['pack', '--json', '--ignore-scripts', '--pack-destination', temporary], previous))[0];
  npm([...installArgs.slice(0, -1), join(temporary, older.filename)], temporary);
  assert.equal(spawnSync(process.execPath, [cli, '--version'], { encoding: 'utf8' }).stdout.trim(), '0.4.0-beta.0');
  const file = defaultConfigPath(home);
  await mkdir(join(file, '..'), { recursive: true, mode: 0o700 });
  const credentials = 'CLOUDBASE_ENV_ID=package-env\nCLOUDBASE_REGION=ap-shanghai\nCLOUDBASE_API_KEY=offline-package-key\n';
  await writeFile(file, credentials, { mode: 0o600 });
  const html = join(home, '测试 页面.html'); await writeFile(html, '<html>package v1</html>');
  const preload = new URL('./fixtures/packaged-cloud.mjs', import.meta.url).href;
  async function session(callback) {
    const client = new Client({ name: 'packed-artifact', version: '1.0.0' });
    const transport = new StdioClientTransport({ command: process.execPath,
      args: ['--import', preload, cli, 'serve'], cwd: temporary,
      env: { HOME: home, USERPROFILE: home, TEST_PACKAGE_ROOT: installed, TEST_PACKAGE_STATE: temporary,
        CLOUDBASE_ENV_ID: 'inherited-wrong', CLOUDBASE_API_KEY: 'wrong', CLOUDBASE_REGION: 'wrong' }, stderr: 'pipe' });
    let stderr = ''; transport.stderr.on('data', (b) => { stderr += b; });
    try { await client.connect(transport); await callback(client); }
    catch (error) { t.diagnostic(stderr.replaceAll('offline-package-key', '[redacted]')); throw error; }
    finally { await client.close(); }
    assert.ok(!stderr.includes('offline-package-key'));
  }
  async function call(client, name, args = {}) {
    const r = await client.callTool({ name, arguments: args });
    assert.equal(r.isError, false, JSON.stringify(r)); return r.structuredContent;
  }
  let first, second, secondRegistration;
  await session(async (client) => {
    assert.equal((await client.listTools()).tools.length, 6);
    assert.equal((await call(client, 'hosting_status')).configuration.path, file);
    first = await call(client, 'publish_html', { localPath: html });
    assert.equal(first.url, `https://package.example/sites/${first.siteId}/`);
    const old = await call(client, 'get_html', { siteUrl: first.url });
    await writeFile(html, '<html>package v2</html>');
    const updated = await call(client, 'publish_html', { localPath: html, siteUrl: first.url, expectedSha256: old.sha256 });
    assert.equal(updated.url, first.url);
    second = await call(client, 'publish_html', { localPath: html, newPage: true });
    secondRegistration = (await call(client, 'list_html')).sites.find((s) => s.siteId === second.siteId);
    await call(client, 'offline_html', { siteId: first.siteId, expectedSha256: updated.sha256 });
  });
  // Simulate removal/reinstallation of the entire program. User data must not live here.
  await rm(join(install, 'node_modules'), { recursive: true });
  npm(installArgs, temporary);
  await session(async (client) => {
    const listed = await call(client, 'list_html', { lifecycle: 'offline' });
    assert.equal(listed.sites[0].siteId, first.siteId);
    const restored = await call(client, 'online_html', { siteId: first.siteId, localPath: html });
    assert.equal(restored.url, first.url);
    assert.equal(restored.pathBinding.defaultSiteId, second.siteId);
    assert.equal((await call(client, 'get_html', { localPath: html })).siteId, second.siteId);
    assert.equal((await call(client, 'get_html', { siteId: second.siteId })).sha256, second.sha256);
    assert.deepEqual((await call(client, 'list_html')).sites.find((s) => s.siteId === second.siteId), secondRegistration);
  });
  assert.equal(await readFile(file, 'utf8'), credentials);
  const stored = JSON.parse(await readFile(join(temporary, 'objects.json'), 'utf8'));
  assert.deepEqual(Object.keys(stored).sort(), [first.siteId, second.siteId].map((id) => `sites/${id}/index.html`).sort());
});
