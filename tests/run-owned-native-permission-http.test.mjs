import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createFixture } from '../prepare-run-owned-native-nonadmin-fixture.mjs';
import {
  main, moduleRequest, validateDeployment, validateEndpoint, validateInputBind, verifyBaseline,
  verifyDenied, verifyMutation, verifyRead, verifyRestoration, verifyUAAIdentity,
  modelingContextFromIdentity, verifyModelingAppData,
  createModuleProbe,
  bindCreatedModule,
  executeOwnedMatrix,
  requiresFreshBackendLogin,
} from '../run-owned-native-permission-http.mjs';
import { mysqlFixtureProfile } from '../mysql-fixture-profiles.mjs';
import { ownedServiceTmpfs, ZOOKEEPER_IMAGE_ID } from '../owned-backend-resources.mjs';
import { OWNED_VOLUME_PROFILE, ownedMysqlVolumePlan } from '../owned-mysql-volume.mjs';

const runId = 'f01006abcdef';
const { manifest } = createFixture({
  runId, scenario: 'two-center', passwordStorageMode: 'sm3', modelVersion: 816,
  uaaSchemaMode: 'legacy-views', secret: () => '1'.repeat(36),
});
const hashId = number => number.toString(16).padStart(64, '0');
const imageId = number => `sha256:${hashId(number)}`;
const root = manifest.roots[0];

test('native create probe supplies the actual required code name and owned record identity', () => {
  const probe = createModuleProbe(runId, root, 'crud-r1', '0123abcd');
  assert.deepEqual(probe, {
    psmoduleid: `nf_${runId}_a_http_0123abcd`, codename: 'NativeProbe0123abcd',
    pssystemid: root.logicalSystemId, psmodulename: 'Native relogin crud-r1 a',
    modtag: `nf_${runId}_a_created`,
  });
  assert.ok(!Object.hasOwn(probe, 'psdevslnid'));
  for (const invalid of ['', 'bad-name', 'UPPERHEX']) {
    assert.throws(() => createModuleProbe(runId, root, 'crud-r1', invalid));
  }
  assert.throws(() => createModuleProbe(runId, { ...root, rootId: 'foreign' }, 'crud-r1'));
});

function topology() {
  const resources = {
    contract: 'run-owned-native-fixture-resources-v1', runId,
    mysqlId: hashId(1), networkId: hashId(2), mysqlImage: imageId(3),
    mysqlName: manifest.ownership.mysqlContainer, networkName: manifest.ownership.network,
    schemas: manifest.schemas,
  };
  const services = Object.fromEntries(['allinone', 'gateway', 'provider', 'uaa'].map((role, index) =>
    [role, { containerId: hashId(index + 4), imageId: imageId(index + 10) }]));
  const deployment = {
    contract: 'run-owned-native-permission-deployment-input-v1', runId, services,
    endpoints: {
      uaa: { origin: 'http://127.0.0.1:33361', service: 'uaa', containerPort: 32666 },
      backend: { origin: 'http://127.0.0.1:33386', service: 'gateway', containerPort: 30086 },
    },
  };
  const peers = [
    { containerId: resources.mysqlId, imageId: resources.mysqlImage, role: 'mysql' },
    ...Object.entries(services).map(([role, row]) => ({ ...row, role })),
  ];
  const containers = peers.map(peer => ({
    Id: peer.containerId, Name: `/${peer.role === 'mysql' ? manifest.ownership.mysqlContainer : `nf-${runId}-${peer.role}`}`,
    Image: peer.imageId, State: { Running: true },
    Config: { Labels: { [manifest.ownership.label]: runId } }, Mounts: [],
    HostConfig: { Privileged: false, PortBindings: {}, ...(peer.role === 'mysql'
      ? { Tmpfs: { '/var/lib/mysql': 'rw,nosuid,nodev,size=1073741824' } } : {}) },
    NetworkSettings: { Networks: { [manifest.ownership.network]: { NetworkID: resources.networkId } },
      Ports: peer.role === 'mysql' ? { '3306/tcp': null } : {} },
  }));
  for (const endpoint of Object.values(deployment.endpoints)) {
    const container = containers.find(row => row.Id === services[endpoint.service].containerId);
    const bindings = [{ HostIp: '127.0.0.1', HostPort: new URL(endpoint.origin).port }];
    container.NetworkSettings.Ports[`${endpoint.containerPort}/tcp`] = bindings;
    container.HostConfig.PortBindings[`${endpoint.containerPort}/tcp`] = bindings;
  }
  const network = {
    Id: resources.networkId, Name: manifest.ownership.network, Internal: true, Driver: 'bridge',
    Labels: { [manifest.ownership.label]: runId },
    Containers: Object.fromEntries(peers.map(peer => [peer.containerId, {}])),
  };
  const imageReceipt = {
    contract: 'isolated-backend-source-images-v1', status: 'passed-image-artifact-binding-only',
    imageArtifactBindingVerified: true,
    components: ['allinone', 'gateway', 'provider'].map(name => ({ name, image: { id: services[name].imageId } })),
  };
  return { resources, deployment, containers, network, imageReceipt };
}

test('exact IDs, private peer set, pinned source images and inspected loopback ports pass bounded preflight', () => {
  const t = topology();
  assert.deepEqual(validateDeployment(manifest, t.resources, t.deployment, t.containers, t.network, t.imageReceipt), {
    uaa: 'http://127.0.0.1:33361', backend: 'http://127.0.0.1:33386',
  });
});

test('HTTP permission preflight retains the exact ARM64 image, user and tmpfs policy', () => {
  const profile = mysqlFixtureProfile('mysql57-bitnami-arm64');
  const target = () => {
    const t = topology();
    t.resources.mysqlImage = profile.imageId;
    t.resources.databaseProfile = { name: 'mysql57-bitnami-arm64', imageId: profile.imageId };
    const mysql = t.containers[0];
    mysql.Image = profile.imageId;
    mysql.Config.User = profile.user;
    mysql.HostConfig.ReadonlyRootfs = true;
    mysql.HostConfig.Tmpfs = Object.fromEntries(profile.tmpfs.map(value => {
      const i = value.indexOf(':');
      return [value.slice(0, i), value.slice(i + 1)];
    }));
    mysql.Mounts = Object.keys(mysql.HostConfig.Tmpfs)
      .map(Destination => ({ Type: 'tmpfs', Destination }));
    return t;
  };
  const t = target();
  assert.doesNotThrow(() => validateDeployment(manifest, t.resources, t.deployment,
    t.containers, t.network, t.imageReceipt));
  for (const mutate of [
    t => { t.resources.databaseProfile.name = 'unreviewed'; },
    t => { t.resources.databaseProfile.imageId = imageId(99); },
    t => { t.containers[0].Config.User = '0:0'; },
    t => { t.containers[0].HostConfig.ReadonlyRootfs = false; },
    t => { t.containers[0].HostConfig.Tmpfs['/docker-entrypoint-startdb.d'] = 'rw'; },
    t => { t.containers[0].Mounts.push({ Type: 'volume', Source: 'shared' }); },
  ]) {
    const t = target();
    mutate(t);
    assert.throws(() => validateDeployment(manifest, t.resources, t.deployment,
      t.containers, t.network, t.imageReceipt));
  }
});

test('owned Redis must be declared and bound by exact ID/image without relaxing private peer policy', () => {
  const withRedis = () => {
    const t = topology();
    const redis = structuredClone(t.containers[1]);
    redis.Id = hashId(80);
    redis.Name = `/nf-${runId}-redis`;
    redis.Image = imageId(81);
    redis.HostConfig.PortBindings = {};
    redis.NetworkSettings.Ports = { '6379/tcp': null };
    t.containers.push(redis);
    t.network.Containers[redis.Id] = {};
    t.deployment.auxiliaryContainers = [{ containerId: redis.Id, imageId: redis.Image, role: 'redis' }];
    return t;
  };
  const accepted = withRedis();
  assert.doesNotThrow(() => validateDeployment(manifest, accepted.resources, accepted.deployment,
    accepted.containers, accepted.network, accepted.imageReceipt));
  for (const mutate of [
    t => { delete t.deployment.auxiliaryContainers; },
    t => { t.deployment.auxiliaryContainers[0].imageId = imageId(82); },
    t => { t.containers.at(-1).Config.Labels = {}; },
    t => { t.containers.at(-1).NetworkSettings.Networks.shared = { NetworkID: hashId(90) }; },
    t => { t.containers.at(-1).HostConfig.Privileged = true; },
    t => { t.containers.at(-1).Mounts = [{ Type: 'volume', RW: true, Source: 'shared-cache' }]; },
    t => { t.containers.at(-1).HostConfig.PortBindings = {
      '6379/tcp': [{ HostIp: '0.0.0.0', HostPort: '33379' }],
    }; },
  ]) {
    const t = withRedis();
    mutate(t);
    assert.throws(() => validateDeployment(manifest, t.resources, t.deployment,
      t.containers, t.network, t.imageReceipt));
  }
});

test('HTTP disk preflight requires the bound actual volume and preserves all private peer checks', () => {
  const t = topology();
  const profile = mysqlFixtureProfile(OWNED_VOLUME_PROFILE);
  const storage = { ...ownedMysqlVolumePlan(runId, 'a'.repeat(32)), createdAt: '2026-11-05T10:00:00Z',
    mountpoint: `/var/lib/docker/volumes/nf-${runId}-mysql-data/_data` };
  t.resources.databaseProfile = { name: OWNED_VOLUME_PROFILE, imageId: profile.imageId };
  t.resources.databaseStorage = storage;
  t.resources.mysqlImage = profile.imageId;
  Object.assign(t.containers[0], { Image: profile.imageId });
  t.containers[0].Config.User = profile.user;
  Object.assign(t.containers[0].HostConfig, { ReadonlyRootfs: true,
    Tmpfs: Object.fromEntries(profile.tmpfs.map(value => {
      const i = value.indexOf(':');
      return [value.slice(0, i), value.slice(i + 1)];
    })),
    Mounts: [{ Type: 'volume', Source: storage.name, Target: '/bitnami/mysql', VolumeOptions: { NoCopy: true } }],
  });
  t.containers[0].Mounts = [{ Type: 'volume', Name: storage.name, Source: storage.mountpoint,
    Destination: '/bitnami/mysql', Driver: 'local', RW: true }];
  const volume = { Name: storage.name, Driver: 'local', Scope: 'local', Options: {},
    CreatedAt: storage.createdAt, Mountpoint: storage.mountpoint,
    Labels: { 'aibiz.native-fixture.run': runId, 'aibiz.native-fixture.volume-nonce': storage.nonce } };
  const validate = (state = t, volumes = [volume]) => validateDeployment(manifest, state.resources,
    state.deployment, state.containers, state.network, state.imageReceipt, volumes);
  assert.doesNotThrow(() => validate());
  assert.throws(() => validate(t, []));
  assert.throws(() => validate(t, [{ ...volume, CreatedAt: '2026-11-06T00:00:00Z' }]));
  const shared = structuredClone(t);
  shared.network.Containers[hashId(999)] = {};
  assert.throws(() => validate(shared));
});

test('deployment accepts a strictly reviewed ZooKeeper peer and no undeclared storage or shared endpoint', () => {
  const withZookeeper = () => {
    const t = topology();
    const label = 'zoo-r1';
    const zoo = {
      Id: hashId(80), Name: `/nf-${runId}-backend-${label}-zookeeper`, Image: ZOOKEEPER_IMAGE_ID,
      State: { Running: true },
      Config: {
        User: '65532:65532', Entrypoint: ['/docker-entrypoint.sh'], Cmd: ['zkServer.sh', 'start-foreground'],
        Labels: { [manifest.ownership.label]: runId, 'aibiz.native-backend.launch': label },
        Env: ['ZOO_ADMINSERVER_ENABLED=false', 'ZOO_STANDALONE_ENABLED=true',
          'ZOO_4LW_COMMANDS_WHITELIST=srvr', 'ZOO_SERVERS=server.1=127.0.0.1:2888:3888;2181',
          'ZOO_CONF_DIR=/conf', 'ZOO_DATA_DIR=/data', 'ZOO_DATA_LOG_DIR=/datalog', 'ZOO_LOG_DIR=/logs'],
      },
      HostConfig: { Privileged: false, ReadonlyRootfs: true, PortBindings: {},
        SecurityOpt: ['no-new-privileges'], Tmpfs: ownedServiceTmpfs('zookeeper') },
      NetworkSettings: { Networks: { [manifest.ownership.network]: { NetworkID: t.network.Id } },
        Ports: { '2181/tcp': null } },
      Mounts: Object.keys(ownedServiceTmpfs('zookeeper')).map(Destination => ({ Type: 'tmpfs', Destination })),
    };
    t.containers.push(zoo);
    t.network.Containers[zoo.Id] = {};
    t.deployment.auxiliaryContainers = [{ role: 'zookeeper', imageId: zoo.Image, containerId: zoo.Id }];
    return t;
  };
  const accepted = withZookeeper();
  assert.doesNotThrow(() => validateDeployment(manifest, accepted.resources, accepted.deployment,
    accepted.containers, accepted.network, accepted.imageReceipt));
  for (const mutate of [
    t => { delete t.deployment.auxiliaryContainers; },
    t => { t.deployment.auxiliaryContainers[0].role = 'other'; },
    t => { t.containers.at(-1).Image = imageId(99); },
    t => { t.containers.at(-1).Config.User = '0:0'; },
    t => { t.containers.at(-1).HostConfig.Tmpfs['/extra'] = 'rw'; },
    t => { t.containers.at(-1).Mounts.push({ Type: 'volume', Destination: '/data' }); },
    t => { t.containers.at(-1).Name = '/zoo1'; },
  ]) {
    const t = withZookeeper();
    mutate(t);
    assert.throws(() => validateDeployment(manifest, t.resources, t.deployment,
      t.containers, t.network, t.imageReceipt));
  }
});

test('preflight rejects stale images, unlabeled/shared peers, multinet, privileges, mounts and published DB', () => {
  for (const mutate of [
    t => { t.resources.runId = '123456abcdef'; },
    t => { t.resources.mysqlName = 'mysql'; },
    t => { t.resources.schemas = { ...manifest.schemas, uaa: 'shared' }; },
    t => { t.deployment.services.provider.imageId = imageId(99); t.containers[3].Image = imageId(99); },
    t => { t.imageReceipt.imageArtifactBindingVerified = false; },
    t => { t.network.Internal = false; },
    t => { t.network.Containers[hashId(90)] = {}; },
    t => { t.containers[1].Config.Labels = {}; },
    t => { t.containers[1].NetworkSettings.Networks.shared = { NetworkID: hashId(90) }; },
    t => { t.containers[1].HostConfig.Privileged = true; },
    t => { t.containers[1].HostConfig.CapAdd = ['SYS_ADMIN']; },
    t => { t.containers[1].HostConfig.PidMode = 'host'; },
    t => { t.containers[1].Mounts = [{ Type: 'bind', RW: false, Source: '/var/run/docker.sock' }]; },
    t => { t.containers[1].Mounts = [{ Type: 'volume', RW: true, Source: 'shared' }]; },
    t => { t.containers[0].NetworkSettings.Ports['3306/tcp'] = [{ HostIp: '127.0.0.1', HostPort: '3306' }]; },
    t => { t.containers[0].HostConfig.Tmpfs = {}; },
    t => { t.containers[1].State.Running = false; },
  ]) {
    const t = topology();
    mutate(t);
    assert.throws(() => validateDeployment(manifest, t.resources, t.deployment, t.containers, t.network, t.imageReceipt));
  }
});

test('read-only owned input mounts reject symlink ancestors and the entire credential-bearing fixture directory', t => {
  const workspace = mkdtempSync(join(tmpdir(), 'native-http-bind-'));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  const base = join(workspace, '.artifacts', 'native-nonadmin-fixtures', runId);
  const inputs = join(base, 'integration-inputs');
  mkdirSync(inputs, { recursive: true });
  const input = join(inputs, 'application.properties');
  writeFileSync(input, 'example=value\n');
  assert.equal(validateInputBind(workspace, runId, input), true);
  assert.equal(validateInputBind(workspace, runId, inputs), true);
  assert.throws(() => validateInputBind(workspace, runId, base));
  assert.throws(() => validateInputBind(workspace, runId, '/var/run/docker.sock'));
  const linked = join(base, 'linked-inputs');
  symlinkSync(inputs, linked);
  assert.throws(() => validateInputBind(workspace, runId, join(linked, 'application.properties')));
  symlinkSync(input, join(inputs, 'linked.properties'));
  assert.throws(() => validateInputBind(workspace, runId, join(inputs, 'linked.properties')));
});

test('HTTP endpoint cannot redirect execution to shared, remote, ambiguous or unbound ports', () => {
  for (const origin of ['http://localhost:33361', 'http://127.0.0.1:32002',
    'http://127.0.0.1:33361/modelservice', 'https://127.0.0.1:33361',
    'http://user:pass@127.0.0.1:33361', 'http://127.0.0.1:33361/?x=1']) {
    const t = topology();
    assert.throws(() => validateEndpoint({ ...t.deployment.endpoints.uaa, origin }, t.deployment.services, t.containers));
  }
  const t = topology();
  t.containers[4].NetworkSettings.Ports['32666/tcp'].push({ HostIp: '0.0.0.0', HostPort: '33361' });
  assert.throws(() => validateEndpoint(t.deployment.endpoints.uaa, t.deployment.services, t.containers));
});

test('unpublished internal bridge ports cannot silently select a private-IP or requested-host-port fallback', () => {
  for (const ports of [null, {}, { '32666/tcp': null }]) {
    const t = topology();
    const uaa = t.containers.find(row => row.Id === t.deployment.services.uaa.containerId);
    uaa.NetworkSettings.Ports = ports;
    assert.throws(() => validateDeployment(manifest, t.resources, t.deployment,
      t.containers, t.network, t.imageReceipt));
    assert.throws(() => validateEndpoint({ ...t.deployment.endpoints.uaa, origin: 'http://172.28.0.3:32666' },
      t.deployment.services, t.containers), /Only an inspected loopback publication is allowed/);
  }
});

test('native module URL uses the developer root, distinct from logical system; CRUD mapping matches app model', () => {
  const scoped = `/api/ibizmodeling__modeldesign/psdevslnsys/${root.rootId}/psmodules`;
  assert.deepEqual(moduleRequest(root, 'FETCH_CUR_SYS'), {
    method: 'POST', path: `${scoped}/fetchcursys`, data: { pssystemid: root.logicalSystemId, size: 1000 },
  });
  for (const [operation, method, path] of [
    ['GET', 'GET', `${scoped}/probe`], ['CREATE', 'POST', scoped],
    ['UPDATE', 'PUT', `${scoped}/probe`], ['REMOVE', 'DELETE', `${scoped}/probe`],
  ]) {
    const spec = moduleRequest(root, operation, 'probe', { psmoduleid: 'probe' });
    assert.equal(spec.method, method);
    assert.equal(spec.path, path);
  }
  assert.throws(() => moduleRequest(root, 'SAVE'));
});

function identity(user) {
  return { id: user.personId, dc: user.centerId, superuser: 0, apiuser: 0,
    organization_id: `${user.centerId}_org`,
    grants: [{ system_id: 'ibizmodeling', deploy_system_id: `${user.centerId}_deploy`,
      roles: [{ authority: 'ROLE_NATIVE_FIXTURE', role_id: `${user.centerId}_ordinary_role` }] }] };
}

test('application context comes from verified UAA identity, never privileged caller headers', () => {
  const user = manifest.users[0];
  const data = identity(user);
  const context = modelingContextFromIdentity(data, user);
  assert.deepEqual(context, { system: 'ibizmodeling', organization: `${user.centerId}_org` });
  for (const mutate of [
    d => { delete d.organization_id; }, d => { d.organization_id = `${manifest.users[3].centerId}_org`; },
    d => { d.id = manifest.users[1].personId; }, d => { d.superuser = 1; },
  ]) {
    const bad = structuredClone(data);
    mutate(bad);
    assert.throws(() => modelingContextFromIdentity(bad, user));
  }
});

test('appdata requires actual matching ordinary employee context and successful HTTP', () => {
  const user = manifest.users[0], applicationContext = modelingContextFromIdentity(identity(user), user);
  const response = () => ({ status: 200, error: null, data: { context: {
    srfsystemid: 'ibizmodeling', srforgid: `${user.centerId}_org`,
    srfuserid: user.personId, srfpersonid: user.personId, srfdcid: user.centerId,
  } } });
  assert.doesNotThrow(() => verifyModelingAppData(response(), user, applicationContext));
  for (const mutate of [
    r => { r.status = 500; }, r => { r.error = 'timeout'; },
    r => { delete r.data.context; }, r => { r.data.context.srfuserid = manifest.users[1].personId; },
    r => { r.data.context.srfdcid = 'foreign'; }, r => { r.data.context.srforgid = 'foreign'; },
    r => { r.data.context.superuser = 1; }, r => { r.data.apiuser = true; },
  ]) {
    const value = response();
    mutate(value);
    assert.throws(() => verifyModelingAppData(value, user, applicationContext));
  }
});

test('all six UAA users, including no-access, must have actual matching person/center and only ordinary roles', () => {
  for (const user of manifest.users) {
    const data = identity(user);
    assert.equal(verifyUAAIdentity(data, user), true);
    const self = { ...data, roles: data.grants };
    delete self.grants;
    assert.equal(verifyUAAIdentity(self, user), true);
  }
  const user = manifest.users[0];
  for (const mutate of [
    d => { d.id = manifest.users[1].personId; },
    d => { d.dc = manifest.roots[1].centerId; },
    d => { d.superuser = 1; },
    d => { d.super_user = true; },
    d => { d.apiuser = 1; },
    d => { d.api_user = '1'; },
    d => { d.grants = []; },
    d => { d.grants[0].roles[0].authority = 'ROLE_SUPERADMIN'; },
    d => { d.grants[0].roles[0].role_id = 'ROLE_APIUSERS'; },
    d => { d.grants[0].system_id = 'foreign'; },
    d => { d.grants[0].deploy_system_id = `${manifest.roots[1].centerId}_deploy`; },
  ]) {
    const data = identity(user);
    mutate(data);
    assert.throws(() => verifyUAAIdentity(data, user));
  }
});

test('401/404/500/200, transport failure, leaked names and any physical mutation are not denial proof', () => {
  const before = [{ database: root.database, row: { ID: 'x', TAG: 'before' } }];
  assert.doesNotThrow(() => verifyDenied({ status: 403, error: null, data: {} }, before, structuredClone(before), root));
  for (const status of [200, 204, 301, 302, 307, 400, 401, 404, 429, 500, 503, null]) {
    assert.throws(() => verifyDenied({ status, error: null }, before, before, root));
  }
  assert.throws(() => verifyDenied({ status: 403, error: 'timeout' }, before, before, root));
  assert.throws(() => verifyDenied({ status: 403, error: null }, before, [], root));
  assert.throws(() => verifyDenied({ status: 403, error: null, data: { message: root.sentinelName } }, before, before, root));
  assert.throws(() => verifyDenied({ status: 403, error: null,
    data: { message: manifest.roots[1].sentinelSystemName } }, before, before, manifest.roots));
});

function physicalBaseline() {
  return manifest.roots.flatMap(root => [
    { database: root.database, table: 't_srfpsmodule', row: {
      PSMODULEID: root.sentinelId, PSSYSTEMID: root.logicalSystemId,
      PSMODULENAME: root.sentinelName, MODTAG: root.sentinelTag, EXTRA_COLUMN: null,
    } },
    { database: root.database, table: 't_srfpssystem', row: {
      PSSYSTEMID: root.logicalSystemId, PSSYSTEMNAME: root.sentinelSystemName,
      PSDEVSLNSYSID: root.rootId, PSSYSMODELINSTID: root.modelInstanceId,
      PSDEVCENTERID: root.centerId, PSDEVSLNID: root.schemeId, MODELVER: root.modelVersion,
      EXTRA_COLUMN: 'preserve',
    } },
  ]);
}

test('native execution refuses missing, extra, remapped or changed original physical sentinels', () => {
  assert.equal(verifyBaseline(manifest, physicalBaseline()), true);
  for (const mutate of [
    rows => { rows.pop(); },
    rows => { rows.push(structuredClone(rows[0])); },
    rows => { rows[0].row.MODTAG = 'dirty'; },
    rows => { rows[0].row.PSMODULENAME = manifest.roots[1].sentinelName; },
    rows => { rows[1].row.PSDEVSLNSYSID = manifest.roots[1].rootId; },
    rows => { rows[1].row.PSSYSMODELINSTID = manifest.roots[1].modelInstanceId; },
    rows => { rows[1].row.PSDEVCENTERID = manifest.roots[1].centerId; },
    rows => { rows[1].row.MODELVER += 1; },
  ]) {
    const rows = physicalBaseline();
    mutate(rows);
    assert.throws(() => verifyBaseline(manifest, rows));
  }
});

test('final restoration compares every column in both physical schemas including nulls and unrelated fields', () => {
  const baseline = physicalBaseline();
  assert.equal(verifyRestoration(baseline, structuredClone(baseline)), true);
  for (const index of [0, 1, 2, 3]) {
    const changed = structuredClone(baseline);
    changed[index].row.EXTRA_COLUMN = 'changed';
    assert.throws(() => verifyRestoration(baseline, changed));
  }
  assert.throws(() => verifyRestoration(baseline, baseline.slice(1)));
});

test('successful native reads require exact physical module and joined system sentinel, never an empty list', () => {
  const row = { psmoduleid: root.sentinelId, pssystemid: root.logicalSystemId,
    psmodulename: root.sentinelName, pssystemname: root.sentinelSystemName };
  assert.equal(verifyRead({ status: 200, error: null, data: [row] }, root, 'FETCH_CUR_SYS'), row);
  assert.equal(verifyRead({ status: 200, error: null, data: row }, root, 'GET'), row);
  for (const data of [[], [{ ...row, psmodulename: manifest.roots[1].sentinelName }],
    [{ ...row, pssystemname: manifest.roots[1].sentinelSystemName }],
    [{ ...row, pssystemid: 'forged' }]]) {
    assert.throws(() => verifyRead({ status: 200, error: null, data }, root, 'FETCH_CUR_SYS'));
  }
});

test('successful mutations affect only one case-owned module; every foreign row and all system columns remain equal', () => {
  const baseline = manifest.roots.flatMap(root => [
    { database: root.database, table: 't_srfpsmodule', row: { PSMODULEID: root.sentinelId, MODTAG: root.sentinelTag } },
    { database: root.database, table: 't_srfpssystem', row: {
      PSSYSTEMID: root.logicalSystemId, MODELVER: root.modelVersion, EXTRA_COLUMN: 'same',
    } },
  ]);
  const probe = { psmoduleid: `nf_${runId}_probe`, pssystemid: root.logicalSystemId, psmodulename: 'probe', modtag: 'new' };
  const created = [...structuredClone(baseline), { database: root.database, table: 't_srfpsmodule', row: {
    PSMODULEID: probe.psmoduleid, PSSYSTEMID: probe.pssystemid, PSMODULENAME: probe.psmodulename, MODTAG: probe.modtag,
  } }];
  created.find(row => row.database === root.database && row.table === 't_srfpssystem').row.MODELVER++;
  assert.doesNotThrow(() => verifyMutation(baseline, created, root, 'CREATE', probe));
  const updated = structuredClone(created);
  updated.at(-1).row.MODTAG = 'updated';
  updated.find(row => row.database === root.database && row.table === 't_srfpssystem').row.MODELVER++;
  assert.doesNotThrow(() => verifyMutation(created, updated, root, 'UPDATE', { ...probe, modtag: 'updated' }));
  const restored = structuredClone(baseline);
  restored.find(row => row.database === root.database && row.table === 't_srfpssystem').row.MODELVER += 3;
  assert.doesNotThrow(() => verifyMutation(updated, restored, root, 'REMOVE', probe));
  for (const index of [0, 1, 2, 3]) {
    const changed = structuredClone(created);
    changed[index].row.EXTRA_COLUMN = 'changed';
    assert.throws(() => verifyMutation(baseline, changed, root, 'CREATE', probe));
  }
  assert.throws(() => verifyMutation(baseline, created, manifest.roots[1], 'CREATE', probe));
});

test('server-generated IDs bind only the actual returned owned probe and never an existing row', () => {
  const probe = createModuleProbe(runId, root, 'crud-r1', '0123abcd');
  const data = { ...probe, psmoduleid: 'a'.repeat(31) };
  assert.equal(bindCreatedModule({ data }, probe, root, []), data.psmoduleid);
  for (const change of [
    d => { d.psmoduleid = 'foreign'; }, d => { d.codename = 'other'; },
    d => { d.pssystemid = 'other'; }, d => { d.psmodulename = 'other'; }, d => { d.modtag = 'other'; },
  ]) {
    const bad = { ...data };
    change(bad);
    assert.throws(() => bindCreatedModule({ data: bad }, probe, root, []));
  }
  assert.throws(() => bindCreatedModule({ data }, probe, root, [
    { database: root.database, table: 't_srfpsmodule', row: { PSMODULEID: data.psmoduleid } },
  ]));
});

test('native cleanup permits only explicitly counted model-version side effects, not arbitrary drift', () => {
  const baseline = physicalBaseline(), final = structuredClone(baseline);
  const modelVersionDeltas = Object.fromEntries(manifest.roots.map(root => [root.database, 3]));
  for (const row of final.filter(row => row.table === 't_srfpssystem')) row.row.MODELVER += 3;
  assert.doesNotThrow(() => verifyRestoration(baseline, final, { modelVersionDeltas }));
  assert.throws(() => verifyRestoration(baseline, final));
  for (const mutate of [
    rows => { rows[1].row.MODELVER++; }, rows => { rows[0].row.MODTAG = 'changed'; },
    rows => { rows[3].row.PSSYSTEMNAME = 'changed'; }, rows => { rows.pop(); },
  ]) {
    const bad = structuredClone(final);
    mutate(bad);
    assert.throws(() => verifyRestoration(baseline, bad, { modelVersionDeltas }));
  }
  assert.throws(() => verifyRestoration(baseline, final, { modelVersionDeltas: { foreign: 3 } }));
});
test('CLI is opt-in with no admin, shared DB, service URL or default deployment fallbacks', async () => {
  for (const args of [[], ['--run-id=f01006abcdef'], ['--modeldesign-url=http://127.0.0.1:32002'],
    ['--execute-owned-native-matrix', '--execute-owned-native-matrix'],
    ['--loginname=admin'], ['--deployment-input=x', '--deployment-input=y']]) {
    await assert.rejects(main(args));
  }
});

test('provider restart requires explicit mutation mode before any fixture or Docker access', async () => {
  await assert.rejects(executeOwnedMatrix({ restartOwnedProvider: true }), /active owned CRUD probe/);
  await assert.rejects(executeOwnedMatrix({ restartOwnedProvider: 'true' }));
});

test('MySQL restart requires explicit mutation mode before fixture or Docker access', async () => {
  await assert.rejects(executeOwnedMatrix({ restartOwnedMysql: true }), /active owned CRUD probe/);
  await assert.rejects(executeOwnedMatrix({ restartOwnedMysql: 'true' }));
});

test('short-lived actual tokens require normal relogin before expiry without changing server validity', () => {
  const token = exp => `header.${Buffer.from(JSON.stringify({ exp })).toString('base64url')}.signature`;
  assert.equal(requiresFreshBackendLogin(token(110), 100000), false);
  assert.equal(requiresFreshBackendLogin(token(105), 100000), true);
  assert.equal(requiresFreshBackendLogin(token(99), 100000), true);
  for (const value of ['bad', token('110'), token(0), token(null)]) {
    assert.throws(() => requiresFreshBackendLogin(value, 100000));
  }
});
