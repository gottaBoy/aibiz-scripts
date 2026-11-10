import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { PinnedDirectories, readPinnedFile } from './native-candidate-files.mjs';
import { createHash } from 'node:crypto';
import { verifySelectedMysqlStorage } from './mysql-fixture-profiles.mjs';
import { OWNED_VOLUME_PROFILE, inspectMysqlFixtureVolumes, removeOwnedMysqlVolume } from './owned-mysql-volume.mjs';
import { loadMysqlRecreationJournal, mysqlRecreationWitness } from './owned-mysql-recreation.mjs';
import { loadMysqlColdRestoreJournal } from './owned-mysql-backup-restore.mjs';

export function verifyRetirementPeers(runId, resources, deployment, containers, network, {
  storageMode = 'tmpfs', volumes = [], missingMysql = false, stoppedMysql = false, missingVolume = false,
} = {}) {
  assert.match(runId, /^[a-f0-9]{12}$/);
  assert.equal(resources.runId, runId);
  assert.equal(deployment.runId, runId);
  assert.equal(network.Id, resources.networkId);
  assert.equal(network.Name, `nf-${runId}-private`);
  assert.equal(network.Internal, true);
  assert.equal(network.Labels?.['aibiz.native-fixture.run'], runId);
  assert.ok(['tmpfs', 'owned-volume'].includes(storageMode));
  if (missingVolume) assert.equal(storageMode, 'owned-volume');
  if (storageMode === 'owned-volume') {
    assert.equal(resources.databaseProfile?.name, OWNED_VOLUME_PROFILE);
    if (missingVolume) {
      assert.equal(missingMysql, true);
      assert.equal(resources.databaseStorage, null);
      assert.equal(volumes.length, 0);
    } else assert.equal(resources.databaseStorage?.runId, runId);
  } else {
    assert.equal(resources.databaseStorage, undefined, 'Tmpfs disposal must not delete persistent databases');
    assert.equal(volumes.length, 0);
  }
  const peers = [
    ...(!missingMysql ? [{ role: 'mysql', containerId: resources.mysqlId, imageId: resources.mysqlImage }] : []),
    ...Object.entries(deployment.services).map(([role, value]) => ({ role, ...value })),
    ...deployment.auxiliaryContainers,
  ];
  if (missingMysql || stoppedMysql) assert.equal(storageMode, 'owned-volume');
  if (missingMysql) assert.equal(resources.mysqlId, null);
  assert.deepEqual(peers.map(row => row.role).sort(),
    ['allinone', 'gateway', ...(!missingMysql ? ['mysql'] : []), 'nacos', 'provider', 'redis', 'uaa', 'zookeeper']);
  assert.equal(new Set(peers.map(row => row.containerId)).size, missingMysql ? 7 : 8);
  assert.deepEqual(Object.keys(network.Containers).sort(),
    peers.filter(row => !(stoppedMysql && row.role === 'mysql')).map(row => row.containerId).sort());
  assert.equal(containers.length, peers.length);
  for (const peer of peers) {
    assert.match(peer.containerId, /^[a-f0-9]{64}$/);
    assert.match(peer.imageId, /^sha256:[a-f0-9]{64}$/);
    const container = containers.find(row => row.Id === peer.containerId);
    assert.ok(container);
    assert.equal(container.Image, peer.imageId);
    assert.equal(container.Config.Labels?.['aibiz.native-fixture.run'], runId);
    assert.ok(container.Name.startsWith(`/nf-${runId}-`));
    if (stoppedMysql && peer.role === 'mysql') {
      assert.equal(container.State.Running, false);
      assert.equal(container.HostConfig.NetworkMode, network.Name);
      assert.ok(Object.keys(container.NetworkSettings.Networks).every(name => name === network.Name));
      assert.ok(!network.Containers[peer.containerId]);
    } else {
      assert.deepEqual(Object.keys(container.NetworkSettings.Networks), [network.Name]);
      assert.equal(container.NetworkSettings.Networks[network.Name].NetworkID, resources.networkId);
    }
    assert.equal(container.HostConfig.Privileged, false);
    if (peer.role === 'mysql') {
      assert.equal(container.Name, `/nf-${runId}-mysql`);
      if (storageMode === 'tmpfs') {
        assert.ok(container.Mounts.every(row => row.Type === 'tmpfs'),
          'This retirement path is only for disposable tmpfs databases');
      } else verifySelectedMysqlStorage(resources.databaseProfile, container, {
        storage: resources.databaseStorage, volumes,
      });
    }
  }
  return peers;
}

export function retireOwnedNativeFixture({
  runId, deploymentInput, label, storageMode = 'tmpfs', recreationJournal, workspace = resolve('.'),
  backupRestoreJournal,
}) {
  assert.ok(recreationJournal === undefined || backupRestoreJournal === undefined,
    'Select only one explicit MySQL transition journal');
  assert.match(runId, /^[a-f0-9]{12}$/);
  assert.match(label, /^[a-z0-9][a-z0-9-]{0,48}$/);
  workspace = resolve(workspace);
  const base = join(workspace, '.artifacts/native-nonadmin-fixtures', runId);
  const input = resolve(workspace, deploymentInput);
  assert.equal(dirname(dirname(input)), base);
  assert.match(basename(dirname(input)), /^backend-runtime-[a-z0-9-]+$/);
  assert.equal(basename(input), 'deployment-input.private.json');
  const directories = new PinnedDirectories();
  const read = path => readPinnedFile(directories, directories.open(dirname(path)), basename(path)).data;
  const docker = (args, allowFailure = false) => {
    const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024 });
    assert.ok(!result.error && !result.signal);
    if (!allowFailure) assert.equal(result.status, 0, 'Owned retirement command failed; output suppressed');
    return result;
  };
  const output = join(base, `retirement-${label}`);
  const target = directories.open(output, { create: true, exclusive: true });
  const report = { runId, status: 'failed', storageMode, removed: [], nativeAcceptance: false,
    reason: 'Explicit disposal of a journal-bound fixture, including its databases and principals; not authorization acceptance.' };
  try {
    const resourcesBytes = read(join(base, 'owned-resources.json'));
    let resources = JSON.parse(resourcesBytes);
    const sqlBytes = read(join(base, 'isolated-sql-report.json'));
    const sql = JSON.parse(sqlBytes);
    resources.mysqlImage ??= sql.mysqlImage;
    assert.equal(resources.mysqlId, sql.ownedMysqlId);
    assert.equal(resources.networkId, sql.ownedNetworkId);
    const deploymentBytes = read(input);
    const deployment = JSON.parse(deploymentBytes);
    let missingMysql = false;
    let stoppedMysql = false;
    let missingVolume = false;
    if (recreationJournal !== undefined || backupRestoreJournal !== undefined) {
      assert.equal(storageMode, 'owned-volume', 'Recreation disposal requires explicit persistent storage mode');
      const digest = bytes => createHash('sha256').update(bytes).digest('hex');
      assert.equal(digest(resourcesBytes), sql.outputs['owned-resources.json'].sha256);
      const loader = backupRestoreJournal === undefined ? loadMysqlRecreationJournal : loadMysqlColdRestoreJournal;
      const resolved = loader({
        workspace, base, journalPath: backupRestoreJournal ?? recreationJournal, resources,
        context: { manifestSha256: digest(read(join(base, 'manifest.json'))), sqlSha256: digest(sqlBytes),
          resourcesSha256: digest(resourcesBytes), deploymentSha256: digest(deploymentBytes) },
      });
      for (const id of resolved.removedIds) {
        const absent = docker(['container', 'inspect', id], true);
        assert.equal(absent.status, 1);
        assert.equal(absent.stderr.trim(), `Error response from daemon: No such container: ${id}`);
      }
      resources = resolved.resources;
      missingVolume = resources.databaseStorage === null;
      missingMysql = resources.mysqlId === null;
      if (!missingMysql) {
        const current = JSON.parse(docker(['inspect', resources.mysqlId]).stdout)[0];
        const started = current.State.StartedAt && !current.State.StartedAt.startsWith('0001-');
        assert.deepEqual(mysqlRecreationWitness(current), started ? resolved.witness : resolved.createdWitness);
        stoppedMysql = current.State.Running === false;
      }
      if (backupRestoreJournal !== undefined) {
        report.backupRestoreJournal = resolved.records;
        report.retiredMysqlStorageIdentities = resolved.removedVolumes;
      } else report.recreationJournal = resolved.records;
      report.retiredMysqlIdsAlreadyAbsent = resolved.removedIds;
      report.missingMysqlAfterJournaledRemoval = missingMysql;
      if (missingVolume) {
        const name = `nf-${runId}-mysql-data`;
        const absent = docker(['volume', 'inspect', name], true);
        assert.equal(absent.status, 1);
        assert.equal(absent.stderr.trim(), `Error response from daemon: get ${name}: no such volume`);
        report.missingMysqlVolumeAfterJournaledRemoval = true;
      }
    }
    const ids = [...(!missingMysql ? [resources.mysqlId] : []), ...Object.values(deployment.services).map(row => row.containerId),
      ...deployment.auxiliaryContainers.map(row => row.containerId)];
    const network = JSON.parse(docker(['network', 'inspect', resources.networkId]).stdout)[0];
    const containers = JSON.parse(docker(['inspect', ...ids]).stdout);
    const peers = verifyRetirementPeers(runId, resources, deployment, containers, network, {
      storageMode, missingMysql, stoppedMysql, missingVolume,
      volumes: missingVolume ? [] : inspectMysqlFixtureVolumes(resources, { expectedRefs: missingMysql ? [] : [resources.mysqlId] }),
    });
    report.deploymentSha256 = createHash('sha256').update(deploymentBytes).digest('hex');
    report.peers = peers.map(peer => ({ ...peer, name: containers.find(row => row.Id === peer.containerId).Name }));
    directories.write(target, 'ownership-before.private.json', `${JSON.stringify({ network, containers })}\n`);
    // Service peers go first. MySQL is disposed only after it is the only network member.
    for (const peer of [...peers.filter(row => row.role !== 'mysql'), ...peers.filter(row => row.role === 'mysql')]) {
      const current = JSON.parse(docker(['inspect', peer.containerId]).stdout)[0];
      assert.equal(current.Image, peer.imageId);
      assert.equal(current.Name, containers.find(row => row.Id === peer.containerId).Name);
      assert.equal(current.Config.Labels?.['aibiz.native-fixture.run'], runId);
      if (peer.role === 'mysql') {
        const remaining = JSON.parse(docker(['network', 'inspect', resources.networkId]).stdout)[0];
        assert.deepEqual(Object.keys(remaining.Containers), stoppedMysql ? [] : [resources.mysqlId]);
        if (storageMode === 'owned-volume') verifySelectedMysqlStorage(resources.databaseProfile, current, {
          storage: resources.databaseStorage, volumes: inspectMysqlFixtureVolumes(resources),
        });
        else assert.ok(current.Mounts.every(row => row.Type === 'tmpfs'));
      } else {
        const logs = docker(['logs', '--tail', '2000', peer.containerId], true);
        directories.write(target, `${peer.role}.private.log`, `${logs.stdout ?? ''}${logs.stderr ?? ''}`);
      }
      docker(['rm', '--force', peer.containerId]);
      const absent = docker(['container', 'inspect', peer.containerId], true);
      assert.equal(absent.status, 1);
      assert.equal(absent.stderr.trim(), `Error response from daemon: No such container: ${peer.containerId}`);
      report.removed.push(peer);
    }
    docker(['network', 'rm', resources.networkId]);
    const absent = docker(['network', 'inspect', resources.networkId], true);
    assert.equal(absent.status, 1);
    assert.equal(absent.stderr.trim(), `Error response from daemon: network ${resources.networkId} not found`);
    report.networkRemoved = resources.networkId;
    if (storageMode === 'owned-volume' && !missingVolume) report.volumeRemoved = removeOwnedMysqlVolume(resources);
    report.status = storageMode === 'owned-volume' ? 'passed-owned-volume-retirement' : 'passed-owned-tmpfs-retirement';
  } finally {
    directories.write(target, 'report.json', `${JSON.stringify(report, null, 2)}\n`);
    directories.close();
  }
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: {
    'retire-owned-tmpfs': { type: 'boolean' }, 'run-id': { type: 'string' },
    'retire-owned-volume': { type: 'boolean' },
    'deployment-input': { type: 'string' }, label: { type: 'string' },
    'mysql-recreation-journal': { type: 'string' },
    'mysql-backup-restore-journal': { type: 'string' },
  } });
  assert.equal(Number(values['retire-owned-tmpfs'] === true) + Number(values['retire-owned-volume'] === true), 1,
    'Select exactly one explicit storage disposal mode');
  const report = retireOwnedNativeFixture({
    runId: values['run-id'], deploymentInput: values['deployment-input'], label: values.label,
    storageMode: values['retire-owned-volume'] ? 'owned-volume' : 'tmpfs',
    recreationJournal: values['mysql-recreation-journal'],
    backupRestoreJournal: values['mysql-backup-restore-journal'],
  });
  console.log(JSON.stringify({ runId: report.runId, status: report.status, removed: report.removed.length }));
}
