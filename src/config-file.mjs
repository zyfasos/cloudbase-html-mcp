import { constants } from 'node:fs';
import { lstat, mkdir, open, realpath, rename, unlink } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseEnv } from 'node:util';
import { PublishError } from './errors.mjs';

export const configFields = ['CLOUDBASE_ENV_ID', 'CLOUDBASE_REGION', 'CLOUDBASE_API_KEY',
  'CLOUDBASE_PUBLIC_BASE_URL', 'CLOUDBASE_REGISTRY_DIR'];
export const setupError = (code) => new PublishError('SETUP', code);

export async function configLocation(file, create = false, { checkPermissions = true } = {}) {
  if (!isAbsolute(file ?? '')) throw setupError('ABSOLUTE_CONFIG_PATH_REQUIRED');
  // Windows collapses parent segments before resolving links. Reject ambiguous input before I/O.
  if (process.platform === 'win32' && file.split(/[/\\]/).includes('..')) throw setupError('INVALID_CONFIG_PATH');
  const name = basename(file);
  if (['.', '..'].includes(name) || (process.platform === 'win32' ? /[/\\]$/ : /\/$/).test(file)) {
    throw setupError('INVALID_CONFIG_PATH');
  }
  // Resolve symlinks before collapsing parent segments; lexical resolve() can select another file.
  const parent = await physicalDirectory(dirname(file));
  // Check lexical and resolved ancestors, including a worktree's .git file.
  for (const start of [dirname(resolve(file)), parent]) {
    for (let path = start; ; path = dirname(path)) {
      try { await lstat(join(path, '.git')); throw setupError('CONFIG_INSIDE_REPOSITORY'); }
      catch (e) { if (e.code !== 'ENOENT') throw e; }
      if (path === dirname(path)) break;
    }
  }
  if (create) await mkdir(parent, { recursive: true, mode: 0o700 });
  try {
    const info = await lstat(parent);
    if (!info.isDirectory() || (checkPermissions && process.platform !== 'win32' &&
      ((info.mode & 0o077) !== 0 || info.uid !== process.getuid()))) throw setupError('PRIVATE_DIRECTORY_REQUIRED');
  } catch (e) { if (e.code !== 'ENOENT' || create) throw e; }
  return join(parent, name);
}

async function physicalDirectory(path) {
  try { return await realpath(path); }
  catch (e) {
    if (e.code !== 'ENOENT' || path === dirname(path)) throw e;
    const name = basename(path);
    // A missing component before .. has no physical resolution; do not guess a sibling target.
    if (name === '..') throw setupError('INVALID_CONFIG_PATH');
    return join(await physicalDirectory(dirname(path)), name);
  }
}

export async function readConfigFile(file, { strict = false } = {}) {
  const target = await configLocation(file);
  let handle;
  try {
    const info = await lstat(target);
    if (!info.isFile() || info.nlink !== 1) throw setupError('REGULAR_CONFIG_FILE_REQUIRED');
    handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const actual = await handle.stat();
    if (!actual.isFile() || actual.ino !== info.ino || actual.dev !== info.dev) throw setupError('CONFIG_CHANGED');
    if (process.platform !== 'win32' && ((actual.mode & 0o077) !== 0 || actual.uid !== process.getuid())) {
      throw setupError('PRIVATE_FILE_REQUIRED');
    }
    if (actual.size > 65536) throw setupError('CONFIG_TOO_LARGE');
    const text = await handle.readFile('utf8');
    if (strict) validateConfigText(text);
    const values = parseEnv(text);
    if (Object.keys(values).some((key) => !configFields.includes(key))) throw setupError('UNSUPPORTED_CONFIG_FIELDS');
    return { text, values, path: target };
  } catch (e) { if (e.code === 'ENOENT') return null; throw e; }
  finally { await handle?.close(); }
}

export function serializeConfig(values) {
  const text = configFields.filter((key) => values[key] !== undefined).map((key) => {
    const value = values[key];
    if (typeof value !== 'string' || /[\r\n\0]/.test(value)) throw setupError('INVALID_CONFIG_VALUE');
    const quote = ["'", '"', '`'].find((q) => !value.includes(q));
    if (!quote) throw setupError('INVALID_CONFIG_VALUE');
    return `${key}=${quote}${value}${quote}`;
  }).join('\n') + '\n';
  if (Buffer.byteLength(text) > 65536) throw setupError('CONFIG_TOO_LARGE');
  const parsed = parseEnv(text);
  if (configFields.some((key) => values[key] !== undefined && parsed[key] !== values[key])) throw setupError('INVALID_CONFIG_VALUE');
  return text;
}

export async function saveConfigFile(file, values, previous) {
  const target = await configLocation(file, true);
  const lock = target + '.lock';
  let handle;
  try { handle = await open(lock, 'wx', 0o600); }
  catch (e) { if (e.code === 'EEXIST') throw setupError('SETUP_BUSY'); throw e; }
  const temporary = `${target}.${randomUUID()}.tmp`;
  try {
    const current = await readConfigFile(target);
    if ((current?.text ?? null) !== (previous?.text ?? null)) throw setupError('CONFIG_CHANGED');
    const output = await open(temporary, 'wx', 0o600);
    try { await output.writeFile(serializeConfig(values), 'utf8'); await output.sync(); }
    finally { await output.close(); }
    await rename(temporary, target);
  } finally {
    await handle.close();
    await unlink(temporary).catch(() => {});
    await unlink(lock);
  }
  return target;
}

// Only the new default-file launcher uses this; explicit paths retain strict read-only checks.
export async function prepareDefaultConfig(file) {
  if (process.platform === 'win32') return;
  const target = await configLocation(file, false, { checkPermissions: false });
  const parent = dirname(target);
  // A directory alias is not authority to chmod its physical destination.
  if (parent !== dirname(resolve(file))) throw setupError('CONFIG_PATH_REDIRECTED');
  let directory, credential;
  try {
    const beforeDirectory = await lstat(parent);
    const beforeFile = await lstat(target);
    if (!beforeDirectory.isDirectory() || beforeDirectory.uid !== process.getuid()) throw setupError('PRIVATE_DIRECTORY_REQUIRED');
    if (!beforeFile.isFile() || beforeFile.nlink !== 1 || beforeFile.uid !== process.getuid()) throw setupError('REGULAR_CONFIG_FILE_REQUIRED');
    directory = await open(parent, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    credential = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const dir = await directory.stat(), item = await credential.stat();
    if (dir.ino !== beforeDirectory.ino || dir.dev !== beforeDirectory.dev ||
        item.ino !== beforeFile.ino || item.dev !== beforeFile.dev || item.nlink !== 1 ||
        dir.uid !== process.getuid() || item.uid !== process.getuid()) throw setupError('CONFIG_CHANGED');
    if ((dir.mode & 0o777) !== 0o700) await directory.chmod(0o700);
    if ((item.mode & 0o777) !== 0o600) await credential.chmod(0o600);
    const afterDir = await lstat(parent), afterFile = await lstat(target);
    if (afterDir.ino !== dir.ino || afterDir.dev !== dir.dev || afterFile.ino !== item.ino ||
        afterFile.dev !== item.dev || afterFile.nlink !== 1) throw setupError('CONFIG_CHANGED');
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  } finally {
    await credential?.close();
    await directory?.close();
  }
}

function validateConfigText(text) {
  const seen = new Set();
  for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!match || seen.has(match[1])) throw setupError('INVALID_CONFIG_FILE');
    seen.add(match[1]);
    const value = match[2];
    if (['"', "'", '`'].includes(value[0])) {
      const end = value.indexOf(value[0], 1);
      if (end < 0 || !/^\s*(?:#.*)?$/.test(value.slice(end + 1))) throw setupError('INVALID_CONFIG_FILE');
    }
  }
}
