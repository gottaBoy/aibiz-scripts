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
import { verifyOwnedBackendImagesReadOnly } from './native-model-design-owned-backend-input.mjs';
import { readOwnedPlatformConfiguration, platformIdentity } from './bootstrap-owned-platform-schema.mjs';
import { ebsxIdentity } from './bootstrap-owned-ebsx-schema.mjs';
import { backendRunCommand, retainedPeerWitness, verifyBackendStartupLog } from './launch-run-owned-native-backend.mjs';
import { javaProperties, parseJavaProperties, privateContainerOrigin, verifyProbeContainer } from './harness-run-owned-uaa-runtime.mjs';
import { ownedPlatformRequest } from './owned-platform-http.mjs';
import { validateDeployment } from './run-owned-native-permission-http.mjs';
import { inspectMysqlFixtureVolumes } from './owned-mysql-volume.mjs';
import { ownedServiceTmpfs } from './owned-backend-resources.mjs';
import { ownedExtensionRoute } from './run-owned-backend-configuration.mjs';

const workspaceDefault = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const toolPath = 'scripts/replace-owned-allinone-extension.mjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const delay = milliseconds => new Promise(done => setTimeout(done, milliseconds));
const owner = 'aibiz.native-fixture.run';
const replacementLabel = 'aibiz.owned-allinone.extension';
const tokenLabel = 'aibiz.owned-allinone.token';
const idPattern = /^[a-f0-9]{64}$/;
const imagePattern = /^sha256:[a-f0-9]{64}$/;
const extensionPath = '/extension/api/internal_messages/fetch_cur_receiver';
const driver = 'com.mysql.jdbc.Driver';

function runIdentity(runId, label) {
  assert.match(runId, /^[a-f0-9]{12}$/);
  assert.match(label, /^[a-z0-9][a-z0-9-]{0,48}$/);
}

export function ownedExtensionProperties(runId, original, platform) {
  const identity = platformIdentity(runId);
  assert.equal(original['server.port'], '30000');
  assert.equal(original['ibiz.servicehub.deploysystems.0'], 'gateway');
  assert.equal(original['ibiz.servicehub.deploysystems.1'], 'ebsx');
  assert.ok(!Object.keys(original).some(key => /^ibiz\.servicehub\.deploysystems\.[2-9][0-9]*$/.test(key)));
  assert.ok(!Object.keys(original).some(key =>
    key.startsWith('ibiz.deploysystems.extension.') || key.startsWith('ibiz.servicehub.datasources.ownedplatform.')));
  assert.equal(platform.url, identity.url);
  assert.equal(platform.username, identity.runtimeUser);
  assert.equal(platform.schema, identity.schema);
  assert.equal(platform.schemaUpdate, false);
  assert.equal(platform.deploySystemId, 'extension');
  assert.equal(platform.runtimeClassName, 'net.ibizsys.central.cloud.saas.extension.runtime.SystemRuntime');
  assert.deepEqual(platform.logicalDatasources, ['DEFAULT']);
  assert.match(platform.password, /^[a-f0-9]{36}$/);
  const ebsx = ebsxIdentity(runId);
  const ebsxUrl = `${ebsx.url}&allowMultiQueries=true`;
  for (const prefix of ['spring.datasource', 'spring.datasource.dynamic.datasource.master',
    'ibiz.servicehub.datasources.ownedebsx']) {
    assert.equal(original[`${prefix}.url`], ebsxUrl);
    assert.equal(original[`${prefix}.username`], ebsx.runtimeUser);
    assert.equal(original[`${prefix}.driver-class-name`], driver);
  }
  assert.equal(original['spring.datasource.defaultSchema'], ebsx.schema);
  assert.equal(original['ibiz.servicehub.datasources.ownedebsx.defaultSchema'], ebsx.schema);
  assert.equal(original['ibiz.servicehub.datasources.ownedebsx.isSyncDBSchema'], 'false');
  for (const link of ['default', 'db2', 'db3']) {
    assert.equal(original[`ibiz.deploysystems.ebsx.settings.sysdbscheme.${link}.datasource`], 'ownedebsx');
  }
  assert.equal(original['ibiz.deploysystems.gateway.settings.sysdbscheme.default.datasource'], 'ownedebsx');
  assert.equal(original['ibiz.deploysystems.ebsx.updatedbschema'], 'false');
  assert.equal(original['ibiz.jwt.signature'], 'MAC');
  assert.match(original['ibiz.jwt.secret'], /^[a-f0-9]{64}$/);
  assert.equal(original['ibiz.deploysystems.gateway.settings.sysutil.uaa.secret'], original['ibiz.jwt.secret']);
  const additions = {
    'ibiz.servicehub.deploysystems.2': 'extension',
    'ibiz.servicehub.datasources.ownedplatform.url': identity.url,
    'ibiz.servicehub.datasources.ownedplatform.username': identity.runtimeUser,
    'ibiz.servicehub.datasources.ownedplatform.password': platform.password,
    'ibiz.servicehub.datasources.ownedplatform.driver-class-name': driver,
    'ibiz.servicehub.datasources.ownedplatform.dbtype': 'MYSQL5',
    'ibiz.servicehub.datasources.ownedplatform.defaultSchema': identity.schema,
    'ibiz.servicehub.datasources.ownedplatform.isSyncDBSchema': 'false',
    'ibiz.deploysystems.extension.deploysystemid': 'extension',
    'ibiz.deploysystems.extension.runtimeclassname': platform.runtimeClassName,
    'ibiz.deploysystems.extension.updatedbschema': 'false',
    'ibiz.deploysystems.extension.extension': 'false',
    'ibiz.deploysystems.extension.enablereload': 'false',
    'ibiz.deploysystems.extension.installdata': 'false',
    'ibiz.deploysystems.extension.settings.sysdbscheme.default.datasource': 'ownedplatform',
  };
  return { properties: { ...original, ...additions }, addedKeys: Object.keys(additions).sort() };
}

export function verifyExtensionPropertiesDelta(runId, original, candidate, platform) {
  const expected = ownedExtensionProperties(runId, original, platform);
  assert.deepEqual(candidate, expected.properties, 'Only the reviewed extension properties may be added');
  for (const [key, value] of Object.entries(original)) assert.equal(candidate[key], value, 'Existing property changed');
  return { addedKeys: expected.addedKeys, existingKeysPreserved: Object.keys(original).length };
}

export function ownedAllinoneAliases(runId, original, peers) {
  const name = original.Name.slice(1);
  assert.match(name, new RegExp(`^nf-${runId}-backend-[a-z0-9][a-z0-9-]{0,48}-allinone$`));
  const networks = Object.values(original.NetworkSettings.Networks);
  assert.equal(networks.length, 1);
  const aliases = [...new Set([name, ...(networks[0].Aliases ?? [])])].sort();
  assert.ok(aliases.every(alias => /^[a-z0-9][a-z0-9_.-]{0,127}$/.test(alias)));
  for (const peer of peers) {
    const names = [peer.Name.slice(1), ...Object.values(peer.NetworkSettings.Networks)
      .flatMap(network => network.Aliases ?? [])];
    assert.ok(aliases.every(alias => !names.includes(alias)), 'Allinone DNS alias conflicts with a protected peer');
  }
  return aliases;
}

export function extensionGatewayRoute(runId, allinoneName) {
  return ownedExtensionRoute(runId, allinoneName);
}

export function verifyExtensionProtectedPeers(before, current) {
  assert.equal(before.length, 7);
  assert.equal(current.length, 7);
  for (const original of before) {
    const actual = current.find(row => row.Id === original.Id);
    assert.equal(actual?.State.Running, true);
    assert.deepEqual(retainedPeerWitness(actual), retainedPeerWitness(original), 'Protected owned peer changed');
  }
}

function immutableOriginal(container) {
  const { startedAt, restartCount, networks, ...immutable } = retainedPeerWitness(container);
  return immutable;
}

export function verifyExtensionCandidate(container, { runId, label, token, imageId, original,
  network, aliases, configPath, loggingPath, expectedId, running = true }) {
  runIdentity(runId, label);
  const name = `nf-${runId}-backend-${label}-allinone`;
  assert.match(container.Id, idPattern);
  if (expectedId) assert.equal(container.Id, expectedId);
  assert.equal(container.Name, `/${name}`);
  assert.equal(container.Image, imageId);
  assert.equal(container.Config.Image, imageId);
  assert.equal(container.Config.Labels?.[owner], runId);
  assert.equal(container.Config.Labels?.['aibiz.native-backend.launch'], label);
  assert.equal(container.Config.Labels?.[replacementLabel], label);
  assert.equal(container.Config.Labels?.[tokenLabel], token);
  assert.equal(container.Config.User, original.Config.User);
  assert.equal(container.Config.Hostname, original.Config.Hostname);
  assert.deepEqual(container.Config.Entrypoint, original.Config.Entrypoint);
  assert.deepEqual(container.Config.Cmd, original.Config.Cmd);
  assert.deepEqual(container.Config.Env, original.Config.Env);
  assert.equal(container.Config.WorkingDir, original.Config.WorkingDir);
  assert.equal(container.HostConfig.Privileged, false);
  assert.equal(container.HostConfig.ReadonlyRootfs, true);
  assert.ok(!container.HostConfig.CapAdd?.length);
  assert.ok(container.HostConfig.SecurityOpt?.includes('no-new-privileges'));
  assert.ok(!container.HostConfig.Binds?.length && !container.HostConfig.VolumesFrom?.length);
  assert.ok(!container.HostConfig.Devices?.length && !container.HostConfig.ExtraHosts?.length);
  assert.ok(!container.HostConfig.PidMode && (!container.HostConfig.IpcMode || container.HostConfig.IpcMode === 'private'));
  assert.equal(container.HostConfig.PublishAllPorts, false);
  assert.ok(Object.values(container.HostConfig.PortBindings ?? {}).every(row => row === null));
  assert.ok(Object.values(container.NetworkSettings.Ports ?? {}).every(row => row === null));
  assert.deepEqual(container.HostConfig.Tmpfs, ownedServiceTmpfs('allinone'));
  const binds = container.Mounts.filter(row => row.Type === 'bind');
  const requiredBinds = [['/app/config/application.properties', configPath], ['/app/config/logback.xml', loggingPath]];
  if (!running && container.State.Running === false && binds.length === 0) {
    const declared = container.HostConfig.Mounts ?? [];
    assert.equal(declared.length, requiredBinds.length);
    assert.deepEqual(declared.map(row => row.Target).sort(), requiredBinds.map(row => row[0]).sort());
    for (const [destination, source] of requiredBinds) {
      const actual = declared.find(row => row.Target === destination);
      assert.equal(actual.Type, 'bind');
      assert.equal(actual.Source, source);
      assert.equal(actual.ReadOnly, true);
    }
  } else {
    assert.deepEqual(binds.map(row => row.Destination).sort(), requiredBinds.map(row => row[0]).sort());
    for (const [destination, source] of requiredBinds) {
      const actual = binds.find(row => row.Destination === destination);
      assert.equal(actual.Source, source);
      assert.equal(actual.RW, false);
    }
  }
  assert.ok(container.Mounts.every(row => row.Type === 'bind'
    || (row.Type === 'tmpfs' && row.Destination === '/tmp')));
  assert.ok(Object.keys(container.NetworkSettings.Networks).every(name => name === network.Name));
  const attachment = container.NetworkSettings.Networks[network.Name];
  if (attachment) {
    assert.equal(attachment.NetworkID, network.Id);
    if (attachment.IPAddress) assert.equal(attachment.IPAddress,
      original.NetworkSettings.Networks[network.Name].IPAddress);
    assert.ok(aliases.every(alias => attachment.Aliases?.includes(alias)));
  }
  if (running) {
    verifyProbeContainer(container, { runId, imageId, networkId: network.Id, networkName: network.Name, name });
    assert.equal(privateContainerOrigin(container, network, 30000),
      `http://${original.NetworkSettings.Networks[network.Name].IPAddress}:30000`);
  }
}

export function extensionReplacementCommand({ runId, label, imageId, network, original, aliases,
  token, cidPath, configPath, loggingPath }) {
  runIdentity(runId, label);
  assert.match(token, /^[a-f0-9]{36}$/);
  assert.match(imageId, imagePattern);
  assert.equal(dirname(cidPath), dirname(dirname(configPath)));
  assert.equal(basename(cidPath), 'allinone.cid');
  assert.ok(!/[,\r\n\0]/.test(cidPath));
  const args = backendRunCommand({
    runId, label, role: 'allinone', imageId, networkName: network.Name,
    name: `nf-${runId}-backend-${label}-allinone`, configPath, loggingPath,
  });
  args[args.indexOf('--network') + 1] = network.Id;
  args.splice(2, 0, '--cidfile', cidPath,
    '--ip', original.NetworkSettings.Networks[network.Name].IPAddress,
    '--hostname', original.Config.Hostname, ...aliases.flatMap(alias => ['--network-alias', alias]),
    '--label', `${replacementLabel}=${label}`, '--label', `${tokenLabel}=${token}`);
  return args;
}

export function extensionDeploymentInput(previous, candidate) {
  assert.match(candidate.Id, idPattern);
  assert.match(candidate.Image, imagePattern);
  assert.notEqual(candidate.Id, previous.services.allinone.containerId);
  const result = structuredClone(previous);
  result.services.allinone = { containerId: candidate.Id, imageId: candidate.Image };
  const actual = structuredClone(result);
  delete actual.services.allinone;
  const expected = structuredClone(previous);
  delete expected.services.allinone;
  assert.deepEqual(actual, expected);
  return result;
}

async function extensionHttp(origin, { method = 'GET', path = '/actuator/health', token, data, organization } = {},
  request = fetch) {
  const response = await request(origin + path, {
    method, redirect: 'manual', signal: AbortSignal.timeout(10_000),
    headers: { accept: 'application/json', 'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}`, srfsystemid: 'ibizmodeling', srforgid: organization } : {}) },
    ...(data === undefined ? {} : { body: JSON.stringify(data) }),
  });
  assert.ok(response.status < 300 || response.status >= 400, 'Owned HTTP redirects are refused');
  const dataBytes = Buffer.from(await response.arrayBuffer());
  assert.ok(dataBytes.length <= 2 * 1024 * 1024);
  const pagination = {};
  for (const [key, header] of [['page', 'x-page'], ['size', 'x-per-page'], ['total', 'x-total']]) {
    const value = response.headers.get(header);
    pagination[key] = value !== null && /^(0|[1-9][0-9]*)$/.test(value) ? Number(value) : null;
  }
  return { status: response.status, bytes: dataBytes.length, sha256: hash(dataBytes),
    jsonType: /^application\/(?:json|[a-z0-9.+-]+\+json)(?:;|$)/i.test(response.headers.get('content-type') ?? ''),
    data: dataBytes.length ? JSON.parse(dataBytes) : null, pagination };
}

export async function replaceOwnedAllinoneExtension({
  workspace = workspaceDefault, runId, deploymentInput, platformReport, imageReport, label,
  allowOwnedAllinoneReplacement = false, timeoutMs = 180_000, stabilityMs = 15_000,
}, {
  execute = spawnSync, openRuntime = ownedNativeRuntimeContext,
  verifyImages = verifyOwnedBackendImagesReadOnly, readPlatform = readOwnedPlatformConfiguration,
  validate = validateDeployment, inspectVolumes = inspectMysqlFixtureVolumes, request = fetch,
  wait = delay, now = Date.now,
} = {}) {
  assert.equal(allowOwnedAllinoneReplacement, true, 'Explicit owned allinone replacement opt-in required');
  runIdentity(runId, label);
  assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs >= 30_000 && timeoutMs <= 300_000);
  assert.ok(Number.isSafeInteger(stabilityMs) && stabilityMs >= 1000 && stabilityMs <= 120_000);
  workspace = resolve(workspace);
  const directories = new PinnedDirectories();
  let context;
  let target;
  let original;
  let network;
  let protectedPeers;
  let expected;
  let candidateId;
  let transitionStarted = false;
  let deployment;
  let lastLog;
  let stage = 'owned-inputs';
  let sequence = 0;
  const output = join(workspace, '.artifacts/native-nonadmin-fixtures', runId, `backend-runtime-${label}`);
  const report = { contract: 'owned-allinone-extension-replacement-v1', runId, label, status: 'running',
    startedAt: new Date().toISOString(), errors: [], checks: [], oldAllinoneStopped: false,
    oldAllinoneDetached: false, oldAllinoneRetainedForRollback: false, rollback: null,
    nativeAcceptance: false, permissionAcceptance: false, sharedServicesChanged: false,
    nacosRoutePublished: false, sourceClosure: false,
    limitations: [
      'Only the owned allinone is replaced. Nacos gateway routing is a separate explicitly authorized operation.',
      'Same model/cache/JWT configuration and protected Redis/ZooKeeper are preserved; process-local and tmpfs caches are rebuilt natively.',
      'Bounded extension read/bootstrap evidence is not complete extension CRUD, multi-role authorization or browser acceptance.',
    ],
    generator: { path: toolPath, sha256: hash(fs.readFileSync(join(workspaceDefault, toolPath))) },
  };
  const docker = (args, { allowFailure = false } = {}) => {
    const result = execute('docker', args, { encoding: 'utf8', timeout: 180_000, maxBuffer: 32 * 1024 * 1024 });
    if (!allowFailure) assert.ok(result.status === 0 && !result.error && !result.signal,
      'Owned extension Docker operation failed; private details suppressed');
    return result;
  };
  const inspect = id => {
    assert.match(id, idPattern);
    const rows = JSON.parse(docker(['inspect', id]).stdout);
    assert.equal(rows.length, 1);
    return rows[0];
  };
  const read = (path, privateInput = false) => {
    const input = readPinnedFile(directories, directories.open(dirname(path)), basename(path));
    if (privateInput) {
      assert.equal(input.identity.uid, process.geteuid());
      assert.equal(input.identity.mode & 0o077, 0);
    }
    return { path, data: input.data, sha256: hash(input.data), bytes: input.data.length };
  };
  const binding = file => ({ path: file.path, sha256: file.sha256, bytes: file.bytes });
  const write = (name, bytes) => directories.write(target, name, bytes);
  const journal = action => write(`transition-${String(++sequence).padStart(2, '0')}.private.json`,
    json({ action, stage, transitionStarted, candidateId: candidateId ?? null, candidate: report.candidate,
      oldAllinone: report.oldAllinone, at: new Date().toISOString() }));
  let boundInputs = [];
  let rollbackInputs = [];
  const inputGuard = ({ rollback = false } = {}) => {
    for (const file of rollback ? rollbackInputs : boundInputs) {
      const current = read(file.path, file.privateInput);
      assert.equal(current.sha256, file.sha256, 'Owned extension input drift');
    }
  };
  const inspectNetwork = () => JSON.parse(docker(['network', 'inspect', network.Id]).stdout)[0];
  const protectedGuard = (ids, { rollback = false } = {}) => {
    inputGuard({ rollback });
    verifyExtensionProtectedPeers(protectedPeers, protectedPeers.map(row => inspect(row.Id)));
    const current = inspectNetwork();
    for (const key of ['Id', 'Name', 'Internal', 'Driver', 'Labels', 'IPAM', 'Options']) {
      assert.deepEqual(current[key], network[key], 'Owned network configuration drift');
    }
    assert.deepEqual(Object.keys(current.Containers).sort(), [...protectedPeers.map(row => row.Id), ...ids].sort());
    return current;
  };
  const fullGuard = () => {
    const currentNetwork = protectedGuard([candidateId]);
    const current = inspect(candidateId);
    verifyExtensionCandidate(current, { ...expected, network: currentNetwork, expectedId: candidateId });
    const containers = [...protectedPeers.map(row => inspect(row.Id)), current];
    const origins = validate(context.manifest, context.resources, deployment, containers, currentNetwork,
      images.report, inspectVolumes(context.resources, { execute }));
    return { containers, network: currentNetwork, origins, current };
  };
  let images;
  let preparedPlatform;
  let originalProperties;
  let candidateProperties;
  const logCheck = phase => {
    const result = docker(['logs', candidateId], { allowFailure: true });
    assert.ok(result.status === 0 && !result.error && !result.signal, 'Owned extension log unavailable');
    const text = `${result.stdout ?? ''}${result.stderr ?? ''}`;
    lastLog = text;
    const checked = verifyBackendStartupLog('allinone', text);
    report.checks.push({ id: `allinone-${phase}-no-fatal-startup`, status: 'pass', ...checked });
    return text;
  };
  try {
    context = openRuntime({ workspace, runId, deploymentInput: resolve(workspace, deploymentInput), execute });
    assert.equal(context.base, dirname(output));
    target = directories.open(output, { create: true, exclusive: true });
    const live = context.guard();
    assert.equal(live.containers.length, 8);
    network = live.network;
    original = live.containers.find(row => row.Id === context.deployment.services.allinone.containerId);
    assert.ok(original);
    protectedPeers = live.containers.filter(row => row.Id !== original.Id);
    assert.equal(protectedPeers.length, 7);
    assert.equal(original.Config.User, '65532:65532');
    assert.equal(original.Config.Image, original.Image);
    assert.match(original.Config.Hostname, /^[a-z0-9][a-z0-9.-]{0,62}$/);
    assert.deepEqual(original.Config.Entrypoint, ['java']);
    assert.deepEqual(original.Config.Cmd, [
      '--add-opens=java.base/java.lang=ALL-UNNAMED',
      '--add-opens=java.base/java.lang.reflect=ALL-UNNAMED', '-Duser.timezone=Asia/Shanghai',
      '-jar', '/ibiz-ebsx-allinone-rt.jar', '--spring.config.location=file:/app/config/application.properties',
    ]);
    assert.deepEqual(original.HostConfig.Tmpfs, ownedServiceTmpfs('allinone'));
    report.inputs = context.bindings;
    boundInputs = context.bindings.map(file => ({ ...file,
      privateInput: ['credentials.private.json', 'owned-resources.json', 'deployment-input.private.json'].includes(basename(file.path)) }));
    rollbackInputs = [...boundInputs];
    imageReport = resolve(workspace, imageReport);
    assert.equal(imageReport, resolve(workspace, context.deployment.imageReceipt.path));
    images = verifyImages({ workspace, reportPath: imageReport, execute });
    assert.equal(images.imageArtifactBindingVerified, true);
    assert.equal(images.verificationMode, 'source-and-recorded-probes-with-live-image-inspection');
    assert.equal(images.reportSha256, context.deployment.imageReceipt.sha256);
    const imageId = images.report.components.find(row => row.name === 'allinone')?.image.id;
    assert.match(imageId, imagePattern);
    assert.equal(original.Image, imageId);
    report.imageReceipt = { path: images.reportPath, sha256: images.reportSha256 };
    report.packageReceipt = images.report.packageReceipt;
    preparedPlatform = readPlatform({ workspace, runId, reportPath: resolve(workspace, platformReport),
      packageReceipt: images.report.packageReceipt });
    const platformFile = read(resolve(workspace, platformReport));
    assert.equal(platformFile.sha256, preparedPlatform.binding.reportSha256);
    report.platformInput = preparedPlatform.binding;
    boundInputs.push({ ...binding(platformFile), privateInput: false });
    const originalMount = destination => {
      const mounts = original.Mounts.filter(row => row.Destination === destination);
      assert.equal(mounts.length, 1);
      assert.equal(mounts[0].Type, 'bind');
      assert.equal(mounts[0].RW, false);
      assert.ok(mounts[0].Source.startsWith(`${context.base}/backend-runtime-`));
      return mounts[0].Source;
    };
    assert.equal(original.Mounts.filter(row => row.Type === 'bind').length, 2);
    const oldConfig = read(originalMount('/app/config/application.properties'));
    const oldLogging = read(originalMount('/app/config/logback.xml'));
    originalProperties = parseJavaProperties(oldConfig.data);
    const uaa = live.containers.find(row => row.Id === context.deployment.services.uaa.containerId);
    const uaaMount = uaa.Mounts.filter(row => row.Destination === '/opt/uaa/config');
    assert.equal(uaaMount.length, 1);
    assert.equal(uaaMount[0].Type, 'bind');
    assert.equal(uaaMount[0].RW, false);
    assert.ok(uaaMount[0].Source.startsWith(`${context.base}/`));
    const uaaConfig = read(join(uaaMount[0].Source, 'application.properties'));
    assert.equal(originalProperties['ibiz.jwt.secret'], parseJavaProperties(uaaConfig.data)['ibiz.jwt.secret'],
      'Allinone and retained UAA JWT secrets must match');
    boundInputs.push(...[oldConfig, oldLogging, uaaConfig].map(file => ({ ...binding(file), privateInput: false })));
    rollbackInputs.push(...[oldConfig, oldLogging, uaaConfig].map(file => ({ ...binding(file), privateInput: false })));
    candidateProperties = ownedExtensionProperties(runId, originalProperties, preparedPlatform.configuration).properties;
    report.configurationDelta = verifyExtensionPropertiesDelta(runId, originalProperties,
      candidateProperties, preparedPlatform.configuration);
    const config = directories.open(join(output, 'allinone-config'), { create: true, exclusive: true });
    directories.write(config, 'application.properties', javaProperties(candidateProperties), 0o644);
    directories.write(config, 'logback.xml', oldLogging.data, 0o644);
    const configPath = join(config.path, 'application.properties');
    const loggingPath = join(config.path, 'logback.xml');
    const newConfig = read(configPath);
    assert.deepEqual(parseJavaProperties(newConfig.data), candidateProperties);
    report.configuration = { original: binding(oldConfig), candidate: binding(newConfig), logging: binding(oldLogging) };
    boundInputs.push(...[newConfig, read(loggingPath)].map(file => ({ ...binding(file), privateInput: false })));
    const aliases = ownedAllinoneAliases(runId, original, protectedPeers);
    const cidPath = join(output, 'allinone.cid');
    assert.ok(!fs.existsSync(cidPath));
    const token = randomBytes(18).toString('hex');
    const name = `nf-${runId}-backend-${label}-allinone`;
    const names = docker(['container', 'ls', '--all', '--format', '{{.Names}}']).stdout.trim().split('\n');
    assert.ok(!names.includes(name), 'Pre-existing allinone candidate cannot be adopted');
    expected = { runId, label, token, imageId, original, aliases, configPath, loggingPath };
    const command = extensionReplacementCommand({ ...expected, network, cidPath });
    report.candidate = { name, imageId, token, cidPath, preAbsent: true };
    report.oldAllinone = { id: original.Id, imageId: original.Image, name: original.Name,
      origin: privateContainerOrigin(original, network, 30000), immutableSha256: hash(json(immutableOriginal(original))) };
    report.preservedAliases = aliases;
    report.gatewayRouteCandidate = extensionGatewayRoute(runId, original.Name.slice(1));
    write('gateway-extension-route.candidate.json', json(report.gatewayRouteCandidate));
    const priorDirectory = directories.open(dirname(resolve(workspace, deploymentInput)));
    let nacosRows;
    for (const name of ['nacos-configs.private.json']) {
      const file = readPinnedFile(directories, priorDirectory, name);
      nacosRows = JSON.parse(file.data);
      directories.write(target, name, file.data);
      boundInputs.push({ path: join(priorDirectory.path, name), sha256: hash(file.data),
        bytes: file.data.length, privateInput: true });
    }
    const priorReport = JSON.parse(read(join(priorDirectory.path, 'report.json')).data);
    assert.ok(Array.isArray(nacosRows) && nacosRows.length > 0);
    assert.ok(Array.isArray(priorReport.nacosConfigurationBindings));
    for (const row of nacosRows) {
      assert.equal(row.group, `nf_${runId}`);
      const expected = priorReport.nacosConfigurationBindings.filter(binding => binding.dataId === row.dataId
        && binding.group === row.group);
      assert.equal(expected.length, 1);
      assert.equal(expected[0].sha256, hash(row.content));
      if (expected[0].bytes !== undefined) assert.equal(expected[0].bytes, Buffer.byteLength(row.content));
    }
    report.nacosConfigurationBindings = priorReport.nacosConfigurationBindings;
    report.nacosSnapshotCopiedNotRepublished = true;
    stage = 'allinone-transition';
    inputGuard();
    context.guard();
    journal('before-original-stop');
    transitionStarted = true;
    docker(['stop', '--time', '30', original.Id]);
    report.oldAllinoneStopped = true;
    journal('before-original-detach');
    docker(['network', 'disconnect', network.Id, original.Id]);
    report.oldAllinoneDetached = true;
    protectedGuard([]);
    journal('before-candidate-create');
    let result;
    try { result = docker(command, { allowFailure: true }); }
    finally {
      if (fs.existsSync(cidPath)) {
        const id = read(cidPath).data.toString('utf8').trim();
        assert.match(id, idPattern);
        candidateId = id;
        report.candidate.id = id;
      }
    }
    assert.ok(result.status === 0 && !result.error && !result.signal, 'Owned allinone start failed');
    assert.match(candidateId ?? '', idPattern);
    assert.equal(result.stdout.trim(), candidateId);
    const first = inspect(candidateId);
    deployment = extensionDeploymentInput(context.deployment, first);
    stage = 'allinone-readiness';
    const deadline = now() + timeoutMs;
    let ready = false;
    while (now() < deadline) {
      fullGuard();
      try {
        const response = await extensionHttp(report.oldAllinone.origin, {}, request);
        if ([200, 401, 404].includes(response.status)) { ready = true; break; }
      } catch {}
      await wait(1000);
    }
    assert.equal(ready, true, 'Owned allinone HTTP readiness timed out');
    logCheck('after-http');
    const stableStart = now();
    const until = stableStart + stabilityMs;
    report.stability = { requestedMs: stabilityMs, samples: 0, observedMs: 0 };
    while (now() < until) {
      fullGuard();
      logCheck('stability');
      report.stability.samples++;
      await wait(Math.min(1000, until - now()));
    }
    report.stability.observedMs = now() - stableStart;
    assert.ok(report.stability.samples > 0 && report.stability.observedMs >= stabilityMs);
    stage = 'native-extension-read';
    fullGuard();
    const denied = await extensionHttp(report.oldAllinone.origin, {
      method: 'POST', path: extensionPath, data: { page: 0, size: 1, sort: 'timestamp,desc' },
    }, request);
    assert.ok([401, 403].includes(denied.status), 'Anonymous native extension must be denied');
    report.checks.push({ id: 'extension-anonymous-denied', status: 'pass',
      httpStatus: denied.status, responseSha256: denied.sha256 });
    for (const user of context.manifest.users) {
      const login = await ownedPlatformRequest({ ...context, guard: fullGuard }, {
        peer: 'backend', path: '/v7/login', method: 'POST',
        data: { loginname: user.loginname, password: context.credentials.users[user.loginname] },
      }, { fetchImplementation: request });
      assert.equal(login.error, null);
      assert.equal(login.status, 200);
      assert.match(login.data?.token ?? '', /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
      fullGuard();
      const response = await extensionHttp(report.oldAllinone.origin, { method: 'POST', path: extensionPath,
        token: login.data.token, organization: `${user.centerId}_org`,
        data: { page: 0, size: 1, sort: 'timestamp,desc' } }, request);
      assert.equal(response.status, 200);
      assert.equal(response.jsonType, true);
      assert.ok(Array.isArray(response.data) && response.data.length <= 1);
      assert.equal(response.pagination.page, 0);
      assert.equal(response.pagination.size, 1);
      assert.ok(Number.isSafeInteger(response.pagination.total) && response.pagination.total >= response.data.length);
      report.checks.push({ id: `${user.loginname}-native-extension-read`, status: 'pass',
        httpStatus: response.status, responseSha256: response.sha256, pagination: response.pagination });
    }
    stage = 'final-bindings';
    assert.deepEqual(verifyImages({ workspace, reportPath: imageReport, execute }), images);
    assert.deepEqual(readPlatform({ workspace, runId, reportPath: resolve(workspace, platformReport),
      packageReceipt: images.report.packageReceipt }), preparedPlatform);
    fullGuard();
    logCheck('final');
    write('deployment-input.private.json', json(deployment));
    report.deploymentInput = { path: join(output, 'deployment-input.private.json'), sha256: hash(json(deployment)) };
    report.protectedPeersUnchanged = true;
    report.oldAllinoneRetainedForRollback = true;
    report.boundedExtensionReadAcceptance = true;
    report.status = 'passed-owned-allinone-extension-runtime-only';
  } catch (error) {
    report.status = 'failed-owned-allinone-extension-replacement';
    report.errors.push(`Owned allinone extension refused at ${stage}; private details suppressed`);
    if (target) {
      try { write('failure.private.log', `${error.stack ?? error.message}\n`); }
      catch { report.errors.push('Private failure log could not be written'); }
    }
    if (transitionStarted) {
      try {
        inputGuard({ rollback: true });
        const rollbackJournal = action => {
          try { journal(action); }
          catch { report.errors.push('Private rollback journal could not be written'); }
        };
        const old = inspect(original.Id);
        assert.deepEqual(immutableOriginal(old), immutableOriginal(original), 'Original allinone identity/configuration drift');
        assert.ok(Object.keys(old.NetworkSettings.Networks).every(name => name === network.Name));
        const lookup = candidateId ?? report.candidate.name;
        const found = docker(['container', 'inspect', lookup], { allowFailure: true });
        let candidate;
        if (found.status === 0 && !found.error && !found.signal) {
          const rows = JSON.parse(found.stdout);
          assert.equal(rows.length, 1);
          candidate = rows[0];
          verifyExtensionCandidate(candidate, { ...expected, network: inspectNetwork(), expectedId: candidateId, running: false });
          candidateId = candidate.Id;
          report.candidate.id = candidateId;
        } else {
          const names = docker(['container', 'ls', '--all', '--format', '{{.Names}}']).stdout.trim().split('\n');
          assert.ok(!names.includes(report.candidate.name), 'Candidate absence was not proven');
        }
        let net = inspectNetwork();
        protectedGuard([original.Id, candidateId].filter(id => id && Object.hasOwn(net.Containers, id)), { rollback: true });
        if (candidate) {
          const log = docker(['logs', candidateId], { allowFailure: true });
          lastLog = `${log.stdout ?? ''}${log.stderr ?? ''}`;
          rollbackJournal('before-candidate-rollback-removal');
          docker(['rm', '--force', candidateId]);
        }
        const current = inspect(original.Id);
        if (Object.hasOwn(current.NetworkSettings.Networks, network.Name)) {
          docker(['network', 'disconnect', network.Id, original.Id]);
        }
        protectedGuard([], { rollback: true });
        rollbackJournal('before-original-network-restore');
        docker(['network', 'connect', '--ip', original.NetworkSettings.Networks[network.Name].IPAddress,
          ...expected.aliases.flatMap(alias => ['--alias', alias]), network.Id, original.Id]);
        if (!inspect(original.Id).State.Running) docker(['start', original.Id]);
        net = protectedGuard([original.Id], { rollback: true });
        const restored = inspect(original.Id);
        assert.deepEqual(immutableOriginal(restored), immutableOriginal(original));
        assert.equal(restored.State.Running, true);
        assert.equal(privateContainerOrigin(restored, net, 30000), report.oldAllinone.origin);
        let recovered = false;
        const deadline = now() + timeoutMs;
        while (now() < deadline) {
          const currentNetwork = protectedGuard([original.Id], { rollback: true });
          const current = inspect(original.Id);
          assert.deepEqual(immutableOriginal(current), immutableOriginal(original));
          assert.equal(current.State.Running, true);
          assert.equal(privateContainerOrigin(current, currentNetwork, 30000), report.oldAllinone.origin);
          try {
            const health = await extensionHttp(report.oldAllinone.origin, {}, request);
            const result = docker(['logs', original.Id], { allowFailure: true });
            assert.ok(result.status === 0 && !result.error && !result.signal);
            verifyBackendStartupLog('allinone', `${result.stdout ?? ''}${result.stderr ?? ''}`);
            if ([200, 401, 404].includes(health.status)) { recovered = true; break; }
          } catch {}
          await wait(1000);
        }
        assert.equal(recovered, true, 'Original allinone did not regain non-fatal HTTP readiness');
        report.rollback = 'original-owned-allinone-restored';
      } catch {
        report.rollback = 'failed-manual-owned-recovery-required';
        report.errors.push('Exact owned allinone rollback refused or failed; protected peers were not modified');
      }
    }
  } finally {
    try {
      if (target) {
        if (lastLog !== undefined) {
          try { write('allinone.private.log', lastLog); }
          catch { report.errors.push('Private allinone log could not be written'); }
        }
        report.completedAt = new Date().toISOString();
        write('report.json', json(report));
      }
    } finally {
      try { context?.close(); }
      finally { directories.close(); }
    }
  }
  return { reportPath: target ? join(output, 'report.json') : null, report };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: {
      'replace-owned-allinone-extension': { type: 'boolean' }, 'run-id': { type: 'string' },
      'deployment-input': { type: 'string' }, 'platform-report': { type: 'string' },
      'image-report': { type: 'string' }, label: { type: 'string' },
    } });
    const result = await replaceOwnedAllinoneExtension({
      runId: values['run-id'], deploymentInput: values['deployment-input'],
      platformReport: values['platform-report'], imageReport: values['image-report'], label: values.label,
      allowOwnedAllinoneReplacement: values['replace-owned-allinone-extension'],
    });
    console.log(json({ reportPath: result.reportPath, status: result.report.status,
      protectedPeersUnchanged: result.report.protectedPeersUnchanged ?? false,
      boundedExtensionReadAcceptance: result.report.boundedExtensionReadAcceptance ?? false,
      nacosRoutePublished: false, rollback: result.report.rollback }));
    process.exitCode = result.report.status.startsWith('passed-') ? 0 : 1;
  } catch {
    console.error('Owned allinone extension replacement refused; private details suppressed');
    process.exitCode = 1;
  }
}
