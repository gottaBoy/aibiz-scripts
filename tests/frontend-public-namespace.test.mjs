import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const hub = path.join(workspace, 'ibiz-app-hub');
const require = createRequire(path.join(hub, 'package.json'));
const ts = require('typescript');
const source = relative => {
  const filename = path.join(hub, relative);
  const text = fs.readFileSync(filename, 'utf8');
  return ts.createSourceFile(filename, text, ts.ScriptTarget.Latest, true);
};
const execute = (text, dependencies = {}) => {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(text, { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022,
  } }).outputText, { exports, require(name) {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected executable dependency: ${name}`);
    return dependencies[name];
  } });
  return exports;
};

test('the existing namespace constant is publicly exported without changing its value or class default', () => {
  const namespaceSource = source('packages/core/src/utils/namespace/namespace.ts');
  const namespace = execute(namespaceSource.text);
  const barrel = source('packages/core/src/utils/index.ts');
  const declaration = barrel.statements.find(statement => ts.isExportDeclaration(statement) &&
    statement.moduleSpecifier?.text === './namespace/namespace');
  assert.ok(declaration?.exportClause?.elements.some(element => element.name.text === 'defaultNamespace'),
    'The public core entry must expose the actual existing namespace constant');
  const publicApi = execute(declaration.getText(barrel), { './namespace/namespace': namespace });
  assert.equal(publicApi.defaultNamespace, 'ibiz');
  assert.equal(publicApi.defaultNamespace, namespace.defaultNamespace);
  assert.equal(new namespace.Namespace('control').b(), 'ibiz-control');
  assert.equal(new namespace.Namespace('control', 'custom').b(), 'custom-control');
});

test('actual DRTab and fullscreen sources use the public core entry instead of generated out paths', () => {
  for (const relative of [
    'components/ibiz-next-vue3/src/control/drtab/drtab-control.util.ts',
    'components/ibiz-next-vue3/src/util/fullscreen/fullscreen-util.ts',
  ]) {
    const model = source(relative);
    const imports = model.statements.filter(statement => ts.isImportDeclaration(statement));
    const dependency = imports.find(statement => statement.importClause?.namedBindings?.elements?.some(
      element => element.name.text === 'defaultNamespace'));
    assert.equal(dependency?.moduleSpecifier.text, '@ibiz-template/core', relative);
    assert.ok(imports.every(statement => !statement.moduleSpecifier.text.startsWith('@ibiz-template/core/out/')));
  }
});
