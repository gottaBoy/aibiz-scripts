import assert from 'node:assert/strict';
import test from 'node:test';
import { authenticateNativeMqtt } from '../mqtt-native-auth-adapter.mjs';

const own = `/s${'a'.repeat(32)}/e${'b'.repeat(32)}`;
const token = claims => `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;
const claims = { sub: 'real-login', organizationId: 'real-org', exp: 2000 };
const credentials = { username: own, password: token(claims) };
function fixture(change) {
  const calls = [];
  return {
    calls,
    read: async (suffix, headers) => {
      calls.push({ suffix, headers });
      const result = suffix === '/uaa/oauth/userinfo'
        ? { status: 200, data: { sub: claims.sub } }
        : { status: 200, data: { mqtttopic: own,
          context: { srfsystemid: 'ibizplm', srforgid: claims.organizationId, srfloginname: claims.sub } } };
      return change ? change(suffix, result) : result;
    },
  };
}

test('native token must pass real Bearer self and appdata with its signed organization', async () => {
  const f = fixture();
  const result = await authenticateNativeMqtt(credentials, f.read, 1000);
  assert.equal(result.result, 'allow');
  assert.equal(result.is_superuser, false);
  assert.equal(result.expire_at, claims.exp);
  assert.deepEqual(f.calls.map(row => Object.keys(row.headers)), [
    ['Authorization'], ['Authorization', 'srfsystemid', 'srforgid'],
  ]);
  assert.equal(f.calls[1].headers.srforgid, claims.organizationId);
  assert.deepEqual(result.acl.at(-1), { permission: 'deny', action: 'all', topic: '#' });
  assert.equal(result.acl.some(row => row.permission === 'allow' && row.action === 'publish'), false);
});

test('no platform request is sent for malformed, anonymous, expired or unsafe organization credentials', async () => {
  for (const input of [
    null, {}, { ...credentials, password: '' }, { ...credentials, username: '#' },
    { ...credentials, password: token({ ...claims, exp: 999 }) },
    { ...credentials, password: token({ ...claims, organizationId: 'x\\r\\nheader' }) },
  ]) {
    const f = fixture();
    assert.deepEqual(await authenticateNativeMqtt(input, f.read, 1000), { result: 'deny' });
    assert.equal(f.calls.length, 0);
  }
});

test('wrong token, cross user, cross organization and substituted topic all fail closed', async () => {
  for (const change of [
    (suffix, r) => suffix === '/uaa/oauth/userinfo' ? { status: 401, data: {} } : r,
    (suffix, r) => suffix === '/uaa/oauth/userinfo' ? { status: 200, data: { sub: 'other' } } : r,
    (suffix, r) => suffix === '/appdata' ? { ...r, data: { ...r.data, mqtttopic: own.replace(/b/g, 'c') } } : r,
    (suffix, r) => suffix === '/appdata'
      ? { ...r, data: { ...r.data, context: { ...r.data.context, srforgid: 'other-org' } } } : r,
    (suffix, r) => suffix === '/appdata'
      ? { ...r, data: { ...r.data, context: { ...r.data.context, srfloginname: 'other-user' } } } : r,
  ]) assert.deepEqual(await authenticateNativeMqtt(credentials, fixture(change).read, 1000), { result: 'deny' });
});

test('untrusted extension wildcard scopes and native query failures do not fall back to anonymous access', async () => {
  const f = fixture((suffix, value) => suffix === '/appdata'
    ? { ...value, data: { ...value.data, extmqtttopic: { log: '/foreign/#' } } } : value);
  assert.deepEqual(await authenticateNativeMqtt(credentials, f.read, 1000), { result: 'deny' });
  assert.deepEqual(await authenticateNativeMqtt(credentials, async () => { throw Error('offline'); }, 1000),
    { result: 'deny' });
});
