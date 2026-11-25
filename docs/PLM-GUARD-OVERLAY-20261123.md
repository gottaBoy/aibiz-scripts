# PLM 登录守卫候选与原地发布

检查点：2026-11-23，Asia/Singapore（America/Los_Angeles 为 2026-11-22）。
状态：**私有四格产品闭环已验证；共享静态发布、显式回滚和再次发布已执行，
再次发布后的共享产品四格已通过**。
本说明不关闭 B01/B02、L01/L02 或其他顶层能力项。

## 手册要求

产品流程依据 `manual/PRODUCT-PROJECT.md`：保留归属、默认成员、合法生命周期和
Unicode 数据；创建、关联、状态迁移、跨会话持久化及清理必须分别验证。
激活、恢复使用权威模型已声明的原生动作，不能据此声称所有操作都从按钮完成。
管理员账号的闭环不能代替普通成员、只读成员、非成员或跨组织授权矩阵。

## 本地实现观察

共享 `30250` 实际加载的框架主文件是
`extras/js/@ibiz-template/vue3-components/index-g6zAWAF4.js`，
1,732,545 字节，SHA
`1afd4049c762b82de996233908d955eb896290b77ac844273829093303dd7fc8`。
其 `setAuthGuard` 只有验证回调，受保护路由仍在拒绝时调用 `next(false)`；
没有源码中已经存在的 `getLoginRedirect` 协议。
正常未登录入口因而保留真实 `Navigation aborted`，不能通过控制台过滤关单。

现有源代码已包含修复：框架登录重定向、可选自定义守卫回调，以及 PLM 将该回调
交给同一个 `StaticAuthGuard`。原始私有源码构建和前置浏览器证据见
`PLM-STARTUP-20261121.md`；本批没有再写一个运行时猴子补丁或注入身份。

当前 Nginx 将 `/ibizplm-plmweb/` 映射到容器 `/dist/`。
`plm-web/start.sh` 在启动时先复制宿主 `plm-web/dist`，再复制
`plm-web/public/plugins`，因此宿主输入、容器当前服务字节和下一次启动输入
必须分开核对。私有候选阶段没有覆盖其中任何一处；后续原地发布明确覆盖两个
范围的 17 个目标，详见下节。没有重启、重建或拉取容器。

新增可重复准备入口 `prepare-plm-guard-overlay.mjs`，复用已保存的
`.artifacts/plm-login-combined-20261121-r2` 源码构建输出。它生成：

- 14 个框架输出放入新的 `guard-8388128f7ab5b027/` 子目录；
- 新增应用 `static/js/index-legacy-d5b42c12.js`；
- 新增独立 import map，仅更改同一框架的 JS 和 CSS 映射；
- 以 HTML 语法树仅改原始 `index.html` 的应用入口及 import-map 引用。

共 17 个输出，其中只有 `index.html` 对应已存在的目标。
原 import map、环境、现有框架路径和全部插件保持当前服务输入；
历史候选中与当前服务不同的两个 `article-page` 生成模型明确排除。
私有服务对其余资源使用当前真实 HTTP 字节，API 透明转发到既有 `30250`，
不替换业务响应、身份头、组织头或失败状态。

源文件与构建关系仍有明确边界：框架 1147 个源文件与旧构建库存全部一致；
应用 4565 个记录源文件中有 3 个与当前工作树不同，分别是语言切换组件、
英文词典和登录布局 CSS。5 个直接守卫/引导源文件均与构建记录一致并已另存。
单体应用入口包含历史批次的其他变化；本候选不宣称纯守卫源码差异，
也不宣称重建了完整依赖源码闭包。不能用旧输出覆盖当前源码来消除这项差异。

## 当前版本验收证据

最终私有候选：
`.artifacts/plm-guard-overlay-20261123-r6/`。

| 绑定 | SHA-256 |
| --- | --- |
| `guard-overlay.private.json` | `3da977e7bba23bb938dc588bac051dcc83bed8e1c9b835e5911bd7ab091d02f9` |
| 17 文件输出库存 | `1a8c4c589a6ec70eabf8305501c4bccdd1d5f6f10641034fb53228e32ab238b9` |
| 准备/私有服务源脚本 | `77966520101a3a90241ff01cee435bdd5b2ecdee887ad74ee5396365ec750281` |
| 原始源码构建回执 | `4ca0225ac5cb8c0b9a2ab9763ae5a16cc3d97b3c1bbeca71c6ef5898fa29dd7b` |
| 应用构建源库存 | `328010d710fce9ff6ab72ecad5d65f03db42cf8e929158d69821f16b8f837a69` |
| 框架构建源库存 | `ef382c8795edb95de0267c22ba705d4fc89c2802d2cd3ea7a99793ba0c12b21a` |
| 新应用入口 | `73c3b12665039f6e1f6cb6e2f7e18a767eacd37f8f0d731ec362a59660606cc5` |
| 新框架主文件 | `690f8672edad28107ef0898c9990a0b7a86565d3a128da8c98ea5b71b9bc7839` |
| 新 `index.html` | `1d12c09ece14b684dbf9e53f3bdd955fce9982ca1666afced5e23a02a5abc236` |

解析并封存了 3231 个字面量可达静态文件，共 50,443,521 字节：
3214 个当前真实 HTTP 输入和 17 个覆盖输出。
静态图另外记录 10 处非字面量动态导入，不将模型/插件运行时加载误报为静态闭包。
3 个当前 CSS 已存在的资源声明仍返回 404：根路径登录头图、头像及 AI chat
`assets/gif/halo.gif`；声明与状态均保留。如果浏览器实际请求，私有服务返回
原失败状态。本批正常产品流程没有实际触发这些失败。

产品验证使用既有本轮管理员私有凭据，每个场景均重新正常登录两次，
严格检查 appdata 的账号/system/org。角色证据仍是管理员，
`ordinaryRoleAcceptance=false`、`roleMatrixAcceptance=false`。

每格实际完成：UI 向导创建含中文/emoji/组合字符的产品和默认管理员成员，
含引号、反斜线和换行的描述精确回读，普通 UI 编辑、刷新、第二会话读回，
UI 归档及原生激活、UI 删除及原生恢复，再通过正常菜单离开所有对象视图，
精确清理自身产品/成员并对 active/archived/deleted 和成员列表验空。

| 场景 | 运行 | 产品闭环与清理 | 私有产品回执 SHA-256 |
| --- | --- | --- | --- |
| zh-CN 桌面 1440×900 | r7 | PASS | `949e2d486a337f13e5c8f49f0b89b2bf949d29f9a1711b2f81a56a608d541a19` |
| English 桌面 1440×900 | r9 | PASS | `ffe9935dcb3f94eb588a7d9bb3d45b6f1a9b9f14b4071d716bc0c9e7a68bec89` |
| zh-CN 手机 390×844 | r9 | PASS | `b50799b82d684c4901059af1b378997532e5576fd1b427ef046251eeaa6a0b16` |
| English 手机 390×844 | r9 | PASS | `1de2e0b01462748791834e8afc02d0ccb99cb4180b70c9cc4269ca2ec1dea11b` |

回执目录分别为
`.artifacts/current-owned-product-lifecycle-20261123-r7/test-results/` 和
`.artifacts/current-owned-product-lifecycle-20261123-r9/test-results/` 下对应 project。
四格 console error、pageerror、requestfailed、HTTP 错误及采集错误均为 0；
每格绑定实际服务资源哈希和测试源哈希。r7 与 r9 的应用候选输出相同，
测试 helper/spec 因后续手机菜单和英文动作定位修正而有不同哈希，
不将其描述为同一测试源哈希的一次四格批次。

所有回执保存了完整前后 Mounts 原始数组及原始哈希。
Docker inspect 可返回不同数组顺序；按 Destination/Type/Source 排序后仍比较
全部原始字段，并检查容器 ID、镜像、StartedAt、RestartCount 和配置哈希。
四格这些内容一致。没有把真实挂载内容变化降级成顺序变化。

此前失败全部保留：共享 product r4 在保存按钮精确名称定位失败前已创建并清理；
r5 全业务阶段完成，但物理清理后仍打开对象页导致晚到 GET 500；
r6 补普通菜单离开对象页后仅剩旧框架预登录异常。
私有 r8 的英文归档名称预期不符，手机两格因默认图标菜单无文字而未进入写入；
英文产品已精确清理，手机无创建。r9 通过实际菜单展开/收起及模型声明的
button2 普通点击继续流程，没有 force click 或控制器注入。

轻量验证：覆盖包语法/映射契约 **4/4**，产品身份/所有权/运行输入契约 **8/8**，
迁移执行器独立测试 **9/9**，手册引用契约 **10/10**；
`scripts` 与 `plm-e2e` 的 `git diff --check` 均通过。
这些测试不加总为业务能力数量。

私有预览按主 agent 明确要求保留供审核，监听
`http://127.0.0.1:33973/ibizplm-plmweb/`，PID `1960995`。
所有 Playwright worker 已正常退出；没有再建立新的产品数据集。
服务在收到 SIGINT/SIGTERM 后会关闭端口并写不可覆盖的
`guard-overlay-server.private.json`。审核期间尚未生成该终态文件，不能声称服务已关闭。

## 共享发布与真实回滚

主线已审查 `deploy-existing-plm-guard-overlay.mjs` 及其 **22/22** 定向测试。
执行器绑定原容器、镜像、生命周期、配置、挂载、原 index inode/哈希、完整保留图、
新目标缺失状态和启动输入；候选逐个落盘核对，最后原子切换 index。
宿主 `plm-web/dist` 与当前容器 `/dist` 各 17 个目标一起留证。
本阶段只验证静态发布，不把 HTTP 字节相同当成业务验收。

以下均为实际执行，原回执保持不变：

| 阶段 | 私有回执目录 | 结果 | 报告 SHA-256 |
| --- | --- | --- | --- |
| 首次发布 | `.artifacts/plm-guard-apply-20261123-r1/` | 两范围共 34 项变更及 HTTP 字节验证通过 | `d0b4a817a5152f1b46558e188ca145efdad0b2497fd789909c9371c254e83202` |
| 显式回滚 | `.artifacts/plm-guard-rollback-20261123-r1/` | 两个原 index 恢复，仅删除仍匹配本 epoch 的 32 个新增文件 | `fd7b822599cb8eed57218b9ee98dc5152558802782d959816f5fa7ef440993eb` |
| 重新准备 | `.artifacts/plm-guard-deploy-20261123-r4/` | 已恢复的原 index 与新 inode 留证；两个范围的 16 个新增目标均缺失 | `ecd105b389d2dbe6db834fdf0a95ede10a42cead613aaf9679bd7c6a56d85bea`（计划 SHA） |
| 再次发布 | `.artifacts/plm-guard-apply-20261123-r2/` | 两范围 34 项及保留图再次核对通过；业务待验 | `778452df73926da38cadb9b3df880f03f4000cd03b1d46eb4369e8eddf68c306` |

再次发布 epoch 为 `ff8d6349-6914-49e8-a21a-89051715a20a`。
重新准备与上一份计划的运行配置、保留静态图、候选及源码输入相同；
原 index 已经实际回滚，按恢复后的 inode 重新绑定，没有沿用过期 inode。
没有更改插件、环境或数据库，没有重启 Nginx 或 Docker。
共享 `30250` 现已另跑以下新回执，未复用私有产品回执：

| 场景 | 新共享回执 SHA-256 |
| --- | --- |
| zh-CN 桌面 | `1b245d510e6071ba1d4911fc363ac0070670bcd51b230db9fa28f674d7683e28` |
| English 桌面 | `16077eb6ece1004833d4290aca190c936ec75dbe9d032fb9f01bc65f35258bfb` |
| zh-CN 手机 | `acb6ae5b79994132099bbe12eb05311f142d7ca1b6c6fcba21c3dc757297a556` |
| English 手机 | `528db7774b183a124d72b6b25f96b82509cb5132cd199f87e797828ffe49bd39` |

目录为 `.artifacts/current-owned-product-shared-20261123-r1/`（中文桌面）及
`r2/`（其余三格）下对应 project 的 `product-lifecycle-evidence.private.json`。
四格完整产品闭环、自有产品/成员清理及全部原始浏览器错误门通过，错误计数均为 0；
实际 index、应用和框架哈希与再次发布一致。四格采用同一 helper/spec 输入，
完整 runtime 比较只接受原始 Mounts 数组顺序变化，全部原字段均保持。
仍是当前管理员正向产品场景，未覆盖多角色，也没有关闭 O03 的完整发布范围。
这些早期回执早于后续视图主题代理和后端发布尝试，不能声称绑定后续运行输入。
源快照复核也发现：这四格当时记录了 helper/config 哈希，但未封存原始字节；
spec 当前字节仍匹配原哈希，可另存为迟到恢复副本，不能冒充运行前快照。
旧 helper/config 未找回的部分保持 `sourceSnapshotUnavailable=true`。
后续新批次须先封存输入再运行，不用历史通过掩盖该来源缺口。

最终当前运行输入下又完成了一批四格产品回归，先封存 11 项源输入快照，
并与当前 guard 资源及 provider 候选字节绑定：

| 场景 | 回执 SHA-256 |
| --- | --- |
| zh-CN 桌面 | `acd0d2af2d417b6f06091accd91e6d54abf5f3b942cd46a1d7e5b076db929ad1` |
| English 桌面 | `51b93a79ed072e05abf321325a7a1496ef967bea27627c3e0c9dc974aeef57fe` |
| zh-CN 手机 | `030b073d08952c736f5e02be5f96e9261cd12919e5e5f474db041cd0a00207ce` |
| English 手机 | `6c8b7bb42963f9581df543de7d0ccba0e294568f604eb64b4c93214f91938fe4` |

目录 `.artifacts/current-owned-product-final-20261123-r1/test-results/`。
四格创建、成员、编辑、刷新、新登录、归档/激活、删除/恢复和精准清理通过，
原始 console/page/network/HTTP/capture 错误为 0，
`sourceSnapshotUnavailable=false`。这批仍是管理员正向产品场景，不关闭角色矩阵。

随后通知首格只读取本批产品 marker 的自有消息，严格核对 receiver、owner、
system 和正文 marker；实际消息没有 `url/mobile_url`，无法证明与本批产品路由
绑定，因此没有打开通知组、标已读或删除。该失败证据保留，不能用正文 marker
替代缺失的资源 URL，也不影响发送历史审计。

## 待决策/阻塞

- English 归档按钮实际显示 **Archived Products**，动作应为 **Archive Product**。
  r9 回执保留 `archiveActionLabel.matches=false`；本批不声称本地化完整。
  手机截图已检查，业务操作可完成，但不扩展为全应用移动布局验收。
- 自有产品/成员已清理。此线没有删除本批产生的 internal notification；
  已将精确 marker 交主线按当前 receiver/marker 通过原生接口清理。
  发送队列/history 审计保留，不使用共享 SQL 删除。
- UI 自动消息读取实际 200 只能说明原生请求已到达；未以正常通知界面逐条断言、
  打开/已读/撤销本批消息，不据此关闭通知或 L02。
- 仍缺多角色、跨组织/资源、非法状态、子资源关联及完整 73 插件矩阵；
  私有四格产品正向通过不能关闭 25 项业务能力。
- 10 个动态加载边界、3 个继承 CSS 资源 404、应用历史源码差异及依赖来源边界
  均须保留在任何后续推广回执中，不能仅拿入口 hash 代表完整运行输入。
- 共享静态发布、真实回滚和新共享产品四格已执行；多角色及完整发布范围
  仍待验证。此守卫发布未改现有插件或配置。

下列窄范围推广及恢复顺序已经落实到上述执行器及回执；保留为恢复协议：

1. 重查原容器身份/镜像/StartedAt/RestartCount、Nginx alias、挂载、宿主复制和
   插件覆盖顺序；核对当前容器及宿主 `index.html` 仍为原始 SHA
   `16f8f8701ae5f78293d236cbc0074dd351b4b61e0c1bc5d080cf0e0db4c8eed2`。
   16 个新增目标仍须不存在；任一前提变化就重新审核，不覆盖未知修改。
2. 保留当前真实 index、原 import map、容器/宿主目标库存和上述回滚输入。
   先只放入 16 个新文件，逐字节核对；不修改现有框架、插件、环境或知识模型。
   容器 `/dist` 和宿主启动源均需纳入明确范围，不能只修当前容器而遗漏下一次启动。
3. 最后原子切换 index 入口，HTTP 核对 17 个输出，再重跑正常登录和真实完整产品
   闭环。新 import map/框架目录和应用哈希名使缓存不再引用旧守卫。
4. 若回归失败，将容器和宿主 index 恢复为 `rollback/index.html` 的原字节。
   只允许移除原先不存在且仍匹配本候选哈希的 16 个新增文件；遇到其他变化保留现场。
   不回退数据库字符集、不删除其他业务数据、不重启或重建服务来代替恢复验证。
