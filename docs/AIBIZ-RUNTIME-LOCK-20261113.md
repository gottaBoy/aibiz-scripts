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

### Retained Version Decision

Retain the existing shared runtime below. Newer UUID/configuration test builds
are not promoted merely because their tag or creation date is newer.

| Component | Retained tag | Local image ID prefix |
| --- | --- | --- |
| Modeling Web, Central, ModelDesign | `aibiz/modelingweb:local` | `d4728f7032a0` |
| UAA | `aibiz/standalone-uaa:editable-214b8d419b41` | `8f65be60bd12` |
| Modeling service | `aibiz/modelingservice-arm64:current-20261107` | `0a0d4391f55f` |
| EBSX allinone | `aibiz/ibiz-ebsx-allinone-rt:current-20261107` | `0823e8b5dd2b` |
| EBSX gateway | `aibiz/ibiz-ebsx-gateway:current-20261107` | `256d7e7ade13` |
| PLM Web | `aibiz/plmweb:local` | `027de06a1f8d` |
| PLM service | `aibiz/plmservice:local-key-refresh-20261008` | `3988b0d18f23` |
| Task | `aibiz/task7:source-built-2798cec3` | `aa1bdb6dd01a` |
| Modeling plugins | `aibiz/modeling-plugins:local` | `8801449b02e4` |
| Nacos | `aibiz/nacos-server:v2.0.3-jre17` | `45bba63526de` |

The checked-in overlay contains full SHA-256 IDs; these short prefixes are
only for human comparison. This decision preserves the current baseline,
not a claim that the outstanding UI/API errors have been fixed.

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

## Resource Relief

The earlier retain-all decision was superseded by the user's explicit request
to relieve host resource pressure on November 13. Scope remains aibiz only.
No global prune command is authorized.

Completed:

- Stopped all 26 running owned validation containers across runs
  `25dd6a7232c7`, `96ff5681e447` and `5d3585516a77`.
- Stopped the two exact owned frontend forwarding processes, verifying PID,
  UID, kernel birth time and command identity before signalling.
- Captured private container inspections, bounded log tails and transient
  Nacos/ZooKeeper configuration/data archives before stopping.
- Backed up all databases, routines, events, triggers and account data for
  the three tmpfs MySQL instances. Restored each into an isolated
  network-none helper, one at a time; normalized application schema/data
  and grant-table dumps matched SHA-256. All three helpers were removed.
- Kept all 12 shared services running on their pinned image IDs.
  No shared restart or replacement was performed.

Final verification completed at **2026-11-13 20:46:22 +08:00**:

| Result | Count |
| --- | --- |
| Historical containers archived and removed | 247 |
| Owned validation containers backed up and removed | 26 |
| Shared aibiz services retained, without restart | 12 |
| Related stopped containers remaining | 0 |
| Owned running validation containers remaining | 0 |
| Empty owned internal networks removed | 3 |
| Unrelated containers removed | 0 |
| Referenced pre-existing volumes verified present | 164 |
| Images / volumes deleted | 0 / 0 |

Measured host memory: approximately **64.6 GiB -> 29.4 GiB used**,
**55.0 GiB -> 90.3 GiB available**. Swap remained partly occupied;
no global swap reset was performed. These are host-wide measurements.

Each target had a positive aibiz ownership/image/owned-volume witness.
Changed file contents were archived and tar-read-verified before `docker rm`;
mount contents were excluded from those archives and all volumes and bind
sources retained. One old `modelingservice-source-smoke` container had a
pre-existing invalid file bind; its root filesystem was exported and verified
without changing the host bind source. Parent-directory metadata changes and
deletions remain recorded in `docker diff`. This is a data-preservation
archive, not a tested whole-stack automatic rollback.

Removed writable layers total approximately 19.2 GiB; retained changed-file
archives total approximately 6.6 GiB, excluding SQL backups and other evidence.
This is not a measurement of net disk space recovered. All 165 aibiz tags /
155 unique image IDs remain available; image tags do not consume running
container memory.

Exact non-target container IDs and configurations were checked against the
initial snapshot. Shared aibiz services and backing `mysql`, `redis`, `zoo1`,
`emqx` retained their start times and restart counts. The image-lock regression
tests passed 12/12. These four actual page entrypoints returned HTTP 200:

- PLM: `30250/ibizplm-plmweb/`
- Central: `32008/central/`
- ModelDesign: `32009/modeldesign/`
- Modeling Web: `32003/modeldesign/`

Page availability does not close the user-visible issues below.

Private evidence root:

`.artifacts/aibiz-resource-relief-20261113-r1/`

Database restoration evidence:

`mysql-attempt-3/mysql-backup-report.private.json`

Final scope/count/service verification:

`final-report.private.json`

Historical and fixture removal manifests:

`historical-r5/report.private.json`, `stopped-fixtures/report.private.json`

The first two restore attempts caught a temporary initialization-server
readiness race; neither authorized stopping a source database. The successful
attempt additionally required the final `mysqld` process to be PID 1.

The retired tmpfs fixtures cannot be recovered by `docker start`: their
containers and private networks were removed. Recreation requires restoring
the verified SQL backups and rebinding the owned runtime inputs. Historical
receipts describe past runs, not currently running resources.

For subsequent development, use one owned validation stack at a time, on
demand, and tear it down after verification. Do not automatically recreate
the three retired stacks or start a full container-backed test suite just
to check documentation or source-only changes. This is an operating policy,
not a claim that every existing launcher enforces a resource budget.

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
