// A one-shot protocol client, also usable to verify the server outside an IDE.
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';

const cliArgs = process.argv.slice(2);
const configFile = cliArgs[0] === '--config' ? cliArgs.splice(0, 2)[1] : undefined;
const [tool, args = '{}'] = cliArgs;
const env = {};
for (const name of ['CLOUDBASE_ENV_ID', 'CLOUDBASE_REGION', 'CLOUDBASE_API_KEY', 'CLOUDBASE_PUBLIC_BASE_URL', 'CLOUDBASE_REGISTRY_DIR']) {
  if (process.env[name]) env[name] = process.env[name];
}
const client = new Client({ name: 'cloudbase-html-cli', version: '0.3.0' });
const transport = new StdioClientTransport({ command: process.execPath,
  args: configFile ? [fileURLToPath(new URL('./start.mjs', import.meta.url)), configFile]
    : [fileURLToPath(new URL('../src/server.mjs', import.meta.url))], env, stderr: 'inherit' });
try {
  if (process.argv[2] === '--config' && !configFile) throw new Error();
  await client.connect(transport);
  const response = tool === 'list' ? await client.listTools()
    : await client.callTool({ name: tool, arguments: JSON.parse(args) }, undefined, { timeout: 180000 });
  console.log(JSON.stringify(response.structuredContent ?? response, null, 2));
  if (response.isError) process.exitCode = 1;
} catch {
  process.stderr.write('CloudBase HTML MCP: 调用失败；核对工具名、JSON 参数及指定的配置文件。\n');
  process.exitCode = 1;
} finally { await client.close(); }
