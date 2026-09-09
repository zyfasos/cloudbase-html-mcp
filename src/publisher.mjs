import { open } from 'node:fs/promises';
import { isAbsolute, extname } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { PublishError, readLimited } from './cloudbase.mjs';
import { accessCandidates, parseSiteUrl, validateSiteUrl } from './domains.mjs';
import { currentKey, cleanupSnapshots } from './cleanup.mjs';
import { publicRecovery } from './recovery.mjs';

export const MAX_HTML_BYTES = 5 * 1024 * 1024;
export const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
export function validateSiteId(siteId) {
  if (!/^s-[0-9a-f]{32}$/.test(siteId ?? '')) throw new PublishError('INPUT', 'INVALID_SITE_ID');
}

function registeredSiteUrl(site) {
  try {
    const parsed = parseSiteUrl(site?.url);
    return parsed.siteId === site.siteId ? parsed.url : undefined;
  } catch { return undefined; }
}

export async function loadHtml(localPath) {
  if (!isAbsolute(localPath) || !['.html', '.htm'].includes(extname(localPath).toLowerCase())) {
    throw new PublishError('INPUT', 'ABSOLUTE_HTML_PATH_REQUIRED');
  }
  let handle;
  try {
    handle = await open(localPath, 'r');
    const stat = await handle.stat();
    if (!stat.isFile() || stat.size === 0 || stat.size > MAX_HTML_BYTES) throw new PublishError('INPUT', 'INVALID_FILE_SIZE');
    const buffer = Buffer.alloc(MAX_HTML_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length === 0 || length > MAX_HTML_BYTES) throw new PublishError('INPUT', 'INVALID_FILE_SIZE');
    const bytes = buffer.subarray(0, length);
    let html;
    try { html = new TextDecoder('utf-8', { fatal: true }).decode(bytes); }
    catch { throw new PublishError('INPUT', 'UTF8_REQUIRED'); }
    if (!/<html[\s>]/i.test(html)) throw new PublishError('INPUT', 'HTML_DOCUMENT_REQUIRED');
    // This is a dependency warning, not a security scanner or HTML sanitizer.
    const warnings = [];
    const refs = [...html.matchAll(/<(?:script|img|link|iframe|source)\b[^>]*\b(?:src|href)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)]
      .map((match) => match[1] ?? match[2] ?? match[3]);
    refs.push(...[...html.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)].map((match) => match[1].trim()));
    if (refs.some((ref) => !/^(https?:|data:|\/\/|#)/i.test(ref))) {
      warnings.push('检测到可能的相对资源引用；本工具仅上传此 HTML，关联文件不会一起上传。');
    }
    return { bytes, warnings };
  } catch (error) {
    if (error instanceof PublishError) throw error;
    throw new PublishError('INPUT', 'FILE_NOT_READABLE');
  } finally { await handle?.close(); }
}

export async function verifyPublic(url, expectedHash, fetcher = fetch) {
  try {
    const target = new URL(url);
    target.searchParams.set('v', expectedHash);
    const response = await fetcher(target, { redirect: 'error', signal: AbortSignal.timeout(15_000), headers: { 'Cache-Control': 'no-cache' } });
    const type = response.headers.get('content-type') ?? '';
    const attachment = /attachment/i.test(response.headers.get('content-disposition') ?? '');
    if (!response.ok) {
      await response.body?.cancel();
      return { verified: false, httpStatus: response.status, reason: 'HTTP_ERROR' };
    }
    const hashMatches = sha256(await readLimited(response, MAX_HTML_BYTES)) === expectedHash;
    const htmlResponse = type.toLowerCase().includes('text/html');
    const defaultDomainNotice = hashMatches && htmlResponse && attachment && target.hostname.endsWith('.tcloudbaseapp.com');
    return { verified: hashMatches && htmlResponse && !attachment,
      defaultDomainNotice, httpStatus: response.status, hashMatches, contentType: type, attachment };
  } catch {
    return { verified: false, reason: 'PUBLIC_FETCH_FAILED' };
  }
}

export async function verifyAccess(store, key, expectedHash, fetcher = fetch) {
  const access = accessCandidates(store, key);
  const attempts = [];
  let chosen;
  for (const candidate of access.candidates) {
    const publicCheck = await verifyPublic(candidate.url, expectedHash, fetcher);
    const attempt = { ...candidate, publicCheck };
    attempts.push(attempt);
    chosen ??= attempt;
    if (publicCheck.verified) { chosen = attempt; break; }
    if (publicCheck.defaultDomainNotice) chosen = attempt;
  }
  return { url: chosen?.url, urlSource: chosen?.source,
    publicCheck: chosen?.publicCheck ?? { verified: false, reason: 'NO_ACCESS_CANDIDATE' },
    access: { ...access, attempts } };
}

export class Publisher {
  constructor(backend, fetcher = fetch, registry = null) {
    this.backend = backend; this.fetcher = fetcher; this.registry = registry; this.busy = false;
  }

  requireRegistry() {
    if (!this.registry) throw new PublishError('REGISTRY', 'REGISTRY_DISABLED');
  }

  async target(args, catalog, { optionalMetadata = false } = {}) {
    const selectors = ['siteId', 'siteUrl', 'localPath'].filter((k) => args[k] !== undefined);
    if (selectors.length !== 1) throw new PublishError('INPUT', 'ONE_PAGE_SELECTOR_REQUIRED');
    let siteId = args.siteId;
    let registration;
    let store;
    if (args.localPath !== undefined) {
      this.requireRegistry();
      registration = catalog ? this.registry.project(catalog, this.registry.entry(args.localPath).localPath) : await this.registry.lookup(args.localPath);
      if (!registration) throw new PublishError('REGISTRY', 'LOCAL_PAGE_NOT_FOUND');
      siteId = registration.siteId;
    }
    if (args.siteUrl !== undefined) {
      const parsed = parseSiteUrl(args.siteUrl);
      store = await this.backend.connect();
      siteId = validateSiteUrl(store, parsed);
      store = { ...store, configuredBaseUrl: parsed.origin };
    }
    validateSiteId(siteId);
    let site;
    let registryDiagnostic;
    try { site = catalog ? catalog.sites[siteId] : await this.registry?.lookupSite(siteId); }
    catch (error) {
      if (!optionalMetadata || args.localPath !== undefined || !(error instanceof PublishError) || error.stage !== 'REGISTRY') throw error;
      registryDiagnostic = { state: 'UNAVAILABLE', code: error.code };
    }
    return { siteId, site, registration, store, registryDiagnostic };
  }

  async publish(args) { return this.write(args, false); }
  async online(args) { this.requireRegistry(); return this.write(args, true); }

  async write({ localPath, siteId, siteUrl, expectedSha256, newPage = false }, restoring) {
    if (this.busy) throw new PublishError('PUBLISH', 'PUBLISH_BUSY');
    this.busy = true;
    let context;
    let registration;
    const pathBinding = () => {
      if (!registration) return {};
      const path = this.registry.entry(localPath).localPath;
      const binding = registration.catalog.bindings[path];
      return { pathBinding: { localPath: path, defaultSiteId: binding?.siteId ?? null,
        pendingSiteId: binding?.pendingSiteId ?? null, matchesTarget: binding?.siteId === siteId } };
    };
    const registryWarnings = [];
    const action = restoring ? 'online' : 'publish';
    try {
      const { bytes, warnings } = await loadHtml(localPath);
      if (siteId !== undefined && siteUrl !== undefined) throw new PublishError('INPUT', 'ONE_PAGE_SELECTOR_REQUIRED');
      if (newPage && (siteId || siteUrl)) throw new PublishError('INPUT', 'NEW_PAGE_WITH_SITE_ID');
      if (expectedSha256 && !siteId && !siteUrl) throw new PublishError('INPUT', 'EXPECTED_HASH_WITHOUT_SITE_ID');
      if (siteUrl) parseSiteUrl(siteUrl);
      registration = await this.registry?.acquire(localPath);
      const bound = registration?.record;
      if (!siteId && !siteUrl && !newPage && bound) {
        siteId = bound.siteId;
        throw new PublishError('REGISTRY', bound.lifecycle === 'offline' ? 'PAGE_OFFLINE' : 'LOCAL_SITE_EXISTS',
          { siteId: bound.siteId, pendingRegistration: bound.pending });
      }
      if (restoring && !siteId && !siteUrl) throw new PublishError('INPUT', 'ONE_PAGE_SELECTOR_REQUIRED');
      let selected;
      if (siteId || siteUrl) selected = await this.target(siteUrl ? { siteUrl } : { siteId }, registration?.catalog);
      siteId = selected?.siteId ?? 's-' + randomUUID().replaceAll('-', '');
      context = { siteId, writeState: 'NOT_STARTED' };
      const site = selected?.site;
      if (restoring) {
        if (!site) throw new PublishError('REGISTRY', 'LOCAL_PAGE_NOT_FOUND');
        if (site.lifecycle !== 'offline') throw new PublishError('PUBLISH', 'PAGE_NOT_OFFLINE', { siteId });
        if (site.operation && site.operation.action !== 'online') throw new PublishError('PUBLISH', 'CLEANUP_PENDING', { siteId });
      } else if (site?.lifecycle === 'offline' || site?.operation?.action === 'offline') {
        throw new PublishError('PUBLISH', 'PAGE_OFFLINE', { siteId });
      }
      const existing = Boolean(selected);
      if (existing && !restoring && !/^[0-9a-f]{64}$/.test(expectedSha256 ?? '')) {
        throw new PublishError('INPUT', 'EXPECTED_HASH_REQUIRED', { siteId });
      }
      const store = selected?.store ?? await this.backend.connect();
      const hash = sha256(bytes);
      const key = currentKey(siteId);
      context = { siteId, sha256: hash, url: accessCandidates(store, key).candidates[0]?.url, writeState: 'NOT_STARTED' };
      const current = await this.backend.head(key);
      if (restoring) {
        const recovering = site.operation?.action === 'online' && site.operation.sha256 === hash;
        if (current && !(recovering && current.sha256 === hash)) throw new PublishError('PUBLISH', 'VERSION_CONFLICT');
      } else {
        if (existing && !current) throw new PublishError('PUBLISH', 'SITE_NOT_FOUND');
        if ((!existing && current) || (existing && current.sha256 !== expectedSha256 && current.sha256 !== hash)) {
          throw new PublishError('PUBLISH', 'VERSION_CONFLICT');
        }
      }
      await registration?.save({ siteId, sha256: hash, state: 'PENDING', url: context.url, action, newPage });
      if (current?.sha256 !== hash) {
        context.writeState = 'CURRENT_WRITE_ATTEMPTED';
        await this.backend.put(key, bytes, hash, 'COS_CURRENT_PUT');
      } else context.writeState = 'UNCHANGED';
      const head = await this.backend.head(key);
      if (head?.sha256 !== hash || head.bytes !== bytes.length) throw new PublishError('COS_HEAD', 'VERIFY_MISMATCH');
      context.writeState = 'STORAGE_VERIFIED';
      context.lifecycle = 'online';
      const verified = await verifyAccess(store, key, hash, this.fetcher);
      let registryState = registration ? 'SAVED' : 'DISABLED';
      try { await registration?.save({ siteId, sha256: hash, state: 'STORAGE_VERIFIED', lifecycle: 'online', url: verified.url ?? context.url, action, newPage }); }
      catch { registryState = 'UPDATE_FAILED'; registryWarnings.push('云端存储已验证，但本地登记状态更新失败。保留 siteId，查询实际状态后重试原操作。'); }
      const { publicCheck } = verified;
      return { ...context, ...verified, ...pathBinding(), status: publicCheck.verified ? 'PUBLISHED' : publicCheck.defaultDomainNotice ? 'PUBLISHED_PREVIEW' : 'UPLOADED_NOT_PUBLICLY_VERIFIED',
        bytes: bytes.length, warnings, registry: { state: registryState, warnings: registryWarnings }, ...publicRecovery(siteId, publicCheck) };
    } catch (error) {
      if (context && context.writeState !== 'NOT_STARTED' && registration) {
        try { await registration.save({ siteId: context.siteId, sha256: context.sha256, state: 'UNCERTAIN', action, newPage }); }
        catch { registryWarnings.push('本地状态写入失败；核对云端后重试原操作。'); }
      }
      if (error instanceof PublishError) {
        error.details = { ...error.details, ...context, ...pathBinding(), registryWarnings, operation: action };
        throw error;
      }
      throw new PublishError('PUBLISH', 'FAILED', { ...context, ...pathBinding(), registryWarnings, operation: action });
    } finally {
      try { await registration?.release(); }
      catch { registryWarnings.push('登记锁释放失败；确认无其他写入进程后处理遗留锁。'); }
      this.busy = false;
    }
  }

  async get(input) {
    const selected = await this.target(typeof input === 'string' ? { siteId: input } : input, undefined, { optionalMetadata: true });
    const { siteId, site, registration, registryDiagnostic } = selected;
    const store = selected.store ?? await this.backend.connect();
    const head = await this.backend.head(currentKey(siteId));
    if (!head) {
      if (site?.lifecycle === 'offline') return { siteId, lifecycle: 'offline', observedStorage: 'absent',
        sha256: site.sha256, url: registeredSiteUrl(site), operation: site.operation, registryState: site.state,
        publicCheck: { verified: false, reason: 'OFFLINE' }, cleanup: { complete: !site.operation } };
      throw new PublishError('QUERY', 'SITE_NOT_FOUND', { siteId, registrationState: site?.state, operation: site?.operation,
        pendingRegistration: registration?.pending, registryDiagnostic });
    }
    const verified = await verifyAccess(store, currentKey(siteId), head.sha256, this.fetcher);
    return { siteId, ...head, ...verified, lifecycle: 'online', registeredLifecycle: site?.lifecycle ?? null,
      observedStorage: 'present', operation: site?.operation, registrationState: site?.state, pendingRegistration: registration?.pending,
      registryDiagnostic,
      ...publicRecovery(siteId, verified.publicCheck) };
  }

  async list(args) {
    this.requireRegistry();
    const result = await this.registry.list(args);
    return { ...result, sites: result.sites.map((site) => ({ ...site, ...(site.url ? { url: registeredSiteUrl(site) } : {}) })) };
  }

  async offline(args) {
    this.requireRegistry();
    if (this.busy) throw new PublishError('PUBLISH', 'PUBLISH_BUSY');
    if (!/^[0-9a-f]{64}$/.test(args.expectedSha256 ?? '')) throw new PublishError('INPUT', 'EXPECTED_HASH_REQUIRED');
    this.busy = true;
    let lock;
    let siteId;
    let url;
    let deletedCurrent = false;
    let reserved = false;
    let deleteAttempted = false;
    let before;
    const warnings = [];
    try {
      lock = await this.registry.acquire();
      const selector = Object.fromEntries(['siteId', 'siteUrl', 'localPath'].filter((k) => args[k] !== undefined).map((k) => [k, args[k]]));
      const selected = await this.target(selector, lock.catalog);
      siteId = selected.siteId;
      const site = selected.site;
      const store = selected.store ?? await this.backend.connect();
      url = registeredSiteUrl(site) ?? accessCandidates(store, currentKey(siteId)).candidates[0]?.url;
      await this.backend.assertDeletionSafe();
      // Preserve the intended hash before checking/deleting; retries use the same precondition.
      if (site?.operation && site.operation.action !== 'offline') throw new PublishError('PUBLISH', 'OPERATION_PENDING');
      if (site?.operation && site.operation.sha256 !== args.expectedSha256) throw new PublishError('PUBLISH', 'VERSION_CONFLICT');
      before = structuredClone(lock.catalog);
      await lock.saveSite({ siteId, sha256: args.expectedSha256, state: 'PENDING', action: 'offline', url });
      reserved = true;
      const key = currentKey(siteId);
      const current = await this.backend.head(key);
      if (current && current.sha256 !== args.expectedSha256) throw new PublishError('PUBLISH', 'VERSION_CONFLICT');
      if (!current && !site) throw new PublishError('QUERY', 'SITE_NOT_FOUND');
      if (current) { deleteAttempted = true; await this.backend.deleteCurrent(key); }
      if (await this.backend.head(key)) throw new PublishError('COS_DELETE', 'DELETE_INCOMPLETE');
      deletedCurrent = true;
      await lock.saveSite({ siteId, sha256: args.expectedSha256, state: 'PENDING', lifecycle: 'offline', action: 'offline', url });
      const cleanup = await cleanupSnapshots(this.backend, siteId);
      // Detect a concurrent external writer before claiming the lifecycle is offline.
      if (await this.backend.head(key)) { deletedCurrent = false; throw new PublishError('COS_DELETE', 'VERSION_CONFLICT'); }
      let registryState = 'SAVED';
      try { await lock.saveSite({ siteId, sha256: args.expectedSha256, state: 'STORAGE_VERIFIED', lifecycle: 'offline', action: 'offline', url }); }
      catch { registryState = 'UPDATE_FAILED'; warnings.push('云端删除已验证，但本地最终登记失败；重试下线以完成本地确认。'); }
      return { siteId, lifecycle: 'offline', url, sha256: args.expectedSha256, observedStorage: 'absent', cleanup,
        publicCheck: { verified: false, reason: 'DELETION_DOES_NOT_PURGE_EXTERNAL_CACHES' }, registry: { state: registryState, warnings } };
    } catch (e) {
      if (reserved && !deleteAttempted && !deletedCurrent) {
        try { await this.registry.writeCatalog(before); } catch { warnings.push('预检查失败且本地登记恢复失败；需核对登记。'); }
      } else if (reserved) {
        try { await lock.saveSite({ siteId, sha256: args.expectedSha256, state: 'UNCERTAIN', action: 'offline', url,
          ...(deletedCurrent ? { lifecycle: 'offline' } : {}) }); }
        catch { warnings.push('本地状态写入失败；先核对云端，再重试下线。'); }
      }
      const error = e instanceof PublishError ? e : new PublishError('COS_DELETE', 'FAILED');
      error.details = { ...error.details, siteId, url, operation: 'offline', expectedSha256: args.expectedSha256,
        ...(deletedCurrent ? { lifecycle: 'offline', observedStorage: 'absent' } : {}),
        cleanup: { complete: false }, registryWarnings: warnings };
      throw error;
    } finally {
      try { await lock?.release(); } catch { warnings.push('登记锁释放失败，需确认写入者退出后处理。'); }
      this.busy = false;
    }
  }
}
