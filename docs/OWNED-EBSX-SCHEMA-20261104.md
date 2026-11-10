# Owned EBSX Schema

Checkpoint: 2026-11-04, Asia/Singapore.

Later checkpoint: `OWNED-MODELING-APPLICATION-ROUTING-20261104.md` verifies the
packaged factory and canonical application routing, resolving the 404 recorded
below. It also corrects the earlier path interpretation: generated application
routes normally target their model-bound API. The current failure is ordinary
employee-context bootstrap and its cross-schema UAA membership dependency.

**The model-derived EBSX schema is independently initialized and verified.
Owned backend HTTP startup and six ordinary-user login/self checks now pass.
Application authorization remains blocked at an unmapped application API.**
No shared service was replaced; source, native, permission and release closure
remain false.

Evidence root: `.artifacts/owned-ebsx-integration-20261104-r1/`.
Fixture root: `.artifacts/native-nonadmin-fixtures/d83e2406428b/`.

## Maintained Inputs

- `bootstrap-owned-ebsx-schema.mjs` binds the verified source-package receipt
  and a matching successful workflow receipt. It reuses only that workflow
  run's inventoried copies of the exact packaged libraries.
- `fixtures/OwnedEbsxSchemaProbe.java` is compiled offline in the pinned JDK.
  It loads the actual EBSX model resources and invokes the packaged
  `LiquibaseTool` adapter twice. No missing-table placeholder or manually
  composed business-table DDL replaces the adapter.
- `nf_RUNID_ebsx` is separate from UAA, metadata, workflow and both physical
  model databases. A migration principal has schema-scoped DDL rights;
  a different runtime principal has only SELECT/INSERT/UPDATE/DELETE.
- The helper verifies exact business-table/column sets, primary keys, declared
  index names/columns and sufficient declared string capacity. Runtime
  `jobs_info2` CRUD passes and its probe is removed. Runtime CREATE TABLE is
  rejected with MySQL error 1142.
- The migration principal is dropped. A private, SHA-256-bound configuration
  retains runtime credentials. Launcher validation binds fixture/package
  identity, current tool/helper source hashes, dependency/class inventories,
  model hashes and both actual helper results.
- The live launcher requires both `--workflow-report` and `--ebsx-report`.
  Allinone uses `ownedebsx` for its Spring datasource, gateway DEFAULT and
  EBSX DEFAULT/DB2/DB3, without UAA SQL credentials. Provider/gateway receive
  neither EBSX nor workflow passwords. Runtime schema updates remain disabled.

These are maintained bootstrap sources and bounded runtime evidence, not
authenticated original upstream source, full database type conformance,
default business seed or a production migration procedure.

## Physical Model Relationship

The source's `application-auto.yml` maps DEFAULT, DB2 and DB3 to one `rtds`.
The three resources declare 78, 5 and 18 tables, but their union is **78 unique
tables**, not 101. DB2/DB3 are overlapping projections; two DB2 tables do not
carry their own columns.

The helper copies DEFAULT, checks projection compatibility for semantic type,
primary key, nullability and auto-increment, and merges normal indexes.
Declared length/precision is conservatively widened, never silently narrowed.
This exact model records nine adaptations: `IBZEMP.MDEPTNAME` length 100 -> 200
and eight numeric display lengths 0 -> 20. Original models are unchanged.

The successful database has 78 business tables, 1,289 columns and 150 declared
normal indexes, plus Liquibase's two bookkeeping tables. Bootstrap and runtime
verification derive the same merged-model SHA-256:
`0183be4dbb1520343dbac4e7af8ebc6e86f7ceaede34323f3726e561fd9bd5ac`.

## Configuration Compatibility

The first backend replay advances beyond the earlier missing `jobs_info2`,
then fails in CLOUD_AUTH. `ConfigEntity(String)` uses Jackson `convertValue`
for a string beginning with `{`; that does not parse JSON text into a Map.
Nacos exact readback establishes this was not transport double encoding.

Owned Nacos payloads now use a YAML document marker followed by serialized
JSON, a valid YAML document. This selects the existing SnakeYAML branch and
preserves structured arrays, maps and scalar escaping. The publisher rejects
bare JSON and compares exact remote readback before starting services.
Selected backend image/source-package bytes are unchanged.

The second replay passes HTTP/fatal-startup-log gates, but background EBSX
log batches encounter SQL syntax errors. The packaged MyBatis mapper joins
batch statements with semicolons; original runtime configuration enables
`allowMultiQueries=true`. The owned allinone EBSX runtime URL now restores
that option without changing the bound bootstrap URL, schema, principal or
grants. Other services do not receive the changed EBSX URL.

This is adapter compatibility, not SQL-injection protection. Keep its scope
narrow and do not copy unrestricted SQL input patterns into new code.

## Actual HTTP Boundary

`backend-runtime-ebsx-auth-yaml-r2/report.json` passes HTTP transport and fatal
startup-log checks. It intentionally leaves `applicationInitializationVerified`
and native/permission acceptance false.

`native-http-ebsx-auth-yaml-r2/report.json` records 38 passed checks and one
failure:

- Physical model baselines remain unchanged.
- Six ordinary users pass UAA login/self, wrong-password and wrong-center
  rejection, backend `/v7/login`, and `/uaa/oauth/userinfo`.
- The first permitted model collection request returns 404:
  `/api/ibizmodeling__modeldesign/psdevslnsys/ROOT/psmodules/fetchcursys`.
- Direct provider and gateway probes return the same 404. The completed
  provider log registers `/ibizmodeling/modelapi/...`, but reports that the
  ModelDesign application runtime is unavailable. This is not authorization
  denial or proof of broken gateway forwarding.

The matrix stops at that first failure. Probe CREATE/UPDATE/REMOVE was not
enabled; login checks do not prove cross-library permission, fresh-session
CRUD or durable restart. Do not rewrite application requests to underlying
ModelAPI merely to pass: it has a different authorization contract.
Provider cloud-log alias resolution also remains unconfigured.

Earlier failed startup and matrix reports are retained unchanged. Later
replays and final cleanup evidence are recorded in the evidence root above.

The final `ebsx-batch-r3` replay also passes backend transport and repeats the
same 38-pass/one-404 matrix result. Its allinone logs contain no observed
batch SQL syntax error or missing-table/fatal-startup error. The final database
snapshot has 103 EBSX log records, no helper probe row and no migration users.
Those records are runtime observations, not a full batch/persistence test.

Source inspection narrows the next investigation: ModelDesign's packaged
application declaration has neither `getPSSysSFPlugin` nor `getPSSysResource`.
`ServiceSystemRuntimeBase.createApplicationRuntime` can return null without
those inputs when the superclass app-gateway mode is off. This is a source
lead consistent with the unavailable-runtime log, not a verified repair or
permission result.

## Final Verification

| Check | Result | Evidence |
| --- | --- | --- |
| Owned SQL fixture | 55 passed | fixture `isolated-sql-report.json` |
| Scoped application accounts | 32 passed | fixture account report |
| Workflow engine/schema replay | Passed; 38 tables | fixture workflow report |
| Model-derived EBSX schema/CRUD | Passed; 78 business tables | fixture EBSX report |
| Actual standalone UAA security | 16 passed | fixture UAA runtime report |
| Final backend HTTP/fatal-log gate | Passed; full initialization unaccepted | `backend-runtime-ebsx-batch-r3/report.json` |
| Final ordinary-user matrix | 38 passed / 1 failed at application API 404 | `native-http-ebsx-batch-r3/report.json` |
| Focused script/documentation contracts | 145 passed, no failures/skips | `contracts-final.log` |
| Full scripts | 4391 passed, no failures/skips | `scripts-full-final.log` |
| Runtime doctor | Passed | `runtime-doctor.log` |
| Native frontend deployment | 4 passed; native acceptance false | `native-deployment/report.json` |
| Live source/deployment ledger | 6 FAIL / 3 WARN remain | `ledger.json` |
| Exact owned cleanup | 18 service containers, 5 named helpers and one network absent | `cleanup-and-integrity.json` |
| Shared lifecycle integrity | 16 container IDs/names/images/start times/restart counts/mounts unchanged | same report |

EBSX/workflow runtime principals and scoped application principals were removed
before exact MySQL/network cleanup. Final source hashes still match the live
schema and runtime evidence. Private configuration and diagnostic logs stay
under `.artifacts`; historical reports were not edited or promoted.

## Reproduction

Create a fresh owned SQL fixture and scoped application accounts. While MySQL
is the only network peer, bootstrap workflow, then EBSX:

```sh
node scripts/bootstrap-owned-workflow-schema.mjs \
  --execute-owned-workflow --run-id=OWNED_RUN_ID --label=SCHEMA_LABEL \
  --package-report=.artifacts/SELECTED_BACKEND_PACKAGE/report.json
node scripts/bootstrap-owned-ebsx-schema.mjs \
  --execute-owned-ebsx --run-id=OWNED_RUN_ID --label=SCHEMA_LABEL \
  --workflow-report=.artifacts/native-nonadmin-fixtures/OWNED_RUN_ID/workflow-schema-SCHEMA_LABEL/report.json
```

Verify fresh owned UAA/Redis with its explicit account label, then:

```sh
node scripts/launch-run-owned-native-backend.mjs \
  --execute-owned-backend --run-id=OWNED_RUN_ID \
  --image-report=.artifacts/SELECTED_BACKEND_IMAGES/report.json \
  --retained-uaa-report=.artifacts/native-nonadmin-fixtures/OWNED_RUN_ID/uaa-runtime-UAA_LABEL/report.json \
  --workflow-report=.artifacts/native-nonadmin-fixtures/OWNED_RUN_ID/workflow-schema-SCHEMA_LABEL/report.json \
  --ebsx-report=.artifacts/native-nonadmin-fixtures/OWNED_RUN_ID/ebsx-schema-SCHEMA_LABEL/report.json \
  --label=UNIQUE_BACKEND_LABEL
```

Retain resources only during an actively owned integration interval. Remove
only exact journaled backend and UAA/Redis containers after checking IDs,
image IDs, names and run/launch labels. With MySQL again the only peer:

```sh
node scripts/bootstrap-owned-ebsx-schema.mjs \
  --cleanup-owned-ebsx --run-id=OWNED_RUN_ID --label=SCHEMA_LABEL
node scripts/bootstrap-owned-workflow-schema.mjs \
  --cleanup-owned-workflow --run-id=OWNED_RUN_ID --label=SCHEMA_LABEL
node scripts/provision-run-owned-native-application-accounts.mjs \
  --cleanup-owned-application-accounts --run-id=OWNED_RUN_ID --label=ACCOUNT_LABEL
node scripts/tests/run-owned-native-nonadmin-fixture.sql.mjs \
  --cleanup-owned-run=OWNED_RUN_ID
```

Schema cleanup removes journaled principals, not databases or undeclared
peers. Exact owned MySQL cleanup finally removes ephemeral databases.
Changing bound source requires fresh evidence, not edited old receipts.

## Next Gates

1. Restore the actual ModelDesign application runtime and API mapping from
   reviewed source/configuration, retaining existing permission gates.
2. Bind required owned service aliases and dedicated service OAuth identities.
   Login/self does not cover every `lb://uaa-api` or cloud-service path.
3. Rerun physical-root/ordinary-user permission matrices, then explicitly
   scoped writes and fresh-login readback. Test durable restart separately
   with persistent storage; these SQL fixtures use tmpfs.
4. Complete English coverage, marketplace source gaps and actual offline
   install/update. Their inventories and acceptance boundaries are unchanged.
