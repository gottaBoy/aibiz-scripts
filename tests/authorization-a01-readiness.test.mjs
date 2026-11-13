import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { createFixture } from '../prepare-run-owned-native-nonadmin-fixture.mjs';
import { inspectA01Readiness, main, writeA01ReadinessReceipt } from '../harness-authorization-a01-readiness.mjs';

test('readiness points to the consuming owned runner without reviving config-r6 or claiming typed HTTP', () => {
  const { manifest } = createFixture({ runId: 'abcdef012345', scenario: 'two-center',
    modelVersion: 816, uaaSchemaMode: 'legacy-views', passwordStorageMode: 'sm3', secret: () => 'a'.repeat(36) });
  const report = inspectA01Readiness({ manifest });
  assert.equal(report.contract, 'authorization-a01-fresh-http-readiness-v2');
  assert.equal(report.runId, manifest.runId);
  assert.equal(report.status, 'partial-runner-implemented-awaiting-fresh-owned-http');
  assert.equal(report.liveResourcesInspected, false);
  assert.equal(report.retiredFixtureReused, false);
  assert.equal(report.runner.invalidRootCasesConsumed, true);
  assert.equal(report.runner.entry, 'scripts/run-owned-a01-root-http.mjs');
  assert.deepEqual(report.runner.counts, { planned: 84, representable: 36, blocked: 48 });
  assert.equal(report.acceptance.a01FreshHTTPCanRun, false);
  assert.equal(report.acceptance.boundedRepresentableRootAcceptance, false);
  assert.equal(report.acceptance.fullA01Acceptance, false);
  assert.ok(report.inputs.every(input => !input.path.startsWith('.artifacts')));
  assert.ok(!JSON.stringify(report).includes('25dd6a7232c7'));
});

test('A01 readiness report writes privately/exclusively and rejects artifact ancestor symlinks', () => {
  const report = inspectA01Readiness();
  const workspace = mkdtempSync(join(tmpdir(), 'authorization-a01-readiness-'));
  const other = mkdtempSync(join(tmpdir(), 'authorization-a01-foreign-'));
  try {
    const output = join(workspace, '.artifacts/authorization-a01-test/report.json');
    const binding = writeA01ReadinessReceipt(report, { workspace, output });
    assert.equal(binding.bytes, readFileSync(output).length);
    assert.throws(() => writeA01ReadinessReceipt(report, { workspace, output }));
    assert.throws(() => writeA01ReadinessReceipt(report, { workspace, output: '/tmp/authorization-a01/report.json' }));
    symlinkSync(other, join(workspace, '.artifacts/authorization-a01-escape'));
    assert.throws(() => writeA01ReadinessReceipt(report, {
      workspace, output: '.artifacts/authorization-a01-escape/report.json',
    }));
  } finally { rmSync(workspace, { recursive: true, force: true }); rmSync(other, { recursive: true, force: true }); }
});

test('A01 readiness CLI rejects target URLs, execution and duplicate options', () => {
  for (const args of [['--url=http://127.0.0.1:30250'], ['--execute'], ['--run-id=abcdef012345'],
    ['--output=.artifacts/authorization-a01-a/report.json', '--output=.artifacts/authorization-a01-b/report.json']]) {
    assert.throws(() => main(args));
  }
});
