import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { PinnedDirectories, readPinnedFile } from './native-candidate-files.mjs';
import { sourceBuildInputs } from './source-build-identity.mjs';
import { verifyBackendSourcePackage } from './harness-backend-source-package.mjs';
import { PINNED_BACKEND_RUNTIME_IMAGE } from './harness-backend-source-images.mjs';
import { validateFixtureReceipt, validateApplicationTarget } from './provision-run-owned-native-application-accounts.mjs';
import { mysqlFixtureProfile } from './mysql-fixture-profiles.mjs';
import { inspectMysqlFixtureVolumes } from './owned-mysql-volume.mjs';

const workspaceDefault = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const owner = 'aibiz.native-fixture.run';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const sourceFile = 'scripts/fixtures/OwnedWorkflowSchemaProbe.java';
const toolFile = 'scripts/bootstrap-owned-workflow-schema.mjs';
const contract = 'run-owned-workflow-engine-schema-v1';
const runtimePrivileges = 'SELECT, INSERT, UPDATE, DELETE';
const bootstrapPrivileges = 'SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, REFERENCES, INDEX, ALTER';

export function workflowIdentity(runId) {
  assert.match(runId, /^[a-f0-9]{12}$/);
  const schema = `nf_${runId}_workflow`;
  return {
    schema, bootstrapUser: `nf_${runId}_wf_ddl`, runtimeUser: `nf_${runId}_wf_app`,
    url: `jdbc:mysql://nf-${runId}-mysql:3306/${schema}?useUnicode=true&characterEncoding=UTF-8&useSSL=false`,
  };
}

export function workflowGrantSQL(identity, user, bootstrap = false) {
  assert.deepEqual(identity, workflowIdentity(identity.schema.slice(3, 15)));
  assert.equal(user, bootstrap ? identity.bootstrapUser : identity.runtimeUser);
  return `GRANT ${bootstrap ? bootstrapPrivileges : runtimePrivileges} ON `
    + `\`${identity.schema.replaceAll('_', '\\_')}\`.* TO '${user}'@'%';`;
}

export function verifyWorkflowGrants(identity, user, text, bootstrap = false) {
  assert.deepEqual(text.trim().split('\n').sort(), [
    `GRANT USAGE ON *.* TO '${user}'@'%'`,
    workflowGrantSQL(identity, user, bootstrap).slice(0, -1),
  ].sort(), 'Workflow principal must have only exact schema privileges');
}

export function workflowProbeCommand({ runId, label, imageId, dependencies, classes, mode }) {
  workflowIdentity(runId);
  assert.match(label, /^[a-z0-9][a-z0-9-]{0,48}$/);
  assert.match(imageId, /^sha256:[a-f0-9]{64}$/);
  assert.ok(['bootstrap', 'verify'].includes(mode));
  const expectedRoot = `/.artifacts/native-nonadmin-fixtures/${runId}/workflow-schema-${label}/`;
  for (const path of [dependencies, classes]) {
    assert.equal(path, resolve(path));
    assert.ok(path.includes(expectedRoot) && !/[,\r\n\0]/.test(path));
  }
  return ['run', '--rm', '--interactive', '--pull=never',
    '--name', `nf-${runId}-workflow-${label}-${mode}`, '--network', `nf-${runId}-private`,
    '--label', `${owner}=${runId}`, '--label', `aibiz.workflow.bootstrap=${label}`,
    '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--user', '65532:65532',
    '--tmpfs', '/tmp:rw,nosuid,nodev,size=268435456',
    '--mount', `type=bind,src=${dependencies},dst=/dependencies,readonly`,
    '--mount', `type=bind,src=${classes},dst=/classes,readonly`,
    '--entrypoint', 'java', imageId, '-cp', '/classes:/dependencies/*', 'OwnedWorkflowSchemaProbe'];
}

export function verifyWorkflowProbe(row, identity, mode) {
  assert.equal(row.mode, mode);
  assert.equal(row.engineBuilt, true);
  assert.equal(row.libraryVersion, '6.5.0.1');
  assert.equal(row.idmLibraryVersion, row.libraryVersion);
  assert.equal(row.engineOrigin, 'file:/dependencies/flowable-engine-6.4.2.jar');
  assert.equal(row.idmOrigin, 'file:/dependencies/flowable-idm-engine-6.4.2.jar');
  assert.equal(row.schema, identity.schema);
  assert.equal(row.sqlPrincipal, `${mode === 'bootstrap' ? identity.bootstrapUser : identity.runtimeUser}@%`);
  if (mode === 'verify') {
    assert.equal(row.workflowCompleted, true);
    assert.equal(row.probeDeploymentRemoved, true);
  }
}

const extractLibraries = String.raw`
import hashlib, json, os, stat, sys, zipfile
path, destination = sys.argv[1:]
h = hashlib.sha256()
with open(path, "rb") as f:
    for data in iter(lambda: f.read(1048576), b""):
        h.update(data)
files, seen = [], set()
with zipfile.ZipFile(path) as app:
    for item in sorted(app.infolist(), key=lambda x: x.filename):
        if not item.filename.startswith("BOOT-INF/lib/") or not item.filename.endswith(".jar"):
            continue
        name = item.filename[len("BOOT-INF/lib/"):]
        if (not name or "/" in name or "\\" in name or name in seen
            or item.file_size > 134217728 or stat.S_ISLNK(item.external_attr >> 16)):
            raise ValueError("Unsafe/duplicate/oversized application library")
        seen.add(name)
        data = app.read(item)
        with open(os.path.join(destination, name), "xb") as f:
            f.write(data)
        os.chmod(os.path.join(destination, name), 0o644)
        files.append({"path": name, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})
json.dump({"archiveSha256": h.hexdigest(), "files": files}, sys.stdout)
`;

export async function bootstrapOwnedWorkflow({
  runId, packageReportPath, label, workspace = workspaceDefault,
}) {
  const identity = workflowIdentity(runId);
  assert.match(label ?? '', /^[a-z0-9][a-z0-9-]{0,48}$/);
  workspace = resolve(workspace);
  const base = join(workspace, '.artifacts/native-nonadmin-fixtures', runId);
  const output = join(base, `workflow-schema-${label}`);
  const directories = new PinnedDirectories();
  const destination = directories.open(output, { create: true, exclusive: true });
  const write = (name, bytes) => directories.write(destination, name, bytes);
  const read = path => readPinnedFile(directories, directories.open(dirname(path)), basename(path)).data;
  const manifestBytes = read(join(base, 'manifest.json'));
  const manifest = JSON.parse(manifestBytes);
  const resources = JSON.parse(read(join(base, 'owned-resources.json')));
  const sqlReceipt = JSON.parse(read(join(base, 'isolated-sql-report.json')));
  const report = {
    schemaVersion: 1, contract, runId, label, startedAt: new Date().toISOString(), status: 'failed',
    identity, errors: [], commands: [], createdSchema: false, createdUsers: [], droppedBootstrapUser: false,
    sourceClosure: false, permissionAcceptance: false, nativeAcceptance: false, workflowSchemaVerified: false,
    limitations: [
      'Standalone exact-library workflow fixture only; not EBSX application/schema or native acceptance.',
      'Customized Flowable dependency origins/licenses and upstream source authenticity remain unverified.',
      'No shared service, UAA schema or physical model schema is modified.',
    ],
  };
  report.generator = { path: toolFile, sha256: hash(read(join(workspace, toolFile))) };
  const docker = (args, { input, allowFailure = false } = {}) => {
    const result = spawnSync('docker', args, {
      input, encoding: 'utf8', timeout: 180000, maxBuffer: 16 * 1024 * 1024,
    });
    if (!allowFailure) assert.ok(result.status === 0 && !result.error && !result.signal,
      'Owned workflow Docker operation failed; credential-bearing output suppressed');
    return result;
  };
  const inspect = id => JSON.parse(docker(['inspect', id]).stdout)[0];
  const guard = () => {
    const container = inspect(resources.mysqlId);
    const network = JSON.parse(docker(['network', 'inspect', resources.networkId]).stdout)[0];
    validateApplicationTarget(manifest, resources, container, network, inspectMysqlFixtureVolumes(resources));
  };
  const sql = input => {
    guard();
    return docker(['exec', '-i', resources.mysqlId, 'sh', '-c',
      'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -h127.0.0.1 --protocol=TCP -uroot --batch --raw --skip-column-names'],
    { input }).stdout.trim();
  };
  const passwords = { bootstrap: randomBytes(18).toString('hex'), verify: randomBytes(18).toString('hex') };
  const containerNames = [];
  try {
    validateFixtureReceipt(manifest, sqlReceipt, hash(manifestBytes));
    assert.equal(manifest.runId, runId);
    guard();
    const selected = resolve(workspace, packageReportPath);
    assert.ok(selected.startsWith(`${workspace}/.artifacts/`));
    const verified = verifyBackendSourcePackage({ workspace, reportPath: selected });
    report.packageReceipt = { path: verified.reportPath, sha256: verified.reportSha256 };
    const archive = verified.report.packages.archives.find(row => row.path === 'ibiz-ebsx-runtime/ibiz-ebsx-allinone-rt.jar');
    assert.ok(archive);
    report.archive = { path: join(verified.report.worktree, archive.path), sha256: archive.sha256 };
    const deps = directories.open(join(output, 'dependencies'), { create: true, exclusive: true });
    const extraction = spawnSync('python3', ['-I', '-c', extractLibraries, report.archive.path, deps.path], {
      encoding: 'utf8', timeout: 120000, maxBuffer: 4 * 1024 * 1024,
    });
    assert.ok(extraction.status === 0 && !extraction.error && !extraction.signal, 'Cannot stage exact candidate libraries');
    const extracted = JSON.parse(extraction.stdout);
    assert.equal(extracted.archiveSha256, archive.sha256);
    fs.chmodSync(deps.path, 0o755);
    report.dependencies = sourceBuildInputs(deps.path);
    assert.equal(extracted.files.length, report.dependencies.files);
    for (const row of extracted.files) {
      const observed = report.dependencies.entries.find(item => item.path === row.path);
      assert.equal(observed?.sha256, row.sha256);
      assert.equal(observed.bytes, row.bytes);
    }
    const helper = directories.open(join(output, 'helper-source'), { create: true, exclusive: true });
    const source = read(join(workspace, sourceFile));
    directories.write(helper, 'OwnedWorkflowSchemaProbe.java', source);
    report.helperSource = { path: sourceFile, sha256: hash(source) };
    const classes = directories.open(join(output, 'helper-classes'), { create: true, exclusive: true });
    const image = JSON.parse(docker(['image', 'inspect', PINNED_BACKEND_RUNTIME_IMAGE]).stdout)[0];
    assert.equal(image.Os, 'linux');
    const mysqlProfile = mysqlFixtureProfile(sqlReceipt.databaseProfile?.name);
    assert.equal(image.Architecture, mysqlProfile.architecture);
    assert.equal(resources.mysqlImage, mysqlProfile.imageId);
    report.image = { reference: PINNED_BACKEND_RUNTIME_IMAGE, id: image.Id, architecture: image.Architecture };
    const compile = ['run', '--rm', '--pull=never', '--network=none', '--read-only',
      '--cap-drop=ALL', '--security-opt=no-new-privileges', '--user', `${process.geteuid()}:${process.getegid()}`,
      '--tmpfs', '/tmp:rw,nosuid,nodev,size=268435456',
      '--mount', `type=bind,src=${deps.path},dst=/dependencies,readonly`,
      '--mount', `type=bind,src=${helper.path},dst=/source,readonly`,
      '--mount', `type=bind,src=${classes.path},dst=/output`,
      '--entrypoint', 'javac', image.Id, '--release', '8', '-proc:none', '-implicit:none',
      '-sourcepath', '', '-cp', '/dependencies/*', '-d', '/output', '/source/OwnedWorkflowSchemaProbe.java'];
    const compiled = docker(compile, { allowFailure: true });
    write('compile.private.log', `${compiled.stdout ?? ''}${compiled.stderr ?? ''}`);
    report.commands.push({ stage: 'compile', args: compile, exitCode: compiled.status });
    assert.equal(compiled.status, 0, 'Exact-library workflow helper compilation failed');
    fs.chmodSync(classes.path, 0o755);
    for (const name of fs.readdirSync(classes.path)) fs.chmodSync(join(classes.path, name), 0o644);
    report.helperClasses = sourceBuildInputs(classes.path);
    assert.equal(sql(`SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name='${identity.schema}';`), '0',
      'Existing workflow schema cannot be adopted');
    assert.equal(sql(`SELECT COUNT(*) FROM mysql.user WHERE User IN ('${identity.bootstrapUser}','${identity.runtimeUser}');`), '0',
      'Existing workflow principals cannot be adopted');
    write('credentials.private.json', json({ passwords }));
    sql(`CREATE DATABASE \`${identity.schema}\` CHARACTER SET utf8mb4;`);
    report.createdSchema = true;
    for (const mode of ['bootstrap', 'verify']) {
      const username = mode === 'bootstrap' ? identity.bootstrapUser : identity.runtimeUser;
      sql(`CREATE USER '${username}'@'%' IDENTIFIED BY '${passwords[mode]}';`);
      report.createdUsers.push(username);
      sql(workflowGrantSQL(identity, username, mode === 'bootstrap'));
      const grants = sql(`SHOW GRANTS FOR '${username}'@'%';`);
      verifyWorkflowGrants(identity, username, grants, mode === 'bootstrap');
      report[`${mode}Grants`] = { sha256: hash(grants), exactScopedSchema: identity.schema };
    }
    for (const mode of ['bootstrap', 'verify']) {
      guard();
      assert.deepEqual(sourceBuildInputs(deps.path), report.dependencies);
      assert.deepEqual(sourceBuildInputs(classes.path), report.helperClasses);
      const command = workflowProbeCommand({
        runId, label, imageId: image.Id, dependencies: deps.path, classes: classes.path, mode,
      });
      containerNames.push(command[command.indexOf('--name') + 1]);
      const result = docker(command, { allowFailure: true, input: json({
        runId, mode, url: identity.url,
        username: mode === 'bootstrap' ? identity.bootstrapUser : identity.runtimeUser, password: passwords[mode],
      }) });
      write(`${mode}.private.log`, `${result.stderr ?? ''}\n${result.stdout ?? ''}`);
      report.commands.push({ stage: mode, args: command, exitCode: result.status });
      assert.ok(result.status === 0 && !result.error && !result.signal, `Workflow ${mode} failed; see private log`);
      const row = JSON.parse(result.stdout);
      verifyWorkflowProbe(row, identity, mode);
      report[mode] = row;
      guard();
    }
    const tables = sql(`SELECT TABLE_NAME FROM information_schema.tables WHERE table_schema='${identity.schema}' ORDER BY TABLE_NAME;`)
      .split('\n');
    assert.ok(tables.length > 0 && tables.every(name => /^act_[a-z0-9_]+$/.test(name)));
    report.tables = tables;
    sql(`DROP USER '${identity.bootstrapUser}'@'%';`);
    report.droppedBootstrapUser = true;
    report.workflowSchemaVerified = true;
    report.status = 'passed-owned-exact-library-workflow-schema-only';
    const configuration = json({
      url: identity.url, username: identity.runtimeUser, password: passwords.verify, schema: identity.schema,
      schemaUpdate: false,
    });
    write('configuration.private.json', configuration);
    report.configuration = { path: relative(workspace, join(output, 'configuration.private.json')),
      bytes: Buffer.byteLength(configuration), sha256: hash(configuration) };
  } catch (error) {
    report.errors.push(error.message);
  } finally {
    for (const name of containerNames) {
      const current = docker(['container', 'inspect', name], { allowFailure: true });
      if (current.status === 0) {
        const container = JSON.parse(current.stdout)[0];
        assert.equal(container.Config.Labels?.[owner], runId);
        assert.equal(container.Config.Labels?.['aibiz.workflow.bootstrap'], label);
        assert.equal(container.Image, report.image.id);
        docker(['rm', '--force', container.Id]);
      }
    }
    try { guard(); } catch { report.errors.push('Owned MySQL/network changed'); }
    if (hash(read(join(workspace, toolFile))) !== report.generator.sha256) report.errors.push('Workflow bootstrap tool changed');
    if (report.helperSource && hash(read(join(workspace, sourceFile))) !== report.helperSource.sha256) {
      report.errors.push('Workflow helper source changed');
    }
    if (report.errors.length) {
      report.status = 'failed';
      report.workflowSchemaVerified = false;
    }
    report.finishedAt = new Date().toISOString();
    write('report.json', json(report));
    directories.close();
  }
  return { report, reportPath: join(output, 'report.json') };
}

export function readOwnedWorkflowConfiguration({ workspace = workspaceDefault, runId, reportPath, packageReceipt }) {
  const identity = workflowIdentity(runId);
  workspace = resolve(workspace);
  const path = resolve(workspace, reportPath);
  const base = join(workspace, '.artifacts/native-nonadmin-fixtures', runId);
  assert.equal(dirname(dirname(path)), base);
  assert.equal(basename(path), 'report.json');
  assert.match(basename(dirname(path)), /^workflow-schema-[a-z0-9][a-z0-9-]{0,48}$/);
  const directories = new PinnedDirectories();
  const read = p => readPinnedFile(directories, directories.open(dirname(p)), basename(p));
  try {
    const bytes = read(path).data;
    const report = JSON.parse(bytes);
    assert.equal(report.contract, contract);
    assert.equal(report.runId, runId);
    assert.equal(report.status, 'passed-owned-exact-library-workflow-schema-only');
    assert.equal(report.workflowSchemaVerified, true);
    assert.equal(report.droppedBootstrapUser, true);
    assert.equal(report.nativeAcceptance, false);
    assert.equal(report.permissionAcceptance, false);
    assert.equal(report.sourceClosure, false);
    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.identity, identity);
    assert.deepEqual(report.packageReceipt, { path: packageReceipt.path, sha256: packageReceipt.sha256 });
    assert.deepEqual(report.generator, { path: toolFile, sha256: hash(read(join(workspace, toolFile)).data) });
    assert.deepEqual(report.helperSource, { path: sourceFile, sha256: hash(read(join(workspace, sourceFile)).data) });
    verifyWorkflowProbe(report.bootstrap, identity, 'bootstrap');
    verifyWorkflowProbe(report.verify, identity, 'verify');
    assert.deepEqual(sourceBuildInputs(join(dirname(path), 'dependencies')), report.dependencies);
    assert.deepEqual(sourceBuildInputs(join(dirname(path), 'helper-classes')), report.helperClasses);
    const input = read(join(dirname(path), 'configuration.private.json'));
    assert.equal(input.identity.mode & 0o077, 0);
    assert.deepEqual(report.configuration, { path: relative(workspace, join(dirname(path), 'configuration.private.json')),
      bytes: input.data.length, sha256: hash(input.data) });
    const config = JSON.parse(input.data);
    assert.equal(config.url, identity.url);
    assert.equal(config.username, identity.runtimeUser);
    assert.equal(config.schema, identity.schema);
    assert.equal(config.schemaUpdate, false);
    assert.match(config.password, /^[a-f0-9]{36}$/);
    return { configuration: config, binding: { reportPath: relative(workspace, path),
      reportSha256: hash(bytes), configurationSha256: hash(input.data) } };
  } finally { directories.close(); }
}

export function cleanupOwnedWorkflow({ runId, label, workspace = workspaceDefault }) {
  const identity = workflowIdentity(runId);
  assert.match(label ?? '', /^[a-z0-9][a-z0-9-]{0,48}$/);
  workspace = resolve(workspace);
  const base = join(workspace, '.artifacts/native-nonadmin-fixtures', runId);
  const output = join(base, `workflow-schema-${label}`);
  const directories = new PinnedDirectories();
  const read = path => readPinnedFile(directories, directories.open(dirname(path)), basename(path)).data;
  try {
    const manifest = JSON.parse(read(join(base, 'manifest.json')));
    const resources = JSON.parse(read(join(base, 'owned-resources.json')));
    const receipt = JSON.parse(read(join(output, 'report.json')));
    assert.equal(receipt.contract, contract);
    assert.equal(receipt.runId, runId);
    assert.deepEqual(receipt.identity, identity);
    assert.equal(new Set(receipt.createdUsers).size, receipt.createdUsers.length);
    assert.ok(receipt.createdUsers.every(name => [identity.runtimeUser, identity.bootstrapUser].includes(name)));
    const docker = (args, input) => {
      const result = spawnSync('docker', args, { input, encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024 });
      assert.ok(result.status === 0 && !result.error && !result.signal, 'Owned workflow cleanup failed; output suppressed');
      return result.stdout.trim();
    };
    const guard = () => validateApplicationTarget(manifest, resources,
      JSON.parse(docker(['inspect', resources.mysqlId]))[0],
      JSON.parse(docker(['network', 'inspect', resources.networkId]))[0], inspectMysqlFixtureVolumes(resources));
    const sql = input => {
      guard();
      return docker(['exec', '-i', resources.mysqlId, 'sh', '-c',
        'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -h127.0.0.1 --protocol=TCP -uroot --batch --raw --skip-column-names'], input);
    };
    guard();
    const result = { contract: 'run-owned-workflow-account-cleanup-v1', runId, status: 'running', removed: [],
      schemaRetainedUntilOwnedMysqlCleanup: true, nativeAcceptance: false };
    const target = directories.open(output);
    try {
      for (const user of receipt.createdUsers) {
        if (user === identity.bootstrapUser && receipt.droppedBootstrapUser) {
          assert.equal(sql(`SELECT COUNT(*) FROM mysql.user WHERE User='${user}';`), '0');
          continue;
        }
        assert.equal(sql(`SELECT COUNT(*) FROM information_schema.PROCESSLIST WHERE USER='${user}';`), '0',
          'Stop all owned workflow application connections before cleanup');
        const grants = sql(`SHOW GRANTS FOR '${user}'@'%';`);
        const expected = receipt[`${user === identity.bootstrapUser ? 'bootstrap' : 'verify'}Grants`];
        if (expected) assert.equal(hash(grants), expected.sha256, 'Workflow grant drift');
        else assert.equal(grants, `GRANT USAGE ON *.* TO '${user}'@'%'`);
        sql(`DROP USER '${user}'@'%';`);
        result.removed.push(user);
      }
      result.status = 'passed-owned-workflow-account-cleanup';
    } catch (error) {
      result.status = 'failed';
      result.error = error.message;
    } finally {
      directories.write(target, `cleanup-${randomBytes(6).toString('hex')}.json`, json(result));
    }
    return result;
  } finally { directories.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: {
    'execute-owned-workflow': { type: 'boolean' }, 'run-id': { type: 'string' },
    'package-report': { type: 'string' }, label: { type: 'string' },
    'cleanup-owned-workflow': { type: 'boolean' },
  } });
  assert.notEqual(Boolean(values['execute-owned-workflow']), Boolean(values['cleanup-owned-workflow']),
    'Exactly one explicit owned workflow action is required');
  if (values['cleanup-owned-workflow']) {
    const result = cleanupOwnedWorkflow({ runId: values['run-id'], label: values.label });
    console.log(json(result));
    process.exitCode = result.status.startsWith('passed-') ? 0 : 1;
  } else {
    const result = await bootstrapOwnedWorkflow({
      runId: values['run-id'], label: values.label, packageReportPath: values['package-report'],
    });
    console.log(json({ reportPath: result.reportPath, status: result.report.status,
      workflowSchemaVerified: result.report.workflowSchemaVerified, errors: result.report.errors }));
    process.exitCode = result.report.workflowSchemaVerified ? 0 : 1;
  }
}
