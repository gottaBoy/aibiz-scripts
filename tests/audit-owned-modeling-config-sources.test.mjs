import assert from 'node:assert/strict';
import test from 'node:test';
import { auditOwnedModelingConfigSources } from '../audit-owned-modeling-config-sources.mjs';

test('current owned fixture has no reusable config rows and shared init rows are excluded', () => {
  const report = auditOwnedModelingConfigSources();
  assert.equal(report.contract, 'owned-modeling-config-source-audit-v1');
  assert.equal(report.status, 'blocked-no-owned-config-rows');
  assert.deepEqual(report.sharedInit.tableInsertCounts, {
    t_srfpspf: 0, t_srfpspfstyle: 4, t_srfpsapptype: 0,
  });
  assert.equal(report.sharedInit.eligible, false);
  assert.ok(report.sharedInit.reason.includes('Shared historical'));
  assert.equal(report.ownedSeedFiles.find(row => row.runId === '25dd6a7232c7').tableInsertCounts.t_srfpspf, 0);
  assert.equal(report.currentOwnedReports.find(row =>
    row.contract === 'owned-editor-config-read-v1').configRows.PSPF.rows, 0);
  assert.deepEqual(report.sourceModels.map(row => row.rows), [0, 0, 0, 0]);
  assert.equal(report.decision.ownedRowsAvailable, false);
  assert.equal(report.decision.sqlMutation, false);
  assert.equal(report.appCreateUnblocked, undefined);
  assert.equal(report.nativeAcceptance, false);
});

test('source audit excludes credentials, target URLs and old fixture seed adoption', () => {
  const report = auditOwnedModelingConfigSources();
  const serialized = JSON.stringify(report);
  assert.doesNotMatch(serialized, /password|MYSQL_PWD|http:\/\/.*:30086/i);
  assert.ok(report.ownedSeedFiles.every(row => row.eligible === false));
  assert.ok(report.sourceModels.every(row => row.eligible === false));
  assert.ok(report.decision.repair.some(step => step.includes('never send synthetic IDs')));
});

test('unknown run remains blocked and does not infer rows from another fixture', () => {
  const report = auditOwnedModelingConfigSources({ runId: '96ff5681e447' });
  assert.equal(report.status, 'blocked-source-not-owned');
  assert.equal(report.decision.ownedRowsAvailable, false);
  assert.deepEqual(report.currentOwnedReports, []);
});
