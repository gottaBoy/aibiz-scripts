import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createFixture } from '../prepare-run-owned-native-nonadmin-fixture.mjs';
import {
  A01_SOURCE_PATHS, a01InvalidRootRequest, createA01RootPlan, requestOwnedA01, runOwnedA01Checks,
  validateA01Request, verifyA01BackendToken, verifyA01Denial, verifyA01NativeSources, verifyA01PhysicalBaseline,
} from '../owned-a01-root-http.mjs';

const { manifest, credentials } = createFixture({ runId: 'abcdef012345', scenario: 'two-center',
  modelVersion: 816, uaaSchemaMode: 'legacy-views', passwordStorageMode: 'sm3', secret: () => 'a'.repeat(36) });
const clock = 1_800_000_000_000;
const jwt = (time = clock, serial = 1) => `e30.${Buffer.from(JSON.stringify({
  iat: Math.floor(time / 1000), exp: Math.floor(time / 1000) + 20, serial,
})).toString('base64url')}.c2ln`;
const root = manifest.roots[0];
const applicationContext = { system: 'ibizmodeling', organization: `${root.centerId}_org` };
const plan = createA01RootPlan(manifest);
const whitespace = plan.invalidRootCases.find(row => row.rootKind === 'whitespace' && row.accessAction === 'READ');
const spec = { ...a01InvalidRootRequest(manifest, whitespace), token: jwt(), applicationContext };
const response = (status, data, error = null) => ({ status, data, error, dispatched: true });
const encoded = value => value === null ? null : Buffer.from(String(value)).toString('hex').toUpperCase();
const physical = {
  encoding: 'every-physical-column-null-or-hex-cast-binary-v1', inventory: [],
  tables: manifest.roots.flatMap(root => [
    { database: root.database, table: 't_srfpsmodule', rows: [{
      psmoduleid: encoded(root.sentinelId), pssystemid: encoded(root.logicalSystemId),
      psmodulename: encoded(root.sentinelName), modtag: encoded(root.sentinelTag), untouched: encoded('before'),
    }] },
    { database: root.database, table: 't_srfpssystem', rows: [{
      PSSYSTEMID: encoded(root.logicalSystemId), PSSYSTEMNAME: encoded(root.sentinelSystemName),
      PSDEVSLNSYSID: encoded(root.rootId), PSDEVCENTERID: encoded(root.centerId),
      PSSYSMODELINSTID: encoded(root.modelInstanceId), PSDEVSLNID: encoded(root.schemeId), MODELVER: encoded(824),
    }] },
  ]),
};

test('actual source transport is String pkey to native AppContext and keeps the model authorization check', () => {
  const sources = Object.fromEntries(Object.entries(A01_SOURCE_PATHS).map(([key, path]) =>
    [key, readFileSync(new URL(`../../ibiz-service-hub/${path}`, import.meta.url), 'utf8')]));
  assert.equal(verifyA01NativeSources(sources), true);
  for (const [field, before, after] of [
    ['handler', '@PathVariable(name = "pkey") String pkey', '@RequestBody Object root'],
    ['binding', 'iAppContext.set(iDEServiceAPIRSRuntime.getMajorDEServiceAPIRuntime().getName(), strParentKey)', 'iAppContext.set("PSDEVSLNSYS", "fallback")'],
    ['rootAccess', 'root instanceof String', 'root != null'],
  ]) assert.throws(() => verifyA01NativeSources({ ...sources, [field]: sources[field].replaceAll(before, after) }));
});

test('the runner consumes all original 84 logical cases and blocks 48 nonrepresentable cases without fake HTTP', () => {
  assert.deepEqual(plan.counts, { planned: 84, representable: 36, blocked: 48 });
  assert.equal(plan.invalidRootCases.length, 84);
  assert.equal(plan.invalidRootCases.filter(row => a01InvalidRootRequest(manifest, row)).length, 36);
  for (const row of plan.invalidRootCases.filter(row => !a01InvalidRootRequest(manifest, row))) {
    assert.ok(['absent', 'null', 'empty', 'number-zero'].includes(row.rootKind));
    assert.equal(row.executionStatus, 'blocked-native-transport');
    assert.equal(row.httpBindingVerified, false);
  }
  assert.equal(plan.fullA01Acceptance, false);
  const sameCenter = createFixture({ runId: manifest.runId, scenario: 'same-center',
    modelVersion: 816, uaaSchemaMode: 'legacy-views', passwordStorageMode: 'sm3', secret: () => 'b'.repeat(36) }).manifest;
  assert.deepEqual(createA01RootPlan(sameCenter).counts, plan.counts);
  for (const mutate of [
    row => { row.appContext.PSDEVSLNSYS = 'null'; },
    row => { row.principal.personId = manifest.users[1].personId; },
    row => { row.accessAction = 'DELETE'; },
  ]) {
    const row = structuredClone(whitespace); mutate(row);
    assert.throws(() => a01InvalidRootRequest(manifest, row));
  }
});

test('malformed URL roots are encoded exactly once and only exact owned native READ/UPDATE specs may fetch', () => {
  assert.ok(spec.path.includes(`${root.rootId}%20/psmodules/fetchcursys`));
  assert.equal(spec.method, 'POST');
  assert.equal(validateA01Request(manifest, spec), true);
  for (const mutate of [
    s => { s.path = s.path.replace('%20', ''); },
    s => { s.path = s.path.replace('%20', '%2520'); },
    s => { s.path += '?trymode=true'; },
    s => { s.path = s.path.replace(root.rootId, '../shared'); },
    s => { s.method = 'DELETE'; }, s => { s.peer = 'uaa'; },
    s => { s.data.PSDEVSLNSYS = null; },
    s => { s.headers = { PSDEVSLNSYS: null }; },
    s => { s.applicationContext.root = null; },
    s => { s.applicationContext.organization = 'foreign'; },
    s => { s.token = 'forged'; },
  ]) {
    const changed = structuredClone(spec); mutate(changed);
    assert.throws(() => validateA01Request(manifest, changed));
  }
});

test('transport sends actual malformed paths without arbitrary root headers and refuses redirect/invalid JSON', async () => {
  const context = { manifest, guard: () => ({ origins: { backend: 'http://10.91.0.9:30086' } }) };
  let calls = 0;
  const result = await requestOwnedA01(context, spec, {
    now: () => clock, fetchImplementation: async (url, options) => {
      calls++;
      assert.ok(url.includes(`${root.rootId}%20/psmodules/fetchcursys`));
      assert.deepEqual(Object.keys(options.headers).sort(),
        ['accept', 'authorization', 'content-type', 'srforgid', 'srfsystemid']);
      assert.equal(options.redirect, 'manual');
      assert.equal(options.method, 'POST');
      assert.deepEqual(JSON.parse(options.body), spec.data);
      return Response.json({ message: 'Denied' }, { status: 403 });
    },
  });
  assert.equal(calls, 1); assert.equal(result.status, 403); assert.equal(result.dispatched, true);
  for (const reply of [
    new Response(null, { status: 302, headers: { location: 'http://other' } }),
    new Response('html', { headers: { 'content-type': 'text/html' } }),
    new Response('{bad', { headers: { 'content-type': 'application/json' } }),
    new Response('x'.repeat(2 * 1024 * 1024 + 1), { headers: { 'content-type': 'application/json' } }),
  ]) {
    const failed = await requestOwnedA01(context, spec, { now: () => clock, fetchImplementation: async () => reply });
    assert.notEqual(failed.error, null);
  }
  await assert.rejects(requestOwnedA01(context, { ...spec, path: '/admin' }, {
    now: () => clock, fetchImplementation: () => assert.fail('bad route must not fetch'),
  }));
  let issued = 0;
  await assert.rejects(requestOwnedA01({
    ...context, guard: () => { throw new Error('changed peer'); },
  }, spec, { now: () => clock, fetchImplementation: () => { issued++; } }));
  await assert.rejects(requestOwnedA01(context, spec, {
    now: () => clock + 16_000, fetchImplementation: () => { issued++; },
  }));
  assert.equal(issued, 0, 'Peer drift/aged token must stop dispatch, never produce client-side denial evidence');
});

test('denial evidence requires actual HTTP and unchanged full-column data; 404/500/401 never prove invalid-root denial', () => {
  assert.equal(verifyA01PhysicalBaseline(manifest, physical), true);
  for (const status of [400, 403, 422]) {
    const outcome = verifyA01Denial(manifest, response(status, { message: 'Denied' }), physical, physical, { invalidRoot: true });
    assert.equal(outcome, status === 403 ? 'authorization-denied' : 'input-rejected');
  }
  for (const status of [null, 200, 204, 301, 401, 404, 429, 500]) {
    assert.throws(() => verifyA01Denial(manifest, response(status, null), physical, physical, { invalidRoot: true }));
  }
  for (const failed of [
    { ...response(403, null), dispatched: false },
    response(403, { name: manifest.roots[1].sentinelName }),
    response(403, { token: 'not-permitted' }), response(403, null, 'timeout'),
    response(403, { details: { user: { id: manifest.users[0].personId } } }),
  ]) assert.throws(() => verifyA01Denial(manifest, failed, physical, physical, { invalidRoot: true }));
  const changed = structuredClone(physical);
  changed.tables[0].rows[0].untouched = encoded('write');
  assert.throws(() => verifyA01Denial(manifest, response(403, null), physical, changed));
  assert.throws(() => verifyA01Denial(manifest, response(400, null), physical, physical));
  assert.throws(() => verifyA01Denial(manifest, response(403, null), physical, physical, { anonymous: true }));
});

function fixture({ deniedStatus = 403, crossStatus = 403, anonymousStatus = 401, empty = false,
  mutate = false, advanceClock = false, drift = false } = {}) {
  let time = clock;
  let serial = 0;
  let mutationRequested = false;
  let guarded = 0;
  const tokens = new Map();
  const requests = [];
  const context = { manifest, credentials, guard() {
    guarded++;
    if (drift && mutationRequested) throw new Error('source or peer changed');
    return { origins: { backend: 'http://10.91.0.9:30086' } };
  } };
  const identity = user => ({ id: user.personId, dc: user.centerId, organization_id: `${user.centerId}_org`,
    adminmode: 0, grants: [{ system_id: 'ibizmodeling', deploy_system_id: `${user.centerId}_deploy`,
      roles: [{ authority: 'ROLE_NATIVE_FIXTURE', role_id: `${user.centerId}_ordinary_role` }] }] });
  const authenticate = async (_context, spec) => {
    requests.push(spec);
    if (spec.path.endsWith('/login')) {
      const user = manifest.users.find(user => user.loginname === spec.data.loginname);
      assert.equal(spec.data.password, credentials.users[user.loginname]);
      const token = jwt(time, ++serial); tokens.set(token, user);
      return response(200, { token, user: identity(user) });
    }
    const user = tokens.get(spec.token); assert.ok(user);
    if (spec.path === '/auths/user-info/self') return response(200, identity(user));
    if (spec.path === '/uaa/oauth/userinfo') return response(200, { sub: user.loginname });
    assert.equal(spec.path, '/appdata');
    return response(200, { context: { srfsystemid: 'ibizmodeling', srforgid: `${user.centerId}_org`,
      srfuserid: user.personId, srfpersonid: user.personId, srfdcid: user.centerId } });
  };
  const send = async (_context, spec) => {
    validateA01Request(manifest, spec); requests.push(spec);
    if (!spec.token) return response(anonymousStatus, null);
    const user = tokens.get(spec.token); assert.ok(user);
    verifyA01BackendToken(spec.token, time);
    assert.deepEqual(spec.applicationContext,
      { system: 'ibizmodeling', organization: `${user.centerId}_org` });
    const parent = decodeURIComponent(spec.path.split('/psdevslnsys/')[1].split('/')[0]);
    const root = manifest.roots.find(root => root.rootId === parent);
    if (advanceClock) time += 16_000;
    if (!root) {
      mutationRequested = true;
      return response(deniedStatus, null);
    }
    if (root.rootId !== user.rootId || user.role === 'no-access') return response(crossStatus, null);
    return response(200, empty ? null : { psmoduleid: root.sentinelId, pssystemid: root.logicalSystemId,
      psmodulename: root.sentinelName, pssystemname: root.sentinelSystemName });
  };
  const snapshot = async () => {
    const value = structuredClone(physical);
    if (mutate && mutationRequested) value.tables[0].rows[0].untouched = encoded('write');
    return value;
  };
  return { context, snapshot, send, authenticate, now: () => time, requests, guarded: () => guarded };
}

test('six actors really dispatch 36 logical invalidRootCases and 16 anonymous/own/foreign controls, never blocked typed cases', async () => {
  const state = fixture();
  const report = await runOwnedA01Checks({ ...state, allowDeniedUpdates: true });
  assert.equal(report.status, 'passed-bounded-native-string-roots-partial-a01');
  assert.equal(report.boundedRepresentableRootAcceptance, true);
  assert.equal(report.invalidRootCases.filter(row => row.executionStatus === 'passed-http').length, 36);
  assert.equal(report.invalidRootCases.filter(row => row.executionStatus === 'blocked-native-transport').length, 48);
  assert.equal(report.controls.length, 16);
  assert.equal(report.controls.filter(row => row.outcome === 'allowed-source-sentinel').length, 4);
  assert.equal(report.controls.filter(row => row.outcome === 'authorization-denied').length, 8);
  assert.equal(report.controls.filter(row => row.outcome === 'authentication-denied').length, 4);
  assert.equal(state.requests.filter(request => request.method === 'PUT').length, 18);
  assert.equal(report.authentication.length, 30);
  assert.ok(report.authentication.every(row => row.status === 'passed'));
  assert.equal(report.fullA01Acceptance, false); assert.equal(report.typedRootHTTPAcceptance, false);
  assert.equal(report.nativeAcceptance, false); assert.equal(report.permissionAcceptance, false);
  assert.ok(report.invalidRootCases.filter(row => row.httpStatus).every(row => row.dispatched));
  assert.ok(!JSON.stringify(report).includes(credentials.users[manifest.users[0].loginname]));
  assert.ok(!JSON.stringify(report).includes('e30.'));
});

test('input rejection is distinct from permission proof and normal login renews unchanged twenty-second tokens', async () => {
  const state = fixture({ deniedStatus: 400, advanceClock: true });
  const report = await runOwnedA01Checks({ ...state, allowDeniedUpdates: true });
  assert.equal(report.boundedRepresentableRootAcceptance, true);
  assert.equal(report.invalidRootCases.filter(row => row.outcome === 'input-rejected').length, 36);
  assert.ok(report.authentication.some(row => row.id.includes('renewal')));
  assert.ok(state.requests.every(request => !request.path.includes('refresh_token')));
  const long = `e30.${Buffer.from(JSON.stringify({ iat: clock / 1000, exp: clock / 1000 + 3600 })).toString('base64url')}.c2ln`;
  assert.throws(() => verifyA01BackendToken(long, clock));
  assert.throws(() => verifyA01BackendToken(jwt(), clock + 16_000));
});

test('wrong statuses, empty control, mutations and source drift cannot pass; UPDATE attempts need explicit opt-in', async () => {
  for (const options of [{ deniedStatus: 401 }, { deniedStatus: 404 }, { deniedStatus: 500 }, { crossStatus: 400 },
    { anonymousStatus: 403 }, { empty: true }, { mutate: true }, { drift: true }]) {
    const report = await runOwnedA01Checks({ ...fixture(options), allowDeniedUpdates: true });
    assert.equal(report.status, 'failed-owned-a01-http');
    assert.equal(report.boundedRepresentableRootAcceptance, false);
  }
  const state = fixture();
  await assert.rejects(runOwnedA01Checks(state));
  assert.equal(state.requests.length, 0);
});
