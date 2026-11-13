# 迭代结束的终态工作项保护

日期：2026-11-14，Asia/Singapore。关联：[手册验证队列](manual/VALIDATION-BACKLOG.md) MV04。

## 状态

已修复结束迭代时的一个确定缺陷：已完成或已关闭的工作项不应进入“处理未完成工作项”
分支。独立与内嵌模型已同步，旧 BPMN 连线也表达相同守卫；聚焦源级测试 `7/7` 通过。

本轮没有调用真实结束迭代接口、写入共享数据库、启动容器、重启服务或部署模型。
测试解释执行的是受限模型路径，不是完整 Java 运行时；旧 BPMN/Drools 执行器未运行。
**MV04 不能因此整项关闭。**

## 缺陷与最小修正

手册要求用户明确选择未完成项的处理方式：放回待分配、移动到其他未结束迭代，
或显式标记完成。已完成/已关闭的工作项应该留在原迭代，不受这些选择影响。
相关手册页 ID：`35585866fda9b9618310912347902d71`。

原 `end_sprint` 中 `DEDATASET1` 调用 `work_item.normal`，虽然节点名称写“未完成”，
数据集并没有按终态过滤。`LOOPSUBCALL2 -> RENEWPARAM1` 又是无条件子调用，
因此完成/关闭项也可能被移动或重新设为状态 `40`。

本轮仅在这条子调用连线增加 `AND` 守卫，读取当前循环对象
`for_work_item_temp.STATE_TYPE`：

```text
ISNOTNULL(STATE_TYPE)
AND STATE_TYPE <> ""
AND STATE_TYPE <> "completed"
AND STATE_TYPE <> "closed"
```

不通过守卫时不建立工作项更新参数，也不进入移动或设为完成的操作。
不会用自定义状态标识 `STATE` 推断类型；例如 `STATE=40` 但类型为 `pending`
仍属于未完成项。为避免把缺失类型当成“不是完成”，`null`、缺失字段和空字符串均跳过。
非空的未来自定义状态类型没有被限死为当前两种未完成枚举。

本轮保持不变：

- `PREPAREPARAM5` 的源迭代、源项目过滤。
- 原 `normal` 数据集、返回 DTO、分页参数与用户传入的选择。
- 显式完成、移动到目标迭代、移动至待分配的三个处理路径。
- 现有完成态 `STATE=40` 和待分配标识转换，不借本次保护修改它们的产品语义。

## 框架支持依据

不是仅在模型中新增一个未证明支持的条件字段：

| 已阅读的本地源文件 | 结论 |
| --- | --- |
| `ibiz-service-hub/libs/ibiz-runtime/src/main/java/net/ibizsys/central/dataentity/logic/DELogicLoopSubCallNodeRuntime.java` | 串行和并行循环都先绑定当前项，再对 `subCallLink` 调用 `testLinkCond`，成立才执行目标节点 |
| 同目录 `DELogicRuntime.java` | 支持 `GROUP/AND` 短路，`SINGLE` 从逻辑参数取字段后委托 `DataTypeUtils.testCond` |
| `ibiz-service-hub/libs/ibiz-runtime/src/main/java/net/ibizsys/runtime/util/DataTypeUtils.java` | `ISNOTNULL` 检查非空；空源值对 `NOTEQ(non-null)` 会返回真，所以只有两个“不等于”不足以保护缺失类型 |
| `ibiz-service-hub/libs/ibiz-model/src/main/java/net/ibizsys/model/dataentity/logic/PSDELogicLinkSingleCondImpl.java` | `getParamValue()` 通过 `JsonNode.asText()` 读取，保留显式 `paramValue: ""`，支持空字符串比较 |

`work_item.normal` 返回 `work_item_plan_dto`，其中有 `state_type`。
`WorkItem.groovy.fetchNormal()` 也使用 `WorkItemPlanDTO`，不需要为守卫另发逐项查询。
这些是源码链路依据，不是当前运行服务加载版本的证明。

## 文件与旧产物

本轮修改：

- `plm/model/PSMODULES/ProjMgmt/PSDATAENTITIES/sprint/PSDELOGICS/end_sprint.json`
- `plm/model/PSMODULES/ProjMgmt/PSDATAENTITIES/sprint.json` 中同一内嵌逻辑
- 同目录 `end_sprint.json.bpmn` 的 `loopsubcall2_renewparam1` 连线条件
- `scripts/tests/plm-sprint-completion.test.mjs`

当前源链路为 `sprint/PSDEACTIONS/end_sprint.json -> end_sprint.json`；
后端 `EndSprint.groovy` 的节点实现委托父运行时。
本地 Compose 的模型输入挂载到 `/app/model`，这不等于本轮已重载运行模型。

旧 `.bpmn/.drl` 引用旧 `core.projmgmt.domain`、`RuleUtils` 包，
当前后端源树没有这些旧类型实现，不能据它们反推当前模型运行方式。
但不能简单当作没有价值：BPMN 仍保存同名连线，因此同步四项守卫并做 XML 结构检查。
DRL 只保存节点规则，`loopsubcall2` 本身没有连线条件或实际循环体；
条件属于 BPMN，不在 DRL 虚构另一套循环/授权实现。DRL 未改，旧执行器兼容性未验收。

## 聚焦测试

工作区根执行：

```sh
node --test scripts/tests/plm-sprint-completion.test.mjs
```

需要 Node 20+；XML 结构检查使用现有 `python3` 标准库，不安装依赖或访问外网。
本轮实际结果：7 项通过，0 失败，0 跳过。

覆盖：

- 独立逻辑与实体内嵌逻辑完全等价，只有指定循环连线有新守卫。
- 框架源码中串行、并行循环的绑定与条件测试顺序，以及空值/空字符串语义。
- `pending` 的自定义状态 ID `40` 与 `in_progress` 通过；自定义 ID 的
  `completed/closed`、空值、缺字段、空字符串不通过。
- 三种用户选择下，完成/关闭项不产生工作项更新，原数据不变。
- 未完成项保持三条路径：原显式 `STATE=40`、指定 `SPRINT_ID`、待分配时清空 `SPRINT_ID`。
- 没有显式选择时不自动把未完成项设为完成。
- 原迭代/项目过滤、数据集与 DTO 的 `state_type` 字段契约仍存在。
- BPMN 是有效 XML，同一条连线的四项条件与 JSON 的真值结果一致。

受限解释器只执行本模型需要的 `AND/SINGLE/ISNOTNULL/EQ/NOTEQ`、
参数重建、参数赋值和更新负载记录。它验证源模型与预期结果，不声称复现完整框架事务、
权限、数据集分页、并发或真实数据库更新。

## 未完成与后续验收

| 工作项 | 仍需证据 |
| --- | --- |
| 完成态 `40` | 对各项目类型/工作项类型映射到真实“完成”状态，验证自定义状态、流转权限与完成时间；本轮不改 |
| 分页 | `normal` 是分页数据集，结束操作是否处理超过默认页大小的全部项需要实际验证或单独修复 |
| 目标迭代 | 需要服务端校验目标存在、未结束、同项目/可访问，不能只靠 UI 选择器 |
| 用户选择 | 非法、冲突选择与缺失目标应有明确拒绝，事务回滚无副作用 |
| 缺失状态类型 | 本轮保护性跳过，尚需决定如何向用户报告异常数据而不是静默漏处理 |
| 并发变化 | 查询后工作项被另一个请求完成/移动，仍需运行时并发和一致性策略 |
| 实际部署 | 核验服务加载的模型哈希，运行三个选项的真实 UI/API、多角色正负向与刷新读回 |
| 生命周期 | 确认已完成/关闭项仍保留原迭代、历史和统计；失败时迭代状态与工作项操作一致回滚 |

验收只能使用自有测试数据并记录清理，不用共享 SQL 写入绕过前置条件。
这次修复不解决指标侧缺少迭代实际完成时间的问题，也不把页面或接口可打开当作功能完成。
