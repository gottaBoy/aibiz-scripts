# 当前业务验收与运行前置修复

本批始于 2026-11-22，跟进至 2026-11-23，Asia/Singapore；文件名保留原批次入口。
接续 [25 项实现记录](ALL25-IMPLEMENTATION-20261122.md)；历史回执保留原范围。
本轮复用现有 Docker，不创建/重建容器、不 pull 镜像。
后续已对原后端容器受控加载单类 Java 修复，首尝试失败/原包恢复及第二次部署
分别留证，见 [页面发布修复](PLM-PUBLICATION-REPAIR-20261123.md)。
顶层状态仍以 [总表](ALL-TASKS-20261111.md)为准，不因局部修复关闭整组能力。
本批脱敏状态、哈希和计数见
[当前业务修复记录](../records/aibiz-current-business-repair-20261122.json)。

## 手册要求

按 [产品与项目](manual/PRODUCT-PROJECT.md)、
[测试与知识](manual/TEST-KNOWLEDGE.md)和
[管理、集成与度量](manual/ADMIN-INTEGRATION-METRICS.md)验证。
正常身份、持久化、通知、合法状态迁移、角色拒绝和精确清理分别留证。
中文、补充平面字符、组合字符、引号、反斜线和换行不通过删改内容绕过。

## 本地实现观察

### PLM 身份路由

真实浏览器请求声明 `ibizplm`，原 PLM Nginx 的 appdata 代理却使用独立 UAA，
其响应采用账号默认 Modeling 系统。另一个旧 map 把该账号真实组织 `000000`
清空，造成组织上下文缺失。

已将精确 appdata 路径转到现有 All-in-One 的原生 `/appdata`，并保留真实组织。
修改同时保存在 `plm-web/nginx-local.conf`，保留原有无关工作区差异。
`repair-existing-plm-appdata-route.mjs` 绑定容器、镜像和原配置哈希，保存私有备份、
校验并原子替换配置，执行 `nginx -t` 和 reload；失败恢复原字节。
没有请求容器重启，也没有改认证 token、用户、组织或持久化标识。

### 消息 Unicode

真实产品和知识空间创建返回 500 后，业务对象已持久化。
All-in-One 日志显示 `INSERT INTO IBZMSGSENDQUEUE` 的 `DDCONTENT`
因补充平面字符报 MySQL 1366。实际数据源是平台库，不是已经修复的 PLM 库；
`ibizapi` 中没有该表，不能沿用旧猜测。

现存 All-in-One 主数据源和 PLM 的 RTDS/DB2 指向同一实际平台库。
定向只读观察：消息队列、历史和站内信三表均为 InnoDB Dynamic /
`utf8_general_ci`；当时精确行数分别为 0、2222、886。
消息实现将 queue 复制到 history，再按渠道生成内部消息，需一起评估内容链。
没有对整库或服务器做字符集转换。

新增纯迁移 planner 和只读元数据 SQL collector：
显式限定真实 schema/表，保留类型、默认值、注释和索引，拒绝依赖、不完整元数据、
不支持的服务器及超宽索引。执行工具先备份三表并恢复到现有 MySQL 内自有克隆库，
完成实际克隆 DDL、旧 Unicode 拒绝、迁移后回读、数据/元数据比较和二次幂等后，
才允许进入受保护的窄范围 live 阶段。计划输出本身不算执行成功。

该三表迁移已于 **2026-11-22 22:35:38 +08:00** 完成：
77 个旧 `utf8` 字符列改为对应 `utf8mb4` collation，三表默认字符集同步修复。
没有执行 `ALTER DATABASE`、全局字符集修改或服务重启；类型、默认值、注释、
索引、引擎、行格式及已有 mb4 定义保持。4 个迁移源码输入在运行前后哈希相同。
执行器和恢复计划在 `repair-existing-platform-message-utf8mb4.mjs`；
故障时保留精确备份，禁止自动回灌覆盖新增业务数据或降级四字节内容。
重建初始化后仍应按实际数据源重新采集、规划和验证，不把当前共享修复外推到其他库。

### 站内信原生路由

修复前，前端请求 `/extension/internal_messages/fetch_cur_receiver`，
现有 All-in-One 返回 404，而 PLM Nginx 将其替换为 `200 []`。
权威 saas-extension 用户 API 的服务名是 `api`；
同一正常身份访问 `/extension/api/internal_messages/fetch_cur_receiver`，
真实返回精确自有消息，匿名访问为 401。

现有 Nginx 仅将该资源前缀代理到原生用户 API，保留 Authorization、系统和真实组织；
没有对外使用 `core` 服务，没有注入人员身份。
源配置与运行配置分别留证；工具沿用精确哈希、私有备份、测试 reload 和回滚保护，
没有替换容器或重启服务。列表和单条详情的内容 SHA 与数据库自有消息一致，
补充平面字符保留，匿名拒绝也原样透传。

### 原生个人配置

诊断时 Nginx 的 theme/menu/dynafilter 和 app_view_themes 均为空成功 stub。
这些响应不算配置或通知能力完成。彼时后端原生个人 customtheme 写入实际报
`指定[系统标识][ibizplm]无效`，精确自有 key 的 reset/read-absence 已通过。
其他配置写入未继续；extension 的后端 404 也未伪造成成功路由。
原生父系统缺失、配置内容列字符集及原生 API 的实际 403 进一步诊断，
见 [个人配置注册诊断](PERSONAL-CONFIG-REGISTRATION-20261122.md)。
没有插入假系统记录、替换为 Modeling 系统或删除关系校验。

11 月 23 日已完成后续修复：精确 `IBZCFG` 单表 6 个字符列经独立备份/克隆验证后
迁移；按真实只读 PLM 模型绑定通过原生 Create 登记 `ibizplm / iBizPLM`，
POST 后独立 GET 和物理计数确认持久化。登记不加载/发布模型，也不更改角色。
三类个人配置原生 30 次和真实代理 36 次配置操作请求，覆盖 Unicode 写/更新、
新登录读回、匿名 401、拒绝后值不变及精确清理，均通过。
三处空成功 stub 已替换为真实 `/configs/` 代理。
后续 app_view_themes 亦发现实际 4 条系统配置被空 stub 隐藏；
精确单表 10 文本列经备份克隆验证迁移后，目录/条目代理已修复，
新原生/前端 body 相同且匿名均 401。后续管理员中文桌面正常 UI 个人分组创建、
保存、刷新、新登录读回、精确删除及独立刷新验空通过，原始错误均为零；
其他语言/视口和多角色继续独立验证。
详细范围及独立回执见 [个人配置持久化修复](PERSONAL-CONFIG-REPAIR-20261123.md)。

### 既有服务身份

两个 provider 各自现存 CLOUD 客户端配置使用 PASSWORD 脚本和 `/v7/login`，
实际令牌交换及 Bearer-only `/uaa/oauth/userinfo` 均为 200，身份严格匹配各自配置。
没有补人员、组织或系统头。相同身份的原生系统 Get 已进入实体读取，
因真实 `ibizplm` 记录缺失返回 INVALIDDATA 500，不能记为资源读取成功。
现有 UAA Nacos 实例精确匹配共同网络中的实际 DNS alias，仍为 ephemeral；
运行时负载均衡解析和 OAuth `client_credentials` 另留证。
协议、源输入和 9 项定向测试见 [既有服务认证](EXISTING-SERVICE-AUTH-20261122.md)。

## 当前版本验收证据

- appdata 修复：`.artifacts/plm-appdata-route-repair-20261122-r1/` 至 `r3/`。
  r1 上传权限失败和 r2 组织上下文缺失均保留；r3 同一容器生命周期通过。
  r3 报告 SHA-256 为
  `52df4dcb9d49dd324d0b2790c31c81b5cd7cdeed024466201b5b87da8e304049`。
- 正常登录后的只读对照：`.artifacts/current-appdata-routing-20261122-r3/`。
  PLM proxy 与现有 All-in-One 响应字节 SHA 相同，系统、用户、组织一致；
  独立 UAA 默认系统未改。该报告 SHA-256 为
  `7e75fe35a01f15dee6dd2d16e5170b17a8b2859435336f7d729d4d179e287d7f`。
- 产品 r3 创建失败后，产品及默认成员关系已按精确自有 ID 清理，
  active/archive/deleted 和成员查询均为空；清理测试 1/1。
  `.artifacts/current-owned-product-cleanup-20261122-r2/` 内证据 SHA-256 为
  `39014df7d2eba0c6cc609f4f4fdee997c746c7570628493e180229c96e5b15b5`。
  清理通过不算产品生命周期通过。
- 知识 r2 原回执只证明空间和页面删除。后续独立恢复流程又以原 journal 为归属依据，
  实际逐条原生 GET/DELETE 清理 1 条成员和 2 条 RECENT，查询归零；
  恢复报告仍因响应体/请求头采集失败判 FAILED，清理事实和采集门分开记录。
  `.artifacts/current-owned-knowledge-derived-recovery-20261122-r2/` 业务证据 SHA-256 为
  `d4e5390f718994f5fae094a7d71162660773910a31d927929fb0076f122e9087`，
  原 journal 绑定及删除意图/结果日志 SHA-256 为
  `9235b6a33e0c7a149f744abf4dc2acac50bae6e98fa98a1e0fe2904034834892`。
- 消息迁移：`.artifacts/platform-message-utf8mb4-20261122-r1/` 为只做克隆的成功预演；
  `r2/` 重新备份、恢复克隆、验证后执行三表 live DDL。
  备份 9,581,980 字节，SHA-256
  `0a3b4ded0fbc139609b6ed0b8c411351b84e031951633e44a5f57a4168cd3ca2`。
  live 数据 dump 前后均为 11,052,550 字节，SHA-256
  `6da545c6007f2af8b2e333dbd14fff75fa083d8dbc79c26f230dab22f8a3fbfb`。
  r2 报告 SHA-256
  `ce78ba8e67c7a9c725f1aa8c00634d0c034abac0a88c155601311b3f8a67fc30`。
  两次独占克隆均已删除，MySQL 原容器 `StartedAt` 和 `RestartCount=0` 未变。
  报告明确 `apiUnicodeVerified=false`；新的业务复验将使用新回执，原报告保持不变。
- 迁移 planner、collector 和执行器定向测试 **23/23**；
  覆盖实际版元数据、拒绝缺项/依赖/超宽索引、schema 参数注入、
  新执行上下文和不合法身份在 Docker 调用前拒绝。实际克隆和 live 另有上述证据，
  不由单元测试代替。文档手册引用检查 **10/10**。
- 新产品 r4 真实 UI Unicode 创建 200、正文精确读回和默认成员成功，
  已清理产品和成员；保存按钮定位超时保留为失败。
  r5 继续完成编辑/刷新、新会话读回、归档/恢复、删除/恢复，业务阶段和对象清理通过，
  但启动导航异常和清理后活动页面自动读已删除对象的 500 使整体测试仍失败。
  `.artifacts/current-owned-product-lifecycle-20261122-r5/` 的业务证据 SHA-256 为
  `80e033f162c24b222b1d43c8c41501dc5bd5a38438800f9906193a4d205485e5`。
  r6 在两个正常会话均通过菜单离开自有产品视图后再清理，
  业务阶段、清理、pageerror/requestfailed/HTTP/capture 门与完整运行输入检查通过；
  整体只因一条原始启动导航 abort 仍为 FAILED。
  新消息路由已经被正常 UI 自动请求并返回 200，但尚未打开通知 UI 断言自有内容。
  `.artifacts/current-owned-product-lifecycle-20261122-r6/` 业务证据 SHA-256 为
  `ac6f0aca28ace938cf76d259e84d6b0c7b6713b9468ada1e186348528145bebc`。
- 私有前端 guard 候选已在中英文、桌面/手机四格执行同一产品完整生命周期并通过，
  原始 console/page/network/HTTP/capture 错误为零；该阶段仅为私有证据。
  候选仅准备 17 文件覆盖及 3231 条 literal 静态依赖，10 个动态导入、
  3 个继承 CSS 404、英文归档标题语义错误和旧源码批次差异仍单列。
  具体源/输出指纹和回滚入口见 [guard 候选](PLM-GUARD-OVERLAY-20261123.md)。
  它不替代真实共享环境发布或多角色验收。
- 后续共享前端已完成真实原地发布、显式回滚、重新准备和再次发布。两范围的
  34 项变更及 HTTP 字节核对通过；真实回滚恢复两个原 index，仅移除匹配本 epoch
  的 32 个新增文件。再次发布报告 SHA-256 为
  `778452df73926da38cadb9b3df880f03f4000cd03b1d46eb4369e8eddf68c306`；
  回滚报告 SHA-256 为
  `fd7b822599cb8eed57218b9ee98dc5152558802782d959816f5fa7ef440993eb`。
  现存容器未重启、重建或换镜像，新的共享业务回归尚待单独留证；
  完整发布记录及保留限制见 [guard 发布](PLM-GUARD-OVERLAY-20261123.md)。
- 再次发布后的共享产品双语/桌面/手机四格完整闭环、产品/成员清理和所有原始
  浏览器错误门通过；这些新回执早于后续主题路由和后端发布，版本边界另列于
  guard 文档，不复用私有四格或冒充最终后端版本验收。
- 后端发布单类修复已加载，真实知识 UI 发布状态及正文读回通过；
  首条新知识回执因第二次编辑定位及自动主页清理边界仍为失败，详情和恢复入口见
  [页面发布修复](PLM-PUBLICATION-REPAIR-20261123.md)。
- 最终当前输入产品四格已重新通过并封存 11 项源码/模型快照；回执见
  [guard 发布](PLM-GUARD-OVERLAY-20261123.md)。通知 UI 首格因测试强制要求
  所有事件都有 `url/mobile_url` 而失败，没有执行已读或删除，发送审计保持不变。
  后续权威模板核对证实成员移除、归档、删除合法省略链接；旧失败保留，
  不再将其作为生产消息字段缺陷。原失败回执
  `.artifacts/current-owned-notification-final-20261123-r1/` SHA
  `41f88e4c5ab68c99b10499ad5c8ec435b0b727a0db6b827b5410c40c7d7993f1`。
- 修正通知合同后，中英文桌面各六条自有通知通过普通逐叶已读、新正常登录
  READ/内容读回与精确 DELETE，其他原有消息及发送审计未变。两手机实际存在
  固定宽弹层裁切及图标遮挡，均在已读/删除前停止，保留十二条待重验消息。
  窄范围 CSS 补丁应用和实际 HTTP 字节通过，显式回滚又暴露宿主完整回执
  元数据投影错误：容器首页已恢复，宿主首页仍为补丁，两 CSS 保留。
  随后按精确成功/失败回执完成恢复，修正工具元数据白名单和共同写锁后重新应用。
  中英文手机实际 tap、补丁后两组新产品的桌面通知均完成各六条已读、
  新登录 READ/内容读回与精确清理，其他消息未变。当前 CSS 四格均通过，
  原失败完整保留；不把同进程检查或协作锁称为原子条件替换。
  详见 [通知修复](NOTIFICATION-REPAIR-20261123.md)。
- 消息存储关联回读：
  `.artifacts/platform-message-unicode-api-20261122-r1/report.private.json`，
  SHA-256 `998b17903253c3f99e0fab741141def45014a929e4c0e0381313272c5175ca54`。
  精确 r4 自有标记匹配 8 条发送历史和 2 条站内信，均含完整补充平面字符；
  实际队列已处理为空。SQL 只读观察不代替通知 UI 和多角色验收。
- 消息代理修复：
  `.artifacts/plm-message-route-repair-20261122-r1/report.private.json`，
  SHA-256 `43bae7a5faa3d903ce457da2348f4f9936af48c1b9afac2f4a3404a8ca426146`。
  正常身份代理/直连列表精确一致、详情 200、匿名 401，
  两条自有站内信经原生 DELETE 200 后，API 与只读 SQL 均确认消失。
  `.artifacts/plm-message-route-readback-20261122-r1/report.private.json`，
  SHA-256 `3f36e4e55860e70d5cc7066f1b5f3ba77a3549933daa2687a45e36c4231144b8`。
  发送历史作为原生发送审计保留，没有通过共享 SQL 删除。
- 11 月 23 日又精确清理产品 r5/r6 和知识 r3/r4 的 14 条自有站内信：
  当前用户原生数据集读取后，按四个已结束回执的唯一标记与真实 owner 选取，
  每条原生 GET 核对后 DELETE，API 及只读 SQL 证实所选 ID 均消失。
  首次隐式内容筛选未生效时，程序在任何 DELETE 前拒绝，保留零删除失败回执；
  后续不用该未生效参数，不删除无关消息，也不删除发送审计。
  `.artifacts/owned-business-notification-cleanup-20261123-r1/report.private.json`，
  SHA-256 `8c5253dc9a6b8970409e2aa896f7525421d282aa7a3e7fd1d75f39f8938e3b5a`。
- 本次组合定向检查 **48/48**、零跳过，14 个当前测试/源码输入前后哈希一致；
  包含上述迁移、路由、个人配置只读诊断及手册检查，不与子组计数相加。
  `.artifacts/current-business-repair-contracts-20261122-r1/report.private.json`，
  SHA-256 `9c7ac8c5f34ca038d11319479fe006fd9d804dd5a9313468f93b4fae828a1629`。
- 真实官方目录包及 seccomp 下安装/更新/回滚增量另见
  [真实官方市场包](OFFICIAL-MARKETPLACE-PACKAGE-20261122.md)，
  不等同原生市场注册、合并、重载或 23 类全部完成。

## 待决策/阻塞

消息存储迁移已经通过；新的正常业务 API、通知结果需逐次追加当前证据。
B01 尚缺多个领域和真实多角色闭环；当前账号的管理员正向测试不覆盖普通/只读/非成员。
历史启动导航异常已定位到旧前端静态字节；修复现在已原地发布并演练真实回滚，
发布后的共享业务仍须独立验证，不能通过测试白名单消音。
Docker inspect 挂载数组的顺序变化已与完整字段变化区分，
原始 JSON/哈希继续保留，Source、Destination、Type、RW、Propagation 或生命周期变化仍拒绝。
F06 已有真实个人持久化闭环，剩余 GUI、多角色/跨用户/组织、共享写、撤权矩阵仍开放；
中央授权 Java 候选没有冒充部署验收。
其余 25 项保持总表原状态，源代码与局部测试增量分别归属对应父项。
