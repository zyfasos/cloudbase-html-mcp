import test from 'node:test';
import assert from 'node:assert/strict';
import { accessCandidates, discoverDomains } from '../src/domains.mjs';
import { CloudBase } from '../src/cloudbase.mjs';
import { verifyAccess, sha256 } from '../src/publisher.mjs';
import { html, scope } from './helpers.mjs';

const key = 'sites/s-0123456789abcdef0123456789abcdef/index.html';
const route = (extra = {}) => ({ Path: '/', Enable: true, UpstreamResourceType: 'STATIC_STORE', UpstreamResourceName: 'test-bucket', ...extra });
const domain = (name, extra = {}, routes = [route()]) => ({ Domain: name, Enable: true, Status: 'SUCCESS', Routes: routes, ...extra });
const store = (domains, extra = {}) => ({ bucket: 'test-bucket', baseUrl: 'https://default.tcloudbaseapp.com',
  domainDiscovery: { state: 'COMPLETE', domains }, ...extra });

test('domain discovery ranks valid custom domains ahead of defaults, deduplicates candidates', () => {
  const result = accessCandidates(store([domain('default.tcloudbaseapp.com', { IsDefault: true }), domain('custom.example')]), key);
  assert.deepEqual(result.candidates.map((x) => x.source), ['gateway.custom', 'gateway.default']);
  assert.equal(result.candidates[0].url, `https://custom.example/${key}`);
});

for (const [name, extra, routes, reason] of [
  ['disabled domain', { Enable: false }, [route()], 'DOMAIN_DISABLED'],
  ['pending domain', { Status: 'PROCESSING' }, [route()], 'DOMAIN_NOT_READY'],
  ['HTTPS downgrade', { Protocol: 'HTTPS_TO_HTTP' }, [route()], 'HTTPS_UNAVAILABLE'],
  ['disabled specific route', {}, [route(), route({ Path: '/sites', Enable: false })], 'ROUTE_DISABLED'],
  ['specific function shadows static route', {}, [route(), route({ Path: '/sites', UpstreamResourceType: 'SCF' })], 'OTHER_UPSTREAM'],
  ['different bucket', {}, [route({ UpstreamResourceName: 'other-bucket' })], 'OTHER_UPSTREAM'],
  ['authenticated route', {}, [route({ EnableAuth: true })], 'ROUTE_REQUIRES_AUTH'],
  ['rewritten path', {}, [route({ PathRewrite: { Prefix: '/other' } })], 'UNSUPPORTED_PATH_REWRITE'],
  ['unknown prefix transmission', {}, [route({ Path: '/sites' })], 'PATH_TRANSMISSION_UNCONFIRMED'],
  ['non-covering sibling prefix', {}, [route({ Path: '/site', EnablePathTransmission: true })], 'NO_COVERING_ROUTE'],
  ['unknown path syntax', {}, [route(), route({ Path: '/sites/*' })], 'UNSUPPORTED_ROUTE_PATH'],
]) {
  test(`domain selection excludes ${name}`, () => {
    const result = accessCandidates(store([domain('custom.example', extra, routes)]), key);
    assert.equal(result.rejected[0].reason, reason);
    assert.equal(result.candidates[0].source, 'hosting.staticDomain');
    assert.equal(result.candidates.some((x) => x.url.includes('custom.example')), false);
  });
}

test('enabled prefix preserves the original object path and accepts the staticstore alias', () => {
  const result = accessCandidates(store([domain('custom.example', {}, [route({ Path: '/sites/', EnablePathTransmission: true, UpstreamResourceName: 'staticstore' })])]), key);
  assert.equal(result.candidates[0].url, `https://custom.example/${key}`);
});

test('empty optional rewrite values do not hide an otherwise valid domain', () => {
  const result = accessCandidates(store([domain('custom.example', {}, [route({ PathRewrite: { Prefix: '' } })])]), key);
  assert.equal(result.candidates[0].source, 'gateway.custom');
});

test('disabled native fallback is not resurrected and explicit configuration is not silently replaced', () => {
  const result = accessCandidates(store([domain('default.tcloudbaseapp.com', { Enable: false })]), key);
  assert.deepEqual(result.candidates, []);
  const configured = accessCandidates(store([domain('custom.example', { Enable: false }), domain('other.example')], { configuredBaseUrl: 'https://custom.example' }), key);
  assert.deepEqual(configured.candidates, []);
});

test('discovery paginates with environment isolation and returns no partial route snapshot', async () => {
  const calls = [];
  const result = await discoverDomains({ DescribeHTTPServiceRoute: async (args) => {
    calls.push(args);
    return { Domains: [domain(`page${args.Offset}.example`)], TotalCount: 2 };
  } }, scope.envId);
  assert.equal(result.state, 'COMPLETE');
  assert.equal(result.domains.length, 2);
  assert.deepEqual(calls.map((x) => [x.EnvId, x.Offset]), [['test-env', 0], ['test-env', 1]]);
  let pages = 0;
  const incomplete = await discoverDomains({ DescribeHTTPServiceRoute: async () => {
    pages++; return { Domains: [domain('same.example')], TotalCount: 9999 };
  } }, scope.envId);
  assert.equal(pages, 3);
  assert.deepEqual(incomplete, { state: 'INCOMPLETE', domains: [] });
});

test('route permission denial preserves hosting connection with explicit diagnostics', async () => {
  const cloud = new CloudBase(scope, () => ({
    DescribeStaticStore: async (args) => {
      assert.equal(args.EnvId, scope.envId);
      return { Data: [{ EnvId: scope.envId, Bucket: 'test-bucket', Region: scope.region, CdnDomain: 'default.tcloudbaseapp.com', Status: 'online' }] };
    },
    DescribeHTTPServiceRoute: async () => { throw Object.assign(new Error('secret must not escape'), { code: 'AccessDenied' }); },
  }));
  cloud.credentials.get = async () => ({ secretId: 'test', secretKey: 'test', token: 'test' });
  const connected = await cloud.connect();
  assert.equal(connected.domainDiscovery.state, 'UNAVAILABLE');
  assert.equal(connected.domainDiscovery.code, 'AccessDenied');
  const access = accessCandidates(connected, key);
  assert.equal(access.candidates[0].source, 'hosting.staticDomain');
  assert.equal(JSON.stringify(access).includes('secret must not escape'), false);
});

test('public probes reject custom wrong content and select verified default preview', async () => {
  const config = store([domain('custom.example')]);
  const result = await verifyAccess(config, key, sha256(html), async (url) => new Response(url.hostname === 'custom.example' ? 'wrong' : html,
    { headers: { 'content-type': 'text/html', ...(url.hostname !== 'custom.example' ? { 'content-disposition': 'attachment' } : {}) } }));
  assert.equal(result.urlSource, 'hosting.staticDomain');
  assert.equal(result.publicCheck.verified, false);
  assert.equal(result.publicCheck.defaultDomainNotice, true);
  assert.equal(result.access.attempts.length, 2);
});

test('public probes are bounded, reserve a platform fallback, and stop on verified success', async () => {
  const config = store(['a', 'b', 'c', 'd'].map((name) => domain(`${name}.example`)));
  let calls = 0;
  const failed = await verifyAccess(config, key, sha256(html), async () => { calls++; return new Response('', { status: 403 }); });
  assert.equal(calls, 3);
  assert.equal(failed.access.truncated, true);
  assert.equal(failed.access.attempts[2].source, 'hosting.staticDomain');
  calls = 0;
  const success = await verifyAccess(config, key, sha256(html), async () => { calls++; return new Response(html, { headers: { 'content-type': 'text/html' } }); });
  assert.equal(calls, 1);
  assert.equal(success.urlSource, 'gateway.custom');
});

test('no allowed domain produces an unverified result without fetching', async () => {
  const result = await verifyAccess(store([domain('default.tcloudbaseapp.com', { Enable: false })]), key, sha256(html), async () => assert.fail('must not fetch'));
  assert.equal(result.url, undefined);
  assert.equal(result.publicCheck.reason, 'NO_ACCESS_CANDIDATE');
});

test('malformed discovery responses fail closed without exposing response text', async () => {
  for (const response of [{ Domains: [null] }, { Domains: [domain('custom.example', {}, [null])] }, { Domains: [], TotalCount: -1 }]) {
    const result = await discoverDomains({ DescribeHTTPServiceRoute: async () => response }, scope.envId);
    assert.equal(result.state, 'UNAVAILABLE');
    assert.deepEqual(result.domains, []);
    assert.equal(result.code, 'ROUTE_LOOKUP_FAILED');
  }
});
