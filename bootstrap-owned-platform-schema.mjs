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
import { ebsxIdentity, readOwnedEbsxConfiguration } from './bootstrap-owned-ebsx-schema.mjs';
import { verifyBackendSourcePackage } from './harness-backend-source-package.mjs';
import { validateApplicationTarget } from './provision-run-owned-native-application-accounts.mjs';
import { inspectMysqlFixtureVolumes } from './owned-mysql-volume.mjs';
import { ownedNativeRuntimeContext } from './owned-native-runtime-context.mjs';

const workspaceDefault = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const toolFile = 'scripts/bootstrap-owned-platform-schema.mjs';
const sourceFile = 'scripts/fixtures/OwnedPlatformSchemaProbe.java';
const contract = 'run-owned-native-platform-schema-v1';
const modelFile = 'libs/ibiz-cloud-saas-extension/src/main/resources/sysmodel/saas-extension/PSSYSDBSCHEMES/DEFAULT.json';
const queryResource = 'sysmodel/saas-ebsx/PSMODULES/ou/PSDATAENTITIES/Employee/PSDEDATAQUERIES/Default/PSDEDQCODES/MYSQL5.json';
const operatorFile = `ibiz-ebsx-runtime/src/main/resources/${queryResource}`;
const columnless = ['SYSTEM_EXTENSION_MAINSTATE', 'SYSTEM_EXTENSION_SCHEDULE_TASK'];
const hash = value => createHash('sha256').update(value).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const projectionColumns = {
  sys_person: ['ID', 'UID', 'DC', 'POSTAL_ADDRESS', 'AVATAR', 'IDENTIFICATION_NUMBER', 'CREATE_TIME',
    'MAIL', 'ENABLED', 'MDEPARTMENT_ID', 'DESCRIPTION', 'DISPLAY_NAME', 'ORGANIZATION_ID', 'MOBILE',
    'STATUS', 'UPDATE_TIME', 'EMPLOYEE_NUMBER', 'TELEPHONE_NUMBER'],
  sys_organization: ['ID', 'ORGANIZATION_NUMBER', 'ORGANIZATION_NAME', 'DC'],
  sys_department: ['ID', 'BUSINESS_CATEGORY', 'DEPARTMENT_NUMBER', 'DEPARTMENT_NAME', 'DC'],
};

export function platformIdentity(runId) {
  assert.match(runId, /^[a-f0-9]{12}$/);
  const schema = `nf_${runId}_platform`;
  return {
    schema, bootstrapUser: `nf_${runId}_plat_ddl`, runtimeUser: `nf_${runId}_plat_app`,
    url: `jdbc:mysql://nf-${runId}-mysql:3306/${schema}?useUnicode=true&characterEncoding=UTF-8&useSSL=false`,
  };
}

export function platformGrantSQL(identity, mode) {
  assert.deepEqual(identity, platformIdentity(identity.schema.slice(3, 15)));
  assert.ok(['bootstrap', 'verify'].includes(mode));
  const privileges = mode === 'bootstrap'
    ? 'SELECT, INSERT, UPDATE, DELETE, CREATE, DROP, REFERENCES, INDEX, ALTER'
    : 'SELECT, INSERT, UPDATE, DELETE';
  const user = mode === 'bootstrap' ? identity.bootstrapUser : identity.runtimeUser;
  return `GRANT ${privileges} ON \`${identity.schema.replaceAll('_', '\\_')}\`.* TO '${user}'@'%';`;
}

export function verifyPlatformGrants(identity, mode, text, { allowPartial = false } = {}) {
  const user = mode === 'bootstrap' ? identity.bootstrapUser : identity.runtimeUser;
  const usage = `GRANT USAGE ON *.* TO '${user}'@'%'`;
  const observed = text.trim().split('\n').sort();
  if (allowPartial && observed.length === 1) assert.deepEqual(observed, [usage]);
  else assert.deepEqual(observed, [usage, platformGrantSQL(identity, mode).slice(0, -1)].sort(),
    'Platform principal must retain only exact schema-scoped privileges');
}

export function platformOperatorProjectionIdentity(runId) {
  platformIdentity(runId);
  return {
    user: `nf_${runId}_plat_ro`, host: 'localhost', sourceSchema: `nf_${runId}_uaa`,
    targetSchema: `nf_${runId}_ebsx`, tables: Object.keys(projectionColumns),
  };
}

function fixtureUsers(manifest) {
  platformIdentity(manifest.runId);
  assert.equal(manifest.schemas.uaa, `nf_${manifest.runId}_uaa`);
  assert.equal(manifest.users.length, 6);
  const users = manifest.users.toSorted((a, b) => a.personId.localeCompare(b.personId));
  assert.equal(new Set(users.map(row => row.personId)).size, 6);
  assert.deepEqual([...new Set(users.map(row => row.centerId))].sort(),
    ['a', 'b'].map(suffix => `nf_${manifest.runId}_center_${suffix}`));
  for (const user of users) {
    assert.match(user.personId, new RegExp(`^nf_${manifest.runId}_person_[ab]_[evn]$`));
    assert.equal(user.centerId, `nf_${manifest.runId}_center_${user.personId.at(-3)}`);
    assert.equal(typeof user.loginname, 'string');
  }
  return users;
}

function projectionPredicate(manifest, table, alias) {
  const users = fixtureUsers(manifest);
  const centers = [...new Set(users.map(row => row.centerId))].sort();
  const column = name => `${alias ? `\`${alias}\`.` : ''}\`${name}\``;
  if (table === 'sys_person') {
    return centers.map(center => `(${column('DC')}='${center}' AND ${column('ID')} IN (`
      + users.filter(user => user.centerId === center).map(user => `'${user.personId}'`).join(',') + '))').join(' OR ');
  }
  if (table === 'sys_organization') {
    return centers.map(center => `(\`DC\`='${center}' AND \`ID\`='${center}_org')`).join(' OR ');
  }
  assert.equal(table, 'sys_department');
  return `EXISTS (SELECT 1 FROM \`${manifest.schemas.uaa}\`.\`sys_person\` AS \`owned_person\` WHERE (`
    + projectionPredicate(manifest, 'sys_person', 'owned_person')
    + ') AND `owned_person`.`MDEPARTMENT_ID`=`sys_department`.`ID`'
    + ' AND `owned_person`.`DC`=`sys_department`.`DC`)';
}

export function platformOperatorProjectionGrantSQL(runId) {
  const projection = platformOperatorProjectionIdentity(runId);
  return Object.entries(projectionColumns).map(([table, columns]) =>
    `GRANT SELECT (${columns.map(column => `\`${column}\``).join(', ')}) ON `
    + `\`${projection.sourceSchema}\`.\`${table}\` TO '${projection.user}'@'${projection.host}';`);
}

export function verifyPlatformOperatorProjectionGrants(runId, text, { allowPartial = false } = {}) {
  const projection = platformOperatorProjectionIdentity(runId);
  const lines = text.trim().split('\n');
  const usage = `GRANT USAGE ON *.* TO '${projection.user}'@'${projection.host}'`;
  assert.equal(lines.filter(line => line === usage).length, 1);
  const remaining = lines.filter(line => line !== usage);
  if (allowPartial) assert.ok(remaining.length <= projection.tables.length);
  else assert.equal(remaining.length, projection.tables.length);
  const seen = new Set();
  for (const line of remaining) {
    const match = /^GRANT SELECT \(([^)]+)\) ON `([^`]+)`\.`([^`]+)` TO '([^']+)'@'([^']+)'$/.exec(line);
    assert.ok(match, 'Projection definer may have only column-level SELECT');
    const [, rawColumns, schema, table, user, host] = match;
    assert.equal(schema, projection.sourceSchema);
    assert.equal(user, projection.user);
    assert.equal(host, projection.host);
    assert.ok(projection.tables.includes(table) && !seen.has(table));
    seen.add(table);
    const columns = rawColumns.split(',').map(value => {
      const identifier = /^(?:`([A-Z][A-Z0-9_]*)`|([A-Z][A-Z0-9_]*))$/.exec(value.trim());
      assert.ok(identifier, 'Projection grants require complete bare or backtick column identifiers');
      return identifier[1] ?? identifier[2];
    });
    assert.deepEqual(columns.toSorted(), projectionColumns[table].toSorted());
  }
}

export function platformOperatorProjectionViewSQL(manifest, ownershipMarkers) {
  const projection = platformOperatorProjectionIdentity(manifest.runId);
  fixtureUsers(manifest);
  if (ownershipMarkers !== undefined) {
    assert.deepEqual(Object.keys(ownershipMarkers).sort(), projection.tables.toSorted());
    for (const marker of Object.values(ownershipMarkers)) assert.match(marker, /^[a-f0-9]{36}$/);
  }
  return Object.entries(projectionColumns).map(([table, columns]) => {
    const selected = columns.map(column => `\`${column}\``);
    // The packaged Employee query selects PASSWORD even for display-only code lists.
    if (table === 'sys_person') selected.push('CAST(NULL AS CHAR(1)) AS `USER_PASSWORD`');
    return `CREATE ALGORITHM=UNDEFINED DEFINER='${projection.user}'@'${projection.host}' SQL SECURITY DEFINER `
      + `VIEW \`${projection.targetSchema}\`.\`${table}\` AS SELECT DISTINCT ${selected.join(', ')} `
      + `FROM \`${projection.sourceSchema}\`.\`${table}\` WHERE (${projectionPredicate(manifest, table)})`
      + (ownershipMarkers ? ` AND ('${ownershipMarkers[table]}'='${ownershipMarkers[table]}')` : '') + ';';
  });
}

export function platformAuthenticationSha256(password) {
  assert.match(password, /^[a-f0-9]{36}$/);
  const first = createHash('sha1').update(password).digest();
  return hash(`*${createHash('sha1').update(first).digest('hex').toUpperCase()}`);
}

export function verifyPlatformUserOwnership(runId, entry, actual) {
  const identity = platformIdentity(runId);
  const projection = platformOperatorProjectionIdentity(runId);
  assert.ok(entry.preAbsent && entry.creationAttempted);
  assert.ok([identity.bootstrapUser, identity.runtimeUser, projection.user].includes(entry.user));
  assert.equal(entry.host, entry.user === projection.user ? projection.host : '%');
  assert.match(entry.authenticationSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(actual, {
    user: entry.user, host: entry.host, plugin: 'mysql_native_password',
    authenticationSha256: entry.authenticationSha256,
    accountLocked: entry.user === projection.user ? 'Y' : 'N',
  }, 'SQL account is not the principal created with this private candidate credential');
}

export function verifyPlatformViewCleanup(runId, row, actual, columns, definitionSha256) {
  const projection = platformOperatorProjectionIdentity(runId);
  assert.ok(projection.tables.includes(row.table));
  assert.equal(row.preAbsent, true);
  assert.equal(row.creationAttempted, true);
  assert.match(row.ownershipMarker, /^[a-f0-9]{36}$/);
  const expectedColumns = [...projectionColumns[row.table],
    ...(row.table === 'sys_person' ? ['USER_PASSWORD'] : [])];
  assert.deepEqual(row.columns, expectedColumns);
  assert.deepEqual(columns, expectedColumns);
  assert.equal(actual.schema, projection.targetSchema);
  assert.equal(actual.table, row.table);
  assert.equal(actual.definer, `${projection.user}@${projection.host}`);
  assert.equal(actual.security, 'DEFINER');
  assert.equal(actual.updatable, 'NO');
  assert.equal(typeof actual.definition, 'string');
  const marker = row.ownershipMarker;
  assert.match(actual.definition, new RegExp(`(?:_[a-z0-9]+)?'${marker}'\\s*=\\s*(?:_[a-z0-9]+)?'${marker}'`, 'i'),
    'View lacks this creation attempt ownership marker');
  assert.ok(actual.definition.includes(`\`${projection.sourceSchema}\`.\`${row.table}\``));
  if (row.viewDefinitionSha256) assert.equal(definitionSha256, row.viewDefinitionSha256);
}

export function verifyPlatformModel(model) {
  assert.equal(model.getAllPSSysDBTables?.length, 34);
  const tables = model.getAllPSSysDBTables;
  assert.equal(new Set(tables.map(row => row.name)).size, tables.length);
  const undefinedTables = tables.filter(row => row.getAllPSSysDBColumns === undefined);
  assert.deepEqual(undefinedTables.map(row => row.name).sort(), columnless);
  assert.ok(undefinedTables.every(row => row.autoExtendModel === true && row.existingModel === false));
  const physical = tables.filter(row => row.getAllPSSysDBColumns !== undefined);
  assert.equal(physical.length, 32);
  for (const table of physical) {
    assert.match(table.name, /^[A-Z][A-Z0-9_]*$/);
    assert.ok(Array.isArray(table.getAllPSSysDBColumns) && table.getAllPSSysDBColumns.length > 0);
    assert.equal(new Set(table.getAllPSSysDBColumns.map(row => row.name)).size, table.getAllPSSysDBColumns.length);
    assert.deepEqual(table.getAllPSSysDBColumns.filter(row => row.pKey).map(row => row.name), ['ID']);
  }
  assert.ok(physical.some(row => row.name === 'INTERNAL_MESSAGE'));
  return { tables: physical.map(row => row.name).sort(), columnlessModelEntries: columnless };
}

export function verifyPlatformOperatorSource(source) {
  const model = JSON.parse(source);
  assert.equal(typeof model.queryCode, 'string');
  const sql = model.queryCode;
  assert.ok(sql.startsWith('SELECT\n') && sql.includes('t1.USER_PASSWORD as PASSWORD'));
  assert.ok(sql.includes('FROM sys_person t1 left join sys_organization o'));
  assert.ok(sql.includes('left join sys_department d'));
  assert.ok(sql.includes('t1.EMPLOYEE_NUMBER as USERCODE') && sql.includes('o.DC as SRFDCID'));
  assert.ok(!/[;]|--|\/\*/.test(sql), 'Only the reviewed single SELECT query is allowed');
  const inner = sql.slice(sql.indexOf('FROM (SELECT') + 'FROM (SELECT'.length, sql.indexOf('FROM sys_person t1'));
  const sourceFields = alias => [...inner.matchAll(new RegExp(`\\b${alias}\\.([A-Z_]+)`, 'g'))]
    .map(match => match[1]).filter((name, index, values) => values.indexOf(name) === index).sort();
  assert.deepEqual(sourceFields('t1'), [...projectionColumns.sys_person.filter(name => !['ORGANIZATION_ID', 'MDEPARTMENT_ID'].includes(name)),
    'ORGANIZATION_ID', 'MDEPARTMENT_ID', 'USER_PASSWORD'].sort());
  assert.deepEqual(sourceFields('o'), ['DC', 'ORGANIZATION_NAME', 'ORGANIZATION_NUMBER']);
  assert.deepEqual(sourceFields('d'), ['BUSINESS_CATEGORY', 'DEPARTMENT_NAME', 'DEPARTMENT_NUMBER']);
  return hash(source);
}

export function verifyPlatformProbe(row, identity, mode, model, manifest, operatorSha256) {
  assert.equal(row.mode, mode);
  assert.equal(row.schema, identity.schema);
  assert.equal(row.sqlPrincipal, `${mode === 'bootstrap' ? identity.bootstrapUser : identity.runtimeUser}@%`);
  assert.equal(row.adapterOrigin, 'file:/dependencies/ibiz-plugin-liquibase-8.1.0.584.1.jar');
  assert.deepEqual(row.tables, model.tables);
  assert.deepEqual(row.columnlessModelEntries, model.columnlessModelEntries);
  assert.equal(row.modelSha256, model.sha256);
  assert.equal(row.primaryKeysVerified, true);
  assert.ok(Number.isSafeInteger(row.columnsVerified) && row.columnsVerified > 32);
  assert.ok(Number.isSafeInteger(row.indicesVerified) && row.indicesVerified > 0);
  if (mode === 'bootstrap') assert.equal(row.adapterReplayPassed, true);
  else {
    for (const key of ['crudVerified', 'runtimeDdlDenied', 'probeRemoved', 'projectionDmlDenied',
      'uaaDirectReadDenied', 'operatorPasswordMasked']) assert.equal(row[key], true);
    assert.equal(row.operatorQuerySha256, operatorSha256);
    assert.equal(typeof row.operatorValuesReady, 'boolean');
    assert.deepEqual(row.operatorUsers, fixtureUsers(manifest).map(user => ({
      personId: user.personId, centerId: user.centerId, displayName: user.loginname,
      loginname: user.loginname, operatorValuePresent: row.operatorUsers
        .find(actual => actual.personId === user.personId)?.operatorValuePresent,
    })));
    assert.ok(row.operatorUsers.every(user => typeof user.operatorValuePresent === 'boolean'));
    assert.equal(row.operatorValuesReady, row.operatorUsers.every(user => user.operatorValuePresent));
  }
}

export function platformProbeCommand({ runId, label, imageId, dependencies, classes, inputs, mode }) {
  platformIdentity(runId);
  assert.match(label, /^[a-z0-9][a-z0-9-]{0,48}$/);
  assert.match(imageId, /^sha256:[a-f0-9]{64}$/);
  assert.ok(['bootstrap', 'verify'].includes(mode));
  assert.ok(dependencies.includes(`/.artifacts/native-nonadmin-fixtures/${runId}/workflow-schema-`));
  const output = `/.artifacts/native-nonadmin-fixtures/${runId}/platform-schema-${label}/`;
  assert.ok(classes.includes(output) && inputs.includes(output));
  for (const path of [dependencies, classes, inputs]) {
    assert.equal(path, resolve(path));
    assert.ok(!/[,\r\n\0]/.test(path));
  }
  return ['run', '--rm', '--interactive', '--pull=never',
    '--name', `nf-${runId}-platform-${label}-${mode}`, '--network', `nf-${runId}-private`,
    '--label', `aibiz.native-fixture.run=${runId}`, '--label', `aibiz.platform.bootstrap=${label}`,
    '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges', '--user', '65532:65532',
    '--tmpfs', '/tmp:rw,nosuid,nodev,size=268435456',
    '--mount', `type=bind,src=${dependencies},dst=/dependencies,readonly`,
    '--mount', `type=bind,src=${classes},dst=/classes,readonly`,
    '--mount', `type=bind,src=${inputs},dst=/inputs,readonly`,
    '--entrypoint', 'java', imageId, '-cp', '/classes:/dependencies/*', 'OwnedPlatformSchemaProbe'];
}

export function runPlatformHelper({ runId, label, stage, imageId, args, cidPath }, {
  docker, readCid, journal,
}) {
  platformIdentity(runId);
  assert.match(label, /^[a-z0-9][a-z0-9-]{0,48}$/);
  assert.ok(['compile', 'bootstrap', 'verify'].includes(stage));
  assert.match(imageId, /^sha256:[a-f0-9]{64}$/);
  const name = `nf-${runId}-platform-${label}-${stage}`;
  assert.equal(args[0], 'run');
  assert.equal(args[args.indexOf('--name') + 1], name);
  assert.equal(args.filter(value => value === '--name').length, 1);
  assert.ok(args.includes(imageId) && !args.includes('--cidfile'));
  assert.equal(cidPath, resolve(cidPath));
  assert.equal(basename(cidPath), `${stage}.cid`);
  assert.ok(cidPath.includes(`/.artifacts/native-nonadmin-fixtures/${runId}/platform-schema-${label}/`));
  assert.ok(!/[,\r\n\0:]/.test(cidPath));
  const entry = { stage, name, imageId, cidPath, token: randomBytes(18).toString('hex'),
    preAbsent: false, cidFileWasAbsent: false, attempted: false, containerId: null };
  journal.push(entry);
  const names = docker(['container', 'ls', '--all', '--format', '{{.Names}}']).stdout.trim().split('\n');
  assert.ok(!names.includes(name), 'An existing helper container cannot be adopted');
  entry.preAbsent = true;
  assert.equal(readCid(cidPath), null, 'Existing helper CID evidence cannot be overwritten');
  entry.cidFileWasAbsent = true;
  const command = [...args];
  command.splice(1, 0, '--cidfile', cidPath, '--label', `aibiz.platform.helper=${entry.token}`);
  entry.attempted = true;
  let result;
  try { result = docker(command, { allowFailure: true }); }
  finally {
    try {
      const cid = readCid(cidPath);
      if (cid !== null) {
        const id = cid.toString('utf8').trim();
        assert.match(id, /^[a-f0-9]{64}$/);
        entry.containerId = id;
      }
      entry.cidStatus = entry.containerId ? 'recorded' : 'missing';
    } catch { entry.cidStatus = 'unreadable-or-invalid'; }
  }
  if (result.status === 0 && !result.error && !result.signal) {
    assert.ok(entry.containerId, 'Successful helper execution requires its exact CID evidence');
  }
  return { result, command, entry };
}

export function cleanupPlatformHelpers({ runId, label, journal, errors }, { docker }) {
  for (const entry of [...journal].reverse()) {
    try {
      if (!entry.preAbsent || !entry.cidFileWasAbsent || !entry.attempted || !entry.containerId) {
        entry.cleanup = 'not-authorized-without-created-cid';
        continue;
      }
      assert.match(entry.containerId, /^[a-f0-9]{64}$/);
      assert.match(entry.token, /^[a-f0-9]{36}$/);
      assert.ok(['compile', 'bootstrap', 'verify'].includes(entry.stage));
      assert.equal(entry.name, `nf-${runId}-platform-${label}-${entry.stage}`);
      assert.match(entry.imageId, /^sha256:[a-f0-9]{64}$/);
      const current = docker(['container', 'inspect', entry.containerId], { allowFailure: true });
      if (current.status !== 0 || current.error || current.signal) {
        const listed = docker(['container', 'ls', '--all', '--no-trunc', '--format', '{{.ID}}']);
        assert.ok(listed.status === 0 && !listed.error && !listed.signal);
        const ids = listed.stdout.trim() ? listed.stdout.trim().split('\n') : [];
        assert.ok(ids.every(id => /^[a-f0-9]{64}$/.test(id)));
        assert.ok(!ids.includes(entry.containerId), 'Helper inspection failed; absence was not proven');
        entry.cleanup = 'already-removed';
        continue;
      }
      const rows = JSON.parse(current.stdout);
      assert.equal(rows.length, 1);
      const container = rows[0];
      assert.equal(container.Id, entry.containerId);
      assert.equal(container.Name, `/${entry.name}`);
      assert.equal(container.Config.Labels?.['aibiz.native-fixture.run'], runId);
      assert.equal(container.Config.Labels?.['aibiz.platform.bootstrap'], label);
      assert.equal(container.Config.Labels?.['aibiz.platform.helper'], entry.token);
      assert.equal(container.Image, entry.imageId);
      docker(['rm', '--force', entry.containerId]);
      entry.cleanup = 'removed-exact-created-id';
    } catch {
      entry.cleanup = 'refused-identity-or-inspection-drift';
      errors.push(`Exact platform helper cleanup refused at ${entry.stage}`);
    }
  }
}

export function createPlatformTargetGuard({
  workspace, runId, manifest, resources, manifestSha256, resourcesSha256, deploymentInput,
}, { mysqlGuard, openRuntime = ownedNativeRuntimeContext }) {
  platformIdentity(runId);
  assert.equal(typeof mysqlGuard, 'function');
  if (deploymentInput === undefined) {
    return { guard: mysqlGuard, close() {}, binding: { mode: 'mysql-only' } };
  }
  assert.equal(typeof deploymentInput, 'string');
  assert.ok(deploymentInput.length > 0);
  const path = resolve(workspace, deploymentInput);
  const base = join(resolve(workspace), '.artifacts/native-nonadmin-fixtures', runId);
  assert.equal(dirname(dirname(path)), base);
  assert.equal(basename(path), 'deployment-input.private.json');
  assert.match(basename(dirname(path)), /^backend-runtime-[a-z0-9][a-z0-9-]{0,48}$/);
  let runtime;
  try {
    runtime = openRuntime({ workspace, runId, deploymentInput: path });
    assert.equal(runtime.base, base);
    assert.deepEqual(runtime.manifest, manifest);
    assert.deepEqual(runtime.resources, resources);
    const expected = [
      [join(base, 'manifest.json'), manifestSha256],
      [join(base, 'owned-resources.json'), resourcesSha256],
    ];
    for (const [path, sha256] of expected) {
      assert.match(sha256, /^[a-f0-9]{64}$/);
      const current = runtime.bindings.filter(row => row.path === path);
      assert.equal(current.length, 1);
      assert.equal(current[0].sha256, sha256, 'Owned runtime inputs differ from this schema invocation');
    }
    const deployment = runtime.bindings.filter(row => row.path === path);
    assert.equal(deployment.length, 1);
    assert.match(deployment[0].sha256, /^[a-f0-9]{64}$/);
    assert.equal(runtime.deployment.runId, runId);
    assert.deepEqual(Object.keys(runtime.deployment.services).sort(), ['allinone', 'gateway', 'provider', 'uaa']);
    assert.deepEqual(runtime.deployment.auxiliaryContainers.map(row => row.role).sort(), ['nacos', 'redis', 'zookeeper']);
    const guard = () => {
      assert.deepEqual(runtime.manifest, manifest);
      assert.deepEqual(runtime.resources, resources);
      const topology = runtime.guard();
      assert.equal(topology.containers.length, 8, 'Exactly eight retained owned backend nodes are required');
      assert.equal(topology.network.Id, resources.networkId);
      return topology;
    };
    guard();
    return { guard, close: () => runtime.close(), binding: {
      mode: 'exact-owned-backend', deploymentInput: { ...deployment[0] }, backendNodes: 8,
    } };
  } catch (error) {
    runtime?.close();
    throw error;
  }
}

function ownedContext(workspace, runId, directories, { deploymentInput, registerTarget = () => {} } = {}) {
  const base = join(workspace, '.artifacts/native-nonadmin-fixtures', runId);
  const read = path => readPinnedFile(directories, directories.open(dirname(path)), basename(path)).data;
  const manifestBytes = read(join(base, 'manifest.json'));
  const manifest = JSON.parse(manifestBytes);
  fixtureUsers(manifest);
  assert.equal(manifest.runId, runId);
  const resourcesBytes = read(join(base, 'owned-resources.json'));
  const resources = JSON.parse(resourcesBytes);
  const docker = (args, { input, allowFailure = false } = {}) => {
    const result = spawnSync('docker', args, { input, encoding: 'utf8', timeout: 180000, maxBuffer: 16 * 1024 * 1024 });
    if (!allowFailure) assert.ok(result.status === 0 && !result.error && !result.signal,
      'Owned platform Docker operation failed; private output suppressed');
    return result;
  };
  const mysqlGuard = () => validateApplicationTarget(manifest, resources,
    JSON.parse(docker(['inspect', resources.mysqlId]).stdout)[0],
    JSON.parse(docker(['network', 'inspect', resources.networkId]).stdout)[0], inspectMysqlFixtureVolumes(resources));
  const target = createPlatformTargetGuard({ workspace, runId, manifest, resources,
    manifestSha256: hash(manifestBytes), resourcesSha256: hash(resourcesBytes), deploymentInput }, { mysqlGuard });
  registerTarget(target);
  const guard = target.guard;
  const sql = input => {
    guard();
    return docker(['exec', '-i', resources.mysqlId, 'sh', '-c',
      'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -h127.0.0.1 --protocol=TCP -uroot --batch --raw --skip-column-names'],
    { input }).stdout.trim();
  };
  const snapshot = table => {
    assert.ok(Object.hasOwn(projectionColumns, table));
    return sql(`SELECT JSON_ARRAY(${projectionColumns[table].map(column => `\`${column}\``).join(',')}) `
      + `FROM \`${manifest.schemas.uaa}\`.\`${table}\` WHERE ${projectionPredicate(manifest, table)} ORDER BY ID;`);
  };
  return { base, read, manifest, resources, docker, guard, sql, snapshot, target };
}

export function verifyPlatformResumeUaaReplacement({
  workspace, runId, manifest, resources, manifestBinding, resourcesBinding, previousTarget, currentTarget,
  replacement, replacementBinding, oldDeployment, newDeployment, oldDeploymentBinding, newDeploymentBinding,
}) {
  const base = join(resolve(workspace), '.artifacts/native-nonadmin-fixtures', runId);
  platformIdentity(runId);
  assert.equal(manifest.runId, runId);
  assert.equal(resources.runId, runId);
  assert.equal(resources.schemas.uaa, manifest.schemas.uaa);
  assert.match(resources.mysqlId, /^[a-f0-9]{64}$/);
  assert.match(resources.networkId, /^[a-f0-9]{64}$/);
  assert.equal(previousTarget.mode, 'exact-owned-backend');
  assert.equal(currentTarget.mode, 'exact-owned-backend');
  assert.equal(previousTarget.backendNodes, 8);
  assert.equal(currentTarget.backendNodes, 8);
  assert.deepEqual(oldDeploymentBinding, previousTarget.deploymentInput);
  assert.deepEqual(newDeploymentBinding, currentTarget.deploymentInput);
  assert.notEqual(oldDeploymentBinding.path, newDeploymentBinding.path);
  for (const binding of [oldDeploymentBinding, newDeploymentBinding]) {
    assert.equal(dirname(dirname(binding.path)), base);
    assert.match(basename(dirname(binding.path)), /^backend-runtime-[a-z0-9][a-z0-9-]{0,48}$/);
    assert.equal(basename(binding.path), 'deployment-input.private.json');
    assert.match(binding.sha256, /^[a-f0-9]{64}$/);
  }
  assert.equal(replacementBinding.path, join(dirname(newDeploymentBinding.path), 'report.json'));
  assert.match(replacementBinding.sha256, /^[a-f0-9]{64}$/);
  assert.equal(replacement.contract, 'owned-source-uaa-replacement-v1');
  assert.equal(replacement.runId, runId);
  assert.equal(replacement.status, 'passed-owned-uaa-security-and-replacement');
  assert.equal(replacement.protectedPeersUnchanged, true);
  for (const key of ['oldUaaStopped', 'oldUaaDetached', 'oldUaaRetainedForRollback']) assert.equal(replacement[key], true);
  for (const key of ['nativeAcceptance', 'permissionAcceptance', 'sharedServicesChanged']) assert.equal(replacement[key], false);
  assert.deepEqual(replacement.errors, []);
  assert.equal(replacement.rollback, null);
  const requiredInputs = [oldDeploymentBinding, manifestBinding, resourcesBinding];
  assert.equal(manifestBinding.path, join(base, 'manifest.json'));
  assert.equal(resourcesBinding.path, join(base, 'owned-resources.json'));
  for (const binding of requiredInputs) {
    const values = replacement.inputs.filter(row => row.path === binding.path);
    assert.equal(values.length, 1);
    assert.deepEqual(values[0], binding, 'Replacement must retain the original deployment, manifest and MySQL/resource bindings');
  }
  assert.deepEqual(replacement.deploymentInput, { path: newDeploymentBinding.path, sha256: newDeploymentBinding.sha256 });
  const expectedChecks = ['anonymous-user-info-self-denied', 'signed-security-positive-control',
    'tampered-signature-token-denied', 'expired-signed-token-denied',
    ...fixtureUsers(manifest).flatMap(user => [`${user.loginname}-wrong-password-denied`, `${user.loginname}-login-and-self`])];
  assert.equal(replacement.securityChecks.length, 16);
  assert.deepEqual(replacement.securityChecks.map(row => row.id).sort(), expectedChecks.sort());
  assert.ok(replacement.securityChecks.every(row => row.status === 'pass'));
  assert.equal(oldDeployment.runId, runId);
  assert.equal(newDeployment.runId, runId);
  assert.equal(replacement.oldUaa.id, oldDeployment.services.uaa.containerId);
  assert.equal(replacement.oldUaa.imageId, oldDeployment.services.uaa.imageId);
  assert.equal(replacement.newUaaId, newDeployment.services.uaa.containerId);
  assert.equal(replacement.runtime.imageId, newDeployment.services.uaa.imageId);
  assert.notEqual(replacement.newUaaId, replacement.oldUaa.id);
  assert.deepEqual(Object.keys(oldDeployment.services.uaa).sort(), ['containerId', 'imageId']);
  assert.deepEqual(Object.keys(newDeployment.services.uaa).sort(), ['containerId', 'imageId']);
  for (const deployment of [oldDeployment, newDeployment]) {
    assert.match(deployment.services.uaa.containerId, /^[a-f0-9]{64}$/);
    assert.match(deployment.services.uaa.imageId, /^sha256:[a-f0-9]{64}$/);
    assert.equal(deployment.endpoints.uaa.containerId, deployment.services.uaa.containerId);
    assert.match(deployment.endpoints.uaa.endpointId, /^[a-f0-9]{64}$/);
  }
  const oldRest = structuredClone(oldDeployment);
  const newRest = structuredClone(newDeployment);
  for (const deployment of [oldRest, newRest]) {
    delete deployment.services.uaa;
    delete deployment.endpoints.uaa.containerId;
    delete deployment.endpoints.uaa.endpointId;
  }
  assert.deepEqual(newRest, oldRest, 'Only the reviewed UAA service identity and its endpoint identity may change');
  return { replacementReport: replacementBinding, previousTarget, currentTarget,
    manifest: manifestBinding, resources: resourcesBinding };
}

function readPlatformResumeUaaReplacement({
  workspace, runId, manifest, resources, previousTarget, currentTarget, reportPath,
}, directories) {
  const bound = (path, privateInput = false) => {
    const file = readPinnedFile(directories, directories.open(dirname(path)), basename(path));
    if (privateInput) {
      assert.equal(file.identity.uid, process.geteuid());
      assert.equal(file.identity.mode & 0o077, 0);
    }
    return { data: file.data, binding: { path, sha256: hash(file.data), bytes: file.data.length } };
  };
  const base = join(workspace, '.artifacts/native-nonadmin-fixtures', runId);
  for (const path of [previousTarget.deploymentInput.path, currentTarget.deploymentInput.path]) {
    assert.equal(dirname(dirname(path)), base);
    assert.equal(basename(path), 'deployment-input.private.json');
    assert.match(basename(dirname(path)), /^backend-runtime-[a-z0-9][a-z0-9-]{0,48}$/);
  }
  const replacementPath = resolve(workspace, reportPath);
  assert.equal(replacementPath, join(dirname(currentTarget.deploymentInput.path), 'report.json'));
  const replacementFile = bound(replacementPath);
  const oldFile = bound(previousTarget.deploymentInput.path, true);
  const newFile = bound(currentTarget.deploymentInput.path, true);
  const manifestFile = bound(join(base, 'manifest.json'));
  const resourceFile = bound(join(base, 'owned-resources.json'), true);
  assert.deepEqual(JSON.parse(manifestFile.data), manifest);
  assert.deepEqual(JSON.parse(resourceFile.data), resources);
  const validation = { workspace, runId, manifest, resources, previousTarget, currentTarget,
    manifestBinding: manifestFile.binding, resourcesBinding: resourceFile.binding,
    replacement: JSON.parse(replacementFile.data), replacementBinding: replacementFile.binding,
    oldDeployment: JSON.parse(oldFile.data), newDeployment: JSON.parse(newFile.data),
    oldDeploymentBinding: oldFile.binding, newDeploymentBinding: newFile.binding };
  return { validation, binding: verifyPlatformResumeUaaReplacement(validation) };
}

export function verifyPlatformResumeReceipt({ report, runId, label, model, operatorSource, packageReceipt,
  workflowInput, ebsxInput, targetGuard, helperSource, dependencies, passwords, uaaReplacement }) {
  const identity = platformIdentity(runId);
  const projection = platformOperatorProjectionIdentity(runId);
  assert.equal(report.contract, contract);
  assert.equal(report.runId, runId);
  assert.notEqual(report.label, label, 'Resume requires a new output label');
  assert.equal(report.status, 'failed');
  assert.ok(report.errors.length > 0);
  assert.equal(report.createdSchema, true);
  assert.equal(report.droppedBootstrapUser, false);
  for (const key of ['platformSchemaVerified', 'sourceClosure', 'nativeAcceptance', 'permissionAcceptance',
    'operatorProjectionCreated']) assert.equal(report[key], false);
  assert.ok(report.verify === undefined && report.configuration === undefined);
  assert.deepEqual(report.operatorProjections ?? [], []);
  assert.deepEqual(report.identity, identity);
  assert.deepEqual(report.model, model);
  assert.deepEqual(report.operatorSource, operatorSource);
  assert.deepEqual(report.packageReceipt, packageReceipt);
  assert.deepEqual(report.workflowInput, workflowInput);
  assert.deepEqual(report.ebsxInput, ebsxInput);
  if (uaaReplacement === undefined) assert.deepEqual(report.targetGuard, targetGuard);
  else {
    const reviewed = verifyPlatformResumeUaaReplacement(uaaReplacement);
    assert.deepEqual(reviewed.previousTarget, report.targetGuard);
    assert.deepEqual(reviewed.currentTarget, targetGuard);
  }
  assert.deepEqual(report.helperSource, helperSource);
  assert.deepEqual(report.dependencies, dependencies);
  assert.deepEqual(report.commands.map(row => [row.stage, row.exitCode]), [['compile', 0], ['bootstrap', 0]]);
  assert.deepEqual(report.helperContainers.map(row => row.stage), ['compile', 'bootstrap']);
  for (const entry of report.helperContainers) {
    assert.equal(entry.name, `nf-${runId}-platform-${report.label}-${entry.stage}`);
    for (const key of ['preAbsent', 'cidFileWasAbsent', 'attempted']) assert.equal(entry[key], true);
    assert.match(entry.containerId, /^[a-f0-9]{64}$/);
    assert.match(entry.token, /^[a-f0-9]{36}$/);
    assert.equal(entry.imageId, report.image.id);
    assert.equal(entry.cidStatus, 'recorded');
    assert.ok(['already-removed', 'removed-exact-created-id'].includes(entry.cleanup));
  }
  verifyPlatformProbe(report.bootstrap, identity, 'bootstrap', model, null, operatorSource.sha256);
  const expectedUsers = [identity.bootstrapUser, identity.runtimeUser, projection.user].sort();
  assert.deepEqual(report.createdUsers.toSorted(), expectedUsers);
  assert.deepEqual(report.userJournal.map(row => row.user).sort(), expectedUsers);
  assert.deepEqual(Object.keys(passwords).sort(), ['bootstrap', 'projection', 'verify']);
  for (const entry of report.userJournal) {
    const mode = entry.user === projection.user ? 'projection' : entry.user === identity.bootstrapUser ? 'bootstrap' : 'verify';
    assert.equal(entry.created, true);
    assert.equal(entry.authenticationSha256, platformAuthenticationSha256(passwords[mode]));
    verifyPlatformUserOwnership(runId, entry, {
      user: entry.user, host: entry.host, plugin: 'mysql_native_password',
      authenticationSha256: entry.authenticationSha256, accountLocked: mode === 'projection' ? 'Y' : 'N',
    });
  }
}

export function verifyPlatformEmptySchema(model, { tables, columns, indices, counts, ancillary, changelogUnlocked }) {
  const physical = model.getAllPSSysDBTables.filter(row => row.getAllPSSysDBColumns);
  const expectedTables = physical.map(row => row.name).sort();
  assert.deepEqual(tables.map(row => row.name.toUpperCase()).sort(),
    [...expectedTables, 'DATABASECHANGELOG', 'DATABASECHANGELOGLOCK'].sort());
  assert.ok(tables.every(row => row.kind === 'BASE TABLE'), 'Resume may not adopt platform views');
  assert.deepEqual(ancillary, { triggers: 0, routines: 0, events: 0, foreignKeys: 0 });
  assert.equal(changelogUnlocked, true);
  assert.deepEqual(counts.map(row => row.table).sort(), expectedTables);
  assert.ok(counts.every(row => row.rows === 0), 'Every physical application table must be empty before resume');
  // Native DataTypes uses DATETIME=5 and INT=9; Liquibase overrides TEXT.MYSQL.
  const types = { 5: 'datetime', 9: 'int', 21: 'mediumtext', 25: 'varchar' };
  for (const table of physical) {
    const observed = columns.filter(row => row.table.toUpperCase() === table.name);
    const wanted = table.getAllPSSysDBColumns;
    assert.deepEqual(observed.map(row => row.name.toUpperCase()).sort(), wanted.map(row => row.name).sort());
    for (const column of wanted) {
      const actual = observed.find(row => row.name.toUpperCase() === column.name);
      assert.ok(Object.hasOwn(types, column.stdDataType));
      assert.equal(actual.type, types[column.stdDataType],
        `Resume column type differs: ${table.name}.${column.name} (stdDataType=${column.stdDataType})`);
      assert.equal(actual.nullable, column.pKey || column.nullable === false ? 'NO' : 'YES',
        `Resume column nullability differs: ${table.name}.${column.name}`);
      assert.equal(actual.primary, column.pKey === true,
        `Resume primary key differs: ${table.name}.${column.name}`);
      assert.equal(actual.extra, '');
      if (column.stdDataType === 25) assert.equal(actual.length, column.length);
    }
    const expectedIndices = [
      { name: 'PRIMARY', columns: ['ID'], nonUnique: 0 },
      ...(table.getAllPSSysDBIndices ?? []).map(index => {
        assert.equal(index.indexType, 'NORMAL');
        return { name: index.codeName.toUpperCase(),
          columns: index.getAllPSSysDBIndexColumns.map(row => row.name), nonUnique: 1 };
      }),
    ].sort((a, b) => a.name.localeCompare(b.name));
    const actualIndices = new Map();
    for (const row of indices.filter(row => row.table.toUpperCase() === table.name)) {
      const name = row.name.toUpperCase();
      assert.equal(row.prefix, null);
      assert.equal(row.type, 'BTREE');
      if (!actualIndices.has(name)) actualIndices.set(name, { name, columns: [], nonUnique: row.nonUnique });
      const index = actualIndices.get(name);
      assert.equal(row.nonUnique, index.nonUnique);
      assert.equal(row.position, index.columns.length + 1);
      index.columns.push(row.column.toUpperCase());
    }
    assert.deepEqual([...actualIndices.values()].sort((a, b) => a.name.localeCompare(b.name)), expectedIndices);
  }
  assert.ok(columns.every(row => expectedTables.includes(row.table.toUpperCase())
    || ['DATABASECHANGELOG', 'DATABASECHANGELOGLOCK'].includes(row.table.toUpperCase())));
  return { tables: expectedTables.length, applicationRows: 0,
    columns: columns.filter(row => expectedTables.includes(row.table.toUpperCase())).length,
    indices: physical.reduce((sum, row) => sum + (row.getAllPSSysDBIndices?.length ?? 0), 0),
    structuralSha256: hash(json({ tables, columns, indices, ancillary })), changelogUnlocked: true };
}

export function normalizePlatformSchemaRows(inventory) {
  assert.ok(Array.isArray(inventory.columns) && Array.isArray(inventory.counts));
  const columns = inventory.columns.map(row => {
    assert.equal(typeof row.table, 'string');
    assert.equal(typeof row.name, 'string');
    assert.ok(typeof row.primary === 'boolean' || row.primary === 0 || row.primary === 1,
      `Unsupported primary-key JSON value: ${row.table}.${row.name}`);
    return { ...row, primary: row.primary === true || row.primary === 1 };
  });
  const counts = inventory.counts.map(row => {
    assert.equal(typeof row.table, 'string');
    assert.ok(Number.isSafeInteger(row.rows) && row.rows >= 0,
      `Unsupported row-count JSON value: ${row.table}`);
    return { ...row };
  });
  return { ...inventory, columns, counts };
}

function inspectEmptyPlatformSchema(identity, model, sql) {
  const rows = statement => {
    const value = sql(statement);
    return value ? value.split('\n').map(row => JSON.parse(row)) : [];
  };
  return verifyPlatformEmptySchema(model, normalizePlatformSchemaRows({
    tables: rows(`SELECT JSON_OBJECT('name',TABLE_NAME,'kind',TABLE_TYPE) FROM information_schema.tables`
      + ` WHERE table_schema='${identity.schema}' ORDER BY TABLE_NAME;`),
    columns: rows(`SELECT JSON_OBJECT('table',TABLE_NAME,'name',COLUMN_NAME,'type',DATA_TYPE,`
      + `'nullable',IS_NULLABLE,'primary',COLUMN_KEY='PRI','length',CHARACTER_MAXIMUM_LENGTH,'extra',EXTRA)`
      + ` FROM information_schema.columns WHERE table_schema='${identity.schema}' ORDER BY TABLE_NAME,ORDINAL_POSITION;`),
    indices: rows(`SELECT JSON_OBJECT('table',TABLE_NAME,'name',INDEX_NAME,'column',COLUMN_NAME,`
      + `'position',SEQ_IN_INDEX,'nonUnique',NON_UNIQUE,'prefix',SUB_PART,'type',INDEX_TYPE)`
      + ` FROM information_schema.statistics WHERE table_schema='${identity.schema}' ORDER BY TABLE_NAME,INDEX_NAME,SEQ_IN_INDEX;`),
    counts: rows(model.getAllPSSysDBTables.filter(row => row.getAllPSSysDBColumns).map(table =>
      `SELECT JSON_OBJECT('table','${table.name}','rows',COUNT(*)) FROM \`${identity.schema}\`.\`${table.name.toLowerCase()}\``).join(' UNION ALL ') + ';'),
    ancillary: JSON.parse(sql(`SELECT JSON_OBJECT('triggers',(SELECT COUNT(*) FROM information_schema.triggers WHERE trigger_schema='${identity.schema}'),`
      + `'routines',(SELECT COUNT(*) FROM information_schema.routines WHERE routine_schema='${identity.schema}'),`
      + `'events',(SELECT COUNT(*) FROM information_schema.events WHERE event_schema='${identity.schema}'),`
      + `'foreignKeys',(SELECT COUNT(*) FROM information_schema.table_constraints WHERE constraint_schema='${identity.schema}' AND constraint_type='FOREIGN KEY'));`)),
    changelogUnlocked: sql(`SELECT COUNT(*) FROM \`${identity.schema}\`.databasechangeloglock WHERE ID=1 AND LOCKED=0;`) === '1'
      && sql(`SELECT COUNT(*) FROM \`${identity.schema}\`.databasechangeloglock;`) === '1',
  }));
}

export async function bootstrapOwnedPlatform(options) {
  const directories = new PinnedDirectories();
  const targets = [];
  try { return await prepareOwnedPlatform(options, directories, target => targets.push(target)); }
  finally {
    try { for (const target of targets.reverse()) target.close(); }
    finally { directories.close(); }
  }
}

async function prepareOwnedPlatform({
  workspace = workspaceDefault, runId, label, workflowReportPath, ebsxReportPath, deploymentInput,
  resumeFailedReport, resumeFailedReportSha256, resumeUaaReplacementReport,
}, directories, registerTarget) {
  const identity = platformIdentity(runId);
  assert.match(label ?? '', /^[a-z0-9][a-z0-9-]{0,48}$/);
  assert.equal(resumeFailedReport !== undefined, resumeFailedReportSha256 !== undefined,
    'Resume requires both failed report path and its explicit SHA-256');
  if (resumeFailedReportSha256 !== undefined) assert.match(resumeFailedReportSha256, /^[a-f0-9]{64}$/);
  if (resumeUaaReplacementReport !== undefined) assert.ok(resumeFailedReport !== undefined,
    'A reviewed UAA replacement may only accompany an explicitly pinned failed platform receipt');
  workspace = resolve(workspace);
  const context = ownedContext(workspace, runId, directories, { deploymentInput, registerTarget });
  const { base, read, manifest, docker, guard, sql, snapshot } = context;
  const output = join(base, `platform-schema-${label}`);
  const destination = directories.open(output, { create: true, exclusive: true });
  const write = (name, value) => directories.write(destination, name, value);
  const report = {
    schemaVersion: 1, contract, runId, label, identity, status: 'failed', errors: [], commands: [], helperContainers: [],
    createdUsers: [], userJournal: [], createdSchema: false, droppedBootstrapUser: false, operatorProjectionCreated: false,
    platformSchemaVerified: false, sourceClosure: false, nativeAcceptance: false, permissionAcceptance: false,
    startedAt: new Date().toISOString(),
    generator: { path: toolFile, sha256: hash(read(join(workspace, toolFile))) },
    helperSource: { path: sourceFile, sha256: hash(read(join(workspace, sourceFile))) },
    targetGuard: context.target.binding,
    limitations: [
      'Model-derived isolated extension schema and redacted operator read projection only; no route/browser/security acceptance.',
      'Two columnless autoExtendModel entries are skipped by the native adapter, not replaced with empty tables.',
      'The locked definer sees only reviewed source columns. USER_PASSWORD is always SQL NULL and has no source column grant.',
      'Views expose only the six manifest people and their tenant-scoped organization/department rows; HTTP tenant authorization remains required.',
      'Missing EMPLOYEE_NUMBER is reported as operatorValuesReady=false; source data is never invented or updated.',
      'Original upstream authenticity and complete source/dependency/license closure remain unverified.',
    ],
  };
  const passwords = Object.fromEntries(['bootstrap', 'verify', 'projection'].map(key => [key, randomBytes(18).toString('hex')]));
  const executeHelper = (stage, args, imageId) => {
    guard();
    const result = runPlatformHelper({
      runId, label, stage, imageId, args, cidPath: join(output, `${stage}.cid`),
    }, { docker, journal: report.helperContainers, readCid: path => {
      try { return read(path); }
      catch (error) { if (error.code === 'ENOENT') return null; throw error; }
    } });
    guard();
    return result;
  };
  try {
    guard();
    const workflowPath = resolve(workspace, workflowReportPath);
    const workflow = JSON.parse(read(workflowPath));
    const verified = verifyBackendSourcePackage({ workspace, reportPath: workflow.packageReceipt.path });
    report.packageReceipt = { path: verified.reportPath, sha256: verified.reportSha256 };
    report.workflowInput = readOwnedWorkflowConfiguration({ workspace, runId, reportPath: workflowPath,
      packageReceipt: report.packageReceipt }).binding;
    const ebsx = readOwnedEbsxConfiguration({ workspace, runId,
      reportPath: resolve(workspace, ebsxReportPath), packageReceipt: report.packageReceipt });
    report.ebsxInput = ebsx.binding;
    const dependencies = join(dirname(workflowPath), 'dependencies');
    report.dependencies = { path: relative(workspace, dependencies), ...sourceBuildInputs(dependencies) };
    const image = JSON.parse(docker(['image', 'inspect', workflow.image.reference]).stdout)[0];
    assert.equal(image.Id, workflow.image.id);
    report.image = workflow.image;
    const modelBytes = read(join(verified.report.worktree, modelFile));
    const physicalModel = JSON.parse(modelBytes);
    report.model = { ...verifyPlatformModel(physicalModel), path: modelFile, sha256: hash(modelBytes) };
    const operatorBytes = read(join(verified.report.worktree, operatorFile));
    report.operatorSource = { path: operatorFile, sha256: verifyPlatformOperatorSource(operatorBytes) };
    const archive = verified.report.packages.archives.find(row => row.path === 'ibiz-ebsx-runtime/ibiz-ebsx-allinone-rt.jar');
    assert.equal(archive?.entries.find(row => row.path === `BOOT-INF/classes/${queryResource}`)?.sha256,
      report.operatorSource.sha256, 'Operator source must be the exact packaged runtime query');
    let resume;
    if (resumeFailedReport !== undefined) {
      const path = resolve(workspace, resumeFailedReport);
      assert.equal(dirname(dirname(path)), base);
      assert.equal(basename(path), 'report.json');
      assert.match(basename(dirname(path)), /^platform-schema-[a-z0-9][a-z0-9-]{0,48}$/);
      assert.notEqual(dirname(path), output);
      const bytes = read(path);
      assert.equal(hash(bytes), resumeFailedReportSha256);
      const previous = JSON.parse(bytes);
      assert.equal(basename(dirname(path)), `platform-schema-${previous.label}`);
      const credential = readPinnedFile(directories, directories.open(dirname(path)), 'credentials.private.json');
      assert.equal(credential.identity.uid, process.geteuid());
      assert.equal(credential.identity.mode & 0o077, 0);
      const secrets = JSON.parse(credential.data).passwords;
      const replacement = resumeUaaReplacementReport === undefined ? undefined
        : readPlatformResumeUaaReplacement({ workspace, runId, manifest, resources: context.resources,
          previousTarget: previous.targetGuard, currentTarget: report.targetGuard,
          reportPath: resumeUaaReplacementReport }, directories);
      verifyPlatformResumeReceipt({ report: previous, runId, label, model: report.model,
        operatorSource: report.operatorSource, packageReceipt: report.packageReceipt,
        workflowInput: report.workflowInput, ebsxInput: report.ebsxInput, targetGuard: report.targetGuard,
        helperSource: report.helperSource, dependencies: report.dependencies, passwords: secrets,
        uaaReplacement: replacement?.validation });
      assert.equal(previous.image.id, image.Id);
      assert.equal(hash(read(join(dirname(path), 'helper-source/OwnedPlatformSchemaProbe.java'))), report.helperSource.sha256);
      assert.deepEqual(sourceBuildInputs(join(dirname(path), 'helper-classes')), previous.helperClasses);
      assert.deepEqual(sourceBuildInputs(join(dirname(path), 'probe-inputs')), previous.probeInputs);
      assert.equal(hash(read(join(dirname(path), 'probe-inputs/employee-default.json'))), report.operatorSource.sha256);
      for (const entry of previous.helperContainers) {
        assert.equal(entry.cidPath, join(dirname(path), `${entry.stage}.cid`));
        assert.equal(read(entry.cidPath).toString('utf8').trim(), entry.containerId);
      }
      resume = previous;
      Object.assign(passwords, secrets);
      report.resumeInput = { path: relative(workspace, path), sha256: hash(bytes),
        previousGenerator: previous.generator, credentialsSha256: hash(credential.data),
        ...(replacement ? { uaaReplacement: replacement.binding } : {}) };
    }
    const helper = directories.open(join(output, 'helper-source'), { create: true, exclusive: true });
    directories.write(helper, 'OwnedPlatformSchemaProbe.java', read(join(workspace, sourceFile)));
    const inputs = directories.open(join(output, 'probe-inputs'), { create: true, exclusive: true });
    directories.write(inputs, 'employee-default.json', operatorBytes);
    fs.chmodSync(inputs.path, 0o755);
    fs.chmodSync(join(inputs.path, 'employee-default.json'), 0o644);
    report.probeInputs = sourceBuildInputs(inputs.path);
    const classes = directories.open(join(output, 'helper-classes'), { create: true, exclusive: true });
    const compileName = `nf-${runId}-platform-${label}-compile`;
    const compile = ['run', '--rm', '--pull=never', '--name', compileName, '--network=none',
      '--label', `aibiz.native-fixture.run=${runId}`, '--label', `aibiz.platform.bootstrap=${label}`,
      '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges',
      '--user', `${process.geteuid()}:${process.getegid()}`, '--tmpfs', '/tmp:rw,nosuid,nodev,size=268435456',
      '--mount', `type=bind,src=${dependencies},dst=/dependencies,readonly`,
      '--mount', `type=bind,src=${helper.path},dst=/source,readonly`,
      '--mount', `type=bind,src=${classes.path},dst=/output`,
      '--entrypoint', 'javac', image.Id, '--release', '8', '-proc:none', '-implicit:none',
      '-sourcepath', '', '-cp', '/dependencies/*', '-d', '/output', '/source/OwnedPlatformSchemaProbe.java'];
    const compilation = executeHelper('compile', compile, image.Id);
    const compiled = compilation.result;
    write('compile.private.log', `${compiled.stdout ?? ''}${compiled.stderr ?? ''}`);
    report.commands.push({ stage: 'compile', args: compilation.command, exitCode: compiled.status });
    assert.ok(compiled.status === 0 && !compiled.error && !compiled.signal, 'Platform helper compilation failed');
    fs.chmodSync(classes.path, 0o755);
    for (const name of fs.readdirSync(classes.path)) fs.chmodSync(join(classes.path, name), 0o644);
    report.helperClasses = sourceBuildInputs(classes.path);
    const projection = platformOperatorProjectionIdentity(runId);
    assert.equal(sql(`SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name='${identity.schema}';`), resume ? '1' : '0');
    assert.equal(sql(`SELECT COUNT(*) FROM mysql.user WHERE User IN ('${identity.bootstrapUser}','${identity.runtimeUser}','${projection.user}');`), resume ? '3' : '0');
    if (resume) {
      for (const entry of resume.userJournal) {
        const actual = JSON.parse(sql(`SELECT JSON_OBJECT('user',User,'host',Host,'plugin',plugin,`
          + `'authenticationSha256',SHA2(authentication_string,256),'accountLocked',account_locked)`
          + ` FROM mysql.user WHERE User='${entry.user}' AND Host='${entry.host}';`));
        verifyPlatformUserOwnership(runId, entry, actual);
        assert.equal(sql(`SELECT COUNT(*) FROM information_schema.PROCESSLIST WHERE USER='${entry.user}';`), '0',
          'Resume may not adopt an actively used platform principal');
        const grants = sql(`SHOW GRANTS FOR '${entry.user}'@'${entry.host}';`);
        if (entry.user === projection.user) verifyPlatformOperatorProjectionGrants(runId, grants);
        else {
          const mode = entry.user === identity.bootstrapUser ? 'bootstrap' : 'verify';
          verifyPlatformGrants(identity, mode, grants);
          assert.equal(hash(grants), resume[`${mode}Grants`].sha256);
        }
      }
      assert.equal(sql(`SELECT COUNT(*) FROM information_schema.views WHERE DEFINER='${projection.user}@${projection.host}';`), '0',
        'Resume requires the failed definer to have no existing views in any schema');
      report.resumeInput.emptySchema = inspectEmptyPlatformSchema(identity, physicalModel, sql);
    }
    for (const table of projection.tables) {
      assert.equal(sql(`SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${projection.targetSchema}' AND table_name='${table}';`), '0');
      const actualColumns = sql(`SELECT COLUMN_NAME FROM information_schema.columns WHERE table_schema='${projection.sourceSchema}' AND table_name='${table}';`)
        .split('\n').map(column => column.toUpperCase());
      assert.ok(projectionColumns[table].every(column => actualColumns.includes(column)), 'UAA source projection column missing');
    }
    const before = Object.fromEntries(projection.tables.map(table => [table, snapshot(table)]));
    assert.equal(before.sys_person.split('\n').length, 6, 'Require actual six source UAA people');
    assert.deepEqual(before.sys_person.split('\n').map(row => JSON.parse(row).slice(0, 3)),
      fixtureUsers(manifest).map(user => [user.personId, user.loginname, user.centerId]));
    assert.equal(before.sys_organization.split('\n').length, 2, 'Require actual two tenant organizations');
    write('credentials.private.json', json({ passwords }));
    if (!resume) sql(`CREATE DATABASE \`${identity.schema}\` CHARACTER SET utf8mb4;`);
    report.createdSchema = true;
    if (resume) {
      report.createdUsers = [...resume.createdUsers];
      report.userJournal = structuredClone(resume.userJournal);
    }
    const createUser = (user, host, password, accountLocked) => {
      assert.equal(sql(`SELECT COUNT(*) FROM mysql.user WHERE User='${user}' AND Host='${host}';`), '0',
        'Existing SQL principal cannot be adopted');
      const entry = { user, host, preAbsent: true, creationAttempted: true, created: false,
        authenticationSha256: platformAuthenticationSha256(password) };
      report.userJournal.push(entry);
      sql(`CREATE USER '${user}'@'${host}' IDENTIFIED WITH mysql_native_password BY '${password}'${accountLocked ? ' ACCOUNT LOCK' : ''};`);
      entry.created = true;
      report.createdUsers.push(user);
    };
    for (const mode of ['bootstrap', 'verify']) {
      const user = mode === 'bootstrap' ? identity.bootstrapUser : identity.runtimeUser;
      if (!resume) {
        createUser(user, '%', passwords[mode], false);
        sql(platformGrantSQL(identity, mode));
      }
      const grants = sql(`SHOW GRANTS FOR '${user}'@'%';`);
      verifyPlatformGrants(identity, mode, grants);
      report[`${mode}Grants`] = { sha256: hash(grants) };
    }
    for (const mode of ['bootstrap', 'verify']) {
      if (mode === 'verify') {
        if (!resume) {
          createUser(projection.user, projection.host, passwords.projection, true);
          for (const grant of platformOperatorProjectionGrantSQL(runId)) sql(grant);
        }
        const grants = sql(`SHOW GRANTS FOR '${projection.user}'@'${projection.host}';`);
        verifyPlatformOperatorProjectionGrants(runId, grants);
        report.operatorProjectionGrants = { sha256: hash(grants) };
        report.operatorProjections = [];
        const markers = Object.fromEntries(projection.tables.map(table => [table, randomBytes(18).toString('hex')]));
        for (const [index, view] of platformOperatorProjectionViewSQL(manifest, markers).entries()) {
          const table = projection.tables[index];
          assert.equal(sql(`SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${projection.targetSchema}' AND table_name='${table}';`), '0',
            'Existing projection cannot be adopted');
          const projectionRow = {
            table, columns: [...projectionColumns[table], ...(table === 'sys_person' ? ['USER_PASSWORD'] : [])],
            sourceRowsSha256: hash(before[table]), sourceRows: before[table] ? before[table].split('\n').length : 0,
            preAbsent: true, creationAttempted: true, created: false, ownershipMarker: markers[table],
            createSqlSha256: hash(view), viewDefinitionSha256: null, readOnly: false,
          };
          report.operatorProjections.push(projectionRow);
          sql(view);
          projectionRow.created = true;
          projectionRow.viewDefinitionSha256 = hash(sql(`SHOW CREATE VIEW \`${projection.targetSchema}\`.\`${table}\`;`));
          assert.equal(sql(`SELECT COUNT(*) FROM information_schema.views WHERE table_schema='${projection.targetSchema}' AND table_name='${table}' AND IS_UPDATABLE='NO' AND SECURITY_TYPE='DEFINER' AND DEFINER='${projection.user}@${projection.host}';`), '1');
          const observed = sql(`SELECT JSON_ARRAY(${projectionColumns[table].map(column => `\`${column}\``).join(',')}) FROM \`${projection.targetSchema}\`.\`${table}\` ORDER BY ID;`);
          assert.equal(observed, before[table]);
          projectionRow.readOnly = true;
        }
        assert.equal(sql(`SELECT account_locked FROM mysql.user WHERE User='${projection.user}' AND Host='${projection.host}';`), 'Y');
        report.operatorProjectionCreated = true;
      }
      const command = platformProbeCommand({ runId, label, imageId: image.Id, dependencies,
        classes: classes.path, inputs: inputs.path, mode });
      const input = json({
        runId, mode, url: identity.url, username: mode === 'bootstrap' ? identity.bootstrapUser : identity.runtimeUser,
        password: passwords[mode], projectionUrl: ebsx.configuration.url,
        projectionUsername: ebsx.configuration.username, projectionPassword: ebsx.configuration.password,
      });
      guard();
      const execution = runPlatformHelper({
        runId, label, stage: mode, imageId: image.Id, args: command, cidPath: join(output, `${mode}.cid`),
      }, { docker: (args, options) => docker(args, args[0] === 'run' ? { ...options, input } : options),
        journal: report.helperContainers, readCid: path => {
          try { return read(path); }
          catch (error) { if (error.code === 'ENOENT') return null; throw error; }
        } });
      guard();
      const result = execution.result;
      write(`${mode}.private.log`, `${result.stderr ?? ''}\n${result.stdout ?? ''}`);
      report.commands.push({ stage: mode, args: execution.command, exitCode: result.status });
      assert.ok(result.status === 0 && !result.error && !result.signal, `Platform ${mode} failed; see private log`);
      const row = JSON.parse(result.stdout);
      verifyPlatformProbe(row, identity, mode, report.model, manifest, report.operatorSource.sha256);
      report[mode] = row;
    }
    for (const table of projection.tables) assert.equal(hash(snapshot(table)), hash(before[table]), 'Source UAA rows changed');
    report.operatorProjection = { identity: projection, readOnly: true, accountLocked: true,
      sourceRowsUnchanged: true, passwordMasked: true, columns: projectionColumns };
    sql(`DROP USER '${identity.bootstrapUser}'@'%';`);
    report.droppedBootstrapUser = true;
    const configuration = json({
      url: identity.url, username: identity.runtimeUser, password: passwords.verify, schema: identity.schema,
      schemaUpdate: false, deploySystemId: 'extension',
      runtimeClassName: 'net.ibizsys.central.cloud.saas.extension.runtime.SystemRuntime',
      logicalDatasources: ['DEFAULT'], operatorValuesReady: report.verify.operatorValuesReady,
    });
    write('configuration.private.json', configuration);
    report.configuration = { path: relative(workspace, join(output, 'configuration.private.json')),
      bytes: Buffer.byteLength(configuration), sha256: hash(configuration) };
    report.platformSchemaVerified = true;
    report.status = 'passed-owned-native-platform-schema-only';
  } catch (error) { report.errors.push(error.message); }
  finally {
    cleanupPlatformHelpers({ runId, label, journal: report.helperContainers, errors: report.errors }, { docker });
    try {
      guard();
      assert.equal(hash(read(join(workspace, toolFile))), report.generator.sha256);
      assert.equal(hash(read(join(workspace, sourceFile))), report.helperSource.sha256);
      if (report.dependencies) {
        const { path, ...inventory } = report.dependencies;
        assert.deepEqual(sourceBuildInputs(join(workspace, path)), inventory);
      }
    } catch { report.errors.push('Owned platform inputs or target changed'); }
    if (report.errors.length) { report.status = 'failed'; report.platformSchemaVerified = false; }
    report.finishedAt = new Date().toISOString();
    write('report.json', json(report));
  }
  return { report, reportPath: join(output, 'report.json') };
}

function verifyOperatorProjectionReport(runId, report) {
  assert.deepEqual(report.operatorProjection, {
    identity: platformOperatorProjectionIdentity(runId), readOnly: true, accountLocked: true,
    sourceRowsUnchanged: true, passwordMasked: true, columns: projectionColumns,
  });
  assert.match(report.operatorProjectionGrants.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(report.operatorProjections.map(row => row.table), Object.keys(projectionColumns));
  for (const row of report.operatorProjections) {
    assert.equal(row.readOnly, true);
    assert.equal(row.preAbsent, true);
    assert.equal(row.creationAttempted, true);
    assert.equal(row.created, true);
    assert.match(row.ownershipMarker, /^[a-f0-9]{36}$/);
    assert.match(row.createSqlSha256, /^[a-f0-9]{64}$/);
    assert.deepEqual(row.columns, [...projectionColumns[row.table],
      ...(row.table === 'sys_person' ? ['USER_PASSWORD'] : [])]);
    assert.match(row.sourceRowsSha256, /^[a-f0-9]{64}$/);
    assert.match(row.viewDefinitionSha256, /^[a-f0-9]{64}$/);
    assert.ok(Number.isSafeInteger(row.sourceRows) && row.sourceRows >= 0);
  }
  assert.equal(report.operatorProjections[0].sourceRows, 6);
  assert.equal(report.operatorProjections[1].sourceRows, 2);
}

export function readOwnedPlatformConfiguration({ workspace = workspaceDefault, runId, reportPath, packageReceipt }) {
  const identity = platformIdentity(runId);
  workspace = resolve(workspace);
  const path = resolve(workspace, reportPath);
  assert.equal(dirname(dirname(path)), join(workspace, '.artifacts/native-nonadmin-fixtures', runId));
  assert.equal(basename(path), 'report.json');
  assert.match(basename(dirname(path)), /^platform-schema-[a-z0-9][a-z0-9-]{0,48}$/);
  const directories = new PinnedDirectories();
  const read = p => readPinnedFile(directories, directories.open(dirname(p)), basename(p));
  try {
    const bytes = read(path).data;
    const report = JSON.parse(bytes);
    assert.equal(report.contract, contract);
    assert.equal(report.runId, runId);
    assert.deepEqual(report.identity, identity);
    assert.equal(report.status, 'passed-owned-native-platform-schema-only');
    for (const key of ['platformSchemaVerified', 'droppedBootstrapUser', 'operatorProjectionCreated']) assert.equal(report[key], true);
    for (const key of ['sourceClosure', 'nativeAcceptance', 'permissionAcceptance']) assert.equal(report[key], false);
    assert.deepEqual(report.errors, []);
    assert.deepEqual(report.helperContainers.map(row => row.stage), ['compile', 'bootstrap', 'verify']);
    for (const entry of report.helperContainers) {
      assert.equal(entry.name, `nf-${runId}-platform-${report.label}-${entry.stage}`);
      assert.equal(entry.cidPath, join(dirname(path), `${entry.stage}.cid`));
      for (const key of ['preAbsent', 'cidFileWasAbsent', 'attempted']) assert.equal(entry[key], true);
      assert.match(entry.token, /^[a-f0-9]{36}$/);
      assert.match(entry.containerId, /^[a-f0-9]{64}$/);
      assert.equal(entry.imageId, report.image.id);
      assert.equal(entry.cidStatus, 'recorded');
      assert.ok(['already-removed', 'removed-exact-created-id'].includes(entry.cleanup));
      assert.equal(read(entry.cidPath).data.toString('utf8').trim(), entry.containerId);
    }
    assert.deepEqual(report.createdUsers.toSorted(), [
      identity.bootstrapUser, identity.runtimeUser, platformOperatorProjectionIdentity(runId).user,
    ].sort());
    assert.deepEqual(report.userJournal.map(row => row.user).sort(), report.createdUsers.toSorted());
    for (const entry of report.userJournal) {
      assert.equal(entry.preAbsent, true);
      assert.equal(entry.creationAttempted, true);
      assert.equal(entry.created, true);
      verifyPlatformUserOwnership(runId, entry, {
        user: entry.user, host: entry.host, plugin: 'mysql_native_password',
        authenticationSha256: entry.authenticationSha256,
        accountLocked: entry.user === platformOperatorProjectionIdentity(runId).user ? 'Y' : 'N',
      });
    }
    assert.deepEqual(report.packageReceipt, { path: packageReceipt.path, sha256: packageReceipt.sha256 });
    assert.deepEqual(report.generator, { path: toolFile, sha256: hash(read(join(workspace, toolFile)).data) });
    assert.deepEqual(report.helperSource, { path: sourceFile, sha256: hash(read(join(workspace, sourceFile)).data) });
    assert.deepEqual(report.workflowInput, readOwnedWorkflowConfiguration({ workspace, runId,
      reportPath: resolve(workspace, report.workflowInput.reportPath), packageReceipt }).binding);
    assert.deepEqual(report.ebsxInput, readOwnedEbsxConfiguration({ workspace, runId,
      reportPath: resolve(workspace, report.ebsxInput.reportPath), packageReceipt }).binding);
    const packageBytes = read(packageReceipt.path).data;
    assert.equal(hash(packageBytes), packageReceipt.sha256);
    const packageReport = JSON.parse(packageBytes);
    const modelBytes = read(join(packageReport.worktree, modelFile)).data;
    assert.deepEqual(report.model, { ...verifyPlatformModel(JSON.parse(modelBytes)), path: modelFile, sha256: hash(modelBytes) });
    const operatorBytes = read(join(packageReport.worktree, operatorFile)).data;
    assert.deepEqual(report.operatorSource, { path: operatorFile, sha256: verifyPlatformOperatorSource(operatorBytes) });
    if (report.resumeInput) {
      const previousPath = resolve(workspace, report.resumeInput.path);
      assert.equal(dirname(dirname(previousPath)), dirname(dirname(path)));
      assert.equal(basename(previousPath), 'report.json');
      assert.notEqual(dirname(previousPath), dirname(path));
      const previousBytes = read(previousPath).data;
      assert.equal(hash(previousBytes), report.resumeInput.sha256);
      const previous = JSON.parse(previousBytes);
      assert.equal(basename(dirname(previousPath)), `platform-schema-${previous.label}`);
      assert.deepEqual(previous.generator, report.resumeInput.previousGenerator);
      const credential = read(join(dirname(previousPath), 'credentials.private.json'));
      assert.equal(credential.identity.mode & 0o077, 0);
      assert.equal(credential.identity.uid, process.geteuid());
      assert.equal(hash(credential.data), report.resumeInput.credentialsSha256);
      const replacement = report.resumeInput.uaaReplacement === undefined ? undefined
        : readPlatformResumeUaaReplacement({ workspace, runId,
          manifest: JSON.parse(read(join(dirname(dirname(path)), 'manifest.json')).data),
          resources: JSON.parse(read(join(dirname(dirname(path)), 'owned-resources.json')).data),
          previousTarget: previous.targetGuard, currentTarget: report.targetGuard,
          reportPath: report.resumeInput.uaaReplacement.replacementReport.path }, directories);
      if (replacement) assert.deepEqual(report.resumeInput.uaaReplacement, replacement.binding);
      verifyPlatformResumeReceipt({ report: previous, runId, label: report.label, model: report.model,
        operatorSource: report.operatorSource, packageReceipt: report.packageReceipt,
        workflowInput: report.workflowInput, ebsxInput: report.ebsxInput, targetGuard: report.targetGuard,
        helperSource: report.helperSource, dependencies: report.dependencies,
        passwords: JSON.parse(credential.data).passwords, uaaReplacement: replacement?.validation });
      assert.equal(report.resumeInput.emptySchema.tables, 32);
      assert.equal(report.resumeInput.emptySchema.columns, report.bootstrap.columnsVerified);
      assert.equal(report.resumeInput.emptySchema.indices, report.bootstrap.indicesVerified);
      assert.equal(report.resumeInput.emptySchema.applicationRows, 0);
      assert.equal(report.resumeInput.emptySchema.changelogUnlocked, true);
      assert.match(report.resumeInput.emptySchema.structuralSha256, /^[a-f0-9]{64}$/);
    }
    const manifest = JSON.parse(read(join(dirname(dirname(path)), 'manifest.json')).data);
    verifyPlatformProbe(report.bootstrap, identity, 'bootstrap', report.model, manifest, report.operatorSource.sha256);
    verifyPlatformProbe(report.verify, identity, 'verify', report.model, manifest, report.operatorSource.sha256);
    verifyOperatorProjectionReport(runId, report);
    const { path: dependencyPath, ...inventory } = report.dependencies;
    assert.deepEqual(sourceBuildInputs(join(workspace, dependencyPath)), inventory);
    assert.deepEqual(sourceBuildInputs(join(dirname(path), 'helper-classes')), report.helperClasses);
    assert.deepEqual(sourceBuildInputs(join(dirname(path), 'probe-inputs')), report.probeInputs);
    assert.equal(hash(read(join(dirname(path), 'probe-inputs/employee-default.json')).data), report.operatorSource.sha256);
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
    assert.equal(configuration.deploySystemId, 'extension');
    assert.equal(configuration.runtimeClassName, 'net.ibizsys.central.cloud.saas.extension.runtime.SystemRuntime');
    assert.equal(configuration.operatorValuesReady, report.verify.operatorValuesReady);
    assert.deepEqual(configuration.logicalDatasources, ['DEFAULT']);
    assert.match(configuration.password, /^[a-f0-9]{36}$/);
    assert.equal(report.userJournal.find(row => row.user === identity.runtimeUser).authenticationSha256,
      platformAuthenticationSha256(configuration.password));
    return { configuration, binding: { reportPath: relative(workspace, path),
      reportSha256: hash(bytes), configurationSha256: hash(input.data) } };
  } finally { directories.close(); }
}

export function cleanupPlatformSqlResources({ runId, receipt }, { sql }) {
  const identity = platformIdentity(runId);
  const projection = platformOperatorProjectionIdentity(runId);
  const report = { contract: 'run-owned-platform-account-cleanup-v1', runId, status: 'running',
    removed: [], droppedOperatorProjections: [], schemaRetainedUntilOwnedMysqlCleanup: true, nativeAcceptance: false };
  try {
    assert.equal(receipt.contract, contract);
    assert.equal(receipt.runId, runId);
    assert.deepEqual(receipt.identity, identity);
    assert.ok(Array.isArray(receipt.userJournal) && receipt.userJournal.length <= 3);
    assert.equal(new Set(receipt.userJournal.map(row => row.user)).size, receipt.userJournal.length);
    assert.ok(Array.isArray(receipt.operatorProjections ?? []));
    assert.ok((receipt.operatorProjections ?? []).length <= projection.tables.length);
    assert.equal(new Set((receipt.operatorProjections ?? []).map(row => row.table)).size,
      (receipt.operatorProjections ?? []).length);
    const users = [];
    const views = [];
    for (const entry of receipt.userJournal) {
      verifyPlatformUserOwnership(runId, entry, {
        user: entry.user, host: entry.host, plugin: 'mysql_native_password',
        authenticationSha256: entry.authenticationSha256,
        accountLocked: entry.user === projection.user ? 'Y' : 'N',
      });
      const count = sql(`SELECT COUNT(*) FROM mysql.user WHERE User='${entry.user}' AND Host='${entry.host}';`);
      assert.ok(['0', '1'].includes(count));
      if (count === '0') continue;
      const actual = JSON.parse(sql(`SELECT JSON_OBJECT('user',User,'host',Host,'plugin',plugin,`
        + `'authenticationSha256',SHA2(authentication_string,256),'accountLocked',account_locked)`
        + ` FROM mysql.user WHERE User='${entry.user}' AND Host='${entry.host}';`));
      verifyPlatformUserOwnership(runId, entry, actual);
      const grants = sql(`SHOW GRANTS FOR '${entry.user}'@'${entry.host}';`);
      const mode = entry.user === identity.bootstrapUser ? 'bootstrap' : 'verify';
      const bound = entry.user === projection.user ? receipt.operatorProjectionGrants : receipt[`${mode}Grants`];
      if (bound) assert.equal(hash(grants), bound.sha256, 'Recorded SQL grant drift');
      if (entry.user === projection.user) verifyPlatformOperatorProjectionGrants(runId, grants, { allowPartial: true });
      else verifyPlatformGrants(identity, mode, grants, { allowPartial: true });
      users.push(entry);
    }
    if (users.some(entry => entry.user === projection.user)) {
      const rows = sql(`SELECT JSON_OBJECT('schema',TABLE_SCHEMA,'table',TABLE_NAME) FROM information_schema.views`
        + ` WHERE DEFINER='${projection.user}@${projection.host}' ORDER BY TABLE_SCHEMA,TABLE_NAME;`);
      const dependent = rows ? rows.split('\n').map(row => JSON.parse(row)) : [];
      assert.ok(dependent.every(row => row.schema === projection.targetSchema
        && (receipt.operatorProjections ?? []).some(recorded => recorded.table === row.table)),
      'This principal has views outside this receipt; an earlier failed receipt cannot clean resumed resources');
    }
    for (const user of [...receipt.userJournal.map(row => row.user), ebsxIdentity(runId).runtimeUser]) {
      assert.equal(sql(`SELECT COUNT(*) FROM information_schema.PROCESSLIST WHERE USER='${user}';`), '0',
        'Stop consumers before removing the run-owned operator projections');
    }
    for (const row of receipt.operatorProjections ?? []) {
      assert.ok(projection.tables.includes(row.table));
      const count = sql(`SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='${projection.targetSchema}' AND table_name='${row.table}';`);
      assert.ok(['0', '1'].includes(count));
      if (count === '0') continue;
      assert.ok(users.some(user => user.user === projection.user), 'View definer ownership must be verified before cleanup');
      const actual = JSON.parse(sql(`SELECT JSON_OBJECT('schema',TABLE_SCHEMA,'table',TABLE_NAME,`
        + `'definer',DEFINER,'security',SECURITY_TYPE,'updatable',IS_UPDATABLE,'definition',VIEW_DEFINITION)`
        + ` FROM information_schema.views WHERE table_schema='${projection.targetSchema}' AND table_name='${row.table}';`));
      const columnRows = sql(`SELECT JSON_QUOTE(COLUMN_NAME) FROM information_schema.columns`
        + ` WHERE table_schema='${projection.targetSchema}' AND table_name='${row.table}' ORDER BY ORDINAL_POSITION;`);
      const columns = columnRows ? columnRows.split('\n').map(value => JSON.parse(value)) : [];
      const definitionSha256 = hash(sql(`SHOW CREATE VIEW \`${projection.targetSchema}\`.\`${row.table}\`;`));
      verifyPlatformViewCleanup(runId, row, actual, columns, definitionSha256);
      views.push(row);
    }
    for (const row of views) {
      sql(`DROP VIEW \`${projection.targetSchema}\`.\`${row.table}\`;`);
      report.droppedOperatorProjections.push(row.table);
    }
    for (const entry of users) {
      sql(`DROP USER '${entry.user}'@'${entry.host}';`);
      report.removed.push(entry.user);
    }
    report.status = 'passed-owned-platform-account-cleanup';
  } catch (error) { report.status = 'failed'; report.error = error.message; }
  return report;
}

export function cleanupOwnedPlatform({ workspace = workspaceDefault, runId, label, deploymentInput }) {
  const identity = platformIdentity(runId);
  assert.match(label ?? '', /^[a-z0-9][a-z0-9-]{0,48}$/);
  workspace = resolve(workspace);
  const directories = new PinnedDirectories();
  let target;
  try {
    const { base, read, guard, sql } = ownedContext(workspace, runId, directories, {
      deploymentInput, registerTarget: value => { target = value; },
    });
    const output = join(base, `platform-schema-${label}`);
    const receipt = JSON.parse(read(join(output, 'report.json')));
    assert.deepEqual(receipt.identity, identity);
    guard();
    const report = cleanupPlatformSqlResources({ runId, receipt }, { sql });
    directories.write(directories.open(output), `cleanup-${randomBytes(6).toString('hex')}.json`, json(report));
    return report;
  } finally {
    try { target?.close(); }
    finally { directories.close(); }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: {
    'execute-owned-platform': { type: 'boolean' }, 'cleanup-owned-platform': { type: 'boolean' },
    'run-id': { type: 'string' }, label: { type: 'string' },
    'workflow-report': { type: 'string' }, 'ebsx-report': { type: 'string' },
    'deployment-input': { type: 'string' },
    'resume-failed-report': { type: 'string' }, 'resume-failed-report-sha256': { type: 'string' },
    'resume-uaa-replacement-report': { type: 'string' },
  } });
  assert.notEqual(Boolean(values['execute-owned-platform']), Boolean(values['cleanup-owned-platform']));
  const result = values['cleanup-owned-platform']
    ? { report: cleanupOwnedPlatform({ runId: values['run-id'], label: values.label,
      deploymentInput: values['deployment-input'] }) }
    : await bootstrapOwnedPlatform({ runId: values['run-id'], label: values.label,
      workflowReportPath: values['workflow-report'], ebsxReportPath: values['ebsx-report'],
      deploymentInput: values['deployment-input'], resumeFailedReport: values['resume-failed-report'],
      resumeFailedReportSha256: values['resume-failed-report-sha256'],
      resumeUaaReplacementReport: values['resume-uaa-replacement-report'] });
  console.log(json({ reportPath: result.reportPath, status: result.report.status,
    platformSchemaVerified: result.report.platformSchemaVerified, errors: result.report.errors }));
  process.exitCode = result.report.status.startsWith('passed-') ? 0 : 1;
}
