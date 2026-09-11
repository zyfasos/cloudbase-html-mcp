import test from 'node:test';
import assert from 'node:assert/strict';
import { cp, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { syncVersion, checkVersions, checkPackage, verifyMetadata, unpack } from '../scripts/release.mjs';
import { fixture } from './helpers.mjs';
import { root } from './npm-helper.mjs';

async function copyInputs(t) {
  const { directory } = await fixture(t);
  for (const file of ['package.json', 'npm-shrinkwrap.json', 'README.md', 'README.en.md', 'PROJECT.md', 'docs/clients.md', 'docs/getting-started.md', 'templates/mcp.macos.json', 'templates/mcp.windows.json']) {
    await mkdir(join(directory, file, '..'), { recursive: true }); await cp(join(root, file), join(directory, file));
  }
  return directory;
}

test('release version preparation synchronizes current entry points but preserves historical evidence', async (t) => {
  const directory = await copyInputs(t);
  const project = await readFile(join(directory, 'PROJECT.md'), 'utf8');
  const old = (await checkVersions(directory)).version;
  await syncVersion('8.0.0-beta.1', directory);
  assert.equal((await checkVersions(directory)).version, '8.0.0-beta.1');
  const after = await readFile(join(directory, 'PROJECT.md'), 'utf8');
  const removeCurrent = (s) => s.replace(/<!-- release:version -->[\s\S]*?<!-- \/release:version -->/, '');
  assert.equal(removeCurrent(after), removeCurrent(project));
  assert.ok(!(await readFile(join(directory, 'docs/getting-started.md'), 'utf8')).includes(`cloudbase-html-mcp@${old}`));
  assert.deepEqual(await syncVersion('8.0.0-beta.1', directory), { version: '8.0.0-beta.1', changed: [] });
});

test('release checker rejects stale snippets, divergent JSON and malformed current-version markers', async (t) => {
  for (const mutate of [
    (s) => s.replace(/cloudbase-html-mcp@\d[^"\s]+/, 'cloudbase-html-mcp@0.0.1'),
    (s) => s.replace('"command": "npx"', '"command": "wrong"'),
    (s) => s.replace('<!-- release:version -->', '<!-- missing -->'),
  ]) {
    const directory = await copyInputs(t); const path = join(directory, 'README.md');
    await writeFile(path, mutate(await readFile(path, 'utf8')));
    await assert.rejects(checkVersions(directory));
  }
});

test('version preparation rejects invalid versions and mismatched inputs before any writes', async (t) => {
  const directory = await copyInputs(t); const path = join(directory, 'package.json'); const before = await readFile(path, 'utf8');
  for (const version of ['latest', '1.0', '01.0.0', '1.0.0;echo bad', '1.0.0-beta.01']) await assert.rejects(syncVersion(version, directory));
  assert.equal(await readFile(path, 'utf8'), before);
  const template = join(directory, 'templates/mcp.macos.json'); await writeFile(template, '{}');
  await assert.rejects(syncVersion('8.0.0', directory));
  assert.equal(await readFile(path, 'utf8'), before);
});

test('release package checks block sensitive paths even when accidentally allowlisted and detect missing files', () => {
  assert.throws(() => checkPackage(new Map([['docs/implementation/private.md', Buffer.from('private')]]), { files: ['docs/'], version: '1.0.0' }), /禁止发布/);
  assert.throws(() => checkPackage(new Map([['unexpected.txt', Buffer.from('x')]]), { files: [], version: '1.0.0' }), /白名单/);
  assert.throws(() => checkPackage(new Map(), { files: [], version: '1.0.0' }), /缺失/);
  for (const file of ['.env', '.env.production', 'src/business.html', 'src/private.local.json']) {
    assert.throws(() => checkPackage(new Map([[file, Buffer.from('private')]]), { files: [file], version: '1.0.0' }), /禁止发布/);
  }
  assert.throws(() => unpack(Buffer.from('not-gzip')));
});

test('public release verification rejects wrong integrity, versions and tags; it does not assume latest follows beta', () => {
  const manifest = { version: '1.0.0-beta.1', integrity: 'sha512-example' };
  const metadata = { name: 'cloudbase-html-mcp', version: manifest.version, dist: { integrity: manifest.integrity } };
  const tags = { beta: manifest.version, latest: '0.4.0-beta.6' };
  verifyMetadata(metadata, tags, manifest, ['beta']);
  assert.throws(() => verifyMetadata(metadata, tags, manifest, ['beta', 'latest']));
  assert.throws(() => verifyMetadata({ ...metadata, version: '2.0.0' }, tags, manifest, ['beta']));
  assert.throws(() => verifyMetadata({ ...metadata, dist: { integrity: 'different' } }, tags, manifest, ['beta']));
});

test('release CLI refuses network verification without explicit network mode and refuses publication without explicit arguments', () => {
  const script = fileURLToPath(new URL('../scripts/release.mjs', import.meta.url));
  for (const args of [['verify', 'missing.json'], ['verify', 'missing.json', '--network'], ['publish'], ['publish', 'missing.json', '--tag', 'beta'], ['push']]) {
    const r = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', timeout: 10000 });
    assert.equal(r.status, 1); assert.match(r.stderr, /用法/);
  }
});

test('version markers and JSON snippets work in a CRLF source checkout', async (t) => {
  const directory = await copyInputs(t);
  for (const file of ['README.md', 'README.en.md', 'PROJECT.md', 'docs/clients.md', 'docs/getting-started.md']) {
    const path = join(directory, file); await writeFile(path, (await readFile(path, 'utf8')).replace(/\r?\n/g, '\r\n'));
  }
  await checkVersions(directory);
  await syncVersion('8.0.0', directory);
  assert.equal((await checkVersions(directory)).version, '8.0.0');
});

// Git/filesystem evidence is real; only remote GitHub reads and the final publication are doubled.
async function gateFixture(t) {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { createHash } = await import('node:crypto');
  const { npm } = await import('./npm-helper.mjs');
  const { directory } = await fixture(t);
  const output = await mkdtemp(join(tmpdir(), 'release-gate-pack-')); t.after(() => rm(output, { recursive: true, force: true }));
  const git = (args, input) => {
    const r = spawnSync('git', args, { cwd: directory, input, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout.trim();
  };
  await writeFile(join(directory, '.gitignore'), 'ignored/\n');
  const pkg = { name: 'cloudbase-html-mcp', version: '1.0.0-beta.1', files: ['src/', 'bin/', 'templates/', 'LICENSE', 'npm-shrinkwrap.json'] };
  await writeFile(join(directory, 'package.json'), JSON.stringify(pkg));
  for (const path of ['bin/cli.mjs','src/server.mjs','src/html-resources.mjs','LICENSE','templates/mcp.macos.json','templates/mcp.windows.json']) {
    await mkdir(join(directory, path, '..'), { recursive: true }); await writeFile(join(directory, path), 'fixture');
  }
  await writeFile(join(directory, 'npm-shrinkwrap.json'), JSON.stringify({ name: pkg.name, version: pkg.version, lockfileVersion: 3, packages: {} }));
  git(['init','-b','main']); git(['config','user.name','Release test']); git(['config','user.email','release@example.invalid']);
  git(['add','.']); git(['commit','-m','fixture']); git(['remote','add','origin','git@github.com:zyfasos/cloudbase-html-mcp.git']);
  const commit = git(['rev-parse','HEAD']);
  const meta = JSON.parse(npm(['pack','--json','--ignore-scripts','--pack-destination',output],directory))[0];
  const bytes = await readFile(join(output,meta.filename)); const hash = (b) => createHash('sha256').update(b).digest('hex');
  const manifest = { version: pkg.version, repository:'zyfasos/cloudbase-html-mcp', sourceCommit:commit, tarball:meta.filename, integrity:meta.integrity, sha256:hash(bytes), files:Object.fromEntries([...unpack(bytes)].map(([p,b])=>[p,hash(b)])) };
  const path = join(output,'release.json'); await writeFile(path,JSON.stringify(manifest));
  const state = { remote:commit, calls:[], ci: { head_sha:commit, head_branch:'main', event:'push', path:'.github/workflows/check.yml', head_repository:{full_name:'zyfasos/cloudbase-html-mcp'}, status:'completed', conclusion:'success', run_attempt:1, html_url:'https://github.com/zyfasos/cloudbase-html-mcp/actions/runs/1' },
    jobs: {total_count:4,jobs:['macos-latest','windows-latest'].flatMap(os=>[22,24].map(node=>({name:`test (${os}, ${node})`,status:'completed',conclusion:'success',steps:['Run npm run check','Run npm test'].map(name=>({name,status:'completed',conclusion:'success'}))})))}};
  const run = (program,args,cwd,input) => {
    state.calls.push([program,...args]);
    if(program==='git' && args[0]==='ls-remote') return `${state.remote}\trefs/heads/main`;
    if(program==='git') return git(args,input);
    if(program==='gh' && args[0]==='run') return JSON.stringify([{databaseId:1}]);
    if(program==='gh' && args[1].includes('/jobs?')) return JSON.stringify(state.jobs);
    if(program==='gh') return JSON.stringify(state.ci);
    throw new Error('unexpected command');
  };
  return {directory,output,path,manifest,state,run,git};
}

test('release gate accepts clean committed pushed source and exact successful CI; publishes only the validated tarball', async (t) => {
  const { releaseGate, publishRelease } = await import('../scripts/release.mjs'); const f=await gateFixture(t);
  const result=await releaseGate(f.path,f); assert.equal(result.sourceCommit,f.manifest.sourceCommit); assert.equal(result.passed,true);
  let calls=0;
  await publishRelease(f.path,'beta',{...f,publish: async (r)=>{calls++;assert.equal(r.tarball,join(f.output,f.manifest.tarball));}});
  assert.equal(calls,1);
});

test('dirty tracked, staged and untracked changes block publication before any network or npm invocation', async (t) => {
  const { publishRelease, cleanSource }=await import('../scripts/release.mjs');const f=await gateFixture(t);
  for(const mode of ['untracked','tracked','staged']){
    const path=join(f.directory,mode==='untracked'?'new.txt':'src/server.mjs'); const before=mode==='untracked'?null:await readFile(path);
    await writeFile(path,'changed');if(mode==='staged')f.git(['add','src/server.mjs']);
    f.state.calls=[];let called=false;
    await assert.rejects(publishRelease(f.path,'beta',{...f,publish:()=>{called=true;}}),/RELEASE_DIRTY/);
    assert.equal(called,false);assert.ok(!f.state.calls.some(([p,a])=>p==='gh'||a==='ls-remote'));
    if(mode==='staged')f.git(['reset','HEAD','src/server.mjs']);
    if(before)await writeFile(path,before);else await (await import('node:fs/promises')).unlink(path);
  }
  await mkdir(join(f.directory,'ignored'));await writeFile(join(f.directory,'ignored/evidence.json'),'{}');
  assert.equal(cleanSource(f.directory,f.run),f.manifest.sourceCommit);
});

test('unbound legacy manifest, stale commit, tampered tarball and incomplete manifest cannot pass the gate', async (t) => {
  const { releaseGate }=await import('../scripts/release.mjs');const f=await gateFixture(t);
  for(const change of [{sourceCommit:undefined},{sourceCommit:'0'.repeat(40)},{files:{}}]){
    await writeFile(f.path,JSON.stringify({...f.manifest,...change}));await assert.rejects(releaseGate(f.path,f));
  }
  await writeFile(f.path,JSON.stringify(f.manifest));await writeFile(join(f.output,f.manifest.tarball),'changed');
  await assert.rejects(releaseGate(f.path,f),/RELEASE_ARTIFACT_CHANGED/);
});

test('unpushed source, missing or pending/failed/wrong CI and skipped matrix jobs block publication', async (t) => {
  const { publishRelease }=await import('../scripts/release.mjs');const f=await gateFixture(t);let calls=0;
  const check=()=>assert.rejects(publishRelease(f.path,'beta',{...f,publish:()=>{calls++;}}));
  f.state.remote='0'.repeat(40);await check();f.state.remote=f.manifest.sourceCommit;
  const ci=structuredClone(f.state.ci), jobs=structuredClone(f.state.jobs);
  for(const change of [{status:'in_progress'},{conclusion:'failure'},{head_sha:'0'.repeat(40)},{event:'pull_request'},{path:'.github/workflows/other.yml'}]){f.state.ci={...ci,...change};await check();}
  f.state.ci=ci;
  f.state.jobs.jobs[0].conclusion='skipped';await check();f.state.jobs=structuredClone(jobs);
  f.state.jobs.jobs[0].steps.pop();await check();f.state.jobs=structuredClone(jobs);
  f.state.jobs.total_count=5;await check();f.state.jobs=structuredClone(jobs);
  await assert.rejects(publishRelease(f.path,'beta',{...f,run:(p,a,c,i)=>p==='gh'&&a[0]==='run'?'[]':f.run(p,a,c,i),publish:()=>{calls++;}}));
  assert.equal(calls,0);
});
