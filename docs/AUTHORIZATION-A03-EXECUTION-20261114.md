# A03 Executor Session Ownership

Date: 2026-11-14. Scope: the `ActionSessionManager.execute` owner-close and
exception paths only. This is not nested-session, real database transaction
or deployed authorization acceptance.

## Current Source Findings

The previous finally-cleanup repair in `AUTHORIZATION-A03-20261114.md`
prevents `closeSession` from removing a different session opened by a close
callback. Two executor-level failures remained:

1. `execute` recorded only whether a session existed at entry. Its finally
   block closed whichever session was current at exit, even if the action
   explicitly closed the original and opened a replacement. An outer
   successful action could commit the replacement's callbacks; an outer
   failed action could roll them back.
2. A rollback callback failure in finally replaced the original action
   exception or error. The caller could lose the actual operation failure.

At the start of this change, `execute` already used a try/catch/finally
shape, not a catch block that explicitly closed twice. The revision retains
one close attempt and adds ownership and exception-preservation rules.

## Production Change

File:

`ibiz-service-hub/libs/ibiz-runtime/src/main/java/net/ibizsys/runtime/util/ActionSessionManager.java`

The executor captures the exact `ActionSession` returned by `openSession`.
It closes only when both conditions hold:

- This invocation opened the session because none existed at entry.
- That exact object is still the current thread-bound session at cleanup.

| Outcome | Executor behavior |
| --- | --- |
| Action succeeds; owned session still bound | Commit-close it once and preserve the action result. |
| Action fails; owned session still bound | Rollback-close it once and rethrow the exact action failure. |
| Rollback-close also fails | Add the secondary Throwable as suppressed on the original; do not replace it. |
| Rollback throws the original object again | Do not attempt illegal self-suppression. |
| Action succeeds but commit-close fails | Propagate that close failure directly; do not start a second rollback. |
| Action or callback replaces the session | Preserve the replacement binding and its callbacks for its actual owner. |
| A session existed at entry | Reuse it without closing it on success or failure. |

The existing `closeSession` identity-checked finally-removal remains
unchanged. The original session stays bound during its close callbacks, so
their context lookup behavior is preserved.

## Focused Regression Source

New suite:

`ibiz-service-hub/libs/ibiz-modeling-core/src/test/java/net/ibizsys/runtime/util/ActionSessionManagerExecutionTest.java`

Fully qualified name:

`net.ibizsys.runtime.util.ActionSessionManagerExecutionTest`

Twelve tests use the real manager, real `ActionSession` and real registered
future callbacks, with no manager mock, reflective binding replacement,
business endpoint, database or synthetic nested API. They cover:

- Successful owned result and commit selection.
- Original checked action failure with successful rollback.
- Secondary rollback exception and error as suppressed failures.
- Self-suppression avoidance when a rollback rethrows the original object.
- Commit exception and error propagation without rollback or callback retry.
- Replacement sessions opened by successful and failed actions.
- Replacement sessions opened by failing commit and rollback callbacks.
- Legacy outer-session reuse on success and failure.

Callback replacement tests use a bounded `AtomicBoolean` to recursively
close the original once, then open the replacement through public manager
APIs. A test explicitly closes its own replacement after checking that the
executor did not touch its callbacks.

Static verification: `git diff --check` passed.

Root ran one bounded offline compiler at a time, with fresh source copies,
read-only source snapshot and Maven repository, network disabled, 2 CPUs,
3 GiB RAM, 512 PIDs and a non-root user.

- Red: the same new suite with the committed pre-change manager produced
  exactly **5 failures out of 12**, with zero errors/skips. The manager was
  the only production file replaced in that private baseline.
- Green: the current manager and tests passed **115/115** across eight
  focused suites, including the previous cleanup tests and authorization
  regressions. Zero failures/errors/skips.
- Source, private snapshots/worktree source inputs and Maven dependencies
  passed before/after integrity checks. The exact nonce-labeled compiler
  was removed; no shared service was restarted.

Successful receipt:
`.artifacts/a03-execution-java-20261114-r1/attempt-2/report.json`,
SHA-256 `8ddc0250419cc9bd60dd6b2fb8af636eb06097fc03934ffc6cf0d4ea52363606`.
The sibling `red-suites.json` and `green-suites.json` contain structured
Surefire testcase evidence, not console-line counts.

The first attempt failed test compilation because two rollback-only test
callbacks omitted the required `commit()` implementation. That failure,
its source inventory and logs remain at the parent artifact directory.
After adding explicit fail-fast commit methods, the second attempt used
new source copies and build targets. No compilation failure was counted
as the expected behavioral red result.

The earlier 103-test receipt remains historical and is not reused as
evidence for this executor change.

## Boundaries And Remaining Risk

- Legacy `openSession` remains flat and idempotent. No child-session,
  parent-restoration or merge protocol was introduced.
- JWT, authorization-cache semantics, transaction propagation, transaction
  utilities, callback ordering and callback fail-fast behavior are unchanged.
- This guarantee concerns the manager's thread binding and its one executor
  close. Direct calls on a separately retained old `ActionSession` object
  remain outside it.
- If an action deliberately replaces its own session, the executor does
  not close the replacement. The code that opened it remains responsible
  for cleanup; preserving ownership is not automatic request-final cleanup.
- Other existing callers that directly pair `bOpenActionSession` with
  `closeSession` are not migrated by this narrow change.
- `ActionSession.execute` has a separate `PROPAGATION_REQUIRES_NEW` branch
  whose commit-callback failure can enter its rollback callback path and
  whose secondary failure can mask an earlier failure. That inner branch
  runs before the manager receives its Throwable. It was observed but is
  explicitly **not repaired or accepted** here; changing it would require a
  separate callback-list and transaction-completion review.
- Suppressed cleanup failure does not establish that a real database
  rollback succeeded. A commit callback failure cannot retroactively undo
  a database commit.

No staging, commit, push, shared runtime lifecycle, business HTTP or SQL
operation was performed by this subtask. Full A03 remains open.
