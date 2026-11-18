# R05 Overview Repair Boundary

Checkpoint: 2026-11-18, UTC+08:00 host date. This is a source review and
implementation boundary, not native HTTP or browser acceptance. No shared
model, Java source, deployment, database, cache or runtime permission was
changed. R05 remains open.

## Manual Requirements

The PLM manual does not specify native Modeling overview statistics. This
is an independent capability. Root isolation, real nonempty count
correctness, native role enforcement, bilingual failure states and
read-only persistence/cache comparisons are still required. Existing
`NATIVE-PORTAL-CONTRACT-20261115.md` admission remains denied.

## Local Implementation Observations

Paths below are relative to the workspace. Maintained Java paths start at
`ibiz-service-hub/`; model paths start at
`vendor-upstream/ibizmodeling-standard/modelapi-core/src/main/resources/model/net/ibizsys/modeling/`.

| Observation | Exact Source |
| --- | --- |
| The action is `DELOGIC`, declares `READ`, and has DTO input and `VOID` return. | `PSMODULES/AppStudio/PSDATAENTITIES/ModelObservation/PSDEACTIONS/SysOverviewCnt.json` |
| Its logic replaces the filter system with template ID `2C40DFCD-0DF5-47BF-91A5-C45F810B0001`, uses size 1, reads five `CurSys` pages and copies their totals into the input DTO. END returns that DTO. | `PSMODULES/AppStudio/PSDATAENTITIES/ModelObservation/PSDELOGICS/SysOverviewCnt.json` |
| The app action/method also declares `VOID`. | `PSSYSAPPS/ModelDesign/PSAPPDATAENTITIES/ModelObservation.json` |
| `DELOGIC` dispatch precedes unknown-action dispatch. Adding a case only to `onExecuteActionUnknown` does not repair this action. | `libs/ibiz-runtime/src/main/java/net/ibizsys/central/dataentity/DataEntityRuntime.java:1757` |
| The logic dataset node directly calls the destination runtime's `fetchDataSet`; it does not call the destination Service API authorization entry. | `libs/ibiz-runtime/src/main/java/net/ibizsys/central/dataentity/logic/DELogicDEDataSetNodeRuntime.java:35` |
| Cloud dataset permission conditions are added only when dataset DR flags/custom DR modes require them. All five reviewed `CurSys` declarations have none of those flags. | `libs/ibiz-cloud-core/src/main/java/net/ibizsys/central/cloud/core/dataentity/DataEntityRuntime.java:984`; the five entity JSON `getAllPSDEDataSets` arrays |
| All five `CurSys` queries compare `PSSYSTEMID` to data-context `pssystemid`; a caller/filter value is not itself authorization. | The five entity JSON `getAllPSDEDataQueries` arrays and their `PSDEDATAQUERIES/CurSys/PSDEDQCODES/MYSQL5.json` files |
| Only three count entities are in the maintained model-instance registry. ModelObservation and both plugin entities are not. | `libs/ibiz-modeling-core/src/main/java/net/ibizsys/modeling/core/util/PSModels.java:127` |
| Explicit entity/plugin managers precede the registry, then remaining entities fall through to the generic manager. | `libs/ibiz-modeling-core/src/main/java/net/ibizsys/modeling/core/security/SystemAccessManagerBase.java:122` |
| ModelObservation declares user/organization roles; these declarations are not proof of account assignment. PF plugin declares generic roles; SF plugin has no embedded role list in the reviewed entity source. | `PSMODULES/AppStudio/PSDATAENTITIES/ModelObservation.json`; `PSMODULES/Config/PSDATAENTITIES/PSSysPFPlugin.json`; `PSMODULES/SysDesign/PSDATAENTITIES/PSSysSFPlugin.json` |

### Return Contract Is Not Yet An Observed Failure

Do not report that `VOID` necessarily makes this POST return an empty body.
`DEServiceAPIRuntime.onExecuteAction` has different paths: the non-batch
list-input path omits its return list for `VOID`, but the single-input
path returns the executed logic result directly unless input-output mode
applies. See
`libs/ibiz-runtime/src/main/java/net/ibizsys/central/dataentity/service/DEServiceAPIRuntime.java:341`
and `:423`. The actual request parsing, DTO serialization and client
handling still require current-version tests.

## Concrete Implementation Boundary

### Method-Scoped Entry

A dedicated candidate `ModelObservationDEServiceAPIRuntime` can override
the existing `onExecuteAction(scope, relationship, parentKey, method,
body, key, tag)` extension point. It must recognize the exact
ModelObservation `SysOverviewCnt` method and its PSDevSlnSys parent
relationship. Other methods must delegate unchanged. The parent key and
canonical AppContext root must agree; an absent, typed, malformed or
conflicting root must fail before any count query.

The dedicated API runtime must be bound in an owned, reproducible
candidate model, with startup/runtime-class evidence. The reviewed
ModelObservation entity does not bind the maintained
`DataEntityRuntimeBase`; merely adding code to that base does not prove
the native action reaches it. Runtime code mode, module providers,
entity plugins and global plugins can affect dispatch.

### Authorization Before Counting

The conservative implementation preserves the existing action's native
ModelObservation `READ` decision and independently checks all five
destination entity managers' `READ` decisions before the first fetch:

| Count | Destination | Current Default Policy |
| --- | --- | --- |
| `sysappcnt` | `PSSysApp` | Root model manager |
| `sysdecnt` | `PSDataEntity` | Root model manager |
| `serviceapicnt` | `PSSysServiceAPI` | Root model manager |
| `pfplugincnt` | `PSSysPFPlugin` | Generic manager unless overridden |
| `sfplugincnt` | `PSSysSFPlugin` | Generic manager unless overridden |

Resolve the logical system from the validated current-root `SYS` grant,
not from the request DTO, route-supplied logical ID, template constant,
cached frontend projection or `appdata` refresh. Validate grant root,
principal/center, expiry and read capability. Each entity's authorized
search context must remain bound to that same logical system. Explicit
runtime/plugin denial must not be replaced by a blanket root-read grant.

Use an independent server-created page-0/size-1 filter for each query and
read `Page.getTotalElements()`, not content length. Validate all five
results before producing the DTO. Never use `0`, a partial response or
the caller's submitted counters when a role check/query/serialization
fails. Do not invoke the old template-bound logic after the new reader.

This conservative path may still deny an ordinary editor: that is a
real policy result, not a completed overview capability. Granting that
editor overview access needs a separate decision on ModelObservation and
the two plugin entity policies. Do not register all three entities in
`PSModels`, grant `ALL_R`, or widen PSSYSTEM/generic READ just to make the
overview succeed. An alternative exact-action-only projection policy
would require an explicit reviewed contract before implementation.

### Explicit Response And Candidate Inputs

Publish a DTO return with only the five counter fields. Update the
authoritative action, embedded entity action and app action/method
declarations consistently in the owned candidate; do not silently change
shared mounted vendor inputs. Count values must be integral,
nonnegative and preserve totals larger than the one-row page.

If the frontend cannot request authorized statistics, show an unavailable
state with translated Chinese/English messaging and a real retry/error
path, not five zeroes. The normal overview remains unaccepted until the
candidate binding, role policy and client response contract are tested.

## Required Verification

1. Java entry/reader tests: exact method dispatch, unchanged unrelated
   methods, genuine native model objects and explicit plugin precedence.
2. Root/principal tests: owner, limited admin, object admin, editor,
   viewer, nonmember, cross-root/cross-organization, anonymous, expired
   grant and a grant for a different principal/center. Reject missing,
   non-string and malformed roots before queries.
3. Permission tests: independently deny each of the six decisions
   (action plus five entities), confirm zero fetches, no input mutation,
   no partial counters and no fallback administrative identity.
4. Count tests: two roots with different nonzero totals, empty authorized
   root, totals larger than page size, separate filters, caller-supplied
   system/counters ignored, and failures on each query. Validate actual
   DTO serialization for a single input; reject unsupported batch input.
5. Owned native HTTP/browser tests: all five real totals, Chinese/English
   refresh/deep link/mobile, error/retry state, console and failed
   requests, full physical and cache before/after comparison, current
   code/model/image/mount hashes and owned cleanup.

## Current Acceptance Evidence And Blockers

This review used local source reads and JSON parsing only. No Java build,
live HTTP, SQL, Docker or browser test ran; no acceptance item is closed.
The previously harness-blocked POST is still a pre-dispatch block, not an
observed server authorization or serialization result.

Implementation prerequisites are the owned API-runtime binding, the
decision to retain current six-way permissions or approve a new exact
projection policy, and a consistent DTO/candidate model. R01/R02 generic
system reads, portal presence and dynamic dashboards are separate
contracts and are not unblocked by this design.
