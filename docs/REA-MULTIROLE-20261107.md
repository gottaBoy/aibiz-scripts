# REA Multi-Role Full-Flow Assessment

Date: 2026-11-07  
Updated: 2026-11-08, Asia/Singapore  
Scope: current local PLM/modeling stack, source-backed candidate delivery,
owned permission fixtures, browser/E2E evidence and operational receipts.

## Method

This is an evidence-led REA assessment. A route or menu is marked **PASS**
only for the behavior actually asserted by a retained report. A source file,
registration, HTTP 200, or visible menu is not treated as CRUD, permission,
workflow, persistence, or offline-delivery acceptance.

Current baseline:

- Latest `scripts npm test`: **4572 passed / 0 failed / 0 skipped**
- PLM/modeling selected browser and source checks: **432/432 passed**
- Secondary-development navigation: **13/13 passed**
- API Reference iframe/engine and themed-layout checks: **passed**
- Live ledger: **0 FAIL / 3 provenance WARN**
- Native ModelDesign browser: login, navigation, editor save, fresh-session
  readback and editor restore all passed

## Role And Flow Matrix

| Role / actor | Flow | Result | Evidence boundary |
| --- | --- | --- | --- |
| System administrator | Login, appdata bootstrap, main navigation, language switch | PASS | Local PLM E2E and locale/model tests |
| System administrator | Development menu, API Reference, Data Model, Modeling IDE entry | PASS | `plm-e2e/tests/navigation.spec.ts`, 13/13 |
| System administrator | API Reference iframe engine and document layout | PASS | `plm-e2e/tests/known-issues.spec.ts`, themed-layout assertion |
| Modeling administrator | Modeling IDE login, navigation, model/plugin assets, editor save, fresh-session readback, restore | PASS scoped | `.artifacts/native-modeldesign/2026-11-07T14-01-32.876Z/report.json` |
| Library editor | Model read/create/update/delete, cross-library denial, fresh-login readback | PASS bounded | `.artifacts/native-model-crud-20261105-r1/` |
| Library viewer | Allowed reads and denied writes across two physical libraries | PASS bounded | Six-user ordinary-user matrix |
| Library no-access user | Denied model access and denied writes | PASS bounded | Six-user ordinary-user matrix |
| Multi-center editor/viewer/no-access | Same-center and two-center identity/library selection | PASS bounded | `NATIVE-MODEL-CRUD-20261105.md` |
| Product manager | Product wizard, member selection, edit/reload/delete cleanup | PASS scoped | `plm-e2e` isolated product workflow evidence |
| Project manager | Project navigation, project wizard and selected settings | PASS scoped | PLM E2E navigation/product workflow evidence |
| Resource manager | Workload/resource navigation and selected panel commands | PARTIAL | Navigation and selected plugin workflows; persistence/action matrix incomplete |
| Tester/reviewer | Test management navigation, selected report/library flows | PARTIAL | Menu/render checks and selected plugin flows; full test lifecycle CRUD/review matrix incomplete |
| Knowledge manager | Space/page navigation and selected wizard flows | PARTIAL | Selected E2E wizard coverage; sharing/permission/file lifecycle incomplete |
| Plugin operator | 73 local runtime plugin identities and selected desktop/mobile interactions | PARTIAL | Local source inventory and bounded plugin matrix; full modes/actions unverified |
| UAA/security operator | TokenStore, expiry/tamper/negative security controls | PASS scoped | Stateful UAA security receipts |
| Authorization operator | Six-user roots, grants, cross-library denial and CRUD | PASS bounded | Owned permission/CRUD fixtures |
| Authorization operator | Malformed roots, zero/negative grants, nested holder/session, cache rotation, service OAuth aliases | BLOCKED/PARTIAL | Explicitly listed remaining R5 gates |
| Backend operator | Source package, 317 tests, candidate images and modelingservice HTTP startup | PASS scoped | Current backend package/image/modeling reports |
| Backend operator | Owned EBSX/workflow/UAA/backend bootstrap and ModelDesign application API | PASS bounded | `5d3585516a77`: source-schema supplemental table, six-user login, 182 HTTP checks; full alias/startup acceptance remains separate |
| Marketplace operator | Catalog identity/source inventory and selected English cards | PARTIAL | 23 catalog identities; offline install/update/rollback not closed |
| Release operator | Current source receipts, candidate assets, browser served bytes | PASS scoped | `r3/r5/r7` receipt chain and browser reports |
| Operations operator | MySQL restart/recreation/cold recovery fixture exercises | PASS isolated | Same-host/tmpfs or owned fixture evidence only |
| Operations operator | Clean offline rebuild, durable production backup, full rollback/release review | BLOCKED | R8 remains open |

## REA Findings

### P0: Acceptance Boundary Risks

1. **D01 full source closure is not complete.** Backend/package/image and
   selected runtime evidence are partial; all 12 required components are not
   independently closed.
2. **Authorization is bounded, not global.** The six-user/two-center matrix
   passes, but negative grant variants, nested session/holder cases, cache
   rotation and service OAuth/alias paths remain.
3. **Marketplace delivery is not offline-complete.** Catalog/source identity
   exists, but local install, update, rollback and package/license closure are
   not verified.
4. **Operational reconstruction is isolated evidence.** MySQL recovery and
   restart receipts do not prove clean-host, durable-storage, offline rebuild
   or production rollback acceptance.

### P1: Functional Coverage Risks

1. The 73-plugin inventory is source/asset coverage, not 73/73 behavior
   acceptance. The current matrix has selected desktop/mobile workflows only.
2. API Reference, Data Model and Modeling IDE PLM entries have route/iframe
   coverage; deep endpoint execution, model CRUD/editing and full IDE action
   coverage are not complete on the PLM route.
3. English model audit still reports **3418 untranslated unique labels** in
   the static model scope. These are candidates, not all confirmed visible
   defects, but the classification is incomplete.
4. The API documentation body is still largely Chinese when the host UI is
   English; the themed layout is fixed, content localization is separate.

### P2: Provenance And Maintenance

1. Live ledger has three non-blocking provenance warnings for `plmservice`,
   `modelingservice` and `modeling-plugins`.
2. Generated `dist/doc` assets are deployment outputs; the documentation theme
   must remain part of the repeatable build/deploy path, not only a local
   artifact edit.

## Prioritized TODO

### P0

- Close the 12-component D01 source/build/dependency/image inventory with
  independent receipts.
- Extend the now-passing owned EBSX/workflow/UAA/backend chain to full
  application-route, service-alias and startup stabilization acceptance.
- Execute the remaining authorization matrix: malformed roots, zero/negative
  grants, nested holder/session, expiry, cache/grant rotation and service
  aliases.
- Produce a clean offline rebuild/restart/rollback report with durable storage
  and generated-code preservation.

### P1

- Build a current desktop/mobile role matrix for product, project, test,
  knowledge, resource, baseline, sprint, report and settings workflows.
- Add deep PLM-route tests for API endpoint browsing/search, Data Model CRUD,
  and Modeling IDE actions instead of route-presence checks only.
- Consolidate all 73 plugin references into a matrix of required modes/actions,
  empty/error, permission and persistence evidence.
- Classify the 3418 untranslated model labels into visible UI, internal-only,
  dynamic-data and not-applicable groups; translate visible groups.
- Localize generated API documentation content or explicitly mark it as a
  separate language pack.

### P2

- Add immutable source commit/image revision receipts to the three ledger
  warning containers.
- Add the local Docsify theme to the repeatable documentation build/deploy
  pipeline.
- Complete marketplace local package, README/icon, license, install/update/
  rollback and no-network verification for the 23 catalog entries.

## Current Conclusion

The stack is usable for local development and bounded multi-role testing.
Core source, browser, CRUD, selected authorization and recovery flows are
verified. It is not yet correct to call the system fully accepted for all
roles, all business workflows, full source closure, offline delivery or
production operations.

The step-by-step implementation sequence is recorded in
`scripts/docs/IMPLEMENTATION-PLAN-20261107.md`.

## November 8 Owned Runtime Checkpoint

The maintained UAA login queries `open_access_provider`. The SQL fixture now
captures its actual `SHOW CREATE TABLE` from the reviewed schema-only input
as an explicit supplemental table. The existing fixture contract is unchanged;
no source business rows, empty compatibility definition, permission bypass or
alternate application API is substituted. Focused fixture/schema tests:
**26 passed / 0 failed**.

Fresh run `.artifacts/native-nonadmin-fixtures/5d3585516a77/` records:

- SQL fixture, 32 application-account checks, workflow and EBSX schema: passed.
- UAA: six ordinary users, self identity, wrong password/center, signature
  tamper and expired token checks passed.
- Backend: `backend-runtime-phase1-backend-r2/report.json` passes its declared
  HTTP-transport/startup checks, not full initialization acceptance.
- `native-http-phase1-http-mutate/report.json`: **182/182 checks passed**.
  The canonical ModelDesign application route returns physical module data;
  editor/viewer/no-access, cross-root denial, native CREATE/UPDATE/REMOVE and
  fresh-login readback pass. Both probes were removed through the native API.
  Final physical rows match, allowing only the exact observed MODELVER
  increments of **+3 per library**.

This demonstrates that the earlier `fetchcursys` failure is not evidence of an
absent provider route. The current fixture dependencies and reviewed runtime
configuration can serve the real application API. It does not certify every
application endpoint, full browser editing on this owned backend, all aliases,
original UAA source provenance or global permission acceptance.

The subsequent `native-http-phase1-http-restart/report.json` remains failed:
its initial-baseline check expects MODELVER 816, whereas the successful CRUD
run retained the legitimate value 819. It stopped before any provider restart.
Do not reset the audit version, relax the baseline check or overwrite the
receipt. Provider-restart replay requires a fresh fixture.

These temporary resources are retained for follow-up verification, not as new
shared services. Exact owned-run disposal must stop application connections
before workflow/EBSX/account cleanup and remove only journaled resources.
The schema-only source container is temporary.

### Fresh Provider Restart Replay

Fresh run `8e88d20900a5` passes the entire owned prerequisite chain and
`native-http-phase1-http-restart/report.json`: **185/185 checks passed**,
`boundedRoleRootAcceptance=true`, `providerRestartReadbackVerified=true`.
Each library's updated probe survives an exact owned-provider process restart
and fresh ordinary-user logins. Both probes are deleted through the native
editor API; every original physical column is restored except the separately
counted MODELVER **+3 per library**. This is not MySQL/host restart or durable
storage acceptance.

The successful replay's eight temporary containers and private network were
disposed through `retire-owned-native-fixture.mjs`; its retirement receipt is
retained under `retirement-phase1-verified-20261108/`. The older failed run
`825d38e1e777` and its private network were also disposed. Its application-
account cleanup correctly refused stale fixture-tool hashes; full owned
database disposal removes those temporary principals without bypassing that
check. The source-schema-only container was removed after source-dependent
verification. No historical receipt was changed.

Ten temporary containers and two private networks were removed. Only the
eight journaled peers for `5d3585516a77` remain for the next owned-browser
integration. This cleanup did not remove shared business containers/images.

The frontend owned-input adapter now reads the actual `owned-resources.json`
journal and validates all three allowed auxiliary roles, including the exact
reviewed ZooKeeper. Mounted frontend distributions use a bounded hash-only
inventory (512 MiB aggregate, 50,000 files, existing 64 MiB single-file cap)
instead of retaining all content in the 256 MiB model reader. No source file
or generated directory is skipped; source symlinks and inventory drift remain
rejected. Final focused contracts: **107/107 passed**.

### Final Closeout

The repaired adapter now prepares current source-bound input against the
retained `5d3585516a77` backend successfully. Receipt:
`.artifacts/native-model-design-owned-backend/phase1-owned-current-20261108/report.json`.
It binds all eight exact backend peers and the full frontend distribution:
**17,414 files / 297,421,719 bytes**. Both source/asset and inspected-topology
verification are true; `containersStarted=0`, `httpRequestsSent=0` and status
remains **PREPARED-NOT-ACCEPTED**. A later launcher must explicitly authorize
and reinspect frontend peers before browser testing.

Final current-source regression: **4567 passed / 0 failed / 0 skipped**,
with no cancelled tests. The earlier 4565-test run preceded the two additional
mount-inventory contracts and is retained separately. Shared PLM/Central/
ModelDesign basic HTTP probes return 200; these are not browser acceptance.

The machine-readable closeout report, exact receipt/log hashes and remaining
gates are in `.artifacts/owned-runtime-closeout-20261108-r1/report.json`.
It deliberately records `allCapabilitiesComplete=false`.

## Owned Browser Replay: November 8

The explicit owned launcher and loopback proxy started two healthy frontend
containers only after source/image/topology validation. The browser replay
verified served app models, all declared local plugin assets, native login and
theme loading for Central and ModelDesign.

It did not pass home/navigation/editor acceptance. The retained failure is
concrete: the compiled ModelDesign route still requests the fixed default
system ID `28F7326A-7C72-4C2D-A497-A16372ABBADC`, while the owned fixture root
is `nf_5d3585516a77_root_a`; `fetchcursys` therefore returns HTTP 403. The
short-lived 20-second UAA fixture also returns HTTP 500 on browser refresh.
An experimental overlay returned static results for notifications, themes,
`SysOperator` and the work-item counter. That code was subsequently withdrawn:
it is not evidence of those capabilities and must not be promoted.

Both frontend containers and loopback proxies were removed after the replay.
Current focused contracts after these changes: **108/108 passed**. Browser
status remains `nativeAcceptance=false`.

### Root Routing And Drift Correction

The root-selection gap is now implemented and checked in the production
bundle. `NATIVE_MODELING_SYSTEM_ID` is serialized by `start.sh` into
`nativeModelingSystemId`; explicit invalid values fail rather than falling
back to the shared system. Existing deep links and absent-override behavior
remain compatible. The owned preparation derives this setting from its
validated fixture manifest.

Root unit tests: **26/26**. Production-bundle startup routing: **5/5** across
Chinese/English, desktop/mobile, both owned roots, default compatibility,
preserved deep link and invalid configuration. These browser tests abort all
API requests; their screenshots show startup/loading only. They do not
certify home, CRUD, authentication or complete bilingual workflows.

The intermittent final-drift rejection was reproduced as Docker bind-mount
enumeration order, not changed configuration. Sorting mounts by destination
removes that false alarm without ignoring any mount fields. Source,
destination and read/write drift still fails the witness. Focused owned
contracts: **112/112**.

Fresh current-input receipts:

- `.artifacts/native-ai-code-runtime-assets/current-source-20261108-r9/receipt.json`
- `.artifacts/native-model-design-isolated/owned-root-basis-20261108-r9/report.json`
- `.artifacts/native-model-design-owned-backend/owned-root-20261108-r9/report.json`

Owned preparation passes source/asset and exact eight-peer topology checks,
with root `nf_5d3585516a77_root_a`. It starts no containers, sends no requests
and remains `PREPARED-NOT-ACCEPTED`. Experimental launcher/proxy code was
withdrawn; previous failed receipts are unchanged and no temporary frontend
or proxy process remains.

Next: real platform services and token refresh, an audited owned launch, then
native home/list/detail/editor/fresh-session/role acceptance. Detailed
reproduction and boundaries: `OWNED-MODELDESIGN-ROOT-20261108.md`.

Final regression after the root/drift changes: **4572/4572**, zero failed,
skipped or cancelled tests. The current machine-readable closeout is
`.artifacts/native-root-routing-20261108-r1/report.json`. It binds the source,
logs, screenshots, r9 runtime-assets and owned preparation separately and
retains `allCapabilitiesComplete=false`. Basic shared PLM/Central/ModelDesign
HTTP probes return 200; no shared business container was restarted.
