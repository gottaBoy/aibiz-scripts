import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createFixture } from '../prepare-run-owned-native-nonadmin-fixture.mjs';
import {
  buildProviderSchema, executeSchemaSupplement, parseArgs, providerSourcePins, snapshotRowSQL,
  validateNoOtherConnections, verifyProviderInventory,
} from '../provision-run-owned-uaa-provider-schema.mjs';
import { validateApplicationTarget } from '../provision-run-owned-native-application-accounts.mjs';

const workspace = fileURLToPath(new URL('../../', import.meta.url));
const runId = 'f01006abcdef';
const { manifest } = createFixture({
  runId, scenario: 'two-center', passwordStorageMode: 'sm3', modelVersion: 816,
  uaaSchemaMode: 'legacy-views', secret: () => '1'.repeat(36),
});
const model = () => JSON.parse(readFileSync(`${workspace}${providerSourcePins[0].path}`));
const candidate = () => buildProviderSchema(manifest, model());
const inventory = c => ({
  tables: [{ kind: 'BASE TABLE', engine: 'InnoDB', collation: 'utf8mb4_bin' }],
  columns: c.columns.map(({ source, ...column }) => column),
  indexes: [{ name: 'PRIMARY', unique: 0, position: 1, column: 'ID', prefix: null, type: 'BTREE' }],
  triggers: [], constraints: [{ name: 'PRIMARY', type: 'PRIMARY KEY' }],
});

test('source pins bind model, domain and mapper bytes without claiming authenticated original DDL', () => {
  for (const pin of providerSourcePins) {
    assert.equal(createHash('sha256').update(readFileSync(`${workspace}${pin.path}`)).digest('hex'), pin.sha256);
  }
  assert.match(candidate().translation.provenance, /reconstructed/);
  assert.match(candidate().translation.kind, /not-original-ddl/);
});

test('one source-derived CREATE TABLE covers 16 columns, nullability and ID PK with no rows/accounts/defaults', () => {
  const c = candidate();
  assert.equal(c.columns.length, 16);
  assert.equal(c.schema, manifest.schemas.uaa);
  assert.equal(c.table, 'open_access_provider');
  assert.match(c.ddl, new RegExp(`^CREATE TABLE \`${manifest.schemas.uaa}\`\\.\`open_access_provider\``));
  assert.equal(c.ddl.split(';').length, 2);
  assert.doesNotMatch(c.ddl, /IF NOT EXISTS|\b(?:INSERT|UPDATE|DELETE|GRANT|USER|DROP|ALTER|REPLACE|TRUNCATE)\b/i);
  assert.match(c.ddl, /`ID` varchar\(100\) NOT NULL/);
  assert.match(c.ddl, /`SORT` int\(11\) NULL/);
  assert.match(c.ddl, /`RESPONSE_CONFIG` mediumtext NULL/);
  assert.match(c.ddl, /PRIMARY KEY \(`ID`\)/);
  assert.ok(c.columns.every(column => column.default === null));
  assert.match(c.translation.responseConfig, /1048576|1 MiB/);
  assert.match(c.translation.responseConfig, /16777215/);
});

test('source mapping changes, duplicate entities and all incompatible physical fields fail closed', () => {
  for (const mutate of [
    m => { m.entities.push(m.entities.find(e => e.entity_name === 'AUTH_PROVIDER')); },
    m => { m.entities.find(e => e.entity_name === 'AUTH_PROVIDER').table_name = 'shared'; },
    m => { m.entities.find(e => e.entity_name === 'AUTH_PROVIDER').fields[0].nullable = 1; },
    m => { m.entities.find(e => e.entity_name === 'AUTH_PROVIDER').fields[1].data_length = 101; },
    m => { m.entities.find(e => e.entity_name === 'AUTH_PROVIDER').fields[2].physical_field = 0; },
    m => { m.entities.find(e => e.entity_name === 'AUTH_PROVIDER').fields[8].field_type = 'TEXT'; },
    m => { m.entities.find(e => e.entity_name === 'AUTH_PROVIDER').fields.reverse(); },
  ]) {
    const m = model();
    mutate(m);
    assert.throws(() => buildProviderSchema(manifest, m));
  }
  const foreign = structuredClone(manifest);
  foreign.schemas.uaa = 'shared';
  assert.throws(() => buildProviderSchema(foreign, model()));
});

test('exact information_schema verification rejects missing/extra/changed columns, indexes, triggers and rows', () => {
  const c = candidate();
  assert.equal(verifyProviderInventory(c, inventory(c), '0'), true);
  for (const mutate of [
    i => { i.tables[0].kind = 'VIEW'; },
    i => { i.tables[0].engine = 'MyISAM'; },
    i => { i.tables[0].collation = 'utf8mb4_general_ci'; },
    i => { i.columns.pop(); },
    i => { i.columns.push(i.columns[0]); },
    i => { i.columns[8].type = 'text'; },
    i => { i.columns[9].default = '100'; },
    i => { i.columns[0].nullable = 'YES'; },
    i => { i.indexes[0].prefix = 10; },
    i => { i.triggers.push({ name: 'foreign' }); },
    i => { i.constraints.push({ name: 'foreign', type: 'FOREIGN KEY' }); },
  ]) {
    const i = inventory(c);
    mutate(i);
    assert.throws(() => verifyProviderInventory(c, i, '0'));
  }
  for (const count of ['1', '-1', '', '00']) assert.throws(() => verifyProviderInventory(c, inventory(c), count));
});

test('connection guard rejects active and sleeping clients including root; does not overlook application sessions', () => {
  assert.equal(validateNoOtherConnections([]), true);
  for (const user of ['root', 'nf_app', 'unknown']) {
    for (const command of ['Sleep', 'Query']) assert.throws(() => validateNoOtherConnections([{ user, command }]));
  }
  assert.throws(() => validateNoOtherConnections(null));
});

test('full-row snapshot hashes all explicit columns and preserves duplicate rows rather than reducing to counts', () => {
  const sql = snapshotRowSQL(manifest.schemas.modelA, 't_srfpsmodule', ['PSMODULEID', 'PSMODULENAME', 'EXTRA']);
  assert.match(sql, /SHA2\(CAST\(JSON_OBJECT\('PSMODULEID',`PSMODULEID`,'PSMODULENAME',`PSMODULENAME`,'EXTRA',`EXTRA`\)/);
  assert.match(sql, /ORDER BY row_digest/);
  assert.doesNotMatch(sql, /DISTINCT|COUNT|\b(?:CREATE|DROP|UPDATE|DELETE|INSERT)\b/);
  assert.throws(() => snapshotRowSQL('shared;DROP', 'x', ['ID']));
  assert.throws(() => snapshotRowSQL(manifest.schemas.uaa, 'x', ['ID', 'ID']));
  assert.throws(() => snapshotRowSQL(manifest.schemas.uaa, 'x', []));
});

function fakeExecution({ exists = false, ddlFailure = false, changed = false } = {}) {
  const c = candidate();
  let created = exists;
  const records = [];
  const statements = [];
  let guardCalls = 0;
  const report = { ddlAttempted: false, ddlExecuted: false };
  const grantTables = ['columns_priv', 'db', 'procs_priv', 'proxies_priv', 'tables_priv', 'user'];
  const sql = query => {
    statements.push(query);
    if (query.startsWith('CREATE TABLE')) {
      if (ddlFailure) throw new Error('nontransactional failure');
      created = true;
      return '';
    }
    if (query.startsWith('SHOW CREATE')) return 'unchanged definition';
    if (query.startsWith('SELECT SHA2')) return created && changed ? 'changed row digest' : 'unchanged row digest';
    if (query.startsWith('SELECT COUNT')) return '0';
    if (query.includes("'schema',TABLE_SCHEMA")) return [
      ...Object.values(manifest.schemas).map(schema => ({ schema, table: 'existing', kind: 'BASE TABLE' })),
      ...grantTables.map(table => ({ schema: 'mysql', table, kind: 'BASE TABLE' })),
    ].map(row => JSON.stringify(row)).join('\n');
    if (query.includes("JSON_OBJECT('name',COLUMN_NAME)")) return JSON.stringify({ name: 'ID' });
    if (!created) return '';
    const i = inventory(c);
    if (query.includes('information_schema.TABLES')) return i.tables.map(row => JSON.stringify(row)).join('\n');
    if (query.includes('information_schema.COLUMNS')) return i.columns.map(row => JSON.stringify(row)).join('\n');
    if (query.includes('information_schema.STATISTICS')) return i.indexes.map(row => JSON.stringify(row)).join('\n');
    if (query.includes('information_schema.TABLE_CONSTRAINTS')) return i.constraints.map(row => JSON.stringify(row)).join('\n');
    if (query.includes('information_schema.TRIGGERS')) return '';
    throw new Error('unexpected statement');
  };
  const execute = () => executeSchemaSupplement({
    manifest, candidate: c, sql, report, guard: () => { guardCalls++; },
    record: (name, data) => records.push({ name, data: JSON.parse(data) }),
  });
  return { execute, report, records, statements, guardCalls: () => guardCalls };
}

test('successful supplement journals before DDL, verifies invariant snapshots and never promotes native acceptance', () => {
  const f = fakeExecution();
  f.execute();
  assert.equal(f.report.status, 'passed-owned-provider-schema-only');
  assert.equal(f.report.ddlExecuted, true);
  assert.deepEqual(f.report.before, f.report.after);
  assert.deepEqual(f.records.map(row => row.name), [
    'before-existing-state.json', 'ddl-attempt.json', 'ddl-executed.json',
    'provider-inventory.json', 'after-existing-state.json',
  ]);
  assert.equal(f.statements.filter(query => query.startsWith('CREATE TABLE')).length, 1);
  assert.equal(f.guardCalls(), 4);
  assert.equal(Object.hasOwn(f.report, 'nativeAcceptance'), false);
});

test('an existing table is never adopted and a failed DDL remains journaled without implicit drop or retry', () => {
  const existing = fakeExecution({ exists: true });
  assert.throws(existing.execute, /must be absent/);
  assert.equal(existing.report.ddlAttempted, false);
  assert.ok(!existing.statements.some(query => query.startsWith('CREATE TABLE')));
  const failed = fakeExecution({ ddlFailure: true });
  assert.throws(failed.execute, /nontransactional failure/);
  assert.equal(failed.report.ddlAttempted, true);
  assert.equal(failed.report.ddlExecuted, false);
  assert.equal(failed.records.at(-1).name, 'ddl-attempt.json');
  assert.ok(failed.statements.every(query => !/\bDROP\b/.test(query)));
});

test('existing data changes fail even when the provider shape/emptiness passes', () => {
  const f = fakeExecution({ changed: true });
  assert.throws(f.execute, /must remain unchanged/);
  assert.equal(f.report.ddlExecuted, true);
  assert.notEqual(f.report.before.sha256, f.report.after.sha256);
  assert.notEqual(f.report.status, 'passed-owned-provider-schema-only');
});

test('CLI requires explicit mutation, existing run/account and fresh traversal-free label', () => {
  const args = ['--execute-owned-schema-only', `--run-id=${runId}`, '--account-label=integration-r1', '--label=supplement-r1'];
  assert.deepEqual(parseArgs(args), { runId, accountLabel: 'integration-r1', label: 'supplement-r1' });
  for (const invalid of [
    [], args.slice(1), [...args, '--execute-owned-schema-only'], [...args, '--run-id=aaaaaaaaaaaa'],
    args.slice(0, -1), [...args.slice(0, -1), '--label=../old'], [...args, '--source-root=/tmp'],
    ['--execute-owned-schema-only', '--run-id=shared', '--account-label=x', '--label=x'],
  ]) assert.throws(() => parseArgs(invalid));
});

test('mutation target reuses exact resource/image/tmpfs/sole-peer guards and refuses any app peer', () => {
  const mysqlId = 'a'.repeat(64);
  const networkId = 'b'.repeat(64);
  const resources = { contract: 'run-owned-native-fixture-resources-v1', runId, mysqlId, networkId,
    mysqlName: manifest.ownership.mysqlContainer, networkName: manifest.ownership.network, schemas: manifest.schemas };
  const container = {
    Id: mysqlId, Name: `/${resources.mysqlName}`,
    Image: 'sha256:a086c6276f57c2b8067d0fda21893b7e3e542513cb5997b224cd0538d4970ece',
    Config: { Labels: { [manifest.ownership.label]: runId } }, State: { Running: true },
    HostConfig: { Privileged: false, PortBindings: {}, Binds: [], VolumesFrom: [],
      Tmpfs: { '/var/lib/mysql': 'rw,nosuid,nodev,size=1073741824' } },
    NetworkSettings: { Ports: {}, Networks: { [resources.networkName]: { NetworkID: networkId } } },
    Mounts: [{ Type: 'tmpfs', Destination: '/var/lib/mysql' }],
  };
  const network = { Id: networkId, Name: resources.networkName, Internal: true, Driver: 'bridge',
    Labels: { [manifest.ownership.label]: runId }, Containers: { [mysqlId]: {} } };
  assert.doesNotThrow(() => validateApplicationTarget(manifest, resources, container, network));
  network.Containers['c'.repeat(64)] = {};
  assert.throws(() => validateApplicationTarget(manifest, resources, container, network), /peers first/);
  delete network.Containers['c'.repeat(64)];
  container.Image = `sha256:${'d'.repeat(64)}`;
  assert.throws(() => validateApplicationTarget(manifest, resources, container, network));
});
