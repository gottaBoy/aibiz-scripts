import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  bindLanguageAbsoluteAsset, languageAbsoluteAssetSource, languageImportMap, languageSourceInventory,
} from '../prepare-plm-language-runtime-candidate.mjs';

test('absolute assets bind only exact login aliases, public PNG bytes and the Nginx startup source', () => {
  for (const name of ['login-header.png', 'login-avatar.png']) {
    const reference = `/assets/images/${name}`;
    const sourcePath = `plm-web/public${reference}`;
    assert.equal(languageAbsoluteAssetSource(reference), sourcePath);
    const source = fs.readFileSync(new URL(`../../${sourcePath}`, import.meta.url));
    const nginx = fs.readFileSync(new URL('../../plm-web/nginx-local.conf', import.meta.url));
    const binding = bindLanguageAbsoluteAsset(reference, source, Buffer.from(source), nginx);
    assert.equal(binding.urlPath, reference);
    assert.equal(binding.sourcePath, sourcePath);
    assert.equal(binding.bytes, source.length);
    assert.throws(() => bindLanguageAbsoluteAsset(reference, source, Buffer.from('foreign'), nginx));
    assert.throws(() => bindLanguageAbsoluteAsset(reference, source, source, Buffer.from('server {}')));
    assert.throws(() => bindLanguageAbsoluteAsset(reference, Buffer.from('not-png'), Buffer.from('not-png'), nginx));
  }
  for (const reference of [
    '/assets/images/another.png', '/api/private', '//example.invalid/login-header.png',
    'http://example.invalid/assets/images/login-header.png',
    '/assets/images/../images/login-header.png', '/assets/images/login-header.png?version=1',
    '/assets/images/%6cogin-header.png', '__proto__',
  ]) {
    assert.equal(languageAbsoluteAssetSource(reference), undefined);
    assert.throws(() => bindLanguageAbsoluteAsset(reference, Buffer.alloc(0), Buffer.alloc(0), Buffer.alloc(0)));
  }
});

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
