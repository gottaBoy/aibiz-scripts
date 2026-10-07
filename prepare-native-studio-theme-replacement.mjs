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
const sourcePath = 'modelingweb/local-plugins/studio-theme';
const inputNames = ['build.mjs', 'package.json', 'src/color.css', 'src/icon.css', 'src/index.ts'];
const deliveryNames = ['index.mjs', 'index.system.js', 'package.json', 'style.css'];
const versions = { rollup: '4.9.3', typescript: '5.3.3' };
const peers = { '@ibiz-template/runtime': '0.7.41-alpha.86', vue: '^3.3.8' };
const compilerChecks = 'TypeScript strict isolated-plugin typecheck; no full application typecheck';
export const studioThemeMappings = Object.freeze([
  Object.freeze({
    variant: 'color', from: '@ibiz-template-theme/studio-theme@0.0.3-alpha.92',
    to: '@aibiz/studio-theme@0.1.0', tag: 'studio_dark',
  }),
  Object.freeze({
    variant: 'icon', from: '@ibiz-template-theme/studio-icon@0.0.3-alpha.68',
    to: '@aibiz/studio-icon@0.1.0', tag: 'studio_icon',
  }),
]);
const hash = data => createHash('sha256').update(data).digest('hex');
const sorted = values => [...values].sort((a, b) => a.path.localeCompare(b.path));
const require = createRequire(join(workspaceRoot, 'modelingweb/app/package.json'));

function inspectModules(contents) {
  const ts = require('typescript');
  assert.equal(ts.version, versions.typescript, 'Theme inspection requires the pinned TypeScript');
  for (const name of ['index.mjs', 'index.system.js']) {
    const source = contents.find(file => file.path === name).data.toString('utf8');
    const ast = ts.createSourceFile(name, source, ts.ScriptTarget.ES2020, true, ts.ScriptKind.JS);
    assert.equal(ast.parseDiagnostics.length, 0, 'Theme JavaScript is invalid');
    const visit = node => {
      assert.ok(!(ts.isImportDeclaration(node) ||
        (ts.isExportDeclaration(node) && node.moduleSpecifier)),
      'Theme modules must have no external imports');
      if (ts.isCallExpression(node)) {
        assert.ok(node.expression.kind !== ts.SyntaxKind.ImportKeyword &&
          !(ts.isIdentifier(node.expression) && node.expression.text === 'require') &&
          !(ts.isPropertyAccessExpression(node.expression) &&
            ts.isIdentifier(node.expression.expression) && node.expression.expression.text === 'System' &&
            node.expression.name.text === 'import'), 'Dynamic theme loading rejected');
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
    if (name === 'index.mjs') {
      assert.ok(ast.statements.some(node =>
        (ts.isExportAssignment(node) && !node.isExportEquals) ||
        (ts.isExportDeclaration(node) && node.exportClause && ts.isNamedExports(node.exportClause) &&
          node.exportClause.elements.some(item => item.name.text === 'default'))),
      'Theme ESM default plugin export is missing');
    } else {
      assert.equal(ast.statements.length, 1, 'Expected one theme System.register statement');
      const call = ast.statements[0].expression;
      assert.ok(ts.isCallExpression(call) && ts.isPropertyAccessExpression(call.expression) &&
        ts.isIdentifier(call.expression.expression) && call.expression.expression.text === 'System' &&
        call.expression.name.text === 'register' && call.arguments.length === 2 &&
        ts.isArrayLiteralExpression(call.arguments[0]) && call.arguments[0].elements.length === 0,
      'Theme must be an anonymous dependency-free System.register bundle');
      let declaration = call.arguments[1];
      while (ts.isParenthesizedExpression(declaration)) declaration = declaration.expression;
      assert.ok((ts.isFunctionExpression(declaration) || ts.isArrowFunction(declaration)) &&
        declaration.parameters.length && ts.isIdentifier(declaration.parameters[0].name),
      'Theme SystemJS declaration must export a plugin');
      const exportName = declaration.parameters[0].name.text;
      let defaultExport = false;
      const inspect = node => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) &&
            node.expression.text === exportName && node.arguments.length === 2 &&
            ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === 'default') defaultExport = true;
        ts.forEachChild(node, inspect);
      };
      inspect(declaration);
      assert.ok(defaultExport, 'Theme SystemJS default plugin export is missing');
    }
  }
}

function subset(contents) {
  const entries = contents.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 }));
  return { contents, entries, ...fingerprint(entries) };
}

export function readStudioThemeReplacements({ workspace = workspaceRoot, contract } = {}) {
  assert.equal(contract?.schemaVersion, 1, 'Expected native migration contract schema 1');
  assert.equal(contract.contract, 'ibizmodeling-core-migration', 'Expected native migration contract');
  const root = join(resolve(workspace), sourcePath);
  const tree = readTree(root, { jsonOnly: false });
  const outputNames = studioThemeMappings.flatMap(({ variant }) =>
    deliveryNames.map(name => `${variant}/${name}`));
  assert.deepEqual(tree.entries.map(file => file.path), [
    'README.md', ...inputNames, 'dist/build-receipt.json',
    ...outputNames.map(name => `dist/${name}`),
  ].sort((a, b) => a.localeCompare(b)), 'Unexpected theme source/build file set');
  const files = new Map(tree.contents.map(file => [file.path, file]));
  const manifest = JSON.parse(files.get('package.json').data);
  assert.equal(manifest.name, '@aibiz/studio-theme-bundle');
  assert.equal(manifest.version, '0.1.0');
  assert.equal(manifest.private, true);
  assert.equal(manifest.type, 'module');
  assert.deepEqual(manifest.devDependencies, versions, 'Theme toolchain dependencies differ');
  assert.deepEqual(manifest.peerDependencies, peers, 'Theme host versions differ');
  const receiptFile = files.get('dist/build-receipt.json');
  const receipt = JSON.parse(receiptFile.data);
  assert.deepEqual(Object.keys(receipt).sort(), [
    'schemaVersion', 'package', 'sourceStatus', 'originalSourceRecovered',
    'nativeCompatibilityVerified', 'compilerChecks', 'toolchain', 'inputs', 'runtimeImports', 'outputs',
  ].sort(), 'Unexpected theme build receipt fields');
  assert.equal(receipt.schemaVersion, 1, 'Unsupported theme build receipt');
  assert.deepEqual(receipt.package, { name: manifest.name, version: manifest.version });
  assert.equal(receipt.sourceStatus, 'independent-local-implementation');
  assert.equal(receipt.originalSourceRecovered, false, 'Original theme source recovery cannot be claimed');
  assert.equal(receipt.nativeCompatibilityVerified, false, 'Native theme compatibility cannot be claimed');
  assert.equal(receipt.compilerChecks, compilerChecks, 'Theme compiler verification scope differs');
  assert.deepEqual(receipt.runtimeImports, [], 'Theme runtime imports must be empty');
  assert.deepEqual(sorted(receipt.inputs), inputNames.map(path => ({ path, sha256: files.get(path).sha256 })),
    'Theme source input hashes or complete file set differ');
  assert.deepEqual(sorted(receipt.outputs), outputNames.sort((a, b) => a.localeCompare(b))
    .map(path => ({ path, sha256: files.get(`dist/${path}`).sha256 })),
  'Theme build output hashes or complete file set differ');
  assert.deepEqual(Object.keys(receipt.toolchain ?? {}).sort(), Object.keys(versions).sort());
  for (const [name, version] of Object.entries(versions)) {
    assert.deepEqual(Object.keys(receipt.toolchain[name] ?? {}).sort(), ['sha256', 'version'],
      `Invalid theme toolchain record: ${name}`);
    assert.equal(receipt.toolchain[name]?.version, version);
    assert.match(receipt.toolchain[name]?.sha256 ?? '', /^[a-f0-9]{64}$/, `Invalid ${name} toolchain hash`);
  }
  const source = subset(tree.contents.filter(file => inputNames.includes(file.path)));
  const postcss = require('postcss');
  const replacements = studioThemeMappings.map(mapping => {
    const prefix = `dist/${mapping.variant}/`;
    const delivery = subset(tree.contents.filter(file => file.path.startsWith(prefix))
      .map(file => ({ ...file, path: file.path.slice(prefix.length) })));
    const targetManifest = JSON.parse(delivery.contents.find(file => file.path === 'package.json').data);
    assert.equal(`${targetManifest.name}@${targetManifest.version}`, mapping.to, 'Theme delivery identity differs');
    assert.equal(targetManifest.main, 'index.mjs');
    assert.equal(targetManifest.module, 'index.mjs');
    assert.equal(targetManifest.system, 'index.system.js');
    assert.deepEqual(targetManifest.styles, ['style.css']);
    assert.equal(targetManifest.private, true);
    assert.equal(targetManifest.type, 'module');
    assert.deepEqual(targetManifest.dependencies ?? {}, {}, 'Theme runtime dependencies must be empty');
    assert.deepEqual(targetManifest.peerDependencies, peers, 'Theme delivery host versions differ');
    assert.equal(Object.hasOwn(targetManifest, 'gitHead'), false, 'Independent theme cannot claim upstream identity');
    inspectModules(delivery.contents);
    const cssBytes = delivery.contents.find(file => file.path === 'style.css').data;
    assert.deepEqual(cssBytes, files.get(`src/${mapping.variant}.css`).data,
      'Theme CSS delivery must preserve its editable source');
    const css = postcss.parse(cssBytes.toString('utf8'));
    let rules = 0;
    css.walkAtRules(rule => {
      const name = rule.name.toLowerCase();
      assert.notEqual(name, 'import', 'Remote theme styles rejected');
      assert.ok(['media', 'supports', 'container'].includes(name) && Array.isArray(rule.nodes),
        'Global theme at-rules rejected');
    });
    css.walkRules(rule => {
      rules += 1;
      assert.ok(rule.selector.split(',').every(selector =>
        new RegExp(`^:root\\.${mapping.tag}(?=$|[\\s.#:[>+~])`).test(selector.trim())),
      'Theme CSS must stay scoped to its native tag');
    });
    css.walkDecls(declaration => {
      assert.equal(declaration.parent.type, 'rule',
        'Theme CSS declarations must belong to tag-scoped rules');
      assert.ok(!/url\s*\(/i.test(declaration.value), 'External theme assets rejected');
    });
    assert.ok(rules > 0, 'Theme CSS cannot be empty');
    const built = subset(delivery.contents.filter(file => file.path !== 'package.json'));
    return {
      files: delivery,
      plugin: {
        schemaVersion: 1, contract: 'native-studio-theme-independent-replacement',
        from: mapping.from, to: mapping.to, themeTag: mapping.tag, variant: mapping.variant,
        sourcePath, sourceStatus: 'independent-local-implementation',
        sourceFingerprint: source.fingerprint, sourceInputs: source.entries,
        buildOutputFingerprint: built.fingerprint, buildOutputs: built.entries,
        outputFingerprint: delivery.fingerprint, buildCommand: `node ${sourcePath}/build.mjs`,
        buildReceipt: {
          path: `${sourcePath}/dist/build-receipt.json`, sha256: hash(receiptFile.data),
          compilerChecks: receipt.compilerChecks, recordedToolchain: receipt.toolchain,
        },
        runtimeImports: [], peerDependencies: targetManifest.peerDependencies ?? {},
        verificationScope: 'local-source-and-build-artifact-integrity-only',
        originalMigrationAcceptance: 'not-satisfied-by-independent-replacement',
        originalSourceRecovered: false, originalRepositoryAuthenticated: false,
        nativeCompatibilityVerified: false, compatibility: 'not-verified', acceptedForProduction: false,
      },
    };
  });
  assert.deepEqual(readTree(root, { jsonOnly: false }).entries, tree.entries,
    'Theme source/build changed during verification');
  return replacements;
}

export function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: {
    workspace: { type: 'string' }, help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) {
    console.log('Usage: node scripts/prepare-native-studio-theme-replacement.mjs [--workspace PATH]');
    console.log('Read-only independent theme verification; original source and native acceptance remain unfinished.');
    return 0;
  }
  const workspace = resolve(values.workspace || workspaceRoot);
  const replacements = readStudioThemeReplacements({ workspace, contract: loadMigrationContract(workspace) });
  console.log(JSON.stringify(replacements.map(({ plugin }) => plugin), null, 2));
  return 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
