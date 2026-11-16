# Embedded Modeling Owned Replay

Started: 2026-11-16; continued 2026-11-17, Asia/Singapore.
Status: **VERIFIED-OWNED-IFRAME-CONTROLS-ONLY-NOT-DEPLOYED**.
This follows [the source diagnostic](EMBEDDED-MODELING-20261116.md);
it does not replace the immutable [APPINDEX baseline](BASELINE-20261116.md).
Record: [owned replay](../records/aibiz-embedded-modeling-owned-20261116.json).

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
model tables and 30,660 columns. The first actual iframe replay ran all four
language/viewport cells and remained failed. Six actual served bootstrap/
Design Index files matched that first candidate, not the subsequent footer
repair. Both frontend containers and their two forwarding processes were
cleaned. A new complete model snapshot matched the pre-UI snapshot.

## First Live Replay

The two mobile cells exposed a real native layout defect: four horizontal
host buttons retained a 200px minimum, leaving Console at x=636 in a 390px
viewport. Document overflow was hidden, so an overflow-only check would have
missed the inaccessible command. Modeling `e9890e2d` now limits only the
narrow Design Index bottom menu to equal columns, retaining all four icons
and complete bilingual captions. The actual host Sass/Element Plus fixture
passes all eight language/width cells (360/390/767/1440), nine tests including
its parent; desktop geometry is unchanged. The exact scoped CSS contract
passes 132 tests.

Desktop ordinary opening/closing ran, but the first tool read the close
button before entry animation completed and treated absence of `.open` as
completion while the actual drawer/overlay was still exiting. Its failed
receipts were not rewritten. Modeling `cf950b39` now waits for actual normal
actionability, animation-free stable close-button geometry, and actual
drawer/overlay exit plus stable unobscured workspace/menu geometry. Four
real CSS-transition cases and the retained rejection gates pass within
135 controlled tests. `PASS` is written only after the final verifier.

The new mobile CSS was rebuilt in a separate candidate and runtime-assets
directory. The second actual four-cell replay passed this bounded scope.
No static resource, model or application response was substituted.

## Final Evidence

Modeling `e9890e2d`, Hub `392a67ea`, Backend `2638748b` and execution tools
Scripts `d5e5413` are bound separately from later evidence-only metadata.
The backend was launched before the additional final-state checker in
`3b1447f`; its original r3 receipt is retained, not relabeled as an execution
of that later checker. Actual frontend guards independently verified the
eight running backend peers throughout the browser work.

All four ordinary editor/own-root cells, zh-CN/en-US x desktop/mobile,
completed normal login, actual root projection, initial unobscured workspace,
ordinary console opening, animation-free close-button checks, ordinary
closing and stable overlay-free readback. Each final cell has zero console/
page errors, HTTP errors, failed/blocked requests, pending evidence and
unsettled requests. The temporary wrapper closed normally. This is an
owned iframe wrapper, not the real PLM embedding or a CRUD/role acceptance.
Mobile Console bounds are x=294.5..388 within the 390px frame before and
after closing. Desktop bounds remain x=1232..1432 in the 1440px frame.

Six actual served bootstrap/Design Index files match the new candidate.
The delivered stylesheet SHA-256 is
`e414927847115c38f30cb7d99d0a02c13a1aa2775306778286eda32207c92a56`.
This is not all-asset/source-closure acceptance.

Visual inspection retains a separate mobile issue: the fixed-width top
header and main editing region remain cropped. A reachable footer and a
visible APPINDEX root do not accept the entire mobile IDE. The screenshots
also retain the explicit disabled-MQTT state.

After both browser rounds, guarded SELECT-only comparisons match the full
initial two-model-schema snapshot: 848 tables / 30,660 columns. Metadata,
UAA and cache whole-state invariance are not claimed.

Both pairs of frontend containers and four forwarding processes were
cleaned, then all eight backend fixture peers and their private network were
retired. Three exact unreferenced candidate tags were removed without force,
global prune or persistent-volume deletion. Final inventory is 12 shared
services / 18 tags / 18 image IDs / zero owned or historical containers.
Shared lifecycle/configuration and all 33 declared input observations match
the pre-run observation; seven mutable directories are not byte-frozen.

Final explicit ten-file regression: **379/379**, no failures, cancellations,
skips or TODOs. It covers controlled browser/source/tool contracts, not 379
business workflows. Full `scripts npm test` was not run because it can start
dependencies. Receipt paths/hashes and the preserved first failure are in
the linked record.

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
