import assert from 'node:assert/strict';

export const NACOS_IMAGE_ID =
  'sha256:45bba63526de64b9bca2e6b9303eee1b56f1c30bf578d40384716d861ca556cd';
export const ZOOKEEPER_IMAGE_ID =
  'sha256:2fc0f525e369f1a0bea0f92c03649072dc2141ce4b983ce7373c3a05b3b549a3';
export const OWNED_SERVICE_TMPFS = '/tmp:rw,nosuid,nodev,size=268435456';
export const OWNED_ZOOKEEPER_TMPFS = Object.freeze([
  OWNED_SERVICE_TMPFS,
  '/conf:rw,nosuid,nodev,uid=65532,gid=65532,mode=0750,size=1048576',
  '/data:rw,nosuid,nodev,uid=65532,gid=65532,mode=0750,size=134217728',
  '/datalog:rw,nosuid,nodev,uid=65532,gid=65532,mode=0750,size=268435456',
  '/logs:rw,nosuid,nodev,uid=65532,gid=65532,mode=0750,size=67108864',
]);
export const OWNED_NACOS_TMPFS = Object.freeze([
  OWNED_SERVICE_TMPFS,
  '/tmp/nacos-native:rw,nosuid,nodev,exec,uid=65532,gid=65532,mode=0700,size=67108864',
  '/home/nacos/logs:rw,nosuid,nodev,uid=65532,gid=65532,size=268435456',
  '/home/nacos/data:rw,nosuid,nodev,uid=65532,gid=65532,size=1073741824',
  '/home/nacos/work:rw,nosuid,nodev,uid=65532,gid=65532,size=67108864',
]);

export function ownedServiceTmpfs(role) {
  assert.ok(['allinone', 'gateway', 'provider', 'uaa', 'redis', 'nacos', 'zookeeper'].includes(role),
    'Unreviewed owned service storage role');
  const entries = role === 'zookeeper' ? OWNED_ZOOKEEPER_TMPFS
    : role === 'nacos' ? OWNED_NACOS_TMPFS : [OWNED_SERVICE_TMPFS];
  return Object.fromEntries(entries.map(value => {
    const separator = value.indexOf(':');
    return [value.slice(0, separator), value.slice(separator + 1)];
  }));
}

export function verifyOwnedServiceTmpfs(container, role) {
  const expected = ownedServiceTmpfs(role);
  assert.equal(container.Config.User, '65532:65532', 'Owned service must use the reviewed non-root user');
  assert.equal(container.HostConfig.ReadonlyRootfs, true);
  assert.deepEqual(container.HostConfig.Tmpfs, expected, 'Owned service temporary storage differs');
  const observed = (container.Mounts ?? []).filter(mount => mount.Type === 'tmpfs');
  assert.equal(new Set(observed.map(mount => mount.Destination)).size, observed.length,
    'Duplicate temporary runtime mount');
  for (const mount of observed) assert.ok(Object.hasOwn(expected, mount.Destination),
    'Undeclared temporary runtime mount');
}

export function verifyOwnedZookeeper(container, runId, label) {
  assert.match(runId, /^[a-f0-9]{12}$/);
  assert.match(label, /^[a-z0-9][a-z0-9-]{0,48}$/);
  assert.equal(container.Name, `/nf-${runId}-backend-${label}-zookeeper`);
  assert.equal(container.Image, ZOOKEEPER_IMAGE_ID);
  assert.equal(container.State.Running, true);
  assert.equal(container.Config.Labels?.['aibiz.native-fixture.run'], runId);
  assert.equal(container.Config.Labels?.['aibiz.native-backend.launch'], label);
  assert.equal(container.HostConfig.Privileged, false);
  assert.ok(!container.HostConfig.CapAdd?.length);
  assert.ok(container.HostConfig.SecurityOpt?.includes('no-new-privileges'));
  assert.deepEqual(Object.keys(container.NetworkSettings.Networks), [`nf-${runId}-private`]);
  assert.ok(Object.values(container.HostConfig.PortBindings ?? {}).every(row => row === null));
  assert.ok(Object.values(container.NetworkSettings.Ports ?? {}).every(row => row === null));
  verifyOwnedServiceTmpfs(container, 'zookeeper');
  assert.ok(!container.HostConfig.Binds?.length && !container.HostConfig.Mounts?.length
    && !container.HostConfig.VolumesFrom?.length);
  assert.ok(container.Mounts.every(mount => mount.Type === 'tmpfs'),
    'ZooKeeper must not use anonymous volumes or input binds');
  assert.deepEqual(container.Config.Entrypoint, ['/docker-entrypoint.sh']);
  assert.deepEqual(container.Config.Cmd, ['zkServer.sh', 'start-foreground']);
  for (const setting of [
    'ZOO_ADMINSERVER_ENABLED=false', 'ZOO_STANDALONE_ENABLED=true',
    'ZOO_4LW_COMMANDS_WHITELIST=srvr', 'ZOO_SERVERS=server.1=127.0.0.1:2888:3888;2181',
    'ZOO_CONF_DIR=/conf', 'ZOO_DATA_DIR=/data', 'ZOO_DATA_LOG_DIR=/datalog', 'ZOO_LOG_DIR=/logs',
  ]) {
    const key = setting.slice(0, setting.indexOf('='));
    assert.deepEqual(container.Config.Env.filter(row => row.startsWith(`${key}=`)), [setting]);
  }
}
