import assert from 'node:assert/strict';
import test from 'node:test';
import {
  extendOwnedPlatformRouting, ownedAuthenticationOriginContent, verifyOwnedRefreshDenial,
} from '../harness-owned-native-platform.mjs';

const name = 'nf-f01006abcdef-backend-current-allinone';

test('platform configuration is routed to the exact owned service without rewrites or fabricated data', () => {
  const original = { deployapps: [], routes: [
    { id: 'existing-model', uri: 'http://owned-provider:32002', filters: ['existing-model-filter'] },
  ] };
  const before = structuredClone(original);
  const result = extendOwnedPlatformRouting(original, name);
  assert.deepEqual(original, before);
  assert.deepEqual(result.routes[0], original.routes[0]);
  assert.equal(result.routes.length, 2);
  assert.equal(result.routes[1].uri, `http://${name}:30000`);
  assert.deepEqual(result.routes[1].predicates, [{ name: 'Path', args: {
    _genkey_0: '/configs/**', _genkey_1: '/dictionaries/**',
  } }]);
  assert.deepEqual(result.routes[1].filters, []);
  assert.equal(result.routes[1].order, 3);
  assert.deepEqual(extendOwnedPlatformRouting(result, name), result);
  assert.ok(!Object.values(result.routes[1].predicates[0].args).includes('/**'));
});

test('foreign service names and altered existing routes cannot be adopted', () => {
  for (const invalid of ['ibiz-ebsx-allinone', 'http://shared', '../escape', 'nf_f01006abcdef-uaa']) {
    assert.throws(() => extendOwnedPlatformRouting({ routes: [] }, invalid));
  }
  const original = extendOwnedPlatformRouting({ routes: [] }, name);
  for (const change of [
    row => { row.uri = 'http://shared:30000'; },
    row => { row.filters = ['ignore-auth']; },
    row => { row.predicates[0].args._genkey_0 = '/**'; },
    row => { row.order = 0; },
  ]) {
    const altered = structuredClone(original);
    change(altered.routes[0]);
    assert.throws(() => extendOwnedPlatformRouting(altered, name));
  }
});

test('invalid refresh 5xx, redirects, identity leakage and transport errors never count as denials', () => {
  for (const status of [400, 401, 403]) {
    assert.doesNotThrow(() => verifyOwnedRefreshDenial({ status, error: null, data: { message: 'denied' } }));
  }
  for (const status of [200, 204, 302, 404, 500, 503, null]) {
    assert.throws(() => verifyOwnedRefreshDenial({ status, error: null, data: null }));
  }
  assert.throws(() => verifyOwnedRefreshDenial({ status: 401, error: 'timeout', data: null }));
  assert.throws(() => verifyOwnedRefreshDenial({ status: 401, error: null, data: { token: 'private' } }));
});

test('authentication rebinding changes only the reviewed owned UAA service origin', () => {
  const runId = 'f01006abcdef';
  const original = { serviceurl: `http://nf-${runId}-uaa-original:32666`, accesstokenurl: '/auths/login' };
  const content = `---\n${JSON.stringify(original)}\n`;
  const options = { runId, content, origin: 'http://10.91.0.4:32666' };
  assert.deepEqual(JSON.parse(ownedAuthenticationOriginContent(options).slice(4)), {
    ...original, serviceurl: options.origin,
  });
  for (const origin of ['http://127.0.0.1:32666', 'http://8.8.8.8:32666', 'http://10.91.0.4:30000']) {
    assert.throws(() => ownedAuthenticationOriginContent({ ...options, origin }));
  }
  for (const value of [
    { ...original, serviceurl: 'http://shared:32666' },
    { ...original, accesstokenurl: '/bypass' },
    { ...original, skipAuth: true },
  ]) {
    assert.throws(() => ownedAuthenticationOriginContent({
      ...options, content: `---\n${JSON.stringify(value)}\n`,
    }));
  }
});
