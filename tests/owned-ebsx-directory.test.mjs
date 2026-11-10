import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import {
  createOwnedDirectoryPlan, directorySnapshotSQL, directorySourceSQL,
  seedOwnedDirectory, verifyDirectoryColumns, verifyDirectoryReadback,
} from '../seed-owned-ebsx-directory.mjs';
import { createFixture } from '../prepare-run-owned-native-nonadmin-fixture.mjs';

const runId = 'f01006abcdef';
const { manifest } = createFixture({
  runId, passwordStorageMode: 'sm3', modelVersion: 816, secret: () => 'a'.repeat(36),
});
const centers = ['a', 'b'].map(side => `nf_${runId}_center_${side}`);
const source = {
  domains: centers.map(center => ({ id: center, name: center })),
  deployments: centers.map(center => ({ id: `${center}_deploy`, name: 'Native nonadmin fixture',
    centerId: center, systemId: 'ibizmodeling', enabled: 1, deleted: 0 })),
};
const provider = { deploySystemId: 'ibizmodeling', model: { codeName: 'iBizModeling', name: 'iBizModeling' } };
const model = JSON.parse(fs.readFileSync(new URL(
  '../../ibiz-service-hub/libs/ibiz-cloud-saas-ebsx/src/main/resources/sysmodel/saas-ebsx/PSSYSDBSCHEMES/DEFAULT.json',
  import.meta.url)));
const declared = model.getAllPSSysDBTables.filter(row => ['IBZPSSYSTEM', 'IBZCENTER', 'IBZDCSYSTEM'].includes(row.name));
const types = { 5: 'datetime', 9: 'int', 21: 'mediumtext', 25: 'varchar' };
const metadata = () => declared.flatMap(table => table.getAllPSSysDBColumns.map(column => ({
  table: table.name.toLowerCase(), name: column.name.toLowerCase(), type: types[column.stdDataType],
  nullable: column.pKey || column.nullable === false ? 'NO' : 'YES', default: null,
  key: column.pKey ? 'PRI' : '', length: column.length, extra: '',
})));

test('five directory rows derive only from the owned UAA centers/deployments and actual provider model', () => {
  const before = structuredClone({ manifest, source, provider });
  const plan = createOwnedDirectoryPlan(manifest, source, provider);
  assert.deepEqual({ manifest, source, provider }, before);
  assert.equal(plan.rows.length, 5);
  assert.deepEqual(plan.rows.map(row => row.table), ['IBZPSSYSTEM', 'IBZCENTER', 'IBZCENTER', 'IBZDCSYSTEM', 'IBZDCSYSTEM']);
  assert.deepEqual(plan.rows[0].values, { PSSYSTEMID: 'ibizmodeling', PSSYSTEMNAME: 'iBizModeling' });
  assert.equal(plan.nativeAcceptance, false);
  assert.equal(plan.modelStructureSynchronized, false);
  for (const row of plan.rows) {
    assert.ok(!Object.keys(row.values).some(key => /MODEL|STRUCTURE|DIGEST|PASSWORD|PERMISSION|ROLE/.test(key)));
  }
});

for (const [name, mutate] of [
  ['foreign center', input => { input.source.domains[0].id = 'demo'; }],
  ['missing tenant', input => { input.source.domains.pop(); }],
  ['foreign system', input => { input.source.deployments[0].systemId = 'shared'; }],
  ['foreign deployment', input => { input.source.deployments[0].id = 'shared'; }],
  ['cross-center deployment', input => { input.source.deployments[0].centerId = centers[1]; }],
  ['disabled deployment', input => { input.source.deployments[0].enabled = 0; }],
  ['deleted deployment', input => { input.source.deployments[0].deleted = 1; }],
  ['provider model mismatch', input => { input.provider.model.codeName = 'PLM'; }],
  ['empty provider name', input => { input.provider.model.name = ''; }],
  ['wrong deployment id', input => { input.provider.deploySystemId = 'shared'; }],
  ['unreviewed topology', input => { input.manifest.scenario = 'same-center'; }],
]) {
  test(`directory plan refuses ${name}`, () => {
    const input = structuredClone({ manifest, source, provider });
    mutate(input);
    assert.throws(() => createOwnedDirectoryPlan(input.manifest, input.source, input.provider));
  });
}

test('source queries select only the exact owned center/deployment records and never credentials', () => {
  const sql = directorySourceSQL(manifest);
  assert.match(sql, /sys_domain/);
  assert.match(sql, /sys_deploy_system/);
  assert.ok(centers.every(center => sql.includes(Buffer.from(center).toString('hex'))));
  assert.doesNotMatch(sql, /\b(?:PASSWORD|USER_PASSWORD|INSERT|UPDATE|DELETE|GRANT|CREATE)\b/i);
  assert.throws(() => directorySourceSQL({ ...manifest, schemas: { ...manifest.schemas, uaa: 'shared' } }));
});

test('full native directory column inventory matches types, nullability, defaults and original primary keys', () => {
  const columns = verifyDirectoryColumns(model, metadata());
  assert.equal(columns.IBZPSSYSTEM.length, 15);
  for (const mutate of [
    rows => { rows.pop(); },
    rows => { rows[0].type = 'int'; },
    rows => { rows.find(row => row.key === 'PRI').key = ''; },
    rows => { rows[0].default = 'invented'; },
    rows => { rows[0].extra = 'auto_increment'; },
    rows => { rows[0].nullable = rows[0].nullable === 'NO' ? 'YES' : 'NO'; },
    rows => { rows.find(row => row.type === 'varchar').length = 1; },
  ]) {
    const actual = metadata();
    mutate(actual);
    assert.throws(() => verifyDirectoryColumns(model, actual));
  }
});

test('snapshot SQL reads every declared column and rejects foreign identifiers', () => {
  const columns = verifyDirectoryColumns(model, metadata());
  const sql = directorySnapshotSQL(`nf_${runId}_ebsx`, columns);
  assert.equal(sql.split('SELECT JSON_OBJECT').length - 1, 3);
  for (const names of Object.values(columns)) {
    assert.ok(names.every(name => sql.includes(`\`${name}\``)));
  }
  assert.doesNotMatch(sql, /^\s*(?:INSERT|UPDATE|DELETE|REPLACE|GRANT)\b/m);
  assert.throws(() => directorySnapshotSQL('shared', columns));
  assert.throws(() => directorySnapshotSQL(`nf_${runId}_ebsx`, { ...columns, shared: ['ID'] }));
});

test('readback requires the exact five full rows with untouched optional columns still null', () => {
  const plan = createOwnedDirectoryPlan(manifest, source, provider);
  const columns = verifyDirectoryColumns(model, metadata());
  const expected = plan.rows.map(row => ({
    table: row.table, values: { ...Object.fromEntries(columns[row.table].map(column => [column, null])), ...row.values },
  }));
  verifyDirectoryReadback(plan, columns, expected);
  assert.throws(() => verifyDirectoryReadback(plan, columns, expected.slice(1)));
  const changed = structuredClone(expected);
  changed[0].values.SYSSTRUCTURE = 'invented';
  assert.throws(() => verifyDirectoryReadback(plan, columns, changed));
  const omitted = structuredClone(expected);
  delete omitted[0].values.SYSSTRUCTURE;
  assert.throws(() => verifyDirectoryReadback(plan, columns, omitted));
});

test('live directory seed requires an explicit mutation opt-in before runtime context access', async () => {
  await assert.rejects(seedOwnedDirectory({ executeSeed: false }), /opt-in/);
  await assert.rejects(seedOwnedDirectory({ executeSeed: true, label: '../shared' }));
});

test('Java helper uses a scoped JDBC transaction with range locks, prepared inserts and rollback', () => {
  const source = fs.readFileSync(new URL('../fixtures/OwnedEbsxDirectorySeed.java', import.meta.url), 'utf8');
  for (const marker of ['TRANSACTION_SERIALIZABLE', 'setAutoCommit(false)', 'FOR UPDATE',
    'connection.prepareStatement(statement)', 'insert.setString', 'connection.commit()', 'connection.rollback()']) {
    assert.ok(source.includes(marker));
  }
  assert.doesNotMatch(source, /CREATE TABLE|GRANT|DROP|REPLACE INTO|ON DUPLICATE|USER_PASSWORD/);
});
