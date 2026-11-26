# 人员选择器失败与重试

本批开始于 2026-11-26；最后核对为 2026-11-26 America/Los_Angeles
（2026-11-27 Asia/Singapore），沿用文件名。范围是单个人员选择器源码候选；
B02/L02 顶层项不因本批关闭。

## 手册要求

失败请求不能冒充“暂无数据”，异步旧结果或旧错误不能覆盖当前搜索。
查询、用户标识、名称和 Unicode 正文必须保持原值。中英文桌面/移动源码候选
与真实业务持久化、跨角色验收和实际发布字节分别记录。

## 本地实现观察

本轮开始时组件、控制器、locale helper 和样式已有未提交改动。它们的旧字节、
HEAD 样式及已有差异已私有封存。本轮没有修改控制器或 locale helper，
也不把已有的查询版本保护、翻页回退或旧双语文案冒领为新实现。

新确认的问题是组件 `load` 只有 `try/finally`：请求拒绝会直接传播到搜索
debounce 和标签事件的异步调用，形成未处理拒绝；loading 消失后又显示
“No Data/暂无数据”，把失败误当空结果。红测中两个语言的失败场景与一个
过期失败场景均抛出服务异常，只有真正空结果通过，原失败回执保留。

本轮为当前 query/tab/version 增加独立失败状态，显示“Failed to load/加载失败”
和“Retry/重试”。重试调用原查询的同一页，利用原控制器“失败不递增页码”的
既有规则；翻页失败保留已加载记录，界面暂以失败/重试区替代列表，重试成功后
恢复并追加结果。旧请求失败不改变新请求状态，新搜索开始清除旧失败。
原错误内容不直接展示给用户，当前失败以明确可见提示反馈。

首轮浏览器使用 HEAD 样式，虽流程通过，但截图发现 HEAD 的旧 BEM selector
与当前源码不匹配，导致文本/标签竖排。该首轮保留，不称为视觉通过。
经同插件范围审查后，旧 BEM 和布局修复作为明确必要依赖一并保留；本轮只在
失败提示容器新增 `display:flex`、`gap:8px`、垂直居中和水平居中四个声明。
未改 public、dist、词典、模型或其他插件。

## 当前版本验收证据

```sh
cd plm-web
node --test tools/tests/person-select-followup-20261126.test.mjs tools/tests/person-select-binding.test.mjs tools/tests/frontend-workflow-locale.test.mjs
node tools/ts-harness/index.mjs -- @ibiz-template-plm/person-select@0.0.3-alpha.434
node tools/tests/person-select-followup.browser.mjs --output ../.artifacts/person-select-browser-20261126-r2
```

最终源码回归 **37/37**。新增测试文件含 7 项，执行实际组件、控制器、
locale/工具函数和 Vue：两语言失败/重试、查询与页码/Unicode 保留、
过期搜索拒绝、切换部门后的过期失败、翻页失败重试及真正空态。
其他 30 项属于已有相关回归，不增加本轮独立测试计数。

TypeScript harness 仅选择人员插件，符合已有基线，仍有 **8** 条诊断：
`TS7006=1、TS2345=2、TS18048=3、TS2322=1、TS2538=1`。
相同编译选项下以本轮修改前后的组件源分别检查，数量及错误码完全相同，
增量 **0**；基线未更新，这不是类型零错误声明。

冻结文件，相对 `plm-web/`：

| 文件 | SHA-256 |
| --- | --- |
| `personel-select.tsx` | `f97ed3f2bf166606b5cdacd2603c5559e7dadf1a5eb78b5fc3b77ed2f61f5f75` |
| 历史依赖 `personel-select-controller.ts` | `3d56f1fd98282954d96e1e2fe7351775a6bb5e804a5fa388c39db7132afdc19b` |
| 历史依赖 `personel-select.locale.ts` | `210c2791dbe93377a51664f81b876882b2b73d28fd51219c6896e200c2ee8516` |
| `assets/styles/style.css` | `e10881e45fa968b3589189bc6736403c9d3908c86f4c5867289cca6fb963502f` |
| `tools/tests/person-select-followup-20261126.test.mjs` | `1ee9aded917327cb35fa8b499d8113bdde0f59f84f484b60b5cba1b09b405d4e` |
| `tools/tests/person-select-followup.browser.mjs` | `391dd4e1da8be270ec767cce90fbaaded40f465bb3f38d02b630032e68b8e5dc` |

前四个文件位于 `plugin-src/@ibiz-template-plm/person-select/src/`。
私有 `.artifacts/b02-person-select-20261126-r1/` 保留 before/after、
本轮独立增量 patch、红绿日志和以下回执：

| 回执 | SHA-256 |
| --- | --- |
| `summary.private.json` | `1a2d017d924c2f3f76fc5289a032b91ff41e12df73e92f1420f8a96e7d953149` |
| `ts-harness-original.private.json` | `aca6cb83e72008014cc55c478631fc19c59082e0f79e33d2cd275b2560fb1b8f` |
| `ts-before-after.private.json` | `5e3b840bef3e3399d0c71e21c4bfed1c57b7fb9a9d490768ab17231e2bf48fe8` |

### 独立提交依赖复验

`.artifacts/b02-person-select-replay-20261126-r2/` 明确导出上述 6 个候选文件；
其余工具函数、VirtualList、类型、package/lock 均取
`plm-web@3bedddfcb991c464624443622a1afccb431140cf` HEAD，共 11 个输入。
私有副本新测试 **7/7**，当前/副本源码哈希前后均一致。依赖本地已有
TypeScript/Vue/Ramda，版本及包入口哈希另行绑定，不宣称全部依赖源码闭合。
报告 SHA-256：
`152ceef11a287c2d07fb76403fe147cc7aef3ac057fa5ee0257cbcb05343ca5e`。
旧 r1 五项副本回执及包元数据记录失败边界继续保留，不代替本次七项复验。

### 受控浏览器与布局

维护入口自动创建新的私有候选、封存实际源和执行脚本，以真实 Vue 3.3.8、
Element Plus 2.4.4 输入框/弹层及真实组件/控制器运行普通点击和输入。
host props/namespace、EditorController 基类和服务响应为受控 fixture；
没有连接业务后端或注入已运行的业务控制器。

四格分别是中文/英文、桌面 1280×800/移动 390×844。每格真实操作：
打开选择器 -> 输入 Unicode 查询 -> 服务失败 -> 可见失败提示 -> 点击重试 ->
同 query/page 成功 -> 空查询结果 -> 慢请求晚失败 -> 最新查询结果保留 -> 部门标签。
每格 7 次受控调用，原数据未变、未发业务值 change，错误/空态没有混淆。

最终 r2 四格的 console error、page error、失败请求和阻止请求均为 0。
几何检查证明失败提示与重试按钮不重叠，人员/部门标签同排，320×418 弹层
完整处于各视口内，无横向溢出；失败及恢复截图已私有保存并视觉复核。
所有 browser/context 均已关闭。首轮 HEAD 样式的非视觉通过回执仍为原字节。

| 最终私有证据 | SHA-256 |
| --- | --- |
| `person-select-browser-20261126-r2/report.private.json` | `051739832c8ab301e9bb763ab5a7880a01857dc7caadc5a7ddf0325f720114d2` |
| 同目录 `candidate.private.json` | `60e6b7212f75cb10c734f2d9e75fcb2845f3eb0802a04791817355dd62c9700a` |

维护入口对 public 人员插件、对应应用 dist 及源码插件 dist 进行完整前后哈希比较，
均未改变；私有构建只写 `.artifacts/`。不以此推断整个应用或全部运行输入不变。

## 待决策/阻塞

本批只验证源码候选的受控搜索失败、恢复与展示。真实服务/权限、选择后持久化、
跨角色读回、复杂组织数据、多节点及完整 73 插件矩阵仍开放，未将源码候选发布为
共享运行版本。已有 8 条类型诊断也仍待处理。
