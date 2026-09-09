import test from 'node:test';
import assert from 'node:assert/strict';
import { PublishError } from '../src/cloudbase.mjs';
import { recoveryFor, publicRecovery } from '../src/recovery.mjs';

const siteId = `s-${'a'.repeat(32)}`;
test('cold-start guidance supplies local and remote setup entries without passing credentials as tool arguments', () => {
  for (const error of [
    new PublishError('CONFIG', 'CONFIG_REQUIRED', { missing: ['CLOUDBASE_ENV_ID', 'CLOUDBASE_REGION', 'CLOUDBASE_API_KEY'] }),
    new PublishError('CONFIG', 'INVALID_ENV_OR_REGION'),
    new PublishError('CREDENTIAL_EXCHANGE', 'HTTP_403'),
  ]) {
    const recovery = recoveryFor(error);
    assert.equal(recovery.next_step.setup_guide.local_path, 'docs/getting-started.md');
    assert.equal(new URL(recovery.next_step.setup_guide.url).hostname, 'github.com');
    assert.equal(new URL(recovery.next_step.setup_guide.console_url).hostname, 'tcb.cloud.tencent.com');
    assert.equal(recovery.next_step.tool, 'hosting_status');
    assert.deepEqual(recovery.next_step.suggested_args, {});
    assert.equal(recovery.retryable, false);
    assert.equal(recovery.maxRetries, 0);
  }
});

test('unavailable hosting directs inspection of the selected environment without assuming it must be created', () => {
  for (const code of ['INVALID_RESOURCE', 'NOT_ONLINE']) {
    const recovery = recoveryFor(new PublishError('STATIC_STORE', code));
    assert.equal(recovery.next_step.action, 'check_static_hosting');
    assert.equal(recovery.next_step.setup_guide.local_path, 'docs/getting-started.md');
    assert.equal(recovery.next_step.tool, 'hosting_status');
    assert.deepEqual(recovery.next_step.suggested_args, {});
    assert.equal(recovery.retryable, false);
  }
  assert.equal(recoveryFor(new PublishError('STATIC_STORE', 'AccessDenied')).next_step.action, 'check_access');
});

test('every partial-write stage directs a read before any retry', () => {
  for (const writeState of ['VERSION_WRITE_ATTEMPTED', 'CURRENT_WRITE_ATTEMPTED', 'STORAGE_VERIFIED']) {
    const recovery = recoveryFor(new PublishError('COS_CURRENT_PUT', 'AccessDenied', { siteId, writeState }));
    assert.equal(recovery.retryable, false);
    assert.equal(recovery.maxRetries, 0);
    assert.equal(recovery.next_step.tool, 'get_html');
    assert.deepEqual(recovery.next_step.suggested_args, { siteId });
  }
});

test('configuration, credentials, conflict, missing registration, and busy have distinct bounded actions', () => {
  const config = recoveryFor(new PublishError('CONFIG', 'CONFIG_REQUIRED', { missing: ['CLOUDBASE_API_KEY'] }));
  assert.equal(config.next_step.action, 'configure_environment');
  assert.deepEqual(config.next_step.suggested_args, {});
  assert.deepEqual(config.next_step.required_config, ['CLOUDBASE_API_KEY']);
  assert.equal(config.next_step.required_params, undefined);
  assert.equal(recoveryFor(new PublishError('CREDENTIAL_EXCHANGE', 'HTTP_403')).next_step.action, 'check_credentials');
  const conflict = recoveryFor(new PublishError('PUBLISH', 'VERSION_CONFLICT', { siteId }));
  assert.equal(conflict.next_step.action, 'inspect_before_update');
  assert.equal(conflict.next_step.tool, 'get_html');
  assert.equal(recoveryFor(new PublishError('REGISTRY', 'LOCAL_PAGE_NOT_FOUND')).next_step.action, 'locate_page');
  const busy = recoveryFor(new PublishError('PUBLISH', 'PUBLISH_BUSY'), { localPath: '/tmp/page.html' }, 'publish_html');
  assert.equal(busy.maxRetries, 1);
  assert.equal(busy.next_step.tool, 'publish_html');
});

test('unverified public URL suggests a read while verified preview explains the interstitial', () => {
  assert.deepEqual(publicRecovery(siteId, { verified: true }), {});
  const failed = publicRecovery(siteId, { verified: false });
  assert.equal(failed.next_step.tool, 'get_html');
  assert.equal(failed.next_step.maxAttempts, 1);
  const preview = publicRecovery(siteId, { verified: false, defaultDomainNotice: true });
  assert.equal(preview.next_step.action, 'open_preview');
  assert.equal(preview.retryable, false);
});
