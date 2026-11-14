# Fresh Owned Authorization Handoff

Date: 2026-11-14, Asia/Singapore. Current checkpoint: **bounded native
String-root A01 replay passed on fresh fixture `65f849ae29ce`; full acceptance
remains false**. Root owns runtime execution and resource lifecycle.

Initial handoff status, preserved as historical context: **commands reviewed;
live execution not performed by this subtask**. Root owns the single new
stack and actual HTTP/SQL/browser execution. No retired fixture, shared port
or historical receipt is an acceptance target.

This handoff covers the existing role/root HTTP runner, fresh-token grant
variants, the A01 native String-root runner, M01 bootstrap and the existing
six-case M04 read-only browser probe. It does not turn those tools into a
complete 48-row browser workflow or full A01/A02/A03 acceptance.

## Actual Campaign Checkpoint

### Preserved Failure And Narrow Repair

The retired fixture `de214359c3ca` reached a real application failure in its
A01 attempt 2:

`.artifacts/native-nonadmin-fixtures/de214359c3ca/authorization-a01-a01-20261114-r2/report.json`

Editor A's own-root control returned 200 and its foreign-root control 403.
The first whitespace-root READ then returned HTTP 500 with type `Exception`,
code 1 and message `未传入开发系统标识`. Complete physical before/after
snapshots were unchanged. That failure is retained, not reclassified as
denial or overwritten by the new run.

Source review found checked exceptions at malformed/missing-root denial
leaves. The actual `ResponseExceptionHandler` classifies ordinary exceptions
as internal errors; only `ACCESSDENY` maps to 403. The repair changes seven
leaf branches in `PSModelDEAccessManager` and `SystemAccessManagerBase` to
`ErrorException(ACCESSDENY)`: missing model context/root, malformed SYS/SLN
root, absent SYS/SLN target and required current-root context/root. Optional
current-root lookup still returns null. The global exception mapper,
permission bits, cache semantics and genuine service/database failures are
unchanged; service failures remain 500.

Ten real-mapper tests in `SystemAccessManagerRootErrorMappingTest` cover
403 classification, record/search READ/UPDATE input preservation,
malformed-root rejection before lookup/cache writes, missing targets,
optional/required behavior and retained 500 errors.

Root's current-source r3 receipts report:

| Lane | Result | Private receipt |
| --- | --- | --- |
| Permission regression | Focused 145; full 314; no failures/errors/skips | `.artifacts/modeling-permission-acceptance-20261114-r3/report.json` |
| Package verification | 396 tests; three zero-test placeholders remain noncoverage | `.artifacts/backend-source-package-acceptance-20261114-r3/report.json` |

These are separate test lanes, not additive counts of unique capabilities
or deployed acceptance.

### Fresh Native Replay

The replacement two-center fixture is `65f849ae29ce`. Its normal role/root
HTTP baseline passed all **182 checks**, including native allowed-write
readback and removal of both case-owned probe modules:

`.artifacts/native-nonadmin-fixtures/65f849ae29ce/native-http-auth-baseline-20261114-r1/report.json`

The fresh A01 receipt is:

`.artifacts/native-nonadmin-fixtures/65f849ae29ce/authorization-a01-a01-20261114-r1/report.json`

| Observation | Current result |
| --- | --- |
| Status | `passed-bounded-native-string-roots-partial-a01` |
| Representable invalid roots | 36 real dispatched responses, all HTTP 403 |
| Controls | 16: four own-root sentinel successes, eight authenticated 403 denials, four anonymous 401 denials |
| Authentication observations | 84, all passed |
| Complete physical coverage | 848 tables and 30,660 columns across both model schemas, unchanged |
| Snapshot identities | 138: one initial, 136 HTTP-after boundaries and one final verification |
| Unrepresentable cases | 48 remain `blocked-native-transport` |
| Bounded acceptance | `boundedRepresentableRootAcceptance=true` |
| Full/typed HTTP/native/permission acceptance | All remain false |

This is actual native String-root evidence, not a promotion of typed/null
roots, same-token revocation, nested-session handling, browser permissions
or complete application capabilities.

### Snapshot And Token Protocol

The replay uses `contiguous-full-after-to-next-before-v1`. Under the
exclusive sequential owned run, a complete post-response snapshot is the
immediately following request's complete pre-snapshot. No intervening
business/authentication HTTP or SQL writes are permitted; only read-only
runtime/source guards and private evidence persistence occur between those
boundaries. Each response still receives a new complete snapshot, compared
with both its pre-snapshot and the original baseline. Snapshot ID, source
operation and start/capture times are recorded. This removes redundant
whole-schema reads; it does not remove any table, column or HTTP boundary.

The native JWT lifetime remains **20 seconds**, with the existing greater
than five-second pre-dispatch margin. The six actors each completed initial
UAA login/self identity verification. Renewals reuse that verified
application context, but each new normal backend login token receives its
own backend-self and appdata verification before model dispatch. The
receipt has six UAA login and six UAA-self observations, plus 24 each for
backend login, backend self and appdata: six initial backend sessions and
18 renewals. No expiry/claim/cache change or 401-as-authorization substitution
was used.

### Resource Authority

The old stack's exact retirement receipt is:

`.artifacts/native-nonadmin-fixtures/de214359c3ca/retirement-acceptance-r1/report.json`

It reports `passed-owned-tmpfs-retirement`. Old frontend/bridge cleanup
receipts are under
`.artifacts/owned-native-modeldesign-launch/acceptance-20261114-r1/cleanup-*.json`.
Those old inputs are evidence only, never live targets.

The new backend startup receipt is:

`.artifacts/native-nonadmin-fixtures/65f849ae29ce/backend-runtime-acceptance-backend-r1/report.json`

It records `retainedOwned=true`. Root reported the new stack retained at this
checkpoint; this does not imply permanent liveness or a fresh container
inspection by this documentation subtask. Later retirement may supersede
that state. The evolving campaign and lifecycle authority is
[OWNED-FULL-ACCEPTANCE-20261114.md](OWNED-FULL-ACCEPTANCE-20261114.md).
Recheck the exact live guards before any future execution.

## Confirmed M03 Logical-Context Blocker

This is a read-only source diagnosis, not an implemented production flow.
Backend source remains frozen at the reviewed/tested current chain; no
runtime, source, route, grant or database change was made for this diagnosis.

### The Root-Only Entry Is Native

The authoritative Central action is
`OpenDesignIndex_Central@PSDevSlnSys` in:

`vendor-upstream/ibizmodeling-standard/modelapi-core/src/main/resources/model/net/ibizsys/modeling/PSSYSAPPS/Central/PSAPPDATAENTITIES/PSDevSlnSys.json`

Its `htmlPageUrl` is:

```text
${context.modeldesignpath}psdevslnsys=${context.psdevslnsys}/modelingindex/-
```

Its sole navigation context is `PSDEVSLNSYS <- psdevslnsysid`; it does not
supply `PSSYSTEM`. Therefore the M03 root-only entry is consistent with the
current native opening action. It must not be described as an established
runner error caused by omitting a source-required logical-system URL field.
Selecting the system through Central would still invoke this same action;
it does not bypass the downstream fixed context.

### Three Views Overwrite The Logical Key

Under the same authoritative model root, all three views contain a
`getPSAppViewNavContexts` entry with key `PSSYSTEM`,
`rawValue=true` and value `2C40DFCD-0DF5-47BF-91A5-C45F810B0001`:

| ModelDesign view path | Role |
| --- | --- |
| `PSSYSAPPS/ModelDesign/PSAPPDEVIEWS/PSSystemDashboardView.json` | System overview dashboard |
| `PSSYSAPPS/ModelDesign/PSAPPDEVIEWS/PSSystemDashboardView_SysInfo.json` | System-information dashboard variant |
| `PSSYSAPPS/ModelDesign/PSAPPDEVIEWS/PSSystemSettingInfoView.json` | System settings form |

The `sysinfo` application function targets `PSSystemIndexView`; its `info`
relationship item opens `PSSystemDashboardView`. The actual host
`ViewController.handleContextParams` converts `appViewNavContexts`, then
applies them with `Object.assign(this.context, context)`. The real
`convertNavDataByArray` uses raw values literally. Both inspected host
source versions have that behavior:

- `ibiz-app-hub/packages/runtime/src/controller/common/view/view.controller.ts`
- `modelingweb/packages-latest/@ibiz-template/runtime/src/controller/common/view/view.controller.ts`
- `ibiz-app-hub/packages/runtime/src/utils/nav-params/nav-params.ts`

Consequently an extra `pssystem` URL/context value is not a sufficient fix:
these views overwrite it again. The wrong UUID is explicitly present in
frontend view metadata; this is not evidence that the repaired backend
silently fell back to `PSModelDEAccessManager.DEFAULT_PSSYSTEMID`.

The real failed browser receipt
`.artifacts/owned-module-editor-browser/m03-a-zh-desktop-20261114-r2/report.private.json`
records a GET under the correct owned root to:

```text
/api/ibizmodeling__modeldesign/psdevslnsys/nf_65f849ae29ce_root_a/pssystems/2C40DFCD-0DF5-47BF-91A5-C45F810B0001
```

It returned 403 rather than the owned logical system
`nf_65f849ae29ce_system`. That receipt also records 403 for nested
`pssysserviceapis/fetchcursys`, `psworkflows/fetchcursys`,
`pssysapps/fetchcursys` and `pssysmodelchglogs/fetchdefault`. Their paths alone
do not establish identical request context, bodies or backend causes.
Correcting the three fixed keys must not be advertised as a proven repair
of every recorded 403.

### Published Lookup Is Also Rejected For The Editor

The earlier source-only candidate for discovering the selected physical
system without guessing its logical ID was this published read:

```text
POST /api/ibizmodeling__modeldesign/psdevslnsys/{authorizedRoot}/pssystems/fetchdefault
```

`PSSYSSERVICEAPIS/ModelAPI.json` declares the
`PSDevSlnSys -> PSSystem` relationship's `FetchDefault` as POST/READ,
`parentKeyMode=DEFAULT`, input `PSSystemFilterDTO` and dataset `Default`.
The ModelDesign `PSAPPDATAENTITIES/PSSystem.json` app method also declares
POST `/fetchdefault` with a `PSSystemDTO` page return. Publication is not
proof that the ordinary editor can use it.

Root performed a bounded real probe under fixture `65f849ae29ce`:

`.artifacts/native-nonadmin-fixtures/65f849ae29ce/logical-context-http-acceptance-r1/report.private.json`

The normal editor A UAA login, backend login, backend self and appdata
checks all returned 200. The own-root FetchDefault POST with
`{"page":0,"size":2}`, without a forced `PSSYSTEM` filter, then returned
403. `response-a.private.json` records `DEServiceAPIRuntimeException`,
code 2 and `系统不具备操作能力[READ]`. Complete 848-table/30,660-column
snapshots before authentication, after authentication and after that fetch
were unchanged; all three hashes are
`8825fcdc805370dcc0f8256199d0ad6d8533d9a0316b24cccd1c3cde0f767b43`.
This is failed lookup evidence, not successful logical-context bootstrap.

The probe used a separately reviewed exact POST/READ transport allowlist
extension and five controlled checks. Root subsequently removed that
temporary extension and its tests, restoring the measured A01 tool-chain
bytes. No reusable transport widening remains. The private diagnostic is
preserved; the ordinary runner must not be assumed to authorize this new
call automatically.

### Policy And Role-Presentation Gap

Follow-up read-only source review: 2026-11-15, Asia/Singapore.

The maintained source does not contain a `PSSystemDEAccessManager`.
`PSModels.MODEL_INSTANCE_DATA_ENTITIES` registers module/application and
other entities but not `PSSYSTEM`. The modeling access-manager factory has
no dedicated `PSSYSTEM` switch branch. Without a configured runtime plugin
override, it falls through to the cloud generic `DataEntityAccessManager`,
not `PSModelDEAccessManager`.

The authoritative `PSSystem.json` has `dataAccCtrlMode=1` (`SELF`) and no
embedded entity user roles or operation privileges. In the generic cloud
manager, an ordinary user with no matching READ roles is rejected before
query authority conditions are added. A root-specific modeling editor
grant is therefore not automatically a `PSSYSTEM.READ` grant on this
source path. Merely adding the canonical logical-system filter cannot
replace the missing operation authorization.

Relevant maintained source:

- `ibiz-service-hub/libs/ibiz-modeling-core/src/main/java/net/ibizsys/modeling/core/util/PSModels.java`
- `ibiz-service-hub/libs/ibiz-modeling-core/src/main/java/net/ibizsys/modeling/core/security/SystemAccessManagerBase.java`
- `ibiz-service-hub/libs/ibiz-modeling-core/src/main/java/net/ibizsys/modeling/core/dataentity/security/PSModelDEAccessManager.java`
- `ibiz-service-hub/libs/ibiz-cloud-core/src/main/java/net/ibizsys/central/cloud/core/dataentity/security/DataEntityAccessManager.java`

This default factory/policy path is consistent with the measured READ
denial; this documentation subtask did not inspect an instantiated runtime
access-manager object. Runtime UAA authorities and plugin overrides remain
separate inputs. The observation does **not** establish a product rule that
the view must be administrator-only, nor authorize promoting the editor or
loosening the policy.

A reviewed production repair needs both model and lifecycle work:

1. Establish the intended ordinary-editor/viewer versus administrative
   READ/projection contract and its root-scoped authorization. The published
   FetchDefault route is currently rejected for the tested editor; it is
   not an already-working bootstrap fix. Do not grant administrator status,
   add blanket READ access or append filters merely to obtain a 200.
2. Resolve the logical system through a normally authenticated,
   properly authorized root-scoped read before opening dependent
   overview/settings views. Use the returned authorized record, not a
   manifest value forced into global frontend state. Require a valid,
   unambiguous result; empty/duplicate/foreign results must block navigation.
3. Remove or replace all three fixed `PSSYSTEM` navigation values with
   inheritance/dynamic binding from that resolved record. Update the
   authoritative models and reproducible transformed assets together.
4. Make the product bootstrap/menu lifecycle await successful resolution.
   Root switches, identity changes, disposal and late asynchronous results
   must not install a previous root's logical system or dispatch dependent
   default views. Missing data must not fall back to the template UUID.
5. Bind normal default-view presentation to the reviewed role/capability
   contract. A legitimately administrative-only view must not be opened
   automatically for an ordinary editor, but suppressing its failed request
   without that contract is not acceptance. Preserve actual negative HTTP
   checks and the intended usable role-specific workflow.
6. Use the existing native service/AppFunc/OpenView navigation chain. A
   harness may observe and validate it, but must not inject a controller,
   synthesize root headers, seed the fixed UUID, rewrite responses or grant
   access to the wrong key.

No currently inspected ModelDesign index/action metadata performs that
dynamic resolution before the root-only opening flow. Adding a logical
parameter only to the test URL would conceal rather than repair that
product lifecycle gap.

Before M03 can close, the repaired product flow must be replayed on both
owned roots through normal login/navigation, read the actual authorized
system/module sentinels, then perform the ordinary editor Save,
fresh-session readback and UI restoration. Full physical comparisons,
viewer/no-access/cross-root rejection, both languages/viewports and all
console/network failures remain separate required evidence. The ECharts,
counter-host and other recorded UI failures are not waived by this
logical-context diagnosis. No top-level capability is closed here.

## Inputs Required From Root

1. A fresh 12-lowercase-hex run ID and current
   `.artifacts/native-nonadmin-fixtures/RUN/backend-runtime-LABEL/deployment-input.private.json`.
2. Matching private `manifest.json`, `owned-resources.json` and
   `credentials.private.json` under the same run directory. Credentials must
   contain exactly the six fixture logins and remain private.
3. A current source-package receipt, immutable image receipt and live
   resource bindings, including the current source tree and this deployment's
   staged native ModelAPI. A01 requires package status
   `passed-package-and-unit-only`, exact source hashes and the provider's
   read-only `/app/model` bind to its own `backend-runtime-LABEL/model-input`.
4. A fresh frontend launch directory under
   `.artifacts/owned-native-modeldesign-launch/`, with `report.json` status
   `RUNNING-OWNED-FRONTEND-NOT-ACCEPTED`, its private
   `launch-state.private.json`, bound prepared frontend input, assets,
   bridge specifications/process identities, deployment binding and real
   Central/ModelDesign entries. M01/M04 cannot consume a backend deployment
   receipt alone.
5. Root's approval for the explicit denied/probe HTTP mutations and the
   separate temporary grant mutations below. Do not run them concurrently
   with browser sessions, model writes or each other.

The runtime guards re-inspect exact owned IDs, images, labels, private peers,
volumes, mounts, endpoints and input hashes. Their Docker inspection and
read-only SQL occur when the commands are actually executed; none is implied
by constructing a command.

The first new stack is **two-center**. A same-center run needs a separately
approved fixture/runtime receipt. Do not change center IDs inside an already
pinned stack to manufacture the second topology.

## Roles And Physical Witnesses

The canonical fixture has two roots A/B and six ordinary users: editor,
viewer and no-access on each root. All are non-admin and authenticate through
normal UAA and backend login. No-access means authenticated without a grant,
not an invalid account. Original editor grants are `ACCMODE=3`, viewer grants
are 1, and no-access has no grant. Exactly four explicit root-specific grant
rows are expected; temporary variants may touch only the two editor rows.

Each root must retain its original physical module and system sentinel in
its separate model schema, with the fixture's root, scheme, instance, center,
name and tag bindings. Both schemas intentionally reuse the same logical
system/module IDs while their physical names/tags differ. A response with
the correct ID alone cannot establish which schema was read.

The schema-scoped JDBC users and source native mapping must remain bound to
the corresponding physical database. Never use the logical system ID as the
parent root path, and never repair an unauthorized model write with SQL.

Normal bootstrap uses the verified `ibizmodeling` system and
`CENTER_ID_org` organization. Keep the native 20-second JWT and its normal
login/refresh flow. No fabricated root/header, token claim, cache entry,
issuer change or extended expiry is permitted.

## Obtain Browser Pins Without Running It

Run from the workspace root after Root supplies `LAUNCH`. This reads the
launch report and bound JSON files, prints paths/hashes/actor names, and
does not issue Docker, SQL or HTTP commands. It is only a command-input
extractor; the live runners still perform their stricter preflight.

```sh
LAUNCH=.artifacts/owned-native-modeldesign-launch/FRESH_LAUNCH
node --input-type=module - "$LAUNCH" <<'NODE'
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join } from 'node:path';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const load = path => {
  const bytes = readFileSync(resolve(path));
  return { value: JSON.parse(bytes), sha256: hash(bytes) };
};
const launch = resolve(process.argv[2]);
const report = load(join(launch, 'report.json'));
assert.equal(report.value.status, 'RUNNING-OWNED-FRONTEND-NOT-ACCEPTED');
const state = load(join(launch, 'launch-state.private.json'));
const input = load(report.value.input.path);
assert.equal(input.sha256, report.value.input.sha256);
const deployment = load(report.value.deploymentInput.path);
assert.equal(deployment.sha256, report.value.deploymentInput.sha256);
assert.equal(input.value.ownedBackend.deploymentInput.sha256, deployment.sha256);
const manifest = load(input.value.ownedBackend.manifest.path);
assert.equal(manifest.sha256, input.value.ownedBackend.manifest.sha256);
assert.equal(manifest.value.runId, deployment.value.runId);
const editors = Object.fromEntries(manifest.value.roots.map(root => {
  const users = manifest.value.users.filter(user =>
    user.role === 'editor' && user.rootId === root.rootId);
  assert.equal(users.length, 1);
  return [root.side, users[0].loginname];
}));
console.log(JSON.stringify({
  RUN_ID: manifest.value.runId, LAUNCH: launch,
  DEPLOYMENT: report.value.deploymentInput.path,
  LAUNCH_SHA: report.sha256, STATE_SHA: state.sha256,
  DEPLOYMENT_SHA: deployment.sha256, EDITOR_A: editors.a, EDITOR_B: editors.b,
}, null, 2));
NODE
```

Use the emitted exact values for the variables in the commands below.
Placeholders such as `FRESH_LAUNCH` are deliberately not runnable targets.
Choose new labels/output directories for each attempt; do not overwrite a
failed report.

## Sequential Execution

### 1. Establish The Native Role/Root Baseline

If Root already ran this exact current deployment successfully, consume
that pinned receipt instead of duplicating its mutations.

```sh
node scripts/run-owned-native-permission-http.mjs \
  --execute-owned-native-matrix \
  --allow-owned-probe-mutations \
  --run-id="$RUN_ID" \
  --deployment-input="$DEPLOYMENT" \
  --label=auth-baseline-20261114-r1
```

This exercises six real accounts, both roots, allowed editor CRUD with
case-owned probe cleanup, viewer reads and denied writes, no-access/foreign
root denial, forged logical-system read correction and fresh-login readback.
The canonical matrix contains 60 role/root operation cases. Additional
authentication/readback checks and normal renewals have their own receipts;
do not substitute a hard-coded total HTTP count for the checks actually run.

Require `passed-bounded-native-observations`,
`boundedRoleRootAcceptance=true`, no failed checks, explicit successful
cleanup, and the final physical-baseline restoration check. Model versions
may advance by the verified allowed-write deltas; sentinels must survive.
`nativeAcceptance`, `permissionAcceptance` and source acceptance remain false
for dimensions the tool does not cover.

No restart/recreation/backup flags are included here. They are separate
root-authorized lifecycle work, not prerequisites to this bounded command.

### 2. A01 Native String-Root Cases

```sh
node scripts/run-owned-a01-root-http.mjs \
  --execute-owned-a01 \
  --allow-owned-denied-updates \
  --run-id="$RUN_ID" \
  --deployment-input="$DEPLOYMENT" \
  --label=a01-20261114-r1
```

Output: the run's `authorization-a01-a01-20261114-r1/report.json`.

Require `passed-bounded-native-string-roots-partial-a01`, exactly 36
`passed-http` invalid-root cases, 48 `blocked-native-transport` cases, 16
controls and `physicalModelsUnchanged=true`. Own editor/viewer controls must
read the nonempty physical sentinel; foreign/no-access controls require
authenticated 403; anonymous controls before/after require 401.

For malformed String roots, actual 403 is authorization denial; actual
400/422 is separately classified input rejection, not permission proof.
401/404/429/5xx, transport errors, redirects, client-side refusals and empty
successful read controls cannot pass.

The 48 absent/null/empty/numeric AppContext cases cannot be faithfully
represented by the required native String parent URL. Do not substitute
`"null"`, `"0"`, double slashes, invented headers or unexported routes.
Current-source typed Java tests are a separate lane, not HTTP acceptance.
`fullA01Acceptance` and `typedRootHTTPAcceptance` must stay false.

### 3. Restore-Test Fresh-Token Grant Variants

```sh
node scripts/run-owned-authorization-variants.mjs \
  --execute-owned-authorization-variants \
  --allow-owned-grant-mutations \
  --run-id="$RUN_ID" \
  --deployment-input="$DEPLOYMENT" \
  --label=grant-variants-20261114-r1
```

Output: the run's `authorization-http-grant-variants-20261114-r1/report.json`.

Eight cases cover each original ordinary editor grant with mode 0, -1,
expired and READ-only mode 1. The runner requires a distinct backend token
after grant mutation, actual identity/appdata checks, denied writes and
foreign-root reads, then exact full-row CAS restoration and fresh-login
readback. Its durable journal is required before each update.

Require `passed-bounded-owned-grant-variants`,
`boundedGrantVariantsVerified=true`, `freshTokenGrantRotationVerified=true`
and exact cleanup of both original grants. An unknown concurrent grant
value, failed restore or repeated backend token is a blocker, not permission
success. Retain the private recovery journal; do not apply a blind update.

This is **not A02 same-token revocation**. Its reports intentionally keep
same-token-cache and session/holder acceptance false.

### 4. M01 Own-Editor Bootstrap On Both Roots

```sh
node modelingweb/app/tests/owned-modeling-bootstrap.browser.mjs \
  --run-readonly-browser \
  --launch="$LAUNCH" --launch-sha256="$LAUNCH_SHA" \
  --state-sha256="$STATE_SHA" \
  --deployment="$DEPLOYMENT" --deployment-sha256="$DEPLOYMENT_SHA" \
  --run-id="$RUN_ID" --actor="$EDITOR_A" --root-side=a \
  --output=.artifacts/owned-modeling-bootstrap-browser/m01-a-20261114-r1
```

```sh
node modelingweb/app/tests/owned-modeling-bootstrap.browser.mjs \
  --run-readonly-browser \
  --launch="$LAUNCH" --launch-sha256="$LAUNCH_SHA" \
  --state-sha256="$STATE_SHA" \
  --deployment="$DEPLOYMENT" --deployment-sha256="$DEPLOYMENT_SHA" \
  --run-id="$RUN_ID" --actor="$EDITOR_B" --root-side=b \
  --output=.artifacts/owned-modeling-bootstrap-browser/m01-b-20261114-r1
```

Each command creates fresh browser contexts for `zh-CN`/`en-US` and
1440x900/390x844. It uses the real login form, naturally authenticated
appdata, live index lifecycle/model/DOM evidence and an ordinary System-menu
click, with normal Escape dismissal where required. It does not force-click
or inject a controller/identity.

Inspect every private report, console/page error, blocked request,
post-login 401, home readiness and natural navigation result. A click alone
does not prove the editor target rendered. These probes do not perform M03
save or fresh-session persistence and retain false acceptance flags.

### 5. The Existing Six-Case M04 Diagnostic

```sh
node modelingweb/app/tests/owned-modeling-permission.browser.mjs \
  --run-readonly-browser \
  --launch="$LAUNCH" --launch-sha256="$LAUNCH_SHA" \
  --state-sha256="$STATE_SHA" \
  --deployment="$DEPLOYMENT" --deployment-sha256="$DEPLOYMENT_SHA" \
  --run-id="$RUN_ID" \
  --output=.artifacts/owned-modeling-permission-browser/m04-readonly-20261114-r1
```

It executes only:

| Actor | Target | Language/viewport |
| --- | --- | --- |
| Viewer A | A | Chinese desktop |
| No-access A | A | English desktop |
| Viewer B | B | Chinese mobile |
| No-access B | B | English mobile |
| Editor A | B | Chinese desktop |
| Editor B | A | English mobile |

The normal login/root readiness requirement is retained for viewers. Do not
turn a viewer's failed controller/bootstrap into successful read evidence.
Expected own-read/denied status is recorded, but this diagnostic does not
assert nonempty physical read sentinels, every allowed/denied CRUD outcome
or persistent side effects. Its `OBSERVED-READONLY-MATRIX` status is explicitly
not full acceptance. Internal failures are caught into its report, so a
zero CLI exit code alone is not sufficient evidence.

## Snapshot Coverage And Stop Conditions

| Lane | Built-in physical observation |
| --- | --- |
| Native role/root HTTP | Full-column module/system projections in both physical schemas, mutation-specific checks and final restoration, including expected version deltas. Not an inventory of all model tables. |
| Grant variants | All columns of exactly five tables: metadata grant table plus module/system in both roots. The model projection requires exactly the original four sentinel rows; leftover native probe rows must be cleaned first. |
| A01 | Every table/column in both model schemas, including empty tables; before/after every authentication, control and model HTTP request. Inventory and values are compared. |
| Current M01/M04 browser probes | No built-in SQL before/after snapshot adapter. A read-only request filter and a screenshot do not replace full physical no-side-effect evidence. |

Stop on source/resource drift, authentication/identity/bootstrap failure,
unexpected HTTP status, absent/misbound sentinel, physical delta on a denied
request, failed exact grant restoration, blocked cleanup, viewer not ready,
or unexplained console/network errors. Preserve failure evidence and
coordinate the next repair; do not retry by changing headers, permissions,
claims or shared data.

M04's 48 combinations are six actors x two roots x two languages x two
viewports. `browserReadMatrix` enumerates that skeleton, but the bootstrap
runner executes only its specified own editor's four rows; the six-case
permission probe does not execute the other rows. No existing command here
can honestly close the complete multi-role CRUD/persistence matrix.

## Initial Runner Repairs (Historical)

The six-case permission probe previously selected side B actors through
`centerId.endsWith("_b")`. In a same-center fixture both roots have the
same `_a` center, so the B viewer/no-access/cross-root cases could not start.
Actor selection now resolves `actorSide` to its declared root, then selects
exactly one actor with that `rootId` and role. Target root selection and
permission/readiness expectations are unchanged. Missing roots, missing
actors and ambiguous roles fail closed.

Files:

- `modelingweb/app/tests/owned-modeling-permission.browser.mjs`
- `modelingweb/app/tests/owned-modeling-permission.test.mjs`

The new same-center fixture first reproduced the old failure: 4 passing
tests, 1 failure at missing actor. After repair:

```sh
node --test modelingweb/app/tests/owned-modeling-permission.test.mjs \
  modelingweb/app/tests/owned-modeling-bootstrap.test.mjs \
  scripts/tests/owned-five-dataset-browser.test.mjs
```

Get-metadata repair checkpoint: **39 passed, 0 failed/skipped**.

### Native Built-In Get Metadata

The current native ModelAPI has 265 built-in Get definitions with `name`
but no `codeName`. Bootstrap and five-dataset probes previously selected
collections using only `method.codeName === "Get"`, producing an empty
read-collection policy and aborting real keyed GET requests before dispatch.
New controlled tests reproduced both the empty minimal policy and the real
model's 0-versus-265 mismatch before repair (23 passed, 2 failed).

Both probes now consume `nativeReadCollections(api)` exported from
`owned-five-dataset.browser.mjs`. The exact `(codeName ?? name) === "Get"`
fallback is accepted only for a `DEACTION`, `GET`, `READ`, keyed,
`noServiceCodeName` method bound to `PSDEACTIONS/Get.json`. Conflicting or
empty code names, Update/write methods, fetch methods, custom aliases and
different actions do not become allowed reads. FETCH methods in the audited
model already have code names and retain their original policy.

The focused tests load the actual ModelAPI, select all 265 name-only Get
collections, allow their exact keyed reads and still deny POST/PUT/PATCH/
DELETE and extra action suffixes. A bootstrap source-wiring test ensures
the shared helper is actually used. The six-case permission diagnostic
does not construct this Get-metadata policy and needed no additional
change for this defect. Its existing evidence limits remain unchanged.

```sh
node --test scripts/tests/owned-authorization-variants.test.mjs \
  scripts/tests/run-owned-authorization-variants.test.mjs \
  scripts/tests/owned-a01-root-http.test.mjs \
  scripts/tests/run-owned-a01-root-http.test.mjs
```

Initial A01/variants contract checkpoint: **44 passed, 0 failed/skipped**.
These were controlled transport, fixture and private-file tests. They did
not launch a browser or issue Docker, business HTTP or SQL. Later
snapshot/token and root-error mapping repairs are described in the actual
campaign checkpoint above.

Historical source-only handoff boundary, before Root's actual replay:

> No acceptance command listed above was executed by this subtask. Root still
> must supply/pin the fresh deployment and launch report, run them serially,
> review actual receipts and decide the next bounded capability gate.

Root's actual bounded backend results are now recorded at the campaign
checkpoint above. Remaining browser/grant/other capability gates require
their own current receipts; this document does not infer their completion.
