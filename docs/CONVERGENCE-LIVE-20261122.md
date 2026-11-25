# Live Convergence Campaign

Date: 2026-11-22 (Asia/Singapore)

This campaign used one fresh owned run, `6189aef47735`, on the isolated
network `nf-6189aef47735-private` with a disposable tmpfs MySQL fixture.
No shared database, persistent volume, or non-aibiz container was modified.

## Passed Runtime Prerequisites

- Model-derived standalone UAA schema: passed.
- Application-account provisioning: passed for six ordinary actors across two
  centers.
- Workflow schema: passed.
- EBSX schema: passed.
- Fresh UAA runtime: passed all 16 declared checks, including login,
  signature, tamper, and expiry controls.
- Current backend source/package/image chain: reused only after its existing
  receipts and image IDs were reverified.
- Backend startup with the fresh candidate images and Central member model:
  passed owned HTTP transport checks.

Backend deployment receipt:

`.artifacts/native-nonadmin-fixtures/6189aef47735/backend-runtime-converge-backend-20261122-r1/report.json`

## M01 Read-Only Evidence

The new owned runner performed the exact Central member read:

`POST /api/ibizmodeling__central/psdevslns/fetchcurdcslnuser`

Evidence:

`.artifacts/convergence-live-20261122-r1/m01/report.private.json`

Observed result:

- six real ordinary actors logged in through the backend;
- editor/viewer in both centers received one nonempty row for their own
  center and scheme;
- both no-access actors received an empty result;
- anonymous request received HTTP 401;
- 13 complete physical snapshots (before/after each read) were identical;
- navigation/selection and CRUD were intentionally not claimed.

This is partial M01 evidence. M01 remains open because navigation, selection,
and the full native business workflow were not executed.

Subsequent source review found that this runner's transport supplied additional
`srfuserid`, `srfpersonid` and `srfdcid` headers. The observed results and
snapshots above remain historical passing results for that transport; they do
not establish the token-only path or normal browser identity behavior. The
adapter has now been removed from the default runner and a normal UI entry
added, without claiming a new live pass. See
[the implementation follow-up](MULTIAGENT-IMPLEMENTATION-20261122.md).

## A01 Evidence

The default native string-root lane ran against the same fresh backend:

`.artifacts/native-nonadmin-fixtures/6189aef47735/authorization-a01-converge-a01-legacy-20261122-r1/report.json`

Result: `passed-bounded-native-string-roots-partial-a01`.

- 84 logical invalid-root cases planned;
- 36 native string-root cases dispatched and verified;
- 48 typed/null/empty/numeric cases remain unrepresentable by the legacy
  String-path adapter;
- 16 controls and 84 authentication checks passed;
- full physical snapshots remained unchanged.

The parentless MAJOR route implementation is source/config guarded and
default-off. Two attempts to start a fresh parentless backend failed before
application startup because All-in-One could not resolve the newly started
owned Nacos peer; those attempts were retained as failure evidence and
cleaned by exact owned IDs. No parentless HTTP result is claimed.

## Cleanup And Boundaries

The owned UAA/Redis peers were removed by exact IDs after backend peers were
removed. The SQL fixture cleanup then passed:

`.artifacts/convergence-live-20261122-r1/cleanup.private.log`

No owned run containers or private network remain. The shared witness script
reported mount-hash drift for pre-existing shared aibiz containers; this was
recorded as a witness mismatch, not converted into a pass. No shared service
was restarted or replaced.

The campaign closes no top-level item. It upgrades M01 and A01 from
source-only/transport prerequisites to bounded live evidence while preserving
their remaining acceptance gaps.
