import assert from 'node:assert/strict';
import test from 'node:test';
import { ownedPlatformRequest, validateOwnedPlatformRequest } from '../owned-platform-http.mjs';

const runId = 'f01006abcdef';
const uuid = '12345678-1234-4321-8888-123456789abc';
const context = {
  manifest: { runId, users: [{ centerId: `nf_${runId}_center_a` }] },
  guard: () => ({ origins: { backend: 'http://10.91.0.9:30086', uaa: 'http://10.91.0.4:32666' } }),
};

test('owned platform HTTP selects only reviewed auth, fixture-root and case-owned configuration paths', () => {
  for (const [peer, path, method] of [
    ['uaa', '/auths/login', 'POST'], ['uaa', '/auths/user-info/self', 'GET'],
    ['backend', '/v7/login', 'POST'], ['backend', `/uaa/refresh_token/${uuid}`, 'GET'],
    ['uaa', `/auths/${uuid}/refresh_token`, 'GET'],
    ['backend', '/uaa/getbydcsystem/ibizmodeling', 'GET'],
    ['backend', '/appdata/ibizmodeling', 'GET'],
    ['backend', `/configs/customtheme/nf_${runId}_platform_123456abcdef?share=false`, 'PUT'],
    ['backend', '/api/ibizmodeling__modeldesign/pspfs/fetchdefault', 'POST'],
    ['backend', '/api/ibizmodeling__modeldesign/pspfstyles/fetchdefault', 'POST'],
    ['backend', '/api/ibizmodeling__modeldesign/psapptypes/fetchdefault', 'POST'],
    ['backend', `/api/ibizmodeling__modeldesign/psdevslnsys/nf_${runId}_root_a/psmodules/fetchcursys`, 'POST'],
  ]) assert.doesNotThrow(() => validateOwnedPlatformRequest(runId, peer, path, method));
  for (const path of [
    'http://shared/', '//shared', '/auths/../admin', `/uaa/refresh_token/${uuid}?redirect=shared`,
    `/configs/customtheme/nf_${runId}_platform_123456abcdef?share=true`,
    '/configs/customtheme/shared?share=false',
    `/api/ibizmodeling__modeldesign/psdevslnsys/nf_other_root_a/psmodules/fetchcursys`,
    '/api/ibizmodeling__modeldesign/psmodules/fetchcursys',
    '/api/ibizmodeling__modeldesign/pspfs/fetchdefault',
    '/api/ibizmodeling__modeldesign/pspfstyles/fetchdefault?x=1',
    '/api/ibizmodeling__modeldesign/psapptypes/fetchdefault',
    '/uaa/getbydcsystem/shared', '/appdata/ibizplm',
    '/uaa/getbydcsystem/ibizmodeling?system=shared',
  ]) assert.throws(() => validateOwnedPlatformRequest(runId, 'backend', path, 'GET'));
  assert.throws(() => validateOwnedPlatformRequest(runId, 'uaa', '/v7/login', 'POST'));
  assert.throws(() => validateOwnedPlatformRequest(runId, 'backend', '/v7/login', 'GET'));
  assert.throws(() => validateOwnedPlatformRequest(runId, 'backend', '/appdata/ibizmodeling', 'PUT'));
});

test('every HTTP request is gated and redirects cannot forward tokens', async () => {
  let calls = 0;
  const response = await ownedPlatformRequest(context, {
    peer: 'backend', path: '/v7/login', method: 'POST', data: { private: 'not-in-report' },
  }, { fetchImplementation: async (_url, options) => {
    calls++;
    assert.equal(options.redirect, 'manual');
    return new Response('', { status: 302, headers: { location: 'http://shared' } });
  } });
  assert.equal(calls, 1);
  assert.equal(response.error, 'redirect-refused');
  assert.ok(!JSON.stringify(response).includes('not-in-report'));
  await assert.rejects(ownedPlatformRequest({ ...context, guard() { throw new Error('drift'); } },
    { peer: 'backend', path: '/v7/login', method: 'POST' },
    { fetchImplementation: async () => { calls++; } }), /drift/);
  assert.equal(calls, 1);
});

test('only verified organization/system headers and valid token syntax reach HTTP', async () => {
  const applicationContext = { system: 'ibizmodeling', organization: `nf_${runId}_center_a_org` };
  const response = await ownedPlatformRequest(context, {
    peer: 'backend', path: '/appdata', token: 'header.payload.signature', applicationContext,
  }, { fetchImplementation: async (_url, options) => {
    assert.equal(options.headers.srforgid, applicationContext.organization);
    assert.equal(options.headers.srfsystemid, 'ibizmodeling');
    assert.equal(options.headers.authorization, 'Bearer header.payload.signature');
    assert.equal(Object.keys(options.headers).length, 5);
    return Response.json({ ok: true });
  } });
  assert.deepEqual(response.data, { ok: true });
  for (const bad of [{ ...applicationContext, apiuser: 1 },
    { ...applicationContext, organization: 'foreign' }, { ...applicationContext, system: 'ibizplm' }]) {
    await assert.rejects(ownedPlatformRequest(context, {
      peer: 'backend', path: '/appdata', applicationContext: bad,
    }));
  }
  await assert.rejects(ownedPlatformRequest(context, {
    peer: 'backend', path: '/appdata', token: 'token\r\ninjection',
  }));
});

test('empty real configuration and invalid JSON remain distinguishable', async () => {
  const spec = { peer: 'backend', path: '/uaa/oauth/userinfo' };
  assert.equal((await ownedPlatformRequest(context, spec, {
    fetchImplementation: async () => new Response('', { status: 200 }),
  })).data, null);
  assert.equal((await ownedPlatformRequest(context, spec, {
    fetchImplementation: async () => new Response('<html>not-json</html>', { status: 200 }),
  })).error, 'transport-or-json-error');
});
