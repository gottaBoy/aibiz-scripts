# B03/L03 真实宿主发布与验收

检查点：2026-11-26，America/Los_Angeles。文档已由主线精确安装到现有共享输出，
静态双语四格通过。原生 r1 因部件销毁竞态失败；修复后的 runtime 已实际发布，
r2 正常登录、原生嵌入、刷新及实际 runtime 字节通过，但深链被过时默认导航覆盖，
整格失败，其余三格停止。默认导航源码修复已通过聚焦回归并冻结，待新构建/发布。
B03/L03 没有关单。
本工作没有 reload Nginx、pull/create/restart Docker。

下列准备章节保留安装前观察；实际安装和新回执见文末，不能将旧观察当作当前输出。

## 手册要求

Development/API Reference 不在 PLM 手册的 125 页目录内，需要独立能力验收。
[25 项方案](REMAINING-25-SOLUTION-20261123.md)的 B03 明确要求真实宿主嵌入、
自有对象上的 API 正反向执行、拒绝副作用和清理，以及双语/手机/刷新/深链。
发布静态文档是前置，不能据此关闭 B03 或 DTO 的运行序列化门。

本轮查到的任务合同要求“受控 API 执行”，没有另行发现必须提供网页
Try It 控件的权威规格。目前文档脚本仅请求本地 `search.json`，没有业务请求编辑/
提交器。不能把静态模型相对路径称为可运行 API，也不能删除 API 执行验收门。

## 本地实现观察

PLM 的权威 HTMLView 与已提交前端视图都声明：

```text
./doc/#/api/ServiceAPI/ServiceAPI
```

模型文件为
`plm/model/PSSYSAPPS/plmweb/PSAPPDEVIEWS/ps_core_prd_func_api_show_html_view.json`，
SHA-256 `d4e6c8c3d472d389a6f922f395d9dd60e2f1d7b908e532fcde050eb4ac85ae65`。
已提交前端视图 SHA-256 为
`e6439055efd914bb32bc55a929ec82c4e09dbbe71036da482f7fb028042e6c2d`。
准备时工作树与这两份 HEAD 字节相同，没有修改导航/模型。

实际 Nginx 的 `/ibizplm-plmweb/` alias 到 `/dist/`，因此文档静态前缀为
`http://127.0.0.1:30250/ibizplm-plmweb/doc/`；裸 `/doc/` 返回 404。
准备时正确前缀首页是旧 4310 字节，SHA-256：
`b19fe10398a6b0963a9f28595c4e5ea6c53a1a54ffddb49360905daece50592c`。
新搜索脚本、local-theme.css、manifest 与双语 ServiceAPI/search.json 均为 404。
这证明准备时维护源码已提交仍不代表宿主已提供它们。

现有 `plmweb` 容器 ID：
`70327c269425370bed8648bcaa90feadf441ff7a6c5f75b975889cf4c5416612`；
镜像：
`sha256:027de06a1f8d8d5e44e17b849d44d39a421c6fe0787433b5e229ba00655ca99c`。
`/dist` 是 tmpfs。宿主 `plm-web/dist` 只读挂到 `/opt/aibiz/local-dist`，
启动脚本先复制它到 `/dist`，再覆盖插件；启动脚本本身没有 bind。
只更新容器会在未来启动时丢失，只更新宿主不会立即更新服务字节。

既有 `plm-web/vite-plugins/local-documentation.ts` 已提供完整
`publishDocumentation`，构建插件也已接入生成器。本批复用其 HEAD 版本，
没有新建文档发布框架。当前 `ibiz-vite-plugin.ts` 还有其他工作树差异，
候选不使用该脏副本。

## 当前版本验收证据

执行：

```sh
node --test scripts/tests/prepare-existing-api-documentation-release.test.mjs
node scripts/prepare-existing-api-documentation-release.mjs \
  --output .artifacts/api-documentation-release-20261126-r1
```

定向 **3/3**：精确运行实例/只读挂载绑定、输入拒绝、保留旧 Data Model、
只选差异及 index 最后。实际准备命令成功，状态为 `PREPARED-NOT-PUBLISHED`。

候选和所有生成输入只取下列提交：

| 仓库 | HEAD |
| --- | --- |
| plm | `8a13b29cdc21832366c31d7c1103dae7ce4018da` |
| plm-web | `fd33baa8866686363503a54c75d9f9175427a242` |

复用 HEAD 的 DTO 依赖遍历、逻辑输出发现、生成器和 publisher。
实际生成输入 **184**，重复生成 **365** 文件全部相等；干净 manifest
仍为 `c702697ddf10178181e095df1a85f071388bd64b54c5d18b4408779ac0082ff2`，
与前两批干净导出一致。两份历史脏模型未进入本候选。
完整 `payload/doc` 共 **9530** 文件、**64,229,428** 字节，包含现有文档与所需资产。

宿主和容器各有 **369** 个待更新路径：

- 新增 365 个生成文件、`css/local-theme.css`、`script/aibiz-api-reference.js`。
- 覆盖 `css/main.css` 和 `index.html`。
- 其余 9161 个旧文件保持；即使后续发现 existing-only 文件，计划也不删除它。

两处旧文档分别有 9163 文件，完整 tar、内容哈希及 uid/gid/mode/dev/ino
已独立封存。准备前后重复核对宿主清单、容器元数据/完整 tar、运行实例、
HEAD、根首页、environment、启动脚本和 Nginx，均未漂移。
启动和 Nginx 的实际 SHA-256 分别为：
`c8d01f1f35bfd2fbb219d00facbc3b39ed1e81415108bd93f023dce90fd4d97d`、
`64e92ebc923fb6bef7acc0ba296a92124d55c5f97db9f4e63779e585cee63e46`。

私有目录：
`.artifacts/api-documentation-release-20261126-r1/`。

| 产物 | SHA-256 |
| --- | --- |
| `plan.private.json` | `137e2b2f90748cbe4a40b951b71e9cbb7e6691f70f6a56aa0ebc647de183b03c` |
| `rollback/host-doc.private.tar` | `511f984812eed6dc7a1529fcf5608c0402f7958794e8f8a7af8ef6ab2ac41e60` |
| `rollback/container-doc.private.tar` | `cf6dde076c5797a349c1b7b2bbc2b1133e5fc8f685241d8581fe695d7f740e94` |

目录实际占用约 417 MiB，包括源导出、候选、两份完整备份和私有恢复副本；
没有启动额外服务、浏览器或容器。共用的通知发布锁在准备退出时已释放。

## 待决策/阻塞

安装前由主线审查该精确计划，再使用既有通知发布 common lock/元数据策略：

1. 重查容器、源提交、候选哈希、受影响旧文件元数据和所有 preserved 输入。
2. 只为 delta 建所需目录并在目标文件系统暂存；新目录 755、新文件 644，
   已存在文件保留原 uid/gid/mode。临时文件必须独占创建。
3. 每次 rename 前重查旧文件与暂存哈希，先装非 index 文件，
   两处 `doc/index.html` 最后安装。不得替换整个 doc 或修改应用根 index。
4. 从准确前缀读回每个已装 delta 并对比候选；保存已安装 inode/元数据，
   再校验 preserved 输入。静态 alias 不需要 Nginx reload 或容器重启。
5. 如失败，仅在文件仍精确属于本次安装时恢复其原备份；只删除本次新文件，
   再移除空的自有目录，不执行递归删除。

原 preparer **没有共享写入入口**，原 r1 计划保持不变。后续明确授权后新增
`deploy-existing-api-documentation-release.mjs`，只消费该候选的精确 delta，
并生成单独可执行计划，没有将原 `PREPARED-NOT-PUBLISHED` 回执改写为已发布。
协作锁不等同内核原子 CAS，实际安装仍需可信的独占写入窗口和明确应用回执。

### 可执行计划

执行器复用现有 `notificationHostMutationProgram` 的独占暂存、文件元数据核对、
fsync 和条件发布逻辑，共用静态发布锁。文件路径限制在本次生成文档、
两个 CSS、搜索脚本及文档 index；根应用 index、Nginx、启动、model、plugin
没有写入口。旧文件保留原 uid/gid/mode，新文件和新目录分别为 644/755。

不确定 stage 未取得可验证 inode 时保留，不猜测删除；
不确定 rename 在目标与已验证 stage inode 完全匹配后才视为已提交，并仍记录失败/
恢复。发生失败先恢复两处原 index，再有条件恢复旧 CSS、删除精确自有新文件，
最后只移除空且 inode/owner/mode 匹配的新目录。外部改动保留并明确标记未完成恢复。
源、测试、锁实现、预备工具、备份、候选、运行实例和非 delta 文档均参与绑定。

定向执行器与候选检查合计 **20/20**，覆盖成功顺序、即时读回、未知文件保留、
丢失 stage/rename/目录响应、HTTP 错字节恢复、源/运行/锁漂移及编辑计划/回执拒绝。
所有旧备份在任何共享写入之前核对大小和哈希；备份损坏会提前拒绝。
只读检查确认当前 BusyBox `ln`/`mv` 支持本工具实际使用的 `-T` 选项，
未在共享输出试写。

实际只读 prepare 已成功：

```sh
node scripts/deploy-existing-api-documentation-release.mjs --prepare \
  --candidate .artifacts/api-documentation-release-20261126-r1 \
  --candidate-sha256 137e2b2f90748cbe4a40b951b71e9cbb7e6691f70f6a56aa0ebc647de183b03c \
  --output .artifacts/api-documentation-install-prepare-20261126-r2
```

可执行计划：
`.artifacts/api-documentation-install-prepare-20261126-r2/prepared.private.json`，
SHA-256 `1a33214a9e96de7a6ef146c824c134e95e90d15578580166a8bb2cc9d93b7140`，
epoch `9da40aac-642b-42c1-b44f-e34d9f7f1865`。
六份源码/测试/helper 以 0600 独立封存并事后比对当前字节，
四份实际覆盖旧文件也逐一绑定原哈希。两处各 9161 个非 delta 文档指纹均为
`9be9d5dae1d5cc109f662b01d1b283f79849cf30b9c21feaeffb066a012d4421`。
该 prepare 回执仍为 `PREPARED-NOT-APPLIED`，没有创建共享目录或文件。
早期执行器 r1 prepare 保留；备份提前校验修复后以 r2 重新绑定源码，
旧 r1 不再用于当前源码的 apply。

审查后由主线执行的精确 apply 命令为：

```sh
node scripts/deploy-existing-api-documentation-release.mjs --apply \
  --plan .artifacts/api-documentation-install-prepare-20261126-r2/prepared.private.json \
  --plan-sha256 1a33214a9e96de7a6ef146c824c134e95e90d15578580166a8bb2cc9d93b7140 \
  --trusted-exclusive-writer-window \
  --output .artifacts/api-documentation-install-apply-20261126-r1
```

显式回滚使用同一 plan/SHA、`--rollback`、实际应用 `report.private.json`
及其 `--apply-receipt-sha256`，写入新的 rollback 输出目录。
未产生应用回执之前不提供虚构回执哈希或声称已验证共享回滚。

### 真实安装与静态四格

主线实际使用 r2 计划完成安装，回执为
`.artifacts/api-documentation-install-apply-20261126-r2/report.private.json`，
SHA-256 `c28496aa9141edaafa5db09281afeefd1ee0016890f99da2b72fdd8f0042d314`。
状态为 `APPLIED-STATIC-DOCUMENTATION-NATIVE-ACCEPTANCE-PENDING`；
738 次写入，transportErrors 为 0。开始/结束分别为
`2026-11-26T19:19:02Z` / `2026-11-26T19:30:55Z`。没有重启服务。

随后执行：

```sh
node scripts/probe-existing-host-api-documentation.browser.mjs \
  --plan .artifacts/api-documentation-install-prepare-20261126-r2/prepared.private.json \
  --plan-sha256 1a33214a9e96de7a6ef146c824c134e95e90d15578580166a8bb2cc9d93b7140 \
  --apply .artifacts/api-documentation-install-apply-20261126-r2/report.private.json \
  --apply-sha256 c28496aa9141edaafa5db09281afeefd1ee0016890f99da2b72fdd8f0042d314 \
  --output .artifacts/host-api-documentation-20261126-r1
```

真实共享静态前缀的中文/English、桌面/手机四格均通过。每格检查旧 URL 跳转、
全文字段搜索与锚点、刷新保留、方法联合搜索、IME Enter、正常 Enter、语言切换、
原 Data Model 首页和无水平溢出；原始 console/page/HTTP/request 错误均为 0。
控制一次无效索引并通过真实宿主 retry 恢复也通过，明确不作为 API 拒绝证据。
7 份关键响应字节与已安装候选一致，包括 manifest
`c702697ddf10178181e095df1a85f071388bd64b54c5d18b4408779ac0082ff2`。
运行实例、源码及快照前后未变；没有另起私有静态服务。

静态回执：
`.artifacts/host-api-documentation-20261126-r1/report.private.json`，
SHA-256 `aa39b8f9259a256a6efb171cc2ef905348d578cbf5ba161ec49c6eb839239957`。
状态刻意保留为
`PASS-SHARED-STATIC-DOCUMENTATION-HOST-EMBEDDING-AND-API-PENDING`，
`parentAcceptance=false`。
探针单元测试 **2/2** 通过。

### 正常账号原生验收 r1

新增 `plm-e2e/playwright.current-api-documentation.config.ts` 和
`plm-e2e/tests/current-api-documentation.spec.ts`。复用正常 UI 登录与真实应用头观察，
未注入 token、控制器或用户身份。只使用授权私有账号文件，不提交其内容。
四个项目串行、零重试、`maxFailures=1`。

实际执行：

```sh
PLM_CURRENT_PRODUCT_CREDENTIALS=/absolute/private/credentials.json \
PLM_CURRENT_API_DOCUMENTATION_ARTIFACT_DIR=/absolute/private/artifact-dir \
npx playwright test --config playwright.current-api-documentation.config.ts
```

中文桌面从“二次开发”原生菜单和“接口说明”tab 进入，iframe 确实属于
`ps_core_prd_func_api_show_html_view`，加载真实共享 `/ibizplm-plmweb/doc/`。
字段全文搜索、刷新与已认证深链回到同一原生视图均通过。
随后正常产品 wizard 创建一个最小自有产品，真实 `GET` / `PUT` 精确读回中文、
emoji、组合字符、引号、反斜线和换行。匿名 `GET` / `PUT` 均返回 401；
每次拒绝后由原会话读回，名称及描述未变。最终按精确自有标识和记录 ID 删除
成员及产品，活动/归档/已删除三数据集均无该对象，成员读回为空。
这些只证明一个代表性 DTO 子集，不代表全部 API 或角色矩阵。

该格仍为 **FAILED**。完成 wizard 后，在清理前正常返回“产品管理”时，
浏览器记录两条 `TypeError: Cannot read properties of null (reading 'name')`：
一条基础部件，一条经过 `number-grid`。trace 时间分别为
11437.734 / 11438.093 ms，菜单点击为 11337.013 ms。
实际加载 runtime 的出错表达式为 `this.view.name`，对应维护源
`ibiz-app-hub/packages/runtime/src/controller/common/control/control.controller.ts`
的 `onCreated()` triggerKey 初始化。初始化经历异步等待，返回产品管理时 view
已清空；需要修复初始化/卸载竞态，不能仅让 `undefined` 进入 triggerKey。
原生文档阶段没有这两条错误，但整格不据此放行。
pageErrors、failedRequests、httpErrors、captureErrors 均为 0；
运行实例/完整挂载内容比较通过。

私有目录：
`.artifacts/current-native-api-documentation-20261126-r1/`。
`api-documentation-evidence.private.json` SHA-256：
`4733df2a9b852d0cc3b33f03e276dee898e314101d2dbe269d9508ca83ff5e71`。
原始 trace、截图、分阶段写前日志和执行源码快照均保留私有。
中文桌面失败后，其余三格未运行；正常账号窗口及浏览器均已释放。

### 剩余门

- 发布并真实验证下述 runtime 初始化/卸载竞态候选。
- 在修复后的精确运行字节下重新完成原生中文/English 桌面/手机四格，
  保留每阶段原始错误门、刷新和深链证据。
- 按 AGENTS 多角色规则补实际业务身份读回；管理员和匿名 401 的范围分别保留，
  不将其外推为普通成员、只读成员或非成员权限证据。
- L03 两处方法声明、一个嵌套来源和更广的实际 mapper/序列化范围继续开放。

### 竞态源码修复和待发布候选

本轮竞态源码补丁仅修改 `common/base.controller.ts` 和
`common/control/control.controller.ts`。基类使用受保护的 `isDestroying`，
在销毁开始即取消未完成初始化；部件在异步 `super` / provider 之后检查生命周期。
取消通过模块私有 Error identity 沿 `MD -> Grid -> number-grid` 的
`await super.onCreated()` 退出，只有公共 created/mounted 边界识别该信号。
真实初始化错误保留原对象继续抛出。没有用可选链构造带 `undefined` 的 triggerKey，
也没有把已取消初始化标记为成功、安排强制挂载或晚注册 scheduler/消息监听。

`scripts/tests/control-controller-lifecycle.test.mjs` 执行真实 Base、Control、CTX
以及派生类的维护生命周期方法，使用真实延迟 provider 和实际 `CTX.destroy()`：
当前源码 **14/14** 通过；封存原源码负控 **5 通过 / 9 失败**，复现相同
`null.name`、销毁后晚注册及定时器问题。活跃 provider 和派生列初始化错误均按
原 identity 拒绝。私有回执为
`.artifacts/control-controller-lifecycle-20261126-r1/report.private.json`。
主线已提交源码到
`ibiz-app-hub@cdef0bf6140ca6ead76c51dc73d66366534de1f6`，
源码 SHA-256 仍分别为
`2d32f2bdab148af6cc8b0033df5541e4549468f2d3f07e42317de2f6b7dea594` /
`0686501e3286910974eee8dd6ebf4b6a2575c1c4899c50402ef711eebb076075`。

D01 agent 的 r10 七包双构建和独立验证确认全部 **9326 文件**逐字节一致。
producer / verification 回执 SHA-256 分别为
`313220e5677b7f0e4406614841a9d461cdd616bfd89663e60dd139e4a7265d13` /
`f861993256734a80dc94510e7b05dc173a78f75fac22cf0ede621f6e273ead20`。
窄候选将完整 **3354** 份源库存逐字节、逐 Git blob 与 cdef 提交对应，
另存 commit binding，保留旧 producer 的 HEAD/dirty 元数据不改写。
commit binding SHA-256 为
`fc242a33353d9d97ca44e56e22501decc428d1090ce93dcad6a66006b4ba343e`。

新 runtime 与现服务的 8 个 System.register 依赖、498 个导出及每个依赖的
实际 imported 符号全集一致；另有 `handlebars`、
`mqtt/dist/mqtt.min` 两个 literal lazy imports，新旧也一致。
这 10 份继承资源的宿主文件与真实 HTTP 字节相等；不声称递归依赖已经闭合。
不发布本次构建产生的 core、components、样式或其他应用入口。

逐源对比现服务对应 r4 snapshot 与 r10，实际运行行为差异是 **3 个源文件**：
上述 Base、Control，以及此前已提交的 `service/service/auth/v7-auth.service.ts`。
后者的匿名入口统一调用 login，由该路径仅加密一次；成功 HTTP 响应也必须返回
非空字符串 token 才允许写会话 cookie 或返回成功。不能将候选描述为只含两源变化。
使用仓库原 `vitest.node.config.ts`、已有缓存 vitest 单文件运行
`test/service/auth/v7-auth.service.test.ts`，**16/16** 通过，包括实际 RSA 解密、
cookie 清理和多轮 refresh；同一原测试通过私有 alias 加载 r4 旧源，
**7 通过 / 9 失败**，准确复现六种非法 token、无 token 匿名标记、双重 RSA
和加密失败异常。首次负控配置入口错误在测试前拒绝，单独保留，不计作负控成功。
未安装依赖、未运行全量，也没有用旧匿名凭据执行真实登录。
该结果仅是匿名逻辑单测，不代表匿名业务验收。
私有回执：
`.artifacts/control-auth-regression-20261126-r1/report.private.json`，
SHA-256 `6d4864ffe2934a0f0f3934f7716f55950d6b422c104718e0911601cd69337190`。

候选目录：
`.artifacts/plm-control-lifecycle-candidate-20261126-r1/`。
manifest SHA-256：
`a61631970e1cca55b619d243d3ae8bf362d088173b2d7c972ce59736f7b7d2c6`。
只有下列 3 文件：

| 文件 | SHA-256 |
| --- | --- |
| `extras/js/@ibiz-template/runtime/lifecycle-b1ed36c81f38c48c/index.system.min.js` | `b1ed36c81f38c48c8548ecad664ee7284a1952c81e7ec83484ac4d0766bc29e9` |
| `extras/json/system-import-lifecycle-b1ed36c81f38c48c.json` | `d2f0fcf8467ce2e150c145dc1f3eda58bd4aaad5b9187cf79ce2de96f24d1b36` |
| `index.html` | `5226d0987f215d4c70046d9d48253e7649b0cbfd53dad575e43435dd10ada32a` |

可执行计划：
`.artifacts/plm-lifecycle-prepare-20261126-r1/prepared.private.json`，
SHA-256 `4be8502408bf613d5ea786578587dd0103c86617e4d1b55897e7e907471970ce`，
epoch `68233376-9f41-4161-897a-2f732987b52b`，状态
`PREPARED-NOT-APPLIED`。
保留宿主/容器静态输出 **38202 / 38214** 文件、插件 **17455** 文件和模型
**13725** 文件的完整指纹。计划依次安装 runtime、新导入表，最后切换两处 index，
共 6 次发布；其他 import/style、app entry、文档和插件不变。

新增显式 wrapper 复用现有 language executor 的锁、文件元数据、条件发布、
HTTP 读回及精确回滚。旧三份 seals 默认行为保留；新合同必须提供完整 manifest
摘要并满足严格三文件形状。失败先恢复 index，再删除精确本次新文件；
未知 inode 保留，空的新目录也保留，不声称目录完全不变。
source、旧合同及新路径故障检查共 **39/39** 通过，`git diff --check` 通过。
本阶段没有 apply、Docker 生命周期操作或业务登录，原生失败的三格尚未复跑。

### 实际 runtime 应用和原生 r2

主线随后实际应用窄 runtime：
`.artifacts/plm-lifecycle-apply-20261126-r1/report.private.json`，
SHA-256 `d017d60dd32a28735e32e468307d573b23290342a6602b5caa3ffef91b7c1371`，
状态 `APPLIED-STATIC-BUSINESS-ACCEPTANCE-PENDING`，3 文件、6 次发布。
未覆盖或改写原 r1 失败回执。

原生 r2 使用正常管理员 UI 登录，明确绑定上述 apply、原 manifest、plan 和 epoch。
浏览器实际加载
`runtime/lifecycle-b1ed36c81f38c48c/index.system.min.js`，
响应 SHA-256 为
`b1ed36c81f38c48c8548ecad664ee7284a1952c81e7ec83484ac4d0766bc29e9`。
中文桌面的正常登录、二次开发原生菜单/tab、iframe 搜索和刷新分别经过 raw-error
门，console/page/request/HTTP/capture 均为 0。

随后原有深链步骤失败。trace 时序为：

1. 6757.648 ms：导航回真实应用根；
2. 7271.340 ms：原生 app menu 可见，URL 为 `#/-/index/-`；
3. 7273.817 ms：直接导航到刚才捕获的 API Reference 原生深链；
4. 7318.802 ms：异步默认菜单命令把路由改为 `workspace_tab_exp_view`，
   后续进入工作台概览；目标 iframe 15 秒内不存在。

本次没有 `null.name`，也没有其他 raw 错误，但不能因此忽略错误路由。
`maxFailures=1` 停止后面三格；所有浏览器和账号窗口均释放。
源/运行 witness 比较通过。r2 没有提交产品 Create 或后续业务 API 写入，
`cleanup=NO-WRITE-INTENT`，不需要删除本轮产品或成员。
原生页面访问仍可能写入 recent/audit，因此不声称数据库无写。
本轮没有执行通知 CRUD 或审计删除；不可将未提交产品创建外推为所有消息/审计不变。
r1 的产品和成员清理仍只按其精确自有标识、三数据集和成员空读回证明。

r2 私有目录为
`.artifacts/current-native-api-documentation-20261126-r2/test-results/current-api-documentation--49b58-eserves-refusal-and-cleanup-api-documentation-zh-desktop/`。

| 文件 | SHA-256 |
| --- | --- |
| `api-documentation-evidence.private.json` | `b8cca040268d89b510b5cfc5310036e8bb39cedbc6468f1476f4b0c7ffed2eac` |
| `trace.zip` | `bf4a33f41be9efd9fdd2035e809d4fb759248704bc48839cdfe7611ab1dcdfac` |

### 默认导航竞争的最小源码修复

权威菜单来源是
`plm/model/PSSYSAPPS/plmweb/PSAPPMENUS/plm_menu.json`：
`menuitem1.openDefault=true`，应用功能 `usrappfunc0412219017` 对应
`workspace_tab_exp_view`。维护前端 `views/app-index-view.ts` 和 `app/app.ts`
保留相同语义；没有修改模型、菜单入口或测试深链步骤。

`AppMenuControl` 在 onCreated 时发现没有 `view2`，会启动默认菜单点击，
但没有等待后续多层异步模型解析。实际链为
`AppMenuController.onClickMenuItem -> AppFuncCommand.exec ->
OpenAppViewCommand.exec -> OpenViewUtil.root`。最后一个方法的已发布源码
本来就在模型和 generateRoutePath 的异步等待后检查
`modalOption.shouldNavigate`；此前菜单调用方没有传该条件。
私有真实方法链诊断复现了延迟模型返回后覆盖新深链，并确认同样链路带现有 hook
就能取消。该受控诊断不是产品浏览器通过回执。

新源码只改
`ibiz-app-hub/packages/runtime/src/controller/control/app-menu/app-menu.controller.ts`：
绑定菜单意图 generation、当前完整 URL、当前 view 和实际 Context 数据快照；
销毁中、上下文/URL/view 变化或有更新菜单意图时，已有 root hook 取消过时打开。
保留调用方原 shouldNavigate 和 modal options，真实初始化错误按原 identity 抛出。
该 hook 经 `INDEXVIEWTAB`、`INDEXVIEWTAB_POPUP`、默认路由 fallback 和
`noWaitRoute` 路径传到 root。六种 modal/custom 通道和自定义菜单 provider
只验证原有派发不退化，不声称其异步生命周期取消也已完成。

新增 `scripts/tests/app-menu-navigation-lifecycle.test.mjs` 执行上述维护方法链，
使用实际 IBizContext 与延迟模型/路由生成：
当前 **27/27** 通过；封存旧源码 **9 通过 / 18 失败**，无 cancelled。
单文件 eslint 和 `git diff --check` 通过。未构建、未发布、未追加登录。
本轮源码/test SHA-256 分别为
`fe69bfb3bd56b62ed3e3b1d72ae21bfffecdcee881b56990d35182d7fbf6e5c6` /
`f77fd8d29e0633ead5bec31afe8d157f6875d46b1af15d6b34a003bc3f4bb718`。
私有报告：
`.artifacts/b03-default-navigation-diagnostic-20261126-r1/report-r2.private.json`。
新候选必须来自新的源码构建；不能沿用 b1ed 运行字节替代新修复的验收。

### B03 当前逐门判断

最小父项门取自 `REMAINING-25-SOLUTION-20261123.md` 的 B03 行：
实际宿主 Development/API Reference 嵌入、真实受控 API 正负向、
刷新与深链、双语/手机、副作用和清理；不增加“全部 API 已验”的无来源条件。
AGENTS 的真实多角色要求另按实际业务身份留证，不能用管理员覆盖其他身份。

| 门 | 当前证据及缺口 |
| --- | --- |
| 真实宿主静态文档及错误恢复 | 真实共享前缀双语桌面/手机四格及受控错误恢复通过；不是私有 Docsify 服务。 |
| 原生嵌入及刷新 | r2 中文桌面正常菜单/tab/iframe、搜索、刷新通过；原生 English/手机三格未运行。 |
| 原生深链 | r2 真实失败；源码修复待新构建、发布及相同深链步骤重跑。 |
| 真实受控 API 正负向 | r1 已有自有产品 Create/Get/Update、匿名 Get/Update 401 后不变和 Remove；r2 未到该阶段。新运行字节仍需同一流程回归，不能直接复用 r1 为当前通过。 |
| 副作用及清理 | r1 精确自有产品/成员清理通过；r2 无产品创建意图。消息与不可变审计保留各自范围，未声称全库不变量。 |
| 真实业务身份 | 本 B03 原生 run 当前只使用正常管理员。普通/只读/非成员的既有 B01 回执需按具体 API、源/运行版本核对，不能仅因用户名存在就计入本门。 |

### 下一轮 CD 清理与拒绝副作用门

原生 spec 保留原深链/刷新步骤和所有原断言，另接独立
`plm-e2e/tests/current-api-documentation-notifications.mjs`。
它使用 CD 源合同，不将 CP 生命周期回执改标签。
创建前从正常 UI appdata 绑定真实 receiver/system，以原生分页和真实 `x-total`
记录当前接收者全部消息的 typed 快照；缺失、null、空串和状态/内容变化分别保留。
匿名 Get/Put 的拒绝前后进一步比对完整产品 DTO、精确成员集合和该接收者消息快照。
该门不声称物理数据库、发送审计或 recent 总量不变。

产品和成员的精确清理完成后，通知范围仅为本轮 CD nonce、实际创建/PUT 读回的完整
产品名称、产品标识、真实产品 ID 和成员 Delete 回执所对应的两种权威模板。
另核对 owner/receiver/system、模板字段和实际时间窗；创建消息的两条链接须等于
原模板替入该产品 ID 的精确结果。先对全部候选消息 GET preflight 并复核集合，
全部通过后才逐项 Delete 和 keyed Get 404，最后证明原有消息状态/内容等未变。
未知匹配消息、晚到消息、第二个 GET 变更或旧消息变化均在写入前拒绝。
发送审计和 recent 保留。

真实零 owned 集合会保留三次原生分页的总量和空集合事实，DELETE/404 次数明确为 0，
不会把零消息记成消息投递成功。定向 config 测试 **9/9**，原生四格 `--list`
编译及 diff 检查通过。该段仍是准备状态，没有发起正常账号登录或消息 API。
新 runtime 的精确 manifest/plan/apply 常量由主线实际发布后另行绑定。

### r11 新 runtime 与四格原生回归

默认菜单修复由 AppHub 提交 `30163825fe13e4c1ea0341bdd173d7616d35cc38` 重新执行
七包双构建。严格 verifier 绑定 producer plan，9,326 个完整交付文件、26 个
复制分发文件和 SystemJS 入口均匹配；新 runtime 入口 SHA-256 为
`529c247dced450f20772ca70ac7320ab4201c999af4eb85c40da9f873258c009`。
只发布 runtime、import map 和两个 index。现有宿主 apply 回执：

```text
.artifacts/plm-lifecycle-apply-20261127-r3/report.private.json
SHA-256 0ce306170f5fd6ff669c23a52aea6e0e40381d26fec1245e4f4206ab52a669f9
manifest ea1830df11093c23758b86519a3e959c979742ecd527a4e70fd0641a38e343e8
plan bba2004ded34376f5afb279c7246f6c6abbdbd90258e62886b9b63d202fd7fd5
epoch da4f24ac-6670-42e9-a2ef-261dcebfe468
```

第一次 apply 因命令缺少同一 epoch 在写入前拒绝，回执保留且 mutations 为空；
第二次补全 epoch 后成功。没有重启容器、pull 镜像或改变模型/插件。

当前四格回执位于 `.artifacts/current-native-api-documentation-20261127-r7/`，
证据文件 SHA-256 如下：

| 项目 | evidence SHA-256 |
| --- | --- |
| 中文桌面 | `b24aa3fa7b8a15a1547187493c0c628d7e8dd870337542c9c11e0f775bffdae5` |
| English desktop | `a9e52f1983cecf6d0f4248ea6ea481cbc39e23c3f94afd867af545817144d9e4` |
| 中文手机 | `1660654301c9023ee52276d1e5f05de3d54d66fbd91ff487697c0a4f6dff69ad` |
| English mobile | `815d86bf0c3f95b520270f5dee991c6c19ffed7b45a238e66a481a1dbeccd358` |

四格均为 `PASS-CURRENT-NATIVE-CELL`，宿主 iframe、runtime 字节、刷新、深链、
原始 console/page/request/HTTP/capture 错误门均通过。中文桌面还完成真实产品
Create/Get/Update、匿名 Get/Put 401、完整 DTO/成员/接收者消息副作用对比和精确
产品/成员/消息清理；另外三格按合同不写业务数据。该证据仍不包含低权、非成员、
跨组织 API 矩阵，因此 B03 父项保持 PARTIAL。

移动端在 iframe 侧栏隐藏时使用真实搜索框 Enter 触发结果，未使用强制点击；
可达的侧栏按钮仍走正常点击。该脚本改动与当前运行源一并记录在 r7 source snapshot。

### 六角色 API 角色门

在四格回归后，使用同一已登记自有产品和六个真实账号执行独立角色门。
六个账号均由 `loginProductSession` 正常填写登录并核对服务端 appdata，
没有注入 token、伪造 person/organization header 或使用 SQL 写入。
产品成员原生读回为 ordinary=`user`、objectadmin=`admin`、readonly=`reader`，
nonmember/crossorg 没有产品成员记录；受限组织管理员没有建立。

ordinary 创建一个本轮唯一需求对象；admin、ordinary、objectadmin、readonly
读取成功，nonmember/crossorg 读取按 403/404 拒绝。ordinary/objectadmin
更新成功；readonly/nonmember/crossorg 的 PUT、已知 `/ideas/save` 和 DELETE
均拒绝，并在每次拒绝后用 ordinary 会话读回业务投影。所有六个接收箱先做完整
分页 baseline；本轮未产生 owned 通知，原有消息集合状态/内容保持不变。
需求在 admin 会话中精确删除，GET 返回 404，normal/archived/deleted 三数据集
均无本轮 marker。

角色门第一次保留 `NOT_RUN_NO_DOCKER` 物理快照；第二次只启用脚本自带
`START TRANSACTION READ ONLY` 查询。9 个拒绝操作的序列、IDEA、VERSION、
RECENT 和消息计数 before/after 全部相同，`sqlWriteCount=0`，无 Docker
生命周期变化。最终 evidence SHA-256：
`d9aa2161b971dffd20427c5d3170ec00266faaf1afd6ce1497c2e8b4ad2e6add`。
这只完成 B03 的一组真实 API 角色子门；不外推到受限组织管理员、全部 API、
Data Model/Modeling IDE 或 realtime 日志。
