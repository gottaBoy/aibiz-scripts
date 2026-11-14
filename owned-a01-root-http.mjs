import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { createNativeMatrix, validateMatrixFixture } from './prepare-run-owned-native-nonadmin-matrix.mjs';
import { ownedPlatformRequest } from './owned-platform-http.mjs';
import { verifyNoDeniedIdentity } from './harness-run-owned-uaa-runtime.mjs';
import {
  modelingContextFromIdentity, requiresFreshBackendLogin, verifyModelingAppData,
  verifyRead, verifyUAAIdentity,
} from './run-owned-native-permission-http.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const prefix = '/api/ibizmodeling__modeldesign';
const representableKinds = ['whitespace', 'system-id-as-root', 'unknown-root'];
const methods = { READ: 'POST', UPDATE: 'PUT' };
const json = value => `${JSON.stringify(value)}\n`;

export const A01_SOURCE_PATHS = Object.freeze({
  handler: 'libs/ibiz-cloud-core/src/main/java/net/ibizsys/central/cloud/core/service/util/MethodHandlerBase.java',
  binding: 'libs/ibiz-runtime/src/main/java/net/ibizsys/central/dataentity/service/DEServiceAPIRuntime.java',
  rootAccess: 'libs/ibiz-modeling-core/src/main/java/net/ibizsys/modeling/core/dataentity/security/PSModelDEAccessManager.java',
  currentAccess: 'libs/ibiz-modeling-core/src/main/java/net/ibizsys/modeling/core/security/SystemAccessManagerBase.java',
});

export function verifyA01NativeSources(sources) {
  for (const key of Object.keys(A01_SOURCE_PATHS)) assert.equal(typeof sources[key], 'string');
  assert.ok(sources.handler.includes('pfetch(@PathVariable(name = "pkey") String pkey'));
  assert.ok(sources.handler.includes('ppost(@PathVariable(name = "pkey") String pkey'));
  assert.ok(sources.binding.includes('iAppContext.set(iDEServiceAPIRSRuntime.getMajorDEServiceAPIRuntime().getName(), strParentKey)'));
  assert.ok(sources.binding.includes('.testDataAccessAction(UserContext.getCurrent()'));
  assert.ok(sources.rootAccess.includes('Object root = appContext.get(APPCONTEXT_PSDEVSLNSYS)'));
  assert.ok(sources.rootAccess.includes('root instanceof String'));
  assert.ok(sources.rootAccess.includes('getPSDevUserBase("SYS", solutionSystemId)'));
  assert.ok(sources.currentAccess.includes('Invalid authorization model library identifier'));
  return true;
}

export function createA01RootPlan(manifest) {
  validateMatrixFixture(manifest);
  // Do not replace logical typed/null roots by the strings "0" or "null".
  const invalidRootCases = createNativeMatrix(manifest).invalidRootCases.map(row => ({
    ...row,
    httpTransport: representableKinds.includes(row.rootKind)
      ? 'native-parent-url-string' : 'not-representable-by-native-parent-url',
    httpBindingVerified: false,
    ...(representableKinds.includes(row.rootKind) ? {} : {
      executionStatus: 'blocked-native-transport',
      blockedReason: 'Native pkey is a required String path segment; missing, empty, JSON null and numeric values have no faithful binding.',
    }),
  }));
  return {
    contract: 'owned-a01-native-root-plan-v1', runId: manifest.runId, invalidRootCases,
    counts: { planned: 84, representable: 36, blocked: 48 },
    allowedTransport: 'Only source-bound native parent URL strings, encoded exactly once; no root/context headers or claim changes.',
    fullA01Acceptance: false, nativeAcceptance: false, permissionAcceptance: false,
  };
}

function canonicalCase(manifest, caseInput) {
  const actual = createA01RootPlan(manifest).invalidRootCases.find(row => row.id === caseInput?.id);
  assert.ok(actual, 'Only canonical invalidRootCases are eligible');
  assert.deepEqual(caseInput, actual, 'Actor, action, root value and expected outcome cannot be substituted');
  return actual;
}

export function a01InvalidRootRequest(manifest, caseInput) {
  const row = canonicalCase(manifest, caseInput);
  if (row.httpTransport !== 'native-parent-url-string') return null;
  const user = manifest.users.find(user => user.loginname === row.principal.loginname);
  const own = manifest.roots.find(root => root.rootId === user.rootId);
  const segment = encodeURIComponent(row.appContext.PSDEVSLNSYS);
  return {
    peer: 'backend', method: methods[row.accessAction],
    path: `${prefix}/psdevslnsys/${segment}/psmodules/${row.accessAction === 'READ' ? 'fetchcursys' : own.sentinelId}`,
    // A denied UPDATE attempts only the existing original values. Any write,
    // including audit/model-version changes, still fails full snapshot equality.
    data: row.accessAction === 'READ' ? { pssystemid: own.logicalSystemId, page: 0, size: 1000 }
      : { psmoduleid: own.sentinelId, pssystemid: own.logicalSystemId,
        psmodulename: own.sentinelName, modtag: own.sentinelTag },
  };
}

function controlRequest(root) {
  return { peer: 'backend', method: 'GET',
    path: `${prefix}/psdevslnsys/${root.rootId}/psmodules/${root.sentinelId}` };
}

export function validateA01Request(manifest, spec) {
  validateMatrixFixture(manifest);
  assert.ok(spec && Object.keys(spec).every(key =>
    ['peer', 'method', 'path', 'data', 'token', 'applicationContext'].includes(key)),
  'No unreviewed headers, URL, cookies or transport fields');
  assert.equal(spec.peer, 'backend');
  let canonical;
  for (const row of createA01RootPlan(manifest).invalidRootCases) {
    const request = a01InvalidRootRequest(manifest, row);
    if (request && spec.path === request.path && spec.method === request.method
      && isDeepStrictEqual(spec.data, request.data)) {
      canonical = request; break;
    }
  }
  canonical ??= manifest.roots.map(controlRequest).find(request =>
    spec.path === request.path && spec.method === request.method);
  assert.ok(canonical, 'Unreviewed A01 native route or method');
  const { token, applicationContext, ...request } = spec;
  assert.deepEqual(request, canonical, 'A01 request must retain canonical body and exact native path');
  if (token !== undefined) {
    assert.match(token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
    assert.deepEqual(Object.keys(applicationContext ?? {}).sort(), ['organization', 'system']);
    assert.equal(applicationContext.system, 'ibizmodeling');
    assert.ok(manifest.users.some(user => applicationContext.organization === `${user.centerId}_org`));
  } else {
    assert.equal(applicationContext, undefined);
    assert.ok(manifest.roots.some(root => spec.path === controlRequest(root).path) && spec.method === 'GET',
      'Anonymous requests are restricted to the two declared read controls');
  }
  return true;
}

export function verifyA01BackendToken(token, now = Date.now()) {
  assert.match(token ?? '', /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  assert.ok(Number.isSafeInteger(claims.iat) && Number.isSafeInteger(claims.exp));
  assert.equal(claims.exp - claims.iat, 20, 'Native 20-second JWT lifetime must remain unchanged');
  assert.ok(claims.iat * 1000 <= now + 1000, 'Future-dated tokens cannot bypass renewal');
  assert.equal(requiresFreshBackendLogin(token, now), false);
  return true;
}

export async function requestOwnedA01(context, spec, { fetchImplementation = fetch, now = Date.now } = {}) {
  validateA01Request(context.manifest, spec);
  const live = context.guard();
  if (spec.token) verifyA01BackendToken(spec.token, now());
  const origin = live.origins.backend;
  const url = new URL(spec.path, origin);
  assert.equal(url.origin, origin);
  assert.equal(url.pathname, spec.path, 'URL normalization may not change a malformed root');
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  const result = { status: null, error: null, bytes: 0, data: null, dispatched: false };
  try {
    result.dispatched = true;
    const response = await fetchImplementation(url.href, {
      method: spec.method, redirect: 'manual', signal: controller.signal,
      headers: { accept: 'application/json', 'content-type': 'application/json',
        ...(spec.token ? { authorization: `Bearer ${spec.token}`,
          srfsystemid: spec.applicationContext.system, srforgid: spec.applicationContext.organization } : {}) },
      ...(spec.data === undefined ? {} : { body: JSON.stringify(spec.data) }),
    });
    result.status = response.status;
    if (response.status >= 300 && response.status < 400) {
      await response.body?.cancel();
      return { ...result, error: 'redirect-refused' };
    }
    const chunks = [];
    const reader = response.body?.getReader();
    if (reader) for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      result.bytes += value.length;
      if (result.bytes > 2 * 1024 * 1024) {
        controller.abort(); await reader.cancel();
        return { ...result, error: 'response-too-large' };
      }
      chunks.push(value);
    }
    const bytes = Buffer.concat(chunks);
    result.responseSha256 = hash(bytes);
    if (bytes.length) {
      assert.match(response.headers.get('content-type') ?? '', /^application\/(?:json|[a-z0-9.+-]+\+json)(?:;|$)/i);
      result.data = JSON.parse(bytes.toString('utf8'));
    }
    return result;
  } catch {
    return { ...result, error: controller.signal.aborted ? 'timeout' : 'transport-or-json-error' };
  } finally { clearTimeout(timeout); }
}

export function verifyA01Denial(manifest, response, before, after, { anonymous = false, invalidRoot = false } = {}) {
  assert.equal(response.dispatched, true, 'Only an actual dispatched HTTP response is evidence');
  assert.equal(response.error, null);
  assert.deepEqual(after, before, 'Denied request changed physical model rows, columns or schema');
  if (anonymous) assert.equal(response.status, 401, 'Anonymous control requires HTTP 401');
  else if (invalidRoot) assert.ok([400, 403, 422].includes(response.status),
    'Invalid root requires explicit client input rejection or authorization denial, never 401/404/500');
  else assert.equal(response.status, 403, 'Cross-root and no-access controls require authenticated HTTP 403');
  const body = JSON.stringify(response.data);
  for (const root of manifest.roots) for (const field of ['sentinelName', 'sentinelSystemName', 'sentinelTag']) {
    assert.ok(!body.includes(root[field]), 'Denied response exposes a physical sentinel');
  }
  assert.ok(!response.data?.token && !response.data?.access_token && !response.data?.refresh_token,
    'Denied response must not expose authentication material');
  verifyNoDeniedIdentity(response.data);
  return response.status === 403 ? 'authorization-denied' : anonymous ? 'authentication-denied' : 'input-rejected';
}

export function verifyA01PhysicalBaseline(manifest, snapshot) {
  assert.equal(snapshot.encoding, 'every-physical-column-null-or-hex-cast-binary-v1');
  for (const root of manifest.roots) for (const [tableName, key, keyValue, name, expectedName] of [
    ['t_srfpsmodule', 'psmoduleid', root.sentinelId, 'psmodulename', root.sentinelName],
    ['t_srfpssystem', 'pssystemid', root.logicalSystemId, 'pssystemname', root.sentinelSystemName],
  ]) {
    const table = snapshot.tables.filter(table => table.database === root.database
      && table.table.toLowerCase() === tableName);
    assert.equal(table.length, 1);
    const rows = table[0].rows.map(row => {
      const fields = Object.entries(row).map(([field, value]) => [
        field.toLowerCase(), value === null ? null : Buffer.from(value, 'hex').toString('utf8'),
      ]);
      assert.equal(new Set(fields.map(([field]) => field)).size, fields.length);
      return Object.fromEntries(fields);
    }).filter(row => row[key] === keyValue);
    assert.equal(rows.length, 1);
    assert.equal(rows[0][name], expectedName);
    assert.equal(rows[0].pssystemid, root.logicalSystemId);
    if (tableName === 't_srfpsmodule') assert.equal(rows[0].modtag, root.sentinelTag);
    else {
      for (const [field, value] of [['psdevslnsysid', root.rootId], ['psdevcenterid', root.centerId],
        ['pssysmodelinstid', root.modelInstanceId], ['psdevslnid', root.schemeId]]) assert.equal(rows[0][field], value);
      assert.ok(Number.isSafeInteger(Number(rows[0].modelver)) && Number(rows[0].modelver) >= root.modelVersion);
    }
  }
  return true;
}

export async function runOwnedA01Checks({
  context, snapshot, allowDeniedUpdates = false, send = requestOwnedA01, authenticate = ownedPlatformRequest,
  record = async () => {}, now = Date.now,
}) {
  assert.equal(allowDeniedUpdates, true, 'Denied native UPDATE attempts require explicit opt-in');
  const plan = createA01RootPlan(context.manifest);
  const report = {
    contract: 'owned-a01-native-root-http-v1', runId: context.manifest.runId, status: 'running',
    invalidRootCases: plan.invalidRootCases.map(({ appContext, principal, ...row }) => ({
      ...row, actor: principal.personId, role: principal.role,
    })),
    controls: [], authentication: [], physicalModelsUnchanged: false,
    coverage: { ...plan.counts, controlsRequired: 16 },
    boundedRepresentableRootAcceptance: false, fullA01Acceptance: false,
    nativeAcceptance: false, permissionAcceptance: false, typedRootHTTPAcceptance: false,
    tokenLifetimeChanged: false, sharedServicesChanged: false,
    snapshotStrategy: 'contiguous-full-after-to-next-before-v1', snapshotSequence: [],
    unresolved: [
      '48 logical absent/null/empty/numeric-root cases lack a faithful native String-path transport and are not HTTP acceptance.',
      'No Java service-layer test was compiled or replayed by this HTTP runner; existing source is not execution evidence.',
      'A02 same-token invalidation and A03 nested lifecycle remain independent.',
    ],
  };
  let serial = 0;
  let baseline;
  let currentSnapshot;
  let active = { stage: 'initial-full-snapshot', requestAttempted: false };
  const captureSnapshot = async source => {
    const startedAtMs = now();
    const value = await snapshot();
    const identity = { id: `snapshot-${report.snapshotSequence.length + 1}`,
      source, startedAtMs, capturedAtMs: now() };
    report.snapshotSequence.push(identity);
    return { value, identity };
  };
  const beforeOperation = (id, spec) => {
    active = { stage: 'before-full-snapshot-verification', operationId: id, peer: spec.peer,
      method: spec.method, path: spec.path, requestAttempted: false };
    assert.ok(currentSnapshot, 'A complete previous boundary is required before dispatch');
    active.beforeSnapshotId = currentSnapshot.identity.id;
    assert.deepEqual(currentSnapshot.value, baseline, 'Unexpected physical baseline before dispatch');
    return currentSnapshot;
  };
  const afterOperation = async id => {
    active.stage = 'after-runtime-source-guard';
    context.guard();
    active.stage = 'after-full-snapshot';
    const after = await captureSnapshot({ kind: 'http-after', operationId: id });
    active.afterSnapshotId = after.identity.id;
    currentSnapshot = after;
    return after;
  };
  const verifySnapshots = (before, after) => {
    active.stage = 'complete-physical-snapshot-verification';
    assert.deepEqual(after.value, before.value, 'Request changed either complete physical model schema');
    assert.deepEqual(after.value, baseline, 'Request changed the complete physical baseline');
  };
  const boundaries = (before, after) => ({ before: before.identity, after: after.identity,
    contiguousBeforeReuse: before.identity.source.kind === 'http-after' });
  const verifyTokenReadiness = (token, operationId) => {
    active = { stage: 'backend-token-readiness', operationId, peer: 'backend',
      requestAttempted: false, afterSnapshotId: currentSnapshot?.identity.id };
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    if (Number.isSafeInteger(claims.exp)) active.tokenRemainingMs = claims.exp * 1000 - now();
    verifyA01BackendToken(token, now());
  };
  const login = async (user, phase, verifiedApplicationContext) => {
    const observe = async (id, spec, verify) => {
      const check = { id: `${user.loginname}-${phase}-${id}`, method: spec.method,
        httpStatus: null, error: null, status: 'failed' };
      report.authentication.push(check);
      const before = beforeOperation(check.id, spec);
      active.stage = 'authentication-before-runtime-source-guard';
      context.guard();
      active.stage = 'authentication-dispatch';
      currentSnapshot = undefined;
      active.requestAttempted = true;
      const response = await authenticate(context, spec);
      check.httpStatus = response.status; check.error = response.error;
      if (Number.isInteger(response.status)) active.httpStatus = response.status;
      const after = await afterOperation(check.id);
      active.stage = 'authentication-evidence-persistence';
      check.snapshotBoundary = boundaries(before, after);
      check.snapshot = await record(`${String(++serial).padStart(3, '0')}-authentication.private.json`, {
        before: before.value, after: after.value, snapshotBoundary: check.snapshotBoundary,
      });
      verifySnapshots(before, after);
      active.stage = 'authentication-response-verification';
      assert.equal(response.error, null); assert.equal(response.status, 200);
      verify(response); check.status = 'passed'; return response;
    };
    const tokenOf = response => {
      const token = response.data?.token ?? response.data?.access_token;
      assert.match(token ?? '', /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/); return token;
    };
    let applicationContext = verifiedApplicationContext;
    if (!applicationContext) {
      const uaa = await observe('uaa-login', { peer: 'uaa', method: 'POST', path: '/auths/login',
        data: { loginname: user.loginname, password: context.credentials.users[user.loginname], dc: user.centerId } },
      response => { tokenOf(response); verifyUAAIdentity(response.data.user, user); });
      applicationContext = modelingContextFromIdentity(uaa.data.user, user);
      await observe('uaa-self', { peer: 'uaa', method: 'GET', path: '/auths/user-info/self', token: tokenOf(uaa) },
        response => verifyUAAIdentity(response.data, user));
    }
    const backend = await observe('backend-login', { peer: 'backend', method: 'POST', path: '/v7/login',
      data: { loginname: user.loginname, password: context.credentials.users[user.loginname] } }, tokenOf);
    const token = tokenOf(backend);
    verifyTokenReadiness(token, `${user.loginname}-${phase}-issued-token`);
    await observe('backend-self', { peer: 'backend', method: 'GET', path: '/uaa/oauth/userinfo', token },
      response => assert.equal(response.data?.sub, user.loginname));
    await observe('appdata', { peer: 'backend', method: 'GET', path: '/appdata', token, applicationContext },
      response => verifyModelingAppData(response, user, applicationContext));
    verifyTokenReadiness(token, `${user.loginname}-${phase}-verified-token`);
    return { token, applicationContext };
  };
  try {
    currentSnapshot = await captureSnapshot({ kind: 'initial' });
    baseline = currentSnapshot.value;
    verifyA01PhysicalBaseline(context.manifest, baseline);
    const observe = async (check, spec, verify) => {
      const before = beforeOperation(check.id, spec);
      active.stage = 'model-before-runtime-source-guard';
      context.guard();
      active.stage = 'model-dispatch';
      currentSnapshot = undefined;
      active.requestAttempted = true;
      check.executionStatus = 'failed-http';
      const response = await send(context, spec);
      if (Number.isInteger(response.status)) active.httpStatus = response.status;
      const after = await afterOperation(check.id);
      active.stage = 'model-evidence-persistence';
      check.snapshotBoundary = boundaries(before, after);
      check.evidence = await record(`${String(++serial).padStart(3, '0')}-http.private.json`, {
        request: { method: spec.method, path: spec.path, data: spec.data }, response,
        before: before.value, after: after.value, snapshotBoundary: check.snapshotBoundary,
      });
      verifySnapshots(before, after);
      Object.assign(check, { method: spec.method, path: spec.path, httpStatus: response.status,
        error: response.error, dispatched: response.dispatched === true,
        responseSha256: response.responseSha256 ?? hash(json(response.data ?? null)) });
      active.stage = 'model-response-verification';
      assert.equal(response.dispatched, true);
      check.outcome = verify(response, before.value, after.value);
      check.executionStatus = 'passed-http'; check.physicalColumnsUnchanged = true;
      check.httpBindingVerified = true;
    };
    for (const root of context.manifest.roots) {
      const check = { id: `anonymous-${root.side}`, executionStatus: 'failed-http' };
      report.controls.push(check);
      await observe(check, controlRequest(root), (response, before, after) =>
        verifyA01Denial(context.manifest, response, before, after, { anonymous: true }));
    }
    for (const user of context.manifest.users) {
      let session = await login(user, 'initial');
      let renewal = 0;
      const withSession = async operationId => {
        active = { stage: 'backend-session-renewal-check', operationId, requestAttempted: false };
        if (requiresFreshBackendLogin(session.token, now())) {
          // UAA identity/context was already verified for this actor. Renew through
          // normal backend login and verify the new token's self and appdata again.
          session = await login(user, `renewal-${++renewal}`, session.applicationContext);
        }
        verifyTokenReadiness(session.token, operationId);
      };
      for (const root of context.manifest.roots) {
        const check = { id: `${user.loginname}-${root.side}-control`, role: user.role,
          actor: user.personId, relation: user.rootId === root.rootId ? 'own' : 'foreign',
          executionStatus: 'blocked-before-http' };
        report.controls.push(check);
        await withSession(check.id);
        await observe(check, { ...controlRequest(root), ...session }, (response, before, after) => {
          if (user.rootId !== root.rootId || user.role === 'no-access') {
            return verifyA01Denial(context.manifest, response, before, after);
          }
          verifyRead(response, root, 'GET'); return 'allowed-source-sentinel';
        });
      }
      // Consume the original logical invalidRootCases, not a disconnected
      // surrogate list. Unrepresentable cases remain explicitly blocked.
      for (const row of plan.invalidRootCases.filter(row => row.principal.personId === user.personId)) {
        const spec = a01InvalidRootRequest(context.manifest, row);
        if (!spec) continue;
        const check = report.invalidRootCases.find(check => check.id === row.id);
        check.executionStatus = 'blocked-before-http';
        await withSession(check.id);
        await observe(check, { ...spec, ...session }, (response, before, after) =>
          verifyA01Denial(context.manifest, response, before, after, { invalidRoot: true }));
      }
    }
    for (const root of context.manifest.roots) {
      const check = { id: `anonymous-after-authenticated-${root.side}`, executionStatus: 'failed-http' };
      report.controls.push(check);
      await observe(check, controlRequest(root), (response, before, after) =>
        verifyA01Denial(context.manifest, response, before, after, { anonymous: true }));
    }
    active = { stage: 'final-full-snapshot', requestAttempted: false };
    assert.deepEqual((await captureSnapshot({ kind: 'final-verification' })).value, baseline);
    active.stage = 'final-coverage-verification';
    assert.equal(report.invalidRootCases.filter(check => check.executionStatus === 'passed-http').length, 36);
    assert.equal(report.invalidRootCases.filter(check => check.executionStatus === 'blocked-native-transport').length, 48);
    assert.equal(report.controls.length, 16);
    report.physicalModelsUnchanged = true;
    report.boundedRepresentableRootAcceptance = true;
    report.status = 'passed-bounded-native-string-roots-partial-a01';
  } catch (error) {
    report.status = 'failed-owned-a01-http';
    report.failedStage = { ...active, errorKind: error?.code === 'ERR_ASSERTION'
      ? 'assertion-failed' : error?.name === 'AbortError' ? 'aborted' : 'operation-failed' };
    report.unresolved.push('Stopped at the first auth, transport, exact status, sentinel, snapshot or guard failure; inspect private evidence.');
  }
  return report;
}
