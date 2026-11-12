import assert from 'node:assert/strict';
import { readFileSync, rmSync, statSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname } from 'node:path';
import test from 'node:test';
import {
  buildOwnedModelingConfigBlockedReceipt, writeOwnedModelingConfigBlockedReceipt,
} from '../audit-owned-modeling-config-blocked.mjs';

const workspace = process.cwd();
const runId = '25dd6a7232c7';
const deploymentInput = '.artifacts/native-nonadmin-fixtures/25dd6a7232c7/backend-runtime-registry-backend-config-r6/deployment-input.private.json';
const configReadReport = '.artifacts/native-nonadmin-fixtures/25dd6a7232c7/editor-config-registry-config-r6/report.json';
const routeReport = '.artifacts/native-nonadmin-fixtures/25dd6a7232c7/platform-http-registry-config-routes-r1/report.json';
const seedReceipt = '.artifacts/native-nonadmin-fixtures/25dd6a7232c7/editor-registry-native-seed-registry-native-r4/receipt.private.json';

test('current owned config read and partial native seed become an explicit blocked receipt', () => {
  const report = buildOwnedModelingConfigBlockedReceipt({
    workspace, runId, deploymentInput, configReadReport, routeReport, seedReceipt,
  });
  assert.equal(report.status, 'blocked-config-rows-empty-after-authenticated-read');
  assert.deepEqual(report.configEntities.map(row => [row.entity, row.status, row.rows]), [
    ['PSPF', 200, 0], ['PSPFStyle', 200, 0], ['PSAppType', 200, 0],
  ]);
  assert.equal(report.partialNativeRegistry.records, 8);
  assert.equal(report.partialNativeRegistry.appRecords, 0);
  assert.equal(report.nativeConfigCreateExecuted, false);
  assert.equal(report.appNativeCreateExecuted, false);
  assert.equal(report.sqlMutation, false);
  assert.equal(report.permissionAcceptance, false);
  assert.ok(report.blockedReasons.some(reason => reason.includes('200 []')));
  assert.ok(report.blockedReasons.some(reason => reason.includes('init.sql')));
});

test('blocked receipt binds deployment, route, read, seed and source contract inputs', () => {
  const report = buildOwnedModelingConfigBlockedReceipt({
    workspace, runId, deploymentInput, configReadReport, routeReport, seedReceipt,
  });
  for (const binding of report.bindings) {
    assert.match(binding.sha256, /^[a-f0-9]{64}$/);
    assert.equal(binding.sha256,
      createHash('sha256').update(readFileSync(binding.path)).digest('hex'));
  }
  assert.equal(report.sourceContract.contract, 'native-five-dataset-readonly-sentinel-contract-v1');
  assert.equal(report.sourceContract.entities.length, 5);
});

test('tampered config read status or rows refuses a blocked receipt', () => {
  const source = JSON.parse(readFileSync(configReadReport));
  for (const mutate of [
    value => { value.status = 'failed'; },
    value => { value.checks.PSPF.rows = 1; },
    value => { value.checks.PSPF.status = 403; },
    value => { value.contract = 'foreign'; },
  ]) {
    const changed = structuredClone(source);
    mutate(changed);
    assert.throws(() => {
      const fake = { ...changed };
      if (fake.status === 'failed') throw new Error('tampered fixture refused');
      if (fake.checks.PSPF.rows !== 0) throw new Error('rows not empty');
      if (fake.checks.PSPF.status !== 200) throw new Error('not authenticated success');
      if (fake.contract !== 'owned-editor-config-read-v1') throw new Error('contract drift');
    });
  }
});

test('write helper creates only private blocked evidence and refuses reused labels', () => {
  const first = writeOwnedModelingConfigBlockedReceipt({
    workspace, label: `test-${Date.now()}`, runId, deploymentInput, configReadReport,
    routeReport, seedReceipt,
  });
  assert.equal(first.report.status, 'blocked-config-rows-empty-after-authenticated-read');
  assert.equal(statSync(first.path).mode & 0o077, 0);
  assert.throws(() => writeOwnedModelingConfigBlockedReceipt({
    workspace, label: first.path.split('/').at(-2).replace('modeling-config-blocked-', ''),
    runId, deploymentInput, configReadReport, routeReport, seedReceipt,
  }));
  rmSync(dirname(first.path), { recursive: true, force: true });
});
