# Five Native Dataset Sentinels: Read-Only Design

Date: 2026-11-11

## Scope

`scripts/native-five-dataset-contract.mjs` exports
`readNativeFiveDatasetContract({ workspace })`. It reads and SHA-binds 35 actual
native model/action/query/schema/runtime files plus the source dump. It emits
no SQL seed, performs no HTTP or Docker operations, and does not inspect or
write a fixture database. Its eight focused tests pass against the real local
source. The DEFAULT/DB2/DB3 model merge contains 424 physical tables.

The five entities all have published original nested PSDevSlnSys Create,
Remove and the requested fetch methods. Prefer authenticated owner native
CREATE and native DELETE over SQL-initialized rows. All five have
`logicValid=false`, but real physical removal and lifecycle effects still need
actual guarded snapshots.

This is source-contract evidence, not actual five-entity initialization,
native editor, CRUD or permission acceptance. Existing generators, backend
source, fixture `25dd6a7232c7`, other fixtures and containers were not changed.

## Routes And Input

All five use this gateway collection prefix:

`/api/ibizmodeling__modeldesign/psdevslnsys/<actual-root-id>/`

| Entity | Collection | Dataset |
| --- | --- | --- |
| PSSysDBScheme | `pssysdbschemes` | `fetchcursys` |
| PSSysApp | `pssysapps` | `fetchcursys` |
| PSSysSFPub | `pssyssfpubs` | `fetchcursys2` |
| PSSysServiceAPI | `pssysserviceapis` | `fetchcursys` |
| PSSubSysServiceAPI | `pssubsysserviceapis` | `fetchcursys` |

- CREATE: POST the collection, DTO input and actual DTO output, CREATE access.
- FETCH: POST the collection/dataset, filter DTO input and PAGE result, READ.
- REMOVE: DELETE collection/receipted-key, KEYFIELDS input and VOID result,
  DELETE access. Remove one owned key, not a synthesized batch.

All fetch queries are DB2 and constrain `t1.PSSYSTEMID` using
`ctx.datacontext.pssystemid`. Supply:

```json
{ "pssystemid": "<root.logicalSystemId>", "page": 0, "size": 1000 }
```

The developer root ID in the path is not the logical system ID in the body.
Both fixture roots intentionally share a logical system ID; the path/auth
binding and physical database, not a different body system ID, establish the
two-root distinction.

SFPub CurSys2 additionally requires `PPSSYSSFPUBID IS NULL`. A child publication
row is not a valid sentinel for that dataset. Do not switch to fetchcursys to
make an incorrect row appear.

## Source-Bound Payloads

Each entity should receive its own fresh case UUID or accept and journal the
actual native returned ID. Use a unique side/entity/nonce-specific name and
`usertag` marker. Names and IDs must be receipted before mutation; a response
alone is not proof that the intended physical database was used.

Common body fields:

```json
{
  "<entity-id-field>": "<fresh-case-id>",
  "<entity-name-field>": "<unique-owned-display-name>",
  "pssystemid": "<actual-root-logical-system-id>",
  "pssystemname": "<actual-root-physical-system-name>",
  "usertag": "<run-side-entity-nonce-marker>"
}
```

| Entity | ID / Name | Additional Native Input |
| --- | --- | --- |
| PSSysDBScheme | `pssysdbschemeid` / `pssysdbschemename` | `dslink:"DEFAULT"` |
| PSSysApp | `pssysappid` / `pssysappname` | unique identifier `apppkgname`, observed real `pspfid`, `pspfstyleid`, actual `psapptypename`; observed `psapptypeid` recommended |
| PSSysSFPub | `pssyssfpubid` / `pssyssfpubname` | `ppssyssfpubid:null` |
| PSSysServiceAPI | `pssysserviceapiid` / `pssysserviceapiname` | unique identifier `codename` at most 40 characters, `apitype:"RESTFUL"`, `validflag:1`, `ver:1` |
| PSSubSysServiceAPI | `pssubsysserviceapiid` / `pssubsysserviceapiname` | unique identifier `codename` at most 60 characters, `apitype:"RESTFUL"`, `validflag:1`, `apisource:"NONE"` |

These constants come from the original SysDeployDBMode/ServiceAPIType code
lists and native field defaults, not copied dump rows. For API code names, use
an ASCII letter followed by letters/digits/underscores. Native duplicate
checks remain enabled; do not reuse a prior attempt's code/name.

SysServiceAPI VER is a required physical field without a source default.
SubSysServiceAPI VER is not required, so it is not invented as a minimum.
DBScheme and SubSysServiceAPI PSSYSTEMNAME are required physical fields.

The SFPub PSSFSTYLENAME display field is nonphysical (`dEFType=3`), despite its
allow-empty flag. Native `isCheckField` explicitly skips nonphysical fields.
PSSFSTYLEID itself is optional. Do not invent a style row/name just to satisfy
the display-field flag.

### Application Config Is A Real Blocker

PSSysApp has physical required PSPFID, PSPFSTYLEID and PSAPPTYPENAME fields.
PSAPPTYPEID itself is optional, but supplying it requires an actual record.
Observe native config through the original read methods under the owned
context, after backend readiness:

- POST `/api/ibizmodeling__modeldesign/pspfs/fetchdefault`
- POST `/api/ibizmodeling__modeldesign/pspfstyles/fetchdefault`
- POST `/api/ibizmodeling__modeldesign/psapptypes/fetchdefault`

These config entities use DEFAULT metadata storage, not the selected DB2
model database. Select a real platform/style/type association. Require
`style.pspfid == platform.pspfid` and the platform's actual app-type ID/name;
respect the actual style center/shared scope. Preserve the config response
and source-account/appdata binding in the execution receipt.

An empty or denied config response does not authorize fabricated IDs or a
schema-only pretend platform. The helper marks native App creation blocked
until this real config is observed. Its templates deliberately contain
unresolved `$OBSERVED_*` values, which must never be sent literally.
Model `getAllPSModelDatas` contains editor/view metadata, not configured
platform rows; it is not seed data.

If four native CREATEs pass while App lacks config, report four initialized
entities and App blocked. Do not claim a full 60-cell matrix using empty
responses, or relabel a direct SQL SELECT sentinel as native App CRUD.

## Query Dependencies

All listed joins are LEFT JOINs. Tables and every selected/join/predicate
column must exist in the selected physical schema, but optional matching rows
are not required just to return a primary sentinel row. The existing model
schema plan contains these dependencies; no extra columns were guessed.

| Main Table | Joined Tables |
| --- | --- |
| `t_srfpssysdbscheme` | `t_srfpssysdynamodel`, `t_srfpsmodule`, `t_srfpssysmodelgroup`, `t_srfpssyssfplugin` |
| `t_srfpssysapp` | `t_srfpssysserviceapi`, `t_srfpssyssfpub`, `t_srfpssystem`, `t_srfpssysdynamodel`, `t_srfpspf`, `t_srfpsctrllogicgroup`, `t_srfpspfstyle`, `t_srfpssyssfplugin` twice, `t_srfpssysresource` |
| `t_srfpssyssfpub` | itself for parent publication, `t_srfpssysdynamodel`, `t_srfpssfstyle` twice, `t_srfpssystem` |
| `t_srfpssysserviceapi` | `t_srfpssyssahandler`, `t_srfpsmodule`, `t_srfpssysdynamodel`, `t_srfpssyssfplugin` twice, `t_srfpssysresource`, `t_srfpssystranslator` |
| `t_srfpssubsysserviceapi` | `t_srfpssysserviceapi`, `t_srfpssyssfplugin` twice, `t_srfpssyssahandler`, `t_srfpsmodule`, `t_srfpssysdynamodel` |

The five original dump tables require only their primary key at SQL NOT NULL
level, with no other unique or foreign-key constraint. That is weaker than
native validation. The helper exposes both the original DDL requirement and
native required physical fields so a future reviewer cannot confuse them.
It emits no SQL DML, and this design does not authorize SQL initialization.

## Return Evidence

For each allowed response verify the actual entity ID, unique name,
`pssystemid`, run marker, and supplied distinguishing values such as DSLINK,
APIType/CodeName or AppPKGName. Compare with the same row's full-column
physical snapshot. An empty array does not establish any dataset capability.

The helper's `returnProjection` lists actual SELECT fields and native SQL
expressions, while `modelExpressionsNotSelected` lists model expressions that
are not returned by this specific query. Do not require a nullable field to
appear merely because the method DTO defines it.

- App `pssystemname` comes from `t31.PSSYSTEMNAME` in the real system join.
- SFPub `pssystemname` comes from `t41.PSSYSTEMNAME` in the real system join.
- DBScheme, SysServiceAPI and SubSysServiceAPI use their primary table's
  PSSYSTEMNAME column, not a system join. It is a denormalized value, not
  independent proof of correct physical routing.
- DBScheme SCHEMEPARAMS, App BOTTOMINFO/HEADERINFO/PFSTYLEPARAM,
  SysServiceAPI IGNOREAUTHPATTERNS/SERVICEPARAMS, and SubSysServiceAPI
  ADDDEPARAMS/AUTHCODE/METHODCODE/SERVICEPARAMS are model expressions but
  absent from the actual listed SELECTs. Do not fabricate their return values.

For six actors/two roots/five routes, the intended READ policy yields 20
allowed cells (two own editor/viewer actors per root times five) and 40
denied cells. Each denial must be actual 403 with no foreign sentinel data
and no physical mutation; 401/404/500 and transport failures do not count.
No-access actors must not receive the owner's row merely because the
collection route exists.

## Native Lifecycle And Cleanup

Source lifecycle hooks explicitly call:

- `onAfterCreate`: change notification, system-model log, system MODELVER,
  DB-version tracking and `syncSysTask`.
- `onBeforeRemove`: system-model log, MODELVER, DB-version tracking and task
  synchronization.
- `onAfterRemove`: change notification.

All five are mapped to `sysModelVerMap` through PSSYSTEMID and are in
`sysModelLogMap`. DELETE also attempts model-folder-item deletion by exact
PSOBJTYPE/PSOBJID. Cascading child relationships must be audited, especially
for application/publication models.

Therefore native create/delete cleanup does not mean byte-identical full DB
restoration. Keep the fixed baseline module/system identity rows and every
unrelated column intact. Record exact observed version/log/folder/task
effects, with explicit ownership and bounded allowances, and retain original
evidence. Never SQL-reset MODELVER, delete arbitrary logs, or overwrite the
fixed module authorization-matrix baseline to conceal native effects.

Journal all intended UUIDs before CREATE, bind any native returned key, and
use owner nested DELETE only when key/root/marker/name/system still prove
ownership. A failed CREATE/cleanup or unknown side effect remains a failed
gate; it does not authorize a fallback DELETE or row seed. Reverse cleanup
order for explicit cross-sentinel references; preferably leave optional
cross-references unset so each case remains independent.

## Read-Only Use

```sh
node scripts/native-five-dataset-contract.mjs
node --test scripts/tests/native-five-dataset-contract.test.mjs
```

The first command prints the source-bound contract, not a runnable mutation
plan. There is no execution flag, service URL, run selection, seed input or
implicit container/database target.
