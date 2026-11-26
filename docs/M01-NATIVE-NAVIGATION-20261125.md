# M01 原生 Central 导航与组织引导

开始日期：2026-11-25；更新日期：2026-11-26，Asia/Singapore。
私有候选的正常身份引导和桌面菜单已突破，完整 M01 仍未验收，不关闭能力项。

## 手册要求

Development、API Reference、Data Model 和 Modeling IDE 不在 PLM 官方使用手册的
125 页目录内，需要独立规格和验收。本文遵循
[工作区证据边界](manual/README.md)；源码、页面加载或空数组 HTTP 200
不能代替多角色原生操作与持久化读回。

M01 的正向证据仍须覆盖合法开发中心和成员关系、至少两个非空中心、
正常菜单导航、选择、刷新、管理员创建、普通成员拒绝，以及拒绝后的无副作用核对。
组织上下文初始化和完整成员 ACL 是不同验收阶段。

## 本地实现观察

保留已有 owned Central runner 及其历史 fixture/launch 绑定模式。本轮增加独立
current-shared 模式，只从实际 `http://127.0.0.1:32008/central/` 裸入口开始，
不由 runner 注入中心、组织或身份头。正常 UI 使用保留的 ordinary 账号，
一次登录、一次浏览器会话；真实 403 优先记录并停止，不改用另一个账号或会话。

现有维护源码的 AuthGuard 已支持 `requireOrganizationContext`：
先请求原生 `/uaa/getbydcsystem/ibizmodeling`，绑定真实返回组织，再请求 appdata，
然后才初始化模型、消息和主题。required 模式下空目录、非法组织和真实 HTTP
错误均不得复用旧组织或继续初始化。

共享 Central 实际加载的组件却仍是旧分支：

```js
ibiz.env.isSaaSMode === true && ibiz.env.isLocalModel !== true
```

其 bundle 没有 `requireOrganizationContext` 或 `shouldLoadOrgData`。
实际环境为 `isLocalModel: true`、`isSaaSMode: false`，故跳过组织目录。
host 还将未配置中心的裸入口自动改成 `psdevcenterid=demo`；
这个默认深链不能作为用户已选合法中心的证据。

本轮 host 改动：

- native Central 在 runApp 前显式要求组织上下文。
- 未配置中心时保留原生默认导航；只有显式合法的
  `nativeDevelopmentCenterId` 才生成中心深链。
- 保持已有深链、ModelDesign 配置策略和 MQTT 显式布尔覆盖。

私有候选真实运行又发现兼容问题：`attachEnvironmentConfig` 仅遍历旧 core 的
`Object.keys(ibiz.env)`，而旧 core 没有组织要求字段，host 的新开关会被静默忽略。
维护源码已在 hub 和 active fork 两处补充此可选字段的显式布尔数据属性映射；
不读取 accessor 或继承属性，不扩大普通用户权限，不制造组织 ID。

新增 `modelingweb/app/scripts/native-central-candidate.mjs`：
将实际 host 源构建到独占私有目录，绑定已封存 runtime/component 回执和文件哈希；
通过结构化 HTML 处理执行实际 SystemJS 入口，保留导入映射，限定静态前缀；
私有回环端口仅按只读和登录 allowlist 原样代理既有 Central API。
两个绝对登录图片资源使用 framework 回执中精确封存的源和字节哈希。
候选不写共享 dist、不创建或重启 Docker 服务，不将构建成功当业务验收。

## 当前版本验收证据

### 共享版本首轮

命令：

```sh
node modelingweb/app/tests/owned-central-member.browser.mjs \
  --current-shared --run-readonly-browser \
  --entry http://127.0.0.1:32008/central/ \
  --credentials .artifacts/native-actors-run-20261124-r7/ordinary.credentials.private.json \
  --locale zh-CN --viewport desktop \
  --output .artifacts/m01-native-navigation-20261125-r1
```

私有回执 `report.private.json` SHA-256：
`17d533a69db6fcf917172af988a253c4debfcb354343ec7c5552c311ec3abc0c`。

一次正常登录 POST 200；前端未请求原生组织目录，已认证 API 请求的 `srforgid`
均为空。首次真实拒绝为
`POST /api/ibizmodeling__central/extension/internal_messages/fetch_cur_receiver`
HTTP 403，0 字节，SHA-256
`e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855`。
主题配置 GET 另有 HTTP 500，业务错误为“当前机构用户上下文无效”。

报告同时保留本地组织非空 gate 失败、7 条 console error 和 4 条响应体抓取错误；
不能把本地 gate 描述成后端返回错误。截图是加载状态，未形成导航证据。
没有 blocked request、requestfailed 或 pageerror。浏览器与 context 已关闭，
四个现有容器的身份、配置、挂载、启动时间和重启次数前后相同。
未创建 fixture，不涉及清理。以上观察不声称数据库总量或所有服务副作用不变。

实际服务字节：

| 资源 | SHA-256 |
| --- | --- |
| environment.js | `1d162395c59f1321a887326f3148eb45be8fff55aae4e3c6110247df552da491` |
| host index-legacy-c8Rsb1kw.js | `f6915f615af92ee11f27d260c9b881c094b36d76765c94a2c2fd24eec78a5ff1` |
| runtime index.system.min.js | `aaba5e0c74b3782ce23022b949b2c1db8b0d84b7703c3edf38c2e6176bd097a1` |
| core index.system.min.js | `1ce2b19a828132d4f1c679489f635041c6a655c77060fee83ee116c6e0aad92b` |
| components index.system.min.js | `3373f8734dd631827faf285efb1930e64c800fab824482e8b3e3a001bc80073c` |
| components index-g6zAWAF4.js | `3a30b839b141cf3dcbac857b70806fff852d5b27b9626ebd866494fbb41f3c28` |

Central 容器 `compose-modelingweb-candidate-central-1`：
ID `50dd359e084851da01b3a99a6fcdeffa3ee8a2066d3b1cf80616c1d39b9b5eeb`，
镜像 `sha256:d4728f7032a017e2d8c3ba1ce7f18eb5d2221103a26f3f9c279eb81fafcdc695`，
StartedAt `2026-11-22T03:37:30.976950801Z`。
模型、应用覆盖和 runtime assets 仍含历史 current-source-20261107-r7 挂载输入，
不能推断当前维护源码已上线。

### 私有候选首轮

使用 `.artifacts/plm-auth-runtime-candidate-20261125-r2/` 封存的 framework，
回执 SHA-256
`788c892408888bd8f34daeb96fe233965f0a39ea5abbec2af4045f8a81aa984e`，
revision `8a499f709ef08ee2`。Central host 候选 r3 包含 23 个封存文件，
manifest SHA-256
`8bd8cbf409b2eda828b49d32208d89ca21d74f1f2965dd2ff44715788a35b14a`。

`.artifacts/m01-native-navigation-20261125-r2/report.private.json` SHA-256：
`f34f113160916f938d0dd319942709576d7219bfbba368b9948f2b9a9f73228c`。

实际加载的 host、runtime、component index 和组件主 chunk 四组哈希均匹配候选。
一次登录 200，但旧 core 环境映射丢失 required 开关，仍未请求组织目录；
同一消息请求返回真实 403、主题 500。保留 5 条 console error；capture、
blocked、requestfailed 和 pageerror 均为零。没有成员导航验收。
候选 browser、context、回环 server 均已关闭，原样代理日志没有 server error，
共享运行容器 witness 未变；未向共享版本发布候选。

候选 r1 保留构建工具 CJS 入口错误；r2 保留未修静态前缀的构建产物，
均未用于真实登录。r3 构建与运行回执不追溯修改。

### 显式环境映射修复后的候选

framework r3 回执 SHA-256：
`69b3b278237270ceaffe305d7217ceec23b193b09583d2aa81f4ddb8bd5d62f1`，
revision `3dd713c2955e9fee`。Central host r4 manifest SHA-256：
`da6d4748d302204f865326f092de133629487f2174d6e581303e3520f03ba482`。
构建仅写私有输出。framework 源快照完成后，仅测试配置添加现有 qs 依赖的精确
alias；不声称冻结回执的所有 2693 个输入仍与当前工作区相同。
生产 attach-environment-config 源码保持此次冻结版本。

新版本一次正常 ordinary 登录，未切换身份或绕过前次拒绝。私有回执为
`.artifacts/m01-native-navigation-20261125-r3/report.private.json`，SHA-256：
`6f3f43d5a9696a52862daf3a6b97c6e53f3862c129986136fc8db4afd263a604`。

实际原生组织目录 GET 200，返回 1 项，响应 SHA-256：
`a754e08b52dadde14cf8c35410a5d26ef634a69b6e50ab80b22430800e0c4561`。
之后的 appdata、模型、消息和主题请求由现有 CoreInterceptor 自动带上
`srforgid=000000` 和 `srfsystemid=ibizmodeling`，未注入用户/人/租户身份头。
这证明候选已修复“未发组织目录请求”的前端引导缺口；不证明完整组织身份或
成员权限验收。

appdata HTTP 200，但 runner 的实际 context/原生组织唯一匹配 gate 未通过；
随后消息请求仍为真实 HTTP 403，主题配置仍为 HTTP 500“当前机构用户上下文无效”。
以 403 为主失败、保留本地 gate 为 priorError。该次回执保留组织响应的哈希和数量，
没有封存完整组织数组和 appdata context；不能据此断言具体哪个 context 字段错误。
后续 runner 已增加私有事件记录这两个响应；此改进未追溯修改或重跑失败回执。

实际加载的四组新版本字节均独立核验：

| 资源 | SHA-256 |
| --- | --- |
| host index-legacy-p6wpLHmX.js | `b9ef68df6c3693fddc6fa2222657890038df5788f2342f481a82e8e94d1b2880` |
| runtime index.system.min.js | `4260180b94ad14bb69244500709b46ec271637932a477359feb80370c4b2edb6` |
| components index.system.min.js | `7e0d47f37d69ac03433718187b5a1bcdd7c61378b43d0746eb3fac862201a943` |
| components index-BFx6_hkX.js | `071ca27cf1b8e3faf33f67de862b8f35186bfd22aa2c52bed6d93b993e470cf1` |

5 条 console error 原样保留；capture、blocked、requestfailed 和 pageerror 均为零。
浏览器、context 和私有 server 已关闭。共享 runtime witness 未变。
没有创建 fixture、中心、成员或其他业务资源，不涉及自有数据清理；
不声称已对数据库做全量副作用快照。

定向检查：

```sh
cd ibiz-app-hub
node node_modules/vitest/vitest.mjs run --config components/ibiz-next-vue3/vitest.auth-guard.config.ts
cd ../modelingweb/app
node node_modules/vitest/vitest.mjs run --config vite.config.ts tests/native-development-center.test.ts tests/native-mqtt-overrides.test.ts
node --test tests/native-central-candidate.test.mjs tests/owned-central-member.test.mjs
cd ../..
node --test scripts/tests/owned-central-member-http.test.mjs scripts/tests/plm-manual-reference.test.mjs
```

当前结果分别为 234/234、122/122、40/40、22/22；第二组同时包含
`tests/release-contract.test.ts` 和 `tests/native-modeling-root.test.ts`。
另有 `sh -n modelingweb/start.sh` 通过。三个修改仓库的
`git diff --check` 通过。候选测试校验封存字节、拒绝业务写入及入口约束，
不是完整 ACL 或成员导航验收；没有运行全量 scripts 或全量业务浏览器矩阵。

### 精确 appdata 路由修复

此前机构上下文错误继续追到真实 Nginx。只读取得 `nginx -T` 和实际
`/etc/nginx/conf.d/nginx.conf`，与历史只读挂载源按现有 start.sh 的替换生成结果
逐字节一致；没有将 Git 模板误当运行文件：

| 输入 | SHA-256 |
| --- | --- |
| 当前 `nginx -T` stdout | `709f7c24aa6cdd2c70f63ba19a9ea77383a307180ac35facaf8f2d70838efade` |
| 当前生成的 nginx.conf | `0f259b3226efed23ffc7d71fe6eff5e2de9c5f7c418fe3fabd6336dd9e5cf8eb` |
| 历史只读挂载模板 | `f5291754e4fe8c68a50b1fb887b5747c1a86fc409427ecea8f107f2972189a78` |

实际精确 `location = /api/ibizmodeling__central/appdata` 将路径改写为 `/appdata`，
却送至 `$native_uaa`（独立 UAA 32666）；登录、组织、消息和主题使用
`$native_auth`（Allinone 30000）。候选为**这一条** appdata 声明明确新路由，
保留浏览器正常发出的 system/org 头和原生响应；其余接口仍原样经过现有链路。
没有增加 user/person/DC 头，没有合成响应，没有切换写接口以绕过权限。

Git 模板供两类应用共用。本轮使用 appdata 上游占位符，由现有 start.sh 按应用
明确生成：Central 选择 `$native_auth`，ModelDesign 保留 `$native_uaa`。
实际 shell 分支测试覆盖两类结果。没有用身份 appdata 替代 Modeling 的原生
root/model-context；ModelDesign 未取得 root 正向回执，不能扩大验收范围。

Central 候选 r6 manifest SHA-256：
`d030eb2b0f80e31c5e63cf9a748d4f074f2a2e78be7c3b1a51d6daf9817ac9a0`。
私有目录保留 route-witness、冻结 framework r3、23 个候选文件和旧源恢复输入。
r5 是此前无条件模板方案的准备产物，没有执行登录，不用于两类应用的验收。

**启动输入变化边界：** `modelingweb/start.sh` 本身是现有容器 `/start.sh`
的 bind 源。编辑它已经改变未来启动输入；不能宣称所有共享 bind 字节未变。
本轮没有执行该启动脚本、重启/替换容器、reload Nginx、修改历史挂载模板，
当前生成的 Nginx 配置仍是旧字节。每次运行的 runtime witness 前后相同，
只约束该次记录的 ID、镜像、配置、挂载、生命周期及当时文件哈希，
不代表整个任务前后启动输入未变化。

| 受版本管理输入 | 修改前 SHA-256 | 修改后 SHA-256 |
| --- | --- | --- |
| start.sh | `7c3813345c14441186b71a1005c5ed682618866635827c4499f7793b747866ee` | `b7d94d3f431ce1f2cc5774f8050379499cc5992f434562d520761bd10572afd8` |
| nginx-native.conf | `0aa2235ec0c4c450c10fc268b7281d3a6f1d0dc49179c6741e6d89a354c816fc` | `ac0ecc133846a722c79c4a7a098393a4720893863060516b97cb061a7e2de311` |

修改前字节封存在 `.artifacts/m01-central-candidate-20261125-r6/rollback/`。
恢复私有候选仅需关闭自有 server；恢复未来启动输入需要审查并恢复这些精确源字节，
不能将历史 mounted 模板覆盖成当前 Git 模板，亦不能自动重启共享服务。

2026-11-26 00:03:08 至 00:03:12 +08 的中文桌面正常 UI：
login 200、组织目录 200（1 项）、新路由 appdata 200，真实 person/loginname
及 org/system 唯一匹配通过；APPINDEX 加载、正常菜单导航通过。
消息和主题均恢复为 200，console/pageerror/requestfailed/blocked/capture 全为零。
实际 member 请求为裸 `POST /psdevslns/fetchcurdcslnuser`，返回 200 空数组；
runner 正确保留失败，而非把空数组视为成员能力完成。

回执 `.artifacts/m01-native-navigation-20261125-r4/report.private.json` SHA-256：
`26fa5a0ea2796849aaa39c84de4abf397d286ffb9121673a30e45fbe50e8c2cb`。
路径中的 20261125 是任务起始标识，实际本轮运行日期是 **2026-11-26**。

身份校验另外修正跨应用假设：PLM 凭据中的应用 userId 不强制等于 Modeling
派生 userId，仍严格核对真实 personId、返回的 loginname、组织和系统；
显式提供 Modeling userId 时仍校验。此前组织唯一匹配失败早于 userId gate，
不会追溯改写历史失败。

### 语言与视口补证

同 r6 manifest、同保留 ordinary 身份，每格正常独立会话。

| 格子与回执 | 当前观察 | SHA-256 |
| --- | --- | --- |
| 中文桌面：`m01-native-navigation-20261125-r4` | 引导、首页和菜单通过；member 200 空 | `26fa5a0ea2796849aaa39c84de4abf397d286ffb9121673a30e45fbe50e8c2cb` |
| 英文桌面：`m01-native-navigation-20261126-en-desktop-r2` | 引导、首页和菜单通过；member 200 空 | `9259d641aab59542a83b63c13a61327152d3f6a98fb12b9273593dae2e24c3bf` |
| 中文移动：`m01-native-navigation-20261126-zh-mobile-r2` | 引导通过；菜单 gate 失败，截图仍有全局 loading，不能算稳定首页 | `c14437a85dce68abac81cbb822245a9b4b70a0c8bd530ad995f562a9db56ad9c` |
| 英文移动：`m01-native-navigation-20261126-en-mobile-r2` | 引导通过；同上，不冒领导航通过 | `3eafebee1d8a30396cd893ee5730e17f5256d84cb679dcbb32c87352d6a2c417` |

两格移动端证明仅等待 `.ibiz-view-appindexview:visible` 不充分。runner 已复用现有
`waitForNativeIndexReady`，要求真实控制器创建/挂载/加载状态稳定且没有 loading
遮罩，再解析菜单。后续 member 原始请求体和实际 view 中心/root context
保存在私有证据中，不注入控制器状态。

三格 r1 因本地 server 复用候选的 inherited cache，遇到 EEXIST 并返回静态 403，
loginAttempts 均为零。失败回执保留，不能称为原生授权拒绝。cache、server 源快照
和回执现按每次独占 evidence 目录写入；IO 错误与断言拒绝分开，
runner 不再将静态 403 标为 native API 403。修复后 r2 三格没有 server error。

严格就绪补证 r3 的三格均在正常登录遇到真实 HTTP 500，尚未到组织阶段：

| 回执 | SHA-256 |
| --- | --- |
| `m01-native-navigation-20261126-en-desktop-r3` | `be99294ceacfd17da8e3b9f832191d1f7c33f465ba4f8336e91b17be30f74663` |
| `m01-native-navigation-20261126-zh-mobile-r3` | `258f219b09697ee0e4c41da3b82988405c34a8e102880b40a94fafa95b33c61a` |
| `m01-native-navigation-20261126-en-mobile-r3` | `85aa8392cbb5687bdc5ba3bf98926e571c4660f5df47230c5a34f816c19449f9` |

对应 2026-11-26 01:04:09 至 01:04:15 +08。只读取得该窗口 UAA 日志，
出现 `RedisConnectionFailureException`、Redis 连接拒绝或无路由；登录审计同时记录
ordinary 和原有管理员身份的依赖错误。不能把并发、账号锁定或新前端代码猜作根因。
私有日志 `.artifacts/m01-login500-diagnosis-20261126-r1/ibizlab-uaa-api.logs.private.txt`
SHA-256：
`061e3ff60baade98ac4a5210a8f37ece1e43490b2f89936fd89f585aaaaaf247`。
已经停止叠加登录；全部自有 browser/context/server 关闭，未操作共享依赖。
后续 runner 对所有 HTTP >= 400 响应保存私有原始 body 及哈希，
不追溯补造该轮未捕获的响应体。

### 中心选择控制

裸 member 接口和 200 空数组不能区分“没有 center context”与“没有开发者/成员权限”。
权威 CurDCSLNUser 查询明确依赖 `ctx.datacontext.psdevcenterid`。
现有 Central 首页未观察到可用中心选择，不能把去掉默认 demo 等同完成中心选择。
身份 appdata 中 `srfdcid=demo`、`srforgid=000000` 也不能被当成真实选择的中心 ID。

独立只读管理员控制保留正常登录、原生组织、Allinone 身份和 Modeling 原生
`/ibizmodeling/appdata` 200；后者没有 `srfmodelcontext`。
实际已声明的中心 `FetchDefault` 返回 **500**、106 字节，不是空目录 200。
控制回执 `.artifacts/m02-modeling-center-context-20261126-r1/report.private.json`
SHA-256：
`62e241bce5dc1b838359f5c51544527d5cd21c2b1e8cb612526ce0853aacaacc`。
仍需核对已发布方法及具体业务错误。没有凭此创建或猜测 demo 中心，
也没有把尚未部署的 service-hub model-context 实现称为当前服务能力。

## 本轮文件边界

共享组件：

- `ibiz-app-hub/components/ibiz-next-vue3/src/web-app/attach-environment-config.ts`
- `ibiz-app-hub/components/ibiz-next-vue3/test/web-app/guard/auth-guard.test.ts`
- `ibiz-app-hub/components/ibiz-next-vue3/vitest.auth-guard.config.ts`

Modeling：

- `modelingweb/app/src/main.ts`
- `modelingweb/app/src/native-development-center.ts`
- `modelingweb/app/tests/native-development-center.test.ts`
- `modelingweb/packages-latest/@ibiz-template/vue3-components/src/web-app/attach-environment-config.ts`
- `modelingweb/nginx-native.conf`
- `modelingweb/start.sh`
- `modelingweb/app/scripts/native-central-candidate.mjs`
- `modelingweb/app/tests/native-central-candidate.test.mjs`
- `modelingweb/app/tests/owned-central-member.browser.mjs`
- `modelingweb/app/tests/owned-central-member.test.mjs`

检查点辅助：

- `scripts/owned-central-member-http.mjs`
- `scripts/tests/owned-central-member-http.test.mjs`
- 本文档。

原有 owned runner 和 HTTP helper 中其他未提交修改已保留。
本子线未执行暂存、commit 或 push；主线按 freeze 审查提交了共享 3 文件
`5ec1c2b7` 及 Modeling 6 文件 `0c2a4f7f`，没有共享部署。

## 待决策/阻塞

私有候选已经修复组织目录引导、旧 core 字段映射及 Central 身份 appdata 路由，
消息/主题的前次 403/500 在该候选中消失。共享 32008 仍是旧运行字节。
当前缺口是严格移动端就绪补证遇到共享 Redis 登录依赖故障，以及原生中心选择前置
尚未证明、目录读取返回 500。member 200 空不能直接归因为无开发者身份。
不得给普通人 API 角色、伪造身份/组织头、猜测中心或反复切换账号掩盖失败。

正向组织阶段通过后，仍需核对真实 developer 身份和可选中心，再创建最小自有 fixture，
补齐双中心、正常成员选择/刷新、多语言及移动端、管理员创建/成员拒绝和持久化副作用核对。
五个保留账号及原有产品不属于本轮清理范围。
