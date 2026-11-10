# Owned MySQL Volume Restart

Checkpoint: November 5, 2026, America/Los_Angeles.

The subsequent `OWNED-MYSQL-CONTAINER-RECREATION-20261105.md` adds two fresh
188-check deployments with two journaled MySQL container replacements and two
provider restarts each. Original receipts below are unchanged; host restart,
power-loss, backup/restore and global acceptance remain open.

**Both center topologies pass native ordinary-user CRUD and fresh-login
readback after orderly disk-backed MySQL and provider restarts.** This is
same-container restart evidence, not container recreation, host restart,
power-loss recovery, production migration or complete localization acceptance.

Evidence: `.artifacts/native-mysql-volume-20261105-r1/`.

## Actual Results

| Topology | Fixture | HTTP Checks | MySQL Restarts | Provider Restarts |
| --- | --- | ---: | ---: | ---: |
| Two centers, two physical libraries | `c0ddfad4fafa` | 188 passed | 2 | 2 |
| One center, two physical libraries | `73d60403d58a` | 188 passed | 2 | 2 |

Matrix reports, under `.artifacts/native-nonadmin-fixtures/`:

- `c0ddfad4fafa/native-http-disk-two-center-r1/report.json`
- `73d60403d58a/native-http-disk-same-center-r1/report.json`

Each independently created deployment passes 55 SQL fixture checks, 32 scoped
application-account checks, exact-library workflow initialization, EBSX schema
and read-only membership projection checks, and sixteen real UAA/TokenStore
security checks before backend startup. Six ordinary users cover editor,
viewer and no-access roles for both roots. Logical system/module IDs overlap
between the physical databases; distinct sentinels prove physical selection.

After each native UPDATE, the runner keeps the updated probe in SQL, restarts
only its exact owned MySQL container, verifies readiness, compares the complete
module/system rows in both libraries, then restarts only its owned provider.
All six identities authenticate normally again and read or are denied according
to their actual root/role. Normal appdata initialization remains required.
The deliberately short 20-second server token lifetime is unchanged.

Both probes are removed through the native editor API. Each selected physical
system advances MODELVER exactly 816 -> 819 for CREATE/UPDATE/REMOVE. Every
other original/foreign module and system field remains equal. Independent
`two-center-final.json` and `same-center-final.json` re-query every field,
compare final snapshots, verify probe absence, scoped SQL grants, unchanged UAA
membership rows, the unchanged EBSX view/definer/grants and locked projection
account, and hash-bind the restart witnesses and original resource journal.

## Storage Contract

`mysql57-bitnami-arm64-owned-volume` is a separate explicit profile using the
same reviewed immutable MySQL 5.7.41 image and non-root `1001:1001` runtime.
The existing tmpfs profiles still reject all persistent volumes.

`owned-mysql-volume.mjs` enforces:

- A fresh exact `nf-RUNID-mysql-data` name, run label, random nonce label,
  creation timestamp and local Docker data directory. Existing volumes are
  never adopted. Local driver/scope and zero device/network options are required.
- Actual `docker volume inspect` plus full-length, all-container reference
  enumeration, including stopped containers. The sole reference must be the
  exact owned MySQL, or the exact short-lived initializer during preparation.
- `volume-nocopy` with no host binds or inherited mounts. An offline, read-only
  helper from the pinned image first requires an empty volume, then sets only
  its directory permissions/owner. Its only added capability is `CAP_CHOWN`;
  its exact identity is journaled and it is removed before MySQL starts.
- Read-only MySQL rootfs, unchanged reviewed tmpfs options for configuration,
  logs, temporary files and masked seed directories, and one exact data mount.
- A local Docker Unix socket and kernel mount-table evidence. This machine's
  actual volume path is on `/dev/nvme0n1p2`, `ext4`, not tmpfs, overlay or NFS.
  The deepest matching filesystem wins; ambiguous overmounts are rejected.

SQL provisioning, account/schema guards, UAA, backend startup, native HTTP
checks and the frontend-owned deployment input inspect this storage contract.
An omitted actual volume inspection cannot satisfy a persistent profile.

Each restart preserves container ID, image, name, Config, HostConfig, every
mount, database server UUID, datadir and durability settings, while requiring a
different startup timestamp and PID 1 `mysqld` plus successful TCP `SELECT 1`.
`innodb_flush_log_at_trx_commit=1` is required. Before/after physical snapshots
and filesystem evidence are retained. No receipt is rewritten to pretend a
new container has the original identity.

## Cleanup And Regression

`--retire-owned-volume` is explicit and mutually exclusive with
`--retire-owned-tmpfs`. The persistent path checks all eight exact owned peers,
removes service peers before MySQL, and removes the exact volume only after
fresh identity inspection and proof that no container references remain.
The tmpfs path still refuses persistent storage. Disposal never retroactively
turns a failed native cleanup into permission acceptance.

`cleanup-and-integrity.json` independently confirms 19 exact container IDs,
17 named helpers, four networks and four new volumes absent across the two
early failures and two completed deployments. No containers remain for these
run labels. All sixteen protected shared container IDs, images, startup times,
restart counts and mounts match the fresh current-turn baseline.

The broader 317-container observation retains a separate failure: unrelated
`mattermost` and `sub2api-redis` changed startup/restart counters and have
`unless-stopped` policies. Their identities/images/mounts did not change; no
causal explanation is asserted and this task did not operate them.
`allPreExistingLifecyclesUnchanged` remains false, and
`audit-cleanup-v1.log` is preserved. Protected-project integrity is not a claim
that every container on the host had an unchanged lifecycle.

Two early failed attempts remain recorded: volume-directory traversal was not
available to the current host user, and Docker records the initializer's
capability as `CAP_CHOWN`. The first is addressed with the actual kernel mount
table, not a guessed filesystem; the second now requires Docker's exact
normalized capability value. Their new resources were removed.

Current-source full scripts: **4474 passed**, zero failures/skips
(`scripts-full-v2.log`). `volume-focused-v3.log` records the storage/restart
negative contracts after the capability correction. The later documentation
and contract checks pass **229 tests**, zero failures/skips
(`contracts-docs-final.log`). Runtime doctor and four native frontend
deployment checks pass. The live ledger remains **6 FAIL / 3 WARN**.

## Reproduction

Use the existing SQL fixture command with explicit selection:

```sh
node scripts/tests/run-owned-native-nonadmin-fixture.sql.mjs \
  --execute-owned-sql-smoke \
  --mysql-image=sha256:2e7e2b4ae4494b2bb9fe9d2ad4b6510790d714ba2e60af2f0df5aaca44f0c28f \
  --database-profile=mysql57-bitnami-arm64-owned-volume \
  --subnet=UNUSED_PRIVATE_24 \
  --uaa-model=standalone-uaa/source/uaa-core/src/main/resources/sysmodel/uaa.json \
  --uaa-schema-mode=standalone-tables --scenario=two-center --model-version=816 \
  --retain-owned-sql-fixture
```

Check existing Docker subnets and host routes before selecting the subnet.
Provision fresh application accounts, workflow, EBSX, UAA/Redis and backend
reports for that run, then:

```sh
node scripts/run-owned-native-permission-http.mjs \
  --execute-owned-native-matrix --allow-owned-probe-mutations \
  --restart-owned-mysql --restart-owned-provider \
  --run-id=OWNED_RUN_ID --label=UNIQUE_MATRIX_LABEL \
  --deployment-input=.artifacts/native-nonadmin-fixtures/OWNED_RUN_ID/backend-runtime-BACKEND_LABEL/deployment-input.private.json

node scripts/retire-owned-native-fixture.mjs \
  --retire-owned-volume --run-id=OWNED_RUN_ID --label=UNIQUE_RETIREMENT_LABEL \
  --deployment-input=.artifacts/native-nonadmin-fixtures/OWNED_RUN_ID/backend-runtime-BACKEND_LABEL/deployment-input.private.json
```

## Remaining Gates

The bounded `ownedMysqlVolumeRestartVerified` flag is true for both new runs.
Global `durableRestartAcceptance`, `permissionAcceptance`, `nativeAcceptance`
and backend `applicationInitializationVerified` are not promoted.

- MySQL container recreation with the same verified volume needs an explicit
  replacement-container receipt/deployment contract; host restart, power loss,
  backup/restore and production migration remain untested.
- Invalid-root, zero/negative/expired-grant, session/holder and cache/connection
  rotation HTTP dimensions remain incomplete.
- Required service OAuth/aliases and full application initialization remain
  separate gates.
- English completeness, marketplace offline install/update, all plugin
  behavior, original-source/license provenance, clean offline rebuilding and
  source/release deployment alignment remain incomplete. The 23 marketplace
  apps and 73 PLM runtime plugins are distinct inventories.
