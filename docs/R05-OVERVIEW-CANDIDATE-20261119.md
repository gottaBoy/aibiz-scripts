# R05 Overview API Candidate

Started: 2026-11-18; checkpoint: 2026-11-19, Asia/Singapore.
Status: **IMPLEMENTED-UNIT-PACKAGED-FACTORY-BOUND-MODEL-BLOCKED**.
Backend commit: `2604bc86`.
This implements the conservative source design from
[the R05 boundary](R05-OVERVIEW-REPAIR-BOUNDARY-20261118.md); it does not
close R05, generic system details, Portal presence or dynamic dashboards.

The Modeling service default entity-runtime factory is now bound to the gated
candidate in backend commit `ea3b88ae`. The candidate still delegates all
unrelated entities and methods to the existing runtime and rejects the old
metadata contract before parsing or fetching data.

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
- Complete Modeling module stage: **334/334**, including the 14 new tests.
- Complete package stage: **416/416**, including those module tests.

These are overlapping stages, not 915 distinct workflows. Three zero-test
placeholder suites remain explicitly classified as no coverage. The new
three-component images passed JAR/source-package identity and content checks.
No production/native acceptance flag is inferred from packaging.

Actual stage paths retain their November 18 names:

```text
.artifacts/native-shell-permission-20261118-r1/report.json
.artifacts/native-shell-source-package-20261118-r1/report.json
.artifacts/native-shell-source-images-20261118-r2/report.json
```

An independent read-only review found no confirmed authorization bypass or
old-logic fallback. It verified all five real query models and the native
API parser's empty-map input. That review does not replace integration tests.

## Binding And Acceptance Still Required

The original authoritative model is unchanged and still declares VOID. The
default Modeling runtime factory now instantiates the gated candidate, but the
old model is intentionally rejected before parsing or counting. Current owned
shell/bootstrap HTTP does not dispatch an accepted DTO method, so it cannot
accept its counters.

Next work must publish a consistent, owned-only model/DTO/runtime artifact,
prove the loaded runtime identity and exercise actual DTO parsing and
relationship injection. Tests currently mock that parser boundary. The
reader uses three real PSModel managers, while the observation and two
plugin managers have controlled decisions, not a proven deployment policy.

Run genuine editor/viewer/nonmember/cross-root/anonymous requests, two roots
with different nonzero totals and an authorized empty root. Independently
deny each of the six permissions and verify zero fetches, no partial output,
no persistent side effects, actual five-field serialization and exact cleanup.
Do not change generic READ, suppress failures or manufacture five zeroes to
make an ordinary editor's existing denial look successful.

The binding source/test was committed and pushed as `ea3b88ae`. This host does
not provide `mvn` or `javac`, so no fresh Java compile was claimed for that
commit; the earlier 334-module/416-package receipt remains source evidence
for `2604bc86`, not for a newly compiled `ea3b88ae` artifact.
