import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { buildOwnedModelingConfigSeedPlan } from '../plan-owned-modeling-config-seed.mjs';

const workspace = resolve(import.meta.dirname, '../..');
const manifestPath = '.artifacts/native-nonadmin-fixtures/25dd6a7232c7/manifest.json';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

function plan() {
  return buildOwnedModelingConfigSeedPlan({ workspace, manifestPath });
}

test('config seed plan is source-bound, explicitly blocked and scoped to the two owned centers', () => {
  const value = plan();
  assert.equal(value.contract, 'owned-modeling-config-seed-plan-v1');
  assert.equal(value.status, 'blocked-awaiting-real-config-evidence');
  assert.equal(value.nativeCreateExecuted, false);
  assert.equal(value.appNativeCreateExecuted, false);
  assert.equal(value.permissionAcceptance, false);
  assert.equal(value.fullColumnSnapshotExecuted, false);
  assert.equal(value.centers.length, 2);
  assert.deepEqual(value.centers.map(row => row.centerId).sort(), [
    'nf_25dd6a7232c7_center_a', 'nf_25dd6a7232c7_center_b',
  ]);
  assert.deepEqual(value.entities.map(row => row.entity), ['PSPF', 'PSPFStyle', 'PSAppType']);
  assert.deepEqual(value.entities.map(row => row.scope), ['global', 'center-or-shared', 'global']);
  assert.ok(value.blockedReasons.every(reason => typeof reason === 'string' && reason.length > 20));
});

test('plan requires complete physical source columns and carries read/create/remove native contracts', () => {
  const value = plan();
  for (const row of value.entities) {
    assert.ok(row.physicalColumns.length > 5);
    assert.ok(row.requiredPhysicalFields.length > 0);
    assert.deepEqual(row.fetch, {
      method: 'POST', path: '/fetchdefault', dataset: 'Default',
      permission: 'READ', body: { page: 0, size: 1000 },
    });
    assert.deepEqual(row.create, { method: 'POST', path: `/${row.route}`,
      permission: 'CREATE', input: 'DTO', return: 'VOID' });
    assert.deepEqual(row.remove, { method: 'DELETE', path: `/${row.route}/$RECEIPTED_KEY`,
      permission: 'DELETE', input: 'KEYFIELDS', return: 'VOID' });
    assert.equal(row.evidence.required, true);
    assert.match(row.evidence.readPath, new RegExp(`/${row.route}/fetchdefault$`));
    assert.ok(row.sourceBindings.module.sha256 && row.sourceBindings.app.sha256 && row.sourceBindings.query.sha256);
  }
});

test('no seed record contains a usable production ID; all records remain unresolved placeholders', () => {
  const value = plan();
  assert.equal(value.records.length, 6);
  assert.ok(value.records.every(record => record.status === 'blocked-awaiting-real-config-evidence'));
  assert.ok(value.records.every(record => record.key === '$NATIVE_RETURNED_KEY'));
  assert.ok(value.records.every(record => record.name.startsWith('$OBSERVED_')));
  assert.ok(value.records.every(record => record.center === null || record.center.includes('_center_')));
  assert.ok(!JSON.stringify(value).includes('pspfid\": \"nf_'));
  assert.ok(!JSON.stringify(value).includes('INSERT'));
  assert.equal(value.snapshot.sqlMutation, false);
});

test('PSPF and PSAppType are global, styles are center-or-shared, and cleanup is native-only reverse dependency order', () => {
  const value = plan();
  assert.deepEqual(value.twoCenterScope, {
    global: ['PSPF', 'PSAppType'],
    centerOrShared: ['PSPFStyle'],
    duplicateRule: 'One observed key cannot be reused across two center-scoped style intents.',
    unknownCenter: 'Reject; do not map a style to an invented center or production ID.',
  });
  assert.deepEqual(value.cleanup.order, ['PSSysApp', 'PSPFStyle', 'PSPF', 'PSAppType']);
  assert.equal(value.cleanup.method, 'native-owner-remove-only');
  assert.equal(value.cleanup.sqlFallback, false);
  assert.ok(value.cleanup.baseline.includes('MODELVER'));
});

test('App prerequisites are source-derived and cannot be satisfied by fake configuration rows', () => {
  const value = plan();
  assert.deepEqual(value.applicationPrerequisites.physicalRequired.map(row => row.field), [
    'PSPFID', 'PSPFSTYLEID', 'PSAPPTYPENAME',
  ]);
  assert.ok(value.applicationPrerequisites.coherence.every(row => !row.includes('fake')));
  assert.match(value.applicationPrerequisites.platform.evidence.unresolved, /synthetic/);
  assert.equal(value.applicationPrerequisites.style.scope, 'center-or-shared');
  assert.equal(value.applicationPrerequisites.appType.scope, 'global');
});

test('plan output is owner-private and a changed source/manifest fails before any output', () => {
  const copy = join(workspace, '.artifacts', 'config-plan-temp-manifest.json');
  const output = join(workspace, '.artifacts', 'config-plan-test-output.private.json');
  try {
    cpSync(join(workspace, manifestPath), copy);
    const value = buildOwnedModelingConfigSeedPlan({
      workspace, manifestPath: copy.replace(`${workspace}/`, ''),
      outputPath: output.replace(`${workspace}/`, ''),
    });
    assert.equal(statSync(output).mode & 0o077, 0);
    assert.equal(JSON.parse(readFileSync(output)).status, value.status);
    assert.equal(digest(readFileSync(output)), digest(Buffer.from(JSON.stringify(value, null, 2) + '\n')));
    const changed = JSON.parse(readFileSync(copy));
    changed.scenario = 'same-center';
    writeFileSync(copy, `${JSON.stringify(changed)}\n`);
    assert.throws(() => buildOwnedModelingConfigSeedPlan({
      workspace, manifestPath: copy.replace(`${workspace}/`, ''),
    }));
  } finally {
    rmSync(copy, { force: true });
    rmSync(output, { force: true });
  }
});

test('source-bound plan excludes credentials, existing 25dd registry outputs and arbitrary target URLs', () => {
  const value = plan();
  assert.ok(value.inputs.every(input => !/credential|accounts|deployment-input|password/i.test(input.path)));
  assert.ok(value.inputs.every(input => !input.path.includes('.artifacts/native-nonadmin-fixtures/25dd6a7232c7/editor-registry')));
  assert.equal(Object.hasOwn(value, 'backendUrl'), false);
  assert.equal(Object.hasOwn(value, 'execute'), false);
  assert.equal(Object.hasOwn(value, 'sql'), false);
});
