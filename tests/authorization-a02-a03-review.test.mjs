import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import {
  A02_A03_SOURCES, A02_A03_TESTS, buildA02A03Receipt, inspectA02A03,
  main, readA02A03Sources, writeA02A03Receipt,
} from '../harness-authorization-a02-a03-review.mjs';

const loaded = readA02A03Sources();

test('A02 records the same-token cache revocation threat and refuses a false pass', () => {
  const report = inspectA02A03(loaded);
  assert.equal(report.items.A02.status, 'BLOCKED');
  assert.equal(report.items.A02.observed.cacheBypassesGrantLookup, true);
  assert.equal(report.items.A02.observed.expiryStillChecked, true);
  assert.match(report.items.A02.blocker, /revision\/invalidation protocol/);
  assert.equal(report.productionChanges, false);
});

test('A03 records flat ActionSession compatibility risk while preserving holder evidence', () => {
  const report = inspectA02A03(loaded);
  assert.equal(report.items.A03.status, 'BLOCKED');
  assert.equal(report.items.A03.observed.flatSession, true);
  assert.equal(report.items.A03.observed.nestedApiAbsent, true);
  assert.equal(report.items.A03.observed.nestedTestsAbsent, true);
  assert.equal(report.items.A03.observed.holderStackVerified, true);
  assert.match(report.items.A03.compatibilityRisk, /dozens/);
});

test('source mutations fail closed before any production implementation claim', () => {
  const changed = {
    sources: {
      ...loaded.sources,
      accessManager: loaded.sources.accessManager.replace('return iPSDevUserBase;', 'return null;'),
      actionSession: loaded.sources.actionSession.replace('actionSession.set(null)', 'actionSession.set(parent);'),
    },
    tests: loaded.tests,
  };
  assert.throws(() => inspectA02A03(changed));
});

test('receipt writing is private, exclusive and artifact-confined', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'authorization-a02-a03-'));
  try {
    const output = join(workspace, '.artifacts/authorization-a02-a03-test/report.json');
    const report = buildA02A03Receipt();
    const binding = writeA02A03Receipt(report, { workspace, output });
    assert.equal(binding.bytes, readFileSync(output).length);
    assert.throws(() => writeA02A03Receipt(report, { workspace, output }));
    assert.throws(() => writeA02A03Receipt(report, {
      workspace, output: '/tmp/authorization-a02-a03/report.json',
    }));
  } finally { rmSync(workspace, { recursive: true, force: true }); }
});

test('CLI accepts only owned output and exact source/test rosters', () => {
  assert.throws(() => main(['--unknown=yes']));
  assert.throws(() => main(['--output=.artifacts/authorization-a02-a03-a/report.json',
    '--output=.artifacts/authorization-a02-a03-b/report.json']));
  assert.deepEqual(Object.keys(A02_A03_SOURCES).sort(),
    ['accessManager', 'actionSession', 'actionSessionModel', 'cacheCodec', 'holder']);
  assert.deepEqual(Object.keys(A02_A03_TESTS).sort(),
    ['addin', 'cache', 'holder', 'request']);
});
