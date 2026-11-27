import assert from 'node:assert/strict';
import test from 'node:test';
import { lifecycleRuntimeMap, lifecycleSystemContract } from '../prepare-plm-control-lifecycle-runtime.mjs';

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
