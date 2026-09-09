import { mkdtemp, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { npm, root, testCache } from '../test/npm-helper.mjs';

// This explicit preparation may access npm. The test suite itself stays offline.
const temporary = await realpath(await mkdtemp(join(tmpdir(), 'cloudbase-test-cache-')));
try {
  const packed = JSON.parse(npm(['pack', '--json', '--ignore-scripts', '--pack-destination', temporary], root))[0];
  npm(['install', '--prefix', join(temporary, 'install'), '--ignore-scripts', '--no-audit', '--no-fund',
    '--package-lock=false', join(temporary, packed.filename)], temporary);
  console.log(`Offline package test cache prepared: ${testCache}`);
} finally {
  await rm(temporary, { recursive: true, force: true });
}
