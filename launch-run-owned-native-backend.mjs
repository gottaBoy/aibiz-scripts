#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { PinnedDirectories, readPinnedFile, readTree } from './native-candidate-files.mjs';
import { verifyBackendSourceImages } from './harness-backend-source-images.mjs';
import {
  javaProperties, parseJavaProperties, privateContainerOrigin, UAA_CONSOLE_LOGGING,
  verifyOwnedNetwork, verifyProbeContainer,
} from './harness-run-owned-uaa-runtime.mjs';
import { readApplicationAccountInput, validateFixtureReceipt } from './provision-run-owned-native-application-accounts.mjs';
import { validateDeployment } from './run-owned-native-permission-http.mjs';
import { readOwnedWorkflowConfiguration } from './bootstrap-owned-workflow-schema.mjs';
import { readOwnedEbsxConfiguration } from './bootstrap-owned-ebsx-schema.mjs';
import { readOwnedPlatformConfiguration } from './bootstrap-owned-platform-schema.mjs';
import { parseOwnedNacosContent } from './run-owned-backend-configuration.mjs';
import {
  probeOwnedModelingApplicationRoutes, readCentralMemberModelOverlay, verifyStagedCentralMemberModel,
} from './owned-modeling-application-routes.mjs';
import { verifySelectedMysqlStorage } from './mysql-fixture-profiles.mjs';
import { inspectMysqlFixtureVolumes } from './owned-mysql-volume.mjs';
import { ownedUaaAlias, publishOwnedUaaAlias } from './owned-nacos-service-alias.mjs';
import {
  NACOS_IMAGE_ID, ZOOKEEPER_IMAGE_ID, OWNED_NACOS_TMPFS, OWNED_ZOOKEEPER_TMPFS,
  OWNED_SERVICE_TMPFS, verifyOwnedZookeeper,
} from './owned-backend-resources.mjs';

export { NACOS_IMAGE_ID, ZOOKEEPER_IMAGE_ID } from './owned-backend-resources.mjs';
const defaultWorkspace = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const labelKey = 'aibiz.native-fixture.run';
const launchLabelKey = 'aibiz.native-backend.launch';
const idPattern = /^[a-f0-9]{64}$/;
const imagePattern = /^sha256:[a-f0-9]{64}$/;
export const BACKEND_PORTS = Object.freeze({ allinone: 30000, provider: 32002, gateway: 30086 });
const modelRelativePath =
  'vendor-upstream/ibizmodeling-standard/modelapi-core/src/main/resources/model/net/ibizsys/modeling';
const jars = Object.freeze({
  allinone: '/ibiz-ebsx-allinone-rt.jar', gateway: '/ibiz-ebsx-gateway.jar',
});

function validateRun(runId, label) {
  assert.match(runId, /^[a-f0-9]{12}$/);
  assert.match(label, /^[a-z0-9][a-z0-9-]{0,48}$/);
}

export function ownedBackendNames(runId, label, retainedNames) {
  validateRun(runId, label);
  const prefix = `nf-${runId}-backend-${label}`;
  for (const role of ['uaa', 'redis']) {
    assert.match(retainedNames[role], new RegExp(`^nf-${runId}-uaa-[a-z0-9-]+${role === 'redis' ? '-redis' : ''}$`));
  }
  return {
    ...Object.fromEntries(['nacos', 'zookeeper', 'allinone', 'provider', 'gateway'].map(role => [role, `${prefix}-${role}`])),
    uaa: retainedNames.uaa, redis: retainedNames.redis,
  };
}

function commonRun({ runId, label, networkName, name, imageId }) {
  validateRun(runId, label);
  assert.equal(networkName, `nf-${runId}-private`);
  assert.ok(name.startsWith(`nf-${runId}-backend-${label}-`));
  assert.match(name, /^[a-z0-9-]+$/);
  assert.match(imageId, imagePattern);
  const memory = { allinone: '3g', provider: '3g', gateway: '1g', nacos: '1g', zookeeper: '384m' };
  const role = name.split('-').at(-1);
  assert.ok(Object.hasOwn(memory, role), 'Unknown owned backend role');
  return ['run', '--detach', '--pull=never', '--name', name, '--network', networkName,
    '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges',
    '--cpus=2', `--memory=${memory[role]}`, '--pids-limit=512',
    '--user', '65532:65532', '--label', `${labelKey}=${runId}`,
    '--label', `${launchLabelKey}=${label}`, '--tmpfs',
    OWNED_SERVICE_TMPFS];
}

function runInput(path, runId, label) {
  assert.ok(typeof path === 'string' && !/[,\r\n\0]/.test(path), 'Unsafe bind input');
  assert.equal(path, resolve(path), 'Bind input must be absolute');
  assert.ok(path.includes(`/.artifacts/native-nonadmin-fixtures/${runId}/backend-runtime-${label}/`),
    'Bind input must belong to this backend run');
  assert.ok(!path.split('/').some(part => part === '..' || part === '.'));
  return path;
}

export function nacosRunCommand(options) {
  assert.equal(options.imageId, NACOS_IMAGE_ID);
  return [...commonRun(options), '--workdir', '/tmp',
    ...OWNED_NACOS_TMPFS.slice(1).flatMap(value => ['--tmpfs', value]),
    '--env', 'MODE=standalone', '--env', 'SPRING_DATASOURCE_PLATFORM=',
    '--env', 'JAVA_OPT_EXT=-Xms128m -Xmx512m -XX:ActiveProcessorCount=2 -Duser.home=/tmp -Djava.io.tmpdir=/tmp/nacos-native',
    options.imageId];
}

export function zookeeperRunCommand(options) {
  assert.equal(options.imageId, ZOOKEEPER_IMAGE_ID);
  assert.equal(options.name, `nf-${options.runId}-backend-${options.label}-zookeeper`);
  return [...commonRun(options), '--workdir', '/tmp',
    ...OWNED_ZOOKEEPER_TMPFS.slice(1).flatMap(value => ['--tmpfs', value]),
    ...['ZOO_ADMINSERVER_ENABLED=false', 'ZOO_STANDALONE_ENABLED=true',
      'ZOO_4LW_COMMANDS_WHITELIST=srvr', 'ZOO_SERVERS=server.1=127.0.0.1:2888:3888;2181',
      'JVMFLAGS=-Xms32m -Xmx128m -Djava.io.tmpdir=/tmp',
    ].flatMap(value => ['--env', value]), options.imageId];
}

export function verifyZookeeperReadiness(result) {
  assert.ok(result.status === 0 && !result.error && !result.signal, 'ZooKeeper status command failed');
  assert.match(result.stdout, /^Mode: standalone\r?$/m, 'ZooKeeper must respond in standalone mode');
}

export function verifyBackendStartupLog(role, text) {
  assert.ok(Object.hasOwn(BACKEND_PORTS, role));
  assert.ok(typeof text === 'string' && text.trim(), 'Missing backend startup log');
  assert.doesNotMatch(text, /Application run failed|APPLICATION FAILED TO START|Error starting ApplicationContext/,
    'Backend reported a fatal initialization error after opening its HTTP port');
  return { noFatalStartupFailureObserved: true, bytes: Buffer.byteLength(text), sha256: hash(text) };
}

export function backendRunCommand(options) {
  const { role, configPath, loggingPath, modelPath, mysqlName, nacosName } = options;
  assert.ok(Object.hasOwn(BACKEND_PORTS, role));
  assert.equal(options.name.split('-').at(-1), role);
  const heap = role === 'gateway' ? '512m' : '1536m';
  const args = [...commonRun(options), '--workdir', '/tmp',
    '--mount', `type=bind,src=${runInput(configPath, options.runId, options.label)},dst=/app/config/application.properties,readonly`,
    '--mount', `type=bind,src=${runInput(loggingPath, options.runId, options.label)},dst=/app/config/logback.xml,readonly`,
    '--env', `JAVA_TOOL_OPTIONS=-Xms128m -Xmx${heap} -XX:ActiveProcessorCount=2 -Duser.home=/tmp -Dlogging.config=file:/app/config/logback.xml -Dcom.sun.xml.bind.v2.bytecode.ClassTailor.noOptimize=true --add-exports=java.naming/com.sun.jndi.ldap=ALL-UNNAMED`];
  if (role === 'provider') {
    assert.equal(mysqlName, `nf-${options.runId}-mysql`);
    assert.equal(nacosName, `nf-${options.runId}-backend-${options.label}-nacos`);
    args.push('--mount', `type=bind,src=${runInput(modelPath, options.runId, options.label)},dst=/app/model,readonly`,
      '--env', `MYSQL_HOST=${mysqlName}`, '--env', 'MYSQL_PORT=3306',
      '--env', `NACOS_HOST=${nacosName}`, '--env', 'WAIT_FOR_MYSQL=true',
      '--env', 'WAIT_FOR_NACOS_HEALTH=false', '--env', 'WAIT_FOR_TIMEOUT=120',
      options.imageId, `${mysqlName}:3306`, `${nacosName}:8848`, '--',
      '--spring.config.location=file:/app/config/application.properties');
  } else {
    args.push('--entrypoint', 'java', options.imageId,
      '--add-opens=java.base/java.lang=ALL-UNNAMED',
      '--add-opens=java.base/java.lang.reflect=ALL-UNNAMED',
      '-Duser.timezone=Asia/Shanghai', '-jar', jars[role],
      '--spring.config.location=file:/app/config/application.properties');
  }
  return args;
}

export function retainedPeerWitness(container) {
  assert.match(container.Id, idPattern);
  return {
    id: container.Id, image: container.Image, name: container.Name,
    startedAt: container.State.StartedAt, restartCount: container.RestartCount,
    config: container.Config,
    mounts: [...container.Mounts].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    hostConfig: container.HostConfig,
    networks: container.NetworkSettings.Networks,
  };
}

export function verifyRetainedPeers(before, after) {
  assert.equal(before.length, 3, 'Retained peers must be MySQL, UAA and Redis');
  assert.equal(after.length, before.length);
  for (const previous of before) {
    const current = after.find(row => row.Id === previous.Id);
    assert.ok(current, 'Retained peer vanished');
    assert.equal(current.State.Running, true, 'Retained peer stopped');
    assert.deepEqual(retainedPeerWitness(current), retainedPeerWitness(previous),
      'Retained peer configuration, identity or lifecycle changed');
  }
}

export function deploymentInput({ manifest, resources, imageReceipt, services, auxiliaryContainers, containers, network,
  volumes = [] }) {
  const endpoint = (role, port) => {
    const container = containers.find(row => row.Id === services[role].containerId);
    privateContainerOrigin(container, network, port);
    const attachment = container.NetworkSettings.Networks[network.Name];
    return {
      transport: 'private-inspected-ipv4', service: role, containerPort: port,
      containerId: container.Id, networkId: network.Id,
      endpointId: attachment.EndpointID, ipv4: attachment.IPAddress,
    };
  };
  const value = {
    contract: 'run-owned-native-permission-deployment-input-v2',
    runId: manifest.runId,
    imageReceipt: { path: imageReceipt.reportPath, sha256: imageReceipt.reportSha256 },
    services, auxiliaryContainers,
    endpoints: { uaa: endpoint('uaa', 32666), backend: endpoint('gateway', 30086) },
  };
  validateDeployment(manifest, resources, value, containers, network, imageReceipt.report, volumes);
  return value;
}

async function http(origin, path, options = {}) {
  const response = await fetch(`${origin}${path}`, {
    ...options, redirect: 'error', signal: AbortSignal.timeout(5000),
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.ok(bytes.length <= 4 * 1024 * 1024, 'HTTP startup response too large');
  return { status: response.status, bytes };
}

export async function publishOwnedNacos(origin, rows, {
  request = http, delay = ms => new Promise(resolve => setTimeout(resolve, ms)),
  readbackAttempts = 50,
} = {}) {
  assert.ok(Array.isArray(rows) && rows.length > 0, 'Owned Nacos configuration is required');
  assert.ok(Number.isSafeInteger(readbackAttempts) && readbackAttempts >= 1 && readbackAttempts <= 50);
  const keys = new Set();
  const bindings = [];
  for (const row of rows) {
    assert.match(row.dataId, /^[A-Za-z0-9_.-]+$/);
    assert.match(row.group, /^nf_[a-f0-9]{12}$/);
    const key = `${row.group}/${row.dataId}`;
    assert.ok(!keys.has(key), 'Duplicate Nacos input');
    keys.add(key);
    parseOwnedNacosContent(row.content);
  }
  assert.equal(new Set(rows.map(row => row.group)).size, 1, 'Nacos inputs must share this run group');
  for (const row of rows) {
    const body = new URLSearchParams({ dataId: row.dataId, group: row.group, content: row.content, type: 'yaml' });
    const sent = await request(origin, '/nacos/v1/cs/configs', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body,
    });
    assert.equal(sent.status, 200, 'Owned Nacos publish failed');
    assert.equal(sent.bytes.toString('utf8').trim(), 'true', 'Owned Nacos rejected configuration');
    const query = new URLSearchParams({ dataId: row.dataId, group: row.group });
    let attempts = 0;
    for (;;) {
      const fetched = await request(origin, `/nacos/v1/cs/configs?${query}`);
      attempts++;
      if (fetched.status === 404 && attempts < readbackAttempts) {
        await delay(100);
        continue;
      }
      assert.equal(fetched.status, 200, 'Owned Nacos configuration was not readable after publishing');
      assert.equal(fetched.bytes.toString('utf8'), row.content, 'Owned Nacos readback differs');
      break;
    }
    bindings.push({ dataId: row.dataId, group: row.group, bytes: Buffer.byteLength(row.content),
      sha256: hash(row.content), readbackAttempts: attempts });
  }
  return bindings;
}

export function stageOwnedModelInput({
  directories, source, outputPath, workspace = defaultWorkspace, centralMemberReceiptPath,
}) {
  const model = readTree(source, { jsonOnly: false });
  const overlay = centralMemberReceiptPath === undefined ? undefined
    : readCentralMemberModelOverlay({ workspace, receiptPath: centralMemberReceiptPath });
  if (overlay) {
    for (const input of overlay.inputs) {
      assert.equal(model.entries.find(row => row.path === input.path)?.sha256, input.sha256,
        'Central candidate does not match the actual backend model source');
    }
  }
  const targetRoot = directories.open(outputPath, { create: true, exclusive: true });
  for (const file of model.contents) {
    const target = directories.open(join(targetRoot.path, dirname(file.path)), { create: true });
    const replacement = overlay?.contents.find(row => row.path === file.path);
    directories.write(target, basename(file.path), replacement?.data ?? file.data);
    fs.chmodSync(directories.entry(target, basename(file.path)), 0o644);
  }
  for (const directory of directories.directories.values()) {
    if (directory.path === targetRoot.path || directory.path.startsWith(`${targetRoot.path}/`)) {
      fs.chmodSync(directory.access, 0o755);
    }
  }
  const staged = readTree(targetRoot.path, { jsonOnly: false });
  assert.deepEqual(staged.entries, model.entries.map(file => {
    const replacement = overlay?.contents.find(row => row.path === file.path);
    return replacement ? { ...file, bytes: replacement.data.length, sha256: replacement.sha256 } : file;
  }), 'Staged model input drifted');
  const current = readTree(source, { jsonOnly: false });
  assert.deepEqual(current.entries, model.entries, 'Model source changed during staging');
  return {
    directory: targetRoot, files: staged.files, bytes: staged.bytes, fingerprint: staged.fingerprint,
    ...(overlay ? { centralMemberBinding: verifyStagedCentralMemberModel({
      workspace, receiptPath: centralMemberReceiptPath, modelPath: targetRoot.path,
    }) } : {}),
  };
}

export async function launchOwnedNativeBackend({
  runId, imageReportPath, retainedUaaReportPath, label = randomBytes(6).toString('hex'),
  retainOwned = false, timeoutMs = 180000, workspace = defaultWorkspace, workflowReportPath, ebsxReportPath,
  platformReportPath, centralMemberReceiptPath,
}) {
  validateRun(runId, label);
  assert.ok(workflowReportPath, 'Explicit verified owned workflow schema report is required');
  assert.ok(ebsxReportPath, 'Explicit verified owned EBSX schema report is required');
  assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 600000);
  workspace = resolve(workspace);
  const directories = new PinnedDirectories();
  const base = join(workspace, '.artifacts/native-nonadmin-fixtures', runId);
  const output = join(base, `backend-runtime-${label}`);
  const created = [];
  let destination;
  let before;
  let resources;
  const report = {
    contract: 'run-owned-native-backend-startup-v1', schemaVersion: 1, runId, label,
    status: 'failed', startedAt: new Date().toISOString(), inputs: [], checks: [], errors: [],
    sourceClosureVerified: false, nativeAcceptance: false, permissionAcceptance: false,
    actualBackendStarted: false, retainedPeerIntegrityVerified: false,
    applicationInitializationVerified: false, startupLogChecks: [],
    retainedOwned: false, services: {}, cleanup: [],
    limitations: [
      'Startup and exact deployment transport only; not permission, persistence, source-closure or release acceptance.',
      'Retained short-TTL UAA security evidence does not establish backend authorization or persistence.',
    ],
  };
  const docker = (args, allowFailure = false) => {
    const result = spawnSync('docker', args, {
      encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024,
    });
    if (!allowFailure) assert.ok(result.status === 0 && !result.error && !result.signal,
      'Owned Docker operation failed; private configuration and logs suppressed');
    return result;
  };
  const inspect = id => JSON.parse(docker(['inspect', id]).stdout)[0];
  const inspectNetwork = () => JSON.parse(docker(['network', 'inspect', resources.networkId]).stdout)[0];
  const read = (path, privateInput = false, parse = true) => {
    path = resolve(path);
    const child = relative(workspace, path);
    assert.ok(child && child !== '..' && !child.startsWith('../') && !child.startsWith('/'),
      'Input must remain in this workspace');
    const result = readPinnedFile(directories, directories.open(dirname(path)), basename(path));
    if (privateInput) assert.equal(result.identity.mode & 0o077, 0, 'Private input permissions are too broad');
    report.inputs.push({ path: child, bytes: result.data.length, sha256: hash(result.data) });
    if (!parse) return result.data;
    try { return JSON.parse(result.data); }
    catch { throw new Error('Input JSON is invalid; private values suppressed'); }
  };
  const write = (directory, name, bytes, readable = false) => {
    directories.write(directory, name, bytes);
    if (readable) fs.chmodSync(directories.entry(directory, name), 0o644);
  };
  const ensureNetwork = expectedPeers => {
    const network = inspectNetwork();
    verifyOwnedNetwork(manifest, resources, network, expectedPeers);
    return network;
  };
  let manifest;
  try {
    directories.open(base);
    destination = directories.open(output, { create: true, exclusive: true });
    manifest = read(join(base, 'manifest.json'));
    assert.equal(manifest.runId, runId);
    const sql = read(join(base, 'isolated-sql-report.json'));
    assert.equal(sql.inputs.modelSchemaSources?.length, 3, 'Explicit model-schema source bindings required');
    for (const source of sql.inputs.modelSchemaSources) {
      assert.ok(['DEFAULT', 'DB2', 'DB3'].includes(source.link));
      assert.equal(source.path, `${modelRelativePath}/PSSYSDBSCHEMES/${source.link}.json`);
      assert.equal(hash(read(join(workspace, source.path), false, false)), source.sha256,
        'Fixture model-schema source changed after SQL evidence');
    }
    validateFixtureReceipt(manifest, sql, report.inputs.find(row => row.path.endsWith('/manifest.json')).sha256);
    resources = read(join(base, 'owned-resources.json'));
    assert.equal(resources.mysqlId, sql.ownedMysqlId);
    assert.equal(resources.networkId, sql.ownedNetworkId);
    resources.mysqlImage ??= sql.mysqlImage;
    const retained = read(retainedUaaReportPath);
    assert.equal(retained.contract, 'run-owned-source-uaa-native-http-probe-v1');
    assert.equal(retained.runId, runId);
    assert.equal(retained.status, 'passed-scoped-native-uaa-http-only');
    assert.equal(retained.actualBootApplicationStarted, true);
    assert.equal(retained.actualHttpLoginVerified, true);
    assert.equal(retained.actualTokenSecurityVerified, true, 'Retained UAA requires real TokenStore security evidence');
    assert.equal(retained.retainedOwned, true);
    assert.ok(retained.checks.slice(0, 13).length === 13 &&
      retained.checks.slice(0, 13).every(row => row.status === 'pass'));
    assert.equal(retained.checks.length, 16, 'Require all login and stateful token security checks');
    assert.ok(retained.checks.every(row => row.status === 'pass'));
    assert.deepEqual(retained.checks.slice(13).map(row => row.id), [
      'signed-security-positive-control', 'tampered-signature-token-denied', 'expired-signed-token-denied',
    ]);
    assert.deepEqual(Object.keys(retained.services).sort(), ['redis', 'uaa']);
    before = [resources.mysqlId, retained.services.uaa.containerId, retained.services.redis.containerId].map(inspect);
    ensureNetwork(before.map(row => row.Id));
    for (const peer of before) {
      assert.match(peer.Id, idPattern);
      assert.equal(peer.State.Running, true);
      assert.equal(peer.Config.Labels?.[labelKey], runId);
      assert.equal(peer.HostConfig.Privileged, false);
      assert.ok(!peer.HostConfig.CapAdd?.length);
      assert.deepEqual(Object.keys(peer.NetworkSettings.Networks), [manifest.ownership.network]);
      assert.equal(peer.NetworkSettings.Networks[manifest.ownership.network].NetworkID, resources.networkId);
      assert.ok(Object.values(peer.HostConfig.PortBindings ?? {}).every(row => row === null));
      assert.ok(Object.values(peer.NetworkSettings.Ports ?? {}).every(row => row === null));
    }
    assert.equal(before[0].Image, resources.mysqlImage);
    verifySelectedMysqlStorage(resources.databaseProfile, before[0], {
      storage: resources.databaseStorage, volumes: inspectMysqlFixtureVolumes(resources),
    });
    for (const [role, container] of [['uaa', before[1]], ['redis', before[2]]]) {
      assert.equal(container.Image, retained.services[role].imageId);
    }
    const uaaMount = before[1].Mounts.filter(mount =>
      mount.Type === 'bind' && mount.RW === false && mount.Destination === '/opt/uaa/config');
    assert.equal(uaaMount.length, 1, 'Retained UAA configuration must be bound once');
    assert.equal(uaaMount[0].Source, join(dirname(resolve(retainedUaaReportPath)), 'config'));
    const retainedConfiguration = parseJavaProperties(read(join(uaaMount[0].Source, 'application.properties'), false, false));
    const accountInput = readApplicationAccountInput({
      workspace, runId, label: retained.applicationAccounts?.label, manifest,
    });
    assert.deepEqual(accountInput.binding, retained.applicationAccounts, 'Retained UAA account binding changed');
    const accounts = accountInput.accounts;
    report.applicationAccounts = accountInput.binding;
    const credentials = read(join(base, 'credentials.private.json'), true);
    const names = ownedBackendNames(runId, label, {
      uaa: before[1].Name.slice(1), redis: before[2].Name.slice(1),
    });
    const existingNames = new Set(docker(['container', 'ls', '--all', '--format', '{{.Names}}']).stdout.trim().split('\n'));
    for (const role of ['nacos', 'zookeeper', 'allinone', 'provider', 'gateway']) {
      assert.ok(!existingNames.has(names[role]), 'Backend container name already exists');
    }
    const imageReceipt = verifyBackendSourceImages({ workspace, reportPath: resolve(imageReportPath) });
    report.inputs.push({ path: relative(workspace, imageReceipt.reportPath), sha256: imageReceipt.reportSha256 });
    const nacosImage = JSON.parse(docker(['image', 'inspect', NACOS_IMAGE_ID]).stdout)[0];
    assert.equal(nacosImage.Id, NACOS_IMAGE_ID);
    assert.equal(nacosImage.Os, 'linux');
    assert.equal(nacosImage.Architecture, imageReceipt.report.base.architecture);
    assert.deepEqual(Object.keys(nacosImage.Config.Volumes ?? {}), []);
    assert.deepEqual(nacosImage.Config.Entrypoint, ['/usr/local/bin/nacos-jre17-startup.sh']);
    const zooImage = JSON.parse(docker(['image', 'inspect', ZOOKEEPER_IMAGE_ID]).stdout)[0];
    assert.equal(zooImage.Id, ZOOKEEPER_IMAGE_ID);
    assert.equal(zooImage.Os, 'linux');
    assert.equal(zooImage.Architecture, imageReceipt.report.base.architecture);
    assert.deepEqual(Object.keys(zooImage.Config.Volumes ?? {}).sort(), ['/data', '/datalog', '/logs']);
    assert.deepEqual(zooImage.Config.Entrypoint, ['/docker-entrypoint.sh']);
    const { createOwnedBackendConfiguration } = await import('./run-owned-backend-configuration.mjs');
    const workflowInput = readOwnedWorkflowConfiguration({
      workspace, runId, reportPath: workflowReportPath, packageReceipt: imageReceipt.report.packageReceipt,
    });
    report.workflowSchema = workflowInput.binding;
    const ebsxInput = readOwnedEbsxConfiguration({
      workspace, runId, reportPath: ebsxReportPath, packageReceipt: imageReceipt.report.packageReceipt,
    });
    report.ebsxSchema = ebsxInput.binding;
    const platformInput = platformReportPath === undefined ? undefined : readOwnedPlatformConfiguration({
      workspace, runId, reportPath: platformReportPath, packageReceipt: imageReceipt.report.packageReceipt,
    });
    if (platformInput) report.platformSchema = platformInput.binding;
    const model = stageOwnedModelInput({
      directories, source: join(workspace, modelRelativePath), outputPath: join(output, 'model-input'),
      workspace, centralMemberReceiptPath,
    });
    const modelDirectory = model.directory;
    report.modelInput = { source: modelRelativePath, files: model.files, bytes: model.bytes,
      fingerprint: model.fingerprint, stagedPath: relative(workspace, modelDirectory.path) };
    if (model.centralMemberBinding) report.modelInput.centralMemberBinding = model.centralMemberBinding;
    const workflowReport = read(workflowReportPath);
    const helperImage = JSON.parse(docker(['image', 'inspect', workflowReport.image.reference]).stdout)[0];
    assert.equal(helperImage.Id, workflowReport.image.id);
    assert.equal(helperImage.Architecture, imageReceipt.report.base.architecture);
    const applicationRouting = probeOwnedModelingApplicationRoutes({
      workspace, runId, label, imageId: helperImage.Id,
      dependencies: join(dirname(resolve(workspace, workflowReportPath)), 'dependencies'),
      modelPath: modelDirectory.path, outputPath: join(output, 'model-route-probe'), directories, docker,
    });
    assert.equal(applicationRouting.modelFingerprint, model.fingerprint);
    report.modelingApplicationRouting = applicationRouting;
    const configuration = createOwnedBackendConfiguration({
      manifest, accounts, credentials, retainedUaaConfiguration: retainedConfiguration, names,
      workflow: workflowInput.configuration,
      ebsx: ebsxInput.configuration,
      platform: platformInput?.configuration,
      modelingRouteProbe: applicationRouting.probe,
      centralMemberBinding: model.centralMemberBinding,
    });
    assert.deepEqual(Object.keys(configuration.services).sort(), ['allinone', 'gateway', 'provider']);
    const configPaths = {};
    for (const role of ['allinone', 'provider', 'gateway']) {
      const config = directories.open(join(output, `${role}-config`), { create: true });
      const values = configuration.services[role];
      assert.equal(Number(values['server.port']), BACKEND_PORTS[role], 'Backend port must be explicit');
      write(config, 'application.properties', javaProperties(values), true);
      write(config, 'logback.xml', UAA_CONSOLE_LOGGING, true);
      configPaths[role] = {
        configPath: join(config.path, 'application.properties'), loggingPath: join(config.path, 'logback.xml'),
      };
    }
    write(destination, 'nacos-configs.private.json', json(configuration.nacosConfigs));
    const launch = (role, imageId, command) => {
      ensureNetwork([...before.map(row => row.Id), ...created.map(row => row.id)]);
      const id = docker(command).stdout.trim();
      assert.match(id, idPattern);
      created.push({ id, role, imageId, name: names[role] });
      const container = inspect(id);
      verifyProbeContainer(container, {
        imageId, runId, networkId: resources.networkId,
        networkName: manifest.ownership.network, name: names[role],
      });
      assert.equal(container.Config.Labels?.[launchLabelKey], label);
      if (role === 'zookeeper') verifyOwnedZookeeper(container, runId, label);
      ensureNetwork([...before.map(row => row.Id), ...created.map(row => row.id)]);
      return container;
    };
    const checkBackendLog = (peer, phase) => {
      const result = docker(['logs', peer.id], true);
      assert.ok(result.status === 0 && !result.error && !result.signal, 'Cannot inspect backend startup log');
      const text = `${result.stdout ?? ''}${result.stderr ?? ''}`;
      const row = { role: peer.role, phase, status: 'fail', bytes: Buffer.byteLength(text), sha256: hash(text) };
      report.startupLogChecks.push(row);
      verifyBackendStartupLog(peer.role, text);
      row.status = 'pass';
    };
    const wait = async (container, port, nacos = false) => {
      const network = ensureNetwork([...before.map(row => row.Id), ...created.map(row => row.id)]);
      const origin = privateContainerOrigin(container, network, port);
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        assert.equal(inspect(container.Id).State.Running, true, 'Owned service exited during startup');
        try {
          const result = await http(origin, nacos ? '/nacos/v1/console/health/readiness' : '/actuator/health');
          if (nacos ? result.status === 200 : [200, 401, 404].includes(result.status)) {
            report.checks.push({ id: `${container.Name.slice(1)}-http-transport`,
              status: 'pass', httpStatus: result.status, responseSha256: hash(result.bytes) });
            return origin;
          }
        } catch {}
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      throw new Error('Owned service did not expose its HTTP transport within the startup deadline');
    };
    const shared = { runId, label, networkName: manifest.ownership.network };
    const zookeeper = launch('zookeeper', ZOOKEEPER_IMAGE_ID, zookeeperRunCommand({
      ...shared, name: names.zookeeper, imageId: ZOOKEEPER_IMAGE_ID,
    }));
    const zooDeadline = Date.now() + timeoutMs;
    for (;;) {
      verifyOwnedZookeeper(inspect(zookeeper.Id), runId, label);
      ensureNetwork([...before.map(row => row.Id), ...created.map(row => row.id)]);
      const result = docker(['exec', '--user', '65532:65532', zookeeper.Id, 'zkServer.sh', 'status'], true);
      try {
        verifyZookeeperReadiness(result);
        report.checks.push({ id: 'owned-zookeeper-standalone-ready', status: 'pass',
          containerId: zookeeper.Id, imageId: ZOOKEEPER_IMAGE_ID, responseSha256: hash(result.stdout) });
        break;
      } catch {
        assert.ok(Date.now() < zooDeadline, 'Owned ZooKeeper readiness deadline exceeded');
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    const nacos = launch('nacos', NACOS_IMAGE_ID, nacosRunCommand({
      ...shared, name: names.nacos, imageId: NACOS_IMAGE_ID,
    }));
    const nacosOrigin = await wait(nacos, 8848, true);
    report.nacosConfigurationBindings = await publishOwnedNacos(nacosOrigin, configuration.nacosConfigs);
    const registryNetwork = ensureNetwork([...before.map(row => row.Id), ...created.map(row => row.id)]);
    const uaaOrigin = privateContainerOrigin(inspect(retained.services.uaa.containerId), registryNetwork, 32666);
    report.nacosServiceAliases = [await publishOwnedUaaAlias(nacosOrigin,
      ownedUaaAlias({ runId, origin: uaaOrigin }), {
        request: http,
        guard: () => ensureNetwork([...before.map(row => row.Id), ...created.map(row => row.id)]),
      })];
    for (const role of ['allinone', 'provider', 'gateway']) {
      const imageId = imageReceipt.report.components.find(row => row.name === role).image.id;
      const container = launch(role, imageId, backendRunCommand({
        ...shared, role, name: names[role], imageId, ...configPaths[role],
        modelPath: modelDirectory.path, mysqlName: manifest.ownership.mysqlContainer, nacosName: names.nacos,
      }));
      await wait(container, BACKEND_PORTS[role]);
      checkBackendLog(created.find(peer => peer.id === container.Id), 'after-http');
      report.services[role] = { containerId: container.Id, imageId };
    }
    for (const peer of created.filter(peer => Object.hasOwn(BACKEND_PORTS, peer.role))) {
      checkBackendLog(peer, 'whole-deployment-recheck');
    }
    report.services.uaa = retained.services.uaa;
    const auxiliaryContainers = [
      { ...retained.services.redis, role: 'redis' },
      { containerId: nacos.Id, imageId: NACOS_IMAGE_ID, role: 'nacos' },
      { containerId: zookeeper.Id, imageId: ZOOKEEPER_IMAGE_ID, role: 'zookeeper' },
    ];
    const network = ensureNetwork([...before.map(row => row.Id), ...created.map(row => row.id)]);
    const containers = [...before.map(row => inspect(row.Id)), ...created.map(row => inspect(row.id))];
    verifyRetainedPeers(before, containers.filter(row => before.some(peer => peer.Id === row.Id)));
    report.retainedPeerIntegrityVerified = true;
    const deployment = deploymentInput({
      manifest, resources, imageReceipt, services: report.services, auxiliaryContainers, containers, network,
      volumes: inspectMysqlFixtureVolumes(resources),
    });
    write(destination, 'deployment-input.private.json', json(deployment));
    report.deploymentInput = { path: relative(workspace, join(output, 'deployment-input.private.json')),
      sha256: hash(json(deployment)) };
    report.actualBackendStarted = true;
    report.status = 'passed-owned-backend-http-transport-only';
  } catch (error) {
    report.errors.push('Required owned deployment preflight, staging, startup or transport check failed; see private logs.');
    if (destination) write(destination, 'failure.private.log', `${error.stack ?? error.message}\n`);
  } finally {
    for (const peer of created) {
      if (destination) {
        const result = docker(['logs', peer.id], true);
        const text = `${result.stdout ?? ''}${result.stderr ?? ''}`;
        write(destination, `${peer.role}.private.log`, text);
        if (Object.hasOwn(BACKEND_PORTS, peer.role)) {
          try {
            assert.ok(result.status === 0 && !result.error && !result.signal);
            const binding = verifyBackendStartupLog(peer.role, text);
            report.startupLogChecks.push({ role: peer.role, phase: 'final-log', status: 'pass', ...binding });
          } catch {
            report.startupLogChecks.push({ role: peer.role, phase: 'final-log', status: 'fail',
              bytes: Buffer.byteLength(text), sha256: hash(text) });
            report.status = 'failed';
            report.actualBackendStarted = false;
            report.errors.push(`Fatal or unavailable ${peer.role} startup log; HTTP transport is not initialization proof.`);
          }
        }
        if (peer.role === 'nacos') {
          const details = docker(['exec', peer.id, 'sh', '-c',
            'for f in /home/nacos/logs/protocol-raft.log /home/nacos/logs/alipay-jraft.log; do if [ -f "$f" ]; then tail -c 262144 "$f"; fi; done'], true);
          write(destination, 'nacos-raft.private.log', `${details.stdout ?? ''}${details.stderr ?? ''}`);
        }
      }
    }
    if (!retainOwned || report.status !== 'passed-owned-backend-http-transport-only') {
      for (const peer of created.toReversed()) {
        try {
          const current = inspect(peer.id);
          assert.equal(current.Name, `/${peer.name}`);
          assert.equal(current.Image, peer.imageId);
          assert.equal(current.Config.Labels?.[labelKey], runId);
          assert.equal(current.Config.Labels?.[launchLabelKey], label);
          const result = docker(['rm', '--force', peer.id], true);
          report.cleanup.push({ containerId: peer.id, role: peer.role, removed: result.status === 0 });
          assert.equal(result.status, 0);
        } catch { report.errors.push('Run-owned backend cleanup failed; no retained peer was removed.'); }
      }
    }
    report.retainedOwned = retainOwned && report.status === 'passed-owned-backend-http-transport-only';
    if (before) {
      try {
        verifyRetainedPeers(before, before.map(peer => inspect(peer.Id)));
        report.retainedPeerIntegrityVerified = true;
        verifyOwnedNetwork(manifest, resources, inspectNetwork(),
          [...before.map(peer => peer.Id), ...(report.retainedOwned ? created.map(peer => peer.id) : [])]);
      } catch {
        report.retainedPeerIntegrityVerified = false;
        report.status = 'failed';
        report.errors.push('Retained peer or private network integrity changed; final acceptance is blocked.');
      }
    }
    report.finishedAt = new Date().toISOString();
    if (destination) {
      write(destination, 'report.json', json(report));
      write(destination, 'report.sha256', `${hash(json(report))}\n`);
    }
    directories.close();
  }
  return { report, reportPath: destination ? join(output, 'report.json') : null };
}

export async function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({
    args: argv, options: {
      'execute-owned-backend': { type: 'boolean' }, 'run-id': { type: 'string' },
      'image-report': { type: 'string' }, 'retained-uaa-report': { type: 'string' },
      'workflow-report': { type: 'string' },
      'ebsx-report': { type: 'string' },
      'platform-report': { type: 'string' },
      'central-member-receipt': { type: 'string' },
      label: { type: 'string' }, 'retain-owned': { type: 'boolean' },
      'timeout-ms': { type: 'string' },
    },
  });
  assert.equal(values['execute-owned-backend'], true, 'Explicit owned backend execution required');
  assert.ok(values['run-id'] && values['image-report'] && values['retained-uaa-report']);
  const result = await launchOwnedNativeBackend({
    runId: values['run-id'], imageReportPath: values['image-report'],
    retainedUaaReportPath: values['retained-uaa-report'], label: values.label,
    retainOwned: values['retain-owned'], timeoutMs: values['timeout-ms'] ? Number(values['timeout-ms']) : undefined,
    workflowReportPath: values['workflow-report'],
    ebsxReportPath: values['ebsx-report'],
    platformReportPath: values['platform-report'],
    centralMemberReceiptPath: values['central-member-receipt'],
  });
  console.log(json({ reportPath: result.reportPath, status: result.report.status,
    actualBackendStarted: result.report.actualBackendStarted, nativeAcceptance: false }));
  return result.report.status === 'passed-owned-backend-http-transport-only' ? 0 : 1;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().then(code => { process.exitCode = code; }).catch(() => {
    console.error('Owned backend launch failed; private inputs suppressed.');
    process.exitCode = 1;
  });
}
