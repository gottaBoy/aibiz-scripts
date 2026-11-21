# Owned Closeout Batches

Date: 2026-11-22 (Asia/Singapore)

This is a read-only closeout plan for the 25 parent items. It does not mark
any row complete and does not replace the canonical matrix.

## Immediate Batches

| Batch | Scope | Existing safe evidence | Required fresh evidence | Hard blocker |
| --- | --- | --- | --- | --- |
| M01 | Central member list, selection, cross-center isolation | The exact historical READ path is `POST /api/ibizmodeling__central/psdevslns/fetchcurdcslnuser`. The complete member-bound candidate and staging contracts are implemented, but the old route receipt uses retired `config-r6` inputs. | One fresh owned deployment with `--central-member-receipt <full member-session-binding/receipt.json>`, staged backend model, matching frontend, ordinary editor/viewer/no-access/anonymous requests, two centers, nonempty response, selection/navigation, and physical no-side-effect snapshots. | No current safe runner accepts a fresh deployment/runtime JSON and performs this member matrix. `owned-modeling-bootstrap.browser.mjs` is a ModelDesign shell/bootstrap runner, not M01 Central member acceptance. `owned-central-route-diagnostic.mjs` is historical and hardcodes retired config-r6 paths. |
| M02 | Five model-design entities plus PSPF/PSPFStyle/PSAppType and PSSysApp | `seed-owned-editor-registry-native.mjs` and `probe-owned-editor-registry-http.mjs` contain source-bound native contracts. Four-entity read plans are bounded; config reads were authenticated `200 []`. | Fresh native config rows fetched or created by a reviewed privileged actor, coherent platform/style/app-type triple, native PSSysApp create, all five entities, read/write/readback, cleanup, and full physical snapshots. | Default fixture has no PSPF, PSPFStyle or PSAppType rows. `prepare-run-owned-native-nonadmin-fixture.mjs` creates identity/root/grant/module/system sentinels only. Ordinary six fixture users are `adminmode=0`; no legal config-create actor is present. |
| M03/M04 | Native CRUD, fresh-session readback, role matrix | Existing source contracts and read-only/browser probes only. | Fresh editor/viewer/no-access/cross-root create/update/delete, reload and new-session readback with exact before/after physical snapshots. | Requires a fresh owned backend plus nonempty configuration and a dedicated role runner; browser shell/read-only results are insufficient. |

## All 25 Parent Items

This grouping inherits the 2026-11-21 checkpoint; it is not a new
acceptance result.

| Batch | IDs | Count | Closure evidence | External condition |
| --- | --- | ---: | --- | --- |
| Owned native prerequisites | F06, M01, M02, M03, M04 | 5 | Nonempty configuration/entity workflows, fresh-session persistence, role results and cleanup. | Real authorized configuration/admin actors; M01 runner and M02 rows below. |
| Root/token/session security | A01, A02, A03, A04 | 4 | Typed/null request fidelity, token exchange/revocation, multi-node cache revision and nested transaction lifecycle. | A02 revision protocol and A03 nested transaction semantics need security/transaction decisions. |
| Business and IDE | B01, B02, B03, B04 | 4 | Manual lifecycle/roles, 73-plugin persistence cases, real Development/API execution, PLM-host IDE CRUD and R05 counters. | Real integration apps/recipients and MQTT/WebSocket/ACL environment. |
| Languages/reference | L01, L02, L03 | 3 | Candidate classification, full language gates, authenticated business/plugin/error/export cases, DTO source/mapper closure. | Missing authoritative DTO source remains a source dependency. |
| Provenance | D01, D02, D03 | 3 | Recursive source/dependency/build closure, transitive/served assets and effective runtime inputs. | Reproducible source/dependency inputs and reviewed shared deployment. |
| Catalog/offline marketplace | K01, K02, K03 | 3 | Catalog revision/license closure, blocked-network install/update/recovery/rollback. | Approved local package archive and disposable fault-injection environment. |
| Rebuild/release | O01, O02, O03 | 3 | Clean-host rebuild, whole-stack restore/migration recovery and reviewed rollout/rollback. | Recovery plan, offline toolchain/cache and explicit shared-change scope. |
| Total | All 25 exactly once | 25 | No row closes from this plan. | Current statuses remain open/partial/blocked. |

## M01 Runner Contract

The fresh run must provide:

```text
RUN_ID
DEPLOYMENT_INPUT=.artifacts/native-nonadmin-fixtures/$RUN_ID/backend-runtime-<label>/deployment-input.private.json
CENTRAL_MEMBER_RECEIPT=.artifacts/native-service-migration/<fresh-member-candidate>/receipt.json
LAUNCH_INPUT / LAUNCH_SHA256 / STATE_SHA256
EDITOR_A / VIEWER_A / NO_ACCESS_A / EDITOR_B / VIEWER_B / NO_ACCESS_B
ROOT_A / ROOT_B
```

The following existing browser command is a separate ModelDesign bootstrap
check, not a Central member-list command:

```sh
node modelingweb/app/tests/owned-modeling-bootstrap.browser.mjs \
  --run-readonly-browser \
  --launch="$LAUNCH_INPUT" --launch-sha256="$LAUNCH_SHA256" \
  --state-sha256="$STATE_SHA256" \
  --deployment="$DEPLOYMENT_INPUT" --deployment-sha256="$DEPLOYMENT_SHA256" \
  --run-id="$RUN_ID" --actor="$EDITOR_A" --root-side=a \
  --output=.artifacts/owned-modeling-bootstrap-browser/m01-a-20261122
```

This command proves only the ModelDesign bootstrap/shell flow. It must not be
relabeled as M01.

The route candidate must remain exact:

```text
POST /api/ibizmodeling__central/psdevslns/fetchcurdcslnuser
```

No wildcard route, GET alias, injected person/root header, synthetic response,
or ordinary-member Create route is acceptable.

### Existing Entry Points And Runner Gap

Recompute the complete member candidate without starting a service:

```sh
node scripts/prepare-native-service-candidate.mjs --member-binding \
  --output .artifacts/native-service-migration/member-20261122-NEW
node scripts/prepare-native-service-candidate.mjs --verify-receipt \
  .artifacts/native-service-migration/member-20261122-NEW/receipt.json
```

The owned backend launcher consumes that exact receipt through
`--central-member-receipt PATH`, and the matching Central GridView must also
be delivered. A view-only candidate is insufficient.

There is currently no safe executable M01 member HTTP CLI that accepts a fresh
deployment/runtime JSON and performs the full matrix. `ownedNativeRuntimeContext`
is a guard API, not a member runner. `native-modeldesign.browser.mjs` uses the
historical native-modeling Compose lane/default identity and has fixed
field-write targets outside probe-only mode; `native-central-trace.mjs` and
`debug-central-route.mjs` are diagnostics, not owned acceptance runners.

The missing runner must bind `RUN_ID`, deployment/input hashes, six actual
fixture identities and both roots; use normal login/appdata/employee identity;
issue only the exact POST above; assert nonempty IDs, pagination, own/foreign
center isolation, no-access/anonymous denials, and before/after full physical
snapshots. It must journal redacted request summaries and expire/logout each
session. Identity must never be supplied by request body or injected headers.

## M02 Source Facts

Read-only source audits establish:

- `PSPF`, `PSPFStyle`, and `PSAppType` have real model/query contracts and
  `POST /fetchdefault`, `CREATE`, and `DELETE` methods.
- The owned fixture generator does not emit rows for these tables.
- `scripts/audit-owned-modeling-config-sources.mjs` reports
  `blocked-no-owned-config-rows` for fixture `25dd6a7232c7`.
- `modelingservice/sql/init.sql` contains historical examples but is shared
  development SQL, not an owned source-bound receipt and must not be copied.
- A fresh text-only check also finds explicit LOCK/INSERT sections for all
  three target tables in `modelingservice/sql/sCloud9471c1eca.sql`. The older
  audit tool does not inspect that dump for row eligibility. Existing contract
  readers use its CREATE TABLE definitions, not its historical rows. No row
  values were extracted, imported or established as a legal coherent triple
  in this review. Thus "no other approved row receipt" must not be restated
  as "no other local SQL contains configuration data".
- Source model files, schema plans, and query SQL define structure only; they
  are not persisted configuration rows.
- No other approved source-bound configuration-row artifact was found in the
  maintained paths. A newly supplied archive still needs ownership,
  version/license and native import/create review.

The minimum coherent observed triple is:

```text
PSPF.validflag = 1
PSPF.psapptypeid == PSAppType.psapptypeid
PSAppType.psapptypename is nonempty
PSPFStyle.pspfid == PSPF.pspfid
PSPFStyle.psdevcenterid == actor center OR NULL
```

PSSysApp create remains blocked until these are actual fetched/native-returned
IDs. `$OBSERVED_*` placeholders are plan markers only and must never be sent.

### Existing M02 Commands And Conditions

The initializer and probe are executable references only; they were not run
by this document:

```sh
node scripts/seed-owned-editor-registry-native.mjs \
  --execute-owned --run-id="$RUN_ID" \
  --deployment-input="$DEPLOYMENT_INPUT" --label=registry-20261122-NEW
node scripts/probe-owned-editor-registry-http.mjs \
  --execute-owned-editor-registry --run-id="$RUN_ID" \
  --deployment-input="$DEPLOYMENT_INPUT" --seed-receipt="$SEED_RECEIPT" \
  --seed-receipt-sha256="$SEED_SHA256" --label=registry-read-20261122-NEW
```

The initializer fetches configuration but does not create PSPF/PSPFStyle/
PSAppType rows. Without a coherent observed triple it can only emit the
four-entity partial seed; the probe rejects that by default. `--allow-partial`
is explicitly a 48-cell four-entity read result, not five-entity acceptance.
The six default fixture users are non-admin. There is also a stronger native
operation gate: `PSModels.java` registers the three entities as configuration,
and `PSConfigDEAccessManager` permits only record `READ`. Its ordinary
CREATE/DELETE API path does not become authorized merely by adding an admin.
A legitimate maintenance/import path and its policy must be identified before
any row creation; do not change generic READ or bypass the manager to seed data.

Current source contract paths are:

```text
POST /api/ibizmodeling__modeldesign/pspfs/fetchdefault
POST /api/ibizmodeling__modeldesign/pspfstyles/fetchdefault
POST /api/ibizmodeling__modeldesign/psapptypes/fetchdefault
```

Older planner prose contains root-nested variants; do not invent a fallback.
Use the exact current route artifact and emitted source-bound contract.

## Safe Read-Only Checks

These commands do not start services or mutate data:

```sh
node scripts/audit-owned-modeling-config-sources.mjs --run-id=6189aef47735
node --test scripts/tests/audit-owned-modeling-config-sources.test.mjs \
  scripts/tests/plan-owned-modeling-config-seed.test.mjs
node --test modelingweb/app/tests/owned-central-route-diagnostic.test.mjs \
  scripts/tests/central-member-route.test.mjs
```

The first command is source/artifact evidence only. It does not prove that a
fresh deployment has the same rows. The route tests are controlled contract
tests, not live HTTP.

## Closeout Order

1. Build one current owned backend and bind its deployment/image/source
   receipts.
2. For M01, stage the full member candidate and create a dedicated Central
   read-only runner before browser navigation.
3. For M02, establish a reviewed configuration source and real authorized
   maintenance/import path; ordinary config CREATE is currently READ-only
   manager denied. Do not bypass that gate with SQL or historical init rows.
4. Re-run nonempty entity reads, role isolation, CRUD, fresh-session
   readback and cleanup with physical snapshots.
5. Only after these receipts are current should M03/M04 and dependent
   localization/release rows be reconsidered.

No item is closed by this document. Pages loading, `200 []`, source model
presence, route metadata, or controlled tests are not business acceptance.

## Source References

- `docs/ALL-TASKS-20261111.md`
- `docs/MULTIAGENT-PROGRESS-20261121.md`
- `docs/MODELING-CENTRAL-CREATE-20261114.md`
- `docs/MODELING-CONFIG-SOURCE-AUDIT-20261112.md`
- `scripts/owned-modeling-application-routes.mjs`
- `scripts/prepare-native-service-candidate.mjs`
- `scripts/seed-owned-editor-registry-native.mjs`
- `scripts/probe-owned-editor-registry-http.mjs`
- `scripts/audit-owned-modeling-config-sources.mjs`
