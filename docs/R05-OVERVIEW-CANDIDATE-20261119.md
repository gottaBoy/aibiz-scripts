# R05 Overview API Candidate

Started: 2026-11-18; checkpoint: 2026-11-19, Asia/Singapore.
Status: **OWNED-METADATA-PREPARED-NATIVE-PARSER-TESTED-RUNTIME-NOT-BOUND**.
Backend implementation: `2604bc86`; metadata-gated selection: `9db1b697`.
This implements the conservative source design from
[the R05 boundary](R05-OVERVIEW-REPAIR-BOUNDARY-20261118.md); it does not
close R05, generic system details, Portal presence or dynamic dashboards.

The Modeling service now selects the gated candidate only for the exact
ModelObservation entity with a single, consistent DTO overview method in
backend commit `9db1b697`. Other entities, duplicate/inconsistent metadata,
old VOID models, and explicit runtime plugins retain the existing runtime.

## Implementation

The dedicated `ModelObservationDEServiceAPIRuntime` recognizes only the
exact ModelObservation / SysOverviewCnt action. It requires POST, READ,
a single non-output DTO input, a DTO result and the actual PSDevSlnSys
parent relationship. Mismatched metadata, record keys, batch input or a
conflicting AppContext root fail before parsing/counting. Unrelated methods
delegate to the existing API path. The old VOID metadata is intentionally
refused; it is not silently reinterpreted or dispatched to the old logic.

The reader resolves the logical system from the current actor's valid SYS
grant and checks root, developer, center, expiration and READ capability.
The observation manager plus all five destination managers must authorize
before the first dataset fetch. No registry or role policy is widened.
In particular the two plugin managers retain their existing policies;
ordinary root READ does not automatically grant those permissions.
Grant resolution retains the existing manager/cache protocol; this does not
repair or accept A02 same-token revocation.

Each destination receives a separate server-created filter with the
server-derived system context and EQ condition, page zero, size one and
count enabled. Existing manager-added conditions are retained. Each real
CurSys dataset uses the bound context system ID. The response reads
`Page.getTotalElements()`, not the one-row page length, validates all five
pages and returns only:

```text
sysappcnt sysdecnt serviceapicnt pfplugincnt sfplugincnt
```

Caller-supplied roots, system IDs, selectors and counters are not used.
No original input DTO, arbitrary system configuration, partial result or
fabricated zero is returned on failure.

## Verification

Fresh offline compiler/build work used private source/cache copies and a
network-disabled temporary compiler; the helper container was removed.
Maintained source and dependency inputs were checked for drift.

- New reader tests: **10/10**.
- New API runtime tests: **4/4**.
- Permission-focused stage: **151/151**.
- Complete selected-reactor stage: **338/338**, including **327** Modeling
  module tests and **11** upstream tests.
- Complete package stage: **420/420**, including those module tests.

These are overlapping stages, not distinct business workflows. Three zero-test
placeholder suites remain explicitly classified as no coverage. Earlier
three-component images for `2604bc86` passed JAR/source-package identity and
content checks; no updated image delivery is claimed for `9db1b697`. No
production/native acceptance flag is inferred from packaging.

Actual stage paths for the metadata-gated rerun:

```text
.artifacts/r05-metadata-gated-20261120-r2/report.json
.artifacts/r05-metadata-package-20261120-r2/report.json
```

An independent read-only review found no confirmed authorization bypass or
old-logic fallback. It verified all five real query models and the native
API parser's empty-map input. That review does not replace integration tests.

## Binding And Acceptance Still Required

The original authoritative model is unchanged and still declares VOID. It
therefore keeps the existing legacy runtime; metadata-gated selection does
not silently reinterpret or repair that old logic. Explicit use of the new
candidate against VOID metadata fails closed, while the legacy deployment
remains unaccepted and the overview route stays outside the owned browser
read policy. Shell/bootstrap HTTP does not prove counter execution.

Next work must publish a consistent, owned-only model/DTO/runtime artifact
and prove the loaded runtime identity. The original candidate tests mocked
the parser boundary; the November 21 follow-up below adds native DTO parsing
and relationship injection tests. The reader uses three real PSModel managers,
while the observation and two plugin managers have controlled decisions,
not a proven deployment policy.

Run genuine editor/viewer/nonmember/cross-root/anonymous requests, two roots
with different nonzero totals and an authorized empty root. Independently
deny each of the six permissions and verify zero fetches, no partial output,
no persistent side effects, actual five-field serialization and exact cleanup.
Do not change generic READ, suppress failures or manufacture five zeroes to
make an ordinary editor's existing denial look successful.

The metadata-gated binding and tests were committed and pushed as `9db1b697`.
The fresh isolated compiler used the pinned Maven image and network-disabled
cache; it is still source/package evidence only. It does not establish native
deployment, live HTTP dispatch, nonzero counts, or production acceptance.

## November 21 Follow-Up

`prepare-r05-owned-model.mjs` now consumes four SHA-bound authoritative model
inputs and produces a private four-file overlay. Six return declarations and
backend/app five-field BIGINT DTOs agree; permissions, original logic and input
contracts are unchanged. Source drift, inconsistent metadata, unsafe output,
overwrites and candidate/receipt tampering are rejected. The maintained
authoritative model remains unchanged.

`ibiz-service-hub@3f02a985` adds five tests that do not override `getActionArgs`.
With the actual owned overlay, the native disk model loader, input DTO factory,
read-only-field stripping, relationship root injection and five-field long
serialization execute. All five plus the existing fourteen reader/API tests
pass in a fresh offline compile (19/19). The portable disk fixture branch was
separately compiled and passed 5/5. Both compiler helpers were removed and
maintained source/dependency hashes stayed unchanged.

This replaces the previous parser-only-mocked coverage gap with a bounded
native parser test, not runtime integration acceptance. The test bypasses full
system preparation; managers, query results and authorization decisions are
still controlled dependencies. Java loads the API/entity and resolves its
embedded action/DTO; the builder independently checks the standalone action
and app declarations. Full base-model/runtime delivery, automatic class
selection, real role/root HTTP requests and real counts remain open.

See [the current execution list](MULTIAGENT-PROGRESS-20261121.md) and
`records/aibiz-multiagent-progress-20261121.json` for exact private receipts.

The next November 21 batch adds full owned launcher staging and cross-process
input revalidation. The actual 17,199-file model stages successfully without
changing its source. Disk-loaded native factory and App DTO tests plus the
explicit-null mapper regression pass 38/38 in both portable and owned metadata
modes (`ibiz-service-hub@26e52348`). Runtime initialization dependencies remain
controlled; this does not prove a booted service selected the class.

Rebinding serialized deployment metadata now derives a new proof from current
candidate/source/full-stage bytes and exact provider mount data. A required
binding option prevents deleting the declaration to bypass validation. The
full-model quiescent rebind benchmark improved from 28.6 to 19.2 seconds by
removing adjacent duplicate verification, but still fails the 20-second JWT
budget with its five-second dispatch margin. Benchmark mount data is synthetic,
not Docker inspection or HTTP evidence. No token policy was changed.

Current source/image delivery, a bounded input-verification schedule or
immutable-model artifact, real role/count HTTP, and frontend handoff schema
support remain open. See `records/aibiz-r05-a01-progress-20261121.json`.
