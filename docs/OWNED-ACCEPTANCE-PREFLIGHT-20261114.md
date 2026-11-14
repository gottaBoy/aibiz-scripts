# Owned Acceptance Preflight

Date: 2026-11-14. The original preflight and runtime diagnosis were read-only
filesystem/source reviews. Later scoped frontend source remediation is
identified below. No Docker command, SQL, service request or application
resource lifecycle operation was executed by this preflight. Current
image/network availability is for the root orchestrator to inspect
immediately before execution.

The execution checkpoint below is **reported by the root orchestrator**,
not a live inventory or independently repeated execution by this preflight.
The later frontend verifier results are read-only current-source checks.
Neither category establishes full native or production acceptance.

## Shortest Supported Path

Use **one fresh two-center fixture**, model-derived standalone UAA tables,
fresh resource/account/schema receipts and fresh UAA/backend startup reports.
The retained UAA packaging can pass its current-source static check, but the
old backend packaging cannot. Build the current backend receipt chain first.

Verified SQL backups are available, but there is no maintained adapter that
turns a retired tmpfs fixture's full logical dump into new resource identities
and new launcher receipts. Editing historical resource IDs or importing an
old dump under a new run with textual substitution is not an accepted shortcut.

The old cold-restore/recreation APIs require an existing running owned MySQL
and deployment. Cold restore additionally requires the reviewed owned-volume
profile. They do not recover the three retired tmpfs runs from the November 13
logical SQL archives.

## Retired Resources And Reusable Evidence

The final retirement receipt reports:

`.artifacts/aibiz-resource-relief-20261113-r1/final-report.private.json`

SHA-256:
`1af2339d3cc458987b3d5643f6920a81536e4364c6ff07eff1edf2c2704635ed`

At its completion, 26 owned and 247 historical containers were removed;
the three owned internal networks were removed; no volumes were removed;
zero owned running/related stopped containers remained. These are historical
observations, not a new live inventory.

The successful logical backup/restore evidence is **`mysql-attempt-3`**, not
the earlier failed attempts. Its aggregate receipt is:

`.artifacts/aibiz-resource-relief-20261113-r1/mysql-attempt-3/mysql-backup-report.private.json`

SHA-256:
`ad0bb66d6f7503deab638dc893006987709b206b8f80d8311bc241fe91f7189f`

All three complete dump files were rehashed during this preflight:

| Run | Bytes | `<run>.all-databases.private.sql` SHA-256 |
| --- | ---: | --- |
| `25dd6a7232c7` | 79,405,061 | `f1b66632e4ca654af07eb1416bb064d61cf27130b616a55c23c93062305c3cc0` |
| `96ff5681e447` | 123,339,135 | `5e0f79262eb17519327f2816d015a472acf83f03c03619f23e63cea4ed006e09` |
| `5d3585516a77` | 162,295,251 | `493452e21341f47623fcb3018a129cb0b5919725cdb3c16eb97f487b40855912` |

Each run has `.backup.private.json`, `.restore-verified.private.json`,
normalized app source/restored dumps, normalized grant source/restored dumps,
and exact restore-helper removal evidence in that directory. App/schema and
grant hashes matched after the isolated restore. This preflight also rehashed
the `25dd6a7232c7` normalized source/restored pairs: both app dumps remain
`751fbbcb4746bfb0067055037c6a5b4ec33d6b012e27ef125f6ab692824a0df0`,
and both grant dumps remain
`4f8b1a8c092ea5365a99bb651c8e65331604057abd42e37fa6a57be8b5b77d01`.

The dumps include authentication material and old test data. Do not print,
commit, selectively copy configuration IDs from, or broadly replay them into
shared MySQL. `25dd6a7232c7` also contains partial editor seed state and
model/version effects from previous attempts; restoring it does not produce
an empty fresh baseline.

The retirement helper `backup-mysql.mjs` is a one-shot historical tool that
backs up live old container IDs, stops sources and refuses reused output.
It is **not** a generic restore entrypoint and must not be rerun.

## Static Input Checks

For historical `25dd6a7232c7`, these owner-private files still exist:

- `manifest.json`
- `credentials.private.json`
- `owned-resources.json`
- `isolated-sql-report.json`
- `application-accounts-registry-r1/accounts.private.json` and `report.json`

`readApplicationAccountInput` passes its current static manifest/generator/
private-file checks. This proves retained account input integrity only, not
that its accounts or containers currently exist. Old SQL/UAA/backend reports
bind the removed MySQL/network/container IDs and must not be reused as new
startup evidence.

### UAA Packaging

Retained packaging input:

`.artifacts/standalone-uaa-source-runtime/runtime-mvIM6i/report.json`

It binds:

- Build: `.artifacts/standalone-uaa-source-build/build-pQAd4R/report.json`
- Image ID:
  `sha256:6894c8abaec1d1e90860c39c9af855741b8e04950619b595f9c64675ce1e151c`
- Maintained source fingerprint:
  `3381e2018bc371a03ae57ee2ae5ebc6ecda7ae6cfdb072d5e77e1347b6819ecb`

The current `assertCurrentSource(build)` check passed. Image existence,
byte-binding replay and actual UAA login/security still must be freshly
verified by the root. The old `uaa-runtime-registry-uaa-r2` report is not a
retained live deployment.

### Backend Packaging Blocker

Historical image receipt:

`.artifacts/backend-source-images-config-registry-20261111-r1/report.json`

It binds package receipt
`.artifacts/backend-source-package-config-registry-20261111-r1/report.json`,
which binds permission receipt
`.artifacts/modeling-permission-config-registry-20261111-r1/report.json`.

Read-only current source inventory comparison:

| Input | Fingerprint |
| --- | --- |
| Historical backend permission/package source | `05cbc353d80dea6ca9747ff9ca4100f1671e171a4dfdcd05333813c98f5e0c8b` |
| Current backend source at this preflight | `1e2c77c4f1d3ecae712dbec76afa00c10a2529c02f6b1023dca10e4379415460` |

They differ. The maintained package verifier calls the current-source
permission verifier; the old image chain cannot certify the current source.
Do not replace those fingerprints or present the 103-case focused Java
driver's different receipt contract as a complete permission/package receipt.

## Commands For Root Execution

These commands are a reviewed sequence, **not commands executed by this
preflight**. Use exclusive new output directories and explicit operation
authorization. Stop immediately on a failed prerequisite. The root selects
available private subnet/storage/image resources and controls all lifecycles.

### 1. Current Backend Build Chain

From the workspace root, with one compiler operation at a time:

```sh
node scripts/harness-modeling-permission-regression.mjs \
  --source ibiz-service-hub \
  --maven-repository /home/my/.m2/repository \
  --output .artifacts/modeling-permission-acceptance-20261114-r1

node scripts/harness-backend-source-package.mjs \
  --permission-report .artifacts/modeling-permission-acceptance-20261114-r1/report.json \
  --output .artifacts/backend-source-package-acceptance-20261114-r1

node scripts/harness-backend-source-images.mjs \
  --package-report .artifacts/backend-source-package-acceptance-20261114-r1/report.json \
  --output .artifacts/backend-source-images-acceptance-20261114-r1
```

The tools pin their build/runtime images and use exact receipts. Inspect the
current tool resource policy before launching; do not overlap fixed-name
backend byte-probes or start multiple fixture stacks.

### 2. Fresh SQL Fixture Without Shared Schema Reads

The supported model-derived UAA option avoids a shared source schema:

```sh
node scripts/tests/run-owned-native-nonadmin-fixture.sql.mjs \
  --execute-owned-sql-smoke --retain-owned-sql-fixture \
  --mysql-image=sha256:2e7e2b4ae4494b2bb9fe9d2ad4b6510790d714ba2e60af2f0df5aaca44f0c28f \
  --database-profile=mysql57-bitnami-arm64 \
  --uaa-model=standalone-uaa/source/uaa-core/src/main/resources/sysmodel/uaa.json \
  --uaa-schema-mode=standalone-tables \
  --scenario=two-center --model-version=816 \
  --subnet=ROOT_SELECTED_UNUSED_PRIVATE_24
```

Replace the subnet placeholder with an inspected unused RFC1918 `/24`.
The tool generates a new run ID and writes:

`.artifacts/native-nonadmin-fixtures/<RUN>/manifest.json`,
`credentials.private.json`, `owned-resources.json`,
`isolated-sql-report.json`, generated SQL and schema evidence.

The maintained UAA model has 18 physical tables, including
`OPEN_ACCESS_PROVIDER`. The capture path generates explicitly nullable,
model-derived fixture DDL, not official production migrations. It is not the
historical legacy-views mode, and still needs actual Boot/login validation.
Do not also pass `--uaa-schema-container` or `--uaa-schema`.
This preflight executed only the pure `captureModelUAASchema` function:
18 generated statements, zero views, source SHA-256
`ba798505b6b000522a82f050c407f864cf7afcd6cc4449407b334311d60bd029`;
no generated SQL was sent to a server.

The selected tmpfs profile does not prove restart durability. Use the reviewed
owned-volume profile only when storage acceptance is explicitly in scope,
with its additional journal-aware teardown.

### 3. Accounts, Exact Workflow And EBSX

Set `RUN` to the new returned 12-hex ID; it is not an old retired run:

```sh
node scripts/provision-run-owned-native-application-accounts.mjs \
  --provision-owned-application-accounts --run-id="$RUN" --label=acceptance-r1

node scripts/bootstrap-owned-workflow-schema.mjs \
  --execute-owned-workflow --run-id="$RUN" --label=acceptance-wf-r1 \
  --package-report=.artifacts/backend-source-package-acceptance-20261114-r1/report.json

node scripts/bootstrap-owned-ebsx-schema.mjs \
  --execute-owned-ebsx --run-id="$RUN" --label=acceptance-ebsx-r1 \
  --workflow-report=".artifacts/native-nonadmin-fixtures/$RUN/workflow-schema-acceptance-wf-r1/report.json"
```

Workflow and EBSX refuse preexisting schemas/principals rather than adopting
old imported ones. EBSX creates the reviewed read-only membership projection
from this fixture's actual `sys_role_member`; do not replace it with an empty
lookalike table.

**Required order gate:** run both workflow and EBSX bootstrap while the owned
network has only this run's MySQL peer, before retaining UAA/Redis or starting
the backend. Their peer-set checks do not accept an otherwise owned UAA/Redis
pair. Do not relax that check or remove resources by a matching name.

### Root-Reported Execution Checkpoint

For fresh run `de214359c3ca`, the root reported this sequence on 2026-11-14:

- Initial `acceptance-wf-r1` refused the network gate because retained UAA/Redis
  peers already existed; it failed before schema mutations.
- After receipt and exact ownership checks, the root removed only that run's
  UAA/Redis r1 resources, preserving MySQL and the fixture.
- `acceptance-wf-r2` and `acceptance-ebsx-r1` passed in the MySQL-only network.
- Fresh `acceptance-uaa-r2` passed its 16 declared checks and was retained.
- `acceptance-backend-r1` passed startup and was live when reported.

Use the successful `workflow-schema-acceptance-wf-r2` and
`uaa-runtime-acceptance-uaa-r2` receipts for this run, not the failed workflow
r1 or removed UAA r1 receipts. The commands above/below describe a fresh
sequence; they are not permission to rerun an existing label or overwrite
evidence. For this active run the root must substitute those successful r2
paths into backend, platform and frontend preparation inputs.

Startup/check counts cover their declared gates only. Native HTTP matrices,
multi-role browser workflows, editor save/readback, bilingual behavior and
feature-specific acceptance remain separate.

### 4. Fresh UAA/Redis Then Backend

Execute this stage only after both schema bootstraps succeed with the
MySQL-only peer set.

```sh
node scripts/harness-run-owned-uaa-runtime.mjs \
  --run-id="$RUN" --account-label=acceptance-r1 \
  --runtime-report=.artifacts/standalone-uaa-source-runtime/runtime-mvIM6i/report.json \
  --label=acceptance-uaa-r1 --retain-owned

node scripts/prepare-native-service-candidate.mjs --member-binding \
  --output .artifacts/native-service-migration/acceptance-central-20261114-r1

node scripts/launch-run-owned-native-backend.mjs \
  --execute-owned-backend --run-id="$RUN" --label=acceptance-backend-r1 \
  --image-report=.artifacts/backend-source-images-acceptance-20261114-r1/report.json \
  --retained-uaa-report=".artifacts/native-nonadmin-fixtures/$RUN/uaa-runtime-acceptance-uaa-r1/report.json" \
  --workflow-report=".artifacts/native-nonadmin-fixtures/$RUN/workflow-schema-acceptance-wf-r1/report.json" \
  --ebsx-report=".artifacts/native-nonadmin-fixtures/$RUN/ebsx-schema-acceptance-ebsx-r1/report.json" \
  --central-member-receipt=.artifacts/native-service-migration/acceptance-central-20261114-r1/receipt.json \
  --retain-owned
```

The fresh UAA harness requires actual login/identity and TokenStore/signature/
expiry evidence, not the old thirteen-check retained replay. Backend startup
uses the exact owned Nacos/ZooKeeper peers, aliases and staged model. Success
is only the declared transport/startup scope, not a complete feature pass.

The backend output is:

`.artifacts/native-nonadmin-fixtures/<RUN>/backend-runtime-acceptance-backend-r1/deployment-input.private.json`

Use this newly generated input for native browser/API matrices. The Central
selection only exposes the precise member READ dataset route; ordinary-member
scheme creation remains denied by native policy.

### 5. Additional Platform And Feature Gates

Platform/extension features require their separate verified bootstrap. Its
current CLI is:

```sh
node scripts/bootstrap-owned-platform-schema.mjs \
  --execute-owned-platform --run-id="$RUN" --label=acceptance-platform-r1 \
  --workflow-report=".artifacts/native-nonadmin-fixtures/$RUN/workflow-schema-acceptance-wf-r1/report.json" \
  --ebsx-report=".artifacts/native-nonadmin-fixtures/$RUN/ebsx-schema-acceptance-ebsx-r1/report.json" \
  --deployment-input=".artifacts/native-nonadmin-fixtures/$RUN/backend-runtime-acceptance-backend-r1/deployment-input.private.json"
```

This is not needed merely to create the initial MySQL/UAA/backend stack.
Publishing an extension-enabled backend subsequently requires its own
`--platform-report` and reviewed owned peer/transition procedure; do not
silently relaunch the same label or copy old platform credentials.

ModelDesign editor/configuration rows and save/readback, Central multi-role
row isolation, page sharing, service OAuth and MQTT remain distinct gates.
In particular fresh empty configuration tables do not resolve M02's actual
PSPF/PSPFStyle/PSAppType data prerequisite.

### 6. Frontend Chain Before Capability Remediation

Read-only verifiers executed by this preflight on 2026-11-14, before the
counter capability change below, established:

| Input | Current-source verification result |
| --- | --- |
| Host/framework dist `.artifacts/frontend-candidates/2026-11-09T14-45-39.091Z-UXhjaK/dist` | Passed `verifyFrontendSourceCandidate`; 18,110 files, 397,793,736 bytes, output SHA-256 `c623caeca789cb7fbbddcc6824d324c3ec4b369eb52c9063b2061a909f277f0b` |
| Its sibling `report.json` | SHA-256 `0342a83a20f885ea23467d53f59be003686ecee17bca9e2e3922aef9d2590929` |
| `.artifacts/native-model-design-local-candidate/ide-20261110-r4/report.json` | Passed `verifyLocalModelDesignBuild`; SHA-256 `f1b70a65b57206bf1b21732d6ab0890200b59c08766b7761ff615eab321b90e9` |
| `.artifacts/native-ai-code-deployment/owned-source-20261109-r2/receipt.json` and `.artifacts/native-ai-code-source-deps/current-source-20261109-r2/report.json` | Passed `readAiCodeModelCandidate`; receipt SHAs `8edea418ab20fc122b252d49133534da057117adb48cdf11d6f2e88de6be30b4` and `593e5c53c1088c13fea66b2d43e02fd2cdbddc62cbb1d972a8e3c76c2b005e65` |
| Current file-base64, global-util, studio-theme, design-index and console-layout replacements | All current source/build readers passed |
| `.artifacts/native-ai-code-runtime-assets/ide-20261110-r1` | Refused because its recorded design-index source/build evidence differs from the current replacement |

The shortest reviewed path therefore reuses the host/framework and complete
model-design builds, but prepares a new native model candidate, runtime-assets
delivery and frontend basis. Do not rebuild the host merely because its date
is older; likewise do not reuse the old runtime-assets receipt because its
files are present.

**Superseding input change:** the later addition to
`modelingweb/environment.config` makes this old host frontend receipt stale.
A subsequent read-only `verifyFrontendSourceCandidate` correctly rejected its
old 1,300-byte environment mapping against the current 1,358-byte mapping
(SHA-256 `dd83d2a5ca117821e07c07b5e1aad76fee94f8bfdae08f03086491ea1942eb17`).
The new plugin distribution also changes candidate/runtime-assets evidence.
Reassemble and verify a new host frontend, then prepare new candidate/assets/
basis receipts; the historical commands and pins below are provenance, not a
current bypass. The unchanged framework and model-design inputs may still be
reused only after their own current verifiers pass.

The frontend Central verifier currently accepts only
`native-central-published-query-candidate`, not the backend's complete
five-file `native-central-member-session-binding-candidate`. The root-created
view-only candidate below passed `verifyNativeCentralServiceCandidate`:

- Receipt:
  `.artifacts/native-service-migration/acceptance-central-view-20261114-r1/receipt.json`
- Receipt SHA-256:
  `61faa1724e6e5c67dfcfbcb1166146aacd89bbd6ccadb028b341b0dbec120041`
- View SHA-256:
  `1f87afb96b4de5a47d69b74fe16d1b57b9b5b12c0381f28531a71f55f078d345`

This preflight asserted that its view SHA equals the backend member-binding
candidate's view SHA. The separate view receipt is not a replacement for the
backend five-file receipt and does not establish row-isolation acceptance.

Reviewed commands from the workspace root follow. They were **not executed
by this preflight**. The view candidate already exists; the other outputs
may also have been created by the root after this review. Never rerun a
nonempty destination; inspect its current receipt or choose a new suffix.

```sh
node scripts/prepare-native-service-candidate.mjs \
  --output .artifacts/native-service-migration/acceptance-central-view-20261114-r1

node scripts/prepare-native-model-candidate.mjs \
  --output .artifacts/native-model-migration/acceptance-20261114-r1 \
  --ai-code-deployment-receipt .artifacts/native-ai-code-deployment/owned-source-20261109-r2/receipt.json \
  --ai-code-source-deps-report .artifacts/native-ai-code-source-deps/current-source-20261109-r2/report.json \
  --file-base64-replacement --global-util-replacement --studio-theme-replacement \
  --design-index-replacement --console-layout-replacement \
  --model-design-source-report .artifacts/native-model-design-local-candidate/ide-20261110-r4/report.json

node scripts/prepare-native-ai-code-runtime-assets.mjs \
  --candidate .artifacts/native-model-migration/acceptance-20261114-r1 \
  --output .artifacts/native-ai-code-runtime-assets/acceptance-20261114-r1 \
  --frontend-dist .artifacts/frontend-candidates/2026-11-09T14-45-39.091Z-UXhjaK/dist \
  --frontend-receipt .artifacts/frontend-candidates/2026-11-09T14-45-39.091Z-UXhjaK/report.json \
  --frontend-receipt-sha256 0342a83a20f885ea23467d53f59be003686ecee17bca9e2e3922aef9d2590929

node scripts/native-model-design-isolated-launch.mjs \
  --assets .artifacts/native-ai-code-runtime-assets/acceptance-20261114-r1 \
  --name acceptance-20261114-basis-r1 \
  --output .artifacts/native-model-design-isolated/acceptance-20261114-basis-r1 \
  --frontend-dist .artifacts/frontend-candidates/2026-11-09T14-45-39.091Z-UXhjaK/dist \
  --frontend-receipt .artifacts/frontend-candidates/2026-11-09T14-45-39.091Z-UXhjaK/report.json \
  --frontend-receipt-sha256 0342a83a20f885ea23467d53f59be003686ecee17bca9e2e3922aef9d2590929 \
  --service-candidate-receipt .artifacts/native-service-migration/acceptance-central-view-20261114-r1/receipt.json
```

Runtime-assets preparation intentionally exits 2 on prepared-not-accepted;
inspect its report before proceeding. The basis command intentionally omits
`--run`: it prepares only, without Docker/HTTP. Its required output root is
`.artifacts/native-model-design-isolated`, not
`.artifacts/native-model-design-isolated-launch`.

Next, the root must hash the new basis `input.json` and the fresh run's
`deployment-input.private.json`, then invoke
`native-model-design-owned-backend-input.mjs` with explicit `--launch-input`,
`--launch-input-sha256`, `--deployment-input`, `--deployment-input-sha256`
and a new `--name`. That adapter rechecks the current owned topology and
mounts; an old owned-backend frontend input cannot certify `de214359c3ca`.
Only the root may subsequently launch the two owned frontends and perform
the fresh browser/API matrices. Preparation and source-integrity checks
leave native acceptance false.

### 7. Fresh Browser Failure Classification

The root reported that the fresh owned four-case browser bootstrap failed:
homes and login passed, but console/HTTP diagnostics included pre/post-login
`remotemodel/ext/package.json` 404, authenticated
`extension/internal_messages/fetch_cur_receiver` 404 and
`work_items/count_my_todo` 404. It also reported preauthentication
`uaa/getbydcsystem` 401 with a navigation-aborted logger and one English/mobile
`ERR_NETWORK_CHANGED`, without blocked requests. This preflight did not
repeat those browser or HTTP operations; the failed evidence remains failed.

Read-only review of the prepared owned nginx, current source and backend r1
static input files distinguishes these cases:

| Observation | Local implementation observation | Required next evidence |
| --- | --- | --- |
| `remotemodel/ext/package.json` 404 | The owned nginx serves this from mounted model files with `try_files`, independently of the extension database. The actually built source set is `modelingweb/packages-latest/@ibiz-template`; its `runtime/src/app-hub.ts` `loadExtensionPlugin` catches a missing extension plugin and logs `noExtensionPlugin`. The native backend ext-file controller also returns 404 for an absent file. | Classify only the exact absent optional-manifest request, paired with its source contract and continued navigation. Do not manufacture a manifest or exempt other 404s. |
| Authenticated station-message fetch 404 | `runtime/src/service/service/internal-message/internal-message.service.ts` calls the real `/extension/internal_messages/fetch_cur_receiver` API. The owned nginx correctly forwards `/extension/...` to the gateway. Current backend r1 static configuration deploys only `gateway` and `ebsx`, has no `ownedplatform` datasource/extension runtime, and its Nacos startup snapshot has no `/extension/**` route. | Bootstrap the real isolated platform schema, transition the owned allinone, publish/read back its exact gateway route, then perform actual authenticated/anonymous/tenant-negative message flows. |
| PLM todo-count 404 | `modelingweb/local-plugins/design-index/src/controller.ts` unconditionally starts `loadMyTodoCount` from `onCreated` and posts `/work_items/count_my_todo`. Its error classifier treats 404/405 as unavailable but has no capability gate. The owned nginx deliberately strips the PLM counter bridge because this network has no PLM service. | Keep the current negative 404. Add an explicit bare-modeling capability policy rather than add PLM to this stack, return fake zero, or count unavailable as implemented. |
| Preauthentication organization 401/navigation abort | The built organization provider requests `/uaa/getbydcsystem/<dcSystem>`. Its authentication guard handles initialization denial before login. Existing deployment-smoke helpers scope expected auth diagnostics to preauthentication and exact URLs/routes. | Verify authenticated organization/appdata success, no persisted identity leak and only the precise initial auth redirect/abort. Never exempt post-login 401s or all navigation errors. |
| One `ERR_NETWORK_CHANGED` | The reviewed sources do not establish a deterministic application cause or an accepted exception for this browser transport error. | Preserve the failure and rerun a fresh bounded case with request/console evidence; do not broadly ignore network errors. |

#### Bare-Modeling Counter Remediation

After the read-only diagnosis, the root authorized a scoped local source
change. The initial flag implementation passed controlled tests, but a later
real browser run exposed a missing host-propagation case. The corrected
plugin below is implemented and built, but not yet browser-accepted:

- Added the optional environment mapping
  `enableNativePlmTodoCounter:ENABLE_NATIVE_PLM_TODO_COUNTER`.
- Set `ENABLE_NATIVE_PLM_TODO_COUNTER=false` only in the explicit owned
  bare-modeling frontend overrides. An absent flag preserves the existing
  shared default; explicit true continues to require the real endpoint.
- When explicitly false, the plugin publishes the distinct `disabled` state,
  leaves the count undefined and makes no counter request. It does not publish
  `ready` or a fabricated zero. Non-boolean `"false"` does not silently change
  the shared default.
- A boolean `window.Environment.enableNativePlmTodoCounter` now takes
  precedence over `ibiz.env`. When the deployment property is absent or not a
  boolean, the old runtime-environment semantics remain unchanged.
- Source and both built ESM/SystemJS tests cover the actual Core Environment
  and host attach path, absent/true/false, conflicting deployment/runtime
  values, retained actual-error handling, late completion after disposal,
  menu continuation and the owned environment/input binding.

**Corrective runtime finding:** the root reported message reads returning
200 after the fresh platform prerequisite was supplied, but one todo-counter
404 remained in each of four cases in:

`.artifacts/owned-modeling-bootstrap-browser/m01-a-20261114-r2/report.private.json`

The report remains failed. Read-only review and an in-memory source
reproduction found that the actually built
`modelingweb/packages-latest/@ibiz-template/vue3-components/src/web-app/attach-environment-config.ts`
iterates only `Object.keys(ibiz.env)`. The actual Core Environment does not
declare this optional plugin property, so the host drops it even when
`window.Environment` contains boolean false. The initial tests directly
populating `ibiz.env` could not expose that behavior.

The correction reads the explicit deployment boolean at the plugin boundary
without expanding the framework environment surface. New source/built tests
load the real Core Environment and enum source, execute the real host attach
source with installed `qs`/`ramda`, assert that the optional key is absent
from `ibiz.env`, and then run the controller. They prove that host false
still disables requests without publishing a count, host true wins over
runtime false, and absent/nonboolean deployment values preserve the old
runtime fallback. Controlled transport/lifecycle boundaries remain explicit;
these tests are not a substitute for a new browser run.

This follows the existing top-level boolean environment convention:
`modelingweb/environment.config`, `modelingweb/start.sh` and
`ownedFrontendOverrides` in `native-model-design-owned-backend-input.mjs`.
The startup serializer writes `true`/`false` as JavaScript booleans, but
serializes other environment values as strings. Do not inject an unparsed
JSON object through `CUSTOMPARAMS` as though it were already structured data.

The established local build
`node modelingweb/local-plugins/design-index/build.mjs` succeeded using the
already installed TypeScript 5.3.3/Rollup 4.9.3 and regenerated its three
distribution outputs plus build receipt. The corrective build passed 27
plugin source tests, 137 built-plugin/integration tests and 96 owned-input
tests. Its build-receipt SHA-256 is
`31d25622a157a2a2a289b99cb68ab2de5b33b46a27db2a73a07c23fead9f58a0`.
The original release had also passed 50 launcher compatibility checks; those
did not establish actual host propagation.

The correction does not change `environment.config` or framework/host source;
the current November 14 assembled host can remain reusable after its current
verifier passes. Rebuild the plugin candidate/runtime-assets/basis chain, and
repeat actual browser validation. Both failed four-case reports remain
unchanged; neither the capability policy nor test counts establish support
or acceptance of the PLM counter on a bare-modeling backend.

#### Owned Extension Transition

The active backend r1 report actually binds:

`.artifacts/backend-source-images-acceptance-20261114-r2/report.json`

SHA-256:
`15e45291b10ea071d8bb7cab9a701758f48b3ef2cbf94f9cf865b1c796383ce2`

The maintained platform bootstrap accepts an explicit deployment input and
guards the exact eight owned backend peers. This is distinct from the
MySQL-only workflow/EBSX order gate. It creates the real model-derived
extension schema, including `INTERNAL_MESSAGE`, with 32 physical tables and
two explicitly skipped columnless auto-extend entries. Its operator
projection is scoped, locked and password-masked; missing employee-number
data is reported, not invented.

The following commands are reviewed proposals for root execution, not
operations performed by this preflight. Stop on failed prerequisites and use
new exclusive labels if these output directories already exist.

```sh
node scripts/bootstrap-owned-platform-schema.mjs \
  --execute-owned-platform --run-id=de214359c3ca --label=acceptance-platform-r1 \
  --workflow-report=.artifacts/native-nonadmin-fixtures/de214359c3ca/workflow-schema-acceptance-wf-r2/report.json \
  --ebsx-report=.artifacts/native-nonadmin-fixtures/de214359c3ca/ebsx-schema-acceptance-ebsx-r1/report.json \
  --deployment-input=.artifacts/native-nonadmin-fixtures/de214359c3ca/backend-runtime-acceptance-backend-r1/deployment-input.private.json

node scripts/replace-owned-allinone-extension.mjs \
  --replace-owned-allinone-extension --run-id=de214359c3ca \
  --label=acceptance-extension-r1 \
  --deployment-input=.artifacts/native-nonadmin-fixtures/de214359c3ca/backend-runtime-acceptance-backend-r1/deployment-input.private.json \
  --platform-report=.artifacts/native-nonadmin-fixtures/de214359c3ca/platform-schema-acceptance-platform-r1/report.json \
  --image-report=.artifacts/backend-source-images-acceptance-20261114-r2/report.json
```

The replacement runner rechecks the platform/package/image bindings, replaces
only allinone, preserves its private IP/original DNS aliases and protects the
other seven peers. It retains the stopped/detached original for rollback,
checks startup stability and actual anonymous denial plus six source-account
native extension reads with pagination, and writes a new deployment input
changing only allinone. A failure uses its guarded original-allinone rollback.
These are the tool's reviewed contracts, not claimed results for this run.

**Retained-stack route-publication gate:** the replacement intentionally does not
publish Nacos. It emits `gateway-extension-route.candidate.json` and marks
copied startup snapshots as not republished. The current canonical
`ownedExtensionRoute` in `run-owned-backend-configuration.mjs` selects
`/extension/**` and uses `StripPrefix=1` plus `PrefixPath=/extension/api`.
The November 8 prose describing an unrewritten route is historical; use the
current structured route contract.

`harness-owned-native-platform.mjs --configure-platform-route` only handles
`/configs/**` and `/dictionaries/**`; it is not an extension-route publisher.
No maintained dedicated exact-extension publication adapter was established
by this review. Before proceeding, add/review a guarded publisher that binds
the actual current `appgateway-default` payload, preserves every other route,
rejects unknown drift, publishes and reads back only the canonical addition,
records rollback inputs and verifies real gateway forwarding/denial. Do not
invent a publication receipt or treat copied Nacos snapshots as live state.

Do not rerun the startup launcher with `--platform-report` against the
retained eight-node stack: its initial guard accepts exactly MySQL, UAA and
Redis. After a successful replacement and separately verified route
publication, rebind fresh owned frontend inputs to the new allinone identity
and repeat the four browser cases and multi-role workflows. A bounded message
read pass is not full notification, editor or platform acceptance.

#### Preferred Fresh-Stack Alternative

The root selected retirement and a new fixture rather than replacing the
retained backend. Read-only source review verifies a supported path without
the retained-stack route-publication gap:

1. Create the fresh SQL fixture/accounts, then bootstrap workflow and EBSX
   while the network is MySQL-only.
2. Bootstrap platform **before UAA**, omitting `--deployment-input`.
   `createPlatformTargetGuard` explicitly selects its MySQL-only mode when
   that option is absent; it does not discover or adopt a deployment.
3. Start the fresh UAA/Redis pair, then launch the new backend with the
   verified `--platform-report`.
4. `createOwnedBackendConfiguration` deploys the real extension system and
   scoped datasource and includes `ownedExtensionRoute` in the initial
   `appgateway-default` payload. The launcher publishes and reads back that
   initial owned Nacos configuration. No separate extension publisher or
   allinone replacement is required for this fresh path.

Before stage 4 in the earlier command sequence, the additional fresh-schema
command is:

```sh
node scripts/bootstrap-owned-platform-schema.mjs \
  --execute-owned-platform --run-id="$RUN" --label=acceptance-platform-r1 \
  --workflow-report=".artifacts/native-nonadmin-fixtures/$RUN/workflow-schema-acceptance-wf-r1/report.json" \
  --ebsx-report=".artifacts/native-nonadmin-fixtures/$RUN/ebsx-schema-acceptance-ebsx-r1/report.json"
```

Then add
`--platform-report=".artifacts/native-nonadmin-fixtures/$RUN/platform-schema-acceptance-platform-r1/report.json"`
to the fresh backend launch, using this new run's successful workflow/EBSX
labels if they differ. Schema checks, source-account/operator-value readiness,
startup/native message reads, tenant authorization and browser workflows
still require actual new evidence. Nullable `EMPLOYEE_NUMBER` values and
`operatorValuesReady=false` must remain honest findings, not invented data.

## Disposal

After success/failure, archive private logs and remove only the root-owned
current IDs with validated labels/mounts and no foreign network peers.
`retire-owned-native-fixture.mjs` accepts the new exact
`--deployment-input` and supports journal-aware owned-volume retirement;
it cannot adopt old retired IDs by name.

If failure occurs before a complete backend deployment input exists, use
the stage's exact resource journal/cleanup contract, then remove application
connections before account/schema cleanup and MySQL. Do not invoke a whole-
stack retirement path with an invented deployment input.

Do not run global prune, delete shared volumes or rewrite old reports.
Backups, credentials and restored authentication data remain private.
