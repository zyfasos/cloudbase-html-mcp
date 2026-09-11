import { Parser } from 'htmlparser2';
import { createHash } from 'node:crypto';
import { realpath, readlink, lstat, stat } from 'node:fs/promises';
import { dirname, resolve, relative, isAbsolute, win32, sep } from 'node:path';

const MAX_RESOURCES = 1000;
const MAX_DETAILS = 100;
const MAX_REFERENCE = 256;
const white = (c) => c !== undefined && /[\t\n\f\r ]/.test(c);
const clip = (s, length) => [...s.slice(0, length * 2)].slice(0, length).join('');
const categoryOf = (value) => {
  if (/^data:/i.test(value)) return 'embedded';
  if (value.startsWith('#')) return 'fragment';
  if (/^(?:https?:)?\/\//i.test(value)) return 'network';
  if (/^[a-z][a-z\d+.-]*:/i.test(value)) return /^(?:blob|file):/i.test(value) ? 'nonPortable' : 'unsupported';
  return value.startsWith('/') ? 'rootRelative' : 'relative';
};
function safeReference(value, category) {
  if (category === 'embedded' || category === 'fragment') return undefined;
  if (category === 'nonPortable' || category === 'unsupported') return value.match(/^[a-z][a-z\d+.-]*:/i)?.[0].toLowerCase() + '[omitted]';
  if (category === 'network') {
    try { const u = new URL(value.startsWith('//') ? 'https:' + value : value); return u.origin + u.pathname; }
    catch { return '[invalid URL]'; }
  }
  return value.split(/[?#]/, 1)[0].replace(/[\p{Cc}\p{Cs}]/gu, '');
}

// CSS is inspected only in actual style blocks/attributes, never in scripts or HTML comments.
function scanCss(css, add, incomplete) {
  let i = 0;
  const skipSpace = () => {
    while (i < css.length) {
      if (white(css[i])) { i++; continue; }
      if (!css.startsWith('/*', i)) break;
      const end = css.indexOf('*/', i + 2);
      if (end < 0) { incomplete(); i = css.length; break; }
      i = end + 2;
    }
  };
  const quoted = () => {
    const quote = css[i++], start = i; let escaped = false;
    while (i < css.length) {
      if (css[i] === '\\') { escaped = true; i += 2; continue; }
      if (css[i] === quote) { const text = css.slice(start, i++); return { text, escaped }; }
      i++;
    }
    incomplete(); return null;
  };
  while (i < css.length) {
    if (css.startsWith('/*', i)) { const end = css.indexOf('*/', i + 2); if (end < 0) { incomplete(); break; } i = end + 2; continue; }
    if (css[i] === '"' || css[i] === "'") { quoted(); continue; }
    const boundary = i === 0 || !/[a-z\d_-]/i.test(css[i - 1]);
    const isUrl = boundary && css.slice(i, i + 4).toLowerCase() === 'url(';
    const isImport = css.slice(i, i + 7).toLowerCase() === '@import' &&
      (css[i + 7] === undefined || !/[a-z\d_-]/i.test(css[i + 7]));
    if (!isUrl && !isImport) { i++; continue; }
    i += isUrl ? 4 : 7;
    skipSpace();
    if (isImport && css[i] !== '"' && css[i] !== "'") continue; // url() form is handled on the next iteration.
    let value;
    if (css[i] === '"' || css[i] === "'") value = quoted();
    else {
      const start = i;
      while (i < css.length && !white(css[i]) && !/[()"']/.test(css[i])) i++;
      value = { text: css.slice(start, i), escaped: css.slice(start, i).includes('\\') };
    }
    skipSpace();
    if (!value || (isUrl && css[i] !== ')')) { incomplete(); continue; }
    if (value.escaped) incomplete();
    add(value.text, isUrl ? 'css.url' : 'css.import', value.escaped ? 'CSS_ESCAPE' : undefined);
    if (isUrl) i++;
  }
}
function scanSrcset(text, add, incomplete, location) {
  let i = 0;
  while (i < text.length) {
    while (white(text[i]) || text[i] === ',') i++;
    const start = i;
    while (i < text.length && !white(text[i])) i++;
    let url = text.slice(start, i);
    if (!url) break;
    if (url.endsWith(',')) { add(url.replace(/,+$/, ''), location); continue; }
    const descriptorStart = i;
    while (i < text.length && text[i] !== ',') i++;
    const descriptor = text.slice(descriptorStart, i).trim();
    const supported = !descriptor || /^(?:\d+w|(?:\d+(?:\.\d+)?|\.\d+)x)$/.test(descriptor);
    if (!supported) incomplete();
    add(url, location, supported ? undefined : 'SRCSET_DESCRIPTOR');
    if (i < text.length) i++;
  }
}

export function analyzeHtml(html) {
  const resources = new Map();
  const counts = { relative: 0, rootRelative: 0, network: 0, embedded: 0, fragment: 0, nonPortable: 0, unsupported: 0 };
  let referenceCount = 0, scanComplete = true, countsComplete = true, hasBase = false;
  let inHead = false, inTitle = false, titleDone = false, titleText = '', htmlTitle = null;
  let styleText = '', inStyle = false, tagPending = false;
  const incomplete = () => { scanComplete = false; };
  const add = (input, location, reason) => {
    const value = input.trim();
    const category = categoryOf(value); referenceCount++; counts[category]++;
    const key = createHash('sha256').update(category).update('\0').update(value).digest('hex');
    const existing = resources.get(key);
    if (existing) { existing.occurrences++; if (!existing.locations.includes(location)) existing.locations.push(location); if (reason) existing.reason = reason; return; }
    if (resources.size >= MAX_RESOURCES) { countsComplete = false; return; }
    // Retain no data URI payload or huge strings. Counts remain separate from displayed details.
    const overlong = value.length > 4096;
    const visible = reason === 'CSS_ESCAPE' ? '[escaped CSS URL]' : safeReference(value, category);
    const reference = visible === undefined ? undefined : clip(visible, MAX_REFERENCE);
    resources.set(key, { category, reference, referenceTruncated: reference !== visible, locations: [location], occurrences: 1,
      value: category === 'relative' && !overlong ? value : undefined,
      ...(reason || overlong ? { reason: reason ?? 'REFERENCE_TOO_LONG' } : {}) });
  };
  const parser = new Parser({
    onopentagname() { tagPending = true; },
    onopentag(tag, attrs) {
      tagPending = false;
      if (tag === 'head') inHead = true;
      if (tag === 'base' && Object.hasOwn(attrs, 'href')) hasBase = true;
      if (tag === 'title' && inHead && !titleDone) { inTitle = true; titleText = ''; }
      if (tag === 'style') { inStyle = true; styleText = ''; }
      if (['img', 'script', 'iframe', 'source', 'audio', 'video', 'embed'].includes(tag) && Object.hasOwn(attrs, 'src')) add(attrs.src, tag + '.src');
      if (tag === 'video' && Object.hasOwn(attrs, 'poster')) add(attrs.poster, 'video.poster');
      if (tag === 'object' && Object.hasOwn(attrs, 'data')) add(attrs.data, 'object.data');
      if (['img', 'source'].includes(tag) && Object.hasOwn(attrs, 'srcset')) scanSrcset(attrs.srcset, add, incomplete, tag + '.srcset');
      if (tag === 'link' && Object.hasOwn(attrs, 'href') && /(?:^|\s)(?:stylesheet|icon|preload|modulepreload|manifest)(?:\s|$)/i.test(attrs.rel ?? '')) add(attrs.href, 'link.href');
      if (Object.hasOwn(attrs, 'style')) scanCss(attrs.style, add, incomplete);
    },
    ontext(text) {
      if (inTitle && titleText.length < 1200) {
        titleText = (titleText + text.replace(/[\p{Cc}\p{Cs}]/gu, ' ').replace(/\s+/gu, ' ').slice(0, 1200)).replace(/\s+/gu, ' ').trimStart().slice(0, 1200);
      }
      if (inStyle) styleText += text;
    },
    onclosetag(tag, implied) {
      if (tag === 'title' && inTitle) {
        inTitle = false;
        const title = clip(titleText.replace(/[\p{Cc}\p{Cs}]/gu, ' ').replace(/\s+/gu, ' ').trim(), 300);
        if (implied) incomplete();
        else if (title) { htmlTitle = title; titleDone = true; }
      }
      if (tag === 'head') inHead = false;
      if (tag === 'style' && inStyle) { inStyle = false; scanCss(styleText, add, incomplete); styleText = ''; if (implied) incomplete(); }
    },
    onerror() { incomplete(); },
  }, { decodeEntities: true });
  parser.end(html);
  if (tagPending) incomplete();
  return { htmlTitle, resources: [...resources.values()], resourceDiagnostics: {
    scanComplete, countsComplete, referenceCount, uniqueResourceCount: resources.size, counts,
    truncated: !countsComplete, hasBase, limitations: ['STATIC_REFERENCES_ONLY', 'NO_EXTERNAL_RESOURCE_FETCH'],
  } };
}

const inside = (root, path) => { const rel = relative(root, path); return rel !== '..' && !rel.startsWith('..' + sep) && !isAbsolute(rel); };
async function localCheck(root, item, hasBase, io) {
  if (item.category !== 'relative') return { state: 'NOT_CHECKED', reason: 'NOT_LOCAL_RELATIVE' };
  if (hasBase) return { state: 'NOT_CHECKED', reason: 'BASE_HREF' };
  if (item.reason) return { state: 'NOT_CHECKED', reason: item.reason };
  if (!root) return { state: 'NOT_CHECKED', reason: 'HTML_LOCATION_UNAVAILABLE' };
  let path;
  try { path = decodeURIComponent(item.value.split(/[?#]/, 1)[0]); }
  catch { return { state: 'NOT_CHECKED', reason: 'INVALID_ENCODING' }; }
  if (!path || /[\p{Cc}\\]/u.test(path) || isAbsolute(path) || win32.isAbsolute(path)) return { state: 'NOT_CHECKED', reason: 'UNMAPPABLE_PATH' };
  const target = resolve(root, path);
  if (!inside(root, target)) return { state: 'NOT_CHECKED', reason: 'OUTSIDE_DIRECTORY' };
  const parts = relative(root, target).split(sep).filter(Boolean);
  if (parts.length > 64) return { state: 'NOT_CHECKED', reason: 'PATH_DEPTH_LIMIT' };
  let current = root;
  try {
    for (const part of parts) {
      current = resolve(current, part);
      const info = await io.lstat(current);
      if (info.isSymbolicLink()) {
        const linkTarget = resolve(dirname(current), await io.readlink(current));
        try { current = await io.realpath(linkTarget); }
        catch { return { state: 'NOT_CHECKED', reason: 'SYMLINK_UNRESOLVED' }; }
        if (!inside(root, current)) return { state: 'NOT_CHECKED', reason: 'OUTSIDE_DIRECTORY' };
      }
    }
    const physical = await io.realpath(current);
    if (!inside(root, physical)) return { state: 'NOT_CHECKED', reason: 'OUTSIDE_DIRECTORY' };
    return { state: (await io.stat(physical)).isFile() ? 'EXISTS' : 'NOT_FILE' };
  } catch (error) {
    if (error.code === 'DIAGNOSTIC_IO_LIMIT') return { state: 'NOT_CHECKED', reason: error.code };
    if (error.code === 'ENOENT') return { state: 'MISSING' };
    if (error.code === 'ENOTDIR') return { state: 'NOT_FILE' };
    return { state: 'INACCESSIBLE' };
  }
}
function advice(item) {
  if (item.category === 'nonPortable' || item.category === 'unsupported') return '替换非便携引用；本工具不会读取或上传该资源。';
  if (item.localCheck.state === 'MISSING') return '提供缺失资源或改用已内嵌资源的单HTML；本工具不会上传关联文件。';
  if (item.localCheck.state === 'EXISTS') return '本地文件存在，但不会随HTML上传；可由用户另行将资源内嵌后再发布。';
  if (item.category === 'network') return '页面依赖网络资源；本次未请求或验证该地址。';
  return '无法确认该引用可用于分享；请核对资源来源，本次不自动修复。';
}
export async function inspectHtml(html, localPath, io = { realpath, readlink, lstat, stat }) {
  try {
    const parsed = analyzeHtml(html);
    let operations = 0;
    const boundedIo = Object.fromEntries(['realpath', 'readlink', 'lstat', 'stat'].map((name) => [name, async (...args) => {
      if (++operations > 4000) throw Object.assign(new Error(), { code: 'DIAGNOSTIC_IO_LIMIT' });
      return io[name](...args);
    }]));
    let root;
    try { root = dirname(await boundedIo.realpath(localPath)); } catch {}
    const details = [];
    for (const item of parsed.resources) {
      if (item.category === 'embedded' || item.category === 'fragment') continue;
      const local = await localCheck(root, item, parsed.resourceDiagnostics.hasBase, boundedIo);
      const detail = { category: item.category, reference: item.reference, referenceTruncated: item.referenceTruncated, locations: item.locations, occurrences: item.occurrences, localCheck: local };
      detail.advice = advice(detail); details.push(detail);
    }
    const priority = (item) => item.localCheck.state === 'MISSING' || ['nonPortable', 'unsupported'].includes(item.category) ? 0 : 1;
    details.sort((a, b) => priority(a) - priority(b));
    const diagnostics = { ...parsed.resourceDiagnostics, truncated: parsed.resourceDiagnostics.truncated || details.length > MAX_DETAILS || details.some((item) => item.referenceTruncated),
      localChecksComplete: parsed.resourceDiagnostics.countsComplete &&
        !details.some((item) => item.category === 'relative' && ['NOT_CHECKED', 'INACCESSIBLE'].includes(item.localCheck.state)),
      details: details.slice(0, MAX_DETAILS) };
    const counts = diagnostics.counts;
    const warnings = [];
    if (counts.relative || counts.rootRelative) warnings.push('检测到可能的相对资源引用；本工具仅上传此 HTML，关联文件不会一起上传。');
    if (counts.nonPortable || counts.unsupported) warnings.push('检测到非便携或未支持的资源引用，详见resourceDiagnostics。');
    if (!diagnostics.scanComplete || !diagnostics.countsComplete || diagnostics.truncated) warnings.push('资源诊断未完整分析或输出已截断；没有列出不代表不存在依赖。');
    return { htmlTitle: parsed.htmlTitle, resourceDiagnostics: diagnostics, warnings };
  } catch {
    return { htmlTitle: null, warnings: ['资源诊断失败，未影响HTML发布；不能据此判断页面自包含。'],
      resourceDiagnostics: { scanComplete: false, countsComplete: false, truncated: false, reason: 'DIAGNOSTICS_FAILED', details: [] } };
  }
}
