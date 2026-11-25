# 真实角色、授权与消息链修复

检查点：2026-11-24，America/Los_Angeles。本批复用既有容器和镜像，
没有 pull、创建/重建容器、删除卷或共享 SQL 写入。原始凭据、业务数据、
浏览器抓取、完整配置和 JAR 保留在私有 `.artifacts/`；未 commit/push。
父项状态不因本批局部通过而批量关闭。
机器可读脱敏索引见
[aibiz-real-acceptance-20261124.json](../records/aibiz-real-acceptance-20261124.json)。

## 手册要求

实际角色必须来自原生身份和成员配置。产品普通成员可写业务数据，只读成员
不能编辑正文或新建需求，非成员及跨组织用户不能借嵌套路径或 Save 绕过授权。
拒绝后还须检查独立提交的编号、需求、版本、最近访问和通知副作用。
MQTT 必须分别证明真实身份、代理、订阅/发布权限、重连和业务消息送达；
站内信持久化、REST 测试 publish 不能替代最后一项。

## 本地实现观察

原生 Person 创建需要独占 `employee_number`，否则默认值触发唯一约束。
实际 SysMember 查询从岗位投影 organization_id；只传成员组织不能生成有效
组织上下文。本批通过原生 API 创建零权限岗位，独立核对权限绑定为零后建人。

五个保留账号分别为普通成员、只读成员、产品管理员、非成员和跨组织普通成员，
均为 `ROLE_USERS`，没有 SUPERADMIN/API 标记。产品管理员仅在本批独占产品有
`admin` 成员关系。另一个根组织、两个零权限岗位和产品均有精确自有记录。
受限组织管理员仍未创建，未用岗位名称、产品管理员或全局超级管理员替代它。

正常会话先使用原生 `getbydcsystem` 选择实际组织，并初始化 appdata；
CoreInterceptor 使用返回的机构上下文。原先缺该步骤的 Bearer-only 403 是
验收器前置错误，未通过伪造用户/员工头或加全局权限绕过。

需求 Create 在 PREPARE 阶段检查真实 PRODUCT 的 SUBDATA 权限，先于框架
独立事务编号分配。原框架 Save 在执行其附加逻辑前直接转入 Create/Update；
因此最终守卫放在实际 Update 的 PREPARE，并以无访问副作用的
`getSimpleEntity` 读取原属产品。拒绝篡改父产品，保留独立移动流程。
先前无效的 Save 附加逻辑已移除，未把中间发布写成修复成功。

## 当前版本验收证据

| 范围 | 当前证据 |
| --- | --- |
| 三个真实用户、普通/只读/无成员关系 | `native-actors-run-20261124-r7`，报告 SHA `3c58f7f490c1981aeeac43a5a30561afe62b8f67fe350ae1a982bf417f493138` |
| 产品管理员账号与对象角色 | `native-product-admin-20261124-r1`，SHA `fe4a1f8f6b2b56d2a7403f98d8a6b67db446962ca729d5ca915021c7a86b2810` |
| 独立组织普通账号及原产品拒绝 | `native-crossorg-20261124-r1`，SHA `87ec30008b35f12ec2270ad446f611e3f9d08587e798ab5d0206bd81a53d8444` |
| Create 当前五角色 41 检查 | `native-product-role-matrix-20261124-r3`，ACL PASS，删除读回 500 独立失败 |
| Save 绕过真实失败 | `native-product-role-matrix-20261124-r4`、`r5`，保留三个无权账号更新成功及精确清理证据 |
| 最终 Create/Update 委派守卫 | `plm-idea-create-authorization-20261124-r6`，相同容器健康，provider 保持 `2b4d9064...fc38` |
| 最终五角色含普通/嵌套 Create 和 Save 新建/更新 | `native-product-role-matrix-20261124-r6`，50/50 ACL PASS，拒绝后编号和 14 字段副作用快照不变 |
| 增补正常 Save 及真实中英文错误 | `native-product-role-matrix-20261124-r8`，58/58 PASS，SHA `09ae16fa46ff839778e7c9b642c3c4a0547c351a35eb259324ebdd446023bb31` |
| 最终运行版业务复验 | `native-product-role-matrix-20261124-r9`，58/58 PASS，SHA `eaf11d341fbba6b005cab9d67c517f4e7b9ae52d29be8716641abbcf0af83c25` |
| 最终六身份配置读写与 Save | `view-theme-role-access-20261124-r4`，66/66 PASS，SHA `2649a372f818a364eb05f0d429b9e9d715a36471aba7973e598d5379e4ace0cf`，容器/镜像/JAR/启动输入前后见证一致 |

`r6` 保留 `ACL_PASS_WITH_NATIVE_GET_CONTRACT_FAILURE`，没有改写旧失败。
仅对原生 DataEntityRuntimeException/code 3 的缺失数据映射修复已部署；
当前 `r8` 的 DELETE、真实 GET 404、三个数据集及物理精确计数均通过。
其他校验、授权和存储异常用 10 类实际依赖测试保留原分类。
本批失败及正控回归的 49 条版本/最近访问关联已通过原生 API 精确删除，
独立物理快照确认归零；不修改编号序列，五个账号及业务角色保留。

MQTT 五个真实账号、20 组换绑，其中八组跨组织均通过当前原生认证/ACL代理矩阵：
`mqtt-native-verify-20261124-r7`，SHA
`6ea0bc0535887c4e7b1f4ed66bf246ef390ab742911ae3c4f43bec193114f89a`。
第一次 Portal 修复后重新验证为 `mqtt-native-verify-20261124-r8`，
SHA `a6aa84e75d11d521806e98c9298c0e37eb577fe77c082a3256fa38e806c1d72e`；
旧 TCP/WS 绕行拒绝重新验证为 `mqtt-legacy-verify-20261124-r2`，
SHA `b280d9e5c31492f5f93d15692ddf1f91c31c4f2dc5dd718a58536b7cdaff0815`。
原 TCP/WS 匿名入口已针对实际 PLM namespace 阻止绕行，其他 namespace 保留原政策。
构建源和启动 dist 的 enableMqtt 均为 true，实际 HTTP 环境也已读回；
保留真实启动覆盖，不通过 docker cp 对 tmpfs 的不可见写入声称成功。

F06 管理员中英文桌面/手机四格均已通过正常个人分组保存、刷新、
新登录读回、精确删除和独立目录缺失，回执为
`current-owned-app-view-themes-20261124-r8`。英文手机工具栏遮挡已通过
单独 CSS/首页修复；手机使用真实 tap 和原生页内导航。SYSTEM 中文存储值不改。
普通成员 UI 实测返回空 SYSTEM 目录，已定位为共享查询被个人 READ 范围过滤；
对应只读模型角色与个人/系统写边界已部署。原生 Save 同时补齐 api/core 两个
声明及权威动作的 CREATE 访问标识，保持原来明确要求的 `/{id}/save` 形状。
普通账号的私有读取、系统写拒绝、伪造系统、跨用户 CRUD/Save、同令牌升为
SYSTEM 后拒写及恢复 PERSONAL 后重获写入均通过。原来的两轮失败保留。

最终 GUI 来源为
`current-owned-app-view-themes-{admin,ordinary,readonly}-20261124-r2`，
三身份各四格，共 **12/12**。每格含保存、刷新、新登录、原生删除和独立刷新
缺失，所有自有分组已清理，SYSTEM 的中文原始标题保持不变。

内部 Portal 修复后，`current-owned-product-realtime-20261124-r3` 的四格
真实产品流程均收到六个明确事件，每格 11 个匹配 PUBLISH 中去重为六事件；
不保存 token 或原 payload，也不使用 REST 测试消息替代业务来源。
`current-owned-product-notification-language-20261124-r3` 的四格正文、
逐叶已读、新登录 READ 和精确清理均通过。此前语言批次的 24 条消息及
原实时失败首格的六条消息也已分别通过正常 UI 清理；原实时回执仍为 FAILED，
专用校验器只接受业务完整、精确清理且唯一失败为未收到实时消息的来源。
最终归档版本另由 `current-owned-product-realtime-20261124-r4` 重跑四格，
每格仍收齐六事件；其新消息由
`current-owned-product-notification-language-20261124-r5` 四格完成已读、
新登录、原文哈希不变及精确清理。配置、业务和消息复验没有互相借用空数组或旧回执。

## 当前输入与检查

实际服务使用原容器、原镜像 ID。PLM provider 为
`75b38f38badd32130d6306f49ea4534bee5ea3ffa329141a45d35c9d827a8f1e`；
All-in-One 为
`1b25c2779dbe919165f275cdbd6a93b5273afdf5a4c609bab08a304fad4d6390`。
前者只更改缺失记录响应类，后者依次保留 Portal 委派、配置写范围、系统只读模型
和 Save 映射补丁。归档每个原始 entry 的哈希均审计，未纳入其他工作区脏改。
新代码是明确的容器内覆盖，不能据此推断原镜像字节已重建。

构建入口为 `prepare-existing-allinone-portal.mjs`、
`prepare-existing-plm-notfound.mjs`、`prepare-existing-view-theme-access.mjs`、
`prepare-existing-view-theme-save.mjs`；各自回执封定实际依赖、源码、工具链和输出。
角色模型同步入口为 `sync-view-theme-system-read-role.mjs`，Save 声明同步入口为
`sync-view-theme-save-access.mjs`。后者保留四份修改前源文件，只更改明确访问标识。
已有执行器快照、原始 JAR、阶段意图、inode/hash 见证及同容器恢复输入均私有保留。

本批针对性 Node/JVM 测试 36/36、静态部署故障与恢复测试 12/12，
产品/分组浏览器合同检查及独立 Playwright TypeScript 检查通过。
TypeScript 使用现有 `ibiz-app-hub/node_modules/@types`，没有安装依赖。
各目标仓库执行 `git diff --check`。未执行可能启动依赖的全量 scripts 测试，
也未重做存在既有 Vue 版本冲突的完整组件类型检查；这些都不记为通过。

## 待验收与保留失败

- AppViewTheme 的限定角色流程已通过；三类个人目录的全部共享政策、组织管理员、
  跨中心/租户/多节点传播仍是独立门槛。
- Portal 同进程委派及六事件业务推送已通过；真实 Modeling IDE 日志、
  全部产品领域消息、集群/宿主重启后的完整部署仍不在该结论内。
- 五个角色账号为后续真实矩阵保留，凭据模式 0600；保留它们不等于全组织角色
  或全部产品、项目、测试、知识能力已验收。
- 子 agent 会话被服务端网络策略中断后由主线接续，没有另开会话规避该限制。
