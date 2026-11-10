import assert from 'node:assert/strict';
import test from 'node:test';
import {
  OWNED_VOLUME_PROFILE, ownedMysqlVolumePlan, validateOwnedMysqlVolumeDescriptor,
  verifyOwnedMysqlVolume, verifyOwnedMysqlVolumeReferences, inspectMysqlFixtureVolumes,
  createOwnedMysqlVolume, removeOwnedMysqlVolume,
  initializeOwnedMysqlVolume,
  verifyOwnedMysqlDiskBacking,
  selectOwnedMysqlFilesystem,
} from '../owned-mysql-volume.mjs';
import { mysqlFixtureArgs, mysqlFixtureProfile, verifySelectedMysqlStorage } from '../mysql-fixture-profiles.mjs';
import { verifyOwnedMysqlRestart } from '../run-owned-native-permission-http.mjs';

function volumeFixture() {
  const runId = 'abc123def456';
  const profile = mysqlFixtureProfile(OWNED_VOLUME_PROFILE);
  const storage = { ...ownedMysqlVolumePlan(runId, 'a'.repeat(32)),
    createdAt: '2026-11-05T10:00:00Z', mountpoint: `/var/lib/docker/volumes/nf-${runId}-mysql-data/_data` };
  const volume = { Name: storage.name, Driver: 'local', Scope: 'local', Options: null,
    CreatedAt: storage.createdAt, Mountpoint: storage.mountpoint,
    Labels: { 'aibiz.native-fixture.run': runId, 'aibiz.native-fixture.volume-nonce': storage.nonce } };
  const resources = { runId, mysqlId: 'b'.repeat(64), databaseProfile: {
    name: OWNED_VOLUME_PROFILE, imageId: profile.imageId,
  }, databaseStorage: storage };
  const tmpfs = Object.fromEntries(profile.tmpfs.map(value => {
    const index = value.indexOf(':');
    return [value.slice(0, index), value.slice(index + 1)];
  }));
  const container = { Id: resources.mysqlId, Image: profile.imageId, Name: `/nf-${runId}-mysql`,
    State: { Running: true, StartedAt: '2026-11-05T10:00:00Z' },
    Config: { User: profile.user, Labels: { 'aibiz.native-fixture.run': runId } },
    HostConfig: { ReadonlyRootfs: true, Tmpfs: tmpfs, Mounts: [{
      Type: 'volume', Source: storage.name, Target: '/bitnami/mysql', VolumeOptions: { NoCopy: true },
    }] }, Mounts: [{ Type: 'volume', Name: storage.name, Source: storage.mountpoint,
      Destination: '/bitnami/mysql', Driver: 'local', RW: true }] };
  return { profile, storage, volume, resources, container };
}

test('disk profile is explicit, frozen and leaves all non-data temporary storage restrictions intact', () => {
  const f = volumeFixture();
  const memory = mysqlFixtureProfile('mysql57-bitnami-arm64');
  assert.equal(Object.isFrozen(f.profile), true);
  assert.equal(Object.isFrozen(f.profile.tmpfs), true);
  assert.deepEqual(f.profile.tmpfs, memory.tmpfs.filter(value => !value.startsWith('/bitnami/mysql:')));
  assert.equal(f.profile.imageId, memory.imageId);
  const args = mysqlFixtureArgs(f.profile, 'a'.repeat(32), f.storage);
  assert.ok(args.includes(`type=volume,src=${f.storage.name},dst=/bitnami/mysql,volume-nocopy`));
  assert.throws(() => mysqlFixtureArgs(memory, 'a'.repeat(32), f.storage));
  assert.throws(() => mysqlFixtureArgs(f.profile, 'a'.repeat(32)));
  verifySelectedMysqlStorage(f.resources.databaseProfile, f.container, { storage: f.storage, volumes: [f.volume] });
  assert.throws(() => verifySelectedMysqlStorage(f.resources.databaseProfile, f.container));
});

for (const [name, mutate] of [
  ['foreign owner', f => { f.volume.Labels['aibiz.native-fixture.run'] = 'f'.repeat(12); }],
  ['wrong nonce', f => { f.volume.Labels['aibiz.native-fixture.volume-nonce'] = 'f'.repeat(32); }],
  ['recreated volume', f => { f.volume.CreatedAt = '2026-11-05T11:00:00Z'; }],
  ['new directory', f => { f.volume.Mountpoint += '-replacement'; }],
  ['external bind', f => { f.volume.Options = { type: 'none', o: 'bind', device: '/shared' }; }],
  ['remote driver', f => { f.volume.Driver = 'nfs'; }],
  ['global scope', f => { f.volume.Scope = 'global'; }],
  ['extra label', f => { f.volume.Labels.shared = 'true'; }],
]) {
  test(`owned volume rejects ${name}`, () => {
    const f = volumeFixture();
    mutate(f);
    assert.throws(() => verifyOwnedMysqlVolume(f.storage, f.volume));
    assert.throws(() => verifySelectedMysqlStorage(f.resources.databaseProfile, f.container,
      { storage: f.storage, volumes: [f.volume] }));
  });
}

for (const [name, mutate] of [
  ['missing nocopy', f => { delete f.container.HostConfig.Mounts[0].VolumeOptions; }],
  ['wrong mount source', f => { f.container.Mounts[0].Source = '/foreign'; }],
  ['read-only data', f => { f.container.Mounts[0].RW = false; }],
  ['second volume', f => { f.container.Mounts.push({ ...f.container.Mounts[0] }); }],
  ['host mount', f => { f.container.Mounts.push({ Type: 'bind', Source: '/shared' }); }],
  ['data tmpfs substitution', f => { f.container.HostConfig.Tmpfs['/bitnami/mysql'] = 'rw'; }],
  ['wrong target', f => { f.container.HostConfig.Mounts[0].Target = '/other'; }],
  ['unbound descriptor', f => { f.storage.extra = true; }],
  ['foreign container', f => { f.container.Config.Labels = {}; }],
]) {
  test(`persistent profile rejects ${name}`, () => {
    const f = volumeFixture();
    mutate(f);
    assert.throws(() => verifySelectedMysqlStorage(f.resources.databaseProfile, f.container,
      { storage: f.storage, volumes: [f.volume] }));
  });
}

test('descriptors are exact run-scoped identities, not volume-name prefix adoption', () => {
  const f = volumeFixture();
  validateOwnedMysqlVolumeDescriptor(f.storage);
  for (const delta of [
    { name: `${f.storage.name}-other` }, { nonce: '' }, { runId: '../escape' },
    { createdAt: 'not-a-date' }, { mountpoint: '/shared' }, { extra: true },
  ]) assert.throws(() => validateOwnedMysqlVolumeDescriptor({ ...f.storage, ...delta }));
});

test('volume references include stopped containers and must match the sole exact owner', () => {
  const id = 'a'.repeat(64);
  verifyOwnedMysqlVolumeReferences([id], [id]);
  verifyOwnedMysqlVolumeReferences([], []);
  for (const refs of [[], [id, 'b'.repeat(64)], [id, id], ['short']]) {
    assert.throws(() => verifyOwnedMysqlVolumeReferences(refs, [id]));
  }
});

test('disk evidence rejects remote daemons, memory, overlay and external filesystems', () => {
  const f = volumeFixture();
  const filesystem = { target: '/', source: '/dev/nvme0n1p2', fstype: 'ext4' };
  const endpoint = { Host: 'unix:///var/run/docker.sock' };
  const verify = (fs = filesystem, host = endpoint, root = '/var/lib/docker') =>
    verifyOwnedMysqlDiskBacking(f.storage, root, host, fs);
  assert.equal(verify().fstype, 'ext4');
  for (const fstype of ['tmpfs', 'overlay', 'nfs', 'cifs', 'unknown']) {
    assert.throws(() => verify({ ...filesystem, fstype }));
  }
  assert.throws(() => verify(filesystem, { Host: 'tcp://remote:2376' }));
  assert.throws(() => verify(filesystem, endpoint, '/other/docker'));
  assert.throws(() => verify({ ...filesystem, source: 'tmpfs' }));
  assert.throws(() => verify({ ...filesystem, target: '/other' }));
});

test('kernel mount selection uses the deepest actual ancestor and cannot overlook a memory submount', () => {
  const f = volumeFixture();
  const root = { target: '/', source: '/dev/nvme0n1p2', fstype: 'ext4' };
  const data = { target: '/var/lib/docker/volumes', source: 'tmpfs', fstype: 'tmpfs' };
  const unrelated = { target: '/var/lib/docker/volumes-other', source: 'tmpfs', fstype: 'tmpfs' };
  assert.deepEqual(selectOwnedMysqlFilesystem(f.storage.mountpoint, [root, unrelated]), root);
  assert.deepEqual(selectOwnedMysqlFilesystem(f.storage.mountpoint, [root, data]), data);
  assert.throws(() => selectOwnedMysqlFilesystem(f.storage.mountpoint, [unrelated]));
  assert.throws(() => selectOwnedMysqlFilesystem(f.storage.mountpoint, [root, root]));
  assert.throws(() => verifyOwnedMysqlDiskBacking(f.storage, '/var/lib/docker',
    { Host: 'unix:///var/run/docker.sock' }, selectOwnedMysqlFilesystem(f.storage.mountpoint, [root, data])));
});

test('actual volume inspector binds identity and requests all full-length container references', () => {
  const f = volumeFixture();
  const calls = [];
  const execute = (command, args) => {
    calls.push([command, args]);
    return { status: 0, stdout: args[0] === 'volume' ? JSON.stringify([f.volume]) : `${f.resources.mysqlId}\n` };
  };
  assert.deepEqual(inspectMysqlFixtureVolumes(f.resources, { execute }), [f.volume]);
  assert.deepEqual(calls[1], ['docker', ['container', 'ls', '--all', '--no-trunc', '--quiet',
    '--filter', `volume=${f.storage.name}`]]);
  assert.throws(() => inspectMysqlFixtureVolumes(f.resources, { execute, expectedRefs: [] }));
  assert.deepEqual(inspectMysqlFixtureVolumes({}), []);
  assert.throws(() => inspectMysqlFixtureVolumes({ databaseStorage: f.storage }));
});

test('volume creation refuses existing targets and removal refuses external references before deletion', () => {
  const f = volumeFixture();
  const plan = ownedMysqlVolumePlan(f.resources.runId, f.storage.nonce);
  let writes = 0;
  assert.throws(() => createOwnedMysqlVolume(plan, () => ({ status: 0, stdout: '[]' })));
  assert.throws(() => removeOwnedMysqlVolume(f.resources, (command, args) => {
    if (args[1] === 'rm') writes++;
    return { status: 0, stdout: args[0] === 'volume' ? JSON.stringify([f.volume]) : `${'f'.repeat(64)}\n` };
  }));
  assert.equal(writes, 0);
});

test('volume creation records exact observed identity and deletion verifies typed absence', () => {
  const f = volumeFixture();
  const calls = [];
  let created = false;
  const execute = (command, args) => {
    calls.push(args);
    if (args[1] === 'create') {
      created = true;
      return { status: 0, stdout: `${f.storage.name}\n` };
    }
    if (args[1] === 'rm') {
      created = false;
      return { status: 0, stdout: `${f.storage.name}\n` };
    }
    if (args[0] === 'container') return { status: 0, stdout: '' };
    return created ? { status: 0, stdout: JSON.stringify([f.volume]) } : {
      status: 1, stderr: `Error response from daemon: get ${f.storage.name}: no such volume\n`,
    };
  };
  assert.deepEqual(createOwnedMysqlVolume(ownedMysqlVolumePlan(f.resources.runId, f.storage.nonce), execute), f.storage);
  assert.equal(removeOwnedMysqlVolume(f.resources, execute), f.storage.name);
  assert.ok(calls.some(args => args.includes(`aibiz.native-fixture.volume-nonce=${f.storage.nonce}`)));
});

for (const exitCode of [0, 1]) {
  test(`fresh volume permission helper is isolated, journaled and removed (exit ${exitCode})`, () => {
    const f = volumeFixture();
    const id = 'c'.repeat(64);
    let helper;
    let started = false;
    const journal = [];
    const calls = [];
    const execute = (command, args) => {
      calls.push(args);
      if (args[0] === 'create') {
        const value = name => args[args.indexOf(name) + 1];
        helper = { Id: id, Image: f.profile.imageId, Name: `/${value('--name')}`,
          Config: { Labels: { 'aibiz.native-fixture.run': f.resources.runId },
            User: '0:0', Entrypoint: ['/bin/bash'], Cmd: args.slice(-2) },
          HostConfig: { NetworkMode: 'none', ReadonlyRootfs: true, Privileged: false,
            CapAdd: ['CAP_CHOWN'], CapDrop: ['ALL'], Mounts: [{
              Type: 'volume', Source: f.storage.name, Target: '/owned', VolumeOptions: { NoCopy: true },
            }] },
          Mounts: [{ ...f.container.Mounts[0], Destination: '/owned' }],
          State: { Running: false, ExitCode: exitCode } };
        assert.ok(args.includes('--pull=never'));
        return { status: 0, stdout: id };
      }
      if (args[0] === 'start') {
        started = true;
        return { status: exitCode, stdout: '' };
      }
      if (args[0] === 'inspect') return { status: 0, stdout: JSON.stringify([helper]) };
      if (args[0] === 'rm') {
        helper = undefined;
        return { status: 0, stdout: id };
      }
      if (args[0] === 'container') return { status: 0, stdout: helper ? id : '' };
      if (args[0] === 'volume') return { status: 0, stdout: JSON.stringify([f.volume]) };
      assert.fail('Unexpected helper operation');
    };
    const run = () => initializeOwnedMysqlVolume(f.resources, f.profile, {
      execute, journal: row => journal.push(row),
    });
    if (exitCode) assert.throws(run);
    else run();
    assert.equal(started, true);
    assert.equal(helper, undefined);
    assert.deepEqual(journal.map(row => row.status), ['created', 'removed']);
    const create = calls.find(args => args[0] === 'create');
    assert.ok(create.includes('--cap-drop=ALL') && create.includes('--security-opt=no-new-privileges'));
    assert.ok(create.at(-1).includes('test -z "$(ls -A /owned)"'));
  });
}

test('same-container restart requires new start time, identical configuration, database UUID and complete rows', () => {
  const { container } = volumeFixture();
  const after = structuredClone(container);
  after.State.StartedAt = '2026-11-05T11:00:00Z';
  const state = { serverUuid: '12345678-1234-1234-1234-123456789abc',
    datadir: '/bitnami/mysql/data/', innodbFlushLogAtTrxCommit: 1, syncBinlog: 1 };
  const rows = [{ database: 'owned', table: 't_srfpsmodule', row: { PSMODULEID: 'probe', MODTAG: 'updated' } }];
  verifyOwnedMysqlRestart(container, after, state, state, rows, rows);
  for (const mutate of [
    value => { value.Id = 'f'.repeat(64); }, value => { value.State.StartedAt = container.State.StartedAt; },
    value => { value.Config.User = '0:0'; }, value => { value.Mounts[0].Name = 'foreign'; },
    value => { value.State.Running = false; }, value => { value.HostConfig.ReadonlyRootfs = false; },
  ]) {
    const changed = structuredClone(after);
    mutate(changed);
    assert.throws(() => verifyOwnedMysqlRestart(container, changed, state, state, rows, rows));
  }
  assert.throws(() => verifyOwnedMysqlRestart(container, after, state, { ...state, serverUuid: 'new' }, rows, rows));
  assert.throws(() => verifyOwnedMysqlRestart(container, after, state, state, rows, []));
});
