import { basename } from 'node:path';
import { PublishError } from './errors.mjs';

const controls = /[\p{Cc}\p{Cs}]/u;
export function normalizeDisplayName(value) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || controls.test(value)) throw new PublishError('INPUT', 'INVALID_DISPLAY_NAME');
  const name = value.trim();
  if (!name || [...name].length > 120) throw new PublishError('INPUT', 'INVALID_DISPLAY_NAME');
  return name;
}
export function validMetadata(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  if (value.displayName !== undefined && value.displayName !== null) {
    try { if (normalizeDisplayName(value.displayName) !== value.displayName) return false; } catch { return false; }
  }
  return value.htmlTitle === undefined || value.htmlTitle === null ||
    (typeof value.htmlTitle === 'string' && value.htmlTitle.length > 0 && !controls.test(value.htmlTitle) && [...value.htmlTitle].length <= 300);
}
export function siteMetadata(site = {}, siteId = site.siteId) {
  const displayName = site.displayName ?? null;
  const htmlTitle = site.htmlTitle ?? null;
  const fileName = (paths) => [...new Set((paths ?? []).map((path) => basename(path)))].sort()[0];
  return { displayName, htmlTitle, label: displayName || htmlTitle || fileName(site.localPaths) || fileName(site.sourcePaths) || siteId };
}
export function queryTerms(query) {
  if (query === undefined) return [];
  if (typeof query !== 'string' || [...query].length > 200) throw new PublishError('INPUT', 'INVALID_LIST_OPTIONS');
  return normalizeSearch(query).trim().split(/\s+/u).filter(Boolean);
}
const normalizeSearch = (value) => value.normalize('NFKC').toLowerCase();
export function matchesQuery(site, terms) {
  if (!terms.length) return true;
  const fields = [site.displayName, site.htmlTitle,
    ...[...(site.localPaths ?? []), ...(site.sourcePaths ?? [])].map((path) => basename(path))]
    .filter((value) => typeof value === 'string').map(normalizeSearch);
  return terms.every((term) => fields.some((field) => field.includes(term)));
}
