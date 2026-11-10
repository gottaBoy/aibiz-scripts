# Owned Runtime And Frontend Progress

Checkpoint: 2026-11-09, Asia/Singapore.

The remaining-work denominator stays 30 engineering items across eight groups.
It is not a count of absent product features. See
`REMAINING-EXECUTION-20261108.md` for current statuses.

## Verified Runtime Evidence

- Fresh owned fixture: `96ff5681e447`, private network `10.92.0.0/24`.
  The old `5d3585516a77` fixture and shared port 30250 remain untouched.
- Fresh source package: `backend-source-package-current-20261109-r4/report.json`,
  345 positive JVM tests. Three zero-test placeholders do not supply coverage.
- Fresh image binding: `backend-source-images-current-20261109-r1/report.json`.
  Allinone `5f13de782f3c`, gateway `c8a42f9d8509`, provider `96f2fa6cf57c`.
- Platform schema: 32 tables, 596 columns and 33 indexes; real operator values
  are initialized. `operator-dictionary-sysoperator-r3/report.json` subsequently
  passed 43 actual HTTP checks for all six ordinary accounts, two tenant
  repeats, strict source-backed ID/name aliases and anonymous 401. Every list
  contains exactly its organization's three members. Directory projections and
  model checksums remain unchanged.
- EBSX directory `ebsx-directory-core-directory-r1/report.json` verifies five
  source-bound rows against the real UAA directory without modifying its source.
- `platform-http-core-config-six-r1/report.json`: 278 actual HTTP checks passed.
  Backend refresh and invalid-refresh denial, six ordinary accounts' personal
  configuration save/update/fresh-login, all five foreign-account reads per
  owner and native cleanup passed. Model checksums remain unchanged.
  Global configuration authorization is explicitly not accepted.
- UAA security TTL remains 20 seconds. Harnesses renew by normal login rather
  than extending validity or manufacturing identities.
- `internal-message-http-notification-security-r3/report.json`: 120 true
  foreign-key 403 denials and 84 owner checks passed, including all six
  mark_all_read isolation cases. Native owner DELETE and physical zero-row
  baseline restoration passed. Composer/background delivery are not covered.
- `native-http-current-source-crud-restart-r1/report.json`: 182 actual backend
  checks passed. Both libraries' ordinary-user CREATE/UPDATE/REMOVE, cross-root
  denial, fresh-login readback and provider restart readback passed. Each
  library's MODELVER advanced exactly 816 -> 819; all other original physical
  fields were restored. Browser editor acceptance remains separate.
- Normal browser organization bootstrap:
  `owned-native-modeldesign-browser/organization-20261109-r1/report.private.json`.
  Twelve actual UI-login cases passed: all six ordinary actors in both apps,
  with Chinese/English and desktop/mobile samples. The browser fetched real
  organization lists, selected source-matching organization/system values,
  generated its own matching headers and received matching backend appdata
  person/user/tenant identity. Only normal saved language preference was set;
  no identity, organization, token or authorization header was injected.

Paths above are under `.artifacts/`; fixture-relative paths are under
`native-nonadmin-fixtures/96ff5681e447/`.

## Implemented And In Progress

- Frontend organization bootstrap uses the actual organization API, fails closed
  on missing/invalid context and preserves default behavior outside the owned
  profile. Active source fork and Hub source have separate focused tests.
- Seven active framework packages and the host type audit produced an isolated
  native-profile distribution in
  `frontend-candidates/2026-11-09T04-09-56.136Z-XpM8G8/dist`.
  This is not shared deployment or browser workflow acceptance.
- Runtime assets and launch inputs explicitly bind that distribution and its
  immutable source receipt. Owned preparation, reconstruction and bridge
  guards now preserve and recheck the binding instead of using old app/dist.
- Owned nginx appdata reaches the actual backend to initialize EmployeeContext.
  Its notification rewrite now passes `/extension/...` to the gateway, avoiding
  a duplicated `/api` prefix when the canonical extension filters run.
- The local model-design adapter has completed strict typechecking, the full
  declared build, resource-copy verification and reproducibility checks:
  `native-model-design-local-candidate/owned-source-20261109-r2/report.json`.
  The upstream build probe remains failed and is retained separately; neither
  source-build success nor adapted registration coverage is editor acceptance.
- A fresh Central service candidate was generated and read-only verified:
  `.artifacts/native-service-migration/central-query-20261109-r1/receipt.json`.
  It changes only the two Central grid references from `FetchDefault` to the
  existing published `FetchCurDCSLNUser` POST query. It is still candidate-only:
  current-user row isolation and cross-center denial are not yet proven.
- The service candidate is deliberately not mounted yet. The isolated launcher
  currently mounts only the three application root model files, so promoting
  this candidate requires an explicit read-only GridView mount plus receipt
  guards in isolated preparation, owned preparation and launch reconstruction.
  This avoids accidentally serving the old vendor `FetchDefault` model.
- The isolated and owned input contracts now implement that mount binding and
  guard both the candidate receipt and GridView bytes. Contract tests cover the
  exact read-only target. Runtime/browser acceptance remains pending a fresh
  frontend asset chain because the current source receipt is stale.
- The local Design Index todo counter now exposes `pending`, `ready` and
  `unavailable` state. Only a real 404/405 marks the optional PLM service
  unavailable; 401/403/5xx remain errors, and no zero count is fabricated.
  The focused package suite passes 4/4.
- Because the Design Index source and distribution changed after the last
  frontend receipt, the previous frontend candidate is stale for release
  purposes. A fresh framework/type/candidate/runtime-assets/source-dist chain
  and browser run is required before any new browser acceptance claim.

## Retained Failure

`internal-message-http-notification-security-r2/report.json` fails strictly:
120 cross-account GET/PUT/DELETE/mark_read probes returned real 403 responses,
and all physical columns stayed unchanged after each attempt. The first 54
owner semantic checks passed, but mark_all_read returned 200 without the
expected status change. Six owned messages were removed through native owner
DELETE and the physical table returned to zero rows.

The actual client sends `{}` for this POST action; the harness incorrectly sent
zero bytes despite a required request body in the native HTTP adapter. This
was corrected in the harness, not in backend source or assertions. The new r3
receipt passes the complete sequence; the original r2 remains failed.

The operator dictionary's first two attempts also remain failed. The r1 guard
wrapper omitted its verified topology return, stopping before dispatch. The r2
strict response schema omitted source-declared `id`/`label` aliases. The fixed
harness now binds `CodeItem.java` and requires `id=value`, `label=text`; it does
not ignore extra fields or accept empty lists. The r3 full sequence passes.

The first current full scripts regression completed, rather than hanging:
4858 tests, 4852 passed, six failed, zero skipped and stable source. Five
failures used stale backend/frontend build evidence and one pinned the old
Java/Groovy file count. Tests now consume the new real immutable receipts and
reviewed 4386-file inventory, with all existing strict assertions retained.
The focused failed suites pass. The new full r2 regression then passed
**4858/4858**, zero failures/skips/cancellations/todos and stable source:
`.artifacts/current-source-regression-20261109-r2/report.json`.
It completed in 366 seconds with 30-second progress records; the r1 failure
remains unchanged. This is tooling regression, not full business acceptance.
After the two real-browser observer corrections below, the final r3 full run
passed **4860/4860**, zero skipped and stable source, in 362 seconds:
`.artifacts/current-source-regression-20261109-r3/report.json`.
This remains the last completed full regression before the current Design Index
and MQTT source edits; it is retained history, not a current-source baseline.

The earlier r1 stopped before HTTP or writes because the snapshot harness
wrongly required uppercase physical column names. Its case-fold compatibility
fix preserves all columns and rejects collisions; the failed receipt is not
rewritten.

## Next Gates

The operator dictionary, notification and current-source backend CRUD/restart
are now verified within their stated scopes. Full scripts regression passes;
normal organization bootstrap is verified, while actual home/list/menu and
editor behavior still need completion on the bound distribution. Update counts
only from passing scoped receipts, then rerun full scripts on frozen changes.

## Browser Follow-up

The source-bound frontend launch succeeded:
`owned-native-modeldesign-launch/current-source-20261109-r2/report.json`.
The first full Chinese prerequisite probe preserved
`owned-native-modeldesign-browser/current-source-zh-20261109-r1/report.json`.
Models, plugin assets, normal login and theme rendering passed, but the
prerequisite gate failed. Its readiness observer incorrectly accessed
document.body during a real document replacement; the observer now treats
that as unready rather than either fatal or accepted. Its exact prelogin
organization 401 is now classified like prelogin appdata 401, while
postlogin/foreign-path/403/404/5xx remain failures.

Independent source review established a real remaining MQTT policy defect:
the served deployment environment has enableMqtt=false, but native ModelDesign
model userParam.enableMqtt="true" overwrites that value in AuthGuard before
AppHub initialization. ModelDesign attempts a missing MQTT WebSocket route.
No request interception, synthetic success or mutation of the six bound
models was used to hide it. The collaborative-room connection path also needs
its own explicit policy before claiming global MQTT disablement.

A minimal opt-in fix is now implemented in both editable web framework trees.
Native `main.ts` passes only an explicit boolean deployment override, and
`AuthGuard.initEnvironment` reapplies it after model `userParam` processing.
This prevents ModelDesign's `userParam.enableMqtt=true` from overriding a
native deployment `false`. It is not runtime-accepted until the complete
source/build/assets chain and a browser proof; collaboration transport remains
separate.

The missing exact ext/package.json is the native platform's optional-extension
discovery contract, not proof of a missing required plugin. Its 404 evidence
is retained rather than blanket-whitelisted in this browser gate. Source and
minimal future repair boundaries are recorded in
`modelingweb/docs/OWNED-FRONTEND-SOURCE-DELIVERY-20261109.md`.

The corrected Chinese r2 and English r1 prerequisite probes both retain an
overall failed verdict. Central passes real home and reload in both languages,
but navigation rejects the actual original FetchDefault/DATAQUERY. The owned
mount set does not yet include the separately reviewed local service-grid
repair. That repair must be bound explicitly and paired with current-user
query isolation; its existence is not permission acceptance.

ModelDesign passes model/plugin/login/theme, but its actual design-index
lifecycle fails on POST work_items/count_my_todo returning 404. The eight-peer
owned backend intentionally lacks a PLM business service. Do not fabricate
zero todo counts or call this an empty successful workflow. Supply a real
owned dependency or a reviewed explicit unavailable-state contract, while
keeping messaging transport and collaboration policy distinct.

Both test frontends and their exact two loopback bridge processes were removed
after browser capture:
`owned-native-modeldesign-launch/current-source-20261109-r2/cleanup-120d58a184e5.json`.
Only the eight owned backend peers remain for this fixture. Shared 30250 was
not promoted or restarted. Current checklist count: **5 VERIFIED, 25 not fully
verified**; no whole-product completion or percentage is claimed.

## Optimization Replay

The subsequent completed round is recorded in `OPTIMIZATION-20261109.md` and
`.artifacts/frontend-optimization-20261109-r1/closeout.json`.

The full fresh delivery chain is rebuilt; r6 full regression passes 4919/4919
with zero skips and stable source. Both languages now pass Central and
ModelDesign home readiness and reload. An explicit live browser probe confirms
the MQTT deployment override and truthful unavailable todo state in both
languages; no WebSocket connection occurred in either five-second sample.

Central's reviewed GridView is actually mounted and its published FETCH is
requested. The backend returns 404 because the owned routing proof currently
selects only ModelDesign root routes. The original member SQL also lacks a
trusted current-person condition; route publication must not be treated as
permission isolation. ModelDesign menu navigation still does not mount its
target; several entity datasets return real 403 responses for the editor
fixture. These need source-role/grant analysis, not blanket authorization.

Both full browser prerequisite reports remain failed. Temporary frontends and
loopback bridges were cleaned again, with eight owned backend peers retained.
Shared 30250 remains unchanged. Checklist counts remain 5 verified/25 not fully
verified because these narrower fixes do not close complete M01/M02 workflows.

## November 10 IDE Enhancement

The user's Modeling IDE enhancement request is tracked in
`MODELING-IDE-ENHANCEMENT-20261110.md`. The actual source-derived native editor
candidate gains validation/format/history/diff/download, protected dismissal,
pre-import conflict checks, verified post-import readback and bilingual
responsive controls. Atomic-CAS and semantic-schema limits remain explicit.

The current candidate is `ide-20261110-r4`; its complete model/plugin candidate
and runtime assets have been rebound without modifying the vendored source or
shared deployment. Source regression 63/63, controlled UI 5/5 and final full
scripts 4930/4930 pass with zero skips and stable sources. Final evidence:
`.artifacts/modeling-ide-20261110-r2/closeout.json`.

Five missing model-instance registry entries remain a source-diagnosed access
prerequisite. The maintained registry has 21 unique model entries; restoring
reviewed entries and proving actual allowed/denied behavior requires a fresh
backend build/runtime gate. No broad grants or production registry changes
were made for this editor delivery. Checklist totals stay 5 verified and 25
not fully verified, rather than counting controlled UI as native acceptance.
