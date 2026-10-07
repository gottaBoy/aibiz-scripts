# Isolated Backend Source Package

This harness packages the runtime, gateway and service-runner provider from a
verified eight-suite modeling permission regression receipt. It establishes
isolated package and unit-test evidence only. `nativeAcceptance`, `sourceClosure`
and `acceptedForProduction` remain `false`. Binary Maven dependencies are not
evidence that all component sources have been acquired or reconstructed.

## Run And Verify

Run from the workspace root with Linux, Node.js, Python 3, rsync and Docker.
Preload the same pinned Maven image used by the permission regression harness:
`maven@sha256:42a3ac393abbc64dae6c96703e5ead2e921fe9103371ac58b5b404b0d6a26502`.
The harness does not pull images or download dependencies.

```sh
node scripts/harness-backend-source-package.mjs \
  --permission-report .artifacts/modeling-permission-eight-suite-20261006-final/report.json

node scripts/harness-backend-source-package.mjs \
  --verify .artifacts/NEW-PACKAGE-RUN/report.json

node --test scripts/tests/backend-source-package.test.mjs
```

Omit `--output` to allocate a UUID artifact directory, or specify a **new direct
child** of `.artifacts`. Existing destinations are rejected, including failed
runs. Reports and logs are created exclusively; failed evidence is retained.
No services are started or restarted, and no image is built by this harness.

## Isolation And Command

The permission receipt is fully reverified before the package run and again
afterwards. Its source and dependency inventories are copied into separate
`snapshot` and `repository` trees. A fresh `worktree` is copied from the frozen
snapshot, excluding `target` trees and exactly the three generated deployment
archives. Old compiler outputs cannot satisfy the package gate.

Docker uses `--network=none`, `--pull=never`, a read-only container root,
`--cap-drop=ALL`, `no-new-privileges`, the invoking UID/GID and a private `/tmp`.
Only the newly allocated worktree is writable. The new source and dependency
snapshots are mounted read-only; no shared source/cache/service volumes are
mounted. The original generated deployment archives and original cache bytes
are recorded before and after, without overwriting them.

```text
mvn -B -o -ntp -Dmaven.repo.local=/maven-repository
  -DskipTests=false -Dmaven.test.skip=false -Dmaven.test.failure.ignore=false
  -Dmaven.javadoc.skip=true -Dmaven.source.skip=true -Dmaven.deploy.skip=true
  -Dsurefire.skipAfterFailureCount=0
  -pl ibiz-ebsx-runtime,ibiz-ebsx-gateway,ibiz-service-runner/ibizservicerunner-provider
  -am -P runtime,gateway,runner package
```

## Receipt Contract

The exported APIs are `runBackendSourcePackage`, `verifyBackendSourcePackage`,
`backendPackageCommand`, `inspectBackendArchive` and `parseBackendSuites`.
The run API accepts `{workspace, permissionReport, output, python}`; the verifier
accepts `{workspace, reportPath, python}`. `execute` is an optional controlled
test adapter on the run API, not proof that a fixture invoked Java or Docker.

`report.json` has schema version 1 and contract
`isolated-backend-source-package-v1`. A passing package/unit-only receipt has:

- `status: "passed-package-and-unit-only"`, `sourcePackageVerified: true`,
  `unitRegression: true`, with all three acceptance boundary flags false.
- `permissionReceipt`: exact parent receipt path/SHA-256 and focused/full counts.
- Full before/after source, snapshot and repository inventories, plus protected
  original archive and cache identities.
- Exact pinned Docker command/image identity, log paths, sizes and SHA-256.
- `reportFiles`: complete Surefire report-file inventory and fingerprint.
- `results`: positive suites/testcase outcomes, module counts and separately
  recorded zero-test placeholders.
- `packages.targets`: fresh **thin target JAR** paths, sizes and SHA-256.
- `packages.coordinates`: frozen reactor POM coordinates and POM hashes.
- `packages.archives`: the three root-level **Spring Boot repackage executable**
  paths, sizes, SHA-256, structured ZIP entry hashes, manifest entry points,
  `applicationEntries`, required `embedded` identities, every
  `BOOT-INF/lib/*.jar` in `embeddedLibraries`, every matched
  `reactorDependencies` identity and explicit `unknownOwnDependencies` gaps.

The executable archive paths are:

```text
ibiz-ebsx-gateway/ibiz-ebsx-gateway.jar
ibiz-ebsx-runtime/ibiz-ebsx-allinone-rt.jar
ibiz-service-runner/ibizservicerunner-provider.jar
```

These are **not** `target/*-8.1.0.584.1.jar`. Their hashes must differ from the
thin JARs. Each executable must declare `JarLauncher`, the expected `Start-Class`
and Spring Boot 2.4.0. Every `BOOT-INF/classes` application entry must exactly
match the same run's fresh `target/classes` file roster and bytes. Runtime's
embedded SaaS JAR and runner's embedded modeling/runner-core JARs must match the
fresh reactor target JARs. Every `BOOT-INF/lib` JAR is inventoried. A matching
`artifactId-version.jar` is bound to its frozen source POM path/hash and the
same run's fresh `target` JAR path/bytes/SHA-256; a known reactor artifact with
a wrong version or no fresh output is rejected. Unmatched `ibiz` JARs are
recorded as `unknown-own-binary` source acquisition gaps with no source POM,
not as local builds. Other dependency entries are recorded as
`external-binary`; none is promoted to complete source closure. The exact
Spring Boot metadata relocation from fresh `target/classes/META-INF/` to the
root archive `META-INF/` is recorded in `relocatedApplicationEntries`. No
resource or credential contents are emitted in
the receipt; paths and hashes alone are recorded.

## Unit Evidence Boundaries

The current real package baseline is SaaS **24**, runner **36**, modeling **252**
positive tests, totaling **312**. The modeling source suite roster and individual
testcases must match the verified permission full-stage receipt, including all
eight required authorization suites. SaaS/runner rosters follow the frozen source
test inventory. Positive suites must have tests, zero failures/errors and zero
skips; console `BUILD SUCCESS` or a numeric summary cannot replace parsed XML.

The following exact XML placeholders remain recorded with
`coverage: "none-zero-test-placeholder"` and contribute **zero** passing tests:

```text
libs/ibiz-model-util/target/surefire-reports/TEST-net.ibizsys.model.util.merger.Test1.xml
libs/ibiz-psmodel-runtime/target/surefire-reports/TEST-net.ibizsys.psmodel.runtime.Test.xml
libs/ibiz-psmodel-runtime/target/surefire-reports/TEST-net.ibizsys.psmodel.runtime.Test2.xml
```

They are not passing workflows or coverage of those modules. Unknown empty
suites, missing placeholders, required-suite emptiness and skipped testcases fail
closed. The existing permission XML parser's positive-test rule is unchanged.

The prior manual success at
`.artifacts/backend-source-final-inputs-20261006-r1/worktree` and `package.log`
is historical input to this automation, not a fresh harness receipt. Focused
test fixtures explicitly use synthetic binaries and XML and do not establish
real Java compilation, native behavior or workflow acceptance.
