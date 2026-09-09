import { homedir } from 'node:os';
import { join } from 'node:path';
import { VERSION } from './version.mjs';
const query = (siteId) => ({ tool: 'get_html', action: 'verify_current', required_params: ['siteId'], suggested_args: { siteId } });
const setupGuide = (configuration) => ({
  configuration: configuration ?? { source: 'default_file', path: join(homedir(), '.config', 'cloudbase-html-mcp', 'credentials.env') },
  local_path: 'docs/getting-started.md',
  url: 'https://github.com/zyfasos/cloudbase-html-mcp/blob/main/docs/getting-started.md',
  console_url: 'https://tcb.cloud.tencent.com/dev',
  local_setup: { command: `npx -y cloudbase-html-mcp@${VERSION} setup`, cwd: 'any directory', interactive: true, secret_input: 'terminal_only' },
});

export function recoveryFor(error, args = {}, tool) {
  const { code, stage, details = {} } = error;
  const siteId = details.siteId ?? args.siteId;
  const result = (action, message, next = {}, retryable = false) => ({
    retryable, maxRetries: retryable ? 1 : 0,
    next_step: { action, message, ...next },
  });
  if (details.operation === 'offline' && siteId) {
    return result('inspect_offline', '先 get_html 核对当前对象和未完成操作；确认后用原 expectedSha256 重试 offline_html。已下线但清理未完成不能宣称空间全部回收。', {
      ...query(siteId), resume: { tool: 'offline_html', suggested_args: { siteId, expectedSha256: details.expectedSha256 } },
    });
  }
  if (code === 'PAGE_OFFLINE') {
    return result('restore_explicitly', '页面已离线。只有用户明确要求重新公开时，使用 online_html 并提供本次指定的本地 HTML；若有未完成清理，先完成下线。', {
      tool: 'online_html', required_params: ['siteId', 'localPath'], ...(siteId ? { suggested_args: { siteId } } : {}),
    });
  }
  if (['PAGE_NOT_OFFLINE', 'CLEANUP_PENDING', 'OPERATION_PENDING'].includes(code) || details.operation === 'online') {
    return result('inspect_lifecycle', '先查询云端及本地未完成操作。已在线页面走 publish_html 更新；离线清理未完成先重试 offline_html；上线超时应核对后用原 siteId 和指定文件重试 online_html。', siteId ? query(siteId) : {});
  }
  if (['VERSION_WRITE_ATTEMPTED', 'CURRENT_WRITE_ATTEMPTED', 'STORAGE_VERIFIED'].includes(details.writeState) && siteId) {
    return result('verify_current', '写入可能已生效。先查询当前对象；确认状态后再决定是否重试，不要重新创建页面。', query(siteId));
  }
  if (['VERSION_CONFLICT', 'EXPECTED_HASH_REQUIRED', 'LOCAL_SITE_EXISTS', 'LOCAL_BINDING_CONFLICT'].includes(code) && siteId) {
    return result('inspect_before_update', '先读取当前页面并核对更新目标；使用查询返回的哈希更新，不要直接覆盖冲突。', { ...query(siteId), action: 'inspect_before_update' });
  }
  if (code === 'CONFIG_REQUIRED' || stage === 'CONFIG') {
    return result('configure_environment', '将管理员填好的 credentials.env 放到 configuration.path 指定位置，或修正该文件中缺失/无效的字段，重载 MCP 后调用 hosting_status。environment 来源请修正客户端环境变量；不自动切换来源。自行配置时可使用可选 setup 向导，无需 CloudBase 账号登录；不要把 Key 放进工具参数。', { required_config: details.missing ?? [], setup_guide: setupGuide(details.configuration), tool: 'hosting_status', suggested_args: {} });
  }
  if (stage === 'CREDENTIAL_EXCHANGE') {
    return result('check_credentials', '核对环境、地域、服务端 API Key（api_key）的完整值与有效期；不能用 Publishable Key 或 CAM SecretId/SecretKey 替代。修正私人配置后重启 MCP，再用 hosting_status 验证；不自动切换环境。', { setup_guide: setupGuide(details.configuration), tool: 'hosting_status', suggested_args: {} });
  }
  if (stage === 'STATIC_STORE' && ['INVALID_RESOURCE', 'NOT_ONLINE'].includes(code)) {
    return result('check_static_hosting', '检查当前环境的静态网站托管资源和在线状态；响应不完整或尚未就绪不等于必须新建。若控制台确实要求开通，由用户确认资源与费用后操作，再调用 hosting_status；不自动创建资源或切换环境。', { setup_guide: setupGuide(details.configuration), tool: 'hosting_status', suggested_args: {} });
  }
  if (code === 'LOCAL_PAGE_NOT_FOUND') {
    return result('locate_page', '当前环境没有此路径的登记。已有页面请提供 siteId；确需新页面时再使用 publish_html。');
  }
  if (stage === 'REGISTRY') {
    const message = code === 'REGISTRY_BUSY'
      ? '等待当前环境写操作结束后再试；若进程已退出，先确认没有其他写入者，再处理遗留锁文件。'
      : '检查仓库外页面登记目录及文件权限。损坏记录需人工检查，工具不会覆盖它；已知 siteId 可直接查询页面。';
    return result('inspect_local_registry', message, siteId ? query(siteId) : {});
  }
  if (code === 'SITE_NOT_FOUND') {
    return result('check_target', '当前环境未找到这个页面。核对环境与 siteId；只有确认需要新页面时才重新发布。');
  }
  if (code === 'PUBLISH_BUSY') {
    return result('wait_for_publish', '等待当前发布完成后最多重试一次。', { tool, required_params: ['localPath'], suggested_args: args }, true);
  }
  if (stage === 'INPUT') return result('correct_input', '修正文件路径、HTML 内容或参数后重试；输入校验未通过时没有上传。');
  if (/AccessDenied|Unauthorized|Forbidden/i.test(code ?? '') || [401, 403].includes(details.httpStatus)) {
    return result('check_access', '请求被拒绝。检查该 API Key 对当前资源的权限，不自动更换环境或修改权限。', { tool: 'hosting_status', suggested_args: {} });
  }
  return result('inspect_failure', '根据阶段和错误码检查配置或服务状态；未确认写入结果前不要重复创建页面。', siteId ? query(siteId) : { tool: 'hosting_status', suggested_args: {} });
}

export function publicRecovery(siteId, publicCheck) {
  if (publicCheck.verified) return {};
  return { retryable: false, maxRetries: 0, next_step: publicCheck.defaultDomainNotice
    ? { action: 'open_preview', message: '内容一致，但默认域名可能显示平台访问提示。需无提示分享时，请配置已绑定的自定义域名。' }
    : { ...query(siteId), message: '存储已存在，但公网可用性未证实。稍后查询一次；仍失败则检查返回的域名诊断，不重复上传。', maxAttempts: 1 } };
}
