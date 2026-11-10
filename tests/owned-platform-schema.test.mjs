import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  platformIdentity, platformGrantSQL, verifyPlatformGrants, platformProbeCommand,
  platformOperatorProjectionIdentity, platformOperatorProjectionGrantSQL, platformOperatorProjectionViewSQL,
  verifyPlatformOperatorProjectionGrants, verifyPlatformModel, verifyPlatformOperatorSource,
  verifyPlatformProbe, readOwnedPlatformConfiguration, runPlatformHelper, cleanupPlatformHelpers,
  platformAuthenticationSha256, verifyPlatformUserOwnership, verifyPlatformViewCleanup, cleanupPlatformSqlResources,
  createPlatformTargetGuard,
  verifyPlatformResumeReceipt, verifyPlatformEmptySchema,
  verifyPlatformResumeUaaReplacement,
  normalizePlatformSchemaRows,
} from '../bootstrap-owned-platform-schema.mjs';
import { workflowIdentity, readOwnedWorkflowConfiguration } from '../bootstrap-owned-workflow-schema.mjs';
import { ebsxIdentity, ebsxPermissionProjectionIdentity, readOwnedEbsxConfiguration } from '../bootstrap-owned-ebsx-schema.mjs';
import { sourceBuildInputs } from '../source-build-identity.mjs';

const runId = '123456789abc';
const identity = platformIdentity(runId);
const original = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const modelFile = 'libs/ibiz-cloud-saas-extension/src/main/resources/sysmodel/saas-extension/PSSYSDBSCHEMES/DEFAULT.json';
const queryFile = 'ibiz-ebsx-runtime/src/main/resources/sysmodel/saas-ebsx/PSMODULES/ou/PSDATAENTITIES/Employee/PSDEDATAQUERIES/Default/PSDEDQCODES/MYSQL5.json';
const modelBytes = fs.readFileSync(join(original, 'ibiz-service-hub', modelFile));
const queryBytes = fs.readFileSync(join(original, 'ibiz-service-hub', queryFile));
const model = { ...verifyPlatformModel(JSON.parse(modelBytes)), path: modelFile, sha256: hash(modelBytes) };

function manifestFixture() {
  return { runId, schemas: { uaa: `nf_${runId}_uaa` },
    users: ['a', 'b'].flatMap(center => ['e', 'v', 'n'].map(role => ({
      personId: `nf_${runId}_person_${center}_${role}`,
      centerId: `nf_${runId}_center_${center}`,
      loginname: `nf_${runId}_${center}_${role}`,
    }))) };
}

function probeFixture(mode) {
  return {
    mode, schema: identity.schema,
    sqlPrincipal: `${mode === 'bootstrap' ? identity.bootstrapUser : identity.runtimeUser}@%`,
    adapterOrigin: 'file:/dependencies/ibiz-plugin-liquibase-8.1.0.584.1.jar',
    tables: [...model.tables], columnlessModelEntries: [...model.columnlessModelEntries],
    modelSha256: model.sha256, primaryKeysVerified: true, columnsVerified: 600, indicesVerified: 33,
    ...(mode === 'bootstrap' ? { adapterReplayPassed: true } : {
      crudVerified: true, runtimeDdlDenied: true, probeRemoved: true, projectionDmlDenied: true,
      uaaDirectReadDenied: true, operatorPasswordMasked: true, operatorQuerySha256: hash(queryBytes),
      operatorValuesReady: false, operatorUsers: manifestFixture().users
        .toSorted((a, b) => a.personId.localeCompare(b.personId)).map(user => ({
          personId: user.personId, centerId: user.centerId, loginname: user.loginname,
          displayName: user.loginname, operatorValuePresent: false,
        })),
    }),
  };
}

test('platform identities and grants are exact run-owned, schema-limited and DDL-free at runtime', () => {
  assert.equal(identity.schema, `nf_${runId}_platform`);
  assert.equal(identity.runtimeUser, `nf_${runId}_plat_app`);
  assert.notEqual(identity.runtimeUser, identity.bootstrapUser);
  assert.notEqual(identity.schema, ebsxIdentity(runId).schema);
  for (const invalid of [undefined, 'shared', 'A'.repeat(12), '../mysql']) {
    assert.throws(() => platformIdentity(invalid));
  }
  for (const mode of ['bootstrap', 'verify']) {
    const user = mode === 'bootstrap' ? identity.bootstrapUser : identity.runtimeUser;
    const grant = platformGrantSQL(identity, mode);
    const text = `GRANT USAGE ON *.* TO '${user}'@'%'\n${grant.slice(0, -1)}`;
    verifyPlatformGrants(identity, mode, text);
    assert.equal(grant.includes('CREATE'), mode === 'bootstrap');
    assert.equal(grant.includes('REFERENCES'), mode === 'bootstrap');
    assert.throws(() => verifyPlatformGrants(identity, mode, text.replaceAll('\\_', '_')));
    assert.throws(() => verifyPlatformGrants(identity, mode, `${text}\nGRANT ALL ON *.* TO '${user}'@'%'`));
  }
  assert.throws(() => platformGrantSQL({ ...identity, schema: 'shared' }, 'verify'));
});

test('native extension model has 32 real tables and two explicitly reviewed columnless entries', () => {
  assert.equal(model.tables.length, 32);
  assert.ok(model.tables.includes('INTERNAL_MESSAGE'));
  assert.deepEqual(model.columnlessModelEntries, ['SYSTEM_EXTENSION_MAINSTATE', 'SYSTEM_EXTENSION_SCHEDULE_TASK']);
  for (const change of [
    m => { m.getAllPSSysDBTables.pop(); },
    m => { m.getAllPSSysDBTables.find(row => row.name === 'SYSTEM_EXTENSION_MAINSTATE').getAllPSSysDBColumns = []; },
    m => { m.getAllPSSysDBTables.find(row => row.name === 'SYSTEM_EXTENSION_MAINSTATE').autoExtendModel = false; },
    m => { m.getAllPSSysDBTables[0].getAllPSSysDBColumns = []; },
    m => { m.getAllPSSysDBTables[0].getAllPSSysDBColumns.find(row => row.pKey).pKey = false; },
  ]) {
    const altered = JSON.parse(modelBytes);
    change(altered);
    assert.throws(() => verifyPlatformModel(altered));
  }
});

test('operator projection preserves native query fields without selecting any source password column', () => {
  assert.equal(verifyPlatformOperatorSource(queryBytes), hash(queryBytes));
  const projection = platformOperatorProjectionIdentity(runId);
  assert.equal(projection.host, 'localhost');
  assert.deepEqual(projection.tables, ['sys_person', 'sys_organization', 'sys_department']);
  const grants = platformOperatorProjectionGrantSQL(runId);
  assert.equal(grants.length, 3);
  assert.ok(grants.every(line => line.startsWith('GRANT SELECT (') && !line.includes('USER_PASSWORD')));
  const text = `GRANT USAGE ON *.* TO '${projection.user}'@'localhost'\n${grants.map(line => line.slice(0, -1)).join('\n')}`;
  verifyPlatformOperatorProjectionGrants(runId, text);
  verifyPlatformOperatorProjectionGrants(runId, text.split('\n').reverse().join('\n'));
  const bare = text.replaceAll(/`([A-Z][A-Z0-9_]*)`/g, '$1');
  verifyPlatformOperatorProjectionGrants(runId, bare);
  verifyPlatformOperatorProjectionGrants(runId, text.replace('`ORGANIZATION_ID`', 'ORGANIZATION_ID'));
  for (const altered of [
    text.replace('SELECT (', 'SELECT, UPDATE ('),
    text.replace('`UID`', '`USER_PASSWORD`'),
    text.replaceAll("'localhost'", "'%'"),
    text.replace('`sys_person`', '*'),
    text.replace(`nf_${runId}_uaa`, 'shared'),
    `${text}\n${grants[0].slice(0, -1)}`,
    text.replace('`UID`', '`UID'),
    text.replace('`UID`', 'UID`'),
    text.replace('`UID`', 'UID UNION SELECT USER_PASSWORD'),
    text.replace('`UID`', 'UID, UID'),
  ]) assert.throws(() => verifyPlatformOperatorProjectionGrants(runId, altered));
  const views = platformOperatorProjectionViewSQL(manifestFixture());
  assert.equal(views.length, 3);
  for (const view of views) {
    assert.match(view, /SQL SECURITY DEFINER VIEW/);
    assert.match(view, /AS SELECT DISTINCT/);
    assert.match(view, /WHERE /);
    assert.ok(!/OR REPLACE|SELECT \*|UPDATE |INSERT |DELETE /.test(view));
    assert.ok(view.includes(`nf_${runId}_center_a`) && view.includes(`nf_${runId}_center_b`));
  }
  assert.match(views[0], /CAST\(NULL AS CHAR\(1\)\) AS `USER_PASSWORD`/);
  assert.equal(views[0].match(/USER_PASSWORD/g).length, 1);
  assert.match(views[0], new RegExp(`\`ID\` IN \\('nf_${runId}_person_a_e'`));
  assert.match(views[2], /EXISTS \(SELECT 1 FROM/);
  assert.match(views[2], /`owned_person`\.`MDEPARTMENT_ID`=`sys_department`\.`ID`/);
  assert.match(views[2], /`owned_person`\.`DC`=`sys_department`\.`DC`/);
  assert.throws(() => platformOperatorProjectionViewSQL({ ...manifestFixture(), schemas: { uaa: 'shared' } }));
  const crossTenant = manifestFixture();
  crossTenant.users[0].centerId = `nf_${runId}_center_b`;
  assert.throws(() => platformOperatorProjectionViewSQL(crossTenant));
});

test('query review rejects changed dependencies, selected fields and multi-statement SQL', () => {
  for (const change of [
    query => { query.queryCode += '; SELECT 1'; },
    query => { query.queryCode = query.queryCode.replace('t1.USER_PASSWORD as PASSWORD', 't1.UID as PASSWORD'); },
    query => { query.queryCode = query.queryCode.replace('t1.MOBILE as PHONE', 't1.SECRET as PHONE'); },
    query => { query.queryCode = query.queryCode.replace('FROM sys_person', 'FROM shared_person'); },
    query => { query.queryCode = query.queryCode.replace('o.DC as SRFDCID', 'null as SRFDCID'); },
  ]) {
    const altered = JSON.parse(queryBytes);
    change(altered);
    assert.throws(() => verifyPlatformOperatorSource(JSON.stringify(altered)));
  }
});

test('platform helper uses only immutable offline image, owned network and read-only bound inputs', () => {
  const options = { runId, label: 'schema-r1', mode: 'verify', imageId: `sha256:${'a'.repeat(64)}`,
    dependencies: `/workspace/.artifacts/native-nonadmin-fixtures/${runId}/workflow-schema-wf/dependencies`,
    classes: `/workspace/.artifacts/native-nonadmin-fixtures/${runId}/platform-schema-schema-r1/helper-classes`,
    inputs: `/workspace/.artifacts/native-nonadmin-fixtures/${runId}/platform-schema-schema-r1/probe-inputs`,
  };
  const args = platformProbeCommand(options);
  for (const flag of ['--rm', '--pull=never', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges']) {
    assert.ok(args.includes(flag));
  }
  assert.equal(args[args.indexOf('--network') + 1], `nf-${runId}-private`);
  assert.equal(args[args.indexOf('--user') + 1], '65532:65532');
  assert.ok(!args.join(' ').includes('password'));
  for (const change of [
    o => { o.imageId = 'java:latest'; }, o => { o.dependencies = '/shared'; },
    o => { o.classes += ',rw'; }, o => { o.inputs = '/shared'; }, o => { o.mode = 'skip'; },
    o => { o.label = '../shared'; },
  ]) {
    const altered = { ...options };
    change(altered);
    assert.throws(() => platformProbeCommand(altered));
  }
});

test('probe verifier records genuine missing operator values without promoting native acceptance', () => {
  for (const mode of ['bootstrap', 'verify']) {
    verifyPlatformProbe(probeFixture(mode), identity, mode, model, manifestFixture(), hash(queryBytes));
  }
  const allReady = probeFixture('verify');
  allReady.operatorValuesReady = true;
  for (const user of allReady.operatorUsers) user.operatorValuePresent = true;
  verifyPlatformProbe(allReady, identity, 'verify', model, manifestFixture(), hash(queryBytes));
  for (const change of [
    row => { row.operatorPasswordMasked = false; }, row => { row.operatorUsers[0].centerId = 'shared'; },
    row => { row.operatorUsers.pop(); }, row => { row.operatorValuesReady = true; },
    row => { row.projectionDmlDenied = false; }, row => { row.runtimeDdlDenied = false; },
    row => { row.operatorUsers[0].password = 'secret'; }, row => { row.tables.push('EMPTY_COMPATIBILITY'); },
    row => { row.operatorQuerySha256 = 'a'.repeat(64); },
  ]) {
    const altered = probeFixture('verify');
    change(altered);
    assert.throws(() => verifyPlatformProbe(altered, identity, 'verify', model, manifestFixture(), hash(queryBytes)));
  }
});

function inputFixture(t) {
  const workspace = fs.mkdtempSync(join(os.tmpdir(), 'owned-platform-input-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const base = join(workspace, '.artifacts/native-nonadmin-fixtures', runId);
  const output = join(base, 'platform-schema-unit');
  const write = (path, value, mode = 0o600) => {
    fs.mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    fs.writeFileSync(path, typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value), { mode });
    return fs.readFileSync(path);
  };
  const manifest = manifestFixture();
  write(join(base, 'manifest.json'), manifest);
  for (const path of [
    'scripts/bootstrap-owned-platform-schema.mjs', 'scripts/fixtures/OwnedPlatformSchemaProbe.java',
    'scripts/bootstrap-owned-workflow-schema.mjs', 'scripts/fixtures/OwnedWorkflowSchemaProbe.java',
    'scripts/bootstrap-owned-ebsx-schema.mjs', 'scripts/fixtures/OwnedEbsxSchemaProbe.java',
  ]) write(join(workspace, path), fs.readFileSync(join(original, path)));
  const worktree = join(workspace, '.artifacts/package/worktree');
  write(join(worktree, modelFile), modelBytes);
  write(join(worktree, queryFile), queryBytes);
  const ebsxModels = Object.fromEntries(['DEFAULT', 'DB2', 'DB3'].map(link => {
    const path = join(worktree, `libs/ibiz-cloud-saas-ebsx/src/main/resources/sysmodel/saas-ebsx/PSSYSDBSCHEMES/${link}.json`);
    return [link, hash(write(path, { name: link }))];
  }));
  const packagePath = join(workspace, '.artifacts/package/report.json');
  const packageReceipt = { path: packagePath, sha256: hash(write(packagePath, { worktree })) };
  const wfIdentity = workflowIdentity(runId);
  const wfPath = join(base, 'workflow-schema-unit/report.json');
  const deps = join(dirname(wfPath), 'dependencies');
  write(join(deps, 'exact.jar'), 'controlled dependencies');
  write(join(dirname(wfPath), 'helper-classes/OwnedWorkflowSchemaProbe.class'), 'controlled classes');
  const wfConfig = write(join(dirname(wfPath), 'configuration.private.json'), {
    url: wfIdentity.url, username: wfIdentity.runtimeUser, password: 'a'.repeat(36),
    schema: wfIdentity.schema, schemaUpdate: false,
  });
  const wfProbe = mode => ({
    mode, schema: wfIdentity.schema,
    sqlPrincipal: `${mode === 'bootstrap' ? wfIdentity.bootstrapUser : wfIdentity.runtimeUser}@%`,
    engineBuilt: true, libraryVersion: '6.5.0.1', idmLibraryVersion: '6.5.0.1',
    engineOrigin: 'file:/dependencies/flowable-engine-6.4.2.jar',
    idmOrigin: 'file:/dependencies/flowable-idm-engine-6.4.2.jar',
    ...(mode === 'verify' ? { workflowCompleted: true, probeDeploymentRemoved: true } : {}),
  });
  const generator = path => ({ path, sha256: hash(fs.readFileSync(join(workspace, path))) });
  const wfReport = {
    contract: 'run-owned-workflow-engine-schema-v1', runId, identity: wfIdentity,
    status: 'passed-owned-exact-library-workflow-schema-only', workflowSchemaVerified: true,
    droppedBootstrapUser: true, nativeAcceptance: false, permissionAcceptance: false, sourceClosure: false,
    errors: [], packageReceipt, generator: generator('scripts/bootstrap-owned-workflow-schema.mjs'),
    helperSource: generator('scripts/fixtures/OwnedWorkflowSchemaProbe.java'),
    bootstrap: wfProbe('bootstrap'), verify: wfProbe('verify'),
    dependencies: sourceBuildInputs(deps), helperClasses: sourceBuildInputs(join(dirname(wfPath), 'helper-classes')),
    configuration: { path: relative(workspace, join(dirname(wfPath), 'configuration.private.json')),
      bytes: wfConfig.length, sha256: hash(wfConfig) },
  };
  write(wfPath, wfReport);
  const ebsx = ebsxIdentity(runId);
  const ebsxPath = join(base, 'ebsx-schema-unit/report.json');
  write(join(dirname(ebsxPath), 'helper-classes/OwnedEbsxSchemaProbe.class'), 'controlled classes');
  const permissionProjection = {
    identity: ebsxPermissionProjectionIdentity(runId),
    columns: ['DC', 'ROLE_ID', 'MEMBER_TYPE', 'MEMBER_UID'],
    readOnly: true, accountLocked: true, rows: 6, sourceRowsVerified: true, sourceRowsUnchanged: true,
    grantsSha256: 'b'.repeat(64), sourceRowsSha256: 'c'.repeat(64), viewDefinitionSha256: 'd'.repeat(64),
  };
  const ebsxConfig = write(join(dirname(ebsxPath), 'configuration.private.json'), {
    url: ebsx.url, username: ebsx.runtimeUser, password: 'b'.repeat(36), schema: ebsx.schema, schemaUpdate: false,
    logicalDatasources: ['DEFAULT', 'DB2', 'DB3'], permissionProjection,
  });
  const ebsxProbe = mode => ({
    mode, schema: ebsx.schema, sqlPrincipal: `${mode === 'bootstrap' ? ebsx.bootstrapUser : ebsx.runtimeUser}@%`,
    adapterOrigin: 'file:/dependencies/ibiz-plugin-liquibase-8.1.0.584.1.jar',
    tables: ['JOBS_INFO2', ...Array.from({ length: 77 }, (_, index) => `TABLE_${index}`)],
    primaryKeysVerified: true, columnsVerified: 1000, indicesVerified: 80,
    modelSha256: ebsxModels, mergedModelSha256: 'e'.repeat(64),
    ...(mode === 'bootstrap' ? { adapterReplayPassed: true } : {
      crudVerified: true, runtimeDdlDenied: true, probeRemoved: true, permissionProjectionRows: 6,
      permissionProjectionDmlDenied: true, uaaDirectReadDenied: true,
    }),
  });
  const ebsxReport = {
    contract: 'run-owned-model-ebsx-schema-v1', runId, identity: ebsx,
    status: 'passed-owned-model-ebsx-schema-only', ebsxSchemaVerified: true, droppedBootstrapUser: true,
    permissionProjectionCreated: true, permissionProjection,
    permissionProjectionGrants: { sha256: permissionProjection.grantsSha256 },
    createdUsers: [ebsx.bootstrapUser, ebsx.runtimeUser, permissionProjection.identity.user],
    sourceClosure: false, nativeAcceptance: false, permissionAcceptance: false, errors: [],
    packageReceipt, generator: generator('scripts/bootstrap-owned-ebsx-schema.mjs'),
    helperSource: generator('scripts/fixtures/OwnedEbsxSchemaProbe.java'),
    modelHashes: ebsxModels, bootstrap: ebsxProbe('bootstrap'), verify: ebsxProbe('verify'),
    dependencies: { path: relative(workspace, deps), ...sourceBuildInputs(deps) },
    helperClasses: sourceBuildInputs(join(dirname(ebsxPath), 'helper-classes')),
    configuration: { path: relative(workspace, join(dirname(ebsxPath), 'configuration.private.json')),
      bytes: ebsxConfig.length, sha256: hash(ebsxConfig) },
  };
  write(ebsxPath, ebsxReport);
  write(join(output, 'helper-classes/OwnedPlatformSchemaProbe.class'), 'controlled classes');
  write(join(output, 'probe-inputs/employee-default.json'), queryBytes);
  const projection = platformOperatorProjectionIdentity(runId);
  const sourceColumns = {
    sys_person: ['ID', 'UID', 'DC', 'POSTAL_ADDRESS', 'AVATAR', 'IDENTIFICATION_NUMBER', 'CREATE_TIME',
      'MAIL', 'ENABLED', 'MDEPARTMENT_ID', 'DESCRIPTION', 'DISPLAY_NAME', 'ORGANIZATION_ID', 'MOBILE',
      'STATUS', 'UPDATE_TIME', 'EMPLOYEE_NUMBER', 'TELEPHONE_NUMBER'],
    sys_organization: ['ID', 'ORGANIZATION_NUMBER', 'ORGANIZATION_NAME', 'DC'],
    sys_department: ['ID', 'BUSINESS_CATEGORY', 'DEPARTMENT_NUMBER', 'DEPARTMENT_NAME', 'DC'],
  };
  const configPath = join(output, 'configuration.private.json');
  const config = write(configPath, {
    url: identity.url, username: identity.runtimeUser, password: 'c'.repeat(36), schema: identity.schema,
    schemaUpdate: false, deploySystemId: 'extension',
    runtimeClassName: 'net.ibizsys.central.cloud.saas.extension.runtime.SystemRuntime',
    logicalDatasources: ['DEFAULT'], operatorValuesReady: false,
  });
  const helperContainers = ['compile', 'bootstrap', 'verify'].map((stage, index) => {
    const containerId = (index + 1).toString(16).padStart(64, '0');
    const cidPath = join(output, `${stage}.cid`);
    write(cidPath, containerId);
    return { stage, name: `nf-${runId}-platform-unit-${stage}`, imageId: `sha256:${'a'.repeat(64)}`,
      cidPath, token: 'b'.repeat(36), preAbsent: true, cidFileWasAbsent: true, attempted: true,
      containerId, cidStatus: 'recorded', cleanup: 'already-removed' };
  });
  const report = {
    contract: 'run-owned-native-platform-schema-v1', runId, label: 'unit', identity,
    image: { id: `sha256:${'a'.repeat(64)}` }, helperContainers,
    status: 'passed-owned-native-platform-schema-only', platformSchemaVerified: true,
    droppedBootstrapUser: true, operatorProjectionCreated: true,
    sourceClosure: false, nativeAcceptance: false, permissionAcceptance: false, errors: [],
    createdUsers: [identity.bootstrapUser, identity.runtimeUser, projection.user],
    userJournal: [
      { user: identity.bootstrapUser, host: '%', preAbsent: true, creationAttempted: true, created: true,
        authenticationSha256: platformAuthenticationSha256('a'.repeat(36)) },
      { user: identity.runtimeUser, host: '%', preAbsent: true, creationAttempted: true, created: true,
        authenticationSha256: platformAuthenticationSha256('c'.repeat(36)) },
      { user: projection.user, host: projection.host, preAbsent: true, creationAttempted: true, created: true,
        authenticationSha256: platformAuthenticationSha256('b'.repeat(36)) },
    ],
    packageReceipt, generator: generator('scripts/bootstrap-owned-platform-schema.mjs'),
    helperSource: generator('scripts/fixtures/OwnedPlatformSchemaProbe.java'),
    workflowInput: readOwnedWorkflowConfiguration({ workspace, runId, reportPath: wfPath, packageReceipt }).binding,
    ebsxInput: readOwnedEbsxConfiguration({ workspace, runId, reportPath: ebsxPath, packageReceipt }).binding,
    model, operatorSource: { path: queryFile, sha256: hash(queryBytes) },
    operatorProjection: {
      identity: projection, readOnly: true, accountLocked: true, sourceRowsUnchanged: true,
      passwordMasked: true, columns: sourceColumns,
    },
    operatorProjectionGrants: { sha256: 'b'.repeat(64) },
    operatorProjections: projection.tables.map((table, index) => ({
      table, columns: [...sourceColumns[table], ...(table === 'sys_person' ? ['USER_PASSWORD'] : [])],
      sourceRowsSha256: 'c'.repeat(64), sourceRows: [6, 2, 0][index],
      preAbsent: true, creationAttempted: true, created: true, ownershipMarker: 'e'.repeat(36),
      createSqlSha256: 'f'.repeat(64), viewDefinitionSha256: 'd'.repeat(64), readOnly: true,
    })),
    bootstrap: probeFixture('bootstrap'), verify: probeFixture('verify'),
    dependencies: { path: relative(workspace, deps), ...sourceBuildInputs(deps) },
    helperClasses: sourceBuildInputs(join(output, 'helper-classes')),
    probeInputs: sourceBuildInputs(join(output, 'probe-inputs')),
    configuration: { path: relative(workspace, configPath), bytes: config.length, sha256: hash(config) },
  };
  const reportPath = join(output, 'report.json');
  const save = () => write(reportPath, report);
  save();
  return { workspace, output, deps, worktree, report, save, configPath, wfPath, ebsxPath,
    options: { workspace, runId, reportPath, packageReceipt } };
}

test('platform input binds current model/query/helper/dependency bytes, private config and both predecessor receipts', t => {
  const f = inputFixture(t);
  const result = readOwnedPlatformConfiguration(f.options);
  assert.equal(result.configuration.schema, identity.schema);
  assert.equal(result.configuration.schemaUpdate, false);
  assert.equal(result.configuration.operatorValuesReady, false);
  assert.ok(!JSON.stringify(result.binding).includes('c'.repeat(36)));
});

for (const [name, mutate] of [
  ['failed schema', f => { f.report.platformSchemaVerified = false; }],
  ['retained DDL principal', f => { f.report.droppedBootstrapUser = false; }],
  ['native promotion', f => { f.report.nativeAcceptance = true; }],
  ['permission promotion', f => { f.report.permissionAcceptance = true; }],
  ['foreign package', f => { f.report.packageReceipt.sha256 = 'f'.repeat(64); }],
  ['unexpected physical table', f => { f.report.verify.tables.push('FAKE_TABLE'); }],
  ['missing query dependency', f => { f.report.verify.operatorQuerySha256 = 'a'.repeat(64); }],
  ['exposed password', f => { f.report.verify.operatorPasswordMasked = false; }],
  ['unlocked definer', f => { f.report.operatorProjection.accountLocked = false; }],
  ['changed UAA rows', f => { f.report.operatorProjection.sourceRowsUnchanged = false; }],
  ['unscoped tenant', f => { f.report.verify.operatorUsers[0].centerId = 'shared'; }],
  ['updatable projection', f => { f.report.operatorProjections[0].readOnly = false; }],
  ['source password grant', f => { f.report.operatorProjection.columns.sys_person.push('USER_PASSWORD'); }],
  ['hidden missing operator value', f => { f.report.verify.operatorValuesReady = true; }],
  ['workflow receipt drift', f => fs.appendFileSync(f.wfPath, ' ')],
  ['EBSX receipt drift', f => fs.appendFileSync(f.ebsxPath, ' ')],
  ['model drift', f => fs.appendFileSync(join(f.worktree, modelFile), ' ')],
  ['source query drift', f => fs.appendFileSync(join(f.worktree, queryFile), ' ')],
  ['dependency drift', f => fs.appendFileSync(join(f.deps, 'exact.jar'), 'drift')],
  ['helper class drift', f => fs.appendFileSync(join(f.output, 'helper-classes/OwnedPlatformSchemaProbe.class'), 'drift')],
  ['query input drift', f => fs.appendFileSync(join(f.output, 'probe-inputs/employee-default.json'), ' ')],
  ['public private config', f => fs.chmodSync(f.configPath, 0o644)],
  ['config byte drift', f => fs.appendFileSync(f.configPath, ' ')],
  ['helper cleanup refused', f => { f.report.helperContainers[0].cleanup = 'refused-identity-or-inspection-drift'; }],
  ['unproven helper absence', f => { f.report.helperContainers[0].preAbsent = false; }],
  ['helper CID drift', f => fs.appendFileSync(join(f.output, 'compile.cid'), 'drift')],
  ['missing SQL creation journal', f => { f.report.userJournal.pop(); }],
  ['missing view ownership marker', f => { f.report.operatorProjections[0].ownershipMarker = ''; }],
]) {
  test(`platform input rejects ${name}`, t => {
    const f = inputFixture(t);
    mutate(f);
    f.save();
    assert.throws(() => readOwnedPlatformConfiguration(f.options));
  });
}

test('Java probe validates real tables/query and never creates password-bearing or empty compatibility data', () => {
  const helper = fs.readFileSync(join(original, 'scripts/fixtures/OwnedPlatformSchemaProbe.java'), 'utf8');
  assert.match(helper, /adapter\.sync\(system, runtime, new DataSource\(\), null\)/);
  assert.match(helper, /SELECT \* FROM \(" \+ sql \+ "\) owned_operator ORDER BY USERID/);
  assert.match(helper, /rows\.getObject\("PASSWORD"\) != null/);
  assert.match(helper, /UPDATE " \+ table \+ " SET ID=ID WHERE 1=0/);
  assert.match(helper, /runtimeDdlDenied/);
  assert.match(helper, /Unexpected or missing platform tables/);
  assert.ok(!helper.includes('USER_PASSWORD=?'));
});

function helperFixture() {
  const journal = [];
  const errors = [];
  const commands = [];
  const containers = new Map();
  const cids = new Map();
  const imageId = `sha256:${'a'.repeat(64)}`;
  const label = 'journal-unit';
  const state = { runFailure: false, skipCid: false, throwAfterCreate: false, commands, containers, cids, journal, errors };
  const readCid = path => cids.get(path) ?? null;
  const docker = args => {
    commands.push(args);
    if (args[0] === 'container' && args[1] === 'ls') {
      return { status: 0, stdout: [...containers.values()].map(row =>
        args.includes('{{.ID}}') ? row.Id : row.Name.slice(1)).join('\n') };
    }
    if (args[0] === 'run') {
      const entry = journal.at(-1);
      const id = (containers.size + 1).toString(16).padStart(64, '0');
      const value = { Id: id, Name: `/${entry.name}`, Image: imageId, Config: { Labels: {
        'aibiz.native-fixture.run': runId, 'aibiz.platform.bootstrap': label, 'aibiz.platform.helper': entry.token,
      } } };
      containers.set(id, value);
      if (!state.skipCid) cids.set(entry.cidPath, Buffer.from(id));
      state.onCreate?.(value, entry);
      if (state.throwAfterCreate) throw new Error('Injected CLI transport failure');
      return { status: state.runFailure ? 1 : 0, stdout: '', stderr: '' };
    }
    if (args[0] === 'container' && args[1] === 'inspect') {
      state.onInspect?.(args[2]);
      const value = containers.get(args[2]);
      return value ? { status: 0, stdout: JSON.stringify([value]) }
        : { status: 1, stdout: '[]', stderr: `Error: No such container: ${args[2]}` };
    }
    if (args[0] === 'rm') {
      containers.delete(args[2]);
      return { status: 0, stdout: args[2] };
    }
    throw new Error('Unexpected fake Docker command');
  };
  state.run = (stage = 'compile') => runPlatformHelper({
    runId, label, stage, imageId, args: ['run', '--rm', '--name',
      `nf-${runId}-platform-${label}-${stage}`, imageId],
    cidPath: `/workspace/.artifacts/native-nonadmin-fixtures/${runId}/platform-schema-${label}/${stage}.cid`,
  }, { docker, readCid, journal });
  state.cleanup = () => cleanupPlatformHelpers({ runId, label, journal, errors }, { docker });
  return state;
}

test('helper collision preserves a pre-existing same-name, same-image and same-label container', () => {
  const f = helperFixture();
  const foreignId = 'f'.repeat(64);
  f.containers.set(foreignId, {
    Id: foreignId, Name: `/nf-${runId}-platform-journal-unit-compile`, Image: `sha256:${'a'.repeat(64)}`,
    Config: { Labels: { 'aibiz.native-fixture.run': runId, 'aibiz.platform.bootstrap': 'journal-unit' } },
  });
  assert.throws(() => f.run(), /existing helper/);
  f.cleanup();
  assert.ok(f.containers.has(foreignId));
  assert.ok(!f.commands.some(args => args[0] === 'run' || args[0] === 'rm'));
  assert.equal(f.journal[0].cleanup, 'not-authorized-without-created-cid');
});

test('failed helper creation records CID before cleanup and removes only its immutable ID', () => {
  const f = helperFixture();
  f.runFailure = true;
  const { entry } = f.run();
  assert.match(entry.containerId, /^[a-f0-9]{64}$/);
  f.cleanup();
  assert.equal(entry.cleanup, 'removed-exact-created-id');
  assert.deepEqual(f.commands.filter(args => args[0] === 'rm'), [['rm', '--force', entry.containerId]]);
  assert.equal(f.errors.length, 0);
});

test('helper CLI throw after create still records the CID in finally for exact-ID cleanup', () => {
  const f = helperFixture();
  f.throwAfterCreate = true;
  assert.throws(() => f.run(), /transport failure/);
  assert.ok(f.journal[0].containerId);
  f.cleanup();
  assert.equal(f.containers.size, 0);
});

test('missing/invalid CID never authorizes name-based cleanup, including concurrent collisions', () => {
  for (const mode of ['missing', 'invalid', 'success-missing']) {
    const f = helperFixture();
    f.skipCid = true;
    f.runFailure = mode !== 'success-missing';
    f.onCreate = (container, entry) => {
      container.Config.Labels['aibiz.platform.helper'] = 'foreign-attempt';
      if (mode === 'invalid') f.cids.set(entry.cidPath, Buffer.from(''));
    };
    if (mode === 'success-missing') assert.throws(() => f.run(), /exact CID evidence/);
    else f.run();
    f.cleanup();
    assert.equal(f.containers.size, 1);
    assert.ok(!f.commands.some(args => args[0] === 'rm' || args[1] === 'inspect'));
  }
});

test('existing CID file is never overwritten or adopted as creation evidence', () => {
  const f = helperFixture();
  f.cids.set(`/workspace/.artifacts/native-nonadmin-fixtures/${runId}/platform-schema-journal-unit/compile.cid`,
    Buffer.from('f'.repeat(64)));
  assert.throws(() => f.run(), /CID evidence/);
  f.cleanup();
  assert.ok(!f.commands.some(args => args[0] === 'run' || args[0] === 'rm'));
});

test('helper cleanup catches one foreign identity and continues cleaning other owned IDs', () => {
  const f = helperFixture();
  const first = f.run('compile').entry;
  const second = f.run('bootstrap').entry;
  f.containers.get(second.containerId).Config.Labels['aibiz.platform.helper'] = 'foreign';
  f.cleanup();
  assert.equal(first.cleanup, 'removed-exact-created-id');
  assert.equal(second.cleanup, 'refused-identity-or-inspection-drift');
  assert.ok(f.containers.has(second.containerId));
  assert.equal(f.errors.length, 1);
});

test('helper cleanup distinguishes proven --rm absence from daemon inspection failures', () => {
  const f = helperFixture();
  const first = f.run('compile').entry;
  const second = f.run('bootstrap').entry;
  f.containers.delete(first.containerId);
  f.onInspect = id => { if (id === second.containerId) throw new Error('Daemon unavailable'); };
  f.cleanup();
  assert.equal(first.cleanup, 'already-removed');
  assert.equal(second.cleanup, 'refused-identity-or-inspection-drift');
  assert.equal(f.errors.length, 1);
});

function sqlCleanupFixture(t) {
  const f = inputFixture(t);
  const projection = platformOperatorProjectionIdentity(runId);
  const users = new Map(f.report.userJournal.map(entry => {
    const mode = entry.user === identity.bootstrapUser ? 'bootstrap' : 'verify';
    const grants = [`GRANT USAGE ON *.* TO '${entry.user}'@'${entry.host}'`,
      ...(entry.user === projection.user ? platformOperatorProjectionGrantSQL(runId).map(line => line.slice(0, -1))
        : [platformGrantSQL(identity, mode).slice(0, -1)])].join('\n');
    return [entry.user, { grants, actual: {
      user: entry.user, host: entry.host, plugin: 'mysql_native_password',
      authenticationSha256: entry.authenticationSha256,
      accountLocked: entry.user === projection.user ? 'Y' : 'N',
    } }];
  }));
  f.report.operatorProjectionGrants = { sha256: hash(users.get(projection.user).grants) };
  const views = new Map(f.report.operatorProjections.map(row => {
    const ddl = `owned ddl ${row.table}`;
    row.viewDefinitionSha256 = hash(ddl);
    return [row.table, { ddl, columns: [...row.columns], actual: {
      schema: projection.targetSchema, table: row.table, definer: `${projection.user}@${projection.host}`,
      security: 'DEFINER', updatable: 'NO', definition: 'select distinct fields from '
        + `\`${projection.sourceSchema}\`.\`${row.table}\` where ('${row.ownershipMarker}' = '${row.ownershipMarker}')`,
    } }];
  }));
  const commands = [];
  const mutations = [];
  const state = { ...f, users, views, commands, mutations, processCount: '0' };
  const sql = statement => {
    commands.push(statement);
    state.onSql?.(statement);
    const user = statement.match(/(?:User|USER)='([^']+)'/)?.[1]
      ?? statement.match(/(?:FOR|USER) '([^']+)'@/)?.[1];
    const table = statement.match(/table_name='([^']+)'/)?.[1]
      ?? statement.match(/VIEW `[^`]+`\.`([^`]+)`/)?.[1];
    if (statement.startsWith('SELECT COUNT(*) FROM mysql.user')) return users.has(user) ? '1' : '0';
    if (statement.includes("'authenticationSha256',SHA2")) return JSON.stringify(users.get(user).actual);
    if (statement.startsWith('SHOW GRANTS')) return users.get(user).grants;
    if (statement.includes('information_schema.PROCESSLIST')) return state.processCount;
    if (statement.startsWith('SELECT COUNT(*) FROM information_schema.tables')) return views.has(table) ? '1' : '0';
    if (statement.includes("WHERE DEFINER=")) {
      return [...views.values()].map(value => JSON.stringify({
        schema: value.actual.schema, table: value.actual.table,
      })).join('\n');
    }
    if (statement.includes('FROM information_schema.views')) return JSON.stringify(views.get(table).actual);
    if (statement.startsWith('SELECT JSON_QUOTE(COLUMN_NAME)')) return views.get(table).columns.map(column => JSON.stringify(column)).join('\n');
    if (statement.startsWith('SHOW CREATE VIEW')) return views.get(table).ddl;
    if (statement.startsWith('DROP VIEW')) { mutations.push(statement); views.delete(table); return ''; }
    if (statement.startsWith('DROP USER')) { mutations.push(statement); users.delete(user); return ''; }
    throw new Error('Unexpected fake SQL');
  };
  state.cleanup = () => cleanupPlatformSqlResources({ runId, receipt: f.report }, { sql });
  return state;
}

test('SQL cleanup recovers an account after GRANT succeeded but its grant receipt was not captured', t => {
  const f = sqlCleanupFixture(t);
  f.report.userJournal[1].created = false;
  f.report.createdUsers = f.report.createdUsers.filter(user => user !== identity.runtimeUser);
  const result = f.cleanup();
  assert.equal(result.status, 'passed-owned-platform-account-cleanup');
  assert.equal(result.removed.length, 3);
  assert.equal(result.droppedOperatorProjections.length, 3);
  assert.equal(f.users.size, 0);
  assert.equal(f.views.size, 0);
});

test('partial definer grants without a hash are limited to reviewed column-level SELECT subsets', t => {
  const f = sqlCleanupFixture(t);
  const projection = platformOperatorProjectionIdentity(runId);
  f.report.operatorProjections = [];
  delete f.report.operatorProjectionGrants;
  f.views.clear();
  f.users.get(projection.user).grants = [
    `GRANT USAGE ON *.* TO '${projection.user}'@'${projection.host}'`,
    platformOperatorProjectionGrantSQL(runId)[0].slice(0, -1),
  ].join('\n');
  assert.equal(f.cleanup().status, 'passed-owned-platform-account-cleanup');
  assert.equal(f.users.size, 0);
});

test('CREATE VIEW success followed by SHOW CREATE failure remains owned and cleanable through its journal marker', t => {
  const f = sqlCleanupFixture(t);
  const row = f.report.operatorProjections[0];
  row.created = false;
  row.readOnly = false;
  row.viewDefinitionSha256 = null;
  const result = f.cleanup();
  assert.equal(result.status, 'passed-owned-platform-account-cleanup');
  assert.equal(result.droppedOperatorProjections.length, 3);
});

test('cleanup never drops a colliding view without this attempt marker or a colliding user credential', t => {
  for (const mode of ['view', 'user']) {
    const f = sqlCleanupFixture(t);
    if (mode === 'view') {
      f.report.operatorProjections[0].viewDefinitionSha256 = null;
      f.views.get('sys_person').actual.definition = f.views.get('sys_person').actual.definition.replaceAll('e'.repeat(36), 'foreign');
    } else f.users.get(identity.runtimeUser).actual.authenticationSha256 = 'f'.repeat(64);
    assert.equal(f.cleanup().status, 'failed');
    assert.deepEqual(f.mutations, []);
  }
});

test('cleanup rejects unrecorded excessive grants, missing tenant fields and active consumers before any drop', t => {
  for (const mode of ['grant', 'column', 'active']) {
    const f = sqlCleanupFixture(t);
    if (mode === 'grant') f.users.get(identity.runtimeUser).grants += `\nGRANT ALL PRIVILEGES ON *.* TO '${identity.runtimeUser}'@'%'`;
    else if (mode === 'column') f.views.get('sys_person').columns = f.views.get('sys_person').columns.filter(column => column !== 'DC');
    else f.processCount = '1';
    assert.equal(f.cleanup().status, 'failed');
    assert.deepEqual(f.mutations, []);
  }
});

test('cleanup validates journal identifiers before issuing SQL and records malformed receipt failure', t => {
  const f = sqlCleanupFixture(t);
  f.report.userJournal[0].user = "'; DROP DATABASE shared;--";
  assert.equal(f.cleanup().status, 'failed');
  assert.deepEqual(f.commands, []);
  assert.deepEqual(f.mutations, []);
});

test('partial SQL deletion failure retains definer and supports a later exact-state cleanup', t => {
  const f = sqlCleanupFixture(t);
  f.onSql = statement => { if (statement.startsWith('DROP USER')) throw new Error('Injected DROP transport failure'); };
  assert.equal(f.cleanup().status, 'failed');
  assert.equal(f.views.size, 0);
  assert.equal(f.users.size, 3);
  f.onSql = null;
  assert.equal(f.cleanup().status, 'passed-owned-platform-account-cleanup');
  assert.equal(f.users.size, 0);
  const repeated = f.cleanup();
  assert.equal(repeated.status, 'passed-owned-platform-account-cleanup');
  assert.deepEqual(repeated.removed, []);
});

test('account and view cleanup proofs reject foreign identities, broadened projection columns and absent creation markers', t => {
  const f = sqlCleanupFixture(t);
  const entry = f.report.userJournal[1];
  verifyPlatformUserOwnership(runId, entry, f.users.get(entry.user).actual);
  assert.throws(() => verifyPlatformUserOwnership(runId, entry, { ...f.users.get(entry.user).actual, accountLocked: 'Y' }));
  const row = f.report.operatorProjections[0];
  const actual = f.views.get(row.table);
  verifyPlatformViewCleanup(runId, row, actual.actual, actual.columns, hash(actual.ddl));
  assert.throws(() => verifyPlatformViewCleanup(runId, { ...row, preAbsent: false }, actual.actual, actual.columns, hash(actual.ddl)));
  assert.throws(() => verifyPlatformViewCleanup(runId, row, actual.actual, [...actual.columns, 'SECRET'], hash(actual.ddl)));
});

function targetGuardFixture() {
  const workspace = '/workspace';
  const base = join(workspace, '.artifacts/native-nonadmin-fixtures', runId);
  const path = join(base, 'backend-runtime-unit/deployment-input.private.json');
  const manifest = manifestFixture();
  const resources = { networkId: 'a'.repeat(64), mysqlId: 'b'.repeat(64) };
  const manifestSha256 = hash(JSON.stringify(manifest));
  const resourcesSha256 = hash(JSON.stringify(resources));
  const state = { guardCalls: 0, closes: 0, opens: 0, mysqlCalls: 0 };
  const runtime = {
    base, manifest: structuredClone(manifest), resources: structuredClone(resources),
    bindings: [
      { path: join(base, 'manifest.json'), sha256: manifestSha256, bytes: 100 },
      { path: join(base, 'owned-resources.json'), sha256: resourcesSha256, bytes: 200 },
      { path, sha256: 'c'.repeat(64), bytes: 300 },
    ],
    deployment: { runId, services: Object.fromEntries(['allinone', 'gateway', 'provider', 'uaa'].map(role => [role, {}])),
      auxiliaryContainers: ['nacos', 'redis', 'zookeeper'].map(role => ({ role })) },
    guard: () => {
      state.guardCalls++;
      state.onGuard?.();
      return { containers: Array.from({ length: state.nodeCount ?? 8 }, (_, index) => ({
        Id: index.toString(16).padStart(64, '0'),
      })), network: { Id: resources.networkId } };
    },
    close: () => { state.closes++; },
  };
  const options = { workspace, runId, manifest, resources, manifestSha256, resourcesSha256, deploymentInput: path };
  const adapters = {
    mysqlGuard: () => { state.mysqlCalls++; throw new Error('Mysql-only rejects retained integration peers'); },
    openRuntime: actual => {
      state.opens++;
      assert.deepEqual(actual, { workspace, runId, deploymentInput: path });
      return runtime;
    },
  };
  return { options, adapters, state, runtime };
}

test('platform target defaults to the unchanged mysql-only guard and never discovers a deployment implicitly', () => {
  const f = targetGuardFixture();
  delete f.options.deploymentInput;
  const target = createPlatformTargetGuard(f.options, f.adapters);
  assert.deepEqual(target.binding, { mode: 'mysql-only' });
  assert.throws(() => target.guard(), /retained integration peers/);
  target.close();
  assert.equal(f.state.opens, 0);
  assert.equal(f.state.mysqlCalls, 1);
  assert.equal(f.state.closes, 0);
});

test('explicit owned deployment target binds current manifest/resource bytes and reinspects exact eight-node runtime on every guard', () => {
  const f = targetGuardFixture();
  const target = createPlatformTargetGuard(f.options, f.adapters);
  assert.equal(target.binding.mode, 'exact-owned-backend');
  assert.equal(target.binding.backendNodes, 8);
  assert.deepEqual(target.binding.deploymentInput, f.runtime.bindings[2]);
  assert.equal(f.state.guardCalls, 1);
  target.guard();
  target.guard();
  assert.equal(f.state.guardCalls, 3);
  assert.equal(f.state.mysqlCalls, 0);
  f.state.onGuard = () => { throw new Error('Lifecycle/input/volume drift'); };
  assert.throws(() => target.guard(), /Lifecycle\/input\/volume drift/);
  target.close();
  assert.equal(f.state.closes, 1);
});

test('explicit deployment paths cannot select a shared, other-run or arbitrary private input and never fall back', () => {
  for (const path of ['', null, '/tmp/deployment-input.private.json',
    '/workspace/.artifacts/native-nonadmin-fixtures/000000000000/backend-runtime-unit/deployment-input.private.json',
    `/workspace/.artifacts/native-nonadmin-fixtures/${runId}/backend-runtime-unit/shared.json`,
  ]) {
    const f = targetGuardFixture();
    f.options.deploymentInput = path;
    assert.throws(() => createPlatformTargetGuard(f.options, f.adapters));
    assert.equal(f.state.opens, 0);
    assert.equal(f.state.mysqlCalls, 0);
  }
});

test('retained target refuses changed manifest/resources, bound bytes, undeclared peers and incomplete roles, closing its context', () => {
  for (const change of [
    f => { f.runtime.manifest.schemas.uaa = 'shared'; },
    f => { f.runtime.resources.mysqlId = 'f'.repeat(64); },
    f => { f.runtime.bindings[0].sha256 = 'f'.repeat(64); },
    f => { f.runtime.bindings[1].sha256 = 'f'.repeat(64); },
    f => { f.runtime.deployment.auxiliaryContainers.pop(); },
    f => { delete f.runtime.deployment.services.uaa; },
    f => { f.state.nodeCount = 9; },
    f => { f.state.nodeCount = 7; },
    f => { f.state.onGuard = () => { throw new Error('Runtime refused'); }; },
  ]) {
    const f = targetGuardFixture();
    change(f);
    assert.throws(() => createPlatformTargetGuard(f.options, f.adapters));
    assert.equal(f.state.mysqlCalls, 0);
    assert.equal(f.state.closes, 1);
  }
});

test('retained runtime objects are cross-bound again before later schema operations', () => {
  const f = targetGuardFixture();
  const target = createPlatformTargetGuard(f.options, f.adapters);
  f.runtime.resources.mysqlId = 'e'.repeat(64);
  assert.throws(() => target.guard());
  assert.equal(f.state.guardCalls, 1, 'Cross-binding fails before a potentially substituted runtime inspection');
  target.close();
});

function resumeReceiptFixture(t) {
  const f = inputFixture(t);
  const previous = structuredClone(f.report);
  Object.assign(previous, {
    status: 'failed', errors: ['Previous SHOW GRANTS formatting failure'], createdSchema: true,
    droppedBootstrapUser: false, platformSchemaVerified: false, operatorProjectionCreated: false,
    commands: [{ stage: 'compile', exitCode: 0 }, { stage: 'bootstrap', exitCode: 0 }],
  });
  previous.helperContainers.pop();
  delete previous.verify;
  delete previous.configuration;
  delete previous.operatorProjections;
  const options = {
    report: previous, runId, label: 'resume-unit', model: f.report.model,
    operatorSource: f.report.operatorSource, packageReceipt: f.report.packageReceipt,
    workflowInput: f.report.workflowInput, ebsxInput: f.report.ebsxInput,
    targetGuard: f.report.targetGuard, helperSource: f.report.helperSource,
    dependencies: f.report.dependencies,
    passwords: { bootstrap: 'a'.repeat(36), verify: 'c'.repeat(36), projection: 'b'.repeat(36) },
  };
  return { ...f, previous, options };
}

test('reviewed resume accepts only a failed native bootstrap with exact source/predecessor bindings and provable unused principals', t => {
  const f = resumeReceiptFixture(t);
  verifyPlatformResumeReceipt(f.options);
  for (const change of [
    o => { o.label = o.report.label; },
    o => { o.report.status = 'passed-owned-native-platform-schema-only'; },
    o => { o.report.bootstrap.adapterReplayPassed = false; },
    o => { o.report.verify = probeFixture('verify'); },
    o => { o.report.configuration = {}; },
    o => { o.report.operatorProjections = [{ table: 'sys_person' }]; },
    o => { o.report.createdUsers.pop(); },
    o => { o.report.userJournal[0].authenticationSha256 = 'f'.repeat(64); },
    o => { o.passwords.verify = 'e'.repeat(36); },
    o => { o.report.helperContainers[0].cleanup = 'refused-identity-or-inspection-drift'; },
    o => { o.report.commands[1].exitCode = 1; },
    o => { o.report.packageReceipt.sha256 = 'e'.repeat(64); },
  ]) {
    const options = structuredClone(f.options);
    change(options);
    assert.throws(() => verifyPlatformResumeReceipt(options));
  }
});

function emptySchemaFixture() {
  const physical = JSON.parse(modelBytes);
  const types = { 5: 'datetime', 9: 'int', 21: 'mediumtext', 25: 'varchar' };
  const tables = physical.getAllPSSysDBTables.filter(table => table.getAllPSSysDBColumns);
  const inventory = {
    tables: [...tables.map(table => ({ name: table.name.toLowerCase(), kind: 'BASE TABLE' })),
      { name: 'databasechangelog', kind: 'BASE TABLE' }, { name: 'databasechangeloglock', kind: 'BASE TABLE' }],
    columns: tables.flatMap(table => table.getAllPSSysDBColumns.map(column => ({
      table: table.name.toLowerCase(), name: column.name.toLowerCase(), type: types[column.stdDataType],
      nullable: column.pKey || column.nullable === false ? 'NO' : 'YES', primary: column.pKey === true,
      extra: '', length: column.stdDataType === 25 ? column.length : null,
    }))),
    indices: tables.flatMap(table => [
      { table: table.name.toLowerCase(), name: 'PRIMARY', column: 'id', position: 1,
        nonUnique: 0, prefix: null, type: 'BTREE' },
      ...(table.getAllPSSysDBIndices ?? []).flatMap(index => index.getAllPSSysDBIndexColumns.map((column, position) => ({
        table: table.name.toLowerCase(), name: index.codeName.toLowerCase(), column: column.name.toLowerCase(),
        position: position + 1, nonUnique: 1, prefix: null, type: 'BTREE',
      }))),
    ]).sort((a, b) => a.table.localeCompare(b.table) || a.name.localeCompare(b.name) || a.position - b.position),
    counts: tables.map(table => ({ table: table.name, rows: 0 })),
    ancillary: { triggers: 0, routines: 0, events: 0, foreignKeys: 0 }, changelogUnlocked: true,
  };
  return { physical, inventory };
}

test('resume inventory requires all 32 application tables empty and exact source columns, primary keys and indices', () => {
  const f = emptySchemaFixture();
  const receipt = verifyPlatformEmptySchema(f.physical, f.inventory);
  assert.equal(receipt.tables, 32);
  assert.equal(receipt.columns, 596);
  assert.equal(receipt.indices, 33);
  assert.equal(receipt.applicationRows, 0);
  for (const change of [
    i => { i.counts[0].rows = 1; }, i => { i.tables.push({ name: 'unreviewed', kind: 'BASE TABLE' }); },
    i => { i.tables[0].kind = 'VIEW'; }, i => { i.columns.pop(); },
    i => { i.columns[0].type = 'blob'; }, i => { i.columns[0].nullable = 'NO'; },
    i => { i.columns.find(row => row.primary).primary = false; }, i => { i.columns[0].extra = 'auto_increment'; },
    i => { i.columns.find(row => row.type === 'varchar').length++; }, i => { i.indices.pop(); },
    i => { i.indices[0].prefix = 1; }, i => { i.indices[0].nonUnique = 2; },
    i => { i.ancillary.triggers = 1; }, i => { i.ancillary.foreignKeys = 1; },
    i => { i.changelogUnlocked = false; },
  ]) {
    const inventory = structuredClone(f.inventory);
    change(inventory);
    assert.throws(() => verifyPlatformEmptySchema(f.physical, inventory));
  }
});

test('resume time/integer/nullability expectations follow native DataTypes and the actual MySQL Liquibase adapter', () => {
  const types = fs.readFileSync(join(original,
    'ibiz-service-hub/libs/ibiz-runtime/src/main/java/net/ibizsys/runtime/util/DataTypes.java'), 'utf8');
  const adapter = fs.readFileSync(join(original,
    'ibiz-service-hub/libs/ibiz-plugin-liquibase/src/main/java/net/ibizsys/central/plugin/liquibase/spring/LiquibaseTool.java'), 'utf8');
  assert.match(types, /int DATETIME = 5;/);
  assert.match(types, /int INT = 9;/);
  assert.match(types, /int TEXT = 21;/);
  assert.match(types, /int VARCHAR = 25;/);
  assert.match(adapter, /dataTypeMap\.put\("TEXT\.MYSQL", "MEDIUMTEXT"\)/);
  assert.match(adapter, /if \(iPSSysDBColumn\.isPKey\(\) \|\| !iPSSysDBColumn\.isNullable\(\)\)/);
  const f = emptySchemaFixture();
  assert.equal(f.inventory.columns.find(row => row.table === 'app_view_theme' && row.name === 'create_time').type, 'datetime');
  assert.equal(f.inventory.columns.find(row => row.table === 'app_view_theme' && row.name === 'order_value').type, 'int');
  assert.equal(f.inventory.columns.find(row => row.table === 'app_view_theme' && row.name === 'id').nullable, 'NO');
  verifyPlatformEmptySchema(f.physical, f.inventory);
  for (const [name, wrong] of [['create_time', 'int'], ['order_value', 'datetime']]) {
    const changed = structuredClone(f.inventory);
    changed.columns.find(row => row.table === 'app_view_theme' && row.name === name).type = wrong;
    assert.throws(() => verifyPlatformEmptySchema(f.physical, changed), /Resume column type differs/);
  }
});

test('actual MySQL JSON_OBJECT column booleans and COUNT numbers normalize strictly without losing primary keys', () => {
  const columnJson = [
    '{"table":"app_view_theme","name":"id","type":"varchar","nullable":"NO","primary":true,"length":100,"extra":""}',
    '{"table":"app_view_theme","name":"create_time","type":"datetime","nullable":"YES","primary":false,"length":null,"extra":""}',
    '{"table":"data_source","name":"id","type":"varchar","nullable":"NO","primary":1,"length":100,"extra":""}',
    '{"table":"data_source","name":"valid_flag","type":"int","nullable":"YES","primary":0,"length":null,"extra":""}',
  ].join('\n');
  const countJson = '{"table":"APP_VIEW_THEME","rows":0}\n{"table":"DATA_SOURCE","rows":0}';
  const parsed = { columns: columnJson.split('\n').map(row => JSON.parse(row)),
    counts: countJson.split('\n').map(row => JSON.parse(row)) };
  const normalized = normalizePlatformSchemaRows(parsed);
  assert.deepEqual(normalized.columns.map(row => row.primary), [true, false, true, false]);
  assert.ok(normalized.counts.every(row => row.rows === 0 && typeof row.rows === 'number'));
  assert.equal(parsed.columns[2].primary, 1, 'Normalization must not rewrite raw SQL evidence');
  for (const value of ['true', 'false', '0', '1', 2, -1, null, undefined]) {
    const changed = structuredClone(parsed);
    changed.columns[0].primary = value;
    assert.throws(() => normalizePlatformSchemaRows(changed), /app_view_theme\.id/);
  }
  for (const value of ['0', false, null, undefined, -1, 0.5, Number.MAX_SAFE_INTEGER + 1]) {
    const changed = structuredClone(parsed);
    changed.counts[0].rows = value;
    assert.throws(() => normalizePlatformSchemaRows(changed), /APP_VIEW_THEME/);
  }
  const f = emptySchemaFixture();
  const raw = structuredClone(f.inventory);
  raw.columns = raw.columns.map(row => ({ ...row, primary: row.primary ? 1 : 0 }));
  verifyPlatformEmptySchema(f.physical, normalizePlatformSchemaRows(raw));
});

test('earlier failed cleanup cannot drop a definer now used by resumed receipt views', t => {
  const f = sqlCleanupFixture(t);
  f.report.operatorProjections = [];
  assert.equal(f.cleanup().status, 'failed');
  assert.deepEqual(f.mutations, []);
  assert.equal(f.views.size, 3);
  assert.equal(f.users.size, 3);
});

test('a successful resumed configuration retains an immutable predecessor receipt and private credential binding', t => {
  for (const mode of ['valid', 'previous-bytes', 'credential-bytes', 'previous-promoted']) {
    const f = resumeReceiptFixture(t);
    const previousDirectory = join(dirname(f.output), 'platform-schema-previous');
    fs.mkdirSync(previousDirectory, { mode: 0o700 });
    f.previous.label = 'previous';
    for (const entry of f.previous.helperContainers) entry.name = `nf-${runId}-platform-previous-${entry.stage}`;
    const previousPath = join(previousDirectory, 'report.json');
    const previousBytes = Buffer.from(JSON.stringify(f.previous));
    fs.writeFileSync(previousPath, previousBytes, { mode: 0o600 });
    const credentialPath = join(previousDirectory, 'credentials.private.json');
    const credentialBytes = Buffer.from(JSON.stringify({ passwords: f.options.passwords }));
    fs.writeFileSync(credentialPath, credentialBytes, { mode: 0o600 });
    f.report.resumeInput = {
      path: relative(f.workspace, previousPath), sha256: hash(previousBytes),
      previousGenerator: f.previous.generator, credentialsSha256: hash(credentialBytes),
      emptySchema: { tables: 32, columns: f.report.bootstrap.columnsVerified,
        indices: f.report.bootstrap.indicesVerified, applicationRows: 0, changelogUnlocked: true,
        structuralSha256: 'd'.repeat(64) },
    };
    if (mode === 'previous-bytes') fs.appendFileSync(previousPath, ' ');
    if (mode === 'credential-bytes') fs.appendFileSync(credentialPath, ' ');
    if (mode === 'previous-promoted') {
      f.previous.nativeAcceptance = true;
      const changed = Buffer.from(JSON.stringify(f.previous));
      fs.writeFileSync(previousPath, changed);
      f.report.resumeInput.sha256 = hash(changed);
    }
    f.save();
    const options = { workspace: f.workspace, runId, reportPath: join(f.output, 'report.json'),
      packageReceipt: f.report.packageReceipt };
    if (mode === 'valid') assert.equal(readOwnedPlatformConfiguration(options).configuration.schema, identity.schema);
    else assert.throws(() => readOwnedPlatformConfiguration(options));
  }
});

function uaaReplacementFixture() {
  const workspace = '/workspace';
  const base = join(workspace, '.artifacts/native-nonadmin-fixtures', runId);
  const manifest = manifestFixture();
  const resources = { contract: 'run-owned-native-fixture-resources-v1', runId,
    schemas: { uaa: manifest.schemas.uaa }, mysqlId: 'a'.repeat(64), networkId: 'b'.repeat(64) };
  const binding = (path, value) => {
    const bytes = Buffer.from(JSON.stringify(value));
    return { path, sha256: hash(bytes), bytes: bytes.length };
  };
  const oldDeployment = {
    contract: 'run-owned-native-permission-deployment-input-v2', runId,
    imageReceipt: { path: '/workspace/.artifacts/images/report.json', sha256: 'a'.repeat(64) },
    services: {
      allinone: { containerId: '1'.repeat(64), imageId: `sha256:${'1'.repeat(64)}` },
      gateway: { containerId: '2'.repeat(64), imageId: `sha256:${'2'.repeat(64)}` },
      provider: { containerId: '3'.repeat(64), imageId: `sha256:${'3'.repeat(64)}` },
      uaa: { containerId: '4'.repeat(64), imageId: `sha256:${'4'.repeat(64)}` },
    },
    auxiliaryContainers: ['redis', 'nacos', 'zookeeper'].map((role, index) => ({
      role, containerId: String(index + 5).repeat(64), imageId: `sha256:${String(index + 5).repeat(64)}`,
    })),
    endpoints: {
      backend: { service: 'gateway', containerId: '2'.repeat(64), ipv4: '10.91.0.5' },
      uaa: { transport: 'private-inspected-ipv4', service: 'uaa', containerId: '4'.repeat(64),
        networkId: resources.networkId, endpointId: '8'.repeat(64), ipv4: '10.91.0.4', containerPort: 32666 },
    },
  };
  const newDeployment = structuredClone(oldDeployment);
  newDeployment.services.uaa = { containerId: '9'.repeat(64), imageId: `sha256:${'9'.repeat(64)}` };
  Object.assign(newDeployment.endpoints.uaa, { containerId: '9'.repeat(64), endpointId: 'c'.repeat(64) });
  const oldDeploymentBinding = binding(join(base, 'backend-runtime-uaa-old/deployment-input.private.json'), oldDeployment);
  const newDeploymentBinding = binding(join(base, 'backend-runtime-uaa-new/deployment-input.private.json'), newDeployment);
  const previousTarget = { mode: 'exact-owned-backend', deploymentInput: oldDeploymentBinding, backendNodes: 8 };
  const currentTarget = { mode: 'exact-owned-backend', deploymentInput: newDeploymentBinding, backendNodes: 8 };
  const manifestBinding = binding(join(base, 'manifest.json'), manifest);
  const resourcesBinding = binding(join(base, 'owned-resources.json'), resources);
  const replacement = {
    contract: 'owned-source-uaa-replacement-v1', runId, status: 'passed-owned-uaa-security-and-replacement',
    protectedPeersUnchanged: true, oldUaaStopped: true, oldUaaDetached: true, oldUaaRetainedForRollback: true,
    nativeAcceptance: false, permissionAcceptance: false, sharedServicesChanged: false, errors: [], rollback: null,
    inputs: structuredClone([oldDeploymentBinding, manifestBinding, resourcesBinding]),
    deploymentInput: { path: newDeploymentBinding.path, sha256: newDeploymentBinding.sha256 },
    oldUaa: { id: oldDeployment.services.uaa.containerId, imageId: oldDeployment.services.uaa.imageId },
    newUaaId: newDeployment.services.uaa.containerId, runtime: { imageId: newDeployment.services.uaa.imageId },
    securityChecks: ['anonymous-user-info-self-denied', 'signed-security-positive-control',
      'tampered-signature-token-denied', 'expired-signed-token-denied',
      ...manifest.users.flatMap(user => [`${user.loginname}-wrong-password-denied`, `${user.loginname}-login-and-self`])]
      .map(id => ({ id, status: 'pass' })),
  };
  const replacementBinding = binding(join(dirname(newDeploymentBinding.path), 'report.json'), replacement);
  return { workspace, runId, manifest, resources, previousTarget, currentTarget, replacement, replacementBinding,
    manifestBinding, resourcesBinding, oldDeployment, newDeployment, oldDeploymentBinding, newDeploymentBinding };
}

test('explicit reviewed UAA replacement permits only its exact service and endpoint identities while preserving old-target provenance', t => {
  const proof = uaaReplacementFixture();
  const result = verifyPlatformResumeUaaReplacement(proof);
  assert.deepEqual(result.previousTarget, proof.previousTarget);
  assert.deepEqual(result.currentTarget, proof.currentTarget);
  assert.deepEqual(result.replacementReport, proof.replacementBinding);
  const f = resumeReceiptFixture(t);
  f.options.report.targetGuard = proof.previousTarget;
  f.options.targetGuard = proof.currentTarget;
  assert.throws(() => verifyPlatformResumeReceipt(f.options), 'Target changes are never implicit');
  verifyPlatformResumeReceipt({ ...f.options, uaaReplacement: proof });
});

test('reviewed UAA replacement rejects failed security, protected-peer drift, foreign source bindings and non-UAA deployment changes', () => {
  for (const change of [
    f => { f.replacement.status = 'failed-owned-uaa-replacement'; },
    f => { f.replacement.securityChecks.pop(); },
    f => { f.replacement.securityChecks[0].status = 'fail'; },
    f => { f.replacement.securityChecks[0].id = f.replacement.securityChecks[1].id; },
    f => { f.replacement.protectedPeersUnchanged = false; },
    f => { f.replacement.sharedServicesChanged = true; },
    f => { f.replacement.oldUaa.id = 'f'.repeat(64); },
    f => { f.replacement.oldUaa.imageId = `sha256:${'f'.repeat(64)}`; },
    f => { f.replacement.newUaaId = 'e'.repeat(64); },
    f => { f.replacement.runtime.imageId = `sha256:${'f'.repeat(64)}`; },
    f => { f.replacement.inputs[0].sha256 = 'e'.repeat(64); },
    f => { f.replacement.inputs[1].sha256 = 'f'.repeat(64); },
    f => { f.replacement.inputs[2].sha256 = 'f'.repeat(64); },
    f => { f.replacement.deploymentInput.sha256 = 'f'.repeat(64); },
    f => { f.replacementBinding.path = '/tmp/report.json'; },
    f => { f.newDeployment.services.provider.containerId = 'f'.repeat(64); },
    f => { f.newDeployment.services.allinone.imageId = `sha256:${'f'.repeat(64)}`; },
    f => { f.newDeployment.services.uaa.other = 'unreviewed'; },
    f => { f.newDeployment.endpoints.uaa.ipv4 = '10.91.0.99'; },
    f => { f.newDeployment.endpoints.backend.ipv4 = '10.91.0.99'; },
    f => { f.newDeployment.auxiliaryContainers[0].containerId = 'f'.repeat(64); },
    f => { f.newDeployment.runId = '000000000000'; },
    f => { f.currentTarget.mode = 'mysql-only'; },
    f => { f.resources.runId = '000000000000'; },
  ]) {
    const proof = uaaReplacementFixture();
    change(proof);
    assert.throws(() => verifyPlatformResumeUaaReplacement(proof));
  }
});
