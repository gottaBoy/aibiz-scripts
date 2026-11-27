import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertLifecycleBuildVerification, lifecycleRuntimeMap, lifecycleSystemContract, resolveLifecycleRuntime,
} from '../prepare-plm-control-lifecycle-runtime.mjs';

test('SystemJS contract binds the real exporter and setter symbols while excluding shadowed names', () => {
  const text = `System.register(["@ibiz-template/core"], function (publish) {
    function unrelated(publish) { publish("not-an-export", 1); }
    return { setters: [function (dependency) {
      first = dependency.First;
      second = dependency["Second"];
      function nested(dependency) { third = dependency.Unrelated; }
    }], execute: function () { publish({ One: first, Two: second }); publish("Three", 3); } };
  });`;
  assert.deepEqual(lifecycleSystemContract(text), {
    dependencies: ['@ibiz-template/core'], exports: ['One', 'Three', 'Two'],
    imports: [{ dependency: '@ibiz-template/core', properties: ['First', 'Second'] }],
  });
});

test('ambiguous, computed and multiple SystemJS contracts refuse a narrow runtime candidate', () => {
  for (const source of [
    'System.register([], function(publish) {return {setters:[],execute(){publish(name, 1)}}})',
    'System.register(["x"], function(publish) {return {setters:[x=>x[computed]],execute(){}}})',
    'System.register([computed], function(publish) {return {setters:[],execute(){}}})',
    'System.register([], function(publish) {return {setters:[],execute(){}}}); System.register([], function(publish) {return {setters:[],execute(){}}})',
  ]) assert.throws(() => lifecycleSystemContract(source));
});

test('the narrow map switches only runtime and preserves all styles, scopes and other imports', () => {
  const original = { imports: { '@ibiz-template/runtime': '../old-runtime.js',
    '@ibiz-template/core': '../core.js', '@ibiz-template/vue3-components': '../components.js' },
  styles: { '@ibiz-template/vue3-components': '../components.css' }, scopes: { '/owned': { x: './x.js' } } };
  const changed = lifecycleRuntimeMap(original, '1234567890abcdef');
  assert.equal(changed.imports['@ibiz-template/runtime'],
    '../js/@ibiz-template/runtime/lifecycle-1234567890abcdef/index.system.min.js');
  changed.imports['@ibiz-template/runtime'] = original.imports['@ibiz-template/runtime'];
  assert.deepEqual(changed, original);
  assert.equal(original.imports['@ibiz-template/runtime'], '../old-runtime.js');
  assert.throws(() => lifecycleRuntimeMap(original, '../outside'));
});

test('follow-up releases resolve the existing language or lifecycle runtime without expanding the publication root', () => {
  const entries = { appEntry: 'static/js/current.js', importMap: 'extras/json/current.json' };
  const map = value => ({ imports: { '@ibiz-template/runtime': value } });
  for (const kind of ['language', 'lifecycle']) {
    const relative = `extras/js/@ibiz-template/runtime/${kind}-1234567890abcdef/index.system.min.js`;
    assert.equal(resolveLifecycleRuntime(entries, map(`../js/@ibiz-template/runtime/${kind}-1234567890abcdef/index.system.min.js`)),
      relative);
  }
  for (const value of [
    '../js/@ibiz-template/runtime/index.system.min.js',
    '../js/@ibiz-template/core/lifecycle-1234567890abcdef/index.system.min.js',
    '../js/@ibiz-template/runtime/lifecycle-1234567890abcde/index.system.min.js',
    'https://example.invalid/runtime.js',
    '../../../../outside.js',
  ]) assert.throws(() => resolveLifecycleRuntime(entries, map(value)));
});

test('two equal output trees cannot authorize publication without the exact producer plan and output bindings', () => {
  const reportSha256 = '1'.repeat(64), planSha256 = '2'.repeat(64);
  const verification = {
    status: 'PASS_ALL_GENERATED_BYTES_AND_DIRECT_SYSTEM_DEPENDENCY_BINDINGS',
    producerReportSha256: reportSha256, producerPlanSha256: planSha256,
    allOutputs: { bytewise: true }, outputsMatchProducerReceipt: true,
    systemEntryBindingsVerified: true, systemModuleBindingsVerified: true,
  };
  assertLifecycleBuildVerification(verification, reportSha256, planSha256);
  for (const field of ['outputsMatchProducerReceipt', 'systemEntryBindingsVerified',
    'systemModuleBindingsVerified']) {
    assert.throws(() => assertLifecycleBuildVerification({ ...verification, [field]: false }, reportSha256, planSha256));
  }
  assert.throws(() => assertLifecycleBuildVerification(verification, reportSha256, '3'.repeat(64)));
  assert.throws(() => assertLifecycleBuildVerification(verification, '4'.repeat(64), planSha256));
  assert.throws(() => assertLifecycleBuildVerification(verification, reportSha256));
});
