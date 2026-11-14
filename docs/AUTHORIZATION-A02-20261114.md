# A02 Same-Token Revocation

Date: 2026-11-14. Status: **blocked production design; bounded source audit
complete**. No production Java, cache codec, JWT, session API, model, database
or deployment was changed by this audit. JWT lifetime remains 20 seconds.

This extends `AUTHORIZATION-A02-A03-THREAT-REVIEW-20261111.md` and
`AUTHORIZATION-API-DRAFT-20261112.md`. The JavaScript revision draft is still
not wired into production. A02 is not closed by this document.

## Required Behavior

The same valid token must not keep a removed or downgraded SYS/SLN grant
across the agreed revocation boundary. A denial must leave model data
unchanged. The contract must also define:

- Whether an already-authorized operation may finish after revocation.
- Whether a later action in the same long-running session must reauthorize.
- How owner transfers, center-administrator removal, WXMP-role removal and
  derived solution READ access participate.
- Failure behavior when an authoritative grant/revision source is unavailable.

Token expiry and root/type validation do not establish grant freshness.
Refreshing or shortening a token is not a replacement for this contract.

## Current Source Observation

Authoritative Java:

`ibiz-service-hub/libs/ibiz-modeling-core/src/main/java/net/ibizsys/modeling/core/security/SystemAccessManagerBase.java`

| Read path | Current behavior | Revocation consequence |
| --- | --- | --- |
| `onGetPSDevUserBase`, lines 379-424 | Decodes token-category `PSDevUserCacheCodec.Entry`; a positive, unexpired non-admin entry returns before reading grant rows. | Same-token demotion/removal is not observed on this path. |
| Cached admin branch, lines 396-421 | Re-reads the target's actual center and checks a center user returned by `getCurrentPSDevUser`. | Target-center substitution is checked, but the center user's admin flag is itself cached. |
| `getCurrentPSDevUser`, lines 312-323 | Decodes the token-category center entry, with type/root/expiry checks. | Center-user removal, mapping changes and admin demotion need a freshness protocol too. |
| `onGetCurrentPSDevSysUser`, lines 667-671 | An explicit `PSDevSysUserHolder` wins and is checked only for active mode, expiry and a valid scoped root. | Bypasses the SYS/SLN token-cache path entirely. This is an intentional scoped capability today, not proof of a fresh membership. |
| Same method, lines 689-704 | `ActionSession` caches `IPSDevSysUser` under a root-only tag; hits check root/mode/expiry and do not query grants. | Clearing only the external cache cannot revoke a captured session object. Principal/token switches within a reused session need an explicit rule. |

`PSDevUserCacheCodec` schema v1 preserves access bits, admin mode, root,
expiry and metadata. It contains no grant source, authorization revision or
validation epoch. JSON round-tripping is not a freshness check.

The model entity access manager (`dataentity/security/PSModelDEAccessManager`)
uses `getPSDevUserBase("SYS", root)` directly. Runtime helpers and model
utilities can instead use `getCurrentPSDevSysUser`, which has the holder and
session paths above. Both must be covered; fixing only one call site is
insufficient.

## Authority And Dependencies

The existing resolution rules must remain intact unless separately changed:

| Authority | Source and current selection semantics |
| --- | --- |
| Specific SYS grant | `PSDevSlnUser` with `AllSysFlag=0`, matching `PSDevSlnSysId` and development-user object. Takes precedence over a global grant, including explicit access mode 0. |
| Global scheme grant | `PSDevSlnUser` with `AllSysFlag=1`, matching development-user object; applies to systems in the scheme. |
| Scheme owner | `PSDevSln.AdminPSDevUserId`; SYS synthesizes access mode 3, SLN synthesizes 19. Removing grant rows alone does not revoke the owner's independent authority. |
| Center administrator | Current `PSDevUser.adminmode` plus equality with the target's actual center; produces mode 3. The underlying user mapping and center binding are dependencies. |
| WXMP fallback | Current `WXMP_USERS` role supplies SYS mode 1 only when there is no selected grant. A specific zero-mode grant remains a deny; SLN has no identical role fallback. |
| Derived SLN READ | In the absence of a global scheme grant, an active positive SYS/TEMPL/DYNAINST grant can supply READ. READ lasts while any supporting specific grant remains active. |
| Expiry and target metadata | Grant expiry, system expiry, target's actual root/center/scheme and model-system binding influence the resolved result. |

The current resolver queries all grants in a scheme for SYS selection;
SLN selection filters by scheme and principal. `isActiveSystemGrant` rejects
missing scope/mode, negative modes and expired rows. These checks run on
fresh resolution, not on a positive cached membership.

## Observed Mutation Entrypoints

This is a bounded catalog of local source, not a claim that every deployed
plugin or external administrator has been inventoried.

1. Native provider CRUD/Save: the local vendor ModelAPI exposes
   `PSDevSlnUser` Create/Update/Remove/Save as well as the scheme-nested
   relationship. Create is POST/CREATE; Update is PUT/UPDATE; Remove is
   DELETE/DELETE; Save is POST/CREATE in the observed model. Its aggregate
   action definitions are builtin persistence without an authorization
   revision or invalidation hook.
2. Native internal callers:
   `modeling/core/dataentity/service/IPSDevSlnUserService` inherits generic
   `IProxyDEService` create/update/remove/save/execute methods.
   `central/cloud/core/dataentity/service/DEServiceInvocationHandler`
   dispatches to the real runtime service or `invokeMethod`. A UI-only
   invalidation handler would not cover these writes.
3. Direct administration clients:
   `ibiz-centralstudio/.../service/impl/PSDevSlnUserServiceImpl.java`
   implements POST/PUT/DELETE for both `/psdevslnusers` and
   `/psdevslns/{psdevsln}/psdevslnusers`. A wrapper around only one nested
   endpoint would miss the root endpoint.
4. Legacy V5 service:
   `task7/SAPAAS/src/saibz5studiolib/net/ibizsys/pscore/srv/sysdesign/service/PSDevSlnUserService.java`
   can turn create into update when an equivalent target/principal row
   exists. Before/after hooks handle scope normalization, protected default
   membership and Git/SVN synchronization, not this Java cache revision.
   Its base class also contains parent-related update/remove paths.
5. Related object administration:
   scheme-owner changes are not membership CRUD. Legacy
   `PSDevSlnService.onBeforeRemove` uses `sysUpdate` on default grants;
   target reassignment/deletion and center-user/role changes also affect
   effective authorization without the same grant mutation call.
6. Direct SQL/import/repair paths remain a deployment inventory gate.
   The local schema has `T_SRFPSDEVSLNUSER`, and initialization/maintenance
   tooling can write authoritative tables. No complete database trigger or
   durable change-log protocol was found in the audited scope.

Native model source:

`vendor-upstream/ibizmodeling-standard/modelapi-core/src/main/resources/model/net/ibizsys/modeling/`

Relevant files are `PSMODULES/SysDesign/PSDATAENTITIES/PSDevSlnUser.json` and
`PSSYSSERVICEAPIS/ModelAPI.json`. These files being present does not prove
that their bytes or all paths are active in the current deployment.

## Candidate A: Durable Revisions

This retains cross-request permission caching but needs a broader production
change than a codec field:

1. Define dependency revisions for center/principal identity and role
   authority, scheme/principal grants and owner authority, and target
   root/center/scheme/model binding. A single specific-root counter cannot
   represent a global grant or owner change without a fan-out rule.
2. Make authoritative mutations and revision increments atomic in the same
   durable transaction, covering native/internal/admin/legacy/import paths.
   Revocation must not depend solely on a best-effort event.
3. Store the revision vector and authority source in a new cache schema/key.
   Reject missing or mismatched revisions; never promote an old v1 entry.
4. Define stable snapshot reads: read revisions, resolve grants, recheck
   revisions, then cache only if unchanged. Use the authoritative store
   rather than a stale replica. Define ordering for competing mutations.
5. Check revisions before token-cache, session-cache and holder reuse, or
   explicitly restrict holder/session lifetime to a documented capability
   snapshot. Cache misses and revision-store failures must fail closed.
6. Use a durable outbox for eager cross-node eviction if useful; revision
   checks remain the correctness mechanism when delivery is lost.

**Current blockers:** `ISysCacheUtilRuntime` offers get/set/reset operations
but no observed monotonic compare-and-set/increment contract. There is no
complete write hook, atomic revision persistence, dependency vector or
cross-node ordering/loss contract in this scope. Adding a volatile map,
timestamp, event listener or unconnected revision field would not implement
this protocol. No such substitute was added.

## Candidate B: Request-Bounded Reauthorization

An alternative would stop treating a token-cache hit as authority and
recompute from authoritative sources once per
token/principal/tenant/type/root per outer request/session. Repeated checks
within that unit could share a validated snapshot; calls without a session
would reauthorize each time.

This avoids requiring complete invalidation hooks and can observe committed
native/admin/legacy changes on the next fresh request. It is not equivalent
to immediate revocation:

- Authorization needs a proven outer request boundary. `ActionSession`
  reuse, asynchronous jobs and long sessions are not automatically HTTP
  request boundaries.
- Center identity/admin mode must also refresh; retaining its token cache
  would preserve admin demotion and identity-mapping gaps.
- Holder-created operations need an audited origin and lifetime. Blindly
  trusting a holder leaves a gap; blindly reauthorizing it can break
  background/scoped operations without authentication context.
- The request key must include principal/token/tenant as well as root, with
  explicit failure and identity-switch handling.
- Compared with the present cache, the first check per root/unit adds
  center lookup, target/scheme reads and a membership query where required.
  Owner, admin and WXMP paths have different costs. Query counts, latency
  percentiles and outage behavior need measurement before adoption.
- A mutation during the same snapshot or transaction may not become visible.
  A new independent authorization boundary is required for later writes if
  that is the selected product/security contract.

This is a proposed behavioral/performance tradeoff, not an approved small
cache fix. Root review explicitly did **not** authorize this production
change in the current turn.

## Existing Executable Evidence

No duplicate Java tests were added. Existing focused suites already
characterize the current limitation:

- `SystemAccessManagerJsonCacheTest.assertRepeatedJsonHits` clears backing
  grants and changes target metadata after populating the cache, then
  confirms repeated same-token hits without membership re-reads. This is
  evidence of stale behavior, not a passing revocation regression.
- `SystemAccessManagerCacheTest.activeCachedSchemeAndSystemAreReturnedWithoutGrantLookup`
  confirms zero grant lookups for positive SYS/SLN cache hits.
- `SystemAccessManagerRequestCacheTest` covers active session-cache and
  holder returns without lookup, malformed and cross-root cache entries,
  expiry, zero/negative modes, and scoped nested-holder behavior.
- `SystemAccessManagerGrantTest` and `SystemAccessManagerSchemeGrantTest`
  cover specific/global precedence, explicit deny, expiry, owner authority
  and derived READ selection.
- `PSDevUserCacheCodecTest` covers serialization and root/type validation,
  not authorization revision freshness.

This audit ran source/structured-model reads only. It did not run Java
compilation, business HTTP, SQL or containers. Root coordinates a separate
current-source Java replay; earlier receipts are not silently reused as
evidence for a new production behavior.

## Required Acceptance Before Closure

1. Select revocation boundary and candidate protocol, document compatibility,
   query budget and failure policy, then review production wiring.
2. Same native token: mode 3 -> 1 rejects UPDATE but preserves READ;
   grant removal/zero/expiry rejects READ and UPDATE.
3. Repeat for SYS-specific, global scheme and derived SLN READ. Retain
   explicit specific deny precedence and independent owner/admin authority.
4. Transfer owner, demote/remove center administrator, change target center
   and remove WXMP fallback; verify stale privileges cannot survive.
5. Perform mutations through root/nested native APIs, internal service,
   direct administrator/legacy and supported repair/import paths.
6. Check token/principal/tenant/root switches, nested/scoped holders, session
   reuse, separate requests, asynchronous/long operations and thread reuse.
7. Exercise transaction races, rollback, cache/revision source outage,
   cross-node event loss/reordering and restart. Rejections must have no
   persistent model, version or audit side effects.
8. Pin current source/build/image/mounts, use a fresh owned environment,
   retain the normal 20-second JWT flow, and measure real query/latency cost.

**Outcome:** A02 remains a known production revocation gap with a concrete
decision gate. Neither source presence, current stale-cache tests passing
nor this audit is reported as authorization acceptance.
