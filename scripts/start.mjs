import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { readConfigFile, configFields } from '../src/config-file.mjs';
import { createServer } from '../src/server.mjs';

try {
  if (process.argv.length !== 3) throw new Error();
  const file = await readConfigFile(process.argv[2]);
  if (!file) throw new Error();
  // The explicitly selected file owns this server's environment, including absent optional settings.
  for (const key of configFields) delete process.env[key];
  Object.assign(process.env, file.values);
  await createServer().connect(new StdioServerTransport());
} catch {
  process.stderr.write('CloudBase HTML MCP: 无法读取指定的仓库外私密配置；请核对路径、权限，或重新运行 npm run setup。\n');
  process.exitCode = 1;
}
