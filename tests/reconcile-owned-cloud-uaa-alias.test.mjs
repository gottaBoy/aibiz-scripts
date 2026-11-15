import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { bindOwnedCloudUaaSource, CLOUD_UAA_SOURCE_PATHS } from '../owned-nacos-service-alias.mjs';
import {
  CLOUD_UAA_ALIAS_TOOL_INPUTS, main, reconcileOwnedCloudUaaAlias,
} from '../reconcile-owned-cloud-uaa-alias.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const runId = 'f01006abcdef';
const originalWorkspace = new URL('../../', import.meta.url).pathname;

function fixture(t) {
  const workspace = mkdtempSync(join(tmpdir(), 'owned-cloud-uaa-alias-'));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  const write = (path, value) => {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, value, { mode: 0o600 });
  };
  for (const path of CLOUD_UAA_ALIAS_TOOL_INPUTS) write(join(workspace, path), readFileSync(join(originalWorkspace, path)));
  const worktree = join(workspace, '.artifacts/package/worktree');
  const entries = CLOUD_UAA_SOURCE_PATHS.map(path => {
    const bytes = readFileSync(join(originalWorkspace, 'ibiz-service-hub', path));
    write(join(workspace, 'ibiz-service-hub', path), bytes);
    write(join(worktree, path), bytes);
    return { path, bytes: bytes.length, sha256: hash(bytes) };
  });
  const packagePath = join(workspace, '.artifacts/package/report.json');
  const build = {
    contract: 'isolated-backend-source-package-v1', status: 'passed-package-and-unit-only',
    sourcePackageVerified: true, unitRegression: true, worktree,
    sourceInputs: { before: { fingerprint: 'c'.repeat(64), entries } },
    packages: { archives: [{
      path: 'ibiz-ebsx-runtime/ibiz-ebsx-allinone-rt.jar', sha256: 'a'.repeat(64), bytes: 10,
      unknownOwnDependencies: [],
      embeddedLibraries: [{
        module: 'libs/ibiz-cloud-uaa-core', path: 'BOOT-INF/lib/ibiz-cloud-uaa-core-8.1.0.584.1.jar',
        ownership: 'source-reactor', classification: 'reactor-source',
        sha256: 'b'.repeat(64), targetSha256: 'b'.repeat(64),
      }],
    }] },
  };
  const packageBytes = JSON.stringify(build);
  write(packagePath, packageBytes);
  const imagePath = join(workspace, '.artifacts/images/report.json');
  const images = {
    contract: 'isolated-backend-source-images-v1', status: 'passed-image-artifact-binding-only',
    imageArtifactBindingVerified: true,
    packageReceipt: { path: packagePath, sha256: hash(packageBytes), sourceFingerprint: 'c'.repeat(64) },
    components: [{
      name: 'allinone', image: { id: `sha256:${'1'.repeat(64)}` },
      imageFiles: [{ path: '/ibiz-ebsx-allinone-rt.jar', sha256: 'a'.repeat(64), bytes: 10 }],
    }],
  };
  const imageBytes = JSON.stringify(images);
  write(imagePath, imageBytes);
  const base = join(workspace, '.artifacts/native-nonadmin-fixtures', runId);
  const runtime = join(base, 'backend-runtime-controlled');
  const deploymentInput = join(runtime, 'deployment-input.private.json');
  const network = {
    Id: 'e'.repeat(64), Name: `nf-${runId}-private`, Internal: true, Driver: 'bridge',
    IPAM: { Config: [{ Subnet: '10.91.0.0/24', Gateway: '10.91.0.1' }] }, Containers: {},
  };
  const roles = ['allinone', 'gateway', 'provider', 'uaa', 'mysql', 'nacos', 'redis', 'zookeeper'];
  const containers = roles.map((role, index) => {
    const Id = String(index + 1).repeat(64);
    const Name = `nf-${runId}-backend-controlled-${role}`;
    const endpoint = { NetworkID: network.Id, EndpointID: `${index + 1}`.repeat(64),
      IPAddress: `10.91.0.${index + 2}`, IPPrefixLen: 24, Gateway: '10.91.0.1' };
    network.Containers[Id] = { Name, EndpointID: endpoint.EndpointID, IPv4Address: `${endpoint.IPAddress}/24` };
    return { Id, Name: `/${Name}`, Image: `sha256:${String(index + 1).repeat(64)}`,
      State: { Running: true }, Config: { Labels: { 'aibiz.native-fixture.run': runId } },
      HostConfig: { PortBindings: {} },
      NetworkSettings: { Networks: { [network.Name]: endpoint } } };
  });
  const service = role => {
    const container = containers[roles.indexOf(role)];
    return { containerId: container.Id, imageId: container.Image };
  };
  const deployment = {
    services: Object.fromEntries(roles.slice(0, 4).map(role => [role, service(role)])),
    auxiliaryContainers: ['nacos', 'redis', 'zookeeper'].map(role => ({ role, ...service(role) })),
    imageReceipt: { path: imagePath, sha256: hash(imageBytes) },
  };
  const deploymentBytes = JSON.stringify(deployment);
  write(deploymentInput, deploymentBytes);
  const startupBytes = JSON.stringify({
    contract: 'run-owned-native-backend-startup-v1', runId,
    status: 'passed-owned-backend-http-transport-only', retainedOwned: true, actualBackendStarted: true,
    services: deployment.services, deploymentInput: { path: deploymentInput, sha256: hash(deploymentBytes) },
  });
  write(join(runtime, 'report.json'), startupBytes);
  write(join(runtime, 'report.sha256'), `${hash(startupBytes)}\n`);
  let currentAlias;
  let commands = 0;
  const calls = [];
  const options = {
    workspace, runId, deploymentInput, label: 'publish-r1', executeOwned: true,
    execute() { commands++; assert.fail('Controlled reconciliation cannot invoke Docker'); },
    contextFactory: () => ({
      base, manifest: { runId }, resources: { mysqlId: service('mysql').containerId },
      deployment, guard: () => ({ containers, network }), close() {},
    }),
    async request(origin, path, input) {
      calls.push({ origin, path, method: input?.method ?? 'GET' });
      assert.equal(origin, 'http://10.91.0.7:8848');
      if (input?.method === 'POST') {
        currentAlias = Object.fromEntries(input.body);
        currentAlias.port = Number(currentAlias.port);
        currentAlias.enabled = true; currentAlias.healthy = true; currentAlias.ephemeral = false;
        currentAlias.metadata = JSON.parse(currentAlias.metadata);
        return { status: 200, bytes: Buffer.from('ok') };
      }
      if (input?.method === 'DELETE') {
        currentAlias = undefined;
        return { status: 200, bytes: Buffer.from('ok') };
      }
      return { status: 200, bytes: Buffer.from(JSON.stringify({
        name: `nf_${runId}@@ibizcloud-uaa`, hosts: currentAlias ? [currentAlias] : [],
      })) };
    },
  };
  return { options, containers, calls, write, build, images, packagePath, imagePath, commands: () => commands };
}

test('current real package/image receipts bind the actual allinone controller and bootstrap without live operations', t => {
  const path = join(originalWorkspace, '.artifacts/model-context-source-images-20261115-r1/report.json');
  if (!existsSync(path)) { t.skip('Current owner-private image receipt is unavailable'); return; }
  const bytes = readFileSync(path);
  const images = JSON.parse(bytes);
  const value = bindOwnedCloudUaaSource({
    workspace: originalWorkspace, images, read: path => readFileSync(resolve(originalWorkspace, path)),
  });
  assert.equal(value.entries.length, 2);
  assert.deepEqual(value.entries.map(row => row.path), [...CLOUD_UAA_SOURCE_PATHS]);
  assert.match(value.embeddedControllerLibrary.sha256, /^[a-f0-9]{64}$/);
  assert.equal(value.imageId, images.components.find(row => row.name === 'allinone').image.id);
  assert.deepEqual(readFileSync(path), bytes);
});

test('controlled eight-peer reconciliation publishes and removes only the source-bound Cloud UAA alias', async t => {
  const state = fixture(t);
  const before = readFileSync(state.options.deploymentInput);
  const result = await reconcileOwnedCloudUaaAlias(state.options);
  assert.equal(result.report.status, 'passed-owned-cloud-uaa-alias-transition',
    result.report.failureEvidence ? JSON.parse(readFileSync(result.report.failureEvidence.path)).message : '');
  assert.equal(result.report.created, true);
  assert.equal(result.report.alias.serviceName, 'ibizcloud-uaa');
  assert.equal(result.report.alias.ip, '10.91.0.2');
  assert.equal(result.report.peers.length, 8);
  assert.equal(result.report.operations.length, 3);
  assert.equal(statSync(result.reportPath).mode & 0o777, 0o600);
  assert.equal(statSync(dirname(result.reportPath)).mode & 0o777, 0o700);
  assert.equal(result.report.nativeAcceptance, false);
  assert.equal(result.report.logAcceptance, false);
  assert.equal(state.commands(), 0);
  const removal = await reconcileOwnedCloudUaaAlias({
    ...state.options, label: 'remove-r1', removeReceipt: result.reportPath,
  });
  assert.equal(removal.report.status, 'passed-owned-cloud-uaa-alias-transition');
  assert.deepEqual(removal.report.result, { removed: true, absent: true });
  assert.equal(state.calls.filter(row => row.method === 'DELETE').length, 1);
  assert.deepEqual(readFileSync(state.options.deploymentInput), before);
  const repeated = await reconcileOwnedCloudUaaAlias(state.options);
  assert.equal(repeated.reportPath, null);
  assert.equal(repeated.report.status, 'failed-owned-cloud-uaa-alias-transition');
});

for (const [name, mutate] of [
  ['extra peer', state => { state.containers.push(structuredClone(state.containers[0])); }],
  ['changed image', state => { state.containers[0].Image = `sha256:${'f'.repeat(64)}`; }],
  ['foreign ownership', state => { state.containers[0].Config.Labels['aibiz.native-fixture.run'] = 'foreign'; }],
  ['stopped peer', state => { state.containers[2].State.Running = false; }],
  ['current controller drift', state => {
    writeFileSync(join(state.options.workspace, 'ibiz-service-hub', CLOUD_UAA_SOURCE_PATHS[0]), 'changed');
  }],
]) {
  test(`controlled reconciliation rejects ${name} before any Nacos request`, async t => {
    const state = fixture(t);
    mutate(state);
    const result = await reconcileOwnedCloudUaaAlias(state.options);
    assert.equal(result.report.status, 'failed-owned-cloud-uaa-alias-transition');
    assert.equal(state.calls.length, 0);
    assert.equal(state.commands(), 0);
  });
}

test('mid-transition ownership drift stops before alias creation without rewriting startup inputs', async t => {
  const state = fixture(t);
  const request = state.options.request;
  state.options.request = async (...args) => {
    const result = await request(...args);
    state.containers[0].Config.Labels['aibiz.native-fixture.run'] = 'foreign';
    return result;
  };
  const result = await reconcileOwnedCloudUaaAlias(state.options);
  assert.equal(result.report.status, 'failed-owned-cloud-uaa-alias-transition');
  assert.equal(result.report.created, false);
  assert.equal(state.calls.length, 1);
  assert.equal(state.calls[0].method, 'GET');
});

test('CLI rejects implicit/shared/duplicate/lifecycle inputs without invoking a runtime', async () => {
  for (const options of [{}, { executeOwned: true }, {
    executeOwned: true, runId: 'shared', label: 'a', deploymentInput: 'x',
  }]) await assert.rejects(reconcileOwnedCloudUaaAlias(options));
  for (const args of [
    [], ['--url=http://127.0.0.1:8848'], ['--restart-owned'],
    ['--execute-owned', '--execute-owned'], ['--label=a', '--label=b'],
  ]) await assert.rejects(main(args));
});
