# Native model-design isolated build inputs

This guide stages a candidate, not an accepted plugin or a recovered runtime.
Resource integrity, input staging, an isolated copy hook, a full plugin build
and native acceptance are separate gates. Do not copy candidates over originals.
No dependency install, typecheck or full plugin build is run by these CLIs.

## Prerequisites and scope

Run from the workspace root on Linux with Node.js >= 20 and accessible
`/proc/self/fd`; the pinned-file helpers require that Linux interface.
Use a private/trusted workspace with trusted artifact ancestors. Current artifact
parents have mode `0775`, owning UID `1000` and GID `1000`; both owning-UID and
writable-GID actors/processes, as well as same-UID/root writers, must be trusted.
Each candidate requires a
cooperative single writer, with no concurrent UID/GID/root mutation. Private
`0700` children do not prevent parent-directory writers from renaming them.
Linux pinned reads reject observed changes; they are not
an atomic multi-file snapshot and cannot guarantee detection of a malicious
rename between `mkdir` and the first stat. No arbitrary same-UID/root snapshot,
publication or replacement-safe rollback guarantee is promised.
Do not change existing artifact directory permissions, originals
or production files to satisfy these prerequisites.

Keep the published resource tree and audited source originals read-only:

- Resources: `plm-web/public/plugins/@ibiz-template-plugin/model-design@0.0.3-alpha.122/dist/assets/json/runtime-model`.
- Source: `vendor-upstream/gottaboy-plm-web/plugin-src/@ibiz-template-plugin/model-design@0.0.3-alpha.122`.

Repair is limited to escaping raw LF inside JSON strings. Its fixed inventory
is **1414 total / 17 changed / 46 raw LF escaped / 1397 unchanged**;
unchanged files remain byte-identical. Other malformed JSON must fail.
Staging copies the original source, manifest and config bytes unchanged and
adds verified resources at `package/public/assets/json/runtime-model`.
These resources are not the missing `runtime-model@0.2.2` source package.

## Full source/config audit refresh

Review found a P2 configuration-drift gap: pinning only `src/` and the manifest
did not independently pin the other staged root configuration files. The
strengthened audit declares `source.audit.inputFiles: 72` and pins
`source.audit.inputFingerprint` to
`a2eff77ed8cdefebfa24636620baa77b8e067458d92033edb0492465ca21ed06`.
This covers all 68 files under `src/` plus `package.json`, `tsconfig.json`,
`ibiz.config.cjs` and `CHANGELOG.md`, not just the implementation subset.

Earlier input receipts are historical evidence. Their top-level source
fingerprint matching this value does not supply the new `source.audit` fields.
The current verifier requires the extended audit evidence; unchanged
`schemaVersion: 1` is not sufficient. Do not retrofit fields into old receipts.
Regenerate into a fresh unique destination using the updated tool, then verify
the new input receipt together with the exact verified resource repair receipt.
Preserve earlier and failed candidates under the failure contract below.

The main thread has now confirmed fresh generation and consumer verification
against the extended audit, plus final focused 335/335 and whole-script
1013/1013 regressions below. This is candidate input integrity and script
regression, not a plugin build or native acceptance. The previous 905-test
result is historical.

## Failure and receipt contract

The main-confirmed contract preserves **all partial or ambiguous candidates**
for inspection on failure. There is no failure cleanup, `unlink`, `rmdir` or
recursive auto-cleanup. Retry into a fresh unique destination; do not delete or
reuse the failed candidate directory.

Receipt publication uses a direct exclusive `O_CREAT | O_EXCL | O_NOFOLLOW`
write and pinned readback, not a temporary-file publication.
**Receipt existence never implies generation or staging success**: a partial
write or failed final recheck may leave one behind. Always run the read-only
consumer verifier against the exact receipt and current files before consumption;
input verification also requires the exact repaired-resource receipt.
The main thread reports independent implementation review approval within this
trust boundary. The historical focused and whole-script regressions below
precede the full source/config audit extension; they do not validate this
correction. The fresh post-extension evidence is recorded separately.
Historical receipts alone do not prove the extended audit contract; script
PASS is not native editor or production acceptance.

## Generate, verify, then stage

Use fresh UUID directories for every run; existing outputs cannot be overwritten.
Set `WORKSPACE_ROOT` to your checkout. Save the exact printed receipt paths.

```sh
export WORKSPACE_ROOT=/home/my/workspace/ainfra/aibiz
(
  set -e
  cd "$WORKSPACE_ROOT"
  test "$(uname -s)" = Linux
  test -d /proc/self/fd
  node -e 'if (Number(process.versions.node.split(".")[0]) < 20) process.exit(1)'
  RUN_ID="$(node -p 'require("node:crypto").randomUUID()')"
  REPAIR_DIR=".artifacts/native-resource-repair/repair-$RUN_ID"
  INPUT_DIR=".artifacts/native-model-design-inputs/inputs-$RUN_ID"
  REPAIR_RECEIPT="$REPAIR_DIR/receipt.json"
  node scripts/repair-native-model-resources.mjs --output "$REPAIR_DIR"
  node scripts/repair-native-model-resources.mjs --verify-receipt "$REPAIR_RECEIPT"
  result=0
  node scripts/prepare-native-model-design-inputs.mjs \
    --repair-receipt "$REPAIR_RECEIPT" --output "$INPUT_DIR" || result=$?
  printf 'Input generation exit=%s; build remains blocked (expected 2)\n' "$result"
  test "$result" -eq 2
  result=0
  node scripts/prepare-native-model-design-inputs.mjs \
    --repair-receipt "$REPAIR_RECEIPT" \
    --verify-receipt "$INPUT_DIR/receipt.json" || result=$?
  printf 'Input verification exit=%s; build remains blocked (expected 2)\n' "$result"
  test "$result" -eq 2
)
```

Resource verification returns `verified-resource-candidate-not-accepted`.
It rereads the original fingerprint, every LF edit/record/hash, and the current
copy's JSON and fingerprint; stale or tampered evidence must stop consumption.
Rerun this read-only check before any later copying or build.

Input generation returns `prepared-build-blocked`; read-only verification
returns `verified-inputs-build-blocked`. Both intentionally exit **2**, not
acceptance success. Invalid inputs or evidence exit 1. The example checks 2
explicitly; do not suppress errors with `|| true` or turn its wrapper's exit
into a build PASS. Verification needs both exact receipts and cannot use
`--output`; it does not upgrade the persisted receipt.
`buildReady`, `acceptedForProduction` and `runtimeModelSourceRecovered` stay false.
New input receipts must record requested `0.0.3-alpha.90`, candidate
`0.0.3-alpha.122`, and `compatibility: not-verified`.

## Observed artifacts

The persistent resource receipt is
`.artifacts/native-resource-repair/repair-2026-10-05T17-27-50-342Z-71e3bbb8-848a-4b21-a4f4-8c68e2925498/receipt.json`,
generated at `2026-10-05T17:27:50.464Z` (UTC). Its input fingerprint is
`138c8f08d260037c0687cf2c255d85f27a2d02a82f234d2c9414ba2356155797`;
the verified repaired fingerprint is
`45f5a9acfc8bf181e05f5ae1e15088c1c8b7ec1f44dba5a172dfc4bb7e315211`.

First observed staging receipt:
`.artifacts/native-model-design-inputs/inputs-20261005-isolated-first/receipt.json`,
generated at `2026-10-05T17:51:55.228Z` (UTC):

| Inventory | Observed value |
|---|---|
| Audited source/config files | 72: 68 under `src/`, 4 root files |
| Repaired JSON resources | 1414 |
| Staged package files | 1486 = 72 + 1414 |
| Source file-set SHA-256 | `a2eff77ed8cdefebfa24636620baa77b8e067458d92033edb0492465ca21ed06` |
| Staged package SHA-256 | `f01090611643590f974a5ebacbf1b928f5ce29bb47fcbc9e7b459c1c16154538` |

This is historical inventory evidence: the first receipt predates the explicit
mapping fields and the full source/config audit extension. It is not valid
evidence for the current verifier. Generate and verify a fresh receipt with the
updated tool before consumption.

Later historical input receipt, before the full source/config audit extension:
`.artifacts/native-model-design-inputs/inputs-2026-10-05T18-05-51-886Z-58fccf70-dc78-4ca8-a573-aae052d049fa/receipt.json`,
generated at `2026-10-05T18:05:52.357Z` (UTC). The main thread confirmed generation
and consumer verification at that time completed with expected exit 2 under
the earlier audit contract. Its explicit mapping is requested alpha.90 /
candidate alpha.122 / compatibility `not-verified`.
It retains 72 source/config + 1414 resources = 1486 files and package fingerprint
`f01090611643590f974a5ebacbf1b928f5ce29bb47fcbc9e7b459c1c16154538`.
Persisted status is `prepared-build-blocked`; consumer status is
`verified-inputs-build-blocked`. Build readiness, production acceptance and
runtime-model source recovery remain false. Its `source.audit` lacks
`inputFiles` and `inputFingerprint`, so this receipt is not current-verifier
evidence despite its matching top-level source fingerprint. Preserve it as
history; generate and verify a new receipt rather than reuse or edit it.

Historical CLI consumer result, under the earlier audit contract:
`.artifacts/native-model-design-inputs/regression-20261006-safety/verify-cli.json`.
It records `verified-inputs-build-blocked`, `inputIntegrityVerified: true` and
the same false build/acceptance/source-recovery flags. The main thread confirmed
actual exit 2 as expected, with no skipped verification. This is not a build
execution or acceptance result, and its `inputIntegrityVerified: true` does
not verify the extended full source/config baseline. The log's `generatedAt`
is the input receipt's generation time, not a separate consumer execution
timestamp. The new main-confirmed consumer evidence follows.

Fresh input receipt with the extended full source/config audit:
`.artifacts/native-model-design-inputs/inputs-20261006-config-pinned-first/receipt.json`,
generated at `2026-10-05T18:35:02.328Z` (UTC). The `20261006` name is the
workstation +08:00 date, not its UTC generation date. The main thread confirmed
generation and verification each returned the intentional exit 2.
The inspected receipt and CLI captures record
`source.audit.inputFiles: 72` and `source.audit.inputFingerprint` equal to
`a2eff77ed8cdefebfa24636620baa77b8e067458d92033edb0492465ca21ed06`.
The staged **1486 = 72 + 1414** files retain package fingerprint
`f01090611643590f974a5ebacbf1b928f5ce29bb47fcbc9e7b459c1c16154538`.

Generation capture:
`.artifacts/native-ai-code-deployment/regression-20261006/model-design-generate-cli.json`.
Consumer capture:
`.artifacts/native-ai-code-deployment/regression-20261006/model-design-verify-cli.json`.
These capture model-design CLI results despite the parent directory's name.
Persisted status is `prepared-build-blocked`; consumer status is
`verified-inputs-build-blocked`, with `inputIntegrityVerified: true`.
Both retain `buildReady: false`, `acceptedForProduction: false`,
`runtimeModelSourceRecovered: false`, and requested alpha.90 / candidate
alpha.122 / compatibility `not-verified`. This is verified candidate input
integrity only. Reverify the exact receipt before later consumption.

## CLI asset-copy evidence

The inspected installed `@ibiz-template/cli-core@0.3.30` declares `bundleDir:
dist` in `dist/define-config.js`. Its
`dist/rollup/bundle-option/bundle-option.js` copies `public` into the bundle
directory; `dist/rollup/module-option/module-option.js` copies it into `es`
and `lib`. Hence the declared input is `package/public/assets/json/runtime-model`,
not `package/src/assets/json/runtime-model`.

An actual installed 0.3.30 CopyFilePlugin hook was called separately from
`2026-10-05T17:55:21.902Z` to `2026-10-05T17:55:23.353Z` (UTC).
Receipt:
`.artifacts/native-model-design-inputs/asset-copy-experiment-LbUEZg/receipt.json`.
Log:
`.artifacts/native-model-design-inputs/regression-20261005-isolated/cli-asset-copy-realpath.log`.
The receipt identifies the installed CLI path and hook SHA-256. Fresh experiment
`dist`/`es`/`lib` resource trees each had 1414 files, all passed `JSON.parse`,
and each matched repaired fingerprint
`45f5a9acfc8bf181e05f5ae1e15088c1c8b7ec1f44dba5a172dfc4bb7e315211`.

Its status is `asset-copy-hook-pass-not-plugin-build`;
`fullPluginBuildExecuted` and `acceptedForProduction` are false. The experiment
does not verify the eventual full plugin outputs or clear
`built-dist-and-es-resource-copy-not-verified`.

## Regression and remaining gates

From the workspace root:

```sh
node --test scripts/tests/repair-native-model-resources.test.mjs
npm run test:native-resources --prefix scripts
npm run test:native-model-design-inputs --prefix scripts
npm test --prefix scripts
```

The first two commands are equivalent focused resource entries. Whole scripts
tests include both suites via `tests/*.test.mjs`. The prior main-confirmed
resource phase recorded 77 resource tests and 768 scripts tests, zero
failures/skips, in
`.artifacts/native-resource-repair/regression-20261006/resource-tests.log` and
`.artifacts/native-resource-repair/regression-20261006/scripts-tests.log`.
The `20261006` directory names use workstation +08:00 time, not a UTC run date.
Those counts do not cover the subsequently added staging tool.

**Historical main-confirmed focused safety regression before audit extension:**
224/224 passed, 0 failed,
0 skipped: 93 resource + 118 input-staging + 13 source-evidence tests.
The inspected log is
`.artifacts/native-model-design-inputs/regression-20261006-safety/focused-tests.log`;
its summary records 224 tests/pass, zero failures/skips/cancellations and
`duration_ms: 7451.185517`. Component counts are main-confirmed, not reused from
the historical resource phase. Combined focused entry from the workspace root:

```sh
node --test \
  scripts/tests/repair-native-model-resources.test.mjs \
  scripts/tests/native-model-design-inputs.test.mjs \
  scripts/tests/native-plugin-source-evidence.test.mjs
```

The first whole `npm test --prefix scripts` run is main-confirmed and log-checked:
**902/902 passed, 0 failed, 0 skipped**, `duration_ms: 38196.672604`, at
`.artifacts/native-model-design-inputs/regression-20261006-safety/scripts-tests.log`.
It is an intermediate result, not the final deployment regression: three standard
source-overlay checks were added afterward, and the main thread reports their
separate focused entry as 19/19 PASS. At that stage the final whole-suite rerun
was pending; neither 902 nor earlier counts were its result.

The subsequent final whole-suite run for that prior revision is main-confirmed
and log-checked:
**905/905 passed, 0 failed, 0 skipped**, `duration_ms: 40025.966779`
(40.03 s), at
`.artifacts/native-model-design-inputs/regression-20261006-safety/scripts-tests-source-routing.log`.
This updates the final-run status without erasing the intermediate 902 evidence.
These historical results do not cover the subsequent full source/config audit
extension or new deployment tooling. They are not a plugin build, missing
source recovery, production or native acceptance.

**Post-extension main-confirmed safety/source focused regression:**
231/231 passed, 0 failed, 0 skipped. This is the resource/input/source-evidence
subset reproduced by the combined focused command above, not the whole suite
or a count of the separate ai-code publisher tests. The final combined focused
run includes this 231-test subset plus three routing and 101 ai-code tests.

**Final post-extension regression, main-confirmed and log-checked:**

| Entry | Result | Evidence |
|---|---|---|
| Combined focused | 335/335 PASS, 0 failed/skipped; `duration_ms: 12616.6567` | `.artifacts/native-ai-code-deployment/regression-20261006/focused-tests.log` |
| Whole `npm test --prefix scripts` | 1013/1013 PASS, 0 failed/skipped; `duration_ms: 40303.037063` | `.artifacts/native-ai-code-deployment/regression-20261006/scripts-tests.log` |

The focused breakdown is main-confirmed: 93 resource + 125 model-input +
13 source-evidence + 3 routing + 101 ai-code = 335. Reproduce its entry:

```sh
node --test \
  scripts/tests/repair-native-model-resources.test.mjs \
  scripts/tests/native-model-design-inputs.test.mjs \
  scripts/tests/native-plugin-source-evidence.test.mjs \
  scripts/tests/native-standard-source-platform.test.mjs \
  scripts/tests/native-ai-code-deployment.test.mjs
```

These replace the pending post-extension script results, not the historical
905 evidence or the still-blocked build/native/source-recovery gates.

The separate ai-code deployment workflow is documented in
[NATIVE-AI-CODE-DEPLOYMENT.md](NATIVE-AI-CODE-DEPLOYMENT.md).
Its candidate evidence does not satisfy model-design build or native acceptance.

Runtime API results are endpoint-specific, not evidence that all URLs are fixed:

| Endpoints and main-reported upstream | Result | Report |
|---|---|---|
| Source candidate: `http://127.0.0.1:32008/central/`, `http://127.0.0.1:32009/modeldesign/` -> `ibiz-ebsx-allinone-local` | Fresh 42/42 PASS; cleanup PASS | `.artifacts/native-platform-api/model-design-inputs-safety-source-20261006/report.json` |
| Historical standard baseline before cutover: `http://127.0.0.1:32006/central/`, `http://127.0.0.1:32007/modeldesign/` -> old `ibiz-ebsx-allinone` | FAIL: 36/48 passed, 12 failed | `.artifacts/native-platform-api/model-design-inputs-safety-20261006/report.json` |
| Earlier standard entries after source-platform cutover: `http://127.0.0.1:32006/central/`, `http://127.0.0.1:32007/modeldesign/` -> `ibiz-ebsx-allinone-local` | 42/42 PASS; both cleanup summaries PASS | `.artifacts/native-platform-api/standard-source-routing-20261006/report.json` |
| Latest source-bound regression, standard 32006/32007 -> `ibiz-ebsx-allinone-local` | Required 42/42 PASS; both cleanup summaries PASS | `.artifacts/native-platform-api/source-bound-regression-20261006/report.json` |

The fresh source-candidate run was `2026-10-05T18:06:46.576Z` to
`2026-10-05T18:06:48.510Z` (UTC), exit 0. Both authenticated cleanup summaries
pass; anonymous cleanup is not needed. The earlier candidate 42/42 report remains
historical evidence at
`.artifacts/native-platform-api/model-design-inputs-regression-20261005/report.json`.

The default run was `2026-10-05T18:05:30.804Z` to `2026-10-05T18:05:33.329Z`
(UTC). Each app fails `configs-same-session-get`, `configs-update-get`,
`configs-other-session-update-get`, `configs-reset-get`, `configs-roundtrip`,
and the first `cleanup-get-1`, reflecting stale cache reads in immediate/same/
already-authenticated sessions. Final cleanup summaries pass; earlier failed
cleanup reads remain recorded and do not become PASS. The historical 48-check
run includes six additional cleanup-retry checks triggered by failure, compared
with 42 checks on a successful run. Preserve each report's actual totals.

The earlier post-cutover standard-entry report is main-confirmed and JSON-checked:
`2026-10-05T18:17:00.722Z` to `2026-10-05T18:17:03.295Z` (UTC), exit 0,
21 checks per app. The separate standard source-platform overlay changes only
the two entry containers' platform upstream, without changing models/plugins,
the candidate-only overlay, ModelAPI or UAA. Deployment and two-entry rollback
commands are in [NATIVE-SOURCE-PLATFORM-ROUTING.md](NATIVE-SOURCE-PLATFORM-ROUTING.md).

Earlier required business-stack runtime checks pass 17/17 at
`.artifacts/modeling-runtime-source-routing-20261006/report.json`,
timestamp `2026-10-05T18:17:00.809Z` (UTC): ModelAPI on
`32002/ibizmodeling/modelapi`, web/auth proxy on `32003`, not native editor checks.
The earlier standard-cutover portal passes 9/9 with zero console/HTTP/page/request errors at
`.artifacts/external-ui/standard-source-routing-20261006/report.json`,
`2026-10-05T18:17:00.922Z` to `2026-10-05T18:17:02.095Z` (UTC).

Fresh source-bound runtime reruns are main-confirmed and JSON-checked. Standard
API runs `2026-10-05T18:33:45.942Z` to `2026-10-05T18:33:48.515Z` (UTC),
exit 0, 21 checks/app; cleanup passes and anonymous cleanup is not needed.
Required business runtime passes 17/17, exit 0, at
`.artifacts/modeling-runtime/source-bound-regression-20261006/report.json`,
timestamp `2026-10-05T18:33:46.026Z` (UTC), still covering ModelAPI 32002 and
web/auth 32003 rather than native editing. Portal passes 9/9 with zero
console/HTTP/page/request errors at
`.artifacts/external-ui/source-bound-regression-20261006/report.json`,
`2026-10-05T18:33:46.107Z` to `2026-10-05T18:33:47.219Z` (UTC).
These runs do not deploy or accept the staged model-design inputs.

The verification portal `http://127.0.0.1:19323/#?` separately passes 9/9, with
no console/HTTP/page/request errors, in
`.artifacts/external-ui/model-design-inputs-safety-20261006/report.json`
(`2026-10-05T18:05:30.925Z` to `2026-10-05T18:05:32.057Z`, UTC).
The prior portal 9/9 report remains at
`.artifacts/external-ui/model-design-inputs-regression-20261005/report.json`.
The `safety-20261006` names use workstation +08:00 time, not a UTC run date.
Neither API nor portal results are model-design source-build or native editor
acceptance.

Latest source-bound native browser acceptance exited 1:
`.artifacts/native-modeldesign/source-bound-regression-20261006/report.json`.
`prerequisiteChecksPassed` and `pluginAssetsVerified` are false, with eight
failing stages. Central's four and ModelDesign's eight pinned plugin
`package.json` requests return 404, including
`/modeldesign/plugins/@ibiz-template-plugin/global-util-design@0.0.3-alpha.87/package.json`;
the routing guide lists the exact packages. Central navigation rejects
`FetchDefault` as `DATAQUERY`, not remote `FETCH`; ModelDesign login/home do not
initialize and four unexplained browser errors remain. Native editor operations,
save and fresh-session readback remain unaccepted.
The earlier eight-stage failure is preserved at
`.artifacts/native-modeldesign/2026-10-05T18-17-01.168Z/report.json`;
the new API/script PASS does not erase either native FAIL.

Still required: complete `runtime-model@0.2.2` source/build config, isolated
dependency lock/resolution/install, runtime loader delivery, full-build resource
outputs, local typecheck/build, alpha.90-to-alpha.122 compatibility, and native
edit/save/reload acceptance. Source localization remains blocked; no runtime
source recovery, production acceptance or full completion is claimed.
