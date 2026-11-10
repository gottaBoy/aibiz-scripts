# Owned ZooKeeper And Startup Gates

Checkpoint: 2026-11-04, Asia/Singapore.

Subsequent checkpoint: `OWNED-WORKFLOW-SCHEMA-20261104.md` verifies an independent
38-table schema using the exact Flowable libraries and a CRUD-only runtime
account. Actual allinone initialization now advances beyond Flowable and fails
on missing EBSX `jobs_info2`. The `owneduaa` lookup error occurs after datasource
shutdown, so an independent alias defect is not established. Earlier reports
and the investigation below are retained as dated evidence.

**ZooKeeper is connected and verified in the owned fixture. The complete backend
is still not accepted.** A newly reproduced early-HTTP false positive is now
rejected. The remaining failure is Flowable schema initialization and datasource
binding, not the previous missing ZooKeeper URL.

Evidence root: `.artifacts/owned-zookeeper-integration-20261104-r1/`.
Fixture root: `.artifacts/native-nonadmin-fixtures/dd822708164b/`.

## Changes

- `owned-backend-resources.mjs` records immutable local ZooKeeper and Nacos image
  IDs and exact role-specific temporary storage policies.
- ZooKeeper uses local ARM64 image
  `sha256:2fc0f525e369f1a0bea0f92c03649072dc2141ce4b983ce7373c3a05b3b549a3`
  (the inspected package is ZooKeeper 3.7.2). It runs as `65532:65532` with a
  read-only root filesystem, dropped capabilities, no-new-privileges, no host
  ports and no anonymous or persistent volumes.
- `/conf`, `/data`, `/datalog`, `/logs` and `/tmp` have explicit bounded tmpfs
  policies. The admin HTTP service is disabled; only the `srvr` four-letter
  command is enabled.
- Startup requires an exact successful `zkServer.sh status` response with
  `Mode: standalone`, not just an open TCP socket. The same owned network and
  immutable container identity are checked before the probe.
- Both allinone and provider configure gateway UNISTATE with only the owned
  ZooKeeper hostname and port 2181. Missing, shared or foreign names are rejected.
- The deployment validator supports only explicitly declared auxiliary
  Redis/Nacos/ZooKeeper roles. ZooKeeper's image, launch/run labels, network,
  non-root user, environment and exact temporary storage are independently
  checked. Other service tmpfs mounts are accepted only under the reviewed
  role-specific policy; existing read-only input-bind checks remain.
- Backend fatal startup logs are checked after individual HTTP responses,
  after all candidate ports respond, and again while retaining final logs.
  A late `Application run failed`, `APPLICATION FAILED TO START` or
  `Error starting ApplicationContext` invalidates the run even if ports answered.
  Complete application initialization remains explicitly unverified.
- Flowable's own `cloudwfutil.schemaupdate` is explicitly false; its
  source-declared `ayncexecutoractivate` setting is false too. The workflow
  engine is not skipped. Runtime SQL accounts still cannot execute DDL.

## Actual Evidence

The new fixture uses a separately checked `10.34.0.0/24` internal bridge,
ARM64 MySQL, six ordinary identities and two physical model databases.

| Check | Result | Evidence |
| --- | --- | --- |
| Owned SQL fixture | 55 passed | fixture `isolated-sql-report.json` |
| Scoped application accounts | 32 passed | fixture `application-accounts-zookeeper-r1/report.json` |
| UAA Boot/MySQL/Redis and real TokenStore | 16 passed | fixture `uaa-runtime-zookeeper-r1/report.json` |
| ZooKeeper standalone readiness | Passed in all three backend attempts | fixture `backend-runtime-zookeeper-r{1,2,3}/report.json` |
| Native frontend deployment | 4 passed; native acceptance false | evidence `native-deployment/report.json` |
| Live version ledger | 6 failures, 3 warnings remain | evidence `ledger.json` |
| Final focused contracts | 290 passed, zero failures/skips | evidence `contracts-final.log` |
| Initial broad scripts checkpoint | 4348 passed, before the late-startup guard | evidence `scripts-full-r1.log` |
| Intermediate scripts checkpoint | 4349 passed; not the final-input verdict | evidence `scripts-full-r2.log` |
| Final-input scripts | 4350 passed, zero failures/skips | evidence `scripts-full-final.log` |
| Shared service integrity | All 16 protected containers unchanged | evidence `shared-before.json`, `shared-after.json` |
| Exact resource cleanup | All 18 journaled service containers and private network absent | evidence `cleanup-and-integrity.json` |

### Early HTTP Was Not Successful Initialization

`backend-runtime-zookeeper-r1/report.json` retains the original
`passed-owned-backend-http-transport-only` verdict. Its HTTP observations were
real, and its source/image/network bindings were checked. **It is not a valid
application-startup or permission verdict.** Its retained allinone log contains
a later fatal ApplicationRunner failure while initializing Flowable.

The application source confirms why: `ServiceHub.run(ApplicationArguments)`
calls `install()` after the web server and the ordinary `Started` log line.
Opening a socket, returning 401/404, or printing `Started` cannot prove this
installation completed.

`early-http-negative-replay.json` records independent rejection of that exact
retained log by the new guard. The original report was not rewritten.

Both `backend-runtime-zookeeper-r2` and `r3` are correctly **failed**. In both,
the whole-deployment log recheck rejects allinone's late failure. The five
created backend/dependency containers are removed, and the retained
MySQL/UAA/Redis peer integrity passes.

In r1/r2, Flowable attempted to create `ACT_ID_PROPERTY`, which the scoped
account denied. In r3, automatic schema update is off and schema version
validation still fails. The logs also contain a dynamic-datasource lookup
failure for `owneduaa`. These errors remain unaccepted prerequisites.

No application HTTP role/root matrix or restart/persistence acceptance was
executed after the failed startup gate.

## Schema And Dependency Findings

`schema-and-baseline.json` independently checks the live isolated database before
cleanup:

- Exactly the eighteen physical tables declared by the UAA model remain.
- There are no `ACT_*` workflow tables.
- Both physical model baseline projections are unchanged.
- UAA CRUD and metadata SELECT grants remain exactly scoped; no DDL grant was
  added to make the application boot.

`flowable-local-resources.json` inventories the selected source-package
allinone JAR without executing SQL or libraries. The archive SHA-256 matches its
package receipt. It contains 34 `flowable-*` JARs and 28 MySQL/MySQL55 create
resources across nine of them. These are alternative dialect/component
resources, not 28 independent migrations or a command to execute all of them.

The filenames identify 6.4.2, but the actual runtime exception reports library
version 6.5.0.1. `flowable-class-owners.json` finds the literal `6.5.0.1` in the
packaged `ProcessEngine` and `IdmEngine` class bytes; `IdmDbSchemaManager` also
contains the literal `5.99.0.0`. This is static byte ownership evidence, not an
independent JVM class-origin probe. The exception's `5.99.0.0` must not be
treated as an observed installed database version: the fixture has no workflow
tables.

Do not replace these dependencies by a same-named public 6.4.2 JAR, infer source
authenticity from the filename, edit a version table to satisfy the check, or
blindly execute all packaged SQL. The exact customized dependency source,
resources, schema compatibility and license/provenance still need review.

## Next Gate

1. Establish the exact Flowable implementation/resource provenance and choose
   a compatible schema bootstrap using the pinned candidate inputs.
2. Give EBSX/workflow an explicitly declared owned schema and runtime account,
   separate from the bounded standalone UAA model, or prove a reviewed combined
   schema contract. Apply migrations with a separate bootstrap identity.
3. Correct the `owneduaa` ServiceHub/dynamic-datasource name binding and check
   the effective connection/schema inside the running service.
4. Rebuild only if implementation source changes; preserve source/package/image
   bindings and rerun startup without ignoring the workflow engine.
5. Then run actual backend login, owned UAA alias resolution, service OAuth,
   six-user/cross-library authorization and fresh-session write/readback.
   Database recreation durability requires a separate persistent fixture.

`source-final.json` binds the eight final changed source/test files. Cleanup
reports do not modify the earlier `retainedOwned` observation in the UAA startup
receipt; those resources were intentionally retained only for these attempts.
