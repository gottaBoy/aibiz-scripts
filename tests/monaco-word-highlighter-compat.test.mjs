import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';
import { patchMonacoWordHighlighter } from '../monaco-word-highlighter-compat.mjs';

const require = createRequire(new URL('../../modelingweb/app/package.json', import.meta.url));
const ts = require('typescript');
const monacoRoot = new URL('../../vendor-upstream/gottaboy-plm-web/plugin-src/' +
  '@ibiz-template-plugin/ai-code@0.0.3-alpha.141/node_modules/monaco-editor/', import.meta.url);
const fixture = [
  'define("vs/editor/contrib/wordHighlighter/browser/wordHighlighter",',
  '["exports", "vs/base/common/errors"], function(exports, errors) {',
  'exports.WordHighlighterContribution = class {',
  'constructor(delayer) { this.runDelayer = delayer; }',
  'cursor() { return this.runDelayer.trigger(() => 1); }',
  'focus() { return this.runDelayer.trigger(() => 2); }',
  '}; });',
].join('\n');
const compactFixture = [
  'var modules = ["exports", "vs/base/common/errors",',
  '"vs/editor/contrib/wordHighlighter/browser/wordHighlighter"],',
  'decode = function(indices) {',
  'for (var result = [], index = 0, count = indices.length; index < count; index++)',
  'result[index] = modules[indices[index]];',
  'return result; };',
  fixture.replace('"vs/editor/contrib/wordHighlighter/browser/wordHighlighter"', 'modules[2]')
    .replace('["exports", "vs/base/common/errors"]', 'decode([0, 1])'),
].join('\n');

test('the exact installed Monaco bundle gets only two recorded call-site additions', () => {
  const input = fs.readFileSync(new URL('min/vs/editor/editor.main.js', monacoRoot));
  const result = patchMonacoWordHighlighter(input);
  assert.equal(result.evidence.callSites, 2);
  assert.equal(result.evidence.inputSha256,
    '90b588bc0b624e24052a576e1bcab2eaffec7bc666895188862eebd9c9745782');
  assert.notEqual(result.evidence.inputSha256, result.evidence.outputSha256);
  assert.equal(result.data.length - input.length, 2 * '.catch(y.onUnexpectedError)'.length);
  assert.deepEqual(Buffer.from(result.data.toString().replaceAll('.catch(y.onUnexpectedError)', '')), input);
  assert.throws(() => patchMonacoWordHighlighter(result.data), /already been patched/);
});

test('real Monaco error handling accepts lifecycle cancellation and reports actual faults', async () => {
  const errors = {};
  const source = fs.readFileSync(new URL('esm/vs/base/common/errors.js', monacoRoot), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  });
  vm.runInNewContext(compiled.outputText, { exports: errors, Error, setTimeout });
  const unexpected = [];
  errors.errorHandler.unexpectedErrorHandler = error => unexpected.push(error);
  const exports = {};
  vm.runInNewContext(patchMonacoWordHighlighter(Buffer.from(fixture)).data.toString(), {
    define(name, dependencies, factory) {
      assert.equal(name, 'vs/editor/contrib/wordHighlighter/browser/wordHighlighter');
      factory(exports, errors);
    },
  });
  let fault = new errors.CancellationError();
  const editor = new exports.WordHighlighterContribution({
    trigger: () => Promise.reject(fault),
  });
  await editor.cursor();
  await editor.focus();
  assert.deepEqual(unexpected, []);
  fault = new Error('worker failed');
  await editor.cursor();
  await editor.focus();
  assert.deepEqual(unexpected, [fault, fault]);
});

test('compact decoder binds its exact ordered table and handler before patching', () => {
  const result = patchMonacoWordHighlighter(Buffer.from(compactFixture));
  assert.equal(result.evidence.callSites, 2);
  assert.equal(result.data.toString().split('.catch(errors.onUnexpectedError)').length, 3);
});

for (const [label, source, error] of [
  ['invalid JavaScript', '{', /Invalid Monaco/],
  ['missing module', 'define("other", [], function() {});', /exactly one/],
  ['duplicate module', fixture + fixture, /exactly one/],
  ['missing error dependency', fixture.replace('vs/base/common/errors', 'different/errors'), /existing error handler/],
  ['missing delayed task', fixture.replace('this.runDelayer.trigger(() => 2)', 'Promise.resolve(2)'), /exactly two/],
  ['extra delayed task', fixture.replace('cursor() {', 'extra() { this.runDelayer.trigger(() => 3); } cursor() {'),
    /exactly two/],
  ['method parameter shadowing', fixture.replace('cursor()', 'cursor(errors)'), /binding is shadowed/],
  ['method local shadowing', fixture.replace('cursor() {', 'cursor() { const errors = {};'),
    /binding is shadowed/],
  ['catch parameter shadowing', fixture.replace(
    'return this.runDelayer.trigger(() => 1);',
    'try { throw {}; } catch (errors) { return this.runDelayer.trigger(() => 1); }'),
  /binding is shadowed/],
  ['error handler reassignment', fixture.replace('exports.WordHighlighterContribution',
    'errors = { onUnexpectedError() {} }; exports.WordHighlighterContribution'), /must not be reassigned/],
  ['reversed compact dependencies', compactFixture.replace('return result;', 'return result.reverse();'),
    /decoder implementation/],
  ['unknown compact decoder', compactFixture.replace('decode([0, 1])', 'other([0, 1])'),
    /decoder binding/],
  ['compact decoder reassignment', compactFixture.replace('define(modules[2]',
    'decode = indices => indices.reverse().map(index => modules[index]); define(modules[2]'),
  /must not be reassigned/],
  ['shadowed compact module table', compactFixture.replace('function(indices) {',
    'function(indices) { const modules = ["exports", "different/errors", "other/module"];'),
  /dependency decoder/],
]) {
  test(`compatibility patch rejects ${label}`, () => {
    assert.throws(() => patchMonacoWordHighlighter(Buffer.from(source)), error);
  });
}
