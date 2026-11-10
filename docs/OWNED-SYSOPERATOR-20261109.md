# Owned SysOperator HTTP Verification

Date: 2026-11-09, Asia/Singapore

## Native Definition

The exact native GET endpoint is
`/dictionaries/codelist/SysOperator`. It is served by `ConfRestController`,
which calls `CloudConfUtilRuntimeBase`. The latter handles `SYSOPERATOR`
before generic catalog lookup:

- It uses `EmployeeContext.getCurrentMust().getOrgid()`.
- It obtains employees through `getEmployeesByOrg`.
- The HTTP code item's `value` is `Employee.USERID`.
- The HTTP code item's `text` is `Employee.PERSONNAME`.
- The optional icon is the employee avatar.

The source `CodeItem` setters also publish compatibility aliases:
`id=value` and `label=text`. Those aliases must agree exactly with the
authoritative fields; they are not separate identities.

`CloudSaaSUtilRuntimeBase` caches employees under the current tenant category
and an organization tag. `EBSXCloudSaaSUtilRuntime` selects the Employee
Default dataset with an exact `ORGID` predicate.

The all-in-one packaged Employee Default SQL maps `sys_person.ID` to
`USERID`, `DISPLAY_NAME` to `PERSONNAME`, `ORGANIZATION_ID` to `ORGID` and
organization `DC` to `SRFDCID`.

`EMPLOYEE_NUMBER` is separately projected as `USERCODE`. That field matters
for the model-level dynamic SysOperator definition, but it is not the value
selected by this HTTP endpoint's special implementation. The verifier
requires it to exist as a fixture precondition without substituting it for
the actual HTTP `USERID`.

## Verification Tool

`harness-owned-operator-dictionary.mjs` uses `ownedNativeRuntimeContext` and
the existing guarded native HTTP transport. The only shared adapter change
is one exact GET allowlist entry. Query variants, legacy spelling,
case-changed paths, other catalogs and non-GET methods remain refused.

The source audit binds the controller, configuration utility, tenant/org
cache implementation, organization query, CodeItem compatibility aliases
and actual all-in-one Employee SQL
to the selected source-package/image receipt. It then compares six
authoritative owned UAA persons against the same six native Employee
projections using read-only SQL.

The 43 native HTTP checks cover:

- UAA login and self for all six ordinary fixture identities.
- Backend login, self and application-context bootstrap for each identity.
- Two nonempty, exact three-member SysOperator reads for each identity.
- Alternating centers while editor, viewer and no-access identities read
  their own organization's directory.
- Exact `USERID` and display text; no duplicate or foreign-center entries.
- An unauthenticated request denied with HTTP 401.

Directory/identity projections and both physical model-root checksums must
remain unchanged. No route configuration, grant, source data, schema, image
or peer lifecycle is modified. Normal authentication may update its owned
token/cache store.

```sh
node scripts/harness-owned-operator-dictionary.mjs \
  --execute-owned-operator-dictionary \
  --run-id=96ff5681e447 \
  --deployment-input=.artifacts/native-nonadmin-fixtures/96ff5681e447/backend-runtime-core-backend-r1/deployment-input.private.json \
  --label=sysoperator-r1
```

## Current Evidence

Focused tool regression:

```sh
cd scripts
node --test tests/harness-owned-operator-dictionary.test.mjs \
  tests/owned-platform-http.test.mjs tests/owned-native-runtime-context.test.mjs
```

Current result: **14 passed / 0 failed / 0 skipped**.

Live attempts after the owner's successful CRUD/provider restart:

- `operator-dictionary-sysoperator-r1/report.json`: retained failure before
  HTTP, because the harness's source guard did not return inspected origins.
  The guard return contract is repaired and covered by a real-transport
  integration unit test.
- `operator-dictionary-sysoperator-r2/report.json`: UAA login/self, backend
  login/self and appdata passed. The first native dictionary GET returned
  HTTP 200 with the correct three nonempty organization members and their
  real person IDs/text. The tool then failed because its strict item schema
  had omitted the source-defined `id`/`label` aliases.
- `operator-dictionary-sysoperator-r3/report.json`: **43/43 actual HTTP
  checks passed**, including all six ordinary accounts, two exact nonempty
  directory reads per actor, interleaved centers and anonymous HTTP 401.
  Each actor received only their own organization's three person IDs and
  source display names. Both `id=value` and `label=text` were checked.
  Directory/identity projections and both physical model-root checksums
  were unchanged.

These receipts are below
`.artifacts/native-nonadmin-fixtures/96ff5681e447/`. The failed r1/r2 receipts
were not rewritten. The r2 first response remains at
`001-dictionary.private.json`; only r3 closes the bounded six-user dictionary
workflow. The tool now binds `CodeItem.java` and rejects wrong, missing or
inconsistent compatibility aliases.

## Limits

A successful live receipt proves only bounded directory values and
organization/center separation for the six accounts in this owned fixture.
It does not prove model-level `USERCODE` dictionaries, other catalogs,
forged context headers, disabled-person exclusion, directory update/cache
invalidation, shared organization-ID collisions, browser rendering,
language switching, restart durability or full authorization/source closure.

All full native, permission and source-closure acceptance flags remain
false even when the bounded SysOperator workflow passes.
