import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { workspace } from '../localization-baseline.mjs';

const require = createRequire(join(workspace, 'ibiz-app-hub/package.json'));
const ts = require('typescript');
const path = join(workspace, 'ibiz-app-hub/components/ibiz-next-vue3/src/web-app/main.ts');
const source = readFileSync(path, 'utf8');
const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true);
let registration;
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'AppRouter.setAuthGuard') {
    assert.equal(registration, undefined);
    registration = node.getText(ast);
  }
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(registration, 'test the actual host callback registration');
const code = ts.transpileModule(registration, {
  compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
}).outputText;
function callbacks(opts, authGuard) {
  let selected;
  vm.runInNewContext(code, {
    opts, authGuard,
    AppRouter: { setAuthGuard: (...values) => { selected = values; } },
  });
  return selected;
}

test('explicit custom login redirects reach the host without replacing the selected guard', async () => {
  const calls = [];
  const custom = {
    verify: (...args) => { calls.push(args); return true; },
    getLoginRedirect: () => { throw new Error('implicit custom policy must not execute'); },
  };
  const redirect = url => ({ path: '/login', query: { ru: url } });
  const [verify, getRedirect] = callbacks({ getAuthGuard: () => custom, getLoginRedirect: redirect }, custom);
  assert.equal(getRedirect, redirect);
  assert.equal(getRedirect('/-/index/-').query.ru, '/-/index/-');
  const context = { own: true };
  assert.equal(await verify(context, false), true);
  assert.equal(calls[0][0], context);
  assert.equal(calls[0][1], false);
});

test('custom guards without an explicit redirect retain their old API and never inherit a new policy', () => {
  const custom = { verify() {}, getLoginRedirect() { throw new Error('must not execute'); } };
  assert.equal(callbacks({ getAuthGuard: () => custom }, custom)[1], undefined);
});

test('default guards retain the standard redirect and preserve real redirect failures', () => {
  const failure = new Error('actual redirect policy failed');
  const guard = { verify() {}, getLoginRedirect(url) { return url; } };
  assert.equal(callbacks(undefined, guard)[1]('own-route'), 'own-route');
  const [, custom] = callbacks({ getLoginRedirect() { throw failure; } }, guard);
  assert.throws(() => custom('own-route'), error => error === failure);
});
