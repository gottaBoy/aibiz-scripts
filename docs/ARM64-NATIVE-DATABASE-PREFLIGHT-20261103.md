# ARM64 Native Database Preflight

Checkpoint: 2026-11-03 UTC. This advances the database prerequisites for the
isolated backend lane. It does not establish application HTTP authorization,
native editor acceptance, durable restart/persistence or backend cutover.

## Changes

`mysql-fixture-profiles.mjs` now owns the explicit pinned MySQL profiles already
used by standalone UAA security verification. The native SQL runner can select
the reviewed `mysql57-bitnami-arm64` image without automatic architecture
fallback. Existing unprofiled journals retain their historical AMD64 image and
mount policy; they are not relabeled as ARM64 evidence.

The ARM64 lane requires:

- The exact image, non-root UID/GID and read-only container root.
- Exact tmpfs options, masked bundled init directories, and no extra mounts.
- An internal, run-owned network with no host-published database port.
- Matching cached-image/server architecture, MySQL version, lowercase table
  names and utf8mb4 configuration.
- PID1 `mysqld` plus a successful TCP query before accepting readiness.
- Zero pre-existing business schemas before the owned bootstrap.

Application-account provisioning and HTTP permission deployment preflight
recognize the same explicit profile while preserving their ownership,
peer/network, scoped-grant and image guards.

`uaa-fixture-schema.mjs` shares the existing reviewed model-to-fixture DDL
generator with standalone UAA. The SQL runner's new explicit `--uaa-model`
input avoids dependency on a shared database's credentials or socket. It is
mutually exclusive with live schema capture and never acts as a fallback.
It creates all eighteen model tables with nullable omitted audit fields.
This is bounded test DDL, not an official schema migration or proof of the
authenticity/completeness of the original UAA source.

## Evidence

Workspace evidence root:

`.artifacts/backend-isolation-2026-11-03T09-18-31.208Z/`

| Check | Result | Evidence |
| --- | --- | --- |
| Fixture/schema/storage/transport contracts including UAA fixture tests | 99 passed, zero failures/skips | `contracts-final.log` |
| Two-center SQL and application-account replay | 55 SQL + 32 account checks passed | `sql-replay-r4.json` |
| Same-center SQL and application-account replay | 55 SQL + 32 account checks passed | `sql-replay-r4.json` |
| Final replay after stricter extra-mount rejection | Both topologies: 55 SQL + 32 account checks passed; cleanup passed | `sql-replay-r5.json` |
| Fresh standalone UAA security replay | 17/17 passed; all three containers/network removed | `uaa-security.json` |
| HTML engine and actual locale-resource integration | 23 passed, zero failures/skips | `html-view-engine.log` |
| Complete workspace script tests | 4302 passed, zero failures/skips; first failed run retained | `scripts-full-r2.log`, `scripts-full-r2-result.json` |
| Shared service lifecycle integrity | All 14 container IDs/images/start times/restart counts/mounts unchanged | `containers-before.json`, `containers-after.json` |
| Exact temporary-resource cleanup verification | All 9 created containers and 7 networks absent | `cleanup-verification.json` |
| Runtime doctor | Passed | `runtime-doctor.log` |
| Native frontend deployment audit | 4/4 passed; native acceptance remains false | `native-deployment.json` |
| Live deployment/source version ledger | Still 6 failures and 3 warnings | `backend-ledger.json` |

Each topology uses six ordinary people, two physical model databases with the
same logical system and record IDs, separate JDBC principals and distinct
physical sentinels. SQL checks exercise published query joins, own writes,
cross-database SELECT/UPDATE rejection, escaped-schema wildcard rejection,
non-mutation of denied targets and restoration of the original sentinels.
Account checks verify UAA-only CRUD, metadata-only SELECT and denied access
outside those schemas. These are SQL privileges, not application-role HTTP
permission acceptance.

The selected `10.34.0.0/24` was checked against current Docker networks and host
IPv4 routes. No existing network was pruned or reused. Each successful topology
removed only its exact owned MySQL/network IDs after its account checks.

## Retained Diagnostics

Earlier invocations remain retained, rather than overwritten:

1. `sql-replay.json`: the historical live-schema source expected a root-password
   environment variable absent from the current manually started shared MySQL.
   No fixture network or database container had been created.
2. `sql-replay-r2.json`: Bitnami's initialization child briefly answered TCP.
   Its logs then showed the setup script stopping that child; the next query
   failed with connection refusal. The owned container/network were removed.
   Readiness now also requires the final PID1 daemon, not a fixed sleep.
3. `sql-replay-r3.json`: 55 SQL checks passed, but the application-account
   verifier still expected the historical `5.7.26` literal. Explicit profiles
   now use their reviewed version/case/charset verifier. Cleanup passed.
4. `scripts-full.log`: all seven failures came from the old HTML-engine test
   loader, which did not model the production locale imports and resolved
   `en.json` as `en.json.ts`. The fixture now loads the real locale adapter and
   dictionary, preserves explicit extensions, and supports SystemJS side-effect
   imports without setters. The minified main-entry test also exercises an
   English native app and verifies real model translation. No production source,
   engine behavior assertion or error-propagation assertion was removed.

## Reproduction

After checking an unused private subnet, from the workspace root:

```sh
node scripts/tests/run-owned-native-nonadmin-fixture.sql.mjs \
  --execute-owned-sql-smoke \
  --mysql-image=sha256:2e7e2b4ae4494b2bb9fe9d2ad4b6510790d714ba2e60af2f0df5aaca44f0c28f \
  --database-profile=mysql57-bitnami-arm64 \
  --subnet=SELECTED_PRIVATE_SUBNET/24 \
  --uaa-model=standalone-uaa/source/uaa-core/src/main/resources/sysmodel/uaa.json \
  --uaa-schema-mode=standalone-tables \
  --scenario=two-center --model-version=816 \
  --retain-owned-sql-fixture
node scripts/provision-run-owned-native-application-accounts.mjs \
  --provision-owned-application-accounts --run-id=OWNED_RUN_ID --label=OWNED_LABEL
node scripts/tests/run-owned-native-nonadmin-fixture.sql.mjs \
  --cleanup-owned-run=OWNED_RUN_ID
```

Repeat in a fresh run with `--scenario=same-center`. Version `816` is an
explicit fixture mapping, not a claim of provider-version compatibility.
Private credentials and SQL files must not be printed or copied into public
reports. Retention is only for the interval between these explicit stages.

## Remaining Gates

The subsequent `OWNED-UAA-BACKEND-INTEGRATION-20261103.md` checkpoint connects
the real TokenStore witness and explicit application-account receipt to the
fresh UAA startup. Sixteen actual checks pass on the new short-TTL fixture.
This supersedes the earlier missing-witness prerequisite, not the remaining
backend permission, persistence or source-closure gates.

Then exercise the exact allinone/gateway/provider candidates with their owned
registry and required service dependencies. The existing configuration boundary
still lists incomplete EBSX schema, UNISTATE/ZooKeeper, UAA alias discovery and
service OAuth credentials as unverified prerequisites. The newest actual
allinone attempt stops at UNISTATE's missing ZooKeeper address after repairing
owned Nacos/JVM startup prerequisites. A database-only pass
does not clear any of them.

Run the real ordinary-user/cross-library HTTP matrix, fresh-session CRUD,
backend restart readback and native editor workflows before planning cutover.
The current database storage is tmpfs; database-container recreation durability
is deliberately not claimed. All native/release acceptance flags remain false.
