# 原生账号 HTTP 只读前置检查

2026-11-23。本轮只执行正常登录、Bearer OIDC 身份读回，
以及实际 UAA bootstrap 声明的三个 Nacos 配置 GET。
没有原生账号资源 GET、业务 POST、直接 SQL、账号/角色/配置修改，
此前三个候选继续为 `NOT_CREATED`。

工具为 `scripts/probe-existing-native-actor-http-preflight.mjs`；
测试为 `scripts/tests/probe-existing-native-actor-http-preflight.test.mjs`。
结果为 `NORMAL_BEARER_SUBJECT_MATCHED_NATIVE_PREFLIGHT_BLOCKED`：
仅 `normalBearerIdentityRead=true`，全部原生授权和创建 gate 仍为 false。
CLI 退出 0 仅表示有限的正常身份读回成功，不能解释成原生前置全部通过。

## 手册要求

角色验收必须来自真实配置、正常认证、具体权限和跨角色读回。
登录账号名称、OIDC subject 或角色声明不能替代有效管理员权限，
不能把组织普通角色、系统基础角色 `ROLE_USERS` 和资源 `user/reader` 混为一类。
不能猜测 realm、组织、人员或组织角色 ID。

## 本地实现观察

固定请求计划来自以下当前本地入口，执行前另核对实际 Nginx、
完整容器 ID、归属标签、端口、配置、挂载及 UAA package JAR：

| 请求 | 依据 |
| --- | --- |
| `POST /api/ibizplm__plmweb/v7/login` | `plm-web/nginx-local.conf` 的 v7 路由，代理当前 allinone 正常认证入口 |
| `GET /api/ibizplm__plmweb/uaa/oauth/userinfo` | 同一 Nginx 的 uaa 路由与平台 `UAARestController.oauthUserInfo` |
| 三个 `GET /nacos/v1/cs/configs` | 实际 `uaa-api-reconstructed.jar` 的 `bootstrap-local.properties` |

只使用现有 `plmweb`、`ibiz-ebsx-allinone`、`ibizlab-uaa-api` 和 `nacos`。
当前 Nacos 完整 ID 为
`bc81ae1030038a2e356b33892f7acc665264c907c4a758fe4ee4b98a03e6e0e9`，
归属为本工作区 Compose 的 `nacos` 服务，映射宿主端口 8848。
前端映射端口为 30250。所有请求固定使用已观察的 loopback origin，
拒绝重定向，不接受外部 URL、prefix、身份头、凭据或 apply 覆盖。

精确配置 ID 为 `common.yaml`、`deploysystem-gateway`、
`servicehub-allinone`，group 均为 `ibiz_config_group`，namespace 为空。
不补猜后缀，不扫描其他 dataId。
使用本机已有 PyYAML SafeLoader 结构化解析，只输出
`ibiz.rest.basePath.api` 和 `ibiz.auth.passwordStorageMode` 的安全候选，
拒绝重复键、循环、对象构造标签和超量输入，不保存原始配置。
prefix 仅接受路径字符，拒绝协议、query、fragment、点段和百分号编码。

正常登录只从已授权的 600 私有业务凭据文件读取 username/password，
登录 body 与返回 token 只在内存中。
userinfo 请求仅携带该正常返回 token 的 Bearer 头，
不加组织、系统、用户或租户身份头，不将 Bearer 发给 Nacos。
错误只保留类型及阶段，不序列化原始请求、响应或异常文本。

`CloudUAAUtilRuntimeBase.onGetOIDCResult` 的源合同仅提供 `sub/email`；
本轮只证明实际 `sub` 与正常登录输入精确匹配。
它不证明 native Person ID、effective authorities、realm、
组织或普通组织角色。即使响应额外出现角色声明，工具仍不升级这些 gate。

内部 native 路径与前端 CloudUAA 路由属于两条链：

- Nacos 服务实例只读观察到 `ibizcloud-uaa -> ibiz-ebsx-allinone:30000`，
  `uaa-api -> ibizlab-uaa-api:32666`。前端 Nginx 的 `/v7/`、`/uaa/`
  都转给 allinone；其中 `UAARestController` 注册的是 `ibizcloud-uaa`。
- Allinone/EBX 源码的 `RTAuthAgent.RT_SERVICE` 是 `lb://uaa-api`。
  `EmployeeServiceImplEx`、`OrganizationServiceImpl` 与角色成员扩展
  使用同一 WebClient 直接调用 `/sys_people`、`/sys_organizations`
  和 `/sys_role_members`。WebFluxClient 使用 service URL 原样作为
  `baseUrl`，没有隐式追加 `/uaa`。
- 因此可审阅的 native 请求形状是 `uaa-api` 服务根路径下的
  `/sys_people/{id}`、`/sys_organizations/{id}` 和
  `/sys_organizational_roles/{id}`。这只是源码/服务发现的路径证据，
  仍未执行请求，也没有证明当前 Spring `ibiz.rest.basePath.api`
  的有效值或 Allinone CloudUAA 如何把前端 `/uaa/*` 转发到该服务。

`uaa.serviceurl` 只出现在 Allinone 启动参数和 service-runner 的
`subsysserviceapi` 默认配置中，用来指定 `uaa-api` 服务地址；
没有发现把 `/uaa/*` 改写到 standalone UAA 的实现。它不能替代
有效 basePath 配置或 native 权限验证。

类合同前证据见 `NATIVE-ACTOR-CONTRACT-20261123.md`，
账号候选边界见 `NATIVE-ACTORS-PREPARE-20261123.md`。

## 当前版本验收证据

```sh
node scripts/probe-existing-native-actor-http-preflight.mjs \
  --output .artifacts/native-actor-http-preflight-20261123-r2
node --test scripts/tests/probe-existing-native-actor-http-preflight.test.mjs
```

r2 于 `2026-11-23T18:21:51.739Z` 至 `18:21:53.023Z` 完成一次固定五请求：

| 操作 | 状态 | 有限结论 |
| --- | --- | --- |
| common.yaml 配置 GET | 404 | 该精确声明配置未读到，不补猜名称 |
| deploysystem-gateway 配置 GET | 200，492 bytes | 无 prefix/password mode 候选 |
| servicehub-allinone 配置 GET | 200，761 bytes | 无 prefix/password mode 候选 |
| 正常登录 POST | 200 | 正常返回 token，仅内存使用 |
| Bearer userinfo GET | 200 | subject 与正常登录输入匹配，原始主体/邮箱不留存 |

前后正常化运行身份稳定。挂载和端口绑定按完整记录排序比较，
保留所有字段与重复项；实际 Source、RW、HostIp、HostPort、
重复项数量、配置、启动时间和 restart count 的变化仍会拒绝。
Env 等具有优先顺序的数组不排序。
另保留 11 次原始数组 hash 观察：PLM 前端 Mounts 出现 3 种原始顺序 hash，
allinone 出现 2 种，而完整记录正常化后未变化。

| 绑定 | SHA-256 |
| --- | --- |
| 工具 | `03af8d787d9d9acd3ef46b3b998b3413f026e29459c31d11b2901f5fdb774ccd` |
| focused 测试 | `5fcf1efd64cf006124480b14c98039460d459460f4f513e934027ad7143514bc` |
| r2 回执 | `ee4b3a44e0ebd26dc22f3f1df72adac1192d01c0659ebad3358504d578b3ebc2` |
| 保留的 r1 失败回执 | `8870b209b3a66f33ab2682d635dbd95d18eb9df593ad589a2c67db291a19937c` |

7/7 focused 测试通过：bootstrap 精确白名单、结构化私密投影、
有限五请求计划、正常认证/Bearer 隔离、subject 不升级原生授权、
归属与完整运行身份，以及路径/身份/route/apply 覆盖拒绝。
排序回归同时覆盖真实挂载/端口字段修改、重复项变化和 Env 顺序。

r1 只记录前两个配置响应，在下一次完整性检查停止，登录 0 次；
该失败历史不改写为通过。修复前另做一次已授权相同
`servicehub-allinone` 精确 GET 诊断，返回 200/761 bytes，未保留 body。
随后以新 r2 目录重跑固定五请求，没有增加其他路由。

私有回执只含源/运行/整段响应的摘要 hash、状态与安全字段，
没有凭据、token、原始配置、原始 userinfo、人员清单或口令/hash 字段。
正常认证可能更新平台审计、登录时间或缓存，
本轮仅声明没有直接 SQL 与账号/角色/业务配置写入，不能声称服务端数据库完全未变。
响应的 2 MiB 检查发生在完整缓冲后，不是传输过程的硬上限；
本轮实际有限响应均低于该检查值。

## 待决策/阻塞

- 三个 extension 配置不是完整 property-source 图；profile、优先级、
  动态刷新与其他配置来源未闭环，本轮也没有读到唯一 prefix 候选。
- 有效 Spring `ibiz.rest.basePath.api` 和 password mode 均未验证，
  未发送任何原生 self/人员/组织/角色 GET。源码已经给出
  `uaa-api` 根路径候选，但不能把它升级为运行时 route 成功。
- OIDC subject 不能证明管理员有效权限、native Person ID、
  realm、组织及普通组织角色。
- Create/Remove 从未发送，`actualAuthorizationTested=false`；
  原生账号创建、自动关联读回和正常多角色登录仍待独立执行。

`accountCreationAllowed=false`、`runtimeContractVerified=false`。
本轮有限身份读取不能关闭 A04、多角色矩阵或 D01 来源闭环。
