import { PublishError } from './errors.mjs';

export const currentKey = (siteId) => 'sites/' + siteId + '/index.html';
export function validSnapshot(siteId, key) {
  return typeof key === 'string' && new RegExp('^deployments/' + siteId + '/[0-9a-f]{64}/index\\.html$').test(key);
}

export async function* snapshotPages(backend, siteId) {
  if (!/^s-[0-9a-f]{32}$/.test(siteId)) throw new PublishError('INPUT', 'INVALID_SITE_ID');
  let marker;
  for (let page = 0; page < 100; page++) {
    const result = await backend.listObjects('deployments/' + siteId + '/', marker);
    if (!Array.isArray(result.objects)) throw new PublishError('COS_LIST', 'INVALID_LIST_RESPONSE');
    const objects = result.objects.filter((o) => validSnapshot(siteId, o.key));
    if (objects.some((o) => !Number.isSafeInteger(o.bytes) || o.bytes < 0)) throw new PublishError('COS_LIST', 'INVALID_LIST_RESPONSE');
    yield objects;
    if (!result.nextMarker) return;
    if (typeof result.nextMarker !== 'string' || result.nextMarker <= (marker ?? '')) throw new PublishError('COS_LIST', 'INVALID_LIST_CURSOR');
    marker = result.nextMarker;
  }
  throw new PublishError('COS_LIST', 'CLEANUP_PAGE_LIMIT');
}

export async function cleanupSnapshots(backend, siteId) {
  let deleted = 0;
  for await (const objects of snapshotPages(backend, siteId)) {
    for (let offset = 0; offset < objects.length; offset += 1000) {
      const keys = objects.slice(offset, offset + 1000).map((o) => o.key);
      if (keys.length) { await backend.deleteObjects(keys); deleted += keys.length; }
    }
  }
  for await (const objects of snapshotPages(backend, siteId)) {
    if (objects.length) throw new PublishError('COS_DELETE', 'DELETE_INCOMPLETE');
  }
  return { complete: true, deletedSnapshots: deleted };
}

export async function snapshotManifest(backend, store, scope, siteIds) {
  const objects = [];
  for (const siteId of [...new Set(siteIds)]) {
    for await (const page of snapshotPages(backend, siteId)) objects.push(...page.map((o) => ({ ...o, siteId })));
  }
  return { version: 1, envId: scope.envId, region: scope.region, bucket: store.bucket,
    objects, count: objects.length, bytes: objects.reduce((n, o) => n + o.bytes, 0) };
}

export async function applySnapshotManifest(backend, store, scope, manifest, siteIds) {
  const ids = new Set(siteIds);
  if (manifest?.version !== 1 || manifest.envId !== scope.envId || manifest.region !== scope.region ||
      manifest.bucket !== store.bucket || !Array.isArray(manifest.objects) ||
      manifest.objects.some((o) => !ids.has(o.siteId) || !validSnapshot(o.siteId, o.key) ||
        !Number.isSafeInteger(o.bytes) || o.bytes < 0 || typeof o.etag !== 'string')) {
    throw new PublishError('INPUT', 'INVALID_CLEANUP_MANIFEST');
  }
  await backend.assertDeletionSafe();
  const current = await snapshotManifest(backend, store, scope, siteIds);
  const byKey = new Map(current.objects.map((o) => [o.key, o]));
  for (const o of manifest.objects) {
    const actual = byKey.get(o.key);
    if (actual && (actual.etag !== o.etag || actual.bytes !== o.bytes)) throw new PublishError('COS_DELETE', 'CLEANUP_MANIFEST_STALE');
  }
  const keys = [...new Set(manifest.objects.map((o) => o.key))];
  for (let i = 0; i < keys.length; i += 1000) await backend.deleteObjects(keys.slice(i, i + 1000));
  const remaining = await snapshotManifest(backend, store, scope, siteIds);
  if (remaining.objects.some((o) => keys.includes(o.key))) throw new PublishError('COS_DELETE', 'DELETE_INCOMPLETE');
  return { complete: true, deletedSnapshots: keys.length };
}
