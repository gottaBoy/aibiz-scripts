# Native Portal Request Contract

Checkpoint: 2026-11-15, Asia/Singapore. Scope: source/model audit and pure
admission policy for R05. No HTTP, Docker, SQL, browser forwarding, shared
source change or runtime acceptance ran in this task. None of the 25
top-level acceptance items is closed.

## Decision

All three currently reviewed route families remain **denied** by
`allowOwnedNativePortalRequest(request, scope)`. The companion
`assessOwnedNativePortalRequest` explains the exact operation, effect class
and missing gates. It accepts only an exact loopback origin, ModelDesign
application, root, dashboard record and open-data key supplied by the owned
harness. It does not trust an `admin`, `optIn`, identity header, body root
or caller-provided "reviewed" flag to grant admission.

This is not a replacement for authentication, server authorization,
deployment/image validation or response/snapshot validation. Recognition
is not permission. Do not integrate this as a generic `/portal/*`,
`/dynadashboards/*` or custom-POST allowlist.

## Manual Requirements

The PLM manual does not define native Modeling portal presence, native
dashboard storage or Modeling overview counters. These are independent
native product contracts. Normal authorization, tenant/root isolation,
nonempty business correctness, error capture and owned cleanup still
apply. An HTTP verb or model `READ` tag alone does not prove no effects.

## Source Observations

| Family | Published Method And Data | Identity And Effects | Current Blocker |
| --- | --- | --- | --- |
| `/portal/markopendata/{entity}/{key}[/{action}]` | GET and POST; missing action defaults to VIEW; VIEW/EDIT/UPDATE/CLOSE; optional POST map payload | Requires current authentication user and employee context. API users return an empty list early. Cache category uses employee `dcsystemid`, entity and key; field uses MQTT topic. Reads all entries, removes expired entries, sets current action with timeout and can notify other topics. No entity/root record authorization is visible in this method. | Own cache topic, record authorization, cross-session audience and cleanup are not accepted. |
| `/psdevslnsys/{root}/dynadashboards/...` | Keyed GET/PUT/DELETE; POST create/save/checkkey/fetchdefault; GET getdraft | Source table is `T_DYNADASHBOARD`. DTO has ID/name/type/app/model ID/user ID/model and audit fields. `USERID` is a normal writable text field, not proof of current-user ownership. `PSDEVSLNSYSID` is a nonphysical UI-assist field. Default source SQL has no fixed WHERE root/user filter. Create/update/save/remove can change the dashboard and audit values. | Actual schema destination, row preflight, server user/root enforcement, role assignment and owned cleanup remain unverified. |
| `/psdevslnsys/{root}/modelobservations/sysoverviewcnt` | POST; native action `dataAccessAction=READ`, DELOGIC, declared return VOID | The reviewed logic sets `filter.pssystemid` to a template UUID, then reads five CurSys datasets and assigns counters in memory. END returns Default despite the action/app return metadata declaring VOID. | Authorized dynamic logical-system binding, actual serialization, five dataset permissions, counter correctness and readonly snapshots remain unverified. |

`markopendata` is presence/collaboration, not a proven SQL "recent history"
write. Its inspected method directly uses the cache and optional informer;
this does not prove that surrounding infrastructure never writes logs.
Default source timeout is 300 seconds. CLOSE first resets its current-topic
entry but continues through the shared branch and can set a CLOSE entry
again. It is not a proven delete/cleanup operation. MQTT disabled in a
deployment does not imply no topic, no cache effects or no informer.

The dashboard source declares `enableEntityCache=false`,
`enableDataVer=false` and `dataChangeLogMode=0`. These model flags do not
prove all runtime/cache/audit effects absent, and do not establish which
owned physical schema receives the table. The normal client constructs a
personal dashboard resource tag using application/control/person context
and sends `USERID` from `srfpersonid`; a client naming convention is not
server ownership enforcement. Its `UtilService.load` catches errors and
returns `{}`, so empty/default UI cannot prove an authorized record read.

Neither DYNADASHBOARD nor MODELOBSERVATION is in the source default
model-instance entity registry or explicit Modeling authorizer switch.
The manager first permits runtime-plugin overrides, otherwise these
entities fall through to the generic entity manager. Generic role checks
can deny missing roles; declared ALL_R/ALL_RW roles do not prove assignment
to an account. A root editor/viewer grant must not be broadened to generic
READ or administrator privileges just to obtain a green dashboard.

The five source overview reads are PSSysApp, PSDataEntity, PSSysServiceAPI,
PSSysPFPlugin and PSSysSFPlugin. The reviewed node set contains only BEGIN,
PREPAREPARAM, DEDATASET and END, with no direct entity-write node. That is
read intent, not current-runtime proof that nested services are side-effect
free or that the template filter is safely replaced by every dataset.

## Current Evidence

The new tests bind twelve inspected source files by SHA-256 and parse the
actual JSON methods, DTO/physical-field definitions and logic nodes.
They exercise exact route classification, method/resource/root rejection,
origin and encoding attacks, accessor rejection, immutable decisions and
the fact that no recognized request is currently admitted.

The audit inputs are the maintained `ibiz-service-hub/libs/` Java sources
and the model source under
`vendor-upstream/ibizmodeling-standard/modelapi-core/src/main/resources/model/net/ibizsys/modeling/`.
They are not a claim that a newly staged/deployed model has identical
bytes. A source change intentionally breaks the hash test for re-review.

Reproduce with:

```sh
node --test scripts/tests/owned-native-portal-contract.test.mjs
```

The prior live M03/M04 request blocks remain blocks before dispatch, not
observed backend failures or successful source-contract acceptance.

## Required Work

1. Bind candidate published model, plugin overrides, image/mount inputs and
   actual datasource/table mapping before using this review operationally.
2. Define and implement native server root/user ownership for dashboard
   reads and writes; verify own/cross-user/cross-root/nonmember cases without
   granting generic administrator access.
3. Replace the overview template UUID through a source-backed authorized
   logical-system contract and define its returned counter DTO; then verify
   nonzero real counts and all five nested dataset permissions.
4. Define presence-cache admission, exact owned topic/category snapshots,
   audience isolation, TTL behavior and cleanup. Do not assume CLOSE is
   deletion or MQTT disabled is side-effect free.
5. Only after those gates, add an individually reviewed forwarding
   implementation with full physical/cache comparisons, response binding,
   error retention and exact owned cleanup. This module currently provides
   no such forwarding and deliberately has no force-enable option.
