# Native Unicode Execution Gates

Checkpoint: 2026-11-17, America/New_York. R06 source-contract review and
execution checklist only. **No SQL, backup/restore, migration, Docker or
business API operation was executed for this update.**

## Requirements And Observations

- Workspace requirement: Chinese, supplementary-plane characters, combining
  characters, quotes, backslashes and newlines must round-trip through real
  authenticated native APIs without replacement, normalization or filtering.
- Existing PLM evidence: `PLM-UNICODE-FIX-20261113.md` records a migration of
  the `plm` business schema and an actual page-scoped comment regression.
  Its backup, schema counts and API result do not cover native metadata,
  UAA, model A/B or later schema/source versions.
- Native source: `collect-owned-native-unicode-metadata.mjs` is an explicit
  owned-environment SELECT-only collector; `owned-native-unicode-plan.mjs`
  is a pure planner with no execution mode. The collector's two equal reads
  are not a DDL freeze, business-write quiescence or backup.
- Historical native observation: `NATIVE-UNICODE-PLAN-20261115.md` records
  964 tables, 33,911 columns and 31 wide-row blockers from one exact owned
  inventory. That receipt does not establish that the environment is still
  live or that a new inventory has identical counts.
- Current acceptance: no native migration, restored-clone execution,
  idempotence or native Unicode API acceptance is claimed here. R06 stays
  open.

## Scope And Stop Rules

Use one explicitly approved owned stack. All schema identities must come
from its current manifest, never a shared schema name or prefix wildcard.
The existing collector targets exactly UAA, metadata and model A/B. Extra
Workflow/EBSX/Platform and wildcard-probe schemas have presence-only
permissions when the exact receipt chain passes; that does not permit
converting or reading their business tables.

Before collecting, compare the intended source/build/image/mount identity
with the current owned runtime. Missing/stale manifests, drifted generator
hashes, unexpected peers, missing schema/count metadata, unsupported server
profiles or any planner blocker stop the execution chain. Preserve every
failed attempt in a new private directory.

Do not:

- Reuse PLM's migration SQL or success flags as a native migration.
- Run table-wide `CONVERT TO CHARACTER SET`, automatically widen TEXT,
  shorten unique keys to 191 characters or switch row format to get green.
- Select a VARCHAR-to-TEXT redesign merely because its default is NULL and
  it is unindexed. Source length, defaults and all native writes still need
  an enforced contract.
- Treat a second no-change plan as proof of idempotence.
- Run migration on running shared schemas or restore a full old dump over
  legitimate later user writes.

## Execution Checklist

The following are ordered review gates, **not runnable DDL or authorization
to execute migration**. Root must separately approve the exact stack,
resource limits, source redesign, recovery plan and operation window.

| Step | Required Evidence | Fail-Closed Condition |
| --- | --- | --- |
| 1. Fresh inventory | Exact run/manifest/source/image/mount hashes; collector's fixed SELECT batch, independent counts and two complete equal observations | Any field/count/identity/dependency drift; unknown charset/collation/server profile |
| 2. Quiescence | A defined maintenance interval and proof no application/DDL writer can change the selected source during backup/comparison | Double-read metadata alone, running clients with unknown writes or no writer-control plan |
| 3. Full backup | Private backup SHA-256/size, command/tool/server identity, complete table/object inventory, original grants and schema metadata; backup completed without ignored errors | Data-only or partial dump, missing object/permission evidence, unbound target or untested restore |
| 4. Clone restore | Separate exact owned clone identities; successful restore under the same reviewed server/profile; full data/schema/object/grant comparison before conversion | Restore over the source/shared schema, different engine/profile, missing tables/rows/columns or changed grants |
| 5. Risk resolution | Reviewed per-column source/model/dump/dialect mapping; exact lengths/types/defaults/NULL/comments; every index part/prefix/uniqueness/ordering; dependency and wide-row decisions | Any unresolved planner block, guessed source mapping, hidden type/length/default/index change |
| 6. Clone DDL | Exact approved plan hash, durable per-statement intent/result journal, strict-mode failure observation and defined recovery | Arbitrary SQL input, unjournaled operation, continuing after partial DDL failure or claiming transactional DDL rollback |
| 7. Preservation | Complete old/new data comparison and metadata diff restricted to the approved charset/collation or separately approved source redesign | Changed data, binary bytes, keys, lengths, defaults, NULL, comments, engines, row formats or grants outside the approved delta |
| 8. Unique-key behavior | Exact original unique index parts/prefixes; clone conflict/duplicate cases under target collation; expected distinctness explicitly reviewed | Silent duplicate merging, index truncation, dropped uniqueness or unsupported composite budget |
| 9. Second pass | Fresh metadata after first clone migration; run the same approved migration again on the clone; record outcome plus identical complete data/schema | Only inspect an empty proposal, missing actual second execution or unexpected second-pass change |
| 10. API chain | Normal authentication and real source-published paths; create/read/update/fresh-login readback/delete; exact returned and physical bytes | Empty 200, client refusal called a backend denial, invented paths/headers, forced controller state or SQL-seeded API result |
| 11. Negative roles | Read-only, no-access, cross-root and malformed relationship attempts; actual expected HTTP; complete before/after snapshots | Permission widening, unexpected 2xx/5xx/route errors or any rejected-request model/version/audit delta |
| 12. Cleanup | Exact case-owned IDs removed by native APIs, fresh readback and full permitted-delta comparison; clone resources retired by identity | Broad delete/reset, leftover test records, blind SQL repair or unresolved recovery journal |

Database DDL is not assumed transactionally reversible. A partial clone
failure must retain its last successful statement, failed statement,
observed schema and recovery decision. It must not automatically run a
reverse charset conversion or repeat the batch over unknown state.

## Schema And Index Invariants

Capture every physical character column, even if no currently visible UI
uses it. Preserve explicit existing mb4 collations and all binary/numeric
fields. Compare metadata with a structured parser, not a textual
search/replace over a dump.

For each changed field retain:

1. Schema/table/column identity and authoritative source location.
2. `COLUMN_TYPE`, character/byte capacities, default kind/value, nullability,
   comments, EXTRA and generation expression.
3. Old and intended charset/collation from the actual server catalog.
4. Every full/prefix/composite/unique index that includes it, with exact
   original prefix units and parts.
5. Actual server page size, row format, large-prefix/file-format/strict-mode
   profile and tested clone outcome.

The current planner conservatively blocks unknown index storage, legacy
composite limits, dependencies and provable logical-row overflow. It may
keep local `modifyClause` or safe-table proposals for private audit while
the top-level statement list is empty. Those fragments must never be
extracted to execute only the convenient portion of a blocked plan.

## Native API Unicode Corpus

Use source-published API fields whose real length/type and current role
permissions were reviewed. Start with self-owned records and valid native
relationships; a generic `/comments` 404 must not replace the correct
page-scoped route.

The byte-preservation corpus must include at least:

| Sample | Purpose |
| --- | --- |
| Chinese text | Ordinary multibyte content |
| U+1F44D and U+2000B | Supplementary-plane storage and serialization |
| `e` + U+0301 and precomposed U+00E9 | Distinct input sequences; no silent normalization |
| Apostrophe and double quote | Bound values and JSON escaping |
| Backslash followed by letters | No double decoding/escaping |
| LF, CRLF and tab where the field accepts them | Exact accepted control-character roundtrip |
| HTML-like text | Context-safe display without deleting stored content |
| Exact declared character limit and one over it | No silent truncation or undocumented length relaxation |

NUL and invalid surrogate sequences require an explicit API validation
decision. They must not be silently deleted/replaced to count as Unicode
success. Identifier restrictions are distinct from business text: the
planner may reject supplementary-plane database identifiers while still
preserving those characters in a permitted business field.

For every accepted sample compare submitted UTF-8 bytes with create/read,
update/read, fresh normal-login readback and independent physical
observation. Record IDs, versions, audit side effects, actual authentication
and source/build/mount bindings. A screenshot, JS string test or current
connection declared as mb4 alone is insufficient.

## Added Contract Tests

Two tests extend `tests/owned-native-unicode-plan.test.mjs`:

- Inventory-supplied `executionAllowed`/backup/restore/idempotence/API success
  flags and a forged success status cannot promote planner results; inputs
  remain unchanged.
- One unsafe table prevents the complete migration statement list, even
  when another table retains a valid private local proposal. Original
  unsafe type, full index and uniqueness remain intact.

The initial added assertions incorrectly expected audit fragments to be
null and used wording not present in the boundary message. Those were test
assumptions, not discovered product failures; they were corrected against
the existing explicit audit-only design. No production planner/collector
logic was weakened or modified.

Reproduce without database or Docker execution:

```sh
node --test scripts/tests/owned-native-unicode-plan.test.mjs \
  scripts/tests/collect-owned-native-unicode-metadata.test.mjs \
  scripts/tests/plm-utf8mb4-migration.test.mjs
```

The test fixtures use temporary private JSON and controlled executors.
Passing tests verify only these source contracts, never backup, restore,
migration or native API completion.

Result: **67 passed, 0 failed, 0 skipped**. `git diff --check` passed.
