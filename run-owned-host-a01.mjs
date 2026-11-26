#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import {
  buildOwnedHostLoopbackShim, ownedHostRuntimeCommand, ownedHostRuntimeWitness, withOwnedHostRuntime,
} from './launch-run-owned-native-backend.mjs';
import { javaProperties, parseJavaProperties, UAA_CONSOLE_LOGGING } from './harness-run-owned-uaa-runtime.mjs';
import { createApplicationAccounts } from './provision-run-owned-native-application-accounts.mjs';
import { modelingContextFromIdentity, verifyRead, verifyUAAIdentity } from './run-owned-native-permission-http.mjs';
import { ownedNacosContent, parseOwnedNacosContent } from './run-owned-backend-configuration.mjs';
import { publishOwnedNacos } from './launch-run-owned-native-backend.mjs';
import { workflowGrantSQL, workflowIdentity } from './bootstrap-owned-workflow-schema.mjs';
import {
  ebsxGrantSQL, ebsxIdentity, ebsxPermissionProjectionGrantSQL, ebsxPermissionProjectionIdentity,
  ebsxPermissionProjectionViewSQL,
} from './bootstrap-owned-ebsx-schema.mjs';
import { readTree } from './native-candidate-files.mjs';
import {
  a01InvalidRootRequest, A01_PARENTLESS_SOURCE_PATH, A01_SOURCE_PATHS, createA01RootPlan,
  requestOwnedA01, verifyA01BackendToken, verifyA01Denial, verifyA01NativeSources, verifyA01PhysicalBaseline,
} from './owned-a01-root-http.mjs';
import { verifyA01ParentlessMethods } from './run-owned-a01-root-http.mjs';
import { readNativeFiveDatasetContract } from './native-five-dataset-contract.mjs';
import {
  editorPhysicalInventorySQL, editorPhysicalSnapshotSQL, normalizeEditorPhysicalSnapshot,
  validateEditorPhysicalInventory,
} from './probe-owned-editor-registry-http.mjs';

const workspaceDefault = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const executionRoot = workspaceDefault;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
export const OWNED_HOST_A01_PORTS = Object.freeze({
  mysql: 13306, redis: 16379, zookeeper: 12181, nacos: 18848, uaa: 13666,
  allinone: 13000, provider: 13202, gateway: 13086,
});
const originalPorts = {
  mysql: 3306, redis: 6379, zookeeper: 2181, nacos: 8848, uaa: 32666,
  allinone: 30000, provider: 32002, gateway: 30086,
};

export function ownedA01LoginBody(user, password) {
  assert.ok(user && typeof user.loginname === 'string' && user.loginname);
  assert.ok(typeof user.centerId === 'string' && user.centerId);
  assert.ok(typeof password === 'string' && password);
  return { loginname: user.loginname, password, dc: user.centerId };
}

export function validateOwnedHostA01Plan(plan, workspace = workspaceDefault) {
  assert.equal(plan?.contract, 'owned-host-a01-plan-v1');
  assert.match(plan.runId ?? '', /^[a-f0-9]{12}$/);
  assert.match(plan.label ?? '', /^[a-z0-9][a-z0-9-]{0,28}$/);
  assert.ok(['authentication', 'a01'].includes(plan.stage));
  workspace = resolve(workspace);
  const base = join(workspace, '.artifacts/native-nonadmin-fixtures', plan.runId);
  for (const key of ['dependencyDirectory', 'javaPath', 'sourceBackendDirectory',
    'uaaConfigurationPath', 'applicationAccountsPath', 'imageReportPath', 'uaaBuildReportPath']) {
    assert.equal(typeof plan[key], 'string', `Explicit ${key} is required`);
    const path = resolve(workspace, plan[key]);
    assert.ok(path.startsWith(`${join(workspace, '.artifacts')}/`), 'Host A01 inputs must remain in private artifacts');
    assert.ok(!/[\r\n\0]/.test(path));
  }
  for (const key of ['sourceBackendDirectory', 'uaaConfigurationPath', 'applicationAccountsPath']) {
    assert.ok(resolve(workspace, plan[key]).startsWith(`${base}/`), 'Host A01 fixture inputs must belong to this run');
  }
  if (plan.stage === 'a01') {
    for (const key of ['workflowConfigurationPath', 'workflowCredentialsPath', 'ebsxConfigurationPath', 'ebsxCredentialsPath']) {
      assert.equal(typeof plan[key], 'string', `Explicit ${key} is required`);
      assert.ok(resolve(workspace, plan[key]).startsWith(`${base}/`));
      assert.match(plan.inputHashes?.[plan[key]] ?? plan.inputHashes?.[relative(workspace, resolve(workspace, plan[key]))]
        ?? '', /^[a-f0-9]{64}$/, 'Owned host schema inputs require their original SHA-256 bindings');
    }
    assert.equal(typeof plan.executionSnapshotPath, 'string', 'A sealed A01 execution snapshot is required');
    const snapshot = resolve(workspace, plan.executionSnapshotPath);
    assert.ok(snapshot.startsWith(`${join(workspace, '.artifacts')}/`));
    assert.match(plan.inputHashes?.[plan.executionSnapshotPath] ?? plan.inputHashes?.[relative(workspace, snapshot)]
      ?? '', /^[a-f0-9]{64}$/, 'The sealed execution snapshot requires an original SHA-256 binding');
  }
  assert.match(basename(resolve(workspace, plan.sourceBackendDirectory)), /^backend-runtime-[a-z0-9-]+$/);
  assert.ok(plan.inputHashes && typeof plan.inputHashes === 'object' && !Array.isArray(plan.inputHashes));
  for (const path of [join(base, 'manifest.json'), join(base, 'credentials.private.json'),
    resolve(workspace, plan.uaaConfigurationPath), resolve(workspace, plan.applicationAccountsPath),
    resolve(workspace, plan.imageReportPath), resolve(workspace, plan.uaaBuildReportPath),
    join(resolve(workspace, plan.sourceBackendDirectory), 'nacos-configs.private.json')]) {
    assert.match(plan.inputHashes[path] ?? plan.inputHashes[relative(workspace, path)] ?? '', /^[a-f0-9]{64}$/,
      'Every sensitive host input requires an explicit original SHA-256 binding');
  }
  for (const [path, sha256] of Object.entries(plan.inputHashes)) {
    const absolute = resolve(workspace, path);
    assert.ok(absolute.startsWith(`${join(workspace, '.artifacts')}/`));
    assert.match(sha256, /^[a-f0-9]{64}$/);
  }
  return { workspace, base, directory: join(base, `backend-host-${plan.label}`) };
}

export function hostA01EndpointMappings(plan, workspace = workspaceDefault) {
  const { base } = validateOwnedHostA01Plan(plan, workspace);
  const mappings = {};
  const source = resolve(workspace, plan.sourceBackendDirectory);
  const label = basename(source).slice('backend-runtime-'.length);
  for (const role of ['nacos', 'zookeeper', 'allinone', 'provider', 'gateway']) {
    mappings[`nf-${plan.runId}-backend-${label}-${role}`] = {
      role, oldPort: originalPorts[role], port: OWNED_HOST_A01_PORTS[role],
    };
  }
  const uaaRun = basename(dirname(dirname(resolve(workspace, plan.uaaConfigurationPath))))
    .slice('uaa-runtime-'.length);
  for (const role of ['uaa', 'redis']) {
    mappings[`nf-${plan.runId}-uaa-${uaaRun}${role === 'redis' ? '-redis' : ''}`] = {
      role, oldPort: originalPorts[role], port: OWNED_HOST_A01_PORTS[role],
    };
  }
  mappings[`nf-${plan.runId}-mysql`] = { role: 'mysql', oldPort: 3306, port: OWNED_HOST_A01_PORTS.mysql };
  assert.equal(base.endsWith(plan.runId), true);
  return mappings;
}

export function hostA01Endpoint(value, mappings) {
  assert.equal(typeof value, 'string');
  if (value.startsWith('lb://')) return value;
  const jdbc = value.startsWith('jdbc:mysql://');
  const http = /^https?:\/\//.test(value);
  const bare = /^[a-z0-9.-]+:\d+$/.test(value);
  if (!jdbc && !http && !bare) return value;
  const url = new URL(jdbc ? value.slice(5) : bare ? `http://${value}` : value);
  const peer = mappings[url.hostname];
  assert.ok(peer, 'Host A01 cannot map an unreviewed service endpoint');
  assert.equal(Number(url.port), peer.oldPort, 'Original owned service port changed');
  assert.equal(url.username, '');
  assert.equal(url.password, '');
  url.hostname = '127.0.0.1';
  url.port = String(peer.port);
  let result = url.toString();
  if (bare) result = result.slice('http://'.length).replace(/\/$/, '');
  else if (!value.endsWith('/') && url.pathname === '/' && !url.search && !url.hash) result = result.slice(0, -1);
  return jdbc ? `jdbc:${result}` : result;
}

function mappedObject(value, mappings) {
  if (typeof value === 'string') return hostA01Endpoint(value, mappings);
  if (Array.isArray(value)) return value.map(row => mappedObject(row, mappings));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, row]) => [key, mappedObject(row, mappings)]));
  }
  return value;
}

export async function executeOwnedHostA01({
  plan, workspace = workspaceDefault, executeOwned = false,
} = {}) {
  assert.equal(executeOwned, true, 'Explicit owned host A01 execution is required');
  const paths = validateOwnedHostA01Plan(plan, workspace);
  ({ workspace } = paths);
  const { base, directory } = paths;
  const inputHashes = new Map();
  const read = path => {
    path = resolve(workspace, path);
    assert.ok(path.startsWith(`${workspace}/`));
    assert.equal(fs.realpathSync(path), path, 'Host A01 source inputs cannot traverse symlinks');
    const bytes = fs.readFileSync(path);
    const expected = plan.inputHashes[relative(workspace, path)] ?? plan.inputHashes[path];
    if (expected !== undefined) assert.equal(hash(bytes), expected, 'Host A01 private source binding changed');
    inputHashes.set(path, hash(bytes));
    return bytes;
  };
  for (const path of Object.keys(plan.inputHashes)) read(path);
  for (const path of [
    'scripts/run-owned-host-a01.mjs', 'scripts/launch-run-owned-native-backend.mjs',
    'scripts/run-owned-native-permission-http.mjs', 'scripts/harness-run-owned-uaa-runtime.mjs',
  ]) read(join(executionRoot, path));
  let executionSnapshot;
  if (plan.executionSnapshotPath) {
    executionSnapshot = JSON.parse(read(plan.executionSnapshotPath));
    assert.equal(executionSnapshot.contract, 'owned-host-a01-execution-snapshot-v1');
    assert.equal(resolve(workspace, executionSnapshot.entry), fileURLToPath(import.meta.url),
      'The host campaign must execute the sealed entry, not the mutable workspace entry');
    for (const input of executionSnapshot.files) {
      const path = resolve(workspace, input.path);
      assert.ok(path.startsWith(`${executionRoot}/`));
      assert.equal(hash(read(path)), input.sha256, 'Sealed host execution bytes changed');
      assert.equal(fs.statSync(path).mode & 0o077, 0, 'Sealed host execution inputs must remain private');
    }
  }
  const manifest = JSON.parse(read(join(base, 'manifest.json')));
  const credentials = JSON.parse(read(join(base, 'credentials.private.json')));
  const accounts = JSON.parse(read(plan.applicationAccountsPath));
  const imageReport = JSON.parse(read(plan.imageReportPath));
  assert.equal(manifest.runId, plan.runId);
  assert.equal(imageReport.contract, 'isolated-backend-source-images-v1');
  assert.equal(imageReport.status, 'passed-image-artifact-binding-only');
  const packageBytes = read(imageReport.packageReceipt.path);
  assert.equal(hash(packageBytes), imageReport.packageReceipt.sha256);
  const packageReport = JSON.parse(packageBytes);
  const uaaBuildPath = resolve(workspace, plan.uaaBuildReportPath);
  const uaaBuild = JSON.parse(read(uaaBuildPath));
  assert.equal(uaaBuild.target, 'uaa-standalone-sys-person');
  const uaaRoot = dirname(uaaBuildPath);
  for (const archive of uaaBuild.packages) {
    assert.equal(hash(read(join(uaaRoot, archive.artifactPath))), archive.sha256, 'Original UAA package changed');
  }
  for (const [kind, folder] of [['thirdParty', 'third-party'], ['starters', 'starters']]) {
    const expected = uaaBuild.dependencyInputs[kind].entries;
    assert.deepEqual(fs.readdirSync(join(uaaRoot, folder)).filter(name => name.endsWith('.jar')).sort(),
      expected.filter(row => row.path.endsWith('.jar')).map(row => row.path).sort());
    for (const archive of expected) assert.equal(hash(read(join(uaaRoot, folder, archive.path))), archive.sha256,
      'Original UAA classpath dependency changed');
  }
  const dependency = resolve(workspace, plan.dependencyDirectory);
  const java = resolve(workspace, plan.javaPath);
  const source = resolve(workspace, plan.sourceBackendDirectory);
  const mappings = hostA01EndpointMappings(plan, workspace);
  const handles = {};
  const pids = [];
  const output = join(directory, `campaign-${Date.now()}-${process.pid}.private.json`);
  const report = {
    contract: 'owned-host-a01-campaign-v1', runId: plan.runId, stage: plan.stage,
    startedAt: new Date().toISOString(), status: 'failed', checks: [], sourceBindings: [],
    processes: [],
    fullA01Acceptance: false, typedRootHTTPAcceptance: false, nativeAcceptance: false,
    packageSourceFingerprint: packageReport.sourceInputs.before.fingerprint,
    ...(executionSnapshot ? { executionVersion: { path: plan.executionSnapshotPath,
      sha256: inputHashes.get(resolve(workspace, plan.executionSnapshotPath)),
      files: executionSnapshot.files.length } } : {}),
  };
  const guard = () => {
    for (const [path, sha256] of inputHashes) assert.equal(hash(fs.readFileSync(path)), sha256, 'Host A01 input drift');
    return Object.fromEntries(Object.entries(handles).map(([role, handle]) => [role, ownedHostRuntimeWitness(handle)]));
  };
  const configuration = role => {
    const path = role === 'uaa' ? plan.uaaConfigurationPath : join(source, `${role}-config/application.properties`);
    const original = parseJavaProperties(read(path));
    const values = {};
    for (const [key, originalValue] of Object.entries(original)) {
      const value = String(originalValue);
      if (mappings[value] && /(\.host|\.servicehost)$/.test(key)) values[key] = '127.0.0.1';
      else if (/(\.port|\.serviceport)$/.test(key)) {
        const peer = Object.keys(originalPorts).find(role => originalPorts[role] === Number(value));
        values[key] = peer ? OWNED_HOST_A01_PORTS[peer] : value;
      } else if (/(\.filefolder|\.tempfolder)$/.test(key)) {
        values[key] = join(directory, role, key.endsWith('.filefolder') ? 'datafile' : 'tempfile');
      } else if (/\.modelpath$/.test(key)) values[key] = join(directory, 'model-input');
      else values[key] = hostA01Endpoint(value, mappings);
    }
    Object.assign(values, { 'server.address': '127.0.0.1', 'server.port': OWNED_HOST_A01_PORTS[role],
      'logging.config': `file:${join(directory, `${role}-config/logback.xml`)}` });
    fs.mkdirSync(join(directory, `${role}-config`), { recursive: true, mode: 0o700 });
    fs.writeFileSync(join(directory, `${role}-config/application.properties`), javaProperties(values), { mode: 0o600 });
    fs.writeFileSync(join(directory, `${role}-config/logback.xml`), UAA_CONSOLE_LOGGING, { mode: 0o600 });
    return join(directory, `${role}-config/application.properties`);
  };
  const sql = input => {
    assert.ok(handles.mysql, 'A live owned MySQL process is required');
    ownedHostRuntimeWitness(handles.mysql);
    const result = spawnSync(join(dependency, 'mysql/bin/mysql'), [
      '--no-defaults', '--protocol=SOCKET', '--socket=./mysql.sock', '--user=root',
      '--default-character-set=utf8mb4', '--batch', '--raw', '--skip-column-names',
    ], { cwd: join(directory, 'mysql-data'),
      env: { LD_LIBRARY_PATH: join(dependency, 'mysql/lib'), HOME: directory, LANG: 'C.UTF-8' },
      input, encoding: 'utf8', timeout: 120000, maxBuffer: 64 * 1024 * 1024 });
    if (result.status !== 0) fs.writeFileSync(join(directory, 'sql-error.private.log'), result.stderr ?? '', { mode: 0o600 });
    assert.ok(result.status === 0 && !result.error && !result.signal, 'Owned host SQL failed; private output suppressed');
    return result.stdout.trim();
  };
  const bootstrapSchemas = () => {
    report.currentStage = 'owned-host-schema-bootstrap';
    const component = imageReport.components.find(row => row.name === 'allinone');
    const original = component.imageFiles.find(row => row.path.endsWith('.jar'));
    const jarPath = join(resolve(workspace, component.context), basename(original.path));
    assert.equal(hash(read(jarPath)), original.sha256);
    const archive = packageReport.packages.archives.find(row => row.path === 'ibiz-ebsx-runtime/ibiz-ebsx-allinone-rt.jar');
    assert.equal(archive.sha256, original.sha256);
    const libraries = join(dependency, 'backend-libraries');
    if (!fs.existsSync(libraries)) {
      fs.mkdirSync(libraries, { mode: 0o700 });
      const extraction = spawnSync('unzip', ['-j', jarPath, 'BOOT-INF/lib/*.jar', '-d', libraries], {
        encoding: 'utf8', timeout: 30000, maxBuffer: 2 * 1024 * 1024,
      });
      fs.writeFileSync(join(directory, 'schema-library-extraction.private.log'),
        `${extraction.stdout ?? ''}${extraction.stderr ?? ''}`, { mode: 0o600 });
      assert.equal(extraction.status, 0, 'Original backend dependency extraction failed');
    }
    assert.deepEqual(fs.readdirSync(libraries).sort(), archive.embeddedLibraries.map(row => basename(row.path)).sort());
    for (const library of archive.embeddedLibraries) {
      assert.equal(hash(read(join(libraries, basename(library.path)))), library.sha256,
        'Schema helper dependency differs from the original backend JAR');
    }
    const classes = join(directory, 'schema-helper-classes');
    fs.mkdirSync(classes, { recursive: true, mode: 0o700 });
    const sources = ['OwnedWorkflowSchemaProbe', 'OwnedEbsxSchemaProbe'].map(name =>
      join(executionRoot, 'scripts/fixtures', `${name}.java`));
    sources.forEach(read);
    const compilation = spawnSync(join(dirname(java), 'javac'), [
      '--release', '11', '-encoding', 'UTF-8', '-proc:none', '-cp', `${libraries}/*`, '-d', classes, ...sources,
    ], { encoding: 'utf8', timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
    fs.writeFileSync(join(directory, 'schema-helper-compile.private.log'),
      `${compilation.stdout ?? ''}${compilation.stderr ?? ''}`, { mode: 0o600 });
    assert.equal(compilation.status, 0, 'Owned host schema helper compilation failed');
    const witness = ownedHostRuntimeWitness(handles.mysql);
    const host = { hostTransport: 'owned-host-v1', hostPid: String(witness.pid),
      hostPort: String(witness.port), hostDirectory: directory, hostStartTicks: witness.startTicks,
      hostCmdlineSha256: witness.cmdlineSha256, hostExecutableSha256: witness.executableSha256,
      hostRuntimeJarPath: jarPath, hostRuntimeJarSha256: original.sha256 };
    report.schemaHelpers = [];
    for (const kind of ['workflow', 'ebsx']) {
      const configuration = JSON.parse(read(plan[`${kind}ConfigurationPath`]));
      const secrets = JSON.parse(read(plan[`${kind}CredentialsPath`])).passwords;
      const identity = kind === 'workflow' ? workflowIdentity(plan.runId) : ebsxIdentity(plan.runId);
      assert.equal(configuration.schema, identity.schema);
      assert.equal(configuration.username, identity.runtimeUser);
      assert.equal(configuration.password, secrets.verify);
      for (const mode of ['bootstrap', 'verify']) assert.match(secrets[mode], /^[a-f0-9]{36}$/);
      sql(`CREATE DATABASE IF NOT EXISTS \`${identity.schema}\` CHARACTER SET utf8mb4;`);
      for (const [mode, user] of [['bootstrap', identity.bootstrapUser], ['verify', identity.runtimeUser]]) {
        sql(`CREATE USER IF NOT EXISTS '${user}'@'%' IDENTIFIED BY '${secrets[mode]}';`
          + `ALTER USER '${user}'@'%' IDENTIFIED BY '${secrets[mode]}';`
          + (kind === 'workflow' ? workflowGrantSQL(identity, user, mode === 'bootstrap') : ebsxGrantSQL(identity, mode)));
      }
      const helper = kind === 'workflow' ? 'OwnedWorkflowSchemaProbe' : 'OwnedEbsxSchemaProbe';
      const sourcePath = sources.find(path => path.endsWith(`/${helper}.java`));
      const input = { runId: plan.runId, ...host, hostSourcePath: sourcePath,
        hostSourceSha256: inputHashes.get(sourcePath), url: hostA01Endpoint(identity.url, mappings),
        mode: 'bootstrap', username: identity.bootstrapUser, password: secrets.bootstrap };
      const invoke = (suffix, values, denied = false) => {
        ownedHostRuntimeWitness(handles.mysql);
        const result = spawnSync(java, ['-Xmx1536m', '-XX:ActiveProcessorCount=2',
          `-Duser.home=${directory}`, `-Djava.io.tmpdir=${join(directory, 'tmp')}`,
          '-cp', `${classes}:${libraries}/*`, helper], {
          cwd: directory, env: { HOME: directory, TMPDIR: join(directory, 'tmp'),
            LD_PRELOAD: report.network.library,
            AIBIZ_OWNED_TCP_PORTS: Object.values(OWNED_HOST_A01_PORTS).join(',') },
          input: json(values), encoding: 'utf8', timeout: 120000, maxBuffer: 32 * 1024 * 1024,
        });
        fs.writeFileSync(join(directory, `${kind}-${suffix}.private.log`),
          `${result.stdout ?? ''}${result.stderr ?? ''}`, { mode: 0o600 });
        assert.ok(!result.error && !result.signal, 'Owned schema helper transport failed');
        if (denied) {
          assert.notEqual(result.status, 0, 'Foreign host SQL witness was accepted');
          return { id: suffix, status: 'pass', deniedBeforeMigration: true };
        }
        assert.equal(result.status, 0, 'Owned host schema helper failed; see its private log');
        const value = JSON.parse(result.stdout.trim());
        assert.equal(value.schema, identity.schema);
        assert.equal(value.hostTransport, 'owned-host-v1');
        assert.equal(value.hostStartTicks, witness.startTicks);
        return value;
      };
      const refusals = [
        ['shared-port', { hostPort: '3306' }], ['foreign-process', { hostPid: String(process.pid) }],
        ['stale-process', { hostStartTicks: `${host.hostStartTicks}1` }],
        ['changed-jar', { hostRuntimeJarSha256: '0'.repeat(64) }],
      ].map(([name, patch]) => invoke(`deny-${name}`, { ...input, ...patch }, true));
      const bootstrap = invoke('bootstrap', input);
      if (kind === 'ebsx') {
        const projection = ebsxPermissionProjectionIdentity(plan.runId);
        assert.match(secrets.projection, /^[a-f0-9]{36}$/);
        sql(`CREATE USER IF NOT EXISTS '${projection.user}'@'localhost' IDENTIFIED BY '${secrets.projection}' ACCOUNT LOCK;`
          + ebsxPermissionProjectionGrantSQL(plan.runId));
        const existing = sql(`SELECT COUNT(*) FROM information_schema.views WHERE table_schema='${identity.schema}' AND table_name='sys_role_member';`);
        if (existing === '0') sql(ebsxPermissionProjectionViewSQL(plan.runId));
      }
      const verification = invoke('verify', { ...input, mode: 'verify',
        username: identity.runtimeUser, password: secrets.verify });
      sql(`DROP USER '${identity.bootstrapUser}'@'%';`);
      report.schemaHelpers.push({ kind, refusals, bootstrap, verification, bootstrapUserRemoved: true });
    }
    report.connectionMappings = [];
    for (const root of manifest.roots) {
      const record = JSON.parse(sql(`SELECT JSON_OBJECT('id',pssysmodelinstid,'url',connstr,'user',username,'database',dbname)`
        + ` FROM \`${manifest.schemas.metadata}\`.t_srfpssysmodelinst WHERE pssysmodelinstid='${root.modelInstanceId}';`));
      const hostUrl = hostA01Endpoint(root.jdbcUrl, mappings);
      assert.equal(record.id, root.modelInstanceId);
      assert.equal(record.user, root.jdbcUser);
      assert.equal(record.database, root.database);
      assert.ok([root.jdbcUrl, hostUrl].includes(record.url), 'Fixture model connection has an unreviewed source');
      sql(`SET @host_url=CONVERT(X'${Buffer.from(hostUrl).toString('hex')}' USING utf8mb4);`
        + `SET @host_id=CONVERT(X'${Buffer.from(root.modelInstanceId).toString('hex')}' USING utf8mb4);`
        + `PREPARE owned_host_connection FROM 'UPDATE \`${manifest.schemas.metadata}\`.t_srfpssysmodelinst SET connstr=? WHERE pssysmodelinstid=?';`
        + 'EXECUTE owned_host_connection USING @host_url,@host_id;DEALLOCATE PREPARE owned_host_connection;');
      report.connectionMappings.push({ modelInstanceIdSha256: hash(root.modelInstanceId),
        sourceUrlSha256: hash(root.jdbcUrl), hostUrlSha256: hash(hostUrl), schemaPreserved: true });
    }
  };
  const registerAlias = async role => {
    const target = ownedHostRuntimeWitness(handles[role]);
    ownedHostRuntimeWitness(handles.nacos);
    const alias = { serviceName: role === 'uaa' ? 'uaa-api' : 'ibizcloud-uaa',
      groupName: `nf_${plan.runId}`, ip: '127.0.0.1', port: target.port, clusterName: 'DEFAULT',
      enabled: true, healthy: true, ephemeral: false,
      metadata: { 'aibiz.native-fixture.run': plan.runId, 'aibiz.native-service.role': role,
        'aibiz.owned-host.pid': String(target.pid), 'aibiz.owned-host.start-ticks': target.startTicks,
        'aibiz.owned-host.command-sha256': target.cmdlineSha256 } };
    const origin = `http://127.0.0.1:${OWNED_HOST_A01_PORTS.nacos}`;
    const response = await fetch(`${origin}/nacos/v1/ns/instance`, { method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(Object.entries(alias).map(([key, value]) =>
        [key, key === 'metadata' ? JSON.stringify(value) : String(value)])),
      signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200);
    assert.equal((await response.text()).trim(), 'ok');
    const query = new URLSearchParams({ serviceName: alias.serviceName, groupName: alias.groupName,
      clusters: alias.clusterName, healthyOnly: 'false' });
    for (let attempt = 0; attempt < 50; attempt++) {
      ownedHostRuntimeWitness(handles[role]);
      ownedHostRuntimeWitness(handles.nacos);
      const result = await fetch(`${origin}/nacos/v1/ns/instance/list?${query}`, { signal: AbortSignal.timeout(5000) });
      assert.equal(result.status, 200);
      const body = await result.json();
      if (body.hosts?.length === 1 && body.hosts[0].healthy && body.hosts[0].ephemeral === false) {
        const peer = body.hosts[0];
        for (const key of ['ip', 'port', 'clusterName', 'enabled']) assert.equal(peer[key], alias[key]);
        assert.deepEqual(peer.metadata, alias.metadata);
        (report.aliases ??= []).push({ role, serviceName: alias.serviceName,
          targetPid: target.pid, targetPort: target.port, readbackVerified: true });
        return;
      }
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Owned host Nacos alias did not become ready');
  };
  const request = async (role, path, options = {}) => {
    guard();
    const response = await fetch(`http://127.0.0.1:${OWNED_HOST_A01_PORTS[role]}${path}`, {
      ...options, redirect: 'error', signal: AbortSignal.timeout(10000),
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.ok(bytes.length <= 2 * 1024 * 1024);
    return { status: response.status, sha256: hash(bytes), data: bytes.length
      ? role === 'nacos' && path.endsWith('/readiness') ? bytes.toString('utf8') : JSON.parse(bytes) : null };
  };
  const readiness = async role => {
    for (let attempt = 0; attempt < 100; attempt++) {
      ownedHostRuntimeWitness(handles[role]);
      try {
        const response = await request(role, role === 'uaa' ? '/auths/user-info/self'
          : role === 'nacos' ? '/nacos/v1/console/health/readiness' : '/actuator/health');
        if (role === 'uaa' ? response.status === 401 : role === 'nacos'
          ? response.status === 200 : [200, 401, 404].includes(response.status)) return;
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error(`Owned host ${role} readiness deadline exceeded`);
  };
  const authenticate = async () => {
    for (const user of manifest.users) {
      const login = await request('uaa', '/auths/login', { method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(ownedA01LoginBody(user, credentials.users[user.loginname])) });
      assert.equal(login.status, 200);
      verifyUAAIdentity(login.data?.user, user);
      assert.match(login.data?.token ?? '', /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
      const self = await request('uaa', '/auths/user-info/self', { headers: { authorization: `Bearer ${login.data.token}` } });
      assert.equal(self.status, 200);
      verifyUAAIdentity(self.data, user);
      report.checks.push({ id: 'native-uaa-login-and-self', status: 'pass',
        loginStatus: login.status, selfStatus: self.status, identityVerified: true,
        loginResponseSha256: login.sha256, selfResponseSha256: self.sha256 });
    }
  };
  const boundedA01 = async () => {
    report.currentStage = 'native-a01-parentless-and-control';
    const sources = {};
    report.currentSourceMatches = {};
    for (const [key, path] of Object.entries(A01_SOURCE_PATHS)) {
      const packaged = read(join(resolve(workspace, packageReport.worktree), path));
      assert.equal(hash(packaged), packageReport.sourceInputs.before.entries.find(row => row.path === path)?.sha256);
      sources[key] = packaged.toString('utf8');
      report.currentSourceMatches[key] = hash(read(join(workspace, 'ibiz-service-hub', path))) === hash(packaged);
    }
    verifyA01NativeSources(sources);
    const adapter = read(join(resolve(workspace, packageReport.worktree), A01_PARENTLESS_SOURCE_PATH));
    assert.equal(hash(adapter), packageReport.sourceInputs.before.entries.find(row => row.path === A01_PARENTLESS_SOURCE_PATH)?.sha256);
    const modelAPI = JSON.parse(read(join(directory, 'model-input/PSSYSSERVICEAPIS/ModelAPI.json')));
    verifyA01ParentlessMethods(modelAPI, adapter.toString('utf8'));
    const contract = readNativeFiveDatasetContract({ workspace });
    const capture = () => {
      const inventory = sql(editorPhysicalInventorySQL(manifest)).split('\n').filter(Boolean).map(JSON.parse);
      const targets = validateEditorPhysicalInventory(manifest, contract, inventory);
      const rows = sql(editorPhysicalSnapshotSQL(targets)).split('\n').filter(Boolean).map(JSON.parse);
      return normalizeEditorPhysicalSnapshot(inventory, targets, rows);
    };
    const context = { manifest, credentials, includeParentlessAbsent: true,
      guard: () => {
        guard();
        return { origins: { backend: `http://127.0.0.1:${OWNED_HOST_A01_PORTS.gateway}`,
          uaa: `http://127.0.0.1:${OWNED_HOST_A01_PORTS.uaa}` } };
      } };
    const user = manifest.users.find(user => user.role === 'editor');
    const root = manifest.roots.find(root => root.rootId === user.rootId);
    const login = await request('uaa', '/auths/login', { method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(ownedA01LoginBody(user, credentials.users[user.loginname])) });
    assert.equal(login.status, 200);
    verifyUAAIdentity(login.data.user, user);
    const applicationContext = modelingContextFromIdentity(login.data.user, user);
    const backendLogin = async () => {
      const login = await request('gateway', '/v7/login', { method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(ownedA01LoginBody(user, credentials.users[user.loginname])) });
      assert.equal(login.status, 200);
      const token = login.data?.token ?? login.data?.access_token;
      verifyA01BackendToken(token);
      return token;
    };
    const baseline = capture();
    verifyA01PhysicalBaseline(manifest, baseline);
    const control = await requestOwnedA01(context, { peer: 'backend', method: 'GET',
      path: `/api/ibizmodeling__modeldesign/psdevslnsys/${root.rootId}/psmodules/${root.sentinelId}`,
      token: await backendLogin(), applicationContext });
    verifyRead(control, root, 'get');
    assert.deepEqual(capture(), baseline);
    report.checks.push({ id: 'native-owned-root-control', status: 'pass',
      httpStatus: control.status, responseSha256: control.responseSha256, physicalModelsUnchanged: true });
    const row = createA01RootPlan(manifest, { includeParentlessAbsent: true }).invalidRootCases
      .find(row => row.rootKind === 'absent' && row.accessAction === 'READ'
        && row.principal.loginname === user.loginname);
    assert.ok(row);
    const invalid = a01InvalidRootRequest(manifest, row, { includeParentlessAbsent: true });
    const denied = await requestOwnedA01(context, { ...invalid, token: await backendLogin(), applicationContext });
    verifyA01Denial(manifest, denied, baseline, capture(), { invalidRoot: true });
    report.checks.push({ id: row.id, status: 'pass', httpStatus: denied.status,
      responseSha256: denied.responseSha256, physicalModelsUnchanged: true, rootKind: 'absent' });
    report.boundedParentlessRequestVerified = true;
    report.snapshotCoverage = { tables: baseline.tables.length,
      columns: baseline.inventory.length, encoding: baseline.encoding };
  };
  try {
    assert.equal(fs.realpathSync(directory), directory);
    if (plan.stage === 'a01') {
      const sourceModel = join(source, 'model-input');
      const stagedModel = join(directory, 'model-input');
      const original = readTree(sourceModel, { jsonOnly: false });
      if (!fs.existsSync(stagedModel)) fs.cpSync(sourceModel, stagedModel, { recursive: true, errorOnExist: true });
      assert.equal(readTree(stagedModel, { jsonOnly: false }).fingerprint, original.fingerprint);
      report.modelInput = { fingerprint: original.fingerprint, files: original.entries.length };
    }
    report.network = buildOwnedHostLoopbackShim({ workspace, runId: plan.runId, label: plan.label });
    const allowedPorts = [...Object.values(OWNED_HOST_A01_PORTS), 17848, 18849, 19848, 19849,
      13001, 13203, 13087];
    const baseCommand = { workspace, runId: plan.runId, label: plan.label };
    const javaCommand = { ...baseCommand, executable: java, networkBinding: report.network, allowedPorts };
    const roles = ['mysql', 'redis', 'zookeeper', 'nacos', 'uaa',
      ...(plan.stage === 'a01' ? ['allinone', 'provider', 'gateway'] : [])];
    const run = async index => {
      if (index === roles.length) {
        await authenticate();
        if (plan.stage === 'a01') await boundedA01();
        report.witnesses = guard();
        return;
      }
      const role = roles[index];
      report.currentStage = `${role}-startup`;
      let command;
      if (role === 'mysql') command = ownedHostRuntimeCommand({ ...baseCommand, role, port: OWNED_HOST_A01_PORTS.mysql,
        executable: join(dependency, 'mysql/bin/mysqld'), mysqlBase: join(dependency, 'mysql'),
        libraryPath: join(dependency, 'mysql/lib') });
      else if (role === 'redis') command = ownedHostRuntimeCommand({ ...baseCommand, role, port: OWNED_HOST_A01_PORTS.redis,
        executable: join(dependency, 'redis-lib/ld-musl-aarch64.so.1'), libraryPath: join(dependency, 'redis-lib'),
        redisPath: join(dependency, 'redis-server') });
      else if (role === 'zookeeper') {
        fs.mkdirSync(join(directory, 'zookeeper-config'), { recursive: true, mode: 0o700 });
        const configPath = join(directory, 'zookeeper-config/application.properties');
        fs.writeFileSync(configPath, javaProperties({ tickTime: 2000, dataDir: join(directory, 'zookeeper-data'),
          clientPort: OWNED_HOST_A01_PORTS.zookeeper, clientPortAddress: '127.0.0.1',
          'admin.enableServer': false, standaloneEnabled: true, '4lw.commands.whitelist': 'srvr' }), { mode: 0o600 });
        command = ownedHostRuntimeCommand({ ...javaCommand, role, port: OWNED_HOST_A01_PORTS.zookeeper,
          classpathRoot: join(dependency, 'zookeeper-lib'), configPath });
      } else if (role === 'nacos') {
        const jarPath = join(dependency, 'nacos-server.jar');
        command = ownedHostRuntimeCommand({ ...javaCommand, role, port: OWNED_HOST_A01_PORTS.nacos,
          jarPath, jarSha256: hash(read(jarPath)) });
      } else if (role === 'uaa') command = ownedHostRuntimeCommand({ ...javaCommand, role,
        port: OWNED_HOST_A01_PORTS.uaa, classpathRoot: uaaRoot,
        configPath: configuration('uaa'), dependencies: { mysql: handles.mysql, redis: handles.redis } });
      else {
        const component = imageReport.components.find(row => row.name === role);
        const archive = component.imageFiles.find(row => row.path.endsWith('.jar'));
        const jarPath = join(resolve(workspace, component.context), basename(archive.path));
        assert.equal(hash(read(jarPath)), archive.sha256);
        command = ownedHostRuntimeCommand({ ...javaCommand, role, port: OWNED_HOST_A01_PORTS[role],
          jarPath, jarSha256: archive.sha256, configPath: configuration(role),
          dependencies: Object.fromEntries(['mysql', 'redis', 'nacos', 'uaa', 'zookeeper',
            ...(role === 'provider' || role === 'gateway' ? ['allinone'] : []),
            ...(role === 'gateway' ? ['provider'] : [])]
            .map(peer => [peer, handles[peer]])) });
      }
      await withOwnedHostRuntime(command, async handle => {
        handles[role] = handle;
        pids.push(handle.pid);
        report.processes.push({ role, pid: handle.pid, port: handle.port, started: true });
        try {
          if (role === 'mysql') {
            const identity = sql('SELECT @@port,@@datadir;').split('\t');
            assert.deepEqual(identity, [String(OWNED_HOST_A01_PORTS.mysql), `${directory}/mysql-data/`]);
            for (const account of createApplicationAccounts(manifest).accounts) {
              const password = accounts.passwords[account.username];
              assert.match(password ?? '', /^[a-f0-9]{36}$/);
              sql(`CREATE USER IF NOT EXISTS '${account.username}'@'%' IDENTIFIED BY '${password}';`
                + `ALTER USER '${account.username}'@'%' IDENTIFIED BY '${password}';`
                + `GRANT ${account.privileges} ON \`${account.database.replaceAll('_', '\\_')}\`.* TO '${account.username}'@'%';`);
            }
            if (plan.stage === 'a01') bootstrapSchemas();
          } else if (['nacos', 'uaa', 'allinone', 'provider', 'gateway'].includes(role)) {
            await readiness(role);
            if (role === 'nacos') {
              const rows = JSON.parse(read(join(source, 'nacos-configs.private.json'))).map(row => ({
                ...row, content: ownedNacosContent(mappedObject(parseOwnedNacosContent(row.content), mappings)),
              }));
              report.nacosConfiguration = await publishOwnedNacos(
                `http://127.0.0.1:${OWNED_HOST_A01_PORTS.nacos}`, rows);
            }
            if (role === 'uaa' || role === 'allinone') await registerAlias(role);
          }
          await run(index + 1);
        } finally { delete handles[role]; }
      }, { timeoutMs: 300000 });
    };
    await run(0);
    for (const pid of pids) assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    report.exactProcessesCleaned = true;
    report.status = plan.stage === 'a01' ? 'passed-bounded-owned-host-parentless-only'
      : 'passed-owned-host-authentication-only';
  } catch (error) {
    report.error = error.message;
    for (const pid of pids) assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
    report.exactProcessesCleaned = true;
  } finally {
    for (const [path, sha256] of inputHashes) {
      if (hash(fs.readFileSync(path)) !== sha256) {
        report.status = 'failed';
        report.error = 'Host A01 bound input changed during execution';
      }
    }
    report.sourceBindings = [...inputHashes].map(([path, sha256]) => ({ path: relative(workspace, path), sha256 }));
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(output, json(report), { mode: 0o600, flag: 'wx' });
  }
  return { report, path: output, sha256: hash(fs.readFileSync(output)) };
}

export async function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({ args: argv, options: {
    'execute-owned-host-a01': { type: 'boolean' }, plan: { type: 'string' }, workspace: { type: 'string' },
  } });
  assert.equal(values['execute-owned-host-a01'], true);
  assert.ok(values.plan);
  const result = await executeOwnedHostA01({
    plan: JSON.parse(fs.readFileSync(resolve(values.plan))), executeOwned: true,
    workspace: values.workspace ?? workspaceDefault,
  });
  console.log(json({ status: result.report.status, reportPath: result.path,
    sha256: result.sha256, exactProcessesCleaned: result.report.exactProcessesCleaned,
    fullA01Acceptance: false, typedRootHTTPAcceptance: false }));
  return result.report.status.startsWith('passed-') ? 0 : 1;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().then(code => { process.exitCode = code; }).catch(error => {
    console.error(`Owned host A01 campaign refused: ${error.message}`);
    process.exitCode = 1;
  });
}
