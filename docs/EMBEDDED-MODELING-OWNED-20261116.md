# Embedded Modeling Owned Replay

Date: 2026-11-16, Asia/Singapore.
Status: **IN-PROGRESS-NOT-DEPLOYED**.
This follows [the source diagnostic](EMBEDDED-MODELING-20261116.md);
it does not replace the immutable [APPINDEX baseline](BASELINE-20261116.md).

## Changes

- Included the previously uncommitted Modeling snapshot missing-dashboard
  predicate in commit `70f62753`. The controller commit alone was incomplete.
- The dashboard regression now executes both real maintained predicates,
  checks their controller imports, and retains unrelated failures. Six tests
  passed; this is source evidence, not a backend missing-record fix.
- Added an explicit owned iframe-workspace mode in Modeling `c23256a2`.
  It requires ordinary login, real appdata/root projection, a visible initial
  workspace, an in-viewport console menu, ordinary open/close clicks and all
  original error/network/teardown gates. Its temporary loopback wrapper is
  not the real PLM host. Controlled tests passed 131/131.
- Fixed the new Cloud UAA alias guard's use of a three-peer-only checker on
  its single allinone target. The original three-peer invariant stays strict.
- A bounded diagnostic observed Nacos `OOMKilled=true`, exit 137 at 1 GiB.
  With its JVM heap still capped at 512 MiB, a 2 GiB total cap reached actual
  readiness at 1,174,740,992 bytes of measured cgroup memory. Both diagnostic
  containers were removed. Startup now archives exact private inspections
  before removing failed ephemeral peers.

## Current Execution

Only one fresh fixture, `be823cd24936`, is used. No shared service was
restarted, replaced or migrated. SQL/account/workflow/EBSX/platform setup and
16 actual UAA checks passed. Backend attempt r1 failed before starting
services because the orchestrator selected a nonexistent member receipt.
R2 failed during Nacos startup and cleaned its two created peers. R3 passed
the declared startup/transport gate after the bounded memory repair.
These failures remain immutable; neither startup nor transport accepts CRUD.

The new frontend source/type build, independent patched Model Design build,
model candidate, 212-file runtime assets and launch basis are prepared.
Model Design's patched build has zero TypeScript diagnostics; the 22 TS7053
diagnostics in its report belong to the original unpatched build probe.
Browser loader/editor persistence acceptance remains false.

Before UI operations, a guarded SELECT-only snapshot recorded 848 physical
model tables and 30,660 columns. The actual iframe replay, served-byte check,
post-UI comparison and resource retirement remain pending.

## Portal Boundary

Source review confirms the allinone packages the real portal controller.
The standard mark-open-data route targets `ibizcloud-portal`, not the generic
model API. Native nginx currently falls through to that model API; the
separate local nginx rule hardcodes PLM system identity and cannot be copied
into a Modeling acceptance path.

`VIEW` writes cache state and can notify other sessions. `CLOSE` is not a
proven deletion operation. EIDE-05 remains open until exact entity/key/root
authorization, ordinary actor/employee identity, cache fields/TTL,
notification audience and cleanup are verified. No broad `/portal/**`
fallback, fake response or identity header has been introduced.

Shared `32009` still serves the old candidate. Full IDE CRUD, the complete
role matrix, MQTT and shared rollout/rollback remain unaccepted. Canonical
B04/M03/M04/O03 statuses and the 25-item unaccepted top-level count do not
change from this work.
