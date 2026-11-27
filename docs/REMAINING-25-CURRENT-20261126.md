# 25 个父项当前实现与验收门槛

检查点：2026-11-26，America/Los_Angeles。以
[总表](ALL-TASKS-20261111.md)为状态来源：25 项未完整验收，
PARTIAL 16、ACTIVE 3、OPEN 4、BLOCKED 2。以下逐项记录实现入口和剩余门槛，
不把子步骤、测试数量或源码恢复当作父项完成。

## 手册要求

业务范围沿用三个[领域指南](manual/README.md)；Development、API Reference、
Data Model、Modeling IDE、MQTT 和 D/K/O 交付门槛独立验收。
正常账号、原生导航、持久化读回、拒绝无副作用、双语/视口、实际服务字节和
自有数据清理均须保留。仍需外部身份、权威来源或完整恢复环境的范围不能伪造。

## 本地实现观察

本批已修复并实际应用知识分享 URL 的本地配置与两个校验节点委派；
配置原先写到不生效的 Nacos 路径，该临时改动已精确恢复。
真实 API Reference 文档已发布到现有宿主入口。
控制器初始化/销毁竞态的源码和 runtime 已发布；
随后真实深链复验暴露另一个默认菜单异步导航竞态，继续按原验收门修复。

AppHub 七包的完整双构建已取得一致交付字节。最终复核又补上“当前两份产物
必须匹配封存 producer”的检查，防止两边同时缺文件仍通过。
两个市场仓库已按官方精确提交恢复源码并核验许可证，但没有冒称全部安装版本、
递归依赖或原生市场安装已完成。

## 当前版本验收证据

| 范围 | 当前证据与明确边界 |
| --- | --- |
| B01 知识 | 正常管理员创建私有空间、Unicode 草稿、新会话读回、发布/草稿隔离、锁拒写 403、保护字段无变化及有效解锁通过。真实 `shared_page_url` 已返回；原始匿名 URL 的 `/plmwiki/` 为 404，保留失败。见[知识回执](B01-KNOWLEDGE-CLOSEOUT-20261126.md)。 |
| B03 文档 | 现有宿主的中文/English、桌面/手机静态四格及错误恢复通过。原生 r1 的 API 正反向执行和清理通过，但两条生命周期异常使整格失败；修复并发布后，r2 零原始错误，深链被过时默认导航覆盖，整格仍失败。见[宿主回执](B03-HOST-CLOSEOUT-20261126.md)。 |
| L03 合同 | 真实 DTO/Jackson/END 探针与两类分享调度原生正负控通过。客户分数委派修复已推独立后端分支，尚未进入共享 provider；缺失的权威 DTO 声明没有用动态键猜补。见[运行合同](L03-RUNTIME-CONTRACT-20261126.md)。 |
| D01/O01 构建子范围 | canonical 七包两遍 9,326 个 `dist/out/es/lib` 文件一致，包含声明和样式。新严格复核回绑 producer 的全产物和复制入口；缓存依赖和同宿主断网构建不是干净主机完整重建。见[构建证据](D01-CLOSEOUT-20261126.md)。 |
| K01 来源子范围 | 逻辑设计器官方提交全树 2,950 文件、模型素材官方提交 443 文件，MIT、双树重建、确定性归档与恢复一致。增量同步可信来源及全部安装版本仍开放。见[来源证据](K01-SOURCE-CLOSEOUT-20261126.md)。 |

M01/M02 的只读契约审计进一步确认：M02 应用 `PSDevCenter` 声明的
`FetchDefault` 没有对应已发布 ModelAPI 方法，已有真实请求 HTTP 500；
M01 `CurDCSLNUser` 查询缺当前 person/member 谓词，200 空集不能证明隔离。
见[契约审计](inspect-m01-m02-contract-audit-20261127.md)。

同类 `PSAppType`、`PSPF`、`PSPFStyle` 的真实 `FetchDefault` 契约已只读比对，
均为 POST/READ/FETCH/PAGE/FilterDTO/DTO；`PSDevCenter` 自身已有 Default
查询且只选六个非许可字段，但缺服务方法、生成来源、访问管理器和当前部署回读。
因此只能形成候选审计，不能复制方法或返回空数组。见
[ModelAPI 候选审计](m02-candidate-modelapi-inspector-20261127.md)。

进一步的 M02 candidate 仅生成结构提案并绑定实体、应用、ModelAPI 和 Default
查询哈希：`POST/READ/FETCH/Default`、`PSDevCenterFilterDTO` 到
`PSDevCenterDTO` 的 PAGE 返回；因缺权威 service generator/source，状态保持
`PREPARED-BLOCKED-SERVICE-SOURCE`，没有 deployable overlay 或共享写入。M01
只保留 `PSDEVUSEROBJID=sessioncontext.srfpersonid` 的可复用形状，ALLSYSFLAG、
过期、访问模式、系统 ID 和实时矩阵仍未闭合。

L03 权威闭合检查确认两处方法 DTO 声明和一处嵌套目标仍无字段来源；
逻辑输出键和动态 Map 不能替代模型字段。当前报告
`.artifacts/l03-authority-closure-20261127-r3/report.private.json` SHA-256
为 `918345a216cf32e182f2a8ceced6b85db9e72b36ede3737082eafbee0c52840b`。

K02/K03/O01 只读计划固定 K02/K03 为原生市场未执行阻塞，O01 为同宿主缓存
构建 partial；本地 ZIP/store 安装、更新回滚和网络 guard 均没有被升级为原生
市场或干净主机完成。见[K02/K03/O01 计划](K02-K03-O01-CLOSEOUT-PLAN-20261127.md)。

11 月 27 日的新 runtime 候选已重新双构建并严格回绑 producer：
9,326 个完整交付文件和 26 个复制分发文件均逐字节匹配，当前导航源码提交为
`30163825`。只发布 runtime、import map 和两个宿主 index，apply 回执为
`.artifacts/plm-lifecycle-apply-20261127-r3/report.private.json`；
SHA-256 为 `0ce306170f5fd6ff669c23a52aea6e0e40381d26fec1245e4f4206ab52a669f9`。
首个缺少 epoch 的 apply 命令在写入前拒绝，回执另行保留，未产生共享写入。

新 r7 原生宿主四格均为 `PASS-CURRENT-NATIVE-CELL`，四份证据位于
`.artifacts/current-native-api-documentation-20261127-r7/`：
中文/English 桌面/手机均通过真实嵌入、runtime 字节加载、刷新、深链和零原始
console/page/request/HTTP/capture 错误。中文桌面额外完成真实产品 POST/GET/PUT、
匿名 GET/PUT 401、完整产品/成员/接收者消息副作用快照和精确清理；其余三格保持
只读。该四格仍只关闭宿主与代表性 API 子门，角色矩阵与完整 B03 仍开放。

随后六角色真实 UI 角色门通过：普通成员、产品对象管理员、只读成员、非成员、
跨组织用户和组织所有者账号均由正常登录建立会话；成员角色读回为
`user/admin/reader`，非成员和跨组织账号无产品成员。需求对象的允许读、两种
允许更新、三种拒绝更新、`/ideas/save` 与 DELETE 拒绝、跨会话读回、完整通知
基线和精确清理均通过。第二次回执启用同一自有数据范围的 `START TRANSACTION
READ ONLY` 快照，9 个拒绝操作的序列/IDEA/VERSION/RECENT/消息计数保持不变，
`sqlWriteCount=0`，回执 SHA-256 为
`9fbfbe75be58aab0f4e3dbd33b1dd53bd02c7c1bc1ca5b3bad9da40310c098f0`。
该门仍未建立受限组织管理员，也未验收 Modeling IDE realtime，因此 B03 保持
PARTIAL。

私有原始报告、账号、业务数据和备份均不进入 Git。原有失败回执不改写。
本批复用现有 Docker，没有 pull 镜像或创建/重建容器。

## 待决策/阻塞

未列新增证据的行沿用总表检查点，不表示本轮重复执行了旧流程。

| ID | 状态 | 下一项具体实现或验收门槛 |
| --- | --- | --- |
| F06 | PARTIAL | 在现有六身份/十二 GUI 格基础上补受限组织管理员、个人目录共享政策、撤权及完整配置生命周期；不能由个人偏好写入外推系统配置写权。 |
| M01 | ACTIVE | 正常身份下取得真实非空中心成员数据；修复原生中心 FetchDefault 的模型/API 合同，再验中心选择、管理、非成员拒绝和双语视口。 |
| M02 | ACTIVE | 为真实账号建立合法开发者/中心管理授权，完成五实体原生 CRUD；三个配置目录已有非空读回，官方来源/导入仍独立验收。 |
| M03 | ACTIVE | 修复实际编辑流程的浏览器错误/守卫请求，补八组合编辑器、持久化和新会话读回；保留此前四次 PUT 的失败整格。 |
| M04 | OPEN | 建立 viewer 非空自有数据，补完整布局、导航、直接 API 拒写和 48 行角色矩阵。 |
| A01 | PARTIAL | 新源码快照绑定下重跑网关登录与 fixture center；完成 12 absent-root、36 native typed-root HTTP 案例，不能沿用旧 String-root 回执代替。 |
| A02 | BLOCKED | 在明确的权威角色/修订协议下验 WXMP 权限刷新、后台能力撤权、同 token、多节点/事务可见性与延迟；393 项源码回归不代替共享运行。 |
| A03 | BLOCKED | 完成实际 Servlet 部署、剩余后台调用方、外部/手工事务与后续任务生命周期；保留真实 Spring/JDBC/H2 suspend/resume 和错误处理子范围。 |
| A04 | PARTIAL | 现有原生非人 client 授权、自然过期、续发、撤销和清理之外，补 Cloud 下游、最小服务 scope、密钥轮换及多节点。 |
| B01 | PARTIAL | 修真实 Wiki 入口及最小访客读权限，禁止整个通用 ServiceAPI 匿名化；补密码/撤销/过期/子集/附件，再补项目、测试、知识的全角色流程。 |
| B02 | PARTIAL | 将已验证的人员选择器/码表/头像源码候选绑定实际插件字节，完成 73 插件的原生持久化、角色与完整业务生命周期。 |
| B03 | PARTIAL | 已完成新构建、新发布、新原生四格和六角色需求对象读写/拒绝、只读物理副作用快照；仍缺受限组织管理员与 Modeling IDE/Data Model 独立能力，故父项未关。 |
| B04 | PARTIAL | Data Model 与 Modeling IDE 各自正常账号原生 CRUD、宿主集成、独立 IDE 实时日志及恢复；PLM MQTT 通过不能替代 IDE。 |
| L01 | PARTIAL | 将已提交词条绑定实际运行版本，继续业务模型、弹窗、空态、格式化输出及完整语言名册；3209 个工作树候选不是验收完成率。 |
| L02 | PARTIAL | 补其余插件、错误、导出和嵌入 IDE 的双语；人员错误/重试与动态码表候选需实际发布后原生验收。 |
| L03 | PARTIAL | 权威审计已确认两处方法 DTO 声明和一个嵌套目标没有字段来源；需先补模型/DYNAMODEL并可重放生成，再做客户分数 action/HTTP和角色读回。 |
| D01 | PARTIAL | 补其余最低 12 组件范围的完整源码构建，以及第三方依赖、编译器和工具链的递归来源与重建。 |
| D02 | PARTIAL | 把全范围源码、生成输入、构建产物、镜像/挂载和实际 HTTP 连起来；窄 runtime/文档/provider 发布只覆盖明确文件。 |
| D03 | PARTIAL | 闭合未挂载源码、缓存、动态配置、构建等价及服务输入；继续拒绝实际 Mounts 内容漂移，数组排序变化单独归一化。 |
| K01 | PARTIAL | 取得增量同步可信精确来源，核对全部 23 catalog 的安装 revision、许可证、递归依赖和宿主源码；恢复两个仓库不等于该门完成。 |
| K02 | PARTIAL | 只读计划确认真实断网包仅完成文件安装子范围；原生市场登记、模型合并/重载、资源和真实业务/权限读回仍未执行。 |
| K03 | OPEN | 只读计划确认原生市场 revision 更新、失败恢复、运行重载和业务关系回读均未执行；文件 CAS/SIGKILL/本地回滚不能代替。 |
| O01 | OPEN | 在干净主机断网重建完整组件与工具链，重放服务并验收；同宿主缓存依赖七包双构建仅为新子证据。 |
| O02 | PARTIAL | 完成整栈备份、恢复、迁移、回滚及数据/模型/配置一致性；三个消息表的克隆恢复不外推整栈。 |
| O03 | OPEN | 扩展到完整共享发布范围和多角色回归，验证每项精确回滚与恢复；窄发布成功和失败恢复均保留，独占协作锁不冒称文件系统 CAS。 |

知识访客门还需要同时解决响应裁剪和有效授权：旧静态入口需配置用户名/密码，
通用 API 又含正文写入及草稿动作，内部分享信息会复制密码字段。
不能靠发布旧凭据、复用所有者身份或打开全 namespace 来换取页面成功。
当前仅准备了清空旧匿名凭据、保持访客禁用的静态候选，未将它当作分享实现。
