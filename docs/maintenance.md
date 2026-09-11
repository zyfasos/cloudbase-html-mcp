# 源码开发、升级与旧快照清理

面向使用源码检出或本地安装包排错/开发的用户。普通接入优先使用 npm 固定版本，见 [快速开始](getting-started.md)；发布流程见 [发布维护指南](releasing.md)。

<a id="source-development"></a>
## 源码开发环境

获取本仓库源码，进入项目根目录：

```sh
npm ci --ignore-scripts
npm run test:prepare
npm run check
npm test
node bin/cli.mjs --version
```

- `npm run test:prepare` 从 npm 下载测试安装所需内容，保存到仓库内已忽略的 `artifacts/test-npm-cache/`，不访问 CloudBase；依赖变更或清理缓存后重新准备。`npm test` 保持离线，使用真实 STDIO 子进程与本地安装包测试，云端为替身。
- v0.4 起使用 `npm-shrinkwrap.json` 锁定依赖。仍处于 v0.3 的旧检出不含新 CLI，应更新到实际 v0.4+ 源码，不另建空项目替代。
- 客户端直连源码入口时，`command` 用 `node -p "process.execPath"` 取得的 Node 绝对路径，参数示例：`["/absolute/path/to/cloudbase-html-mcp/bin/cli.mjs", "serve"]`。
- 旧的 `node src/server.mjs` 环境变量入口与 `node scripts/start.mjs /absolute/private/credentials.env` 显式文件入口仍可用；旧 start 入口文件读取失败时先退出，新 CLI 则允许发现工具并返回配置错误。Node 原生 `--env-file` 优先继承环境变量，与新 CLI 的隔离文件配置不同。
- 源码向导 `npm run setup` 仍可用；它生成的 npx 配置要求对应版本已发布，本地开发改用上面的源码入口。

<a id="existing-v02-installations"></a>
## 从 v0.2 升级

升级后重载 MCP，在客户端允许列表中启用六工具。新发布不再创建 `deployments/` 快照或返回新 `versionKey`；首次环境写锁内迁移旧登记，保留已使用及 pending ID 和原记录文件，不应再用 v0.2 写入者。需要迁移备份时先备份私密登记目录。旧快照不会自动删除：下线目标站点会包含其旧快照清理；保持在线、仅清旧快照按下节操作。

<a id="clean-legacy-snapshots-while-keeping-current-html"></a>
## 保持在线，仅清理旧快照

清理脚本默认只读输出清单。在源码目录指定环境和站点 ID，将 JSON 保存到仓库外私密目录；示例 ID 须替换为 `s-` 加 32 位小写十六进制，多站点重复传 `--site-id`。以下 POSIX 示例拒绝覆盖已有清单：

```sh
(
  umask 077
  set -C
  node --env-file="/absolute/private/cloudbase-html.env" scripts/cleanup-snapshots.mjs --env-id YOUR_ENV_ID --site-id s_REPLACE_WITH_VALID_ID > "/absolute/private/cleanup-manifest.json"
)
```

仅在命令成功且生成完整 JSON 时继续；核对 `envId`、`region`、`bucket`、精确对象键、`count` 与 `bytes`；失败时不执行空或残缺清单，修正后使用新清单路径。此脚本使用 Node 原生 `--env-file`，继承的环境变量优先，请在没有冲突覆盖值的终端执行。

清单获得明确批准后再执行：

```sh
node --env-file="/absolute/private/cloudbase-html.env" scripts/cleanup-snapshots.mjs --env-id YOUR_ENV_ID --site-id s_REPLACE_WITH_VALID_ID --apply --manifest "/absolute/private/cleanup-manifest.json"
```

执行时保持环境和站点参数一致，并启用本地登记。脚本核对环境、Bucket、严格旧路径格式与当前 ETag/大小，仅删除清单中的对象，保留当前 HTML 与后来新增的快照，共用本地环境锁。COS 原生版本控制启用、暂停或无法核实时阻止破坏性清理，不修改其设置；部分清理不写成已全部回收。
