# Current Runtime Blockers

Checkpoint: 2026-11-15, Asia/Singapore. Campaign receipts retain their
20261114 names. The canonical matrix remains **25 top-level items not fully
accepted**. This table distinguishes real runtime failures, controlled
observations and unexecuted prerequisites.

The later fixed-candidate wave is classified in
[Candidate Validation](CANDIDATE-VALIDATION-20261115.md). Its four bilingual/
viewport startup observations have zero captured errors, failed requests or
blocks, but do not accept deep navigation or all features. The separate
context request reached generic UAA rather than the native system endpoint;
that wiring failure is not evidence that an already verified business flow
regressed. Native mb4 planning still has 31 real wide-row blockers, not 31 new
page failures. The single owned campaign has been fully retired.

The November 18 [mobile/locale source checkpoint](MODELING-MOBILE-LOCALE-20261118.md)
adds real UI source fixes and controlled regression, not a new deployed
candidate or closure of the runtime gates below.
The later [multi-agent implementation](MULTIAGENT-IMPLEMENTATION-20261118.md)
extends the scoped vocabulary to PSObjType and all 38 static lists referenced
by the five reviewed views. These source additions still need native replay.

## Verified Progress

- Current backend source `442f8bad` passed 145 focused / 314 full permission
  tests and 396 package tests. Actual invalid-root HTTP: 36 requests all
  returned 403; 16 controls and 84 authentication checks passed. All 848
  physical model tables / 30,660 columns remained unchanged.
- Fresh normal role/root HTTP passed 182 checks. Fresh-token grant variants
  passed 200 checks with exact restoration of all eight temporary changes.
  This does not establish A02 same-token revocation.
- Actual UI module-name Save, a new-session readback, UI restoration and a
  third-session readback ran on A/Chinese desktop and B/English desktop.
  All four PUTs returned 200. Complete dual-schema comparisons permitted
  only the own name/audit, native module log and one version increment per
  Save; each root advanced 819 -> 820 -> 821. Business names were restored.
- Both UI runs remain **FAILED overall**. Browser errors and protected
  request blocks were not filtered. They do not close M03, full M04 or L02.
- In all six fresh editor sessions, the owned PLM counter was explicitly
  disabled with undefined count and zero counter requests. ECharts no longer
  raised `process is not defined`. This does not accept PLM counter business
  functionality or complete chart rendering/data correctness.

Detailed lifecycle and receipt paths:
[Fresh Owned Acceptance](OWNED-FULL-ACCEPTANCE-20261114.md).

## Remaining Gates

| ID | Local Observation | Current Evidence | Required Work |
| --- | --- | --- | --- |
| R01 | Shared views still force the template UUID; a minimal bootstrap source contract is now available | Root/actor/center-bound appdata identifiers, JSON serialization and cross-fork delayed-result guards pass controlled tests; the three-view patch stays isolated. R01/R02 fail-closed contract tests now pass 76/76 | Package/build a coherent candidate, verify actual root-scoped HTTP, apply the patch only to its private staged model, and complete shell/root/disposal workflows |
| R02 | Root editor grants still do not grant generic `PSSYSTEM.READ` | Prior own-root FetchDefault remains real 403. New appdata exposes only two routing identifiers, not the system DTO or generic READ. The new contract explicitly rejects implicit PSSYSTEM.READ and settings authorization | Define the system-details/settings field/role contract and verify native enforcement; do not equate the metadata projection with PSSYSTEM.READ |
| R03 | Optional extension manifest is requested but absent | Actual `/remotemodel/ext/package.json` returned 404 before and after login. Source contract now distinguishes an optional missing manifest (allowed 404) from required script/style failures and forbids fake 200 manifests | Re-run the exact live route on the final candidate and classify the deployment; do not synthesize an empty success response |
| R04 | The observed shared/native startup still has pre-login 401/navigation errors; a source repair is now available | Default no-credential entries now redirect before protected initialization; 26 real-router cases and eight controlled browser contexts pass, plus 210 auth/environment tests, source build and full type check | Assemble a complete candidate and replay real native login on one fresh owned stack; extension 404, remembered-session failures and other errors remain separate, with no string filters |
| R05 | Portal history, dynamic dashboard and overview-statistic calls have not passed a reviewed request/effect contract | The harness blocked these calls before dispatch. Source review now confirms that overview internally fetches five datasets without their Service API READ entry, and VOID does not always suppress the single-input result | Implement the precise method/DTO and six-way authorization boundary described in `R05-OVERVIEW-REPAIR-BOUNDARY-20261118.md`, then owned snapshots/replay/cleanup; do not substitute a template-ID edit or fake zero |
| R06 | Native source schemas have mixed three-byte/four-byte UTF-8 collations | Read-only owned inventory: each physical model schema has 397 `utf8_general_ci` and 27 `utf8mb4_general_ci` tables; metadata has 90/8, standalone UAA has 18 mb4 | Per-column/index audit, source migration, backup/clone restore, idempotence and actual API special-character roundtrips; PLM's prior migration does not prove native schemas fixed |
| R07 | Two desktop editor combinations are not the eight editor or full 48-role browser matrix | Real A/Chinese and B/English roundtrips only; mobile, remaining editors and negative UI writes remain separate | Complete responsive navigation, all role/root/language/viewport flows, persistence, rejected-write effects and cleanup |
| R08 | External integration and release prerequisites remain distinct | Source contract now covers DINGTALK/WXWORK/OAUTH paths, explicit WeCom binding, bilingual errors and MQTT disabled/missing-topic/unavailable/subscription-denied states. No real third-party delivery, broker/WebSocket/ACL E2E or shared-stack rollout/rollback evidence | Supply/review real inputs, validate scoped credentials/ACL/delivery/recovery, then controlled release with backup and rollback |
| R09 | Prior native English UI was mixed-language; expanded scoped source repair is now available | Five authoritative views' static display metadata and 38 referenced STATIC lists / 567 pairs now include all PSObjType and activity/log labels. Provider/service custom-content, cache, merge and language-switch tests pass; seven-package frontend build/types and source-candidate integrity pass | Verify actual errors, refresh, deep links and mobile layouts on a complete owned native candidate; scope-external views and dynamic data remain separate, and no persistent IDs are translated |
| R10 | A mounted root controller still does not establish complete visible editor readiness | Earlier APPINDEX/console/footer receipts remain narrowly scoped. New source fits the recognized shell on mobile, excludes custom/ambiguous geometry and passes eight controlled shell browser cells plus existing footer/console probes | Require stable loader-free real editor navigation, useful viewport geometry and full interactions on the final candidate; controlled host-layout tests are not native CRUD/layout acceptance |

The collation inventory is limited to the schemas declared in this fixture's
manifest, not a blanket audit of every derived or shared schema. It is a
metadata observation, not an API Unicode acceptance result. No shared SQL
migration was performed.

`PSSYSTEM` source defaults fall through to generic SELF/READ role checks
when no runtime override is registered. That explains the observed denial
path but does not establish the product policy that it must be admin-only.
Dynamic roles/plugins and safe returned fields need explicit review.

The separate logical-system lookup probe was diagnostic and failed. Its
temporary exact read-transport extension was removed; no generic request
allowlist widening was retained.

The final six-case diagnostic is
`.artifacts/owned-modeling-permission-browser/m04-20261115-r3/report.private.json`,
SHA-256 `5e53d94f9bfc79086d02741ee743824eac124b2a97d653f0914c0790d2ab4b7c`.
It retained every console error, both extension-manifest 404s per case and
the anonymous 401. Request/response phases distinguish that initial 401
from post-login 401 (zero observed in this diagnostic), without filtering
console errors. Three module-list 403s were captured before close; no
uncaptured response or viewer dataset success is inferred. Its old
`home=PASS` field means only the then-current controller predicate, not
loader-free UI acceptance. Raw receipts were not rewritten.

## Test Corrections

Several initial failures were harness defects, not product failures:
native Get metadata uses `name`, Element Plus consumes menu `index`, and the
Save action uses its predefined runtime ID. The normal module list also
omits a client `pssystemid`: the backend binds the authorized parent root.
The M03-only native POST validation now preserves that actual body without
inventing a filter and requires exactly the own physical module ID, name,
tag, logical system ID and physical system name. Other dataset lanes retain
their explicit-filter requirement.

None of these corrections removes the browser error gate, alters JWT expiry,
injects identity/headers/controllers, force-clicks UI, bypasses a denied role
or resets model versions/audit with SQL.

Independent review also found two M03 failure-path risks: an uncertain
committed PUT could be labeled NOT-NEEDED if its following snapshot failed,
and late teardown errors could arrive after the acceptance decision.
The source now durably journals possible dispatch before forwarding,
retains uncertain fixtures without automatic recovery, and decides bounded
acceptance only after browser closure and evidence draining. Controlled
fault-injection tests cover those paths; the earlier failed live receipts
remain the actual runtime evidence, not a live replay of the revised tool.

Keyed GET forwarding now additionally requires an exact fixture record key.
Published non-READ GET actions such as `PSModule.GetDraft` cannot be mistaken
for record IDs. This tightens all owned browser policies; no arbitrary GET
or suffix-only fetch rule remains in the six-case diagnostic runner.

## Resource Closeout

Later verification and a shared-bind correction are documented in
[Remaining Verification](REMAINING-VERIFICATION-20261115.md). The cleanup
counts below describe the preceding campaign. The later model-source
candidate was briefly placed on a live bind and then restored; do not
interpret "no replacement" as proof that mounted bytes never changed.

The final SELECT-only comparison matched the complete last-restored UI
snapshot: 848 tables / 30,660 physical columns unchanged. Both frontend
containers and bridge processes, eight backend containers, the private
network and exactly three unreferenced run-built images were retired.
Final aibiz inventory: 12 shared running services, 18 tags / 18 image IDs,
zero owned or historical containers. Shared IDs, images, start times,
restart counts and inspected configuration/network identities match the
campaign baseline. The observed image lock also passed.

This is not a claim that all host bind-mounted source bytes stayed unchanged
or that the candidate was deployed. No shared restart/replacement, shared
SQL migration, persistent-volume deletion or global prune was performed.

## Execution Order

The later source-only bootstrap step and its precise remaining gates are in
[Model Context Bootstrap](MODEL-CONTEXT-BOOTSTRAP-20261115.md). It does not
replace the failed native HTTP evidence or authorize a shared rollout.

1. Resolve R01/R02 together with a source-backed role/projection contract.
2. Review R05 routes/effects before forwarding them; handle R03/R04 through
   normal declared capabilities and authentication flow.
3. Finish all M03/M04 language/viewport/role combinations on one owned stack.
4. Execute native Unicode migration/restore/API acceptance on owned clones.
5. Complete remaining PLM/manual/plugin, offline/source-closure and external
   integration gates from the canonical matrix.
6. Only then promote a candidate through shared backup, rollout and rollback
   acceptance. Git push is not deployment acceptance.
