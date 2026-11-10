import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ownedServiceTmpfs, verifyOwnedServiceTmpfs, verifyOwnedZookeeper, ZOOKEEPER_IMAGE_ID,
} from '../owned-backend-resources.mjs';

const runId = '123456789abc';
const label = 'zoo-r1';

export function zooFixture() {
  return {
    Name: `/nf-${runId}-backend-${label}-zookeeper`, Image: ZOOKEEPER_IMAGE_ID,
    State: { Running: true },
    Config: {
      User: '65532:65532', Entrypoint: ['/docker-entrypoint.sh'], Cmd: ['zkServer.sh', 'start-foreground'],
      Labels: { 'aibiz.native-fixture.run': runId, 'aibiz.native-backend.launch': label },
      Env: ['ZOO_ADMINSERVER_ENABLED=false', 'ZOO_STANDALONE_ENABLED=true',
        'ZOO_4LW_COMMANDS_WHITELIST=srvr', 'ZOO_SERVERS=server.1=127.0.0.1:2888:3888;2181',
        'ZOO_CONF_DIR=/conf', 'ZOO_DATA_DIR=/data', 'ZOO_DATA_LOG_DIR=/datalog', 'ZOO_LOG_DIR=/logs'],
    },
    HostConfig: {
      ReadonlyRootfs: true, Privileged: false, SecurityOpt: ['no-new-privileges'],
      PortBindings: {}, Tmpfs: ownedServiceTmpfs('zookeeper'),
    },
    NetworkSettings: { Networks: { [`nf-${runId}-private`]: { NetworkID: 'a'.repeat(64) } },
      Ports: { '2181/tcp': null } },
    Mounts: Object.keys(ownedServiceTmpfs('zookeeper')).map(Destination => ({ Type: 'tmpfs', Destination })),
  };
}

test('ZooKeeper guard accepts only the owned standalone ephemeral policy', () => {
  verifyOwnedZookeeper(zooFixture(), runId, label);
});

for (const [name, mutate] of [
  ['mutable image', x => { x.Image = 'zookeeper:3.7'; }],
  ['root user', x => { x.Config.User = '0:0'; }],
  ['writable root', x => { x.HostConfig.ReadonlyRootfs = false; }],
  ['foreign name', x => { x.Name = '/zoo1'; }],
  ['foreign ownership', x => { x.Config.Labels['aibiz.native-fixture.run'] = 'f'.repeat(12); }],
  ['shared network', x => { x.NetworkSettings.Networks.shared = {}; }],
  ['published port', x => { x.NetworkSettings.Ports['2181/tcp'] = [{ HostIp: '127.0.0.1', HostPort: '2181' }]; }],
  ['host binding', x => { x.HostConfig.Binds = ['/shared:/data']; }],
  ['persistent data', x => { x.Mounts[0] = { Type: 'volume', Destination: '/data' }; }],
  ['extra tmpfs', x => { x.HostConfig.Tmpfs['/unreviewed'] = 'rw'; }],
  ['extra runtime mount', x => { x.Mounts.push({ Type: 'tmpfs', Destination: '/unreviewed' }); }],
  ['duplicate runtime mount', x => { x.Mounts.push(x.Mounts[0]); }],
  ['all commands enabled', x => { x.Config.Env[2] = 'ZOO_4LW_COMMANDS_WHITELIST=*'; }],
  ['foreign peer', x => { x.Config.Env[3] = 'ZOO_SERVERS=server.1=zoo1:2888:3888;2181'; }],
  ['custom entrypoint', x => { x.Config.Entrypoint = ['sh']; }],
  ['nonzero capabilities', x => { x.HostConfig.CapAdd = ['SYS_ADMIN']; }],
]) {
  test(`ZooKeeper guard rejects ${name}`, () => {
    const x = zooFixture();
    mutate(x);
    assert.throws(() => verifyOwnedZookeeper(x, runId, label));
  });
}

test('reviewed temporary storage policies differ by role and reject arbitrary relaxation', () => {
  for (const role of ['uaa', 'redis', 'allinone', 'provider', 'gateway', 'nacos']) {
    const x = zooFixture();
    x.HostConfig.Tmpfs = ownedServiceTmpfs(role);
    x.Mounts = Object.keys(x.HostConfig.Tmpfs).map(Destination => ({ Type: 'tmpfs', Destination }));
    verifyOwnedServiceTmpfs(x, role);
    x.HostConfig.Tmpfs['/tmp'] += ',exec';
    assert.throws(() => verifyOwnedServiceTmpfs(x, role));
  }
  assert.throws(() => ownedServiceTmpfs('unreviewed'));
});
