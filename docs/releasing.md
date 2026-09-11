# 发布维护指南

固定顺序：**终审 → 提交 → 推送 → 对应提交四组 CI 通过 → 核验安装包 → npm 发布 → 公共包验证 → 补记发布结果**。先取得本次提交、推送及发布的授权；缺少前置动作授权时，在发布前补齐，不把提交推送当作可选事项。

## 1. 准备与终审

检查工作区并保留用户其他改动。使用 `npm run release:version -- 实际版本` 同步版本、shrinkwrap、模板和当前安装示例；用 `npm run release:check` 查一致性。人工补充变更说明，历史版本和旧验收证据不做全局替换。

依赖改变或缓存清除后先 `npm run test:prepare`（可访问 npm），再运行 `npm run check` 与 `npm test`，完成代码及文档终审。未提交开发状态可以做这些验证，但不能生成正式 release manifest。

## 2. 提交、推送并等待 CI

在相应授权范围内提交并推送 main，核对 GitHub 上该提交的 `.github/workflows/check.yml` push 运行。macOS/Windows × Node22/24 四组均须成功，check和test步骤也须执行成功；缺失、等待、失败、取消或整组跳过均不能发布，不借用旧提交或其他workflow的成功结果。

本轮不提供“beta可以先发布”的流程例外。Windows原有测试内部的平台限定跳过不等于CI任务跳过；四个CI任务本身必须成功。

## 3. 生成绑定提交的安装包

```sh
npm run release:pack
```

只允许干净的 main：已暂存、未暂存以及未忽略的未跟踪文件都会阻止打包。忽略的 artifacts、凭据及本地实施档案不要求提交，也不得为清空工作区把它们加入Git。

命令默认离线，执行check、全量测试、npm pack、白名单/源码字节/完整性检查，并在仓库外安装刚生成的同一tgz，通过真实STDIO发现六工具和缺失配置诊断。临时HOME无凭据；业务生命周期由包回归中的云端替身验证，不操作真实CloudBase。

`artifacts/release-随机后缀/` 保存日志、tgz和 `release.json`。manifest绑定完整 `sourceCommit`、仓库、包版本、tgz摘要及逐文件摘要。打包开始和结束核对提交及工作区；内容或提交变化需重新执行。

旧版manifest没有提交绑定，不能补填SHA后当作新产物使用，必须在提交后重新跑release:pack。此前从脏工作区生成的v0.5预验包仅保留为历史测试证据，不可直接发布。

## 4. 闸门与发布入口

先做只读发布前检查（需要git网络、已登录的gh）：

```sh
npm run release:gate -- artifacts/release-实际后缀/release.json --network
```

它实时核验：

- 工作区干净、分支main、HEAD与manifest提交相同。
- tgz摘要、解包文件集合和逐文件内容与manifest及该Git提交一致；Git的换行过滤用于兼容CRLF检出。
- origin指向本项目GitHub仓库，远端main就是该提交。
- 该提交最新一次check.yml push运行及最新重跑尝试成功，四组矩阵和必要步骤齐全。
- 检查结束时本地提交和远端main仍一致。

得到用户的npm发布授权后，只使用以下入口：

```sh
npm run release:publish -- artifacts/release-实际后缀/release.json --tag beta --confirm-publish
```

入口会重新执行完整闸门，再以只读 `npm whoami --json` 检查官方registry登录状态。有效会话直接复用；身份检查结束后仍重新核对完整闸门，防止网络等待期间源码或远端变化。只有明确的未登录/过期（ENEEDAUTH/E401）才自动执行网页登录，成功后再次检查身份和完整闸门，再调用npm发布已核验的同一tgz。网络、服务或无法识别的CLI错误直接停止，不误触发登录。保留终端交互供npm本人安全验证。`--confirm-publish` 表达执行意图，不替代用户授权。没有force/skip-ci或旧检查凭据绕过入口。

不得以手工 `npm publish` 或 `--ignore-scripts` 绕过本项目流程。脚本约束的是受支持的发布入口，不能限制账号持有者在仓库外手动操作npm；AGENTS约定与脚本检查共同执行。

npm登录/安全验证在上述前置条件满足后处理；不要预先反复运行login或退出仍有效的会话。一次release:publish可接续登录及发布，但登录不等于发布，npm仍可能要求独立的发布验证，脚本不绕过2FA。取消登录则停止且不发布；修复后重跑同一命令会重新核验全部条件。遇到processing、超时或不确定结果，先查询registry，不能盲目重发。同一npm版本不可覆盖。需要更新latest时另按已有标签授权执行，未授权不自动移动其他标签。

## 5. 公共包验证与收口

```sh
npm run release:verify -- artifacts/release-实际后缀/release.json --network beta
```

如果本次也获授权更新了latest，将末尾改为 `beta latest`。该步骤读取官方registry，以全新缓存安装固定版本，对照本地manifest完整性和逐文件内容，再执行版本、六工具和缺失配置检查，写入带时间的 `public-verification.json`。它不写标签、不操作CloudBase；失败退出非零，不将旧报告当作最新成功证据。

实际结果出来后补记 [PROJECT.md](../PROJECT.md)：源码commit、对应CI链接及实际通过/跳过数量、npm版本和标签、公共包验证、未验证范围。npm包内文档是发布源码快照；GitHub补记结果不为同一版本重新发布npm。文档提交推送仍按已有授权执行并核对其CI。

当前任务绑定实施档案时同步阶段、基线、证据和下一动作并校验；最终明确报告Git/npm结果、验证范围、实施档案路径/阶段/下一步。脚本不自动提交、推送，也不替代用户授权或npm本人验证。
