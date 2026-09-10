# CloudBase HTML MCP

简体中文 | [English](README.en.md)

**让 Agent 生成的 HTML，更方便地被分享、阅读和继续迭代。** 指定一个本地文件，发布到自己的 CloudBase 环境，拿到可持续更新的链接。

本地 STDIO MCP · 六工具 · MIT · 当前测试版 `0.4.0-beta.4`。[验证状态](PROJECT.md#v04-验证与发布安排)

## 为什么做这个工具

当 Agent 已经生成了一份可用的分析报告、HTML 演示或交互小工具，接下来的需求往往很简单：发给同事或客户看，修改后继续用同一个链接。文件做好了，却还要传附件、解释如何打开，或切到托管平台完成上传和链接管理，分享就成了额外的一段工作。

这个工具起于这样的日常场景：**让“把这份 HTML 发出去”成为 Agent 可以直接完成的一个动作。** 对需要图表、版式或交互的内容，HTML 能让读者在浏览器中查看和操作，也保留了可交给 Agent 继续修改的源码。Markdown 仍适合轻量文本和协作记录；这里关注的是 HTML 产物生成之后的分享与迭代。

因此，项目围绕单个 HTML 提供发布、同链接更新、查询、下线和恢复。已有相近的发布工具，我们选择面向国内桌面 Agent 用户，采用本地产物、用户自己的 CloudBase 环境和可整份交付的配置文件。[定位与相近工具](PROJECT.md#positioning-and-related-tools)

## CloudBase 在这里做什么

[CloudBase（腾讯云开发）](https://cloudbase.net/) 是腾讯云提供的云开发平台，包含数据库、云函数、存储、网站托管等能力。本工具主要使用其中的 [静态网站托管](https://docs.cloudbase.net/hosting/web-hosting-static)：通过环境 API Key 认证，把 HTML 存放到托管资源的 COS 对象中，再核对域名路由与公网访问结果。

云资源位于你配置的 CloudBase 环境里；本工具只提供单 HTML 分享所需的六项操作，MCP 在用户电脑上运行，云端使用已配置的托管资源。管理员可以将填好的配置文件交给使用者，使用者无需登录 CloudBase 控制台。工具采用 MIT 开源，CloudBase 套餐、存储和流量费用另按云服务规则计算。

## 快速接入

主线是 **Node.js 22+ → 放好配置文件 → 粘贴 MCP JSON → 验证**。

1. 准备 [Node.js 22+](docs/getting-started.md#prepare-node)。
2. 领取管理员填好的 `credentials.env`，放到用户主目录的 `.config/cloudbase-html-mcp/credentials.env`；自行配置请看 [获取 API Key](docs/getting-started.md#get-cloudbase-api-key) 和 [文件放置说明](docs/getting-started.md#for-the-recipient)。
3. 在客户端的 JSON 导入或 MCP 配置编辑器中，按操作系统使用下面的配置。已有 `mcpServers` 时只合并 `cloudbase_html` 条目，保留其他连接器；这个 JSON 不需要填 Key。

**macOS** · [JSON 文件](templates/mcp.macos.json)

```json
{
  "mcpServers": {
    "cloudbase_html": {
      "command": "npx",
      "args": ["-y", "cloudbase-html-mcp@0.4.0-beta.4", "serve"]
    }
  }
}
```

**Windows** · [JSON 文件](templates/mcp.windows.json)

```json
{
  "mcpServers": {
    "cloudbase_html": {
      "command": "cmd.exe",
      "args": ["/d", "/c", "npx", "-y", "cloudbase-html-mcp@0.4.0-beta.4", "serve"]
    }
  }
}
```

WorkBuddy、千问办公和 QoderWork 的入口与依据见 [客户端指南](docs/clients.md#json-import--json-导入)。豆包工作目前按已确认的 STDIO 表单填入对应 `command` 和 `args`；不要把整段 JSON 粘到“命令”框。

保存并重载 MCP，然后让 Agent 调用 `hosting_status`、`list_html` 验证。确认目标环境后，即可说：

> 将 `/absolute/path/report.html` 发布到我配置的 CloudBase 环境，给我链接和验证结果。

详见 [快速开始](docs/getting-started.md)。[源码或本地包](docs/getting-started.md#install-from-source-or-a-local-package) 和可选终端向导适合开发与排错。

## 工具

| 工具 | 用途 |
| --- | --- |
| `hosting_status` | 检查凭据/托管，报告配置来源与登记设置；此检查不验证上传和删除权限。 |
| `publish_html` | 发布指定本地 HTML，或更新在线页面。 |
| `get_html` | 按 ID、URL 或登记路径查询，包括云端内容与公网验证。 |
| `list_html` | 列出本地已知站点及最近确认状态。 |
| `offline_html` | 删除当前云端 HTML 和旧快照，保留本地登记。 |
| `online_html` | 从本次明确指定的文件恢复已登记离线站点。 |

更新或下线前先查询并传入返回的哈希。域名映射不变时 URL 保持不变。详见 [示例](docs/getting-started.md#6-first-use) 和 [工具契约](docs/architecture.md#3-工具契约)；MCP 工具发现也会提供参数说明。

<a id="发布前须知"></a>
## 适用范围

- 适合报告、HTML 演示、原型预览和轻量交互页面。上传单份非空 UTF-8 `.html`/`.htm` 文件，最多 5 MiB；关联的本地图片、CSS、JS 不会一起上传，发布前应确认页面可独立使用。
- 发布产生公网访问链接。本工具不提供读者登录、密码保护或协同编辑；请发布适合通过公网链接分享的内容。
- 本地文件是内容来源。不备份 HTML、不新增项目快照；列表/下线/恢复依赖本地登记，不跨机器同步。
- 下线删除云端内容，保留本地文件才能恢复；不清除浏览器/CDN 缓存。COS 原生版本控制启用、暂停或无法核实时，会阻止破坏性清理。
- 存储成功与公网验证分开。默认域名可能出现提示页或触发下载；`PUBLISHED_PREVIEW` 表示内容一致但有预览限制，正式分享体验见 [状态说明](docs/getting-started.md#update-an-existing-page)。

## 文档与开发

- [快速开始](docs/getting-started.md)：管理员/收件人流程、API Key、JSON 接入、可选向导及排错。
- [桌面客户端](docs/clients.md)：手工接入格式、客户端差异与实际兼容性状态。
- [架构说明](docs/architecture.md)：配置、契约、生命周期时序及验证。
- [旧快照清理](docs/getting-started.md#existing-v02-installations) · [项目边界与验证状态](PROJECT.md)。

```sh
npm ci --ignore-scripts
npm run test:prepare
npm run check
npm test
```

`test:prepare` 联网准备独立 npm 测试缓存；`npm test` 离线，包含真实 STDIO 子进程及本地安装包测试，云端使用替身。依赖变更或缓存清理后重新准备。CI 与桌面客户端、真实云端验收分开记录。

## 许可证

[MIT](LICENSE)。依赖遵循各自许可证。本项目为独立工具，不是腾讯云官方产品。
