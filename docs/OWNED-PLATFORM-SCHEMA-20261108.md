# Owned Platform Schema Candidate

Date: 2026-11-08

## Status

Implemented candidate preparation and receipt validation:

- `bootstrap-owned-platform-schema.mjs`
- `fixtures/OwnedPlatformSchemaProbe.java`
- `tests/owned-platform-schema.test.mjs`

Focused verification: 63/63 tests passed. Combined platform, EBSX and workflow
verification: 109/109 passed. Implementation tests do not mutate Docker/SQL.
Parent execution `platform-r2` compiled the helper and completed the actual
native adapter bootstrap: 32 tables, 596 columns, 33 indices and adapter replay
passed. It then failed because MySQL rendered a granted column as a bare
identifier. No projection views or runtime verification were created. The
parser now accepts complete bare/backtick identifiers while preserving exact
column-set validation.

This is not a full platform, HTTP authorization or browser acceptance receipt.

The parent execution `5d3585516a77/platform-schema-platform-r1/report.json`
failed at the original MySQL-only guard before any helper/schema/user was
created. That receipt is preserved. The explicit retained-deployment mode
described below is implemented and unit-tested; a fresh-label execution is
still required. The later `platform-r2` receipt is also preserved unchanged.

## Source Findings

The source `saas-extension/PSSYSDBSCHEMES/DEFAULT.json` contains 34 entries:
32 have actual columns and an `ID` primary key; two have no physical columns:

- `SYSTEM_EXTENSION_MAINSTATE`
- `SYSTEM_EXTENSION_SCHEDULE_TASK`

Both columnless entries declare `autoExtendModel=true`. The actual packaged
Liquibase adapter skips entries without columns. The candidate preserves the
unmodified packaged model and checks that exactly 32 actual tables exist. It
does not create empty compatibility tables.

The packaged runtime's Employee Default query differs from the EBSX library
model. The runtime query reads `sys_person`, joins `sys_organization` and
`sys_department`, and selects `USER_PASSWORD AS PASSWORD` even for the
`SysOperator` code list. Merely making a two-column person view is insufficient.

The candidate binds that exact packaged runtime query to its reviewed source
file and records its SHA-256. It executes the unchanged query against a
password-redacted read projection and verifies all six identities and tenant
discriminators.

## Boundaries

Extension data is in `nf_<run>_platform`. Only the bootstrap identity has DDL;
the surviving runtime identity has schema-scoped SELECT/INSERT/UPDATE/DELETE.
The bootstrap user is dropped after table, column, primary-key, index, adapter
replay, CRUD and runtime-DDL-denial checks.

Operator views are created in the run-owned EBSX schema and read actual
run-owned UAA rows. The dedicated local definer account is locked and has only
column-level SELECT on the three required source tables. It has no grant on
`USER_PASSWORD`. The view's compatibility password column is an explicit
`CAST(NULL AS CHAR(1))`, not a copied credential.

`DISTINCT` makes all three views non-updatable. The helper checks denial of
INSERT/UPDATE/DELETE through the existing EBSX runtime principal and denial of
direct UAA password reads. View definitions, source row digests, helper source,
compiled classes, dependency inventories, and predecessor receipts are bound
to the new receipt. Existing receipts are not overwritten.

The projection allows only the manifest's six person IDs in their two exact
centers, their tenant-specific organizations and referenced tenant departments.
The department predicate explicitly correlates both department ID and person
`DC`, so identical department IDs in different tenants cannot create a
cross-tenant reference.
It retains `DC` discriminators. The pooled SQL identity still sees both fixture
centers: request-level cross-tenant authorization must be verified separately;
the view is not claimed as session-specific row-level security.

No UAA rows are changed. Native `SysOperator` uses
`sys_person.EMPLOYEE_NUMBER` as its value. The current fixture generator does
not initialize that field. The probe reports `operatorValuesReady=false`
instead of inventing a value. A fresh, source-backed account fixture should
initialize the real field before claiming code-list acceptance.

## Execution

Run only after checking the exact run-owned MySQL/network receipts and choosing
a new, unused label. Both predecessor reports must belong to the same run and
the same verified backend package:

```sh
node scripts/bootstrap-owned-platform-schema.mjs \
  --execute-owned-platform \
  --run-id=<12-lowercase-hex-run> \
  --label=platform-r2 \
  --workflow-report=.artifacts/native-nonadmin-fixtures/<run>/workflow-schema-<label>/report.json \
  --ebsx-report=.artifacts/native-nonadmin-fixtures/<run>/ebsx-schema-<label>/report.json
```

The default remains MySQL-only, using the unchanged
`validateApplicationTarget` boundary. It never auto-discovers or adopts other
network peers. When the exact owned eight-node backend is intentionally
retained, additionally supply:

```sh
--deployment-input=.artifacts/native-nonadmin-fixtures/<run>/backend-runtime-<label>/deployment-input.private.json
```

This explicit mode opens `ownedNativeRuntimeContext`, cross-binds its manifest
and resources to this invocation's exact file hashes, requires all four service
roles and the three declared auxiliary roles plus MySQL, and invokes the full
runtime guard before each orchestration SQL operation and before/after each
synchronous helper run. The helper uses `--rm`; the network must have exactly
the original eight peers again when the helper returns. Runtime input,
configuration, lifecycle, image, network and volume drift fail closed. The
context closes in the same outer `finally` as the pinned-directory lifecycle,
including preparation failures. No default validation gate is relaxed.

## Reviewed Resume

The narrowly scoped resume mode exists for `platform-r2`-style failure only:
native bootstrap succeeded, all three private-credential-bound accounts exist,
no projection view was attempted, and no runtime verification/configuration was
issued. It requires a new output label and the old receipt's explicit SHA-256.

Add these options to the ordinary execution command with a fresh label:

```sh
--resume-failed-report=.artifacts/native-nonadmin-fixtures/5d3585516a77/platform-schema-platform-r2/report.json \
--resume-failed-report-sha256=887d457c7372010d67848f8cefb7ea1aa77dbd9474f8f24c429807afa708a251
```

The operation does not DROP/recreate any database or user, stop any node, or
alter historical receipts. Before reusing ownership it binds the old helper,
compiled classes, dependency inventory, model/query, predecessor receipts,
deployment input, CID journals and private credential file. Existing account
authentication fingerprints, scoped grants, locked definer and zero active
platform sessions must all match.

All 32 actual application tables must be empty and exactly match source column
names/types/nullability/capacity, primary keys and normal indices. Only the two
native Liquibase metadata tables may accompany them. Active changelog locks,
extra tables/views, triggers, routines, events, foreign keys and any existing
definer view anywhere are rejected. The new run recompiles and replays the
native adapter, then continues the original projection and real CRUD checks.
The new receipt binds the previous receipt and empty-state proof; its reader
continues to revalidate that historical binding.

Cleanup of an earlier failed receipt refuses a principal now backing views
recorded by a resumed receipt, preventing the old receipt from invalidating a
later successful candidate.

`platform-r3` stopped at the resume structure check because the first
implementation reversed the native enum values for time and integer columns.
The native source declares `DATETIME=5`, `INT=9`, and the adapter forces primary
keys to NOT NULL. The validator now mirrors those rules exactly; dedicated
source-contract tests reject reverse mappings rather than relaxing type checks.
No historical receipt was edited.

The parent subsequently replaced only the owned UAA using its source-backed,
16-check security replacement workflow. A changed target is still rejected by
default. To resume across that reviewed transition, additionally supply:

```sh
--resume-uaa-replacement-report=.artifacts/native-nonadmin-fixtures/5d3585516a77/backend-runtime-uaa-refresh-errors-r1/report.json
```

This option is valid only with the explicitly pinned failed platform receipt.
It requires `passed-owned-uaa-security-and-replacement`, all 16 exact security
checks passing, protected peers unchanged, the old UAA ID/image and old
deployment-input hash matching the failed receipt, and unchanged manifest and
MySQL/resource bindings. A structured comparison permits differences only in
`services.uaa` and `endpoints.uaa.containerId/endpointId`; all other deployment
fields must be equal. The original target and replacement-report hash are
recorded and revalidated when consuming the new configuration. A local,
read-only verification of the actual replacement receipt passed; its SHA-256
is `61f9425da7e9c7008b08b9f04f26cafe97bd8ea9771ac1846929ed0446f1daa8`.

Each mutating Docker/SQL operation checks the owned container, network and
volume identity. Existing platform schemas, users or target views are rejected,
not adopted. Credentials are private files/stdin, never command arguments or
public report fields. Failed candidates are retained with their private logs.

Helper launches require pre-absence, an absent exclusive CID file, and a fresh
random helper label. Cleanup uses only an immutable CID from that invocation,
never a container name. Missing or invalid CID evidence cannot authorize
deletion of a colliding container. One helper cleanup failure does not skip
the remaining helpers, report writing, or pinned-directory closure.

User creation is journaled before SQL executes and bound to a SHA-256 of the
expected native-password authentication string. View creation is journaled
before SQL executes and tagged by an unpredictable, semantically neutral
ownership predicate. A CREATE/GRANT followed by failed receipt capture can be
recovered without adopting an unrelated same-name resource. When grant hashes
were not captured, cleanup accepts only USAGE or the reviewed schema/column
grant subset; broader privileges fail closed. A view without a captured DDL
hash must still match its creation marker, exact target columns, locked
definer, non-updatable state and source schema/table.

Consume the candidate with `readOwnedPlatformConfiguration`, supplying the
same package receipt. It verifies the current model/query bytes, both
predecessor receipts, classes, dependencies and private configuration. It
returns the runtime configuration plus a credential-free input binding.

The backend configuration integration must explicitly add:

```yaml
ibiz:
  deploysystems:
    extension:
      deploysystemid: extension
      runtimeclassname: net.ibizsys.central.cloud.saas.extension.runtime.SystemRuntime
      updatedbschema: false
      extension: false
      enablereload: false
      installdata: false
      settings:
        sysdbscheme:
          default:
            datasource: ownedplatform
  servicehub:
    deploysystems:
      - gateway
      - ebsx
      - extension
```

`servicehub.datasources.ownedplatform` must use the private configuration's
exact URL, runtime user/password, driver and schema. Do not switch the EBSX
default datasource to the platform schema. The isolated runtime must then
prove the real `/extension/api/internal_messages/fetch_cur_receiver` route,
operator code-list values, tenant denial and browser workflows. A schema-only
receipt cannot promote these checks to passed.

## Cleanup

Stop the run-owned backend consumers first, then run:

```sh
node scripts/bootstrap-owned-platform-schema.mjs \
  --cleanup-owned-platform \
  --run-id=<12-lowercase-hex-run> \
  --label=platform-r2
```

Cleanup refuses active platform or EBSX SQL sessions, verifies view creation
proofs, account credential proofs and captured grant/DDL hashes where present,
drops only recorded projection views and tool-created users, and writes a fresh
cleanup receipt. It verifies every existing account/view before the first DROP,
and supports retry after partial deletion. The actual
platform schema stays inside the owned MySQL resource until fixture retirement.
Run platform cleanup before EBSX/workflow/application-account cleanup.

## Remaining Gates

- Complete a fresh-label resume after the grant-rendering correction.
- Inspect the resulting runtime/model/schema receipt.
- Populate real operator values in a fresh application account fixture.
- Bind the candidate into a fresh owned backend deployment input.
- Verify native extension HTTP behavior and browser save/readback.
- Complete the request-level tenant and role authorization matrix.
- Retire all run-owned resources with cleanup receipts.
