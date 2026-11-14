# A03 Session Close Failure Cleanup

Date: 2026-11-14. Scope: a minimal production cleanup repair, not nested-session
acceptance.

## Observed Failure

`ActionSessionManager.closeSession(boolean)` previously performed:

1. Read the current thread's `ActionSession`.
2. Call `currentSession.close(commit)`.
3. Set the thread-local session to null.

`ActionSession.close` calls `executeFutureActions`. Commit or rollback
callbacks run synchronously and may throw unchecked exceptions or errors.
When a callback throws, step 3 was skipped. The thread then retained the old
session, including its user/app context, authorization cache parameters and
ignore-check flags. A later request on the same pooled worker could reuse it
because the legacy `openSession` is intentionally idempotent.

## Production Repair

File:

`ibiz-service-hub/libs/ibiz-runtime/src/main/java/net/ibizsys/runtime/util/ActionSessionManager.java`

The current session's close now runs inside `try/finally`. The finally block
calls `ThreadLocal.remove()` only if the thread-local value is still the exact
session that this invocation closed.

State rules:

| State at entry/finally | Result |
| --- | --- |
| No current session | No callback or lifecycle work |
| Close returns, current is still the old object | Remove the old binding |
| Close throws, current is still the old object | Remove the old binding; propagate the same failure |
| Callback has already removed the old binding | Do not recreate or restore it |
| Callback has opened a different current session | Preserve that replacement, on success or failure |

The old session stays bound while callbacks run. Their existing access to
user/app context and transaction flags therefore remains unchanged.
Detaching before callbacks would make `getCurrentSession`/`getUserContext`
observe a different lifetime and was deliberately not introduced.

The identity check matters for a callback that explicitly finishes the old
session then opens another one. Unconditional finally-removal would delete
that new session. Tests exercise this with the real manager and a callback
whose recursive close is bounded by an `AtomicBoolean`; no manager mock,
reflection-based replacement or synthetic nested API is used.

## Compatibility Boundaries

- `openSession()` and `openSession(name)` still reuse an existing session.
  They do not create children, rename the existing session, merge contexts
  or restore a parent.
- Commit/rollback callback ordering and fail-fast behavior are unchanged.
  The failure is not swallowed, translated or converted into success.
- A repeated close after cleanup does not retry the old failed callback list.
  Closing the separately retained `ActionSession` object directly is outside
  this manager-binding guarantee.
- `closeSession` still targets whichever session is current at entry. The
  repair does not introduce an owner-token close API or change later explicit
  calls made by a caller.
- The repair removes only the action-session binding. `UserContext`,
  `PSDevSysUserHolder`, response headers, download file, action-info builder,
  datasource holders and transaction utilities retain their existing owners.
  A request-level `UserContext` is intentionally not cleared here.
- Removing a thread binding does not erase user/cache data from an old
  `ActionSession` object retained elsewhere. It prevents automatic reuse by
  the next manager-owned request on that thread.
- Recursive future callbacks still require caller control; no general
  reentry guard or callback retry policy was added.

## Transaction And Callback Review

The inspected `ActionSession.close` only invokes future-action commit or
rollback callbacks. It does not directly commit or roll back a database.
`ActionSession.execute` delegates propagation to `ITransactionalUtil` and
restores its transaction state in a separate finally block.

The cloud `TransactionalUtil` manages Spring transaction execution; its
manual transaction stack is separate. A post-commit callback failure cannot
be advertised as evidence that a committed database transaction rolled back.
This repair does not change propagation, nested transaction behavior,
callback list ownership or Spring transaction completion.

Representative existing callers include `ActionSessionManager.execute`,
`DataEntityRuntime.executeActionReal` and
`ServiceSystemRuntimeBase` operations. Their `bOpenActionSession` checks rely
on the flat, idempotent open contract and have not been reinterpreted.

## Focused Java Tests

New test:

`ibiz-service-hub/libs/ibiz-modeling-core/src/test/java/net/ibizsys/runtime/util/ActionSessionManagerCleanupTest.java`

It resides in the modeling-core test module because that module has the
existing JUnit/reactor setup and depends on the real `ibiz-runtime`. The test
package remains `net.ibizsys.runtime.util`; no duplicate production class is
introduced.

Sixteen tests cover:

- Legacy idempotent open and reuse by an inner `execute`.
- Commit and rollback callback selection, ordering and current-context
  availability during callbacks.
- Runtime exception and error propagation with cleanup.
- No replay after repeated close, including after failed close.
- A fresh session has no previous principal, app/root, authorization-cache
  parameter or ignore-check state.
- The separately owned request `UserContext` survives action-session cleanup.
- Replacement-session preservation on commit, rollback and callback failure.
- Manager-owned execute success/close failure and action-failure rollback.
- A reused executor worker cannot inherit the failed request's identity or
  cached grant.
- A second thread's failure cannot clear the first thread's session.

All executor waits and shutdown checks are bounded. The Java test code uses
no database, business endpoint or shared service. Its compiler was executed
in the explicitly authorized isolated helper described below.

### Current-Source Execution

Executed November 14, 2026, 10:00-10:01 Asia/Singapore. The offline reactor
compiled fresh current-source snapshots, including 1,027 runtime source
files; no existing `target` directory was copied or reused.

Result: **103 tests passed, 0 failures, 0 errors, 0 skipped** across seven
explicit suites:

| Suite | Tests |
| --- | --- |
| `PSModelDEAccessManagerTest` | 14 |
| `SystemAccessManagerRequestCacheTest` | 12 |
| `SystemAccessManagerEditorRegistryTest` | 11 |
| `ModelSysUtilRTAddinAuthorizationTest` | 10 |
| `SystemAccessManagerJsonCacheTest` | 38 |
| `PSDevSysUserHolderTest` | 2 |
| `net.ibizsys.runtime.util.ActionSessionManagerCleanupTest` | 16 |

The reactor used JDK/javac 17.0.20 and Maven 3.9.16 from the previously
available immutable local image, with pull disabled, no network, a read-only
root filesystem, nonroot UID/GID, two CPUs, 3 GiB memory, 512 PIDs and a
1 GiB `/tmp` tmpfs. The source snapshot and dependency repository were mounted
read-only; only the new build worktree was writable.

Private execution directory:

`.artifacts/authorization-a03-java-20261114-r1/attempt-2/`

| Evidence | SHA-256 |
| --- | --- |
| `report.json` | `93395301b295fa72f6977648bde22b0bf16746ef37e0b8d8049c48364bb14197` |
| `java-focused.private.log` | `3ad8d755ebe7f871978431bcd32f4e9175fae3f0dd30437b1892a5fd3a60c38a` |
| `surefire-summary.json` | `2bc3079909485840fcf329442fbd965949347d3b6ec3e82b323b33b6752540e3` |
| `source-before.json` and `source-after.json` | `b73a6ec01d2d81fc620893e18810abd10154bdedf0341fffe3eaccc913ccdabb` |
| `repository-before.json` and `repository-after.json` | `3cf2d7856ece39eee96185c5c346affa00f418fe7be4380caa9aed6b15eab02a` |

The exclusive private driver is
`.artifacts/authorization-a03-java-20261114-r1/driver.mjs`, SHA-256
`c66dd28754b114cc4c8364618796e406349590e232d0d7ce8e00b617b943808f`.
Its exact selected suite/count checks use structured Surefire XML, not a
success-looking log line.

Both source/repository inventories match before and after. The snapshot
and worktree source inputs also match the originals. The unique compiler
container was auto-removed or removed only after exact name, image and nonce
label checks; its absence was then verified. No compiler peer was running
at either launch preflight.

The initial preflight receipt at the parent artifact directory is retained:
an overly broad OCI-label match rejected an existing runtime before creating
any helper or copying inputs. The corrected preflight checks compiler role
labels and actual name/image identities; it writes the successful second
attempt to a new directory rather than overwriting that failure.

This execution verifies the narrow session-cleanup implementation and the
listed regression suites only. It is not nested-session, HTTP or deployed
runtime acceptance.

## Remaining A03 Work

This change repairs a concrete production error path, but full A03 remains
open:

1. No explicit nested session API or production caller was added.
2. Parent context restoration, child commit/rollback policy and callback
   ownership still need a reviewed additive contract.
3. Legacy caller ownership, request-final cleanup of other context holders,
   real transaction completion and pooled-request integration need separate
   acceptance.
4. A model/browser/HTTP success or this unit suite cannot promote global
   authorization or multi-node security acceptance.

The November 11 threat review and November 12 draft remain historical design
evidence, not assertions that this production code is unchanged. Their
source-bound audits must be refreshed against the new finally-removal
behavior rather than requiring the obsolete `actionSession.set(null)` text.

No shared runtime/container lifecycle, business database, full npm suite,
commit or push was changed by this subtask. The only created/removed resource
was the explicitly authorized bounded offline compiler helper.
