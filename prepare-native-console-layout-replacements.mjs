#!/usr/bin/env node

import assert from 'node:assert/strict';
import { lstatSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { buildLocalConsoleLayout, loadToolchain } from '../modelingweb/local-plugins/console-layout/build.mjs';
import { loadMigrationContract } from './harness-modeling-core-audit.mjs';
import { fingerprint, readTree } from './native-candidate-files.mjs';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = 'modelingweb/local-plugins/console-layout';
export const consoleTerminalSelection = Object.freeze({
  from: '@ibiz-template-plugin/console-terminal@0.0.3-alpha.87',
  to: '@aibiz/console-terminal@0.1.0', pluginType: 'VIEW_CUSTOM', pluginCode: 'CONSOLE_VIEW',
});
export const swaggerPreviewSelection = Object.freeze({
  from: '@ibiz-template-plugin/layout-design@0.0.3-alpha.90',
  to: '@aibiz/swagger-preview@0.1.0', pluginType: 'VIEW_CUSTOM', pluginCode: 'SWAGGER_PREVIEW_VIEW',
});
const selections = [consoleTerminalSelection, swaggerPreviewSelection];
const variants = ['console', 'swagger'];
const inputNames = [
  'build.mjs', 'package.json', 'src/console.css', 'src/console.ts',
  'src/swagger.css', 'src/swagger.ts', 'src/view.ts',
];
const outputNames = ['index.mjs', 'index.system.js', 'package.json', 'style.css'];
const compilerChecks =
  'TypeScript isolated transpilation and syntax diagnostics; no full host application typecheck';
const peers = { '@ibiz-template/runtime': '*', '@ibiz-template/vue3-util': '*', vue: '^3.3.8' };
const sorted = entries => [...entries].sort((a, b) => a.path.localeCompare(b.path));

function subset(contents) {
  const entries = contents.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 }));
  return { contents, entries, ...fingerprint(entries) };
}

function checkContract(contract) {
  assert.equal(contract?.schemaVersion, 1, 'Expected native migration contract schema 1');
  assert.equal(contract.contract, 'ibizmodeling-core-migration', 'Expected native migration contract');
  for (const selection of selections) {
    assert.equal(contract.migrationMappings?.filter(item => item.from === selection.from).length, 1,
      `Original package mapping must exist exactly once: ${selection.from}`);
    assert.ok(contract.plugins?.some(item => item.repo === selection.from),
      `Original plugin must remain in the native contract: ${selection.from}`);
  }
}

export function readConsoleLayoutReplacements({ workspace = workspaceRoot, contract } = {}) {
  checkContract(contract);
  const root = join(resolve(workspace), sourcePath);
  const tree = readTree(root, { jsonOnly: false });
  const expectedNames = [
    'README.md', 'SOURCE-EVIDENCE.json', ...inputNames, 'dist/build-receipt.json',
    ...variants.flatMap(variant => outputNames.map(name => `dist/${variant}/${name}`)),
  ].sort((a, b) => a.localeCompare(b));
  assert.deepEqual(tree.entries.map(file => file.path), expectedNames, 'Unexpected console/layout file set');
  for (const file of tree.entries) assert.equal(lstatSync(join(root, file.path)).nlink, 1,
    `Hardlinked source/build rejected: ${file.path}`);
  const files = new Map(tree.contents.map(file => [file.path, file]));
  const manifest = JSON.parse(files.get('package.json').data);
  assert.deepEqual(manifest, {
    name: '@aibiz/console-layout-bundle', version: '0.1.0', private: true, type: 'module',
    scripts: { build: 'node build.mjs' }, peerDependencies: peers,
    devDependencies: { rollup: '4.9.3', typescript: '5.3.3' },
  }, 'Expected independent bundle manifest, never an original package identity');
  const evidence = JSON.parse(files.get('SOURCE-EVIDENCE.json').data);
  assert.equal(evidence.schemaVersion, 1);
  assert.equal(evidence.exactOriginalSourcesRecovered, false);
  assert.equal(evidence.sourceStatus, 'independent-local-implementation');
  assert.equal(evidence.originalSourceRecovered, false);
  assert.equal(evidence.nativeCompatibilityVerified, false);
  assert.equal(evidence.acceptedForProduction, false);
  assert.deepEqual(evidence.independentMappings, selections, 'Acquisition evidence must retain exact scoped mappings');
  assert.deepEqual(evidence.originalPackages?.map(item => item.identity), selections.map(item => item.from));
  const receiptFile = files.get('dist/build-receipt.json');
  const receipt = JSON.parse(receiptFile.data);
  assert.deepEqual(Object.keys(receipt).sort(), [
    'schemaVersion', 'package', 'packages', 'sourceStatus', 'originalSourceRecovered',
    'nativeCompatibilityVerified', 'compilerChecks', 'inputs', 'outputs', 'toolchain', 'runtimeImports',
  ].sort(), 'Unexpected build receipt fields');
  assert.equal(receipt.schemaVersion, 1);
  assert.deepEqual(receipt.package, { name: manifest.name, version: manifest.version });
  assert.equal(receipt.sourceStatus, 'independent-local-implementation');
  assert.equal(receipt.originalSourceRecovered, false);
  assert.equal(receipt.nativeCompatibilityVerified, false);
  assert.equal(receipt.compilerChecks, compilerChecks);
  assert.deepEqual(receipt.packages, selections.map((item, index) => ({
    variant: variants[index], name: item.to.split('@').slice(0, -1).join('@'), version: '0.1.0',
    supportedPluginCodes: [item.pluginCode],
  })), 'Variant identities/selectors must not claim the original package or DESIGN_INDEX_VIEW');
  assert.deepEqual(sorted(receipt.inputs), sorted(inputNames.map(path => ({
    path, sha256: files.get(path).sha256,
  }))), 'Current console/layout source input hashes differ');
  assert.deepEqual(sorted(receipt.outputs), sorted(variants.flatMap(variant => outputNames.map(name => ({
    path: `${variant}/${name}`, sha256: files.get(`dist/${variant}/${name}`).sha256,
  })))), 'Current console/layout output hashes differ');
  const tools = loadToolchain(root);
  assert.deepEqual(receipt.toolchain, tools.evidence, 'Current pinned toolchain differs from build receipt');
  assert.deepEqual(receipt.runtimeImports,
    Object.fromEntries(variants.map(variant => [variant, Object.keys(peers).sort()])),
    'Each variant must declare exactly its actual host imports');
  const source = subset(inputNames.map(path => files.get(path)));
  const replacements = selections.map((selection, index) => {
    const variant = variants[index];
    const distribution = JSON.parse(files.get(`dist/${variant}/package.json`).data);
    const { name, version } = receipt.packages[index];
    assert.deepEqual(distribution, {
      name, version, private: true, type: 'module', main: 'index.mjs', module: 'index.mjs',
      system: 'index.system.js', styles: ['style.css'], peerDependencies: peers,
    }, 'Variant delivery manifest differs from independent identity');
    assert.ok(files.get(`dist/${variant}/style.css`).data.equals(files.get(`src/${variant}.css`).data),
      'Styles must match editable source bytes');
    const esm = tools.ts.createSourceFile('index.mjs',
      files.get(`dist/${variant}/index.mjs`).data.toString('utf8'), tools.ts.ScriptTarget.ES2020, true);
    assert.equal(esm.parseDiagnostics.length, 0, 'Invalid built ESM syntax');
    const imports = esm.statements.filter(item => tools.ts.isImportDeclaration(item))
      .map(item => item.moduleSpecifier.text).sort();
    assert.deepEqual(imports, receipt.runtimeImports[variant], 'Actual ESM host imports differ');
    const delivery = subset(outputNames.map(path => ({ ...files.get(`dist/${variant}/${path}`), path })));
    return {
      files: delivery,
      plugin: {
        schemaVersion: 1, contract: 'native-console-layout-independent-replacement',
        ...selection, supportedPluginCodes: [selection.pluginCode], partialReplacement: true,
        sourcePath, sourceStatus: 'independent-local-implementation',
        sourceFingerprint: source.fingerprint, sourceInputs: source.entries,
        buildOutputFingerprint: delivery.fingerprint, buildOutputs: delivery.entries,
        outputFingerprint: delivery.fingerprint, buildCommand: `node ${sourcePath}/build.mjs`,
        buildReceipt: {
          path: `${sourcePath}/dist/build-receipt.json`, sha256: receiptFile.sha256,
          compilerChecks, recordedToolchain: receipt.toolchain,
        },
        acquisitionEvidence: {
          path: `${sourcePath}/SOURCE-EVIDENCE.json`, sha256: files.get('SOURCE-EVIDENCE.json').sha256,
          scope: 'bounded-search-observations-not-original-source-authentication',
        },
        runtimeImports: receipt.runtimeImports[variant], peerDependencies: peers,
        verificationScope: 'local-source-and-build-artifact-integrity-only',
        originalMigrationAcceptance: 'not-satisfied-by-independent-replacement',
        originalSourceRecovered: false, originalRepositoryAuthenticated: false,
        nativeCompatibilityVerified: false, compatibility: 'not-verified', acceptedForProduction: false,
      },
    };
  });
  assert.deepEqual(readTree(root, { jsonOnly: false }).entries, tree.entries,
    'Console/layout source/build changed during verification');
  return replacements;
}

export function readConsoleTerminalReplacement(options) {
  return readConsoleLayoutReplacements(options)[0];
}

export function readSwaggerPreviewReplacement(options) {
  return readConsoleLayoutReplacements(options)[1];
}

export async function verifyConsoleLayoutBuild(options = {}) {
  const replacements = readConsoleLayoutReplacements(options);
  const root = join(resolve(options.workspace || workspaceRoot), sourcePath);
  const before = readTree(root, { jsonOnly: false });
  const { receipt, artifacts } = await buildLocalConsoleLayout({ root, writeOutputs: false });
  const files = new Map(before.contents.map(file => [file.path, file.data]));
  assert.deepEqual(receipt, JSON.parse(files.get('dist/build-receipt.json')),
    'Recomputed build receipt differs from recorded source/toolchain');
  for (const [path, bytes] of artifacts) assert.ok(bytes.equals(files.get(`dist/${path}`)),
    `Recorded output differs from reproducible build: ${path}`);
  assert.deepEqual(readTree(root, { jsonOnly: false }).entries, before.entries,
    'Console/layout source/build changed during reproducible verification');
  return replacements;
}

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: {
    workspace: { type: 'string' }, help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) {
    console.log('Usage: node scripts/prepare-native-console-layout-replacements.mjs [--workspace PATH]');
    console.log('Independent, pluginCode-scoped Console/OpenAPI replacements; no original/native acceptance.');
    return 0;
  }
  const workspace = resolve(values.workspace || workspaceRoot);
  const replacements = await verifyConsoleLayoutBuild({ workspace, contract: loadMigrationContract(workspace) });
  console.log(JSON.stringify(replacements.map(item => item.plugin), null, 2));
  return 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = await main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
