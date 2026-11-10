import assert from 'node:assert/strict';
import test from 'node:test';
import { verifyRetirementPeers } from '../retire-owned-native-fixture.mjs';
import { mysqlFixtureProfile } from '../mysql-fixture-profiles.mjs';
import { OWNED_VOLUME_PROFILE, ownedMysqlVolumePlan } from '../owned-mysql-volume.mjs';
const runId = '123456789abc';
function fixture() {
  const roles = ['mysql', 'allinone', 'gateway', 'provider', 'uaa', 'redis', 'nacos', 'zookeeper'];
  const peers = roles.map((role, index) => ({
    role, containerId: String(index + 1).repeat(64), imageId: `sha256:${String(index + 1).repeat(64)}`,
  }));
  const network = { Id: 'a'.repeat(64), Name: `nf-${runId}-private`, Internal: true,
    Labels: { 'aibiz.native-fixture.run': runId },
    Containers: Object.fromEntries(peers.map(peer => [peer.containerId, {}])) };
  const resources = { runId, mysqlId: peers[0].containerId, mysqlImage: peers[0].imageId, networkId: network.Id };
  const deployment = { runId, services: Object.fromEntries(peers.slice(1, 5)
    .map(({ role, ...value }) => [role, value])), auxiliaryContainers: peers.slice(5) };
  const containers = peers.map(peer => ({ Id: peer.containerId, Image: peer.imageId,
    Name: `/nf-${runId}-${peer.role}`, Config: { Labels: { 'aibiz.native-fixture.run': runId } },
    NetworkSettings: { Networks: { [network.Name]: { NetworkID: network.Id } } },
    HostConfig: { Privileged: false }, Mounts: [{ Type: 'tmpfs' }] }));
  return { resources, deployment, containers, network };
}
test('tmpfs retirement accepts only all eight exact owned journaled peers', () => {
  const f = fixture();
  assert.equal(verifyRetirementPeers(runId, f.resources, f.deployment, f.containers, f.network).length, 8);
});
for (const [name, mutate] of [
  ['shared network', f => { f.network.Internal = false; }],
  ['undeclared peer', f => { f.network.Containers['f'.repeat(64)] = {}; }],
  ['foreign image', f => { f.containers[1].Image = `sha256:${'f'.repeat(64)}`; }],
  ['foreign label', f => { f.containers[1].Config.Labels = {}; }],
  ['shared name', f => { f.containers[1].Name = '/provider'; }],
  ['second network', f => { f.containers[1].NetworkSettings.Networks.shared = {}; }],
  ['persistent SQL data', f => { f.containers[0].Mounts = [{ Type: 'volume' }]; }],
  ['duplicate container', f => { f.deployment.services.provider.containerId = f.resources.mysqlId; }],
]) {
  test(`tmpfs retirement rejects ${name}`, () => {
    const f = fixture();
    mutate(f);
    assert.throws(() => verifyRetirementPeers(runId, f.resources, f.deployment, f.containers, f.network));
  });
}

test('persistent disposal is separately selected and requires the original actual volume identity', () => {
  const f = fixture();
  const profile = mysqlFixtureProfile(OWNED_VOLUME_PROFILE);
  const storage = { ...ownedMysqlVolumePlan(runId, 'a'.repeat(32)), createdAt: '2026-11-05T10:00:00Z',
    mountpoint: `/var/lib/docker/volumes/nf-${runId}-mysql-data/_data` };
  Object.assign(f.resources, { mysqlImage: profile.imageId, databaseProfile: {
    name: OWNED_VOLUME_PROFILE, imageId: profile.imageId,
  }, databaseStorage: storage });
  const mysql = f.containers[0];
  Object.assign(mysql, { Image: profile.imageId });
  mysql.Config.User = profile.user;
  Object.assign(mysql.HostConfig, { ReadonlyRootfs: true,
    Tmpfs: Object.fromEntries(profile.tmpfs.map(value => {
      const i = value.indexOf(':');
      return [value.slice(0, i), value.slice(i + 1)];
    })),
    Mounts: [{ Type: 'volume', Source: storage.name, Target: '/bitnami/mysql', VolumeOptions: { NoCopy: true } }],
  });
  mysql.Mounts = [{ Type: 'volume', Name: storage.name, Source: storage.mountpoint,
    Destination: '/bitnami/mysql', Driver: 'local', RW: true }];
  const volume = { Name: storage.name, Driver: 'local', Scope: 'local', Options: null,
    CreatedAt: storage.createdAt, Mountpoint: storage.mountpoint,
    Labels: { 'aibiz.native-fixture.run': runId, 'aibiz.native-fixture.volume-nonce': storage.nonce } };
  const verify = options => verifyRetirementPeers(runId, f.resources, f.deployment, f.containers, f.network, options);
  assert.equal(verify({ storageMode: 'owned-volume', volumes: [volume] }).length, 8);
  assert.throws(() => verify());
  assert.throws(() => verify({ storageMode: 'owned-volume' }));
  assert.throws(() => verify({ storageMode: 'owned-volume', volumes: [{ ...volume, Options: { device: '/shared' } }] }));
  assert.throws(() => verify({ storageMode: 'owned-volume', volumes: [{ ...volume, CreatedAt: '2026-11-06T00:00:00Z' }] }));
  const mysqlId = f.resources.mysqlId;
  mysql.State = { Running: false };
  mysql.HostConfig.NetworkMode = f.network.Name;
  delete f.network.Containers[mysqlId];
  assert.equal(verify({ storageMode: 'owned-volume', stoppedMysql: true, volumes: [volume] }).length, 8);
  assert.throws(() => verify({ storageMode: 'owned-volume', volumes: [volume] }));
  f.resources.mysqlId = null;
  f.containers.shift();
  assert.equal(verify({ storageMode: 'owned-volume', missingMysql: true, volumes: [volume] }).length, 7);
  assert.throws(() => verify({ storageMode: 'tmpfs', missingMysql: true }));
  f.resources.databaseStorage = null;
  assert.equal(verify({ storageMode: 'owned-volume', missingMysql: true, missingVolume: true }).length, 7);
  assert.throws(() => verify({ storageMode: 'owned-volume', missingMysql: true }));
  assert.throws(() => verify({ storageMode: 'tmpfs', missingMysql: true, missingVolume: true }));
});
