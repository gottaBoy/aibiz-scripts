# Owned Modeling Application Routing

Checkpoint: 2026-11-04, Asia/Singapore.

Later checkpoint: `OWNED-UAA-MEMBERSHIP-PROJECTION-20261104.md` verifies a
locked-definer, non-updatable projection of actual UAA memberships and normal
six-user appdata bootstrap. The earlier membership/context blockers below
are resolved for that fixture. The next failure is incomplete metadata schema
inside model authorization; permission acceptance remains false.

**The owned ModelDesign root route no longer returns 404. The real matrix
still fails: an ordinary editor receives 403 before model authorization
because application employee context has not been established. Normal
appdata bootstrap exposes a missing cross-schema membership dependency.**
This is not permission, CRUD, durable restart or complete localization acceptance.

Evidence root: `.artifacts/owned-modeling-routing-20261104-r1/`.
Fixture root: `.artifacts/native-nonadmin-fixtures/9ec24f521056/`.

## Source Contract

Two configuration omissions were identified without changing backend package
bytes, application models or authorization implementations:

1. Original provider configuration enables `ibiz.servicehub.enableappgateway`.
   The isolated builder omitted it. `ServiceSystemRuntimeBase` then declines
   to create the ModelDesign runtime because the application declares neither
   a backend plugin nor a resource. The builder now enables the existing
   app-gateway mode only on provider; allinone stays explicitly false.
2. The isolated `/api/**` route forwarded external paths unchanged. The actual
   `GatewayUtils.getAppGatewayNode` generates per-entity application routes
   with `StripPrefix` and `PrefixPath`, targeting the API bound by that
   application's model.

The previous EBSX checkpoint's direct-provider 404 did not distinguish a
provider-native path from an nginx-facing application path. Its warning
against an arbitrary raw-API substitution remains valid, but a faithfully
generated application route is the normal architecture, not a bypass.

## Maintained Probe

- `fixtures/OwnedModelingApplicationRoutesProbe.java` uses the exact packaged
  factory and route generator. It reproduces null construction with app-gateway
  mode off, and `net.ibizsys.central.app.ApplicationRuntime` with it on.
  This is a factory test, not a full Spring application initialization test.
- It loads the launcher's staged model and generates the canonical
  `ibizmodeling__modeldesign__psdevslnsys` route from ModelDesign.
- `owned-modeling-application-routes.mjs` compiles and runs this helper offline,
  without annotation processing, implicit source lookup, network or database
  credentials. It uses the verified workflow run's exact library inventory.
- The canonical route must match application, generator/factory origins,
  service, path, order and both filters exactly. Missing/changed results
  abort startup. Inventoried model/dependency/helper inputs must remain unchanged.
- Helper source/tool hashes, compiled classes, dependency inventory, model
  fingerprint and command results are recorded under the backend report.
  Cleanup checks explicit names, images and ownership labels; pre-existing
  names are neither adopted nor removed.

The resulting owned route is deliberately limited:

```text
External: /api/ibizmodeling__modeldesign/psdevslnsys/**
Target:   exact owned provider:32002
Filters:  StripPrefix=2, PrefixPath=/ibizmodeling/modelapi
```

The extra stripped component is the nginx-facing `/api` prefix. No generic
`/api/**` fallback, ignore-auth rule, privileged header, administrator grant,
runtime DDL privilege or root-selected model datasource override was added.
Other ModelDesign entities are not claimed as routed or accepted.

## Actual Observations

Fresh SQL, scoped accounts, workflow, EBSX and standalone UAA verification
pass. The backend's offline route probe passes, all three HTTP transports
start, and the earlier unavailable ModelDesign runtime observation does not
recur. Full initialization and native/permission flags remain false.

`native-http-application-route-r1/report.json` records **38 passed / 1 failed**:
six-user login/self and rejection checks pass, but the first allowed
`FETCH_CUR_SYS` returns 403. No probe writes were enabled. The original
physical model baseline is restored.

Additional read-only diagnostics establish:

| Request | Gateway | Direct Canonical Provider |
| --- | ---: | ---: |
| No token | 401 | 401 |
| Actual ordinary-user backend token | 403 | 403 |

Both 403 responses have empty bodies. Source inspection explains this boundary:
`SysUAAUtilRuntimeBase` can recognize the authenticated user without creating
an `IEmployeeContext`; `MethodHandlerBase.doFilter` then returns 403 before
the model access manager executes. This is not evidence that editor grants
or cross-library isolation are correct or incorrect.

Using an organization from the actual verified UAA login, not a fabricated
user/context header, a diagnostic requests normal appdata bootstrap:

| Stage | Result |
| --- | --- |
| Model read with `srfsystemid=ibizmodeling` and actual `srforgid` | 403 |
| `GET /appdata` with the same ordinary-user token/context headers | 500 |
| Same model read after bootstrap failure | 403 |

The captured allinone exception is:

```text
Table 'nf_9ec24f521056_ebsx.sys_role_member' doesn't exist
```

`RTJWTCloudUAAUtilRuntime.QUERY_PERMISSION` and `QUERY_PERMISSIONACTION` join
the EBSX permission/role tables to unqualified `SYS_ROLE_MEMBER`.
The EBSX model's 78 business tables do not include that UAA membership table.
Live information_schema confirms it exists in the separate owned UAA schema,
not EBSX. The first query failure prevents normal employee-context bootstrap.

No empty membership table, copied account dump, synthetic Redis employee
context, superuser/API-user promotion or relaxed permission gate was introduced.
The 403 matrix and 500 bootstrap evidence remain failed observations.

## Verification And Cleanup

| Check | Result |
| --- | --- |
| Owned SQL fixture | 55 passed |
| Scoped application accounts | 32 passed |
| Exact-library workflow / EBSX | 38 workflow / 78 EBSX business tables verified |
| Standalone UAA HTTP/security | 16 passed |
| Packaged factory/canonical-route probe | Passed offline and again inside actual launch |
| Backend HTTP/fatal-startup gate | Passed; full initialization unaccepted |
| Actual ordinary-user matrix | 38 passed / 1 failed at 403 |
| Final full scripts | 4409 passed; no failures/skips |
| Native frontend deployment | 4 passed; native acceptance false |
| Runtime doctor | Passed |
| Live ledger | 6 FAIL / 3 WARN remain |

Final evidence includes full-column physical-model baseline comparison,
membership/schema inventory and current implementation hashes in
`database-and-authorization-final.json`. Private HTTP/log bodies are retained
separately; public summaries contain hashes and bounded observations.

EBSX/workflow and application principals were cleaned before exact MySQL
cleanup. `cleanup-and-integrity.json` independently confirms eight service
containers, nine named helpers (including the offline preflight) and one
private network are absent. All sixteen protected shared container IDs, names,
image IDs, start times, restart counts and normalized mounts are unchanged.
No shared restart, tag replacement or historical receipt promotion occurred.

## Next Gates

1. Review the UAA/EBSX membership data-access contract. Compare a narrowly
   scoped read-only membership projection with a source-level datasource
   separation; preserve actual membership rows, tenant boundaries and minimum
   privileges. Do not fix this with an empty lookalike table or broad UAA grants.
2. Establish normal appdata bootstrap with the actual organization/system
   protocol. Then bind that proven protocol into the HTTP matrix; it currently
   sends only a token on model requests.
3. Resolve remaining owned service aliases, including `lb://uaa-api`, and
   dedicated service OAuth inputs as their real paths are exercised.
4. Rerun both center topologies, read/denial matrices, explicitly scoped CRUD,
   fresh-login readback and separate persistent-storage restart tests.
5. Marketplace offline install/update, original-source gaps and English
   coverage remain separate, unfinished localization work.
