# 桌面客户端接入

本指南说明如何手动添加本地 STDIO MCP。当前 v0.4 为 **0.4.0-beta.2 公开测试版**，客户端兼容性仍待实测。也可按 [快速开始](getting-started.md#install-from-source-or-a-local-package) 使用本地包或已取得的 v0.4 源码。

<a id="common-preparation--公共准备"></a>
## 公共准备

1. 客户端未提供兼容运行时时，先按 [Node 安装与检查步骤](getting-started.md#prepare-node) 准备 Node.js 22+；已有可用运行时直接复用。检查通过后重启桌面客户端，使其获得新的 PATH。
2. 将管理员提供的完整 `credentials.env` 放到用户主目录下的 `.config/cloudbase-html-mcp/credentials.env`。MCP 自行定位，客户端环境变量栏不需要填 Key。
3. 选择下述一种输入形式，并固定包版本。首次下载超过客户端超时时，可先执行该版本的 `--version` 预下载，再连接。
4. 保留已有 MCP 条目，保存后通过客户端控件重载，必要时重启应用。确认六工具可见，再调用 `hosting_status`、`list_html`；新用户列表为空正常。

已有截图仅证明存在这些输入界面。连接图标变绿或 `tools/list` 成功，都不能证明 CloudBase 连通或拥有上传权限。先核对 `hosting_status` 中的目标环境，再按用户单独请求发布指定 HTML。

<a id="json-import--json-导入"></a>
## JSON 导入

空白导入弹窗可以使用完整模板：

- [macOS JSON](../templates/mcp.macos.json)
- [Windows JSON](../templates/mcp.windows.json)

编辑已有 `mcpServers` 时，只加入 `cloudbase_html`，保留其他条目。默认不需要 `env` 或 `cwd`。不要将含 Key 的 credentials.env 粘贴进这个 JSON 编辑器。

<a id="command-forms--命令表单"></a>
## 命令表单

以下命令固定使用 0.4.0-beta.2，不自动升级到其他版本。

macOS 完整命令：

```sh
npx -y cloudbase-html-mcp@0.4.0-beta.2 serve
```

Windows 完整命令：

```text
cmd.exe /d /c npx -y cloudbase-html-mcp@0.4.0-beta.2 serve
```

如果界面将命令和参数分开填写：

| 系统 | 命令 | 参数，每项单独填写 |
| --- | --- | --- |
| macOS | `npx` | `-y`、`cloudbase-html-mcp@0.4.0-beta.2`、`serve` |
| Windows | `cmd.exe` | `/d`、`/c`、`npx`、`-y`、`cloudbase-html-mcp@0.4.0-beta.2`、`serve` |

服务名称填 `cloudbase_html`，传输类型选 STDIO，环境变量留空。界面明确使用“秒”且覆盖连接或工具调用时，可设置 180 秒；毫秒字段不能直接填 180。没有文档依据时，不自行添加客户端 JSON 超时字段。

图形界面找不到 `npx` 时，查明它在本机的真实安装位置，使用实际绝对路径，参数继续分开填写。Windows 的 `.cmd` 启动器保留 `cmd.exe` 包装，必要时填写实际系统程序路径。不要照搬其他人的用户名或安装路径。

<a id="client-specific-entry-points--各客户端入口"></a>
## 各客户端入口

| 客户端 | 入口和输入形式 | 已有依据及待验证项 |
| --- | --- | --- |
| QoderWork | 打开“连接器”并添加；有 JSON 导入时可优先使用，否则选择 STDIO 表单。注意区分整条命令与分离参数。 | 已读取本机 Mac 版本 0.9.17；当前具体表单和安装包接入仍待实测。 |
| 豆包工作 | 打开桌面工作区的连接器设置，添加本地 STDIO MCP，按实际界面使用 JSON 或命令表单。 | 已读取本机豆包 Mac 版本 2.27.11；工作区入口、版本对应表单和安装包接入仍待实测。不要改用远程 SSE/HTTP。 |
| WorkBuddy | “专家·技能·连接器”→“自定义连接器”。截图包括“服务管理→配置 MCP”的 `mcpServers` 编辑器，以及命令和参数分开的 STDIO 表单。 | 已读取 Mac 5.5.4 并获得界面截图；保留编辑器内其他条目，安装包接入仍待实测。 |
| 千问办公 | “扩展→连接器→添加”。截图包括 JSON 导入和接受完整命令的 STDIO 表单，超时字段明确使用秒。 | 已读取 Mac 1.0.4；安装包接入仍待实测。 |

这是一份接入指南，兼容性结论以实际验证为准。macOS/Windows 的运行时 CI 矩阵已执行，结果见 [项目验证状态](../PROJECT.md#v04-验证与发布安排)；Windows 界面及四款客户端的安装包连接仍待实测。不同版本可能提供不同控件，验证后按实际版本更新本表。

<a id="acceptance-record--实测记录"></a>
## 实测记录

每次实际验证记录：操作系统、客户端和 Node 版本、输入方式、启动程序及不含密钥的参数、六工具发现、目标环境、`list_html`、授权测试文件的发布/更新结果及诊断。真实凭据、环境信息和站点 URL 保留在私密本地证据中。

每个操作系统至少选择一个客户端，在授权范围内通过下线删除、重启、列表读取及原 URL 恢复后，才能完成 v0.4 桌面验收。npm 发布、修改其他客户端配置和云端写入分别按实际授权执行。
