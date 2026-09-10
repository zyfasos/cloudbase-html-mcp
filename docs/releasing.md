# 发布维护指南

面向维护者与执行发布任务的 Agent。运行时六工具不变；本流程只整理版本、安装包和验证证据。脚本不提交、不推送、不发布 npm、不写 dist-tag，也不访问 CloudBase。维护脚本及本指南不进入用户安装包。

## 1. 准备版本与变更说明

先检查工作区，确认用户指定的发布范围。依赖变更或测试缓存清除时，先运行 `npm run test:prepare`；这个准备步骤可以访问 npm。

```sh
npm run release:version -- 0.4.0-beta.7
npm run release:check
```

上面的 beta.7 仅是下一版示例，实际版本按本次发布决策填写。`release:version` 同步 package、shrinkwrap、双系统 JSON、五份文档的 `release:version` 标记及其中的可执行安装命令。运行中断或写入失败后检查 diff、修正不一致再继续；脚本不是跨文件事务。

历史 beta 记录、已受测客户端版本、架构中“从某版开始支持”的说明不会替换。不要用全仓库字符串替换。当前版本说明不得包含历史验收结论：新版本的发布、CI和桌面实测需分别提供证据。

人工补充本次变更说明、影响范围和未验证项到 [PROJECT.md](../PROJECT.md)，更新受影响的行为文档；命令示例之外的内容不能靠机械替换完成。`release:check` 进入 `npm run check` 和现有 CI；它检查版本、根依赖、MCP JSON 和安装示例的一致性，不等于文档语义审查或完整依赖审计。

## 2. 核验本地安装包

```sh
npm run release:pack
```

此命令默认离线，依次执行 check、全量测试、实际 npm pack、发布白名单/源码字节/完整性核对，再在仓库外安装**刚生成的同一个 tgz**，查询版本并通过真实 STDIO 发现六工具、验证缺失配置诊断。临时 HOME 无凭据，不访问 CloudBase。全量测试中的生命周期验证使用云端替身。

输出目录为 `artifacts/release-随机后缀/`，包含 tgz、`release.json`、check/test日志。日志和报告保留实际 Node/系统与验证范围，不自动宣称 Windows 桌面或云端通过。目录被 Git 忽略；每次生成独立目录，失败时不会生成成功 manifest。

仅发布已核验的这个 tgz。如果之后修改了包内源码、版本或文档，重新打包核验；不要重新从工作目录临时生成另一份包用于发布。

## 3. 授权后提交、推送和发布

对本次 diff 完成审查，按已有授权分别执行提交、推送、npm 发布；准备脚本不构成外部操作授权。核对 exact commit 对应的四组 CI，不能沿用上一版成功结果。允许用户明确授权先发布 beta 试用，但如 CI 尚未完成或失败必须如实记录。

下面路径替换为本次实际产物，固定使用 npm 官方 registry：

```sh
npm publish "artifacts/release-实际后缀/cloudbase-html-mcp-实际版本.tgz" --tag beta --access public --ignore-scripts --registry=https://registry.npmjs.org
```

npm 要求浏览器安全验证时，将实际官方链接交给用户完成。登录成功不等于发布成功；出现“processing”或刚发布后404时先等待并核对，不重复发布。同一版本不可重新覆盖。

仅在用户授权标签变更时更新 `latest`；它可能再次要求本人验证：

```sh
npm dist-tag add cloudbase-html-mcp@实际版本 latest --registry=https://registry.npmjs.org
```

正式版使用的 tag 与版本按实际发布决策确定，不能仅因版本同步脚本接受正式版本就自动发布。

## 4. 验证公共 npm 包

```sh
npm run release:verify -- artifacts/release-实际后缀/release.json --network beta latest
```

必须显式传 `--network`，其后的标签是本次期望指向目标版本的标签；只更新 beta 时只传 `beta`，正式版可以只传 `latest`。这一步只读取 npm，不写标签、不读用户凭据。

核对 registry 版本/完整性/标签与本地 manifest，使用全新 npm 缓存及临时用户目录安装固定版本，逐文件对照已验证包，再执行版本和真实 STDIO 六工具/缺失配置检查。成功后写 `public-verification.json`；失败退出非零，保留原始原因。历史报告按时间识别，失败重跑不代表先前成功报告仍是最新结果。

该验证覆盖公共安装与协议入口；不会再次自动执行真实云端发布或删除，也不替代桌面客户端验收。实际工具业务行为由离线测试和独立授权实测分别证明。

## 5. 文档与实施档案收口

根据实际结果补记 PROJECT：版本、源码 commit、对应 CI链接及实际通过/跳过数量、公共包验证、未验证范围。npm包内文档是打包时快照；GitHub补记结果后不为同一版本重新发布npm。文档提交若已获授权则提交推送，并核对它自身的CI。

本任务绑定实施档案时，按 implementation-ledger 更新当前阶段、基线、验证证据和下一动作，执行适用校验。最终回复明确列出：

- 提交/推送和 npm 版本、标签的实际结果。
- 本地、CI、公共 npm、桌面及真实云端分别验证到哪里。
- 实施档案的本地绝对路径、状态/阶段、下一步；没有更新时说明原因。

规则负责约束流程，脚本负责可重复检查；都不能代替本人的 npm 验证或用户授权。
