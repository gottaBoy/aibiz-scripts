# ModelDesign Registry Repair

Date: 2026-11-11, Asia/Singapore.

## Status

Exactly five missing model-instance registrations are restored: PSSysDBScheme,
PSSysApp, PSSysSFPub, PSSysServiceAPI and PSSubSysServiceAPI. The registry now
has 26 entries. No blanket recovered registry, role/grant changes, root-check
changes or extended JWT lifetime were introduced.

This does not close Modeling IDE acceptance. The checklist remains
**5 VERIFIED / 25 not fully verified** out of 30 engineering items.

## Build And Owned Runtime

- Permission receipt `modeling-permission-registry-20261110-r1`: 134 focused
  tests, 274 full-reactor tests, including ten actual factory tests.
- Package receipt `backend-source-package-registry-20261111-r1`: 356 positive
  tests; three zero-test placeholders explicitly provide no coverage.
- Image receipt `backend-source-images-registry-20261111-r1`: allinone,
  gateway and provider bytes are bound to that source-built package.

These reports live under `.artifacts/`; builds alone are not native
acceptance or complete source/dependency closure.

Fresh fixture `25dd6a7232c7`, subnet `10.93.0.0/24`, has private run-owned
MySQL and eight backend peers. The first workflow bootstrap refused extra
UAA/Redis peers before workflow SQL. The exact two premature containers were
removed with an unchanged MySQL identity/configuration/lifecycle witness,
recorded in `uaa-bootstrap-reorder-r1/report.json`. No guard was weakened.

The successful sequential receipts under
`.artifacts/native-nonadmin-fixtures/25dd6a7232c7/` are:

1. `workflow-schema-registry-wf-r2`: exact-library schema.
2. `ebsx-schema-registry-ebsx-r1`: model-derived schema.
3. `platform-schema-registry-platform-r1`: native platform schema.
4. `uaa-runtime-registry-uaa-r2`: sixteen actual security checks; 20,000ms JWT.
5. `backend-runtime-registry-backend-r1`: source-built backend transport.
6. `ebsx-directory-registry-directory-r1`: real five-row directory transaction
   and complete-column readback.

Old fixtures `5d3585516a77` and `96ff5681e447`, and shared port 30250, were
not modified.

## Native Records And HTTP

The first DBScheme native CREATE returned 200 but the verifier stopped on a
wrong system-name assumption. Source runtime normalizes model-instance DTO
names from the authenticated PSDevSlnSys context; App/SFPub SELECTs instead
project the physical system name through their actual joins.

Failed initialization `registry-native-r1` is retained. Experimental
continuations preserved the already created row, then also exposed a
pre-dispatch JWT-age refusal. All `r1` through `r4` receipts remain unchanged.
The final experimental result has eight native-created rows, four per root,
with physical model versions 820/820. This is not a fresh successful run of
the final initializer.

Review found the experimental resume path lacked a complete historical
source/snapshot chain. Its scripts were archived verbatim under
`.artifacts/editor-registry-experiment-20261111-r1/`, then the production
resume CLI and baseline bypass were removed. The maintained initializer
still requires empty editor tables and the original module/system/version
baseline. Caller-supplied resume records cannot bypass it.

PSSysApp remains blocked: the actual PSPF, PSPFStyle and PSAppType fetch
routes are source-published in ModelAPI and the ModelDesign application
models. The owned route probe/launcher originally omitted those top-level
paths; the exact three POST routes are now published and read back through
Nacos. The maintained registry also now registers PSPF, PSPFStyle and
PSAppType as configuration entities, so ordinary editor reads select the
read-only `PSConfigDEAccessManager`.

Fresh backend image `backend-source-images-config-registry-20261111-r1` and
owned backend `backend-runtime-registry-backend-config-r6` prove the
authenticated editor can call all three routes with native `200 []` responses.
The metadata schema contains zero rows in all three tables, so this is a
real empty configuration state, not an authorization or routing failure.
No platform/style/type identifiers or rows were invented.
Ten-row initialization and the full five-entity 60-cell matrix remain open.

The four available entities were queried by all six ordinary actors against
both roots through the published POST methods. The initial partial receipt
`editor-registry-registry-partial-r2/report.json` passed 48 cells:
16 allowed nonempty responses and 32 actual403 denials. Before/after every
request, all 848 physical tables and 30,660 columns were unchanged.

The final probe separates partial/full flags and couples status to exact
coverage: full means ten records/five entities; explicit partial means eight
non-App records plus both App blockers. The final-source replay is
`editor-registry-registry-partial-r3/report.json`; a four-entity result cannot
set full five-entity acceptance. Native editor save and complete permissions
are separate from this bounded READ evidence.

## Browser Findings

The latest source-built IDE frontend was bound to the fresh backend using
new isolated/owned launch receipts. Actual Chinese desktop runs are retained
under `.artifacts/owned-five-dataset-browser/`.

- `registry-a-editor-zh-desktop-r1` exposed missing harness allowances for
  normal refresh and the read-only todo count; these are now narrowly allowed,
  not mocked.
- `registry-a-editor-zh-desktop-r2` reached the index but did not pass dataset
  navigation: system bootstrap returned401; extension-model/todo requests
  returned404; index content intercepted pointer events at the System menu.
  No forced click, controller injection or fake response was used.

The two temporary frontends and bridge processes were cleaned through the
state-bound owned launcher. Eight backend peers remain retained. No accepted
or usable browser environment is claimed.

## Next Work

1. Prepare a new source-bound fixture with real PSPF/PSPFStyle/PSAppType
   configuration rows, or bind an existing reviewed source configuration
   dataset. The current fixture has zero rows, so PSSysApp native creation
   remains correctly blocked.
2. Diagnose the real browser bootstrap401 and menu/content hit-test overlap.
3. Run a fresh final-source initializer, all five nonempty datasets, and
   multi-role Chinese/English desktop/mobile browser workflows.
4. Verify native editor save/fresh-session readback, conflict and readonly
   behavior. Keep Central current-member/scope authorization separate.

The initial full scripts run was 4991 pass / 3 fail / 0 skipped. The failures
were two stale controlled-suite counters and one old backend-image selector.
They were updated without weakening gates. Focused related regression then
passed 380/380, zero skipped; final full regression is recorded separately.

The source-bound full replay `current-source-regression-20261111-r2` retained
4996/4997 passing tests and stable source. Its sole failure exposed an actual
bridge cleanup race: Linux can clear argv before the process reaches Z.
The launcher now waits briefly only for the same kernel start ticks/UID to
reach a terminal state or disappear. Changed live identity, PID reuse,
foreign UID and non-ENOENT errors still refuse signalling. Deterministic
negative cases and the real forced-termination test pass in the focused
50/50 launcher suite. No failed report was overwritten.

The previous full scripts replay after the route/config additions reached
**5000/5001** with zero skips and one stale backend-image evidence selector.
That selector is now corrected; the affected required-gates suite passes
271/271. The earlier stable full replay remains
`.artifacts/current-source-regression-20261111-r3/report.json`; this tooling
regression does not close the remaining 25 engineering items.
