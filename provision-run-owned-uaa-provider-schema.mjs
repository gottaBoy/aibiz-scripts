#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PinnedDirectories, readPinnedFile } from './native-candidate-files.mjs';
import { validateMatrixFixture } from './prepare-run-owned-native-nonadmin-matrix.mjs';
import { validateApplicationTarget, validateFixtureReceipt } from './provision-run-owned-native-application-accounts.mjs';
import { inspectMysqlFixtureVolumes } from './owned-mysql-volume.mjs';

const workspaceRoot = fileURLToPath(new URL('../', import.meta.url));
const toolPath = 'scripts/provision-run-owned-uaa-provider-schema.mjs';
const testPath = 'scripts/tests/run-owned-uaa-provider-schema.test.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const tableName = 'open_access_provider';
const sourceRoot = '.artifacts/standalone-uaa-editable-20261006-E1/build-MGQ6RI/source';
export const providerSourcePins = [
  ['uaa-core/src/main/resources/sysmodel/uaa.json',
    'ba798505b6b000522a82f050c407f864cf7afcd6cc4449407b334311d60bd029'],
  ['uaa-core/src/main/java/cn/ibizlab/core/authentication/domain/AuthProvider.java',
    'f43eeb2a65bc48f02899f91e2266dc2e418820a0f9be92520cc974843b8f3899'],
  ['uaa-core/src/main/resources/mapper/authentication/AuthProvider/AuthProviderMapper.xml',
    '0648146d62cc8753b024c57c4e757c677e575766dcc436713b35419a5d2c497b'],
].map(([path, sha256]) => ({ path: join(sourceRoot, path), sha256 }));

const expectedFields = [
  ['ID', 'VARCHAR', 100, 0, 1], ['NAME', 'VARCHAR', 100, 1, 0],
  ['DC', 'VARCHAR', 100, 1, 0], ['AUTHENTICATION_URI', 'VARCHAR', 1000, 1, 0],
  ['AUTHENTICATION_METHOD', 'VARCHAR', 60, 1, 0], ['BASE_CONFIG', 'VARCHAR', 2000, 1, 0],
  ['RESPONSE_TYPE', 'VARCHAR', 60, 1, 0], ['RESPONSE_SUCCESS_FLAG', 'VARCHAR', 100, 1, 0],
  ['RESPONSE_CONFIG', 'TEXT', 1048576, 1, 0], ['SORT', 'INT', null, 1, 0],
  ['AUTHENTICATION_TYPE', 'VARCHAR', 60, 1, 0], ['CREATE_TIME', 'DATETIME', null, 1, 0],
  ['CREATOR', 'VARCHAR', 100, 1, 0], ['UPDATE_TIME', 'DATETIME', null, 1, 0],
  ['UPDATER', 'VARCHAR', 100, 1, 0], ['DISABLED', 'INT', null, 1, 0],
];

function identifier(value) {
  assert.equal(typeof value, 'string');
  assert.match(value, /^[a-z][a-z0-9_]*$/i);
  assert.ok(value.length <= 64);
  return value;
}

export function buildProviderSchema(manifest, model) {
  validateMatrixFixture(manifest);
  assert.ok(Array.isArray(model?.entities));
  const candidates = model.entities.filter(row =>
    row.entity_name?.toUpperCase() === 'AUTH_PROVIDER'
    || row.table_name?.toLowerCase() === tableName);
  assert.equal(candidates.length, 1, 'Require one unambiguous provider model mapping');
  const entity = candidates[0];
  assert.equal(entity.entity_name, 'AUTH_PROVIDER');
  assert.equal(entity.table_name, 'OPEN_ACCESS_PROVIDER');
  assert.ok(Array.isArray(entity.fields));
  assert.deepEqual(entity.fields.map(field => [
    field.fieldname, field.data_type, field.data_length ?? null, field.nullable, field.key_field,
  ]), expectedFields, 'Source provider fields differ from the reviewed pin');
  assert.ok(entity.fields.every(field => field.physical_field === 1 && field.entity_name === 'AUTH_PROVIDER'));
  assert.equal(entity.fields[8].field_type, 'LONGTEXT');
  const columns = entity.fields.map(field => {
    const name = identifier(field.fieldname);
    const type = field.data_type === 'VARCHAR' ? `varchar(${field.data_length})`
      : field.data_type === 'TEXT' ? 'mediumtext'
        : field.data_type === 'INT' ? 'int(11)' : 'datetime';
    const textual = field.data_type === 'VARCHAR' || field.data_type === 'TEXT';
    return {
      name, type, nullable: field.nullable ? 'YES' : 'NO',
      key: field.key_field ? 'PRI' : '', default: null, extra: '', comment: '',
      collation: textual ? 'utf8mb4_bin' : null,
      source: {
        entity: entity.entity_name, field: name, type: field.data_type,
        fieldType: field.field_type, length: field.data_length ?? null,
        nullable: field.nullable, keyField: field.key_field,
      },
    };
  });
  const schema = identifier(manifest.schemas.uaa);
  const definitions = columns.map(column =>
    `  \`${column.name}\` ${column.type} ${column.nullable === 'NO' ? 'NOT NULL' : 'NULL'}`);
  return {
    schema, table: tableName, columns,
    ddl: `CREATE TABLE \`${schema}\`.\`${tableName}\` (\n${definitions.join(',\n')},\n`
      + '  PRIMARY KEY (`ID`)\n) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_bin;\n',
    translation: {
      kind: 'reviewed-mysql57-schema-candidate-not-original-ddl',
      responseConfig: 'Source TEXT/LONGTEXT length 1048576 mapped to MEDIUMTEXT (16777215-byte capacity); no 1 MiB SQL limit is invented',
      dialectChoices: 'InnoDB, utf8mb4_bin and int(11) are explicit fixture dialect choices, not recovered original DDL',
      defaults: 'No SQL business defaults; Java SORT default 100 remains a Java behavior',
      provenance: 'Pinned MGQ6RI reconstructed editable source; original-source/license closure remains unresolved',
    },
  };
}

export function validateNoOtherConnections(rows) {
  assert.ok(Array.isArray(rows));
  assert.deepEqual(rows, [], 'Schema-only mutation requires no other client connections, including sleeping clients');
  return true;
}

function parseRows(output) {
  return output.trim() ? output.trim().split('\n').map(row => JSON.parse(row)) : [];
}

export function snapshotRowSQL(schema, table, columns) {
  identifier(schema);
  identifier(table);
  assert.ok(columns.length > 0 && new Set(columns).size === columns.length);
  const fields = columns.map(column => {
    identifier(column);
    return `'${column}',\`${column}\``;
  }).join(',');
  return `SELECT SHA2(CAST(JSON_OBJECT(${fields}) AS CHAR CHARACTER SET utf8mb4),256) AS row_digest`
    + ` FROM \`${schema}\`.\`${table}\` ORDER BY row_digest;\n`;
}

export function snapshotExistingFixture(manifest, sql) {
  validateMatrixFixture(manifest);
  const schemas = [...Object.values(manifest.schemas), 'mysql'];
  const grantTables = ['user', 'db', 'tables_priv', 'columns_priv', 'procs_priv', 'proxies_priv'];
  const tables = parseRows(sql(`SELECT JSON_OBJECT('schema',TABLE_SCHEMA,'table',TABLE_NAME,'kind',TABLE_TYPE)
    FROM information_schema.TABLES WHERE TABLE_SCHEMA IN (${schemas.map(name => `'${identifier(name)}'`).join(',')})
    ORDER BY TABLE_SCHEMA,TABLE_NAME;`)).filter(row =>
    row.schema === 'mysql' ? grantTables.includes(row.table)
      : !(row.schema === manifest.schemas.uaa && row.table === tableName));
  assert.ok(tables.length > 0);
  assert.deepEqual(tables.filter(row => row.schema === 'mysql').map(row => row.table).sort(), grantTables.sort(),
    'Snapshot requires every MySQL grant table');
  const entries = tables.map(row => {
    identifier(row.schema);
    identifier(row.table);
    const definitions = sql(`SHOW CREATE ${row.kind === 'VIEW' ? 'VIEW' : 'TABLE'} \`${row.schema}\`.\`${row.table}\`;`);
    const columns = parseRows(sql(`SELECT JSON_OBJECT('name',COLUMN_NAME) FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA='${row.schema}' AND TABLE_NAME='${row.table}' ORDER BY ORDINAL_POSITION;`))
      .map(column => column.name);
    const rowDigests = sql(snapshotRowSQL(row.schema, row.table, columns)).trim();
    return { ...row, columnCount: columns.length, ddlSha256: hash(definitions),
      rowCount: rowDigests ? rowDigests.split('\n').length : 0, allRowsSha256: hash(rowDigests) };
  });
  return { entries, sha256: hash(json(entries)),
    boundary: 'All columns/rows and SHOW CREATE of existing four-schema tables/views plus six MySQL grant tables; row values are not exported' };
}

function providerInventory(candidate, sql) {
  const selector = `TABLE_SCHEMA='${candidate.schema}' AND TABLE_NAME='${candidate.table}'`;
  return {
    tables: parseRows(sql(`SELECT JSON_OBJECT('kind',TABLE_TYPE,'engine',ENGINE,'collation',TABLE_COLLATION)
      FROM information_schema.TABLES WHERE ${selector};`)),
    columns: parseRows(sql(`SELECT JSON_OBJECT('name',COLUMN_NAME,'type',COLUMN_TYPE,
      'nullable',IS_NULLABLE,'key',COLUMN_KEY,'default',COLUMN_DEFAULT,'extra',EXTRA,
      'collation',COLLATION_NAME,'comment',COLUMN_COMMENT)
      FROM information_schema.COLUMNS WHERE ${selector} ORDER BY ORDINAL_POSITION;`)),
    indexes: parseRows(sql(`SELECT JSON_OBJECT('name',INDEX_NAME,'unique',NON_UNIQUE,'position',SEQ_IN_INDEX,
      'column',COLUMN_NAME,'prefix',SUB_PART,'type',INDEX_TYPE)
      FROM information_schema.STATISTICS WHERE ${selector} ORDER BY INDEX_NAME,SEQ_IN_INDEX;`)),
    triggers: parseRows(sql(`SELECT JSON_OBJECT('name',TRIGGER_NAME) FROM information_schema.TRIGGERS
      WHERE EVENT_OBJECT_SCHEMA='${candidate.schema}' AND EVENT_OBJECT_TABLE='${candidate.table}';`)),
    constraints: parseRows(sql(`SELECT JSON_OBJECT('name',CONSTRAINT_NAME,'type',CONSTRAINT_TYPE)
      FROM information_schema.TABLE_CONSTRAINTS WHERE ${selector} ORDER BY CONSTRAINT_NAME;`)),
  };
}

export function verifyProviderInventory(candidate, inventory, count) {
  assert.deepEqual(inventory.tables, [{ kind: 'BASE TABLE', engine: 'InnoDB', collation: 'utf8mb4_bin' }]);
  assert.deepEqual(inventory.columns, candidate.columns.map(({ source, ...column }) => column));
  assert.deepEqual(inventory.indexes, [
    { name: 'PRIMARY', unique: 0, position: 1, column: 'ID', prefix: null, type: 'BTREE' },
  ]);
  assert.deepEqual(inventory.triggers, []);
  assert.deepEqual(inventory.constraints, [{ name: 'PRIMARY', type: 'PRIMARY KEY' }]);
  assert.equal(count, '0', 'Only an empty provider table is authorized');
  return true;
}

// DDL is nontransactional. Record intent before execution and never erase a
// failed attempt or drop a possibly created table as an implicit rollback.
export function executeSchemaSupplement({ manifest, candidate, sql, guard, record, report }) {
  report.phase = 'initial-resource-and-connection-guard';
  guard();
  report.phase = 'provider-absence-and-existing-state';
  const beforeProvider = providerInventory(candidate, sql);
  assert.deepEqual(beforeProvider, { tables: [], columns: [], indexes: [], triggers: [], constraints: [] },
    'Provider table must be absent; no adoption/IF NOT EXISTS allowed');
  const before = snapshotExistingFixture(manifest, sql);
  record('before-existing-state.json', json(before));
  report.before = before;
  report.phase = 'pre-ddl-resource-and-connection-guard';
  guard();
  record('ddl-attempt.json', json({ ddlSha256: hash(candidate.ddl), attemptedAt: new Date().toISOString(),
    nontransactional: true, implicitRollbackOrDropAllowed: false }));
  report.ddlAttempted = true;
  report.phase = 'nontransactional-create-table';
  sql(candidate.ddl);
  report.ddlExecuted = true;
  record('ddl-executed.json', json({ ddlSha256: hash(candidate.ddl), executedAt: new Date().toISOString() }));
  report.phase = 'post-ddl-resource-and-schema-verification';
  guard();
  const afterProvider = providerInventory(candidate, sql);
  verifyProviderInventory(candidate, afterProvider,
    sql(`SELECT COUNT(*) FROM \`${candidate.schema}\`.\`${candidate.table}\`;`).trim());
  record('provider-inventory.json', json(afterProvider));
  report.providerInventory = afterProvider;
  report.phase = 'existing-state-invariance';
  const after = snapshotExistingFixture(manifest, sql);
  record('after-existing-state.json', json(after));
  report.after = after;
  assert.deepEqual(after, before, 'All existing fixture rows/schema/grants must remain unchanged');
  guard();
  report.checks = [
    'exact-owned-mysql-image-and-sole-peer', 'no-other-client-connections',
    'provider-absent-before-create', 'exact-16-columns-primary-key-and-no-triggers',
    'new-provider-table-empty', 'all-existing-four-schema-and-grant-table-state-unchanged',
  ].map(id => ({ id, status: 'passed' }));
  report.status = 'passed-owned-provider-schema-only';
  report.phase = 'schema-only-checks-complete';
}

function docker(args, input) {
  const result = spawnSync('docker', args, {
    input, encoding: 'utf8', timeout: 60_000, maxBuffer: 16 * 1024 * 1024,
  });
  assert.ok(!result.error && result.status === 0, 'Owned Docker/SQL check failed; raw diagnostics suppressed');
  return result.stdout.trim();
}

export function provisionProviderSchema({ runId, accountLabel, label, workspace = workspaceRoot }) {
  assert.match(runId, /^[a-f0-9]{12}$/);
  for (const value of [accountLabel, label]) assert.match(value, /^[a-z0-9][a-z0-9-]{0,63}$/);
  const directories = new PinnedDirectories();
  const inputs = [];
  const outputs = {};
  try {
    const base = directories.open(join(workspace, '.artifacts', 'native-nonadmin-fixtures', runId));
    const read = relativePath => {
      const path = join(workspace, relativePath);
      const data = readPinnedFile(directories, directories.open(dirname(path)), basename(path)).data;
      const binding = { path: relativePath, bytes: data.length, sha256: hash(data) };
      inputs.push(binding);
      return { data, value: relativePath.endsWith('.json') ? JSON.parse(data) : null, binding };
    };
    const relativeBase = `.artifacts/native-nonadmin-fixtures/${runId}`;
    const manifestInput = read(`${relativeBase}/manifest.json`);
    const manifest = manifestInput.value;
    assert.equal(manifest.runId, runId);
    const fixtureReceipt = read(`${relativeBase}/isolated-sql-report.json`).value;
    const resources = read(`${relativeBase}/owned-resources.json`).value;
    validateFixtureReceipt(manifest, fixtureReceipt, manifestInput.binding.sha256);
    assert.equal(resources.mysqlId, fixtureReceipt.ownedMysqlId);
    assert.equal(resources.networkId, fixtureReceipt.ownedNetworkId);
    for (const pin of fixtureReceipt.inputs.fixtureTools) {
      assert.match(pin.path, /^scripts\/(?:tests\/)?[a-z0-9.-]+\.mjs$/);
      assert.equal(read(pin.path).binding.sha256, pin.sha256, 'Frozen fixture tool changed');
    }
    const accounts = read(`${relativeBase}/application-accounts-${accountLabel}/report.json`).value;
    assert.equal(accounts.contract, 'run-owned-native-application-accounts-v1');
    assert.equal(accounts.status, 'passed-owned-application-account-sql-only');
    assert.equal(accounts.runId, runId);
    for (const key of ['nativeAcceptance', 'permissionAcceptance', 'sourceNativeAcceptance']) assert.equal(accounts[key], false);
    for (const pin of accounts.inputs) {
      assert.ok(['manifest.json', 'isolated-sql-report.json', 'owned-resources.json'].includes(pin.name));
      assert.equal(inputs.find(row => row.path === `${relativeBase}/${pin.name}`)?.sha256, pin.sha256);
    }
    let model;
    for (const pin of providerSourcePins) {
      const source = read(pin.path);
      assert.equal(source.binding.sha256, pin.sha256, 'Provider source differs from reviewed pin');
      if (pin.path.endsWith('/uaa.json')) model = source.value;
    }
    const candidate = buildProviderSchema(manifest, model);
    read(toolPath);
    read(testPath);
    const output = directories.open(join(base.path, `provider-schema-${label}`), { create: true, exclusive: true });
    const record = (name, data) => {
      directories.write(output, name, data);
      outputs[name] = { sha256: hash(data), bytes: Buffer.byteLength(data) };
    };
    const report = {
      contract: 'run-owned-uaa-provider-schema-supplement-v1', runId, label,
      status: 'running-owned-provider-schema-only', startedAt: new Date().toISOString(),
      nativeAcceptance: false, permissionAcceptance: false, sourceNativeAcceptance: false,
      actualUAALoginVerified: false, actualBackendHTTPVerified: false,
      sourceClosure: false, originalDDLVerified: false, inputs, outputs,
      schema: candidate.schema, table: candidate.table, columns: candidate.columns,
      translation: candidate.translation, checks: [], guards: [],
      ddlAttempted: false, ddlExecuted: false,
      boundary: 'One empty provider table only; immutable supplemental receipt never replaces historical SQL/native/source receipts',
      cleanup: 'No per-table auto-drop; whole-run cleanup requires sole-peer exact resource guards. Never remove main-owned peers.',
    };
    const sql = query => docker(['exec', '-i', resources.mysqlId, 'sh', '-c',
      'test -n "$MYSQL_ROOT_PASSWORD" && MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -h127.0.0.1 --protocol=TCP -uroot --default-character-set=utf8mb4 --batch --raw --skip-column-names'], query);
    const guard = () => {
      const container = JSON.parse(docker(['inspect', resources.mysqlId]))[0];
      const network = JSON.parse(docker(['network', 'inspect', resources.networkId]))[0];
      const live = validateApplicationTarget(manifest, resources, container, network, inspectMysqlFixtureVolumes(resources));
      assert.equal(sql('SELECT @@lower_case_table_names;'), '1');
      assert.match(sql('SELECT VERSION();'), /^5\.7\./);
      validateNoOtherConnections(parseRows(sql(`SELECT JSON_OBJECT('user',USER,'host',HOST,'command',COMMAND)
        FROM information_schema.PROCESSLIST WHERE ID<>CONNECTION_ID()
        AND USER NOT IN ('system user','event_scheduler') ORDER BY ID;`)));
      report.guards.push({ ...live, otherClientConnections: 0 });
    };
    try {
      record('schema-only.sql', candidate.ddl);
      record('intent.json', json({ contract: report.contract, runId, inputs, candidate,
        solePeerAndNoOtherConnectionsRequired: true, singleWriterCoordinationRequired: true }));
      executeSchemaSupplement({ manifest, candidate, sql, guard, record, report });
      report.phase = 'final-input-pin-verification';
      for (const pin of inputs) {
        const data = readPinnedFile(directories, directories.open(dirname(join(workspace, pin.path))),
          basename(pin.path)).data;
        assert.equal(hash(data), pin.sha256, 'Pinned input changed during schema supplement');
      }
      report.phase = 'complete';
    } catch {
      report.status = report.ddlAttempted ? 'failed-schema-supplement-inspect-before-retry'
        : 'blocked-schema-supplement-before-ddl';
      report.error = 'Guard/schema/state/input validation failed; raw credential-bearing diagnostics suppressed';
    } finally {
      report.finishedAt = new Date().toISOString();
      record('report.json', json(report));
    }
    return { report, reportPath: join(output.path, 'report.json') };
  } finally {
    directories.close();
  }
}

export function parseArgs(argv) {
  const options = {};
  for (const arg of argv) {
    if (arg === '--execute-owned-schema-only') {
      assert.equal(options.execute, undefined);
      options.execute = true;
      continue;
    }
    const match = /^--(run-id|account-label|label)=(.+)$/.exec(arg);
    assert.ok(match && !Object.hasOwn(options, match[1]), 'Explicit nonduplicate schema-only options required');
    options[match[1]] = match[2];
  }
  assert.equal(options.execute, true, 'Explicit --execute-owned-schema-only required');
  assert.match(options['run-id'], /^[a-f0-9]{12}$/);
  for (const key of ['account-label', 'label']) assert.match(options[key], /^[a-z0-9][a-z0-9-]{0,63}$/);
  return { runId: options['run-id'], accountLabel: options['account-label'], label: options.label };
}

export function main(argv = process.argv.slice(2)) {
  const { report, reportPath } = provisionProviderSchema(parseArgs(argv));
  if (report.status !== 'passed-owned-provider-schema-only') process.exitCode = 1;
  console.log(JSON.stringify({ reportPath, status: report.status, sha256: hash(readFileSync(reportPath)),
    ddlAttempted: report.ddlAttempted, ddlExecuted: report.ddlExecuted, nativeAcceptance: false }));
  return { report, reportPath };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { main(); } catch {
    console.error('Schema-only supplement rejected before execution; diagnostics suppressed');
    process.exitCode = 1;
  }
}
