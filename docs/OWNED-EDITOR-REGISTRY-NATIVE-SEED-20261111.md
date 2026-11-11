# Owned Native Editor Registry Initialization

Date: 2026-11-11

## Status And Boundary

`scripts/seed-owned-editor-registry-native.mjs` and its fake/security tests are
implemented with offline negative tests. An earlier version was exercised
on the new owned fixture and stopped on a system-name assertion; subsequent
experimental continuations are documented in `MODELDESIGN-REGISTRY-20261111.md`.
The final initializer has not passed a fresh complete native run. Shared
services, authorization grants and old fixtures were not changed.

It is a bounded native CREATE initializer, not a SQL seed tool or full
permission/browser acceptance. Its retained private receipt is intended for
the separate 60-cell read-only registry probe. Native REMOVE cleanup remains
a separate explicitly reviewed operation using the returned keys/ownership
evidence; the initializer never issues DELETE or a SQL write.

## Execution Contract

Only after review, an explicit current owned deployment and a fresh label:

```sh
node scripts/seed-owned-editor-registry-native.mjs \
  --execute-owned \
  --run-id "$RUN_ID" \
  --deployment-input "$CURRENT_DEPLOYMENT_INPUT" \
  --label registry-native-r1
```

No implicit run, image, backend URL, actor, payload or SQL target is accepted.
The output is exclusive:
`.artifacts/native-nonadmin-fixtures/<run>/editor-registry-native-seed-<label>/`.
All evidence, mutation intents and `receipt.private.json` are mode 0600 in
pinned private directories and fsynced. No existing evidence is overwritten.

The initializer reuses `ownedNativeRuntimeContext`, verifies the current
deployment/source-image/package bindings, and checks the five explicit model
registrations and deployed registry/access/lifecycle Java source hashes.
Maintained native source must match the actual source-built package. The
vendor model contract is separately bound and is not falsely presented as the
source of the deployed Java runtime.

## Identity And Native Requests

Read-only source SQL verifies all six real UAA/developer identities, their
tenant, organization, ordinary role, system and ADMINMODE=0 mapping. Only the
two actual editors may CREATE, each under its own root.

Normal `/v7/login`, actual appdata and actual backend self identity are
required. The native 20-second JWT lifetime is not changed. Normal login is
renewed at four seconds or earlier; a token aged ten seconds or a
future-dated/expiring client session cannot dispatch. Auth credentials and
returned JWTs are not copied into HTTP evidence.

Before creation, native readonly PSPF, PSPFStyle and PSAppType fetches must
return actual coherent configuration. Application creation requires an active
numeric-validflag platform, matching style/platform and app-type association,
with the style in the actor center or actual shared null-center scope.
No dictionary IDs/names are fabricated or accepted from CLI.

Other entities use source-supported minimum fields and constants from the
frozen `native-five-dataset-contract.mjs`. The request boundary permits exact
own-root collections and reviewed payload fields only; no custom headers,
foreign root, body system, extra service URL, direct backend API, batch,
DELETE or fallback route can be requested.

The native server generates the actual key. The prewrite intent records the
unique run/side/nonce name and marker before dispatch, and the backend-returned
key is subsequently bound to the full physical row. A response key cannot be
a route fragment. Missing/foreign/rewritten marker or name is failure.

## Physical Audit

The complete inventory and every row/every column of all tables in both
physical model schemas are snapshotted through the same source-bound pure
inventory/snapshot helpers used by `probe-owned-editor-registry-http.mjs`.
Values are NULL or exact binary HEX, preserving text/binary data and empty
tables, not a selected projection.

Initially all five editor tables must be empty in both roots. The exact
original module/system sentinels, names, root/instance/center binding and
manifest model version are required. A prior partially initialized or
otherwise mutated baseline is not silently adopted.

Each CREATE requires:

- One new primary entity row in the intended physical database, with the
  returned key, actual payload, null parent where required and unique marker.
- Exactly +1 MODELVER on the owner's one existing system row; every other
  system column remains identical.
- Exactly one source-backed PSSysModelLog row for this entity/system, without
  changing unrelated log rows. Existing matching log rows may only change
  native update timestamp/operator fields.
- Every foreign-root table and every other own-root row/column remains exact.
  There is no blanket exception for audit tables, folders, tasks or cascades.

Any unexpected physical write, missing version/log effect, schema drift or
concurrent mutation stops further CREATEs. Native effects are retained and
audited, never SQL-reset to make a baseline appear restored.

## Receipts And Partial Failure

Successful complete receipt:

```text
contract: owned-editor-registry-native-seed-v1
status: passed-native-create-seeds
deploymentInput: { path, sha256 }
sourceImages: { path, sha256 }
sourceContractSha256: SHA256(pretty-JSON source contract + newline)
records: ten actual native-created rows
```

Each record contains entity, rootId, database, logicalSystemId, actual key,
name, userTag, systemName and `createEvidence: {path,sha256}`. Its private
evidence contains actual POST path/status/error/request/response. It also binds
the prewrite journal and exact observed version/log effects.

Without real application config, four entities may be initialized per root
and retained as eight actual records, with status
`partial-native-create-seeds-app-config-blocked`. Full initialization stays
false; the read-only 60-cell probe must reject that partial receipt by
default. Explicit `--allow-partial` permits only a separately identified
48-cell four-entity result, with full five-entity acceptance flags false.
Config HTTP/schema errors remain recorded, not reclassified as valid config.

A native Create failure, ambiguous timeout, journal/guard failure or physical
mismatch stops all later mutations. Prewrite intents, actual HTTP response,
full snapshots, prior verified rows and failure trace remain private evidence.
The maintained tool has no resume/key-adoption entry point. No retry,
cleanup fallback, extra UUID or new duplicate name is issued after failure.
An ambiguous intent does not become a verified record.

Both native/permission acceptance flags remain false even after ten successful
creates. This receipt proves bounded initialization only.

## Offline Regression

```sh
node --test scripts/tests/seed-owned-editor-registry-native.test.mjs \
  scripts/tests/native-five-dataset-contract.test.mjs
```

Tests cover complete ten-row initialization; eight-row config-blocked results;
real config identity/scope/validity; exclusive source payloads; own-root role
checks; pre-existing rows; synchronous durable prewrite intents; ambiguous
timeout and fail-stop behavior; foreign/hidden table writes; missing logs or
version increments; wrong DTOs; expiry renewal; topology drift; and guarded
HTTP source/context/redirect/JSON failures. They do not execute a real seed.
