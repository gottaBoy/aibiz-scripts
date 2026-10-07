# 全链路回归清单

这份清单用于在本地工作区复现 PLM、Modeling Web、Modeling runtime、
插件 sidecar、外部回归入口和可选源码构建链路。清单只描述测试与证据，
不修改产品源码、业务实现、package script 或 Harness 实现。

## 1. 工作区和前置条件

```sh
export WORKSPACE_ROOT=/home/my/workspace/ainfra/aibiz
cd "$WORKSPACE_ROOT"
```

要求：

- Docker daemon 可用，Compose v2 可用。
- Node.js 20 或更高版本。
- `modelingweb/app`、`plm-e2e` 使用声明的 pnpm 8.15.9。
- Playwright Chromium 或可用的本机 Chrome 已安装。
- 主机资源建议至少 16 GB RAM、4 CPU、50 GB 磁盘。
- 接受测试前确认端口未被其他服务占用：19323、30000、30086、30088、
  30250、30251、30260、32002、32003、32666，以及 middleware 端口。
- 默认测试凭据来自现有本地配置。PLM E2E 默认使用
  `demo_admin / 123456`；脚本 baseline 默认使用
  `aibizhi / 123456`。跨环境运行时应通过环境变量覆盖，不要把新凭据写入
  报告。

先记录工作区状态。工作区可以是 dirty，但必须把既有改动和本次审计文档
改动区分开：

```sh
git -C "$WORKSPACE_ROOT/scripts" status --short
git -C "$WORKSPACE_ROOT/plm" status --short
git -C "$WORKSPACE_ROOT/modelingweb" status --short
git -C "$WORKSPACE_ROOT/plm-e2e" status --short
```

### Native CLI Source Gate

The original CLI source lane now pins the three exact consumer versions:
`web-theme -> 0.3.0`, `vue3-util -> 0.3.23`, upstream
`ai-code/model-design -> 0.3.30`. Before consumer builds:

```sh
cd "$WORKSPACE_ROOT"
npm run test:native-cli-source --prefix scripts
node scripts/harness-native-cli-source-build.mjs --verify-report "$CLI_030_REPORT"
node scripts/harness-native-cli-source-build.mjs --verify-report "$CLI_0323_REPORT"
node scripts/harness-native-cli-source-build.mjs --verify-report "$CLI_0330_REPORT"
node scripts/harness-native-ai-code-source-deps.mjs \
  --cli-source-report "$CLI_030_REPORT" \
  --cli-source-report "$CLI_0323_REPORT" \
  --cli-source-report "$CLI_0330_REPORT"
node scripts/harness-native-ai-code-source-deps.mjs --verify-report "$DEPS_REPORT"
```

Record the exact new report paths printed by each build. CLI acquisition,
isolated CLI build completion, source-deps completion and readback use exit 2
to distinguish partial evidence from native acceptance; exit 1 is failure.
Do not use a shell's generic success/failure check to claim native PASS.
Missing, mutated, mismatched-version or downgraded reports must stop
consumption without falling back to installed iBiz binaries. Without the
three reports, the source-deps command remains a published CLI probe, not
source-toolchain acceptance. Fixture tests never authenticate production pins.

The 943-file original source fetch passed byte/pin verification. All three
isolated CLI/core source builds now complete and pass independent verification;
the first dependency-preflight failure is retained as history.
See [NATIVE-CLI-SOURCE-ACQUISITION-20261006.md](NATIVE-CLI-SOURCE-ACQUISITION-20261006.md)
for exact successful report paths/hashes, protected exclusions and selected
third-party compatibility versions. Repeated `--root-owner`, `--core-owner`
and `--cli-owner` options preserve explicit resolver priority for reproduction.
Third-party packages do not need source localization, but their installed
identity, license declarations and any npm alias targets are audited.

## 2. 启动本地栈并执行迁移

### 2.1 建模 Compose 栈

在已完成前端构建、需要使用本地 Modeling Web 和插件产物时：

```sh
cd "$WORKSPACE_ROOT/modelingweb/app"
corepack pnpm@8.15.9 install --frozen-lockfile
pnpm build:release
cd "$WORKSPACE_ROOT/plm/deploy/compose"
docker compose \
  -f docker-compose-dev.yml \
  --env-file .dev \
  --profile modeling \
  up -d --build modeling-plugins modelingweb harness-ui
```

首次启动或 SQL 有新增时执行迁移：

```sh
cd "$WORKSPACE_ROOT/plm/deploy/compose"
./migrate.sh
```

### 2.1.1 本地模型库 JDBC 回归

`006_modeling_local_jdbc.sql` 仅更新精确匹配的本地预置实例旧 URL；
`mysql` 必须是本机 Compose 内的预置 MySQL 容器，不能被同名远程代理替换。
显式 TLS、自定义参数、不同实例/库/主机、大小写和尾随空格不同的配置
不应被更新。不要通过降低 JVM TLS 安全策略修复本地连接。

```sh
cd "$WORKSPACE_ROOT"
node --test scripts/tests/modeling-local-jdbc.test.mjs
npm run test:modeling-local-jdbc --prefix scripts
```

第二个入口执行真实 MySQL 临时表场景、重复迁移和实际已部署连接的只读检查，
不会写入持久业务数据。保留本次输出的
`.artifacts/local-model-jdbc/<run-id>/report.json`，核对其中的
`migrationSha256`。单元测试、临时表和实际连接检查均不能替代原生页面、
跨系统权限或保存后重新登录读回验收。

确认容器和健康状态：

```sh
docker compose \
  -f "$WORKSPACE_ROOT/plm/deploy/compose/docker-compose-dev.yml" \
  --env-file "$WORKSPACE_ROOT/plm/deploy/compose/.dev" \
  --profile modeling ps
```

### 2.2 栈级 baseline

自动模式允许 19323 未启动时将外部 UI 记为 `SKIP`：

```sh
cd "$WORKSPACE_ROOT/scripts"
npm run test:baseline
```

验收模式必须启动项目自有的 `harness-ui`，然后执行严格浏览器检查：

```sh
cd "$WORKSPACE_ROOT/scripts"
npm run test:external-ui
```

如果只需检查 19323 页面而不启动 Compose 中的 portal，可直接对已有服务
使用：

```sh
AIBIZ_EXTERNAL_UI_URL=http://127.0.0.1:19323/#? \
  AIBIZ_EXTERNAL_UI_MODE=required \
  node "$WORKSPACE_ROOT/scripts/external-ui-harness.mjs"
```

## 3. 静态契约和脚本 Harness

先执行 scripts 自身的 Node 测试：

```sh
cd "$WORKSPACE_ROOT/scripts"
npm test
```

结果判定：2026-09-30 的审计基线为 `475 passed, 0 failed`。失败时先查看具体
`tests/*.test.mjs`，不要用浏览器通过替代契约测试通过。

版本、来源和本地化边界：

```sh
cd "$WORKSPACE_ROOT/scripts"
npm run ledger
npm run localize
node version-ledger.mjs --live
```

建模 runtime required gate：

```sh
cd "$WORKSPACE_ROOT/scripts"
AIBIZ_MODELING_REPORT_DIR="$WORKSPACE_ROOT/.artifacts/modeling-runtime-current-$(date +%Y%m%d)" \
  npm run test:modeling-runtime:required
```

如果需要将 19323 作为 portal 跟随项目运行，可使用：

```sh
cd "$WORKSPACE_ROOT/scripts"
npm run harness:ui
```

该命令适合前台调试；Compose profile 中的 `harness-ui` 是可重复的项目入口。

## 4. PLM Compose 合约

```sh
cd "$WORKSPACE_ROOT/plm/deploy/compose"
node --test \
  tests/modeling-readiness.test.mjs \
  tests/source-platform-smoke.test.mjs
```

当前审计基线为 `38 passed, 0 failed`。该组测试覆盖 Compose 配置、
Modeling Web/Modeling service 路由契约，以及源码构建平台 smoke 的命令和
报告契约；它不替代真实运行中的浏览器链路。

栈已启动时执行运行态 baseline：

```sh
cd "$WORKSPACE_ROOT/scripts"
npm run test:baseline
```

若需要校验本地 allinone/gateway 镜像，使用独立 local-port lane，避免和正式
端口冲突：

```sh
cd "$WORKSPACE_ROOT/plm/deploy/compose"
docker compose \
  --env-file .dev --env-file source-built-local.env \
  -f docker-compose-platform-local.yml \
  up -d --no-deps --no-build --pull never \
  ibiz-ebsx-allinone-local ibiz-ebsx-gateway-local

AIBIZ_ALLINONE_PORT=30100 \
AIBIZ_GATEWAY_PORT=30186 \
  ./source-platform-smoke.sh
```

如果要占用正式的 30000/30086，必须先确认正式容器已经停止，并改用
`source-built-target.env`；该 lane 是可选源码构建验收，不是日常快速回归。

原生候选 Central/ModelDesign 验证源码后端时，还必须应用平台路由 overlay；
只启动 `ibiz-ebsx-allinone-local` 不会自动改变候选页面的 nginx 上游。
以下命令保留已生成的插件和 Central 服务模型候选，不触碰原 32006/32007
入口：

```sh
cd "$WORKSPACE_ROOT/plm/deploy/compose"
NATIVE_SERVICE_CANDIDATE_ROOT="$WORKSPACE_ROOT/.artifacts/native-service-migration/central-query-consistent-refs" \
docker compose --env-file .dev --env-file source-built-local.env \
  --profile modeling --profile modeling-native-candidate \
  -f docker-compose-dev.yml \
  -f docker-compose-modeling-native-candidate.yml \
  -f docker-compose-modeling-native-service-candidate.yml \
  -f docker-compose-modeling-native-platform-local.yml \
  up -d --no-deps --no-build --pull never --wait --wait-timeout 90 \
  modelingweb-candidate-central modelingweb-candidate-modeldesign

cd "$WORKSPACE_ROOT/scripts"
AIBIZ_NATIVE_CENTRAL_URL=http://127.0.0.1:32008/central/ \
AIBIZ_NATIVE_MODELDESIGN_URL=http://127.0.0.1:32009/modeldesign/ \
  npm run test:native-platform-api
```

配置测试使用独立随机 tag 和 `share=false`，覆盖匿名 GET/PUT 拒绝、拒绝后
认证读回必须与基线一致、认证消息与分页、保存/更新/重置的同会话及已登录
第二会话读回，并在 finally 清理与验证。即使匿名写入返回 401，状态变化
仍会使测试失败。API 通过不代表原生插件、编辑器保存或重新登录模型读回通过。

标准 32006/32007 入口现已通过独立
`docker-compose-modeling-native-source-platform.yml` 路由到源码后端，
并完成 API 42/42 PASS。此变更不是上述 candidate-only overlay，也不升级模型或
插件；只 recreate `modelingweb-native-central` 和 `modelingweb-native-modeldesign`。
准确部署/只回退两入口的命令见
[NATIVE-SOURCE-PLATFORM-ROUTING.md](NATIVE-SOURCE-PLATFORM-ROUTING.md)。
切换前旧后端的 36/48 FAIL 报告保留为历史基线，不能改写为 PASS。

## 5. Modeling Web 和插件

### 5.1 前端和版本

```sh
cd "$WORKSPACE_ROOT/modelingweb/app"
corepack pnpm@8.15.9 install --frozen-lockfile
pnpm ibiz:versions:check
pnpm test:run
pnpm verify:release
pnpm build:release
pnpm verify:plugins
pnpm test:plugins:deployment
```

当前审计基线：

- Vitest：`551 passed, 0 failed`。
- release preflight、TypeScript、Vite build、dist 验证通过。
- dist 中解析到 73 个模型 runtime plugin package。
- 插件部署 harness：`32 passed, 0 failed`。

### 5.2 Web Docker 临时容器

```sh
cd "$WORKSPACE_ROOT/modelingweb/app"
pnpm test:docker:web
```

该命令只创建唯一命名的临时容器，验证镜像健康、UID 101 写目录能力、
`/modeldesign/`、`/modeldesign/doc/` 和文档 README；它不会接管或重启
Compose 中的共享容器。

### 5.3 真实部署 smoke

需要已有 Modeling Web、Modeling service、PLM 和数据库服务：

```sh
cd "$WORKSPACE_ROOT/modelingweb/app"
PLAYWRIGHT_MODULE="$WORKSPACE_ROOT/plm-e2e/node_modules/@playwright/test" \
  pnpm smoke:deployment
```

如 Playwright 模块已经能从当前项目解析，可以省略
`PLAYWRIGHT_MODULE`。`CHROME_PATH` 仅在需要指定系统浏览器时设置；不要把
macOS 的固定路径当作跨平台前置条件。

已部署插件浏览器 smoke：

```sh
cd "$WORKSPACE_ROOT/modelingweb/app"
PLAYWRIGHT_MODULE="$WORKSPACE_ROOT/plm-e2e/node_modules/@playwright/test" \
  pnpm smoke:plugins:deployed
```

`smoke:plugins` 会测试独立插件服务启动/恢复；`smoke:plugins:deployed`
验证已部署的 32003 sidecar 接口和页面，两者不能互相替代。

原生 Central/ModelDesign 验收必须独立运行：

```sh
cd "$WORKSPACE_ROOT/modelingweb/app"
node tests/native-modeldesign.browser.mjs
```

默认模式只有原生模型、编辑、保存和重载均验证后才返回成功。当前 32003
挂载 `plm/model`，此项预期失败；可用 `--probe-only` 保留登录、文档和插件
资源的诊断报告，但该模式的退出码不表示原生链路通过。
从工作区脚本入口运行同一严格门禁：`npm run test:native-modeldesign --prefix scripts`。
`scripts/test:ci` 也包含该门禁，不能用诊断模式替代验收。

### 5.4 原生模型资源修复候选

此步骤只生成独立的 JSON 资源候选，不部署、不覆盖原件，也不验收原生插件。
资源修复与输入暂存仅限私有可信工作区及可信 artifact 祖先目录。当前父目录为
`0775`、UID `1000`、GID `1000`，所属 UID 及有组写权限的 GID 行为者/进程
以及 same-UID/root 写入者均须可信；每个候选采用协作式单写入者，
禁止并发 UID/GID/root 修改。
子目录 `0700` 无法阻止父目录写入者 rename。Linux pinned reads 拒绝观察到的变化，
不是原子多文件快照，不承诺任意同 UID/root 下的快照或发布安全，
也无法保证检测 `mkdir` 与首次 stat 之间的恶意 rename；本清单不承诺任意替换下
的安全回滚。不要修改既有 artifact 目录权限、原件或产线文件来绕过前提。

主线程已确认的失败/发布契约是：**保留所有部分写入或状态不明确的候选**供审查，
失败时不 cleanup、不 `unlink`、不 `rmdir`，也不递归自动清理。重试只能使用全新
唯一目标，禁止复用失败目录。receipt 直接以排他
`O_CREAT | O_EXCL | O_NOFOLLOW` 写入并 pinned readback，不使用临时文件发布。
**receipt 存在绝不代表生成或暂存成功**，部分写入或最终复查失败也可能留下它；
消费前必须只读验证准确 receipt 及当前文件。主线程反馈独立审核已在上述边界内
认可实现；下方保留历史安全回归，并另列完整源码/配置审计扩展后的
335/335 聚焦与 1013/1013 全量结果。历史回归不能验证后续审计修正，
脚本 PASS 不代表原生编辑器或生产验收。
仅凭历史 receipt 不能证明扩展后的审计契约已通过。

输入目录为
`plm-web/public/plugins/@ibiz-template-plugin/model-design@0.0.3-alpha.122/dist/assets/json/runtime-model`。
原件保持只读，工具只读输入；不要把候选复制回 `public/plugins` 原目录。
允许的修复仅为 JSON 字符串内的原始 LF 转义为 `\n`，其他 JSON 错误必须失败。

固定清点口径为 **1414 个 JSON 总文件 / 17 个变更文件 / 46 处字符串内原始 LF /
1397 个未变更文件**。未变更文件必须字节一致；清点或输入指纹漂移需定位原因，
不能放宽预期值。这些数字不是测试通过数量。

前提是 **Linux、已挂载 procfs，且 `/proc/self/fd` 可访问**；容器内执行也必须
满足此条件。工具的文件描述符路径检查依赖该接口；非 Linux 主机需进入 Linux
环境运行。前提不满足时停止，不绕过检查。

在工作区根目录依次执行生成、只读 receipt 验证、聚焦测试及 scripts 全量测试。
示例显式使用唯一输出目录，确保验证读取的是本次生成的 receipt：

```sh
(
  set -e
  cd "$WORKSPACE_ROOT"
  test "$(uname -s)" = Linux
  test -d /proc/self/fd
  REPAIR_RUN_ID="$(node -p 'require("node:crypto").randomUUID()')"
  REPAIR_DIR=".artifacts/native-resource-repair/repair-$REPAIR_RUN_ID"
  node scripts/repair-native-model-resources.mjs --output "$REPAIR_DIR"
  node scripts/repair-native-model-resources.mjs --verify-receipt "$REPAIR_DIR/receipt.json"
  node --test scripts/tests/repair-native-model-resources.test.mjs
  npm test --prefix scripts
)
```

后续任何复制到独立候选或消费这些资源的构建之前，都必须对该候选的准确 receipt
再次运行 `--verify-receipt`。消费者只读检查当前原件指纹、每一处 LF 修改与偏移、
逐文件记录和哈希、当前副本 JSON 及文件集指纹；陈旧/篡改 receipt、原件或副本
漂移必须停止消费，不能只相信 receipt 的已记录状态。验证不改写原件、副本或
receipt；`--verify-receipt` 不能与 `--output` 合用。

聚焦命令的等价 alias 是 `npm run test:native-resources --prefix scripts`。
scripts 全量 `npm test --prefix scripts` 通过 `tests/*.test.mjs` 通配符包含此套件；
这两个入口都不能替代原生浏览器验收。

不指定 `--output` 时，每次生成唯一的
`.artifacts/native-resource-repair/repair-<timestamp>-<uuid>/`，包含 `resources/`
与 `receipt.json`；已有目标禁止覆盖。以本次命令打印的 receipt 路径记录证据，
不要复用历史 receipt。核对输入/输出文件集指纹、逐文件 SHA-256、解析结果及 LF
修改记录，并为聚焦测试、全量测试分别记录命令、时间和退出码。
后续每次运行均需独立确认结果；下方阶段证据不自动覆盖后续代码变更或运行。

receipt 应保持 `contract: native-model-resource-repair-candidate`、
`status: prepared-not-accepted`、`acceptedForProduction: false`、
`runtimeModelSourceRecovered: false`。候选未验收；JSON 可解析不代表
`runtime-model@0.2.2` 的可编辑源码及独立构建证据已获得，不代表迁移映射通过，
也不代表 Central/ModelDesign 编辑、保存、重载或全链路已完成。

消费者验证成功返回 `status: verified-resource-candidate-not-accepted` 和
`resourceIntegrityVerified: true`；`acceptedForProduction` 与
`runtimeModelSourceRecovered` 均保持 false，不升级持久化 receipt 的
`prepared-not-accepted` 状态，不证明缺失源码来源，也不授权生产复制/构建。

已观察到的资源候选 receipt 为
`.artifacts/native-resource-repair/repair-2026-10-05T17-27-50-342Z-71e3bbb8-848a-4b21-a4f4-8c68e2925498/receipt.json`，
`generatedAt` 为 `2026-10-05T17:27:50.464Z`（UTC），对应工作站本地
`2026-10-06T01:27:50.464+08:00`，清点符合上述固定口径。
输入文件集指纹为 `138c8f08d260037c0687cf2c255d85f27a2d02a82f234d2c9414ba2356155797`，
输出为 `45f5a9acfc8bf181e05f5ae1e15088c1c8b7ec1f44dba5a172dfc4bb7e315211`。
其状态仍是未验收候选，生产验收及 runtime-model 源码恢复标志均为 false。

从工作区根目录只读复验该持久化候选：

```sh
node scripts/repair-native-model-resources.mjs --verify-receipt \
  .artifacts/native-resource-repair/repair-2026-10-05T17-27-50-342Z-71e3bbb8-848a-4b21-a4f4-8c68e2925498/receipt.json
```

主线程已独立验证该 receipt，输出指纹仍为上述 `45f5a9ac...`，消费者状态为
`verified-resource-candidate-not-accepted`，生产验收和源码恢复标志均为 false。
上述确切 UTC 戳是候选生成时间，不是对后续验证/回归执行时间的推断。
`regression-20261006` 是工作站 +08:00 的目录命名，不代表 UTC 回归日期为
2026-10-06。

**输入暂存工具新增前的资源生成器/消费者回归证据**

主线程已确认下列资源生成器/消费者回归，命令工作目录为 `scripts/`。
同一路径日志已覆盖为该轮最终版本；下方计数仅对应资源修复阶段，不覆盖后来
新增的输入暂存工具。本清单其他历史证据保持原样。

| 命令 | 此前资源工具回归确认 | 证据日志 |
|---|---|---|
| `npm run test:native-resources` | 77 passed, 0 failed, 0 skipped；1.22 s | `.artifacts/native-resource-repair/regression-20261006/resource-tests.log` |
| `npm test` | 768 passed, 0 failed, 0 skipped；39.77 s | `.artifacts/native-resource-repair/regression-20261006/scripts-tests.log` |

聚焦套件包含真实 1414 文件树、逐文件 receipt 检查及只读消费者的陈旧/篡改
证据拒绝检查。这些结果仅证明脚本/资源回归，不表示生产验收或原生浏览器链路通过；
`runtime-model@0.2.2` 源码及独立构建证据仍缺失，候选验收标志保持 false。

### 5.5 model-design 隔离输入暂存：构建仍阻断

`scripts/prepare-native-model-design-inputs.mjs` 是独立暂存步骤，不能沿用资源
回归 PASS 作为本步骤通过。它通过 `--repair-receipt` 读取并复验准确的资源
receipt，把已审计 `model-design@0.0.3-alpha.122` 的源码、manifest 和构建配置
字节不变地复制到新的 `.artifacts/native-model-design-inputs/<new>/package/`。
源码原件及已修复资源候选均保持只读。

独立审查发现此前仅固定 `src/` 与 manifest，未独立固定全部暂存根配置的
P2 漂移缺口。扩展后的完整源码/配置审计覆盖 **72 个文件**：`src/` 下 68 个，
加 `package.json`、`tsconfig.json`、`ibiz.config.cjs`、`CHANGELOG.md`。
新 receipt 必须声明 `source.audit.inputFiles: 72`，并固定
`source.audit.inputFingerprint` 为
`a2eff77ed8cdefebfa24636620baa77b8e067458d92033edb0492465ca21ed06`。
缺少这些字段的旧 receipt 仅为历史证据；顶层源码指纹相同或仍使用
`schemaVersion: 1` 都不能替代扩展审计。不得手工补字段或复用旧输入树，
应由当前工具生成全新唯一候选，再携带准确资源 receipt 只读复验。

资源暂存位置是 `package/public/assets/json/runtime-model`，不是
`package/src/assets/json/runtime-model`。已安装的
`@ibiz-template/cli-core@0.3.30` 默认 CopyFilePlugin 将 `public` 复制到
`dist`、`es`、`lib`；依据其 `dist/define-config.js`、
`dist/rollup/bundle-option/bundle-option.js` 与
`dist/rollup/module-option/module-option.js`。下方独立 hook 实验不等同于
完整插件构建中的资源复制、typecheck 或原生验收。

沿用 Linux `/proc/self/fd` 和 Node 前提，从工作区根目录执行。下例显式检查
两个步骤都返回预期 exit 2，仅用于记录“构建阻断”，不能据此报告构建通过：

```sh
(
  set -e
  cd "$WORKSPACE_ROOT"
  test "$(uname -s)" = Linux
  test -d /proc/self/fd
  REPAIR_RECEIPT=".artifacts/native-resource-repair/repair-2026-10-05T17-27-50-342Z-71e3bbb8-848a-4b21-a4f4-8c68e2925498/receipt.json"
  INPUT_RUN_ID="$(node -p 'require("node:crypto").randomUUID()')"
  INPUT_DIR=".artifacts/native-model-design-inputs/inputs-$INPUT_RUN_ID"
  result=0
  node scripts/prepare-native-model-design-inputs.mjs \
    --repair-receipt "$REPAIR_RECEIPT" --output "$INPUT_DIR" || result=$?
  test "$result" -eq 2
  result=0
  node scripts/prepare-native-model-design-inputs.mjs \
    --repair-receipt "$REPAIR_RECEIPT" --verify-receipt "$INPUT_DIR/receipt.json" || result=$?
  test "$result" -eq 2
)
```

新目录包含 `package/` 和独立 `receipt.json`，禁止覆盖已有目标。
只读验证同时需要新输入 receipt 和准确的资源 repair receipt。
同时遵守上节可信祖先目录与失败保留契约；即使 `receipt.json` 已存在，
也不得消费未通过验证的输入树。
生成状态为 `prepared-build-blocked`，验证返回 `verified-inputs-build-blocked`；
两者均故意 exit 2，`buildReady`、`acceptedForProduction`、
`runtimeModelSourceRecovered` 均为 false。

首次暂存 receipt 为
`.artifacts/native-model-design-inputs/inputs-20261005-isolated-first/receipt.json`，
生成于 `2026-10-05T17:51:55.228Z`（UTC），观察到 **72 个源码/配置文件 +
1414 个资源文件 = 1486 个 package 文件**。此 receipt 早于显式 `mapping`
字段及完整源码/配置审计扩展，仅作为历史清点证据，不能声称通过当前工具的验证。
应生成新的唯一目录并复验新 receipt。当前契约须同时记录扩展审计和
requested `0.0.3-alpha.90`、
candidate `0.0.3-alpha.122`、`compatibility: not-verified`，版本兼容仍未验收。

主线程曾在扩展审计前生成并只读 consumer 复验的历史 receipt：
`.artifacts/native-model-design-inputs/inputs-2026-10-05T18-05-51-886Z-58fccf70-dc78-4ca8-a573-aae052d049fa/receipt.json`，
`generatedAt: 2026-10-05T18:05:52.357Z`（UTC）。显式 mapping 与上述契约一致，
仍为 **72 + 1414 = 1486** 个输入，package 指纹为
`f01090611643590f974a5ebacbf1b928f5ce29bb47fcbc9e7b459c1c16154538`。
生成及验证均按预期 exit 2：持久化状态 `prepared-build-blocked`，
consumer 返回 `verified-inputs-build-blocked`，`buildReady`、生产验收及源码恢复
标志仍为 false。其 `source.audit` 缺少 `inputFiles`、`inputFingerprint`，
不能作为当前 verifier 的证据；顶层源码指纹相同不能补足这些字段。
保留旧候选并生成/验证新 receipt，不得沿用或修改旧 receipt。

扩展审计前的历史 CLI consumer 结果记录在
`.artifacts/native-model-design-inputs/regression-20261006-safety/verify-cli.json`，
状态为 `verified-inputs-build-blocked`、`inputIntegrityVerified: true`。
主线程确认实际退出码为预期 exit 2，验证未跳过；不代表构建执行或验收，
其 `inputIntegrityVerified: true` 也不验证后续扩展的完整源码/配置审计。
其中 `generatedAt` 沿用输入 receipt 生成时间，不是单独的 consumer 执行时间。

扩展审计后的新 receipt 已由主线程确认生成及只读验证，均按预期 exit 2：
`.artifacts/native-model-design-inputs/inputs-20261006-config-pinned-first/receipt.json`，
生成于 `2026-10-05T18:35:02.328Z`（UTC）；`20261006` 是工作站 +08:00 命名。
已只读核对新 `source.audit.inputFiles: 72` 与上述完整指纹，
仍为 **72 + 1414 = 1486** 个输入，package 指纹仍是
`f01090611643590f974a5ebacbf1b928f5ce29bb47fcbc9e7b459c1c16154538`。
生成与 consumer 捕获分别位于
`.artifacts/native-ai-code-deployment/regression-20261006/model-design-generate-cli.json`、
`.artifacts/native-ai-code-deployment/regression-20261006/model-design-verify-cli.json`；
父目录名称不改变其 model-design 证据范围。
持久化状态 `prepared-build-blocked`；consumer 为 `verified-inputs-build-blocked`、
`inputIntegrityVerified: true`。`buildReady`、`acceptedForProduction`、
`runtimeModelSourceRecovered` 均保持 false，alpha.90/alpha.122 兼容仍为
`not-verified`。这只验证候选输入完整性，不代表构建就绪或原生验收。
后续消费前仍须复验准确 receipt。

已完成的独立 CLI CopyFilePlugin hook 实验 receipt：
`.artifacts/native-model-design-inputs/asset-copy-experiment-LbUEZg/receipt.json`；
日志：
`.artifacts/native-model-design-inputs/regression-20261005-isolated/cli-asset-copy-realpath.log`。
UTC 起止时间为 `2026-10-05T17:55:21.902Z` 至 `2026-10-05T17:55:23.353Z`。
从暂存 `public` 复制到独立实验的全新 `dist`/`es`/`lib`，每份均为 1414 个文件、
全部通过 `JSON.parse`，且指纹均为
`45f5a9acfc8bf181e05f5ae1e15088c1c8b7ec1f44dba5a172dfc4bb7e315211`。
状态是 `asset-copy-hook-pass-not-plugin-build`，`fullPluginBuildExecuted: false`、
`acceptedForProduction: false`；不能解除完整插件的资源产物复制阻断。

剩余阻断为完整 `runtime-model@0.2.2` 源码及构建配置、隔离依赖锁定/安装、
loader 交付、`built-dist-and-es-resource-copy-not-verified`、本地 typecheck/build、
原生版本兼容及编辑/保存/重载验收。两种 CLI 模式都不执行 install/build。
暂存聚焦入口是 `npm run test:native-model-design-inputs --prefix scripts`，
全量入口是 `npm test --prefix scripts`；
此前资源通过不能替代本步骤验证。

**扩展审计前的历史聚焦安全回归**

主线程确认 **224/224 passed，0 failed，0 skipped**：
资源 93 + 输入暂存 118 + 源码证据 13。
已只读核对
`.artifacts/native-model-design-inputs/regression-20261006-safety/focused-tests.log`，
汇总为 224 tests/pass、零失败/跳过/取消，`duration_ms: 7451.185517`。
分项计数以主线程确认为依据，不沿用历史资源阶段计数。
在工作区根目录复现联合聚焦入口：

```sh
node --test \
  scripts/tests/repair-native-model-resources.test.mjs \
  scripts/tests/native-model-design-inputs.test.mjs \
  scripts/tests/native-plugin-source-evidence.test.mjs
```

主线程确认且已核对日志的首轮 `npm test --prefix scripts` 为
**902/902 passed，0 failed，0 skipped**，`duration_ms: 38196.672604`，
日志为 `.artifacts/native-model-design-inputs/regression-20261006-safety/scripts-tests.log`。
这是中间结果，不是最终部署全量：主线程随后新增三个标准源码 overlay 检查，
并反馈其专项入口 19/19 PASS。当时最终全量待重跑，不能将 902 或此前全量计数
当作最终结果。

该历史版本后续最终全量已由主线程确认并只读核对：
**905/905 passed，0 failed，0 skipped**，`duration_ms: 40025.966779`（40.03 s），
日志为
`.artifacts/native-model-design-inputs/regression-20261006-safety/scripts-tests-source-routing.log`。
这更新当时的重跑状态，不抹去 902 的中间证据。这些历史结果不覆盖后续完整
源码/配置审计扩展及新部署工具；不代表插件构建、缺失源码恢复、
生产验收或原生编辑/保存/重载通过。

**历史扩展审计阶段的最终回归：主线程确认并只读核对日志**

| 入口 | 结果 | 证据 |
|---|---|---|
| 联合聚焦 | 335/335 PASS，0 failed/skipped；`duration_ms: 12616.6567` | `.artifacts/native-ai-code-deployment/regression-20261006/focused-tests.log` |
| `npm test --prefix scripts` | 1013/1013 PASS，0 failed/skipped；`duration_ms: 40303.037063` | `.artifacts/native-ai-code-deployment/regression-20261006/scripts-tests.log` |

主线程确认分项为资源 93 + model-input 125 + 源码证据 13 + 路由 3 + ai-code 101
= 335。其中资源/输入/证据 231 项是聚焦子集，不是另一轮全量。
在工作区根目录复现该阶段的联合聚焦入口：

```sh
node --test \
  scripts/tests/repair-native-model-resources.test.mjs \
  scripts/tests/native-model-design-inputs.test.mjs \
  scripts/tests/native-plugin-source-evidence.test.mjs \
  scripts/tests/native-standard-source-platform.test.mjs \
  scripts/tests/native-ai-code-deployment.test.mjs
```

上述结果更新扩展审计后的待确认状态，不覆盖历史 905，也不解除构建/源码/原生验收
阻断。独立 ai-code 部署候选操作见
[NATIVE-AI-CODE-DEPLOYMENT.md](NATIVE-AI-CODE-DEPLOYMENT.md)，不能替代 model-design
构建或原生验收。

平台 API 证据必须绑定端点及 required 检查集，不能混用：

| 端点及主线程确认的 upstream | 结果 | 报告 |
|---|---|---|
| 独立源码候选 `http://127.0.0.1:32008/central/`、`http://127.0.0.1:32009/modeldesign/` -> `ibiz-ebsx-allinone-local` | 42/42 PASS；cleanup PASS | `.artifacts/native-platform-api/model-design-inputs-safety-source-20261006/report.json` |
| 切换前历史标准基线 `http://127.0.0.1:32006/central/`、`http://127.0.0.1:32007/modeldesign/` -> 旧 `ibiz-ebsx-allinone` | FAIL：36/48 passed，12 failed | `.artifacts/native-platform-api/model-design-inputs-safety-20261006/report.json` |
| 较早切换后标准入口 `http://127.0.0.1:32006/central/`、`http://127.0.0.1:32007/modeldesign/` -> `ibiz-ebsx-allinone-local` | 42/42 PASS；两应用 cleanup PASS | `.artifacts/native-platform-api/standard-source-routing-20261006/report.json` |
| 最新 source-bound 回归：标准 32006/32007 -> `ibiz-ebsx-allinone-local` | required 42/42 PASS；两应用 cleanup PASS | `.artifacts/native-platform-api/source-bound-regression-20261006/report.json` |

新源码候选轮次为 `2026-10-05T18:06:46.576Z` 至 `2026-10-05T18:06:48.510Z`
（UTC），exit 0；两应用认证 cleanup 汇总通过，匿名 cleanup 不需要执行。
此前候选 42/42 报告
`.artifacts/native-platform-api/model-design-inputs-regression-20261005/report.json`
保留为历史证据。

默认失败轮次为 `2026-10-05T18:05:30.804Z` 至 `2026-10-05T18:05:33.329Z`
（UTC）。两个 app 各有 `configs-same-session-get`、`configs-update-get`、
`configs-other-session-update-get`、`configs-reset-get`、`configs-roundtrip`、
首次 `cleanup-get-1` 失败，涉及即时/同会话/已登录其他会话的缓存陈旧读回。
最终 cleanup 汇总通过，但首次 cleanup 读回失败仍保留；不能把清理成功算整轮 PASS。
历史失败轮次的 48 条含失败触发的额外六条 cleanup 重试检查；成功轮次是 42 条。
各报告保留实际总数，不将历史 36/48 改成 PASS。

标准入口切换后 API 结果已主确认且核对实际 JSON，UTC 起止为
`2026-10-05T18:17:00.722Z` 至 `2026-10-05T18:17:03.295Z`，exit 0，21 条/应用。
主线程仅 recreate 两个标准 native 容器并确认 healthy；实际 nginx `$native_auth`
为 `ibiz-ebsx-allinone-local:30000`，业务 ModelAPI 与 UAA 上游分别仍为
`modelingservice:32002`、`ibizlab-uaa-api:32666`，模型及插件不升级。

较早切换后的 required runtime 报告
`.artifacts/modeling-runtime-source-routing-20261006/report.json`
为 17/17 PASS，UTC timestamp `2026-10-05T18:17:00.809Z`；
覆盖既有 `32002/ibizmodeling/modelapi` 与 `32003` web/auth 业务栈，不是原生编辑器验收。
较早切换后的门户报告 `.artifacts/external-ui/standard-source-routing-20261006/report.json`
为 9/9 PASS，零 console/HTTP/page/request 错误，
UTC 起止为 `2026-10-05T18:17:00.922Z` 至 `2026-10-05T18:17:02.095Z`。

最新 source-bound 回归已主确认并核对实际 JSON：标准 API 为 required
42/42 PASS、exit 0、21 条/应用，两应用 cleanup 汇总 PASS，匿名 cleanup 无需执行；
UTC 起止为 `2026-10-05T18:33:45.942Z` 至 `2026-10-05T18:33:48.515Z`。
required 业务 runtime 为 17/17 PASS、exit 0，报告
`.artifacts/modeling-runtime/source-bound-regression-20261006/report.json`，
UTC timestamp `2026-10-05T18:33:46.026Z`；仍只覆盖 ModelAPI 32002 和 web/auth 32003。
门户为 9/9 PASS，零 console/HTTP/page/request 错误，报告
`.artifacts/external-ui/source-bound-regression-20261006/report.json`，
UTC 起止为 `2026-10-05T18:33:46.107Z` 至 `2026-10-05T18:33:47.219Z`。
这些运行早于新输入 receipt 生成，不部署或验收暂存的 model-design 输入。

验证门户 `http://127.0.0.1:19323/#?` 的独立新报告为
`.artifacts/external-ui/model-design-inputs-safety-20261006/report.json`，
9/9 PASS，无 console/HTTP/page/request 错误，UTC 起止为
`2026-10-05T18:05:30.925Z` 至 `2026-10-05T18:05:32.057Z`。
此前 9/9 报告
`.artifacts/external-ui/model-design-inputs-regression-20261005/report.json`
保留为历史证据。`safety-20261006` 是工作站 +08:00 命名，不是 UTC 日期。
历史报告保持不变。以上 API/门户结果不代表 model-design 源码构建或原生编辑器验收。

最新 source-bound 原生 browser acceptance 实际 exit 1：
`.artifacts/native-modeldesign/source-bound-regression-20261006/report.json`，
`prerequisiteChecksPassed: false`、`pluginAssetsVerified: false`、八个失败阶段。
Central 四个、ModelDesign 八个固定版本插件的 `package.json` 均返回 404，
包括 `/modeldesign/plugins/@ibiz-template-plugin/global-util-design@0.0.3-alpha.87/package.json`；
准确包清单见独立路由说明。Central 的 `FetchDefault` 是 `DATAQUERY`，不是远程
`FETCH`，导航失败；ModelDesign 登录/home 未初始化，并有四条未解释 browser 错误。
原生编辑、保存、新会话读回仍未验收，不得写全部通过。
较早切换后的八阶段失败仍保留于
`.artifacts/native-modeldesign/2026-10-05T18-17-01.168Z/report.json`；
新 API/脚本 PASS 不抹去任何原生 FAIL。
输入准备的完整独立操作指南见
[NATIVE-MODEL-DESIGN-BUILD-INPUTS.md](NATIVE-MODEL-DESIGN-BUILD-INPUTS.md)。

### 5.6 ai-code 独立 Docker 交付阶段证据

以下为主线程确认且已只读核对的上一阶段完成记录，不是本轮 fresh source-deps
harness 的最终计数或源码依赖构建证据。5.5 节的 1013/1013 scripts、
335/335 聚焦及原生失败报告继续保留为历史。

| 范围 | 结果 | 证据 |
|---|---|---|
| 上一阶段 `npm test --prefix scripts` | 1042/1042 PASS，0 failed/skipped；`duration_ms: 39314.154278` | `.artifacts/native-ai-code-docker/regression-20261006-resume/scripts-tests.log` |
| 实际隔离 Docker delivery | 210 checks，cleanup passed，`errors: []`；主线程确认 CLI exit 2 | `.artifacts/native-ai-code-docker/delivery-20261006-resume-a018745d-5552-4fd0-ad16-54da9f609c14/report.json` |

Docker 报告 UTC 起止为 `2026-10-05T18:54:29.579Z` 至
`2026-10-05T18:54:32.330Z`；目录中的 `20261006` 是工作站 +08:00 命名，
不是 UTC 执行日期。状态为 `docker-delivery-passed-native-not-accepted`、
`deliveryStatus: passed`、`cleanup.status: passed`。210 项包括三个 URL 前缀
`/plugins/`、`/central/plugins/`、`/modeldesign/plugins/` 各 68 项准确字节/哈希
校验（204 项），另有六项准确 404 负例。cleanup container ID 与该独立容器一致，
临时 loopback URL 不再是持久部署入口。

镜像为 `aibiz/native-ai-code-delivery:a31542c7-2fef-43c3-a6f6-904cf3f981ae`，
ID `sha256:286a6765002486781e7116692bee7d754dc065032a739bc308e6da73e8f41cbf`。
报告绑定
`.artifacts/native-ai-code-deployment/deployment-20261006-source-bound-first/receipt.json`，
其 SHA-256 为 `054d6c8b972d320292fdff857815025266051c949020919212405fc911519fb5`。
`acceptedForProduction`、`nativeRuntimeAccepted`、
`ibizDependencySourceBuildsVerified` 均为 false；alpha.92 请求与 alpha.141 候选
兼容性仍为 `not-verified`。此次仅构建静态交付镜像，没有在镜像内 install 或编译插件，
不修改既有 32006/32007 模型、插件及版本 pins。

该阶段的原生 browser acceptance 仍为八阶段 FAIL、主线程确认 exit 1：
`.artifacts/native-modeldesign/ai-code-docker-regression-20261006/report.json`。
Central 失败于 plugin-assets/navigation；ModelDesign 失败于
plugin-assets/login/home/navigation/reload/browser-errors。
`prerequisiteChecksPassed: false`、`pluginAssetsVerified: false`，Central 四个、
ModelDesign 八个固定版本插件 manifest 返回 404。5.5 节的历史八阶段 FAIL 不删除；
1042 脚本 PASS 和 210 项静态交付检查均不能算编辑、保存或新会话读回验收。

复现独立交付流程见
[NATIVE-AI-CODE-DEPLOYMENT.md](NATIVE-AI-CODE-DEPLOYMENT.md)。
source-deps harness 的结果须另行确认，不从上述脚本或静态 HTTP 证据推导。

### 5.7 八项源码依赖、CLI 与 Docker 已完成快照

以下是 2026-10-06 工作站 +08:00 日期的已核对证据；准确执行戳为下列
2026-10-05 UTC。5.5/5.6 的失败报告和 scripts 历史计数全部保留，
不借用它们推导这轮 source-deps、111 文件 runtime-assets 或新全量回归结果。
随后 Monaco 源码已修改，因此本节 report/receipt 哈希及产物指纹现为
**修复前历史快照**，不是改后当前源码验证；八项依赖完成事实仍保留。

| 环节 | 修复前完成结果 | 准确证据 |
|---|---|---|
| 三版 CLI/core 源码构建及消费 | `0.3.0` / `0.3.23` / `0.3.30` 均完成；分别用于 web-theme / vue3-util / ai-code | 三份 build report 路径/哈希见 [CLI 源码记录](NATIVE-CLI-SOURCE-ACQUISITION-20261006.md)；本节 source-deps report 全部绑定 |
| 八项 iBiz 源码依赖及 ai-code | `runtimeSourceBuildsVerified: true`、`aiCodeSourceBuildVerified: true`、`toolchainSourceVerified: true`；recorded exit 2，非 native accepted | `.artifacts/native-ai-code-source-deps/probe-c9ce92e3-d3d7-45d4-a8f3-5fcde616b291/report.json` |
| 新源码产物部署 | 67 outputs + unchanged manifest = 68 files；两项 dependency/source-toolchain truth flags 均为 true；`prepared-not-accepted` | `.artifacts/native-ai-code-deployment/deployment-2026-10-05T20-43-31-909Z-6a3daf16-9165-40f0-86cd-56fccfbca248/receipt.json` |
| 新独立 Docker delivery | 210 checks：204 准确 bytes/SHA-256 + 六项准确 404；cleanup passed，errors empty；`ibizDependencySourceBuildsVerified: true` | `.artifacts/native-ai-code-docker/delivery-d0d7970a-c6d5-49fe-bf86-59fcdebd0d66/report.json` |

源码报告 SHA-256 为
`f5133c1ab75838812f558eab6e414c8d077709ddf2b6998b7e4c0c9a5d384437`，
部署 receipt 为
`fd8a460d05295944024d9cdc7696bb76f9baf27ff8ecb30e17c3acbebca8e176`，
Docker report 为
`778ea6bb5e5087e21e3ca07f1a0d4811f4277ff44fd37cac8f2db5412ec1d292`；
三者准确绑定。源码报告 UTC 起止为 `2026-10-05T20:37:04.358Z` 至
`2026-10-05T20:40:45.983Z`；部署生成于 `2026-10-05T20:43:59.131Z`；
Docker 起止为 `2026-10-05T20:47:41.184Z` 至 `2026-10-05T20:48:32.756Z`。

八项源码依赖为 model-core `0.1.84`、rt-model-api `0.2.82`、
core `0.7.41-alpha.78`、runtime/model-helper/vue3-util `0.7.41-alpha.86`、
theme `0.7.39`、web-theme `3.11.0`。七项依赖加 ai-code 共八个可执行构建
step 均为 `built`，每条命令 exit 0；theme 是九个已记录 SCSS 源码输入，
`compile: not-applicable`、产物指纹 null，不是依赖未完成。
八项依赖源码构建链路已完成；报告记录原件/暂存源码均 `unchanged`，
`outputDrift: []`、`errors: []`、`publishedOwnToolchain: []`。
这是隔离 rebase 的源码构建完成，不是原始锁定版本复现或所有声明范围已兼容。

消费前必须用当前 verifier 只读复验准确 report/receipt，不能只看以上 truth flags。
改后源码必须生成新报告，不能复用本节修复前哈希。
部署生成、复验和 Docker harness 均须显式携带
`--source-deps-report "$DEPS_REPORT"`；完整命令见
[部署说明](NATIVE-AI-CODE-DEPLOYMENT.md)。未传时是历史构建 lane，
不得补写源码依赖/工具链构建已验证。Docker 是已编译产物的静态交付，
`compilerBuildInDockerVerified: false`；source report 的 `nativeAccepted`、
`fullLocalization` 及各证据 `acceptedForProduction` 仍 false，版本范围和
alpha.92/alpha.141 兼容仍 `not-verified`。

### 5.8 可读候选浏览器失败与 runtime-assets 边界

已核对的可读候选浏览器报告为
`.artifacts/native-modeldesign/ai-code-readable-20261006/report.json`，
测试候选 32008/32009，而非覆盖 5.5/5.6 标准端口报告。
Central startup/login/home/navigation/reload 已 PASS；navigation 明确匹配服务
`FetchCurDCSLNUser` 与
`POST /api/ibizmodeling__central/psdevslns/fetchcurdcslnuser`，响应 200 JSON，
空列表渲染通过，不能用放宽 request/endpoint/service 匹配替代这项证据。
Central plugin-assets 仍因 model-design 缺失 FAIL。

ModelDesign 仍有五个准确版本插件 manifest 404：
`console-terminal@0.0.3-alpha.87`、`file-to-base64@0.1.8-alpha.165`、
`global-util-design@0.0.3-alpha.87`、`layout-design@0.0.3-alpha.90`、
`model-design@0.0.3-alpha.90`，scope 均为 `@ibiz-template-plugin/`。
四条未解释浏览器错误包含 `loadGlobalAppUtil` 模型配置缺失，login/home 未通过。
该轮为 **七阶段 FAIL**；`modelDesignStartupVerified`、
`prerequisiteChecksPassed`、`pluginAssetsVerified` 均 false。
ai-code alpha.141 manifest/SystemJS/CSS 为 200，不代表编辑器执行或保存验收。
历史 DATAQUERY preflight 与四/八插件 404 的八阶段 FAIL 继续保留，
不能把候选导航通过推广为原始模型或标准入口验收通过。

第一份 runtime-assets receipt：
`.artifacts/native-ai-code-runtime-assets/loader-monaco-20261006-first/receipt.json`，
SHA-256 `230b93f99e9095e527d56608411fa32d80ce3b9d59611ab5c992763e2a5db85f`，
绑定
`.artifacts/native-model-migration/ai-code-readable-2f51e8b7-b6c2-46ec-9281-4277fa1f28d9`。
111 files、14,039,361 bytes，文件集指纹
`f90bea2a477e1049ea17400eae861ae190a3bbfd085a8d6bb6e98c3092d34811`；
记录 loader `1.7.0` 和 Monaco `0.52.2`。
**只说明 prepared，待浏览器**，状态 `prepared-not-accepted`、
`acceptedForProduction: false`。上述可读候选 browser report 没有证明消费
这 111 个文件，不能算它们的浏览器结果。

后续隔离 runtime 第二轮报告为
`.artifacts/native-ai-code-runtime/browser-worker-20261006-second/report.json`，
UTC `2026-10-05T21:19:27.584Z` 至 `2026-10-05T21:19:31.999Z`。
它绑定另一份 runtime-assets `loader-monaco-worker-20261006-second` receipt，
不是第一份 111 文件 receipt。两入口 HTTP 交付校验 **566/566** 通过
（283/入口；总计 562 个文件 HTTP 200、四个预期 404 negatives）；但 blob TS worker 中相对路径
`./plugins/monaco-editor@0.52.2/min/vs/language/typescript/tsWorker.js`
无法解析，两个 app 的 component-render 和 unmount/runtime-errors 均 FAIL。
总状态 `failed`、`isolatedRuntimePassed: false`、`nativeRuntimeAccepted: false`、
`acceptedForProduction: false`。这是隔离真实插件/provider host，
不执行模型保存或新会话读回，不消除五插件与 GlobalAppUtil 原生启动失败。

主线程已将 `src/monaco-editor/monaco-editor.tsx` 的 loader `paths.vs`
改为 `new URL(..., document.baseURI).href`，保留原 type fix，
source status 为 `published-source-with-recorded-local-fixes`。
该 URL 修复阶段记录的 `src/` 是 20 files、133932 bytes，指纹
`101ed59951be3decafcfad470bd6a09269b5af6b53e84d79f7aa6dc13392c287`。
新 standalone legacy receipt 为 31 inputs / 67 outputs：
`29738346e808f8273718c42f85f2bf8dfbb5fb06f8ee77701bc38f0672db6e49` ->
`a9cfb19444542d75f015c7529cced84aa90c7014b0f57ab64ab612236e0afe1d`。
fresh 全源码构建目录为
`.artifacts/native-ai-code-source-deps/monaco-absolute-20261006`，现已 scoped 完成，
见 5.9 节；不能从源码修复或 legacy receipt 推导新 runtime PASS。
该阶段源码与历史指纹见
[源码审计](NATIVE-PLUGIN-SOURCE-AUDIT.md)。

URL 修复阶段 source-deps/deployment/candidate/Docker 已完成，见 5.9 节；
该轮为历史中间快照，当前生命周期阶段证据和剩余门禁见 5.10 节。
源码变更后旧 report 不可冒充新 build 证据，历史 1013/1042 等计数不升级为
本轮计数。原始源码及 runtime-model 独立构建、Docker 内 compiler、
版本兼容仍须各自证据，不得写 native accepted 或全链路完成。

### 5.9 Monaco URL 修复中间快照 scoped 完成

`monaco-absolute-20261006` 是已完成的阶段快照，不是最终代码。
随后生命周期及 runtime harness 修复、当前证据和剩余门禁见 5.10 节。
以下哈希只描述本节已记录的历史快照，
不能固定为后续改后工作树的当前哈希。

新报告
`.artifacts/native-ai-code-source-deps/monaco-absolute-20261006/report.json`，
SHA-256 `eb9ce8899ebd84c1b90678002448fd6d0eeb2b8e3d9431efc5c54d72d2598f42`，
UTC `2026-10-05T21:22:59.884Z` 至 `2026-10-05T21:26:38.448Z`。
`runtimeSourceBuildsVerified`、`aiCodeSourceBuildVerified`、`toolchainSourceVerified`
均 true，`errors: []`，recorded exit 2，状态
`source-runtime-deps-probe-complete-not-accepted`。
八项依赖源码输入及 ai-code 的新构建已完成，三版 source CLI/core 再次消费；
theme 仍为 SCSS input。这不是 native acceptance。

ai-code 新源码输入指纹为
`29738346e808f8273718c42f85f2bf8dfbb5fb06f8ee77701bc38f0672db6e49`，
67 个 fresh 全源码输出指纹为
`3f2047af56b08d3b6bba3ca9e07ab624ad9e9fe4f0bd23cef0b1d7ad895d4681`，
不是 5.8 的 legacy 输出指纹。
新部署 receipt：
`.artifacts/native-ai-code-deployment/monaco-absolute-20261006/receipt.json`，
SHA-256 `2a77c2296c3959eec6f5f901b24741cb8e939eb00e9120d4735d523b09c4d4c8`，
生成于 `2026-10-05T21:27:41.667Z` UTC，准确绑定新 source report。
68 files、1,545,437 bytes，文件集指纹
`93198a320a4560a2f8e680b5d4b795af486342381be4328ea458dba2e38e28e6`；
`ibizDependencySourceBuildsVerified`、`toolchainSourceBuildsVerified` 均 true，
状态仍 `prepared-not-accepted`、`acceptedForProduction: false`。
5.7 修复前旧哈希继续为历史快照，不能代替本节新证据。

同名模型 candidate 已成功准备：
`.artifacts/native-model-migration/monaco-absolute-20261006/receipt.json`，
SHA-256 `316562e23e1309ca169e8427cdea3b2aa5352dfd917b2ea26cbfcfcc4bfa1f23`。
6 packages、Central/ModelDesign 各 3 个模型文件、5 unresolved mappings；
ai-code 条目准确绑定本节 source report/deployment receipt。
状态 `prepared-not-accepted`、`acceptedForProduction: false`，
不是 migration 或 native 验收。

同名独立 Docker report 已完成：
`.artifacts/native-ai-code-docker/monaco-absolute-20261006/report.json`，
SHA-256 `2a3f193bc7d672aa84ed2e79faef1f54be7cacf858077c36a222296887785151`，
UTC `2026-10-05T21:30:32.570Z` 至 `2026-10-05T21:31:26.609Z`。
准确绑定本节 source/deployment，**210/210 checks**（204 个准确文件
bytes/SHA-256 + 六个预期 404），`deliveryStatus: passed`、
`cleanup.status: passed`、`errors: []`，
`ibizDependencySourceBuildsVerified: true`。
`compilerBuildInDockerVerified`、`nativeRuntimeAccepted`、
`acceptedForProduction` 均 false；这轮静态 delivery 不是新 runtime PASS，
也不覆盖 5.7 的历史 Docker 报告。

主线程汇报 scoped regression **164/164**、runtime/tests **22/22** PASS、0skip；
准确命令、起止时间及日志待补，不能把这些测试计数当作 browser/native 验收。
当前生命周期及收紧后 harness 的证据见 5.10 节；历史 runtime report 的部分
阶段 PASS 不构成新 harness 的通过证据。
五个插件、GlobalAppUtil、编辑/保存/新会话读回及原始身份/版本兼容阻断均保留。

### 5.10 Monaco 生命周期修复当前阶段

主线程已在同一 `src/monaco-editor/monaco-editor.tsx` 落地卸载后
resize/mousedown/timer/late loader 清理，并更新 runtime harness 假阳性门禁；
绝对 loader URL 与原 type fix 保留。当前 source status 为
`published-source-with-recorded-local-fixes`，`src/` 20 files、135764 bytes，
指纹 `d3b13c529e5d9bc4b51768300a62b80fac7458ac560f6fafac19e7d3daf3467f`。
独立 build 完成：31 inputs / 67 outputs，
`8d3932ebe3358d489304dcb25e206f45a69a17759891813edf81a99fd1f3fc27` ->
`adeb4f095755468628bf9fb52ea1d17a43e813276873ea99884a9a1038638448`；
这是 standalone legacy lane，不能继承 5.7/5.9 的源码依赖/CLI truth flags。

主线程汇报 **21/21 PASS、0skip**，由 7 lifecycle、5 path、9 runtime
harness contract tests 组成；不是新浏览器报告或 native 验收。
新全源码依赖/source-CLI build 已 scoped 完成：
`.artifacts/native-ai-code-source-deps/monaco-lifecycle-20261006/report.json`，
SHA-256 `9ea518eee4008c80240164387668f25a4b3e569c4b22c85e46d8109080ad7792`，
UTC `2026-10-05T21:36:08.586Z` 至 `2026-10-05T21:39:48.746Z`，
recorded exit 2，状态 `source-runtime-deps-probe-complete-not-accepted`。
`runtimeSourceBuildsVerified`、`aiCodeSourceBuildVerified`、
`toolchainSourceVerified` 均 true；`errors: []`、`outputDrift: []`，
original/staged source 均 unchanged。八项依赖源码输入及三版 source CLI/core
已再次消费，七依赖加 ai-code 共八个可执行 step 均 built、命令 exit 0，
theme 仍为 SCSS input。67 个 fresh 全源码输出指纹为
`3f1a46beb1ac49de9a771124f191004b0ee021d1ca358ba01d1bcc4ed4f71cc9`，
不可与本节 standalone 输出混用。

publisher receipt 已 prepared：
`.artifacts/native-ai-code-deployment/monaco-lifecycle-20261006/receipt.json`，
SHA-256 `0c287f64978dd07891cf9d00ab478d20ff5c5f08804b3706135b6044f9fbb02b`，
生成于 `2026-10-05T21:40:30.446Z` UTC，准确绑定上述 report。
68 files、1,549,830 bytes（67 outputs + unchanged manifest），文件集指纹
`da73cc5e67040a4d7c39b69d7f3fe6219523432ca44554cd8c8267d29c7422da`；
dependency/toolchain source-build truth flags 均 true。report/receipt 当前只读
复验均 exit 2；receipt 仍 `prepared-not-accepted`、
`acceptedForProduction: false`，仅凭 receipt 不表示运行服务部署或验收。

本轮 `--file-base64-replacement` candidate 已 prepared：
`.artifacts/native-model-migration/monaco-lifecycle-file-20261006/receipt.json`，
SHA-256 `434da7e464c980496762accf1382f97b5c957688a26c4d2d9b6e0c9354689956`。
7 packages、Central/ModelDesign 各 3 个模型文件、4 unresolved mappings；
ai-code 条目准确绑定本节 source report/deployment receipt。
状态 `prepared-not-accepted`、`acceptedForProduction: false`。
独立替代为 `@aibiz/file-to-base64@0.1.0`，
`originalSourceRecovered: false`、`nativeCompatibilityVerified: false`，
`originalMigrationAcceptance: not-satisfied-by-independent-replacement`；
不声称找回原 file-to-base64 源码，也不改原迁移合同的 missing 结论。

主线程确认本轮全量命令 `node --test scripts/tests/*.test.mjs` 已结束，
**1842/1842 PASS、0fail、0skip**，77.137 秒；日志
`.artifacts/native-full-regression-20261006-monaco-file.log`。
另汇报 focused runtime-assets/runtime/Base64-integration 99/99 PASS、
source-evidence/lifecycle 20/20 PASS；聚焦命令/日志及准确起止时间待补。
这些测试覆盖当时已落地的候选/Base64 集成契约，不覆盖之后新增的 Base64
browser harness 或后续修改，不等于实际 assets/browser 或 native 验收。

本轮独立 Docker 已完成：
`.artifacts/native-ai-code-docker/monaco-lifecycle-20261006/report.json`，
SHA-256 `e06d2c75974bead459b28656b405317f36ad03f19063767a5e88875fa4fc9950`，
UTC `2026-10-05T21:47:17.936Z` 至 `2026-10-05T21:48:13.983Z`。
准确绑定本节 source/deployment；210/210 checks（204 个准确 bytes/SHA-256
检查 + 六个预期 404），delivery/cleanup PASS、`errors: []`。
`ibizDependencySourceBuildsVerified: true`；compiler-in-Docker、
native-runtime/production acceptance 仍 false。

本轮同名 runtime-assets receipt 已 prepared：
`.artifacts/native-ai-code-runtime-assets/monaco-lifecycle-file-20261006/receipt.json`，
SHA-256 `b873e670a14d8fcb4370cd1cd20f75312de3dff3b676599a15422aba34840408`。
绑定本节 candidate receipt；111 files、14,040,705 bytes，文件集指纹
`584e6188ad41aa27306aa1479b4faf1cd1a854ff8b7cc92b7789dde078b00987`。
状态 `prepared-not-accepted`、`acceptedForProduction: false`；不是第一轮
111 files/14,039,361 bytes receipt，也不表示新的浏览器执行通过。

主线程已部署新候选至 32008/32009，报告容器 healthy；但新 native 报告仍 FAIL：
`.artifacts/native-modeldesign/monaco-lifecycle-file-20261006/report.json`，
SHA-256 `366319788da1675c87fb15c855420632e7c8f96ad0498dedd457c5ce3f0d297e`。
11 个失败阶段，Central login 因 `Network.getResponseBody` 取 body 失败，
home/navigation/reload 随之阻断；ModelDesign 四 sibling manifest 缺失，
login 等待密码框超时，仍有四条未解释浏览器错误及 `loadGlobalAppUtil` 失败。
两个 app 的 model 阶段 PASS 不覆盖这些失败；startup/prerequisite/
plugin-assets verdict 均 false，不执行编辑/保存/新会话读回。
登录 helper 已补精确响应 token 与实际 `core.getToken()` 一致性门禁，
browser-contract 30/30 PASS、0skip，不替代新浏览器运行结果。
ai-code 独立浏览器仍运行中，待准确绑定本轮 candidate/assets/端点的报告，
验证 worker 执行及卸载后回调清理；不得提前写 runtime 或 native PASS。
5.9 `monaco-absolute` 的成功保留为历史阶段证据，不代替本轮结果。
历史 browser 五插件失败保留；已纳入独立替代不解除其他四个 sibling、
GlobalAppUtil、runtime-model 源码、编辑/保存/新会话读回、原始身份和版本兼容
阻断，不得写 native accepted。

## 6. PLM E2E 全链路

```sh
cd "$WORKSPACE_ROOT/plm-e2e"
corepack pnpm@8.15.9 install --frozen-lockfile
```

为每次运行隔离证据目录，避免覆盖根目录历史结果：

```sh
export PLM_E2E_ARTIFACT_DIR="$WORKSPACE_ROOT/.artifacts/plm-e2e/$(date +%Y%m%d-%H%M%S)"
```

### 6.1 默认、API、桌面和移动端

```sh
pnpm test
pnpm test:api
pnpm test:desktop
pnpm test:mobile
pnpm test:mobile:skip-gate
```

默认 `pnpm test` 故意排除 `@known-issue` 和 `@deep-sweep`。移动端的
`SKIP` 必须为零；先跑 `pnpm test:mobile`，再跑
`pnpm test:mobile:skip-gate`。当前门禁拒绝任何 `SKIP`、unexpected 或
flaky，不能把跳过的移动端用例记为通过。

### 6.2 已知问题和深度扫描

```sh
pnpm test:known
pnpm test:sweep
pnpm test:sweep:workspace
pnpm test:config
pnpm test:harness-ui
```

测试资产包括：

- `tests/api-health.spec.ts`
- `tests/navigation.spec.ts`
- `tests/interactions.spec.ts`
- `tests/person-select.spec.ts`
- `tests/modeling-ide.spec.ts`
- `tests/resource-gantt.spec.ts`
- `tests/deep-feature-sweep.spec.ts`
- `tests/known-issues.spec.ts`
- `config-tests/artifact-isolation.test.mjs`
- `scripts/mobile-skip-gate.mjs`

`test:sweep` 是慢速全功能巡检，会逐个访问一级菜单树节点和标签页；
`test:sweep:workspace` 只跑工作台范围，用于快速定位。正常验收仍需运行
完整 `test:sweep`。

## 7. 结果和证据规则

每个验收项必须同时记录命令、开始时间、退出码、报告目录和结果文件。

- `PASS`：命令退出码为 0，报告无 unexpected、failed、flaky。
- `FAIL`：退出码非 0、报告有失败、关键 HTTP 4xx/5xx、浏览器 page error，
  或证据与实际运行态不一致。
- `SKIP`：测试明确声明的环境缺失或能力差异；不得汇报为通过。
- 旧的 `plm-e2e/reports/test-results.json` 含失败和 trace 缺失错误，只能作为
  历史失败样本，不能作为最新证据。
- `.artifacts/plm-audit-20260929-desktop/reports/test-results.json` 含 1 个
  desktop failure，不能标记为通过。
- 默认 PLM suite 的最新基线是 57 passed、0 skipped；单独的 known issues
  和 deep sweep 分别有 3 个和 12 个 skip，不能据此宣称全部功能已验证。

推荐证据目录：

```text
$WORKSPACE_ROOT/.artifacts/
  harness-baseline-YYYYMMDD/
  modeling-runtime-YYYYMMDD/
  modelingweb-regression-YYYYMMDD/
  plm-e2e/<run-id>/
```

## 8. 最近通过证据

以下保留 2026-09-29/30 审计发现的历史通过证据，不是本轮最终回归计数。
此前 1013/1013 scripts、335/335 聚焦以及标准源码入口 API/runtime/门户结果见
5.5 节；已完成的上一阶段 1042/1042 scripts 和 210 项独立 Docker delivery 见
5.6 节，不能作为本轮 source-deps 的最终结果。修复前已完成源码依赖/CLI/
Docker 快照见 5.7 节，可读候选浏览器及第二轮 worker 失败、111 文件 prepared
边界见 5.8 节。Monaco URL 修复阶段的 fresh 全源码/68 文件部署、
6 packages/5 unresolved candidate 及 210 项 Docker delivery 完成见 5.9 节；
均为历史中间快照。生命周期/harness 修复与独立 build 完成见 5.10 节；
改后全源码依赖/CLI build 已 scoped 完成，publisher receipt 为 prepared，
7 packages/4 unresolved candidate 与新 111-file runtime-assets 已 prepared，
新 Docker 210 checks/cleanup PASS；32008/32009 候选已部署 healthy，但
新 native report 11 阶段 FAIL，ai-code 独立浏览器结果仍待证据。
本轮 scripts 全量为 1842/1842
PASS、0skip，仅覆盖该轮命令执行时的代码，不覆盖后续 browser harness 修改。
PLM 只读 API 2 PASS（认证 setup + 一个 API 用例）及配置 8/8 PASS 见
[NATIVE-SOURCE-PLATFORM-ROUTING.md](NATIVE-SOURCE-PLATFORM-ROUTING.md)。

| 范围 | 结果 | 证据 |
|---|---:|---|
| scripts 契约 | 475 passed, 0 failed | `scripts/npm test` 2026-09-30 执行 |
| PLM Compose | 38 passed, 0 failed | `plm/deploy/compose` 两个 Node test 文件本次执行 |
| Modeling Web 单测 | 551 passed, 0 failed | `modelingweb/app` `pnpm test:run` 本次执行 |
| Modeling Web/plugin | 32 passed, 0 failed | `.artifacts/modelingweb-regression-20260929/plugins-deployment.log` |
| Modeling Web release | build/release/dist 通过，73 plugins | `.artifacts/modelingweb-regression-20260929/build-release.log` |
| 栈 baseline | `RESULT PASS` | `.artifacts/harness-baseline-20260929/summary.txt` |
| Modeling runtime | `status: pass`, 0 failures | `.artifacts/modeling-runtime-current-20260929/report.json` |
| PLM E2E 默认 | 57 passed, 0 skipped, 0 unexpected | `.artifacts/plm-e2e/20260930-source-localization-correct-path/reports/test-results.json` |
| PLM API | 3 passed, 0 skipped, 0 unexpected | `.artifacts/plm-e2e-side-20260930-api-confirm/reports/test-results.json` |
| PLM known issues | 4 passed, 3 skipped, 0 unexpected | `.artifacts/plm-e2e-regression-20260930/known/reports/test-results.json` |
| PLM desktop full flow | 29 passed, 0 skipped, 0 unexpected | `.artifacts/plm-e2e-regression-20260930/desktop/reports/test-results.json` |
| PLM mobile full flow | 29 passed, 0 skipped, 0 unexpected | `.artifacts/plm-e2e-regression-20260930/mobile/reports/test-results.json` |
| PLM deep sweep | 13 passed, 12 skipped, 0 unexpected | `.artifacts/plm-e2e-regression-20260930/deep/reports/test-results.json` |
| 19323 external UI | `status: pass` | `.artifacts/external-ui/side-20260930-confirm/report.json` |

## 9. 当前边界

本清单能证明本地 PLM、Modeling Web 静态交付、插件 sidecar、运行态路由和
浏览器回归链路，但不能替代 iBizModeling Central/ModelDesign 原始核心模型
源码的来源认证。当前核心模型审计仍是 fail-closed；未发现精确原始源码和完整
扩展集之前，不得把“本地可运行”写成“原生核心模型源码已完全本地化”。

- 原生 ModelDesign 编辑、保存、重载尚未通过。旧 32003 PLM 应用模型基线
  `nativeCoreVerified=false`、`editSaveReloadVerified=false`，保留于
  `.artifacts/native-modeldesign/2026-09-29T19-51-17.685Z/report.json`。
  标准 32006/32007 已切换源码后端，其历史浏览器报告仍有八个失败阶段、
  `prerequisiteChecksPassed=false`、`pluginAssetsVerified=false`；
  历史阶段证据见
  `.artifacts/native-modeldesign/ai-code-docker-regression-20261006/report.json`；
  较早 source-bound 及切换后的失败报告保留于 5.5 节。可读候选 32008/32009
  为七阶段 FAIL，五个插件缺失且 GlobalAppUtil 初始化失败，见 5.8 节；
  第一份 111 文件 runtime-assets 只为 prepared，第二轮独立 runtime 仍因
  TS worker 相对 URL 失败，不是 native accepted。5.9 节 URL 修复阶段源码/
  部署/candidate/Docker scoped 完成不覆盖历史浏览器失败，也不是最终代码；
  生命周期/harness 修复与独立 build 已完成，见 5.10 节；
  改后全源码依赖/CLI build 已 scoped 完成，publisher receipt 为 prepared，
  7 packages/4 unresolved candidate 与新 111-file assets 已 prepared，
  Docker 210 checks/cleanup PASS。候选 32008/32009 已部署 healthy，
  新 native report 为 11 阶段 FAIL，ai-code 独立浏览器仍运行中；
  file-to-base64 独立替代不等于原始源码恢复或原生验收。
- 2026-09-30 核心插件历史审计为精确版本仅 1/11 完整，10 个缺失，
  11 个迁移映射均未验证；
  见 `.artifacts/modeling-core-localization/followup-source-gate-20260930/report.md`。
  本轮资源/暂存/路由证据不等同于重新验收这些映射。
- 原生资源修复仅产生未验收候选；`runtime-model@0.2.2` 源码及独立构建证据
  仍缺失，不能用 JSON 修复 receipt 或脚本测试替代源码与原生运行态门禁。
- known issues 的 3 个跳过与 deep sweep 的 12 个跳过不代表功能通过；
  栈 baseline 的 OAuth 客户端令牌检查仍为 `SKIP`，见
  `.artifacts/harness-baseline/20260930-032152/summary.txt`。
