# Run-Owned Native Nonadmin Fixture Handoff

Date: 2026-10-06

This document is the current integration handoff for the retained run
`35f401494e9d`. It is an isolated SQL fixture and native-test input package.
It is not a native acceptance receipt, source-closure receipt, or release
approval.

## Owned Resources

The retained MySQL peer is:

```text
container: nf-35f401494e9d-mysql
container id: 27d1be33196674dea409d5a90c326871b352647fc56670c97aa32b54e9ec2994
image: sha256:a086c6276f57c2b8067d0fda21893b7e3e542513cb5997b224cd0538d4970ece
network: nf-35f401494e9d-private
network id: 00ab127c02902b32f3dbd7be47cadd466d96920d1549f84d2f8ad49db3198610
mysql address: nf-35f401494e9d-mysql:3306 / 172.28.0.2:3306
network: internal bridge, 172.28.0.0/16
published mysql ports: none
storage: 1 GiB tmpfs at /var/lib/mysql
```

At the independent inspection at `2026-10-06T13:46:01.719Z`, after the
observed r4 UAA probe cleanup, the network had exactly one peer: MySQL. It is
intentionally not connected to the shared modeling/UAA services. Main-owned
UAA, cache, all-in-one, provider, and gateway containers may be attached only
as declared peers in a run-owned deployment and must use the same network.

The four physical schemas are:

```text
nf_35f401494e9d_uaa
nf_35f401494e9d_meta
nf_35f401494e9d_model_a
nf_35f401494e9d_model_b
```

The model roots are `nf_35f401494e9d_root_a` and
`nf_35f401494e9d_root_b`. They intentionally share the logical system ID but
have distinct center, model-instance, schema, physical system name, and
sentinel tag values. The six identities are two editors, two viewers, and two
no-access users, all `ADMINMODE=0`; no reserved or administrator identity is
part of the fixture.

## Private Inputs

Do not print, copy, or put the following files into a public receipt:

```text
.artifacts/native-nonadmin-fixtures/35f401494e9d/credentials.private.json
.artifacts/native-nonadmin-fixtures/35f401494e9d/application-accounts-20261006-integration-r1/accounts.private.json
.artifacts/native-nonadmin-fixtures/35f401494e9d/application-accounts-20261006-integration-r1/05-application-accounts.private.sql
```

The two JSON files are mode `0600`. The first contains the six user passwords
and the two model JDBC credentials. The second contains the generated UAA and
metadata application credentials and configuration keys. The application
accounts already exist and must not be provisioned again.

The application-account SQL is deliberately narrow:

```text
uaa application account: CRUD on nf_35f401494e9d_uaa only
metadata application account: SELECT on nf_35f401494e9d_meta only
```

The model schemas remain accessed by the fixture's per-root model principals.
Do not use the MySQL root password as an application configuration value.

## Frozen Evidence

```text
fixture manifest:
.artifacts/native-nonadmin-fixtures/35f401494e9d/manifest.json
sha256 0e6aaeeaf1d4a694c9d969f371e9496ae2bb7573da9f00586c8d85472feee0e2

owned resources:
.artifacts/native-nonadmin-fixtures/35f401494e9d/owned-resources.json
sha256 2e817b2a682464e134c266e72a29f96ad12558b0a0d56544b7d7900f76c5f26b

SQL fixture receipt:
.artifacts/native-nonadmin-fixtures/35f401494e9d/isolated-sql-report.json
sha256 d1df84a849e57b978493208857cac7eefb25a2a6776dee6ba073b6b6daead886
status passed-isolated-sql-fixture-only
checks 54/54

application-account receipt:
.artifacts/native-nonadmin-fixtures/35f401494e9d/application-accounts-20261006-integration-r1/report.json
sha256 49448e4f71b06d571693206e40e1c927e237707f803af4bc07eb6ecfb534579b
status passed-owned-application-account-sql-only
checks 32/32

generated native matrix:
.artifacts/native-nonadmin-fixtures/35f401494e9d/native-matrix-20261006-native-ready/matrix.json
status matrix-generated-not-executed
counts authentication=30, role/root=60, invalid-root=84, forged-system=4
```

All existing receipts retain `nativeAcceptance=false`,
`permissionAcceptance=false`, and `sourceNativeAcceptance=false`.

The exact source-built backend image receipt supplied by main is:

```text
.artifacts/backend-source-images-57a21f78-efe8-42b5-aafd-4842e19b5e9f/report.json
sha256 c917bfa49f24efaed1465d206760306460c2ee872b5f16f26643e8dc6214c3f1
status passed-image-artifact-binding-only
sourceClosure false
nativeAcceptance false
```

Its bound image IDs are:

```text
allinone  sha256:4c84774f7a710b3a7173be286119a1c2d3cc050a3fe64ff69ad3a605ca906fb4
gateway   sha256:fb02238abcc8fe7f7fd4271187663f352f6d8fdb187fc4dd58c29a7889d8e0f3
provider  sha256:c682a09cd5ebf02015b9afb8cd150b8ef7d655a78731fc4531cf5795fcf58837
```

## Main-Owned Deployment Input

Main should choose unused loopback host ports and write a private deployment
input JSON. No port is reserved by this fixture. The HTTP runner requires the
following contract:

```json
{
  "contract": "run-owned-native-permission-deployment-input-v1",
  "runId": "35f401494e9d",
  "imageReceipt": {
    "path": "/absolute/path/to/.artifacts/backend-source-images-.../report.json",
    "sha256": "sha256-of-that-report"
  },
  "services": {
    "allinone": {"containerId": "64-hex", "imageId": "sha256:64-hex"},
    "gateway": {"containerId": "64-hex", "imageId": "sha256:64-hex"},
    "provider": {"containerId": "64-hex", "imageId": "sha256:64-hex"},
    "uaa": {"containerId": "64-hex", "imageId": "sha256:64-hex"}
  },
  "auxiliaryContainers": [],
  "endpoints": {
    "uaa": {
      "origin": "http://127.0.0.1:<main-chosen-port>",
      "service": "uaa",
      "containerPort": 32666
    },
    "backend": {
      "origin": "http://127.0.0.1:<main-chosen-port>",
      "service": "gateway",
      "containerPort": 30086
    }
  }
}
```

Redis/Nacos or another token/cache peer must be declared in
`auxiliaryContainers` when actually used. Every declared peer must run the
exact inspected image and ID, carry the run ownership label, attach only to
`nf-35f401494e9d-private`, and publish only loopback host ports. The MySQL
container must remain unpublished. Configuration/model mounts must be staged
under the run directory and mounted read-only; do not mount the whole fixture
directory or its credential-bearing root.

The application configuration must point UAA to the owned UAA schema and
disable shared discovery/config, schema synchronization, and Liquibase. The
UAA must use the private fixture's `sm3` password storage setting. Token/cache
storage is still a deployment decision: use a run-owned Redis peer for L2, or
provide the required OAuth JDBC token tables in the owned UAA schema for L1.
RT2 AppSyncJob must be disabled unless its resource import is separately
owned and proven.

The exact MGQ6RI source has an additional login prerequisite missing from the
original bounded fixture: `OPEN_ACCESS_PROVIDER`. `BootSecurityConfig.java:53` registers
API/LDAP providers ahead of the DAO provider; their `supports()` calls query
this table even for ordinary local-password authentication. Redis does not
resolve this dependency. See the independent protocol audit document
`RUN-OWNED-NATIVE-UAA-MGQ6RI-PREFLIGHT-20261006.md`. A separately authorized
schema-only supplement completed on 2026-10-06, preserving this fixture's
historical manifest/SQL receipt and every existing row/schema/grant. Its
receipt is `provider-schema-20261006-mgq6ri-r1/report.json`, SHA256
`c1eb26bd63b98b3cdc86f339b2c1656b5bb0c11e24f612fe78f18bd6bd927c2d`.
The new 16-column table is empty. Do not reprovision accounts or rerun the
supplement on the existing table.

The original HTTP permission runner contract is inspected-loopback-only. On the internal bridge,
requested HostConfig bindings with null NetworkSettings Ports are not actual
publications and fail that v1 preflight. The new explicit v2 private transport
pins container/network/EndpointID/IPv4, derives origin from live inspect,
checks RFC1918/IPAM and forbids requested/actual publications. It has focused
tests but no real native matrix receipt. Main must provide actual deployment
pins; no fallback or arbitrary origin is allowed. Exact v2 fields and schema
evidence are in
`RUN-OWNED-UAA-PROVIDER-SCHEMA-AND-PRIVATE-TRANSPORT-20261006.md`.

## Service Order

The recommended (not yet startup-verified) isolated deployment order is:

1. Attach/launch the run-owned cache/token peer, if required.
2. Launch UAA with the owned UAA application account and verify its health.
3. Launch all-in-one with run-owned UAA and metadata/model configuration.
4. Launch provider against the owned model roots.
5. Launch gateway with the provider and UAA endpoints.
6. Inspect all containers and write the deployment-input JSON.
7. Run the HTTP matrix runner only after exact IDs, image IDs, ports, labels,
   network membership, and mount policy pass preflight.

Do not connect the shared `32002` provider or other shared services to this
network. The currently observed shared provider is unrelated to this run.

## Native Execution Command

After main writes the private deployment input:

```sh
node scripts/run-owned-native-permission-http.mjs \
  --execute-owned-native-matrix \
  --run-id=35f401494e9d \
  --deployment-input=/absolute/path/to/deployment-input.json \
  --label=integration-r1
```

Mutation coverage is opt-in and changes only case-owned temporary module rows:

```sh
node scripts/run-owned-native-permission-http.mjs \
  --execute-owned-native-matrix \
  --run-id=35f401494e9d \
  --deployment-input=/absolute/path/to/deployment-input.json \
  --label=integration-r1 \
  --allow-owned-probe-mutations
```

The runner authenticates all six users through direct UAA login and backend
fresh login, verifies the person/center/ordinary-role identity, snapshots all
ordered module/system columns in both model schemas before and after every
operation, and requires HTTP `403` plus no physical mutation for authorization
denials. HTTP `401`, `404`, `500`, empty successful responses, transport errors,
or a leaked foreign sentinel are not denial proof.

## Current Verification

The owned fixture and runner tests currently pass:

```text
node --test \
  scripts/tests/run-owned-native-nonadmin-fixture.test.mjs \
  scripts/tests/run-owned-native-nonadmin-matrix.test.mjs \
  scripts/tests/run-owned-native-application-accounts.test.mjs \
  scripts/tests/run-owned-native-permission-http.test.mjs \
  scripts/tests/run-owned-native-fixture-preflight.test.mjs \
  scripts/tests/run-owned-uaa-provider-schema.test.mjs \
  scripts/tests/run-owned-native-permission-private-transport.test.mjs

83 passed, 0 failed, 0 skipped
Receipt: .artifacts/native-nonadmin-fixtures/35f401494e9d/fixture-lane-tests-20261006-schema-private-r1/report.json
sha256 4f6ecad35afcc3c8589092065960a2993e71d196ae71a8248d7ca5b5644add4b
JUnit: same directory/tests.xml
sha256 fdf0e7f68dc6a54dc087cb0c032b4e8f68eef1669394ee9b7c78e0666d8ef66b
node --check scripts/audit-run-owned-native-fixture-preflight.mjs
passed
node --check scripts/run-owned-native-permission-http.mjs
passed
```

The fresh read-only SQL/schema audit is:

```text
.artifacts/native-nonadmin-fixtures/35f401494e9d/independent-preflight-20261006-provider-supplement-r3/report.json
sha256 c0d113abf0f485491a8394e6e1df278e59e9d9d873a3d1d80be5bd353eec2b32
status passed-readonly-fixture-only; exit 0
four live SQL checks passed
38 source entities; 18 explicit table mappings; 7 missing tables
11 existing mapped tables/views have all modeled physical columns
blockingDependencies []; native acceptance remains false
```

No native HTTP matrix has been executed for this retained run. There is no
native HTTP receipt or active native runner session.

## Blockers

1. Main must supply the isolated UAA/backend/provider/all-in-one container IDs,
   approved inspected endpoint transport, and private deployment-input JSON.
2. UAA token/cache isolation and OAuth client configuration are not proven by
   the application-account SQL receipt.
3. Direct UAA `/auths/login` and `/auths/user-info/self` behavior for all six
   users has not been observed against this run.
4. Backend root-context transport must use `PSDEVSLNSYS=<rootId>` through the
   actual request context. Null/blank/numeric/unknown-root variants must not
   be invented without a proven transport path.
5. Actual missing/invalid-root HTTP authorization denial remains unverified.
   This document makes no claim that the latest manager still throws: focused
   Java fix receipts are separate from native deployment observations.
6. The image receipt proves image/artifact binding only. It does not prove
   service startup, source closure, UAA provenance, native permissions, or
   durable restart behavior.
7. Historical r4 boot failed at Logback; latest observed r6 boot failed on
   duplicate `/appdata` controller mappings and ran no login checks. Main
   owns that canonical source/runtime fix. `OPEN_ACCESS_PROVIDER` is now
   schema-only supplemented but remains unexercised over HTTP. See the
   supplemental schema/private-transport document for exact evidence.

## Sole-Peer Lifecycle

Provisioning and cleanup of the two application accounts are permitted only
while the MySQL container is the sole network peer and has no application
connections. After deployment, stop all owned services, detach all peers, and
verify the network contains only `nf-35f401494e9d-mysql` before cleanup:

```sh
node scripts/provision-run-owned-native-application-accounts.mjs \
  --cleanup-owned-application-accounts \
  --run-id=35f401494e9d \
  --label=20261006-integration-r1

node scripts/tests/run-owned-native-nonadmin-fixture.sql.mjs \
  --cleanup-owned-run=35f401494e9d
```

The cleanup commands refuse integration peers and never remove a foreign
container or shared service. The retained MySQL data is tmpfs and has no
durable restart guarantee.
