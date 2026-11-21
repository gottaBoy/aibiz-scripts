import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import { dirname, join, relative } from 'node:path';
import test from 'node:test';
import { ownedNativeRuntimeContext } from '../owned-native-runtime-context.mjs';
import { createFixture } from '../prepare-run-owned-native-nonadmin-fixture.mjs';
import { PinnedDirectories } from '../native-candidate-files.mjs';
import { stageOwnedModelInput } from '../launch-run-owned-native-backend.mjs';
import { prepareR05OwnedModel, r05Files, r05ModelRoot } from '../prepare-r05-owned-model.mjs';
import { rebindSerializedR05OwnedModel } from '../r05-owned-model-overlay.mjs';
import { MODEL_CONTEXT_VIEW_PATHS } from '../native-model-context-overlay.mjs';
import { prepareNativeServiceCandidate } from '../prepare-native-service-candidate.mjs';
import { validateDeployment } from '../run-owned-native-permission-http.mjs';

const actualWorkspace = new URL('../../', import.meta.url).pathname;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const runId = '123456789abc';
const id = value => value.toString(16).padStart(64, '0');
const image = value => `sha256:${id(value)}`;

function fixture(t, { r05 = true, context = false, central = false } = {}) {
  const workspace = fs.mkdtempSync(join(os.tmpdir(), 'aibiz-r05-runtime-context-'));
  const directories = new PinnedDirectories();
  t.after(() => { directories.close(); fs.rmSync(workspace, { recursive: true, force: true }); });
  const base = join(workspace, '.artifacts/native-nonadmin-fixtures', runId);
  const runtime = join(base, 'backend-runtime-guard-r1');
  fs.mkdirSync(runtime, { recursive: true });
  const source = join(workspace, r05ModelRoot);
  for (const path of [...Object.values(r05Files), ...(context ? MODEL_CONTEXT_VIEW_PATHS : [])]) {
    fs.mkdirSync(dirname(join(source, path)), { recursive: true });
    fs.copyFileSync(join(actualWorkspace, r05ModelRoot, path), join(source, path));
  }
  fs.writeFileSync(join(source, 'unrelated.json'), '{"preserved":true}\n');
  let centralMemberReceiptPath;
  if (central) {
    const contractPath = 'scripts/fixtures/native-service-migration-contract.json';
    const contract = JSON.parse(fs.readFileSync(join(actualWorkspace, contractPath)));
    fs.mkdirSync(dirname(join(workspace, contractPath)), { recursive: true });
    fs.copyFileSync(join(actualWorkspace, contractPath), join(workspace, contractPath));
    for (const file of Object.values({ ...contract.files, ...contract.memberBinding.files })) {
      fs.mkdirSync(dirname(join(source, file.path)), { recursive: true });
      fs.copyFileSync(join(actualWorkspace, r05ModelRoot, file.path), join(source, file.path));
    }
    const output = join(workspace, '.artifacts/native-service-migration/central');
    prepareNativeServiceCandidate({ workspace, output, memberBinding: true });
    centralMemberReceiptPath = join(output, 'receipt.json');
  }
  const candidate = join(workspace, '.artifacts/r05-owned-model/candidate');
  prepareR05OwnedModel({ workspace, output: candidate });
  const staged = stageOwnedModelInput({
    workspace, directories, source, outputPath: join(runtime, 'model-input'),
    r05OwnedModelCandidate: r05 ? candidate : undefined,
    modelContextOverlay: context, centralMemberReceiptPath,
  });
  const { manifest, credentials } = createFixture({
    runId, scenario: 'two-center', passwordStorageMode: 'sm3', modelVersion: 816,
    uaaSchemaMode: 'legacy-views', secret: () => '1'.repeat(36),
  });
  const resources = {
    contract: 'run-owned-native-fixture-resources-v1', runId,
    mysqlId: id(1), networkId: id(2), mysqlImage: image(3),
    mysqlName: manifest.ownership.mysqlContainer, networkName: manifest.ownership.network,
    schemas: manifest.schemas,
  };
  const services = Object.fromEntries(['allinone', 'gateway', 'provider', 'uaa'].map((role, index) =>
    [role, { containerId: id(index + 4), imageId: image(index + 10) }]));
  const peers = [
    { containerId: resources.mysqlId, imageId: resources.mysqlImage, role: 'mysql' },
    ...Object.entries(services).map(([role, row]) => ({ ...row, role })),
  ];
  const containers = peers.map(peer => ({
    Id: peer.containerId,
    Name: `/${peer.role === 'mysql' ? manifest.ownership.mysqlContainer : `nf-${runId}-${peer.role}`}`,
    Image: peer.imageId,
    State: { Running: true, StartedAt: '2026-11-21T00:00:00Z' }, RestartCount: 0,
    Config: { Labels: { [manifest.ownership.label]: runId } }, Mounts: [],
    HostConfig: { Privileged: false, PortBindings: {}, ...(peer.role === 'mysql'
      ? { Tmpfs: { '/var/lib/mysql': 'rw,nosuid,nodev,size=1073741824' } } : {}) },
    NetworkSettings: {
      Networks: { [manifest.ownership.network]: { NetworkID: resources.networkId } },
      Ports: peer.role === 'mysql' ? { '3306/tcp': null } : {},
    },
  }));
  const provider = containers.find(container => container.Id === services.provider.containerId);
  provider.Mounts.push({
    Type: 'bind', RW: false, Destination: '/app/model', Source: join(runtime, 'model-input'),
  });
  const endpoints = {
    uaa: { origin: 'http://127.0.0.1:33361', service: 'uaa', containerPort: 32666 },
    backend: { origin: 'http://127.0.0.1:33386', service: 'gateway', containerPort: 30086 },
  };
  for (const endpoint of Object.values(endpoints)) {
    const container = containers.find(row => row.Id === services[endpoint.service].containerId);
    const bindings = [{ HostIp: '127.0.0.1', HostPort: new URL(endpoint.origin).port }];
    container.NetworkSettings.Ports[`${endpoint.containerPort}/tcp`] = bindings;
    container.HostConfig.PortBindings[`${endpoint.containerPort}/tcp`] = bindings;
  }
  const network = {
    Id: resources.networkId, Name: manifest.ownership.network, Internal: true, Driver: 'bridge',
    Labels: { [manifest.ownership.label]: runId },
    Containers: Object.fromEntries(peers.map(peer => [peer.containerId, {}])),
  };
  const images = {
    contract: 'isolated-backend-source-images-v1', status: 'passed-image-artifact-binding-only',
    imageArtifactBindingVerified: true,
    components: ['allinone', 'gateway', 'provider'].map(name => ({
      name, image: { id: services[name].imageId },
    })),
  };
  const imagePath = join(base, 'images.json');
  const bytes = Buffer.from(`${JSON.stringify(images)}\n`);
  fs.writeFileSync(imagePath, bytes, { mode: 0o600 });
  const deployment = {
    contract: 'run-owned-native-permission-deployment-input-v1', runId, services,
    imageReceipt: { path: relative(workspace, imagePath), sha256: hash(bytes) },
    endpoints, auxiliaryContainers: [],
    ...(r05 ? { r05OwnedModelBinding: JSON.parse(JSON.stringify(staged.r05OwnedModelBinding)) } : {}),
  };
  const deploymentInput = join(runtime, 'deployment-input.private.json');
  const write = (path, value) => fs.writeFileSync(path, `${JSON.stringify(value)}\n`, { mode: 0o600 });
  write(join(base, 'manifest.json'), manifest);
  write(join(base, 'owned-resources.json'), resources);
  write(join(base, 'credentials.private.json'), credentials);
  write(deploymentInput, deployment);
  const calls = [];
  const execute = (executable, args) => {
    calls.push({ executable, args });
    assert.equal(executable, 'docker');
    if (args[0] === 'inspect') return { status: 0, stdout: JSON.stringify(containers) };
    if (args[0] === 'network' && args[1] === 'inspect') {
      return { status: 0, stdout: JSON.stringify([network]) };
    }
    throw new Error('Only simulated read-only inspection is allowed');
  };
  validateDeployment(manifest, resources, deployment, containers, network, images, [], { workspace });
  return {
    workspace, runId, deploymentInput, execute, calls, deployment, provider, containers,
    source, candidate, modelRoot: join(runtime, 'model-input'), centralMemberReceiptPath,
    persist: () => write(deploymentInput, deployment),
  };
}

test('owned platform contexts have no implicit fixture, URL or shared deployment fallback', () => {
  let executions = 0;
  const execute = () => { executions++; throw new Error('No Docker access allowed'); };
  for (const options of [
    {}, { runId: 'shared' },
    { runId: 'f01006abcdef', deploymentInput: '/tmp/deployment-input.private.json' },
    { runId: 'f01006abcdef', deploymentInput:
      '.artifacts/native-nonadmin-fixtures/000000000000/backend-runtime-test/deployment-input.private.json' },
    { runId: 'f01006abcdef', deploymentInput:
      '.artifacts/native-nonadmin-fixtures/f01006abcdef/backend-runtime-test/shared.json' },
  ]) assert.throws(() => ownedNativeRuntimeContext({ workspace: '/workspace', execute, ...options }));
  assert.equal(executions, 0);
});

test('legacy deployments without R05 retain the existing runtime guard behavior', t => {
  const options = fixture(t, { r05: false });
  const context = ownedNativeRuntimeContext(options);
  t.after(() => context.close());
  assert.equal(Object.hasOwn(context.deployment, 'r05OwnedModelBinding'), false);
  assert.doesNotThrow(() => context.guard());
  assert.equal(options.calls.length, 4);
});

test('serialized R05 deployment is rederived from trusted inputs on first and every subsequent guard', t => {
  const options = fixture(t);
  const context = ownedNativeRuntimeContext(options);
  t.after(() => context.close());
  assert.doesNotThrow(() => context.guard());
  assert.equal(options.calls.length, 4);
  fs.appendFileSync(join(options.modelRoot, 'unrelated.json'), '\n');
  assert.throws(() => context.guard(), /stage output differs/);
});

test('serialized Central/context selections must reproduce their independently verified complete stage', t => {
  const options = fixture(t, { context: true, central: true });
  const context = ownedNativeRuntimeContext(options);
  t.after(() => context.close());
  assert.doesNotThrow(() => context.guard());
  const fresh = rebindSerializedR05OwnedModel({
    ...options, deploymentPath: options.deploymentInput,
    binding: options.deployment.r05OwnedModelBinding,
  });
  assert.notEqual(fresh, options.deployment.r05OwnedModelBinding);
  assert.deepEqual(fresh, options.deployment.r05OwnedModelBinding);
  fs.appendFileSync(options.centralMemberReceiptPath, '\n');
  assert.throws(() => context.guard());
});

test('R05 consumers can require the binding and cannot downgrade through a removed declaration', t => {
  const options = fixture(t, { r05: false });
  assert.throws(() => ownedNativeRuntimeContext({ ...options, requireR05Binding: true }));
  assert.throws(() => ownedNativeRuntimeContext({ ...options, requireR05Binding: 'true' }), /boolean/);
});

test('an R05-required context refuses removal after initial verification before another request', t => {
  const options = fixture(t);
  const context = ownedNativeRuntimeContext({ ...options, requireR05Binding: true });
  t.after(() => context.close());
  delete context.deployment.r05OwnedModelBinding;
  assert.throws(() => context.guard(), /Required R05 deployment binding is absent/);
});

for (const target of ['candidate', 'source', 'unrelated-source', 'stage-mode', 'candidate-mode', 'provider-mount']) {
  test(`every runtime guard rejects subsequent R05 ${target} drift`, t => {
    const options = fixture(t);
    const context = ownedNativeRuntimeContext({ ...options, requireR05Binding: true });
    t.after(() => context.close());
    if (target === 'candidate') fs.appendFileSync(join(options.candidate, 'model', r05Files.action), '\n');
    if (target === 'source') fs.appendFileSync(join(options.source, r05Files.action), '\n');
    if (target === 'unrelated-source') fs.appendFileSync(join(options.source, 'unrelated.json'), '\n');
    if (target === 'stage-mode') fs.chmodSync(join(options.modelRoot, r05Files.action), 0o600);
    if (target === 'candidate-mode') fs.chmodSync(join(options.candidate, 'receipt.json'), 0o644);
    if (target === 'provider-mount') options.provider.Mounts[0].RW = true;
    assert.throws(() => context.guard());
  });
}

test('serialized binding cannot select another root run, stage label, counter contract or accepted status', t => {
  const options = fixture(t, { context: true });
  const original = structuredClone(options.deployment.r05OwnedModelBinding);
  for (const change of [
    value => { value.nativeAcceptance = true; },
    value => { value.runtimeBindingVerified = true; },
    value => { value.acceptedForProduction = true; },
    value => { value.candidate.runtimeBindingVerified = true; },
    value => { value.staged.path = value.staged.path.replace('backend-runtime-guard-r1', 'backend-runtime-other'); },
    value => { value.staged.path = value.staged.path.replace(runId, '000000000000'); },
    value => { value.candidate.path = '.artifacts/r05-owned-model/../foreign'; },
    value => { value.source.fingerprint = '0'.repeat(64); },
    value => { delete value.modelContextOverlay; },
    value => { value.modelContextOverlay.files = []; },
    value => { value.extraAccepted = true; },
  ]) {
    options.deployment.r05OwnedModelBinding = structuredClone(original);
    change(options.deployment.r05OwnedModelBinding);
    options.persist();
    assert.throws(() => ownedNativeRuntimeContext({ ...options, requireR05Binding: true }));
  }
});

test('removed or forged optional binding declarations do not enter the fresh-proof path as valid JSON', t => {
  const options = fixture(t);
  for (const binding of [null, false, {}, { contract: 'old-r05-receipt', nativeAcceptance: true }]) {
    options.deployment.r05OwnedModelBinding = binding;
    options.persist();
    assert.throws(() => ownedNativeRuntimeContext(options));
  }
});

test('serialized R05 reader rejects accessor objects without invoking user code', t => {
  const options = fixture(t);
  let reads = 0;
  const binding = structuredClone(options.deployment.r05OwnedModelBinding);
  Object.defineProperty(binding, 'nativeAcceptance', {
    enumerable: true, get() { reads++; return false; },
  });
  assert.throws(() => rebindSerializedR05OwnedModel({
    ...options, deploymentPath: options.deploymentInput, binding,
  }), /accessors/);
  assert.equal(reads, 0);
});
