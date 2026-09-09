#!/usr/bin/env node
// Check the runtime before importing modules that require Node 22 APIs.
if (Number(process.versions.node.split('.')[0]) < 22) {
  process.stderr.write('CloudBase HTML MCP requires Node.js 22 or newer.\n');
  process.exitCode = 1;
} else {
  const args = process.argv.slice(2);
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    console.log(`CloudBase HTML MCP\nUsage: cloudbase-html-mcp [serve [--config ABSOLUTE_PATH | --env]]\n       cloudbase-html-mcp setup [setup options]\n       cloudbase-html-mcp --version\nDefault config: <user home>/.config/cloudbase-html-mcp/credentials.env\nPlace the completed file there, add this MCP to your client, and call hosting_status.\nNode.js 22+ required. Reload the MCP after changing configuration.`);
  } else if (args.length === 1 && args[0] === '--version') {
    const { VERSION } = await import('../src/version.mjs');
    console.log(VERSION);
  } else if (args[0] === 'setup') {
    process.argv = [process.argv[0], process.argv[1], ...args.slice(1)];
    await import('../scripts/setup.mjs');
  } else {
    try {
      const { parseServeArgs, serve } = await import('../src/launch.mjs');
      await serve(parseServeArgs(args[0] === 'serve' ? args.slice(1) : args));
    } catch {
      process.stderr.write('CloudBase HTML MCP: 启动失败；使用 --help 核对命令。--config 与 --env 不能同时使用。\n');
      process.exitCode = 1;
    }
  }
}
