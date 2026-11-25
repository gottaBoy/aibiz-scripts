import assert from 'node:assert/strict';
import test from 'node:test';
import {
  classifyNativeSelfResponse, nativeSelfRequest, probeNativeActorSelf,
  projectNativePerson, projectNativeSelf, readNativeSelfGraph,
} from '../probe-native-actor-self.mjs';

const self = () => ({ id: 'own-id', username: 'existing-user', dc: 'real-realm',
  organization_id: 'own-org', organizational_role_id: 'read-role',
  member_of: [{ organization_id: 'own-org', organizational_role_id: 'read-role', dc: 'real-realm' }],
  roles: [{ roles: [{ role_id: 'ROLE_SUPERADMIN', authority: 'ROLE_SUPERADMIN' }] }],
  super_user: 1, api_user: 0, password: 'never-retain-password', mail: 'private@example.invalid' });
const person = () => ({ id: 'own-id', uid: 'existing-user', dc: 'real-realm', organization_id: 'own-org',
  organizational_role_id: 'read-role', member_of: [{ id: 'member-id', person_id: 'own-id',
    dc: 'real-realm', organization_id: 'own-org', organizational_role_id: 'read-role' }],
  user_password: 'never-retain-hash', identification_number: 'never-retain-contact' });

test('direct native requests are GET with only a normal Bearer token and no identity overrides', () => {
  const init = nativeSelfRequest('normal-returned-token');
  assert.equal(init.method, 'GET');
  assert.equal(init.redirect, 'error');
  assert.deepEqual(init.headers, { accept: 'application/json', authorization: 'Bearer normal-returned-token' });
  assert.equal(init.body, undefined);
  for (const token of ['', 'with space', 'line\nbreak', 'x'.repeat(32768)]) {
    assert.throws(() => nativeSelfRequest(token));
  }
});

test('self/person projection binds current identity and strips password, hash and private contact fields', () => {
  const projected = projectNativeSelf(self(), 'existing-user');
  assert.equal(projected.id, 'own-id');
  assert.equal(projected.nativeSuperUserFlag, true);
  assert.equal(projected.effectiveAuthorityCollectionExposed, false);
  assert.deepEqual(projected.roleAuthoritiesReturnedByNativeSelf, ['ROLE_SUPERADMIN']);
  const actual = projectNativePerson(person(), projected, 'existing-user');
  assert.equal(actual.getAuthorizationAccepted, true);
  assert.ok(!JSON.stringify([projected, actual]).includes('never-retain'));
  assert.ok(!JSON.stringify([projected, actual]).includes('private@example.invalid'));
  assert.throws(() => projectNativeSelf(self(), 'other-user'));
  assert.throws(() => projectNativeSelf({ ...self(), id: '../foreign' }, 'existing-user'));
  assert.throws(() => projectNativePerson({ ...person(), id: 'foreign' }, projected, 'existing-user'));
  assert.throws(() => projectNativePerson({ ...person(), dc: 'other-realm' }, projected, 'existing-user'));
  assert.throws(() => projectNativePerson({ ...person(), uid: 'other-user' }, projected, 'existing-user'));
});

test('one exact native self rejection stops without a second prefix or any person query', async () => {
  for (const status of [401, 403, 404, 500]) {
    const paths = [];
    const result = await readNativeSelfGraph({ expectedUsername: 'existing-user',
      async read(path) { paths.push(path); return { status, data: { password: 'private' } }; } });
    assert.deepEqual(paths, ['/auths/user-info/self']);
    assert.equal(result.rootRouteProven, false);
    assert.equal(result.accountCreationAllowed, false);
    assert.equal(result.status, 'NATIVE_SELF_REJECTED_NO_ROUTE_FALLBACK');
    assert.ok(!JSON.stringify(result).includes('private'));
  }
  assert.equal(classifyNativeSelfResponse(401).classification, 'standalone-bearer-not-authenticated');
});

test('successful native self and owned read graph only follow returned IDs and never promote account creation', async () => {
  const calls = [];
  const data = new Map([
    ['/auths/user-info/self', self()], ['/sys_people/own-id', person()],
    ['/sys_organizations/own-org', { id: 'own-org', dc: 'real-realm' }],
    ['/sys_members/member-id', person().member_of[0]],
    ['/sys_organizational_roles/read-role', { id: 'read-role', organization_id: 'own-org', dc: 'real-realm' }],
  ]);
  const result = await readNativeSelfGraph({ expectedUsername: 'existing-user', async read(path) {
    calls.push(path);
    assert.ok(data.has(path));
    return { status: 200, data: data.get(path) };
  } });
  assert.deepEqual(calls, [...data.keys()]);
  assert.equal(result.rootRouteProven, true);
  assert.equal(result.personReadVerified, true);
  assert.equal(result.memberReadVerified, true);
  assert.equal(result.organizationalRoleReadVerified, true);
  assert.equal(result.ordinaryOrganizationRoleVerified, false);
  assert.equal(result.createRemoveAuthorizationTested, false);
  assert.equal(result.accountCreationAllowed, false);
  assert.equal(result.runtimeContractVerified, false);
});

test('synthetic self memberships cannot cause member GET or guessed role lookup', async () => {
  const calls = [];
  const ownPerson = person();
  ownPerson.member_of = [];
  const result = await readNativeSelfGraph({ expectedUsername: 'existing-user', async read(path) {
    calls.push(path);
    if (path === '/auths/user-info/self') return { status: 200, data: self() };
    if (path === '/sys_people/own-id') return { status: 200, data: ownPerson };
    assert.equal(path, '/sys_organizations/own-org');
    return { status: 200, data: { id: 'own-org', dc: 'real-realm' } };
  } });
  assert.equal(result.memberReadVerified, false);
  assert.equal(result.organizationalRoleReadVerified, false);
  assert.deepEqual(calls, ['/auths/user-info/self', '/sys_people/own-id', '/sys_organizations/own-org']);
});

test('cross-person member records and foreign organization reads fail before role lookup', async () => {
  const reads = [];
  await assert.rejects(readNativeSelfGraph({ expectedUsername: 'existing-user', async read(path) {
    reads.push(path);
    if (path === '/auths/user-info/self') return { status: 200, data: self() };
    return { status: 200, data: { ...person(), member_of: [{
      ...person().member_of[0], person_id: 'foreign-person',
    }] } };
  } }));
  assert.deepEqual(reads, ['/auths/user-info/self', '/sys_people/own-id']);
});

test('route, credentials, identity, apply and unsafe output overrides are rejected before external operations', async () => {
  let commands = 0;
  let requests = 0;
  for (const options of [{ apply: true }, { prefix: '/uaa' },
    { headers: { srforgid: 'foreign' } }, { credentialsPath: '/tmp/private' },
    { output: '/tmp/native-actor-self-unowned' }]) {
    await assert.rejects(probeNativeActorSelf({ ...options,
      execute() { commands += 1; throw Error('must not run'); },
      request() { requests += 1; throw Error('must not run'); } }));
  }
  assert.equal(commands, 0);
  assert.equal(requests, 0);
});
