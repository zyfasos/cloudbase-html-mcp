# Agent 接入指南

<!-- release:version -->
本指南按 CLI、IDE、桌面客户端的实际格式添加本地 STDIO MCP，不限定 Agent 品牌。当前预发布版本为 **0.5.0-beta.1**。发布及运行时验证见 [项目验证状态](../PROJECT.md#v05-release)；下方客户端证据保留实际受测版本，不随接入命令升级。
<!-- /release:version -->

**此版本已发布到 npm 的 beta 标签**，可直接使用下面的固定版本配置；也可使用 [源码或本地包](getting-started.md#install-from-source-or-a-local-package)。同机共享目录的客户端升级到同一新版；旧版写入可能丢失新增站点名称和标题。现有桌面证据不等于本版本验收通过。

<a id="choose-integration"></a>
## 选择接入方式

先完成 [配置文件准备](getting-started.md#2-receive-or-prepare-the-configuration-file)，并确认 [MCP 运行位置](getting-started.md#execution-location)。可以让 Agent 按 [自主接入提示词](getting-started.md#agent-assisted-setup) 操作，也可以自己选择以下形式：

| 当前客户端的入口 | 使用哪一节 |
| --- | --- |
| CLI 命令，或项目/用户配置文件 | [CLI、IDE 与配置文件](#cli-and-config-files) |
| JSON 导入或 `mcpServers` 编辑器 | [通用 JSON](#json-import--json-导入) |
| 完整命令框，或命令/参数分离表单 | [命令表单](#command-forms--命令表单) |

同一启动程序不意味着同一种客户端 JSON。以下新增 CLI、IDE、OpenClaw 与 Hermes 示例依据 2026-09-11 官方文档整理，仅验证示例结构与命令，尚未通过本项目真实客户端验收。已有桌面实测按当时版本保留在 [实测记录](#acceptance-record--实测记录)，不自动升级为当前版通过。

<a id="common-preparation--公共准备"></a>
## 公共准备

1. 客户端未提供兼容运行时时，先按 [Node 安装与检查步骤](getting-started.md#prepare-node) 准备 Node.js 22+；已有可用运行时直接复用。新安装运行时后，重新打开终端或重启图形客户端，使其获得新的 PATH。
2. 将自己准备或管理员提供的完整 `credentials.env` 放到运行 MCP 的用户主目录下的 `.config/cloudbase-html-mcp/credentials.env`。MCP 自行定位，客户端环境变量栏不需要填 Key。
3. 选择下述一种输入形式，并固定包版本。首次下载超过客户端超时时，可先执行该版本的 `--version` 预下载，再连接。
4. 保留已有 MCP 条目，保存后通过客户端控件重载，必要时重启应用。确认六工具可见，再调用 `hosting_status`、`list_html`；新用户列表为空正常。

界面截图仅证明配置入口存在；本轮用户另提供了 WorkBuddy 与千问办公的实际验收结果截图，见下方实测记录。连接图标变绿或 `tools/list` 成功，都不能证明 CloudBase 连通或拥有上传权限。先核对 `hosting_status` 中的目标环境，再按用户单独请求发布指定 HTML。

<a id="cli-and-config-files"></a>
## CLI、IDE 与配置文件

先检查是否已存在 `cloudbase_html`，已有条目按客户端更新方式修改，不重复创建或覆盖其他配置。以下示例不带 Key，不更改工具授权策略。

### Claude Code

按 [官方 MCP 文档](https://code.claude.com/docs/en/mcp) 使用用户级 STDIO 配置。以下为 macOS 命令：

```sh
claude mcp add --transport stdio --scope user cloudbase_html -- npx -y cloudbase-html-mcp@0.5.0-beta.1 serve
```

Windows 的命令部分使用 `cmd.exe` 包装：

```text
claude mcp add --transport stdio --scope user cloudbase_html -- cmd.exe /d /c npx -y cloudbase-html-mcp@0.5.0-beta.1 serve
```

`--scope user` 让工具跨项目可用；所有 Claude Code 选项放在服务名称前，`--` 后是 MCP 的启动程序。添加后在 Claude Code 的 `/mcp` 中检查加载与工具状态，按客户端提示重新连接，再完成 [实际调用验证](getting-started.md#5-verify-the-connection)。本项目尚未实测这两条客户端命令。

### Qoder CLI / IDE

[Qoder CLI 官方参考](https://docs.qoder.com/cli/mcp-reference) 支持用户级 `~/.qoder/settings.json` 和项目级 `.mcp.json` 中的 `mcpServers`。选择所需作用域，把下节 JSON 的 `cloudbase_html` 条目合并进去；CLI 中使用 `/mcp reload` 重新发现。Qoder IDE 与 QoderWork 是不同入口，IDE 请按对应版本的 MCP 设置导入，不将 QoderWork 界面路径套到 IDE。此处是文档依据，不是本项目已测声明。

### Hermes Agent

[Hermes 官方指南](https://hermes-agent.nousresearch.com/docs/guides/use-mcp-with-hermes/) 使用 `~/.hermes/config.yaml` 中的 `mcp_servers`。macOS 示例：

```yaml
mcp_servers:
  cloudbase_html:
    command: npx
    args: ["-y", "cloudbase-html-mcp@0.5.0-beta.1", "serve"]
```

已有 `mcp_servers` 时只合并一个子项，不能重复 YAML 顶层键。Windows 将 `command` 改为 `cmd.exe`，`args` 使用下节 Windows JSON 中同一组参数。保存后按官方指南使用 `/reload-mcp`，再完成实际工具调用验证；本项目尚未实测。远程、容器或 WSL 部署先核对运行位置与平台验证边界。

### OpenClaw

[OpenClaw 官方 MCP 管理](https://docs.openclaw.ai/cli/mcp/registry) 使用 `mcp.servers`；这与把 OpenClaw 自身作为 MCP Server 的 `openclaw mcp serve` 是不同方向。macOS 下待合并的配置片段：

```json
{
  "mcp": {
    "servers": {
      "cloudbase_html": {
        "transport": "stdio",
        "command": "npx",
        "args": ["-y", "cloudbase-html-mcp@0.5.0-beta.1", "serve"]
      }
    }
  }
}
```

只合并 `mcp.servers.cloudbase_html`，保留其余 OpenClaw 配置。Windows 用下节 Windows JSON 对应的 `command` 和 `args` 替换。按官方管理入口保存、检查实际运行环境是否消费该配置，再验证六工具和只读调用；仅保存配置不代表工具已加载。此处未进行本项目真实 OpenClaw 验收，远程/容器组合也未验收。

<a id="json-import--json-导入"></a>
## JSON 导入

在支持 JSON 导入或 JSON 配置编辑器的客户端中，按操作系统复制。也可打开文件并复制其内容：[macOS JSON](../templates/mcp.macos.json) · [Windows JSON](../templates/mcp.windows.json)。

**macOS**

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

**Windows**

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

这是完整的 `mcpServers` 配置；编辑已有文件时，只合并 `cloudbase_html` 条目，保留其他连接器。不要再在外面套一层 `mcpServers`，也不要把含 Key 的 credentials.env 粘进 JSON。默认不需要 `env`、`cwd` 或客户端专属字段。

### 各客户端的 JSON 是否一样

本项目为支持 `mcpServers` 的客户端提供同一份最小模板，**不代表所有 Agent 都使用同一种配置文件格式**。例如 [VS Code 官方文档](https://code.visualstudio.com/docs/agent-customization/mcp-servers) 的 `mcp.json` 根字段是 `servers`，不能直接照搬本页外层结构。客户端还可能有自己的 `type`、禁用开关、超时字段或配置作用域；这些都需要按该客户端说明填写。

| 客户端 | 本页 JSON 的使用方式 | 依据与边界 |
| --- | --- | --- |
| WorkBuddy | 进入“配置 MCP”的 JSON 编辑器，使用 `mcpServers`、`command`、`args`。 | [官方 MCP 指南](https://www.codebuddy.cn/docs/workbuddy/From-Beginner-to-Expert-Guide/Function-Description/MCP-Guide) 给出同结构；用户已在 macOS 通过 beta.2 接入。官方指南另说明用户级 `~/.workbuddy/mcp.json` 与项目级配置。 |
| 千问办公 | “添加 → 通过 JSON 导入”，粘贴本页对应系统模板。 | 依据用户提供的导入界面及 macOS beta.2 实测；未取得公开的完整官方 schema，不把结论扩展为所有版本兼容。 |
| QoderWork | “扩展 → 连接器 → 添加 → 粘贴 JSON 配置”，使用本页 STDIO 模板。 | [官方连接器指南](https://docs.qoder.com/qoderwork/connectors) 确认 JSON 导入和本地 STDIO；用户已另行确认载入成功；精确受测版本及当前版完整调用验收仍待补齐。 |
| 豆包工作 | 当前按“新建自定义连接器”的 STDIO 表单填写，不假设存在 JSON 导入。 | 用户截图显示分离的命令与参数字段；尚未确认公开 JSON 导入格式。用下节字段表映射本页 JSON，不编辑未经确认的客户端内部文件。 |

本页示例均为标准 JSON：使用英文双引号，不含注释和尾逗号。表单中的传输类型选 **STDIO**；有额外必填字段时按客户端说明处理，不把远程 HTTP/SSE 示例混进本地启动配置。

<a id="command-forms--命令表单"></a>
## 命令表单

以下命令固定使用上方当前版本，不自动升级到其他版本。

macOS 完整命令：

```sh
npx -y cloudbase-html-mcp@0.5.0-beta.1 serve
```

Windows 完整命令：

```text
cmd.exe /d /c npx -y cloudbase-html-mcp@0.5.0-beta.1 serve
```

如果界面将命令和参数分开填写：

| 系统 | 命令 | 参数，每项单独填写 |
| --- | --- | --- |
| macOS | `npx` | `-y`、`cloudbase-html-mcp@0.5.0-beta.1`、`serve` |
| Windows | `cmd.exe` | `/d`、`/c`、`npx`、`-y`、`cloudbase-html-mcp@0.5.0-beta.1`、`serve` |

服务名称填 `cloudbase_html`，传输类型选 STDIO，环境变量留空。界面明确使用“秒”且覆盖连接或工具调用时，可设置 180 秒；毫秒字段不能直接填 180。没有文档依据时，不自行添加客户端 JSON 超时字段。

图形界面找不到 `npx` 时，查明它在本机的真实安装位置，使用实际绝对路径，参数继续分开填写。Windows 的 `.cmd` 启动器保留 `cmd.exe` 包装，必要时填写实际系统程序路径。不要照搬其他人的用户名或安装路径。

从旧版升级时，将连接器命令或 JSON 中的包版本改为本页示例的固定版本，保存并重载 MCP；无需移动凭据或站点登记。升级本身不会发布、恢复或下线任何站点。

<a id="client-specific-entry-points--各客户端入口"></a>
## 桌面客户端入口与参考证据

| 客户端 | 入口和输入形式 | 已有依据及待验证项 |
| --- | --- | --- |
| QoderWork | “扩展 → 连接器 → 添加 → 粘贴 JSON 配置”；也可手填 STDIO，命令框接受完整命令。 | 官方指南确认入口；此前本机参考版本 0.9.17，后续用户确认载入成功，当前版完整调用验收待进行。 |
| 豆包工作 | 打开桌面工作区的“新建自定义连接器”，选择 STDIO，分别填写命令与参数；JSON 导入未确认。 | 已读取本机豆包 Mac 版本 2.27.11；后续用户确认载入成功，尚不能绑定到该参考版本，当前版完整调用验收待进行。不要改用远程 SSE/HTTP。 |
| WorkBuddy | 截图入口为“专家·技能·连接器”→“自定义连接器”；官方新版指南为“插件→MCP 服务器”。进入“配置 MCP”后使用同一 JSON。截图包括“服务管理→配置 MCP”的 `mcpServers` 编辑器，以及命令和参数分开的 STDIO 表单。 | macOS 5.5.4（发布/下线截图可见）；用户确认自主接入、只读调用、发布和下线通过，更新与重启恢复待验收。 |
| 千问办公 | “扩展→连接器→添加”。截图包括 JSON 导入和接受完整命令的 STDIO 表单，超时字段明确使用秒。 | 此前参考界面版本为 Mac 1.0.4；用户确认 JSON 导入、只读调用、重复发布保护和明确另建页面通过；本轮精确客户端版本未在截图展示。 |

这是一份接入指南，兼容性结论以实际验证为准。运行时 CI 与公共 npm 冷启动结果见 [项目验证状态](../PROJECT.md#v05-release)；Windows 桌面实机按用户决定暂缓。用户后续确认 QoderWork、豆包工作载入成功，但未补齐该轮版本与完整调用记录；不据此宣称当前版功能验收通过。不同版本可能提供不同控件，验证后按实际版本更新本表。

<a id="acceptance-record--实测记录"></a>
## 实测记录

以下按历史受测版本记录，文中的待验收项指当时证据缺口。后续用户确认 WorkBuddy、千问完成进一步生命周期和共享文件测试，QoderWork、豆包工作载入成功；当前 v0.5 新特性验收另行记录，不把历史结果或截图扩展为新版本通过。

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

beta.3 已修复显式目标与文件默认绑定混用的问题，并补充离线、真实 STDIO 子进程及实际安装包回归：恢复 A 保留 B，更新 A 也保持原 URL。当前版本仍需升级后的桌面实测再次验收；不要将本地替身测试算作真实云端通过。

每次实际验证记录：操作系统、客户端和 Node 版本、输入方式、启动程序及不含密钥的参数、六工具发现、目标环境、`list_html`、授权测试文件的发布/更新结果及诊断。真实凭据、环境信息和站点 URL 保留在私密本地证据中。

每个操作系统至少选择一个客户端，在授权范围内通过下线删除、重启、列表读取及原 URL 恢复后，才能完成 v0.4 桌面验收。npm 发布、修改其他客户端配置和云端写入分别按实际授权执行。
