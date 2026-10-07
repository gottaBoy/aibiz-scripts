import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { fingerprint, readTree } from '../native-candidate-files.mjs';
import {
  AI_CODE_PUBLISHED, AI_CODE_SOURCE, AUDITED_AI_CODE_BUILD, main,
  prepareNativeAiCodeDeployment, verifyNativeAiCodeDeployment,
} from '../prepare-native-ai-code-deployment.mjs';

const workspaceRoot = fileURLToPath(new URL('../../', import.meta.url));
const tool = fileURLToPath(new URL('../prepare-native-ai-code-deployment.mjs', import.meta.url));
const repo = '@ibiz-template-plugin/ai-code@0.0.3-alpha.141';
const realSource = join(workspaceRoot, AI_CODE_SOURCE);
const realPublished = join(workspaceRoot, AI_CODE_PUBLISHED);
const buildReceiptPath = source => join(source, '.artifacts/build-receipt.json');
const originalBuildReceiptBytes = fs.readFileSync(buildReceiptPath(realSource));
const originalBuildReceipt = JSON.parse(originalBuildReceiptBytes);
const hash = data => createHash('sha256').update(data).digest('hex');
const tree = root => readTree(root, { jsonOnly: false });
const openedPath = path => typeof path === 'number' ? fs.readlinkSync(`/proc/self/fd/${path}`) : path;
const inputRoots = [
  'CHANGELOG.md', 'README.md', 'SOURCE-EVIDENCE.md', 'ibiz.config.cjs',
  'package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'record-build.mjs',
  'tsconfig.json', 'public', 'src',
];
const outputRoots = ['dist', 'es', 'lib'];
const requiredOutputs = [
  'dist/index.system.min.js', 'dist/index.min.css', 'es/index.mjs',
  'es/index.d.ts', 'lib/index.cjs',
  ...outputRoots.flatMap(format => [
    `${format}/assets/type/types.txt`, `${format}/assets/images/scene.png`,
  ]),
];

function write(path, data) {
  fs.mkdirSync(dirname(path), { recursive: true });
  fs.writeFileSync(path, data);
}

function copy(from, to) {
  fs.mkdirSync(dirname(to), { recursive: true });
  fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
}

function entriesFor(root, roots) {
  const entries = roots.flatMap(path => {
    const absolute = join(root, path);
    if (fs.lstatSync(absolute).isDirectory()) {
      return tree(absolute).entries.map(entry => ({ ...entry, path: `${path}/${entry.path}` }));
    }
    const data = fs.readFileSync(absolute);
    return [{ path, bytes: data.length, sha256: hash(data) }];
  });
  return entries.sort((left, right) => left.path.localeCompare(right.path));
}

function fixture(t) {
  const workspace = fs.mkdtempSync(join(tmpdir(), 'native-ai-code-deployment-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const source = join(workspace, AI_CODE_SOURCE);
  const published = join(workspace, AI_CODE_PUBLISHED);
  for (const entry of [...originalBuildReceipt.inputs, ...originalBuildReceipt.outputs]) {
    copy(join(realSource, entry.path), join(source, entry.path));
  }
  write(buildReceiptPath(source), originalBuildReceiptBytes);
  copy(join(realPublished, 'package.json'), join(published, 'package.json'));
  for (const entry of entriesFor(realPublished, ['src', 'dist/assets'])) {
    copy(join(realPublished, entry.path), join(published, entry.path));
  }
  return {
    workspace, source, published, expectedBuild: structuredClone(AUDITED_AI_CODE_BUILD),
    output: join(workspace, '.artifacts/native-ai-code-deployment/candidate'),
  };
}

function evidence(options) {
  return { source: tree(options.source).entries, published: tree(options.published).entries };
}

function verify(options) {
  return verifyNativeAiCodeDeployment({ ...options, receipt: join(options.output, 'receipt.json') });
}

function editJson(path, edit) {
  const value = JSON.parse(fs.readFileSync(path, 'utf8'));
  edit(value);
  fs.writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function refreshBuild(options) {
  const inputs = entriesFor(options.source, inputRoots);
  const outputs = entriesFor(options.source, outputRoots);
  const source = fingerprint(inputs);
  const output = fingerprint(outputs);
  editJson(buildReceiptPath(options.source), value => {
    value.inputs = inputs;
    value.outputs = outputs;
    value.source.files = source.files;
    value.source.bytes = source.bytes;
    value.output.files = output.files;
    value.output.bytes = output.bytes;
    value.sourceFingerprint = source.fingerprint;
    value.outputFingerprint = output.fingerprint;
  });
  Object.assign(options.expectedBuild, {
    manifestSha256: hash(fs.readFileSync(join(options.source, 'package.json'))),
    sourceFingerprint: source.fingerprint,
    outputFingerprint: output.fingerprint,
    inputs: inputs.length, outputs: outputs.length,
  });
}

function assertPreflightRejected(options) {
  const before = evidence(options);
  assert.throws(() => prepareNativeAiCodeDeployment(options));
  assert.equal(fs.existsSync(options.output), false);
  assert.deepEqual(evidence(options), before);
}

function assertNotAccepted(receipt) {
  assert.equal(receipt.acceptedForProduction, false);
  assert.equal(receipt.originalRepositoryAuthenticated, false);
  assert.deepEqual(receipt.mapping, {
    requested: '@ibiz-template-plugin/ai-code@0.0.3-alpha.92',
    candidate: repo, compatibility: 'not-verified',
  });
  assert.equal(receipt.dependencies.ibizDependencySourceBuildsVerified, false);
}

test('default source, published snapshot and frozen audit pin the exact ai-code build', () => {
  assert.equal(AI_CODE_SOURCE,
    `vendor-upstream/gottaboy-plm-web/plugin-src/${repo}`);
  assert.equal(AI_CODE_PUBLISHED, `vendor-upstream/plm-web/public/plugins/${repo}`);
  assert.deepEqual(AUDITED_AI_CODE_BUILD, {
    manifestSha256: '77b7e0bf71664f6f9447887cbbcce12ba13d7a1202eff1af9d906d3d6f2ef3ae',
    sourceFingerprint: '8d3932ebe3358d489304dcb25e206f45a69a17759891813edf81a99fd1f3fc27',
    outputFingerprint: 'adeb4f095755468628bf9fb52ea1d17a43e813276873ea99884a9a1038638448',
    packageGitHead: '7020943f79e5e7886b314f90cc4eae64b1fcd196',
    inputs: 31, outputs: 67,
  });
  assert.equal(Object.isFrozen(AUDITED_AI_CODE_BUILD), true);
});

test('real build receipt verifies all audited inputs, outputs and published provenance read-only', () => {
  const inputs = entriesFor(realSource, inputRoots);
  const outputs = entriesFor(realSource, outputRoots);
  const publishedBefore = entriesFor(realPublished, ['package.json', 'src', 'dist/assets']);
  assert.deepEqual(inputs, originalBuildReceipt.inputs);
  assert.deepEqual(outputs, originalBuildReceipt.outputs);
  assert.equal(hash(fs.readFileSync(join(realSource, 'package.json'))),
    AUDITED_AI_CODE_BUILD.manifestSha256);
  assert.equal(fingerprint(inputs).fingerprint, AUDITED_AI_CODE_BUILD.sourceFingerprint);
  assert.equal(fingerprint(outputs).fingerprint, AUDITED_AI_CODE_BUILD.outputFingerprint);
  assert.equal(inputs.length, 31);
  assert.equal(outputs.length, 67);
  for (const path of requiredOutputs) {
    assert.ok(outputs.some(entry => entry.path === path && entry.bytes > 0), path);
  }
  const checked = spawnSync(process.execPath, [
    join(realSource, 'record-build.mjs'), '--verify',
  ], { cwd: workspaceRoot, encoding: 'utf8', timeout: 30_000 });
  assert.equal(checked.error, undefined);
  assert.equal(checked.status, 0, checked.stderr);
  assert.match(checked.stdout, /Verified @ibiz-template-plugin\/ai-code@0\.0\.3-alpha\.141/);
  assert.deepEqual(entriesFor(realSource, inputRoots), inputs);
  assert.deepEqual(entriesFor(realSource, outputRoots), outputs);
  assert.deepEqual(entriesFor(realPublished, ['package.json', 'src', 'dist/assets']), publishedBefore);
  assert.deepEqual(fs.readFileSync(buildReceiptPath(realSource)), originalBuildReceiptBytes);
});

test('candidate deploys exactly 67 recorded outputs and the unchanged manifest, never source or dependencies', t => {
  const options = fixture(t);
  const before = evidence(options);
  const receipt = prepareNativeAiCodeDeployment(options);
  const deployed = join(options.output, 'plugins', repo);
  const entries = tree(deployed).entries;
  assert.equal(receipt.schemaVersion, 1);
  assert.equal(receipt.contract, 'native-ai-code-source-build-deployment');
  assert.equal(receipt.status, 'prepared-not-accepted');
  assertNotAccepted(receipt);
  assert.ok(Number.isFinite(Date.parse(receipt.generatedAt)));
  assert.deepEqual(fs.readdirSync(options.output).sort(), ['plugins', 'receipt.json']);
  assert.deepEqual(fs.readdirSync(join(deployed)).sort(), ['dist', 'es', 'lib', 'package.json']);
  assert.deepEqual(receipt.source.inputs, originalBuildReceipt.inputs);
  assert.equal(receipt.source.path, AI_CODE_SOURCE);
  assert.deepEqual(receipt.source.audit, AUDITED_AI_CODE_BUILD);
  assert.deepEqual(receipt.build.outputs, originalBuildReceipt.outputs);
  assert.equal(receipt.build.receiptPath, `${AI_CODE_SOURCE}/.artifacts/build-receipt.json`);
  assert.equal(receipt.build.receiptSha256, hash(originalBuildReceiptBytes));
  assert.deepEqual(receipt.build.provenance, originalBuildReceipt.provenance);
  const expected = [
    ...originalBuildReceipt.outputs,
    originalBuildReceipt.inputs.find(entry => entry.path === 'package.json'),
  ].sort((left, right) => left.path.localeCompare(right.path));
  assert.equal(entries.length, 68);
  assert.deepEqual(entries, expected);
  assert.deepEqual(receipt.deployment.entries, entries);
  assert.equal(receipt.deployment.path, relative(options.workspace, deployed));
  assert.equal(receipt.deployment.fingerprint, fingerprint(entries).fingerprint);
  assert.equal(receipt.deployment.files, 68);
  assert.equal(receipt.deployment.manifestIncluded, true);
  for (const entry of entries) {
    assert.deepEqual(fs.readFileSync(join(deployed, entry.path)),
      fs.readFileSync(join(options.source, entry.path)), entry.path);
  }
  for (const path of ['src', 'public', 'node_modules', '.artifacts', 'record-build.mjs', 'pnpm-lock.yaml']) {
    assert.equal(fs.existsSync(join(deployed, path)), false, path);
  }
  assert.deepEqual(JSON.parse(fs.readFileSync(join(options.output, 'receipt.json'), 'utf8')), receipt);
  assert.deepEqual(evidence(options), before);
});

test('verification preserves every byte and returns the same evidence without production acceptance', t => {
  const options = fixture(t);
  const receipt = prepareNativeAiCodeDeployment(options);
  const before = { evidence: evidence(options), candidate: tree(options.output).entries };
  const verified = verify(options);
  assert.equal(verified.status, 'verified-deployment-not-accepted');
  assert.equal(verified.deploymentIntegrityVerified, true);
  assertNotAccepted(verified);
  const { status, deploymentIntegrityVerified, ...verifiedEvidence } = verified;
  const { status: preparedStatus, ...preparedEvidence } = receipt;
  assert.deepEqual(verifiedEvidence, preparedEvidence);
  verified.deployment.entries.length = 0;
  assert.deepEqual(verify(options).deployment, receipt.deployment);
  assert.deepEqual({ evidence: evidence(options), candidate: tree(options.output).entries }, before);
});

test('legacy provenance is recorder-relative while source and build paths remain workspace-relative', t => {
  const options = fixture(t);
  const moved = join(options.workspace, 'isolated/source');
  fs.mkdirSync(dirname(moved), { recursive: true });
  fs.renameSync(options.source, moved);
  options.source = moved;
  const provenancePath = relative(resolve(options.source, '../../../..'), options.published);
  assert.notEqual(provenancePath, relative(options.workspace, options.published));
  editJson(buildReceiptPath(options.source), value => { value.provenance.path = provenancePath; });
  const before = evidence(options);
  const receipt = prepareNativeAiCodeDeployment(options);
  assert.equal(receipt.build.provenance.path, provenancePath);
  assert.equal(receipt.source.path, 'isolated/source');
  assert.equal(receipt.build.receiptPath, 'isolated/source/.artifacts/build-receipt.json');
  assert.equal(verify(options).deploymentIntegrityVerified, true);
  assert.deepEqual(evidence(options), before);
});

test('publisher prepares and verifies with committed audit modules, without dirty audit exports', t => {
  const options = fixture(t);
  const before = evidence(options);
  const scripts = join(options.workspace, 'scripts');
  for (const name of [
    'prepare-native-ai-code-deployment.mjs', 'native-candidate-files.mjs',
    'repair-native-model-resources.mjs', 'harness-native-ai-code-source-deps.mjs',
    'harness-native-cli-source-build.mjs', 'fetch-native-cli-source.mjs',
  ]) {
    copy(join(dirname(tool), name), join(scripts, name));
  }
  for (const name of ['harness-modeling-core-audit.mjs', 'harness-plugin-audit.mjs']) {
    const committed = spawnSync('git', ['show', `HEAD:${name}`], {
      cwd: dirname(tool), encoding: 'utf8', timeout: 30_000,
    });
    assert.equal(committed.error, undefined);
    assert.equal(committed.status, 0, committed.stderr);
    write(join(scripts, name), committed.stdout);
  }
  const isolatedTool = join(scripts, 'prepare-native-ai-code-deployment.mjs');
  const run = args => {
    const result = spawnSync(process.execPath, [isolatedTool, ...args], {
      cwd: options.workspace, encoding: 'utf8', timeout: 30_000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 2, result.stderr);
    return JSON.parse(result.stdout);
  };
  const prepared = run(['--output', options.output]);
  assert.equal(prepared.status, 'prepared-not-accepted');
  assertNotAccepted(prepared);
  assert.deepEqual(prepared.source.inputs, originalBuildReceipt.inputs);
  assert.deepEqual(prepared.build.outputs, originalBuildReceipt.outputs);
  const candidateBefore = tree(options.output).entries;
  const verified = run(['--verify-receipt', join(options.output, 'receipt.json')]);
  assert.equal(verified.status, 'verified-deployment-not-accepted');
  assert.equal(verified.deploymentIntegrityVerified, true);
  assertNotAccepted(verified);
  assert.deepEqual(verified.deployment, prepared.deployment);
  assert.deepEqual(tree(options.output).entries, candidateBefore);
  assert.deepEqual(evidence(options), before);
});

for (const key of Object.keys({
  manifestSha256: 0, sourceFingerprint: 0, outputFingerprint: 0,
  packageGitHead: 0, inputs: 0, outputs: 0,
})) {
  test(`wrong audited ${key} fails before creating any candidate`, t => {
    const options = fixture(t);
    const previous = options.expectedBuild[key];
    options.expectedBuild[key] = typeof previous === 'number' ? previous + 1 : '0'.repeat(previous.length);
    assertPreflightRejected(options);
  });
}

for (const path of ['README.md', 'src/index.ts', 'public/assets/type/types.txt', 'es/index.mjs']) {
  test(`changed recorded ${path} fails without rewriting originals or the build receipt`, t => {
    const options = fixture(t);
    const target = join(options.source, path);
    fs.appendFileSync(target, '\nchanged after build\n');
    assertPreflightRejected(options);
  });
}

for (const path of [
  'unrecorded.config.cjs', 'src/unrecorded.ts', 'public/assets/unrecorded.txt',
  'dist/unrecorded.js', 'lib/unrecorded.cjs',
]) {
  test(`unrecorded ${path} cannot be silently omitted from the file-set evidence`, t => {
    const options = fixture(t);
    write(join(options.source, path), 'unrecorded file\n');
    assertPreflightRejected(options);
  });
}

for (const path of ['README.md', 'dist/index.system.min.js', 'es/index.d.ts', 'lib/index.cjs']) {
  test(`missing or empty recorded ${path} is rejected`, t => {
    const options = fixture(t);
    const target = join(options.source, path);
    fs.unlinkSync(target);
    assertPreflightRejected(options);
    write(target, '');
    assertPreflightRejected(options);
  });
}

for (const [name, edit] of [
  ['invalid schema version', value => { value.schemaVersion = 2; }],
  ['missing schema version', value => { delete value.schemaVersion; }],
  ['failed build', value => { value.status = 'failed'; }],
  ['missing build status', value => { delete value.status; }],
  ['wrong build command', value => { value.command = 'cp -r dist'; }],
  ['nonzero build exit', value => { value.exitCode = 1; }],
  ['missing build exit', value => { delete value.exitCode; }],
  ['package repository', value => { value.package.repo = '@other/ai-code@0.0.3-alpha.141'; }],
  ['input SHA', value => { value.inputs[0].sha256 = '0'.repeat(64); }],
  ['output SHA', value => { value.outputs[0].sha256 = '0'.repeat(64); }],
  ['omitted input', value => { value.inputs.pop(); }],
  ['duplicate output', value => { value.outputs.push(value.outputs[0]); }],
  ['input traversal', value => { value.inputs[0].path = '../outside'; }],
  ['output traversal', value => { value.outputs[0].path = '../outside'; }],
  ['published source fingerprint', value => { value.provenance.sourceFingerprint = '0'.repeat(64); }],
  ['published asset fingerprint', value => { value.provenance.publishedAssets.fingerprint = '0'.repeat(64); }],
  ['unaudited source difference', value => { value.provenance.differences.push('src/index.ts'); }],
]) {
  test(`tampered build receipt ${name} fails before deployment and remains untouched`, t => {
    const options = fixture(t);
    editJson(buildReceiptPath(options.source), edit);
    assertPreflightRejected(options);
  });
}

for (const [key, value] of [
  ['system', 'dist/other.js'], ['module', 'es/other.mjs'], ['main', 'lib/other.cjs'],
  ['types', 'lib/index.d.ts'], ['styles', ['dist/other.css']],
]) {
  test(`manifest ${key} contract is enforced even with resealed hashes`, t => {
    const options = fixture(t);
    editJson(join(options.source, 'package.json'), manifest => { manifest[key] = value; });
    refreshBuild(options);
    assertPreflightRejected(options);
  });
}

test('SystemJS and cross-format asset checks cannot be bypassed by resealing build hashes', t => {
  const options = fixture(t);
  write(join(options.source, 'dist/index.system.min.js'), 'export const notSystemJS = true;\n');
  refreshBuild(options);
  assertPreflightRejected(options);
  copy(join(realSource, 'dist/index.system.min.js'), join(options.source, 'restored-system.js'));
  fs.renameSync(join(options.source, 'restored-system.js'), join(options.source, 'dist/index.system.min.js'));
  write(join(options.source, 'lib/assets/images/scene.png'), 'not the original PNG\n');
  refreshBuild(options);
  assertPreflightRejected(options);
});

for (const path of ['src/index.ts', 'dist/assets/type/types.txt', 'package.json']) {
  test(`published ${path} drift invalidates provenance without modifying either snapshot`, t => {
    const options = fixture(t);
    if (path === 'package.json') {
      editJson(join(options.published, path), value => { value.gitHead = '0'.repeat(40); });
    } else fs.appendFileSync(join(options.published, path), '\nchanged published bytes\n');
    assertPreflightRejected(options);
  });
}

test('source differences outside the recorded type and worker-path fixes remain rejected after resealing', t => {
  const options = fixture(t);
  fs.appendFileSync(join(options.source, 'src/index.ts'), '\nexport const unexpected = true;\n');
  refreshBuild(options);
  editJson(buildReceiptPath(options.source), value => {
    value.provenance.differences.push('src/index.ts');
  });
  assertPreflightRejected(options);
});

for (const kind of ['directory', 'file', 'symlink', 'dangling symlink']) {
  test(`existing candidate ${kind} is never overwritten`, t => {
    const options = fixture(t);
    fs.mkdirSync(dirname(options.output), { recursive: true });
    if (kind === 'directory') write(join(options.output, 'sentinel'), 'keep original\n');
    else if (kind === 'file') write(options.output, 'keep original\n');
    else fs.symlinkSync(kind === 'symlink' ? options.source : join(options.workspace, 'missing'),
      options.output);
    const before = evidence(options);
    assert.throws(() => prepareNativeAiCodeDeployment(options), /overwritten|exist/i);
    if (kind === 'directory') {
      assert.equal(fs.readFileSync(join(options.output, 'sentinel'), 'utf8'), 'keep original\n');
    } else if (kind === 'file') assert.equal(fs.readFileSync(options.output, 'utf8'), 'keep original\n');
    else assert.equal(fs.lstatSync(options.output).isSymbolicLink(), true);
    assert.deepEqual(evidence(options), before);
  });
}

test('output must be a fresh direct child of the dedicated workspace artifact root', t => {
  const options = fixture(t);
  const before = evidence(options);
  for (const output of [
    dirname(options.output), join(options.output, 'nested'), options.source,
    join(options.workspace, 'outside'), join(options.workspace, '../escape'),
  ]) {
    assert.throws(() => prepareNativeAiCodeDeployment({ ...options, output }));
  }
  assert.equal(fs.existsSync(dirname(options.output)), false);
  assert.deepEqual(evidence(options), before);
});

test('staging retains private candidate modes without claiming web-server readiness', t => {
  const options = fixture(t);
  const receipt = prepareNativeAiCodeDeployment(options);
  assertNotAccepted(receipt);
  assert.equal(fs.statSync(options.output).mode & 0o777, 0o700);
  assert.equal(fs.statSync(join(options.output, 'plugins')).mode & 0o777, 0o700);
  for (const entry of tree(options.output).entries) {
    assert.equal(fs.statSync(join(options.output, entry.path)).mode & 0o777, 0o600, entry.path);
  }
});

for (const component of ['.artifacts', '.artifacts/native-ai-code-deployment']) {
  test(`symlinked output ancestor ${component} is rejected without following the link`, t => {
    const options = fixture(t);
    const target = join(options.workspace, 'external');
    fs.mkdirSync(target);
    fs.mkdirSync(dirname(join(options.workspace, component)), { recursive: true });
    fs.symlinkSync(target, join(options.workspace, component));
    const before = evidence(options);
    assert.throws(() => prepareNativeAiCodeDeployment(options), /Symlink/);
    assert.deepEqual(fs.readdirSync(target), []);
    assert.deepEqual(evidence(options), before);
  });
}

for (const [root, name] of [
  ['source', 'package.json'], ['source', 'src'], ['source', '.artifacts/build-receipt.json'],
  ['published', 'src'], ['published', 'dist/assets'],
]) {
  test(`symlinked ${root} ${name} is rejected without following or modifying its target`, t => {
    const options = fixture(t);
    const target = join(options[root], name);
    const moved = join(options.workspace, 'moved-evidence');
    fs.renameSync(target, moved);
    fs.symlinkSync(moved, target);
    const before = fs.lstatSync(moved).isDirectory() ? tree(moved).entries : fs.readFileSync(moved);
    assert.throws(() => prepareNativeAiCodeDeployment(options), /Symlink/);
    assert.equal(fs.existsSync(options.output), false);
    assert.deepEqual(fs.lstatSync(moved).isDirectory() ? tree(moved).entries : fs.readFileSync(moved), before);
  });
}

test('an ancestor link cannot redirect source reads through an alias workspace', t => {
  const options = fixture(t);
  const alias = join(options.workspace, 'alias');
  fs.symlinkSync(options.workspace, alias);
  const before = evidence(options);
  assert.throws(() => prepareNativeAiCodeDeployment({
    ...options, source: join(alias, relative(options.workspace, options.source)),
  }), /Symlink/);
  assert.equal(fs.existsSync(options.output), false);
  assert.deepEqual(evidence(options), before);
});

for (const path of ['dist/index.system.min.js', 'package.json']) {
  test(`verification rejects changed deployed ${path} without repairing the candidate`, t => {
    const options = fixture(t);
    prepareNativeAiCodeDeployment(options);
    fs.appendFileSync(join(options.output, 'plugins', repo, path), '\nchanged deployed bytes\n');
    const before = { evidence: evidence(options), candidate: tree(options.output).entries };
    assert.throws(() => verify(options));
    assert.deepEqual({ evidence: evidence(options), candidate: tree(options.output).entries }, before);
  });
}

for (const [root, path] of [
  ['source', 'src/index.ts'], ['source', 'es/index.mjs'],
  ['source', '.artifacts/build-receipt.json'], ['published', 'src/index.ts'],
]) {
  test(`verification rejects stale ${root} ${path} evidence without changing the receipt`, t => {
    const options = fixture(t);
    prepareNativeAiCodeDeployment(options);
    fs.appendFileSync(join(options[root], path), '\n');
    const before = { evidence: evidence(options), candidate: tree(options.output).entries };
    assert.throws(() => verify(options));
    assert.deepEqual({ evidence: evidence(options), candidate: tree(options.output).entries }, before);
  });
}

for (const path of [
  `plugins/${repo}/dist/unrecorded.js`, `plugins/${repo}/src/index.ts`,
  `plugins/${repo}/node_modules/extra.mjs`, 'plugins/@other/plugin@1.0.0/index.js', '.receipt.tmp',
]) {
  test(`verification rejects extra candidate file ${path}`, t => {
    const options = fixture(t);
    prepareNativeAiCodeDeployment(options);
    write(join(options.output, path), 'unrecorded deployment file\n');
    const before = { evidence: evidence(options), candidate: tree(options.output).entries };
    assert.throws(() => verify(options));
    assert.deepEqual({ evidence: evidence(options), candidate: tree(options.output).entries }, before);
  });
}

for (const [name, edit] of [
  ['schema', value => { value.schemaVersion = 2; }],
  ['contract', value => { value.contract = 'accepted-source-build'; }],
  ['prepared status', value => { value.status = 'accepted'; }],
  ['production acceptance', value => { value.acceptedForProduction = true; }],
  ['repository authentication', value => { value.originalRepositoryAuthenticated = true; }],
  ['native compatibility', value => { value.mapping.compatibility = 'verified'; }],
  ['requested native version', value => { value.mapping.requested = value.mapping.candidate; }],
  ['dependency source builds', value => { value.dependencies.ibizDependencySourceBuildsVerified = true; }],
  ['source input hash', value => { value.source.inputs[0].sha256 = '0'.repeat(64); }],
  ['omitted source input', value => { value.source.inputs.pop(); }],
  ['build output hash', value => { value.build.outputs[0].sha256 = '0'.repeat(64); }],
  ['omitted build output', value => { value.build.outputs.pop(); }],
  ['deployed file hash', value => { value.deployment.entries[0].sha256 = '0'.repeat(64); }],
  ['omitted deployed entry', value => { value.deployment.entries.pop(); }],
  ['duplicated deployed entry', value => { value.deployment.entries.push(value.deployment.entries[0]); }],
  ['deployment path traversal', value => { value.deployment.path = '../outside'; }],
  ['deployed entry traversal', value => { value.deployment.entries[0].path = '../outside'; }],
  ['generation time', value => { value.generatedAt = 'not-a-date'; }],
  ['unknown acceptance evidence', value => { value.runtimeAccepted = true; }],
]) {
  test(`verification rejects tampered ${name} evidence read-only`, t => {
    const options = fixture(t);
    prepareNativeAiCodeDeployment(options);
    editJson(join(options.output, 'receipt.json'), edit);
    const before = { evidence: evidence(options), candidate: tree(options.output).entries };
    assert.throws(() => verify(options));
    assert.deepEqual({ evidence: evidence(options), candidate: tree(options.output).entries }, before);
  });
}

for (const name of ['receipt.json', 'plugins', `plugins/${repo}/dist`]) {
  test(`verification rejects symlinked candidate ${name} without modifying its target`, t => {
    const options = fixture(t);
    prepareNativeAiCodeDeployment(options);
    const target = join(options.output, name);
    const moved = join(options.workspace, 'moved-candidate');
    fs.renameSync(target, moved);
    fs.symlinkSync(moved, target);
    const before = fs.lstatSync(moved).isDirectory() ? tree(moved).entries : fs.readFileSync(moved);
    assert.throws(() => verify(options), /Symlink/);
    assert.deepEqual(fs.lstatSync(moved).isDirectory() ? tree(moved).entries : fs.readFileSync(moved), before);
  });
}

test('missing, malformed and misplaced deployment receipts fail closed', t => {
  const options = fixture(t);
  prepareNativeAiCodeDeployment(options);
  assert.throws(() => verifyNativeAiCodeDeployment(options));
  for (const receipt of [
    join(options.workspace, 'receipt.json'), join(options.output, 'other.json'),
    join(options.output, 'nested/receipt.json'), join(dirname(options.output), 'missing/receipt.json'),
  ]) {
    assert.throws(() => verifyNativeAiCodeDeployment({ ...options, receipt }));
  }
  const receipt = join(options.output, 'receipt.json');
  fs.writeFileSync(receipt, '{"truncated":');
  const before = tree(options.output).entries;
  assert.throws(() => verify(options), SyntaxError);
  assert.deepEqual(tree(options.output).entries, before);
});

for (const phase of ['output write', 'receipt open', 'receipt write']) {
  test(`${phase} failure retains partial candidate evidence and leaves originals unchanged`, t => {
    const options = fixture(t);
    const before = evidence(options);
    const descriptors = fs.readdirSync('/proc/self/fd').length;
    let injected = false;
    if (phase === 'receipt open') {
      const open = fs.openSync;
      t.mock.method(fs, 'openSync', (path, flags, ...args) => {
        if (!injected && (flags & fs.constants.O_CREAT) && path.endsWith('/receipt.json')) {
          injected = true;
          throw new Error('Injected deployment publication failure');
        }
        return open(path, flags, ...args);
      });
    } else {
      const original = fs.writeFileSync;
      t.mock.method(fs, 'writeFileSync', (path, data, ...args) => {
        const target = openedPath(path);
        const selected = phase === 'receipt write'
          ? target === join(options.output, 'receipt.json')
          : target.startsWith(join(options.output, 'plugins'));
        if (!injected && selected) {
          injected = true;
          original(path, phase === 'receipt write' ? '{"truncated":' : 'partial copy', ...args);
          throw new Error('Injected deployment publication failure');
        }
        return original(path, data, ...args);
      });
    }
    try {
      assert.throws(() => prepareNativeAiCodeDeployment(options), /Injected deployment publication failure/);
      assert.equal(injected, true);
    } finally { t.mock.reset(); }
    assert.equal(fs.existsSync(options.output), true);
    if (phase === 'receipt write') {
      assert.equal(fs.readFileSync(join(options.output, 'receipt.json'), 'utf8'), '{"truncated":');
    } else assert.equal(fs.existsSync(join(options.output, 'receipt.json')), false);
    const candidateBefore = tree(options.output).entries;
    assert.throws(() => verify(options));
    assert.deepEqual(tree(options.output).entries, candidateBefore);
    assert.deepEqual(evidence(options), before);
    assert.equal(fs.readdirSync('/proc/self/fd').length, descriptors);
    assert.throws(() => prepareNativeAiCodeDeployment(options), /overwritten|exist/i);
    assert.deepEqual(tree(options.output).entries, candidateBefore);
  });
}

test('copied byte drift is retained and rejected before publishing a receipt', t => {
  const options = fixture(t);
  const before = evidence(options);
  const original = fs.writeFileSync;
  let injected = false;
  t.mock.method(fs, 'writeFileSync', (path, data, ...args) => {
    if (!injected && openedPath(path).startsWith(join(options.output, 'plugins'))) {
      injected = true;
      return original(path, 'corrupted candidate bytes', ...args);
    }
    return original(path, data, ...args);
  });
  try {
    assert.throws(() => prepareNativeAiCodeDeployment(options));
    assert.equal(injected, true);
  } finally { t.mock.reset(); }
  assert.equal(fs.existsSync(options.output), true);
  assert.equal(fs.existsSync(join(options.output, 'receipt.json')), false);
  assert.throws(() => verify(options));
  assert.deepEqual(evidence(options), before);
});

test('CLI help and invalid arguments never prepare or accept a deployment', () => {
  for (const [args, expected] of [
    [['--help'], 0],
    [['--output', 'candidate', '--verify-receipt', 'receipt.json'], 1],
    [['--output'], 1], [['--verify-receipt'], 1], [['--unknown'], 1],
  ]) {
    const result = spawnSync(process.execPath, [tool, ...args], {
      cwd: workspaceRoot, encoding: 'utf8', timeout: 30_000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, expected, `${args.join(' ')}: ${result.stderr}`);
  }
  assert.equal(typeof main, 'function');
});

test('CLI prepare and verify exit 2, not acceptance; invalid evidence exits 1', t => {
  const output = join(workspaceRoot, '.artifacts/native-ai-code-deployment',
    `test-cli-${process.pid}-${randomUUID()}`);
  t.after(() => fs.rmSync(output, { recursive: true, force: true }));
  const sourceBefore = entriesFor(realSource, [...inputRoots, ...outputRoots]);
  const publishedBefore = entriesFor(realPublished, ['package.json', 'src', 'dist/assets']);
  const run = args => {
    const result = spawnSync(process.execPath, [tool, ...args], {
      cwd: workspaceRoot, encoding: 'utf8', timeout: 30_000,
    });
    assert.equal(result.error, undefined);
    return result;
  };
  const prepared = run(['--output', output]);
  assert.equal(prepared.status, 2, prepared.stderr);
  const receipt = JSON.parse(prepared.stdout);
  assert.equal(receipt.status, 'prepared-not-accepted');
  assertNotAccepted(receipt);
  const candidateBefore = tree(output).entries;
  const checked = run(['--verify-receipt', join(output, 'receipt.json')]);
  assert.equal(checked.status, 2, checked.stderr);
  const verified = JSON.parse(checked.stdout);
  assert.equal(verified.status, 'verified-deployment-not-accepted');
  assert.equal(verified.deploymentIntegrityVerified, true);
  assertNotAccepted(verified);
  assert.deepEqual(tree(output).entries, candidateBefore);
  assert.equal(run(['--output', output]).status, 1, 'An existing candidate must not be overwritten');
  assert.deepEqual(tree(output).entries, candidateBefore);
  editJson(join(output, 'receipt.json'), value => { value.acceptedForProduction = true; });
  const rejectedBefore = tree(output).entries;
  assert.equal(run(['--verify-receipt', join(output, 'receipt.json')]).status, 1);
  assert.deepEqual(tree(output).entries, rejectedBefore);
  assert.deepEqual(entriesFor(realSource, [...inputRoots, ...outputRoots]), sourceBefore);
  assert.deepEqual(entriesFor(realPublished, ['package.json', 'src', 'dist/assets']), publishedBefore);
  assert.deepEqual(fs.readFileSync(buildReceiptPath(realSource)), originalBuildReceiptBytes);
});
