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
    for (const name of ['publish_html', 'online_html']) {
      assert.match(tools.tools.find((tool) => tool.name === name).inputSchema.properties.localPath.description, /20 MiB/);
    }
    const status = (await client.callTool({ name: 'hosting_status', arguments: {} })).structuredContent;
    assert.equal(status.uploadPermission, 'NOT_TESTED');
    assert.equal(status.publicVerification, 'NOT_TESTED');
    assert.equal(status.registry.enabled, true);
    const missingTarget = await client.callTool({ name: 'online_html', arguments: { localPath } });
    assert.equal(missingTarget.isError, true);
    assert.equal(missingTarget.structuredContent.code, 'ONE_PAGE_SELECTOR_REQUIRED');
    assert.equal(missingTarget.structuredContent.stage, 'INPUT');
    assert.equal(missingTarget.structuredContent.next_step.action, 'select_site');
    const response = await client.callTool({ name: 'publish_html', arguments: { localPath } });
    assert.equal(response.isError, false);
    first = response.structuredContent;
    assert.equal(first.status, 'PUBLISHED');
    assert.equal(first.url, `https://example.com/sites/${first.siteId}/`);
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
    const legacy = (await client.callTool({ name: 'get_html', arguments: { siteUrl: first.url + 'index.html' } })).structuredContent;
    assert.equal(legacy.siteId, first.siteId);
    assert.equal(legacy.url, first.url);
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

test('STDIO restores explicit A after restart without replacing B, then updates A by URL', async (t) => {
  const { directory, localPath } = await fixture(t);
  let client = await session(directory);
  async function call(name, args = {}) {
    const result = await client.callTool({ name, arguments: args });
    assert.equal(result.isError, false, JSON.stringify(result));
    return result.structuredContent;
  }
  let a, b, other;
  try {
    a = await call('publish_html', { localPath });
    b = await call('publish_html', { localPath, newPage: true });
    other = (await call('list_html')).sites.find((s) => s.siteId === b.siteId);
    await call('offline_html', { siteId: a.siteId, expectedSha256: a.sha256 });
  } finally { await client.close(); }
  client = await session(directory);
  try {
    const restored = await call('online_html', { siteId: a.siteId, localPath });
    assert.equal(restored.url, a.url);
    assert.equal(restored.pathBinding.defaultSiteId, b.siteId);
    await writeFile(localPath, '<html>updated A while B stays unchanged</html>');
    const stale = (await client.callTool({ name: 'publish_html', arguments: { siteUrl: a.url, localPath, expectedSha256: '0'.repeat(64) } })).structuredContent;
    assert.equal(stale.code, 'VERSION_CONFLICT');
    assert.equal(stale.siteId, a.siteId);
    assert.equal(stale.pathBinding.defaultSiteId, b.siteId);
    assert.deepEqual(stale.next_step.suggested_args, { siteId: a.siteId });
    const current = await call('get_html', { siteUrl: a.url });
    const updated = await call('publish_html', { siteUrl: a.url, localPath, expectedSha256: current.sha256 });
    assert.equal(updated.url, a.url);
    assert.notEqual(updated.sha256, b.sha256);
    assert.equal((await call('get_html', { localPath })).siteId, b.siteId);
    assert.equal((await call('get_html', { siteId: b.siteId })).sha256, b.sha256);
    assert.deepEqual((await call('list_html')).sites.find((s) => s.siteId === b.siteId), other);
  } finally { await client.close(); }
});

test('restore process exit keeps A pending and B bound; confirmed-exit lock recovery resumes A', async (t) => {
  const { readFile, unlink } = await import('node:fs/promises');
  const { PageRegistry } = await import('../src/registry.mjs');
  const { scope } = await import('./helpers.mjs');
  const { directory, localPath } = await fixture(t);
  const registry = new PageRegistry(join(directory, 'pages'), scope);
  let client = await session(directory), a, b;
  try {
    a = (await client.callTool({ name: 'publish_html', arguments: { localPath } })).structuredContent;
    b = (await client.callTool({ name: 'publish_html', arguments: { localPath, newPage: true } })).structuredContent;
    assert.equal((await client.callTool({ name: 'offline_html', arguments: { siteId: a.siteId, expectedSha256: a.sha256 } })).isError, false);
  } finally { await client.close(); }
  const before = JSON.parse(await readFile(registry.file, 'utf8'));
  client = await session(directory, undefined, 'COS_CURRENT_PUT');
  try {
    await assert.rejects(client.callTool({ name: 'online_html', arguments: { siteId: a.siteId, localPath } }), /Connection closed/);
  } finally { await client.close(); }
  const interrupted = JSON.parse(await readFile(registry.file, 'utf8'));
  assert.deepEqual(interrupted.bindings, before.bindings);
  assert.deepEqual(interrupted.sites[b.siteId], before.sites[b.siteId]);
  assert.equal(interrupted.sites[a.siteId].operation.action, 'online');
  client = await session(directory);
  try {
    assert.equal((await client.callTool({ name: 'get_html', arguments: { localPath } })).structuredContent.siteId, b.siteId);
    assert.equal((await client.callTool({ name: 'online_html', arguments: { siteId: a.siteId, localPath } })).structuredContent.code, 'REGISTRY_BUSY');
  } finally { await client.close(); }
  // Only this isolated fixture's exited process owned the lock; do not edit its catalogue.
  await unlink(registry.file + '.lock');
  client = await session(directory);
  try {
    const restored = await client.callTool({ name: 'online_html', arguments: { siteId: a.siteId, localPath } });
    assert.equal(restored.isError, false);
    assert.equal(restored.structuredContent.url, a.url);
    assert.equal(restored.structuredContent.pathBinding.defaultSiteId, b.siteId);
  } finally { await client.close(); }
});

test('STDIO online preflight diagnoses missing files, missing registrations and locks without publishing', async (t) => {
  const { PageRegistry } = await import('../src/registry.mjs');
  const { scope } = await import('./helpers.mjs');
  const { access } = await import('node:fs/promises');
  const { directory, localPath } = await fixture(t);
  const client = await session(directory);
  const siteId = 's-' + 'a'.repeat(32);
  try {
    const missing = (await client.callTool({ name: 'online_html', arguments: { siteId, localPath: join(directory, 'missing.html') } })).structuredContent;
    assert.equal(missing.code, 'FILE_NOT_READABLE');
    assert.equal(missing.next_step.action, 'correct_input');
    const unknown = (await client.callTool({ name: 'online_html', arguments: { siteId, localPath } })).structuredContent;
    assert.equal(unknown.code, 'LOCAL_PAGE_NOT_FOUND');
    assert.equal(unknown.next_step.action, 'locate_offline_registration');
    assert.deepEqual(unknown.next_step.suggested_args, { siteId });
    const lock = await new PageRegistry(join(directory, 'pages'), scope).acquire();
    try {
      const busy = (await client.callTool({ name: 'online_html', arguments: { siteUrl: `https://example.com/sites/${siteId}/`, localPath } })).structuredContent;
      assert.equal(busy.code, 'REGISTRY_BUSY');
      assert.equal(busy.next_step.action, 'inspect_local_registry');
      assert.match(busy.next_step.message, /遗留锁/);
      const offlineBusy = (await client.callTool({ name: 'offline_html', arguments: { siteId, expectedSha256: '0'.repeat(64) } })).structuredContent;
      assert.equal(offlineBusy.code, 'REGISTRY_BUSY');
      assert.match(offlineBusy.next_step.message, /遗留锁/);
      assert.equal(offlineBusy.next_step.resume, undefined);
    } finally { await lock.release(); }
    assert.equal((await client.callTool({ name: 'list_html', arguments: {} })).structuredContent.total, 0);
    await assert.rejects(access(join(directory, 'fake-cloud.json')), { code: 'ENOENT' });
  } finally { await client.close(); }
});
