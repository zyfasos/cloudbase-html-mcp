import { mkdir, open, readFile, readdir, realpath, rename, stat, unlink } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { PublishError } from './errors.mjs';

const error = (code) => new PublishError('REGISTRY', code);
const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const validId = (value) => /^s-[0-9a-f]{32}$/.test(value ?? '');
const validHash = (value) => /^[0-9a-f]{64}$/.test(value ?? '');
const states = ['PENDING', 'STORAGE_VERIFIED', 'UNCERTAIN'];
const validPage = (p) => p && validId(p.siteId) && validHash(p.sha256) && states.includes(p.state);
const object = (value) => value && typeof value === 'object' && !Array.isArray(value);

async function outsideRepository(path) {
  let parent = path;
  while (true) {
    try { parent = await realpath(parent); break; }
    catch (e) {
      if (e.code !== 'ENOENT' || parent === dirname(parent)) throw e;
      parent = dirname(parent);
    }
  }
  while (true) {
    try { await stat(join(parent, '.git')); throw error('REGISTRY_INSIDE_REPOSITORY'); }
    catch (e) { if (e.code !== 'ENOENT') throw e; }
    if (parent === dirname(parent)) break;
    parent = dirname(parent);
  }
}

export class PageRegistry {
  constructor(directory, { envId, region }) {
    if (!isAbsolute(directory)) throw error('ABSOLUTE_REGISTRY_PATH_REQUIRED');
    this.directory = resolve(directory);
    this.scope = { envId, region };
    this.file = join(this.directory, hash([envId, region]) + '.catalog-v2.json');
  }

  entry(localPath) {
    if (!isAbsolute(localPath ?? '')) throw new PublishError('INPUT', 'ABSOLUTE_HTML_PATH_REQUIRED');
    const path = resolve(localPath);
    return { localPath: path, file: join(this.directory, hash([this.scope.envId, this.scope.region, path]) + '.json') };
  }

  async readJson(file, limit = 10 * 1024 * 1024) {
    if ((await stat(file)).size > limit) throw error('REGISTRY_CORRUPT');
    try { return JSON.parse(await readFile(file, 'utf8')); }
    catch (e) { if (e instanceof SyntaxError) throw error('REGISTRY_CORRUPT'); throw e; }
  }

  validate(catalog) {
    if (!catalog || catalog.version !== 2 || catalog.envId !== this.scope.envId || catalog.region !== this.scope.region ||
        !object(catalog.sites) || !object(catalog.bindings)) throw error('REGISTRY_CORRUPT');
    for (const [id, p] of Object.entries(catalog.sites)) {
      if (!object(p) || id !== p.siteId || !validId(id) || !(p.sha256 === null || validHash(p.sha256)) ||
          !states.includes(p.state) || ![null, 'online', 'offline'].includes(p.lifecycle) ||
          !Array.isArray(p.localPaths) || p.localPaths.some((v) => typeof v !== 'string' || !isAbsolute(v)) ||
          (p.sourcePaths !== undefined && (!Array.isArray(p.sourcePaths) || p.sourcePaths.some((v) => typeof v !== 'string' || !isAbsolute(v)))) ||
          (p.operation && (!object(p.operation) || !['publish', 'online', 'offline'].includes(p.operation.action) ||
            !validHash(p.operation.sha256) || !['PENDING', 'UNCERTAIN'].includes(p.operation.state) ||
            (p.operation.localPath != null && !isAbsolute(p.operation.localPath))))) throw error('REGISTRY_CORRUPT');
    }
    for (const [path, binding] of Object.entries(catalog.bindings)) {
      if (!isAbsolute(path) || !object(binding) || !catalog.sites[binding.siteId] ||
          (binding.pendingSiteId && (!catalog.sites[binding.pendingSiteId] || binding.pendingSiteId === binding.siteId))) {
        throw error('REGISTRY_CORRUPT');
      }
    }
    return catalog;
  }

  normalizePaths(catalog) {
    // Bindings are authoritative selectors; older catalogues mixed source history into localPaths.
    for (const site of Object.values(catalog.sites)) {
      site.sourcePaths = [...new Set([...(site.sourcePaths ?? []), ...site.localPaths])];
      site.localPaths = [];
    }
    for (const [path, binding] of Object.entries(catalog.bindings)) {
      const site = catalog.sites[binding.siteId];
      site.localPaths.push(path);
      if (!site.sourcePaths.includes(path)) site.sourcePaths.push(path);
    }
    return catalog;
  }

  async readCatalog() {
    try {
      await outsideRepository(this.directory);
      try { return this.normalizePaths(this.validate(await this.readJson(this.file))); }
      catch (e) { if (e.code !== 'ENOENT') throw e; }
      const catalog = { version: 2, ...this.scope, sites: {}, bindings: {} };
      let names;
      try { names = await readdir(this.directory); }
      catch (e) { if (e.code === 'ENOENT') return catalog; throw e; }
      for (const name of names.filter((n) => /^[0-9a-f]{64}\.json$/.test(n)).sort()) {
        const p = await this.readJson(join(this.directory, name), 65536);
        // A malformed legacy file is never silently discarded during migration.
        if (!p || typeof p.localPath !== 'string' || !isAbsolute(p.localPath)) throw error('REGISTRY_CORRUPT');
        const belongs = p.envId === this.scope.envId && p.region === this.scope.region;
        if (!belongs) {
          if (name === hash([this.scope.envId, this.scope.region, resolve(p.localPath)]) + '.json') throw error('REGISTRY_CORRUPT');
          continue;
        }
        if (p.version !== 1 || !validPage(p) || name !== hash([p.envId, p.region, resolve(p.localPath)]) + '.json' ||
            (p.pending && (!validPage(p.pending) || p.pending.siteId === p.siteId || p.pending.state === 'STORAGE_VERIFIED'))) {
          throw error('REGISTRY_CORRUPT');
        }
        const path = resolve(p.localPath);
        catalog.bindings[path] = { siteId: p.siteId, ...(p.pending ? { pendingSiteId: p.pending.siteId } : {}) };
        for (const item of [p, p.pending].filter(Boolean)) {
          const previous = catalog.sites[item.siteId];
          if (previous) {
            if (!previous.localPaths.includes(path)) previous.localPaths.push(path);
            if (previous.sha256 !== item.sha256) {
              previous.conflictingHashes = [...new Set([...(previous.conflictingHashes ?? [previous.sha256]), item.sha256].filter(Boolean))];
              previous.sha256 = null;
              previous.state = 'UNCERTAIN';
              previous.operation = null;
            }
          } else {
            catalog.sites[item.siteId] = { siteId: item.siteId, sha256: item.sha256, state: item.state,
              lifecycle: null, verifiedAt: null, updatedAt: item.updatedAt ?? null, localPaths: [path],
              operation: item.state === 'STORAGE_VERIFIED' ? null : { action: 'publish', sha256: item.sha256, localPath: path, state: item.state } };
          }
        }
      }
      return this.normalizePaths(this.validate(catalog));
    } catch (e) {
      if (e instanceof PublishError) throw e;
      throw error('REGISTRY_READ_FAILED');
    }
  }

  project(catalog, path) {
    const binding = catalog.bindings[path];
    if (!binding) return null;
    return { version: 2, ...this.scope, ...catalog.sites[binding.siteId], localPath: path,
      ...(binding.pendingSiteId ? { pending: catalog.sites[binding.pendingSiteId] } : {}) };
  }

  async lookup(localPath) { return this.project(await this.readCatalog(), this.entry(localPath).localPath); }
  async lookupSite(siteId) { return (await this.readCatalog()).sites[siteId] ?? null; }

  async list({ lifecycle, offset = 0, limit = 50 } = {}) {
    if ((lifecycle !== undefined && !['online', 'offline'].includes(lifecycle)) ||
        !Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new PublishError('INPUT', 'INVALID_LIST_OPTIONS');
    }
    const catalog = await this.readCatalog();
    const sites = Object.values(catalog.sites).filter((p) => !lifecycle || p.lifecycle === lifecycle)
      .sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? '') || a.siteId.localeCompare(b.siteId));
    return { sites: sites.slice(offset, offset + limit), total: sites.length, offset,
      nextOffset: offset + limit < sites.length ? offset + limit : null, source: 'local', cloudVerified: false };
  }

  async acquire(localPath) {
    const entry = localPath ? this.entry(localPath) : {};
    const lock = this.file + '.lock';
    try {
      await outsideRepository(this.directory);
      await mkdir(this.directory, { recursive: true, mode: 0o700 });
    } catch (e) {
      if (e instanceof PublishError) throw e;
      throw error('REGISTRY_WRITE_FAILED');
    }
    try {
      const handle = await open(lock, 'wx', 0o600);
      await handle.close();
    } catch (e) {
      if (e instanceof PublishError) throw e;
      throw error(e.code === 'EEXIST' ? 'REGISTRY_BUSY' : 'REGISTRY_WRITE_FAILED');
    }
    try {
      const catalog = await this.readCatalog();
      // Commit the migration under the same environment lock before cloud writes.
      await this.writeCatalog(catalog);
      return {
        catalog, record: entry.localPath ? this.project(catalog, entry.localPath) : null,
        save: (data) => this.save(entry, data, catalog),
        saveSite: (data) => this.save({}, data, catalog),
        release: async () => { try { await unlink(lock); } catch { throw error('REGISTRY_UNLOCK_FAILED'); } },
      };
    } catch (e) { await unlink(lock).catch(() => {}); throw e; }
  }

  async save(entry, data, catalog) {
    catalog ??= await this.readCatalog();
    const { siteId, sha256, state, lifecycle, url, action = 'publish', newPage = false } = data;
    const previous = catalog.sites[siteId];
    const path = data.localPath ?? entry.localPath;
    const now = new Date().toISOString();
    const next = { siteId, sha256: sha256 ?? previous?.sha256 ?? null, state,
      lifecycle: lifecycle ?? previous?.lifecycle ?? null, verifiedAt: previous?.verifiedAt ?? null,
      localPaths: previous?.localPaths ?? [],
      sourcePaths: [...new Set([...(previous?.sourcePaths ?? previous?.localPaths ?? []), ...(path ? [path] : [])])],
      updatedAt: now, ...(previous?.url ? { url: previous.url } : {}), ...(url ? { url } : {}),
      operation: state === 'STORAGE_VERIFIED' ? null : { action, sha256, state, ...(path ? { localPath: path } : {}) } };
    if (state === 'STORAGE_VERIFIED') next.verifiedAt = now;
    // Update a copy so a failed disk write cannot be mistaken for persisted state.
    const updated = structuredClone(catalog);
    updated.sites[siteId] = next;
    if (path && action !== 'offline') {
      const binding = updated.bindings[path];
      // An explicit target may share a source with another site's default binding.
      // Only a new-page reservation (including its retry) can replace that default.
      if (!binding || binding.siteId === siteId) {
        updated.bindings[path] = { siteId, ...(binding?.siteId === siteId && binding.pendingSiteId ? { pendingSiteId: binding.pendingSiteId } : {}) };
      } else if (newPage || binding.pendingSiteId === siteId) {
        updated.bindings[path] = state === 'STORAGE_VERIFIED' ? { siteId } : { ...binding, pendingSiteId: siteId };
      }
    }
    await this.writeCatalog(updated);
    Object.assign(catalog, updated);
  }

  async writeCatalog(catalog) {
    this.normalizePaths(this.validate(catalog));
    const temporary = this.file + '.' + randomUUID() + '.tmp';
    try {
      const handle = await open(temporary, 'wx', 0o600);
      try { await handle.writeFile(JSON.stringify(catalog) + '\n'); await handle.sync(); }
      finally { await handle.close(); }
      await rename(temporary, this.file);
    } catch { throw error('REGISTRY_WRITE_FAILED'); }
    finally { await unlink(temporary).catch(() => {}); }
  }
}
