# Modeling Configuration Data: Remaining Blocker

Date: 2026-11-11

## Current Status

The remaining M02 data blocker is the absence of configuration rows in the
owned metadata schema:

- `T_SRFPSPF` platform definitions
- `T_SRFPSPFSTYLE` platform styles
- `T_SRFPSAPPTYPE` application types

The source model and native ModelAPI publish these entities and their
`FetchDefault`, `Create` and `Remove` methods. Empty tables are therefore not
evidence that the feature is unsupported. The current owned wrapper may still
publish only the `psdevslnsys` root route; exact top-level config routes must be
verified before any HTTP attempt.

No SQL seed, fake production ID, shared fixture mutation or existing fixture
change was performed for this task. No real config rows were created. The
current plan intentionally remains:

`blocked-awaiting-real-config-evidence`

## Read-Only Plan

Implemented:

`scripts/plan-owned-modeling-config-seed.mjs`

Focused tests:

`scripts/tests/plan-owned-modeling-config-seed.test.mjs`

Run:

```sh
node scripts/plan-owned-modeling-config-seed.mjs \
  --manifest-path=.artifacts/native-nonadmin-fixtures/25dd6a7232c7/manifest.json \
  --output-path=.artifacts/native-nonadmin-fixtures/25dd6a7232c7/modeling-config-seed-plan.private.json
node --test scripts/tests/plan-owned-modeling-config-seed.test.mjs
```

Observed plan for fixture `25dd6a7232c7`:

- 12 source/manifest/schema-plan bindings.
- Metadata schema `nf_25dd6a7232c7_meta`.
- Two centers: `nf_25dd6a7232c7_center_a` and `_center_b`.
- Full source physical columns: PSPF 28, PSPFStyle 37, PSAppType 9.
- Six unresolved center/root intents, no usable IDs or row values.
- Native create/remove contract recorded; `nativeCreateExecuted=false`.
- Full-column snapshot and native-only cleanup contract recorded.

The planner is source-bound: it reads actual vendor models, ModelDesign app
entities, ModelAPI query metadata, default query SQL, model schema plan and
the current two-center manifest. It validates exact routes, key/name fields,
required physical fields, default values, table columns and no-SQL behavior.

## Native Contract

Exact ModelDesign routes are:

```text
/api/ibizmodeling__modeldesign/psdevslnsys/<root-id>/pspfs/fetchdefault
/api/ibizmodeling__modeldesign/psdevslnsys/<root-id>/pspfstyles/fetchdefault
/api/ibizmodeling__modeldesign/psdevslnsys/<root-id>/psapptypes/fetchdefault
```

These use `POST`, `Default` dataset and `READ` permission. Top-level ModelAPI
metadata also publishes the same `POST /fetchdefault` methods. A wrapper must
publish only these exact owned paths with the existing JWT/org/system
boundary; `/**`, GET aliases, direct backend calls and alternate APIs are not
acceptable.

If exact routes are available, first fetch actual rows under an authenticated
owned editor context. The plan does not invent IDs:

- PSPF is global and must be active (`VALIDFLAG=1`) with a real app-type link.
- PSPFStyle is center-scoped or shared (`PSDEVCENTERID` actual center or
  null) and must reference an observed PSPF.
- PSAppType is global and must have a nonempty observed name.
- A coherent triple requires `PSPF.PSAPPTYPEID == PSAppType.PSAPPTYPEID` and
  `PSPFStyle.PSPFID == PSPF.PSPFID`.

For each of the two centers, duplicate or ambiguous keys are rejected. A
style from another center is not accepted. An empty or 403/404 config fetch
keeps the plan blocked.

## App Dependency

`PSSysApp` has physical required references:

- `PSPFID`
- `PSPFSTYLEID`
- `PSSYSTEMID`
- `PSAPPTYPENAME` (physical lookup/display field)

`PSAPPTYPEID` itself is optional, but if sent it must be a real row. App
creation must not send unresolved `$OBSERVED_*` placeholders. Until one
coherent actual platform/style/type triple is observed, the App native CREATE
gate remains blocked.

The plan records this explicit dependency, rather than treating empty config
responses as an empty-but-valid platform or fabricating a style/type row.

## Snapshot And Cleanup

The plan requires a read-only full-column/all-row snapshot of all three config
tables in the metadata schema before and after any future native operation.
Empty baseline is required; pre-existing rows must stop the run rather than
be adopted. Every physical column remains evidence, including nullable,
default, audit and opaque text fields.

Future initialization must use native CREATE and receipt actual returned keys.
It must journal each intent before dispatch and use native owner DELETE in
reverse dependency order:

1. Any dependent `PSSysApp` rows
2. `PSPFStyle`
3. `PSPF`
4. `PSAppType`

SQL DELETE/UPDATE/reset is forbidden. Native model operations can increment
`MODELVER`, write `T_SRFPSSYSMODELLOG`, alter folder/task/audit rows or trigger
related model effects. Those deltas must be recorded and explicitly reviewed;
they must never be hidden by SQL-resetting a baseline.

## Acceptance Boundary

This task provides an auditable source-bound plan only. It does not claim:

- real config rows exist
- routes are currently reachable
- native config CREATE passed
- PSSysApp native CREATE passed
- M02 is closed

The next safe step is exact route publication/readback followed by native
config fetch and coherent triple selection. If any prerequisite fails, retain
the blocked receipt and do not write SQL or fabricate production configuration.
