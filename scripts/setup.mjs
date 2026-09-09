import { parseSetupArgs, runSetup, setupHelp, setupFailure, terminalPrompt } from '../src/setup.mjs';

try {
  const options = parseSetupArgs(process.argv.slice(2));
  if (options.help) console.log(setupHelp);
  else {
    const ask = terminalPrompt();
    const result = await runSetup(options, { ask, report: (message) => process.stderr.write(message + '\n') });
    process.stderr.write(`连接检查通过，配置已就绪: ${result.envFile}\n上传权限与公网页面未测试。域名发现: ${result.verification.domainDiscovery}\n将下面的对应片段合并到客户端，保留其他配置；重载后调用 hosting_status 完成接入。\n`);
    console.log('JSON (mcpServers):\n' + JSON.stringify(result.json, null, 2));
    console.log('\nTOML (Codex):\n' + result.toml);
  }
} catch (error) {
  process.stderr.write(setupFailure(error) + '\n');
  process.exitCode = error.code === 'SETUP_CANCELLED' ? 130 : 1;
}
