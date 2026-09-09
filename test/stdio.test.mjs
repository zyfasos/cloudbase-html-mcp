import test from 'node:test';
import assert from 'node:assert/strict';
import { symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fixture } from './helpers.mjs';

async function session(directory, failAt, crashAt) {
  const client = new Client({ name: 'offline-integration', version: '1.0.0' });
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [fileURLToPath(new URL('./fixtures/stdio.mjs', import.meta.url))],
    env: { TEST_STATE_DIR: directory, ...(failAt ? { TEST_FAIL_STAGE: failAt } : {}),
      ...(crashAt ? { TEST_CRASH_STAGE: crashAt } : {}) }, stderr: 'pipe' });
  await client.connect(transport);
  return client;
}

test('real STDIO publishes, restarts, looks up by path, follows conflict advice and updates stable URL', async (t) => {
  const { directory, localPath } = await fixture(t);
  let client = await session(directory);
  let first;
  try {
    const tools = await client.listTools();
    assert.deepEqual(tools.tools.map((x) => x.name).sort(), ['get_html', 'hosting_status', 'list_html', 'offline_html', 'online_html', 'publish_html']);
    const status = (await client.callTool({ name: 'hosting_status', arguments: {} })).structuredContent;
    assert.equal(status.uploadPermission, 'NOT_TESTED');
    assert.equal(status.publicVerification, 'NOT_TESTED');
    assert.equal(status.registry.enabled, true);
    const response = await client.callTool({ name: 'publish_html', arguments: { localPath } });
    assert.equal(response.isError, false);
    first = response.structuredContent;
    assert.equal(first.status, 'PUBLISHED');
    assert.equal(first.registry.state, 'SAVED');
  } finally { await client.close(); }
  client = await session(directory);
  try {
    const duplicate = await client.callTool({ name: 'publish_html', arguments: { localPath } });
    assert.equal(duplicate.isError, true);
    assert.equal(duplicate.structuredContent.code, 'LOCAL_SITE_EXISTS');
    const step = duplicate.structuredContent.next_step;
    const next = await client.callTool({ name: step.tool, arguments: step.suggested_args });
    assert.equal(next.isError, false);
    assert.equal(next.structuredContent.siteId, first.siteId);
    const byPath = (await client.callTool({ name: 'get_html', arguments: { localPath } })).structuredContent;
    assert.equal(byPath.siteId, first.siteId);
    await writeFile(localPath, '<html><body>updated through STDIO</body></html>');
    const stale = await client.callTool({ name: 'publish_html', arguments: { localPath, siteId: first.siteId, expectedSha256: '0'.repeat(64) } });
    assert.equal(stale.isError, true);
    assert.equal(stale.structuredContent.code, 'VERSION_CONFLICT');
    assert.equal(stale.structuredContent.retryable, false);
    const updated = await client.callTool({ name: 'publish_html', arguments: { localPath, siteId: first.siteId, expectedSha256: byPath.sha256 } });
    assert.equal(updated.isError, false);
    assert.equal(updated.structuredContent.url, first.url);
    assert.equal(updated.structuredContent.publicCheck.verified, true);
    assert.notEqual(updated.structuredContent.sha256, first.sha256);
    const invalid = await client.callTool({ name: 'get_html', arguments: { localPath, siteId: first.siteId } });
    assert.equal(invalid.isError, true);
    assert.equal(invalid.structuredContent.code, 'ONE_PAGE_SELECTOR_REQUIRED');
  } finally { await client.close(); }
});

test('real STDIO retains a partial-write ID across restart and suggests read-only recovery', async (t) => {
  const { directory, localPath } = await fixture(t);
  let client = await session(directory, 'COS_CURRENT_PUT');
  let failedId;
  try {
    const result = await client.callTool({ name: 'publish_html', arguments: { localPath } });
    assert.equal(result.isError, true);
    const error = result.structuredContent;
    failedId = error.siteId;
    assert.equal(error.writeState, 'CURRENT_WRITE_ATTEMPTED');
    assert.equal(error.next_step.tool, 'get_html');
    assert.deepEqual(error.next_step.suggested_args, { siteId: failedId });
  } finally { await client.close(); }
  client = await session(directory);
  try {
    const result = await client.callTool({ name: 'get_html', arguments: { localPath } });
    assert.equal(result.isError, true);
    assert.equal(result.structuredContent.code, 'SITE_NOT_FOUND');
    assert.equal(result.structuredContent.siteId, failedId);
    assert.equal(result.structuredContent.registrationState, 'UNCERTAIN');
    assert.equal(result.structuredContent.next_step.action, 'check_target');
  } finally { await client.close(); }
});

for (const kind of ['file', 'directory']) {
  test(`production STDIO starts through a ${kind} symlink`, async (t) => {
    const { directory } = await fixture(t);
    const alias = join(directory, kind === 'file' ? 'server.mjs' : 'project');
    await symlink(fileURLToPath(new URL(kind === 'file' ? '../src/server.mjs' : '../', import.meta.url)), alias, kind === 'file' ? 'file' : 'dir');
    const client = new Client({ name: 'symlink-regression', version: '1.0.0' });
    const transport = new StdioClientTransport({ command: process.execPath,
      args: [kind === 'file' ? alias : join(alias, 'src/server.mjs')], env: {}, stderr: 'pipe' });
    try {
      await client.connect(transport);
      assert.deepEqual((await client.listTools()).tools.map((x) => x.name).sort(), ['get_html', 'hosting_status', 'list_html', 'offline_html', 'online_html', 'publish_html']);
      const missing = await client.callTool({ name: 'hosting_status', arguments: {} });
      assert.equal(missing.structuredContent.code, 'CONFIG_REQUIRED');
    } finally { await client.close(); }
  });
}

test('a subprocess exit after reserving a replacement keeps the active page queryable on restart', async (t) => {
  const { directory, localPath } = await fixture(t);
  let client = await session(directory);
  let first;
  try { first = (await client.callTool({ name: 'publish_html', arguments: { localPath } })).structuredContent; }
  finally { await client.close(); }
  client = await session(directory, undefined, 'COS_CURRENT_PUT');
  try { await assert.rejects(client.callTool({ name: 'publish_html', arguments: { localPath, newPage: true } }), /Connection closed/); }
  finally { await client.close(); }
  client = await session(directory);
  try {
    const response = await client.callTool({ name: 'get_html', arguments: { localPath } });
    assert.equal(response.isError, false);
    const found = response.structuredContent;
    assert.equal(found.siteId, first.siteId);
    assert.equal(found.publicCheck.verified, true);
    assert.notEqual(found.pendingRegistration.siteId, first.siteId);
    assert.equal(found.pendingRegistration.state, 'PENDING');
  } finally { await client.close(); }
});

test('six-tool STDIO lifecycle: publish, URL update, offline, restart, list, restore the same URL', async (t) => {
  const { directory, localPath } = await fixture(t);
  let client = await session(directory);
  let first;
  try {
    first = (await client.callTool({ name: 'publish_html', arguments: { localPath } })).structuredContent;
    await writeFile(localPath, '<html>lifecycle update</html>');
    const found = (await client.callTool({ name: 'get_html', arguments: { siteUrl: first.url } })).structuredContent;
    const updated = await client.callTool({ name: 'publish_html', arguments: { siteUrl: first.url, localPath, expectedSha256: found.sha256 } });
    assert.equal(updated.isError, false);
    assert.equal(updated.structuredContent.url, first.url);
    const offline = await client.callTool({ name: 'offline_html', arguments: { siteUrl: first.url, expectedSha256: updated.structuredContent.sha256 } });
    assert.equal(offline.isError, false);
    assert.equal(offline.structuredContent.cleanup.complete, true);
    const invalid = await client.callTool({ name: 'get_html', arguments: { siteUrl: first.url, siteId: first.siteId } });
    assert.equal(invalid.isError, true);
  } finally { await client.close(); }
  client = await session(directory);
  try {
    const listed = await client.callTool({ name: 'list_html', arguments: { lifecycle: 'offline', limit: 1 } });
    assert.equal(listed.isError, false);
    assert.equal(listed.structuredContent.sites[0].siteId, first.siteId);
    assert.equal(listed.structuredContent.cloudVerified, false);
    const restored = await client.callTool({ name: 'online_html', arguments: { siteUrl: first.url, localPath } });
    assert.equal(restored.isError, false);
    assert.equal(restored.structuredContent.url, first.url);
    assert.equal(restored.structuredContent.lifecycle, 'online');
    assert.equal(restored.structuredContent.versionKey, undefined);
  } finally { await client.close(); }
});

test('process exit after actual deletion retains operation; after confirmed exit and lock removal retry completes', async (t) => {
  const { directory, localPath } = await fixture(t);
  let client = await session(directory);
  let first;
  try { first = (await client.callTool({ name: 'publish_html', arguments: { localPath } })).structuredContent; }
  finally { await client.close(); }
  client = await session(directory, undefined, 'COS_DELETE');
  try {
    await assert.rejects(client.callTool({ name: 'offline_html', arguments: { siteId: first.siteId, expectedSha256: first.sha256 } }), /Connection closed/);
  } finally { await client.close(); }
  client = await session(directory);
  try {
    const listed = (await client.callTool({ name: 'list_html', arguments: {} })).structuredContent;
    assert.equal(listed.sites[0].operation.action, 'offline');
    const busy = await client.callTool({ name: 'offline_html', arguments: { siteId: first.siteId, expectedSha256: first.sha256 } });
    assert.equal(busy.structuredContent.code, 'REGISTRY_BUSY');
  } finally { await client.close(); }
  const { readdir, unlink } = await import('node:fs/promises');
  const pages = join(directory, 'pages');
  for (const name of (await readdir(pages)).filter((n) => n.endsWith('.lock'))) await unlink(join(pages, name));
  client = await session(directory);
  try {
    const retried = await client.callTool({ name: 'offline_html', arguments: { siteId: first.siteId, expectedSha256: first.sha256 } });
    assert.equal(retried.isError, false);
    assert.equal(retried.structuredContent.cleanup.complete, true);
    assert.equal((await client.callTool({ name: 'online_html', arguments: { siteId: first.siteId, localPath } })).isError, false);
  } finally { await client.close(); }
});

test('STDIO exposes only current path selectors and keeps known-ID queries usable with a broken catalogue', async (t) => {
  const { PageRegistry } = await import('../src/registry.mjs');
  const { scope } = await import('./helpers.mjs');
  const { readFile } = await import('node:fs/promises');
  const { directory, localPath } = await fixture(t);
  const client = await session(directory);
  try {
    const first = (await client.callTool({ name: 'publish_html', arguments: { localPath } })).structuredContent;
    const second = (await client.callTool({ name: 'publish_html', arguments: { localPath, newPage: true } })).structuredContent;
    const listed = (await client.callTool({ name: 'list_html', arguments: {} })).structuredContent;
    assert.deepEqual(listed.sites.find((s) => s.siteId === first.siteId).localPaths, []);
    assert.deepEqual(listed.sites.find((s) => s.siteId === first.siteId).sourcePaths, [localPath]);
    assert.deepEqual(listed.sites.find((s) => s.siteId === second.siteId).localPaths, [localPath]);
    const file = new PageRegistry(join(directory, 'pages'), scope).file;
    await writeFile(file, '{broken');
    for (const selector of [{ siteId: first.siteId }, { siteUrl: first.url }]) {
      const queried = await client.callTool({ name: 'get_html', arguments: selector });
      assert.equal(queried.isError, false);
      assert.equal(queried.structuredContent.sha256, first.sha256);
      assert.deepEqual(queried.structuredContent.registryDiagnostic, { state: 'UNAVAILABLE', code: 'REGISTRY_CORRUPT' });
    }
    const write = await client.callTool({ name: 'offline_html', arguments: { siteId: first.siteId, expectedSha256: first.sha256 } });
    assert.equal(write.isError, true);
    assert.equal(write.structuredContent.code, 'REGISTRY_CORRUPT');
    const byPath = await client.callTool({ name: 'get_html', arguments: { localPath } });
    assert.equal(byPath.isError, true);
    assert.equal(await readFile(file, 'utf8'), '{broken');
  } finally { await client.close(); }
});
