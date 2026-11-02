# PLM Stale Navigation Regression

Run directory: `.artifacts/stale-tree-20261102/`.

## Cause

The product requirements tree can finish loading after the browser has already
switched to product settings. Its default-selection event still reaches the old
navigation placeholder. Previously that placeholder calculated a child URL from
the current global route, placing `idea_all_grid_view` beneath
`product_setting_view`. Saving the product succeeds; refreshing then renders
the corrupted URL instead of the editor.

The controlled browser regression holds the actual `categories/fetch_no_section`
and `sections/fetch_default` responses, switches to the real product settings
deep link, and releases those unchanged responses. Both baseline mobile runs
failed with the same mixed route as the original CRUD failure. No business
records are written by this regression.

## Implementation

- `ibiz-app-hub/packages/vue3-util/src/panel-component/nav-pos/nav-pos.controller.ts`
  binds route ownership when the router is mounted, rejects navigation and cache
  updates after leaving that owner, and ignores events after destruction.
- Relationship controls may emit their initial selection before the placeholder
  mounts. That message is retained until router binding and cleared on
  destruction, preserving normal deep-link initialization.
- `ibiz-app-hub/components/ibiz-next-vue3/src/util/open-view-util/open-view-util.ts`
  checks the caller's optional ownership predicate after asynchronous model
  lookup and again after route generation. Unscoped navigation retains its
  existing push/replace behavior.
- `plm-e2e/tests/stale-tree-navigation.spec.ts` verifies route stability, the
  actual editor value, and refresh after the late tree responses.

The first implementation rejected the initial pre-mount selection as well.
Its failed browser report remains under `green/`; `green-r2/` is the corrected
implementation's report. Directory names alone never establish success.

## Verification

| Check | Result | Evidence |
| --- | --- | --- |
| Controlled baseline | Both mobile repeats failed with mixed route | `red-tree/reports/test-results.json` |
| Route ownership unit tests | 9 passed | `nav-pos-unit.log` |
| Async route preparation unit tests | 3 passed | `open-view-unit.log` |
| Controlled browser regression | 3 desktop + 3 mobile repeats passed; setup also passed | `green-r2/reports/test-results.json` |
| Original mobile product CRUD | All 5 repeats passed; setup also passed | `mobile-crud/reports/test-results.json` |
| CRUD cleanup | All owned records removed; zero remaining | `mobile-crud/test-results/*/product-workflow-evidence.json` |
| Framework and PLM builds | Passed | `vue3-util-build-r2.log`, `plm-build-r2.log` |
| Served framework bytes | Source build, PLM dist and HTTP hashes match | `served-framework.ndjson` |
| PLM plugin/build contracts | 87 passed | `node --test tools/tests/*.test.mjs` in `plm-web` |
| E2E report isolation contracts | 10 passed | `node --test config-tests/artifact-isolation.test.mjs` in `plm-e2e` |
| Full desktop/mobile plus known issues | 101 passed: 50 desktop, 50 mobile, 1 setup; zero failures/skips/flaky; retries disabled | `full/reports/test-results.json` |
| Mobile skip capability gate | Passed; zero skipped/unexpected/flaky | `PLM_E2E_ARTIFACT_DIR=.../full pnpm test:mobile:skip-gate` |
| Runtime doctor after regression | Passed | `bash scripts/local-runtime-doctor.sh` |

Changed implementation files and the new unit tests pass ESLint.
Only the PLM frontend container was restarted; no database, UAA or backend
container was restarted.

The ordinary desktop/mobile PLM gate is passing for this deployed build.
The opt-in `@deep-sweep` suite was not part of this run, and this result is not
whole-project, native-modeling or release acceptance.

## Reproduction Commands

From `ibiz-app-hub/packages/vue3-util`:

```sh
pnpm exec vitest run --config vitest.node.config.ts test/panel-component/nav-pos.test.ts
```

From `ibiz-app-hub/components/ibiz-next-vue3`:

```sh
pnpm exec vitest run --config vitest.node.config.ts test/util/open-view-util.test.ts
```

From `plm-e2e`, with a fresh artifact directory for every invocation:

```sh
PLM_E2E_BASE_URL=http://127.0.0.1:30250/ibizplm-plmweb/ \
  PLM_E2E_ARTIFACT_DIR="$WORKSPACE_ROOT/.artifacts/NEW-RUN" \
  PLM_E2E_INCLUDE_KNOWN=1 pnpm exec playwright test --retries=0
```

## Boundaries

The full `vue3-util` Node test run retains an unrelated `ui-store` setup failure
because `ibiz.util.theme` is not initialized. The components package's complete
typecheck also remains unsuccessful, reporting Vue 3.3/3.5 type conflicts in
unmodified modules. These checks are not recorded as passing.

This repair does not resolve the backend version-ledger failures, UAA
source/image bindings, original plugin-source gaps, native editor and permission
acceptance, deep feature sweep, or clean-environment release reproducibility.
