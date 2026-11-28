# 人员选择器源码构建与窄发布候选

检查点：2026-11-29，Asia/Singapore。接续
[失败与重试修复](B02-PERSON-SELECT-20261126.md)，本轮补齐真实维护源码到运行文件的
可重复构建、四文件差异包及原生四格验收。共享 runtime 的两个生命周期竞态已在
现有容器内以单文件、零重启热修复处理；通知投递仍未闭合，B02/L02 顶层保持
未完整验收。

## 现有宿主窄发布与原生回归

在 r4 断网构建候选基础上，先完成只读 prepare r3，随后按同一 plan
发布到现有宿主 public plugin、host dist 和容器 `/dist/plugins` 三个范围。
没有重启容器、拉取镜像或修改 root index/import map。apply 回执：

```text
.artifacts/person-select-apply-20261128-r2/report.private.json
SHA-256 38c528953c5c09224e46baaaa57370117147035a25490f071c946f6f238b2402
plan 57c706ed55fd713a5516d2bbd7f4a0b4a3ed5e443b706c92c6657db6d26d125f
epoch a913bf59-a970-4cca-9716-11b52908fa9b
```

12 个文件均为已存在文件的条件发布，旧 uid/gid/mode 和非目标插件保持不变；
直接依赖、host/container 字节和 HTTP 读回通过。首次旧 plan 因手机布局发布后
inventory 漂移而在写入前拒绝，回执保留，没有插件写入。

真实中文桌面流程已完成创建自有需求、负责人搜索/Unicode 空结果、精确中止
一次已观察请求后真实 Retry、保存/刷新/新正常会话读回、语言切换和插件 ES/
legacy/CSS 实际加载；readonly、nonmember、crossorg 写入拒绝及自有需求恢复/
删除也执行。

当前 native 回执仍为 **FAILED**，保留真实问题：

```text
.artifacts/current-person-select-20261128-r10/.../person-select-evidence.private.json
SHA-256 e1948850765e10a4423bcae360758910cb716f40eefc1f6fe0c6e402231d4fe5
```

该旧回执的 recent 读取使用了会记录访问的默认数据集，且宿主有
`srfactiveviewdata` 状态错误。后续改用模型声明的 `fetch_recent_access` 只读投影，
并发布兼容的单文件 runtime 修复；新的四格回执全部通过业务、权限、清理和
console/network 门，但目标负责人仍没有产生可按权威模板解析的 owned
`idea_assignee` 消息。B02/L02 父项保持 PARTIAL。

新的私有四格回执位于 `.artifacts/current-person-select-20261129-r7/`：

```text
zh-desktop: PASS-NATIVE-PERSON-SELECT-CELL（r6）
en-desktop: PASS-NATIVE-PERSON-SELECT-CELL
zh-mobile:  PASS-NATIVE-PERSON-SELECT-CELL
en-mobile:  PASS-NATIVE-PERSON-SELECT-CELL
```

三格 r7 evidence SHA-256 依次为
`f34a3185320bfc03ebba24d1e920549a0027dbc99bda2e6cff4d9d9091631b7e`、
`664b0b6fb505f449b608c8afbccb03e9ebb76b7c12fa8dda11c4febb79705675`、
`3eda8651f7cde795ff41c58d4582b496c6e676ad3ddea68d049791bc758dd1bb`；
zh-desktop r6 回执保留在 `.artifacts/current-person-select-20261129-r6/`。
四格均记录 `unexpectedConsoleErrors=[]`、`unexpectedFailedRequests=[]`，
拒绝角色为 readonly/nonmember/crossorg，且 `sqlWriteCount=0` 的物理快照边界仍然
保留。`assigneeNotification` 均为 `NO-OWNED-MESSAGE-OBSERVED`，所以不能关闭
通知与完整 B02/L02 父项。

当前宿主 runtime 热修复回执：

```text
.artifacts/runtime-ctrlparam-hotfix-20261129-r1/report.private.json
SHA-256 9fd9e61583507552cf11f6f35098f33596183e2fd014e480cf357cdc8c7611ed
.artifacts/runtime-lifecycle-ctrlparam-hotfix-20261129-r1/report.private.json
SHA-256 a1b2346c1effa9fedd5e36f30684a7ba0d9ecb7d504a730a6a3b3af9123051e6
```

两个回执均为 `APPLIED-NO-RESTART`，容器 ID、镜像、启动时间和重启计数未变。

## 手册要求

[产品与项目规则](manual/PRODUCT-PROJECT.md) 要求产品成员、所属、可见性与需求关联
语义保持一致。工作区的双语和多角色规则另外要求：选择成员后真实保存、刷新和新会话
读回；只读、非成员和跨组织直接写入应被拒绝，拒绝后不得产生业务、版本或消息副作用。

搜索失败不能计为真实空结果；中英文、Unicode 查询、用户标识及业务名称需保持原值。
原生四格为中文/English 与桌面/移动触摸的组合。源码受控浏览器、构建一致性和
公开发布字节是独立证据，不能互相代替。人员插件的具体实现位置来自本地模型观察，
并非手册承诺了某个插件版本或内部实现。

## 本地实现观察

选择 `@ibiz-template-plm/person-select@0.0.3-alpha.434`，
维护目录为 `plm-web/plugin-src/@ibiz-template-plm/person-select/`。
完整维护输入为 19 文件、272,100 字节，指纹
`ad9a4c0afda7d14a7b7b1ad3913462aa555143f2c9f6e02481060edc6988ae23`。
该目录在本轮开始时与 PLM-web HEAD 一致；控制器注明由已发布 ESM 恢复，
不能据此声称是完整原始上游源码。

权威模型 `plm/model/PSSYSAPPS/plmweb/PSSYSAPP.json` 将该包绑定到
`PERSON_SELECT` / `IBizPersonelSelect`，表单样式为 `PERSONEL_SELECT_PRODUCT`。
锁定提交的 `tools/plugin-recovery/runtime-plugins.txt` 恰有 73 个唯一引用，
该包只出现一次；这只证明清单和本插件绑定，未验收其他 72 个插件。

真实宿主 `PSAPPDEVIEWS/idea_main_view.json` 的 `assignee_name` 是
`PICKEREX_TRIGGER`，单选并强制选择，`valueItemName=ASSIGNEE_ID`；
对应隐藏表单项及实体字段均是 `assignee_id`。请求为：

```text
POST products/${context.product}/product_members/fetch_default
USERMAP={"id":"user_id","name":"name"}
GET /users/fetch_default
AC mode=member_select
```

同一声明存在于 `PSAPPDATAENTITIES/idea/PSFORMS/main.json`、生成
`plm-web/src/publish/model/views/idea-main-view.ts` 和应用模型。
验收器既核对插件/显示字段，也拒绝错误的值字段绑定及非隐藏值字段。

`plm-web/start.sh` 先将 `LOCAL_DIST_SOURCE` 复制到 `/dist`，
再将 `LOCAL_PLUGIN_SOURCE` 覆盖到 `/dist/plugins`，最后启动 nginx。
当前 Compose 源声明分别只读挂载宿主 `plm-web/dist` 与
`plm-web/public/plugins`。本轮只核对源配置和本地基线，
没有将其当作当前容器配置或真实 HTTP 服务字节的证明。
后续发布必须同时绑定这两个宿主输入及现有容器 `/dist/plugins` 的精确旧字节，
并核对覆盖顺序和回滚。

## 当前版本验收证据

新增工具 `scripts/prepare-person-select-closeout.mjs` 只接受新的、直接位于
`.artifacts/` 下且祖先没有软链接的私有输出目录。它快照维护输入、权威模型、
启动入口和两个本地运行基线；在两个新私有工作目录中真实调用锁定 HEAD 的
`buildOne(parsePackageRef(...))`，没有改包脚本或用发布包冒充源码构建。

实际构建工具取自 PLM-web 提交
`fd33baa8866686363503a54c75d9f9175427a242`，SHA-256
`b61739baf08120338674ed1146b7a49f692c4e3ed0adea64522ba3784cd7bb03`。
工作区该工具另有未提交改动，本轮刻意不使用或覆盖；其观测哈希保留在计划中。
根 package/lock/73 清单也从该提交导出，模型和维护输入按实际字节封存。

构建使用已有 Node v24.21.0、Vite 4.5.0 和本地缓存，没有安装依赖或联网更新。
依赖图绑定 269 个缓存分发包、9,543 文件、115,608,981 字节，
指纹 `b5dd4541289cc0246209580c553ed9f69b2a695415abb203a2dbefc72f41b78d`。
两轮均使用已锁定的 seccomp 断网包装器，子进程内确认
`NoNewPrivs=1`、`Seccomp=2`；每轮有独立 HOME/TMPDIR/cache、日志、
25 秒阶段输出及两分钟进程组超时。没有 Docker 操作、账号登录或共享发布。

最终 r4 开始 `2026-11-28T07:14:13.708Z`，结束
`2026-11-28T07:14:18.227Z`，两轮退出码均为 0。
两个独立目录生成的 11 文件、301,229 字节完全相同，指纹
`262303b6a26d063c0c9c0135a598e7784f3eabf960f11c39577a3425307963ac`。
这包括真实 ES、SystemJS、polyfill、两份 CSS 及六张源码图片；
完整文件清单和每文件哈希保留在私有回执。

相对 public/dist 的两个当前基线，窄 payload 均只需以下 4 文件；
基线各 18 文件，另外 14 文件原样保留，不删除文件、不重写元数据。

| 相对本插件 dist 的路径 | 字节 | 新 SHA-256 |
| --- | ---: | --- |
| `index.es.js` | 28,329 | `2d28466b0dafd0f8fe0e5d3687d1db6aad7860fd9269c9ff6add487d7d339b46` |
| `index.legacy.js` | 20,467 | `fcdb109cf78b8dad3aac4be933e391ca099f9e4520078ccd6c63c4300e591420` |
| `style.css` | 7,694 | `be1f9624149682e30486a94889182323ab2eeeeca39da053c2a4a5a2b29fbff1` |
| `assets/style.css` | 7,694 | `be1f9624149682e30486a94889182323ab2eeeeca39da053c2a4a5a2b29fbff1` |

差异包共 64,184 字节，指纹
`ea347bc5833e581b0137c8b56dc72c689db76a41b1211de9947fbab51a9dd32f`，
位于 r4 的 `payload/plugins/@ibiz-template-plm/person-select@0.0.3-alpha.434/dist/`。
两份回滚树绑定本轮实际旧字节，包含已经存在的 CSS 改动；没有覆盖或回退其他人修改。

TypeScript AST 检查确认单个真实 SystemJS 注册，导出恰为
`IBizPersonelSelect`、`default`。与两个基线的七个裸依赖完全一致：
`@ibiz-template/runtime`、`@ibiz-template/vue3-util`、`vue`、`lodash-es`、
`ramda`、`@ibiz-template/core`、`qx-util`。注册的依赖名不含临时目录或绝对路径。
该检查没有证明这些 external 的真实服务文件或浏览器加载成功。

私有证据根为 `.artifacts/person-select-closeout-20261128-r4/`：

| 回执 | SHA-256 |
| --- | --- |
| `report.private.json` | `a80541e362abf583e709df4739cd72ba019707bdde33dd1c795cb67f99745934` |
| `plan.private.json` | `152942ba21c643e21445330f8d8a8ca0840710ab52c8516cc8f328d589e10503` |
| `native-browser-plan.private.json` | `adc922fbb4595677ea28b35a5d3a07a2de0d0afbcd17f218e610349adeee9463` |
| `verify-independent.private.mjs` | `602823987ba7c88c2dbb7925b2ffcdc22a386674db4c8f7cc2778d9109b9932a` |
| `verification.private.json` | `068f9aaf0f3326ac73df5e04a4f2906dc5bd01a729a884823df73844944cd7d4` |

独立复核入口是同目录 `verify-independent.private.mjs`，不调用 producer 的
库存或差异函数，重新读取源码/快照、锁定提交工具、八个模型/启动证据文件、
全部缓存分发包、两轮产物/日志/隔离记录、两个本地基线/回滚树及精确 payload。
它另外解析实际 SystemJS 导出和依赖，并确认两个构建 PID 已退出。独立回执
`verification.private.json` 单独保存，不修改 producer 回执。本次独立复核于
`2026-11-28T07:17:56.974Z` 通过；实际 PID `2784576`、`2784618` 均为 `ESRCH`。

保留以下失败和边界：

- r1 真实 Vite 已转换八个模块，但 eval 启动器的 `--input-type=module`
  被 terser worker 继承，导致 CommonJS `require` 失败。工具改为普通私有
  `.mjs` 启动器；没有修改插件以绕过失败。
- r2 两轮真实构建及产物一致性通过，检查器未识别带括号的命名
  `System.register` factory 而失败。增加 AST 括号解包及负向测试，保留原日志。
- r3 是首次成功构建与独立复核；r4 加入值字段/隐藏字段的权威绑定检查，
  所有 11 个生成文件及 4 个差异文件与 r3 一致。旧目录没有覆盖。
- Vite 的 formats 配置提示和过期 caniuse-lite 提示保留；没有联网更新。
  此 Vite 路径不生成 DTS，原有七个类型声明原样保留。前批八条类型诊断继续开放，
  本次运行成功不能称为类型零错误或声明重建通过。

本轮工具测试 6/6，覆盖目录边界、真实源码哈希、权威绑定及错误映射负控、
窄差异/保留/路径穿越拒绝、真实 SystemJS AST 和诚实的未执行原生计划。
手册轻量测试 10/10，已有实际源码风险回归 37/37。重跑命令：

```sh
node --test scripts/tests/prepare-person-select-closeout.test.mjs
node --test scripts/tests/plm-manual-reference.test.mjs
node scripts/prepare-person-select-closeout.mjs --output .artifacts/person-select-closeout-20261128-r5
cd plm-web
node --test tools/tests/person-select-followup-20261126.test.mjs tools/tests/person-select-binding.test.mjs tools/tests/frontend-workflow-locale.test.mjs
```

重跑构建应使用符合小写目录命名规则且不存在的新输出，例如
`.artifacts/person-select-closeout-20261128-r5`；不能复用已有目录。
工具与文档测试不启动 Docker。完整 scripts 全量测试未运行。

## 待决策/阻塞

本轮没有遇到新的插件源码构建阻塞，但还缺现有容器/HTTP 字节绑定、精确发布与恢复，
以及真实业务原生四格。生成的原生计划没有执行，不称为浏览器验收。
下一步在已核对的现有运行环境中按正常 UI 导航进入 `idea_main_view`：

1. 绑定实际登录身份、真实成员关系及候选服务哈希，在自有产品下创建一个自有需求。
2. 打开真实负责人编辑器，观察真实非空成员请求、搜索、分页，选另一真实成员并保存；
   API 与新会话 UI 读回同一 `assignee_id/name`，刷新与语言切换不改值。
3. 分别验证 Unicode 查询、真实空态及仅中止一次精确已观察请求的故障场景；
   重试保留 query/page 并回到真实服务，不注入伪造成功数据。
4. 只读、非成员/跨组织直接写入均被拒绝，独立读回业务值及版本/recent/message
   不变；恢复原选择并删除自有需求和精确自有通知，核对三个数据集、按键缺失及无关数据。
5. 中文/English、桌面/移动触摸四格记录 console/page/Promise/网络/业务原始错误，
   只将精确注入的故障归为预期；不得强制点击或注入运行控制器。

依赖缓存分发绑定不等于递归依赖/工具链源码闭合，也不等于干净主机离线重建。
本插件原生通过后仍不能关闭全部 73 插件、多角色完整业务和 L02 全语言输出门槛；
本轮没有调整 25 个顶层项的状态或剩余数量。
