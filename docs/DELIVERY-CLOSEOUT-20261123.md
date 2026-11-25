# D/K/O 交付闭包只读审计（2026-11-23）

本轮交付 `audit-existing-delivery-closure.mjs`、聚焦测试及本文。未改任务总表、共享服务、部署执行器、镜像、数据库或原生市场记录；D01-D03、K01-K03、O01-O03 均保持未关闭。

## 手册要求

源码闭包、官方市场来源、干净主机重建及整栈恢复是独立平台能力，不由 PLM 手册目录承诺。12 组件最低范围沿用 `harness-required-source-gates.mjs` 的 `REQUIRED_D01_COMPONENTS`；23 目录沿用 `MARKETPLACE-SOURCE-INVENTORY-20261103.json`。同名目录、缓存 JAR/npm 包、编译完成、镜像锁匹配或文件级安装成功不能互相代替。

## 本地实现观察

工具复用既有版本 ledger、源码构建输入、CLI/runtime-model 构建回执校验器、官方包完整性校验器、镜像锁和固定目录读取工具。它逐项输出精确 revision/tree、脏状态及当前字节指纹；实现源码、模型、资源/清单和预编译/生成输出分别计量，保留 npm 依赖声明及 Maven/锁文件哈希。依赖声明和缓存分发包不被标为递归源码构建。

Git 输入执行两遍完整字节测量，并复核文件集、HEAD 和 status；旧脏文件再次修改，即使 HEAD/status 不变，也改变指纹。Git 对象不等于 checkout，符号链接、特殊文件、缺文件和预算耗尽均阻止 `inventoryComplete`。Git 子进程清除继承的 Git 环境覆盖，禁用 fsmonitor。

输入默认每组件 512 MiB、200,000 项，单文件 64 MiB；忽略的 node_modules/target/.artifacts 及凭据配置不作为源码枚举，因此这不是所有有效构建输入的完整闭包。维护版 UAA 使用已有 `sourceBuildInputs` 双遍测量；原生 CLI 使用原固定获取回执的非保护文件集和独立构建校验，二者均不伪造本地 Git revision。

`--live-docker` 只检查现存 Docker 元数据和当前自有 bind 输入。镜像锁按真实 Compose service 标签映射，避免将容器生成名误当 service。共享容器配置及挂载在结束时再次核对；挂载输入使用总计 2 GiB、150,000 项预算。完整源路径/文件集、私有失败原因仅存于 0700 输出目录内的 0600 回执，stdout/`summary.json` 使用字段白名单，不输出环境值、业务内容或原始 Docker inspect。

## 当前版本验收证据

最终审计与校验回执位于 `.artifacts/delivery-closeout-20261123-r3/`。退出码 **2** 表示完成只读审计但仍存在闭包缺口，不是“全部验收通过”。r1/r2 保留为前序观察，不覆盖或删除。

| 回执/输入 | SHA-256 |
| --- | --- |
| `report.private.json` | `659df11c9f1c89b3e4c7de90271edc3dbf982b001fd8d8e5948294bebeec3325` |
| `summary.json` | `8c8765b9f0448d79cb36fc9b02b75abf2a50f13916274c041c310dcb8b1ef970` |
| `validation.private.json` | `d73d1246682e1b7189847b8efcc62e4e7a63822a917c23a80cdb7b3c4fcc17e3` |
| 审计脚本 | `52a416f58f9239edf13a5871284e71d566189bdb2be49325a8d7d11841a68959` |
| 新聚焦测试 | `049ce8a556b439b34604f1277a555e790b852991bad0f2a6c0a8dd7db62659bd` |

当前审计工具为 Linux arm64、Node `v24.21.0`；11 项审计实现输入在完成后再次核对仍匹配。回执目录为 0700，报告/摘要/校验记录为 0600。

### 12 组件来源

下表是当前本地 revision，均不是自动推断的运行版本。许可证是选定范围的原始声明观察，不代表法律审查或传递依赖许可闭合。

| 组件 | 当前本地 revision / 来源 | 许可证与本轮结果 |
| --- | --- | --- |
| uaa-standalone | 无 Git；维护源码指纹 `0193ffcc91abdc899d2ee909fc0d303d330402fe859a89ed8ccdfeb9d9514cff` | 3,209 文件；重构兼容候选，原源码真实性/原许可未知；不冒充原始源码 |
| task | `2798cec3af49f778b0c72d40f4815d262611d8fa` | 选定根无 LICENSE；512 MiB 预算耗尽，输入清单不完整 |
| modeling-backend | `26e52348195586d25ebd3524e46968e4e5b59e8b` | 根 MIT；当前脏源码已测量，旧构建回执未提升为当前构建 |
| plm-backend | `8c0dd6bfd8a9362b23af354ae3047ef66533ebfc` | 根 MIT；当前脏源码已测量，未绑定完整项目构建 |
| allinone | `26e52348195586d25ebd3524e46968e4e5b59e8b` | 继承仓库 MIT，模块根无独立 LICENSE；递归依赖未闭合 |
| gateway | `26e52348195586d25ebd3524e46968e4e5b59e8b` | 继承仓库 MIT，模块根无独立 LICENSE；递归依赖未闭合 |
| plm-frontend | `171a169390b371f7e68232fab85f47de499af8ad` | 根 MIT；部分路径为链接/特殊输入，且达到预算，不计完整清单 |
| modeling-frontend | `2a0a24a685c8ee703925a4049daa736c789595b3` | 选定 app 根无独立 LICENSE；脏输入已测量，宿主/插件闭包未验 |
| app-framework | `a69afa9c0ead9d52d501fa28ce35361533a90d7e` | 根 MIT；预算耗尽；本轮未重建框架或递归工具链 |
| modeling-plugins | `2a0a24a685c8ee703925a4049daa736c789595b3` | 选定根无独立 LICENSE；142 文件包含生成输出，未升级为官方实现 |
| runtime-model | `2a0a24a685c8ee703925a4049daa736c789595b3` | 本地替代实现；既有重构构建回执当前只读复验通过，原源码/许可仍未恢复 |
| native-cli | 固定原始 commit `2277d0680777d5d147d912fecab779a6747807eb` | MIT；445 个非保护源文件及已保留构建通过独立复验；三个 .npmrc 排除、依赖源码构建和原锁等价仍未关闭 |

UAA “revision 不存在”和“源码不存在”不是同一结论；其本轮 50,747,513 字节输入被绑定为维护快照。Task、PLM frontend、AppHub 的预算失败同样不证明剩余源码不存在。完整逐文件未读清单和每组件 `missing` 保留在私有回执中。

### 23 官方目录

20 个完整本地 checkout 的根 LICENSE 均观察到 MIT，当前 revision 与历史目录记录一致；这不认证上游或已安装版本。下表路径均相对于 `extensions/upstream/`；各持久化 catalog ID、精确 PF `name@version` 及其缺口保留在摘要中，未改写。

| 目录 | 精确 revision | 当前来源观察 |
| --- | --- | --- |
| logic-design-standard | `0f82cebe561fadbe617d8b6d49e2a151d8b149ed` | 仅 Git 对象；2,950 个已提交路径未 materialize，当前 LICENSE 未读到 |
| form-design-standard | `2a0d5707a55a941eee95514586573749da5517a3` | MIT；6 个精确外部 PF 包未提供闭包 |
| view-design-standard | `7e0f765c896e1a8a31bc4fc8d3b3f4edc95ffb66` | MIT；6 个精确外部 PF 包 |
| app-view-creator | `356a4f2417ac9a4afaf584a0ab70c9f0ff4f9725` | MIT；1 个精确外部 PF 包 |
| workflow-design-standard | `e1702fb3bcd4d4a4a8245d70b8b76f4018cf6855` | MIT；6 个精确外部 PF 包 |
| menu-design-standard | `81107a48be2b822027aaf87c729f3a9de12e4a52` | MIT；3 个精确外部 PF 包 |
| er-design-standard | `13d7b692d31ad1b0c0dd426ef43d9da82c0c2358` | MIT；2 个精确外部 PF 包 |
| grid-design-standard | `9fc7009a1485deba4d4e10d12c3288efa1f4d959` | MIT；5 个精确外部 PF 包 |
| toolbar-design-standard | `6bd3ba48b9f95e08e9e8889eb56398373d59c7c8` | MIT；5 个精确外部 PF 包 |
| query-design-standard | `30ab6eed90a2a08328aedd3d1ed3a5cd97a6ed24` | MIT；4 个精确外部 PF 包 |
| tree-design-standard | `17b76f0596cff4a91ab6395ac0188a746bc81d0d` | MIT；5 个精确外部 PF 包 |
| data-flow-design-standard | `77dff50518be5c012428deac98b65a134a9c89fd` | MIT；4 个精确外部 PF 包 |
| md-design-standard | `636a30f6ab65aa0340a965f29ac6e35c0c6655ea` | MIT；6 个精确外部 PF 包 |
| dashboard-design-standard | `feeae45e0b30c46f32bb4f39c0302c1f63d255bc` | MIT；3 个精确外部 PF 包 |
| value-rule-design-standard | `6ade65e476619120fa9bd047eefb4dd3ce1c9d1d` | MIT；3 个精确外部 PF 包 |
| chart-design-standard | `0cdb43293b5a8eb993bbcd497fba3bb7ec2ba2fa` | MIT；5 个精确外部 PF 包 |
| bi-design-standard | `fc4a475e4efcf374a37eb6aad709df2a971fc807` | MIT；3 个精确外部 PF 包 |
| db-schema-importer | `5a32ce596f900d6894273fe7375d5ffc84b0e639` | MIT；模型内零外部 PF 引用，不代表无宿主依赖 |
| model-perspective-tool | `d0ef3450691bf8833b51c40bd97001bd2e8aff6e` | MIT；同一目录的两个真实本地交付版本完整复验通过 |
| modeling-plm-plugin | `d04e938964ac6a503a333dd08e508d3e7f41c976` | MIT；1 个精确外部 PF 包 |
| modeling-maintenance-tools | `d8364cd4eedd6e764b054979a3e21b3906f41e36` | MIT；1 个精确外部 PF 包 |
| `EXTENSION.ibizmodeling.ibizmodellibrary` | 未知 | 目录记录无本地路径，不猜测来源或许可 |
| `EXTENSION.ibizmodeling.ibizmodelincrementpackage` | 未知 | 目录记录无本地路径，不猜测来源或许可 |

PF 引用数是既有规划器对主 `PSSYSAPP.json` 的精确引用观察，不是全部生成器/宿主依赖计数。已打包的 model-perspective-tool 另外沿用其 main/simple/hub 三变体来源回执；两个本地版本仍是 **一个目录、同一上游 revision**，不能按两个已验收目录计数。

### 产物、运行与断网子集

- 两个真实本地包分别复验清单、全部 payload 字节、2,310 项当前核心来源、688 个宿主依赖 JAR、生成器/原生解析器/消费源码及工具链可执行字节。仍未认可递归依赖、宿主前端或原生市场安装。
- 12 个现存服务的实际 image ID 与既有 Compose image lock 一致，且均在 image retention 中；不是新发布或源码闭包证明。
- 40 个 bind 使用点中，36 个完成双遍测量，4 个因共享 2 GiB 预算未完成：PLM 插件目录、PLM readiness 脚本、Task entrypoint、Modeling nginx 配置。后三项是预算已耗尽，不声称文件损坏或缺失。私有清单保留所有来源路径。
- 本轮不发业务 HTTP，不取得新登录；`current-served-HTTP-byte-equivalence` 明确为缺口。镜像内静态文件、启动复制/覆盖顺序、named volume、动态配置也不被本次 bind 测量替代。
- 在新的私有 HOME、CWD、TMPDIR/cache 中，用现有 JDK17、`--release 11 -proc:none` 和 688 个预编译缓存 JAR 编译真实目录的三个核心 Java 类。seccomp 子进程实际确认 NoNewPrivs=1、Seccomp=2、联网 syscall EACCES；三个 class 均产出。r1/r2/r3 三次独立编译的三个 class 字节一致。
- 这是同宿主、局部源码重放，不是干净主机、完整组件 build、Maven reactor、整栈恢复或工具链源码重建。

### 测试与重复入口

新增 12 项聚焦回归通过；负控覆盖同 HEAD/status 下的脏字节变化、缺 checkout、预编译伪装源码、空/重复/越界/旧哈希/错大小清单、符号链接、预算耗尽、继承 Git 环境、伪造验收布尔值、重复范围及摘要私有字段泄漏。最初发现并修复清单非规范 `../source/LICENSE` 绕回路径和摘要缺字段容错，两项旧失败未称为通过。

在既有内核 guard 中连同真实官方包回归为 **15/15，0 失败、0 跳过**；文档契约检查另为 **10/10**。最终合并运行记录为 **25/25**，位于 `validation.private.json`，严格核对测试总数、退出码、0 失败和 0 跳过。不把这些测试数量相加为功能完成率；`git diff --check` 通过。

```sh
node scripts/audit-existing-delivery-closure.mjs \
  --live-docker --offline-compile \
  --output=.artifacts/delivery-closeout-NEW_ID

AIBIZ_OFFICIAL_MARKETPLACE_PACKAGE=.artifacts/owned-marketplace-packages/4a9bb362d8c1/package-local-r5 \
  .artifacts/offline-network-guard-20261122-7owT5G/offline-network-guard \
  node --test scripts/tests/audit-existing-delivery-closure.test.mjs \
  scripts/tests/package-owned-marketplace-offline.test.mjs
```

输出目录必须不存在。省略 `--live-docker` 不检查 Docker；省略 `--offline-compile` 不启动编译。两者均不执行 Docker 生命周期、pull、构建镜像、联网依赖下载或 SQL。阶段 journal 记录 PID、时间及当前组件/目录，长时间读取时可定位阶段，未反复叠加审计。

## 待决策/阻塞

| Gate | 本轮具体证据 | 未关闭的具体来源 |
| --- | --- | --- |
| D01 | 12 组件来源及依赖声明、两项现有独立构建回执复验 | 每组件完整 build、递归依赖/工具链源码、代码生成输入；三组件预算不足 |
| D02 | 12 镜像锁与当前 bind 输入子集、真实目录产物复验 | 各组件 source→artifact→image/current mount→实际 HTTP 全链 |
| D03 | 当前脏字节而非 commit-only 指纹、缺 checkout/预算明确失败 | ignored/未挂载有效输入、4 个未完成挂载和构建等价 |
| K01 | 20 checkout、1 对象仓库、2 未知路径及精确 PF 引用 | 上游真实性、全部已安装 revision、传递许可、PF 实现与递归构建 |
| K02 | 一个真实目录的两个本地文件交付版本当前仍有效 | 23 目录原生 OSS/系统源/合并/重载安装和宿主前端资源 |
| K03 | 沿用文件存储受控恢复边界，不提升历史结论 | 原生市场更新/失败/回滚、运行重载及业务数据/权限读回 |
| O01 | 内核断网、清空用户缓存环境的三类真实源码编译 | 干净主机完整 12 组件及递归依赖/工具链重放 |
| O02 | 无新数据库或整栈操作 | 当前整栈持久化备份、隔离完整恢复、schema/model 迁移重放 |
| O03 | 保留既有 image retention，不做候选推广 | 已审共享发布输入/恢复计划、整栈回滚及真实服务多角色验收 |

原始私有报告不提交。本轮只交付新增三个文件，未运行全量 harness、全量 scripts、整栈、原生市场或新数据库流程。
