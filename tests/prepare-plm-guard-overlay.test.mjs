import assert from 'node:assert/strict';
import test from 'node:test';
import {
  guardImportMap, resolveGuardResource, rewriteGuardEntry, staticModuleReferences,
} from '../prepare-plm-guard-overlay.mjs';

test('entry preparation changes only the two parsed static entry attributes', () => {
  const html = '<!doctype html><html><head><script type="systemjs-importmap" src="./old-map.json?time=1"></script></head>' +
    '<body><script id="vite-legacy-entry" data-src="./old.js?time=1">System.import("unchanged")</script></body></html>';
  assert.equal(rewriteGuardEntry(html, { appEntry: './new.js', importMap: './new-map.json' }),
    html.replace('"./old-map.json?time=1"', '"./new-map.json"').replace('"./old.js?time=1"', '"./new.js"'));
  for (const changed of [html.replace('vite-legacy-entry', 'wrong-entry'), html + '<script type="systemjs-importmap" src="./extra.json"></script>']) {
    assert.throws(() => rewriteGuardEntry(changed, { appEntry: './new.js', importMap: './new-map.json' }));
  }
});

test('only the selected framework import and stylesheet mappings can change', () => {
  const map = {
    imports: { '@ibiz-template/vue3-components': '../old/index.js?time=1', vue: '../vue.js?time=1' },
    styles: { '@ibiz-template/vue3-components': '../old/index.css?time=1', another: '../another.css?time=1' },
    scopes: { retained: { value: 'exact' } },
  };
  const before = structuredClone(map);
  const root = '../js/@ibiz-template/vue3-components/guard-0123456789abcdef/';
  const changed = guardImportMap(map, root);
  assert.deepEqual(map, before);
  assert.equal(changed.imports.vue, map.imports.vue);
  assert.equal(changed.styles.another, map.styles.another);
  assert.deepEqual(changed.scopes, map.scopes);
  assert.equal(changed.imports['@ibiz-template/vue3-components'], `${root}index.system.min.js`);
  assert.equal(changed.styles['@ibiz-template/vue3-components'], `${root}index.min.css`);
  assert.throws(() => guardImportMap(map, '../outside/'));
});

test('module parsing includes declared and literal lazy dependencies and preserves unresolved dynamic boundaries', () => {
  const code = 'System.register(["vue","./child.js"],function(){const ignored="import(\\"./fake.js\\")";' +
    'return {execute(){ loader.import("./lazy.js"); import("./esm.js"); loader.import(dynamicPath); }};});';
  const result = staticModuleReferences(code);
  assert.deepEqual(result.references.sort(), ['./child.js', './esm.js', './lazy.js', 'vue'].sort());
  assert.equal(result.dynamic.length, 1);
  assert.equal(result.dynamic[0].expression, 'loader.import(dynamicPath)');
  assert.throws(() => staticModuleReferences('System.register([dynamicDependency], function(){});'));
});

test('bare imports resolve relative to the import-map file and cannot escape to other applications or origins', () => {
  const map = { imports: { vue: '../js/vue/index.js?time=1', external: 'https://outside.example/a.js' } };
  assert.equal(resolveGuardResource('vue', 'static/js/app.js', map, 'extras/json/map.json'), 'extras/js/vue/index.js');
  assert.equal(resolveGuardResource('./child.js', 'static/js/app.js', map, 'extras/json/map.json'), 'static/js/child.js');
  for (const reference of ['unknown', '/other-app/file.js', 'https://outside.example/a.js', 'external']) {
    assert.throws(() => resolveGuardResource(reference, 'static/js/app.js', map, 'extras/json/map.json'));
  }
});
