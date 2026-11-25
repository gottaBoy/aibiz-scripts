# 主题与通知显示语言候选

2026-11-24。当前状态为 **PREPARED-NOT-PUBLISHED**，未执行新的真实主题或通知
浏览器流程。没有写共享 dist、容器、Nginx、环境或数据库，也未重跑已清理通知。

## 手册要求

SYSTEM caption 应以当前语言显示，不能将英文显示标签写回持久化系统配置。
PERSONAL caption、产品名、人员名、ID、状态、路径及自定义通知原文保持原值。
通知验收须同时核对真实接收者、原生已读、新会话读回、原始内容和精确清理；
构建或受控 DOM 测试不关闭 F06、L02 或 B01。

## 本地实现观察

当前源码已有 SYSTEM caption 合并及回写隔离修复，入口是 runtime 的
`search-bar-group.util.ts`、`search-bar.controller.ts` 和 `search-bar.service.ts`。
本次没有改其业务语义；原来只重建应用 Vite 不能将该外置 runtime 的改动带入运行版。

新增 web/mobile `localizeInternalMessageHtml`：

- 先核对 `message_type` 属于四个明确产品模板，再核对六种精确已知事件。
- 只翻译 `.notice-card .notice-card__event-desc` 的完整事件文本。
- pilot 只翻译开头固定 ` · 产品管理 · ` 中的类别，后面的同名产品保留原文。
- 未知模板、错误事件组合、重复/嵌套事件节点及 Chinese 显示原样返回。
- 只返回显示 HTML；没有修改 message 对象、持久化模板、URL、状态或 API。

桌面叶节点和分组摘要均调用此入口；分组原来误将 `content` 与 `HTML` 比较，
现在按实际 `content_type` 选择 HTML 显示。原生移动 provider 接入等价纯函数。
PLM 浏览器手机视口仍使用 web provider，原生移动包本批没有独立构建/部署声明。

## 当前版本验收证据

```sh
node --test scripts/tests/notification-display-locale.test.mjs \
  scripts/tests/prepare-plm-language-runtime-candidate.test.mjs \
  scripts/tests/current-b01-b04-l01-l03-source-contract.test.mjs \
  scripts/tests/plm-manual-reference.test.mjs
pnpm -C ibiz-app-hub exec vitest run \
  packages/runtime/test/controller/control/search-bar/search-bar.service.test.ts \
  packages/runtime/test/controller/control/search-bar/search-bar.controller.test.ts
```

Node **24/24**，runtime focused **6/6**。通知 DOM 测试执行两份真实 TypeScript
源码，验证六事件、English 语言变体、未知模板、`__proto__/constructor`、
错误事件组合、重复/嵌套节点，以及 Unicode 名称/编号/时间/属性不变。
两个通知 helper 的 ES2020/DOM 独立 `tsc --noEmit` 通过。
完整组件 tsc 受现有 Vue 3.3/3.5 类型冲突及其他既有错误阻塞，未标通过；
组件默认 Vitest 的全局 setup 依赖 window，最初错误 cwd 及 node 模式执行失败保留，
后续真实 DOM 测试独立运行，不通过修改共享全局配置绕过。

候选准备器为 `scripts/prepare-plm-language-runtime-candidate.mjs`，
SHA `9a0613679fafeb88c944dcf42e68a16f18ff8df834924c97aba19096fecb2649`。
它在全新私有 workspace 保留目录结构、复制当前源码/配置/测试，
将现存锁定依赖解析为绝对 link，不安装依赖或修改原 package dist。
实际构建使用 runtime 自带 `scripts/build.js`、Rollup 和组件现有 `ibiz-temp build -c`；
构建日志保存在私有目录。构建前后再次比较当前源、执行快照和原 dist，
依赖审计结束后再复核源输入。

最终候选：
`.artifacts/plm-language-runtime-20261124-r4/language-runtime-candidate.private.json`，
SHA `271fc7444d0a20b573faa53059c4e60869a2d29a5be1ec8702ed53978e3f0d58`。
revision `85bb771e88717181`，仅 **18** 个 overlay 输出：
runtime 两个输出、components 十四个输出、一个新 import map、一个首页。
原应用 entry、其他 import map 项、插件、模型和环境保持原输入。

| 绑定 | SHA-256 |
| --- | --- |
| runtime 1,522 个源码/配置/测试输入清单 | `eac123b4699f901baf438d01a136fd9f7f5af44992d698298325f0cb861f7611` |
| components 1,171 个源码/配置/测试输入清单 | `05614a02d1a063767643801e78d78f79d7f711c019c59460201a5817b5d101f3` |
| runtime `index.system.min.js`，1,464,406 bytes | `a919c81e9cdafde64d10846e91c11a99f0a80896339d62664763fe0461382f2b` |
| components `index.system.min.js`，4,869 bytes | `e668a68ef7e85a172c986463b2e7f6a43539a9088f1322b86c91db7419ba4fff` |
| components 主 chunk，1,736,772 bytes | `ce63f2b05f4dd840f1b01650043911b16f941b929bc3fce1dd6982fbc746f9a9` |
| 新 import map | `b4dc1a65ced234f266c0e756047623a29905b3d79530d9aab8ef5019a7f4e14b` |
| 新首页 | `1c43304ba453019479697ac5d5fdc2d66bfe3da140ea8e9aae91149ffc9aed5e` |
| 当前原首页/恢复输入 | `e3fb42281e0eeb22c128c94fb8c4f65e6e843212705431e75f0c6e15fdb33a19` |

runtime 输出包含当前 `mergeBackendSearchGroup`，组件主 chunk 包含六事件翻译、
模板白名单及 leaf/group 调用。源码具体副本和全部输出 hashes 位于候选，
不是把旧输出拷贝到新路径冒充构建。

字面 JS/CSS 依赖图共 57 个 module/stylesheet，JavaScript 字面依赖无未解析项。
保留一个继承于现存 `vue3-util` 的非字面 `System.import(n)` 边界。
CSS 有两个现存 root URL：`/assets/images/login-header.png` 与
`/assets/images/login-avatar.png`，超出 PLM prefix，当前实际 HTTP 都为 404。
二者已确认存在于当前服务 CSS（SHA
`35d4701bad6a3ae005acaa9bb2f6154d0097eff6f748dd25133b515ca01bb363`），
没有制造资源或把 404 标通过。新候选报告保留这两个 unresolved CSS 输入。

## 失败与阻塞

- 旧整应用组合候选 r1 未发布；其组件快照未同步最后 helper 修改，
  也没构建 caption runtime，已明确弃用于发布，但文件保留。
- 新准备器 r2 构建成功后，因检查器错误地查找不存在的函数名而拒绝；
  后改为真实 `mergeBackendSearchGroup`，旧失败目录保留。
- r3 是中间候选，后续补未知模板 prototype 键负控后 source 已变化，不可发布。
- 仅最终 r4 与上述当前源码匹配，尚待主线审查差异、入口映射、依赖边界和发布计划。
- 新角色是否可用、英文/移动主题、通知四格和清理仍需新当前运行回执；
  历史已删除通知不重跑。没有通过源码或构建结果关闭任一顶层能力项。
