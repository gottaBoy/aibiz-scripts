import assert from 'node:assert/strict';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import test from 'node:test';
import { createFixture } from '../prepare-run-owned-native-nonadmin-fixture.mjs';
import {
  javaProperties, probeUaaHttp, runtimeConfiguration, UAA_ENTRYPOINT,
  UAA_CONSOLE_LOGGING, UAA_JAVA_OPTIONS,
  privateContainerOrigin, verifyCandidate, verifyOwnedNetwork, verifyProbeContainer,
  securityTokenVariants, signedMacToken, tamperTokenSignature, parseJavaProperties, verifyNoDeniedIdentity,
} from '../harness-run-owned-uaa-runtime.mjs';

const fixture = createFixture({ runId: '123456789abc', passwordStorageMode: 'sm3', modelVersion: 1 });
const manifest = fixture.manifest;
const account = { uaa: {
  'spring.datasource.username': 'nf_123456789abc_uaa_app',
  'spring.datasource.password': '1'.repeat(36),
  'spring.datasource.defaultSchema': manifest.schemas.uaa,
  'spring.datasource.url': `jdbc:mysql://${manifest.ownership.mysqlContainer}:3306/${manifest.schemas.uaa}?useUnicode=true&characterEncoding=UTF-8&useSSL=false`,
} };

test('native UAA configuration uses only scoped SQL/Redis and disables sync/discovery', () => {
  const values = runtimeConfiguration(manifest, account, 'nf-123456789abc-uaa-r1-redis', 'a'.repeat(64));
  assert.equal(values['spring.datasource.username'], account.uaa['spring.datasource.username']);
  assert.equal(values['spring.datasource.isSyncDBSchema'], false);
  assert.equal(values['spring.datasource.dynamic.datasource.master.isSyncDBSchema'], false);
  assert.equal(values['spring.liquibase.enabled'], false);
  assert.equal(values['ibiz.auth.passwordStorageMode'], 'sm3');
  assert.equal(values['ibiz.ref.service.rt.version'], 'ISOLATED_NATIVE_NO_SYNC');
  assert.equal(values['spring.cloud.nacos.config.enabled'], false);
  assert.equal(values['spring.cloud.nacos.discovery.enabled'], false);
  assert.equal(values['spring.profiles.active'], 'isolated-native');
  assert.equal(values['spring.redis.host'], 'nf-123456789abc-uaa-r1-redis');
  assert.equal(values['server.port'], 32666);
});

test('early JVM bootstrap is isolated and logging cannot write to the read-only image', () => {
  for (const key of ['spring.cloud.bootstrap.enabled', 'spring.cloud.nacos.config.enabled',
    'spring.cloud.nacos.discovery.enabled', 'spring.cloud.discovery.enabled', 'eureka.client.enabled']) {
    assert.ok(UAA_JAVA_OPTIONS.split(' ').includes(`-D${key}=false`));
  }
  assert.ok(UAA_JAVA_OPTIONS.includes('-Dlogging.config=file:/opt/uaa/config/logback.xml'));
  assert.ok(UAA_JAVA_OPTIONS.split(' ').includes('-Dcom.sun.xml.bind.v2.bytecode.ClassTailor.noOptimize=true'));
  assert.ok(UAA_CONSOLE_LOGGING.includes('ch.qos.logback.core.ConsoleAppender'));
  assert.ok(!UAA_CONSOLE_LOGGING.includes('FileAppender'));
});

for (const [name, change] of [
  ['shared database user', a => { a.uaa['spring.datasource.username'] = 'root'; }],
  ['foreign schema', a => { a.uaa['spring.datasource.defaultSchema'] = 'shared'; }],
  ['shared JDBC host', a => { a.uaa['spring.datasource.url'] = 'jdbc:mysql://mysql/shared'; }],
]) {
  test(`runtime configuration rejects ${name}`, () => {
    const bad = structuredClone(account);
    change(bad);
    assert.throws(() => runtimeConfiguration(manifest, bad, 'nf-123456789abc-uaa-r1-redis', 'a'.repeat(64)));
  });
}

test('runtime configuration rejects a foreign cache and malformed signing secret', () => {
  assert.throws(() => runtimeConfiguration(manifest, account, 'nf-000000000000-uaa-r1-redis', 'a'.repeat(64)));
  assert.throws(() => runtimeConfiguration(manifest, account, 'nf-123456789abc-uaa-r1-redis', 'default'));
});

test('properties preserve JDBC syntax, escape backslashes and reject line injection', () => {
  assert.equal(javaProperties({ url: 'jdbc:x?x=1&y=2', path: 'x\\y', flag: false }),
    'flag=false\npath=x\\\\y\nurl=jdbc:x?x=1&y=2\n');
  assert.throws(() => javaProperties({ a: 'ok\nspring.datasource.username=root' }));
  assert.throws(() => javaProperties({ 'a=b': 'x' }));
  assert.throws(() => javaProperties({ a: null }));
});

test('properties parser rejects malformed and duplicate entries without accepting comments as data', () => {
  assert.deepEqual(parseJavaProperties(
    '# comment\n! another comment\nalpha=one\\\\two\nbeta=two\n'), {
    alpha: 'one\\two',
    beta: 'two',
  });
  assert.throws(() => parseJavaProperties('alpha=one\nalpha=two\n'));
  assert.throws(() => parseJavaProperties('alpha:one\n'));
  assert.throws(() => parseJavaProperties('alpha=one\nnot a property\n'));
});

const imageId = `sha256:${'1'.repeat(64)}`;
const buildHash = '2'.repeat(64);
const sourceHash = '3'.repeat(64);
function candidate() {
  const report = {
    contract: 'standalone-uaa-recovered-source-runtime-packaging-v1',
    status: 'runtime-image-byte-bound-not-started-not-native-accepted',
    nativeAcceptance: false, sourceClosureVerified: false, errors: [],
    image: { id: imageId }, inputBuild: { sha256: buildHash }, sourceFingerprint: sourceHash,
    binding: { actual: [{ path: 'packages/a.jar', sha256: sourceHash }],
      expected: [{ path: 'packages/a.jar', sha256: sourceHash }] },
  };
  const image = { Id: imageId, Config: { Entrypoint: [...UAA_ENTRYPOINT], User: '65532:65532',
    Labels: { 'aibiz.source-build-receipt-sha256': buildHash, 'aibiz.source-fingerprint': sourceHash } } };
  return { report, image };
}
test('candidate byte-binding can select a probe but cannot claim complete acceptance', () => {
  const { report, image } = candidate();
  verifyCandidate(report, image);
  report.nativeAcceptance = true;
  assert.throws(() => verifyCandidate(report, image));
});
for (const [name, change] of [
  ['moved image', v => { v.image.Id = `sha256:${'4'.repeat(64)}`; }],
  ['wrong entrypoint', v => { v.image.Config.Entrypoint = ['java', '-jar', 'prebuilt.jar']; }],
  ['wrong source label', v => { v.image.Config.Labels['aibiz.source-fingerprint'] = buildHash; }],
  ['different runtime bytes', v => { v.report.binding.actual[0].sha256 = buildHash; }],
  ['empty runtime inventory', v => { v.report.binding.actual = []; v.report.binding.expected = []; }],
]) {
  test(`candidate selection rejects ${name}`, () => {
    const value = candidate();
    change(value);
    assert.throws(() => verifyCandidate(value.report, value.image));
  });
}

test('owned network preflight rejects extra peers or non-private networking', () => {
  const resources = { runId: manifest.runId, networkId: 'net' };
  const network = { Id: 'net', Name: manifest.ownership.network, Internal: true, Driver: 'bridge',
    Labels: { 'aibiz.native-fixture.run': manifest.runId }, Containers: { mysql: {} } };
  verifyOwnedNetwork(manifest, resources, network, ['mysql']);
  assert.throws(() => verifyOwnedNetwork(manifest, resources,
    { ...network, Containers: { mysql: {}, shared: {} } }, ['mysql']));
  assert.throws(() => verifyOwnedNetwork(manifest, resources, { ...network, Internal: false }, ['mysql']));
});

test('probe container identity rejects shared network and non-loopback publications', () => {
  const expected = { imageId, runId: manifest.runId, networkId: 'net', networkName: 'private', name: 'owned' };
  const container = { Name: '/owned', Image: imageId, State: { Running: true },
    Config: { Labels: { 'aibiz.native-fixture.run': manifest.runId } },
    HostConfig: { Privileged: false, ReadonlyRootfs: true, SecurityOpt: ['no-new-privileges'],
      PortBindings: { '32666/tcp': [{ HostIp: '127.0.0.1', HostPort: '1234' }] } },
    NetworkSettings: { Networks: { private: { NetworkID: 'net' } } } };
  verifyProbeContainer(container, expected);
  const shared = structuredClone(container);
  shared.NetworkSettings.Networks.shared = { NetworkID: 'shared' };
  assert.throws(() => verifyProbeContainer(shared, expected));
  container.HostConfig.PortBindings['32666/tcp'][0].HostIp = '0.0.0.0';
  assert.throws(() => verifyProbeContainer(container, expected));
});

function privateTransport() {
  const containerId = 'a'.repeat(64);
  const endpointId = 'b'.repeat(64);
  const container = {
    Id: containerId, Name: '/owned', HostConfig: { PortBindings: {} },
    NetworkSettings: { Ports: { '32666/tcp': null }, Networks: { private: {
      IPAddress: '172.28.0.9', NetworkID: 'net', EndpointID: endpointId,
      IPPrefixLen: 16, Gateway: '172.28.0.1',
    } } },
  };
  const network = {
    Id: 'net', Name: 'private', Internal: true, Driver: 'bridge',
    IPAM: { Config: [{ Subnet: '172.28.0.0/16', Gateway: '172.28.0.1' }] },
    Containers: { [containerId]: {
      Name: 'owned', EndpointID: endpointId, IPv4Address: '172.28.0.9/16',
    } },
  };
  return { container, network };
}
test('private origin is derived from the exact owned endpoint without host publication', () => {
  const { container, network } = privateTransport();
  assert.equal(privateContainerOrigin(container, network, 32666), 'http://172.28.0.9:32666');
});

test('internal bridge endpoint without a default gateway remains bound to the exact IPAM subnet', () => {
  const { container, network } = privateTransport();
  container.NetworkSettings.Networks.private.Gateway = '';
  assert.equal(privateContainerOrigin(container, network, 32666), 'http://172.28.0.9:32666');
  network.IPAM.Config[0].Subnet = '172.29.0.0/16';
  assert.throws(() => privateContainerOrigin(container, network, 32666));
});

for (const [name, change] of [
  ['foreign network', v => { v.container.NetworkSettings.Networks.private.NetworkID = 'shared'; }],
  ['second network', v => { v.container.NetworkSettings.Networks.shared = {}; }],
  ['non-internal network', v => { v.network.Internal = false; }],
  ['unknown container', v => { v.container.Id = 'c'.repeat(64); }],
  ['endpoint substitution', v => { v.network.Containers[v.container.Id].EndpointID = 'd'.repeat(64); }],
  ['address substitution', v => { v.network.Containers[v.container.Id].IPv4Address = '172.28.0.8/16'; }],
  ['invalid address', v => { v.container.NetworkSettings.Networks.private.IPAddress = 'not-an-ip'; }],
  ['ambiguous address', v => { v.container.NetworkSettings.Networks.private.IPAddress = '172.028.0.9'; }],
  ['public address', v => { v.container.NetworkSettings.Networks.private.IPAddress = '8.8.8.8'; }],
  ['foreign subnet', v => { v.network.IPAM.Config[0].Subnet = '172.29.0.0/16'; }],
  ['gateway endpoint', v => {
    v.container.NetworkSettings.Networks.private.IPAddress = '172.28.0.1';
    v.network.Containers[v.container.Id].IPv4Address = '172.28.0.1/16';
  }],
  ['host publication', v => {
    v.container.HostConfig.PortBindings['32666/tcp'] = [{ HostIp: '127.0.0.1', HostPort: '32666' }];
  }],
]) {
  test(`private transport rejects ${name}`, () => {
    const value = privateTransport();
    change(value);
    assert.throws(() => privateContainerOrigin(value.container, value.network, 32666));
  });
}

test('HTTP evidence rejects 500 password failures and identity-less 200 responses without storing tokens', async t => {
  const server = createServer((req, res) => {
    res.setHeader('content-type', 'application/json');
    res.statusCode = req.method === 'POST' ? 500 : 200;
    res.end(JSON.stringify(req.method === 'POST' ? { error: 'SQL failed' } : { token: 'secret' }));
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const checks = await probeUaaHttp(`http://127.0.0.1:${server.address().port}`, manifest, fixture.credentials);
  assert.equal(checks.length, 13);
  assert.ok(checks.every(row => row.status === 'fail'));
  assert.ok(!JSON.stringify(checks).includes('secret'));
});

const jwtSecret = 'a'.repeat(64);
const tokenTime = 1791295200;
const originalClaims = { sub: 'fixture-user|fixture-center', iat: tokenTime - 60, exp: tokenTime + 7200 };

function decodeToken(token) {
  const [header, payload, signature] = token.split('.');
  return {
    header: JSON.parse(Buffer.from(header, 'base64url')),
    claims: JSON.parse(Buffer.from(payload, 'base64url')),
    signature: Buffer.from(signature, 'base64url'),
    input: `${header}.${payload}`,
  };
}

test('security control preserves exact issued JWT bytes and never manufactures an expiry token', () => {
  const token = signedMacToken(jwtSecret, originalClaims);
  const variants = securityTokenVariants(token, jwtSecret, tokenTime);
  const valid = decodeToken(variants.valid);
  const tampered = decodeToken(variants.tampered);
  assert.equal(variants.valid, token);
  assert.equal(valid.header.alg, 'HS512');
  assert.ok(timingSafeEqual(valid.signature, createHmac('sha512', jwtSecret).update(valid.input).digest()));
  assert.deepEqual(valid.claims, originalClaims);
  assert.equal(variants.expiresAt, originalClaims.exp);
  assert.equal(Object.hasOwn(variants, 'expired'), false);
  assert.deepEqual(tampered.claims, valid.claims);
  assert.equal(tampered.input, valid.input);
  assert.ok(!timingSafeEqual(tampered.signature, valid.signature));
});

for (const [name, token, secret] of [
  ['wrong signing key', signedMacToken(jwtSecret, originalClaims), 'b'.repeat(64)],
  ['bad signature', tamperTokenSignature(signedMacToken(jwtSecret, originalClaims)), jwtSecret],
  ['already expired baseline', signedMacToken(jwtSecret, { ...originalClaims, exp: tokenTime }), jwtSecret],
  ['future issue time', signedMacToken(jwtSecret, { ...originalClaims, iat: tokenTime + 1 }), jwtSecret],
  ['missing subject', signedMacToken(jwtSecret, { ...originalClaims, sub: null }), jwtSecret],
  ['malformed token', 'not-a-token', jwtSecret],
]) {
  test(`security variants reject ${name}`, () => {
    assert.throws(() => securityTokenVariants(token, secret, tokenTime));
  });
}

test('token signer rejects a foreign algorithm or malformed key', () => {
  assert.throws(() => signedMacToken(jwtSecret, originalClaims, { alg: 'none' }));
  assert.throws(() => signedMacToken('default', originalClaims));
});

async function securityServer(t, mode = 'correct') {
  const store = new Map();
  let loginCount = 0;
  const identity = user => ({ id: user.personId, dc: user.centerId, grants: [{
    system_id: 'ibizmodeling', deploy_system_id: `${user.centerId}_deploy`,
    roles: [{ authority: 'ROLE_NATIVE_FIXTURE', role_id: `${user.centerId}_ordinary_role` }],
  }] });
  const leak = mode.startsWith('denial-leak:') ? mode.slice('denial-leak:'.length) : null;
  const server = createServer(async (req, res) => {
    res.setHeader('content-type', 'application/json');
    const send = (status, data) => { res.statusCode = status; res.end(JSON.stringify(data)); };
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks)) : {};
    if (req.method === 'POST') {
      const user = manifest.users.find(row => row.loginname === body.loginname);
      if (!user || body.password !== fixture.credentials.users[user.loginname]) {
        send(400, leak ? { error: 'denied', payload: { [leak]: 'private' } } : { error: 'denied' });
        return;
      }
      const now = Math.floor(Date.now() / 1000);
      const token = signedMacToken(jwtSecret, {
        sub: `${user.loginname}|${user.centerId}`, iat: now, exp: now + 2, jti: String(++loginCount),
      });
      store.set(token, { user, expiresAt: (now + 2) * 1000 });
      const loginUser = identity(user);
      if (mode === 'login-superuser') loginUser.superuser = 1;
      if (mode === 'login-foreign-grant') loginUser.grants[0].deploy_system_id = 'foreign_deploy';
      if (mode === 'login-admin-role') loginUser.grants[0].roles[0].authority = 'ROLE_SUPERADMIN';
      send(200, { token, user: loginUser });
      return;
    }
    const token = req.headers.authorization?.replace(/^Bearer /, '');
    if (!token) {
      send(401, leak ? { error: 'denied', payload: { [leak]: 'private' } } : { error: 'denied' });
      return;
    }
    const parsed = decodeToken(token);
    const now = Math.floor(Date.now() / 1000);
    const expected = createHmac('sha512', jwtSecret).update(parsed.input).digest();
    const signed = parsed.signature.length === expected.length && timingSafeEqual(parsed.signature, expected);
    const negative = !signed || parsed.claims.exp <= now;
    if (negative && mode === 'server-error') { send(500, { error: 'broken' }); return; }
    if (negative && mode === 'identity-leak') { send(401, { grants: ['private-role'] }); return; }
    if (!store.has(token)) { send(401, { error: 'not stored' }); return; }
    if ((!signed && mode !== 'accept-tampered' && mode !== 'store-lookup-only')
      || (parsed.claims.exp <= now && mode !== 'accept-expired' && mode !== 'store-lookup-only')) {
      send(401, { error: 'denied' });
      return;
    }
    if (mode === 'reject-control' && parsed.claims.jti === '7') {
      send(401, { error: 'positive control rejected' });
      return;
    }
    const user = manifest.users.find(row => `${row.loginname}|${row.centerId}` === parsed.claims.sub);
    if (!user) { send(401, { error: 'denied' }); return; }
    send(200, identity(user));
  });
  t.after(() => new Promise(resolve => server.close(resolve)));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return {
    origin: `http://127.0.0.1:${server.address().port}`,
    options: {
      jwtSecret, maxExpiryWaitMs: 5000,
      securityStore: {
        async read(token) {
          const value = store.get(token);
          return { tokenSha256: createHash('sha256').update(token).digest('hex'),
            stored: !!value, expiresAt: value?.expiresAt,
            authenticationUsername: value ? `${value.user.loginname}|${value.user.centerId}` : null };
        },
        async storeVariant(issued, variant) {
          const value = store.get(issued);
          assert.ok(value);
          if (mode !== 'unstored-negative') store.set(variant, { ...value, expiresAt: Date.now() + 60000 });
        },
        async retain(token) {
          assert.ok(store.has(token));
          store.get(token).expiresAt = Date.now() + 60000;
          if (mode === 'expiry-store-removed') store.delete(token);
        },
      },
    },
  };
}

test('security HTTP probe records sixteen checks without retaining secrets or signed token bytes', async t => {
  const { origin, options } = await securityServer(t);
  const checks = await probeUaaHttp(origin, manifest, fixture.credentials, undefined, options);
  assert.equal(checks.length, 16);
  assert.ok(checks.every(row => row.status === 'pass'));
  assert.deepEqual(checks.slice(-3).map(row => row.id), [
    'signed-security-positive-control', 'tampered-signature-token-denied', 'expired-signed-token-denied',
  ]);
  const json = JSON.stringify(checks);
  assert.ok(!json.includes(jwtSecret));
  assert.ok(!json.includes('eyJ'));
  for (const password of Object.values(fixture.credentials.users)) assert.ok(!json.includes(password));
});

for (const [mode, failedId] of [
  ['reject-control', 'signed-security-positive-control'],
  ['accept-expired', 'expired-signed-token-denied'],
  ['accept-tampered', 'tampered-signature-token-denied'],
  ['server-error', 'expired-signed-token-denied'],
  ['identity-leak', 'tampered-signature-token-denied'],
  ['unstored-negative', 'tampered-signature-token-denied'],
  ['expiry-store-removed', 'expired-signed-token-denied'],
  ['store-lookup-only', 'expired-signed-token-denied'],
]) {
  test(`security HTTP evidence fails closed for ${mode}`, async t => {
    const { origin, options } = await securityServer(t, mode);
    const checks = await probeUaaHttp(origin, manifest, fixture.credentials, undefined, options);
    assert.equal(checks.length, 16);
    assert.ok(checks.slice(0, 13).every(row => row.status === 'pass'));
    assert.equal(checks.find(row => row.id === failedId).status, 'fail');
    if (mode === 'reject-control') assert.ok(checks.slice(-3).every(row => row.status === 'fail'));
  });
}

test('retained long-TTL replay cannot earn signature or expiry acceptance without an owned store witness', async t => {
  const { origin } = await securityServer(t);
  const checks = await probeUaaHttp(origin, manifest, fixture.credentials, undefined, { jwtSecret });
  assert.ok(checks.slice(0, 14).every(row => row.status === 'pass'));
  assert.ok(checks.slice(-2).every(row => row.status === 'fail'));
});

for (const mode of ['login-superuser', 'login-foreign-grant', 'login-admin-role']) {
  test(`login cannot hide ${mode} behind a normal self response`, async t => {
    const { origin } = await securityServer(t, mode);
    const checks = await probeUaaHttp(origin, manifest, fixture.credentials);
    assert.ok(checks.filter(row => row.id.endsWith('-login-and-self')).every(row => row.status === 'fail'));
  });
}

for (const key of ['id', 'dc', 'roles', 'adminmode', 'superuser', 'super_user', 'user_id',
  'person_id', 'access_token', 'refresh_token', 'organization_id']) {
  test(`anonymous/password denial rejects nested ${key} leakage`, async t => {
    assert.throws(() => verifyNoDeniedIdentity({ problem: [{ [key]: null }] }));
    const { origin } = await securityServer(t, `denial-leak:${key}`);
    const checks = await probeUaaHttp(origin, manifest, fixture.credentials);
    assert.equal(checks[0].status, 'fail');
    assert.ok(checks.filter(row => row.id.endsWith('-wrong-password-denied'))
      .every(row => row.status === 'fail'));
  });
}

test('standard nonidentity problem responses remain allowed', () => {
  verifyNoDeniedIdentity({ status: 401, type: 'about:blank', title: 'Unauthorized', detail: 'Denied' });
  verifyNoDeniedIdentity(null);
});
