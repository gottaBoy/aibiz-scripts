#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { loadMigrationContract } from './harness-modeling-core-audit.mjs';
import { fingerprint, readTree } from './native-candidate-files.mjs';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourcePath = 'modelingweb/local-plugins/design-index';
export const designIndexSelection = Object.freeze({
  from: '@ibiz-template-plugin/layout-design@0.0.3-alpha.90',
  to: '@aibiz/design-index@0.1.0',
  pluginType: 'VIEW_CUSTOM',
  pluginCode: 'DESIGN_INDEX_VIEW',
});
const outputNames = ['index.mjs', 'index.system.js', 'style.css'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const sorted = entries => [...entries].sort((a, b) => a.path.localeCompare(b.path));

function subset(contents) {
  const entries = contents.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 }));
  return { contents, entries, ...fingerprint(entries) };
}

export function readDesignIndexReplacement({ workspace = workspaceRoot, contract } = {}) {
  assert.equal(contract?.schemaVersion, 1, 'Expected native migration contract schema 1');
  assert.equal(contract.contract, 'ibizmodeling-core-migration', 'Expected native migration contract');
  assert.equal(contract.migrationMappings?.filter(item => item.from === designIndexSelection.from).length, 1,
    'Original layout-design mapping must exist exactly once');
  assert.ok(contract.plugins?.some(item => item.repo === designIndexSelection.from),
    'Original layout-design identity must exist in the native plugin contract');
  const root = join(resolve(workspace), sourcePath);
  const tree = readTree(root, { jsonOnly: false });
  const inputNames = ['build.mjs', 'package.json',
    ...tree.entries.filter(file => file.path.startsWith('src/')).map(file => file.path)];
  assert.ok(inputNames.some(path => path.endsWith('.ts')), 'Editable design-index source is required');
  assert.deepEqual(tree.entries.map(file => file.path), [
    'README.md', ...inputNames, 'dist/build-receipt.json', ...outputNames.map(path => `dist/${path}`),
  ].sort((a, b) => a.localeCompare(b)), 'Unexpected design-index source/build file set');
  const files = new Map(tree.contents.map(file => [file.path, file]));
  const manifest = JSON.parse(files.get('package.json').data);
  assert.equal(`${manifest.name}@${manifest.version}`, designIndexSelection.to);
  assert.equal(manifest.private, true);
  assert.equal(manifest.type, 'module');
  assert.equal(manifest.main, 'dist/index.mjs');
  assert.equal(manifest.module, 'dist/index.mjs');
  assert.equal(manifest.system, 'dist/index.system.js');
  assert.deepEqual(manifest.styles, ['dist/style.css']);
  assert.equal(Object.hasOwn(manifest, 'gitHead'), false, 'Independent index cannot claim upstream identity');
  assert.deepEqual(manifest.dependencies ?? {}, {}, 'Host dependencies must not be bundled as own dependencies');
  assert.deepEqual(manifest.devDependencies, { rollup: '4.9.3', typescript: '5.3.3' });
  const receiptFile = files.get('dist/build-receipt.json');
  const receipt = JSON.parse(receiptFile.data);
  assert.equal(receipt.schemaVersion, 1);
  assert.deepEqual(receipt.package, { name: manifest.name, version: manifest.version });
  assert.equal(receipt.sourceStatus, 'independent-local-implementation');
  assert.equal(receipt.originalSourceRecovered, false);
  assert.equal(receipt.nativeCompatibilityVerified, false);
  assert.deepEqual(receipt.supportedPluginCodes, [designIndexSelection.pluginCode],
    'Index-only replacement must not claim Swagger support');
  assert.ok(typeof receipt.compilerChecks === 'string' && receipt.compilerChecks,
    'Compiler verification scope is required');
  assert.deepEqual(sorted(receipt.inputs), sorted(inputNames.map(path => ({
    path, sha256: files.get(path).sha256,
  }))), 'Design-index current source input hashes differ');
  assert.deepEqual(sorted(receipt.outputs), sorted(outputNames.map(path => ({
    path, sha256: files.get(`dist/${path}`).sha256,
  }))), 'Design-index current build output hashes differ');
  assert.deepEqual(Object.keys(receipt.toolchain ?? {}).sort(), ['rollup', 'typescript']);
  for (const [name, version] of Object.entries(manifest.devDependencies)) {
    assert.equal(receipt.toolchain[name]?.version, version);
    assert.match(receipt.toolchain[name]?.sha256 ?? '', /^[a-f0-9]{64}$/);
  }
  assert.ok(Array.isArray(receipt.runtimeImports) && receipt.runtimeImports.length &&
    new Set(receipt.runtimeImports).size === receipt.runtimeImports.length &&
    receipt.runtimeImports.every(name => Object.hasOwn(manifest.peerDependencies ?? {}, name)),
  'Design-index runtime imports must use declared host peers');
  const source = subset(tree.contents.filter(file => inputNames.includes(file.path)));
  const built = subset(outputNames.map(path => ({ ...files.get(`dist/${path}`), path })));
  const delivery = subset(tree.contents.filter(file => file.path === 'package.json' ||
    outputNames.some(path => file.path === `dist/${path}`)));
  assert.deepEqual(readTree(root, { jsonOnly: false }).entries, tree.entries,
    'Design-index source/build changed during verification');
  return {
    files: delivery,
    plugin: {
      schemaVersion: 1, contract: 'native-design-index-independent-replacement',
      ...designIndexSelection, supportedPluginCodes: [designIndexSelection.pluginCode],
      partialReplacement: true, sourcePath, sourceStatus: 'independent-local-implementation',
      sourceFingerprint: source.fingerprint, sourceInputs: source.entries,
      buildOutputFingerprint: built.fingerprint, buildOutputs: built.entries,
      outputFingerprint: delivery.fingerprint, buildCommand: `node ${sourcePath}/build.mjs`,
      buildReceipt: {
        path: `${sourcePath}/dist/build-receipt.json`, sha256: hash(receiptFile.data),
        compilerChecks: receipt.compilerChecks, recordedToolchain: receipt.toolchain,
      },
      runtimeImports: receipt.runtimeImports, peerDependencies: manifest.peerDependencies,
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
    console.log('Usage: node scripts/prepare-native-design-index-replacement.mjs [--workspace PATH]');
    console.log('Index-only independent implementation; Swagger and original-source recovery remain unfinished.');
    return 0;
  }
  const workspace = resolve(values.workspace || workspaceRoot);
  console.log(JSON.stringify(readDesignIndexReplacement({
    workspace, contract: loadMigrationContract(workspace),
  }).plugin, null, 2));
  return 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
