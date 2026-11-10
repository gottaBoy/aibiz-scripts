# Remaining Work Plan

Date: 2026-11-09.

The current bounded status is **5 verified / 25 not fully verified** out of
30 engineering items. The 25 items fall into these execution tracks:

## Track 1: Browser Blocking Paths

1. `M01`: the reviewed Central query is mounted and actually requested. Next,
   implement its owned route and trusted current-member filtering before
   accepting list rows, cross-center denial and empty-state behavior.
2. `M02`: keep the missing PLM todo endpoint explicit as unavailable; provide a
   real owned PLM service or a reviewed unavailable-state contract. Fix the
   ModelDesign MQTT precedence fix now passes real Chinese/English browser
   observations; complete menu-target rendering and analyze the actual entity
   403 responses against intended role grants.
3. `M03`: run browser editor save, fresh-session readback and native restore on
   the current source-bound candidate.
4. `M04`: execute editor/viewer/no-access browser matrices on both roots,
   desktop/mobile, with allowed and denied actions.

These are the immediate implementation gates. No shared port or shared
container is changed before all four tracks produce a bound receipt.

## Track 2: Authorization And Configuration

- `F06` global configuration authorization.
- `A01` malformed/typed/missing root context.
- `A02` same-token revocation and grant-cache rotation.
- `A03` nested session/holder push-pop/error cleanup.
- `A04` service OAuth aliases and delayed-start stabilization.

Existing personal configuration, token expiry and ordinary-role evidence does
not close these dimensions.

## Track 3: PLM Workflow Coverage

- `B01` complete role lifecycle for products, projects, tests, knowledge,
  resources, workload, ideas, sprints, baselines, reports and settings.
- `B02` 73-plugin desktop/mobile success, empty, error, permission and
  persistence states.
- `B03` Development and API Reference browsing/search/execution.
- `B04` PLM-route Data Model and Modeling IDE operations.

Navigation-only receipts cannot close these workflows.

## Track 4: Language And Source Closure

- `L01` classify the historical visible-label inventory.
- `L02` verify visible labels, plugin text and errors in Chinese and English.
- `L03` build localized API documentation bodies, not only navigation labels.
- `D01` complete twelve-component source/dependency/build closure.
- `D02` close source/image/served-byte provenance gaps.
- `D03` produce cross-repository revision/version/generated-code manifest.

The current full scripts regression is tooling evidence, not source closure.

## Track 5: Marketplace And Operations

- `K01` close all 23 catalog source/revision/license bindings.
- `K02` prove no-network catalog/assets installation.
- `K03` prove blocked-network update, recovery and rollback.
- `O01` clean-host offline reconstruction.
- `O02` durable backup, migration and whole-stack rollback.
- `O03` reviewed shared deployment with rollback and served-byte verification.

## Current Coding Changes

- Design-index todo counter now sets `state.myTodoCountStatus` to `pending`,
  `ready` or `unavailable`. Only 404/405 classify as unavailable; 401/403/5xx
  remain visible errors. It never fabricates a zero count.
- The local design-index package build and focused tests pass **4/4**.
- Because the design-index source and distribution changed, the previous
  frontend source receipt is intentionally stale. The full source package,
  type audit, candidate, runtime-asset and isolated-launch chain was rebuilt in
  `OPTIMIZATION-20261109.md`; old receipts remain historical.
- The new readable Central candidate `central-query-20261109-r2` is mounted
  through an explicitly verified GridView/receipt binding in owned input
  reconstruction. The vendor model tree was not rewritten. It remains
  unaccepted because the real dataset returns 404 and row isolation is open.
- The isolated and owned input contracts now support that explicit binding and
  guard the candidate receipt plus GridView bytes. Fresh runtime replay confirms
  the revised native FETCH is requested; its actual 404 is retained as failure.
- Full current-source regression r6 passes **4919/4919**, zero skips and stable
  source. Failed r4/r5 receipts remain retained; integrity tests keep the full
  freshly rebuilt source and plugin bindings rather than removing them.
- A minimal opt-in MQTT precedence fix is now implemented in both editable web
  framework trees: an explicit boolean deployment value can be reapplied after
  model `userParam` loading. The fresh browser policy receipt passes both
  languages with real model=true/deployment=false/effective=false and no
  WebSockets in each 5s sample; collaboration transport is separate.

## Acceptance Rules

- A candidate receipt is not runtime acceptance.
- A passing unit or build test is not browser acceptance.
- Empty data is not a successful API response.
- No synthetic headers, tokens, permissions, counts or route responses.
- Failed receipts remain immutable and are referenced by newer evidence.
