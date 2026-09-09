import { VERSION } from './version.mjs';
import { open } from 'node:fs/promises';
import { homedir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import { emitKeypressEvents } from 'node:readline';
import { CloudBase, readConfig, PublishError } from './cloudbase.mjs';
import { configLocation, readConfigFile, saveConfigFile, serializeConfig, setupError } from './config-file.mjs';

export const setupHelp = `CloudBase HTML MCP 本地接入 / Local setup
用法: cloudbase-html-mcp setup [--env-id ID --region REGION] [--connection /absolute/connection.json]
                       [--config /absolute/credentials.env]
连接 JSON 只允许 envId、region；禁止放入 API Key。
Key 仅在真实终端隐藏输入，不接受命令参数或管道；无需 CloudBase 账号登录。
源码检出也可 npm run setup -- [选项]。
默认文件: ~/.config/cloudbase-html-mcp/credentials.env
已有配置默认复用，也可确认修改。只读检查通过后保存并输出 JSON/TOML 接入片段。
不自动修改客户端配置、不发布 HTML。使用 --help 查看本说明。`;

export function parseSetupArgs(args) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) return { help: true };
  const names = { '--env-id': 'envId', '--region': 'region', '--connection': 'connection', '--config': 'envFile' };
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = Object.hasOwn(names, args[i]) ? names[args[i]] : undefined;
    if (!key || options[key] !== undefined || !args[i + 1] || args[i + 1].startsWith('--')) throw setupError('INVALID_SETUP_ARGUMENTS');
    options[key] = args[i + 1];
  }
  return options;
}

export async function connectionOptions(options) {
  let preset = {};
  if (options.connection) {
    if (!isAbsolute(options.connection)) throw setupError('ABSOLUTE_CONNECTION_PATH_REQUIRED');
    const handle = await open(options.connection);
    let data;
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.size > 4096) throw setupError('INVALID_CONNECTION_FILE');
      data = await handle.readFile();
    } finally { await handle.close(); }
    try { preset = JSON.parse(data.toString('utf8')); }
    catch { throw setupError('INVALID_CONNECTION_FILE'); }
    if (!preset || Array.isArray(preset) || typeof preset !== 'object' ||
      Object.keys(preset).some((key) => !['envId', 'region'].includes(key))) throw setupError('INVALID_CONNECTION_FILE');
  }
  for (const key of ['envId', 'region']) {
    if (preset[key] !== undefined && options[key] !== undefined && preset[key] !== options[key]) throw setupError('CONFLICTING_CONNECTION_OPTIONS');
    preset[key] = options[key] ?? preset[key];
    if (preset[key] !== undefined && (typeof preset[key] !== 'string' ||
      !(key === 'envId' ? /^[a-zA-Z0-9-]{1,64}$/ : /^[a-z0-9-]{2,32}$/).test(preset[key]))) throw setupError('INVALID_ENV_OR_REGION');
  }
  return preset;
}

export function terminalPrompt(input = process.stdin, output = process.stderr) {
  if (!input.isTTY || !output.isTTY || typeof input.setRawMode !== 'function') throw setupError('INTERACTIVE_TERMINAL_REQUIRED');
  emitKeypressEvents(input);
  return (label, { secret = false, defaultValue = '' } = {}) => new Promise((resolve, reject) => {
    let value = '';
    const wasRaw = input.isRaw;
    const finish = (error) => {
      input.off('keypress', keypress);
      input.off('end', ended);
      input.off('error', failed);
      input.setRawMode(Boolean(wasRaw));
      input.pause();
      output.write('\n');
      if (error) reject(error); else resolve(value || defaultValue);
    };
    const ended = () => finish(setupError('SETUP_CANCELLED'));
    const failed = () => finish(setupError('TERMINAL_READ_FAILED'));
    const keypress = (text, key = {}) => {
      if (key.ctrl && ['c', 'd'].includes(key.name)) return ended();
      if (['return', 'enter'].includes(key.name)) return finish();
      if (key.name === 'backspace') {
        if (value) { value = value.slice(0, -1); if (!secret) output.write('\b \b'); }
      } else if (text && !key.ctrl && !key.meta && /^[\x20-\x7e]+$/.test(text)) {
        if (value.length + text.length > 16384) return finish(setupError('INPUT_TOO_LONG'));
        value += text;
        if (!secret) output.write(text);
      }
    };
    input.on('keypress', keypress);
    input.once('end', ended);
    input.once('error', failed);
    input.setRawMode(true);
    input.resume();
    // Disable OS echo before revealing the prompt: fast paste can arrive immediately.
    output.write(`${label}${defaultValue && !secret ? ` [${defaultValue}]` : ''}: `);
  });
}

export async function verifyConnection(config) {
  const store = await new CloudBase(config).connect();
  return { credentialExchange: 'VERIFIED', staticHosting: 'ONLINE',
    domainDiscovery: store.domainDiscovery?.state ?? 'UNKNOWN',
    uploadPermission: 'NOT_TESTED', publicVerification: 'NOT_TESTED' };
}

export function clientConfiguration(envFile, platform = process.platform) {
  const command = platform === 'win32' ? 'cmd.exe' : 'npx';
  const defaultFile = join(homedir(), '.config', 'cloudbase-html-mcp', 'credentials.env');
  const useDefault = platform === 'win32' && envFile.toLowerCase() === defaultFile.toLowerCase();
  // cmd.exe expands metacharacters even in some quoted arguments. Default mode needs no path argument.
  if (platform === 'win32' && !useDefault && /[&|<>^%!"()\r\n]/.test(envFile)) throw setupError('UNSAFE_WINDOWS_CONFIG_PATH');
  const args = [...(platform === 'win32' ? ['/d', '/c', 'npx'] : []), '-y', `cloudbase-html-mcp@${VERSION}`, 'serve',
    ...(useDefault ? [] : ['--config', envFile])];
  return {
    json: { mcpServers: { cloudbase_html: { command, args } } },
    toml: `[mcp_servers.cloudbase_html]\ncommand = ${JSON.stringify(command)}\nargs = ${JSON.stringify(args)}\nstartup_timeout_sec = 180\ntool_timeout_sec = 180\nenabled_tools = ["hosting_status", "publish_html", "get_html", "list_html", "offline_html", "online_html"]\n`,
  };
}

export async function runSetup(options, { ask, report = () => {}, verify = verifyConnection } = {}) {
  const preset = await connectionOptions(options);
  const envFile = await configLocation(options.envFile ?? join(homedir(), '.config', 'cloudbase-html-mcp', 'credentials.env'));
  clientConfiguration(envFile); // Validate representability before prompting, checking cloud access or saving.
  const previous = await readConfigFile(envFile, { strict: true });
  const values = { ...previous?.values };
  let edit = !previous;
  if (previous) {
    const choice = (await ask('已找到配置：回车复用，输入 edit 修改', { defaultValue: 'reuse' })).trim();
    if (!['reuse', 'edit'].includes(choice)) throw setupError('INVALID_SETUP_CHOICE');
    edit = choice === 'edit';
  }
  for (const [name, key] of [['envId', 'CLOUDBASE_ENV_ID'], ['region', 'CLOUDBASE_REGION']]) {
    if (!edit && preset[name] !== undefined && preset[name] !== values[key]) throw setupError('EXISTING_CONFIG_CONFLICT');
    if (edit) values[key] = preset[name] ?? (await ask(name === 'envId' ? 'CloudBase 环境 ID' : 'CloudBase 地域（例如 ap-shanghai）', { defaultValue: values[key] ?? '' })).trim();
  }
  if (edit) {
    values.CLOUDBASE_API_KEY = (await ask(previous?.values.CLOUDBASE_API_KEY
      ? 'API Key（隐藏输入；回车保留原 Key）' : 'API Key（隐藏输入）',
    { secret: true, defaultValue: previous?.values.CLOUDBASE_API_KEY ?? '' })).trim();
  }
  const config = readConfig(values);
  if (!/^[\x21-\x7e]+$/.test(config.apiKey)) throw setupError('INVALID_API_KEY_FORMAT');
  serializeConfig(values);
  report(`目标环境: ${config.envId} / ${config.region}\n配置文件: ${envFile}`);
  const confirm = (await ask('只读检查连接，并保存上述接入设置？[Y/n]', { defaultValue: 'y' })).trim().toLowerCase();
  if (!['y', 'yes', 'n', 'no'].includes(confirm)) throw setupError('INVALID_SETUP_CHOICE');
  if (['n', 'no'].includes(confirm)) throw setupError('SETUP_CANCELLED');
  report('正在检查凭据和静态托管，不上传或删除文件…');
  const verification = await verify(config);
  const target = edit ? await saveConfigFile(envFile, values, previous) : envFile;
  if (!edit && (await readConfigFile(target))?.text !== previous.text) throw setupError('CONFIG_CHANGED');
  return { envFile: target, verification, ...clientConfiguration(target) };
}

export function setupFailure(error) {
  const tips = {
    INTERACTIVE_TERMINAL_REQUIRED: `请在本机真实终端运行 npx -y cloudbase-html-mcp@${VERSION} setup；源码检出可用 npm run setup。不要通过聊天、管道或命令参数传入 Key。`,
    PRIVATE_DIRECTORY_REQUIRED: '请使用你拥有的专用目录，并在 macOS/Linux 将该目录权限设为 0700。',
    UNSAFE_WINDOWS_CONFIG_PATH: 'Windows 自定义配置路径包含命令解释字符；请使用默认用户目录，或无这些字符的专用绝对路径。',
    PRIVATE_FILE_REQUIRED: '请在 macOS/Linux 将指定配置文件权限设为 0600，且确保归当前用户所有。',
    CONFIG_INSIDE_REPOSITORY: '请用 --config 指定 Git 仓库外的私密文件。',
    INVALID_CONFIG_PATH: '请指定可明确解析的文件绝对路径；不要以斜线、. 或 .. 结尾，也不要在不存在的目录后使用 ..。',
    SETUP_BUSY: '另一个向导正在保存；进程退出后遗留的 .lock 需确认没有写入者再移除。',
    EXISTING_CONFIG_CONFLICT: '预填环境与已有文件不同；重新运行并选择 edit，或指定新的 --config。',
    CONFIG_CHANGED: '配置在接入过程中被其他进程修改；重新运行并核对。',
    CONFIG_REQUIRED: '配置不完整；重新运行并选择 edit 补齐环境、地域和 API Key。',
    SETUP_CANCELLED: '已取消。',
  };
  // Remote exceptions may include request headers; never print raw errors or arguments.
  const localCodes = new Set([...Object.keys(tips), 'INVALID_SETUP_ARGUMENTS', 'INVALID_SETUP_CHOICE',
    'ABSOLUTE_CONNECTION_PATH_REQUIRED', 'INVALID_CONNECTION_FILE', 'CONFLICTING_CONNECTION_OPTIONS',
    'INVALID_ENV_OR_REGION', 'ABSOLUTE_CONFIG_PATH_REQUIRED', 'REGULAR_CONFIG_FILE_REQUIRED',
    'CONFIG_TOO_LARGE', 'INVALID_CONFIG_FILE', 'UNSUPPORTED_CONFIG_FIELDS', 'INVALID_CONFIG_VALUE', 'INVALID_API_KEY_FORMAT',
    'ABSOLUTE_REGISTRY_PATH_REQUIRED', 'TERMINAL_READ_FAILED', 'INPUT_TOO_LONG']);
  let code = 'SETUP_FAILED';
  if (error instanceof PublishError) {
    if (['SETUP', 'CONFIG'].includes(error.stage) && localCodes.has(error.code)) code = error.code;
    else if (error.stage === 'CREDENTIAL_EXCHANGE') code = 'CREDENTIAL_EXCHANGE_FAILED';
    else if (error.stage === 'STATIC_STORE') code = 'STATIC_HOSTING_CHECK_FAILED';
  }
  return `${code}: ${tips[code] ?? '请核对连接信息、Key、静态托管状态和文件路径后重试。原配置不会因检查失败而被替换。'}`;
}
