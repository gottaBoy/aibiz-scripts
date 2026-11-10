# Owned ModelDesign Frontend Launcher

## Scope

`scripts/launch-owned-native-modeldesign.mjs` launches only the two new owned
Central/ModelDesign frontends described by a current, reviewed
`native-model-design-owned-backend-launch-input-v1` preparation. It does not
restart the eight backend nodes, attach a shared network, alter backend data,
mock an API, or declare native/permission/production acceptance.

No real Docker operation was performed while implementing this launcher.

## Checks

- Launch and cleanup require separate explicit opt-in flags and exact SHA-256
  bindings. Existing evidence is never overwritten.
- Source/runtime assets, source image receipts, original launch evidence,
  all mounted file/tree fingerprints, private deployment input, and all eight
  backend nodes are revalidated. A green receipt flag is insufficient.
- Persisted Docker arguments are compared with a complete reconstruction.
  The launcher executes the reconstructed arguments, removes `--publish`, and
  adds a run-owned CID file and random invocation-token label. Arbitrary arguments, entrypoints, roots,
  mounts, commands, networks, and cleanup operands are rejected.
- Both frontend names and loopback ports must be unused. Container image,
  labels, environment/root, read-only mounts, healthcheck, absent publication,
  and one exact private network attachment are checked after creation.
  `HostConfig.Tmpfs` must always be exactly `/dist` with uid/gid 101 and mode
  0755. Docker daemons may omit tmpfs from `Mounts`; if reported there, only one
  writable `/dist` tmpfs with no host source is allowed. Bind mounts remain an
  exact read-only inventory, and other mount types/destinations are rejected.
- The internal network remains internal. Dedicated raw TCP bridges listen on
  `127.0.0.1` and connect only to an inspected RFC1918 frontend endpoint. No
  HTTP response or API fallback is synthesized.
- Each bridge pins its private specification, launcher bytes, input binding,
  both frontend images/configurations, the complete eight-node backend
  lifecycle/configuration/storage witness, network membership and private
  endpoint. Every new TCP connection rechecks all original context files,
  including private credentials and deployment configuration, by content hash
  and private-file permissions. Both frontends must pass complete validation
  before their exact IDs are filtered from the network inventory; the original
  strict eight-node backend validator is then used without relaxing its peer
  rules.
- If Docker exposes subnet allocation status, each actual `IPsInUse` must equal
  its bound baseline plus the number of already validated frontends in that
  exact subnet, and `DynamicIPsAvailable` must decrease by the same count.
  Only those two proved counter deltas are projected back to baseline. Every
  other network/status field must remain exactly equal; the original complete
  topology witness and strict backend validation still apply. Private baseline,
  attached-network and allocation-proof files retain the evidence, including
  the actual attached network when a counter proof fails.
- Startup hashes all mounted bytes between two matching metadata snapshots.
  Every connection re-enumerates every directory and checks each path's
  device/inode/mode/size/mtimeNs/ctimeNs identity, including empty directories.
  Each stat and directory inventory must remain stable across inspection.
  A changed entry is rejected rather than silently rehashed or adopted.
- Bridge cleanup checks the effective user, executable, exact argv hash, and
  Linux `/proc` start ticks before signalling its PID. Startup also checks that
  the process owns the exact loopback listening socket.
- Spawn failures are handled before identity adoption. If synchronous Docker
  inspection prevents SIGTERM handling, cleanup waits five seconds, rechecks
  the complete kernel process identity and sends SIGKILL only to that exact
  process. Forced termination is recorded in cleanup evidence.
- Failed or partial launches retain private state. Rollback and subsequent
  cleanup remove only recorded full container IDs with matching image/labels;
  no cleanup command uses a container name or a broad prune operation.
- Failure records preserve the original error stack in `failure.private.json`
  before cleanup. Only adopted, reverified exact container IDs can have private
  inspect snapshots and the final 200 timestamped log lines captured before
  removal. A foreign name/token collision is never logged. Public reports bind
  these private files by hash without exposing their contents; diagnostic
  collection failure cannot prevent exact owned cleanup.
- Before each Docker run, a private attempt journal binds the name, CID path,
  creation time and unpredictable invocation token. A timeout without a CID
  file can inspect the attempted name but may adopt its ID only when this
  token, creation time, image and all ownership labels agree. Matching names
  and fixture labels alone are insufficient. Later cleanup can recover a
  delayed create using the same immutable attempt journal.

## Integration

The preparation directory basename must match the prepared input's `name`.
Generate a fresh owned-backend preparation after any backend/UAA replacement;
old topology witnesses are intentionally refused.

For an independent source-built frontend, runtime-asset preparation and the
original isolated-input preparation must both receive `--frontend-dist`,
`--frontend-receipt` and `--frontend-receipt-sha256`. Partial options are refused.
The complete framework, type-audit, host source, compiler/toolchain,
import-map recipe and output-byte evidence is reverified; a binding flag alone
is insufficient. Both owned reconstruction paths preserve that exact binding.
The source receipt also becomes a guarded input in the loopback bridge, while
the distribution retains full mounted-tree integrity checks. The legacy
default is unchanged for inputs without an explicit distribution.

```sh
node scripts/launch-owned-native-modeldesign.mjs \
  --input .artifacts/native-model-design-owned-backend/NEW_NAME/input.json \
  --input-sha256 INPUT_SHA256 \
  --deployment-input PRIVATE_DEPLOYMENT_INPUT \
  --deployment-input-sha256 DEPLOYMENT_SHA256 \
  --output .artifacts/owned-native-modeldesign-launch/NEW_RUN \
  --allow-owned-frontend-launch
```

Exit code `2` means the owned frontends are running but native acceptance is
still false. Exit code `1` means refused/failed; inspect the new `report.json`.
The `launch-state.private.json` file exists after successful and partial failed
launches and is owner-readable only.

```sh
node scripts/launch-owned-native-modeldesign.mjs \
  --cleanup-launch .artifacts/owned-native-modeldesign-launch/NEW_RUN \
  --state-sha256 PRIVATE_STATE_SHA256 \
  --allow-owned-frontend-cleanup
```

Cleanup can reclaim already absent bridge processes and partial container
starts. A changed live PID, container ownership, launcher bytes or private state
causes refusal, never a fallback to a name-based kill/delete.
Successful and failed cleanup attempts write fresh `cleanup-<random>.json`
receipts without replacing historical evidence.

## Verification

```sh
node --test scripts/tests/launch-owned-native-modeldesign.test.mjs
```

Result: 39 passed, zero failed/skipped; 118 passed when combined with the
owned-input and runtime-context tests. Coverage includes rehashed argument
injection, shared-network/root/writable-mount substitutions, forged acceptance,
input/deployment/image/lifecycle/mount drift, existing names, occupied ports,
CID-file and no-CID timeout failures, delayed creates, invocation-token
collisions, unexpected peers, bridge spawn failure, cleanup ownership refusal,
full backend/storage/credential drift, same-size content changes with restored
mtime, renamed/replaced/added/deleted files, empty directories, changing stat
results, and a real Node worker with an actual loopback socket and `/proc`
identity that is safely terminated during a blocked inspection.
Both real-daemon tmpfs inspect representations, invalid tmpfs/input mounts,
private error-stack/log retention and diagnostic-collection failure are covered.
Allocation tests reproduce the real `/24` baseline of 11 addresses in use and
245 available, verify the one/two-frontend deltas, account independently by
subnet, and reject unaccounted allocations or any other network/status drift.
The worker test uses a bounded fake read-only Docker executable;
it does not contact the real Docker daemon.

On the current local tree, full mounted hashing read approximately 530 MB in
9,833 ms. The metadata check inspected 50,791 files/directories in 538 ms and
produced an approximately 11 MB private snapshot. These are local observations,
not a latency guarantee. Connection checks still include Docker inspections
and content hashing of all configuration/context inputs. The guard applies
when a TCP connection is accepted, not independently to each HTTP keep-alive
request; continuous request-level authorization remains the real backend's
responsibility.

Remaining acceptance: run this launcher against the fresh real eight-node
deployment, then execute the owned browser home/editor/save/fresh-session and
authorization workflows. Those functional checks are not implied by the
launcher tests and `nativeAcceptance` remains false.
