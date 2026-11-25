import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  assessAutomaticAuthorities, assessProductMemberCount, assertNoActorCollision, buildNativePersonBody,
  nativeActorCleanupVerdict, nativeActorCollisionSQL, projectNativeActorEvidence, provisionExistingNativeActors,
} from '../provision-existing-native-actors.mjs';

const candidate = { plannedUid: 'nat_test_ordinary', plannedDisplayName: 'Native test ordinary' };

test('native Person body binds only actual organization role and never privileged role fields', () => {
  assert.deepEqual(buildNativePersonBody(candidate, 'private-secret', 'own-org', 'ordinary-role', null), {
    uid: 'nat_test_ordinary', display_name: 'Native test ordinary', user_password: 'private-secret',
    employee_number: 'nat_test_ordinary',
    organization_id: 'own-org', organizational_role_id: 'ordinary-role', status: '1',
  });
  assert.deepEqual(buildNativePersonBody(candidate, 'private-secret', 'own-org', null, null), {
    uid: 'nat_test_ordinary', display_name: 'Native test ordinary', user_password: 'private-secret',
    employee_number: 'nat_test_ordinary', organization_id: 'own-org',
    member_of: [{ organization_id: 'own-org', sort: 1 }], status: '1',
  });
  assert.throws(() => buildNativePersonBody(candidate, 'private-secret', '000000', 'ROLE_SUPERADMIN', null));
});

test('physical collision check is read-only and includes disabled rows and every realm', () => {
  const sql = nativeActorCollisionSQL('nat_123456789abc_ordinary');
  assert.match(sql, /^START TRANSACTION READ ONLY;/);
  assert.match(sql, /`UID`/);
  assert.match(sql, /`ID`/);
  assert.match(sql, /`EMPLOYEE_NUMBER`/);
  assert.match(sql, /`ENABLED`=0/);
  assert.doesNotMatch(sql, /BINARY/, 'Use native column collation so equivalent keys also collide');
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|ALTER|DROP)\b/i);
  assert.doesNotMatch(sql, /`DC`|AND\s+`ENABLED`/);
  assert.throws(() => nativeActorCollisionSQL("nat_123456789abc_ordinary';DELETE"));
  const counts = { uidRows: 0, idRows: 0, employeeNumberRows: 0, activeRows: 0, disabledRows: 0 };
  assert.doesNotThrow(() => assertNoActorCollision(counts));
  for (const key of Object.keys(counts)) {
    assert.throws(() => assertNoActorCollision({ ...counts, [key]: 1 }));
  }
});

test('report actor projection cannot contain candidate or issued credentials', () => {
  const projected = projectNativeActorEvidence({ candidate: { ...candidate, actorKey: 'ordinary',
    candidatePassword: 'hidden-a' }, credentials: { password: 'hidden-b' },
  issuedPersonId: 'own-id', plmUserId: 'own-id', cleanup: {} });
  assert.doesNotMatch(JSON.stringify(projected), /hidden-|candidatePassword|password|credentials/);
  assert.equal(projected.credentialStatus, 'PRIVATE_SEPARATE_FILE');
});

test('logical cleanup needs independent absence, empty associations and matching counts', () => {
  const report = { usersCreated: 1, usersCleaned: 1,
    productMembersCreated: 0, productMembersCleaned: 0 };
  const cleanup = { personDeleteStatus: 200, personReadbackStatus: 404,
    nativeMemberRows: 0, nativeRoleRows: 0 };
  const entry = { issuedPersonId: 'own-id', cleanup };
  assert.equal(nativeActorCleanupVerdict(report, { ordinary: entry }), 'PASS_NATIVE_LOGICAL_DELETE');
  for (const altered of [
    { ...cleanup, personReadbackStatus: undefined }, { ...cleanup, nativeMemberRows: 1 },
    { ...cleanup, nativeRoleRows: 1 }, { ...cleanup, personDeleteStatus: undefined },
  ]) {
    assert.equal(nativeActorCleanupVerdict(report, { ordinary: { ...entry, cleanup: altered } }), 'BLOCKED');
  }
  assert.equal(nativeActorCleanupVerdict({ ...report, usersCleaned: 0 }, { ordinary: entry }), 'BLOCKED');
  assert.equal(nativeActorCleanupVerdict({ ...report, creationOutcomeUncertain: true },
    { ordinary: entry }), 'BLOCKED');
});

test('automatic ROLE_USERS and product member expectations fail closed', () => {
  assert.deepEqual(assessAutomaticAuthorities(['ROLE_USERS']), { roleUsers: true, privilegedRoles: false });
  for (const authorities of [[], ['ROLE_APIUSERS'], ['ROLE_USERS', 'ROLE_SUPERADMIN']]) {
    assert.throws(() => assessAutomaticAuthorities(authorities));
  }
  assert.deepEqual(assessProductMemberCount('ordinary', 1), { expected: 1, actual: 1 });
  assert.deepEqual(assessProductMemberCount('readonly', 1), { expected: 1, actual: 1 });
  assert.deepEqual(assessProductMemberCount('nonmember', 0), { expected: 0, actual: 0 });
  assert.throws(() => assessProductMemberCount('ordinary', 0));
  assert.throws(() => assessProductMemberCount('nonmember', 1));
});

test('apply, SQL, identity and unsafe output overrides are rejected before inspection', async () => {
  let commands = 0;
  let requests = 0;
  const execute = () => { commands += 1; throw Error('must not run'); };
  const request = () => { requests += 1; throw Error('must not run'); };
  const base = join(process.cwd(), '.artifacts');
  for (const options of [
    { apply: true }, { sql: true }, { role: 'ROLE_SUPERADMIN' },
    { identityHeaders: { srforgid: 'foreign' } },
    { output: '/tmp/native-actors-unowned' },
    { output: join(base, `unreviewed-native-actors-${randomBytes(4).toString('hex')}`) },
  ]) {
    await assert.rejects(provisionExistingNativeActors({ ...options, execute, request }));
  }
  assert.equal(commands, 0);
  assert.equal(requests, 0);
});
