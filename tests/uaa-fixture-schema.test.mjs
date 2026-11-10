import assert from 'node:assert/strict';
import test from 'node:test';
import { uaaSchemaSQL, uaaSchemaTableSQL } from '../uaa-fixture-schema.mjs';
import {
  captureModelUAASchema, runIsolatedSQLSmoke,
} from './run-owned-native-nonadmin-fixture.sql.mjs';

const model = () => ({
  entities: Array.from({ length: 18 }, (_, index) => ({
    table_name: `SYS_FIXTURE_${index}`,
    fields: [
      { fieldname: 'ID', physical_field: 1, data_type: 'VARCHAR', data_length: 100 },
      { fieldname: 'AUDIT', physical_field: 1, data_type: 'DATETIME' },
      { fieldname: 'BINARY_DATA', physical_field: 1, data_type: 'VARBINARY' },
      { fieldname: 'NON_PHYSICAL', physical_field: 0, data_type: 'UNSUPPORTED' },
    ],
  })),
});

test('reviewed UAA fixture DDL is table-only, nullable and scoped to the declared schema', () => {
  const tables = uaaSchemaTableSQL(model(), 'nf_fixture_uaa');
  assert.equal(tables.length, 18);
  for (const ddl of tables) {
    assert.ok(ddl.startsWith('CREATE TABLE `nf_fixture_uaa`.`SYS_FIXTURE_'));
    assert.match(ddl, /`ID` VARCHAR\(100\) NULL/);
    assert.match(ddl, /`AUDIT` DATETIME NULL/);
    assert.match(ddl, /`BINARY_DATA` LONGBLOB NULL/);
    assert.match(ddl, /ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;$/);
    assert.doesNotMatch(ddl, /NON_PHYSICAL|INSERT|UPDATE|DROP|GRANT|DEFINER|SELECT/);
  }
  assert.equal(uaaSchemaSQL(model(), 'nf_fixture_uaa'),
    `CREATE DATABASE \`nf_fixture_uaa\` CHARACTER SET utf8mb4;\n${tables.join('\n')}\n`);
});

test('missing, duplicate, unsafe or unsupported UAA model definitions are rejected', () => {
  for (const mutate of [
    m => { m.entities.pop(); },
    m => { m.entities[1].table_name = m.entities[0].table_name.toLowerCase(); },
    m => { m.entities[0].table_name = 'unsafe;DROP'; },
    m => { m.entities[0].fields = []; },
    m => { m.entities[0].fields[0].fieldname = 'ID;DROP'; },
    m => { m.entities[0].fields[1].fieldname = 'id'; },
    m => { m.entities[0].fields[0].data_type = 'UNKNOWN'; },
    m => { m.entities[0].fields[0].data_length = 0; },
    m => { m.entities[0].fields[0].data_length = 4097; },
  ]) {
    const value = model();
    mutate(value);
    assert.throws(() => uaaSchemaTableSQL(value, 'nf_fixture_uaa'));
  }
  assert.throws(() => uaaSchemaTableSQL(model(), 'shared.schema'));
});

test('explicit maintained model capture records source bytes and does not select a shared database', () => {
  const captured = captureModelUAASchema(
    'standalone-uaa/source/uaa-core/src/main/resources/sysmodel/uaa.json', 'nf_fixture_uaa',
  );
  assert.equal(captured.ddl.length, 18);
  assert.equal(captured.tables.length, 18);
  assert.deepEqual(captured.views, []);
  assert.match(captured.modelInput.sha256, /^[a-f0-9]{64}$/);
  assert.equal(captured.mode, 'model-derived-nullable-fixture-ddl-not-official-migration');
  assert.throws(() => captureModelUAASchema('../outside.json', 'nf_fixture_uaa'));
});

test('SQL runner never silently falls back between live schema capture and a model file', () => {
  const options = {
    mysqlImage: 'sha256:' + 'a'.repeat(64), scenario: 'two-center', modelVersion: 816,
    uaaModelPath: 'standalone-uaa/source/uaa-core/src/main/resources/sysmodel/uaa.json',
    uaaSchemaMode: 'standalone-tables',
  };
  for (const change of [
    { uaaSchemaContainer: 'mysql' }, { uaaSchema: 'shared' },
    { uaaSchemaMode: 'legacy-views' }, { uaaModelPath: '' },
  ]) assert.throws(() => runIsolatedSQLSmoke({ ...options, ...change }));
});
