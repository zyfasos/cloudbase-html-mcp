// Explicit test preload only. Production setup/start never reads these test switches.
import assert from 'node:assert/strict';
import tcbSdk from 'tencentcloud-sdk-nodejs-tcb';

globalThis.fetch = async (url, options) => {
  assert.equal(url, 'https://wizard-env.ap-shanghai.tcb-api.tencentcloudapi.com/capi/credential');
  assert.equal(options.method, 'POST');
  assert.equal(options.headers.Authorization, 'Bearer offline-wizard-key');
  assert.equal(options.redirect, 'error');
  if (process.env.TEST_SETUP_FAIL) return new Response('offline-wizard-key', { status: 403 });
  return Response.json({ code: 0, data: { TmpSecretId: 'offline-id', TmpSecretKey: 'offline-secret',
    Token: 'offline-token', ExpiredTime: Math.floor(Date.now() / 1000) + 3600 } });
};
tcbSdk.tcb.v20180608.Client = class {
  constructor(options) {
    assert.equal(options.region, 'ap-shanghai');
    assert.equal(options.credential.secretId, 'offline-id');
  }
  async DescribeStaticStore({ EnvId }) {
    assert.equal(EnvId, 'wizard-env');
    return { Data: [{ EnvId, Bucket: 'offline-bucket', Region: 'ap-shanghai', Status: 'online' }] };
  }
  async DescribeHTTPServiceRoute({ EnvId }) {
    assert.equal(EnvId, 'wizard-env');
    return { Domains: [], TotalCount: 0 };
  }
};
