import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { installedPackage } from '../harness-native-ai-code-source-deps.mjs';
import {
  compareModelDesignActionDeclarations, compareModelDesignBrowserImports,
  inspectModelDesignActionArguments, inspectNativeModelDesignCompatibility, inspectRuntimeLoaderExports, main,
} from '../inspect-native-model-design-compatibility.mjs';

const workspace = fileURLToPath(new URL('../../', import.meta.url));
const pkg = installedPackage(join(workspace, 'modelingweb/app'), 'typescript');
const ts = createRequire(join(pkg.realpath, 'package.json'))(pkg.realpath);

test('static import coverage preserves all missing dependencies and false browser acceptance', () => {
  const result = compareModelDesignBrowserImports([
    'vue', '@ibiz-template-plugin/runtime-model/loader', '@monaco-editor/loader', 'pluralize',
  ], { imports: { vue: '../js/vue/3.3.8/runtime.js' } });
  assert.deepEqual(result.missing, [
    '@ibiz-template-plugin/runtime-model/loader', '@monaco-editor/loader', 'pluralize',
  ]);
  assert.equal(result.imports[0].coveredByStaticMap, true);
  assert.equal(result.imports.every(item => item.deliveryVerified === false), true);
  assert.equal(result.browserExecuted, false);
  assert.equal(result.browserAccepted, false);
  assert.equal(result.dynamicRegistrationEvaluated, false);
});

test('exact imports override longest prefix and valid prefixes retain the subpath', () => {
  const result = compareModelDesignBrowserImports(['@ibiz/runtime/loader', '@ibiz/runtime/extra'], {
    imports: {
      '@ibiz/': '../generic/',
      '@ibiz/runtime/': '../runtime/',
      '@ibiz/runtime/loader': '../exact/loader.mjs',
    },
  });
  assert.deepEqual(result.imports.map(item => item.target), [
    '../exact/loader.mjs', '../runtime/extra',
  ]);
  assert.deepEqual(result.missing, []);
  assert.equal(result.browserAccepted, false);
});

test('blocked exact targets and invalid prefix targets cannot manufacture coverage', () => {
  for (const target of [null, '']) {
    const result = compareModelDesignBrowserImports(['runtime/loader'], {
      imports: { 'runtime/loader': target, 'runtime/': '../available/' },
    });
    assert.deepEqual(result.missing, ['runtime/loader']);
  }
  assert.deepEqual(compareModelDesignBrowserImports(['runtime/loader'], {
    imports: { 'runtime/': '../not-a-directory.js' },
  }).missing, ['runtime/loader']);
  assert.throws(() => compareModelDesignBrowserImports(['runtime'], { imports: [] }), /imports object/);
  assert.throws(() => compareModelDesignBrowserImports([], { imports: {} }), /nonempty unique/);
  assert.throws(() => compareModelDesignBrowserImports(['x', 'x'], { imports: {} }), /nonempty unique/);
});

test('compiled loader exports are observed without turning them into runtime source or API acceptance', () => {
  const result = inspectRuntimeLoaderExports(ts, Buffer.from(`
    export { applyPolyfills } from '../dist/esm/polyfills/index.mjs';
    export { custom as defineCustomElements } from '../dist/esm/loader.mjs';
  `));
  assert.equal(result.requestedNamesObserved, true);
  assert.deepEqual(result.exports.map(item => item.name), ['applyPolyfills', 'defineCustomElements']);
  assert.equal(result.exports[1].imported, 'custom');
  assert.equal(result.authenticSourceRecovered, false);
  assert.equal(result.sourceBuildVerified, false);
  assert.equal(result.behavioralCompatibilityVerified, false);
  assert.equal(inspectRuntimeLoaderExports(ts, Buffer.from(
    "export { applyPolyfills } from './polyfills.mjs';")).requestedNamesObserved, false);
});

test('service actions distinguish manager second arguments and both conditional branches', () => {
  const result = inspectModelDesignActionArguments(ts, [{ path: 'src/actions.tsx', data: Buffer.from(`
    app.deService.exec('Entity', 'CopyModel', context, params);
    app.deService.exec(entity, 'PasteModel', context, data, params);
    service.exec('ImportModelV2', context, params);
    service.exec(props.data.isMerge ? 'mergemodeldsl' : 'ExportModelDSL', context, params);
    arbitrary.exec('NotAnAction');
  `) }]);
  assert.deepEqual(result.observedActions, [
    'CopyModel', 'ExportModelDSL', 'ImportModelV2', 'PasteModel', 'mergemodeldsl',
  ]);
  assert.deepEqual(result.calls.map(call => call.actionArgumentIndex), [1, 1, 0, 0]);
  assert.deepEqual(result.calls[3].literalActions, ['ExportModelDSL', 'mergemodeldsl']);
  assert.equal(result.calls[3].dynamicSelection, true);
  assert.equal(result.calls.every(call => !call.receiverTypeVerified && !call.selectedActionExecuted), true);
  assert.equal(result.unrecognizedExecCalls.length, 1);
  assert.equal(result.completeApiSurfaceVerified, false);
  assert.equal(result.strictApiCompatibilityVerified, false);
});

test('dynamic table values remain observations and unknown arguments never become resolved calls', () => {
  const result = inspectModelDesignActionArguments(ts, [{ path: 'src/actions.ts', data: Buffer.from(`
    const actionMap = { advanced: 'CopyModel', default: 'ExportModelV2', opaque: computed };
    service.exec(actionMap[props.data.type], context, params);
    service.exec(isMerge ? 'mergemodeldsl' : dynamicAction, context, params);
    service.exec();
  `) }]);
  assert.deepEqual(result.observedActions, ['CopyModel', 'ExportModelV2', 'mergemodeldsl']);
  assert.deepEqual(result.calls[0].literalActions, []);
  assert.deepEqual(result.calls[0].literalTableObservation.entries, [
    { key: 'advanced', action: 'CopyModel' }, { key: 'default', action: 'ExportModelV2' },
  ]);
  assert.match(result.calls[0].literalTableObservation.role, /not-scope-or-index-resolution/);
  assert.equal(result.calls[2].actionExpression, null);
  assert.equal(result.dynamicInputsVerified, false);
  assert.equal(result.typeResolutionExecuted, false);
  assert.equal(result.endpointExecuted, false);
});

test('entity action declaration comparison is case-insensitive but is not endpoint or routing acceptance', () => {
  const result = compareModelDesignActionDeclarations(['CopyModel', 'mergemodeldsl', 'PasteModel'], [
    { app: 'ModelDesign', entities: [
      { name: 'One', path: 'one.json', sha256: 'one', model: {
        getAllPSAppDEMethods: [{ name: 'COPYMODEL' }, { codeName: 'MergeModelDSL' }],
        getAllPSAppDEActions: [{ name: 'CopyModel' }],
      } },
      { name: 'Two', path: 'two.json', sha256: 'two', model: {
        getAllPSAppDEActions: [{ name: 'PasteModel' }],
      } },
    ] },
    { app: 'Central', entities: [] },
  ]);
  assert.deepEqual(result.apps[0].actions.map(item => item.matchingEntities), [['One'], ['One'], ['Two']]);
  assert.deepEqual(result.apps[1].actions.map(item => item.matchingEntities), [[], [], []]);
  assert.equal(result.apps[0].entities[0].sha256, 'one');
  assert.equal(Object.hasOwn(result.apps[0].entities[0], 'model'), false);
  assert.equal(result.entitySelectionVerified, false);
  assert.equal(result.requestResponseCompatibilityVerified, false);
  assert.equal(result.endpointExecuted, false);
  assert.equal(result.strictApiCompatibilityVerified, false);
  assert.throws(() => compareModelDesignActionDeclarations([], []), /nonempty unique/);
});

test('compatibility output cannot write outside its dedicated artifact tree', () => {
  assert.throws(() => inspectNativeModelDesignCompatibility({ workspace, output: 'scripts' }), /direct child/);
  assert.throws(() => inspectNativeModelDesignCompatibility({
    workspace, output: '.artifacts/native-model-design-compatibility',
  }), /direct child/);
});

test('compatibility help never reconstructs or accepts a replacement', () => {
  const lines = [];
  const original = console.log;
  console.log = line => lines.push(line);
  try { assert.equal(main(['--help']), 0); }
  finally { console.log = original; }
  assert.match(lines.join('\n'), /no installs, source reconstruction, deployment or browser acceptance/);
  assert.match(lines.join('\n'), /Exit 2/);
});
