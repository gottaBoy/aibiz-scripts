import assert from 'node:assert/strict';
import test from 'node:test';
import { assertNativeProductAdministratorBinding } from '../provision-native-product-administrator.mjs';
import { assertNoActorCollision, nativeActorCollisionSQL } from '../provision-existing-native-actors.mjs';

test('object administrator is bound only to the exact own product and actual PLM user', () => {
  const member = { id: 'own-member', product_id: 'own-product', user_id: 'actual-user', role_id: 'admin' };
  assert.doesNotThrow(() => assertNativeProductAdministratorBinding(member, 'own-product', 'actual-user'));
  for (const changed of [
    { ...member, product_id: 'foreign' }, { ...member, user_id: 'other-user' },
    { ...member, role_id: 'ROLE_SUPERADMIN' }, { ...member, id: undefined },
  ]) assert.throws(() => assertNativeProductAdministratorBinding(changed, 'own-product', 'actual-user'));
});

test('object admin namespace receives the same physical tombstone collision guard', () => {
  assert.match(nativeActorCollisionSQL('nat_123456789abc_objectadmin'), /START TRANSACTION READ ONLY/);
  assert.throws(() => assertNoActorCollision({ idRows: 1, uidRows: 1, employeeNumberRows: 1,
    activeRows: 0, disabledRows: 1 }));
});
