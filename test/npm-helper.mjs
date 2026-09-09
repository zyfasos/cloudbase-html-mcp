import { join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const testCache = process.env.CLOUDBASE_TEST_NPM_CACHE ?? join(root, 'artifacts', 'test-npm-cache');
if (!isAbsolute(testCache)) throw new Error('CLOUDBASE_TEST_NPM_CACHE must be an absolute path');

export function npm(args, cwd) {
  const env = { ...process.env, npm_config_cache: testCache };
  // npm 11 rejects the script policy forwarded from an outer npm run.
  delete env.npm_config_allow_scripts;
  const result = process.env.npm_execpath
    ? spawnSync(process.execPath, [process.env.npm_execpath, ...args], { cwd, env, encoding: 'utf8', timeout: 120000 })
    : spawnSync(process.platform === 'win32' ? 'cmd.exe' : 'npm', [...(process.platform === 'win32' ? ['/d', '/c', 'npm'] : []), ...args], { cwd, env, encoding: 'utf8', timeout: 120000 });
  if (result.status !== 0) {
    throw new Error(`npm ${args[0]} failed: ${result.error?.message ?? result.stderr}\nFor offline package tests, run npm run test:prepare first.`, { cause: result.error });
  }
  return result.stdout;
}
