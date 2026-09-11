# 更新日志

按发布时间倒序记录各版本变更与验证证据。验证状态速览见 [PROJECT.md](PROJECT.md#v05-release)；发布流程见 [发布维护指南](docs/releasing.md)。CI 均为 macOS/Windows × Node 22/24 四组离线检查（依赖安装 → npm 缓存准备 → check → test）；Windows 的 4 项跳过为原有平台限定测试（POSIX 权限、所有者、路径别名），零失败为发布前提。npm 包内文档是发布时快照，最新内容以本文件为准；正式版 0.4.0 与 0.5.0 均未发布。

## 0.5.0-beta.1（2026-09-11）

- **资源诊断与站点检索**：`publish_html`/`online_html` 返回结构化 `resourceDiagnostics`（静态引用分类计数、去重资源、目录内元数据检查、脱敏与截断），原 `warnings` 保留；诊断只解释问题，不阻止发布。新增可选 `displayName`、自动提取 `htmlTitle`、计算 `label`，`list_html` 支持 `query` 关键词搜索（NFKC/大小写归一、空白分词、词间 AND、字段间 OR，仅匹配名称/标题/来源文件名）。元数据仅保存在当前环境 v2 目录，候选值在存储验证后提升。使用说明与限制见 [快速开始](docs/getting-started.md#resource-diagnostics)；安装流程、六工具与 20 MiB 上限不变。
- **发布与验证**：源码 `3a77c95` 推送 GitHub 后 [四组 CI](https://github.com/zyfasos/cloudbase-html-mcp/actions/runs/34555929343) 通过（macOS 各 187、Windows 各 183 + 4 跳过）；同提交 tgz 通过离线检查、全量测试与仓库外安装；npm 发布后全新缓存安装固定版本，包完整性与逐文件内容和已验证 tgz 一致，版本查询、真实 STDIO 六工具发现、缺失配置诊断通过（未携带凭据、未访问云资源）。`beta` 标签指向本版，`latest` 保持 `0.4.0-beta.6`。
- **未验证**：v0.5 新特性的真实桌面/云端实测（不沿用 v0.4 结论）；Windows 桌面实机按用户决定暂缓。

## 0.4.0-beta.6（2026-09-10）

- 相对资源告警改为单向扫描，覆盖畸形 HTML 标签与未闭合 CSS URL，消除最坏二次方耗时；仍只是提示，不新增校验或安全过滤。
- 未预期异常返回安全诊断（`diagnostic.errorId`/`errorType`/白名单 `errorCode`，stderr 输出同 ID 关联日志，不含原始消息/堆栈/路径/参数）；公网验证失败细分 `TIMEOUT`、`ABORTED`、`DNS_ERROR`、`TLS_ERROR`、`RESPONSE_TOO_LARGE`，其余保留 `PUBLIC_FETCH_FAILED`。
- `online_html` 缺少 siteId/siteUrl 时先返回 `ONE_PAGE_SELECTOR_REQUIRED`，不取登记锁、不连云端，不受路径绑定状态影响。
- **验证**：本地 macOS Node 22/24 各通过 check 与 155 项离线测试；[发布源码 `92a6391` 四组 CI](https://github.com/zyfasos/cloudbase-html-mcp/actions/runs/34461990556) 通过（macOS 各 155、Windows 各 151 + 4 跳过）；公共 npm 冷启动覆盖 20 MiB 边界、畸形 HTML/CSS 扫描与错误分类（扫描约 20 MiB 合成样本本机 513ms/407ms，仅单机观测）。

## 0.4.0-beta.5（2026-09-10）

- 单 HTML 上限由 5 MiB 提高到 20 MiB（20,971,520 字节），本地读取、发布/恢复与公网验证共用；超限仍在上传前拒绝。
- **验证**：Node22 本地 check 与 149 项离线测试；[功能提交 `0734947` 四组 CI](https://github.com/zyfasos/cloudbase-html-mcp/actions/runs/34455806494) 与[发布源码 `857199f` 四组 CI](https://github.com/zyfasos/cloudbase-html-mcp/actions/runs/34456610781) 均通过（macOS 各 149、Windows 各 145 + 4 跳过）；公共包冷启动含 20 MiB 读取/内容校验与多 1 字节拒绝（内容校验用合成响应）。

## 0.4.0-beta.4（2026-09-10）

- 修复 UTF-8 BOM 紧接首个配置字段时被误判为未知字段的问题；默认文件、显式文件与旧读取入口统一处理 BOM，保留原文与并发修改检测。
- CLI 参数错误改返回 `INVALID_LAUNCH_ARGUMENTS` 与合法用法，不再把未知参数或相对路径误报为配置来源冲突。
- **验证**：本地 macOS Node 22/24 各通过 check 与 147 项离线测试（含 BOM/CRLF 组合、原始文件变更检测、真实 STDIO 与安装包回归）；[发布源码 `60ca136` 四组 CI](https://github.com/zyfasos/cloudbase-html-mcp/actions/runs/34441466664) 通过（macOS 各 147、Windows 各 143 + 4 跳过）；公共包冷启动含 BOM 配置解析。

## 0.4.0-beta.3（2026-09-09）

- **共享文件显式目标修复**：显式 `siteId`/`siteUrl` 与 `localPath` 默认绑定分离——用默认绑定到 B 的文件更新/恢复 A 时保留 B 的绑定、内容与状态；结果新增 `pathBinding`（defaultSiteId/pendingSiteId/matchesTarget）；`newPage` 及对应 pending 验证完成才切换默认绑定；下线不释放绑定，无须手改目录。
- 默认分享地址改为 `/sites/<siteId>/`，公网验证请求目录地址且目录与文件路由分别核验；旧 `/sites/<siteId>/index.html` 链接继续可作为管理目标；旧登记在只读返回视图中规范为目录地址。
- 恢复提示按前置错误分流：文件/参数、登记、配置、凭据或托管错误返回各自修复建议，不被通用生命周期提示覆盖；缺少离线登记时提示核对原环境/目录或原机器，不建议新建替代。
- **验证**：本地 macOS Node 22/24 各通过 check 与 144 项离线测试（绑定修复 +10、目录地址 +8、恢复提示 +2）；[发布源码 `733d27d` 四组 CI](https://github.com/zyfasos/cloudbase-html-mcp/actions/runs/34368580426) 通过（macOS 各 144、Windows 各 140 + 4 跳过）；公共包冷启动通过（registry 完整性与 tarball 一致）。此前 beta.2 暴露的共享文件恢复问题见 [桌面实测记录](#桌面实测记录)。

## 0.4.0-beta.2（2026-09-09）

- CI 修复：独立准备 npm 测试缓存后离线安装测试；测试预加载用 file: URL 兼容 Windows 盘符/空格/中文路径；Windows 配置路径在任何读写前拒绝 `..`；目录创建失败（`REGISTRY_WRITE_FAILED`）与锁竞争（`REGISTRY_BUSY`）分别报告。
- **桌面实测**：WorkBuddy（macOS，Agent 自主接入）与千问办公（JSON 导入）接入成功——六工具发现、`hosting_status`（默认文件配置、管理启用）、`list_html`（同一已知站点）通过；WorkBuddy 5.5.4 首次发布约 2.28 MiB HTML 返回 `PUBLISHED_PREVIEW`（HTTP 200、哈希一致、内置预览可见）、查询旧哈希后下线返回 absent 且清理完成；千问办公重复发布经 `LOCAL_SITE_EXISTS` + `get_html` 确认未重复写入、明确另建新 siteId 成功。证据与边界见 [桌面实测记录](#桌面实测记录)。
- **验证**：[首次 CI](https://github.com/zyfasos/cloudbase-html-mcp/actions/runs/34334279722) 暴露缓存、路径、启动与错误分类问题，[`257154a` 四组复验](https://github.com/zyfasos/cloudbase-html-mcp/actions/runs/34337881336) 通过（macOS 各 124、Windows 各 120 + 4 跳过）；本地 macOS Node 22/24 各 124 项。

## 0.4.0-beta.1（2026-09-09）

- npm 分发首发（源码 `6605b1f`）：`bin` 入口与 serve/setup 分流、默认用户目录 `credentials.env` 主线（默认文件/`--config`/`--env` 三路互斥）、发布白名单与 `npm-shrinkwrap.json`、双系统接入模板、可选 setup 向导；配置错误仍可发现工具。源码自 `1baa568`（v0.3.0 + 文档修复）演进而来。
- 公共 npm 冷启动验证覆盖全新缓存下载、版本查询、六工具发现及缺失配置诊断。

## 0.3.0（2026-09-09）

- 首个公开版本（`6ea7a03` 单根提交）：六工具（hosting_status/publish_html/get_html/list_html/offline_html/online_html）、环境 API Key 换临时凭据、v2 本地站点目录与 v1 迁移、严格 URL 归属核验、下线/恢复、旧快照清单清理、本地接入向导。`1baa568` 修正接口焦点表述与快速开始编号。
- **真实云端验收**（用户授权、合成页面）：真实连接、ID/路径/URL 查询、固定 URL 更新、旧哈希冲突拒绝、下线删除（公网 404）、重启目录读取与原 URL 恢复；限定站点清单仅 1 个当前 HTML、0 快照。程序请求内容一致但带 attachment 头；浏览器自动化未完成导航，用户随后提供的 Chrome 截图确认原 URL 正常渲染恢复后的 v2——两类证据均保留，不将下载头或自动化失败推断为所有浏览器无法展示。已有快照删除与故障恢复仅离线验证。
- 仓库以 MIT 公开至 GitHub，业务 HTML、凭据与本地登记不入库。

---

## 桌面实测记录

按历史受测版本记录；"待验收"指当时证据缺口，不随版本升级自动关闭。截图含私人环境与路径信息，仅本地留档；未取得原始工具调用日志。

### 接入（0.4.0-beta.2，2026-09-09，macOS）

| 客户端 | 接入路线 | 六工具 | hosting_status | list_html |
| --- | --- | --- | --- | --- |
| WorkBuddy（Agent 自主接入） | 按指南自配 | 通过 | 成功，默认文件配置、管理启用 | 成功，返回 1 个本地已知站点 |
| 千问办公 | 连接器 JSON 手工导入 | 通过 | 成功，默认文件配置、管理启用 | 成功，返回 1 个本地已知站点 |

两边共用同一用户的配置与登记目录，返回同一站点符合预期（`cloudVerified: false` 表示列表不逐站核对云端）。首轮只读截图未展示客户端、Node 与 MCP 的精确运行版本，不将参考界面版本当作该轮运行版本证明。

### 发布与下线（同日）

| 客户端 | 操作 | 结果 |
| --- | --- | --- |
| WorkBuddy 5.5.4 | 首次发布约 2.28 MiB HTML | `PUBLISHED_PREVIEW`，HTTP 200、哈希一致，内置预览可见 |
| 千问办公 | 再次发布已登记同一路径 | `LOCAL_SITE_EXISTS` 后经 `get_html` 确认云端与本地一致，未重复写入 |
| 千问办公 | 明确要求另建页面 | 新 siteId 发布成功，`PUBLISHED_PREVIEW`、HTTP 200、哈希一致 |
| WorkBuddy 5.5.4 | 查询旧哈希后下线原站点 | offline、`observedStorage: absent`、`cleanup.complete: true`，登记 SAVED |

`newPage` 新建不同 URL，不作为同 URL 更新验收；下线清理快照数为 0，未覆盖真实旧快照删除；外部缓存即时失效未验证。当时仍缺：同 URL 内容更新、客户端重启后查询、不依赖手改登记的原 URL 恢复、千问办公下线。

### 共享文件恢复问题（beta.2 暴露、beta.3 修复）

同一文件先发布为 A 再 `newPage` 发布为 B 后，下线 A、用该文件恢复 A 被 beta.2 的 `LOCAL_BINDING_CONFLICT` 拒绝（下线 B 也不释放路径绑定）。WorkBuddy 最终直接修改本地 `catalog-v2.json` 绑定数据后恢复 A 成功——**不属于完整 MCP 流程通过**；比对本机 npx 安装包与已验证 beta.2 产物的 31 个包文件一致，未发现程序被改动。直接编辑登记绕过锁与原子保存，不作为方法推荐。beta.3 修复该场景并通过离线/真实 STDIO/安装包回归（恢复 A 保留 B、更新 A 保持原 URL），仍需升级后的桌面实测再次验收。

### 后续用户确认（未绑定版本）

用户后续确认 QoderWork（JSON 导入）、豆包工作（STDIO 表单）载入成功，但未补齐该轮客户端版本与完整调用记录；不据此宣称功能验收通过。每次实际验证应记录：操作系统、客户端与 Node 版本、输入方式、启动程序与不含密钥的参数、六工具发现、目标环境、`list_html` 及授权测试文件的操作结果与诊断。
