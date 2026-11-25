# A04 Native API Client

Date: 2026-11-25, Asia/Singapore.
Current-version follow-up continued in the same agent session on 2026-11-26.

## Manual Requirements

API-client authentication is an independent security capability. A human
password grant or a person assigned `ROLE_APIUSERS` is not proof of a
client-credentials flow. Evidence must bind the actual client, credentials,
grant, token principal, wrong-credential refusal, revocation and exact cleanup.
Native standalone UAA and the Cloud UAA proxy chain are separate contracts.

## Local Implementation Observations

The inspected standalone UAA sources expose these native management operations:

| Operation | Native Endpoint | Guard |
| --- | --- | --- |
| Create | `POST /oauth_client_details` | `ROLE_SUPERADMIN` or `uaa-OauthClientDetails-Create-all` |
| Read | `GET /oauth_client_details/{clientId}` | `ROLE_SUPERADMIN` or `uaa-OauthClientDetails-Get-all` |
| Remove | `DELETE /oauth_client_details/{clientId}` | `ROLE_SUPERADMIN` or `uaa-OauthClientDetails-Remove-all` |
| Exact fetch | `POST /oauth_client_details/fetchdefault` | `ROLE_SUPERADMIN` or `uaa-OauthClientDetails-FetchDefault-all` |

The client DTO supports `client_id`, `client_name`, `client_secret`, `scope`,
`authorized_grant_types`, `authorities`, and `access_token_validity`.
The client model has no enabled/logical-delete property, and native deletion
is physical. Exact Get, CheckKey and FetchDefault therefore do not exclude a
disabled-client tombstone. The loader gives a matching deployed-system ID
precedence over a client row, so the runner also checks that exact ID is absent
from `sys_deploy_systems`.

These preflights cover the exact native client key in the currently selected
UAA datasource. They do not establish absence in every dynamically routed
tenant/realm datasource. The original receipts' `allRealmsByClientId` field
was too broad; those receipts remain unchanged. The current runner records
`nativeCurrentDatasourceExactClientKey=true` and `allRealmsVerified=false`.

`provision-native-api-client.mjs` generates one random client namespace and
secret per run. It uses a normal existing administrator login and verifies the
native management authority. The new principal is nonhuman; its only grant is
`client_credentials`, scope is the source-supported `all`, authorities are empty,
and token validity is 60 seconds. No human role, existing client, cache policy,
grant implementation or runtime configuration is changed.

The true standalone token flow is `POST /oauth/token` with HTTP Basic client
authentication and a form `grant_type=client_credentials`. Native
`POST /oauth/check_token` verifies the resulting client principal. The runner
does not send an ordinary user's credentials as an OAuth client.

The source `v7/logout` implementation searches tokens under the predefined
`ibzuaa` client and username. That endpoint is not used as evidence that this
separate client was revoked. The runner deletes its own client and then checks
the already issued token and another grant.

The Cloud UAA endpoint `/uaa/oauth/token` separately requires an authenticated
API principal (`apiuser == 1`). This least-authority client has no API authority.
No Cloud client grant or service-delivery claim follows from the standalone
results below.

## Current Version Evidence

The single basic lifecycle run passed on the existing UAA runtime:

| Check | Actual Result |
| --- | --- |
| Exact client Get / CheckKey / FetchDefault | 404 / 0 / 0 rows |
| Same ID deployed-system collision | 404 |
| Native client Create and independent Get | 200 / 200 |
| Native readback | Exact ID/name, only `client_credentials`, scope `all`, no authorities, TTL 60 |
| Correct Basic credentials | 200; client principal matched; `expires_in=59`; no refresh token |
| Deliberately wrong Basic secret | 401; no token |
| Token introspection before deletion | 200; `active=true`; exact client ID; client-only principal |
| Native Remove / independent Get / exact fetch | 200 / 404 / 0 rows |
| Old token introspection after client deletion | 401 |
| New grant using the retired client credentials | 401 |

The whole run took 696 milliseconds, shorter than the returned 59-second token
lifetime. The immediate post-delete rejection in this receipt therefore cannot
be explained by natural expiration. The original receipt remains unchanged.

Private receipt:
`.artifacts/native-api-client-20261125-r1/report.private.json`,
status `PASS_NATIVE_CLIENT_CREATED_VERIFIED_AND_REVOKED`, SHA-256:
`7f40660ede5a975cb3a6319066a00f0d5a02457cd448f53dff2456dbc4196ba1`.

The current generic runner additionally records monotonic start/end times for
every request, the grant and native deletion. A revocation result passes only
when the old-token check completes before the conservative boundary
`grant request start + (expires_in - 1) seconds`. A slow check at or after that
boundary is `CLIENT_REMOVED_REVOCATION_TIMING_UNVERIFIED`, even if it returns
401. The regression test exercises that negative case.

All raw token values and Basic headers remain memory-only. The generated client
secret is only in a separate mode-600 private file under `.artifacts/`; it is
retired after deletion. Reports store request/response hashes and safe metadata,
not credentials or tokens. The UAA container retained its ID, image, input
configuration, start time, restart count and mounts. There were no SQL requests,
container lifecycle operations, human role changes, commits or pushes.

The separate natural-expiry run also passed:

| Check | Actual Result |
| --- | --- |
| First grant / first token check | 200 / 200; returned lifetime 59 seconds |
| Natural wait | Three requested 20-second segments and one approximately 0.95-second segment |
| Expired first token check | 400 |
| Reauthorization for the same still-existing client | 200; a different token |
| Renewed token check | 200 |
| Client deletion / independent Get / exact fetch | 200 / 404 / 0 rows |
| Renewed token check immediately after deletion | 401 |
| Grant after client deletion | 401 |

The renewed grant started at monotonic 61,547 ms and the post-delete token
check completed at 61,776 ms, approximately 229 ms later. Its conservative
expiry boundary was 119,547 ms. The final 401 is therefore immediate
revocation evidence rather than the natural-expiry check.

Private independent receipt:
`.artifacts/native-api-client-expiry-20261125-r1/report.private.json`,
status `PASS_NATIVE_CLIENT_EXPIRY_RECOVERY_AND_REVOCATION`, SHA-256:
`4dab8c4119fe5a53c819eb4d0748af19a377605de4a0515b26af61b20a6dfba2`.
It used one client for that distinct expiry purpose, retained no client row,
and left the UAA runtime unchanged.

The original expiry receipt checked the first token's actual empty role
collections and bound its client configuration before the run. Its renewal
branch verified client ID, lifetime, absence of refresh token and successful
introspection, but reported empty renewal authorities without independently
checking the renewed role collections. That historical limit remains explicit.
The current runner now applies one shared native-token validator to both
first and renewed grants, checks the complete native client configuration
again before deletion, and refuses any final verdict containing a recorded
failure or cleanup failure. New negative tests cover unexpected role bindings
and refresh tokens. Those code fixes were accepted only after the frozen final
validation below, rather than inferred from an earlier run.

The earlier live receipts did not retain a complete executed-source snapshot.
Their self-reported script digest is not acceptance evidence for subsequent
runner changes. The final runner now writes
`executed-provisioner.private.mjs` plus private mode-600 snapshots for every
`sourceBindings` entry, including its direct/transitive local helper imports and
the test script. It verifies every live source and snapshot before and after
requests, records final per-file comparison hashes, and records the test-script
digest. The source snapshots remain under `.artifacts/` and are not committed.
The reviewed, frozen version was then executed once for final validation:

| Final Binding | Verified Value |
| --- | --- |
| Runner SHA-256 | `d64e33ac8a6166076f168f290b7305433bd686dfde062d278747fa9d22dd847c` |
| Test-script SHA-256 | `9e1db1351bfb37b6709ed15c510cdad29ff17b38c2ae14e484cddc2b8deb184f` |
| Complete source snapshots | 14; every file mode 0600; all current/snapshot hashes matched before and after |
| Executed provisioner snapshot | Mode 0600; hash matched the frozen runner |
| Initial and renewed introspection | Both exact client ID and client-only, with no human `user_name` |
| Natural expiration / same-client recovery | Expired token 400; new grant and new-token check 200 |
| Final exact cleanup | Client Delete 200; independent Get 404; exact FetchDefault 0 rows |
| Immediate revocation | Renewed token 401; another grant 401 |

The final renewed grant started at monotonic 61,596 ms; its post-delete token
check completed at 61,830 ms, approximately 233 ms later and before the
119,596 ms conservative expiry boundary. The UAA runtime remained unchanged.
The single client created for final validation was removed.

Current-version private receipt:
`.artifacts/native-api-client-final-validation-20261126-r1/report.private.json`,
status `PASS_NATIVE_CLIENT_EXPIRY_RECOVERY_AND_REVOCATION`, SHA-256:
`0490939251963f61f624283960d718a7acf1480b5e695c5010f30ad58bb0b323`.
Six focused tests passed before the freeze. Neither the runner nor its test or
helper sources changed during the run. Earlier receipts remain historical and
were not rewritten.

## Pending Decisions / Blockers

This receipt covers one existing standalone UAA instance and a nonce client
with no API authorities. It does not close the complete A04 item or prove
Cloud UAA/LB propagation, multi-node invalidation, privileged service scopes,
secret rotation, or downstream log/service delivery.

The independent `--verify-expiry` mode uses a separately named single client to
test natural expiration and reauthorization. It waits in requested segments of
at most 20 seconds, records each stage, rejects the expired token, obtains and
checks a new token for that same client, then removes the client and checks
immediate revocation before the renewed token's conservative expiry boundary.
Its runtime evidence is recorded separately from the basic lifecycle. The
focused test file passes six cases, including rejection of a revocation check
that runs beyond the conservative expiry boundary.
