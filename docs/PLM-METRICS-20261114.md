# PLM 指标口径修正

日期：2026-11-14，Asia/Singapore。关联：手册验证队列 MV11/MV12。

## 状态

- 已实现源码修正：比较分析通过率的六处 SQL 定义；主 BI 与应用 BI 的七个指标；关联钻取条件。
- 聚焦测试在 Node `v24.21.0` 上 `9/9` 通过，`0` 跳过；执行的是内存中的实际 SQL/公式，不只检查字符串。
- 没有改共享数据库、部署模型、构建镜像、重启服务或新建容器，没有进行新的真实浏览器/HTTP/生产 BI 引擎验收。
- MV11 是“源码及隔离计算回归完成，部署验收未完成”；MV12 只完成无歧义子项，不能整项关闭。

来源规则见 [管理/集成/度量指南](manual/ADMIN-INTEGRATION-METRICS.md) 和
[验证队列](manual/VALIDATION-BACKLOG.md)。指标源页 ID：`546938b70ecdf7fbccaa3b2ce265d2ec`。

## 消费链确认

比较分析的真实展示列是“测试执行通过率”，不是“已执行通过率”：

1. `plm-web/src/publish/model/views/run-comparative-analysis-report-view.ts`：
   `passrate` 的 `EC.gridHeaders` 名称为“测试执行通过率”。
2. 权威图表模型
   `plm/model/PSSYSAPPS/plmweb/PSAPPDATAENTITIES/run/PSCHARTS/comparative_analysis_view_chart.json`
   使用相同名称，数据集为 `fetch_comparative_analysis`。
3. `run.json` 的 `comparativeAnalysis` 数据集委托
   `run/PSDELOGICS/plan_compar_ative_analysis.json`。
4. 后端 `PlanComparAtiveAnalysis.groovy` 是委托模型节点的运行时外壳，不包含另一份硬编码 SQL。

因此保留已有显示名称，把通过率分母从“已执行用例数”改为“全部执行用例数”。
所有现有计划、执行人、执行状态、时间和测试库筛选保持不变；分母是这些筛选后的总体，
不是绕过筛选去计全库。没有新增英文标签或改动状态值/API 路径。

`test_case` 中同名逻辑虽然未发现当前独立数据集消费者，仍同步保留兼容口径，
避免后续引用时出现另一套公式。

## 修改范围

以下路径相对工作区，均只更新关联 SQL、公式或钻取谓词，没有重排大模型：

| 文件/指标 | 修正 |
| --- | --- |
| `plm/model/PSMODULES/TestMgmt/PSDATAENTITIES/run/PSDELOGICS/plan_compar_ative_analysis.json` | `PassRate` 除以 `COUNT(r.ID)` |
| `plm/model/PSMODULES/TestMgmt/PSDATAENTITIES/test_case/PSDELOGICS/plan_compar_ative_analysis.json` | 同上 |
| 同目录两个 `.json.drl` | 同步分母；Java 字符串保留转义换行，防止压成单行后 `--` 注释吞掉后续 SQL |
| `plm/model/PSMODULES/TestMgmt/PSDATAENTITIES/run.json`、`test_case.json` | 同步内嵌逻辑，保持参数数量、顺序与独立逻辑一致 |
| `plm/model/PSSYSBISCHEMES/BIScheme.json` | 七个度量及六个工作项钻取谓词 |
| `plm/model/PSSYSAPPS/plmweb/PSAPPBISCHEMES/BIScheme.json` | 同步七个度量公式，原有视图和参数操作不变 |

两个 BI 模型修正的七个指标：

| 代码 | 行为 |
| --- | --- |
| `work_items_completed_on_schedule` | 默认完成集合包含 `completed/closed`，以截止时间与完成时间比较 |
| `work_item_completion_rate_on_schedule` | 按期数 / 完成或关闭数，不以全部工作项稀释 |
| `overdue_completed_work_item` | 使用截止时间 `< completed_at`，不使用 `< now()` 把早已按期完成的工作误判逾期 |
| `overdue_completed_work_item_rate` | 逾期完成数 / 完成或关闭数 |
| `overdue_unfinished_work_item` | 使用 `STATE_TYPE` 排除终态，不硬编码 `state <> 40` |
| `overdue_unfinished_work_item_rate` | 未完成逾期数 / 未完成数 |
| `workload_type_ratio` | `sumif(duration, 类别条件) / sum(duration)`，不按记录条数计算工时占比 |

完成类指标保留原有 `code_type/state_type/state` 显式参数：
选择状态类型或具体状态时，分子与分母使用同一显式集合；没有参数时默认终态为
`completed/closed`。无截止时间的现有 `end_at` 参数分支未改变，零分母防护策略也未另行改定。

字段依据：`work_item.COMPLETED_AT` 为完成时间，`END_AT` 为截止时间；
`STATE_TYPE` 来自工作项状态类型，代码表定义 `pending/in_progress/completed/closed`；
`workload.DURATION` 为登记时长。状态标识可自定义，不能从 `40` 等数字猜测终态。

## 可重复测试

工作区根执行：

```sh
node --test scripts/tests/plm-metrics-contract.test.mjs
git -C plm diff --check
git -C scripts diff --check
```

测试动态加载 `node:sqlite`。Node 20 缺少该内置模块时，纯契约测试仍执行，
五个 SQL/公式执行测试会明确标记跳过，不能把这种结果称为完整通过；
本轮 Node 24 实测没有跳过。测试不需要数据库凭据，不访问网络或 Docker。

执行测试直接读取独立逻辑、实体内嵌与解码后的 DRL SQL，在独立内存表上运行。
注册 `CONCAT/FIND_IN_SET` 适配 MySQL 函数；实际 BI 公式在明确受限的参数语法替换后执行，
注册 `countif/sumif/multiif/if/now`。这验证计算与绑定行为，
**不代替 MySQL 方言、真实 BI 编译器、数值显示精度或数据权限的部署验证**。

| 算例 | 结果 |
| --- | --- |
| 4 个计划用例，2 个已执行，其中 1 个最新通过 | 执行率 50%，通过率 25%，不是 50% |
| 全未执行；全通过 | 分别为 0% / 0%，100% / 100% |
| 同一执行用例增加两条历史并更新最新状态 | 计划分母仍为 4；通过率随最新状态变化 |
| 别的测试库、计划/执行人/状态/时间筛选、注入式筛选值 | 范围与原绑定参数保持一致，不拼接参数为 SQL |
| 5 个工作项，2 个完成或关闭，其中 1 个按期 | 按期 50%，逾期完成 50%，不是各自除以 5 |
| 截止日已过，但实际完成早于截止日 | 仍按期，不被当前时间改成逾期完成 |
| 3 个未完成，其中 1 个逾期且其自定义状态 ID 是 `40` | 未完成逾期率 1/3，不把 ID `40` 自动排除 |
| 两个删除范围内的记录 | 不进入工作项分子/分母或钻取 |
| 3 条工时为 8、1、1 小时，8 小时属于类别 A | A 为 80%，不是 1/3 |
| 显式选择关闭类型或自定义完成状态 | 分子/分母同步选择，原参数功能保留 |
| 工作项计数与钻取 | 六个计数/比率的钻取各选中同一个分子记录 |

## MV12 未决定的边界

### 零预估与空集合

`estimated_deviation_rate` 目前对零预估使用 `1` 替代分母，对空集合使用 `1`
防除零。相关主公式仅在两个 BI 模型中找到；历史报表模板还引用此度量。
例如预估 0、登记 5 小时会贡献 500% 个体误差，0/0 会贡献 0；
与预估 2、登记 4 的工作项混合后均值为 300%。这些是当前代码结果，不是手册确认政策。

候选决策，不在本轮擅自选择：

- 排除零预估项并明确展示被排除数量；没有有效项时显示不可计算。会改变分母与历史对比。
- 0/0 定义为零，但零预估且实际非零显示未定义；需要规定混合集合如何汇总。
- 维持当前替代值并明确标为约定。优点是兼容，缺点是把“1 小时”混进相对误差，
  受工时单位影响，不能称为纯粹相对误差。

空分母还涉及工作项比率、测试执行/通过率、迭代、项目和类别分布，不宜只改一个指标。
比较 SQL 因测试库条件不输出完全无用例的计划；BI 空总体可能显示 0。
必须决定无数据、0%、不可计算的区别及导出/图表表现。

### 迭代按时率

`sprint_delivery_on_time_rate` 当前为
`countif(status = 3 and end_at < now() and project_is_deleted = 0) / 全部未删除项目下迭代数`。
分母与手册“已结束迭代”不同，分子也没有真正比较实际结束与计划结束。

`sprint` 状态为 1 未开始、2 进行中、3 已完成，但实体没有 `COMPLETED_AT`
或实际结束时间字段，只有计划 `START_AT/END_AT` 与通用 `UPDATE_TIME`。
本轮整项不改，不单独修分母后声称指标正确，不用更新时间推断实际完成。
后续需要 schema/迁移、结束操作写入、历史回填政策及 UI/API 生命周期验证。

### 执行重置与其他指标

比较 SQL 的执行数使用当前状态非空；主 BI 的执行数使用 `relation_total_history > 0`。
`reset_not_test` 清空当前状态而不删除历史。因此重置后两者仍可能不同。
本轮保留此行为并有回归暴露，后续需明确“历史至少执行过”与“当前执行状态”在比较图表的语义。

通用 `work_item_completed_rate`、`idea_throughput` 的默认筛选仍只有 `completed`，
不含 `closed`；它们不在本轮七指标改动中，仍需按手册及显式参数语义继续核对。
发布平均生命周期的括号、缺失截止/完成时间、时区与重开时间也未被本轮解决。

## 部署与历史数据

本轮未修改历史 Liquibase 种子模板：
`LIQUIBASE_CHANGELOGS__DEFAULT.json.usrcontent250321020.txt` 引用按期数、逾期完成数、
未完成逾期数/率及预估偏差；`...250321003.txt` 含按期数引用。
种子可能只存度量 ID，也可能嵌入公式，运行数据库中的自定义仪表盘也可能保存快照。
不能通过全文替换历史模板或覆盖用户报表完成迁移，需逐项核对实际绑定和模型版本。

下一步必须在受控发布中核验加载的模型字节、应用 BI 模型、运行数据库的报表快照、
钻取和中英文页面输出；分别用普通成员/只读/非成员验证权限，记录 console/network。
SQLite 回归不是这些场景的替代证据，不应据此关闭 MV11/MV12 全流程验收。
