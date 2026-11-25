# SharedUrl 单对象返回合同（2026-11-23）

结论：当前原生单 DTO 服务链不会因 `VOID`、`input.output=false` 丢弃非空逻辑结果。已有 SharedUrl 源码修复应保持外层合同，只让 `RAWSFCODE1` 经框架继续到返回 `Default` 的 END。此次新增聚焦合同测试和本文，未修改生产源码、模型、运行 JAR 或服务。

## 手册要求

`manual/TEST-KNOWLEDGE.md` 要求共享不泄露草稿，撤销、过期、密码及子集分享需真实匿名回归。单对象返回、DTO 序列化和 URL 字符串存在只能解释共享设置表单的一个前置条件，不能关闭这些业务验收。

## 本地实现观察

权威 action 是 `plm/model/PSMODULES/Wiki/PSDATAENTITIES/article_page/PSDEACTIONS/shared_url.json`：

- 输入为 `DTO`，`input.output` 未启用，返回声明为 `VOID`，访问操作为 `READ`。
- 逻辑模型 `RAWSFCODE1` 连接 `END1`；END 的返回类型是 `LOGICPARAM`、参数是 `Default`。
- 旧运行类会修改 DTO 的 `shared_page_url`，但自定义节点没有继续 END，因而逻辑结果仍为 null。已有源码将该节点委托 `super.onExecutePSDELogicNode(session, node, true)`；本轮未重复改动。

只读追踪的实际返回链：

| 层 | 当前实现行为 |
| --- | --- |
| central `DataEntityRuntime.java:1757`、`:6068` | DELOGIC 直接返回 `executeDELogic` / `iDELogicRuntime.execute` 的结果 |
| central `DELogicRuntime.java:422` | 返回 `iDELogicSession.getResult()` |
| central `DEServiceAPIRuntime.java:423` | 单对象分支取得 `objRet`；仅 output=true 时返回输入 DTO，否则直接返回 `objRet`，没有按 VOID 清空 |
| cloud `MethodHandlerBase.java:575`、`:727`、`:824` | 嵌套 POST 将返回对象交给 `sendBack`；非空对象使用真实 Jackson mapper 输出 |
| 前端 `method-renturn.ts:82` | SIMPLE 才特殊包装；VOID 的非空响应仍进入 `new AppDataEntity(entity, data)` |
| 前端 `de-action-node.ts:47` | `res.ok` 后把 `res.data` 赋给 UI 逻辑返回参数 |

Java 路径均位于 `ibiz-service-hub/libs/ibiz-runtime` 或 `libs/ibiz-cloud-core` 的 `src/main/java/net/ibizsys/` 下；前端位于 `ibiz-app-hub/packages/runtime/src/`。共享设置 UI 模型把 `shared_url` 的返回值写入 `Default`，后续节点从 `Default.shared_page_url` 回填表单。

上述单对象分支不能外推到列表/批量分支。本轮没有扩展 List 对照，也不修改 action、API 或前端的 VOID 声明。

## 当前版本验收证据

新增 `tests/plm-page-shared-url-service-contract.test.mjs`，执行 **3/3 通过，0 失败、0 跳过**：

1. 当前外层 action 与聚合实体模型一致，保留 DTO / VOID / output=false / READ。
2. 在已封存依赖的真实 `DEServiceAPIRuntime.onExecuteAction` 单 DTO 分支中，取得非空逻辑结果 DTO；真实 `MethodHandlerBase.MAPPER` 把原生 `ArticlePageDTO` 上未声明为 Java 字段的 `shared_page_url` 序列化出来。
3. 负控在相同原生输入 DTO 上同样计算 URL，但把逻辑结果设为 null。真实服务分支返回 null，无法回传 URL；因此“DTO 已被修改”不能替代 END 返回结果。

没有伪造控制器或 HTTP 响应。测试子类只提供已建立的单 DTO 参数，真实服务执行主体和真实 Jackson 未被重写。数据实体执行结果、访问检查和引用检查使用严格的内存夹具，分别限制为被测返回边界、允许进入该分支和无引用数据；未知调用直接失败。因此请求解析、真实授权、持久化和 SharedUrl 逻辑本体不在这个新测试范围内。已有 `plm-page-shared-url-dispatch.test.mjs` 对旧类和已修源码的节点/END 行为另行补证，两者不等同原生共享端到端通过。

依赖固定为 `.artifacts/plm-publication-provider-candidate-20261123-r4/report.private.json`。测试固定回执和本地 JVM SHA-256，对其中 488 个依赖 JAR 在执行前后逐项核验，并确认三个被测原生类的实际 code source 全部位于这份封存 JAR 清单中，不接受外部 class 覆盖。

| 输入 | SHA-256 |
| --- | --- |
| 封存 provider 回执 | `57b4be760a3f0ec4e90d14fa851bee318ad337206b65fe5df74fa2fbabe65b24` |
| `ibiz-runtime-8.1.0.584.1.jar`：真实服务 API | `e2099848b5e6ac89507a3b7b2f8a9399747a545508889e15633bde8d8e406d7a` |
| `plm-core-v1.0.2.jar`：真实 ArticlePageDTO | `e964900d1b179c5ceca62e3ccc3eeccac5639b6aca6931b80c6b1b8c8e3b643d` |
| `ibiz-cloud-core-8.1.0.584.1.jar`：真实 mapper | `f077b80cf21a54d15b928774f7212f27bbf6ad4d5ae6b8ac96610bc06e334496` |
| 本地 Java 17.0.20 可执行文件 | `0cd543f9949605b5eccb1d2b98c2b8637bb0953f0b5087208393b4b7ded73c1a` |
| 新测试源码 | `37e731d180af74b5e857456b019d62f44372c97cec5ed33647df328927526ab2` |
| 已有 SharedUrl 修复源码 | `be375e1b23ea2f0ea1889a852fe35d3c413887842a5c6011dc7362ecf09bc9d3` |

重复命令：

```sh
node --test scripts/tests/plm-page-shared-url-service-contract.test.mjs
```

命令不依赖外部服务，不下载依赖、不执行 SQL/Docker、不使用浏览器或业务 HTTP；缺少封存输入时明确失败，不降级为 source-only 并显示通过。Groovy Grape 禁用，所有类来自本地封存 classpath。

私有执行回执：`.artifacts/shared-url-service-contract-20261123-r1/report.private.json`，SHA-256 为 `f377319eaf33eb0a7c6fd956633d10410d6c07417ac300dd32c1a189976c12bb`；原始测试输出保留在同目录的 `test.private.log`。目录为 0700，文件为 0600。`git diff --check` 通过。

## 待决策/阻塞

- 当前运行包仍须核对实际 SharedUrl class 字节；封存依赖中的 DTO/框架通过，不表示已修 SharedUrl 源码已经部署。此次未打包、替换或重启运行包。
- 必要生产修复是已有单节点框架委托，不是改变外层 return/output 合同。若后续构建候选，应同时绑定此源码、权威逻辑模型、实际 class 与 provider 包，再走既有已审部署/恢复流程。
- 正确业务验收应从正常用户共享设置操作捕获真实单对象请求，核对原生响应 `shared_page_url`、表单回填与刷新；不得以 List body、控制器注入或手工构造响应替代。
- URL 使用真实 `plm_wiki` 配置；配置缺失或访问入口不可用需单独报告。之后仍需真实匿名、密码、过期、撤销、子集、草稿隔离和跨角色读回。新增三项合同测试不关闭这些项。
