#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { performance } from 'node:perf_hooks';
import { nativeActorRuntimeIdentity } from './probe-existing-native-actor-contract.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const uaa = 'http://127.0.0.1:32666';
const normalLogin = 'http://127.0.0.1:30250/api/ibizplm__plmweb/v7/login';
const hash = value => createHash('sha256').update(value).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const sourcePaths = [
  'scripts/provision-native-api-client.mjs',
  'scripts/tests/provision-native-api-client.test.mjs',
  'scripts/probe-existing-native-actor-contract.mjs',
  'scripts/prepare-existing-native-actors.mjs',
  'standalone-uaa/source/uaa-core/src/main/java/cn/ibizlab/api/rest/AbstractOauthClientDetailsResource.java',
  'standalone-uaa/source/uaa-core/src/main/java/cn/ibizlab/api/dto/OauthClientDetailsDTO.java',
  'standalone-uaa/source/uaa-core/src/main/java/cn/ibizlab/core/oauth2/domain/OauthClientDetails.java',
  'standalone-uaa/source/uaa-core/src/main/java/cn/ibizlab/core/oauth2/service/impl/AbstractOauthClientDetailsService.java',
  'standalone-uaa/source/uaa-core/src/main/java/cn/ibizlab/core/oauth2/service/OauthClientDetailsService.java',
  'standalone-uaa/source/uaa-core/src/main/resources/mapper/oauth2/OauthClientDetails/OauthClientDetailsMapper.xml',
  'standalone-uaa/source/uaa-user/src/main/java/cn/ibizlab/core/oauth2/service/impl/OauthClientDetailsServiceImpl.java',
  'standalone-uaa/source/uaa-user/src/main/java/cn/ibizlab/core/oauth2/service/impl/OAuth2TokenService.java',
  'standalone-uaa/source/uaa-user/src/main/java/cn/ibizlab/core/oauth2/config/OAuth2AuthorizationServerConfig.java',
  'standalone-uaa/source/uaa-user/src/main/java/cn/ibizlab/core/oauth2/config/OAuth2TokenAdapter.java',
];

function readPrivate(path) {
  const descriptor = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(descriptor);
    assert.ok(stat.isFile() && stat.uid === process.geteuid() && (stat.mode & 0o077) === 0);
    return fs.readFileSync(descriptor);
  } finally { fs.closeSync(descriptor); }
}

function writePrivate(path, data) {
  const descriptor = fs.openSync(path, fs.constants.O_WRONLY | fs.constants.O_CREAT
    | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try { fs.writeFileSync(descriptor, data); fs.fsyncSync(descriptor); }
  finally { fs.closeSync(descriptor); }
}

export function nativeApiClientBody(clientId, clientName, secret) {
  assert.match(clientId, /^a04_[a-f0-9]{24}$/);
  assert.equal(clientName, `A04 native client ${clientId.slice(4)}`);
  assert.match(secret, /^[a-f0-9]{64}$/);
  return { client_id: clientId, client_name: clientName, client_secret: secret,
    scope: 'all', authorized_grant_types: 'client_credentials', authorities: '',
    access_token_validity: 60 };
}

export function projectNativeApiClient(value) {
  return { clientId: value?.client_id ?? null, clientName: value?.client_name ?? null,
    scope: value?.scope ?? null, grants: value?.authorized_grant_types ?? null,
    authorities: value?.authorities ?? null, accessTokenValidity: value?.access_token_validity ?? null,
    secretPresent: typeof value?.client_secret === 'string' && value.client_secret.length > 0 };
}

export function validateNativeApiClientReadback(value, body) {
  const projected = projectNativeApiClient(value);
  assertNativeApiClientOwnership(value, body);
  assert.equal(projected.scope, 'all');
  assert.equal(projected.grants, 'client_credentials');
  assert.ok(projected.authorities === '' || projected.authorities === null,
    'The own client unexpectedly gained authorities');
  assert.equal(projected.accessTokenValidity, 60);
  return projected;
}

export function assertNativeApiClientOwnership(value, body) {
  assert.equal(value?.client_id, body.client_id);
  assert.equal(value?.client_name, body.client_name);
  assert.ok(typeof value?.client_secret === 'string'
    && hash(value.client_secret) === hash(body.client_secret), 'The native secret binding changed');
}

export function validateNativeApiClientGrant(value, clientId) {
  assert.ok(typeof value?.access_token === 'string' && value.access_token.trim().length > 0
    && value.access_token.length < 32768);
  assert.equal(value?.token_type?.toLowerCase(), 'bearer');
  assert.ok(Number.isInteger(value?.expires_in) && value.expires_in > 1
    && value.expires_in <= 60);
  assert.ok(!value?.refresh_token, 'The client_credentials-only client gained a refresh token');
  assert.equal(value?.user?.id, clientId);
  assert.ok(Array.isArray(value?.user?.grants), 'The native client grant identity is missing');
  assert.ok(value.user.grants.every(system => Array.isArray(system.roles)),
    'The native client role collections are missing');
  const actualRoles = value.user.grants.flatMap(system => system.roles);
  assert.equal(actualRoles.length, 0, 'The native client token unexpectedly gained roles');
  return { issued: true, grantType: 'client_credentials', expiresIn: value.expires_in,
    nativeClientIdentityMatched: true, authorities: actualRoles.map(role => role.authority),
    refreshTokenIssued: false, tokenSha256: hash(value.access_token) };
}

export function validateNativeApiClientIntrospection(value, clientId) {
  assert.equal(value?.client_id, clientId);
  assert.ok(value?.active === undefined || value.active === true);
  assert.ok(value?.user_name === undefined || value.user_name === null || value.user_name === '',
    'Native client introspection unexpectedly contains a human username');
  return { clientMatched: true, active: value.active ?? null, nativeStatus: 200, clientOnly: true };
}

export function nativeApiClientVerdict(report) {
  if (report.cleanupFailure) return 'FAILED_CLEANUP';
  if (report.failure) return 'FAILED_NATIVE_CLIENT_FLOW';
  if (report.cleanup?.clientAbsent !== true) return 'FAILED_CLEANUP';
  if (report.token?.issued !== true || report.checkToken?.clientMatched !== true
    || report.checkToken?.clientOnly !== true
    || report.wrongBasicRejected !== true) return 'FAILED_NATIVE_CLIENT_FLOW';
  if (report.afterDelete?.oldTokenRejected !== true
    || report.afterDelete?.newGrantRejected !== true) return 'CLIENT_REMOVED_REVOCATION_FAILED';
  if (report.afterDelete?.revocationBeforeConservativeExpiry !== true) {
    return 'CLIENT_REMOVED_REVOCATION_TIMING_UNVERIFIED';
  }
  if (report.runtimeUnchanged !== true) return 'FAILED_RUNTIME_DRIFT';
  if (report.verifyExpiry) return report.expiry?.expiredTokenRejected === true
    && report.expiry?.sameClientReauthorized === true && report.expiry?.renewedTokenChecked === true
    ? 'PASS_NATIVE_CLIENT_EXPIRY_RECOVERY_AND_REVOCATION' : 'FAILED_NATURAL_EXPIRY_OR_RECOVERY';
  return 'PASS_NATIVE_CLIENT_CREATED_VERIFIED_AND_REVOKED';
}

export function nativeClientRevocationTiming(grantStartedMonotonicMs, expiresIn, checkCompletedMonotonicMs) {
  assert.ok(Number.isFinite(grantStartedMonotonicMs) && grantStartedMonotonicMs >= 0);
  assert.ok(Number.isInteger(expiresIn) && expiresIn > 1 && expiresIn <= 60);
  assert.ok(Number.isFinite(checkCompletedMonotonicMs)
    && checkCompletedMonotonicMs >= grantStartedMonotonicMs);
  const conservativeExpiryMonotonicMs = grantStartedMonotonicMs + (expiresIn - 1) * 1000;
  return { grantStartedMonotonicMs, checkCompletedMonotonicMs, conservativeExpiryMonotonicMs,
    completedBeforeConservativeExpiry: checkCompletedMonotonicMs < conservativeExpiryMonotonicMs };
}

export async function provisionNativeApiClient(options = {}) {
  assert.ok(Object.keys(options).every(key => ['output', 'request', 'execute', 'verifyExpiry'].includes(key)),
    'Client IDs, secrets, grants, roles and target endpoints cannot be overridden');
  const { output, verifyExpiry = false, request = fetch, execute = (program, args) => spawnSync(program, args,
    { encoding: 'utf8', timeout: 15000, maxBuffer: 4 * 1024 * 1024 }) } = options;
  const destination = resolve(output);
  assert.equal(typeof verifyExpiry, 'boolean');
  assert.equal(dirname(destination), join(root, '.artifacts'));
  assert.match(basename(destination), /^native-api-client-[A-Za-z0-9-]+$/);
  assert.ok(!fs.existsSync(destination));
  for (let path = dirname(destination); ; path = dirname(path)) {
    const stat = fs.lstatSync(path);
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink());
    if (dirname(path) === path) break;
  }
  const credentialBytes = readPrivate(join(root,
    '.artifacts/current-business-actors-20261122-r1/credentials.private.json'));
  const admin = JSON.parse(credentialBytes);
  const sources = sourcePaths.map(path => ({ path, data: fs.readFileSync(join(root, path)) }));
  const bindings = sources.map((source, index) => ({ path: source.path, sha256: hash(source.data),
    bytes: source.data.length, privateSnapshotPath: `source/${index}-${basename(source.path)}` }));
  const readSource = suffix => fs.readFileSync(join(root,
    `standalone-uaa/source/${suffix}`), 'utf8');
  const domain = readSource('uaa-core/src/main/java/cn/ibizlab/core/oauth2/domain/OauthClientDetails.java');
  const mapper = readSource('uaa-core/src/main/resources/mapper/oauth2/OauthClientDetails/OauthClientDetailsMapper.xml');
  assert.doesNotMatch(domain, /TableLogic|@TableField\("enabled"\)/);
  assert.match(mapper, /delete from oauth_client_details/);
  const runtime = () => {
    const inspected = execute('docker', ['inspect', 'ibizlab-uaa-api']);
    assert.equal(inspected.status, 0, 'Existing native UAA inspection failed');
    const rows = JSON.parse(inspected.stdout);
    assert.equal(rows.length, 1);
    return nativeActorRuntimeIdentity(rows[0], root);
  };
  const before = runtime();
  const nonce = randomBytes(12).toString('hex');
  const clientId = `a04_${nonce}`;
  const clientName = `A04 native client ${nonce}`;
  const secret = randomBytes(32).toString('hex');
  const body = nativeApiClientBody(clientId, clientName, secret);
  fs.mkdirSync(destination, { mode: 0o700 });
  fs.mkdirSync(join(destination, 'source'), { mode: 0o700 });
  for (const [index, source] of sources.entries()) {
    writePrivate(join(destination, bindings[index].privateSnapshotPath), source.data);
  }
  const provisioner = sources.find(source => source.path === 'scripts/provision-native-api-client.mjs');
  const testBinding = bindings.find(binding => binding.path === 'scripts/tests/provision-native-api-client.test.mjs');
  writePrivate(join(destination, 'executed-provisioner.private.mjs'), provisioner.data);
  writePrivate(join(destination, 'credentials.planned.private.json'),
    json({ contract: 'native-api-client-private-credentials-v1', status: 'PLANNED',
      clientId, clientSecret: secret, grantType: 'client_credentials', authorities: [],
      scope: 'all', accessTokenValidity: 60, humanPrincipal: false }));
  const report = { contract: 'native-api-client-provision-v1', status: 'RUNNING',
    startedAt: new Date().toISOString(), clientId, clientName, humanPrincipal: false,
    humanRolesChanged: false, privilegedAuthoritiesRequested: false, sqlUsed: false,
    directDatabaseWrites: 0, sourceBindings: bindings, runtimeBefore: before,
    adminCredentialSha256: hash(credentialBytes), requests: [], token: { issued: false },
    cleanup: { clientAbsent: false }, afterDelete: {}, standaloneOrigin: uaa,
    cloudChain: { executed: false,
      reason: 'Cloud /uaa/oauth/token separately requires an API principal; this client has no API or superuser authority.' },
    tokenValuesRetained: false, basicHeadersRetained: false, clientSecretInReport: false };
  report.execution = { provisionerSnapshot: 'executed-provisioner.private.mjs',
    provisionerSha256: hash(provisioner.data), testScriptPath: testBinding.path,
    testScriptSha256: testBinding.sha256, nodeVersion: process.version,
    snapshotsPrivateOnly: true, sourceSnapshotCount: bindings.length };
  report.verifyExpiry = verifyExpiry;
  let adminToken;
  let accessToken;
  let clientCreated = false;
  let createDispatched = false;
  let latestGrant;
  let phase = 'normal-admin-login';
  const guard = () => {
    assert.deepEqual(runtime(), before, 'Existing native UAA runtime changed');
    for (const binding of bindings) {
      assert.equal(hash(fs.readFileSync(join(root, binding.path))), binding.sha256);
      assert.equal(hash(readPrivate(join(destination, binding.privateSnapshotPath))), binding.sha256);
    }
    assert.equal(hash(readPrivate(join(destination, 'executed-provisioner.private.mjs'))),
      report.execution.provisionerSha256);
  };
  guard();
  report.execution.sourceSnapshotsVerifiedBefore = true;
  const call = async (label, path, { method = 'GET', data, bearer = adminToken,
    basicSecret, form, allowStatus = [200] } = {}) => {
    guard();
    const isWrite = path === '/oauth_client_details' && method === 'POST' || method === 'DELETE';
    if (isWrite) writePrivate(join(destination,
      `intent-${String(report.requests.length).padStart(3, '0')}.private.json`),
    json({ label, path, method, clientId, clientName, bodySha256: data ? hash(json(data)) : null,
      secretRecorded: false, recordedBeforeDispatch: true }));
    if (path === '/oauth_client_details' && method === 'POST') createDispatched = true;
    const startedMonotonicMs = performance.now();
    const response = await request(path === '/normal-login' ? normalLogin : `${uaa}${path}`, {
      method, headers: { accept: 'application/json',
        'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json',
        ...(basicSecret !== undefined ? {
          authorization: `Basic ${Buffer.from(`${clientId}:${basicSecret}`).toString('base64')}`,
        } : bearer ? { authorization: `Bearer ${bearer}` } : {}) },
      ...(form ? { body: new URLSearchParams(form).toString() }
        : data === undefined ? {} : { body: JSON.stringify(data) }),
      redirect: 'error', signal: AbortSignal.timeout(15000),
    });
    const raw = Buffer.from(await response.arrayBuffer());
    const completedMonotonicMs = performance.now();
    assert.ok(raw.length <= 2 * 1024 * 1024);
    let value;
    try { value = JSON.parse(raw.toString()); } catch { value = null; }
    const summary = { label, method, path: path === '/normal-login' ? '/v7/login' : path,
      status: response.status, bytes: raw.length, sha256: hash(raw),
      startedMonotonicMs, completedMonotonicMs, durationMs: completedMonotonicMs - startedMonotonicMs,
      errorCode: typeof value?.error === 'string' && /^[a-z_]{1,50}$/.test(value.error) ? value.error : null };
    report.requests.push(summary);
    guard();
    if (!allowStatus.includes(response.status)) {
      const error = new Error(`${label}: HTTP ${response.status}`);
      error.summary = summary;
      throw error;
    }
    return { status: response.status, value, summary, startedMonotonicMs, completedMonotonicMs };
  };
  const readClient = label => call(label, `/oauth_client_details/${encodeURIComponent(clientId)}`,
    { allowStatus: [200, 404] });
  const listClient = label => call(label, '/oauth_client_details/fetchdefault',
    { method: 'POST', data: { n_client_id_eq: clientId, page: 0, size: 20 } });
  const grant = (label, suppliedSecret, allowStatus) => call(label, '/oauth/token',
    { method: 'POST', bearer: null, basicSecret: suppliedSecret,
      form: { grant_type: 'client_credentials', scope: 'all' }, allowStatus });
  const introspect = (label, allowStatus) => call(label, '/oauth/check_token',
    { method: 'POST', bearer: null, form: { token: accessToken }, allowStatus });
  try {
    const login = await call('normal-admin-login', '/normal-login',
      { method: 'POST', bearer: null, data: { loginname: admin.username, password: admin.password } });
    adminToken = login.value?.token;
    assert.ok(typeof adminToken === 'string' && adminToken.length < 32768);
    const self = await call('native-admin-self', '/auths/user-info/self');
    const authorities = (self.value?.roles ?? []).flatMap(system =>
      (system.roles ?? []).map(role => role.authority));
    assert.ok(authorities.includes('ROLE_SUPERADMIN')
      || ['Create', 'Get', 'Remove', 'FetchDefault'].every(action =>
        authorities.includes(`uaa-OauthClientDetails-${action}-all`)),
    'Current normal administrator does not hold native client management authority');
    report.nativeManagementAuthorityVerified = true;
    phase = 'exact-native-preflight';
    const existing = await readClient('preflight-client-get');
    assert.equal(existing.status, 404, 'The planned own client ID already exists');
    const key = await call('preflight-client-checkkey', '/oauth_client_details/checkkey',
      { method: 'POST', data: { client_id: clientId } });
    assert.equal(key.value, 0);
    const existingRows = await listClient('preflight-client-fetch');
    assert.ok(Array.isArray(existingRows.value) && existingRows.value.length === 0);
    const deployment = await call('preflight-deploy-system-collision',
      `/sys_deploy_systems/${encodeURIComponent(clientId)}`, { allowStatus: [404] });
    report.preflight = { exactGetStatus: existing.status, checkKey: key.value,
      exactFetchRows: existingRows.value.length, deploySystemStatus: deployment.status,
      disabledRowsOmitted: false, sourceHasLogicalDelete: false,
      nativeDeleteIsPhysical: true, nativeCurrentDatasourceExactClientKey: true,
      allRealmsVerified: false };
    phase = 'native-client-create';
    try {
      const created = await call('native-client-create', '/oauth_client_details',
        { method: 'POST', data: body });
      if (created.value?.client_id === clientId) clientCreated = true;
      report.created = validateNativeApiClientReadback(created.value, body);
    } catch (error) {
      if (createDispatched) {
        const recovered = await readClient('failed-create-independent-readback');
        if (recovered.status === 200) {
          assertNativeApiClientOwnership(recovered.value, body);
          clientCreated = true;
          report.recoveredAfterFailedCreate = validateNativeApiClientReadback(recovered.value, body);
        }
        report.failedCreateReadbackStatus = recovered.status;
      }
      throw error;
    }
    const current = await readClient('native-client-independent-readback');
    assert.equal(current.status, 200);
    report.readback = validateNativeApiClientReadback(current.value, body);
    phase = 'client-credentials-grant';
    const granted = await grant('client-credentials-correct-basic', secret, [200]);
    latestGrant = granted;
    const grantedProjection = validateNativeApiClientGrant(granted.value, clientId);
    accessToken = granted.value?.access_token;
    report.token = { ...grantedProjection, grantedStartedMonotonicMs: granted.startedMonotonicMs,
      grantedCompletedMonotonicMs: granted.completedMonotonicMs };
    const wrongSecret = randomBytes(32).toString('hex');
    assert.notEqual(hash(wrongSecret), hash(secret));
    const wrong = await grant('client-credentials-wrong-basic', wrongSecret, [400, 401]);
    assert.ok(!wrong.value?.access_token);
    report.wrongBasicRejected = true;
    phase = 'native-token-introspection';
    const checked = await introspect('native-check-token-before-delete', [200]);
    report.checkToken = validateNativeApiClientIntrospection(checked.value, clientId);
    if (verifyExpiry) {
      phase = 'natural-expiry-wait';
      report.initialToken = { ...report.token };
      report.initialCheckToken = { ...report.checkToken };
      report.expiry = { waitStages: [], actualExpiresIn: granted.value.expires_in,
        expiredTokenRejected: false, sameClientReauthorized: false, renewedTokenChecked: false };
      const waitUntil = performance.now() + (granted.value.expires_in + 2) * 1000;
      for (let part = 0; performance.now() < waitUntil; part += 1) {
        const stageStarted = performance.now();
        const duration = Math.min(20000, Math.max(0, waitUntil - stageStarted));
        await new Promise(resolveWait => setTimeout(resolveWait, duration));
        const stage = { part, startedMonotonicMs: stageStarted, completedMonotonicMs: performance.now(),
          requestedWaitMs: duration, maxSegmentMs: 20000 };
        report.expiry.waitStages.push(stage);
        writePrivate(join(destination, `expiry-wait-${part}.private.json`), json(stage));
        console.log(JSON.stringify({ stage: 'native-client-natural-expiry-wait', part,
          remainingMs: Math.max(0, Math.ceil(waitUntil - performance.now())) }));
      }
      phase = 'natural-expired-token-check';
      const expired = await introspect('native-check-token-after-natural-expiry', [400, 401, 403]);
      report.expiry.expiredTokenRejected = !expired.value?.active && expired.status !== 200;
      report.expiry.expiredTokenStatus = expired.status;
      report.expiry.expiredTokenCheckStartedMonotonicMs = expired.startedMonotonicMs;
      report.expiry.expiredTokenCheckCompletedMonotonicMs = expired.completedMonotonicMs;
      phase = 'same-client-reauthorization';
      const renewed = await grant('client-credentials-same-client-after-expiry', secret, [200]);
      const renewedProjection = validateNativeApiClientGrant(renewed.value, clientId);
      const renewedToken = renewed.value?.access_token;
      assert.notEqual(hash(renewedToken), hash(accessToken));
      report.expiry.sameClientReauthorized = true;
      accessToken = renewedToken;
      latestGrant = renewed;
      report.token = { ...renewedProjection, grantedStartedMonotonicMs: renewed.startedMonotonicMs,
        grantedCompletedMonotonicMs: renewed.completedMonotonicMs };
      const renewedCheck = await introspect('native-check-renewed-token', [200]);
      report.checkToken = validateNativeApiClientIntrospection(renewedCheck.value, clientId);
      report.expiry.renewedIntrospection = { ...report.checkToken };
      report.expiry.renewedTokenChecked = true;
    }
    phase = 'native-client-delete';
    const beforeDelete = await readClient('native-client-before-delete');
    validateNativeApiClientReadback(beforeDelete.value, body);
    const deletion = await call('native-client-delete', `/oauth_client_details/${encodeURIComponent(clientId)}`,
      { method: 'DELETE' });
    clientCreated = false;
    const afterGet = await readClient('native-client-absence');
    const afterRows = await listClient('native-client-fetch-absence');
    assert.ok(Array.isArray(afterRows.value));
    report.cleanup = { clientAbsent: afterGet.status === 404 && afterRows.value.length === 0,
      nativeGetStatus: afterGet.status, exactFetchRows: afterRows.value.length,
      clientSecretRetired: true, deleteStartedMonotonicMs: deletion.startedMonotonicMs,
      deleteCompletedMonotonicMs: deletion.completedMonotonicMs };
    phase = 'revocation-verification';
    const oldToken = await introspect('native-check-token-after-client-delete', [200, 400, 401, 403]);
    report.afterDelete.oldTokenStatus = oldToken.status;
    report.afterDelete.oldTokenRejected = oldToken.status !== 200;
    report.afterDelete.oldTokenStillActive = oldToken.status === 200;
    const timing = nativeClientRevocationTiming(latestGrant.startedMonotonicMs,
      latestGrant.value.expires_in, oldToken.completedMonotonicMs);
    report.afterDelete.revocationTiming = timing;
    report.afterDelete.revocationBeforeConservativeExpiry = timing.completedBeforeConservativeExpiry;
    const newGrant = await grant('client-credentials-after-client-delete', secret, [400, 401, 403]);
    report.afterDelete.newGrantStatus = newGrant.status;
    report.afterDelete.newGrantRejected = !newGrant.value?.access_token && newGrant.status !== 200;
  } catch (error) {
    report.failedPhase = phase;
    report.failure = { type: error.name, message: String(error.message).slice(0, 250),
      summary: error.summary ?? null };
  } finally {
    if (adminToken && clientCreated) {
      try {
        const current = await readClient('failure-cleanup-native-readback');
        if (current.status === 200) {
          assertNativeApiClientOwnership(current.value, body);
          await call('failure-cleanup-client-delete',
            `/oauth_client_details/${encodeURIComponent(clientId)}`, { method: 'DELETE' });
        }
        const absence = await readClient('failure-cleanup-client-absence');
        const rows = await listClient('failure-cleanup-exact-fetch');
        assert.ok(Array.isArray(rows.value));
        report.cleanup = { clientAbsent: absence.status === 404 && rows.value.length === 0,
          nativeGetStatus: absence.status, exactFetchRows: rows.value.length, clientSecretRetired: true };
      } catch (error) {
        report.cleanupFailure = { type: error.name, message: String(error.message).slice(0, 200) };
      }
    }
    report.runtimeAfter = runtime();
    report.runtimeUnchanged = JSON.stringify(report.runtimeAfter) === JSON.stringify(before);
    report.execution.sourceSnapshotsVerifiedAfter = true;
    report.execution.sourceAfter = bindings.map(binding => {
      let currentSha256 = null;
      let snapshotSha256 = null;
      try {
        currentSha256 = hash(fs.readFileSync(join(root, binding.path)));
        snapshotSha256 = hash(readPrivate(join(destination, binding.privateSnapshotPath)));
      } catch {
        report.execution.sourceSnapshotsVerifiedAfter = false;
      }
      const unchanged = currentSha256 === binding.sha256 && snapshotSha256 === binding.sha256;
      if (!unchanged) report.execution.sourceSnapshotsVerifiedAfter = false;
      return { path: binding.path, currentSha256, snapshotSha256, unchanged };
    });
    try {
      assert.equal(hash(readPrivate(join(destination, 'executed-provisioner.private.mjs'))),
        report.execution.provisionerSha256);
    } catch { report.execution.sourceSnapshotsVerifiedAfter = false; }
    if (!report.execution.sourceSnapshotsVerifiedAfter) report.failure ??= {
      type: 'SourceSnapshotDrift', message: 'An executed source or its private snapshot changed' };
    report.status = nativeApiClientVerdict(report);
    report.finishedAt = new Date().toISOString();
    report.singleClientNamespace = true;
    writePrivate(join(destination, 'report.private.json'), json(report));
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { output: { type: 'string' },
    'verify-expiry': { type: 'boolean', default: false } }, strict: true });
  try {
    const report = await provisionNativeApiClient({ output: values.output, verifyExpiry: values['verify-expiry'] });
    console.log(JSON.stringify({ status: report.status, failedPhase: report.failedPhase ?? null,
      tokenIssued: report.token.issued, wrongBasicRejected: report.wrongBasicRejected ?? false,
      clientAbsent: report.cleanup.clientAbsent, afterDelete: report.afterDelete,
      runtimeUnchanged: report.runtimeUnchanged }));
    if (!['PASS_NATIVE_CLIENT_CREATED_VERIFIED_AND_REVOKED',
      'PASS_NATIVE_CLIENT_EXPIRY_RECOVERY_AND_REVOCATION'].includes(report.status)) process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ status: 'REFUSED', type: error.name, rawErrorWithheld: true }));
    process.exitCode = 1;
  }
}
