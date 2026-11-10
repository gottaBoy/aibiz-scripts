#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { constants, closeSync, lstatSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  createFixture, encodeFixturePassword, ownershipLabel, preflightOwnedMysql, validateOwnedTarget,
  writeFixtureCandidate,
} from '../prepare-run-owned-native-nonadmin-fixture.mjs';
import {
  mysqlFixtureArgs, mysqlFixtureNetworkArgs, mysqlFixtureProfile, mysqlFixtureReadyProcess,
  verifyMysqlFixtureState, verifyMysqlFixtureStorage,
  verifySelectedMysqlStorage,
} from '../mysql-fixture-profiles.mjs';
import {
  OWNED_VOLUME_PROFILE, ownedMysqlVolumePlan, createOwnedMysqlVolume, initializeOwnedMysqlVolume,
  inspectMysqlFixtureVolumes, removeOwnedMysqlVolume,
  inspectOwnedMysqlDiskBacking,
} from '../owned-mysql-volume.mjs';
import { PinnedDirectories, readPinnedFile } from '../native-candidate-files.mjs';
import { uaaSchemaTableSQL } from '../uaa-fixture-schema.mjs';
import { createModelSchemaPlan } from '../model-fixture-schema.mjs';

const workspace = fileURLToPath(new URL('../../', import.meta.url));
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const modelDump = 'modelingservice/sql/sCloud9471c1eca.sql';
export const modelSchemaTables = {
  metadata: [
    't_srfpsdevcenter', 't_srfpsdevuserobj', 't_srfpsdevuser',
    't_srfpsdevsln', 't_srfpssysmodelinst', 't_srfpsdevslnsys', 't_srfpsdevslnuser',
    't_srfpsdevcentersvn', 't_srfpsdcmodeltempl', 't_srfpsdevslntempl',
    't_srfpsdcdeploycenter',
  ],
  physicalModel: [],
};
const modelSchemeRoot = join(workspace,
  'vendor-upstream/ibizmodeling-standard/modelapi-core/src/main/resources/model/net/ibizsys/modeling/PSSYSDBSCHEMES');
const modelSchemaSources = ['DEFAULT', 'DB2', 'DB3'].map(link => {
  const path = relative(workspace, join(modelSchemeRoot, `${link}.json`));
  const bytes = readFileSync(join(workspace, path));
  return { link, path, sha256: hash(bytes), model: JSON.parse(bytes) };
});
modelSchemaTables.metadata = [...new Set(modelSchemaSources.filter(source => source.link !== 'DB2')
  .flatMap(({ model }) => model.getAllPSSysDBTables.map(table => table.name.toLowerCase())))].sort();
modelSchemaTables.physicalModel = [...new Set(modelSchemaSources.flatMap(({ model }) =>
  model.getAllPSSysDBTables.map(table => table.name.toLowerCase())))].sort();
const modelTables = Object.values(modelSchemaTables).flat();
let cachedDump;
let cachedSchemaPlan;
function schemaPlan(dump) {
  if (dump !== cachedDump) {
    cachedSchemaPlan = createModelSchemaPlan(dump, modelSchemaSources);
    cachedDump = dump;
  }
  return cachedSchemaPlan;
}
const uaaCommonTables = ['sys_organization', 'sys_department', 'sys_person',
  'sys_organizational_role', 'sys_role_member', 'sys_member'];
const uaaLegacyTables = ['ibzcenter', 'ibzdcsystem', 'ibzrole', 'ibzrole_permission',
  'ibzpermission', 'ibzentity', 'ibzpermissionaction', ...uaaCommonTables];
const uaaStandaloneTables = ['sys_domain', 'sys_organization', 'sys_department',
  'sys_deploy_system', 'sys_role', 'sys_person', 'sys_organizational_role',
  'sys_role_member', 'sys_member', 'sys_granted_authority'];
// The maintained UAA runtime reads this source-backed table during login even
// though it is outside the current eighteen-table fixture model.
const uaaSupplementalTables = ['open_access_provider'];
const uaaViews = {
  sys_domain: ['ibzcenter'],
  sys_deploy_system: ['ibzdcsystem'],
  sys_role: ['ibzrole'],
  sys_granted_authority: ['ibzrole_permission', 'ibzpermission', 'ibzentity', 'ibzpermissionaction'],
};
export const publishedQueries = [
  ['DevCenter', 'PSDevUser', 'metadata', 6],
  ['DevCenter', 'PSDevUserObj', 'metadata', 6],
  ['SysDesign', 'PSDevSlnSys', 'metadata', 2],
  ['SysDesign', 'PSDevSlnUser', 'metadata', 4],
  ['SysDesign', 'PSModule', 'physicalModel', 1],
].map(([module, entity, target, expectedRows]) => ({
  entity, target, expectedRows,
  path: `PSMODULES/${module}/PSDATAENTITIES/${entity}/PSDEDATAQUERIES/Default/PSDEDQCODES/MYSQL5.json`,
}));
const publishedRoot = 'vendor-upstream/ibizmodeling-standard/modelapi-core/src/main/resources/model/net/ibizsys/modeling';

function executeDocker(args, { input, env, allowFailure = false } = {}) {
  const result = spawnSync('docker', args, {
    input, env: { ...process.env, ...env }, encoding: 'utf8',
    timeout: 90_000, maxBuffer: 4 * 1024 * 1024,
  });
  if (!allowFailure) {
    assert.ok(!result.error && result.status === 0, `Docker ${args[0]} failed (credential-bearing output suppressed)`);
  }
  return result;
}

function privateFile(path, contents) {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    writeFileSync(fd, contents);
  } finally {
    closeSync(fd);
  }
}

export function extractModelDDL(dump, table) {
  assert.ok(modelTables.includes(table), 'Only the declared model table allowlist is supported');
  const planned = schemaPlan(dump).tables.find(row => row.name === table);
  if (planned) return planned.ddl;
  const start = dump.indexOf(`CREATE TABLE \`${table}\` (`);
  assert.ok(start >= 0, `Missing model dump DDL: ${table}`);
  const end = dump.indexOf('\n) ENGINE=', start);
  assert.ok(end > start, 'Unsupported mysqldump CREATE TABLE format');
  const terminate = dump.indexOf(';', end);
  assert.ok(terminate > end);
  const ddl = dump.slice(start, terminate + 1);
  assert.doesNotMatch(ddl, /\n(?:INSERT|DROP|UPDATE|DELETE|LOCK|UNLOCK)\s/i);
  assert.match(ddl, /ENGINE=InnoDB/);
  return ddl;
}

export function createSchemaBootstrap(manifest, uaaDDL, dump) {
  const schemaGroups = [
    [manifest.schemas.metadata, modelSchemaTables.metadata],
    [manifest.schemas.modelA, modelSchemaTables.physicalModel],
    [manifest.schemas.modelB, modelSchemaTables.physicalModel],
  ];
  for (const schema of Object.values(manifest.schemas)) {
    assert.match(schema, new RegExp(`^nf_${manifest.runId}_[a-z_]+$`), 'Foreign schema is forbidden');
  }
  return [
    ...Object.values(manifest.schemas).map(schema => `CREATE DATABASE \`${schema}\` CHARACTER SET utf8mb4;`),
    `USE \`${manifest.schemas.uaa}\`;`, ...uaaDDL,
    ...schemaGroups.flatMap(([schema, tables]) => [
      `USE \`${schema}\`;`, ...tables.map(table => extractModelDDL(dump, table)),
    ]), '',
  ].join('\n');
}

export function remapObservedView(output, { view, sourceSchema, targetSchema }) {
  assert.ok(Object.hasOwn(uaaViews, view), 'Unsupported UAA view');
  for (const schema of [sourceSchema, targetSchema]) assert.match(schema, /^[a-zA-Z][a-zA-Z0-9_]*$/);
  const fields = output.trim().split('\t');
  assert.equal(fields.length, 4, 'Expected four SHOW CREATE VIEW fields');
  assert.equal(fields[0], view);
  assert.equal(fields[2], 'utf8mb4', 'Unexpected view client charset');
  assert.equal(fields[3], 'utf8mb4_general_ci', 'Unexpected view client collation');
  const header = /^CREATE ALGORITHM=UNDEFINED DEFINER=`[^`]+`@`[^`]+` SQL SECURITY DEFINER VIEW /;
  assert.match(fields[1], header, 'Unreviewed view algorithm/security contract');
  assert.ok(fields[1].includes(`VIEW \`${sourceSchema}\`.\`${view}\` AS select `));
  const seen = [...fields[1].matchAll(/`([^`]+)`\.`([^`]+)`/g)];
  const dependencies = seen.filter(([,, table]) => table !== view)
    .filter(([, qualifier]) => qualifier === sourceSchema).map(([,, table]) => table);
  assert.deepEqual([...new Set(dependencies)].sort(), [...uaaViews[view]].sort(),
    'Observed view dependencies differ from the reviewed mapping');
  for (const [, qualifier] of seen) {
    assert.ok([sourceSchema, 't1', 'p', 'i', 'a'].includes(qualifier), 'Foreign view reference');
  }
  assert.doesNotMatch(fields[1], /;|--|\/\*|\b(?:outfile|dumpfile|sleep|benchmark|load_file)\b/i);
  // Preserve SELECT/algorithm/security semantics; replace only the isolated
  // definer and every source-schema identifier. Never retain a shared DB link.
  const ddl = fields[1].replace(header,
    'CREATE ALGORITHM=UNDEFINED DEFINER=CURRENT_USER SQL SECURITY DEFINER VIEW ')
    .replaceAll(`\`${sourceSchema}\`.`, `\`${targetSchema}\`.`);
  assert.ok(!ddl.includes(`\`${sourceSchema}\`.`));
  return `${ddl};`;
}

function captureUAASchema({ uaaSchemaContainer, uaaSchema, targetSchema, uaaSchemaMode }) {
  const tables = uaaSchemaMode === 'legacy-views' ? uaaLegacyTables : uaaStandaloneTables;
  const views = uaaSchemaMode === 'legacy-views' ? Object.keys(uaaViews) : [];
  const ddl = [];
  const observed = [];
  const supplemental = [];
  const sourceSQL = sql => executeDocker([
    'exec', '-i', uaaSchemaContainer, 'sh', '-c',
    'test -n "$MYSQL_ROOT_PASSWORD" && MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot --default-character-set=utf8mb4 --batch --raw --skip-column-names',
  ], { input: sql }).stdout;
  for (const table of tables) {
    const output = sourceSQL(`SHOW CREATE TABLE \`${uaaSchema}\`.\`${table}\`;\n`);
    assert.ok(output.startsWith(`${table}\tCREATE TABLE \`${table}\``),
      `Expected BASE TABLE for ${uaaSchemaMode}: ${table}`);
    const statement = output.slice(table.length + 1).trim();
    assert.match(statement, /ENGINE=InnoDB/);
    for (const match of statement.matchAll(/REFERENCES\s+`([^`]+)`/g)) {
      assert.ok(tables.includes(match[1]), `Uncaptured foreign-key table: ${match[1]}`);
    }
    assert.doesNotMatch(statement, /REFERENCES\s+`[^`]+`\./, 'Cross-schema FK is forbidden');
    observed.push({ name: table, kind: 'BASE TABLE', sha256: hash(output) });
    ddl.push(`${statement};`);
  }
  for (const view of views) {
    const output = sourceSQL(`SHOW CREATE VIEW \`${uaaSchema}\`.\`${view}\`;\n`);
    const statement = remapObservedView(output, { view, sourceSchema: uaaSchema, targetSchema });
    observed.push({ name: view, kind: 'VIEW', sha256: hash(output), remappedSha256: hash(statement) });
    ddl.push(statement);
  }
  for (const table of uaaSupplementalTables) {
    const output = sourceSQL(`SHOW CREATE TABLE \`${uaaSchema}\`.\`${table}\`;\n`);
    assert.ok(output.startsWith(`${table}\tCREATE TABLE \`${table}\``),
      `Expected supplemental UAA BASE TABLE: ${table}`);
    const statement = output.slice(table.length + 1).trim();
    assert.match(statement, /ENGINE=InnoDB/);
    assert.doesNotMatch(statement, /REFERENCES\s+`[^`]+`\./, 'Supplemental cross-schema FK is forbidden');
    observed.push({ name: table, kind: 'SUPPLEMENTAL BASE TABLE', sha256: hash(output) });
    supplemental.push(table);
    ddl.push(`${statement};`);
  }
  return { ddl, tables, views, observed, supplemental };
}

export function captureModelUAASchema(modelPath, targetSchema) {
  const absolute = resolve(workspace, modelPath);
  const child = relative(workspace, absolute);
  assert.ok(child && child !== '..' && !child.startsWith('../') && !child.startsWith('/'),
    'Explicit UAA fixture model must remain inside the workspace');
  const directories = new PinnedDirectories();
  try {
    const { data } = readPinnedFile(directories, directories.open(dirname(absolute)), basename(absolute));
    const model = JSON.parse(data);
    const ddl = uaaSchemaTableSQL(model, targetSchema);
    return {
      ddl, tables: model.entities.filter(row => row.table_name).map(row => row.table_name),
      views: [], observed: [], supplemental: [],
      modelInput: { path: child, sha256: hash(data) },
      mode: 'model-derived-nullable-fixture-ddl-not-official-migration',
    };
  } finally { directories.close(); }
}

export function mysqlSmokeRunArgs(manifest, { mysqlImage, databaseProfile, password, databaseStorage }) {
  assert.match(mysqlImage, /^sha256:[a-f0-9]{64}$/);
  const common = [
    'run', '-d', '--pull=never', '--name', manifest.ownership.mysqlContainer,
    '--network', manifest.ownership.network, '--label', `${ownershipLabel}=${manifest.runId}`,
  ];
  if (databaseProfile === undefined) {
    return [...common, '--tmpfs', '/var/lib/mysql:rw,nosuid,nodev,size=1073741824',
      '-e', 'MYSQL_ROOT_PASSWORD', mysqlImage, '--lower-case-table-names=1', '--skip-log-bin'];
  }
  const profile = mysqlFixtureProfile(databaseProfile);
  assert.equal(mysqlImage, profile.imageId, 'Explicit database profile and image must agree');
  return [...common, '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges',
    ...mysqlFixtureArgs(profile, password, databaseStorage), mysqlImage, ...profile.command];
}

export function verifyMysqlSmokePlatform(image, platform, profile) {
  assert.equal(`${image.Os}/${image.Architecture}`, platform.trim(),
    'MySQL image differs from the Docker server platform; no automatic emulation or image fallback');
  assert.ok(['linux/arm64', 'linux/amd64'].includes(platform.trim()));
  if (profile) {
    assert.equal(image.Id, profile.imageId);
    assert.equal(image.Architecture, profile.architecture);
  }
}

export function runIsolatedSQLSmoke({
  mysqlImage, uaaSchemaContainer, uaaSchema, scenario, modelVersion, uaaSchemaMode,
  retainOwned = false, databaseProfile, subnet, uaaModelPath,
}) {
  assert.match(mysqlImage, /^sha256:[a-f0-9]{64}$/, 'Use an already cached immutable local image ID; no pull/build');
  assert.ok(['standalone-tables', 'legacy-views'].includes(uaaSchemaMode), 'Explicit UAA schema mode required');
  if (uaaModelPath === undefined) {
    assert.match(uaaSchemaContainer, /^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/, 'Explicit schema source container required');
    assert.match(uaaSchema, /^[a-zA-Z][a-zA-Z0-9_]*$/, 'Explicit UAA schema source required');
  } else {
    assert.equal(typeof uaaModelPath, 'string');
    assert.ok(uaaModelPath.length > 0);
    assert.equal(uaaSchemaContainer, undefined, 'Select exactly one explicit schema source');
    assert.equal(uaaSchema, undefined, 'Model-derived schema must not retain a shared source');
    assert.equal(uaaSchemaMode, 'standalone-tables', 'UAA model defines tables, not legacy views');
  }
  assert.equal(typeof retainOwned, 'boolean');
  const profile = databaseProfile === undefined ? undefined : mysqlFixtureProfile(databaseProfile);
  if (profile) assert.equal(mysqlImage, profile.imageId, 'Explicit database profile and image must agree');
  if (profile?.storagePath) assert.equal(retainOwned, true,
    'Disk-backed fixtures require explicit retention and journaled disposal');
  mysqlFixtureNetworkArgs({ runId: 'preflight', ownership: { network: 'preflight' } }, subnet);
  const fixture = createFixture({ scenario, passwordStorageMode: 'sm3', modelVersion, uaaSchemaMode });
  const { manifest, credentials } = fixture;
  const { output } = writeFixtureCandidate(fixture);
  const rootPassword = randomBytes(profile ? 16 : 18).toString('hex');
  const report = {
    contract: 'run-owned-native-nonadmin-isolated-sql-smoke-v1', runId: manifest.runId, scenario,
    startedAt: new Date().toISOString(), status: 'running-isolated-sql-only',
    nativeAcceptance: false, permissionAcceptance: false, sourceNativeAcceptance: false,
    actualUAALoginVerified: false, actualBackendHTTPVerified: false,
    mysqlImage, output, uaaSchemaMode, retainOwned, checks: [], inputs: {}, cleanup: {},
    ...(profile ? { databaseProfile: { name: databaseProfile, imageId: profile.imageId } } : {}),
    networkSubnet: subnet ?? null,
    readiness: profile ? 'PID1 mysqld plus SELECT 1 over 127.0.0.1 TCP; never the initialization child server'
      : 'SELECT 1 over 127.0.0.1 TCP, never entrypoint temporary --skip-networking socket server',
    schemaScope: manifest.schemaScope,
    provenBoundary: 'Published query/schema/identity joins and direct JDBC grants only; no HTTP permission or complete app readiness',
  };
  let networkId;
  let containerId;
  let databaseStorage;
  const volumeResources = () => ({
    runId: manifest.runId, mysqlId: containerId, databaseProfile: report.databaseProfile, databaseStorage,
  });
  const verifyStorage = container => verifyMysqlFixtureStorage(profile, container, {
    storage: databaseStorage, volumes: inspectMysqlFixtureVolumes(volumeResources()),
  });
  const rootSQL = (input, extra = {}) => {
    const result = executeDocker([
      'exec', '-i', containerId, 'sh', '-c',
      `MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec ${profile?.client ?? 'mysql'} -h127.0.0.1 --protocol=TCP -uroot --default-character-set=utf8mb4 --batch --raw --skip-column-names`,
    ], { input, ...extra, allowFailure: true });
    if (!extra.allowFailure && (result.error || result.status !== 0)) {
      const log = `mysql-error-${randomBytes(6).toString('hex')}.private.log`;
      privateFile(join(output, log), `${result.stderr}\n${result.error?.message ?? ''}\n`);
      assert.fail(`Owned MySQL SQL failed; secret-bearing diagnostic is private: ${log}`);
    }
    return result;
  };
  const verify = (name, actual, expected) => {
    assert.equal(actual, expected, name);
    report.checks.push({ name, status: 'passed' });
  };
  try {
    report.inputs.fixtureTools = [
      'scripts/prepare-run-owned-native-nonadmin-fixture.mjs',
      'scripts/tests/run-owned-native-nonadmin-fixture.sql.mjs',
      'scripts/tests/run-owned-native-nonadmin-fixture.test.mjs',
      'scripts/mysql-fixture-profiles.mjs',
      'scripts/tests/mysql-fixture-profiles.test.mjs',
      'scripts/owned-mysql-volume.mjs',
      'scripts/tests/owned-mysql-volume.test.mjs',
      'scripts/owned-mysql-recreation.mjs',
      'scripts/tests/owned-mysql-recreation.test.mjs',
      'scripts/owned-mysql-backup-restore.mjs',
      'scripts/tests/owned-mysql-backup-restore.test.mjs',
      'scripts/mysql-cold-backup-archive.mjs',
      'scripts/tests/mysql-cold-backup-archive.test.mjs',
      'scripts/tests/mysql-cold-backup-fixture.mjs',
      'scripts/uaa-fixture-schema.mjs',
      'scripts/tests/uaa-fixture-schema.test.mjs',
      'scripts/model-fixture-schema.mjs',
      'scripts/tests/model-fixture-schema.test.mjs',
    ].map(path => ({ path, sha256: hash(readFileSync(join(workspace, path))) }));
    const image = JSON.parse(executeDocker(['image', 'inspect', mysqlImage]).stdout)[0];
    const platform = executeDocker(['version', '--format', '{{.Server.Os}}/{{.Server.Arch}}']).stdout.trim();
    verifyMysqlSmokePlatform(image, platform, profile);
    report.platform = platform;
    // SHOW CREATE only: never read accounts/passwords/seed rows from the source DB.
    const captured = uaaModelPath === undefined ? captureUAASchema({
      uaaSchemaContainer, uaaSchema, targetSchema: manifest.schemas.uaa, uaaSchemaMode,
    }) : captureModelUAASchema(uaaModelPath, manifest.schemas.uaa);
    const uaaDDL = captured.ddl;
    const dump = readFileSync(join(workspace, modelDump), 'utf8');
    report.inputs.modelDump = { path: modelDump, sha256: hash(dump) };
    report.inputs.modelSchemaTables = modelSchemaTables;
    report.inputs.modelSchemaSources = modelSchemaSources.map(({ model, ...source }) => source);
    const plan = schemaPlan(dump);
    privateFile(join(output, 'model-schema-plan.json'), json({
      ...plan, tables: plan.tables.map(({ ddl, ...table }) => table),
    }));
    report.inputs.modelSchemaPlan = { path: relative(workspace, join(output, 'model-schema-plan.json')),
      sha256: hash(readFileSync(join(output, 'model-schema-plan.json'))), fingerprint: plan.fingerprint };
    report.inputs.uaaSchemaOnly = {
      container: uaaSchemaContainer, schema: uaaSchema, sha256: hash(uaaDDL.join('\n')),
      tables: captured.tables, views: captured.views, observed: captured.observed,
      supplemental: captured.supplemental,
      ...(captured.modelInput ? { modelInput: captured.modelInput, mode: captured.mode } : {}),
      viewIsolationDeltas: captured.views.length
        ? ['definer becomes CURRENT_USER in owned MySQL', 'all schema-qualified references remap to owned UAA schema'] : [],
      claims: 'observed schema-only compatibility input, not authenticated original UAA source',
    };
    const bootstrap = createSchemaBootstrap(manifest, uaaDDL, dump);
    privateFile(join(output, '00-schema-only.sql'), bootstrap);
    networkId = executeDocker(mysqlFixtureNetworkArgs(manifest, subnet)).stdout.trim();
    assert.match(networkId, /^[a-f0-9]{64}$/);
    if (profile?.storagePath) {
      assert.equal(databaseProfile, OWNED_VOLUME_PROFILE);
      report.volumePlan = ownedMysqlVolumePlan(manifest.runId);
      privateFile(join(output, 'mysql-volume-plan.json'), json(report.volumePlan));
      databaseStorage = createOwnedMysqlVolume(report.volumePlan);
      report.databaseStorage = databaseStorage;
      report.databaseStorageBacking = inspectOwnedMysqlDiskBacking(databaseStorage);
      privateFile(join(output, 'mysql-volume-identity.json'), json(databaseStorage));
      report.volumeInitialization = [];
      initializeOwnedMysqlVolume(volumeResources(), profile, {
        journal: row => report.volumeInitialization.push(row),
      });
    }
    containerId = executeDocker(mysqlSmokeRunArgs(manifest, {
      mysqlImage, databaseProfile, password: rootPassword, databaseStorage,
    }), { env: { MYSQL_ROOT_PASSWORD: rootPassword } }).stdout.trim();
    assert.match(containerId, /^[a-f0-9]{64}$/);
    report.ownedMysqlId = containerId;
    report.ownedNetworkId = networkId;
    const deadline = Date.now() + 120_000;
    let ready = false;
    while (Date.now() < deadline) {
      if (profile) {
        const process = executeDocker(['exec', containerId, 'cat', '/proc/1/comm'], { allowFailure: true });
        if (process.status !== 0 || !mysqlFixtureReadyProcess(process.stdout)) {
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1_000);
          continue;
        }
      }
      const ping = rootSQL('SELECT 1;\n', { allowFailure: true });
      if (!ping.error && ping.status === 0 && ping.stdout.trim() === '1') {
        ready = true;
        break;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1_000);
    }
    assert.ok(ready, 'Owned MySQL failed to become ready within 120 seconds');
    if (profile) {
      const container = JSON.parse(executeDocker(['inspect', containerId]).stdout)[0];
      verifyStorage(container);
      const state = JSON.parse(rootSQL(
        "SELECT JSON_OBJECT('version', VERSION(), 'lowerCaseTableNames', @@lower_case_table_names, 'characterSet', @@character_set_server);",
      ).stdout.trim());
      verifyMysqlFixtureState(profile, state);
      report.databaseState = state;
      report.databaseProcess = 'mysqld';
    }
    verify('no preset business schemas before owned bootstrap', rootSQL(
      "SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name NOT IN ('information_schema','mysql','performance_schema','sys','test');",
    ).stdout.trim(), '0');
    rootSQL(bootstrap);
    const preflight = preflightOwnedMysql(manifest);
    privateFile(join(output, 'owned-preflight.json'), json(preflight));
    rootSQL(fixture.seedSQL);
    rootSQL(fixture.accountSQL);
    privateFile(join(output, 'join-verification.private.tsv'), rootSQL(fixture.verifySQL).stdout);

    const meta = `\`${manifest.schemas.metadata}\``;
    const uaa = `\`${manifest.schemas.uaa}\``;
    const scalar = sql => rootSQL(`${sql}\n`).stdout.trim();
    verify('six trusted UAA/developer/object/center identity joins', scalar(
      `SELECT COUNT(*) FROM ${uaa}.sys_person p JOIN ${meta}.t_srfpsdevuser d ON d.LOGINNAME=p.UID AND d.PSDEVUSERID=p.ID JOIN ${meta}.t_srfpsdevuserobj o ON o.PSDEVUSEROBJID=d.PSDEVUSERID AND o.PSDEVCENTERID=p.DC WHERE d.ADMINMODE=0 AND d.ENABLE=1 AND o.ENABLE=1 AND o.VALIDFLAG=1;`,
    ), '6');
    verify('six ordinary deployment role joins', scalar(
      `SELECT COUNT(*) FROM ${uaa}.sys_person p JOIN ${uaa}.sys_role_member m ON m.MEMBER_UID=p.ID AND m.MEMBER_TYPE='inetOrgPerson' JOIN ${uaa}.sys_role r ON r.ID=m.ROLE_ID AND r.DC=p.DC JOIN ${uaa}.sys_deploy_system ds ON ds.ID=r.DEPLOY_SYSTEM_ID AND ds.DC=p.DC WHERE r.AUTHORITY='ROLE_NATIVE_FIXTURE' AND ds.SYSTEM_ID='ibizmodeling';`,
    ), '6');
    verify('six UAA domain and active organization joins', scalar(
      `SELECT COUNT(*) FROM ${uaa}.sys_person p JOIN ${uaa}.sys_domain d ON d.ID=p.DC AND d.ENABLED=1 JOIN ${uaa}.sys_organization o ON o.ID=p.ORGANIZATION_ID AND o.DC=p.DC AND o.ENABLED=1 WHERE p.STATUS='1' AND p.ENABLED=1;`,
    ), '6');
    verify('no inherited organizational memberships or granted authorities', scalar(
      `SELECT (SELECT COUNT(*) FROM ${uaa}.sys_member)+(SELECT COUNT(*) FROM ${uaa}.sys_organizational_role)+(SELECT COUNT(*) FROM ${uaa}.sys_granted_authority);`,
    ), '0');
    verify('no administrative identity or scheme ownership shortcuts', scalar(
      `SELECT (SELECT COUNT(*) FROM ${meta}.t_srfpsdevuser WHERE ADMINMODE<>0)+(SELECT COUNT(*) FROM ${meta}.t_srfpsdevsln WHERE ADMINPSDEVUSERID IS NOT NULL);`,
    ), '0');
    verify('exactly four root-specific grants', scalar(
      `SELECT COUNT(*) FROM ${meta}.t_srfpsdevslnuser WHERE ALLSYSFLAG=0 AND ACCMODE IN(1,3) AND EXPIREDTIME IS NULL;`,
    ), '4');
    verify('two absent no-access memberships', scalar(
      `SELECT COUNT(*) FROM ${meta}.t_srfpsdevuser d LEFT JOIN ${meta}.t_srfpsdevslnuser g ON g.PSDEVUSEROBJID=d.PSDEVUSERID WHERE g.PSDEVSLNUSERID IS NULL;`,
    ), '2');
    verify('six stored SM3 digests have uppercase hex shape', scalar(
      `SELECT COUNT(*) FROM ${uaa}.sys_person WHERE USER_PASSWORD REGEXP '^[A-F0-9]{64}$';`,
    ), '6');
    for (const user of manifest.users) {
      const expectedDigest = encodeFixturePassword(credentials.users[user.loginname], 'sm3');
      verify(`exact stored SM3 digest for ${user.loginname}`, scalar(
        `SELECT COUNT(*) FROM ${uaa}.sys_person WHERE ID='${user.personId}' AND UID='${user.loginname}' AND DC='${user.centerId}' AND BINARY USER_PASSWORD='${expectedDigest}';`,
      ), '1');
    }
    const queries = new Map();
    for (const specification of publishedQueries) {
      const bytes = readFileSync(join(workspace, publishedRoot, specification.path));
      const query = JSON.parse(bytes).queryCode;
      assert.match(query, /^SELECT/);
      assert.doesNotMatch(query, /;|#\{|\$\{/);
      queries.set(specification.entity, query);
      const databases = specification.target === 'metadata'
        ? [manifest.schemas.metadata] : manifest.roots.map(root => root.database);
      report.inputs[specification.path] = { sha256: hash(bytes), databases };
      for (const database of databases) {
        rootSQL(`USE \`${database}\`; EXPLAIN ${query};\n`);
        report.checks.push({
          name: `published ${specification.entity} query schema EXPLAIN in ${database}`, status: 'passed',
        });
        verify(`published ${specification.entity} row count in ${database}`, scalar(
          `USE \`${database}\`; SELECT COUNT(*) FROM (${query}) published_fixture;`,
        ), String(specification.expectedRows));
      }
    }
    for (const user of manifest.users) {
      const where = `PSDEVUSEROBJID='${user.userObjectId}'`;
      const predicate = user.grantId
        ? `${where} AND PSDEVSLNUSERID='${user.grantId}' AND PSDEVSLNSYSID='${user.rootId}' AND PSDEVSLNID='${user.schemeId}' AND ACCMODE=${user.accessMode} AND ALLSYSFLAG=0 AND DEVUSEROBJTYPE='USER' AND EXPIREDTIME IS NULL`
        : where;
      verify(`published grant query preserves ${user.loginname} ${user.role} mapping`, scalar(
        `USE ${meta}; SELECT COUNT(*) FROM (${queries.get('PSDevSlnUser')}) grant_fixture WHERE ${predicate};`,
      ), user.grantId ? '1' : '0');
    }
    for (const root of manifest.roots) {
      verify(`published root query preserves ${root.side} center/model/version mapping`, scalar(
        `USE ${meta}; SELECT COUNT(*) FROM (${queries.get('PSDevSlnSys')}) root_fixture WHERE PSDEVSLNSYSID='${root.rootId}' AND PSDEVSLNID='${root.schemeId}' AND PSDEVCENTERID='${root.centerId}' AND PSSYSTEMID='${root.logicalSystemId}' AND PSSYSMODELINSTID='${root.modelInstanceId}' AND MODELINSTVER=${root.modelVersion} AND DBNAME='${root.database}';`,
      ), '1');
    }
    const asJdbcUser = (root, sql) => executeDocker([
      'exec', '-i', '-e', 'MYSQL_PWD', containerId,
      profile?.client ?? 'mysql', `-u${root.jdbcUser}`, '--batch', '--raw', '--skip-column-names',
    ], { input: sql, env: { MYSQL_PWD: credentials.databases[root.jdbcUser] }, allowFailure: true });
    const lookalikeSchemas = manifest.roots.map(root => root.database.replace('_', 'x'));
    rootSQL(lookalikeSchemas.map(schema => [
      `CREATE DATABASE \`${schema}\`;`,
      `CREATE TABLE \`${schema}\`.t_srfpsmodule (PSMODULEID varchar(100) PRIMARY KEY, MODTAG varchar(100));`,
      `INSERT INTO \`${schema}\`.t_srfpsmodule VALUES ('lookalike','untouched');`,
    ].join('\n')).join('\n'));
    report.ownedGrantWildcardProbeSchemas = lookalikeSchemas;
    for (let index = 0; index < manifest.roots.length; index++) {
      const root = manifest.roots[index];
      const foreign = manifest.roots[1 - index];
      const read = asJdbcUser(root, `SELECT PSMODULENAME FROM \`${root.database}\`.t_srfpsmodule;\n`);
      verify(`JDBC ${root.side} reads only its own physical sentinel`, read.stdout.trim(), root.sentinelName);
      assert.equal(read.status, 0);
      const moduleRead = asJdbcUser(root,
        `USE \`${root.database}\`; SELECT PSMODULEID,PSSYSTEMID,PSMODULENAME,PSSYSTEMNAME,MODTAG FROM (${queries.get('PSModule')}) module_fixture;\n`);
      assert.equal(moduleRead.status, 0, 'Full published module query must run using the scoped JDBC principal');
      verify(`published module query ${root.side} returns its joined physical system sentinel`,
        moduleRead.stdout.trim(),
        [root.sentinelId, root.logicalSystemId, root.sentinelName, root.sentinelSystemName, root.sentinelTag].join('\t'));
      for (const [operation, statement] of [
        ['SELECT', `SELECT PSMODULENAME FROM \`${foreign.database}\`.t_srfpsmodule;`],
        ['UPDATE', `UPDATE \`${foreign.database}\`.t_srfpsmodule SET MODTAG='unauthorized';`],
        ['lookalike SELECT', `SELECT MODTAG FROM \`${lookalikeSchemas[index]}\`.t_srfpsmodule;`],
        ['lookalike UPDATE', `UPDATE \`${lookalikeSchemas[index]}\`.t_srfpsmodule SET MODTAG='unauthorized';`],
      ]) {
        const denied = asJdbcUser(root, `${statement}\n`);
        assert.ok(!denied.error && denied.status !== 0 && /ERROR (1044|1142)/.test(denied.stderr),
          `Foreign ${operation} must fail by SQL authorization, not network/parser failure`);
        report.checks.push({ name: `JDBC ${root.side} foreign ${operation} denied`, status: 'passed' });
      }
      const marker = `${root.sentinelTag}_own`;
      const ownWrite = asJdbcUser(root,
        `UPDATE \`${root.database}\`.t_srfpsmodule SET MODTAG='${marker}' WHERE PSMODULEID='${root.sentinelId}';\n`);
      assert.equal(ownWrite.status, 0);
      verify(`JDBC ${root.side} own write persists`, scalar(
        `SELECT MODTAG FROM \`${root.database}\`.t_srfpsmodule WHERE PSMODULEID='${root.sentinelId}';`,
      ), marker);
    }
    for (const root of manifest.roots) {
      verify(`denied cross-DB writes did not alter ${root.side}`, scalar(
        `SELECT MODTAG FROM \`${root.database}\`.t_srfpsmodule WHERE PSMODULEID='${root.sentinelId}';`,
      ), `${root.sentinelTag}_own`);
      rootSQL(`UPDATE \`${root.database}\`.t_srfpsmodule SET MODTAG='${root.sentinelTag}' WHERE PSMODULEID='${root.sentinelId}';\n`);
      verify(`owned ${root.side} sentinel reset for subsequent native HTTP checks`, scalar(
        `SELECT MODTAG FROM \`${root.database}\`.t_srfpsmodule WHERE PSMODULEID='${root.sentinelId}';`,
      ), root.sentinelTag);
    }
    for (const schema of lookalikeSchemas) {
      verify(`denied JDBC operations did not mutate wildcard probe ${schema}`, scalar(
        `SELECT MODTAG FROM \`${schema}\`.t_srfpsmodule WHERE PSMODULEID='lookalike';`,
      ), 'untouched');
    }
    if (profile) {
      verifyStorage(JSON.parse(executeDocker(['inspect', containerId]).stdout)[0]);
    }
    if (captured.modelInput) {
      const current = captureModelUAASchema(uaaModelPath, manifest.schemas.uaa);
      assert.deepEqual(current.modelInput, captured.modelInput, 'UAA model source changed during SQL verification');
    }
    report.status = 'passed-isolated-sql-fixture-only';
  } catch (error) {
    report.status = 'failed-isolated-sql-fixture';
    report.error = error.message;
  } finally {
    if (containerId && report.status !== 'passed-isolated-sql-fixture-only') {
      const log = executeDocker(['logs', containerId], { allowFailure: true });
      privateFile(join(output, 'mysql-container.private.log'), `${log.stdout}\n${log.stderr}`);
      const inspect = executeDocker(['inspect', containerId], { allowFailure: true });
      if (inspect.status === 0) {
        const { State } = JSON.parse(inspect.stdout)[0];
        report.mysqlFailureState = {
          status: State.Status, exitCode: State.ExitCode, oomKilled: State.OOMKilled,
          error: State.Error, diagnostics: 'mysql-container.private.log',
        };
      }
    }
    // Never enumerate/prune/delete by prefix: remove only the exact IDs created
    // in this invocation after checking their ownership again.
    const keep = retainOwned && report.status === 'passed-isolated-sql-fixture-only';
    if (keep) {
      privateFile(join(output, 'owned-resources.json'), json({
        contract: 'run-owned-native-fixture-resources-v1', runId: manifest.runId,
        mysqlId: containerId, networkId, mysqlName: manifest.ownership.mysqlContainer,
        networkName: manifest.ownership.network, schemas: manifest.schemas,
        mysqlImage, ...(profile ? { databaseProfile: report.databaseProfile } : {}),
        ...(databaseStorage ? { databaseStorage } : {}),
        nativeAcceptance: false, permissionAcceptance: false,
      }));
      report.cleanup = { retainedForMainOwnedIntegration: true, mysqlRemoved: false, networkRemoved: false,
        ...(databaseStorage ? { volumeRemoved: false } : {}) };
    }
    if (containerId && !keep) {
      try {
        const container = JSON.parse(executeDocker(['inspect', containerId]).stdout)[0];
        assert.equal(container.Config?.Labels?.[ownershipLabel], manifest.runId);
        assert.equal(container.Name, `/${manifest.ownership.mysqlContainer}`);
        if (profile) verifyStorage(container);
        executeDocker(['rm', '-f', containerId]);
        report.cleanup.mysqlRemoved = true;
      } catch (error) {
        report.cleanup.mysqlRemoved = false;
        report.cleanup.mysqlError = error.message;
      }
    }
    if (networkId && !keep) {
      try {
        const network = JSON.parse(executeDocker(['network', 'inspect', networkId]).stdout)[0];
        assert.equal(network.Labels?.[ownershipLabel], manifest.runId);
        assert.equal(network.Name, manifest.ownership.network);
        assert.equal(Object.keys(network.Containers ?? {}).length, 0);
        executeDocker(['network', 'rm', networkId]);
        report.cleanup.networkRemoved = true;
      } catch (error) {
        report.cleanup.networkRemoved = false;
        report.cleanup.networkError = error.message;
      }
    }
    if (databaseStorage && !keep) {
      try {
        report.cleanup.volumeName = removeOwnedMysqlVolume(volumeResources());
        report.cleanup.volumeRemoved = true;
      } catch (error) {
        report.cleanup.volumeRemoved = false;
        report.cleanup.volumeError = error.message;
      }
    }
    if (!keep && Object.values(report.cleanup).includes(false)) report.status = 'failed-owned-cleanup';
    report.finishedAt = new Date().toISOString();
    report.outputs = {};
    for (const name of ['manifest.json', '01-seed.private.sql', '02-jdbc-accounts.private.sql', '03-verify.sql', '00-schema-only.sql', 'owned-preflight.json', 'join-verification.private.tsv', 'owned-resources.json']) {
      try {
        const bytes = readFileSync(join(output, name));
        report.outputs[name] = { bytes: bytes.length, sha256: hash(bytes) };
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    privateFile(join(output, 'isolated-sql-report.json'), json(report));
  }
  return { reportPath: join(output, 'isolated-sql-report.json'), report };
}

export function validateCleanupResources(manifest, resources, container, network, volumes = []) {
  assert.equal(resources.contract, 'run-owned-native-fixture-resources-v1');
  assert.equal(resources.runId, manifest.runId);
  assert.match(resources.mysqlId, /^[a-f0-9]{64}$/);
  assert.match(resources.networkId, /^[a-f0-9]{64}$/);
  assert.equal(container.Id, resources.mysqlId, 'Cleanup target ID changed');
  assert.equal(network.Id, resources.networkId, 'Cleanup network ID changed');
  assert.equal(resources.mysqlName, manifest.ownership.mysqlContainer);
  assert.equal(resources.networkName, manifest.ownership.network);
  assert.deepEqual(resources.schemas, manifest.schemas);
  assert.deepEqual(Object.keys(network.Containers ?? {}), [container.Id],
    'Remove main-owned integration peers first; cleanup never deletes other containers');
  if (resources.databaseProfile !== undefined || resources.databaseStorage !== undefined) {
    verifySelectedMysqlStorage(resources.databaseProfile, container, {
      storage: resources.databaseStorage, volumes,
    });
  }
  return validateOwnedTarget(manifest, container, network, [], volumes);
}

export function cleanupRetainedRun(runId) {
  assert.match(runId, /^[a-f0-9]{12}$/, 'Explicit existing 12-hex run ID required');
  const output = join(workspace, '.artifacts', 'native-nonadmin-fixtures', runId);
  const pathParts = ['.artifacts', 'native-nonadmin-fixtures', runId];
  let ancestor = workspace;
  for (const part of pathParts) {
    ancestor = join(ancestor, part);
    const stat = lstatSync(ancestor);
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), 'Cleanup receipt ancestors must be real directories');
  }
  const readPrivate = name => {
    const path = join(output, name);
    const stat = lstatSync(path);
    assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'Cleanup inputs must be regular files');
    return JSON.parse(readFileSync(path, 'utf8'));
  };
  const manifest = readPrivate('manifest.json');
  const resources = readPrivate('owned-resources.json');
  assert.equal(manifest.runId, runId);
  const container = JSON.parse(executeDocker(['inspect', resources.mysqlId]).stdout)[0];
  const network = JSON.parse(executeDocker(['network', 'inspect', resources.networkId]).stdout)[0];
  validateCleanupResources(manifest, resources, container, network, inspectMysqlFixtureVolumes(resources));
  const receiptPath = join(output, `cleanup-${randomBytes(6).toString('hex')}.json`);
  const receipt = {
    contract: 'run-owned-native-fixture-cleanup-v1', runId, status: 'running-owned-cleanup',
    ownedMysqlId: resources.mysqlId, ownedNetworkId: resources.networkId,
    startedAt: new Date().toISOString(), cleanup: {}, nativeAcceptance: false, permissionAcceptance: false,
  };
  try {
    executeDocker(['rm', '-f', resources.mysqlId]);
    receipt.cleanup.mysqlRemoved = true;
    const current = JSON.parse(executeDocker(['network', 'inspect', resources.networkId]).stdout)[0];
    assert.equal(current.Labels?.[ownershipLabel], runId);
    assert.equal(current.Name, manifest.ownership.network);
    assert.equal(Object.keys(current.Containers ?? {}).length, 0);
    executeDocker(['network', 'rm', resources.networkId]);
    receipt.cleanup.networkRemoved = true;
    if (resources.databaseStorage) {
      receipt.cleanup.volumeName = removeOwnedMysqlVolume(resources);
      receipt.cleanup.volumeRemoved = true;
    }
    receipt.status = 'passed-owned-cleanup';
  } catch (error) {
    receipt.status = 'failed-owned-cleanup';
    receipt.error = error.message;
  } finally {
    receipt.finishedAt = new Date().toISOString();
    privateFile(receiptPath, json(receipt));
  }
  return { reportPath: receiptPath, report: receipt };
}

export function main(args = process.argv.slice(2)) {
  if (args.length === 1 && args[0].startsWith('--cleanup-owned-run=')) {
    const result = cleanupRetainedRun(args[0].slice('--cleanup-owned-run='.length));
    if (result.report.status !== 'passed-owned-cleanup') process.exitCode = 1;
    return { reportPath: result.reportPath, status: result.report.status, cleanup: result.report.cleanup };
  }
  assert.ok(args.includes('--execute-owned-sql-smoke'),
    'Explicit --execute-owned-sql-smoke required; creates/removes only new run-owned MySQL/network');
  const options = {};
  for (const arg of args) {
    if (arg === '--execute-owned-sql-smoke') continue;
    if (arg === '--retain-owned-sql-fixture') {
      assert.equal(options.retainOwned, undefined, 'Duplicate retain option');
      options.retainOwned = true;
      continue;
    }
    const match = /^--(mysql-image|uaa-schema-container|uaa-schema|scenario|model-version|uaa-schema-mode|database-profile|subnet|uaa-model)=(.+)$/.exec(arg);
    assert.ok(match, 'Unsupported SQL smoke option');
    assert.equal(options[match[1]], undefined, 'Duplicate option');
    options[match[1]] = match[2];
  }
  assert.ok(/^[1-9][0-9]*$/.test(options['model-version'] ?? ''));
  const result = runIsolatedSQLSmoke({
    mysqlImage: options['mysql-image'], uaaSchemaContainer: options['uaa-schema-container'],
    uaaSchema: options['uaa-schema'], scenario: options.scenario,
    modelVersion: Number(options['model-version']), uaaSchemaMode: options['uaa-schema-mode'],
    retainOwned: options.retainOwned ?? false,
    databaseProfile: options['database-profile'], subnet: options.subnet,
    uaaModelPath: options['uaa-model'],
  });
  if (result.report.status !== 'passed-isolated-sql-fixture-only') process.exitCode = 1;
  return {
    reportPath: result.reportPath, status: result.report.status, runId: result.report.runId,
    nativeAcceptance: false, permissionAcceptance: false, cleanup: result.report.cleanup,
  };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    console.log(json(main()).trim());
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
