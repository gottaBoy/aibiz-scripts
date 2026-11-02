# ARM64 UAA And Native Framework Refresh

Follow-up to `BACKEND-ALIGNMENT-20261102.md`. Historical failed reports and
previous source snapshots remain unchanged. Shared business backends and
databases are not replaced by this work.

## ARM64 Stateful UAA

The token-security runner now has two explicitly selected database profiles:

- `mysql57-amd64`: the previous fixed-image profile, still the default.
- `mysql57-bitnami-arm64`: fixed image
  `sha256:2e7e2b4ae4494b2bb9fe9d2ad4b6510790d714ba2e60af2f0df5aaca44f0c28f`,
  MySQL 5.7.41, UID/GID `1001:1001`.

The ARM64 profile uses only tmpfs database/config/log/socket paths under a
read-only container root. It creates a fresh configuration using the image's
own helper and masks its bundled Nacos init scripts with empty read-only tmpfs
directories. No host data directory or persistent volume is selected. A runtime
guard rejects root users, changed image identity and unreviewed/persistent
mounts. The actual server version, `lower_case_table_names=1`, `utf8mb4` and
zero preset business schemas are checked before run-owned seeding.

Two independent Boot/MySQL/Redis runs passed all 17 required HTTP/token checks:

- `.artifacts/standalone-uaa-stateful-security/security-hq3uX6/report.json`
- `.artifacts/standalone-uaa-stateful-security/security-ruigHA/report.json`

The second run includes the final storage guard. Its recorded fixture-tool
hashes still match the current implementation. Each run used six ordinary
accounts across two centers. Anonymous and bad-password requests were denied;
actual issued tokens provided positive controls; tampered and expired tokens
were denied despite their retained Redis store entries; logout removed the
current token and subsequent use returned 401.

Each run removed its three containers and internal network. The selected
`10.34.0.0/24` subnet was inspected against current Docker networks and host
routes before use. No existing network was pruned, no host port was published,
and no shared service/database was reused.

Reproduction from the workspace root, after inspecting a free private subnet:

```sh
node --test standalone-uaa/tools/stateful-token-runtime.test.mjs
node standalone-uaa/tools/stateful-token-runtime.mjs \
  --runtime .artifacts/standalone-uaa-source-runtime/runtime-9MwlrN/report.json \
  --database-profile mysql57-bitnami-arm64 --subnet PRIVATE/24
```

The fixture's 30 contract tests pass. A wider source/receipt/runtime contract
run passed 162 tests. This establishes the selected candidate's scoped
Boot/SQL/Redis token-security behavior, not the primary UAA deployment's source
binding, provider permissions, cross-model-library access or native acceptance.

## Fresh Native Build Chain

All outputs use new `backend-align-20261102` directories:

1. `.artifacts/native-ai-code-source-deps/backend-align-20261102/report.json`
2. `.artifacts/native-ai-code-deployment/backend-align-20261102/receipt.json`
3. `.artifacts/native-model-design-build/backend-align-20261102/report.json`
4. `.artifacts/native-model-design-local-candidate/backend-align-20261102/report.json`
5. `.artifacts/native-model-migration/backend-align-20261102/receipt.json`
6. `.artifacts/native-ai-code-runtime-assets/backend-align-20261102/receipt.json`

The existing three exact CLI source-build reports were independently verified
before consumption. Framework and AI-code inputs were freshly captured from the
current source. The local model-design candidate passed typechecking, the full
declared build, resource-copy validation and two-build byte reproducibility.
Its outputs are not a recovery of the requested original alpha.90 package.

The model/plugin delivery contains 14 source-backed packages and the runtime
delivery contains 212 files. The `console-terminal` alpha.87 and `layout-design`
alpha.90 original-source mappings remain explicitly unresolved.

`scripts/native-modeling-config.mjs` now selects this new candidate, runtime
delivery and local model-design source report. The existing Central service
query overlay is unchanged. Only `modelingweb-candidate-central` and
`modelingweb-candidate-modeldesign` were recreated, with `--no-deps --no-build
--pull never`; no orphan containers were removed.

## Verification

| Check | Result | Evidence |
| --- | --- | --- |
| ARM64 database fixture contracts | 30 passed | `.artifacts/backend-align-uaa-arm64-contracts-20261102.tap` |
| UAA source/receipt/runtime contracts | 162 passed | `.artifacts/backend-align-uaa-receipt-contracts-20261102.tap` |
| Current native source/config integration | 21 passed | `.artifacts/backend-align-native-source-focused-20261102.tap` |
| Modeling Web build | Passed | `.artifacts/backend-align-modeling-web-build-20261102.log` |
| Modeling Web tests | 619 Vitest + 10 report tests passed | `.artifacts/backend-align-modeling-tests-20261102.log` |
| Native frontend deployment integrity | All four checks passed | `.artifacts/backend-align-native-deployment-20261102/report.json` |
| Native browser prerequisites | Both apps, all 16 stages passed | `.artifacts/backend-align-native-browser-20261102/report.json` |
| Runtime doctor after frontend deployment | Passed | `.artifacts/backend-align-runtime-doctor-refresh-20261102.log` |
| Full scripts after fresh source chain | 4284 passed, zero failures/skips/todos | `.artifacts/backend-align-scripts-refresh-20261102.tap` |
| PLM integration after networking tests finished | 5 passed: setup plus IDE and stale-route checks on both viewports; zero retries/skips/flaky | `.artifacts/backend-align-plm-integration-20261102-r2/reports/test-results.json` |

The initial PLM integration replay retained four passes and one mobile
`ERR_NETWORK_CHANGED` console-error failure:
`.artifacts/backend-align-plm-integration-20261102/reports/test-results.json`.
Its IDE counter returned 200 and the iframe rendered, but the console assertion
failed. It is not counted as passing. That replay overlapped Docker-network
fixture tests; network interference is a plausible explanation, not a proven
application root cause. Browser assertions and allowed-error rules were not
changed. The fresh replay after networking fixtures finished passed all five
checks without retries. The original failure is retained, not rewritten or
removed. This focused replay does not replace the complete PLM 101-test gate
recorded before this checkpoint.

Do not run browser verification concurrently with tests that provision or
remove Docker networks. Keep separate report directories and retain failed
invocations, including those that appear to be environment-related.

## Remaining Scope

Primary UAA/allinone/gateway/provider images are unchanged. The six version
ledger failures recorded in the previous checkpoint are not cleared by
candidate tests. A fresh live ledger still records six failures at
`.artifacts/backend-align-ledger-refresh-20261102.json`. Seven protected shared
containers retained their IDs, images, startup times and mount sets throughout
this work. Actual backend/model permissions, native browser editor
operations, full save/fresh-session readback, clean restart/persistence and
controlled backend cutover remain separate gates. All native/release
acceptance flags remain false.

Next, exercise the newly built backend candidates with the reviewed ARM64
database fixture and explicit ordinary-user/cross-library permissions before
considering any shared-backend replacement. Keep a rollback image/artifact
manifest and run PLM regression after a controlled cutover.
