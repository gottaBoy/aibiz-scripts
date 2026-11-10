# Owned UAA Membership Projection

Checkpoint: 2026-11-04, Asia/Singapore.

Later checkpoint: `NATIVE-MODEL-CRUD-20261105.md` resolves the bounded metadata/
physical-schema blocker using a dump/model compatibility plan. Both center
topologies now pass native model CRUD and fresh-login/cross-library checks;
same-center provider process restart readback also passes. Durable storage,
complete permission dimensions and full localization remain unaccepted.

**The missing UAA membership dependency is resolved for an isolated fixture.
All six ordinary users now complete normal appdata bootstrap with verified
identity/center/organization. The model matrix still fails at incomplete
metadata schema, not a proven authorization decision.**
No shared service, backend candidate package, application model or production
authorization implementation was replaced.

Evidence root: `.artifacts/owned-permission-projection-20261104-r1/`.
Fixture root: `.artifacts/native-nonadmin-fixtures/237af335cc13/`.

## Read-Only Contract

`bootstrap-owned-ebsx-schema.mjs` now explicitly provisions a compatibility
view after the real model/Liquibase bootstrap, before runtime verification:

```text
EBSX.sys_role_member
  SELECT DISTINCT DC, ROLE_ID, MEMBER_TYPE, MEMBER_UID
  FROM exact-owned-UAA-schema.sys_role_member
```

- The EBSX model still defines 78 business tables. This additional view is
  maintained integration SQL, not a recovered model table or empty placeholder.
- The view uses a dedicated `nf_RUNID_ebsx_perm@localhost` SQL SECURITY DEFINER.
  Its only granted privilege is SELECT on the one exact UAA membership table,
  not the entire UAA schema. Table-level names are literal identifiers;
  schema-level runtime grants still escape underscores against wildcards.
- The definer account has a random password, is locked at creation, and is
  never supplied to backend services. Its password stays in owner-private
  bootstrap inputs.
- DISTINCT makes this view non-updatable despite EBSX runtime's schema-level
  CRUD grant. It projects only the four membership/tenant columns needed here;
  it does not expose passwords or profile fields.
- Exact source membership tuples are compared with all six fixture identities.
  The view returns those real tuples. Their source hash is checked again after
  runtime probes and after actual appdata requests.
- View definition hash, locked account, exact grants, column list and row
  evidence are bound into the EBSX report and private runtime configuration.
  The loader requires that evidence as well as the current helper/tool hashes.

The exact packaged JDBC runtime verifies that it can read all six projected
rows. UPDATE, DELETE and INSERT on the view fail with MySQL non-updatable-view
errors. Direct reads of UAA membership and password tables fail with error
1142. Existing EBSX CRUD and runtime CREATE TABLE rejection still pass.

This is a narrowly scoped compatibility contract for the observed same-server
deployment. It is not a production cross-server migration, tenant-isolation
proof, or replacement for a reviewed long-term authorization storage design.
The trusted service account sees membership rows for both fixture centers;
actual per-user authorization must still be proved by HTTP matrices.

## Normal Application Context

The HTTP matrix previously sent only a token on model requests.
`SysUAAUtilRuntimeBase` additionally needs normal system/organization context
and the employee cache produced by appdata bootstrap.

`run-owned-native-permission-http.mjs` now:

1. Verifies the actual UAA login person, center and ordinary role, then obtains
   the organization from that response and checks its exact fixture identity.
2. Performs backend login and token-self verification.
3. Calls `GET /appdata` with the actual token, `srfsystemid=ibizmodeling` and
   actual `srforgid`. It requires HTTP 200 and matching person, center,
   organization and system in the returned context.
4. Sends only those two normal headers with subsequent model requests. The
   wrapper refuses model requests before successful appdata bootstrap and
   repeats bootstrap for every fresh backend login.

Header shapes, paths and context keys are bounded. No supplied superuser,
API-user, person-ID or administrative headers, synthetic employee-cache writes
or ordinary-user substitution for service OAuth credentials were introduced.
The report records checks and hashes, not tokens or response bodies.

## Actual Result

Fresh SQL 55, scoped accounts 32, workflow 38-table bootstrap, EBSX 78-table
bootstrap/runtime verification and standalone UAA 16 checks pass.
Backend HTTP/fatal-startup gates pass; full initialization remains unaccepted.

`native-http-projection-appdata-r1/report.json` records **44 passed / 1 failed**.
All six users, including the two with no model access, complete appdata with
HTTP 200 and correct ordinary identity context. Authentication/appdata success
does not grant model access.

The first permitted editor collection read now reaches:

```text
PSModelDEAccessManager.testDataAccessAction
  -> SystemAccessManagerBase.getPSDevSlnUserDTO
  -> PSDevSln GET / view query
  -> Table 'nf_237af335cc13_meta.t_srfpsdcdeploycenter' doesn't exist
```

The ten-table metadata fixture includes the directly seeded authorization
tables, but the real scheme view LEFT JOIN also needs
`T_SRFPSDCDEPLOYCENTER`. This returns HTTP 500. No probe writes were enabled;
the matrix stops at that failure and both physical-model baselines remain
unchanged.

Read-only source inventory records these declarations, all equal to the
launcher's staged model bytes:

| Logical Model | Declared Tables |
| --- | ---: |
| DEFAULT | 98 |
| DB2 | 357 |
| DB3 | 8 |

These are declarations, not disjoint migrated-table counts. The newly observed
deployment-center table has 36 declared columns in DEFAULT and 40 in DB3.
Their datasource/projection relationship needs review before initialization;
adding one ad hoc empty table would not establish schema closure.
`metadata-schema-inventory.json` binds the declarations, failing view-query
bytes and actual provider log.

## Evidence And Cleanup

`database-final.json` verifies:

- EBSX: 80 base tables including two Liquibase tables, plus one read-only view.
- UAA: 18 base tables; workflow: 38; metadata: 10.
- EBSX runtime grants, projection grants, view definition and locked definer
  remain unchanged.
- Original UAA membership tuples and full-column model baselines are unchanged.
- Missing metadata deployment-center table is confirmed independently.

Cleanup first removes the exact backend/UAA/Redis peers. With MySQL the only
network peer, EBSX cleanup checks active connections, view definition hash and
account grants, drops the view and locked definer, then removes its runtime
principal. Workflow/application principals and exact MySQL/network follow.
`cleanup-and-integrity.json` confirms eight service containers, seven named
helpers and one private network absent. Sixteen shared container IDs, names,
image IDs, start times, restart counts and normalized mounts are unchanged.

Runtime doctor and four native frontend deployment checks pass. The live
ledger remains 6 FAIL / 3 WARN. Final full scripts pass 4422 tests with zero
failures/skips (`scripts-full-final.log`); focused contracts pass 200 with zero
failures/skips (`contracts-final.log`). The earlier 4419-pass run predates the
normal appdata runner changes and is retained as `scripts-full-r1.log`.
None of these checks promotes native, permission, source, persistence,
marketplace-offline or English-coverage acceptance.

## Reproduction

Use the workflow -> EBSX -> UAA -> backend sequence documented in
`OWNED-EBSX-SCHEMA-20261104.md` with new fixture/report labels and current
sources. The EBSX tool now creates and verifies the membership view itself;
do not apply out-of-band SQL or modify an older receipt. Run the maintained
HTTP matrix without probe mutations first:

```sh
node scripts/run-owned-native-permission-http.mjs \
  --execute-owned-native-matrix --run-id=OWNED_RUN_ID \
  --deployment-input=.artifacts/native-nonadmin-fixtures/OWNED_RUN_ID/backend-runtime-BACKEND_LABEL/deployment-input.private.json \
  --label=UNIQUE_MATRIX_LABEL
```

Retire backend and UAA/Redis before the EBSX/workflow/application-account/SQL
cleanup sequence. EBSX cleanup now also removes its journaled view and locked
projection principal.

## Next Gates

1. Review and initialize complete owned metadata schema using actual model/
   dump inputs and projection relationships. Revalidate real view-query joins;
   do not loosen grants, disable model authorization or manufacture seed rows.
2. Rerun the six-user root matrix through both center topologies. Only after
   read/denial checks pass, enable scoped CRUD and fresh-login readback.
3. Resolve remaining owned service aliases and dedicated service OAuth,
   then persistent-storage restart and offline-delivery verification.
4. Complete English coverage and marketplace source/install/update gaps as
   separate localization work; none is completed by database compatibility.
