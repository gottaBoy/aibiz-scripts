import assert from 'node:assert/strict';
import { isIPv4 } from 'node:net';
import {
  OWNED_VOLUME_PROFILE, validateOwnedMysqlVolumeDescriptor, verifyOwnedMysqlVolume,
} from './owned-mysql-volume.mjs';

export const MYSQL_IMAGE_ID =
  'sha256:a086c6276f57c2b8067d0fda21893b7e3e542513cb5997b224cd0538d4970ece';
const reviewedProfiles = {
  'mysql57-amd64': Object.freeze({
    imageId: MYSQL_IMAGE_ID, architecture: 'amd64', versionPrefix: '5.7.26',
    client: 'mysql', user: '999:999',
    tmpfs: Object.freeze([
      '/var/lib/mysql:rw,nosuid,nodev,uid=999,gid=999,size=1073741824',
      '/var/run/mysqld:rw,nosuid,nodev,uid=999,gid=999,size=16777216',
      '/tmp:rw,nosuid,nodev,size=268435456',
    ]),
    args: Object.freeze([]),
    command: Object.freeze(['--lower-case-table-names=1', '--character-set-server=utf8mb4']),
  }),
  'mysql57-bitnami-arm64': Object.freeze({
    imageId: 'sha256:2e7e2b4ae4494b2bb9fe9d2ad4b6510790d714ba2e60af2f0df5aaca44f0c28f',
    architecture: 'arm64', versionPrefix: '5.7.41',
    client: '/opt/bitnami/mysql/bin/mysql', user: '1001:1001',
    tmpfs: Object.freeze([
      '/bitnami/mysql:rw,nosuid,nodev,uid=1001,gid=1001,mode=0750,size=1073741824',
      ...['conf', 'tmp', 'logs'].map(name =>
        `/opt/bitnami/mysql/${name}:rw,nosuid,nodev,uid=1001,gid=1001,mode=0750,size=${name === 'tmp' ? 134217728 : 16777216}`),
      '/tmp:rw,nosuid,nodev,uid=1001,gid=1001,size=268435456',
      '/docker-entrypoint-initdb.d:ro,nosuid,nodev,size=1048576',
      '/docker-entrypoint-startdb.d:ro,nosuid,nodev,size=1048576',
    ]),
    args: Object.freeze([
      '--env', 'MYSQL_CHARACTER_SET=utf8mb4',
      '--env', 'MYSQL_EXTRA_FLAGS=--lower-case-table-names=1',
      '--entrypoint', '/bin/bash',
    ]),
    command: Object.freeze(['-ec', [
      '. /opt/bitnami/scripts/libmysql.sh',
      '. /opt/bitnami/scripts/mysql-env.sh',
      'mysql_create_default_config',
      'exec /opt/bitnami/scripts/mysql/entrypoint.sh /opt/bitnami/scripts/mysql/run.sh',
    ].join('\n')]),
  }),
};
reviewedProfiles[OWNED_VOLUME_PROFILE] = Object.freeze({
  ...reviewedProfiles['mysql57-bitnami-arm64'],
  storagePath: '/bitnami/mysql',
  tmpfs: Object.freeze(reviewedProfiles['mysql57-bitnami-arm64'].tmpfs
    .filter(value => !value.startsWith('/bitnami/mysql:'))),
});
export const MYSQL_FIXTURE_PROFILES = Object.freeze(reviewedProfiles);

export function mysqlFixtureProfile(name = 'mysql57-amd64') {
  assert.ok(Object.hasOwn(MYSQL_FIXTURE_PROFILES, name), 'Unknown pinned MySQL fixture profile');
  return MYSQL_FIXTURE_PROFILES[name];
}

export function mysqlFixtureArgs(profile, password, storage) {
  assert.ok(Object.values(MYSQL_FIXTURE_PROFILES).includes(profile), 'Unreviewed MySQL fixture profile');
  assert.match(password, /^[a-f0-9]{32}$/, 'Use a fresh 32-character fixture root password');
  const mounts = [];
  if (profile.storagePath) {
    validateOwnedMysqlVolumeDescriptor(storage);
    mounts.push('--mount', `type=volume,src=${storage.name},dst=${profile.storagePath},volume-nocopy`);
  } else assert.equal(storage, undefined, 'Tmpfs profile must not adopt a persistent volume');
  return ['--user', profile.user, ...mounts, ...profile.tmpfs.flatMap(value => ['--tmpfs', value]),
    '--env', `MYSQL_ROOT_PASSWORD=${password}`, ...profile.args];
}

export function verifyMysqlFixtureState(profile, state) {
  assert.ok(Object.values(MYSQL_FIXTURE_PROFILES).includes(profile));
  assert.ok(typeof state.version === 'string' && (
    state.version === profile.versionPrefix || state.version.startsWith(`${profile.versionPrefix}-`)),
  'Fixture MySQL version differs from the reviewed profile');
  assert.equal(state.lowerCaseTableNames, 1);
  assert.equal(state.characterSet, 'utf8mb4');
}

export function mysqlFixtureReadyProcess(name) {
  return name === 'mysqld' || name === 'mysqld\n';
}

export function verifyMysqlFixtureStorage(profile, container, { storage, volumes = [] } = {}) {
  assert.ok(Object.values(MYSQL_FIXTURE_PROFILES).includes(profile));
  assert.equal(container.Image, profile.imageId);
  assert.equal(container.Config.User, profile.user);
  assert.equal(container.HostConfig.ReadonlyRootfs, true);
  const expected = Object.fromEntries(profile.tmpfs.map(value => {
    const separator = value.indexOf(':');
    return [value.slice(0, separator), value.slice(separator + 1)];
  }));
  assert.deepEqual(container.HostConfig.Tmpfs, expected,
    'MySQL fixture must retain every reviewed temporary storage option');
  assert.ok(!container.HostConfig.Binds?.length && !container.HostConfig.VolumesFrom?.length,
    'Host and inherited mounts are forbidden');
  let temporary = container.Mounts;
  if (profile.storagePath) {
    validateOwnedMysqlVolumeDescriptor(storage);
    assert.equal(volumes.length, 1, 'Actual owned volume inspection required');
    verifyOwnedMysqlVolume(storage, volumes[0]);
    assert.equal(container.Config.Labels?.['aibiz.native-fixture.run'], storage.runId);
    assert.deepEqual(container.HostConfig.Mounts, [{
      Type: 'volume', Source: storage.name, Target: profile.storagePath, VolumeOptions: { NoCopy: true },
    }]);
    const persistent = container.Mounts.filter(mount => mount.Type === 'volume');
    assert.equal(persistent.length, 1);
    const mount = persistent[0];
    assert.equal(mount.Name, storage.name);
    assert.equal(mount.Source, storage.mountpoint);
    assert.equal(mount.Destination, profile.storagePath);
    assert.equal(mount.Driver, 'local');
    assert.equal(mount.RW, true);
    temporary = container.Mounts.filter(mount => mount.Type !== 'volume');
  } else {
    assert.equal(storage, undefined, 'Tmpfs profile must not adopt persistent storage');
    assert.equal(volumes.length, 0);
    assert.ok(!container.HostConfig.Mounts?.length, 'Only reviewed --tmpfs declarations are allowed');
  }
  assert.ok(temporary.every(mount => mount.Type === 'tmpfs'
    && Object.hasOwn(expected, mount.Destination)),
  'MySQL fixture must not mount persistent, host or additional temporary storage');
  assert.equal(new Set(container.Mounts.map(mount => mount.Destination)).size, container.Mounts.length,
    'Ambiguous duplicate runtime mounts are forbidden');
}

export function verifySelectedMysqlStorage(selection, container, options = {}) {
  if (selection === undefined) {
    assert.equal(options.storage, undefined);
    assert.equal((options.volumes ?? []).length, 0);
    assert.equal(container.Image, MYSQL_IMAGE_ID, 'Historical fixture requires its exact MySQL image');
    assert.deepEqual(container.HostConfig.Tmpfs, {
      '/var/lib/mysql': 'rw,nosuid,nodev,size=1073741824',
    });
    return;
  }
  assert.ok(selection && typeof selection === 'object');
  assert.deepEqual(Object.keys(selection).sort(), ['imageId', 'name']);
  const profile = mysqlFixtureProfile(selection.name);
  assert.equal(selection.imageId, profile.imageId);
  verifyMysqlFixtureStorage(profile, container, options);
}

export function mysqlFixtureNetworkArgs(manifest, subnet) {
  const args = ['network', 'create', '--internal', '--driver', 'bridge',
    '--label', `aibiz.native-fixture.run=${manifest.runId}`];
  if (subnet !== undefined) {
    assert.equal(typeof subnet, 'string', 'Fixture subnet must be a private IPv4 /24');
    const [address, prefix, extra] = subnet.split('/');
    assert.ok(isIPv4(address) && prefix === '24' && extra === undefined,
      'Fixture subnet must be a private IPv4 /24');
    const [first, second, , last] = address.split('.').map(Number);
    assert.ok(last === 0 && (first === 10 || (first === 172 && second >= 16 && second <= 31)
      || (first === 192 && second === 168)), 'Fixture subnet must be a private IPv4 /24');
    args.push('--subnet', subnet);
  }
  return [...args, manifest.ownership.network];
}
