# Owned MySQL Cold Backup Restore

Checkpoint: November 6, 2026, Asia/Singapore. Receipt timestamps are UTC.

This extends `OWNED-MYSQL-CONTAINER-RECREATION-20261105.md` with physical
cold backup and recovery into a newly created data volume. Restarting the
original container, replacing a container over the original volume, and
restoring backup bytes after deleting that volume are separate observations.

Evidence: `.artifacts/native-mysql-cold-restore-20261106-r2/`.
The initial rejected preflight and its observation-only follow-up remain
unchanged under `-r1/`.

## Verified Results

| Topology | Fixture | HTTP Checks | New-Volume Cold Restores | Provider Restarts |
| --- | --- | ---: | ---: | ---: |
| Two centers, two physical libraries | `1e88f814fa1e` | 188 passed | 2 | 2 |
| One center, two physical libraries | `df8a1001a464` | 188 passed | 2 | 2 |

Each final restore compares **2,461 regular files and 13 directories**, about
344 MB expanded and about 8 MB compressed, before MySQL starts. Each topology
uses three genuinely distinct MySQL container IDs and three volume identities
over its two recoveries. The backup contains the native updated probe while
the original container and data volume are removed.

`two-center-final.json` and `same-center-final.json` independently re-parse and
hash both archives per recovery, validate the complete transition chain, prove
old-container absence, inspect the actual current volume and re-query every
module/system column in both physical libraries. UAA membership, EBSX view/
definer/grants/locked account and scoped JDBC/application grants remain equal.
Both probes are removed through the native editor API. MODELVER advances
exactly 816 -> 819 per physical library; all other original/foreign fields
remain unchanged. Original resource receipts remain byte-identical.

Current maintained-code full scripts: **4558 passed**, zero failures/skips
(`scripts-full-v1.log`); focused storage/recovery/deployment: **215 passed**
(`focused-v1.log`). Runtime doctor and four native frontend deployment checks
pass. The live ledger remains **6 FAIL / 3 WARN**.

## Cleanup And Integrity

Both final deployments pass journal-aware retirement: eight current service
peers are removed in order, both previous MySQL IDs are proved absent, and the
current volume is removed only after exact identity and zero-reference checks.
The two earlier SQL fixtures and the separate profile-observation instance are
also disposed.

`cleanup-and-integrity.json` independently proves **49 container IDs, 39 helper
names, five networks and five volume names** absent. It records ten distinct
volume identities across the create/delete/restore cycles. No run-labeled or
additional containers remain. All sixteen protected project containers match
the fresh initial baseline in ID, image, startup time, restart count and mounts.

Across the broader 317-container inventory, identities/images/mounts remain
equal but unrelated `mattermost` and `sub2api-redis` show lifecycle drift with
`unless-stopped` policies. The audit retains
`allPreExistingLifecyclesUnchanged=false`; this task did not operate them or
establish a cause for those restarts.

Private cold archives are intentionally retained as evidence, not removed with
the temporary volumes. `closeout.json` binds current source/tests, original and
transition reports, archive bytes, independent audits and regression logs.

## Recovery Contract

`owned-mysql-backup-restore.mjs` only accepts the reviewed immutable ARM64
MySQL 5.7.41 owned-volume profile and a fully inspected run-owned deployment.
Original SQL, resources and backend receipts are not rewritten.

For each native updated probe, the runner:

1. Verifies the exact MySQL/image/private network, source volume identity and
   exclusive references. Captures every module/system field in both libraries,
   the server UUID/settings and actual InnoDB tablespace paths.
2. Requires InnoDB slow shutdown (`innodb_fast_shutdown=0`), an orderly
   zero-exit shutdown and no OOM kill.
3. Runs an exact offline, non-root helper with a read-only source volume.
   GNU tar/gzip streams the whole volume to an exclusive, owner-private file;
   no database credentials or archive payload are printed publicly.
4. Independently parses the archive with Python's standard gzip/tar readers.
   CRC/truncation, duplicate or escaping paths, links, devices, special modes,
   unexpected owners and foreign fixture directories are rejected.
5. Only after backup validation, removes the exact stopped source container,
   proves typed absence, removes the original source volume and proves typed
   volume absence.
6. Creates a new local volume with a new random ownership nonce and creation
   timestamp. An exact owned initializer sets its directory ownership; restore
   requires an empty destination. A separate offline non-root helper extracts
   the pinned original archive as the same reviewed UID/GID, with existing-file
   overwrite prohibited.
7. Archives the restored volume again before starting MySQL. Every file and
   directory path, content hash, size, mode, UID and GID must equal the backup
   manifest. Only then creates and starts the replacement MySQL.
8. Requires a new container ID/endpoint, the original image/configuration,
   private address, database UUID and durable settings, final PID 1 `mysqld`,
   successful TCP `SELECT 1`, exact physical SQL snapshots and unchanged
   configuration/lifecycles of the other seven service peers.
9. Restarts only the explicitly selected owned provider, then performs normal
   six-user login/appdata/readback and native API probe removal.

The volume name remains the exact fixture name for reproducible ownership
checks. It is not its identity: absence before creation, a fresh nonce and
timestamp, empty-target verification and a distinct container prove this is a
new volume, not reuse of the original data. The old database UUID is deliberately
recovered from the backup only after the source is gone; this is not a live
replica with a duplicate identity.

## Archive Boundary

`mysql-cold-backup-archive.mjs` accepts at most 64 MiB compressed, 4 GiB expanded,
20,000 entries and 1 GiB per file. It retains hashes and metadata, not plaintext
business values, in the JSON manifest. Required InnoDB, SQL account and both
physical model-library files must be present. The whole volume is archived,
including MySQL grant tables, UAA, metadata, workflow, EBSX and the read-only
membership view; runtime principals are not recreated with broader grants.

Unconfigured `innodb_data_home_dir` and disabled binary-log paths were observed
as explicit SQL null values in this image. The validator distinguishes these
from external paths and checks the binary-log enabled flag. Actual
`INNODB_SYS_DATAFILES` paths must also stay inside the backed-up data directory.
External durable storage and unknown/crash-fast shutdown modes are refused.

The archive helper has no network, a read-only rootfs, UID/GID `1001:1001`,
all capabilities dropped and exactly one inspected data mount. Source and
verification mounts are read-only; extraction is writable only within the
fresh target volume. Helpers and exact commands are journaled and removed.
Archives are opened through pinned non-symlink directories with private,
exclusive files and are re-hashed before extraction and during independent
audit/retirement.

## Journaling And Cleanup

The append-only journal binds original manifest/SQL/resources/deployment
hashes and records shutdown, backup, source-container/volume removal, target
creation, each helper, cold file verification, replacement creation and actual
SQL readback. A second restore requires its verified predecessor.

`--mysql-backup-restore-journal` is separate from the same-volume recreation
journal. Retirement resolves the current container and volume identity only
through these records. It also handles an explicitly journaled intermediate
state with no MySQL or no volume; unknown references and unrecorded targets
still fail closed. Services are removed before current MySQL, and the current
volume only after its exact identity and zero references are rechecked.
Disposal is not retroactive native cleanup or permission acceptance.

The initial SQL cold preflight failed before archive creation because the
validator treated the observed unset SQL null as an external path. Its owned
container/network/volume were disposed and its failure remains recorded.
A separately owned, empty MySQL instance observed the exact values without
using a shared database. The corrected SQL-only preflight passed 2,233 physical
entries, about 5.7 MiB compressed / 316,320,246 bytes expanded, complete file
comparison and module/system SQL readback. Its resources were also removed.
That preflight alone is not HTTP acceptance.

## Reproduction

Create a fresh owned-volume SQL fixture and fresh accounts, workflow, EBSX,
UAA/Redis and backend reports, then:

```sh
node scripts/run-owned-native-permission-http.mjs \
  --execute-owned-native-matrix --allow-owned-probe-mutations \
  --restore-owned-mysql-backup --restart-owned-provider \
  --run-id=OWNED_RUN_ID --label=UNIQUE_MATRIX_LABEL \
  --deployment-input=.artifacts/native-nonadmin-fixtures/OWNED_RUN_ID/backend-runtime-BACKEND_LABEL/deployment-input.private.json

node scripts/retire-owned-native-fixture.mjs \
  --retire-owned-volume --run-id=OWNED_RUN_ID --label=UNIQUE_RETIREMENT_LABEL \
  --deployment-input=.artifacts/native-nonadmin-fixtures/OWNED_RUN_ID/backend-runtime-BACKEND_LABEL/deployment-input.private.json \
  --mysql-backup-restore-journal=.artifacts/native-nonadmin-fixtures/OWNED_RUN_ID/native-http-UNIQUE_MATRIX_LABEL/mysql-backup-restores
```

Restart, same-volume recreation and backup recovery modes are mutually
exclusive. Backup recovery requires explicit native mutation mode and the
reviewed disk profile. Backend image-identity probes remain serialized because
they use fixed candidate names.

## Remaining Gates

This is a same-image, same-host, stopped-MySQL recovery drill for generated
owned fixtures. The private archives contain SQL data and authentication
material; do not publish them. Encryption, off-host copies, retention policy,
automated schedules, live/point-in-time recovery, crash/host/power-loss behavior,
cross-version migration and production RPO/RTO are not certified. The archive
comparison does not claim ACL/xattr or whole-host backup completeness.

Redis, Nacos, ZooKeeper and application cache backup/restore are outside this
MySQL drill. Global `durableRestartAcceptance`, `permissionAcceptance`,
`nativeAcceptance`, full backend initialization and complete localization
remain false. English coverage, marketplace offline install/update, plugin
behavior, original-source/licenses and release/deployment alignment remain
separate unfinished gates.
