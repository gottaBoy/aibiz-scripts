import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { languageImportMap, languageSourceInventory } from '../prepare-plm-language-runtime-candidate.mjs';

test('only runtime and component entries/styles change; the original map remains untouched', () => {
  const original = { imports: {
    '@ibiz-template/runtime': '../js/old-runtime.js',
    '@ibiz-template/vue3-components': '../js/old-components.js',
    vue: '../js/vue.js', another: '../js/other.js',
  }, styles: { '@ibiz-template/vue3-components': '../css/old.css', another: '../css/other.css' } };
  const before = structuredClone(original);
  const changed = languageImportMap(original, 'a'.repeat(16));
  assert.deepEqual(original, before);
  assert.equal(changed.imports.vue, original.imports.vue);
  assert.equal(changed.imports.another, original.imports.another);
  assert.equal(changed.styles.another, original.styles.another);
  for (const name of ['runtime', 'vue3-components']) {
    assert.equal(changed.imports[`@ibiz-template/${name}`],
      `../js/@ibiz-template/${name}/language-${'a'.repeat(16)}/index.system.min.js`);
  }
  assert.throws(() => languageImportMap(original, '../outside'));
});

test('snapshot inventory includes actual sources, configs and tests while excluding generated and dependency trees', t => {
  const directory = fs.mkdtempSync(path.join(tmpdir(), 'language-source-inventory-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  fs.mkdirSync(path.join(directory, 'src'));
  fs.mkdirSync(path.join(directory, 'dist'));
  fs.mkdirSync(path.join(directory, 'node_modules'));
  fs.writeFileSync(path.join(directory, 'src/helper.ts'), 'export const value = 1;\n');
  fs.writeFileSync(path.join(directory, 'dist/old.js'), 'not-source');
  fs.writeFileSync(path.join(directory, 'node_modules/ignored.js'), 'dependency');
  fs.writeFileSync(path.join(directory, 'package.json'), '{}');
  assert.deepEqual(languageSourceInventory(directory).map(item => item.path), ['package.json', 'src/helper.ts']);
  fs.symlinkSync(path.join(directory, 'src/helper.ts'), path.join(directory, 'src/linked.ts'));
  assert.throws(() => languageSourceInventory(directory), /Source symlink/);
});
