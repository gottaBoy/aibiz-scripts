# Runtime-model .1 Quality Review And .2 Intentional Deltas

Date: 2026-10-06, Asia/Shanghai.
Status: read-only source review; implementation and new acceptance tests are proposed, not executed.

## Scope And Receipt Protection

- Reviewed `modelingweb/local-plugins/runtime-model/src/**` and `scripts/tests/runtime-model-*`.
- No runtime source, package, lock, configuration, generated declaration, build output, Harness, test, receipt, ModelDesign input, or compose was modified.
- No typecheck, build, browser, container, or existing test suite was run. The only new file is this document.
- `.1` means `@ibiz-template-plugin/runtime-model@0.2.2-local.1`, an editable reconstruction of observed `0.2.2`, not original upstream source.
- `.2` below is a proposed `0.2.2-local.2` release with explicit behavioral fixes, not an exact replacement for upstream `0.2.2`.

## Findings

The seven issue IDs are the existing `knownOriginalIssues` registry in
`scripts/tests/runtime-model-test-support.mjs:34`. They are inherited defects,
not regressions introduced by the reconstruction. Severity below concerns
local functional quality, not whether `.1` matches the observed original.

Paths in the table are relative to `modelingweb/local-plugins/runtime-model/src/`.

| Priority | Intentional-delta ID | Source evidence | Current functional consequence |
| --- | --- | --- | --- |
| P1 | `config-http-status-unchecked` | `core/model-runtime-service.ts:33`; `core/model-runtime-controller.ts:145`, `:189` | Non-2xx JSON is returned as configuration. Error payloads can become synthetic API rows; malformed values can abort an entire column. |
| P1 | `empty-root-never-loaded` | `core/model-runtime-controller.ts:75`; `core/model-runtime-store.ts:15`; `components/ibiz-model-runtime/ibiz-model-runtime.tsx:309` | A fresh successful `[]` root leaves `loaded=false`, hides the empty/retry UI, and leaves a blank content area after loading ends. |
| P1 | `children-promise-does-not-wait` | `core/model-runtime-controller.ts:38`, `:49`, `:91` | `await loadChildren()` does not wait for an uncached request. Callers can act on incomplete data; pre-try loading failures can become detached rejected promises. |
| P2 | `unescaped-search-expression` | `core/model-runtime-controller.ts:29`; `components/ibiz-model-runtime-list/ibiz-model-runtime-list.tsx:55` | Ordinary input `[` throws; regex syntax is interpreted instead of literal search; only the first `*` is converted. |
| P2 | `response-shadows-cache-key` | `core/model-runtime-controller.ts:89`, `:93`, `:101` | The response array shadows the requested node, so ordinary responses are cached under `undefined`. Named-node navigation misses the cache. |
| P2 | `pagination-delete-count` | `components/ibiz-model-runtime-list/ibiz-model-runtime-list.tsx:106`, `:115` | `splice(start,end)` treats the intended endpoint as a count: the first increment after 30 rows adds 40 instead of 10. |
| P2 | `selection-not-reactive` | `components/ibiz-model-runtime-list/ibiz-model-runtime-list.tsx:41`, `:126`, `:198` | `activeData` is a plain field. The selected branch can remain visually inactive even after its children render. |

## Existing Evidence, Not A New Test Run

### Frozen Source-build Evidence

Receipt:
`.artifacts/runtime-model-source-build/build-d29dd4cb-76ab-4764-8797-4d44263e6840/report.json`.

- Completion recorded at `2026-10-06T04:00:25.945Z` / `12:00:25.945 +08:00`.
- SHA-256: `61fef68adefb10918750c6593418eab357e7d1dc8ca6ffaa6e771236417d7910`.
- Input fingerprint: `c4c129fbbfb6621d96db408394d4afa33d7a7e75d954020e2642a6c7e1ab92f7`.
- Both recorded `tsc --noEmit` commands and both recorded Stencil builds exited 0.
- `sourceBuildVerified=true`, `reproducibleBuildVerified=true`, `nativeAccepted=false`.
- This review independently read and hashed the receipt, its 18 recorded live `src/` inputs, and 91 isolated output files. Receipt hash matched; source drift and output drift were both empty.

This was a read-only hash comparison, not a fresh execution of the source-build Harness.
Keep the isolated package and receipt as the `.1` consumer input; never overwrite them with `.2`.

### Compatibility Evidence

- Unit evidence: `.artifacts/runtime-model-reconstruction-unit/probe-1d2f134b-6611-4257-b27d-91eacf15fd06/report.json`, 38 recorded tests, `fixtureAcceptance=true`, `nativeAcceptance=false`.
- Successful browser evidence: `.artifacts/runtime-model-reconstruction-browser/source-build-bundled/report.json`, SHA-256 `d9278417e533e8d2a4bf5f430752f529c2d9c1bd6cd4a2bedadd012a07fbb20e`.
- That browser report records all 10 scenario/viewport comparisons passing, plus the provenance check and parent test corresponding to the reported Node test total of 12/12. It explicitly says `fixture-parity-passed-not-native-accepted`.
- The browser suite has five scenarios at desktop `1440x900` and mobile `390x844`, not 12 independent functional workflows.

Examples of deliberate baseline assertions in the existing unit suite:

| Issue | `scripts/tests/runtime-model-reconstruction.test.mjs` | `.1` assertion retained |
| --- | --- | --- |
| Configuration status | `:146` | JSON 404 is returned as data. |
| Cache key | `:268` | Requested key is missing; `undefined` is cached. |
| Children Promise | `:305` | Promise resolves before delayed network data is published. |
| Empty root | `:342` | `loaded=false` and original error log. |
| Search | `:356` | Invalid regex throws; current helper case behavior is preserved. |
| Pagination | `:388` | 90 input rows produce 30 then 70, eventually 90. |

The browser suite separately diagnoses selection as zero rendered active rows
(`scripts/tests/runtime-model-reconstruction.browser.mjs:324`), invalid search as an
expected pageerror (`:394`), and empty root as a hidden empty state (`:405`).
These are marked `functionalAcceptance=false`. Passing those comparisons proves
compatibility with a defect, not local functional correctness.

There are also later failed retry reports, including
`.artifacts/runtime-model-reconstruction-browser/probe-cc358b9b-5d9d-43cb-9217-6622a70a86e6/report.json`.
At inspection its desktop/mobile workflow comparison statuses were `failed`,
although both sides recorded `passed`; no comparison error was persisted there.
That report cannot establish a runtime-source cause or a newer passing gate.
Preserve both successful and failed evidence; do not silently promote the old
success to a claim that every later strengthened check passed. Resolving that
Harness/report issue remains with the main thread, outside this review's write scope.

## Minimal .2 Implementation And Test Order

Before step 1, preserve `.1` source/input hashes and its immutable build package.
Prepare a separate versioned `.2` candidate and fresh evidence namespace. Keep
dependency pins unchanged; dependency upgrades are not one of the seven fixes.
For each step: add a regression case first, implement the narrow change, then
run the relevant unit/browser checks in the `.2` candidate only.

### 1. Configuration HTTP Status

ID: `config-http-status-unchecked`.

Minimum change: `ModelRuntimeService.getConfig` must check the response's 2xx
status before accepting configuration JSON. Reject non-2xx with identifiable
status/URL evidence, rather than returning its JSON payload. The existing
`formatItems` catch remains a documentation-enrichment failure boundary: actual
runtime nodes should still be returned when optional API documentation is missing.
Do not change the runtime-node POST transport or convert its failures to success.

Acceptance:

- Service tests: 200 configuration object, supported JSON-encoded string, JSON/HTML 404, 403, 500, network rejection, and invalid JSON.
- Verify the exact GET URL and unchanged `PSSYSAPP -> IPSAPPLICATION` mapping; no GET when there is no METHOD-derived type.
- Controller/browser: failed documentation produces real model rows without phantom `message`/`error` API rows; navigation, search, copy and refresh still work.
- Record the precise injected documentation failure and the fallback result. Plugin loader/chunk/CSS 404s must still fail, not use this optional-documentation allowance.
- Valid matched and documentation-only methods remain enriched exactly as before.

Related but separate: malformed *2xx* configuration still needs schema validation.
Moving runtime checks into the configuration try/catch is a recommended additional
`config-shape-guard` delta, not evidence that the status-only fix solves malformed
success payloads. Test `null`, arrays, invalid entry values, non-string `return`,
and a key named `hasOwnProperty` before claiming robust configuration handling.

### 2. Empty Root Completion

ID: `empty-root-never-loaded`.

Minimum change: after a successful empty root, leave `list`/`activeList` empty,
reset stale `rootData`, clear stale error state, and set `loaded=true`. A valid
empty response is a completed empty result, not a permanent pending state.
Ensure the loaded-only transition actually triggers a render; the component's
explicit store callback currently names `list`, `activeList`, and `errorMessage`,
not `loaded` (`ibiz-model-runtime.tsx:45`).

Acceptance:

- Unit: fresh `[]` completes with `loaded=true`, empty lists/cache/root selection, preserved `srfparentkey`, and hidden loading panel.
- Unit: prior success -> empty result and prior failure -> empty result do not retain old root data or errors.
- Browser on both viewports: empty UI and reload control are visible, content area is hidden, and no original empty-root error is tolerated as successful quality acceptance.
- Retry `[] -> populated root` issues the correct root/child POSTs and restores normal navigation.

Moving loading cleanup into `finally` is advisable, but missing/unready refs and
loading count recovery are additional lifecycle behavior, described separately below.

### 3. Children Promise Completion

ID: `children-promise-does-not-wait`.

Minimum change: `await this.load(param)` (or return that Promise) in the uncached
branch. Keep `Promise<void>` and publish data/error state before it settles.
The cached branch should remain immediately usable without HTTP.

Acceptance:

- Deferred network: returned Promise remains pending until release; after release the child column and cache are available.
- Deferred 403/504: Promise does not complete before the response has been handled and error state updated.
- Cache hit trims obsolete columns/active path, uses a detached clone, and makes no request.
- Browser: child selection, immediate breadcrumb update, refresh, and copy behavior remain valid.

Important contract limit: `loadModelData` already catches HTTP errors and sets
state (`model-runtime-controller.ts:102`). Adding `await` does **not** make those
errors reject. Do not test or advertise universal rejection unless a separate
contract delta changes error propagation and updates fire-and-forget UI callers.
Also, the Promise does not guarantee a browser paint or completion of deferred
`loading.hide()` timers.

### 4. Requested-node Cache Key

ID: `response-shadows-cache-key`.

Minimum change: retain the requested node under an unshadowed name, use a
separate response variable, and cache by the requested node ID, which is also
used by `loadChildren` lookup. Do not store an unidentified/default request
under `undefined`; preserve deep cloning on both set and get and root-context
cache invalidation.

Acceptance:

- Load A/B with ordinary array responses: keys are A/B, never the response's `.id` or `undefined`.
- Request without an ID still follows the original `#` request convention but does not poison a shared undefined cache key.
- Revisiting a loaded branch reuses cache without an extra POST; refresh and parent-key change force the expected fresh requests.
- Mutating a returned nested row cannot mutate another cache read; retain existing Date/RegExp/typed-array coverage.
- Combined with step 3, both hit/miss paths fulfill the documented Promise completion contract.

### 5. Literal Search With Wildcards

ID: `unescaped-search-expression`.

Minimum change: use a small shared expression helper for controller and list.
Escape regex metacharacters in literal segments, split on every `*`, and join
segments with the wildcard expression. Keep the existing unanchored substring
matching, list-only trimming, 300 ms debounce, and uppercase normalization.

Acceptance:

- `[` / `]`, `(`, `.`, `+`, `?`, backslash, `|`, `^`, and `$` are safe literal input; no exception/pageerror.
- Empty input, `*`, repeated wildcards, and `a*b*c` have defined wildcard results.
- List searches still cover logicName, methodName, val, apiMethod, apiDescription, and retain selected rows.
- Rapid input changes apply only the last input after 300 ms.
- Clearing an invalid-looking search restores normal rows and pagination on both viewports.

Do not incidentally add an `i` flag to the controller helper: its existing
`isSearchContent` receives unnormalized strings, and the baseline explicitly
distinguishes uppercase/lowercase subjects (`runtime-model-reconstruction.test.mjs:356`).
Changing that helper's case contract would need its own declared delta.

### 6. Pagination Endpoint

ID: `pagination-delete-count`.

Minimum change: replace `.splice(start,end)` on the filtered copy with
`.slice(start,end)`. Preserve initial 30 rows and subsequent `page.size=10`.

Acceptance:

- Unit with 90 rows: visible lengths 30, 40, 50, ... 90; stable order, no gaps/duplicates, and immutable source list.
- Filtered rows paginate with the same page size, including any selected row retained by the filter.
- An additional exhausted request adds no rows and sets the existing exhaustion indicator.
- Browser fixture currently has 92 enriched rows, not 90: initial 30, then 40/50, eventually exactly 92.
- Drive one IAS advance per assertion using observable progress; do not loosen exact increments to hide multiple scroll-triggered advances.

IAS termination/disposal is an additional lifecycle concern, not fixed merely
by switching to `slice`.

### 7. Reactive Selection

ID: `selection-not-reactive`.

Minimum change: declare `activeData` as `@State()` and keep existing guards for
leaf/duplicate selection and the existing refresh reset. This makes selection
render independently of a child network response. No public Prop/Method/Event
needs to be renamed or added.

Acceptance:

- Real built Stencil browser test with delayed child response: the chosen branch becomes active before the response is released.
- Switching branches gives exactly one active row in the column; cache hits also update selection immediately.
- Leaf/duplicate clicks do not issue extra POSTs; Ctrl/Meta copy does not navigate; refresh clears highlight.
- Verify selection again after parent-key navigation and items replacement, so stale same-ID selections do not pass unnoticed.
- Run desktop/mobile DOM assertions, not just source-class method tests.

The existing unit loader strips decorators
(`runtime-model-test-support.mjs`, `transpile(..., stripDecorators)`), so it
cannot prove Stencil reactivity. `.2` loader metadata should explicitly add
`activeData: [32]` to this component's State members. Record that expected delta;
do not weaken `.1`'s original member tuple checks or claim byte-identical metadata.

## Baseline Versus Quality Gates

Keep these verdicts separate:

| Gate | Input | Meaning of green |
| --- | --- | --- |
| `.1` compatibility baseline | Observed original + frozen `.1` build | Preserved original behavior, including seven defects, for the measured fixtures. |
| `.2` unchanged-contract differential | Versioned `.2` build + explicit delta rules | Public API and unaffected workflows match; only declared differences are allowed. |
| `.2` local functional quality | `.2` independently, without original failure expectations | Seven fixes work under normal/error/delayed inputs and real component rendering. |
| Native ModelDesign integration | Actual ModelDesign plugin, routes, authenticated API, parent context, assets | Real native workflow works; fixture/build success alone cannot award this verdict. |

Suggested future files, **not created or wired by this review**:

- `scripts/fixtures/runtime-model-local2-intentional-deltas.json`: seven exact issue IDs, old/new behavior, changed methods/metadata, tests, and explicitly approved ancillary deltas.
- `scripts/tests/runtime-model-local2-quality.test.mjs`: service, controller, cache, search and pagination quality cases.
- `scripts/tests/runtime-model-local2-quality.browser.mjs`: independently built public loader, delayed responses, empty/retry, selection, optional documentation failures.
- A version-aware differential report that keeps baseline observations and `.2` expected deltas alongside each other instead of deleting incompatible assertions.

The `.2` release should have its own source fingerprint, output hashes,
double-clean-build evidence and browser resource checks. Keep the four component
tags, existing public attributes/props/events/methods and exports in `src/index.ts`.
Build hashes will legitimately change; validate against `.2`'s receipt, never
pretend they match `.1`. `originalSourceRecovered` and license authenticity remain
false; passing local quality is not proof of upstream source authenticity.

## Native Blocking Conditions

### Configuration 404

Source-confirmed conditional behavior, not an observed live runtime-config outage:

- HTML 404 / rejected JSON parsing: caught by `formatItems` configuration try/catch; real model rows can continue, API documentation/enrichment is lost.
- JSON 404 such as `{message:"missing-config"}`: wrongly accepted and can create a fake API row named `message`.
- JSON error payload containing null entries or unsuitable `return` values: dereferencing/formatting after the configuration try/catch can throw. The child column is never pushed; `loadModelData` catches it and may not set a visible error because such exceptions have no `.data`.
- Loader/chunk 404 is a different hard block: component registration/rendering can fail and must never be classified as optional docs.

The current browser fixture always serves config GET with HTTP 200
(`runtime-model-reconstruction.browser.mjs:92`). Its existing 401/403/504 scenarios
target root POSTs. It supplies no native configuration-404 acceptance evidence.

### Empty Root

Confirmed fresh-empty functional defect: no usable empty/retry state. An empty
response after a previous completed load can differ because `loaded` was already
true, so test both initial and subsequent loads. Missing `parentKey` is another
condition: `ibiz-model-runtime.tsx:60` simply skips all root loading, without an
explicit completed/error state.

The existing native read-projection report
`.artifacts/native-model-modules-live-20261006-runtime-source/report.json:149`
records `fetch-without-model-root` with HTTP 200 and zero rows; the explicit
context fetch has 12 rows. This demonstrates a real context-sensitive empty
API result, **not** an empty runtime-node POST or proof that the runtime UI
encountered this defect. That report explicitly excludes UI workflow acceptance.

### Promise And Loading Readiness

The early child Promise is a synchronization defect, not proof that every
ordinary navigation is permanently broken. Data can eventually render.
It becomes a native blocker when surrounding actions depend on the Promise
to finish, or when detached loading failures prevent the request from starting.

Additional preconditions hidden by the fixture:

- `rootLoadingPanel.show()` is called before the root try/catch
  (`model-runtime-controller.ts:56`); absent/unready elements reject the root load before HTTP.
- `loading.show()` is called before the child try/catch (`:91`); fixed-ID `loadingPanel`/`rootLoadingMask` are dereferenced without checks (`loading-controller.ts:13`, `:31`).
- Fixture HTML explicitly creates and readies root loading elements before mounting the runtime (`runtime-model-reconstruction.browser.mjs:45`). The runtime renders its own `loadingPanel` but not those two root elements.
- Cached global loading refs can point at a detached previous component after remount; two instances share IDs/counts. A returned Stencil `show()` Promise is also not awaited by the loading controller.

Native acceptance must check actual mount order and all three live elements'
methods/readiness, parent context, node POST responses, configuration URLs/status,
child completion and the visibility of the empty/error/retry state.

## Additional Quality Risks And Blockers

These are outside the seven minimum fixes; do not silently classify them as
original-compatible repairs:

| Risk | Evidence | Required follow-up before a broad quality claim |
| --- | --- | --- |
| Loading recovery/ownership | `core/loading-controller.ts:7`, `:40`; root/child show calls outside try | Test missing/unready/stale refs, multi-instance ownership, teardown and non-negative balanced counters; declare any lifecycle fixes separately. |
| Overlapping requests | `core/model-runtime-controller.ts:53`, `:89` | Delayed parent A/branch A then parent B can publish stale results into B. Add generation/cancel policy and race tests as a separate delta. |
| Stale errors | `core/model-runtime-controller.ts:108` | Successful retries do not generally clear prior errorMessage. Test failure -> populated success, not just empty completion. |
| Unvalidated/mutated config | `core/model-runtime-controller.ts:201`, `:206`, `:209` | Add runtime shape guards and avoid mutating shared config if approved; test null values, bad return types and shadowed hasOwnProperty. |
| IAS/timer cleanup | `components/ibiz-model-runtime-list/ibiz-model-runtime-list.tsx:60`, `:80`, `:156` | IAS is not retained/disposed, spinnerRef is unset, and timers have no teardown. Repeated mount/unmount needs leak/no-late-update coverage. |
| Original source/license identity | `package.json:29`; acquisition document | Reconstruction permission is not upstream source or license authentication. Keep production/source-authenticity verdicts separate. |

Additional dependency boundary: ordinary deep-clone fixture parity does not
prove Ramda `0.29.1` matches every object shape in the original bundled clone.
Do not advertise exhaustive third-party equivalence; null-prototype/custom
`hasOwnProperty` inputs need targeted evidence if claimed in scope.

## Handoff

- `.1` receipt hashes remained intact in this read-only review; continue consuming the frozen package for the current ModelDesign integration.
- Seven mandatory fixes remain unimplemented in this review; implement them in the versioned `.2` order above.
- Native runtime-node/config/loading/UI evidence is still required. No reviewed artifact proves a live runtime configuration 404, an actual runtime empty-root encounter, or a Promise-caused native outage.
- The stronger browser retry/report failures and the native integration run remain main-thread work; this review did not rebuild, redeploy, change a gate, or replace failed evidence.
