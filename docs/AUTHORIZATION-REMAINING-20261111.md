# Authorization Remaining Review

Checkpoint: November 11, 2026.

This review is a read-only source/test receipt. It does not modify Java
authorization code, grants, containers, databases, headers, tokens or shared
runtime resources. It does not claim live HTTP authorization acceptance.

## A01: Root Context

Status: **PARTIAL, strict controlled evidence**.

`SystemAccessManagerBase` rejects a missing, non-string, empty, whitespace or
control-character `PSDEVSLNSYS` root before authorization lookup. It also
revalidates an authorized holder/cache entry against the requested root before
returning it. The controlled tests cover optional denial (`null`), required
denial (exception), no service lookup and no action-cache population for
malformed roots, missing roots and foreign roots.

Bound source/test inputs:

- `../ibiz-service-hub/libs/ibiz-modeling-core/src/main/java/net/ibizsys/modeling/core/security/SystemAccessManagerBase.java`
- `../ibiz-service-hub/libs/ibiz-modeling-core/src/test/java/net/ibizsys/modeling/core/security/SystemAccessManagerRequestCacheTest.java`
- `../ibiz-service-hub/libs/ibiz-modeling-core/src/test/java/net/ibizsys/modeling/core/sysutil/addin/ModelSysUtilRTAddinAuthorizationTest.java`

Remaining blocker: no fresh owned real-HTTP receipt exercises every malformed,
typed and missing-root request while proving both physical model schemas remain
unchanged. The source/test result is not a live HTTP authorization verdict.

## A02: Same-Token Revocation

Status: **BLOCKED**.

The cache category is correctly scoped by authentication username and token.
Expiry, non-positive grants, malformed cache entries and distinct-token
separation are covered by controlled tests. However, the existing
`SystemAccessManagerJsonCacheTest` intentionally clears the backing grant list
after a same-token cache has been populated and then accepts repeated cache
hits. That proves the unresolved behavior: same-token grant revocation is not
observed without an invalidation/version mechanism.

Remaining blocker: a reviewed same-token grant-cache rotation or invalidation
protocol is absent. Do not report A02 complete based only on distinct-token
isolation or expiry checks. No production change was made because changing
cache semantics requires an explicit protocol and runtime receipt.

## A03: Nested Session And Holder Lifecycle

Status: **BLOCKED**.

`PSDevSysUserHolder` is a verified per-thread `Deque` stack. Push/peek/pop,
thread isolation and cleanup are covered. Request-level tests also clear the
holder and close the action session in teardown.

`ActionSessionManager` is different: `openSession` returns the existing
thread-local session when one is already present, and `closeSession` clears it.
The repository has no reviewed nested push/pop, exception-unwind and parent
restoration receipt. Therefore holder-stack coverage must not be promoted to
nested action-session completion.

Remaining blocker: implement and test a reviewed nested-session contract, or
explicitly document that action sessions are flat and close A03 with a flat
session acceptance criterion. No production change was made.

## Receipt

The read-only harness is:

`harness-authorization-remaining.mjs`

Focused tests:

`node --test tests/authorization-remaining.test.mjs`

Optional private receipt generation:

`node harness-authorization-remaining.mjs --output=.artifacts/authorization-remaining-20261111/report.json`

The receipt binds SHA-256 hashes of the actual manager, holder, action-session
sources and their controlled tests. It records `nativeAcceptance: false` and
`httpAcceptance: false` by design.
