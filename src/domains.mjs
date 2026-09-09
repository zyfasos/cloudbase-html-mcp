import { PublishError } from './errors.mjs';

// Gateway discovery supplies candidates; only the public content check proves a URL works.
const MAX_PAGES = 3;
const PAGE_SIZE = 1000;

export async function discoverDomains(client, envId) {
  const domains = [];
  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const result = await client.DescribeHTTPServiceRoute({ EnvId: envId, Offset: domains.length, Limit: PAGE_SIZE });
      if (!Array.isArray(result.Domains) || result.Domains.some((d) => !d || typeof d !== 'object' ||
          (d.Routes && (!Array.isArray(d.Routes) || d.Routes.some((r) => !r || typeof r !== 'object')))) ||
          (result.TotalCount != null && (!Number.isInteger(result.TotalCount) || result.TotalCount < 0))) throw new Error('Invalid route response');
      domains.push(...result.Domains);
      if (Number.isInteger(result.TotalCount) ? domains.length >= result.TotalCount : result.Domains.length < PAGE_SIZE) {
        return { state: 'COMPLETE', domains };
      }
      if (!result.Domains.length) break;
    }
    // A partial snapshot can miss a more specific route, so do not select from it.
    return { state: 'INCOMPLETE', domains: [] };
  } catch (error) {
    return { state: 'UNAVAILABLE', domains: [], code: /^[A-Za-z0-9_.-]{1,100}$/.test(error.code ?? '') ? error.code : 'ROUTE_LOOKUP_FAILED' };
  }
}

function origin(value) {
  try {
    const url = new URL(value.includes('://') ? value : `https://${value}`);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') return null;
    return url.origin;
  } catch { return null; }
}

function routePath(value) {
  if (typeof value !== 'string' || !/^\/(?:[A-Za-z0-9_./-]*)$/.test(value) || value.includes('..') || value.includes('//')) return null;
  return value.replace(/\/$/, '') || '/';
}

function rejection(domain, path, names) {
  if (domain.Enable === false) return 'DOMAIN_DISABLED';
  if (domain.Status && domain.Status !== 'SUCCESS') return 'DOMAIN_NOT_READY';
  if (domain.Protocol === 'HTTPS_TO_HTTP') return 'HTTPS_UNAVAILABLE';
  const routes = domain.Routes;
  if (!Array.isArray(routes)) return 'ROUTE_INFORMATION_MISSING';
  // Unknown path syntax could shadow a valid route; avoid guessing its precedence.
  if (routes.some((r) => !routePath(r.Path))) return 'UNSUPPORTED_ROUTE_PATH';
  const matches = routes.filter((r) => {
    const prefix = routePath(r.Path);
    return prefix === '/' || path === prefix || path.startsWith(`${prefix}/`);
  }).sort((a, b) => routePath(b.Path).length - routePath(a.Path).length);
  if (!matches.length) return 'NO_COVERING_ROUTE';
  const route = matches[0];
  if (matches[1] && routePath(matches[1].Path).length === routePath(route.Path).length) return 'AMBIGUOUS_ROUTE';
  if (route.Enable === false) return 'ROUTE_DISABLED';
  if (route.UpstreamResourceType !== 'STATIC_STORE' || !names.includes(route.UpstreamResourceName)) return 'OTHER_UPSTREAM';
  if (route.EnableAuth === true) return 'ROUTE_REQUIRES_AUTH';
  if (route.PathRewrite && Object.values(route.PathRewrite).some((value) => value != null && value !== '')) return 'UNSUPPORTED_PATH_REWRITE';
  if (routePath(route.Path) !== '/' && route.EnablePathTransmission !== true) return 'PATH_TRANSMISSION_UNCONFIRMED';
  return null;
}

export function parseSiteUrl(value) {
  try {
    // Reject non-canonical spelling before URL normalizes dot segments or escapes.
    const match = /^https:\/\/([^/?#]+)(\/sites\/(s-[0-9a-f]{32})\/(?:index\.html)?)(?:#[^\r\n]*)?$/.exec(value);
    if (!match) throw new Error();
    const url = new URL(value);
    if (url.username || url.password || url.search || url.pathname !== match[2] || /[%\\\s]/.test(match[1])) throw new Error();
    return { siteId: match[3], origin: url.origin, path: match[2], url: `${url.origin}/sites/${match[3]}/index.html` };
  } catch { throw new PublishError('INPUT', 'INVALID_SITE_URL'); }
}

export function validateSiteUrl(store, parsed) {
  if (store.domainDiscovery?.state !== 'COMPLETE') throw new PublishError('INPUT', 'SITE_URL_UNCONFIRMED');
  const matches = store.domainDiscovery.domains.filter((d) => origin(d.Domain) === parsed.origin);
  const paths = new Set([parsed.path, `/sites/${parsed.siteId}/index.html`]);
  if (matches.length !== 1 || [...paths].some((path) => typeof path !== 'string' || rejection(matches[0], path, [store.bucket, 'staticstore']))) {
    throw new PublishError('INPUT', 'SITE_URL_UNCONFIRMED');
  }
  return parsed.siteId;
}

export function accessCandidates(store, key) {
  const path = `/${key}`;
  const discovery = store.domainDiscovery ?? { state: 'UNAVAILABLE', domains: [] };
  const domains = discovery.domains ?? [];
  const names = [store.bucket, 'staticstore'];
  const rejected = [];
  const candidates = [];
  function add(base, source, domain) {
    const baseOrigin = origin(base);
    if (!baseOrigin) return;
    const reason = domain ? rejection(domain, path, names) : null;
    if (reason) { rejected.push({ url: `${baseOrigin}${path}`, source, reason }); return; }
    if (!candidates.some((c) => c.url === `${baseOrigin}${path}`)) candidates.push({ url: `${baseOrigin}${path}`, source });
  }
  const configured = store.configuredBaseUrl;
  if (configured) {
    add(configured, 'configured', domains.find((d) => origin(d.Domain) === configured));
  } else {
    for (const d of [...domains].sort((a, b) => Number(a.IsDefault === true) - Number(b.IsDefault === true))) {
      add(d.Domain, d.IsDefault === true ? 'gateway.default' : 'gateway.custom', d);
    }
    if (store.baseUrl) add(store.baseUrl, 'hosting.staticDomain', domains.find((d) => origin(d.Domain) === store.baseUrl));
  }
  // Reserve the final slot for a platform fallback, limiting public probes to three.
  const fallback = candidates.find((c) => c.source === 'hosting.staticDomain' || c.source === 'gateway.default');
  const selected = candidates.slice(0, 3);
  if (fallback && !selected.includes(fallback)) selected[2] = fallback;
  return { candidates: selected, rejected, discovery: discovery.state, discoveryCode: discovery.code,
    truncated: candidates.length > selected.length };
}
