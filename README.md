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

## Version Ledger

```sh
npm run ledger        # offline: manifests, lockfile, model, disk
npm run ledger:live   # adds running container images and registry tips
```

The ledger exits non-zero only on `FAIL`, which is reserved for things that
break at runtime. `WARN` and `INFO` describe drift worth planning around that
works today.

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
npm run test:ci        # CI/stack gate; requires the local UI at 19323
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
`test:ci` is the strict entry point for an environment that has started the
external UI; it fails when the target cannot be reached. The harness does not
start or stop that service.

```sh
npm run test:external-ui --prefix scripts
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
