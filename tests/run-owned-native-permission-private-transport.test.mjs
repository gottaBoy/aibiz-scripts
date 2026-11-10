import assert from 'node:assert/strict';
import test from 'node:test';
import { createFixture } from '../prepare-run-owned-native-nonadmin-fixture.mjs';
import {
  request, validateDeployment, validateEndpoint, validatePrivateEndpoint, validateRequestPath,
} from '../run-owned-native-permission-http.mjs';

const runId = 'f01006abcdef';
const { manifest } = createFixture({
  runId, scenario: 'two-center', passwordStorageMode: 'sm3', modelVersion: 816,
  uaaSchemaMode: 'legacy-views', secret: () => '1'.repeat(36),
});
const id = number => number.toString(16).padStart(64, '0');
const image = number => `sha256:${id(number)}`;

function topology() {
  const resources = {
    contract: 'run-owned-native-fixture-resources-v1', runId, mysqlId: id(1), networkId: id(2),
    mysqlImage: image(3), mysqlName: manifest.ownership.mysqlContainer,
    networkName: manifest.ownership.network, schemas: manifest.schemas,
  };
  const roles = ['mysql', 'allinone', 'gateway', 'provider', 'uaa'];
  const network = {
    Id: resources.networkId, Name: resources.networkName, Internal: true, Driver: 'bridge',
    Labels: { [manifest.ownership.label]: runId }, IPAM: { Config: [
      { Subnet: '172.28.0.0/16', Gateway: '172.28.0.1' },
    ] }, Containers: {},
  };
  const containers = roles.map((role, index) => {
    const container = {
      Id: role === 'mysql' ? resources.mysqlId : id(index + 3),
      Name: role === 'mysql' ? `/${resources.mysqlName}` : `/nf-${runId}-${role}`,
      Image: role === 'mysql' ? resources.mysqlImage : image(index + 10),
      State: { Running: true }, Config: { Labels: { [manifest.ownership.label]: runId } }, Mounts: [],
      HostConfig: { Privileged: false, PortBindings: {}, ...(role === 'mysql'
        ? { Tmpfs: { '/var/lib/mysql': 'rw,nosuid,nodev,size=1073741824' } } : {}) },
      NetworkSettings: { Ports: null, Networks: {
        [network.Name]: { NetworkID: network.Id, EndpointID: id(index + 20),
          IPAddress: `172.28.0.${index + 2}`, IPPrefixLen: 16, Gateway: '172.28.0.1' },
      } },
    };
    const attachment = container.NetworkSettings.Networks[network.Name];
    network.Containers[container.Id] = { Name: container.Name.slice(1), EndpointID: attachment.EndpointID,
      IPv4Address: `${attachment.IPAddress}/16` };
    if (role === 'mysql') container.NetworkSettings.Ports = { '3306/tcp': null };
    return container;
  });
  const services = Object.fromEntries(roles.slice(1).map((role, index) => [
    role, { containerId: containers[index + 1].Id, imageId: containers[index + 1].Image },
  ]));
  const endpoint = role => {
    const target = containers.find(row => row.Id === services[role].containerId);
    const attachment = target.NetworkSettings.Networks[network.Name];
    return { transport: 'private-inspected-ipv4', service: role, containerPort: role === 'uaa' ? 32666 : 30086,
      containerId: target.Id, networkId: network.Id, endpointId: attachment.EndpointID, ipv4: attachment.IPAddress };
  };
  const deployment = {
    contract: 'run-owned-native-permission-deployment-input-v2', runId, services,
    endpoints: { uaa: endpoint('uaa'), backend: endpoint('gateway') },
  };
  const imageReceipt = {
    contract: 'isolated-backend-source-images-v1', status: 'passed-image-artifact-binding-only',
    imageArtifactBindingVerified: true,
    components: ['allinone', 'gateway', 'provider'].map(name => ({ name, image: { id: services[name].imageId } })),
  };
  const target = containers.at(-1);
  const attachment = target.NetworkSettings.Networks[network.Name];
  const peer = network.Containers[target.Id];
  return { resources, services, deployment, containers, network, imageReceipt,
    endpoint: deployment.endpoints.uaa, target, attachment, peer };
}

test('v2 derives exact unpublished private UAA/gateway IP origins from inspect without a supplied URL', () => {
  const t = topology();
  assert.deepEqual(validateDeployment(manifest, t.resources, t.deployment, t.containers, t.network, t.imageReceipt),
    { uaa: 'http://172.28.0.6:32666', backend: 'http://172.28.0.4:30086' });
  assert.equal(validatePrivateEndpoint(t.endpoint, t.services, t.containers, t.network), 'http://172.28.0.6:32666');
});

test('private mode accepts Docker internal-bridge empty attachment gateways but rejects stale non-empty gateways', () => {
  const t = topology();
  t.attachment.Gateway = '';
  assert.equal(validatePrivateEndpoint(t.endpoint, t.services, t.containers, t.network),
    'http://172.28.0.6:32666');
  t.attachment.Gateway = '172.28.0.9';
  assert.throws(() => validatePrivateEndpoint(t.endpoint, t.services, t.containers, t.network),
    /Attachment gateway/);
});

test('private mode is never a v1 fallback and v2 must explicitly select transports', () => {
  const t = topology();
  t.deployment.contract = 'run-owned-native-permission-deployment-input-v1';
  assert.throws(() => validateDeployment(manifest, t.resources, t.deployment, t.containers, t.network, t.imageReceipt),
    /explicit v2/);
  assert.throws(() => validateEndpoint(t.endpoint, t.services, t.containers, t.network), /explicit v2/);
  t.deployment.contract = 'run-owned-native-permission-deployment-input-v2';
  delete t.endpoint.transport;
  assert.throws(() => validateDeployment(manifest, t.resources, t.deployment, t.containers, t.network, t.imageReceipt),
    /explicitly select/);
});

test('private binding rejects stale IDs, IPs, endpoints, names, ports, images and ambiguous peer data', () => {
  for (const mutate of [
    t => { t.endpoint.origin = 'http://172.28.0.6:32666'; },
    t => { t.endpoint.containerId = id(90); },
    t => { t.endpoint.networkId = id(90); },
    t => { t.endpoint.endpointId = id(90); },
    t => { t.endpoint.ipv4 = '172.28.0.90'; },
    t => { t.endpoint.containerPort = 3306; },
    t => { t.endpoint.service = 'provider'; },
    t => { t.attachment.NetworkID = id(90); },
    t => { t.attachment.EndpointID = id(90); },
    t => { t.peer.EndpointID = id(90); },
    t => { t.peer.Name = 'shared-uaa'; },
    t => { t.peer.IPv4Address = '172.28.0.6/24'; },
    t => { delete t.network.Containers[t.target.Id]; },
    t => { t.target.State.Running = false; },
    t => { t.target.Image = image(90); },
    t => { t.target.NetworkSettings.Networks.shared = {}; },
    t => { t.network.Internal = false; },
    t => { t.network.Driver = 'host'; },
    t => { t.containers.push(t.target); },
  ]) {
    const t = topology();
    mutate(t);
    assert.throws(() => validatePrivateEndpoint(t.endpoint, t.services, t.containers, t.network));
  }
});

test('IPAM rejects non-private, ambiguous, out-of-subnet, network, broadcast and gateway addresses', () => {
  for (const address of [
    '8.8.8.8', '169.254.1.2', '127.0.0.1', '0.0.0.0', '172.15.0.6', '172.32.0.6',
    '172.29.0.6', '172.28.0.0', '172.28.255.255', '172.28.0.1', '0172.28.0.6', '::1',
    'http://172.28.0.6', '172.28.0.6.example',
  ]) {
    const t = topology();
    t.endpoint.ipv4 = t.attachment.IPAddress = address;
    t.peer.IPv4Address = `${address}/16`;
    assert.throws(() => validatePrivateEndpoint(t.endpoint, t.services, t.containers, t.network), address);
  }
  for (const mutate of [
    t => { t.network.IPAM.Config = []; },
    t => { t.network.IPAM.Config.push(t.network.IPAM.Config[0]); },
    t => { t.network.IPAM.Config[0].Subnet = '172.28.0.6/16'; },
    t => { t.network.IPAM.Config[0].Subnet = '172.28.0.0/24'; },
    t => { t.network.IPAM.Config[0].Gateway = '172.28.0.2'; },
    t => { t.attachment.IPPrefixLen = '16'; },
    t => { t.attachment.IPPrefixLen = 32; },
  ]) {
    const t = topology();
    mutate(t);
    assert.throws(() => validatePrivateEndpoint(t.endpoint, t.services, t.containers, t.network));
  }
});

test('publications are forbidden in private mode even if requested bindings have no inspected publication', () => {
  for (const field of ['HostConfig', 'NetworkSettings']) {
    for (const binding of [[], [{ HostIp: '127.0.0.1', HostPort: '33361' }], [{ HostIp: '0.0.0.0', HostPort: '33361' }]]) {
      const t = topology();
      t.target[field][field === 'HostConfig' ? 'PortBindings' : 'Ports'] = { '32666/tcp': binding };
      assert.throws(() => validatePrivateEndpoint(t.endpoint, t.services, t.containers, t.network));
    }
  }
});

test('path contract accepts only native auth and root-scoped module routes, never URLs/query/encoded traversal', () => {
  assert.equal(validateRequestPath({ method: 'POST', path: '/auths/login' }), true);
  assert.equal(validateRequestPath({ method: 'GET', path: '/auths/user-info/self' }), true);
  assert.equal(validateRequestPath({ method: 'POST', path: '/v7/login' }), true);
  assert.equal(validateRequestPath({ method: 'GET', path: '/uaa/oauth/userinfo' }), true);
  assert.equal(validateRequestPath({ method: 'POST',
    path: `/api/ibizmodeling__modeldesign/psdevslnsys/${manifest.roots[0].rootId}/psmodules/fetchcursys` }), true);
  for (const path of ['http://shared/', '//shared', '/auths/login?next=shared', '/auths/login#shared',
    '/appdata', '/auths/../admin', '/auths\\login', '/%61uths/login',
    '/api/ibizmodeling__modeldesign/psdevslnsys/../psmodules',
    '/api/ibizmodeling__modeldesign/psdevslnsys/%2e%2e/psmodules']) {
    assert.throws(() => validateRequestPath({ method: 'POST', path }), path);
  }
  assert.throws(() => validateRequestPath({ method: 'GET', path: '/auths/login' }));
});

test('appdata and model requests accept only the two normal application context headers', async () => {
  const applicationContext = { system: 'ibizmodeling', organization: `nf_${runId}_center_a_org` };
  const spec = { method: 'GET', path: '/appdata', applicationContext };
  assert.equal(validateRequestPath(spec), true);
  let calls = 0;
  await request('http://172.28.0.4:30086', spec, 'signed-token', {
    fetchImplementation: async (_url, options) => {
      calls++;
      assert.deepEqual(options.headers, { accept: 'application/json', 'content-type': 'application/json',
        authorization: 'Bearer signed-token', srfsystemid: 'ibizmodeling', srforgid: applicationContext.organization });
      return new Response('{}', { headers: { 'content-type': 'application/json' } });
    },
  });
  assert.equal(calls, 1);
  for (const context of [null, { ...applicationContext, apiuser: 1 },
    { ...applicationContext, system: 'ibizplm' },
    { ...applicationContext, organization: 'foreign\r\nsuperuser:1' }]) {
    assert.throws(() => validateRequestPath({ ...spec, applicationContext: context }));
  }
  for (const path of ['/auths/login', '/uaa/oauth/userinfo', '/v7/login']) {
    assert.throws(() => validateRequestPath({ method: path.endsWith('userinfo') ? 'GET' : 'POST',
      path, applicationContext }));
  }
  assert.throws(() => validateRequestPath({ method: 'GET', path: '/appdata' }));
});

test('HTTP redirects cannot forward passwords/tokens; invalid paths do not initiate fetch', async () => {
  for (const status of [301, 302, 303, 307, 308]) {
    let calls = 0;
    const result = await request('http://172.28.0.6:32666', { method: 'POST', path: '/auths/login', data: { password: 'private' } },
      'private-token', { fetchImplementation: async (url, options) => {
        calls++;
        assert.equal(url, 'http://172.28.0.6:32666/auths/login');
        assert.equal(options.redirect, 'manual');
        return new Response(null, { status, headers: { location: 'http://shared/' } });
      } });
    assert.equal(calls, 1);
    assert.equal(result.status, status);
    assert.equal(result.error, 'redirect-refused');
  }
  await assert.rejects(() => request('http://172.28.0.6:32666', { method: 'POST', path: '//shared/' }, null,
    { fetchImplementation: () => assert.fail('must not fetch') }));
});
