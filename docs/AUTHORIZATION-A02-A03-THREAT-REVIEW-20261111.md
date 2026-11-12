# A02/A03 Threat And Compatibility Review

Checkpoint: November 11, 2026.

Status: **BLOCKED** for both items. No production authorization or JWT code
was changed in this review.

## A02: Same-Token Cache Revocation

### Threat

`SystemAccessManagerBase` decodes a token-scoped `PSDevUserCacheCodec.Entry`
and returns an active `IPSDevSlnUser` cache hit before re-reading the
authoritative `PSDevSlnUser` grant rows. Existing tests intentionally clear the
backing grant list after populating the cache and still accept repeated cache
hits. Expiry and token-category checks work, but grant demotion/removal for the
same token is not immediately observed.

### Why The Obvious Fix Is Unsafe

Unconditional per-hit database revalidation would change every SYS/SLN
authorization request into a synchronous membership query. It also needs to
preserve center-administrator, global-grant, WXMP-role and derived-read
semantics. That is a behavioral and latency change, not a small cache fix.

### Minimum Reviewed Design

1. Add a monotonic authorization revision for each grant principal/root.
2. Increment and publish that revision from every authoritative
   `PSDevSlnUser` create/update/remove path, including native/admin writes.
3. Store the revision in `PSDevUserCacheCodec.Entry`.
4. Reject a cache hit when the stored revision differs from the current
   revision.
5. Add tests for same-token demotion/removal, expiry, event loss, cross-node
   ordering, direct native writes and administrator/WXMP behavior.

The current source has no revision field and no complete mutation hook. A02
therefore remains blocked rather than receiving an unreviewed production
change.

## A03: Nested Session And Holder Cleanup

`PSDevSysUserHolder` is already a per-thread stack with pop/empty cleanup and
thread-isolation tests. `ActionSessionManager`, however, keeps one flat
thread-local `ActionSession`; `openSession` returns the existing session and
the old child-session implementation is commented out.

Changing `openSession` to create children would alter many existing
`bOpenActionSession`/`closeSession` transaction guards. The minimum compatible
design is additive:

- add explicit `openNestedSession` and `closeNestedSession` APIs backed by a
  per-thread stack;
- restore the parent on both commit and rollback;
- add `executeNestedSession` with `finally` cleanup;
- test success, exception unwind, parent context restoration and thread
  isolation;
- keep existing `openSession` idempotent until all callers are audited.

No nested API or reviewed error-unwind contract exists today, so A03 remains
blocked.

## Receipt

Harness: `harness-authorization-a02-a03-review.mjs`

Focused tests:

`node --test tests/authorization-a02-a03-review.test.mjs`

Receipt generation:

`node harness-authorization-a02-a03-review.mjs --output=.artifacts/authorization-a02-a03-20261111/report.json`
