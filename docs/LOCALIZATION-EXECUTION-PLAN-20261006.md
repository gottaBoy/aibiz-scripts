# Local Source And Native Acceptance Execution Plan

Updated: 2026-10-06, Asia/Shanghai.

## Current Automatic Work Queue

This is the maintained execution plan for the user's request to plan and
automatically finish the whole goal. Continue the existing work rather than
starting another reconstruction or replacing historical receipts.

The final deliverable is a maintained development workspace, not a collection
of successful experiments under `.artifacts`. Every required own component
needs an editable canonical source directory, pinned dependency metadata,
documented local and Docker build entrypoints, and current native evidence.
Artifact directories hold immutable snapshots and reports; they are not the
only place a developer can modify or rebuild the implementation.

At the 2026-10-06 integration checkpoint, all 14 mandatory work items still
require final-input closure. Several build, unit and controlled-browser
subchecks already pass. Do not interpret the remaining 14 closure decisions
as 14 unimplemented components or turn test counts into a completion percentage.

| Order | Concrete Next Work | Owner | Exit Evidence |
|---|---|---|---|
| 1 | Correct the token-security probe for the real stateful OAuth token store; validate issued-token signature, real expiry and revocation in a separately owned short-TTL environment | Meitner, independent Carson review | Issued-token positive controls and real-chain negative evidence; retained r7 UAA/Redis/MySQL are not stopped, replaced or reconfigured |
| 2 | Deploy the independently verified allinone/provider/gateway images on the owned private network; stage scoped configuration and model inputs, then bind exact inspected transport | Main / Aquinas | Fresh immutable startup report and v2 deployment pins; no shared UAA, metadata, model schema or administrator substitute |
| 3 | Finish canonical UAA/starter source-closure replay, Task's real compile/publish/runtime cases and the all-component compiler matrix | Meitner / Mencius | Maintained UAA source/tools already exist; final build still must reject editable implementations from old report snapshots and compiled-own fallback; current closure verifiers consume fresh receipts |
| 4 | Rebuild ModelDesign with the final runtime `.2` input; finish both-app boot, resource delivery and 11 actions; finish PLM and all 73 referenced plugin matrix rows | Popper / Laplace | Actual served bytes match the current builds; desktop/mobile success, empty, error and permission cases are individually recorded |
| 5 | Run the owned backend permission matrix, native edit/save/new-login readback and cleanup | Main / Aquinas, independent Carson review | Exact owned deployment transport and identities; two physical model schemas; unauthorized requests return 403 without either schema changing |
| 6 | Clean Docker builds for every required component, isolated restart/migration/persistence replay, final Harness and review, then task-owned commits | Main / Mencius and lane owners | Final source/artifact/image/HTTP bindings, zero required failures/skips/missing cases, version relations and reconstruction boundaries recorded |

Orders 3 and 4 may prepare independent fixes while 1 and 2 execute. Their final
promotion waits for the dependency receipts. If a probe exposes another defect,
keep its failure report, fix that defect, and rerun the affected checks in a new
run directory; do not stop the queue merely to ask whether to continue.

### Current UAA Startup Evidence

Historical frozen source/image inputs are
`.artifacts/standalone-uaa-editable-20261006-E1/build-MGQ6RI/report.json`
and `runtime-OKuP6m/report.json` in the same lane. The actual r3-r6 native
probes are retained under
`.artifacts/native-nonadmin-fixtures/35f401494e9d/uaa-runtime-20261006-boot-rN/`.

The probe derives HTTP transport from the exact inspected owned internal
bridge endpoint without host publication, supplies console-only logging for
the non-root/read-only image, disables external bootstrap/discovery early, and
disables the incompatible old JAXB bytecode optimizer. The retained r6 failure
is a genuine duplicate `/appdata` mapping failure, not the current startup
state.

The maintained source root is `standalone-uaa/source`, with editable build,
dependency and regression tools under `standalone-uaa/tools`. The current r7
runtime consumes `.artifacts/standalone-uaa-source-build/build-SKWDge/report.json`
and `.artifacts/standalone-uaa-source-runtime/runtime-Lwcbbo/report.json`.
Its receipt is
`.artifacts/native-nonadmin-fixtures/35f401494e9d/uaa-runtime-20261006-maintained-r7/report.json`.
Actual BootApplication startup and all 13 HTTP checks pass: anonymous denial,
six scoped login/self identity cases and six wrong-password cases. Canonical
source promotion and this scoped startup/login milestone are complete; full
source closure, permission and native acceptance are not.

The later retained security replay at
`uaa-runtime-retained-replay-security-r1/report.json` passes the same 13 checks
but fails all three new security checks. The current probe re-signs a token
without adding it to the actual OAuth token store; the positive control returns
401. This is not proof of a source signature/expiry defect or of secure expiry
handling. Correct the probe against `OAuth2TokenAdapter.validateToken()` and
`tokenServices.loadAuthentication(token)`, then obtain real issued-token expiry
and revocation evidence in a new independent short-TTL fixture. Preserve the
failed replay and the retained r7 resources.

Fresh focused regression on 2026-10-06: 95 passed, 0 failed, 0 skipped across
the UAA runtime, nonadmin fixture/matrix, application-account, permission HTTP
and independent preflight test files. This checks harness contracts only.
Re-run after any later edit and keep native/source/permission acceptance false
until their own evidence passes.

## Objective And Rules

All iBiz-owned components must be editable locally, buildable locally and in
Docker, and exercised through the actual modeling and PLM workflows. Third-party
open-source packages are dependencies, not source-localization targets.

The user explicitly requested runtime-model reverse engineering on 2026-10-06.
A reconstruction is an independently versioned compatible candidate, not
authenticated original source. Preserve original observations and historical
failures. Do not rename reconstructed files as recovered upstream originals.
Unknown upstream licensing remains unknown; a private candidate manifest does
not grant redistribution rights.

Continue implementation automatically in the order below. After each change,
run focused regressions; broaden regression for shared contracts. Use
independent agents for implementation, differential tests and review.
Do not skip failed cases, weaken existing gates, count fixture-host tests as
native acceptance, or commit before all required acceptance results pass.

## Execution Contract

The queue has 14 mandatory work items, S01-S07, N01-N04, D01-D02 and H01.
Each item has a dependency and an evidence-based exit criterion below.
Passing test counts are not a percentage of the implementation remaining.

Finish own-source closure before promoting further business features.
Parallel lanes may repair defects and prepare isolated regressions while
source acquisition/reconstruction runs; they cannot promote the final stack
before its source dependencies are closed. Third-party open-source libraries
remain pinned dependencies and are not reconstruction targets.

For each work item, retain the exact component/package version, editable
source location and classification, source fingerprint, local/Docker build
command, output fingerprint, actual deployment identity and test report.
Original source, reconstructed compatible source, observed compiled artifacts
and third-party dependencies remain distinct classifications. Local
reconstruction does not authenticate upstream originals or unknown licensing.

The automatic loop is: reproduce -> implement a scoped repair -> focused
regression -> affected native/browser/API regression -> independent review ->
update current evidence -> take the next dependency-ready item. A failure
continues that item's repair work and blocks its promotion, not independent
lanes. Final commits require every required item to pass on the final inputs.

## Stages

| Stage | Current Status | Exit Criteria |
|---|---|---|
| 1. runtime-model reconstruction | `.1`/`.2` source receipts reverified; both public-entry desktop/mobile browser suites pass with executable-graph HTTP hashes; native integration pending | Editable business and four component sources; actual strict typecheck and Stencil build; pinned dependencies; original-vs-built differential tests; browser loader, methods, attributes, events and workflows; source/output receipts; no import of observed compiled iBiz code |
| 2. model-design complete build | Historical v7-v10 build evidence retained; v10 both apps pass all eight component stages, but ModelDesign boot still fails. Four current script failures reject stale runtime-source bindings; rebuild against the final `.2` input before promotion | Fix 22 index diagnostics in an isolated candidate; use a genuinely source-built loader; fix resource delivery; full declared build and typecheck pass; dist/es/lib resources match all 1414 verified inputs; all 11 actions retained and tested |
| 3. Native modeling and access control | Current eight-suite focused/full-core receipt independently verified: 124/252 pass; physical-library/non-admin/native acceptance pending | Install matching candidate/runtime assets; validate the real permission implementation and model-root binding; isolated physical model database and non-admin editor/viewer/no-access accounts; edit, save, new-session readback; cross-library negative tests; no unexplained console errors or plugin 404s |
| 4. PLM and plugin acceptance | Isolated wizard v8 deployment running on 30252; complete business/plugin matrix pending | Version ledger passes; every model-referenced plugin maps to its editable source and built output; native functional matrix covers success, empty, error and permission cases; no untested feature reported as complete |
| 5. Local Docker reproducibility | Standalone UAA editable API/core/user compilation passes at scoped report level; full UAA/Task closure, stale platform images and all-component replay remain unresolved | Clean source builds for the required services/frontends/plugins; image/source/output identity matches running containers; startup, restart, database migrations and persistence regressions pass; no prebuilt iBiz runtime silently used |
| 6. Full Harness and delivery | Automatic serial runner implemented; latest eight-step baseline FAIL, 4 pass/4 fail/0 skip. Portal readiness repair passes focused and desktop/mobile checks; full acceptance still pending | Required CI/Harness and native workflows all pass with zero skips; desktop/mobile evidence retained; versions/provenance/known differences documented; review finds no unresolved release blocker; then commit task-owned changes |

## Current Evidence Boundary

Before this plan's changes, `npm test --prefix scripts` completed with
2469 passed, 0 failed and 0 skipped. This is a script regression baseline,
not native acceptance and not evidence for subsequent changes.

Other retained baseline results are Maven modeling-core 128 tests with zero
skips, Compose 38 tests with zero skips, and local JDBC live 16 checks.
Re-run the relevant commands after changes; historical passes do not clear
later regressions.

The later full scripts baseline is 3300 passed, 0 failed and 0 skipped,
recorded in `.artifacts/localization-plan-20261006-1546-scripts-regression.log`
with SHA-256
`a7524838cde52af29fa40cd1cd9836242f5091ab0698e8f959f156a88a68323e`.
It predates the expanded eight-suite permission gate. The subsequent full
scripts rerun completed with 3315 passed, 0 failed and 0 skipped in
`.artifacts/localization-plan-20261006-eight-suite-regression.log`, SHA-256
`2b07634e94885253d29f84e8333e8de1b45c80f44b6a4178958129dbc8084cb6`.
This is regression of the script contracts present during that run, not native
acceptance or evidence for later source edits.

The latest serial localization baseline is
`.artifacts/localization-regression/run-57d49439-4499-49bf-b430-caab8143a5ba/report.json`,
SHA-256
`ca9e9abbe98f2c17e073a0f5f9fcdd21b94018b6cbaa590c66c77aade24d1201`.
It records 8 required steps: 4 passed, 4 failed, 0 skipped. Its script-contract
step records 3477 passed, 4 failed and 0 skipped out of 3481 tests; the four
failures are stale native model-design/runtime source bindings, not optional
tests. Offline versions, PLM test configuration, required modeling runtime
and required external UI pass. Live versions, required own-source gates and
Task archive inputs fail. This is the current repair baseline, not acceptance.

| Baseline Blocker | Repair And Retest |
|---|---|
| Three runtime-assets tests and one model-design source-integration test reject old runtime input fingerprints | Build a new immutable model-design candidate against the current verified `.2` package; bind tests to the new report and rerun without weakening drift checks |
| Live ledger rejects allinone/gateway source-image receipts | Perform real isolated source/image rebuilds, verify deployment identity and refresh only current bindings; historical failures stay intact |
| UAA, Task and all-component Docker closure remain unverified | Finish compatible editable own implementations, build inside Docker, retain full ownership/protocol/resource/package evidence and independently replay |
| Task `xmlbeans-2.6.0.jar` repeats `org/apache/xmlbeans/xml/stream/Location.class` | Resolve the malformed third-party archive with a verified compatible dependency, preserve the fail-closed duplicate audit and rebuild Task |

The earlier model-design alpha.122 build failed full build/typecheck (23
diagnostics) and lacked es/lib resource delivery. That failure remains
historical evidence. A subsequent isolated local candidate repairs 22 TS7053
diagnostics and consumes the verified source-built runtime-model loader. Its
full declared build, typecheck and three 1414-file resource copies pass;
the 11 action registration keys are preserved. The subsequent `.2`-bound v7
report records a verified dependency lock and reproducible outputs. Actual
action workflows and alpha.90 compatibility remain unverified, and a later
native readonly/lifecycle failure prevents acceptance of the final candidate.

Runtime-model original source/config/license were not obtained. The observed
compiled package has seven MJS files and no source map. The independently
versioned `0.2.2-local.1` reconstruction has strict typecheck, a double Stencil
build with identical 91-file outputs, 77 focused unit checks, and 12
desktop/mobile fixture-browser checks passing without skips. The browser
report loads `dist/esm/loader.js`; the public `loader/index.js` chain still has
its own provenance audit. The four components explicitly share
`ibiz-model-runtime_4`, restoring the observed mounting/scroll behavior.
Seven deliberately retained original defects require a separate local
revision and intentional-difference regressions. None of this is native
acceptance or authenticated original-source recovery.

The current public-entry browser refresh imports `loader/index.js` (the
original uses `loader/index.mjs`) and verifies the bytes of the complete
actually requested executable graph. Both `.1` differential and `.2` fixed
suites pass all 10 desktop/mobile scenario cases, each with Node totals of
12 passed, 0 failed and 0 skipped. The totals include provenance and the parent
test; they are not 12 independent workflows.

This refresh changes only test synchronization, not runtime business source:
wait for the actual scroll endpoint on new column mounts; label initial
events before mounting; and hold replacement root-child responses until the
old list is observably removed. The same controlled response boundary applies
to original and reconstructed `.1` sides. Full DOM/layout/scroll/event/API
comparisons remain. A reused cached `.2` column is not required to fire a new
mounted event or start a new endpoint animation. Preserve the earlier failed
scroll, mounted-event and stage-label reports listed below.

| Evidence | Reviewed Verdict | Retained Report |
|---|---|---|
| runtime-model double source build | `sourceBuildVerified=true`, `reproducibleBuildVerified=true`, `nativeAccepted=false`; exit 2 is partial evidence | `.artifacts/runtime-model-source-build/build-d29dd4cb-76ab-4764-8797-4d44263e6840/report.json` |
| runtime-model original-vs-built browser | 12 passed, 0 failed/skipped; controlled APIs, not native acceptance | `.artifacts/runtime-model-reconstruction-browser/source-build-bundled/report.json` |
| model-design local source candidate | Typecheck/full declared build/three resource copies verified; native acceptance false | `.artifacts/native-model-design-local-candidate/build-20261006-alpha122-source-runtime-bundled-v3/report.json` |
| Native modules read projection | 13 required checks pass with explicit root context; not permissions, isolation or edit/save acceptance | `.artifacts/native-model-modules-live-20261006-runtime-source/report.json` |
| runtime-model `.2` current double source build | Independently reverified current-source receipt; exit 2 explicitly means native acceptance is false. The older `build-500537af` is retained history, not a current binding | `.artifacts/runtime-model-source-build/runtime-model-next-quality-request-id-20261006/report.json` |
| model-design `.2`-bound v7 | Reviewed report fields: full declared build, typecheck, dependency lock, reproducibility and resources pass; native loader delivery/compatibility/acceptance false. Reverify after lifecycle edits | `.artifacts/native-model-design-local-candidate/build-20261006-alpha122-runtime2-locked-v7/report.json` |
| Backend cached negative authorization | Fresh isolated Docker regression: 34 focused / 162 full tests, zero failures or skips; not native acceptance | `.artifacts/modeling-core-cache-fixed-20261006-qszuuB/focused.log` and `full.log` |
| Backend holder/request-cache reproducer | Historical 8-test reproducer: 6 failed, 0 errors/skips; retain the failure. Later seven-suite/full regression is listed separately | `.artifacts/modeling-core-request-cache-20261006-pwX5co/reproducer.log` |
| Backend historical permission regression | Earlier verified receipt: 86 focused / 238 full core tests, zero failures/errors/skips; seven-suite evidence cannot satisfy the expanded focused gate | `.artifacts/modeling-permission-regression-20261006-50ae2cfa-ef92-4d01-9555-96759299655e/report.json` |
| Backend current eight-suite permission regression | Independently verified current-source receipt: 124 focused / 252 full core tests, zero failures/errors/skips; `unitRegression=true`, `nativeAcceptance=false` | `.artifacts/modeling-permission-eight-suite-20261006-final/report.json` |
| Permission Harness focused regression | Fresh verifier regression: 89 pass, zero failures/skips; rejects omission of the JSON-cache/cross-center/no-root suite. Not a running-service test | `.artifacts/modeling-permission-eight-suite-20261006-focused.log` |
| Native model-design earlier failure | Both apps fail readonly-toggle timeout and Monaco editor/model disposal; module/worker delivery and edit-prop stages pass; retain the failure | `.artifacts/native-model-design-runtime/s07-monaco-url-20261006-raw/report.json` |
| Native model-design historical v9 run | Central all eight component stages pass; ModelDesign readonly fails, cleanup passes. Overall FAIL; retained history, not native editor/save acceptance | `.artifacts/native-model-design-runtime/s07-model-design-v9-lifecycle-20261006-auth/report.json` |
| Native model-design latest inspected v10 run | Both apps pass all eight component stages. Overall FAIL: ModelDesign console-terminal package 404 and rootless `fetchcursys` 500 produce six boot errors; Central boot errors empty. Not edit/save/new-login or final-source acceptance | `.artifacts/native-model-design-runtime/s07-model-design-v10-lifecycle-20261006/report.json` |
| Standalone UAA starter first build | Failed Maven Central transfer of `tomcat-embed-core:9.0.73`: expected 3438924 bytes, received 2790080. Retain failure; later fresh run does not erase it | `.artifacts/standalone-uaa-starter-build/build-36b816b2-2862-444c-9e44-aa5c677f7746/report.json` and `maven.log` |
| Standalone UAA starter subsequent build | Inspected report: Java compilation and Docker compiler pass; `standaloneSourceBuildVerified=false`, `nativeAcceptance=false`. API/core/user implementations and real protocol acceptance remain required | `.artifacts/standalone-uaa-starter-build/build-a529e8bb-d198-47e9-a823-9c1f5e92d737/report.json` |
| Standalone UAA editable E1 experiment | API/core/user Java compilation and Docker compilation pass; full standalone source closure and native acceptance remain false. Independent reconstruction, not authenticated original-source recovery | `.artifacts/standalone-uaa-editable-20261006-E1/build-dDuMiA/report.json` |
| Maintained UAA source/build/runtime | Canonical editable source/tools outside `.artifacts`; scoped source build, actual BootApplication and 13 HTTP checks pass; full own-source/native/permission closure remains false | `.artifacts/standalone-uaa-source-build/build-SKWDge/report.json` and `.artifacts/native-nonadmin-fixtures/35f401494e9d/uaa-runtime-20261006-maintained-r7/report.json` |
| Retained UAA security replay | Original 13 checks pass, three security checks fail; re-signed positive control is absent from the stateful store, so expiry/signature enforcement is not yet established | `.artifacts/native-nonadmin-fixtures/35f401494e9d/uaa-runtime-retained-replay-security-r1/report.json` |
| Independently reverified backend source images | allinone/gateway/provider image/artifact byte bindings pass; report SHA256 `c917bfa49f24efaed1465d206760306460c2ee872b5f16f26643e8dc6214c3f1`; source closure, isolated startup, permission and native acceptance remain false | `.artifacts/backend-source-images-57a21f78-efe8-42b5-aafd-4842e19b5e9f/report.json` |
| Independent compiler mechanism | CLI control receipt records actual Docker compilation of one Java source; not UAA/Task own-source closure or all-component D01 acceptance | `.artifacts/compiler-in-docker/d01-20261006-r3/cli-run/receipt.json` |
| Public-loader provenance and settlement checks | 41 provenance checks plus 14 settlement/fixture-contract checks pass in focused runs; rejects missing/swapped/stale executable resources and intermediate scroll positions. Not native acceptance | `scripts/tests/runtime-model-loader-provenance.test.mjs` and `scripts/tests/runtime-model-browser-settlement.test.mjs` |
| `.1` current public-entry browser parity | All 10 desktop/mobile cases pass; both sides' actual executable HTTP bytes verified; `nativeAcceptance=false` | `.artifacts/runtime-model-reconstruction-browser/probe-9c33a2e0-fbb5-4ba8-ac6e-20e87cce36b5/report.json` |
| `.2` current public-entry fixed browser | All 10 desktop/mobile cases pass; 12 total Node tests including provenance and the parent, zero failures/skips; served public loader and executable graph verified against the current build; `nativeAcceptance=false` | `.artifacts/runtime-model-next-browser/probe-cfe5af9b-28b2-4996-9f3b-0ee2c18206af/report.json` |
| Independent runtime browser review and replay | No confirmed blocking finding; 55 provenance/settlement tests and both 12-test public-entry browser suites pass, zero failures/skips. The browsers remain controlled fixtures, not native acceptance | `.artifacts/runtime-model-reconstruction-browser/probe-1168e4c8-4566-4d30-8635-fc3aa5384d89/report.json` and `.artifacts/runtime-model-next-browser/probe-0dde5e5c-0a63-4e8e-9db3-2389d7fbf07b/report.json` |
| Retained `.1` mobile mounted-event mismatch | Failed comparison before deterministic pending-child/empty-render boundary; not a pass and not evidence of a runtime-source fix | `.artifacts/runtime-model-reconstruction-browser/probe-c9857d75-bc4c-4786-9183-02847801bdc5/report.json` |
| Retained `.1` initial-stage label mismatch | Both workflow comparisons failed; initial stage was assigned after mounting. Later pre-mount label repair does not erase this run | `.artifacts/runtime-model-reconstruction-browser/probe-54d2a8d5-6bb8-4df5-931e-74c801db0b72/report.json` |
| Retained `.2` cached-column endpoint timeout | Mobile workflow failed because a reused cached column does not remount/start endpoint scrolling; mount endpoint still required in the corrected test | `.artifacts/runtime-model-next-browser/probe-5a4bf601-07db-4878-8e8b-7c8a993750a9/report.json` |
| Current inspected required source gates | 3 required gates, 0 pass, 3 fail, 0 skips: UAA, Task and all-component Docker closure remain unresolved. Scoped compiler integration now exists but is not full D01 acceptance | `.artifacts/required-source-gates/audit-872a4fcc-f54e-43e9-bdf8-9752f131a5d0/report.json` |
| Required project portal | 9 checks pass with no console/page/request/HTTP errors; portal availability only, not business or source acceptance | `.artifacts/external-ui/2026-10-06T07-55-34.114Z-1f7851de/report.json` |
| Portal readiness repair | `/healthz` and `/api/status` no longer traverse historical reports; all five upstream dependencies remain mandatory. 57 focused tests pass, zero failures/skips. Isolated and project desktop/mobile portal checks pass after portal-only reload; not business acceptance | `.artifacts/harness-ui-health-20261006-project-desktop/report.json` and `.artifacts/harness-ui-health-20261006-project-mobile/report.json` |
| Live version/source ledger | FAIL: local allinone and gateway receipts bind the old source hash, not the current service-hub source. Other provenance warnings remain; retain failures and rebuild isolated candidates | `.artifacts/localization-plan-20261006-version-ledger.json` |
| Current evidence/docs focused regression | Permission verifier, version ledger and local-documentation contracts: 123 pass, zero failures/skips. Not a native or live-ledger pass | `.artifacts/localization-plan-20261006-current-evidence-focused.log` |

The historical `.1` `build-d29dd4cb` source-build report SHA-256 is
`61fef68adefb10918750c6593418eab357e7d1dc8ca6ffaa6e771236417d7910`;
its output fingerprint is
`371482ac7c777783a5da3df089090774f7f4657795f8f97336fcbfafa0129f55`.
Revalidate receipts against current inputs before consuming them. Retaining a
report does not make it current after another source change.

The active `.1` browser input is
`.artifacts/runtime-model-source-build/build-20261006-model-design-input-implementation-pins/report.json`,
reverified with SHA-256
`28329ad00c236b5011288535e204de79cbd0d7ac3c0fece93e6ccada96a5fa33`.
The active `.2` `runtime-model-next-quality-request-id-20261006` report SHA-256 is
`9b38bb1b707038a0f309a12a9eadf4d55a82fd918de3b82780cb1eba847be363`.
Both verifiers exit 2 with `verified-source-build-not-accepted`, not native pass.
The current `.1` browser report SHA-256 is
`692fa3fa6f5acb0e513214d4291379838e9e91f79bf309fb07a977181d70fe53`;
the current `.2` browser report SHA-256 is
`ee95048421a37bf7314d5f6d73dacf8d977d393898df705f045981852e29ffaf`.
Earlier `.2` receipts fail current-source verification after the request-ID
controller repair. The current controller source SHA-256 is
`621f96041dc9ed2f447849be78ce1059031881aba91ea3ef541b58f249a3c51e`.
Rebuild downstream consumers; do not edit an old report's fingerprints.

The current independently reverified eight-suite permission report SHA-256 is
`0fe34b13bf16a5dbb793f5c176a9b4f05e3fb4aed7a3113ceb5123c73f79e4ca`.
Its 124/252 tests and the Harness verifier's 89 tests are different evidence sets;
do not add them together as a feature-completion measure.

The live ledger records old image-receipt source SHA-256
`eee6d16b8b901597dc68b9f99fedca11b1c21b455fb2b48de75610d05438d34b`
against current service-hub source SHA-256
`ced2d049e36ef0eb11e87cd52aad213d44652a4999893ab87012f6abef1de18b`.
Do not edit historical receipt hashes or restart shared services to conceal the
mismatch. Use run-owned source snapshots, images and isolated deployment
identities; a final live ledger must bind the final source revision.

## Priorities And Ownership

| Owner | Current Lane | Files And Evidence Boundary |
|---|---|---|
| Main thread | Plan, automatic regression queue, portal readiness, versions and final-input integration | Portal-only reload after isolated tests; no business-service restart or replacement of another lane's evidence; physical-library preparation with Aquinas |
| Carson | Backend fixes frozen after current focused/full regression; independent review of the automatic runner and portal repair | Current eight-suite receipt reviewed by main; retain hidden public fields; no live provider replacement |
| Popper | Final model-design rebuild against current `.2`, console delivery, rooted both-app native rerun and edit/save | Isolated candidate; runtime/Monaco/pluralize mapping; no shared service restart or relaxed source-drift tests |
| Laplace | PLM desktop/mobile and plugin functional matrix | Isolated deployment on 30252; bind served hashes to its fresh build |
| Mencius | Required Harness, independent compiler replay and own-source closure verifier | No skipped required checks, relaxed assertions or fixture promotion; wire real evidence only after review |
| Aquinas | Independent permission/root-routing and scoped-account fixture review | Preserve `.1`/`.2` receipts; no conflicting main production-file edits |
| Meitner | Standalone UAA editable implementations, starter build and Task source closure | Legacy IBZUSER is not standalone UAA; inspect current Complie code; do not delete unresolved own bytecode without compatible editable replacement |

Independent source work can run concurrently. Native integration waits for
verified source-built inputs. Broad browser acceptance waits for the final
source revision and deployment identities. Final delivery waits for all lanes.

## Automatic Execution Order

These are mandatory work items, not an estimate based on passing test counts.
Failures remain failures; record and fix the cause, then rerun the affected
tests. Do not advance a source-localization gap as complete because an old
compiled package or registry image works.

| ID | Work Item | Depends On | Completion Evidence |
|---|---|---|---|
| S01 | Inventory every iBiz-owned frontend, backend, toolchain and model-referenced plugin | Existing source audit | Exact consumer/version/source/build/deployment mapping; missing/reconstructed/original classifications retained |
| S02 | Verify runtime-model source, deterministic build and observed baseline | S01 | Strict typecheck, double build and unchanged baseline differential reports |
| S03 | Verify public loader, exports and browser-loaded dependency bytes | S02 | Public entry import, exact served file hashes, all four hydrated elements and desktop/mobile regressions |
| S04 | Fix seven runtime defects in a separately recorded local revision | S03 and frozen model-design baseline | Cache, pagination, literal/wildcard search, empty-root completion, awaited children, HTTP failures, reactive selection; explicit delta tests plus unaffected parity |
| S05 | Complete model-design source build, delivery and dependency pinning | S02 | Full declared commands/typecheck, 11 action registrations, 1414 JSON files in dist/es/lib, source-built runtime/framework/toolchain receipts |
| S06 | Close remaining backend/UAA/Task own-source gaps | S01 | Real source builds, no throwing stubs or compiled-own fallback; fresh immutable receipts and focused tests |
| S07 | Assemble the final native candidate and verify each plugin's loaded bytes | S04, S05 and required source receipts | Source-to-output-to-model-to-HTTP chain; no unresolved own plugin mapping, initialization errors or required asset 404 |
| N01 | Provision physically separate model databases and scoped non-admin accounts | S06 | Run-owned editor/viewer/no-access users and two libraries; neither shared business data nor admin privileges substituted |
| N02 | Verify root binding and read/write authorization | N01 | Positive/negative cases for all roles, missing/malformed/foreign roots and cross-library record IDs; unauthorized writes do not alter either database |
| N03 | Native model edit/save/new-session readback and all 11 model-design actions | S07, N02 | Browser clicks, real requests, persisted readback from a fresh login, cleanup verified |
| N04 | PLM business and every referenced plugin functional matrix | S01 and final PLM source build | Desktop/mobile success, empty/error/permissions, create/update/readback/delete and plugin-specific interaction evidence |
| D01 | Clean local Docker source builds for every required own component | S01-S07 | Pinned third-party tools allowed; compiler runs inside Docker; own artifacts traced to current editable source |
| D02 | Isolated boot/restart/migration/persistence and image identity | D01, N01-N04 | Running image ID plus mounted/served hashes, repeatable startup, idempotent migrations and surviving data |
| H01 | Required full Harness, independent review and delivery | All above | Zero required skips/failures, no missing coverage or unresolved release blocker; task-owned commits only |

The earlier UAA/Task readiness and Task throwing-stub findings must be
revalidated. Neither is dropped from S06/D01 merely because frontend tests pass.
Unknown runtime-model licensing is a separately recorded redistribution
constraint, not permission to relabel the reconstruction as original source.

## Next Execution Batches

These batches provide an automatic queue, not a time estimate. Keep each failed
run and retry in a new run-owned directory. A ready independent lane may proceed
while another lane is fixing a failure; promotion to the final deployment still
requires every dependency's current receipt.

| Batch | Actions | Required Decision Before Advancing |
|---|---|---|
| A: close own-source/build gaps | Meitner acquires or reconstructs the matching standalone UAA API/core/user implementations, verifies starter outputs, and closes Task loose-class/dependency ownership. Mencius supplies independent compiler/closure verifiers. Main refreshes consumer/version/source mappings | Every required iBiz-owned input is editable or explicitly classified as an independently reconstructed compatible candidate; no legacy-contract substitution, throwing stub or compiled-own fallback; successful fresh builds do not alone prove protocol compatibility |
| B: repair and freeze final frontend inputs | Popper fixes readonly propagation and Monaco editor/model disposal, rebuilds model-design with `.2` runtime and pinned dependencies, and reruns Central and ModelDesign. Laplace fixes PLM wizard/remaining plugin defects | Exact served bytes bind to final editable inputs; both native apps pass required loader/editor lifecycle checks; independent receipt verification succeeds after the last change |
| C: native modeling/API permissions | Main and Aquinas provision two run-owned physical model databases and non-admin editor/viewer/no-access identities; validate the real UAA joins/encoder, Redis codec and root routing; exercise unauthorized writes and cross-library record IDs | Role and root matrices pass through the final source-built backend; denied requests leave both database projections unchanged; reserved API/superadmin roles and shared business data are not used as acceptance shortcuts |
| D: business and plugin completion | Native edit/save/new-login readback and every model-design action; PLM desktop/mobile CRUD and every one of the 73 model-referenced plugins across success, empty, error and permission states | Test-to-feature roster is exhaustive for the recorded model revision; missing, skipped, blocked, fixture-only and unavailable-required-integration cases remain failures, not passes |
| E: clean Docker replay and persistence | Rebuild all required owned services/frontends/plugins in isolated source snapshots; bind image IDs and mounted/served hashes; boot, restart and replay migrations and saved-data reads | Source-to-compiler-to-artifact-to-image-to-running-service identity verified; third-party pinned dependencies allowed, prebuilt own implementations not allowed |
| F: final Harness/review/delivery | Run each mandatory source, native, browser, plugin, API, Docker and persistence gate against final inputs; independently review changes, record version relations and task-owned commits | Zero required failures/skips/missing coverage, reviewed current receipts, no unresolved release blocker. Portal availability or `test:ci` alone cannot satisfy this batch |

No blanket pass may replace a feature's real workflow. Optional historical
tests stay outside the release denominator; a feature required by the localized
model cannot be moved to that optional set merely to pass.

## Executable Gates

Run from the workspace root, retaining fresh run directories and logs:

```sh
npm run test:runtime-model-source --prefix scripts
node scripts/harness-runtime-model-source-build.mjs --verify-report "$RUNTIME_MODEL_REPORT"
RUNTIME_MODEL_BUILT_ROOT="$RUNTIME_MODEL_PACKAGE_ROOT" \
  RUNTIME_MODEL_SOURCE_BUILD_REPORT="$RUNTIME_MODEL_REPORT" \
  RUNTIME_MODEL_BROWSER_OUTPUT="$RUNTIME_MODEL_BROWSER_OUTPUT" \
  npm run test:runtime-model-browser --prefix scripts
RUNTIME_MODEL_BUILT_ROOT="$RUNTIME_MODEL_NEXT_PACKAGE_ROOT" \
  RUNTIME_MODEL_SOURCE_BUILD_REPORT="$RUNTIME_MODEL_NEXT_REPORT" \
  node --test scripts/tests/runtime-model-next.browser.mjs
node --test scripts/tests/runtime-model-browser-settlement.test.mjs \
  scripts/tests/runtime-model-loader-provenance.test.mjs
node --test scripts/tests/native-model-design-build.test.mjs \
  scripts/tests/native-model-design-inputs.test.mjs \
  scripts/tests/repair-native-model-resources.test.mjs
node --test scripts/tests/modeling-permission-regression.test.mjs
node scripts/harness-modeling-permission-regression.mjs \
  --maven-repository /home/my/.m2/repository
node scripts/harness-modeling-permission-regression.mjs --verify "$PERMISSION_REPORT"
node scripts/harness-uaa-task-readiness.mjs
node scripts/harness-required-source-gates.mjs
node scripts/harness-native-model-modules.mjs --required --report-dir "$MODULE_READ_REPORT_DIR"
npm run test:config --prefix plm-e2e
npm run test:localization:baseline --prefix scripts
npm run test:localization --prefix scripts
npm run test:ci --prefix scripts
```

Set each report/root variable to the exact corresponding fresh artifact.
The UAA/Task command audits current receipts; `--build` also executes their
source builds. Some source probes intentionally return 2 for scoped completion
without acceptance, and 1 for failure: inspect the report's claimed boundary
and exit code without suppressing either. Do not feed a local-candidate report
to the original-input verifier; use the verifier for its actual schema/lane.
The native modules command is deliberately read-only and cannot satisfy N02/N03.
PLM's `test:config` uses its declared pnpm 8.15.9 test entry directly when npm
cannot resolve pnpm. CI success also does not satisfy an unimplemented native,
plugin, UAA/Task or compiler-in-Docker gate.

`test:localization:baseline` runs the eight baseline steps serially.
`test:localization` adds browser contracts, native platform API, native
ModelDesign and PLM desktop/mobile tests including known-issue and deep-sweep
cases. Coordinate native/API/PLM writes with their owners before the full run.
Each run owns a new immutable report/log directory and preserves failed steps
while executing subsequent diagnostics. Nonzero exits (including partial
source exit 2), missing reports, incomplete TAP summaries, skips/todos and
Playwright failures/skips/flakiness fail the queue. The runner does not build,
restart, repair or commit services and cannot replace the independent D01/D02,
permission or exhaustive feature-matrix evidence.

The refreshed required-source runner consumes explicit scoped Java compiler
requests and performs a fresh independent Docker replay. It still fails closed
for missing full UAA/Task own-source/protocol closure and all-component D01
coverage. With no compiler requests, the inspected run records zero selected
projections, not a compiler mechanism pass. A single archive-free Java
projection does not cover full project resources, code generation, own
dependencies, packaging, frontend/plugin builds or deployment identity.

For every implementation change: focused tests first, then affected browser/API
regressions; broaden to the complete suite when shared contracts change.
Record command, source/output/report fingerprints, counts and acceptance scope.
The project portal remains `http://127.0.0.1:19323/#?`; its availability is one
required Harness check, never a substitute for the business matrix.

## Remaining Work Tracking

- [x] Reconstructed `.1` runtime package strict typecheck and double build.
- [x] `.1` differential unit and fixture-browser regressions, with retained reports.
- [x] `.1` source/output fingerprint and rebuild reproducibility checks.
- [x] Public loader entry and actually loaded-asset provenance in both `.1` and `.2` fixture browsers; native loading remains a separate open item.
- [x] Fix seven discovered runtime defects separately in `.2` and record intentional deltas; native acceptance remains pending.
- [x] Full model-design local candidate build and three resource deliveries.
- [x] `.2`-bound v7 model-design report records reproduced dependency lock, double-build identity and loader build input; reverify the final revision after lifecycle fixes.
- [x] Both native apps pass the v10 readonly and Monaco editor/model cleanup component stages; remaining boot errors and stale source bindings block final acceptance.
- [ ] Remaining backend/UAA/Task own-source inventory and build gaps.
- [x] Historical independently verified seven-suite permission and full-core isolated regression; not native acceptance or evidence for subsequent edits.
- [x] Cross-center admin/no-root fixes and fresh eight-suite/full-core regression independently verified against current inputs; native permission verification remains open.
- [ ] Native loading of all required candidate replacements.
- [ ] Real runtime API authorization and model-root context verification.
- [x] Owned SQL fixture: two physical model schemas, six ordinary editor/viewer/no-access identities, scoped application accounts and generated matrix; fixture-only receipts, not native acceptance.
- [x] Maintained source-built UAA actual startup and all six HTTP login/self checks, plus anonymous and wrong-password denial: 13/13 in r7.
- [ ] Correct real-chain token signature, expiry and revocation evidence; retained security replay has three failures.
- [ ] Independently verified permission deployment transport and executed cross-library/native matrix.
- [x] Canonical UAA/starter editable sources and build tools outside historical artifact snapshots; full source-closure replay remains open.
- [ ] Native modeling edit/save/new-session readback.
- [ ] PLM and each referenced plugin functional matrix.
- [x] Independently verified fresh source-built allinone/gateway/provider image byte bindings; historical shared images stay unchanged.
- [ ] All-component clean Docker source closure and actual isolated deployment/restart/migration/persistence identity.
- [ ] Full required Harness, final independent review and commit.
- [x] Automatic serial regression runner with private immutable logs, explicit baseline/full modes and no required-failure suppression.
- [x] Portal health/status report-catalog bypass with positive/negative upstream regression and isolated/project desktop/mobile checks; service readiness is not business acceptance.

Update statuses only after the corresponding commands and evidence are reviewed.
No percentage or completion deadline is inferred from test counts.

## Active Backend Acceptance Blockers

The current isolated regression covers holder/request-cache validation, hidden
codec fields, scheme-grant checks and inconsistent-root denial. These are no
longer simply "awaiting unit regression". Before N02, retain that evidence and
verify the same contracts in the final running backend:

- Restrict center-admin SYS/SLN elevation to the target's real owning center;
  recheck live target ownership on cached admin results, not only cached
  declared center IDs. Explicit object membership is a separate authorization.
- Keep no-root `getAppData` valid when optional SYS authorization is absent;
  do not dereference a null optional authorization or replace denial with an
  implicit admin/model root.
- Revalidate holder, ActionSession and fresh authorization on every consumption.
- Preserve hidden access mode/admin/expiry fields through an internal JSON cache
  codec; never globally expose authorization fields for API serialization.
- Reject negative and unsupported scheme memberships before deriving READ;
  preserve effective scheme-grant deadlines.
- Reject inconsistent authorization and database-routing roots while retaining
  explicitly scoped nested-operation behavior.
- Verify the fixes through real JSON/Redis requests, physical model databases,
  non-admin accounts and unauthorized-write integrity checks.

Unit-only fixes cannot mark N01, N02 or N03 complete. The current authentication
path is RTAuthAgent -> standalone UAA `/auths/login` -> `sys_person`; the unused
IBZUSER query is not a provisioning recipe. Do not replace the live-mounted
modelingservice provider JAR while building or testing candidates.

The actual PSDevUser projection joins `T_SRFPSDEVUSEROBJ` to obtain
`PSDEVCENTERID`; that field is not present on the live `T_SRFPSDEVUSER` table.
Fixture provisioning must use the published query's join, not invent a column.
Task's current `EAIAppIntFormActionHelper.java` contains a bytecode-derived
`Complie` implementation and process/registry test hooks. The earlier throwing
stub description is historical; inspect and test the current implementation,
then verify own-bytecode/dependency and fresh compiler receipts separately.
