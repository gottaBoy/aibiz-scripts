# Owned MySQL Container Recreation

Checkpoint: November 5, 2026, Asia/Singapore.

The subsequent `OWNED-MYSQL-COLD-BACKUP-RESTORE-20261106.md` verifies four
physical cold restores after deleting the source volume, across two fresh
188-check deployments. Historical receipts below are unchanged. Same-host
fixture recovery does not close production/off-host or host/power-loss gates.

This extends `OWNED-MYSQL-VOLUME-RESTART-20261105.md` with an explicit
replacement-container contract. Same-container restart, container recreation,
host restart, power-loss recovery and backup/restore remain distinct gates.

Final evidence directory: `.artifacts/native-mysql-recreation-20261105-r3/`.
Exploratory attempts remain separately recorded under `-r1/` and `-r2/`.

## Verified Results

| Topology | Fixture | HTTP Checks | MySQL Recreations | Provider Restarts |
| --- | --- | ---: | ---: | ---: |
| Two centers, two physical libraries | `4e04fddaf40e` | 188 passed | 2 | 2 |
| One center, two physical libraries | `f04b0e2fc822` | 188 passed | 2 | 2 |

Both final runs pass the actual native matrix and independent journal/database
audit. Each uses three distinct MySQL container IDs over its two replacements,
one unchanged disk volume, two physical libraries and six ordinary identities.
`two-center-final.json` and `same-center-final.json` independently bind the
original reports, prove old-container absence, re-query every module/system
column, verify native probe removal and MODELVER 816 -> 819 in each library,
and compare SQL grants, UAA members and the EBSX read-only projection.

Final maintained-code full scripts: **4512 passed**, zero failures/skips
(`scripts-full-v1.log`). The storage/recreation/deployment focused run passes
**169 tests** (`focused-v1.log`). Runtime doctor and four native frontend
deployment checks pass. The live ledger remains **6 FAIL / 3 WARN**.
These green checks do not replace unfinished global gates.

## Cleanup And Integrity

Both final deployments pass the maintained journal-aware retirement path:
eight current peers are removed in service-first/MySQL-last order, both old
MySQL IDs are proved absent, and the original volume is removed only after
fresh identity inspection and zero remaining references.

`cleanup-and-integrity.json` independently audits all six exploratory/final
fixtures plus the offline configuration helper: **62 container IDs, 50 helper
names, six networks and six volumes** are absent. No run-labeled containers
remain, and the full container-ID inventory equals the fresh pre-run baseline.
All sixteen protected shared project containers retain their exact IDs, images,
startup times, restart counts and mounts, including the exploratory phase.

The broader 317-container inventory has unchanged identities/images/mounts,
but unrelated `mattermost` and `sub2api-redis` have changed lifecycle counters
and `unless-stopped` policies. Those observations remain explicit;
`allPreExistingLifecyclesUnchanged=false`. This task did not operate them and
does not assert a causal explanation or whole-host lifecycle equivalence.

The final documentation/storage/recreation contracts pass **152 tests** with
zero failures/skips (`contracts-docs-final-v2.log`). `closeout.json` hash-binds
maintained code, fixture reports, journal records, independent audits and
regression logs without publishing private runtime settings.

## Implementation

`owned-mysql-recreation.mjs` only accepts the explicit ARM64 owned-volume
profile. Before a destructive command it verifies the whole private deployment,
the exact current MySQL ID/image/name, the original volume identity and its sole
container reference, and the selected local Docker Unix socket.

The private append-only journal records intent, successful orderly shutdown,
old-container removal/typed absence, replacement creation and verified readback.
Each transition binds the original manifest, SQL receipt, resource journal and
deployment bytes. A second transition must bind its verified predecessor.
Original `owned-resources.json`, SQL and backend reports are never rewritten.

The original MySQL is stopped with a 60-second grace period. A nonzero exit,
OOM kill, missing ownership, external volume reference or changed configuration
cannot reach an accepted replacement. The old container is removed without
force, its absence is independently checked, and the volume must then have no
container references.

The replacement uses the original immutable image, private settings, hostname,
private IPv4 address, read-only rootfs, non-root user, exact reviewed temporary
storage and original no-copy data volume. Its container ID and network endpoint
must be new. Secrets pass to the local Engine API over stdin, not command-line
arguments or public reports. Remote contexts, creation warnings and new storage
defaults cannot silently pass.

## Created And Running States

Creation submits the original Config and HostConfig directly to the local
Engine. This avoids `docker create`'s stdout/stderr attachment defaults, which
differed from the original detached container and correctly failed the first
live attempt.

The reviewed local Engine returns `OomKillDisable=false` immediately after
creating a container from an explicit null value; after starting it returns
null again. A separate offline, never-started, no-volume helper reproduced the
creation behavior. The created-state check permits only that exact
normalization; the running-state check still requires every original Config
and HostConfig value, including the null OOM setting. Hashes canonicalize object
key order without dropping fields. No generic ignored-field policy is used.

Verified journal entries carry the actual running-state witness, not the
pre-start witness. Retirement distinguishes never-started and previously
started containers and checks the corresponding exact witness. Incomplete
intent/removal/creation records remain available for owned disposal, but
cannot satisfy recreation or native acceptance.

## Native Verification

The matrix retains the native updated module probe while replacing MySQL.
It requires:

- A genuinely new MySQL container and network endpoint, with the original
  immutable image, private address, Config, HostConfig and every data mount.
- PID 1 `mysqld` and successful TCP `SELECT 1`, not an initialization child.
- The same database server UUID, `/bitnami/mysql/data/`, durability settings,
  actual disk filesystem and volume identity; InnoDB commit flushing remains 1.
- Exact complete module/system snapshots in both physical libraries while the
  updated probe exists. Other owned service configuration and lifecycles must
  not change during MySQL replacement.
- Owned provider restart followed by normal login/appdata initialization and
  readback across all six ordinary editor/viewer/no-access identities.
- Native API probe removal, exactly three MODELVER increments per library,
  unchanged unrelated/foreign fields, UAA membership, scoped SQL grants,
  EBSX read-only view/definer/grants and locked projection account.

`ownedMysqlContainerRecreationVerified` is a bounded observation flag.
`durableRestartAcceptance`, `nativeAcceptance`, `permissionAcceptance` and full
backend `applicationInitializationVerified` are not promoted by it.

## Failure History

Earlier failures remain failures:

- A concurrent backend launch failed during the fixed-name image-identity
  probe. A fresh serial retry passed; no identity check was removed.
- The first CLI-created replacement changed stdout/stderr attachment flags.
  Its matrix and cleanup-restoration checks failed. It was disposed only after
  independent exact ownership, image, volume and private-network checks; disposal
  did not turn the failed native probe cleanup into success.
- An Engine-created deployment passed 188 HTTP checks but its independent
  journal audit rejected the pre-start OOM witness. That audit failure and its
  explicit disposal receipt remain in `-r2/`. New fixtures use the corrected
  created/running-state contract, not modified historical receipts.

The fixed-name candidate-image probes must not run concurrently. Backend
verification was serialized for the final runs. This does not certify a new
concurrent launcher workflow.

## Reproduction

Create a fresh retained owned-volume SQL fixture and fresh accounts, workflow,
EBSX, UAA/Redis and backend reports as in the previous checkpoint, then:

```sh
node scripts/run-owned-native-permission-http.mjs \
  --execute-owned-native-matrix --allow-owned-probe-mutations \
  --recreate-owned-mysql --restart-owned-provider \
  --run-id=OWNED_RUN_ID --label=UNIQUE_MATRIX_LABEL \
  --deployment-input=.artifacts/native-nonadmin-fixtures/OWNED_RUN_ID/backend-runtime-BACKEND_LABEL/deployment-input.private.json

node scripts/retire-owned-native-fixture.mjs \
  --retire-owned-volume --run-id=OWNED_RUN_ID --label=UNIQUE_RETIREMENT_LABEL \
  --deployment-input=.artifacts/native-nonadmin-fixtures/OWNED_RUN_ID/backend-runtime-BACKEND_LABEL/deployment-input.private.json \
  --mysql-recreation-journal=.artifacts/native-nonadmin-fixtures/OWNED_RUN_ID/native-http-UNIQUE_MATRIX_LABEL/mysql-recreations
```

MySQL restart and recreation options are mutually exclusive. Both require the
explicit native mutation option and reviewed persistent profile. Disposal after
recreation requires the explicit journal path; it never guesses a replacement
from a container name or edits the original resources to substitute a new ID.

## Remaining Gates

Host/daemon restart, power loss, backup/restore and production migration remain
unverified. Full invalid-root/grant/session/holder/cache-rotation permissions,
service OAuth/aliases, English completeness, marketplace offline install/update,
all plugin behavior, original-source/license provenance, clean offline rebuild
and source/release deployment alignment remain incomplete.
