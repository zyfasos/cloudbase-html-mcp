import { readFile, realpath } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CloudBase, readConfig, PublishError } from '../src/cloudbase.mjs';
import { PageRegistry } from '../src/registry.mjs';
import { snapshotManifest, applySnapshotManifest } from '../src/cleanup.mjs';

export async function runCleanup(argv, config, backend = new CloudBase(config)) {
  const options = { siteIds: [], apply: false };
  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === '--apply') options.apply = true;
    else if (['--env-id', '--site-id', '--manifest'].includes(flag) && argv[i + 1] && !argv[i + 1].startsWith('--')) {
      const value = argv[++i];
      if (flag === '--site-id') options.siteIds.push(value);
      else options[flag === '--env-id' ? 'envId' : 'manifest'] = value;
    } else throw new PublishError('INPUT', 'INVALID_CLEANUP_ARGUMENTS');
  }
  if (options.envId !== config.envId || !options.siteIds.length || options.siteIds.some((id) => !/^s-[0-9a-f]{32}$/.test(id)) ||
      (options.apply && (!options.manifest || !isAbsolute(options.manifest))) || (!options.apply && options.manifest)) {
    throw new PublishError('INPUT', 'INVALID_CLEANUP_ARGUMENTS');
  }
  if (!options.apply) {
    const store = await backend.connect();
    return snapshotManifest(backend, store, config, options.siteIds);
  }
  if (!config.registryDir) throw new PublishError('REGISTRY', 'REGISTRY_DISABLED');
  const manifest = JSON.parse(await readFile(options.manifest, 'utf8'));
  const lock = await new PageRegistry(config.registryDir, config).acquire();
  try {
    const store = await backend.connect();
    return await applySnapshotManifest(backend, store, config, manifest, options.siteIds);
  } finally { await lock.release(); }
}

const entry = process.argv[1] && await realpath(process.argv[1]).catch(() => undefined);
if (entry === await realpath(fileURLToPath(import.meta.url))) {
  try { console.log(JSON.stringify(await runCleanup(process.argv.slice(2), readConfig()), null, 2)); }
  catch (e) {
    console.error(JSON.stringify({ ok: false, stage: e.stage, code: e instanceof PublishError ? e.code : 'CLEANUP_FAILED' }));
    process.exitCode = 1;
  }
}
