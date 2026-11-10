# Owned Extension Runtime Candidate

Date: 2026-11-08

## Status

Added `replace-owned-allinone-extension.mjs` and focused tests. This work has not
executed a Docker/SQL mutation. Focused tests: 15/15 passed. The runner remains
a candidate for parent review and explicitly authorized execution.

A read-only check of the actual `platform-schema-platform-r5` configuration and
the retained allinone properties confirmed that exactly 15 extension keys are
added and all original 106 keys are retained.

## Boundary

- Open the explicit owned runtime and require exactly eight declared peers.
- Reverify the recorded source images/package and the verified platform schema
  receipt before changing the allinone container.
- Preserve the original allinone private IP, port, hostname, original DNS name
  and aliases, Java entrypoint/arguments/environment, JWT, EBSX/UAA bindings,
  workflow bindings, cache settings and model/cache path configuration.
- Only add the real `ownedplatform` datasource and native `extension`
  deploysystem. Schema update, extension model reload and install-data remain
  disabled.
- Keep MySQL, UAA, Redis, Nacos, ZooKeeper, provider and gateway identity,
  configuration, mounts, network and lifecycle unchanged.
- Stop/detach only the original owned allinone and retain it for rollback.
- Use a new exclusive artifact directory, CID file and random ownership label.
  Partial create recovery must prove name/image/run/label/token ownership before
  removing an immutable container ID. A foreign collision is never removed.
- Support a created-but-not-started candidate through exact read-only declared
  mounts, without pretending that it is running.
- Require HTTP startup, a bounded stability interval without fatal startup
  logs, actual anonymous denial, and six source-account logins/native extension
  read requests. A listening HTTP port alone does not pass.
- On failure restore only the original allinone and require its non-fatal HTTP
  readiness. Refuse unsafe recovery after protected-peer or original-input
  drift.
- Write a new deployment input changing only `services.allinone`; the gateway
  backend endpoint and all UAA endpoints remain unchanged.

The allinone's `/tmp` is ephemeral tmpfs. Process-local/tmpfs cache bytes cannot
survive a process replacement and are not claimed as preserved. Their source
configuration, immutable model image and protected Redis/ZooKeeper remain
unchanged; local caches rebuild through the native runtime.

## Nacos

No Nacos publication occurs in this runner. It emits
`gateway-extension-route.candidate.json`, also available through the pure
`extensionGatewayRoute(runId, oldAllinoneName)` helper. The candidate routes
`/extension/**` to the preserved original allinone DNS name and port 30000,
without a static response, rewrite or compatibility handler.

The parent must separately guard, review, publish and read back the real
`appgateway-default` extension route. Copied Nacos startup snapshots are marked
as not republished and are not claimed as live readback.

## Execution

After review, use a new label and explicit replacement opt-in:

```sh
node scripts/replace-owned-allinone-extension.mjs \
  --replace-owned-allinone-extension \
  --run-id=5d3585516a77 \
  --label=extension-r1 \
  --deployment-input=.artifacts/native-nonadmin-fixtures/5d3585516a77/backend-runtime-uaa-refresh-aliases-r1/deployment-input.private.json \
  --platform-report=.artifacts/native-nonadmin-fixtures/5d3585516a77/platform-schema-platform-r5/report.json \
  --image-report=.artifacts/backend-source-images-current-20261107-r4/report.json
```

The output directory is `backend-runtime-extension-r1`. Previous receipts,
container definitions and config files are never overwritten. Private
configuration, transition journals and logs stay owner-private; public report
fields contain hashes, IDs and bounded evidence, not passwords or tokens.

## Remaining Acceptance

Even a passing runner receipt establishes only bounded owned extension runtime
reads. Full extension create/update/remove flows, authorization isolation,
gateway forwarding, browser workflows and durable rollback operation require
their own receipts. The parent owns the directory seed and gateway publication
work; this runner changes neither.
