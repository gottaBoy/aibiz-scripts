import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { inspectA01Readiness, main, writeA01ReadinessReceipt } from '../harness-authorization-a01-readiness.mjs';

test('config-r6 ordinary matrix is ready but A01 fresh HTTP is blocked by missing invalid-root dispatch', () => {
  const report = inspectA01Readiness();
  assert.equal(report.runId, '25dd6a7232c7');
  assert.equal(report.status, 'BLOCKED-HARNESS-MISSING-DISPATCH');
  assert.equal(report.deployment.actualBackendStarted, true);
  assert.equal(report.deployment.retainedOwned, true);
  assert.equal(report.authenticatedConfig.allThreeRoutes200, true);
  assert.equal(report.authenticatedConfig.allThreeEmpty, true);
  assert.equal(report.matrix.invalidRootCasesPlanned, true);
  assert.equal(report.matrix.invalidRootCasesDispatched, false);
  assert.equal(report.acceptance.ordinaryRoleRootHTTPCanRun, true);
  assert.equal(report.acceptance.a01FreshHTTPCanRun, false);
  assert.match(report.blocker, /never dispatches matrix\.invalidRootCases/);
});

test('A01 readiness source drift fails closed and receipt output is exclusive', () => {
  const report = inspectA01Readiness();
  const workspace = mkdtempSync(join(tmpdir(), 'authorization-a01-readiness-'));
  try {
    const output = join(workspace, '.artifacts/authorization-a01-test/report.json');
    const binding = writeA01ReadinessReceipt(report, { workspace, output });
    assert.equal(binding.bytes, readFileSync(output).length);
    assert.throws(() => writeA01ReadinessReceipt(report, { workspace, output }));
    assert.throws(() => writeA01ReadinessReceipt(report, {
      workspace, output: '/tmp/authorization-a01/report.json',
    }));
  } finally { rmSync(workspace, { recursive: true, force: true }); }
});

test('A01 readiness CLI rejects unknown and duplicate options', () => {
  assert.throws(() => main(['--unknown=true']));
  assert.throws(() => main(['--output=.artifacts/authorization-a01-a/report.json',
    '--output=.artifacts/authorization-a01-b/report.json']));
});
