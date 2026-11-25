import assert from 'node:assert/strict';
import test from 'node:test';
import { nativeIdeaStableProjection, nativeRoleMatrixVerdict,
  selectNativeProductOrganization, nativeIdeaEffectSnapshotSQL,
  assertFreshNativeIdeaKey } from '../probe-native-product-role-matrix.mjs';

test('stable readback projection includes business persistence without credentials', () => {
  const value = { id: 'own', title: 'original', product_id: 'p', state: '10',
    update_time: '2026-11-24', token: 'private', password: 'private', transient_ui: 'ignored' };
  const projected = nativeIdeaStableProjection(value);
  assert.equal(projected.title, 'original');
  assert.equal(projected.product_id, 'p');
  assert.equal(projected.update_time, '2026-11-24');
  assert.doesNotMatch(JSON.stringify(projected), /private|token|password|transient/);
  assert.notDeepEqual(nativeIdeaStableProjection({ ...value, title: 'unauthorized' }), projected);
  assert.notDeepEqual(nativeIdeaStableProjection({ ...value, product_id: 'foreign' }), projected);
});

test('sequence and side-effect snapshots bind only actual product, actor and fresh owner ID', () => {
  const sql = nativeIdeaEffectSnapshotSQL('1234567890abcdef1234567890abcdef',
    'nat_123456789abc_readonly', 'abcdef1234567890abcdef1234567890',
    'Native ACL native-product-role-matrix-test', 'Native ACL native-product-role-matrix-test readonly');
  assert.match(sql, /^START TRANSACTION READ ONLY/);
  assert.match(sql, /`NAME`='seq_idea_id' AND `GROUP_TAG`=CONVERT/);
  assert.match(sql, /MIN\(`CURRENT_VALUE`\)/);
  assert.match(sql, /`VERSION`|`RECENT`|`INTERNAL_MESSAGE`/);
  assert.doesNotMatch(sql, /SELECT\s+\*|\b(?:DELETE|UPDATE|INSERT|ALTER|DROP)\b/i);
  assert.throws(() => nativeIdeaEffectSnapshotSQL("bad';DELETE", 'nat_123456789abc_readonly',
    'abcdef1234567890abcdef1234567890', 'Native ACL native-product-role-matrix-test', 'bad'));
  const fresh = { plannedIdeaRows: 0, plannedVersionRows: 0, plannedRecentRows: 0,
    plannedInternalMessageRows: 0 };
  assert.doesNotThrow(() => assertFreshNativeIdeaKey(fresh));
  for (const key of Object.keys(fresh)) {
    assert.throws(() => assertFreshNativeIdeaKey({ ...fresh, [key]: 1 }));
  }
});

test('organization selection accepts only the actual native system membership', () => {
  const selected = { orgid: 'actual-org', systemid: 'ibizplm', dcsystemid: 'ibizplm' };
  assert.deepEqual(selectNativeProductOrganization([selected], 'actual-org'),
    { orgId: 'actual-org', systemId: 'ibizplm', dcSystemId: 'ibizplm' });
  assert.throws(() => selectNativeProductOrganization([selected], 'foreign-org'));
  assert.throws(() => selectNativeProductOrganization([selected, selected], 'actual-org'));
  assert.throws(() => selectNativeProductOrganization([{ ...selected, systemid: 'foreign' }], 'actual-org'));
});

test('role verdict requires nonempty real checks and refuses partial or failed evidence', () => {
  assert.equal(nativeRoleMatrixVerdict([]), 'FAILED');
  assert.equal(nativeRoleMatrixVerdict([{ pass: true }]), 'PASS');
  assert.equal(nativeRoleMatrixVerdict([{ pass: true }, { pass: false }]), 'FAILED');
  assert.equal(nativeRoleMatrixVerdict([{ status: 200 }]), 'FAILED');
});
