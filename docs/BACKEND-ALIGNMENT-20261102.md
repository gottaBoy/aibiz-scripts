# Backend Alignment Progress

Checkpoint: 2026-11-02 UTC. This is candidate build and deployment-audit
evidence, not a backend cutover, native acceptance or release acceptance.
Later ARM64 fixture and native-source refresh results are recorded in
`ARM64-UAA-AND-NATIVE-REFRESH-20261102.md`; the blockers below describe this
earlier checkpoint and are not rewritten as historical passes.
The prior PLM frontend repair retains its 101-test, zero-retry result in
`MOBILE-ROUTE-REGRESSION-20261102.md`; that suite was not repeated here.

## Completed

| Check | Result | Workspace evidence |
| --- | --- | --- |
| Fresh isolated permission regression | Focused 124, full reactor 257 tests passed | `.artifacts/backend-alignment-permission-20261102/report.json` |
| Fresh backend package | 99-module reactor packaged; 317 positive tests passed | `.artifacts/backend-alignment-package-20261102/report.json` |
| Candidate image build and independent replay | Allinone, gateway and provider image/JAR bindings verified | `.artifacts/backend-alignment-images-20261102/report.json` |
| Read-only deployed JAR audit | Completed; all three current JARs differ from candidates | `.artifacts/backend-alignment-audit-20261102-r2/report.json` |
| Maintained standalone UAA build | 571 Java sources; 587 compiled classes; 19 source/protocol and 13 OAuth2 fixture tests passed | `.artifacts/standalone-uaa-source-build/build-8GV8BV/report.json` |
| Standalone UAA image | Exact never-started image extraction matched its build roster | `.artifacts/standalone-uaa-source-runtime/runtime-9MwlrN/report.json` |
| Independent UAA source/class replay | Five selected source modules passed; not full source closure | `.artifacts/standalone-uaa-source-closure/closure-89Oipl/report.json` |
| Independent compiler tests | 100 passed | `.artifacts/backend-alignment-compiler-20261102.tap` |
| Backend package/image/audit/ledger tests | 112 passed at the first checkpoint | `.artifacts/backend-alignment-contracts-20261102.tap` |
| Updated audit/ledger/platform tests | 47 passed, including explicit unbound UAA rejection | `node --test scripts/tests/version-ledger.test.mjs scripts/tests/source-platform-deployment.test.mjs scripts/tests/backend-deployment-audit.test.mjs` |
| Stateful UAA fixture contracts | 26 passed, including subnet and architecture guards | `.artifacts/backend-alignment-uaa-fixture-tests-20261102.tap` |
| Full scripts | 4280 passed, 4 failed, zero skipped | `.artifacts/backend-alignment-scripts-full-20261102.tap` |
| Runtime doctor after auditing | Passed | `.artifacts/backend-alignment-runtime-doctor-20261102.log` |

The 257-test permission full stage includes five cloud-core tests in addition
to 252 modeling-core tests. It is not a count of 257 modeling-only tests.
Three known zero-test XML placeholders are retained separately in the package
receipt and contribute zero passing tests.

The backend source fingerprint is
`df86db47b50d576d88a548a0f82e5df895ddab296a4ec3cd428faa0bb079ffdc`.
The clean worktrees, source snapshots and copied Maven repositories are retained.
Neither the shared Maven cache nor the original three deployment JARs was
used as a writable build mount.

## Candidate Images

These are newly built candidates only. They are not running application
deployments and must not replace an accepted image merely because they build.

| Component | Candidate Reference |
| --- | --- |
| Allinone | `aibiz/backend-source-allinone:5603686e-064b-4146-8bc4-45bf19583338` |
| Gateway | `aibiz/backend-source-gateway:5603686e-064b-4146-8bc4-45bf19583338` |
| Modeling provider | `aibiz/backend-source-provider:5603686e-064b-4146-8bc4-45bf19583338` |
| Standalone UAA | `aibiz/standalone-uaa:editable-214b8d419b41` |

The backend image receipt binds immutable IDs, pinned Java base layers, package
receipt SHA-256 and actual image file hashes. The UAA runtime receipt separately
binds its maintained build, source fingerprint and exact runtime JAR roster.
No mutable `source-built` or primary service tag was moved.

## Deployment Findings

The read-only audit copies files from the immutable IDs of the currently
running containers and checks their hashes before and after copying. It also
checks that MySQL, UAA, PLM service/web and the three backend containers retain
their IDs, images, startup times, restart counts and mounts.

- Allinone differs in two root application classes: `RTAuthAgent.class` and
  `AuthInfo.class`, plus 78 dependency archives and one Maven metadata entry.
- Gateway differs in one dependency archive and one Maven metadata entry.
- Modeling differs in 48 dependency archives, its manifest and Maven metadata.
- Current Modeling's mounted provider JAR matches the host JAR, but neither
  matches the fresh candidate archive. The mutable image tag also points to a
  different image from the running container.

Embedded JAR hashes include ZIP/build metadata. Their differences do not alone
prove different class behavior. On-disk files, particularly a bind-mounted JAR,
do not establish which classes the existing JVM has loaded.

The audit exits 1 with `auditCompleted=true` and
`status=on-disk-deployment-drift-detected`. This is an observed mismatch, not an
incomplete audit or a deployment pass. Its first run is retained under
`.artifacts/backend-alignment-audit-20261102/`; that run detected only reordered
Docker mount enumeration as an extra failure. The corrected normalizer ignores
ordering while still rejecting changed mounts, images and startup identities.

The live version ledger still has six failures:
four source drifts for the primary and stopped isolated allinone/gateway
containers, an unbound current UAA deployment, and Modeling's moved image tag.
See `.artifacts/backend-alignment-ledger-20261102.json`.
The UAA entry no longer pretends that legacy `ibzuaa` source is its verified
origin; missing required deployed-source binding remains FAIL, not WARN.

## UAA Verification Repairs And Limits

The initial independent replay rejected a genuine 13-test OAuth2 report because
the verifier still required 12 tests. It now requires the exact thirteen named
security tests, including resource-server rejection of invalid stored tokens.
Missing, duplicate, unrelated, skipped or failed tests remain rejected.
The first failed replay is preserved at
`.artifacts/standalone-uaa-source-closure/closure-0QX5IX/report.json`.

Actual Boot/MySQL/Redis verification did **not** pass:

1. The default-address-pool run failed before creating resources.
   Evidence: `standalone-uaa-stateful-security/security-nJuYSP/report.json`.
2. With inspected free subnet `10.34.0.0/24`, the pinned AMD64 MySQL image
   exited with `exec format error` on this ARM64 environment. The run-owned
   database container and private network were removed.
   Evidence: `standalone-uaa-stateful-security/security-w3pNPw/report.json`.
3. The new architecture preflight rejects that mismatch before provisioning.
   Evidence: `standalone-uaa-stateful-security/security-9rQcyF/report.json`.

The fixture can now accept an explicitly reviewed unused RFC1918 `/24` while
retaining internal-only networking and run ownership. No historical network was
pruned or reused. Supporting the ARM64 Bitnami MySQL image needs a separately
reviewed fixture profile: its entrypoint, user and storage paths differ from
the historical AMD64 image. No image substitution, shared-database fallback or
host emulation setup was performed.

## Remaining Gates

The four full-script failures concern stale native-model-design framework
source evidence. `vue3-util` changed in the prior mobile-routing repair, while
the native lifecycle candidate still binds its previous source snapshot.
They require fresh dependency/candidate/runtime builds and replay; historical
receipt hashes must not be edited. This full-script invocation is not green.

Next execution order:

1. Add and validate an ARM64 fixture database profile, then run actual UAA
   Boot/SQL/Redis security and non-admin checks.
2. Refresh native-model-design framework source snapshots and their downstream
   candidates after the PLM routing change; rerun the four failing gates.
3. Exercise fresh backend candidates on isolated data, including authentication,
   provider/model permissions, restart and persistence.
4. Only after those gates pass, plan a controlled backend cutover with backups,
   a rollback image/artifact manifest and post-cutover PLM regression.

Shared services were not restarted, replaced or migrated in this checkpoint.
The four new candidate images and successful unit/source replays do not certify
original source authenticity, original plugin-source recovery, native editor
workflows, complete source closure, loaded-class identity or production safety.
