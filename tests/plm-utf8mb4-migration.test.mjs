import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migration = readFileSync(new URL(
  '../../plm/deploy/compose/migrations/011_plm_utf8mb4.sql', import.meta.url), 'utf8');
const bootstrap = readFileSync(new URL('../../plm/deploy/compose/init.sql', import.meta.url), 'utf8');

test('PLM bootstrap defaults to four-byte Unicode without changing unrelated databases', () => {
  assert.match(bootstrap, /create database plm default character set utf8mb4 collate utf8mb4_general_ci;/);
  assert.match(bootstrap, /create database nacos_conf default character set utf8 collate utf8_general_ci;/);
  assert.match(bootstrap, /create database ibizapi default character set utf8 collate utf8_general_ci;/);
});

test('migration is scoped to the selected PLM database and has no global server setting', () => {
  assert.match(migration, /^-- Target database: plm/m);
  assert.match(migration, /t\.TABLE_SCHEMA = DATABASE\(\)/);
  assert.match(migration, /c\.TABLE_SCHEMA = v_schema AND c\.TABLE_NAME = v_table/);
  assert.doesNotMatch(migration, /\bSET\s+(?:@@)?GLOBAL\b|\bDROP\s+(?:TABLE|DATABASE)\b|\bTRUNCATE\b/i);
});

test('column reconstruction preserves sizes, nullability, defaults and comments', () => {
  assert.match(migration, /c\.COLUMN_TYPE/);
  assert.match(migration, /c\.IS_NULLABLE/);
  assert.match(migration, /QUOTE\(c\.COLUMN_DEFAULT\)/);
  assert.match(migration, /QUOTE\(c\.COLUMN_COMMENT\)/);
  assert.doesNotMatch(migration, /\bCONVERT\s+TO\s+CHARACTER\s+SET\b/i);
  assert.doesNotMatch(migration, /\bREPLACE\s*\(\s*(?:CONTENT|NAME)\b/i);
});

test('existing mb4 collation choices remain intact and unsupported dependencies fail before DDL', () => {
  assert.match(migration, /c\.CHARACTER_SET_NAME = 'utf8'/);
  assert.match(migration, /SUBSTRING\(c\.COLLATION_NAME, 5\)/);
  const ddl = migration.indexOf('ALTER DATABASE CHARACTER SET');
  for (const guard of ['REFERENTIAL_CONSTRAINTS', "EXTRA <> ''", 'NO_BACKSLASH_ESCAPES']) {
    assert.ok(migration.indexOf(guard) < ddl);
  }
  assert.match(migration, /SET SESSION group_concat_max_len = v_old_concat/);
  assert.match(migration, /DROP PROCEDURE aibiz_migrate_011_utf8mb4/);
});
