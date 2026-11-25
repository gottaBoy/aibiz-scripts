# 个人配置保存的系统注册诊断

2026-11-22。F06 保持未验收。本轮新增可重复的只读诊断，未创建系统、配置或测试业务数据，未变更数据库、Nacos、服务、镜像或 nginx。登录只请求既有账号的认证会话。

## 手册要求

- 管理与度量指南要求区分个人、对象、组织及全局作用范围，不能将组织管理员等同于平台管理员，也不能仅凭按钮或接口声明证明权限。
- 本工作区要求中文、补充平面字符、组合字符、引号、反斜线与换行无损读回。消息队列、PLM 业务库及配置存储的 Unicode 验收各自独立。
- `customtheme`、`menu`、`dynafilter` 的 Conf 实现与接口来自本地源码和 F06 检查点；此处不将指南未明确描述的接口行为称为手册承诺。

## 本地实现观察

个人配置的写入链为：

`ConfRestController` -> `CloudConfUtilRuntimeBase` -> `CloudSaaSUtilRuntimeBase` -> `EBSXCloudSaaSUtilRuntime.onSaveConfig` -> `DstConfigService.save`。

`EBSXCloudSaaSUtilRuntime.java:954` 起使用当前 `EmployeeContext.systemid`，以 `SYSTEMID / CFGTYPE / TARGETTYPE / USERID` 生成原生配置键，并将同一 `systemid` 写入 DTO。

权威关系 `DER1N_DST_CONFIG_DST_SYSTEM_SYSTEMID.json` 指向 `lite/DstSystem`。该实体与 `uaa/System` 都使用 `DEFAULT` 数据源的 `IBZPSSYSTEM`，主键为 `PSSYSTEMID`；配置实体使用 `IBZCFG`。不能将扩展平台的 `SYSTEM` 表、UAA 部署关联或 HTTP 空响应当成该父记录已经存在。

`DataEntityUtilRuntimeBase.java:572` 检查父实体的 `checkKeyState`。结果不是 `EXIST` 时，`:581` 产生原生错误 `指定[系统标识][ibizplm]无效`。这与保留的实际错误一致；没有移除父关系校验，也没有更换持久化系统标识。

原生注册的源码入口为 `POST /ebsx/oldcoreapi/syspssystems`：

- `ibiz-ebsx-runtime/src/main/resources/application-auto.yml:83` 部署 `ebsx` 的 `EBSXSystemRuntime`。
- `SysServiceAPIRuntime.java:109` 从部署服务 ID 和服务代码组成基础路径。
- `OldCoreAPI.json` 将 `System.Create` 映射为 `POST`、数据访问操作 `CREATE`，输入为 `SystemDTO`。
- API 级别为 `CLOUDADMIN=1`。`SysServiceAPIRuntime.java:665` 要求原生 `AuthenticationUser.superuser == 1`，之后仍需通过实体 `CREATE` 授权。组织管理员身份不能替代该条件。
- DTO 模型来源字段包括 `sysmodel`、`remotesysmodel`、`remotesysmodelpath`、`remotesysmodelbranch`。普通 `Create` 本身不保证有效模型来源，不能只插入一个父键后宣称注册完整。
- `EBSXCloudDevOpsUtilRuntime.java:480` 读取系统 DTO，并可从 `systemsource-{id}` 解析 Git、OSS 或本地模型来源；`:1323` 的本地路径必须对执行服务真实可用。`:2579` 的发布会同步模型、发布配置，具有更大作用范围。
- `DstSystemServiceImpl.java:191` 与 `:195` 的 `InitDefaultDataSource`、`SyncSysModel` 仍抛 `NOTIMPL`，不应调用它们伪造初始化完成。

以上为当前检出源码观察。回执绑定了实际镜像和宿主挂载输入，但没有把这些源码等同于运行 JAR 已完成重建验收。

## 当前版本验收证据

原生个人配置回执 `.artifacts/plm-personal-config-native-20261122-r1/` 保留以下事实：新自有键 GET 为 200 空体；写入含 Unicode 的配置返回 500，错误为上述系统标识无效；之后对精确自有键的 null reset 为 200，GET 再次为空。没有把 reset 当成持久化往返成功。

最终只读诊断：

```sh
node scripts/inspect-personal-config-registration.mjs \
  --output .artifacts/personal-config-registration-20261122-r3
```

2026-11-22T14:25:40.495Z 至 14:25:40.652Z：

| 检查 | 实际结果 |
| --- | --- |
| 当前 SaaS `SPRING_DATASOURCE_URL` | 指向现有 `mysql/a_lab01_3f9ebc219`，只公开连接串 SHA-256 |
| 原生父表 | 实际表名 `ibzpssystem`，主键 `PSSYSTEMID` |
| `ibizplm` 的数据库比较匹配数 | 0 |
| `ibizplm` 的精确字节匹配数 | 0 |
| 配置正文存储 | `ibzcfg.CFG` 为 `mediumtext / utf8 / utf8_general_ci` |
| 生命周期 | 诊断前后 SaaS/MySQL 的容器 ID、镜像、启动时间、重启计数一致 |
| 查询范围 | 只读事务、两张指定表的元数据和一个系统标识的计数；未读取配置正文 |

独立只读 HTTP/source probe 保留于 `.artifacts/personal-config-registration-20261122-r1/native-api.private.json`：

| GET 路径 | 匿名 | 既有业务账号 |
| --- | --- | --- |
| `/ebsx/oldcoreapi/syspssystems/ibizplm` | 401 空体 | 403 空体 |
| `/ebsx/oldapi/systems/ibizplm` | 401 空体 | 403 空体 |

精确 Nacos 配置键 `systemsource-ibizplm` 的记录数与内容字节数均为 0。未读取其他系统配置、令牌或用户绑定数据。

空体 403 不能证明已到达实体授权层，也不能证明此账号缺少或具备 `superuser`。源码中的 `MethodHandlerBase.java:935` 对缺少 `EmployeeContext` 的已认证请求也返回空体 403。本轮未获得可将该响应精确归因到某一授权层的日志，不由此推断 `CREATE` 可用。

轻量验证：

```sh
node --test scripts/tests/inspect-personal-config-registration.test.mjs
node --test scripts/tests/plm-manual-reference.test.mjs
git -C scripts diff --check
```

诊断测试 6/6 通过；覆盖真实模型关系与原生 API 映射、禁止写 SQL/读取配置正文、外库路由/歧义元数据/SQL 标识注入拒绝、生命周期变化拒绝，以及缺注册、大小写不一致和已存在三种结果不被误报为验收完成。手册引用测试 10/10 通过，差异检查与四个新增文件的独立空白检查通过；五个证据/工具哈希逐项核对一致。未运行全量 scripts、数据库变更、容器重建或业务写入。

## 待决策/阻塞

1. 当前原生父系统确实缺失。下一步需要真实具备平台权限和 `System.CREATE` 能力的账号建立正常上下文，先完成原生读取与拒绝路径验证。
2. 为真实 `ibizplm` 注册绑定正确的当前模型来源与完整模型哈希。PLM provider 的 `/app/model` 是另一个容器的只读绑定，当前 SaaS 容器没有该挂载，不能将同名路径直接填入注册 DTO。
3. 原生创建请求仍为未准备、未执行。完成来源与授权核对后，才可准备精确 DTO、恢复输入及后续发布影响审查；不使用 SQL 插父行、冒用其他产品 ID 或无模型来源的空系统凑过父键检查。
4. `IBZCFG.CFG` 的 `utf8` 无法存储原文四字节字符，是独立存储缺口；若序列化产生原文 emoji，注册修复后仍会受阻。必须单独完成备份、克隆恢复、完整元数据/数据核对、幂等及真实 API 读回，不纳入当前三张消息表迁移。
5. 最终仍需三类个人配置的正常保存、更新、刷新/新会话读回、匿名及跨用户拒绝、精确清理，以及独立的共享配置权限验收。源码和 6/6 诊断测试不关闭 F06。
