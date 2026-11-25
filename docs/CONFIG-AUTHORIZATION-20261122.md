# 全局配置写授权修复

检查点：2026-11-22，Asia/Singapore。
涉及 F06 的 HTTP 状态、Conf 公共入口及 SaaS 公共入口三个明确缺口；
不关闭 F06，不更新共享服务。
后端基点为 `ibiz-service-hub@26e52348195586d25ebd3524e46968e4e5b59e8b`，
本轮源文件与私有日志哈希见
[脱敏记录](../records/aibiz-config-authorization-20261122.json)。

## 手册要求

组织所有者、受限组织管理员及子产品/对象管理员须按各自授权范围管理配置，
不能将管理员名称或按钮隐藏当作授权证据。全局初始化模板与个人/对象配置的
持久化范围须保留。最终仍需真实角色、配置保存、刷新/新会话、撤权后旧会话、
跨组织隔离及清理的完整回执。

本次保留已有共享写策略：已认证的原生 API 用户分支、原生 `isSuperuser`
分支、或确切 `UAAUniResAuthority` 的
`UNIRES_CLOUD_CONF_CONFIG_SHARE` 资源权限。
没有根据普通管理员标签、组织所有者名称或同名普通 authority 增加全局权限。
手册角色与实际原生权限的映射仍待当前运行环境验收。

## 本地实现观察

`ConfRestController.saveConfig` 的旧拒绝分支先写 servlet 状态 403，
随后返回 `ResponseEntity.ok(false)`。真实 Spring `HttpEntityMethodProcessor`
最终采用 ResponseEntity 的 200，因此 HTTP 状态与拒绝语义冲突。
改为直接返回 `ResponseEntity.status(FORBIDDEN).body(false)`，
且在取得配置运行时之前拒绝。

`CloudConfUtilRuntimeBase.saveConfig(..., true)` 原先没有共享写权限检查，
直接调用它可以绕过控制器策略。共享策略现位于 cloud-core 的
`GlobalConfigAccessPolicy`；conf-core 的 `ConfigAccessPolicy` 保留全部公开
常量和方法并委派核心 helper。控制器与该公开运行时入口共用；运行时在
`executeAction` 和下游持久化之前
检查权限，拒绝使用已有 `Errors.ACCESSDENY`，按现有异常映射得到 403。
新增拒绝消息覆盖中文和英文，不改权限代码或持久化键。

控制器原常量值和公开 `testUniRes` 方法保留。个人保存、尝试全局读取以及
空请求体对应的个人配置重置语义保持：

- EBSX 持久化个人键仍为 system/configType/targetType/user。
- 共享保存仍使用既有 `__GLOBAL__` 值，不更换 ID 或字段。
- 当前 `removeConfig` 仅删除个人键；没有虚构全局删除入口。

后续审查确认 `CloudSaaSUtilRuntimeBase.saveConfig(..., true)` 原先也只检查认证与
employee 是否存在，内部调用可绕过 Conf 层。该公共入口现于 `executeAction`
之前调用同一 cloud-core helper。因此不会为了复用规则让 SaaS 反向依赖 Conf。
无权共享保存不能先写个人副本；全局回退测试改为使用明确授予原生资源权限的账号。
本次统一三个已知公共入口，不将其写成任意下游插件或全部写入口均已审计。

## 当前版本验收证据

新增 `ConfConfigAuthorizationTest`，使用实际 Spring MockMvc 请求分派、
消息转换和 ResponseEntity 处理，持久化依赖使用可计数的受控代理。
运行时测试直接调用当前 Conf 源码，并检查拒绝发生在 action 执行前。

| 场景 | 本轮结果 |
| --- | --- |
| 无共享资源权限的普通成员 | 实际 Spring 响应 403/`false`，运行时查找和保存调用均为 0 |
| 既有 superuser、确切 UAA 资源、API 用户分支 | 各自保持 200；configType、targetType、share 值一致 |
| 普通 admin、同文字 SimpleGrantedAuthority、大小写不匹配资源 | 拒绝，无持久化调用 |
| 同一受控会话撤掉 UAA 资源后的下一次写 | 拒绝，保存调用计数不再增加 |
| 普通个人保存与空请求体重置 | 保持原调用参数，中文、emoji、组合字符、引号、反斜线和换行在请求 DTO 中无损 |
| 直接调用 Conf 运行时的无权共享保存 | `ACCESSDENY`；action 与持久化调用均为 0 |
| 无认证的直接共享保存 | 在 action 之前拒绝 |
| 中英文运行时拒绝 | 相同权限代码及对应语言消息 |
| 直接调用 SaaS 公开入口的无权共享保存 | `ACCESSDENY`，action/save 调用不增加，既有个人数据不变 |
| SaaS 当前原生资源权限被移除 | 下一次共享写拒绝，既有个人及共享数据均保持 |
| SaaS API、原生 superuser、确切资源及错误 authority 分支 | 复用相同原策略；普通 admin/同文字普通 authority/错误大小写不能共享写 |

最终新 helper 与三个入口联合检查为 **41/41**：
Conf MockMvc/运行时 13 项、SaaS 公开配置入口 28 项，无失败或跳过。
将相同两套测试与 Git HEAD 中的修复前控制器、Conf/SaaS 运行时组合编译后，
得到 **32 通过、9 失败**，其中真实 HTTP 拒绝场景实际返回 200，
Conf/SaaS 运行时共享写没有拒绝。
这些失败是回归对照，不计为当前测试通过，也没有删除或覆盖。

验证使用宿主已有 JDK17、原先绑定的依赖 JAR 和独立
`.artifacts/f06-config-central-20261122-r1/classes`，
重新编译本次 5 个生产源文件和两个测试源文件，使用 `javac --release 11`。
没有写共享 target 或 Maven 仓库、启动应用服务器、创建容器或访问业务数据库。
这不是完整 Maven reactor、全源码依赖闭包或新镜像验收。

私有证据：

- 当前联合成功：`.artifacts/f06-config-central-20261122-r1/report.private.json`。
- 当前联合修复前对照：`.artifacts/f06-config-central-20261122-negative-r1/report.private.json`。
- 历史 Conf-only 成功：`.artifacts/f06-config-auth-20261122-r4/report.private.json`，13/13。
- 历史 Conf-only 对照：`.artifacts/f06-config-auth-20261122-r5/report.private.json`，7 通过/6 失败。
- 历史 Conf-only 记录绑定当时的内部 helper，不能当作核心 helper 下沉后的新版本回归。
- 早期 r1 编译捕获测试直接调用 protected setter；改为测试上下文子类后通过。
- 早期 r2 为 11/12：未指定 Accept 导致 Spring 返回 XML 布尔值；
  补真实客户端的 JSON Accept 后 r3 为 12/12，追加双语检查后 r4 为 13/13。

完整测试已按现有模块方式声明 JUnit/Spring-test 测试依赖。正常离线依赖完备的
开发环境可执行：

```sh
mvn -o -pl libs/ibiz-cloud-conf-core,libs/ibiz-cloud-saas-core -am \
  -Dmaven.test.skip=false -Dtest=ConfConfigAuthorizationTest,CloudSaaSUserConfigTest \
  -Dsurefire.failIfNoSpecifiedTests=false test
```

上述 Maven 命令本轮未执行；本轮实际执行的是私有宿主编译驱动：

```sh
node .artifacts/authorization-implementation-20261122-driver/config-central.mjs r1
node .artifacts/authorization-implementation-20261122-driver/config-central.mjs negative-r1
```

私有驱动输出目录是独占且不可复用的；重跑必须用新的 `rN`，
不能覆盖上述回执。`git diff --check` 已通过。

## 待决策/阻塞

F06 仍为 PARTIAL。还缺当前加载包/模型/镜像绑定的真实 HTTP 和持久化流程、
所有者/管理员/普通/只读/非成员及跨组织矩阵、刷新与新会话读回、
真实撤权后旧会话回归和自有数据清理。
本测试中的权限上下文变更不证明多节点权限缓存或 A02 已解决。
本轮没有部署候选、修改共享配置或执行共享数据库写入。
