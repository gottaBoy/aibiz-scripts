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

## Not ready

| Component | Running as | Source on disk | Missing |
|---|---|---|---|
| `@ibiz-template/*` base packages | published npm | `ibiz-app-hub` | build plus `pnpm link`, and a version decision |
| Modeling frontend 32003 | prebuilt runner image, `/dist` dated 2025-08-18 | `modelingweb/app` | browser gate fails on an extension manifest 404 |
| allinone 30000 | prebuilt image | `ibiz-ebsx-runtime` | no image build script, no compose overlay |
| gateway 30086 | prebuilt image | `ibiz-ebsx-gateway` | no image build script, no compose overlay |
| UAA 32666 | prebuilt image | not identified | establish which tree builds `uaa-standalone` |
| Task 30088 | prebuilt image | `task7` | webapp has no build file, sources are decompiled |

## Version record

These are the facts that make "upgrade everything to latest" meaningless, so
they are written down rather than re-derived each time.

There is no single latest. The `@ibiz-template` base packages move together as
one train but currently sit on different letters of it, which the ledger shows
as `declared` against `installed`:

| Package | In use | `ibiz-app-hub` source | Hub directory | Published latest |
|---|---|---|---|---|
| `@ibiz-template/core` | 0.7.41-alpha.78 | 0.7.41-alpha.63 | `packages/core` | 0.7.41-alpha.140 |
| `@ibiz-template/runtime` | 0.7.41-alpha.86 | 0.7.41-alpha.77 | `packages/runtime` | 0.7.41-alpha.146 |
| `@ibiz-template/vue3-util` | 0.7.41-alpha.86 | 0.7.41-alpha.77 | `packages/vue3-util` | 0.7.41-alpha.146 |
| `@ibiz-template/model-helper` | 0.7.41-alpha.86 | 0.7.41-alpha.77 | `packages/model-helper` | 0.7.41-alpha.146 |
| `@ibiz-template/vue3-components` | 0.7.41-alpha.78 | 0.7.41-alpha.70 | `components/ibiz-next-vue3` | 0.7.41-alpha.144 |

Hub directory names do not track package names: `@ibiz-template/vue3-components`
lives under `components/ibiz-next-vue3`, and `@ibiz/model-core` under
`models/model-core`. The ledger resolves this by indexing every manifest in the
hub by the name it declares, so `hubDirectory` in the JSON output tells you
which tree each source version came from.

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

## Recommended order

1. Link the base packages from `ibiz-app-hub`. Smallest blast radius, no
   container restarts, gate is the PLM E2E suite. Decide first whether to raise
   `ibiz-app-hub` to the versions in use or lower `plm-web`, then record it here.
2. Point `modelingweb` at a local build with `AIBIZ_USE_LOCAL_WEB_DIST=true`,
   after fixing the extension manifest 404 in a candidate container.
3. Build source images for allinone and gateway. Largest blast radius, since
   they front authentication, routing and the model runtime, and it needs an
   explicit call on the `8.1.0.570.12` against `8.1.0.584.1` gap.
4. Establish UAA provenance, then decide whether Task is worth rebuilding. Its
   33471 Java files are decompiled, so the first milestone is reproducing one
   equivalent jar rather than the whole SAPAAS webapp.

## Rules

* Advance one subsystem at a time, and keep `npm test` green before moving on.
* Record the previous image tag before replacing a container, and keep it until
  the new one has passed the gates.
* Do not promote a candidate container onto a real port before its browser gate
  passes.
* Never run `docker compose down -v`; the MySQL, Task, EMQX and plugin volumes
  hold data that cannot be rebuilt.
