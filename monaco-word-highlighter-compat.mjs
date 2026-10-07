import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../modelingweb/app/package.json', import.meta.url));
const ts = require('typescript');
assert.equal(ts.version, '5.3.3', 'Monaco compatibility inspection requires pinned TypeScript');
const moduleName = 'vs/editor/contrib/wordHighlighter/browser/wordHighlighter';
const errorsModule = 'vs/base/common/errors';
export const monacoWordHighlighterPatch = 'monaco-0.52.2-word-highlighter-delayer-rejections-v1';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

export function patchMonacoWordHighlighter(input) {
  const text = input.toString('utf8');
  const ast = ts.createSourceFile('editor.main.js', text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.equal(ast.parseDiagnostics.length, 0, 'Invalid Monaco runtime JavaScript');
  const options = { allowJs: true, noLib: true, noResolve: true };
  const host = ts.createCompilerHost(options);
  host.getSourceFile = name => name === ast.fileName ? ast : undefined;
  const checker = ts.createProgram([ast.fileName], options, host).getTypeChecker();
  const binding = node => checker.getSymbolAtLocation(node);
  const tables = new Map();
  const walk = (node, visit) => {
    visit(node);
    ts.forEachChild(node, child => walk(child, visit));
  };
  walk(ast, node => {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer &&
        ts.isArrayLiteralExpression(node.initializer) &&
        node.initializer.elements.every(ts.isStringLiteral)) {
      const values = node.initializer.elements.map(item => item.text);
      if (values.includes(moduleName)) {
        assert.ok(binding(node.name) && !tables.has(binding(node.name)), 'Ambiguous Monaco module table');
        tables.set(binding(node.name), values);
      }
    }
  });
  const decode = node => {
    if (ts.isStringLiteral(node)) return node.text;
    if (ts.isElementAccessExpression(node) && ts.isIdentifier(node.expression) &&
        ts.isNumericLiteral(node.argumentExpression)) {
      return tables.get(binding(node.expression))?.[Number(node.argumentExpression.text)];
    }
    return undefined;
  };
  const modules = [];
  walk(ast, node => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) &&
        node.expression.text === 'define' && node.arguments.length === 3 &&
        decode(node.arguments[0]) === moduleName) modules.push(node);
  });
  assert.equal(modules.length, 1, 'Expected exactly one Monaco word-highlighter module');
  const module = modules[0];
  const factory = module.arguments[2];
  assert.ok(ts.isFunctionExpression(factory), 'Unexpected Monaco word-highlighter factory');
  const dependencies = module.arguments[1];
  let names;
  if (ts.isArrayLiteralExpression(dependencies) && dependencies.elements.every(ts.isStringLiteral)) {
    names = dependencies.elements.map(item => item.text);
  } else {
    assert.ok(ts.isCallExpression(dependencies) && dependencies.arguments.length === 1 &&
      ts.isIdentifier(dependencies.expression) &&
      ts.isArrayLiteralExpression(dependencies.arguments[0]) &&
      dependencies.arguments[0].elements.every(ts.isNumericLiteral) &&
      ts.isElementAccessExpression(module.arguments[0]),
    'Unexpected compact Monaco dependency table');
    const tableBinding = binding(module.arguments[0].expression);
    const table = tables.get(tableBinding);
    const decoderBinding = binding(dependencies.expression);
    const declarations = decoderBinding?.declarations;
    assert.ok(declarations?.length === 1 && ts.isVariableDeclaration(declarations[0]),
      'Unexpected compact Monaco dependency decoder binding');
    const decoder = declarations[0].initializer;
    assert.ok(decoder && ts.isFunctionExpression(decoder) && !decoder.name &&
      decoder.parameters.length === 1 && ts.isIdentifier(decoder.parameters[0].name) &&
      decoder.body.statements.length === 2 && ts.isForStatement(decoder.body.statements[0]),
    'Unexpected compact Monaco dependency decoder');
    const loop = decoder.body.statements[0];
    assert.ok(loop.initializer && ts.isVariableDeclarationList(loop.initializer) &&
      loop.initializer.declarations.length === 3 &&
      loop.initializer.declarations.every(declaration => ts.isIdentifier(declaration.name)),
    'Unexpected compact Monaco dependency decoder loop');
    const renames = new Map([
      [tableBinding, 'modules'],
      [binding(decoder.parameters[0].name), 'indices'],
      ...loop.initializer.declarations.map((declaration, index) =>
        [binding(declaration.name), ['result', 'index', 'count'][index]]),
    ]);
    assert.equal(renames.size, 5, 'Ambiguous compact Monaco decoder bindings');
    const transformed = ts.transform(decoder, [context => {
      const visit = node => {
        if (ts.isIdentifier(node) && renames.has(binding(node))) {
          return ts.factory.createIdentifier(renames.get(binding(node)));
        }
        return ts.visitEachChild(node, visit, context);
      };
      return node => ts.visitNode(node, visit);
    }]);
    try {
      const expected = ts.createSourceFile('decoder.js',
        'const decode = function(indices) { for (var result = [], index = 0, count = indices.length;' +
        ' index < count; index++) result[index] = modules[indices[index]]; return result; };',
        ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
      const shape = node => {
        const children = [];
        ts.forEachChild(node, child => { children.push(shape(child)); });
        return {
          kind: node.kind,
          ...(ts.isIdentifier(node) || ts.isLiteralExpression(node) ? { text: node.text } : {}),
          ...(ts.isVariableDeclarationList(node) ? { scope: node.flags & ts.NodeFlags.BlockScoped } : {}),
          children,
        };
      };
      assert.deepEqual(shape(transformed.transformed[0]),
        shape(expected.statements[0].declarationList.declarations[0].initializer),
      'Unexpected compact Monaco dependency decoder implementation');
    } finally { transformed.dispose(); }
    walk(ast, node => {
      if (ts.isBinaryExpression(node) &&
          node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
          node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
          ts.isIdentifier(node.left)) {
        assert.ok(![tableBinding, decoderBinding].includes(binding(node.left)),
          'Compact Monaco dependency bindings must not be reassigned');
      }
    });
    names = dependencies.arguments[0].elements.map(item => table[Number(item.text)]);
  }
  assert.equal(names.filter(name => name === errorsModule).length, 1,
    'Monaco word-highlighter must import its existing error handler');
  assert.equal(factory.parameters.length, names.length, 'Monaco factory dependencies differ');
  const errors = factory.parameters[names.indexOf(errorsModule)].name;
  assert.ok(ts.isIdentifier(errors), 'Monaco error handler binding must be an identifier');
  const errorBinding = binding(errors);
  const offsets = [];
  walk(factory.body, node => {
    if (ts.isBinaryExpression(node) &&
        node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        node.operatorToken.kind <= ts.SyntaxKind.LastAssignment &&
        ts.isIdentifier(node.left)) {
      assert.ok(binding(node.left) !== errorBinding, 'Monaco error handler must not be reassigned');
    }
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
        node.expression.name.text === 'trigger' &&
        ts.isPropertyAccessExpression(node.expression.expression) &&
        node.expression.expression.name.text === 'runDelayer' &&
        node.expression.expression.expression.kind === ts.SyntaxKind.ThisKeyword) {
      assert.ok(node.arguments.length === 1 && ts.isArrowFunction(node.arguments[0]),
        'Unexpected Monaco delayed task');
      assert.ok(!(ts.isPropertyAccessExpression(node.parent) && node.parent.name.text === 'catch'),
        'Monaco delayed tasks have already been patched');
      assert.ok(checker.resolveName(errors.text, node, ts.SymbolFlags.Value, false) === errorBinding,
        'Monaco delayed task error handler binding is shadowed');
      offsets.push(node.end);
    }
  });
  assert.equal(offsets.length, 2, 'Expected exactly two Monaco word-highlighter delayed tasks');
  // Preserve published bytes outside the two AST-identified Promise call sites.
  let patched = text;
  for (const offset of offsets.sort((a, b) => b - a)) {
    patched = `${patched.slice(0, offset)}.catch(${errors.text}.onUnexpectedError)${patched.slice(offset)}`;
  }
  assert.equal(ts.createSourceFile('patched.js', patched, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
    .parseDiagnostics.length, 0, 'Invalid patched Monaco runtime JavaScript');
  const data = Buffer.from(patched);
  return {
    data,
    evidence: { id: monacoWordHighlighterPatch, module: moduleName, callSites: offsets.length,
      inputSha256: hash(input), outputSha256: hash(data) },
  };
}
