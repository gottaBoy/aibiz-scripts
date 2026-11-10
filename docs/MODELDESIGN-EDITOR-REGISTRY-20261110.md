# ModelDesign Editor Registry Diagnosis

Date: 2026-11-10, Asia/Singapore

## Recorded Failure

Browser receipt:
`.artifacts/owned-native-modeldesign-browser/optimization-zh-20261109-r1/report.json`

Actor: `nf_96ff5681e447_a_e`, ordinary non-admin editor.  
Root: `nf_96ff5681e447_root_a`.

The same browser receipt records successful native application bootstrap,
token refresh, `PSMODULE/fetchcursys` and `PSDATAENTITY/fetchcursys`. Five
editor lists return authenticated HTTP 403:

| Entity | Native Action | Current Registry | Existing Local Mapping |
| --- | --- | --- | --- |
| `PSSYSDBSCHEME` | `fetchcursys` | Missing | `T_SRFPSSYSDBSCHEME` |
| `PSSYSAPP` | `fetchcursys` | Missing | `T_SRFPSSYSAPP` |
| `PSSYSSFPUB` | `fetchcursys2` | Missing | `T_SRFPSSYSSFPUB` |
| `PSSYSSERVICEAPI` | `fetchcursys` | Missing | `T_SRFPSSYSSERVICEAPI` |
| `PSSUBSYSSERVICEAPI` | `fetchcursys` | Missing | `T_SRFPSSUBSYSSERVICEAPI` |

All five published ModelAPI methods require `READ`, not `MANAGE` or another
higher privilege. Their source entity models use SELF data access control.

## Rejection Path

The maintained registry is:

`ibiz-service-hub/libs/ibiz-modeling-core/src/main/java/net/ibizsys/modeling/core/util/PSModels.java`

It registers 21 unique model-instance entities. `PSMODULE` and `PSDATAENTITY`
are present; all five failing entities are absent from both the model and
configuration registries.

`SystemAccessManagerBase.createDataEntityAccessManager` selects
`PSModelDEAccessManager` only when `PSModels.isModelInstDataEntity(name)`
matches, after explicit plugin/special entity checks. A missing entity falls
through to the generic cloud data-entity access manager.

The model access manager directly implements the native root authorization
path: trusted `PSDEVSLNSYS` AppContext, `getPSDevUserBase("SYS", root)`, exact
authorized root, nonexpired grant and READ bit. It canonically rewrites the
logical system field only after authorization.

The generic cloud manager instead asks `getPSDEUserRoles` for the employee's
entity READ capability and returns false when that list is empty. The owned
ordinary role is not a substitute for that generic per-entity capability.
Its rejection occurs before the list query runs. Increasing the owned
editor grant or impersonating an administrator would not repair this
misclassification.

The browser and direct PSMODULE CRUD requests both carry the root in the
native `/psdevslnsys/{root}/...` parent URL. The browser's immediately
successful module/data-entity requests argue against a missing common root
or authentication context. The five missing registry entries explain the
different authorization strategy despite identical READ actions.

This is a source-level causal diagnosis supported by recorded HTTP results,
not an instrumented observation of the live manager class. The browser
receipt does not retain request headers or the 403 response bodies. A final
runtime diagnosis should bind the selected manager class and actual error
body before claiming that every possible runtime override is excluded.

## Existing Full Local Source

The full local mapping already exists at:

`modelingservice/src/ibiz-modeling-core/net/ibizsys/modeling/core/util/PSModels.java`

That file is explicitly marked CFR-decompiled. It contains 387 unique
model-instance entries, including the exact five mappings above. Relative
to the maintained registry, 371 of those entries are missing. This is
evidence of an incomplete maintained-source reconstruction, not
authenticated original-source provenance.

Do not blindly infer all tables as `T_SRF + name` or copy the file without
review. The local source has six `V_*` view mappings, aliased constants such
as `PSDEUTIL = "PSDEUTILDE"`, and a literal trailing space in
`"T_SRFPSDELISTLOGIC "`. The diagnostic preserves those bytes and reports
review warnings; it does not silently normalize them.

## Minimal Repair

In a new reviewed source build, restore the five explicit model-instance
registrations and the missing constants from their existing local mappings.
Keep `SystemAccessManagerBase`, root grant policy, EmployeeContext transport
and the model's READ action unchanged.

Do not add ordinary users to administrator groups, create unrelated fine
grants, bypass `PSModelDEAccessManager`, map the requests to another API,
change 403 to 200 or return placeholder/empty lists.

Before promoting a broader registry restoration, independently review
model/config/metadata classification and exact table/view names for every
additional entity.

## Verification

Independent static diagnostic:

```sh
node scripts/diagnose-modeldesign-editor-registry.mjs \
  --browser-report=.artifacts/owned-native-modeldesign-browser/optimization-zh-20261109-r1/report.json \
  --output=.artifacts/modeldesign-editor-registry-20261110-r1

cd scripts
node --test tests/modeldesign-editor-registry-diagnosis.test.mjs
```

Evidence:
`.artifacts/modeldesign-editor-registry-20261110-r1/report.json`

Result: **7 source-contract tests passed / 0 failed / 0 skipped**. These
tests characterize the current missing registry entries and will need an
explicit expectation update when the production registry is repaired.

Required real verification after repair:

1. Compile the actual factory with real model objects and prove all five
   select the intended root access manager. Preserve missing/malformed root,
   foreign root, wrong person, zero/negative/expired grant and viewer
   write-denial tests.
2. Use a fresh owned build/image/fixture receipt. Exercise editor and viewer
   READ, no-access denial and cross-root denial on all five native datasets.
   Positive lists need real owned sentinels, not successful empty arrays.
3. Compare complete physical projections before/after every observation.
   Permission classification does not prove the full table/schema fixture
   is ready; missing schema must fail explicitly rather than be hidden.
4. Repeat actual editor load, save, new-session readback and restore in both
   languages. A list READ does not accept save or every IDE capability.

This subtask made no production-source, existing-script, grant, fixture,
database, container or shared-port change. It sent no HTTP request and made
no native, permission or release acceptance claim.
