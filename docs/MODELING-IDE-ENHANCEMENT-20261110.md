# Modeling IDE Enhancement

Date: 2026-11-10, Asia/Singapore.

## Delivered Scope

This enhances the actual source-derived ModelDesign candidate, not a separate
demonstration IDE or the unused independent single-action editor. Original
alpha90 compatibility, native permission acceptance and production deployment
remain unverified.

The maintained overlays under
`modelingweb/local-plugins/model-design/enhancements/` provide:

1. JSON-object validation and finite-number checks. Arrays, null, primitives,
   malformed JSON and non-finite values cannot be imported.
2. Formatting and bounded 50-step undo/redo history, with branch/reset behavior.
3. Structured changes against the loaded baseline, with escaped JSON-pointer
   paths, additions/removals/replacements, bounded previews and an explicit
   truncated state. Prototype-named keys remain ordinary data.
4. JSON download without a server mutation.
5. Unsaved-close/reload confirmation, including native modal dismissal hooks.
6. A fresh ExportModelV2 comparison before ImportModelV2; a changed server
   model blocks import and retains the local draft.
7. ExportModelV2 readback after import. Only matching persisted data earns
   "saved and verified" and automatic close. A committed import with failed or
   inconsistent readback remains visibly unverified, while retaining the
   refresh obligation for that already committed operation.
8. Chinese/English status, actions, errors and conflict/discard messages;
   responsive icon toolbar and a readable desktop/mobile change panel.

The existing native action now recognizes boolean true and string "true" as
readonly. Direct save and history/edit commands are guarded as well as their
buttons. Unmount/readonly transitions prevent late mutation dispatch, UI
updates, success notifications and dismissal.

## Important Limits

- The current native import API offers no bound revision/CAS argument here.
  Export/compare detects an already changed baseline, but another writer can
  still race between preflight and import. This is not an atomic lock.
- The validation badge means a valid JSON object, not semantic model/schema
  validation. Entity constraints, reference integrity and model compilation
  still need their actual platform APIs.
- Download and change display do not bypass the service's original entity key,
  navigation context, srfmodelv2scope or backend permission checks.
- An import already dispatched cannot be cancelled by component destruction.
- Multiple-model workspace editing, schema assistance, dependency navigation,
  graphical ER/logic editing and collaborative version control remain later
  native-IDE integration/acceptance work, not claims about this delivery.
  Existing independent plugins and local source are not assumed absent merely
  because they have not passed this native workflow.

## Build Binding

`patchCandidateSources` still verifies and applies the pinned upstream
adaptations, then overlays the maintained IDE modules and records their hashes.
`builderInputs` includes all four enhancement files. The vendored source tree
is not modified; all eleven native UIAction registrations remain present.

Final current source candidate:
`.artifacts/native-model-design-local-candidate/ide-20261110-r4/report.json`.

It passed strict typecheck, complete declared CLI/declaration build, resource
copy verification and two-build reproducibility. Source/build success remains
distinct from native runtime acceptance. Earlier r1/r2/r3 candidates are retained,
but must not be substituted for the final current recipe.

## Verification

Source tests execute the actual patched view/provider with real Vue reactivity,
controlled host service and native-modal adapters. The pure document tests cover
history, JSON equality, validation, structured changes and prototype-safe paths.
The final source test receipt is
`.artifacts/modeling-ide-20261110-r2/unit-tests.json`: **63/63 passed**, zero
failures/skips and stable source.

```sh
node --experimental-strip-types --test \
  modelingweb/local-plugins/model-design/tests/candidate.test.mjs \
  modelingweb/local-plugins/model-design/tests/ide-document.test.mjs
node --test modelingweb/local-plugins/model-design/tests/ide-workbench.browser.mjs
```

Controlled browser UI tests pass 5/5, zero skipped:
`.artifacts/model-design-ide-workbench-browser/run-2026-11-09T17-52-15.095Z-720cef06-dd31-4623-986e-733846fd526b/report.json`.
This UTC receipt timestamp corresponds to November 10 in Asia/Singapore.

The browser tests use actual Vue, the maintained view/styles and local
Ionicons. Only the editor surface, host/modal and service are controlled
adapters. They cover Chinese/English at 1440px and 390px, real trusted clicks,
disabled invalid saves, undo/redo/format/diff/download, discard refusal,
conflict refusal, verified save/save-and-close and readonly. Screenshots show
no toolbar overlap or horizontal overflow. They do not establish actual Monaco,
schema or business-backend acceptance.

A review found and corrected a stale status after external server changes:
successful reload now clears "saved and verified" while retaining the
already-committed refresh flag. Source and four browser scenarios cover
save -> external change -> reload, so an ordinary fresh export is not
misrepresented as a verified import.

The complete model/plugin candidate is
`.artifacts/native-model-migration/ide-20261110-r3/receipt.json`; its fresh
runtime assets are
`.artifacts/native-ai-code-runtime-assets/ide-20261110-r1/receipt.json`.
These are prepared candidates, not shared deployment. The November 10 full
scripts run initially found one obsolete output-count assertion (4436 versus
4442). The exact six helper JS/declaration paths are now asserted individually
alongside unchanged full-inventory/hash checks; the failed report is retained.

Final full scripts regression: **4930/4930 passed**, zero failures/skips/
cancellations/todos and stable source, in 405 seconds:
`.artifacts/current-source-regression-20261110-r3/report.json`.
Consolidated immutable receipt:
`.artifacts/modeling-ide-20261110-r3/closeout.json`.
This records source/build/controlled-UI verification and explicitly keeps
native, permission, schema and production acceptance false. Shared 30250 was
not replaced.

## IDE Access Prerequisites

The previous native browser's five entity 403 responses have a source-level
explanation in `MODELDESIGN-EDITOR-REGISTRY-20261110.md`: the maintained model
instance registry contains 21 unique entries, not the earlier rough count of
23. The five missing exact mappings exist in another local CFR source.
The diagnosis is not an instrumented live-manager observation. Restoring only
reviewed entries requires new source builds and allowed/denied tests; no blanket
role grant or indiscriminate registration of all 387 entries is justified.

Central's routing/member-query prerequisites remain separate. The independent
SQL receipt reproduces the missing person filter, but still does not prove
expiry/access-mode/target-scope authorization.
