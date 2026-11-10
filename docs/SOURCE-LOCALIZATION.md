# Source Localization Status

## Current Workspace Assessment: 2026-11-03

The November 6 follow-up,
`OWNED-MYSQL-COLD-BACKUP-RESTORE-20261106.md`, passes two fresh 188-check native
deployments and independent cold-archive audits. Four restores delete the old
data volume before restoring to new volume identities, with exact cold-file
comparison and six-user fresh-login readback. This bounded same-host fixture
drill is not production/off-host backup, host/power-loss or complete
localization acceptance.

The later November 5 checkpoint,
`OWNED-MYSQL-CONTAINER-RECREATION-20261105.md`, passes two fresh 188-check native
deployments and independent audits, each with two genuinely new MySQL container
IDs over the original verified disk volume and two provider restarts. Original
resource receipts remain unchanged. This still does not certify host restart,
power-loss, backup/restore, complete localization or release acceptance.

The November 5 disk-backed follow-up is
`OWNED-MYSQL-VOLUME-RESTART-20261105.md`. Both center topologies pass 188 real
HTTP checks, each including two same-container MySQL disk-volume restarts and
two provider restarts with ordinary-user fresh-login readback. This bounded
result does not close container recreation, host/power-loss recovery, English,
marketplace offline delivery, original-source or release acceptance.

See `LOCALIZATION-AND-SECONDARY-DEVELOPMENT-20261103.md` and its per-catalog
`MARKETPLACE-SOURCE-INVENTORY-20261103.json` for the current source, marketplace,
offline and secondary-development gap matrix. Earlier rows below contain
historical checkpoints, not one current acceptance verdict. Maintained
standalone UAA source now exists, but its primary deployment binding and full
closure remain unverified. The current native deployment check is 4 pass/0 fail
after a fresh route-picker source/build/output binding. The route-picker
mapping remains blocked for original provenance, compatibility and native
runtime evidence; this is not native acceptance.
The live ledger still has six failures and three warnings. No whole-source,
offline-installation or release acceptance is declared.

This records how far each iBiz component is from "edit the source and the
running system changes". It is a hand-maintained decision record; the machine
readable version of the numbers is `npm run ledger` in this repository.

`npm run ledger` answers one question per component: which version does each
authority demand, and do they agree? Add `--live` to include running container
images and published registry tips.

## Ready: source edits take effect

Here "Ready" means the local source/deployment path is wired and verified in the
current workspace. For Modeling Web, the formal development Compose service now
uses the verified local image; rows that still name a prebuilt image remain
explicitly not ready.

| Component | Source | Deploy path |
|---|---|---|
| PLM frontend | `plm-web` | `pnpm build` then `pnpm preview --host 127.0.0.1 --port 4173` |
| PLM backend | `plm/backend` | `build-local-image.sh` produces `aibiz/plmservice:local` |
| System model | `plm/model` | bind mounted into `plmweb`, `modelingservice`, `modelingweb` |
| Plugins | `plm-web/plugin-src` (73 of 73 recovered) | builds back into `public/plugins`, mounted read only |
| Modeling backend 32002 | `ibiz-service-hub` Modeling service source | source-built arm64 image; the replaced container was `healthy` at 2026-09-28 22:40 +08:00 with host/container JAR SHA-256 equal and unauthenticated service URLs returning 401; business runtime and browser cutover remain unverified |
| Allinone local candidate 30100 | `ibiz-service-hub/ibiz-ebsx-runtime` | 83-module Maven reactor, arm64 Docker image, and `source-platform` smoke `7/7 PASS` |
| Gateway local candidate 30186 | `ibiz-service-hub/ibiz-ebsx-gateway` | arm64 Docker image and `source-platform` smoke `7/7 PASS` |
| `@ibiz-template/core` | `ibiz-app-hub/packages/core` | linked into `plm-web`, rebuilt into `dist/extras` |
| `@ibiz-template/runtime` | `ibiz-app-hub/packages/runtime` | linked into `plm-web`, rebuilt into `dist/extras` |
| `@ibiz-template/model-helper` | `ibiz-app-hub/packages/model-helper` | linked into `plm-web`, rebuilt into `dist/extras` |
| `@ibiz-template/vue3-util` | `ibiz-app-hub/packages/vue3-util` | linked into `plm-web`, rebuilt into `dist/extras` |
| `@ibiz-template/vue3-components` | `ibiz-app-hub/components/ibiz-next-vue3` | linked into `plm-web`, rebuilt into `dist/extras` |
| `@ibiz-template/devtool` | `ibiz-app-hub/plugins/ibiz-template-devtools` | linked into `plm-web`, rebuilt into `dist/extras` |
| `@ibiz-template/theme` | `ibiz-app-hub/packages/theme` | linked into `plm-web`, imported at build time |
| `@ibiz-template/web-theme` | `ibiz-app-hub/components/web-theme` | linked into `plm-web`, rebuilt into `dist/extras` |
| `@ibiz/model-core` | `ibiz-app-hub/models/model-core` | linked into `plm-web`, type/interface contract only; no SystemJS bundle |
| `@ibiz/rt-model-api` | `ibiz-app-hub/models/rt-model-api` | linked into `plm-web`, runtime code bundled by PLM Vite; no SystemJS bundle |
| `@ibiz-template-plugin/ai-chat` | `ibiz-app-hub/plugins/ibiz-ai-chat` (`0.0.60`) | linked into `plm-web`, built as SystemJS fallback in `public/extras` and `dist/extras` |
| `@ibiz-template-plugin/bi-report` | `ibiz-app-hub/plugins/ibiz-bi-report` (`0.0.32`) | linked into `plm-web`, built as SystemJS fallback in `public/extras` and `dist/extras` |
| `@ibiz-template-plugin/data-view` | `ibiz-app-hub/plugins/ibiz-data-view` (`0.0.6`) | linked into `plm-web`, built as SystemJS fallback in `public/extras` and `dist/extras` |
| `@ibiz-template-plugin/gantt` | `ibiz-app-hub/plugins/ibiz-gantt` (`0.1.8-alpha.378`) | linked into `plm-web`, built as SystemJS fallback in `public/extras` and `dist/extras` |
| Modeling frontend 32003 | `modelingweb/app` | formal `docker-compose-dev.yml` uses `aibiz/modelingweb:local`; optional `docker-compose-modeling-local.yml` provides host `dist` iteration, `docker-compose-modeling-remote.yml` provides rollback; plugin sidecar, deployment harness, and browser smoke pass. The mounted `plm/model` currently renders a PLM-backed workbench, not native Central/ModelDesign |
| allinone 30000 | `ibiz-service-hub/ibiz-ebsx-runtime` | Dockerized Maven source build produces `aibiz/ibiz-ebsx-allinone-rt:8.1.0.584.1-local-clean-20260928`; `linux/arm64`; backend contract `8/8`, smoke contract `4/4`, source-platform smoke `7/7` |
| gateway 30086 | `ibiz-service-hub/ibiz-ebsx-gateway` | Dockerized Maven source build produces `aibiz/ibiz-ebsx-gateway:8.1.0.584.1-local-clean-20260928`; `linux/arm64`; backend contract `8/8`, smoke contract `4/4`, source-platform smoke `7/7` |

### UAA: standalone source/protocol blocked

| Component | Available source | Missing required closure |
|---|---|---|
| UAA 32666 (blocked, not ready) | `vendor-upstream/ibizlab-runtime/ibzuaa` is legacy `IBZUSER` / `v7/login` / `uaa/login` source only | Running `uaa-api` uses `sys_person` and `POST /auths/login` via `RTAuthAgent`; no matching editable standalone source/build and independently verified runtime protocol/encoder closure |

The legacy `ibzuaa` JAR and `aibiz/uaa:source-built` image are historical
build evidence for a different contract, not a replacement for standalone
UAA. Live entrypoint/JAR hash identity does not prove editable source or
effective password encoding. See `docs/uaa-task-source-build-audit.md`.
S06 UAA/Task own-source and D01 compiler-in-Docker remain required, with
zero skips and `nativeAcceptance=false`; frontend or static Docker passes
cannot substitute.

The PLM model pins 73 unique plugins. The runtime, recovery, inventory, local
source, and published-output ledgers now use the same 73-plugin set; the
unreferenced historical package versions in `all-plugins.txt` remain outside
that runtime set.

### Model package delivery contracts

These three packages are deliberately excluded from the plugin SystemJS bundle
requirement:

| Package | Contract | Ledger enforcement |
|---|---|---|
| `@ibiz-template/theme` | build-time style source; SCSS is imported by the PLM Vite build | missing `index.system.min.js` is not a warning; an import-map entry is a failure |
| `@ibiz/model-core` | types-only; emitted JavaScript has no standalone browser behavior | missing `index.system.min.js` is not a warning; an import-map entry is a failure |
| `@ibiz/rt-model-api` | app-bundled runtime; imported by `plm-web/src/model/model-loader.ts` and not externalized by `plm-web/vite.config.ts` | missing `index.system.min.js` is not a warning; an import-map entry is a failure |

The plugin runtime contract remains the SystemJS import map. These model
packages must not be added to that map, because they are application
dependencies rather than plugin-shared externals.

### Modeling core migration mappings

`fixtures/modeling-core-migration-contract.json` is the authoritative
old-reference to local-compatible-reference ledger for the 11 exact plugin
references in the iBizModeling `Central` and `ModelDesign` model documents.
`harness-modeling-core-audit.mjs` rejects the contract unless every mapping
records:

* the old reference and a same-package target reference; another plugin cannot
  satisfy the mapping;
* compatibility basis and the proof still required before use;
* source status, repository-relative source path, package manifest `gitHead`,
  source file-set fingerprint, file count, and byte count;
* target artifact path and file-set fingerprint;
* an independent source build receipt whose source fingerprint and output
  fingerprint match the recorded evidence; and
* runtime evidence for both `Central` and `ModelDesign`, with zero plugin asset
  404s and zero unexplained browser errors.

The policy is `verified-only`. Missing source evidence is always a blocking
condition. A `public/plugins` directory is an observed build artifact, not
editable source, and cannot be used to mark a mapping verified. A fingerprinted
`reconstructed` source directory can have a valid independent build receipt,
but it is not authenticated original source and cannot satisfy this gate.
An asserted `runtime.status: passed` also requires a readable SHA-256-matched
JSON report: schema version 1, `status: passed`, target repo and source/output
fingerprints, and `applications.Central` and `applications.ModelDesign` each
reporting `status: passed`, the exact target package, and zero
`pluginAsset404s`/`unexplainedBrowserErrors`. These fields prevent an absent
or contradicted report from passing; they do not authenticate who ran the
browser or replace inspection of the underlying trace.

The current migration contract records 11 mapped, 0 fully verified and
11 blocked mappings. Candidate published-source trees for `ai-code` and
`model-design` are recorded separately in
`fixtures/modeling-core-source-candidates.json`; candidate presence is not
accepted source evidence for the mapping until its exact target build and
native runtime proof are bound.

| Evidence group | Count | Current blocker |
|---|---:|---|
| `drbar-ex`, `list-tree`, `route-picker`, `img-to-base64` | 4 | `plugin-src/*/src/index.ts` contains bundled-code reconstructions; source and independent build receipts are fingerprinted, but original source provenance, compatibility, and both app runtime proofs are missing |
| `ai-code` | 1 | a published-source candidate and standalone receipt exist, but the receipt output is not the mapped `public/plugins` output; original provenance, compatibility, and native runtime are unverified |
| `model-design` | 1 | a published-source candidate exists, but `runtime-model@0.2.2` source/build evidence is missing; compatibility and native runtime are unverified |
| `logic-tree-design@0.0.3-alpha.56` | 1 | exact-version published TS/TSX source is independently editable under `plm-web/plugin-src`, with a local build receipt; native Central and ModelDesign integration is still unverified |
| `console-terminal`, `file-to-base64`, `global-util-design`, `layout-design` | 4 | no same-package local target or source evidence |

Run the focused contract and audit regression with:

```bash
cd scripts
node --test tests/harness-modeling-core-audit.test.mjs
```

Rebuild the exact `logic-tree-design` package and refresh its checked build
receipt after local source changes:

```bash
node scripts/record-logic-tree-source-build.mjs
```

This records source and output hashes only after the source build and plugin
output checks succeed. It never marks the browser compatibility gate passed.

The harness exits with an incomplete-audit failure while any mapping remains
blocked. It does not fabricate exact versions or silently substitute another
plugin.

### Native model resource repair candidate

`scripts/repair-native-model-resources.mjs` prepares a separate JSON resource
candidate from
`plm-web/public/plugins/@ibiz-template-plugin/model-design@0.0.3-alpha.122/dist/assets/json/runtime-model`.
Keep these originals read-only: the tool reads them without modifying them,
and the candidate must not be copied back over the published plugin tree.
It only escapes raw LF characters inside JSON strings as `\n`; it does not
replace the parser or tolerate other malformed JSON.

The pinned input inventory is **1414 total JSON files / 17 changed files /
46 quoted raw LF characters / 1397 unchanged files**. The unchanged files
must retain their original bytes. Inventory or input fingerprint drift is a
failure to investigate, not a reason to loosen the expected inventory.
These are resource inventory numbers, not test pass counts.

This workflow requires **Linux with procfs mounted and `/proc/self/fd`
accessible**, including when run in a container. The descriptor-based path
checks need that interface; a non-Linux host must use a Linux environment.
Stop if the prerequisite is missing; do not bypass the checks.

Resource repair and input staging require a private/trusted workspace and
trusted artifact ancestors. Current artifact parents are mode `0775`, owned
by UID `1000` and GID `1000`: both the owning-UID and writable-GID actors/processes
must be trusted, as must same-UID/root writers. Use a cooperative single writer
for each candidate, with no
concurrent UID/GID/root mutation. Private `0700` children cannot prevent
parent-directory writers from renaming them. Linux pinned reads reject observed
changes; they are not an atomic multi-file
snapshot and cannot guarantee detection of a malicious rename between `mkdir`
and the first stat. Arbitrary same-UID/root snapshot/publication guarantees and
replacement-safe rollback are outside this boundary.
Do not change existing artifact directory permissions, originals or production
files to make the workflow run.

The main-confirmed failure/publication contract preserves **all partial or
ambiguous candidates** for inspection: no failure cleanup, `unlink`, `rmdir`
or recursive auto-cleanup. Retry only into a fresh unique destination, never
reuse the failed directory. Receipt publication uses a direct exclusive
`O_CREAT | O_EXCL | O_NOFOLLOW` write and pinned readback, not a temporary-file
publication. **Receipt existence never implies generation or staging success**:
a receipt may remain after a partial write or failed final recheck. Mandatory
read-only consumer verification of the exact receipt and current files is
required before consumption. The main thread reports independent implementation
review approval within this trust boundary. The historical focused and
whole-script regressions below precede the full source/config audit extension;
they do not validate that correction. Fresh post-extension evidence is recorded
separately. Historical receipts alone do not establish the extended audit
contract, and script PASS is not native editor or production acceptance.

Run generation, read-only receipt verification and regressions from the
workspace root, with Node.js 20 or newer. The example names a unique candidate
directory explicitly so verification consumes this generation's receipt:

```sh
export WORKSPACE_ROOT=/home/my/workspace/ainfra/aibiz
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

Before any future copying into a separate candidate or building from these
resources, rerun `--verify-receipt` against that exact candidate receipt.
Verification is read-only: it rechecks the current original fingerprint,
every LF edit/offset/record/hash, and the current copy's JSON and file-set
fingerprint. A stale or tampered receipt, changed original, or changed copy
must stop consumption; do not rely only on the receipt's recorded status.
The verifier does not modify originals, resources or the persisted receipt,
and `--verify-receipt` cannot be combined with `--output`.

The equivalent focused alias is `npm run test:native-resources --prefix scripts`.
The whole `npm test --prefix scripts` includes this suite through
`tests/*.test.mjs`; neither command replaces the native browser acceptance gate.

With no `--output`, each repair run creates a fresh
`.artifacts/native-resource-repair/repair-<timestamp>-<uuid>/` containing
`resources/` and `receipt.json`; existing destinations must not be overwritten.
Use the receipt path printed by that invocation, not a shared or historical
receipt. It binds the input/output file-set fingerprints, per-file SHA-256,
parse results and LF edits. Record that path together with the commands,
execution times and exit codes for the focused and whole scripts test runs.
Each new run needs its own confirmed results; the stage-specific evidence below
does not automatically cover later code changes or invocations.

The receipt contract is `native-model-resource-repair-candidate`, with
`status: prepared-not-accepted`, `acceptedForProduction: false` and
`runtimeModelSourceRecovered: false`. JSON parseability is only a resource
candidate check: it does not recover `runtime-model@0.2.2` editable source or
its independent build evidence, accept a plugin mapping, or prove native
Central/ModelDesign edit/save/reload. Those source and runtime gates remain
unresolved.

Successful consumer verification returns
`status: verified-resource-candidate-not-accepted` and
`resourceIntegrityVerified: true`, while `acceptedForProduction` and
`runtimeModelSourceRecovered` both remain false. This integrity result does
not upgrade the persisted `prepared-not-accepted` receipt, authenticate missing
source, or authorize a production copy/build.

Observed resource-only receipt:
`.artifacts/native-resource-repair/repair-2026-10-05T17-27-50-342Z-71e3bbb8-848a-4b21-a4f4-8c68e2925498/receipt.json`.
It records the pinned inventory and the following file-set fingerprints; this
is evidence of a prepared candidate, not a test or deployment acceptance result.

| Receipt field | Observed value |
|---|---|
| `generatedAt` (UTC) | `2026-10-05T17:27:50.464Z` |
| Workstation local equivalent (+08:00) | `2026-10-06T01:27:50.464+08:00` |
| Input file-set SHA-256 | `138c8f08d260037c0687cf2c255d85f27a2d02a82f234d2c9414ba2356155797` |
| Output file-set SHA-256 | `45f5a9acfc8bf181e05f5ae1e15088c1c8b7ec1f44dba5a172dfc4bb7e315211` |
| Candidate status | `prepared-not-accepted` |
| Production acceptance / runtime-model source recovered | `false` / `false` |

From the workspace root, recheck that persistent candidate with:

```sh
node scripts/repair-native-model-resources.mjs --verify-receipt \
  .artifacts/native-resource-repair/repair-2026-10-05T17-27-50-342Z-71e3bbb8-848a-4b21-a4f4-8c68e2925498/receipt.json
```

The main thread independently verified this exact persistent candidate:
output fingerprint
`45f5a9acfc8bf181e05f5ae1e15088c1c8b7ec1f44dba5a172dfc4bb7e315211`,
`status: verified-resource-candidate-not-accepted`, and both acceptance/source
recovery flags false. The UTC stamp above is the receipt's generation time,
not an asserted time for the later consumer or test runs.
`regression-20261006` is a workstation +08:00 directory name, not a claim that
those runs occurred on UTC 2026-10-06.

**Confirmed resource generator and consumer regression before input staging**

The main thread confirmed the completed resource generator/consumer regressions below.
Commands run from `scripts/`. These log paths were overwritten within this run
with that run's final versions; the counts below describe the resource-repair
phase, not the subsequently added input-staging tool. Other historical evidence
in this document remains unchanged.

| Command | Confirmed prior resource run | Evidence log |
|---|---|---|
| `npm run test:native-resources` | 77 passed, 0 failed, 0 skipped; 1.22 s | `.artifacts/native-resource-repair/regression-20261006/resource-tests.log` |
| `npm test` | 768 passed, 0 failed, 0 skipped; 39.77 s | `.artifacts/native-resource-repair/regression-20261006/scripts-tests.log` |

The focused suite includes the complete real 1414-file resource tree, per-file
receipt checks, and read-only consumer rejection of stale/tampered evidence.
These are script/resource regression results only: production acceptance remains false,
`runtime-model@0.2.2` source/build evidence remains missing, and native
Central/ModelDesign browser acceptance is not claimed.

### Isolated model-design inputs: build still blocked

`scripts/prepare-native-model-design-inputs.mjs` is a separate staging step,
not an extension of the resource PASS verdict. It takes the exact repaired
receipt through `--repair-receipt`, revalidates it, and copies the audited
`model-design@0.0.3-alpha.122` source, manifest and build configs unchanged into
a new `.artifacts/native-model-design-inputs/<new>/package/`.
The source originals and repaired resource candidate remain read-only.

Review found a P2 configuration-drift gap in the earlier audit: pinning `src/`
and the manifest alone did not independently pin all staged root configs.
The strengthened full source/config baseline declares **72 files**: 68 under
`src/` plus `package.json`, `tsconfig.json`, `ibiz.config.cjs` and `CHANGELOG.md`.
It adds `source.audit.inputFiles: 72` and pins `source.audit.inputFingerprint` to
`a2eff77ed8cdefebfa24636620baa77b8e067458d92033edb0492465ca21ed06`.
The main thread has now confirmed fresh generation and consumer verification
against these audit pins, plus final focused 335/335 and whole-script 1013/1013
regressions below. This verifies candidate input integrity and script regression,
not a plugin build or native acceptance. The previous 905-test result is
historical.

Previous input receipts lacking these audit fields are historical evidence,
even if their top-level source fingerprint matches. The numeric
`schemaVersion: 1` remains unchanged and alone does not establish compatibility
with the extended audit. Do not manually upgrade an old receipt or reuse its
candidate. Generate a fresh unique input tree with the updated tool and verify
its new receipt against the exact verified resource repair receipt before use.
Preserve older/failed candidates and all existing safety boundaries.

Resources are staged at `package/public/assets/json/runtime-model`, not
`package/src/assets/json/runtime-model`. This is the declared input layout for
the installed `@ibiz-template/cli-core@0.3.30` default CopyFilePlugin:
`public` is copied into `dist`, `es` and `lib`. The installed package's
`dist/define-config.js`, `dist/rollup/bundle-option/bundle-option.js` and
`dist/rollup/module-option/module-option.js` establish that default.
The separate hook experiment below does not prove resource copying in a
complete plugin build, typecheck or native acceptance.

With the same Linux `/proc/self/fd` and Node prerequisites, run from the
workspace root. This example explicitly checks the intentional exit code 2
after both steps; it must not be interpreted as a successful build:

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

The new directory contains `package/` and its own `receipt.json`; existing
outputs must not be overwritten. Verification requires both the new input
receipt and the exact resource repair receipt, and is read-only.
Apply the trusted-ancestor and preserve-on-failure contract above; even a
present `receipt.json` is not permission to consume an unverified input tree.
Generation declares `prepared-build-blocked`; verification returns
`verified-inputs-build-blocked`. Both intentionally exit 2, with `buildReady`,
`acceptedForProduction` and `runtimeModelSourceRecovered` false.

The first observed staging inventory was **72 source/config files + 1414
resources = 1486 package files**, recorded at `2026-10-05T17:51:55.228Z` (UTC)
in `.artifacts/native-model-design-inputs/inputs-20261005-isolated-first/receipt.json`.
That receipt predates the explicit `mapping` fields and the full source/config
audit extension. It is historical inventory evidence only, not valid evidence
for the current verifier. Regenerate into a fresh directory and verify the new
receipt. New receipts must record the extended audit as well as
requested `0.0.3-alpha.90`, candidate `0.0.3-alpha.122` and
`compatibility: not-verified`; staging does not resolve that version gap.

The main thread previously generated and consumer-verified this later historical
receipt under the earlier audit contract:
`.artifacts/native-model-design-inputs/inputs-2026-10-05T18-05-51-886Z-58fccf70-dc78-4ca8-a573-aae052d049fa/receipt.json`,
with `generatedAt: 2026-10-05T18:05:52.357Z` (UTC). It records that explicit
requested/candidate mapping and the same **72 + 1414 = 1486** inventory,
package fingerprint
`f01090611643590f974a5ebacbf1b928f5ce29bb47fcbc9e7b459c1c16154538`.
Generation and verification completed with the expected blocked exit 2, not
build success: the persisted status is `prepared-build-blocked`, the consumer
returns `verified-inputs-build-blocked`, and `buildReady`,
`acceptedForProduction`, `runtimeModelSourceRecovered` remain false.
Its `source.audit` lacks `inputFiles` and `inputFingerprint`; the matching
top-level source fingerprint does not fill that gap. Preserve this receipt as
historical evidence and generate/verify a new one with the updated tool.
This observation does not establish the extended baseline, all failure-path
safety regressions or native compatibility.

The historical CLI consumer result under the earlier audit contract is logged at
`.artifacts/native-model-design-inputs/regression-20261006-safety/verify-cli.json`.
It records `verified-inputs-build-blocked` and `inputIntegrityVerified: true`;
the main thread confirmed actual exit 2 as expected, with no skipped verification.
This does not execute or accept a build, and its `inputIntegrityVerified: true`
does not validate the extended full source/config audit. Its `generatedAt` is
the input receipt's generation time, not a separate consumer execution timestamp.

Fresh input receipt after the full source/config audit extension:
`.artifacts/native-model-design-inputs/inputs-20261006-config-pinned-first/receipt.json`,
generated at `2026-10-05T18:35:02.328Z` (UTC). The `20261006` suffix uses the
workstation +08:00 date. The main thread confirmed generation and verification
each returned the intentional exit 2. The receipt and CLI captures were
read-only inspected: `source.audit.inputFiles: 72`, `source.audit.inputFingerprint`
equal to `a2eff77ed8cdefebfa24636620baa77b8e067458d92033edb0492465ca21ed06`,
and **1486 = 72 + 1414** staged files with unchanged package fingerprint
`f01090611643590f974a5ebacbf1b928f5ce29bb47fcbc9e7b459c1c16154538`.
Generation and consumer captures are respectively
`.artifacts/native-ai-code-deployment/regression-20261006/model-design-generate-cli.json`
and
`.artifacts/native-ai-code-deployment/regression-20261006/model-design-verify-cli.json`;
their parent name does not change the model-design evidence scope.
Persisted status is `prepared-build-blocked`; the consumer returns
`verified-inputs-build-blocked`, `inputIntegrityVerified: true`.
`buildReady`, `acceptedForProduction` and `runtimeModelSourceRecovered` stay
false, and requested alpha.90 / candidate alpha.122 compatibility remains
`not-verified`. This establishes candidate input integrity, not build readiness,
source recovery or native acceptance. Reverify before later consumption.

A real installed CLI CopyFilePlugin hook experiment ran separately from
`2026-10-05T17:55:21.902Z` to `2026-10-05T17:55:23.353Z` (UTC).
Its receipt is
`.artifacts/native-model-design-inputs/asset-copy-experiment-LbUEZg/receipt.json`;
the log is
`.artifacts/native-model-design-inputs/regression-20261005-isolated/cli-asset-copy-realpath.log`.
It copied staged `public` assets to fresh experiment `dist`/`es`/`lib` trees:
each contained 1414 files, all passed `JSON.parse`, and each matched repaired
fingerprint `45f5a9acfc8bf181e05f5ae1e15088c1c8b7ec1f44dba5a172dfc4bb7e315211`.
The status is `asset-copy-hook-pass-not-plugin-build`,
`fullPluginBuildExecuted: false`, `acceptedForProduction: false`.
This experiment does not remove `built-dist-and-es-resource-copy-not-verified`.

Remaining blockers are complete `runtime-model@0.2.2` source/build config,
isolated dependency lock/resolution/install, loader delivery,
`built-dist-and-es-resource-copy-not-verified`, local typecheck/build, and native
version compatibility plus edit/save/reload acceptance. No install or build is
executed by either CLI mode. Run `npm run test:native-model-design-inputs --prefix scripts`
and `npm test --prefix scripts` for staging regression. The prior resource
regression does not validate this new workflow.

**Historical main-confirmed focused safety regression before audit extension**

The main thread confirmed **224/224 passed, 0 failed, 0 skipped**:
93 resource tests + 118 input-staging tests + 13 source-evidence tests.
The inspected log is
`.artifacts/native-model-design-inputs/regression-20261006-safety/focused-tests.log`;
its summary records 224 tests/pass, zero failures/skips/cancellations and
`duration_ms: 7451.185517`. The component counts are main-confirmed; they are
not carried forward from the historical resource phase. Reproduce the combined
focused entry from the workspace root:

```sh
node --test \
  scripts/tests/repair-native-model-resources.test.mjs \
  scripts/tests/native-model-design-inputs.test.mjs \
  scripts/tests/native-plugin-source-evidence.test.mjs
```

The first whole `npm test --prefix scripts` run is main-confirmed and log-checked:
**902/902 passed, 0 failed, 0 skipped**, `duration_ms: 38196.672604`, at
`.artifacts/native-model-design-inputs/regression-20261006-safety/scripts-tests.log`.
This is an intermediate result, not the final deployment regression: the main
thread added three standard source-overlay checks afterward and reports their
separate focused entry as 19/19 PASS. At that stage the final whole-suite rerun
was pending; neither 902 nor earlier counts were its result.

The subsequent final whole-suite run for that prior revision is main-confirmed
and log-checked:
**905/905 passed, 0 failed, 0 skipped**, `duration_ms: 40025.966779`
(40.03 s), at
`.artifacts/native-model-design-inputs/regression-20261006-safety/scripts-tests-source-routing.log`.
This supersedes the pending final-run status, not the historical 902 evidence.
These historical results do not cover the subsequent full source/config audit
extension or new deployment tooling. No plugin build, missing source recovery,
production acceptance or native edit/save/reload is established.

**Post-extension main-confirmed safety/source focused regression**

The main thread confirmed **231/231 passed, 0 failed, 0 skipped** for the
resource/input/source-evidence subset, reproduced by the combined focused
command above. It is not the whole suite or a count of the separate ai-code
publisher tests. The final combined focused run includes this subset plus three
routing and 101 ai-code tests.

**Final post-extension regression, main-confirmed and log-checked**

| Entry | Result | Evidence |
|---|---|---|
| Combined focused | 335/335 PASS, 0 failed/skipped; `duration_ms: 12616.6567` | `.artifacts/native-ai-code-deployment/regression-20261006/focused-tests.log` |
| Whole `npm test --prefix scripts` | 1013/1013 PASS, 0 failed/skipped; `duration_ms: 40303.037063` | `.artifacts/native-ai-code-deployment/regression-20261006/scripts-tests.log` |

The main-confirmed focused breakdown is 93 resource + 125 model-input +
13 source-evidence + 3 routing + 101 ai-code = 335. Reproduce its entry:

```sh
node --test \
  scripts/tests/repair-native-model-resources.test.mjs \
  scripts/tests/native-model-design-inputs.test.mjs \
  scripts/tests/native-plugin-source-evidence.test.mjs \
  scripts/tests/native-standard-source-platform.test.mjs \
  scripts/tests/native-ai-code-deployment.test.mjs
```

These replace the pending post-extension script results, not historical 905
evidence or the remaining build/native/source-recovery gates.

The separate ai-code deployment workflow is documented in
[NATIVE-AI-CODE-DEPLOYMENT.md](NATIVE-AI-CODE-DEPLOYMENT.md).
That candidate evidence does not accept model-design build or native runtime.

Runtime API evidence must be qualified by endpoint and required-check set:

| Endpoints and reported upstream | Result | Report |
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

The failed default run was `2026-10-05T18:05:30.804Z` to
`2026-10-05T18:05:33.329Z` (UTC). Both apps fail
`configs-same-session-get`, `configs-update-get`, `configs-other-session-update-get`,
`configs-reset-get`, `configs-roundtrip`, and the first `cleanup-get-1`, reflecting
stale immediate/same/already-authenticated-session cache reads. Final cleanup
summaries pass, but the first cleanup-read failures remain recorded; cleanup
does not convert that historical run into PASS. Its 48 checks include six extra
cleanup-retry checks triggered by failure, versus 42 on a successful run;
retain each report's actual totals.

The later standard-entry report is independently main-confirmed and read from
JSON: `2026-10-05T18:17:00.722Z` to `2026-10-05T18:17:03.295Z` (UTC), exit 0,
21 checks per app, 42/42 PASS. Only the two standard native entry containers were
recreated with `docker-compose-modeling-native-source-platform.yml`; the main
thread confirmed healthy entries and served nginx `$native_auth` pointing to
`ibiz-ebsx-allinone-local:30000`. Business ModelAPI and UAA upstreams remain
`modelingservice:32002` and `ibizlab-uaa-api:32666`; models/plugins were not
upgraded. The candidate-only overlay remains separate. Exact scoped deployment
and rollback commands are in
[NATIVE-SOURCE-PLATFORM-ROUTING.md](NATIVE-SOURCE-PLATFORM-ROUTING.md).

Earlier required runtime evidence is 17/17 PASS at
`.artifacts/modeling-runtime-source-routing-20261006/report.json`,
timestamp `2026-10-05T18:17:00.809Z` (UTC). It checks the existing business stack:
ModelAPI `32002/ibizmodeling/modelapi` and the web/auth proxy on `32003`, not native
editor operations. The earlier standard-cutover portal report is 9/9 PASS at
`.artifacts/external-ui/standard-source-routing-20261006/report.json`,
`2026-10-05T18:17:00.922Z` to `2026-10-05T18:17:02.095Z` (UTC), with zero
console/HTTP/page/request errors.

Fresh source-bound runtime reruns are main-confirmed and JSON-checked. Standard
API runs `2026-10-05T18:33:45.942Z` to `2026-10-05T18:33:48.515Z` (UTC),
exit 0, 21 checks/app; both cleanup summaries pass, anonymous cleanup is not needed.
Required business runtime passes 17/17, exit 0, at
`.artifacts/modeling-runtime/source-bound-regression-20261006/report.json`,
timestamp `2026-10-05T18:33:46.026Z` (UTC), still covering ModelAPI 32002 and
web/auth 32003, not native editing. Portal passes 9/9 with zero
console/HTTP/page/request errors at
`.artifacts/external-ui/source-bound-regression-20261006/report.json`,
`2026-10-05T18:33:46.107Z` to `2026-10-05T18:33:47.219Z` (UTC).
These runs do not deploy or accept the staged model-design inputs.

The verification portal at `http://127.0.0.1:19323/#?` separately passes 9/9 in
`.artifacts/external-ui/model-design-inputs-safety-20261006/report.json`
(`2026-10-05T18:05:30.925Z` to `2026-10-05T18:05:32.057Z`, UTC), with no
console/HTTP/page/request errors. Its prior 9/9 report remains at
`.artifacts/external-ui/model-design-inputs-regression-20261005/report.json`.
The `safety-20261006` report names are workstation +08:00 names, not UTC dates.
These historical reports remain unchanged. Neither API nor portal evidence
establishes model-design source-build or native editor acceptance.

The latest source-bound native browser acceptance exited 1:
`.artifacts/native-modeldesign/source-bound-regression-20261006/report.json`,
`prerequisiteChecksPassed: false`, `pluginAssetsVerified: false`, eight failing
stages. Central's four and ModelDesign's eight pinned plugin `package.json`
requests return 404, including
`/modeldesign/plugins/@ibiz-template-plugin/global-util-design@0.0.3-alpha.87/package.json`.
Central navigation rejects `FetchDefault` as `DATAQUERY`, not remote `FETCH`;
ModelDesign cannot initialize its login/home and reports four unexplained browser
errors. The exact package inventory is in the routing guide. Native editor
operations, save and fresh-session readback remain unaccepted; no full completion
or runtime-model source recovery is claimed.
The earlier eight-stage failure remains at
`.artifacts/native-modeldesign/2026-10-05T18-17-01.168Z/report.json`;
the new API/script PASS does not erase either native FAIL.
The self-contained workflow is in
[NATIVE-MODEL-DESIGN-BUILD-INPUTS.md](NATIVE-MODEL-DESIGN-BUILD-INPUTS.md).

### ibiz-service-hub backend receipt

The latest non-overwriting receipt is
`ibiz-service-hub/scripts/records/backend-local-build-final-20260928.json`.
Older receipts remain unchanged. The receipt was produced from commit
`010b6f6bfb601b1191a2defca4624ad2f66a6a97` with `git_dirty: false`.
That is the source provenance of the recorded JARs and images, not the current
repository HEAD. The receipt itself was committed by
`5ffc8077ebb4c4192f43245d0f5ce5201b91008f`.
It records the Maven/Java base image digests, artifact hashes, image IDs and
`linux/arm64` platform. The earlier clean-tag images remain the smoke-verified
historical baseline until the final-tag images pass the same runtime gates.

| Image | Image ID | Artifact SHA256 |
|---|---|---|
| `aibiz/ibiz-ebsx-allinone-rt:8.1.0.584.1-local-clean-20260928` | `sha256:8d6ec725d83b030b534afaf087f08a6ad9fc23ffd374ba7a27c0cfc3bf0670da` | `db2f18e4e43f0489cc2c40b145b626a24d28076295278e193e86b22f96212aad` |
| `aibiz/ibiz-ebsx-gateway:8.1.0.584.1-local-clean-20260928` | `sha256:60187c28d0f800bed325344bb9e640a8f0fe6343f6023689b650af5032032a2a` | `a6aba9b82f8f6ae498d66e981b94852dffb77c9f478844771e8e16f76fe333de` |
| `aibiz/ibiz-ebsx-allinone-rt:8.1.0.584.1-local-final-20260928` | `sha256:ad6dac86cbf303551b734616f034ba586c2dfd4b865e26d8c21f37eaf3ebda31` | `1202b01ba43ff983a9802c43945f683d99d1339bbf165c533464d9bd642fceed` |
| `aibiz/ibiz-ebsx-gateway:8.1.0.584.1-local-final-20260928` | `sha256:b8c6faf2f7431851f741415036b4dd5ccc27fbc4497a52412da0c90476508b46` | `1e5e011048eb74f16cfc604480608794217ed4103a12f562150cd6fe1991e5d7` |

Image IDs here refer to locally built images, not registry repo digests; the
receipt correctly records empty `repo_digests` for the unpublished final images.

## Not ready

| Component | Running as | Source on disk | Missing |
|---|---|---|---|
| iBizModeling Central/ModelDesign core model | no verified original source or exact extension set | `plm/model` is only the PLM model and is not a substitute | latest valid extension inventory: `originalSourceCandidates: 21` (not authenticated sources), `originalExtensionsVerified: 0`, `coreExactRequested: 11`, `coreExactComplete: 1`; native browser acceptance failed: `.artifacts/native-modeldesign/2026-09-29T21-22-39.489Z/report.json` reports a PLM view, service 401 and no verified edit/save/reload |
| Task 30088 | source-built arm64 image `aibiz/task7:source-built`, next to the prebuilt `task7` reference | `task7/SAPAAS` + `task7/Dockerfile.source` + the pinned dependency closure in `SAPAAS/lib` | dependency verification (200/200 JARs) and source preflight (33,503 Java files) pass, and the whole-tree compile now reports **0 errors**; `ant war` produces `SAPAAS.war` and `Dockerfile.source` builds the runtime image. `SAPAAS/scripts/selftest-source-build.sh` re-runs the whole flow from a pristine clone (WAR invariants, image build, 8/8 path-by-path A/B against the reference container) and last reported `PASS` at commit `b7e0c552`. Remaining limits: interaction is environment-limited because authentication delegates to the external UAC/CAS that the reference deployment also needs, and model publishing plus the DevStudio designer/preview features need ~1.1 GB of vendor design-time assets absent from the recovered webapp tree. Evidence: `task7/SOURCE-BUILD-AUDIT.md`, `task7/.artifacts/source-selftest/receipt.json` |

The four model plugins (`bi-report`, `data-view`, `ai-chat`, and `gantt`) now
have one-to-one local source links in PLM. Their SystemJS-compatible output is
also committed under `public/extras` as the reproducible offline/deployment
fallback, and the PLM build rewrites the runtime import map to those local
versions. The independent 23-plugin Modeling workbench is not evidence of
native ModelDesign integration; the current status remains
`fullyLocalized:false` and `platformIntegration:not-verified`.

## Version record

These are the facts that make "upgrade everything to latest" meaningless, so
they are written down rather than re-derived each time.

There is no single latest, and version numbers alone cannot tell you whether a
package is safe to localize. Two independent checks are needed, because they
catch different things.

First, compiled output: build the hub tree and diff implementation files against
the artifact installed in `plm-web`. That total splits into the files upstream
changed since the hub tree was cut, which a link would drop, and the files the
hub changed on purpose, which are the reason to localize.

| Package | In use | Hub source | Diff vs in use | Missing upstream | Ours | Vendor drift | Status |
|---|---|---|---|---|---|---|---|
| `@ibiz-template/core` | 0.7.41-alpha.78 | 0.7.41-alpha.78 `packages/core` | 0 | 0 | 0 | none | linked |
| `@ibiz-template/model-helper` | 0.7.41-alpha.86 | 0.7.41-alpha.86 `packages/model-helper` | 0 | 0 | 0 | none | linked |
| `@ibiz-template/runtime` | 0.7.41-alpha.86 | 0.7.41-alpha.86 `packages/runtime` | 10 | 0 | 10 | none, after pinning `dingtalk-jsapi` | linked |
| `@ibiz-template/vue3-util` | 0.7.41-alpha.86 | 0.7.41-alpha.86 `packages/vue3-util` | 1 | 0 | 1 | none | linked |
| `@ibiz-template/vue3-components` | 0.7.41-alpha.78 | 0.7.41-alpha.78 `components/ibiz-next-vue3` | 18 | 0 | 18 | none, after pinning four vendor packages | linked |
| `@ibiz-template/devtool` | 0.0.14 | 0.0.14 `plugins/ibiz-template-devtools` | 17 | 0 | 17 | none, after pinning `@monaco-editor/loader` | linked |
| `@ibiz-template/theme` | 0.7.39 | 0.7.39 `packages/theme` | 0 | 0 | 0 | none, ships no bundle | linked |
| `@ibiz-template/web-theme` | 3.11.0 | 3.11.0 `components/web-theme` | 0 | 0 | 0 | none | linked |
| `@ibiz/model-core` | 0.1.84 | 0.1.84 `models/model-core` | 0 | 0 | 0 | none, types-only; no SystemJS bundle | linked |
| `@ibiz/rt-model-api` | 0.2.82 | 0.2.82 `models/rt-model-api` | 0 | 0 | 0 | none, app-bundled; no SystemJS bundle | linked |

Second, what vendor code reaches the browser, which a package can ship two ways.
Either esbuild copies it into `dist/index.system.min.js`, the file the import
map serves, or the published tree carries a `node_modules` directory of
relative-import copies beside its compiled output, which the app build bundles
as written. Both come from whichever `node_modules` ran the build, so two source
trees can agree file for file and still hand the browser different third-party
code. Neither is visible in an `out/` or `es/` diff, because the collector skips
vendor directories on purpose: they are not iBiz source. `runtime` reached `missing upstream = 0` on 2026-09-26 and the
first check alone then said link it, but the rebuilt bundle had silently
swapped `dingtalk-jsapi` 3.2.0 for 3.1.0. Nothing was wrong with either source
tree: the package asks for `^3.0.41`, and three workspaces have each resolved
that range to something different, 3.0.41 in `plm-web`, 3.1.0 in the hub, and
3.2.0 in the build upstream published. No `out/` diff can show this. Byte
comparison cannot either, since the two minifier toolchains are not reproducible
against each other, so the check compares the set of inlined packages and their
versions instead.

`vue3-components` proved the second route on 2026-09-27: its `dist` bundle
inlines nothing, so the first check reported a clean row while the installed
`es/node_modules` held four packages at different versions, one of which
differs in real code: the hub resolved `modern-screenshot` to 4.6.8, which adds
a CSS layer-rule check that the served 4.6.7 copy does not have. `devtool` was
held the same way, on
`@monaco-editor/loader`. Both are pinned now, the pin scoped to the package
whose artifact is being replaced so it cannot move a linked neighbour.

A package whose artifact carries neither route has no vendor code to swap, and
the row says so; it stays held while the hub tree is absent, because then no
comparison has run at all.

Counts were measured 2026-09-26 and are frozen in `LINK_STATE_BY_PACKAGE` in
`localize-base-packages.mjs`, which refuses a row whose two counts do not
partition the diff. Re-measure with `--measure` after any hub sync.

Two consequences worth stating plainly:

* Across the fifteen steps from `core` `0.7.41-alpha.63` to `0.7.41-alpha.78`,
  published output changed in exactly one file: the `.xls`/`.xlsx` mime case,
  now ported into the hub source. That train is quiet, which is why
  prerelease-letter distance is a poor proxy for risk here.
* The hub is not simply behind. `runtime` carries 9 files of our own
  localization, so a naive bump over the hub tree would overwrite real work.
  The two sets are disjoint, so the merge is additive rather than a conflict,
  but it has to be a merge.

Hub directory names do not track package names: `@ibiz-template/vue3-components`
lives under `components/ibiz-next-vue3`, and `@ibiz/model-core` under
`models/model-core`. Both the ledger and `localize-base-packages.mjs` resolve
this by indexing every manifest in the hub by the name it declares, so
`hubDirectory` in the JSON output tells you which tree each source version came
from.

Several independent version trains are in play and they do not move together:

* Frontend base packages: `0.7.41-alpha.x`, with `plm-web` itself at `0.7.41-rc.8`.
* Platform backend: the formal allinone container remains `8.1.0.570.12.250807` and the formal gateway remains `8.1.0.377-b2-arm64`; the clean local candidates are tagged `8.1.0.584.1-local-clean-20260928`, matching the Maven Docker configuration `8.1.0.584.1`. The previously recorded `8.1.0.578.10` is not the current formal allinone tag.
* Web runners: formal `plmweb` remains `9.0.7.41-alpha.55`; the Modeling Web
  service in `docker-compose-dev.yml` now uses the local
  `aibiz/modelingweb:local` image (`linux/arm64`, digest
  `sha256:c97051540e65c441f4a0084c920d83c5dd62dde0faaedc864b13bac229789549`).
  The previous Modeling Web runner remains available only through
  `docker-compose-modeling-remote.yml` as an explicit rollback.
* UAA image: `2.1.9-arm64` (source candidate tree is `2.1.9`).
* Task image: `v124.2.opensource.25082603`.

Two findings that change how upgrades should be judged:

* **Plugin peer ranges are not enforced.** Plugin bundles import the base
  packages as bare specifiers with no version, and SystemJS resolves them
  through `public/extras/json/system-import.json`, which maps each name to a
  single file. So the 68 plugins declaring ranges such as `0.4.12` against a
  `0.7.41-alpha.78` runtime is stale metadata, not a break. The ledger reports
  it as `INFO` and would report a genuine break as `FAIL`.
* **`@ibiz-template/runtime` is now a single local link in the PLM graph.**
  `package.json` and `pnpm-lock.yaml` both point to
  `../ibiz-app-hub/packages/runtime`, whose source version is
  `0.7.41-alpha.86`; the current lockfile has no `0.6.18` runtime entry. The
  previous `web-theme` transitive-version warning is historical and must not be
  used as the current version state.
* **The theme delivery note is expected.** `@ibiz-template/theme` ships no
  SystemJS bundle because it is imported at PLM build time; `npm run ledger`
  reports that fact as an INFO contract note, not as a runtime version
  conflict.

### Repository state caveat

The ledger checks versions, links, and artifacts; it does not replace a clean
checkout check. The current checked-out repositories at the
2026-09-28 audit are:

| Repository | HEAD | Commit | Working tree |
|---|---|---|---|
| `scripts` | `9bc08b16` | `docs: record final harness evidence` | dirty |
| `plm-web` | `80376e6b` | `fix: await local plugin asset copies` | dirty |
| `modelingweb` | `5bd4e9e5` | `docs: record final localization evidence` | dirty |
| `ibiz-app-hub` | `e3a0ec7f` | `chore: align local plugin package version` | clean |
| `ibiz-service-hub` | `5ffc8077` | `test: record final local backend build` | clean |

The dirty trees are intentional evidence/localization work in progress; run
`git status --short` in each repository before creating a release archive.

The backend clean receipt remains intentionally tied to its original source
commit `7b073023`. The final receipt records a separate clean build of
`010b6f6b`; it does not overwrite the old JAR or image hashes.
Re-run `git status --short` in each repository before
creating a release archive. The backend Ready rows now have both a clean build
receipt and a committed verification harness.

## Recommended order

1. Link the base packages from `ibiz-app-hub`. Done for all ten that
   `plm-web` imports, on 2026-09-26 and 2026-09-27. The answer to "raise the
   hub or lower `plm-web`" turned out to be neither: measure compiled output,
   and link only where the hub is behind by nothing. `npm run localize` reports
   it, `--apply` performs it.
2. Complete the model plugin delivery boundary. Done for `bi-report`,
   `data-view`, `gantt` and `ai-chat`: each package is linked to
   `ibiz-app-hub`, built into SystemJS-compatible output, copied to the PLM
   fallback tree, and gated by the source-build contract, plugin harness,
   version check, and production build. The next browser gate should verify
   the running PLM container resolves the same import-map entries.

    `runtime`, `vue3-util` and `vue3-components` were each ported this way,
    every file verified by rebuilding and comparing the emitted output against
    the artifact in use. What that costs in practice, given that the published
    tarballs ship compiled output only and the upstream TypeScript is
    unreachable:

    * Match the published output character for character where you can. The
      gate is a byte comparison, and a reformatted line or a renamed callback
      parameter reads as a behaviour change.
    * Type-only differences do not show up in output. `as Blob` and a non-null
      assertion were needed because our `model-core` is older and types two
      fields more strictly; both are erased at compile time, so the emitted file
      still matched.
    * A port that reproduces published output can still be wrong. Matching
      `platform-provider-base.js` meant importing `exportData` from the
      controller barrel, which creates a cycle that leaves `ChartService`
      extending undefined and stops twelve test files collecting. That file is
      now a declared divergence, and `--measure` reports declarations that stop
      matching.
    * Where a newer authored tree exists, use it only after proving the
      published output has not moved since. Diffing the installed artifact
      against the newer build isolates what came later, and a file whose two
      trees agree can be taken from the authored source rather than rewritten
      from minified output. Where they disagree, the compiled artifact is the
      only authority.
    * Moving source between packages is a real edit, not a rename. Upstream
      moved `panel-container-group` out of `vue3-util` into both component
      packages and gave it a title bar toolbar; leaving the old copy behind
      would have registered a container with no toolbar.
3. Switch the formal Modeling Web service to the verified local image. Done:
   `docker-compose-dev.yml` is local by default, the plugin-sidecar and browser
   smoke pass, and `docker-compose-modeling-remote.yml` is a tested rollback.
   The remaining Modeling blocker is the exact Central/ModelDesign core model
   source and extension set, which stays fail-closed.
4. Execute and harden the existing allinone/gateway build wrappers and Compose
   overlays. Done for the local arm64 candidates: the 83-module Maven reactor,
   artifact hashes, image IDs, architecture/tag receipt, backend contract
   (`8/8`), smoke contract (`4/4`) and real source-platform smoke (`7/7`) all
   pass. The latest evidence is
   `ibiz-service-hub/scripts/records/backend-local-build-final-20260928.json`.
   The wrapper/test changes are committed and the final-tag images were rebuilt
   from a clean source tree; the formal `8.1.0.570.12.250807`/`8.1.0.377-b2-arm64` images remain a
   separate compatibility baseline.
5. Complete the Task source build and runtime acceptance. **Done**: the recovered
   tree compiles with 0 errors, `ant war` produces `SAPAAS.war`, and
   `task7/Dockerfile.source` builds `aibiz/task7:source-built`.
   `task7/SAPAAS/scripts/selftest-source-build.sh` gates the whole flow from a
   pristine clone (WAR invariants, image build, 8/8 A/B probes against the
   `task` reference container) and last reported `PASS`.
   Two limits remain and are recorded in `task7/SOURCE-BUILD-AUDIT.md`: no
   interactive login is possible here because authentication delegates to the
   external UAC/CAS that the reference deployment also depends on, and ~1.1 GB
   of vendor design-time assets (model publishing, DevStudio designer/preview)
   are not present in the recovered webapp tree.

## External UI Regression

`harness-ui-server.mjs` is the project-owned local verification portal for
`http://127.0.0.1:19323/#?`. It performs real server-side checks against the
PLM Web page, Modeling Web page, Modeling documentation page, and Modeling
plugin health endpoint. The Compose `harness-ui` service starts it on the
`modeling` profile, so the portal follows the local stack instead of depending
on an unreproducible external process:

```bash
docker compose \
  -f plm/deploy/compose/docker-compose-dev.yml \
  --env-file plm/deploy/compose/.dev \
  --profile modeling up -d harness-ui
npm run test:external-ui --prefix scripts
```

The root portal returns `503` while any required dependency is unavailable;
therefore the required browser harness cannot pass on a blank or partial
page. `external-ui-harness.mjs` records the URL, reachability, page title,
browser errors, failed HTTP requests and a screenshot.

Automatic mode still skips when the project portal is intentionally not
started. Required mode fails when the service is unavailable and must be used
for an acceptance run that requires this UI.

The project-level `npm run test:baseline` includes this automatic check and
passed on 2026-09-28. Its evidence is
`.artifacts/harness-baseline/20260928-142935/`; the external UI line in that
report is also an explicit unavailable skip. The final deployed Modeling Web
smoke passed all five phases and is recorded at
`.artifacts/modelingweb/final-regression-20260928-rerun/report.json`.

## Audit Refresh

The current version and plugin evidence was regenerated on 2026-09-28:

| Evidence | Result | Report |
|---|---|---|
| Version ledger | `failed: false`; 10/10 packages linked; 73 pinned plugins; 365 constraints; 0 import-map problems | `.artifacts/version-ledger/20260928-current-rerun/version-ledger.txt` |
| Plugin localization | 5/5 pass; 799 hardcoded CJK warnings; completeness not verified | `.artifacts/plugin-localization/2026-09-28T08-46-18-181Z/report.json` |
| Plugin bilingual/build | 11/11 steps pass; input snapshot stable; browser/upstream completeness unverified | `.artifacts/plugin-bilingual/2026-09-28T08-46-18-328Z-e3c9c253/report.json` |
| PLM plugin contract | 24/24 tests pass | `cd plm-web && corepack pnpm@8.15.9 run plugin:harness:test` |

The plugin reports are intentionally additive; older reports are retained for
historical comparison and are not overwritten. Static localization, source
builds and PLM contracts pass, but browser acceptance, upstream platform
integration and full translation completeness still require separate evidence.

## Side E Live Runtime Provenance Audit

The live ledger was rerun on 2026-09-29 with the running Docker containers:

```bash
cd scripts
node --test tests/version-ledger.test.mjs
node version-ledger.mjs --live --json \
  --report-dir ../.artifacts/version-ledger/20260929-side-e-final-rerun
```

The unit suite passed (`25 passed, 0 failed`). The live ledger completed and
returned exit code `1` because it found real provenance conflicts. The complete
machine-readable report is
`.artifacts/version-ledger/20260929-side-e-final-rerun/version-ledger.txt`.
The static portion still records 10 linked iBiz packages, 73 pinned plugins,
365 checked constraints, and no missing plugin artifacts. The 318 unsatisfied
plugin peer ranges are build-time metadata and are reported as `INFO`; they are
not SystemJS runtime failures.

At the time of the audit, 14 containers were running: 12 primary runtime
entries and two discovered auxiliary smoke/debug entries. The unresolved
runtime findings were:

| Level | Runtime relation | Evidence |
|---|---|---|
| FAIL | `ibiz-ebsx-allinone-local` and `ibiz-ebsx-gateway-local` image IDs match the `verify2` receipt, but the receipt source `e08457c5` differs from current `ibiz-service-hub` `5ffc8077`; both trees are dirty | `ibiz-service-hub/scripts/records/backend-local-build-verify2-20260928.json` |
| FAIL | `plmweb` is running image `sha256:92780fed...`, while the current `aibiz/plmweb:local` tag points to `sha256:f2a117d3...` | live ledger `container plmweb` finding |
| WARN | `plmservice` local image has no source commit receipt or image revision label | live ledger `container plmservice` finding |
| WARN | `modelingservice` has a host/container artifact hash, but no source commit receipt | live ledger `container modelingservice` finding |
| WARN | `modeling-plugins` local image has no source commit receipt or image revision label | live ledger `container modeling-plugins` finding |
| WARN | `modelingservice-source-smoke` and `aibiz-modelingweb-debug-2771273` are old auxiliary containers outside the primary Compose baseline | live ledger auxiliary entries |

The current runtime/source pairs captured by the report are:

| Container | Running image ID | Source HEAD | Provenance state |
|---|---|---|---|
| `ibiz-ebsx-allinone-local` | `sha256:6ecdfa4a...` | `ibiz-service-hub@5ffc8077`, dirty | receipt points to `e08457c5`, conflict |
| `ibiz-ebsx-gateway-local` | `sha256:8207849b...` | `ibiz-service-hub@5ffc8077`, dirty | receipt points to `e08457c5`, conflict |
| `plmweb` | `sha256:92780fed...` | `plm-web@80376e6b`, dirty | bind mounts present; tag mismatch |
| `plmservice` | `sha256:fc7c318c...` | `plm@88a104bb`, dirty | no build receipt |
| `modelingweb` | `sha256:4199c26a...` | `modelingweb@5bd4e9e5`, dirty | bind-mounted dist/source |
| `modelingservice` | `sha256:cbab2c97...` | `ibiz-service-hub@5ffc8077`, dirty | artifact hash only |
| `modeling-plugins` | `sha256:8801449b...` | `modelingweb@5bd4e9e5`, dirty | no build receipt |
| `task` | `sha256:112eb2a1...` | `task7@6873cda8`, dirty | intentional external prebuilt image |

Formal registry images for allinone, gateway and UAA, and the external Task
image, remain explicitly marked as external rather than being presented as
local source builds. No business implementation was changed to produce this
audit. The next corrective ledger actions are to issue a fresh clean backend
receipt for the images currently running, reconcile or recreate the `plmweb`
tag, and add source build receipts for the three local images currently marked
WARN. Until then the live ledger must remain failed.

## Historical local runtime verification (2026-09-29)

The historical Side E conflict above was corrected on 2026-09-29. The backend
receipt for that run is
`ibiz-service-hub/scripts/records/backend-local-build-current-20260929.json`,
built from `ibiz-service-hub@5ffc8077ebb4c4192f43245d0f5ce5201b91008f` for
`linux/arm64`.

The local allinone and gateway containers were recreated from the receipt
images without deleting `ibiz-ebsx-allinone-local-data`:

| Container | Image | Image ID |
|---|---|---|
| `ibiz-ebsx-allinone-local` | `aibiz/ibiz-ebsx-allinone-rt:8.1.0.584.1-local-current-20260929` | `sha256:0e34841f50e9e05d8f49723ff04ae888075828592c87245900f6619537d56da0` |
| `ibiz-ebsx-gateway-local` | `aibiz/ibiz-ebsx-gateway:8.1.0.584.1-local-current-20260929` | `sha256:e96737b49c54dde95930a43148b269f41927e39a451ee009b73d838cc4fbb516` |

The live ledger report is
`.artifacts/version-ledger/20260929-current-local/version-ledger.txt` and
returns `RESULT PASS` with zero `FAIL` findings. Its remaining warnings are
limited to the two intentionally discovered auxiliary containers and missing
build receipts for local images that are already covered by their runtime
artifact or bind-mount checks.

## Rules

* Advance one subsystem at a time, and keep `npm test` green before moving on.
* Install `plm-web` and `modelingweb/app` with pnpm 8.15.9, the version
  declared by both projects and used to write their v6 lockfiles:
  `corepack pnpm@8.15.9 install --frozen-lockfile`.
* Install `ibiz-app-hub` with its declared pnpm 10.13.1 and a frozen lockfile:
  `corepack pnpm@10.13.1 install --frozen-lockfile`. Its v6 lockfile is
  intentional; do not apply the pnpm 8 rule to this workspace.
* Linking collapses two ledger authorities into one directory, so an agreement
  row for a linked package proves nothing. The ledger marks those rows with `*`
  and reports `localized:` instead.
* Record the previous image tag before replacing a container, and keep it until
  the new one has passed the gates.
* Do not promote a candidate container onto a real port before its browser gate
  passes.
* Never run `docker compose down -v`; the MySQL, Task, EMQX and plugin volumes
  hold data that cannot be rebuilt.
