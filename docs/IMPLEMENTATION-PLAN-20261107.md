# AIBiz Full Implementation Plan

Date: 2026-11-07  
Updated: 2026-11-08, Asia/Singapore  
Basis: `REA-MULTIROLE-20261107.md`, current receipts, source tree and live
runtime observations.

Latest multi-agent integration checkpoint:
`MULTIAGENT-PROGRESS-20261108.md`. It records the actual 200-check grant
matrix and 16-check owned UAA replacement, as well as the retained platform
and error-redaction failures. Candidate implementation is not full acceptance.

## Rules

1. Every new build or deployment input gets a fresh immutable artifact
   directory. Historical receipts are never rewritten.
2. A visible route is not a functional pass. Each workflow must bind actor,
   request, response, persistence, permission result and cleanup.
3. Source presence, source provenance, reproducible build, served bytes,
   runtime compatibility and native acceptance remain separate gates.
4. All mutations run only in owned fixtures with journaled cleanup. Shared
   containers, databases and historical evidence are not modified.
5. Every phase ends with a machine-readable report, a focused test command and
   a documented residual-risk list.

## Phase 0: Freeze Baseline

**Goal:** Make the current state reproducible before more changes.

Actions:

- Capture cross-repository HEAD/dirty fingerprints for `scripts`, `plm-web`,
  `plm-e2e`, `modelingweb`, `modelingservice`, `ibiz-service-hub`, `plm`,
  `ibiz-app-hub`, `standalone-uaa` and `task7`.
- Record current container image IDs, mounts, ports, networks and candidate
  roots.
- Retain the current source-deps, ModelDesign, migration, backend package/
  image, permission and browser receipts.
- Run `npm test`, PLM focused tests, `plm-e2e` navigation and the current
  ModelDesign browser workflow.

Exit:

- Baseline manifest and ledger report exist.
- Current scripts regression remains green without required-test skips
  (latest November 8 replay: **4572/4572**).
- No shared runtime change is made by the baseline step.

## Phase 1: Fix Modeling API Runtime Mapping

**Goal:** Remove the owned backend `fetchcursys`/ModelDesign application 404.

Current investigation result: the failure is not a missing provider route.
The packaged provider registers the `psdevslnsys/{pkey}/psmodules/fetchcursys`
ModelAPI mapping, while the owned application request is handled through the
application gateway path. The retained provider log also records
`deployapp-ibizmodeling-modeldesign` being ignored and the application runtime
being unavailable. The next implementation step is therefore the
`PSSysApp -> IApplicationRuntime -> ServiceHub` mapping/configuration path, not
an nginx rewrite or a request-path substitution.

Execution note: a fresh SQL fixture attempt was intentionally stopped before
owned resources were retained because the current shared `mysql` container does
not expose the required `MYSQL_ROOT_PASSWORD` source-schema input. The runner
requires an explicit source schema container with that environment contract;
using the shared database password or bypassing the source-schema check would
invalidate the evidence. The failed candidate is retained at
`.artifacts/native-nonadmin-fixtures/66e045ef347b/`.

Fresh owned run `825d38e1e777` now advances further:

- SQL fixture: passed, retained
- application accounts: 32 checks passed
- workflow schema: passed
- EBSX schema: passed
- UAA runtime: failed closed at the real login query because the maintained
  UAA runtime requests `open_access_provider`, which is absent from the
  current 18-table fixture model

The failure is retained in
`.artifacts/native-nonadmin-fixtures/825d38e1e777/uaa-runtime-phase1-uaa/`.
The next fix must bind that table from the reviewed source schema/DDL as an
explicit supplemental UAA input; creating an empty compatibility table or
weakening the login query is prohibited.

November 8 checkpoint: that supplemental-table fix is implemented in
`tests/run-owned-native-nonadmin-fixture.sql.mjs`. It captures the actual
`open_access_provider` DDL, records its hash separately, and preserves the
existing fixture contract. Focused schema/fixture tests: **26/26 passed**.

Fresh run `5d3585516a77` now passes SQL, 32 application-account checks,
workflow/EBSX bootstrap, UAA login/security and the bounded ModelDesign native
HTTP matrix. Exact evidence:

- `uaa-runtime-phase1-uaa/report.json`
- `backend-runtime-phase1-backend-r2/report.json`
- `native-http-phase1-http-mutate/report.json`: **182/182 checks passed**,
  native CRUD, cross-root denial, fresh-login persistence, native cleanup,
  MODELVER **816 -> 819** in both libraries and otherwise restored physical
  baselines.

All paths are below `.artifacts/native-nonadmin-fixtures/5d3585516a77/`.
The route's real HTTP behavior is no longer blocked at UAA fixture schema.
Full startup/all-alias and owned-browser coverage are still open.

The later `native-http-phase1-http-restart/report.json` is a retained failure
at the initial baseline, because the runner correctly rejects reusing the
post-CRUD version 819 as original version 816. No provider restart occurred.
Repeat restart/readback in a fresh owned run; never rewrite the historical
manifest or decrement MODELVER.

Fresh replay `8e88d20900a5` completes that step: **185/185 HTTP checks pass**,
including two provider process restarts, six-user fresh-login readback,
cross-root denial and native probe cleanup. Exact receipt:
`.artifacts/native-nonadmin-fixtures/8e88d20900a5/native-http-phase1-http-restart/report.json`.
The run's eight peers and network have been retired with a separate receipt.

The owned-frontend preparation contract is also repaired: it consumes
`owned-resources.json`, accepts only declared/reviewed Nacos, Redis and
ZooKeeper peers, and uses a bounded hash-only mount inventory for the current
17,414-file frontend distribution (297,421,719 bytes). Generic model-reader
limits are unchanged.
The final focused contract run passes **107/107** checks. Preparation is not
launch authorization or browser acceptance; all browser actions below still
need their own current owned-backend evidence.

Current preparation now passes against all eight retained `5d3585516a77`
backend peers:
`.artifacts/native-model-design-owned-backend/phase1-owned-current-20261108/report.json`.
It starts no containers and sends no HTTP requests. The next implementation
step is an explicitly authorized owned-frontend launch followed by normal
login/root selection, module list/detail, editor save, fresh-session readback
and restore. The exact backend peer inventory must not be relaxed to admit
unbound frontend containers.

Final current-source full regression: **4567/4567**, zero failures, skips or
cancellations. Consolidated receipt:
`.artifacts/owned-runtime-closeout-20261108-r1/report.json`.
Phase 1's bounded route/CRUD/restart checks are closed; complete application
endpoint/browser, authorization, offline and release gates below remain open.

Owned browser replay verified local model/plugin/login/theme loading on two
healthy isolated frontend containers. It stopped before acceptance because the
compiled ModelDesign route still uses the fixed default system ID and the
owned `fetchcursys` call is denied with HTTP 403. Browser refresh also needs a
separate long-lived-token fixture; do not weaken the expiry security fixture.
The next implementation step is a source-backed runtime system-root injection
that the actual browser bundle consumes, followed by a fresh owned preparation
and replay. Current focused contracts after the replay: **108/108 passed**.

Subsequent November 8 checkpoint: source-backed root injection is implemented.
The production bundle and actual startup serializer pass **5/5** root-routing
browser cases; configuration unit tests pass **26/26**. No backend requests
are sent by that routing check. The owned preparation now binds the validated
fixture root in its ModelDesign environment. All **112/112** focused owned
contracts pass.

The final topology drift gate was also repaired: live Docker may enumerate
identical bind mounts in a different order. The witness sorts by destination
while still binding every source, target and read/write field.

Fresh preparation:
`.artifacts/native-model-design-owned-backend/owned-root-20261108-r9/report.json`.
Source/asset/eight-peer topology checks pass; the result is preparation only.
The default runtime-assets selection now points at the independently generated
`current-source-20261108-r9` receipt, not a rewritten historical hash.

Do not retain the experimental static optional-platform responses or ad hoc
launcher/proxy: both were withdrawn. Remaining work is a reviewed exact-peer
launcher, real platform services, refresh-token integration, and the native
home/editor/role matrix. Details:
`OWNED-MODELDESIGN-ROOT-20261108.md`.

Final full regression for this continuation: **4572 passed / 0 failed /
0 skipped / 0 cancelled**. Current source/log/receipt closeout:
`.artifacts/native-root-routing-20261108-r1/report.json`. Root configuration,
startup routing and preparation are verified; application home/editor,
platform-service and refresh-token gates are not closed by these results.

Actions:

- Reproduce the exact owned route with the same model, EBSX, workflow, UAA,
  ZooKeeper and service-OAuth inputs.
- Bind the failing request and provider log to one run.
- Inspect `PSSysApp` runtime creation, application resource/plugin resolution,
  `PSSysResource`/`PSSysSFPlugin` loading and ServiceHub application mapping.
- Compare the packaged model application declaration with the runtime model
  loader's required `getPSSysResource`/`getPSSysSFPlugin` inputs.
- Implement the smallest source/config fix; do not redirect the request to a
  different API or disable authorization.
- Rebuild only the affected source package and backend image.

Verification:

- Provider/gateway route probes return the expected application API status.
- ModelDesign `fetchcursys`, `fetchcurapp`, list and detail requests pass.
- Startup log has no late ApplicationRunner failure.
- Existing EBSX/UAA/permission assertions remain unchanged.

Evidence:

- New backend source package/image receipts.
- New owned startup report.
- New application-route report.
- No changes to failed historical receipts.

## Phase 2: Complete Backend And EBSX Startup

**Goal:** Turn the owned backend prerequisite chain into a complete startup.

Actions:

- Verify the 78-table model-derived EBSX schema and 38-table workflow schema
  against current package/model hashes.
- Bind dedicated owned service OAuth accounts and all `lb://` aliases.
- Verify Nacos, ZooKeeper, Redis, UAA and gateway peer identity.
- Run backend startup with fatal-log checks after initial HTTP, after all ports
  respond and after the stabilization window.
- Run provider/gateway/allinone API smoke with authenticated appdata context.

Exit:

- No missing table, alias, schema, datasource or late-startup failure.
- Application initialization report is true.
- All exact owned peers are cleaned after the run.

## Phase 3: Complete Authorization Matrix

**Goal:** Verify real multi-role behavior, not only login.

Actors per center/library:

- administrator
- editor
- viewer
- no-access
- expired-token user
- malformed/invalid-context client

Flows:

- login, self, appdata and organization context
- allowed read
- denied read
- allowed create/update/delete
- denied create/update/delete
- cross-library read/write denial
- forged system/root/organization context
- zero, negative and expired grants
- nested session/holder requests
- token cache rotation and grant rotation
- service OAuth and alias paths
- fresh login readback after mutation

Exit:

- Every matrix cell has actual HTTP evidence.
- No token, password or private SQL is written into public reports.
- Probe rows are removed and source/database baselines match.

## Phase 4: PLM Role And Business Workflow Matrix

**Goal:** Cover the main PLM product flows for desktop and mobile.

Roles:

- administrator
- product manager
- project manager
- developer/editor
- tester/reviewer
- resource manager
- viewer
- no-access user

Workflow groups:

- workspace/dashboard/my items
- product/project create, edit, member binding and cleanup
- ideas/requirements and work items
- workload/resource assignment and persistence
- sprints, plans and releases
- baselines and version comparison
- test library, case, suite, plan, run and review
- knowledge space/page/file/share flows
- reports/insights/dashboard configuration
- settings, roles, notifications and audit views

For every group:

- desktop and mobile
- non-empty and empty state
- validation and server error
- permission allow/deny
- save, reload, fresh-session readback
- cleanup and no unintended writes

Exit:

- Current matrix report maps every required workflow to evidence.
- Missing workflows are explicit `unverified`, never silently omitted.

## Phase 5: Full Plugin Behavior Matrix

**Goal:** Move from 73 source identities to behavior coverage.

Actions:

- Group all 73 plugins by function: navigation, picker, grid, editor,
  visualization, AI, PLM workflow and utility.
- Define required modes/actions per plugin from its manifest and model
  registration.
- Execute desktop/mobile checks for normal, empty, error, permission and
  persistence paths.
- Bind served bytes to the exact local build and current app dist.
- Record known unsupported modes separately from failures.

Exit:

- Every plugin has a coverage row.
- `scopedInteractionCovered`, `functionalAcceptance` and `nativeAcceptance`
  remain distinct.
- No plugin is marked complete from package/source presence alone.

## Phase 6: English And Documentation Localization

**Goal:** Complete visible bilingual behavior.

Actions:

- Classify the 3418 untranslated model labels into visible, internal,
  dynamic-data and not-applicable.
- Add translations for visible model captions, fields, code lists, dialogs,
  plugin messages and error states.
- Localize API Reference generated markdown or provide an explicit bilingual
  documentation bundle.
- Verify language switch persistence across login, navigation, iframe,
  dialogs, tables, empty states and errors.
- Add screenshots/text assertions for the requested areas: My Items, Workload,
  Ideas, Sprints, Baselines, Reports and secondary development.

Exit:

- No visible Chinese labels remain in the English target workflows unless
  explicitly classified as user data or technical identifiers.
- Chinese mode remains byte/behavior compatible.
- Locale audit and desktop/mobile browser checks pass.

## Phase 7: Marketplace And Offline Delivery

**Goal:** Make the catalog locally installable and recoverable offline.

Actions:

- Resolve the missing checkout and the two missing expected source directories.
- Bind each catalog item to local source/revision/license/artifact evidence.
- Stage package, README, icon and dependency assets locally.
- Test isolated offline install, update, failed update rollback and uninstall.
- Verify no registry, Git, CDN or remote icon request is required.

Exit:

- 23 catalog entries have explicit status.
- Installed package bytes and source/license inputs are receipt-bound.
- Offline install/update/rollback reports are green.

## Phase 8: D01 Source Closure

**Goal:** Close the required 12-component lower bound.

Components:

- standalone UAA
- Task
- modeling backend
- PLM backend
- allinone
- gateway
- PLM frontend
- modeling frontend
- app framework
- modeling plugins
- runtime model
- native CLI

For each component:

- current source inventory
- own dependency source closure
- reproducible build
- compiler/image receipt
- artifact byte binding
- runtime compatibility
- component-specific tests

Exit:

- `allRequiredComponentsVerified=true`.
- Full source closure is independently recomputed.
- No copied receipt, tag or partial projection is promoted.

## Phase 9: Clean Operational Reconstruction

**Goal:** Prove the stack can be rebuilt and operated without hidden state.

Actions:

- Build from a clean workspace/output root.
- Disable network and verify dependency/cache closure.
- Recreate containers, networks, schemas and volumes from owned manifests.
- Verify generated-code preservation and cross-repository revision manifest.
- Test restart, migration, rollback and failed-deployment recovery.
- Add image/source provenance labels or receipts for the three current ledger
  warnings.

Exit:

- Clean local/Docker/offline rebuild report is complete.
- Durable-storage recovery is separate from tmpfs fixtures and passes.
- Runtime ledger has zero FAIL and zero unexplained WARN.

## Final Release Review

The final review must contain:

- role/workflow matrix
- plugin matrix
- locale audit
- marketplace/offline matrix
- D01 component inventory
- source/revision/image manifest
- startup/security/persistence/rollback reports
- exact residual risks

No release or “all functions complete” statement is valid while any required
matrix cell is missing, unverified, or represented only by static source
presence.
