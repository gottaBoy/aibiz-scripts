# aibiz-workspace-tools

This repository contains the local verification, smoke-test, and stack-restart
tooling used by the aibiz workspace.

## Layout

- `harness-*.sh`: service, API, database, and browser smoke-test entry points.
- `bootstrap-workspace.sh`: clone, install, start, migrate, and verify a new
  development workspace.
- `modeling-*.mjs`: modeling source and runtime contract checks.
- `generate-app-jsonschemas.mjs`: model JSON Schema generation.
- `tests/`: Node.js tests for the scripts and workspace contracts.
- `java/`: offline Liquibase runtime checks.

See `docs/BOOTSTRAP.md` for complete setup on another machine.

## Workspace Root

Most scripts infer the workspace root from `../` and expect sibling projects
such as `plm`, `plm-web`, `modelingweb/app`, and `ibiz-app-hub`.

`restart-modeling-stack.sh` also supports `AIBIZ_WORKSPACE_ROOT` when this
repository is checked out somewhere other than `<workspace>/scripts`.

## Tests

Node.js 20 or newer is required:

```sh
npm test
```

Browser-dependent tests require Playwright browsers. If the local Chromium
binary is absent, install it with the Playwright command used by the sibling
application repositories.
