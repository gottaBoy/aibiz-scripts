import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  ebsxGrantSQL, ebsxIdentity, ebsxProbeCommand, readOwnedEbsxConfiguration, verifyEbsxGrants, verifyEbsxProbe,
  ebsxPermissionProjectionIdentity, ebsxPermissionProjectionGrantSQL,
  ebsxPermissionProjectionViewSQL, verifyEbsxPermissionProjectionGrant,
} from '../bootstrap-owned-ebsx-schema.mjs';
import { sourceBuildInputs } from '../source-build-identity.mjs';

const runId = '123456789abc';
const identity = ebsxIdentity(runId);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

test('EBSX identities are exact owned names, separate from UAA and workflow', () => {
  assert.equal(identity.schema, `nf_${runId}_ebsx`);
  assert.equal(identity.runtimeUser, `nf_${runId}_ebsx_app`);
  assert.notEqual(identity.bootstrapUser, identity.runtimeUser);
  assert.ok(identity.url.startsWith(`jdbc:mysql://nf-${runId}-mysql:3306/${identity.schema}?`));
  for (const run of [undefined, 'shared', '../mysql', 'A'.repeat(12)]) assert.throws(() => ebsxIdentity(run));
});

test('only the migration identity may use DDL and REFERENCES, never unescaped schema wildcards', () => {
  for (const mode of ['bootstrap', 'verify']) {
    const user = mode === 'bootstrap' ? identity.bootstrapUser : identity.runtimeUser;
    const grant = ebsxGrantSQL(identity, mode);
    const text = `GRANT USAGE ON *.* TO '${user}'@'%'\n${grant.slice(0, -1)}`;
    verifyEbsxGrants(identity, mode, text);
    assert.equal(grant.includes('REFERENCES'), mode === 'bootstrap');
    assert.equal(grant.includes('CREATE'), mode === 'bootstrap');
    assert.throws(() => verifyEbsxGrants(identity, mode, text.replaceAll('\\_', '_')));
    assert.throws(() => verifyEbsxGrants(identity, mode, `${text}\nGRANT ALL PRIVILEGES ON *.* TO '${user}'@'%'`));
  }
  assert.throws(() => ebsxGrantSQL({ ...identity, schema: 'shared' }, 'verify'));
});

test('membership projection is non-updatable and uses a locked local definer with one-table SELECT only', () => {
  const projection = ebsxPermissionProjectionIdentity(runId);
  assert.equal(projection.host, 'localhost');
  assert.notEqual(projection.sourceSchema, projection.targetSchema);
  const view = ebsxPermissionProjectionViewSQL(runId);
  assert.match(view, /SQL SECURITY DEFINER VIEW/);
  assert.match(view, /SELECT DISTINCT `DC`, `ROLE_ID`, `MEMBER_TYPE`, `MEMBER_UID` FROM/);
  assert.ok(!/OR REPLACE|SELECT \*|USER_PASSWORD|MEMBER_NAME/.test(view));
  assert.match(view, new RegExp(`FROM \`nf_${runId}_uaa\`\\.\`sys_role_member\``));
  const grant = ebsxPermissionProjectionGrantSQL(runId);
  assert.equal(grant, `GRANT SELECT ON \`nf_${runId}_uaa\`.\`sys_role_member\` TO '${projection.user}'@'localhost';`);
  const grants = `GRANT USAGE ON *.* TO '${projection.user}'@'localhost'\n${grant.slice(0, -1)}`;
  verifyEbsxPermissionProjectionGrant(runId, grants);
  for (const altered of [grants.replace('GRANT SELECT ON', 'GRANT SELECT, UPDATE ON'),
    grants.replace('`sys_role_member`', '*'), grants.replaceAll('localhost', '%')]) {
    assert.throws(() => verifyEbsxPermissionProjectionGrant(runId, altered));
  }
});

test('helper uses only its fixture network, immutable image, non-root identity and read-only inputs', () => {
  const options = {
    runId, label: 'schema-r1', mode: 'verify', imageId: `sha256:${'a'.repeat(64)}`,
    dependencies: `/workspace/.artifacts/native-nonadmin-fixtures/${runId}/workflow-schema-wf/dependencies`,
    classes: `/workspace/.artifacts/native-nonadmin-fixtures/${runId}/ebsx-schema-schema-r1/helper-classes`,
  };
  const args = ebsxProbeCommand(options);
  for (const flag of ['--rm', '--pull=never', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges']) {
    assert.ok(args.includes(flag));
  }
  assert.equal(args[args.indexOf('--network') + 1], `nf-${runId}-private`);
  assert.ok(!args.join(' ').includes('password'));
  for (const change of [
    o => { o.imageId = 'java:latest'; }, o => { o.dependencies = '/shared'; },
    o => { o.classes += ',rw'; }, o => { o.label = '../shared'; }, o => { o.mode = 'skip'; },
  ]) {
    const bad = { ...options };
    change(bad);
    assert.throws(() => ebsxProbeCommand(bad));
  }
});

function inputFixture(t) {
  const workspace = fs.mkdtempSync(join(os.tmpdir(), 'owned-ebsx-input-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const original = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
  const output = join(workspace, '.artifacts/native-nonadmin-fixtures', runId, 'ebsx-schema-unit');
  fs.mkdirSync(output, { recursive: true, mode: 0o700 });
  const tool = 'scripts/bootstrap-owned-ebsx-schema.mjs';
  const helper = 'scripts/fixtures/OwnedEbsxSchemaProbe.java';
  for (const path of [tool, helper]) {
    fs.mkdirSync(dirname(join(workspace, path)), { recursive: true });
    fs.copyFileSync(join(original, path), join(workspace, path));
  }
  const deps = join(workspace, '.artifacts/native-nonadmin-fixtures', runId, 'workflow-schema-unit/dependencies');
  fs.mkdirSync(deps, { recursive: true });
  fs.writeFileSync(join(deps, 'exact.jar'), 'controlled library');
  fs.mkdirSync(join(output, 'helper-classes'));
  fs.writeFileSync(join(output, 'helper-classes/OwnedEbsxSchemaProbe.class'), 'controlled classes');
  const worktree = join(workspace, '.artifacts/package/worktree');
  const modelRoot = join(worktree, 'libs/ibiz-cloud-saas-ebsx/src/main/resources/sysmodel/saas-ebsx/PSSYSDBSCHEMES');
  fs.mkdirSync(modelRoot, { recursive: true });
  const modelHashes = Object.fromEntries(['DEFAULT', 'DB2', 'DB3'].map(link => {
    const bytes = Buffer.from(JSON.stringify({ name: link }));
    fs.writeFileSync(join(modelRoot, `${link}.json`), bytes);
    return [link, hash(bytes)];
  }));
  const packagePath = join(workspace, '.artifacts/package/report.json');
  const packageBytes = Buffer.from(JSON.stringify({ worktree }));
  fs.writeFileSync(packagePath, packageBytes);
  const packageReceipt = { path: packagePath, sha256: hash(packageBytes) };
  const probe = mode => ({
    mode, schema: identity.schema,
    sqlPrincipal: `${mode === 'bootstrap' ? identity.bootstrapUser : identity.runtimeUser}@%`,
    adapterOrigin: 'file:/dependencies/ibiz-plugin-liquibase-8.1.0.584.1.jar',
    tables: ['JOBS_INFO2', ...Array.from({ length: 77 }, (_, i) => `TABLE_${i}`)],
    columnsVerified: 1000, indicesVerified: 80, primaryKeysVerified: true,
    modelSha256: { ...modelHashes }, mergedModelSha256: 'd'.repeat(64),
    ...(mode === 'bootstrap' ? { adapterReplayPassed: true }
      : { crudVerified: true, runtimeDdlDenied: true, probeRemoved: true,
        permissionProjectionRows: 6, permissionProjectionDmlDenied: true, uaaDirectReadDenied: true }),
  });
  const projection = {
    identity: ebsxPermissionProjectionIdentity(runId),
    columns: ['DC', 'ROLE_ID', 'MEMBER_TYPE', 'MEMBER_UID'],
    readOnly: true, accountLocked: true, rows: 6, sourceRowsVerified: true, sourceRowsUnchanged: true,
    grantsSha256: 'b'.repeat(64), sourceRowsSha256: 'c'.repeat(64), viewDefinitionSha256: 'e'.repeat(64),
  };
  const config = Buffer.from(JSON.stringify({
    url: identity.url, schema: identity.schema, username: identity.runtimeUser, password: 'a'.repeat(36),
    schemaUpdate: false, logicalDatasources: ['DEFAULT', 'DB2', 'DB3'], permissionProjection: projection,
  }));
  const configurationPath = join(output, 'configuration.private.json');
  fs.writeFileSync(configurationPath, config, { mode: 0o600 });
  const report = {
    contract: 'run-owned-model-ebsx-schema-v1', runId, identity,
    status: 'passed-owned-model-ebsx-schema-only', ebsxSchemaVerified: true, droppedBootstrapUser: true,
    permissionProjectionCreated: true, permissionProjection: projection,
    permissionProjectionGrants: { sha256: projection.grantsSha256 },
    createdUsers: [identity.bootstrapUser, identity.runtimeUser, projection.identity.user],
    sourceClosure: false, nativeAcceptance: false, permissionAcceptance: false, errors: [],
    packageReceipt: { ...packageReceipt }, generator: { path: tool, sha256: hash(fs.readFileSync(join(workspace, tool))) },
    helperSource: { path: helper, sha256: hash(fs.readFileSync(join(workspace, helper))) },
    modelHashes, bootstrap: probe('bootstrap'), verify: probe('verify'),
    dependencies: { path: relative(workspace, deps), ...sourceBuildInputs(deps) },
    helperClasses: sourceBuildInputs(join(output, 'helper-classes')),
    configuration: { path: relative(workspace, configurationPath), bytes: config.length, sha256: hash(config) },
  };
  const reportPath = join(output, 'report.json');
  const save = () => fs.writeFileSync(reportPath, JSON.stringify(report), { mode: 0o600 });
  save();
  return { workspace, output, deps, modelRoot, report, save, configurationPath,
    options: { workspace, runId, reportPath, packageReceipt } };
}

test('verified EBSX input binds current package/model/helper bytes and private configuration', t => {
  const f = inputFixture(t);
  const result = readOwnedEbsxConfiguration(f.options);
  assert.equal(result.configuration.schema, identity.schema);
  assert.equal(result.configuration.schemaUpdate, false);
  assert.ok(!JSON.stringify(result.binding).includes('a'.repeat(36)));
  verifyEbsxProbe(f.report.bootstrap, identity, 'bootstrap', f.report.modelHashes);
});

for (const [name, mutate] of [
  ['failed schema', f => { f.report.ebsxSchemaVerified = false; }],
  ['retained DDL principal', f => { f.report.droppedBootstrapUser = false; }],
  ['native promotion', f => { f.report.nativeAcceptance = true; }],
  ['foreign package', f => { f.report.packageReceipt.sha256 = 'c'.repeat(64); }],
  ['one missing table', f => { f.report.verify.tables.pop(); }],
  ['missing primary keys', f => { f.report.verify.primaryKeysVerified = false; }],
  ['missing index validation', f => { f.report.verify.indicesVerified = 0; }],
  ['runtime has DDL', f => { f.report.verify.runtimeDdlDenied = false; }],
  ['unremoved probe', f => { f.report.verify.probeRemoved = false; }],
  ['missing membership view', f => { f.report.permissionProjectionCreated = false; }],
  ['empty membership view', f => { f.report.verify.permissionProjectionRows = 0; }],
  ['updatable membership view', f => { f.report.verify.permissionProjectionDmlDenied = false; }],
  ['direct UAA read', f => { f.report.verify.uaaDirectReadDenied = false; }],
  ['unlocked view account', f => { f.report.permissionProjection.accountLocked = false; }],
  ['foreign view source', f => { f.report.permissionProjection.identity.sourceSchema = 'shared'; }],
  ['copied membership rows', f => { f.report.permissionProjection.sourceRowsUnchanged = false; }],
  ['view grant drift', f => { f.report.permissionProjectionGrants.sha256 = 'f'.repeat(64); }],
  ['view extra columns', f => { f.report.permissionProjection.columns.push('USER_PASSWORD'); }],
  ['different merged model', f => { f.report.verify.mergedModelSha256 = 'c'.repeat(64); }],
  ['changed model', f => fs.appendFileSync(join(f.modelRoot, 'DB2.json'), ' ')],
  ['changed library', f => fs.appendFileSync(join(f.deps, 'exact.jar'), 'drift')],
  ['changed classes', f => fs.appendFileSync(join(f.output, 'helper-classes/OwnedEbsxSchemaProbe.class'), 'drift')],
  ['public config', f => fs.chmodSync(f.configurationPath, 0o644)],
  ['config byte drift', f => fs.appendFileSync(f.configurationPath, ' ')],
]) {
  test(`EBSX input rejects ${name}`, t => {
    const f = inputFixture(t);
    mutate(f);
    f.save();
    assert.throws(() => readOwnedEbsxConfiguration(f.options));
  });
}
