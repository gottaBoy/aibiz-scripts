# 授权与嵌套会话实现

检查点：2026-11-22，Asia/Singapore。
状态：当前源码实现及本机 Java 编译回归通过，未部署、未完成顶层验收。
基于 `ibiz-service-hub@26e52348195586d25ebd3524e46968e4e5b59e8b` 的本任务差异；
测试绑定下列源码哈希，不把未提交工作树称为该历史提交的运行版本。

## 手册要求

现有工作区规则要求角色撤销后不能仅靠旧会话继续获得权限，拒绝须无持久化副作用。
原生 Modeling 的根授权、后台 scoped holder 与事务语义属于独立安全能力；
PLM 手册不能替代其协议或运行验收。

历史决策与失败边界见 [A02 源码审计](AUTHORIZATION-A02-20261114.md)、
[A03 清理修复](AUTHORIZATION-A03-20261114.md)及
[A02/A03 威胁审查](AUTHORIZATION-A02-A03-THREAT-REVIEW-20261111.md)。
其中旧 token/session cache 命中及扁平 ActionSession 是当时的源码事实，
不再描述本次候选源码。

## 本地实现观察

### A01：超长运行名称提前拒绝

旧 parentless 验证批次生成的 Nacos 单标签主机名长 69 字符；
此前通过批次为 58 字符。本地 Java IDN 对旧 69 字符名称抛出
`The label in the input is too long`，与当时 NacosConfigManager 启动失败一致。
launcher 和配置生成器现要求实际服务 DNS 标签不超过 63 字符，生成资源前拒绝，
不截断、不悄悄改名。该问题属于已退役 owned 验证名称，不是现有共享短名称故障。

本轮没有为复测该问题创建容器，也未运行新的 parentless HTTP。
A01 仍保留 12 条 absent 与 36 条 typed 的未验收边界。

### A02：每次授权入口重新解析

`SystemAccessManagerBase` 不再以 token JSON 或 root-only ActionSession 参数作授权依据：

- `getCurrentPSDevUser` 从当前开发用户实体服务重新查询中心身份与管理员标志。
  查询异常向上传播，不能回退使用旧管理员快照。
- SYS/SLN 入口重新读取目标、方案所有者及成员授权，验证服务返回的根确实等于请求根。
  specific/global、specific 0 拒绝、owner、同中心管理员、到期及派生 SLN READ
  的既有选择语义保留。
- 原有 JSON 编码及兼容快照写入保留；维护的 Modeling 授权入口不再读取这些快照。
  codec 的类型、根、空值及过期字段校验仍单独测试，不以忽略缓存代替 codec 验证。
- `getCurrentPSDevSysUser` 每次委派同一授权解析，不读取会话里的旧授权。
  有认证身份时，holder 的受信 scoped root 也重新判定当前身份的权限。
- holder 每层绑定创建时的认证账号 ID 及已签发 employee/tenant ID，不保存 token。
  `peek()` 本身检查身份；注销、换账号或换租户直接产生 ACCESSDENY，
  所以直接读取 holder 的数据库选择/V5 客户端不会静默回退或继续使用旧身份。
  manager 的 optional 入口保留 null 拒绝语义。相同账号的 token 续期不改变绑定；
  异常 pop 恢复父层身份，线程之间不共享栈。

撤权边界为下一次实际进入解析器、按当时服务读结果重新判定。
这不是数据库并发立即撤权或跨节点时序验收；同一数据库事务的可见性、
底层服务/读取副本和延迟尚需真实运行证明。
相较旧缓存命中，每次入口增加中心查询及既有目标/方案/成员读取，尚未测生产延迟。

无认证时创建的明确后台 holder 保留无认证 scope 内的既有能力，
不能泄漏到后续普通登录。身份检查只读已有上下文，不触发请求重新过滤。
这不替代 same-identity 的成员授权刷新；授权入口仍需重新解析实际 grant。
WXMP role fallback 每次调用既有角色 API，但平台 EmployeeContext/角色缓存的权威刷新
未在本次接线，因此真实 WXMP 角色移除、登录注销协议和后台能力撤销仍单独待验。

### A03：显式嵌套会话与 REQUIRES_NEW

`openSession` 保持幂等，既有调用不被自动改成嵌套。
新增 `openNestedSession(name)`、`closeNestedSession(child, commit)` 和
`executeNestedSession(name, action, args)`：

- 必须已有父会话；子会话独立持有参数、授权快照、回调及 bypass flags。
  应用上下文和环境映射复制，用户上下文与动态实例仍遵循请求对象的所有权；
  映射中的任意可变值不作深复制承诺。
- 显式子栈同线程按后进先出关闭。错序、跨线程、已关闭对象以及 close 回调递归
  关闭/新开子 scope 均拒绝，不误关父会话。
- 根会话也在 close 期间按对象身份标记；commit/rollback 回调不能新开子 scope，
  后续回调不会因此切到子上下文，也不能在事后恢复已经关闭的父对象。
  legacy 回调明确结束旧对象后新开的替代会话仍可正常拥有自己的子 scope。
- close 成功、rollback 或回调抛错均恢复父绑定。执行器对泄漏的后代按反向 rollback，
  恢复自己打开的 scope；原异常保留，二次关闭异常作为 suppressed。
- 执行器不关闭 action 明确自行结束 scope 后新开的替代 scope。
  legacy 非嵌套 close 回调替换会话的既有语义继续通过回归。
- session 嵌套本身不建立数据库事务、不继承父事务声明，也不把 child commit callback
  称为数据库提交；真正的事务传播继续由既有 `ActionSession.execute` 管理。

另修复现有 REQUIRES_NEW 的两个真实错误：
事务方法成功返回后 commit callback 抛错，不再误执行 rollback callback；
事务/rollback callback 抛错时总会在 finally 恢复父 callback 列表，
原事务异常不会被 rollback callback 异常覆盖。

本次没有自动清理另有所有者的 UserContext、数据源、响应头或 PSDevSysUserHolder；
调用方仍须按自己的 finally/请求边界恢复这些对象。
新显式嵌套 API 尚未批量迁移原生业务调用方。

### A04：保留既有边界

[A04 回执](AUTHORIZATION-A04-20261111.md)中的 alias、启动保护与
client-credentials 契约仍为其原版本证据。
本轮没有真实服务 token 交换、下游使用、过期或撤销运行回执，不升级 A04 状态。

## 当前版本验收证据

本机使用已有本地 JDK 17.0.20，以 `javac --release 11 -proc:none`
重新编译四个生产 Java 文件及当前 modeling-core 的 39 个测试源码，再用
JUnit Platform Launcher 执行，最终 **372/372**，无失败、跳过或中止。
源码 SHA 在编译前后重验一致。

支持依赖来自此前受控构建的只读 JAR 和 modeling-core 支持类；
这不是全新 Maven reactor、完整递归源码构建或镜像打包证明。
没有 Docker 生命周期、业务 HTTP、SQL、授权变更或共享部署操作。

实际命令在工作区根执行：

```sh
node .artifacts/authorization-implementation-20261122-driver/run.mjs r6
node .artifacts/authorization-implementation-20261122-driver/negative.mjs r3
node .artifacts/authorization-implementation-20261122-driver/review-negative.mjs
git -C ibiz-service-hub diff --check
```

输出路径为独占私有目录，不能覆写已有 attempt。
前三个命令分别记录当前源码回归、HEAD 旧实现及修复前候选负对照，不访问 Docker。
负对照对 HEAD 的四个旧生产文件重新编译，运行当前两个相关套件：
56 项中 40 项按预期失败，包括旧 mode 3 在降级后仍返回 3、
旧 commit callback 失败后误触发 rollback、原始异常被覆盖。
不能把该预期失败写成旧版本业务回归通过。

独立互审发现并修复根 close 回调开子 scope、raw holder 绕过身份检查两点。
五个反例分别在单独 JVM 比较 r4 与最终候选：根 commit、根 rollback、raw holder
注销、换账号、换租户。r4 五项均按预期失败，最终候选五项均拒绝正确；
这是本地反例，不是数据库、V5 HTTP 或部署验收。

| 私有证据 | SHA-256 |
| --- | --- |
| `.artifacts/authorization-implementation-20261122-r6/report.private.json` | `adc64429e08ed2cdb74ddeaa65bedab1eadec618352db710cc53915229c5efae` |
| `.artifacts/authorization-implementation-20261122-r6/test.private.log` | `86b86a0193098ac41886975b378a4509148c51f45fd115d270834f2da7b0fb78` |
| `.artifacts/authorization-implementation-20261122-negative-r3/report.private.json` | `80542248bd6d53c8bdd1299d21e371dc5d96829e7a6ebfaa8f1a7bb93b034732` |
| `.artifacts/authorization-implementation-20261122-negative-r3/test.private.log` | `fdeaf456531e6f6fddf66b8ebc1771c316e361d694f5c1d45aabce1dfbd9b720` |
| `.artifacts/authorization-implementation-20261122-review-negative-r1/report.private.json` | `27ecbe0d9b9227de4f5a3ddf73fb8ad960cccf05c01734c560a27e7099a7f8d3` |

`r1` 的新测试编译接口错误、`r2` 的六处旧 cache 计数预期失败及
`r3` 的 363 项、`r4` 的 364 项通过均保留在各自私有目录。
`r5` 增补互审场景后发现五处通用 employee getter 触发重新过滤的失败，
改为纯读取已签发身份后，最终 r6 为 372 项通过。

| 当前生产源码，相对 ibiz-service-hub | SHA-256 |
| --- | --- |
| `libs/ibiz-runtime/src/main/java/net/ibizsys/runtime/util/ActionSession.java` | `1e54787e86a5af26b9db0139952c6857b35b02cfefc60c0dac3ce55ec530df5f` |
| `libs/ibiz-runtime/src/main/java/net/ibizsys/runtime/util/ActionSessionManager.java` | `cc5cda0a8165d3ab616b2bc64861fe79a6f8060ba6ffc83da2a4c9a79f2bd1b3` |
| `libs/ibiz-modeling-core/src/main/java/net/ibizsys/modeling/core/security/SystemAccessManagerBase.java` | `84f8f37b752daa57ffee11249bfdd7bfa1fcac2d8a14ff4a69dc32956431e279` |
| `libs/ibiz-modeling-core/src/main/java/net/ibizsys/modeling/core/util/PSDevSysUserHolder.java` | `6c68f12d1ed00c2d2b7fee96f42400c6d49d0a9907525974dc758129f2032f8c` |

## 待决策/阻塞

1. 完整 reactor 打包、镜像及实际加载类仍需绑定；现有共享运行不会因源码编辑自动
   成为已验收新版本。禁止把旧 11 月 21 日镜像回执用于本次新 Java 字节。
2. A02 仍需真实同 token、多角色、多节点、数据库事务/副本可见性、延迟与拒绝后
   全物理快照证据；WXMP 权威角色刷新和后台 holder 的撤销政策仍未闭合。
3. A03 仍需真实请求调用方迁移、Spring/数据库事务完成时序及 pooled worker 验收。
   session-only scope 不代表数据库 savepoint 或嵌套事务已提供。
4. A01 parentless HTTP 与 typed 传输、A04 服务 OAuth 下游链路仍需各自实测；
   本文及 Java 数量不关闭 [总表](ALL-TASKS-20261111.md)中的任何顶层项。
