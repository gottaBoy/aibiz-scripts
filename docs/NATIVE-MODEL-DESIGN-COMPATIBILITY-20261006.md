# Native Model Design Build And Compatibility Evidence

Evidence date: **2026-10-06, Asia/Shanghai (+08:00)**.
Workspace: `/home/my/workspace/ainfra/aibiz`.

## Verdict

**The alpha.122 candidate is not an exact alpha.90 reproduction or an accepted
strict-compatible replacement. Full source localization remains blocked.**

The original alpha.122 TypeScript/TSX sources and configuration are available.
The isolated build used local source-built ibiz framework packages and exact
source-built CLI 0.3.30. JavaScript bundling succeeded; the declared full build
and typecheck failed. `runtime-model@0.2.2` original source/build inputs remain
missing. A compiled loader observation is not a source recovery.

Registration-name coverage is 11/11 in both Central and ModelDesign.
Registration coverage, static action declarations, resource integrity and
JavaScript generation are independent evidence, not API/workflow acceptance.
`strictCompatibilityVerified`, `exactVersionReproductionVerified`,
`nativeAccepted`, `acceptedForProduction` and runtime source recovery remain
**false**. No failed gate was removed or changed to PASS.

## Scope

Read and reused before building:

- `scripts/docs/NATIVE-RUNTIME-MODEL-ACQUISITION-20261006.md`.
- `scripts/prepare-native-model-design-inputs.mjs`.
- `scripts/docs/NATIVE-MODEL-DESIGN-BUILD-INPUTS.md`.
- The existing pinned resource repair, source/config input and framework/CLI receipts.

Only these task-owned tools/tests and this independent document were added:

- `scripts/harness-native-model-design-build.mjs`.
- `scripts/tests/native-model-design-build.test.mjs`.
- `scripts/inspect-native-model-design-compatibility.mjs`.
- `scripts/tests/native-model-design-compatibility.test.mjs`.
- `scripts/docs/NATIVE-MODEL-DESIGN-COMPATIBILITY-20261006.md`.

Fresh build/compatibility evidence lives under their dedicated `.artifacts/`
directories. Source originals, shared mappings, candidate preparation main
file, console/layout, compose, native browser, containers and deployment were
not modified. Failed/partial and historical artifacts were preserved.

The pinned-file tools require Linux, Node >= 20 and `/proc/self/fd`. They assume
a trusted workspace/ancestor directories and cooperative single writers.
Pinned reads/rechecks detect observed drift, not an atomic multi-file snapshot
or malicious same-UID/root write protection. Third-party dependencies are
existing local installations; they are not claimed to be source-built.

## Explicit Version Mapping

Declared versions below come from the alpha.122 manifest unless stated otherwise.
Local versions come from real manifests and verified framework/CLI source-build
reports, not renamed package labels.

| Package | Requested / declared | Local build input | Evidence class |
|---|---|---|---|
| `@ibiz-template-plugin/model-design` | Original model requests `0.0.3-alpha.90` | Source `0.0.3-alpha.122` | Candidate, not exact |
| `@ibiz-template/core` | `0.7.41-alpha.28` | `0.7.41-alpha.78` | Verified source-built, version differs |
| `@ibiz-template/runtime` | `0.7.41-alpha.31` | `0.7.41-alpha.86` | Verified source-built, version differs |
| `@ibiz-template/model-helper` | `0.7.41-alpha.31` | `0.7.41-alpha.86` | Verified source-built, version differs |
| `@ibiz-template/vue3-util` | `0.7.41-alpha.31` | `0.7.41-alpha.86` | Verified source-built, version differs |
| `@ibiz/model-core` | `^0.1.58` | `0.1.84` | Verified source-built |
| `@ibiz/rt-model-api` | Framework dependency closure | `0.2.82` | Verified framework source/build closure, not runtime-model |
| `@ibiz-template/theme` | `^0.7.0` | `0.7.39` | Verified source SCSS |
| `@ibiz-template/cli` | `0.3.30` | `0.3.30` | Exact version, verified source-built |
| `@ibiz-template-plugin/runtime-model` | Exact `0.2.2` | None | Missing original source/build inputs; compiled subtree excluded from build |
| `typescript` | `~5.2.2` | `5.2.2` | Existing open-source compiler |
| `vue-tsc` | `~1.8.19` | `1.8.27` | Existing open-source compiler |
| `vue` | `^3.3.8` | `3.3.8` | Existing open-source dependency |
| `axios` | `^1.6.2` | `1.13.2` | Existing open-source build dependency, not browser identity |
| `monaco-editor` | `^0.52.2` | `0.52.2` | Existing open-source dependency |
| `@monaco-editor/loader` | `^1.4.0` | `1.7.0` | Existing open-source dependency |
| `pluralize` / `@types/pluralize` | `^8.0.0` / `^0.0.33` | `8.0.0` / `0.0.33` | Existing open-source dependencies |
| `sortablejs` | `^1.15.1` | `1.15.6` | Existing open-source dependency; incompatible local `1.14.0` rejected |
| `@types/qs` | Not declared | `6.9.11` | Explicit supplemental input; original manifest unchanged |

All selected declared third-party versions satisfy their manifest ranges using
the real semver parser, including pnpm-hoisted lookup. This does not establish
an original isolated dependency lock or exact framework-version reproduction.
The complete third-party identities, ranges, paths and manifest hashes are in
the build report's `dependencies.links`.

## Source And Input Evidence

Original published candidate source:

```text
vendor-upstream/gottaboy-plm-web/plugin-src/@ibiz-template-plugin/model-design@0.0.3-alpha.122
```

The manifest identifies MIT and package gitHead
`7780006275953e510a725c449f9638a6ed878b97`.
There are 68 `src` files, 55 implementation files and 72 total source/config
files, 199207 bytes. These bytes were not edited to suppress failures.

| Evidence | SHA-256 / relative-file-set fingerprint |
|---|---|
| Manifest | `e1c4407a548d50c7cdce33d7663947724fe445c965f34d7ed714b22b254baff7` |
| `src` inventory | `18ed657dc47ce9aeea380581207c7e847a30c8e494cd52d5891e0a37f0134a9c` |
| All 72 source/config inputs | `a2eff77ed8cdefebfa24636620baa77b8e067458d92033edb0492465ca21ed06` |
| 1414 repaired JSON resources | `45f5a9acfc8bf181e05f5ae1e15088c1c8b7ec1f44dba5a172dfc4bb7e315211` |
| Staged 1486 files (72 + 1414) | `f01090611643590f974a5ebacbf1b928f5ce29bb47fcbc9e7b459c1c16154538` |

Input receipt:
`.artifacts/native-model-design-inputs/inputs-20261006-config-pinned-first/receipt.json`,
SHA-256 `06bec63c4e0299d7afa16f2eff9220f11ec62ee7e71deecab7d2caf558c543f5`.

Resource repair receipt:
`.artifacts/native-resource-repair/repair-2026-10-05T17-27-50-342Z-71e3bbb8-848a-4b21-a4f4-8c68e2925498/receipt.json`,
SHA-256 `848c876552be7bc2f3dd33825f6bdb0b95ddcfbd165e02bb973f5c45bb38bf0e`.
Only 46 quoted raw LF characters in 17 JSON files were repaired; the other
1397 files remain byte-identical. JSON snapshots are not runtime-model source.

Framework source/build report:
`.artifacts/native-ai-code-source-deps/monaco-lifecycle-20261006/report.json`,
SHA-256 `9ea518eee4008c80240164387668f25a4b3e569c4b22c85e46d8109080ad7792`.

Exact source-built CLI 0.3.30 report:
`.artifacts/native-cli-source-build/build-2b86c020-aa9a-4c8c-9245-a8620bff240d/report.json`,
SHA-256 `e82219a864cbd5c514303c3f39601a4e8ceb9b0c79ada2456eaaf908d367b232`.

## Full Build Result

Current consumer-verified report:

```text
.artifacts/native-model-design-build/build-c8c3e614-c829-40ae-8ee4-52ddb75b7f8e/report.json
SHA256 c1e0ec3035072d20a2823149a23d49a077b33513895727c91e748e569917a42d
```

Actual commands from the original manifest, run in a fresh isolated package:

| Step | Actual invocation | Exit | Result |
|---|---|---:|---|
| Typecheck | `vue-tsc --noEmit` | 2 | FAIL |
| Declared build, first step | Source-built CLI 0.3.30 `build -c` | 0 | JavaScript bundle generated |
| Declared build, second step | `vue-tsc --declaration --emitDeclarationOnly` | 2 | FAIL; partial declarations do not make the full build PASS |

`fullDeclaredBuildSucceeded: false`, `typecheckSucceeded: false`.
Read-only report verification succeeded with `evidenceIntegrityVerified: true`
and intentionally exited **2** because acceptance remains blocked.
Exit 1 means evidence/verification failure; exit 2 is never a build PASS.

There are **23 diagnostics**, retained with path/line/column:

- 1 TS2307: missing authentic `@ibiz-template-plugin/runtime-model/loader`.
- 22 TS7053 in seven files: clipboard action map lacks the `dsl` key included
  in the input union; model-tree/service indexes `IApiData | IApiData[]`;
  node-data Proxy indexes its class with string/symbol; three DSL providers
  index reduce accumulators inferred as `{}`.

The earlier missing `pluralize`, `@types/pluralize`, `sortablejs` and
`@types/qs` inputs were resolved from local third-party packages. No ambient
runtime declaration, synthetic runtime manifest or fabricated runtime source
was added to turn TS2307 into a PASS.

| Output | Files | Resource-copy gate |
|---|---:|---|
| `dist/assets/json/runtime-model` | 1414 | PASS; fingerprint equals repaired inputs |
| `es/assets/json/runtime-model` | 0 | FAIL |
| `lib/assets/json/runtime-model` | 0 | FAIL |

Total build outputs: 1607 files, 2142192 bytes, fingerprint
`7c52aa48074f8afc24541d43da51791d64dcddcce72c5a291d961fa40e096a9a`.
`dist/index.system.min.js` exists. The compiled es UIAction registration keys
match the source's 11 keys. The SystemJS bundle externalizes the runtime loader;
the build does not deliver it.

Retained logs and SHA-256:

- `logs/typecheck.log`: `809e5d7d5531fa6aac176621a5df847432dbc04517a936d1211ddefd3647f2f9`.
- `logs/declarations.log`: `809e5d7d5531fa6aac176621a5df847432dbc04517a936d1211ddefd3647f2f9`.
- `logs/bundle.log`: `993c72291d08857cd664d8cb3e3fa1021bc5f5bba104f54cfb4472de37897fbf`.

Read-only CLI inspection suggests a resource-copy race:
`packages/core/src/rollup/module-option/module-option.ts` requests public-to-es/lib
copies; `rollup-plugins/copy-file.ts` starts `CopyWatch` and closes it in
`closeBundle`; `util/watcher/watcher.ts` does not await initial-ready/pending
copy completion before listener removal/close. This is a **lead, not an
instrumented root-cause proof**. The CLI sources are outside this task's write
scope and were not changed. A previous isolated copy-hook result cannot clear
the failed full-build es/lib gates.

The first historical build report remains untouched:
`.artifacts/native-model-design-build/build-b9ff1168-8bde-4569-8ea5-f9bd1d148d1e/report.json`,
SHA-256 `88df3ba7291e4368a6914b471d27d5d001a8fdfbce7ddffc1dfee0695a77bbd4`.
It predates current consumer fields and is not current-verifier evidence.
Its output fingerprint differs from the second run. **Byte-for-byte build
reproducibility has not been established.**

## Alpha.90 Registration And API Evidence

Current static compatibility report, with the expanded action observations:

```text
.artifacts/native-model-design-compatibility/compatibility-650a6cb5-e517-4bba-a95b-195c8c66a6e8/report.json
SHA256 60f1d2daf0ec8f1298729613ceb80f17383b0152b754154b2d199575017fc91e
```

Original Central and ModelDesign `PSSYSAPP.json` models each have 11 plugin
references requesting alpha.90, under:
`vendor-upstream/ibizmodeling-standard/modelapi-core/src/main/resources/model/net/ibizsys/modeling`.

The runtime registry key convention is `${plugin.pluginType}_${plugin.pluginCode}`,
in `ibiz-app-hub/packages/runtime/src/register/helper/common-register.ts:36`.
All requested `DEUIACTION_` keys match alpha.122 source and generated es:

```text
DSL_EDIT, DSL_EXPORT, DSL_IMPORT,
EXPORT_TO_MODEL_CLIPBOARD, IMPORT_FOR_MODEL_CLIPBOARD,
MODEL_CLONE, MODEL_COPY, MODEL_EDIT, MODEL_PASTE,
OPEN_MODEL_CLIPBOARD, OPEN_MODEL_RUNTIME
```

The test transpiles/executes the real UIAction `install` and checks all 11
registrations and provider factories. Provider constructors are stubbed.
This verifies registration behavior, not provider workflows or browser install.

The historical build report's `apiActions` only covered first-argument literals.
The compatibility report adds a separate, hash-bound AST analysis: action
argument 0 for `service.exec`, argument 1 for `app.deService.exec`, conditional
literal branches and observed top-level table values. It retains dynamic-input,
type-resolution and complete-API-surface verification as false. It does not
rewrite the original build report or infer arbitrary `.exec` calls as services.

The 11 observed calls reference these seven distinct names. Structured original
entity-model declarations, matched case-insensitively, give:

| Observed action | Central entity declarations | ModelDesign entity declarations |
|---|---:|---:|
| `CompileModelDSL` | 5 | 160 |
| `CopyModel` | 0 | 5 |
| `ExportModelDSL` | 4 | 159 |
| `ExportModelV2` | 3 | 148 |
| `ImportModelV2` | 3 | 148 |
| `PasteModel` | 0 | 5 |
| `mergemodeldsl` | 1 | 1 |

`CopyModel`/`PasteModel` appear on PSDEFORM, PSSYSDBSCHEME, PSSYSDBTABLE,
PSSYSVIEWPANEL and PSDEVIEWBASE in ModelDesign. Declaration counts do not prove
that a dynamically selected entity has the action, that the server handles it,
or that alpha.90 request/response semantics match. Both apps declare
`mergemodeldsl` on PSSYSTEM. The normal clipboard table has advanced -> CopyModel
and default -> ExportModelV2; no dsl entry is present. The DSL clipboard selects
mergemodeldsl/ExportModelDSL from `props.data.isMerge`.

The runtime component requests
`${ibiz.env.baseUrl}/${ibiz.env.appId}/psdevslnsys/${context.psdevslnsys}/getruntimenodes`.
Neither original app's PSDEVSLNSYS methods/actions declare `getruntimenodes`.
The server may expose an extension independently; **no HTTP 404 or successful
endpoint response was reproduced here**. Server contract validation is pending.
Original alpha.90 implementation was not available for a direct source/API diff.

## Browser Preflight And Runtime Source Gap

The generated SystemJS imports were compared with the current static global map:
`modelingweb/app/public/extras/json/system-import.json` (4779 bytes),
SHA-256 `5f51a1caefd6b65256b5ecc711576a59f3119becafc6c3f09b1d86e318ab7920`.
Missing static mappings:

- `@ibiz-template-plugin/runtime-model/loader`.
- `@monaco-editor/loader`.
- `pluralize`.

Scoped maps and dynamic registration were not evaluated. No target delivery or
browser failure was claimed from static coverage alone. Axios's map path hints
at 1.6.1, outside candidate range `^1.6.2`; actual served package identity/API
was not authenticated. Monaco runtime path is `monaco-editor@0.52.2/min/vs`;
actual worker/resource delivery remains a main-thread browser check.

The compiled runtime subtree is pinned at 7 MJS files / 278671 bytes,
fingerprint `b8e6ea99941967181c723b693d56f64a00db3777ffd2b521fa1692a00973eae3`.
Its `loader/index.mjs` is 452 bytes, SHA-256
`ae3f1f566013dae68028e6fc138ca0dbafdcdadf2ed1b2319d932ac162db56d4`.
It re-exports the requested `applyPolyfills` and `defineCustomElements`.
These are compiled-export observations, not original source/API or behavior proof.

Acquisition evidence:
`.artifacts/native-runtime-model-acquisition-20261006/evidence-index.json`,
SHA-256 `f9a6e170e2013f9dcd08ac916812c6186863eb8702b322059f593331edf38588`.
The build consumer rechecks all 44 response bodies and header hashes.
The bounded public investigation found npm metadata/exact tarball 404s and only
compiled upstream trees. It does not prove universal source absence.
No new acquisition or private-registry access was attempted by the build task.

Missing authentic inputs: original package.json, package license, src,
Stencil config, tsconfig, dependency lock/provenance and runtime source-build
receipt. `@ibiz/model-core` and `@ibiz/rt-model-api` do not substitute for this loader.

## Repeatable Checks

Run from the workspace root. Each build creates a fresh UUID destination.
Commands intentionally return **2** for retained, unaccepted evidence; do not
swallow them with `|| true`, delete partial outputs or treat artifact existence
as a PASS.

```sh
node scripts/harness-native-model-design-build.mjs \
  --input-receipt .artifacts/native-model-design-inputs/inputs-20261006-config-pinned-first/receipt.json \
  --repair-receipt .artifacts/native-resource-repair/repair-2026-10-05T17-27-50-342Z-71e3bbb8-848a-4b21-a4f4-8c68e2925498/receipt.json \
  --dependency-report .artifacts/native-ai-code-source-deps/monaco-lifecycle-20261006/report.json

node scripts/harness-native-model-design-build.mjs \
  --verify-report .artifacts/native-model-design-build/build-c8c3e614-c829-40ae-8ee4-52ddb75b7f8e/report.json

node scripts/inspect-native-model-design-compatibility.mjs \
  --source-report .artifacts/native-model-design-build/build-c8c3e614-c829-40ae-8ee4-52ddb75b7f8e/report.json

node --check scripts/harness-native-model-design-build.mjs
node --check scripts/inspect-native-model-design-compatibility.mjs
node --test scripts/tests/native-model-design-build.test.mjs \
  scripts/tests/native-model-design-compatibility.test.mjs \
  scripts/tests/native-model-design-inputs.test.mjs \
  scripts/tests/repair-native-model-resources.test.mjs \
  scripts/tests/native-plugin-source-evidence.test.mjs
```

Latest code regression: **259/259 passed, 0 failed, 0 skipped**.
Both new CLIs passed syntax checks. The build consumer verified current evidence
and the expanded compatibility analysis generated a fresh report, both with
intentional exit 2. Test PASS does not clear any source/build/acceptance gate.

## Remaining Work And Main-Thread Handoff

1. Acquire authenticated runtime-model@0.2.2 original source, license and complete
   build inputs, then build its loader. Do not reuse the compiled subtree as source.
2. Fix the 22 TS7053 diagnostics in an explicitly versioned local candidate;
   preserve original source pins and receipts. Rerun typecheck and both declared
   build steps with the authentic loader; no fabricated declarations.
3. Resolve/instrument es/lib resource copying within the responsible CLI/build
   scope and verify all three resource trees. Preserve the failed gates/history.
4. Record an isolated dependency lock and package provenance; establish the
   replacement's framework/API compatibility without relabeling versions.
5. Main thread: validate actual import/scoped-map/dynamic registration delivery,
   Axios identity/range and Monaco worker paths in the browser.
6. Main thread: verify action-to-entity routing, request/response semantics,
   getruntimenodes and editor/clipboard/clone/DSL/runtime/save/reload workflows.
7. Only after the independent gates pass, accept a documented alpha.122
   replacement mapping. It must remain a replacement, not alpha.90 exact.

This report makes no console/layout source-acquisition claim and performs no
compose edits, container rebuild/deployment or native-browser verification.
