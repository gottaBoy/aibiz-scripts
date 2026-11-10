import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import test from 'node:test';
import {
  backendImageProbeCommand, PINNED_BACKEND_RUNTIME_IMAGE,
} from '../harness-backend-source-images.mjs';
import {
  isolatedLaunchInput, verifyNativeCentralServiceCandidate,
} from '../native-model-design-isolated-launch.mjs';
import {
  mountedTreeSnapshot, ownedBackendNginx, ownedFrontendTopologyWitness,
  prepareOwnedModelDesignInput, verifyOwnedBackendImagesReadOnly,
} from '../native-model-design-owned-backend-input.mjs';
import { nativePlmCounterNginxBlock } from '../prepare-native-ai-code-runtime-assets.mjs';
import { createFixture } from '../prepare-run-owned-native-nonadmin-fixture.mjs';
import { ownedServiceTmpfs, ZOOKEEPER_IMAGE_ID } from '../owned-backend-resources.mjs';
import { readTree } from '../native-candidate-files.mjs';
import { createCentralServiceFixture } from './native-central-service-fixture.mjs';

const workspaceRoot = new URL('../../', import.meta.url).pathname;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const id = number => number.toString(16).padStart(64, '0');
const image = number => `sha256:${id(number)}`;
const runId = 'f01006abcdef';
const privateMarker = 'deadbeefdeadbeefdeadbeefdeadbeefdead';
const nginxSource = fs.readFileSync(join(workspaceRoot, 'modelingweb/nginx-native.conf'), 'utf8');

test('Central service candidate binding mounts only its verified GridView output', t => {
  const workspace = fs.mkdtempSync(join(tmpdir(), 'central-service-binding-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const binding = createCentralServiceFixture(workspace);
  const input = isolatedLaunchInput({
    workspace, candidate: join(workspace, '.artifacts/native-model-migration/test'),
    assets: join(workspace, '.artifacts/native-ai-code-runtime-assets/test'),
    name: 'central-service-binding-unit', serviceCandidate: binding,
  });
  const mount = input.mounts.find(row => row.target ===
    '/app/model/PSSYSAPPS/Central/PSAPPDEVIEWS/PSDevSlnGridView.json');
  assert.ok(mount);
  assert.equal(mount.source, binding.file.path);
  assert.equal(mount.readOnly, true);
  assert.equal(input.serviceCandidate.receipt.sha256, binding.receipt.sha256);
});

for (const mutate of [
  row => { row.receipt.bytes = 0; },
  row => { row.file.sha256 = 'invalid'; },
  row => { row.file.path = '/tmp/shared.json'; },
  row => { row.receipt.path = '/tmp/receipt.json'; },
  row => { row.receipt.unreviewed = true; },
  row => { row.file.bytes = 1.5; },
]) {
  test('pure Central binding constructor rejects unsafe fields before any mount plan', t => {
    const workspace = fs.mkdtempSync(join(tmpdir(), 'central-service-invalid-'));
    t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
    const binding = createCentralServiceFixture(workspace);
    mutate(binding);
    assert.throws(() => isolatedLaunchInput({ workspace, name: 'central-invalid-test',
      candidate: join(workspace, 'candidate'), assets: join(workspace, 'assets'), serviceCandidate: binding }));
  });
}

for (const kind of ['receipt', 'model', 'unreadable-model', 'during-verification']) {
  test(`Central candidate verification rejects ${kind} drift`, t => {
    const workspace = fs.mkdtempSync(join(tmpdir(), 'central-service-drift-'));
    t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
    const binding = createCentralServiceFixture(workspace);
    const verify = () => verifyNativeCentralServiceCandidate({
      workspace, receiptPath: binding.receipt.path,
    });
    if (kind === 'during-verification') {
      assert.throws(() => verifyNativeCentralServiceCandidate({
        workspace, receiptPath: binding.receipt.path,
      }, { verify: () => {
        fs.appendFileSync(binding.file.path, '\n');
        return { contract: 'native-central-published-query-candidate',
          permissionAcceptance: { status: 'not-accepted' },
          outputs: [{ path: 'PSSYSAPPS/Central/PSAPPDEVIEWS/PSDevSlnGridView.json',
            sha256: binding.file.sha256 }] };
      } }), /changed during verification/);
    } else {
      if (kind === 'unreadable-model') fs.chmodSync(binding.file.path, 0o600);
      else fs.appendFileSync(kind === 'receipt' ? binding.receipt.path : binding.file.path, 'x');
      assert.throws(verify);
    }
  });
}

function write(path, value, mode = 0o600) {
  fs.mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path, typeof value === 'string' || Buffer.isBuffer(value) ? value : json(value), { mode });
}

test('mounted inventory hashes every file without retaining payloads or skipping generated directories', t => {
  const root = fs.mkdtempSync(join(tmpdir(), 'owned-mounted-inventory-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(join(root, 'index.html'), '<html></html>');
  write(join(root, 'target/plugin.js'), 'export default {};');
  write(join(root, '.artifacts/manifest.json'), { fixture: true });
  const tree = readTree(root, { jsonOnly: false });
  const inventory = mountedTreeSnapshot(root);
  for (const key of ['files', 'bytes', 'fingerprintKind', 'fingerprint']) {
    assert.equal(inventory[key], tree[key]);
  }
  assert.equal(inventory.files, 3);
  assert.deepEqual(Object.keys(inventory).sort(), ['bytes', 'files', 'fingerprint', 'fingerprintKind']);
  write(join(root, 'target/plugin.js'), 'export default 42;');
  assert.notEqual(mountedTreeSnapshot(root).fingerprint, inventory.fingerprint);
});

test('mounted inventory fails closed at byte/file limits, unsafe entries and symlink ancestors', t => {
  const root = fs.mkdtempSync(join(tmpdir(), 'owned-mounted-bounds-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  write(join(root, 'a'), '12');
  write(join(root, 'b'), '34');
  assert.equal(mountedTreeSnapshot(root, { maxBytes: 4, maxFiles: 2 }).bytes, 4);
  assert.throws(() => mountedTreeSnapshot(root, { maxBytes: 3 }), /size budget/);
  assert.throws(() => mountedTreeSnapshot(root, { maxFiles: 1 }), /Too many mounted files/);
  assert.throws(() => mountedTreeSnapshot(root, { maxBytes: 513 * 1024 * 1024 }));
  assert.throws(() => mountedTreeSnapshot(root, { maxFiles: 50_001 }));
  fs.symlinkSync(join(root, 'a'), join(root, 'linked'));
  assert.throws(() => mountedTreeSnapshot(root), /Symlink/);
  fs.unlinkSync(join(root, 'linked'));
  fs.symlinkSync(root, join(root, 'linked'));
  assert.throws(() => mountedTreeSnapshot(join(root, 'linked')), /Symlink/);
  fs.unlinkSync(join(root, 'linked'));
  write(join(root, 'bad\\name'), 'x');
  assert.throws(() => mountedTreeSnapshot(root), /Invalid directory entry/);
});

function fixture(t, { sourceFrontend = false, service = false } = {}) {
  const workspace = fs.mkdtempSync(join(tmpdir(), 'owned-frontend-rebinding-'));
  t.after(() => fs.rmSync(workspace, { force: true, recursive: true }));
  const { manifest } = createFixture({
    runId, scenario: 'two-center', passwordStorageMode: 'sm3',
    modelVersion: 816, uaaSchemaMode: 'legacy-views', secret: () => privateMarker,
  });
  const run = join(workspace, '.artifacts/native-nonadmin-fixtures', runId);
  const resources = {
    contract: 'run-owned-native-fixture-resources-v1', runId, mysqlId: id(1), networkId: id(2),
    mysqlImage: image(3), mysqlName: manifest.ownership.mysqlContainer,
    networkName: manifest.ownership.network, schemas: manifest.schemas,
  };
  const network = {
    Id: resources.networkId, Name: resources.networkName, Internal: true, Driver: 'bridge',
    Labels: { [manifest.ownership.label]: runId },
    IPAM: { Config: [{ Subnet: '172.28.0.0/16', Gateway: '172.28.0.1' }] }, Containers: {},
  };
  const roles = ['mysql', 'allinone', 'gateway', 'provider', 'uaa', 'redis', 'nacos', 'zookeeper'];
  const containers = roles.map((role, index) => {
    const container = {
      Id: role === 'mysql' ? resources.mysqlId : id(index + 3),
      Name: role === 'mysql' ? `/${resources.mysqlName}` : `/nf-${runId}-${role}`,
      Image: role === 'mysql' ? resources.mysqlImage : image(index + 10),
      State: { Running: true, StartedAt: 'fixture-start-only' }, RestartCount: 0,
      Config: { Labels: { [manifest.ownership.label]: runId }, Env: [`FIXTURE_SECRET=${privateMarker}`] },
      Mounts: [], HostConfig: { Privileged: false, PortBindings: {}, ...(role === 'mysql'
        ? { Tmpfs: { '/var/lib/mysql': 'rw,nosuid,nodev,size=1073741824' } } : {}) },
      NetworkSettings: { Ports: null, Networks: { [network.Name]: {
        NetworkID: network.Id, EndpointID: id(index + 20),
        IPAddress: `172.28.0.${index + 2}`, IPPrefixLen: 16, Gateway: '',
      } } },
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
    if (role === 'mysql') container.NetworkSettings.Ports = { '3306/tcp': null };
    const attachment = container.NetworkSettings.Networks[network.Name];
    network.Containers[container.Id] = {
      Name: container.Name.slice(1), EndpointID: attachment.EndpointID,
      IPv4Address: `${attachment.IPAddress}/16`,
    };
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
  const imageReportPath = join(workspace, '.artifacts/source-images/report.json');
  write(imageReportPath, imageReport);
  const deployment = {
    contract: 'run-owned-native-permission-deployment-input-v2', runId, services,
    imageReceipt: { path: imageReportPath, sha256: hash(json(imageReport)) },
    auxiliaryContainers: ['redis', 'nacos', 'zookeeper'].map((role, index) => ({
      containerId: containers[index + 5].Id, imageId: containers[index + 5].Image, role,
    })),
    endpoints: { uaa: endpoint('uaa'), backend: endpoint('gateway') },
  };
  const deploymentPath = join(run, 'backend-runtime-unit/deployment-input.private.json');
  const candidate = join(workspace, '.artifacts/native-model-migration/unit');
  const assets = join(workspace, '.artifacts/native-ai-code-runtime-assets/unit');
  write(join(candidate, 'receipt.json'), { contract: 'synthetic-source-fixture-only' });
  write(join(candidate, 'plugins/fixture/package.json'), { synthetic: true });
  write(join(assets, 'nginx-native.conf'), nginxSource);
  write(join(assets, 'extras/json/system-import.json'), { imports: { fixture: 'fixture-no-native' } });
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
    workspace, candidate, assets, name: 's07-original-unit', centralPort: 32448, modeldesignPort: 32449,
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
    } else {
      write(mount.source, mount.source.endsWith('.json') ? { synthetic: true } : 'synthetic test input\n');
    }
  }
  const launchPath = join(workspace, '.artifacts/native-model-design-isolated/unit/input.json');
  const originalReport = {
    contract: 'native-model-design-isolated-launch', inputSha256: hash(json(original)),
    run: false, status: 'PREPARED-NOT-ACCEPTED', containers: [], errors: [],
    nativeAccepted: false, acceptedForProduction: false,
  };
  write(launchPath, original);
  write(join(dirname(launchPath), 'report.json'), originalReport);
  write(join(run, 'manifest.json'), manifest);
  write(join(run, 'owned-resources.json'), resources);
  write(join(run, 'credentials.private.json'), { password: privateMarker });
  write(deploymentPath, deployment);
  const commands = [];
  const state = {
    workspace, run, candidate, assets, launchPath, original, originalReport,
    manifest, resources, containers, network, imageReport, imageReportPath, deployment, deploymentPath, assetReceipt,
    frontendImage: { Id: image(99), Os: 'linux' }, commands, assetChecks: 0, imageChecks: 0,
    onAssets() {}, onImages() {}, onExecute() {},
  };
  state.options = {
    workspace, launchInput: relative(workspace, launchPath), launchInputSha256: hash(json(original)),
    deploymentInput: relative(workspace, deploymentPath), deploymentInputSha256: hash(json(deployment)),
    name: 's07-owned-unit', output: join(workspace, '.artifacts/native-model-design-owned-backend/unit'),
  };
  state.adapters = {
    verifyAssets: () => {
      state.assetChecks++;
      state.onAssets(state);
      return { directory: assets, candidate, receipt: structuredClone(assetReceipt) };
    },
    verifyImages: () => {
      state.imageChecks++;
      state.onImages(state);
      return { report: structuredClone(imageReport), reportSha256: hash(fs.readFileSync(imageReportPath)),
        imageArtifactBindingVerified: true, freshImageFileProbeExecuted: false,
        verificationMode: 'source-and-recorded-probes-with-live-image-inspection' };
    },
    execute: (executable, args) => {
      commands.push({ executable, args });
      state.onExecute(state, args);
      assert.equal(executable, 'docker', 'Fixture must not launch a shell, browser or HTTP client');
      let value;
      if (args[0] === 'network' && args[1] === 'inspect') value = [state.network];
      else if (args[0] === 'inspect') value = state.containers;
      else if (args[0] === 'image' && args[1] === 'inspect') value = [state.frontendImage];
      else assert.fail('Fixture must not invoke a mutating Docker command');
      return { status: 0, signal: null, stdout: json(value) };
    },
  };
  state.saveOriginal = () => {
    state.options.launchInputSha256 = hash(json(original));
    originalReport.inputSha256 = state.options.launchInputSha256;
    write(launchPath, original);
    write(join(dirname(launchPath), 'report.json'), originalReport);
  };
  state.saveDeployment = () => {
    state.options.deploymentInputSha256 = hash(json(deployment));
    write(deploymentPath, deployment);
  };
  state.prepare = () => prepareOwnedModelDesignInput(state.options, state.adapters);
  return state;
}

test('owned preparation preserves explicit source frontend and binds its receipt', async t => {
  const s = fixture(t, { sourceFrontend: true });
  const result = await s.prepare();
  assert.deepEqual(result.input.frontend, s.original.frontend);
  assert.equal(result.input.mounts.find(row => row.target === '/opt/aibiz/local-dist').source,
    s.original.frontend.dist);
  assert.ok(!result.input.mounts.some(row => row.source === join(s.workspace, 'modelingweb/app/dist')));
  assert.equal(s.assetChecks, 2);
});

test('owned preparation preserves the fully verified Central service binding', async t => {
  const s = fixture(t, { service: true });
  const result = await s.prepare();
  assert.deepEqual(result.input.serviceCandidate, s.original.serviceCandidate);
  assert.ok(result.input.mounts.some(row => row.source === s.original.serviceCandidate.file.path
    && row.target === '/app/model/PSSYSAPPS/Central/PSAPPDEVIEWS/PSDevSlnGridView.json' && row.readOnly));
});

test('owned preparation rejects a Central receipt changed during final asset revalidation', async t => {
  const s = fixture(t, { service: true });
  s.onAssets = () => {
    if (s.assetChecks === 2) fs.appendFileSync(s.original.serviceCandidate.receipt.path, '\n');
  };
  await assert.rejects(s.prepare, /refused/);
  assert.ok(!fs.existsSync(s.options.output));
});

for (const mode of ['mismatched-assets', 'receipt-drift', 'receipt-drift-during-inspection']) {
  test(`owned preparation rejects explicit frontend ${mode}`, async t => {
    const s = fixture(t, { sourceFrontend: true });
    if (mode === 'mismatched-assets') delete s.assetReceipt.frontend;
    else if (mode === 'receipt-drift') write(s.original.frontend.receipt.path, { changed: true });
    else s.onImages = () => write(s.original.frontend.receipt.path, { changed: true });
    await assert.rejects(s.prepare, /refused/);
    assert.ok(!fs.existsSync(s.options.output));
    assert.ok(s.commands.every(row => ['inspect', 'network', 'image'].includes(row.args[0])));
  });
}

test('pure fixture prepares only immutable owned input, preserves source hashes and never launches/requests', async t => {
  const s = fixture(t);
  const originalBytes = fs.readFileSync(s.launchPath);
  const nginxBytes = fs.readFileSync(join(s.assets, 'nginx-native.conf'));
  const result = await s.prepare();
  assert.equal(result.report.status, 'PREPARED-NOT-ACCEPTED');
  for (const key of ['run', 'launchAuthorized', 'nativeAccepted', 'permissionAcceptance',
    'acceptedForProduction', 'credentialsIncluded', 'freshImageFileProbeExecuted']) assert.equal(result.report[key], false);
  assert.equal(result.report.containersStarted, 0);
  assert.equal(result.report.httpRequestsSent, 0);
  assert.deepEqual(result.input.evidence, s.original.evidence);
  assert.deepEqual(fs.readFileSync(s.launchPath), originalBytes);
  assert.deepEqual(fs.readFileSync(join(s.assets, 'nginx-native.conf')), nginxBytes);
  assert.equal(result.report.inputSha256, hash(fs.readFileSync(join(result.destination, 'input.json'))));
  assert.equal(result.report.nginxSha256, hash(fs.readFileSync(join(result.destination, 'nginx-native.conf'))));
  assert.equal(result.report.originalLaunchInput.sha256, s.options.launchInputSha256);
  assert.equal(result.report.ownedBackend.deploymentInput.sha256, s.options.deploymentInputSha256);
  assert.equal(result.report.ownedBackend.resources.path, join(s.run, 'owned-resources.json'));
  assert.equal(result.report.ownedBackend.resources.sha256,
    hash(fs.readFileSync(join(s.run, 'owned-resources.json'))));
  assert.ok(result.report.topology.containers.some(row => row.image === ZOOKEEPER_IMAGE_ID));
  assert.equal(result.report.mountedInputs.length, s.original.mounts.length);
  assert.ok(s.assetChecks === 2 && s.imageChecks === 2, 'Both source and topology must be reverified');
  assert.equal(s.commands.length, 6);
  for (const app of result.input.applications) {
    assert.equal(app.args[app.args.indexOf('--network') + 1], s.network.Id);
    assert.ok(!app.args.includes('compose_agent_network'));
    assert.ok(app.args.includes(s.frontendImage.Id));
    assert.ok(!app.args.includes('aibiz/modelingweb:local'));
    assert.ok(app.args.includes(`${s.manifest.ownership.label}=${runId}`));
    assert.equal(app.environment.NATIVE_PLATFORM_HOST, '172.28.0.4');
    assert.deepEqual(app.environment, {
      ...s.original.applications.find(item => item.application === app.application).environment,
      NATIVE_PLATFORM_HOST: '172.28.0.4',
      REQUIRE_ORGANIZATION_CONTEXT: 'true',
      ...(app.application === 'Central'
        ? { NATIVE_DEVELOPMENT_CENTER_ID: s.manifest.roots[0].centerId }
        : { NATIVE_MODELING_SYSTEM_ID: s.manifest.roots[0].rootId }),
    });
    assert.ok(app.args.includes(`type=bind,src=${result.destination}/nginx-native.conf,dst=/opt/aibiz/nginx-native.conf,readonly`));
  }
  assert.deepEqual(result.input.mounts.slice(1), s.original.mounts.slice(1));
  assert.equal(result.input.network, s.network.Id);
  assert.equal(result.input.ownedBackend.modelDesignRoot, s.manifest.roots[0].rootId);
  assert.ok(result.input.applications[1].args.includes(
    `NATIVE_MODELING_SYSTEM_ID=${s.manifest.roots[0].rootId}`));
  assert.ok(!result.input.applications[0].args.some(value =>
    value.startsWith('NATIVE_MODELING_SYSTEM_ID=')));
  assert.deepEqual(fs.readdirSync(result.destination).sort(), ['input.json', 'nginx-native.conf', 'report.json']);
  for (const name of fs.readdirSync(result.destination)) {
    const bytes = fs.readFileSync(join(result.destination, name), 'utf8');
    assert.ok(!bytes.includes(privateMarker));
    assert.ok(!bytes.includes('credentials.private.json'));
  }
  assert.equal(fs.statSync(join(result.destination, 'nginx-native.conf')).mode & 0o777, 0o644);
  assert.equal(fs.statSync(result.destination).mode & 0o777, 0o755);
  await assert.rejects(s.prepare, /refused/);
});

test('Docker bind-mount enumeration order is not topology drift; all mount fields remain bound', t => {
  const s = fixture(t);
  s.containers[2].Mounts = [
    { Type: 'bind', Source: join(s.run, 'manifest.json'), Destination: '/app/model', RW: false },
    { Type: 'bind', Source: join(s.run, 'owned-resources.json'), Destination: '/app/config', RW: false },
  ];
  const topology = { network: s.network, image: s.frontendImage, containers: s.containers };
  const before = ownedFrontendTopologyWitness(topology);
  s.containers[2].Mounts.reverse();
  assert.deepEqual(ownedFrontendTopologyWitness(topology), before);
});

for (const field of ['Source', 'Destination', 'RW']) {
  test(`bind-mount ${field} drift changes the bound topology witness`, t => {
    const s = fixture(t);
    s.containers[2].Mounts = [
      { Type: 'bind', Source: join(s.run, 'manifest.json'), Destination: '/app/model', RW: false },
    ];
    const topology = { network: s.network, image: s.frontendImage, containers: s.containers };
    const before = ownedFrontendTopologyWitness(topology);
    s.containers[2].Mounts[0][field] = field === 'RW' ? true
      : field === 'Source' ? join(s.run, 'owned-resources.json') : '/app/changed';
    assert.notDeepEqual(ownedFrontendTopologyWitness(topology), before);
    assert.ok(!fs.existsSync(s.options.output));
  });
}

test('nginx preserves all native static blocks and routes APIs only to owned gateway/UAA with no redirect fallback', () => {
  const origins = { backend: 'http://172.28.0.4:30086', uaa: 'http://172.28.0.6:32666' };
  const output = ownedBackendNginx(nginxSource, origins);
  assert.ok(!output.includes('/ibizmodeling/modelapi'));
  assert.match(output, /location \^~ \/api\/nativeapicode\/ \{\n\s*proxy_pass \$native_service;/);
  assert.match(output, /rewrite \^\/api\/nativeapicode\/v7\/\(\.\*\)\$ \/v7\/\$1 break;/);
  assert.match(output, /rewrite \^ \/appdata break;\n\s*proxy_pass \$native_auth;/);
  assert.equal(output.match(/proxy_hide_header Location;/g).length, 7);
  assert.equal(output.match(/proxy_hide_header Refresh;/g).length, 7);
  const staticBlocks = source => [...source.matchAll(/    location[^{}]*\{[^{}]*\}/g)]
    .map(match => match[0]).filter(block => !block.includes('proxy_pass'));
  assert.deepEqual(staticBlocks(output), staticBlocks(nginxSource));
  for (const source of [
    nginxSource + '\nproxy_pass http://shared;\n', nginxSource + '\ninclude shared.conf;\n',
    nginxSource.replace('http://modelingservice:32002', 'http://shared:32002'),
    nginxSource + '\nerror_page 500 = http://shared;\n',
  ]) assert.throws(() => ownedBackendNginx(source, origins));
  for (const backend of ['http://8.8.8.8:30086', 'http://127.0.0.1:30086', 'http://shared:30086',
    'http://172.28.0.4:30086/path', 'http://secret@172.28.0.4:30086', 'https://172.28.0.4:30086']) {
    assert.throws(() => ownedBackendNginx(nginxSource, { ...origins, backend }));
  }
});

test('nginx drops the localized PLM counter bridge before rebinding to the owned private network', () => {
  const origins = { backend: 'http://172.28.0.4:30086', uaa: 'http://172.28.0.6:32666' };
  const anchor = '    location ^~ /api/nativeapicode/v7/ {';
  const block = nativePlmCounterNginxBlock();
  assert.equal(nginxSource.split(anchor).length, 2);
  const bridged = nginxSource.replace(anchor, `${block}\n\n${anchor}`);
  assert.match(bridged, /location = \/api\/nativeapicode\/work_items\/count_my_todo \{/);
  assert.match(bridged, /set \$native_plm_service http:\/\/plmservice:30251;/);
  // The owned deployment has no PLM service, so the bridge must vanish entirely.
  assert.equal(ownedBackendNginx(bridged, origins), ownedBackendNginx(nginxSource, origins));
  assert.throws(() => ownedBackendNginx(bridged.replace('plmservice:30251', 'shared:30251'), origins));
});

test('owned overlay preserves real platform failures and never fabricates successful data', () => {
  const origins = { backend: 'http://172.28.0.4:30086', uaa: 'http://172.28.0.6:32666' };
  const output = ownedBackendNginx(nginxSource, origins);
  assert.doesNotMatch(output, /\breturn\s+20[0-9]\b/);
  assert.doesNotMatch(output, /fetch_cur_receiver|SysOperator|count_my_todo/);
  assert.match(output, /location \^~ \/api\/nativeapicode\/extension\//);
  assert.match(output, /rewrite \^\/api\/nativeapicode\/extension\/\(\.\*\)\$ \/extension\/\$1 break;/);
  assert.doesNotMatch(output, /\/extension\/api\/\$1/);
  assert.match(output, /location \^~ \/api\/nativeapicode\/configs\//);
  const appdata = output.slice(output.indexOf('location = /api/nativeapicode/appdata {'));
  const block = appdata.slice(0, appdata.indexOf('\n    }'));
  assert.match(block, /proxy_pass \$native_auth;/);
  assert.doesNotMatch(block, /proxy_pass \$native_uaa;|proxy_set_header srforgid/);
});

for (const [name, mutate] of [
  ['absent caller launch hash', s => { delete s.options.launchInputSha256; }],
  ['absent caller deployment hash', s => { delete s.options.deploymentInputSha256; }],
  ['wrong caller launch hash', s => { s.options.launchInputSha256 = id(77); }],
  ['wrong caller deployment hash', s => { s.options.deploymentInputSha256 = id(77); }],
  ['altered original launch without refreshed hash', s => { write(s.launchPath, `${json(s.original)} `); }],
  ['original report does not bind launch bytes', s => {
    s.originalReport.inputSha256 = id(88); write(join(dirname(s.launchPath), 'report.json'), s.originalReport);
  }],
  ['original report claims running deployment', s => {
    s.originalReport.run = true; write(join(dirname(s.launchPath), 'report.json'), s.originalReport);
  }],
  ['injected mount', s => { s.original.mounts.push({ source: '/tmp/shared', target: '/shared', readOnly: false }); s.saveOriginal(); }],
  ['injected Docker command', s => { s.original.applications[0].args.push('--privileged'); s.saveOriginal(); }],
  ['credential environment injection', s => { s.original.applications[0].environment.TOKEN = privateMarker; s.saveOriginal(); }],
  ['divergent source evidence', s => { s.original.evidence.runtime.sha256 = id(88); s.saveOriginal(); }],
  ['changed candidate receipt', s => { write(join(s.candidate, 'receipt.json'), { changed: true }); }],
  ['changed runtime asset receipt', s => { write(join(s.assets, 'receipt.json'), { changed: true }); }],
  ['source validator failure', s => { s.onAssets = () => { throw new Error(privateMarker); }; }],
  ['backend source validator failure', s => { s.onImages = () => { throw new Error(privateMarker); }; }],
  ['missing private deployment', s => { fs.unlinkSync(s.deploymentPath); }],
  ['malformed private deployment', s => {
    write(s.deploymentPath, privateMarker); s.options.deploymentInputSha256 = hash(privateMarker);
  }],
  ['readable private deployment', s => { fs.chmodSync(s.deploymentPath, 0o644); }],
  ['readable private resources', s => { fs.chmodSync(join(s.run, 'owned-resources.json'), 0o644); }],
  ['missing canonical resources journal', s => {
    fs.renameSync(join(s.run, 'owned-resources.json'), join(s.run, 'resources.private.json'));
  }],
  ['v1 backend input', s => { s.deployment.contract = 'run-owned-native-permission-deployment-input-v1'; s.saveDeployment(); }],
  ['loopback fallback', s => {
    s.deployment.endpoints.backend.transport = 'loopback-publication';
    s.deployment.endpoints.backend.origin = 'http://127.0.0.1:30086'; s.saveDeployment();
  }],
  ['unexpected credentials in v2 schema', s => { s.deployment.password = privateMarker; s.saveDeployment(); }],
  ['missing endpoint pin', s => { delete s.deployment.endpoints.uaa.endpointId; s.saveDeployment(); }],
  ['wrong private IP', s => { s.deployment.endpoints.backend.ipv4 = '172.28.0.90'; s.saveDeployment(); }],
  ['stale image receipt hash', s => { s.deployment.imageReceipt.sha256 = id(90); s.saveDeployment(); }],
  ['wrong fixture run', s => { s.deployment.runId = '000000000000'; s.saveDeployment(); }],
  ['shared network', s => { s.network.Name = 'compose_agent_network'; }],
  ['non-internal network', s => { s.network.Internal = false; }],
  ['stale network identity', s => { s.network.Id = id(90); }],
  ['shared or undeclared network peer', s => { s.network.Containers[id(90)] = { Name: 'shared' }; }],
  ['mislabeled backend', s => { s.containers[2].Config.Labels[s.manifest.ownership.label] = 'shared'; }],
  ['stale backend image', s => { s.containers[2].Image = image(90); }],
  ['backend public port', s => {
    s.containers[2].HostConfig.PortBindings = { '30086/tcp': [{ HostIp: '127.0.0.1', HostPort: '30086' }] };
  }],
  ['other service publication', s => {
    s.containers[1].NetworkSettings.Ports = { '30000/tcp': [{ HostIp: '127.0.0.1', HostPort: '30000' }] };
  }],
  ['unexpected auxiliary peer role', s => { s.deployment.auxiliaryContainers[0].role = 'shared'; s.saveDeployment(); }],
  ['duplicate auxiliary role', s => {
    s.deployment.auxiliaryContainers[2].role = 'redis'; s.saveDeployment();
  }],
  ['undeclared ZooKeeper', s => { s.deployment.auxiliaryContainers.pop(); s.saveDeployment(); }],
  ['stale ZooKeeper image', s => { s.containers.at(-1).Image = image(90); }],
  ['ZooKeeper shared storage', s => {
    s.containers.at(-1).Mounts.push({ Type: 'volume', RW: true, Source: 'shared-data' });
  }],
  ['privileged peer', s => { s.containers[1].HostConfig.Privileged = true; }],
  ['extra backend network', s => { s.containers[2].NetworkSettings.Networks.shared = {}; }],
  ['stopped UAA', s => { s.containers[4].State.Running = false; }],
  ['uncanonical frontend image identity', s => { s.frontendImage.Id = 'mutable:tag'; }],
  ['Docker stderr secret', s => {
    s.adapters.execute = () => ({ status: 1, signal: null, stderr: privateMarker, stdout: privateMarker });
  }],
  ['foreign output', s => { s.options.output = join(s.workspace, 'shared-output'); }],
  ['symlink output parent', s => {
    fs.symlinkSync(s.run, join(s.workspace, '.artifacts/native-model-design-owned-backend'));
  }],
  ['symlink mounted source', s => {
    const path = join(s.candidate, 'plugins/fixture/package.json');
    fs.renameSync(path, `${path}.original`); fs.symlinkSync(`${path}.original`, path);
  }],
  ['symlink private input', s => {
    fs.renameSync(s.deploymentPath, `${s.deploymentPath}.original`);
    fs.symlinkSync(`${s.deploymentPath}.original`, s.deploymentPath);
  }],
  ['symlink fixture ancestor', s => {
    fs.renameSync(s.run, `${s.run}-original`); fs.symlinkSync(`${s.run}-original`, s.run);
  }],
]) {
  test(`pure fixture refuses ${name}, emits no private values and writes no output`, async t => {
    const s = fixture(t);
    mutate(s);
    let error;
    try { await s.prepare(); } catch (caught) { error = caught; }
    assert.ok(error, name);
    assert.match(error.message, /^Owned frontend preparation refused at [a-z-]+; private details suppressed$/);
    assert.ok(!String(error).includes(privateMarker));
    assert.ok(!fs.existsSync(join(s.workspace, '.artifacts/native-model-design-owned-backend/unit')));
    assert.ok(!fs.existsSync(join(s.workspace, 'shared-output')));
  });
}

for (const [name, mutate] of [
  ['source files changed during revalidation', s => { write(join(s.assets, 'extras/json/system-import.json'), { drift: true }); }],
  ['six model bytes changed during revalidation', s => { write(s.original.mounts.at(-1).source, { drift: true }); }],
  ['Docker restart between inspections', s => { s.containers[2].RestartCount++; }],
  ['Docker image retag between inspections', s => { s.frontendImage.Id = image(88); }],
  ['Docker configuration change between inspections', s => { s.containers[2].Config.Env.push(`NEW=${privateMarker}`); }],
  ['deployment bytes changed after inspection', s => { write(s.deploymentPath, `${json(s.deployment)} `); }],
  ['deployment permissions changed after inspection', s => { fs.chmodSync(s.deploymentPath, 0o644); }],
  ['resources journal changed after inspection', s => {
    write(join(s.run, 'owned-resources.json'), `${json(s.resources)} `);
  }],
  ['resources permissions changed after inspection', s => {
    fs.chmodSync(join(s.run, 'owned-resources.json'), 0o644);
  }],
  ['source receipt changed after inspection', s => { write(s.imageReportPath, `${json(s.imageReport)} `); }],
]) {
  test(`pure fixture rejects ${name} before creating output`, async t => {
    const s = fixture(t);
    s.onImages = () => { if (s.imageChecks === 2) mutate(s); };
    await assert.rejects(s.prepare, /refused/);
    assert.ok(!fs.existsSync(s.options.output));
  });
}

test('production CLI has no run or bypass switches and does not echo invalid private arguments', () => {
  const tool = join(workspaceRoot, 'scripts/native-model-design-owned-backend-input.mjs');
  const help = spawnSync(process.execPath, [tool, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /no launch\/HTTP/);
  for (const option of ['--run', '--skip-verify', '--backend-origin']) {
    const result = spawnSync(process.execPath, [tool, option, privateMarker], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.ok(!`${result.stdout}${result.stderr}`.includes(privateMarker));
  }
});

function imageReplayFixture(t) {
  const workspace = fs.mkdtempSync(join(tmpdir(), 'owned-readonly-images-'));
  t.after(() => fs.rmSync(workspace, { force: true, recursive: true }));
  const reportPath = join(workspace, '.artifacts/images/report.json');
  const report = {
    components: ['allinone', 'gateway', 'provider'].map((name, index) => ({
      name, image: { id: image(index + 10) }, reference: `test-image-${name}`,
      probeName: `backend-image-probe-00000000-0000-0000-0000-000000000000-${name}`,
      imageFiles: [{ path: '/fixture.jar' }],
    })), commands: [],
  };
  for (const component of report.components) {
    const probe = backendImageProbeCommand({
      imageId: component.image.id, name: component.probeName,
      files: component.imageFiles.map(row => row.path),
    });
    const bytes = `${hash(component.name)} */fixture.jar\0`;
    const log = { path: `${component.name}-probe.log`, bytes: Buffer.byteLength(bytes), sha256: hash(bytes) };
    write(join(dirname(reportPath), log.path), bytes);
    report.commands.push({ ...probe, exitCode: 0, error: null, signal: null, log });
  }
  write(reportPath, report);
  const executions = [];
  const state = {
    workspace, reportPath, report, executions, onVerify() {},
    execute: (executable, args) => {
      executions.push({ executable, args });
      assert.equal(executable, 'docker');
      assert.deepEqual(args.slice(0, 4), ['image', 'inspect', '--format', '{{json .}}']);
      return { status: 0, signal: null, stdout: 'synthetic immutable image inspection only' };
    },
    verifyImages: ({ execute }) => {
      state.onVerify(execute);
      for (const reference of [PINNED_BACKEND_RUNTIME_IMAGE, ...report.components.map(row => row.reference)]) {
        execute('docker', ['image', 'inspect', '--format', '{{json .}}', reference], {});
      }
      for (const command of report.commands) {
        const result = execute(command.executable, command.args, {});
        assert.equal(result.stdout, fs.readFileSync(join(dirname(reportPath), command.log.path), 'utf8'));
      }
      return { reportPath, reportSha256: hash(fs.readFileSync(reportPath)), report,
        imageArtifactBindingVerified: true };
    },
  };
  return state;
}

test('read-only image adapter binds and replays recorded immutable probes while actual executor only inspects', t => {
  const s = imageReplayFixture(t);
  const result = verifyOwnedBackendImagesReadOnly(s);
  assert.equal(s.executions.length, 4);
  assert.equal(result.verificationMode, 'source-and-recorded-probes-with-live-image-inspection');
  assert.equal(result.freshImageFileProbeExecuted, false);
});

for (const [name, change] of [
  ['probe log changed', s => { write(join(dirname(s.reportPath), 'gateway-probe.log'), privateMarker); }],
  ['probe attempts a mutable image', s => {
    const args = s.report.commands[1].args;
    args[args.indexOf('--zero') - 1] = 'mutable-image:latest'; write(s.reportPath, s.report);
  }],
  ['extra mutating command', s => { s.onVerify = execute => execute('docker', ['rm', '--force', id(1)], {}); }],
  ['unrecorded image', s => { s.onVerify = execute => execute('docker',
    ['image', 'inspect', '--format', '{{json .}}', 'shared-image'], {}); }],
  ['source verification failure', s => { s.onVerify = () => { throw new Error('source receipt drift'); }; }],
  ['validator omits live image inspection', s => { s.verifyImages = () => ({
    reportPath: s.reportPath, reportSha256: hash(fs.readFileSync(s.reportPath)),
    report: s.report, imageArtifactBindingVerified: true,
  }); }],
]) {
  test(`read-only image adapter refuses ${name} without any mutation`, t => {
    const s = imageReplayFixture(t);
    change(s);
    assert.throws(() => verifyOwnedBackendImagesReadOnly(s));
    assert.ok(s.executions.every(row => row.args[0] === 'image' && row.args[1] === 'inspect'));
  });
}
