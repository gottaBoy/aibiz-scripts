# Embedded Modeling IDE Follow-Up

Date: 2026-11-16, Asia/Singapore.
Status: **FIXED-SOURCE-NOT-DEPLOYED**.
Record: [aibiz-embedded-modeling-20261116.json](../records/aibiz-embedded-modeling-20261116.json).
This is an incremental investigation after the
[APPINDEX-only baseline](BASELINE-20261116.md), not a replacement of that
immutable baseline or an acceptance of the shared deployment.

## Findings

| ID | Local Observation | Result |
| --- | --- | --- |
| EIDE-01 | PLM's Modeling IDE tab embeds `32009/modeldesign`. Its console automatically opens without a usable header and covers the entire editor. Normal Escape reveals the existing system/entity/UI/workflow menus and real entity tree. | Source fixed: defer only the exact bottom-console default inside an iframe; preserve the original model flag, permissions and manual menu. Direct IDE defaults remain unchanged. |
| EIDE-02 | The native footer reserves 21px while the host menu requires 42px buttons plus padding. The unbounded index also lets a long entity tree push the footer outside the iframe. | Source fixed: clone only the recognized 21px footer to 50px; bound the index viewport and layout content. Custom dimensions and ambiguous layouts remain unchanged. |
| EIDE-03 | Shared `32009` still binds the November 7 candidate, not the newly source-tested candidate. Its actual appdata response has no `srfmodelcontext` projection. | Not deployed or accepted. Do not invent header values, model IDs, permissions or a successful projection to conceal this difference. |
| EIDE-04 | Naturally opening an entity reaches its dashboard, but `GET /psdevslnsys/{root}/dynadashboards/{personal-key}` returns 500. Backend logs show a valid query with zero rows followed by a missing-record exception, not a missing-table/Unicode diagnosis. | Source fixed: both maintained runtime paths now treat the exact missing-record response as an empty first-use layout without an initialization write. Shared backend still returns 500 and the new candidate has not been deployed; non-missing 500/permission errors still surface. |
| EIDE-05 | `GET /portal/markopendata/{entity}/{key}/VIEW` returns 404. The corresponding portal controller exists, but existence does not prove this deployment's routing, service discovery or authorization. | Open. Trace and verify the exact portal route and service identity; do not add a generic fallback or return a fake empty response. |
| EIDE-06 | Entity initialization attempts `POST /dynadashboards/save` without an explicit user save. The diagnostic policy blocked that request before dispatch. | Source fixed: missing dashboard reads no longer call `saveCustomModelData([])`. Shared deployment still remains on the old candidate, so live no-write behavior must be revalidated after rollout. |
| EIDE-07 | MQTT is explicitly disabled. Complete native CRUD, persistence, all roles and full mobile layout have not been accepted. | Still open. The console remains honest about disabled MQTT. This layout fix does not complete those capabilities. |

## Evidence

The shared-page diagnostic used normal UI login, normal Escape and real menu
clicks. It did not inject a token, controller or projection, force clicks,
alter a shared file, restart a service or issue SQL.
The original page's PLM pre-authentication 401 and navigation-guard console
error are preserved, not filtered out of the reports.

The source preview substituted only the two recorded static plugin resources
in that browser: the built index module and stylesheet. All application models
and API responses still came from the real shared services. This is
**controlled source-preview evidence, not proof that the shared URL is fixed**.

The final layout preview shows the entity tree on entry, the console menu
inside the initial 896px-high iframe (bounds 862..880), and a normal manual
open/close. It also traverses the system/entity menus. The subsequent entity
entry deliberately remains failed because of EIDE-04/EIDE-05 and the blocked
automatic save. Earlier exploratory locator failures are retained privately.

Focused regression passed **180/180**, with zero failures, cancellations,
skips or TODOs. The total includes eight controlled real-host command/drawer
browser cells: embedded/direct × zh-CN/en-US × desktop/mobile. It does not
measure the complete real IDE layout or CRUD flow.

```sh
node --test --test-concurrency=2 \
  scripts/tests/dashboard-missing-record.test.mjs \
  scripts/tests/local-design-index.test.mjs \
  scripts/tests/native-model-design-index-integration.test.mjs \
  modelingweb/local-plugins/design-index/tests/permitted-menu.test.mjs \
  modelingweb/local-plugins/design-index/tests/todo-counter.test.mjs \
  modelingweb/app/tests/console-drawer.browser.mjs
```

The dashboard missing-record contract adds four source-level tests across the
maintained Hub and Modeling snapshot runtimes: missing data returns empty state
without a write; non-missing failures remain visible and do not fall back.
Those runtime source commits are Hub `392a67ea18bbb794f1de6779b3deaf8d6c4fdfe0`,
Modeling `7d4565b69a8c64f17870c60da32bd2f4f4e23e25`, and the metadata/test
record is bound to Scripts `965f5dc701cf80e9fc8af4cefe79cf37cd6d56ee` before
its later seal.

The PLM E2E specification now requires a visible initial workspace, an
in-viewport console menu and normal manual close. Its TypeScript syntax was
checked, but the full live specification was **not** marked passing against
the unchanged old deployment.

## Remaining Gates

1. Review a rollback-bound frontend delivery for the actual embedded origin.
   Do not edit the old read-only candidate directory in place, overwrite the
   existing baseline or deploy the entire newer candidate merely for this fix.
2. In one owned environment, verify the missing-dashboard contract and exact
   portal routing, with ordinary authentication and negative cases. Stop
   automatic configuration writes after failed reads; do not suppress errors.
3. Validate a real entity lifecycle through form/editor, save, fresh-session
   readback and restricted roles before promoting native functionality.
4. Repeat the actual embedded zh/en desktop/mobile workflows and served-byte
   checks after a reviewed rollout. MQTT delivery is a separate gate.

Canonical B04/M03/M04/O03 remain partial/open. No new top-level completion count
is introduced.

The final resource comparison remains **12 shared services / 18 image IDs /
zero owned or historical containers**. All shared lifecycle/configuration
rows and 33 declared host inputs match the pre-diagnostic observation.
This is not a whole-database/cache state-invariance claim.
