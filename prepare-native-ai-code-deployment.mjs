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
import { WORKSPACE } from './repair-native-model-resources.mjs';
import { verifyAiCodeSourceDepsHarness } from './harness-native-ai-code-source-deps.mjs';

export const AI_CODE_SOURCE =
  'vendor-upstream/gottaboy-plm-web/plugin-src/@ibiz-template-plugin/ai-code@0.0.3-alpha.141';
export const AI_CODE_PUBLISHED =
  'vendor-upstream/plm-web/public/plugins/@ibiz-template-plugin/ai-code@0.0.3-alpha.141';
export const AUDITED_AI_CODE_BUILD = Object.freeze({
  manifestSha256: '77b7e0bf71664f6f9447887cbbcce12ba13d7a1202eff1af9d906d3d6f2ef3ae',
  sourceFingerprint: '8d3932ebe3358d489304dcb25e206f45a69a17759891813edf81a99fd1f3fc27',
  outputFingerprint: 'adeb4f095755468628bf9fb52ea1d17a43e813276873ea99884a9a1038638448',
  packageGitHead: '7020943f79e5e7886b314f90cc4eae64b1fcd196',
  inputs: 31,
  outputs: 67,
});
const packageName = '@ibiz-template-plugin/ai-code';
const version = '0.0.3-alpha.141';
const repo = `${packageName}@${version}`;
const inputFiles = [
  'CHANGELOG.md', 'README.md', 'SOURCE-EVIDENCE.md', 'ibiz.config.cjs',
  'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'record-build.mjs', 'tsconfig.json',
];
const inputDirectories = ['public', 'src'];
const outputDirectories = ['dist', 'es', 'lib'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const slash = path => path.split(sep).join('/');

function childOf(parent, path) {
  const child = relative(parent, path);
  return child !== '' && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child);
}

function settings(options) {
  return {
    workspace: WORKSPACE, source: AI_CODE_SOURCE, published: AI_CODE_PUBLISHED,
    expectedBuild: AUDITED_AI_CODE_BUILD, ...options,
  };
}

function candidatePath(workspace, output) {
  const root = join(workspace, '.artifacts/native-ai-code-deployment');
  const destination = resolve(workspace, output || join(root,
    `deployment-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`));
  assert.equal(dirname(destination), root,
    'Output must be a direct child of .artifacts/native-ai-code-deployment');
  assert.match(relative(root, destination), /^[A-Za-z0-9][A-Za-z0-9._-]*$/,
    'Invalid output directory name');
  return { root, destination };
}

function checkPaths(options, root) {
  const workspace = resolve(options.workspace);
  for (const [label, value] of [['Source', options.source], ['Published source', options.published]]) {
    const path = resolve(workspace, value);
    assert.ok(childOf(workspace, path), `${label} must be a child of the workspace`);
    assert.ok(path !== root && !childOf(root, path) && !childOf(path, root),
      `${label} and output artifact trees must not overlap`);
  }
}

function fileAt(directories, root, path) {
  const target = join(root, path);
  const { data } = readPinnedFile(directories, directories.open(dirname(target)),
    relative(dirname(target), target));
  assert.ok(data.length, `Empty file: ${path}`);
  return { path, bytes: data.length, sha256: hash(data), data };
}

function parts(directories, root, files, trees) {
  const contents = [
    ...files.map(path => fileAt(directories, root, path)),
    ...trees.flatMap(path => readTree(join(root, path), { jsonOnly: false }).contents
      .map(file => ({ ...file, path: `${path}/${file.path}` }))),
  ].sort((a, b) => a.path.localeCompare(b.path));
  const entries = contents.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 }));
  return { contents, entries, ...fingerprint(entries) };
}

function publishedProvenance(directories, sourceRoot, published, manifest, inputs) {
  const reference = JSON.parse(fileAt(directories, published, 'package.json').data.toString('utf8'));
  assert.equal(reference.name, manifest.name, 'Published package identity changed');
  assert.equal(reference.version, manifest.version, 'Published package version changed');
  assert.equal(reference.gitHead, manifest.gitHead, 'Published gitHead changed');
  const source = parts(directories, published, [], ['src']);
  const local = inputs.entries.filter(file => file.path.startsWith('src/'));
  assert.deepEqual(local.map(file => file.path), source.entries.map(file => file.path),
    'Published source file set differs');
  const originals = new Map(source.entries.map(file => [file.path, file.sha256]));
  const differences = local.filter(file => originals.get(file.path) !== file.sha256)
    .map(file => file.path);
  assert.ok(differences.every(path => [
    'src/module/inline-completions/inline-completions.ts',
    'src/monaco-editor/monaco-editor.tsx',
  ].includes(path)),
  'Source differs unexpectedly from the published snapshot');
  const assets = inputs.entries.filter(file => file.path.startsWith('public/assets/'))
    .map(file => ({ ...file, path: file.path.slice('public/'.length) }));
  const upstreamAssets = parts(directories, join(published, 'dist'), [], ['assets']);
  assert.deepEqual(assets, upstreamAssets.entries, 'Published assets differ from source inputs');
  return {
    status: 'published-snapshot-observed',
    path: slash(relative(resolve(sourceRoot, '../../../..'), published)),
    packageGitHead: reference.gitHead,
    sourceFingerprint: source.fingerprint,
    files: source.files,
    differences,
    publishedAssets: { files: assets.length, fingerprint: fingerprint(assets).fingerprint },
    note: 'Manifest gitHead and matching published source do not authenticate the original repository.',
  };
}

function loadSourceDepsBuild(options) {
  const workspace = resolve(options.workspace);
  const verified = verifyAiCodeSourceDepsHarness({
    workspace, sourceReport: options.sourceReport,
    ...(options.cliSourcePins ? { cliSourcePins: options.cliSourcePins } : {}),
  });
  const pkg = verified.report.sources.find(source => source.id === 'ai-code');
  const step = verified.report.steps.find(source => source.id === 'ai-code');
  assert.equal(pkg.original, resolve(workspace, options.source), 'Source dependency package path differs');
  const directories = new PinnedDirectories();
  try {
    const inputs = parts(directories, pkg.staged, inputFiles, inputDirectories);
    const outputs = parts(directories, pkg.staged, [], outputDirectories);
    assert.deepEqual(inputs.entries, pkg.entries, 'Staged plugin inputs differ from source dependency evidence');
    assert.deepEqual(outputs.entries, step.outputs.entries, 'Staged plugin outputs differ from source dependency evidence');
    const manifestFile = inputs.contents.find(file => file.path === 'package.json');
    const manifest = JSON.parse(manifestFile.data.toString('utf8'));
    assert.equal(manifest.name, packageName, 'Unexpected source package identity');
    assert.equal(manifest.version, version, 'Unexpected source package version');
    assert.deepEqual({
      system: manifest.system, module: manifest.module, main: manifest.main,
      types: manifest.types, styles: manifest.styles,
    }, {
      system: 'dist/index.system.min.js', module: 'es/index.mjs', main: 'lib/index.cjs',
      types: 'es/index.d.ts', styles: ['dist/index.min.css'],
    }, 'Unexpected plugin entry points');
    const outputMap = new Map(outputs.contents.map(file => [file.path, file.data]));
    for (const path of [manifest.system, manifest.module, manifest.main, manifest.types, ...manifest.styles]) {
      assert.ok(outputMap.get(path)?.length, `Missing plugin entry point: ${path}`);
    }
    assert.ok(outputMap.get(manifest.system).toString('utf8').includes('System.register('),
      'Plugin output is not a System.register bundle');
    for (const asset of ['type/types.txt', 'images/scene.png']) {
      const original = inputs.contents.find(file => file.path === `public/assets/${asset}`);
      assert.ok(original, `Missing source asset: ${asset}`);
      for (const format of outputDirectories) {
        assert.deepEqual(outputMap.get(`${format}/assets/${asset}`), original.data,
          `Built asset differs from source: ${format}/${asset}`);
      }
    }
    const provenance = publishedProvenance(directories, pkg.original,
      resolve(workspace, options.published), manifest, inputs);
    const files = [...outputs.contents, manifestFile].sort((a, b) => a.path.localeCompare(b.path));
    const entries = files.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 }));
    const reportPath = slash(relative(workspace, verified.reportPath));
    return {
      files, entries,
      source: {
        path: slash(relative(workspace, pkg.original)), stagedPath: slash(relative(workspace, pkg.staged)),
        ...fingerprint(inputs.entries), inputs: inputs.entries,
        audit: { kind: 'source-dependency-report', reportPath, reportSha256: verified.reportSha256 },
      },
      build: {
        receiptPath: reportPath, receiptSha256: verified.reportSha256,
        command: 'node scripts/harness-native-ai-code-source-deps.mjs',
        package: { name: packageName, version, repo, gitHead: manifest.gitHead },
        sourceFingerprint: inputs.fingerprint, outputFingerprint: outputs.fingerprint,
        outputs: outputs.entries, provenance,
      },
      dependencies: {
        declared: manifest.dependencies ?? {}, peers: manifest.peerDependencies ?? {},
        toolchain: manifest.devDependencies ?? {},
        lockfile: inputs.entries.find(file => file.path === 'pnpm-lock.yaml'),
        ibizDependencySourceBuildsVerified: true,
        toolchainSourceBuildsVerified: verified.toolchainSourceVerified,
        declaredRangeCompatibility: 'not-verified',
        sourceBuildEvidence: {
          reportPath, reportSha256: verified.reportSha256,
          scope: verified.report.scope,
          sources: verified.report.sources.filter(source => source.id !== 'hub-config').map(source => ({
            name: source.name, version: source.version, fingerprint: source.fingerprint,
            outputFingerprint: verified.report.steps.find(item => item.id === source.id)?.outputs.fingerprint ?? null,
          })),
          publishedOwnToolchain: verified.report.publishedOwnToolchain,
          ...(verified.report.cliSourceReports ? {
            cliSourceReports: verified.report.cliSourceReports,
            sourceBuiltOwnToolchain: verified.report.sourceBuiltOwnToolchain,
          } : {}),
        },
      },
    };
  } finally { directories.close(); }
}

function loadBuild(options) {
  if (options.sourceReport) return loadSourceDepsBuild(options);
  const workspace = resolve(options.workspace);
  const sourceRoot = resolve(workspace, options.source);
  const published = resolve(workspace, options.published);
  const directories = new PinnedDirectories();
  try {
    const sourceDirectory = directories.open(sourceRoot);
    const allowed = new Set([
      ...inputFiles, ...inputDirectories, ...outputDirectories, 'node_modules', '.artifacts',
    ]);
    for (const name of fs.readdirSync(sourceDirectory.access)) {
      assert.ok(allowed.has(name), `Unrecorded source root input: ${name}`);
    }
    const inputs = parts(directories, sourceRoot, inputFiles, inputDirectories);
    const outputs = parts(directories, sourceRoot, [], outputDirectories);
    const manifestFile = inputs.contents.find(file => file.path === 'package.json');
    const manifest = JSON.parse(manifestFile.data.toString('utf8'));
    assert.equal(manifest.name, packageName, 'Unexpected source package identity');
    assert.equal(manifest.version, version, 'Unexpected source package version');
    assert.deepEqual({
      system: manifest.system, module: manifest.module, main: manifest.main,
      types: manifest.types, styles: manifest.styles,
    }, {
      system: 'dist/index.system.min.js', module: 'es/index.mjs', main: 'lib/index.cjs',
      types: 'es/index.d.ts', styles: ['dist/index.min.css'],
    }, 'Unexpected plugin entry points');
    assert.deepEqual({
      manifestSha256: manifestFile.sha256,
      sourceFingerprint: inputs.fingerprint, outputFingerprint: outputs.fingerprint,
      packageGitHead: manifest.gitHead, inputs: inputs.files, outputs: outputs.files,
    }, options.expectedBuild, 'Audited source/build fingerprint mismatch');
    const buildReceiptFile = fileAt(directories, sourceRoot, '.artifacts/build-receipt.json');
    const build = JSON.parse(buildReceiptFile.data.toString('utf8'));
    assert.equal(build?.schemaVersion, 1, 'Unsupported source build receipt schema');
    assert.equal(build?.status, 'passed', 'Source build did not pass');
    assert.equal(build?.exitCode, 0, 'Source build did not exit successfully');
    assert.equal(build.command, 'pnpm run build', 'Unexpected build command');
    assert.deepEqual(build.package, {
      name: packageName, version, repo, gitHead: manifest.gitHead,
    }, 'Build receipt package identity differs');
    assert.deepEqual(build.inputs, inputs.entries, 'Build receipt inputs are stale');
    assert.deepEqual(build.outputs, outputs.entries, 'Build receipt outputs are stale');
    assert.equal(build.sourceFingerprint, inputs.fingerprint, 'Source fingerprint differs');
    assert.equal(build.outputFingerprint, outputs.fingerprint, 'Build output fingerprint differs');
    assert.deepEqual(build.source, {
      path: '.', fingerprintKind: 'source-file-set', files: inputs.files, bytes: inputs.bytes,
    }, 'Build source inventory differs');
    assert.deepEqual(build.output, {
      path: '.', fingerprintKind: 'build-output-file-set', files: outputs.files, bytes: outputs.bytes,
    }, 'Build output inventory differs');
    const provenance = publishedProvenance(directories, sourceRoot, published, manifest, inputs);
    assert.deepEqual(build.provenance, provenance, 'Build provenance differs from published inputs');
    const outputMap = new Map(outputs.contents.map(file => [file.path, file.data]));
    for (const path of [manifest.system, manifest.module, manifest.main, manifest.types,
      ...manifest.styles]) assert.ok(outputMap.has(path), `Missing plugin entry point: ${path}`);
    assert.ok(outputMap.get(manifest.system).toString('utf8').includes('System.register('),
      'Plugin output is not a System.register bundle');
    for (const asset of ['type/types.txt', 'images/scene.png']) {
      const original = inputs.contents.find(file => file.path === `public/assets/${asset}`);
      assert.ok(original, `Missing source asset: ${asset}`);
      for (const format of outputDirectories) {
        assert.deepEqual(outputMap.get(`${format}/assets/${asset}`), original.data,
          `Built asset differs from source: ${format}/${asset}`);
      }
    }
    directories.verify(sourceDirectory);
    const files = [...outputs.contents, manifestFile].sort((a, b) => a.path.localeCompare(b.path));
    const entries = files.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 }));
    return {
      files, entries,
      source: {
        path: slash(relative(workspace, sourceRoot)),
        ...fingerprint(inputs.entries), inputs: inputs.entries,
        audit: options.expectedBuild,
      },
      build: {
        receiptPath: slash(relative(workspace, join(sourceRoot, '.artifacts/build-receipt.json'))),
        receiptSha256: buildReceiptFile.sha256, command: build.command,
        package: build.package, sourceFingerprint: build.sourceFingerprint,
        outputFingerprint: build.outputFingerprint, outputs: build.outputs, provenance,
      },
      dependencies: {
        declared: manifest.dependencies ?? {}, peers: manifest.peerDependencies ?? {},
        toolchain: manifest.devDependencies ?? {},
        lockfile: inputs.entries.find(file => file.path === 'pnpm-lock.yaml'),
        ibizDependencySourceBuildsVerified: false,
      },
    };
  } finally { directories.close(); }
}

function evidence(inputs, workspace, destination) {
  return {
    schemaVersion: 1, contract: 'native-ai-code-source-build-deployment',
    status: 'prepared-not-accepted', acceptedForProduction: false,
    originalRepositoryAuthenticated: false,
    mapping: {
      requested: `${packageName}@0.0.3-alpha.92`, candidate: repo,
      compatibility: 'not-verified',
    },
    source: inputs.source, build: inputs.build, dependencies: inputs.dependencies,
    deployment: {
      path: slash(relative(workspace, join(destination, 'plugins', repo))),
      ...fingerprint(inputs.entries), entries: inputs.entries,
      manifestIncluded: true,
    },
    remainingAcceptance: [
      inputs.dependencies.ibizDependencySourceBuildsVerified
        ? inputs.dependencies.toolchainSourceBuildsVerified
          ? 'docker-compiler-build'
          : 'docker-compiler-build-and-toolchain-source-verification'
        : 'ibiz-dependency-local-source-build-and-docker-build',
      'original-source-repository-and-asset-provenance',
      'native-version-compatibility-and-loader-delivery',
      'native-editor-operations-save-and-fresh-session-readback',
    ],
  };
}

function checkCandidate(directories, candidate, inputs) {
  directories.verify(candidate);
  assert.deepEqual(fs.readdirSync(candidate.access).sort(), ['plugins', 'receipt.json'],
    'Unexpected deployment candidate files');
  const plugins = directories.open(join(candidate.path, 'plugins'));
  assert.deepEqual(fs.readdirSync(plugins.access), ['@ibiz-template-plugin'],
    'Unexpected deployment scopes');
  const scope = directories.open(join(plugins.path, '@ibiz-template-plugin'));
  assert.deepEqual(fs.readdirSync(scope.access), [`ai-code@${version}`],
    'Unexpected deployment packages');
  assert.deepEqual(readTree(join(candidate.path, 'plugins', repo), { jsonOnly: false }).entries,
    inputs.entries, 'Deployment differs from the verified source build and manifest');
  directories.verify(candidate);
}

export function prepareNativeAiCodeDeployment(options = {}) {
  options = settings(options);
  const workspace = resolve(options.workspace);
  const { root, destination } = candidatePath(workspace, options.output);
  checkPaths(options, root);
  assert.ok(!optionalStat(destination), 'Existing destination must not be overwritten');
  const inputs = loadBuild(options);
  const receipt = { ...evidence(inputs, workspace, destination), generatedAt: new Date().toISOString() };
  const directories = new PinnedDirectories();
  try {
    directories.open(root, { create: true });
    const candidate = directories.open(destination, { create: true, exclusive: true });
    for (const file of inputs.files) {
      const target = join(destination, 'plugins', repo, file.path);
      directories.write(directories.open(dirname(target), { create: true }),
        relative(dirname(target), target), file.data);
    }
    assert.deepEqual(loadBuild(options), inputs, 'Source build changed during deployment preparation');
    assert.deepEqual(readTree(join(destination, 'plugins', repo), { jsonOnly: false }).entries,
      inputs.entries, 'Deployment copy differs from the verified source build');
    const bytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
    const identity = directories.write(candidate, 'receipt.json', bytes);
    checkCandidate(directories, candidate, inputs);
    assert.deepEqual(readPinnedFile(directories, candidate, 'receipt.json', identity).data, bytes,
      'Published deployment receipt changed');
    assert.deepEqual(loadBuild(options), inputs, 'Source build changed during receipt publication');
    checkCandidate(directories, candidate, inputs);
    assert.deepEqual(readPinnedFile(directories, candidate, 'receipt.json', identity).data, bytes,
      'Published deployment receipt changed');
    return receipt;
  } finally { directories.close(); }
}

export function verifyNativeAiCodeDeployment(options = {}) {
  options = settings(options);
  assert.ok(typeof options.receipt === 'string' && options.receipt,
    'A deployment receipt path is required');
  const workspace = resolve(options.workspace);
  const path = resolve(workspace, options.receipt);
  assert.equal(relative(dirname(path), path), 'receipt.json', 'Expected a candidate receipt.json');
  const { root, destination } = candidatePath(workspace, dirname(path));
  checkPaths(options, root);
  const directories = new PinnedDirectories();
  try {
    const candidate = directories.open(destination);
    const persisted = readPinnedFile(directories, candidate, 'receipt.json');
    const receipt = JSON.parse(persisted.data.toString('utf8'));
    const inputs = loadBuild(options);
    const { generatedAt, ...recorded } = receipt;
    assert.ok(typeof generatedAt === 'string' && Number.isFinite(Date.parse(generatedAt)),
      'Invalid deployment generation time');
    assert.deepEqual(recorded, evidence(inputs, workspace, destination),
      'Deployment receipt differs from the current audited build');
    checkCandidate(directories, candidate, inputs);
    assert.deepEqual(loadBuild(options), inputs, 'Source build changed during verification');
    checkCandidate(directories, candidate, inputs);
    assert.deepEqual(readPinnedFile(directories, candidate, 'receipt.json', persisted.identity).data,
      persisted.data, 'Deployment receipt changed during verification');
    return { ...receipt, status: 'verified-deployment-not-accepted', deploymentIntegrityVerified: true };
  } finally { directories.close(); }
}

export function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({
    args,
    options: {
      output: { type: 'string' }, 'verify-receipt': { type: 'string' },
      'source-deps-report': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log('Usage: node scripts/prepare-native-ai-code-deployment.mjs [--output PATH]');
    console.log('Verify: use --verify-receipt PATH instead of --output.');
    console.log('Copies the audited local build and unchanged manifest; no build or service mutation.');
    console.log('Use --source-deps-report PATH to consume freshly source-built framework dependencies instead of the legacy build.');
    console.log('Requires trusted artifact ancestors and one writer on Linux; failed candidates remain.');
    console.log('Receipt existence is not success: always verify before consumption.');
    console.log('Exit 2: deployment integrity is not native compatibility or production acceptance.');
    return 0;
  }
  assert.ok(!values.output || !values['verify-receipt'],
    '--verify-receipt cannot be combined with --output');
  const result = values['verify-receipt']
    ? verifyNativeAiCodeDeployment({
      receipt: values['verify-receipt'], sourceReport: values['source-deps-report'],
    })
    : prepareNativeAiCodeDeployment({ output: values.output, sourceReport: values['source-deps-report'] });
  console.log(JSON.stringify(result, null, 2));
  return 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
