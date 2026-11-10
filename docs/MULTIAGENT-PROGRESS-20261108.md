# Multi-Agent Integration Progress

Date: 2026-11-08, Asia/Singapore.

This checkpoint separates implementation, focused tests and actual owned-runtime
evidence. It does not declare all product capabilities complete.

Consolidated hash-bound checkpoint:
`.artifacts/multiagent-closeout-20261108-r1/report.json`,
status `PARTIAL-NOT-FULLY-IMPLEMENTED`. It binds regression, UAA, authorization,
schema, platform HTTP, frontend launch, failed browser and cleanup evidence.

## Verified Runtime Changes

- Replaced only the UAA in owned run `5d3585516a77` with the maintained
  refresh-cache fix. All 16 real login and stateful token-security checks pass.
  The other seven owned peers are unchanged. Token lifetime remains 20 seconds.
- Rebuilt the invalid-refresh mapping and sensitive-error-path fix. The source
  build passes 19 contract tests, 13 OAuth security tests and 8 real Spring MVC/
  HTTP error tests. The new image passes byte binding and another 16 actual
  security checks after exact-owned replacement. Original owned DNS aliases
  survive successive replacements.
- Six ordinary roles now pass natural expiry, gateway refresh, UAA/backend
  identity, organization/tenant appdata preservation and both-root read checks.
- Eight grant variants pass 200 actual HTTP checks: zero, negative, expired and
  read-only access in each root. All eight original grant rows were restored by
  full-row compare-and-set. Both model schemas retain their full original
  projections.
- Registered the exact owned persistent `uaa-api` Nacos alias. Real platform
  configuration/dictionary requests are forwarded to the owned allinone;
  no empty-success API fallback is installed.
- Native UAA invalid refresh now returns 400 without identity/token leakage.
  Backend invalid-refresh propagation remains 500 and is not accepted.
- The real platform schema/projection replay passes: 32 tables, 596 columns,
  33 indexes, native operator SQL, CRUD, runtime DDL denial, password masking,
  projection DML denial and direct-UAA-read denial. All six historical operator
  codes remain absent and `operatorValuesReady=false` is preserved.

Evidence below `.artifacts/native-nonadmin-fixtures/5d3585516a77/`:

- `backend-runtime-uaa-refresh-cache-r1/report.json`
- `backend-runtime-uaa-refresh-aliases-r1/report.json` (current deployment input)
- `platform-http-platform-r6/report.json` (refresh/native denial pass; overall fails)
- `platform-schema-platform-r5/report.json` (schema/projection acceptance only)
- `authorization-http-grant-variants-20261108-r1/report.json`

Latest completed scripts regression: **4746 passed, zero
failed/skipped/cancelled**.
The 269-file code inventory is unchanged during the run and was rechecked
after completion. Receipt:
`.artifacts/multiagent-regression-20261108-r5/report.json`.
`current-postcheck.json` independently confirms the current source and all
artifact hashes still match. The IPAM correction also passes 39 launcher tests
and 118 related tests. Earlier regression receipts are preserved.

## Implemented Candidates

- Owned frontend launch/cleanup with reconstructed Docker arguments, exact
  ten-peer validation, original eight-backend lifecycle/storage witnesses,
  loopback-only TCP transport and partial-failure journals.
- Platform model-derived schema, password-redacted read-only UAA directory
  projections, locked column-scoped definer and exact-owned cleanup.
- Optional real extension-system configuration in the backend builder and
  `--platform-report` input in the backend launcher. This preserves the
  independent EBSX, workflow, metadata and platform datasource boundaries.
- Narrow UAA invalid-refresh error mapping and credential-redaction regression
  coverage, now also source-built, byte-bound and replayed in the owned runtime.
- New fixture accounts initialize their real `EMPLOYEE_NUMBER`. Existing
  historical UAA rows are not modified, and no view fabricates missing codes.
- Central and ModelDesign now launch successfully on the real owned Docker
  network with loopback-only access and both healthy frontend containers.
  Receipt:
  `.artifacts/owned-native-modeldesign-launch/multiagent-20261108-r3/report.json`.
  This reports `RUNNING-OWNED-FRONTEND-NOT-ACCEPTED`, not business acceptance.
- Actual browser probe: both applications pass model, plugin-asset and normal
  fixture login stages. Both fail home readiness. Notifications return 404 and
  theme reads return 500 with an invalid organization context. Navigation,
  reload and editor/save acceptance remain open. No editor writes were run.
  Screenshots show the final loading overlay, not a working home.
  Evidence: `.artifacts/owned-native-modeldesign-browser/multiagent-20261108-r1/`.
- Both temporary frontend containers and loopback bridges were cleaned using
  their recorded identities. Cleanup receipt:
  `.artifacts/owned-native-modeldesign-launch/multiagent-20261108-r3/cleanup-45efc10f0489.json`.
  Final inspection confirms the eight declared backend peers are running and
  the private network again contains exactly those eight peers.

Agent implementation and cross-review details:

- `OWNED-MODELDESIGN-LAUNCHER-20261108.md`
- `OWNED-PLATFORM-SCHEMA-20261108.md`
- `OWNED-AUTHORIZATION-VARIANTS-20261108.md`
- `../../standalone-uaa/tools/REFRESH-ERROR-MAPPING.md`

## Failures Retained

- `platform-http-platform-r3/report.json`: invalid refresh returns 500 on both
  native UAA and backend. Config save fails because EBSX does not yet have the
  actual `ibizmodeling` system registration. Native config cleanup succeeds;
  physical model checksums remain unchanged.
- `platform-schema-platform-r1/report.json`: the original MySQL-only guard
  correctly refuses the already populated eight-node owned network. No resources
  were created. The tool now has an explicit full-deployment guard mode.
- `platform-schema-platform-r2/report.json`: Java compiled and the real adapter
  created/replayed 32 tables, 596 columns and 33 indexes. MySQL returns some
  column-level grants without backticks, which the initial parser rejected.
  This run is not schema acceptance and its partial SQL resources are journaled.
- `.artifacts/standalone-uaa-source-build/build-tjz3OG/`: 7 of 8 new HTTP/error
  tests pass. The remaining test finds refresh credentials in the generic
  internal-error `problem.path`. The assertion remains strict; the corrected
  `build-pQAd4R` passes all eight tests.
- Schema resumes `platform-r3` and `platform-r4` reject actual metadata that
  the first adapter normalization handled incorrectly. Corrected native
  type/PK rules and strict boolean normalization pass in `platform-r5`.
  The original 32 tables/users were verified and resumed without dropping
  them; original receipts remain immutable.
- `platform-http-platform-r4`/`platform-r5` retain the successive-replacement
  DNS failure and unsuccessful hot-rebind readiness. Alias preservation fixes
  login in `platform-r6`, whose first readiness login is 200.
- `.artifacts/owned-native-modeldesign-launch/multiagent-20261108-r1/`:
  the real launch rejects Docker's tmpfs inspection shape. The owned Central
  container was removed by exact ID and no bridge was started. This is a
  launcher compatibility failure, not a browser acceptance receipt.
- The subsequent `multiagent-20261108-r2` launch fixes that shape but catches
  a second projection error: adding the known frontend changes Docker
  `Status.IPAM.Subnets` counters from the eight-peer baseline. Changing only
  those two counters reproduces the exact failed hash. The temporary frontend
  is removed; no backend identity/configuration/lifecycle drift is observed.
  The correction must verify the expected per-subnet count delta before
  comparing the original eight-peer witness, not discard `Status`.

Historical failed receipts are not overwritten or relabeled as successful.

## Ordered Remaining Work

1. Implement and rebuild backend invalid-refresh 4xx propagation without
   converting storage/network/internal failures into authentication denials.
   Redact nested WebClient refresh URLs in backend errors and verify that
   error bodies do not echo the supplied credential.
2. Populate actual operator codes in a fresh source-backed account fixture;
   do not invent projection fallback values.
3. Bind actual system/directory data into EBSX, launch the real extension,
   verify configuration persistence and notification/dictionary tenant isolation.
   Fix the browser's normal organization bootstrap before claiming theme
   reads work; the HTTP harness's explicit organization headers do not prove
   that the browser initializes this context correctly.
   The reviewed minimum is one `IBZPSSYSTEM` system, two `IBZCENTER` tenants and
   two `IBZDCSYSTEM` deployments, bound to actual provider model/UAA rows.
   Configuration's parent relation is to `IBZPSSYSTEM`, not UAA deployment or
   extension `SYSTEM`. The model-sync action still declares `NOTIMPL`.
4. Launch the current owned frontends; prove home, list/detail, editor save,
   fresh-session readback, restoration, viewer/no-access and cross-root denial.
5. Complete remaining authorization domains: same-token cache revocation,
   session/holder frames, typed/null context and service OAuth/alias paths.
6. Complete D01's 12-component source/dependency/build closure.
7. Complete the 73-plugin and PLM desktop/mobile multi-role workflow matrix,
   visible Chinese/English content, Development/API/Data Model/Modeling IDE.
8. Verify all 23 marketplace catalogs offline, including install/update/rollback,
   then perform clean offline reconstruction and durable recovery/operations.

No defensible overall completion percentage exists until these independent
acceptance matrices are closed. Shared business containers were not restarted.
The fixes above have not been promoted to the shared `30250` deployment.
