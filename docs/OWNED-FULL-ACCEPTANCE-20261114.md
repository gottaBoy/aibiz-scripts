# Fresh Owned Acceptance

Checkpoint: 2026-11-15, Asia/Singapore. This is a bounded fresh runtime campaign,
not a declaration that all application capabilities are accepted.
The canonical matrix still has **25 unaccepted top-level items**.
The sections below are chronological. Both fixtures are now retired; the
final replay, failure classifications and cleanup are at the end.

## Environment And Boundaries

The first fresh two-center fixture is `de214359c3ca`; after diagnosis it was
retired before the replacement fixture `65f849ae29ce` was created. They were
never run as two concurrent stacks. Raw evidence remains private under their
respective `.artifacts/native-nonadmin-fixtures/<RUN>/` directories.
It does not reuse the retired 26-container environments or shared databases.
Shared services are not restarted, replaced or migrated.

The fixture uses model-derived standalone UAA tables, scoped application
accounts, tmpfs MySQL and a private internal network. Its native JWT lifetime
remains 20 seconds. This storage profile does not prove restart durability.

Compiler containers and major runtime services now have explicit CPU,
memory and process limits; backend/UAA JVM heaps are also bounded. Owned
frontend launches are limited to 2 CPU, 2 GiB and 256 processes each, and
their live limits are rechecked. This is not a claim that every auxiliary
one-shot compiler in every historical harness has been bounded.

## Initial Runtime Evidence

This table describes the first, now-retired `de214359c3ca` attempt.
It is not the final candidate evidence.

| Gate | Current result | Private receipt |
| --- | --- | --- |
| Fresh SQL fixture | Passed, isolated schema scope only | `isolated-sql-report.json` |
| Scoped application accounts | 32 checks passed | `application-accounts-acceptance-r1/report.json` |
| Workflow bootstrap | Passed exact-library schema initialization and read-only verification | `workflow-schema-acceptance-wf-r2/report.json` |
| EBSX bootstrap | Passed owned model-derived schema and membership projection | `ebsx-schema-acceptance-ebsx-r1/report.json` |
| Fresh UAA | 16 real HTTP checks passed; actual Boot/login and stored tampered/expired-token rejection | `uaa-runtime-acceptance-uaa-r2/report.json` |
| Backend startup | Passed actual startup/transport checks, not feature acceptance | `backend-runtime-acceptance-backend-r1/report.json` |
| Role/root HTTP | 182 checks passed, including the canonical 60-operation matrix and fresh-login readback | `native-http-auth-baseline-20261114-r1/report.json` |
| Fresh-token grant variants | 200 checks passed; eight variants, exact original-row restoration after each | `authorization-http-grant-variants-20261114-r1/report.json` |
| A01 invalid roots | Attempt 2 reached a real malformed-root HTTP 500; not accepted | `authorization-a01-a01-20261114-r2/report.json` |
| Fresh frontend/browser | Both owned frontends launched with pinned assets and limits; browser flows in progress | `.artifacts/owned-native-modeldesign-launch/acceptance-20261114-r1/report.json` |

The role/root lane removed both case-owned probe modules through the native
editor API. Final original full-column module/system projections matched,
with the expected three model-version increments in each physical schema.
Grant variants verified zero, negative, expired and READ-only modes on
both original editor grants. Every one of the eight temporary mutations
reports `restored-exact-original`, with fresh-login readback. This does not
establish same-token revocation, nested-session behavior or full M04.

## Initial Build And Frontend Pins

The current source permission regression passed focused 135 and full 304
tests. Package verification passed 386 tests; three zero-test placeholders
remain explicitly noncoverage. The three new ARM64 backend images passed
JAR/image byte binding, not production/source-closure acceptance.

Current build receipts:

- `.artifacts/modeling-permission-acceptance-20261114-r2/report.json`
- `.artifacts/backend-source-package-acceptance-20261114-r2/report.json`
- `.artifacts/backend-source-images-acceptance-20261114-r2/report.json`

The complete frozen offline dependency seed was rehashed before reuse.
Its exact Spring Test 5.3.1 artifact repaired the missing host-cache
dependency without disabling tests, network downloading or modifying the
host Maven cache. The first failed package receipt is preserved.

Read-only current-source verifiers accepted the existing independent host
dist, model-design build and replacement plugins. The old runtime-assets
receipt failed current design-index drift checks, so new candidate/assets
were prepared instead:

- `.artifacts/native-model-migration/acceptance-20261114-r1/`
- `.artifacts/native-ai-code-runtime-assets/acceptance-20261114-r1/`
- `.artifacts/native-model-design-isolated/acceptance-20261114-basis-r1/`
- `.artifacts/native-model-design-owned-backend/acceptance-20261114-owned-r1/`

Frontend Central uses the verified view-only candidate; its actual GridView
hash equals the view staged from the backend full member candidate. Only the
reviewed exact READ dataset route is enabled, not ordinary-member Create.
The reusable host/build pins and commands are in
[the preflight](OWNED-ACCEPTANCE-PREFLIGHT-20261114.md).

## Failures And Repairs

1. Workflow attempt `acceptance-wf-r1` refused the retained UAA/Redis peers
   before SQL mutation. Their exact inspected IDs were archived and removed;
   workflow/EBSX then passed on the MySQL-only network. UAA was freshly
   started and all 16 checks rerun under `acceptance-uaa-r2`.
2. Native built-in Get methods have `name`, not `codeName`. A strict shared
   read-policy helper now recognizes the actual 265 keyed GET/READ actions,
   while still denying writes/custom aliases. The old predicate yielded no
   read collections. Same-center actor selection also now resolves actual
   roots instead of center-name suffixes.
3. A01 attempt 1 recorded two anonymous controls and ten authentication
   observations with unchanged complete snapshots, but snapshot overhead
   exhausted the normal token freshness margin before the first authenticated
   model request. No invalid-root case passed. Complete coverage is 848 tables
   and 30,660 physical columns across both model schemas. The failed report
   remains failed; token expiry/claims and denial criteria are not relaxed.
4. A01's continuous read-only sequence now records each complete post-request
   snapshot as the immediately following request's complete pre-snapshot.
   No intervening business/authentication HTTP or SQL writes are permitted;
   each response still receives a new full snapshot, all compared to the
   baseline. Snapshot IDs, source and collection times are explicit. Renewal
   uses normal backend login and verifies that new token's self/appdata.
   Slow-snapshot and insufficient-window regression tests passed; no 401 is
   reclassified as authorization denial.
5. Attempt 2 passed the anonymous controls and editor A own-root 200/foreign
   403 controls, then the first whitespace-root READ returned real HTTP 500:
   `Exception`, code 1, "未传入开发系统标识". Its full before/after snapshots
   matched. Source review locates a checked-exception denial branch in
   `PSModelDEAccessManager`, mapped to INTERNALERROR by the real exception
   handler; absent SYS/SLN lookups have the same error-classification risk.
   This is a product defect, not an accepted permission rejection. A narrow
   leaf-level ACCESSDENY fix and real mapper tests are pending.

Focused joined Node regression at this checkpoint: **638/638**, concurrency
limited to two, zero failures/cancellations/skips/todos. It includes the
resource, source-package/image, owned runtime, browser policy and A01 tool
contracts, not live business acceptance. Private TAP:
`.artifacts/owned-full-acceptance-20261114-r1/focused/focused.tap`, SHA-256
`13487a32a838fcf250e06944fc7b60079df29f440e3df294daaa6660d9e18979`.

The new PSModule editor runner has source/controlled tests only so far.
It permits only the sentinel's non-NULL name through normal UI Save,
fresh-session readback and UI restoration. Full dual-schema snapshots
restrict effects to the own module name/audit, model version and module log.
Console/page/HTTP/failed-network evidence blocks that bounded acceptance.
See [browser handoff](OWNED-BROWSER-ACCEPTANCE-20261114.md).

## Still Unaccepted

All 25 top-level gates retain their previous acceptance status. In particular,
48 typed/null/absent logical A01 cases have no faithful native String-URL
transport; fresh-token grant rotation is not A02 same-token revocation;
M01 administrator Create, M02 legitimate configuration rows, full M03/M04
and the PLM lifecycle/plugin/language/deployment matrices remain separate.
Real third-party enterprise credentials and MQTT end-to-end prerequisites
cannot be replaced by mocks or a disabled-feature banner.

Final browser results, cleanup and shared-runtime comparison will be added
after execution. A running owned frontend is still not an accepted release.

## Repair And Fresh Replay

The first browser run is a real failure, not a green navigation result:
all four editor A language/viewport combinations logged optional extension
manifest 404, native messages 404 and PLM todo-counter 404, plus pre-login
401/navigation errors. One English mobile case also recorded
`ERR_NETWORK_CHANGED`. No failed-network, console or response filter hid
them. Tightened bootstrap summary gates now include all those observations.
The M03 attempt stopped at menu readiness, before navigation or any Save.
The report alone cannot distinguish a selector mismatch from a menu-state
failure. The bound component source supports an index-attribute hypothesis;
new control-scoped exact-model-caption matching and richer public diagnostics
still require actual replay.

After the failed browser attempts, an independently guarded complete physical
comparison passed: 848 tables and 30,660 columns matched the M03 initial
snapshot. Private result:
`de214359c3ca/browser-failure-physical-comparison.private.json`, SHA-256
`cd12f15ff243a2273c7021177e958c9b4b2e59d1386473ec98f39beb983dd3d1`.
Both frontends/bridge processes were cleaned, then all eight backend fixture
containers and its private network were retired. The three unreferenced
run-built images were removed by exact receipt identity, without force or
global pruning. The shared inventory remained 12 running services and zero
related historical containers.

The narrow A01 fix changes seven malformed/missing-root denial branches to
`ErrorException(ACCESSDENY)`. Optional current-root lookup still returns NULL;
genuine service/database failures and the global exception handler are
unchanged. Ten new tests call the actual exception mapper, including 403
denial, unchanged record/search input, no invalid-root lookup/cache write and
preserved 500 errors. They are now part of the mandatory focused suite list.

Current-source receipts, not the retired first image chain:

- `.artifacts/modeling-permission-acceptance-20261114-r3/report.json`:
  focused **145**, full **314**, no failures/errors/skips.
- `.artifacts/backend-source-package-acceptance-20261114-r3/report.json`:
  **396** tests; the three zero-test placeholders remain noncoverage.
- `.artifacts/backend-source-images-acceptance-20261114-r3/report.json`:
  three current ARM64 byte-bound images, not production acceptance.

The replacement fixture uses the supported fresh ordering:
SQL/accounts -> workflow -> EBSX -> platform (MySQL-only) -> UAA/Redis ->
backend with `--platform-report`. Platform bootstrap passed the real
32-table model-derived schema and locked read-only, password-masked
projection without inventing employee numbers. Initial backend publication
includes the extension runtime and canonical route; the retained-stack
replacement publisher gap is not bypassed or needed for this fresh path.
Fresh UAA's 16 real checks passed again. Normal role/root HTTP passed all
182 checks again; full A01/grant/browser replay is still in progress.

The owned bare-Modeling frontend explicitly disables only the unavailable
PLM todo counter through a typed capability flag. Disabled means undefined
count and no HTTP, never fabricated zero/ready. Absent/true preserves the
shared default behavior; this does not accept PLM counter functionality.
Its local plugin output was rebuilt. Because the environment mapping is a
host receipt input, a new source host was assembled and verified:
`.artifacts/frontend-candidates/2026-11-14T12-50-39.146Z-Ty8wdu/report.json`,
SHA-256 `b138fbdb774eee9cf2137d461539b7901be540ecb256d6c686ccef644db8df0b`.
The old host receipt was correctly refused after that source change.

Repair-focused joined contracts passed **493/493**; earlier attempts with
stale nine-suite fixture expectations were preserved and fixed by adding
the required tenth suite, not removing its gate. Private TAP:
`.artifacts/owned-full-acceptance-20261114-r1/focused/repairs-r3.tap`,
SHA-256 `6ef4481ffef1a0d1eacff094cea8c4aaa341774d5e1da8d7403779699f34f184`.
These controlled results are not summed with the earlier 638 as unique
capabilities or live acceptance checks.

## November 15 Final Replay

All paths in this section refer to the replacement fixture `65f849ae29ce`
unless an absolute workspace-relative artifact path is given. Its platform
schema was prepared before UAA and was part of initial backend publication,
not a later shared service repair.

| Scope | Final Observation | Private Receipt |
| --- | --- | --- |
| SQL / accounts / schemas | Fixture and workflow/EBSX/platform initialization passed; accounts 32 checks; 32 physical platform tables | `report.json`, `application-accounts-acceptance-r1/report.json`, `workflow-schema-acceptance-wf-r1/report.json`, `ebsx-schema-acceptance-ebsx-r1/report.json`, `platform-schema-acceptance-platform-r1/report.json` |
| UAA | 16 real checks, including stored tampered/expired-token denial; native JWT remains 20 seconds | `uaa-runtime-acceptance-uaa-r1/report.json` |
| Role/root HTTP | 182 checks and probe cleanup passed, with expected native version deltas | `native-http-auth-baseline-20261114-r1/report.json` |
| Grant variants | 200 fresh-token checks; eight exact original-row restorations | `authorization-http-grant-variants-20261114-r1/report.json` |
| A01 | 36 representable malformed String-root requests all 403; 16 controls and 84 authentication observations; all 848 tables / 30,660 columns unchanged | `authorization-a01-a01-20261114-r1/report.json`, SHA `60f01ada5468bef1384009fde04b0f87e6ee30c43429a7b3d26df65d7c46f600` |
| M03 editor A | Actual Chinese desktop name Save, fresh-session readback, UI restoration and third-session readback; two PUT 200; overall FAILED | `.artifacts/owned-module-editor-browser/m03-a-zh-desktop-20261115-r6/report.private.json`, SHA `5b89e77884e4900fe53f1a276cb551ae3855896e5a00b44c1ac973d29ceb71da` |
| M03 editor B | Actual English desktop same roundtrip; two PUT 200; restored business name; overall FAILED | `.artifacts/owned-module-editor-browser/m03-b-en-desktop-20261115-r7/report.private.json`, SHA `123aa11bb6e45c5d819643b61d96875717862a93c8100a8792ca890f4a177866` |
| M04 | Six root-controller diagnostics only; errors retained, no full/native/permission acceptance | `.artifacts/owned-modeling-permission-browser/m04-20261115-r3/report.private.json`, SHA `5e53d94f9bfc79086d02741ee743824eac124b2a97d653f0914c0790d2ab4b7c` |

Both actual module roundtrips permitted only the own module name/audit,
native module log and exactly one version increment for each Save. Each
root advanced 819 -> 820 -> 821; no SQL reset erased native audit/version
effects. All business names were restored. A's r6 cleanup label predates
the reporting-label correction, but its actual Saves, snapshots and restored
name remain evidence. Both overall browser receipts remain failed.

The owned capability flag now produces `disabled`, undefined count and zero
PLM counter requests in all six real editor sessions. ECharts' library build
is explicitly production-defined and its new output has no `process`
references; those sessions no longer raised `process is not defined`.
This does not validate business counter behavior or chart data/rendering.
The final source host receipt is
`.artifacts/frontend-candidates/2026-11-14T15-22-43.103Z-R9lCya/report.json`,
SHA `8ce805e1cd9a6292e99da6229ac04c0bd8256b11af10cc4e2bd0b373df3fe65b`.
Owned launch r3 used that host, fresh migration/runtime assets and backend.
It was never promoted to shared runtime.

## Final Diagnostic Limits

The initial M04 six-case attempt timed out because the public collector
omitted runtime context, not because that timeout established a viewer
product failure. A minimal `psdevslnsys` observation and strict root matching
fixed that defect; sensitive arbitrary context is not serialized.

R3 observed six matching mounted root controllers and zero 401 requests
whose request and response both occurred after normal login. Anonymous
401, navigation console errors and two extension 404s per case remain in
the evidence. Three module-list 403s were captured; no viewer nonempty data
or unobserved denial is inferred.

Visual review then found the Chinese mobile screenshot still on its global
blue loader. Thus its `home=PASS` field proves only the old controller
predicate, not visible UI readiness. The source now requires explicit
overlay evidence, no visible loader and a stable 200 ms interval. It uses a
nonaccepting readiness label. This stricter gate has controlled tests only;
the fixture was not recreated for a further live run. Raw reports remain
immutable. All 48 role/root/language/viewport scenarios, negative UI writes
and the other six editor combinations remain unaccepted.

Independent review found and repaired two M03 tool risks after those live
runs: uncertain dispatched writes now retain the fixture rather than
claiming no cleanup, and acceptance is decided after browser closure and
pending evidence draining. Fault-injection tests cover snapshot/guard/
parse/journal/teardown failures. The earlier actual failed receipts do not
become green from these source changes.

Keyed read forwarding now requires exact owned fixture keys as well as a
source-published native READ method. Non-READ GET actions such as GetDraft
cannot be treated as arbitrary IDs. The permission diagnostic uses the same
precise policy instead of all same-origin GETs or suffix-only fetch rules.
No extra identity, authorization header, forced click or controller action
was injected.

Real remaining blockers and implementation order are in
[Current Runtime Blockers](OWNED-RUNTIME-BLOCKERS-20261115.md): logical-system
bootstrap/hardcoded UUIDs and `PSSYSTEM.READ` policy, extension discovery,
normal authentication error handling, reviewed request/effect contracts,
native Unicode, mixed English labels, remaining matrices and external/
release prerequisites. A01's 48 typed/null cases remain blocked, grant
variants are not A02 same-token revocation, and A03/A04 remain partial.

## Final Cleanup And Verification

After all browser contexts closed, the two owned frontend containers and
both bridge processes were cleaned through the pinned launch state:
`.artifacts/owned-native-modeldesign-launch/acceptance-20261114-r3/cleanup-4c20403059e0.json`,
SHA `30c509ba76aa618cac25e2a23e5961b0a257806d408b471e01cbdaecbf594ad1`.

A separately guarded SELECT-only snapshot then matched the complete last
UI-restored snapshot, not the original pre-write baseline: 848 tables /
30,660 physical columns. Report:
`post-browser-final-physical-20261115-r1/report.private.json`,
SHA `3db1a76f2f588bf2dfc6a8ad75148aa32134f812c3506a493181ee957ef5cb00`.
Its reference is R7's `0024-snapshot.private.json`,
SHA `47267fd33874ae71d47265a58344abdef0d6f9a81c67f9b9a514a057381e8566`.

All eight backend fixture containers and its exact private network were
retired with `retire-owned-native-fixture.mjs --retire-owned-tmpfs`.
Receipt `retirement-acceptance-r1/report.json`,
SHA `6c0ce2cbb213ea01ec5c3aebb288312913cbf1a7f8ea8edca5b168565a0b4e40`.
The three current run-built images were then verified against their receipt,
exact tag/ID/labels and absence of references in every container, and removed
by exact tag without force. No other image, persistent volume or global
cache was pruned. Image-removal receipt:
`.artifacts/owned-full-acceptance-20261114-r1/retired-r3-images.private.json`,
SHA `4f702ffa417b90b53b8dfeb9aa1ea096f87ea32cf42c6eb9d4d364fd2fbd24be`.

Final inventory:
`.artifacts/owned-full-acceptance-20261114-r1/runtime-after-20261115-r1/report.json`,
SHA `5f11c0fdad2eaffd2bfc1ae350d25fa0efd997b4f19a6b562dd3069f344b5e01`.
It contains 12 shared services, 18 tags / 18 image IDs, no tag drift and
zero owned/historical containers. Shared exact IDs/images/start times/
restart counts/inspected configuration/network identities match the initial
campaign baseline. Comparison SHA:
`9c5f7eeb23d27bf1c392a9fa692dee7225766e10db7dd2b335216367f71bcbd5`.
The maintained observed-image lock also passed for all 12 services.
This does not freeze bind-mounted source bytes: the environment mapping
was edited. No shared restart/replacement or SQL migration was performed.

Final joined Node regression: **955/955**, 23 selected files, concurrency
two, zero failures/cancellations/skips/todos. It includes the real in-memory
Vite production test, controlled snapshot/dispatch/teardown paths and
resource-policy tests, not 955 live business checks. Private TAP:
`.artifacts/owned-full-acceptance-20261114-r1/focused/final-node-20261115-r2.tap`,
SHA `86cc77cbb9b44cb5d4207c6bbe30ab8c34d39612f1fb08a700ebf2cd656a255a`.
No full `npm test` was run because some tests can start dependency services.
The manual-reference suite separately passed 10/10. Backend `442f8bad` has
been pushed; Modeling frontend/tools are source commit `78f5422d`, and
scripts/tests/progress belong to this document's commit. Source delivery
is separate from runtime deployment.
