# A01 Native Root HTTP Runner

Date: 2026-11-14, Asia/Singapore.

## Current Status

Implemented a bounded native HTTP runner, not a completed A01 runtime receipt.
No containers/services were created, started, restarted or inspected for live
acceptance in this change. No HTTP or SQL was sent to a deployed application.
Historical fixtures, including `25dd6a7232c7/config-r6`, were retired on
November 13; historical reports are not current deployment readiness.

The new execution entry is `run-owned-a01-root-http.mjs`.
`harness-authorization-a01-readiness.mjs` now binds that consuming runner and
reports `partial-runner-implemented-awaiting-fresh-owned-http`. It no longer
reads config-r6 artifacts to claim a live target.

The old `run-owned-native-permission-http.mjs` remains unchanged. Its original
role/root runner is not relabeled as malformed-root coverage. The new A01 CLI
is the explicit replacement entry for the A01 logical cases.

## Source-Bound Transport

The native transport is not an arbitrary application-context header:

1. `MethodHandlerBase.pfetch/ppost` receive `pkey` as a `String` path variable.
2. Central `DEServiceAPIRuntime` places that parent key into the current user's
   application context under the major entity name before access checking.
3. `PSModelDEAccessManager` reads `PSDEVSLNSYS`, requires a valid string, looks
   up that exact root's authorization and only then rewrites the logical
   system field.
4. The source ModelAPI relationship publishes module `Get` as GET/READ,
   `FetchCurSys` as POST/READ and `Update` as PUT/UPDATE.

The execution wrapper binds these four Java source files to the selected
source-built package receipt and requires maintained source hashes to match
the deployed package. It also requires the actual provider read-only
`/app/model` bind to select this deployment's staged `model-input`, and binds
its native ModelAPI bytes and methods to the reviewed source.

Only the following logical cases have a faithful parent-path representation:

| Logical kind | Actual transport | Six actors x READ/UPDATE |
| --- | --- | --- |
| whitespace | Original root plus a trailing space, encoded once as `%20` | 12 |
| system-id-as-root | The fixture logical system ID in the root path | 12 |
| unknown-root | The fixture-owned unknown-root identifier | 12 |

The original matrix has 84 invalid-root cases. The runner consumes that actual
`invalidRootCases` array; 36 are eligible for real HTTP dispatch.

The remaining 48 cases are **blocked-native-transport**, not passed or denied:
absent, empty, JSON null and numeric-zero application-context values. A
required String path cannot represent these faithfully. The strings `"null"`
or `"0"`, a double slash, a different unexported route and a fabricated
`PSDEVSLNSYS`/`srfappcontext` header are not substitutes.

Typed-root Java service tests remain a separate evidence lane. After explicit
root approval, one isolated compiler replay built current source and ran the
four focused suites described below. It did not reuse old `target` or Surefire
outputs. That service-layer evidence does not make the 48 unrepresentable
logical cases into HTTP acceptance. The earlier Java/JavaScript API drafts
remain design-only and are not imported by this HTTP runner.

## Controls And Acceptance

The runner performs normal UAA login/self, backend login/self and appdata
bootstrap for all six ordinary actors. It only sends the original bearer
token and the verified `srfsystemid`/`srforgid` context. Native 20-second
`iat`/`exp` lifetime is required; near-expiry tokens renew by normal login and
bootstrap, never by editing claims, changing expiry or inserting a cache entry.

Besides the 36 invalid-root requests, 16 controls are required:

- Four own-root editor/viewer reads must return the original nonempty physical
  module sentinel.
- Eight foreign-root/no-access reads must return authenticated HTTP 403.
- Two anonymous root reads before and two after authenticated traffic must
  return HTTP 401.

Invalid-root HTTP 403 is recorded as `authorization-denied`; explicit HTTP
400/422 is recorded separately as `input-rejected`, not permission proof.
HTTP 401, 404, 429, 5xx, redirects, empty successful controls, malformed JSON,
transport errors and client-side pre-dispatch rejection cannot pass.
In particular, if the real native runtime currently maps invalid roots to
500, execution must fail and retain that finding; this runner does not weaken
the expected status to obtain a green result.

The wrapper inventories every physical table and every column in both model
schemas, including empty tables. Snapshots retain every value as null or
binary-cast hex. Every authentication/model/control request has before/after
snapshots; schema inventory and all table rows must remain identical. Both
fixture module/system sentinel identities are checked before HTTP. Versions
may have advanced in earlier owned native work, but every current read/denied
request must leave the captured version unchanged.

Denied UPDATE attempts require an additional explicit opt-in. They submit the
original sentinel values through the published PUT path, not arbitrary test
data or SQL. A permission defect that allows the PUT can still change audit
or model-version fields; any such side effect fails the snapshot check. The
runner does not SQL-reset or silently repair unauthorized writes.

Even when all representable cases and controls pass, the final status is
`passed-bounded-native-string-roots-partial-a01`:

- `boundedRepresentableRootAcceptance: true`
- `fullA01Acceptance: false`
- `typedRootHTTPAcceptance: false`
- `nativeAcceptance: false`
- `permissionAcceptance: false`

A02 same-token invalidation and A03 nested-session lifecycle are not closed by
this work.

## Execution Handoff

Root must coordinate one fresh, explicitly owned stack and give its run ID and
current `deployment-input.private.json`. The runner performs fresh strict
Docker/network/image/configuration guards; a missing or retired peer cannot
fall back to shared ports, an old receipt, a caller-supplied URL or another
fixture. It has no lifecycle operation or environment-creation mode.

After review, invoke from the workspace root:

```sh
node scripts/run-owned-a01-root-http.mjs \
  --execute-owned-a01 \
  --allow-owned-denied-updates \
  --run-id=FRESH_12_HEX_RUN_ID \
  --deployment-input=.artifacts/native-nonadmin-fixtures/FRESH_12_HEX_RUN_ID/backend-runtime-LABEL/deployment-input.private.json \
  --label=a01-20261114-r1
```

The placeholders deliberately fail input validation until replaced by a real
owned stack. The wrapper writes an exclusive mode-0700 output directory and
mode-0600 private response/full-snapshot files with hashes; it never overwrites
historical artifacts. A failing fresh guard before output creation returns a
failed result without inventing a persisted HTTP receipt.

## Focused Verification

Run only scoped tool tests, which use controlled fetch/identity/snapshot
adapters rather than the deployed application:

```sh
node --test scripts/tests/owned-a01-root-http.test.mjs \
  scripts/tests/run-owned-a01-root-http.test.mjs \
  scripts/tests/authorization-a01-readiness.test.mjs
```

These tests cover actual dispatch counts, blocked typed/null separation,
source/native-method drift, encoded root fidelity, redirect/JSON/size errors,
forbidden transport fields, ordinary/foreign/anonymous controls, short-token
renewal, credential redaction, full-column mutation detection, private output
and refusal of retired peers. Controlled tests are not fresh native HTTP
acceptance.

Current focused invocation: **40 passed, zero failures/skips** including the
three A01 suites and the existing platform HTTP, owned context, private
transport and native matrix suites. `node --check` and `git diff --check`
also passed. No full `npm test` was run.

Source-only readiness artifact:
`.artifacts/authorization-a01-readiness-20261114-v2-r1/report.json`
(SHA-256 `2b23dd5ae7988649dcdbf5840c8b91caa63af98737c9c6831e9092f45c0ac533`).
It explicitly records no live resource inspection and no full A01 acceptance.

## Current Java Replay

One root-approved, nonroot `--rm` compiler helper used the already-local pinned
Maven digest `maven@sha256:42a3ac393abbc64dae6c96703e5ead2e921fe9103371ac58b5b404b0d6a26502`,
actual image ID
`sha256:f0be3f7442b426f4bc8238fcb0fc5545be96d3266511aed07f767fd51b78a09e`.
Inside it, Java/javac reported 17.0.20 and Maven 3.9.16.
There was no pull/build, business service, published port or network access.

Resource limits: 2 CPUs, 3 GiB memory, 512 PIDs, read-only root, all capabilities
dropped, no-new-privileges and at most 1 GiB temporary storage. Current source
was rsynced to a fresh private snapshot/worktree excluding `.git`, `.artifacts`,
all `target` directories and the three generated deployment JARs. Snapshot and
dependency repository were mounted read-only; only the fresh worktree and
temporary storage were writable. Maven ran offline with `-pl
libs/ibiz-modeling-core -am test` and the exact four-suite selection.

| Current-source suite | Tests | Failures/errors/skips |
| --- | --- | --- |
| `PSModelDEAccessManagerTest` | 14 | 0/0/0 |
| `SystemAccessManagerRequestCacheTest` | 12 | 0/0/0 |
| `SystemAccessManagerEditorRegistryTest` | 11 | 0/0/0 |
| `ModelSysUtilRTAddinAuthorizationTest` | 10 | 0/0/0 |

Total: **47/47**. Fresh Surefire XML was parsed using the existing strict XML
parser. Source before/after, immutable snapshot and compiled worktree inputs
matched; the dependency repository fingerprint and image identity also
matched. The exact helper was confirmed absent after `--rm`. Existing
duplicate-dependency POM warnings remain recorded in the private log; they
were not edited as part of A01.

Receipt: `.artifacts/authorization-a01-java-20261114-r1/report.json`
(SHA-256 `bd33ca24a295c08417dd3c25d990d8ffa8855f64a020ca9579c9cd658491ff71`).
The report says `passed-current-source-focused-java-only`, not native HTTP or
full A01 acceptance. The original `ibiz-service-hub` source tree was not
modified.
