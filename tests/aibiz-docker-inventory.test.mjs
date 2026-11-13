import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  captureHostInputs, classifyAibizDockerInventory, collectInventory, composeImageLock,
  normalizeAibizContainer, runAudit, verifyComposeImageLock, writeInventoryReport,
} from '../audit-aibiz-docker-inventory.mjs';

const id = char => char.repeat(64);
const imageId = char => `sha256:${id(char)}`;
const raw = (name = 'plmweb', changes = {}) => ({
  Id: id('a'), Image: imageId('b'), Name: `/${name}`, Created: '2026-11-01T00:00:00Z',
  RestartCount: 0,
  Config: { Image: 'aibiz/plmweb:local', Env: ['PASSWORD=never-publish-me'],
    Labels: { 'com.docker.compose.project': 'compose', 'com.docker.compose.service': name } },
  HostConfig: { AutoRemove: false },
  State: { Status: 'running', Running: true, StartedAt: '2026-11-02T00:00:00Z' },
  Mounts: [],
  NetworkSettings: { Ports: {}, Networks: {} },
  ...changes,
});
const images = [
  { repository: 'aibiz/plmweb', tag: 'local', id: imageId('b') },
  { repository: 'aibiz/plmweb', tag: 'probe', id: imageId('b') },
  { repository: 'aibiz/other', tag: 'old', id: imageId('c') },
];
const report = () => classifyAibizDockerInventory({
  containers: [normalizeAibizContainer(raw())], images, networks: [],
});

test('real inspect fields retain immutable IDs, ownership, mounts and lifecycle without secret values', () => {
  const value = normalizeAibizContainer(raw('fixture-web', {
    Config: { ...raw().Config, Labels: { 'aibiz.native-fixture.run': 'abcdef012345' } },
    Mounts: [{ Type: 'bind', Source: '/owned/input', Destination: '/input', RW: false },
      { Type: 'volume', Name: 'owned-data', Source: '/docker/data', Destination: '/data', RW: true }],
  }));
  assert.equal(value.kind, 'owned-fixture');
  assert.equal(value.hasVolumes, true);
  assert.equal(value.imageId, imageId('b'));
  assert.ok(value.cleanup.blockers.includes('owned-fixture-receipt-required'));
  assert.ok(value.cleanup.blockers.includes('mounts-require-separate-review'));
  assert.equal(value.cleanup.eligible, false);
  assert.ok(!JSON.stringify(value).includes('never-publish-me'));
  assert.equal(value.configurationSha256.length, 64);
});

test('shared, owned and historical counts have explicit distinct scope and stopped references remain protected', () => {
  const stopped = normalizeAibizContainer(raw('n01-old', {
    Id: id('d'), Image: imageId('c'), State: { Status: 'exited', Running: false },
  }));
  const owned = normalizeAibizContainer(raw('nf-abcdef012345-mysql', { Id: id('e') }));
  const value = classifyAibizDockerInventory({
    containers: [normalizeAibizContainer(raw()), owned, stopped], images, networks: [],
  });
  assert.equal(value.runningCount, 2);
  assert.equal(value.sharedRunningCount, 1);
  assert.equal(value.ownedRunningCount, 1);
  assert.equal(value.stoppedOrCreatedCount, 1);
  assert.equal(value.aibizTagCount, 3);
  assert.equal(value.aibizUniqueImageIdCount, 2);
  assert.equal(value.containerReferencedAibizImageCount, 2);
  assert.deepEqual(value.unreferencedByContainers, []);
  assert.deepEqual(value.imageCleanupCandidates, []);
});

test('paused, restarting and removing states never become stopped cleanup candidates', () => {
  for (const state of ['paused', 'restarting', 'removing', 'running']) {
    const value = normalizeAibizContainer(raw('n01-test', { State: { Status: state, Running: false } }));
    assert.equal(value.cleanup.reviewCandidate, false);
    assert.equal(value.cleanup.eligible, false);
  }
  for (const state of ['exited', 'created', 'dead']) {
    const value = normalizeAibizContainer(raw('n01-test', { State: { Status: state, Running: false } }));
    assert.equal(value.cleanup.reviewCandidate, true);
    assert.equal(value.cleanup.eligible, false, 'A candidate alone never authorizes deleting its writable layer');
  }
});

test('owned labels, mounts and automatic cleanup prevent even historical-name review candidates', () => {
  const stopped = { Status: 'exited', Running: false };
  for (const changes of [
    { Config: { ...raw().Config, Labels: { 'aibiz.native-fixture.run': 'abcdef012345' } } },
    { Mounts: [{ Type: 'bind', Source: '/host', Destination: '/app', RW: true }] },
    { Mounts: [{ Type: 'volume', Source: '/docker/volume', Destination: '/data', RW: true }] },
    { HostConfig: { AutoRemove: true } },
  ]) {
    assert.equal(normalizeAibizContainer(raw('n01-test', { State: stopped, ...changes })).cleanup.reviewCandidate, false);
  }
});

test('all-container references protect digest-launched containers regardless of name and tag aliases', () => {
  const value = classifyAibizDockerInventory({
    containers: [], images, networks: [],
    allContainerReferences: [{ id: id('d'), name: 'unrelated-name', imageId: imageId('b'),
      image: imageId('b'), state: 'exited' }],
  });
  assert.equal(value.containerReferencedAibizImageCount, 1);
  assert.equal(value.duplicateTags[0].containerReferences[0].name, 'unrelated-name');
  assert.deepEqual(value.unreferencedByContainers, [imageId('c')]);
});

test('image lock uses inspected local image IDs, never a synthetic registry digest or latest tag', () => {
  const value = composeImageLock(report());
  assert.deepEqual(value, { services: { plmweb: { image: imageId('b'), pull_policy: 'never' } } });
  assert.equal(report().acceptance, 'observed-runtime-only-not-a-validated-release');
  for (const change of [
    r => { r.running[0].labels['com.docker.compose.project'] = 'foreign'; },
    r => { r.running[0].labels['com.docker.compose.service'] = '../invalid'; },
    r => { r.running.push(structuredClone(r.running[0])); },
    r => { r.running = []; },
  ]) {
    const value = report();
    change(value);
    assert.throws(() => composeImageLock(value));
  }
});

test('mutable tag drift is detected but the local image lock keeps the actual running image', () => {
  const value = classifyAibizDockerInventory({
    containers: [normalizeAibizContainer(raw())],
    images: [{ repository: 'aibiz/plmweb', tag: 'local', id: imageId('c') }], networks: [],
  });
  assert.equal(value.tagDrift.length, 1);
  assert.equal(value.tagDrift[0].runningImageId, imageId('b'));
  assert.equal(composeImageLock(value).services.plmweb.image, imageId('b'));
});

test('a lock rejects changed image IDs, missing services, mutable tag substitution and auto-pull', () => {
  const current = report();
  const original = composeImageLock(current);
  assert.deepEqual(verifyComposeImageLock(current, original), {
    status: 'passed-observed-image-lock-only', acceptedRelease: false,
    services: 1, bindMountContentsFrozen: false,
  });
  for (const mutate of [
    value => { value.services.plmweb.image = imageId('c'); },
    value => { delete value.services.plmweb; },
    value => { value.services.plmweb.image = 'aibiz/plmweb:local'; },
    value => { value.services.plmweb.pull_policy = 'always'; },
  ]) {
    const changed = structuredClone(original); mutate(changed);
    assert.throws(() => verifyComposeImageLock(current, changed));
  }
});

test('reviewed retention keeps the full runtime lock separate from candidates and bounded build tools', () => {
  const retained = JSON.parse(readFileSync(new URL('../records/aibiz-image-retention-20261113.json', import.meta.url)));
  const lock = JSON.parse(readFileSync(new URL('../records/aibiz-runtime-images-20261113.compose.json', import.meta.url)));
  assert.equal(retained.contract, 'aibiz-reviewed-image-retention-v1');
  assert.equal(retained.acceptedRelease, false);
  assert.equal(retained.images.length, 18);
  assert.equal(new Set(retained.images.map(row => row.reference)).size, 18);
  assert.equal(new Set(retained.images.map(row => row.imageId)).size, 18);
  for (const row of retained.images) {
    assert.match(row.reference, /^aibiz\/[a-z0-9-]+:[a-zA-Z0-9_.-]+$/);
    assert.match(row.imageId, /^sha256:[a-f0-9]{64}$/);
    assert.ok(['shared-runtime', 'development-candidate', 'build-toolchain'].includes(row.role));
  }
  const runtime = retained.images.filter(row => row.role === 'shared-runtime');
  assert.equal(runtime.length, 10);
  assert.equal(Object.keys(lock.services).length, 12);
  assert.deepEqual(runtime.map(row => row.imageId).sort(),
    [...new Set(Object.values(lock.services).map(row => row.image))].sort());
  assert.equal(retained.images.filter(row => row.role === 'development-candidate').length, 5);
  assert.equal(retained.images.filter(row => row.role === 'build-toolchain').length, 3);
});

test('writer is private, exclusive and symlink-resistant and does not accept workspace traversal', t => {
  const workspace = mkdtempSync(join(tmpdir(), 'docker-inventory-'));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  const output = '.artifacts/inventory/report.json';
  const binding = writeInventoryReport(report(), { workspace, output });
  assert.equal(statSync(binding.path).mode & 0o777, 0o600);
  assert.equal(statSync(join(workspace, '.artifacts/inventory')).mode & 0o777, 0o700);
  assert.equal(JSON.parse(readFileSync(binding.composeImageLock)).services.plmweb.image, imageId('b'));
  assert.throws(() => writeInventoryReport(report(), { workspace, output }));
  assert.throws(() => writeInventoryReport(report(), { workspace, output: '.artifacts/../outside/report.json' }));
  mkdirSync(join(workspace, 'outside'));
  symlinkSync(join(workspace, 'outside'), join(workspace, '.artifacts/link'));
  assert.throws(() => writeInventoryReport(report(), { workspace, output: '.artifacts/link/test/report.json' }));
});

function executor({ drift = false, fail = false } = {}) {
  let lists = 0;
  const calls = [];
  const execute = (command, args) => {
    calls.push([command, ...args]);
    if (fail) return { status: 1, stderr: 'private daemon output' };
    let stdout;
    if (args[0] === 'ps') stdout = `${id(++lists > 1 && drift ? 'f' : 'a')}\n`;
    else if (args[0] === 'container') stdout = JSON.stringify([raw('unrelated-name', {
      Config: { ...raw().Config, Image: imageId('b') },
    })]);
    else if (args[0] === 'image') stdout = JSON.stringify({
      Repository: 'aibiz/plmweb', Tag: 'local', ID: imageId('b'),
    }) + '\n';
    else if (args[0] === 'network') stdout = JSON.stringify({
      ID: id('e'), Name: 'nf-abcdef012345-private', Driver: 'bridge', Scope: 'local',
    }) + '\n';
    else assert.fail(`Unexpected Docker command ${args}`);
    return { status: 0, stdout };
  };
  return { execute, calls };
}

test('collector uses only readonly machine inspections and discovers images launched by raw digest', () => {
  const fixture = executor();
  const value = collectInventory(fixture);
  assert.equal(value.runningCount, 1);
  assert.equal(value.running[0].name, 'unrelated-name');
  assert.ok(fixture.calls.every(([, operation]) => ['ps', 'container', 'image', 'network'].includes(operation)));
  assert.ok(fixture.calls.every(call => !call.some(arg => ['rm', 'prune', 'stop', 'restart', 'tag'].includes(arg))));
});

test('changing inventory or Docker failure prevents producing a lock or receipt', t => {
  assert.throws(() => collectInventory(executor({ drift: true })), /inventory changed/);
  const workspace = mkdtempSync(join(tmpdir(), 'docker-inventory-fail-'));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  assert.throws(() => runAudit({ ...executor({ fail: true }), workspace }));
});

test('mounted file bytes and Compose files are measured without presenting mutable directories as frozen assets', t => {
  const workspace = mkdtempSync(join(tmpdir(), 'runtime-inputs-'));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  const file = join(workspace, 'start.sh');
  const config = join(workspace, 'compose.yml');
  const directory = join(workspace, 'plugins');
  writeFileSync(file, 'source script');
  writeFileSync(config, 'services: {}');
  mkdirSync(directory);
  symlinkSync(file, join(workspace, 'linked'));
  const current = report();
  current.running[0].labels['com.docker.compose.project.config_files'] = config;
  current.running[0].mounts = [
    { type: 'bind', source: file, destination: '/start.sh', writable: false },
    { type: 'bind', source: directory, destination: '/plugins', writable: false },
    { type: 'bind', source: join(workspace, 'linked'), destination: '/linked', writable: false },
    { type: 'volume', source: 'data-volume', destination: '/data', writable: true },
  ];
  const inputs = captureHostInputs(current);
  assert.equal(inputs.length, 4);
  assert.equal(inputs.find(row => row.path === file).sha256.length, 64);
  assert.equal(inputs.find(row => row.path === config).sha256.length, 64);
  assert.equal(inputs.find(row => row.path === directory).kind, 'mutable-directory');
  assert.equal(inputs.find(row => row.path.endsWith('/linked')).kind, 'symlink');
  assert.ok(inputs.every(row => row.bytesFrozen === false));
  const original = inputs.find(row => row.path === file).sha256;
  writeFileSync(file, 'changed script');
  assert.notEqual(captureHostInputs(current).find(row => row.path === file).sha256, original);
});
