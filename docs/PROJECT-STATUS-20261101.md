# Workspace Status And Alignment

Checkpoint date: 2026-11-01 UTC.

## Follow-Up: 2026-11-02 UTC

Latest checkpoint: `ARM64-UAA-AND-NATIVE-REFRESH-20261102.md`. The reviewed
ARM64 MySQL profile allowed two independent UAA Boot/SQL/Redis runs to pass all
17 security checks. Fresh framework/model-design/model/runtime candidates now
replace the stale native-source snapshots. The scripts replay passes 4284
tests with zero failures/skips; both native apps pass all 16 browser prerequisite
stages. The focused PLM replay passes five tests without retries after retaining
one earlier network-change failure. Only two native frontend containers were
recreated. Shared backend cutover, the six live ledger failures, native editor
acceptance and full source closure remain unfinished.

Backend progress for the same date is tracked in
`BACKEND-ALIGNMENT-20261102.md`. Fresh packages and four candidate images exist,
but no shared backend was replaced. That earlier full scripts replay recorded
4280 passed and four stale native-framework evidence failures; the older
4271-pass checkpoint below is historical, not the current global verdict.
The current primary UAA deployment remains source-unbound; the isolated
candidate's scoped security pass does not establish its deployment identity.

The mobile stale-navigation blocker below has been reproduced, repaired and
deployed to PLM. The new controlled delayed-response regression passes three
times on each viewport; the original mobile product CRUD workflow passes five
consecutive repeats. The combined ordinary desktop/mobile and known-issue gate
passes 101 tests with no failures, skips, flaky cases or retries. Mobile
skip-gate and runtime doctor also pass.

See `MOBILE-ROUTE-REGRESSION-20261102.md` and
`.artifacts/stale-tree-20261102/full/reports/test-results.json`.
Original failure reports below remain historical evidence. Backend source/image
alignment, native acceptance and complete source closure are still unverified;
the opt-in deep sweep was not rerun.

## Assessment

This is a multi-repository development workspace, not one Git repository.
PLM, the modeling applications, shared framework packages, backend services,
authentication, Task and their verification tools have separate source and
deployment boundaries.

The stack is available for development. Full source closure, permission
isolation, clean deployment reproducibility and release acceptance remain
unverified. Test pass counts are not a project completion percentage.

## Reproduced Baseline

| Check | Result | Workspace evidence |
| --- | --- | --- |
| Runtime doctor | Passed before alignment | `scripts/local-runtime-doctor.sh` output |
| Scripts before this repair | 4235 passed, 4 failed, zero skipped | `.artifacts/aibiz-rea-20261101-scripts.tap` |
| Live version ledger before alignment | 8 failures | `.artifacts/aibiz-rea-20261101-ledger.json` |
| Native browser prerequisites on 32008/32009 | 4 failed stages: both navigation and browser-error stages | `.artifacts/aibiz-rea-20261101-native-before/report.json` |
| Native deployment input audit | Central grid mount/HTTP bytes and design-index delivery fail | `.artifacts/aibiz-rea-20261101-native-deployment/report.json` |

The four script failures are stale source/build evidence bindings, not four
independently established business defects. Original reports are preserved.
The 2026-10-21 successful native report used 31198/31199; it does not establish
the state of the current 32008/32009 containers.

## Root Causes And Repairs

1. Central mounted the old grid model. Its `FetchDefault` is a `DATAQUERY`,
   whereas the prepared service migration selects published `FetchCurDCSLNUser`.
2. ModelDesign served the old design-index bundle. Its menu lookup compares
   object identity; the current local implementation uses unambiguous declared
   IDs and retains explicit visibility/permission denial.
3. A retained framework snapshot differs from its recorded inputs. Fresh
   dependency, probe, double-build, candidate and runtime receipts replace
   current references; historical receipts are never edited to match new bytes.
4. Platform API verification defaulted to retired 32006/32007 ports. It now
   uses the same configuration as Compose and the browser, while preserving
   explicit CLI and legacy URL overrides.
5. The full regression runner lacked its documented npm entries and inherited
   PLM's development-only 4173 default. Commands are registered and the full
   runner now defaults to the deployed 30250 application.
6. Primary allinone/gateway ledger entries selected the pre-key-refresh build.
   Selecting the matching retained key-refresh record removes two false image
   mismatches without suppressing current source drift.

Only the two native frontend containers were recreated. Before/after container
IDs, image IDs and start times confirm MySQL, UAA, allinone and PLM service were
not restarted (`.artifacts/aibiz-rea-20261101-containers-after.json`).

## Current Evidence

| Check | Result | Workspace evidence |
| --- | --- | --- |
| Entry, deployment and ledger focused tests | 188 passed | `.artifacts/aibiz-rea-20261101-focused-v2.tap` |
| Shared native configuration focused tests | 138 passed | `.artifacts/aibiz-rea-20261101-config-focused.tap` |
| Current model-design source/runtime integration | 14 passed | `.artifacts/aibiz-rea-20261101-source-integration.tap` |
| Modeling Web tests | 619 Vitest + 10 report tests passed | `.artifacts/aibiz-rea-20261101-modeling-tests.log` |
| Modeling Web build and release preflight | Passed | `.artifacts/aibiz-rea-20261101-modeling-build.log`, `.artifacts/aibiz-rea-20261101-release-check.log` |
| Platform API sessions/config cleanup | Both apps: 21 checks passed each | `.artifacts/aibiz-rea-20261101-native-api/report.json` |
| Fresh framework and AI-code build | Completed; source evidence only | `.artifacts/native-ai-code-source-deps/rea-align-20261101/report.json` |
| Fresh model-design candidate | Typecheck, full build, resources and reproducibility passed; not native acceptance | `.artifacts/native-model-design-local-candidate/rea-align-20261101/report.json` |
| Live version ledger after record selection repair | 6 failures remain | `.artifacts/aibiz-rea-20261101-ledger-aligned.json` |
| Runtime asset integrity attack tests | 4 passed | `.artifacts/aibiz-rea-20261101-runtime-assets.tap` |
| Current native frontend deployment integrity | All four checks passed | `.artifacts/aibiz-rea-20261101-native-deployment-aligned/report.json` |
| Native browser navigation/reload | Both apps, all 16 stages passed | `.artifacts/aibiz-rea-20261101-native-aligned/report.json` |
| Native browser plus model HTTP roundtrip | Passed, original field value restored; browser editor interaction not verified | `.artifacts/aibiz-rea-20261101-native-roundtrip-final/report.json` |
| Required modeling runtime / portal | Passed | `.artifacts/aibiz-rea-20261101-modeling-runtime/report.json`, `.artifacts/aibiz-rea-20261101-portal/report.json` |
| PLM desktop/mobile replay | 90 passed, 1 mobile failure | `.artifacts/aibiz-rea-20261101-plm-deployed/reports/test-results.json` |
| Mobile product workflow repetition | 2 of 3 workflow runs passed, 1 failed; setup also passed | `.artifacts/aibiz-rea-20261101-plm-mobile-repro/reports/test-results.json` |
| Scripts after source alignment | 4257 passed, 1 fixture port-collision failure | `.artifacts/aibiz-rea-20261101-scripts-aligned.tap` |
| Scripts after fixture/roundtrip repairs | 4264 passed, zero failures/skips | `.artifacts/aibiz-rea-20261101-scripts-final.tap` |
| Roundtrip secret/cleanup regressions plus report semantics | 23 passed, zero failures/skips | `scripts/tests/native-field-roundtrip.test.mjs`, `modelingweb/app/tests/native-model-report.test.mjs` |
| Scripts after final token hardening | 4271 passed, zero failures/skips | `.artifacts/aibiz-rea-20261101-scripts-security-final.tap` |

The failed PLM invocation in `.artifacts/aibiz-rea-20261101-plm-e2e/` targeted
an unavailable 4173 dev server: authentication setup failed and 90 cases did
not run. It is not a successful or complete business regression.

The first native HTTP roundtrip replay failed before writing because the login
report deliberately omits the token. The repaired runner obtains the private
browser session internally, restores state even when a write response fails,
and does not serialize credentials. Transport/JSON errors are sanitized, the
fresh-session token remains private for cleanup, and an expired cleanup session
can be refreshed once. Its passing final report records
`browserEditorInteractionVerified=false`: HTTP persistence is not proof of a
human-operated browser editor flow.

The aligned script run's remaining failure was `EADDRINUSE` on a randomly
selected startup-fixture port. The fixture now uses an OS-assigned port and
requires an observed unavailable-transport retry before success; timeouts,
browser assertions and required check strictness are unchanged.

### Mobile Failure At Original Checkpoint

The organization-product CRUD test persists the edited name successfully, but
the editor is missing after reload. Both full-suite and focused repeats retain
the failure; isolated successful repeats do not clear the gate.

Structured browser trace shows the route was already polluted before save:
the correct `product_base_information_edit_view` deep link becomes a mixed
`product_setting_view/.../idea_all_grid_view` route while the old idea-tree
requests are still in flight. Save and independent API read return 200 with
the edited name, then reload loads that wrong mixed route. This rules out a
simple save-response waiting fix. Old-view asynchronous navigation is a likely
cause, not yet a proven implementation-level root cause. Test-created products
were physically removed and cleanup inventories are empty.

### Required Source Audit Boundary

`.artifacts/aibiz-rea-20261101-required-source/report.json` records a timed-out
UAA/Task child (`SIGTERM`), with no child readiness report. Its 0/3 required
summary is an incomplete fail-closed observation, not proof that source files
are absent. Historical UAA security/closure and Task source/WAR evidence exist;
this invocation did not select their explicit current-source bindings.
The independent 12-component D01 compiler/image closure remains unfinished.

## REA Use

Actual `rea-agents` 6.8.0 CLI analysis ran under a separately selected Node
24.22.1 runtime. Global Node and agent configuration were not changed.
REA MCP registration is not aligned in this agent session; native analysis
engines are not configured. These facts do not block the static JS CLI lane.

The deployed plugin was downloaded from 32009 and analyzed without executing
its code, then compared with the current built plugin:

- Deployed parent Evidence:
  `ev_4b7d4d81829eb7949712f67524583b3fc204e8a0f00cebf9fd44a05270f24f36`
- Current built plugin parent Evidence:
  `ev_b4396476c19e00db46ba5fcf3cc262a3b9968f04294c8b12ef0a567555af2ea4`
- Version comparison Evidence:
  `ev_173ee066603d475d58d3a4cc5a225a894d8396e94f27742d004f5212158db685`

Complete evidence, summaries and comparison are under
`.artifacts/rea-investigation-20261101/`. Comparison coverage is partial and
contains unknown relationships. It does not prove dynamic behavior,
behavioral equivalence or recovery of authenticated original source.
Browser observations and exact HTTP hashes are separate corroborating evidence.

## Remaining Work

1. The mobile stale-view/deep-link blocker is resolved in the follow-up above.
   Preserve the controlled response-delay regression in subsequent PLM gates.
2. Resolve remaining hub source drift through fresh builds and regression,
   not by replacing hashes in old records.
3. Verify modelingservice's newer tag against its mounted runner and image,
   then choose a controlled deployment; tag drift alone is not a rebuild proof.
4. Bind actual UAA deployment to its maintained standalone source/build chain;
   legacy `ibzuaa` records are not interchangeable with standalone evidence.
5. Retain the two original plugin-source gaps (`console-terminal` alpha.87 and
   `layout-design` alpha.90). Independent local replacements do not recover
   those originals or establish whole-package compatibility.
6. Complete non-admin/cross-library permissions, all required plugin/action
   workflows, clean Docker rebuild, restart and persistence acceptance before
   claiming final release closure.
