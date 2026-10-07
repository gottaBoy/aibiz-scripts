import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, symlinkSync, truncateSync, utimesSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  sourceBuildInputs, verifyCommittedSource, verifyRecordedBuildInputs,
} from '../source-build-identity.mjs';
import {
  auditUaaTaskReadiness, main, ownSourceBytecodeClosureReadiness, verifyServiceBuildEvidence,
  observeStandaloneUaaRuntime,
  verifyTaskOwnSourceClosureEvidence,
  standaloneUaaEditableSourceReadiness, standaloneUaaProtocolClosureReadiness,
  STANDALONE_UAA_EDITABLE_INPUTS,
} from '../harness-uaa-task-readiness.mjs';

const scriptsRoot = resolve(import.meta.dirname, '..');
const harness = resolve(scriptsRoot, 'harness-uaa-task-readiness.mjs');
const workspaceRoot = resolve(scriptsRoot, '..');
const taskClosureRoot = join(workspaceRoot,
  'task7/.artifacts/task7-independent-compiler-SyMo3p');

function runHarness(t) {
  const directory = mkdtempSync(join(tmpdir(), 'uaa-readiness-report-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return runHarnessWithReport(join(directory, 'readiness.json'));
}

function runHarnessWithReport(reportPath) {
  const result = spawnSync(process.execPath, [harness], {
    cwd: scriptsRoot,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, UAA_TASK_READINESS_REPORT: reportPath },
  });
  assert.equal(result.error, undefined);
  const report = JSON.parse(result.stdout);
  const ready = report.readiness.uaa32666 && report.readiness.task30088;
  assert.equal(result.status, ready ? 0 : 1);
  return report;
}

test('UAA and Task readiness gate reports both services separately', t => {
  const report = runHarness(t);
  assert.equal(report.contract, 'uaa-task-own-source-readiness');
  assert.equal(report.nativeAcceptance, false);
  assert.equal(report.compilerBuildInDockerVerified, false);
  for (const service of ['uaa32666', 'task30088']) {
    assert.match(report.sourceBuildEvidence[service].currentInputs.fingerprint, /^[a-f0-9]{64}$/);
    assert.ok(report.sourceBuildEvidence[service].currentInputs.files > 0);
  }
  assert.equal(typeof report.readiness.uaa32666, 'boolean');
  assert.equal(typeof report.readiness.task30088, 'boolean');
  assert.ok(report.services.uaa32666.some((item) => item.id === 'uaa-source-build-evidence'));
  assert.ok(report.services.uaa32666.some((item) => item.id === 'uaa-source-image-evidence'));
  assert.ok(report.services.uaa32666.some((item) => item.id === 'uaa-source-identity'));
  assert.ok(report.services.uaa32666.some((item) => item.id === 'uaa-source-build-inputs'));
  assert.ok(report.services.uaa32666.some((item) => item.id === 'uaa-standalone-auth-source'));
  assert.equal(report.services.uaa32666.find(
    item => item.id === 'uaa-standalone-auth-protocol-closure').status, 'blocked');
  assert.equal(report.sourceBuildEvidence.uaa32666.standaloneAuthSource.target, 'uaa-standalone-sys-person');
  assert.equal(report.sourceBuildEvidence.uaa32666.standaloneAuthProtocol.state, 'unverified');
  assert.ok(report.services.uaa32666.some(item => item.id === 'uaa-standalone-runtime-binding'));
  assert.equal(report.runtimeTargetObservation.evidence.nativeAcceptance, false);
  assert.equal(report.runtimeTargetObservation.evidence.sourceRuntimeCompatible, false);
  assert.equal(report.runtimeTargetObservation.evidence.effectivePasswordEncoderVerified, false);
  assert.ok(report.services.task30088.some((item) => item.id === 'task-local-dependencies'));
  assert.ok(report.services.task30088.some((item) => item.id === 'task-war-assembly'));
  assert.ok(report.services.task30088.some((item) => item.id === 'task-source-identity'));
  assert.ok(report.services.task30088.some((item) => item.id === 'task-source-build-inputs'));
  for (const [service, ready] of Object.entries(report.readiness)) {
    assert.equal(ready, report.services[service].every((item) => item.status === 'pass'));
  }
});

test('readiness gate only marks UAA ready with hash-verified source evidence', t => {
  const report = runHarness(t);
  const sourceBuild = report.checks.find((item) => item.id === 'uaa-source-build-evidence');
  if (sourceBuild.status === 'pass') {
    assert.match(
      sourceBuild.reason,
      /current UAA source commit.*produced.*hash-verified artifact.*does not prove standalone sys_person/i,
    );
  } else {
    assert.match(sourceBuild.reason, /prebuilt image is not accepted/);
  }
});

function sourceFixture(t, { source = 'class Source {}\n' } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'source-identity-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = args => execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
  git(['init', '-q']);
  git(['config', 'user.name', 'Controlled Harness Fixture']);
  git(['config', 'user.email', 'fixture@localhost']);
  writeFileSync(join(root, '.gitignore'), '.artifacts/\ntarget/\nignored.jar\n');
  writeFileSync(join(root, 'Source.java'), source);
  git(['add', '.']);
  git(['commit', '-qm', 'controlled source identity fixture, not native build evidence']);
  return { root, git, commit: git(['rev-parse', 'HEAD']) };
}

test('source identity verifies the actual clean commit, not an unknown or stale receipt', t => {
  const { root, commit } = sourceFixture(t);
  assert.equal(verifyCommittedSource(root, commit).ok, true);
  assert.equal(verifyCommittedSource(root, 'unknown').ok, false);
  assert.equal(verifyCommittedSource(root, '0'.repeat(40)).ok, false);
});

for (const [name, path] of [
  ['tracked implementation drift', 'Source.java'],
  ['untracked implementation', 'Other.java'],
]) {
  test(`commit-only source evidence rejects ${name} without a HEAD change`, t => {
    const { root, commit } = sourceFixture(t);
    writeFileSync(join(root, path), 'class Changed {}\n');
    const result = verifyCommittedSource(root, commit);
    assert.equal(result.ok, false);
    assert.match(result.reason, /modified or untracked/);
  });
}

test('Git lookup failures and unknown/empty commits never become source evidence', () => {
  for (const value of ['', 'unknown']) {
    assert.equal(verifyCommittedSource('/unused', value, () => value).ok, false);
  }
  assert.equal(verifyCommittedSource('/unused', 'unknown', () => {
    throw new Error('controlled Git failure');
  }).ok, false);
});

test('commit-only legacy receipts cannot stand in for actual build input inventories', t => {
  const { root, commit } = sourceFixture(t);
  const result = verifyRecordedBuildInputs(root, { status: 'ready', commit });
  assert.equal(result.ok, false);
  assert.match(result.reason, /commit-only receipts are insufficient/);
});

test('controlled build-time inventories match independently read implementation and build inputs', t => {
  const { root } = sourceFixture(t);
  const inputs = sourceBuildInputs(root);
  const receipt = { sourceInputs: { contract: 'source-build-input-inventory-v1', before: inputs, after: inputs } };
  assert.equal(verifyRecordedBuildInputs(root, receipt).ok, true);
  assert.ok(inputs.entries.some(entry => entry.path === 'Source.java'));
  assert.equal(inputs.entries.some(entry => entry.path.startsWith('.git/')), false);
  writeFileSync(join(root, 'Source.java'), 'class BuildTimeDrift {}\n');
  assert.equal(verifyRecordedBuildInputs(root, receipt).ok, false);
});

for (const [name, change] of [
  ['post-build inventory omitted', receipt => { delete receipt.sourceInputs.after; }],
  ['pre-build inventory omitted', receipt => { delete receipt.sourceInputs.before; }],
  ['forged source fingerprint', receipt => { receipt.sourceInputs.before.fingerprint = '0'.repeat(64); }],
  ['invented inventory entries', receipt => { receipt.sourceInputs.before.entries = []; }],
]) {
  test(`source build inventory rejects ${name}`, t => {
    const { root } = sourceFixture(t);
    const inputs = sourceBuildInputs(root);
    const receipt = structuredClone({ sourceInputs: {
      contract: 'source-build-input-inventory-v1', before: inputs, after: inputs,
    } });
    change(receipt);
    assert.equal(verifyRecordedBuildInputs(root, receipt).ok, false);
  });
}

test('ignored dependency implementations and executable modes are tracked despite a clean Git tree', t => {
  const { root, git } = sourceFixture(t);
  writeFileSync(join(root, '.gitignore'), '.artifacts/\ntarget/\nlocal.jar\n');
  git(['add', '.gitignore']);
  git(['commit', '-qm', 'ignore controlled dependency fixture']);
  const commit = git(['rev-parse', 'HEAD']);
  const inputs = sourceBuildInputs(root);
  const receipt = { sourceInputs: { contract: 'source-build-input-inventory-v1', before: inputs, after: inputs } };
  writeFileSync(join(root, 'local.jar'), 'controlled dependency bytes, not a real JAR');
  assert.equal(verifyCommittedSource(root, commit).ok, true);
  assert.equal(verifyRecordedBuildInputs(root, receipt).ok, false);
  rmSync(join(root, 'local.jar'));
  chmodSync(join(root, 'Source.java'), 0o755);
  assert.equal(verifyRecordedBuildInputs(root, receipt).ok, false);
  assert.equal(verifyCommittedSource(root, commit).ok, false);
});

test('generated build outputs are excluded narrowly; source symlinks never become input evidence', t => {
  const { root } = sourceFixture(t);
  const options = { generatedArtifacts: ['ibzuaa.jar'] };
  const inputs = sourceBuildInputs(root, options);
  const receipt = { sourceInputs: { contract: 'source-build-input-inventory-v1', before: inputs, after: inputs } };
  mkdirSync(join(root, 'target'));
  writeFileSync(join(root, 'target', 'compiled.class'), 'controlled generated bytes');
  writeFileSync(join(root, 'ibzuaa.jar'), 'controlled generated JAR');
  assert.equal(verifyRecordedBuildInputs(root, receipt, options).ok, true);
  symlinkSync(join(root, 'Source.java'), join(root, 'Symlink.java'));
  assert.equal(verifyRecordedBuildInputs(root, receipt, options).ok, false);
});

test('readiness report creates missing parent directories for explicit paths', () => {
  const directory = mkdtempSync(join(tmpdir(), 'uaa-readiness-report-'));
  const reportPath = join(directory, 'nested', 'readiness.json');
  try {
    const report = runHarnessWithReport(reportPath);
    assert.deepEqual(JSON.parse(readFileSync(reportPath, 'utf8')), report);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

function buildEvidenceFixture(t, options = {}) {
  const { root, commit, git } = sourceFixture(t, options);
  const directory = join(root, '.artifacts', 'source-build');
  mkdirSync(directory, { recursive: true });
  const artifactPath = join(directory, 'controlled.jar');
  const receiptPath = join(directory, 'source-build.json');
  const data = 'controlled output bytes, not native compiler evidence';
  writeFileSync(artifactPath, data);
  const inputs = sourceBuildInputs(root);
  const receipt = {
    status: 'ready', exitCode: 0, platform: 'linux/arm64', commit, artifact: artifactPath,
    sha256: createHash('sha256').update(data).digest('hex'),
    imageTag: 'fixture/image:controlled', imageId: `sha256:${'a'.repeat(64)}`,
    sourceInputs: { contract: 'source-build-input-inventory-v1', before: inputs, after: inputs },
  };
  const save = () => writeFileSync(receiptPath, JSON.stringify(receipt));
  save();
  const execute = (_command, args, options) => {
    assert.equal(_command, 'docker');
    assert.deepEqual(args, [
      'image', 'inspect', '--format', '{{.Id}} {{.Os}}/{{.Architecture}}', '--', receipt.imageTag,
    ]);
    assert.equal(options.timeout, 10_000);
    return `${receipt.imageId} linux/arm64\n`;
  };
  return { root, artifactPath, receiptPath, receipt, save, execute, git };
}

test('controlled image identity verifies current hashed inputs but is not Docker compiler evidence', t => {
  const fixture = buildEvidenceFixture(t);
  const result = verifyServiceBuildEvidence(fixture);
  assert.equal(result.artifactReady, true);
  assert.equal(result.imageReady, true);
  assert.equal(result.evidence.receiptState, 'verified-current-inputs');
  assert.match(result.evidence.receiptSha256, /^[a-f0-9]{64}$/);
  assert.equal(result.evidence.currentInputs.fingerprint, fixture.receipt.sourceInputs.before.fingerprint);
  assert.equal(result.evidence.recordedSourceCommit, fixture.receipt.commit);
  assert.equal(result.evidence.knownStubAudit.currentInputFingerprint,
    result.evidence.currentInputs.fingerprint);
  assert.deepEqual(result.evidence.sourceImageObservation, {
    contract: 'source-image-identity-observation-v1', state: 'observed-identity-only',
    verification: 'image-identity-only-not-compiler-or-artifact-binding',
    evidenceOrigin: 'controlled-runner-not-native-evidence',
    currentInputFingerprint: result.evidence.currentInputs.fingerprint,
    sourceCommit: fixture.receipt.commit, artifactSha256: fixture.receipt.sha256,
    imageTag: fixture.receipt.imageTag, imageId: fixture.receipt.imageId,
    platform: 'linux/arm64', observations: 2,
  });
  assert.equal(result.compilerBuildInDockerVerified, undefined);
});

function liveTaskEvidenceFixture() {
  liveTaskEvidenceFixture.cache ??= verifyServiceBuildEvidence({
    root: join(workspaceRoot, 'task7'),
    receiptPath: join(workspaceRoot, 'task7/.artifacts/source-build/source-build.json'),
    artifactPath: join(workspaceRoot, 'task7/.artifacts/source-build/SAPAAS.war'),
  });
  return structuredClone(liveTaskEvidenceFixture.cache);
}

function taskClosureFixture() {
  return {
    taskEvidence: liveTaskEvidenceFixture(),
    buildReceiptPath: join(workspaceRoot,
      'task7/.artifacts/source-build/source-build.json'),
    inputScreenPath: join(taskClosureRoot, 'current-input-screen.json'),
    inputClosurePath: join(taskClosureRoot, 'input-screen.json'),
    warBindingPath: join(taskClosureRoot, 'war-output-binding.json'),
  };
}

test('live Task WAR closure binds current source, inputs, outputs and artifact hash', () => {
  const result = verifyTaskOwnSourceClosureEvidence(taskClosureFixture());
  assert.equal(result.ok, true);
  assert.equal(result.evidence.status, 'pass');
  assert.equal(result.evidence.scopedOwnSourceClosureVerified, true);
  assert.equal(result.evidence.fullSourceClosureVerified, false);
  assert.equal(result.evidence.nativeAcceptance, false);
  assert.equal(result.evidence.sourceFingerprint,
    'e86d96999ee1da9a55d2ac303d8b2e2b57673141ecb5ab3097f7f2093200ff4f');
  assert.equal(result.evidence.buildCommit,
    '2798cec3af49f778b0c72d40f4815d262611d8fa');
  assert.equal(result.evidence.warSha256,
    '5a2d677abbddef872ff240c585ef80e1016cdf317fa293cb4aaac718d997e103');
  assert.equal(result.evidence.classes, 40506);
  assert.equal(result.evidence.jars, 213);
});

for (const [name, mutate] of [
  ['missing build receipt', fixture => { delete fixture.buildReceiptPath; }],
  ['missing input screen', fixture => { delete fixture.inputScreenPath; }],
  ['missing input closure', fixture => { delete fixture.inputClosurePath; }],
  ['missing WAR binding', fixture => { delete fixture.warBindingPath; }],
  ['stale build evidence', fixture => {
    fixture.taskEvidence.evidence.currentInputs.fingerprint = 'a'.repeat(64);
  }],
  ['wrong WAR hash', fixture => {
    fixture.taskEvidence.evidence.artifactSha256 = 'b'.repeat(64);
  }],
  ['wrong build commit', fixture => {
    fixture.taskEvidence.evidence.recordedSourceCommit = 'c'.repeat(40);
  }],
  ['image not ready', fixture => { fixture.taskEvidence.imageReady = false; }],
]) {
  test(`Task WAR closure rejects ${name}`, () => {
    const fixture = taskClosureFixture();
    mutate(fixture);
    const result = verifyTaskOwnSourceClosureEvidence(fixture);
    assert.equal(result.ok, false);
    assert.equal(result.evidence.status, 'fail');
    assert.equal(result.evidence.nativeAcceptance, false);
  });
}

for (const [name, recheck] of [
  ['tag rebound to another image', () => `sha256:${'b'.repeat(64)} linux/arm64\n`],
  ['platform changed', () => `sha256:${'a'.repeat(64)} linux/amd64\n`],
  ['image removed', () => { throw new Error('controlled removed image'); }],
  ['recheck timed out', () => { throw Object.assign(new Error('controlled timeout'), { code: 'ETIMEDOUT' }); }],
]) {
  test(`source image gate rejects ${name} after the first successful observation`, t => {
    const fixture = buildEvidenceFixture(t);
    let calls = 0;
    const result = verifyServiceBuildEvidence({
      ...fixture, execute(...args) {
        return ++calls === 1 ? fixture.execute(...args) : recheck();
      },
    });
    assert.equal(calls, 2, 'A single tag observation cannot establish current image identity');
    assert.equal(result.artifactReady, true, 'Image failure does not invalidate stable artifact bytes');
    assert.equal(result.imageReady, false);
    assert.equal(result.evidence.sourceImageObservation.state, 'unverified');
    assert.equal(result.evidence.sourceImageObservation.imageId, undefined);
  });
}

for (const [name, change] of [
  ['ignored dependency', fixture => writeFileSync(join(fixture.root, 'ignored.jar'), 'recheck dependency drift')],
  ['receipt', fixture => { fixture.receipt.exitCode = 1; fixture.save(); }],
  ['artifact', fixture => writeFileSync(fixture.artifactPath, 'recheck artifact drift')],
]) {
  test(`source evidence rejects ${name} drift during the final image observation`, t => {
    const fixture = buildEvidenceFixture(t);
    let calls = 0;
    const result = verifyServiceBuildEvidence({
      ...fixture, execute(...args) {
        if (++calls === 2) change(fixture);
        return fixture.execute(...args);
      },
    });
    assert.equal(calls, 2);
    assert.equal(result.artifactReady, false);
    assert.equal(result.imageReady, false);
    assert.equal(result.evidence.receiptState, 'missing-malformed-or-changed');
    assert.equal(result.evidence.sourceImageObservation.state, 'unverified');
  });
}

for (const [name, change] of [
  ['missing receipt', fixture => rmSync(fixture.receiptPath)],
  ['malformed receipt', fixture => writeFileSync(fixture.receiptPath, '{')],
  ['legacy commit-only receipt', fixture => { delete fixture.receipt.sourceInputs; fixture.save(); }],
  ['missing compiler exit', fixture => { delete fixture.receipt.exitCode; fixture.save(); }],
  ['nonzero compiler exit', fixture => { fixture.receipt.exitCode = 1; fixture.save(); }],
  ['string compiler exit', fixture => { fixture.receipt.exitCode = '0'; fixture.save(); }],
  ['boolean compiler exit', fixture => { fixture.receipt.exitCode = false; fixture.save(); }],
  ['missing build platform', fixture => { delete fixture.receipt.platform; fixture.save(); }],
  ['wrong build platform', fixture => { fixture.receipt.platform = 'linux/amd64'; fixture.save(); }],
  ['wrong artifact path', fixture => { fixture.receipt.artifact += '.other'; fixture.save(); }],
  ['artifact hash drift', fixture => writeFileSync(fixture.artifactPath, 'drift')],
  ['artifact symlink', fixture => {
    renameSync(fixture.artifactPath, `${fixture.artifactPath}.outside`);
    symlinkSync(`${fixture.artifactPath}.outside`, fixture.artifactPath);
  }],
  ['receipt symlink', fixture => {
    renameSync(fixture.receiptPath, `${fixture.receiptPath}.outside`);
    symlinkSync(`${fixture.receiptPath}.outside`, fixture.receiptPath);
  }],
  ['receipt ancestor symlink', fixture => {
    const directory = join(fixture.root, '.artifacts', 'source-build');
    renameSync(directory, `${directory}.outside`);
    symlinkSync(`${directory}.outside`, directory);
  }],
]) {
  test(`source readiness rejects ${name} before invoking Docker`, t => {
    const fixture = buildEvidenceFixture(t);
    change(fixture);
    let calls = 0;
    const result = verifyServiceBuildEvidence({
      ...fixture, execute() { calls++; return `${fixture.receipt.imageId} linux/arm64`; },
    });
    assert.equal(calls, 0, 'Rejected build evidence must not inspect Docker');
    assert.equal(result.artifactReady, false);
    assert.equal(result.imageReady, false);
  });
}

for (const [name, change] of [
  ['tracked source drift', fixture => writeFileSync(join(fixture.root, 'Source.java'), 'class Drift {}\n')],
  ['ignored dependency drift', fixture => writeFileSync(join(fixture.root, 'ignored.jar'), 'dependency drift')],
  ['receipt replacement', fixture => { fixture.receipt.commit = '0'.repeat(40); fixture.save(); }],
  ['artifact drift', fixture => writeFileSync(fixture.artifactPath, 'drift')],
]) {
  test(`source readiness rejects ${name} occurring after initial verification`, t => {
    const fixture = buildEvidenceFixture(t);
    const result = verifyServiceBuildEvidence({
      ...fixture, execute(...args) {
        change(fixture);
        return fixture.execute(...args);
      },
    });
    assert.equal(result.artifactReady, false);
    assert.equal(result.imageReady, false);
    assert.equal(result.evidence.receiptState, 'missing-malformed-or-changed');
  });
}

for (const [name, execute] of [
  ['Docker inspect failure', () => { throw new Error('controlled Docker failure'); }],
  ['Docker inspect timeout', () => { throw Object.assign(new Error('controlled timeout'), { code: 'ETIMEDOUT' }); }],
  ['wrong image digest', () => `sha256:${'b'.repeat(64)} linux/arm64`],
  ['wrong platform', () => `sha256:${'a'.repeat(64)} linux/amd64`],
  ['malformed inspect output', () => 'claimed pass'],
]) {
  test(`${name} never passes the image gate`, t => {
    const fixture = buildEvidenceFixture(t);
    const result = verifyServiceBuildEvidence({ ...fixture, execute });
    assert.equal(result.artifactReady, true);
    assert.equal(result.imageReady, false);
  });
}

test('option-like image references are rejected before Docker inspection', t => {
  const fixture = buildEvidenceFixture(t);
  fixture.receipt.imageTag = '--format=claimed';
  fixture.save();
  let calls = 0;
  const result = verifyServiceBuildEvidence({
    ...fixture, execute() { calls++; return `${fixture.receipt.imageId} linux/arm64`; },
  });
  assert.equal(calls, 0, 'Unsafe image reference must not reach Docker');
  assert.equal(result.artifactReady, true);
  assert.equal(result.imageReady, false);
});

test('missing source roots fail closed rather than inventing current-input evidence', t => {
  const fixture = buildEvidenceFixture(t);
  const result = verifyServiceBuildEvidence({ ...fixture, root: join(fixture.root, 'missing') });
  assert.equal(result.artifactReady, false);
  assert.equal(result.imageReady, false);
  assert.equal(result.evidence.currentInputs, undefined);
});

test('readiness CLI rejects unknown modes, supplied receipts and implicit skip flags', () => {
  for (const args of [['--mode', 'off'], ['--receipt', 'fixture.json'], ['--skip-task']]) {
    assert.throws(() => main(args), /Unknown option/);
  }
  assert.equal(main(['--help']), 0);
});

test('existing readiness reports are not overwritten', t => {
  const directory = mkdtempSync(join(tmpdir(), 'uaa-readiness-report-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const reportPath = join(directory, 'readiness.json');
  writeFileSync(reportPath, 'retained independent report');
  const result = spawnSync(process.execPath, [harness], {
    cwd: scriptsRoot, encoding: 'utf8',
    env: { ...process.env, UAA_TASK_READINESS_REPORT: reportPath },
  });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /immutable report write failed/);
  assert.equal(readFileSync(reportPath, 'utf8'), 'retained independent report');
});

test('malformed structural inputs retain both mandatory services and blocked closure gates', t => {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'malformed-readiness-'));
  t.after(() => rmSync(workspaceRoot, { recursive: true, force: true }));
  const uaaRoot = join(workspaceRoot, 'vendor-upstream/ibizlab-runtime/ibzuaa');
  mkdirSync(join(uaaRoot, 'scripts'), { recursive: true });
  mkdirSync(join(uaaRoot, 'scripts/Dockerfile.source'));
  writeFileSync(join(uaaRoot, 'pom.xml'), '<project/>');
  writeFileSync(join(uaaRoot, 'Source.java'), 'class Source {}\n');
  const taskRoot = join(workspaceRoot, 'task7/SAPAAS');
  mkdirSync(join(taskRoot, 'resources/classes/build.xml'), { recursive: true });
  const report = auditUaaTaskReadiness({ workspaceRoot });
  assert.equal(report.checks.length, 23);
  assert.equal(report.readiness.uaa32666, false);
  assert.equal(report.readiness.task30088, false);
  assert.equal(report.services.uaa32666.find(check => check.id === 'uaa-source-dockerfile').status, 'blocked');
  assert.equal(report.services.uaa32666.find(check => check.id === 'uaa-standalone-runtime-binding').status, 'blocked');
  assert.equal(report.services.task30088.find(check => check.id === 'task-local-dependencies').status, 'blocked');
  for (const service of ['uaa', 'task']) {
    const closure = report.checks.find(check => check.id === `${service}-own-source-bytecode-closure`);
    assert.equal(closure.status, 'blocked');
    assert.match(closure.reason, /compiled-own fallback/);
  }
});

function standaloneInputFixture() {
  return {
    fingerprintKind: 'relative-file-set', fingerprint: 'a'.repeat(64),
    entries: STANDALONE_UAA_EDITABLE_INPUTS.map(path => ({
      path: `controlled/src/${path}`, bytes: 1, sha256: 'b'.repeat(64),
    })),
  };
}

test('legacy IBZUSER Java sources and prebuilt UAA jars cannot satisfy standalone editable input readiness', () => {
  const inputs = standaloneInputFixture();
  inputs.entries = [
    { path: 'legacy/core/uaa/domain/IBZUser.java', bytes: 1, sha256: 'b'.repeat(64) },
    { path: 'uaa-user.jar', bytes: 1, sha256: 'b'.repeat(64) },
  ];
  const result = standaloneUaaEditableSourceReadiness(inputs);
  assert.equal(result.ok, false);
  assert.deepEqual(result.evidence.missingInputs, [...STANDALONE_UAA_EDITABLE_INPUTS]);
  assert.deepEqual(result.evidence.legacyInputs, ['legacy/core/uaa/domain/IBZUser.java']);
  assert.match(result.reason, /legacy IBZUSER source cannot satisfy/);
});

test('controlled standalone paths prove input presence only, never own-source or native provenance', () => {
  const inputs = standaloneInputFixture();
  const result = standaloneUaaEditableSourceReadiness(inputs);
  assert.equal(result.ok, true);
  assert.equal(result.evidence.verification, 'input-presence-only-not-source-or-native-provenance');
  assert.equal(result.evidence.currentInputFingerprint, inputs.fingerprint);
  assert.equal(result.evidence.presentInputs.length, STANDALONE_UAA_EDITABLE_INPUTS.length);
  assert.deepEqual(result.evidence.missingInputs, []);
  assert.equal(standaloneUaaProtocolClosureReadiness(inputs).ok, false);
  assert.equal(ownSourceBytecodeClosureReadiness(inputs).ok, false);
});

test('uppercase generated IBZUSER source is diagnosed as legacy, never standalone', () => {
  const inputs = standaloneInputFixture();
  inputs.entries = [{ path: 'legacy/IBZUSER.java', bytes: 1, sha256: 'b'.repeat(64) }];
  const result = standaloneUaaEditableSourceReadiness(inputs);
  assert.equal(result.ok, false);
  assert.deepEqual(result.evidence.legacyInputs, ['legacy/IBZUSER.java']);
});

test('standalone input roster includes the registered endpoint, DTOs and principal/encoder mapping', () => {
  for (const path of [
    'cn/ibizlab/BootApplication.java', 'cn/ibizlab/api/rest/AuthResource.java',
    'cn/ibizlab/api/rest/AbstractAuthResource.java',
    'cn/ibizlab/api/dto/AuthLoginRequestDTO.java', 'cn/ibizlab/api/dto/AuthLoginResponseDTO.java',
    'cn/ibizlab/core/authentication/mapping/AuthInfoMapping.java', 'cn/ibizlab/util/web/Sm3Util.java',
  ]) assert.ok(STANDALONE_UAA_EDITABLE_INPUTS.includes(path));
});

test('claimed target endpoint, runtime hash and source build cannot invent standalone protocol closure', () => {
  const inputs = {
    ...standaloneInputFixture(), ok: true, state: 'verified', nativeAcceptance: true,
    sourceRuntimeCompatible: true, compilerExecutedInDocker: true,
    runtimeJarSha256: 'c'.repeat(64), path: '/auths/login', principalTable: 'sys_person',
  };
  const result = standaloneUaaProtocolClosureReadiness(inputs);
  assert.equal(result.ok, false);
  assert.equal(result.evidence.state, 'unverified');
  assert.equal(result.evidence.currentInputFingerprint, inputs.fingerprint);
  assert.equal(result.evidence.requiredContract.method, 'POST');
  assert.equal(result.evidence.requiredContract.path, '/auths/login');
  assert.equal(result.evidence.requiredContract.principalTable, 'sys_person');
  assert.equal(result.evidence.requiredContract.passwordStorageProperty, 'ibiz.auth.passwordStorageMode');
  assert.match(result.reason, /legacy v7\/login or uaa\/login, IBZUSER and pwencrymode/);
});

test('standalone protocol diagnostics keep conditional encoder and fine-grant proof separate from login', () => {
  const result = standaloneUaaProtocolClosureReadiness(standaloneInputFixture());
  assert.equal(result.ok, false, 'Contract diagnostics are not native or replacement-source evidence');
  assert.deepEqual(result.evidence.requiredContract.passwordEncoder, {
    sm3ConditionValue: 'sm3', sm3Digest: 'uppercase-64-hex',
    sm3Charset: 'java-default', rawLength64: 'pass-through',
    storedLengthLessThan64: 'hash-before-matching', comparison: 'case-sensitive',
    fallback: 'NoOpPasswordEncoder-if-no-SM3-bean', effectiveRuntimeSelectionRequired: true,
  });
  assert.equal(result.evidence.requiredContract.principalOrganizationKey,
    'sys_person.ORGANIZATION_ID -> sys_organization.ID');
  assert.equal(result.evidence.requiredContract.principalDomainKey, 'sys_person.DC -> sys_domain.ID');
  assert.equal(result.evidence.requiredContract.directRoleMemberType, 'inetOrgPerson');
  assert.equal(result.evidence.requiredContract.roleDeploySystemKey,
    'sys_role.DEPLOY_SYSTEM_ID -> sys_deploy_system.ID');
  assert.equal(result.evidence.requiredContract.projectedSystemKey, 'sys_deploy_system.SYSTEM_ID');
  assert.deepEqual(result.evidence.requiredContract.fineGrantFields,
    ['sys_granted_authority.ROLE_ID', 'AUTHORITY', 'PERMISSION_TYPE']);
  assert.equal(result.evidence.requiredContract.loginRoleAuthorities, 'cleared-not-fine-grant-evidence');
  assert.equal(result.evidence.requiredContract.authenticatedFineGrantReadPath, '/auths/user-info/self');
  assert.deepEqual(result.evidence.requiredContract.privilegedRoleSelection, {
    uaaField: 'sys_role.AUTHORITY', rtField: 'AuthGrantedRole.roleId',
    reservedValues: ['ROLE_APIUSERS', 'ROLE_SUPERADMIN'],
  });
  assert.deepEqual(result.evidence.requiredVerification, [
    'running-image-entrypoint-artifact-binding', 'source-build-to-runtime-class-binding',
    'registered-auths-login-request-response-contract', 'effective-runtime-password-encoder',
    'sys-person-domain-organization-role-joins', 'authenticated-user-info-fine-grants',
  ]);
});

for (const [name, change] of [
  ['missing source', inputs => inputs.entries.pop()],
  ['empty source', inputs => { inputs.entries[0].bytes = 0; }],
  ['source digest omitted', inputs => { delete inputs.entries[0].sha256; }],
  ['compiled source replacement', inputs => { inputs.entries[0].path += '.class'; }],
  ['unsafe relative path', inputs => { inputs.entries[0].path = `../${inputs.entries[0].path}`; }],
  ['absolute path', inputs => { inputs.entries[0].path = `/${inputs.entries[0].path}`; }],
  ['duplicate inventory entry', inputs => inputs.entries.push(inputs.entries[0])],
  ['ambiguous source packages', inputs => inputs.entries.push({
    ...inputs.entries[0], path: `other/${inputs.entries[0].path}`,
  })],
  ['missing inventory fingerprint', inputs => { delete inputs.fingerprint; }],
]) {
  test(`standalone UAA editable input diagnostics reject ${name}`, () => {
    const inputs = standaloneInputFixture();
    change(inputs);
    assert.equal(standaloneUaaEditableSourceReadiness(inputs).ok, false);
  });
}

test('standalone UAA input diagnostics are retained even when the source build receipt is missing', t => {
  const fixture = buildEvidenceFixture(t);
  rmSync(fixture.receiptPath);
  const result = verifyServiceBuildEvidence({ ...fixture, requireStandaloneUaa: true });
  assert.equal(result.artifactReady, false);
  assert.equal(result.standaloneAuthSource.ok, false);
  assert.equal(result.evidence.standaloneAuthSource.currentInputFingerprint,
    result.evidence.currentInputs.fingerprint);
  assert.deepEqual(result.evidence.standaloneAuthSource.missingInputs, [...STANDALONE_UAA_EDITABLE_INPUTS]);
  assert.equal(result.standaloneAuthProtocol.ok, false);
  assert.equal(result.evidence.standaloneAuthProtocol.currentInputFingerprint,
    result.evidence.currentInputs.fingerprint);
});

for (const [name, source, expected] of [
  ['unresolved decompiler throw', 'class Source { void run() { throw new IllegalStateException("Decompilation failed"); } }\n', false],
  ['failed decompiler method', 'class Source { /* Method not decompiled: Source.run() */ }\n', false],
  ['unresolved compiler throw', 'class Source { void run() { throw new Error("Unresolved compilation problems: missingType"); } }\n', false],
  ['singular unresolved compiler throw', 'class Source { void run() { throw new Error("Unresolved compilation problem: missingType"); } }\n', false],
  ['fully qualified compiler throw', 'class Source { void run() { throw new java.lang.Error("Unresolved compilation problem: missingType"); } }\n', false],
  ['commented compiler example', 'class Source { /* throw new Error("Unresolved compilation problem: example"); */ }\n', true],
  ['line-commented compiler example', 'class Source { // throw new Error("Unresolved compilation problem: example");\n}\n', true],
  ['quoted compiler example', 'class Source { String sample = "throw new Error(\\"Unresolved compilation problem: example\\")"; }\n', true],
  ['scanner marker constant', 'class Source { String marker = "Unresolved compilation problems:"; }\n', true],
  ['compiler error not thrown', 'class Source { void run() { new Error("Unresolved compilation problem: example"); } }\n', true],
  ['ordinary compiler error message', 'class Source { void run() { throw new Error("Other problem: Unresolved compilation problem: example"); } }\n', true],
  ['ordinary CFR attribution', '/* Decompiled with CFR 0.152. */ class Source {}\n', true],
  ['intentional unsupported API', 'class Source { void run() { throw new UnsupportedOperationException("Immutable reference"); } }\n', true],
]) {
  test(`independent known-stub audit handles ${name} without promoting semantic completeness`, t => {
    const fixture = buildEvidenceFixture(t, { source });
    const result = verifyServiceBuildEvidence(fixture);
    assert.equal(result.knownDecompilationStubs.ok, expected);
    assert.equal(result.evidence.knownStubAudit.javaFiles, 1);
    assert.equal(result.evidence.knownStubAudit.findings.length, expected ? 0 : 1);
    assert.equal(result.artifactReady, true, 'Hash matching alone must not prove source completeness');
    assert.equal(result.imageReady, true);
  });
}

test('known compiler stubs spanning comments and lines retain the actual throw line', t => {
  const source = [
    'class Source {',
    '  void run() {',
    '    throw /* scanner must skip this */',
    '      new java.lang.Error(',
    '        "Unresolved compilation problems: missingType");',
    '  }',
    '}',
    '',
  ].join('\n');
  const fixture = buildEvidenceFixture(t, { source });
  const result = verifyServiceBuildEvidence(fixture);
  assert.equal(result.knownDecompilationStubs.ok, false);
  assert.deepEqual(result.evidence.knownStubAudit.findings, [{ path: 'Source.java', line: 3 }]);
});

test('claimed closure success cannot replace the missing independent source-bytecode verifier', () => {
  const result = ownSourceBytecodeClosureReadiness({
    status: 'passed', compilerExecutedInDocker: true, sourceSha256: 'a'.repeat(64),
  });
  assert.equal(result.ok, false);
  assert.match(result.reason, /compiled-own fallback/);
});

test('loose bytecode inputs are inventoried even when Git and artifact hashes match', t => {
  const fixture = buildEvidenceFixture(t);
  const path = 'resources/classes/net/ibizsys/Own.class';
  mkdirSync(join(fixture.root, 'resources/classes/net/ibizsys'), { recursive: true });
  const bytes = Buffer.from('controlled bytecode input, not native compiler evidence');
  writeFileSync(join(fixture.root, path), bytes);
  fixture.git(['add', '.']);
  fixture.git(['commit', '-qm', 'controlled compiled input fixture, not native evidence']);
  fixture.receipt.commit = fixture.git(['rev-parse', 'HEAD']);
  const inputs = sourceBuildInputs(fixture.root);
  fixture.receipt.sourceInputs.before = inputs;
  fixture.receipt.sourceInputs.after = inputs;
  fixture.save();
  const result = verifyServiceBuildEvidence(fixture);
  assert.equal(result.artifactReady, true);
  assert.equal(result.imageReady, true);
  assert.equal(result.ownSourceBytecodeClosure.ok, false);
  assert.match(result.ownSourceBytecodeClosure.reason, /1 loose \.class build inputs/);
  assert.deepEqual(result.evidence.ownSourceBytecodeClosure.compiledInputs, [{
    path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'),
  }]);
  assert.equal(result.evidence.ownSourceBytecodeClosure.currentInputFingerprint, inputs.fingerprint);
});

test('dependency archive hashes are not promoted to verified source closure', t => {
  const fixture = buildEvidenceFixture(t);
  writeFileSync(join(fixture.root, 'ignored.jar'), 'controlled archive, not a native dependency');
  const inputs = sourceBuildInputs(fixture.root);
  fixture.receipt.sourceInputs.before = inputs;
  fixture.receipt.sourceInputs.after = inputs;
  fixture.save();
  const result = verifyServiceBuildEvidence(fixture);
  assert.equal(result.artifactReady, true);
  assert.equal(result.ownSourceBytecodeClosure.ok, false);
  assert.equal(result.evidence.ownSourceBytecodeClosure.state, 'unverified');
  assert.equal(result.evidence.ownSourceBytecodeClosure.archiveInputs, 1);
});

test('inherited Git redirection cannot promote a foreign clean tree to current source evidence', t => {
  const fixture = buildEvidenceFixture(t);
  const foreign = sourceFixture(t, { source: 'class Foreign {}\n' });
  writeFileSync(join(fixture.root, 'Source.java'), 'class DirtyCurrentSource {}\n');
  fixture.receipt.commit = foreign.commit;
  const inputs = sourceBuildInputs(fixture.root);
  fixture.receipt.sourceInputs.before = inputs;
  fixture.receipt.sourceInputs.after = inputs;
  fixture.save();
  const program = `
    import { verifyServiceBuildEvidence } from ${JSON.stringify(new URL('../harness-uaa-task-readiness.mjs', import.meta.url).href)};
    const [root, receiptPath, artifactPath] = process.argv.slice(1);
    let calls = 0;
    const result = verifyServiceBuildEvidence({
      root, receiptPath, artifactPath,
      execute() { calls++; return ${JSON.stringify(`${fixture.receipt.imageId} linux/arm64`)}; },
    });
    console.log(JSON.stringify({ result, calls }));
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', program,
    fixture.root, fixture.receiptPath, fixture.artifactPath], {
    encoding: 'utf8', timeout: 10_000,
    env: {
      ...process.env, GIT_DIR: join(foreign.root, '.git'), GIT_WORK_TREE: foreign.root,
      GIT_INDEX_FILE: join(foreign.root, '.git/index'),
      GIT_CONFIG_COUNT: '1', GIT_CONFIG_KEY_0: 'core.worktree', GIT_CONFIG_VALUE_0: foreign.root,
    },
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 0, result.stderr);
  const audit = JSON.parse(result.stdout);
  assert.equal(audit.result.sourceIdentity.ok, false);
  assert.equal(audit.result.artifactReady, false);
  assert.equal(audit.result.imageReady, false);
  assert.equal(audit.calls, 0);
});

test('post-verification ignored dependency drift really leaves Git clean', t => {
  const fixture = buildEvidenceFixture(t);
  let clean;
  const result = verifyServiceBuildEvidence({
    ...fixture, execute(...args) {
      writeFileSync(join(fixture.root, 'ignored.jar'), 'controlled ignored dependency drift');
      clean = verifyCommittedSource(fixture.root, fixture.receipt.commit).ok;
      return fixture.execute(...args);
    },
  });
  assert.equal(clean, true);
  assert.equal(result.artifactReady, false);
  assert.equal(result.imageReady, false);
});

test('large service artifacts are streamed beyond the pinned JSON receipt size limit', t => {
  const fixture = buildEvidenceFixture(t);
  const chunk = Buffer.alloc(1024 * 1024);
  writeFileSync(fixture.artifactPath, '');
  truncateSync(fixture.artifactPath, 65 * chunk.length);
  const expected = createHash('sha256');
  for (let index = 0; index < 65; index++) expected.update(chunk);
  fixture.receipt.sha256 = expected.digest('hex');
  fixture.save();
  const result = verifyServiceBuildEvidence(fixture);
  assert.equal(result.artifactReady, true);
  assert.equal(result.imageReady, true);
  assert.equal(result.evidence.artifactSha256, fixture.receipt.sha256);
});

test('Git source identity audit never refreshes the other lane source index', t => {
  const fixture = buildEvidenceFixture(t);
  const date = new Date('2020-01-01T00:00:00Z');
  utimesSync(join(fixture.root, 'Source.java'), date, date);
  const index = join(fixture.root, '.git/index');
  const identity = () => {
    const stat = statSync(index);
    return [stat.dev, stat.ino, stat.size, stat.mtimeMs, stat.ctimeMs];
  };
  const before = identity();
  const result = verifyServiceBuildEvidence(fixture);
  assert.equal(result.artifactReady, true);
  assert.equal(result.imageReady, true);
  assert.deepEqual(identity(), before);
});

function runtimeObservationFixture(t) {
  const workspaceRoot = mkdtempSync(join(tmpdir(), 'uaa-runtime-observation-'));
  t.after(() => rmSync(workspaceRoot, { recursive: true, force: true }));
  mkdirSync(join(workspaceRoot, 'runtime-jars'));
  const jar = join(workspaceRoot, 'runtime-jars/ibizlab-uaa-api.jar');
  writeFileSync(jar, 'controlled binary bytes, not standalone source or native evidence');
  const jarHash = createHash('sha256').update(readFileSync(jar)).digest('hex');
  const container = {
    id: 'a'.repeat(64), imageId: `sha256:${'b'.repeat(64)}`, running: true,
    startedAt: '2026-10-06T00:00:00.000Z', entrypoint: ['/entrypoint.sh'],
    command: null, mountCount: 0,
  };
  const state = {
    container, jarFilename: 'uaa-api', javaJar: '/uaa-api.jar\n',
    hashes: `${'c'.repeat(64)}  /entrypoint.sh\n${jarHash}  /uaa-api.jar\n`,
    platform: `${container.imageId} linux/arm64\n`,
  };
  const execute = (command, args, options) => {
    assert.equal(command, 'docker');
    assert.equal(options.timeout, 10_000);
    assert.deepEqual(options.stdio, ['ignore', 'pipe', 'pipe']);
    if (args[0] === 'inspect') {
      assert.deepEqual(args.slice(3), ['--', 'ibizlab-uaa-api']);
      assert.ok(!args[2].includes('.Config.Env'), 'No full environment inspection');
      return JSON.stringify(state.container);
    }
    if (args[0] === 'image') {
      assert.deepEqual(args, [
        'image', 'inspect', '--format', '{{.Id}} {{.Os}}/{{.Architecture}}', '--', container.imageId,
      ]);
      return state.platform;
    }
    assert.equal(args[0], 'exec', 'No lifecycle, build or provisioning command');
    assert.equal(args[1], 'ibizlab-uaa-api');
    if (args[2] === 'sha256sum') {
      assert.deepEqual(args.slice(2), ['sha256sum', '/entrypoint.sh', '/uaa-api.jar']);
      return state.hashes;
    }
    assert.deepEqual(args.slice(2, 4), ['sh', '-c']);
    if (args[4] === 'printf "%s" "$JAR_FILENAME"') return state.jarFilename;
    assert.match(args[4], /\/proc\/\[0-9\]\*\/comm/);
    assert.ok(!args[4].includes('JAVA_OPTS'));
    return state.javaJar;
  };
  return { workspaceRoot, jar, jarHash, state, execute };
}

test('controlled live-binding response proves binary identity only and never source/protocol/encoder', t => {
  const fixture = runtimeObservationFixture(t);
  const result = observeStandaloneUaaRuntime(fixture);
  assert.equal(result.ok, true);
  assert.equal(result.evidence.state, 'observed-identity-only');
  assert.equal(result.evidence.evidenceOrigin, 'controlled-runner-not-native-evidence');
  assert.equal(result.evidence.runtimeJarSha256, fixture.jarHash);
  assert.equal(result.evidence.localJarSha256, fixture.jarHash);
  assert.equal(result.evidence.nativeAcceptance, false);
  assert.equal(result.evidence.sourceRuntimeCompatible, false);
  assert.equal(result.evidence.effectivePasswordEncoderVerified, false);
  assert.match(result.reason, /no editable-source, encoder, protocol or native acceptance proof/);
});

for (const [name, change] of [
  ['stopped container', fixture => { fixture.state.container.running = false; }],
  ['malformed container ID', fixture => { fixture.state.container.id = 'claimed'; }],
  ['malformed image ID', fixture => { fixture.state.container.imageId = 'claimed'; }],
  ['malformed start time', fixture => { fixture.state.container.startedAt = 'claimed'; }],
  ['different entrypoint', fixture => { fixture.state.container.entrypoint = ['/legacy.sh']; }],
  ['command override', fixture => { fixture.state.container.command = ['other.jar']; }],
  ['artifact mount', fixture => { fixture.state.container.mountCount = 1; }],
  ['wrong architecture', fixture => { fixture.state.platform = `${fixture.state.container.imageId} linux/amd64\n`; }],
  ['legacy filename', fixture => { fixture.state.jarFilename = 'ibzuaa'; }],
  ['different Java target', fixture => { fixture.state.javaJar = '/ibzuaa.jar\n'; }],
  ['missing Java target', fixture => { fixture.state.javaJar = ''; }],
  ['multiple Java targets', fixture => { fixture.state.javaJar += '/uaa-api.jar\n'; }],
  ['malformed hashes', fixture => { fixture.state.hashes = 'claimed passed'; }],
  ['different runtime JAR', fixture => { fixture.state.hashes = fixture.state.hashes.replace(fixture.jarHash, 'd'.repeat(64)); }],
  ['missing local JAR', fixture => rmSync(fixture.jar)],
  ['empty local JAR', fixture => writeFileSync(fixture.jar, '')],
  ['symlinked local JAR', fixture => {
    renameSync(fixture.jar, `${fixture.jar}.outside`);
    symlinkSync(`${fixture.jar}.outside`, fixture.jar);
  }],
]) {
  test(`standalone runtime observation rejects ${name} without promoting partial hashes`, t => {
    const fixture = runtimeObservationFixture(t);
    change(fixture);
    const result = observeStandaloneUaaRuntime(fixture);
    assert.equal(result.ok, false);
    assert.equal(result.evidence.state, 'unverified');
    assert.equal(result.evidence.runtimeJarSha256, undefined);
    assert.equal(result.evidence.nativeAcceptance, false);
  });
}

for (const [name, change] of [
  ['container restart', fixture => { fixture.state.container.startedAt = '2026-10-06T01:00:00.000Z'; }],
  ['container replacement', fixture => { fixture.state.container.id = 'd'.repeat(64); }],
  ['entrypoint replacement', fixture => { fixture.state.hashes = fixture.state.hashes.replace('c'.repeat(64), 'd'.repeat(64)); }],
  ['Java target replacement', fixture => { fixture.state.javaJar = '/other.jar\n'; }],
  ['local binary drift', fixture => writeFileSync(fixture.jar, 'changed local binary')],
]) {
  test(`standalone runtime observation rejects ${name} during rechecks`, t => {
    const fixture = runtimeObservationFixture(t);
    let reads = 0;
    const result = observeStandaloneUaaRuntime({
      ...fixture,
      execute(command, args, options) {
        if (args[0] === 'exec' && args[2] === 'sha256sum' && ++reads === 2) change(fixture);
        return fixture.execute(command, args, options);
      },
    });
    assert.equal(reads, 2);
    assert.equal(result.ok, false);
    assert.equal(result.evidence.state, 'unverified');
  });
}

for (const [name, execute] of [
  ['malformed JSON', () => '{invalid'],
  ['launch failure', () => { throw new Error('sensitive command output must not leak'); }],
  ['timeout', () => { throw Object.assign(new Error('sensitive timeout output'), { code: 'ETIMEDOUT' }); }],
]) {
  test(`standalone runtime observation retains ${name} as failure without stdout/secret leakage`, t => {
    const fixture = runtimeObservationFixture(t);
    const result = observeStandaloneUaaRuntime({ ...fixture, execute });
    assert.equal(result.ok, false);
    assert.equal(result.evidence.state, 'unverified');
    assert.ok(!JSON.stringify(result).includes('sensitive'));
  });
}

test('UAA/Task lane documentation cannot promote the legacy source to standalone readiness', () => {
  const audit = readFileSync(join(scriptsRoot, 'docs/uaa-task-source-build-audit.md'), 'utf8');
  const localization = readFileSync(join(scriptsRoot, 'docs/SOURCE-LOCALIZATION.md'), 'utf8');
  assert.match(audit, /UAA 32666 is blocked, not source-ready/);
  assert.match(audit, /POST \/auths\/login/);
  assert.match(audit, /sys_person\.UID/);
  assert.match(audit, /effective runtime selection proof/);
  assert.match(audit, /Task 30088 is also blocked/);
  assert.ok(!audit.includes('scripts/.artifacts/uaa-task-readiness.json'));
  const readySection = localization.split('### UAA: standalone source/protocol blocked')[0];
  assert.ok(!readySection.includes('| UAA 32666 |'));
  assert.match(localization, /UAA 32666 \(blocked, not ready\)/);
});
