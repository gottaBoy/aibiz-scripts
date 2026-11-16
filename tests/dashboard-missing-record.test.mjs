import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const workspace = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const require = createRequire(join(workspace, 'ibiz-app-hub/package.json'));
const ts = require('typescript');
const sourcePaths = [
  'ibiz-app-hub/packages/runtime/src/controller/control/dashboard/custom-dashboard.controller.ts',
  'modelingweb/packages-latest/@ibiz-template/runtime/src/controller/control/dashboard/custom-dashboard.controller.ts',
];

function loadMissingRecordPredicate(sourcePath) {
  const file = join(workspace, dirname(sourcePath), 'dashboard.util.ts');
  const source = fs.readFileSync(file, 'utf8');
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const declaration = parsed.statements.find(statement =>
    ts.isFunctionDeclaration(statement) && statement.name?.text === 'isMissingUtilDataError');
  assert.ok(declaration, 'The maintained dashboard utility must export the real predicate');
  const compiled = ts.transpileModule(declaration.getText(parsed), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  const exports = {};
  new Function('exports', compiled.outputText)(exports);
  assert.equal(typeof exports.isMissingUtilDataError, 'function');
  return exports.isMissingUtilDataError;
}

function loadMethod(sourcePath) {
  const file = join(workspace, sourcePath);
  const source = fs.readFileSync(file, 'utf8');
  const parsed = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  assert.ok(parsed.statements.some(statement =>
    ts.isImportDeclaration(statement) && statement.moduleSpecifier.text === './dashboard.util' &&
    statement.importClause?.namedBindings?.elements?.some(element =>
      element.name.text === 'isMissingUtilDataError')),
  'The maintained controller must import the predicate from its local utility');
  const declaration = parsed.statements.find(statement =>
    ts.isClassDeclaration(statement) && statement.name?.text === 'CustomDashboardController');
  assert.ok(declaration);
  const method = declaration.members.find(member =>
    ts.isMethodDeclaration(member) && member.name.getText(parsed) === 'loadCustomModelData');
  assert.ok(method);
  const compiled = ts.transpileModule(
    `class Subject { ${method.getText(parsed)} }\nexports.Subject = Subject;`,
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  );
  const exports = {};
  new Function('exports', 'isMissingUtilDataError', compiled.outputText)(
    exports,
    loadMissingRecordPredicate(sourcePath),
  );
  return exports.Subject;
}

for (const sourcePath of sourcePaths) {
  test(`${sourcePath}: real missing-record predicate rejects unrelated and incomplete failures`, () => {
    const isMissing = loadMissingRecordPredicate(sourcePath);
    assert.equal(isMissing({ response: { data: { type: 'DataEntityRuntimeException', code: 3 } } }), true);
    assert.equal(isMissing({ response: { data: { type: 'DataEntityRuntimeException', code: '3' } } }), true);
    for (const error of [
      undefined, null, new Error('network failure'),
      { response: { status: 403 } },
      { response: { data: { type: 'DataEntityRuntimeException', code: 1 } } },
      { response: { data: { type: 'AccessDeniedException', code: 3 } } },
      { response: { data: { code: 3 } } },
    ]) assert.equal(isMissing(error), false);
  });

  test(`${sourcePath}: missing personal dashboard data returns empty state without an initialization write`, async () => {
    const Subject = loadMethod(sourcePath);
    const subject = new Subject();
    let saves = 0;
    subject.multiMode = false;
    subject.context = {};
    subject.params = {};
    subject.customModelData = [];
    subject.portletConfig = {};
    subject.getResourceTag = () => 'controlled-dashboard';
    subject.util = {
      async load() {
        throw { response: { data: { type: 'DataEntityRuntimeException', code: 3 } } };
      },
      async save() {
        saves += 1;
        return { model: [] };
      },
    };
    const result = await subject.loadCustomModelData();
    assert.deepEqual(result, { model: [], config: {} });
    assert.equal(saves, 0);
  });

  test(`${sourcePath}: non-missing dashboard errors remain visible and never trigger a fallback write`, async () => {
    const Subject = loadMethod(sourcePath);
    const subject = new Subject();
    let saves = 0;
    subject.multiMode = false;
    subject.context = {};
    subject.params = {};
    subject.customModelData = [];
    subject.portletConfig = {};
    subject.getResourceTag = () => 'controlled-dashboard';
    const failure = new Error('controlled dashboard backend failure');
    subject.util = {
      async load() { throw failure; },
      async save() { saves += 1; return {}; },
    };
    await assert.rejects(subject.loadCustomModelData(), error => error === failure);
    assert.equal(saves, 0);
  });
}
