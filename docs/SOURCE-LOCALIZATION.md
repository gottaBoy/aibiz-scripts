# Source Localization Status

This records how far each iBiz component is from "edit the source and the
running system changes". It is a hand-maintained decision record; the machine
readable version of the numbers is `npm run ledger` in this repository.

`npm run ledger` answers one question per component: which version does each
authority demand, and do they agree? Add `--live` to include running container
images and published registry tips.

## Ready: source edits take effect

| Component | Source | Deploy path |
|---|---|---|
| PLM frontend | `plm-web` | `pnpm build` then `pnpm preview --host 127.0.0.1 --port 4173` |
| PLM backend | `plm/backend` | `build-local-image.sh` produces `aibiz/plmservice:local` |
| Modeling backend | `modelingservice` plus `ibiz-service-hub` | `build-source.sh` produces `aibiz/modelingservice-arm64:local` |
| System model | `plm/model` | bind mounted into `plmweb`, `modelingservice`, `modelingweb` |
| Plugins | `plm-web/plugin-src` (66 of 66 recovered) | builds back into `public/plugins`, mounted read only |
| `@ibiz-template/core` | `ibiz-app-hub/packages/core` | linked into `plm-web`, rebuilt into `dist/extras` |
| `@ibiz-template/runtime` | `ibiz-app-hub/packages/runtime` | linked into `plm-web`, rebuilt into `dist/extras` |
| `@ibiz-template/model-helper` | `ibiz-app-hub/packages/model-helper` | linked into `plm-web`, rebuilt into `dist/extras` |
| `@ibiz-template/vue3-util` | `ibiz-app-hub/packages/vue3-util` | linked into `plm-web`, rebuilt into `dist/extras` |
| `@ibiz-template/vue3-components` | `ibiz-app-hub/components/ibiz-next-vue3` | linked into `plm-web`, rebuilt into `dist/extras` |
| `@ibiz-template/devtool` | `ibiz-app-hub/plugins/ibiz-template-devtools` | linked into `plm-web`, rebuilt into `dist/extras` |
| `@ibiz-template/theme` | `ibiz-app-hub/packages/theme` | linked into `plm-web`, imported at build time |
| `@ibiz-template/web-theme` | `ibiz-app-hub/components/web-theme` | linked into `plm-web`, rebuilt into `dist/extras` |
| `@ibiz/model-core` | `ibiz-app-hub/models/model-core` | linked into `plm-web`, type/interface contract only; no SystemJS bundle |
| `@ibiz/rt-model-api` | `ibiz-app-hub/models/rt-model-api` | linked into `plm-web`, runtime code bundled by PLM Vite; no SystemJS bundle |

### Model package delivery contracts

These two packages are deliberately excluded from the plugin SystemJS bundle
requirement:

| Package | Contract | Ledger enforcement |
|---|---|---|
| `@ibiz/model-core` | types-only; emitted JavaScript has no standalone browser behavior | missing `index.system.min.js` is not a warning; an import-map entry is a failure |
| `@ibiz/rt-model-api` | app-bundled runtime; imported by `plm-web/src/model/model-loader.ts` and not externalized by `plm-web/vite.config.ts` | missing `index.system.min.js` is not a warning; an import-map entry is a failure |

The plugin runtime contract remains the SystemJS import map. These model
packages must not be added to that map, because they are application
dependencies rather than plugin-shared externals.

## Not ready

| Component | Running as | Source on disk | Missing |
|---|---|---|---|
| `@ibiz-template-plugin/bi-report` | committed `public/extras` static at `0.0.32` | `ibiz-app-hub/plugins/ibiz-bi-report` | the import map serves `index.system.min.js`, which this plugin's `vite build` does not emit, so nothing links to: localising it needs a SystemJS build step for the plugin, not a link |
| `@ibiz-template-plugin/data-view` | committed `public/extras` static at `0.0.6` | `ibiz-app-hub/plugins/ibiz-data-view` | as `bi-report` |
| `@ibiz-template-plugin/ai-chat` | committed `public/extras` statics, 24 versions | `ibiz-app-hub/plugins/ibiz-ai-chat` | as `bi-report`; the served `0.0.66` file is a checked-in asset |
| `@ibiz-template-plugin/gantt` | committed `public/extras` static at `0.1.8-alpha.378` | `ibiz-app-hub/plugins/ibiz-gantt` | as `bi-report` |
| Modeling frontend 32003 | prebuilt runner image, `/dist` dated 2025-08-18 | `modelingweb/app` | browser gate fails on an extension manifest 404 |
| allinone 30000 | prebuilt image | `ibiz-ebsx-runtime` | no image build script, no compose overlay |
| gateway 30086 | prebuilt image | `ibiz-ebsx-gateway` | no image build script, no compose overlay |
| UAA 32666 | prebuilt image | not identified | establish which tree builds `uaa-standalone` |
| Task 30088 | prebuilt image | `task7` | webapp has no build file, sources are decompiled |

## Version record

These are the facts that make "upgrade everything to latest" meaningless, so
they are written down rather than re-derived each time.

There is no single latest, and version numbers alone cannot tell you whether a
package is safe to localize. Two independent checks are needed, because they
catch different things.

First, compiled output: build the hub tree and diff implementation files against
the artifact installed in `plm-web`. That total splits into the files upstream
changed since the hub tree was cut, which a link would drop, and the files the
hub changed on purpose, which are the reason to localize.

| Package | In use | Hub source | Diff vs in use | Missing upstream | Ours | Vendor drift | Status |
|---|---|---|---|---|---|---|---|
| `@ibiz-template/core` | 0.7.41-alpha.78 | 0.7.41-alpha.78 `packages/core` | 0 | 0 | 0 | none | linked |
| `@ibiz-template/model-helper` | 0.7.41-alpha.86 | 0.7.41-alpha.86 `packages/model-helper` | 0 | 0 | 0 | none | linked |
| `@ibiz-template/runtime` | 0.7.41-alpha.86 | 0.7.41-alpha.86 `packages/runtime` | 10 | 0 | 10 | none, after pinning `dingtalk-jsapi` | linked |
| `@ibiz-template/vue3-util` | 0.7.41-alpha.86 | 0.7.41-alpha.86 `packages/vue3-util` | 1 | 0 | 1 | none | linked |
| `@ibiz-template/vue3-components` | 0.7.41-alpha.78 | 0.7.41-alpha.78 `components/ibiz-next-vue3` | 18 | 0 | 18 | none, after pinning four vendor packages | linked |
| `@ibiz-template/devtool` | 0.0.14 | 0.0.14 `plugins/ibiz-template-devtools` | 17 | 0 | 17 | none, after pinning `@monaco-editor/loader` | linked |
| `@ibiz-template/theme` | 0.7.39 | 0.7.39 `packages/theme` | 0 | 0 | 0 | none, ships no bundle | linked |
| `@ibiz-template/web-theme` | 3.11.0 | 3.11.0 `components/web-theme` | 0 | 0 | 0 | none | linked |
| `@ibiz/model-core` | 0.1.84 | 0.1.84 `models/model-core` | 0 | 0 | 0 | none, types-only; no SystemJS bundle | linked |
| `@ibiz/rt-model-api` | 0.2.82 | 0.2.82 `models/rt-model-api` | 0 | 0 | 0 | none, app-bundled; no SystemJS bundle | linked |

Second, what vendor code reaches the browser, which a package can ship two ways.
Either esbuild copies it into `dist/index.system.min.js`, the file the import
map serves, or the published tree carries a `node_modules` directory of
relative-import copies beside its compiled output, which the app build bundles
as written. Both come from whichever `node_modules` ran the build, so two source
trees can agree file for file and still hand the browser different third-party
code. Neither is visible in an `out/` or `es/` diff, because the collector skips
vendor directories on purpose: they are not iBiz source. `runtime` reached `missing upstream = 0` on 2026-09-26 and the
first check alone then said link it, but the rebuilt bundle had silently
swapped `dingtalk-jsapi` 3.2.0 for 3.1.0. Nothing was wrong with either source
tree: the package asks for `^3.0.41`, and three workspaces have each resolved
that range to something different, 3.0.41 in `plm-web`, 3.1.0 in the hub, and
3.2.0 in the build upstream published. No `out/` diff can show this. Byte
comparison cannot either, since the two minifier toolchains are not reproducible
against each other, so the check compares the set of inlined packages and their
versions instead.

`vue3-components` proved the second route on 2026-09-27: its `dist` bundle
inlines nothing, so the first check reported a clean row while the installed
`es/node_modules` held four packages at different versions, one of which
differs in real code: the hub resolved `modern-screenshot` to 4.6.8, which adds
a CSS layer-rule check that the served 4.6.7 copy does not have. `devtool` was
held the same way, on
`@monaco-editor/loader`. Both are pinned now, the pin scoped to the package
whose artifact is being replaced so it cannot move a linked neighbour.

A package whose artifact carries neither route has no vendor code to swap, and
the row says so; it stays held while the hub tree is absent, because then no
comparison has run at all.

Counts were measured 2026-09-26 and are frozen in `LINK_STATE_BY_PACKAGE` in
`localize-base-packages.mjs`, which refuses a row whose two counts do not
partition the diff. Re-measure with `--measure` after any hub sync.

Two consequences worth stating plainly:

* Across the fifteen steps from `core` `0.7.41-alpha.63` to `0.7.41-alpha.78`,
  published output changed in exactly one file: the `.xls`/`.xlsx` mime case,
  now ported into the hub source. That train is quiet, which is why
  prerelease-letter distance is a poor proxy for risk here.
* The hub is not simply behind. `runtime` carries 9 files of our own
  localization, so a naive bump over the hub tree would overwrite real work.
  The two sets are disjoint, so the merge is additive rather than a conflict,
  but it has to be a merge.

Hub directory names do not track package names: `@ibiz-template/vue3-components`
lives under `components/ibiz-next-vue3`, and `@ibiz/model-core` under
`models/model-core`. Both the ledger and `localize-base-packages.mjs` resolve
this by indexing every manifest in the hub by the name it declares, so
`hubDirectory` in the JSON output tells you which tree each source version came
from.

Three separate version trains are in play and they do not move together:

* Frontend base packages: `0.7.41-alpha.x`, with `plm-web` itself at `0.7.41-rc.8`.
* Platform backend: deployed `8.1.0.570.12` against `ibiz-service-hub` source at `8.1.0.584.1`.
* Web runners: `9.0.7.41-alpha.55` for `plmweb` and `v9.0.7.40-alpha.19` for `modelingweb`.

Two findings that change how upgrades should be judged:

* **Plugin peer ranges are not enforced.** Plugin bundles import the base
  packages as bare specifiers with no version, and SystemJS resolves them
  through `public/extras/json/system-import.json`, which maps each name to a
  single file. So the 68 plugins declaring ranges such as `0.4.12` against a
  `0.7.41-alpha.78` runtime is stale metadata, not a break. The ledger reports
  it as `INFO` and would report a genuine break as `FAIL`.
* **`@ibiz-template/runtime` resolves to two versions in the lockfile**,
  `0.6.18` pulled in by `@ibiz-template/web-theme@3.11.0` alongside `0.7.41-alpha.86`.
  Only one copy can be served because the import map maps one target and the
  build externalises it, so this is graph hygiene rather than a runtime split.
  It is the first thing to clear before any bump.
  Verified 2026-09-26 that it is inert: the shipped `web-theme` bundle is
  `System.register([]`, with no specifier imports at all, so nothing resolves
  `0.6.18` at runtime. Every published `web-theme` up to `3.16.0` still declares
  `^0.6.0`, so no version bump clears it. It reads as a WARN rather than an INFO
  only because the ledger reports lockfile facts it cannot see through.

## Recommended order

1. Link the base packages from `ibiz-app-hub`. Done for all ten that
   `plm-web` imports, on 2026-09-26 and 2026-09-27. The answer to "raise the
   hub or lower `plm-web`" turned out to be neither: measure compiled output,
   and link only where the hub is behind by nothing. `npm run localize` reports
   it, `--apply` performs it.
2. Port the model plugin bundles. `bi-report`, `data-view`, `gantt` and
   `ai-chat` are served as committed `public/extras` SystemJS statics, and
   their `vite build` emits `index.es.js` only, so there is nothing for a link
   to replace. Localising them means adding a SystemJS build step and
   regenerating the checked-in asset, then retiring it.

    `runtime`, `vue3-util` and `vue3-components` were each ported this way,
    every file verified by rebuilding and comparing the emitted output against
    the artifact in use. What that costs in practice, given that the published
    tarballs ship compiled output only and the upstream TypeScript is
    unreachable:

    * Match the published output character for character where you can. The
      gate is a byte comparison, and a reformatted line or a renamed callback
      parameter reads as a behaviour change.
    * Type-only differences do not show up in output. `as Blob` and a non-null
      assertion were needed because our `model-core` is older and types two
      fields more strictly; both are erased at compile time, so the emitted file
      still matched.
    * A port that reproduces published output can still be wrong. Matching
      `platform-provider-base.js` meant importing `exportData` from the
      controller barrel, which creates a cycle that leaves `ChartService`
      extending undefined and stops twelve test files collecting. That file is
      now a declared divergence, and `--measure` reports declarations that stop
      matching.
    * Where a newer authored tree exists, use it only after proving the
      published output has not moved since. Diffing the installed artifact
      against the newer build isolates what came later, and a file whose two
      trees agree can be taken from the authored source rather than rewritten
      from minified output. Where they disagree, the compiled artifact is the
      only authority.
    * Moving source between packages is a real edit, not a rename. Upstream
      moved `panel-container-group` out of `vue3-util` into both component
      packages and gave it a title bar toolbar; leaving the old copy behind
      would have registered a container with no toolbar.
3. Point `modelingweb` at a local build with `AIBIZ_USE_LOCAL_WEB_DIST=true`,
   after fixing the extension manifest 404 in a candidate container.
4. Build source images for allinone and gateway. Largest blast radius, since
   they front authentication, routing and the model runtime, and it needs an
   explicit call on the `8.1.0.570.12` against `8.1.0.584.1` gap.
5. Establish UAA provenance, then decide whether Task is worth rebuilding. Its
   33471 Java files are decompiled, so the first milestone is reproducing one
   equivalent jar rather than the whole SAPAAS webapp.

## Rules

* Advance one subsystem at a time, and keep `npm test` green before moving on.
* Install the hub and `plm-web` with pnpm 8, the version that wrote their v6
  lockfiles. A newer pnpm rewrites the lockfile and resolves a different graph,
  which shows up as a broken toolchain rather than a version problem: pnpm 10
  pulled `typescript@5.9.3` under `vue-tsc@1.8.27`, which cannot read it.
  `corepack pnpm@8.15.9 install --frozen-lockfile` is the reproducible form.
* Linking collapses two ledger authorities into one directory, so an agreement
  row for a linked package proves nothing. The ledger marks those rows with `*`
  and reports `localized:` instead.
* Record the previous image tag before replacing a container, and keep it until
  the new one has passed the gates.
* Do not promote a candidate container onto a real port before its browser gate
  passes.
* Never run `docker compose down -v`; the MySQL, Task, EMQX and plugin volumes
  hold data that cannot be rebuilt.
