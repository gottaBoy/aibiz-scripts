# Owned Browser Acceptance Handoff

Date: 2026-11-14, Asia/Singapore. This subtask adds a source-bound M03
PSModule editor runner and controlled tests. **No live Docker, HTTP, SQL or
browser operation was performed by this subtask.** A test passing against
constructed snapshots is not a live editor acceptance receipt.

## November 15 Closeout

This original handoff is superseded by the actual execution record in
[Fresh Owned Acceptance](OWNED-FULL-ACCEPTANCE-20261114.md) and
[Current Runtime Blockers](OWNED-RUNTIME-BLOCKERS-20261115.md).
The replacement fixture `65f849ae29ce` is now fully retired, as is the
earlier `de214359c3ca`. Do not reuse either launch receipt as a live target.

Two actual desktop module-name UI roundtrips physically verified all four
Saves and restored business names, but both overall browser runs failed.
Mixed-language labels, HTTP/console errors and guarded requests remain
blockers. Six readonly permission diagnostics established controller-root
observations only; a loader screenshot prevents visible-page acceptance.
The stricter failure-recovery, browser-teardown and loader gates have
controlled tests, not a fresh post-fix live replay. All eight editor
combinations and the complete 48-row permission matrix remain open.

## Original Launch Gate

Root reported fresh fixture `de214359c3ca`, successful SQL/account/UAA checks
and the current backend package operation. The former frontend launch
receipts belong to retired resources and cannot be reused. Root must supply
a fresh frontend launch, its report/state hashes and exact backend
deployment binding before any browser execution.

Use one owned stack and execute HTTP grants, CRUD probes and browser writes
sequentially. Do not run this editor script concurrently with any other
model mutation, schema preparation, fixture retirement or deployment change.
No shared PLM/Modeling service or retained historical image is a fallback.

Preflight and related handoffs:

- `OWNED-ACCEPTANCE-PREFLIGHT-20261114.md`
- `OWNED-AUTH-ACCEPTANCE-20261114.md`
- `MODELING-CENTRAL-CREATE-20261114.md`

## M03 Narrow Editor Roundtrip

New runner:

`modelingweb/app/tests/owned-module-editor.browser.mjs`

The only writable field is the existing manifest sentinel's non-NULL
`psmodulename`, maximum 200 characters. `memo` is deliberately not used:
the fixture stores SQL NULL, and replacing NULL by an empty UI string is
not restoration.

The authoritative native path is:

1. Ordinary manifest editor login, own-root `ModelingIndex` entry.
2. Main `appmenu` item `sysinfo`, targeting `PSSystemIndexView`.
3. Its `drbar` item `info`, targeting `PSSystemDashboardView`.
4. Embedded module portlet `PSModuleGridView9`, with `FetchCurSys`.
5. The real module-name link, opening `PSModuleQuickCfgView` in a drawer.
6. Real textbox input and `SaveAndExit` toolbar click.
7. A new browser context, ordinary login and the same native navigation
   read back the changed name.
8. A second real UI Save restores the manifest name. A third fresh context
   reads that original name again.

The System sidebar's PSMODULE group is not an alternative list entry:
that static group is not connected to its ROOT and has no list action.
No bare guessed route, controller action, injected identity/header,
`page.request` write or SQL reset is used to make a blocked editor pass.
If the actual editor is noneditable or Save is absent/disabled, stop and
retain that evidence.

The runner requires explicit `--allow-owned-ui-mutations`. It only admits
one armed PUT to:

```text
/api/ibizmodeling__modeldesign/psdevslnsys/<owned-root>/psmodules/<manifest-sentinel>
```

The outgoing body must preserve every other loaded form field exactly.
Changing NULL memo, default-module flag, group, root or arbitrary hidden
data is rejected before dispatch. Other writes, roots and origins remain
blocked. Normal browser authentication and organization/system headers
must be observed, not supplied by the runner.

### Command Inputs

Use the read-only pin extractor in `OWNED-AUTH-ACCEPTANCE-20261114.md`
after Root provides a fresh `LAUNCH`. It emits `RUN_ID`, `LAUNCH`,
`DEPLOYMENT`, `LAUNCH_SHA`, `STATE_SHA`, `DEPLOYMENT_SHA`, `EDITOR_A`
and `EDITOR_B`. Do not copy hashes from historical reports.

From the workspace root:

```sh
node modelingweb/app/tests/owned-module-editor.browser.mjs \
  --launch "$LAUNCH" \
  --launch-sha256 "$LAUNCH_SHA" \
  --state-sha256 "$STATE_SHA" \
  --deployment "$DEPLOYMENT" \
  --deployment-sha256 "$DEPLOYMENT_SHA" \
  --run-id "$RUN_ID" \
  --actor "$EDITOR_A" \
  --root-side a \
  --locale zh-CN \
  --viewport desktop \
  --output .artifacts/owned-module-editor-browser/FRESH_PRIVATE_LABEL \
  --allow-owned-ui-mutations
```

`FRESH_PRIVATE_LABEL` is an intentional placeholder; choose a new lowercase
label. Existing output directories are rejected, including previous
failures. The output is owner-private and includes full physical snapshots,
durable write/recovery intents, source/runtime pins, screenshots and
`report.private.json`. Do not commit raw evidence or credentials.

Each invocation covers exactly one actor, root, language and viewport.
Repeat sequentially for both roots, `zh-CN`/`en-US` and
`desktop`/`mobile`, using the corresponding actual editor and new output
label each time. One pass does not establish all eight combinations.

### Physical Side Effects And Recovery

Before any UI work, the source-derived inventory must cover every physical
column and row in both model schemas, including all source/dump tables.
SQL execution is SELECT-only, through the exact owned MySQL identity.
Runtime/bridge/source/input identities are rechecked throughout.

Each real Save must have only these source-backed persistent effects:

- The selected sentinel name and its real `UPDATEDATE`/`UPDATEMAN`.
- Exactly one increment of the own logical system's `MODELVER`.
- The own system's matching `PSSYSMODELLOGNAME=PSMODULE` log save.

Sibling/default modules, groups, other audit rows, task tables, DB versions,
all other tables and the complete foreign physical schema must remain
byte-identical. The actual packaged `PSModuleDERuntime.java` and
`DataEntityRuntimeBase.java` source hashes are bound to the backend package
receipt. PSModule has no DE/DB version mapping; default `syncSysTask` is a
no-op. Its default-module/group branches are not blanket-approved effects.

Restoring the business name does not erase real audit history or roll back
native model versions. Two accepted Saves advance `MODELVER` twice. The
script never issues SQL to undo those legitimate effects.

A timeout is not proof that no save happened. The write intent is fsynced
before input/click, and a full post-attempt snapshot is recorded. When the
applied delta is exactly understood, bounded recovery uses a fresh normal
UI session and restores only the original name. If an unexpected delta or
runtime drift occurs, no arbitrary repair is attempted: retain the fixture,
intents and snapshots for review. A failed run remains failed even when
bounded recovery successfully restores its business name.

### Pass Boundary

A successful invocation reports:

```text
PASSED-OWNED-MODULE-UI-ROUNDTRIP-NOT-FULL-ACCEPTANCE
boundedEditorSaveAcceptance=true
freshSessionReadbackAcceptance=true
restoredBusinessName=true
physicalSnapshotAcceptance=true
```

Every console error, page error, HTTP error, failed network request or locally blocked request
prevents that bounded pass. Source-only tests, an empty list, direct HTTP
roundtrips and bootstrap/navigation-only receipts cannot substitute.

`nativeAcceptance`, `permissionAcceptance` and `acceptedForProduction`
remain false. Viewer/no-access/foreign-root write rejection, all other
model editors, remaining datasets and full M03 are not accepted by this
narrow runner. The existing permission/browser lane remains separate.

## M01 Requires A Different Flow

The old authenticated 404 was the READ list:

```text
POST /api/ibizmodeling__central/psdevslns/fetchcurdcslnuser
```

It was not Create. Fresh backend launch must explicitly receive
`--central-member-receipt <current-full-member-candidate/receipt.json>`.
The complete `native-central-member-session-binding-candidate`, not a
frontend-only view, must be staged on the backend and delivered to the
matching frontend. That option exposes only the exact Path+POST READ
dataset, not Create, Update, Remove, GetDraft or an entity wildcard.

Run ordinary login/appdata, nonempty member-list validation, own/foreign
center isolation and actual selection/navigation with fresh snapshots.
The existing `owned-central-route-diagnostic.mjs` defaults to retired
config-r6 inputs; it is a historical diagnosis tool, not a fresh M01
browser acceptance runner.

The six fixture editor/viewer/no-access accounts are ordinary non-admin
users. Native policy forbids ordinary member scheme Create. Real
developer-administrator Create UI requires separately reviewed identity,
roles, route, data and cleanup prerequisites. Do not relabel an editor as
admin, widen the READ route, or interpret a disabled button as backend
permission proof. M01 remains open until that separately defined flow
and the member-list/navigation matrix have current live evidence.

## Controlled Verification

```sh
node --test modelingweb/app/tests/owned-module-editor.test.mjs
```

Result: 35 passed, zero failed/skipped. Coverage includes authoritative
navigation/editor/method contracts, same-center root-based actor selection,
explicit opt-in, pre-dispatch payload and origin/root restrictions, NULL
preservation, precise complete-snapshot deltas and native version-preserving
restoration. These tests do not execute the live browser, Docker or SQL.
The runner consumes the shared strict `nativeReadCollections` helper and
captures `requestfailed` path/failure evidence in each blocking session
error list.

`node modelingweb/app/tests/owned-module-editor.browser.mjs --help` and
`git diff --check` also passed. Live runner selectors, normal save/readback,
actual audit identity and cleanup remain unexecuted until Root supplies
the fresh frontend/deployment bindings.

Combined lightweight regression with the existing bootstrap and five-dataset
contracts passed 68/68:

```sh
node --test \
  modelingweb/app/tests/owned-module-editor.test.mjs \
  modelingweb/app/tests/owned-modeling-bootstrap.test.mjs \
  scripts/tests/owned-five-dataset-browser.test.mjs
```
