# Modeling Configuration Source Audit

Date: 2026-11-12

## Result

Read-only audit:

`scripts/audit-owned-modeling-config-sources.mjs`

Focused tests:

`scripts/tests/audit-owned-modeling-config-sources.test.mjs`

For owned fixture `25dd6a7232c7`, the audit confirms:

- Authenticated config reads are `200` with zero rows for PSPF, PSPFStyle and
  PSAppType.
- No owned seed artifact contains configuration rows for those three global
  metadata tables.
- The only repository artifact containing historical PSPFStyle INSERT examples
  is `modelingservice/sql/init.sql`. It is shared development SQL, not a
  source-bound owned receipt, and is explicitly excluded.
- Vendor model files and built model-input files are metadata/query definitions,
  not persisted configuration rows.

The audit status is `blocked-no-owned-config-rows`. It does not issue SQL,
network requests or native writes.

## Repair

1. Keep the exact owned top-level POST FetchDefault routes and route readback.
2. Fetch real PSPF, PSPFStyle and PSAppType rows as an ordinary owned editor.
3. Require a coherent triple:
   `PSPF.PSAPPTYPEID == PSAppType.PSAPPTYPEID`,
   `PSPFStyle.PSPFID == PSPF.PSPFID`, and style center either the actor center
   or a real shared value.
4. Only then perform native PSSysApp CREATE with observed IDs.
5. Snapshot all config/model columns and native-remove only journalled owned rows.

No SQL copy from `init.sql`, fake production ID, direct metadata insertion or
fallback config API is acceptable. Until step 2 produces actual rows, M02
remains blocked and PSSysApp/full five-entity acceptance cannot be claimed.
