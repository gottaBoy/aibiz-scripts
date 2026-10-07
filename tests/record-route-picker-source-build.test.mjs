import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import {
  fingerprintDirectory, validateMigrationMapping, WORKSPACE,
} from '../harness-modeling-core-audit.mjs';
import {
  bindRoutePickerBuild, ROUTE_PICKER_COMMAND, ROUTE_PICKER_FROM,
  ROUTE_PICKER_OUTPUT, ROUTE_PICKER_SOURCE, ROUTE_PICKER_TARGET,
} from '../record-route-picker-source-build.mjs';

function put(root, path, value) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), typeof value === 'string' ? value : JSON.stringify(value));
}

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'route-picker-binding-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const contract = JSON.parse(readFileSync(join(WORKSPACE,
    'scripts/fixtures/modeling-core-migration-contract.json')));
  const mapping = structuredClone(contract.migrationMappings.find(item => item.from === ROUTE_PICKER_FROM));
  contract.migrationMappings = [mapping];
  const manifest = {
    name: '@ibiz-template-plm/route-picker', version: '0.0.3-alpha.245',
    gitHead: mapping.source.packageGitHead,
  };
  put(root, `${ROUTE_PICKER_SOURCE}/package.json`, manifest);
  put(root, `${ROUTE_PICKER_SOURCE}/src/index.ts`, 'export const editable = true;\n');
  put(root, `${ROUTE_PICKER_SOURCE}/src/style.css`, '.route-picker { display: flex; }\n');
  put(root, `${ROUTE_PICKER_OUTPUT}/package.json`, manifest);
  put(root, `${ROUTE_PICKER_OUTPUT}/dist/index.es.js`, 'export const editable = true;\n');
  put(root, `${ROUTE_PICKER_OUTPUT}/dist/style.css`, '.route-picker { display: flex; }\n');
  const source = fingerprintDirectory(root, ROUTE_PICKER_SOURCE);
  const output = fingerprintDirectory(root, ROUTE_PICKER_OUTPUT);
  const receipt = {
    schemaVersion: 1, status: 'passed', command: ROUTE_PICKER_COMMAND, exitCode: 0,
    package: { ...manifest, repo: ROUTE_PICKER_TARGET },
    source: { path: ROUTE_PICKER_SOURCE },
    output: { path: ROUTE_PICKER_OUTPUT },
    sourceFingerprint: source.fingerprint, outputFingerprint: output.fingerprint,
    inputs: source.entries, outputs: output.entries,
  };
  return { root, contract, mapping, receipt };
}

test('binding a current complete receipt changes only the requested mapping evidence', t => {
  const { root, contract, mapping, receipt } = fixture(t);
  const before = structuredClone(contract);
  const rebound = bindRoutePickerBuild(contract, receipt, root);
  const after = rebound.migrationMappings[0];
  assert.deepEqual(contract, before, 'the input contract is not mutated');
  assert.deepEqual(rebound.plugins, before.plugins, 'the requested old version remains unbuilt');
  assert.deepEqual(rebound.evidence, before.evidence);
  assert.deepEqual(rebound.migrationPolicy, before.migrationPolicy);
  assert.deepEqual(after.compatibility, mapping.compatibility);
  assert.deepEqual(after.runtime, mapping.runtime);
  assert.deepEqual(after.blockers, mapping.blockers);
  assert.equal(after.source.status, 'reconstructed');
  assert.equal(after.status, 'blocked');
  assert.deepEqual(after.build.receipt, receipt);
  assert.deepEqual(validateMigrationMapping(after, root), { valid: true, ready: false, blockers: [] });
});

for (const [name, change] of [
  ['source drift', data => put(data.root, `${ROUTE_PICKER_SOURCE}/src/index.ts`, 'export const changed = 2;\n')],
  ['output drift', data => put(data.root, `${ROUTE_PICKER_OUTPUT}/dist/index.es.js`, 'export const changed = 2;\n')],
  ['extra output', data => put(data.root, `${ROUTE_PICKER_OUTPUT}/dist/unbound.js`, 'export {};\n')],
  ['missing receipt source input', data => data.receipt.inputs.pop()],
  ['nonzero build result', data => { data.receipt.exitCode = 1; }],
  ['different package git head', data => { data.receipt.package.gitHead = 'f'.repeat(40); }],
  ['observed-only command', data => { data.receipt.command = 'fingerprint only'; }],
]) {
  test(`binding rejects ${name}`, t => {
    const data = fixture(t);
    change(data);
    assert.throws(() => bindRoutePickerBuild(data.contract, data.receipt, data.root),
      /route-picker-receipt-does-not-bind-current-bytes/);
  });
}

test('binding refuses original-source or runtime acceptance promotions', t => {
  for (const promote of [
    mapping => { mapping.source.status = 'verified'; },
    mapping => { mapping.status = 'verified'; },
    mapping => { mapping.compatibility.status = 'verified'; },
    mapping => { mapping.runtime.status = 'passed'; },
    mapping => { mapping.blockers = []; },
  ]) {
    const data = fixture(t);
    promote(data.mapping);
    assert.throws(() => bindRoutePickerBuild(data.contract, data.receipt, data.root),
      /route-picker-provenance-or-mapping-mismatch/);
  }
});

test('binding refuses another invalid mapping rather than hiding unrelated drift', t => {
  const data = fixture(t);
  data.contract.migrationMappings.push({ from: '@example/broken@1.0.0' });
  assert.throws(() => bindRoutePickerBuild(data.contract, data.receipt, data.root),
    /route-picker-contract-invalid:@example\/broken/);
});

test('binding refuses target manifest identity drift', t => {
  const data = fixture(t);
  put(data.root, `${ROUTE_PICKER_OUTPUT}/package.json`, {
    name: '@ibiz-template-plm/route-picker', version: '0.0.2-dev.142',
    gitHead: data.mapping.source.packageGitHead,
  });
  assert.throws(() => bindRoutePickerBuild(data.contract, data.receipt, data.root),
    /route-picker-package-identity-mismatch/);
});
