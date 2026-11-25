# 多 Agent 执行清单

检查点：2026-11-22，Asia/Singapore；本文件保留 11 月 21 日原批次及后续记录。

按最新已提交回执整理的中文入口见 [25 项待办](REMAINING-25-20261111.md)，
包含分组、逐项关闭条件、协议/数据阻塞及执行顺序；本次整理不新增验收或关单。
后续 [多 Agent 实现](MULTIAGENT-IMPLEMENTATION-20261122.md)已补 M01/A01/M02
前置源码与受控测试；遵循用户最新约束复用现存 Docker，不重新创建、不 pull 镜像。
最新 [全 25 项实现记录](ALL25-IMPLEMENTATION-20261122.md)另含 A02/A03、
全局配置授权、业务双语、文档全文搜索、离线交付和原 UAA 日志目录修复。
本文件下方早期批次及其失败保留原范围，最新运行状态以该记录为准。

仍为 **30 个顶层项中的 5 项已有验证记录、25 项未完整验收**。
本轮完成下列四个具体子任务，不将其误计为四个顶层关单。
原始矩阵见 [ALL-TASKS-20261111.md](ALL-TASKS-20261111.md)。

最新批次见 [收敛执行记录](CONVERGENCE-20261121.md)：当前源码完整打包和三张
镜像已绑定，R05/A01/前端交接代码已兼容。修复读取权限竞态后，最新完整校验
单次实测为 14.7 秒；实际 HTTP 和整个 token 调用链仍未验收。

## 收敛范围与估算

当前状态为 16 项 PARTIAL、3 项 ACTIVE、4 项 OPEN、2 项 BLOCKED。
25 项是尚未完整验收的能力组，不是 25 项全新开发；不能把 25/30
换算成剩余代码比例。清单下方的具体子项通过也不自动关闭父项。

低置信度工程估算为 **约 30-50 人日，三线并行约 3-6 个工作周**。
这是按现有差距作出的规划区间，不是交付承诺；不含企业集成凭据/接收账号、
源码许可/缺失依赖等待及受控发布窗口等待。仅增加 agent 数量不能消除串行的
owned 环境、数据准备、事务协议和发布恢复门槛。需在首个完整 owned
运行/HTTP 批次后重新估算。

| 工作组 | 顶层项数 | 估算依据 |
| --- | --- | --- |
| F06/M01-M04 原生功能 | 5 | 自有配置/数据准备、非空读写、跨会话恢复和完整角色矩阵 |
| A01-A04 安全 | 4 | 非法根分层、撤权协议、嵌套事务、服务 token 的源码接线与真实拒绝 |
| B01-B04 业务与编辑器 | 4 | 手册生命周期、73 插件状态持久化、文档执行及真实内嵌 CRUD |
| L01-L03 双语 | 3 | 可见词条分类、业务/错误/导出、DTO/序列化与嵌入 |
| D01-D03 来源 | 3 | 递归依赖/构建、传递资源及实际服务来源 |
| K01-K03 市场离线 | 3 | 精确来源许可、本地安装、更新故障与回滚 |
| O01-O03 重建与发布 | 3 | 干净环境重建、整栈恢复和受控共享发布 |

## 本轮已完成

| 分工 | 实际实现与验证 | 未覆盖边界 |
| --- | --- | --- |
| 登录布局 agent | 修复标题贴边与裁切风险：固定 24px、内侧留白和自然换行；新构建候选在 320/360/390/430/768/1280/1440/1920px 两种语言共 16/16 通过；正文行框、登录控件、横向溢出均检查，截图已抽查 | 登录后界面与共享服务部署 |
| R05 agent + 主任务编译 | 从四个权威模型生成仅私有的覆盖层，统一六处返回声明及两套五字段 BIGINT DTO；生成/漂移/越界测试 10/10；新原生解析测试 5/5，连同 reader/API 19/19；默认 portable 模型分支另跑 5/5 | 完整模型/运行包绑定、自动 runtime 选择、真实 HTTP、数据库计数及真实角色授权 |
| 插件来源 agent + 主任务全量核验 | 新只读审计工具比较模型引用的 73 个插件、356 个声明文件的 public/dist/HTTP 完整 SHA-256；共享基线检出 7 个插件/13 个文件差异；同一新候选 356/356 一致 | 传递资源、插件业务行为、源码闭包和共享发布 |
| 主任务语言回归 | 补普通取消按钮、取消后存储/HTML/可见标签不变、刷新保持、确认切换与切回；真实新候选 zh-CN/en × 桌面/手机 4/4 | 认证后双语业务流程、任意延迟任务的穷尽证明 |

共享差异的 13 个文件均为 **HTTP 与 public 一致、与旧 dist 不同**，不是
HTTP 404。本轮没有为了变绿而覆盖共享 dist、重启服务或忽略差异。
受影响插件为 attention、baseline-compare、grid-change-version-column、
html-vditor、lucky-sheet-editor、repeater-grid-case-steps 和 cron-editor。

前端实际候选包含保留的其他工作树输入，4,565 个 src 文件绑定于构建回执，
输出共 38,185 个文件；不是干净索引重建或完整依赖闭包。复用的组件 runtime
仍来自先前已验证的本地构建，未宣称本轮重新构建全部框架。

两个浏览器回归均未提交登录，实际 API 请求为零，console/pageerror/HTTP/
requestfailed/外网尝试集合为空；没有业务写入。临时浏览器与候选服务器均关闭。
两个编译助手顺序执行，均限 2 CPU/3GB、断网、依赖只读，均已删除；没有启动
业务验证栈、修改共享数据库或替换共享服务。

## 后续批次实际进展

本节与前一批次分开记账，不覆盖旧回执：

- R05 已接入完整 owned model staging，显式 `--r05-owned-model` 才启用，
  默认关闭。真实权威模型共 **17,199 文件 / 234,321,209 字节**成功
  staging，四个 R05 文件与三个系统上下文视图可组合；没有启动服务。
- binder 从权威 base、真实 R05/中央成员/context 输入自行推导完整输出，
  不接受调用方传入的期望文件集充当证明。候选、完整树、权限和挂载有变化
  均拒绝，JSON clone 不能伪造 in-process proof。
- 跨进程 context 现在重新建立 proof，不信任 deployment 中的旧 JSON；
  `requireR05Binding: true` 防止删除字段降级，精确限定本 deployment 的
  provider `/app/model` 只读挂载。相关 topology 测试使用受控 inspect，
  不是运行中的容器证明。
- 新 factory 测试使用真实磁盘模型、实际工厂选择及 App DTO getter；
  旧 VOID、重复/缺失声明和显式插件保留原策略。与原生解析/reader/API/
  mapper 一起，portable 和实际候选模型分支各 **38/38** 通过。
  新 App DTO 测试首次编译使用了不存在的 getter，失败回执完整保留；
  修正测试接口后重新编译，没有改生产逻辑迁就测试。
- A01 仍为 **84** 条：默认 HTTP lane 36 可派发/48 未派发；
  精确 opt-in `--include-parentless-absent` 可选择原生 MAJOR 路由上的
  12 条 absent，变为 48 可派发/36 typed 边界。每次 absent 探针需重新
  正常登录/self/appdata，拒绝复用任何之前已用于模型请求的 token，
  包括 A/B/A 回收。没有执行本轮真实 HTTP，启用不等于通过。
- 显式 null 现在确实设置 AppContext 键并证明其存在、值为 null；
  record/search 的 READ/UPDATE 经过真实异常映射为 403/ACCESSDENY，
  完整输入保持不变。分类器只关联源码，不声称执行了六账号运行矩阵。

R05 仍有明确运行门槛：完整文件重验耗时必须满足原生 20 秒 JWT 的派发预算；
不可通过延长 token、减少根授权或跳过字节校验消除失败。性能实测及原始
回执见 `records/aibiz-r05-a01-progress-20261121.json`。
无并行测试的完整 rebind 从 28.6 秒优化到 19.2 秒，仅消除相邻重复校验，
仍不足以保留 5 秒派发余量，因此未验收真实请求时序。最后联合 Node
回归为 **228/228**；与前一批次测试重叠，不累加成功能数。
该批次中的前端 owned handoff schema 不兼容及 A01 原始 ModelAPI 字节相等
限制，已由最新批次的显式 trusted R05 接线处理；未知字段、删字段降级或不可信
覆盖层仍拒绝。最新源码包/镜像绑定已有证据，完整源码闭包、已加载类及真实
五类计数、六项权限 HTTP 仍未验收。

## 全部 25 项待办

| ID | 状态 | 下一步及关闭条件 |
| --- | --- | --- |
| F06 | PARTIAL | 自有全局配置的组织/对象管理员、普通/只读/非成员正负向读写，以及撤权后旧会话回归 |
| M01 | ACTIVE | 历史两中心六账号读取回执保留额外人员头传输边界；新默认 HTTP 及正常 UI 入口已有源码/受控测试，待符合实际版本绑定后补正常选择/导航、跨中心隔离及管理员创建/普通成员拒绝 |
| M02 | ACTIVE | 先明确配置来源与合法维护/导入路径；普通配置 API 的 manager 仅准 READ，不能以增加管理员绕过。取得 PSPF/PSPFStyle/PSAppType 合法关联后完成五实体读写、关联与清理 |
| M03 | ACTIVE | 从正常 UI 完成各原生编辑器保存、刷新、跨会话读回、恢复及无权拒绝 |
| M04 | OPEN | 非空 viewer 成功、no-access/cross-root 拒绝及完整角色/root/语言/视口矩阵 |
| A01 | PARTIAL | 剩余 48 条拆为 12 条 absent 与 36 条 typed；parentless 两次启动失败，需先解决 owned Nacos 前置再跑 12 条 HTTP，另补 36 条忠实传输；保持默认 36 条拒绝及无副作用证据 |
| A02 | BLOCKED | 完成权威修订/请求重新授权协议、所有写入口接线和失败时拒绝，再验证同 token、多节点撤权 |
| A03 | BLOCKED | 完成嵌套会话及 REQUIRES_NEW 回调/事务协议，验证真实请求事务生命周期 |
| A04 | PARTIAL | 实际服务 token 交换、下游使用、拒绝、过期与撤销链路 |
| B01 | PARTIAL | 手册 MV01-MV14 自有数据多角色生命周期、版本、关联、报表、通知、恢复与清理 |
| B02 | PARTIAL | 73 插件逐项验证桌面/手机状态、读写/只读、错误/空态、刷新和持久化；不能以 356 个静态文件一致代替 |
| B03 | PARTIAL | Development/API Reference 真实检索、内容浏览、受控 API 执行及无权拒绝 |
| B04 | PARTIAL | 在真实 PLM 宿主完成 Data Model/IDE CRUD；R05 先明确两类插件合法范围授权并满足 JWT 调度，再验已加载 runtime、真实五类计数与六项独立拒绝；MQTT 独立验收 |
| L01 | PARTIAL | 分类历史可见文案候选，重跑完整语言命令门槛，保留失败/跳过而不折算为完成 |
| L02 | PARTIAL | 从已通过登录布局/切换扩展到认证后业务写入、插件、错误、通知、导出及内嵌视图 |
| L03 | PARTIAL | 权威补齐两处方法 DTO 声明及一个嵌套字段来源；验证运行 mapper/序列化与实际应用嵌入 |
| D01 | PARTIAL | 逐一闭合 12 组件的递归源码、依赖、构建和产物；不能用预编译 JAR 冒充 |
| D02 | PARTIAL | 从本轮候选 356/356 声明文件一致继续覆盖传递资源、来源和共享实际服务字节 |
| D03 | PARTIAL | 将未挂载脏源码、依赖及构建来源纳入清单，证明运行挂载与输出/HTTP 对应 |
| K01 | PARTIAL | 23 类市场目录的精确源码版本、许可及生成依赖可复现审计 |
| K02 | PARTIAL | 阻断外网的自有环境从指定本地包安装目录/资源并核对完整性 |
| K03 | OPEN | 同版本断网更新、故障注入、恢复/回滚及数据保持 |
| O01 | OPEN | 固定工具链、离线依赖、备份和配置，在全新自有环境离线重建 |
| O02 | PARTIAL | 当前整栈备份恢复、精确迁移、失败恢复，以及数据/权限/模型回归 |
| O03 | OPEN | 经审核候选/备份/回滚输入后受控发布，核验真实服务字节、业务、权限和回滚 |

## 后续执行顺序

1. 按用户最新要求复用现存 Docker；UAA 日志目录已原地修复并通过正常登录，
   不新建或替换环境。符合实际绑定后再补非空多角色 M01 与默认非 R05
   链路的 A01 parentless HTTP，历史限定范围结果保持原回执。
2. 明确 M02 配置合法维护路径后推进 M03/M04；F06/A04 按各自前置推进。
   R05 另需先解决插件范围授权与 JWT 调度，再验证自动选择、两组不同非零
   计数、空根及六项逐一拒绝，不能由可控依赖或源码工厂测试替代。
3. 以真实业务流程展开 B01-B04/L01-L03；并行补 D01-D03 与 K01 来源链，
   再运行 K02/K03/O01 离线验证。钉钉/企业微信须真实受控企业应用、用户绑定和
   接收账号；MQTT 须真实认证、代理、订阅 ACL、发布与断线恢复，不能模拟关单。
4. A02/A03 协议需独立安全/事务审查；O02/O03 需完整恢复计划与受控共享变更。
   在此之前不自动推广候选，不删数据卷，不运行全局 prune。

## 可重复命令

```sh
node scripts/prepare-r05-owned-model.mjs \
  --output .artifacts/r05-owned-model/NEW
node scripts/prepare-r05-owned-model.mjs \
  --output .artifacts/r05-owned-model/NEW --verify
node scripts/audit-plm-plugin-served-bytes.mjs \
  --output .artifacts/NEW-AUDIT \
  --base-url http://127.0.0.1:30250/ibizplm-plmweb/
node plm-web/tools/check-plm-login-layout.mjs \
  --candidate .artifacts/plm-multiagent-combined-20261121-r1 \
  --upstream http://127.0.0.1:30250 --output .artifacts/NEW-LAYOUT
node scripts/check-plm-source-startup.mjs \
  --candidate .artifacts/plm-multiagent-combined-20261121-r1 \
  --upstream http://127.0.0.1:30250 --output .artifacts/NEW-LANGUAGE \
  --language-switch
```

输出必须是新私有路径。共享审计如发现字节差异，退出非零是正确结果，不表示
应该直接重建/替换共享环境。

## 2026-11-22 实时隔离批次

新 run `6189aef47735` 已完成一次真实 owned SQL -> workflow -> EBSX ->
UAA -> backend 顺序验证。M01 新增的成员只读 runner 在两中心六个普通账号上
得到 6/6 实际响应：两中心 editor/viewer 各返回本中心非空方案，no-access
返回空，匿名返回 401，13 次完整物理快照保持一致。导航/选择/CRUD 仍未执行，
因此 M01 继续为 ACTIVE。

A01 默认 String-root HTTP lane 也完成了真实运行：84 条逻辑用例中 36 条
实际派发并验证，48 条 typed/null/empty/numeric 请求仍受原生 String-path
传输边界限制；16 个控制和 84 个认证检查通过。parentless MAJOR 路由的源码
与配置绑定已实现且默认关闭，但两次 fresh backend 启动在 All-in-One 连接
owned Nacos 时失败，未宣称 parentless HTTP 通过。

所有 owned UAA/Redis/MySQL/backend 临时资源已按精确 ID 清理，SQL cleanup
回执通过；共享 witness 对既有 aibiz 容器的 mount hash 报告不一致，已保留
为边界证据而非强行判定通过。详细回执见
`docs/CONVERGENCE-LIVE-20261122.md` 和
`records/aibiz-convergence-20261122.json`。本批次未关闭任何顶层项。

聚焦联合 Node 回归：scripts **128/128**，PLM Web **19/19**；
与 Java/浏览器证据分别记账，不相加为功能数。未运行全量 `npm test`。
原始日志、模型、XML 和截图均留在根 `.artifacts/`；
文件路径和 SHA 见 `records/aibiz-multiagent-progress-20261121.json`。
