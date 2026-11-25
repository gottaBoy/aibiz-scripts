# 原生账号运行 classpath 合同核对

2026-11-23。仅只读核对现有 `ibizlab-uaa-api`，没有登录、HTTP、
数据库访问、账号创建、角色修改或服务重启。
工具为 `scripts/probe-existing-native-actor-contract.mjs`；
测试为 `scripts/tests/probe-existing-native-actor-contract.test.mjs`。

本轮结果为 `CLASS_SUBSET_MATCHED_AUTHORIZATION_NOT_TESTED`：
`runtimeClassContractVerified=true` 仅表示下文 19 个 classpath 类的选定结构合同匹配，
整体 `runtimeContractVerified=false`、`authenticationUsable=false`。
此前三个账号候选保持 `NOT_CREATED`，没有修改候选或 planned 凭据。

## 手册要求

普通、只读、非成员和跨组织角色必须经真实原生身份、正常认证及跨角色读回验收。
方法注解、类字节和模型字段只能作为执行前证据，不能代替管理员实际权限、
组织归属或未授权请求无持久化副作用的验证。

账号准备的独立记录见 `NATIVE-ACTORS-PREPARE-20261123.md`。
本轮不关闭 A04、多角色矩阵或 D01 原始来源闭环。

## 本地实现观察

实际 `/proc/1/cmdline` 为 Java classpath 启动：

```text
java -Dcom.sun.xml.bind.v2.bytecode.ClassTailor.noOptimize=true \
  -cp /opt/uaa/third-party/*:/opt/uaa/starters/*:/opt/uaa/packages/* \
  cn.ibizlab.BootApplication
```

容器 WorkingDir 为 `/opt/uaa`。
自动回执绑定实际 `/proc/1/cmdline`，没有绑定 `/proc/1/cwd`。
容器 `Config.Path/Args` 仍包含缺省 `/uaa-api.jar` 模板，
但该文件不存在；不能把模板路径当成实际服务字节。
当前容器没有挂载，归属标签指向本工作区
`plm/deploy/compose` 及 `ibizlab-uaa-api` Compose 服务。

工具只允许上述已观察部署形状。名称、完整 ID、运行状态、归属、
挂载、进程入口或类来源发生变化时拒绝继续；它不自动适配其他服务。
只执行 Docker inspect、容器内只读文件读取/JAR 清单/`javap`、
以及私有副本的 `unzip -Z1/-p`，不调用业务代码或运行类初始化。
JDK 工具禁用 JVM perf data，使用现有容器内 `javap 17.0.20`，
没有新建工具容器或在容器内解压文件。

| 核对范围 | 本轮观察 |
| --- | --- |
| 3 组 classpath | 267 个 JAR，全部前后 SHA-256 一致 |
| 19 个目标类 | 每类恰好一个 JAR 来源，无重复同名类 |
| 实际私有副本 | 仅复制 api/core/user 三个 package JAR，未复制全部依赖 |
| Controller 继承链 | Person、RoleMember、Member 的实际 Controller/Impl 没有覆盖目标 CRUD |
| 映射和 guard | 三类 Create/Remove 与维护源码一致；Person/Member Get 的 PostAuthorize 一致 |
| RoleMember Get | 未观察到本地 Pre/PostAuthorize；不推断为匿名可访问 |
| DTO | 三个 DTO 的完整 JsonProperty 集合与维护源码相同 |
| 密码 | 配置占位符、默认口令分支、SM3、非 64 字符输入分支及原生 setter 引用匹配 |
| 基础角色 | Person Create 调用 init；init 关联 ROLE_USERS predicate，原生逻辑在角色存在且关联缺失时创建 |
| 组织成员 | Person Create 的组织角色/成员构造与基类 saveByPerson 依赖匹配 |
| 删除 | 直接 inetOrgPerson 角色关联先删，基类 removeByPersonId 在 Person 删除之前 |
| 人员墓碑 | TableLogic 的 value=1、delval=0 与 enabled=0 旧行处理分支匹配，不能称物理清除 |
| UID/realm | loadUserByUsername 实际引用的 lambda bootstrap 指向 SysPerson.getUid/getDc |
| 方法授权开关 | 包装类声明 EnableGlobalMethodSecurity(prePostEnabled=true)，实际拦截仍需 HTTP 验证 |

19 类为三组 Controller/Impl/AbstractResource/DTO 共 12 类，
另加 Person 领域、PersonServiceImpl、AbstractPersonService、
AbstractMemberService、AuthUserServiceImpl、PersonSearchContext、
BootSecurityConfig 共 7 类。
每个 class 私有副本的 hash 均与实际 classpath `javap` 输出的
JAR 路径、entry 与 class checksum 对齐；不只查常量池里有没有权限字符串。
注解绑定具体方法 descriptor，密码和清理依赖绑定具体方法，
登录 getter 与角色 predicate 另绑定该方法调用的 lambda bootstrap。

这些是当前磁盘 classpath 文件与选定方法结构的检查，
不是 JVM 内存类转储、完整字节码语义等价或来源真实性证明。
`standalone-uaa/source` 仍是维护/重构源码，当前镜像归属标签也明确为
`packaging-candidate-not-native`；源码 hash、镜像标签或此次匹配均不能改写该边界。

## 当前版本验收证据

```sh
node scripts/probe-existing-native-actor-contract.mjs \
  --output .artifacts/native-actor-contract-20261123-r2
node --test scripts/tests/probe-existing-native-actor-contract.test.mjs
```

r2 执行于 `2026-11-23T17:45:23.030Z` 至 `17:45:59.432Z`。
核对前后完整容器、镜像、配置 hash、挂载、启动时间、restart count、
进程入口、267 个 JAR 和绑定源码/工具/测试均稳定。
证据目录为 700，原始 JAR、class、反汇编、源码快照和回执为 600，
独占创建并保留在 `.artifacts/`，不提交私有原始内容。

| 绑定 | 值或 SHA-256 |
| --- | --- |
| 完整容器 ID | `1e62ca52d8872ca0c849d28cf7882ebba9ce65a5af8544e381c88e7af47e03b9` |
| 镜像 ID | `sha256:8f65be60bd121fbf4c300c66698660621ff1ffdfcb7a506f3b958d80f7934c0c` |
| 工具 | `62c29fe7ebe7d43e15c80b649eb12cc8f71a2cc378e37bbf22e0f3085c410b0f` |
| focused 测试 | `7b9e28f6d63a812da454c88eaf5a5e6b25c9600b1c7aeb244df51ce1df658032` |
| r2 回执 | `98abd54d353184dd200a0e9d8579defab7655ba5fbbd6e04f618e5c755a6b497` |
| r2 classpath 清单 | `990a54a4e46799bfba10e9edb7f9e32b37fc120e3d4fb640345c270a06cbb16d` |
| uaa-api-reconstructed.jar，7,959,981 bytes | `b0a871d969c86efcc38058247ede2214180afef073268c12b55e153ee63ef742` |
| uaa-core-reconstructed.jar，4,615,305 bytes | `28ba537531dbe87b5287b2736822ad11b9103b18e9f0000e5084fa578d82dbcb` |
| uaa-user-reconstructed.jar，251,253 bytes | `5cdf60e55059553a752683234049d5cc83138fbee3067e329ed74b620a929cd7` |

7/7 focused 测试通过，覆盖完整归属与实际进程形状、重复/缺失类、
方法级注解与 descriptor、缺失 guard/DTO/密码/清理依赖、
lambda 错配、逻辑删除值变化，以及 apply/HTTP/凭据/不安全输出拒绝。
归属拒绝测试确认仅 inspect 即停止，没有创建证据目录或触碰账号候选。

r1 因解析器当时没有接受 javap 省略 `extends Object` 的输出而停止，
原失败回执保留，不能写成 r1 通过。修复另外覆盖方法注解缩进和
javap 转义单引号，再以新 r2 目录完整重跑，没有覆盖失败证据。

## 待决策/阻塞

- 尚未解析当前生效的 Controller prefix 和 password storage mode；
  类中的占位符及默认值不等于外部配置合并后的有效值。
- 尚未正常认证管理身份，验证精确 Get/Create/Remove 授权和拒绝后的无副作用。
- 尚未绑定真实 realm、允许使用的组织及其普通组织角色，
  也未证明 planned UID 在活动行和墓碑中均不存在。
- 尚未经原生 Create/独立 GET/全部有效角色与组织成员读回/正常登录，
  因此 prepared candidates 继续不可执行、不可作为浏览器登录输入。
- 尚未验证 UAA Person ID 到 PLM user ID 的映射及自有产品 user/reader 成员关系；
  跨组织候选仍单独阻塞。

本工具没有 apply 选项。后续真实账号执行必须使用独立写前记录、
精确已发 ID 和可恢复协议，不能把此次类合同通过当成账号管理授权。
