# Runtime Image Lock And Cleanup

Date: 2026-11-13, Asia/Singapore.

## Scope

The checked-in Compose overlay is:

`scripts/records/aibiz-runtime-images-20261113.compose.json`

It pins the **12 currently observed shared services** to their actual local
image IDs with `pull_policy: never`. It was parsed by the real Compose CLI and
matched against the running containers. It is a local-host image lock, not a
registry manifest digest, a new deployment or an accepted release.

The running containers were not recreated or restarted. Existing Compose
files, environment files and defaults were not overwritten. Include this
overlay last when rendering the reviewed original Compose stack; do not
build/pull over a pinned local image.

Read-only verification:

```sh
node scripts/audit-aibiz-docker-inventory.mjs \
  --verify-lock scripts/records/aibiz-runtime-images-20261113.compose.json

docker compose -f scripts/records/aibiz-runtime-images-20261113.compose.json \
  config --images
```

The overlay alone is not a runnable full stack: it deliberately contains no
ports, credentials, mounts, dependencies or lifecycle commands.

## Corrected Inventory

The v1 inventory used name/image-text filters, dropped real labels/mount
metadata and initially omitted digest-launched containers. Its changing
12/26/36 counts had different scopes and must not be used as cleanup gates.

The v2 collector inspects **all containers**, then associates them by actual
image ID, known shared service, historical name or real ownership labels.
It includes stopped containers and digest-launched/unrelated-name references.
No container or image becomes deletion-eligible from the inventory alone.

Current scope before first alias cleanup:

| Scope | Count |
| --- | --- |
| Shared running services | 12 |
| Retained owned fixture/frontend containers | 26 |
| Total related running containers | 38 |
| Related stopped/historical containers | 247 |
| Aibiz image tags | 167 |
| Unique aibiz image IDs | 155 |

These counts are measurements on November 13, not an instruction to run or
delete 38 services. The retained owned fixtures are separate from the shared
stack.

## First Cleanup

Only two obsolete aliases were removed:

| Removed tag | Preserved tag on the same image |
| --- | --- |
| `aibiz/modelingweb:probe-fixed` | `aibiz/modelingweb:local-fixed` |
| `aibiz/modelingweb:probe-current` | `aibiz/modelingweb:audit-1790522838` |

The cleanup checked every running/stopped container and source/receipt
references before mutation. The aliases occurred only in an observational
historical image inventory, not a deployment/build selector. A durable
pre-mutation journal and exact restoration commands were retained.

Removal used exact tag references, `--no-prune`, no force and no image-ID
deletion. The other tag and image ID were rechecked after each untag.

Result:

- Tags **167 -> 165**; unique image IDs **155 -> 155**.
- All 38 running service identities, images, configuration hashes, mounts,
  networks, start times and restart counts unchanged.
- No containers, writable layers, volumes or networks removed.
- No claim of recovered disk space: duplicate tags share the same layers.
- Build/rollback/receipt-bound UUID tags and all stopped-container-referenced
  images remain protected.

Evidence:

`.artifacts/aibiz-alias-cleanup-20261113-r1/report.json`

The exact cleanup driver remains in that private artifact directory. It is
not a general-purpose removal CLI.

## What The Lock Does Not Freeze

The report measures regular bind-input files and original Compose/env files
by SHA-256 without publishing their contents. Seven mutable directory inputs
are explicitly not frozen; volumes and dynamic Nacos/database state are also
not frozen. In particular:

- `modelingservice` bind-mounts a provider JAR over the image's own JAR.
- PLM serves `dist`, models and a separate `public/plugins` input.
- Candidate Modeling frontends mount models/plugins/runtime assets.
- Startup/readiness scripts are bind-mounted into several services.

Important correction: PLM startup copies local dist first, then overlays
`LOCAL_PLUGIN_SOURCE` into `/dist/plugins`. The observed attention bundle
matches `public/plugins`, not host dist. A restart alone may preserve that
difference. Final release binding must include both inputs, their overlay
order and actual HTTP byte hashes.

## User-Visible Issues Still Open

| Priority | Issue | Next verification |
| --- | --- | --- |
| P1 | SystemJS receives a Promise as a registry URL | Current editable bootstrap awaits resolution; verify rebuilt/served legacy bundle, not only source tests |
| P1 | `srfactiveviewdata` view-state binding error | Verify null/undefined lifecycle and served runtime version in the actual failing page |
| P1 | `spaces/plm_space?id=aibizhi` returns500 | Correlate authenticated request and PLM server exception; do not replace it with empty data |
| P1 | Plugin HTTP bytes differ from local dist | Resolve dist/public overlay provenance before shared rollout |

Image-lock verification does not close any of these UI/API issues.

## Verification

The inventory/lock regression suite passes **12/12**, zero skips:

```sh
node --test scripts/tests/aibiz-docker-inventory.test.mjs
```

Coverage includes real inspect projection/redaction, digest references,
stopped-container protection, ownership/mount guards, mutable-tag drift,
invalid lock rejection, private/exclusive output, host-file measurements and
read-only Docker command enforcement. The complete project test suite was
not rerun for this isolated inventory change.
