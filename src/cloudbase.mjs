import COS from 'cos-nodejs-sdk-v5';
import tcbSdk from 'tencentcloud-sdk-nodejs-tcb';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { discoverDomains } from './domains.mjs';
import { PublishError } from './errors.mjs';
export { PublishError } from './errors.mjs';

const safeCode = (value) => /^[A-Za-z0-9_.-]{1,100}$/.test(value ?? '') ? value : undefined;

export async function guarded(stage, fn) {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof PublishError) throw error;
    throw new PublishError(stage, safeCode(error.code) ?? 'REQUEST_FAILED', {
      httpStatus: Number(error.statusCode) || undefined,
      requestId: safeCode(error.requestId ?? error.headers?.['x-cos-request-id']),
    });
  }
}

export function readConfig(env = process.env) {
  const fields = ['CLOUDBASE_ENV_ID', 'CLOUDBASE_REGION', 'CLOUDBASE_API_KEY'];
  const missing = fields.filter((key) => !env[key]?.trim());
  if (missing.length) throw new PublishError('CONFIG', 'CONFIG_REQUIRED', { missing });
  const envId = env.CLOUDBASE_ENV_ID.trim();
  const region = env.CLOUDBASE_REGION.trim();
  if (!/^[a-zA-Z0-9-]{1,64}$/.test(envId) || !/^[a-z0-9-]{2,32}$/.test(region)) {
    throw new PublishError('CONFIG', 'INVALID_ENV_OR_REGION');
  }
  const registryDir = env.CLOUDBASE_REGISTRY_DIR?.trim() || join(homedir(), '.config', 'cloudbase-html-mcp', 'pages');
  if (registryDir !== 'off' && !isAbsolute(registryDir)) throw new PublishError('CONFIG', 'ABSOLUTE_REGISTRY_PATH_REQUIRED');
  return { envId, region, apiKey: env.CLOUDBASE_API_KEY.trim(),
    publicBaseUrl: env.CLOUDBASE_PUBLIC_BASE_URL?.trim(), registryDir: registryDir === 'off' ? null : registryDir };
}

export async function readLimited(response, limit) {
  if (Number(response.headers.get('content-length')) > limit) {
    await response.body?.cancel();
    throw new PublishError('HTTP', 'RESPONSE_TOO_LARGE');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of response.body ?? []) {
    size += chunk.length;
    if (size > limit) throw new PublishError('HTTP', 'RESPONSE_TOO_LARGE');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export class Credentials {
  constructor(config, fetcher = fetch, clock = Date.now) {
    this.config = config;
    this.fetcher = fetcher;
    this.clock = clock;
  }

  async get() {
    if (this.cached?.expires - this.clock() > 300_000) return this.cached;
    if (!this.pending) this.pending = this.exchange().finally(() => { this.pending = null; });
    return this.pending;
  }

  async exchange() {
    return guarded('CREDENTIAL_EXCHANGE', async () => {
      const { envId, region, apiKey } = this.config;
      const response = await this.fetcher(`https://${envId}.${region}.tcb-api.tencentcloudapi.com/capi/credential`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15_000),
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ env: envId }),
      });
      if (!response.ok) {
        await response.body?.cancel();
        throw new PublishError('CREDENTIAL_EXCHANGE', `HTTP_${response.status}`);
      }
      const body = JSON.parse((await readLimited(response, 65536)).toString('utf8'));
      const data = body.data;
      if (body.code !== 0 || !['TmpSecretId', 'TmpSecretKey', 'Token'].every((k) => typeof data?.[k] === 'string' && data[k]) ||
          !Number.isFinite(data.ExpiredTime) || data.ExpiredTime * 1000 - this.clock() < 30_000) {
        throw new PublishError('CREDENTIAL_EXCHANGE', 'INVALID_RESPONSE');
      }
      this.cached = { secretId: data.TmpSecretId, secretKey: data.TmpSecretKey, token: data.Token, expires: data.ExpiredTime * 1000 };
      return this.cached;
    });
  }
}

export function baseUrl(value) {
  try {
    const url = new URL(value.includes('://') ? value : `https://${value}`);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error();
    return url.origin;
  } catch {
    throw new PublishError('STATIC_STORE', 'INVALID_PUBLIC_DOMAIN');
  }
}

export class CloudBase {
  constructor(config, clientFactory = (options) => new tcbSdk.tcb.v20180608.Client(options)) {
    this.config = config;
    this.clientFactory = clientFactory;
    this.credentials = new Credentials(config);
  }

  async connect() {
    const credential = await this.credentials.get();
    return guarded('STATIC_STORE', async () => {
      const client = this.clientFactory({
        credential: { secretId: credential.secretId, secretKey: credential.secretKey, token: credential.token },
        region: this.config.region,
        profile: { httpProfile: { endpoint: 'tcb.tencentcloudapi.com', reqTimeout: 15 } },
      });
      const result = await client.DescribeStaticStore({ EnvId: this.config.envId });
      const store = result.Data?.find((s) => s.EnvId === this.config.envId);
      if (!store || !/^[a-z0-9-]{3,63}$/.test(store.Bucket ?? '') ||
          !/^[a-z0-9-]{2,32}$/.test(store.Region ?? store.Regoin ?? '')) {
        throw new PublishError('STATIC_STORE', 'INVALID_RESOURCE');
      }
      if (store.Status?.toLowerCase() !== 'online') throw new PublishError('STATIC_STORE', 'NOT_ONLINE');
      const configuredBaseUrl = this.config.publicBaseUrl ? baseUrl(this.config.publicBaseUrl) : undefined;
      const domainDiscovery = await discoverDomains(client, this.config.envId);
      this.store = { bucket: store.Bucket, region: store.Region ?? store.Regoin,
        baseUrl: configuredBaseUrl || (store.CdnDomain ? baseUrl(store.CdnDomain) : undefined), configuredBaseUrl, domainDiscovery };
      this.cos = new COS({ SecretId: credential.secretId, SecretKey: credential.secretKey,
        SecurityToken: credential.token, Protocol: 'https:', Timeout: 30_000, MaxRetries: 1 });
      return this.store;
    });
  }

  async invoke(method, params) {
    return new Promise((resolve, reject) => this.cos[method]({
      Bucket: this.store.bucket, Region: this.store.region, ...params,
    }, (error, result) => error ? reject(error) : resolve(result)));
  }

  async head(key) {
    return guarded('COS_HEAD', async () => {
      try {
        const data = await this.invoke('headObject', { Key: key });
        return { bytes: Number(data.headers?.['content-length']), sha256: data.headers?.['x-cos-meta-content-sha256'] };
      } catch (error) {
        if (error.statusCode === 404 || error.code === 'NoSuchKey') return null;
        throw error;
      }
    });
  }

  async put(key, bytes, sha256, stage) {
    return guarded(stage, () => this.invoke('putObject', {
      Key: key, Body: bytes, ContentLength: bytes.length,
      ContentType: 'text/html; charset=UTF-8', ContentDisposition: 'inline', CacheControl: 'no-store',
      'x-cos-meta-content-sha256': sha256,
    }));
  }

  async assertDeletionSafe() {
    const result = await guarded('COS_VERSIONING', () => this.invoke('getBucketVersioning', {}));
    if (result.VersioningConfiguration?.Status !== undefined && result.VersioningConfiguration.Status !== '') {
      throw new PublishError('COS_VERSIONING', 'VERSIONING_UNSAFE');
    }
    if (!result.VersioningConfiguration || typeof result.VersioningConfiguration !== 'object') {
      throw new PublishError('COS_VERSIONING', 'VERSIONING_UNCONFIRMED');
    }
  }

  async listObjects(prefix, marker) {
    const data = await guarded('COS_LIST', () => this.invoke('getBucket', { Prefix: prefix, Marker: marker, MaxKeys: 1000 }));
    if (!Array.isArray(data.Contents) || ![true, false, 'true', 'false'].includes(data.IsTruncated)) {
      throw new PublishError('COS_LIST', 'INVALID_LIST_RESPONSE');
    }
    const truncated = data.IsTruncated === true || data.IsTruncated === 'true';
    const nextMarker = truncated ? data.NextMarker || data.Contents.at(-1)?.Key : undefined;
    if (truncated && (!nextMarker || nextMarker <= (marker ?? ''))) throw new PublishError('COS_LIST', 'INVALID_LIST_CURSOR');
    return { objects: data.Contents.map((o) => ({ key: o.Key, bytes: Number(o.Size), etag: o.ETag })), nextMarker };
  }

  async deleteCurrent(key) {
    return guarded('COS_DELETE', () => this.invoke('deleteObject', { Key: key }));
  }

  async deleteObjects(keys) {
    if (!keys.length) return;
    const result = await guarded('COS_DELETE', () => this.invoke('deleteMultipleObject', { Objects: keys.map((Key) => ({ Key })), Quiet: false }));
    const failed = result.Error ?? [];
    const deleted = new Set((result.Deleted ?? []).map((o) => o.Key));
    if (failed.length || keys.some((key) => !deleted.has(key))) {
      throw new PublishError('COS_DELETE', 'DELETE_INCOMPLETE', { failedKeys: keys.filter((key) => !deleted.has(key)) });
    }
  }
}
