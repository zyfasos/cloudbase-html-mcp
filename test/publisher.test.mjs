import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Publisher, loadHtml, sha256, verifyPublic } from '../src/publisher.mjs';
import { Credentials, PublishError, readConfig, guarded, baseUrl } from '../src/cloudbase.mjs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';

const html = Buffer.from('<!doctype html><html><body>测试发布</body></html>');
async function fixture(t, bytes = html) {
  const dir = await mkdtemp(join(tmpdir(), 'html-mcp-test-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const path = join(dir, '页面.html');
  await writeFile(path, bytes);
  return path;
}
class FakeCloud {
  objects = new Map();
  puts = [];
  async connect() { return { baseUrl: 'https://example.com' }; }
  async head(key) { return this.objects.get(key) ?? null; }
  async put(key, bytes, hash, stage) {
    this.puts.push(key);
    if (stage === this.failAt) throw new PublishError(stage, 'AccessDenied');
    this.objects.set(key, { bytes: bytes.length, sha256: hash });
  }
}
const publicHtml = async () => new Response(html, { headers: { 'Content-Type': 'text/html' } });

test('publish writes only the current object; repeat update preserves URL without snapshots', async (t) => {
  const cloud = new FakeCloud();
  const publisher = new Publisher(cloud, publicHtml);
  const localPath = await fixture(t);
  const first = await publisher.publish({ localPath });
  assert.equal(first.status, 'PUBLISHED');
  assert.match(first.siteId, /^s-[0-9a-f]{32}$/);
  assert.deepEqual(cloud.puts, [`sites/${first.siteId}/index.html`]);
  assert.equal(first.versionKey, undefined);
  assert.equal((await publisher.get(first.siteId)).publicCheck.verified, true);
  const replay = await publisher.publish({ localPath, siteId: first.siteId, expectedSha256: first.sha256 });
  assert.equal(replay.url, first.url);
  assert.equal(cloud.puts.length, 1);
});

test('existing page update keeps URL and rejects a stale hash before writes', async (t) => {
  const cloud = new FakeCloud();
  const publisher = new Publisher(cloud, publicHtml);
  const localPath = await fixture(t);
  const first = await publisher.publish({ localPath });
  const changed = Buffer.from('<html>changed</html>');
  await writeFile(localPath, changed);
  await assert.rejects(publisher.publish({ localPath, siteId: first.siteId, expectedSha256: '0'.repeat(64) }), { code: 'VERSION_CONFLICT' });
  assert.equal(cloud.puts.length, 1);
  publisher.fetcher = async () => new Response(changed, { headers: { 'content-type': 'text/html' } });
  const updated = await publisher.publish({ localPath, siteId: first.siteId, expectedSha256: first.sha256 });
  assert.equal(updated.url, first.url);
  assert.equal(updated.status, 'PUBLISHED');
  assert.notEqual(updated.sha256, first.sha256);
});

test('failed first current upload creates no snapshot and retains its recovery ID', async (t) => {
  const cloud = new FakeCloud(); cloud.failAt = 'COS_CURRENT_PUT';
  await assert.rejects(new Publisher(cloud).publish({ localPath: await fixture(t) }), (error) => {
    assert.equal(error.code, 'AccessDenied');
    assert.equal(error.stage, 'COS_CURRENT_PUT');
    assert.match(error.details.siteId, /^s-/);
    assert.equal(error.details.writeState, 'CURRENT_WRITE_ATTEMPTED');
    return true;
  });
  assert.equal(cloud.puts.length, 1);
});

test('current write failure reports partial deployment', async (t) => {
  const cloud = new FakeCloud(); cloud.failAt = 'COS_CURRENT_PUT';
  await assert.rejects(new Publisher(cloud).publish({ localPath: await fixture(t) }), (error) => {
    assert.equal(error.details.writeState, 'CURRENT_WRITE_ATTEMPTED');
    assert.equal(cloud.objects.size, 0);
    return true;
  });
});

test('public failure is never reported as published', async (t) => {
  const publisher = new Publisher(new FakeCloud(), async () => new Response('denied', { status: 403 }));
  const data = await publisher.publish({ localPath: await fixture(t) });
  assert.equal(data.status, 'UPLOADED_NOT_PUBLICLY_VERIFIED');
  assert.equal(data.publicCheck.httpStatus, 403);
});

test('public check rejects attachment, wrong hash, and non HTML responses', async () => {
  for (const response of [
    new Response(html, { headers: { 'content-type': 'text/html', 'content-disposition': 'attachment' } }),
    new Response('other', { headers: { 'content-type': 'text/html' } }),
    new Response(html, { headers: { 'content-type': 'text/plain' } }),
  ]) assert.equal((await verifyPublic('https://example.com/index.html', sha256(html), async () => response)).verified, false);
});

test('input rejects traversal, invalid UTF-8, missing file, relative path and oversized file', async (t) => {
  await assert.rejects(new Publisher(new FakeCloud()).get('../../index.html'), { code: 'INVALID_SITE_ID' });
  await assert.rejects(loadHtml('test.html'), { code: 'ABSOLUTE_HTML_PATH_REQUIRED' });
  await assert.rejects(loadHtml('/nonexistent-mcp-test.html'), { code: 'FILE_NOT_READABLE' });
  await assert.rejects(loadHtml(await fixture(t, Buffer.from([255, 254]))), { code: 'UTF8_REQUIRED' });
  await assert.rejects(loadHtml(await fixture(t, Buffer.alloc(20 * 1024 * 1024 + 1))), { code: 'INVALID_FILE_SIZE' });
});

test('configuration is required; domains reject credentials and paths', () => {
  assert.throws(() => readConfig({}), { code: 'CONFIG_REQUIRED' });
  assert.equal(baseUrl('example.com'), 'https://example.com');
  for (const value of ['http://example.com', 'https://user:pass@example.com', 'https://example.com/path']) {
    assert.throws(() => baseUrl(value), { code: 'INVALID_PUBLIC_DOMAIN' });
  }
});

test('default CloudBase domain distinguishes preview interstitial from direct public success', async () => {
  const check = await verifyPublic('https://test.tcloudbaseapp.com/index.html', sha256(html), async () =>
    new Response(html, { headers: { 'content-type': 'text/html', 'content-disposition': 'attachment' } }));
  assert.equal(check.verified, false);
  assert.equal(check.defaultDomainNotice, true);
});

test('local resource warning does not falsely match absolute HTTPS URLs', async (t) => {
  const remote = await loadHtml(await fixture(t, Buffer.from('<html><img src="https://example.com/a.png"></html>')));
  assert.equal(remote.warnings.length, 0);
  const local = await loadHtml(await fixture(t, Buffer.from('<html><img src="./a.png"></html>')));
  assert.equal(local.warnings.length, 1);
});

test('HEAD mismatch is not a successful deployment', async (t) => {
  const cloud = new FakeCloud();
  cloud.head = async () => cloud.puts.length ? { bytes: 0, sha256: 'wrong' } : null;
  await assert.rejects(new Publisher(cloud, publicHtml).publish({ localPath: await fixture(t) }), { code: 'VERIFY_MISMATCH' });
});

test('credential exchange is scoped, cached, coalesced and refreshed before expiry', async () => {
  let now = 1_000_000; let calls = 0;
  const provider = new Credentials({ envId: 'test-env', region: 'ap-shanghai', apiKey: 'secret' }, async (url, options) => {
    calls++;
    assert.equal(url, 'https://test-env.ap-shanghai.tcb-api.tencentcloudapi.com/capi/credential');
    assert.equal(options.headers.Authorization, 'Bearer secret');
    assert.deepEqual(JSON.parse(options.body), { env: 'test-env' });
    assert.equal(options.redirect, 'error');
    return Response.json({ code: 0, data: { TmpSecretId: 'id', TmpSecretKey: 'key', Token: 'token', ExpiredTime: now / 1000 + 600 } });
  }, () => now);
  await Promise.all([provider.get(), provider.get()]);
  assert.equal(calls, 1);
  now += 301_000;
  await provider.get();
  assert.equal(calls, 2);
});

test('downstream errors never include raw messages or credentials', async () => {
  await assert.rejects(guarded('TEST', () => { throw Object.assign(new Error('secret-value'), { code: 'AccessDenied', requestId: 'req-123' }); }), (error) => {
    assert.equal(error.code, 'AccessDenied');
    assert.equal(error.details.requestId, 'req-123');
    assert.equal(JSON.stringify(error).includes('secret-value'), false);
    return true;
  });
  const provider = new Credentials({ envId: 'test', region: 'test', apiKey: 'secret-value' }, async () => new Response('secret-value', { status: 403 }));
  await assert.rejects(provider.get(), { code: 'HTTP_403' });
});

test('real STDIO handshake, exact tool list, missing-config cold start and schema rejection', async () => {
  const client = new Client({ name: 'test', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath,
    args: ['src/server.mjs'], env: {}, stderr: 'pipe' });
  try {
    await client.connect(transport);
    const list = await client.listTools();
    assert.deepEqual(list.tools.map((t) => t.name).sort(), ['get_html', 'hosting_status', 'list_html', 'offline_html', 'online_html', 'publish_html']);
    for (const tool of list.tools) {
      for (const field of Object.values(tool.inputSchema.properties ?? {})) {
        assert.equal(typeof field.description, 'string');
        assert.ok(field.description.length > 0);
      }
    }
    const publishSchema = list.tools.find((tool) => tool.name === 'publish_html').inputSchema;
    assert.deepEqual(publishSchema.required, ['localPath']);
    assert.equal(publishSchema.properties.newPage.type, 'boolean');
    assert.equal(publishSchema.properties.siteId.pattern, '^s-[0-9a-f]{32}$');
    const status = await client.callTool({ name: 'hosting_status', arguments: {} });
    assert.equal(status.isError, true);
    assert.equal(status.structuredContent.code, 'CONFIG_REQUIRED');
    assert.equal(status.structuredContent.next_step.tool, 'hosting_status');
    assert.equal(status.structuredContent.next_step.action, 'configure_environment');
    assert.deepEqual(status.structuredContent.next_step.required_config,
      ['CLOUDBASE_ENV_ID', 'CLOUDBASE_REGION', 'CLOUDBASE_API_KEY']);
    assert.equal(status.structuredContent.next_step.setup_guide.local_path, 'docs/getting-started.md');
    assert.deepEqual(status.structuredContent.next_step.suggested_args, {});
    assert.equal(status.structuredContent.retryable, false);
    const invalid = await client.callTool({ name: 'publish_html', arguments: { localPath: 'x', siteId: '../evil' } });
    assert.equal(invalid.isError, true);
  } finally { await client.close(); }
});

test('overlapping publishes reject busy and allow retry after the first completes', async (t) => {
  const cloud = new FakeCloud();
  let release;
  let connected;
  const started = new Promise((resolve) => { connected = resolve; });
  const pending = new Promise((resolve) => { release = resolve; });
  cloud.connect = async () => { connected(); await pending; return { baseUrl: 'https://example.com' }; };
  const publisher = new Publisher(cloud, publicHtml);
  const localPath = await fixture(t);
  const first = publisher.publish({ localPath });
  await started;
  await assert.rejects(publisher.publish({ localPath }), { code: 'PUBLISH_BUSY' });
  release();
  const result = await first;
  assert.equal(result.status, 'PUBLISHED');
  const retried = await publisher.publish({ localPath, siteId: result.siteId, expectedSha256: result.sha256 });
  assert.equal(retried.writeState, 'STORAGE_VERIFIED');
});


test('a 20 MiB HTML publishes and passes public hash verification without truncation', async (t) => {
  const bytes = Buffer.alloc(20 * 1024 * 1024, ' ');
  bytes.write('<html>'); bytes.write('</html>', bytes.length - 7);
  const cloud = new FakeCloud();
  const publisher = new Publisher(cloud, async () => new Response(bytes, { headers: { 'content-type': 'text/html' } }));
  const result = await publisher.publish({ localPath: await fixture(t, bytes) });
  assert.equal(result.status, 'PUBLISHED');
  assert.equal(result.sha256, sha256(bytes));
  assert.equal(result.publicCheck.verified, true);
  assert.equal(cloud.objects.get(`sites/${result.siteId}/index.html`).bytes, bytes.length);
});

test('20 MiB plus one byte is rejected before upload and during public verification', async (t) => {
  const bytes = Buffer.alloc(20 * 1024 * 1024 + 1, ' ');
  bytes.write('<html>'); bytes.write('</html>', bytes.length - 7);
  const cloud = new FakeCloud();
  await assert.rejects(new Publisher(cloud).publish({ localPath: await fixture(t, bytes) }), { code: 'INVALID_FILE_SIZE' });
  assert.equal(cloud.puts.length, 0);
  for (const headers of [{}, { 'content-length': String(bytes.length) }]) {
    const result = await verifyPublic('https://example.com/index.html', sha256(bytes),
      async () => new Response(bytes, { headers: { ...headers, 'content-type': 'text/html' } }));
    assert.equal(result.verified, false);
    assert.equal(result.reason, 'RESPONSE_TOO_LARGE');
  }
});
