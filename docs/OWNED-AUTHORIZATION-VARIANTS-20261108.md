# Owned Authorization Grant Variants

Date: 2026-11-08, Asia/Singapore

## Scope

`owned-authorization-variants.mjs` adds an independent, fail-closed candidate
runner for the authorization dimensions not covered by the existing bounded
182/185-check native HTTP receipts. It does not modify backend source, fixture
generation, shared services or historical receipts.

The canonical plan has eight cases: both physical roots, each using only that
root's existing ordinary editor grant, with `ACCMODE=0`, `ACCMODE=-1`, an
expired grant and `ACCMODE=1`. Each change is followed by verified UAA
login/self, a distinct backend token, backend self/appdata, module list/detail,
three denied write attempts, foreign-root denial, exact grant restoration and
fresh-token list/detail readback.

The plan uses the already-observed native module protocol from
`run-owned-native-permission-http.mjs`:

- Root: `/api/ibizmodeling__modeldesign/psdevslnsys/{ownedRoot}/psmodules`.
- Application context: verified UAA modeling system and organization, using
  the existing HTTP adapter.
- Denial: authenticated HTTP `403`, no leaked sentinel and unchanged full
  projections of both physical model schemas.

No synthetic root/AppContext headers or alternative APIs are introduced.

## Planning

This command creates a new private, exclusive plan directory only. It sends
no Docker, SQL or HTTP commands:

```sh
node scripts/owned-authorization-variants.mjs \
  --run-id=5d3585516a77 \
  --output=.artifacts/native-nonadmin-fixtures/5d3585516a77/authorization-variants-plan-20261108-r1
```

The CLI deliberately has no execution or mutation flag. Existing directories,
foreign-run manifests, symlinks, nested output parents and unknown flags are
rejected.

## Live Owned CLI

`run-owned-authorization-variants.mjs` now provides the separately guarded
live IO adapter. Its execution entry point requires both execution and grant
mutation opt-ins, an explicit current deployment input and a fresh label:

```sh
node scripts/run-owned-authorization-variants.mjs \
  --execute-owned-authorization-variants \
  --allow-owned-grant-mutations \
  --run-id=5d3585516a77 \
  --deployment-input=.artifacts/native-nonadmin-fixtures/5d3585516a77/backend-runtime-uaa-refresh-cache-r1/deployment-input.private.json \
  --label=grant-variants-20261108-r1
```

This command has **not** been run during implementation. It intentionally
mutates only the two owned editor grant rows and restores their exact original
values. Review the candidate and live adapter before executing it.

The live adapter:

- Uses `ownedNativeRuntimeContext` and rechecks pinned input/source hashes,
  immutable image/container IDs, inspected endpoints and exact private peers
  before and after every HTTP/SQL operation.
- Discovers every column of the five owned tables through read-only
  `INFORMATION_SCHEMA.COLUMNS`, checks the original primary keys and temporal
  expiry type, then uses full-column JSON projections.
- Executes only exact CAS statements registered by a valid, successfully
  written and `fsync`-completed private pending journal. Each registered SQL
  statement may execute at most once.
- Allows only the two ordinary-editor logins and the proven native module
  methods/paths, binding tokens to their actual login actor and UAA/backend
  peer. Unknown headers, actors, origins and record IDs are refused.
- Retries a repeated backend login token only by waiting 1.1 seconds and
  invoking the normal login endpoint again. It never modifies token claims,
  cache values, expiry configuration or issuer state.
- Performs normal verified login/self/appdata again before module requests
  when the JWT has less than ten seconds left. These extra login checks and
  renewal IDs are included in the candidate receipt.
- Uses a new `authorization-http-{label}` directory, private mode-0600
  artifacts, SQL/HTTP metadata hashes and a separate final live report.

A real successful replay may set only `boundedGrantVariantsVerified` and
`freshTokenGrantRotationVerified` in the live report. Its full native,
permission, source, same-token-cache and session/holder gates remain false.

## Runner Interface

The exported entry point is:

```js
const report = await executeAuthorizationVariants({
  manifest,
  plan: createAuthorizationVariantPlan(manifest),
  credentials,
  allowOwnedGrantMutations: true,
  io,
});
```

`io` must provide a separately reviewed owned-runtime adapter:

| Member | Required Contract |
| --- | --- |
| `preflight()` | Reinspect exact run-owned container/image IDs, labels, private peer set, source receipt bindings, storage and inspected endpoints before every operation. Reuse `validateDeployment`; no shared or extra peers. |
| `endpoints` | Exact UAA/backend origins returned by the live owned preflight, not manually supplied service URLs. |
| `grantColumns` | Every physical column from `SHOW COLUMNS` for this run's metadata `t_srfpsdevslnuser`. |
| `readGrant(target)` | Exactly one full-column JSON row selected through `grantSelectSQL`, with native numeric/null values. Missing, duplicate or extra rows must fail. |
| `executeSQL(sql)` | Execute only the supplied generated SQL in the currently inspected owned MySQL container; return numeric `ROW_COUNT()`. Never accept an arbitrary schema/table or a caller-selected container. |
| `modelColumns` | Both run-owned model schemas, each with every physical column for `t_srfpsmodule` and `t_srfpssystem`. |
| `snapshotModels()` | All ordered full-column rows of those four owned tables. It is not a projection of only the expected sentinel fields. |
| `persist(name, bytes)` | Exclusive, non-symlink, mode-0600 private write in a fresh owned artifact directory; return `{ path, sha256 }` after the write completes. |
| `tokenRequiresFreshLogin(token)` | Optional normal-login renewal check. The live adapter reads the unmodified JWT expiry; renewals remain explicit verified checks. |
| `request` | Omit in custom adapters to use the proven native HTTP transport. The supplied live adapter wraps it with exact origin/path/actor validation, guard calls and private HTTP metadata receipts. Deterministic tests replace the transport without network access. |

The runner itself chooses every actor, root, HTTP method/path and SQL mutation.
It validates canonical plan equality; foreign actors, viewers, no-access
accounts, admin IDs, inherited all-system grants and cross-schema targets
cannot be substituted into the plan.

Before any update it persists the complete original grant, intended values,
full-row compare-and-set SQL and exact inverse SQL. Updates and restoration
modify only `ACCMODE` and `EXPIREDTIME`, include every original physical column
in null-safe conditions and require exactly one affected row. Restoration
runs in `finally`, including after a transport failure following commit.
Unknown concurrent values are not overwritten. A failed journal, live-owned
preflight or unrecognized grant state produces a blocked cleanup record and
retains the original recovery journal; it never falls back to a broad UPDATE.

Physical sentinel rows must be intact before the run. A previously restored
fixture may have a monotonically advanced `MODELVER`; grant-only cases do not
reset or decrement it and require exact model equality at the end.

## Evidence Boundary

The returned contract is
`owned-authorization-grant-variants-adapter-run-v1`. Even a successful
deterministic run reports only `passed-adapter-candidate-observations`.
`nativeAcceptance`, `permissionAcceptance` and `grantVariantAcceptance`
remain false. The live adapter's ownership/source evidence and real HTTP
execution need a separate current receipt before promoting this candidate.

Open dimensions remain explicitly unverified:

- Same-token cache revocation. Distinct-token grant rotation does not prove
  existing-token revocation or a cache-invalidation API.
- Session/holder frames and legitimate nested-holder restoration.
- Null, numeric and malformed typed AppContext roots.
- Physical root remapping, model-instance and JDBC connection rotation.
- Service OAuth and every alternate/alias route.
- The second center topology needs its own current complete runtime receipt.

There is no reviewed cache-eviction endpoint in this candidate. The runner
refuses repeated backend token bytes rather than pretending that another
login necessarily bypasses the old token-keyed authorization cache. A real
adapter must allow the normal login issuer to create a new token, or fail
closed; it must not forge tokens or alter claims.

## Verification

```sh
cd scripts
node --test tests/owned-authorization-variants.test.mjs tests/run-owned-authorization-variants.test.mjs
```

Current focused result: **30 passed / 0 failed / 0 skipped**.
Combined with the existing native permission, role/root matrix and runtime
context contracts: **65 passed / 0 failed / 0 skipped**.

The deterministic success scenario exercises 200 HTTP protocol checks and
16 exact grant compare-and-set calls, restoring both original grants. Tests
also cover actor/root/schema substitution, malformed plans, inherited grants,
full-column snapshots, journal failures, CAS conflicts, post-commit transport
failure, repeated tokens, concurrent changes, physical side effects and
401/404/500 rejection. These are tool-contract tests, not 200 live HTTP
acceptance checks.

The live adapter's tests use fake Docker/HTTP endpoints and actual temporary
private file writes. They exercise the entire eight-case candidate through
column discovery, guarded SQL routing, durable journals, one-shot CAS
registration, strict HTTP binding, normal duplicate-token login retries,
source/endpoint drift rejection and private final report serialization.

No SQL or Docker mutation was performed while implementing this candidate.
