# Native Model CRUD

Checkpoint: 2026-11-05, America/Mexico_City.

The subsequent disk-backed checkpoint is
`OWNED-MYSQL-VOLUME-RESTART-20261105.md`: two fresh deployments each pass 188
HTTP checks, two same-container MySQL restarts and two provider restarts.
This document's original tmpfs receipts remain unchanged. Container recreation,
host restart and global durable/permission/localization acceptance remain open.

**Both isolated center topologies now pass real ordinary-user model CRUD,
cross-library denial, forged-system canonicalization and fresh-login readback.
The same-center run additionally passes provider process restart readback.**
This closes the bounded model-library workflow, not complete localization,
original-source, production, durable-storage or release acceptance.

Evidence root: `.artifacts/native-model-crud-20261105-r1/`.

## Verified Results

| Topology | Fixture | Actual HTTP Checks | Result |
| --- | --- | ---: | --- |
| Two centers, two physical libraries | `3f995054c929` | 164 | All passed |
| One center, two physical libraries | `f56347ea1c7a` | 182 | All passed, including two provider restarts |

Exact reports:

- `native-nonadmin-fixtures/3f995054c929/native-http-two-center-crud-v1/report.json`
- `native-nonadmin-fixtures/f56347ea1c7a/native-http-same-center-crud-restart-v2/report.json`

These paths are under `.artifacts/`. Each run independently initializes SQL,
scoped accounts, workflow, EBSX with its read-only membership projection, fresh
UAA/Redis, Nacos, ZooKeeper and the three candidate backend services. Selected
backend image/package bytes are unchanged; authorization code was not changed.

The actual matrix covers six ordinary users: editor, viewer and no-access for
each library. Both libraries intentionally share logical system and record IDs
but return distinct module/system names, proving physical selection. Allowed
reads, forbidden reads/writes, forged logical-system input, native CREATE,
UPDATE, new-login GET across all six identities, REMOVE and probe absence are
checked against both physical databases.

All probe records are removed through the native API. Each selected library's
system MODELVER advances exactly 816 -> 819 for create/update/remove. Every
other original module/system field and every foreign-library field remains
unchanged at the corresponding step. UAA membership tuples and scoped grants
also remain unchanged. `two-center-final.json` and `same-center-final.json`
independently bind the final observations.

## Schema Compatibility

The earlier ten-table metadata / five-table physical fixture was sufficient
for direct SQL and some reads, not native mutation and reference checks.
The current bootstrap has 98 metadata tables and 424 tables in each physical
library, derived from the local DEFAULT/DB2/DB3 declarations and schema dump.

`model-fixture-schema.mjs` maintains an explicit compatibility plan:

- JSON models are merged by table/column with conflicting semantic type,
  nullability, primary key or unsupported type/override rejected.
- Existing dump CREATE TABLE definitions retain their fields, types, keys and
  indexes. Original dump data, users, routines and business rows are not loaded.
- Model-declared missing columns are added; model-only tables receive their
  declared columns and primary keys. No generic string/integer fallback is used.
- The current plan has 27 model-only tables and 737 column declarations added
  across new/existing tables. One new-table row-capacity adaptation changes a
  non-key string to MEDIUMTEXT without narrowing capacity. Every delta and
  source hash is recorded in each fixture's `model-schema-plan.json`.
- Runtime synchronization remains disabled and runtime identities receive no
  DDL. This is isolated fixture initialization, not an audited production
  migration or complete index/type conformance certificate.

The plan preserves dump-only fields such as physical-system routing metadata,
while adding newer query fields such as PSHelpArticle.PSSYSUSECASEID.
Reference checking is not disabled to make REMOVE pass.

The launcher and HTTP runner bind the three schema-source hashes to current
files in addition to fixture tool hashes. Metadata enumeration does not sort a
large information_schema result unnecessarily. ARM64 MySQL's private temporary
area is bounded at 128 MiB, with configuration/log areas retained at 16 MiB;
no shared volume or shared MySQL is used.

## Mutation Contract

The maintained HTTP runner now follows the actual model behavior:

1. CREATE includes required CODENAME and a unique owned probe marker.
2. The server-generated ID is accepted only after the returned code name,
   display name, marker and canonical system match the submitted probe, and
   the ID was absent from the prior physical snapshot. Cleanup uses that ID,
   not an assumed caller-supplied ID.
3. Native model writes increment MODELVER. Each operation requires exactly
   one increment in its selected library, while all foreign fields remain
   equal. Final comparison permits only the explicitly counted increments;
   it does not ignore arbitrary version or sentinel drift.
4. The fixture deliberately retains 20-second JWT validity for expiry security
   checks. The client normally logs in and bootstraps appdata again when an
   actual token approaches expiry. It does not extend server validity, re-sign
   tokens, bypass expiry, or substitute service credentials.

The same-center restart run keeps an updated probe in MySQL, restarts only its
exact owned provider container, verifies unchanged ID/image/configuration/
mounts and a new startup timestamp with canonical mapping ready, then performs
fresh-login reads. This is repeated for each library. MySQL remains running.
**It is not proof of MySQL container recreation, host restart or disk durability:
these databases use disposable tmpfs.**

## Retained Failures

Earlier failed receipts were not rewritten:

- Small fixtures exposed deployment-center, value-operation, model-change-log
  and reference-query dependencies.
- Minimal model-only CREATE reconstruction lost dump-only routing fields or
  exceeded MySQL row capacity. That experimental fallback was replaced by the
  tested compatibility plan, not kept as an unknown-type fallback.
- Early CREATE probes lacked CODENAME or assumed the caller's key survived;
  another verification incorrectly forbade the documented MODELVER side effect.
- A same-center attempt reached 401 before writes because its first 20-second
  token expired. The failed report is retained; normal client relogin fixes the
  test workflow without weakening token security.
- The apparent authorization regression was not established. The experimental
  authorization edit was withdrawn; the current PSModelDEAccessManager source
  hash equals the selected package's worktree source hash.

Some early disposable fixtures required retirement after source hashes changed
or probes could not be removed through the then-incomplete API schema. Their
failed baseline-restoration observations remain failures. Disposing a tmpfs
fixture does not retroactively prove native cleanup or permissions.

## Cleanup And Gates

`retire-owned-native-fixture.mjs` provides explicit disposal after integration:
it validates all eight exact journaled peers, private network membership,
ownership labels and images; refuses persistent SQL mounts; captures bounded
private logs; removes services first and MySQL last; and verifies typed
container/network not-found results. It never adopts unknown peers or removes
shared containers. Its report explicitly records disposal of temporary
databases/principals, not native authorization acceptance.

`cleanup-and-integrity.json` independently audits all 20 exploratory/final runs:
89 journaled container IDs, 70 named helpers and 19 created networks are absent.
No containers remain for those run labels. The final-phase baseline confirms
all sixteen protected shared container IDs, names, image IDs, startup times,
restart counts and normalized mounts unchanged. Earlier checkpoints are not
treated as current-turn lifecycle baselines.

Runtime doctor and four native frontend deployment checks pass. The live
ledger remains **6 FAIL / 3 WARN**. Final tooling regression evidence is stored
beside the HTTP receipts; these green checks do not replace outstanding gates.

Final full scripts: **4443 passed**, zero failures/skips
(`scripts-full-final-v2.log`). Final focused contracts and documentation:
**168 passed**, zero failures/skips (`contracts-docs-final.log`).
Earlier runs remain separately recorded; their results do not certify later
client renewal/restart changes.

## Reproduction

Use fresh workflow/EBSX/UAA/backend fixtures as documented in
`OWNED-UAA-MEMBERSHIP-PROJECTION-20261104.md`. The SQL bootstrap now builds the
bound compatibility schema automatically. For the actual mutation matrix:

```sh
node scripts/run-owned-native-permission-http.mjs \
  --execute-owned-native-matrix --allow-owned-probe-mutations \
  --run-id=OWNED_RUN_ID --label=UNIQUE_MATRIX_LABEL \
  --deployment-input=.artifacts/native-nonadmin-fixtures/OWNED_RUN_ID/backend-runtime-BACKEND_LABEL/deployment-input.private.json
```

Add `--restart-owned-provider` for explicitly owned process-restart readback.
After verification, dispose only the declared tmpfs fixture:

```sh
node scripts/retire-owned-native-fixture.mjs \
  --retire-owned-tmpfs --run-id=OWNED_RUN_ID --label=UNIQUE_RETIREMENT_LABEL \
  --deployment-input=.artifacts/native-nonadmin-fixtures/OWNED_RUN_ID/backend-runtime-BACKEND_LABEL/deployment-input.private.json
```

## Still Unfinished

- Durable database/container recreation and disk-backed restart verification.
- Full invalid-root, expired/negative/zero-grant, nested session/holder and
  grant/cache-rotation HTTP dimensions; boundedRoleRootAcceptance is not the
  global permissionAcceptance gate.
- Required service OAuth/alias paths and full backend initialization acceptance.
- English completeness, all marketplace offline install/update and plugin
  behavior, clean offline reconstruction, original-source/license provenance
  and release/deployment source alignment.

The marketplace 23-app inventory and PLM's 73 runtime-plugin inventory remain
different scopes. This database/native workflow checkpoint completes neither
inventory's full localization acceptance.
