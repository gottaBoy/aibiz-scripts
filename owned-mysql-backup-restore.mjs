import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { closeSync, constants, fsyncSync, openSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PinnedDirectories, readPinnedFile } from './native-candidate-files.mjs';
import { mysqlFixtureProfile, verifySelectedMysqlStorage } from './mysql-fixture-profiles.mjs';
import {
  OWNED_VOLUME_PROFILE, ownedMysqlVolumePlan, createOwnedMysqlVolume, initializeOwnedMysqlVolume,
  inspectMysqlFixtureVolumes, removeOwnedMysqlVolume, validateOwnedMysqlVolumeDescriptor,
} from './owned-mysql-volume.mjs';
import {
  mysqlRecreationCreateRequest, mysqlRecreationCreatedWitness, mysqlRecreationWitness,
  recreationTransport, createExactContainer, verifyMysqlRecreationContainer,
} from './owned-mysql-recreation.mjs';
import { inspectMysqlColdArchive } from './mysql-cold-backup-archive.mjs';

const toolPath = 'scripts/owned-mysql-backup-restore.mjs';
const ownerKey = 'aibiz.native-fixture.run';
const idPattern = /^[a-f0-9]{64}$/;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const generator = () => ({ path: toolPath, sha256: hash(readFileSync(fileURLToPath(import.meta.url))) });

function docker(args, execute, allowFailure = false) {
  const result = execute('docker', args, { encoding: 'utf8', timeout: 180_000, maxBuffer: 32 * 1024 * 1024 });
  assert.ok(!result.error && !result.signal, 'Owned cold recovery command did not complete');
  if (!allowFailure) assert.equal(result.status, 0, 'Owned cold recovery command failed; private output suppressed');
  return result;
}

export function ownedMysqlColdState(resources, execute = spawnSync) {
  const profile = mysqlFixtureProfile(resources.databaseProfile.name);
  const query = [
    "SELECT JSON_OBJECT('serverUuid',@@server_uuid,'version',VERSION(),'datadir',@@datadir,",
    "'lowerCaseTableNames',@@lower_case_table_names,'characterSet',@@character_set_server,",
    "'innodbFlushLogAtTrxCommit',@@innodb_flush_log_at_trx_commit,'syncBinlog',@@sync_binlog,",
    "'innodbFastShutdown',@@innodb_fast_shutdown,'innodbDataHomeDir',@@innodb_data_home_dir,",
    "'innodbLogHomeDir',@@innodb_log_group_home_dir,'innodbUndoDir',@@innodb_undo_directory,",
    "'innodbDataFilePath',@@innodb_data_file_path,'logBin',@@log_bin,'logBinBase',@@log_bin_basename);",
    'SELECT JSON_ARRAY(PATH) FROM information_schema.INNODB_SYS_DATAFILES;',
  ].join('');
  const result = execute('docker', ['exec', '-i', resources.mysqlId, 'sh', '-c',
    `MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec ${profile.client} -h127.0.0.1 --protocol=TCP -uroot --batch --raw --skip-column-names`], {
    input: query, encoding: 'utf8', timeout: 60_000, maxBuffer: 1024 * 1024,
  });
  assert.ok(!result.error && !result.signal && result.status === 0, 'Cold recovery state query failed');
  const lines = result.stdout.trim().split('\n');
  const state = JSON.parse(lines[0]);
  state.innodbDataFiles = lines.slice(1).map(line => {
    const value = JSON.parse(line);
    assert.ok(Array.isArray(value) && value.length === 1);
    return value[0];
  }).sort();
  verifyOwnedMysqlColdState(state);
  return state;
}

export function verifyOwnedMysqlColdState(state) {
  assert.match(state.serverUuid, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
  assert.ok(state.version === '5.7.41' || state.version.startsWith('5.7.41-'));
  assert.equal(state.datadir, '/bitnami/mysql/data/');
  assert.equal(state.lowerCaseTableNames, 1);
  assert.equal(state.characterSet, 'utf8mb4');
  assert.equal(state.innodbFlushLogAtTrxCommit, 1);
  assert.ok([0, 1].includes(state.innodbFastShutdown), 'Fast crash shutdown is not a cold-backup source');
  for (const key of ['innodbDataHomeDir', 'innodbLogHomeDir', 'innodbUndoDir']) {
    assert.ok([null, '', '.', './', state.datadir, state.datadir.slice(0, -1)].includes(state[key]),
      'External InnoDB storage is outside this backup contract');
  }
  assert.match(state.innodbDataFilePath, /^ibdata[0-9]+:[0-9]+[KMG](?::autoextend(?::max:[0-9]+[KMG])?)?$/);
  assert.ok([0, 1].includes(state.logBin));
  if (state.logBin === 0) assert.ok(state.logBinBase === null || state.logBinBase === '');
  else assert.ok(typeof state.logBinBase === 'string' && state.logBinBase.startsWith(state.datadir)
    && !state.logBinBase.split('/').includes('..'), 'External binary logs are outside this backup contract');
  assert.ok(Array.isArray(state.innodbDataFiles) && state.innodbDataFiles.length > 0);
  assert.deepEqual(state.innodbDataFiles, [...new Set(state.innodbDataFiles)].sort());
  for (const path of state.innodbDataFiles) {
    assert.equal(typeof path, 'string');
    assert.ok(!path.includes('\\') && !path.split('/').includes('..'));
    assert.ok(path.startsWith(state.datadir) || (!path.startsWith('/') && /^[a-zA-Z0-9_./@#$-]+$/.test(path)),
      'An actual InnoDB tablespace points outside the backed-up data directory');
  }
}

export function mysqlColdArchiveHelperArgs(resources, sequence, stage, mode) {
  assert.equal(resources.databaseProfile?.name, OWNED_VOLUME_PROFILE);
  const profile = mysqlFixtureProfile(OWNED_VOLUME_PROFILE);
  assert.equal(resources.mysqlImage, profile.imageId);
  validateOwnedMysqlVolumeDescriptor(resources.databaseStorage);
  assert.equal(resources.databaseStorage.runId, resources.runId);
  assert.ok([1, 2].includes(sequence));
  assert.ok(['backup', 'restore', 'restored'].includes(stage));
  assert.equal(mode, stage === 'restore' ? 'extract' : 'archive');
  const storage = resources.databaseStorage;
  const name = `nf-${resources.runId}-cold-${sequence}-${stage}-${storage.nonce.slice(0, 8)}`;
  const script = mode === 'archive'
    ? 'exec tar --sort=name --format=ustar --numeric-owner --directory=/owned --create --gzip --file=- .'
    : 'test -z "$(ls -A /owned)" && exec tar --directory=/owned --extract --gzip --file=- --no-same-owner --same-permissions --keep-old-files';
  return ['create', '--interactive', '--pull=never', '--name', name, '--network', 'none',
    '--label', `${ownerKey}=${resources.runId}`, '--read-only', '--user', profile.user,
    '--cap-drop=ALL', '--security-opt=no-new-privileges', '--mount',
    `type=volume,src=${storage.name},dst=/owned,volume-nocopy${mode === 'archive' ? ',readonly' : ''}`,
    '--entrypoint', '/bin/bash', profile.imageId, '-ec', script];
}

export function verifyMysqlColdArchiveHelper(resources, args, container) {
  assert.match(container.Id, idPattern);
  assert.equal(container.Name, `/${args[args.indexOf('--name') + 1]}`);
  assert.equal(container.Image, resources.mysqlImage);
  assert.equal(container.Config.Labels?.[ownerKey], resources.runId);
  assert.equal(container.Config.User, '1001:1001');
  assert.deepEqual(container.Config.Entrypoint, ['/bin/bash']);
  assert.deepEqual(container.Config.Cmd, args.slice(-2));
  assert.equal(container.HostConfig.NetworkMode, 'none');
  assert.equal(container.HostConfig.ReadonlyRootfs, true);
  assert.equal(container.HostConfig.Privileged, false);
  assert.ok(!container.HostConfig.CapAdd?.length);
  assert.deepEqual(container.HostConfig.CapDrop, ['ALL']);
  assert.ok(!container.HostConfig.Binds?.length && !container.HostConfig.VolumesFrom?.length);
  assert.ok(!Object.values(container.HostConfig.PortBindings ?? {}).some(value => value?.length));
  const readOnly = args[args.indexOf('--mount') + 1].endsWith(',readonly');
  assert.deepEqual(container.HostConfig.Mounts, [{
    Type: 'volume', Source: resources.databaseStorage.name, Target: '/owned',
    ...(readOnly ? { ReadOnly: true } : {}), VolumeOptions: { NoCopy: true },
  }]);
  assert.equal(container.Mounts.length, 1);
  const mount = container.Mounts[0];
  assert.equal(mount.Type, 'volume');
  assert.equal(mount.Name, resources.databaseStorage.name);
  assert.equal(mount.Source, resources.databaseStorage.mountpoint);
  assert.equal(mount.Destination, '/owned');
  assert.equal(mount.Driver, 'local');
  assert.equal(mount.RW, !readOnly);
}

function transferArchive({ resources, sequence, stage, archive, directory, write, execute }) {
  const extracting = stage === 'restore';
  const args = mysqlColdArchiveHelperArgs(resources, sequence, stage, extracting ? 'extract' : 'archive');
  const id = docker(args, execute).stdout.trim();
  assert.match(id, idPattern);
  const inspect = () => JSON.parse(docker(['inspect', id], execute).stdout)[0];
  const verify = () => {
    const container = inspect();
    verifyMysqlColdArchiveHelper(resources, args, container);
    inspectMysqlFixtureVolumes(resources, {
      execute, expectedRefs: [...(resources.mysqlId ? [resources.mysqlId] : []), id],
    });
    return container;
  };
  write(`${stage}-helper-created.json`, { id, name: args[args.indexOf('--name') + 1], image: resources.mysqlImage });
  const directories = new PinnedDirectories();
  let fd;
  try {
    verify();
    let result;
    if (extracting) {
      result = execute('docker', ['start', '--attach', '--interactive', id], {
        input: archive, encoding: 'utf8', timeout: 180_000, maxBuffer: 1024 * 1024,
      });
    } else {
      const target = directories.open(directory);
      fd = openSync(directories.entry(target, `${stage}.private.tgz`),
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      result = execute('docker', ['start', '--attach', id], {
        stdio: ['ignore', fd, 'pipe'], encoding: 'utf8', timeout: 180_000, maxBuffer: 1024 * 1024,
      });
      fsyncSync(fd);
      closeSync(fd);
      fd = undefined;
    }
    assert.ok(!result.error && !result.signal && result.status === 0,
      'Owned archive transfer failed; private content suppressed');
    const completed = verify();
    assert.equal(completed.State.Running, false);
    assert.equal(completed.State.ExitCode, 0);
  } finally {
    if (fd !== undefined) closeSync(fd);
    directories.close();
    verify();
    docker(['rm', '--force', id], execute);
    const absent = docker(['container', 'inspect', id], execute, true);
    assert.equal(absent.status, 1);
    assert.equal(absent.stderr.trim(), `Error response from daemon: No such container: ${id}`);
    write(`${stage}-helper-removed.json`, { id, absent: true });
  }
}

export function readOwnedMysqlColdArchive({ workspace, directory, stage, runId, execute = spawnSync }) {
  assert.ok(['backup', 'restored'].includes(stage));
  const directories = new PinnedDirectories();
  try {
    const file = readPinnedFile(directories, directories.open(directory), `${stage}.private.tgz`);
    assert.equal(file.identity.uid, process.geteuid());
    assert.equal(file.identity.mode & 0o077, 0);
    const manifest = inspectMysqlColdArchive(runId, file.data, execute);
    return { bytes: file.data, manifest, binding: {
      path: relative(workspace, join(directory, `${stage}.private.tgz`)),
      bytes: file.data.length, sha256: hash(file.data),
    } };
  } finally { directories.close(); }
}

export function restoreOwnedMysqlColdBackup({
  workspace, directory, manifest, resources, context, sequence, previous = null, guard, write, onCurrent,
  execute = spawnSync,
}) {
  assert.ok([1, 2].includes(sequence));
  assert.equal(typeof guard, 'function');
  assert.equal(typeof write, 'function');
  assert.equal(typeof onCurrent, 'function');
  guard();
  const original = structuredClone(resources);
  assert.equal(original.databaseProfile?.name, OWNED_VOLUME_PROFILE);
  const profile = mysqlFixtureProfile(OWNED_VOLUME_PROFILE);
  const inspect = id => JSON.parse(docker(['inspect', id], execute).stdout)[0];
  const before = inspect(original.mysqlId);
  assert.equal(before.State.Running, true);
  verifySelectedMysqlStorage(original.databaseProfile, before, {
    storage: original.databaseStorage, volumes: inspectMysqlFixtureVolumes(original, { execute }),
  });
  const stateBefore = ownedMysqlColdState(original, execute);
  const targetPlan = ownedMysqlVolumePlan(original.runId);
  assert.notEqual(targetPlan.nonce, original.databaseStorage.nonce);
  const createRequest = mysqlRecreationCreateRequest(manifest, original, before);
  const transport = recreationTransport(execute);
  const intent = write('intent.private.json', {
    contract: 'owned-mysql-cold-restore-intent-v1', runId: original.runId, sequence, generator: generator(),
    context, previous, resourcesBefore: original, targetPlan, createRequest, transport, before, stateBefore,
  });
  guard();
  const slow = execute('docker', ['exec', '-i', original.mysqlId, 'sh', '-c',
    `MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec ${profile.client} -h127.0.0.1 --protocol=TCP -uroot --batch --raw --skip-column-names`], {
    input: 'SET GLOBAL innodb_fast_shutdown=0; SELECT @@innodb_fast_shutdown;',
    encoding: 'utf8', timeout: 60_000, maxBuffer: 1024 * 1024,
  });
  assert.ok(!slow.error && !slow.signal && slow.status === 0 && slow.stdout.trim() === '0',
    'A verified slow InnoDB shutdown is required before cold backup');
  docker(['stop', '--time', '120', original.mysqlId], execute);
  const stopped = inspect(original.mysqlId);
  assert.equal(stopped.State.Running, false);
  assert.equal(stopped.State.ExitCode, 0);
  assert.equal(stopped.State.OOMKilled, false);
  assert.deepEqual(mysqlRecreationWitness(stopped), mysqlRecreationWitness(before));
  write('stopped.json', { contract: 'owned-mysql-cold-restore-stopped-v1', intent, mysqlId: original.mysqlId, exitCode: 0 });
  transferArchive({ resources: original, sequence, stage: 'backup', directory, write, execute });
  const backup = readOwnedMysqlColdArchive({ workspace, directory, stage: 'backup', runId: original.runId, execute });
  const sourceManifest = write('backup-manifest.private.json', backup.manifest);
  const backupBinding = write('backup.json', {
    contract: 'owned-mysql-cold-restore-backup-v1', intent, archive: backup.binding, manifest: sourceManifest,
  });
  // Only the independently parsed, complete archive permits destruction of the source data volume.
  inspectMysqlFixtureVolumes(original, { execute });
  assert.deepEqual(mysqlRecreationWitness(inspect(original.mysqlId)), mysqlRecreationWitness(stopped));
  docker(['rm', original.mysqlId], execute);
  const absent = docker(['container', 'inspect', original.mysqlId], execute, true);
  assert.equal(absent.status, 1);
  assert.equal(absent.stderr.trim(), `Error response from daemon: No such container: ${original.mysqlId}`);
  write('removed.json', { contract: 'owned-mysql-cold-restore-removed-v1', intent, backup: backupBinding,
    mysqlId: original.mysqlId, absent: true });
  onCurrent({ ...original, mysqlId: null });
  removeOwnedMysqlVolume(original, execute);
  const removedVolume = write('source-volume-removed.json', {
    contract: 'owned-mysql-cold-restore-volume-removed-v1', intent, storage: original.databaseStorage, absent: true,
  });
  onCurrent({ ...original, mysqlId: null, databaseStorage: null });
  const storage = createOwnedMysqlVolume(targetPlan, execute);
  assert.notEqual(storage.createdAt, original.databaseStorage.createdAt);
  const target = { ...original, mysqlId: null, databaseStorage: storage };
  const targetVolume = write('target-volume-created.json', {
    contract: 'owned-mysql-cold-restore-target-volume-v1', intent, sourceVolumeRemoved: removedVolume, storage,
  });
  onCurrent(target);
  initializeOwnedMysqlVolume(target, profile, {
    execute, journal: row => write(`target-init-helper-${row.status}.json`, row),
  });
  const currentBackup = readOwnedMysqlColdArchive({ workspace, directory, stage: 'backup', runId: original.runId, execute });
  assert.deepEqual(currentBackup.binding, backup.binding, 'The source archive changed before restoration');
  transferArchive({ resources: target, sequence, stage: 'restore', archive: currentBackup.bytes, directory, write, execute });
  transferArchive({ resources: target, sequence, stage: 'restored', directory, write, execute });
  const restored = readOwnedMysqlColdArchive({ workspace, directory, stage: 'restored', runId: original.runId, execute });
  assert.deepEqual(restored.manifest.entries, backup.manifest.entries,
    'Every restored physical file, byte hash, ownership and mode must equal the cold backup');
  const targetManifest = write('restored-manifest.private.json', restored.manifest);
  const restoredBinding = write('restored.json', {
    contract: 'owned-mysql-cold-restore-files-verified-v1', intent, targetVolume, backup: backupBinding,
    archive: restored.binding, sourceManifest, targetManifest, everyPhysicalFileEqual: true,
  });
  const response = createExactContainer(createRequest, transport, execute);
  const next = { ...target, mysqlId: response.Id };
  const created = inspect(next.mysqlId);
  const createdBinding = write('created.json', {
    contract: 'owned-mysql-cold-restore-created-v1', intent, restored: restoredBinding,
    resourcesAfter: next, witness: mysqlRecreationWitness(created), warnings: response.Warnings ?? [],
  });
  onCurrent(next);
  assert.deepEqual(response.Warnings ?? [], []);
  assert.deepEqual(mysqlRecreationWitness(created), mysqlRecreationCreatedWitness(before, next.mysqlId));
  inspectMysqlFixtureVolumes(next, { execute });
  docker(['start', next.mysqlId], execute);
  const after = inspect(next.mysqlId);
  verifyMysqlRecreationContainer(before, after, next);
  verifySelectedMysqlStorage(next.databaseProfile, after, {
    storage, volumes: inspectMysqlFixtureVolumes(next, { execute }),
  });
  guard();
  return { intent, created: createdBinding, resources: next, stateBefore,
    files: backup.manifest.entries.length, expandedBytes: backup.manifest.expandedBytes,
    sourceManifest, targetManifest, backup: backup.binding, restored: restoredBinding };
}

export function verifyMysqlColdRestoreRecords(resources, records, context) {
  assert.ok(Array.isArray(records) && records.length >= 1 && records.length <= 2);
  let current = structuredClone(resources);
  let previous = null;
  let witness;
  let createdWitness;
  const removedIds = [];
  const removedVolumes = [];
  for (const [index, row] of records.entries()) {
    const { intent, stopped, backup, removed, sourceVolumeRemoved, targetVolume, restored, created, verified, bindings } = row;
    assert.equal(intent.contract, 'owned-mysql-cold-restore-intent-v1');
    assert.equal(intent.runId, resources.runId);
    assert.equal(intent.sequence, index + 1);
    assert.deepEqual(intent.generator, generator());
    assert.deepEqual(intent.context, context);
    assert.deepEqual(intent.previous, previous);
    assert.deepEqual(intent.resourcesBefore, current);
    assert.deepEqual(intent.targetPlan, ownedMysqlVolumePlan(resources.runId, intent.targetPlan.nonce));
    assert.notEqual(intent.targetPlan.nonce, current.databaseStorage.nonce);
    verifyOwnedMysqlColdState(intent.stateBefore);
    assert.match(intent.transport.socket, /^\/[a-zA-Z0-9_./-]+$/);
    assert.match(intent.transport.version, /^1\.[0-9]+$/);
    assert.deepEqual(intent.createRequest, mysqlRecreationCreateRequest({
      runId: resources.runId, ownership: { mysqlContainer: resources.mysqlName, network: resources.networkName },
    }, current, intent.before));
    witness = mysqlRecreationWitness(intent.before);
    createdWitness = witness;
    const original = structuredClone(current);
    const stage = (value, contract) => {
      assert.equal(value.contract, contract);
      assert.deepEqual(value.intent, bindings.intent);
    };
    const helper = name => {
      const made = row[`${name}HelperCreated`];
      const gone = row[`${name}HelperRemoved`];
      assert.match(made?.id, idPattern);
      assert.equal(gone?.id, made.id);
      assert.equal(gone.absent, true);
      const target = name === 'backup' ? original : { ...original, mysqlId: null, databaseStorage: targetVolume.storage };
      const args = mysqlColdArchiveHelperArgs(target, index + 1, name, name === 'restore' ? 'extract' : 'archive');
      assert.equal(made.name, args[args.indexOf('--name') + 1]);
      assert.equal(made.image, original.mysqlImage);
    };
    if (stopped) {
      stage(stopped, 'owned-mysql-cold-restore-stopped-v1');
      assert.equal(stopped.mysqlId, current.mysqlId);
      assert.equal(stopped.exitCode, 0);
    }
    if (backup) {
      assert.ok(stopped);
      helper('backup');
      stage(backup, 'owned-mysql-cold-restore-backup-v1');
      assert.deepEqual(backup.manifest, bindings.backupManifest);
      assert.equal(backup.archive.sha256, row.backupManifest.archiveSha256);
      assert.equal(backup.archive.bytes, row.backupManifest.archiveBytes);
    }
    if (removed) {
      assert.ok(backup);
      stage(removed, 'owned-mysql-cold-restore-removed-v1');
      assert.deepEqual(removed.backup, bindings.backup);
      assert.equal(removed.mysqlId, current.mysqlId);
      assert.equal(removed.absent, true);
      removedIds.push(current.mysqlId);
      current = { ...current, mysqlId: null };
    }
    if (sourceVolumeRemoved) {
      assert.ok(removed);
      stage(sourceVolumeRemoved, 'owned-mysql-cold-restore-volume-removed-v1');
      assert.deepEqual(sourceVolumeRemoved.storage, current.databaseStorage);
      assert.equal(sourceVolumeRemoved.absent, true);
      removedVolumes.push(current.databaseStorage);
      current = { ...current, databaseStorage: null };
    }
    if (targetVolume) {
      assert.ok(sourceVolumeRemoved);
      stage(targetVolume, 'owned-mysql-cold-restore-target-volume-v1');
      assert.deepEqual(targetVolume.sourceVolumeRemoved, bindings.sourceVolumeRemoved);
      const storage = targetVolume.storage;
      validateOwnedMysqlVolumeDescriptor(storage);
      const { createdAt, mountpoint, ...plan } = storage;
      assert.deepEqual(plan, intent.targetPlan);
      assert.notEqual(createdAt, original.databaseStorage.createdAt);
      assert.equal(mountpoint, original.databaseStorage.mountpoint);
      current = { ...current, databaseStorage: storage };
    }
    if (restored) {
      assert.ok(targetVolume && backup);
      stage(restored, 'owned-mysql-cold-restore-files-verified-v1');
      helper('restore');
      helper('restored');
      const init = row.targetInitHelperCreated;
      assert.equal(init?.name, `nf-${resources.runId}-mysql-volume-init-${current.databaseStorage.nonce.slice(0, 12)}`);
      assert.match(init.id, idPattern);
      assert.equal(init.imageId, resources.mysqlImage);
      assert.equal(init.status, 'created');
      assert.deepEqual(row.targetInitHelperRemoved, { ...init, status: 'removed' });
      assert.deepEqual(restored.targetVolume, bindings.targetVolume);
      assert.deepEqual(restored.backup, bindings.backup);
      assert.deepEqual(restored.sourceManifest, bindings.backupManifest);
      assert.deepEqual(restored.targetManifest, bindings.restoredManifest);
      assert.equal(restored.everyPhysicalFileEqual, true);
      assert.deepEqual(row.backupManifest.entries, row.restoredManifest.entries);
      assert.equal(restored.archive.sha256, row.restoredManifest.archiveSha256);
      assert.equal(restored.archive.bytes, row.restoredManifest.archiveBytes);
    }
    if (created) {
      assert.ok(restored);
      stage(created, 'owned-mysql-cold-restore-created-v1');
      assert.deepEqual(created.restored, bindings.restored);
      const next = created.resourcesAfter;
      assert.match(next.mysqlId, idPattern);
      assert.ok(!removedIds.includes(next.mysqlId));
      assert.deepEqual({ ...next, mysqlId: null }, current, 'Only the new container ID and journaled volume may change');
      assert.deepEqual(created.witness, mysqlRecreationCreatedWitness(intent.before, next.mysqlId));
      current = next;
      createdWitness = created.witness;
      witness = { ...mysqlRecreationWitness(intent.before), id: next.mysqlId };
    }
    if (verified) {
      assert.ok(created);
      assert.deepEqual(created.warnings, []);
      assert.equal(verified.contract, 'owned-mysql-cold-restore-verified-v1');
      assert.deepEqual(verified.created, bindings.created);
      assert.equal(verified.mysqlId, current.mysqlId);
      assert.equal(verified.everyPhysicalFileEqual, true);
      assert.equal(verified.completePhysicalRowsUnchanged, true);
      assert.deepEqual(verified.witness, witness);
      assert.deepEqual(verified.evidence, bindings.readback);
      assert.deepEqual(row.readback.stateBefore, intent.stateBefore);
      assert.deepEqual(row.readback.stateAfter, intent.stateBefore);
      assert.deepEqual(row.readback.before, row.readback.after);
      assert.deepEqual(row.readback.diskBefore, row.readback.diskAfter);
    }
    if (index < records.length - 1) assert.ok(verified, 'An incomplete restore must be the final journal entry');
    previous = bindings.created ?? bindings.intent;
  }
  return { resources: current, removedIds, removedVolumes, witness, createdWitness };
}

const journalNames = {
  'intent.private.json': 'intent', 'stopped.json': 'stopped', 'backup.json': 'backup',
  'backup-manifest.private.json': 'backupManifest', 'removed.json': 'removed',
  'source-volume-removed.json': 'sourceVolumeRemoved', 'target-volume-created.json': 'targetVolume',
  'restored-manifest.private.json': 'restoredManifest', 'restored.json': 'restored',
  'created.json': 'created', 'verified.json': 'verified', 'readback.private.json': 'readback',
  ...Object.fromEntries(['backup', 'restore', 'restored'].flatMap(stage => ['created', 'removed'].map(status => [
    `${stage}-helper-${status}.json`, `${stage}Helper${status === 'created' ? 'Created' : 'Removed'}`,
  ]))),
  'target-init-helper-created.json': 'targetInitHelperCreated',
  'target-init-helper-removed.json': 'targetInitHelperRemoved',
};

export function loadMysqlColdRestoreJournal({ workspace, base, journalPath, resources, context }) {
  const path = resolve(workspace, journalPath);
  assert.equal(dirname(dirname(path)), base);
  assert.match(basename(dirname(path)), /^native-http-[a-z0-9][a-z0-9-]{0,63}$/);
  assert.equal(basename(path), 'mysql-backup-restores');
  const directories = new PinnedDirectories();
  try {
    const root = directories.open(path);
    assert.equal(root.identity.mode & 0o077, 0);
    const entries = readdirSync(root.access).sort();
    assert.ok(entries.length >= 1 && entries.length <= 2);
    assert.deepEqual(entries, entries.map((value, index) => `step-${String(index + 1).padStart(4, '0')}`));
    const records = entries.map(entry => {
      const directory = directories.open(join(path, entry));
      assert.equal(directory.identity.mode & 0o077, 0);
      const names = readdirSync(directory.access);
      assert.ok(names.includes('intent.private.json'));
      assert.ok(names.every(name => Object.hasOwn(journalNames, name) || ['backup.private.tgz', 'restored.private.tgz'].includes(name)));
      const row = { bindings: {} };
      for (const name of names.filter(name => Object.hasOwn(journalNames, name))) {
        const file = readPinnedFile(directories, directory, name);
        assert.equal(file.identity.uid, process.geteuid());
        assert.equal(file.identity.mode & 0o077, 0);
        const key = journalNames[name];
        row[key] = JSON.parse(file.data);
        row.bindings[key] = { path: relative(workspace, join(path, entry, name)),
          bytes: file.data.length, sha256: hash(file.data) };
      }
      for (const stage of ['backup', 'restored']) {
        const receipt = row[stage === 'backup' ? 'backup' : 'restored'];
        if (!receipt) continue;
        const observed = readOwnedMysqlColdArchive({ workspace, directory: directory.path, stage, runId: resources.runId });
        assert.deepEqual(observed.binding, receipt.archive);
        assert.deepEqual(observed.manifest, row[stage === 'backup' ? 'backupManifest' : 'restoredManifest']);
        row.bindings[`${stage}Archive`] = observed.binding;
      }
      return row;
    });
    return { ...verifyMysqlColdRestoreRecords(resources, records, context), records: records.map(row => row.bindings) };
  } finally { directories.close(); }
}
