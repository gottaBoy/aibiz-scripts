import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import {
  ownedExtensionProperties, verifyExtensionPropertiesDelta, ownedAllinoneAliases, extensionGatewayRoute,
  verifyExtensionProtectedPeers, verifyExtensionCandidate, extensionReplacementCommand,
  extensionDeploymentInput, replaceOwnedAllinoneExtension,
} from '../replace-owned-allinone-extension.mjs';
import { ebsxIdentity } from '../bootstrap-owned-ebsx-schema.mjs';
import { platformIdentity } from '../bootstrap-owned-platform-schema.mjs';
import { javaProperties } from '../harness-run-owned-uaa-runtime.mjs';
import { ownedServiceTmpfs } from '../owned-backend-resources.mjs';
import { retainedPeerWitness } from '../launch-run-owned-native-backend.mjs';

const runId = '123456789abc';
const owner = 'aibiz.native-fixture.run';
const id = number => number.toString(16).padStart(64, '0');
const image = number => `sha256:${id(number)}`;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const secret = 'f'.repeat(64);
const token = 'header.payload.signature';

function propertiesFixture() {
  const ebsx = ebsxIdentity(runId);
  const original = {
    'server.port': '30000', 'ibiz.servicehub.deploysystems.0': 'gateway',
    'ibiz.servicehub.deploysystems.1': 'ebsx', 'ibiz.jwt.signature': 'MAC',
    'ibiz.jwt.secret': secret, 'ibiz.deploysystems.gateway.settings.sysutil.uaa.secret': secret,
    'ibiz.deploysystems.ebsx.updatedbschema': 'false',
    'ibiz.deploysystems.gateway.settings.sysdbscheme.default.datasource': 'ownedebsx',
    'spring.datasource.defaultSchema': ebsx.schema,
    'ibiz.servicehub.datasources.ownedebsx.defaultSchema': ebsx.schema,
    'ibiz.servicehub.datasources.ownedebsx.isSyncDBSchema': 'false',
    'ibiz.cacheLevel': 'L2', 'ibiz.servicehub.filefolder': '/tmp/allinone/datafile',
    'ibiz.servicehub.tempfolder': '/tmp/allinone/tempfile',
    'ibiz.servicehub.datasources.ownedworkflow.url': `jdbc:mysql://nf-${runId}-mysql:3306/nf_${runId}_workflow`,
    'unrelated.setting': 'preserved',
  };
  for (const prefix of ['spring.datasource', 'spring.datasource.dynamic.datasource.master',
    'ibiz.servicehub.datasources.ownedebsx']) {
    Object.assign(original, {
      [`${prefix}.url`]: `${ebsx.url}&allowMultiQueries=true`, [`${prefix}.username`]: ebsx.runtimeUser,
      [`${prefix}.password`]: 'owned-ebsx-password', [`${prefix}.driver-class-name`]: 'com.mysql.jdbc.Driver',
    });
  }
  for (const link of ['default', 'db2', 'db3']) {
    original[`ibiz.deploysystems.ebsx.settings.sysdbscheme.${link}.datasource`] = 'ownedebsx';
  }
  const identity = platformIdentity(runId);
  const platform = { url: identity.url, username: identity.runtimeUser, password: 'a'.repeat(36),
    schema: identity.schema, schemaUpdate: false, deploySystemId: 'extension',
    runtimeClassName: 'net.ibizsys.central.cloud.saas.extension.runtime.SystemRuntime',
    logicalDatasources: ['DEFAULT'] };
  return { original, platform };
}

test('extension configuration adds only the real owned datasource/deploysystem and preserves every original key', () => {
  const f = propertiesFixture();
  const result = ownedExtensionProperties(runId, f.original, f.platform);
  assert.equal(result.addedKeys.length, 15);
  assert.equal(result.properties['ibiz.servicehub.deploysystems.2'], 'extension');
  assert.equal(result.properties['ibiz.deploysystems.extension.updatedbschema'], 'false');
  assert.equal(result.properties['ibiz.deploysystems.extension.installdata'], 'false');
  verifyExtensionPropertiesDelta(runId, f.original, result.properties, f.platform);
  for (const key of ['ibiz.jwt.secret', 'spring.datasource.url',
    'ibiz.servicehub.datasources.ownedebsx.url', 'ibiz.servicehub.datasources.ownedworkflow.url',
    'ibiz.cacheLevel', 'ibiz.servicehub.filefolder']) {
    const altered = structuredClone(result.properties);
    altered[key] = 'changed';
    assert.throws(() => verifyExtensionPropertiesDelta(runId, f.original, altered, f.platform));
  }
  const extra = { ...result.properties, 'ibiz.deploysystems.extension.settings.extra': 'unreviewed' };
  assert.throws(() => verifyExtensionPropertiesDelta(runId, f.original, extra, f.platform));
});

test('configuration rejects shared schema, runtime DDL, foreign credentials and an already configured extension', () => {
  for (const change of [
    f => { f.platform.url = 'jdbc:mysql://shared:3306/shared'; },
    f => { f.platform.schemaUpdate = true; },
    f => { f.platform.username = 'root'; },
    f => { f.platform.runtimeClassName = 'FakeExtension'; },
    f => { f.original['spring.datasource.username'] = 'root'; },
    f => { f.original['ibiz.servicehub.deploysystems.2'] = 'extension'; },
    f => { f.original['ibiz.deploysystems.extension.deploysystemid'] = 'extension'; },
  ]) {
    const f = propertiesFixture();
    change(f);
    assert.throws(() => ownedExtensionProperties(runId, f.original, f.platform));
  }
});

function fixture(t) {
  const workspace = fs.mkdtempSync(join(os.tmpdir(), 'replace-owned-extension-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const base = join(workspace, '.artifacts/native-nonadmin-fixtures', runId);
  const basis = join(base, 'backend-runtime-basis');
  const uaaConfigPath = join(base, 'backend-runtime-uaa-retained/config');
  const write = (path, value, mode = 0o600) => {
    fs.mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    const bytes = Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
    fs.writeFileSync(path, bytes, { mode });
    return { path, bytes: bytes.length, sha256: hash(bytes) };
  };
  const { original: originalProperties, platform } = propertiesFixture();
  const configPath = join(basis, 'allinone-config/application.properties');
  const loggingPath = join(basis, 'allinone-config/logback.xml');
  write(configPath, javaProperties(originalProperties));
  write(loggingPath, '<configuration/>');
  write(join(uaaConfigPath, 'application.properties'), javaProperties({ 'ibiz.jwt.secret': secret }));
  const network = { Id: id(100), Name: `nf-${runId}-private`, Internal: true, Driver: 'bridge',
    Labels: { [owner]: runId }, IPAM: { Config: [{ Subnet: '10.91.0.0/24', Gateway: '10.91.0.1' }] },
    Options: {}, Containers: {} };
  const containers = new Map();
  const roles = ['mysql', 'uaa', 'redis', 'nacos', 'zookeeper', 'allinone', 'provider', 'gateway'];
  const command = [
    '--add-opens=java.base/java.lang=ALL-UNNAMED',
    '--add-opens=java.base/java.lang.reflect=ALL-UNNAMED', '-Duser.timezone=Asia/Shanghai',
    '-jar', '/ibiz-ebsx-allinone-rt.jar', '--spring.config.location=file:/app/config/application.properties',
  ];
  const attach = (container, address, aliases = null) => {
    const endpointId = hash(container.Id + address + JSON.stringify(aliases));
    container.NetworkSettings.Networks = {
      [network.Name]: { NetworkID: network.Id, EndpointID: endpointId, IPAddress: address,
        IPPrefixLen: 24, Gateway: '10.91.0.1', Aliases: aliases },
    };
    network.Containers[container.Id] = { Name: container.Name.slice(1), EndpointID: endpointId,
      IPv4Address: `${address}/24` };
  };
  for (const [index, role] of roles.entries()) {
    const container = {
      Id: id(index + 1), Image: image(index + 1),
      Name: role === 'allinone' ? `/nf-${runId}-backend-basis-allinone` : `/nf-${runId}-${role}-retained`,
      State: { Running: true, StartedAt: '2026-11-08T01:00:00Z' }, RestartCount: 0,
      Config: { Image: image(index + 1), User: '65532:65532', Hostname: `host${index}`,
        Entrypoint: role === 'allinone' ? ['java'] : ['/start'],
        Cmd: role === 'allinone' ? command : [], Env: ['JAVA_TOOL_OPTIONS=owned', 'PATH=/bin'],
        WorkingDir: '/tmp', Labels: { [owner]: runId, 'aibiz.native-backend.launch': 'basis' } },
      HostConfig: { Privileged: false, ReadonlyRootfs: true, CapAdd: null,
        SecurityOpt: ['no-new-privileges'], Binds: null, VolumesFrom: null, Devices: [],
        ExtraHosts: null, PidMode: '', IpcMode: 'private', PublishAllPorts: false,
        PortBindings: {}, Tmpfs: ownedServiceTmpfs('allinone'), NetworkMode: network.Name },
      Mounts: [], NetworkSettings: { Networks: {}, Ports: {} },
    };
    if (role === 'allinone') {
      container.Mounts = [
        { Type: 'bind', Source: configPath, Destination: '/app/config/application.properties', RW: false },
        { Type: 'bind', Source: loggingPath, Destination: '/app/config/logback.xml', RW: false },
      ];
    }
    if (role === 'uaa') container.Mounts = [
      { Type: 'bind', Source: uaaConfigPath, Destination: '/opt/uaa/config', RW: false },
    ];
    attach(container, `10.91.0.${index + 2}`);
    containers.set(container.Id, container);
  }
  const original = structuredClone(containers.get(id(6)));
  const users = ['a', 'b'].flatMap(side => ['e', 'v', 'n'].map(role => ({
    loginname: `nf_${runId}_${side}_${role}`, centerId: `nf_${runId}_center_${side}`,
  })));
  const manifest = { runId, users, schemas: { uaa: `nf_${runId}_uaa` } };
  const resources = { runId, mysqlId: id(1), mysqlImage: image(1), networkId: network.Id,
    networkName: network.Name, mysqlName: `nf-${runId}-mysql`, schemas: manifest.schemas };
  const credentials = { users: Object.fromEntries(users.map(user => [user.loginname, 'private-password'])) };
  const packageReceipt = write(join(workspace, '.artifacts/package/report.json'), { source: 'controlled-package' });
  const imageReport = join(workspace, '.artifacts/images/report.json');
  const imageData = { contract: 'isolated-backend-source-images-v1', status: 'passed-image-artifact-binding-only',
    imageArtifactBindingVerified: true, packageReceipt: { path: packageReceipt.path, sha256: packageReceipt.sha256 },
    components: ['allinone', 'provider', 'gateway'].map(role => ({
      name: role, image: { id: containers.get(id(roles.indexOf(role) + 1)).Image },
    })) };
  const imageBinding = write(imageReport, imageData);
  const endpoint = (role, port) => {
    const container = [...containers.values()].find(row => row.Name.includes(role));
    const attachment = container.NetworkSettings.Networks[network.Name];
    return { transport: 'private-inspected-ipv4', service: role, containerPort: port, containerId: container.Id,
      networkId: network.Id, endpointId: attachment.EndpointID, ipv4: attachment.IPAddress };
  };
  const deployment = { contract: 'run-owned-native-permission-deployment-input-v2', runId,
    imageReceipt: { path: imageReport, sha256: imageBinding.sha256 },
    services: Object.fromEntries(['allinone', 'provider', 'gateway', 'uaa'].map(role => {
      const container = containers.get(id(roles.indexOf(role) + 1));
      return [role, { containerId: container.Id, imageId: container.Image }];
    })),
    auxiliaryContainers: ['redis', 'nacos', 'zookeeper'].map(role => {
      const container = containers.get(id(roles.indexOf(role) + 1));
      return { role, containerId: container.Id, imageId: container.Image };
    }), endpoints: { uaa: endpoint('uaa', 32666), backend: endpoint('gateway', 30086) } };
  const deploymentInput = join(basis, 'deployment-input.private.json');
  const bindings = [write(join(base, 'manifest.json'), manifest), write(join(base, 'owned-resources.json'), resources),
    write(join(base, 'credentials.private.json'), credentials), write(deploymentInput, deployment), imageBinding];
  const nacos = [{ dataId: 'appgateway-default', group: `nf_${runId}`, content: '---\n{"routes":[]}\n' }];
  write(join(basis, 'nacos-configs.private.json'), nacos);
  write(join(basis, 'report.json'), { nacosConfigurationBindings: nacos.map(row => ({
    dataId: row.dataId, group: row.group, bytes: Buffer.byteLength(row.content), sha256: hash(row.content),
  })) });
  const platformReport = join(base, 'platform-schema-unit/report.json');
  const platformFile = write(platformReport, { status: 'passed-owned-native-platform-schema-only' });
  const platformInput = { configuration: platform,
    binding: { reportPath: platformReport, reportSha256: platformFile.sha256, configurationSha256: id(800) } };
  const images = { reportPath: imageReport, reportSha256: imageBinding.sha256, report: imageData,
    imageArtifactBindingVerified: true, verificationMode: 'source-and-recorded-probes-with-live-image-inspection' };
  const state = { workspace, base, deploymentInput, platformReport, imageReport, original, network,
    containers, users, credentials, commands: [], removed: [], stopped: [], started: [], closed: 0,
    time: 0, candidateId: id(9), logs: 'Started EBSXAllInOneApplication\n', requestPaths: [] };
  const result = stdout => ({ status: 0, stdout, stderr: '', error: null, signal: null });
  const failure = () => ({ status: 1, stdout: '', stderr: 'Injected failure', error: null, signal: null });
  const docker = (_program, args) => {
    state.commands.push(args);
    state.beforeDocker?.(args);
    if (args[0] === 'inspect') {
      const row = containers.get(args[1]);
      return row ? result(JSON.stringify([row])) : failure();
    }
    if (args[0] === 'network' && args[1] === 'inspect') return result(JSON.stringify([network]));
    if (args[0] === 'container' && args[1] === 'ls') {
      return result([...containers.values()].map(row => row.Name.slice(1)).join('\n'));
    }
    if (args[0] === 'container' && args[1] === 'inspect') {
      const row = containers.get(args[2]) ?? [...containers.values()].find(row => row.Name === `/${args[2]}`);
      return row ? result(JSON.stringify([row])) : { ...failure(), stdout: '[]' };
    }
    if (args[0] === 'stop') {
      assert.equal(args.at(-1), original.Id);
      containers.get(original.Id).State.Running = false;
      state.stopped.push(original.Id);
      if (state.stopFailure) { state.stopFailure = false; return failure(); }
      return result(original.Id);
    }
    if (args[0] === 'network' && args[1] === 'disconnect') {
      const row = containers.get(args.at(-1));
      delete row.NetworkSettings.Networks[network.Name];
      delete network.Containers[row.Id];
      if (state.detachFailure) { state.detachFailure = false; return failure(); }
      return result('');
    }
    if (args[0] === 'run') {
      const name = args[args.indexOf('--name') + 1];
      const candidate = structuredClone(original);
      candidate.Id = state.candidateId;
      candidate.Name = `/${name}`;
      candidate.Config.Image = image(6);
      candidate.Config.Hostname = args[args.indexOf('--hostname') + 1];
      candidate.HostConfig.NetworkMode = network.Id;
      for (let index = 0; index < args.length; index++) {
        if (args[index] === '--label') {
          const [key, ...parts] = args[++index].split('=');
          candidate.Config.Labels[key] = parts.join('=');
        }
      }
      candidate.Mounts = [];
      const aliases = [];
      for (let index = 0; index < args.length; index++) {
        if (args[index] === '--mount') {
          const mount = Object.fromEntries(args[++index].split(',').filter(part => part.includes('='))
            .map(part => part.split('=')));
          candidate.Mounts.push({ Type: 'bind', Source: mount.src, Destination: mount.dst, RW: false });
        }
        if (args[index] === '--network-alias') aliases.push(args[++index]);
      }
      candidate.State = { Running: true, StartedAt: '2026-11-08T02:00:00Z' };
      attach(candidate, args[args.indexOf('--ip') + 1], aliases);
      containers.set(candidate.Id, candidate);
      state.created = candidate;
      if (state.createdNotStarted) {
        candidate.State.Running = false;
        candidate.HostConfig.Mounts = candidate.Mounts.map(mount => ({
          Type: 'bind', Source: mount.Source, Target: mount.Destination, ReadOnly: true,
        }));
        candidate.Mounts = [];
        candidate.NetworkSettings.Networks = {};
        delete network.Containers[candidate.Id];
      }
      if (state.foreignCandidate) candidate.Config.Labels['aibiz.owned-allinone.token'] = 'foreign';
      if (!state.skipCid) fs.writeFileSync(args[args.indexOf('--cidfile') + 1], candidate.Id);
      state.afterCreate?.(candidate);
      return state.runFailure || state.foreignCandidate ? failure() : result(candidate.Id);
    }
    if (args[0] === 'logs') return result(args[1] === original.Id ? 'Started original allinone\n' : state.logs);
    if (args[0] === 'rm') {
      assert.equal(args[2], state.candidateId);
      state.removed.push(args[2]);
      delete network.Containers[args[2]];
      containers.delete(args[2]);
      return result(args[2]);
    }
    if (args[0] === 'network' && args[1] === 'connect') {
      const row = containers.get(args.at(-1));
      assert.equal(row.Id, original.Id);
      const aliases = [];
      for (let index = 0; index < args.length; index++) if (args[index] === '--alias') aliases.push(args[++index]);
      attach(row, args[args.indexOf('--ip') + 1], aliases);
      return result('');
    }
    if (args[0] === 'start') {
      assert.equal(args[1], original.Id);
      containers.get(original.Id).State.Running = true;
      state.started.push(original.Id);
      return result(original.Id);
    }
    throw new Error(`Unexpected fake Docker operation: ${args[0]}`);
  };
  const origins = { uaa: 'http://10.91.0.3:32666', backend: 'http://10.91.0.9:30086' };
  const context = { base, manifest, resources, deployment, credentials, bindings,
    close: () => { state.closed++; } };
  context.guard = () => {
    assert.equal(Object.keys(network.Containers).length, 8);
    assert.equal(containers.get(original.Id).State.Running, true);
    return { containers: Object.keys(network.Containers).map(key => structuredClone(containers.get(key))),
      network: structuredClone(network), origins };
  };
  const request = async (url, options) => {
    const path = new URL(url).pathname;
    state.requestPaths.push(path);
    state.onRequest?.(path, options);
    const headers = { 'content-type': 'application/json' };
    if (path === '/actuator/health') return new Response('{"status":"UP"}', { status: 200, headers });
    if (path === '/v7/login') return new Response(JSON.stringify({ token }), { status: 200, headers });
    if (path === '/extension/api/internal_messages/fetch_cur_receiver') {
      if (!options.headers.authorization) return new Response('{"status":401}', { status: 401, headers });
      return new Response('[]', { status: state.extensionFailure ? 500 : 200,
        headers: { ...headers, 'x-page': '0', 'x-per-page': '1', 'x-total': '0' } });
    }
    throw new Error('Unexpected owned HTTP path');
  };
  const adapters = { execute: docker, openRuntime: () => context,
    verifyImages: () => structuredClone(images), readPlatform: () => structuredClone(platformInput),
    validate: () => origins, inspectVolumes: () => [], request,
    wait: async milliseconds => { state.time += milliseconds; }, now: () => state.time };
  state.options = { workspace, runId, deploymentInput, platformReport, imageReport, label: 'extension-unit',
    allowOwnedAllinoneReplacement: true, timeoutMs: 30_000, stabilityMs: 1000 };
  state.adapters = adapters;
  state.launch = () => replaceOwnedAllinoneExtension(state.options, adapters);
  return state;
}

test('reviewed replacement preserves seven peers, actual IP/DNS aliases and source settings, retaining old allinone for rollback', async t => {
  const f = fixture(t);
  const protectedBefore = [...f.containers.values()].filter(row => row.Id !== f.original.Id).map(retainedPeerWitness);
  const output = await f.launch();
  assert.equal(output.report.status, 'passed-owned-allinone-extension-runtime-only');
  assert.equal(output.report.protectedPeersUnchanged, true);
  assert.equal(output.report.oldAllinoneRetainedForRollback, true);
  assert.equal(output.report.nacosRoutePublished, false);
  assert.equal(output.report.nativeAcceptance, false);
  assert.equal(output.report.checks.filter(row => row.id.endsWith('-native-extension-read')).length, 6);
  assert.equal(f.containers.get(f.original.Id).State.Running, false);
  assert.deepEqual(f.containers.get(f.original.Id).NetworkSettings.Networks, {});
  assert.equal(Object.keys(f.network.Containers).length, 8);
  assert.ok(f.created.NetworkSettings.Networks[f.network.Name].Aliases.includes(f.original.Name.slice(1)));
  assert.deepEqual([...f.containers.values()].filter(row => row.Id !== f.original.Id && row.Id !== f.candidateId)
    .map(retainedPeerWitness), protectedBefore);
  const deployment = JSON.parse(fs.readFileSync(join(dirname(output.reportPath), 'deployment-input.private.json')));
  assert.equal(deployment.services.allinone.containerId, f.candidateId);
  assert.equal(deployment.services.uaa.containerId, id(2));
  assert.equal(deployment.endpoints.backend.containerId, id(8));
  assert.ok(!f.commands.some(args => args[0] === 'exec' || args[0] === 'restart'));
  assert.ok(!JSON.stringify(output.report).includes(secret));
  assert.equal(f.closed, 1);
});

test('start/stop/detach partial failures restore only the original owned allinone and do not stop protected peers', async t => {
  for (const mode of ['stopFailure', 'detachFailure', 'runFailure', 'missing-cid', 'created-not-started']) {
    const f = fixture(t);
    if (mode === 'missing-cid') { f.skipCid = true; f.runFailure = true; }
    else if (mode === 'created-not-started') { f.createdNotStarted = true; f.runFailure = true; f.skipCid = true; }
    else f[mode] = true;
    const output = await f.launch();
    assert.equal(output.report.status, 'failed-owned-allinone-extension-replacement');
    assert.equal(output.report.rollback, 'original-owned-allinone-restored', mode);
    assert.ok(f.containers.get(f.original.Id).State.Running);
    assert.equal(Object.keys(f.network.Containers).length, 8);
    assert.ok(f.stopped.every(id => id === f.original.Id));
    assert.ok(f.started.every(id => id === f.original.Id));
    assert.equal(f.closed, 1);
  }
});

test('a foreign same-name/image/run-label candidate is not deleted during partial-create recovery', async t => {
  const f = fixture(t);
  f.foreignCandidate = true;
  f.skipCid = true;
  const output = await f.launch();
  assert.equal(output.report.status, 'failed-owned-allinone-extension-replacement');
  assert.equal(output.report.rollback, 'failed-manual-owned-recovery-required');
  assert.deepEqual(f.removed, []);
  assert.ok(f.containers.has(f.candidateId));
  assert.equal(f.closed, 1);
});

test('fatal initialization or native extension failure rolls back instead of accepting an open HTTP port', async t => {
  for (const mode of ['fatal', 'extension']) {
    const f = fixture(t);
    if (mode === 'fatal') f.logs = 'Application run failed\n';
    else f.extensionFailure = true;
    const output = await f.launch();
    assert.equal(output.report.status, 'failed-owned-allinone-extension-replacement');
    assert.equal(output.report.rollback, 'original-owned-allinone-restored');
    assert.deepEqual(f.removed, [f.candidateId]);
  }
});

test('protected peer lifecycle drift refuses both acceptance and unsafe rollback mutation', async t => {
  const f = fixture(t);
  f.afterCreate = () => { f.containers.get(id(7)).RestartCount++; };
  const output = await f.launch();
  assert.equal(output.report.status, 'failed-owned-allinone-extension-replacement');
  assert.equal(output.report.rollback, 'failed-manual-owned-recovery-required');
  assert.deepEqual(f.removed, []);
  assert.deepEqual(f.stopped, [f.original.Id]);
});

test('candidate-only configuration drift still permits verified original restoration', async t => {
  const f = fixture(t);
  f.afterCreate = candidate => {
    const mount = candidate.Mounts.find(row => row.Destination === '/app/config/application.properties');
    fs.appendFileSync(mount.Source, '\ncorrupted=true\n');
  };
  const output = await f.launch();
  assert.equal(output.report.status, 'failed-owned-allinone-extension-replacement');
  assert.equal(output.report.rollback, 'original-owned-allinone-restored');
});

test('source/preparation failure and missing opt-in perform zero stop/create/delete operations', async t => {
  const f = fixture(t);
  await assert.rejects(() => replaceOwnedAllinoneExtension({ ...f.options, allowOwnedAllinoneReplacement: false }, f.adapters));
  f.adapters.readPlatform = () => { throw new Error('Invalid platform receipt'); };
  const output = await f.launch();
  assert.equal(output.report.status, 'failed-owned-allinone-extension-replacement');
  assert.ok(!f.commands.some(args => ['stop', 'run', 'rm'].includes(args[0])));
  assert.equal(f.closed, 1);
});

test('native route candidate is explicit and never a static/fallback response or a shared target', () => {
  const name = `nf-${runId}-backend-basis-allinone`;
  assert.deepEqual(extensionGatewayRoute(runId, name), {
    id: 'owned-platform-extension', uri: `http://${name}:30000`, order: 4,
    predicates: [{ name: 'Path', args: { _genkey_0: '/extension/**' } }],
    filters: ['StripPrefix=1', 'PrefixPath=/extension/api'],
  });
  assert.throws(() => extensionGatewayRoute(runId, 'ibiz-ebsx-allinone'));
});

test('candidate launch command binds immutable source image, one owned IP, all original aliases and exclusive CID journal', t => {
  const f = fixture(t);
  const output = join(f.base, 'backend-runtime-extension-unit');
  const configPath = join(output, 'allinone-config/application.properties');
  const loggingPath = join(output, 'allinone-config/logback.xml');
  const peers = [...f.containers.values()].filter(row => row.Id !== f.original.Id);
  const aliases = ownedAllinoneAliases(runId, f.original, peers);
  assert.deepEqual(aliases, [f.original.Name.slice(1)]);
  const args = extensionReplacementCommand({ runId, label: 'extension-unit', imageId: image(6),
    original: f.original, network: f.network, aliases, token: 'a'.repeat(36),
    cidPath: join(output, 'allinone.cid'), configPath, loggingPath });
  assert.equal(args[args.indexOf('--network') + 1], f.network.Id);
  assert.equal(args[args.indexOf('--ip') + 1], '10.91.0.7');
  assert.ok(args.includes('--cidfile') && args.includes('--read-only') && args.includes('--pull=never'));
  assert.ok(!args.includes('--publish') && !args.includes('--privileged'));
  const changed = structuredClone(peers);
  changed[0].NetworkSettings.Networks[f.network.Name].Aliases = [f.original.Name.slice(1)];
  assert.throws(() => ownedAllinoneAliases(runId, f.original, changed));
});

test('candidate verifier rejects environment, writable config, namespace, image, publication and alias changes', async t => {
  const f = fixture(t);
  const output = await f.launch();
  const expected = { runId, label: f.options.label, token: output.report.candidate.token,
    imageId: image(6), original: f.original, aliases: output.report.preservedAliases,
    configPath: output.report.configuration.candidate.path,
    loggingPath: f.created.Mounts.find(row => row.Destination === '/app/config/logback.xml').Source,
    network: f.network, expectedId: f.candidateId };
  verifyExtensionCandidate(f.created, expected);
  for (const change of [
    row => { row.Config.Env.push('JWT_SECRET=changed'); },
    row => { row.Config.User = 'root'; },
    row => { row.Config.Image = 'allinone:latest'; },
    row => { row.Image = image(99); },
    row => { row.HostConfig.Privileged = true; },
    row => { row.HostConfig.PidMode = 'host'; },
    row => { row.HostConfig.ExtraHosts = ['shared:host-gateway']; },
    row => { row.HostConfig.PortBindings = { '30000/tcp': [{ HostIp: '127.0.0.1', HostPort: '30000' }] }; },
    row => { row.Mounts[0].RW = true; },
    row => { row.Mounts[0].Source = '/shared/application.properties'; },
    row => { row.NetworkSettings.Networks.shared = {}; },
    row => { row.NetworkSettings.Networks[f.network.Name].Aliases = []; },
    row => { row.Config.Labels['aibiz.owned-allinone.token'] = 'foreign'; },
  ]) {
    const changed = structuredClone(f.created);
    change(changed);
    assert.throws(() => verifyExtensionCandidate(changed, expected));
  }
});

test('pre-existing candidate name and a stale Nacos snapshot fail before stopping the original', async t => {
  for (const mode of ['name', 'snapshot']) {
    const f = fixture(t);
    if (mode === 'name') {
      const foreign = structuredClone(f.original);
      foreign.Id = id(99);
      foreign.Name = `/nf-${runId}-backend-${f.options.label}-allinone`;
      foreign.NetworkSettings.Networks = {};
      f.containers.set(foreign.Id, foreign);
    } else {
      const path = join(dirname(f.deploymentInput), 'nacos-configs.private.json');
      const rows = JSON.parse(fs.readFileSync(path));
      rows[0].content = '---\n{"routes":["changed"]}\n';
      fs.writeFileSync(path, JSON.stringify(rows));
    }
    const output = await f.launch();
    assert.equal(output.report.status, 'failed-owned-allinone-extension-replacement');
    assert.deepEqual(f.stopped, []);
    assert.deepEqual(f.removed, []);
  }
});

test('HTTP readiness timeout is bounded and the original must regain HTTP readiness during rollback', async t => {
  const f = fixture(t);
  f.onRequest = path => {
    if (path === '/actuator/health' && !f.containers.get(f.original.Id).State.Running) {
      throw new Error('Candidate HTTP not ready');
    }
  };
  const output = await f.launch();
  assert.equal(output.report.status, 'failed-owned-allinone-extension-replacement');
  assert.equal(output.report.rollback, 'original-owned-allinone-restored');
  assert.ok(f.time >= 30_000 && f.time < 60_000);
});

test('deployment update changes only allinone identity and never rewrites gateway or UAA endpoints', t => {
  const f = fixture(t);
  const previous = JSON.parse(fs.readFileSync(f.deploymentInput));
  const candidate = { Id: id(9), Image: image(6) };
  const updated = extensionDeploymentInput(previous, candidate);
  assert.deepEqual(updated.endpoints, previous.endpoints);
  for (const role of ['uaa', 'gateway', 'provider']) assert.deepEqual(updated.services[role], previous.services[role]);
  assert.deepEqual(updated.auxiliaryContainers, previous.auxiliaryContainers);
  assert.throws(() => extensionDeploymentInput(previous, { ...candidate, Image: 'allinone:latest' }));
  assert.throws(() => extensionDeploymentInput(previous, { ...candidate, Id: previous.services.allinone.containerId }));
});
