import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { isAbsolute } from 'node:path';

export const OWNED_VOLUME_PROFILE = 'mysql57-bitnami-arm64-owned-volume';
const ownerKey = 'aibiz.native-fixture.run';
const nonceKey = 'aibiz.native-fixture.volume-nonce';
const idPattern = /^[a-f0-9]{64}$/;

function docker(args, execute = spawnSync, allowFailure = false) {
  const result = execute('docker', args, {
    encoding: 'utf8', timeout: 90_000, maxBuffer: 4 * 1024 * 1024,
  });
  assert.ok(!result.error && !result.signal, 'Owned volume command did not complete');
  if (!allowFailure) assert.equal(result.status, 0, 'Owned volume command failed; output suppressed');
  return result;
}

export function ownedMysqlVolumePlan(runId, nonce = randomBytes(16).toString('hex')) {
  assert.match(runId, /^[a-f0-9]{12}$/);
  assert.match(nonce, /^[a-f0-9]{32}$/);
  return { contract: 'owned-mysql-volume-v1', runId, name: `nf-${runId}-mysql-data`, nonce };
}

export function validateOwnedMysqlVolumeDescriptor(storage) {
  assert.ok(storage && typeof storage === 'object', 'Explicit owned volume identity required');
  const { createdAt, mountpoint, ...plan } = storage;
  assert.deepEqual(plan, ownedMysqlVolumePlan(storage.runId, storage.nonce));
  assert.equal(typeof createdAt, 'string');
  assert.ok(Number.isFinite(Date.parse(createdAt)), 'Volume creation timestamp required');
  assert.equal(typeof mountpoint, 'string');
  assert.ok(isAbsolute(mountpoint) && mountpoint.endsWith(`/volumes/${storage.name}/_data`),
    'Expected the inspected local Docker volume data directory');
  return true;
}

export function verifyOwnedMysqlVolume(storage, volume) {
  validateOwnedMysqlVolumeDescriptor(storage);
  assert.equal(volume?.Name, storage.name);
  assert.equal(volume.Driver, 'local');
  assert.equal(volume.Scope, 'local');
  assert.deepEqual(volume.Options ?? {}, {}, 'Device, bind and network volume options are forbidden');
  assert.deepEqual(volume.Labels, { [ownerKey]: storage.runId, [nonceKey]: storage.nonce });
  assert.equal(volume.CreatedAt, storage.createdAt, 'Volume was recreated after its ownership receipt');
  assert.equal(volume.Mountpoint, storage.mountpoint, 'Volume data directory changed');
  return true;
}

export function verifyOwnedMysqlVolumeReferences(actual, expected) {
  assert.ok(Array.isArray(actual) && Array.isArray(expected));
  for (const id of [...actual, ...expected]) assert.match(id, idPattern);
  assert.equal(new Set(actual).size, actual.length);
  assert.equal(new Set(expected).size, expected.length);
  assert.deepEqual([...actual].sort(), [...expected].sort(),
    'Owned MySQL volume has an undeclared or missing container reference (including stopped containers)');
}

export function verifyOwnedMysqlDiskBacking(storage, root, endpoint, filesystem) {
  validateOwnedMysqlVolumeDescriptor(storage);
  assert.equal(typeof endpoint.Host, 'string');
  assert.match(endpoint.Host, /^unix:\/\//, 'Disk evidence requires a local Docker Unix socket');
  assert.ok(isAbsolute(root) && storage.mountpoint === `${root}/volumes/${storage.name}/_data`);
  assert.ok(filesystem && isAbsolute(filesystem.target));
  assert.ok(storage.mountpoint === filesystem.target || filesystem.target === '/'
    || storage.mountpoint.startsWith(`${filesystem.target}/`));
  assert.ok(['ext4', 'xfs', 'btrfs'].includes(filesystem.fstype),
    'Disk restart evidence requires a reviewed block-backed filesystem, not tmpfs/overlay/network storage');
  assert.match(filesystem.source, /^\/dev\/[a-zA-Z0-9/_.-]+$/);
  return { dockerRoot: root, endpoint: endpoint.Host, ...filesystem };
}

export function selectOwnedMysqlFilesystem(mountpoint, filesystems) {
  assert.ok(isAbsolute(mountpoint) && Array.isArray(filesystems));
  const ancestors = filesystems.filter(row => typeof row.target === 'string'
    && (row.target === '/' || row.target === mountpoint || mountpoint.startsWith(`${row.target}/`)));
  assert.ok(ancestors.length > 0, 'Volume path must have an observed kernel filesystem');
  ancestors.sort((a, b) => b.target.length - a.target.length);
  assert.equal(ancestors.filter(row => row.target === ancestors[0].target).length, 1,
    'Ambiguous overmounted volume filesystem');
  return ancestors[0];
}

export function inspectOwnedMysqlDiskBacking(storage, execute = spawnSync) {
  validateOwnedMysqlVolumeDescriptor(storage);
  const endpoint = JSON.parse(docker(['context', 'inspect', '--format', '{{json .Endpoints.docker}}'], execute).stdout);
  assert.ok(!process.env.DOCKER_HOST || process.env.DOCKER_HOST === endpoint.Host,
    'Docker host override cannot substitute a remote daemon for local filesystem evidence');
  const root = docker(['info', '--format', '{{.DockerRootDir}}'], execute).stdout.trim();
  // Read the kernel mount table without traversing Docker's root-only data directories.
  const result = execute('findmnt', ['--json', '--list', '--all', '--output', 'TARGET,SOURCE,FSTYPE'], {
    encoding: 'utf8', timeout: 10_000, maxBuffer: 1024 * 1024,
  });
  assert.ok(!result.error && !result.signal && result.status === 0, 'Actual volume filesystem inspection required');
  const filesystems = JSON.parse(result.stdout).filesystems;
  return verifyOwnedMysqlDiskBacking(storage, root, endpoint, selectOwnedMysqlFilesystem(storage.mountpoint, filesystems));
}

export function inspectMysqlFixtureVolumes(resources, {
  execute = spawnSync, expectedRefs = [resources.mysqlId],
} = {}) {
  const persistent = resources.databaseProfile?.name === OWNED_VOLUME_PROFILE;
  if (!persistent) {
    assert.equal(resources.databaseStorage, undefined, 'Tmpfs journals must not declare persistent storage');
    return [];
  }
  const storage = resources.databaseStorage;
  validateOwnedMysqlVolumeDescriptor(storage);
  assert.equal(storage.runId, resources.runId);
  const volumes = JSON.parse(docker(['volume', 'inspect', storage.name], execute).stdout);
  assert.equal(volumes.length, 1);
  verifyOwnedMysqlVolume(storage, volumes[0]);
  const text = docker(['container', 'ls', '--all', '--no-trunc', '--quiet',
    '--filter', `volume=${storage.name}`], execute).stdout.trim();
  verifyOwnedMysqlVolumeReferences(text ? text.split('\n') : [], expectedRefs);
  return volumes;
}

export function createOwnedMysqlVolume(plan, execute = spawnSync) {
  assert.deepEqual(plan, ownedMysqlVolumePlan(plan.runId, plan.nonce));
  const absent = docker(['volume', 'inspect', plan.name], execute, true);
  assert.equal(absent.status, 1, 'Never adopt an existing volume');
  assert.equal(absent.stderr.trim(), `Error response from daemon: get ${plan.name}: no such volume`);
  const result = docker(['volume', 'create', '--driver', 'local',
    '--label', `${ownerKey}=${plan.runId}`, '--label', `${nonceKey}=${plan.nonce}`, plan.name], execute);
  assert.equal(result.stdout.trim(), plan.name);
  const volumes = JSON.parse(docker(['volume', 'inspect', plan.name], execute).stdout);
  assert.equal(volumes.length, 1);
  const storage = { ...plan, createdAt: volumes[0].CreatedAt, mountpoint: volumes[0].Mountpoint };
  verifyOwnedMysqlVolume(storage, volumes[0]);
  return storage;
}

export function initializeOwnedMysqlVolume(resources, profile, {
  execute = spawnSync, journal = () => {},
} = {}) {
  assert.equal(resources.databaseProfile.name, OWNED_VOLUME_PROFILE);
  assert.equal(resources.databaseProfile.imageId, profile.imageId);
  assert.equal(profile.user, '1001:1001');
  inspectMysqlFixtureVolumes(resources, { execute, expectedRefs: [] });
  const name = `nf-${resources.runId}-mysql-volume-init-${resources.databaseStorage.nonce.slice(0, 12)}`;
  const script = 'test -z "$(ls -A /owned)" && chmod 0750 /owned && chown 1001:1001 /owned';
  let id;
  try {
    id = docker(['create', '--pull=never', '--name', name, '--network', 'none',
      '--label', `${ownerKey}=${resources.runId}`, '--read-only', '--user', '0:0',
      '--cap-drop=ALL', '--cap-add=CHOWN', '--security-opt=no-new-privileges',
      '--mount', `type=volume,src=${resources.databaseStorage.name},dst=/owned,volume-nocopy`,
      '--entrypoint', '/bin/bash', profile.imageId, '-ec', script], execute).stdout.trim();
    assert.match(id, idPattern);
    journal({ id, name, imageId: profile.imageId, status: 'created' });
    const inspectHelper = () => {
      const container = JSON.parse(docker(['inspect', id], execute).stdout)[0];
      assert.equal(container.Id, id);
      assert.equal(container.Name, `/${name}`);
      assert.equal(container.Image, profile.imageId);
      assert.equal(container.Config.Labels?.[ownerKey], resources.runId);
      assert.equal(container.HostConfig.NetworkMode, 'none');
      assert.equal(container.HostConfig.ReadonlyRootfs, true);
      assert.equal(container.HostConfig.Privileged, false);
      assert.equal(container.Config.User, '0:0');
      assert.deepEqual(container.Config.Entrypoint, ['/bin/bash']);
      assert.deepEqual(container.HostConfig.CapAdd, ['CAP_CHOWN']);
      assert.deepEqual(container.HostConfig.CapDrop, ['ALL']);
      assert.deepEqual(container.HostConfig.Mounts, [{
        Type: 'volume', Source: resources.databaseStorage.name, Target: '/owned', VolumeOptions: { NoCopy: true },
      }]);
      assert.deepEqual(container.Config.Cmd, ['-ec', script]);
      const mount = container.Mounts;
      assert.equal(mount.length, 1);
      assert.equal(mount[0].Type, 'volume');
      assert.equal(mount[0].Name, resources.databaseStorage.name);
      assert.equal(mount[0].Destination, '/owned');
      assert.equal(mount[0].Source, resources.databaseStorage.mountpoint);
      assert.equal(mount[0].Driver, 'local');
      assert.equal(mount[0].RW, true);
      inspectMysqlFixtureVolumes(resources, { execute, expectedRefs: [id] });
      return container;
    };
    inspectHelper();
    docker(['start', '--attach', id], execute);
    const completed = inspectHelper();
    assert.equal(completed.State.Running, false);
    assert.equal(completed.State.ExitCode, 0, 'Fresh empty volume permission initialization failed');
  } finally {
    if (id) {
      const container = JSON.parse(docker(['inspect', id], execute).stdout)[0];
      assert.equal(container.Config.Labels?.[ownerKey], resources.runId);
      assert.equal(container.Image, profile.imageId);
      assert.equal(container.Name, `/${name}`);
      docker(['rm', '--force', id], execute);
      journal({ id, name, imageId: profile.imageId, status: 'removed' });
    }
  }
  inspectMysqlFixtureVolumes(resources, { execute, expectedRefs: [] });
}

export function removeOwnedMysqlVolume(resources, execute = spawnSync) {
  inspectMysqlFixtureVolumes(resources, { execute, expectedRefs: [] });
  const name = resources.databaseStorage.name;
  docker(['volume', 'rm', name], execute);
  const absent = docker(['volume', 'inspect', name], execute, true);
  assert.equal(absent.status, 1);
  assert.equal(absent.stderr.trim(), `Error response from daemon: get ${name}: no such volume`);
  return name;
}
