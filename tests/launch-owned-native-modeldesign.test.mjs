import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import { connect, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import test from 'node:test';
import {
  cleanupOwnedNativeModelDesign, launchOwnedNativeModelDesign, ownedFrontendRunArguments,
  bridgeProcessIdentity, bridgeProcessStopped, startLoopbackBridge, stopLoopbackBridge,
  mountedMetadataSnapshot, projectOwnedBackendNetwork,
  verifyBridgeProcess, verifyOwnedBridgeRuntime, verifyOwnedFrontendContainer,
} from '../launch-owned-native-modeldesign.mjs';
import { PinnedDirectories } from '../native-candidate-files.mjs';
import { isolatedLaunchInput } from '../native-model-design-isolated-launch.mjs';
import { prepareOwnedModelDesignInput } from '../native-model-design-owned-backend-input.mjs';
import { createFixture } from '../prepare-run-owned-native-nonadmin-fixture.mjs';
import { ownedServiceTmpfs, ZOOKEEPER_IMAGE_ID } from '../owned-backend-resources.mjs';
import { createCentralServiceFixture } from './native-central-service-fixture.mjs';

const workspaceRoot = new URL('../../', import.meta.url).pathname;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const id = value => value.toString(16).padStart(64, '0');
const image = value => `sha256:${id(value)}`;
const runId = 'f01006abcdef';
const secret = 'deadbeefdeadbeefdeadbeefdeadbeefdead';

function write(path, value, mode = 0o600) {
  fs.mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path, typeof value === 'string' || Buffer.isBuffer(value) ? value : json(value), { mode });
}

async function fixture(t, { ipamStatus = false, sourceFrontend = false, service = false } = {}) {
  const workspace = fs.mkdtempSync(join(tmpdir(), 'owned-modeldesign-launch-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const { manifest } = createFixture({
    runId, scenario: 'two-center', passwordStorageMode: 'sm3',
    modelVersion: 816, uaaSchemaMode: 'legacy-views', secret: () => secret,
  });
  const base = join(workspace, '.artifacts/native-nonadmin-fixtures', runId);
  const resources = {
    contract: 'run-owned-native-fixture-resources-v1', runId, mysqlId: id(1), networkId: id(2),
    mysqlImage: image(3), mysqlName: manifest.ownership.mysqlContainer,
    networkName: manifest.ownership.network, schemas: manifest.schemas,
  };
  const prefix = ipamStatus ? 24 : 16;
  const addressPrefix = ipamStatus ? '10.91.0.' : '172.28.0.';
  const subnet = `${addressPrefix}0/${prefix}`;
  const network = {
    Id: resources.networkId, Name: resources.networkName, Internal: true, Driver: 'bridge',
    Labels: { [manifest.ownership.label]: runId },
    IPAM: { Config: [{ Subnet: subnet, Gateway: `${addressPrefix}1` }] }, Containers: {},
    ...(ipamStatus ? { Status: { IPAM: { Subnets: {
      [subnet]: { IPsInUse: 11, DynamicIPsAvailable: 245 },
    } } } } : {}),
  };
  const roles = ['mysql', 'allinone', 'gateway', 'provider', 'uaa', 'redis', 'nacos', 'zookeeper'];
  const attach = (container, number) => {
    const attachment = {
      NetworkID: network.Id, EndpointID: id(100 + number), IPAddress: `${addressPrefix}${number}`,
      IPPrefixLen: prefix, Gateway: '',
    };
    container.NetworkSettings.Networks = { [network.Name]: attachment };
    network.Containers[container.Id] = {
      Name: container.Name.slice(1), EndpointID: attachment.EndpointID,
      IPv4Address: `${attachment.IPAddress}/${prefix}`,
    };
    if (ipamStatus && container.Config.Labels['aibiz.owned-modeldesign.launch']) {
      network.Status.IPAM.Subnets[subnet].IPsInUse++;
      network.Status.IPAM.Subnets[subnet].DynamicIPsAvailable--;
    }
  };
  const containers = roles.map((role, index) => {
    const container = {
      Id: role === 'mysql' ? resources.mysqlId : id(index + 3),
      Name: role === 'mysql' ? `/${resources.mysqlName}` : `/nf-${runId}-${role}`,
      Image: role === 'mysql' ? resources.mysqlImage : image(index + 10),
      State: { Running: true, StartedAt: 'synthetic-start-only' }, RestartCount: 0,
      Config: { Labels: { [manifest.ownership.label]: runId }, Env: [`PRIVATE=${secret}`] },
      Mounts: [], HostConfig: { Privileged: false, PortBindings: {}, ...(role === 'mysql'
        ? { Tmpfs: { '/var/lib/mysql': 'rw,nosuid,nodev,size=1073741824' } } : {}) },
      NetworkSettings: { Ports: role === 'mysql' ? { '3306/tcp': null } : null },
    };
    if (role === 'zookeeper') {
      container.Name = `/nf-${runId}-backend-unit-zookeeper`;
      container.Image = ZOOKEEPER_IMAGE_ID;
      Object.assign(container.Config, {
        User: '65532:65532', Entrypoint: ['/docker-entrypoint.sh'], Cmd: ['zkServer.sh', 'start-foreground'],
        Env: [
          'ZOO_ADMINSERVER_ENABLED=false', 'ZOO_STANDALONE_ENABLED=true',
          'ZOO_4LW_COMMANDS_WHITELIST=srvr', 'ZOO_SERVERS=server.1=127.0.0.1:2888:3888;2181',
          'ZOO_CONF_DIR=/conf', 'ZOO_DATA_DIR=/data', 'ZOO_DATA_LOG_DIR=/datalog', 'ZOO_LOG_DIR=/logs',
        ],
      });
      container.Config.Labels['aibiz.native-backend.launch'] = 'unit';
      Object.assign(container.HostConfig, {
        ReadonlyRootfs: true, SecurityOpt: ['no-new-privileges'], Tmpfs: ownedServiceTmpfs('zookeeper'),
      });
      container.Mounts = Object.keys(container.HostConfig.Tmpfs)
        .map(Destination => ({ Type: 'tmpfs', Destination }));
    }
    attach(container, index + 2);
    return container;
  });
  const services = Object.fromEntries(roles.slice(1, 5).map((role, index) => [
    role, { containerId: containers[index + 1].Id, imageId: containers[index + 1].Image },
  ]));
  const endpoint = role => {
    const container = containers.find(row => row.Id === services[role].containerId);
    const attachment = container.NetworkSettings.Networks[network.Name];
    return {
      transport: 'private-inspected-ipv4', service: role, containerPort: role === 'uaa' ? 32666 : 30086,
      containerId: container.Id, networkId: network.Id, endpointId: attachment.EndpointID,
      ipv4: attachment.IPAddress,
    };
  };
  const imageReport = {
    contract: 'isolated-backend-source-images-v1', status: 'passed-image-artifact-binding-only',
    imageArtifactBindingVerified: true, nativeAcceptance: false, sourceClosure: false,
    acceptedForProduction: false, components: ['allinone', 'gateway', 'provider'].map(name => ({
      name, image: { id: services[name].imageId },
    })),
  };
  const imagePath = join(workspace, '.artifacts/source-images/report.json');
  write(imagePath, imageReport);
  const deployment = {
    contract: 'run-owned-native-permission-deployment-input-v2', runId, services,
    imageReceipt: { path: imagePath, sha256: hash(json(imageReport)) },
    auxiliaryContainers: ['redis', 'nacos', 'zookeeper'].map((role, index) => ({
      containerId: containers[index + 5].Id, imageId: containers[index + 5].Image, role,
    })), endpoints: { uaa: endpoint('uaa'), backend: endpoint('gateway') },
  };
  const deploymentPath = join(base, 'backend-runtime-unit/deployment-input.private.json');
  const candidate = join(workspace, '.artifacts/native-model-migration/unit');
  const assets = join(workspace, '.artifacts/native-ai-code-runtime-assets/unit');
  write(join(candidate, 'receipt.json'), { synthetic: true });
  write(join(candidate, 'plugins/test/package.json'), { synthetic: true });
  write(join(assets, 'nginx-native.conf'), fs.readFileSync(join(workspaceRoot, 'modelingweb/nginx-native.conf')));
  const assetReceipt = {
    modelDesignRuntime: {
      sourceBuildReport: { path: 'synthetic-build-only', sha256: hash('build') },
      runtime: { version: '0.2.2-local.2', sourceKind: 'reconstructed', sha256: hash('runtime') },
    },
  };
  if (sourceFrontend) {
    const dist = join(workspace, '.artifacts/frontend-candidates/unit/dist');
    const receipt = join(dirname(dist), 'report.json');
    write(join(dist, 'index.html'), '<html>source fixture</html>');
    write(receipt, { synthetic: true });
    assetReceipt.frontend = {
      contract: 'native-frontend-source-dist-binding-v1', dist,
      receipt: { path: receipt, bytes: fs.statSync(receipt).size, sha256: hash(fs.readFileSync(receipt)) },
      output: { files: 1, bytes: fs.statSync(join(dist, 'index.html')).size, sha256: hash('fixture-only') },
    };
  }
  write(join(assets, 'receipt.json'), assetReceipt);
  const serviceCandidate = service ? createCentralServiceFixture(workspace) : undefined;
  const original = isolatedLaunchInput({
    workspace, candidate, assets, name: 'launch-basis-unit', centralPort: 32448, modeldesignPort: 32449,
    frontend: assetReceipt.frontend,
    serviceCandidate,
  });
  original.evidence = {
    candidateReceiptSha256: hash(fs.readFileSync(join(candidate, 'receipt.json'))),
    runtimeReceiptSha256: hash(json(assetReceipt)),
    sourceBuildReport: assetReceipt.modelDesignRuntime.sourceBuildReport,
    runtime: assetReceipt.modelDesignRuntime.runtime,
  };
  for (const mount of original.mounts) {
    if (fs.existsSync(mount.source)) continue;
    if (mount.target === '/opt/aibiz/local-dist' || mount.target === '/app/model') {
      write(join(mount.source, 'fixture-only.json'), { synthetic: true });
    } else write(mount.source, 'synthetic test input\n');
  }
  const launchPath = join(workspace, '.artifacts/native-model-design-isolated/unit/input.json');
  write(launchPath, original);
  write(join(dirname(launchPath), 'report.json'), {
    contract: 'native-model-design-isolated-launch', inputSha256: hash(json(original)),
    run: false, status: 'PREPARED-NOT-ACCEPTED', containers: [], errors: [],
    nativeAccepted: false, acceptedForProduction: false,
  });
  write(join(base, 'manifest.json'), manifest);
  write(join(base, 'owned-resources.json'), resources);
  write(join(base, 'credentials.private.json'), { password: secret });
  write(deploymentPath, deployment);
  const commands = [];
  const state = {
    workspace, base, resources, manifest, network, containers, deployment, deploymentPath,
    assets, candidate, original, assetReceipt, commands, started: 0, sourceChecks: 0,
    removed: [], stopped: [], requests: [], logged: [],
    frontendImage: { Id: image(99), Os: 'linux' }, onExecute() {}, onSource() {},
  };
  const adapters = {
    verifyAssets: () => {
      state.sourceChecks++;
      state.onSource(state);
      return { directory: assets, candidate, receipt: structuredClone(assetReceipt) };
    },
    verifyImages: () => ({
      report: structuredClone(imageReport), reportSha256: hash(fs.readFileSync(imagePath)),
      imageArtifactBindingVerified: true, freshImageFileProbeExecuted: false,
      verificationMode: 'source-and-recorded-probes-with-live-image-inspection',
    }),
    execute: (executable, args) => {
      assert.equal(executable, 'docker', 'No shell execution is allowed');
      commands.push([...args]);
      state.onExecute(state, args);
      const ok = stdout => ({ status: 0, signal: null, stdout: typeof stdout === 'string' ? stdout : json(stdout) });
      if (args[0] === 'inspect') {
        const found = args.slice(1).map(value => containers.find(row => row.Id === value));
        assert.ok(found.every(Boolean), 'Only exact existing container IDs may be inspected');
        return ok(found);
      }
      if (args[0] === 'network') return ok([network]);
      if (args[0] === 'container' && args[1] === 'inspect') {
        if (state.recoveryMisses > 0) {
          state.recoveryMisses--;
          return { status: 1, signal: null, stdout: '' };
        }
        const found = containers.filter(row => row.Name === `/${args[2]}`);
        return found.length ? ok(found) : { status: 1, signal: null, stdout: '' };
      }
      if (args[0] === 'image') return ok([state.frontendImage]);
      if (args[0] === 'ps') {
        return ok(containers.map(row => args.includes('{{.ID}}') ? row.Id : row.Name.slice(1)).join('\n'));
      }
      if (args[0] === 'logs') {
        assert.deepEqual(args.slice(0, 4), ['logs', '--timestamps', '--tail', '200']);
        assert.match(args[4], /^[a-f0-9]{64}$/);
        state.logged.push(args[4]);
        if (state.throwLogs) throw new Error(secret);
        return { status: 0, signal: null, stdout: `owned private log ${secret}`, stderr: 'owned private stderr' };
      }
      if (args[0] === 'rm') {
        assert.deepEqual(args.slice(0, 2), ['rm', '--force']);
        assert.match(args[2], /^[a-f0-9]{64}$/);
        state.removed.push(args[2]);
        const removed = containers.find(row => row.Id === args[2]);
        if (ipamStatus && removed?.Config.Labels['aibiz.owned-modeldesign.launch']) {
          network.Status.IPAM.Subnets[subnet].IPsInUse--;
          network.Status.IPAM.Subnets[subnet].DynamicIPsAvailable++;
        }
        containers.splice(containers.findIndex(row => row.Id === args[2]), 1);
        delete network.Containers[args[2]];
        return ok(args[2]);
      }
      assert.equal(args[0], 'run');
      assert.ok(!args.includes('--publish'), 'Internal network must not pretend to publish a host listener');
      const app = state.prepared.input.applications.find(row => row.container === args[args.indexOf('--name') + 1]);
      assert.ok(app);
      const container = {
        Id: id(1000 + ++state.started), Name: `/${app.container}`, Image: state.frontendImage.Id,
        Created: new Date().toISOString(),
        State: { Running: true, StartedAt: 'synthetic-frontend-start-only', Health: { Status: 'healthy' } },
        RestartCount: 0,
        Config: {
          Image: state.frontendImage.Id, Entrypoint: ['/bin/sh'], Cmd: ['/start.sh'],
          Labels: { 'aibiz.native-model-design-isolated': state.prepared.input.name,
            'aibiz.native-fixture.run': runId,
            'aibiz.owned-modeldesign.launch': args.find(row => row.startsWith('aibiz.owned-modeldesign.launch='))
              .split('=')[1] },
          Env: Object.entries(app.environment).map(([key, value]) => `${key}=${value}`),
          Healthcheck: { Test: ['CMD-SHELL', app.args[app.args.indexOf('--health-cmd') + 1]] },
        },
        HostConfig: { Privileged: false, NetworkMode: network.Id, PublishAllPorts: false,
          PortBindings: {}, Tmpfs: { '/dist': 'uid=101,gid=101,mode=0755' } },
        Mounts: [...state.prepared.input.mounts.map(mount => ({
          Type: 'bind', Source: mount.source, Destination: mount.target, RW: false,
        })), ...(state.omitTmpfsMount ? [] : [{ Type: 'tmpfs', Destination: '/dist' }])],
        NetworkSettings: { Ports: { '8080/tcp': null } },
      };
      attach(container, 20 + state.started);
      containers.push(container);
      if (!state.skipCid) write(args[args.indexOf('--cidfile') + 1], container.Id);
      if (state.forgedNonce) container.Config.Labels['aibiz.owned-modeldesign.launch'] = 'f'.repeat(36);
      if (state.failRun === state.started) return { status: 1, signal: null, stdout: '', stderr: secret };
      if (state.timeoutRun === state.started) {
        return { status: null, signal: 'SIGTERM', error: new Error('ETIMEDOUT'), stdout: '' };
      }
      return ok(container.Id);
    },
  };
  state.prepared = await prepareOwnedModelDesignInput({
    workspace, launchInput: relative(workspace, launchPath), launchInputSha256: hash(json(original)),
    deploymentInput: relative(workspace, deploymentPath), deploymentInputSha256: hash(json(deployment)),
    name: 'owned-launch-unit', output: '.artifacts/native-model-design-owned-backend/owned-launch-unit',
  }, adapters);
  state.sourceChecks = 0;
  const inputPath = join(state.prepared.destination, 'input.json');
  state.options = {
    workspace, input: inputPath, inputSha256: hash(fs.readFileSync(inputPath)),
    deploymentInput: deploymentPath, deploymentInputSha256: hash(fs.readFileSync(deploymentPath)),
    allowOwnedFrontendLaunch: true,
  };
  state.adapters = {
    ...adapters, checkPort: async port => {
      if (state.occupiedPort === port) throw new Error('EADDRINUSE');
    },
    wait: async () => {}, readyAttempts: 1,
    request: async url => {
      state.requests.push(url);
      if (state.failRequest === url) throw new Error(secret);
      return { status: 200, arrayBuffer: async () => new ArrayBuffer(0) };
    },
    startBridge: async ({ directory, directories, application, runtime, frontendPins, registerBridge }) => {
      state.runtime = runtime;
      state.frontendPins = frontendPins;
      const specPath = join(directory.path, `${application.application.toLowerCase()}.bridge.private.json`);
      const spec = json({ port: Number(new URL(application.entry).port) });
      directories.write(directory, basename(specPath), spec);
      const bridge = {
        specPath, specSha256: hash(spec), port: Number(new URL(application.entry).port),
        identity: { pid: 2147483647, uid: process.geteuid(), startTicks: '1',
          executable: fs.realpathSync(process.execPath), commandSha256: hash('synthetic-only') },
      };
      registerBridge(bridge);
      if (state.failBridge === application.application) throw new Error(secret);
      return bridge;
    },
    stopBridge: async bridge => { state.stopped.push(bridge.application); },
  };
  state.launch = () => launchOwnedNativeModelDesign(state.options, state.adapters);
  state.rewriteInput = mutate => {
    mutate(state.prepared.input);
    write(inputPath, state.prepared.input);
    state.options.inputSha256 = hash(fs.readFileSync(inputPath));
    state.prepared.report.inputSha256 = state.options.inputSha256;
    write(join(state.prepared.destination, 'report.json'), state.prepared.report);
  };
  return state;
}

test('Central query mount and receipt remain guarded through launch and bridge runtime', async t => {
  const s = await fixture(t, { service: true });
  assert.equal((await s.launch()).report.status, 'RUNNING-OWNED-FRONTEND-NOT-ACCEPTED');
  assert.deepEqual(s.prepared.input.serviceCandidate, s.original.serviceCandidate);
  const directories = new PinnedDirectories();
  try {
    const options = { workspace: s.workspace, directories, input: s.prepared.input,
      runtime: s.runtime, frontendPins: s.frontendPins, execute: s.adapters.execute };
    verifyOwnedBridgeRuntime(options);
    assert.ok(s.runtime.bindings.some(row => row.path === s.original.serviceCandidate.receipt.path));
    fs.appendFileSync(s.original.serviceCandidate.receipt.path, '\n');
    assert.throws(() => verifyOwnedBridgeRuntime(options));
  } finally { directories.close(); }
});

for (const kind of ['receipt', 'model', 'final-model']) {
  test(`Central query ${kind} drift refuses launch before any peer starts`, async t => {
    const s = await fixture(t, { service: true });
    const mutate = () => fs.appendFileSync(kind === 'receipt' ? s.original.serviceCandidate.receipt.path
      : s.original.serviceCandidate.file.path, '\n');
    if (kind === 'final-model') s.onSource = () => { if (s.sourceChecks === 2) mutate(); };
    else mutate();
    const result = await s.launch();
    assert.equal(result.report.status, 'FAILED-NOT-ACCEPTED');
    assert.equal(s.started, 0);
  });
}

test('launch retains explicit source frontend through reconstruction and bridge file guards', async t => {
  const s = await fixture(t, { sourceFrontend: true });
  const result = await s.launch();
  assert.equal(result.report.status, 'RUNNING-OWNED-FRONTEND-NOT-ACCEPTED');
  assert.deepEqual(s.prepared.input.frontend, s.original.frontend);
  assert.ok(s.runtime.bindings.some(row => row.path === s.original.frontend.receipt.path
    && row.sha256 === s.original.frontend.receipt.sha256));
  for (const args of s.commands.filter(row => row[0] === 'run')) {
    assert.ok(args.some(value => value.includes(`src=${s.original.frontend.dist},`)));
    assert.ok(!args.some(value => value.includes('modelingweb/app/dist')));
  }
});

for (const mode of ['mismatched-assets', 'receipt-drift']) {
  test(`launch rejects source frontend ${mode} before starting peers`, async t => {
    const s = await fixture(t, { sourceFrontend: true });
    if (mode === 'mismatched-assets') delete s.assetReceipt.frontend;
    else write(s.original.frontend.receipt.path, { changed: true });
    const result = await s.launch();
    assert.equal(result.report.status, 'FAILED-NOT-ACCEPTED');
    assert.equal(s.started, 0);
  });
}

test('launch revalidates eight backend nodes and source mounts, then owns two unpublished frontends and loopback bridges', async t => {
  const s = await fixture(t);
  const result = await s.launch();
  assert.equal(result.report.status, 'RUNNING-OWNED-FRONTEND-NOT-ACCEPTED');
  assert.deepEqual(result.report.errors, []);
  assert.equal(result.report.containers.length, 2);
  assert.equal(result.report.bridges.length, 2);
  assert.equal(s.containers.length, 10);
  assert.equal(s.sourceChecks, 2);
  assert.equal(result.report.nativeAcceptance, false);
  assert.equal(result.report.permissionAcceptance, false);
  assert.equal(result.report.acceptedForProduction, false);
  assert.ok(!JSON.stringify(result.report).includes(secret));
  assert.equal(s.requests.length, 4);
  const runs = s.commands.filter(args => args[0] === 'run');
  assert.equal(runs.length, 2);
  for (const args of runs) {
    assert.ok(!args.includes('--publish'));
    assert.equal(args[args.indexOf('--network') + 1], s.resources.networkId);
    assert.ok(args.includes(s.frontendImage.Id));
    assert.ok(!args.includes('aibiz/modelingweb:local'));
    assert.ok(args.includes('--cidfile'));
  }
  assert.ok(fs.existsSync(join(result.destination, 'launch-state.private.json')));
});

test('explicit launch opt-in and exact input/deployment hashes are mandatory', async t => {
  const s = await fixture(t);
  await assert.rejects(() => launchOwnedNativeModelDesign({
    ...s.options, allowOwnedFrontendLaunch: false,
  }, s.adapters), /opt-in/);
  s.options.inputSha256 = id(888);
  const result = await s.launch();
  assert.equal(result.report.status, 'FAILED-NOT-ACCEPTED');
  assert.equal(s.started, 0);
  assert.equal(result.destination, undefined);
});

for (const [name, mutate] of [
  ['Docker argument injection', input => input.applications[0].args.splice(2, 0, '--privileged')],
  ['Docker executable substitution', input => { input.applications[0].command = 'sh'; }],
  ['shared-network substitution', input => { input.network = 'compose_agent_network'; }],
  ['foreign root substitution', input => { input.applications[1].environment.NATIVE_MODELING_SYSTEM_ID = 'shared'; }],
  ['writable mount substitution', input => { input.mounts[1].readOnly = false; }],
  ['external entry substitution', input => { input.applications[0].entry = 'http://remote.example/central/'; }],
  ['arbitrary cleanup injection', input => { input.cleanup.args.push('shared-business'); }],
  ['forged acceptance flag', input => { input.nativeAccepted = true; }],
]) {
  test(`rejects rehashed ${name} even when preparation input hash is rewritten`, async t => {
    const s = await fixture(t);
    s.rewriteInput(mutate);
    const result = await s.launch();
    assert.equal(result.report.status, 'FAILED-NOT-ACCEPTED');
    assert.equal(s.started, 0);
    assert.ok(!JSON.stringify(result.report).includes(secret));
  });
}

test('rejects source/mount drift despite green preparation receipt', async t => {
  const s = await fixture(t);
  write(join(s.candidate, 'plugins/test/package.json'), { changed: true });
  const result = await s.launch();
  assert.equal(result.report.status, 'FAILED-NOT-ACCEPTED');
  assert.equal(s.started, 0);
});

test('rejects bound deployment, lifecycle and image drift before launch', async t => {
  for (const mutate of [
    s => { s.options.deploymentInputSha256 = id(777); },
    s => { s.containers[3].RestartCount++; },
    s => { s.frontendImage.Id = image(998); },
    s => { s.network.Containers[id(555)] = { Name: 'unreviewed' }; },
    s => { s.containers[4].NetworkSettings.Networks.shared = {}; },
  ]) {
    const s = await fixture(t);
    mutate(s);
    const result = await s.launch();
    assert.equal(result.report.status, 'FAILED-NOT-ACCEPTED');
    assert.equal(s.started, 0);
  }
});

test('existing frontend name and occupied loopback port are rejected without Docker mutation', async t => {
  for (const mode of ['name', 'port']) {
    const s = await fixture(t);
    if (mode === 'name') {
      s.onExecute = (_state, args) => {
        if (args[0] === 'ps') s.containers[1].Name = `/${s.prepared.input.applications[0].container}`;
      };
    } else s.occupiedPort = 32448;
    const result = await s.launch();
    assert.equal(result.report.status, 'FAILED-NOT-ACCEPTED');
    assert.equal(s.started, 0);
    assert.deepEqual(s.removed, []);
  }
});

test('partial Docker start failure reads cidfile and removes only this invocation exact IDs', async t => {
  const s = await fixture(t);
  const backendIds = s.containers.map(row => row.Id);
  s.failRun = 2;
  const result = await s.launch();
  assert.equal(result.report.status, 'FAILED-NOT-ACCEPTED');
  assert.deepEqual(s.removed, [id(1002), id(1001)]);
  assert.deepEqual(s.containers.map(row => row.Id), backendIds);
  assert.ok(s.commands.filter(args => args[0] === 'rm').every(args => /^[a-f0-9]{64}$/.test(args[2])));
  assert.equal(result.report.containers.length, 2);
  assert.ok(result.report.containers.every(row => row.removed));
  assert.ok(fs.existsSync(join(result.destination, 'launch-state.private.json')));
  assert.ok(!JSON.stringify(result.report).includes(secret));
});

test('source drift between final verification and create fails before first container starts', async t => {
  const s = await fixture(t);
  s.onSource = state => {
    if (state.sourceChecks === 2) write(join(state.assets, 'new-drift.txt'), 'changed');
  };
  const result = await s.launch();
  assert.equal(result.report.status, 'FAILED-NOT-ACCEPTED');
  assert.equal(s.started, 0);
});

test('bridge failure registers process ownership before waiting and cleans all created resources', async t => {
  const s = await fixture(t);
  s.failBridge = 'ModelDesign';
  const result = await s.launch();
  assert.equal(result.report.status, 'FAILED-NOT-ACCEPTED');
  assert.deepEqual(s.stopped, ['ModelDesign', 'Central']);
  assert.deepEqual(s.removed, [id(1002), id(1001)]);
  const state = JSON.parse(fs.readFileSync(join(result.destination, 'launch-state.private.json')));
  assert.equal(state.bridges.length, 2, 'Failed owned resources remain auditable');
});

test('unexpected peer appearing after first create triggers exact cleanup and preserves the peer', async t => {
  const s = await fixture(t);
  s.onExecute = (state, args) => {
    if (state.started === 1 && args[0] === 'network') {
      state.network.Containers[id(9999)] = { Name: 'unreviewed-do-not-delete' };
    }
  };
  const result = await s.launch();
  assert.equal(result.report.status, 'FAILED-NOT-ACCEPTED');
  assert.deepEqual(s.removed, [id(1001)]);
  assert.ok(s.network.Containers[id(9999)]);
});

test('post-launch binding validator rejects publications, root drift, image drift, host networking and writable binds', async t => {
  const s = await fixture(t);
  const result = await s.launch();
  assert.equal(result.report.status, 'RUNNING-OWNED-FRONTEND-NOT-ACCEPTED');
  const input = s.prepared.input;
  const app = input.applications[1];
  const source = s.containers.find(row => row.Name === `/${app.container}`);
  for (const mutate of [
    row => { row.HostConfig.PortBindings = { '8080/tcp': [{ HostIp: '0.0.0.0', HostPort: '99' }] }; },
    row => { row.Image = image(8888); },
    row => { row.Config.Env.push('NATIVE_MODELING_SYSTEM_ID=shared'); },
    row => { row.NetworkSettings.Networks.shared = {}; },
    row => { row.HostConfig.NetworkMode = 'host'; },
    row => { row.Mounts[0].RW = true; },
    row => { row.HostConfig.Privileged = true; },
  ]) {
    const changed = structuredClone(source);
    mutate(changed);
    assert.throws(() => verifyOwnedFrontendContainer(input, app, changed, s.network));
  }
});

test('accepts real daemon inspect shape when --tmpfs is present only in exact HostConfig.Tmpfs', async t => {
  const s = await fixture(t);
  s.omitTmpfsMount = true;
  const result = await s.launch();
  assert.equal(result.report.status, 'RUNNING-OWNED-FRONTEND-NOT-ACCEPTED');
  for (const row of result.report.containers) {
    const container = s.containers.find(container => container.Id === row.id);
    assert.ok(container.Mounts.every(mount => mount.Type === 'bind'));
    assert.equal(container.Mounts.length, s.prepared.input.mounts.length);
    assert.deepEqual(container.HostConfig.Tmpfs, { '/dist': 'uid=101,gid=101,mode=0755' });
  }
});

test('real Docker IPAM counters 11/245 project only the verified one/two frontend allocations and retain private proof', async t => {
  const s = await fixture(t, { ipamStatus: true });
  const baseline = structuredClone(s.network);
  const result = await s.launch();
  assert.equal(result.report.status, 'RUNNING-OWNED-FRONTEND-NOT-ACCEPTED');
  assert.deepEqual(s.network.Status.IPAM.Subnets['10.91.0.0/24'], {
    IPsInUse: 13, DynamicIPsAvailable: 243,
  });
  const pins = result.report.containers.map(row => row.pin);
  const projection = projectOwnedBackendNetwork({ baseline, network: s.network, frontends: pins });
  assert.deepEqual(projection.network, baseline);
  assert.deepEqual(projection.evidence.counters, [{
    subnet: '10.91.0.0/24', verifiedFrontendCount: 2,
    baseline: { IPsInUse: 11, DynamicIPsAvailable: 245 },
    actual: { IPsInUse: 13, DynamicIPsAvailable: 243 },
  }]);
  assert.deepEqual(JSON.parse(fs.readFileSync(result.report.privateNetworkBaseline.path)), baseline);
  assert.equal(fs.statSync(result.report.privateNetworkBaseline.path).mode & 0o077, 0);
  const recordedCounts = new Set();
  for (const row of result.report.privateNetworkInspections) {
    const attached = JSON.parse(fs.readFileSync(row.snapshot.path));
    const proof = JSON.parse(fs.readFileSync(row.proof.path));
    const count = attached.verifiedFrontends.length;
    recordedCounts.add(count);
    assert.deepEqual(attached.network.Status.IPAM.Subnets['10.91.0.0/24'], {
      IPsInUse: 11 + count, DynamicIPsAvailable: 245 - count,
    });
    assert.equal(proof.counters[0].verifiedFrontendCount, count);
    assert.equal(proof.allOtherNetworkFieldsUnchanged, true);
    assert.equal(fs.statSync(row.snapshot.path).mode & 0o077, 0);
  }
  assert.deepEqual([...recordedCounts].sort(), [1, 2]);
  const directories = new PinnedDirectories();
  try {
    verifyOwnedBridgeRuntime({
      workspace: s.workspace, directories, input: s.prepared.input, runtime: s.runtime,
      frontendPins: s.frontendPins, execute: s.adapters.execute,
    });
    s.network.Status.IPAM.Subnets['10.91.0.0/24'].IPsInUse++;
    assert.throws(() => verifyOwnedBridgeRuntime({
      workspace: s.workspace, directories, input: s.prepared.input, runtime: s.runtime,
      frontendPins: s.frontendPins, execute: s.adapters.execute,
    }), /IPsInUse/);
  } finally { directories.close(); }
});

test('network projection rejects unexplained allocation/status/IPAM/endpoint/label/field drift without dropping fields', async t => {
  const s = await fixture(t, { ipamStatus: true });
  const baseline = structuredClone(s.network);
  const result = await s.launch();
  assert.equal(result.report.status, 'RUNNING-OWNED-FRONTEND-NOT-ACCEPTED');
  const pins = result.report.containers.map(row => row.pin);
  for (const mutate of [
    network => { network.Status.IPAM.Subnets['10.91.0.0/24'].IPsInUse++; },
    network => { network.Status.IPAM.Subnets['10.91.0.0/24'].DynamicIPsAvailable--; },
    network => { network.Status.IPAM.Subnets['10.91.0.0/24'].IPsInUse = '13'; },
    network => { network.Status.IPAM.Subnets['10.91.0.0/24'].DynamicIPsAvailable = -1; },
    network => { network.Status.IPAM.Subnets['10.91.0.0/24'].UnexpectedField = true; },
    network => { network.Status.Unknown = { retained: true }; },
    network => { delete network.Status; },
    network => { delete network.Status.IPAM.Subnets['10.91.0.0/24']; },
    network => { network.IPAM.Config[0].Gateway = '10.91.0.254'; },
    network => { network.Containers[pins[0].containerId].EndpointID = id(999); },
    network => { network.Containers[s.resources.mysqlId].EndpointID = id(999); },
    network => { network.Labels['aibiz.native-fixture.run'] = 'foreign'; },
    network => { network.Options = { unexpected: true }; },
    network => { network.Containers[id(7777)] = { Name: 'unreviewed' }; },
  ]) {
    const changed = structuredClone(s.network);
    mutate(changed);
    assert.throws(() => projectOwnedBackendNetwork({ baseline, network: changed, frontends: pins }));
  }
  const emptyBaseline = structuredClone(baseline);
  delete emptyBaseline.Status;
  assert.throws(() => projectOwnedBackendNetwork({ baseline: emptyBaseline, network: s.network, frontends: pins }));
});

test('unexplained live allocation failure retains the attached network before exact owned cleanup', async t => {
  const s = await fixture(t, { ipamStatus: true });
  let changed = false;
  s.onExecute = (state, args) => {
    if (!changed && state.started === 1 && args[0] === 'network') {
      changed = true;
      state.network.Status.IPAM.Subnets['10.91.0.0/24'].IPsInUse++;
    }
  };
  const result = await s.launch();
  assert.equal(result.report.status, 'FAILED-NOT-ACCEPTED');
  assert.deepEqual(s.removed, [id(1001)]);
  const failure = JSON.parse(fs.readFileSync(result.report.privateFailure.path));
  assert.match(failure.error.message, /Unexplained IPsInUse allocation drift/);
  const inspection = result.report.privateNetworkInspections.at(-1);
  const attached = JSON.parse(fs.readFileSync(inspection.snapshot.path));
  assert.equal(attached.verifiedFrontends.length, 1);
  assert.deepEqual(attached.network.Status.IPAM.Subnets['10.91.0.0/24'], {
    IPsInUse: 13, DynamicIPsAvailable: 244,
  });
  assert.equal(inspection.proof, undefined, 'An unproven allocation must not acquire a valid projection receipt');
  assert.ok(!JSON.stringify(result.report).includes(secret));
});

test('frontend allocation projection counts by exact IPAM subnet rather than subtracting global totals', async t => {
  const s = await fixture(t, { ipamStatus: true });
  const baseline = structuredClone(s.network);
  baseline.IPAM.Config.push({ Subnet: '10.92.0.0/24', Gateway: '10.92.0.1' });
  baseline.Status.IPAM.Subnets['10.92.0.0/24'] = { IPsInUse: 3, DynamicIPsAvailable: 253 };
  const network = structuredClone(baseline);
  const frontends = ['10.91.0.20', '10.92.0.21'].map((ipv4, index) => ({
    containerId: id(1001 + index), endpointId: id(2001 + index), ipv4, networkId: network.Id,
  }));
  for (const frontend of frontends) {
    network.Containers[frontend.containerId] = {
      Name: `owned-front-${frontend.containerId}`, EndpointID: frontend.endpointId,
      IPv4Address: `${frontend.ipv4}/24`,
    };
    const subnet = frontend.ipv4.startsWith('10.91.') ? '10.91.0.0/24' : '10.92.0.0/24';
    network.Status.IPAM.Subnets[subnet].IPsInUse++;
    network.Status.IPAM.Subnets[subnet].DynamicIPsAvailable--;
  }
  const result = projectOwnedBackendNetwork({ baseline, network, frontends });
  assert.deepEqual(result.network, baseline);
  assert.deepEqual(result.evidence.counters.map(row => [row.subnet, row.verifiedFrontendCount]), [
    ['10.91.0.0/24', 1], ['10.92.0.0/24', 1],
  ]);
  network.Status.IPAM.Subnets['10.91.0.0/24'].IPsInUse++;
  network.Status.IPAM.Subnets['10.92.0.0/24'].IPsInUse--;
  assert.throws(() => projectOwnedBackendNetwork({ baseline, network, frontends }), /IPsInUse/);
});

test('optional tmpfs representation still rejects unexpected destinations/types, duplicates, sources and writable input binds', async t => {
  const s = await fixture(t);
  assert.equal((await s.launch()).report.status, 'RUNNING-OWNED-FRONTEND-NOT-ACCEPTED');
  const input = s.prepared.input;
  const app = input.applications[0];
  const source = s.containers.find(container => container.Name === `/${app.container}`);
  for (const mutate of [
    row => { row.HostConfig.Tmpfs = {}; },
    row => { row.HostConfig.Tmpfs['/dist'] = 'uid=0,gid=0,mode=0777'; },
    row => { row.HostConfig.Tmpfs['/other'] = 'uid=101,gid=101,mode=0755'; },
    row => { row.Mounts.at(-1).Destination = '/other'; },
    row => { row.Mounts.push({ Type: 'tmpfs', Destination: '/dist' }); },
    row => { row.Mounts.at(-1).Source = '/host-path'; },
    row => { row.Mounts.at(-1).RW = false; },
    row => { row.Mounts.push({ Type: 'volume', Destination: '/cache', Name: 'unexpected' }); },
    row => { row.Mounts[0].RW = true; },
    row => { row.Mounts.push(structuredClone(row.Mounts[0])); },
  ]) {
    const changed = structuredClone(source);
    mutate(changed);
    assert.throws(() => verifyOwnedFrontendContainer(input, app, changed, s.network));
  }
});

test('failure preserves private error stack and exact owned inspect/logs before removal without public leakage', async t => {
  const s = await fixture(t);
  s.failRequest = s.prepared.input.applications[0].entry;
  const result = await s.launch();
  assert.equal(result.report.status, 'FAILED-NOT-ACCEPTED');
  assert.ok(!JSON.stringify(result.report).includes(secret));
  const failure = JSON.parse(fs.readFileSync(result.report.privateFailure.path));
  assert.equal(failure.stage, 'loopback-bridges');
  assert.equal(failure.error.message, secret);
  assert.ok(failure.error.stack.includes(secret));
  assert.equal(fs.statSync(result.report.privateFailure.path).mode & 0o077, 0);
  assert.deepEqual(s.logged, [id(1002), id(1001)]);
  assert.deepEqual(s.removed, [id(1002), id(1001)]);
  assert.equal(result.report.privateContainerDiagnostics.length, 2);
  for (const row of result.report.privateContainerDiagnostics) {
    const inspection = JSON.parse(fs.readFileSync(row.inspection.path));
    assert.equal(inspection.Id, row.id);
    assert.equal(inspection.Image, s.frontendImage.Id);
    assert.equal(inspection.Config.Labels['aibiz.native-fixture.run'], runId);
    assert.equal(fs.statSync(row.inspection.path).mode & 0o077, 0);
    const command = JSON.parse(fs.readFileSync(row.command.path));
    assert.equal(command.containerId, row.id);
    assert.equal(command.exitCode, 0);
    assert.ok(fs.readFileSync(command.stdout.path, 'utf8').includes(secret));
    assert.equal(fs.statSync(command.stdout.path).mode & 0o077, 0);
    const logIndex = s.commands.findIndex(args => args[0] === 'logs' && args.at(-1) === row.id);
    const removeIndex = s.commands.findIndex(args => args[0] === 'rm' && args.at(-1) === row.id);
    assert.ok(logIndex >= 0 && removeIndex > logIndex);
  }
});

test('private diagnostic collection failure cannot prevent verified exact cleanup or replace the original error stack', async t => {
  const s = await fixture(t);
  s.failRequest = s.prepared.input.applications[0].entry;
  s.throwLogs = true;
  const result = await s.launch();
  assert.equal(result.report.status, 'FAILED-NOT-ACCEPTED');
  assert.deepEqual(s.removed, [id(1002), id(1001)]);
  const failure = JSON.parse(fs.readFileSync(result.report.privateFailure.path));
  assert.equal(failure.error.message, secret);
  assert.ok(failure.error.stack.includes(secret));
  assert.ok(!JSON.stringify(result.report).includes(secret));
});

test('cleanup tolerates already absent bridge processes but only deletes verified exact container IDs', async t => {
  const s = await fixture(t);
  const result = await s.launch();
  const statePath = join(result.destination, 'launch-state.private.json');
  const report = await cleanupOwnedNativeModelDesign({
    workspace: s.workspace, launchDirectory: result.destination,
    stateSha256: hash(fs.readFileSync(statePath)), allowOwnedFrontendCleanup: true,
  }, s.adapters);
  assert.equal(report.status, 'CLEANED-OWNED-FRONTEND-NOT-ACCEPTED');
  assert.deepEqual(s.removed, [id(1002), id(1001)]);
  assert.equal(s.containers.length, 8);
});

test('cleanup refuses wrong state hash and changed ownership without removing any resource', async t => {
  const s = await fixture(t);
  const result = await s.launch();
  const statePath = join(result.destination, 'launch-state.private.json');
  const options = {
    workspace: s.workspace, launchDirectory: result.destination,
    stateSha256: id(999), allowOwnedFrontendCleanup: true,
  };
  assert.equal((await cleanupOwnedNativeModelDesign(options, s.adapters)).status, 'FAILED-NOT-ACCEPTED');
  options.stateSha256 = hash(fs.readFileSync(statePath));
  s.containers.at(-1).Config.Labels['aibiz.native-fixture.run'] = 'foreign';
  assert.equal((await cleanupOwnedNativeModelDesign(options, s.adapters)).status, 'FAILED-NOT-ACCEPTED');
  assert.deepEqual(s.removed, []);
  assert.deepEqual(s.stopped, []);
  assert.equal(fs.readdirSync(result.destination).filter(name => /^cleanup-.*\.json$/.test(name)).length, 2);
});

test('partial failed startup state remains valid for cleanup after exact-ID rollback', async t => {
  const s = await fixture(t);
  s.failRun = 1;
  const result = await s.launch();
  const statePath = join(result.destination, 'launch-state.private.json');
  const report = await cleanupOwnedNativeModelDesign({
    workspace: s.workspace, launchDirectory: result.destination,
    stateSha256: hash(fs.readFileSync(statePath)), allowOwnedFrontendCleanup: true,
  }, s.adapters);
  assert.deepEqual(report.removed, []);
  assert.equal(s.containers.length, 8);
});

test('bridge process identity pins uid, executable, exact argv hash and kernel start ticks before signalling', () => {
  const specPath = '/tmp/test.bridge.private.json';
  const specSha256 = hash('spec');
  const tool = new URL('../launch-owned-native-modeldesign.mjs', import.meta.url).pathname;
  const identity = {
    pid: 12345, uid: process.geteuid(), startTicks: '123',
    executable: fs.realpathSync(process.execPath),
    commandSha256: hash(Buffer.from([
      process.execPath, tool, '--bridge-worker', specPath, '--bridge-worker-sha256', specSha256, '',
    ].join('\0'))),
  };
  verifyBridgeProcess(identity, specPath, specSha256, () => structuredClone(identity));
  for (const changed of [
    { ...identity, startTicks: '124' }, { ...identity, uid: process.geteuid() + 1 },
    { ...identity, executable: '/bin/sh' }, { ...identity, commandSha256: hash('unrelated') },
  ]) assert.throws(() => verifyBridgeProcess(identity, specPath, specSha256, () => changed));
});

test('bridge exit may clear argv before Z without adopting a different live process identity', async () => {
  const bridge = { identity: { pid: 12345, uid: process.geteuid(), startTicks: '123' } };
  const live = { state: 'R', uid: process.geteuid(), startTicks: '123' };
  let reads = 0;
  let waits = 0;
  assert.equal(await bridgeProcessStopped(bridge, {
    readKernelState: () => ({ ...live, state: ++reads > 2 ? 'Z' : 'R' }),
    verifyLive: () => { throw new Error('Bridge PID identity changed; empty cmdline'); },
    wait: async () => { waits++; },
  }), true);
  assert.equal(waits, 1);
  assert.equal(await bridgeProcessStopped(bridge, {
    readKernelState: () => live, verifyLive: () => {}, wait: async () => assert.fail(),
  }), false);
  await assert.rejects(bridgeProcessStopped(bridge, {
    readKernelState: () => live,
    verifyLive: () => { throw new Error('Bridge PID identity changed; live command altered'); },
    wait: async () => {},
  }), /live command altered/);
});

test('bridge terminal checks reject reused kernel ticks, foreign UID and non-ENOENT inspection failures', async () => {
  const bridge = { identity: { pid: 12345, uid: process.geteuid(), startTicks: '123' } };
  for (const state of [
    { state: 'R', uid: process.geteuid(), startTicks: '124' },
    { state: 'Z', uid: process.geteuid(), startTicks: '124' },
    { state: 'Z', uid: process.geteuid() + 1, startTicks: '123' },
  ]) {
    await assert.rejects(bridgeProcessStopped(bridge, {
      readKernelState: () => state, verifyLive: () => assert.fail('Do not inspect or signal a foreign identity'),
    }), /PID identity changed/);
  }
  assert.equal(await bridgeProcessStopped(bridge, {
    readKernelState: () => { throw Object.assign(new Error('gone'), { code: 'ENOENT' }); },
    verifyLive: () => assert.fail('A gone PID must never be signalled'),
  }), true);
  await assert.rejects(bridgeProcessStopped(bridge, {
    readKernelState: () => { throw Object.assign(new Error('denied'), { code: 'EACCES' }); },
    verifyLive: () => assert.fail(),
  }), /denied/);
});

test('run argument reconstruction strips publication, never adds a shared network and rejects foreign app operands', async t => {
  const s = await fixture(t);
  const input = s.prepared.input;
  const app = input.applications[0];
  const args = ownedFrontendRunArguments(input, app, join(s.workspace, 'central.cid'), 'a'.repeat(36));
  assert.ok(!args.includes('--publish'));
  assert.equal(args[args.indexOf('--network') + 1], s.resources.networkId);
  assert.throws(() => ownedFrontendRunArguments(input, structuredClone(app), join(s.workspace, 'central.cid'), 'a'.repeat(36)));
  assert.throws(() => ownedFrontendRunArguments(input, app, join(s.workspace, 'wrong.cid'), 'a'.repeat(36)));
});

test('Docker timeout without a cidfile recovers only its random-token journal identity before exact cleanup', async t => {
  const s = await fixture(t);
  s.skipCid = true;
  s.timeoutRun = 1;
  const result = await s.launch();
  assert.equal(result.report.status, 'FAILED-NOT-ACCEPTED');
  assert.deepEqual(s.removed, [id(1001)]);
  const state = JSON.parse(fs.readFileSync(join(result.destination, 'launch-state.private.json')));
  assert.equal(state.attempts.length, 1);
  assert.equal(state.attempts[0].containerId, id(1001));
  assert.match(state.attempts[0].launchToken, /^[a-f0-9]{36}$/);
});

test('same-name/image/fixture labels with a foreign invocation token are never adopted or deleted', async t => {
  const s = await fixture(t);
  s.skipCid = true;
  s.timeoutRun = 1;
  s.forgedNonce = true;
  const result = await s.launch();
  assert.equal(result.report.status, 'FAILED-NOT-ACCEPTED');
  assert.deepEqual(s.removed, []);
  const statePath = join(result.destination, 'launch-state.private.json');
  const cleanup = await cleanupOwnedNativeModelDesign({
    workspace: s.workspace, launchDirectory: result.destination,
    stateSha256: hash(fs.readFileSync(statePath)), allowOwnedFrontendCleanup: true,
  }, s.adapters);
  assert.equal(cleanup.status, 'FAILED-NOT-ACCEPTED');
  assert.deepEqual(s.removed, []);
  assert.deepEqual(s.logged, [], 'Foreign invocation collisions must never be logged');
  assert.ok(!fs.readdirSync(result.destination).some(name => name.endsWith('.failure-inspect.private.json')));
  assert.equal(s.containers.length, 9);
});

test('cleanup recovers a delayed no-cid create from the immutable attempt journal', async t => {
  const s = await fixture(t);
  s.skipCid = true;
  s.timeoutRun = 1;
  s.recoveryMisses = 1;
  const result = await s.launch();
  assert.equal(result.report.status, 'FAILED-NOT-ACCEPTED');
  assert.deepEqual(s.removed, []);
  const statePath = join(result.destination, 'launch-state.private.json');
  const cleanup = await cleanupOwnedNativeModelDesign({
    workspace: s.workspace, launchDirectory: result.destination,
    stateSha256: hash(fs.readFileSync(statePath)), allowOwnedFrontendCleanup: true,
  }, s.adapters);
  assert.equal(cleanup.status, 'CLEANED-OWNED-FRONTEND-NOT-ACCEPTED');
  assert.deepEqual(s.removed, [id(1001)]);
  assert.equal(s.containers.length, 8);
});

test('worker repeats full eight-node lifecycle/configuration/storage, bound private input and mounted-content verification', async t => {
  for (const change of [
    s => { s.containers[3].RestartCount++; },
    s => { s.containers[4].State.StartedAt = 'restarted'; },
    s => { s.containers[2].Config.Env.push('MUTATED=true'); },
    s => { s.containers[0].HostConfig.Tmpfs = {}; },
    s => { s.containers[1].NetworkSettings.Networks.shared = {}; },
    s => { write(join(s.base, 'credentials.private.json'), { changed: true }); },
    s => { fs.chmodSync(s.deploymentPath, 0o644); },
    s => { write(join(s.candidate, 'plugins/test/package.json'), { changed: true }); },
    s => {
      const path = join(s.candidate, 'plugins/test/package.json');
      const before = fs.statSync(path);
      const bytes = fs.readFileSync(path);
      bytes[0] ^= 1;
      fs.writeFileSync(path, bytes);
      fs.utimesSync(path, before.atime, before.mtime);
    },
    s => {
      const path = join(s.candidate, 'plugins/test/package.json');
      const bytes = fs.readFileSync(path);
      fs.renameSync(path, `${path}.old`);
      fs.writeFileSync(path, bytes);
    },
    s => { write(join(s.candidate, 'plugins/test/new-file.json'), '{}'); },
    s => { fs.unlinkSync(join(s.candidate, 'plugins/test/package.json')); },
    s => { fs.mkdirSync(join(s.candidate, 'plugins/test/new-empty-directory')); },
  ]) {
    const s = await fixture(t);
    assert.equal((await s.launch()).report.status, 'RUNNING-OWNED-FRONTEND-NOT-ACCEPTED');
    const directories = new PinnedDirectories();
    try {
      const options = {
        workspace: s.workspace, directories, input: s.prepared.input,
        runtime: s.runtime, frontendPins: s.frontendPins, execute: s.adapters.execute,
      };
      verifyOwnedBridgeRuntime(options);
      change(s);
      assert.throws(() => verifyOwnedBridgeRuntime(options));
    } finally { directories.close(); }
  }
});

for (const mode of ['receipt', 'same-size-dist']) {
  test(`source frontend bridge worker rejects ${mode} drift after successful launch`, async t => {
    const s = await fixture(t, { sourceFrontend: true });
    assert.equal((await s.launch()).report.status, 'RUNNING-OWNED-FRONTEND-NOT-ACCEPTED');
    const directories = new PinnedDirectories();
    try {
      const options = {
        workspace: s.workspace, directories, input: s.prepared.input,
        runtime: s.runtime, frontendPins: s.frontendPins, execute: s.adapters.execute,
      };
      verifyOwnedBridgeRuntime(options);
      const path = mode === 'receipt' ? s.original.frontend.receipt.path
        : join(s.original.frontend.dist, 'index.html');
      const before = fs.statSync(path);
      const bytes = fs.readFileSync(path);
      bytes[0] ^= 1;
      fs.writeFileSync(path, bytes);
      fs.utimesSync(path, before.atime, before.mtime);
      assert.equal(fs.statSync(path).size, before.size);
      assert.throws(() => verifyOwnedBridgeRuntime({ ...options, fullMountedHash: false }));
    } finally { directories.close(); }
  });
}

test('mounted metadata captures all directory entries and nanosecond identities without adopting same-size or rename drift', t => {
  const root = fs.mkdtempSync(join(tmpdir(), 'owned-mounted-metadata-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(join(root, 'nested/file'), 'same-size');
  fs.utimesSync(join(root, 'nested/file'), 1700000000, 1700000000);
  fs.mkdirSync(join(root, 'empty'));
  const mounts = [{ source: root, target: '/fixture', readOnly: true }];
  const before = mountedMetadataSnapshot(mounts);
  assert.deepEqual(before[0].entries.map(row => row.path), ['', 'empty', 'nested', 'nested/file']);
  const file = before[0].entries.find(row => row.path === 'nested/file');
  for (const key of ['dev', 'ino', 'mode', 'size', 'mtimeNs', 'ctimeNs']) assert.match(file[key], /^[0-9]+$/);
  write(join(root, 'nested/file'), 'SAME-SIZE');
  fs.utimesSync(join(root, 'nested/file'), 1700000000, 1700000000);
  const after = mountedMetadataSnapshot(mounts);
  const changed = after[0].entries.find(row => row.path === 'nested/file');
  assert.equal(changed.size, file.size);
  assert.equal(changed.mtimeNs, file.mtimeNs);
  assert.notEqual(changed.ctimeNs, file.ctimeNs);
  assert.notDeepEqual(after, before);
  fs.renameSync(join(root, 'nested/file'), join(root, 'nested/moved'));
  assert.notDeepEqual(mountedMetadataSnapshot(mounts), before);
});

test('mounted metadata fails closed when an entry changes between its before/after stat', t => {
  const root = fs.mkdtempSync(join(tmpdir(), 'owned-mounted-changing-stat-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const path = join(root, 'file');
  write(path, 'before');
  const original = fs.lstatSync;
  let changed = false;
  fs.lstatSync = (path, options) => {
    const result = original(path, options);
    if (!changed && typeof path === 'string' && path.endsWith('/file') && options?.bigint) {
      changed = true;
      fs.writeFileSync(join(root, 'file'), 'AFTER!');
    }
    return result;
  };
  try {
    assert.throws(() => mountedMetadataSnapshot([{ source: root, target: '/fixture', readOnly: true }]),
      /changed during metadata inspection/);
  } finally { fs.lstatSync = original; }
});

test('bridge spawn ENOMEM/EAGAIN is handled before PID identity or resource adoption', async t => {
  for (const code of ['ENOMEM', 'EAGAIN']) {
    const s = await fixture(t);
    assert.equal((await s.launch()).report.status, 'RUNNING-OWNED-FRONTEND-NOT-ACCEPTED');
    const directories = new PinnedDirectories();
    let adopted = false;
    let identityRead = false;
    try {
      const directory = directories.open(join(s.workspace, `spawn-${code}`), { create: true, exclusive: true });
      await assert.rejects(() => startLoopbackBridge({
        directory, directories, application: s.prepared.input.applications[0],
        inputFile: { path: s.options.input, bytes: fs.statSync(s.options.input).size, sha256: s.options.inputSha256 },
        pin: s.frontendPins[0].pin, peerIds: s.containers.map(row => row.Id),
        runtime: s.runtime, frontendPins: s.frontendPins,
        registerBridge: () => { adopted = true; },
        readIdentity: () => { identityRead = true; throw new Error('Must not run'); },
        spawnProcess: () => {
          const child = new EventEmitter();
          queueMicrotask(() => child.emit('error', Object.assign(new Error(code), { code })));
          return child;
        },
      }), /bridge failed/);
      assert.equal(adopted, false);
      assert.equal(identityRead, false);
    } finally { directories.close(); }
  }
});

test('real bridge worker owns a loopback socket, rejects PID reuse and forcibly terminates a blocked guard', {
  timeout: 20_000,
}, async t => {
  const s = await fixture(t);
  const launched = await s.launch();
  assert.equal(launched.report.status, 'RUNNING-OWNED-FRONTEND-NOT-ACCEPTED');
  const launcherRoot = join(workspaceRoot, '.artifacts/owned-native-modeldesign-launch');
  const preparedRoot = join(workspaceRoot, '.artifacts/native-model-design-owned-backend');
  fs.mkdirSync(launcherRoot, { recursive: true });
  fs.mkdirSync(preparedRoot, { recursive: true });
  const launchDirectory = fs.mkdtempSync(join(launcherRoot, 'proc-test-'));
  const preparedDirectory = fs.mkdtempSync(join(preparedRoot, 'proc-test-'));
  t.after(() => fs.rmSync(launchDirectory, { recursive: true, force: true }));
  t.after(() => fs.rmSync(preparedDirectory, { recursive: true, force: true }));
  const socket = createServer();
  socket.listen(0, '127.0.0.1');
  await once(socket, 'listening');
  const port = socket.address().port;
  await new Promise(done => socket.close(done));
  const input = structuredClone(s.prepared.input);
  input.applications[0].entry = `http://127.0.0.1:${port}/central/`;
  const inputPath = join(preparedDirectory, 'input.json');
  write(inputPath, input);
  const topologyPath = join(s.workspace, 'docker-fixture.private.json');
  write(topologyPath, { containers: s.containers, network: s.network });
  const blockedPath = join(s.workspace, 'block-docker.private');
  const fakeDocker = join(s.workspace, 'bin/docker');
  write(fakeDocker, `#!${process.execPath}
import fs from 'node:fs';
if (fs.existsSync(${JSON.stringify(blockedPath)})) {
  fs.writeFileSync(${JSON.stringify(`${blockedPath}.entered`)}, String(process.pid));
  const parent = process.ppid;
  for (;;) {
    try {
      const stat = fs.readFileSync('/proc/' + parent + '/stat', 'utf8');
      if (/^[ZX]$/.test(stat.slice(stat.lastIndexOf(') ') + 2).split(' ')[0])) process.exit(0);
    } catch { process.exit(0); }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  }
}
const fixture = JSON.parse(fs.readFileSync(${JSON.stringify(topologyPath)}));
const args = process.argv.slice(2);
let value;
if (args[0] === 'inspect') {
  value = args.slice(1).map(id => fixture.containers.find(row => row.Id === id));
} else if (args[0] === 'network' && args[1] === 'inspect' && args[2] === fixture.network.Id) {
  value = [fixture.network];
} else {
  process.exit(77);
}
process.stdout.write(JSON.stringify(value));
`);
  fs.chmodSync(fakeDocker, 0o700);
  const tool = new URL('../launch-owned-native-modeldesign.mjs', import.meta.url).pathname;
  const specPath = join(launchDirectory, 'central.bridge.private.json');
  const readyPath = join(launchDirectory, 'central.bridge-ready.private.json');
  const runtime = structuredClone(s.runtime);
  const fixtureDirectory = join(workspaceRoot, '.artifacts/native-nonadmin-fixtures', runId);
  assert.ok(!fs.existsSync(fixtureDirectory), 'Reserved synthetic test run must not pre-exist');
  fs.mkdirSync(fixtureDirectory, { recursive: true, mode: 0o700 });
  t.after(() => fs.rmSync(fixtureDirectory, { recursive: true, force: true }));
  const relocated = new Map(runtime.bindings.map((row, index) => [
    row.path, row.path.startsWith(`${s.base}/`)
      ? join(fixtureDirectory, relative(s.base, row.path))
      : join(launchDirectory, 'synthetic-bound-inputs', `${index}.json`),
  ]));
  for (const row of runtime.bindings) {
    let data = fs.readFileSync(row.path);
    if (row.path === runtime.deploymentPath) {
      const value = JSON.parse(data);
      value.imageReceipt.path = relocated.get(runtime.imageReceiptPath);
      data = Buffer.from(json(value));
    }
    write(relocated.get(row.path), data);
  }
  runtime.bindings = runtime.bindings.map(row => {
    const path = relocated.get(row.path);
    const data = fs.readFileSync(path);
    return { ...row, path, bytes: data.length, sha256: hash(data) };
  });
  for (const key of ['manifestPath', 'resourcesPath', 'deploymentPath', 'imageReceiptPath']) {
    runtime[key] = relocated.get(runtime[key]);
  }
  const spec = {
    contract: 'owned-modeldesign-loopback-bridge-v1', application: 'Central',
    input: { path: inputPath, bytes: fs.statSync(inputPath).size, sha256: hash(fs.readFileSync(inputPath)) },
    inputDirectory: preparedDirectory, launcherSha256: hash(fs.readFileSync(tool)),
    pin: launched.report.containers[0].pin, peerIds: s.containers.map(row => row.Id).sort(),
    runtime, frontendPins: s.frontendPins, port, readyPath,
  };
  write(specPath, spec);
  const specSha256 = hash(fs.readFileSync(specPath));
  const child = spawn(process.execPath, [tool, '--bridge-worker', specPath,
    '--bridge-worker-sha256', specSha256], {
    stdio: 'ignore', env: { ...process.env, PATH: `${dirname(fakeDocker)}:${process.env.PATH}` },
  });
  const exited = once(child, 'exit');
  let stopped = false;
  t.after(async () => {
    if (!stopped && child.exitCode === null) {
      const identity = bridgeProcessIdentity(child.pid);
      await stopLoopbackBridge({ identity, specPath, specSha256 });
    }
    await exited;
  });
  for (let attempt = 0; attempt < 100 && !fs.existsSync(readyPath) && child.exitCode === null; attempt++) {
    await new Promise(done => setTimeout(done, 50));
  }
  assert.ok(fs.existsSync(readyPath), 'Real bridge worker must report its own listener');
  const identity = bridgeProcessIdentity(child.pid);
  verifyBridgeProcess(identity, specPath, specSha256);
  await assert.rejects(() => stopLoopbackBridge({
    identity: { ...identity, startTicks: String(Number(identity.startTicks) + 1) }, specPath, specSha256,
  }), /PID identity changed/);
  write(blockedPath, 'block the next read-only fake inspection');
  const client = connect({ host: '127.0.0.1', port });
  client.on('error', () => {});
  await once(client, 'connect');
  assert.equal(client.remoteAddress, '127.0.0.1');
  client.destroy();
  for (let attempt = 0; attempt < 100 && !fs.existsSync(`${blockedPath}.entered`); attempt++) {
    await new Promise(done => setTimeout(done, 20));
  }
  assert.ok(fs.existsSync(`${blockedPath}.entered`));
  assert.deepEqual(await stopLoopbackBridge({ identity, specPath, specSha256 }), { forced: true });
  stopped = true;
  assert.deepEqual(await exited, [null, 'SIGKILL']);
  const inspectedPid = Number(fs.readFileSync(`${blockedPath}.entered`, 'utf8'));
  let inspectionStopped = false;
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const stat = fs.readFileSync(`/proc/${inspectedPid}/stat`, 'utf8');
      if (/^[ZX]$/.test(stat.slice(stat.lastIndexOf(') ') + 2).split(' ')[0])) {
        inspectionStopped = true;
        break;
      }
    } catch (error) {
      if (error.code === 'ENOENT') { inspectionStopped = true; break; }
      throw error;
    }
    await new Promise(done => setTimeout(done, 20));
  }
  assert.ok(inspectionStopped, 'The fake read-only inspection exits after its owned parent');
  const refused = connect({ host: '127.0.0.1', port });
  refused.on('error', () => {});
  await assert.rejects(() => once(refused, 'connect'), /ECONNREFUSED/);
});
