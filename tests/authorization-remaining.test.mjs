import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import {
  AUTHORIZATION_SOURCES, AUTHORIZATION_TESTS, buildAuthorizationRemainingReceipt,
  inspectAuthorizationRemaining, main, readAuthorizationSources,
  writeAuthorizationRemainingReceipt,
} from '../harness-authorization-remaining.mjs';

const loaded = readAuthorizationSources();

test('A01 binds actual typed/malformed/missing-root source checks and unchanged denial behavior', () => {
  const receipt = inspectAuthorizationRemaining(loaded);
  assert.equal(receipt.items.A01.status, 'PARTIAL');
  assert.match(receipt.items.A01.denialContract, /try mode returns null/);
  assert.match(receipt.items.A01.blocker, /real HTTP receipt/);
  assert.ok(receipt.sourceBindings.systemAccessManager.sha256.match(/^[a-f0-9]{64}$/));
  assert.ok(receipt.testBindings.requestCache.sha256.match(/^[a-f0-9]{64}$/));
});

test('A02 exposes the same-token revocation gap instead of treating distinct-token isolation as completion', () => {
  const receipt = inspectAuthorizationRemaining(loaded);
  assert.equal(receipt.items.A02.status, 'BLOCKED');
  assert.equal(receipt.items.A02.sameTokenCacheRetentionObserved, true);
  assert.match(receipt.items.A02.blocker, /same-token cache remains authorized/);
  assert.match(receipt.items.A02.evidence.join('\n'), /token-scoped|expiry|distinct-token/);
});

test('A03 distinguishes the verified ThreadLocal holder stack from flat ActionSession semantics', () => {
  const receipt = inspectAuthorizationRemaining(loaded);
  assert.equal(receipt.items.A03.status, 'BLOCKED');
  assert.equal(receipt.items.A03.holderStackIsolation, true);
  assert.equal(receipt.items.A03.actionSessionIsFlat, true);
  assert.equal(receipt.items.A03.nestedActionSessionTested, false);
  assert.match(receipt.items.A03.blocker, /openSession returns the existing session/);
});

test('source mutations fail closed and do not downgrade a receipt claim', () => {
  const changed = {
    sources: { ...loaded.sources,
      systemAccessManager: loaded.sources.systemAccessManager
        .replace('Character.isISOControl(character)', 'Character.isISOControlNever(character)'),
      actionSession: loaded.sources.actionSession
        .replace('actionSession.set(null)', 'actionSession.set(previous)'),
    },
    tests: loaded.tests,
  };
  assert.throws(() => inspectAuthorizationRemaining(changed));
  const changedTests = {
    sources: loaded.sources,
    tests: { ...loaded.tests, jsonCache: loaded.tests.jsonCache.replaceAll('fixture.grants.clear()', 'fixture.grants.add(grant)') },
  };
  assert.throws(() => inspectAuthorizationRemaining(changedTests));
});

test('receipt writer is exclusive, private and confined to .artifacts', () => {
  const root = mkdtempSync(join(tmpdir(), 'authorization-remaining-'));
  try {
    const output = join(root, '.artifacts/authorization-remaining-test/report.json');
    const receipt = buildAuthorizationRemainingReceipt();
    const binding = writeAuthorizationRemainingReceipt(receipt, { workspace: root, output });
    assert.equal(binding.bytes, readFileSync(output).length);
    assert.match(binding.sha256, /^[a-f0-9]{64}$/);
    assert.throws(() => writeAuthorizationRemainingReceipt(receipt, { workspace: root, output }));
    assert.throws(() => writeAuthorizationRemainingReceipt(receipt, {
      workspace: root, output: '/tmp/authorization-remaining/report.json',
    }));
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('CLI accepts only an owned artifact output and refuses implicit/shared options', () => {
  assert.throws(() => main(['--unknown=value']));
  assert.throws(() => main(['--output=.artifacts/authorization-remaining-a/report.json',
    '--output=.artifacts/authorization-remaining-b/report.json']));
  assert.deepEqual(Object.keys(AUTHORIZATION_SOURCES).sort(),
    ['actionSession', 'holder', 'systemAccessManager']);
  assert.deepEqual(Object.keys(AUTHORIZATION_TESTS).sort(),
    ['addin', 'holder', 'jsonCache', 'requestCache']);
});
