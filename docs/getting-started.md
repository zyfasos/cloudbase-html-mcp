# 快速开始

<a id="1-what-you-will-have"></a>
<a id="1-the-main-workflow"></a>
## 1. 接入流程

**准备 Node.js → 放好完整配置文件 → 在桌面 Agent 中添加 MCP → 验证 → 开始使用。**

当前 v0.4 为 **0.4.0-beta.3 测试版**，包含共享文件绑定、恢复提示和目录分享地址调整。请使用文中的固定版本命令，也可采用 [源码或本地安装包](#install-from-source-or-a-local-package)。macOS 和 Windows 均要求 Node.js 22+，安装包不内置 Node。beta.3 已通过四组 CI 和公共 npm 冷启动；WorkBuddy/千问办公桌面证据来自 beta.2，新版桌面复验仍待完成，见 [验证状态](../PROJECT.md#v04-验证与发布安排)。

你需要支持本地 STDIO MCP 的桌面客户端，以及已开启静态托管的 CloudBase 环境。管理员可以直接提供下述完整文件；收到文件后，无需 CloudBase 账号登录或重填三个参数。人和 Agent 共用本指南；接入检查本身不授权发布 HTML 或修改云资源。

<a id="prepare-node"></a>
### 准备 Node.js（首次使用）

已有可用的 Node.js 22+ 和 npm/npx 时直接复用，无需重装。还没有安装时：

1. 打开 [Node.js 官方中文下载页](https://nodejs.org/zh-cn/download)，新安装可选择 **Node.js 24 LTS**。选择自己的操作系统及对应架构，下载安装程序；不需要 Docker 或源码包。
2. **macOS：**在“关于本机”查看芯片类型（Apple 芯片或 Intel），选择对应选项，下载并双击 `.pkg` 安装程序。**Windows：**在“设置→系统→关于→系统类型”查看 x64 或 ARM64，下载对应的 `.msi` 安装程序。按默认选项完成安装；如果提供 npm、加入 PATH 等选项，请保持启用，以便后续使用 npm/npx 命令。参见 [npm 安装说明](https://docs.npmjs.com/downloading-and-installing-node-js-and-npm/)。
3. 安装后重新打开终端：macOS 使用“终端”；Windows 可按 `Win+R` 输入 `cmd` 打开命令提示符。也可以让已有终端执行能力的 Agent 帮你检查：

```sh
node --version
npm --version
npx --version
```

三条命令均应输出版本号，Node 主版本应为 22 或更高。找不到命令时先关闭旧终端并重新打开；仍失败则检查安装是否完成及 PATH，不继续添加 MCP。检查通过后完全退出并重新打开桌面 Agent，使它也获得新的 PATH，然后领取或放置配置文件。

<a id="2-before-you-begin"></a>
<a id="2-receive-or-prepare-the-configuration-file"></a>
## 2. 领取或准备配置文件

<a id="43-alternative-prepare-the-private-environment-file-manually"></a>
<a id="for-the-administrator"></a>
### 管理员如何准备

复制 [credentials.env.example](../templates/credentials.env.example)，填好三个必填值，以 **credentials.env** 文件名私下交付。使用环境的管理端 API Key，不使用 Publishable Key、Key ID 或 CAM SecretId/SecretKey。

```dotenv
CLOUDBASE_ENV_ID=your-env-id
CLOUDBASE_REGION=your-region
CLOUDBASE_API_KEY=your-full-environment-api-key
```

将示例值替换为实际环境信息。文件不包含收件人的用户名或安装路径。可选项 `CLOUDBASE_PUBLIC_BASE_URL`、`CLOUDBASE_REGISTRY_DIR` 见模板和 [.env.example](../.env.example)，普通接入可以留空。登记目录默认位于收件人的用户主目录；设置为 `off` 会关闭列表、下线和恢复功能。

将填好的文件与对应 [客户端 JSON](clients.md#json-import--json-导入) 一起交付。两份材料职责不同：

| 文件/配置 | 谁准备、放在哪里 | 是否含 Key |
| --- | --- | --- |
| `credentials.env` | 管理员填好，收件人放到下述固定用户目录。 | 是，私下交付。 |
| MCP JSON | 使用本项目模板，粘到桌面 Agent 的导入或配置编辑器。 | 否，只说明启动哪个程序。 |

尚未取得 Key 时按 [控制台获取步骤](#get-cloudbase-api-key) 操作；已拿到完整文件的收件人直接继续放置。本指南不会自动创建或发送凭据。

<a id="for-the-recipient"></a>
### 收件人如何放置

保留 UTF-8 纯文本格式，支持 Windows 常见的 CRLF 换行和 UTF-8 BOM。将收到的文件放在自己用户主目录下：

```text
.config/cloudbase-html-mcp/credentials.env
```

- **macOS：**访达 → 前往 → 前往文件夹（`⌘⇧G`），输入 `~/.config/cloudbase-html-mcp`。目录已存在时，直接放入文件；目录不存在时，使用下面的“创建并打开目录”步骤，不要求在访达手动新建点开头的目录。按 `⌘⇧.` 可显示隐藏文件。
- **Windows：**在资源管理器地址栏粘贴 `%USERPROFILE%`，依次创建 `.config` 和 `cloudbase-html-mcp` 文件夹，再放入文件。开启“文件扩展名”显示，确认没有变成 `credentials.env.txt`。

**Mac 目录尚不存在时：**可直接对已有终端能力的 Agent 说：

> 请帮我创建并在访达打开当前用户的 ~/.config/cloudbase-html-mcp 目录。我会放入管理员给的 credentials.env。保留已有目录和文件，不读取或覆盖凭据，不发布页面。

Agent 或用户可在 macOS 终端执行下列一次性命令；它只创建缺少的目录并打开文件夹，不创建或覆盖凭据文件，也不更改已有目录权限：

```sh
(
  umask 077
  mkdir -p "$HOME/.config/cloudbase-html-mcp" &&
    open "$HOME/.config/cloudbase-html-mcp"
)
```

看到打开的文件夹后，再放入收到的文件。若命令报告权限错误或访达未打开，先检查终端提示，不把失败当作目录已就绪。

已有文件时，先核对目标环境再决定是否复用，不覆盖其他接入配置。程序自行定位用户主目录；默认情况下，客户端无需填写用户名、配置路径或 `cwd`。该文件与 npm 安装目录、缓存及源码目录分开保存。

在 macOS/Linux 上，新入口可以把标准默认位置中属于当前用户的专用目录和普通文件权限收紧为目录 0700、文件 0600，不修改内容；拒绝 Git 目录、凭据文件链接及被重定向的默认目录。显式自定义路径保持严格检查，不自动改权限。Windows 使用当前账户已有 ACL，不提权、不重写 ACL，也不以 POSIX 模式位判断 Windows 权限。

<a id="new-to-cloudbase"></a>
### 从零准备 CloudBase

**已收到完整配置文件？**直接按上节放置并继续添加 MCP。**只收到 Key？**向管理员取得对应环境 ID 和地域后填写模板，也可以使用 [可选向导](#optional-setup-wizard)，无需控制台登录。

已有环境和私密配置时直接复用。需要从零准备的环境所有者按下表操作；控制台名称可能调整，以官方指南为准。

| 步骤 | 操作 | 完成标志 |
| --- | --- | --- |
| 1. 登录 | 打开 [CloudBase 控制台](https://tcb.cloud.tencent.com/dev)，注册或登录腾讯云账户并完成要求的身份验证。 | 可以使用环境所属账户进入控制台。 |
| 2. 准备环境 | 参考 [创建环境](https://docs.cloudbase.net/quick-start/create-env)。优先复用合适环境；新建前核对服务条款、服务角色授权、地域和套餐。 | 初始化完成，已选中目标环境。 |
| 3. 记录环境信息 | 在环境信息或设置中复制环境 ID（EnvId）和地域代码。使用 ID 而非显示名称，地域不能直接照搬示例。 | 两个值属于同一目标环境。 |
| 4. 检查静态托管 | 打开该环境的“静态网站托管”，按需要核对并完成开通；已有 HTML 使用“文件管理”流程，见 [托管指南](https://docs.cloudbase.net/hosting/quick-start)。 | 静态托管文件管理可用，稍后由 MCP 检查在线状态。 |
| 5. 获取 Key | 在同一环境的“环境管理 → API Key 配置”中创建服务端 Key，详见下方步骤。 | 拿到完整 Key，而非名称、ID 或列表中的脱敏值。 |

环境所有者在控制台完成登录、身份验证、服务授权、资源开通、套餐支付确认及 Key 创建。Agent 可解释步骤并继续本地检查，但不能仅因“接入”请求就代下单、开通资源或创建凭据。云服务费用、试用和配额以当前账户及套餐为准，工具采用 MIT 不代表云服务免费。

<a id="get-cloudbase-api-key"></a>
### 在控制台获取服务端 API Key

以下步骤面向环境管理员。界面名称按 2026-09-09 的控制台截图核对；后续版本如有调整，在当前环境中查找“API Key 配置”。只领取配置文件的使用者无需完成这些步骤。尚未准备环境或静态托管时，先完成 [从零准备 CloudBase](#new-to-cloudbase)。

1. 打开 [CloudBase 控制台](https://tcb.cloud.tencent.com/dev)，在顶部选择要发布网页的环境。记录该环境的 **环境 ID** 和 **地域代码**，稍后分别填入 `CLOUDBASE_ENV_ID`、`CLOUDBASE_REGION`。地域使用 `ap-shanghai` 这样的代码，按实际环境填写，不照搬示例。
2. 点击左下角 **环境管理**，在中间菜单选择 **API Key 配置**。
3. 页面上方是 **客户端 Publishable Key**；本工具使用下方的 **服务端 API Key** 区域，点击其中的 **创建 API Key**。
4. 在弹窗中填写便于识别的名称，例如 `html-sharing`，按使用安排选择 **过期时间**，然后点击 **创建**。名称只是标识，不是要填进配置的凭据。
5. 在创建结果中复制**完整 Key 值**，立即保存到 `credentials.env` 的 `CLOUDBASE_API_KEY=` 后面。保留整段字符串，不加 `Bearer `，不填 Key ID、名称或列表里的脱敏值。完整 Key 仅在创建时返回，参见 [官方 API Key 说明](https://docs.cloudbase.net/api-reference/manager/node/login-config#createapikey)。
6. 核对三个值属于同一环境，保存为 UTF-8 纯文本的 `credentials.env`。管理员可整份私下交付；收件人按 [固定位置](#for-the-recipient) 放好，再添加 MCP。

```dotenv
CLOUDBASE_ENV_ID=your-env-id
CLOUDBASE_REGION=your-region
CLOUDBASE_API_KEY=your-full-environment-api-key
```

上面全部为占位值。若创建后只剩脱敏列表、完整值已丢失，需要管理员重新创建并更新配置；已有有效的完整 Key 可以继续复用，不删除其他服务正在使用的 Key。Key 到期或更换后，更新收件人的文件并重载 MCP，再用 `hosting_status` 检查。

此 Key 是管理端环境凭据，权限范围大于本工具的六项能力；保持在私密配置文件中，不放入发布的 HTML、公开 MCP JSON 或 Git 仓库。它与 Publishable Key、CAM SecretId/SecretKey、CloudBase CLI 登录态不同。[官方 MCP 认证说明](https://docs.cloudbase.net/ai/cloudbase-ai-toolkit/connection-modes) 介绍了环境 Key 换取临时凭据的机制；本项目使用上面的 `credentials.env` 格式，不照搬官方 MCP 的启动配置。

**连通检查不要求自定义域名。**初次接入可不设置 `CLOUDBASE_PUBLIC_BASE_URL`。默认域名限制见 [首次使用](#6-first-use)，绑定自定义域名是单独的配置决定，不需要为了完成接入上传控制台样例。

<a id="3-let-your-agent-set-it-up"></a>
<a id="44-register-the-server-in-your-client"></a>
<a id="3-add-the-mcp-to-your-client"></a>
## 3. 在桌面 Agent 中添加 MCP

按 [桌面客户端接入](clients.md) 配置 QoderWork、豆包工作、WorkBuddy 或千问办公。指南提供 macOS/Windows 的完整 JSON、整条命令及分离参数形式。保留已有 MCP 条目，选择 **STDIO**，服务名称填 `cloudbase_html`；采用配置文件时，环境变量栏留空。

### 手工配置：直接复制 JSON

选择“通过 JSON 导入”或“配置 MCP”的 JSON 编辑器，按运行 MCP 的电脑系统复制下列内容。已有配置时只合并 `mcpServers.cloudbase_html` 条目。`credentials.env` 事先放好后，JSON 中不需要 `env`、Key 或用户名路径。

**macOS** · [同内容文件](../templates/mcp.macos.json)

```json
{
  "mcpServers": {
    "cloudbase_html": {
      "command": "npx",
      "args": ["-y", "cloudbase-html-mcp@0.4.0-beta.3", "serve"]
    }
  }
}
```

**Windows** · [同内容文件](../templates/mcp.windows.json)

```json
{
  "mcpServers": {
    "cloudbase_html": {
      "command": "cmd.exe",
      "args": ["/d", "/c", "npx", "-y", "cloudbase-html-mcp@0.4.0-beta.3", "serve"]
    }
  }
}
```

WorkBuddy 和千问办公的 JSON 接入已有 beta.2 实测依据，QoderWork 官方说明提供 JSON 导入入口；豆包工作按已确认的 STDIO 表单分别填 `command` 与 `args`。具体入口、可选字段和格式差异见 [客户端指南](clients.md#json-import--json-导入)。不要把整段 JSON 当作终端命令。

### 让 Agent 帮忙接入

可以复制：

> 阅读 https://github.com/zyfasos/cloudbase-html-mcp/blob/main/docs/getting-started.md ，帮我接入 cloudbase_html MCP。复用已有 Node 和管理员提供的完整 credentials.env，帮助放到固定位置，不让我拆分或重填 Key。使用对应系统和客户端的固定版本配置，保留其他连接器，完成 hosting_status 与 list_html 只读验证，不发布页面。如果指定 npm 版本未发布，明确说明并使用我提供的本地安装包或源码，不另装其他包。

已有本地检出时，可将上述链接替换为本仓库的 `docs/getting-started.md`。

<a id="4-install-and-configure"></a>
<a id="4-advanced-and-alternative-setup"></a>
## 4. 其他配置与安装方式

<a id="configuration-sources"></a>
### 配置来源

| 命令 | 使用的配置 |
| --- | --- |
| `cloudbase-html-mcp serve`，或不传子命令 | 用户主目录下的默认 credentials.env |
| `cloudbase-html-mcp serve --config "/absolute/private/credentials.env"` | 仅使用指定私密文件 |
| `cloudbase-html-mcp serve --env` | 仅使用五个受支持的 CloudBase 环境变量 |

Windows 的配置文件绝对路径不能包含 `..` 路径段；使用默认位置或不含父目录跳转的完整路径。

`--config` 与 `--env` 互斥。文件缺失或无效时不回退到继承的环境变量，不混合不同来源的字段。新入口要求每行一个赋值，支持注释及引号值，拒绝语法错误或重复字段。配置在进程启动时读取；修改或替换后重载 MCP。`--help`、`--version` 不需要凭据，也不连接云端。

<a id="42-run-the-local-setup-wizard-recommended"></a>
<a id="optional-setup-wizard"></a>
### 可选向导

自行准备配置的用户，可在本机交互式终端运行：

```sh
npx -y cloudbase-html-mcp@0.4.0-beta.3 setup
```

向导收集环境、地域及隐藏输入的 Key，只读检查通过后才保存。已有配置默认复用，输入 `edit` 修改；Key 留空则保留原值。取消或失败保留原文件，不自动修改桌面客户端配置。

可选参数为 `--env-id ID`、`--region REGION`、`--config ABSOLUTE_PATH`，或 `--connection ABSOLUTE_JSON_PATH`。其中连接 JSON 仅含 `envId` 和 `region`，不含 Key，与完整的 credentials.env 不同。Key 不通过命令参数或管道输入。

生成的 JSON/TOML 使用固定包版本，不引用 npx 缓存。Windows 标准文件位置使用默认模式；自定义路径含 cmd.exe 解释字符时，在检查或保存前拒绝。参数数组支持普通空格和中文路径。

向导对自定义文件继续严格检查权限。macOS/Linux 使用当前用户拥有的专用目录（0700）和普通文件（0600）；Windows 使用账户 ACL。

<a id="41-install-and-check-locally"></a>
<a id="install-from-source-or-a-local-package"></a>
### 从源码或本地安装包接入

普通接入优先使用 npm。需要开发或排错时，获取本仓库包含 v0.4 的源码，进入项目根目录运行下列命令；已有检出先保留本地改动，再核对版本：

```sh
npm ci --ignore-scripts
npm run test:prepare
npm run check
npm test
node bin/cli.mjs --version
```

`npm run test:prepare` 会从 npm 下载测试安装所需内容，保存到仓库内已忽略的 `artifacts/test-npm-cache/`，不访问 CloudBase；随后 `npm test` 使用该缓存离线验证真实安装包。依赖变更或清理缓存后重新准备。

v0.4 使用 `npm-shrinkwrap.json`。仍处于 v0.3 的检出不包含新 CLI，应使用实际的 v0.4 源码或提供的安装包，不另建空项目替代。源码向导仍可通过 `npm run setup` 使用；它生成的 npx 配置要求对应版本已发布，本地开发时改用下述源码入口。

客户端的 `command` 使用 Node 的绝对路径，可通过 `node -p "process.execPath"` 获取；参数中的示例路径替换为实际位置：

```json
["/absolute/path/to/cloudbase-html-mcp/bin/cli.mjs", "serve"]
```

收到本地 `.tgz` 时，将引号内的示例替换为实际文件路径，并保留双引号，避免空格被拆成多个参数。Windows 在命令提示符（cmd）中执行。此操作安装程序命令，不写入云端凭据：

```sh
npm install --global --ignore-scripts "/absolute/path/cloudbase-html-mcp-0.4.0-beta.3.tgz"
cloudbase-html-mcp --version
```

全局安装后，macOS 使用命令 `cloudbase-html-mcp` 和参数 `serve`；Windows 使用 `cmd.exe` 及参数 `/d`、`/c`、`cloudbase-html-mcp`、`serve`。核对客户端 PATH；必要时使用实际 Node 绝对路径和已安装 CLI 文件路径，不引用临时解压目录。

旧的 `node src/server.mjs` 环境变量入口、`node scripts/start.mjs /absolute/private/credentials.env` 显式文件入口仍可用。旧 start 入口文件读取失败时先退出；新 CLI 则允许发现工具并返回配置错误。Node 原生 `--env-file` 优先使用继承的环境变量，与新 CLI 的隔离文件配置不同。

<a id="5-verify-the-connection"></a>
## 5. 验证连接

在实际桌面客户端保存并重载 MCP，确认恰好提供 `hosting_status`、`publish_html`、`get_html`、`list_html`、`offline_html`、`online_html` 六工具。

调用 `hosting_status`，应返回 `ok: true`、预期环境和地域，以及新 CLI 使用的 `configuration.source` / `configuration.path`，不包含 Key。再调用 `list_html` 验证本地登记可读；新用户空列表正常。`hosting_status` 本身不读取目录，要使用完整管理能力，`management.enabled` 应为 true。

新入口遇到配置缺失、不可读或无效时仍可初始化和发现工具；调用会返回配置位置及修复建议，不访问云端。放好文件后重载。`--env` 模式的错误指向客户端变量，不虚构文件路径。

实际桌面客户端检查通过才算接入完成。独立 SDK 子进程通过不代表桌面配置已加载；接入检查不验证上传、删除权限或公网 HTML，首次发布需要用户另行指定文件并发起操作。

<a id="6-first-use"></a>
## 6. 首次使用

<a id="publish-a-page"></a>
### 发布页面

将示例路径替换为自己的文件，对 Agent 说：

> 将 `/absolute/path/report.html` 发布到我配置的 CloudBase 环境，并给我链接。

使用 `publish_html` 上传**用户指定的文件**，要求 UTF-8 HTML、最多 5 MiB；不上传关联的本地资源。不为完成接入擅自上传样例或业务文件。

成功结果包含 `siteId`、内容哈希、URL 和验证状态。需要从其他机器访问此页面时，保留站点 ID。

<a id="update-an-existing-page"></a>
### 更新同一页面

持续迭代同一 URL 时复用 `siteId`。`publish_html` 覆盖 `sites/<siteId>/index.html`，不创建云快照；域名映射不变时 URL 不变。`newPage: true` 表示另建页面，不用于更新。

**从 beta.3 起默认返回 `/sites/<siteId>/` 分享地址**，云端仍保存 `index.html`。公网验证直接请求目录地址，不用文件地址的成功结果代替。目录返回错误、内容不符或重定向时不会标记公网验证通过，也不会自动修改托管配置。旧 `/sites/<siteId>/index.html` 链接继续支持查询、更新、下线和恢复，无须重新部署已有文件；升级只改变返回链接的形式，不生成新站点。列表与离线查询也将旧登记链接展示为目录形式，仍不额外访问云端核验。

> 更新之前从 `/absolute/path/report.html` 发布的页面。

用户要更新该文件的当前默认站点时，调用 `get_html({"localPath":"/absolute/path/report.html"})`，再将返回的 `siteId`、当前 `sha256` 作为更新目标和 `expectedSha256`。如果同一文件已通过 `newPage` 发布成多个站点，要更新较早的页面，请直接提供它的 ID 或 URL；按文件路径查询不会自动选中历史站点。如果没有登记，询问已知 ID 或确认用户确实想新建，不把更新请求静默改成首次发布。

Agent 的顺序为：

1. 用户指定了 ID/URL 时按该目标调用 `get_html`；仅在目标是文件当前默认站点时按登记路径查询。
2. 用新文件路径、同一 ID 和查询返回的旧哈希调用 `publish_html`。
3. 检查结果；若发生冲突，重新查询并核对目标，再决定后续操作。

只有 URL 时，调用 `get_html({"siteUrl":"https://your-domain.example/sites/s_REPLACE_WITH_VALID_ID/"})`，将域名和 ID 替换为实际地址；随后携带 `siteUrl`、`localPath` 和旧哈希更新。仅接受规范 HTTPS 站点路径，可带片段、不带查询参数；输入路径和规范 `index.html` 路径均须映射到当前环境托管资源。路由查询不完整会拒绝。

分享前按状态判断：

| 状态 | 含义 |
| --- | --- |
| `PUBLISHED` | 公网返回 HTML、内容与上传文件一致，且未强制下载。 |
| `PUBLISHED_PREVIEW` | 内容一致，但默认域名响应提示预览限制，例如 attachment 下载头；浏览器体验可能不同。 |
| `UPLOADED_NOT_PUBLICLY_VERIFIED` | 存储校验通过，公网访问尚未验证。 |

默认域名用于开发测试，可能显示访问提示或触发下载，见 [官方域名指南](https://docs.cloudbase.net/service/alias)。直接对外分享可使用已绑定当前环境的 HTTPS 自定义域名，并按需在私密文件中设置 `CLOUDBASE_PUBLIC_BASE_URL`；MCP 不创建域名或修改路由。

失败时按 `next_step` 处理，其中提供有界重试建议，必要时给出工具名、`suggested_args` 或 `required_config`。内容冲突或写入结果不确定时先查询；`isError` 不代表云端一定没有写入。登记恢复与域名选择机制见 [架构说明](architecture.md)。

<a id="list-take-offline-and-restore"></a>
### 列表、下线和恢复

用 `list_html({"limit":50})` 列出当前环境本地已知站点；可按 `lifecycle: "online"` 或 `"offline"` 过滤，用 `nextOffset` 翻页。这是最近保存状态，要确认当前云端事实请调用 `get_html`。旧迁移记录在写操作核验前可能为 `lifecycle: null`。

使用列表中的站点 ID 或已核验 URL 管理。`localPaths` 是当前绑定路径；`sourcePaths` 仅记录历史来源，`newPage` 后原文件可能已绑定另一站点，不能将历史来源当作当前选择器。

> 将这个已发布 URL 下线，删除云端 HTML 和旧快照，保留本地文件与登记。

先调用 `get_html`，再用 ID、URL 或登记路径三选一，携带查询得到的 `sha256` 调用 `offline_html`。此操作删除云端内容，删除前检查 Bucket 版本控制。当前 HTML 已删、快照未清完时，报告 `cleanup.complete: false` 并继续原操作，不宣称空间已全部回收。删除不会清除外部缓存。

> 使用 `/absolute/path/report.html` 恢复该离线页面，保持原 URL。

用站点 ID 或已核验 URL，加上本次指定文件调用 `online_html`。要求有本地离线登记，文件存在且云端当前对象不存在；对象意外出现时返回冲突。先完成待处理清理；前次恢复已写入相同内容但结果不确定时，可核验完成。已在线页面按正常流程更新。

**同一文件对应多个站点：**beta.3 已修复这一场景。明确提供 A 的 `siteId` 或 `siteUrl` 时，可用默认绑定到 B 的文件更新或恢复 A；B 的内容、生命周期和默认绑定均不变。之后只按文件路径查询，仍会找到 B；继续管理 A 请保留 A 的 ID/URL。返回的 `pathBinding` 说明文件的默认绑定，顶层 `siteId` 才是本次目标。只有 `newPage` 或完成对应 pending 新建才切换已有默认绑定。

如果 beta.2 报 `LOCAL_BINDING_CONFLICT`，不要下线其他站点或直接编辑 `catalog-v2.json`；下线保留路径绑定。可让用户指定一份放在未登记路径的 HTML 副本，再用原站点 ID 恢复，或升级到 beta.3 后重试原目标。

恢复前置检查失败时，按具体错误修正：文件缺失或 HTML 无效先处理本地文件；登记锁占用先等待写入结束；凭据/托管错误先修正配置。当前机器没有目标的离线登记时不能自动认领，不将恢复请求改成另建站点。写入结果不确定时，应先查询原目标，再决定是否重试原恢复操作。

云端成功、本地终写警告时，查询后重试同一操作，不另建 ID。列表、下线和恢复要求本地登记启用；`off` 会关闭它们。进程退出留下的环境锁，只能在确认没有写入者后人工清理。

<a id="existing-v02-installations"></a>
### 从 v0.2 升级

升级后重载 MCP，在客户端允许列表中启用六工具。新发布不再创建 `deployments/` 快照或返回新 `versionKey`；首次环境写锁内迁移旧登记，保留已使用及 pending ID 和原记录文件，不应再用 v0.2 写入。需要迁移备份时可事先备份私密登记目录。

旧快照不会自动删除。下线包含目标站点的旧快照清理；保持站点在线、只清旧快照时按下一节操作。

<a id="clean-legacy-snapshots-while-keeping-current-html"></a>
#### 保持在线，仅清理旧快照

清理脚本默认只读输出清单。在源码目录指定环境和站点 ID，将 JSON 保存到已有的仓库外私密目录。示例 ID 须替换为 `s-` 加 32 位小写十六进制；多个站点重复传 `--site-id`。以下 POSIX 示例拒绝覆盖已有清单：

```sh
(
  umask 077
  set -C
  node --env-file="/absolute/private/cloudbase-html.env" scripts/cleanup-snapshots.mjs --env-id YOUR_ENV_ID --site-id s_REPLACE_WITH_VALID_ID > "/absolute/private/cleanup-manifest.json"
)
```

仅在命令成功且生成完整 JSON 时继续；检查 `envId`、`region`、`bucket`、精确对象键、`count` 和 `bytes`。失败时不执行空或残缺清单，修正后使用新清单路径。此脚本使用 Node 原生 `--env-file`，继承的环境变量优先；请在没有冲突覆盖值的终端执行，它不会像新 MCP 文件入口一样隔离配置。

清单得到明确批准后再执行：

```sh
node --env-file="/absolute/private/cloudbase-html.env" scripts/cleanup-snapshots.mjs --env-id YOUR_ENV_ID --site-id s_REPLACE_WITH_VALID_ID --apply --manifest "/absolute/private/cleanup-manifest.json"
```

执行时保持环境和站点参数一致，并启用本地登记。脚本核对环境、Bucket、严格旧路径格式和当前 ETag/大小，仅删除清单中的对象，保留当前 HTML 和后来新增的快照，共用本地环境锁。COS 原生版本控制启用、暂停或无法核实时阻止破坏性清理，不修改其设置，也不把未完成清理写成已全部回收。

<a id="7-troubleshooting"></a>
## 7. 常见问题

| 现象 | 处理方式 |
| --- | --- |
| Node 低于 22 或找不到 npx | 按 [Node 准备步骤](#prepare-node) 安装或检查版本，重启桌面客户端刷新 PATH；核对实际安装位置。 |
| npm 对候选版本返回 404 | 指定包或版本可能未发布；使用提供的本地包或源码，不静默安装其他包或 latest。 |
| 首次连接超时 | 检查 npm 网络，先运行固定版本的 `--version` 预下载，再重载；核对客户端超时单位。 |
| `CONFIG_FILE_MISSING` | 将 credentials.env 放到返回的绝对路径，核对用户目录及隐藏的 `.txt` 扩展名后重载。 |
| `CONFIG_REQUIRED` / 无效字段 | 修正选定文件中列出的字段；`--env` 模式则修改客户端变量，不跨来源补值。 |
| `CONFIG_FILE_UNREADABLE` / 权限错误 | 检查所有者及可读性，优先标准用户目录；自动权限处理仅限默认位置。 |
| `CONFIG_PATH_REDIRECTED` / 文件链接 | 使用标准位置的普通文件，或显式指定受支持的私密路径，不用符号链接重定向默认目录。 |
| `INVALID_CONFIG_PATH` | 使用完整文件绝对路径；Windows 不接受 `..` 路径段，不通过路径拼接猜测配置位置。 |
| `CONFIG_INSIDE_REPOSITORY` | 将配置放到 Git 仓库之外，不关闭保护。 |
| 凭据交换失败 | 检查 Key 类型、完整值、有效期及对应环境/地域，改正后重载，不自动切环境。 |
| 静态托管失败 | 检查选定环境的托管状态，资源开通由环境所有者单独操作。 |
| 独立检查通过，桌面客户端没有工具 | 检查实际客户端条目、命令拆分、PATH 和重载状态。 |
| `REGISTRY_BUSY` | 等待写入者结束；清理遗留锁前确认没有进程仍在写入。 |
| `REGISTRY_WRITE_FAILED` | 检查登记目录是否被普通文件占用、权限及磁盘状态；目录错误不会按锁竞争处理。 |
| `PAGE_OFFLINE` / `PAGE_NOT_OFFLINE` | 离线页显式恢复；在线页通过 publish 更新。 |
| `CLEANUP_PENDING` | 使用原操作哈希继续下线清理，再恢复。 |
| `VERSIONING_UNSAFE` / `VERSIONING_UNCONFIRMED` | 请环境所有者检查 Bucket 版本控制；MCP 不自动修改。 |
| `SITE_URL_UNCONFIRMED` | 核对 URL 路由和目标环境，不绕过尚未解释的不匹配。 |
| `registryDiagnostic.state: UNAVAILABLE` | 保留目录并检查诊断；已知 ID 或核验 URL 可能仍可查云端，写入和路径查询仍要求健康目录。 |
