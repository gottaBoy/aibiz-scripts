import assert from 'node:assert/strict';
import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import test from 'node:test';
import { assessModelingConfigReadEvidence, auditOwnedModelingConfigSources,
  probeExistingModelingConfigRoutes } from '../audit-owned-modeling-config-sources.mjs';

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
  assert.deepEqual(report.sourceModels.map(row => row.rows), [null, null, null, null]);
  assert.equal(report.decision.ownedRowsAvailable, false);
  assert.equal(report.decision.sqlMutation, false);
  assert.equal(report.appCreateUnblocked, undefined);
  assert.equal(report.nativeAcceptance, false);
  assert.deepEqual(report.sharedSources.map(row => row.path), [
    'modelingservice/sql/init.sql', 'modelingservice/sql/sCloud9471c1eca.sql',
  ]);
  const historicalDump = report.sharedSources[1];
  assert.ok(Object.values(historicalDump.tableInsertCounts).every(count => count > 0));
  assert.ok(report.sharedSources.every(row => row.eligible === false
    && row.ownershipVerified === false && row.licenseVerified === false
    && row.nativeImportPathVerified === false && row.rowValuesExported === false));
  assert.equal(report.runtimePolicy.defaultRecordActions.CREATE, false);
  assert.equal(report.runtimePolicy.loadedRuntimeVerified, false);
});

test('empty-read evidence requires exact entities, matching run, HTTP 200 and response digests', () => {
  const runId = '123456789abc';
  const complete = { contract: 'owned-editor-config-read-v1', runId,
    status: 'passed-authenticated-config-route-read',
    checks: Object.fromEntries(['PSPF', 'PSPFStyle', 'PSAppType'].map(entity =>
      [entity, { status: 200, rows: 0, responseSha256: 'a'.repeat(64) }])) };
  assert.equal(assessModelingConfigReadEvidence(complete, runId).empty, true);
  for (const changed of [
    { ...complete, runId: 'abcdef123456' }, { ...complete, status: 'FAILED' },
    { ...complete, checks: { ...complete.checks, Extra: { rows: 0 } } },
    { ...complete, checks: { PSPF: complete.checks.PSPF } },
    ...[{ status: 403 }, { rows: -1 }, { rows: 0.5 }, { responseSha256: '' }]
      .map(change => ({ ...complete, checks: { ...complete.checks,
        PSPF: { ...complete.checks.PSPF, ...change } } })),
  ]) {
    const result = assessModelingConfigReadEvidence(changed, runId);
    assert.equal(result.valid, false);
    assert.equal(result.empty, false);
  }
  assert.equal(assessModelingConfigReadEvidence(complete, runId).liveRuntimeVerified, false);
});

test('native probe stops the same session at the first 403 without another login or route', async () => {
  const workspace = resolve(import.meta.dirname, '../..');
  const output = resolve(workspace, '.artifacts', `m02-config-probe-test-${randomBytes(6).toString('hex')}`);
  const rows = ['modelingservice', 'compose-modelingweb-candidate-modeldesign-1', 'ibiz-ebsx-allinone']
    .map(name => ({ Name: `/${name}`, Id: 'a'.repeat(64), Image: `sha256:${'b'.repeat(64)}`,
      State: { Status: 'running', StartedAt: '2026-11-25' }, RestartCount: 0, Mounts: [],
      Config: { Labels: { 'com.docker.compose.project.working_dir': `${workspace}/plm/deploy/compose` } } }));
  let requests = 0;
  try {
    const report = await probeExistingModelingConfigRoutes({ output,
      execute: () => ({ status: 0, stdout: JSON.stringify(rows) }),
      request: async () => { requests += 1; return new Response(null, { status: 403 }); } });
    assert.equal(requests, 1);
    assert.equal(report.status, 'STOPPED_NATIVE_HTTP_403');
    assert.equal(report.stoppedOnForbidden, true);
    assert.equal(report.alternateSessionAttempted, false);
    assert.equal(report.nativeAcceptance, false);
    assert.equal(fs.statSync(`${output}/report.private.json`).mode & 0o077, 0);
    assert.doesNotMatch(fs.readFileSync(`${output}/report.private.json`, 'utf8'), /password|Bearer /);
  } finally { fs.rmSync(output, { recursive: true, force: true }); }
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
  assert.ok(report.decision.reasons.some(reason =>
    reason.includes('No complete empty-config read report')));
  assert.ok(!report.decision.reasons.some(reason =>
    reason.includes('records authenticated 200 responses')));
});
