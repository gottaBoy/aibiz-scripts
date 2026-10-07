#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  fingerprint, optionalStat, PinnedDirectories, readPinnedFile, readTree,
} from './native-candidate-files.mjs';
import {
  AUDITED_INVENTORY, RESOURCE_INPUT, verifyNativeModelResourceReceipt, WORKSPACE,
} from './repair-native-model-resources.mjs';

export const MODEL_DESIGN_SOURCE =
  'vendor-upstream/gottaboy-plm-web/plugin-src/@ibiz-template-plugin/model-design@0.0.3-alpha.122';
export const AUDITED_MODEL_DESIGN_SOURCE = Object.freeze({
  files: 68,
  implementationFiles: 55,
  fingerprint: '18ed657dc47ce9aeea380581207c7e847a30c8e494cd52d5891e0a37f0134a9c',
  manifestSha256: 'e1c4407a548d50c7cdce33d7663947724fe445c965f34d7ed714b22b254baff7',
  inputFiles: 72,
  inputFingerprint: 'a2eff77ed8cdefebfa24636620baa77b8e067458d92033edb0492465ca21ed06',
});
const packageName = '@ibiz-template-plugin/model-design';
const packageVersion = '0.0.3-alpha.122';
const resourcePath = 'public/assets/json/runtime-model';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const slash = path => path.split(sep).join('/');

function childOf(parent, path) {
  const child = relative(parent, path);
  return child !== '' && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

function optionsWithDefaults(options) {
  return {
    workspace: WORKSPACE, source: MODEL_DESIGN_SOURCE, input: RESOURCE_INPUT,
    expectedResources: AUDITED_INVENTORY, expectedSource: AUDITED_MODEL_DESIGN_SOURCE,
    ...options,
  };
}

function loadInputs(options) {
  const { source, input, repairReceipt, expectedResources, expectedSource } = options;
  const workspace = resolve(options.workspace);
  const sourceRoot = resolve(workspace, source);
  assert.ok(childOf(workspace, sourceRoot), 'Source must be a child of the workspace');
  const sourceTree = readTree(sourceRoot, { jsonOnly: false });
  const rootFiles = new Set(['package.json', 'tsconfig.json', 'ibiz.config.cjs', 'CHANGELOG.md']);
  for (const file of sourceTree.entries) {
    assert.ok(rootFiles.has(file.path) || file.path.startsWith('src/'),
      `Unexpected source input: ${file.path}`);
    assert.ok(file.path !== resourcePath && !file.path.startsWith(`${resourcePath}/`),
      'Published source must not already contain staged runtime-model resources');
  }
  for (const name of ['package.json', 'tsconfig.json', 'ibiz.config.cjs', 'src/index.ts']) {
    assert.ok(sourceTree.entries.some(file => file.path === name), `Missing source input: ${name}`);
  }
  const manifestBytes = sourceTree.contents.find(file => file.path === 'package.json').data;
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  assert.equal(manifest.name, packageName, 'Unexpected source package identity');
  assert.equal(manifest.version, packageVersion, 'Unexpected source package version');
  assert.equal(manifest.dependencies?.['@ibiz-template-plugin/runtime-model'], '0.2.2',
    'Runtime-model dependency changed');
  const sourceEntries = sourceTree.entries.filter(file => file.path.startsWith('src/'))
    .map(file => ({ ...file, path: file.path.slice(4) }));
  const sourceInventory = {
    files: sourceEntries.length,
    implementationFiles: sourceEntries.filter(file =>
      /\.(?:ts|tsx)$/.test(file.path) && !file.path.endsWith('.d.ts')).length,
    fingerprint: fingerprint(sourceEntries).fingerprint,
    manifestSha256: hash(manifestBytes),
    inputFiles: sourceTree.files,
    inputFingerprint: sourceTree.fingerprint,
  };
  assert.deepEqual(sourceInventory, expectedSource, 'Published source audit mismatch');
  assert.equal(typeof manifest.scripts?.typecheck, 'string', 'Missing declared typecheck command');
  assert.equal(typeof manifest.scripts?.build, 'string', 'Missing declared build command');
  const repaired = verifyNativeModelResourceReceipt({
    workspace, input, receipt: repairReceipt, expected: expectedResources,
  });
  const resources = readTree(resolve(workspace, repaired.resources));
  assert.equal(resources.fingerprint, repaired.outputFingerprint,
    'Resource candidate changed after verification');
  const receiptDirectories = new PinnedDirectories();
  let repairReceiptSha256;
  try {
    const repairDirectory = receiptDirectories.open(dirname(resolve(workspace, repairReceipt)));
    repairReceiptSha256 = hash(readPinnedFile(receiptDirectories, repairDirectory, 'receipt.json').data);
  } finally { receiptDirectories.close(); }
  const files = [
    ...sourceTree.contents,
    ...resources.contents.map(file => ({ ...file, path: `${resourcePath}/${file.path}` })),
  ].sort((a, b) => a.path.localeCompare(b.path));
  const entries = files.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 }));
  return {
    files, entries,
    source: {
      path: slash(relative(workspace, sourceRoot)),
      package: manifest.name, version: manifest.version,
      packageGitHead: manifest.gitHead ?? null,
      ...fingerprint(sourceTree.entries), entries: sourceTree.entries,
      audit: sourceInventory,
    },
    resources: { ...repaired, repairReceiptSha256, packagePath: resourcePath },
    dependencies: {
      declared: manifest.dependencies,
      declaredPeers: manifest.peerDependencies ?? {},
      declaredToolchain: manifest.devDependencies ?? {},
      resolved: false, installed: false, lockfile: null,
    },
    commands: {
      typecheck: { command: manifest.scripts.typecheck, status: 'not-run' },
      build: { command: manifest.scripts.build, status: 'not-run' },
    },
  };
}

function candidatePath(workspace, output) {
  const root = join(workspace, '.artifacts/native-model-design-inputs');
  const destination = resolve(workspace, output || join(root,
    `inputs-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`));
  assert.equal(dirname(destination), root,
    'Output must be a direct child of .artifacts/native-model-design-inputs');
  assert.match(relative(root, destination), /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
    'Invalid output directory name');
  return { root, destination };
}

function checkInputPaths(options, root) {
  const workspace = resolve(options.workspace);
  assert.ok(typeof options.repairReceipt === 'string' && options.repairReceipt,
    'A repair receipt path is required');
  for (const [label, value] of [
    ['Source', options.source], ['Resource input', options.input],
    ['Repair receipt', options.repairReceipt],
  ]) {
    const path = resolve(workspace, value);
    assert.ok(childOf(workspace, path), `${label} must be a child of the workspace`);
    assert.ok(path !== root && !childOf(root, path) && !childOf(path, root),
      `${label} and output artifact trees must not overlap`);
  }
}

function receiptEvidence(inputs, workspace, destination) {
  return {
    schemaVersion: 1,
    contract: 'native-model-design-isolated-build-inputs',
    status: 'prepared-build-blocked',
    buildReady: false, acceptedForProduction: false, runtimeModelSourceRecovered: false,
    mapping: {
      requested: `${packageName}@0.0.3-alpha.90`,
      candidate: `${packageName}@${packageVersion}`,
      compatibility: 'not-verified',
    },
    source: inputs.source,
    resources: inputs.resources,
    dependencies: inputs.dependencies,
    commands: inputs.commands,
    package: {
      path: slash(relative(workspace, join(destination, 'package'))),
      ...fingerprint(inputs.entries), entries: inputs.entries,
    },
    blockers: [
      'complete-runtime-model-0.2.2-source-and-build-config-missing',
      'isolated-dependency-lock-and-install-missing',
      'runtime-model-loader-delivery-not-verified',
      'built-dist-and-es-resource-copy-not-verified',
      'local-typecheck-and-build-not-run',
      'native-version-compatibility-and-editor-save-reload-not-verified',
    ],
  };
}

export function prepareNativeModelDesignBuildInputs(options = {}) {
  options = optionsWithDefaults(options);
  const workspace = resolve(options.workspace);
  const { root, destination } = candidatePath(workspace, options.output);
  checkInputPaths(options, root);
  assert.ok(!optionalStat(destination), 'Existing destination must not be overwritten');
  const inputs = loadInputs(options);
  const receipt = {
    ...receiptEvidence(inputs, workspace, destination), generatedAt: new Date().toISOString(),
  };
  const directories = new PinnedDirectories();
  try {
    directories.open(root, { create: true });
    const candidate = directories.open(destination, { create: true, exclusive: true });
    for (const file of inputs.files) {
      const target = join(destination, 'package', file.path);
      directories.write(directories.open(dirname(target), { create: true }),
        relative(dirname(target), target), file.data);
    }
    const recheck = () => {
      assert.deepEqual(loadInputs(options), inputs, 'Build inputs changed during staging');
      assert.deepEqual(readTree(join(destination, 'package'), { jsonOnly: false }).entries,
        inputs.entries, 'Staged package differs from the verified build inputs');
      directories.verify(candidate);
    };
    recheck();
    const bytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
    const identity = directories.write(candidate, 'receipt.json', bytes);
    assert.deepEqual(readPinnedFile(directories, candidate, 'receipt.json', identity).data,
      bytes, 'Published build-input receipt changed');
    recheck();
    assert.deepEqual(readPinnedFile(directories, candidate, 'receipt.json', identity).data,
      bytes, 'Published build-input receipt changed');
    assert.deepEqual(fs.readdirSync(candidate.access).sort(), ['package', 'receipt.json'],
      'Unexpected build-input candidate files');
    return receipt;
  } finally { directories.close(); }
}

export function verifyNativeModelDesignBuildInputs(options = {}) {
  options = optionsWithDefaults(options);
  assert.ok(typeof options.receipt === 'string' && options.receipt,
    'A build-input receipt path is required');
  const workspace = resolve(options.workspace);
  const path = resolve(workspace, options.receipt);
  assert.equal(relative(dirname(path), path), 'receipt.json', 'Expected a candidate receipt.json');
  const { root, destination } = candidatePath(workspace, dirname(path));
  checkInputPaths(options, root);
  const directories = new PinnedDirectories();
  try {
    const candidate = directories.open(destination);
    const persisted = readPinnedFile(directories, candidate, 'receipt.json');
    const receipt = JSON.parse(persisted.data.toString('utf8'));
    const inputs = loadInputs(options);
    const { generatedAt, ...evidence } = receipt;
    assert.ok(typeof generatedAt === 'string' && Number.isFinite(Date.parse(generatedAt)),
      'Invalid build-input generation time');
    assert.deepEqual(evidence, receiptEvidence(inputs, workspace, destination),
      'Build-input receipt differs from the current audited inputs');
    assert.deepEqual(fs.readdirSync(candidate.access).sort(), ['package', 'receipt.json'],
      'Unexpected build-input candidate files');
    assert.deepEqual(readTree(join(destination, 'package'), { jsonOnly: false }).entries,
      inputs.entries, 'Staged package differs from the verified build inputs');
    assert.deepEqual(loadInputs(options), inputs, 'Build inputs changed during verification');
    assert.deepEqual(readTree(join(destination, 'package'), { jsonOnly: false }).entries,
      inputs.entries, 'Staged package changed during input verification');
    assert.deepEqual(readPinnedFile(directories, candidate, 'receipt.json', persisted.identity).data,
      persisted.data, 'Build-input receipt changed during verification');
    assert.deepEqual(fs.readdirSync(candidate.access).sort(), ['package', 'receipt.json'],
      'Unexpected build-input candidate files');
    directories.verify(candidate);
    return { ...receipt, status: 'verified-inputs-build-blocked', inputIntegrityVerified: true };
  } finally { directories.close(); }
}

export function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({
    args,
    options: {
      'repair-receipt': { type: 'string' },
      'verify-receipt': { type: 'string' },
      output: { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log('Usage: node scripts/prepare-native-model-design-inputs.mjs --repair-receipt PATH [--output PATH]');
    console.log('Verify: append --verify-receipt PATH instead of --output.');
    console.log('Stages immutable source/config copies and verified resources; no install or build is run.');
    console.log('Requires trusted artifact parents with no concurrent writer; failures retain partial candidates.');
    console.log('Receipt existence is not success: verify before consuming and retry into a fresh destination.');
    console.log('Exit 2 means build remains blocked; preparing inputs is not source/runtime acceptance.');
    return 0;
  }
  assert.ok(values['repair-receipt'], '--repair-receipt is required');
  assert.ok(!values['verify-receipt'] || !values.output,
    '--verify-receipt cannot be combined with --output');
  const options = { repairReceipt: values['repair-receipt'] };
  const result = values['verify-receipt']
    ? verifyNativeModelDesignBuildInputs({ ...options, receipt: values['verify-receipt'] })
    : prepareNativeModelDesignBuildInputs({ ...options, output: values.output });
  console.log(JSON.stringify(result, null, 2));
  return result.buildReady ? 0 : 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(); }
  catch (error) {
    console.error(`Native model-design build inputs failed: ${error.message}`);
    process.exitCode = 1;
  }
}
