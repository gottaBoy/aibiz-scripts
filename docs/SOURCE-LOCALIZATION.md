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
| `@ibiz-template/model-helper` | `ibiz-app-hub/packages/model-helper` | linked into `plm-web`, rebuilt into `dist/extras` |

## Not ready

| Component | Running as | Source on disk | Missing |
|---|---|---|---|
| `@ibiz-template/runtime` | published npm | `ibiz-app-hub/packages/runtime` | 29 files of upstream fixes are missing from the hub tree |
| `@ibiz-template/vue3-util` | published npm | `ibiz-app-hub/packages/vue3-util` | 24 files of upstream fixes are missing from the hub tree |
| `@ibiz-template/vue3-components` | published npm | `ibiz-app-hub/components/ibiz-next-vue3` | 49 files of upstream fixes are missing from the hub tree |
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
| `@ibiz-template/runtime` | 0.7.41-alpha.86 | 0.7.41-alpha.77 `packages/runtime` | 9 | 0 | 9 | `dingtalk-jsapi` 3.1.0 vs 3.2.0 | held |
| `@ibiz-template/vue3-util` | 0.7.41-alpha.86 | 0.7.41-alpha.77 `packages/vue3-util` | 25 | 24 | 1 | none | held |
| `@ibiz-template/vue3-components` | 0.7.41-alpha.78 | 0.7.41-alpha.70 `components/ibiz-next-vue3` | 66 | 49 | 17 | none | held |

Second, what the browser bundle inlines. `dist/index.system.min.js` is the file
the import map actually serves, and esbuild copies some vendor packages into it
rather than importing them. Those copies come from whichever `node_modules` ran
the build, so two source trees can agree file for file and still ship different
vendor code. `runtime` reached `missing upstream = 0` on 2026-09-26 and the
first check alone then said link it, but the rebuilt bundle had silently
swapped `dingtalk-jsapi` 3.2.0 for 3.1.0. Nothing was wrong with either source
tree: the package asks for `^3.0.41`, and three workspaces have each resolved
that range to something different, 3.0.41 in `plm-web`, 3.1.0 in the hub, and
3.2.0 in the build upstream published. No `out/` diff can show this. Byte
comparison cannot either, since the two minifier toolchains are not reproducible
against each other, so the check compares the set of inlined packages and their
versions instead.

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

1. Link the base packages from `ibiz-app-hub`. Done for `core` and
   `model-helper`, which the hub reproduces exactly; `pnpm run localize` reports
   the split and `--apply` performs it. The other three need upstream commits
   ported into the hub first, and the answer to "raise the hub or lower
   `plm-web`" turned out to be neither: measure compiled output, and link only
   where the hub is behind by nothing.
2. Port the missing upstream commits into `ibiz-app-hub` for `runtime`,
   `vue3-util` and `vue3-components`. The published tarballs ship `dist` and
   `out` only, so the source of truth for those commits is the diff between two
   published builds, not a git history we hold.
   Confirmed 2026-09-26: `runtime@0.7.41-alpha.86` records
   `gitHead` `7a62d27`, which exists in neither `gottaBoy/ibiz-app-hub` nor any
   other remote we have, and the tarball declares no repository. The upstream
   TypeScript is therefore unreachable, and porting means reading the compiled
   `out/*.js` and rewriting the difference by hand. `runtime` is 29 files and
   about 450 changed compiled lines; start with `config/global-config.js`, which
   adds two optional environment keys in two lines, and finish the survey
   before committing to the rest.
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
