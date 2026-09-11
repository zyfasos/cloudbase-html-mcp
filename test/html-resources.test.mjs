import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, mkdir, symlink, readFile, realpath, lstat, stat, readlink } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fixture } from './helpers.mjs';
import { analyzeHtml, inspectHtml } from '../src/html-resources.mjs';
import { loadHtml } from '../src/publisher.mjs';

const doc = (body) => '<html><head><title>  半年 &amp; &#x1f600; 报告 </title></head><body>' + body + '</body></html>';

test('static resources share one parser with title extraction and ignore comments, scripts and navigation', async (t) => {
  const { localPath, directory } = await fixture(t);
  await writeFile(join(directory, 'ok.png'), 'image');
  const input = doc(`<img src="ok.png"><img src="ok.png"><a href="nav.html">go</a>
    <!-- <img src="comment.png"> --><script>const x='<img src="script.png">'; const y='url(fake.png)'</script>
    <link rel="canonical" href="nav2.html"><link rel="stylesheet" href="missing.css">
    <video src="v.mp4" poster="poster.png"></video><audio src="a.mp3"></audio><object data="o.pdf"></object><embed src="e.pdf">
    <iframe src="frame.html"></iframe><source src="s.mp4"><img style="background:url('ok.png')">
    <style>/*url(comment.css)*/a{content:'url(string.png)';background:url(css.png)} @import "import.css"; @import url(urlimport.css);</style>`);
  const r = await inspectHtml(input, localPath);
  assert.equal(r.htmlTitle, '半年 & 😀 报告');
  assert.equal(r.resourceDiagnostics.referenceCount, 14);
  const details = r.resourceDiagnostics.details;
  assert.equal(details.find((d) => d.reference === 'ok.png').occurrences, 3);
  assert.deepEqual(details.find((d) => d.reference === 'ok.png').localCheck, { state: 'EXISTS' });
  for (const bogus of ['nav.html','nav2.html','comment.png','script.png','fake.png','comment.css','string.png']) assert.ok(!details.some((d) => d.reference === bogus));
  assert.equal(details[0].localCheck.state, 'MISSING');
});

test('resource classes and srcset redact URL secrets and never fetch external resources', async (t) => {
  const { localPath } = await fixture(t);
  const fetch = t.mock.method(globalThis, 'fetch', () => { throw new Error('network forbidden'); });
  const input = doc(`<img src="https://user:secret@example.com/a.png?token=secret#secret">
    <img src="//example.com/a.png?q=secret"><img src="data:image/png;base64,secret">
    <img src="#secret"><img src="file:///private/secret"><img src="blob:https://site/secret">
    <img src="/root.png"><img src="javascript:secret"><img srcset="one.png 1x, two.png 2x, data:image/png;base64,secret 3x">
    <img src="local.png?q=secret#secret">`);
  const r = await inspectHtml(input, localPath);
  assert.deepEqual(r.resourceDiagnostics.counts, { relative: 3, rootRelative: 1, network: 2, embedded: 2, fragment: 1, nonPortable: 2, unsupported: 1 });
  assert.equal(r.resourceDiagnostics.scanComplete, true);
  assert.ok(!JSON.stringify(r).includes('secret'));
  assert.equal(fetch.mock.callCount(), 0);
});

test('local checks are metadata-only, directory confined and distinguish missing, nonfile, inaccessible and base', async (t) => {
  const { directory, localPath } = await fixture(t);
  await mkdir(join(directory, 'folder')); await writeFile(join(directory, 'pic name.png'), 'not read');
  const io = { realpath, readlink, lstat: async (p) => { if (p.endsWith('denied')) throw Object.assign(new Error('private'), { code: 'EACCES' }); return lstat(p); }, stat };
  const r = await inspectHtml(doc('<img src="pic%20name.png?v=2"><img src="folder"><img src="missing"><img src="denied"><img src="../outside.png"><img src="%2e%2e/out.png">'), localPath, io);
  const states = Object.fromEntries(r.resourceDiagnostics.details.map((d) => [d.reference, d.localCheck.state]));
  assert.deepEqual(states, { missing: 'MISSING', 'pic%20name.png': 'EXISTS', folder: 'NOT_FILE', denied: 'INACCESSIBLE', '../outside.png': 'NOT_CHECKED', '%2e%2e/out.png': 'NOT_CHECKED' });
  const base = await inspectHtml('<html><head><base href="https://example.com/"></head><img src="missing"></html>', localPath);
  assert.deepEqual(base.resourceDiagnostics.details[0].localCheck, { state: 'NOT_CHECKED', reason: 'BASE_HREF' });
});

test('symlink escape including a missing external target is not diagnosed as a local missing file', async (t) => {
  const { directory, localPath } = await fixture(t);
  await mkdir(join(directory, 'inner')); await writeFile(join(directory, 'inner/pic.png'), 'x');
  await symlink(join(directory, 'inner'), join(directory, 'alias'), process.platform === 'win32' ? 'junction' : 'dir');
  await symlink(join(directory, '..'), join(directory, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  const r = await inspectHtml(doc('<img src="alias/pic.png"><img src="escape/does-not-exist.png">'), localPath);
  assert.equal(r.resourceDiagnostics.details.find((d) => d.reference === 'alias/pic.png').localCheck.state, 'EXISTS');
  assert.equal(r.resourceDiagnostics.details.find((d) => d.reference === 'escape/does-not-exist.png').localCheck.reason, 'OUTSIDE_DIRECTORY');
});

test('diagnostic caps and unsupported CSS/srcset are explicit and output size stays bounded', async (t) => {
  const { localPath } = await fixture(t);
  const input = doc(Array.from({ length: 1100 }, (_, i) => `<img src="${i}.png">`).join('') + `<img src="${'a'.repeat(20000)}"><style>a{background:url("a\\20 b.png")} url(unclosed</style><img srcset="a.png banana">`);
  const r = await inspectHtml(input, localPath);
  assert.equal(r.resourceDiagnostics.referenceCount, 1103);
  assert.equal(r.resourceDiagnostics.uniqueResourceCount, 1000);
  assert.equal(r.resourceDiagnostics.details.length, 100);
  assert.equal(r.resourceDiagnostics.countsComplete, false);
  assert.equal(r.resourceDiagnostics.scanComplete, false);
  assert.equal(r.resourceDiagnostics.truncated, true);
  assert.ok(Buffer.byteLength(JSON.stringify(r)) < 100000);
  const long = await inspectHtml(doc('<img src="' + 'x'.repeat(1000) + '">'), localPath);
  assert.equal(long.resourceDiagnostics.truncated, true);
  assert.equal(long.resourceDiagnostics.details[0].referenceTruncated, true);
  assert.ok(long.resourceDiagnostics.details[0].reference.length <= 256);
  const escaped = await inspectHtml(doc('<style>a{background:url("a\\20 b.png")}</style>'), localPath);
  assert.equal(escaped.resourceDiagnostics.details[0].localCheck.reason, 'CSS_ESCAPE');
});

test('titles are head-only, Unicode-bounded, entity-decoded and do not use script or body text', () => {
  assert.equal(analyzeHtml('<html><head><!--<title>fake</title>--><script>"<title>fake</title>"</script></head><body><title>body</title></body></html>').htmlTitle, null);
  assert.equal(analyzeHtml('<html><head><title>  </title><title>valid &lt;x&gt;</title><title>later</title></head></html>').htmlTitle, 'valid <x>');
  assert.equal([...analyzeHtml('<html><head><title>' + ' '.repeat(2000) + '😀'.repeat(400) + '</title></head></html>').htmlTitle].length, 300);
});

test('unexpected diagnostic errors are nonblocking and return no raw exception text', async (t) => {
  const { localPath } = await fixture(t);
  const io = { realpath, readlink, lstat: async () => { throw { get code() { throw new Error('secret'); } }; }, stat };
  const result = await inspectHtml(doc('<img src="x.png">'), localPath, io);
  assert.equal(result.resourceDiagnostics.reason, 'DIAGNOSTICS_FAILED');
  assert.ok(!JSON.stringify(result).includes('secret'));
  await writeFile(localPath, doc('<img src="missing.png">'));
  assert.equal((await loadHtml(localPath)).bytes.length, (await readFile(localPath)).length);
});

test('20 MiB embedded and malformed resource inputs complete in a real child with bounded output', async (t) => {
  const { localPath } = await fixture(t);
  for (const input of ['<html><style>' + 'url('.repeat(5 * 1024 * 1024 - 20) + '</style></html>', '<html><img src="data:image/png;base64,' + 'A'.repeat(20 * 1024 * 1024 - 100) + '"></html>']) {
    await writeFile(localPath, input);
    const code = `import {loadHtml} from ${JSON.stringify(new URL('../src/publisher.mjs', import.meta.url).href)};let r=await loadHtml(process.argv[1]);console.log(JSON.stringify(r.resourceDiagnostics));`;
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', code, localPath], { timeout: 15000, encoding: 'utf8' });
    assert.ifError(r.error); assert.equal(r.status, 0, r.stderr); assert.ok(r.stdout.length < 100000);
  }
});

test('very deep paths and aggregate metadata work are bounded and marked unverified', async (t) => {
  const { localPath } = await fixture(t);
  let calls = 0;
  const io = { realpath: async (p) => { calls++; return p; }, readlink,
    lstat: async () => { calls++; return { isSymbolicLink: () => false }; },
    stat: async () => { calls++; return { isFile: () => true }; } };
  const r = await inspectHtml(doc(Array.from({ length: 1000 }, (_, i) => `<img src="a/b/c/d/${i}.png">`).join('')), localPath, io);
  assert.ok(calls <= 4000); assert.equal(r.resourceDiagnostics.localChecksComplete, false);
  const deep = await inspectHtml(doc('<img src="' + 'a/'.repeat(65) + 'x.png">'), localPath);
  assert.equal(deep.resourceDiagnostics.details[0].localCheck.reason, 'PATH_DEPTH_LIMIT');
  assert.equal(analyzeHtml('<html><img src="unclosed').resourceDiagnostics.scanComplete, false);
});

test('CSS comments separating URL/import tokens are accepted without scanning comment contents', async (t) => {
  const { localPath } = await fixture(t);
  const r = await inspectHtml(doc('<style>@import/**/"a.css"; @import"b.css"; div{background:url(/* url(fake) */ "c.png" /**/)}</style>'), localPath);
  assert.equal(r.resourceDiagnostics.scanComplete, true);
  assert.deepEqual(r.resourceDiagnostics.details.map((d) => d.reference), ['a.css', 'b.css', 'c.png']);
});
