# CloudBase HTML MCP

[English](README.md) | 简体中文

通过轻量 STDIO MCP 服务，将本地 HTML 文件发布到你自己的 CloudBase 静态托管环境。

为经常用 AI 生成单页 HTML 的人提供一个直接的发布入口：给出文件路径，获得分享链接；后续使用同一页面 ID 更新，链接保持不变。

当前版本：**0.3.0，本地工具**。包含六个工具，不依赖完整 CloudBase 插件或 CLI。不提供实时共同编辑、评论、数据库、账号登录页面或应用构建。

## 开始使用

你需要 Node.js 22+、支持本地 STDIO 的 MCP 客户端，以及已开启静态托管的 CloudBase 环境和管理端 API Key。按 [快速开始](docs/getting-started.md) 完成安装、配置、连通验证和首次发布；人和 Agent 共用同一份指南。

还没用过 CloudBase？先按 [首次准备指南](docs/getting-started.md#new-to-cloudbase) 完成账号、环境、静态托管和 API Key 准备；其中说明控制台入口、正确的 Key 类型及 MCP 启动前检查。

管理员发给你 API Key 的场景无需 CloudBase 账号登录。安装依赖后，在本机终端运行本地向导；环境和地域可预填，只需隐藏输入 Key 并确认：

```sh
npm run setup -- --env-id YOUR_ENV_ID --region YOUR_REGION
```

也可直接运行 `npm run setup` 逐项填写，或用 `--connection /absolute/private/connection.json` 导入仅含 `envId`、`region` 的连接信息。只读检查通过后保存仓库外私密配置，输出不含 Key 的 JSON/TOML 接入片段；合并到客户端并重载。已有配置默认复用，输入 `edit` 修改；取消或检查失败保留原文件。完整流程见 [本地向导](docs/getting-started.md#2-run-the-local-setup-wizard-recommended)。

配置路径按实际文件系统解析符号链接，检查、读取和保存使用同一物理目标；指向 Git 仓库的路径会被拒绝，不会将“不存在目录 + `..`”静默改指其他文件。

让本地 coding agent 帮你接入，可以复制这段指令：

> 阅读本仓库的 docs/getting-started.md，帮我安装并注册 cloudbase_html MCP。优先复用已有安装和仓库外的私人环境文件，完成本地检查和只读连通验证；让我在本机终端运行向导隐藏输入 Key；缺少客户端或非密钥连接信息时集中问我，不在聊天中收集 Key。接入时不要发布页面。

指南也提供源码公开后可分享给其他用户 Agent 的 URL 指令。本项目从源码安装，尚未发布 npm 包。

实现机制见 [架构说明与关键时序](docs/architecture.md)，包含组件边界、数据模型，以及发布、更新和失败恢复时序图。

## 工具

| 工具 | 入参 | 结果 |
| --- | --- | --- |
| `hosting_status` | 无 | 只读配置、托管与本地管理诊断；上传/删除权限未测试 |
| `publish_html` | `localPath`；更新加 `siteId` 或 `siteUrl` 及 `expectedSha256`；`newPage` 明确另建 | 写当前 HTML，不创建新云快照 |
| `get_html` | `siteId`、`siteUrl`、`localPath` 三选一 | 云端实际哈希/公网验证、已知生命周期及未完成操作 |
| `list_html` | 可选 `lifecycle`、`offset`（0）、`limit`（50，最多 100） | 当前环境本地已知站点，不逐一访问云端 |
| `offline_html` | 一个选择器及查询所得 `expectedSha256` | 删除当前云端 HTML 和严格匹配的旧快照，保留本地记录 |
| `online_html` | `siteId` 或 `siteUrl`，另加用户指定的 `localPath` | 将已登记离线站点恢复到原路径 |

文件必须是绝对路径 `.html`/`.htm`、非空有效 UTF-8、最多 5 MiB，并包含 HTML 标签；校验不是完整解析器。只上传原始字节，不上传关联资源。

更新前先查询，再用同一个 ID/URL 和查询返回的云端哈希更新。固定对象始终是 `sites/<siteId>/index.html`；域名映射不变时 URL 不变。v0.3 不再写 `deployments/` 快照或返回新的 `versionKey`；普通更新不清除旧快照。

已绑定路径必须明确更新目标：不传 ID 返回 `LOCAL_SITE_EXISTS`，离线路径返回 `PAGE_OFFLINE`。`newPage: true` 不能与 ID/URL 同传；验证后切换路径绑定，原站点仍留在目录。无关绑定冲突返回 `LOCAL_BINDING_CONFLICT`。

URL 仅接受 HTTPS `/sites/<siteId>/` 或其 `index.html`，可带片段；查询参数、凭据、路径穿越和其他路径均拒绝。完整路由信息必须同时确认输入路径和规范 `index.html` 路径映射到当前环境静态托管资源，目录 URL 不能借用不同文件路径的路由。不能靠下载任意 URL 判断归属。已确认但未登记的在线站点可查询，在明确更新/下线时建立登记。

## 生命周期

`online` 表示当前云端 HTML 存在，与公网验证分开；`offline` 表示当前对象删除已确认。未核验的旧记录使用 `lifecycle: null`；未完成操作和清理完成度另外表达。

下线前先查询哈希，再明确调用 `offline_html`。工具检查 Bucket 版本控制、预存操作、核对哈希、删除当前对象，仅清理 `deployments/<siteId>/<64位小写十六进制>/index.html` 旧快照；其他站点和不匹配文件保留。分页列举、每批最多删除 1000 个对象，每次最多 100 页；未完成可重试继续，批次部分成功不能算清理完成。

当前对象已删、快照清理失败时，返回 offline 与 `cleanup.complete: false`，使用原操作预期哈希重试。删除超时可能已生效，先查询再重试。删除不清除外部缓存已持有的副本。

`online_html` 要求本地离线登记、本次用户指定的文件、云端当前对象不存在。文件缺失阻止上传，对象意外重现返回冲突；此前恢复已写入相同内容但超时时，可核验收口而不重复上传。清理未完成需先重试下线；已在线站点使用 `publish_html` 更新。

COS Bucket 原生版本控制与项目快照独立；启用、暂停或无法核实时阻止破坏性清理，不改 Bucket 设置。停止项目快照不等于关闭 Bucket 原生版本。

## 域名选择与页面登记

未设置 `CLOUDBASE_PUBLIC_BASE_URL` 时，工具读取当前环境的网关域名路由，优先选择启用且指向本静态托管资源的自定义域名，再考虑平台默认域名。按具体页面路径的最长前缀匹配路由，排除停用、身份认证、其他上游和未就绪域名。非根路径要求明确开启路径透传；暂不自动解释路径重写或通配路径，无法确认的路由会被排除并返回原因。

显式设置的 `CLOUDBASE_PUBLIC_BASE_URL` 优先且不自动替换；若已知其路由被停用或指向其他资源，不把它当作有效候选。路由查询失败或超过三页上限时，返回 `access.discovery` 诊断，并可尝试静态托管原生域名；此时路由有效性仍未知。公网最多检查三个候选，每次仍需类型与内容哈希匹配。结果包含 `urlSource`、候选、排除原因及实际检查结果；`hosting_status` 不执行公网内容验证。

同一 siteId 的对象路径保持固定。域名配置变化或候选不可用时，返回链接的域名可能变化；原域名只要仍正确路由，原链接仍指向相同页面。工具不创建域名、不改路由、不切换环境。

登记位于 Git 仓库之外，默认用户目录 `.config/cloudbase-html-mcp/pages/`；`CLOUDBASE_REGISTRY_DIR` 可指定其他仓库外绝对目录或 `off`。关闭后保留基本发布和 ID 查询，列表/下线/恢复不可用。

v2 每环境/地域使用一份原子 JSON 目录，按 siteId 保存路径、URL、最近哈希、生命周期、核验时间和未完成操作，不保存 HTML 或凭据。文件 0600，新目录 0700；环境排他锁覆盖不同路径的写入，不协调不同机器或不同登记目录。

`localPaths` 只包含由权威路径绑定生成的当前可操作路径；`sourcePaths` 保留历史产物来源，不是当前选择器或 HTML 备份。`newPage` 成功后，旧站点的路径移出 `localPaths`，仍保留在来源历史。旧 v2 记录读取时生成正确视图而不改磁盘，下次持锁写入时保存修正结果。

目录元数据损坏或不可读时，`get_html` 仍可按已知 ID 或经路由核实的 URL 查询云端，并返回 `registryDiagnostic: { state: "UNAVAILABLE", code: ... }`；不修复文件，也不根据缺失的元数据认定 offline。按路径查询、列表和所有写操作继续阻断，直至目录修复。

v1 文件兼容读取，在首次写锁内迁移，原文件保留但迁移后不再是状态源。当前和 pending ID 均保留，相同 ID 合并路径，冲突旧哈希先置为未知再核验。新建失败保留原绑定。云端成功、本地最终写入失败返回 `registry.state: UPDATE_FAILED`，需查询后重试原操作。损坏阻止写入；遗留锁必须确认没有写入者后人工移除。迁移后不要降级使用 v0.2 写入者。

## 发布结果如何判定

- `PUBLISHED`：公网返回 HTML，内容 SHA-256 一致，且未强制下载。
- `PUBLISHED_PREVIEW`：内容校验通过，但使用 CloudBase 默认域名，访客需通过平台访问提示页。
- `UPLOADED_NOT_PUBLICLY_VERIFIED`：云存储校验通过，公网尚未校验通过；请再次查询，不要把它当成可用链接已验证。
- `isError=true`：操作失败，结果包含阶段、错误码；写入开始后还会返回页面 ID 和写入阶段，帮助识别部分成功。

失败结果还包含 `next_step`、`retryable` 和 `maxRetries`。可执行建议提供已有工具名和 `suggested_args`；需要用户修正配置时使用 `required_config`，不把凭据当作工具参数。内容冲突或不确定写入先用 `get_html` 查明状态；公网未验证时建议稍后查询一次。工具不会执行无限自动重试或自动修权限。

CloudBase 默认域名用于开发测试，可能显示中间页或返回 attachment 头。[官方说明](https://docs.cloudbase.net/service/alias)。直接对外分享建议配置已绑定当前环境的 HTTPS 自定义域名；本工具不会替你创建域名或修改路由。

## 存储与清理

环境 API Key → 临时凭据 → 托管/路由 → 当前对象 PUT → HEAD → 公网 GET。没有回滚、云端备份、全栈构建或跨机器事务。

升级与发布不删除旧快照。清理脚本默认只读输出清单：必须指定环境及 siteId，将 JSON 保存到 Git 外，核对对象键/数量/大小。执行要求 `--apply` 和清单绝对路径；校验环境、Bucket、路径和当前 ETag/大小，只删除清单对象，保留当前 HTML 和后来新增的快照。必须确认原生版本控制关闭；脚本共用本地环境锁。

```sh
node --env-file=/absolute/private/cloudbase-html.env scripts/cleanup-snapshots.mjs --env-id YOUR_ENV_ID --site-id s_REPLACE_WITH_VALID_ID
node --env-file=/absolute/private/cloudbase-html.env scripts/cleanup-snapshots.mjs --env-id YOUR_ENV_ID --site-id s_REPLACE_WITH_VALID_ID --apply --manifest /absolute/private/cleanup-manifest.json
```

ID 替换为 `s-` 加 32 位小写十六进制，多站点重复传 `--site-id`。第二条命令仅在清单获明确授权后执行；不会自动迁移清理。

## 开发

```sh
npm run check
npm test
node scripts/call.mjs --config /absolute/private/cloudbase-html.env hosting_status
node scripts/call.mjs --config /absolute/private/cloudbase-html.env publish_html '{"localPath":"/absolute/path/page.html"}'
```

`npm test` 只执行 `test/*.test.mjs`，不自动启动测试用子进程入口。测试默认不访问云资源；`scripts/call.mjs` 是基于官方 MCP SDK 的一次性协议客户端。

| 测试文件 | 覆盖行为 |
| --- | --- |
| `test/config-paths.test.mjs` | 符号链接与 .. 的真实路径、Git/目录权限保护、保存目标一致性、启动入口拒绝及普通别名兼容 |
| `test/setup.test.mjs` | 隐藏输入、预填与复用/修改、失败保护、私密保存、生成配置及真实 STDIO 接入（云端替身） |
| `test/publisher.test.mjs` | 输入拒绝、凭据刷新、发布/更新冲突、部分失败、公网验证、进程内互斥、生产入口 STDIO 冷启动 |
| `test/domains.test.mjs` | 域名优先级、路径覆盖、禁用/错误上游、分页、权限拒绝、候选上限及公网回退 |
| `test/registry.test.mjs` | 真实临时文件登记、环境隔离、跨实例读取、损坏、写失败、锁、重复新建与重绑冲突 |
| `test/recovery.test.mjs` | 配置/认证/冲突等下一步动作、部分写入先查询、有界重试建议 |
| `test/lifecycle.test.mjs` | URL 校验、目录迁移、下线/恢复、清理与 COS 适配契约 |
| `test/review-fixes.test.mjs` | 当前/历史路径区分、目录/文件路由隔离及元数据不可用时的只读云端查询 |
| `test/stdio.test.mjs` | 官方 SDK 真实子进程协议下发布、重启找回 ID、更新及部分失败恢复；云端由独立离线替身提供 |

v0.3 已完成离线和使用云端替身的真实 STDIO 子进程验证。2026-09-09 的授权合成页面实测还通过了真实 API Key 连接、ID/路径/URL 查询、固定 URL 更新、旧哈希冲突拒绝、下线删除（公网 HTTP 404）、重启后目录读取及原 URL 恢复；限定站点的对象清单只有一份当前 HTML，没有项目快照。程序请求响应内容一致但带 attachment 下载头，浏览器自动化未完成导航；随后用户提供的 Chrome 截图确认原 URL 正常展示恢复后的 v2 页面。该证据确认此浏览器会话，不代表所有客户端的首次访问体验；GitHub 全新安装尚未验证。本次真实操作未覆盖已有快照的删除及各类故障恢复。详见 [PROJECT.md](PROJECT.md)。

本项目是独立工具，不是腾讯云官方产品。使用官方 MCP、腾讯云 TCB 和 COS SDK；不自行实现 MCP 协议或云 API 签名。

## 许可证

本项目采用 [MIT 许可证](LICENSE)。第三方依赖遵循各自的许可证；本仓库不打包依赖源码或业务 HTML。
