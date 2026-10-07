# Version and Compatibility Matrix

Current frontend/model/plugin evidence, exact receipt hashes and bounded
alignment recommendations:
[2026-10-06 compatibility evidence](VERSION-COMPATIBILITY-EVIDENCE-20261006.md).
The dated baseline and historical delivery stages below are retained.

审计日期：2026-09-29
审计范围：`task7`、`plm`、`modelingweb`、`plm-e2e`、`scripts`，以及这些仓库在当前工作区中直接引用的版本、依赖、Dockerfile 和 Compose 配置。

本文只记录当前声明和证据，不修改源码、`package.json`、`pom.xml`、Dockerfile、Compose 或锁文件。除非特别注明，证据均来自当前工作树；相关仓库存在用户已有未提交改动，因此这里不是干净提交的发布基线。

## 判定规则

- **已确认**：版本值可以从当前文件直接确认；不等同于完整构建或运行时兼容已通过。
- **条件兼容**：版本关系有明确解释，但仍依赖构建、启动或端到端回归。
- **阻断**：当前已有构建/源码证据阻止该关系被标记为通过。
- `package.json` 中的范围（例如 `^1.41.2`）与锁文件中的具体版本不同，若锁定版本满足范围，按正常解析处理，不记为错配。
- 当前有效的 Modeling Web 运行时来源以 `modelingweb/app/package.json` 的 `link:` 目标为准；`modelingweb/packages` 和 `packages-latest` 只作为仓库内历史/候选包树记录，不作为当前运行来源。

## 仓库矩阵

| 仓库/组件 | 项目或源码版本 | 包管理/构建版本 | Docker/Compose 版本 | 当前状态 |
|---|---|---|---|---|
| `task7` | SAPAAS 源码 `5.0.23.8` | Docker 构建阶段：Maven Temurin 8；Ant `1.10.18`；运行阶段：固定摘要镜像内 Tomcat `9.0.122` / JRE 8；编译专用 EL API `9.0.100`；本地第三方依赖 197 个，哈希见 `task7/SAPAAS/lib/SHA256SUMS` | 外部运行镜像 `task7:v124.2.opensource.25082603`；默认 PLM Compose 在 `plm/deploy/compose/docker-compose-dev.yml:551` 使用该镜像 | **阻断**：30 个 Java 文件存在 143 处反编译运行时抛错桩；先前整树编译触及 1000 错误上限；未产出源构建 WAR 或镜像 |
| `plm/backend` | Maven 项目 `v1.0.2`；Spring Boot `2.4.0`；`ibiz.cloud.version=8.1.0.584.1` | 编译目标 Java `1.8`；显式 Groovy `3.0.20` | `backend/Dockerfile` 默认 `eclipse-temurin:11-jre`；Temurin 17 为候选，不默认 | **条件兼容**：Spring Boot `2.4.0` 历史上把 Groovy 解析为 `2.5.13`，与 iBiz `8.1.0.584.1` 需要的 `3.0.20` 混用导致 Java 17 `Unsupported class file major version 61`。当前已统一 Groovy `3.0.20`，fat JAR 和依赖树均无 Groovy `2.5.13`；Java 17 候选已通过配置化启动、认证读接口和 Space CRUD 回归。默认运行仍为 Java 11；业务流回归、单测证据、自有依赖递归闭环和 D01 门禁未完成前不得切默认 |
| `plm` 默认开发 Compose | 业务仓库 `v1.0.2`（`.dev` 发布地址） | 使用已声明的 PLM 配置 | allinone `8.1.0.570.12.250807`；gateway `8.1.0.377-b2-arm64`；PLM runner `v8.1.0.577.77.plm.260322-arm64`；PLM Web `aibiz/plmweb:local`；Modeling Web `aibiz/modelingweb:local`；Task `v124.2.opensource.25082603` | **条件兼容**：这是当前默认开发栈，但平台镜像版本没有与 backend 的 `8.1.0.584.1` 完全对齐 |
| `plm` 本地平台 overlay | 与 backend 的 `8.1.0.584.1` 配置目标一致 | Dockerfile.local 默认 Java 17 | allinone `8.1.0.584.1-local`；gateway `8.1.0.584.1-local` | **条件兼容**：这是备用/本地构建配置，不是默认开发 Compose 的有效镜像集合 |
| `modelingweb/app` | 应用版本 `0.7.38-alpha.55` | pnpm `8.15.9`；依赖通过 `link:` 指向外部 `ibiz-app-hub` | Web 镜像基础 `nginxinc/nginx-unprivileged:alpine`；插件镜像基础 `node:22-bookworm-slim` | **条件兼容**：应用自身版本与实际链接运行时的 `0.7.41-alpha.*` 版本线不同，需要构建和运行回归确认 |
| `plm-e2e` | 项目 `0.1.0` | pnpm `8.15.9`；Playwright 声明 `^1.41.2`、锁定 `1.63.0`；TypeScript 声明 `^5.4.5`、锁定 `5.9.3` | 默认 `baseURL=http://127.0.0.1:4173/` | **已确认**：锁定版本满足声明范围；该项目只定义测试入口，不代表被测服务版本已经通过 |
| `scripts` | 工具包 `0.1.0` | Node `>=20`；依赖 pnpm `^12.5.1`，锁定 `12.5.1` | 未发现自身 Dockerfile；负责脚本、审计和 harness | **已确认**：scripts 自身的 pnpm 12.5.1 与应用仓库使用的 pnpm 8.15.9 是两个不同边界，不应合并为一个全局要求 |

## Modeling Web 实际链接版本

`modelingweb/app/package.json:46-59` 和 `app/pnpm-lock.yaml:26-66` 都把核心运行时、模型包和插件指向 `../../ibiz-app-hub`。当前链接目标的 manifest 版本如下：

| 包 | 当前链接版本 | 证据 |
|---|---:|---|
| `@ibiz-template/core` | `0.7.41-alpha.78` | `ibiz-app-hub/packages/core/package.json:2-3` |
| `@ibiz-template/model-helper` | `0.7.41-alpha.86` | `ibiz-app-hub/packages/model-helper/package.json:2-3` |
| `@ibiz-template/runtime` | `0.7.41-alpha.86` | `ibiz-app-hub/packages/runtime/package.json:2-3` |
| `@ibiz-template/vue3-util` | `0.7.41-alpha.86` | `ibiz-app-hub/packages/vue3-util/package.json:2-3` |
| `@ibiz-template/vue3-components` | `0.7.41-alpha.78` | `ibiz-app-hub/components/ibiz-next-vue3/package.json:2-3` |
| `@ibiz-template/theme` | `0.7.39` | `ibiz-app-hub/packages/theme/package.json:2-3` |
| `@ibiz-template/web-theme` | `3.11.0` | `ibiz-app-hub/components/web-theme/package.json:2-3` |
| `@ibiz/model-core` | `0.1.84` | `ibiz-app-hub/models/model-core/package.json:2-3` |
| `@ibiz/rt-model-api` | `0.2.82` | `ibiz-app-hub/models/rt-model-api/package.json:2-3` |

`ibiz-app-hub` 自身声明 pnpm `10.13.1`（`ibiz-app-hub/package.json:80`）。因此当前安装边界是：

- `modelingweb/app`、`plm-e2e`、PLM 前端类仓库：pnpm `8.15.9`；
- `ibiz-app-hub`（`modelingweb` 的 `link:` 来源）：pnpm `10.13.1`；
- `scripts`：自身依赖 pnpm `12.5.1`。

该三者不能简化为一个统一 pnpm 版本。`scripts/docs/BOOTSTRAP.md:154-167` 和 `scripts/docs/SOURCE-LOCALIZATION.md:482-487` 也明确记录了这一安装边界。

## 当前有效与非当前包树

`modelingweb` 仓库内还保留两套包树，版本与实际 `link:` 来源不同：

| 包树 | 示例版本 | 解释 |
|---|---|---|
| `modelingweb/packages` | `@ibiz/model-core@0.1.64`；`@ibiz-template/runtime@0.7.38-alpha.57` | 历史/候选包树，不是 `app/package.json` 当前链接目标 |
| `modelingweb/packages-latest` | `@ibiz/model-core@0.1.89`；`@ibiz-template/runtime@0.7.41-alpha.127` | 候选包树，不是 `app/package.json` 当前链接目标 |
| `ibiz-app-hub` | `@ibiz/model-core@0.1.84`；`@ibiz/rt-model-api@0.2.82`；运行时 `0.7.41-alpha.78/.86` | 当前 `modelingweb/app` 的实际链接来源 |

证据：`modelingweb/packages/@ibiz/model-core/package.json:2-3`、`modelingweb/packages/@ibiz-template/runtime/package.json:2-3`、`modelingweb/packages-latest/@ibiz/model-core/package.json:2-3`、`modelingweb/packages-latest/@ibiz-template/runtime/package.json:2-3`。

## 明显不一致与证据

1. **PLM Maven 依赖与默认开发 Compose 的平台镜像未对齐。**
   `plm/backend/pom.xml:32` 声明 `ibiz.cloud.version=8.1.0.584.1`，但默认 Compose 使用 allinone `8.1.0.570.12.250807`（`plm/deploy/compose/docker-compose-dev.yml:89-92`）、gateway `8.1.0.377-b2-arm64`（`:153-156`）和 PLM runner `v8.1.0.577.77.plm.260322-arm64`（`:179-182`）。本地平台 overlay 才使用 `8.1.0.584.1-local`（`plm/deploy/compose/docker-compose-platform-local.yml:22-29,59-66`）。这不是可直接忽略的字符串差异，需按配置组合分别验证。

2. **Modeling Web 应用版本与实际链接运行时版本线不同。**
   `modelingweb/app/package.json:5` 是 `0.7.38-alpha.55`，而当前链接的 core/runtime/components 为 `0.7.41-alpha.78/.86`，模型包为 `0.1.84` 和 `0.2.82`。这可能是有意的应用与运行时独立发版，但当前静态证据不足以标记为完全兼容。

3. **Modeling Web 仓库内存在多套同名包版本。**
   `packages`、`packages-latest` 与外部 `ibiz-app-hub` 同时存在不同 `model-core`/runtime 版本。若安装或构建路径切换，可能得到不同依赖图；当前权威来源应保持为 `app/package.json` 的 `link:` 目标。

4. **Task7 源码版本、外部镜像标签和源构建工具链不属于同一版本体系。**
   源码记录为 `5.0.23.8`（`task7/SAPAAS/src/saibz5baselib/net/ibizsys/paas/Version.java:9`），外部运行镜像为 `v124.2.opensource.25082603`（`task7/SAPAAS/lib/README.md:7-8`），源构建则使用 JDK 8、Tomcat 9 JRE 8 和 Ant `1.10.18`（`task7/Dockerfile.source:3-25`）。这些值不能互相推导，也不能据此宣称镜像就是当前源码构建产物。

5. **Task7 当前不能作为源构建兼容通过。**
   `task7/SOURCE-BUILD-AUDIT.md` 记录 `docker-build-localization-r5.log` 测得 30 个文件 / 143 处运行时抛错桩，源码预检因此阻断。更早的整树编译日志 `task7/.artifacts/source-build-audit/docker-build-axis2-r2.log` 达到 1000 错误上限；新增的 Mule 2.2.1、JML 1.0b4、JDBC 和 Axis2 依赖尚未经全树编译及运行时验收，Mondrian 传递依赖仍不完整。尚无源码构建 WAR 或镜像。

## 非问题但需保留的边界

- `plm-e2e` 的 Playwright `^1.41.2` 解析到锁定 `1.63.0`，TypeScript `^5.4.5` 解析到 `5.9.3`，均满足声明范围（`plm-e2e/package.json:19-23`、`plm-e2e/pnpm-lock.yaml:7-13`）。
- `plm/backend` 编译目标 Java `1.8`、运行镜像 JRE 11 是跨版本运行组合，不自动等同于错误；证据分别为 `plm/backend/pom.xml:278-286` 和 `plm/backend/Dockerfile:1-2`，仍应由实际启动和接口回归确认。
- `scripts` 使用 pnpm 12.5.1、应用仓库使用 pnpm 8.15.9、`ibiz-app-hub` 使用 pnpm 10.13.1，是仓库边界差异，不是锁文件漂移；不要用 scripts 的 pnpm 版本重写应用仓库锁文件。
- 默认开发 Compose 中 `aibiz/modelingservice-arm64:source-built`、`aibiz/modelingweb:local`、`aibiz/modeling-plugins:local` 和 `aibiz/plmweb:local` 是本地构建候选；它们的 tag 本身不携带源码 commit 或完整版本证明（`plm/deploy/compose/docker-compose-dev.yml:346-352,409-415,508-514`）。

## 结论

当前可以作为后续定位基线的最小版本关系是：

```text
PLM backend       v1.0.2 / Spring Boot 2.4.0 / iBiz Cloud 8.1.0.584.1 / Java 8 target
Default Compose   allinone 8.1.0.570.12.250807 + gateway 8.1.0.377-b2-arm64
Local platform    allinone/gateway 8.1.0.584.1-local
Modeling Web      app 0.7.38-alpha.55 -> linked hub runtime 0.7.41-alpha.78/.86
Model packages    model-core 0.1.84 / rt-model-api 0.2.82
Task7             source 5.0.23.8; external runtime image v124.2.opensource.25082603
E2E               Playwright 1.63.0 / TypeScript 5.9.3 / baseURL 127.0.0.1:4173
Scripts           Node >=20 / pnpm dependency 12.5.1
```

因此，本次版本审计的结论是：**版本记录已补齐；未发现可直接证明“全链路统一兼容”的证据。当前主要风险仍是 PLM 默认 Compose 与 Maven 平台版本的错配、Modeling Web 应用与实际链接运行时的跨版本组合，以及 Task7 源码构建阻断。**

## Native CLI Source Progress

The matrix above is the historical 2026-09-29 baseline. The following addition
records the original CLI source acquisition on 2026-10-06 (+08:00), not a
retroactive upgrade of earlier compatibility claims.

| Consumer | Exact CLI / CLI-core | Original commit | Original tree | Local source files |
| --- | --- | --- | --- | ---: |
| `ibiz-app-hub/components/web-theme@3.11.0` | `0.3.0 / 0.3.0` | `15ab40e917b0c0bde9a3b7473f3ca30a37cd116c` | `01e9c0943d83e8fc1f55ebb1866b28cf24d79fe4` | 54 |
| `ibiz-app-hub/packages/vue3-util@0.7.41-alpha.86` | `0.3.23 / 0.3.23` | `a592a88de74abb9985e99a53d452d413d370ad7c` | `305b5108f73846807fdcb68d9579159fe58cc07e` | 444 |
| upstream `ai-code@0.0.3-alpha.141`, `model-design@0.0.3-alpha.122`; inspected `modelingweb/app` installation | `0.3.30 / 0.3.30` | `2277d0680777d5d147d912fecab779a6747807eb` | `05e1c337cac5dacce68b7a9db704b35fc3cbff87` | 445 |

The original CLI manifests declare CLI-core as `workspace:*`; published
manifests resolve it to the matching exact version. Keep these three consumer
relationships until real build and consumer regression prove a proposed
alignment, rather than changing all pins to one release by inspection.

All 943 non-protected source files passed pinned Git blob, receipt and raw-byte
readback verification. Three `.npmrc` paths per release were excluded without
reading their contents; `sourceComplete=false` remains explicit.
This proves acquisition, not original lockfile reproduction. All three
CLI/core source builds subsequently completed and passed independent
production-pin verification. Additional third-party type/copy/format tools have their own
exact npm lock under `scripts/toolchains/native-cli-source`; business locks are
not modified. Formatting tools have a separate lock under
`scripts/toolchains/native-cli-format`. Installed iBiz CLI/core packages are resolver contexts only,
not acceptable compiled own inputs.

The source-deps harness now accepts three explicit `--cli-source-report`
arguments, verifies their exact releases and chooses the matching consumer
CLI/core output. Invalid or downgraded source evidence must fail without
published fallback. Omitting these arguments retains the historical published
probe mode, whose `toolchainSourceVerified` claim remains false.

Acquisition and completed build details:
[NATIVE-CLI-SOURCE-ACQUISITION-20261006.md](NATIVE-CLI-SOURCE-ACQUISITION-20261006.md).
The first failed source build remains historical evidence. Current successful
reports use these explicitly recorded third-party compatibility selections:

| Original CLI/core source | TypeScript | Direct Rollup / Vite | Lint / format | Direct rimraf |
| --- | --- | --- | --- | --- |
| `0.3.0` | 5.8.3 | 4.44.1 / 5.3.5 | ESLint 8.57.1 / Prettier 3.6.1 | 5.0.10 |
| `0.3.23` | 5.8.3 | 4.44.1 / 5.3.5 | ESLint 8.56.0 / Prettier 3.1.1 | 5.0.5 |
| `0.3.30` | 5.8.3 | 4.44.1 / 5.3.5 | ESLint 8.56.0 / Prettier 3.1.1 | 5.0.5 |

Both 0.3.0 and 0.3.30 reuse 0.3.23's installed third-party resolver group
without substituting its CLI/core implementation. Original source and
consumer version pins stay distinct. This removes the observed Rollup/Vite
type conflicts and newer-source formatting/rimraf failures, not all possible
behavioral differences. `originalVersionReproductionVerified=false`,
`nativeAccepted=false` and `fullLocalization=false` remain required.

## Completed Pre-Fix Source-Built Delivery

2026-10-06 (+08:00) scoped update: the eight-dependency source-build lane is
complete, with three verified source-built CLI/core releases actually consumed.
This is not a change to the historical matrix, business version pins or
original-version compatibility conclusions. This completed chain precedes
the subsequent Monaco source fix; its hashes are historical snapshots, not
verification of the now changed ai-code source.

| Source-backed package | Candidate version | Completed pre-fix evidence |
|---|---|---|
| `@ibiz/model-core` | `0.1.84` | Built |
| `@ibiz/rt-model-api` | `0.2.82` | Built |
| `@ibiz-template/core` | `0.7.41-alpha.78` | Built |
| `@ibiz-template/runtime` | `0.7.41-alpha.86` | Built |
| `@ibiz-template/model-helper` | `0.7.41-alpha.86` | Built |
| `@ibiz-template/vue3-util` | `0.7.41-alpha.86` | Built with source CLI/core `0.3.23` |
| `@ibiz-template/theme` | `0.7.39` | Recorded SCSS source input; independent JS compile not applicable |
| `@ibiz-template/web-theme` | `3.11.0` | Built with source CLI/core `0.3.0` |
| `@ibiz-template-plugin/ai-code` | `0.0.3-alpha.141` | Built with source CLI/core `0.3.30` |

The report
`.artifacts/native-ai-code-source-deps/probe-c9ce92e3-d3d7-45d4-a8f3-5fcde616b291/report.json`
ran at `2026-10-05T20:37:04.358Z` through `2026-10-05T20:40:45.983Z` UTC.
Its SHA-256 is
`f5133c1ab75838812f558eab6e414c8d077709ddf2b6998b7e4c0c9a5d384437`.
`runtimeSourceBuildsVerified`, `aiCodeSourceBuildVerified` and
`toolchainSourceVerified` are true; eight executable steps (seven dependencies
plus ai-code) are built, all commands exit 0. Theme supplies nine SCSS source
inputs, so its propagated output fingerprint is null, not an unfinished
dependency build. The report records original/staged sources as unchanged,
output drift/errors as empty, and `publishedOwnToolchain: []` at that run.

The deployment receipt
`.artifacts/native-ai-code-deployment/deployment-2026-10-05T20-43-31-909Z-6a3daf16-9165-40f0-86cd-56fccfbca248/receipt.json`
binds that exact source report and 67 fresh outputs plus the unchanged manifest.
The bound Docker report
`.artifacts/native-ai-code-docker/delivery-d0d7970a-c6d5-49fe-bf86-59fcdebd0d66/report.json`
passes 210 checks (204 exact content checks plus six 404 negatives) and cleanup;
`ibizDependencySourceBuildsVerified: true`. It does not compile in Docker:
`compilerBuildInDockerVerified: false`.

The original model requests ai-code alpha.92; the candidate retains alpha.141.
`declaredRangeCompatibility: not-verified`, original-version reproduction and
source repository authenticity remain false, as do native/production acceptance
and full localization. Successful rebased source compilation and static Docker
delivery do not prove exact declared versions or original core-model provenance.

The readable candidate browser report
`.artifacts/native-modeldesign/ai-code-readable-20261006/report.json`
shows Central startup/navigation passing, but seven failing stages overall:
five ModelDesign plugins remain missing and `loadGlobalAppUtil` initialization
fails. Native editor/save/fresh-session acceptance is still blocked.
The separate **111-file** runtime-assets receipt
`.artifacts/native-ai-code-runtime-assets/loader-monaco-20261006-first/receipt.json`
is only `prepared-not-accepted`, awaiting a new browser report that proves its
consumption.

The second isolated runtime report
`.artifacts/native-ai-code-runtime/browser-worker-20261006-second/report.json`
passes **566/566 HTTP delivery checks** (562 file HTTP 200 checks plus four
expected 404 negatives), but component render and runtime-error stages fail:
the blob TS worker cannot resolve
`./plugins/monaco-editor@0.52.2/min/vs/language/typescript/tsWorker.js`.
It binds `loader-monaco-worker-20261006-second`, not the first 111-file receipt.
`status: failed`, `isolatedRuntimePassed: false`, `nativeRuntimeAccepted: false`
and `acceptedForProduction: false`; no model save/readback is exercised.

Main has fixed loader `paths.vs` with `new URL(..., document.baseURI).href`.
At this recorded URL-fix stage, ai-code source status is
`published-source-with-recorded-local-fixes`; the `src/` fingerprint is
`101ed59951be3decafcfad470bd6a09269b5af6b53e84d79f7aa6dc13392c287`
(20 files, 133932 bytes). The refreshed standalone legacy receipt binds source
`29738346e808f8273718c42f85f2bf8dfbb5fb06f8ee77701bc38f0672db6e49`
to outputs `a9cfb19444542d75f015c7529cced84aa90c7014b0f57ab64ab612236e0afe1d`.
Fresh all-source rebuild
`.artifacts/native-ai-code-source-deps/monaco-absolute-20261006/report.json`
has completed with recorded exit 2, scoped success not native acceptance.
`runtimeSourceBuildsVerified`, `aiCodeSourceBuildVerified` and
`toolchainSourceVerified` are true, `errors: []`. Its SHA-256 is
`eb9ce8899ebd84c1b90678002448fd6d0eeb2b8e3d9431efc5c54d72d2598f42`;
67 fresh outputs have fingerprint
`3f2047af56b08d3b6bba3ca9e07ab624ad9e9fe4f0bd23cef0b1d7ad895d4681`,
distinct from the standalone legacy outputs above.
The fresh deployment receipt
`.artifacts/native-ai-code-deployment/monaco-absolute-20261006/receipt.json`
has SHA-256 `2a77c2296c3959eec6f5f901b24741cb8e939eb00e9120d4735d523b09c4d4c8`,
68 files, both source-dependency/CLI truth flags true, and remains
`prepared-not-accepted`.

The intermediate model candidate
`.artifacts/native-model-migration/monaco-absolute-20261006/receipt.json`,
SHA-256 `316562e23e1309ca169e8427cdea3b2aa5352dfd917b2ea26cbfcfcc4bfa1f23`,
completed preparation with six packages, six model files and five unresolved
mappings. Its ai-code entry binds the exact fresh source/deployment hashes;
`prepared-not-accepted`, `acceptedForProduction: false`.
The bound Docker report
`.artifacts/native-ai-code-docker/monaco-absolute-20261006/report.json`,
SHA-256 `2a3f193bc7d672aa84ed2e79faef1f54be7cacf858077c36a222296887785151`,
passes 210 checks (204 exact file checks plus six expected 404 negatives),
cleanup passed, `errors: []`. It is static delivery only:
`compilerBuildInDockerVerified`, `nativeRuntimeAccepted` and
`acceptedForProduction` remain false.

Main reports 164/164 scoped and 22/22 runtime/tests PASS, 0 skipped, pending
exact regression commands/logs. `monaco-absolute-20261006` is a completed
**historical intermediate snapshot, not final code**. Monaco lifecycle cleanup
and stricter runtime harness checks are tracked separately in the current
stage below. Old partial runtime stage passes are not stricter-harness acceptance.
No new runtime/native pass is claimed. Old hashes remain historical after drift.
Recorded-stage source details:
[NATIVE-PLUGIN-SOURCE-AUDIT.md](NATIVE-PLUGIN-SOURCE-AUDIT.md).
Exact deployment/Docker/runtime hashes, missing plugin identities and
remaining evidence are in
[NATIVE-AI-CODE-DEPLOYMENT.md](NATIVE-AI-CODE-DEPLOYMENT.md).

## Current Lifecycle Source Stage

Main has applied resize/mousedown/timer/late loader cleanup after unmount in
the same `src/monaco-editor/monaco-editor.tsx`, alongside the absolute loader
URL and existing type fix. Source status remains
`published-source-with-recorded-local-fixes`. The current `src/` has 20 files,
135764 bytes, fingerprint
`d3b13c529e5d9bc4b51768300a62b80fac7458ac560f6fafac19e7d3daf3467f`.
The completed standalone build binds 31 inputs / 67 outputs:
`8d3932ebe3358d489304dcb25e206f45a69a17759891813edf81a99fd1f3fc27` ->
`adeb4f095755468628bf9fb52ea1d17a43e813276873ea99884a9a1038638448`.
It does not inherit source-dependency/CLI truth flags from historical reports.

Main reports **21/21 PASS, 0 skipped**: seven lifecycle, five path and nine
runtime harness contract tests, not a browser run. The fresh source-dependency/
source-CLI report
`.artifacts/native-ai-code-source-deps/monaco-lifecycle-20261006/report.json`
is **complete in scope, not native accepted**, SHA-256
`9ea518eee4008c80240164387668f25a4b3e569c4b22c85e46d8109080ad7792`.
It ran from `2026-10-05T21:36:08.586Z` to `2026-10-05T21:39:48.746Z` UTC,
recorded exit 2; all three source-build verification flags are true,
`errors: []`, `outputDrift: []`, original/staged sources unchanged.
The eight dependency source-input lane and three source-built CLI/core releases
are consumed again; all eight executable steps exit 0, theme is SCSS input.
The 67 fresh all-source outputs have fingerprint
`3f1a46beb1ac49de9a771124f191004b0ee021d1ca358ba01d1bcc4ed4f71cc9`,
not the standalone output fingerprint above.

Publisher receipt
`.artifacts/native-ai-code-deployment/monaco-lifecycle-20261006/receipt.json`,
SHA-256 `0c287f64978dd07891cf9d00ab478d20ff5c5f08804b3706135b6044f9fbb02b`,
binds that exact report, with 68 files including the unchanged manifest.
Both dependency/toolchain source-build truth flags are true. Report and
receipt pass current read-only verification with exit 2; publisher preparation
alone is not service deployment or native acceptance.

The candidate
`.artifacts/native-model-migration/monaco-lifecycle-file-20261006/receipt.json`,
SHA-256 `434da7e464c980496762accf1382f97b5c957688a26c4d2d9b6e0c9354689956`,
has completed preparation: seven packages, six model files, four unresolved
mappings, exact current ai-code report/deployment bindings. It remains
`prepared-not-accepted`, `acceptedForProduction: false`. Its independent
`@aibiz/file-to-base64@0.1.0` replacement records
`originalSourceRecovered: false`, `nativeCompatibilityVerified: false` and
`originalMigrationAcceptance: not-satisfied-by-independent-replacement`;
it does not recover the original file-to-base64 source or update its mapping.

Main confirms `node --test scripts/tests/*.test.mjs` completed **1842/1842
PASS, 0 skipped**, 77.137 seconds, log
`.artifacts/native-full-regression-20261006-monaco-file.log`. This run covers
the then-current candidate/Base64 integration contracts, not subsequent
Base64 browser harness additions or real browser/native acceptance.
Current Docker report
`.artifacts/native-ai-code-docker/monaco-lifecycle-20261006/report.json`,
SHA-256 `e06d2c75974bead459b28656b405317f36ad03f19063767a5e88875fa4fc9950`,
passes 210 checks (204 exact file checks plus six 404 negatives), cleanup
passed, errors empty. It binds the current report/receipt; compiler-in-Docker,
native-runtime and production acceptance remain false.
Runtime-assets receipt
`.artifacts/native-ai-code-runtime-assets/monaco-lifecycle-file-20261006/receipt.json`,
SHA-256 `b873e670a14d8fcb4370cd1cd20f75312de3dff3b676599a15422aba34840408`,
binds the new candidate: 111 files, 14,040,705 bytes, fingerprint
`584e6188ad41aa27306aa1479b4faf1cd1a854ff8b7cc92b7789dde078b00987`.
It is `prepared-not-accepted`, not browser verification.

Main reports candidate services deployed healthy on 32008/32009. The new
native report
`.artifacts/native-modeldesign/monaco-lifecycle-file-20261006/report.json`,
SHA-256 `366319788da1675c87fb15c855420632e7c8f96ad0498dedd457c5ce3f0d297e`,
records **11 failing stages**: Central login response-body retrieval fails,
with home/navigation/reload blocked; ModelDesign still has four missing sibling
plugins and GlobalAppUtil failure. Startup/prerequisite/plugin-assets verdicts
are false. The exact-response token and actual `core.getToken()` login contract
has 30/30 browser-contract tests passing, not a successful browser rerun.
The new ai-code isolated browser run is still in progress; no current runtime
or native pass is claimed.
Retain the absolute-URL stage hashes above as historical. The five missing
plugins in the historical browser report, GlobalAppUtil, save/fresh-session
readback, runtime-model source and native/production acceptance remain unresolved.
