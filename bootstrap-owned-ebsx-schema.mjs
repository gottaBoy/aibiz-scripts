import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { PinnedDirectories, readPinnedFile } from './native-candidate-files.mjs';
import { sourceBuildInputs } from './source-build-identity.mjs';
import { readOwnedWorkflowConfiguration } from './bootstrap-owned-workflow-schema.mjs';
import { verifyBackendSourcePackage } from './harness-backend-source-package.mjs';
import { validateApplicationTarget } from './provision-run-owned-native-application-accounts.mjs';
import { inspectMysqlFixtureVolumes } from './owned-mysql-volume.mjs';

const workspaceDefault = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceFile = 'scripts/fixtures/OwnedEbsxSchemaProbe.java';
const toolFile = 'scripts/bootstrap-owned-ebsx-schema.mjs';
const contract = 'run-owned-model-ebsx-schema-v1';
const hash = value => createHash('sha256').update(value).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;

export function ebsxIdentity(runId) {
  assert.match(runId, /^[a-f0-9]{12}$/);
  const schema = `nf_${runId}_ebsx`;
  return { schema, bootstrapUser: `nf_${runId}_ebsx_ddl`, runtimeUser: `nf_${runId}_ebsx_app`,
    url: `jdbc:mysql://nf-${runId}-mysql:3306/${schema}?useUnicode=true&characterEncoding=UTF-8&useSSL=false` };
}

export function ebsxPermissionProjectionIdentity(runId) {
  assert.match(runId, /^[a-f0-9]{12}$/);
  return {
    user: `nf_${runId}_ebsx_perm`,
    host: 'localhost',
    sourceSchema: `nf_${runId}_uaa`,
    sourceTable: 'sys_role_member',
    targetSchema: `nf_${runId}_ebsx`,
    targetView: 'sys_role_member',
  };
}

export function ebsxPermissionProjectionGrantSQL(runId) {
  const projection = ebsxPermissionProjectionIdentity(runId);
  return `GRANT SELECT ON \`${projection.sourceSchema}\`.\`${projection.sourceTable}\` TO '${projection.user}'@'${projection.host}';`;
}

export function ebsxPermissionProjectionViewSQL(runId) {
  const projection = ebsxPermissionProjectionIdentity(runId);
  return `CREATE ALGORITHM=UNDEFINED DEFINER='${projection.user}'@'${projection.host}' SQL SECURITY DEFINER VIEW \`${projection.targetSchema}\`.\`${projection.targetView}\` AS SELECT DISTINCT \`DC\`, \`ROLE_ID\`, \`MEMBER_TYPE\`, \`MEMBER_UID\` FROM \`${projection.sourceSchema}\`.\`${projection.sourceTable}\`;`;
}

export function verifyEbsxPermissionProjectionGrant(runId, text) {
  const projection = ebsxPermissionProjectionIdentity(runId);
  assert.deepEqual(text.trim().split('\n').sort(), [
    `GRANT USAGE ON *.* TO '${projection.user}'@'${projection.host}'`,
    ebsxPermissionProjectionGrantSQL(runId).slice(0, -1),
  ].sort(), 'EBSX permission projection principal must retain only UAA membership SELECT');
}

export function verifyEbsxPermissionProjection(runId, value) {
  assert.deepEqual(value?.identity, ebsxPermissionProjectionIdentity(runId));
  assert.deepEqual(value.columns, ['DC', 'ROLE_ID', 'MEMBER_TYPE', 'MEMBER_UID']);
  for (const key of ['readOnly', 'accountLocked', 'sourceRowsVerified', 'sourceRowsUnchanged']) {
    assert.equal(value[key], true);
  }
  assert.equal(value.rows, 6);
  for (const key of ['viewDefinitionSha256', 'grantsSha256', 'sourceRowsSha256']) {
    assert.match(value[key], /^[a-f0-9]{64}$/);
  }
}

export function ebsxGrantSQL(identity, mode) {
  assert.deepEqual(identity, ebsxIdentity(identity.schema.slice(3, 15)));
  assert.ok(['bootstrap', 'verify'].includes(mode));
  const privileges = mode === 'bootstrap'
    ? 'SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, REFERENCES, INDEX, ALTER'
    : 'SELECT, INSERT, UPDATE, DELETE';
  const user = mode === 'bootstrap' ? identity.bootstrapUser : identity.runtimeUser;
  return `GRANT ${privileges} ON \`${identity.schema.replaceAll('_', '\\_')}\`.* TO '${user}'@'%';`;
}

export function verifyEbsxGrants(identity, mode, text) {
  const user = mode === 'bootstrap' ? identity.bootstrapUser : identity.runtimeUser;
  assert.deepEqual(text.trim().split('\n').sort(), [
    `GRANT USAGE ON *.* TO '${user}'@'%'`, ebsxGrantSQL(identity, mode).slice(0, -1),
  ].sort(), 'EBSX principal must retain exact schema-scoped privileges');
}

export function verifyEbsxProbe(row, identity, mode, modelHashes) {
  assert.equal(row.mode, mode);
  assert.equal(row.schema, identity.schema);
  assert.equal(row.sqlPrincipal, `${mode === 'bootstrap' ? identity.bootstrapUser : identity.runtimeUser}@%`);
  assert.equal(row.adapterOrigin, 'file:/dependencies/ibiz-plugin-liquibase-8.1.0.584.1.jar');
  assert.equal(row.tables.length, 78);
  assert.equal(new Set(row.tables).size, 78);
  assert.ok(row.tables.includes('JOBS_INFO2'));
  assert.equal(row.primaryKeysVerified, true);
  assert.ok(Number.isSafeInteger(row.columnsVerified) && row.columnsVerified > 78);
  assert.ok(Number.isSafeInteger(row.indicesVerified) && row.indicesVerified > 0);
  assert.deepEqual(row.modelSha256, modelHashes);
  assert.match(row.mergedModelSha256, /^[a-f0-9]{64}$/);
  if (mode === 'bootstrap') assert.equal(row.adapterReplayPassed, true);
  else {
    for (const key of ['crudVerified', 'runtimeDdlDenied', 'probeRemoved']) assert.equal(row[key], true);
    assert.equal(row.permissionProjectionRows, 6);
    for (const key of ['permissionProjectionDmlDenied', 'uaaDirectReadDenied']) assert.equal(row[key], true);
  }
}

export function ebsxProbeCommand({ runId, label, imageId, dependencies, classes, mode }) {
  ebsxIdentity(runId);
  assert.match(label, /^[a-z0-9][a-z0-9-]{0,48}$/);
  assert.match(imageId, /^sha256:[a-f0-9]{64}$/);
  assert.ok(['bootstrap', 'verify'].includes(mode));
  assert.ok(dependencies.includes(`/.artifacts/native-nonadmin-fixtures/${runId}/workflow-schema-`));
  assert.ok(classes.includes(`/.artifacts/native-nonadmin-fixtures/${runId}/ebsx-schema-${label}/`));
  for (const path of [dependencies, classes]) {
    assert.equal(path, resolve(path));
    assert.ok(!/[,\r\n\0]/.test(path));
  }
  return ['run', '--rm', '--interactive', '--pull=never',
    '--name', `nf-${runId}-ebsx-${label}-${mode}`, '--network', `nf-${runId}-private`,
    '--label', `aibiz.native-fixture.run=${runId}`, '--label', `aibiz.ebsx.bootstrap=${label}`,
    '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--user', '65532:65532',
    '--tmpfs', '/tmp:rw,nosuid,nodev,size=268435456',
    '--mount', `type=bind,src=${dependencies},dst=/dependencies,readonly`,
    '--mount', `type=bind,src=${classes},dst=/classes,readonly`,
    '--entrypoint', 'java', imageId, '-cp', '/classes:/dependencies/*', 'OwnedEbsxSchemaProbe'];
}

function ownedContext(workspace, runId, directories) {
  const base = join(workspace, '.artifacts/native-nonadmin-fixtures', runId);
  const read = path => readPinnedFile(directories, directories.open(dirname(path)), basename(path)).data;
  const manifest = JSON.parse(read(join(base, 'manifest.json')));
  assert.equal(manifest.runId, runId);
  const resources = JSON.parse(read(join(base, 'owned-resources.json')));
  const docker = (args, { input, allowFailure = false } = {}) => {
    const result = spawnSync('docker', args, { input, encoding: 'utf8', timeout: 180000, maxBuffer: 16 * 1024 * 1024 });
    if (!allowFailure) assert.ok(result.status === 0 && !result.error && !result.signal,
      'Owned EBSX Docker operation failed; private output suppressed');
    return result;
  };
  const guard = () => validateApplicationTarget(manifest, resources,
    JSON.parse(docker(['inspect', resources.mysqlId]).stdout)[0],
    JSON.parse(docker(['network', 'inspect', resources.networkId]).stdout)[0], inspectMysqlFixtureVolumes(resources));
  const sql = input => {
    guard();
    return docker(['exec', '-i', resources.mysqlId, 'sh', '-c',
      'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -h127.0.0.1 --protocol=TCP -uroot --batch --raw --skip-column-names'],
    { input }).stdout.trim();
  };
  return { base, read, manifest, resources, docker, guard, sql };
}

export async function bootstrapOwnedEbsx({ workspace = workspaceDefault, runId, workflowReportPath, label }) {
  const identity = ebsxIdentity(runId);
  assert.match(label ?? '', /^[a-z0-9][a-z0-9-]{0,48}$/);
  workspace = resolve(workspace);
  const directories = new PinnedDirectories();
  const context = ownedContext(workspace, runId, directories);
  const { base, read, docker, guard, sql } = context;
  const output = join(base, `ebsx-schema-${label}`);
  const destination = directories.open(output, { create: true, exclusive: true });
  const write = (name, value) => directories.write(destination, name, value);
  const report = {
    schemaVersion: 1, contract, runId, label, identity, status: 'failed', errors: [], commands: [],
    createdUsers: [], createdSchema: false, droppedBootstrapUser: false,
    permissionProjectionCreated: false, ebsxSchemaVerified: false,
    sourceClosure: false, nativeAcceptance: false, permissionAcceptance: false,
    startedAt: new Date().toISOString(),
    generator: { path: toolFile, sha256: hash(read(join(workspace, toolFile))) },
    helperSource: { path: sourceFile, sha256: hash(read(join(workspace, sourceFile))) },
    limitations: [
      'Model-derived isolated EBSX schema only; not default business seed, native permissions or production migration acceptance.',
      'Uses the exact source-built model/Liquibase adapter; original upstream authenticity remains unverified.',
      'Logical DEFAULT/DB2/DB3 share one physical database, as in the local application-auto configuration.',
    ],
  };
  const names = [];
  const passwords = {
    bootstrap: randomBytes(18).toString('hex'), verify: randomBytes(18).toString('hex'),
    projection: randomBytes(18).toString('hex'),
  };
  try {
    guard();
    const workflowPath = resolve(workspace, workflowReportPath);
    const workflow = JSON.parse(read(workflowPath));
    const verified = verifyBackendSourcePackage({ workspace, reportPath: workflow.packageReceipt.path });
    report.packageReceipt = { path: verified.reportPath, sha256: verified.reportSha256 };
    const bound = readOwnedWorkflowConfiguration({ workspace, runId, reportPath: workflowPath,
      packageReceipt: report.packageReceipt });
    report.workflowInput = bound.binding;
    const dependencies = join(dirname(workflowPath), 'dependencies');
    report.dependencies = { path: relative(workspace, dependencies), ...sourceBuildInputs(dependencies) };
    const image = JSON.parse(docker(['image', 'inspect', workflow.image.reference]).stdout)[0];
    assert.equal(image.Id, workflow.image.id);
    report.image = workflow.image;
    const modelRoot = join(verified.report.worktree,
      'libs/ibiz-cloud-saas-ebsx/src/main/resources/sysmodel/saas-ebsx/PSSYSDBSCHEMES');
    report.modelHashes = Object.fromEntries(['DEFAULT', 'DB2', 'DB3'].map(link => [
      link, hash(read(join(modelRoot, `${link}.json`))),
    ]));
    const source = directories.open(join(output, 'helper-source'), { create: true, exclusive: true });
    directories.write(source, 'OwnedEbsxSchemaProbe.java', read(join(workspace, sourceFile)));
    const classes = directories.open(join(output, 'helper-classes'), { create: true, exclusive: true });
    const compileName = `nf-${runId}-ebsx-${label}-compile`;
    names.push(compileName);
    const compile = ['run', '--rm', '--pull=never', '--name', compileName, '--network=none',
      '--label', `aibiz.native-fixture.run=${runId}`, '--label', `aibiz.ebsx.bootstrap=${label}`,
      '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges',
      '--user', `${process.geteuid()}:${process.getegid()}`, '--tmpfs', '/tmp:rw,nosuid,nodev,size=268435456',
      '--mount', `type=bind,src=${dependencies},dst=/dependencies,readonly`,
      '--mount', `type=bind,src=${source.path},dst=/source,readonly`,
      '--mount', `type=bind,src=${classes.path},dst=/output`,
      '--entrypoint', 'javac', image.Id, '--release', '8', '-proc:none', '-implicit:none',
      '-sourcepath', '', '-cp', '/dependencies/*', '-d', '/output', '/source/OwnedEbsxSchemaProbe.java'];
    const compiled = docker(compile, { allowFailure: true });
    write('compile.private.log', `${compiled.stdout ?? ''}${compiled.stderr ?? ''}`);
    report.commands.push({ stage: 'compile', args: compile, exitCode: compiled.status });
    assert.ok(compiled.status === 0 && !compiled.error && !compiled.signal, 'EBSX helper compilation failed');
    fs.chmodSync(classes.path, 0o755);
    for (const name of fs.readdirSync(classes.path)) fs.chmodSync(join(classes.path, name), 0o644);
    report.helperClasses = sourceBuildInputs(classes.path);
    assert.equal(sql(`SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name='${identity.schema}';`), '0');
    assert.equal(sql(`SELECT COUNT(*) FROM mysql.user WHERE User IN ('${identity.bootstrapUser}','${identity.runtimeUser}');`), '0');
    write('credentials.private.json', json({ passwords }));
    sql(`CREATE DATABASE \`${identity.schema}\` CHARACTER SET utf8mb4;`);
    report.createdSchema = true;
    for (const mode of ['bootstrap', 'verify']) {
      const user = mode === 'bootstrap' ? identity.bootstrapUser : identity.runtimeUser;
      sql(`CREATE USER '${user}'@'%' IDENTIFIED BY '${passwords[mode]}';`);
      report.createdUsers.push(user);
      sql(ebsxGrantSQL(identity, mode));
      const grants = sql(`SHOW GRANTS FOR '${user}'@'%';`);
      verifyEbsxGrants(identity, mode, grants);
      report[`${mode}Grants`] = { sha256: hash(grants) };
    }
    for (const mode of ['bootstrap', 'verify']) {
      if (mode === 'verify') {
        const projection = ebsxPermissionProjectionIdentity(runId);
        assert.equal(sql(`SELECT COUNT(*) FROM mysql.user WHERE User='${projection.user}';`), '0');
        assert.equal(sql(`SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${projection.targetSchema}' AND table_name='${projection.targetView}';`), '0');
        const members = schema => sql(`SELECT JSON_ARRAY(DC,ROLE_ID,MEMBER_TYPE,MEMBER_UID) FROM \`${schema}\`.\`${projection.sourceTable}\` ORDER BY MEMBER_UID;`);
        const before = members(projection.sourceSchema);
        const actual = before.split('\n').map(row => JSON.parse(row));
        const expected = context.manifest.users.toSorted((a, b) => a.personId.localeCompare(b.personId))
          .map(user => [user.centerId, `${user.centerId}_ordinary_role`, 'inetOrgPerson', user.personId]);
        assert.deepEqual(actual, expected, 'Projection requires exact fixture membership rows');
        sql(`CREATE USER '${projection.user}'@'${projection.host}' IDENTIFIED BY '${passwords.projection}' ACCOUNT LOCK;`);
        report.createdUsers.push(projection.user);
        sql(ebsxPermissionProjectionGrantSQL(runId));
        const grants = sql(`SHOW GRANTS FOR '${projection.user}'@'${projection.host}';`);
        verifyEbsxPermissionProjectionGrant(runId, grants);
        report.permissionProjectionGrants = { sha256: hash(grants) };
        sql(ebsxPermissionProjectionViewSQL(runId));
        report.permissionProjectionCreated = true;
        assert.equal(sql(`SELECT COUNT(*) FROM information_schema.views WHERE table_schema='${projection.targetSchema}' AND table_name='${projection.targetView}' AND IS_UPDATABLE='NO' AND SECURITY_TYPE='DEFINER' AND DEFINER='${projection.user}@${projection.host}';`), '1');
        assert.equal(sql(`SELECT account_locked FROM mysql.user WHERE User='${projection.user}' AND Host='${projection.host}';`), 'Y');
        assert.equal(members(projection.targetSchema), before, 'View must expose real, unchanged membership rows');
        report.permissionProjection = {
          identity: projection, columns: ['DC', 'ROLE_ID', 'MEMBER_TYPE', 'MEMBER_UID'],
          readOnly: true, accountLocked: true, rows: actual.length,
          sourceRowsVerified: true, sourceRowsUnchanged: false,
          grantsSha256: hash(grants), sourceRowsSha256: hash(before),
          viewDefinitionSha256: hash(sql(`SHOW CREATE VIEW \`${projection.targetSchema}\`.\`${projection.targetView}\`;`)),
        };
      }
      guard();
      const command = ebsxProbeCommand({ runId, label, imageId: image.Id, dependencies, classes: classes.path, mode });
      names.push(command[command.indexOf('--name') + 1]);
      const result = docker(command, { allowFailure: true, input: json({
        runId, mode, url: identity.url, username: mode === 'bootstrap' ? identity.bootstrapUser : identity.runtimeUser,
        password: passwords[mode],
      }) });
      write(`${mode}.private.log`, `${result.stderr ?? ''}\n${result.stdout ?? ''}`);
      report.commands.push({ stage: mode, args: command, exitCode: result.status });
      assert.ok(result.status === 0 && !result.error && !result.signal, `EBSX ${mode} failed; see private log`);
      const row = JSON.parse(result.stdout);
      verifyEbsxProbe(row, identity, mode, report.modelHashes);
      report[mode] = row;
      guard();
    }
    assert.equal(report.bootstrap.mergedModelSha256, report.verify.mergedModelSha256);
    const projection = ebsxPermissionProjectionIdentity(runId);
    const sourceRows = sql(`SELECT JSON_ARRAY(DC,ROLE_ID,MEMBER_TYPE,MEMBER_UID) FROM \`${projection.sourceSchema}\`.\`${projection.sourceTable}\` ORDER BY MEMBER_UID;`);
    assert.equal(hash(sourceRows), report.permissionProjection.sourceRowsSha256);
    report.permissionProjection.sourceRowsUnchanged = true;
    verifyEbsxPermissionProjection(runId, report.permissionProjection);
    sql(`DROP USER '${identity.bootstrapUser}'@'%';`);
    report.droppedBootstrapUser = true;
    const configuration = json({ url: identity.url, username: identity.runtimeUser, password: passwords.verify,
      schema: identity.schema, schemaUpdate: false, logicalDatasources: ['DEFAULT', 'DB2', 'DB3'],
      permissionProjection: report.permissionProjection });
    write('configuration.private.json', configuration);
    report.configuration = { path: relative(workspace, join(output, 'configuration.private.json')),
      bytes: Buffer.byteLength(configuration), sha256: hash(configuration) };
    report.ebsxSchemaVerified = true;
    report.status = 'passed-owned-model-ebsx-schema-only';
  } catch (error) { report.errors.push(error.message); }
  finally {
    for (const name of names) {
      const current = docker(['container', 'inspect', name], { allowFailure: true });
      if (current.status === 0) {
        const container = JSON.parse(current.stdout)[0];
        assert.equal(container.Config.Labels?.['aibiz.native-fixture.run'], runId);
        assert.equal(container.Config.Labels?.['aibiz.ebsx.bootstrap'], label);
        assert.equal(container.Image, report.image.id);
        docker(['rm', '--force', container.Id]);
      }
    }
    try {
      guard();
      assert.equal(hash(read(join(workspace, toolFile))), report.generator.sha256);
      assert.equal(hash(read(join(workspace, sourceFile))), report.helperSource.sha256);
      if (report.dependencies) {
        const { path, ...inventory } = report.dependencies;
        assert.deepEqual(sourceBuildInputs(join(workspace, path)), inventory);
      }
    } catch { report.errors.push('Owned EBSX inputs or target changed'); }
    if (report.errors.length) { report.status = 'failed'; report.ebsxSchemaVerified = false; }
    report.finishedAt = new Date().toISOString();
    write('report.json', json(report));
    directories.close();
  }
  return { report, reportPath: join(output, 'report.json') };
}

export function readOwnedEbsxConfiguration({ workspace = workspaceDefault, runId, reportPath, packageReceipt }) {
  const identity = ebsxIdentity(runId);
  workspace = resolve(workspace);
  const path = resolve(workspace, reportPath);
  assert.equal(dirname(dirname(path)), join(workspace, '.artifacts/native-nonadmin-fixtures', runId));
  assert.equal(basename(path), 'report.json');
  assert.match(basename(dirname(path)), /^ebsx-schema-[a-z0-9][a-z0-9-]{0,48}$/);
  const directories = new PinnedDirectories();
  const read = p => readPinnedFile(directories, directories.open(dirname(p)), basename(p));
  try {
    const bytes = read(path).data;
    const report = JSON.parse(bytes);
    assert.equal(report.contract, contract);
    assert.equal(report.runId, runId);
    assert.deepEqual(report.identity, identity);
    assert.equal(report.status, 'passed-owned-model-ebsx-schema-only');
    assert.equal(report.ebsxSchemaVerified, true);
    assert.equal(report.droppedBootstrapUser, true);
    assert.equal(report.permissionProjectionCreated, true);
    verifyEbsxPermissionProjection(runId, report.permissionProjection);
    assert.equal(report.permissionProjectionGrants.sha256, report.permissionProjection.grantsSha256);
    assert.deepEqual(report.createdUsers.toSorted(), [
      identity.bootstrapUser, identity.runtimeUser, ebsxPermissionProjectionIdentity(runId).user,
    ].sort());
    for (const key of ['sourceClosure', 'nativeAcceptance', 'permissionAcceptance']) assert.equal(report[key], false);
    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.packageReceipt, { path: packageReceipt.path, sha256: packageReceipt.sha256 });
    assert.deepEqual(report.generator, { path: toolFile, sha256: hash(read(join(workspace, toolFile)).data) });
    assert.deepEqual(report.helperSource, { path: sourceFile, sha256: hash(read(join(workspace, sourceFile)).data) });
    verifyEbsxProbe(report.bootstrap, identity, 'bootstrap', report.modelHashes);
    verifyEbsxProbe(report.verify, identity, 'verify', report.modelHashes);
    assert.equal(report.bootstrap.mergedModelSha256, report.verify.mergedModelSha256);
    const packageBytes = read(packageReceipt.path).data;
    assert.equal(hash(packageBytes), packageReceipt.sha256);
    const packageReport = JSON.parse(packageBytes);
    const modelRoot = join(packageReport.worktree,
      'libs/ibiz-cloud-saas-ebsx/src/main/resources/sysmodel/saas-ebsx/PSSYSDBSCHEMES');
    const currentModelHashes = Object.fromEntries(['DEFAULT', 'DB2', 'DB3'].map(link => [
      link, hash(read(join(modelRoot, `${link}.json`)).data),
    ]));
    assert.deepEqual(report.modelHashes, currentModelHashes, 'EBSX model inputs no longer match the bound package');
    const { path: dependencyPath, ...inventory } = report.dependencies;
    assert.deepEqual(sourceBuildInputs(join(workspace, dependencyPath)), inventory);
    assert.deepEqual(sourceBuildInputs(join(dirname(path), 'helper-classes')), report.helperClasses);
    const input = read(join(dirname(path), 'configuration.private.json'));
    assert.equal(input.identity.mode & 0o077, 0);
    assert.deepEqual(report.configuration, {
      path: relative(workspace, join(dirname(path), 'configuration.private.json')),
      bytes: input.data.length, sha256: hash(input.data),
    });
    const configuration = JSON.parse(input.data);
    assert.equal(configuration.url, identity.url);
    assert.equal(configuration.username, identity.runtimeUser);
    assert.equal(configuration.schema, identity.schema);
    assert.equal(configuration.schemaUpdate, false);
    assert.deepEqual(configuration.logicalDatasources, ['DEFAULT', 'DB2', 'DB3']);
    assert.deepEqual(configuration.permissionProjection, report.permissionProjection);
    assert.match(configuration.password, /^[a-f0-9]{36}$/);
    return { configuration, binding: { reportPath: relative(workspace, path),
      reportSha256: hash(bytes), configurationSha256: hash(input.data) } };
  } finally { directories.close(); }
}

export function cleanupOwnedEbsx({ workspace = workspaceDefault, runId, label }) {
  const identity = ebsxIdentity(runId);
  assert.match(label ?? '', /^[a-z0-9][a-z0-9-]{0,48}$/);
  workspace = resolve(workspace);
  const directories = new PinnedDirectories();
  try {
    const { base, read, guard, sql } = ownedContext(workspace, runId, directories);
    const output = join(base, `ebsx-schema-${label}`);
    const receipt = JSON.parse(read(join(output, 'report.json')));
    assert.equal(receipt.contract, contract);
    assert.equal(receipt.runId, runId);
    assert.deepEqual(receipt.identity, identity);
    assert.equal(new Set(receipt.createdUsers).size, receipt.createdUsers.length);
    const projection = ebsxPermissionProjectionIdentity(runId);
    assert.ok(receipt.createdUsers.every(user => [identity.bootstrapUser, identity.runtimeUser, projection.user].includes(user)));
    guard();
    const report = { contract: 'run-owned-ebsx-account-cleanup-v1', runId, status: 'running',
      removed: [], droppedPermissionProjection: false,
      schemaRetainedUntilOwnedMysqlCleanup: true, nativeAcceptance: false };
    try {
      for (const user of receipt.createdUsers) {
        assert.equal(sql(`SELECT COUNT(*) FROM information_schema.PROCESSLIST WHERE USER='${user}';`), '0');
      }
      if (receipt.permissionProjectionCreated) {
        const current = sql(`SHOW CREATE VIEW \`${projection.targetSchema}\`.\`${projection.targetView}\`;`);
        assert.equal(hash(current), receipt.permissionProjection.viewDefinitionSha256);
        sql(`DROP VIEW \`${projection.targetSchema}\`.\`${projection.targetView}\`;`);
        report.droppedPermissionProjection = true;
      }
      for (const user of receipt.createdUsers) {
        if (user === identity.bootstrapUser && receipt.droppedBootstrapUser) {
          assert.equal(sql(`SELECT COUNT(*) FROM mysql.user WHERE User='${user}';`), '0');
          continue;
        }
        assert.equal(sql(`SELECT COUNT(*) FROM information_schema.PROCESSLIST WHERE USER='${user}';`), '0');
        const host = user === projection.user ? projection.host : '%';
        const grants = sql(`SHOW GRANTS FOR '${user}'@'${host}';`);
        const bound = user === projection.user ? receipt.permissionProjectionGrants
          : receipt[`${user === identity.bootstrapUser ? 'bootstrap' : 'verify'}Grants`];
        if (bound) assert.equal(hash(grants), bound.sha256);
        else assert.equal(grants, `GRANT USAGE ON *.* TO '${user}'@'${host}'`);
        sql(`DROP USER '${user}'@'${host}';`);
        report.removed.push(user);
      }
      report.status = 'passed-owned-ebsx-account-cleanup';
    } catch (error) { report.status = 'failed'; report.error = error.message; }
    directories.write(directories.open(output), `cleanup-${randomBytes(6).toString('hex')}.json`, json(report));
    return report;
  } finally { directories.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: {
    'execute-owned-ebsx': { type: 'boolean' }, 'cleanup-owned-ebsx': { type: 'boolean' },
    'run-id': { type: 'string' }, label: { type: 'string' }, 'workflow-report': { type: 'string' },
  } });
  assert.notEqual(Boolean(values['execute-owned-ebsx']), Boolean(values['cleanup-owned-ebsx']));
  if (values['cleanup-owned-ebsx']) {
    const report = cleanupOwnedEbsx({ runId: values['run-id'], label: values.label });
    console.log(json(report));
    process.exitCode = report.status.startsWith('passed-') ? 0 : 1;
  } else {
    const { report, reportPath } = await bootstrapOwnedEbsx({ runId: values['run-id'], label: values.label,
      workflowReportPath: values['workflow-report'] });
    console.log(json({ reportPath, status: report.status, ebsxSchemaVerified: report.ebsxSchemaVerified,
      errors: report.errors }));
    process.exitCode = report.ebsxSchemaVerified ? 0 : 1;
  }
}
