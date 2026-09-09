import { homedir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { readConfig, CloudBase, PublishError } from './cloudbase.mjs';
import { readConfigFile, prepareDefaultConfig, configFields } from './config-file.mjs';
import { Publisher } from './publisher.mjs';
import { PageRegistry } from './registry.mjs';
import { createServer } from './server.mjs';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

export const defaultConfigPath = (home = homedir()) => join(home, '.config', 'cloudbase-html-mcp', 'credentials.env');

export function parseServeArgs(args) {
  if (!args.length) return {};
  if (args.length === 1 && args[0] === '--env') return { environment: true };
  if (args.length === 2 && args[0] === '--config' && isAbsolute(args[1])) return { configFile: args[1] };
  throw new PublishError('CONFIG', 'INVALID_LAUNCH_ARGUMENTS');
}

export async function loadLaunchConfig(options = {}, { env = process.env, home = homedir() } = {}) {
  const path = options.environment ? undefined : options.configFile ?? defaultConfigPath(home);
  const configuration = { source: options.environment ? 'environment' : options.configFile ? 'explicit_file' : 'default_file',
    ...(path ? { path } : {}) };
  try {
    let values;
    if (options.environment) values = Object.fromEntries(configFields.filter((key) => env[key] !== undefined).map((key) => [key, env[key]]));
    else {
      if (!options.configFile) await prepareDefaultConfig(path);
      const file = await readConfigFile(path, { strict: true });
      if (!file) throw new PublishError('CONFIG', 'CONFIG_FILE_MISSING');
      configuration.path = file.path;
      values = file.values;
    }
    const config = readConfig(values);
    if (!/^[\x21-\x7e]+$/.test(config.apiKey)) throw new PublishError('CONFIG', 'INVALID_API_KEY_FORMAT');
    return { config, configuration };
  } catch (error) {
    // Never forward raw parser/filesystem errors: they may contain input values.
    const code = error instanceof PublishError ? error.code : 'CONFIG_FILE_UNREADABLE';
    return { configuration, error: new PublishError('CONFIG', code, {
      configuration, ...(error instanceof PublishError && error.details.missing ? { missing: error.details.missing } : {}),
    }) };
  }
}

export async function serve(options) {
  const loaded = await loadLaunchConfig(options);
  const server = createServer(() => {
    if (loaded.error) throw loaded.error;
    const { config } = loaded;
    return new Publisher(new CloudBase(config), fetch, config.registryDir ? new PageRegistry(config.registryDir, config) : null);
  }, { configuration: loaded.configuration });
  await server.connect(new StdioServerTransport());
}
