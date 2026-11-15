import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { createFixture } from '../prepare-run-owned-native-nonadmin-fixture.mjs';
import { buildOwnedNativeUnicodePlan } from '../owned-native-unicode-plan.mjs';
import {
  assertOwnedUnicodeMetadataSnapshotSQL, collectOwnedUnicodeMetadata, main,
  ownedUnicodeMetadataQueries, ownedUnicodeMetadataSnapshotSQL,
  parseOwnedUnicodeMetadataSnapshot, readOwnedUnicodeSchemaPresence,
} from '../collect-owned-native-unicode-metadata.mjs';
import { workflowIdentity } from '../bootstrap-owned-workflow-schema.mjs';
import { ebsxIdentity } from '../bootstrap-owned-ebsx-schema.mjs';
import { platformIdentity } from '../bootstrap-owned-platform-schema.mjs';

const workspaceSource = fileURLToPath(new URL('../../', import.meta.url));
const entrypoint = fileURLToPath(new URL('../collect-owned-native-unicode-metadata.mjs', import.meta.url));
const runId = '123456abcdef';
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const tools = [
  'scripts/collect-owned-native-unicode-metadata.mjs',
  'scripts/owned-native-unicode-plan.mjs',
  'scripts/owned-native-runtime-context.mjs',
  'scripts/run-owned-a01-root-http.mjs',
  'scripts/bootstrap-owned-workflow-schema.mjs',
  'scripts/bootstrap-owned-ebsx-schema.mjs',
  'scripts/bootstrap-owned-platform-schema.mjs',
  'scripts/provision-run-owned-native-application-accounts.mjs',
  'scripts/tests/run-owned-native-nonadmin-fixture.sql.mjs',
];

function fixture() {
  const { manifest } = createFixture({
    runId, passwordStorageMode: 'sm3', modelVersion: 819, secret: () => 'a'.repeat(36),
  });
  const manifestSha256 = hash(json(manifest));
  const database = manifest.schemas.modelA;
  const table = 'owned';
  const arrays = {
    schemas: Object.values(manifest.schemas).sort().map(schema =>
      ({ schema, charset: 'utf8', collation: 'utf8_general_ci' })),
    tables: [{
      database, table, kind: 'BASE TABLE', engine: 'InnoDB', rowFormat: 'Dynamic',
      collation: 'utf8_general_ci', createOptions: '', comment: 'metadata only',
    }],
    columns: [{
      database, table, column: 'ID', type: 'varchar', columnType: 'varchar(100)',
      ordinal: 1, key: 'PRI', nullable: 'NO', default: null, extra: '',
      charset: 'utf8', collation: 'utf8_general_ci', characterLength: 100, octetLength: 300,
      comment: "中文 😀 e\u0301 ' \\ \n", generationExpression: '',
    }],
    indexes: [{
      database, table, name: 'PRIMARY', position: 1, nonUnique: 0, column: 'ID', prefix: null,
      type: 'BTREE', collation: 'A', packed: null, nullable: '', comment: '', indexComment: '',
    }],
    characterSets: [
      { name: 'utf8', maxlen: 3, defaultCollation: 'utf8_general_ci', description: 'UTF-8 Unicode' },
      { name: 'utf8mb4', maxlen: 4, defaultCollation: 'utf8mb4_general_ci', description: 'UTF-8 Unicode' },
    ],
    collations: [
      { name: 'utf8_general_ci', charset: 'utf8', id: 33, isDefault: 'Yes', isCompiled: 'Yes', sortlen: 1 },
      { name: 'utf8mb4_general_ci', charset: 'utf8mb4', id: 45, isDefault: 'Yes', isCompiled: 'Yes', sortlen: 1 },
    ],
    foreignKeys: [], triggers: [], views: [], routines: [],
  };
  const server = {
    version: '5.7.41', versionComment: 'MySQL Community Server (GPL)', innodbPageSize: 16384,
    innodbLargePrefix: 1, innodbFileFormat: 'Barracuda', innodbStrictMode: 1,
    lowerCaseTableNames: 0, sqlModes: 'STRICT_TRANS_TABLES,NO_ENGINE_SUBSTITUTION',
    characterSetClient: 'utf8mb4', characterSetConnection: 'utf8mb4', characterSetResults: 'utf8mb4',
  };
  const rows = ownedUnicodeMetadataQueries(manifest).flatMap(query => {
    if (query.id === 'unapprovedSchemaCount') return [{ query: query.id, row: { count: 0 } }];
    if (query.id === 'server') return [{ query: query.id, row: server }];
    const [name, kind] = query.id.split('.');
    return kind === 'rows' ? arrays[name].map(row => ({ query: query.id, row }))
      : [{ query: query.id, row: { count: arrays[name].length } }];
  });
  return { manifest, manifestSha256, rows };
}

function parse(input = fixture()) {
  return parseOwnedUnicodeMetadataSnapshot({
    ...input, observedAt: '2026-11-15T12:00:00.000Z',
  });
}

function diskFixture(t, options = {}) {
  const input = fixture();
  const workspace = mkdtempSync(join(tmpdir(), 'collect-owned-unicode-'));
  const base = join(workspace, '.artifacts/native-nonadmin-fixtures', runId);
  mkdirSync(base, { recursive: true, mode: 0o700 });
  const manifestPath = join(base, 'manifest.json');
  writeFileSync(manifestPath, json(input.manifest), { mode: 0o600 });
  for (const tool of tools) {
    const target = join(workspace, tool);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, readFileSync(join(workspaceSource, tool)));
  }
  const calls = [];
  let guards = 0;
  let closed = false;
  const services = Object.fromEntries(['allinone', 'gateway', 'provider', 'uaa']
    .map((role, index) => [role, { containerId: String(index + 4).repeat(64) }]));
  const auxiliaryContainers = ['nacos', 'redis', 'zookeeper'].map((role, index) => ({
    role, containerId: (index + 8).toString(16).repeat(64),
  }));
  const peerIds = ['1'.repeat(64), ...Object.values(services).map(peer => peer.containerId),
    ...auxiliaryContainers.map(peer => peer.containerId)];
  const resources = {
    mysqlId: '1'.repeat(64), mysqlImage: `sha256:${'2'.repeat(64)}`, networkId: '3'.repeat(64),
  };
  const resourcePath = join(base, 'owned-resources.json');
  writeFileSync(resourcePath, json(resources), { mode: 0o600 });
  const probeSchemas = ['a', 'b'].map(side => `nfx${runId}_model_${side}`);
  const fixtureReportPath = join(base, 'isolated-sql-report.json');
  const fixtureReport = {
    contract: 'run-owned-native-nonadmin-isolated-sql-smoke-v1',
    runId, scenario: input.manifest.scenario, status: 'passed-isolated-sql-fixture-only',
    retainOwned: true, nativeAcceptance: false, permissionAcceptance: false,
    sourceNativeAcceptance: false, actualUAALoginVerified: false, actualBackendHTTPVerified: false,
    ownedMysqlId: resources.mysqlId, ownedNetworkId: resources.networkId, mysqlImage: resources.mysqlImage,
    ownedGrantWildcardProbeSchemas: probeSchemas,
    cleanup: { mysqlRemoved: false, networkRemoved: false },
    outputs: {
      'manifest.json': { sha256: input.manifestSha256 },
      'owned-resources.json': { sha256: hash(json(resources)) },
    },
    inputs: { fixtureTools: [{
      path: 'scripts/tests/run-owned-native-nonadmin-fixture.sql.mjs',
      sha256: hash(readFileSync(join(workspace, 'scripts/tests/run-owned-native-nonadmin-fixture.sql.mjs'))),
    }] },
    checks: [
      ...Array.from({ length: 48 }, (_, index) => ({ name: `controlled check ${index}`, status: 'passed' })),
      ...probeSchemas.flatMap((schema, index) => [
        { name: `JDBC ${['a', 'b'][index]} foreign lookalike SELECT denied`, status: 'passed' },
        { name: `JDBC ${['a', 'b'][index]} foreign lookalike UPDATE denied`, status: 'passed' },
        { name: `denied JDBC operations did not mutate wildcard probe ${schema}`, status: 'passed' },
      ]),
    ],
  };
  writeFileSync(fixtureReportPath, json(fixtureReport), { mode: 0o600 });
  const imagePath = join(workspace, '.artifacts/unit-images/report.json');
  const packageReceipt = { path: '.artifacts/unit-package/report.json', sha256: 'b'.repeat(64) };
  mkdirSync(dirname(imagePath), { recursive: true });
  writeFileSync(imagePath, json({ packageReceipt }));
  const deploymentInput = join(base, 'backend-runtime-r1/deployment-input.private.json');
  mkdirSync(dirname(deploymentInput), { mode: 0o700 });
  const deployment = {
    services, auxiliaryContainers,
    imageReceipt: { path: relative(workspace, imagePath), sha256: hash(readFileSync(imagePath)) },
  };
  writeFileSync(deploymentInput, json(deployment), { mode: 0o600 });
  const schemaReports = {};
  for (const [role, identity, contract, status, flag] of [
    ['workflow', workflowIdentity(runId), 'run-owned-workflow-engine-schema-v1',
      'passed-owned-exact-library-workflow-schema-only', 'workflowSchemaVerified'],
    ['ebsx', ebsxIdentity(runId), 'run-owned-model-ebsx-schema-v1',
      'passed-owned-model-ebsx-schema-only', 'ebsxSchemaVerified'],
    ['platform', platformIdentity(runId), 'run-owned-native-platform-schema-v1',
      'passed-owned-native-platform-schema-only', 'platformSchemaVerified'],
  ]) {
    const path = join(base, `${role}-schema-unit/report.json`);
    const generatorPath = `scripts/bootstrap-owned-${role}-schema.mjs`;
    const configurationSha256 = hash(role);
    mkdirSync(dirname(path), { mode: 0o700 });
    const report = {
      contract, status, runId, identity, createdSchema: true, droppedBootstrapUser: true,
      sourceClosure: false, nativeAcceptance: false, permissionAcceptance: false, [flag]: true,
      errors: [], packageReceipt,
      generator: { path: generatorPath, sha256: hash(readFileSync(join(workspace, generatorPath))) },
      configuration: { path: relative(workspace, join(dirname(path), 'configuration.private.json')),
        bytes: 100, sha256: configurationSha256 },
      ...(role !== 'workflow' ? { workflowInput: schemaReports.workflow.binding } : {}),
      ...(role === 'platform' ? { ebsxInput: schemaReports.ebsx.binding } : {}),
    };
    writeFileSync(path, json(report), { mode: 0o600 });
    schemaReports[role] = {
      path, report,
      binding: { reportPath: relative(workspace, path), reportSha256: hash(json(report)), configurationSha256 },
    };
  }
  const startupPath = join(dirname(deploymentInput), 'report.json');
  const startup = {
    contract: 'run-owned-native-backend-startup-v1', runId,
    status: 'passed-owned-backend-http-transport-only', actualBackendStarted: true,
    retainedPeerIntegrityVerified: true, retainedOwned: true, nativeAcceptance: false,
    permissionAcceptance: false, errors: [],
    inputs: [{ path: relative(workspace, fixtureReportPath), sha256: hash(json(fixtureReport)) }],
    deploymentInput: { path: relative(workspace, deploymentInput), sha256: hash(json(deployment)) },
    workflowSchema: schemaReports.workflow.binding, ebsxSchema: schemaReports.ebsx.binding,
    platformSchema: schemaReports.platform.binding,
  };
  writeFileSync(startupPath, json(startup), { mode: 0o600 });
  const context = {
    base, manifest: input.manifest,
    resources,
    deployment,
    bindings: [
      { path: manifestPath, sha256: input.manifestSha256, bytes: Buffer.byteLength(json(input.manifest)) },
      { path: deploymentInput, sha256: hash(json(deployment)) },
      { path: imagePath, sha256: hash(readFileSync(imagePath)) },
      { path: resourcePath, sha256: hash(json(resources)) },
    ],
    witness: { kind: 'controlled-eight-peer-fixture-only', peers: Array.from({ length: 8 }, (_, id) => id) },
    guard() {
      guards++;
      options.onGuard?.(guards, context);
      return {
        containers: peerIds.map(Id => ({ Id })),
        network: { Id: context.resources.networkId, Containers: Object.fromEntries(peerIds.map(Id => [Id, {}])) },
        origins: {},
      };
    },
    close() { closed = true; },
  };
  const execute = (program, args, spec) => {
    calls.push({ program, args, spec });
    assert.equal(program, 'docker');
    assert.deepEqual(args.slice(0, 4), ['exec', '-i', context.resources.mysqlId, 'sh']);
    assert.ok(args.at(-1).includes('exec mysql --no-defaults '));
    const presenceProof = readOwnedUnicodeSchemaPresence({
      workspace, context, deploymentInput, read: path => readFileSync(path),
    });
    assertOwnedUnicodeMetadataSnapshotSQL(input.manifest, spec.input, presenceProof);
    assert.equal(spec.timeout, 60_000);
    assert.equal(spec.maxBuffer, 64 * 1024 * 1024);
    if (options.execute) return options.execute(calls.length, { context, workspace, input, spec });
    const rows = structuredClone(input.rows);
    options.mutateRows?.(calls.length, rows);
    return { status: 0, signal: null, stdout: rows.map(row => JSON.stringify(row)).join('\n') + '\n', stderr: '' };
  };
  const parameters = {
    workspace, runId, deploymentInput,
    label: 'controlled-r1', executeOwned: true, execute,
    contextFactory(args) {
      assert.equal(args.workspace, workspace);
      assert.equal(args.runId, runId);
      assert.equal(args.execute, execute);
      return context;
    },
    now: () => '2026-11-15T12:00:00.000Z',
  };
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  return { input, workspace, base, manifestPath, context, calls, parameters,
    startupPath, startup, schemaReports, deploymentInput,
    fixtureReportPath, fixtureReport,
    state: () => ({ guards, closed }) };
}

test('fixed query roster covers all ten arrays with real independent COUNT statements', () => {
  const { manifest } = fixture();
  const queries = ownedUnicodeMetadataQueries(manifest);
  assert.equal(queries.length, 22);
  assert.equal(new Set(queries.map(query => query.id)).size, 22);
  for (const name of [
    'schemas', 'tables', 'columns', 'indexes', 'characterSets', 'collations',
    'foreignKeys', 'triggers', 'views', 'routines',
  ]) {
    assert.ok(queries.some(query => query.id === `${name}.rows`));
    const count = queries.find(query => query.id === `${name}.count`);
    assert.match(count.statement, /JSON_OBJECT\('count',COUNT\(\*\)\)/);
    assert.match(count.statement, / FROM information_schema\./);
  }
  assert.ok(queries.find(query => query.id === 'columns.rows').statement.includes('c.GENERATION_EXPRESSION'));
  assert.ok(queries.find(query => query.id === 'columns.rows').statement.includes('c.COLUMN_DEFAULT'));
  assert.ok(queries.find(query => query.id === 'indexes.rows').statement.includes('s.SUB_PART'));
  const foreignKeys = queries.find(query => query.id === 'foreignKeys.rows').statement;
  assert.match(foreignKeys, /k\.TABLE_SCHEMA IN .* OR k\.REFERENCED_TABLE_SCHEMA IN/);
  const viewsCount = queries.find(query => query.id === 'views.count').statement;
  assert.match(viewsCount, /information_schema.TABLES/);
  assert.match(viewsCount, /TABLE_TYPE='VIEW'/);
});

test('exact whitelist allows only the complete four-schema batch, not arbitrary readonly SQL', () => {
  const { manifest } = fixture();
  const statement = ownedUnicodeMetadataSnapshotSQL(manifest);
  assert.equal(assertOwnedUnicodeMetadataSnapshotSQL(manifest, statement), true);
  for (const query of [
    statement + `SELECT JSON_OBJECT('value',PASSWORD) FROM \`${manifest.schemas.uaa}\`.users;\n`,
    statement.replace(manifest.schemas.modelA, 'shared'),
    statement.replace('COUNT(*)', '0'),
    statement + 'ALTER DATABASE shared CHARACTER SET utf8mb4;\n',
    "SELECT JSON_OBJECT('value',1);\n",
    ownedUnicodeMetadataQueries(manifest)[0].statement,
  ]) assert.throws(() => assertOwnedUnicodeMetadataSnapshotSQL(manifest, query));
});

test('query batch reads metadata only and never business rows, object bodies or credentials', () => {
  const { manifest } = fixture();
  const statement = ownedUnicodeMetadataSnapshotSQL(manifest);
  assert.doesNotMatch(statement, /VIEW_DEFINITION|ROUTINE_DEFINITION|ACTION_STATEMENT|mysql\.user|GRANT|SHOW |CALL /i);
  assert.ok(statement.split('\n').filter(Boolean).every(line => line.startsWith('SELECT JSON_OBJECT(')));
  assert.ok(!statement.includes('FROM `' + manifest.schemas.modelA + '`'));
  assert.ok(statement.includes('@@SESSION.character_set_connection'));
  assert.ok(statement.includes('SCHEMA_NAME NOT IN'));
});

test('deployment-bound receipts allow exact topology/probe presences without broadening inventory scope', t => {
  const fixture = diskFixture(t);
  const readPaths = [];
  const proof = readOwnedUnicodeSchemaPresence({
    workspace: fixture.workspace, context: fixture.context, deploymentInput: fixture.deploymentInput,
    read(path) { readPaths.push(path); return readFileSync(path); },
  });
  assert.deepEqual(proof.additionalSchemas, [
    ebsxIdentity(runId).schema, platformIdentity(runId).schema, workflowIdentity(runId).schema,
  ]);
  assert.deepEqual(proof.wildcardProbes.schemas, [`nfx${runId}_model_a`, `nfx${runId}_model_b`]);
  assert.ok(!readPaths.some(path => path.endsWith('configuration.private.json')));
  assert.ok(!JSON.stringify(proof).includes('"password"'));
  const without = ownedUnicodeMetadataQueries(fixture.input.manifest);
  const withProof = ownedUnicodeMetadataQueries(fixture.input.manifest, proof);
  assert.notEqual(without[0].statement, withProof[0].statement);
  assert.deepEqual(without.slice(1), withProof.slice(1),
    'Only the non-target-presence COUNT may mention additional schema names');
  for (const name of [...proof.additionalSchemas, ...proof.wildcardProbes.schemas]) {
    assert.ok(withProof[0].statement.includes(`'${name}'`));
    assert.ok(withProof.slice(1).every(query => !query.statement.includes(`'${name}'`)));
  }
  const metadata = parseOwnedUnicodeMetadataSnapshot({
    ...fixture.input, observedAt: '2026-11-15T12:00:00.000Z', presenceProof: proof,
  });
  assert.equal(metadata.schemas.length, 4);
  assert.deepEqual(metadata.topologySchemaPresence.additionalSchemas, proof.additionalSchemas);
  const forged = structuredClone(proof);
  forged.additionalSchemas.push(`nf_${runId}_shadow`);
  assert.throws(() => ownedUnicodeMetadataQueries(fixture.input.manifest, forged),
    /three exact source-defined owned schema identities/);
});

test('wildcard probe presence requires the startup-bound created/denied/unchanged SQL fixture receipt', t => {
  for (const mutation of [
    report => { report.ownedGrantWildcardProbeSchemas.push(`nfx${runId}_model_c`); },
    report => { report.ownedGrantWildcardProbeSchemas[0] = 'nfxabcdef123456_model_a'; },
    report => { report.ownedMysqlId = 'f'.repeat(64); },
    report => { report.outputs['owned-resources.json'].sha256 = '0'.repeat(64); },
    report => { report.inputs.fixtureTools[0].sha256 = '0'.repeat(64); },
    report => { report.checks.at(-1).status = 'failed'; },
    report => { report.checks.at(-1).name = 'some other unchanged check'; },
  ]) {
    const fixture = diskFixture(t);
    mutation(fixture.fixtureReport);
    writeFileSync(fixture.fixtureReportPath, json(fixture.fixtureReport), { mode: 0o600 });
    fixture.startup.inputs[0].sha256 = hash(json(fixture.fixtureReport));
    writeFileSync(fixture.startupPath, json(fixture.startup), { mode: 0o600 });
    assert.throws(() => readOwnedUnicodeSchemaPresence({
      workspace: fixture.workspace, context: fixture.context, deploymentInput: fixture.deploymentInput,
      read: path => readFileSync(path),
    }));
  }
  const unbound = diskFixture(t);
  unbound.startup.inputs[0].sha256 = '0'.repeat(64);
  writeFileSync(unbound.startupPath, json(unbound.startup), { mode: 0o600 });
  assert.throws(() => readOwnedUnicodeSchemaPresence({
    workspace: unbound.workspace, context: unbound.context, deploymentInput: unbound.deploymentInput,
    read: path => readFileSync(path),
  }), /SQL fixture report must bind/);
});

test('new probe allowlist never subtracts two from historical or unknown extra-schema counts', t => {
  const fixture = diskFixture(t);
  const presenceProof = readOwnedUnicodeSchemaPresence({
    workspace: fixture.workspace, context: fixture.context, deploymentInput: fixture.deploymentInput,
    read: path => readFileSync(path),
  });
  for (const count of [1, 2, 3]) {
    const rows = structuredClone(fixture.input.rows);
    rows[0].row.count = count;
    assert.throws(() => parseOwnedUnicodeMetadataSnapshot({
      ...fixture.input, rows, presenceProof, observedAt: '2026-11-15T12:00:00.000Z',
    }), /Unexpected non-system schema/);
  }
});

test('schema presence proof requires current deployment/startup/report/package/identity links', t => {
  for (const mutation of [
    fixture => { fixture.startup.deploymentInput.sha256 = '0'.repeat(64); },
    fixture => { fixture.startup.runId = 'abcdef123456'; },
    fixture => { fixture.startup.retainedOwned = false; },
    fixture => { delete fixture.startup.platformSchema; },
  ]) {
    const fixture = diskFixture(t);
    mutation(fixture);
    writeFileSync(fixture.startupPath, json(fixture.startup), { mode: 0o600 });
    assert.throws(() => readOwnedUnicodeSchemaPresence({
      workspace: fixture.workspace, context: fixture.context, deploymentInput: fixture.deploymentInput,
      read: path => readFileSync(path),
    }));
  }
  for (const mutation of [
    report => { report.runId = 'abcdef123456'; },
    report => { report.identity.schema = `nf_${runId}_shadow`; },
    report => { report.identity.url = 'jdbc:mysql://unrelated:3306/shared'; },
    report => { report.status = 'failed'; },
    report => { report.platformSchemaVerified = false; },
    report => { report.packageReceipt.sha256 = '0'.repeat(64); },
    report => { report.configuration.sha256 = '0'.repeat(64); },
    report => { report.generator.sha256 = '0'.repeat(64); },
  ]) {
    const fixture = diskFixture(t);
    const platform = fixture.schemaReports.platform;
    mutation(platform.report);
    writeFileSync(platform.path, json(platform.report), { mode: 0o600 });
    fixture.startup.platformSchema.reportSha256 = hash(json(platform.report));
    writeFileSync(fixture.startupPath, json(fixture.startup), { mode: 0o600 });
    assert.throws(() => readOwnedUnicodeSchemaPresence({
      workspace: fixture.workspace, context: fixture.context, deploymentInput: fixture.deploymentInput,
      read: path => readFileSync(path),
    }));
  }
});

test('structured inventory matches the planner contract without inventing counts or server values', () => {
  const input = fixture();
  const metadata = parse(input);
  assert.equal(metadata.contract, 'owned-native-unicode-inventory-v1');
  assert.equal(metadata.manifestSha256, input.manifestSha256);
  assert.equal(metadata.server.innodbLargePrefix, true);
  assert.equal(metadata.server.rawObservation.innodbLargePrefix, 1);
  assert.deepEqual(metadata.server.sqlModes, ['STRICT_TRANS_TABLES', 'NO_ENGINE_SUBSTITUTION']);
  assert.equal(metadata.counts.columns, 1);
  assert.equal(metadata.columns[0].comment, "中文 😀 e\u0301 ' \\ \n");
  const plan = buildOwnedNativeUnicodePlan({
    runId, manifest: input.manifest, manifestSha256: input.manifestSha256, metadata,
  });
  assert.equal(plan.status, 'PLANNED-NOT-EXECUTED');
  assert.equal(plan.apiUnicodeVerified, false);
});

test('independent count mismatch, absent count and duplicate control rows are rejected', () => {
  for (const mutation of [
    rows => { rows.find(row => row.query === 'columns.count').row.count = 2; },
    rows => { rows.splice(rows.findIndex(row => row.query === 'columns.count'), 1); },
    rows => { rows.push(rows.find(row => row.query === 'server')); },
    rows => { rows.find(row => row.query === 'tables.count').row.count = '1'; },
  ]) {
    const input = fixture();
    mutation(input.rows);
    assert.throws(() => parse(input));
  }
});

test('missing/extra structured fields, unknown query wrappers and missing schema rows fail closed', () => {
  for (const mutation of [
    rows => { delete rows.find(row => row.query === 'columns.rows').row.default; },
    rows => { rows.find(row => row.query === 'columns.rows').row.businessValue = 'not allowed'; },
    rows => { rows[0].query = 'unknown'; },
    rows => { rows[0].unreviewed = true; },
    rows => { rows.splice(rows.findIndex(row => row.query === 'schemas.rows'), 1); },
  ]) {
    const input = fixture();
    mutation(input.rows);
    assert.throws(() => parse(input));
  }
});

test('unapproved external schema, external foreign-key owner/reference and trigger scopes are refused', () => {
  const foreignKey = (input, values) => {
    const database = input.manifest.schemas.modelA;
    const row = {
      database, table: 'owned', name: 'fk', column: 'ID', referencedDatabase: database,
      referencedTable: 'owned', referencedColumn: 'ID', position: 1, positionInUniqueConstraint: 1,
      ...values,
    };
    input.rows.push({ query: 'foreignKeys.rows', row });
    input.rows.find(wrapper => wrapper.query === 'foreignKeys.count').row.count = 1;
  };
  for (const values of [{ database: 'shared' }, { referencedDatabase: 'shared' }]) {
    const input = fixture();
    foreignKey(input, values);
    assert.throws(() => parse(input), /schema rejected/);
  }
  const other = fixture();
  other.rows[0].row.count = 1;
  assert.throws(() => parse(other), /Unexpected non-system schema/);
  const input = fixture();
  input.rows.push({
    query: 'triggers.rows',
    row: {
      database: input.manifest.schemas.modelA, name: 'trigger', table: 'owned',
      eventObjectSchema: input.manifest.schemas.modelB, eventManipulation: 'INSERT', actionTiming: 'BEFORE',
      actionOrientation: 'ROW', sqlMode: '', characterSetClient: 'utf8mb4',
      collationConnection: 'utf8mb4_general_ci', databaseCollation: 'utf8_general_ci',
    },
  });
  input.rows.find(row => row.query === 'triggers.count').row.count = 1;
  assert.throws(() => parse(input), /Cross-schema trigger/);
});

test('cross-owned foreign keys are retained for a blocked migration plan, not hidden from inventory', () => {
  const input = fixture();
  input.rows.push({
    query: 'foreignKeys.rows',
    row: {
      database: input.manifest.schemas.modelA, table: 'owned', name: 'fk', column: 'ID',
      referencedDatabase: input.manifest.schemas.modelB, referencedTable: 'other', referencedColumn: 'ID',
      position: 1, positionInUniqueConstraint: 1,
    },
  });
  input.rows.find(row => row.query === 'foreignKeys.count').row.count = 1;
  const metadata = parse(input);
  assert.equal(metadata.foreignKeys.length, 1);
  const plan = buildOwnedNativeUnicodePlan({
    runId, manifest: input.manifest, manifestSha256: input.manifestSha256, metadata,
  });
  assert.equal(plan.status, 'BLOCKED');
  assert.ok(plan.issues.some(issue => issue.code === 'FOREIGN-KEY-DEPENDENCY'));
});

test('server normalization does not guess booleans, rewrite case profile or misidentify vendors', () => {
  const input = fixture();
  input.rows.find(row => row.query === 'server').row.innodbLargePrefix = 'ON';
  assert.throws(() => parse(input), /numeric 0\/1/);
  const casing = fixture();
  casing.rows.find(row => row.query === 'server').row.lowerCaseTableNames = 1;
  const metadata = parse(casing);
  assert.equal(metadata.server.lowerCaseTableNames, 1);
  const plan = buildOwnedNativeUnicodePlan({
    runId, manifest: casing.manifest, manifestSha256: casing.manifestSha256, metadata,
  });
  assert.equal(plan.status, 'BLOCKED');
  const unknownVendor = fixture();
  unknownVendor.rows.find(row => row.query === 'server').row.versionComment = 'Unknown MySQL-compatible server';
  assert.equal(parse(unknownVendor).server.vendor, 'unsupported');
});

test('collector performs exactly two fixed metadata snapshots with source and resource guards', t => {
  const fixture = diskFixture(t);
  const result = collectOwnedUnicodeMetadata(fixture.parameters);
  assert.equal(result.report.status, 'COLLECTED-NOT-MIGRATED');
  assert.equal(result.report.doubleReadConsistent, true);
  assert.equal(fixture.calls.length, 2);
  assert.equal(fixture.state().guards, 6);
  assert.equal(fixture.state().closed, true);
  assert.equal(result.report.guards.every(guard => guard.status === 'PASSED'), true);
  assert.equal(result.report.queryHashes.length, 22);
  assert.equal(result.report.snapshots[0].comparableSha256, result.report.snapshots[1].comparableSha256);
  assert.equal(statSync(result.inventoryPath).mode & 0o777, 0o600);
  assert.equal(statSync(result.reportPath).mode & 0o777, 0o600);
  assert.equal(statSync(dirname(result.reportPath)).mode & 0o777, 0o700);
  const metadata = JSON.parse(readFileSync(result.inventoryPath, 'utf8'));
  assert.equal(metadata.manifestSha256, fixture.input.manifestSha256);
  assert.equal(hash(readFileSync(result.inventoryPath)), result.report.inventory.sha256);
  for (const flag of [
    'migrationExecuted', 'backupVerified', 'cloneRestoreVerified', 'dataPreservationVerified',
    'idempotenceVerified', 'apiUnicodeVerified', 'nativeAcceptance', 'fullAcceptance',
  ]) assert.equal(result.report[flag], false);
});

test('fresh timestamps may differ but no metadata, count or server field is ignored for consistency', t => {
  const fixture = diskFixture(t);
  let tick = 0;
  const result = collectOwnedUnicodeMetadata({
    ...fixture.parameters, now: () => new Date(1794744000000 + tick++).toISOString(),
  });
  assert.equal(result.report.doubleReadConsistent, true);
  const first = JSON.parse(readFileSync(result.report.snapshots[0].inventory.path, 'utf8'));
  const second = JSON.parse(readFileSync(result.report.snapshots[1].inventory.path, 'utf8'));
  assert.notEqual(first.observedAt, second.observedAt);
  const { observedAt: firstTime, ...firstMetadata } = first;
  const { observedAt: secondTime, ...secondMetadata } = second;
  assert.deepEqual(firstMetadata, secondMetadata);
});

test('metadata drift retains both observations and does not publish a stable inventory', t => {
  const fixture = diskFixture(t, {
    mutateRows(pass, rows) {
      if (pass === 2) rows.find(row => row.query === 'columns.rows').row.comment = 'different metadata';
    },
  });
  const result = collectOwnedUnicodeMetadata(fixture.parameters);
  assert.equal(result.report.status, 'FAILED-OWNED-METADATA-COLLECTION');
  assert.equal(result.report.failedStage, 'fresh-double-read-equality');
  assert.equal(result.report.doubleReadConsistent, false);
  assert.equal(result.inventoryPath, null);
  assert.equal(fixture.calls.length, 2);
  assert.ok(existsSync(join(dirname(result.reportPath), 'inventory.pass-1.private.json')));
  assert.ok(existsSync(join(dirname(result.reportPath), 'inventory.pass-2.private.json')));
  assert.ok(!existsSync(join(dirname(result.reportPath), 'inventory.private.json')));
});

test('pre-query resource failure prevents SQL and post-query failure retains private output', t => {
  const before = diskFixture(t, {
    onGuard(number) { if (number === 2) throw new Error('owned topology changed'); },
  });
  const failedBefore = collectOwnedUnicodeMetadata(before.parameters);
  assert.equal(failedBefore.report.status, 'FAILED-OWNED-METADATA-COLLECTION');
  assert.equal(before.calls.length, 0);
  assert.equal(before.state().closed, true);
  const after = diskFixture(t, {
    onGuard(number) { if (number === 3) throw new Error('owned topology changed'); },
  });
  const failedAfter = collectOwnedUnicodeMetadata(after.parameters);
  assert.equal(after.calls.length, 1);
  assert.equal(failedAfter.report.guards.at(-1).status, 'FAILED');
  assert.ok(failedAfter.report.snapshots[0].failureOutput);
  assert.equal(failedAfter.inventoryPath, null);
});

test('missing backend auxiliaries or an extra frontend/shared network peer is refused before SQL', t => {
  const missing = diskFixture(t);
  missing.context.deployment.auxiliaryContainers.pop();
  writeFileSync(missing.deploymentInput, json(missing.context.deployment), { mode: 0o600 });
  const changedHash = hash(json(missing.context.deployment));
  missing.context.bindings.find(binding => binding.path === missing.deploymentInput).sha256 = changedHash;
  missing.startup.deploymentInput.sha256 = changedHash;
  writeFileSync(missing.startupPath, json(missing.startup), { mode: 0o600 });
  const missingResult = collectOwnedUnicodeMetadata(missing.parameters);
  assert.equal(missingResult.report.status, 'FAILED-OWNED-METADATA-COLLECTION');
  assert.equal(missingResult.report.guards.at(-1).status, 'FAILED');
  assert.equal(missing.calls.length, 0);
  const extra = diskFixture(t);
  const originalGuard = extra.context.guard;
  extra.context.guard = () => {
    const live = originalGuard();
    live.network.Containers['f'.repeat(64)] = {};
    return live;
  };
  assert.equal(collectOwnedUnicodeMetadata(extra.parameters).report.status,
    'FAILED-OWNED-METADATA-COLLECTION');
  assert.equal(extra.calls.length, 0);
});

test('collector source or manifest drift fails the post-query guard without retrying elsewhere', t => {
  const fixture = diskFixture(t, {
    execute(pass, { input, workspace }) {
      writeFileSync(join(workspace, tools[0]), 'changed collector source');
      return { status: 0, signal: null, stdout: input.rows.map(row => JSON.stringify(row)).join('\n'), stderr: '' };
    },
  });
  const result = collectOwnedUnicodeMetadata(fixture.parameters);
  assert.equal(result.report.status, 'FAILED-OWNED-METADATA-COLLECTION');
  assert.equal(result.report.failedStage, 'snapshot-1-guard-after');
  assert.equal(fixture.calls.length, 1);
  assert.equal(result.inventoryPath, null);
});

test('a schema presence receipt cannot drift after it is bound to the running deployment', t => {
  const fixture = diskFixture(t, {
    execute(pass, { input, workspace }) {
      const path = join(workspace, '.artifacts/native-nonadmin-fixtures', runId,
        'platform-schema-unit/report.json');
      const report = JSON.parse(readFileSync(path, 'utf8'));
      report.unreviewedChange = true;
      writeFileSync(path, json(report), { mode: 0o600 });
      return { status: 0, signal: null, stdout: input.rows.map(row => JSON.stringify(row)).join('\n'), stderr: '' };
    },
  });
  const result = collectOwnedUnicodeMetadata(fixture.parameters);
  assert.equal(result.report.status, 'FAILED-OWNED-METADATA-COLLECTION');
  assert.equal(result.report.failedStage, 'snapshot-1-guard-after');
  assert.equal(fixture.calls.length, 1);
  assert.equal(result.inventoryPath, null);
});

test('process failure/throw still checks post-query resources and never invents empty metadata', t => {
  const failure = diskFixture(t, {
    execute() { return { status: 1, signal: null, stdout: '', stderr: 'private database diagnostic' }; },
  });
  const result = collectOwnedUnicodeMetadata(failure.parameters);
  assert.equal(result.report.status, 'FAILED-OWNED-METADATA-COLLECTION');
  assert.equal(failure.state().guards, 3);
  assert.equal(result.report.snapshots[0].queryAttempted, true);
  const errorOutput = JSON.parse(readFileSync(result.report.snapshots[0].failureOutput.path, 'utf8'));
  assert.equal(errorOutput.stderr, 'private database diagnostic');
  const thrown = diskFixture(t, { execute() { throw new Error('private executor failure'); } });
  const throwResult = collectOwnedUnicodeMetadata(thrown.parameters);
  assert.equal(throwResult.report.status, 'FAILED-OWNED-METADATA-COLLECTION');
  assert.equal(thrown.state().guards, 3);
  assert.equal(throwResult.report.failedStage, 'snapshot-1-guard-after-executor-error');
});

test('incomplete JSON or count mismatch is retained as failure, not accepted as an empty schema', t => {
  const malformed = diskFixture(t, {
    execute() { return { status: 0, signal: null, stdout: 'not-json\n', stderr: '' }; },
  });
  assert.equal(collectOwnedUnicodeMetadata(malformed.parameters).report.status,
    'FAILED-OWNED-METADATA-COLLECTION');
  const counts = diskFixture(t, {
    mutateRows(pass, rows) { rows.find(row => row.query === 'columns.count').row.count = 999; },
  });
  const result = collectOwnedUnicodeMetadata(counts.parameters);
  assert.equal(result.report.status, 'FAILED-OWNED-METADATA-COLLECTION');
  assert.equal(counts.calls.length, 1);
  assert.equal(result.inventoryPath, null);
});

test('private manifest, binding and exclusive output are mandatory', t => {
  const privateFixture = diskFixture(t);
  chmodSync(privateFixture.manifestPath, 0o644);
  const unsafe = collectOwnedUnicodeMetadata(privateFixture.parameters);
  assert.equal(unsafe.report.status, 'FAILED-OWNED-METADATA-COLLECTION');
  assert.equal(privateFixture.calls.length, 0);
  assert.equal(unsafe.reportPath, null);
  const bound = diskFixture(t);
  bound.context.bindings[0].sha256 = '0'.repeat(64);
  assert.equal(collectOwnedUnicodeMetadata(bound.parameters).report.status,
    'FAILED-OWNED-METADATA-COLLECTION');
  assert.equal(bound.calls.length, 0);
  const exclusive = diskFixture(t);
  const first = collectOwnedUnicodeMetadata(exclusive.parameters);
  const firstHash = hash(readFileSync(first.reportPath));
  const second = collectOwnedUnicodeMetadata(exclusive.parameters);
  assert.equal(second.report.status, 'FAILED-OWNED-METADATA-COLLECTION');
  assert.equal(exclusive.calls.length, 2);
  assert.equal(hash(readFileSync(first.reportPath)), firstHash);
});

test('late readonly-context close failure cannot publish an accepted inventory', t => {
  const fixture = diskFixture(t);
  fixture.context.close = () => { throw new Error('controlled close failure'); };
  const result = collectOwnedUnicodeMetadata(fixture.parameters);
  assert.equal(result.report.status, 'FAILED-OWNED-METADATA-COLLECTION');
  assert.equal(result.report.failedStage, 'close-readonly-context');
  assert.equal(result.report.doubleReadConsistent, false);
  assert.equal(result.inventoryPath, null);
  assert.ok(!existsSync(join(dirname(result.reportPath), 'inventory.private.json')));
});

test('execution flag and complete CLI arguments are required before creating any context', () => {
  let contextCalls = 0;
  assert.throws(() => collectOwnedUnicodeMetadata({
    executeOwned: false, contextFactory() { contextCalls++; },
  }), /Explicit owned metadata execution/);
  assert.equal(contextCalls, 0);
  for (const args of [[], ['--execute-owned'], ['--execute-owned', '--query=SELECT 1']]) {
    const result = spawnSync(process.execPath, [entrypoint, ...args], {
      encoding: 'utf8', timeout: 5000,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /no shared fallback or migration/);
  }
});

test('CLI summary is redacted and cannot be mistaken for migration or native acceptance', t => {
  const fixture = diskFixture(t);
  const outputs = [];
  const original = process.stdout.write;
  process.stdout.write = (value, ...rest) => {
    outputs.push(String(value));
    return true;
  };
  try {
    main([
      '--execute-owned', `--run-id=${runId}`, `--deployment-input=${fixture.parameters.deploymentInput}`,
      '--label=controlled-r1',
    ], fixture.parameters);
  } finally { process.stdout.write = original; }
  const summary = JSON.parse(outputs.join(''));
  assert.equal(summary.status, 'COLLECTED-NOT-MIGRATED');
  assert.equal(summary.collectionOnly, true);
  assert.equal(summary.migrationExecuted, false);
  assert.equal(summary.nativeAcceptance, false);
  assert.equal(summary.fullAcceptance, false);
  assert.ok(!outputs.join('').includes(fixture.input.manifest.schemas.modelA));
  assert.ok(!outputs.join('').includes('default'));
  assert.match(summary.reportSha256, /^[a-f0-9]{64}$/);
});
