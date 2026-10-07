# Native standard-entry source-platform routing

This is a scoped platform-upstream change, not a model/plugin migration or native
editor acceptance. The standard Central/ModelDesign entries remain on loopback
ports 32006/32007. The separate
`plm/deploy/compose/docker-compose-modeling-native-source-platform.yml` sets only
`NATIVE_PLATFORM_HOST: ibiz-ebsx-allinone-local` on:

- `modelingweb-native-central`
- `modelingweb-native-modeldesign`

The main thread recreated only those two entries and confirmed they are healthy.
Served `nginx -T` points `$native_auth` to
`http://ibiz-ebsx-allinone-local:30000`; `$native_service` remains
`http://modelingservice:32002` and `$native_uaa` remains
`http://ibizlab-uaa-api:32666`. Existing business ModelAPI, UAA, old/source platform
containers and candidate entries are not recreated by this operation.

No model, plugin version, plugin mapping, source receipt or frontend artifact is
upgraded. The original audited model mount and local frontend mount remain
read-only. The candidate-only
`docker-compose-modeling-native-platform-local.yml` remains a separate overlay
for 32008/32009; do not include it or the service/plugin candidate overlays in
the standard-entry command.

## Prerequisites

Use the existing Compose project, checkout and env files. The source-built
`ibiz-ebsx-allinone-local` backend must already be healthy and reachable on
`agent_network`, with its image/receipt/ledger evidence verified separately.
This document does not build or start that backend. Preserve the same image,
model-root, port and project overrides used by the existing standard entries
when deploying or rolling back; do not drop them or substitute candidate models.

The commands below render with `.dev` plus `source-built-local.env`. Read-only
Compose comparison verified that the overlay changes only the two
`NATIVE_PLATFORM_HOST` environment entries, leaving images, ports, model mounts
and all other services unchanged. Do not print complete resolved environment
configuration into logs; it can contain credentials.

## Deploy Only Two Entries

From the existing workspace:

```sh
export WORKSPACE_ROOT=/home/my/workspace/ainfra/aibiz
(
  set -e
  cd "$WORKSPACE_ROOT/plm/deploy/compose"
  docker compose --env-file .dev --env-file source-built-local.env \
    --profile modeling --profile modeling-native \
    -f docker-compose-dev.yml \
    -f docker-compose-modeling-native.yml \
    -f docker-compose-modeling-native-source-platform.yml \
    up -d --no-deps --no-build --pull never --force-recreate \
    --wait --wait-timeout 90 \
    modelingweb-native-central modelingweb-native-modeldesign
)
```

The explicit service list and `--no-deps` limit recreation to two entry
containers. Do not use unscoped `up`, project-wide `down`, volume removal or
`--remove-orphans`. Entry recreation can interrupt those two web sessions.

Inspect the actual served configuration, not only the source nginx template:

```sh
(
  set -e
  cd "$WORKSPACE_ROOT/plm/deploy/compose"
  for service in modelingweb-native-central modelingweb-native-modeldesign; do
    docker compose --env-file .dev --env-file source-built-local.env \
      --profile modeling --profile modeling-native \
      -f docker-compose-dev.yml \
      -f docker-compose-modeling-native.yml \
      -f docker-compose-modeling-native-source-platform.yml \
      exec -T "$service" nginx -T
  done
)
```

Both entries must show the source-platform `$native_auth` and unchanged ModelAPI
and UAA upstreams. A healthy nginx process alone is not an authenticated business
check.

## Roll Back Only Two Entries

First confirm the original `ibiz-ebsx-allinone:30000` backend is still reachable.
Remove only the standard source-platform overlay from the command, preserving
the same project/env/other overrides, and force-recreate the same two services:

```sh
(
  set -e
  cd "$WORKSPACE_ROOT/plm/deploy/compose"
  docker compose --env-file .dev --env-file source-built-local.env \
    --profile modeling --profile modeling-native \
    -f docker-compose-dev.yml \
    -f docker-compose-modeling-native.yml \
    up -d --no-deps --no-build --pull never --force-recreate \
    --wait --wait-timeout 90 \
    modelingweb-native-central modelingweb-native-modeldesign
)
```

Repeat `nginx -T` using this rollback file list: `$native_auth` must return to
`http://ibiz-ebsx-allinone:30000`, with ModelAPI/UAA unchanged. Neither backend
nor any business/candidate container is stopped or recreated. Rerun the required
API checks with a fresh report directory. Rollback restores routing, not a
promise that the old backend's known stale-cache checks will pass.

## Reproduce Required Checks

Use fresh report names and retain failures; never overwrite the historical
before-cutover reports. From the workspace root:

```sh
(
  set -e
  cd "$WORKSPACE_ROOT"
  RUN_ID="$(node -p 'new Date().toISOString().replace(/[:.]/g, "-") + "-" + require("node:crypto").randomUUID()')"
  node scripts/harness-native-platform-api.mjs --required \
    --central-url http://127.0.0.1:32006/central/ \
    --modeldesign-url http://127.0.0.1:32007/modeldesign/ \
    --report-dir ".artifacts/native-platform-api/standard-source-routing-$RUN_ID"
  node scripts/harness-modeling-runtime.mjs --required \
    --report-dir ".artifacts/modeling-runtime-source-routing-$RUN_ID"
  node scripts/external-ui-harness.mjs --required \
    --url 'http://127.0.0.1:19323/#?' \
    --report-dir ".artifacts/external-ui/standard-source-routing-$RUN_ID"
)
```

These are separate required gates, without `auto`/`off` or error suppression.
The runtime harness covers existing business ModelAPI on
`32002/ibizmodeling/modelapi` and web/auth on `32003`, not native editor operations.
Native browser acceptance remains a separate mandatory entry:

```sh
npm run test:native-modeldesign --prefix scripts
```

Do not convert its nonzero exit into PASS because HTTP/API checks succeeded.

## Confirmed Evidence

Times below are UTC. Names ending in `20261006` use the workstation +08:00
date; they are not claims of a UTC 2026-10-06 execution date.

| Gate | Confirmed result | Evidence |
|---|---|---|
| Standard entries, old backend before cutover | Historical FAIL: 36/48, 12 failed | `.artifacts/native-platform-api/model-design-inputs-safety-20261006/report.json` |
| Separate source candidate, 32008/32009 | 42/42 PASS; cleanup PASS | `.artifacts/native-platform-api/model-design-inputs-safety-source-20261006/report.json` |
| Earlier standard entries, source backend after cutover | 42/42 PASS, 0 failed; 21/app; both cleanup summaries PASS | `.artifacts/native-platform-api/standard-source-routing-20261006/report.json` |
| Earlier business runtime after cutover, required | 17/17 PASS, exit 0 | `.artifacts/modeling-runtime-source-routing-20261006/report.json` |
| Earlier portal after cutover, required | 9/9 PASS; zero console/HTTP/page/request errors | `.artifacts/external-ui/standard-source-routing-20261006/report.json` |
| Latest source-bound API, standard 32006/32007 | Required 42/42 PASS, exit 0; 21/app; both cleanup summaries PASS | `.artifacts/native-platform-api/source-bound-regression-20261006/report.json` |
| Latest source-bound business runtime, required | 17/17 PASS, exit 0 | `.artifacts/modeling-runtime/source-bound-regression-20261006/report.json` |
| Latest source-bound portal, required | 9/9 PASS; zero console/HTTP/page/request errors | `.artifacts/external-ui/source-bound-regression-20261006/report.json` |
| PLM read-only desktop API regression | 2 PASS, 0 failed/skipped/flaky: authentication setup + one API case | `.artifacts/plm-e2e/plm-api-desktop-readonly-20261006-021758-06a8493f-f8f8-4736-9f49-4b68f3fbfea5/reports/test-results.json` |
| PLM artifact-isolation configuration | Main-confirmed 8/8 PASS; no separate log path supplied | `pnpm test:config` from `plm-e2e/` |
| Historical focused scripts before full source/config audit extension | 224/224 PASS, 0 failed/skipped; 93 + 118 + 13 | `.artifacts/native-model-design-inputs/regression-20261006-safety/focused-tests.log` |
| Historical whole suite after overlay tests, before audit extension/new tooling | 905/905 PASS, 0 failed/skipped; 40.03 s | `.artifacts/native-model-design-inputs/regression-20261006-safety/scripts-tests-source-routing.log` |
| Final post-extension combined focused scripts | 335/335 PASS, 0 failed/skipped; `duration_ms: 12616.6567` | `.artifacts/native-ai-code-deployment/regression-20261006/focused-tests.log` |
| Final post-extension whole scripts suite | 1013/1013 PASS, 0 failed/skipped; `duration_ms: 40303.037063` | `.artifacts/native-ai-code-deployment/regression-20261006/scripts-tests.log` |
| Earlier native browser acceptance after cutover | FAIL, exit 1; prerequisites false; eight failing stages | `.artifacts/native-modeldesign/2026-10-05T18-17-01.168Z/report.json` |
| Latest source-bound native browser acceptance | FAIL, exit 1; prerequisites false; eight failing stages | `.artifacts/native-modeldesign/source-bound-regression-20261006/report.json` |

The old standard API run was `2026-10-05T18:05:30.804Z` to
`2026-10-05T18:05:33.329Z`; both apps failed `configs-same-session-get`,
`configs-update-get`, `configs-other-session-update-get`, `configs-reset-get`,
`configs-roundtrip` and the first `cleanup-get-1`. Final cleanup summaries passed,
but those failures remain failures. Its 48 checks include six extra cleanup-retry
checks triggered by failure; the successful source runs have 42, not skipped
replacement coverage.

The earlier standard source API run was `2026-10-05T18:17:00.722Z` to
`2026-10-05T18:17:03.295Z`, exit 0; anonymous cleanup was not needed. The runtime
report timestamp is `2026-10-05T18:17:00.809Z`. The portal run was
`2026-10-05T18:17:00.922Z` to `2026-10-05T18:17:02.095Z`.
The intermediate 902-test full run remains recorded in
`.artifacts/native-model-design-inputs/regression-20261006-safety/scripts-tests.log`;
it is not the later 905-test result. Both 902 and 905 precede the full
source/config audit extension and new deployment tooling.

The latest source-bound API run was `2026-10-05T18:33:45.942Z` to
`2026-10-05T18:33:48.515Z`, exit 0; both authenticated cleanup summaries passed
and anonymous cleanup was not needed. The business-runtime report timestamp is
`2026-10-05T18:33:46.026Z`. The portal run was `2026-10-05T18:33:46.107Z` to
`2026-10-05T18:33:47.219Z`. These verify their stated runtime gates, not deployment
or acceptance of the separately staged model-design inputs.

The final focused breakdown is main-confirmed: 93 resource + 125 model-input +
13 source-evidence + 3 routing + 101 ai-code = 335. The whole scripts command is
`npm test --prefix scripts`. Reproduce the current focused entry from the
workspace root:

```sh
node --test \
  scripts/tests/repair-native-model-resources.test.mjs \
  scripts/tests/native-model-design-inputs.test.mjs \
  scripts/tests/native-plugin-source-evidence.test.mjs \
  scripts/tests/native-standard-source-platform.test.mjs \
  scripts/tests/native-ai-code-deployment.test.mjs
```

Script regressions do not remove missing-source, full-build or native-acceptance
gates, and do not turn the preserved browser FAIL into PASS.

The separate PLM read-only report starts at `2026-10-05T18:17:58.638Z`,
with `duration: 10401.233` ms, no report errors and both cases passing on retry 0.
Its two passes are `authenticate local PLM` (`setup`) and
`core model APIs are routed correctly` (`desktop`), not two business API cases.
The main thread also confirmed JSONSchema and SysOperator GET checks passing.
Reproduce from `plm-e2e/`, using a fresh artifact directory:

```sh
(
  set -e
  cd "$WORKSPACE_ROOT/plm-e2e"
  RUN_ID="$(node -p 'new Date().toISOString().replace(/[:.]/g, "-") + "-" + require("node:crypto").randomUUID()')"
  export PLM_E2E_ARTIFACT_DIR="$WORKSPACE_ROOT/.artifacts/plm-e2e/source-routing-readonly-$RUN_ID"
  pnpm test:api --project=desktop --retries=0
  pnpm test:config
)
```

This verifies existing PLM API routing and test artifact isolation, not the
native editor, full PLM UI coverage or runtime-model source recovery.

## Separate Input Evidence

After the full source/config audit extension, the main thread generated and
consumer-verified a fresh model-design input receipt:
`.artifacts/native-model-design-inputs/inputs-20261006-config-pinned-first/receipt.json`,
generated at `2026-10-05T18:35:02.328Z` (UTC). Generation and verification each
intentionally exited 2; the receipt declares `source.audit.inputFiles: 72` and
`source.audit.inputFingerprint` equal to
`a2eff77ed8cdefebfa24636620baa77b8e067458d92033edb0492465ca21ed06`.
The staged 1486 files are 72 source/config + 1414 repaired JSON resources,
with package fingerprint
`f01090611643590f974a5ebacbf1b928f5ce29bb47fcbc9e7b459c1c16154538`.
Resources belong at `package/public/assets/json/runtime-model`, the declared
CLI copy input, not proof of a full plugin build.

Actual generation and consumer captures are
`.artifacts/native-ai-code-deployment/regression-20261006/model-design-generate-cli.json`
and
`.artifacts/native-ai-code-deployment/regression-20261006/model-design-verify-cli.json`.
Their parent directory name does not change their model-design scope.
Persisted status is `prepared-build-blocked`; the consumer returns
`verified-inputs-build-blocked`, `inputIntegrityVerified: true`.
`buildReady`, `acceptedForProduction` and `runtimeModelSourceRecovered` remain
false; requested alpha.90 / candidate alpha.122 compatibility is `not-verified`.
These inputs were not deployed by the platform-routing change. The runtime
reports above precede this input receipt's generation and do not validate it.

Older receipts without the extended `source.audit.inputFiles` and
`source.audit.inputFingerprint` are historical only, even with matching top-level
fingerprints or unchanged numeric schemaVersion. Do not retrofit or reuse them.
Generate a fresh candidate and verify its exact receipt before every use.
The Linux `/proc/self/fd`, trusted ancestor and cooperative single-writer
prerequisites still apply: current artifact parents are `0775`, UID/GID `1000`,
so owning-UID, writable-group and same-UID/root writers must be trusted.
Private `0700` children cannot stop writable-parent rename; pinned reads are
not an atomic multi-file snapshot or arbitrary replacement/publication guarantee.
Preserve partial/ambiguous failed candidates without automatic cleanup and retry
only into a fresh destination. Receipt existence is never proof of success.
The complete generation/verification and safety contract is in
[NATIVE-MODEL-DESIGN-BUILD-INPUTS.md](NATIVE-MODEL-DESIGN-BUILD-INPUTS.md).
The separate ai-code candidate workflow is in
[NATIVE-AI-CODE-DEPLOYMENT.md](NATIVE-AI-CODE-DEPLOYMENT.md); neither satisfies
model-design build or native-editor acceptance.

## Native Acceptance Still Fails

The latest report,
`.artifacts/native-modeldesign/source-bound-regression-20261006/report.json`,
records `prerequisiteChecksPassed: false`,
`pluginAssetsVerified: false`, eight failing stages, Central startup true and
ModelDesign startup false. All pinned package manifests below return HTTP 404:

| App | Exact package | Failed manifest |
|---|---|---|
| Central | `@ibiz-template-plm/drbar-ex@0.0.3-dev.51` | `/central/plugins/@ibiz-template-plm/drbar-ex@0.0.3-dev.51/package.json` |
| Central | `@ibiz-template-plm/list-tree@0.0.2-dev.145` | `/central/plugins/@ibiz-template-plm/list-tree@0.0.2-dev.145/package.json` |
| Central | `@ibiz-template-plm/route-picker@0.0.2-dev.142` | `/central/plugins/@ibiz-template-plm/route-picker@0.0.2-dev.142/package.json` |
| Central | `@ibiz-template-plugin/model-design@0.0.3-alpha.90` | `/central/plugins/@ibiz-template-plugin/model-design@0.0.3-alpha.90/package.json` |
| ModelDesign | `@ibiz-template-plugin/ai-code@0.0.3-alpha.92` | `/modeldesign/plugins/@ibiz-template-plugin/ai-code@0.0.3-alpha.92/package.json` |
| ModelDesign | `@ibiz-template-plugin/console-terminal@0.0.3-alpha.87` | `/modeldesign/plugins/@ibiz-template-plugin/console-terminal@0.0.3-alpha.87/package.json` |
| ModelDesign | `@ibiz-template-plugin/file-to-base64@0.1.8-alpha.165` | `/modeldesign/plugins/@ibiz-template-plugin/file-to-base64@0.1.8-alpha.165/package.json` |
| ModelDesign | `@ibiz-template-plugin/global-util-design@0.0.3-alpha.87` | `/modeldesign/plugins/@ibiz-template-plugin/global-util-design@0.0.3-alpha.87/package.json` |
| ModelDesign | `@ibiz-template-plugin/img-to-base64@0.1.8-alpha.144` | `/modeldesign/plugins/@ibiz-template-plugin/img-to-base64@0.1.8-alpha.144/package.json` |
| ModelDesign | `@ibiz-template-plugin/layout-design@0.0.3-alpha.90` | `/modeldesign/plugins/@ibiz-template-plugin/layout-design@0.0.3-alpha.90/package.json` |
| ModelDesign | `@ibiz-template-plugin/logic-tree-design@0.0.3-alpha.56` | `/modeldesign/plugins/@ibiz-template-plugin/logic-tree-design@0.0.3-alpha.56/package.json` |
| ModelDesign | `@ibiz-template-plugin/model-design@0.0.3-alpha.90` | `/modeldesign/plugins/@ibiz-template-plugin/model-design@0.0.3-alpha.90/package.json` |

Manifest delivery failure alone is not proof that original source is absent.
No package substitution or version upgrade is authorized by this routing change.
Central navigation also rejects `FetchDefault` as `DATAQUERY`, not a remote
`FETCH`. ModelDesign waits 20 seconds for a password input without initializing
login/home, and records four unexplained browser errors following the
`global-util-design` manifest 404 and global utility initialization failure.

Native editor operations, model save and fresh-session model readback remain
unaccepted. Full `runtime-model@0.2.2` source/build evidence and native plugin
source/version acceptance remain separate unresolved gates. No full localization,
runtime source recovery or production acceptance is claimed.
