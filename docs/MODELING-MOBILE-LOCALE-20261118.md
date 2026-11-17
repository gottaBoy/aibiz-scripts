# Modeling Mobile And Locale Source Checkpoint

Date: 2026-11-18, Asia/Singapore.
Status: **FIXED-SOURCE-NOT-DEPLOYED**.
Record: [aibiz-modeling-mobile-locale-20261118.json](../records/aibiz-modeling-mobile-locale-20261118.json).
The canonical matrix remains **25 top-level items not fully accepted**.
This source checkpoint does not supersede an immutable runtime receipt or
claim that the shared PLM/Modeling URL serves these changes.

## Implemented Source

| Scope | Change | Boundary |
| --- | --- | --- |
| R09 / L02 | Added 133 exact English display entries for System Overview, module QuickCfg and related metadata, including Save and Close and `realTitle` | Unknown text, IDs, API paths, values, scripts and opaque payloads are not rewritten |
| R09 / L02 | Adapted the actual app-local code-list service during normal `initApp` registration | Exactly ten reviewed STATIC lists / 48 value-label pairs; dynamic lists, custom values, custom labels and unreviewed tooltips remain unchanged |
| R10 / B04 | Reflowed the recognized native shell on viewports below 768px | Full-width editor, six navigation commands, scrollable header tools and the optional plugin menu remain accessible; desktop geometry is unchanged in the controlled probe |
| R10 / B04 | Restricted the responsive marker to the authoritative shell structure | Duplicate directions, custom regions/styles/size modes and nonstandard header structures do not receive the override |

Modeling source commits:

- `a1b3ee73`: reviewed metadata/code-list localization without cache effects.
- `830b17ce`: responsive native shell, rebuilt index outputs and browser probe.

The code-list sidecar records raw models through the existing `setCodeList`
registration before ModelHelper initializes them. Translation predicates do
not call `getCodeList`: that native method can merge sub-app models and must
retain its existing call/cache timing. English display results are cloned;
the raw model/cache and stored values remain unchanged on language switches.
The ten lists' value-label pairs and empty labels are bound to authoritative
JSON, not just a code-name whitelist.

Independent read-only review reproduced and then rechecked two issues before
submission: a getter-induced merge after cache creation, and an ambiguous
same-direction custom shell region. Both received production fixes and
focused counterexamples. A custom label with a reviewed value is also
preserved rather than translated merely because it occurs in the dictionary.

## Verification

- Joined targeted regression: **318/318**, no failures/skips/cancellations.
- Controlled browser probes: **27/27** tests, including **24 cells** across
  shell/footer/console, Chinese/English and desktop/mobile variants.
- Portal/Unicode source, collector and planner contracts: **144/144**.
  These are not actual Portal delivery or Unicode migration acceptance.
- Locale ESLint, strict single-module TypeScript and `git diff --check` passed.
- The independent design-index package was rebuilt with its pinned
  TypeScript/Rollup toolchain; tracked outputs match the build receipt.

The shell browser probe transforms the authoritative `ModelingIndex.json`
with the real DSL helper and renders the real host ScrollContainer,
ScrollContainerItem, PanelContainer, Row/Col and menu styles. Controllers and
inner editor/header/menu content are controlled boundaries. It reproduces the
old fixed-sidebar crop, checks editor bounds and normal tool clicks/search,
and compares unchanged desktop geometry. It is **not a complete native IDE
session, permission check, or persisted edit**.

```sh
node --test --test-concurrency=2 \
  scripts/tests/local-design-index.test.mjs \
  scripts/tests/native-model-design-index-integration.test.mjs \
  scripts/tests/dashboard-missing-record.test.mjs \
  modelingweb/local-plugins/design-index/tests/permitted-menu.test.mjs \
  modelingweb/local-plugins/design-index/tests/todo-counter.test.mjs \
  modelingweb/app/tests/model-locale.test.mjs \
  modelingweb/app/tests/owned-modeling-bootstrap.test.mjs

node --test --test-concurrency=1 \
  modelingweb/app/tests/design-shell.browser.mjs \
  modelingweb/app/tests/design-footer.browser.mjs \
  modelingweb/app/tests/console-drawer.browser.mjs

node --test --test-concurrency=2 \
  scripts/tests/owned-native-portal-contract.test.mjs \
  scripts/tests/owned-native-unicode-plan.test.mjs \
  scripts/tests/collect-owned-native-unicode-metadata.test.mjs
```

Private screenshots/reports remain under `.artifacts/design-shell-browser/`
and `.artifacts/console-drawer-browser/`. The final shell probe is
`probe-1794935001114`; individual cells declare `nativeAcceptance: false`.
No business responses, tokens or screenshots are committed.

## Remaining Work

1. Complete the `Config__PSObjType` vocabulary and log-shell localization.
   Its 396 STATIC entries have 388 exact dictionary gaps and the list is not
   admitted by this ten-list adapter. Twenty consuming JSON models include
   the system/entity/application activity cards and model-change logs.
   Eight existing dictionary matches are not evidence of code-list UI
   coverage. Translate display labels only, not `objtype` or log content.
2. Assemble one coherent owned candidate including these commits and replay
   real English/Chinese refresh, deep links and mobile navigation. The prior
   console/footer runtime receipt does not verify these new changes.
3. Finish the reviewed root/system projection, Portal side-effect and
   dashboard/statistics contracts before forwarding currently denied calls.
   The Portal contract remains fail-closed; no fake empty responses were added.
4. Complete real native CRUD, fresh-session persistence and negative
   role/root cases. Controlled clicks and a loader-free APPINDEX are not a
   substitute for those workflows.
5. Resolve the native Unicode wide-row design blockers, then run owned full
   backup/clone restore, schema/data/index/grant comparison, actual migration,
   second-run idempotence and the real API character corpus.
6. Validate MQTT and third-party credentials, ACLs, delivery/recovery, then
   perform separately reviewed shared rollout, served-byte and rollback
   acceptance. Git push does not deploy or accept a release.

No Docker command, shared restart/replacement, SQL operation, global prune or
persistent-volume operation was performed in this continuation. Temporary
controlled browser servers/contexts were closed. The last recorded shared
inventory remains 12 services / 18 image IDs / zero owned or historical
containers; it was not newly inventoried here. Existing unrelated PLM Web
changes were left untouched.
