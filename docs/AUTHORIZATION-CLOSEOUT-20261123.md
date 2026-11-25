# A02/A03 授权与操作会话补证（2026-11-23）

本文接续 `AUTHORIZATION-IMPLEMENTATION-20261122.md`，只记录本轮源码修复与隔离回归，不将 A02/A03 整体标为完成。工作区共享服务、镜像、挂载输入和业务数据库未因本轮发生变更；未部署、未执行真实业务 HTTP、未下载依赖。

## 手册要求

- `manual/ADMIN-INTEGRATION-METRICS.md` 要求权限遵循组织和资源边界，角色变更、成员移除等同时检查 UI 与直接 API，并换角色重新登录复核。WXMP 角色存在不代表可跨中心读取任意模型库。
- Development/Modeling IDE 和本轮 ActionSession 属独立平台能力。手册目录与本地单元回归不能代替原生 Modeling 多角色流程。
- 任务检查点仍为 `ALL-TASKS-20261111.md`；本文件不批量勾选任务，也不据测试数计算能力完成率。

## 本地实现观察

### A02：角色兜底与后台身份

- `SystemAccessManagerBase.onGetPSDevUserBase` 在没有模型库成员记录时，原 WXMP 兜底只检查角色，没有比较目标模型库所属中心。本轮要求目标中心非空且等于当前中心，才允许原有 READ 兜底。
- 显式跨中心成员授权仍按其自身权限和有效期处理；显式 mode 0 不被 WXMP 兜底覆盖。新增回归覆盖外中心、缺失中心、同中心角色撤销、真实成员和拒绝记录。
- `ModelServerSysUtilRuntimeBase.executeDevCallback` 以前复用当前 ActionSession，并在 finally 无条件清空默认中心；流水线分支也无条件清空 UserContext。本轮回调拥有独立根/子会话，保存并恢复调用前的中心覆盖和用户身份。
- `PSDevSysUserHolder` 本轮未新增授权策略，仍保留前轮的账号/员工/租户绑定与过期检查。无认证后台身份的有效性、撤权时机和角色权威刷新不能由这里的线程隔离测试推出。

### A03：会话所有权、事务异常和工作线程

- 新增 `ActionSessionManager.executeSession`：无父会话时拥有根会话，有父会话时使用已有显式嵌套 API；异常时反向回收遗漏的子会话，保留原异常并附加清理异常，不关闭调用者后来建立的替代会话。
- 已迁移两个真实入口：`SysBackendTaskRuntimeBase.execute` 与 `ModelServerSysUtilRuntimeBase.executeDevCallback`。嵌套后台任务保留父用户身份，不重新解析任务用户，不继承父权限缓存和绕过标志。
- 子会话成功返回但父会话仍处于运行时事务时，将尚未执行的后续作业交给父会话，避免把会话返回当作数据库提交。已完成 REQUIRES_NEW 的作业仍按其独立结果处理。
- `TransactionalUtil.execute` 原来在 Spring commit 已完成后再调用 rollback，可能将 `UnexpectedRollbackException` 或 `afterCommit` 原异常替换成“事务已完成”。本轮检查 `TransactionStatus.isCompleted()`；回滚本身失败时保留原异常并附加回滚异常。
- `AuthorizationFilter` 在认证前和请求 finally 调用 `clearThreadState`，回滚遗漏的 ActionSession，并移除会话栈、操作信息、响应头和下载文件 ThreadLocal。清理失败不替换请求异常；这是 ActionSession 状态清理，不等于清理全部平台身份或数据库手动事务。

## 当前版本验收证据

### 正向和负向回归

- 正向：当前 8 个生产源码与全部 44 个 Modeling 测试类离线编译、运行，**393/393 通过，0 跳过、0 中止**。包含本轮新增 21 项回归；此前 372 项也随同执行。
- 私有回执：`.artifacts/authorization-closeout-20261123-r5/report.private.json`。
- 回执 SHA-256：`eb6e65a10738e3d32348b12803fb89c337046e259910d73bcab326f58aa10957`。
- 负向：仅将后台任务、开发回调、HTTP filter、Spring 事务工具四个调用方换回 `ibiz-service-hub` HEAD `26e52348195586d25ebd3524e46968e4e5b59e8b` 的源码，其余源码和测试保持相同，编译通过，**8 项预期失败、385 项通过**。失败对应三个请求清理、三个真实 Spring 异常、两个原生调用方隔离用例。
- 负向私有回执：`.artifacts/authorization-closeout-20261123-negative-r1/report.private.json`，SHA-256：`42c23954e760890af54b2bff6ea64addb321df6f9f9955451edb44be0186853f`。
- r1 编译失败为测试夹具遗漏抽象 commit 方法；r2 的 7 项失败为 H2 shutdown 夹具和开发者身份初始化问题。已修正并保留原回执，未将失败写成通过。

真实事务用例使用缓存的 Spring 5.3.1 `DataSourceTransactionManager`、JDBC 和每个测试独立的内存 H2 1.4.200：外层回滚/内层 REQUIRES_NEW 已提交、内层回滚可被外层捕获后提交、独立连接读回、父资源挂起与恢复、回调执行顺序、提交后异常、参与者 rollback-only、回滚异常的抑制。全部只操作测试自己的内存表。

线程回归调用生产 `AuthorizationFilter.doFilterInternal`，在一个单线程池中连续执行请求，覆盖认证拒绝、认证异常、业务异常、父子会话遗漏、清理异常和响应元数据。它未启动 Servlet 容器，未证明实际部署的 filter 注册、顺序、异步/错误分派或代理行为。

### 可重复命令与输入

```sh
node scripts/run-authorization-closeout-regressions.mjs \
  --java-home .artifacts/local-java-toolchain-20261122-r1/openjdk \
  --dependency-root .artifacts/native-nonadmin-fixtures/6189aef47735/workflow-schema-converge-wf-20261122-r1/dependencies \
  --supporting-classes .artifacts/convergence-package-20261121-r1/worktree/libs/ibiz-modeling-core/target/classes \
  --output .artifacts/authorization-closeout-20261123-NEW
```

使用新的输出目录；加 `--baseline-callers` 复现上述预期失败对照。入口只读取已存在的 JDK/JAR/辅助 class，不运行 Maven、Docker 或服务命令。8 个生产文件由当前源码重编译；其他辅助 class 来源于既有本地构建，因此这是聚焦离线编译，**不是 clean reactor build**。源码、依赖 JAR 哈希及测试列表保存在私有回执中。

`ibiz-modeling-core/pom.xml` 已增加 `spring-jdbc`、H2 两个 test 依赖，版本沿用现有 BOM；本轮未运行普通 Maven 构建或下载。

| 当前生产源码 | SHA-256 |
| --- | --- |
| `runtime/util/ActionSession.java` | `74ed7e75224dc189daf1a67846fd73a6fb6b191b6c9300dc2b6f43cde74eeaf1` |
| `runtime/util/ActionSessionManager.java` | `75a655bf51836c4179ea2712fab515aca8b48daf0ee8cede2bdde2e9a7a4934f` |
| `runtime/backend/SysBackendTaskRuntimeBase.java` | `23bae3a73f8643ed3a7d6b5214f07d2ddd145489fa167f07793a482b7d872678` |
| `cloud/core/spring/rt/util/TransactionalUtil.java` | `e11a3a3736134604c0c1ea4777071f9811c466696564687564ad7297627803fb` |
| `cloud/core/spring/filter/AuthorizationFilter.java` | `ec887cf5f4ac067b43dab6f5c65142ae89478ed0dc7e8b8708f3964b851df627` |
| `modeling/core/security/SystemAccessManagerBase.java` | `937e6369c768dcaf0dc0516550a6a075eb719aca80e51d29b969f7fe2856394b` |
| `modeling/core/util/PSDevSysUserHolder.java` | `6c68f12d1ed00c2d2b7fee96f42400c6d49d0a9907525974dc758129f2032f8c` |
| `modeling/core/sysutil/ModelServerSysUtilRuntimeBase.java` | `df314d157c981b1b60f0d7e1b9a05eac2ab52d61aef3f01e60db2d3d5f503b0f` |

表内路径省略各模块的 `src/main/java/net/ibizsys/` 前缀。`git diff --check` 在 `ibiz-service-hub` 和本轮 scripts 文件范围内通过。
`node --test scripts/tests/plm-manual-reference.test.mjs` 为 10/10 通过；最终再次核对 52 个编译输入均与 r5 回执哈希一致。

## 待决策/阻塞

- A02：WXMP 仍调用平台当前 EmployeeContext/角色集合；权威角色刷新和撤销传播、多节点缓存、失效事件、无认证后台能力的签发/撤权合同仍待确认。没有新增角色授权，也未运行真实多角色 UI/API。
- A03：只迁移上述两个原生入口；共享实体操作、其他云异步入口和全部第三方调用者未批量迁移，避免在未建立行为合同前改变其事务/回调边界。
- 子回调向父延迟依赖运行时的 `isInTransaction`。在外部 Spring 事务先于 ActionSession 建立、手动事务、非本工具管理的事务、Spring `afterCommit` 自身失败等路径，操作会话后续作业与最终数据库结果仍需统一合同和专项验证。当前工具保留原错误的测试不等于已证明所有 future 作业的结果分类。
- HTTP 边界仅清理本工具拥有的状态。PSDevSysUserHolder、其他线程身份、手动事务和异步请求生命周期仍需相应模块拥有清理责任，不能把这一 filter 测试称为整个平台工作线程已无泄漏。
- 本轮未修改共享运行输入、未部署、未执行真 Servlet 容器、原生 Modeling 多角色 HTTP、跨节点或完整 Maven reactor 验收，不关闭这些验收项。
