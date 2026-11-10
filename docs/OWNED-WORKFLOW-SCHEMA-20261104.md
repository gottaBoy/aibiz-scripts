# Owned Workflow Schema

Checkpoint: 2026-11-04, Asia/Singapore.

Later checkpoint: `OWNED-EBSX-SCHEMA-20261104.md` independently initializes the
model-derived EBSX schema and advances through backend HTTP startup and six-user
login/self checks. The missing-table failure below is retained history;
application API/permission acceptance remains blocked.

**The exact packaged Flowable dependency set now has a separately initialized
and verified workflow schema. The complete backend still fails because its
EBSX schema is incomplete.** No shared service was replaced and no permission,
restart/persistence, original-source or release acceptance is declared.

Evidence root: `.artifacts/owned-workflow-integration-20261104-r1/`.

## Implemented

- `bootstrap-owned-workflow-schema.mjs` consumes a verified backend source
  package receipt, stages its exact libraries, and compiles the maintained
  `fixtures/OwnedWorkflowSchemaProbe.java` helper in a pinned local JDK image.
  The compilation has no network, annotation processors or implicit source
  inputs. Libraries are copied into a new artifact directory; shared Maven
  caches, deployment JARs and historical receipts are not modified.
- A new `nf_RUNID_workflow` database is distinct from the eighteen-table UAA
  schema and both physical model databases. Existing workflow schemas or
  principals cannot be adopted.
- A schema-scoped migration account creates the tables using the exact
  Flowable engine and its own resources. It has the DDL and REFERENCES
  privileges needed for those resources, not global privileges.
- A different runtime account has exactly SELECT/INSERT/UPDATE/DELETE on that
  schema. The helper reopens the engine with schema updates disabled, deploys
  a minimal BPMN process, verifies its completion, then removes the test
  deployment and history. Actual JDBC database/principal and engine class
  origins are recorded without passwords.
- The migration account is dropped after successful verification. Runtime
  credentials remain in a private, SHA-256-bound configuration file.
- The backend launcher now requires `--workflow-report`. Its reader checks
  the same fixture run, source-package receipt, helper/tool source hashes,
  library/class inventories, private file permissions and hashes, actual
  schema/probe results and removed migration identity.
- Only allinone receives the workflow credentials and `cloudwfutil.datasource`
  points to `ownedworkflow`. Provider/gateway do not receive these credentials.
  Automatic workflow schema updates remain false; the workflow engine is not
  skipped.
- Explicit workflow cleanup removes only journaled fixture principals, after
  checking ownership, current grants and absence of active connections.
  The database remains until exact owned MySQL fixture cleanup, preserving
  failed schema observations.

These are maintained tooling sources outside `.artifacts`. Dependency staging,
compiled helpers and receipts are run-specific evidence, not recovered original
Flowable source or authentication of the upstream 6.4.2 coordinate.

## Actual Runs

| Stage | Result | Evidence |
| --- | --- | --- |
| First fixture `9fedc36c60eb` | SQL 55 and scoped accounts 32 passed | fixture SQL/account reports |
| First workflow bootstrap | Failed: MySQL denied REFERENCES during foreign-key creation | `workflow-schema-workflow-r1/report.json`, private bootstrap log |
| First fixture cleanup | Own principals, MySQL and network removed; failed reports preserved | fixture cleanup reports |
| Second fixture `049a891a7eec` | Fresh SQL 55 and scoped accounts 32 passed | fixture SQL/account reports |
| Exact-library workflow bootstrap | Passed with the narrowly added migration REFERENCES privilege | `workflow-schema-workflow-r2/report.json` |
| Runtime schema/workflow replay | Passed with schema update false and CRUD-only runtime identity; 38 tables | same report |
| UAA Boot/MySQL/Redis security | 16 passed | `uaa-runtime-workflow-r2/report.json` |
| Backend candidate replay | Correctly failed after workflow initialization, at missing EBSX `jobs_info2` | `backend-runtime-workflow-backend-r1/report.json` |
| Final database projections | UAA 18 / workflow 38 tables; original physical model baselines unchanged | `database-final.json` |
| Cleanup/integrity | 9 service containers, 3 named workflow helpers and 2 private networks absent; all 16 shared containers unchanged | `cleanup-and-integrity.json` |
| Native frontend deployment | 4 passed; native acceptance false | `native-deployment/report.json` |
| Live source/deployment ledger | 6 failures and 3 warnings remain | `ledger.json` |
| Final focused contracts | 152 passed, zero failures/skips | `contracts-final.log` |
| Final full scripts | 4368 passed, zero failures/skips | `scripts-full-final.log` |

The first focused/full test invocation retained a negative-test fixture failure:
the expected package receipt and mutable observed receipt shared the same test
object. A shallow copy now keeps those identities independent. This was a test
fixture repair, not a production package-check defect; both failed logs remain.

The successful schema receipt records:

- ProcessEngine and IdmEngine version: `6.5.0.1`.
- Actual class origins: the selected `flowable-engine-6.4.2.jar` and
  `flowable-idm-engine-6.4.2.jar` copies, bound to the verified package bytes.
- Runtime SQL principal: `nf_049a891a7eec_wf_app@%`, not root or migration user.
- Completed test workflow, removed deployment/history and dropped migration
  account.

This demonstrates compatibility of this exact customized library/resource set
in this isolated schema. It does not authenticate its upstream provenance or
allow replacing it with arbitrary public packages having the same filenames.
No version-table values were manually rewritten and no individual missing table
was fabricated.

## Backend Root Cause

The new allinone log confirms that the owned workflow pool starts and
`ProcessEngine default created` occurs. The subsequent fatal ApplicationRunner
failure is in CloudTask initialization because `jobs_info2` is absent from the
bounded UAA database still used for EBSX.

`startup-cause-analysis.json` preserves the exact log SHA-256 and line order:
workflow engine creation -> missing EBSX table -> fatal runner error ->
datasource shutdown -> first `owneduaa` lookup error.

The earlier assumption that the `owneduaa` lookup error independently proves a
startup mapping defect is therefore not established. The source's
`DynaDataSource` already resolves `dynadatasource_NAME` Spring beans, and the
observed EBSX query reaches the owned database before shutdown. No production
datasource implementation or alias was changed in this checkpoint.

The final startup-log guard rejects the complete deployment despite initial
HTTP responses from all three ports. No application authorization matrix was
run on the failed deployment.

## Remaining EBSX Work

`ebsx-model-inventory.json` inventories physical table declarations from the
bound source-package model:

| Logical Datasource | Declared Tables |
| --- | ---: |
| DEFAULT | 78 |
| DB2 | 5 |
| DB3 | 18 |

These are declarations across three models, not a count of unique successfully
migrated tables. `JOBS_INFO2` is present in the DEFAULT model.

Next, stage the complete reviewed EBSX model/schema initialization using its
actual datasource relationships. Bind explicit owned EBSX schema/account
inputs rather than continuing to point EBSX at the standalone UAA fixture.
Do not add a one-off empty `jobs_info2`, disable CloudTask, grant runtime DDL or
ignore the required initialization failure to get a green port probe.

After EBSX startup passes, actual UAA service alias resolution, service OAuth,
ordinary-user/cross-library authorization, fresh-session CRUD and restart
readback remain required. Database recreation durability requires a separate
persistent fixture; the current fixtures use tmpfs.

## Reproduction

With a new explicitly owned SQL fixture and its scoped application accounts,
before starting UAA/Redis on its otherwise MySQL-only network:

```sh
node scripts/bootstrap-owned-workflow-schema.mjs \
  --execute-owned-workflow --run-id=OWNED_RUN_ID --label=UNIQUE_SCHEMA_LABEL \
  --package-report=.artifacts/SELECTED_BACKEND_PACKAGE/report.json
```

Start and verify fresh UAA using its explicit account label. Then pass the
matching workflow report to the backend launcher:

```sh
node scripts/launch-run-owned-native-backend.mjs \
  --execute-owned-backend --run-id=OWNED_RUN_ID \
  --image-report=.artifacts/SELECTED_BACKEND_IMAGES/report.json \
  --retained-uaa-report=.artifacts/native-nonadmin-fixtures/OWNED_RUN_ID/uaa-runtime-UAA_LABEL/report.json \
  --workflow-report=.artifacts/native-nonadmin-fixtures/OWNED_RUN_ID/workflow-schema-UNIQUE_SCHEMA_LABEL/report.json \
  --label=UNIQUE_BACKEND_LABEL
```

Only retain resources during an actively owned integration interval. Stop/remove
the exact backend/UAA/Redis peers after identity checks, then clean workflow
principals, scoped application accounts and finally the SQL fixture:

```sh
node scripts/bootstrap-owned-workflow-schema.mjs \
  --cleanup-owned-workflow --run-id=OWNED_RUN_ID --label=UNIQUE_SCHEMA_LABEL
node scripts/provision-run-owned-native-application-accounts.mjs \
  --cleanup-owned-application-accounts --run-id=OWNED_RUN_ID --label=ACCOUNT_LABEL
node scripts/tests/run-owned-native-nonadmin-fixture.sql.mjs \
  --cleanup-owned-run=OWNED_RUN_ID
```

The workflow cleanup deliberately requires the original exclusive MySQL peer
set. It must not stop undeclared services or remove another run's principals.
