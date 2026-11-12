# Multi-Agent Progress Checkpoint

Date: 2026-11-12  
Scope: owned modeling configuration audit, authorization readiness, and
read-only local runtime inventory.

## Completed

- Commit `37fa07d` records the owned modeling configuration source audit.
- The audit and A01 readiness tests pass after the concurrent changes:
  `6/6` focused tests.
- The configuration audit confirms that no eligible owned PSPF, PSPFStyle or
  PSAppType rows are available. Historical `modelingservice/sql/init.sql`
  contains shared examples and remains explicitly excluded.
- A01 remains intentionally blocked at the harness boundary because the
  malformed-root cases are planned but are not dispatched by the live runner.
  No unsafe header fabrication was added.

## Full Test Result

The latest full `npm test` run produced:

- `5030` passed
- `7` failed
- `0` skipped

The seven failures were not accepted as product regressions:

- Four blocked-config tests require private ignored fixture evidence under
  `.artifacts/native-nonadmin-fixtures/25dd6a7232c7`, which is absent in this
  workspace. The missing evidence must not be reconstructed or fabricated.
- The source-audit assertion was corrected in `37fa07d`; the focused rerun is
  green.
- The A01 readiness harness focused rerun is green; the earlier full-run
  `ReferenceError` occurred during concurrent file editing and is not
  reproducible in the committed tree.

## Shared Configuration Observation

Read-only inspection of the shared `ibizapi` schema found existing rows in
the three configuration tables. These rows are shared-service observations,
not owned fixture evidence, and are therefore not eligible for M02 native
creation or acceptance. No SQL mutation, route mutation, or fixture cleanup
was performed.

## Runtime Inventory

Read-only Docker inventory on 2026-11-12:

- `12` running aibiz containers
- `126` stopped or created historical aibiz containers
- `167` aibiz image tags
- `155` unique aibiz image IDs

The running stack references the current 2026-11-07 backend/modeling images,
`modelingweb:local`, `modeling-plugins:local`, the retained UAA/task images,
PLM services, MySQL and Nacos. Historical `n01-r4-fix*`, `p08/p09` and
`isolated-*` containers are cleanup candidates only. They were not removed
because retained receipts, volumes and ownership journals have not been
reviewed in this checkpoint.

## Live PLM Browser Verification

Against `http://127.0.0.1:30250/ibizplm-plmweb/`, the following read-only
Playwright runs passed on 2026-11-12:

- `navigation.spec.ts` + `english-navigation.spec.ts`: `26/26`
- `modeling-ide.spec.ts`: `2/2` (embedded IDE identity, counter, iframe and
  rendered application)
- `api-health.spec.ts`: `2/2` (core model API routing)
- `deep-feature-sweep.spec.ts` filtered to `二次开发`: `2/2` (visible nodes and
  tabs)
- `embedded-modeling-language.spec.ts`: `3/3` (English and Chinese IDE
  language propagation, disabled MQTT diagnostic)
- The same navigation and API-theme roster on the mobile project: `26/26`.
- Opt-in known-issue probes: `4/4`, including dashboard data, secondary
  development HTML engine and first-level route transition error checks.
- Read-only product relationship and management-plugin navigation:
  `2/2` desktop and `2/2` mobile. The checks cover eight product tabs,
  workload settings, print-template settings, browser history/reload and
  modal cancel/discard behavior without business-record writes.
- Resource allocation Gantt plugin smoke: `1/1` desktop and `1/1` mobile,
  including asset load, visible layout and no browser errors.
- Plugin functional read-only checks: person-select, resource-gantt and route
  picker passed `3/3` desktop. The companion served-byte identity check failed:
  `13` plugin references (`119` declared outputs) were HTTP `200` but their
  SHA-256 values differed from the local `plm-web/dist` files. This is a
  current D02 provenance blocker; the shared `30250` container was not
  replaced during this audit.
- Root cause is identified: `plmweb` mounts the current host distribution at
  `/opt/aibiz/local-dist`, but `plm-web/start.sh` copies it once into `/dist`;
  nginx serves `/dist`. A long-lived container can therefore serve an older
  snapshot after the host distribution changes. Remediation requires a
  reviewed recreate/restart and a fresh served-byte receipt.

This closes the current browser-level navigation, API-reference theme,
Data Model/Modeling IDE entry, embedded IDE rendering and language checks. It
does not close native ModelDesign CRUD, full permission matrices, or the
remaining business workflow and source-closure gates.

## Remaining Gates

- M02: obtain real owned configuration rows or retain the blocked receipt;
  do not copy shared or historical SQL rows.
- A01: add a reviewed malformed-root transport contract, then run fresh HTTP
  evidence with full physical snapshots.
- A02/A03: implement and verify cache-revision invalidation and nested session
  unwind semantics before claiming authorization completion.
- The broader B/M/L/D/K/O items remain governed by
  `docs/ALL-TASKS-20261111.md`; no source presence, empty `200`, or shared
  database row upgrades those statuses.
