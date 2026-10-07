# Frontend Version And Source Evidence

Audit date: 2026-10-06 (+08:00). Readback snapshot: 17:20-17:22.
All paths are relative to `/home/my/workspace/ainfra/aibiz`.
This supplements [the version matrix](VERSION-COMPATIBILITY-MATRIX.md);
it does not rewrite historical backend/Task findings or the execution plan.
Only these two documentation files are edited in this lane. No product,
manifest, lock, orchestration or shared service changes are made.

## Findings And Acceptance Boundaries

1. **ModelDesign alpha.122 is not a strict alpha.90 reproduction.**
   The original model references alpha.90. The inspected source manifest is
   `vendor-upstream/gottaboy-plm-web/plugin-src/@ibiz-template-plugin/model-design@0.0.3-alpha.122/package.json:3`;
   its exact framework dependencies at lines 38-42 do not accept the active
   hub releases. Its peers at lines 63-67 exclude those prereleases under
   normal npm semver rules. The compiled local identity remains
   `@aibiz/model-design-candidate@0.1.0`, not either upstream release.
   Registration parity and a successful rebased build cannot establish
   original-version or native workflow compatibility.
2. **Ledger PASS is not strict version compatibility or native acceptance.**
   Fresh offline ledger: 73 pinned PLM plugins, 365 peer checks, 318
   unsatisfied checks, 19 INFO findings, zero missing packages and zero
   import-map contract problems. This is consistent with the policy in
   `scripts/version-ledger.mjs:739`: peer drift is INFO, not FAIL.
   Its default scope is PLM, not the native ModelDesign migration.
   `node scripts/version-ledger.mjs` does not inspect running Docker
   provenance without `--live`; neither mode proves all business functions.
3. **The current ModelDesign candidate is not a clean lockfile installation.**
   v10 records `dependencyLockVerified=true`, reproducible builds and complete
   resource copies, but `packageManagerInstallVerified=false`.
   The custom offline lock describes the reused resolver closure; it does
   not prove a fresh package-manager installation. Source compilation does
   not prove compiler execution inside Docker either.
4. **Two different runtime `.2` snapshots share a version label.**
   ModelDesign v10 consumes report hash
   `0aff98cbca7d82917e8c8b01a66e33f73b5a0ce28d1330f8b9bf6a62b4d702a4`.
   A newer request-id correction produces report hash
   `9b38bb1b707038a0f309a12a9eadf4d55a82fd918de3b82780cb1eba847be363`.
   Both are labelled `0.2.2-local.2`, but their input and output fingerprints
   differ. The older isolated outputs still read back correctly. They do not
   prove consumption of the newer live source. Bind every integration to
   an exact report hash, or use a distinct delivery revision before release.
5. **Source origin and license remain separate gates.**
   Runtime `.1` and `.2` are editable reconstructions, not recovered original
   `runtime-model@0.2.2` source. Both manifests retain `UNLICENSED`,
   `originalSourceRecovered=false` and `originalLicenseAuthenticated=false`
   (`modelingweb/local-plugins/runtime-model/package.json:6,37-40`,
   `runtime-model-next/package.json:6,47-50`).
   ModelDesign's source manifest declares MIT and gitHead
   `7780006275953e510a725c449f9638a6ed878b97`; neither authenticates a
   separate runtime package's license or recovers alpha.90.
   The framework receipt also retains
   `sourceRepositoryAuthenticityVerified=false`.
6. **Scripts has installed-versus-lock drift, not a range violation.**
   `scripts/package.json:47` declares pnpm `^12.5.1`;
   `scripts/package-lock.json:220` locks `12.5.1`; the installed
   `scripts/node_modules/pnpm/package.json` reports `12.6.0`.
   Do not silently describe this installed tree as a frozen-lock reproduction
   or reinstall the shared tree while other agents depend on it.

## Active Application Mapping

Both manifests, lockfile importers and installed realpaths agree:
`modelingweb/app/package.json:50-59` and `plm-web/package.json:36-45`
link these packages to the same hub directories.

| Package | Active version | Source root |
| --- | --- | --- |
| `@ibiz/model-core` | `0.1.84` | `ibiz-app-hub/models/model-core` |
| `@ibiz/rt-model-api` | `0.2.82` | `ibiz-app-hub/models/rt-model-api` |
| `@ibiz-template/core` | `0.7.41-alpha.78` | `ibiz-app-hub/packages/core` |
| `@ibiz-template/runtime` | `0.7.41-alpha.86` | `ibiz-app-hub/packages/runtime` |
| `@ibiz-template/model-helper` | `0.7.41-alpha.86` | `ibiz-app-hub/packages/model-helper` |
| `@ibiz-template/vue3-util` | `0.7.41-alpha.86` | `ibiz-app-hub/packages/vue3-util` |
| `@ibiz-template/vue3-components` | `0.7.41-alpha.78` | `ibiz-app-hub/components/ibiz-next-vue3` |
| `@ibiz-template/theme` | `0.7.39` | `ibiz-app-hub/packages/theme` |
| `@ibiz-template/web-theme` | `3.11.0` | `ibiz-app-hub/components/web-theme` |

`modelingweb/packages/@ibiz/model-core@0.1.64` and
`packages-latest/@ibiz/model-core@0.1.89` are historical/candidate trees,
not active resolution authorities. A link's installed version and source
version are the same tree, not independent provenance evidence.

The registry `rt-model-api@0.2.82` lock record in
`plm-web/pnpm-lock.yaml:3915` belongs to the dev-tool closure:
`full-code-generator -> @ibizlab/cli -> @ibizlab/template ->
@ibizlab/template-model -> @ibiz/rt-model-api`.
It does not override the app link. The hub lock's registry records likewise
do not override direct app links. Do not manually delete transitive records;
building this additional iBiz tooling closure from source is a distinct gate.

The framework source-dependency receipt below records local model-core and
rt-model-api compilation. Fresh readback of all original inputs across its
ten source groups found no drift (3,803 recorded files).
This supports editable input/source-build claims, not full-localization,
repository-authenticity or current container claims.

| Source-build step | Source input fingerprint | Output fingerprint |
| --- | --- | --- |
| model-core `.84` | `037ad16347edf8474089ee871a53960fc4de084f3eac36575ed94a750ca75a15` | `eaac3d5396bf5dc59334eef8c8a1b1bca529f694636a9932f83f5c29c5196092` |
| rt-model-api `.82` | `1ff67f9a6cf6959f6298d79456fce60d04fa37afb7c6478ad0a7a2e0a121035b` | `9cf7ae9d6b87886883bad948523920881a1ffc549444a8a031ac2ea9de38a6d0` |

## CLI And Runtime Toolchains

Do not collapse consumer-specific CLI/core pins into one global release:

| Consumer | CLI / CLI-core | Original source commit |
| --- | --- | --- |
| web-theme `3.11.0` | `0.3.0 / 0.3.0` | `15ab40e917b0c0bde9a3b7473f3ca30a37cd116c` |
| vue3-util `0.7.41-alpha.86` | `0.3.23 / 0.3.23` | `a592a88de74abb9985e99a53d452d413d370ad7c` |
| ai-code alpha.141 / ModelDesign alpha.122 | `0.3.30 / 0.3.30` | `2277d0680777d5d147d912fecab779a6747807eb` |
| Modeling Web / PLM app dev tool | installed `0.3.30`, declared `^0.3.30` | Installed published package is not source-build evidence |

The framework receipt actually consumes the three source-built CLI/core
outputs, and their bound report hashes still match. Original CLI acquisition
excludes protected `.npmrc` paths and retains `sourceComplete=false`.
Original lockfile reproduction is not proved. See
[CLI acquisition](NATIVE-CLI-SOURCE-ACQUISITION-20261006.md) for tree IDs,
third-party toolchain selections and these exclusions.

Runtime `.1` and `.2` each use independent npm locks. All six direct
manifest/lock/installed versions match:
Stencil `2.17.0`, store `2.0.16`, IAS `3.0.0`, ramda `0.29.1`,
TypeScript `4.7.4`, and ramda types `0.29.12`.
These are not the CLI source builder's TypeScript/toolchain versions.
Application pnpm `8.15.9`, hub pnpm `10.13.1` and the scripts pnpm dependency
are separate installation boundaries, not a reason to rewrite all locks.

## ModelDesign Compatibility

Rechecked with real `semver@7.5.4`, without enabling `includePrerelease`:

| Dependency | alpha.122 declaration | Active/candidate version | Range passes |
| --- | --- | --- | --- |
| core | exact `0.7.41-alpha.28`; peer `^0.7.0` | `0.7.41-alpha.78` | Neither |
| model-helper/runtime/vue3-util | exact `0.7.41-alpha.31`; peer `^0.7.0` | `0.7.41-alpha.86` | Neither |
| theme | dependency/peer `^0.7.0` | `0.7.39` | Both |
| model-core | dependency `^0.1.58`; peer `^0.1.3` | `0.1.84` | Both |
| runtime-model | exact `0.2.2` | `0.2.2-local.1` / `.2` | Neither |

All 11 alpha.90 UI-action registration keys are present in the inspected
alpha.122/local candidate. The runtime convention is
`ibiz-app-hub/packages/runtime/src/register/helper/common-register.ts:36`,
`${plugin.pluginType}_${plugin.pluginCode}`.
This checks identifiers, not execution, entity selection, dynamic action
arguments, service routing, response shapes or editor save/readback.

v10 compiles the declared build pipeline, typechecks, copies resources and
reproduces 4,435 outputs with fingerprint
`6bfd397944e34c8688206b8b9a967532bc0f55151d5525134b228d930e8f33e2`.
Readback verified all 1,486 isolated inputs, all 4,435 outputs and five current
builder files. Its custom dependency-lock hash is
`49b55c03b19022581b85383fce39527789adb7cc83813f670235c17cf64f093e`.
It binds the older `.2` source/output fingerprints, not the request-id build.
`exactVersionReproductionVerified`, `nativeCompatibilityVerified`,
`nativeAccepted` and `acceptedForProduction` remain false.

## Native Plugin Mapping

Exact mappings in the v10 migration receipt, not a release approval:

| Requested package/version | Candidate | Evidence class |
| --- | --- | --- |
| drbar-ex `0.0.3-dev.51` | `0.0.3-alpha.241` | Reconstructed |
| list-tree `0.0.2-dev.145` | `0.0.3-alpha.225` | Reconstructed |
| route-picker `0.0.2-dev.142` | `0.0.3-alpha.245` | Reconstructed |
| img-to-base64 `0.1.8-alpha.144` | `0.1.8-alpha.438` | Reconstructed |
| logic-tree-design `0.0.3-alpha.56` | Same version | Receipt source status `verified`; compatibility not verified |
| ai-code `0.0.3-alpha.92` | `0.0.3-alpha.141` | Published source plus recorded fixes |
| model-design `0.0.3-alpha.90` | `@aibiz/model-design-candidate@0.1.0` | Vendored alpha.122 plus independent fixes |
| file-to-base64 `0.1.8-alpha.165` | `@aibiz/file-to-base64@0.1.0` | Independent replacement |
| global-util-design `0.0.3-alpha.87` | `@aibiz/global-util@0.1.0` | Independent replacement |
| studio-theme `0.0.3-alpha.92` | `@aibiz/studio-theme@0.1.0` | Independent replacement |
| studio-icon `0.0.3-alpha.68` | `@aibiz/studio-icon@0.1.0` | Independent replacement |
| layout-design `0.0.3-alpha.90` | `@aibiz/design-index@0.1.0` | Partial independent replacement; original remains unresolved |
| console-terminal `0.0.3-alpha.87` | None | Unresolved |

All receipt entries retain `compatibility=not-verified`. Six independent
replacement mappings explicitly retain
`originalMigrationAcceptance=not-satisfied-by-independent-replacement`.
Layout and console remain in `unresolvedMappings`; do not remove their
failure conditions to make native acceptance pass.

Latest completed native browser report found during this audit is the v10
absolute-path run below. It has four failing stages: Central navigation,
ModelDesign plugin assets, navigation and browser errors. Layout and console
package requests return 404; ModelDesign `POST .../psmodules/fetchcursys`
returns 500 with invalid application context; Central selected FetchDefault
is DATAQUERY instead of the required remote FETCH. Editor save/readback
acceptance is absent. This audit reads that report; it does not rerun or
restart the native services.

## Receipt Index

Each hash is SHA-256 of the complete JSON file, freshly re-read. A report
exit of 2 with all compilation subprocesses at 0 means scoped completion
without native/production acceptance, not a successful global gate.

| ID | Exact workspace-relative report |
| --- | --- |
| F | `.artifacts/native-ai-code-source-deps/monaco-lifecycle-20261006/report.json` |
| C0 | `.artifacts/native-cli-source-build/build-ad440ad3-d659-4fa8-9cb6-8129623e949d/report.json` |
| C23 | `.artifacts/native-cli-source-build/build-8e1a1d90-375a-4274-b6d3-1201593e0e17/report.json` |
| C30 | `.artifacts/native-cli-source-build/build-2b86c020-aa9a-4c8c-9245-a8620bff240d/report.json` |
| R1 | `.artifacts/runtime-model-source-build/build-20261006-model-design-input-implementation-pins/report.json` |
| R2-consumed | `.artifacts/runtime-model-source-build/build-500537af-a2fb-4ca6-91ec-80760398c9c7/report.json` |
| R2-quality | `.artifacts/runtime-model-source-build/runtime-model-next-quality-20261006/report.json` |
| R2-request-id | `.artifacts/runtime-model-source-build/runtime-model-next-quality-request-id-20261006/report.json` |
| R2-browser | `.artifacts/runtime-model-next-browser/runtime-model-next-quality-request-id-20261006/report.json` |
| MD10 | `.artifacts/native-model-design-local-candidate/build-20261006-alpha122-runtime2-locked-v10-model-edit/report.json` |
| M10 | `.artifacts/native-model-migration/s07-model-design-v10-model-edit-20261006/receipt.json` |
| B10 | `.artifacts/native-modeldesign/s07-v10-audit-absolute-20261006/report.json` |

```text
F              9ea518eee4008c80240164387668f25a4b3e569c4b22c85e46d8109080ad7792
C0             af40ce68d6573afa397b37c7fe84ac4b4214a1377bc1292892d96a1f8a0a2863
C23            b6134ab3f31182f67c60103e05398b74d8c4b31336e62fc013c1cd33ed424104
C30            e82219a864cbd5c514303c3f39601a4e8ceb9b0c79ada2456eaaf908d367b232
R1             28329ad00c236b5011288535e204de79cbd0d7ac3c0fece93e6ccada96a5fa33
R2-consumed    0aff98cbca7d82917e8c8b01a66e33f73b5a0ce28d1330f8b9bf6a62b4d702a4
R2-quality     e23c8e23f6c288583ca46e5e66a40d32fedecfc028cd31c7f1df800ff7c771bd
R2-request-id  9b38bb1b707038a0f309a12a9eadf4d55a82fd918de3b82780cb1eba847be363
R2-browser     90b42ad7d02fdde578271871141142a2869c498e9fc15c7b386052a73b06de15
MD10           cef9f7303ea75464066a8497a4290752319af41202d428d93489a24d222131e0
M10            30e969da575b15d3b61d324faa1554c6699028bc4e54942bea1eadb57af619db
B10            f3a74f253742bb6c2615e8089fb2f4955bd3d5df1ff5544b6516c64c59c89764
```

R1's 22 live/copied inputs and 91 outputs read back unchanged:
source `c4c129fbbfb6621d96db408394d4afa33d7a7e75d954020e2642a6c7e1ab92f7`,
output `371482ac7c777783a5da3df089090774f7f4657795f8f97336fcbfafa0129f55`.
R2-quality and R2-consumed have the earlier source/output pair:
`57064484a4cbe6b5cd195e635680e8c9e575f1b37d30a099a0f3397a654d7e50` /
`f6dbdca5a9b0ccfae2393c79cb60bbab9cffd8a3ae90c771512dcd2827ae43a4`.
R2-quality's isolated inputs/outputs still match; its live controller has
since changed from SHA-256
`c45618ffa1b47d084b70a1b8a377002fe6bc3d87cfdc47b8cee03ce900490891`
to `621f96041dc9ed2f447849be78ce1059031881aba91ea3ef541b58f249a3c51e`.
R2-request-id matches all 23 current/copied inputs and 94 outputs:
`95c7ffeb25a27fbe6d703a7d6fff7d581ef39c0152dc4e5024896cb5fa484887` /
`9178795329a1cf177668fd46e85153ff00152b62c9388b70d9c9c04d978ba078`.
Both repeated typecheck/build pairs exit 0. R2-browser accepts only its
controlled Chromium fixture (`fixtureAcceptance=true`,
`nativeAcceptance=false`).

Manifest/lock snapshot hashes, independent of the receipt hashes above:

```text
modelingweb/app/package.json
75d648c51a6b28d8f8121de52ff6b4fe441c96bf8378a7d7d3bf19843218e8fc
modelingweb/app/pnpm-lock.yaml
c9f6326faf52f9e97514db21867b4e0e6fd4cfa084dc51864a7cdcc14a55ad83
plm-web/package.json
7b7f7390b33f4fcaa9be50c01db407cf959483fb71722cb2d412acce0541c210
plm-web/pnpm-lock.yaml
74a673d9d5b981122b79645c9d21e042e64d5bd824864eb3f6b57cba690fedaa
scripts/package.json
6481347e3c2a52a9914b29accf9477e7c8a52f4903f273ff81ef023079b33da3
scripts/package-lock.json
e9fc7265a2ea296737ca17a3c93bb5307e585859be64b5da57caab825c7bbada
runtime-model/package-lock.json (under modelingweb/local-plugins)
f41b3794e8c704b48fbd428792ebcca2aafab63e6e4b47826fd15e3ce3946cb8
runtime-model-next/package-lock.json (under modelingweb/local-plugins)
699f2e9c186a0aa01155f78262c7c2a9e8b0d1f1db081f111dbf18bcb64b21a6
```

## Verification And Bounded Next Steps

Executed before the documentation edits: offline ledger PASS;
Modeling Web 14/14 local relations PASS; PLM 14 linked packages and
73/73 model/source/output plugin versions PASS; five focused suites
132/132 PASS with no skips. The eight additional CLI/model-design/runtime
source suites also exited 0. The combined post-edit regression of all 13
suites passed 601/601 tests, with no failures, cancellations, skips or todos
(18,156 ms, session 60801 collected with exit 0).
These are contract/unit checks and readback of completed builds, not new
full builds or actual native browser acceptance.

Reproducible read-only checks, from the workspace root:

```sh
node scripts/version-ledger.mjs
node modelingweb/app/scripts/check-local-ibiz-versions.mjs
node plm-web/tools/check-local-ibiz-versions.mjs
node --test scripts/tests/version-ledger.test.mjs \
  scripts/tests/native-model-design-compatibility.test.mjs \
  scripts/tests/runtime-model-loader-provenance.test.mjs \
  scripts/tests/runtime-model-next.test.mjs \
  scripts/tests/runtime-model-next-quality.test.mjs \
  scripts/tests/native-cli-source-build.test.mjs \
  scripts/tests/native-cli-build-options.test.mjs \
  scripts/tests/native-cli-toolchain.test.mjs \
  scripts/tests/native-model-design-inputs.test.mjs \
  scripts/tests/native-model-design-build.test.mjs \
  scripts/tests/native-model-design-runtime.test.mjs \
  scripts/tests/runtime-model-source-build.test.mjs \
  scripts/tests/runtime-model-reconstruction.test.mjs
```

Ordered recommendations for the owning implementation lanes:

1. Preserve the active hub baseline and its consumer-specific CLI releases.
   Unify resolution authority and evidence, not unrelated package version
   numbers. Test any proposed common CLI release across all three consumers
   before changing pins or lockfiles.
2. Freeze an isolated scripts installation from the existing npm lock to
   remove installed pnpm drift. Do not run `npm ci` in the shared checkout.
   A future intentional tool update needs its own manifest/lock delta.
3. Keep ModelDesign's independent candidate identity. Pin its supported
   prerelease framework/runtime inputs explicitly in the candidate lane;
   record original-to-local dependency rebases and run strict install/range
   checks. Widening peers or removing failed checks alone proves nothing.
4. Have the ModelDesign owner rebuild against R2-request-id, bind the exact
   new report hash, regenerate migration/assets receipts, and independently
   verify consumption. Preserve R1 and older R2 snapshots as historical.
5. Prove a clean isolated lock installation and editable-source compiler
   execution for the relevant Docker delivery. No registry own-code or
   precompiled local own-code fallback may be promoted to source-built.
6. Close console/layout source or explicitly approved replacement boundaries,
   repair the real API/model routing failures, then execute nonadmin native
   UI-action/editor save/fresh-session reload and PLM regressions.
   Native/production/full-localization flags stay false until their required
   source, license, Docker and behavioral gates actually pass.
