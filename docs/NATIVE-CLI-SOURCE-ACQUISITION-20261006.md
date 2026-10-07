# Native CLI Original Source Acquisition

Investigation date: 2026-10-06, Asia/Shanghai (+08:00). Network chronology
starts at 2026-10-05T19:20:20Z UTC; these are the same local-date investigation,
not evidence from a future UTC date.

## Result And Boundary

Original CLI source has a verified public acquisition route for the exact
three installed releases. This is stronger than a repository-name search:
public npm `gitHead`, Gitee commit, complete recursive tree, original TS
blob bytes, package versions and MIT license are linked.

All non-protected files from the three pinned source trees have now been
downloaded and independently verified: **54 / 444 / 445 files, 943 total**.
Each release excludes only its root, CLI and core `.npmrc` files without
reading their contents, so `sourceComplete=false` is retained. This is not an
unqualified copy of every repository file.

All three isolated original-source builds now complete lint, TypeScript
compilation and CLI `--help`, plus exact original template copying for
0.3.23/0.3.30. Independent production-pin verification passed for each report.
The first failed 0.3.0 attempt is retained below as history. Original lockfile
reproduction, consumer behavioral compatibility, native editor acceptance and overall
localization remain unaccepted. Compiled `dist/*.js`,
declaration maps and plugin generator templates are not original CLI
implementation source.

## Full Non-Protected Acquisition

Fetch report:
`.artifacts/native-cli-source-fetch/fetch-960773ab-12c4-4b4c-af19-026f16b90a24/report.json`.
Its SHA-256 is
`1d8e727143435859016962be2feebe799e4c16c953e44b6872825213992c5256`.
The run started at `2026-10-05T20:00:21.033Z` and finished at
`2026-10-05T20:09:39.332Z`; these UTC timestamps correspond to 2026-10-06
in the workstation's +08:00 timezone.

| Release | Tree files | Materialized files | Protected exclusions | Bytes |
| --- | ---: | ---: | ---: | ---: |
| `0.3.0` | 57 | 54 | 3 | 465445 |
| `0.3.23` | 447 | 444 | 3 | 1049357 |
| `0.3.30` | 448 | 445 | 3 | 1053671 |

The capture verified 301 unique Git blobs: 279 new public raw downloads and
22 cache readbacks, plus seven metadata cache readbacks. The official public
raw route can redirect once to the same pinned path on
`raw.giteeusercontent.com`; actual 302/200 response bytes and hashes are
retained, not converted into fabricated API responses.
There are no fetch errors. The report deliberately returns exit 2 and
`source-acquired-with-protected-exclusions-not-built-not-accepted`.

`verifyNativeCliFetchReport` passed for all three exact production pins.
The fetch suite passed 33/33 tests with zero failures or skips after capture.
The original source, receipts, raw evidence, workspace metadata, templates,
lockfiles and MIT notices remain in the fresh artifact destination.

Build entry: `npm run build:native-cli-source --prefix scripts`.
Focused regression: `npm run test:native-cli-source --prefix scripts`.
Additional exact third-party tools are isolated under
`scripts/toolchains/native-cli-source` and `scripts/toolchains/native-cli-format`,
with no published iBiz packages.
Existing installed CLI/core directories may serve only as third-party resolver
contexts; their compiled own outputs are not source build inputs.

The first real build report is retained at
`.artifacts/native-cli-source-build/build-ea5e77a4-48ef-4fb1-a6cd-b58b9f406067/report.json`.
It failed with `Unverified open-source license: caniuse-lite`, zero commands
executed. Legacy third-party license declarations, data licenses, npm aliases
and missing type dependencies are being handled with explicit evidence and
regression checks, not by disabling preflight. That first failure is not the
current build status.

## Completed Isolated Builds

All paths below are relative to `.artifacts/native-cli-source-build/`.
Each successful build and independent verification returns exit 2, meaning
source build completed without native acceptance, not a failed command.
All actual build commands return 0 and all report error arrays are empty.

| Release | Build report | Commands | Output files | Report SHA-256 |
| --- | --- | ---: | ---: | --- |
| `0.3.0` | `build-ad440ad3-d659-4fa8-9cb6-8129623e949d/report.json` | 5 | 95 | `af40ce68d6573afa397b37c7fe84ac4b4214a1377bc1292892d96a1f8a0a2863` |
| `0.3.23` | `build-8e1a1d90-375a-4274-b6d3-1201593e0e17/report.json` | 6 | 583 | `b6134ab3f31182f67c60103e05398b74d8c4b31336e62fc013c1cd33ed424104` |
| `0.3.30` | `build-2b86c020-aa9a-4c8c-9245-a8620bff240d/report.json` | 6 | 584 | `e82219a864cbd5c514303c3f39601a4e8ceb9b0c79ada2456eaaf908d367b232` |

The two latest builds ran from `2026-10-05T20:35:57Z` through
`2026-10-05T20:36:20Z` UTC. Their source and generated output fingerprints
remain bound to the three unchanged original acquisition receipts.
`cliSourceBuildVerified=true` and `toolchainSourceBuilt=true` mean exactly
these CLI/core builds, not downstream application or dependency acceptance.

### Third-Party Compatibility

Original 0.3.0 combines Rollup 4 and Vite 4 declarations; the initially
selected installed dependencies caused incompatible plugin types.
0.3.30's original installed resolver selected both Rollup 4.9.3 and 4.13.0.
The successful builds reuse the installed 0.3.23 core resolver's complete
third-party group: **Rollup 4.44.1 and Vite 5.3.5**, with TypeScript 5.8.3.
This changes dependency selection only. CLI and core source bytes, versions,
manifests, tsconfigs and original lockfiles are not rewritten.

| Source release | lint / format | Direct core rimraf | Template copy |
| --- | --- | --- | --- |
| `0.3.0` | ESLint 8.57.1, Prettier 3.6.1, plugin-prettier 5.5.1 | 5.0.10 | Not in original build |
| `0.3.23` / `0.3.30` | ESLint 8.56.0, Prettier 3.1.1, plugin-prettier 5.1.2 | 5.0.5 | cpx 1.5.0 |

The older Prettier is required by the unchanged newer source: selecting 3.6.1
produced four formatting failures. The formatting tool lock explicitly pins
rimraf 5.0.5 so its transitive rimraf 3.0.2 remains nested under flat-cache
and cannot shadow the typed rimraf expected by the original core source.
No `any` declaration, lint bypass, typecheck bypass or source patch is used.
The supplemental installation receipt is
`.artifacts/native-cli-third-party-install/install-ad1d7372-6502-4900-a897-bf1f24e98f4d/result.json`.
It records public-registry-only third-party installation, isolated HOME/cache,
disabled package scripts and manifest/lock/log hashes.

Dependency resolver owners are ordered arrays in the build reports. The CLI
now accepts repeated `--root-owner`, `--core-owner` and `--cli-owner` arguments
in that same order. No installed iBiz implementation is read or copied; only
its package manifest and resolution context are used. `--dependency-owner`
is a supplemental fallback, not an implicit global override.

`originalVersionReproductionVerified=false` and
`dependencySourcesBuilt=false` remain intentional in the CLI build reports:
the latter concerns those CLI builds' third-party dependencies, not the eight
downstream iBiz dependencies now source-built by the source-deps harness.
Non-alias declared semver
ranges are not automatically authenticated by a successful typecheck.
This is a verified compatible build selection, not original-lock reproduction.

Historical failed reports are preserved: `build-29de7546-4725-4ad4-a465-e5260172cefb`
stopped at rimraf type resolution; `build-81cd42e2-aa5f-4667-bc9d-246888b5fc98`
also exposed the dual Rollup versions. Their original reports and logs are
not rewritten as successes.

## Actual Version Mapping

| Consumer | Declared CLI | Observed CLI / exact CLI-core dependency |
| --- | --- | --- |
| `ibiz-app-hub/components/web-theme`, version `3.11.0` | `0.3.0` | `0.3.0` / `0.3.0` |
| `ibiz-app-hub/packages/vue3-util`, version `0.7.41-alpha.86` | `0.3.23` | `0.3.23` / `0.3.23` |
| upstream `ai-code@0.0.3-alpha.141` | `0.3.30` | `0.3.30` / `0.3.30` |
| upstream `model-design@0.0.3-alpha.122` | `0.3.30` | `0.3.30` / `0.3.30` |
| `modelingweb/app` and `vendor-upstream/plm-web` | `^0.3.30` | inspected installation `0.3.30`; range alone is not a resolved version |

The raw source CLI manifest uses `workspace:*` for CLI-core; npm publication
resolves it to the exact matching version. Public latest metadata is not a
reason to change any existing pin.

## Confirmed Downstream Source Consumption

The three completed CLI/core builds have now been consumed by the real
source-deps harness, not just selected as installed resolver contexts:
web-theme uses source `0.3.0`, vue3-util source `0.3.23`, and ai-code source
`0.3.30`. This does not claim a completed model-design build.
This completed chain precedes the Monaco source fix described below; its
report/receipt hashes are historical snapshots, not verification of changed
ai-code source. The eight-dependency completion is not reclassified as missing.

Report:
`.artifacts/native-ai-code-source-deps/probe-c9ce92e3-d3d7-45d4-a8f3-5fcde616b291/report.json`,
SHA-256 `f5133c1ab75838812f558eab6e414c8d077709ddf2b6998b7e4c0c9a5d384437`,
UTC `2026-10-05T20:37:04.358Z` to `2026-10-05T20:40:45.983Z`.
It binds all three CLI report hashes above, records
`cliSourceBuildVerified: true` for each, `toolchainSourceVerified: true`,
`publishedOwnToolchain: []`, and verified source-built CLI/core entries.

The eight downstream iBiz dependency source-build lane is complete:
model-core `0.1.84`, rt-model-api `0.2.82`, core `0.7.41-alpha.78`,
runtime/model-helper/vue3-util `0.7.41-alpha.86`, theme `0.7.39`, and
web-theme `3.11.0`. Seven dependency packages plus ai-code have executable
`built` steps with all command exits 0. Theme is a recorded nine-file SCSS
source input (`compile: not-applicable`), not missing dependency localization
or a separate compiled JS output. `runtimeSourceBuildsVerified` and
`aiCodeSourceBuildVerified` are true, original/staged source drift is unchanged,
and errors/output drift are empty in this report.

The exact downstream deployment receipt is
`.artifacts/native-ai-code-deployment/deployment-2026-10-05T20-43-31-909Z-6a3daf16-9165-40f0-86cd-56fccfbca248/receipt.json`.
Its source/toolchain dependency truth flags are true, with 67 fresh ai-code
outputs plus the unchanged manifest. The bound Docker report
`.artifacts/native-ai-code-docker/delivery-d0d7970a-c6d5-49fe-bf86-59fcdebd0d66/report.json`
passes **210 checks** (204 exact file checks and six 404 negatives), cleanup
passed, errors empty. This is standalone static delivery, not compilation
inside Docker: `compilerBuildInDockerVerified: false`.

All source/deployment/Docker non-acceptance boundaries remain explicit.
Original dependency-version reproduction, declared range compatibility,
full localization and native/production acceptance are not verified by these
successful builds. The readable candidate browser report
`.artifacts/native-modeldesign/ai-code-readable-20261006/report.json`
still has five missing ModelDesign plugins and GlobalAppUtil initialization
failure. The separate runtime-assets receipt
`.artifacts/native-ai-code-runtime-assets/loader-monaco-20261006-first/receipt.json`
contains **111 files** but is only **prepared, awaiting browser verification**.

The later isolated runtime report
`.artifacts/native-ai-code-runtime/browser-worker-20261006-second/report.json`
binds a different runtime-assets receipt, `loader-monaco-worker-20261006-second`.
Its 566/566 HTTP delivery checks pass (562 file HTTP 200 checks plus four
expected 404 negatives), but the blob TS worker cannot resolve
`./plugins/monaco-editor@0.52.2/min/vs/language/typescript/tsWorker.js`.
`status: failed`, `isolatedRuntimePassed: false`, `nativeRuntimeAccepted: false`;
this does not accept the first 111-file candidate or full native editor
save/readback.

Main has applied the absolute loader `paths.vs` fix using
`new URL(..., document.baseURI).href` in `src/monaco-editor/monaco-editor.tsx`.
Together with the existing type fix, the recorded URL-fix stage source status is
`published-source-with-recorded-local-fixes`. That `src/` snapshot has 20 files,
133932 bytes, fingerprint
`101ed59951be3decafcfad470bd6a09269b5af6b53e84d79f7aa6dc13392c287`.
The refreshed standalone legacy receipt binds source
`29738346e808f8273718c42f85f2bf8dfbb5fb06f8ee77701bc38f0672db6e49`
to outputs `a9cfb19444542d75f015c7529cced84aa90c7014b0f57ab64ab612236e0afe1d`.
Fresh all-source rebuild at
`.artifacts/native-ai-code-source-deps/monaco-absolute-20261006/report.json`
has now completed in scope, recorded exit 2, not native accepted. The report
SHA-256 is `eb9ce8899ebd84c1b90678002448fd6d0eeb2b8e3d9431efc5c54d72d2598f42`,
with `runtimeSourceBuildsVerified`, `aiCodeSourceBuildVerified` and
`toolchainSourceVerified` true, `errors: []`. All three source CLI/core releases
are again consumed; eight dependency source inputs and ai-code are built.
The fresh ai-code output fingerprint is
`3f2047af56b08d3b6bba3ca9e07ab624ad9e9fe4f0bd23cef0b1d7ad895d4681`,
not the standalone legacy output above.
The bound deployment receipt
`.artifacts/native-ai-code-deployment/monaco-absolute-20261006/receipt.json`
has SHA-256 `2a77c2296c3959eec6f5f901b24741cb8e939eb00e9120d4735d523b09c4d4c8`,
68 files, both dependency/CLI source-build truth flags true, and remains
`prepared-not-accepted`.
The bound model candidate
`.artifacts/native-model-migration/monaco-absolute-20261006/receipt.json`,
SHA-256 `316562e23e1309ca169e8427cdea3b2aa5352dfd917b2ea26cbfcfcc4bfa1f23`,
completed preparation with six packages and five unresolved mappings;
`prepared-not-accepted`, `acceptedForProduction: false`. Its ai-code entry
binds the exact fresh source report and deployment receipt.
The bound isolated Docker report
`.artifacts/native-ai-code-docker/monaco-absolute-20261006/report.json`,
SHA-256 `2a3f193bc7d672aa84ed2e79faef1f54be7cacf858077c36a222296887785151`,
passes 210 checks (204 exact file checks plus six expected 404 negatives),
cleanup passed, `errors: []`; compiler-in-Docker/native/production flags remain
false.

Main reports 164/164 scoped and 22/22 runtime/tests PASS, 0 skipped; exact
commands/logs are pending. `monaco-absolute-20261006` is an **intermediate
completed historical snapshot, not final code**. Monaco lifecycle and runtime
harness fixes and their current evidence are recorded separately below.
Old partial runtime stage
passes are not acceptance under the stricter harness. Previous report hashes
must not be reused after drift, and successful source compilation/static
delivery do not prove the blob worker URL fix at runtime.
Recorded-stage source and historical fingerprints:
[NATIVE-PLUGIN-SOURCE-AUDIT.md](NATIVE-PLUGIN-SOURCE-AUDIT.md).
Exact hashes, plugin identities and required main-thread evidence:
[NATIVE-AI-CODE-DEPLOYMENT.md](NATIVE-AI-CODE-DEPLOYMENT.md).

### Current Lifecycle Source Stage

Main has applied resize/mousedown/timer/late loader cleanup after unmount in
the same Monaco source file and tightened runtime harness false-positive
checks. Current ai-code source status is
`published-source-with-recorded-local-fixes`; `src/` has 20 files,
135764 bytes, fingerprint
`d3b13c529e5d9bc4b51768300a62b80fac7458ac560f6fafac19e7d3daf3467f`.
The completed standalone build binds 31 inputs / 67 outputs:
`8d3932ebe3358d489304dcb25e206f45a69a17759891813edf81a99fd1f3fc27` ->
`adeb4f095755468628bf9fb52ea1d17a43e813276873ea99884a9a1038638448`.
It does not inherit historical source-dependency/CLI truth flags.

Main reports **21/21 PASS, 0 skipped** (seven lifecycle, five path, nine
runtime harness contract tests), not browser/native acceptance. The fresh
source-dependency/source-CLI report
`.artifacts/native-ai-code-source-deps/monaco-lifecycle-20261006/report.json`
is **complete in scope, not native accepted**, SHA-256
`9ea518eee4008c80240164387668f25a4b3e569c4b22c85e46d8109080ad7792`.
It ran from `2026-10-05T21:36:08.586Z` to `2026-10-05T21:39:48.746Z` UTC,
recorded exit 2. `runtimeSourceBuildsVerified`, `aiCodeSourceBuildVerified`
and `toolchainSourceVerified` are true, errors/output drift empty,
original/staged sources unchanged. The current report consumes verified
source-built CLI/core `0.3.0`, `0.3.23` and `0.3.30`, and completes the
eight-dependency source-input lane again. All eight executable steps (seven
dependencies plus ai-code) are built with command exits 0; theme is SCSS input.
Its 67 fresh ai-code outputs have fingerprint
`3f1a46beb1ac49de9a771124f191004b0ee021d1ca358ba01d1bcc4ed4f71cc9`,
distinct from the standalone legacy output above.

Publisher receipt
`.artifacts/native-ai-code-deployment/monaco-lifecycle-20261006/receipt.json`,
SHA-256 `0c287f64978dd07891cf9d00ab478d20ff5c5f08804b3706135b6044f9fbb02b`,
binds the exact current report, 67 fresh outputs plus unchanged manifest.
Both dependency/toolchain source-build truth flags are true. Report/receipt
pass current read-only verification with exit 2; the publisher is still
`prepared-not-accepted`, not by itself service deployment or native acceptance.

The `--file-base64-replacement` candidate is prepared:
`.artifacts/native-model-migration/monaco-lifecycle-file-20261006/receipt.json`,
SHA-256 `434da7e464c980496762accf1382f97b5c957688a26c4d2d9b6e0c9354689956`.
Seven packages, six model files, four unresolved mappings; its ai-code entry
binds the exact current report/receipt above. It remains `prepared-not-accepted`,
`acceptedForProduction: false`. Independent replacement
`@aibiz/file-to-base64@0.1.0` records `originalSourceRecovered: false`,
`nativeCompatibilityVerified: false`,
`originalMigrationAcceptance: not-satisfied-by-independent-replacement`.

Main confirms the full command `node --test scripts/tests/*.test.mjs` completed
**1842/1842 PASS, 0 skipped**, 77.137 seconds, log
`.artifacts/native-full-regression-20261006-monaco-file.log`. These are
then-current contract tests, excluding later Base64 browser harness additions
and later changes, not native/browser acceptance.
New Docker report
`.artifacts/native-ai-code-docker/monaco-lifecycle-20261006/report.json`,
SHA-256 `e06d2c75974bead459b28656b405317f36ad03f19063767a5e88875fa4fc9950`,
binds the current source/deployment; 210 checks and cleanup pass, errors empty.
Compiler-in-Docker/native-runtime/production flags remain false.
New prepared runtime-assets receipt
`.artifacts/native-ai-code-runtime-assets/monaco-lifecycle-file-20261006/receipt.json`,
SHA-256 `b873e670a14d8fcb4370cd1cd20f75312de3dff3b676599a15422aba34840408`,
binds the new candidate: 111 files, 14,040,705 bytes, fingerprint
`584e6188ad41aa27306aa1479b4faf1cd1a854ff8b7cc92b7789dde078b00987`,
`prepared-not-accepted`, not browser acceptance.

Main reports candidate containers deployed healthy on 32008/32009, but
`.artifacts/native-modeldesign/monaco-lifecycle-file-20261006/report.json`,
SHA-256 `366319788da1675c87fb15c855420632e7c8f96ad0498dedd457c5ce3f0d297e`,
records 11 failing stages. Central login response-body retrieval fails;
ModelDesign still has four missing sibling manifests and GlobalAppUtil failure.
Startup/prerequisite/plugin-assets verdicts remain false.
Exact-response token/actual `core.getToken()` login contract tests pass 30/30,
not a passing native browser run. Ai-code isolated browser evidence remains
in progress. Historical hashes above remain historical; sibling plugins,
runtime-model source and native/save/readback gates are not resolved by
successful source compilation or an independent replacement.

## Local Installation Audit

Selected installations live under `ibiz-app-hub/node_modules/.pnpm` for
0.3.0/0.3.23 and `modelingweb/app/node_modules/.pnpm` for 0.3.30; additional
0.3.30 copies exist in the upstream ai-code installation.

| Release | CLI maps | CLI-core maps | Maps containing `sourcesContent` |
| --- | --- | --- | --- |
| `0.3.0` | 9 | 23 | 0 |
| `0.3.23` | 14 | 83 | 0 |
| `0.3.30` | 14 | 82 | 0 |

Every referenced map source is absent at its resolved installed path.
In particular, `dist/build/build.d.ts.map` references
`../../src/build/build.ts`, but does not embed it. No original implementation
`.ts` exists in the six inspected packages after excluding declaration files
and generator templates. Later CLI-core packages do contain TS plugin
templates, which do not close this gap.

Both 0.3.0 package metadata files identify
`https://gitee.com/iBizModeling/ibiz-template-cli.git`. Later selected versions
omit that repository field. The 0.3.0 packages lack a root README; later
READMEs describe a missing implementation `src` and reference a missing
CHANGELOG. All six installed packages include an MIT license.

## Exact Public Source Route

Base: `https://gitee.com/api/v5/repos/iBizModeling/ibiz-template-cli`.

| Release | npm / installed `gitHead` | Commit tree | CLI / core source blobs |
| --- | --- | --- | --- |
| `0.3.0` | `15ab40e917b0c0bde9a3b7473f3ca30a37cd116c` | `01e9c0943d83e8fc1f55ebb1866b28cf24d79fe4` | 9 / 23 |
| `0.3.23` | `a592a88de74abb9985e99a53d452d413d370ad7c` | `305b5108f73846807fdcb68d9579159fe58cc07e` | 14 / 401 |
| `0.3.30` | `2277d0680777d5d147d912fecab779a6747807eb` | `05e1c337cac5dacce68b7a9db704b35fc3cbff87` | 14 / 402 |

Source blob counts include all files below the corresponding `src` paths,
including core templates; they are not counts of implementation TS files.

Unauthenticated public API calls to `/commits/<gitHead>` and
`/git/trees/<tree>?recursive=1` returned HTTP 200. All three trees reported
`truncated=false`, with 85 / 596 / 598 total entries respectively.
Metadata explicitly reported `private=false`, `public=true`, license MIT.

The following original blobs returned HTTP 200; decoding their base64 bytes
and hashing `blob <byteLength>\0<bytes>` with SHA-1 matched the tree IDs:

| Original path / release | Git blob | Decoded SHA-256 |
| --- | --- | --- |
| `packages/cli/src/index.ts`, all three | `d02efab7cd8405a66c5c12b9d2c56a8fc0588652` | `c3c0db34d900d323685abdbec9d8968cac8ebff6a5ea470b795d61b3487dafea` |
| `packages/core/src/build/build.ts`, 0.3.0 | `d3a4673fd5ac1637cac5e35d8e069f3cc7cf1588` | `8c6542e26ba8a81dbeef9b8ba313b00573bec695ba4543954a460b02b7813271` |
| Same core path, 0.3.23/0.3.30 | `836537ce88177f7266ec3daf06231105db719f03` | `e20ebc4425d880414aa97fc9c6c71ddff5c9510389f7e4a9cfaf19a248ec77b6` |

The two 0.3.30 original package manifests and the two distinct license blobs
were also byte-verified. Original LICENSE SHA-256 matches installed LICENSE:
`6f991b84ec2f1333015ef4a8a5d5cbeb46ac59ae0a19c0d004de597303fc0551`
for 0.3.0, and
`733557a117f9c6fa9801555c8eddd39251a600a212ff8d5c674ea6c76197ebb1`
for 0.3.23/0.3.30. Retain copyright and license notices on acquisition.

## Observed Network Limitations

Public npm metadata for both packages returned HTTP 200. No install, tarball
installation, configured registry client or private registry was used.
The Gitee landing page returned HTTP 200, but the 0.3.0 HTML commit route
returned HTTP 302 to login; redirects were not followed.

Unauthenticated `git ls-remote` returned exit 128 because credentials were
requested while prompts were disabled. This does **not** imply the API source
is private or unavailable: commit/tree/blob API access succeeded.
No credentials, private authorization material or upstream `.npmrc` contents
were read. No speculative mirror or unrelated replacement was substituted.

## Historical Sampling Evidence

Evidence directory:
`.artifacts/native-cli-source-acquisition-2026-10-05T19-26-16.778Z-a669fd81-e85b-4164-9c2b-3e78b0941f14/`.
`report.json` links requests, timestamps, response hashes, commit/tree IDs
and verified original blob hashes. Raw public responses, original sample
bytes and `local-package-audit.json` are retained alongside `capture.mjs`.

The later full acquisition used these pinned public commit trees and verified
each original Git blob before reconstructing fresh staging trees. Reject
truncated trees, unverified files, path traversal, symlinks or gitlinks unless
explicitly handled. Preserve the monorepo build configuration, workspace
metadata, templates, lockfile and MIT notices; do not reconstruct a package
from just the sample TS files.

The sampling investigation did not start a source-deps build. Its early
seven-blob result is preserved as history, not used in place of the later
943-file capture. The source-only CLI/core builds are now complete for all
three versions, and the later report above proves downstream source-build
consumption for the three mapped consumers and eight iBiz dependencies.
Remaining work includes version-specific behavioral compatibility and native
integration, not those already completed builds. Existing native acceptance
failures remain failures; neither prepared assets nor the failed worker probe
constitute native acceptance.

## Investigation Validation

The retained capture completed at `2026-10-05T19:28:23.667Z` UTC.
`node --check` passed for the evidence capture script. Independent readback
validated all 16 HTTP 200 response hashes, seven original Git blob hashes,
the three complete tree/sample mappings, two 0.3.30 manifest versions and
the six installed-package map/source checks. JSON and document whitespace
checks passed. No npm suite, install, source-deps build or native browser
test was launched; these are acquisition checks, not build acceptance.
