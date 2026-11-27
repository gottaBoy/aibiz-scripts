import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { classifyMarketplaceCloseoutGates, prepareMarketplaceCloseoutPlan } from '../prepare-marketplace-closeout-plan.mjs';

test('current package/replay receipts classify native K02/K03 as blocked and O01 as same-host partial', () => {
  const result = prepareMarketplaceCloseoutPlan({
    output: `.artifacts/marketplace-closeout-plan-${Math.random().toString(16).slice(2, 14)}`,
  });
  assert.equal(result.plan.status, 'READONLY-PLAN-NATIVE-K02-K03-BLOCKED-O01-PARTIAL');
  assert.equal(result.plan.gates.K02.status, 'BLOCKED-NATIVE-MARKET-UNEXECUTED');
  assert.equal(result.plan.gates.K03.status, 'BLOCKED-NATIVE-UPDATE-ROLLBACK-UNEXECUTED');
  assert.equal(result.plan.gates.O01.status, 'PARTIAL-OFFLINE-SAME-HOST-ONLY');
  assert.equal(result.plan.operations.docker, false);
  assert.equal(result.plan.operations.network, false);
  assert.equal(result.plan.operations.nativeMarketplaceRegistration, false);
  assert.ok(result.plan.reusableRunners.every(row => row.nativeMarketplace === false));
  assert.equal(fs.statSync(result.reportPath).mode & 0o077, 0);
  fs.rmSync(result.plan ? result.reportPath.replace('/plan.private.json', '') : '', { recursive: true, force: true });
});

test('gate classifier never promotes local file-store replay or cached builds to native acceptance', () => {
  const result = classifyMarketplaceCloseoutGates({
    packageReports: [
      { version: '1', manifestSha256: 'a'.repeat(64), nativeInstallationExecuted: false, nativeMarketplaceAcceptance: false },
      { version: '2', manifestSha256: 'b'.repeat(64), nativeInstallationExecuted: false, nativeMarketplaceAcceptance: false },
    ],
    replay: { status: 'passed-kernel-isolated-real-package-file-replay-not-native-installed',
      kernelNoNewPrivs: 1, kernelSeccompMode: 2, observations: [1, 2, 3, 4],
      nativeInstallationExecuted: false, nativeMarketplaceAcceptance: false },
    offline: { networkIsolation: { guardedNativeProcess: { fetch: 'EACCES' },
      guardedChildProcess: { tcp: 'EACCES' } },
      focusedVerification: { tests: 18, passed: 18, failed: 0, skipped: 0 } },
    sourceBindings: [],
  });
  assert.equal(result.K02.nativeRegistration, false);
  assert.equal(result.K03.localFailureRecoveryEvidence, true);
  assert.equal(result.K03.nativeRollback, false);
  assert.equal(result.O01.sameHostGuardedEvidence, true);
  assert.equal(result.O01.fullCleanHostRebuild, false);
});

test('invalid output paths and missing receipt inputs are refused before any write', () => {
  assert.throws(() => prepareMarketplaceCloseoutPlan({ output: '.artifacts/not-a-plan' }));
  assert.throws(() => prepareMarketplaceCloseoutPlan({
    output: `.artifacts/marketplace-closeout-plan-${Math.random().toString(16).slice(2, 14)}`,
    catalogId: 'unknown',
  }));
});

test('source bindings retain current-versus-historical hash distinction', () => {
  const result = prepareMarketplaceCloseoutPlan({
    output: `.artifacts/marketplace-closeout-plan-${Math.random().toString(16).slice(2, 14)}`,
  });
  assert.ok(result.plan.sourceBindings.length > 0);
  result.plan.sourceBindings.forEach(row => {
    assert.equal(row.current.path, row.path);
    assert.match(row.current.sha256, /^[a-f0-9]{64}$/);
    assert.equal(typeof row.unchanged, 'boolean');
  });
  fs.rmSync(result.reportPath.replace('/plan.private.json', ''), { recursive: true, force: true });
});
