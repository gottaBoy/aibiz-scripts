# Native System Read Contract

Checkpoint: 2026-11-15, Asia/Singapore. R02 source and model audit only.
No live request, HTTP runner, Docker, SQL, shared model/backend byte change
or deployment was performed. This does not close R02 or a top-level task.

## Decision

No existing reviewed published action provides a minimal, root-authorized
system-details/settings projection. Do not grant blanket `PSSYSTEM.READ`,
add PSSYSTEM to the generic model-instance registry or return the full DTO
to obtain a successful default view.

The existing `/appdata?psdevslnsys={root}` source projection can provide
`srfmodelcontext = { psdevslnsys, pssystemid }` through normal authentication
and root resolution. It is routing metadata only. Its source/unit evidence
does not establish current-version native HTTP acceptance, system-details
READ, settings writes or same-token grant revocation.

## Actual View Requirements

All paths below are relative to the authoritative Modeling model root
`vendor-upstream/ibizmodeling-standard/modelapi-core/src/main/resources/model/net/ibizsys/modeling/`.

| View | Actual Loader | Actual Display/Input |
| --- | --- | --- |
| `PSSystemDashboardView` | PortalViewEngine.onMounted calls shared `loadEntityData`, which hardcodes entity action `get`; PSSYSTEM DTO becomes active view data | Also loads independent modeling chart/list/counter/dashboard resources. Their contracts remain separate. |
| `PSSystemDashboardView_SysInfo` | Same outer PSSYSTEM Get; additionally embeds PSDevSlnSysInfoView/Info form using PSDevSlnSys.Get | Eleven displayed root-info fields: PSDEVSLNSYSNAME, LOGICNAME, CODENAME, PSSFNAME, SYSVER, SYSTYPE, PSDCMODELTEMPLNAME, SYSTAG, SYSTAG2, DBTYPES, MEMO. |
| `PSSystemSettingInfoView` | Edit form `SettingView` calls PSSYSTEM.Get | `infoFormMode=true`; 22 setting values are SPAN controls. Its configuration action opens the separate drawer below. |
| `PSSystemSettingCfgView` | Edit form `Setting`, Get then ordinary Update when saved | Adds DTOFORMAT, SCRIPTENGINE, CODENAMEMODE, ENABLEPQL, PSSYSENGINECFGNAME and hidden PSLANGUAGEID/CLEMPTYTEXTPSLANRESID. SAASMODE and ENABLEDYNASYS controls have enableCond=0. |

The 22 settings-info fields, in the actual source form order, are:

```text
ENABLEMULTILAN PSLANGUAGENAME DEFSORTMODE DEEXPMAXROWCNT
SERVICEAPIFLAG ACCCTRLARCH ENABLEOPNAMEMODEL SAASMODE
ENABLEDYNASYS INITDEDEFAULT DEMSACTIONLOGICFLAG SSDEMSACTIONLOGICFLAG
PUBDBMODELFLAG NOVIEWMODE ENABLEDBVALUEMODE ENABLEDERFKEY
DEFSFITEMWIDTH PIAUTOSHOWCAPTION CLEMPTYTEXT CLEMPTYTEXTPSLANRESNAME
MODELV2EXPMODE BUGFIXS
```

Forms also bind PSSYSTEMID, PSSYSTEMNAME and UPDATEDATE through hidden
identity/audit aliases. Hidden/display fields and a configured Update
handler are not a server field-write policy. The language and empty-text
resource pickers bind separate ID fields, so a future write must resolve
and authorize IDs; accepting a display label as a trusted relation is not
equivalent. The outer three views still have a source hardcoded template
PSSYSTEM context; the private dynamic-context overlay remains separate.

## DTO And Scope

PSSYSTEM.Get returns PSSystemDTO, and FetchDefault returns a page of the
same DTO. The source DTO includes DSL, DATA, USERPARAMS, SYSFOLDER,
SYSROWKEY, deployment/engine/source-system references and many generator/
service/access-control flags. Those fields are unnecessary for a minimal
identity summary. Arbitrary DSL/data/custom-parameter text is not presumed
credential-free merely because a field is not named password.

The reviewed PSSystemDTO and PSSystem entity do **not** declare a direct
password, username or connection-string field. This audit does not invent
one or claim a runtime credential leak from that DTO.

The embedded PSDevSlnSys.Get is a separate concern. Its source DTO includes
CONNSTR and DBNAME although the Info form does not display them, plus
model-instance, repository and deployment references. Narrowing only
PSSYSTEM still leaves this overbroad child request. Actual connection/
username/password use is independently demonstrated in
`ModelSysDBSchemeRuntimeBase.fillDataSource`: it calls `getConnStr`,
`getUserName` and `getPassword` on the resolved model instance and passes
them to the datasource. A summary must never serialize the model-instance
DTO or recursively expand those references. Source annotations alone are
not proof of the complete runtime entity-bag serialization.

`PSSystem.GetCur` exists as an `enableFront=false` backend DELOGIC and
returns PSSystemDTO after another full Get. The reviewed ModelDesign
entity and ModelAPI do not publish that PSSYSTEM action. It is neither an
available narrow endpoint nor a safe substitute for the denied lookup.

## Why Generic READ Denies

PSSYSTEM's source `dataAccCtrlMode=1` is SELF, with no embedded operation
privileges or entity user roles. It is absent from the default
model-instance registry and the Modeling manager's dedicated switch.
The factory first checks a runtime plugin named `PSSystemDEAccessManager`;
an actual configured override must be audited. In the default path, it
falls through to the generic cloud manager, which requires matching READ
roles and rejects an empty role list before adding data conditions.

Thus a root grant's READ bit does not automatically grant generic
PSSYSTEM.READ. The prior real ordinary-editor FetchDefault 403 is
consistent with this source path, but does not prove the active runtime
plugin/role registry for every deployment. Global/UAA administrator
membership must not be used as a replacement for a reviewed root policy.

The generic manager combines default entity roles, all-user system roles,
system-admin roles, assigned fixed roles (CAT1/system-reserved), and
runtime `UAADEAuthority` objects with an exact entity name/action list and
optional scope. The system manager also resolves `UAARoleAuthority` and
tested dynamic system roles. Those tested-role results are cached using
authentication username/token and employee `dcsystemid`. Empty embedded
roles therefore do not prove the absence of effective runtime grants, and
a generic READ may itself populate an authorization cache. A candidate
review must bind these actual authorities, plugins, role models and cache
behavior rather than infer them from a UI role label.

## Minimal Proposal

The following paths are **proposed, not implemented or published**:

1. `GET /api/ibizmodeling__modeldesign/psdevslnsys/{root}/systemsummary`
   returns exactly `psdevslnsys`, `pssystemid`, `pssystemname`,
   `psdevslnsysname`, `codename`, `logicname`. Build this typed projection
   from the already root-authorized IPSDevSysUser, not a full system Get.
   The manager populates these labels from the selected root record.
   In particular its current PSSystemName is the selected root name,
   not independently loaded logical-system metadata. Do not label the
   repository's ModelInstVer as the logical system's MODELVER.
2. `GET .../psdevslnsys/{root}/systemsettings` returns only the root,
   logical ID/name, concurrency stamp and the reviewed 22 settings-info
   values. This requires an explicitly root-bound internal settings read
   and new typed DTO; a generic full DTO returned to the client and then
   filtered is not acceptable. The extra editor fields need their own
   explicit profile rather than silently extending the info response.

Proposed role split:

| Role | Summary | Settings Read | Settings Update | Runtime/Deployment/Credentials |
| --- | --- | --- | --- | --- |
| Root reader | Exact typed projection | Proposed exact info profile after policy/runtime verification | Denied | Not implied |
| Root editor | Same projection | Same read profile; a reviewed editor profile may add required inputs | Requires root model-write grant plus a new explicit field/value/relation/effect policy | Not implied |
| Missing/expired/foreign-root grant or mismatched actor/center | Denied | Denied | Denied | Denied |

The reviewed write allowlist is currently empty. UI availability, an
integer flag or a root-editor label does not prove that changing access
architecture, service API mode, SaaS/dynamic-system flags, scripting,
database generation or engine references has only model-local effects.
Before accepting writes, trace each setter and generated/runtime effects,
validate exact code-list values and root-bound references, enforce an
optimistic concurrency token, and verify physical/model-version/audit
changes plus rejected-write immutability. Never reuse unconstrained
Create/Save/Update DTO binding for the narrow endpoint.

## Implementation Gates

- Reuse the validated current root grant and actor/developer-center
  consistency checks from `prepareModelContext`; do not trust client
  logical IDs or copy arbitrary principal/configuration objects.
- Keep generic PSSYSTEM APIs and administrative privileges unchanged.
  Bind new service operations to the selected library/datasource before
  any internal read. Audit runtime overrides separately.
- Adapt authoritative view/service metadata or an explicitly declared
  loader contract. Current PortalViewEngine hardcodes `get`, so adding a
  new endpoint alone does not stop full DTO requests. Both outer portal
  loads, the root-info child and settings-info/editor reads need coverage.
- Preserve server-derived identity aliases only in an adapter; do not
  rewrite stored IDs or manufacture controller state/HTTP responses.
- Run real role/root/language/viewport flows, expiry/relogin/root-switch/
  disposal, response-shape/no-secret checks and complete side-effect
  snapshots. A02 same-token revocation remains an independent gate.

Reusing the pure `prepareModelContext` field-selection rules is not the same
as declaring all `/appdata` execution side-effect free. Its surrounding
`onGetAppData` contains a `modelautoupgrate` branch that can enqueue
`X_ADDUPGRATESYSMODELTASK`. That configuration and actual effects need
candidate binding and observation. A new summary should not invoke an
unreviewed upgrade/build/publish path as a shortcut to metadata.

## Pure Evidence

`native-system-read-contract.mjs` records observed/proposed field profiles.
Its access-plan function always returns `allowed=false`: role eligibility
is design metadata, not executable authorization. Its strict proposed
summary validator is a response-schema check only and rejects unknown
fields instead of silently discarding them. It is not a production filter.

Tests bind twelve source inputs by SHA-256 and parse actual forms, DTOs,
methods and authorizer source. Reproduce without services:

```sh
node --test scripts/tests/native-system-read-contract.test.mjs
```

Manual requirements: the PLM manual does not define this native Modeling
system projection. Current-version acceptance evidence remains the prior
failed generic READ probe plus the separate source/unit bootstrap work.
No new usable system-details/settings capability is claimed here.
