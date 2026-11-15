#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { PinnedDirectories, readPinnedFile } from './native-candidate-files.mjs';
import { ownedNativeRuntimeContext } from './owned-native-runtime-context.mjs';
import { quoteMysql57Literal } from './owned-native-unicode-plan.mjs';
import { validateMatrixFixture } from './prepare-run-owned-native-nonadmin-matrix.mjs';
import { assertA01ReadOnlySQL } from './run-owned-a01-root-http.mjs';
import { workflowIdentity } from './bootstrap-owned-workflow-schema.mjs';
import { ebsxIdentity } from './bootstrap-owned-ebsx-schema.mjs';
import { platformIdentity } from './bootstrap-owned-platform-schema.mjs';
import { validateFixtureReceipt } from './provision-run-owned-native-application-accounts.mjs';

const workspaceRoot = fileURLToPath(new URL('../', import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const sorted = values => [...values].sort();
const inventoryArrays = [
  'schemas', 'tables', 'columns', 'indexes', 'characterSets', 'collations',
  'foreignKeys', 'triggers', 'views', 'routines',
];
const sourceFiles = [
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
const systemSchemas = ['information_schema', 'mysql', 'performance_schema', 'sys'];
const schemaProfiles = [
  {
    role: 'workflow', identity: workflowIdentity,
    contract: 'run-owned-workflow-engine-schema-v1',
    status: 'passed-owned-exact-library-workflow-schema-only', flag: 'workflowSchemaVerified',
  },
  {
    role: 'ebsx', identity: ebsxIdentity, contract: 'run-owned-model-ebsx-schema-v1',
    status: 'passed-owned-model-ebsx-schema-only', flag: 'ebsxSchemaVerified',
  },
  {
    role: 'platform', identity: platformIdentity, contract: 'run-owned-native-platform-schema-v1',
    status: 'passed-owned-native-platform-schema-only', flag: 'platformSchemaVerified',
  },
];
const fields = projection => projection.map(([name]) => name);
const projectionSQL = projection => projection.map(([name, expression]) =>
  `${quoteMysql57Literal(name, [])},${expression}`).join(',');

function extraPresenceSchemas(manifest, proof) {
  if (proof === undefined) return [];
  assert.equal(proof.contract, 'owned-native-unicode-schema-presence-proof-v1');
  assert.equal(proof.runId, manifest.runId);
  assert.deepEqual(proof.targetSchemas, sorted(Object.values(manifest.schemas)));
  const names = schemaProfiles.map(profile => profile.identity(manifest.runId).schema);
  assert.deepEqual(proof.additionalSchemas, sorted(names),
    'Presence proof may only allow the three exact source-defined owned schema identities');
  assert.match(proof.manifestSha256 ?? '', /^[a-f0-9]{64}$/);
  for (const binding of [proof.deployment, proof.backendStartup, proof.packageReceipt]) {
    assert.ok(binding && typeof binding.path === 'string' && binding.path);
    assert.match(binding.sha256 ?? '', /^[a-f0-9]{64}$/);
  }
  for (const profile of schemaProfiles) {
    const receipt = proof.receipts?.[profile.role];
    assert.deepEqual(receipt?.identity, profile.identity(manifest.runId));
    assert.match(receipt?.binding?.reportSha256 ?? '', /^[a-f0-9]{64}$/);
    assert.match(receipt?.binding?.configurationSha256 ?? '', /^[a-f0-9]{64}$/);
    assert.equal(typeof receipt?.binding?.reportPath, 'string');
  }
  const probes = ['a', 'b'].map(side => `nfx${manifest.runId}_model_${side}`);
  assert.deepEqual(proof.wildcardProbes?.schemas, probes,
    'Only the two exact receipt-created wildcard probes may be present');
  assert.equal(proof.wildcardProbes?.binding?.path,
    `.artifacts/native-nonadmin-fixtures/${manifest.runId}/isolated-sql-report.json`);
  assert.match(proof.wildcardProbes?.binding?.sha256 ?? '', /^[a-f0-9]{64}$/);
  assert.equal(proof.wildcardProbes?.manifestSha256, proof.manifestSha256);
  return [...names, ...probes];
}

export function readOwnedUnicodeSchemaPresence({
  workspace, context, deploymentInput, read,
}) {
  const { manifest } = context;
  validateMatrixFixture(manifest);
  workspace = resolve(workspace);
  const base = join(workspace, '.artifacts/native-nonadmin-fixtures', manifest.runId);
  const deploymentPath = resolve(workspace, deploymentInput);
  assert.equal(dirname(dirname(deploymentPath)), base);
  assert.equal(basename(deploymentPath), 'deployment-input.private.json');
  assert.match(basename(dirname(deploymentPath)), /^backend-runtime-[a-z0-9][a-z0-9-]{0,48}$/);
  const boundDeployment = context.bindings.find(binding => binding.path === deploymentPath);
  assert.ok(boundDeployment, 'Schema presence proof must bind the exact inspected deployment');
  const deploymentBytes = read(deploymentPath, true);
  assert.equal(hash(deploymentBytes), boundDeployment.sha256);
  assert.deepEqual(JSON.parse(deploymentBytes), context.deployment);
  const startupPath = join(dirname(deploymentPath), 'report.json');
  const startupBytes = read(startupPath, true);
  const startup = JSON.parse(startupBytes);
  assert.equal(startup.contract, 'run-owned-native-backend-startup-v1');
  assert.equal(startup.runId, manifest.runId);
  assert.equal(startup.status, 'passed-owned-backend-http-transport-only');
  assert.deepEqual(startup.errors, []);
  for (const flag of ['actualBackendStarted', 'retainedPeerIntegrityVerified', 'retainedOwned']) {
    assert.equal(startup[flag], true, 'Only the retained verified startup can attest extra schema presence');
  }
  for (const flag of ['nativeAcceptance', 'permissionAcceptance']) assert.equal(startup[flag], false);
  assert.deepEqual(startup.deploymentInput, {
    path: relative(workspace, deploymentPath), sha256: boundDeployment.sha256,
  });
  const manifestBinding = context.bindings.find(binding => binding.path === join(base, 'manifest.json'));
  const resourceBinding = context.bindings.find(binding => binding.path === join(base, 'owned-resources.json'));
  assert.ok(manifestBinding && resourceBinding, 'Fixture manifest and owned resources must be runtime-bound');
  const fixturePath = join(base, 'isolated-sql-report.json');
  const fixtureBytes = read(fixturePath, true);
  const fixtureSha256 = hash(fixtureBytes);
  assert.ok(startup.inputs?.some(input => input.path === relative(workspace, fixturePath)
    && input.sha256 === fixtureSha256), 'SQL fixture report must bind to this startup, not merely the run directory');
  const fixture = JSON.parse(fixtureBytes);
  validateFixtureReceipt(manifest, fixture, manifestBinding.sha256);
  assert.equal(fixture.ownedMysqlId, context.resources.mysqlId);
  assert.equal(fixture.ownedNetworkId, context.resources.networkId);
  assert.equal(fixture.mysqlImage, context.resources.mysqlImage);
  assert.equal(fixture.outputs['owned-resources.json']?.sha256, resourceBinding.sha256);
  const probeSchemas = ['a', 'b'].map(side => `nfx${manifest.runId}_model_${side}`);
  assert.deepEqual(fixture.ownedGrantWildcardProbeSchemas, probeSchemas,
    'No wildcard prefix or other probe schema may be adopted');
  const probeSourcePath = 'scripts/tests/run-owned-native-nonadmin-fixture.sql.mjs';
  const probeSourceSha256 = hash(read(join(workspace, probeSourcePath)));
  assert.ok(fixture.inputs?.fixtureTools?.some(input =>
    input.path === probeSourcePath && input.sha256 === probeSourceSha256));
  const probeChecks = [];
  for (const [index, schema] of probeSchemas.entries()) {
    const side = ['a', 'b'][index];
    for (const name of [
      `JDBC ${side} foreign lookalike SELECT denied`,
      `JDBC ${side} foreign lookalike UPDATE denied`,
      `denied JDBC operations did not mutate wildcard probe ${schema}`,
    ]) {
      const matches = fixture.checks.filter(check => check.name === name);
      assert.equal(matches.length, 1, 'Each exact wildcard-probe denial and unchanged check is required');
      assert.equal(matches[0].status, 'passed');
      probeChecks.push(name);
    }
  }
  const imagePath = resolve(workspace, context.deployment.imageReceipt.path);
  const imageBytes = read(imagePath);
  assert.equal(hash(imageBytes), context.deployment.imageReceipt.sha256);
  const images = JSON.parse(imageBytes);
  const packageReceipt = { path: images.packageReceipt.path, sha256: images.packageReceipt.sha256 };
  assert.equal(typeof packageReceipt.path, 'string');
  assert.match(packageReceipt.sha256 ?? '', /^[a-f0-9]{64}$/);
  const receipts = {};
  for (const profile of schemaProfiles) {
    const binding = startup[`${profile.role}Schema`];
    assert.deepEqual(Object.keys(binding ?? {}).sort(),
      ['configurationSha256', 'reportPath', 'reportSha256']);
    const path = resolve(workspace, binding.reportPath);
    assert.equal(dirname(dirname(path)), base);
    assert.equal(basename(path), 'report.json');
    assert.match(basename(dirname(path)),
      new RegExp(`^${profile.role}-schema-[a-z0-9][a-z0-9-]{0,48}$`));
    const bytes = read(path, true);
    assert.equal(hash(bytes), binding.reportSha256, 'Schema report differs from the deployment startup binding');
    const report = JSON.parse(bytes);
    assert.equal(report.contract, profile.contract);
    assert.equal(report.runId, manifest.runId);
    assert.equal(report.status, profile.status);
    assert.deepEqual(report.identity, profile.identity(manifest.runId),
      'Credentials-free schema/user/JDBC identity must exactly match its source-defined run');
    for (const flag of [profile.flag, 'createdSchema', 'droppedBootstrapUser']) assert.equal(report[flag], true);
    for (const flag of ['sourceClosure', 'nativeAcceptance', 'permissionAcceptance']) assert.equal(report[flag], false);
    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.packageReceipt, packageReceipt, 'Schema and running images must bind the same package');
    const generatorPath = `scripts/bootstrap-owned-${profile.role}-schema.mjs`;
    assert.deepEqual(report.generator, { path: generatorPath, sha256: hash(read(join(workspace, generatorPath))) });
    assert.equal(report.configuration.path,
      relative(workspace, join(dirname(path), 'configuration.private.json')));
    assert.equal(report.configuration.sha256, binding.configurationSha256);
    assert.match(report.configuration.sha256 ?? '', /^[a-f0-9]{64}$/);
    assert.ok(Number.isSafeInteger(report.configuration.bytes) && report.configuration.bytes > 0);
    if (profile.role !== 'workflow') assert.deepEqual(report.workflowInput, startup.workflowSchema);
    if (profile.role === 'platform') assert.deepEqual(report.ebsxInput, startup.ebsxSchema);
    receipts[profile.role] = { binding: structuredClone(binding), identity: structuredClone(report.identity) };
  }
  const proof = {
    contract: 'owned-native-unicode-schema-presence-proof-v1', runId: manifest.runId,
    manifestSha256: manifestBinding.sha256, targetSchemas: sorted(Object.values(manifest.schemas)),
    additionalSchemas: sorted(schemaProfiles.map(profile => profile.identity(manifest.runId).schema)),
    deployment: structuredClone(startup.deploymentInput),
    backendStartup: { path: relative(workspace, startupPath), sha256: hash(startupBytes) },
    packageReceipt, receipts,
    wildcardProbes: {
      schemas: probeSchemas, binding: { path: relative(workspace, fixturePath), sha256: fixtureSha256 },
      manifestSha256: manifestBinding.sha256, resourceSha256: resourceBinding.sha256,
      generator: { path: probeSourcePath, sha256: probeSourceSha256 }, checks: probeChecks,
    },
    boundary: 'Presence-only identities from deployment-bound schema and SQL fixture receipts. No extra schema columns, tables, data, credentials or migration permission are adopted.',
  };
  extraPresenceSchemas(manifest, proof);
  return proof;
}

// The only SQL is this complete deterministic batch. The existing A01
// SELECT-only predicate is supplementary, never authority for arbitrary SQL.
export function ownedUnicodeMetadataQueries(manifest, presenceProof) {
  validateMatrixFixture(manifest);
  const schemaNames = sorted(Object.values(manifest.schemas));
  const inSchemas = schemaNames.map(name => quoteMysql57Literal(name, [])).join(',');
  const allowed = [...schemaNames, ...extraPresenceSchemas(manifest, presenceProof), ...systemSchemas]
    .map(name => quoteMysql57Literal(name, [])).join(',');
  const queries = [];
  const query = (id, projection, from = '') => {
    const statement = `SELECT JSON_OBJECT('query',${quoteMysql57Literal(id, [])},`
      + `'row',JSON_OBJECT(${projectionSQL(projection)}))${from ? ` ${from}` : ''};`;
    assertA01ReadOnlySQL(statement);
    queries.push(Object.freeze({ id, statement, fields: Object.freeze(fields(projection)) }));
  };
  query('unapprovedSchemaCount', [['count', 'COUNT(*)']],
    `FROM information_schema.SCHEMATA WHERE SCHEMA_NAME NOT IN (${allowed})`);
  query('server', [
    ['version', '@@GLOBAL.version'], ['versionComment', '@@GLOBAL.version_comment'],
    ['innodbPageSize', '@@GLOBAL.innodb_page_size+0'],
    ['innodbLargePrefix', '@@GLOBAL.innodb_large_prefix+0'],
    ['innodbFileFormat', '@@GLOBAL.innodb_file_format'],
    ['innodbStrictMode', '@@GLOBAL.innodb_strict_mode+0'],
    ['lowerCaseTableNames', '@@GLOBAL.lower_case_table_names+0'],
    ['sqlModes', '@@SESSION.sql_mode'],
    ['characterSetClient', '@@SESSION.character_set_client'],
    ['characterSetConnection', '@@SESSION.character_set_connection'],
    ['characterSetResults', '@@SESSION.character_set_results'],
  ]);
  const array = (name, projection, from, order, countFrom = from) => {
    query(`${name}.rows`, projection, `${from} ORDER BY ${order}`);
    query(`${name}.count`, [['count', 'COUNT(*)']], countFrom);
  };
  array('schemas', [
    ['schema', 'SCHEMA_NAME'], ['charset', 'DEFAULT_CHARACTER_SET_NAME'],
    ['collation', 'DEFAULT_COLLATION_NAME'],
  ], `FROM information_schema.SCHEMATA WHERE SCHEMA_NAME IN (${inSchemas})`, 'BINARY SCHEMA_NAME');
  const baseTables = `FROM information_schema.TABLES t WHERE t.TABLE_SCHEMA IN (${inSchemas})`
    + " AND t.TABLE_TYPE='BASE TABLE'";
  array('tables', [
    ['database', 't.TABLE_SCHEMA'], ['table', 't.TABLE_NAME'], ['kind', 't.TABLE_TYPE'],
    ['engine', 't.ENGINE'], ['rowFormat', 't.ROW_FORMAT'], ['collation', 't.TABLE_COLLATION'],
    ['createOptions', 't.CREATE_OPTIONS'], ['comment', 't.TABLE_COMMENT'],
  ], baseTables, 'BINARY t.TABLE_SCHEMA,BINARY t.TABLE_NAME');
  const columns = 'FROM information_schema.COLUMNS c JOIN information_schema.TABLES t'
    + ' ON t.TABLE_SCHEMA=c.TABLE_SCHEMA AND t.TABLE_NAME=c.TABLE_NAME'
    + ` WHERE c.TABLE_SCHEMA IN (${inSchemas}) AND t.TABLE_TYPE='BASE TABLE'`;
  array('columns', [
    ['database', 'c.TABLE_SCHEMA'], ['table', 'c.TABLE_NAME'], ['column', 'c.COLUMN_NAME'],
    ['type', 'c.DATA_TYPE'], ['columnType', 'c.COLUMN_TYPE'], ['ordinal', 'c.ORDINAL_POSITION'],
    ['key', 'c.COLUMN_KEY'], ['nullable', 'c.IS_NULLABLE'], ['default', 'c.COLUMN_DEFAULT'],
    ['extra', 'c.EXTRA'], ['charset', 'c.CHARACTER_SET_NAME'], ['collation', 'c.COLLATION_NAME'],
    ['characterLength', 'c.CHARACTER_MAXIMUM_LENGTH'], ['octetLength', 'c.CHARACTER_OCTET_LENGTH'],
    ['comment', 'c.COLUMN_COMMENT'], ['generationExpression', 'c.GENERATION_EXPRESSION'],
  ], columns, 'BINARY c.TABLE_SCHEMA,BINARY c.TABLE_NAME,c.ORDINAL_POSITION');
  const indexes = 'FROM information_schema.STATISTICS s JOIN information_schema.TABLES t'
    + ' ON t.TABLE_SCHEMA=s.TABLE_SCHEMA AND t.TABLE_NAME=s.TABLE_NAME'
    + ` WHERE s.TABLE_SCHEMA IN (${inSchemas}) AND t.TABLE_TYPE='BASE TABLE'`;
  array('indexes', [
    ['database', 's.TABLE_SCHEMA'], ['table', 's.TABLE_NAME'], ['name', 's.INDEX_NAME'],
    ['position', 's.SEQ_IN_INDEX'], ['nonUnique', 's.NON_UNIQUE'], ['column', 's.COLUMN_NAME'],
    ['prefix', 's.SUB_PART'], ['type', 's.INDEX_TYPE'], ['collation', 's.COLLATION'],
    ['packed', 's.PACKED'], ['nullable', 's.NULLABLE'],
    ['comment', 's.COMMENT'], ['indexComment', 's.INDEX_COMMENT'],
  ], indexes, 'BINARY s.TABLE_SCHEMA,BINARY s.TABLE_NAME,BINARY s.INDEX_NAME,s.SEQ_IN_INDEX');
  array('characterSets', [
    ['name', 'CHARACTER_SET_NAME'], ['maxlen', 'MAXLEN'],
    ['defaultCollation', 'DEFAULT_COLLATE_NAME'], ['description', 'DESCRIPTION'],
  ], 'FROM information_schema.CHARACTER_SETS', 'BINARY CHARACTER_SET_NAME');
  array('collations', [
    ['name', 'COLLATION_NAME'], ['charset', 'CHARACTER_SET_NAME'], ['id', 'ID'],
    ['isDefault', 'IS_DEFAULT'], ['isCompiled', 'IS_COMPILED'], ['sortlen', 'SORTLEN'],
  ], 'FROM information_schema.COLLATIONS', 'BINARY COLLATION_NAME');
  const foreignKeys = 'FROM information_schema.KEY_COLUMN_USAGE k'
    + ' WHERE k.REFERENCED_TABLE_NAME IS NOT NULL'
    + ` AND (k.TABLE_SCHEMA IN (${inSchemas}) OR k.REFERENCED_TABLE_SCHEMA IN (${inSchemas}))`;
  array('foreignKeys', [
    ['database', 'k.TABLE_SCHEMA'], ['table', 'k.TABLE_NAME'], ['name', 'k.CONSTRAINT_NAME'],
    ['column', 'k.COLUMN_NAME'], ['referencedDatabase', 'k.REFERENCED_TABLE_SCHEMA'],
    ['referencedTable', 'k.REFERENCED_TABLE_NAME'], ['referencedColumn', 'k.REFERENCED_COLUMN_NAME'],
    ['position', 'k.ORDINAL_POSITION'], ['positionInUniqueConstraint', 'k.POSITION_IN_UNIQUE_CONSTRAINT'],
  ], foreignKeys, 'BINARY k.TABLE_SCHEMA,BINARY k.TABLE_NAME,BINARY k.CONSTRAINT_NAME,k.ORDINAL_POSITION');
  const triggers = 'FROM information_schema.TRIGGERS r'
    + ` WHERE r.TRIGGER_SCHEMA IN (${inSchemas}) OR r.EVENT_OBJECT_SCHEMA IN (${inSchemas})`;
  array('triggers', [
    ['database', 'r.TRIGGER_SCHEMA'], ['name', 'r.TRIGGER_NAME'], ['table', 'r.EVENT_OBJECT_TABLE'],
    ['eventObjectSchema', 'r.EVENT_OBJECT_SCHEMA'], ['eventManipulation', 'r.EVENT_MANIPULATION'],
    ['actionTiming', 'r.ACTION_TIMING'], ['actionOrientation', 'r.ACTION_ORIENTATION'],
    ['sqlMode', 'r.SQL_MODE'], ['characterSetClient', 'r.CHARACTER_SET_CLIENT'],
    ['collationConnection', 'r.COLLATION_CONNECTION'], ['databaseCollation', 'r.DATABASE_COLLATION'],
  ], triggers, 'BINARY r.TRIGGER_SCHEMA,BINARY r.TRIGGER_NAME');
  const views = `FROM information_schema.VIEWS v WHERE v.TABLE_SCHEMA IN (${inSchemas})`;
  array('views', [
    ['database', 'v.TABLE_SCHEMA'], ['name', 'v.TABLE_NAME'], ['checkOption', 'v.CHECK_OPTION'],
    ['isUpdatable', 'v.IS_UPDATABLE'], ['securityType', 'v.SECURITY_TYPE'],
    ['characterSetClient', 'v.CHARACTER_SET_CLIENT'], ['collationConnection', 'v.COLLATION_CONNECTION'],
  ], views, 'BINARY v.TABLE_SCHEMA,BINARY v.TABLE_NAME',
  `FROM information_schema.TABLES t WHERE t.TABLE_SCHEMA IN (${inSchemas}) AND t.TABLE_TYPE='VIEW'`);
  const routines = `FROM information_schema.ROUTINES r WHERE r.ROUTINE_SCHEMA IN (${inSchemas})`;
  array('routines', [
    ['database', 'r.ROUTINE_SCHEMA'], ['name', 'r.SPECIFIC_NAME'], ['routineType', 'r.ROUTINE_TYPE'],
    ['sqlDataAccess', 'r.SQL_DATA_ACCESS'], ['securityType', 'r.SECURITY_TYPE'],
    ['isDeterministic', 'r.IS_DETERMINISTIC'], ['sqlMode', 'r.SQL_MODE'],
    ['characterSetClient', 'r.CHARACTER_SET_CLIENT'], ['collationConnection', 'r.COLLATION_CONNECTION'],
    ['databaseCollation', 'r.DATABASE_COLLATION'],
  ], routines, 'BINARY r.ROUTINE_SCHEMA,BINARY r.SPECIFIC_NAME,BINARY r.ROUTINE_TYPE');
  return Object.freeze(queries);
}

export function ownedUnicodeMetadataSnapshotSQL(manifest, presenceProof) {
  return ownedUnicodeMetadataQueries(manifest, presenceProof).map(query => query.statement).join('\n') + '\n';
}

export function assertOwnedUnicodeMetadataSnapshotSQL(manifest, statement, presenceProof) {
  assertA01ReadOnlySQL(statement);
  assert.equal(statement, ownedUnicodeMetadataSnapshotSQL(manifest, presenceProof),
    'Only the exact manifest-bound information_schema/variable SELECT batch is allowed');
  return true;
}

function observedBoolean(value, name) {
  assert.ok(value === 0 || value === 1, `Observed ${name} must be numeric 0/1, not a guessed boolean`);
  return value === 1;
}

export function parseOwnedUnicodeMetadataSnapshot({
  manifest, manifestSha256, rows, observedAt, presenceProof,
}) {
  validateMatrixFixture(manifest);
  assert.match(manifestSha256 ?? '', /^[a-f0-9]{64}$/);
  assert.ok(typeof observedAt === 'string' && Number.isFinite(Date.parse(observedAt)));
  assert.ok(Array.isArray(rows) && rows.length > 0 && rows.length <= 200_000,
    'Bounded structured metadata rows required');
  const queries = ownedUnicodeMetadataQueries(manifest, presenceProof);
  const groups = new Map(queries.map(query => [query.id, []]));
  const queryMap = new Map(queries.map(query => [query.id, query]));
  for (const wrapper of rows) {
    assert.ok(wrapper && typeof wrapper === 'object' && !Array.isArray(wrapper));
    assert.deepEqual(Object.keys(wrapper).sort(), ['query', 'row']);
    assert.ok(groups.has(wrapper.query), 'Unexpected metadata query output');
    const query = queryMap.get(wrapper.query);
    assert.ok(wrapper.row && typeof wrapper.row === 'object' && !Array.isArray(wrapper.row));
    assert.deepEqual(Object.keys(wrapper.row).sort(), [...query.fields].sort(),
      'Metadata projection is incomplete or includes an unreviewed field');
    groups.get(wrapper.query).push(wrapper.row);
  }
  const one = id => {
    assert.equal(groups.get(id).length, 1, 'Exactly one control/count row is required');
    return groups.get(id)[0];
  };
  const count = id => {
    const value = one(id).count;
    assert.ok(Number.isSafeInteger(value) && value >= 0, 'Independent count must be a nonnegative safe integer');
    return value;
  };
  assert.equal(count('unapprovedSchemaCount'), 0,
    'Unexpected non-system schema prevents a bounded dependency audit');
  const rawServer = one('server');
  assert.equal(typeof rawServer.sqlModes, 'string');
  const sqlModes = rawServer.sqlModes ? rawServer.sqlModes.split(',') : [];
  assert.equal(new Set(sqlModes).size, sqlModes.length, 'SQL mode list is ambiguous');
  const vendor = [
    'MySQL Community Server (GPL)', 'MySQL Community Server - GPL',
    'MySQL Enterprise Server - Commercial',
  ].includes(rawServer.versionComment) ? 'mysql' : 'unsupported';
  const metadata = {
    contract: 'owned-native-unicode-inventory-v1',
    runId: manifest.runId, manifestSha256, observedAt,
    coverage: {
      schemas: 'manifest-exact', tables: 'all-base-tables', columns: 'all-columns',
      indexes: 'all-index-parts', dependencies: 'all-touching-selected-schemas',
      collations: 'server-catalog',
    },
    server: {
      ...rawServer, vendor, sqlModes,
      innodbLargePrefix: observedBoolean(rawServer.innodbLargePrefix, 'innodbLargePrefix'),
      innodbStrictMode: observedBoolean(rawServer.innodbStrictMode, 'innodbStrictMode'),
      rawObservation: structuredClone(rawServer),
    },
    counts: {},
    ...(presenceProof ? { topologySchemaPresence: structuredClone(presenceProof) } : {}),
  };
  if (presenceProof) assert.equal(presenceProof.manifestSha256, manifestSha256);
  const schemas = new Set(Object.values(manifest.schemas));
  for (const name of inventoryArrays) {
    metadata[name] = groups.get(`${name}.rows`);
    metadata.counts[name] = count(`${name}.count`);
    assert.equal(metadata[name].length, metadata.counts[name],
      'Projected metadata row count differs from an independent COUNT');
    for (const row of metadata[name]) {
      if (name === 'schemas') assert.ok(schemas.has(row.schema), 'Non-owned schema rejected');
      else if (!['characterSets', 'collations'].includes(name)) {
        assert.ok(schemas.has(row.database), 'Non-target dependency schema rejected');
      }
      if (name === 'foreignKeys') {
        assert.ok(schemas.has(row.referencedDatabase), 'Non-target referenced schema rejected');
      }
      if (name === 'triggers') {
        assert.equal(row.eventObjectSchema, row.database, 'Cross-schema trigger ownership rejected');
      }
    }
  }
  assert.deepEqual(sorted(metadata.schemas.map(row => row.schema)), sorted(schemas),
    'Every exact manifest schema is required');
  return metadata;
}

function comparableInventory(metadata) {
  const { observedAt, ...stable } = metadata;
  return stable;
}

export function collectOwnedUnicodeMetadata({
  workspace = workspaceRoot, runId, deploymentInput, label, executeOwned = false,
  contextFactory = ownedNativeRuntimeContext, execute = spawnSync,
  now = () => new Date().toISOString(),
} = {}) {
  assert.equal(executeOwned, true, 'Explicit owned metadata execution is required');
  assert.match(runId ?? '', /^[a-f0-9]{12}$/);
  assert.match(label ?? '', /^[a-z0-9][a-z0-9-]{0,48}$/);
  assert.equal(typeof deploymentInput, 'string');
  workspace = resolve(workspace);
  const directories = new PinnedDirectories();
  const bindings = [];
  let context;
  let contextCloseAttempted = false;
  let output;
  let stage = 'owned-runtime-context';
  const report = {
    contract: 'owned-native-unicode-metadata-collection-v1',
    runId, status: 'RUNNING', collectionOnly: true, queriesAreSelectOnly: true,
    doubleReadConsistent: false, migrationExecuted: false, backupVerified: false,
    cloneRestoreVerified: false, dataPreservationVerified: false, idempotenceVerified: false,
    apiUnicodeVerified: false, nativeAcceptance: false, fullAcceptance: false,
    guards: [], snapshots: [],
    boundary: 'Read-only structural metadata and server-variable collection. No business row values, DDL, backup, restore, migration or API request.',
    dependencyBoundary: 'All foreign keys touching selected schemas; all selected-schema triggers/views/routines. Only deployment-bound Workflow/EBSX/Platform and exact SQL-fixture wildcard-probe presence may exist beyond those targets. Unknown external schemas and references remain refused. Program bodies, extra-schema inventories and business values are not read or semantically inferred.',
  };
  const write = (name, value) => {
    const bytes = json(value);
    directories.write(output, name, bytes);
    return { path: join(output.path, name), sha256: hash(bytes), bytes: Buffer.byteLength(bytes) };
  };
  const bind = (path, privateInput = false) => {
    const parent = directories.open(dirname(path));
    const file = readPinnedFile(directories, parent, basename(path));
    if (privateInput) {
      assert.equal(file.identity.uid, process.geteuid());
      assert.equal(file.identity.mode & 0o077, 0, 'Raw manifest must remain private');
    }
    const binding = { path, parent, name: basename(path), sha256: hash(file.data), privateInput };
    bindings.push(binding);
    return file.data;
  };
  const guard = purpose => {
    const evidence = { purpose, startedAt: now(), status: 'RUNNING' };
    report.guards.push(evidence);
    try {
      const live = context.guard();
      assert.deepEqual(Object.keys(context.deployment.services).sort(),
        ['allinone', 'gateway', 'provider', 'uaa']);
      assert.deepEqual(context.deployment.auxiliaryContainers.map(peer => peer.role).sort(),
        ['nacos', 'redis', 'zookeeper'], 'Only the exact eight-node backend topology is eligible');
      const peerIds = [
        context.resources.mysqlId, ...Object.values(context.deployment.services).map(peer => peer.containerId),
        ...context.deployment.auxiliaryContainers.map(peer => peer.containerId),
      ].sort();
      assert.equal(peerIds.length, 8);
      assert.equal(new Set(peerIds).size, 8);
      assert.deepEqual(live.containers.map(peer => peer.Id).sort(), peerIds);
      assert.equal(live.network.Id, context.resources.networkId);
      assert.deepEqual(Object.keys(live.network.Containers).sort(), peerIds,
        'Extra frontend/shared peers are not authorized for metadata collection');
      for (const binding of bindings) {
        const file = readPinnedFile(directories, binding.parent, binding.name);
        assert.equal(hash(file.data), binding.sha256, 'Collector/manifest source drift');
        if (binding.privateInput) {
          assert.equal(file.identity.uid, process.geteuid());
          assert.equal(file.identity.mode & 0o077, 0);
        }
      }
      Object.assign(evidence, {
        observedAt: now(), status: 'PASSED', topologySha256: hash(JSON.stringify(context.witness)),
      });
      return live;
    } catch (error) {
      Object.assign(evidence, { completedAt: now(), status: 'FAILED' });
      throw error;
    }
  };
  const closeContext = () => {
    if (!context || contextCloseAttempted) return;
    contextCloseAttempted = true;
    context.close();
    report.readonlyContextClosed = true;
  };
  try {
    context = contextFactory({ workspace, runId, deploymentInput, execute });
    validateMatrixFixture(context.manifest);
    assert.equal(context.manifest.runId, runId);
    const base = join(workspace, '.artifacts/native-nonadmin-fixtures', runId);
    assert.equal(context.base, base, 'Context must retain the exact owned artifact base');
    const manifestBytes = bind(join(base, 'manifest.json'), true);
    assert.deepEqual(JSON.parse(manifestBytes), context.manifest, 'Context and pinned manifest differ');
    const manifestSha256 = hash(manifestBytes);
    assert.ok(context.bindings.some(binding => binding.path === join(base, 'manifest.json')
      && binding.sha256 === manifestSha256), 'Runtime context must bind this exact manifest');
    for (const path of sourceFiles) bind(join(workspace, path));
    stage = 'deployment-bound-extra-schema-presence';
    const presenceProof = readOwnedUnicodeSchemaPresence({
      workspace, context, deploymentInput, read: bind,
    });
    assert.equal(presenceProof.manifestSha256, manifestSha256);
    guard('before-private-output');
    output = directories.open(join(base, `unicode-metadata-${label}`), { create: true, exclusive: true });
    report.startedAt = now();
    report.inputs = [
      ...context.bindings,
      ...bindings.map(({ parent, name, privateInput, ...binding }) => binding),
    ];
    report.resourceIdentity = {
      mysqlId: context.resources.mysqlId, mysqlImage: context.resources.mysqlImage,
      networkId: context.resources.networkId, topologySha256: hash(JSON.stringify(context.witness)),
    };
    report.topologySchemaPresence = presenceProof;
    const queries = ownedUnicodeMetadataQueries(context.manifest, presenceProof);
    const statement = ownedUnicodeMetadataSnapshotSQL(context.manifest, presenceProof);
    assertOwnedUnicodeMetadataSnapshotSQL(context.manifest, statement, presenceProof);
    report.queryBatchSha256 = hash(statement);
    report.queryHashes = queries.map(query => ({
      id: query.id, sha256: hash(query.statement), bytes: Buffer.byteLength(query.statement),
    }));
    report.queryBatchEvidence = write('queries.private.json', {
      statement, queries, allowedSchemas: Object.values(context.manifest.schemas),
      presenceOnlySchemas: [...presenceProof.additionalSchemas, ...presenceProof.wildcardProbes.schemas],
      systemSchemas,
    });
    const inventories = [];
    for (const pass of [1, 2]) {
      stage = `snapshot-${pass}-guard-before`;
      guard(stage);
      const observation = { pass, queryAttempted: false, status: 'RUNNING', startedAt: now() };
      report.snapshots.push(observation);
      observation.intent = write(`snapshot-${pass}-intent.private.json`, {
        pass, queryBatchSha256: hash(statement), queryHashes: report.queryHashes,
        runId, manifestSha256, startedAt: observation.startedAt,
      });
      stage = `snapshot-${pass}-readonly-query`;
      assertOwnedUnicodeMetadataSnapshotSQL(context.manifest, statement, presenceProof);
      observation.queryAttempted = true;
      let result;
      try {
        result = execute('docker', [
          'exec', '-i', context.resources.mysqlId, 'sh', '-c',
          'test -n "$MYSQL_ROOT_PASSWORD" && MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql --no-defaults -h127.0.0.1 --protocol=TCP -uroot --default-character-set=utf8mb4 --batch --raw --skip-column-names',
        ], { input: statement, encoding: 'utf8', timeout: 60_000, maxBuffer: 64 * 1024 * 1024 });
      } catch (error) {
        observation.result = write(`snapshot-${pass}-result.private.json`, {
          queryBatchSha256: hash(statement), status: null, errorKind: 'executor-threw',
        });
        observation.status = 'FAILED';
        stage = `snapshot-${pass}-guard-after-executor-error`;
        guard(stage);
        throw error;
      }
      observation.result = write(`snapshot-${pass}-result.private.json`, {
        queryBatchSha256: hash(statement), status: result.status, signal: result.signal,
        errorKind: result.error ? 'process-error' : null,
        stdoutSha256: hash(result.stdout ?? ''), stderrSha256: hash(result.stderr ?? ''),
        stdoutBytes: Buffer.byteLength(result.stdout ?? ''),
      });
      try {
        stage = `snapshot-${pass}-guard-after`;
        guard(stage);
        assert.ok(result.status === 0 && !result.error && !result.signal,
          'Owned metadata SELECT failed; raw diagnostics remain private');
        const lines = result.stdout.trim().split('\n').filter(Boolean);
        assert.ok(lines.length > 0 && lines.length <= 200_000);
        stage = `snapshot-${pass}-structured-verification`;
        const inventory = parseOwnedUnicodeMetadataSnapshot({
          manifest: context.manifest, manifestSha256,
          rows: lines.map(line => JSON.parse(line)), observedAt: now(), presenceProof,
        });
        observation.inventory = write(`inventory.pass-${pass}.private.json`, inventory);
        observation.comparableSha256 = hash(json(comparableInventory(inventory)));
        inventories.push(inventory);
        observation.status = 'COLLECTED-NOT-MIGRATED';
        observation.completedAt = now();
      } catch (error) {
        observation.failureOutput = write(`snapshot-${pass}-failure-output.private.json`, {
          stdout: result.stdout ?? '', stderr: result.stderr ?? '',
        });
        observation.status = 'FAILED';
        throw error;
      }
    }
    stage = 'fresh-double-read-equality';
    assert.deepEqual(comparableInventory(inventories[1]), comparableInventory(inventories[0]),
      'Fresh metadata SELECT passes differ; no stable inventory is published');
    stage = 'final-resource-and-source-guard';
    guard(stage);
    stage = 'close-readonly-context';
    closeContext();
    report.doubleReadConsistent = true;
    report.inventory = write('inventory.private.json', inventories[1]);
    report.counts = inventories[1].counts;
    report.status = 'COLLECTED-NOT-MIGRATED';
    report.completedAt = now();
    report.stage = 'complete';
  } catch (error) {
    report.status = 'FAILED-OWNED-METADATA-COLLECTION';
    report.doubleReadConsistent = false;
    report.failedStage = stage;
    report.errorKind = error?.code === 'ERR_ASSERTION' ? 'assertion-failed' : 'operation-failed';
  } finally {
    try {
      try { closeContext(); }
      catch {
        report.status = 'FAILED-OWNED-METADATA-COLLECTION';
        report.doubleReadConsistent = false;
        report.failedStage = 'close-readonly-context';
        report.errorKind = 'context-close-failed';
      }
      if (output) report.receipt = write('report.private.json', report);
    } finally { directories.close(); }
  }
  return {
    report,
    reportPath: output ? join(output.path, 'report.private.json') : null,
    inventoryPath: report.status === 'COLLECTED-NOT-MIGRATED'
      ? join(output.path, 'inventory.private.json') : null,
  };
}

export function main(argv = process.argv.slice(2), options = {}) {
  const { values } = parseArgs({
    args: argv, allowPositionals: false,
    options: {
      'execute-owned': { type: 'boolean' }, 'run-id': { type: 'string' },
      'deployment-input': { type: 'string' }, label: { type: 'string' },
    },
  });
  const result = collectOwnedUnicodeMetadata({
    ...options, executeOwned: values['execute-owned'], runId: values['run-id'],
    deploymentInput: values['deployment-input'], label: values.label,
  });
  const summary = {
    status: result.report.status, collectionOnly: true,
    doubleReadConsistent: result.report.doubleReadConsistent,
    counts: result.report.counts ?? null, migrationExecuted: false, nativeAcceptance: false,
    fullAcceptance: false, inventorySha256: result.report.inventory?.sha256 ?? null,
    reportSha256: result.report.receipt?.sha256 ?? null,
  };
  process.stdout.write(json(summary));
  if (summary.status !== 'COLLECTED-NOT-MIGRATED') process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try { main(); }
  catch {
    process.stderr.write('Owned Unicode metadata collection refused; no shared fallback or migration.\n');
    process.exitCode = 1;
  }
}
