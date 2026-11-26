# 评论插件源码与双语回退

检查点：2026-11-26，Asia/Singapore。范围为评论列表单个插件的源码候选；
不关闭 B02 或 L02，不代表 73 个插件或真实评论业务流程验收完成。

## 手册要求

评论插件的正文、作者和技术标识应保留原值。中英文与桌面/移动展示需要分别验证，
失败状态应有合理展示。源码渲染、静态候选和受控服务不能代替真实业务持久化、
多角色流程或实际发布字节。

## 本地实现观察

已有未提交的 `comment-list.locale.ts` 实现了中英文编辑/删除文案和按日历日期
计算的相对时间，组件已引用该 helper。这些属于本轮开始前的历史依赖：
本轮封存原字节与差异，没有修改 helper，也不将跨年/闰日等旧修复冒领为新增。
若交付完整组件，helper 必须一并审查纳入，避免留下无法解析的本地 import。

本轮新确认的错误是 `failedAvatars` 只在图片失败时写入，渲染分支从不读取它。
因此浏览器触发图片 error 后，列表仍渲染同一张破图，已有文字头像函数无法接管。
两种语言的新测试先复现了这个错误。

最小修复是在原头像分支检查 `failedAvatars`，已失败的头像使用既有
`renderTextPhoto`。健康图片仍正常显示；作者、日期、正文和编辑/删除回调参数
没有改写。未改控制器、权限、接口、公共插件包或应用 dist。

## 当前版本验收证据

执行：

```sh
cd plm-web
node --test tools/tests/comment-list-locale-followup-20261126.test.mjs tools/tests/frontend-workflow-locale.test.mjs
node tools/ts-harness/index.mjs -- @ibiz-template-plm/comment-list@0.0.3-alpha.189
node tools/tests/comment-list-locale.browser.mjs --output ../.artifacts/comment-list-locale-browser-20261126-r1
```

源码回归为 **12/12**。新增文件中的 3 项检查执行实际组件、locale helper、
工具函数和本地 Vue/TypeScript：两语言头像失败回退、健康图片保留、原文与回调不变，
另保留少量历史 helper 的跨年、闰日和非法日期原样断言。
最初的两项头像测试均失败，原失败日志保留，没有改写成通过。

现存 TypeScript harness 仅选择评论插件，结果符合现有基线，仍有 **22** 条诊断：
`TS7006=17、TS2345=1、TS7053=4`。另以相同编译选项在内存中切换本轮
修改前后的组件源，两侧诊断总数与各错误码数量完全相等，增量为 **0**。
没有更新原基线文件；这不是 TypeScript 零错误声明。

源码冻结：

| 文件 | SHA-256 |
| --- | --- |
| `comment-list.ts` | `5e0ef16e79cc43691ae5c5d876eb4b6e8d6f98081050f7ee5f20a9d5cb855fd4` |
| 历史依赖 `comment-list.locale.ts` | `5b51e3b404949eff4982fe3ac6fb3ef302deccaf15299a7d417b9c282480cb01` |
| 新增 `comment-list-locale-followup-20261126.test.mjs` | `763c042f244bbb66c220d05c6f658d4f1de8ec8d53f09c00450ebdaf3bed9b25` |
| 新增 `comment-list-locale.browser.mjs` | `432f0789c26d6064b1827efc66f0090b2b5c289440f7f1b5bf35f7604c61c28f` |

私有证据 `.artifacts/b02-comment-locale-20261126-r1/`：

| 回执 | SHA-256 |
| --- | --- |
| `summary.private.json`，当前源码及 12 项回归 | `3e1eae06267952c4015db4d198f0b94d60be15be0508aac18b8e8fe3a17bbc4f` |
| `ts-harness-original.private.json` | `6e0f785483f5a4364fd7763569bc1fcba4253c99e805a85df1ef7919c77f9904` |
| `ts-before-after.private.json` | `a1aa4c5b6028d02ee42fab53321fd19b875ec8a27ed8e3eb4437985ab47b6802` |
| `published-bytes.private.json` | `efe7a5b539374e188518d45b17081fb9795c54339635e3d2fd4cd8a0744fddce` |

### 独立源码重放

`.artifacts/b02-comment-committed-replay-20261126-r1/` 独立导出组件、历史 locale
helper 和新测试三个明确候选；工具函数、package 与 lock 来自
`plm-web@80014921516580bf92584b3f342be8a6851c8d67`，并逐字节核对。
从副本运行新测试 **3/3**，执行前后源码哈希一致。工具链为现存
TypeScript 5.2.2、Vue 3.3.8，版本和入口哈希另行绑定；不宣称全部依赖源码闭合。
报告 SHA-256：
`44cf45a780f59a71b2de2c812ee84be55ae66007ece9da5401a734e837b27bea`。

### 受控浏览器候选

`.artifacts/b02-comment-browser-20261126-r1/` 使用上述私有源码副本与真实 Vue DOM，
通过普通 fixture props 提供两条评论。host props/namespace 与文件地址服务是受控
适配，未连接业务后端，没有向现有视图注入控制器。

浏览器自然解码失败图片，触发原生 image error，然后由实际组件状态回退；没有
手工调用回退或写入组件状态。中文/英文、桌面 1280×800/移动 390×844 四格均通过：
失败头像显示文字，健康图片保留，日期为对应语言，Unicode 正文不变，没有横向溢出。
四格的 console error、page error、失败请求和阻止请求均为 0，截图已私有保存。
原组件的中文头像失败 console log 仍作为信息日志保留，不称为全部日志已本地化。
所有 browser/context 均已关闭。

最终候选 manifest SHA-256：
`fdab46f7b14d376ba37cdd2b87c14d281507b3397a43fe22fba97b8f17041887`。
浏览器回执 `browser-r1.private.json` SHA-256：
`0d70388a9a0bde905174b5b20e2f30ff395149bd20f1735a945cde8a1d599cc3`。
该回执明确 `nativeBusinessAcceptance=false`，不替代真实评论增删改、刷新或权限验收。

随后将准备、运行和清理逻辑整理为可提交的
`plm-web/tools/tests/comment-list-locale.browser.mjs`，不依赖上述一次性私有入口。
它只允许全新的工作区 `.artifacts/comment-list-locale-browser-*` 输出目录，
自动封存组件/helper/工具函数及执行脚本、生成静态 fixture、构建私有 bundle、
运行四格并保存截图/错误/源码哈希，最后关闭所有浏览器 context。
它还独立记录原公共插件、对应应用 dist 与源码插件 dist 的前后完整文件哈希。
fixture 日期按新执行时新加坡日历的昨天生成，避免固定测试日期过期。

该维护入口已进行语法检查和一次等价四格运行。执行的组件及历史 helper 字节
与上表一致；公共包/对应应用 dist 前后完全相同。新回执位于
`.artifacts/comment-list-locale-browser-20261126-r1/report.private.json`，
SHA-256 `8aa725ce8341c5c12c3e2ce70498d6990ee70af3f5ff00f46c7ca2ccf41e5dd9`；
私有候选 manifest SHA-256
`8a6f3d1a6f697d068483bbca9e5aae825d74c7f31da47674b3293e49fa67c518`。
中英文桌面/移动截图分别为同目录的
`zh-CN-desktop.png`、`en-US-desktop.png`、`zh-CN-mobile.png`、
`en-US-mobile.png`。实际 Chromium 为 `154.0.8037.57`。
这仍是受控 props/host 服务的真实 Vue DOM，不是原生业务流程。

当前公共评论插件 15 个文件仍与 HEAD 字节一致；应用 dist 中对应 15 个文件也与
该公共原包一致，并在末次检查后保持相同哈希。源码插件自身 `dist` 不存在。
私有构建使用 esbuild `write:false`，只向 `.artifacts/` 写入候选，没有发布；
不由这个局部核对外推整个应用 dist 或所有挂载输入均不变。

## 待决策/阻塞

真实评论生命周期、加载错误/空态、刷新、新登录与多角色持久化、实际发布和完整
73 插件矩阵仍开放。现存 22 条类型诊断另待处理；本轮只证明所述源码修复未增加
这些诊断。旧日期和文案候选尚未因此自动成为运行版验收结果。
