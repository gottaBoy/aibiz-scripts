import assert from 'node:assert/strict';
import test from 'node:test';
import { nativeRetainedCleanupVerdict } from '../cleanup-existing-native-actors.mjs';

test('retained fixture cleanup requires every own relation, product and native tombstone', () => {
  const person = { deleteStatus: 200, readbackStatus: 404, nativeMemberRows: 0, nativeRoleRows: 0,
    physicalCounts: { activeRows: 0, disabledRows: 1 } };
  const member = { deleteStatus: 200, remainingRows: 0 };
  const report = { persons: [person, person, person], productMembers: [member, member],
    productAbsent: true, organizationRoleAbsent: true };
  assert.equal(nativeRetainedCleanupVerdict(report), 'PASS');
  assert.equal(nativeRetainedCleanupVerdict({ ...report, expectedPersons: 4, expectedProductMembers: 3,
    persons: [person, person, person, person], productMembers: [member, member, member] }), 'PASS');
  assert.equal(nativeRetainedCleanupVerdict({ ...report, crossOrganizationId: 'own-cross-org',
    crossOrganizationAbsent: true, crossOrganizationRoleAbsent: true }), 'PASS');
  assert.equal(nativeRetainedCleanupVerdict({ ...report, crossOrganizationId: 'own-cross-org',
    crossOrganizationAbsent: true, crossOrganizationRoleAbsent: false }), 'FAILED');
  for (const altered of [
    { ...report, persons: [person, person] }, { ...report, productMembers: [member] },
    { ...report, productAbsent: false }, { ...report, organizationRoleAbsent: false },
    { ...report, persons: [person, person, { ...person, nativeRoleRows: 1 }] },
    { ...report, productMembers: [member, { ...member, remainingRows: 1 }] },
  ]) assert.equal(nativeRetainedCleanupVerdict(altered), 'FAILED');
});
