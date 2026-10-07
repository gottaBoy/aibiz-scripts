#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { fingerprint, PinnedDirectories, readPinnedFile } from './native-candidate-files.mjs';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = 'modelingweb/local-plugins/file-to-base64';
const original = '@ibiz-template-plugin/file-to-base64@0.1.8-alpha.165';
const replacement = '@aibiz/file-to-base64@0.1.0';
const runtimeImports = ['@ibiz-template/runtime', '@ibiz-template/vue3-util', 'vue'];
const inputNames = [
  'build.mjs', 'package.json', 'src/controller.ts', 'src/editor.ts',
  'src/file-logic.ts', 'src/index.ts', 'src/provider.ts', 'src/style.css',
];
const outputNames = ['index.mjs', 'index.system.js', 'file-logic.mjs', 'style.css'];
const compilerChecks = 'TypeScript syntax diagnostics; no full application typecheck';
const expectedManifest = {
  name: '@aibiz/file-to-base64',
  version: '0.1.0',
  private: true,
  description: 'Independent local single-file base64 editor for iBiz runtime',
  type: 'module',
  main: 'dist/index.mjs',
  module: 'dist/index.mjs',
  system: 'dist/index.system.js',
  styles: ['dist/style.css'],
  exports: { '.': './dist/index.mjs', './file-logic': './dist/file-logic.mjs' },
  files: ['src', 'dist', 'build.mjs', 'README.md'],
  scripts: {
    build: 'node build.mjs',
    test: 'node --test ../../../scripts/tests/local-file-to-base64.test.mjs',
  },
  peerDependencies: {
    '@ibiz-template/runtime': '0.7.41-alpha.86',
    '@ibiz-template/vue3-util': '0.7.41-alpha.86',
    '@ibiz/model-core': '^0.1.84',
    vue: '^3.3.8',
  },
  devDependencies: { rollup: '4.9.3', typescript: '5.3.3' },
};
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
let typescript;

function parser() {
  typescript ??= createRequire(join(workspaceRoot, 'modelingweb/app/package.json'))('typescript');
  assert.equal(typescript.version, '5.3.3', 'Replacement inspection requires local TypeScript 5.3.3');
  return typescript;
}

function parseJavaScript(file) {
  const ts = parser();
  const ast = ts.createSourceFile(file.path, file.data.toString('utf8'),
    ts.ScriptTarget.ES2020, true, ts.ScriptKind.JS);
  assert.equal(ast.parseDiagnostics.length, 0, `Invalid JavaScript output: ${file.path}`);
  return ast;
}

function isSystemCall(ts, node, name) {
  return ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
    ts.isIdentifier(node.expression.expression) &&
    node.expression.expression.text === 'System' && node.expression.name.text === name;
}

function moduleImports(ast) {
  const ts = parser();
  const imports = [];
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      assert.ok(ts.isStringLiteral(node.moduleSpecifier), 'Nonliteral external import rejected');
      imports.push(node.moduleSpecifier.text);
    }
    if (ts.isCallExpression(node)) {
      assert.ok(node.expression.kind !== ts.SyntaxKind.ImportKeyword &&
        !(ts.isIdentifier(node.expression) && node.expression.text === 'require') &&
        !isSystemCall(ts, node, 'import'), 'Dynamic external loading rejected');
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  return imports.sort();
}

function checkOutputs(outputs) {
  const ts = parser();
  const files = new Map(outputs.contents.map(file => [file.path, file]));
  const esm = parseJavaScript(files.get('index.mjs'));
  assert.deepEqual(moduleImports(esm), runtimeImports, 'ESM external import identity differs');
  assert.ok(esm.statements.some(node =>
    (ts.isExportAssignment(node) && !node.isExportEquals) ||
    (ts.isExportDeclaration(node) && node.exportClause &&
      ts.isNamedExports(node.exportClause) &&
      node.exportClause.elements.some(item => item.name.text === 'default'))),
  'ESM default plugin export is missing');
  assert.deepEqual(moduleImports(parseJavaScript(files.get('file-logic.mjs'))), [],
    'Pure file logic must have no external imports');

  const system = parseJavaScript(files.get('index.system.js'));
  assert.deepEqual(moduleImports(system), [], 'SystemJS bundle contains ESM imports');
  assert.equal(system.statements.length, 1, 'Expected one System.register statement');
  const statement = system.statements[0];
  assert.ok(ts.isExpressionStatement(statement) &&
    isSystemCall(ts, statement.expression, 'register'), 'Output is not a System.register bundle');
  const call = statement.expression;
  assert.equal(call.arguments.length, 2, 'Expected anonymous System.register registration');
  assert.ok(ts.isArrayLiteralExpression(call.arguments[0]), 'SystemJS dependencies must be literal');
  const dependencies = call.arguments[0].elements.map(node => {
    assert.ok(ts.isStringLiteral(node), 'SystemJS external dependency must be literal');
    return node.text;
  });
  assert.deepEqual(dependencies.sort(), runtimeImports, 'SystemJS external import identity differs');
  let declaration = call.arguments[1];
  while (ts.isParenthesizedExpression(declaration)) declaration = declaration.expression;
  assert.ok(ts.isFunctionExpression(declaration) || ts.isArrowFunction(declaration),
    'SystemJS declaration must be a function');
  assert.ok(declaration.parameters.length && ts.isIdentifier(declaration.parameters[0].name),
    'SystemJS export parameter is missing');
  const exportName = declaration.parameters[0].name.text;
  let registrations = 0;
  let defaultExport = false;
  function visit(node) {
    if (isSystemCall(ts, node, 'register')) registrations += 1;
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) &&
      node.expression.text === exportName && node.arguments.length === 2 &&
      ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === 'default') {
      defaultExport = true;
    }
    ts.forEachChild(node, visit);
  }
  visit(system);
  assert.equal(registrations, 1, 'Unexpected nested System.register registration');
  assert.ok(defaultExport, 'SystemJS default plugin export is missing');
}

function fileAt(directories, root, path) {
  const target = join(root, path);
  const directory = directories.open(dirname(target));
  const { data, identity } = readPinnedFile(directories, directory, basename(target));
  assert.ok(data.length, `Empty replacement file: ${path}`);
  return { path, bytes: data.length, sha256: hash(data), data, identity };
}

function fileSet(contents) {
  contents = contents.map(({ identity, ...file }) => file)
    .sort((a, b) => a.path.localeCompare(b.path));
  const entries = contents.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 }));
  return { contents, entries, ...fingerprint(entries) };
}

function inventory(directories, root) {
  for (const [path, names] of [
    ['', ['README.md', 'build.mjs', 'package.json', 'src', 'dist']],
    ['src', inputNames.filter(name => name.startsWith('src/')).map(name => name.slice(4))],
    ['dist', [...outputNames, 'build-receipt.json']],
  ]) {
    const directory = directories.open(join(root, path));
    directories.verify(directory);
    assert.deepEqual(readdirSync(directory.access).sort(), [...names].sort(),
      `Unexpected replacement file set: ${path || 'root'}`);
  }
}

function checkContract(contract) {
  assert.equal(contract?.schemaVersion, 1, 'Expected native migration contract schema 1');
  assert.equal(contract.contract, 'ibizmodeling-core-migration', 'Expected native migration contract');
  assert.ok(Array.isArray(contract.migrationMappings) &&
    contract.migrationMappings.filter(mapping => mapping?.from === original).length === 1,
  'Original file-to-base64 mapping must exist exactly once in the native contract');
  assert.ok(Array.isArray(contract.plugins) &&
    contract.plugins.some(plugin => plugin?.repo === original),
  'Original file-to-base64 identity must exist in the native plugin contract');
}

export function readFileBase64Replacement({ workspace = workspaceRoot, contract } = {}) {
  checkContract(contract);
  workspace = resolve(workspace);
  const root = join(workspace, sourcePath);
  const directories = new PinnedDirectories();
  try {
    inventory(directories, root);
    const inputs = inputNames.map(path => fileAt(directories, root, path));
    const outputs = outputNames.map(path => fileAt(directories, join(root, 'dist'), path));
    const receiptFile = fileAt(directories, root, 'dist/build-receipt.json');
    // README is documentation, not a compiler input or a deployment file.
    const documentation = fileAt(directories, root, 'README.md');
    const manifestFile = inputs.find(file => file.path === 'package.json');
    const manifest = JSON.parse(manifestFile.data.toString('utf8'));
    assert.ok(!Object.hasOwn(manifest, 'gitHead'), 'Independent manifest cannot contain gitHead');
    assert.deepEqual(manifest, expectedManifest, 'Exact independent replacement manifest differs');
    const receipt = JSON.parse(receiptFile.data.toString('utf8'));
    assert.deepEqual(Object.keys(receipt).sort(), [
      'schemaVersion', 'package', 'sourceStatus', 'originalSourceRecovered',
      'nativeCompatibilityVerified', 'compilerChecks', 'toolchain', 'inputs', 'runtimeImports', 'outputs',
    ].sort(), 'Unexpected replacement receipt fields');
    assert.equal(receipt.schemaVersion, 1, 'Unsupported replacement receipt schema');
    assert.deepEqual(receipt.package, { name: manifest.name, version: manifest.version },
      'Replacement receipt package identity differs');
    assert.equal(receipt.sourceStatus, 'independent-local-implementation', 'Independent source status required');
    assert.equal(receipt.originalSourceRecovered, false, 'Original source recovery cannot be claimed');
    assert.equal(receipt.nativeCompatibilityVerified, false, 'Native compatibility cannot be claimed');
    assert.equal(receipt.compilerChecks, compilerChecks, 'Compiler verification scope differs');
    assert.deepEqual(Object.keys(receipt.toolchain ?? {}).sort(), ['rollup', 'typescript'],
      'Unexpected recorded toolchain');
    for (const [name, version] of Object.entries(manifest.devDependencies)) {
      assert.deepEqual(Object.keys(receipt.toolchain[name] ?? {}).sort(), ['sha256', 'version'],
        `Invalid recorded toolchain: ${name}`);
      assert.equal(receipt.toolchain[name].version, version, `Recorded toolchain version differs: ${name}`);
      assert.match(receipt.toolchain[name].sha256, /^[a-f0-9]{64}$/, `Invalid toolchain hash: ${name}`);
    }
    assert.deepEqual(receipt.inputs, inputs.map(({ path, sha256 }) => ({ path, sha256 })),
      'Replacement source input hashes or complete file set differ');
    assert.deepEqual(receipt.outputs, outputs.map(({ path, sha256 }) => ({ path, sha256 })),
      'Replacement build output hashes or complete file set differ');
    assert.deepEqual(receipt.runtimeImports, runtimeImports, 'Recorded external import identity differs');
    assert.deepEqual(outputs.find(file => file.path === 'style.css').data,
      inputs.find(file => file.path === 'src/style.css').data, 'Built styles differ from source');
    const source = fileSet(inputs);
    const built = fileSet(outputs);
    checkOutputs(built);
    const files = fileSet([
      manifestFile, ...outputs.map(file => ({ ...file, path: `dist/${file.path}` })),
    ]);
    inventory(directories, root);
    for (const file of [...inputs, receiptFile, documentation,
      ...outputs.map(item => ({ ...item, path: `dist/${item.path}` }))]) {
      const target = join(root, file.path);
      assert.deepEqual(readPinnedFile(directories, directories.open(dirname(target)),
        basename(target), file.identity).data, file.data,
      `Replacement changed during verification: ${file.path}`);
    }
    inventory(directories, root);
    // This vocabulary is separate from same-package core migration acceptance.
    return {
      files,
      plugin: {
        schemaVersion: 1, contract: 'native-file-base64-independent-replacement',
        from: original, to: replacement,
        sourcePath, sourceStatus: 'independent-local-implementation',
        sourceFingerprint: source.fingerprint,
        sourceInputs: source.entries,
        buildOutputFingerprint: built.fingerprint,
        buildOutputs: built.entries,
        outputFingerprint: files.fingerprint,
        buildCommand: `node ${sourcePath}/build.mjs`,
        buildReceipt: {
          path: `${sourcePath}/dist/build-receipt.json`, sha256: receiptFile.sha256,
          compilerChecks, recordedToolchain: receipt.toolchain,
        },
        runtimeImports: [...runtimeImports],
        peerDependencies: manifest.peerDependencies,
        verificationScope: 'local-source-and-build-artifact-integrity-only',
        originalMigrationAcceptance: 'not-satisfied-by-independent-replacement',
        originalSourceRecovered: false, originalRepositoryAuthenticated: false,
        nativeCompatibilityVerified: false,
        compatibility: 'not-verified', acceptedForProduction: false,
      },
    };
  } finally { directories.close(); }
}

export function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: {
    workspace: { type: 'string' }, help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) {
    console.log('Usage: node scripts/prepare-native-file-base64-replacement.mjs [--workspace PATH]');
    console.log('Read-only independent replacement integrity check; no deployment or native acceptance.');
    console.log('Exit 2 means local integrity passed but compatibility and production acceptance are unverified.');
    return 0;
  }
  const workspace = resolve(values.workspace || workspaceRoot);
  const directories = new PinnedDirectories();
  let contract;
  try {
    const path = join(workspace, 'scripts/fixtures/modeling-core-migration-contract.json');
    contract = JSON.parse(readPinnedFile(directories, directories.open(dirname(path)),
      'modeling-core-migration-contract.json').data.toString('utf8'));
  } finally { directories.close(); }
  const { files, plugin } = readFileBase64Replacement({ workspace, contract });
  console.log(JSON.stringify({ plugin, files: { entries: files.entries, ...fingerprint(files.entries) } }, null, 2));
  return 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
