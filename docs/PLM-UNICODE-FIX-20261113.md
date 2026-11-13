# PLM Four-Byte Unicode Repair

Date: 2026-11-13, Asia/Singapore.

## Observed Failure

The live PLM provider rejected a page-comment insert with MySQL error 1366,
`Incorrect string value`, for `COMMENT.CONTENT`. The failing bytes represented
U+1F44D. The SQL used bound parameters; this failure was not apostrophe
concatenation or a frontend character filter.

The live MySQL version was 5.7.41. All 20 PLM application sessions already
used `utf8mb4` for client/connection encoding. The `plm` database and 1391
character columns still used three-byte `utf8`.

## Applied Repair

Only the PLM business schema was migrated:

- 129 business tables retained.
- 1391 `utf8` character columns changed to matching `utf8mb4` collations.
- Remaining `utf8` character columns in `plm`: zero.
- Database/table defaults updated so future inherited columns use four-byte
  Unicode.
- Column types, nullability, defaults, comments, indexes, engines and row
  formats verified unchanged apart from the intended charset/collation.
- Existing explicit `utf8mb4_unicode_ci` columns preserved.
- No service restart, image rebuild, new container or global server setting.
- Other schemas, including `ibizapi` and unrelated `alldata`, unchanged.

The editable MySQL dialect creates tables without forcing a charset, so new
tables inherit the repaired database default. Fresh initialization now creates
`plm` with `utf8mb4_general_ci`.

Source changes:

`plm/deploy/compose/init.sql`

`plm/deploy/compose/migrations/011_plm_utf8mb4.sql`

PLM source revision: `mydev` commit `9d98c3c49`.
Migration SHA-256:
`0289e5b094f83da5cef79201e85a6ec7e958bd9e33e56ba00ac6b84ba0cdb16d`

The migration reconstructs only old `utf8` character-column definitions from
database metadata. It uses `COLUMN_TYPE` instead of table-wide `CONVERT TO`,
avoiding implicit TEXT/MEDIUMTEXT widening. It quotes metadata defaults and
comments, preserves each collation family and rejects unsupported generated
columns, foreign-key dependencies and incompatible SQL modes before DDL.

MySQL 5.7 does not accept the initially tested prepared `ALTER DATABASE`
statement. This was caught in disposable clone tests before live migration;
the final migration uses a direct current-database statement and prepares only
table alterations.

## Backup And Verification

Before applying live DDL, the full PLM backup was restored into a private
temporary schema on the existing MySQL service. No validation containers were
started. The actual migration ran against all restored business tables plus
an owned edge-case table.

The clone verified:

- The old schema rejects four-byte input, reproducing the original failure.
- Complete row-data dumps hash identically before/after conversion.
- Column sizes/types, defaults containing apostrophes, comments containing
  backslashes, nullability and all indexes are preserved.
- Pre-existing mb4 Unicode collation and binary bytes remain unchanged.
- A second migration is idempotent.
- Chinese, U+1F44D, U+2000B, combining accents, apostrophes, backslashes,
  quotes, HTML-like content and newlines round-trip without substitution.

All temporary probe databases and the helper stored procedure were removed.

The live migration completed at **2026-11-13 22:53:54 +08:00**.
Live row-data dumps were both 5,372,215 bytes with SHA-256:

`09d31e3e4c242d1adc63053f597f67955e3b65769b6f10a58d6958379e3483f1`

The original full backup was 5,562,711 bytes with SHA-256:

`1de500f24af4ba7e81eedae93adb7ac06e620e263101842003e3b1da2622fba1`

Private backup/probe/live receipts:

`.artifacts/plm-utf8mb4-20261113-r1/attempt-3/`

These files contain business data and are not committed.

## Live API Regression

At **23:03:31 +08:00**, the configured regression account used the same
page-scoped comment route as the reported failure. The page belonged to that
account and had no other direct subscribers. A uniquely marked test comment
containing supplementary Unicode, apostrophes, backslashes, quotes and a
newline was created, read back byte-for-byte, and deleted.

Login, create, read and delete each returned HTTP 200. SQL verification found
the submitted UTF-8 bytes unchanged and confirmed the owned test ID absent
after cleanup. Tokens/passwords were not recorded in the receipt.

Private receipt:

`.artifacts/plm-utf8mb4-20261113-r1/http-report-2.private.json`

An initial unscoped `/comments` probe returned 404 and wrote no comment. This
was not reclassified as success; the accepted run uses the real nested route.

Focused source contracts: `tests/plm-utf8mb4-migration.test.mjs`, 4/4 passed.
Combined with the existing image-lock/retention checks, 17/17 passed.

## Operational Boundaries

Back up before applying the migration. MySQL DDL is not transactionally
rolled back by this tool. Do not restore the whole backup over legitimate
user writes made after the snapshot. If foreign-key/generated-column
dependencies are introduced later, create a new reviewed plan.

This repair covers `plm`, not a blanket server/database conversion.
`ibizapi` and platform/modeling schemas still require separate charset audits.
Current PLM connections needed no URL change or pool restart.

MQTT live output remains a separate issue: the native Modeling deployment
explicitly sets `ENABLEMQTT: "false"`. Removing its visible disabled warning
or enabling a switch alone would not verify authenticated broker/WebSocket
transport, subscriptions or backend log publication. Third-party integration
behavior and the supplied official manual reference also remain separate
acceptance work; neither is closed by this database fix.
