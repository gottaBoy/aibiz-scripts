import assert from 'node:assert/strict';
import fs from 'node:fs';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import { WORKSPACE } from '../harness-modeling-core-audit.mjs';
import {
  compileNativePluralize, modelDesignRuntimeImportMap, modelDesignRuntimeNginx,
  pluralizeAsset, replayNativePluralize, runtimeBridgeAsset, runtimeLoaderBridge,
  runtimeLoaderImport, runtimeModelRepo,
} from '../native-model-design-runtime.mjs';
import { runtimeAssetNginx, runtimeImportMap } from '../prepare-native-ai-code-runtime-assets.mjs';
import { DEFAULT_NATIVE_MODEL_DESIGN_SOURCE_REPORT } from '../native-modeling-config.mjs';

const sourceReport = JSON.parse(fs.readFileSync(join(WORKSPACE, DEFAULT_NATIVE_MODEL_DESIGN_SOURCE_REPORT)));
const pluralize = sourceReport.dependencyLock.roots.find(item => item.name === 'pluralize');
assert.equal(pluralize?.version, '8.0.0', 'Current candidate must pin pluralize 8');
const pluralizeRoot = join(sourceReport.packageRoot, '.dependencies', pluralize.id);

test('runtime imports preserve actual dist peers, styles, scopes and queries on both base paths', () => {
  const baseline = JSON.parse(fs.readFileSync(join(WORKSPACE, 'modelingweb/app/dist/extras/json/system-import.json')));
  const before = structuredClone(baseline);
  const mapped = modelDesignRuntimeImportMap(runtimeImportMap(baseline));
  assert.deepEqual(baseline, before);
  for (const [key, target] of Object.entries(before.imports)) assert.equal(mapped.imports[key], target);
  assert.deepEqual(modelDesignRuntimeImportMap(mapped), mapped);
  assert.equal(Object.keys(mapped.imports).length, Object.keys(before.imports).length + 3);
  for (const app of ['central', 'modeldesign', 'nested/modeldesign']) {
    const base = `http://127.0.0.1:32118/${app}/extras/json/system-import.json`;
    assert.equal(new URL(mapped.imports[runtimeLoaderImport], base).pathname, `/${app}/${runtimeBridgeAsset}`);
    assert.equal(new URL(mapped.imports.pluralize, base).pathname, `/${app}/${pluralizeAsset}`);
    const bridge = new URL(mapped.imports[runtimeLoaderImport], base);
    assert.equal(new URL('./loader/index.js', bridge).origin, new URL(base).origin);
    assert.equal(new URL('./loader/index.js', bridge).pathname, `/${app}/plugins/${runtimeModelRepo}/loader/index.js`);
  }
  const custom = { imports: { vue: '/host/vue.js?x=1' }, scopes: { '/other/': { vue: '/other/vue.js' } },
    styles: { host: '/host.css' } };
  const result = modelDesignRuntimeImportMap(custom);
  assert.deepEqual(result.scopes, custom.scopes);
  assert.deepEqual(result.styles, custom.styles);
});

for (const name of [runtimeLoaderImport, 'pluralize']) {
  test(`runtime map rejects an existing conflicting ${name} mapping`, () => {
    assert.throws(() => modelDesignRuntimeImportMap({ imports: { [name]: 'https://untrusted.invalid/a.js' } }),
      /Do not silently replace/);
  });
}

test('bridge uses native ESM import at its own versioned URL, never System.import on raw ESM', () => {
  const source = runtimeLoaderBridge().toString();
  assert.match(source, /await import\(new URL\("\.\/loader\/index\.js", context\.meta\.url\)\.href\)/);
  assert.doesNotMatch(source, /context\.import|System\.import|document\.baseURI|location\.origin/);
  assert.match(source, /typeof loader\.applyPolyfills/);
  assert.match(source, /typeof loader\.defineCustomElements/);
  assert.match(source, /exports\(loader\)/);
});

test('nginx adds only explicit .2 and pluralize routes, keeping the pinned Monaco worker route', () => {
  const original = 'server {\n    location ^~ /nativeappcode/plugins/ {\n    }\n}\n';
  const nginx = modelDesignRuntimeNginx(runtimeAssetNginx(original));
  assert.match(nginx, /location \^~ \/nativeappcode\/plugins\/@ibiz-template-plugin\/runtime-model@0\.2\.2-local\.2\//);
  assert.match(nginx, /location \^~ \/nativeappcode\/extras\/js\/pluralize\/8\.0\.0\//);
  assert.match(nginx, /location \^~ \/plugins\/monaco-editor@0\.52\.2\//);
  assert.doesNotMatch(nginx, /location \^~ \/plugins\/ \{/);
  assert.equal(nginx.split('    location ^~ /nativeappcode/plugins/ {').length, 2);
});

test('genuine locked pluralize CJS builds byte-reproducibly and executes real inflections', async () => {
  const built = await compileNativePluralize({ root: pluralizeRoot });
  const replay = replayNativePluralize({ root: pluralizeRoot });
  assert.deepEqual(built, replay);
  const exports = {};
  runInNewContext(built.data.toString(), {
    System: { register(deps, declare) {
      assert.deepEqual(Array.from(deps), []);
      declare((name, value) => {
        if (typeof name === 'object') Object.assign(exports, name);
        else exports[name] = value;
      }, { meta: { url: 'http://127.0.0.1/modeldesign/' + pluralizeAsset } }).execute();
    } },
  });
  assert.equal(typeof exports.default, 'function');
  assert.equal(exports.default('person', 2), 'people');
  assert.equal(exports.default('people', 1), 'person');
  assert.equal(exports.default('fish', 2), 'fish');
  assert.equal(exports.default('box', 3, true), '3 boxes');
  assert.equal(built.inputs.length, 2);
});

test('pluralize compilation rejects changed identity or unexpected dependencies, including symlink ancestors', async t => {
  const root = fs.mkdtempSync(join(WORKSPACE, '.artifacts/test-pluralize-source-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.cpSync(pluralizeRoot, join(root, 'package'), { recursive: true });
  const manifestPath = join(root, 'package/package.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath));
  fs.writeFileSync(manifestPath, JSON.stringify({ ...manifest, version: '7.0.0' }));
  await assert.rejects(compileNativePluralize({ root: join(root, 'package') }), /8\.0\.0/);
  fs.writeFileSync(manifestPath, JSON.stringify({ ...manifest, dependencies: { fake: '*' } }));
  await assert.rejects(compileNativePluralize({ root: join(root, 'package') }), /dependency-free/);
  fs.writeFileSync(manifestPath, JSON.stringify(manifest));
  fs.symlinkSync(join(root, 'package'), join(root, 'linked'), 'dir');
  await assert.rejects(compileNativePluralize({ root: join(root, 'linked') }), /Symlink directory/);
});
