import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MYSQL_IMAGE_ID, MYSQL_FIXTURE_PROFILES, mysqlFixtureArgs, mysqlFixtureNetworkArgs,
  mysqlFixtureProfile, verifyMysqlFixtureState, verifyMysqlFixtureStorage,
  verifySelectedMysqlStorage, mysqlFixtureReadyProcess,
} from '../mysql-fixture-profiles.mjs';
import { createFixture } from '../prepare-run-owned-native-nonadmin-fixture.mjs';
import {
  mysqlSmokeRunArgs, runIsolatedSQLSmoke, verifyMysqlSmokePlatform,
} from './run-owned-native-nonadmin-fixture.sql.mjs';

const { manifest } = createFixture({
  runId: 'abc123def456', passwordStorageMode: 'sm3', modelVersion: 816,
});
const profile = mysqlFixtureProfile('mysql57-bitnami-arm64');
const selection = { name: 'mysql57-bitnami-arm64', imageId: profile.imageId };
const tmpfs = () => Object.fromEntries(profile.tmpfs.map(value => {
  const index = value.indexOf(':');
  return [value.slice(0, index), value.slice(index + 1)];
}));
const container = () => ({
  Image: profile.imageId, Config: { User: profile.user },
  HostConfig: { ReadonlyRootfs: true, Tmpfs: tmpfs() }, Mounts: [],
});

test('database profiles are frozen explicit image selections with no architecture fallback', () => {
  assert.equal(mysqlFixtureProfile().imageId, MYSQL_IMAGE_ID);
  for (const value of [MYSQL_FIXTURE_PROFILES, profile, profile.tmpfs, profile.args, profile.command]) {
    assert.equal(Object.isFrozen(value), true);
  }
  for (const value of ['latest', 'constructor', '__proto__', true, null, '']) {
    assert.throws(() => mysqlFixtureProfile(value));
  }
  assert.throws(() => mysqlFixtureArgs({ ...profile }, 'a'.repeat(32)));
  assert.throws(() => mysqlFixtureArgs(profile, 'short'));
});

test('reviewed ARM64 storage requires exact options, not just matching mount paths', () => {
  verifyMysqlFixtureStorage(profile, container());
  verifySelectedMysqlStorage(selection, container());
  for (const mutate of [
    c => { c.Image = MYSQL_IMAGE_ID; },
    c => { c.Config.User = '0:0'; },
    c => { c.HostConfig.ReadonlyRootfs = false; },
    c => { c.HostConfig.Tmpfs['/docker-entrypoint-initdb.d'] = 'rw'; },
    c => { c.HostConfig.Tmpfs['/bitnami/mysql'] = 'rw,size=9999999999'; },
    c => { delete c.HostConfig.Tmpfs['/opt/bitnami/mysql/conf']; },
    c => { c.HostConfig.Tmpfs['/shared'] = 'rw'; },
    c => { c.Mounts.push({ Type: 'bind' }); },
    c => { c.Mounts.push({ Type: 'volume' }); },
    c => { c.Mounts.push({ Type: 'tmpfs', Destination: '/unreviewed' }); },
    c => { c.HostConfig.Mounts = [{ Type: 'tmpfs', Target: '/unreviewed' }]; },
    c => { c.HostConfig.Binds = ['/shared:/bitnami/mysql']; },
    c => { c.HostConfig.VolumesFrom = ['shared']; },
  ]) {
    const value = container();
    mutate(value);
    assert.throws(() => verifySelectedMysqlStorage(selection, value));
  }
  for (const value of [null, { name: selection.name }, { ...selection, imageId: MYSQL_IMAGE_ID },
    { ...selection, extra: true }]) {
    assert.throws(() => verifySelectedMysqlStorage(value, container()));
  }
});

test('historical MySQL journals do not silently select ARM64 or change their mount contract', () => {
  const legacy = {
    Image: MYSQL_IMAGE_ID,
    HostConfig: { Tmpfs: { '/var/lib/mysql': 'rw,nosuid,nodev,size=1073741824' } },
  };
  verifySelectedMysqlStorage(undefined, legacy);
  assert.throws(() => verifySelectedMysqlStorage(undefined, container()));
  assert.throws(() => verifySelectedMysqlStorage(selection, legacy));
});

test('SQL smoke explicitly selects the same ARM64 profile and masks bundled database seeds', () => {
  const args = mysqlSmokeRunArgs(manifest, {
    mysqlImage: profile.imageId, databaseProfile: selection.name, password: 'a'.repeat(32),
  });
  for (const flag of ['--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges',
    '--pull=never', '1001:1001', '/docker-entrypoint-initdb.d:ro,nosuid,nodev,size=1048576',
    '/docker-entrypoint-startdb.d:ro,nosuid,nodev,size=1048576']) {
    assert.ok(args.includes(flag), flag);
  }
  assert.ok(!args.includes('--publish') && !args.includes('--volume') && !args.includes('--mount'));
  assert.deepEqual(args.slice(args.indexOf(profile.imageId) + 1), profile.command);
  assert.throws(() => mysqlSmokeRunArgs(manifest, {
    mysqlImage: MYSQL_IMAGE_ID, databaseProfile: selection.name, password: 'a'.repeat(32),
  }));
});

test('SQL fixture rejects mismatched images and invalid subnets before generating a run', () => {
  const options = {
    mysqlImage: profile.imageId, databaseProfile: selection.name,
    uaaSchemaContainer: 'schema-only-source', uaaSchema: 'schema_only',
    scenario: 'two-center', modelVersion: 816, uaaSchemaMode: 'legacy-views',
  };
  for (const change of [
    { mysqlImage: MYSQL_IMAGE_ID }, { databaseProfile: 'automatic' },
    { subnet: '8.8.8.0/24' }, { subnet: '10.34.0.1/24' },
  ]) assert.throws(() => runIsolatedSQLSmoke({ ...options, ...change }));
  assert.throws(() => runIsolatedSQLSmoke({
    ...options, databaseProfile: 'mysql57-bitnami-arm64-owned-volume',
  }), /explicit retention/);
});

test('cached image and server architecture must agree before schema capture or provisioning', () => {
  const image = { Id: profile.imageId, Os: 'linux', Architecture: 'arm64' };
  verifyMysqlSmokePlatform(image, 'linux/arm64\n', profile);
  for (const [changed, platform] of [
    [{ ...image, Id: MYSQL_IMAGE_ID }, 'linux/arm64'],
    [{ ...image, Architecture: 'amd64' }, 'linux/arm64'],
    [image, 'linux/amd64'],
    [{ ...image, Os: 'windows' }, 'windows/arm64'],
  ]) assert.throws(() => verifyMysqlSmokePlatform(changed, platform, profile));
});

test('observed dialect, charset and exact version prefix cannot be substituted', () => {
  const state = { version: '5.7.41', lowerCaseTableNames: 1, characterSet: 'utf8mb4' };
  verifyMysqlFixtureState(profile, state);
  for (const change of [
    { version: '5.7.410' }, { version: '8.0.41' }, { lowerCaseTableNames: 0 },
    { characterSet: 'latin1' },
  ]) assert.throws(() => verifyMysqlFixtureState(profile, { ...state, ...change }));
});

test('readiness rejects the entrypoint shell even if its temporary child accepts TCP', () => {
  assert.equal(mysqlFixtureReadyProcess('mysqld\n'), true);
  assert.equal(mysqlFixtureReadyProcess('mysqld'), true);
  for (const name of ['bash\n', 'sh\n', 'mysqld_safe\n', '', 'mysqld\nbash', null, true]) {
    assert.equal(mysqlFixtureReadyProcess(name), false);
  }
});

test('explicit private subnets retain internal bridge and exact run ownership', () => {
  const args = mysqlFixtureNetworkArgs(manifest, '10.34.0.0/24');
  assert.deepEqual(args, [
    'network', 'create', '--internal', '--driver', 'bridge',
    '--label', 'aibiz.native-fixture.run=abc123def456',
    '--subnet', '10.34.0.0/24', manifest.ownership.network,
  ]);
  for (const subnet of ['127.0.0.0/24', '10.34.0.0/16', '172.32.0.0/24', '::/24', true]) {
    assert.throws(() => mysqlFixtureNetworkArgs(manifest, subnet));
  }
});
