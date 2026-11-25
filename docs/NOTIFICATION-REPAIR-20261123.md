# 产品通知验收合同修正

检查点：2026-11-23。当前状态：**修正工具重新发布后，中英文手机真实触控、
新建自有产品后的中英文桌面通知四格均通过并完成精确清理**。
本批不修改生产模型、后端、数据库、角色或 Nginx；静态发布与恢复仅限定已审 CSS/首页，
不关闭顶层能力项。

## 手册要求

`manual/PRODUCT-PROJECT.md` 的 PP10/PF10 要求分别观察事件、接收者、去重、
通知内容与已有链接的权限，普通操作、状态变化、评论提及不能互相代替。
`manual/ADMIN-INTEGRATION-METRICS.md` 要求验证真实送达和目标用户，
不能把配置保存或模拟发送当作通知通过。
`manual/TEST-KNOWLEDGE.md` 要求旧通知不能保留已经撤销的对象访问权。

这些规则没有要求每条系统通知都必须包含链接。若通知声明了链接，链接必须正确；
链接缺省是否错误，须由具体事件的权威模板和 UI 合同判断。

## 本地实现观察

上一批测试将“每条消息有一个同源 HTTP 产品 URL”作为统一删除前提。
这一限制超出了合同，并且误解了平台原生 `route://` 协议。
原失败结论不能证明通知发送、API projection 或代理丢失了 URL。

产品模板实际内联在 `plm/model/PSSYSTEM.json` 的
`getAllPSSysMsgTempls` 中。其声明的 `dynaModelFilePath` 不代表本工作区
存在同名独立模板文件；本批没有创建伪造的模板文件。

| 模板 | 事件 | 模板中的链接规则 |
| --- | --- | --- |
| `product_member_create` | 把你加入了产品 | 桌面和移动 `route://` 产品链接 |
| `product_member_remove` | 把你移除了产品 | 未配置 `taskUrl` / `mobTaskUrl` |
| `product_archived_or_activate` | 归档了产品 | `is_archived != 0` 时留空 |
| `product_archived_or_activate` | 激活了产品 | `is_archived == 0` 时生成产品链接 |
| `product_remove_or_recover` | 删除了产品 | `is_deleted != 0` 时留空 |
| `product_remove_or_recover` | 恢复了产品 | `is_deleted == 0` 时生成产品链接 |

发送实现的对应关系：

- `DENotifyRuntimeBase.fillMsgSendQueue` 分别从模板读取 URL 和移动 URL；
  `SysMsgTemplRuntime.getUrl/getMobileUrl` 对未配置的模板返回空值。
- `InternalMsgSender` 直接将队列 URL、移动 URL 写入内部消息，同时绑定
  `PERSONAL`、目标 `receiver`、`owner_id`、系统标记和 `RECEIVED` 状态。
- 权威 `internal_message` 模型和 DTO 包含 `url` / `mobile_url`；
  `cur_receiver` 条件绑定 `receiver=srfuserid`、
  `system_tag=srfdcsystemid`。这两个字段不能猜测为用户名或 `srfsystemid`。
- `InternalMessageContainer` 使用是否存在 URL 决定是否可点击跳转，支持无链接通知；
  “已读”动作通过独立图标触发，不需要打开已删除的产品。

从旧失败 trace 保存的同一产品六条消息观察到：成员移除、归档、删除三条 URL
为空；成员加入、激活、恢复三条有正确的桌面/移动 `route://` 产品链接。
因此原先把首条空 URL 当作整个产品通知的数据缺陷不成立；该模板组目前未发现
需要生产源码修改的 URL 缺陷。

另有必须保护的 UI 行为：`InternalMessageTab` 按 `message_type + url` 分组，
空 URL 的同类事件可能包含多个产品。点击整个组的已读图标会影响该组所有消息；
“组包含自有 marker”不足以授权组级修改。

## 当前修复

独占修改限定：

- `plm-e2e/tests/current-owned-product-helper.ts`
- `plm-e2e/tests/current-owned-product-notification.spec.ts`
- `plm-e2e/config-tests/current-owned-product-lifecycle.test.mjs`

产品配置保持现有独立通知 testMatch，不修改共享测试 helper 或知识 runner。
后续手机实际失败引入的三个样式源文件及候选工具见下方，均在本线报告独占边界后修改。

新校验继续要求正常 UI 登录产生的 appdata 身份，并严格绑定：

1. 消息 ID、安全的当前 `receiver`、真实 `owner_id`、原生系统标记、
   `PERSONAL` 所有者类型、HTML 内容和合法状态。
2. 一份通过完整产品生命周期且已精确清理的私有 source receipt，包括唯一 marker、
   产品 ID、编号、原始/修改后完整名称、五个业务阶段及起止时间。
3. 用 HTML 语法树解析模板实际渲染的产品编号、完整名称和事件文本，不用任意
   子字符串或相似名称替代；消息时间须在该源运行及明确两分钟容差内，
   API 无时区时间按本批服务观察到的 `+08:00` 解释。
4. 仅允许四个产品模板对应的六个已发生事件；六事件集合必须完整且不重复。
5. 三个声明有链接的事件要求桌面和移动链接同时存在。`route://-/index/...`、
   `route://-/home/...` 按原生协议、精确产品 ID 和目标 view 校验；
   已有 HTTP 链接仍要求当前应用同源及精确产品路径。其他产品、外部源、
   未知 view、重复产品段和危险协议均拒绝。
6. 仅成员移除、归档、删除这三个明确无链接事件允许 URL 缺省。
   即使这些事件带上链接，提供的链接也必须通过相同产品绑定。

UI runner 先完整分页读取真实当前接收者数据集，核对 `X-Total`，再在内存选取
该 source receipt 的自有 marker；不发送未声明的 content LIKE 过滤器。
随后通过普通组展开与分页定位自有叶节点，逐条核对产品编号/名称/事件，
只点该叶节点的已读图标。禁止组级 bulk 和 `mark_all_read`。
每次实际请求必须是该消息精确 ID 的 `mark_read`，并验证持久化 `READ`、
内容 SHA 和第二次正常登录读回。

只有 UI 与新会话读回完成后才允许清理通知。清理前重新 GET 并核对原始 ID、
所有权、内容 SHA 和业务证据；只用原生 DELETE，marker 验空后还要核对其他
原有消息的状态及内容 SHA 未改变。UI 未完成时保留通知供复核，不删发送审计。
历史桌面运行及旧手机失败保留各自的交互记录。
后续手机项目使用实际 `locator.tap()` 打开通知、展开分组、分页和点击单条已读，
不再以 hover/mouse click 代替这些触控动作；桌面仍保持原 click/hover 流程。
本次最终手机回执已记录实际触控；范围限定为通知 popup、分组、分页及叶节点已读，
不能扩展为整个平台所有手机交互已验收。

## 当前版本验收证据

离线验证：

```sh
node --test plm-e2e/config-tests/current-owned-product-lifecycle.test.mjs
```

**13/13** 通过，包括权威模板空链接规则、原生 DTO 字段、六事件正向用例及
跨接收者、所有者、系统、产品、时间、模板、HTML 结构和路由的误删负控。
使用现存 PLM 锁定 TypeScript 5.2 / Node 20 类型的独立四文件 `--noEmit` 通过。
`plm-e2e` 的 `git diff --check` 通过。

保存响应重放回执：
`.artifacts/notification-contract-repair-20261123-r1/offline-replay.private.json`，
SHA `6576dd472e3b76d8aede64363c180947ec5ee76f92c03d6481b9371099d5966e`。
输入绑定旧 trace、其真实 appdata 和六条消息响应、源产品回执及当前 helper SHA；
六条全部通过。`currentHttpCalls=0`、`rawBusinessWrites=0`，
不是本版本 UI 或真实新 API 的验收。

原失败回执保持不变：
`.artifacts/current-owned-notification-final-20261123-r1/test-results/` 下中文桌面
`product-notification-evidence.private.json`，
SHA `41f88e4c5ab68c99b10499ad5c8ec435b0b727a0db6b827b5410c40c7d7993f1`。
原记录的 strict URL 失败及零写入事实不覆盖、不重新解释为通过。

### 实际桌面与手机执行

修正合同后用原 final 产品回执分别绑定项目，没有创建新的业务数据集：

| 场景 | 结果 | 通知回执 SHA-256 |
| --- | --- | --- |
| zh-CN 桌面，notification final r2 | 六条叶节点 UI 已读、第二正常登录 READ、精确原生删除并验空；其他原 83 条消息未变 | `c1fa8cb40a17ec6cdfab307312130b62ea1318a8ba8b40b8a9b5a9fd1e132086` |
| English 桌面，notification final r3 | 同样六条完整通过；其他原 77 条消息未变 | `9b847354cd7df844f2c9ddf695032f0836e39bfff8fd01511c198169e8e02539` |
| zh-CN 手机，notification final r3 | 组展开图标被内容/页面截获，普通点击超时；六条仍保留，未发出已读/删除 | `42d2d963b924716365ed77c93f2ed93eb14bc8d4b4e702312a6b301cbd56b16d` |
| English 手机，notification final r3 | 相同普通点击失败；六条仍保留，未发出已读/删除 | `3b2d4f2fe2f1ce42b193e99700e8a7929f37e2fe2e2736c41b7c8b39611efbe2` |

回执位于 `.artifacts/current-owned-notification-final-20261123-r2/` 和
`r3/test-results/` 下对应 project 的 `product-notification-evidence.private.json`。
四格 console/pageerror/HTTP/requestfailed/capture 均为零、运行生命周期和挂载内容
保持一致。手机操作失败本身没有被这些零计数覆盖为通过。
两桌面共删除 12 条自有内部消息，发送队列/history 审计未删，未用组 bulk、
`mark_all_read`、force click 或控制器注入。手机各六条仍为待验收数据。

### 手机样式源码与私有候选

实际框架将通知 popover 强制设为 500×500；390px 视口截图显示横向裁切。
消息组的绝对定位操作区没有给正文预留空间，长正文会覆盖展开图标。
源码修改限定 `ibiz-app-hub/components/ibiz-next-vue3/src/panel-component/user-message/`：

- `user-message.scss`：视口约束宽高和 border-box。
- `internal-message/internal-message-group/internal-message-group.scss`：
  为 40px 操作区预留正文空间、控制长文本溢出、固定图标尺寸和层级。
- `internal-message/common/internal-message-container/internal-message-container.scss`：
  coarse pointer 下显示单条已读图标并保留 24px 命中区域。

新增 `scripts/prepare-plm-notification-style.mjs` 真实编译三个 SCSS 及主题 mixin，
再用选择器语法树将输出限定在 `.ibiz-user-message-popover.el-popover`。
更高选择器优先级保证旧 framework CSS 后加载也不会恢复固定宽度；
宽高 important 规则覆盖组件普通内联 500px 设置。没有新增外网资源。

私有候选 `.artifacts/plm-notification-style-20261123-r1/`：

| 绑定 | SHA-256 |
| --- | --- |
| `notification-style.private.json` | `40f712d79e3d7b60812b866b12058e16c47c4e3be6e844f757e61781b6fc146a` |
| 准备脚本 | `4aabcf551677b8d97170bf70b9749e6daf11cb0d46a0fa1c8084dddbe98b0ebb` |
| 新 CSS，6015 字节 | `949d52b67c38b672a4678c944fe810b4f5afd83085cf0d1ba4d8a33b715b4178` |
| 新 HTML，2317 字节 | `e3fb42281e0eeb22c128c94fb8c4f65e6e843212705431e75f0c6e15fdb33a19` |
| 原 HTML 回滚输入 | `1d12c09ece14b684dbf9e53f3bdd955fce9982ca1666afced5e23a02a5abc236` |

候选只有新哈希名 `static/css/plm-notification-949d52b67c38b672.css` 和 HTML
head 中的一条本地 stylesheet link。三个 SCSS、七个真实主题依赖、编译工具入口
及命令哈希/副本已封存；未声称重建完整第三方依赖源码闭包。
当前容器身份、镜像、StartedAt、RestartCount 和挂载前后相同，新 CSS 目标在
准备时宿主和容器均不存在该 CSS。候选准备时未部署，也不修改既有 guard executor 或其计划。

候选契约测试 **3/3**；隔离 Chrome 布局测试 **12** 种组合通过：
zh/en × 桌面/390px × patch 在 base 前/后/内联 500px。
测试使用真实 SCSS 和 mixin，旧 HEAD 样式确实复现越界；新展开/单条已读图标
通过 `elementFromPoint` 和普通点击，HTTP 请求为零。
布局回执 `.artifacts/notification-layout-4477c4b7-01cb-41f2-bb01-da198c6348a9/report.private.json`，
SHA `74583f1b2eb599fe5708c450af4c99f080390642b83a5c0d803e42e602bd3dcf`；
测试 CSS SHA 与私有候选一致。这是合成 DOM/CSS 回归，不是真实手机通知验收。

拟议推广只需先将新 CSS 精确放入宿主启动源和既有容器 `/dist`，核对哈希后最后
原子切换 HTML；保留原字节和元数据。恢复时仅在首页仍匹配候选哈希时恢复原 HTML，
只删除原本不存在、仍匹配本候选哈希的 CSS。主线审核执行前不覆盖共享资源，
不重启或重建容器，不覆盖插件、模型、环境或 framework 包。

### 独立部署工具与只读计划

主线批准编写独立的 `scripts/deploy-existing-plm-notification-style.mjs`；
没有修改原 guard executor 或其计划。下述 r2 是历史初始计划；
之后主线实际 apply、回滚失败及独立恢复均保留，不覆盖旧记录。
新工具要求显式选择 `--prepare`、`--apply` 或 `--rollback`。
应用必须提供已审 plan 的绝对路径、epoch 和 SHA；业务失败后的显式恢复还须提供
成功 apply receipt 的路径及 SHA，不接收另一批候选或任意文件列表。

准备封存工具、测试和只读 startup helper 源码，复核三个 SCSS、七个主题依赖、
编译工具入口和 preparer。每次写入前重新检查源码、精确容器身份/镜像/
StartedAt/RestartCount/config/mount、启动脚本、环境变换和目标父目录。
宿主用同一 Node 子进程执行条件检查、原子发布和文件/目录 fsync；容器使用
同一 shell 的 exclusive fixed-FD 暂存、完整 inode/dev/hash/uid/gid/mode
检查与原子发布。意图和逐步日志先持久化，再写目标。

响应丢失会重新读回实际目标和暂存路径，保留原错误；未验证的暂存文件保留复核。
应用失败尝试按本 epoch 的精确文件身份恢复，未知漂移一律保留。两个原首页均验证
恢复成功后才允许删除自有 CSS，没有递归删除，也不操作插件、模型、环境或 import map。

有效只读计划：
`.artifacts/plm-notification-deploy-20261123-r2/prepared.private.json`，
epoch `712fac50-bdce-47ad-9989-f2ecd8d65d9c`，
SHA `12f2053a42b7a84ac69320e6a2c60068f013aeda499cd0797c0bbbd7bc8fd33c`，
状态 **PREPARED-NOT-APPLIED**。
该不可变历史计划已被主线用于首次 apply；它的源码冻结随后在独立恢复成功后终止，
不能作为修改后 executor 的发布授权。

| 计划绑定 | SHA-256 |
| --- | --- |
| 新 executor 源码 | `f9938dd14b2fc4f59a8278cc8ba453ebc5de87eee0aa802d4fd170303d570228` |
| 新 executor 测试源码 | `639a4eef9835afaea7db1832947bc01498addc94573ec59711c999ee8d4d26bb` |
| 原 guard 只读 startup helper 源码 | `ac06dccdb6e36179e9f6d385184cdbe22f65c5451aa0147e27e9cc8dd3e5e698` |

准备前后分别核对 37,815 个 hostDist、37,827 个 containerDist、
17,455 个 plugin source 和 13,723 个 model source 文件，完整内容清单均一致。
这些清单排除的仅为两个明确目标及本 epoch 的明确暂存路径；目标本身另做完整身份
校验。host/container/HTTP 首页仍为原 `1d12c09e…`，两处新 CSS 都不存在。
宿主原首页为 uid/gid 1000:1000、mode 664，容器为 101:101、mode 644，
inode/dev 分别封存在 plan，未用统一权限覆盖两处差异。

工具测试 **21/21**，包括真实私有临时目录上的宿主子进程和容器 shell 文本回归、
磁盘意图写入失败、stage 中断、发布/删除响应丢失、读回失败、
epoch/plan/receipt/inode/owner/runtime 漂移及拒绝重复采用。
手册契约 **10/10** 和 `git diff --check` 通过。
首个只读准备 r1 因当前 BusyBox 的 `sha256sum` 不支持 `-z` 而拒绝，
仅留下源码快照，没有共享目标写入；原失败目录保留。r2 使用独立的 NUL
分隔 hash/path 记录，通过真实当前容器的两轮完整清单验证。
这些工具测试和只读计划不构成发布成功或手机通知验收。

### 首次发布、失败回滚与实际恢复

主线首次 apply receipt：
`.artifacts/plm-notification-apply-20261123-r1/report.private.json`，
SHA `db065f40df6ab039233804fc5d83eb25e6f8fa43f76527fd4532606f3caeb938`，
静态文件和 HTTP 字节验证通过，业务验收仍待执行。

显式回滚 receipt：
`.artifacts/plm-notification-rollback-20261123-r1/report.private.json`，
SHA `977ca8cff046ea5444453b5670567c37168a69f53c9c319f2c6992a5a6b0ecf6`，
真实 **ROLLBACK-FAILED-RETAINED-FOR-REVIEW**。容器首页已恢复；
宿主适配器将完整 receipt 中的 `scope/path` 错当文件属性，拒绝发布宿主首页。
宿主首页仍为候选，两 CSS 保留。原工具的真实宿主测试此前没有覆盖完整 receipt，
不能用当时 21/21 代替实际回滚。

独立恢复工具保持旧 executor/test 冻结，静态绑定原计划与两个真实 receipt，
只修复部分状态；详细合同、原始源码绑定和 15/15 恢复测试见
`NOTIFICATION-RECOVERY-20261123.md`。
主线实际恢复 receipt：
`.artifacts/plm-notification-recovery-apply-20261123-r1/report.private.json`，
SHA `a86a9eb5be8025cfaeda02cb4affea84935d092326bac4274b4da7c4de25379f`。
两个原首页、两 CSS 精确移除、原 HTTP 首页和完整保留清单均通过；
传输错误/残留均为空。没有生命周期、用户或数据库操作。

### 修正工具的新准备计划

恢复后主线授权仅修正 deployment executor/test：
完整文件身份白名单丢弃 receipt 的 `scope/path` 上下文，stage 不预设未知 inode；
真实 actual host adapter 现已覆盖完整 receipt 的暂存、替换和删除。
部署与恢复入口共同使用同一物理锁
`.artifacts/.plm-notification-style-recovery.lock`，拒绝协作工具并发。
apply/rollback 必须显式传入 `--trusted-exclusive-writer-window`；
只读 prepare 不需要该确认。

该锁不约束外部不协作 writer。目标检查到 rename/unlink 之间依赖可信独占写窗口，
不声称原子 CAS；plan 与 report 均明确 `atomicCompareAndSwapClaimed=false`。
本次未扩展资源范围或引入 C helper，SCSS/CSS 候选不变。
独立恢复工具与测试保持原冻结源码，历史副本和所有失败回执保留。

新定向测试 **25/25**，手册 **10/10**，`git diff --check` 通过。
新增真实完整 receipt 适配器回归、部署/恢复共同锁互斥、未知锁保留、
缺失可信窗口和丢失锁的零写入拒绝。新计划：
`.artifacts/plm-notification-deploy-20261123-r3/prepared.private.json`，
epoch `1615bbf1-b628-4e85-94a7-e4599b7e3244`，
SHA `0886bc6396abdc0b72c624fb41670684973836652e97e15b236cc512cc79d060`，
状态 **PREPARED-NOT-APPLIED**。

| 新 sourceSeal | SHA-256 |
| --- | --- |
| 修正 executor | `97f8b33727d1e1c1073779080d1b2eb2a3f20e9d0fc0cb94a755ac6c9552e289` |
| 修正测试 | `774eab1fc84609335b455f9122467185c5557af11698e94caf2c7cf2b62ba479` |

只读 prepare 再次确认 host/container/HTTP 均为原首页，两处 CSS 缺省；
完整保留清单与原 r2 一致。新源码/测试在准备后冻结，后续主线 apply 及手机 UI 见下节。
手机 runner 的实际 tap 分支通过独立 TypeScript 检查和原通知合同 **13/13**；
实际运行封存新的 runner 源码快照，没有沿用旧 mouse 交互回执。

### 重新发布与实际手机触控闭环

主线按 fresh r3 plan 执行新 apply：
`.artifacts/plm-notification-apply-20261123-r2/report.private.json`，
SHA `5f66c1292e44e4219d3552a8a94899b48eaee386ed93b1d94200228c3c5d9e98`，
epoch `1615bbf1-b628-4e85-94a7-e4599b7e3244`。
静态 scope 仍仅两处 CSS 加两处首页，四个精确修改、HTTP 字节和完整保留清单通过，
传输错误为空。`trustedExclusiveWriterWindow=true`、
`atomicCompareAndSwapClaimed=false` 如实保留。
发布 receipt 自身仍标业务待验收；以下独立浏览器回执补充具体通知流程证据。

2026-11-23T17:10:15Z 至 17:10:35Z，在主线交接的独占 normal UI 窗口执行
`current-owned-notification-final-20261123-r4`，只跑两个手机项目：

```sh
node_modules/.bin/playwright test --config playwright.current-owned-product.config.ts \
  --project current-product-zh-mobile --project current-product-en-mobile \
  --max-failures=1 --retries=0
```

输入为四份 final 产品 receipt，未创建新产品或通知数据，桌面通知没有重跑。
每格各六条均使用原保留 ID，触控打开 popup、展开分组和单条已读；
未 hover、force click、控制器注入、组级 bulk 或 `mark_all_read`。
每条请求都是对应自有精确 ID 的原生 `mark_read`。
再通过第二次正常登录核对六条均为 READ，内容 Unicode/hash 不变，
之后逐条原生 GET 重验并 DELETE，marker 验空，不删除发送队列/history 审计。

| 当前手机回执 | 结果 | SHA-256 |
| --- | --- | --- |
| zh-CN，390×844，hasTouch | 六条完整闭环/清理通过，其他原 73 条状态及内容不变 | `6c48a4741af05c89e9bb168e5fbad804d74990006127576ba5e2617c925f5cc1` |
| English，390×844，hasTouch | 六条完整闭环/清理通过，其他原 67 条状态及内容不变 | `d6629add622519f532fbed8791b5d7d5c716b6eec6a08601405e0e1b20ad921c` |

私有 receipt 位于 `.artifacts/current-owned-notification-final-20261123-r4/test-results/`
下 `current-owned-product-noti-39342-state-before-native-cleanup-current-product-zh-mobile/`
和 `…-en-mobile/` 的 `product-notification-evidence.private.json`。
每格 **21/21** pre-run 源码副本重新核对哈希，执行 spec SHA 为
`b48319ad867d870ec8cf5a0acfa30f2ba7d02ed023091459b1ddb4782d5b4d32`。
每格四次真实 browser CSS 响应均为 6,015 字节、SHA
`949d52b67c38b672a4678c944fe810b4f5afd83085cf0d1ba4d8a33b715b4178`。
执行前后完整 runtime/config/mount 内容比较通过；中文格原始 mount hash 的排序差异
保留在回执中，canonical 完整 mount 记录未变，没有忽略实际挂载内容。

两格 console error、未处理页面错误、requestfailed、HTTP error 和 capture error
均为零。截图复核通知 popup 位于 390px 视口内，正文与操作区有空间，
普通实际 tap 能到达展开与单条已读控件。两格各六条动作 title 分别为
“标记为已读”和 “Mark as read”，通知正文仍沿用实际中文模板；
这些事实不等于所有通知/业务文案已完成英文验收。

两格用时 20.1 秒，无重试，所有会话关闭并释放窗口。旧 strict-URL 失败、
旧手机布局失败、首次显式回滚失败全部保持原始记录。
历史桌面 receipt 绑定旧 runner/静态版本，不代表新 CSS 后又跑了一次桌面业务验收。

### 当前 CSS 后新增桌面回归

主线随后在同一实际 CSS、Nginx、provider 与容器输入下，独占正常 UI 窗口新建
两组自有产品，分别执行中英文桌面创建、成员、编辑、刷新、新登录、
归档/激活、删除/恢复和精确产品/成员清理；两格均 PASS，原始错误为零。
使用这两份新的完整产品回执生成通知验收输入，未重复采用已删的旧桌面消息。

| 场景 | 产品完整回执 SHA-256 | 新通知回执 SHA-256 |
| --- | --- | --- |
| zh-CN 桌面 | `ae421b5bc6466a32ca598745688181132bce18c4773a04c6c5ad52fc7918d851` | `a8cb2108ca33a2fff8af7259984e03888aa9f4cdfc05a4ef556169324a51f50a` |
| English 桌面 | `7b2461649bc68be0c1624ec7019c8dfc4f65d9b142695f224c2c09660085a953` | `6806561e271b5dcdc49ffc0a6c885aad8a6c7d7acde742e3ba5628f6eb3c3349` |

产品回执位于 `.artifacts/current-owned-product-after-notification-style-20261123-r1/`，
通知回执位于 `.artifacts/current-owned-notification-after-style-desktop-20261123-r1/`，
均为对应 `test-results` 项目的私有 evidence 文件。
每格六条新消息逐叶普通点击已读，第二次正常登录 READ/完整内容读回，
随后精确原生 GET/DELETE、marker 验空；其余原有消息分别 73/67 条未变。
两通知格各封存 21 份源码并通过前后运行输入检查，全部五类原始错误为零。
该补证将当前 CSS 的桌面与手机四格闭合，但仍不关闭多角色或完整消息正文双语。

## 待决策/阻塞

- 本批管理员产品六事件的手机两格已完成，12 条原待验收通知已清理；
  此结论只覆盖上述明确流程与版本。
- 该管理员产品六事件验证不能代替通知角色矩阵、跨组织/撤销权限、
  评论提及/关注规则、外部钉钉/企业微信投递或 MQTT 实时链路。
- 单条已读 title 已分别观测到中英文；通知正文及其他动作的完整本地化仍单独开放。
  不声称产品或通知全部能力完成。
