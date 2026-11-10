import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { createFixture } from '../prepare-run-owned-native-nonadmin-fixture.mjs';
import { mysqlFixtureProfile } from '../mysql-fixture-profiles.mjs';
import { OWNED_VOLUME_PROFILE, ownedMysqlVolumePlan } from '../owned-mysql-volume.mjs';
import {
  mysqlRecreationCreateArgs, mysqlRecreationCreateRequest, mysqlRecreationWitness, mysqlRecreationCreatedWitness,
  verifyMysqlRecreationContainer,
  recreateOwnedMysql, verifyMysqlRecreationRecords, loadMysqlRecreationJournal,
} from '../owned-mysql-recreation.mjs';
import { executeOwnedMatrix } from '../run-owned-native-permission-http.mjs';

const json = value => `${JSON.stringify(value, null, 2)}\n`;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const context = Object.fromEntries(['manifest', 'sql', 'resources', 'deployment'].map(name => [`${name}Sha256`, 'f'.repeat(64)]));
const generator = () => ({ path: 'scripts/owned-mysql-recreation.mjs',
  sha256: hash(fs.readFileSync(new URL('../owned-mysql-recreation.mjs', import.meta.url))) });
const id = value => value.repeat(64);

function fixture() {
  const runId = 'abc123def456';
  const { manifest } = createFixture({ runId, passwordStorageMode: 'sm3', modelVersion: 816 });
  const profile = mysqlFixtureProfile(OWNED_VOLUME_PROFILE);
  const storage = { ...ownedMysqlVolumePlan(runId, 'a'.repeat(32)),
    createdAt: '2026-11-05T10:00:00Z', mountpoint: `/var/lib/docker/volumes/nf-${runId}-mysql-data/_data` };
  const resources = { contract: 'run-owned-native-fixture-resources-v1', runId,
    mysqlId: id('a'), networkId: id('b'), mysqlName: manifest.ownership.mysqlContainer,
    networkName: manifest.ownership.network, schemas: manifest.schemas, mysqlImage: profile.imageId,
    databaseProfile: { name: OWNED_VOLUME_PROFILE, imageId: profile.imageId }, databaseStorage: storage };
  const before = { Id: resources.mysqlId, Image: profile.imageId, Name: `/${resources.mysqlName}`,
    Created: '2026-11-05T10:00:00Z', State: { Running: true, ExitCode: 0, OOMKilled: false },
    Config: { User: profile.user, Hostname: resources.mysqlId.slice(0, 12), Labels: {
      'aibiz.native-fixture.run': runId,
    }, Env: [`MYSQL_ROOT_PASSWORD=${'d'.repeat(32)}`], Entrypoint: ['/bin/bash'], Cmd: [...profile.command] },
    HostConfig: { ReadonlyRootfs: true, Privileged: false, NetworkMode: resources.networkName, OomKillDisable: null,
      CapAdd: null, CapDrop: ['ALL'],
      Tmpfs: Object.fromEntries(profile.tmpfs.map(value => {
        const index = value.indexOf(':');
        return [value.slice(0, index), value.slice(index + 1)];
      })), Mounts: [{ Type: 'volume', Source: storage.name, Target: '/bitnami/mysql', VolumeOptions: { NoCopy: true } }] },
    Mounts: [{ Type: 'volume', Name: storage.name, Source: storage.mountpoint, Destination: '/bitnami/mysql',
      Driver: 'local', RW: true }],
    NetworkSettings: { Networks: { [resources.networkName]: {
      NetworkID: resources.networkId, IPAddress: '10.59.0.2', EndpointID: id('e'),
    } } } };
  const after = structuredClone(before);
  after.Id = id('c');
  after.Created = '2026-11-05T11:00:00Z';
  after.NetworkSettings.Networks[resources.networkName].EndpointID = id('f');
  const volume = { Name: storage.name, CreatedAt: storage.createdAt, Mountpoint: storage.mountpoint,
    Driver: 'local', Scope: 'local', Options: null, Labels: {
      'aibiz.native-fixture.run': runId, 'aibiz.native-fixture.volume-nonce': storage.nonce,
    } };
  return { manifest, resources, before, after, volume };
}

test('replacement uses the pinned original secret, hostname, private IP and exact no-copy disk profile', () => {
  const f = fixture();
  const args = mysqlRecreationCreateArgs(f.manifest, f.resources, f.before);
  assert.equal(args[0], 'create');
  assert.ok(!args.includes('-d') && !args.includes('--publish') && !args.includes('--rm'));
  for (const value of ['--pull=never', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges',
    '--hostname', f.before.Config.Hostname, '--ip', '10.59.0.2', '1001:1001',
    `type=volume,src=${f.resources.databaseStorage.name},dst=/bitnami/mysql,volume-nocopy`]) {
    assert.ok(args.includes(value), value);
  }
  verifyMysqlRecreationContainer(f.before, f.after, f.resources);
  const request = mysqlRecreationCreateRequest(f.manifest, f.resources, f.before);
  assert.deepEqual(request.body.HostConfig, f.before.HostConfig);
  assert.equal(request.body.AttachStdout, f.before.Config.AttachStdout);
  assert.equal(request.body.NetworkingConfig.EndpointsConfig[f.resources.networkName].IPAMConfig.IPv4Address, '10.59.0.2');
});

for (const [name, mutate] of [
  ['same container', f => { f.after.Id = f.before.Id; }],
  ['different image', f => { f.after.Image = `sha256:${id('f')}`; }],
  ['different name', f => { f.after.Name = '/mysql'; }],
  ['new secret', f => { f.after.Config.Env = []; }],
  ['new hostname', f => { f.after.Config.Hostname = 'other'; }],
  ['stdout attachment drift', f => { f.after.Config.AttachStdout = true; }],
  ['additional capabilities', f => { f.after.HostConfig.CapAdd = ['ALL']; }],
  ['different volume', f => { f.after.Mounts[0].Name = 'shared'; }],
  ['old creation timestamp', f => { f.after.Created = f.before.Created; }],
  ['changed private IP', f => { f.after.NetworkSettings.Networks[f.resources.networkName].IPAddress = '10.59.0.9'; }],
  ['same network endpoint', f => { f.after.NetworkSettings.Networks[f.resources.networkName].EndpointID = id('e'); }],
  ['shared network', f => { f.after.NetworkSettings.Networks.shared = {}; }],
]) {
  test(`replacement rejects ${name}`, () => {
    const f = fixture();
    mutate(f);
    assert.throws(() => verifyMysqlRecreationContainer(f.before, f.after, f.resources));
  });
}

test('creation rejects foreign ID, owner, profile and missing or duplicate runtime secrets', () => {
  for (const mutate of [
    f => { f.before.Id = id('f'); }, f => { f.before.Config.Labels = {}; },
    f => { f.resources.databaseProfile.name = 'mysql57-bitnami-arm64'; },
    f => { f.before.Config.Env = []; }, f => { f.before.Config.Env.push(f.before.Config.Env[0]); },
    f => { f.before.Config.Env = ['MYSQL_ROOT_PASSWORD=not-hex']; },
  ]) {
    const f = fixture();
    mutate(f);
    assert.throws(() => mysqlRecreationCreateArgs(f.manifest, f.resources, f.before));
  }
});

function mockRecreation({
  failCreate = false, forcedStop = false, foreignReference = false, guardFailure = false, warning = false,
  remoteSocket = false,
} = {}) {
  const f = fixture();
  const original = structuredClone(f.resources);
  const calls = [];
  const values = {};
  const bindings = {};
  const refs = new Map([[f.before.Id, f.before]]);
  let current = structuredClone(f.resources);
  let guardCalls = 0;
  const network = { Id: f.resources.networkId, Name: f.resources.networkName,
    Containers: { [f.before.Id]: {}, [id('9')]: {} } };
  const execute = (command, args, options) => {
    calls.push(args);
    if (command === 'curl') {
      assert.ok(args.includes('--unix-socket') && args.includes('@-'));
      assert.deepEqual(JSON.parse(options.input),
        mysqlRecreationCreateRequest(f.manifest, original, f.before).body);
      if (failCreate) return { status: 22 };
      f.after.State.Running = false;
      f.after.HostConfig.OomKillDisable = false;
      refs.set(f.after.Id, f.after);
      return { status: 0, stdout: JSON.stringify({ Id: f.after.Id, Warnings: warning ? ['review-required'] : [] }) };
    }
    if (args[0] === 'context') return { status: 0, stdout: JSON.stringify({
      Host: remoteSocket ? 'tcp://remote:2376' : 'unix:///var/run/docker.sock',
    }) };
    if (args[0] === 'version') return { status: 0, stdout: '1.51\n' };
    if (args[0] === 'inspect') return { status: 0, stdout: JSON.stringify([refs.get(args[1])]) };
    if (args[0] === 'volume') return { status: 0, stdout: JSON.stringify([f.volume]) };
    if (args[0] === 'network') return { status: 0, stdout: JSON.stringify([network]) };
    if (args[0] === 'container' && args[1] === 'ls') {
      const ids = [...refs.keys(), ...(foreignReference ? [id('8')] : [])];
      return { status: 0, stdout: ids.join('\n') };
    }
    if (args[0] === 'container' && args[1] === 'inspect') {
      assert.equal(refs.has(args[2]), false);
      return { status: 1, stderr: `Error response from daemon: No such container: ${args[2]}` };
    }
    if (args[0] === 'stop') {
      f.before.State.Running = false;
      f.before.State.ExitCode = forcedStop ? 137 : 0;
      delete network.Containers[f.before.Id];
      return { status: 0, stdout: f.before.Id };
    }
    if (args[0] === 'rm') {
      refs.delete(args[1]);
      return { status: 0, stdout: args[1] };
    }
    if (args[0] === 'start') {
      f.after.State.Running = true;
      f.after.HostConfig.OomKillDisable = null;
      network.Containers[f.after.Id] = {};
      return { status: 0, stdout: f.after.Id };
    }
    assert.fail('Unexpected Docker recreation operation');
  };
  const write = (name, value) => {
    assert.equal(values[name], undefined);
    values[name] = structuredClone(value);
    const bytes = json(value);
    return bindings[name] = { path: `journal/step-0001/${name}`, bytes: Buffer.byteLength(bytes), sha256: hash(bytes) };
  };
  const run = () => recreateOwnedMysql({
    manifest: f.manifest, resources: f.resources, context, sequence: 1, execute, write,
    guard: () => { guardCalls++; assert.ok(!guardFailure); }, onCurrent: next => { current = next; },
  });
  const record = () => ({
    intent: values['intent.private.json'], stopped: values['stopped.json'],
    removed: values['removed.json'], created: values['created.json'],
    bindings: { intent: bindings['intent.private.json'], stopped: bindings['stopped.json'],
      removed: bindings['removed.json'], created: bindings['created.json'] },
  });
  return { ...f, original, calls, values, bindings, run, record, current: () => current, guardCalls: () => guardCalls };
}

test('successful recreation journals before mutation and proves graceful stop, old absence and new exact owner', () => {
  const f = mockRecreation();
  const result = f.run();
  assert.equal(result.resources.mysqlId, f.after.Id);
  assert.equal(f.current().mysqlId, f.after.Id);
  assert.equal(f.guardCalls(), 3);
  assert.deepEqual(Object.keys(f.values), ['intent.private.json', 'stopped.json', 'removed.json', 'created.json']);
  assert.ok(!f.calls.some(args => args.includes('--force') || args[0] === 'volume' && args[1] === 'rm'));
  const resolved = verifyMysqlRecreationRecords(f.original, [f.record()], context);
  assert.equal(resolved.resources.mysqlId, f.after.Id);
  assert.deepEqual(resolved.removedIds, [f.before.Id]);
  assert.deepEqual(resolved.witness, mysqlRecreationWitness(f.after));
});

test('failed replacement creation retains the removal receipt and resolves to no active MySQL for disposal', () => {
  const f = mockRecreation({ failCreate: true });
  assert.throws(f.run);
  assert.equal(f.current().mysqlId, null);
  const resolved = verifyMysqlRecreationRecords(f.original, [f.record()], context);
  assert.equal(resolved.resources.mysqlId, null);
  assert.deepEqual(resolved.removedIds, [f.before.Id]);
});

test('creation warnings remain failed but the exact new owner is journaled before rejecting readiness', () => {
  const f = mockRecreation({ warning: true });
  assert.throws(f.run, /warnings require review/);
  assert.equal(f.current().mysqlId, f.after.Id);
  assert.deepEqual(f.values['created.json'].warnings, ['review-required']);
  assert.equal(verifyMysqlRecreationRecords(f.original, [f.record()], context).resources.mysqlId, f.after.Id);
});

test('container creation rejects a remote Docker context rather than forwarding private settings', () => {
  const f = mockRecreation({ remoteSocket: true });
  assert.throws(f.run, /local Docker Unix socket/);
  assert.ok(!f.calls.some(args => args.includes('--data-binary')));
  assert.ok(!f.calls.some(args => ['stop', 'rm', 'start'].includes(args[0])));
});

test('configuration and mount witnesses are canonical JSON rather than enumeration-order dependent', () => {
  const f = fixture();
  const reordered = structuredClone(f.before);
  reordered.Config = Object.fromEntries(Object.entries(reordered.Config).reverse());
  reordered.HostConfig = Object.fromEntries(Object.entries(reordered.HostConfig).reverse());
  reordered.HostConfig.Tmpfs = Object.fromEntries(Object.entries(reordered.HostConfig.Tmpfs).reverse());
  assert.deepEqual(mysqlRecreationWitness(reordered), mysqlRecreationWitness(f.before));
});

test('forced shutdown cannot reach container removal or replacement creation', () => {
  const f = mockRecreation({ forcedStop: true });
  assert.throws(f.run, /successful MySQL shutdown/);
  assert.equal(f.values['removed.json'], undefined);
  assert.ok(!f.calls.some(args => ['rm', 'create'].includes(args[0])));
  assert.equal(verifyMysqlRecreationRecords(f.original, [f.record()], context).resources.mysqlId, f.before.Id);
});

test('foreign volume reference or failed deployment guard prevents every mutation', () => {
  for (const options of [{ foreignReference: true }, { guardFailure: true }]) {
    const f = mockRecreation(options);
    assert.throws(f.run);
    assert.ok(!f.calls.some(args => ['stop', 'rm', 'create', 'start'].includes(args[0])));
  }
});

test('two sequential replacements resolve only through their exact verified predecessor', () => {
  const f = mockRecreation();
  f.run();
  const first = structuredClone(f.record());
  first.verified = { contract: 'owned-mysql-recreation-verified-v1',
    created: first.bindings.created, mysqlId: f.after.Id, completePhysicalRowsUnchanged: true,
    witness: mysqlRecreationWitness(f.after) };
  first.bindings.verified = { path: 'journal/step-0001/verified.json', bytes: 100, sha256: id('5') };
  const second = structuredClone(first);
  second.intent.sequence = 2;
  second.intent.previous = first.bindings.created;
  second.intent.resourcesBefore = structuredClone(first.created.resourcesAfter);
  second.intent.before = structuredClone(f.after);
  second.intent.createRequest = mysqlRecreationCreateRequest(f.manifest, second.intent.resourcesBefore, second.intent.before);
  second.stopped.mysqlId = f.after.Id;
  second.removed.mysqlId = f.after.Id;
  second.created.resourcesAfter.mysqlId = id('6');
  second.created.witness.id = id('6');
  second.verified.mysqlId = id('6');
  second.verified.witness.id = id('6');
  const resolved = verifyMysqlRecreationRecords(f.original, [first, second], context);
  assert.equal(resolved.resources.mysqlId, id('6'));
  assert.deepEqual(resolved.removedIds, [f.before.Id, f.after.Id]);
  delete first.verified;
  assert.throws(() => verifyMysqlRecreationRecords(f.original, [first, second], context));
});

for (const [name, mutate] of [
  ['changed input hash', r => { r.intent.context.resourcesSha256 = id('0'); }],
  ['changed generator', r => { r.intent.generator.sha256 = id('0'); }],
  ['wrong sequence', r => { r.intent.sequence = 2; }],
  ['foreign before ID', r => { r.intent.resourcesBefore.mysqlId = id('0'); }],
  ['rewritten removal', r => { r.created.removed.sha256 = id('0'); }],
  ['shared replacement volume', r => { r.created.resourcesAfter.databaseStorage.name = 'shared'; }],
  ['wrong replacement image', r => { r.created.witness.image = `sha256:${id('0')}`; }],
  ['same replacement ID', r => { r.created.resourcesAfter.mysqlId = r.intent.resourcesBefore.mysqlId; }],
  ['unbound replacement witness ID', r => { r.created.witness.id = id('0'); }],
  ['unreviewed created-state configuration', r => { r.created.witness.hostConfigSha256 = id('0'); }],
  ['missing successful stop', r => { delete r.stopped; }],
  ['missing removal', r => { delete r.removed; }],
  ['unbound previous step', r => { r.intent.previous = { sha256: id('0') }; }],
]) {
  test(`transition resolver rejects ${name}`, () => {
    const f = mockRecreation();
    f.run();
    const record = structuredClone(f.record());
    mutate(record);
    assert.throws(() => verifyMysqlRecreationRecords(f.original, [record], context));
  });
}

test('filesystem journal loader rejects symlinks, foreign paths, changed private evidence and public permissions', () => {
  const f = mockRecreation();
  f.run();
  const workspace = fs.mkdtempSync(join(tmpdir(), 'owned-mysql-recreation-'));
  const base = join(workspace, '.artifacts/native-nonadmin-fixtures', f.original.runId);
  const journalPath = join(base, 'native-http-probe/mysql-recreations');
  const step = join(journalPath, 'step-0001');
  fs.mkdirSync(step, { recursive: true, mode: 0o700 });
  const intent = { ...f.values['intent.private.json'], generator: generator() };
  const write = (name, value) => {
    const bytes = json(value);
    fs.writeFileSync(join(step, name), bytes, { mode: 0o600 });
    return { path: join('.artifacts/native-nonadmin-fixtures', f.original.runId,
      'native-http-probe/mysql-recreations/step-0001', name), bytes: Buffer.byteLength(bytes), sha256: hash(bytes) };
  };
  try {
    const intentBinding = write('intent.private.json', intent);
    write('stopped.json', { ...f.values['stopped.json'], intent: intentBinding });
    const removed = write('removed.json', { ...f.values['removed.json'], intent: intentBinding });
    const created = write('created.json', { ...f.values['created.json'], intent: intentBinding, removed });
    const load = () => loadMysqlRecreationJournal({ workspace, base, journalPath, resources: f.original, context });
    assert.equal(load().resources.mysqlId, f.after.Id);
    const evidence = { before: [{ value: 'updated' }], after: [{ value: 'updated' }],
      stateBefore: { serverUuid: 'owned' }, stateAfter: { serverUuid: 'owned' },
      diskBefore: { fstype: 'ext4' }, diskAfter: { fstype: 'ext4' } };
    const evidenceBinding = write('readback.private.json', evidence);
    write('verified.json', { contract: 'owned-mysql-recreation-verified-v1', created,
      mysqlId: f.after.Id, completePhysicalRowsUnchanged: true, evidence: evidenceBinding,
      witness: mysqlRecreationWitness(f.after) });
    assert.equal(load().resources.mysqlId, f.after.Id);
    write('readback.private.json', { ...evidence, after: [] });
    assert.throws(load, /deep-equal/);
    write('readback.private.json', evidence);
    fs.chmodSync(join(step, 'created.json'), 0o644);
    assert.throws(load);
    fs.chmodSync(join(step, 'created.json'), 0o600);
    fs.renameSync(join(step, 'created.json'), join(workspace, 'external.json'));
    fs.symlinkSync(join(workspace, 'external.json'), join(step, 'created.json'));
    assert.throws(load);
    assert.throws(() => loadMysqlRecreationJournal({
      workspace, base, journalPath: resolve(workspace, 'foreign'), resources: f.original, context,
    }));
  } finally { fs.rmSync(workspace, { recursive: true, force: true }); }
});

test('created-state OOM normalization is explicit, while running-state configuration remains exact', () => {
  const f = fixture();
  const prestart = structuredClone(f.after);
  prestart.HostConfig.OomKillDisable = false;
  assert.deepEqual(mysqlRecreationCreatedWitness(f.before, f.after.Id), mysqlRecreationWitness(prestart));
  assert.notDeepEqual(mysqlRecreationWitness(prestart), mysqlRecreationWitness(f.after));
  assert.throws(() => verifyMysqlRecreationContainer(f.before, prestart, f.resources));
  prestart.HostConfig.OomKillDisable = true;
  assert.notDeepEqual(mysqlRecreationCreatedWitness(f.before, f.after.Id), mysqlRecreationWitness(prestart));
});

test('HTTP recreation requires explicit mutation mode and excludes ambiguous restart combinations', async () => {
  await assert.rejects(executeOwnedMatrix({ recreateOwnedMysql: true }), /active owned CRUD probe/);
  await assert.rejects(executeOwnedMatrix({ recreateOwnedMysql: 'true' }));
  await assert.rejects(executeOwnedMatrix({
    recreateOwnedMysql: true, restartOwnedMysql: true, allowOwnedProbeMutations: true,
  }), /never ambiguous/);
});
