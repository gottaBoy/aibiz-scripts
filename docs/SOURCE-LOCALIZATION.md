# Source Localization Status

This records how far each iBiz component is from "edit the source and the
running system changes". It is a hand-maintained decision record; the machine
readable version of the numbers is `npm run ledger` in this repository.

`npm run ledger` answers one question per component: which version does each
authority demand, and do they agree? Add `--live` to include running container
images and published registry tips.

## Ready: source edits take effect

Here "Ready" means the local source/deployment path is wired and verified in the
current workspace. For Modeling Web, the formal development Compose service now
uses the verified local image; rows that still name a prebuilt image remain
explicitly not ready.

| Component | Source | Deploy path |
|---|---|---|
| PLM frontend | `plm-web` | `pnpm build` then `pnpm preview --host 127.0.0.1 --port 4173` |
| PLM backend | `plm/backend` | `build-local-image.sh` produces `aibiz/plmservice:local` |
| System model | `plm/model` | bind mounted into `plmweb`, `modelingservice`, `modelingweb` |
| Plugins | `plm-web/plugin-src` (66 of 66 recovered) | builds back into `public/plugins`, mounted read only |
| Modeling backend 32002 | `ibiz-service-hub` Modeling service source | source-built arm64 image; `modeling-runtime` required harness passes with a healthy container |
| Allinone local candidate 30100 | `ibiz-service-hub/ibiz-ebsx-runtime` | 83-module Maven reactor, arm64 Docker image, and `source-platform` smoke `7/7 PASS` |
| Gateway local candidate 30186 | `ibiz-service-hub/ibiz-ebsx-gateway` | arm64 Docker image and `source-platform` smoke `7/7 PASS` |
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
| `@ibiz-template-plugin/ai-chat` | `ibiz-app-hub/plugins/ibiz-ai-chat` (`0.0.60`) | linked into `plm-web`, built as SystemJS fallback in `public/extras` and `dist/extras` |
| `@ibiz-template-plugin/bi-report` | `ibiz-app-hub/plugins/ibiz-bi-report` (`0.0.32`) | linked into `plm-web`, built as SystemJS fallback in `public/extras` and `dist/extras` |
| `@ibiz-template-plugin/data-view` | `ibiz-app-hub/plugins/ibiz-data-view` (`0.0.6`) | linked into `plm-web`, built as SystemJS fallback in `public/extras` and `dist/extras` |
| `@ibiz-template-plugin/gantt` | `ibiz-app-hub/plugins/ibiz-gantt` (`0.1.8-alpha.378`) | linked into `plm-web`, built as SystemJS fallback in `public/extras` and `dist/extras` |
| Modeling frontend 32003 | `modelingweb/app` | formal `docker-compose-dev.yml` uses `aibiz/modelingweb:local`; optional `docker-compose-modeling-local.yml` provides host `dist` iteration, `docker-compose-modeling-remote.yml` provides rollback; plugin sidecar, deployment harness, and browser smoke pass |
| UAA 32666 | `vendor-upstream/ibizlab-runtime/ibzuaa` | Dockerized Maven source build produces the hash-verified standalone JAR and `aibiz/uaa:source-built` arm64 image; readiness evidence is recorded |
| allinone 30000 | `ibiz-service-hub/ibiz-ebsx-runtime` | Dockerized Maven source build produces `aibiz/ibiz-ebsx-allinone-rt:8.1.0.584.1-local-clean-20260928`; `linux/arm64`; backend contract `8/8`, smoke contract `4/4`, source-platform smoke `7/7` |
| gateway 30086 | `ibiz-service-hub/ibiz-ebsx-gateway` | Dockerized Maven source build produces `aibiz/ibiz-ebsx-gateway:8.1.0.584.1-local-clean-20260928`; `linux/arm64`; backend contract `8/8`, smoke contract `4/4`, source-platform smoke `7/7` |

The `66` plugin count is the local PLM package/recovery set. The ledger's
`73` "pinned by the system model" value is a separate reference count and does
not mean that 73 editable plugin source packages exist.

### Model package delivery contracts

These three packages are deliberately excluded from the plugin SystemJS bundle
requirement:

| Package | Contract | Ledger enforcement |
|---|---|---|
| `@ibiz-template/theme` | build-time style source; SCSS is imported by the PLM Vite build | missing `index.system.min.js` is not a warning; an import-map entry is a failure |
| `@ibiz/model-core` | types-only; emitted JavaScript has no standalone browser behavior | missing `index.system.min.js` is not a warning; an import-map entry is a failure |
| `@ibiz/rt-model-api` | app-bundled runtime; imported by `plm-web/src/model/model-loader.ts` and not externalized by `plm-web/vite.config.ts` | missing `index.system.min.js` is not a warning; an import-map entry is a failure |

The plugin runtime contract remains the SystemJS import map. These model
packages must not be added to that map, because they are application
dependencies rather than plugin-shared externals.

### ibiz-service-hub backend receipt

The latest non-overwriting receipt is
`ibiz-service-hub/scripts/records/backend-local-build-clean-20260928.json`.
Older receipts remain unchanged. The receipt was produced from commit
`7b073023724fb3dfe6537016e8dd6f68e8dd45a5` with `git_dirty: false`, so it is
the clean local build baseline for this verification round.

| Image | Image ID | Artifact SHA256 |
|---|---|---|
| `aibiz/ibiz-ebsx-allinone-rt:8.1.0.584.1-local-clean-20260928` | `sha256:8d6ec725d83b030b534afaf087f08a6ad9fc23ffd374ba7a27c0cfc3bf0670da` | `db2f18e4e43f0489cc2c40b145b626a24d28076295278e193e86b22f96212aad` |
| `aibiz/ibiz-ebsx-gateway:8.1.0.584.1-local-clean-20260928` | `sha256:60187c28d0f800bed325344bb9e640a8f0fe6343f6023689b650af5032032a2a` | `a6aba9b82f8f6ae498d66e981b94852dffb77c9f478844771e8e16f76fe333de` |

## Not ready

| Component | Running as | Source on disk | Missing |
|---|---|---|---|
| iBizModeling Central/ModelDesign core model | no verified original source or exact extension set | `plm/model` is only the PLM model and is not a substitute | core audit is fail-closed: `originalSourceCandidates: 0`, `originalExtensionsVerified: 0`, `coreExactRequested: null`, `coreExactComplete: null`; native ModelDesign integration remains unverified |
| Task 30088 | prebuilt `task7` image | `task7/SAPAAS` | legacy single-JAR Ant build has hard-coded Windows dependencies; complete dependency reconstruction, SAPAAS WAR/Tomcat assembly, Dockerfile, and reproducible source-built image are missing |

The four model plugins (`bi-report`, `data-view`, `ai-chat`, and `gantt`) now
have one-to-one local source links in PLM. Their SystemJS-compatible output is
also committed under `public/extras` as the reproducible offline/deployment
fallback, and the PLM build rewrites the runtime import map to those local
versions. The independent 23-plugin Modeling workbench is not evidence of
native ModelDesign integration; the current status remains
`fullyLocalized:false` and `platformIntegration:not-verified`.

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

Several independent version trains are in play and they do not move together:

* Frontend base packages: `0.7.41-alpha.x`, with `plm-web` itself at `0.7.41-rc.8`.
* Platform backend: the formal allinone container remains `8.1.0.570.12.250807` and the formal gateway remains `8.1.0.377-b2-arm64`; the clean local candidates are tagged `8.1.0.584.1-local-clean-20260928`, matching the Maven Docker configuration `8.1.0.584.1`. The previously recorded `8.1.0.578.10` is not the current formal allinone tag.
* Web runners: formal `plmweb` remains `9.0.7.41-alpha.55`; the Modeling Web
  service in `docker-compose-dev.yml` now uses the local
  `aibiz/modelingweb:local` image (`linux/arm64`, digest
  `sha256:c97051540e65c441f4a0084c920d83c5dd62dde0faaedc864b13bac229789549`).
  The previous Modeling Web runner remains available only through
  `docker-compose-modeling-remote.yml` as an explicit rollback.
* UAA image: `2.1.9-arm64` (source candidate tree is `2.1.9`).
* Task image: `v124.2.opensource.25082603`.

Two findings that change how upgrades should be judged:

* **Plugin peer ranges are not enforced.** Plugin bundles import the base
  packages as bare specifiers with no version, and SystemJS resolves them
  through `public/extras/json/system-import.json`, which maps each name to a
  single file. So the 68 plugins declaring ranges such as `0.4.12` against a
  `0.7.41-alpha.78` runtime is stale metadata, not a break. The ledger reports
  it as `INFO` and would report a genuine break as `FAIL`.
* **`@ibiz-template/runtime` is now a single local link in the PLM graph.**
  `package.json` and `pnpm-lock.yaml` both point to
  `../ibiz-app-hub/packages/runtime`, whose source version is
  `0.7.41-alpha.86`; the current lockfile has no `0.6.18` runtime entry. The
  previous `web-theme` transitive-version warning is historical and must not be
  used as the current version state.
* **The theme delivery note is expected.** `@ibiz-template/theme` ships no
  SystemJS bundle because it is imported at PLM build time; `npm run ledger`
  reports that fact as an INFO contract note, not as a runtime version
  conflict.

### Repository state caveat

The ledger checks versions, links, and artifacts; it does not replace a clean
checkout check. At the 2026-09-28 review, the following repositories had
uncommitted work:

* `ibiz-service-hub`: `scripts/build-local-images.sh`,
  `scripts/tests/backend-local-build.test.mjs`, and three untracked build
  receipts under `scripts/records/`; the receipts are intentionally retained
  without overwriting older records.
* `modelingweb`: `Dockerfile.modelingweb` and
  `app/tests/modeling-web-docker.harness.mjs` for the container healthcheck
  gate.
* `plm`: `deploy/compose/docker-compose-dev.yml` for the source-local
  modeling-service health dependency; this is existing workspace work and was
  not changed by this review.
* `scripts`: `package.json` plus the untracked modeling-runtime harness and its
  test.

All other repositories in the workspace were clean at that check. Their short
current revisions are recorded in `modelingweb/docs/ibiz-local-version-map.md`;
rerun `git status --short` in each repository before creating a release archive.
The backend Ready rows therefore describe a verified working-tree candidate,
not a clean release artifact.

## Recommended order

1. Link the base packages from `ibiz-app-hub`. Done for all ten that
   `plm-web` imports, on 2026-09-26 and 2026-09-27. The answer to "raise the
   hub or lower `plm-web`" turned out to be neither: measure compiled output,
   and link only where the hub is behind by nothing. `npm run localize` reports
   it, `--apply` performs it.
2. Complete the model plugin delivery boundary. Done for `bi-report`,
   `data-view`, `gantt` and `ai-chat`: each package is linked to
   `ibiz-app-hub`, built into SystemJS-compatible output, copied to the PLM
   fallback tree, and gated by the source-build contract, plugin harness,
   version check, and production build. The next browser gate should verify
   the running PLM container resolves the same import-map entries.

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
3. Switch the formal Modeling Web service to the verified local image. Done:
   `docker-compose-dev.yml` is local by default, the plugin-sidecar and browser
   smoke pass, and `docker-compose-modeling-remote.yml` is a tested rollback.
   The remaining Modeling blocker is the exact Central/ModelDesign core model
   source and extension set, which stays fail-closed.
4. Execute and harden the existing allinone/gateway build wrappers and Compose
   overlays. Done for the local arm64 candidates: the 83-module Maven reactor,
   artifact hashes, image IDs, architecture/tag receipt, backend contract
   (`8/8`), smoke contract (`4/4`) and real source-platform smoke (`7/7`) all
   pass. The latest evidence is
   `ibiz-service-hub/scripts/records/backend-local-build-clean-20260928.json`.
   Before promotion, commit the wrapper/test change and rebuild from a clean
   tree; the formal `8.1.0.570.12.250807`/`8.1.0.377-b2-arm64` images remain a
   separate compatibility baseline.
5. Decide whether Task can be rebuilt reproducibly. Its legacy Ant file only
   builds one JAR with hard-coded Windows dependencies; the first milestone is
   reconstructing that dependency graph and one equivalent artifact, not
   claiming a source-built SAPAAS image.

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
