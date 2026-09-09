# 架构说明与关键时序

本文描述当前 v0.4 源码的结构；共享文件的显式目标修复和默认目录分享地址尚未进入已发布的 beta.2。发布和桌面实测状态见 [项目验证状态](../PROJECT.md#v04-验证与发布安排)。人可从图理解流程，Agent 可从职责和契约定位源码。接入见 [快速开始](getting-started.md)，中文首页见 [README](../README.md)，另有 [英文简要介绍](../README.en.md)。

## 1. 总览

本地产物是内容来源，MCP 只读用户指定的 HTML；COS 保存当前对象。本地目录保存站点元数据，不保存 HTML。浏览器直接访问 CloudBase，不经过 MCP。

```mermaid
flowchart LR
  A[用户与 MCP 客户端 Agent] <-->|STDIO 六工具| M[本地 Node.js MCP]
  H[指定 HTML] -->|读取原始字节| M
  E[私人环境文件] -->|进程配置| M
  M <-->|环境锁和原子替换| R[v2 本地站点目录]
  M -->|换临时凭据| C[CloudBase 凭据接口]
  M -->|只读查询| T[TCB 托管与路由]
  M -->|PUT HEAD LIST DELETE| S[COS 当前对象与旧快照]
  M -->|公网 GET 验证| D[访问域名]
  S -. 路由映射 .-> D
  B[访客浏览器] --> D
```

六工具不缩小环境 API Key 的实际权限；不会自动切换环境、创建资源、更改域名或 Bucket 设置。HTML 是数据，不执行其中的指令。STDIO stdout 只承载协议。

## 2. 组件和入口

| 模块 | 职责 |
| --- | --- |
| [CLI](../bin/cli.mjs) / [launch.mjs](../src/launch.mjs) | Node 版本检查、serve/setup 分流；读取一次配置，默认文件/显式文件/env 互斥；错误仍可发现工具。 |
| [server.mjs](../src/server.mjs) | 六工具 schema、逐参数说明、协议返回和错误恢复；真实路径入口判断支持符号链接。 |
| [setup.mjs](../scripts/setup.mjs) / [向导逻辑](../src/setup.mjs) | 独立交互式 CLI，环境/地域预填、隐藏输入 API Key、只读检查、生成客户端配置；不占用 MCP STDIO，不自动修改客户端。 |
| [config-file.mjs](../src/config-file.mjs) / [start.mjs](../scripts/start.mjs) | 仓库外私密文件读取与原子保存；新默认入口可受控收紧权限，旧 start 显式文件入口继续严格失败退出。 |
| [publisher.mjs](../src/publisher.mjs) | 文件验证、目标解析协调、当前对象发布、下线、恢复、列表与公网验证。 |
| [registry.mjs](../src/registry.mjs) | v2 站点目录、v1 兼容迁移、环境级锁、路径绑定和未完成操作。 |
| [domains.mjs](../src/domains.mjs) | 网关发现、候选筛选、规范 URL 解析与当前环境归属校验。 |
| [cloudbase.mjs](../src/cloudbase.mjs) | 配置、临时凭据、官方 TCB/COS SDK 适配、版本控制闸门、分页与逐对象删除结果检查。 |
| [cleanup.mjs](../src/cleanup.mjs) | 严格旧快照路径过滤、清理、只读清单和按清单执行；无自动全桶清理。 |
| [recovery.mjs](../src/recovery.mjs) / [errors.mjs](../src/errors.mjs) | 结构化错误与下一步建议；建议不等于自动重试引擎。 |
| [call.mjs](../scripts/call.mjs) / [cleanup-snapshots.mjs](../scripts/cleanup-snapshots.mjs) | 一次性协议客户端、默认只读的旧快照清理 CLI。 |

新 CLI 在启动时读取配置快照，Publisher 按首次工具调用创建。默认读取用户主目录 `.config/cloudbase-html-mcp/credentials.env`；--config 指定文件，--env 明确环境变量，三路不合并、不回退。文件错误被保留为 CONFIG 诊断，仍可初始化及列举六工具，调用返回实际来源、路径及文件放置/修复建议；不访问云端。修改文件后需要重载。hosting_status 成功时补充 configuration.source/path，不返回凭据，也不替代 list_html 对目录的实际读取检查。

macOS/Linux 只有标准默认路径、当前用户拥有的无重定向专用目录及普通单链接文件可自动收紧权限；Git 检查先于 chmod。通过已打开句柄修改权限，并核对文件身份；不重写内容。显式路径保持严格检查。Windows 沿用账户 ACL，不提权或重写 ACL。

旧 src/server.mjs 环境变量入口、start.mjs 显式文件入口和 Node 原生 --env-file 均保留原行为；后两种文件缺失可在协议启动前退出。新 CLI 文件配置不修改进程环境，而是向业务实例传递隔离的配置对象，避免环境污染。

```mermaid
sequenceDiagram
  actor U as 接入者
  participant F as 用户目录配置文件
  participant M as 桌面 MCP 客户端
  participant L as 固定版本 CLI
  participant C as CloudBase
  U->>F: 放置管理员填好的完整文件
  U->>M: 粘贴无凭据的 STDIO 配置
  M->>L: 启动 serve
  L->>F: 定位、必要权限收紧、读取一次
  M->>L: initialize 与 tools/list
  L-->>M: 六工具
  M->>L: hosting_status
  alt 配置可用
    L->>C: 凭据与托管只读检查
    L-->>M: 目标环境与配置来源
  else 配置不可用
    L-->>M: 路径与修复指引，不访问云端
  end
```

### 可选向导时序

下图展示显式路径启动；Windows 标准位置可使用无路径参数的 serve。

管理员提供环境 ID、地域及 API Key，接收者无需 CloudBase 账号登录。向导不使用继承的 CloudBase 环境变量作为隐式输入；连接 JSON 仅允许 envId、region。已有文件默认复用，edit 才修改，旧 Key 和可选配置可保留。确认目标后，只读检查成功才保存；失败/取消保留原文件。原子替换前使用排他文件锁并比较原内容，避免多个向导互相覆盖；崩溃遗留锁需人工核对后清理。POSIX 配置路径先按文件系统解析目录符号链接，再处理父目录语义，检查与读写统一使用物理目标；缺失目录后的 .. 无法明确定位时拒绝。Windows 在任何文件读写前拒绝含 .. 的配置路径，避免与 POSIX 不同的归一化顺序选中相邻文件；普通绝对路径及显式目录别名继续使用。修正的远端验证状态见 [CI 记录](../PROJECT.md#ci-首次运行记录)。文件不进入 Git，POSIX 私密目录 0700、文件 0600；Windows ACL 由用户管理。

```mermaid
sequenceDiagram
  actor U as 接入者
  participant W as 独立 setup 向导
  participant C as CloudBase
  participant F as 私密配置文件
  participant M as MCP 客户端
  participant S as 本地 MCP 服务
  U->>W: 预填环境/地域，隐藏输入 Key，确认目标
  W->>C: 换取临时凭据，查询托管和路由
  C-->>W: 只读检查结果
  alt 检查失败
    W-->>U: 报告失败，保留原配置
  else 检查通过
    W->>F: 新建或明确修改时原子保存
    W-->>U: 不含 Key 的 JSON/TOML 配置
    U->>M: 合并配置并重载
    M->>S: 固定版本 serve --config
    S->>F: 读取指定配置
    M->>S: 调用 hosting_status
    S->>C: 只读检查实际客户端连接
  end
```

向导的连接检查与 hosting_status 复用 CloudBase.connect；只证明凭据和托管在线，域名发现状态另报，上传/删除和公网 HTML 均未测试。JSON/TOML 包含固定包版本和必要的私密文件路径（Windows 默认位置省略路径），不引用 npx 缓存；不写 API Key 到参数、协议结果或配置片段。新入口直接使用隔离配置，旧 start 入口会清除继承的同名及缺失可选 CloudBase 变量；旧的 Node 原生 --env-file 模式仍遵循环境变量优先语义。

## 3. 工具契约

| 工具 | 输入 | 副作用与结果 |
| --- | --- | --- |
| hosting_status | 无 | 只读托管/路由；管理目录版本与是否启用；上传/删除权限不冒充已测。 |
| publish_html | localPath；可选 siteId 或 siteUrl、expectedSha256、newPage | 新建或更新在线对象；返回哈希、URL、写入/登记/公网验证结果，不返回新的 versionKey。 |
| get_html | siteId、siteUrl、localPath 三选一 | 查询真实云端；不回写本地目录；返回 observedStorage、生命周期与登记中的未完成操作。 |
| list_html | lifecycle、offset、limit | 只读当前环境本地目录；默认 50，最大 100；结果有总数和 nextOffset。 |
| offline_html | 一个选择器及 expectedSha256 | 删除当前对象及严格匹配的旧快照；保留登记，分开返回生命周期和清理完成度。 |
| online_html | siteId 或 siteUrl，另带 localPath | 已登记离线站点恢复；不从旧快照读取内容。 |

localPath 必须为绝对 .html/.htm 文件、非空有效 UTF-8、最多 5 MiB；用 HTML 标签作基本检测，不是完整解析器。只上传原始字节，相对资源仅告警。

在线更新必须带 get_html 返回的实际旧哈希。newPage=true 不与 ID/URL 同传；原站点保留，验证成功才切换路径绑定。显式 siteId/siteUrl 决定更新或恢复目标，localPath 提供内容；如果路径默认绑定另一站点，保留该绑定及其 pending、站点记录和云端内容，只更新目标站点并记录 sourcePaths。无绑定的来源路径可登记到目标站点。离线站点不经 publish_html 隐式公开。

URL 只接受 HTTPS /sites/s-<32位小写十六进制>/ 或其 index.html，可带片段，不允许查询参数、凭据、转义路径、路径穿越。先检查原始拼写再解析，保留输入路径；随后分别核实输入路径和规范 index.html 路径均映射到当前环境静态托管资源。目录和文件可能命中不同路由，不能相互代替校验。无法确认时拒绝，不直接抓取任意输入 URL 或跟随重定向。合法 URL 使用其经核实的域名完成后续验证；ID/路径查询沿用域名候选选择。

get_html 对已知 ID 或已核实 URL 的本地元数据读取采用可选策略：REGISTRY 类读取错误通过 registryDiagnostic 返回，不阻断云端查询、不回写目录、不吞掉程序错误。元数据不可用且云端对象不存在时仍返回 SITE_NOT_FOUND，不据此认定 offline。按路径解析、列表及所有写操作保持严格目录依赖。

`publish_html` / `online_html` 已获取登记锁后的结果包含 `pathBinding`：`localPath` 是规范化来源路径，`defaultSiteId` 是按路径查找的默认站点（无绑定为 null），`pendingSiteId` 是该路径尚未完成的新建目标（没有则为 null），`matchesTarget` 表示默认站点是否为本次目标。目标解析成功后，顶层 `siteId` 表示本次操作目标；登记终写失败时这些字段反映已持久化的绑定，不冒充切换成功。

分享地址与存储对象分开：对 `sites/<siteId>/index.html` 生成 `/sites/<siteId>/` 候选，路由信息可用时同时检查目录与文件路径，不借用文件路由证明目录归属。公网 GET 直接校验返回的目录地址，保留禁止重定向、正文哈希和默认域名限制判断；不退回文件地址冒充目录验证通过。旧完整文件 URL 仍可定位同一对象；旧登记链接仅在列表/离线查询返回视图中规范为目录地址，不触发只读迁移或公网请求。

## 4. 本地与云端数据

- 当前对象：`sites/<siteId>/index.html`，更新覆盖同一路径；域名映射不变则 URL 不变。
- 自 v0.3 起不创建云端快照；旧版快照 `deployments/<siteId>/<sha256>/index.html` 只供指定范围清理。
- 默认登记目录：用户目录下 `.config/cloudbase-html-mcp/pages/`；可配置仓库外绝对目录或 off。
- 每环境/地域的文件名由二者哈希加 .catalog-v2.json 组成，内含 version、scope、sites 和 bindings。
- sites 按 siteId 保存 sha256、url、localPaths、sourcePaths、lifecycle、verifiedAt、updatedAt、state、operation。localPaths 从当前 bindings 生成，仅含可操作选择器；sourcePaths 是历史来源，不代表当前绑定或内容备份。
- bindings 保存规范化绝对路径的当前 siteId 和可选 pendingSiteId；当前与 pending 站点都在 sites 中保留。
- 文件 0600、新目录 0700；环境排他锁使用 wx，临时文件写入并 fsync 后 rename，站点记录与路径绑定一同提交。
- 目录准备失败返回 REGISTRY_WRITE_FAILED；只有锁文件已存在才返回 REGISTRY_BUSY。
- 本机同目录、同环境写入互斥；不同机器或不同目录不互斥，也不构成云端原子 CAS。

v1 哈希路径文件兼容只读；首次写操作持锁将其迁入 v2，旧文件保留但不再作为状态源。原绑定和 pending 均保留，相同站点合并路径；冲突哈希置为 null，保留 conflictingHashes，要求后续云端核对，不按遍历顺序选值。未核验旧记录 lifecycle 为 null。迁移后不要再运行 v0.2 写入者。

旧 v2 的 localPaths 可能混有历史路径：读取时将来源历史保留为 sourcePaths，并按 bindings 重建 localPaths；这一步只改变返回视图。持锁写入时原子保存规范化结果。pending 站点只有成为当前绑定后才获得该路径选择器，失败提升期间路径仍属于原站点。

lifecycle 只有 online/offline 两个业务值；null 代表尚无确认值。state 为 PENDING、UNCERTAIN、STORAGE_VERIFIED，operation 记录 publish/online/offline 的目标哈希和进度；它们不替代生命周期。列表是最近保存状态，查询则返回云端实际观察值，可能与登记不同。

## 5. 发布与更新时序

```mermaid
sequenceDiagram
  participant A as Agent
  participant P as Publisher
  participant R as 本地目录
  participant C as CloudBase
  A->>P: publish_html 文件与目标
  P->>P: 校验文件及参数
  P->>R: 获取环境锁并迁移旧登记
  P->>C: 认证及托管路由查询
  P->>P: URL 归属校验并确定显式目标
  P->>P: 生命周期检查
  P->>C: HEAD 当前对象
  P->>P: 旧哈希检查
  P->>R: 保存 PENDING 和目标哈希
  opt 内容发生变化
    P->>C: PUT 当前 HTML
  end
  P->>C: HEAD 大小和哈希元数据
  P->>C: GET 目录分享地址并核对正文哈希
  P->>R: 保存 online、来源与确认时间
  Note over P,R: 保留其他站点默认绑定；newPage 或对应 pending 验证完成才切换
  Note over P,R: 登记终写失败保留云端成功并报告警告
  P->>R: finally 释放环境锁
  P-->>A: 生命周期与公网验证结果
```

图省略错误分支的协议封装。云端 PUT 前先留恢复记录；写入超时不等于未写入。公网验证失败不重复上传，也不覆盖存储成功事实。HEAD 检查大小及上传时设置的哈希元数据，公网 GET 才对实际响应正文计算哈希。

首次新建失败保留预留 ID；替换路径的新建失败保持原绑定和 pending。查询 pending 确认云端存在后，可带其 ID 和当前哈希发布以验证并提升绑定；云端不存在不能冒充已发布。

显式更新/恢复另一站点不会预留或覆盖该路径的 pendingSiteId。绑定策略在目录保存层执行，所有阶段均适用；无须改动 v2 格式或手动重写目录。下线保留默认绑定，不能通过下线另一站点来释放路径。

## 6. 下线与清理时序

```mermaid
sequenceDiagram
  participant A as Agent
  participant P as Publisher
  participant R as 本地目录
  participant C as COS
  A->>P: offline_html 目标与旧哈希
  P->>R: 获取环境锁
  P->>C: 核对托管与 Bucket 版本控制
  P->>R: 持久化 offline 操作
  P->>C: HEAD 并比较旧哈希
  P->>C: DELETE 当前对象
  P->>C: HEAD 确认不存在
  P->>R: 保存 offline 与待清理操作
  loop 最多 100 页
    P->>C: LIST 旧快照前缀
    P->>P: 严格匹配快照对象键
    P->>C: 分批删除匹配对象
  end
  P->>C: 再列举及 HEAD 确认
  alt 全部清理通过
    P->>R: 清除 operation
    P-->>A: offline 且 cleanup.complete
  else 部分失败
    P->>R: 保留 UNCERTAIN 操作
    P-->>A: 下线事实与清理未完成
  end
  P->>R: finally 释放环境锁
```

版本控制 Enabled、Suspended 或无法核实时，在任何删除前停止。预检查旧哈希冲突时恢复操作前登记，不留下错误的删除预期。已发出 DELETE 后结果不确定则保留原哈希，后续核对并重试；已有当前对象被其他写入者修改时仍拒绝删除。

每批最多 1000 个对象；只删除完整匹配旧路径格式的 index.html。分页游标必须前进，单次超过 100 页返回可恢复错误。批量响应即使 HTTP 成功，也检查逐对象错误/遗漏。清理后再核实当前对象不存在，检测其他写入者重建的情况。

删除不清除外部缓存，当前删除与公网旧内容不可访问不作同等承诺。部分清理不宣称全部空间回收。原生 Bucket 版本不是本项目快照，此工具不更改 Bucket 设置。

独立清理 CLI 默认只读输出精确清单；apply 校验环境、Bucket、站点、路径、ETag/大小，不删除清单外新增对象，不删除在线当前 HTML。执行使用同一个环境锁；无法协调其他机器，执行期间应避免其他写入者。

## 7. 原 ID 恢复时序

```mermaid
sequenceDiagram
  participant A as Agent
  participant P as Publisher
  participant R as 本地目录
  participant C as COS
  A->>P: online_html 原目标与指定文件
  P->>P: 校验本次指定 HTML
  P->>R: 获取环境锁并读取离线登记
  P->>P: 拒绝未完成清理或未知站点
  P->>C: HEAD 原当前对象路径
  alt 云端不存在
    P->>R: 保存 online 操作与新哈希
    P->>C: PUT 原路径
  else 前次恢复已写入相同内容
    Note over P,C: 仅在匹配的未完成 online 操作下继续确认
  else 意外存在
    P-->>A: 冲突，不覆盖
  end
  P->>C: HEAD 与公网 GET 验证
  P->>R: 保存 online 并清除操作
  P->>R: finally 释放环境锁
  P-->>A: 原 ID 与访问验证结果
```

图中冲突分支在实现中立即结束。恢复不从云端历史读内容，必须提供可读本地文件；成功后再调用 online_html 不覆盖，正常更新走 publish_html。恢复云端成功但最终登记失败，可用同一 ID 和同一文件核验收口。

错误恢复按失败原因分流：上线/下线的文件/参数、登记、配置、凭据或托管前置错误仍返回对应修复建议，不被通用生命周期提示覆盖。缺少目标离线登记时提示核对原环境/目录或原机器，不建议新建替代。写入可能生效后优先查询原目标，pathBinding 不作为替代目标。

进程直接退出不会执行 finally；恢复记录保留，遗留环境锁必须确认无写入者后人工移除。正常超时/异常会释放锁，不自动反复重试。

## 8. 认证、域名及验证入口

临时凭据仅在内存缓存，提前 5 分钟刷新并合并并发交换；请求超时与响应大小有上限。COS 官方 SDK 负责签名，不手写云签名。每次连接仍查询当前托管资源和路由。

域名发现最多 3 页，每页 1000；不完整结果丢弃。按最长路径匹配当前 Bucket/staticstore，排除禁用、认证、错误上游、未就绪、非空重写及不明确非根透传。普通发布/ID 查询优先显式配置，否则自定义域名优先，最多 3 个公网候选并保留平台回退位置。URL 目标验证更严格，必须完整确认归属；不会使用发现失败时的乐观回退。

公网结果 PUBLISHED、PUBLISHED_PREVIEW、UPLOADED_NOT_PUBLICLY_VERIFIED 与生命周期分开。默认域名 attachment 提示预览限制，不等于实测了浏览器提示页；只读 hosting_status 不验证上传、删除或页面公网内容。

| 测试入口 | 覆盖重点 |
| --- | --- |
| `launch.test.mjs` / `package.test.mjs` | 三路配置、默认权限、无配置发现、实际 tarball 仓库外安装、重装及完整六工具流程（云端替身） |
| `config-paths.test.mjs` | 符号链接与父目录语义、真实目标 Git/目录权限检查、读写一致性及生产启动入口拒绝 |
| `setup.test.mjs` | 隐藏输入、连接预填、配置复用/修改/失败保护、文件权限和竞争、生成配置实际 STDIO 接入（云端替身） |
| `publisher.test.mjs` | 文件、凭据、单份写入、固定 URL、冲突和真实冷启动 schema |
| `domains.test.mjs` | 域名优先级、路由、分页与拒绝条件 |
| `registry.test.mjs` | 登记、路径绑定、环境锁、失败保留 pending 和目录保护 |
| `lifecycle.test.mjs` | v1 迁移、URL 归属、下线/恢复、分页清理、清单与 SDK 适配 |
| `review-fixes.test.mjs` | 路径重绑及旧 v2 兼容、输入/规范路径分别核验、元数据读取降级和写入阻断 |
| `recovery.test.mjs` | 配置引导及恢复建议 |
| `stdio.test.mjs` | 六工具完整流程、重启/退出恢复、符号链接入口 |

开发与 CI 先运行 npm run test:prepare，通过实际 tarball 安装准备独立 npm 缓存；该准备步骤允许 npm 网络请求，不访问云端环境。npm test 保持离线，不借用个人默认缓存。测试预加载模块通过 file: URL 传给 --import，兼容 Windows 盘符、空格和中文路径；启动失败输出经过脱敏的子进程诊断。STDIO 使用真实子进程和官方 SDK，云端是替身，文件系统使用真实临时文件。以下为 v0.3 的历史云端验收，不能替代 v0.4 安装包验收：2026-09-09 另经用户授权，以合成页面完成真实连接、ID/路径/URL 查询、固定 URL 更新、冲突保护、下线删除、公网 404、重启目录读取和恢复；站点最终仅有当前 HTML，没有项目快照。程序请求观察到 attachment，浏览器自动化未完成导航；用户随后提供的 Chrome 截图确认原 URL 正常渲染恢复后的 v2。保留两类证据，不将自动化失败或下载头推断成所有浏览器无法展示；已有快照删除及故障恢复等仍只有离线证据，不能将本轮正常流程实测泛化到全部边界。

修改行为需补回归并运行 npm run check 与 npm test；同步中文 README、快速开始及本文；英文概览仅维护必要事实和入口，不作全文对译。规划放在 [PROJECT.md](../PROJECT.md)，不能画成已实现组件。

## 9. 分发边界

包元数据为版本唯一来源；bin 提供稳定入口，白名单限制发布内容，npm-shrinkwrap.json 锁定传递依赖。凭据与目录在用户主目录，不随安装位置移动。测试版本为 0.4.0-beta.2，按 beta 标签分发；客户端模板固定该版本。macOS/Windows Node 22/24 工作流先安装依赖并准备 npm 缓存，再执行离线检查；不含发布或云端凭据。v0.4 已获用户确认的 WorkBuddy、千问办公 macOS 接入与发布、WorkBuddy 下线范围见 [客户端记录](clients.md#acceptance-record--实测记录)。现有 v0.3 实测不替代 v0.4 客户端完整生命周期及 Windows 桌面验收。
