# aibiz-workspace-tools

This repository contains the local verification, smoke-test, and stack-restart
tooling used by the aibiz workspace.

## Layout

- `harness-*.sh`: service, API, database, and browser smoke-test entry points.
- `external-ui-harness.mjs`: optional project-level browser gate for an external
  local UI such as `http://127.0.0.1:19323/#?`.
- `bootstrap-workspace.sh`: clone, install, start, migrate, and verify a new
  development workspace.
- `modeling-*.mjs`: modeling source and runtime contract checks.
- `generate-app-jsonschemas.mjs`: model JSON Schema generation.
- `version-ledger.mjs`: version spread across the iBiz source-localization
  boundary, see `docs/SOURCE-LOCALIZATION.md`.
- `localize-base-packages.mjs`: reports which `@ibiz-template` base packages
  `ibiz-app-hub` can serve as source, and links the safe ones into `plm-web`.
- `tests/`: Node.js tests for the scripts and workspace contracts.
- `java/`: offline Liquibase runtime checks.

See `docs/BOOTSTRAP.md` for complete setup on another machine.
See `docs/SOURCE-LOCALIZATION.md` for which components accept source edits
today and what stands in the way of the rest.
See [`docs/LOCALIZATION-EXECUTION-PLAN-20261006.md`](docs/LOCALIZATION-EXECUTION-PLAN-20261006.md)
for the dependency-ordered source, native workflow, Docker and final acceptance
queue, assigned owners, current evidence boundaries and mandatory exit criteria.

## Localization Regression Queue

```sh
npm run test:localization:baseline --prefix scripts
npm run test:localization --prefix scripts
```

The baseline runs eight serial contract, source-readiness, bytecode-input,
offline/live ledger, required runtime and required portal checks. The full
queue adds browser contracts, native platform API, native ModelDesign and the
PLM desktop/mobile suite, including known-issue and deep-sweep cases. Coordinate
the full queue with other agents because native API and PLM tests write data.
Neither command builds, restarts or commits the stack.

Each run owns a fresh `.artifacts/localization-regression/run-*/` directory,
retains private per-command logs and hashes, and continues subsequent checks
after failures. Nonzero exits, incomplete TAP summaries, required skips/todos,
missing child reports and Playwright failures/skips/flakiness all fail the run.
Partial source completion (exit 2) is not a regression pass. A successful
command queue still does not certify the independent source, Docker, plugin
coverage, permission or persistence exit criteria in the execution plan.

## Version Ledger

```sh
npm run ledger        # offline: manifests, lockfile, model, disk
npm run ledger:live   # adds running container images and registry tips
```

The ledger exits non-zero only on `FAIL`, which is reserved for things that
break at runtime. `WARN` and `INFO` describe drift worth planning around that
works today.

Both the ledger and localization baseline CLIs support `--help`. The
localization baseline treats current source/build inputs and the active Compose
files as required. Legacy root Compose names, the old harness JAR copy, and
historical audit notes are reported as `missingOptional` evidence rather than
failures. Live capture verification compares the Modeling service JAR with its
recorded local source artifact and compares `/app/plm-provider.jar` with
`plm/backend/plm-provider.jar`.

## Base Package Localization

```sh
npm run localize         # report only
npm run localize:apply   # build the safe hub packages and link them
```

A package is safe to link only when two independent checks pass. Its
`missing-upstream` count must be zero, meaning the hub tree carries every
upstream fix in the artifact already running; differences the hub adds of its
own do not hold a link, they are the reason to have the source. And its
`vendor-drift` must be empty, because the bundle the browser loads inlines some
vendor packages, and the two workspaces can resolve the same range to different
versions. Neither check can substitute for the other: `runtime` passed the first
and failed the second. See `docs/SOURCE-LOCALIZATION.md`.

The counts are measured from compiled output rather than inferred from version
numbers, and are frozen in `LINK_STATE_BY_PACKAGE`; refresh them with
`node localize-base-packages.mjs --measure` after syncing the hub.

## Workspace Root

Most scripts infer the workspace root from `../` and expect sibling projects
such as `plm`, `plm-web`, `modelingweb/app`, and `ibiz-app-hub`.

`restart-modeling-stack.sh` also supports `AIBIZ_WORKSPACE_ROOT` when this
repository is checked out somewhere other than `<workspace>/scripts`.

## Tests

Node.js 20 or newer is required:

```sh
npm test
npm run test:project   # unit tests, ledger, and local UI in auto mode
npm run test:ci        # strict stack gate; includes native platform API and ModelDesign acceptance
```

Browser-dependent tests require Playwright browsers. If the local Chromium
binary is absent, install it with the Playwright command used by the sibling
application repositories.

## External UI Harness

The project baseline includes the external UI as a non-blocking-by-default
test item. When the page is not running, `auto` mode records `SKIP`; once the
target is reachable, browser and page failures are strict.

`test:project` is the normal local regression entry point. It keeps a stopped
19323 service non-blocking while still failing on any reachable-page problem.
`test:ci` is the strict entry point for a running stack. It requires the native
platform API contract and Central/ModelDesign edit, save and reload verification.
The native browser gate remains failed until the missing native plugins and
editor workflow are verified. The harness does not start or stop services.

```sh
npm run test:external-ui --prefix scripts
# authenticated messages, anonymous config denial, save/update/reset across sessions:
npm run test:native-platform-api --prefix scripts
# full stack baseline, including the external UI item:
npm run test:baseline --prefix scripts
# or:
AIBIZ_EXTERNAL_UI_URL=http://127.0.0.1:19323/#? \
  AIBIZ_EXTERNAL_UI_MODE=required \
  node scripts/external-ui-harness.mjs
```

The harness uses the Playwright installation in `plm-e2e/node_modules`, writes
`report.json` and `page.png` under `.artifacts/external-ui/`, and checks the
main response, document body, a configurable selector, console/page errors,
failed requests, and HTTP 4xx/5xx responses. For a different local page, set
`AIBIZ_EXTERNAL_UI_URL`; `AIBIZ_EXTERNAL_UI_MODE=off` removes the item from a
baseline run.

## Full Regression Entry

The executable cross-repository order is documented in
[`docs/FULL-LINK-REGRESSION-CHECKLIST.md`](docs/FULL-LINK-REGRESSION-CHECKLIST.md):

1. Start or verify the Compose stack and run migrations.
2. Run `scripts` contract tests and the version/localization ledger.
3. Run PLM Compose contract tests.
4. Run Modeling Web tests, release/build checks, plugin checks, Docker harness,
   and deployed smoke.
5. Run `plm-e2e` default, API, desktop, mobile, known-issue, deep-sweep,
   artifact-isolation, and Harness UI checks.

The `scripts` commands have different strictness:

```sh
npm test              # script and harness contract tests
npm run test:project  # contracts + ledger + external UI auto + runtime auto
npm run test:ci       # strict CI gate; runtime, external UI and native ModelDesign are required
npm run test:baseline # running Docker stack baseline; external UI is auto
```

`auto` may record an unavailable external UI as `SKIP`. A release or acceptance
run that requires `http://127.0.0.1:19323/#?` must start the project-owned
`harness-ui` service and use `npm run test:external-ui` or
`AIBIZ_EXTERNAL_UI_MODE=required`.

All repeatable reports belong under the workspace `.artifacts/` directory.
`plm-e2e` uses `PLM_E2E_ARTIFACT_DIR` to isolate a run; its root
`reports/test-results.json` is historical unless the command explicitly wrote
it during the current run.

## Original CLI Source

The native CLI source workflow pins `0.3.0`, `0.3.23` and `0.3.30` to their
original commits and reconstructed Git tree hashes. It acquires original TS,
configuration, lockfiles, templates and license notices, not published
implementation JS. Protected configuration paths and their shared Git blobs
are excluded before downloading.

```sh
npm run test:native-cli-source --prefix scripts
npm run fetch:native-cli-source --prefix scripts -- --transport public-raw
npm run build:native-cli-source --prefix scripts -- --verify-report \
  .artifacts/native-cli-source-build/<run>/report.json
```

Reports retain exact version, commit, tree, raw-response and file hashes.
`--cache-from` revalidates prior public responses and source blobs for resume;
cached metadata is not a fresh repository visibility check. The public-raw
transport accepts only the pinned official file path and one redirect to the
official content host. Acquisition and isolated build completion exit `2` to
distinguish evidence from full application acceptance; exit `1` is failure.
Build instructions and consumer version mappings are recorded in
[`docs/NATIVE-CLI-SOURCE-ACQUISITION-20261006.md`](docs/NATIVE-CLI-SOURCE-ACQUISITION-20261006.md).
