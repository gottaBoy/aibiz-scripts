# Run-Owned MGQ6RI UAA Independent Preflight

Date: 2026-10-06

Scope: read-only fixture/schema/protocol review for run `35f401494e9d`.
Main owns UAA/Redis deployment and `harness-run-owned-uaa-runtime.mjs`.
This review neither modifies existing schemas/accounts nor proves native
permissions, exact original source, global source closure, or release readiness.

The observations below preserve the pre-supplement failure evidence.
A separately authorized schema-only supplement later completed, without
rewriting the historical fixture/SQL receipts. Current schema/receipt and v2
permission transport details are in
`RUN-OWNED-UAA-PROVIDER-SCHEMA-AND-PRIVATE-TRANSPORT-20261006.md`.

## Bound SQL Observation

Command:

```sh
node scripts/audit-run-owned-native-fixture-preflight.mjs \
  --run-id=35f401494e9d \
  --account-label=20261006-integration-r1 \
  --label=20261006-mgq6ri-r2
```

Recorded receipt, observed at `2026-10-06T13:46:01.719Z`:

```text
.artifacts/native-nonadmin-fixtures/35f401494e9d/independent-preflight-20261006-mgq6ri-r2/report.json
sha256 0f4c67cde94bc448cd0e1bace0661288cc940221c6522d7570273e45adb6f291
status blocked-native-login-schema
exit 2
```

All four current SQL checks passed: six identity/ordinary-role joins, two
physical-root bindings, exact UAA application grants/password authentication,
and exact metadata application grants/password authentication. The receipt
keeps all native/permission/source-native acceptance flags false.

The inspected topology still had only `nf-35f401494e9d-mysql` on
`nf-35f401494e9d-private`; MySQL was `172.28.0.2:3306`, unpublished.
The four schemas, roots, immutable resource IDs, and private credential paths
remain in `RUN-OWNED-NATIVE-NONADMIN-CURRENT-HANDOFF-20261006.md`.
This is two physical model schemas in one MySQL server, not two servers.
Storage is tmpfs; no durable restart claim is justified.

## Source And Schema Evidence

All following source paths are relative to:

```text
.artifacts/standalone-uaa-editable-20261006-E1/build-MGQ6RI/source
```

The source is the MGQ6RI editable reconstructed candidate, not independently
proven original source. The receipt binds each inspected source file by hash.
Its structured model is `uaa-core/src/main/resources/sysmodel/uaa.json`,
SHA256 `ba798505b6b000522a82f050c407f864cf7afcd6cc4449407b334311d60bd029`.

The model contains 38 entities, 18 explicit table mappings, and 20 entities
with an empty table mapping. Empty mappings are reported as unmapped; no table
is invented for them. Current UAA schema contains 17 tables/views. Ten mapped
tables/views exist with every modeled `physical_field=1` column present.
Eight mapped tables are absent:

| Missing Table | Narrow Consequence |
| --- | --- |
| `open_access_provider` | Source-proven local-password authentication prerequisite; not yet reproduced by an HTTP login |
| `oauth_access_token` | Required by L1 JDBC token storage; explicit L2/owned Redis avoids this storage path |
| `oauth_refresh_token` | Same L1/L2 distinction; refresh/logout behavior still needs actual tests |
| `oauth_client_details` | Conditional client lookup; predefined `ibzuaa` bypasses this SQL lookup |
| `logging_event` | Audit persistence gap; its missing-table check is caught, not proven mandatory login failure |
| `open_access` | External/open-auth functionality is not covered by the bounded fixture |
| `open_access_auth` | Same external/open-auth scope boundary |
| `test` | Modeled entity absent; not proven required for scoped local-password login |

Presence inventory is not a complete schema compatibility proof. It does not
verify SQL types, constraints, indexes, view writability, all mapper queries,
or runtime bean behavior. The missing tables above are not all classified as
unconditional login blockers.

## Exact Local-Login Dependency

`uaa-api/src/main/java/cn/ibizlab/config/BootSecurityConfig.java:53` registers
API and LDAP authentication providers before the DAO provider.
`uaa-user/src/main/java/cn/ibizlab/core/authentication/provider/ServiceApiAuthenticationProvider.java:67`
calls `authProviderService.first("api")` in `supports()`.
The LDAP equivalent is `provider/LdapAuthenticationProvider.java:96`.
`authentication/service/impl/AuthProviderServiceImpl.java:45` calls cached
`all()`; line 28 executes `this.list()`. Cold Redis cannot remove that SQL
dependency. `uaa-core/.../domain/AuthProvider.java:24` explicitly maps
`OPEN_ACCESS_PROVIDER`; `mapper/authentication/AuthProvider/AuthProviderMapper.xml:45`
confirms it.

The model supplies all 16 expected physical fields for a separately reviewed
schema extension: `id`, `name`, `dc`, `authentication_uri`,
`authentication_method`, `base_config`, `response_type`,
`response_success_flag`, `response_config`, `sort`, `authentication_type`,
`create_time`, `creator`, `update_time`, `updater`, `disabled`.
An empty correctly shaped table should allow provider discovery to return no
API/LDAP provider and proceed to DAO authentication. That remains a
source-derived expectation until actual login testing succeeds.

No schema extension was executed by this audit. Do not silently alter the
frozen fixture or promote its earlier SQL receipt to native readiness. Stage
and authorize a separately versioned schema extension or a new isolated run;
bind schema bytes and resulting inventory before attaching application peers.

## Config And Boot Gaps

`oauth2/config/OAuth2TokenAdapter.java:56` selects predefined `ibzuaa`.
`oauth2/service/impl/OauthClientDetailsServiceImpl.java:39-47` distinguishes
that predefined client from deployment lookup and SQL fallback.
`oauth2/config/OAuth2AuthorizationServerConfig.java:50,71` defaults to L1,
but explicitly configured L2 uses Redis instead of JDBC token tables.

Main's reviewed `runtimeConfiguration()` selects SM3 storage, no password
encryption, L2/owned Redis, and a 64-character ASCII private signing secret.
It disables schema sync, Liquibase, external discovery/config and RT2 import.
Those are configuration inputs, not proof of startup, token trust, refresh,
logout, or successful login. Do not disclose the secret or passwords.

Bare-login top-level `dc` may fall back to the first domain:
`authentication/service/impl/AuthLoginServiceImpl.java:193-196,370-378`.
Identity acceptance must check actual returned `user.id`/`user.dc` and
`/auths/user-info/self`, not top-level `dc` alone. The fixture's six bare
login names are globally unique. Direct UAA tests send their exact center.
All users have `ADMINMODE=0` and `ROLE_NATIVE_FIXTURE`; editor model grants
are `ACCMODE=3`, viewer grants `ACCMODE=1`, no-access users have no model grant.
`sys_role_member.MEMBER_UID` joins person `ID`, not login `UID`.

Main's r2/r3 probes did not reach authentication: r2 failed on null inspected
Ports; r3 failed private-IP/IPAM validation. The observed r4 receipt is:

```text
.artifacts/native-nonadmin-fixtures/35f401494e9d/uaa-runtime-20261006-boot-r4/report.json
sha256 6c04df0d8e3f9372c7718532f1d9073ca03dd0cc890bb110869c92c8328548d5
status failed; checks empty; actualHttpLoginVerified false
```

Its private log `fb852b3465d2.private.log:1-4` reports failure creating
`/opt/uaa/logs/uaa-api.2026-10-06.0.log` during Logback initialization.
`uaa-api/src/main/resources/logback-spring.xml:3,20-23,38` sets a relative
`logs` directory and file appender. Main's non-root/read-only candidate needs
an explicitly run-owned writable logs tmpfs (with correct UID/GID and mode)
or an explicitly bound console-only logging config. This is an actual boot
failure distinct from the unexercised provider-table prerequisite.

## Original Transport Coordination

Main's probe selects a private HTTP origin from exact inspected
container/network/endpoint/private IPv4/IPAM with no arbitrary URL fallback.
That transport is narrow to the UAA probe.
`scripts/run-owned-native-permission-http.mjs:54-70` still accepts only an
exact inspected `127.0.0.1` Docker publication. Requested HostConfig bindings
are insufficient when NetworkSettings reports null/unpublished Ports.
Do not feed the probe's private IP into the permission runner.

Before native matrix integration, coordinate an explicitly versioned
permission transport contract: preserve the inspected-loopback path, and if
private IPv4 is authorized require exact container/image/run/network/endpoint
and IPAM checks with no generic URL option. Include null publication, stale
endpoint/IP, foreign peer/network, gateway/broadcast and redirect rejection
tests. Existing exact peer/mount/image guards and 403/non-mutation checks must
remain. No transport or production Java change was made in this review.

The later separately scoped permission runner v2 adds explicit inspected
private IPv4 transport with container/network/EndpointID/IPAM pins; v1 still
does not fall back. Its focused tests are not a native HTTP receipt. Main
continues to own UAA runtime harness and canonical startup changes.

## Bounded Acceptance Order

1. Main fixes and reruns isolated UAA startup; retain the real failed r4 receipt.
2. Coordinate a separately bound provider-schema extension/new run; rerun the
   read-only joins/grants/schema audit with a fresh output label.
3. Verify all six real UAA login/self identities and wrong-password/wrong-center
   rejection. No admin, reserved-role, mocked UAA or shared-service substitute.
4. Agree the permission endpoint transport and exact deployment-input receipt.
5. Execute actual read/deny cases, then opt-in case-owned CRUD/fresh-login
   persistence; compare every module/system column in both physical schemas.
6. Keep 84 generated invalid-root cases unaccepted until their real AppContext
   binding is proven. Holder/session frames, grant expiry/remaps, other center
   topology and durable restart are still separate required evidence.

Strict authenticated denial means HTTP 403, no transport/parser error, no
sentinel disclosure, and identical before/after snapshots in both databases.
401/404/500, an empty 200, generated matrix JSON, or successful SQL joins do
not prove native denial. None of these observations promotes global gates.
