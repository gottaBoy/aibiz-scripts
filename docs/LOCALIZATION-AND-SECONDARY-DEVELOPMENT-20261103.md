# 全量本地化与二开现状

盘点日期：2026-11-03。本轮只读核对本地源码、Git、构建入口、目录、既有证据及当前部署；没有查询上游最新版本，没有安装市场应用、重建候选或重启服务。本文是当前差距分析，不是本地化完成或发布验收证明。

## 一、结论与口径

2026-11-06 冷备恢复更新：双中心、同中心各 188 项真实 HTTP 检查及独立审计通过，合计四次删除旧卷后的物理冷恢复、四次 provider 重启及六用户新登录回读通过。每次新卷启动前逐项核验 2,461 个文件和 13 个目录，业务数据、SQL 授权、成员只读投影及原始资源报告保持一致；探针经原生 API 删除，MODELVER 各库仅从 816 增至 819。当前代码全量脚本 4,558 项通过，账本仍为 6 FAIL / 3 WARN。详见 `OWNED-MYSQL-COLD-BACKUP-RESTORE-20261106.md`。这仍是同机、同版本、停库的隔离夹具演练，未验收生产备份、异机副本、宿主机/断电恢复、英文、市场离线交付或全部源码闭包。

2026-11-05 容器重建更新：新增独立的 MySQL 替换记录链，不改写原始资源报告。双中心、同中心各 188 项实际 HTTP 检查及独立审计通过，合计四次删除重建 MySQL、四次 provider 重启及六用户新登录回读通过；同一磁盘卷、数据库 UUID、原始配置及私网地址均保持不变。探针经原生 API 删除，MODELVER 各库仅从 816 增至 819，成员关系、SQL 授权及只读投影复核通过。当前代码全量脚本 4,512 项通过，实时账本仍为 6 FAIL / 3 WARN。详见 `OWNED-MYSQL-CONTAINER-RECREATION-20261105.md`。宿主机重启、断电、备份恢复、英文覆盖、市场离线交付、插件行为和原始源码闭包仍未验收。

2026-11-05 磁盘重启更新：新增独立的自有本地卷 profile，不放宽原 tmpfs 约束。双中心、同中心各 188 项实际 HTTP 检查全部通过，合计四次 MySQL 同容器磁盘重启和四次 provider 重启后的六用户新登录回读通过；真实卷路径位于本地 NVMe/ext4。探针均经原生 API 删除，完整物理字段、成员关系、只读投影及授权经独立复核。当前源码全量脚本 4,474 项通过，实时账本仍为 6 FAIL / 3 WARN。详见 `OWNED-MYSQL-VOLUME-RESTART-20261105.md`。这不是容器重建、宿主机重启、断电恢复或全量本地化验收；英文、市场离线安装更新、插件行为和原始源码闭包仍未完成。

2026-11-05 原生模型读写更新：已用真实 dump/模型兼容计划补齐夹具结构，双中心 164 项、同中心 182 项实际 HTTP 检查全部通过，覆盖普通编辑者/只读/无权限用户、跨物理库拒绝、伪造系统标识规范化、原生 CRUD 和新登录回读。同中心还通过两次自有 provider 进程重启后的回读。探针已由原生 API 删除，每个库仅保留预期的三次模型版本审计递增。20 个探索/最终运行的临时容器及网络均已审计清理；最终验证阶段共享 16 个容器生命周期/挂载未变。详见 `NATIVE-MODEL-CRUD-20261105.md`。这不是全量本地化完成证明，数据库磁盘持久化、全部权限维度、英文覆盖、市场离线安装更新和原始源码闭包仍未验收。

2026-11-04 成员投影更新：已通过锁定的本机只读投影账户，把真实 UAA 成员关系以四列、不可更新视图提供给 EBSX；运行账户写视图、直读 UAA 成员表或密码表均实际被拒绝。矩阵已补上正常 `/appdata` 初始化，六个普通用户全部返回 200 且身份/中心/组织匹配。当前推进至 44 项通过、1 项失败：模型权限管理器已执行，但方案视图 LEFT JOIN 依赖的元数据表尚未完整初始化，返回 500。未补占位表或提升权限，未启用探针写入。详见 `OWNED-UAA-MEMBERSHIP-PROJECTION-20261104.md`；完整权限、持久化、插件离线交付及英文覆盖仍未完成。

2026-11-04 ModelDesign 路由更新：已用候选包内真实工厂与路由生成器验证 provider 的应用开关和模型绑定路径，隔离环境的 404 已解决。标准应用路由本就需要转换到模型绑定的 ModelAPI，上一轮“直连 provider 也 404”不能独立排除路由配置问题。实际矩阵仍为 38 项通过、1 项失败，但失败已变为应用人员上下文尚未建立时的 403；按真实 UAA 组织调用 `/appdata` 后，进一步定位到 EBSX 授权 SQL 跨库引用 `SYS_ROLE_MEMBER`，该表只在独立 UAA schema 中存在。未造空表、注入缓存上下文或提升用户权限。最终脚本 4,409 项全通过，8 个临时服务容器、9 个具名辅助容器和 1 个隔离网络已清理，共享 16 个容器生命周期/挂载未变。详见 `OWNED-MODELING-APPLICATION-ROUTING-20261104.md`，插件、英文、持久化及全量权限验收仍未完成。

2026-11-04 EBSX 更新：已按候选包内真实模型及 Liquibase 适配器初始化独立 schema，核验 78 张业务表、1,289 列、150 个普通索引及主键；迁移账户已删除，CRUD 运行账户验证通过且无建表权限。修正隔离 Nacos 的 YAML 格式后，三项后端服务通过传输/致命启动错误检查，六个普通用户的后端登录与令牌自查通过。但真实矩阵停在应用级 API 404，直连 provider 同样复现，尚不能认定权限或业务功能通过；未启用探针写入。详见 `OWNED-EBSX-SCHEMA-20261104.md`。插件离线交付、英文覆盖、源码完整性和持久化仍未完成，以下旧阻断按各自检查点保留。

本轮收尾：最终脚本 4,391 项、聚焦契约 145 项全部通过；18 个临时服务容器、5 个具名辅助容器和 1 个隔离网络均已确认不存在。共享 16 个容器的身份、启动时间、重启次数和挂载未变；前端部署检查仍为 4 项通过，实时账本仍为 6 FAIL / 3 WARN，未提升本地化或发布验收状态。

2026-11-04 工作流更新：已用候选包内的同一套引擎初始化独立 38 表 workflow schema，并用无 DDL 权限的运行账户关闭自动建表后重启、执行和清理测试流程。实际后端已越过 Flowable 初始化，当前首要阻断转为 EBSX 缺少 `jobs_info2` 等完整 schema；`owneduaa` 查找错误发生于连接池关闭之后，尚不能判定为独立映射故障。详见 `OWNED-WORKFLOW-SCHEMA-20261104.md`，原始失败证据未改写。

2026-11-04 更新：独立 ZooKeeper 已接入并通过真实 standalone 就绪检查；新的后端启动门禁会拒绝 HTTP 先响应、ApplicationRunner 后失败的情况。当前阻断转为 Flowable schema/定制依赖版本和 `owneduaa` 数据源绑定，尚未进入权限、重启和持久化验收。详见 `OWNED-ZOOKEEPER-AND-STARTUP-GATES-20261104.md`；本日新 fixture 的 18 个临时服务容器及网络已清理，共享 16 个容器未变。

当前是“已有多条本地源码构建路径、可以开展部分二开”的工作区，不是“全部源码可维护、可从干净环境离线重建并交付”的完整开发套件。

“都要本地化”需要同时满足以下维度，不能互相替代：

| 维度 | 完成条件 |
| --- | --- |
| 源码 | 自有组件有固定维护目录，标明上游原始源码、发布包附带源码、重构源码或仅二进制 |
| 来源 | 每个组件关联仓库、commit、许可证及本地修改；未确认的来源不能推定已获授权 |
| 构建 | 工具链与依赖固定，干净目录能从源码构建，不借用历史自有编译产物 |
| 交付 | 当前源码、构建输出、镜像、实际服务字节一一绑定；支持回滚 |
| 离线 | 目录、图标、说明、包、构建依赖和运行依赖有本地路径，并通过断外网验证 |
| 功能 | 真实操作、普通用户权限、跨库拒绝、重启及数据持久性通过 |
| 语言 | 平台提供的界面、插件、消息和文档支持中英文；用户业务数据保留原文 |
| 二开体验 | 知道修改哪里、怎样构建和调试、生成代码怎样避免覆盖手工修改 |

第三方开源库不需要全部重写，但需要版本、校验值、许可证、本地依赖缓存/镜像和可重建说明。地图、外部 SSO、AI 服务等外部能力不能靠复制静态文件变成离线服务，需另定本地替代或明确禁用方案。

## 二、组件矩阵

| 范围 | 已有基础 | 尚未完成的关键项 |
| --- | --- | --- |
| PLM 业务模型 | `plm/model` 有本地模型；应用和服务有挂载路径 | 模型、生成器、生成前后代码和数据库迁移缺少统一版本关系及干净重生成验收 |
| PLM Web | `plm-web/src` 可编辑、有构建和本地部署入口；共享依赖链接到 Hub | 生成代码覆盖保护、全插件功能/语言覆盖、干净环境构建和离线验收 |
| PLM 73 个运行时插件 | 73/73 有对应本地源码输入和发布目录；本轮输出检查 73/73 通过 | 多数是 bundle 重构；逐包类型、行为、语言、来源和独立构建证据未全部闭合 |
| 前端公共框架 | `ibiz-app-hub`，PLM/Modeling 显式链接 14 个公共包/插件 | 跨应用变更影响、工具链和实际发布输出需持续绑定；不是所有链接包都具有独立 JS 包 |
| Modeling Web | `modelingweb/app`、本地替代插件及 Central/ModelDesign 候选 | 原生编辑器全流程未验收；本轮部署检查 3 通过、1 失败 |
| 原生设计器链 | `modelingweb/local-plugins`、部分 vendored 源码和 source-build 工具已存在 | `console-terminal` alpha.87、`layout-design` alpha.90 原始源码缺口；替代实现不能证明原包完整兼容 |
| PLM 后端 | `plm/backend` 有业务 Groovy、DTO、逻辑与本地构建入口 | 当前部署缺少完整源码提交绑定；六模块递归源码检查不是全部运行依赖构建证明 |
| 平台/Modeling 后端 | 当前源码已完成隔离 package（317 个正向测试）和 allinone/gateway/provider 三镜像候选绑定 | 候选尚未完成隔离整栈验证和主服务切换；运行版本仍与当前源码/标签存在漂移 |
| UAA | `standalone-uaa/source`、`starters`、`tools` 为维护目录；有源码构建及隔离安全回放 | 兼容重构而非认证原始源码；目录未纳入 Git；主 UAA 部署来源未绑定，整栈验收仍缺 |
| Task | `task7/SAPAAS`、模板、Ant 和源构建镜像路径已存在 | 反编译修复来源、完整依赖/自有字节码闭环及真实生成/发布/运行案例仍需当前输入验收 |
| 23 个市场应用 | 20 个完整工作树、1 个仅 Git 对象、2 个在目标目录缺失 | 已安装 revision、源码构建产物、市场安装/升级/回滚和离线能力均未逐项绑定 |
| CLI 与生成链 | 三个精确 CLI/core 版本有源码获取与隔离构建记录 | 主要获取/构建快照仍在 `.artifacts`；需明确固定维护位置，核实完整前端生成器与模板来源 |
| 移动端/Wiki/辅助服务 | Compose 仍声明 `plmmob`、`plmwiki`、`ibizcode`、`emqx-api` 等 | 多项默认引用外部预构建镜像，不能计入桌面端源码完成；需单独核对源码和实际启用范围 |
| 基础设施/预览等能力 | MySQL、Redis、Nacos、ZooKeeper、EMQX 有本地运行配置 | 镜像/依赖完整离线供应、初始化、密钥管理、备份恢复、预览服务及重启持久性尚未统一验收 |

`modelingservice` 仓库与实际 provider 的 `ibiz-service-hub` 构建来源不能混用：文件夹存在不等于该目录是当前 JVM 的源码来源。`runtime-jars`、`runtime-analysis` 是观测/分析材料，也不等同于可维护源码。

## 三、应用市场逐项盘点

市场身份/安装状态取自本日实际本地 API 留存：
`.artifacts/plm-english-expansion-2026-11-03T11-47-28.603Z/marketplace-catalog.json`。
本轮另读本地 Git HEAD、origin、树清单和工作树，没有拉取或变更远端。

机器可读对应表：`MARKETPLACE-SOURCE-INVENTORY-20261103.json`。它是 observation-only 文档，不是运行配置，也不会自动修改安装来源或验收门禁。

| 市场应用 | `extensions/upstream` 目录 | 当前源码状态 | 市场状态 |
| --- | --- | --- | --- |
| 标准逻辑设计器 | `logic-design-standard` | Git 对象 2,950 文件，工作树未检出；2 组大小写冲突 | 已安装 |
| 标准表单设计器 | `form-design-standard` | 工作树及模型/Java 源码存在 | 已安装 |
| 标准视图设计器 | `view-design-standard` | 同上 | 已安装 |
| 视图建立向导 | `app-view-creator` | 同上，另有 Groovy | 已安装 |
| 标准工作流设计器 | `workflow-design-standard` | 工作树及模型/Java 源码存在 | 已安装 |
| 标准应用菜单设计器 | `menu-design-standard` | 同上 | 已安装 |
| 标准 ER 设计器 | `er-design-standard` | 同上 | 已安装 |
| 标准表格设计器 | `grid-design-standard` | 同上 | 已安装 |
| 标准工具栏设计器 | `toolbar-design-standard` | 同上 | 已安装 |
| 标准数据查询设计器 | `query-design-standard` | 同上 | 已安装 |
| 标准树部件设计器 | `tree-design-standard` | 同上 | 已安装 |
| 标准数据流设计器 | `data-flow-design-standard` | 同上 | 已安装 |
| 标准多数据部件设计器 | `md-design-standard` | 同上 | 已安装 |
| 标准看板设计器 | `dashboard-design-standard` | 同上，另有 Groovy | 已安装 |
| 标准属性值规则设计器 | `value-rule-design-standard` | 工作树及模型/Java 源码存在 | 已安装 |
| 标准图表设计器 | `chart-design-standard` | 同上 | 已安装 |
| 标准智能报表设计器 | `bi-design-standard` | 同上 | 已安装 |
| 关系数据库导入 | `db-schema-importer` | 同上，另有 Groovy | 已安装 |
| 模型透视工具 | `model-perspective-tool` | 工作树及模型/Java 源码存在 | 已安装 |
| PLM 协作插件 | `modeling-plm-plugin` | 同上，另有 Groovy | 禁用 |
| 系统维护工具 | `modeling-maintenance-tools` | 模型、66 个 Java、5 个 Groovy 文件 | 已安装 |
| Modeling 模型素材仓库 | `model-library` | 此目标目录不存在，未确认其他位置有可用源码 | 未安装 |
| 模型增量同步工具 | `iBizModelIncrementSync` | 此目标目录不存在，未确认其他位置有可用源码 | 未安装 |

关键边界：

1. `extensions/upstream` 共 22 个 Git 目录，不是市场 23 项已全部本地化。其中额外的 `ibizmodeling-standard` 是平台模型仓库，不是第 24 个市场插件；它有 17,437 个 Git 树文件、12 组大小写冲突，工作树也未检出。不得覆盖这些现有目录强制检出。
2. 20 个有内容的市场工作树本轮均为干净状态，origin 与对应 Gitee 地址相符；包括逻辑设计器在内的 21 个市场 Git 快照均有 `MIT License` 声明。声明、origin 和 commit 不等于完整授权链或已安装版本相同。
3. 这些仓库主要包含 JSON 模型、少量 Java/Groovy 和 Maven 描述；本轮 Git 清单没有 TS/TSX/Vue 文件。**模型源码在本地，不代表图形设计器前端实现也在这些仓库里。**
4. 20 个市场快照的根 POM 固定 `ibiz.cloud.version=8.1.0.542`；系统维护工具为 `8.1.0.336`。主平台当前源码线为 `8.1.0.584.1`，且 Maven 坐标也需核对，不能通过批量替换版本号推断兼容。
5. 23 项中 20 已安装、1 禁用、2 未安装；留存 API 没有提供可绑定的已安装源码 revision，不能用当前 HEAD 冒充安装版本。
6. 23 项仍暴露远端 repository 和 icon 引用。现有本地目录并未证明市场已从本地读取安装包、README、图标或更新。
7. `PSCorePrdRTService.getV2ProjectListConfig()` 支持本地 `market/projects.yml`，但目录配置本地化后，`PSCorePrdFuncRTService.doGet()` 的 README/CHANGELOG 路径仍需单独处理；安装/升级还需核对后端 checkout/合并链。

## 四、PLM 插件的真实维护程度

本轮直接解析 `plm/model/PSSYSAPPS/plmweb/PSSYSAPP.simple.json`：

- 79 处引用、73 个唯一精确包，与 `runtime-plugins.txt` 完全一致，无无效引用。
- `public/plugins` 实际 131 个包目录，其中 58 个不被这个应用模型直接引用。它们可能被其他模型/功能使用，本轮不删除。
- `plugin-src` 实际 74 个包目录：73 个 PLM 包加一个原生 `logic-tree-design`。
- 73 个对应源码/版本均存在且一致，包清单均声明 MIT；只有 cron-editor 缺少 `gitHead`。
- 恢复分类沿用 `tools/plugin-recovery/README.md`：1 个上游源码、9 个拆分重构、63 个 bundle 级重构。**73/73 可编辑输入不等于 73/73 原始源码。**
- 9 个包进入专门类型策略，其中 4 个 strict、5 个诊断 baseline；不能声称 73 个包均通过严格类型检查。
- 本轮 `node tools/build-plugins.mjs check` 的 73/73 通过是输出结构/导出等静态检查，不是重新编译 73 包，也不是完整功能回归。

二开优先继续拆分高频交互组件、补类型及行为用例，随后覆盖编辑器、甘特图、流程、图表等复杂路径。保留原包观测和差异说明，不把重构源码改标为原始源码。

## 五、修改入口与构建陷阱

| 要改什么 | 维护入口 | 需要同时核对 |
| --- | --- | --- |
| 实体、视图、表单、代码表、逻辑 | `plm/model` | 对应生成 TS/Groovy、数据库迁移及权限 |
| PLM 壳层、路由、语言和显示适配 | `plm-web/src`，尤其 `src/locale`、`src/runtime` | 生成目录不要作为唯一修复来源 |
| 73 个运行时插件 | `plm-web/plugin-src/<scope>/<name>` | 精确版本的 `public/plugins`、app dist 和 HTTP 实际字节 |
| 通用控件/框架 | `ibiz-app-hub/packages`、`components`、`plugins` | PLM 与原生 Modeling 都是消费者 |
| 原生本地替代组件 | `modelingweb/local-plugins` | migration contract、依赖 build receipt、候选输出和实际服务 |
| 后端业务逻辑 | `plm/backend/plm-core` 等 | Groovy 版本、模型与运行时是否覆盖本地逻辑 |
| 平台权限/市场/服务运行时 | `ibiz-service-hub` | allinone、gateway、provider 的依赖和整栈回归 |
| 登录、Token、用户/角色 | `standalone-uaa/source`、`starters` | 真实 TokenStore、SQL 模型、Redis、当前镜像身份 |
| 生成/发布任务 | `task7/SAPAAS`、`TEMPL_APP`、`TEMPL_TASK` | 模板、完整依赖、真实输出和后续启动 |
| 市场扩展模型/服务 | 对应 `extensions/upstream/<slug>` | 应先建立受控维护分支和 installed revision 对应关系 |

需要明确的现有行为：

1. PLM 的 `pnpm build` 先构建 Hub 的 ai-chat/bi-report/data-view/gantt 四包，再构建应用；**不会自动重建 `plugin-src` 的 73 个运行时插件**。改插件要先执行精确包的 `plugins:build:one` 或 `plugin:regression`，再构建应用。
2. `pnpm deploy:local -- --plugin <精确包引用>` 已支持显式插件构建、应用构建和部署字节核对，但会重启指定前端容器；本轮未执行。
3. PLM 与 Modeling Web 的 Dockerfile 均复制现成 dist。Docker 镜像构建成功，只说明打包成功，不等于源码编译已在 Docker 内完成。
4. `plm-web/package.json` 的 `pub:code` 和 `compute:pkg` 仍有原开发者绝对路径；`src/publish` 的手工改动可能在重新生成时覆盖。需在隔离输出目录重生成、评估差异，再修模板或建立补丁层，不能直接运行覆盖当前工作树。
5. pnpm 主版本有意不同：PLM/Modeling 为 8.15.9，Hub 为 10.13.1。现有脚本通过 Corepack 选择对应版本，不要用一个全局 pnpm 强行重写所有 lock。
6. 历史构建目录只作证据，不应成为唯一可修改源码位置。CLI、部分 vendored 候选和 UAA 的依赖缓存仍需补迁移/获取说明，保留既有 hash 及来源。

## 六、当前阻断与未完成验收

本轮只读复核：

| 检查 | 结果与解释 |
| --- | --- |
| 版本账本，2026-11-03T13:42:25Z | 6 FAIL、3 WARN；四项 allinone/gateway 当前源码漂移、主 UAA 来源未绑定、Modeling tag/运行镜像不一致；新候选尚未部署，故账本不自动变绿 |
| Native 部署，2026-11-03T15:02:03Z | 4 PASS、0 FAIL；新的 route-picker source/build/output receipt 已绑定当前字节；映射仍是 `blocked`，因为原始来源、兼容性和原生运行证据仍未完成 |
| PLM Groovy 递归源码检查 | 6 模块、4,385 源文件，存在性/坐标检查通过；输入仍是既有 dependency tree，不是新 Maven 全运行依赖解析或重构建 |
| Git | 8 个主要工作仓库有未提交项；`standalone-uaa` 不在 Git 内，不能称最新修复已全部提交 |

route-picker 的新独立构建和迁移绑定已经完成，证据目录为
`.artifacts/canonical-migration-source-build/route-picker-refresh-20261103T150151Z-ae9d79be`；
Native deployment 只读复核为
`.artifacts/native-deployment/route-picker-refresh-20261103/report.json`。
它没有提升原始来源、兼容性或原生验收状态。主后端仍不能为使账本变绿而直接改标签或重启。

本日已有但本轮没有重跑的阶段证据：

- 英文扩展：131 个前端契约、lint 零警告、最终部署内容专项 17 个浏览器测试；较早 83/35 个测试发生于最终小改动前，不是最新全量验收。
- ARM64 隔离数据库：same-center/two-center 各 55 SQL + 32 应用账户检查；独立 UAA Boot/MySQL/Redis 17 项安全检查。
- 平台候选：当前源码新 package 99 模块、317 个正向测试，三镜像均为 arm64 且已绑定 receipt；候选并未取代主服务。证据见 `scripts/docs/BACKEND-ALIGNMENT-20261102.md`。
- scripts 4,302 通过的历史 checkpoint 早于最新 route-picker 指纹漂移，不能据此宣布当前全项目全绿。

尚缺应用 HTTP 跨物理库权限、整栈隔离启动、真实编辑保存/新登录回读、全部插件行为、重启持久性及统一断外网验收。新的隔离 UAA launcher 已接入真实 TokenStore witness、显式账户报告，16 项实际检查通过；当前后端实际启动停在 UNISTATE 缺少 ZooKeeper 地址。EBSX schema、独立 ZooKeeper、UAA 服务别名和服务 OAuth 凭证仍需闭环，详见 `OWNED-UAA-BACKEND-INTEGRATION-20261103.md`。短 TTL 临时 fixture 不是持久化或主 UAA 部署证明。

D01 必需组件下限仍是 12 项：uaa-standalone、task、modeling-backend、plm-backend、allinone、gateway、plm-frontend、modeling-frontend、app-framework、modeling-plugins、runtime-model、native-cli；这是下限，不包含本轮新增的全部市场与辅助服务范围。

## 七、离线和英文仍需补齐

离线应分别验证“依赖准备、干净构建、运行、市场安装更新”，不能只测首页缓存：

- 市场 Git、图标、README/CHANGELOG、包/模型及安装合并链。
- npm/Maven/CLI/template 依赖和 Docker 基础镜像。Modeling `.npmrc` 仍默认指向原内网 registry；其他工作区还有公共镜像源。
- worker、字体、编辑器动态 chunk、文档图片及预览资源；不能把 SVG namespace 或注释链接误报为联网。
- 框架默认 plugin/studio 地址须核对最终配置是否覆盖；源码中有旧默认值不等于当前已发生外联。
- AMap、钉钉/微信 SSO、AI、文档预览等需逐项标注外部能力与本地替代边界。

英文已有 1,076 个显式词条，最新静态扫描仍有 3,802 个未映射的不同显示标签。这个数字包含内部 caption，不能当作用户界面缺失比例。市场卡片翻译只覆盖目录呈现，不包含 23 项内部界面/说明、全部插件及后端错误。

后续应由共享语言资源与模型显示适配统一管理，按实际业务页面、弹窗、错误/空态、市场详情和插件操作验收；不翻译 ID、状态值、用户名称及用户文档。

## 八、执行顺序与完成标准

| 顺序 | 工作 | 退出条件 |
| --- | --- | --- |
| P0 | 固定二开基线 | 按归属审查未提交改动；UAA 纳入受控版本管理；建立跨仓库 commit+dirty fingerprint+模型+依赖+镜像清单，排除密钥/运行数据；不把不相关改动打成一个提交 |
| P1 | 市场源码/版本闭环 | 以 23 个 catalog ID 为主键，补 installed revision、模型/前端/后端依赖、license；在新目录处理逻辑设计器大小写冲突，合法获取两个缺项；先选一个普通插件验证全链再推广到全部 |
| P2 | 市场交付与源码补全 | 显式本地 catalog、受控本地 Git/包/图标/说明；核对真实后端安装路径；在隔离库验证安装/升级/回滚/重启；缺源码包继续保留阻断，不伪装成已恢复 |
| P3 | 修复共享依赖和部署绑定 | route-picker 当前源码/构建绑定已刷新；后端当前源码 package/三镜像候选已生成；下一步仍需完成 Native 候选的兼容性与运行证据、12 组件及市场依赖的干净源码构建；隔离启动候选后端，完成普通用户跨库权限与持久性，再安排受控切换 |
| P4 | 整理二开与中英文体验 | 生成模板/补丁覆盖保护、固定 CLI 维护入口、逐插件类型/功能/语言矩阵；移动端/Wiki/辅助服务各自验收，不被桌面测试代替 |
| P5 | 独立环境交付 | 无历史 `.artifacts` 自有编译产物兜底，固定依赖离线重建；断外网完成市场操作、重启、备份恢复、升级回滚及桌面/移动回归；所有范围有逐项证据 |

最终交付应包含：源码维护地图、版本/来源/许可证清单、本地构建和调试命令、生成器与模板说明、市场镜像及安装包、初始化/迁移脚本、密钥模板、离线依赖包、镜像清单、功能与权限回归、备份恢复和升级回滚手册。

上述范围逐项验收前，不给出“全部本地化”结论，也不把测试数量换算成项目完成百分比。
