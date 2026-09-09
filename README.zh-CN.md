# CloudBase HTML MCP

[English](README.md) | 简体中文

让 AI Agent 将本地 HTML 文件发布到你自己的 CloudBase 环境：获得分享链接、持续更新同一页面，也能下线并从本地文件恢复。

**v0.3.0** · 本地 STDIO MCP · 六个工具 · MIT · 无需 CloudBase CLI 或完整插件。

## 快速接入

你需要 **Node.js 22+**、支持本地 STDIO MCP 的客户端，以及已开启静态托管的 CloudBase 环境。准备好对应的**环境 ID、地域和管理端 API Key**。管理员发给你 Key 的场景无需 CloudBase 账号登录；从零开始请看 [CloudBase 首次准备](docs/getting-started.md#new-to-cloudbase)。

### 交给 Agent 接入

把下面这段指令复制给本地 coding agent：

> 阅读 https://raw.githubusercontent.com/zyfasos/cloudbase-html-mcp/main/docs/getting-started.md ，帮我安装并注册 cloudbase_html MCP。复用已有安装和管理员提供的连接信息；让我在本机终端向导中隐藏输入 API Key，不在聊天中收集 Key。缺少客户端或非密钥连接信息时集中问我。完成只读连通验证，接入时不要发布页面。

### 手动安装

首次安装时，在你选定的父目录运行以下命令；已有检出目录则直接复用。

```sh
git clone https://github.com/zyfasos/cloudbase-html-mcp.git
cd cloudbase-html-mcp
npm ci --ignore-scripts
npm run setup
```

向导收集连接信息、隐藏输入 Key，并进行只读检查。通过后将凭据保存到 Git 仓库外的私密文件，输出不含 Key 的 JSON/TOML 客户端配置。合并该配置、重载客户端，再调用 `hosting_status`；六个工具均可用且该调用成功，即完成接入。

配置示例与排错步骤见 [快速开始](docs/getting-started.md)。当前从源码安装，尚未发布 npm 包。

接入后，指定自己的文件让 Agent 发布：

> 将 `/absolute/path/report.html` 发布到我配置的 CloudBase 环境，给我链接及验证结果。

## 工具

| 工具 | 用途 |
| --- | --- |
| `hosting_status` | 检查凭据和静态托管，报告是否启用本地登记；不测试上传或删除权限。 |
| `publish_html` | 发布本地 HTML，或更新在线页面。 |
| `get_html` | 按站点 ID、URL 或登记路径查询，包括云端内容和公网验证。 |
| `list_html` | 列出本地已知站点及最近确认状态。 |
| `offline_html` | 删除该站点的当前云端 HTML 和旧快照，保留本地登记。 |
| `online_html` | 从你本次指定的文件恢复已登记的离线站点。 |

更新或下线前先查询，再传入返回的哈希以防止并发修改冲突。域名映射不变时，更新和恢复保持原 URL。详见 [使用示例](docs/getting-started.md#6-first-use) 和 [工具契约](docs/architecture.md#3-工具契约)；MCP 客户端也会在发现工具时获得参数说明。

## 发布前须知

- **仅上传一份 HTML：**绝对路径的 `.html`/`.htm` 文件，非空 UTF-8，最多 5 MiB。关联的本地资源不会上传，请内联或使用可访问的 URL。
- **本地文件是内容来源：**MCP 不备份 HTML，也不在 COS 中创建新的项目快照。列表、下线和恢复依赖本地登记，不跨机器同步。
- **下线会删除云端内容：**请保留本地文件以便恢复。COS Bucket 原生版本控制是独立机制；启用、暂停或无法核实时会阻止破坏性清理。普通更新不会删除已有项目快照。
- **上传与公网访问分开验证：**`PUBLISHED` 表示公网 HTML 校验通过；`PUBLISHED_PREVIEW` 表示内容一致，但默认域名响应有预览限制，例如 attachment 下载头；`UPLOADED_NOT_PUBLICLY_VERIFIED` 表示存储成功、公网尚未验证。默认域名可能出现提示页或触发下载。详见 [结果处理](docs/getting-started.md#update-an-existing-page)。

## 文档

- [快速开始](docs/getting-started.md)：人和 Agent 共用的接入、首次使用及排错指南。
- [架构说明与工具契约](docs/architecture.md)：组件、参数、存储、生命周期时序及测试覆盖。
- [v0.2 升级与旧快照清理](docs/getting-started.md#existing-v02-installations)。
- [项目边界与下一步](PROJECT.md)。

## 开发

```sh
npm run check
npm test
```

测试默认离线，包含使用官方 MCP SDK 和云端替身的真实 STDIO 子进程测试。真实云端及浏览器验证单独记录，详见 [验证范围](PROJECT.md#v03-当前实现)。

## 许可证

[MIT](LICENSE)。第三方依赖遵循各自许可证。本项目为独立工具，不是腾讯云官方产品。
