# R05 Live Authority Boundary

Checkpoint: 2026-11-22, Asia/Singapore.
Status: **SOURCE-REVIEW-ONLY; ORDINARY-ACTOR-POSITIVE-POLICY-NOT-ESTABLISHED**.
Reviewed maintained backend: `ibiz-service-hub@26e52348195586d25ebd3524e46968e4e5b59e8b`.
The scripts checkout was `838ad9c65043812ec579a64434ceaab11e763a4a`.
No Docker, HTTP, SQL, grant mutation or shared-model change was performed for
this review. Source policy is not evidence of the manager loaded by a live image.

## Manual Requirements

Native Modeling overview counts are an independent capability, not a promise
from the PLM manual. The existing R05 contract requires the actor's real root
grant, six authorization decisions before the first count query, five genuine
totals, cross-root rejection and no writes. Do not create blanket plugin READ,
assign `ALL_R`/`ISALLDATA=1`, register more entities in `PSModels`, impersonate a
principal, or treat five zeroes as a repair.

## Local Implementation Observations

Paths under `CORE` below are relative to `ibiz-service-hub/`.
Model paths are relative to
`vendor-upstream/ibizmodeling-standard/modelapi-core/src/main/resources/model/net/ibizsys/modeling/`.

### Actor And Root

`CORE/libs/ibiz-modeling-core/src/main/java/net/ibizsys/modeling/core/dataentity/service/ModelObservationOverviewReader.java:74`
resolves `SYS` from the authenticated actor, not request counters or a caller's
logical-system selector. It requires:

- The canonical `AppContext.PSDEVSLNSYS` and route parent root agree.
- The current developer and resolved system grant are not expired.
- Developer ID, developer-center ID and root ID agree between actor and grant.
- The grant has READ bit `1`, or a genuine native administrator mode.
- The grant supplies the valid logical `PSSYSTEMID`.

`CORE/libs/ibiz-modeling-core/src/main/java/net/ibizsys/modeling/core/security/SystemAccessManagerBase.java:412`
loads the native grant from the target system/solution and the current actor.
The minimum ordinary specific-system membership has matching `PSDEVSLNID`,
`PSDEVSLNSYSID`, `PSDEVUSEROBJID`, `ALLSYSFLAG=0`, nonexpired membership/system
and `ACCMODE=1` (viewer) or `3` (editor). The user must also have the legitimate
developer/center identity. Native solution-owner and same-center administrator
derivation are separate paths; changing a name or role header does not create them.

### Six Decisions

| Decision | Maintained Default Selection | What Authorizes READ |
| --- | --- | --- |
| `MODELOBSERVATION` | Generic cloud manager, entity `dataAccCtrlMode=2` (`MASTER`) | The existing PSDevSlnSys parent DAC relationship and its root READ. This is not a self-controlled entity-role check. |
| `PSSYSAPP` | `PSModelDEAccessManager` through `PSModels` | Valid current-root grant READ bit, or its genuine native admin mode. |
| `PSDATAENTITY` | `PSModelDEAccessManager` through `PSModels` | Same root grant; the manager resets filter `pssystemid` to its server-derived logical system. |
| `PSSYSSERVICEAPI` | `PSModelDEAccessManager` through `PSModels` | Same root grant and system binding. |
| `PSSYSPFPLUGIN` | Generic cloud manager, entity mode `1` (`SELF`) | A real native READ authority and its effective data range. Root viewer/editor alone is insufficient. |
| `PSSYSSFPLUGIN` | Generic cloud manager, entity mode `1` (`SELF`) | A real native READ authority and its effective data range. Root viewer/editor alone is insufficient. |

Manager selection preserves explicit entity plugins before defaults:
`CORE/libs/ibiz-modeling-core/src/main/java/net/ibizsys/modeling/core/security/SystemAccessManagerBase.java:122`.
The reviewed global Groovy `SystemAccessManagerEx` is an empty subclass.
`PSModels.java:127` registers the middle three entities, not ModelObservation or
either plugin. No corresponding explicit plugin access-manager tag was found
in the reviewed authoritative model. Loaded runtime/plugin identity still needs
live verification.

The relevant exact source locations are:

- Registry:
  `CORE/libs/ibiz-modeling-core/src/main/java/net/ibizsys/modeling/core/util/PSModels.java:127`.
- Three root-model READ checks and filter rewrite:
  `CORE/libs/ibiz-modeling-core/src/main/java/net/ibizsys/modeling/core/dataentity/security/PSModelDEAccessManager.java:38`
  and `:79`.
- Parent system READ:
  `CORE/libs/ibiz-modeling-core/src/main/java/net/ibizsys/modeling/core/dataentity/security/PSDevSlnSysDEAccessManager.java:25`.
- Observation MASTER declaration:
  `PSMODULES/AppStudio/PSDATAENTITIES/ModelObservation.json:3376`.
- PF SELF declaration and its unassigned entity-role definitions:
  `PSMODULES/Config/PSDATAENTITIES/PSSysPFPlugin.json:8487` and `:8069`.
- SF SELF declaration, with no entity-role collection:
  `PSMODULES/SysDesign/PSDATAENTITIES/PSSysSFPlugin.json:4894`.
- Generic capability, assigned-role and range handling:
  `CORE/libs/ibiz-cloud-core/src/main/java/net/ibizsys/central/cloud/core/dataentity/security/DataEntityAccessManager.java:210`,
  `:318`, `:412` and `:539`.
- Scope providers:
  `CORE/libs/ibiz-cloud-core/src/main/java/net/ibizsys/central/cloud/core/dataentity/security/dr/OrgDRProvider.java:65`,
  `CORE/libs/ibiz-cloud-core/src/main/java/net/ibizsys/central/cloud/core/dataentity/security/dr/DeptDRProvider.java:66`
  and `CORE/libs/ibiz-cloud-core/src/main/java/net/ibizsys/central/cloud/core/dataentity/security/dr/DataSetDRProvider.java:35`.

ModelObservation's source is
`PSMODULES/AppStudio/PSDATAENTITIES/ModelObservation.json`.
Its `DERCUSTOM_MODELOBSERVATION_PSDEVSLNSYS_PSDEVSLNSYSID` relation declares
`masterRS=4` (DAC), `DER1N` subtype and pickup `PSDEVSLNSYSID`.
The generic manager's `MASTER` path verifies that input parent matches the
route, then calls the actual parent manager READ:
`CORE/libs/ibiz-runtime/src/main/java/net/ibizsys/central/dataentity/security/DataEntityAccessManager.java:273`.
`PSDevSlnSysDEAccessManager.java:15` accepts the resolved root grant's READ bit.
Therefore the absence of ModelObservation from `PSModels` does not by itself
prove the overview action denies an ordinary root reader.

### Plugin Authorities And Ranges

`CORE/libs/ibiz-cloud-core/src/main/java/net/ibizsys/central/cloud/core/dataentity/security/DataEntityAccessManager.java:318`
combines default entity roles, default user/admin system-role data, assigned
system-role fixed data and genuine `UAADEAuthority` objects. Merely declaring
a role in an entity JSON does not assign it to a user:

- PF plugin declares `ALL_R`, `ALL_RW`, current-department and current-org
  roles, but none is a default role.
- SF plugin declares no `getAllPSDEUserRoles`.
- The reviewed `PSSYSTEM.json` contains only the `WXMP_USERS` system role
  and no plugin data-role mapping. `ROLE_USERS`, a center-owner label or
  `isSystemadmin` alone does not supply missing plugin data permissions.
- An actual superuser can bypass generic plugin checks, but is not an
  ordinary-member positive test and cannot be manufactured for acceptance.

Normal server-side UAA permission loading can emit `UAADEAuthority` from an
assigned native `OPPRIV` permission. The EBSX chain includes registered entity,
permission, READ permission action, valid role-permission link and actual
employee role membership. The RT loader also respects the current employee's
`DCSYSTEMID`; this is not interchangeable with the developer center or the
counted model's logical `PSSYSTEMID`.
See `CORE/ibiz-ebsx-runtime/src/main/java/net/ibizsys/central/cloud/uaa/core/cloudutil/RTJWTCloudUAAUtilRuntime.java:622`
and
`CORE/libs/ibiz-cloud-saas-ebsx/src/main/java/net/ibizsys/central/cloud/saas/ebsx/cloudutil/EBSXCloudSaaSUtilRuntime.java:1060`.
The entity name must equal runtime `PSSYSPFPLUGIN` or `PSSYSSFPLUGIN`; comparison
in `getPSDEUserRoleByRT` is case-sensitive.

The native assignment inputs, not an executable grant or SQL proposal, are:

| Input | Required Native Meaning |
| --- | --- |
| Registered entity | Exact plugin `ENTITYNAME` and corresponding registered `ENTITYID`. |
| Permission | `PERMISSIONTYPE=OPPRIV`, the registered native platform `PSSYSTEMID`, a reviewed range and `ISALLDATA=0`. |
| Permission action | `OPPRIV=READ` linked to that permission, with no write actions. |
| Role and link | Legitimate scoped role in the employee's `DCSYSTEMID`; valid role-permission link. |
| Employee membership | Actual account membership, not a request role header or token edited by the harness. |
| Data range | Must be independently executable by the native provider; the unresolved part is described below. |

This does not yet provide a safe nonzero-count configuration under the
no-blanket-READ constraint:

- Both plugin entities lack an organization/dept authorization field.
  Assigning org/dept READ may pass the boolean capability check but produces
  no range conditions. The generic manager then adds a FALSE authority range.
  A resulting zero is not proof that the root's true plugin total is zero.
- The maintained providers are DATASET, DEPT and ORG
  (`CORE/libs/ibiz-cloud-core/src/main/java/net/ibizsys/central/cloud/core/ServiceSystemRuntimeBase.java:181`).
  UAA's `BSCOPE` is copied to the transient role's `customCond`, but these
  reviewed providers do not consume that property directly. It is unsafe to
  claim that setting `BSCOPE` alone establishes a root-scoped range.
- UAA's dynamic authority DTO does not carry a native dataset reference.
  A new model dataset/role mapping is a policy candidate, not an existing
  account assignment. A dataset based only on caller filter `pssystemid`
  must not be promoted to authorization.
- Renaming an all-data permission while keeping `ISALLDATA=1` remains a
  blanket READ grant. It is not an alternative to the prohibited `ALL_R`.

### Count Inputs

The reader creates five independent filters with server-derived `pssystemid`,
an EQ condition, page zero, size one and count enabled. It retains additional
manager range conditions, authorizes all six decisions first, then executes
the actual `CurSys` datasets and uses `Page.getTotalElements()`.

| Response Field | Model Directory | Physical Model Table |
| --- | --- | --- |
| `sysappcnt` | `PSMODULES/SysDesign/PSDATAENTITIES/PSSysApp` | `T_SRFPSSYSAPP` |
| `sysdecnt` | `PSMODULES/DEDesign/PSDATAENTITIES/PSDataEntity` | `T_SRFPSDATAENTITY` |
| `serviceapicnt` | `PSMODULES/SysDesign/PSDATAENTITIES/PSSysServiceAPI` | `T_SRFPSSYSSERVICEAPI` |
| `pfplugincnt` | `PSMODULES/Config/PSDATAENTITIES/PSSysPFPlugin` | `T_SRFPSSYSPFPLUGIN` |
| `sfplugincnt` | `PSMODULES/SysDesign/PSDATAENTITIES/PSSysSFPlugin` | `T_SRFPSSYSSFPLUGIN` |

Every reviewed `PSDEDATAQUERIES/CurSys/PSDEDQCODES/MYSQL5.json` binds
`T1.PSSYSTEMID` to `#{ctx.datacontext.pssystemid}`. That filter is a count
selector, not an authorization grant. Physical schema selection and the loaded
runtime/model bytes must independently match the current owned root.

## Current-Version Acceptance Evidence

This document adds source analysis only. Earlier controlled-manager tests do
not establish live PF/SF policies. No legal ordinary-actor positive with all
five independently verified nonzero totals is established here.

For the fresh owned run, preserve the normally issued identity, actual
effective authority types, loaded manager classes, route/model/image hashes,
five physical expected totals and unchanged before/after inputs. Do not export
tokens, headers, permission bindings or personal identities into this document.
An HTTP 403 may be a genuine plugin permission result, but first establish that
authentication, grant resolution and exact candidate dispatch reached this
boundary. HTTP 401 does not diagnose plugin authorization.

## Policy Decisions And Blockers

The current fixture source
`scripts/prepare-run-owned-native-nonadmin-fixture.mjs:75` creates six ordinary
actors: A/B editor (`ACCMODE=3`), A/B viewer (`1`) and A/B no-access (no grant).
Its `ROLE_NATIVE_FIXTURE` assignment has no plugin OPPRIV grant and no
administrator flag. Editors/viewers may pass the first four checks only on
their own granted root; the two no-access actors are intended denials before
the count loop. Cross-root actors remain denials. A correct six-actor matrix
does not require all six to succeed, but it still needs a genuine permitted
actor for the five-total positive workflow.

Under the reviewed model and current no-blanket-READ rule, ordinary viewer,
editor, solution owner and center administrator are not proven full positives:
root READ satisfies the first four decisions but does not grant plugin SELF
READ. Legitimate existing scoped authorities could change that conclusion only
after their actual server-issued range and nonzero results are demonstrated.

Before granting anything, choose the intended plugin visibility:

1. Retain current plugin policy. Treat a genuine denied response as correct
   for actors lacking plugin permissions, not as a completed ordinary overview.
2. Approve a separate owned candidate for an exact R05 projection or a native
   actor/root-scoped plugin data role. It must use verified membership rather
   than caller selectors, preserve all other plugin access behavior, and define
   whether totals mean the whole authorized root or only visible plugin rows.

The minimum proposed native grant is two entity-specific READ capabilities
with an actually supported, reviewed root-membership data range, associated
with a normal employee's legitimate role in the correct tenant/system.
No CREATE/UPDATE/DELETE, global role, admin flag or identity rewrite is needed
or justified. The reviewed current metadata cannot yet express that complete
safe range merely by filling a permission form. Establish the owned policy
candidate and grant/revocation flow first; do not invent SQL or cached
authorities to obtain a green response.

## Scheduling Boundary

The parent run reported approximately 14.7 seconds for one full R05
revalidation of the complete model; this source review did not remeasure it.
Multiple guards between issuing and using an approximately 20-second JWT can
consume the token's usable lifetime before the business request. Such HTTP 401
is not evidence of a plugin policy refusal and does not justify granting more
permission.

The current execution plan prioritizes A01 legacy validation on an actually
default-off/non-R05 deployment. Do not remove a serialized R05 declaration
from an R05 stage, disable a required binding, skip current-input guards or
extend JWT validity merely to make the flow pass. R05 must separately satisfy
both the scoped-authorization policy and a measured guarded-request schedule.
Changing only roles or token lifetime is not a complete fix.
