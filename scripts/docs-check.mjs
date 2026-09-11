// Validates public docs: relative links, images, anchors, release:version markers,
// versioned package references and the raw-CDN reading-entry policy. Zero dependencies.
import { readFile, readdir } from 'node:fs/promises';
import { existsSync, statSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const markerFiles = ['README.md', 'README.en.md', 'docs/getting-started.md', 'docs/clients.md', 'PROJECT.md'];
const versionExempt = new Set(['PROJECT.md', 'CHANGELOG.md']); // PROJECT keeps history; CHANGELOG is history.
const problems = [];
const fail = (message) => problems.push(message);

// Public doc set: root *.md plus top-level docs/*.md. docs/implementation/ stays local-only and unscanned.
const docFiles = [
  ...((await readdir(root)).filter((name) => name.endsWith('.md')).map((name) => name)),
  ...((await readdir(join(root, 'docs'))).filter((name) => name.endsWith('.md')).map((name) => `docs/${name}`)),
].sort();

const slug = (heading) => heading.trim().toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').replace(/\s+/g, '-');
const anchorsOf = (text) => new Set([
  ...[...text.matchAll(/^(#{1,6})\s+(.+?)\s*#*$/gm)].map((m) => slug(m[2])),
  ...[...text.matchAll(/<a id="([^"]+)">/g)].map((m) => m[1]),
]);

const contents = new Map(await Promise.all(docFiles.map(async (file) => [file, await readFile(join(root, file), 'utf8')])));
const byPath = new Map();
const textAt = async (absolutePath) => {
  if (!byPath.has(absolutePath)) byPath.set(absolutePath, await readFile(absolutePath, 'utf8'));
  return byPath.get(absolutePath);
};

for (const file of docFiles) {
  const text = contents.get(file);
  const withoutCode = text.replace(/^```[\s\S]*?^```$/gm, '');

  if (/raw\.githubusercontent\.com/.test(withoutCode)) fail(`${file}: 引用 raw CDN Markdown 作为阅读入口，应使用 GitHub 文档页链接`);

  for (const match of withoutCode.matchAll(/!?\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    const raw = match[1];
    const isImage = match[0].startsWith('![');
    if (/^(https?:|mailto:)/.test(raw)) continue;
    const [target, fragment] = raw.split('#');
    if (target) {
      const path = normalize(join(root, dirname(file), target));
      if (!existsSync(path) || !statSync(path).isFile()) { fail(`${file}: 文件不存在 -> ${raw}`); continue; }
      if (fragment && !isImage && !anchorsOf(await textAt(path)).has(fragment)) fail(`${file}: 锚点不存在 -> ${raw}`);
    } else if (fragment && !anchorsOf(text).has(fragment)) {
      fail(`${file}: 页内锚点不存在 -> ${raw}`);
    }
  }
}

const marker = /<!-- release:version -->\r?\n([\s\S]*?)\r?\n<!-- \/release:version -->/g;
for (const file of markerFiles) {
  const blocks = [...(contents.get(file) ?? '').matchAll(marker)];
  if (blocks.length !== 1) { fail(`${file}: release:version 标记必须恰好一组，实际 ${blocks.length}`); continue; }
  const versions = blocks[0][1].match(/\b\d+\.\d+\.\d+(?:-(?:beta|rc)\.\d+)?\b/g) ?? [];
  if (versions.length !== 1 || versions[0] !== pkg.version) fail(`${file}: 标记块版本必须恰为当前版本 ${pkg.version}，实际 ${JSON.stringify(versions)}`);
}
for (const file of docFiles) {
  if (versionExempt.has(file)) continue;
  for (const match of (contents.get(file).match(/cloudbase-html-mcp(@|-)(\d+\.\d+\.\d+(?:-(?:beta|rc)\.\d+)?)/g) ?? [])) {
    const version = match.replace(/^cloudbase-html-mcp[@-]/, '');
    if (version !== pkg.version) fail(`${file}: 过期的版本示例 ${version}（应仅出现在标记文件且为当前版本）`);
  }
}

if (problems.length) {
  console.error(`docs:check 失败，共 ${problems.length} 项：`);
  for (const problem of problems) console.error(`  - ${problem}`);
  process.exit(1);
}
console.log(`docs:check 通过：${docFiles.length} 个文档，链接/锚点/图片/版本标记均有效`);
