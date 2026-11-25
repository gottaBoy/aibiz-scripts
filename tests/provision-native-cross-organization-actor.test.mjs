import assert from 'node:assert/strict';
import test from 'node:test';
import { nativeOrganizationNumberCollisionSQL } from '../provision-native-cross-organization-actor.mjs';
import { nativeActorCollisionSQL } from '../provision-existing-native-actors.mjs';

test('cross organization collision gates include disabled physical rows without SQL writes', () => {
  const sql = nativeOrganizationNumberCollisionSQL('NORG123456789abc');
  assert.match(sql, /^START TRANSACTION READ ONLY/);
  assert.match(sql, /`ORGANIZATION_NUMBER`=CONVERT\(0x/);
  assert.doesNotMatch(sql, /ENABLED|SELECT\s+\*|\b(?:DELETE|UPDATE|INSERT|ALTER|DROP)\b/i);
  assert.throws(() => nativeOrganizationNumberCollisionSQL("NORG123';DELETE"));
  assert.match(nativeActorCollisionSQL('nat_123456789abc_crossorg'), /`ENABLED`=0/);
});
