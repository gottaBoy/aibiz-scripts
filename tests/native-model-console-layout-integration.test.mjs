import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { WORKSPACE, loadMigrationContract } from '../harness-modeling-core-audit.mjs';
import { readTree } from '../native-candidate-files.mjs';
import { designIndexSelection } from '../prepare-native-design-index-replacement.mjs';
import {
  consoleTerminalSelection, readConsoleLayoutReplacements, swaggerPreviewSelection,
} from '../prepare-native-console-layout-replacements.mjs';
import { prepareNativeModelCandidate, rewritePluginReferences } from '../prepare-native-model-candidate.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const selections = [consoleTerminalSelection, swaggerPreviewSelection];

test('console and Swagger selectors compose with index without rewriting unrelated layout roles', () => {
  const providers = [...selections, designIndexSelection].map(selection => ({
    rTObjectRepo: selection.from, pluginType: selection.pluginType, pluginCode: selection.pluginCode,
    rTObjectName: selection.pluginCode, note: selection.from,
  }));
  const untouched = [
    { rTObjectRepo: swaggerPreviewSelection.from, pluginType: 'VIEW_CUSTOM', pluginCode: 'OTHER' },
    { rTObjectRepo: consoleTerminalSelection.from, pluginType: 'DEUIACTION', pluginCode: 'CONSOLE_VIEW' },
    { rTObjectRepo: swaggerPreviewSelection.from },
  ];
  const original = { providers: [...providers, ...untouched] };
  const before = structuredClone(original);
  const result = rewritePluginReferences(original, new Map(), [...selections, designIndexSelection]);
  assert.deepEqual(result.model.providers.slice(0, 3), providers.map((provider, index) => ({
    ...provider, rTObjectRepo: [...selections, designIndexSelection][index].to,
  })));
  assert.deepEqual(result.model.providers.slice(3), untouched);
  assert.equal(result.changes.length, 3);
  assert.deepEqual(original, before);
});

for (const includeIndex of [false, true]) {
  test(`real six-model candidate binds console/Swagger${includeIndex ? ' and index' : ' only'} while retaining migration blockers`, t => {
    const output = mkdtempSync(join(WORKSPACE, '.artifacts/native-model-migration/test-console-layout-'));
    t.after(() => rmSync(output, { recursive: true, force: true }));
    const replacements = readConsoleLayoutReplacements({ contract: loadMigrationContract() });
    const receipt = prepareNativeModelCandidate({
      output, consoleLayoutReplacement: true, designIndexReplacement: includeIndex,
    });
    assert.equal(receipt.nativeAccepted, false);
    assert.equal(receipt.acceptedForProduction, false);
    for (const { plugin, files } of replacements) {
      assert.deepEqual(receipt.plugins.find(item => item.to === plugin.to), plugin);
      assert.deepEqual(readTree(join(output, 'plugins', plugin.to), { jsonOnly: false }).entries, files.entries);
      assert.ok(receipt.unresolvedMappings.some(item => item.repo === plugin.from),
        'A scoped independent implementation cannot satisfy original migration acceptance');
      assert.deepEqual(receipt.independentReplacementMappings.find(item => item.to === plugin.to), {
        from: plugin.from, to: plugin.to, originalSourceRecovered: false, nativeCompatibilityVerified: false,
        originalMigrationAcceptance: 'not-satisfied-by-independent-replacement',
      });
    }
    const full = new Map(receipt.plugins.filter(plugin => !plugin.partialReplacement)
      .map(plugin => [plugin.from, plugin.to]));
    const scoped = receipt.plugins.filter(plugin => plugin.partialReplacement);
    const reverseFull = new Map([...full].map(([from, to]) => [to, from]));
    const reverseScoped = scoped.map(plugin => ({ ...plugin, from: plugin.to, to: plugin.from }));
    let modelCount = 0;
    let consoleChanges = 0;
    let swaggerChanges = 0;
    for (const evidence of Object.values(receipt.applications)) {
      assert.equal(evidence.files.length, 3);
      for (const file of evidence.files) {
        modelCount += 1;
        const inputPath = join(WORKSPACE, receipt.sourceModelRoot, file.path);
        const before = readFileSync(inputPath);
        const original = JSON.parse(before);
        const bytes = readFileSync(join(output, 'model', file.path));
        const candidate = JSON.parse(bytes);
        assert.equal(hash(before), file.inputSha256);
        assert.equal(hash(bytes), file.outputSha256);
        assert.deepEqual(candidate, rewritePluginReferences(original, full, scoped).model);
        assert.deepEqual(rewritePluginReferences(candidate, reverseFull, reverseScoped).model, original);
        assert.deepEqual(readFileSync(inputPath), before);
        consoleChanges += file.changes.filter(change => change.to === consoleTerminalSelection.to).length;
        swaggerChanges += file.changes.filter(change => change.to === swaggerPreviewSelection.to).length;
        const originalIndex = original.getAllPSAppPFPluginRefs.filter(provider =>
          provider.rTObjectRepo === designIndexSelection.from && provider.pluginCode === designIndexSelection.pluginCode);
        const candidateIndex = candidate.getAllPSAppPFPluginRefs.filter(provider =>
          provider.pluginCode === designIndexSelection.pluginCode);
        assert.deepEqual(candidateIndex, originalIndex.map(provider => ({
          ...provider, rTObjectRepo: includeIndex ? designIndexSelection.to : designIndexSelection.from,
        })));
      }
    }
    assert.equal(modelCount, 6);
    assert.ok(consoleChanges > 0 && swaggerChanges > 0, 'Both real native selectors must be exercised');
  });
}

test('console/layout option rejects non-boolean selections before producing delivery', () => {
  const output = join(WORKSPACE, '.artifacts/native-model-migration/invalid-console-layout-selection');
  assert.throws(() => prepareNativeModelCandidate({ output, consoleLayoutReplacement: 'true' }),
    /Console\/layout replacement selection must be boolean/);
  assert.equal(existsSync(output), false);
});
