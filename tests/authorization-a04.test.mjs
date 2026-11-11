import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import {
  A04_SOURCES, A04_TESTS, buildA04Receipt, inspectA04Sources, main,
  readA04Sources, writeA04Receipt,
} from '../harness-authorization-a04.mjs';

const loaded = readA04Sources();

test('A04 receipt binds exact owned alias and delayed-startup evidence while remaining partial for OAuth', () => {
  const report = inspectA04Sources(loaded);
  assert.equal(report.items.A04.status, 'PARTIAL');
  assert.equal(report.items.A04.aliasReadback, true);
  assert.equal(report.items.A04.startupFatalGuard, true);
  assert.equal(report.items.A04.oauthClientCredentialContract, true);
  assert.match(report.items.A04.blocker, /complete current owned service-OAuth exchange/);
  assert.equal(report.nativeAcceptance, false);
  assert.equal(report.httpAcceptance, false);
});

test('A04 source mutation cannot silently preserve a readiness claim', () => {
  const changed = {
    sources: { ...loaded.sources,
      alias: loaded.sources.alias.replace("ephemeral: false", "ephemeral: true"),
      baseline: loaded.sources.baseline.replace('client_credentials', 'password'),
    },
    tests: loaded.tests,
  };
  assert.throws(() => inspectA04Sources(changed));
});

test('A04 receipt writer is private, exclusive and artifact-confined', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'authorization-a04-'));
  try {
    const output = join(workspace, '.artifacts/authorization-a04-test/report.json');
    const report = buildA04Receipt();
    const binding = writeA04Receipt(report, { workspace, output });
    assert.equal(binding.bytes, readFileSync(output).length);
    assert.match(binding.sha256, /^[a-f0-9]{64}$/);
    assert.throws(() => writeA04Receipt(report, { workspace, output }));
    assert.throws(() => writeA04Receipt(report, {
      workspace, output: '/tmp/authorization-a04/report.json',
    }));
  } finally { rmSync(workspace, { recursive: true, force: true }); }
});

test('A04 CLI rejects unknown and duplicate options', () => {
  assert.throws(() => main(['--unknown=yes']));
  assert.throws(() => main(['--output=.artifacts/authorization-a04-a/report.json',
    '--output=.artifacts/authorization-a04-b/report.json']));
  assert.deepEqual(Object.keys(A04_SOURCES).sort(),
    ['alias', 'backendLauncher', 'baseline', 'configuration', 'nativePlatform']);
  assert.deepEqual(Object.keys(A04_TESTS).sort(), ['alias', 'baseline', 'startup']);
});
