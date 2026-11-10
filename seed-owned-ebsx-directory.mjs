#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { PinnedDirectories, readPinnedFile } from './native-candidate-files.mjs';
import { ownedNativeRuntimeContext } from './owned-native-runtime-context.mjs';
import { ebsxIdentity, readOwnedEbsxConfiguration } from './bootstrap-owned-ebsx-schema.mjs';
import { parseJavaProperties } from './harness-run-owned-uaa-runtime.mjs';
import { sourceBuildInputs } from './source-build-identity.mjs';

const workspaceDefault = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const generator = 'scripts/seed-owned-ebsx-directory.mjs';
const helperSource = 'scripts/fixtures/OwnedEbsxDirectorySeed.java';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const tables = ['IBZPSSYSTEM', 'IBZCENTER', 'IBZDCSYSTEM'];
const primary = { IBZPSSYSTEM: 'PSSYSTEMID', IBZCENTER: 'CENTERID', IBZDCSYSTEM: 'DCSYSTEMID' };
const id = value => { assert.match(value, /^[A-Za-z][A-Za-z0-9_]*$/); return `\`${value}\``; };
const text = value => {
  assert.equal(typeof value, 'string');
  assert.ok(!/[\0\r\n]/.test(value));
  return `CONVERT(0x${Buffer.from(value).toString('hex')} USING utf8mb4)`;
};

export function createOwnedDirectoryPlan(manifest, source, provider) {
  assert.match(manifest.runId, /^[a-f0-9]{12}$/);
  assert.equal(manifest.scenario, 'two-center');
  const centers = ['a', 'b'].map(side => `nf_${manifest.runId}_center_${side}`);
  assert.deepEqual([...new Set(manifest.users.map(user => user.centerId))].sort(), centers);
  assert.deepEqual([...new Set(manifest.roots.map(root => root.centerId))].sort(), centers);
  assert.equal(provider.deploySystemId, 'ibizmodeling');
  assert.equal(provider.model.codeName.toLowerCase(), provider.deploySystemId);
  assert.equal(typeof provider.model.name, 'string');
  assert.ok(provider.model.name.length > 0 && provider.model.name.length <= 100);
  assert.deepEqual(source.domains.map(row => row.id), centers);
  assert.deepEqual(source.deployments.map(row => row.id), centers.map(center => `${center}_deploy`));
  for (const [index, center] of centers.entries()) {
    const domain = source.domains[index];
    const deployment = source.deployments[index];
    assert.equal(domain.name, center);
    assert.equal(deployment.centerId, center);
    assert.equal(deployment.systemId, provider.deploySystemId);
    assert.equal(deployment.enabled, 1);
    assert.equal(deployment.deleted, 0);
    assert.equal(typeof deployment.name, 'string');
    assert.ok(deployment.name.length > 0 && deployment.name.length <= 100);
  }
  return {
    contract: 'owned-ebsx-directory-plan-v1', runId: manifest.runId,
    schema: ebsxIdentity(manifest.runId).schema,
    rows: [
      { table: 'IBZPSSYSTEM', values: { PSSYSTEMID: provider.deploySystemId, PSSYSTEMNAME: provider.model.name } },
      ...source.domains.map(row => ({ table: 'IBZCENTER', values: { CENTERID: row.id, CENTERNAME: row.name } })),
      ...source.deployments.map(row => ({ table: 'IBZDCSYSTEM', values: {
        DCSYSTEMID: row.id, DCSYSTEMNAME: row.name, SYSTEMID: row.systemId, SRFDCID: row.centerId,
      } })),
    ],
    modelStructureSynchronized: false,
    nativeAcceptance: false,
  };
}

export function directorySourceSQL(manifest) {
  const run = manifest.runId;
  assert.match(run, /^[a-f0-9]{12}$/);
  assert.equal(manifest.schemas.uaa, `nf_${run}_uaa`);
  const centers = ['a', 'b'].map(side => `nf_${run}_center_${side}`);
  const from = table => `${id(manifest.schemas.uaa)}.${id(table)}`;
  return [
    `SELECT JSON_OBJECT('kind','domain','id',ID,'name',DOMAIN_NAME) FROM ${from('sys_domain')}`
      + ` WHERE ID IN (${centers.map(text).join(',')}) ORDER BY ID;`,
    `SELECT JSON_OBJECT('kind','deployment','id',ID,'systemId',SYSTEM_ID,'centerId',DC,`
      + `'name',DISPLAY_NAME,'enabled',ENABLED,'deleted',DELETED) FROM ${from('sys_deploy_system')}`
      + ` WHERE ID IN (${centers.map(center => text(`${center}_deploy`)).join(',')}) ORDER BY ID;`,
  ].join('\n');
}

export function verifyDirectoryColumns(model, observed) {
  const types = { 5: 'datetime', 9: 'int', 21: 'mediumtext', 25: 'varchar' };
  const result = {};
  for (const table of tables) {
    const declared = model.getAllPSSysDBTables.filter(row => row.name === table);
    assert.equal(declared.length, 1);
    const columns = declared[0].getAllPSSysDBColumns;
    assert.ok(Array.isArray(columns) && columns.length > 1);
    const actual = observed.filter(row => row.table.toUpperCase() === table);
    assert.deepEqual(actual.map(row => row.name.toUpperCase()).sort(), columns.map(row => row.name).sort());
    for (const column of columns) {
      const found = actual.find(row => row.name.toUpperCase() === column.name);
      assert.equal(found.type, types[column.stdDataType], `Directory column type differs: ${table}.${column.name}`);
      assert.ok(Object.hasOwn(types, column.stdDataType));
      assert.equal(found.nullable, column.pKey || column.nullable === false ? 'NO' : 'YES');
      assert.equal(found.key === 'PRI', column.pKey === true);
      assert.equal(found.extra, '');
      assert.equal(found.default, null);
      if (column.stdDataType === 25) assert.equal(found.length, column.length);
    }
    assert.deepEqual(columns.filter(column => column.pKey).map(column => column.name), [primary[table]]);
    result[table] = columns.map(column => column.name).sort();
  }
  assert.equal(observed.length, Object.values(result).reduce((sum, columns) => sum + columns.length, 0));
  return result;
}

export function directorySnapshotSQL(schema, columns) {
  assert.match(schema, /^nf_[a-f0-9]{12}_ebsx$/);
  assert.deepEqual(Object.keys(columns).sort(), [...tables].sort());
  return tables.map(table => {
    assert.ok(columns[table].length > 1 && columns[table].includes(primary[table]));
    const fields = columns[table].map(column => `${text(column)},${id(column)}`).join(',');
    return `SELECT JSON_OBJECT('table',${text(table)},'values',JSON_OBJECT(${fields})) FROM `
      + `${id(schema)}.${id(table)} ORDER BY ${id(primary[table])};`;
  }).join('\n');
}

export function verifyDirectoryReadback(plan, columns, actual) {
  assert.equal(plan.rows.length, 5);
  const expected = plan.rows.map(row => ({
    table: row.table, values: { ...Object.fromEntries(columns[row.table].map(column => [column, null])), ...row.values },
  }));
  assert.deepEqual(actual, expected, 'Native directory full-column readback differs');
}

function jsonRows(value) {
  assert.equal(typeof value, 'string');
  assert.ok(Buffer.byteLength(value) < 4 * 1024 * 1024);
  return value.trim() ? value.trim().split('\n').map(row => JSON.parse(row)) : [];
}

export async function seedOwnedDirectory({
  workspace = workspaceDefault, runId, deploymentInput, ebsxReport, label, executeSeed = false,
}) {
  assert.equal(executeSeed, true, 'Explicit owned directory seed opt-in required');
  assert.match(label ?? '', /^[a-z0-9][a-z0-9-]{0,48}$/);
  workspace = resolve(workspace);
  const context = ownedNativeRuntimeContext({ workspace, runId, deploymentInput });
  const directories = new PinnedDirectories();
  const output = join(context.base, `ebsx-directory-${label}`);
  let target;
  const helpers = [];
  const bindings = [];
  const report = {
    contract: 'owned-ebsx-directory-seed-v1', runId, label, startedAt: new Date().toISOString(),
    status: 'running', nativeAcceptance: false, sourceClosure: false, permissionAcceptance: false,
    sharedServicesChanged: false, directoryRowsVerified: false, retainedOwnedDirectory: false,
    inputs: context.bindings, helpers, bindings, errors: [],
  };
  const read = (path, privateInput = false) => {
    path = resolve(workspace, path);
    const child = relative(workspace, path);
    assert.ok(child && !child.startsWith('..') && !child.startsWith('/'));
    const file = readPinnedFile(directories, directories.open(dirname(path)), basename(path));
    if (privateInput) {
      assert.equal(file.identity.uid, process.geteuid());
      assert.equal(file.identity.mode & 0o077, 0);
    }
    bindings.push({ path, sha256: hash(file.data), bytes: file.data.length, privateInput });
    return file.data;
  };
  const guard = () => {
    const current = context.guard();
    for (const binding of bindings) {
      const file = readPinnedFile(directories, directories.open(dirname(binding.path)), basename(binding.path));
      assert.equal(hash(file.data), binding.sha256, 'Directory source/input drift');
    }
    return current;
  };
  const docker = (args, { input, allowFailure = false } = {}) => {
    const result = spawnSync('docker', args, {
      input, encoding: 'utf8', timeout: 180_000, maxBuffer: 16 * 1024 * 1024,
    });
    if (!allowFailure) assert.ok(result.status === 0 && !result.error && !result.signal,
      'Owned directory Docker operation failed; private details suppressed');
    return result;
  };
  const sql = statement => {
    guard();
    const result = docker(['exec', '-i', context.resources.mysqlId, 'sh', '-c',
      'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -h127.0.0.1 --protocol=TCP -uroot --batch --raw --skip-column-names'],
    { input: statement });
    guard();
    return result.stdout;
  };
  const write = (name, bytes, mode = 0o600) => directories.write(target, name, bytes, mode);
  const runHelper = (stage, imageId, args) => {
    guard();
    const name = `nf-${runId}-directory-${label}-${stage}`;
    assert.equal(args[args.indexOf('--name') + 1], name);
    const absent = docker(['container', 'inspect', name], { allowFailure: true });
    assert.equal(absent.status, 1);
    assert.equal(absent.stderr.trim(), `Error response from daemon: No such container: ${name}`);
    const token = randomBytes(18).toString('hex');
    const cidPath = join(output, `${stage}.cid`);
    assert.equal(fs.existsSync(cidPath), false);
    const entry = { stage, name, imageId, token, cidPath, startedAt: new Date().toISOString(), id: null };
    helpers.push(entry);
    write(`${stage}-intent.private.json`, json(entry));
    args = [...args];
    args.splice(1, 0, '--cidfile', cidPath, '--label', `aibiz.directory.attempt=${token}`);
    let result;
    try { result = docker(args, { allowFailure: true }); }
    finally {
      if (fs.existsSync(cidPath)) {
        const cid = readPinnedFile(directories, target, `${stage}.cid`).data.toString('utf8').trim();
        assert.match(cid, /^[a-f0-9]{64}$/);
        entry.id = cid;
      }
    }
    write(`${stage}.private.log`, `${result.stdout ?? ''}${result.stderr ?? ''}`);
    assert.ok(result.status === 0 && !result.error && !result.signal, `Directory ${stage} failed; see private log`);
    assert.ok(entry.id, 'Helper success requires its CID');
    guard();
    return result.stdout;
  };
  try {
    target = directories.open(output, { create: true, exclusive: true });
    read(join(workspace, generator));
    read(join(workspace, helperSource));
    const live = guard();
    const imageReport = JSON.parse(read(context.deployment.imageReceipt.path));
    const packageReceipt = imageReport.packageReceipt;
    const ebsx = readOwnedEbsxConfiguration({ workspace, runId, reportPath: ebsxReport, packageReceipt });
    report.ebsxBinding = ebsx.binding;
    assert.equal(hash(read(join(dirname(resolve(workspace, ebsxReport)), 'configuration.private.json'), true)),
      ebsx.binding.configurationSha256);
    const ebsxBytes = read(ebsxReport);
    const ebsxReceipt = JSON.parse(ebsxBytes);
    const packageBytes = read(packageReceipt.path);
    assert.equal(hash(packageBytes), packageReceipt.sha256);
    const packageData = JSON.parse(packageBytes);
    const modelBytes = read(join(packageData.worktree,
      'libs/ibiz-cloud-saas-ebsx/src/main/resources/sysmodel/saas-ebsx/PSSYSDBSCHEMES/DEFAULT.json'));
    assert.equal(hash(modelBytes), ebsxReceipt.modelHashes.DEFAULT);
    const model = JSON.parse(modelBytes);
    const provider = live.containers.find(row => row.Id === context.deployment.services.provider.containerId);
    const modelMounts = provider.Mounts.filter(row => row.Destination === '/app/model');
    assert.equal(modelMounts.length, 1);
    assert.equal(modelMounts[0].Type, 'bind');
    assert.equal(modelMounts[0].RW, false);
    assert.ok(modelMounts[0].Source.startsWith(`${context.base}/`));
    const providerModel = JSON.parse(read(join(modelMounts[0].Source, 'PSSYSTEM.json')));
    const configMounts = provider.Mounts.filter(row => row.Destination === '/app/config/application.properties');
    assert.equal(configMounts.length, 1);
    const providerConfig = parseJavaProperties(read(configMounts[0].Source));
    const sourceStatement = directorySourceSQL(context.manifest);
    const sourceRows = jsonRows(sql(sourceStatement));
    const source = {
      domains: sourceRows.filter(row => row.kind === 'domain').map(({ kind, ...row }) => row),
      deployments: sourceRows.filter(row => row.kind === 'deployment').map(({ kind, ...row }) => row),
    };
    const plan = createOwnedDirectoryPlan(context.manifest, source, {
      deploySystemId: providerConfig['ibiz.deploysystems.ibizmodeling.deploysystemid'], model: providerModel,
    });
    write('source-before.private.json', json(sourceRows));
    write('plan.json', json(plan));
    const schema = ebsxIdentity(runId).schema;
    const metadata = jsonRows(sql("SELECT JSON_OBJECT('table',TABLE_NAME,'name',COLUMN_NAME,'type',DATA_TYPE,"
      + "'nullable',IS_NULLABLE,'default',COLUMN_DEFAULT,'key',COLUMN_KEY,'length',CHARACTER_MAXIMUM_LENGTH,'extra',EXTRA)"
      + ` FROM information_schema.columns WHERE TABLE_SCHEMA=${text(schema)} AND TABLE_NAME IN `
      + `(${tables.map(table => text(table.toLowerCase())).join(',')}) ORDER BY TABLE_NAME,ORDINAL_POSITION;`));
    const columns = verifyDirectoryColumns(model, metadata);
    const snapshotSQL = directorySnapshotSQL(schema, columns);
    const before = jsonRows(sql(snapshotSQL));
    assert.deepEqual(before, [], 'Existing directory rows cannot be adopted');
    write('target-before.private.json', json(before));
    write('column-inventory.private.json', json(metadata));
    const sourceDir = directories.open(join(output, 'helper-source'), { create: true, exclusive: true });
    const classesDir = directories.open(join(output, 'helper-classes'), { create: true, exclusive: true });
    directories.write(sourceDir, 'OwnedEbsxDirectorySeed.java', read(join(workspace, helperSource)));
    const dependencies = resolve(workspace, ebsxReceipt.dependencies.path);
    const { path: dependencyPath, ...inventory } = ebsxReceipt.dependencies;
    assert.deepEqual(sourceBuildInputs(dependencies), inventory);
    const identity = JSON.parse(docker(['image', 'inspect', ebsxReceipt.image.reference]).stdout)[0];
    assert.equal(identity.Id, ebsxReceipt.image.id);
    const common = stage => ['run', '--rm', '--pull=never', '--name', `nf-${runId}-directory-${label}-${stage}`,
      '--label', `aibiz.native-fixture.run=${runId}`, '--label', `aibiz.directory.seed=${label}`,
      '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges',
      '--tmpfs', '/tmp:rw,nosuid,nodev,size=134217728'];
    runHelper('compile', identity.Id, [...common('compile'), '--network=none',
      '--user', `${process.geteuid()}:${process.getegid()}`,
      '--mount', `type=bind,src=${dependencies},dst=/dependencies,readonly`,
      '--mount', `type=bind,src=${sourceDir.path},dst=/source,readonly`,
      '--mount', `type=bind,src=${classesDir.path},dst=/classes`,
      '--entrypoint', 'javac', identity.Id, '--release', '8', '-proc:none', '-implicit:none', '-sourcepath', '',
      '-cp', '/dependencies/*', '-d', '/classes', '/source/OwnedEbsxDirectorySeed.java']);
    fs.chmodSync(classesDir.path, 0o755);
    for (const name of fs.readdirSync(classesDir.path)) fs.chmodSync(join(classesDir.path, name), 0o644);
    report.helperClasses = sourceBuildInputs(classesDir.path);
    const inputsDir = directories.open(join(output, 'probe-inputs'), { create: true, exclusive: true });
    directories.write(inputsDir, 'input.private.json', json({
      ...ebsx.configuration, runId, rows: plan.rows,
    }), 0o644);
    fs.chmodSync(inputsDir.path, 0o755);
    read(join(inputsDir.path, 'input.private.json'));
    report.intent = { planSha256: hash(json(plan)), sourceSha256: hash(json(sourceRows)), originalRows: 0 };
    write('pending-seed.private.json', json(report.intent));
    const probe = runHelper('seed', identity.Id, [...common('seed'), '--network', context.resources.networkId,
      '--user', '65532:65532',
      '--mount', `type=bind,src=${dependencies},dst=/dependencies,readonly`,
      '--mount', `type=bind,src=${classesDir.path},dst=/classes,readonly`,
      '--mount', `type=bind,src=${inputsDir.path},dst=/inputs,readonly`,
      '--entrypoint', 'java', identity.Id, '-cp', '/classes:/dependencies/*', 'OwnedEbsxDirectorySeed']);
    report.jdbcProbe = JSON.parse(probe);
    assert.equal(report.jdbcProbe.contract, 'owned-ebsx-directory-jdbc-v1');
    assert.equal(report.jdbcProbe.runId, runId);
    assert.equal(report.jdbcProbe.principal.split('@')[0], ebsx.configuration.username);
    assert.equal(report.jdbcProbe.committed, true);
    assert.equal(report.jdbcProbe.inserted, 5);
    const after = jsonRows(sql(snapshotSQL));
    verifyDirectoryReadback(plan, columns, after);
    write('target-after.private.json', json(after));
    const sourceAfter = jsonRows(sql(sourceStatement));
    assert.deepEqual(sourceAfter, sourceRows, 'Source UAA directory changed');
    write('source-after.private.json', json(sourceAfter));
    assert.deepEqual(sourceBuildInputs(dependencies), inventory);
    assert.deepEqual(sourceBuildInputs(classesDir.path), report.helperClasses);
    report.sourceRowsUnchanged = true;
    report.directoryRowsVerified = true;
    report.retainedOwnedDirectory = true;
    report.status = 'passed-owned-ebsx-directory-only';
  } catch (error) {
    report.status = 'failed-owned-ebsx-directory';
    report.errors.push('Directory prerequisite, transaction or readback failed; see owner-private diagnostic.');
    if (target) write('failure.private.log', `${error.stack ?? error}\n`);
  } finally {
    for (const helper of [...helpers].reverse()) {
      try {
        const inspected = docker(['container', 'inspect', helper.id ?? helper.name], { allowFailure: true });
        if (inspected.status === 1 && inspected.stderr.trim()
          === `Error response from daemon: No such container: ${helper.id ?? helper.name}`) {
          helper.cleanup = 'already-removed';
          continue;
        }
        assert.ok(inspected.status === 0 && !inspected.error && !inspected.signal);
        const current = JSON.parse(inspected.stdout)[0];
        assert.equal(current.Name, `/${helper.name}`);
        assert.equal(current.Image, helper.imageId);
        assert.equal(current.Config.Labels?.['aibiz.native-fixture.run'], runId);
        assert.equal(current.Config.Labels?.['aibiz.directory.attempt'], helper.token);
        assert.ok(Date.parse(current.Created) >= Date.parse(helper.startedAt) - 1000);
        if (helper.id) assert.equal(current.Id, helper.id);
        docker(['rm', '--force', current.Id]);
        helper.id = current.Id;
        helper.cleanup = 'removed-exact-created-id';
      } catch {
        helper.cleanup = 'refused-identity-or-inspection-drift';
        report.status = 'failed-owned-ebsx-directory';
        report.errors.push('Exact owned helper cleanup failed.');
      }
    }
    try { guard(); report.backendPeersUnchanged = true; }
    catch { report.backendPeersUnchanged = false; report.status = 'failed-owned-ebsx-directory'; }
    try {
      if (target) {
        report.completedAt = new Date().toISOString();
        write('report.json', json(report));
      }
    } finally { context.close(); directories.close(); }
  }
  return { reportPath: join(output, 'report.json'), report };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: {
      'execute-owned-directory-seed': { type: 'boolean' }, 'run-id': { type: 'string' },
      'deployment-input': { type: 'string' }, 'ebsx-report': { type: 'string' }, label: { type: 'string' },
    } });
    const result = await seedOwnedDirectory({
      runId: values['run-id'], deploymentInput: values['deployment-input'], ebsxReport: values['ebsx-report'],
      label: values.label, executeSeed: values['execute-owned-directory-seed'],
    });
    console.log(json({ reportPath: result.reportPath, status: result.report.status,
      directoryRowsVerified: result.report.directoryRowsVerified }));
    if (result.report.status.startsWith('failed')) process.exitCode = 1;
  } catch {
    console.error('Owned directory seed refused; private details suppressed.');
    process.exitCode = 1;
  }
}
