# Bounded Native Internal Message HTTP Gate

Date: 2026-11-09

## Status

Implemented:

- `scripts/harness-owned-internal-message.mjs`
- `scripts/tests/harness-owned-internal-message.test.mjs`

Focused offline test result: 29 passed, 0 failed, 0 skipped. These are injected
HTTP/SQL security and failure tests, not real packaged-image acceptance.
Offline development did not mutate retained deployments. Isolated owned
runtime execution is recorded separately below.

The existing source-only authorization receipt remains:
`.artifacts/internal-message-authorization-20261109-r6/report.json`.
The module source fix and this harness require a newly source-bound image and
a reviewed current owned deployment before real execution.

## Execution Boundary

The CLI requires all four explicit inputs:

```sh
node scripts/harness-owned-internal-message.mjs \
  --execute-owned \
  --run-id "$RUN_ID" \
  --deployment-input "$CURRENT_OWNED_DEPLOYMENT_INPUT" \
  --label notification-security-r1
```

Do not use the known vulnerable old allinone image. It must fail the first
cross-actor key read; a successful route or an empty fetch is not authorization
evidence. Do not rerun an output label. Outputs are created exclusively under
the run's `internal-message-http-<label>` directory.

`ownedNativeRuntimeContext` binds the current manifest, private resources,
private credentials, deployment input and image receipt. Its topology/input
guard runs before every HTTP and SQL operation. The harness does not change
Nacos, routes, UAA TTL, images, containers, grants or schemas.

The backend adapter only permits normal login, appdata, userinfo and native
gateway `/extension/internal_messages` routes. It never tries direct
`/extension/api/internal_messages`, alternate APIs or a shared service.
Redirects, invalid JSON and oversized streamed bodies fail closed.

## Actual Identity And Physical Evidence

Read-only SQL verifies all six actual accounts against UAA person, domain,
organization, role membership, ordinary role and deployment-system rows, plus
the actual native developer/person/tenant and ADMINMODE=0 metadata joins.
Source organization IDs are read, not synthesized from a naming convention.

Every normal backend login is followed by actual appdata validation of system,
logical deployment system, organization, user, person and tenant against those
source rows. Both tenants must use `ibizmodeling` as `srfdcsystemid`; generated
tenant deployment IDs are not message system tags.

Tokens retain their original approximately 20-second TTL. Sessions renew via
normal `/v7/login` at eight seconds or earlier as expiration approaches. The
adapter checks immediately before dispatch that session age is below ten
seconds and at least five seconds of token lifetime remains.

Physical `INTERNAL_MESSAGE` must initially have zero rows. Each snapshot reads
the current complete column list and every row ordered by ID, with no LIMIT or
actor filter. Native MySQL column spelling is retained in `physicalColumns`;
JSON keys and `columns` use canonical uppercase native field names. Lowercase
or mixed-case columns are supported, but case-fold collisions and unsafe
identifiers are refused. Every snapshot and non-login response body is private evidence.
Login response bodies and credentials are not copied into HTTP receipts.
Private records are written exclusively and fsynced before native writes.

## Verified Sequence

1. Each of the six ordinary accounts native-creates one fresh UUID received
   personal message to itself. Sender, receiver, system tag and owner come
   from its verified actual context. A unique run/label/UUID/person content
   marker enables ownership-safe cleanup.
2. Before positive owner tests, execute 120 foreign-key requests: six actors
   times five foreign targets times GET, PUT, DELETE and mark_read. Each must
   return actual HTTP 403 without exposing message title/content. Every
   column of all six physical rows must remain identical after each attempt.
   This includes 48 same-tenant and 72 cross-tenant denials.
3. For each owner, verify GET, title/short-content PUT, native receiver fetch,
   mark_read, persisted READ, unread-filter exclusion, native PUT to RECEIVED,
   fresh normal login, unread fetch and key readback.
4. For each actor, POST mark_all_read with the native client's `{}` JSON body,
   while all five foreign control rows
   remain RECEIVED. Only that actor's STATUS can change. Fresh login, READ
   readback and empty unread fetch must agree, then the owner resets its own
   status to RECEIVED for the next actor's isolation test.
5. Each owner native-deletes its UUID. All remaining physical rows must be
   unchanged after every delete, and the full table must return to zero rows.

The successful injected run has 120 negative requests and 84 owner semantic
checks, with 246 HTTP dispatches when proactive extra renewals are unnecessary.
Real reports count actual dispatched requests and actual attempted/passed
matrix cells. They do not unconditionally advertise a "full 144" suite.

## Failure And Cleanup

Every mutation, including denied mutation probes and native finally cleanup,
has a private intent record written before dispatch. A Create intent is
registered before dispatch so an ambiguous timeout can still be inspected.

Failure evidence is retained before cleanup. Finally cleanup checks only the
journalled Create UUIDs, and requires unchanged sender, receiver, system,
PERSONAL owner, owner ID and the exact run marker. Ownership or marker drift
refuses deletion. Cleanup uses normal login and the owner's native DELETE;
there is no SQL mutation or fallback deletion API. A guard failure or native
cleanup denial remains blocked evidence and cannot earn acceptance.

The public `report.json` includes actual statuses, response hashes, private
evidence bindings, negative matrix, owner checks, cleanup and baseline
restoration. Only a fully completed sequence with restored zero-row baseline
sets `boundedInternalMessageAcceptance=true`. General `nativeAcceptance`,
`permissionAcceptance`, composer and background delivery remain false and
must pass their own independent gates.

## Offline Regression

```sh
node --test scripts/tests/harness-owned-internal-message.test.mjs
```

Coverage includes the full fake sequence; actual source/appdata mismatches;
old allow-all behavior; 200/204/302/400/401/404/500/503 false denials; 403 data
leakage; transport failures; hidden-column mutations; ownership-drift refusal;
ambiguous Create timeout; failed native cleanup; nonzero initial tables;
journal failure; broad mark_all_read; synthetic page objects; topology drift;
exact read-only SQL; route whitelisting; token freshness; redirect refusal;
and streamed response limits.

## Isolated Runtime Attempts

Run: `96ff5681e447`

Deployment:
`.artifacts/native-nonadmin-fixtures/96ff5681e447/backend-runtime-core-backend-r1/deployment-input.private.json`

Source-bound allinone image:
`sha256:5f13de782f3c4df8d83bd9c19bdad44b6c132358d6781c4f3a399a28bd72e93f`

- `internal-message-http-notification-security-r1/report.json`: failed before
  HTTP dispatch or message writes because the original snapshot adapter
  incorrectly required uppercase physical column spelling. The actual native
  table has all 20 model columns in lowercase. This was a harness defect, not
  missing native schema. The account source proof passed. The failed receipt
  is retained.
- `internal-message-http-notification-security-r2/report.json`: 245 dispatched
  HTTP requests, all 120 cross-actor 403 denials passed with all six rows/all
  20 columns unchanged after every attempt. All 54 initial owner checks
  passed. The first mark_all_read returned empty HTTP 200 without changing
  STATUS, so the strict gate failed. Six native owner DELETE cleanup calls
  succeeded and the full physical table returned to zero rows.

Correction to the initial r2 diagnosis: this does not establish a backend
mark_all_read SQL bug. The harness sent no HTTP body, whereas the real native
client explicitly sends `{}` in
`ibiz-app-hub/packages/runtime/src/service/service/internal-message/internal-message.service.ts`.
The action model's business input is NONE, but
`StandardSysServiceAPIRequestMappingAdapter` registers its POST handler through
`MethodHandlerBase.post0(@RequestBody Object requestData)`, requiring a JSON
body. The harness now follows the real client's empty-object contract without
changing any backend source, assertion, gateway route or permission data.
An injected zero-byte/200/no-op regression still fails after 120 denials and
54 owner checks and verifies native cleanup. Earlier receipts are not
overwritten; the corrected real execution uses the fresh r3 label.

- `internal-message-http-notification-security-r3/report.json`:
  **passed-bounded-native-notification-http**. All 120 negative requests
  returned actual 403 responses; all 84 owner semantic checks passed, including
  six mark_all_read isolation cases. Native owner DELETE removed every owned
  message and the full physical table returned to zero rows. This closes the
  bounded F05 route, datasource, message CRUD/read-state and isolation gate.
  Composer and background delivery remain independent and unaccepted.
