import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';

const sourceUrl = new URL('../../vendor-upstream/gottaboy-plm-web/plugin-src/' +
  '@ibiz-template-plugin/ai-code@0.0.3-alpha.141/src/monaco-editor/monaco-editor.tsx',
import.meta.url);
const require = createRequire(new URL('../../vendor-upstream/gottaboy-plm-web/plugin-src/' +
  '@ibiz-template-plugin/ai-code@0.0.3-alpha.141/package.json', import.meta.url));
const ts = require('typescript');
const source = ts.createSourceFile(fileURLToPath(sourceUrl), fs.readFileSync(sourceUrl, 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const expressions = [];

function visit(node) {
  if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
      node.expression.expression.getText(source) === 'loader' &&
      node.expression.name.text === 'config') {
    expressions.push(node.arguments[0]);
  }
  ts.forEachChild(node, visit);
}
visit(source);
assert.equal(expressions.length, 1, 'Test the actual editor loader configuration');
const { outputText } = ts.transpileModule(`result = (${expressions[0].getText(source)});`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
});

function configuredPath(pluginBaseUrl, baseURI) {
  const context = { URL, ibiz: { env: { pluginBaseUrl } }, document: { baseURI },
    envlanguag: 'zh-cn', result: undefined };
  vm.runInNewContext(outputText, context);
  assert.equal(context.result['vs/nls'].availableLanguages['*'], 'zh-cn');
  return context.result.paths.vs;
}

for (const [name, plugins, base, expected] of [
  ['Central relative plugins', './plugins', 'http://127.0.0.1:32008/central/#/route',
    'http://127.0.0.1:32008/central/plugins/'],
  ['ModelDesign relative plugins', './plugins', 'http://127.0.0.1:32009/modeldesign/#/route',
    'http://127.0.0.1:32009/modeldesign/plugins/'],
  ['document base element', '../plugins', 'http://localhost/apps/modeldesign/',
    'http://localhost/apps/plugins/'],
  ['root-relative plugins', '/plugins', 'http://localhost/modeldesign/',
    'http://localhost/plugins/'],
  ['absolute plugins', 'http://localhost:32009/modeldesign/plugins', 'http://localhost/central/',
    'http://localhost:32009/modeldesign/plugins/'],
]) {
  test(`Monaco worker uses an absolute URL for ${name}`, () => {
    const result = configuredPath(plugins, base);
    assert.equal(result, `${expected}monaco-editor@0.52.2/min/vs`);
    assert.equal(new URL('./language/typescript/tsWorker.js', `${result}/`).href,
      `${expected}monaco-editor@0.52.2/min/vs/language/typescript/tsWorker.js`);
  });
}
