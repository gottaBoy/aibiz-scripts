import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const workspace = new URL('../../', import.meta.url);
const read = path => readFile(new URL(path, workspace), 'utf8');
const seed = await read('modelingservice/sql/init.sql');
const migration = await read('plm/deploy/compose/migrations/006_modeling_local_jdbc.sql');
const legacyUrl = 'jdbc:mysql://mysql:3306/sCloud9471c1eca?autoReconnect=true'
  + '&useUnicode=true&characterEncoding=UTF-8&useOldAliasMetadataBehavior=true';
const localUrl = `${legacyUrl}&useSSL=false`;

test('local model instance seed declares the same transport policy as the main datasource', async () => {
  const instance = seed.split('\n').filter(line =>
    /^INSERT INTO `ibizapi`\.`t_srfpssysmodelinst`/.test(line));
  assert.equal(instance.length, 1);
  assert.ok(instance[0].includes(`'${localUrl}'`));
  assert.ok(!instance[0].includes(`'${legacyUrl}'`));
  const mainDatasource = await read('modelingservice/scripts/servicehub-ibizmodelingservice');
  assert.match(mainDatasource, /jdbc:mysql:\/\/mysql:3306\/ibizapi\?[^\n]*&useSSL=false/);
});

test('migration is scoped to the original local instance and exact legacy connection', () => {
  assert.match(migration, /^-- Target database: ibizapi\n/);
  assert.match(migration, /UPDATE `t_srfpssysmodelinst`\s+SET `CONNSTR`/);
  assert.match(migration, /WHERE `PSSYSMODELINSTID` = '9A0C0A7E-8651-478D-96F3-5E5D314A13FB'/);
  assert.match(migration, /AND `DBTYPE` = 'MYSQL5'/);
  assert.match(migration, /AND `DBNAME` = 'sCloud9471c1eca'/);
  assert.ok(migration.includes(`AND BINARY \`CONNSTR\` = '${legacyUrl}'`));
  assert.ok(migration.includes(`SET \`CONNSTR\` = '${localUrl}'`));
  assert.equal(migration.split('\n').filter(line => !line.startsWith('--'))
    .join('\n').split(';').filter(value => value.trim()).length, 1);
});

test('re-running the migration cannot append duplicate transport settings', () => {
  assert.notEqual(localUrl, legacyUrl);
  assert.ok(!migration.includes(`AND BINARY \`CONNSTR\` = '${localUrl}'`));
  assert.doesNotMatch(migration, /CONCAT|REPLACE|LIKE|INSERT|DELETE|DROP|GRANT/i);
});

test('runtime leaves explicit remote TLS policies to their model instance configuration', async () => {
  const runtime = await read('ibiz-service-hub/libs/ibiz-modeling-core/src/main/java/'
    + 'net/ibizsys/modeling/core/database/ModelSysDBSchemeRuntimeBase.java');
  assert.match(runtime, /setJdbcUrl\(asString\(readProperty\(modelInst, "getConnStr"\)\)\)/);
  assert.doesNotMatch(runtime, /useSSL=false|jdk\.tls\.disabledAlgorithms|TLSv1\.1/);
});

test('the normal workspace migration entry picks up the scoped JDBC fix', async () => {
  const runner = await read('plm/deploy/compose/migrate.sh');
  assert.match(runner, /migrations=\("\$MIGRATION_DIR"\/\*\.sql\)/);
  assert.match(runner, /ibizapi\) database=\$IBIZAPI_DATABASE/);
  assert.match(runner, /<"\$migration"/);
});
