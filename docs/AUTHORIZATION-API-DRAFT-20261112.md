# Authorization API Draft

Date: November 12, 2026.

This is a design-only, non-production reference. It does not alter Java
authorization code, JWT lifetime, cache serialization, ActionSessionManager,
containers or database state.

## A02 Revision Invalidation

`authorization-api-draft.mjs` contains:

- `GrantRevisionStore`: monotonic compare-and-set revision per principal/root.
- `RevisionedAuthorizationCache`: cache hit requires the caller's current
  authoritative revision to equal the cached revision.

The draft tests same-token stale-cache rejection and principal/root isolation.
It is not production-safe until the revision is emitted by every authoritative
grant mutation path, including native/admin writes, and delivered with defined
cross-node ordering/loss semantics. `PSDevUserCacheCodec.Entry` is unchanged.

## A03 Nested Sessions

`NestedActionSessionDraft` is an additive reference contract:

- child session starts with inherited values;
- commit merges child values into the parent;
- rollback or exception discards child values;
- parent is always restored in `finally`.

The current Java `openSession` remains flat. No legacy caller is changed.
Production adoption requires explicit Java `openNestedSession`,
`closeNestedSession` and `executeNestedSession` APIs plus a full audit of
existing `bOpenActionSession`/`closeSession` pairs.

## Tests

`node --test tests/authorization-api-draft.test.mjs`

The draft is intentionally marked `productionWired: false`.
