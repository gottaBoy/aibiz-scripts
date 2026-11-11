# Remaining Implementation And Acceptance

Checkpoint: 2026-11-08, Asia/Singapore.
Updated: 2026-11-11, Asia/Singapore.

Scope: complete local development, Chinese/English operation, multi-role
workflows, source builds and offline delivery. Baseline:
`MULTIAGENT-PROGRESS-20261108.md`, with 4746 passing scripts tests.
Current full regression: **4999/4999**, zero skipped and stable source,
`.artifacts/current-source-regression-20261111-r3/report.json`.
This includes the November 10 IDE source edits, five-entity registry repair,
owned validation tools and the bridge exit-race fix.
See `MODELING-IDE-ENHANCEMENT-20261110.md` for the editor scope and limits.

There are **8 work groups and 30 executable items** in this checkpoint.
These are engineering tasks, not 30 absent product features. Existing source,
implementation, isolated acceptance and shared deployment remain distinct.
The 12-component, 73-plugin and 23-catalog inventories are not added to this
task count. No overall percentage is inferred.

Status: `OPEN` needs implementation and/or further evidence; `PARTIAL` has
existing implementation/evidence; `ACTIVE` is being implemented this round.
An item becomes `VERIFIED` only with a bound passing runtime receipt.
Current count: **5 VERIFIED, 25 not fully verified**. Partial implementations
and scoped tests below do not close their larger acceptance criteria.
Detailed execution ordering is in `REMAINING-PLAN-20261109.md`.

## A. Runtime And Home

| ID | Item | Status | Exit |
| --- | --- | --- | --- |
| F01 | Backend invalid-refresh status and credential redaction | VERIFIED | `backend-refresh-regression-20261109-r2`: 19 real JVM tests for status classification/redaction; fresh `96ff5681e447/platform-http-core-config-six-r1`: actual refresh and invalid-refresh client denial |
| F02 | Real operator directory in fresh account fixtures | VERIFIED | Fresh `96ff5681e447/operator-dictionary-sysoperator-r3`: 43 HTTP checks; six users receive exactly their organization's three source-backed USERID/name entries, repeated tenant reads and anonymous 401; source model USERCODE/EMPLOYEE_NUMBER is distinct from this native HTTP dictionary |
| F03 | EBSX real system and tenant directory | VERIFIED | `5d3585516a77/ebsx-directory-directory-r1/report.json` and fresh `96ff5681e447/ebsx-directory-core-directory-r1/report.json`: source-bound 5-row JDBC transaction, full-column readback, unchanged UAA sources and backend peers |
| F04 | Normal browser organization bootstrap | VERIFIED | `owned-native-modeldesign-browser/organization-20261109-r1/report.private.json`: six ordinary actors times two apps, normal UI login, real organization API/appdata identities and naturally generated headers match source-bound users; Chinese/English and desktop/mobile samples, no injected identity/header |
| F05 | Real extension notification deployment and routing | VERIFIED | Fresh `96ff5681e447/internal-message-http-notification-security-r3`: 120 actual foreign-key 403 denials, 84 owner checks, mark_all_read isolation, native DELETE and zero-row baseline restoration; composer/background delivery remain separate |
| F06 | Configuration persistence and isolation | PARTIAL | Fresh `96ff5681e447/platform-http-core-config-six-r1`: 278 checks passed including six-user personal save/update/fresh-login, all five other-user/cross-tenant reads and native cleanup; global configuration authorization remains separate and unverified |

## B. Native Modeling

| ID | Item | Status | Exit |
| --- | --- | --- | --- |
| M01 | Central home, center selection and navigation | ACTIVE | New bound GridView is now mounted and native published FETCH is actually requested. Both-language home/reload pass; dataset returns 404 because owned routing exposes only ModelDesign root routes. Before publishing Central query, bind current-member identity and verify row isolation: original EXISTS checks any member |
| M02 | ModelDesign home and list/detail | ACTIVE | Five missing model-instance registrations are repaired and source-built. November 11 owned runtime verifies four nonempty datasets: six actors/both roots, 48 cells with 16 allowed and 32 actual403, all 848-table physical snapshots unchanged. App config routes still404; full five-entity matrix and real browser navigation remain open. See MODELDESIGN-REGISTRY-20261111.md |
| M03 | Editor operations and persistence | ACTIVE | November 10 candidate adds history/format/diff/JSON validation/download, dirty-dismissal protection, preflight conflict detection and post-import readback, with bilingual responsive UI. Strict reproducible build and controlled UI pass; real role-bound editor/native save and all 11 action workflows remain unverified |
| M04 | Multi-role browser permissions | OPEN | Editor/viewer/no-access, both roots, desktop/mobile, allowed and denied actions with persistence witnesses |

## C. Authorization

| ID | Item | Status | Exit |
| --- | --- | --- | --- |
| A01 | Malformed, typed and missing root context | PARTIAL | Proven native context transport; denial and unchanged data; no invented headers |
| A02 | Same-token cache/grant revocation | PARTIAL | Revocation/expiry takes effect for existing sessions; distinct-token 200-check matrix is already verified |
| A03 | Nested session and holder lifecycle | OPEN | Instrumented push/pop/error/cleanup observations without cross-user context leakage |
| A04 | Service OAuth, aliases and startup stabilization | PARTIAL | Real service credentials, all required alias paths and absence of delayed startup failures |

## D. PLM And Plugins

| ID | Item | Status | Exit |
| --- | --- | --- | --- |
| B01 | Business role lifecycle matrix | PARTIAL | Product/project/test/knowledge/resource/workload/ideas/sprints/baselines/reports/settings workflows, not only navigation |
| B02 | 73-plugin desktop/mobile modes | PARTIAL | Current per-plugin actions, success/empty/error, permission and persistence evidence |
| B03 | Development and API Reference execution | PARTIAL | Actual endpoint browsing/search/execution and permissions; route/layout checks are already available |
| B04 | PLM-route Data Model and Modeling IDE | PARTIAL | Actual model CRUD and IDE operations through the PLM entry |

## E. Chinese And English

| ID | Item | Status | Exit |
| --- | --- | --- | --- |
| L01 | Current visible-label classification | PARTIAL | Reaudit and classify the historical 3418 unmapped model-label candidates |
| L02 | Visible UI/plugin/error localization | PARTIAL | Applicable visible labels and errors verified in both languages through workflows |
| L03 | API documentation body localization | OPEN | Local, repeatably built Chinese/English content, not only translated navigation |

## F. Source And Development

| ID | Item | Status | Exit |
| --- | --- | --- | --- |
| D01 | Twelve-component source/dependency/build closure | PARTIAL | Independent source, dependency, compiler, image and runtime evidence for every required component |
| D02 | Source/image/served-byte provenance | PARTIAL | Current immutable bindings, remaining provenance gaps and repeatable generated documentation |
| D03 | Cross-repository development/version management | PARTIAL | Revision manifest, UAA/runtime version handling and generated-code preservation |

## G. Marketplace

| ID | Item | Status | Exit |
| --- | --- | --- | --- |
| K01 | 23-catalog source/revision/license closure | PARTIAL | Current inventory and actual source/license/artifact bindings; resolve missing checkouts without assuming source is absent |
| K02 | Local catalog/assets and offline installation | PARTIAL | No-network catalog, assets and isolated application installation |
| K03 | Offline update and rollback | OPEN | Versioned update, failure recovery and rollback under blocked external network |

## H. Operations And Release

| ID | Item | Status | Exit |
| --- | --- | --- | --- |
| O01 | Clean offline reconstruction | OPEN | Clean-host/toolchain reproduction of the complete stack |
| O02 | Durable backup, migration and whole-stack rollback | PARTIAL | Durable-storage end-to-end recovery; earlier isolated MySQL recovery remains valid scoped evidence |
| O03 | Reviewed shared deployment | OPEN | Explicit rollout/rollback, served-byte verification and multi-role regression before promoting to port 30250 |

## Current Execution

1. All five F01-F05 bounded runtime/bootstrap gates are verified on the fresh source-built fixture. Their explicit limits do not close global authorization, messaging delivery or editor behavior.
2. Personal F06 six-user coverage is verified; global configuration remains open. Five model-instance registrations are fixed with scoped runtime evidence for four; resolve App configuration publication and complete the fifth. Central route plus trusted-member filtering remains separate.
3. Fresh frontend and runtime assets are built. The November 11 browser replay still finds a system-bootstrap401 and pointer interception at the System menu, so M01/M02 and M03/M04 remain open; real PLM todo service and collaborative transport are separate from an unavailable-state pass.
4. Close F/G/H delivery requirements; deploy shared services only after review.

All historical failed receipts remain unchanged. This list is not a claim
that all 30 items can be closed by the current scripts unit-test total.
