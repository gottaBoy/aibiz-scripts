# Isolated Modeling Permission Regression

From the workspace root:

```sh
node --test scripts/tests/modeling-permission-regression.test.mjs
node scripts/harness-modeling-permission-regression.mjs \
  --maven-repository /home/my/.m2/repository
```

Requires Linux/procfs, Node >=20, Python 3 (standard-library XML parser), rsync,
Docker, and the preloaded image
`maven@sha256:42a3ac393abbc64dae6c96703e5ead2e921fe9103371ac58b5b404b0d6a26502`.
The offline dependency repository must already contain the reactor's dependencies
and Maven plugins. Override its default with `--maven-repository` or
`MODELING_PERMISSION_MAVEN_REPOSITORY`. There is no download or compiled-own
fallback. Allow space for the source snapshot, two worktrees, and a cache copy.

Each invocation creates a new direct child of `.artifacts`. An optional
`--output .artifacts/NEW-RUN` must not exist. rsync excludes only `.git`,
`.artifacts`, and `target`, preserving other source/build/dependency inputs.
The recorded snapshot is never built in place and is mounted read-only; focused
and full stages each start with a fresh worktree. The original source, snapshot,
worktrees, and dependency snapshot are checked against pinned file inventories.
Neither the original provider JAR nor the original Maven cache is mounted.

Both stages run `-pl libs/ibiz-modeling-core -am test` using the digest-pinned
image, `-DskipTests=false`, `-Dmaven.test.skip=false`, and
`-Dmaven.test.failure.ignore=false`. The focused stage selects
exactly eight suites: `PSModelDEAccessManagerTest`, `PSDevUserCacheCodecTest`,
`SystemAccessManagerCacheTest`, `SystemAccessManagerGrantTest`,
`SystemAccessManagerJsonCacheTest`,
`SystemAccessManagerRequestCacheTest`, `SystemAccessManagerSchemeGrantTest`, and
`ModelSysUtilRTAddinAuthorizationTest`. The full stage has no test filter and
requires all default-named test classes captured under modeling-core's
`src/test/java` (Java package/file layout must agree).

Containers have no network, no published ports, a read-only root filesystem and
dependency mount, and only the stage worktree plus temporary storage writable.
There are no shared service restarts, service mounts, live DB connections, or
deployment writes. Only a failed invocation's uniquely named container may be
removed. Failure logs, partial XML, worktrees, and `report.json` are retained.

Success requires valid fresh Surefire XML, exact required suite coverage,
positive counts agreeing with testcase elements, zero skips/failures/errors,
successful command exits, and unchanged recorded inputs. XML DTDs, duplicate
suites, missing reports, crash dumps, source drift, and stale report/log hashes
fail closed. No console summary can substitute for XML evidence.

Recheck a receipt against its retained artifacts and current source:

```sh
node scripts/harness-modeling-permission-regression.mjs \
  --verify .artifacts/NEW-RUN/report.json
```

Passing reports state `passed-unit-regression-only` and
`nativeAcceptance: false`. They do not establish native runtime authorization,
provider compatibility, production acceptance, or full source localization.
The earlier October 6, 2026 receipts at
`.artifacts/modeling-core-scheme-grant-fixed-20261006-EeYcoH/focused.log` (54 tests)
and `full.log` (182 tests) are historical unit observations only, not pinned
success thresholds for evolving project tests or native acceptance evidence.
Those older receipts do not satisfy the expanded eight-suite focused gate.
The earlier seven-suite receipts remain historical evidence. The eighth suite
covers the actual JSON cache roundtrip, cross-center fresh/cached administrator
authorization and appdata without an optional model root. Omitting or skipping
it fails the current focused gate; a fresh receipt is required.
