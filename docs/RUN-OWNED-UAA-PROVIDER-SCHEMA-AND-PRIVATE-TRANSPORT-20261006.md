# Owned Provider Schema And Inspected Private Transport

Date: 2026-10-06

Scope: run `35f401494e9d` supplemental schema and permission-runner transport
only. No production Java, main standalone-UAA tools, accounts, historical
fixture manifest/SQL receipts, shared databases, services, or execution plan
were modified. No native/source/release gate is promoted.

## Executed Supplemental SQL

This command completed against the already retained owned MySQL:

```sh
node scripts/provision-run-owned-uaa-provider-schema.mjs \
  --execute-owned-schema-only \
  --run-id=35f401494e9d \
  --account-label=20261006-integration-r1 \
  --label=20261006-mgq6ri-r1
```

Do not rerun against the existing table. The tool rejects an existing table
and a reused output directory; it never uses IF NOT EXISTS, alters existing
DDL, seeds providers, or reprovisions users.

Fresh immutable supplemental receipt:

```text
.artifacts/native-nonadmin-fixtures/35f401494e9d/provider-schema-20261006-mgq6ri-r1/report.json
sha256 c1eb26bd63b98b3cdc86f339b2c1656b5bb0c11e24f612fe78f18bd6bd927c2d
status passed-owned-provider-schema-only
started 2026-10-06T14:00:34.243Z
finished 2026-10-06T14:01:42.486Z
checks 6/6
schema-only.sql: 689 bytes
SQL sha256 347b4177c4b9888e87be4d03042274c39a967ff3cf6e2041270041810ebaf207
```

Only `nf_35f401494e9d_uaa.open_access_provider` was created: 16 columns,
ID primary key, no secondary indexes/triggers/foreign keys/business
defaults, and zero rows. SHOW CREATE and every column/row digest of all 43
preexisting entries (37 owned tables/views plus six MySQL grant tables)
were compared. Before/after aggregate hashes are identical:

```text
54e22b7fbb80e26201adfbf4037661485df4d48772a848414014907ea9eb01cd
```

No plaintext rows, passwords, or grant-table authentication bytes are
exported. Four guard observations required exact retained container/network
IDs, pinned image, sole network peer, unpublished MySQL, exact tmpfs,
MySQL 5.7, lower_case_table_names=1, and zero other client connections
(including sleeping clients). Single-writer coordination is required;
these checks are not a general concurrent database lock. Nontransactional
DDL intent/attempt/executed journals are retained; failure never triggers
an implicit drop.

## Source Pins And Type Boundary

Source root:

```text
.artifacts/standalone-uaa-editable-20261006-E1/build-MGQ6RI/source
```

All three files are hard-pinned before DDL:

| Source File Relative To Root | SHA256 |
| --- | --- |
| `uaa-core/src/main/resources/sysmodel/uaa.json` | `ba798505b6b000522a82f050c407f864cf7afcd6cc4449407b334311d60bd029` |
| `uaa-core/src/main/java/cn/ibizlab/core/authentication/domain/AuthProvider.java` | `f43eeb2a65bc48f02899f91e2266dc2e418820a0f9be92520cc974843b8f3899` |
| `uaa-core/src/main/resources/mapper/authentication/AuthProvider/AuthProviderMapper.xml` | `0648146d62cc8753b024c57c4e757c677e575766dcc436713b35419a5d2c497b` |

Each receipt column includes source entity/field/data type/field
type/length/nullability/key flag:

| Source Field | MySQL Type | Nullability |
| --- | --- | --- |
| `ID` | `VARCHAR(100)` primary key | NOT NULL |
| `NAME`, `DC` | `VARCHAR(100)` | NULL |
| `AUTHENTICATION_URI` | `VARCHAR(1000)` | NULL |
| `AUTHENTICATION_METHOD` | `VARCHAR(60)` | NULL |
| `BASE_CONFIG` | `VARCHAR(2000)` | NULL |
| `RESPONSE_TYPE` | `VARCHAR(60)` | NULL |
| `RESPONSE_SUCCESS_FLAG` | `VARCHAR(100)` | NULL |
| `RESPONSE_CONFIG` | `MEDIUMTEXT` | NULL |
| `SORT` | `INT(11)` | NULL |
| `AUTHENTICATION_TYPE` | `VARCHAR(60)` | NULL |
| `CREATE_TIME`, `UPDATE_TIME` | `DATETIME` | NULL |
| `CREATOR`, `UPDATER` | `VARCHAR(100)` | NULL |
| `DISABLED` | `INT(11)` | NULL |

The source model says RESPONSE_CONFIG data_type=TEXT, field_type=LONGTEXT,
data_length=1048576. MySQL TEXT cannot satisfy that capacity. Explicit
fixture translation is MEDIUMTEXT (16777215-byte capacity), with no invented
SQL 1 MiB limit. InnoDB, utf8mb4_bin and INT(11) are declared dialect choices,
not recovered original DDL. Java's SORT=100 is not copied to a SQL default.

MGQ6RI is reconstructed editable source. Original-source provenance,
original database DDL, license closure, and a future changed model's
compatibility are not established; old receipts are not rewritten.

## Post-Supplement Audit

```sh
node scripts/audit-run-owned-native-fixture-preflight.mjs \
  --run-id=35f401494e9d \
  --account-label=20261006-integration-r1 \
  --label=20261006-provider-supplement-r3
```

```text
.artifacts/native-nonadmin-fixtures/35f401494e9d/independent-preflight-20261006-provider-supplement-r3/report.json
sha256 c0d113abf0f485491a8394e6e1df278e59e9d9d873a3d1d80be5bd353eec2b32
observed 2026-10-06T14:02:36.848Z
status passed-readonly-fixture-only; exit 0
four live identity/root/application-grant checks passed
blockingDependencies []
provider: 16 expected/observed columns, none missing
```

Seven modeled tables remain absent: logging_event, oauth_access_token,
oauth_client_details, oauth_refresh_token, open_access, open_access_auth,
test. They are not all unconditional local-password blockers. Main selects
explicit L2/owned Redis and predefined ibzuaa; JDBC-token/client fallback,
external providers and audit persistence require separate acceptance.

## Permission Transport V2

V1 inspected-loopback remains available without fallback. V2 requires
each endpoint to select loopback-publication or private-inspected-ipv4.
For private mode input must not contain origin; the runner derives it from
live inspect and matches exact expected input values.

Illustrative endpoint fields, not executable resource IDs:

```json
{
  "contract": "run-owned-native-permission-deployment-input-v2",
  "runId": "35f401494e9d",
  "endpoints": {
    "uaa": {
      "transport": "private-inspected-ipv4",
      "service": "uaa",
      "containerPort": 32666,
      "containerId": "actual-64-hex-UAA-container-ID",
      "networkId": "actual-64-hex-owned-network-ID",
      "endpointId": "actual-64-hex-UAA-EndpointID",
      "ipv4": "actual-inspected-private-UAA-IPv4"
    },
    "backend": {
      "transport": "private-inspected-ipv4",
      "service": "gateway",
      "containerPort": 30086,
      "containerId": "actual-64-hex-gateway-container-ID",
      "networkId": "actual-64-hex-owned-network-ID",
      "endpointId": "actual-64-hex-gateway-EndpointID",
      "ipv4": "actual-inspected-private-gateway-IPv4"
    }
  }
}
```

Keep the full v1 imageReceipt/services/auxiliaryContainers fields in the
current handoff; above shows only changed contract/endpoint fields.
Use actual pins from the new deployment, not the completed r6 probe.
Source-image bindings, ownership labels, exact peers, one network, mount
guards, full baseline snapshots and authenticated 403 checks remain.

Both container and network inspect must agree on container/image/network/
EndpointID, peer name, IPv4/prefix/Gateway and one canonical IPAM subnet
wholly within RFC1918. Network/broadcast/gateway cannot be service IPs.
Requested and actual publications are forbidden, including requested
loopback bindings Docker did not publish. No supplied URL/hostname/fallback
is permitted. Reinspection occurs before every matrix observation.

HTTP paths are restricted to auth/login/self, backend login/userinfo and
root-scoped module routes. Queries, fragments, external URLs and encoded
traversal fail before fetch. Redirects are explicit failures and never
forward tokens/passwords. This transport has mocked-inspection/fetch test
evidence only, not an executed private UAA/backend matrix.

## Test Evidence

Seven suites passed: existing fixture/matrix/accounts/HTTP/preflight suites
plus new provider-schema and private-transport suites:

```text
83 passed, 0 failed, 0 skipped
.artifacts/native-nonadmin-fixtures/35f401494e9d/fixture-lane-tests-20261006-schema-private-r1/report.json
sha256 4f6ecad35afcc3c8589092065960a2993e71d196ae71a8248d7ca5b5644add4b
tests.xml sha256 fdf0e7f68dc6a54dc087cb0c032b4e8f68eef1669394ee9b7c78e0666d8ef66b
```

Tests cover pins/fields/type translation, no elevated SQL, connection/
sole-peer guards, invariant row/grant snapshots, existing-table rejection,
failed DDL retention, stale IDs/IPs/endpoints, IPAM/publications, restricted
routes and redirects. Both edited executable tools pass syntax checks.

## Next Integration And Cleanup

Main owns canonical UAA mapping/build/runtime. Latest observed r6 startup
is failed with zero login checks:

```text
.artifacts/native-nonadmin-fixtures/35f401494e9d/uaa-runtime-20261006-boot-r6/report.json
sha256 e13bbd23c1a3d495aa4167d3e7d383f2edb6f815c35adee23315f0d148cc3530
5176ff66be9c.private.log:73-76: duplicate GET/POST /appdata mapping
```

After main's new candidate boots, verify six real nonadmin login/self
identities and wrong-password/wrong-center behavior. Provide exact source
image/peer/endpoint deployment input; run the HTTP matrix, then opt-in
case-owned CRUD/fresh-login persistence. Negative acceptance requires 403,
no sentinel disclosure and unchanged full snapshots in both model schemas.
Source/license, actual invalid-root context, other-center topology and
durable restart remain separate unresolved gates.

No per-table auto-cleanup is provided. Stop/detach only main-owned peers
under main's coordination; whole-run cleanup remains the guarded existing
--cleanup-owned-run=35f401494e9d command. Never reprovision accounts or print
private inputs. MySQL remains the original unpublished owned container/
network with tmpfs data; no durable restart claim is made.
