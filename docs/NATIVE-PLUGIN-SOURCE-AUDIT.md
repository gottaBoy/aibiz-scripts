# Native 11 Plugin Source Audit

审计日期：2026-10-05
ai-code 源码修复/指纹补记：2026-10-06（Asia/Shanghai）；下列原生 mapping
审计结论仍保留，记录的候选阶段指纹不升级 migration 或 runtime 验收。

2026-11-03 route-picker 当前绑定补记：下表的 route-picker 行已同步到本日两次
一致构建的新 receipt，来源与兼容性状态不变。证据为
`.artifacts/canonical-migration-source-build/route-picker-refresh-20261103T150151Z-ae9d79be`。
先前 source `4a35136947ea4cb86ef20400b167b7445e9a93c5787c06b5429aded675f5b085`、
target `01161de501c6207d0b2fa4354af442e60a2788b78c76f7d97972dddd7bc152ac`
保留为历史绑定；不是新源码的证明，也没有修改历史 receipt。

范围是 iBizModeling `Central` 和 `ModelDesign` 当前模型中的 11 个精确
`rTObjectRepo` 引用。本文只审计版本、源码来源、文件指纹和构建凭据；
原生浏览器、模型候选部署、nginx 路由和 Task 审计由主线程负责。

## 结论

当前合同审计结果为：

```text
requested: 11
mapped: 11
completeExact: 1
source/build/runtime verified for migration use: 0
blocked: 11
scanErrors: 0
```

11 个映射的合同结构和已有 source/target 指纹均可通过
`validateMigrationMapping`，没有发现已记录指纹漂移。`migrationReady` 仍为
`false`，这是预期的 fail-closed 结果，不是静态脚本异常。

## Mapping Matrix

| Exact model reference | Observed local target | Source status | Source fingerprint | Target fingerprint | Build receipt | Current blocker |
|---|---|---|---|---|---|---|
| `@ibiz-template-plm/drbar-ex@0.0.3-dev.51` | `@ibiz-template-plm/drbar-ex@0.0.3-alpha.241` | `reconstructed` | `ee39efe55dd47bc6f377262ff5f4c56ff1f7281568d02b0e612c8b344d8115e4` | `af4ee6c86acdd5577eea9b85e2fee78e6fa8bf05b38bb05130127e2c7397efa9` | verified | reconstructed source is not authenticated original; native runtime not verified |
| `@ibiz-template-plm/list-tree@0.0.2-dev.145` | `@ibiz-template-plm/list-tree@0.0.3-alpha.225` | `reconstructed` | `68763a7554d33da76d9ab1b687d433d9450d05c2cf13fbcb9f7c5b7fabf580d5` | `39daa16552f25d59e20aceee93ea5bd387d7edb296de1203425e031ff361c27d` | verified | reconstructed source is not authenticated original; native runtime not verified |
| `@ibiz-template-plm/route-picker@0.0.2-dev.142` | `@ibiz-template-plm/route-picker@0.0.3-alpha.245` | `reconstructed` | `de034755938f3942445e716d94d15d721b49e78afca41996de3155a364cbe11c` | `019df946872f0a22bd90c6e1864361396ab0f6c15904d3eb1eaecf697d4c1b49` | verified | reconstructed source is not authenticated original; native runtime not verified |
| `@ibiz-template-plugin/ai-code@0.0.3-alpha.92` | `@ibiz-template-plugin/ai-code@0.0.3-alpha.141` | candidate only | not accepted | `bbce5e5bad7289e1cb8ac9bf6b13985ddbeb89661dca1f648265e27ed1cb3ac8` | standalone candidate receipt verified | candidate output is not the mapped `public/plugins` output; native compatibility not verified |
| `@ibiz-template-plugin/console-terminal@0.0.3-alpha.87` | none | missing | n/a | n/a | missing | no same-package target or source |
| `@ibiz-template-plugin/file-to-base64@0.1.8-alpha.165` | none | missing | n/a | n/a | missing | no same-package target or source |
| `@ibiz-template-plugin/global-util-design@0.0.3-alpha.87` | none | missing | n/a | n/a | missing | no same-package target or source |
| `@ibiz-template-plugin/img-to-base64@0.1.8-alpha.144` | `@ibiz-template-plugin/img-to-base64@0.1.8-alpha.438` | `reconstructed` | `1f3bf1ce17253bf918073407717ad6bf560ed48689185e3460ac5cd98cc4b43d` | `369f0e44411edb4a7e9883a670a541e52b062836d0168b18788a13edb5ac96c2` | verified | reconstructed source is not authenticated original; native runtime not verified |
| `@ibiz-template-plugin/layout-design@0.0.3-alpha.90` | none | missing | n/a | n/a | missing | no same-package target or source |
| `@ibiz-template-plugin/logic-tree-design@0.0.3-alpha.56` | `@ibiz-template-plugin/logic-tree-design@0.0.3-alpha.56` | `verified` | `68f39aa9112820242aeed0ca64bb3bb71de1e0a2800bbd318ae18e7ba4a6fc12` | `37daa1f61e9e2e87b3b073d4c0ba9d819384bcf6e04563a4d57f2299578959dd` | verified | native Central/ModelDesign runtime not verified |
| `@ibiz-template-plugin/model-design@0.0.3-alpha.90` | `@ibiz-template-plugin/model-design@0.0.3-alpha.122` | candidate only | not accepted | `5e989027c13953a998f75cf3df76aa00b78fc9d24b044ff5627c8efaec7426ad` | missing | candidate requires `@ibiz-template-plugin/runtime-model@0.2.2`; native compatibility not verified |

`verified` in the mapping contract means that the exact published source tree,
manifest identity and local output receipt were checked. It does not authenticate
the original upstream repository commit and does not imply native browser
acceptance.

## Candidate Sources

Candidate observations are deliberately stored separately in
`fixtures/modeling-core-source-candidates.json`; they do not change the
mapping status.

### ai-code

Candidate:
`vendor-upstream/gottaboy-plm-web/plugin-src/@ibiz-template-plugin/ai-code@0.0.3-alpha.141`

#### Current Lifecycle Snapshot

主线程已在同一 `src/monaco-editor/monaco-editor.tsx` 落地卸载后
resize/mousedown/timer/late loader 清理，并更新 runtime harness 假阳性检查；
绝对 loader URL 和原 type fix 保留。

- current source status: `published-source-with-recorded-local-fixes`
- current source tree: 20 files, 135764 bytes,
  `d3b13c529e5d9bc4b51768300a62b80fac7458ac560f6fafac19e7d3daf3467f`
- current published-source differences:
  `module/inline-completions/inline-completions.ts` (type fix) and
  `monaco-editor/monaco-editor.tsx` (absolute URL and lifecycle cleanup)
- current standalone legacy receipt: 31 inputs, 67 outputs,
  `8d3932ebe3358d489304dcb25e206f45a69a17759891813edf81a99fd1f3fc27` ->
  `adeb4f095755468628bf9fb52ea1d17a43e813276873ea99884a9a1038638448`
- receipt path:
  `vendor-upstream/gottaboy-plm-web/plugin-src/@ibiz-template-plugin/ai-code@0.0.3-alpha.141/.artifacts/build-receipt.json`;
  SHA-256 `604fc74f9281264be60b3b71ecf4d0883ef6cefe189374aafd6ea3d9807f9064`,
  `pnpm run build`, exit 0, `status: passed`

主线程汇报 **21/21 PASS、0skip**：7 lifecycle、5 path、9 runtime harness
contract tests，不是浏览器或 native 验收。fresh 全源码依赖/source-CLI report
已 scoped 完成：
`.artifacts/native-ai-code-source-deps/monaco-lifecycle-20261006/report.json`，
SHA-256 `9ea518eee4008c80240164387668f25a4b3e569c4b22c85e46d8109080ad7792`，
UTC `2026-10-05T21:36:08.586Z` 至 `2026-10-05T21:39:48.746Z`，
recorded exit 2，状态 `source-runtime-deps-probe-complete-not-accepted`。
`runtimeSourceBuildsVerified`、`aiCodeSourceBuildVerified`、
`toolchainSourceVerified` 均 true，`errors: []`、`outputDrift: []`，
原件/暂存源码 unchanged。八项依赖源码输入及三版 source CLI/core 已再次消费；
七依赖加 ai-code 共八个 executable steps 均 built、命令 exit 0，
theme 为 SCSS input。当前 31-input 源码绑定的 67 个 fresh 全源码输出为
`3f1a46beb1ac49de9a771124f191004b0ee021d1ca358ba01d1bcc4ed4f71cc9`，
不是上述 standalone 输出。

publisher receipt：
`.artifacts/native-ai-code-deployment/monaco-lifecycle-20261006/receipt.json`，
SHA-256 `0c287f64978dd07891cf9d00ab478d20ff5c5f08804b3706135b6044f9fbb02b`，
准确绑定当前 report；68 files（67 outputs + unchanged manifest），
dependency/toolchain source-build truth flags 均 true。
当前 report/receipt 只读复验均 exit 2；publisher 仍为
`prepared-not-accepted`、`acceptedForProduction: false`，仅凭 publisher receipt
不能证明运行服务部署或验收。
独立 legacy receipt 不继承其他报告的 dependency/toolchain truth flags。

本轮 `--file-base64-replacement` candidate 已 prepared：
`.artifacts/native-model-migration/monaco-lifecycle-file-20261006/receipt.json`，
SHA-256 `434da7e464c980496762accf1382f97b5c957688a26c4d2d9b6e0c9354689956`。
7 packages、6 model files、4 unresolved；ai-code 条目绑定当前 report/receipt，
状态 `prepared-not-accepted`、`acceptedForProduction: false`。
独立替代为 `@aibiz/file-to-base64@0.1.0`，保留
`originalSourceRecovered: false`、`nativeCompatibilityVerified: false`、
`originalMigrationAcceptance: not-satisfied-by-independent-replacement`；
不改变上方原始 mapping 的 missing 结论。

主线程确认全量 `node --test scripts/tests/*.test.mjs` 已结束，
**1842/1842 PASS、0skip**，77.137 秒；日志
`.artifacts/native-full-regression-20261006-monaco-file.log`。只覆盖当时的
候选/Base64 集成契约，不覆盖后续新增 Base64 browser harness 或修改。
新独立 Docker：
`.artifacts/native-ai-code-docker/monaco-lifecycle-20261006/report.json`，
SHA-256 `e06d2c75974bead459b28656b405317f36ad03f19063767a5e88875fa4fc9950`，
绑定当前 source/deployment；210 checks/cleanup PASS、`errors: []`，
compiler-in-Docker/native-runtime/production acceptance 均 false。
新 runtime-assets receipt：
`.artifacts/native-ai-code-runtime-assets/monaco-lifecycle-file-20261006/receipt.json`，
SHA-256 `b873e670a14d8fcb4370cd1cd20f75312de3dff3b676599a15422aba34840408`，
绑定本轮 candidate；111 files、14,040,705 bytes，文件集指纹
`584e6188ad41aa27306aa1479b4faf1cd1a854ff8b7cc92b7789dde078b00987`，
仅为 `prepared-not-accepted`、`acceptedForProduction: false`。

主线程已部署候选 32008/32009 并报告容器 healthy，但新 native 报告仍 FAIL：
`.artifacts/native-modeldesign/monaco-lifecycle-file-20261006/report.json`，
SHA-256 `366319788da1675c87fb15c855420632e7c8f96ad0498dedd457c5ce3f0d297e`。
11 阶段失败，Central login 取 response body 失败，ModelDesign 四 sibling
manifest 缺失且 GlobalAppUtil 失败；startup/prerequisite/plugin-assets verdict
均 false。登录 helper 精确 token/实际 `core.getToken()` 契约 30/30 PASS
不覆盖该浏览器失败；ai-code 独立浏览器仍运行中，不提前记 runtime/native 通过。
历史 browser 五插件失败、其他四个 sibling、GlobalAppUtil、
runtime-model 源码及 save/readback 仍阻断。

#### Historical URL-Fix Snapshot

以下指纹对应已完成的 `monaco-absolute-20261006` URL 修复中间快照，
现为历史阶段证据，不是当前生命周期源码或最终代码；旧哈希和完成结果保留，
当前生命周期证据独立记录在上一节。

- package `gitHead`: `7020943f79e5e7886b314f90cc4eae64b1fcd196`
- recorded URL-fix source status: `published-source-with-recorded-local-fixes`
- recorded URL-fix source tree: 20 files, 133932 bytes,
  `101ed59951be3decafcfad470bd6a09269b5af6b53e84d79f7aa6dc13392c287`
- published source tree:
  `b50b0f68b433148a17761792a4301b2fdcd01f0c34fe3e396c471228963d47ee`
- recorded URL-fix published-source differences:
  `module/inline-completions/inline-completions.ts` (recorded type fix) and
  `monaco-editor/monaco-editor.tsx` (absolute loader URL)
- recorded URL-fix standalone legacy receipt: 31 inputs, 67 outputs,
  `29738346e808f8273718c42f85f2bf8dfbb5fb06f8ee77701bc38f0672db6e49` ->
  `a9cfb19444542d75f015c7529cced84aa90c7014b0f57ab64ab612236e0afe1d`
- historical source tree, before the Monaco fix: 20 files, 133857 bytes,
  `39d0f1925e2235fb5da1e0e265f6b7cfa2d4e31373d612146664a673ed1e2823`;
  only the type fix differed from published source at that time
- historical standalone receipt, before the Monaco fix: 31 inputs, 67 outputs,
  `b38d5f10072f7ae3cd9c82bbc76280a79547a6bb895a0746d154f16ff255a881` ->
  `ca43277d0612437ea171261f735cd38701ff47e7bd9ea9987c7781dce78c8163`
- comparison with mapped `plm-web/public/plugins` output: 21 receipt outputs
  absent and 3 present outputs changed:
  `dist/index.system.min.js`,
  `es/monaco-editor/monaco-editor.d.ts`,
  `es/monaco-editor/monaco-editor.mjs`

Therefore this is a reproducible candidate build, not the build receipt for the
mapped target and not proof that `alpha.141` is compatible with the model's
requested `alpha.92`.

The Monaco fix changes loader `paths.vs` to
`new URL(..., document.baseURI).href`. It addresses the blob TS worker's
invalid relative URL observed in
`.artifacts/native-ai-code-runtime/browser-worker-20261006-second/report.json`,
not an already passing runtime. That historical run passed 566/566 HTTP
delivery checks (562 file HTTP 200 checks plus four expected 404 negatives)
but failed component-render and unmount/runtime-errors in both apps.
`isolatedRuntimePassed`, `nativeRuntimeAccepted` and `acceptedForProduction`
remain false; the isolated provider host did not save a model or perform
fresh-session readback.

The earlier source-deps report at
`.artifacts/native-ai-code-source-deps/probe-c9ce92e3-d3d7-45d4-a8f3-5fcde616b291/report.json`
completed all eight iBiz dependency source-build inputs and consumed the three
source-built CLI/core releases. Theme is recorded SCSS input, not an independent
JS compile. Its hashes are now pre-fix historical evidence, not current-source
verification.

The fresh all-source rebuild is **complete in scope, not native accepted**:
`.artifacts/native-ai-code-source-deps/monaco-absolute-20261006/report.json`,
SHA-256 `eb9ce8899ebd84c1b90678002448fd6d0eeb2b8e3d9431efc5c54d72d2598f42`,
recorded exit 2, `runtimeSourceBuildsVerified`, `aiCodeSourceBuildVerified`
and `toolchainSourceVerified` true, `errors: []`.
It binds the recorded URL-fix 31-input source fingerprint
`29738346e808f8273718c42f85f2bf8dfbb5fb06f8ee77701bc38f0672db6e49`
to 67 fresh outputs
`3f2047af56b08d3b6bba3ca9e07ab624ad9e9fe4f0bd23cef0b1d7ad895d4681`,
distinct from the standalone legacy output fingerprint.
The bound deployment receipt
`.artifacts/native-ai-code-deployment/monaco-absolute-20261006/receipt.json`,
SHA-256 `2a77c2296c3959eec6f5f901b24741cb8e939eb00e9120d4735d523b09c4d4c8`,
contains 68 files with both source-dependency/CLI truth flags true,
`prepared-not-accepted`, `acceptedForProduction: false`.
The bound model candidate
`.artifacts/native-model-migration/monaco-absolute-20261006/receipt.json`,
SHA-256 `316562e23e1309ca169e8427cdea3b2aa5352dfd917b2ea26cbfcfcc4bfa1f23`,
completed preparation with six packages and five unresolved mappings.
Its ai-code entry binds the exact source/deployment hashes, but remains
`prepared-not-accepted`, `acceptedForProduction: false`.
The isolated Docker report
`.artifacts/native-ai-code-docker/monaco-absolute-20261006/report.json`,
SHA-256 `2a3f193bc7d672aa84ed2e79faef1f54be7cacf858077c36a222296887785151`,
passes 210 checks (204 exact file checks plus six expected 404 negatives),
cleanup passed, `errors: []`. This is static delivery, with
`compilerBuildInDockerVerified`, `nativeRuntimeAccepted` and
`acceptedForProduction` false.

Main reports 164/164 scoped and 22/22 runtime/tests PASS, 0 skipped;
exact commands/logs are pending. These are recorded-stage counts, not proof
under the tightened runtime harness. Current lifecycle evidence is recorded
separately above. The historical standalone legacy receipt does not
inherit source-dependency truth flags from either source-deps report.
Five missing ModelDesign plugins and GlobalAppUtil initialization
failure still block native acceptance; the first 111-file runtime-assets
receipt remains prepared, awaiting browser verification.
Exact delivery hashes and remaining gates:
[NATIVE-AI-CODE-DEPLOYMENT.md](NATIVE-AI-CODE-DEPLOYMENT.md).

### model-design

Candidate:
`vendor-upstream/gottaboy-plm-web/plugin-src/@ibiz-template-plugin/model-design@0.0.3-alpha.122`

- package `gitHead`: `7780006275953e510a725c449f9638a6ed878b97`
- source tree: 68 files, 55 implementation files, 194738 bytes,
  `18ed657dc47ce9aeea380581207c7e847a30c8e494cd52d5891e0a37f0134a9c`
- published source tree has the same fingerprint and no source-file differences
- manifest SHA-256:
  `e1c4407a548d50c7cdce33d7663947724fe445c965f34d7ed714b22b254baff7`
- build is blocked by the unavailable complete source for
  `@ibiz-template-plugin/runtime-model@0.2.2`

The candidate is useful for source recovery and dependency discovery, but it
cannot replace the exact requested
`@ibiz-template-plugin/model-design@0.0.3-alpha.90` mapping.

#### Local dependency investigation

Read-only inspection on 2026-10-05 did not find a complete
`@ibiz-template-plugin/runtime-model@0.2.2` source package in the workspace or
an entry for it in the inspected local npm/pnpm cache indexes. No package was
downloaded or installed, and no candidate build was run.

Final bounded recheck found no manifest whose exact `name` is
`@ibiz-template-plugin/runtime-model` under `vendor-upstream`, `ibiz-app-hub`,
`modelingweb`, `plm-web` or `.artifacts`. Exact scoped-package searches in
`~/.npm/_cacache/index-v5`, `~/.local/share/pnpm/store` and `~/.cache/pnpm`
also had no matches. A generic `runtime-model` hit in a core package, such as
`runtime-model-error`, is not evidence of this separate package. This concludes
the inspected local-source investigation; it does not prove that source is
unavailable elsewhere.

The `model-design` candidate contains 68 source files, including 55 TS/TSX
implementation files. Its relative imports resolve to existing files, but
`node_modules`, a dependency lockfile and `src/assets` are absent.
`@ibiz-template-plugin/runtime-model/loader` does not resolve from the candidate.
This is a static input check, not a passing typecheck or build.

The mapped target embeds compiled runtime files at:

```text
plm-web/public/plugins/@ibiz-template-plugin/model-design@0.0.3-alpha.122/es/node_modules/.pnpm/@ibiz-template-plugin_runtime-model@0.2.2_@stencil_store@2.0.16/node_modules/@ibiz-template-plugin/runtime-model
```

That subtree contains only 7 `.mjs` files, 278671 bytes, with relative-file-set
fingerprint
`b8e6ea99941967181c723b693d56f64a00db3777ffd2b521fa1692a00973eae3`.
It lacks `package.json`, `src`, `stencil.config.ts`, `tsconfig.json` and source
maps. The directory name advertises version `0.2.2`; there is no embedded
manifest to authenticate that package identity. These are published compiled
observations, not editable original source or a source-build receipt.

Runtime configuration snapshots exist at:

```text
plm-web/public/plugins/@ibiz-template-plugin/model-design@0.0.3-alpha.122/dist/assets/json/runtime-model
plm-web/public/plugins/@ibiz-template-plugin/model-design@0.0.3-alpha.122/es/assets/json/runtime-model
```

Each snapshot contains 1414 JSON files, 1634535 bytes, with identical
relative-file-set fingerprint
`138c8f08d260037c0687cf2c255d85f27a2d02a82f234d2c9414ba2356155797`.
Byte equality is not JSON validity: each snapshot has `17/1414` files that fail
`JSON.parse` because of unescaped control characters inside strings; only 1397
files parse successfully. The same 17 filenames fail in both snapshots:

- `IPSAPPDATAENTITY.json`
- `IPSAPPVIEW.json`
- `IPSAPPVIEWBASE.json`
- `IPSCODEPUBLISHERCONTEXT.json`
- `IPSDBPORTLETPART.json`
- `IPSDEACTION.json`
- `IPSDEFIELD.json`
- `IPSDEFORM.json`
- `IPSDEFORMDETAIL.json`
- `IPSDELOGICNODEPARAM.json`
- `IPSDER1NDEFIELDMAP.json`
- `IPSLISTITEM.json`
- `IPSPANELITEM.json`
- `IPSPANELLOGICNODEPARAM.json`
- `IPSSUBSYSSERVICEAPIMETHOD.json`
- `IPSSYSTEMSETTING.json`
- `IPSUIACTION.json`

Final root-cause diagnosis found exactly **46 raw LF (`U+000A`) characters
inside quoted strings per snapshot**, with no other quoted control characters:

| Invalid file | Raw LF count |
|---|---:|
| `IPSAPPDATAENTITY.json` | 2 |
| `IPSAPPVIEW.json` | 2 |
| `IPSAPPVIEWBASE.json` | 2 |
| `IPSCODEPUBLISHERCONTEXT.json` | 2 |
| `IPSDBPORTLETPART.json` | 2 |
| `IPSDEACTION.json` | 2 |
| `IPSDEFIELD.json` | 2 |
| `IPSDEFORM.json` | 4 |
| `IPSDEFORMDETAIL.json` | 4 |
| `IPSDELOGICNODEPARAM.json` | 2 |
| `IPSDER1NDEFIELDMAP.json` | 2 |
| `IPSLISTITEM.json` | 2 |
| `IPSPANELITEM.json` | 6 |
| `IPSPANELLOGICNODEPARAM.json` | 2 |
| `IPSSUBSYSSERVICEAPIMETHOD.json` | 2 |
| `IPSSYSTEMSETTING.json` | 6 |
| `IPSUIACTION.json` | 2 |

For example, `IPSAPPDATAENTITY.json` contains a literal newline in a description
string at line 330, column 41 (UTF-16 character offset 9549). Escaping only these
quoted LF characters in an in-memory diagnostic copy makes all 17 files pass
`JSON.parse`; the other 1397 originals already parse. This isolates the observed
syntax defects, not resource completeness, semantic correctness or native
compatibility. No original or candidate resource is written by the diagnosis.
The focused evidence regression checks the exact defect inventory, per-file
counts and unchanged fingerprints; a passing evidence regression is not
resource validation or native runtime acceptance. Resource-input recovery and
an explicit repair receipt are still required.

The candidate does not include these resource inputs or a resource-copy rule in
`ibiz.config.cjs`. That config externalizes all declared dependencies, including
`runtime-model/loader`; the inspected PLM
`plm-web/public/extras/json/system-import.json` has no runtime-model entry.
Bundling or an explicit loader delivery contract is still needed.

`@ibiz-template-plugin/runtime-model@0.2.2` is a separate dependency from the
already linked `@ibiz/model-core` and `@ibiz/rt-model-api`; their local source
cannot satisfy this package's loader and custom elements.

Minimum follow-up, not performed by this audit:

1. Obtain the complete runtime-model source and its build configuration, or
   explicitly label a reconstructed implementation as reconstructed.
2. Pin the local dependency/toolchain lockfile, recover the JSON resource inputs
   with provenance, repair the 17 malformed resources while retaining original
   and repaired hashes, and define runtime loader bundling and resource copying.
3. Typecheck and build both packages in isolation, then record actual source,
   dependency and output hashes. Native version compatibility and browser
   acceptance remain separate checks owned by the main thread.

The mapping remains `blocked`, its accepted source remains `missing`, its
build remains `missing-receipt`, and native runtime remains `not-verified`.

#### Candidate build path

The following commands are the candidate's declared entry points, not commands
executed by this audit:

| Manifest script | Declared command |
|---|---|
| `typecheck` | `vue-tsc --noEmit` |
| `build` | `ibiz-temp build -c && vue-tsc --declaration --emitDeclarationOnly` |

The manifest declares `@ibiz-template/cli@0.3.30`, `typescript` range `~5.2.2`
and `vue-tsc` range `~1.8.19`. The observed `ibiz.config.cjs` requests SystemJS
output in `dist/[name].system.min.js`; loading this configuration for static
inspection does not run its build. It treats
`@ibiz-template-plugin/runtime-model/loader` as external, so a successful
transpile alone would not prove that the loader can be delivered locally.
The runtime-model subtree has no manifest or build script; this audit cannot
name an authenticated source-build command for that dependency.

The candidate's direct dependency declarations differ from the workspace app
hub. These app-hub versions are not installed candidate resolutions:

| Dependency | Candidate declaration | Workspace app-hub version |
|---|---|---|
| `@ibiz-template/core` | `0.7.41-alpha.28` | `0.7.41-alpha.78` |
| `@ibiz-template/model-helper` | `0.7.41-alpha.31` | `0.7.41-alpha.86` |
| `@ibiz-template/runtime` | `0.7.41-alpha.31` | `0.7.41-alpha.86` |
| `@ibiz-template/vue3-util` | `0.7.41-alpha.31` | `0.7.41-alpha.86` |
| `@ibiz/model-core` | `^0.1.58` | `0.1.84` |

The separately linked `@ibiz/rt-model-api@0.2.82` also does not implement the
runtime-model loader. Any future candidate rebase must record the chosen local
dependency versions, source/config changes and lockfile, then run its own
typecheck and build. Broad peer ranges do not establish native compatibility.
No dependency installation, typecheck, build or source receipt for this
model-design candidate was performed by this audit.

## Candidate Generation Handoff

The following is a proposed handoff checklist, not an implemented or tested
generator contract. The main thread owns the generator and its output schema.
These requirements preserve the distinction between an independently generated
candidate and the existing `verified-only` migration acceptance policy:

1. Read the original Central/ModelDesign models as structured JSON and verify
   their input hashes before proposing changes. Keep the original model tree,
   `fixtures/modeling-core-migration-contract.json` and
   `fixtures/modeling-core-source-candidates.json` unchanged.
2. Use exact recorded `from`/target package identities, not a nearest-version
   guess. Record every changed `rTObjectRepo` JSON pointer, its old/new value
   and the generated model hash. Preserve all non-plugin model content.
3. Write candidate models and reports separately from deployment. Missing
   same-package targets must remain explicit blockers, not substitutions with
   another plugin or the sidecar. Candidate generation must not promote
   `source`, `build`, `runtime`, compatibility or migration acceptance status.
4. Record the actual output paths and hashes being evaluated. The ai-code
   standalone build and the existing mapped target are different outputs.
   A source snapshot, a compiled dependency and a matching directory name
   must remain distinct evidence types.
5. Surface the missing runtime-model source, missing model-design build inputs,
   external loader delivery and the 17 malformed resource files. Copying
   published assets or rewriting model versions cannot resolve these blockers.
6. Validate the generator independently. Candidate structural validity, source
   build reproducibility and native acceptance are separate results; existing
   fail-closed audits must retain their genuine failures until their own
   required evidence exists.

The original input paths are
`vendor-upstream/ibizmodeling-standard/modelapi-core/src/main/resources/model/net/ibizsys/modeling/PSSYSAPPS/<application>/PSSYSAPP.json`:

| Application | Original SHA-256 | Bytes |
|---|---|---:|
| Central | `11cbdd30fc1e3fc7c067b1dabc363bccd2d977c8282895bcae1f0fe36885d564` | 191718 |
| ModelDesign | `8b8ae26b2dbf50e6f0a793a820b29aabcf57f50cc076e8d40e3071f1d4a389f5` | 3221926 |

The focused evidence tests check the current input bytes, manifest/config
observations and documentation. They do not execute or certify the planned
generator, deploy a candidate, or run a browser.

## Reproduction

```bash
cd scripts
node harness-modeling-core-audit.mjs \
  --model-root ../vendor-upstream/ibizmodeling-standard/modelapi-core/src/main/resources/model/net/ibizsys/modeling \
  --no-default-roots \
  --directory ../plm-web/public/plugins \
  --directory ../plm-web/plugin-src \
  --directory ../vendor-upstream/gottaboy-plm-web/plugin-src \
  --output ../.artifacts/modeling-core-localization/20261005-independent-native-source

node --test \
  tests/harness-modeling-core-audit.test.mjs \
  tests/harness-modeling-extension-inventory.test.mjs \
  tests/native-plugin-source-evidence.test.mjs

node --test \
  tests/native-plugin-source-evidence.test.mjs \
  tests/version-ledger.test.mjs \
  tests/local-documentation.test.mjs
```

The audit command is expected to exit `2` while any mapping remains blocked.
That exit code is not converted into a pass.
