import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { WORKSPACE } from '../harness-modeling-core-audit.mjs';
import { collectPluginReferences } from '../harness-plugin-audit.mjs';
import { designIndexSelection } from '../prepare-native-design-index-replacement.mjs';
import { prepareNativeModelCandidate, rewritePluginReferences } from '../prepare-native-model-candidate.mjs';

const original = designIndexSelection.from;
const replacement = designIndexSelection.to;

test('index-only replacement preserves same-package Swagger, mismatched types and non-repository fields', () => {
  const model = {
    plugins: [
      { rTObjectRepo: original, pluginType: 'VIEW_CUSTOM', pluginCode: 'DESIGN_INDEX_VIEW',
        rTObjectName: 'iBizDesignIndexView', note: original },
      { rTObjectRepo: original, pluginType: 'VIEW_CUSTOM', pluginCode: 'SWAGGER_PREVIEW_VIEW' },
      { rTObjectRepo: original, pluginType: 'EDITOR_CUSTOMSTYLE', pluginCode: 'DESIGN_INDEX_VIEW' },
      { rTObjectRepo: original, pluginType: 'VIEW_CUSTOM' },
      { rTObjectRepo: original },
    ],
    metadata: { note: original },
  };
  const before = structuredClone(model);
  const result = rewritePluginReferences(model, new Map(), [designIndexSelection]);
  const expected = structuredClone(before);
  expected.plugins[0].rTObjectRepo = replacement;
  assert.deepEqual(result.model, expected);
  assert.deepEqual(model, before);
  assert.deepEqual(result.changes, [{ location: '/plugins/0/rTObjectRepo', from: original, to: replacement }]);
  assert.deepEqual(rewritePluginReferences(result.model, new Map(), [{
    ...designIndexSelection, from: replacement, to: original,
  }]).model, before);
});

test('scoped index replacement composes with full-package replacements and escapes JSON pointers', () => {
  const model = { 'a/b~c': {
    RTObjectRepo: original, pluginCode: 'DESIGN_INDEX_VIEW', pluginType: 'VIEW_CUSTOM',
    nested: [{ rTObjectRepo: '@other/plugin@1.0.0' }],
  } };
  const result = rewritePluginReferences(model, new Map([
    ['@other/plugin@1.0.0', '@other/plugin@2.0.0'],
  ]), [designIndexSelection]);
  assert.equal(result.model['a/b~c'].RTObjectRepo, replacement);
  assert.equal(result.model['a/b~c'].nested[0].rTObjectRepo, '@other/plugin@2.0.0');
  assert.deepEqual(result.changes.map(item => item.location), [
    '/a~1b~0c/RTObjectRepo', '/a~1b~0c/nested/0/rTObjectRepo',
  ]);
});

test('ambiguous or malformed scoped replacements fail before rewriting', () => {
  assert.throws(() => rewritePluginReferences({}, new Map([[original, replacement]]),
    [designIndexSelection]), /Conflicting scoped/);
  assert.throws(() => rewritePluginReferences({}, new Map(),
    [designIndexSelection, designIndexSelection]), /Conflicting scoped/);
  assert.throws(() => rewritePluginReferences({}, new Map(),
    [{ ...designIndexSelection, pluginCode: '' }]), /Invalid scoped/);
});

test('real six-model candidate binds local index output but retains original Swagger and migration blockers', t => {
  const output = mkdtempSync(join(WORKSPACE, '.artifacts/native-model-migration/test-design-index-'));
  t.after(() => rmSync(output, { recursive: true, force: true }));
  const receipt = prepareNativeModelCandidate({ output, designIndexReplacement: true });
  assert.equal(receipt.acceptedForProduction, false);
  assert.equal(receipt.plugins.length, 6);
  const index = receipt.plugins.find(plugin => plugin.to === replacement);
  assert.ok(index);
  assert.deepEqual(index.supportedPluginCodes, ['DESIGN_INDEX_VIEW']);
  assert.equal(index.partialReplacement, true);
  assert.equal(index.originalSourceRecovered, false);
  assert.equal(index.nativeCompatibilityVerified, false);
  assert.equal(receipt.unresolvedMappings.length, 6);
  assert.ok(receipt.unresolvedMappings.some(item => item.repo === original),
    'Partial index implementation must not remove the original layout-design blocker');
  const reverseFull = new Map(receipt.plugins.filter(plugin => !plugin.partialReplacement)
    .map(plugin => [plugin.to, plugin.from]));
  const reverseScoped = [{ ...designIndexSelection, from: replacement, to: original }];
  for (const [application, evidence] of Object.entries(receipt.applications)) {
    for (const file of evidence.files) {
      const sourceBytes = readFileSync(join(WORKSPACE, receipt.sourceModelRoot, file.path));
      const source = JSON.parse(sourceBytes);
      const model = JSON.parse(readFileSync(join(output, 'model', file.path)));
      assert.deepEqual(rewritePluginReferences(model, reverseFull, reverseScoped).model, source);
      assert.deepEqual(readFileSync(join(WORKSPACE, receipt.sourceModelRoot, file.path)), sourceBytes);
      const changes = file.changes.filter(item => item.from === original);
      assert.equal(changes.length, application === 'ModelDesign' ? 1 : 0);
      const repos = collectPluginReferences(model).packages.map(plugin => plugin.repo);
      if (application === 'ModelDesign') {
        assert.ok(repos.includes(original), 'Swagger repository must remain unresolved');
        assert.ok(repos.includes(replacement), 'Design index repository must be independently named');
        assert.ok(file.unresolved.includes(original));
      } else {
        assert.ok(!repos.includes(replacement));
      }
    }
  }
  assert.deepEqual(receipt.independentReplacementMappings, [{
    from: original, to: replacement, originalSourceRecovered: false, nativeCompatibilityVerified: false,
    originalMigrationAcceptance: 'not-satisfied-by-independent-replacement',
  }]);
});

test('partial index selection rejects truthy strings without touching a destination', () => {
  assert.throws(() => prepareNativeModelCandidate({
    output: join(WORKSPACE, '.artifacts/native-model-migration/invalid-design-index-selection'),
    designIndexReplacement: 'true',
  }), /selection must be boolean/);
});
