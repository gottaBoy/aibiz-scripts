# Current Runtime Blockers

Checkpoint: 2026-11-15, Asia/Singapore. Campaign receipts retain their
20261114 names. The canonical matrix remains **25 top-level items not fully
accepted**. This table distinguishes real runtime failures, controlled
observations and unexecuted prerequisites.

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
| R01 | Three ModelDesign views force the template `PSSYSTEM` UUID instead of inheriting the selected model's logical context | Actual own-root UI requests used the template UUID and returned 403; source assignment/override chain confirmed | Define a normal authorized logical-system bootstrap and remove the three constant overrides, with root-switch/race protection |
| R02 | Root editor grants do not automatically grant generic `PSSYSTEM.READ` | A separate normal-authentication own-root `FetchDefault` probe also returned 403; full before/after hashes matched | Review native runtime registration, roles, safe projection and default-page contract; do not assign admin or broaden READ to make a probe green |
| R03 | Optional extension manifest is requested but absent | Actual `/remotemodel/ext/package.json` returned 404 before and after login | Establish declared availability/discovery behavior; do not synthesize an empty success response |
| R04 | Expected anonymous authentication denial is logged as a browser error/navigation abort | Actual pre-login GET 401 and navigation-guard console error, distinct from post-login failures | Correct normal login redirect/error classification in the product; do not string-filter errors in tests |
| R05 | Portal history, dynamic dashboard and overview-statistic calls have not passed a reviewed request/effect contract | The harness blocked `portal/markopendata`, `dynadashboards` and `modelobservations/sysoverviewcnt` before dispatch | Review published methods, authorization and read/write effects, then implement precise opt-in, snapshots and cleanup; a locally blocked request is not a backend HTTP failure |
| R06 | Native source schemas have mixed three-byte/four-byte UTF-8 collations | Read-only owned inventory: each physical model schema has 397 `utf8_general_ci` and 27 `utf8mb4_general_ci` tables; metadata has 90/8, standalone UAA has 18 mb4 | Per-column/index audit, source migration, backup/clone restore, idempotence and actual API special-character roundtrips; PLM's prior migration does not prove native schemas fixed |
| R07 | Two desktop editor combinations are not the eight editor or full 48-role browser matrix | Real A/Chinese and B/English roundtrips only; mobile, remaining editors and negative UI writes remain separate | Complete responsive navigation, all role/root/language/viewport flows, persistence, rejected-write effects and cleanup |
| R08 | External integration and release prerequisites remain distinct | No new controlled enterprise application credentials, real third-party delivery, MQTT end-to-end or shared-stack rollout/rollback evidence | Supply/review real inputs, validate scoped credentials/ACL/delivery/recovery, then controlled release with backup and rollback |
| R09 | English native editor is still mixed-language | Real English UI has System Overview but Chinese overview/form labels and Save action; screenshot also contains the Network Error toast and denied dashboard | Localize the authoritative view/control/form/code-list texts and verify errors, refresh, deep links and mobile layouts; do not translate persistent IDs |
| R10 | A mounted root controller does not prove that the global loader has disappeared | All six M04 diagnostics recorded matching runtime roots; the Chinese mobile screenshot still contains the blue loading overlay | Require overlay evidence and a stable loader-free interval before recording visible readiness; the new source gate has controlled tests but no fresh live replay yet |

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

1. Resolve R01/R02 together with a source-backed role/projection contract.
2. Review R05 routes/effects before forwarding them; handle R03/R04 through
   normal declared capabilities and authentication flow.
3. Finish all M03/M04 language/viewport/role combinations on one owned stack.
4. Execute native Unicode migration/restore/API acceptance on owned clones.
5. Complete remaining PLM/manual/plugin, offline/source-closure and external
   integration gates from the canonical matrix.
6. Only then promote a candidate through shared backup, rollout and rollback
   acceptance. Git push is not deployment acceptance.
