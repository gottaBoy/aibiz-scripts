# 通知样式部分回滚恢复

检查点：2026-11-23。当前状态：**主线已执行独立恢复，两处原首页及 CSS 清理均验证通过**。
恢复执行期间，原通知 deployment executor、其测试及原通知文档保持冻结。
恢复工具及测试随后继续冻结；主线另行授权修正 deployment executor/test，
历史原始源码及回执快照均保留。本次恢复不运行用户 UI/API、数据库或容器生命周期操作。

## 手册要求

工作区规则要求保留失败证据，不用静态页面可打开替代业务验收；只操作本任务可证明
归属的资源，部署须核对实际服务字节、启动覆盖输入并保留恢复输入。
PP10/PF10 的真实通知送达、内容、接收者及权限验证仍独立存在。
本次恢复只处理静态发布异常，不关闭产品通知、手机布局或完整中英文本地化能力项。

## 本地实现观察

原两文件 CSS 候选已按旧计划成功发布，主线随后实测显式回滚。
回滚先恢复了容器首页，再在宿主首页发布前因 `File drift: scope` 拒绝。
原因是旧宿主适配器遍历完整 receipt 的所有键，将附属 `scope/path` 错当成文件属性。
原测试的真实宿主输入仅包含 compact 元数据，未覆盖完整成功 receipt。

原失败回执不修改、不删除，也不标成通过：

| 绑定 | SHA-256 |
| --- | --- |
| 原 plan，epoch `712fac50-bdce-47ad-9989-f2ecd8d65d9c` | `12f2053a42b7a84ac69320e6a2c60068f013aeda499cd0797c0bbbd7bc8fd33c` |
| 成功 apply receipt | `db065f40df6ab039233804fc5d83eb25e6f8fa43f76527fd4532606f3caeb938` |
| 失败 explicit rollback receipt | `977ca8cff046ea5444453b5670567c37168a69f53c9c319f2c6992a5a6b0ecf6` |
| 冻结旧 executor | `f9938dd14b2fc4f59a8278cc8ba453ebc5de87eee0aa802d4fd170303d570228` |
| 冻结旧测试 | `639a4eef9835afaea7db1832947bc01498addc94573ec59711c999ee8d4d26bb` |
| 冻结 startup helper | `ac06dccdb6e36179e9f6d385184cdbe22f65c5451aa0147e27e9cc8dd3e5e698` |

回执分别位于 `.artifacts/plm-notification-deploy-20261123-r2/`、
`.artifacts/plm-notification-apply-20261123-r1/`、
`.artifacts/plm-notification-rollback-20261123-r1/`。
回滚失败时的精确状态已由主线及本工具各自只读确认：

| 目标 | 状态 | dev | inode |
| --- | --- | --- | --- |
| host index | 候选 HTML，uid/gid 1000:1000，mode 664 | 66306 | 17350235 |
| host CSS | 候选 CSS，uid/gid 1000:1000，mode 644 | 66306 | 18272083 |
| container index | 原 HTML，uid/gid 101:101，mode 644 | 1048743 | 63356 |
| container CSS | 候选 CSS，uid/gid 101:101，mode 644 | 1048743 | 63354 |

候选 HTML SHA 为 `e3fb42281e0eeb22c128c94fb8c4f65e6e843212705431e75f0c6e15fdb33a19`；
原 HTML SHA 为 `1d12c09ece14b684dbf9e53f3bdd955fce9982ca1666afced5e23a02a5abc236`；
CSS SHA 为 `949d52b67c38b672a4678c944fe810b4f5afd83085cf0d1ba4d8a33b715b4178`。
HTTP 200 返回原 HTML。旧 epoch 的八个明确暂存路径均不存在。

### 独立恢复边界

`recover-existing-plm-notification-style.mjs` 静态绑定上述三个历史回执及旧 sourceSeal，
导入冻结旧工具的实际 I/O 和候选加载器。白名单 normalizer 只向实际适配器传递
`exists/bytes/sha256/uid/gid/mode/dev/ino`；附属 receipt 上下文不进入文件比较。
新建 stage 时只传已知的字节/所有者/权限，真实 dev/inode 须在写后重新读取封存。

工具只接受明确的 `--prepare` 或 `--apply`。恢复应用还要求新 plan SHA、epoch 和
`--trusted-exclusive-writer-window`。所有操作取得同一个本地 exclusive lock，
拒绝本工具同时运行；未知或残留锁不会自动删除，释放时核对自身锁的 inode/dev/hash。

该锁只协调本恢复工具。目标检查与 rename/unlink 之间仍依赖可信独占写窗口；
同一进程、固定 FD、fsync 和本地锁都不构成对外部不协作 writer 的原子 CAS。
本工具明确不作这类保证，也不扩展 C helper、容器配置或生命周期。

允许的恢复顺序仅为：

1. 核对旧回执、冻结源码、runtime/startup/config/mount、原始完整保留清单和精确部分状态。
2. 持久化恢复意图及原始逐步日志，只暂存并恢复 host index。
3. 核对 host 的新恢复 inode 和 container 失败回执中的原始 inode，确认两个原首页均未漂移。
4. 逐个删除仍匹配旧 apply receipt 精确 inode/dev/hash/owner/mode 的 host/container CSS。
5. 重新验证两个原首页、CSS 缺省、明确暂存路径缺省、完整保留清单和原 HTTP 首页。

stage 中断、无法确认的响应丢失或任何未知漂移都会停止，保留当前状态及日志。
若响应虽丢失但读回证实同一 stage inode 已发布或精确 CSS 已删除，保留原传输错误后
继续核验。未证明两个原首页恢复前不能清理 CSS；不递归删除、不重试未知写入。

## 当前版本验收证据

恢复测试 **15/15**，包含：

- 真实旧 host adapter 接收完整 `scope/path` receipt 时复现原缺陷，再经白名单修复通过。
- 正确部分状态的恢复顺序及 container index 的 inode 始终不变。
- host 已原始、container 仍候选、同哈希异 inode、CSS 缺失或 owner 变化、旧/新 stage 残留的拒绝。
- 缺失可信窗口、epoch/plan/lock/runtime/preserved 漂移和 intent fsync 失败的零写入拒绝。
- stage 中断、发布/删除响应丢失、读回失败、恢复后 index/CSS 漂移和重复采用的拒绝。
- 本地共同锁的并发拒绝，以及锁被替换时不删除未知锁文件。

命令：

```sh
node --test scripts/tests/recover-existing-plm-notification-style.test.mjs
node --test scripts/tests/plm-manual-reference.test.mjs
```

手册契约 **10/10**，`scripts` 的 `git diff --check` 通过。
测试只在私有临时目录模拟写入；其后的主线真实恢复结果见下节。
恢复测试读取这次静态绑定的历史私有回执；这些证据缺失时不能假造替代 receipt。

有效只读恢复计划：
`.artifacts/plm-notification-recovery-prepare-20261123-r1/prepared.private.json`，
epoch `6ecfd6fd-4dbd-43de-8aee-53d021485f90`，
SHA `2b365a8bd9db012047909076355b3f5ba1a505de7ac0edd27e04d0513d66c62d`，
状态 **PREPARED-NOT-APPLIED**。

| 新 sourceSeal | SHA-256 |
| --- | --- |
| 恢复 executor | `f9d5e38fa408bfa2242387313f9e68b5ca5283fde84a94e0380fed2fb15713f5` |
| 恢复测试 | `4c2fb8ab793e5ba8df9b754e115d3799b2e6f66fefa5a1f8a88fd2a45ae71e3d` |

只读准备封存了三个历史原始回执、三份旧源码、新工具与测试、原 HTML、
完整保留清单和精确四文件状态；代码与测试在生成计划后冻结。
两轮完整清单与旧计划一致：hostDist 37,815、containerDist 37,827、
plugin source 17,455、model source 13,723 个文件。
完整清单序列化 SHA 为
`be64f841347f57eb4c054de8524c4900c5f6e4b3c82fb35a8f5479b9ff69b3a2`。
新恢复 stage 不存在，读取后的共同锁已按自身身份释放。

### 主线实际恢复

主线在可信独占写窗口执行该已审计划：
`.artifacts/plm-notification-recovery-apply-20261123-r1/report.private.json`，
SHA `a86a9eb5be8025cfaeda02cb4affea84935d092326bac4274b4da7c4de25379f`。
状态为 **RECOVERED-BOTH-ORIGINAL-INDEXES-REMOVED-EXACT-EPOCH-CSS**，
传输错误与残留项均为空。主线没有把历史原回滚失败覆盖成通过。

host 首页恢复原 SHA，uid/gid 1000:1000、mode 664、dev 66306、
inode 17350234；container 原首页仍保持失败回执记录的 inode 63356。
随后精确移除旧 apply 的 host CSS inode 18272083 及 container CSS inode 63354。
两个原首页、CSS 缺省、暂存缺省、原 HTTP 首页及完整保留清单均重新验证通过。
未重启、重建或拉取镜像，未修改插件、模型、环境、用户或数据库。

完成后，主线终止了旧 deployment 源码的历史冻结并授权新的白名单与共同锁修正。
本恢复工具仍静态绑定旧 sourceSeal，不再作为修改后源码状态的通用恢复入口；
不能修改旧 receipt 或恢复测试以使它冒充新发布版本。新发布必须使用新的部署计划。
上述 15/15 是恢复源码冻结时的有效测试，不声称它在后续 deployment 源码变化后
仍可重新采用旧绑定。

### 恢复后的独立重新发布与手机验证

后续修正 deployment executor/test 的完整 receipt 白名单和协作共同锁后，
主线使用 fresh r3 plan 重新发布。apply receipt：
`.artifacts/plm-notification-apply-20261123-r2/report.private.json`，
SHA `5f66c1292e44e4219d3552a8a94899b48eaee386ed93b1d94200228c3c5d9e98`。
其 plan SHA 为
`0886bc6396abdc0b72c624fb41670684973836652e97e15b236cc512cc79d060`，
epoch `1615bbf1-b628-4e85-94a7-e4599b7e3244`。原两文件 CSS 候选未改，
旧失败与本次恢复 receipt 均保留，未重写恢复工具或其测试。

在该发布后的独占 UI 窗口，中英文手机实际触控两格均通过：
zh SHA `6c48a4741af05c89e9bb168e5fbad804d74990006127576ba5e2617c925f5cc1`，
en SHA `d6629add622519f532fbed8791b5d7d5c716b6eec6a08601405e0e1b20ad921c`。
每格六条实际 tap 已读、第二正常登录 READ、精确清理及其余消息不变，
原有 12 条待验收通知均已清理。源快照、实际 CSS、错误数组和边界见
`NOTIFICATION-REPAIR-20261123.md`，不将此业务结果写回或覆盖历史恢复报告。
主线还用两组新建自有产品完成当前 CSS 后的中英文桌面生命周期和通知回归，
每格六条新通知均已读、新登录读回与精确清理；完整新回执见通知文档。
这些后续业务结果继续保留独立来源，不修改本次恢复回执。

## 待决策/阻塞

- 独立恢复已完成；原回滚失败仍有效，不能声称旧工具已通过显式回滚。
- 修正后的 deployment executor/test 已使用新计划发布；本批管理员产品通知手机两格通过，
  仍不能代替通知全角色或完整本地化验收。
- 后续重新发布和手机验收须另建已审计划与本版本回执，不能沿用本次恢复计划作发布授权。
