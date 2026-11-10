import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import test from 'node:test';
import { createFixture } from '../prepare-run-owned-native-nonadmin-fixture.mjs';
import { mysqlFixtureProfile } from '../mysql-fixture-profiles.mjs';
import { OWNED_VOLUME_PROFILE, ownedMysqlVolumePlan } from '../owned-mysql-volume.mjs';
import { mysqlRecreationWitness, mysqlRecreationCreateRequest } from '../owned-mysql-recreation.mjs';
import {
  ownedMysqlColdState, verifyOwnedMysqlColdState, mysqlColdArchiveHelperArgs, verifyMysqlColdArchiveHelper,
  restoreOwnedMysqlColdBackup, loadMysqlColdRestoreJournal, verifyMysqlColdRestoreRecords,
} from '../owned-mysql-backup-restore.mjs';
import { executeOwnedMatrix } from '../run-owned-native-permission-http.mjs';
import { coldRunId, coldTestState, createColdTestArchive, coldArchiveEntries } from './mysql-cold-backup-fixture.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const context = Object.fromEntries(['manifest', 'sql', 'resources', 'deployment'].map(name => [`${name}Sha256`, 'f'.repeat(64)]));
const keyMap = {
  'intent.private.json': 'intent', 'stopped.json': 'stopped', 'backup.json': 'backup',
  'backup-manifest.private.json': 'backupManifest', 'removed.json': 'removed',
  'source-volume-removed.json': 'sourceVolumeRemoved', 'target-volume-created.json': 'targetVolume',
  'restored-manifest.private.json': 'restoredManifest', 'restored.json': 'restored',
  'created.json': 'created', 'verified.json': 'verified', 'readback.private.json': 'readback',
  ...Object.fromEntries(['backup', 'restore', 'restored'].flatMap(stage => ['created', 'removed'].map(status => [
    `${stage}-helper-${status}.json`, `${stage}Helper${status === 'created' ? 'Created' : 'Removed'}`,
  ]))),
  'target-init-helper-created.json': 'targetInitHelperCreated', 'target-init-helper-removed.json': 'targetInitHelperRemoved',
};

function fixture(options = {}) {
  const workspace = fs.mkdtempSync(join(tmpdir(), 'mysql-cold-restore-'));
  const base = join(workspace, '.artifacts/native-nonadmin-fixtures', coldRunId);
  const journalPath = join(base, 'native-http-unit/mysql-backup-restores');
  const directory = join(journalPath, 'step-0001');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const { manifest } = createFixture({ runId: coldRunId, passwordStorageMode: 'sm3', modelVersion: 816 });
  const profile = mysqlFixtureProfile(OWNED_VOLUME_PROFILE);
  const storage = { ...ownedMysqlVolumePlan(coldRunId, 'a'.repeat(32)), createdAt: '2026-11-06T01:00:00Z',
    mountpoint: `/var/lib/docker/volumes/nf-${coldRunId}-mysql-data/_data` };
  const resources = {
    contract: 'run-owned-native-fixture-resources-v1', runId: coldRunId, mysqlId: 'a'.repeat(64),
    networkId: 'b'.repeat(64), mysqlName: manifest.ownership.mysqlContainer, networkName: manifest.ownership.network,
    schemas: manifest.schemas, mysqlImage: profile.imageId,
    databaseProfile: { name: OWNED_VOLUME_PROFILE, imageId: profile.imageId }, databaseStorage: storage,
  };
  const before = {
    Id: resources.mysqlId, Image: profile.imageId, Name: `/${resources.mysqlName}`, Created: '2026-11-06T01:00:00Z',
    State: { Running: true, ExitCode: 0, OOMKilled: false, StartedAt: '2026-11-06T01:00:01Z' },
    Config: { User: profile.user, Hostname: 'a'.repeat(12), Labels: { 'aibiz.native-fixture.run': coldRunId },
      Env: [`MYSQL_ROOT_PASSWORD=${'d'.repeat(32)}`], Entrypoint: ['/bin/bash'], Cmd: [...profile.command] },
    HostConfig: { ReadonlyRootfs: true, Privileged: false, NetworkMode: resources.networkName, OomKillDisable: null,
      CapAdd: null, CapDrop: ['ALL'], Tmpfs: Object.fromEntries(profile.tmpfs.map(value => {
        const index = value.indexOf(':');
        return [value.slice(0, index), value.slice(index + 1)];
      })), Mounts: [{ Type: 'volume', Source: storage.name, Target: '/bitnami/mysql', VolumeOptions: { NoCopy: true } }] },
    Mounts: [{ Type: 'volume', Name: storage.name, Source: storage.mountpoint, Destination: '/bitnami/mysql', Driver: 'local', RW: true }],
    NetworkSettings: { Networks: { [resources.networkName]: {
      NetworkID: resources.networkId, IPAddress: '10.65.0.2', EndpointID: 'e'.repeat(64),
    } } },
  };
  const original = structuredClone(resources);
  const containers = new Map([[before.Id, before]]);
  let volume = { Name: storage.name, CreatedAt: storage.createdAt, Mountpoint: storage.mountpoint,
    Driver: 'local', Scope: 'local', Options: null, Labels: {
      'aibiz.native-fixture.run': coldRunId, 'aibiz.native-fixture.volume-nonce': storage.nonce,
    } };
  let serial = 10;
  let current = structuredClone(resources);
  const calls = [];
  const values = {};
  const bindings = {};
  const bytes = createColdTestArchive();
  const changed = coldArchiveEntries();
  changed.at(-1).content = 'different restored table bytes';
  const changedBytes = createColdTestArchive(changed);
  const execute = (command, args, settings = {}) => {
    calls.push({ command, args });
    if (command === 'python3') return spawnSync(command, args, settings);
    if (command === 'curl') {
      if (options.failMysqlCreate) return { status: 22 };
      const id = (++serial).toString(16).padStart(64, '0');
      const body = JSON.parse(settings.input);
      const created = { ...structuredClone(before), Id: id, Created: '2026-11-06T03:00:00Z',
        Config: Object.fromEntries(Object.entries(body).filter(([key]) => !['HostConfig', 'NetworkingConfig'].includes(key))),
        HostConfig: { ...body.HostConfig, OomKillDisable: false },
        State: { Running: false, ExitCode: 0, OOMKilled: false, StartedAt: '0001-01-01T00:00:00Z' } };
      created.NetworkSettings.Networks[resources.networkName].EndpointID = 'f'.repeat(64);
      containers.set(id, created);
      return { status: 0, stdout: JSON.stringify({ Id: id, Warnings: [] }) };
    }
    assert.equal(command, 'docker');
    if (args[0] === 'exec') {
      if (settings.input.startsWith('SET GLOBAL')) return { status: 0, stdout: options.failSlowShutdown ? '1' : '0' };
      const { innodbDataFiles, ...state } = coldTestState();
      return { status: 0, stdout: [JSON.stringify(state), ...innodbDataFiles.map(path => JSON.stringify([path]))].join('\n') };
    }
    if (args[0] === 'context') return { status: 0, stdout: JSON.stringify({ Host: 'unix:///var/run/docker.sock' }) };
    if (args[0] === 'version') return { status: 0, stdout: '1.51' };
    if (args[0] === 'inspect') {
      const container = containers.get(args[1]);
      assert.ok(container);
      return { status: 0, stdout: JSON.stringify([container]) };
    }
    if (args[0] === 'container' && args[1] === 'ls') {
      const refs = [...containers.values()].filter(row => row.Mounts.some(mount => mount.Name === storage.name)).map(row => row.Id);
      if (options.foreignReference) refs.push('8'.repeat(64));
      return { status: 0, stdout: refs.join('\n') };
    }
    if (args[0] === 'container' && args[1] === 'inspect') {
      assert.ok(!containers.has(args[2]));
      return { status: 1, stderr: `Error response from daemon: No such container: ${args[2]}` };
    }
    if (args[0] === 'volume') {
      if (args[1] === 'inspect') return volume ? { status: 0, stdout: JSON.stringify([volume]) } : {
        status: 1, stdout: '[]', stderr: `Error response from daemon: get ${storage.name}: no such volume`,
      };
      if (args[1] === 'rm') {
        assert.ok(volume);
        assert.ok(![...containers.values()].some(row => row.Mounts.some(mount => mount.Name === storage.name)));
        volume = undefined;
        return { status: 0, stdout: storage.name };
      }
      if (args[1] === 'create') {
        if (options.failVolumeCreate) return { status: 1 };
        assert.equal(volume, undefined);
        const label = args.filter((value, index) => args[index - 1] === '--label');
        volume = { Name: storage.name, CreatedAt: '2026-11-06T02:00:00Z', Mountpoint: storage.mountpoint,
          Driver: 'local', Scope: 'local', Options: null,
          Labels: Object.fromEntries(label.map(value => value.split('='))) };
        return { status: 0, stdout: storage.name };
      }
    }
    if (args[0] === 'create') {
      const id = (++serial).toString(16).padStart(64, '0');
      const name = args[args.indexOf('--name') + 1];
      const readOnly = args[args.indexOf('--mount') + 1].endsWith(',readonly');
      const init = args.at(-1).includes('chown');
      const container = { Id: id, Image: profile.imageId, Name: `/${name}`,
        Config: { User: init ? '0:0' : '1001:1001', Labels: { 'aibiz.native-fixture.run': coldRunId },
          Entrypoint: ['/bin/bash'], Cmd: args.slice(-2) },
        HostConfig: { ReadonlyRootfs: true, Privileged: false, NetworkMode: 'none',
          CapAdd: init ? ['CAP_CHOWN'] : null, CapDrop: ['ALL'], Mounts: [{
            Type: 'volume', Source: storage.name, Target: '/owned', ...(readOnly ? { ReadOnly: true } : {}),
            VolumeOptions: { NoCopy: true },
          }] },
        Mounts: [{ Type: 'volume', Name: storage.name, Source: storage.mountpoint, Destination: '/owned', Driver: 'local', RW: !readOnly }],
        State: { Running: false, ExitCode: 0, OOMKilled: false } };
      containers.set(id, container);
      return { status: 0, stdout: id };
    }
    if (args[0] === 'stop') {
      before.State.Running = false;
      before.State.ExitCode = options.forcedStop ? 137 : 0;
      return { status: 0, stdout: before.Id };
    }
    if (args[0] === 'rm') {
      const id = args.at(-1);
      assert.ok(containers.has(id));
      containers.delete(id);
      return { status: 0, stdout: id };
    }
    if (args[0] === 'start') {
      const container = containers.get(args.at(-1));
      assert.ok(container);
      if (container.Name === before.Name) {
        container.State.Running = true;
        container.State.StartedAt = '2026-11-06T03:00:01Z';
        container.HostConfig.OomKillDisable = null;
      } else {
        if (settings.stdio) fs.writeFileSync(settings.stdio[1], options.corruptBackup
          ? Buffer.from('corrupt gzip') : container.Name.includes('-restored-') && options.corruptRestored ? changedBytes : bytes);
        if (settings.input) assert.deepEqual(settings.input, bytes);
      }
      return { status: 0, stdout: '', stderr: '' };
    }
    assert.fail('Unexpected owned cold recovery operation');
  };
  const write = (name, value) => {
    assert.ok(!values[name]);
    const bytes = json(value);
    fs.writeFileSync(join(directory, name), bytes, { mode: 0o600, flag: 'wx' });
    values[name] = structuredClone(value);
    return bindings[name] = { path: relative(workspace, join(directory, name)),
      bytes: Buffer.byteLength(bytes), sha256: hash(bytes) };
  };
  const record = () => {
    const row = { bindings: {} };
    for (const [name, value] of Object.entries(values)) {
      row[keyMap[name]] = value;
      row.bindings[keyMap[name]] = bindings[name];
    }
    return row;
  };
  let guardCalls = 0;
  const run = () => restoreOwnedMysqlColdBackup({
    workspace, directory, manifest, resources, context, sequence: 1, execute, write,
    guard: () => { guardCalls++; assert.ok(!options.failedGuard); }, onCurrent: next => { current = next; },
  });
  const verify = result => {
    const evidence = write('readback.private.json', { stateBefore: result.stateBefore, stateAfter: result.stateBefore,
      before: [{ probe: 'updated' }], after: [{ probe: 'updated' }],
      diskBefore: { fstype: 'ext4' }, diskAfter: { fstype: 'ext4' } });
    write('verified.json', { contract: 'owned-mysql-cold-restore-verified-v1', created: result.created,
      mysqlId: current.mysqlId, everyPhysicalFileEqual: true, completePhysicalRowsUnchanged: true, evidence,
      witness: mysqlRecreationWitness(containers.get(current.mysqlId)) });
  };
  const load = () => loadMysqlColdRestoreJournal({ workspace, base, journalPath, resources: original, context });
  return { workspace, directory, resources, original, before, execute, calls, values, bindings, write, record,
    run, verify, load, current: () => current, guardCalls: () => guardCalls,
    dispose: () => fs.rmSync(workspace, { recursive: true, force: true }) };
}

test('cold recovery restores a checked archive into a genuinely new volume and container without rewriting original resources', () => {
  const f = fixture();
  try {
    const result = f.run();
    f.verify(result);
    const resolved = f.load();
    assert.equal(resolved.resources.mysqlId, f.current().mysqlId);
    assert.notEqual(resolved.resources.mysqlId, f.original.mysqlId);
    assert.notEqual(resolved.resources.databaseStorage.nonce, f.original.databaseStorage.nonce);
    assert.deepEqual(resolved.removedIds, [f.original.mysqlId]);
    assert.deepEqual(resolved.removedVolumes, [f.original.databaseStorage]);
    assert.deepEqual(f.resources, f.original);
    assert.equal(f.guardCalls(), 3);
    assert.equal(result.files, 11);
    assert.ok(f.values['backup-helper-removed.json'] && f.values['restore-helper-removed.json']);
    assert.ok(f.values['restored-helper-removed.json'] && f.values['target-init-helper-removed.json']);
    assert.ok(f.calls.some(row => row.args[0] === 'stop' && row.args.includes('120')));
    const removedSource = f.calls.findIndex(row => row.args[0] === 'rm' && row.args.at(-1) === f.original.mysqlId);
    const removedVolume = f.calls.findIndex(row => row.args[0] === 'volume' && row.args[1] === 'rm');
    const createTarget = f.calls.findIndex(row => row.command === 'curl');
    assert.ok(removedSource >= 0 && removedVolume > removedSource && createTarget > removedVolume);
  } finally { f.dispose(); }
});

for (const [name, option, expectedRemoved] of [
  ['bad archive', 'corruptBackup', false], ['forced shutdown', 'forcedStop', false],
  ['fast shutdown not disabled', 'failSlowShutdown', false], ['foreign volume reference', 'foreignReference', false],
  ['failed deployment guard', 'failedGuard', false], ['changed restored bytes', 'corruptRestored', true],
  ['failed fresh volume creation', 'failVolumeCreate', true], ['failed replacement creation', 'failMysqlCreate', true],
]) {
  test(`cold recovery fails closed for ${name} with an unambiguous disposal journal`, () => {
    const f = fixture({ [option]: true });
    try {
      assert.throws(f.run);
      const sourceRemoved = f.calls.some(row => row.args[0] === 'rm' && row.args.at(-1) === f.original.mysqlId);
      assert.equal(sourceRemoved, expectedRemoved);
      assert.equal(Boolean(f.values['removed.json']), expectedRemoved);
      assert.equal(f.values['verified.json'], undefined);
      if (f.values['intent.private.json']) {
        const resolved = f.load();
        assert.equal(resolved.resources.mysqlId, expectedRemoved ? null : f.original.mysqlId);
        if (option === 'failVolumeCreate') assert.equal(resolved.resources.databaseStorage, null);
      }
    } finally { f.dispose(); }
  });
}

for (const [name, mutate] of [
  ['foreign context', row => { row.intent.context.sqlSha256 = '0'.repeat(64); }],
  ['reused target volume identity', row => { row.intent.targetPlan.nonce = row.intent.resourcesBefore.databaseStorage.nonce; }],
  ['missing cold shutdown', row => { delete row.stopped; }],
  ['missing checked backup', row => { delete row.backup; }],
  ['source volume not removed', row => { delete row.sourceVolumeRemoved; }],
  ['wrong restored identity', row => { row.targetVolume.storage.nonce = 'f'.repeat(32); }],
  ['different cold file hash', row => { row.restoredManifest.entries.at(-1).sha256 = '0'.repeat(64); }],
  ['missing fresh-volume initialization', row => { delete row.targetInitHelperRemoved; }],
  ['unbound archive', row => { row.backup.archive.sha256 = '0'.repeat(64); }],
  ['unremoved helper', row => { delete row.restoreHelperRemoved; }],
  ['wrong running configuration', row => { row.verified.witness.hostConfigSha256 = '0'.repeat(64); }],
  ['changed database state', row => { row.readback.stateAfter.serverUuid = 'foreign'; }],
  ['changed native data', row => { row.readback.after = []; }],
]) {
  test(`cold recovery journal rejects ${name}`, () => {
    const f = fixture();
    try {
      const result = f.run();
      f.verify(result);
      const row = structuredClone(f.record());
      mutate(row);
      assert.throws(() => verifyMysqlColdRestoreRecords(f.original, [row], context));
    } finally { f.dispose(); }
  });
}

test('journal loader re-hashes backup bytes and refuses public files, symlinks and changed evidence', () => {
  const f = fixture();
  try {
    const result = f.run();
    f.verify(result);
    assert.equal(f.load().resources.mysqlId, f.current().mysqlId);
    fs.chmodSync(join(f.directory, 'backup.private.tgz'), 0o644);
    assert.throws(f.load);
    fs.chmodSync(join(f.directory, 'backup.private.tgz'), 0o600);
    const path = join(f.directory, 'backup.private.tgz');
    const bytes = fs.readFileSync(path);
    fs.writeFileSync(path, bytes.subarray(0, bytes.length - 8));
    assert.throws(f.load);
    fs.writeFileSync(path, bytes);
    fs.renameSync(path, join(f.workspace, 'external.tgz'));
    fs.symlinkSync(join(f.workspace, 'external.tgz'), path);
    assert.throws(f.load);
  } finally { f.dispose(); }
});

test('two cold recoveries require the exact verified predecessor and distinct successive volume identities', () => {
  const f = fixture();
  try {
    const result = f.run();
    f.verify(result);
    const first = structuredClone(f.record());
    const second = structuredClone(first);
    const current = first.created.resourcesAfter;
    const target = { ...current.databaseStorage, nonce: 'c'.repeat(32), createdAt: '2026-11-06T04:00:00Z' };
    second.intent.sequence = 2;
    second.intent.previous = first.bindings.created;
    second.intent.resourcesBefore = current;
    second.intent.before.Id = current.mysqlId;
    second.intent.before.Created = '2026-11-06T03:00:00Z';
    const { createdAt, mountpoint, ...plan } = target;
    second.intent.targetPlan = plan;
    second.intent.createRequest = mysqlRecreationCreateRequest({
      runId: coldRunId, ownership: { mysqlContainer: current.mysqlName, network: current.networkName },
    }, current, second.intent.before);
    second.stopped.mysqlId = current.mysqlId;
    second.removed.mysqlId = current.mysqlId;
    second.sourceVolumeRemoved.storage = current.databaseStorage;
    second.targetVolume.storage = target;
    second.created.resourcesAfter = { ...current, mysqlId: '6'.repeat(64), databaseStorage: target };
    second.created.witness.id = '6'.repeat(64);
    second.verified.mysqlId = '6'.repeat(64);
    second.verified.witness.id = '6'.repeat(64);
    for (const stage of ['backup', 'restore', 'restored']) {
      const state = stage === 'backup' ? current : { ...current, mysqlId: null, databaseStorage: target };
      const args = mysqlColdArchiveHelperArgs(state, 2, stage, stage === 'restore' ? 'extract' : 'archive');
      second[`${stage}HelperCreated`].name = args[args.indexOf('--name') + 1];
    }
    second.targetInitHelperCreated.name = `nf-${coldRunId}-mysql-volume-init-${target.nonce.slice(0, 12)}`;
    second.targetInitHelperRemoved.name = second.targetInitHelperCreated.name;
    const resolved = verifyMysqlColdRestoreRecords(f.original, [first, second], context);
    assert.equal(resolved.resources.mysqlId, '6'.repeat(64));
    assert.deepEqual(resolved.removedIds, [f.original.mysqlId, current.mysqlId]);
    assert.deepEqual(resolved.removedVolumes, [f.original.databaseStorage, current.databaseStorage]);
    delete first.verified;
    assert.throws(() => verifyMysqlColdRestoreRecords(f.original, [first, second], context));
  } finally { f.dispose(); }
});

test('cold archive helpers use only non-root offline mounts and bind their exact commands', () => {
  const f = fixture();
  try {
    const resources = f.original;
    for (const stage of ['backup', 'restore', 'restored']) {
      const args = mysqlColdArchiveHelperArgs(resources, 1, stage, stage === 'restore' ? 'extract' : 'archive');
      assert.ok(args.includes('1001:1001') && args.includes('none') && args.includes('--read-only'));
      assert.ok(args.includes('--cap-drop=ALL') && !args.includes('--cap-add'));
      assert.equal(args[args.indexOf('--mount') + 1].endsWith(',readonly'), stage !== 'restore');
      const id = f.execute('docker', args).stdout;
      const container = JSON.parse(f.execute('docker', ['inspect', id]).stdout)[0];
      verifyMysqlColdArchiveHelper(resources, args, container);
      container.Config.User = '0:0';
      assert.throws(() => verifyMysqlColdArchiveHelper(resources, args, container));
    }
    assert.throws(() => mysqlColdArchiveHelperArgs(resources, 1, 'backup', 'extract'));
    assert.throws(() => mysqlColdArchiveHelperArgs(resources, 3, 'backup', 'archive'));
  } finally { f.dispose(); }
});

test('cold recovery refuses external durable paths, crash-fast shutdown and unreviewed server settings', () => {
  verifyOwnedMysqlColdState(coldTestState());
  for (const delta of [
    { innodbFastShutdown: 2 }, { innodbDataHomeDir: '/shared' }, { innodbLogHomeDir: '/shared' },
    { innodbUndoDir: '/shared' }, { innodbDataFilePath: '/shared/ibdata1:12M:autoextend' },
    { logBinBase: '/shared/binlog' }, { innodbFlushLogAtTrxCommit: 2 }, { version: '8.0.0' },
    { datadir: '/tmp/data/' }, { serverUuid: '' }, { lowerCaseTableNames: 0 },
    { innodbDataHomeDir: false }, { logBinBase: false }, { logBin: 1 }, { logBin: 2 },
    { innodbDataFiles: ['/shared/model.ibd'] }, { innodbDataFiles: ['./../shared/model.ibd'] },
    { innodbDataFiles: [] }, { innodbDataFiles: ['a.ibd', 'a.ibd'] },
  ]) assert.throws(() => verifyOwnedMysqlColdState({ ...coldTestState(), ...delta }));
  const f = fixture();
  try { assert.deepEqual(ownedMysqlColdState(f.original, f.execute), coldTestState()); }
  finally { f.dispose(); }
});

test('observed unset data-home and disabled binary logs are explicit null values, not external paths', () => {
  verifyOwnedMysqlColdState(coldTestState());
  verifyOwnedMysqlColdState({ ...coldTestState(), innodbDataHomeDir: '', logBinBase: '' });
  verifyOwnedMysqlColdState({ ...coldTestState(), logBin: 1, logBinBase: '/bitnami/mysql/data/binlog' });
  assert.throws(() => verifyOwnedMysqlColdState({ ...coldTestState(), logBin: 1, logBinBase: null }));
  assert.throws(() => verifyOwnedMysqlColdState({ ...coldTestState(), logBin: 1, logBinBase: '/bitnami/mysql/data/../external/log' }));
});

test('HTTP backup recovery requires explicit mutation and excludes simultaneous MySQL lifecycle modes', async () => {
  await assert.rejects(executeOwnedMatrix({ restoreOwnedMysqlBackup: true }), /active owned CRUD probe/);
  await assert.rejects(executeOwnedMatrix({ restoreOwnedMysqlBackup: 'true' }));
  for (const delta of [{ restartOwnedMysql: true }, { recreateOwnedMysql: true }]) {
    await assert.rejects(executeOwnedMatrix({ restoreOwnedMysqlBackup: true, allowOwnedProbeMutations: true, ...delta }),
      /exactly one MySQL lifecycle/);
  }
});
