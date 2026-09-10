# 桌面客户端接入

本指南说明如何手动添加本地 STDIO MCP。当前 v0.4 为 **0.4.0-beta.5 测试版**。以下实测证据来自 beta.2：WorkBuddy 与千问办公的 macOS 接入和发布已获用户实测确认，WorkBuddy 下线也已通过；同 URL 更新及其他客户端仍待验证；恢复实测暴露了共享文件绑定问题，见下方记录。也可按 [快速开始](getting-started.md#install-from-source-or-a-local-package) 使用本地包或已取得的 v0.4 源码。

<a id="common-preparation--公共准备"></a>
## 公共准备

1. 客户端未提供兼容运行时时，先按 [Node 安装与检查步骤](getting-started.md#prepare-node) 准备 Node.js 22+；已有可用运行时直接复用。检查通过后重启桌面客户端，使其获得新的 PATH。
2. 将管理员提供的完整 `credentials.env` 放到用户主目录下的 `.config/cloudbase-html-mcp/credentials.env`。MCP 自行定位，客户端环境变量栏不需要填 Key。
3. 选择下述一种输入形式，并固定包版本。首次下载超过客户端超时时，可先执行该版本的 `--version` 预下载，再连接。
4. 保留已有 MCP 条目，保存后通过客户端控件重载，必要时重启应用。确认六工具可见，再调用 `hosting_status`、`list_html`；新用户列表为空正常。

界面截图仅证明配置入口存在；本轮用户另提供了 WorkBuddy 与千问办公的实际验收结果截图，见下方实测记录。连接图标变绿或 `tools/list` 成功，都不能证明 CloudBase 连通或拥有上传权限。先核对 `hosting_status` 中的目标环境，再按用户单独请求发布指定 HTML。

<a id="json-import--json-导入"></a>
## JSON 导入

在支持 JSON 导入或 JSON 配置编辑器的客户端中，按操作系统复制。也可打开文件并复制其内容：[macOS JSON](../templates/mcp.macos.json) · [Windows JSON](../templates/mcp.windows.json)。

**macOS**

```json
{
  "mcpServers": {
    "cloudbase_html": {
      "command": "npx",
      "args": ["-y", "cloudbase-html-mcp@0.4.0-beta.5", "serve"]
    }
  }
}
```

**Windows**

```json
{
  "mcpServers": {
    "cloudbase_html": {
      "command": "cmd.exe",
      "args": ["/d", "/c", "npx", "-y", "cloudbase-html-mcp@0.4.0-beta.5", "serve"]
    }
  }
}
```

这是完整的 `mcpServers` 配置；编辑已有文件时，只合并 `cloudbase_html` 条目，保留其他连接器。不要再在外面套一层 `mcpServers`，也不要把含 Key 的 credentials.env 粘进 JSON。默认不需要 `env`、`cwd` 或客户端专属字段。

### 各客户端的 JSON 是否一样

本项目为支持 `mcpServers` 的客户端提供同一份最小模板，**不代表所有 Agent 都使用同一种配置文件格式**。例如 [VS Code 官方文档](https://code.visualstudio.com/docs/agent-customization/mcp-servers) 的 `mcp.json` 根字段是 `servers`，不能直接照搬本页外层结构。客户端还可能有自己的 `type`、禁用开关、超时字段或配置作用域；这些都需要按该客户端说明填写。

| 客户端 | 本页 JSON 的使用方式 | 依据与边界 |
| --- | --- | --- |
| WorkBuddy | 进入“配置 MCP”的 JSON 编辑器，使用 `mcpServers`、`command`、`args`。 | [官方 MCP 指南](https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/MCP-Guide) 给出同结构；用户已在 macOS 通过 beta.2 接入。官方指南另说明用户级 `~/.workbuddy/mcp.json` 与项目级配置。 |
| 千问办公 | “添加 → 通过 JSON 导入”，粘贴本页对应系统模板。 | 依据用户提供的导入界面及 macOS beta.2 实测；未取得公开的完整官方 schema，不把结论扩展为所有版本兼容。 |
| QoderWork | “扩展 → 连接器 → 添加 → 粘贴 JSON 配置”，使用本页 STDIO 模板。 | [官方连接器指南](https://docs.qoder.com/qoderwork/connectors) 确认 JSON 导入和本地 STDIO；本项目在该客户端的实际接入仍待验收。 |
| 豆包工作 | 当前按“新建自定义连接器”的 STDIO 表单填写，不假设存在 JSON 导入。 | 用户截图显示分离的命令与参数字段；尚未确认公开 JSON 导入格式。用下节字段表映射本页 JSON，不编辑未经确认的客户端内部文件。 |

本页示例均为标准 JSON：使用英文双引号，不含注释和尾逗号。表单中的传输类型选 **STDIO**；有额外必填字段时按客户端说明处理，不把远程 HTTP/SSE 示例混进本地启动配置。

<a id="command-forms--命令表单"></a>
## 命令表单

以下命令固定使用 0.4.0-beta.5，不自动升级到其他版本。

macOS 完整命令：

```sh
npx -y cloudbase-html-mcp@0.4.0-beta.5 serve
```

Windows 完整命令：

```text
cmd.exe /d /c npx -y cloudbase-html-mcp@0.4.0-beta.5 serve
```

如果界面将命令和参数分开填写：

| 系统 | 命令 | 参数，每项单独填写 |
| --- | --- | --- |
| macOS | `npx` | `-y`、`cloudbase-html-mcp@0.4.0-beta.5`、`serve` |
| Windows | `cmd.exe` | `/d`、`/c`、`npx`、`-y`、`cloudbase-html-mcp@0.4.0-beta.5`、`serve` |

服务名称填 `cloudbase_html`，传输类型选 STDIO，环境变量留空。界面明确使用“秒”且覆盖连接或工具调用时，可设置 180 秒；毫秒字段不能直接填 180。没有文档依据时，不自行添加客户端 JSON 超时字段。

图形界面找不到 `npx` 时，查明它在本机的真实安装位置，使用实际绝对路径，参数继续分开填写。Windows 的 `.cmd` 启动器保留 `cmd.exe` 包装，必要时填写实际系统程序路径。不要照搬其他人的用户名或安装路径。

从旧版升级时，将连接器命令或 JSON 中的包版本改为 `0.4.0-beta.5`，保存并重载 MCP；无需移动凭据或站点登记。升级本身不会发布、恢复或下线任何站点。

<a id="client-specific-entry-points--各客户端入口"></a>
## 各客户端入口

| 客户端 | 入口和输入形式 | 已有依据及待验证项 |
| --- | --- | --- |
| QoderWork | “扩展 → 连接器 → 添加 → 粘贴 JSON 配置”；也可手填 STDIO，命令框接受完整命令。 | 官方指南确认入口；此前本机参考版本 0.9.17，当前安装包接入仍待实测。 |
| 豆包工作 | 打开桌面工作区的“新建自定义连接器”，选择 STDIO，分别填写命令与参数；JSON 导入未确认。 | 已读取本机豆包 Mac 版本 2.27.11；工作区入口、版本对应表单和安装包接入仍待实测。不要改用远程 SSE/HTTP。 |
| WorkBuddy | 截图入口为“专家·技能·连接器”→“自定义连接器”；官方新版指南为“插件→MCP 服务器”。进入“配置 MCP”后使用同一 JSON。截图包括“服务管理→配置 MCP”的 `mcpServers` 编辑器，以及命令和参数分开的 STDIO 表单。 | macOS 5.5.4（发布/下线截图可见）；用户确认自主接入、只读调用、发布和下线通过，更新与重启恢复待验收。 |
| 千问办公 | “扩展→连接器→添加”。截图包括 JSON 导入和接受完整命令的 STDIO 表单，超时字段明确使用秒。 | 此前参考界面版本为 Mac 1.0.4；用户确认 JSON 导入、只读调用、重复发布保护和明确另建页面通过；本轮精确客户端版本未在截图展示。 |

这是一份接入指南，兼容性结论以实际验证为准。beta.5 已通过四组运行时 CI 与公共 npm 冷启动，结果见 [项目验证状态](../PROJECT.md#v04-验证与发布安排)；Windows 桌面接入、QoderWork 和豆包工作仍待实测。不同版本可能提供不同控件，验证后按实际版本更新本表。

<a id="acceptance-record--实测记录"></a>
## 实测记录

2026-09-09，用户按当时 beta.2 接入流程确认下列两条路线成功，并提供客户端验收结果截图：

| 平台与客户端 | 接入路线 | 六工具发现 | hosting_status | list_html |
| --- | --- | --- | --- | --- |
| macOS · WorkBuddy | Agent 自主接入 | 通过 | 成功，默认文件配置、管理已启用 | 成功，返回 1 个本地已知站点 |
| macOS · 千问办公 | 连接器 JSON 手工导入 | 通过 | 成功，默认文件配置、管理已启用 | 成功，返回 1 个本地已知站点 |

以上为用户确认和结果截图支持的只读接入验收，尚未取得原始工具调用日志；首轮只读截图未展示客户端、Node 和 MCP 的精确运行版本，不能将此前参考界面版本当作该轮运行版本证明。测试按固定 0.4.0-beta.2 指南进行。

两边共用同一用户的配置及登记目录，返回同一个已有站点符合预期；列表的 `cloudVerified: false` 表示本次列表不逐站核对云端。上述首轮仅验证只读接入；后续发布及下线结果见下表，完整生命周期验收仍待执行。截图含私人环境和路径信息，仅在本地留档。

### 后续发布与下线

同日，用户继续在两款客户端中使用自己指定的 HTML 实测，并提供以下结果截图：

| 客户端 | 操作 | 已有结果 |
| --- | --- | --- |
| WorkBuddy 5.5.4 · macOS | 首次发布约 2.28 MiB HTML | 返回 PUBLISHED_PREVIEW，HTTP 200、哈希一致；内置预览中可见页面及缩略图。 |
| 千问办公 · macOS | 再次发布已登记的同一路径 | LOCAL_SITE_EXISTS 后通过 get_html 确认云端与本地一致，没有重复写入。 |
| 千问办公 · macOS | 用户明确要求另建页面 | 新 siteId 发布成功，PUBLISHED_PREVIEW、HTTP 200、哈希一致；当时原页面仍在。 |
| WorkBuddy 5.5.4 · macOS | 查询后按旧哈希下线原站点 | 返回 offline、observedStorage: absent、cleanup.complete: true；本地登记为 SAVED。 |

这些结果支持发布、共享路径登记保护、明确另建页面和原站点下线通过。`newPage` 新建不同 URL，不能作为同 URL 更新的验收证据。下线清理的快照数为 0，尚未覆盖真实旧快照删除；外部缓存即时失效也未验证。预览截图证明至少展示了一个页面，不能据此确认整份 HTML 的所有页面和关联资源完整。用户文件、业务内容、URL 和截图仅本地保存。

本轮发布/下线截图明确显示 WorkBuddy 5.5.4；Node、MCP 的运行版本和千问办公精确版本未显示。当前还缺同 URL 内容更新、客户端重启后查询及不依赖手改登记的原 URL 恢复，以及千问办公下线等完整流程证据。

### 共享文件恢复问题与修复边界

随后用户提供 WorkBuddy 的恢复过程截图：同一文件先发布为 A，再通过 `newPage` 发布为 B；下线 A 后，用该文件恢复 A 被 beta.2 的 `LOCAL_BINDING_CONFLICT` 拒绝。下线 B 仍不释放路径绑定。WorkBuddy 最终直接修改本地 `catalog-v2.json` 的绑定数据，再调用 `online_html` 恢复 A。

这证明最终恢复成功，但**不属于完整 MCP 流程通过**。截图中的修改对象是本地登记数据；另行比对本机 npx 安装包与已验证 beta.2 产物，31 个包文件一致，未发现 MCP 程序被改动的证据。直接编辑登记绕过了工具的锁和原子保存流程，不作为接入或恢复方法。

beta.3 已修复显式目标与文件默认绑定混用的问题，并补充离线、真实 STDIO 子进程及实际安装包回归：恢复 A 保留 B，更新 A 也保持原 URL。当前 beta.5 仍需升级后的桌面实测再次验收；不要将本地替身测试算作真实云端通过。

每次实际验证记录：操作系统、客户端和 Node 版本、输入方式、启动程序及不含密钥的参数、六工具发现、目标环境、`list_html`、授权测试文件的发布/更新结果及诊断。真实凭据、环境信息和站点 URL 保留在私密本地证据中。

每个操作系统至少选择一个客户端，在授权范围内通过下线删除、重启、列表读取及原 URL 恢复后，才能完成 v0.4 桌面验收。npm 发布、修改其他客户端配置和云端写入分别按实际授权执行。
