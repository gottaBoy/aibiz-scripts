import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { WORKSPACE, loadMigrationContract } from '../harness-modeling-core-audit.mjs';
import { readTree } from '../native-candidate-files.mjs';
import {
  modelDesignActionKeys, modelDesignSelection, readModelDesignCandidate,
  verifyModelDesignReferenceSurface,
} from '../prepare-native-model-design-candidate.mjs';
import { prepareNativeModelCandidate, rewritePluginReferences } from '../prepare-native-model-candidate.mjs';

const sourceReport = '.artifacts/native-model-design-local-candidate/build-20261006-alpha122-runtime2-locked-v11-console-layout/report.json';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const reference = code => ({
  rTObjectRepo: modelDesignSelection.from, pluginType: 'DEUIACTION', pluginCode: code, rTObjectName: code,
});

test('all eleven declared native actions are supported without treating alpha122 as alpha90', () => {
  const model = modelDesignActionKeys.map(key => reference(key.slice('DEUIACTION_'.length)));
  assert.doesNotThrow(() => verifyModelDesignReferenceSurface(model));
  const rewritten = rewritePluginReferences(model,
    new Map([[modelDesignSelection.from, modelDesignSelection.to]]));
  assert.equal(rewritten.changes.length, 11);
  assert.ok(rewritten.model.every(item => item.rTObjectRepo === modelDesignSelection.to));
  assert.ok(model.every(item => item.rTObjectRepo === modelDesignSelection.from));
});

for (const [label, change, error] of [
  ['unknown action', { pluginCode: 'UNKNOWN' }, /Unsupported model-design action/],
  ['missing action', { pluginCode: undefined }, /Unsupported model-design action/],
  ['wrong provider type', { pluginType: 'VIEW_CUSTOM' }, /Unsupported model-design plugin type/],
  ['different runtime object', { rTObjectName: 'OtherAction' }, /runtime action identity differs/],
]) {
  test(`source candidate refuses ${label} rather than broadly remapping the package`, () => {
    assert.throws(() => verifyModelDesignReferenceSurface([{
      ...reference('MODEL_EDIT'), ...change,
    }]), error);
  });
}

test('source reader requires actual workspace, native identity and explicit verifiable report', () => {
  const contract = loadMigrationContract();
  assert.throws(() => readModelDesignCandidate({ workspace: '/tmp', contract, sourceReport }),
    /actual workspace/);
  assert.throws(() => readModelDesignCandidate({ contract }), /Explicit model-design source report/);
  assert.throws(() => readModelDesignCandidate({
    contract: { ...contract, migrationMappings: [] }, sourceReport,
  }), /alpha90 model-design mapping/);
  assert.throws(() => readModelDesignCandidate({ contract, sourceReport: sourceReport + '.missing' }),
    /ENOENT|Missing|report/);
});

test('real locked lifecycle integration binds all outputs and six model rewrites, retaining native false', t => {
  const output = fs.mkdtempSync(join(WORKSPACE, '.artifacts/native-model-migration/test-model-design-v11-'));
  t.after(() => fs.rmSync(output, { recursive: true, force: true }));
  const before = fs.readFileSync(join(WORKSPACE, sourceReport));
  const report = JSON.parse(before);
  const receipt = prepareNativeModelCandidate({
    output, modelDesignSourceReport: sourceReport, designIndexReplacement: true,
  });
  const plugin = receipt.plugins.find(item => item.to === modelDesignSelection.to);
  assert.ok(plugin);
  assert.equal(plugin.sourceBuildReport.sha256, hash(before));
  assert.equal(plugin.consumedRuntime.version, '0.2.2-local.2');
  assert.equal(plugin.consumedRuntime.sourceKind, 'reconstructed');
  assert.equal(plugin.upstreamReference, '@ibiz-template-plugin/model-design@0.0.3-alpha.122');
  assert.equal(plugin.requestedReference, modelDesignSelection.from);
  assert.equal(plugin.nativeAccepted, false);
  assert.equal(plugin.nativeCompatibilityVerified, false);
  assert.equal(plugin.originalSourceRecovered, false);
  assert.equal(plugin.acceptedForProduction, false);
  assert.equal(receipt.nativeAccepted, false);
  assert.equal(receipt.acceptedForProduction, false);
  assert.deepEqual(plugin.supportedActionKeys, modelDesignActionKeys);
  assert.deepEqual(plugin.buildOutputs, report.outputs.entries);
  const copied = readTree(join(output, 'plugins', plugin.to), { jsonOnly: false });
  assert.equal(copied.entries.length, 4436);
  assert.equal(copied.fingerprint, plugin.outputFingerprint);
  assert.ok(!copied.entries.some(file => /^(src|public|node_modules|\.dependencies)\//.test(file.path)));
  for (const directory of ['dist', 'es', 'lib']) {
    assert.equal(copied.entries.filter(file =>
      file.path.startsWith(`${directory}/assets/json/runtime-model/`)).length, 1414);
  }
  for (const [application, evidence] of Object.entries(receipt.applications)) {
    assert.equal(evidence.files.length, 3);
    for (const file of evidence.files) {
      const original = fs.readFileSync(join(WORKSPACE, receipt.sourceModelRoot, file.path));
      const delivered = fs.readFileSync(join(output, 'model', file.path));
      assert.equal(hash(original), file.inputSha256);
      assert.equal(hash(delivered), file.outputSha256);
      const model = JSON.parse(delivered);
      const source = JSON.parse(original);
      const full = new Map(receipt.plugins.filter(item => !item.partialReplacement)
        .map(item => [item.from, item.to]));
      const scoped = receipt.plugins.filter(item => item.partialReplacement);
      assert.deepEqual(model, rewritePluginReferences(source, full, scoped).model);
      const expected = source.getAllPSAppPFPluginRefs.filter(item =>
        item.rTObjectRepo === modelDesignSelection.from).length;
      assert.equal(file.changes.filter(item => item.from === modelDesignSelection.from).length, expected);
      assert.ok(expected > 0, `${application} must exercise actual native model references`);
    }
  }
  assert.ok(receipt.unresolvedMappings.some(item =>
    item.repo === '@ibiz-template-plugin/layout-design@0.0.3-alpha.90'));
  assert.deepEqual(fs.readFileSync(join(WORKSPACE, sourceReport)), before);
});
