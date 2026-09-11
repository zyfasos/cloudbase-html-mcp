# 项目边界与下一步

## 目标

面向经常使用 Agent 生成并分享单页 HTML 的个人与小团队：指定本地产物即可发布、更新同一 URL、按名称检索本地已知站点、下线删除云端内容，并从指定文件恢复原站点。

<a id="positioning-and-related-tools"></a>
## 定位与相近工具

项目起点是一个具体的交付场景：Agent 生成报告、演示或轻量交互页面后，使用者希望直接分享链接并持续迭代同一地址。HTML 在这里承载版式、图表与交互，也保留可继续修改的源码；这是一项产品取舍，不把“HTML 已取代 Markdown”或“分享是所有人的刚需”当作未经验证的事实。

2026-09-10 核对公开项目说明：已存在相近方案（下表仅对照公开文档，未做安装、性能或服务质量评测；也不能将它们统一描述为依赖 Cloudflare）：

| 项目 | 公开说明中的能力与交付形态 |
| --- | --- |
| [htmldrop](https://github.com/vin-spiegel/htmldrop) | 发布 API、远程 MCP 及自托管；支持 S3 兼容存储与本地文件系统。 |
| [agent2web](https://github.com/raveli/agent2web) | 远程 MCP 发布单页/多文件站点，运行于 Cloudflare Workers/D1/R2，含版本与管理界面。 |
| [tinyhost](https://github.com/allenai/tinyhost) | 命令行把单页放到 S3 并提供限时链接。 |
| [CloudBase 官方 CLI](https://docs.cloudbase.net/cli-v1/hosting) | 面向云开发与资源管理；托管命令本身支持单文件上传。 |
| [CloudBase 官方 MCP](https://docs.cloudbase.net/ai/cloudbase-ai-toolkit/connection-modes) | 覆盖静态托管、存储、数据库、云函数等更广能力，[支持按需启用插件](https://docs.cloudbase.net/ai/cloudbase-ai-toolkit/plugins)。 |

本项目的差异不在“能上传单文件”（官方 CLI 也能），而在为 Agent 组织好的站点操作契约：本地登记保持文件与站点关联、旧哈希防误覆盖、发布/查询/下线/恢复协调，配合中文说明、本地 STDIO 接入、管理员整份交付配置与用户自己的 CloudBase 环境，无需部署远程服务或业务数据库。相近能力已能满足需求时不必更换（2026-09-11 核对：[Qoder IDE](https://docs.qoder.com/release-notes/desktop) 已有 Vercel 部署流程；[Claude Code Artifacts](https://claude.com/blog/artifacts-in-claude-code) 支持组织内分享与同链接更新，限组织内认证访问）。

口径边界：这里的“轻量”指职责与流程集中（六工具、单 HTML、免工程/构建），**不**表示安装体积、启动、内存或 Token 消耗更优——与官方 MCP 精简配置的公平对照（固定版本/机器/网络/任务）尚未进行。定位按“已有单 HTML、经常分享并持续管理”定义，不按 Agent 品牌定义；尚无分群留存或使用频率数据。管理员整份交付配置是接入便利而非独有能力（官方 [MCP 下发接入](https://docs.cloudbase.net/solutions/cloudbase-platform-edition/bind-agent-to-cloudbase)、[CLI API Key 登录](https://docs.cloudbase.net/en/cli-v1/install) 亦支持）；多人共用环境不自动汇总站点、无成员级隔离，不是团队协作平台。

## 当前实现（v0.5 beta）

- Node.js ≥22、本地 STDIO MCP、npm 分发（bin/白名单/shrinkwrap/双系统模板）；六工具：hosting_status、publish_html、get_html、list_html、offline_html、online_html。
- 配置主线：用户目录 `credentials.env`，serve 默认/`--config`/`--env` 三路互斥；配置错误仍可发现工具；可选 setup 向导；旧入口保持兼容。
- 发布只写当前对象（`sites/<siteId>/index.html`），分享地址为 `/sites/<siteId>/`；不新增云快照、不备份 HTML。
- 结构化资源诊断、可选站点名称、HTML 标题提取、计算 label 与本地关键词搜索；元数据仅存当前环境 v2 目录。
- v2 目录按环境隔离（环境锁、原子替换、v1 迁移）；offline 删当前对象与严格匹配旧快照、online 按指定文件恢复原 ID；删除前核对 Bucket 原生版本控制；独立清理脚本默认只读。
- 生命周期、清理进度、登记进度、公网验证与错误诊断分别表达；失败不冒充成功。

## 边界与后续机会

- 不提供完整版本管理、回滚、云端备份或保留 COS 内容的禁用/启用；不引入服务端数据库、跨设备同步、全云端站点枚举或跨机器事务。
- 外部域名、复杂路径重写、不明确路由不通过 URL 方式管理；默认域名预览限制仍存在。
- 删除不清除外部缓存，不更改 Bucket 版本控制、生命周期、域名或权限。
- 本地目录丢失后，离线站点不能自动认领恢复；未迁入目录的在线站点可验证后明确更新/下线。
- 不扩展到多文件构建、全栈部署、实时协作或全套云资源管理。浏览器/设备码登录仅作为后续可选接入机会；误发布恢复、多设备管理等出现明确需求再评估。

## 开源与发布

<!-- release:version -->
源码已在 [GitHub](https://github.com/zyfasos/cloudbase-html-mcp) 公开，采用 MIT；第三方依赖保留各自许可证。当前预发布版为 `cloudbase-html-mcp@0.5.0-beta.1`（npm `beta` 标签），接入模板固定具体版本；各标签指向、发布与验收结论见 [CHANGELOG](CHANGELOG.md)。
<!-- /release:version -->

<a id="v05-release"></a>
## 验证状态

各版本的变更、CI、公共 npm 冷启动与桌面实测证据统一记录在 [CHANGELOG.md](CHANGELOG.md)；发布流程见 [docs/releasing.md](docs/releasing.md)。当前未完成项：v0.5 新特性（资源诊断、名称与搜索）的真实桌面/云端实测；同 URL 内容更新、客户端重启后查询与不依赖手改登记的原 URL 恢复的桌面证据；Windows 桌面实机验收（按用户决定暂缓）；与官方 MCP 精简配置的公平对照。CI 与公共包验证不能替代桌面与真实云端验收。

业务 HTML、私人环境信息、凭据、本地登记和 `docs/implementation/` 不进入 Git（包括历史）；实施档案只在本地维护。

## 文档语言

面向国内个人用户，以中文 README、快速开始、客户端指南、架构说明与更新日志为主；README.en.md 仅保留简短英文介绍及中文指南入口，不维护逐段双语副本。命令、参数和 MCP 协议标识保持原样。
