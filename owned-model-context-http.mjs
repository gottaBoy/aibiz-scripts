import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { validateMatrixFixture } from './prepare-run-owned-native-nonadmin-matrix.mjs';
import { ownedPlatformRequest, validateOwnedPlatformRequest } from './owned-platform-http.mjs';
import { verifyNoDeniedIdentity } from './harness-run-owned-uaa-runtime.mjs';
import { verifyA01BackendToken, verifyA01PhysicalBaseline } from './owned-a01-root-http.mjs';
import {
  modelingContextFromIdentity, requiresFreshBackendLogin, verifyModelingAppData, verifyUAAIdentity,
} from './run-owned-native-permission-http.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const jwtPattern = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
export const MODEL_CONTEXT_ACCEPTANCE_SCOPE = Object.freeze({
  response: 'ordinary-auth-two-identifier-routing-metadata-only',
  physicalInvariance: 'two-model-schemas-only',
  uaaSideEffectsUnverified: true,
  metadataSideEffectsUnverified: true,
  cacheSideEffectsUnverified: true,
});
const sessionNotReady = error => error?.code === 'MODEL_CONTEXT_SESSION_NOT_READY'
  && error.dispatched === false;
function verifyDispatchToken(token, time) {
  try { verifyA01BackendToken(token, time); }
  catch (error) {
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    if (Number.isSafeInteger(claims.iat) && Number.isSafeInteger(claims.exp) &&
      claims.exp - claims.iat === 20 && claims.iat * 1000 <= time + 1000 &&
      requiresFreshBackendLogin(token, time)) {
      Object.assign(error, { code: 'MODEL_CONTEXT_SESSION_NOT_READY', dispatched: false });
    }
    throw error;
  }
}
export function verifyIssuedModelContextToken(token, user, time = Date.now()) {
  assert.match(token ?? '', jwtPattern);
  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  assert.ok(Number.isSafeInteger(claims.iat) && Number.isSafeInteger(claims.exp));
  assert.equal(claims.exp - claims.iat, 20, 'Native 20-second JWT lifetime must remain unchanged');
  assert.ok(claims.iat * 1000 <= time + 1000, 'Future-dated tokens cannot bypass renewal');
  for (const [key, expected] of Object.entries({
    sub: user.loginname, username: user.loginname, dc: user.centerId,
    id: user.personId, organizationId: `${user.centerId}_org`,
  })) assert.equal(claims[key], expected, 'Every issued backend token must bind the exact fixture actor');
  return true;
}
export const MODEL_CONTEXT_SOURCE_PATH =
  'libs/ibiz-modeling-core/src/main/java/net/ibizsys/modeling/core/security/SystemAccessManagerBase.java';

export function modelContextFailureDetails(error, stage) {
  return {
    stage,
    name: typeof error?.name === 'string' ? error.name : 'Error',
    message: typeof error?.message === 'string' ? error.message : 'Unknown owned model-context failure',
    stack: typeof error?.stack === 'string' ? error.stack : null,
  };
}

export function createModelContextPlan(manifest) {
  validateMatrixFixture(manifest);
  return {
    contract: 'owned-model-context-readonly-plan-v1',
    runId: manifest.runId,
    queries: manifest.users.flatMap(user => manifest.roots.map(root => ({
      id: `${user.loginname}-${root.side}-model-context`,
      actor: user.personId, loginname: user.loginname, role: user.role, rootId: root.rootId,
      relation: user.rootId === root.rootId ? 'own' : 'foreign',
      expectedProjection: user.rootId === root.rootId && user.role !== 'no-access',
      expectedStatus: 200, path: `/ibizmodeling/appdata?psdevslnsys=${root.rootId}`,
    }))),
    anonymous: manifest.roots.map(root => ({
      id: `anonymous-${root.side}-model-context`,
      rootId: root.rootId, path: `/ibizmodeling/appdata?psdevslnsys=${root.rootId}`,
    })),
    nativeAcceptance: false, fullAcceptance: false, permissionAcceptance: false,
  };
}

export function validateModelContextRequest(manifest, spec) {
  validateMatrixFixture(manifest);
  assert.ok(spec && Object.keys(spec).every(key =>
    ['peer', 'method', 'path', 'data', 'token', 'applicationContext'].includes(key)));
  validateOwnedPlatformRequest(manifest.runId, spec.peer, spec.path, spec.method);
  const query = manifest.roots.some(root => spec.path === `/ibizmodeling/appdata?psdevslnsys=${root.rootId}`);
  const auth = {
    '/auths/login': ['uaa', 'POST'], '/auths/user-info/self': ['uaa', 'GET'],
    '/v7/login': ['backend', 'POST'], '/uaa/oauth/userinfo': ['backend', 'GET'],
    '/appdata': ['backend', 'GET'],
  }[spec.path];
  assert.ok(query || auth, 'Only normal authentication and the two exact owned root queries are eligible');
  if (query) assert.deepEqual([spec.peer, spec.method], ['backend', 'GET']);
  else assert.deepEqual([spec.peer, spec.method], auth);
  if (spec.path.endsWith('/login')) {
    const user = manifest.users.find(user => user.loginname === spec.data?.loginname);
    assert.ok(user);
    assert.deepEqual(Object.keys(spec.data).sort(),
      spec.peer === 'uaa' ? ['dc', 'loginname', 'password'] : ['loginname', 'password']);
    assert.ok(typeof spec.data.password === 'string' && spec.data.password);
    if (spec.peer === 'uaa') assert.equal(spec.data.dc, user.centerId);
    assert.equal(spec.token, undefined);
    assert.equal(spec.applicationContext, undefined);
  } else {
    assert.equal(spec.data, undefined, 'GET bodies cannot carry roots, logical IDs or identities');
    if (!query) assert.match(spec.token ?? '', jwtPattern);
  }
  if (spec.token !== undefined) assert.match(spec.token, jwtPattern);
  const needsContext = spec.peer === 'backend' && spec.method === 'GET'
    && spec.path !== '/uaa/oauth/userinfo' && spec.token !== undefined;
  assert.equal(spec.applicationContext !== undefined, needsContext);
  if (needsContext) {
    assert.deepEqual(Object.keys(spec.applicationContext).sort(), ['organization', 'system']);
    assert.equal(spec.applicationContext.system, 'ibizmodeling');
    assert.ok(manifest.users.some(user =>
      spec.applicationContext.organization === `${user.centerId}_org`));
  }
  return true;
}

export async function requestOwnedModelContext(context, spec, {
  fetchImplementation = fetch, now = Date.now,
} = {}) {
  validateModelContextRequest(context.manifest, spec);
  let dispatched = false;
  const guarded = {
    ...context,
    guard() {
      const live = context.guardForHTTP ? context.guardForHTTP() : context.guard();
      if (spec.peer === 'backend' && spec.token) verifyDispatchToken(spec.token, now());
      return live;
    },
  };
  try {
    const response = await ownedPlatformRequest(guarded, spec, {
      fetchImplementation: (...arguments_) => {
        dispatched = true;
        return fetchImplementation(...arguments_);
      },
    });
    return { ...response, dispatched };
  } catch (error) {
    if (error && typeof error === 'object') error.dispatched = dispatched;
    throw error;
  }
}

function assertNoProjection(value) {
  if (!value || typeof value !== 'object') return;
  for (const [key, field] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    assert.notEqual(key.toLowerCase(), 'srfmodelcontext', 'An absent projection must not leak at any depth');
    assert.ok('value' in field, 'Accessor response fields cannot be treated as HTTP JSON');
    assertNoProjection(field.value);
  }
}

export function verifyModelContextResponse(response, user, root, applicationContext) {
  assert.equal(response.dispatched, true, 'Only a dispatched HTTP response is evidence');
  verifyModelingAppData(response, user, applicationContext);
  const expected = user.rootId === root.rootId && user.role !== 'no-access';
  if (!expected) {
    assertNoProjection(response.data);
    return 'authenticated-without-model-projection';
  }
  const field = Object.getOwnPropertyDescriptor(response.data, 'srfmodelcontext');
  assert.ok(field && 'value' in field, 'The authorized response requires real top-level metadata');
  const projection = field.value;
  assert.ok(projection && typeof projection === 'object' && !Array.isArray(projection));
  assert.deepEqual(Reflect.ownKeys(projection).sort(), ['psdevslnsys', 'pssystemid']);
  for (const [key, expectedValue] of [['psdevslnsys', root.rootId], ['pssystemid', root.logicalSystemId]]) {
    const property = Object.getOwnPropertyDescriptor(projection, key);
    assert.ok(property && 'value' in property && typeof property.value === 'string');
    assert.equal(property.value, expectedValue);
  }
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(response.data))) {
    if (key === 'srfmodelcontext') continue;
    assert.ok('value' in descriptor);
    assertNoProjection(descriptor.value);
  }
  return 'authorized-two-identifier-routing-metadata';
}

export function verifyAnonymousModelContext(response) {
  assert.equal(response.dispatched, true);
  assert.equal(response.error, null);
  assert.equal(response.status, 401, 'Anonymous queries require exact HTTP 401 authentication refusal');
  assertNoProjection(response.data);
  verifyNoDeniedIdentity(response.data);
  return 'anonymous-authentication-denied';
}

export async function runOwnedModelContextChecks({
  context, snapshot, send = requestOwnedModelContext, record = async () => {}, now = Date.now,
  recordFailure = details => record('failure.private.json', details),
}) {
  const plan = createModelContextPlan(context.manifest);
  const report = {
    contract: 'owned-model-context-readonly-http-v1', runId: context.manifest.runId, status: 'running',
    authentication: [], queries: [], anonymous: [], snapshotSequence: [],
    snapshotStrategy: 'contiguous-full-after-to-next-before-v1', physicalModelsUnchanged: false,
    routingMetadataResponseAcceptance: false, acceptanceScope: MODEL_CONTEXT_ACCEPTANCE_SCOPE,
    nonDispatchedAttempts: [], sessionRenewals: [],
    nativeAcceptance: false, fullAcceptance: false,
    permissionAcceptance: false, tokenLifetimeChanged: false, sharedServicesChanged: false,
    coverage: { authenticatedQueriesRequired: 12, authorizedProjectionsRequired: 4,
      authenticatedAbsentRequired: 8, anonymousQueriesRequired: 2 },
    unresolved: [
      'This is only ordinary-auth READ routing metadata, not PSSYSTEM.READ or physical entity CRUD acceptance.',
      'Browser root/menu/relogin flows, the full role matrix and remaining capability gates are separate.',
      'UAA, metadata and cache side effects are not covered by the two physical model-schema snapshots.',
    ],
  };
  let baseline;
  let currentSnapshot;
  let serial = 0;
  let active = { stage: 'initial-full-snapshot', requestAttempted: false };
  const capture = async source => {
    const startedAtMs = now();
    const value = await snapshot();
    const identity = { id: `snapshot-${report.snapshotSequence.length + 1}`, source,
      startedAtMs, capturedAtMs: now() };
    identity.evidence = await record(`${String(++serial).padStart(4, '0')}-snapshot.private.json`,
      { purpose: source, identity: { ...identity }, snapshot: value });
    report.snapshotSequence.push(identity);
    return { value, identity };
  };
  const observe = async (collection, id, spec, verify, metadata = {}) => {
    const check = { ...metadata, id, peer: spec.peer, method: spec.method, path: spec.path,
      status: 'failed', httpStatus: null, error: null };
    collection.push(check);
    const recordNonDispatch = async before => {
      collection.pop();
      active.dispatched = false;
      const attempt = { id, peer: spec.peer, method: spec.method, path: spec.path,
        dispatched: false, reason: 'backend-token-below-native-dispatch-margin',
        beforeSnapshotId: before.identity.id };
      attempt.evidence = await record(`${String(++serial).padStart(4, '0')}-preflight.private.json`, attempt);
      report.nonDispatchedAttempts.push(attempt);
    };
    active = { stage: 'before-full-snapshot-verification', operationId: id,
      peer: spec.peer, method: spec.method, path: spec.path, requestAttempted: false };
    assert.ok(currentSnapshot, 'A complete contiguous boundary is required before every HTTP');
    const before = currentSnapshot;
    active.beforeSnapshotId = before.identity.id;
    assert.deepEqual(before.value, baseline, 'Physical data/schema drift before HTTP');
    active.stage = 'before-runtime-source-guard';
    context.guard();
    if (spec.peer === 'backend' && spec.token) {
      active.stage = 'backend-token-readiness';
      try { verifyDispatchToken(spec.token, now()); }
      catch (error) {
        if (sessionNotReady(error)) await recordNonDispatch(before);
        throw error;
      }
    }
    active.stage = 'http-dispatch';
    active.requestAttempted = true;
    let response;
    try {
      response = await send(context, spec, { now });
    } catch (error) {
      if (sessionNotReady(error)) {
        await recordNonDispatch(before);
      } else {
        check.dispatched = error?.dispatched === true;
        active.dispatched = error?.dispatched === true;
        if (error?.dispatched !== false) currentSnapshot = undefined;
      }
      throw error;
    }
    currentSnapshot = undefined;
    check.httpStatus = response.status; check.error = response.error;
    check.dispatched = response.dispatched === true;
    active.httpStatus = response.status;
    active.dispatched = check.dispatched;
    active.stage = 'http-response-private-persistence';
    check.evidence = await record(`${String(++serial).padStart(4, '0')}-http.private.json`, {
      operationId: id, request: { peer: spec.peer, method: spec.method, path: spec.path,
        ...(spec.data ? { loginname: spec.data.loginname, ...(spec.data.dc ? { dc: spec.data.dc } : {}) } : {}) },
      response, beforeSnapshotId: before.identity.id,
    });
    active.stage = 'after-runtime-source-guard';
    const liveAfter = context.guard();
    context.verifyMountedInputs?.(liveAfter);
    active.stage = 'after-full-snapshot';
    const after = await capture({ kind: 'http-after', operationId: id });
    currentSnapshot = after;
    active.afterSnapshotId = after.identity.id;
    check.snapshotBoundary = { before: before.identity, after: after.identity,
      contiguousBeforeReuse: before.identity.source.kind === 'http-after' };
    active.stage = 'complete-physical-snapshot-verification';
    assert.deepEqual(after.value, before.value, 'HTTP changed complete physical rows, columns or schema');
    assert.deepEqual(after.value, baseline, 'HTTP changed the complete physical baseline');
    active.stage = 'http-response-verification';
    assert.equal(response.dispatched, true);
    assert.equal(response.error, null);
    check.outcome = verify(response);
    check.status = 'passed';
    check.physicalColumnsUnchanged = true;
    return response;
  };
  const tokenOf = response => {
    const token = response.data?.token ?? response.data?.access_token;
    assert.match(token ?? '', jwtPattern);
    return token;
  };
  const auth = (user, phase, id, spec, verify) => observe(report.authentication,
    `${user.loginname}-${phase}-${id}`, spec, response => {
      assert.equal(response.status, 200);
      verify(response);
      return 'ordinary-authentication-verified';
    });
  const issueBackendToken = async (user, session, phase) => {
    // Full evidence capture can age a valid issuance; readiness is checked again at actual dispatch.
    const backend = await auth(user, phase, 'backend-login', {
      peer: 'backend', method: 'POST', path: '/v7/login',
      data: { loginname: user.loginname, password: context.credentials.users[user.loginname] },
    }, response => verifyIssuedModelContextToken(tokenOf(response), user, now()));
    session.token = tokenOf(backend);
  };
  const observeBackend = async (user, session, collection, id, spec, verify, metadata = {}) => {
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (!session.token || requiresFreshBackendLogin(session.token, now())) {
        report.sessionRenewals.push({ loginname: user.loginname, operationId: id, attempt,
          reason: 'native-margin-before-operation-dispatch' });
        await issueBackendToken(user, session, `renewal-${++session.renewal}`);
      }
      try {
        return await observe(collection, id, { ...spec, token: session.token },
          verify, metadata);
      } catch (error) {
        if (!sessionNotReady(error)) throw error;
        report.sessionRenewals.push({ loginname: user.loginname, operationId: id, attempt,
          reason: 'native-margin-consumed-by-dispatch-guards' });
        session.token = undefined;
        assert.ok(attempt < 3, 'Native dispatch readiness retries exhausted');
      }
    }
  };
  const login = async user => {
    const uaa = await auth(user, 'initial', 'uaa-login', {
      peer: 'uaa', method: 'POST', path: '/auths/login',
      data: { loginname: user.loginname, password: context.credentials.users[user.loginname], dc: user.centerId },
    }, response => { tokenOf(response); verifyUAAIdentity(response.data.user, user); });
    const applicationContext = modelingContextFromIdentity(uaa.data.user, user);
    await auth(user, 'initial', 'uaa-self', {
      peer: 'uaa', method: 'GET', path: '/auths/user-info/self', token: tokenOf(uaa),
    }, response => verifyUAAIdentity(response.data, user));
    const session = { applicationContext, renewal: 0, backendSelfVerified: false, baseAppDataVerified: false };
    await issueBackendToken(user, session, 'initial');
    await observeBackend(user, session, report.authentication, `${user.loginname}-initial-backend-self`, {
      peer: 'backend', method: 'GET', path: '/uaa/oauth/userinfo',
    }, response => {
      assert.equal(response.status, 200);
      assert.equal(response.data?.sub, user.loginname);
      session.backendSelfVerified = true;
      return 'ordinary-authentication-verified';
    });
    await observeBackend(user, session, report.authentication, `${user.loginname}-initial-base-appdata`, {
      peer: 'backend', method: 'GET', path: '/appdata', applicationContext,
    }, response => {
      verifyModelingAppData(response, user, applicationContext);
      assertNoProjection(response.data);
      session.baseAppDataVerified = true;
      return 'ordinary-authentication-verified';
    });
    return session;
  };
  try {
    currentSnapshot = await capture({ kind: 'initial' });
    baseline = currentSnapshot.value;
    verifyA01PhysicalBaseline(context.manifest, baseline);
    for (const row of plan.anonymous) {
      await observe(report.anonymous, row.id, { peer: 'backend', method: 'GET', path: row.path },
        verifyAnonymousModelContext, row);
    }
    for (const user of context.manifest.users) {
      const session = await login(user);
      assert.equal(session.backendSelfVerified, true);
      assert.equal(session.baseAppDataVerified, true);
      for (const row of plan.queries.filter(row => row.loginname === user.loginname)) {
        active = { stage: 'backend-session-renewal-check', operationId: row.id, requestAttempted: false };
        const root = context.manifest.roots.find(root => root.rootId === row.rootId);
        const response = await observeBackend(user, session, report.queries, row.id,
          { peer: 'backend', method: 'GET', path: row.path, applicationContext: session.applicationContext },
          response => verifyModelContextResponse(response, user, root, session.applicationContext), row);
        Object.assign(report.queries.at(-1), {
          responseSha256: response.responseSha256 ?? hash(JSON.stringify(response.data)) });
      }
    }
    active = { stage: 'final-full-snapshot', requestAttempted: false };
    assert.deepEqual((await capture({ kind: 'final-verification' })).value, baseline);
    active.stage = 'final-coverage-verification';
    assert.equal(report.queries.length, 12);
    assert.equal(report.queries.filter(row => row.expectedProjection).length, 4);
    assert.equal(report.queries.filter(row => !row.expectedProjection).length, 8);
    assert.equal(report.anonymous.length, 2);
    assert.ok([...report.authentication, ...report.queries, ...report.anonymous]
      .every(row => row.status === 'passed' && row.dispatched));
    report.physicalModelsUnchanged = true;
    report.routingMetadataResponseAcceptance = true;
    report.status = 'passed-owned-routing-model-context-response-only';
  } catch (error) {
    report.status = 'failed-owned-model-context-http';
    report.failedStage = { ...active, errorKind: error?.code === 'ERR_ASSERTION'
      ? 'assertion-failed' : error?.name === 'AbortError' ? 'aborted' : 'operation-failed' };
    report.unresolved.push('Stopped at the first source/peer/authentication/transport/metadata/full-snapshot failure; inspect private evidence.');
    try {
      const evidence = await recordFailure(modelContextFailureDetails(error, { ...active }));
      if (evidence) report.failureEvidence = { path: evidence.path, sha256: evidence.sha256 };
      else report.privateDiagnosticUnavailable = true;
    } catch {
      report.privateDiagnosticUnavailable = true;
    }
  }
  return report;
}
