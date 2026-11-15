import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createFixture } from '../prepare-run-owned-native-nonadmin-fixture.mjs';
import {
  createModelContextPlan, requestOwnedModelContext, runOwnedModelContextChecks,
  validateModelContextRequest, verifyAnonymousModelContext, verifyIssuedModelContextToken, verifyModelContextResponse,
} from '../owned-model-context-http.mjs';

const { manifest, credentials } = createFixture({
  runId: 'abcdef012345', scenario: 'two-center', modelVersion: 816,
  uaaSchemaMode: 'legacy-views', passwordStorageMode: 'sm3', secret: () => 'a'.repeat(36),
});
const clock = 1_800_000_000_000;
const jwt = (time = clock, serial = 1, lifetime = 20, actor = user, extra = {}) => `e30.${Buffer.from(JSON.stringify({
  iat: Math.floor(time / 1000), exp: Math.floor(time / 1000) + lifetime, serial,
  sub: actor.loginname, username: actor.loginname, dc: actor.centerId, id: actor.personId,
  organizationId: `${actor.centerId}_org`, ...extra,
})).toString('base64url')}.c2ln`;
const root = manifest.roots[0];
const user = manifest.users.find(user => user.rootId === root.rootId && user.role === 'editor');
const applicationContext = { system: 'ibizmodeling', organization: `${user.centerId}_org` };
const response = (status, data, error = null) => ({ status, data, error, dispatched: true });
const appdata = user => ({ context: {
  srfsystemid: 'ibizmodeling', srforgid: `${user.centerId}_org`,
  srfuserid: user.personId, srfpersonid: user.personId, srfdcid: user.centerId,
} });
const identity = user => ({
  id: user.personId, dc: user.centerId, organization_id: `${user.centerId}_org`,
  adminmode: 0, grants: [{ system_id: 'ibizmodeling', deploy_system_id: `${user.centerId}_deploy`,
    roles: [{ authority: 'ROLE_NATIVE_FIXTURE', role_id: `${user.centerId}_ordinary_role` }] }],
});
const encode = value => Buffer.from(String(value)).toString('hex').toUpperCase();
const physical = {
  encoding: 'every-physical-column-null-or-hex-cast-binary-v1', inventory: [],
  tables: manifest.roots.flatMap(root => [
    { database: root.database, table: 't_srfpsmodule', rows: [{
      psmoduleid: encode(root.sentinelId), pssystemid: encode(root.logicalSystemId),
      psmodulename: encode(root.sentinelName), modtag: encode(root.sentinelTag), untouched: encode('before'),
    }] },
    { database: root.database, table: 't_srfpssystem', rows: [{
      pssystemid: encode(root.logicalSystemId), pssystemname: encode(root.sentinelSystemName),
      psdevslnsysid: encode(root.rootId), psdevcenterid: encode(root.centerId),
      pssysmodelinstid: encode(root.modelInstanceId), psdevslnid: encode(root.schemeId), modelver: encode(824),
    }] },
  ]),
};

test('the controlled plan has all six actors across both roots plus anonymous queries, not CRUD acceptance', () => {
  const plan = createModelContextPlan(manifest);
  assert.equal(plan.queries.length, 12);
  assert.equal(plan.queries.filter(row => row.expectedProjection).length, 4);
  assert.equal(plan.queries.filter(row => !row.expectedProjection).length, 8);
  assert.equal(plan.anonymous.length, 2);
  assert.equal(plan.nativeAcceptance, false);
  assert.equal(plan.fullAcceptance, false);
  assert.equal(plan.permissionAcceptance, false);
  assert.ok(plan.queries.every(row => row.expectedStatus === 200
    && row.path === `/ibizmodeling/appdata?psdevslnsys=${row.rootId}`));
  assert.ok(plan.anonymous.every(row => row.path === `/ibizmodeling/appdata?psdevslnsys=${row.rootId}`));
});

test('the metadata plan selects the maintained system controller and its existing query-to-context pipeline', () => {
  const read = path => readFileSync(new URL(`../../ibiz-service-hub/${path}`, import.meta.url), 'utf8');
  const controller = read('libs/ibiz-cloud-core/src/main/java/net/ibizsys/central/cloud/core/spring/controller/GatewayRestController.java');
  assert.ok(controller.includes('@GetMapping(value = {"/{systemid}/appdata","/{systemid}/appdata/{srfdcsystemid}"})'));
  assert.ok(controller.includes('this.systemGateway.invokeGetAppData(systemid, srfsystemid, srforgid, AuthenticationUser.getCurrentMust(), null)'));
  const service = read('libs/ibiz-cloud-core/src/main/java/net/ibizsys/central/cloud/core/ServiceSystemRuntime.java');
  assert.ok(service.includes('return getSystemAccessManager().getAppData(strSystemTag, strOrgId)'));
  const access = read('libs/ibiz-cloud-core/src/main/java/net/ibizsys/central/cloud/core/security/SystemAccessManagerBase.java');
  assert.ok(access.includes('strQueryString = httpServletRequest.getQueryString()'));
  assert.ok(access.includes('RestUtils.queryString2Map(strQueryString, true)'));
  assert.ok(access.includes('iAppContext.set(entry.getKey(), entry.getValue())'));
  const modeling = read('libs/ibiz-modeling-core/src/main/java/net/ibizsys/modeling/core/security/SystemAccessManagerBase.java');
  assert.ok(modeling.includes('this.prepareModelContext(appData, iPSDevUser, iPSDevSysUser)'));
  assert.ok(modeling.includes('appContext.get("PSDEVSLNSYS")'));
});

test('only exact owned root GET queries or normal auth are eligible, never bodies, root headers or foreign paths', () => {
  const spec = { peer: 'backend', method: 'GET', path: `/ibizmodeling/appdata?psdevslnsys=${root.rootId}`,
    token: jwt(), applicationContext };
  assert.equal(validateModelContextRequest(manifest, spec), true);
  assert.equal(validateModelContextRequest(manifest, {
    peer: 'backend', method: 'GET', path: spec.path,
  }), true);
  for (const mutate of [
    s => { s.path += '&pssystemid=foreign'; }, s => { s.path += '&psdevslnsys=foreign'; },
    s => { s.path = '/ibizmodeling/appdata?psdevslnsys=shared'; },
    s => { s.path = `/ibizmodeling/appdata?psdevslnsys=${root.rootId.toUpperCase()}`; },
    s => { s.path = `/appdata?psdevslnsys=${root.rootId}`; },
    s => { s.path = s.path.replace('=', '=%25'); },
    s => { s.path = '/appdata/ibizmodeling'; },
    s => { s.peer = 'uaa'; }, s => { s.method = 'POST'; },
    s => { s.data = { psdevslnsys: root.rootId }; }, s => { s.headers = { PSDEVSLNSYS: root.rootId }; },
    s => { s.token = 'not-a-token'; }, s => { s.applicationContext.organization = 'shared'; },
    s => { s.applicationContext.pssystemid = root.logicalSystemId; },
    s => { delete s.token; },
  ]) {
    const changed = structuredClone(spec); mutate(changed);
    assert.throws(() => validateModelContextRequest(manifest, changed));
  }
});

test('the controlled transport marks actual fetch dispatch and retains the native twenty-second/five-second margin', async () => {
  let calls = 0;
  const spec = { peer: 'backend', method: 'GET', path: `/ibizmodeling/appdata?psdevslnsys=${root.rootId}`,
    token: jwt(), applicationContext };
  const context = { manifest, guard: () => ({ origins: { backend: 'http://10.42.215.9:30086' } }) };
  const result = await requestOwnedModelContext(context, spec, {
    now: () => clock,
    fetchImplementation: async (url, options) => {
      calls++;
      assert.equal(url, `http://10.42.215.9:30086${spec.path}`);
      assert.equal(options.body, undefined);
      assert.equal(options.redirect, 'manual');
      assert.deepEqual(Object.keys(options.headers).sort(),
        ['accept', 'authorization', 'content-type', 'srforgid', 'srfsystemid']);
      return Response.json({ ...appdata(user),
        srfmodelcontext: { psdevslnsys: root.rootId, pssystemid: root.logicalSystemId } });
    },
  });
  assert.equal(result.dispatched, true);
  assert.equal(result.error, null);
  assert.equal(calls, 1);
  for (const bad of [jwt(clock, 1, 3600), jwt(clock - 16_000), jwt(clock + 20_000)]) {
    await assert.rejects(requestOwnedModelContext(context, { ...spec, token: bad }, {
      now: () => clock, fetchImplementation: () => assert.fail('Bad token must not dispatch'),
    }));
  }
  await assert.rejects(requestOwnedModelContext({
    ...context, guard: () => { throw new Error('Owned source/peer drift'); },
  }, spec, { now: () => clock, fetchImplementation: () => assert.fail('Drift must not dispatch') }),
  error => error.dispatched === false);
  const failed = await requestOwnedModelContext(context, spec, {
    now: () => clock, fetchImplementation: async () => { throw new Error('Controlled transport failure'); },
  });
  assert.equal(failed.dispatched, true);
  assert.equal(failed.error, 'transport-or-json-error');
});

test('real transport performs mounted-input guard before token readiness and cannot dispatch stale input', async () => {
  const events = [];
  const spec = { peer: 'backend', method: 'GET', path: `/ibizmodeling/appdata?psdevslnsys=${root.rootId}`,
    token: jwt(), applicationContext };
  await assert.rejects(requestOwnedModelContext({
    manifest, guard: () => assert.fail('The mounted HTTP guard is required'),
    guardForHTTP() { events.push('mounted-input-verification'); throw new Error('Changed model tree'); },
  }, spec, { now: () => clock,
    fetchImplementation: () => { events.push('dispatched'); assert.fail('Changed input cannot dispatch'); } }),
  error => error.dispatched === false);
  assert.deepEqual(events, ['mounted-input-verification']);
});

test('every new backend token binds all five exact actor fields and the unchanged native iat/exp contract', () => {
  assert.equal(verifyIssuedModelContextToken(jwt(), user, clock), true);
  for (const [key, expected] of Object.entries({
    sub: user.loginname, username: user.loginname, dc: user.centerId,
    id: user.personId, organizationId: `${user.centerId}_org`,
  })) {
    assert.ok(expected);
    for (const changed of [undefined, null, '', 'foreign', 1]) {
      assert.throws(() => verifyIssuedModelContextToken(jwt(clock, 1, 20, user, { [key]: changed }), user, clock));
    }
  }
  for (const token of [jwt(clock, 1, 21), jwt(clock + 2000), jwt(clock, 1, 20, user, { iat: 1.5 })]) {
    assert.throws(() => verifyIssuedModelContextToken(token, user, clock));
  }
  assert.equal(verifyIssuedModelContextToken(jwt(clock - 16_000), user, clock), true,
    'Issuance identity may be checked after a full snapshot; dispatch still separately requires its five-second margin');
});

test('response checks require exact two-field metadata for own readers and real absence for foreign/no-access', () => {
  const value = { ...appdata(user),
    srfmodelcontext: { psdevslnsys: root.rootId, pssystemid: root.logicalSystemId } };
  assert.equal(verifyModelContextResponse(response(200, value), user, root, applicationContext),
    'authorized-two-identifier-routing-metadata');
  for (const modify of [
    value => { delete value.srfmodelcontext; },
    value => { value.srfmodelcontext.secret = 'not-permitted'; },
    value => { value.srfmodelcontext.psdevslnsys = manifest.roots[1].rootId; },
    value => { value.srfmodelcontext.pssystemid = 'foreign'; },
    value => { value.srfmodelcontext.pssystemid = null; },
    value => { value.context.srfuserid = 'foreign'; },
  ]) {
    const changed = structuredClone(value); modify(changed);
    assert.throws(() => verifyModelContextResponse(response(200, changed), user, root, applicationContext));
  }
  for (const status of [401, 403, 404, 500]) {
    assert.throws(() => verifyModelContextResponse(response(status, value), user, root, applicationContext));
  }
  const foreign = manifest.roots[1];
  assert.equal(verifyModelContextResponse(response(200, appdata(user)), user, foreign, applicationContext),
    'authenticated-without-model-projection');
  assert.throws(() => verifyModelContextResponse(response(200, value), user, foreign, applicationContext));
  assert.throws(() => verifyModelContextResponse(response(200, {
    ...appdata(user), nested: { srfmodelcontext: value.srfmodelcontext },
  }), user, foreign, applicationContext));
  let getters = 0;
  const accessor = { ...appdata(user), srfmodelcontext: {
    psdevslnsys: root.rootId,
    get pssystemid() { getters++; return root.logicalSystemId; },
  } };
  assert.throws(() => verifyModelContextResponse(response(200, accessor), user, root, applicationContext));
  assert.equal(getters, 0);
});

test('anonymous metadata queries need a dispatched exact HTTP 401 without projection or identity leakage', () => {
  for (const status of [401]) {
    assert.equal(verifyAnonymousModelContext(response(status, { message: 'Unauthenticated' })),
      'anonymous-authentication-denied');
  }
  for (const status of [null, 200, 204, 301, 403, 404, 500]) {
    assert.throws(() => verifyAnonymousModelContext(response(status, null)));
  }
  for (const invalid of [
    { ...response(401, null), dispatched: false }, response(401, { srfmodelcontext: {} }),
    response(403, { nested: { user: { id: user.personId } } }), response(401, null, 'timeout'),
  ]) assert.throws(() => verifyAnonymousModelContext(invalid));
});

function controlled({
  snapshotMs = 0, requestMs = 0, queryMs = 0, mutate = false,
  guardMs = 0, mountedGuardMs = 0, dispatchGuardMs = 0, backendTokenClaims,
  queryStatus = 200, missingProjection = false, leak = false, anonymousStatus = 401,
  backendSelfStatus = 200, baseAppDataStatus = 200,
  failSnapshot = false, guardDrift = false, expireFirstQueryGuard = false,
  snapshotFailureMessage = 'Controlled complete snapshot failure',
} = {}) {
  let time = clock;
  let serial = 0;
  let queries = 0;
  let expiredQueryGuard = false;
  const tokens = new Map();
  const verifiedActors = new Map(manifest.users.map(user => [user.loginname, { self: false, appdata: false }]));
  const requests = [];
  const records = [];
  const events = [];
  const context = { manifest, credentials, guard() {
    time += guardMs;
    if (guardDrift && queries) throw new Error('Controlled source drift');
    return {};
  }, guardForHTTP() {
    time += dispatchGuardMs;
    return {};
  }, verifyMountedInputs() {
    time += mountedGuardMs;
  } };
  const send = async (_context, spec) => {
    validateModelContextRequest(manifest, spec);
    _context.guardForHTTP();
    if (spec.peer === 'backend' && spec.token &&
      JSON.parse(Buffer.from(spec.token.split('.')[1], 'base64url')).exp * 1000 - time <= 5000) {
      throw Object.assign(new Error('Controlled guarded dispatch margin exhausted'),
        { code: 'MODEL_CONTEXT_SESSION_NOT_READY', dispatched: false });
    }
    requests.push(spec);
    events.push({ kind: 'http', path: spec.path, atMs: time,
      ...(spec.peer === 'backend' && spec.token ? {
        remainingMs: JSON.parse(Buffer.from(spec.token.split('.')[1], 'base64url')).exp * 1000 - time,
      } : {}) });
    time += requestMs;
    if (spec.path.endsWith('/login')) {
      const actor = manifest.users.find(user => user.loginname === spec.data.loginname);
      assert.equal(spec.data.password, credentials.users[actor.loginname]);
      const token = jwt(time, ++serial, 20, actor,
        spec.peer === 'backend' ? backendTokenClaims?.({ actor, serial }) : {});
      tokens.set(token, actor);
      return response(200, { token, user: identity(actor) });
    }
    if (spec.path === '/auths/user-info/self') return response(200, identity(tokens.get(spec.token)));
    if (spec.path === '/uaa/oauth/userinfo') {
      const actor = tokens.get(spec.token);
      verifiedActors.get(actor.loginname).self = backendSelfStatus === 200;
      return response(backendSelfStatus, { sub: actor.loginname });
    }
    if (spec.path === '/appdata') {
      const actor = tokens.get(spec.token);
      assert.equal(verifiedActors.get(actor.loginname).self, true);
      verifiedActors.get(actor.loginname).appdata = baseAppDataStatus === 200;
      return response(baseAppDataStatus, appdata(actor));
    }
    assert.ok(spec.path.startsWith('/ibizmodeling/appdata?'));
    if (!spec.token) return response(anonymousStatus, null);
    if (expireFirstQueryGuard && !expiredQueryGuard) {
      expiredQueryGuard = true;
      time += 16_000;
      const error = Object.assign(new Error('Controlled native token margin consumed by guard'),
        { code: 'MODEL_CONTEXT_SESSION_NOT_READY', dispatched: false });
      requests.pop();
      events.pop();
      throw error;
    }
    const actor = tokens.get(spec.token);
    assert.deepEqual(verifiedActors.get(actor.loginname), { self: true, appdata: true },
      'Every actor must have normal backend self and base appdata verification before any queries');
    const selected = manifest.roots.find(root => spec.path === `/ibizmodeling/appdata?psdevslnsys=${root.rootId}`);
    const data = appdata(actor);
    if ((!missingProjection && actor.role !== 'no-access' && actor.rootId === selected.rootId) || leak) {
      data.srfmodelcontext = { psdevslnsys: selected.rootId, pssystemid: selected.logicalSystemId };
    }
    queries++;
    time += queryMs;
    return response(queryStatus, data);
  };
  const snapshot = async () => {
    if (failSnapshot && queries) throw new Error(snapshotFailureMessage);
    const start = time;
    time += snapshotMs;
    events.push({ kind: 'snapshot', startedAtMs: start, atMs: time });
    const value = structuredClone(physical);
    if (mutate && queries) value.tables[0].rows[0].untouched = encode('write');
    return value;
  };
  const record = async (name, value) => {
    records.push({ name, value });
    return { path: name, sha256: createHash('sha256').update(JSON.stringify(value)).digest('hex') };
  };
  return { context, send, snapshot, record, now: () => time, requests, records, events };
}

test('controlled runner checks all 12 actor/root queries and two anonymous refusals with full contiguous snapshots', async () => {
  const state = controlled();
  const report = await runOwnedModelContextChecks(state);
  assert.equal(report.status, 'passed-owned-routing-model-context-response-only');
  assert.equal(report.routingMetadataResponseAcceptance, true);
  assert.equal(Object.hasOwn(report, 'readonlyMetadataAcceptance'), false);
  assert.equal(report.acceptanceScope.physicalInvariance, 'two-model-schemas-only');
  for (const key of ['uaaSideEffectsUnverified', 'metadataSideEffectsUnverified', 'cacheSideEffectsUnverified']) {
    assert.equal(report.acceptanceScope[key], true);
  }
  assert.equal(report.queries.length, 12);
  assert.equal(report.anonymous.length, 2);
  assert.equal(report.authentication.length, 30);
  assert.equal(report.queries.filter(row => row.expectedProjection).length, 4);
  assert.equal(report.queries.filter(row => !row.expectedProjection).length, 8);
  assert.ok(report.queries.every(row => row.httpStatus === 200 && row.dispatched));
  assert.equal(report.snapshotSequence.length, state.requests.length + 2);
  assert.equal(report.physicalModelsUnchanged, true);
  for (const key of ['nativeAcceptance', 'fullAcceptance', 'permissionAcceptance',
    'tokenLifetimeChanged', 'sharedServicesChanged']) assert.equal(report[key], false);
  assert.ok(!JSON.stringify(report).includes('e30.'));
  assert.ok(!JSON.stringify(report).includes(credentials.users[user.loginname]));
  const checks = [...report.anonymous, ...report.authentication, ...report.queries]
    .sort((a, b) => Number(a.snapshotBoundary.after.id.slice(9)) - Number(b.snapshotBoundary.after.id.slice(9)));
  for (const [index, row] of checks.entries()) {
    assert.equal(row.snapshotBoundary.contiguousBeforeReuse, index > 0);
    if (index > 0) assert.deepEqual(row.snapshotBoundary.before, checks[index - 1].snapshotBoundary.after);
  }
  assert.equal(state.records.filter(row => row.name.includes('-snapshot.')).length, state.requests.length + 2);
  assert.equal(state.records.filter(row => row.name.includes('-http.')).length, state.requests.length);
});

test('slow controlled snapshots renew only through normal bare login after the actor identity chain, retaining native tokens', async () => {
  const state = controlled({ snapshotMs: 3000, requestMs: 100, queryMs: 4000 });
  const report = await runOwnedModelContextChecks(state);
  assert.equal(report.routingMetadataResponseAcceptance, true);
  assert.ok(report.authentication.some(row => row.id.includes('-renewal-')));
  assert.equal(state.requests.filter(row => row.path === '/auths/login').length, 6);
  assert.equal(state.requests.filter(row => row.path === '/auths/user-info/self').length, 6);
  assert.equal(state.requests.filter(row => row.path === '/uaa/oauth/userinfo').length, 6);
  assert.equal(state.requests.filter(row => row.path === '/appdata').length, 6);
  assert.ok(state.events.filter(row => row.kind === 'http' && row.remainingMs !== undefined)
    .every(row => row.remainingMs > 5000));
  assert.ok(report.snapshotSequence.every(row => row.capturedAtMs - row.startedAtMs === 3000));
  assert.ok(!state.requests.some(row => row.path.includes('refresh_token')));
});

test('unused post-authentication token freshness cannot turn three successful native dispatches into a response failure', async () => {
  const state = controlled({ snapshotMs: 4000, requestMs: 100 });
  const report = await runOwnedModelContextChecks(state);
  assert.equal(report.routingMetadataResponseAcceptance, true);
  assert.equal(report.queries.length, 12);
  assert.ok(report.authentication.some(row => row.id.includes('-renewal-')));
  assert.ok(state.events.filter(row => row.kind === 'http' && row.remainingMs !== undefined)
    .every(row => row.remainingMs > 5000));
});

test('guards consuming the native margin record a non-dispatched attempt and renew normally before retry', async () => {
  const state = controlled({ expireFirstQueryGuard: true });
  const report = await runOwnedModelContextChecks(state);
  assert.equal(report.routingMetadataResponseAcceptance, true);
  assert.equal(report.queries.length, 12);
  assert.equal(report.nonDispatchedAttempts.length, 1);
  assert.equal(report.nonDispatchedAttempts[0].dispatched, false);
  assert.ok(report.sessionRenewals.some(row => row.reason === 'native-margin-consumed-by-dispatch-guards'));
  assert.ok(report.queries.every(row => row.dispatched && row.status === 'passed'));
  assert.equal(report.snapshotSequence.length, state.requests.length + 2,
    'A known pre-dispatch refusal cannot break or invent a physical HTTP boundary');
});

test('realistic 2.8-second full snapshots and complete guards finish using normal bare-login renewal', async () => {
  const state = controlled({
    snapshotMs: 2800, requestMs: 100, guardMs: 700, mountedGuardMs: 2200, dispatchGuardMs: 2200,
  });
  const report = await runOwnedModelContextChecks(state);
  assert.equal(report.routingMetadataResponseAcceptance, true);
  assert.equal(report.queries.length, 12);
  assert.equal(report.anonymous.length, 2);
  assert.equal(state.requests.filter(row => row.path === '/auths/login').length, 6);
  assert.equal(state.requests.filter(row => row.path === '/auths/user-info/self').length, 6);
  assert.equal(state.requests.filter(row => row.path === '/uaa/oauth/userinfo').length, 6);
  assert.equal(state.requests.filter(row => row.path === '/appdata').length, 6);
  assert.ok(state.requests.filter(row => row.path === '/v7/login').length > 6);
  assert.ok(report.nonDispatchedAttempts.some(row => row.path === '/appdata'),
    'A real initial base-appdata preflight failure must renew rather than restart the identity chain');
  assert.ok(state.events.filter(row => row.kind === 'http' && row.remainingMs !== undefined)
    .every(row => row.remainingMs > 5000));
  assert.equal(report.snapshotSequence.length, state.requests.length + 2);
  assert.ok(report.snapshotSequence.every(row => row.capturedAtMs - row.startedAtMs === 2800));
  assert.equal(report.tokenLifetimeChanged, false);
});

test('a single snapshot beyond the native dispatch budget fails after bounded normal bare logins', async () => {
  const state = controlled({ snapshotMs: 16000 });
  const report = await runOwnedModelContextChecks(state);
  assert.equal(report.routingMetadataResponseAcceptance, false);
  assert.equal(report.status, 'failed-owned-model-context-http');
  assert.equal(report.failedStage.stage, 'backend-token-readiness');
  assert.equal(report.queries.length, 0);
  assert.equal(state.requests.filter(row => row.path === '/v7/login').length, 4);
  assert.ok(report.authentication.every(row => row.status === 'passed' && row.dispatched));
  assert.equal(report.tokenLifetimeChanged, false);
});

test('one guarded dispatch taking over fifteen seconds fails after three known non-dispatched attempts', async () => {
  const state = controlled({ dispatchGuardMs: 16000 });
  const report = await runOwnedModelContextChecks(state);
  assert.equal(report.routingMetadataResponseAcceptance, false);
  assert.equal(report.queries.length, 0);
  assert.equal(report.nonDispatchedAttempts.length, 3);
  assert.ok(report.nonDispatchedAttempts.every(row => row.path === '/uaa/oauth/userinfo' && !row.dispatched));
  assert.equal(state.requests.filter(row => row.path === '/v7/login').length, 3);
  assert.equal(state.requests.filter(row => row.path === '/uaa/oauth/userinfo').length, 0);
  assert.equal(report.tokenLifetimeChanged, false);
});

for (const [label, options] of [
  ['initial backend self', { backendSelfStatus: 403 }],
  ['initial base appdata', { baseAppDataStatus: 403 }],
  ['new login actor claims', { backendTokenClaims: () => ({ id: 'foreign' }) }],
]) {
  test(`no root queries run when ${label} fails`, async () => {
    const state = controlled(options);
    const report = await runOwnedModelContextChecks(state);
    assert.equal(report.routingMetadataResponseAcceptance, false);
    assert.equal(report.queries.length, 0);
    assert.equal(state.requests.filter(row => row.path.startsWith('/ibizmodeling/appdata?') && row.token).length, 0);
    assert.ok(report.authentication.some(row => row.status === 'failed' && row.dispatched));
  });
}

test('a bare renewal token with different actor claims fails before retrying the pending root query', async () => {
  const state = controlled({
    expireFirstQueryGuard: true,
    backendTokenClaims: ({ serial }) => serial > 2 ? { username: 'foreign' } : {},
  });
  const report = await runOwnedModelContextChecks(state);
  assert.equal(report.routingMetadataResponseAcceptance, false);
  assert.equal(report.queries.length, 0);
  assert.equal(report.nonDispatchedAttempts.length, 1);
  assert.equal(state.requests.filter(row => row.path === '/uaa/oauth/userinfo').length, 1);
  assert.equal(state.requests.filter(row => row.path === '/appdata').length, 1);
  assert.ok(report.authentication.some(row => row.id.includes('-renewal-') && row.status === 'failed'));
});

test('HTTP-stage failure diagnostics retain the private message/stack outside the public report fields', async () => {
  const secret = 'CONTROLLED-HTTP-PRIVATE-MARKER';
  const state = controlled({ failSnapshot: true, snapshotFailureMessage: secret });
  const report = await runOwnedModelContextChecks(state);
  assert.equal(report.routingMetadataResponseAcceptance, false);
  const diagnostic = state.records.find(row => row.name === 'failure.private.json');
  assert.ok(diagnostic);
  assert.equal(diagnostic.value.name, 'Error');
  assert.equal(diagnostic.value.message, secret);
  assert.match(diagnostic.value.stack, new RegExp(secret));
  assert.deepEqual(Object.keys(report.failureEvidence).sort(), ['path', 'sha256']);
  assert.equal(JSON.stringify(report).includes(secret), false);
});

for (const [name, options] of [
  ['authenticated 403 is not a successful absent projection', { queryStatus: 403 }],
  ['missing own projection', { missingProjection: true }],
  ['foreign/no-access projection leak', { leak: true }],
  ['anonymous empty success', { anonymousStatus: 200 }],
  ['anonymous authenticated-style 403', { anonymousStatus: 403 }],
  ['physical row mutation', { mutate: true }],
  ['after-HTTP complete snapshot failure', { failSnapshot: true }],
  ['after-HTTP source/peer drift', { guardDrift: true }],
]) {
  test(`controlled fail-closed runner rejects ${name} and retains the failing stage`, async () => {
    const state = controlled(options);
    const report = await runOwnedModelContextChecks(state);
    assert.equal(report.status, 'failed-owned-model-context-http');
    assert.equal(report.routingMetadataResponseAcceptance, false);
    assert.equal(report.physicalModelsUnchanged, false);
    assert.ok(report.failedStage.stage);
    assert.equal(report.nativeAcceptance, false);
    assert.equal(report.fullAcceptance, false);
    assert.ok(state.records.some(row => row.name.includes('-http.')),
      'The actual response must be retained even if the following guard/snapshot fails');
  });
}
