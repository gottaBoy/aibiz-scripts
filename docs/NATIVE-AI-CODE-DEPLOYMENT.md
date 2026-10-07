# Native ai-code Source Build Deployment

This is an isolated deployment-file candidate, not native browser acceptance.
The tool does not install dependencies, execute a new build, change services,
rewrite models or update migration mappings.

## Version And Source Boundary

| Item | Identity |
|---|---|
| Original model request | `@ibiz-template-plugin/ai-code@0.0.3-alpha.92` |
| Editable published-source candidate | `@ibiz-template-plugin/ai-code@0.0.3-alpha.141` |
| Source | `vendor-upstream/gottaboy-plm-web/plugin-src/@ibiz-template-plugin/ai-code@0.0.3-alpha.141` |
| Published comparison | `vendor-upstream/plm-web/public/plugins/@ibiz-template-plugin/ai-code@0.0.3-alpha.141` |
| Historical receipt build command | `pnpm run build` |
| Recorded source-deps receipt build command | `node scripts/harness-native-ai-code-source-deps.mjs` |
| Package gitHead metadata | `7020943f79e5e7886b314f90cc4eae64b1fcd196` |
| Original repository authenticated | No |
| Native version compatibility | Not verified |

The recorded URL-fix snapshot has two local fixes:
the type fix in `src/module/inline-completions/inline-completions.ts` and
the absolute Monaco loader URL in `src/monaco-editor/monaco-editor.tsx`.
Its source status is `published-source-with-recorded-local-fixes`.
Matching source and gitHead metadata do not authenticate the original upstream commit. Original
source and static asset-generation provenance remain unaccepted. The
recorded source-deps chain completed the eight iBiz dependency source-build
lane and consumed three verified source-built CLI/core releases before the
Monaco fix; these are no longer unfinished source-build gates. That chain is
now historical evidence, not verification of the changed ai-code source.
Original dependency-version reproduction and native behavior remain unverified.
The completed `monaco-absolute-20261006` chain below is an intermediate
snapshot, not final code. Lifecycle source and runtime harness contract fixes
have since landed. The fresh lifecycle source-dependency/CLI build is complete
in scope; publisher/candidate/assets are prepared and standalone Docker delivery
passes, as recorded below. Main has deployed the readable candidate to healthy
32008/32009 containers, but the new native report still fails; the ai-code
isolated browser run is not yet complete. Source drift requires fresh hashes
and receipts.

The old mapped PLM deployment is not overwritten: it lacks 21 files from the
candidate build receipt and differs in three existing output files. The new
candidate binds exactly the local `dist/`, `es/` and `lib/` output trees and
the unchanged `package.json`. It retains the actual alpha.141 identity, not
an alias claiming to be alpha.92.

## Prepare And Verify

Run on Linux with Node.js >= 20 and accessible `/proc/self/fd`, from the
workspace root. Use trusted artifact parents and a cooperative single writer.
Private `0700` directories and `0600` files do not protect against owning-UID,
writable-GID or root writers of their ancestors. No atomic multi-file snapshot
or protection against arbitrary concurrent replacement is promised.

Set `DEPS_REPORT` to a completed report for the exact source being consumed.
The lifecycle report
`.artifacts/native-ai-code-source-deps/monaco-lifecycle-20261006/report.json`
has completed in scope and passed current read-only verification with exit 2.
Reverify it before use. The historical `monaco-absolute-20261006` report is not
evidence for the changed source. Expected exit 2 after valid scoped verification
is not native acceptance; do not default to an old report.

```sh
: "${DEPS_REPORT:?Set DEPS_REPORT to a completed current-source report}"
result=0
node scripts/harness-native-ai-code-source-deps.mjs \
  --verify-report "$DEPS_REPORT" || result=$?
test "$result" -eq 2
RUN_ID="$(node -p 'require("node:crypto").randomUUID()')"
OUTPUT=".artifacts/native-ai-code-deployment/deployment-$RUN_ID"
result=0
node scripts/prepare-native-ai-code-deployment.mjs \
  --source-deps-report "$DEPS_REPORT" --output "$OUTPUT" || result=$?
test "$result" -eq 2
result=0
node scripts/prepare-native-ai-code-deployment.mjs \
  --source-deps-report "$DEPS_REPORT" \
  --verify-receipt "$OUTPUT/receipt.json" || result=$?
test "$result" -eq 2
```

The source-deps report must still pass current read-only verification before
consumption. Without `--source-deps-report`, preparation uses the legacy build
lane and cannot claim source-built iBiz dependencies or CLI/core.

Exit 2 explicitly means native acceptance remains unfinished. Invalid evidence
returns 1. Do not suppress the distinction. Verification is read-only and checks
the current audited build, published provenance, unchanged manifest, full
deployment file set and receipt. Source/config/output drift, extra files,
symlinks and overwritten candidates are rejected.

Existing destinations cannot be reused. Failed partial candidates remain for
inspection; retry into a fresh path. Receipt existence is not proof of success.
Always verify the exact receipt immediately before consumption.

The private publisher tree is **not ready for nginx worker access**. A later
Docker image build or independent model candidate must consume verified evidence
and set explicit readable delivery ownership/permissions without changing the
original source or artifact-parent permissions. HTTP delivery and browser
execution are not tested by this publisher.

## Isolated Docker Delivery

`scripts/harness-native-ai-code-docker.mjs` consumes the exact verified receipt
and creates a fresh private context under `.artifacts/native-ai-code-docker/`.
The context contains the 68 verified plugin files plus the checked-in Dockerfile
and nginx configuration. It does not copy editable source, node_modules or a
whole frontend deployment. Source and context hashes are rechecked after copying,
building and HTTP verification. Use the same trusted-parent/single-writer
boundary as the publisher; this is not an atomic Docker context snapshot.

The locally cached nginx base is inspected before building, then its image ID,
architecture and inherited filesystem layers are checked again. The build uses
`--pull=false` and `--network=none`; the observed image ID is recorded, not
presented as authenticated registry provenance. No package installation or
plugin compilation occurs inside this image.

In this standalone Docker lane, the image sets plugin directories/files to
`0755`/`0644`. Original private publisher and artifact-parent permissions remain
unchanged; the separate readable model-candidate lane does not make the publisher
tree public. The runtime is UID
and GID 101, with a read-only root filesystem, private `/tmp`, dropped
capabilities, no-new-privileges and an ephemeral loopback port. The harness
removes its own uniquely identified container in the cleanup path. Its image
and all successful/failed artifact directories remain for inspection.

```sh
RUN_ID="$(node -p 'require("node:crypto").randomUUID()')"
result=0
node scripts/harness-native-ai-code-docker.mjs \
  --deployment-receipt "$OUTPUT/receipt.json" \
  --source-deps-report "$DEPS_REPORT" \
  --output ".artifacts/native-ai-code-docker/delivery-$RUN_ID" || result=$?
test "$result" -eq 2
npm run test:native-ai-code-docker --prefix scripts
```

`OUTPUT` must name the freshly verified publisher candidate from the preceding
example. An absent/stale/tampered receipt is not replaced automatically.
Inspect the exact emitted report path: successful status is
`docker-delivery-passed-native-not-accepted`, with `deliveryStatus: passed` and
`cleanup.status: passed`. Exit 2 intentionally retains native acceptance and
the remaining provenance/compatibility/compiler-in-Docker gates; it does not
negate completed dependency/CLI source builds. Failures exit 1.

Every file is fetched and SHA-256 checked at `/plugins/`, `/central/plugins/`
and `/modeldesign/plugins/`: 204 content checks. Six negative checks assert that
the old alpha.92 manifest and a missing asset return 404, not a fallback or
version alias. This verifies standalone static delivery, not SystemJS dependency
resolution, editor rendering, save/readback or integration into the existing
32006/32007 services. Neither standard nor candidate app container is recreated.

## Historical Candidate

The first candidate is
`.artifacts/native-ai-code-deployment/deployment-20261006-source-bound-first/receipt.json`.
The suffix uses workstation Asia/Shanghai time; its actual generation timestamp
is `2026-10-05T18:31:47.882Z`.

| File Set | Files | SHA-256 |
|---|---:|---|
| Audited source/config/assets | 31 | `b38d5f10072f7ae3cd9c82bbc76280a79547a6bb895a0746d154f16ff255a881` |
| Existing local build outputs | 67 | `ca43277d0612437ea171261f735cd38701ff47e7bd9ea9987c7781dce78c8163` |
| Independent output including manifest | 68 | `59f8620996e6b1713966177b7f3467401bbcbee75ce44f2242d7f7329835ffbc` |

Main-thread generation returned expected exit 2. Consumer verification returned
`verified-deployment-not-accepted`, `deploymentIntegrityVerified: true`,
`manifestIncluded: true` and `acceptedForProduction: false`. No new build was
performed in that check. This does not update the blocked migration mapping.

## Historical Docker Stage Evidence

The main thread confirmed the completed standalone Docker-delivery regression
below. This is a prior-stage result, not the final count or build evidence for
the subsequent fresh source-dependency harness.

| Stage | Result | Evidence |
|---|---|---|
| Historical source-bound scripts regression | 1013/1013 PASS, 0 failed/skipped; `duration_ms: 40303.037063` | `.artifacts/native-ai-code-deployment/regression-20261006/scripts-tests.log` |
| Completed standalone Docker-stage scripts regression | 1042/1042 PASS, 0 failed/skipped; `duration_ms: 39314.154278` | `.artifacts/native-ai-code-docker/regression-20261006-resume/scripts-tests.log` |
| Actual isolated Docker delivery | 210 checks, cleanup passed, `errors: []`; main-confirmed CLI exit 2 | `.artifacts/native-ai-code-docker/delivery-20261006-resume-a018745d-5552-4fd0-ad16-54da9f609c14/report.json` |

The delivery report runs from `2026-10-05T18:54:29.579Z` to
`2026-10-05T18:54:32.330Z` (UTC). Artifact directory suffixes use workstation
Asia/Shanghai naming, not a later UTC execution date. It records status
`docker-delivery-passed-native-not-accepted`, `deliveryStatus: passed` and
`cleanup.status: passed`. Its 210 checks are 68 exact file byte/hash checks at
each of the three URL prefixes (204 total), plus six correct 404 negatives.
The cleanup container ID matches the uniquely recorded delivery container;
the temporary loopback URL is not a persistent deployment.

The image is `aibiz/native-ai-code-delivery:a31542c7-2fef-43c3-a6f6-904cf3f981ae`,
ID `sha256:286a6765002486781e7116692bee7d754dc065032a739bc308e6da73e8f41cbf`.
The report binds the exact candidate receipt listed above, SHA-256
`054d6c8b972d320292fdff857815025266051c949020919212405fc911519fb5`.
`acceptedForProduction`, `nativeRuntimeAccepted` and
`ibizDependencySourceBuildsVerified` remain false; alpha.92/alpha.141 compatibility
remains `not-verified`. Building this static delivery image does not establish
a fresh plugin or local-source dependency build.

At that stage, native browser acceptance had eight failing stages in
`.artifacts/native-modeldesign/ai-code-docker-regression-20261006/report.json`
(main-confirmed exit 1): Central plugin-assets/navigation, and ModelDesign
plugin-assets/login/home/navigation/reload/browser-errors.
`prerequisiteChecksPassed` and `pluginAssetsVerified` are false; four Central
and eight ModelDesign pinned plugin manifests return 404. The earlier failure at
`.artifacts/native-modeldesign/source-bound-regression-20261006/report.json`
remains historical evidence. Neither 1042 passing script tests nor isolated
Docker delivery constitutes native editor acceptance.

## Completed Pre-Fix Source-Built Delivery

This chain ran on 2026-10-06 in Asia/Shanghai (+08:00); the precise timestamps
below are UTC on 2026-10-05. It supersedes unfinished source-build descriptions,
not historical failures or native acceptance gates. After the subsequent
Monaco source fix, these report hashes and output fingerprints are historical
snapshots, not current-source verification.

| Evidence | Exact path | File SHA-256 |
|---|---|---|
| Source dependencies | `.artifacts/native-ai-code-source-deps/probe-c9ce92e3-d3d7-45d4-a8f3-5fcde616b291/report.json` | `f5133c1ab75838812f558eab6e414c8d077709ddf2b6998b7e4c0c9a5d384437` |
| Deployment | `.artifacts/native-ai-code-deployment/deployment-2026-10-05T20-43-31-909Z-6a3daf16-9165-40f0-86cd-56fccfbca248/receipt.json` | `fd8a460d05295944024d9cdc7696bb76f9baf27ff8ecb30e17c3acbebca8e176` |
| Standalone Docker | `.artifacts/native-ai-code-docker/delivery-d0d7970a-c6d5-49fe-bf86-59fcdebd0d66/report.json` | `778ea6bb5e5087e21e3ca07f1a0d4811f4277ff44fd37cac8f2db5412ec1d292` |

Source-deps ran from `2026-10-05T20:37:04.358Z` to
`2026-10-05T20:40:45.983Z`, status
`source-runtime-deps-probe-complete-not-accepted`, recorded exit 2.
`runtimeSourceBuildsVerified`, `aiCodeSourceBuildVerified` and
`toolchainSourceVerified` are true. All eight executable build steps
(seven dependency packages plus ai-code) are `built`, with every command exit 0.
The eighth dependency, theme, is a source SCSS input rather than an independent
JS compilation step.

| Source-backed dependency | Version | Evidence |
|---|---|---|
| `@ibiz/model-core` | `0.1.84` | Built, 1528 output files |
| `@ibiz/rt-model-api` | `0.2.82` | Built, 2587 output files |
| `@ibiz-template/core` | `0.7.41-alpha.78` | Built, 407 output files |
| `@ibiz-template/runtime` | `0.7.41-alpha.86` | Built, 4457 output files |
| `@ibiz-template/model-helper` | `0.7.41-alpha.86` | Built, 65 output files |
| `@ibiz-template/vue3-util` | `0.7.41-alpha.86` | Built, 870 output files; source CLI/core `0.3.23` |
| `@ibiz-template/theme` | `0.7.39` | Nine recorded SCSS source inputs; `compile: not-applicable`, output fingerprint null |
| `@ibiz-template/web-theme` | `3.11.0` | Built, 302 output files; source CLI/core `0.3.0` |

ai-code uses source CLI/core `0.3.30` and produces 67 fresh output files.
All three CLI reports are hash-bound and `cliSourceBuildVerified: true`;
`publishedOwnToolchain: []`. Exact CLI report paths/hashes and retained failed
attempts are in
[NATIVE-CLI-SOURCE-ACQUISITION-20261006.md](NATIVE-CLI-SOURCE-ACQUISITION-20261006.md).
The report records original and staged source drift as `unchanged`;
`outputDrift` and `errors` are empty at that run. Eight dependency source builds
completed in this rebased scope,
not original-lock reproduction or proof of all declared ranges/behavior.

Deployment was generated at `2026-10-05T20:43:59.131Z`. It binds the exact
source-deps report above, with `ibizDependencySourceBuildsVerified: true` and
`toolchainSourceBuildsVerified: true`; status remains `prepared-not-accepted`.

| Pre-fix historical file set | Files | File-set fingerprint |
|---|---:|---|
| Audited source/config/assets | 31 | `b38d5f10072f7ae3cd9c82bbc76280a79547a6bb895a0746d154f16ff255a881` |
| Fresh source-deps build outputs | 67 | `910ef4cb1f790b73f8b2572d94c10b15db801f56e30ba06aad400bb67361690c` |
| Deployment outputs plus unchanged manifest | 68 | `12682405063533bee10e926eb3e15bcd9ecec125940c7082c156223aa89a9a2e` |

The deployment totals 1,545,342 bytes. The unchanged manifest SHA-256 is
`77b7e0bf71664f6f9447887cbbcce12ba13d7a1202eff1af9d906d3d6f2ef3ae`.
Fresh output fingerprints differ from the historical candidate; neither
receipt is rewritten or treated as interchangeable.

Docker ran from `2026-10-05T20:47:41.184Z` to `2026-10-05T20:48:32.756Z`.
All **210 checks** match the bound 68-file deployment: 204 exact bytes/hashes
at the three prefixes, plus the six exact 404 negatives. `deliveryStatus` and
`cleanup.status` are `passed`, `errors: []`, and
`ibizDependencySourceBuildsVerified: true`.
Image `aibiz/native-ai-code-delivery:29c38ab6-3fb7-4c40-be49-c88420197b17`
has ID `sha256:a348b06954181503cbc24acb965c7cfdbe7c5155b50919de0a889ff8288fd622`
and architecture `arm64`. Cleanup matches container
`ca63cf1b48f2be732eb7160d53c6f9353518748a52f88c78d98a55f4724ee643`.
This is static delivery of already source-built outputs:
`compilerBuildInDockerVerified: false`, `nativeRuntimeAccepted: false`,
`acceptedForProduction: false`. Original repository authenticity, declared
range compatibility and alpha.92/alpha.141 compatibility remain unverified.

## Intermediate Source-Built Snapshot

`monaco-absolute-20261006` is a completed scoped snapshot, **not final code**.
Lifecycle cleanup and stricter runtime harness checks have subsequently
landed and are tracked in the current-stage section below. The hashes below identify the
recorded URL-fix stage, not a later changed worktree or final acceptance.

Main applied the Monaco fix in `src/monaco-editor/monaco-editor.tsx`: loader
`paths.vs` now uses `new URL(..., document.baseURI).href` so the blob worker
receives an absolute base URL. The candidate source status is
`published-source-with-recorded-local-fixes`; its `src/` fingerprint is
`101ed59951be3decafcfad470bd6a09269b5af6b53e84d79f7aa6dc13392c287`
(20 files, 133932 bytes). The refreshed standalone legacy build receipt binds
31 inputs / 67 outputs:
`29738346e808f8273718c42f85f2bf8dfbb5fb06f8ee77701bc38f0672db6e49` ->
`a9cfb19444542d75f015c7529cced84aa90c7014b0f57ab64ab612236e0afe1d`.
Keep this legacy output fingerprint separate from the all-source output below;
it is not a runtime acceptance result.

The fresh all-source rebuild is **complete in scope, not native accepted**:

| Recorded-stage evidence | Exact path | File SHA-256 |
|---|---|---|
| Source dependencies | `.artifacts/native-ai-code-source-deps/monaco-absolute-20261006/report.json` | `eb9ce8899ebd84c1b90678002448fd6d0eeb2b8e3d9431efc5c54d72d2598f42` |
| Deployment | `.artifacts/native-ai-code-deployment/monaco-absolute-20261006/receipt.json` | `2a77c2296c3959eec6f5f901b24741cb8e939eb00e9120d4735d523b09c4d4c8` |
| Model candidate | `.artifacts/native-model-migration/monaco-absolute-20261006/receipt.json` | `316562e23e1309ca169e8427cdea3b2aa5352dfd917b2ea26cbfcfcc4bfa1f23` |
| Standalone Docker | `.artifacts/native-ai-code-docker/monaco-absolute-20261006/report.json` | `2a3f193bc7d672aa84ed2e79faef1f54be7cacf858077c36a222296887785151` |

The report runs from `2026-10-05T21:22:59.884Z` to
`2026-10-05T21:26:38.448Z` UTC, status
`source-runtime-deps-probe-complete-not-accepted`, recorded exit 2.
`runtimeSourceBuildsVerified`, `aiCodeSourceBuildVerified` and
`toolchainSourceVerified` are true, `errors: []`. It again builds the eight
dependency source-input lane and ai-code, with the same three source-built
CLI/core releases. Its ai-code source fingerprint is
`29738346e808f8273718c42f85f2bf8dfbb5fb06f8ee77701bc38f0672db6e49`;
67 fresh all-source outputs have fingerprint
`3f2047af56b08d3b6bba3ca9e07ab624ad9e9fe4f0bd23cef0b1d7ad895d4681`.

Deployment was generated at `2026-10-05T21:27:41.667Z` UTC and binds that
exact report hash. Its dependency/source-toolchain truth flags are true;
68 files (67 outputs plus unchanged manifest), 1,545,437 bytes, fingerprint
`93198a320a4560a2f8e680b5d4b795af486342381be4328ea458dba2e38e28e6`.
It remains `prepared-not-accepted`, `acceptedForProduction: false`.
Original identity/provenance, declared range compatibility, full localization
and native acceptance remain unverified.

The model candidate completed preparation with **six packages and five
unresolved mappings**, with three model files per app. Its ai-code entry
binds the exact source report and deployment receipt above, preserving
alpha.141 rather than aliasing alpha.92. It remains `prepared-not-accepted`,
`acceptedForProduction: false`; candidate creation does not verify migration
compatibility or native runtime.

The bound Docker delivery ran from `2026-10-05T21:30:32.570Z` to
`2026-10-05T21:31:26.609Z` UTC. All **210 checks** passed: 204 exact
bytes/SHA-256 checks for the bound 68 files across three prefixes, plus six
expected 404 negatives. `deliveryStatus` and `cleanup.status` are `passed`,
`errors: []`, `ibizDependencySourceBuildsVerified: true`. Image
`aibiz/native-ai-code-delivery:077ae82b-3f70-4f82-8cdb-368cd8ea89cf`,
ID `sha256:76c8dcb88af652b5e84ae4d01d3a49bb2f3d228e7b20fcca9b6a50cbc8a9d030`,
is `arm64`, user `101:101`. Cleanup matches container
`3fc285fecf6194dfe4eab08d184e1d994c29b1c52a02225574bf7a611f0bb5d9`;
the temporary loopback URL is not a persistent service.
Status is `docker-delivery-passed-native-not-accepted`:
`compilerBuildInDockerVerified`, `nativeRuntimeAccepted` and
`acceptedForProduction` remain false.

The main thread reports scoped regression **164/164** and runtime/tests
**22/22** PASS, 0 skipped; exact commands/logs are still needed for the
regression record. These counts do not prove a browser/native pass or acceptance
under the tightened runtime harness. Current lifecycle/harness evidence is
tracked separately below.
The old source/build hashes above must not be treated as current after drift.
See [NATIVE-PLUGIN-SOURCE-AUDIT.md](NATIVE-PLUGIN-SOURCE-AUDIT.md).

## Current Lifecycle Source Stage

Main has applied lifecycle cleanup in the same
`src/monaco-editor/monaco-editor.tsx`: resize/mousedown handlers, pending
timers and late loader callbacks after unmount, retaining the absolute URL
fix. Runtime harness false-positive checks have also been tightened.
Source status remains `published-source-with-recorded-local-fixes`.
Current `src/`: 20 files, 135764 bytes, fingerprint
`d3b13c529e5d9bc4b51768300a62b80fac7458ac560f6fafac19e7d3daf3467f`.

The standalone build completed with 31 inputs / 67 outputs:
`8d3932ebe3358d489304dcb25e206f45a69a17759891813edf81a99fd1f3fc27` ->
`adeb4f095755468628bf9fb52ea1d17a43e813276873ea99884a9a1038638448`.
Receipt:
`vendor-upstream/gottaboy-plm-web/plugin-src/@ibiz-template-plugin/ai-code@0.0.3-alpha.141/.artifacts/build-receipt.json`,
file SHA-256 `604fc74f9281264be60b3b71ecf4d0883ef6cefe189374aafd6ea3d9807f9064`.
It records `pnpm run build`, exit 0, `status: passed`. This mutable standalone
receipt is current-stage evidence, not an archived all-source receipt; verify
it before consumption. It does not inherit dependency/toolchain source-build
truth flags from the historical `monaco-absolute` chain.

Main reports **21/21 PASS, 0 skipped**: seven lifecycle, five path and nine
runtime harness contract tests. These are not a new browser report.
The fresh source-dependency/source-CLI build is **complete in scope, not native
accepted**:

| Current-stage evidence | Exact path | File SHA-256 |
|---|---|---|
| Source dependencies | `.artifacts/native-ai-code-source-deps/monaco-lifecycle-20261006/report.json` | `9ea518eee4008c80240164387668f25a4b3e569c4b22c85e46d8109080ad7792` |
| Prepared publisher receipt | `.artifacts/native-ai-code-deployment/monaco-lifecycle-20261006/receipt.json` | `0c287f64978dd07891cf9d00ab478d20ff5c5f08804b3706135b6044f9fbb02b` |
| Prepared model candidate | `.artifacts/native-model-migration/monaco-lifecycle-file-20261006/receipt.json` | `434da7e464c980496762accf1382f97b5c957688a26c4d2d9b6e0c9354689956` |
| Standalone Docker | `.artifacts/native-ai-code-docker/monaco-lifecycle-20261006/report.json` | `e06d2c75974bead459b28656b405317f36ad03f19063767a5e88875fa4fc9950` |
| Prepared runtime assets | `.artifacts/native-ai-code-runtime-assets/monaco-lifecycle-file-20261006/receipt.json` | `b873e670a14d8fcb4370cd1cd20f75312de3dff3b676599a15422aba34840408` |
| Failed native browser report | `.artifacts/native-modeldesign/monaco-lifecycle-file-20261006/report.json` | `366319788da1675c87fb15c855420632e7c8f96ad0498dedd457c5ce3f0d297e` |

The report runs from `2026-10-05T21:36:08.586Z` to
`2026-10-05T21:39:48.746Z` UTC, recorded exit 2, status
`source-runtime-deps-probe-complete-not-accepted`. `runtimeSourceBuildsVerified`,
`aiCodeSourceBuildVerified` and `toolchainSourceVerified` are true;
`errors: []`, `outputDrift: []`, original/staged sources unchanged.
All eight dependency source inputs and the three source-built CLI/core releases
are consumed again. Seven dependencies plus ai-code have eight `built`
executable steps, all commands exit 0; theme remains recorded SCSS input.
The same 31-input source fingerprint above binds 67 fresh all-source outputs:
`3f1a46beb1ac49de9a771124f191004b0ee021d1ca358ba01d1bcc4ed4f71cc9`.
Do not substitute the standalone legacy output fingerprint for this build.

The publisher receipt was generated at `2026-10-05T21:40:30.446Z` UTC,
binding that exact source report hash. It contains 68 files (67 outputs plus
unchanged manifest), 1,549,830 bytes, fingerprint
`da73cc5e67040a4d7c39b69d7f3fe6219523432ca44554cd8c8267d29c7422da`.
`ibizDependencySourceBuildsVerified` and `toolchainSourceBuildsVerified` are true.
Current read-only verification returns `verified-source-runtime-deps-not-accepted`
and `verified-deployment-not-accepted`, both exit 2. The stored publisher status
remains `prepared-not-accepted`, `acceptedForProduction: false`; this is not
by itself service deployment or native acceptance.

The current `--file-base64-replacement` model candidate completed preparation:
**seven packages, six model files and four unresolved mappings**. Its ai-code
entry binds the exact current source report and publisher receipt above.
The independent replacement is `@aibiz/file-to-base64@0.1.0`; both its plugin
entry and separate replacement claim retain `originalSourceRecovered: false`,
`nativeCompatibilityVerified: false` and
`originalMigrationAcceptance: not-satisfied-by-independent-replacement`.
It is not original file-to-base64 source recovery or acceptance of that
original migration. Candidate status remains `prepared-not-accepted`,
`acceptedForProduction: false`.

Main confirms `node --test scripts/tests/*.test.mjs` completed **1842/1842
PASS, 0 skipped**, 77.137 seconds, log
`.artifacts/native-full-regression-20261006-monaco-file.log`. This covers the
then-current candidate/Base64 integration contracts, not subsequent Base64
browser harness additions or later changes. It is not browser/native acceptance.
The new Docker report ran from `2026-10-05T21:47:17.936Z` to
`2026-10-05T21:48:13.983Z` UTC, binding the exact current source/deployment.
All 210 checks pass (204 exact bytes/SHA-256 checks plus six expected 404s),
delivery/cleanup passed, errors empty. Dependency source-build verification is
true; `compilerBuildInDockerVerified`, `nativeRuntimeAccepted` and
`acceptedForProduction` remain false.

The new runtime-assets receipt binds candidate hash `434da7e4...`, with
111 files, 14,040,705 bytes, fingerprint
`584e6188ad41aa27306aa1479b4faf1cd1a854ff8b7cc92b7789dde078b00987`.
It remains `prepared-not-accepted`, `acceptedForProduction: false`;
do not confuse it with the historical first 111-file receipt or claim
worker/editor execution from preparation alone.

Main reports the new candidate deployed healthy on 32008/32009. The new
native report records **11 failing stages**: Central login cannot retrieve
the response body (`Network.getResponseBody`), blocking home/navigation/reload.
ModelDesign still has four missing sibling manifests, password-input timeout,
four unexplained browser errors and `loadGlobalAppUtil` failure.
Both model stages pass, but prerequisite/startup/plugin-assets verdicts are
false; editor/save/fresh-session readback are not accepted.
The login helper now requires the exact application response token to match
actual `core.getToken()`; browser-contract tests pass 30/30, 0 skipped.
That contract regression does not override the failed browser report.
The ai-code isolated browser run is still in progress; strict runtime evidence
must bind current hashes and served endpoints. Historical `monaco-absolute`
hashes, stage results and five-plugin browser failure are retained.
The independent replacement does not resolve four siblings, GlobalAppUtil,
runtime-model source, model save/readback, provenance or native acceptance.

## Browser Blockers And Prepared Assets

The readable candidate browser report is
`.artifacts/native-modeldesign/ai-code-readable-20261006/report.json`,
on candidate ports 32008/32009, not the historical standard-port run.
Central startup/login/home/navigation/reload pass, including exact
`POST /api/ibizmodeling__central/psdevslns/fetchcurdcslnuser` service/request
matching and a 200 JSON empty-grid result. Central's plugin-assets gate still
fails for model-design. There are **seven failing stages**, not the historical
eight; `prerequisiteChecksPassed` and `pluginAssetsVerified` remain false,
and `modelDesignStartupVerified: false`.

ModelDesign still has five exact-version plugin manifest 404s:

- `@ibiz-template-plugin/console-terminal@0.0.3-alpha.87`
- `@ibiz-template-plugin/file-to-base64@0.1.8-alpha.165`
- `@ibiz-template-plugin/global-util-design@0.0.3-alpha.87`
- `@ibiz-template-plugin/layout-design@0.0.3-alpha.90`
- `@ibiz-template-plugin/model-design@0.0.3-alpha.90`

ModelDesign reports four unexplained browser errors, including model
configuration failure through `loadGlobalAppUtil`; login/home fail.
ai-code alpha.141 manifest/SystemJS/CSS HTTP 200 only proves delivery, not
plugin execution, editor acceptance, save or fresh-session readback.

The first prepared runtime-assets receipt is
`.artifacts/native-ai-code-runtime-assets/loader-monaco-20261006-first/receipt.json`,
SHA-256 `230b93f99e9095e527d56608411fa32d80ce3b9d59611ab5c992763e2a5db85f`.
It binds the readable model candidate
`.artifacts/native-model-migration/ai-code-readable-2f51e8b7-b6c2-46ec-9281-4277fa1f28d9`
and contains **111 files**, 14,039,361 bytes, delivery fingerprint
`f90bea2a477e1049ea17400eae861ae190a3bbfd085a8d6bb6e98c3092d34811`.
It records `@monaco-editor/loader@1.7.0` and `monaco-editor@0.52.2`.
Its sole current status is **prepared, awaiting browser verification**:
`prepared-not-accepted`, `acceptedForProduction: false`. The existing readable
browser report does not establish consumption or browser verification of these
111 files.

The second isolated runtime report is
`.artifacts/native-ai-code-runtime/browser-worker-20261006-second/report.json`,
SHA-256 `2de7f95caf4b8e1eec8eb79d5efab98633d8a4cc1bace6c110721bdd3bf17817`,
UTC `2026-10-05T21:19:27.584Z` to `2026-10-05T21:19:31.999Z`.
It binds a different runtime-assets tree,
`.artifacts/native-ai-code-runtime-assets/loader-monaco-worker-20261006-second`,
receipt SHA-256
`699a93ad7ab70d028201803cc9a20dd52046c59cc80cb8bf54736aa463cfcac4`,
and the same readable model candidate, receipt SHA-256
`882b05860b0326c2ebeb54914a2802d00f6e1b846faa1c93eb721827c0cd53c3`.
Its **566/566 HTTP delivery checks** pass: 283 per app, comprising 562 exact
file HTTP 200 checks and four expected HTTP 404 negatives across both apps.
Factory registration, edit/prop sync and readonly/disabled stages pass.
These are historical report outcomes, not acceptance under the stricter
runtime harness now being fixed for false positives.
Component render and unmount/runtime-errors fail in both apps because the blob
TS worker cannot parse
`./plugins/monaco-editor@0.52.2/min/vs/language/typescript/tsWorker.js`.
`status: failed`, `isolatedRuntimePassed: false`, `nativeRuntimeAccepted: false`
and `acceptedForProduction: false`. Top-level `errors: []` does not override
failed application stages. This real isolated plugin/provider host does not
save a model or perform fresh-session readback; it neither accepts the first
111-file receipt nor resolves full-app plugin/GlobalAppUtil blockers.

The historical intermediate source-deps/deployment/candidate/Docker chain is
complete as recorded above. Lifecycle/harness fixes, standalone and fresh
all-source builds are complete; the fresh publisher and seven-package candidate
are prepared, standalone Docker passes, and new 111-file assets are prepared.
Candidate containers are healthy, but the current native report still fails.
Main-thread evidence still needed: completed ai-code isolated browser report
and subsequent native reruns bound to those exact hashes and served endpoints.
Verify loader/SystemJS/Monaco worker URL and
execution, cleanup of callbacks after unmount, the historical five-plugin and
GlobalAppUtil outcomes, and editor/save/fresh-session readback. Record new
focused/full scripts logs separately; do not promote historical counts to
this new run.

## Regression And Next Gates

```sh
npm run test:native-ai-code-deployment --prefix scripts
npm test --prefix scripts
```

The focused suite is included in the whole scripts regression. Tests must
include pre-generation source/config drift, source-build receipt mismatch,
manifest and deployment tampering, unrecorded outputs, invalid paths, symlinks,
overwrite refusal, partial-failure retention and the non-acceptance exit code.

A standalone static delivery image has been built and HTTP-checked; the
historical pre-fix source-deps/CLI reports record completion of the
eight-dependency source-build lane and three CLI/core builds. The fresh
`monaco-absolute-20261006` source-deps/deployment/candidate/Docker chain
records a completed intermediate scoped build and static delivery, not final
code or a passing browser/runtime. The current `monaco-lifecycle-20261006`
source-dependency/CLI build and prepared publisher receipt are verified in
scope; the `monaco-lifecycle-file-20261006` candidate is prepared with seven
packages/four unresolved mappings, Docker delivery passes, and runtime assets
are prepared. The new native report fails despite healthy candidate containers;
the ai-code isolated browser result remains pending.
Compiler execution inside Docker and full native
integration are not verified. Remaining gates include original-source and
asset provenance, native
loader/version compatibility, actual editor operations, model save and
fresh-session readback. Missing sibling plugins and `runtime-model@0.2.2` remain
blockers; a verified ai-code file copy does not resolve them.
