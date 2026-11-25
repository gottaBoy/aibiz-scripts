import assert from 'node:assert/strict';
import test from 'node:test';
import { nativeApiClientBody, projectNativeApiClient, validateNativeApiClientReadback,
  nativeApiClientVerdict, provisionNativeApiClient,
  nativeClientRevocationTiming, validateNativeApiClientGrant,
  validateNativeApiClientIntrospection } from '../provision-native-api-client.mjs';

const id = 'a04_1234567890abcdef12345678';
const name = 'A04 native client 1234567890abcdef12345678';
const secret = 'a'.repeat(64);

test('native client has only client_credentials, no human role and a short native TTL', () => {
  const body = nativeApiClientBody(id, name, secret);
  assert.equal(body.authorized_grant_types, 'client_credentials');
  assert.equal(body.authorities, '');
  assert.equal(body.access_token_validity, 60);
  assert.equal(body.scope, 'all');
  assert.doesNotMatch(JSON.stringify(body), /password|ROLE_APIUSERS|ROLE_SUPERADMIN|username|person/);
  assert.throws(() => nativeApiClientBody('ibzuaa', name, secret));
  assert.throws(() => nativeApiClientBody(id, 'other-owned-name', secret));
  assert.throws(() => nativeApiClientBody(id, name, 'guessed'));
});

test('first and renewed native grants must both retain the exact client with no roles or refresh token', () => {
  const grant = { access_token: 'native-client-token', token_type: 'bearer', expires_in: 59,
    user: { id, grants: [{ roles: [] }] } };
  const projection = validateNativeApiClientGrant(grant, id);
  assert.equal(projection.nativeClientIdentityMatched, true);
  assert.deepEqual(projection.authorities, []);
  assert.doesNotMatch(JSON.stringify(projection), /native-client-token/);
  for (const changed of [
    { ...grant, access_token: '' }, { ...grant, access_token: ' \t\n' },
    { ...grant, refresh_token: 'unexpected-refresh' },
    { ...grant, expires_in: 3600 },
    { ...grant, user: { ...grant.user, id: 'foreign-client' } },
    { ...grant, user: { id, grants: [{ roles: [{ authority: 'ROLE_APIUSERS' }] }] } },
    { ...grant, user: { id, grants: [{ roles: [{ role_id: 'privileged', authority: null }] }] } },
    { ...grant, user: { id, grants: [{}] } },
  ]) assert.throws(() => validateNativeApiClientGrant(changed, id));
  assert.equal(validateNativeApiClientIntrospection({ client_id: id, active: true }, id).clientOnly, true);
  assert.equal(validateNativeApiClientIntrospection({ client_id: id, user_name: '' }, id).clientOnly, true);
  for (const changed of [{ client_id: id, user_name: 'human-user' },
    { client_id: id, user_name: ' ' }, { client_id: id, active: false }]) {
    assert.throws(() => validateNativeApiClientIntrospection(changed, id));
  }
});

test('native client readback binds exact nonhuman identity without exposing its secret', () => {
  const body = nativeApiClientBody(id, name, secret);
  assert.equal(validateNativeApiClientReadback(body, body).clientId, id);
  assert.doesNotMatch(JSON.stringify(projectNativeApiClient(body)), new RegExp(secret));
  for (const changed of [{ ...body, client_id: 'other' }, { ...body, authorities: 'ROLE_SUPERADMIN' },
    { ...body, authorized_grant_types: 'password' }, { ...body, access_token_validity: 7200 },
    { ...body, client_secret: 'b'.repeat(64) }]) {
    assert.throws(() => validateNativeApiClientReadback(changed, body));
  }
});

test('deleting the row cannot be reported as token revocation when an old token remains active', () => {
  const report = { cleanup: { clientAbsent: true }, token: { issued: true },
    checkToken: { clientMatched: true, clientOnly: true }, wrongBasicRejected: true, runtimeUnchanged: true,
    afterDelete: { oldTokenRejected: true, newGrantRejected: true,
      revocationBeforeConservativeExpiry: true } };
  assert.equal(nativeApiClientVerdict(report), 'PASS_NATIVE_CLIENT_CREATED_VERIFIED_AND_REVOKED');
  assert.equal(nativeApiClientVerdict({ ...report, afterDelete: {
    oldTokenRejected: false, newGrantRejected: true } }), 'CLIENT_REMOVED_REVOCATION_FAILED');
  assert.equal(nativeApiClientVerdict({ ...report, cleanup: { clientAbsent: false } }), 'FAILED_CLEANUP');
  assert.equal(nativeApiClientVerdict({ ...report, token: { issued: false } }), 'FAILED_NATIVE_CLIENT_FLOW');
  assert.equal(nativeApiClientVerdict({ ...report, failure: { type: 'Error' } }), 'FAILED_NATIVE_CLIENT_FLOW');
  assert.equal(nativeApiClientVerdict({ ...report, cleanupFailure: { type: 'Error' } }), 'FAILED_CLEANUP');
  assert.equal(nativeApiClientVerdict({ ...report, checkToken: {
    clientMatched: true, clientOnly: false } }), 'FAILED_NATIVE_CLIENT_FLOW');
  assert.equal(nativeApiClientVerdict({ ...report, verifyExpiry: true,
    expiry: { expiredTokenRejected: true, sameClientReauthorized: true, renewedTokenChecked: true } }),
  'PASS_NATIVE_CLIENT_EXPIRY_RECOVERY_AND_REVOCATION');
  assert.equal(nativeApiClientVerdict({ ...report, verifyExpiry: true,
    expiry: { expiredTokenRejected: true, sameClientReauthorized: false, renewedTokenChecked: false } }),
  'FAILED_NATURAL_EXPIRY_OR_RECOVERY');
});

test('revocation evidence after a conservative expiry boundary cannot pass as immediate revocation', () => {
  assert.equal(nativeClientRevocationTiming(100, 59, 900).completedBeforeConservativeExpiry, true);
  assert.equal(nativeClientRevocationTiming(100, 59, 58100).completedBeforeConservativeExpiry, false);
  assert.equal(nativeClientRevocationTiming(100, 59, 90000).completedBeforeConservativeExpiry, false);
  const report = { cleanup: { clientAbsent: true }, token: { issued: true },
    checkToken: { clientMatched: true, clientOnly: true }, wrongBasicRejected: true, runtimeUnchanged: true,
    afterDelete: { oldTokenRejected: true, newGrantRejected: true,
      revocationBeforeConservativeExpiry: false } };
  assert.equal(nativeApiClientVerdict(report), 'CLIENT_REMOVED_REVOCATION_TIMING_UNVERIFIED');
  assert.throws(() => nativeClientRevocationTiming(100, 59, 99));
  assert.throws(() => nativeClientRevocationTiming(100, 0, 900));
});

test('client override and unsafe output adapters are rejected before native inspection', async () => {
  let commands = 0;
  let requests = 0;
  const execute = () => { commands += 1; throw Error('must not run'); };
  const request = () => { requests += 1; throw Error('must not run'); };
  for (const options of [{ clientId: 'ibzuaa' }, { secret: 'override' },
    { authorities: 'ROLE_APIUSERS' }, { grant: 'password' }, { output: '/tmp/unowned-client' }]) {
    await assert.rejects(provisionNativeApiClient({ ...options, execute, request }));
  }
  assert.equal(commands, 0);
  assert.equal(requests, 0);
});
