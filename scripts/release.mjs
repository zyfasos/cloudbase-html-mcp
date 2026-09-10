import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, rm, realpath } from 'node:fs/promises';
import { join, dirname, resolve, basename } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const name = 'cloudbase-html-mcp';
const registry = 'https://registry.npmjs.org';
const documentFiles = ['README.md', 'README.en.md', 'docs/getting-started.md', 'docs/clients.md', 'PROJECT.md'];
const marker = /<!-- release:version -->\r?\n([\s\S]*?)\r?\n<!-- \/release:version -->/g;
const digest = (bytes, algorithm = 'sha256', encoding = 'hex') => createHash(algorithm).update(bytes).digest(encoding);
const json = async (path) => JSON.parse(await readFile(path, 'utf8'));
const saveJson = (path, data) => writeFile(path, JSON.stringify(data, null, 2) + '\n');
const requireThat = (condition, message) => { if (!condition) throw new Error(message); };
export function validateVersion(version) {
  requireThat(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-(?:beta|rc)\.(0|[1-9]\d*))?$/.test(version), '版本须为 x.y.z、x.y.z-beta.N 或 x.y.z-rc.N');
}

export async function checkVersions(directory = root) {
  const pkg = await json(join(directory, 'package.json'));
  const lock = await json(join(directory, 'npm-shrinkwrap.json'));
  validateVersion(pkg.version);
  requireThat(pkg.name === name && lock.name === name && lock.version === pkg.version && lock.packages[''].version === pkg.version, 'package/shrinkwrap 名称或版本不一致');
  assert.deepEqual(lock.packages[''].dependencies, pkg.dependencies, 'shrinkwrap 根依赖不一致');
  for (const os of ['macos', 'windows']) {
    const template = await json(join(directory, `templates/mcp.${os}.json`));
    const expected = { mcpServers: { cloudbase_html: { command: os === 'windows' ? 'cmd.exe' : 'npx',
      args: [...(os === 'windows' ? ['/d', '/c', 'npx'] : []), '-y', `${name}@${pkg.version}`, 'serve'] } } };
    assert.deepEqual(template, expected, `templates/mcp.${os}.json 与版本/命令契约不一致`);
  }
  for (const file of documentFiles) {
    const text = await readFile(join(directory, file), 'utf8');
    const blocks = [...text.matchAll(marker)];
    requireThat(blocks.length === 1, `${file}: release:version 标记必须恰好一组`);
    const versions = blocks[0][1].match(/\b\d+\.\d+\.\d+(?:-(?:beta|rc)\.\d+)?\b/g);
    requireThat(versions?.length === 1 && versions[0] === pkg.version, `${file}: 当前版本不同步`);
    // Historical prose is deliberately excluded; executable snippets must always be current.
    for (const match of text.matchAll(/cloudbase-html-mcp(?:@|-)(\d+\.\d+\.\d+(?:-(?:beta|rc)\.\d+)?)/g)) {
      // PROJECT keeps immutable release history containing package@version references.
      if (file !== 'PROJECT.md') requireThat(match[1] === pkg.version, `${file}: 过期的命令/安装包示例 ${match[1]}`);
    }
    for (const block of text.matchAll(/```json\s*\n([\s\S]*?)\n```/g)) {
      const value = JSON.parse(block[1]);
      if (value.mcpServers?.cloudbase_html) {
        const os = value.mcpServers.cloudbase_html.command === 'cmd.exe' ? 'windows' : 'macos';
        assert.deepEqual(value, await json(join(directory, `templates/mcp.${os}.json`)), `${file}: MCP JSON 与模板不一致`);
      }
    }
  }
  return pkg;
}

export async function syncVersion(version, directory = root) {
  validateVersion(version);
  const pkg = await checkVersions(directory);
  if (version === pkg.version) return { version, changed: [] };
  const updates = new Map();
  for (const file of ['package.json', 'npm-shrinkwrap.json']) {
    const data = await json(join(directory, file)); data.version = version;
    if (data.packages) data.packages[''].version = version;
    updates.set(file, JSON.stringify(data, null, 2) + '\n');
  }
  for (const file of [...documentFiles, 'templates/mcp.macos.json', 'templates/mcp.windows.json']) {
    let text = await readFile(join(directory, file), 'utf8');
    text = text.replace(marker, (block) => block.replaceAll(pkg.version, version));
    if (file !== 'PROJECT.md') text = text.replaceAll(`${name}@${pkg.version}`, `${name}@${version}`).replaceAll(`${name}-${pkg.version}.tgz`, `${name}-${version}.tgz`);
    updates.set(file, text);
  }
  // Validate every input before writing; preserve unrelated text and all historical assertions.
  for (const [file, text] of updates) await writeFile(join(directory, file), text);
  await checkVersions(directory);
  return { version, changed: [...updates.keys()], next: '补写本次变更说明；发布状态与CI/桌面验收必须按实际证据另行更新。' };
}

function npm(args, cwd, env = process.env) {
  requireThat(process.env.npm_execpath, '请通过 npm run release:* 调用，避免依赖桌面 PATH 或 shell 参数转义');
  const childEnv = { ...env }; delete childEnv.npm_config_allow_scripts;
  const r = spawnSync(process.execPath, [process.env.npm_execpath, ...args], { cwd, env: childEnv, encoding: 'utf8', timeout: 240000, maxBuffer: 16 * 1024 * 1024 });
  requireThat(r.status === 0, `npm ${args[0]} 失败：${r.error?.message ?? r.stderr}`);
  return r.stdout;
}

// npm pack emits regular ustar files. Fail closed on links or unsupported extensions.
export function unpack(bytes) {
  const tar = gunzipSync(bytes); const files = new Map();
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512); if (header.every((v) => v === 0)) break;
    const text = (start, length) => header.subarray(start, start + length).toString().replace(/\0.*$/s, '');
    const path = (text(345, 155) ? text(345, 155) + '/' : '') + text(0, 100);
    const size = parseInt(text(124, 12).trim(), 8); const type = text(156, 1);
    requireThat(Number.isSafeInteger(size) && size >= 0 && offset + 512 + size <= tar.length, '无效 tar 长度');
    requireThat((type === '0' || type === '') && path.startsWith('package/') && !path.split('/').includes('..') && !files.has(path), `不支持的包条目 ${path}`);
    files.set(path.slice(8), tar.subarray(offset + 512, offset + 512 + size));
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  requireThat(files.size > 0, '空安装包'); return files;
}
export function checkPackage(files, pkg) {
  const allowed = pkg.files;
  for (const file of files.keys()) {
    requireThat(file === 'package.json' || allowed.some((item) => item.endsWith('/') ? file.startsWith(item) : file === item), `包内文件不在发布白名单：${file}`);
    requireThat(!/^(test|artifacts|node_modules|docs\/implementation)\/|(?:^|\/)credentials\.env$|^AGENTS\.md$|\.(?:html?|tgz|log|local\.json)$/i.test(file) &&
      (file === '.env.example' || !/(?:^|\/)\.env(?:\..*)?$/.test(file)), `包内含禁止发布条目：${file}`);
  }
  for (const required of ['package.json', 'npm-shrinkwrap.json', 'bin/cli.mjs', 'src/server.mjs', 'src/html-resources.mjs', 'LICENSE', 'templates/mcp.macos.json', 'templates/mcp.windows.json']) requireThat(files.has(required), `包内缺失 ${required}`);
  assert.equal(JSON.parse(files.get('package.json')).version, pkg.version);
  assert.equal(JSON.parse(files.get('npm-shrinkwrap.json')).version, pkg.version);
}

async function smoke(installed, directory, version) {
  const home = join(directory, '用户 Home'); await mkdir(home, { recursive: true });
  // No inherited credentials, config pointers, NODE_OPTIONS or npm configuration.
  const env = { HOME: home, USERPROFILE: home, ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) };
  const cli = join(installed, 'bin/cli.mjs');
  const r = spawnSync(process.execPath, [cli, '--version'], { cwd: directory, env, encoding: 'utf8', timeout: 15000 });
  requireThat(r.status === 0 && r.stdout.trim() === version, '安装包版本查询失败');
  const client = new Client({ name: 'release-verification', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath, args: [cli, 'serve'], cwd: directory, env, stderr: 'pipe' });
  let stderr = ''; transport.stderr.on('data', (bytes) => { stderr += bytes; });
  try {
    await client.connect(transport);
    const names = (await client.listTools()).tools.map((t) => t.name).sort();
    assert.deepEqual(names, ['get_html', 'hosting_status', 'list_html', 'offline_html', 'online_html', 'publish_html']);
    const result = await client.callTool({ name: 'hosting_status', arguments: {} });
    assert.equal(result.isError, true); assert.equal(result.structuredContent.code, 'CONFIG_FILE_MISSING');
    assert.equal(result.structuredContent.configuration.path, join(home, '.config/cloudbase-html-mcp/credentials.env'));
    return { version, tools: names, missingConfig: 'CONFIG_FILE_MISSING', cloudRequests: 'none: temporary home has no credentials', stderr };
  } finally { await client.close(); }
}

export async function packRelease() {
  const pkg = await checkVersions();
  const directory = await mkdtemp(join(root, 'artifacts', 'release-'));
  const env = { ...process.env, npm_config_offline: 'true' };
  const initial = JSON.parse(npm(['pack', '--dry-run', '--json', '--ignore-scripts'], root, env))[0];
  const before = new Map(await Promise.all(initial.files.map(async ({ path }) => [path, digest(await readFile(join(root, path)))])));
  for (const command of ['check', 'test']) {
    await writeFile(join(directory, `${command}.log`), npm(['run', command], root, env));
  }
  const meta = JSON.parse(npm(['pack', '--json', '--ignore-scripts', '--pack-destination', directory], root, env))[0];
  const bytes = await readFile(join(directory, meta.filename)); const files = unpack(bytes); checkPackage(files, pkg);
  assert.deepEqual([...files.keys()].sort(), [...before.keys()].sort(), '验证期间发布文件集合发生变化，请重新执行');
  const hashes = {};
  for (const [file, content] of files) {
    assert.equal(digest(content), before.get(file), `验证期间发布内容发生变化：${file}，请重新执行`);
    requireThat(content.equals(await readFile(join(root, file))), `包内容与源码不一致：${file}`); hashes[file] = digest(content);
  }
  requireThat(meta.integrity === `sha512-${digest(bytes, 'sha512', 'base64')}`, 'npm pack完整性不匹配');
  const temporary = await realpath(await mkdtemp(join(tmpdir(), 'cloudbase-release-')));
  let protocol;
  try {
    const installed = join(temporary, '安装 空间');
    npm(['install', '--prefix', installed, '--offline', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', join(directory, meta.filename)], temporary,
      { ...env, npm_config_cache: process.env.CLOUDBASE_TEST_NPM_CACHE ?? join(root, 'artifacts/test-npm-cache') });
    protocol = await smoke(join(installed, 'node_modules', name), temporary, pkg.version);
  } finally { await rm(temporary, { recursive: true, force: true }); }
  const report = { version: pkg.version, tarball: meta.filename, integrity: meta.integrity, sha256: digest(bytes), files: hashes,
    validatedAt: new Date().toISOString(), runtime: process.version, platform: process.platform, checks: ['npm run check', 'npm test'], protocol };
  await saveJson(join(directory, 'release.json'), report);
  return { directory, manifest: join(directory, 'release.json'), ...report };
}

export function verifyMetadata(metadata, tags, manifest, expectedTags) {
  assert.equal(metadata.name, name); assert.equal(metadata.version, manifest.version);
  assert.equal(metadata.dist?.integrity, manifest.integrity, 'registry安装包与本地验证包不同');
  for (const tag of expectedTags) assert.equal(tags[tag], manifest.version, `${tag} 未指向目标版本`);
}
export async function verifyPublic(manifestPath, expectedTags) {
  const manifest = await json(manifestPath); validateVersion(manifest.version);
  requireThat(basename(manifest.tarball) === manifest.tarball, 'manifest tarball必须是文件名');
  const bytes = await readFile(join(dirname(manifestPath), manifest.tarball));
  assert.equal(digest(bytes), manifest.sha256, '本地发布包已被修改');
  assert.equal(`sha512-${digest(bytes, 'sha512', 'base64')}`, manifest.integrity);
  const get = async (path) => {
    const r = await fetch(registry + path, { signal: AbortSignal.timeout(30000) });
    requireThat(r.ok, `npm registry HTTP ${r.status}；若刚发布，请稍后重试核验，不要重复发布`); return r.json();
  };
  const metadata = await get(`/${name}/${manifest.version}`); const tags = (await get(`/${name}`))['dist-tags'];
  verifyMetadata(metadata, tags, manifest, expectedTags);
  const temporary = await realpath(await mkdtemp(join(tmpdir(), 'cloudbase-public-')));
  try {
    const home = join(temporary, 'npm Home'); await mkdir(home);
    const installed = join(temporary, '安装 空间');
    const env = { HOME: home, USERPROFILE: home, PATH: process.env.PATH,
      ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
      npm_config_cache: join(temporary, '新 cache'), npm_config_userconfig: join(home, '.npmrc') };
    npm(['install', '--prefix', installed, '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', `--registry=${registry}`, `${name}@${manifest.version}`], temporary, env);
    const pkgRoot = join(installed, 'node_modules', name);
    for (const [file, hash] of Object.entries(manifest.files)) {
      requireThat(!file.split('/').includes('..') && !file.startsWith('/') && !file.includes('\\'), '无效manifest文件路径');
      assert.equal(digest(await readFile(join(pkgRoot, file))), hash, `公开安装后的文件不一致：${file}`);
    }
    const report = { version: manifest.version, tags, expectedTags, integrity: metadata.dist.integrity,
      verifiedAt: new Date().toISOString(), runtime: process.version, platform: process.platform, freshCache: true,
      protocol: await smoke(pkgRoot, temporary, manifest.version), passed: true };
    await saveJson(join(dirname(manifestPath), 'public-verification.json'), report); return report;
  } finally { await rm(temporary, { recursive: true, force: true }); }
}

async function main(args) {
  const [action, ...rest] = args;
  if (action === 'version' && rest.length === 1) return syncVersion(rest[0]);
  if (action === 'check' && !rest.length) return { version: (await checkVersions()).version, passed: true };
  if (action === 'pack' && !rest.length) { await mkdir(join(root, 'artifacts'), { recursive: true }); return packRelease(); }
  if (action === 'verify' && rest.length >= 3 && rest[1] === '--network' && rest.slice(2).every((tag) => /^[a-z][a-z0-9-]*$/.test(tag))) return verifyPublic(resolve(rest[0]), rest.slice(2));
  throw new Error('用法：npm run release:version -- VERSION | release:check | release:pack | release:verify -- MANIFEST --network beta [latest]。不执行提交、推送、发布或标签写入。');
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(await main(process.argv.slice(2)), null, 2)); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
