# CloudBase HTML MCP

简体中文 | [English](README.en.md)

让桌面 AI Agent 将本地 HTML 发布到你自己的 CloudBase 环境，持续更新同一 URL，也能下线并从本地文件恢复。

**v0.4.0-beta.1：公开测试版。** 本地 STDIO MCP · 六工具 · MIT。当前源码已通过 macOS/Windows CI，相关修复尚未发布到 npm；桌面客户端实测仍待完成。见 [验证状态](PROJECT.md#v04-验证与发布安排)。

## 快速接入

主线是 **Node.js 22+ → 放好完整配置文件 → 添加 MCP → 验证**。首次使用可先看 [Node 安装说明](docs/getting-started.md#prepare-node)。无需 CloudBase CLI；管理员发 Key 的用户无需 CloudBase 登录，也不必经过终端向导。

1. 向管理员领取已填好的 `credentials.env`，或自行填写 [模板](templates/credentials.env.example) 中的环境 ID、地域和管理端 API Key。从零准备 CloudBase 请看 [首次准备](docs/getting-started.md#new-to-cloudbase)。
2. 放到自己用户主目录下的 `.config/cloudbase-html-mcp/credentials.env`。[放置说明](docs/getting-started.md#for-the-recipient) 包含 Finder 和 Windows 资源管理器操作，不需要在每个客户端重填三个值。
3. 添加名为 `cloudbase_html` 的本地 **STDIO** MCP。按 [客户端指南](docs/clients.md) 接入 QoderWork、豆包工作、WorkBuddy 或千问办公；提供完整 JSON、整条命令和分离参数三种形式。
4. 重载 MCP，确认六工具可见，调用 `hosting_status` 和 `list_html`。核对目标环境，新用户列表为空属于正常；这些检查不会发布页面。

macOS 使用以下固定版本命令：

```sh
npx -y cloudbase-html-mcp@0.4.0-beta.1 serve
```

Windows 使用 [对应模板](templates/mcp.windows.json) 的命令包装。也可使用 [源码或本地安装包](docs/getting-started.md#install-from-source-or-a-local-package)。Node 需要预先可用，npm 包不内置运行时。

接入后，可以对 Agent 说：

> 将 `/absolute/path/report.html` 发布到我配置的 CloudBase 环境，给我链接和验证结果。

## 工具

| 工具 | 用途 |
| --- | --- |
| `hosting_status` | 检查凭据/托管，报告配置来源与登记设置；上传和删除权限仍未测试。 |
| `publish_html` | 发布指定本地 HTML，或更新在线页面。 |
| `get_html` | 按 ID、URL 或登记路径查询，包括云端内容与公网验证。 |
| `list_html` | 列出本地已知站点及最近确认状态。 |
| `offline_html` | 删除当前云端 HTML 和旧快照，保留本地登记。 |
| `online_html` | 从本次明确指定的文件恢复已登记离线站点。 |

更新或下线前先查询并传入返回的哈希。域名映射不变时 URL 保持不变。详见 [示例](docs/getting-started.md#6-first-use) 和 [工具契约](docs/architecture.md#3-工具契约)；MCP 工具发现也会提供参数说明。

## 发布前须知

- 单份非空 UTF-8 `.html`/`.htm` 文件，绝对路径，最多 5 MiB；关联的本地资源不会上传。
- 本地文件是内容来源。不备份 HTML、不新增项目快照；列表/下线/恢复依赖本地登记，不跨机器同步。
- 下线删除云端内容，请保留本地文件以便恢复。COS 原生版本控制是独立机制；启用、暂停或无法核实时阻止破坏性清理。普通更新不清理旧快照。
- 存储成功与公网验证分开。`PUBLISHED` 表示公网 HTML 校验通过；`PUBLISHED_PREVIEW` 表示内容一致但有默认域名预览限制；`UPLOADED_NOT_PUBLICLY_VERIFIED` 表示公网尚未验证。默认域名可能出现提示页或触发下载。

## 文档与开发

- [快速开始](docs/getting-started.md)：管理员/收件人流程、可选向导、其他安装方式及排错。
- [桌面客户端](docs/clients.md)：手工接入与实际兼容性状态。
- [架构说明](docs/architecture.md)：配置、契约、生命周期时序及验证。
- [旧快照清理](docs/getting-started.md#existing-v02-installations) · [项目边界与验证状态](PROJECT.md)。

```sh
npm ci --ignore-scripts
npm run test:prepare
npm run check
npm test
```

`test:prepare` 联网准备独立的 npm 测试缓存；`npm test` 本身离线，包含真实 STDIO 子进程及本地安装包测试，云端使用替身。依赖变更或缓存清理后重新准备。macOS/Windows、Node 22/24 的 CI 矩阵与桌面客户端、真实云端验收分开记录。

## 许可证

[MIT](LICENSE)。依赖遵循各自许可证。本项目为独立工具，不是腾讯云官方产品。
