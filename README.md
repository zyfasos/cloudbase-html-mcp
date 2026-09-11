# CloudBase HTML MCP

简体中文 | [English](README.en.md)

**把 Agent 生成的单 HTML，发布到自己的 CloudBase，持续更新同一个分享链接。**

面向经常分享报告、演示、原型和小工具的个人与小团队。通过支持本地 STDIO MCP 的 Agent，直接完成发布、检索、更新、下线与恢复；既可自行配置环境，也可领取管理员准备好的配置文件接入。

<!-- release:version -->
本地 STDIO MCP · 六工具 · MIT · 当前预发布版本 `0.5.0-beta.1`。[验证状态](PROJECT.md#v05-release)
<!-- /release:version -->

<a id="为什么做这个工具"></a>
## 为什么选择它

Agent 已经做好了页面，分享却还要传附件、解释如何打开、手动上传和管理链接。这个工具把这些后续操作接回对话，让使用者继续专注于内容。

- **专注单 HTML**：围绕发布、同链接更新、查询、下线和恢复提供六项操作；不要求为每份产物建立工程或配置构建流程。
- **接入不绑定 Agent 品牌**：CLI、IDE 或桌面客户端只要能启动本地 STDIO MCP，就可按各自格式配置；具体支持情况见 [Agent 接入指南](docs/clients.md)。
- **配置可以整份交付**：管理员准备好环境和 `credentials.env`，使用者放好文件并接入，无需拆分填写云参数或登录 CloudBase 控制台。
- **本地产物与自己的云环境**：HTML 源文件留在本地，内容发布到自己的 CloudBase 静态托管；无需另行部署远程 MCP 服务或业务数据库。

这里的轻量指单文件工作流和维护范围集中；不表示安装体积、速度或 Token 消耗优于其他工具。若 Agent 的内置发布已满足需求，可以继续使用；需要自己的云环境、统一发布方式和后续管理时，再选择本工具。

[CloudBase（腾讯云开发）](https://cloudbase.net/) 提供云端托管能力。本项目聚焦已有单页产物的分享与管理；与通用 CLI、其他发布工具的关系见 [定位与相近工具](PROJECT.md#positioning-and-related-tools)。

## 典型场景

| 你已有的产物与需求 | 对 Agent 说什么 | 得到什么 |
| --- | --- | --- |
| 一份分析报告或 HTML 演示，准备分享 | “把这份 HTML 发布，给我链接和验证结果。” | 接收者通过链接查看，无需接收本地文件附件。 |
| 原型、计算器或说明页需要反复修改 | “把修改后的文件更新到原链接。” | 已分享的入口保持不变，再次发布后呈现新内容。 |
| 临时展示结束，之后还会再次使用 | “下线这个页面”；再次使用时指定本地文件恢复。 | 云端内容删除，本地登记保留，可恢复原站点。 |

![HTML 发布与管理流程：本地 HTML 发布或更新为在线页面；下线时删除云端内容并保留本地登记；指定本地文件可恢复原站点。](docs/images/html-lifecycle.png)

`publish_html` 发布或更新在线页面；`offline_html` 删除云端内容并保留登记；`online_html` 从本次指定的本地文件恢复。

`hosting_status` 检查接入，`get_html` 查询单页，`list_html` 查看本地已知站点。域名映射不变时，更新和恢复保持 URL 不变；公网验证与存储成功分别报告，默认域名可能有预览限制，见 [适用范围](#适用范围)。

本版新增：发布时可设置站点名称、自动提取 HTML 标题；按名称、标题或来源文件名搜索。资源诊断列出静态引用及本地检查结果，仍只上传原 HTML，不自动内嵌资源。详见 [资源诊断与站点检索](docs/getting-started.md#resource-diagnostics)。**已发布到 npm 的 beta 标签**；请使用下方固定版本配置。

## 快速接入

主线是 **Node.js 22+ → 准备配置文件 → 添加本地 MCP → 验证**。可 [让 Agent 自主接入](docs/getting-started.md#agent-assisted-setup)，也可按下方 JSON 手工配置。

1. 准备 [Node.js 22+](docs/getting-started.md#prepare-node)。
2. 已收到完整 `credentials.env`，直接按 [文件放置说明](docs/getting-started.md#for-the-recipient) 操作；使用自己的环境则先 [获取 API Key](docs/getting-started.md#get-cloudbase-api-key) 并填写模板。默认位置为运行 MCP 的用户主目录下 `.config/cloudbase-html-mcp/credentials.env`。
3. 支持 `mcpServers` 的客户端可按运行 MCP 的操作系统使用下面的配置；CLI 命令、YAML 或其他 JSON 结构见 [Agent 接入指南](docs/clients.md#choose-integration)。已有 `mcpServers` 时只合并 `cloudbase_html` 条目，保留其他连接器；这个 JSON 不需要填 Key。

**macOS** · [JSON 文件](templates/mcp.macos.json)

```json
{
  "mcpServers": {
    "cloudbase_html": {
      "command": "npx",
      "args": ["-y", "cloudbase-html-mcp@0.5.0-beta.1", "serve"]
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
      "args": ["/d", "/c", "npx", "-y", "cloudbase-html-mcp@0.5.0-beta.1", "serve"]
    }
  }
}
```

不同 Agent 的配置文件外层结构和重载方式可能不同，不能只靠这份 JSON 判断兼容性。客户端适配示例与 [已有实测记录](docs/clients.md#acceptance-record--实测记录) 分开维护。配置文件和 HTML 都须在 MCP 执行环境中可访问，见 [运行位置](docs/getting-started.md#execution-location)。

保存并重载 MCP，然后让 Agent 调用 `hosting_status`、`list_html` 验证。确认目标环境后，即可说：

> 将 `/absolute/path/report.html` 发布到我配置的 CloudBase 环境，给我链接和验证结果。

详见 [快速开始](docs/getting-started.md)。[源码或本地包](docs/getting-started.md#install-from-source-or-a-local-package) 和可选终端向导适合开发与排错。

## 工具

| 工具 | 用途 |
| --- | --- |
| `hosting_status` | 检查凭据/托管，报告配置来源与登记设置；此检查不验证上传和删除权限。 |
| `publish_html` | 发布指定本地 HTML，或更新在线页面。 |
| `get_html` | 按 ID、URL 或登记路径查询，包括云端内容与公网验证。 |
| `list_html` | 按关键词和状态筛选本地已知站点，返回名称、标题及最近确认状态。 |
| `offline_html` | 删除当前云端 HTML 和旧快照，保留本地登记。 |
| `online_html` | 从本次明确指定的文件恢复已登记离线站点。 |

更新或下线前先查询并传入返回的哈希。详见 [示例](docs/getting-started.md#6-first-use) 和 [工具契约](docs/architecture.md#3-工具契约)；MCP 工具发现也会提供参数说明。

## CloudBase 在这里做什么

本工具使用 CloudBase 的 [静态网站托管](https://docs.cloudbase.net/hosting/web-hosting-static) 和环境 API Key 认证，上传 HTML 并核对路由与公网访问结果。MCP 由 Agent 客户端启动为本地进程，云端使用已配置的托管资源。工具采用 MIT 开源，CloudBase 套餐、存储和流量费用另按云服务规则计算。

<a id="发布前须知"></a>
## 适用范围

- 上传单份非空 UTF-8 `.html`/`.htm` 文件，最多 20 MiB；关联的本地图片、CSS、JS 不会一起上传，发布前应确认页面可独立使用。
- 发布产生公网访问链接。本工具不提供读者登录、密码保护或协同编辑；请发布适合通过公网链接分享的内容。
- 本地文件是内容来源。不备份 HTML、不新增项目快照；列表/下线/恢复依赖本地登记，不跨机器同步。多人可使用同一环境，但各自的目录和搜索不会自动汇总，也不提供成员级站点隔离。
- 下线删除云端内容，保留本地文件才能恢复；不清除浏览器/CDN 缓存。COS 原生版本控制启用、暂停或无法核实时，会阻止破坏性清理。
- 存储成功与公网验证分开。默认域名可能出现提示页或触发下载；`PUBLISHED_PREVIEW` 表示内容一致但有预览限制，正式分享体验见 [状态说明](docs/getting-started.md#update-an-existing-page)。

## 文档与开发

- [快速开始](docs/getting-started.md)：自行配置或领取文件、Agent 自主接入或手工配置、可选向导及排错。
- [Agent 接入指南](docs/clients.md)：CLI、IDE、桌面客户端的接入格式与实际兼容性状态。
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
