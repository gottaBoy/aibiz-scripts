# 实体逻辑脚本业务拒绝码修复（2026-11-23）

已修复 `DELogicScriptNodeRuntime.execute` 将真实脚本 `ErrorException` 一律包装为内部错误的问题。当前源码聚焦回归将锁定页面拒绝保留为 `Errors.ACCESSDENY`，经现有响应处理器映射为 403；普通脚本和语法错误仍为 500。本轮未打包或部署，未改模型、控制器、全局响应处理器或浏览器验收的预期。

## 手册要求

`manual/TEST-KNOWLEDGE.md` 要求锁定页面不可被管理员直接绕过编辑，必须先有效解锁。此前真实知识流程 r5 已验证第二次草稿编辑及发布隔离，但锁定后的 PUT 返回 500；该失败不能改成“预期 500”来验收通过。权限拒绝不得产生持久化副作用，仍须在采用修复后的实际运行字节上重新验证。

## 本地实现观察

权威 `guard_locked_page.json` 的 `CheckStoredLock` 脚本在锁定内容写入时抛出：

```groovy
throw new net.ibizsys.runtime.util.ErrorException(
    'Page is locked; unlock it before editing',
    net.ibizsys.runtime.util.Errors.ACCESSDENY)
```

真实 Groovy JSR223 将其包装为 `ScriptException`。旧节点 catch 将全部 `ScriptException` 包为默认 code=1 的 `DataEntityRuntimeException`；现有 `ResponseExceptionHandler` 对这种类型直接使用外层 code，因此返回 500。

本轮只改：

`ibiz-service-hub/libs/ibiz-runtime/src/main/java/net/ibizsys/central/dataentity/logic/DELogicScriptNodeRuntime.java`

- 在 `ScriptException` catch 中，仅沿 `ScriptException`、`InvocationTargetException`、`UndeclaredThrowableException` 三类已知调用包装查找真实 `ErrorException`，找到后原样重抛，不按消息文本推断错误。
- 最多访问 32 个异常对象，并用身份集合防止 cause 环。遇到普通异常包装或超过边界，继续原有内部错误路径。
- 普通脚本错误仍使用原日志和 `DataEntityRuntimeException` 包装；`NoSuchMethodException` 分支未改变。
- 原 `finally { ScriptCodeHolder.poll(); }` 保留。没有修改脚本、数据访问策略或 `ResponseExceptionHandler`；其现有 ACCESSDENY→403 规则承担映射。

现有 `ExceptionUtils.unwrapThrowable` 只处理反射包装，没有 ScriptException 支持和有界/防环合同，因此未修改共享 helper，也未将其无界循环用于这里。

## 当前版本验收证据

新增 `tests/plm-script-business-error.test.mjs`，**6/6 通过，0 失败、0 跳过**。每轮先运行封存旧类，再编译当前一个 Java 源文件并执行相同脚本场景，保持旧类反例与修复正向分开。

测试使用真实 Groovy JSR223 3.0.20、真实 `DELogicScriptNodeRuntime`、原生模型里的完整锁定检查代码及真实 `ResponseExceptionHandler`。数据实体/参数/系统日志使用自有内存夹具，没有执行 SQL 或完整 Update 行为，也没有运行真实 HTTP/浏览器。14 个场景分别在旧类和当前编译类上运行；它们不是 28 项业务验收。

| 场景 | 封存旧类 | 当前编译源码 |
| --- | --- | --- |
| 锁定页内容写入（CODE / EXPRESSION） | 500，code 1 | 403，code 2，保留原拒绝消息 |
| 不存在的页面 | 500，code 1 | 403，code 2 |
| 反射/undeclared 包装中的真实拒绝 | 500，code 1 | 403，code 2 |
| 普通 RuntimeException / 仅消息声称 ACCESSDENY | 500，code 1 | 500，code 1 |
| 普通 IllegalStateException 内部含 ErrorException cause | 500，code 1 | 500，code 1，不越过普通异常推断业务拒绝 |
| 语法错误、异常环、48 层链 | 500，code 1 | 500，code 1，有限终止 |
| 真实 ErrorException 的其他业务码 3 | 500，code 1 | 保留 code 3，现有响应策略仍为 500 |
| 解锁页检查、普通成功脚本 | 完成 | 完成 |

全部旧/新场景均验证：外层 `ScriptCodeHolder` 内容恢复、该层执行后无残留。语法初始化失败也不破坏外层 holder。

旧类反例实际异常链为：

```text
DataEntityRuntimeException
  -> javax.script.ScriptException
  -> net.ibizsys.runtime.util.ErrorException
```

未修当前源码的首轮回执保存在 `.artifacts/plm-script-business-error-20261123-YVhVth/report.private.json`，六组检查中三组按预期失败，不能记为通过。该回执 SHA-256：
`3a27a5c2913a1254782be0e13a87f09dcf10e363fbf8244a7b6cb77b11e0c000`。

最终成功原生回执为 `.artifacts/plm-script-business-error-20261123-djbigD/report.private.json`，SHA-256：
`b61bdee28093adf6962740a3d7d3606b123b483b17b8da3dbb1bef4eb45b0dca`。
同目录保留旧类运行、当前编译、当前运行的私有日志及独占 class 输出。

| 固定输入或产物 | SHA-256 |
| --- | --- |
| 当前生产 Java 源码 | `b1d88e7bb06c5164c477eafdb438d330168e2e1a2cdc199a9d4fad8a37912175` |
| 新聚焦测试 | `c2817a7a4b20eba2cbf80bbcc35f4da5710b0b00dc4ffaa674cf7f24e8938733` |
| 权威锁定检查模型 | `dfe5b5795aa861277b05e3ab9c31e38545b3d0d2d1ec563f7e767618a8b1650b` |
| provider r4 封存依赖回执 | `57b4be760a3f0ec4e90d14fa851bee318ad337206b65fe5df74fa2fbabe65b24` |
| 当前源码编译的 9,184 字节 class | `4a853b725711b0526fa64e491ce969a5c5bb80f14f8d4fd8db4afedd2886935c` |
| Java 17.0.20 可执行文件 | `0cd543f9949605b5eccb1d2b98c2b8637bb0953f0b5087208393b4b7ded73c1a` |
| 同工具链 javac 可执行文件 | `ce9c03b06d4ab7ad92fd426087b0309c8b33d1e99a810c8dcb31d8ecde3754a3` |

测试逐项校验 488 个封存依赖 JAR 的运行前后哈希，确认旧类确实来自原 `ibiz-runtime` JAR，当前类确实来自新编译目录，JSR223 和响应处理器仍来自封存 JAR。当前单类使用 `--release 11 -proc:none` 编译；这是聚焦编译，不是完整 Maven reactor 构建或已发布包。

```sh
node --test scripts/tests/plm-script-business-error.test.mjs
```

命令只使用已有本地工具链和依赖；缺失或漂移明确失败，不下载依赖、不启动服务、不执行 Docker 生命周期。每次建立新的 0700 私有目录，日志和回执为 0600，不覆盖旧失败证据。`git diff --check` 通过。

## 待决策/阻塞

- 2026-11-24 已在同一现有 `plmservice` 容器应用脚本错误候选：
  candidate SHA `00fb01ad1afd4641e364f8820274a23081d6df6551d8ac7a08c9a25fd814a3f1`，
  apply 回执为 `.artifacts/plm-publication-deploy-apply-script-error-20261124-r1/report.private.json`，
  状态 `APPLIED-HEALTHY-BUSINESS-PENDING`。容器 ID/image 不变且健康，
  只替换 `ibiz-runtime` 中的 `DELogicScriptNodeRuntime.class`；
  没有创建/重建容器或 pull 镜像。
- r6 已证明锁拒写返回预期 400/403 且保护字段读回未变；共享链接仍因
  `ArticlePageDTO` 输出缺少 `shared_page_url` 未闭合，不能将知识流程整体标为通过。
- 当前类证明锁拒绝可达现有 403 映射；完整 HTTP Update 路径、拒绝后正文/版本/关联无副作用、合法解锁后继续编辑，仍需正常用户流程复验。
- 此 helper 只识别上述三种调用包装中的 `ErrorException`。其他业务异常类型、其他脚本引擎的特殊包装和超过 32 层的 cause 链没有被扩展为新合同，仍沿用现有内部错误处理。
- 未改全局控制器/异常策略、模型、预期业务状态或任何共享运行资源；未运行全量 scripts、Java reactor 或浏览器流程。
