# Owned UAA And Backend Integration

The subsequent 2026-11-04 Asia/Singapore checkpoint is
`OWNED-ZOOKEEPER-AND-STARTUP-GATES-20261104.md`. Owned ZooKeeper now passes its
standalone readiness gate. The current backend failure has advanced to Flowable
schema and datasource initialization. A reproduced late ApplicationRunner
failure is now rejected despite early HTTP success. Earlier receipts below
remain unchanged.

The later `OWNED-WORKFLOW-SCHEMA-20261104.md` advances beyond Flowable with an
independent verified schema. The launcher now requires `--workflow-report`;
the reproduction commands below describe the historical pre-workflow interface.

Checkpoint: November 3, 2026, America/Mexico_City. The new receipts use UTC
timestamps on November 4. This is an isolated prerequisite/startup investigation,
not backend cutover, permission, persistence, complete-source or release acceptance.

Evidence summary directory:
`.artifacts/owned-backend-integration-20261103-r1/`.

## Implemented

- UAA and backend startup select a specific application-account report instead
  of assuming `application-accounts-20261006-integration-r1`. The loader checks
  the run, private file permissions, manifest and private-file hashes, generator
  identity, successful SQL checks, exact principals and scoped grant descriptors.
- The UAA startup compiles `RedisTokenStoreWitness.java` in the selected immutable
  runtime image with networking disabled. Classes are mounted read-only into the
  fixture, never packaged into the application image. Source and class bytes are
  rechecked; JWTs pass only over `docker exec` stdin, not command arguments.
- The probe explicitly uses OAuth2, Redis L2 and a 20-second JWT lifetime.
  Signature and expiry negatives require the real RedisTokenStore entry and
  authentication before and after rejection. No re-signed expiry token or store
  miss can satisfy the checks. Maintained business source is rechecked against
  the selected source-build receipt before and after probing.
- Backend startup requires all sixteen successful UAA checks and the bound
  current account input. A historical thirteen-check report is insufficient.
- Nacos has one dedicated 64 MiB executable JNI tmpfs; other temporary paths
  retain their restrictions. Its data tmpfs is bounded at 1 GiB because the prior
  256 MiB limit caused actual RocksDB/JRaft ENOSPC errors.
- After a successful Nacos publish, only a missing (404) readback is retried:
  at most fifty attempts, 100 ms between attempts. A different 200 response,
  authorization denial or server error still fails. Every accepted payload must
  match exactly; attempt counts are recorded.
- Backend Nacos clients use only the owned server and fixture group.
  Discovery client creation is enabled because ServiceHub requires
  `NacosServiceManager`; self-registration remains disabled.
- Candidate Java 17 execution exports only `java.naming/com.sun.jndi.ldap` to
  the legacy LDAP implementation. No LDAP error is swallowed or turned into
  successful startup.
- Retained-peer comparison normalizes mount enumeration order, while checking
  every mount's actual content. Repeated live Docker inspections reproduced
  order-only changes; real mount/lifecycle/configuration changes remain failures.
- Bounded private JRaft logs are retained before removing failed Nacos containers.

## Actual Runs

All stages use new fixture `3eb4d11be03b`, an internal `10.34.0.0/24` bridge,
the reviewed ARM64 MySQL image, six ordinary users and two physical model schemas.
No shared database or administrator identity was substituted.

| Stage | Result | Evidence Under Fixture Directory |
| --- | --- | --- |
| SQL fixture | 55 passed | `isolated-sql-report.json` |
| Scoped application accounts | 32 passed | `application-accounts-uaa-witness-r1/report.json` |
| UAA Boot/MySQL/Redis and real TokenStore | 16 passed; temporarily retained for backend attempts | `uaa-runtime-witness-r1/report.json` |
| Final UAA replay with current witness guards | 16 passed; both application peers removed by runner | `uaa-runtime-witness-r2/report.json` |
| Backend r1 | Failed: RocksDB JNI could not map from noexec temporary storage | `backend-runtime-witness-backend-r1/report.json` |
| Backend r2 | Nacos ready; immediate config readback returned 404 after successful publish | `backend-runtime-witness-backend-r2/report.json` |
| Backend r3 | All three configs matched on second readback; allinone lacked NacosServiceManager | `backend-runtime-witness-backend-r3/report.json` |
| Backend r4 | Failed before allinone: Nacos JRaft STATE_ERROR | `backend-runtime-witness-backend-r4/report.json` |
| Backend r5 | Nacos/configs passed; allinone hit Java 17 LDAP module access restriction | `backend-runtime-witness-backend-r5/report.json` |
| Backend r6 | JRaft log established actual ENOSPC at the 256 MiB Nacos data limit | `backend-runtime-witness-backend-r6/report.json` |
| Backend r7 | Nacos/configs passed with 1 GiB data; allinone now fails at missing ZooKeeper URL for UNISTATE | `backend-runtime-witness-backend-r7/report.json` |

The r5 retained-peer verdict is false and remains so in that report. Repeated
subsequent inspections demonstrated mount-order instability; r7, with the
normalizer, verifies peer integrity. This does not rewrite or retroactively
promote r5.

All backend attempts remain failed; provider/gateway startup and the application
permission/persistence matrix did not run. An HTTP-ready Nacos and successful
configuration readbacks are not acceptance of the whole backend.

## Cleanup And Integrity

`cleanup-and-integrity.json` independently confirms all fifteen journaled
longer-lived containers and the private network are absent. Compiler containers
were separately ephemeral `--rm` operations and are not included in that count.
Both scoped application principals were removed before deleting MySQL.
All sixteen protected shared containers retain their IDs, images, startup times,
restart counts and mount contents (`shared-before.json`, `shared-final.json`).
Mount enumeration order is normalized, not mount content.

The first independent absence check used case-sensitive Docker error text and
stopped on the CLI's lowercase `no such object`; the subsequent typed container
inspection accepts case variations but still requires the exact not-found
condition and a reachable daemon. No missing-container claim is based solely on
a generic failed Docker command.

`source-final.json` records the final ten task source/test/audit inputs. It
retains the difference from the earlier snapshot rather than rewriting it.
The final two changes are the Nacos data limit and corresponding assertion.

## Regression Boundary

- `scripts-full.log`: 4320 passed / 1 failed. The failure was the current
  route-picker fingerprint table in `NATIVE-PLUGIN-SOURCE-AUDIT.md`, not a failed
  build or a newly discovered runtime defect. The document now names the fresh
  receipt and preserves its old fingerprints as history.
- `scripts-full-r2.log`: 4323 passed, no failures/skips, before the last startup
  adaptations.
- `scripts-full-r3.log`: 4324 passed, no failures/skips, before the final Nacos
  storage-limit adjustment.
- `final-focused-r3.log`: one retained stale-size test failure after the Nacos
  limit changed; its contradictory old 256 MiB assertion was corrected.
- `final-focused-r4.log`: 203 passed, no failures/skips, on the final startup
  configuration, account/witness security and current source-evidence contracts.
- `native-deployment/report.json`: 4 passed, native acceptance still false.
- `ledger.json`: 6 failures / 3 warnings; candidate startup work did not change
  the main deployment's source/image bindings.

## Next Required Work

`ibiz-plugin-zookeeper/.../SysZooKeeperUtilRuntime.java` rejects an absent
`serviceurl` when the gateway's UNISTATE runtime initializes. Supply an explicitly
owned ZooKeeper peer, immutable image, temporary storage policy, fixture-only
address and exact lifecycle/network bindings. Extend the configuration/deployment
validators and cleanup roster together. Do not use shared `zoo1` or invent an
unverified disable flag.

After that, independently verify EBSX schema completeness, UAA service alias
resolution and service OAuth credentials before application-level permissions,
fresh-session writes, restart readbacks or durable database storage are accepted.
The current MySQL fixture is tmpfs and never proves database recreation durability.

## Reproduction

Create a new reviewed SQL fixture and application-account label first. With its
actual run ID and account label, from the workspace root:

```sh
node scripts/harness-run-owned-uaa-runtime.mjs \
  --run-id=OWNED_RUN_ID --account-label=OWNED_ACCOUNT_LABEL \
  --runtime-report=.artifacts/standalone-uaa-source-runtime/SELECTED/report.json \
  --label=UNIQUE_LABEL --retain-owned

node scripts/launch-run-owned-native-backend.mjs \
  --execute-owned-backend --run-id=OWNED_RUN_ID \
  --image-report=.artifacts/backend-source-images-SELECTED/report.json \
  --retained-uaa-report=.artifacts/native-nonadmin-fixtures/OWNED_RUN_ID/uaa-runtime-UNIQUE_LABEL/report.json \
  --label=UNIQUE_BACKEND_LABEL
```

Only retain resources during an actively owned integration interval. Remove the
exact UAA/Redis container IDs after checking their run labels and immutable image
IDs, then clean the account principals and finally the SQL fixture. Preserve all
reports and private logs; do not reuse failed output labels.

The older `--replay-retained` path is still a legacy read-only thirteen-check
replay. It does not supply a store witness and must not be used to claim new
stateful-token security acceptance. Use a fresh short-TTL fixture instead.
