# 原生测试账号候选准备

2026-11-23。本轮仅离线准备三个自有测试账号候选，没有登录、HTTP 请求、
真实账号创建、角色授权、组织成员写入或共享 client 修改。
所有候选与私有凭据明确为 `NOT_CREATED`、`runtimeContractVerified=false`、
`authenticationUsable=false`，不增加任何已验收角色数量。

## 来源与限制

工具为 `scripts/prepare-existing-native-actors.mjs`，测试为
`scripts/tests/prepare-existing-native-actors.test.mjs`。
它绑定 21 份本地 Controller、DTO、Service、领域与 PLM 模型原始文件，
并封存工具和测试原始字节。源文件、候选、凭据及回执均私有，
使用独占 `wx / O_NOFOLLOW`、600 文件、700 目录与文件/目录 `fsync`。

**D01 来源边界：** `standalone-uaa/source` 是维护或重构源码，
尚未证明是当前 UAA 镜像的原始源码。字段和 guard 的源合同可以准备，
但源码 hash、方法存在、角色声明及本地测试均不能证明运行镜像匹配，
也不能直接授权创建用户。实际 Swagger、服务类注解/字节、Controller 前缀、
密码模式、GET 权限、realm、组织和原生角色必须在执行前另行核对。

## 手册要求

普通、只读、非成员与跨组织身份必须来自真实配置和正常认证；
管理员单账号、隔离库候选或伪造请求头不能替代当前多角色矩阵。
只处理本任务自有账号、关联与资源；口令、令牌和人员绑定保持私有。
原生失败后还要读回是否已经持久化，精确清理不能删除被其他流程采用的数据。

## 本地实现观察

原生资源类使用 `${ibiz.rest.basePath.api:/}`。实际部署前缀尚未验证，
所以候选没有可直接执行的完整 URL。

| 来源入口 | 源授权合同 | 本轮运行结论 |
| --- | --- | --- |
| `POST /sys_people` | `ROLE_SUPERADMIN` 或 `uaa-SysPerson-Create-all` 或实体 Create permission | 未执行、未证明当前类匹配 |
| `GET /sys_people/{id}` | 对返回对象执行 Get 授权 | 未执行 |
| `DELETE /sys_people/{id}` | 平台或明确实体 Remove 授权 | 未执行 |
| `POST /sys_role_members` | 平台或明确角色成员 Create 授权 | 仅源绑定，无授予请求 |
| `POST /sys_members` | 平台或明确组织成员 Create 授权 | 仅源绑定，无重复创建请求 |

具体布尔表达式原文保存在私有候选，工具确认真实 Controller 子类没有覆盖这些 CRUD。
源 DTO 提供 `uid / display_name / user_password / dc / organization_id /
organizational_role_id / status` 等字段。这是已观察的字段清单，
不是当前镜像全部必填字段或数据库约束已验收。

`SysPersonServiceImpl.create` 源实现具有以下行为：

- 没有显式 ID 时按 UID 或 realm 默认键生成；后续关联必须使用服务器读回的真实 ID。
- 显式密码在 `sm3` 模式且长度不等于 64 时由原生代码计算 SM3；
  缺密码会使用配置的默认口令。本工具始终生成独立随机 36 字符口令，
  避免默认密码和被误当 64 字符已有 hash，但当前运行模式仍待验证。
- 创建后调用 `init`，自动关联基础 `ROLE_USERS`；准备清单不重复手工授予，
  并要求读回全部有效 authority，拒绝普通测试账号获得
  `ROLE_SUPERADMIN / ROLE_APIUSERS`。
- 指定真实 `organizational_role_id` 时源逻辑可构造 `memberOf`，
  基类通过 `saveByPerson` 保存组织成员。因此不再盲目插一份重复 `SYS_MEMBER`。
- Create 会删除同 ID 的 disabled 旧人员行。因此执行前必须检查生成 UID
  在全部 realm、活动行和墓碑中都不存在，不能用 CheckKey 的空结果代替。

源 Remove 先移除该人员的 `inetOrgPerson` 角色关联，
基类再移除 `SYS_MEMBER`，人员本身采用 `ENABLED=0` 逻辑删除。
不能把 HTTP 删除成功或普通 GET 缺失解释成物理行已经消失。

PLM `product_role_type` 明确定义普通成员 `user` 与只读成员 `reader`。
候选中的只读身份仅表示某个本任务自有产品的只读成员，
不是组织超级角色，也不自动定义个人偏好写入政策。
`PRODUCT_MEMBER.USER_ID` 关联 PLM `Base/user`，不能直接假定它等于 UAA Person ID；
必须由正常登录 appdata 和原生 user 查询解析并核对。

## 当前版本准备证据

```sh
node scripts/prepare-existing-native-actors.mjs \
  --output .artifacts/native-actors-prepare-20261123-r2
node --test scripts/tests/prepare-existing-native-actors.test.mjs
```

r2 生成 ordinary、readonly、nonmember 三个本次命名空间下的 planned UID，
分别具有随机私有口令。非成员仍需合法组织成员身份，但不创建目标自有产品成员关系。
候选请求中的 realm、组织、组织普通角色、产品及 PLM user ID 为显式未解析绑定，
即使提供 hint 也保持 `verified=false`，不能被当成权限。

`credentials.planned.private.json` 使用 `entries` 与 `candidatePassword`，
没有既有 helper 所需的顶层 `username / password / users`。
必须在真正原生创建、正常登录与成员读回之后，
另行生成带创建证据的登录输入；不能修改此候选为“已创建”。

| 证据 | SHA-256 |
| --- | --- |
| 工具 | `718654fae1c8c18dbdab51c2eb8d50e61ec76aefa920884378b2cd73d89007eb` |
| focused 测试 | `fc9165983d116c8b68f7997a23452264ef7daa2ac96c4c23730c5fe502683e0f` |
| r2 候选 | `85bb53d8420dd2702636cd3de3bdfd871689b93498928ced6cf87fb6c76a05b9` |
| r2 回执 | `5bfbd90f87984ffc4c1fc4d439089a4ec006ad3af6c55e8934dd4f6af2ee8810` |
| r2 原始源快照 manifest | `8ea4e37f1493ccb8ed719f7e6dc2184b902c937c30f98f21ba69888e2ab82580` |

7/7 focused 测试通过：源 guard/字段变化拒绝、三候选不可执行、
hint 不转授权、planned 凭据不能冒充已创建账号、私有独占输出、
随机口令独立性与原始源逐字快照，以及 apply/adapter/shared identity/path/symlink 注入拒绝。
它们没有启动服务、登录或发送管理请求。
r1 原候选保留，r2 另外增加工具/测试原始字节绑定，不覆盖旧回执。

## 可实施下一步

1. 只读核对当前 UAA 镜像的实际 Controller/DTO/Service、前缀、密码和依赖合同，
   绑定完整容器 ID、镜像与挂载；源不匹配则停止创建。
2. 用正常管理员身份验证精确原生 GET 与授权条件，选取真实 realm、
   本任务允许使用的组织及其普通组织角色；不猜测 `000000` 或其他 ID。
3. 证明生成 UID 在所有 realm 和墓碑中均不存在，检查当前口令策略与存储模式；
   解开模板引用前重新核对所有源、运行输入与候选 hash。
4. 独占私有执行目录中逐个写前记录并 `fsync`；经原生 Create、完整响应、
   独立 GET、自动角色/成员读回及正常登录后，才能标记单个账号已建立。
5. 在本任务自有产品上仅建立 ordinary=`user`、readonly=`reader`，
   同时验证 nonmember 没有该关系；越权与跨角色读回仍须独立执行。
6. 保存全部已发 ID 及完整 native snapshot。先清自有对象数据/成员，
   再按精确身份清理自有角色/组织关联和人员；逻辑删除墓碑需如实记录。
   HTTP 失败或响应丢失必须先查持久化，不能自动重建或删除共享行。

跨组织候选明确为
`BLOCKED-NO-VERIFIED-OWN-ORGANIZATION-CONTRACT`：目前没有在此工具中证明
当前版本自有组织 Create/Get/Remove 与 realm 隔离合同，
不生成第四账号、不猜组织 ID，不因此关闭跨组织权限项。
