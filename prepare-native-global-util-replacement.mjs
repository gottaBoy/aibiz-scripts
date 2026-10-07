#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { loadMigrationContract } from './harness-modeling-core-audit.mjs';
import { fingerprint, readTree } from './native-candidate-files.mjs';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = 'modelingweb/local-plugins/global-util';
const original = '@ibiz-template-plugin/global-util-design@0.0.3-alpha.87';
const replacement = '@aibiz/global-util@0.1.0';
const inputNames = ['build.mjs', 'package.json', 'src/index.ts'];
const outputNames = ['index.mjs', 'index.system.js'];
const compilerChecks = 'TypeScript strict isolated-plugin typecheck; no full application typecheck';
const expectedManifest = {
  name: '@aibiz/global-util', version: '0.1.0', private: true,
  description: 'Independent local global modeling utilities for iBiz runtime',
  type: 'module', main: 'dist/index.mjs', module: 'dist/index.mjs', system: 'dist/index.system.js',
  exports: { '.': './dist/index.mjs' },
  files: ['src', 'dist', 'build.mjs', 'README.md'],
  scripts: {
    build: 'node build.mjs',
    test: 'node --test ../../../scripts/tests/local-global-util.test.mjs',
  },
  peerDependencies: { '@ibiz-template/runtime': '0.7.41-alpha.86', vue: '^3.3.8' },
  devDependencies: { rollup: '4.9.3', typescript: '5.3.3' },
};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
let typescript;

function inspectModules(files) {
  typescript ??= createRequire(join(workspaceRoot, 'modelingweb/app/package.json'))('typescript');
  const ts = typescript;
  assert.equal(ts.version, '5.3.3', 'Global utility inspection requires TypeScript 5.3.3');
  const asts = outputNames.map(path => {
    const ast = ts.createSourceFile(path, files.get(`dist/${path}`).data.toString('utf8'),
      ts.ScriptTarget.ES2020, true, ts.ScriptKind.JS);
    assert.equal(ast.parseDiagnostics.length, 0, `Invalid global utility JavaScript: ${path}`);
    const visit = node => {
      assert.ok(!(ts.isImportDeclaration(node) ||
        (ts.isExportDeclaration(node) && node.moduleSpecifier)),
      'Global utilities must have no external imports');
      if (ts.isCallExpression(node)) {
        assert.ok(node.expression.kind !== ts.SyntaxKind.ImportKeyword &&
          !(ts.isIdentifier(node.expression) && node.expression.text === 'require') &&
          !(ts.isPropertyAccessExpression(node.expression) &&
            ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'System' &&
            node.expression.name.text === 'import'),
        'Dynamic external loading rejected');
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
    return ast;
  });
  const [esm, system] = asts;
  assert.ok(esm.statements.some(node =>
    (ts.isExportAssignment(node) && !node.isExportEquals) ||
    (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause) &&
      node.exportClause.elements.some(item => item.name.text === 'default'))),
  'Global utility ESM default plugin export is missing');
  const isRegister = node => ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'System' &&
    node.expression.name.text === 'register';
  assert.equal(system.statements.length, 1, 'Expected one System.register statement');
  const statement = system.statements[0];
  assert.ok(ts.isExpressionStatement(statement) && isRegister(statement.expression),
    'Output is not a System.register bundle');
  const call = statement.expression;
  assert.equal(call.arguments.length, 2, 'Expected anonymous System.register registration');
  assert.ok(ts.isArrayLiteralExpression(call.arguments[0]) && call.arguments[0].elements.length === 0,
    'Global utility SystemJS dependencies must be empty');
  let declaration = call.arguments[1];
  while (ts.isParenthesizedExpression(declaration)) declaration = declaration.expression;
  assert.ok(ts.isFunctionExpression(declaration) || ts.isArrowFunction(declaration),
    'SystemJS declaration must be a function');
  assert.ok(declaration.parameters.length && ts.isIdentifier(declaration.parameters[0].name),
    'SystemJS export parameter is missing');
  const exportName = declaration.parameters[0].name.text;
  let registrations = 0;
  let defaultExport = false;
  const visit = node => {
    if (isRegister(node)) registrations += 1;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) &&
      node.expression.text === exportName && node.arguments.length === 2 &&
      ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === 'default') defaultExport = true;
    ts.forEachChild(node, visit);
  };
  visit(system);
  assert.equal(registrations, 1, 'Unexpected nested System.register registration');
  assert.ok(defaultExport, 'Global utility SystemJS default plugin export is missing');
}

function subset(contents) {
  const entries = contents.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 }));
  return { contents, entries, ...fingerprint(entries) };
}

export function readGlobalUtilReplacement({ workspace = workspaceRoot, contract } = {}) {
  assert.equal(contract?.schemaVersion, 1, 'Expected native migration contract schema 1');
  assert.equal(contract.contract, 'ibizmodeling-core-migration', 'Expected native migration contract');
  assert.equal(contract.migrationMappings?.filter(mapping => mapping.from === original).length, 1,
    'Original global utility mapping must exist exactly once');
  assert.ok(contract.plugins?.some(plugin => plugin.repo === original),
    'Original global utility identity must exist in the native plugin contract');
  const root = join(resolve(workspace), sourcePath);
  const tree = readTree(root, { jsonOnly: false });
  assert.deepEqual(tree.entries.map(file => file.path),
    ['README.md', ...inputNames, ...outputNames.map(path => `dist/${path}`),
      'dist/build-receipt.json'].sort((a, b) => a.localeCompare(b)),
  'Unexpected global utility source/build file set');
  const files = new Map(tree.contents.map(file => [file.path, file]));
  const manifest = JSON.parse(files.get('package.json').data);
  assert.deepEqual(manifest, expectedManifest, 'Exact independent global utility manifest differs');
  const receiptFile = files.get('dist/build-receipt.json');
  const receipt = JSON.parse(receiptFile.data);
  assert.deepEqual(Object.keys(receipt).sort(), [
    'schemaVersion', 'package', 'sourceStatus', 'originalSourceRecovered',
    'nativeCompatibilityVerified', 'compilerChecks', 'toolchain', 'inputs', 'runtimeImports', 'outputs',
  ].sort(), 'Unexpected global utility receipt fields');
  assert.equal(receipt.schemaVersion, 1, 'Unsupported global utility receipt schema');
  assert.deepEqual(receipt.package, { name: manifest.name, version: manifest.version },
    'Global utility receipt identity differs');
  assert.equal(receipt.sourceStatus, 'independent-local-implementation',
    'Independent source status required');
  assert.equal(receipt.originalSourceRecovered, false, 'Original source recovery cannot be claimed');
  assert.equal(receipt.nativeCompatibilityVerified, false, 'Native compatibility cannot be claimed');
  assert.equal(receipt.compilerChecks, compilerChecks, 'Compiler verification scope differs');
  assert.deepEqual(Object.keys(receipt.toolchain ?? {}).sort(), ['rollup', 'typescript'],
    'Unexpected global utility toolchain');
  for (const [name, version] of Object.entries(manifest.devDependencies)) {
    assert.deepEqual(Object.keys(receipt.toolchain[name] ?? {}).sort(), ['sha256', 'version'],
      `Invalid global utility toolchain record: ${name}`);
    assert.equal(receipt.toolchain[name].version, version, `Toolchain version differs: ${name}`);
    assert.match(receipt.toolchain[name].sha256, /^[a-f0-9]{64}$/, `Invalid toolchain hash: ${name}`);
  }
  assert.deepEqual(receipt.inputs, inputNames.map(path => ({ path, sha256: files.get(path).sha256 })),
    'Global utility source input hashes or complete file set differ');
  assert.deepEqual(receipt.outputs, outputNames.map(path => ({
    path, sha256: files.get(`dist/${path}`).sha256,
  })), 'Global utility build output hashes or complete file set differ');
  assert.deepEqual(receipt.runtimeImports, [], 'Global utility runtime imports must be empty');
  inspectModules(files);
  const source = subset(tree.contents.filter(file => inputNames.includes(file.path)));
  const built = subset(outputNames.map(path => {
    const file = files.get(`dist/${path}`);
    return { ...file, path };
  }));
  const delivery = subset(tree.contents.filter(file =>
    file.path === 'package.json' || outputNames.some(path => file.path === `dist/${path}`)));
  assert.deepEqual(readTree(root, { jsonOnly: false }).entries, tree.entries,
    'Global utility source/build changed during verification');
  return {
    files: delivery,
    plugin: {
      schemaVersion: 1, contract: 'native-global-util-independent-replacement',
      from: original, to: replacement, sourcePath,
      sourceStatus: 'independent-local-implementation',
      sourceFingerprint: source.fingerprint, sourceInputs: source.entries,
      buildOutputFingerprint: built.fingerprint, buildOutputs: built.entries,
      outputFingerprint: delivery.fingerprint,
      buildCommand: `node ${sourcePath}/build.mjs`,
      buildReceipt: {
        path: `${sourcePath}/dist/build-receipt.json`, sha256: hash(receiptFile.data),
        compilerChecks, recordedToolchain: receipt.toolchain,
      },
      runtimeImports: [], peerDependencies: manifest.peerDependencies,
      verificationScope: 'local-source-and-build-artifact-integrity-only',
      originalMigrationAcceptance: 'not-satisfied-by-independent-replacement',
      originalSourceRecovered: false, originalRepositoryAuthenticated: false,
      nativeCompatibilityVerified: false, compatibility: 'not-verified', acceptedForProduction: false,
    },
  };
}

export function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: {
    workspace: { type: 'string' }, help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) {
    console.log('Usage: node scripts/prepare-native-global-util-replacement.mjs [--workspace PATH]');
    console.log('Read-only independent implementation integrity check; native acceptance remains unfinished.');
    return 0;
  }
  const workspace = resolve(values.workspace || workspaceRoot);
  const { plugin, files } = readGlobalUtilReplacement({
    workspace, contract: loadMigrationContract(workspace),
  });
  console.log(JSON.stringify({ plugin, files: { entries: files.entries, ...fingerprint(files.entries) } }, null, 2));
  return 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
