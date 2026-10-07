import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  archiveFreeProjectionInputs, auditRequiredMigrationBindings, evaluateRequiredSourceGates, main, REQUIRED_D01_COMPONENTS,
  rebuildRequiredBackendEvidence, REQUIRED_SOURCE_GATES, runRequiredSourceGates,
  selectRequiredBackendBuild, verifyRequiredBackendBuildResult, verifyScopedOwnSourceClosure,
  selectRequiredUaaCompilerReplay, verifyRequiredRecoveredUaaEvidence,
  selectRequiredUaaSourceClosureEvidence, verifyRequiredUaaSourceClosureEvidence,
  verifyRequiredTaskSourceClosureEvidence,
  selectRequiredComponentEvidenceRequest, verifyRequiredComponentEvidence,
} from '../harness-required-source-gates.mjs';
import { verifyStatefulReceipt } from '../../standalone-uaa/tools/stateful-token-runtime.mjs';
import { verifyBuildForPackaging } from '../../standalone-uaa/tools/runtime-image.mjs';
import { verifyClosureReceipt } from '../../standalone-uaa/tools/source-closure.mjs';
import { runCompilerInDocker, verifyCompilerReceipt } from '../harness-compiler-in-docker.mjs';
import {
  standaloneUaaProtocolClosureReadiness, STANDALONE_UAA_EDITABLE_INPUTS,
} from '../harness-uaa-task-readiness.mjs';
import { MIGRATION_RUNTIME_REQUIREMENTS } from '../harness-modeling-core-audit.mjs';

function migrationFixture(t) {
  const root = dirname(directory(t));
  const modelRoot = 'vendor-upstream/ibizmodeling-standard/modelapi-core/src/main/resources/model/net/ibizsys/modeling';
  const contractPath = join(root, 'scripts/fixtures/modeling-core-migration-contract.json');
  const repo = '@ibiz-template-test/tool@1.0.0';
  const hash = bytes => createHash('sha256').update(bytes).digest('hex');
  const write = (path, data) => {
    fs.mkdirSync(dirname(path), { recursive: true });
    fs.writeFileSync(path, typeof data === 'object' ? `${JSON.stringify(data)}\n` : data);
  };
  const manifest = { name: '@ibiz-template-test/tool', version: '1.0.0', gitHead: 'a'.repeat(40) };
  const files = {
    source: ['package.json', 'src/index.ts', 'src/required.ts'],
    target: ['package.json', 'dist/index.js'],
  };
  write(join(root, 'source/package.json'), manifest);
  write(join(root, 'source/src/index.ts'), 'export { required } from "./required";\n');
  write(join(root, 'source/src/required.ts'), 'export const required = true;\n');
  write(join(root, 'target/package.json'), manifest);
  write(join(root, 'target/dist/index.js'), 'export const required = true;\n');
  const inventory = kind => files[kind].map(path => {
    const bytes = fs.readFileSync(join(root, kind, path));
    return { path, bytes: bytes.length, sha256: hash(bytes) };
  }).sort((a, b) => a.path.localeCompare(b.path));
  const source = inventory('source');
  const target = inventory('target');
  const fingerprint = entries => hash(JSON.stringify(entries));
  const evidence = (kind, entries) => ({
    status: kind === 'source' ? 'verified' : 'observed',
    path: kind, fingerprintKind: `${kind}-file-set`, fingerprint: fingerprint(entries),
    files: entries.length, bytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
    ...(kind === 'source' ? { packageGitHead: manifest.gitHead } : {}),
  });
  const receipt = {
    schemaVersion: 1, status: 'passed', command: 'controlled-fixture-not-native-evidence', exitCode: 0,
    package: { name: manifest.name, version: manifest.version },
    sourceFingerprint: fingerprint(source), outputFingerprint: fingerprint(target),
    inputs: source, outputs: target,
  };
  const applications = {};
  for (const app of ['Central', 'ModelDesign']) {
    const path = join(root, modelRoot, 'PSSYSAPPS', app, 'PSSYSAPP.json');
    write(path, { getAllPSAppPFPluginRefs: [{ rTObjectRepo: repo }] });
    const bytes = fs.readFileSync(path);
    applications[app] = { bytes: bytes.length, inputSha256: hash(bytes),
      references: [{ repo, locations: ['/getAllPSAppPFPluginRefs/0/rTObjectRepo'] }] };
  }
  const contract = {
    schemaVersion: 1, contract: 'ibizmodeling-core-migration',
    evidence: { modelRoot, applications },
    plugins: [{ repo, build: { status: 'verified', fingerprintKind: 'source-build-receipt', receipt } }],
    migrationPolicy: {
      statusForUse: 'verified-only', sourceRequired: true, buildRequired: true, runtimeRequired: true,
      runtimeApplications: ['Central', 'ModelDesign'], requiredRuntimeChecks: [...MIGRATION_RUNTIME_REQUIREMENTS],
    },
    migrationMappings: [{
      from: repo, target: { status: 'observed', repo, artifact: evidence('target', target) },
      source: evidence('source', source),
      compatibility: { status: 'blocked', basis: [{ kind: 'runtime', status: 'not-verified', evidence: 'Not run' }],
        requiredProof: ['runtime'], rationale: 'Controlled current input audit only' },
      build: { status: 'verified', fingerprintKind: 'source-build-receipt', receipt,
        sourceFingerprint: fingerprint(source), outputFingerprint: fingerprint(target) },
      runtime: { status: 'not-verified', required: [...MIGRATION_RUNTIME_REQUIREMENTS], evidence: null },
      status: 'blocked', blockers: ['runtime-not-verified'],
    }],
  };
  const persist = () => write(contractPath, contract);
  persist();
  return { root, modelRoot, contractPath, contract, persist, hash, write };
}

test('independent migration audit binds current models and exact receipt input/output sets without promotion', t => {
  const f = migrationFixture(t);
  const report = auditRequiredMigrationBindings(f.root);
  assert.equal(report.status, 'passed-input-bindings-only');
  assert.deepEqual(report.summary, { passed: 5, failed: 0, skipped: 0 });
  assert.equal(report.models.length, 2);
  assert.equal(report.mappings[0].declaredEvidenceConsistent, true);
  assert.equal(report.mappings[0].inputBindingsVerified, true);
  for (const key of ['sourceFileSetBound', 'targetFileSetBound', 'receiptFileSetsBound']) {
    assert.equal(report.mappings[0][key], true);
  }
  assert.deepEqual(report.mappings[0].blockers, ['runtime-not-verified']);
  assert.equal(report.compilerBuildInDockerVerified, false);
  assert.equal(report.fullSourceClosureVerified, false);
  assert.equal(report.nativeAcceptance, false);
  assert.equal(report.controlledRoot, true);
});

for (const [name, change, reason] of [
  ['partial source build', f => {
    const receipt = f.contract.migrationMappings[0].build.receipt;
    receipt.inputs = receipt.inputs.filter(entry => entry.path !== 'src/required.ts');
    receipt.sourceFingerprint = f.hash(JSON.stringify(receipt.inputs));
  }, /receipt source fingerprint differs/],
  ['receipt output omission', f => {
    const receipt = f.contract.migrationMappings[0].build.receipt;
    receipt.outputs = receipt.outputs.filter(entry => entry.path !== 'dist/index.js');
    receipt.outputFingerprint = f.hash(JSON.stringify(receipt.outputs));
    f.contract.migrationMappings[0].build.outputFingerprint = receipt.outputFingerprint;
  }, /Invalid migration mapping/],
  ['stale source bytes', f => f.write(join(f.root, 'source/src/required.ts'), 'export const required = false;\n'),
    /source fingerprint differs/],
  ['untracked source input', f => f.write(join(f.root, 'source/src/untracked.ts'), 'export const extra = true;\n'),
    /source fingerprint differs/],
  ['stale target bytes', f => f.write(join(f.root, 'target/dist/index.js'), 'export const required = false;\n'),
    /target fingerprint differs/],
  ['copied model hash', f => { f.contract.evidence.applications.Central.inputSha256 = '0'.repeat(64); },
    /model hash differs/],
  ['model pointer drift', f => {
    f.contract.evidence.applications.Central.references[0].locations = ['/unrelated/rTObjectRepo'];
  }, /identities or pointers differ/],
  ['omitted mapping', f => { f.contract.migrationMappings = []; }, /Missing, duplicate or extra/],
  ['duplicate mapping', f => { f.contract.migrationMappings.push(f.contract.migrationMappings[0]); },
    /Missing, duplicate or extra/],
  ['relaxed runtime policy', f => { f.contract.migrationPolicy.runtimeRequired = false; }, /false !== true/],
  ['model root traversal', f => { f.contract.evidence.modelRoot = '../models'; }, /model root differs/],
  ['source path traversal', f => { f.contract.migrationMappings[0].source.path = '../source'; }, /Unsafe migration/],
  ['symlink source file', f => {
    fs.unlinkSync(join(f.root, 'source/src/required.ts'));
    fs.symlinkSync(join(f.root, 'target/dist/index.js'), join(f.root, 'source/src/required.ts'));
  }, /Symlink migration input/],
  ['symlink source ancestor', f => {
    fs.renameSync(join(f.root, 'source'), join(f.root, 'original-source'));
    fs.symlinkSync(join(f.root, 'original-source'), join(f.root, 'source'));
  }, /Symlink directory/],
  ['malformed contract JSON', f => { f.persist = () => f.write(f.contractPath, '{bad JSON'); },
    /JSON|property name/],
]) {
  test(`migration input binding fails closed for ${name}`, t => {
    const f = migrationFixture(t);
    change(f);
    f.persist();
    const report = auditRequiredMigrationBindings(f.root);
    assert.equal(report.status, 'failed');
    assert.ok(report.summary.failed > 0);
    assert.equal(report.summary.skipped, 0);
    assert.equal(report.fullSourceClosureVerified, false);
    assert.equal(report.nativeAcceptance, false);
    assert.match(report.errors.map(error => error.reason).join(' '), reason);
  });
}

test('missing migration contract is a failure report, never skip or an ignored missing component', t => {
  const f = migrationFixture(t);
  fs.unlinkSync(f.contractPath);
  const report = auditRequiredMigrationBindings(f.root);
  assert.deepEqual(report.summary, { passed: 0, failed: 1, skipped: 0 });
  assert.equal(report.status, 'failed');
  assert.equal(report.contractSha256, null);
});

for (const state of ['missing-source', 'missing-build', 'missing-source-and-target']) {
  test(`migration ${state} declaration consistency cannot invent current source/receipt bindings`, t => {
    const f = migrationFixture(t);
    const mapping = f.contract.migrationMappings[0];
    mapping.build = {
      status: 'missing-receipt', receipt: null, fingerprintKind: null,
      sourceFingerprint: null, outputFingerprint: null,
    };
    f.contract.plugins[0].build = { status: 'missing-receipt', receipt: null };
    mapping.blockers.push('missing-build-receipt');
    if (state !== 'missing-build') {
      mapping.source = {
        status: 'missing', path: null, fingerprintKind: null, fingerprint: null,
        files: null, bytes: null, packageGitHead: null, reason: 'Controlled missing source declaration',
      };
      mapping.blockers.push('missing-source-evidence');
    }
    if (state === 'missing-source-and-target') {
      mapping.target = {
        status: 'missing', repo: null, artifact: null, reason: 'Controlled missing target declaration',
      };
      mapping.blockers.push('missing-target-evidence');
    }
    f.persist();
    const report = auditRequiredMigrationBindings(f.root);
    assert.equal(report.status, 'passed-input-bindings-only');
    assert.deepEqual(report.summary, { passed: 5, failed: 0, skipped: 0 });
    const result = report.mappings[0];
    assert.equal(result.declaredEvidenceConsistent, true);
    assert.equal(result.inputBindingsVerified, false);
    assert.equal(result.sourceFileSetBound, state === 'missing-build');
    assert.equal(result.targetFileSetBound, state !== 'missing-source-and-target');
    assert.equal(result.receiptFileSetsBound, false);
    assert.deepEqual(result.blockers, mapping.blockers);
    assert.equal(result.fullSourceClosureVerified, false);
    assert.equal(report.compilerBuildInDockerVerified, false);
    assert.equal(report.nativeAcceptance, false);
  });
}

test('migration post-audit input drift revokes all mapping binding flags and retains failure evidence', t => {
  const f = migrationFixture(t);
  const originalReadDirectory = fs.readdirSync;
  let sourceVisits = 0;
  t.mock.method(fs, 'readdirSync', function(path, ...args) {
    if (typeof path === 'string' && path.startsWith('/proc/self/fd/')
      && fs.realpathSync(path) === join(f.root, 'source') && ++sourceVisits === 2) {
      f.write(join(f.root, 'source/src/required.ts'), 'export const required = false;\n');
    }
    return originalReadDirectory.call(this, path, ...args);
  });
  const report = auditRequiredMigrationBindings(f.root);
  assert.equal(sourceVisits, 2);
  assert.equal(report.status, 'failed');
  assert.deepEqual(report.summary, { passed: 4, failed: 1, skipped: 0 });
  assert.equal(report.checks.at(-1).id, 'migration-post-audit-input-recheck');
  assert.equal(report.checks.at(-1).status, 'fail');
  assert.match(report.errors.at(-1).reason, /inventory changed during audit/);
  for (const key of ['declaredEvidenceConsistent', 'inputBindingsVerified',
    'sourceFileSetBound', 'targetFileSetBound', 'receiptFileSetsBound']) {
    assert.equal(report.mappings[0][key], false);
  }
  assert.equal(report.fullSourceClosureVerified, false);
  assert.equal(report.nativeAcceptance, false);
});

// These controlled audit responses test fail-closed aggregation, not native evidence.
function auditFixture() {
  const checks = {
    uaa: [
      'uaa-source-tree', 'uaa-source-build-entrypoint', 'uaa-source-dockerfile',
      'uaa-standalone-auth-source', 'uaa-standalone-auth-protocol-closure',
      'uaa-standalone-runtime-binding',
      'uaa-known-decompilation-stubs', 'uaa-own-source-bytecode-closure',
      'uaa-source-identity', 'uaa-source-build-inputs', 'uaa-source-build-evidence', 'uaa-source-image-evidence',
    ],
    task: [
      'task-source-tree', 'task-local-dependencies', 'task-war-assembly',
      'task-source-dockerfile', 'task-source-build-entrypoint', 'task-source-identity',
      'task-known-decompilation-stubs', 'task-own-source-bytecode-closure',
      'task-source-build-inputs', 'task-source-build-evidence', 'task-source-image-evidence',
    ],
  };
  const uaa = checks.uaa.map(id => ({ id, service: 'uaa', status: 'pass' }));
  const task = checks.task.map(id => ({ id, service: 'task', status: 'pass' }));
  const evidence = {
    receiptState: 'verified-current-inputs',
    recordedInputContract: 'source-build-input-inventory-v1',
    buildExitCode: 0, recordedPlatform: 'linux/arm64',
    receiptSha256: 'a'.repeat(64), artifactSha256: 'b'.repeat(64),
    recordedSourceCommit: 'd'.repeat(40),
    currentInputs: {
      files: STANDALONE_UAA_EDITABLE_INPUTS.length + 2, bytes: 100,
      fingerprintKind: 'relative-file-set', fingerprint: 'c'.repeat(64),
    },
    knownStubAudit: {
      contract: 'known-decompilation-stub-audit-v1',
      currentInputFingerprint: 'c'.repeat(64), javaFiles: 1, findings: [],
    },
    ownSourceBytecodeClosure: {
      contract: 'source-bytecode-closure-readiness-v1', state: 'unverified',
      currentInputFingerprint: 'c'.repeat(64), compiledInputs: [], archiveInputs: 0,
    },
    sourceImageObservation: {
      contract: 'source-image-identity-observation-v1', state: 'observed-identity-only',
      verification: 'image-identity-only-not-compiler-or-artifact-binding',
      evidenceOrigin: 'live-read-only-image-inspection',
      currentInputFingerprint: 'c'.repeat(64), sourceCommit: 'd'.repeat(40),
      artifactSha256: 'b'.repeat(64), imageTag: 'fixture/source-image:controlled',
      imageId: `sha256:${'e'.repeat(64)}`, platform: 'linux/arm64', observations: 2,
    },
  };
  return {
    schemaVersion: 1, contract: 'uaa-task-own-source-readiness', nativeAcceptance: false,
    runBuild: false, compilerBuildInDockerVerified: false,
    source: { uaaCommit: evidence.recordedSourceCommit, taskCommit: evidence.recordedSourceCommit },
    sourceBuildEvidence: {
      uaa32666: {
        ...structuredClone(evidence),
        standaloneAuthSource: {
          contract: 'uaa-standalone-editable-inputs-v1', target: 'uaa-standalone-sys-person',
          verification: 'input-presence-only-not-source-or-native-provenance',
          currentInputFingerprint: evidence.currentInputs.fingerprint,
          requiredInputs: [...STANDALONE_UAA_EDITABLE_INPUTS],
          presentInputs: STANDALONE_UAA_EDITABLE_INPUTS.map(required => ({
            required, path: `controlled/src/${required}`, bytes: 1, sha256: 'a'.repeat(64),
          })),
          missingInputs: [], legacyInputs: [],
        },
        standaloneAuthProtocol: standaloneUaaProtocolClosureReadiness(
          evidence.currentInputs).evidence,
      },
      task30088: structuredClone(evidence),
    },
    runtimeTargetObservation: {
      ok: true,
      evidence: {
        contract: 'uaa-standalone-runtime-artifact-observation-v1',
        target: 'uaa-standalone-sys-person', state: 'observed-identity-only',
        verification: 'runtime-artifact-identity-only-not-source-or-protocol',
        evidenceOrigin: 'live-read-only-runtime-observation',
        nativeAcceptance: false, sourceRuntimeCompatible: false,
        effectivePasswordEncoderVerified: false, container: 'ibizlab-uaa-api',
        containerId: 'a'.repeat(64), imageId: `sha256:${'b'.repeat(64)}`,
        platform: 'linux/arm64', startedAt: '2026-10-06T00:00:00.000Z',
        entrypointPath: '/entrypoint.sh', jarFilename: 'uaa-api',
        runtimeJarPath: '/uaa-api.jar', localJarPath: 'runtime-jars/ibizlab-uaa-api.jar',
        entrypointSha256: 'c'.repeat(64),
        runtimeJarSha256: 'd'.repeat(64), localJarSha256: 'd'.repeat(64),
      },
    },
    readiness: { uaa32666: true, task30088: true },
    checks: [...uaa, ...task], services: { uaa32666: uaa, task30088: task },
  };
}

test('required gate roster cannot drop S06 UAA, Task or D01 compiler for frontend success', () => {
  const report = evaluateRequiredSourceGates({
    status: 'passed', nativeAcceptance: false, checks: [], browser: { passed: 100 },
    compilerBuildInDockerVerified: true,
  });
  assert.deepEqual(report.requiredGates, [...REQUIRED_SOURCE_GATES]);
  assert.equal(report.status, 'failed');
  assert.equal(report.nativeAcceptance, false);
  assert.equal(report.summary.skipped, 0);
  assert.equal(report.summary.failed, 3);
});

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function canonicalUaaReportPaths(kind) {
  const root = join(workspaceRoot, '.artifacts', `standalone-uaa-${kind}`);
  assert.ok(fs.existsSync(root), `Missing canonical UAA artifact root: ${kind}`);
  return fs.readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && entry.name.includes('-'))
    .map(entry => `.artifacts/standalone-uaa-${kind}/${entry.name}/report.json`)
    .filter(path => fs.existsSync(join(workspaceRoot, path)));
}

function readWorkspaceJson(path) {
  return JSON.parse(fs.readFileSync(join(workspaceRoot, path)));
}

function workspaceFileSha256(path) {
  return createHash('sha256').update(fs.readFileSync(join(workspaceRoot, path))).digest('hex');
}

function discoverUaaSourceClosureRequest() {
  for (const closurePath of canonicalUaaReportPaths('source-closure').reverse()) {
    const closure = readWorkspaceJson(closurePath);
    const buildPath = closure.buildReceipt?.path?.match(
      /\.artifacts\/standalone-uaa-source-build\/build-[A-Za-z0-9]+\/report\.json/,
    )?.[0];
    if (!buildPath || closure.buildReceipt.sha256 !== workspaceFileSha256(buildPath)) continue;
    const build = readWorkspaceJson(buildPath);
    for (const statefulPath of canonicalUaaReportPaths('stateful-security').reverse()) {
      const stateful = readWorkspaceJson(statefulPath);
      const runtimePath = stateful.inputs?.find(input =>
        input.path?.includes('/.artifacts/standalone-uaa-source-runtime/runtime-'))?.path
        ?.match(/\.artifacts\/standalone-uaa-source-runtime\/runtime-[A-Za-z0-9]+\/report\.json/)?.[0];
      if (!runtimePath || stateful.image?.sourceBuildReceiptSha256 !== closure.buildReceipt.sha256) continue;
      const runtime = readWorkspaceJson(runtimePath);
      if (runtime.inputBuild?.sha256 === closure.buildReceipt.sha256
        && runtime.inputBuild.path?.endsWith(buildPath)
        && runtime.image.id === stateful.image.id
        && runtime.sourceFingerprint === closure.sourceFingerprint
        && stateful.sourceFingerprint === closure.sourceFingerprint
        && closure.sourceFingerprint === build.maintainedInputs?.sourceBefore?.fingerprint) {
        return {
          buildReport: buildPath, runtimeReport: runtimePath,
          statefulReport: statefulPath, closureReport: closurePath,
        };
      }
    }
  }
  assert.fail('No current bound UAA build/runtime/stateful/closure evidence found');
}

test('live canonical UAA evidence closes S06 without closing Task, D01 or native acceptance', () => {
  const request = discoverUaaSourceClosureRequest();
  const evidence = verifyRequiredUaaSourceClosureEvidence({ request });
  assert.equal(evidence.status, 'pass');
  assert.equal(evidence.maintainedSourceBuildVerified, true);
  assert.equal(evidence.runtimeImageBindingVerified, true);
  assert.equal(evidence.statefulRuntimeSecurityVerified, true);
  assert.equal(evidence.scopedOwnSourceClosureVerified, true);
  assert.equal(evidence.fullSourceClosureVerified, false);
  assert.equal(evidence.nativeAcceptance, false);

  const report = evaluateRequiredSourceGates(auditFixture(), [], undefined, undefined, { request });
  assert.equal(report.status, 'failed');
  assert.deepEqual(report.summary, { required: 3, passed: 1, failed: 2, skipped: 0, rejectedSourceSkips: 0 });
  assert.equal(report.checks[0].id, 's06-uaa-own-source');
  assert.equal(report.checks[0].status, 'pass');
  assert.equal(report.checks[0].nativeAcceptance, false);
  assert.equal(report.checks[1].status, 'fail');
  assert.equal(report.checks[2].status, 'fail');
});

function liveTaskClosureRequest() {
  return {
    inputScreen: 'task7/.artifacts/task7-independent-compiler-SyMo3p/current-input-screen.json',
    inputClosure: 'task7/.artifacts/task7-independent-compiler-SyMo3p/input-screen.json',
    warBinding: 'task7/.artifacts/task7-independent-compiler-SyMo3p/war-output-binding.json',
  };
}

test('live canonical Task evidence closes S06 without closing UAA, D01 or native acceptance', () => {
  const request = liveTaskClosureRequest();
  const report = evaluateRequiredSourceGates(auditFixture(), [], undefined, undefined,
    undefined, { request });
  assert.equal(report.status, 'failed');
  assert.deepEqual(report.summary, { required: 3, passed: 1, failed: 2, skipped: 0, rejectedSourceSkips: 0 });
  assert.equal(report.checks[1].id, 's06-task-own-source');
  assert.equal(report.checks[1].status, 'pass');
  assert.equal(report.checks[1].scopedOwnSourceClosureVerified, true);
  assert.equal(report.checks[1].fullSourceClosureVerified, false);
  assert.equal(report.checks[1].nativeAcceptance, false);
  assert.equal(report.checks[0].status, 'fail');
  assert.equal(report.checks[2].status, 'fail');
});

for (const [name, mutate] of [
  ['missing request', request => { delete request.warBinding; }],
  ['noncanonical path', request => { request.inputScreen = 'task7/report.json'; }],
  ['traversal path', request => { request.inputClosure = 'task7/../scripts/report.json'; }],
]) {
  test(`Task source closure evidence rejects ${name}`, () => {
    const request = liveTaskClosureRequest();
    mutate(request);
    const evidence = verifyRequiredTaskSourceClosureEvidence({ request });
    assert.equal(evidence.status, 'fail');
    assert.equal(evidence.scopedOwnSourceClosureVerified, false);
    assert.equal(evidence.nativeAcceptance, false);
  });
}

test('UAA source closure evidence requires all four canonical reports and rejects drift', () => {
  const valid = discoverUaaSourceClosureRequest();
  assert.throws(() => selectRequiredUaaSourceClosureEvidence({
    ...valid, closureReport: '.artifacts/standalone-uaa-source-closure/closure-ID/receipt.json',
  }), /canonical artifact/);
  assert.throws(() => selectRequiredUaaSourceClosureEvidence({
    ...valid, statefulReport: valid.statefulReport.replace('security-', 'security-copy-'),
  }), /canonical artifact/);

  for (const [name, replacement] of [
    ['unbound runtime report', canonicalUaaReportPaths('source-runtime')
      .find(path => path !== valid.runtimeReport)],
    ['unbound stateful report', canonicalUaaReportPaths('stateful-security')
      .find(path => path !== valid.statefulReport)],
  ]) {
    assert.ok(replacement, `No alternate UAA report available for ${name}`);
    const evidence = verifyRequiredUaaSourceClosureEvidence({
      request: name === 'unbound runtime report'
        ? { ...valid, runtimeReport: replacement }
        : { ...valid, statefulReport: replacement },
    });
    assert.equal(evidence.status, 'fail', `${name} must fail closed`);
    assert.equal(evidence.nativeAcceptance, false);
  }

  assert.throws(() => selectRequiredUaaSourceClosureEvidence({ ...valid, extra: true }),
    /requires all four canonical reports/);
  for (const scope of [undefined, {}, { request: null }, { request: valid, error: 'controlled failure' }]) {
    assert.equal(verifyRequiredUaaSourceClosureEvidence(scope).status, 'fail');
  }
});

test('even all controlled service checks passing cannot promote Docker static-delivery/host compiler', () => {
  const fixture = auditFixture();
  const report = evaluateRequiredSourceGates(fixture);
  assert.equal(report.summary.passed, 0);
  assert.equal(report.summary.failed, 3);
  assert.equal(report.status, 'failed');
  assert.equal(report.compilerBuildInDockerVerified, false);
  assert.match(report.checks[0].reason, /No independent UAA source closure evidence requested/);
  assert.match(report.checks[1].reason, /No independent Task source closure evidence requested/);
  assert.match(report.checks[2].reason, /independent compiler-in-Docker verifier/);
});

test('claimed closure booleans and copied artifact hashes cannot invent independent S06 verification', () => {
  const fixture = auditFixture();
  for (const service of Object.values(fixture.sourceBuildEvidence)) {
    service.ownSourceBytecodeClosure = {
      status: 'passed', compilerExecutedInDocker: true,
      sourceSha256: service.currentInputs.fingerprint,
      artifactSha256: service.artifactSha256,
    };
  }
  const report = evaluateRequiredSourceGates(fixture);
  assert.equal(report.summary.failed, 3);
  assert.equal(report.summary.passed, 0);
  assert.equal(report.summary.skipped, 0);
  assert.equal(report.nativeAcceptance, false);
});

test('full source closure is explicitly false at report, required gate and component levels', () => {
  const fixture = auditFixture();
  fixture.fullSourceClosureVerified = true;
  fixture.allComponentSourceReplayVerified = true;
  const report = evaluateRequiredSourceGates(fixture);
  assert.equal(report.fullSourceClosureVerified, false);
  assert.equal(report.compilerEvidence.fullSourceClosureVerified, false);
  assert.equal(report.compilerEvidence.backendEvidence.fullSourceClosureVerified, false);
  assert.equal(report.compilerEvidence.reconstructedUaaEvidence.fullSourceClosureVerified, false);
  assert.ok(report.checks.every(check => check.fullSourceClosureVerified === false));
  assert.ok(report.compilerEvidence.requiredComponents.every(component =>
    component.fullSourceClosureVerified === false && component.status === 'fail'));
  assert.deepEqual(report.summary, { required: 3, passed: 0, failed: 3, skipped: 0, rejectedSourceSkips: 0 });
  assert.equal(report.nativeAcceptance, false);
});

test('readiness diagnostics distinguish scanned Java files from stub findings without claiming closure', () => {
  const fixture = auditFixture();
  const task = fixture.sourceBuildEvidence.task30088;
  task.knownStubAudit.javaFiles = 33549;
  task.knownStubAudit.findings = [];
  task.ownSourceBytecodeClosure.archiveInputs = 218;
  const report = evaluateRequiredSourceGates(fixture);
  assert.deepEqual(report.checks[1].inputDiagnostics, {
    verification: 'readiness-observation-only-not-independent-source-closure',
    currentInputFingerprint: 'c'.repeat(64),
    scannedJavaFiles: 33549, knownStubFindings: 0, archiveInputs: 218, compiledInputs: 0,
  });
  const malformed = evaluateRequiredSourceGates(null).checks[1].inputDiagnostics;
  assert.equal(malformed.currentInputFingerprint, null);
  assert.equal(malformed.scannedJavaFiles, null);
  assert.equal(malformed.knownStubFindings, null);
  assert.equal(malformed.archiveInputs, null);
  assert.equal(malformed.compiledInputs, null);
  assert.equal(report.summary.failed, 3);
  assert.equal(report.summary.skipped, 0);
});

for (const [name, change] of [
  ['missing source gate', report => report.checks.pop()],
  ['duplicate source gate', report => report.checks.push(report.checks.at(-1))],
  ['skipped source gate', report => { report.checks.at(-1).status = 'skip'; }],
  ['failed source gate', report => { report.checks.at(-1).status = 'blocked'; }],
  ['wrong service', report => { report.checks.at(-1).service = 'frontend'; }],
  ['prototype-named service', report => { report.checks.at(-1).service = '__proto__'; }],
  ['constructor-named service', report => { report.checks.at(-1).service = 'constructor'; }],
  ['summary-only pass', report => { report.checks = []; }],
  ['inconsistent per-service checks', report => { report.services.task30088 = []; }],
  ['invented native acceptance', report => { report.nativeAcceptance = true; }],
  ['invented Docker compiler evidence', report => { report.compilerBuildInDockerVerified = true; }],
  ['build runner replacing read-only audit', report => { report.runBuild = true; }],
  ['missing independent input fingerprints', report => { delete report.sourceBuildEvidence; }],
  ['legacy commit-only inputs', report => { delete report.sourceBuildEvidence.task30088.recordedInputContract; }],
  ['malformed artifact digest', report => { report.sourceBuildEvidence.task30088.artifactSha256 = 'claimed'; }],
  ['unverified receipt', report => { report.sourceBuildEvidence.task30088.receiptState = 'parsed'; }],
  ['missing compiler exit evidence', report => { delete report.sourceBuildEvidence.task30088.buildExitCode; }],
  ['failed compiler exit evidence', report => { report.sourceBuildEvidence.task30088.buildExitCode = 1; }],
  ['string compiler exit evidence', report => { report.sourceBuildEvidence.task30088.buildExitCode = '0'; }],
  ['incorrect build platform', report => { report.sourceBuildEvidence.task30088.recordedPlatform = 'linux/amd64'; }],
  ['missing current committed source binding', report => { delete report.source; }],
  ['unknown recorded source commit', report => { report.sourceBuildEvidence.task30088.recordedSourceCommit = 'unknown'; }],
  ['wrong current committed source binding', report => { report.source.taskCommit = 'f'.repeat(40); }],
  ['missing independent image observation', report => { delete report.sourceBuildEvidence.task30088.sourceImageObservation; }],
  ['controlled image observation promoted to live', report => {
    report.sourceBuildEvidence.task30088.sourceImageObservation.evidenceOrigin = 'controlled-runner-not-native-evidence';
  }],
  ['single image observation promoted to stable', report => {
    report.sourceBuildEvidence.task30088.sourceImageObservation.observations = 1;
  }],
  ['image observation promoted to compiler proof', report => {
    report.sourceBuildEvidence.task30088.sourceImageObservation.verification = 'compiler-executed-in-docker';
  }],
  ['image observation has no identity', report => { delete report.sourceBuildEvidence.task30088.sourceImageObservation.imageId; }],
  ['image observation fingerprint differs', report => {
    report.sourceBuildEvidence.task30088.sourceImageObservation.currentInputFingerprint = 'f'.repeat(64);
  }],
  ['image observation commit differs', report => {
    report.sourceBuildEvidence.task30088.sourceImageObservation.sourceCommit = 'f'.repeat(40);
  }],
  ['image observation artifact differs', report => {
    report.sourceBuildEvidence.task30088.sourceImageObservation.artifactSha256 = 'f'.repeat(64);
  }],
  ['image observation option-like tag', report => {
    report.sourceBuildEvidence.task30088.sourceImageObservation.imageTag = '--format=claimed';
  }],
  ['image observation wrong platform', report => {
    report.sourceBuildEvidence.task30088.sourceImageObservation.platform = 'linux/amd64';
  }],
  ['empty current input inventory', report => { report.sourceBuildEvidence.task30088.currentInputs.files = 0; }],
  ['missing standalone UAA target gate', report => {
    report.checks = report.checks.filter(check => check.id !== 'uaa-standalone-auth-source');
  }],
  ['legacy UAA source replacing standalone target', report => {
    delete report.sourceBuildEvidence.uaa32666.standaloneAuthSource;
  }],
  ['wrong standalone UAA target', report => {
    report.sourceBuildEvidence.uaa32666.standaloneAuthSource.target = 'legacy-ibzuser';
  }],
  ['stale standalone UAA inventory', report => {
    report.sourceBuildEvidence.uaa32666.standaloneAuthSource.currentInputFingerprint = 'f'.repeat(64);
  }],
  ['missing standalone UAA implementation', report => {
    report.sourceBuildEvidence.uaa32666.standaloneAuthSource.missingInputs = ['BootSecurityConfig.java'];
  }],
  ['copied standalone UAA source claim', report => {
    report.sourceBuildEvidence.uaa32666.standaloneAuthSource.presentInputs = [];
  }],
  ['duplicate standalone UAA source claim', report => {
    const source = report.sourceBuildEvidence.uaa32666.standaloneAuthSource;
    source.presentInputs[0] = source.presentInputs[1];
  }],
  ['unsafe standalone UAA source claim', report => {
    const source = report.sourceBuildEvidence.uaa32666.standaloneAuthSource;
    source.presentInputs[0].path = `../${source.presentInputs[0].required}`;
  }],
  ['compiled standalone UAA implementation', report => {
    report.sourceBuildEvidence.uaa32666.standaloneAuthSource.presentInputs[0].path += '.class';
  }],
  ['invented standalone UAA source digest', report => {
    report.sourceBuildEvidence.uaa32666.standaloneAuthSource.presentInputs[0].sha256 = 'claimed';
  }],
  ['missing standalone UAA protocol gate', report => {
    report.checks = report.checks.filter(check => check.id !== 'uaa-standalone-auth-protocol-closure');
  }],
  ['missing standalone UAA protocol diagnostics', report => {
    delete report.sourceBuildEvidence.uaa32666.standaloneAuthProtocol;
  }],
  ['missing standalone runtime binding gate', report => {
    report.checks = report.checks.filter(check => check.id !== 'uaa-standalone-runtime-binding');
  }],
  ['missing standalone runtime observation', report => { delete report.runtimeTargetObservation; }],
  ['failed standalone runtime observation', report => { report.runtimeTargetObservation.ok = false; }],
  ['controlled runtime observation promoted to live', report => {
    report.runtimeTargetObservation.evidence.evidenceOrigin = 'controlled-runner-not-native-evidence';
  }],
  ['runtime observation promoted to source closure', report => {
    report.runtimeTargetObservation.evidence.sourceRuntimeCompatible = true;
  }],
  ['runtime observation promoted to effective encoder', report => {
    report.runtimeTargetObservation.evidence.effectivePasswordEncoderVerified = true;
  }],
  ['runtime observation promoted to native acceptance', report => {
    report.runtimeTargetObservation.evidence.nativeAcceptance = true;
  }],
  ['runtime observation binds legacy JAR', report => {
    report.runtimeTargetObservation.evidence.runtimeJarPath = '/ibzuaa.jar';
  }],
  ['runtime observation JAR hash differs', report => {
    report.runtimeTargetObservation.evidence.localJarSha256 = 'e'.repeat(64);
  }],
  ['invented standalone UAA protocol verification', report => {
    report.sourceBuildEvidence.uaa32666.standaloneAuthProtocol.state = 'verified';
  }],
  ['stale standalone UAA protocol inputs', report => {
    report.sourceBuildEvidence.uaa32666.standaloneAuthProtocol.currentInputFingerprint = 'f'.repeat(64);
  }],
  ['legacy standalone UAA endpoint substitution', report => {
    report.sourceBuildEvidence.uaa32666.standaloneAuthProtocol.requiredContract.path = '/uaa/login';
  }],
  ['legacy standalone UAA principal substitution', report => {
    report.sourceBuildEvidence.uaa32666.standaloneAuthProtocol.requiredContract.principalTable = 'IBZUSER';
  }],
  ['legacy standalone UAA encoder substitution', report => {
    report.sourceBuildEvidence.uaa32666.standaloneAuthProtocol.requiredContract.passwordStorageProperty = 'ibiz.auth.pwencrymode';
  }],
  ['packaged SM3 treated as effective encoder proof', report => {
    report.sourceBuildEvidence.uaa32666.standaloneAuthProtocol.requiredContract.passwordEncoder.effectiveRuntimeSelectionRequired = false;
  }],
  ['incorrect standalone SM3 normalization', report => {
    report.sourceBuildEvidence.uaa32666.standaloneAuthProtocol.requiredContract.passwordEncoder.sm3Digest = 'lowercase-64-hex';
  }],
  ['missing standalone encoder fallback', report => {
    delete report.sourceBuildEvidence.uaa32666.standaloneAuthProtocol.requiredContract.passwordEncoder.fallback;
  }],
  ['login grants promoted to fine-grant proof', report => {
    report.sourceBuildEvidence.uaa32666.standaloneAuthProtocol.requiredContract.loginRoleAuthorities = 'fine-grant-evidence';
  }],
  ['UID used as standalone membership primary key', report => {
    report.sourceBuildEvidence.uaa32666.standaloneAuthProtocol.requiredContract.roleMemberPersonKey = 'sys_role_member.MEMBER_UID -> sys_person.UID';
  }],
  ['domain organization join verification dropped', report => {
    delete report.sourceBuildEvidence.uaa32666.standaloneAuthProtocol.requiredContract.principalOrganizationKey;
  }],
  ['privileged UAA authority and RT role ID conflated', report => {
    report.sourceBuildEvidence.uaa32666.standaloneAuthProtocol.requiredContract.privilegedRoleSelection.rtField = 'sys_role.AUTHORITY';
  }],
  ['missing independent standalone verification requirements', report => {
    delete report.sourceBuildEvidence.uaa32666.standaloneAuthProtocol.requiredVerification;
  }],
  ['static artifact binding replacing source runtime closure', report => {
    report.sourceBuildEvidence.uaa32666.standaloneAuthProtocol.requiredVerification = ['running-image-entrypoint-artifact-binding'];
  }],
  ['missing own-bytecode closure gate', report => {
    report.checks = report.checks.filter(check => check.id !== 'task-own-source-bytecode-closure');
  }],
  ['blocked own-bytecode closure gate', report => {
    report.checks.find(check => check.id === 'task-own-source-bytecode-closure').status = 'blocked';
  }],
  ['missing own-bytecode diagnostics', report => { delete report.sourceBuildEvidence.task30088.ownSourceBytecodeClosure; }],
  ['claimed own-bytecode diagnostic success', report => {
    report.sourceBuildEvidence.task30088.ownSourceBytecodeClosure.state = 'verified';
  }],
  ['stale own-bytecode diagnostics', report => {
    report.sourceBuildEvidence.task30088.ownSourceBytecodeClosure.currentInputFingerprint = 'f'.repeat(64);
  }],
  ['wrong own-bytecode diagnostic contract', report => {
    report.sourceBuildEvidence.task30088.ownSourceBytecodeClosure.contract = 'claimed-bytecode';
  }],
  ['missing own-bytecode inventory', report => {
    delete report.sourceBuildEvidence.task30088.ownSourceBytecodeClosure.compiledInputs;
  }],
  ['unsafe own-bytecode inventory', report => {
    report.sourceBuildEvidence.task30088.ownSourceBytecodeClosure.compiledInputs = [
      { path: '../Own.class', bytes: 1, sha256: 'a'.repeat(64) },
    ];
  }],
  ['duplicate own-bytecode inventory', report => {
    report.sourceBuildEvidence.task30088.ownSourceBytecodeClosure.compiledInputs = [
      { path: 'Own.class', bytes: 1, sha256: 'a'.repeat(64) },
      { path: 'Own.class', bytes: 1, sha256: 'a'.repeat(64) },
    ];
  }],
  ['wrong own-bytecode inventory suffix', report => {
    report.sourceBuildEvidence.task30088.ownSourceBytecodeClosure.compiledInputs = [
      { path: 'Own.java', bytes: 1, sha256: 'a'.repeat(64) },
    ];
  }],
  ['negative own-bytecode archive count', report => {
    report.sourceBuildEvidence.task30088.ownSourceBytecodeClosure.archiveInputs = -1;
  }],
  ['archive count exceeds input roster', report => {
    report.sourceBuildEvidence.task30088.ownSourceBytecodeClosure.archiveInputs = 100;
  }],
  ['missing known-stub audit', report => { delete report.sourceBuildEvidence.task30088.knownStubAudit; }],
  ['stale known-stub audit', report => {
    report.sourceBuildEvidence.task30088.knownStubAudit.currentInputFingerprint = 'f'.repeat(64);
  }],
  ['known-stub Java count exceeds input roster', report => {
    report.sourceBuildEvidence.task30088.knownStubAudit.javaFiles = 100;
  }],
  ['unresolved known decompiler stub', report => {
    report.sourceBuildEvidence.task30088.knownStubAudit.findings = [{ path: 'Source.java', line: 1 }];
  }],
]) {
  test(`aggregate rejects ${name} even with readiness=true`, () => {
    const fixture = auditFixture();
    change(fixture);
    const report = evaluateRequiredSourceGates(fixture);
    assert.equal(report.status, 'failed');
    assert.ok(report.checks.slice(0, 2).some(check => check.status === 'fail'));
    assert.ok(report.checks.some(check => /Missing, duplicate, skipped, failed or inconsistent/.test(check.reason)
      || /No independent UAA source closure evidence requested/.test(check.reason)),
    'Malformed evidence must be rejected structurally, not just by unavailable canonical UAA evidence');
    assert.equal(report.summary.skipped, 0);
    assert.equal(report.summary.rejectedSourceSkips, name === 'skipped source gate' ? 1 : 0);
    assert.equal(report.nativeAcceptance, false);
  });
}

test('one blocked service cannot drop the other service or the Docker compiler gate', () => {
  const fixture = auditFixture();
  fixture.checks.at(-1).status = 'blocked';
  fixture.readiness.task30088 = false;
  const report = evaluateRequiredSourceGates(fixture);
  assert.deepEqual(report.checks.map(check => check.status), ['fail', 'fail', 'fail']);
  assert.equal(report.summary.required, 3);
  assert.equal(report.summary.skipped, 0);
  assert.deepEqual(report.checks[1].unmetChecks, ['task-source-image-evidence']);
  assert.deepEqual(report.checks[0].unmetChecks, []);
});

for (const malformed of [null, {}, { checks: {} }, { checks: [null] }, { checks: 'pass' }]) {
  test(`malformed source evidence produces required failures: ${JSON.stringify(malformed)}`, () => {
    const report = evaluateRequiredSourceGates(malformed);
    assert.equal(report.summary.failed, 3);
    assert.equal(report.summary.skipped, 0);
  });
}

function directory(t) {
  if (process.env.AIBIZ_REQUIRED_TEST_REPORT_DIR) {
    const parent = resolve(process.env.AIBIZ_REQUIRED_TEST_REPORT_DIR);
    fs.mkdirSync(parent, { recursive: true });
    return join(mkdtempSync(join(parent, 'case-')), 'new-audit');
  }
  const root = mkdtempSync(join(tmpdir(), 'required-source-gates-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return join(root, 'new-audit');
}

for (const [name, result] of [
  ['nonzero unexpected exit', { status: 2 }],
  ['signal with exit zero', { status: 0, signal: 'SIGTERM' }],
  ['launch failure', { status: null, error: new Error('controlled launch failure') }],
  ['timeout', { status: null, error: Object.assign(new Error('controlled timeout'), { code: 'ETIMEDOUT' }) }],
]) {
  test(`required runner preserves ${name} as three failures, no skips`, t => {
    const reportDir = directory(t);
    const { report, reportPath } = runRequiredSourceGates({
      reportDir, execute: () => result,
    });
    assert.equal(report.status, 'failed');
    assert.equal(report.summary.failed, 3);
    assert.equal(report.summary.skipped, 0);
    assert.deepEqual(JSON.parse(fs.readFileSync(reportPath)), report);
  });
}

for (const [name, stdout, file, status] of [
  ['malformed report', '[invalid]', '[invalid]', 0],
  ['missing report', '{}', null, 0],
  ['stdout differs', '{}', JSON.stringify(auditFixture()), 0],
  ['failed exit contradicts all-ready report', JSON.stringify(auditFixture()), JSON.stringify(auditFixture()), 1],
]) {
  test(`required runner rejects ${name} without swallowing the failure`, t => {
    const { report } = runRequiredSourceGates({
      reportDir: directory(t),
      execute(_command, _args, options) {
        if (file !== null) fs.writeFileSync(options.env.UAA_TASK_READINESS_REPORT, file);
        return { status, signal: null, stdout };
      },
    });
    assert.equal(report.summary.failed, 3);
    assert.equal(report.summary.skipped, 0);
    assert.equal(report.errors.length, 1);
  });
}

test('runner launches only the read-only audit and clears inherited Node injection', t => {
  const fixture = auditFixture();
  const { report } = runRequiredSourceGates({
    reportDir: directory(t),
    execute(command, args, options) {
      assert.equal(command, process.execPath);
      assert.equal(args.length, 1);
      assert.ok(args[0].endsWith('/harness-uaa-task-readiness.mjs'));
      assert.ok(!args.includes('--build'));
      assert.equal(options.env.NODE_OPTIONS, '');
      assert.equal(options.env.NODE_PATH, '');
      assert.equal(options.timeout, 60_000);
      const data = JSON.stringify(fixture);
      fs.writeFileSync(options.env.UAA_TASK_READINESS_REPORT, data);
      return { status: 0, signal: null, stdout: data };
    },
  });
  assert.equal(report.summary.passed, 0);
  assert.equal(report.summary.failed, 3);
  assert.equal(report.status, 'failed');
  assert.equal(report.evidence, 'controlled-runner-not-native-evidence');
  assert.equal(report.nativeAcceptance, false);
  assert.match(report.readinessEvidence.sha256, /^[a-f0-9]{64}$/);
});

for (const key of [
  'uaaRuntimeRequest', 'uaaRuntimeReceipt', 'taskBuildReceipt', 'taskCompilerReceipt',
  'readinessReport', 'ownSourceClosureVerified', 'nativeAcceptance', 'skip',
]) {
  test(`unsupported ${key} cannot be silently dropped by the required API`, t => {
    let launched = false;
    const { report, reportPath } = runRequiredSourceGates({
      reportDir: directory(t),
      execute() { launched = true; assert.fail('Rejected configuration must not launch readiness'); },
      compilerExecute() { launched = true; assert.fail('Rejected configuration must not launch Docker'); },
      backendBuildRequest: backendRequest(),
      uaaCompilerRequest: uaaReplayRequest(),
      [key]: { status: 'passed', secret: 'must-not-appear-in-report', nativeAcceptance: true },
    });
    assert.equal(launched, false);
    assert.equal(report.evidence, 'rejected-run-configuration-not-source-evidence');
    assert.equal(report.status, 'failed');
    assert.deepEqual(report.summary,
      { required: 3, passed: 0, failed: 3, skipped: 0, rejectedSourceSkips: 0 });
    assert.equal(report.command.exitCode, null);
    assert.deepEqual(report.errors, [`Unsupported required source gate option: ${key}`]);
    assert.equal(report.fullSourceClosureVerified, false);
    assert.equal(report.nativeAcceptance, false);
    assert.deepEqual(JSON.parse(fs.readFileSync(reportPath)), report);
    assert.ok(!fs.readFileSync(reportPath, 'utf8').includes('must-not-appear-in-report'));
    assert.deepEqual(fs.readdirSync(dirname(reportPath)), ['report.json']);
  });
}

for (const [key, value] of [
  ['execute', null], ['execute', true], ['compilerExecute', 'claimed'],
]) {
  test(`malformed ${key} is retained as a configuration failure before launching any runner`, t => {
    const { report, reportPath } = runRequiredSourceGates({
      reportDir: directory(t), [key]: value,
    });
    assert.equal(report.summary.failed, 3);
    assert.equal(report.summary.skipped, 0);
    assert.deepEqual(report.errors, [`Required source gate ${key} must be a function`]);
    assert.equal(report.command.exitCode, null);
    assert.deepEqual(JSON.parse(fs.readFileSync(reportPath)), report);
  });
}

test('unsupported scoped UAA runtime evidence is rejected by the CLI instead of treated as source closure', () => {
  for (const option of ['--uaa-runtime-request', '--uaa-runtime-receipt', '--task-build-receipt']) {
    assert.throws(() => main([option, 'claimed']), /Unknown option/);
  }
});

test('existing audit directories are not overwritten', t => {
  const reportDir = directory(t);
  fs.mkdirSync(reportDir);
  assert.throws(() => runRequiredSourceGates({ reportDir }), /must not be overwritten/);
});

test('thrown launch failures still retain a failed mandatory report', t => {
  const { report, reportPath } = runRequiredSourceGates({
    reportDir: directory(t),
    execute() { throw new Error('controlled thrown launch failure'); },
  });
  assert.equal(report.summary.failed, 3);
  assert.equal(report.summary.skipped, 0);
  assert.equal(report.errors.length, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(reportPath)), report);
});

for (const cause of [null, undefined, 'controlled string failure']) {
  test(`non-Error launch failure still retains all failed gates: ${String(cause)}`, t => {
    const { report, reportPath } = runRequiredSourceGates({
      reportDir: directory(t), execute() { throw cause; },
    });
    assert.equal(report.summary.failed, 3);
    assert.equal(report.summary.skipped, 0);
    assert.equal(report.errors.length, 1);
    assert.deepEqual(JSON.parse(fs.readFileSync(reportPath)), report);
  });
}

test('symlinked audit directories and evidence are rejected', t => {
  const reportDir = directory(t);
  const target = join(reportDir, '..', 'outside');
  fs.mkdirSync(target);
  fs.symlinkSync(target, reportDir);
  assert.throws(() => runRequiredSourceGates({ reportDir }), /overwritten|Symlink/);
  assert.deepEqual(fs.readdirSync(target), []);
  fs.unlinkSync(reportDir);
  const { report } = runRequiredSourceGates({
    reportDir,
    execute(_command, _args, options) {
      const outside = join(target, 'readiness.json');
      const data = JSON.stringify(auditFixture());
      fs.writeFileSync(outside, data);
      fs.symlinkSync(outside, options.env.UAA_TASK_READINESS_REPORT);
      return { status: 0, signal: null, stdout: data };
    },
  });
  assert.equal(report.summary.failed, 3);
  assert.match(report.errors[0], /Symlink/);
});

test('required CLI has no off/auto/skip mode or supplied receipt promotion', () => {
  for (const args of [['--mode', 'off'], ['--skip-compiler'], ['--readiness-report', 'fixture.json']]) {
    assert.throws(() => main(args), /Unknown option/);
  }
  assert.equal(main(['--help']), 0);
});

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const productionRoot = 'ibiz-service-hub/libs/ibiz-runtime/src/main/java/net/ibizsys/runtime/util/template';
const compilerRequest = () => ({
  component: 'modeling-backend', root: productionRoot,
  receiptPath: '/nonexistent/compiler-receipt.json', expectedImageId: `sha256:${'a'.repeat(64)}`,
});

test('required all-D01 lower-bound coverage is fixed, distinct from scoped compiler mechanics', () => {
  assert.ok(Object.isFrozen(REQUIRED_D01_COMPONENTS));
  const report = evaluateRequiredSourceGates(auditFixture());
  assert.deepEqual(report.checks[2].unmetComponents, [...REQUIRED_D01_COMPONENTS]);
  const coverage = report.compilerEvidence;
  assert.equal(coverage.componentInventoryVerified, false);
  assert.equal(coverage.allRequiredComponentsVerified, false);
  assert.equal(coverage.mechanismVerifiedForScopes, false);
  assert.deepEqual(coverage.requiredComponents.map(item => item.component), [...REQUIRED_D01_COMPONENTS]);
  assert.equal(coverage.requiredComponents.every(item => item.required && item.status === 'fail'), true);
  assert.equal(coverage.summary.skipped, 0);
  assert.ok(coverage.requiredComponents.some(item => item.component === 'uaa-standalone'));
  assert.ok(coverage.requiredComponents.some(item => item.component === 'task'));
  assert.ok(coverage.requiredComponents.some(item => item.component === 'runtime-model'));
});

test('component evidence selector accepts only the four pinned partial-evidence reports', () => {
  const request = componentEvidenceRequest();
  const selected = selectRequiredComponentEvidenceRequest(request);
  assert.equal(selected.backendImageReport, join(workspace, request.backendImageReport));
  assert.deepEqual(request, componentEvidenceRequest());
  for (const mutation of [
    () => ({ ...request, backendImageReport: '.artifacts/other/report.json' }),
    () => ({ ...request, extra: true }),
    () => ({ ...request, runtimeModelSourceReport: undefined }),
    () => null,
  ]) assert.throws(() => selectRequiredComponentEvidenceRequest(mutation()));
});

test('partial component evidence audit exposes capabilities and blockers without D01 promotion', () => {
  const evidence = verifyRequiredComponentEvidence(componentEvidenceRequest());
  assert.equal(evidence.status, 'passed-partial-evidence-audit');
  assert.equal(evidence.nativeAcceptance, false);
  assert.equal(evidence.fullSourceClosureVerified, false);
  for (const component of ['modeling-backend', 'allinone', 'gateway']) {
    assert.equal(evidence.capabilities[component].currentSourcePackageInDockerVerified, true);
    assert.equal(evidence.capabilities[component].imageArtifactBindingVerified, true);
    assert.equal(evidence.capabilities[component].sourceBuildVerified, false);
  }
  assert.equal(evidence.capabilities['runtime-model'].sourceBuildVerified, true);
  assert.equal(evidence.capabilities['runtime-model'].reproducibleBuildVerified, true);
  assert.equal(evidence.capabilities['native-cli'].sourceBuildVerified, true);
  assert.equal(evidence.capabilities['native-cli'].reproducibleBuildVerified, false);
  assert.equal(evidence.capabilities['plm-backend'].sourceBuildVerified, true);
  assert.equal(evidence.capabilities['plm-backend'].runtimeCompatibilityVerified, true);
  assert.equal(evidence.capabilities['plm-backend'].apiRegressionVerified, true);
  for (const component of REQUIRED_D01_COMPONENTS.filter(component => component !== 'plm-backend')) {
    assert.equal(evidence.capabilities[component].ownDependencySourceClosureVerified ?? false, false);
    assert.ok(evidence.capabilities[component].blockers.length > 0);
  }
  assert.equal(evidence.capabilities['plm-backend'].ownDependencySourceClosureVerified, true);

  const report = evaluateRequiredSourceGates(
    auditFixture(), [], undefined, undefined, undefined, undefined, componentEvidenceRequest(),
  );
  assert.equal(report.status, 'failed');
  assert.equal(report.summary.failed, 3);
  assert.equal(report.fullSourceClosureVerified, false);
  assert.equal(report.nativeAcceptance, false);
  assert.equal(report.compilerEvidence.allRequiredComponentsVerified, false);
  assert.deepEqual(report.checks[2].unmetComponents, [...REQUIRED_D01_COMPONENTS]);
  const components = Object.fromEntries(report.compilerEvidence.requiredComponents
    .map(item => [item.component, item]));
  assert.equal(components['modeling-backend'].imageArtifactBindingVerified, true);
  assert.equal(components['runtime-model'].sourceBuildVerified, true);
  assert.equal(components['native-cli'].sourceBuildVerified, true);
  assert.equal(components['plm-backend'].sourceBuildVerified, true);
  assert.equal(components['plm-backend'].runtimeCompatibilityVerified, true);
  assert.equal(components['plm-backend'].apiRegressionVerified, true);
  assert.equal(components['plm-backend'].ownDependencySourceClosureVerified, true);
  assert.equal(components['plm-frontend'].sourceBuildVerified, false);
  assert.match(components['modeling-backend'].reason, /partial evidence exists/);
  assert.match(components['plm-frontend'].reason, /verifier is not integrated/);
  for (const item of report.compilerEvidence.requiredComponents) {
    assert.equal(item.status, 'fail');
    assert.equal(item.fullComponentBuildVerified, false);
    assert.equal(item.fullSourceClosureVerified, false);
  }
});

test('partial component evidence failure cannot hide missing component blockers', () => {
  const evidence = verifyRequiredComponentEvidence({
    ...componentEvidenceRequest(),
    nativeCliSourceReport: '.artifacts/native-cli-source-build/not-a-real-report/report.json',
  });
  assert.equal(evidence.status, 'fail');
  assert.equal(evidence.nativeAcceptance, false);
  assert.equal(evidence.fullSourceClosureVerified, false);
  assert.equal(evidence.capabilities['native-cli'].sourceBuildVerified, false);
  assert.ok(evidence.blockers.length > 0);
});

for (const [name, backendScope, uaaScope, requested] of [
  ['backend only', { request: backendRequest(), error: 'package failed' }, undefined, 1],
  ['UAA only', undefined, { request: uaaReplayRequest(), error: 'implicit-classpath' }, 1],
  ['both', { request: backendRequest(), error: 'package failed' },
    { request: uaaReplayRequest(), error: 'implicit-classpath' }, 2],
  ['malformed attempts', null, null, 2],
]) {
  test(`coverage includes ${name} failures even when no Java projection was requested`, () => {
    const report = evaluateRequiredSourceGates(auditFixture(), [], backendScope, uaaScope);
    assert.deepEqual(report.compilerEvidence.summary,
      { requested, passed: 0, failed: requested, skipped: 0 });
    assert.deepEqual(report.compilerEvidence.projectionSummary,
      { requested: 0, passed: 0, failed: 0, skipped: 0 });
    assert.equal(report.compilerEvidence.summaryScope,
      'requested-scoped-evidence-only-not-required-component-closure');
    assert.equal(report.summary.failed, 3);
    assert.equal(report.fullSourceClosureVerified, false);
    assert.equal(report.nativeAcceptance, false);
  });
}

test('coverage counts projection, backend and UAA attempts without dropping malformed projection failures', () => {
  const report = evaluateRequiredSourceGates(auditFixture(),
    [{ request: compilerRequest(), error: 'javac failed' }],
    { request: backendRequest(), error: 'package failed' },
    { request: uaaReplayRequest(), error: 'implicit-classpath' });
  assert.deepEqual(report.compilerEvidence.summary, { requested: 3, passed: 0, failed: 3, skipped: 0 });
  assert.deepEqual(report.compilerEvidence.projectionSummary, { requested: 1, passed: 0, failed: 1, skipped: 0 });
  assert.equal(report.compilerEvidence.mechanismVerifiedForScopes, false);
  assert.equal(report.compilerEvidence.allRequiredComponentsVerified, false);
  assert.deepEqual(report.checks[2].unmetComponents, [...REQUIRED_D01_COMPONENTS]);
});

for (const [name, claimedEvidence] of [
  ['Task input screen', {
    contract: 'task-bytecode-input-screen-v1', status: 'passed-input-screen-only',
    sourceClosureVerified: false, compilerBuildInDockerVerified: false, nativeAcceptance: false,
  }],
  ['Task three-class audit', {
    contract: 'task7-loose-class-source-regression-evidence-v1',
    status: 'focused-and-three-original-class-audit-passed-not-native-accepted',
    originalSourceAuthenticityVerified: false, nativeAcceptance: false,
  }],
  ['image packaging', { status: 'pass', imageArtifactBindingVerified: true, nativeAcceptance: false }],
  ['actual Boot HTTP claim', { status: 'pass', actualBootHttpScopedVerified: true, nativeAcceptance: false }],
  ['native permission claim', { status: 'pass', nativePermissionVerified: true, nativeAcceptance: true }],
]) {
  test(`${name} cannot supply the missing independent source closure capability`, () => {
    const fixture = auditFixture();
    fixture.sourceBuildEvidence.task30088.ownSourceBytecodeClosure = claimedEvidence;
    fixture.sourceBuildEvidence.uaa32666.standaloneAuthProtocol = claimedEvidence;
    const report = evaluateRequiredSourceGates(fixture);
    assert.equal(report.summary.passed, 0);
    assert.equal(report.summary.failed, 3);
    assert.equal(report.summary.skipped, 0);
    assert.equal(report.compilerBuildInDockerVerified, false);
    assert.equal(report.fullSourceClosureVerified, false);
    assert.equal(report.nativeAcceptance, false);
    assert.equal(report.compilerEvidence.allRequiredComponentsVerified, false);
  });
}

for (const [name, mutate] of [
  ['unknown component', request => { request.component = 'frontend-success'; }],
  ['prototype component', request => { request.component = '__proto__'; }],
  ['array component', request => { request.component = ['modeling-backend']; }],
  ['legacy UAA treated as standalone', request => {
    request.component = 'uaa-standalone';
    request.root = 'vendor-upstream/ibizlab-runtime/ibzuaa/src/main/java';
  }],
  ['root outside component', request => { request.root = '/tmp/synthetic/src/main/java'; }],
  ['wrong service root', request => { request.component = 'task'; }],
  ['source traversal', request => { request.root = 'ibiz-service-hub/../task7/src/main/java'; }],
  ['implicit whole component', request => { request.root = 'ibiz-service-hub'; }],
  ['test source', request => { request.root = 'ibiz-service-hub/module/src/test/java'; }],
  ['fixture source', request => { request.root = 'ibiz-service-hub/fixtures/src/main/java'; }],
  ['generated source', request => { request.root = 'ibiz-service-hub/target/src/main/java'; }],
  ['unselected image', request => { delete request.expectedImageId; }],
  ['claimed image tag', request => { request.expectedImageId = 'eclipse-temurin:17-jdk'; }],
  ['missing receipt path', request => { delete request.receiptPath; }],
  ['empty receipt path', request => { request.receiptPath = ''; }],
  ['nonstring receipt path', request => { request.receiptPath = true; }],
  ['receipt path newline', request => { request.receiptPath = 'receipt.json\n'; }],
  ['receipt path nul', request => { request.receiptPath = 'receipt.json\0'; }],
  ['receipt path whitespace', request => { request.receiptPath = '  '; }],
  ['unknown promotion field', request => { request.fullComponentBuildVerified = true; }],
]) {
  test(`compiler projection rejects ${name} and keeps required coverage failed`, () => {
    const request = compilerRequest();
    mutate(request);
    const report = evaluateRequiredSourceGates(auditFixture(), [{
      request, result: { report: { compilerBuildInDockerVerified: true } },
    }]);
    assert.equal(report.compilerEvidence.summary.failed, 1);
    assert.equal(report.compilerEvidence.projections[0].status, 'fail');
    assert.equal(report.compilerEvidence.allRequiredComponentsVerified, false);
    assert.equal(report.compilerBuildInDockerVerified, false);
    assert.equal(report.summary.failed, 3);
    assert.equal(report.summary.skipped, 0);
  });
}

test('compiler request component must be a string before source or Docker verification', t => {
  const { report, reportPath } = runRequiredSourceGates({
    reportDir: directory(t), execute: controlledAudit,
    compilerRequests: [{ ...compilerRequest(), component: ['modeling-backend'] }],
    compilerExecute() { assert.fail('Invalid component must not invoke Docker'); },
  });
  assert.equal(report.compilerEvidence.summary.failed, 1);
  assert.match(report.compilerEvidence.projections[0].reason, /component/);
  assert.equal(Object.hasOwn(report.compilerEvidence.projections[0], 'component'), false);
  assert.equal(report.summary.failed, 3);
  assert.equal(report.summary.skipped, 0);
  assert.deepEqual(JSON.parse(fs.readFileSync(reportPath)), report);
});

for (const scopes of [null, {}, 'passed', [null], Array(13).fill({})]) {
  test(`malformed scoped evidence retains D01 failure: ${JSON.stringify(scopes)}`, () => {
    const report = evaluateRequiredSourceGates(null, scopes);
    assert.equal(report.compilerEvidence.summary.failed, 1);
    assert.equal(report.compilerEvidence.mechanismVerifiedForScopes, false);
    assert.equal(report.summary.failed, 3);
    assert.equal(report.summary.skipped, 0);
  });
}

test('sparse scoped evidence becomes an explicit failed projection rather than throwing or dropping it', () => {
  const scopes = new Array(2);
  scopes[1] = { error: 'failed scope' };
  const report = evaluateRequiredSourceGates(null, scopes);
  assert.equal(report.compilerEvidence.summary.requested, 2);
  assert.equal(report.compilerEvidence.summary.failed, 2);
  assert.equal(report.compilerEvidence.summary.skipped, 0);
  assert.equal(report.compilerEvidence.projections.length, 2);
  assert.equal(report.compilerEvidence.projections.every(scope => scope.status === 'fail'), true);
  assert.equal(report.compilerEvidence.mechanismVerifiedForScopes, false);
  assert.equal(report.summary.failed, 3);
});

for (const [name, result] of [
  ['numeric path', { receiptPath: 12, receiptSha256: 'a'.repeat(64) }],
  ['object path', { receiptPath: {}, receiptSha256: 'a'.repeat(64) }],
  ['nul path', { receiptPath: 'untrusted\0.json', receiptSha256: 'a'.repeat(64) }],
  ['newline path', { receiptPath: 'untrusted\n.json', receiptSha256: 'a'.repeat(64) }],
  ['whitespace path', { receiptPath: '  ', receiptSha256: 'a'.repeat(64) }],
  ['fake digest', { receiptPath: '/untrusted/receipt.json', receiptSha256: 'claimed' }],
]) {
  test(`untrusted ${name} cannot crash or become failed-scope receipt evidence`, () => {
    const report = evaluateRequiredSourceGates(null, [{ request: compilerRequest(), result }]);
    const projection = report.compilerEvidence.projections[0];
    assert.equal(projection.status, 'fail');
    assert.equal(Object.hasOwn(projection, 'receiptPath'), false);
    assert.equal(Object.hasOwn(projection, 'receiptSha256'), false);
    assert.equal(report.compilerEvidence.summary.failed, 1);
    assert.equal(report.summary.failed, 3);
    assert.equal(report.summary.skipped, 0);
  });
}

function controlledAudit(_command, _args, options) {
  const data = JSON.stringify(auditFixture());
  fs.writeFileSync(options.env.UAA_TASK_READINESS_REPORT, data);
  return { status: 0, signal: null, stdout: data };
}

test('production scoped Docker compile and fresh replay are recorded, never all-D01/native promotion', t => {
  const reportDir = directory(t);
  const initial = runCompilerInDocker({
    root: join(workspace, productionRoot), output: join(dirname(reportDir), 'original-compiler'),
    sourceLabel: 'existing-production-interface-projection',
  });
  assert.equal(initial.exitCode, 0, JSON.stringify(initial.report.errors));
  const request = {
    ...compilerRequest(), receiptPath: initial.receiptPath,
    expectedImageId: initial.report.compiler.imageId,
  };
  const evaluated = evaluateRequiredSourceGates(auditFixture(), [{ request, result: initial }]);
  assert.equal(evaluated.compilerEvidence.summary.passed, 1);
  assert.equal(evaluated.compilerEvidence.mechanismVerifiedForScopes, true);
  assert.equal(evaluated.summary.failed, 3);
  assert.equal(evaluated.compilerBuildInDockerVerified, false);
  assert.equal(evaluated.compilerEvidence.allRequiredComponentsVerified, false);
  assert.equal(evaluated.compilerEvidence.projections[0].fullComponentBuildVerified, false);
  assert.equal(evaluated.compilerEvidence.projections[0].ownSourceClosure.projectionSourceClosureVerified, true);
  assert.equal(evaluated.compilerEvidence.projections[0].ownSourceClosure.fullComponentSourceClosureVerified, false);
  assert.equal(evaluated.compilerEvidence.requiredComponents.every(item => item.status === 'fail'), true);

  for (const copy of [{ ...initial }, JSON.parse(JSON.stringify(initial)), {
    ...initial, report: { ...initial.report, compilerBuildInDockerVerified: true },
  }]) {
    assert.equal(evaluateRequiredSourceGates(auditFixture(), [{ request, result: copy }])
      .compilerEvidence.summary.failed, 1);
    assert.equal(verifyScopedOwnSourceClosure({ request, result: copy }).status, 'fail');
  }
  const initialClosure = verifyScopedOwnSourceClosure({ request, result: initial });
  assert.equal(initialClosure.status, 'pass');
  assert.equal(initialClosure.nativeAcceptance, false);
  assert.equal(initialClosure.currentInputFingerprint, initial.report.source.inputs.fingerprint);
  assert.equal(initialClosure.compilerReceiptSha256, initial.receiptSha256);
  const mismatchedRequest = {
    ...request, receiptPath: join(dirname(reportDir), 'not-selected/receipt.json'),
  };
  const mismatched = evaluateRequiredSourceGates(auditFixture(), [{
    request: mismatchedRequest, result: initial,
  }]);
  assert.equal(mismatched.compilerEvidence.summary.failed, 1);
  assert.match(mismatched.compilerEvidence.projections[0].reason, /Requested compiler receipt differs/);
  assert.equal(verifyScopedOwnSourceClosure({ request: mismatchedRequest, result: initial }).status, 'fail');
  initial.verifiedReceiptSha256 = '0'.repeat(64);
  assert.equal(evaluateRequiredSourceGates(auditFixture(), [{ request, result: initial }])
    .compilerEvidence.summary.failed, 1);
  assert.equal(verifyScopedOwnSourceClosure({ request, result: initial }).status, 'fail');
  delete initial.verifiedReceiptSha256;
  const duplicate = evaluateRequiredSourceGates(auditFixture(), [
    { request, result: initial }, { request, result: initial },
  ]);
  assert.equal(duplicate.compilerEvidence.summary.failed, 1);
  assert.equal(duplicate.compilerEvidence.mechanismVerifiedForScopes, false);
  assert.match(duplicate.compilerEvidence.projections[1].reason, /Duplicate/);

  const { report, reportPath } = runRequiredSourceGates({
    reportDir, execute: controlledAudit, compilerRequests: [request],
  });
  assert.equal(report.compilerEvidence.summary.passed, 1, JSON.stringify(report.errors));
  assert.equal(report.compilerEvidence.summary.failed, 0);
  assert.equal(report.compilerEvidence.summary.skipped, 0);
  const projection = report.compilerEvidence.projections[0];
  assert.equal(projection.component, request.component);
  assert.equal(projection.root, productionRoot);
  assert.equal(projection.inputFingerprint, initial.report.source.inputs.fingerprint);
  assert.equal(projection.candidateReceiptSha256, initial.receiptSha256);
  assert.equal(projection.ownSourceClosure.projectionSourceClosureVerified, true);
  assert.equal(projection.ownSourceClosure.fullComponentSourceClosureVerified, false);
  assert.notEqual(resolve(workspace, projection.receiptPath), initial.receiptPath);
  assert.equal(fs.existsSync(resolve(workspace, projection.receiptPath)), true);
  const authenticatedReplay = verifyCompilerReceipt({
    receiptPath: initial.receiptPath, root: join(workspace, productionRoot),
    expectedImageId: request.expectedImageId,
    output: join(dirname(reportDir), 'candidate-binding-replay'),
  });
  assert.equal(authenticatedReplay.exitCode, 0, JSON.stringify(authenticatedReplay.report.errors));
  assert.equal(evaluateRequiredSourceGates(auditFixture(), [{ request, result: authenticatedReplay }])
    .compilerEvidence.summary.passed, 1);
  const replayPathRequest = { ...request, receiptPath: authenticatedReplay.receiptPath };
  const replayMismatch = evaluateRequiredSourceGates(auditFixture(), [{
    request: replayPathRequest, result: authenticatedReplay,
  }]);
  assert.equal(replayMismatch.compilerEvidence.summary.failed, 1);
  assert.match(replayMismatch.compilerEvidence.projections[0].reason, /Requested compiler receipt differs/);
  assert.equal(verifyScopedOwnSourceClosure({
    request: replayPathRequest, result: authenticatedReplay,
  }).status, 'fail');
  assert.equal(report.status, 'failed');
  assert.equal(report.summary.failed, 3);
  assert.equal(report.summary.skipped, 0);
  assert.equal(report.nativeAcceptance, false);
  assert.equal(report.compilerBuildInDockerVerified, false);
  assert.deepEqual(JSON.parse(fs.readFileSync(reportPath)), report);

  const controlled = runRequiredSourceGates({
    reportDir: join(dirname(reportDir), 'controlled-compiler-audit'),
    execute: controlledAudit, compilerRequests: [request],
    compilerExecute() { throw new Error('controlled Docker launch failure'); },
  });
  assert.equal(controlled.report.compilerEvidence.summary.failed, 1);
  assert.equal(controlled.report.compilerEvidence.mechanismVerifiedForScopes, false);
  assert.equal(controlled.report.summary.failed, 3);
  assert.equal(controlled.report.summary.skipped, 0);
  assert.equal(controlled.report.errors.length, 1);
  assert.equal(fs.existsSync(join(dirname(controlled.reportPath), 'compiler-replay-0/receipt.json')), true);
});

test('missing and malformed compiler requests retain failed reports and do not drop gates', t => {
  const { report, reportPath } = runRequiredSourceGates({
    reportDir: directory(t), execute: controlledAudit,
    compilerRequests: [compilerRequest(), { parseError: 'malformed JSON' }],
    compilerExecute() { assert.fail('Invalid requests must not invoke Docker'); },
  });
  assert.equal(report.compilerEvidence.summary.failed, 2);
  assert.equal(report.compilerEvidence.summary.skipped, 0);
  assert.equal(report.summary.failed, 3);
  assert.equal(report.errors.length, 2);
  assert.deepEqual(JSON.parse(fs.readFileSync(reportPath)), report);
});

test('malformed request collection is a failed report, not an uncaught error or skip', t => {
  const { report, reportPath } = runRequiredSourceGates({
    reportDir: directory(t), execute: controlledAudit, compilerRequests: {},
  });
  assert.equal(report.summary.failed, 3);
  assert.equal(report.summary.skipped, 0);
  assert.equal(report.compilerEvidence.summary.failed, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(reportPath)), report);
});

test('archive-free input predicate is diagnostic only and never standalone closure evidence', () => {
  const inputs = { entries: [{ path: 'Interface.java', bytes: 1, sha256: 'a'.repeat(64) }] };
  assert.deepEqual(archiveFreeProjectionInputs(inputs, []), {
    ok: true, verification: 'input-predicate-only-not-source-evidence',
    opaqueInputs: [], explicitClasspathEntries: 0,
  });
  assert.equal(verifyScopedOwnSourceClosure({
    request: compilerRequest(),
    result: { report: { compilerBuildInDockerVerified: true, source: { inputs } } },
  }).projectionSourceClosureVerified, false);
  for (const extension of ['class', 'jar', 'war', 'zip', 'ear', 'aar', 'jmod', 'CLASS', 'JAR']) {
    const opaque = archiveFreeProjectionInputs({
      entries: [...inputs.entries, { path: `dependency.${extension}`, bytes: 1, sha256: 'b'.repeat(64) }],
    }, []);
    assert.equal(opaque.ok, false);
    assert.deepEqual(opaque.opaqueInputs, [`dependency.${extension}`]);
  }
  assert.equal(archiveFreeProjectionInputs(inputs, ['dependency.jar']).ok, false);
  assert.equal(archiveFreeProjectionInputs({}, []).ok, false);
  assert.equal(archiveFreeProjectionInputs(inputs, null).ok, false);
  assert.equal(archiveFreeProjectionInputs({ entries: [...inputs.entries, ...inputs.entries] }, []).ok, false);
});

function backendRequest() {
  return { permissionReportPath: '.artifacts/modeling-permission-current/report.json' };
}

function componentEvidenceRequest() {
  return {
    backendImageReport: '.artifacts/d01-backend-source-images-20261006-1801/report.json',
    runtimeModelSourceReport:
      '.artifacts/runtime-model-source-build/runtime-model-next-quality-request-id-20261006/report.json',
    nativeCliSourceReport:
      '.artifacts/native-cli-source-build/build-ad440ad3-d659-4fa8-9cb6-8129623e949d/report.json',
    plmBackendRuntimeReport:
      '.artifacts/plm-backend-configured-regression-20261007/report.json',
  };
}

function assertRequiredBackendBoundary(report) {
  assert.equal(report.status, 'failed');
  assert.deepEqual(report.requiredGates, [...REQUIRED_SOURCE_GATES]);
  assert.equal(report.summary.passed, 0);
  assert.equal(report.summary.failed, 3);
  assert.equal(report.summary.skipped, 0);
  assert.equal(report.nativeAcceptance, false);
  assert.equal(report.compilerBuildInDockerVerified, false);
  assert.equal(report.compilerEvidence.backendEvidence.status, 'fail');
  assert.equal(report.compilerEvidence.backendEvidence.nativeAcceptance, false);
  assert.equal(report.compilerEvidence.backendEvidence.fullSourceClosureVerified, false);
  assert.deepEqual(report.compilerEvidence.requiredComponents.map(item => item.component),
    [...REQUIRED_D01_COMPONENTS]);
  for (const component of report.compilerEvidence.requiredComponents) {
    assert.equal(component.required, true);
    assert.equal(component.status, 'fail');
    assert.equal(component.currentSourcePackageInDockerVerified, false);
    assert.equal(component.imageArtifactBindingVerified, false);
    assert.equal(component.ownDependencySourceClosureVerified, false);
    assert.equal(component.fullComponentBuildVerified, false);
  }
}

test('backend rebuild selector accepts only a safe production permission receipt selector', () => {
  const request = backendRequest();
  assert.deepEqual(selectRequiredBackendBuild(request), {
    permissionReportPath: join(workspace, request.permissionReportPath),
  });
  assert.deepEqual(request, backendRequest());
});

for (const [name, request] of [
  ['null', null],
  ['boolean', true],
  ['array', [backendRequest()]],
  ['string', JSON.stringify(backendRequest())],
  ['missing selector', {}],
  ['nonstring path', { permissionReportPath: true }],
  ['absolute path', { permissionReportPath: '/tmp/permission/report.json' }],
  ['workspace traversal', { permissionReportPath: '.artifacts/../permission/report.json' }],
  ['dot component', { permissionReportPath: '.artifacts/./report.json' }],
  ['nested output', { permissionReportPath: '.artifacts/permission/nested/report.json' }],
  ['wrong filename', { permissionReportPath: '.artifacts/permission/receipt.json' }],
  ['leading option', { permissionReportPath: '--permission-report' }],
  ['newline path', { permissionReportPath: '.artifacts/permission/report.json\n' }],
  ['nul path', { permissionReportPath: '.artifacts/permission/report.json\0' }],
  ['backslash path', { permissionReportPath: '.artifacts\\permission\\report.json' }],
  ['shell fragment', { permissionReportPath: '.artifacts/permission;docker/report.json' }],
  ['supplied package receipt', { ...backendRequest(), packageReport: '.artifacts/copied/report.json' }],
  ['supplied image receipt', { ...backendRequest(), imageReport: '.artifacts/copied/report.json' }],
  ['controlled build runner', { ...backendRequest(), execute: () => ({ status: 0 }) }],
  ['source override', { ...backendRequest(), workspace: '/tmp/controlled' }],
  ['output override', { ...backendRequest(), output: '.artifacts/existing' }],
  ['boolean promotion', { ...backendRequest(), sourceClosure: true }],
]) {
  test(`backend rebuild rejects ${name} before invoking a build and retains all gates`, () => {
    assert.throws(() => selectRequiredBackendBuild(request));
    const result = rebuildRequiredBackendEvidence(request);
    assert.equal(result.status, 'fail');
    assert.equal(result.nativeAcceptance, false);
    assert.equal(result.fullSourceClosureVerified, false);
    assert.equal(typeof result.reason, 'string');
    assert.equal(Object.hasOwn(result, 'packageReportPath'), false);
    assert.equal(Object.hasOwn(result, 'imageReportPath'), false);
    const report = evaluateRequiredSourceGates(auditFixture(), [], { request, result });
    assertRequiredBackendBoundary(report);
  });
}

for (const [name, scope] of [
  ['no requested build', undefined],
  ['missing result', { request: backendRequest() }],
  ['boolean result', { request: backendRequest(), result: true }],
  ['copied pass receipt', { request: backendRequest(), result: {
    status: 'pass', nativeAcceptance: false, fullSourceClosureVerified: false,
    imageReportPath: '.artifacts/copied/report.json',
    evidence: { status: 'pass', components: [{ component: 'allinone',
      currentSourcePackageInDockerVerified: true, imageArtifactBindingVerified: true }] },
  } }],
  ['invented full closure', { request: backendRequest(), result: {
    status: 'pass', nativeAcceptance: true, fullSourceClosureVerified: true,
    compilerBuildInDockerVerified: true,
  } }],
  ['explicit build failure', { request: backendRequest(), error: 'isolated build failed' }],
  ['null scope', null],
]) {
  test(`backend ${name} cannot promote source, image, all-D01 or native evidence`, () => {
    assert.equal(verifyRequiredBackendBuildResult(scope).status, 'fail');
    const report = evaluateRequiredSourceGates(auditFixture(), [], scope);
    assertRequiredBackendBoundary(report);
    assert.equal(report.compilerEvidence.summary.skipped, 0);
  });
}

test('missing permission receipt fails explicitly before Docker and does not produce a capability', t => {
  const root = dirname(directory(t));
  const request = {
    permissionReportPath: `.artifacts/absent-permission-${root.split('/').at(-1)}/report.json`,
  };
  const result = rebuildRequiredBackendEvidence(request);
  assert.equal(result.status, 'fail');
  assert.match(result.reason, /ENOENT|does not exist|No such file|Missing directory:/);
  assert.equal(Object.hasOwn(result, 'packageReportPath'), false);
  assert.equal(Object.hasOwn(result, 'imageReportPath'), false);
  assertRequiredBackendBoundary(evaluateRequiredSourceGates(auditFixture(), [], { request, result }));
});

for (const [name, request] of [
  ['malformed JSON selector', { parseError: 'Malformed backend build request JSON' }],
  ['unsafe permission selector', { permissionReportPath: '.artifacts/../outside/report.json' }],
  ['controlled backend build request', backendRequest()],
]) {
  test(`required runner persists ${name} failure without dropping required components`, t => {
    const { report, reportPath } = runRequiredSourceGates({
      reportDir: directory(t), execute: controlledAudit, backendBuildRequest: request,
    });
    assertRequiredBackendBoundary(report);
    assert.equal(report.evidence, 'controlled-runner-not-native-evidence');
    assert.deepEqual(report.backendBuildReports, []);
    assert.equal(report.errors.length, 1);
    assert.deepEqual(JSON.parse(fs.readFileSync(reportPath)), report);
    if (name === 'controlled backend build request') {
      assert.match(report.errors[0], /Controlled required runners cannot launch or promote/);
    }
  });
}

test('required runner cannot combine controlled compiler execution with a backend capability', t => {
  const { report, reportPath } = runRequiredSourceGates({
    reportDir: directory(t), execute: controlledAudit, backendBuildRequest: backendRequest(),
    compilerExecute() { assert.fail('No compiler replay was requested'); },
  });
  assertRequiredBackendBoundary(report);
  assert.match(report.errors[0], /Controlled required runners cannot launch or promote/);
  assert.deepEqual(JSON.parse(fs.readFileSync(reportPath)), report);
});

test('backend receipt overrides are not accepted as required CLI inputs', () => {
  for (const option of ['--backend-package-report', '--backend-image-report', '--backend-build-verified']) {
    assert.throws(() => main([option, 'claimed']), /Unknown option/);
  }
});

function uaaReplayRequest() {
  return {
    receiptPath: '.artifacts/standalone-uaa-editable-20261006-E1/build-5jJsDB/report.json',
    expectedImageId: `sha256:${'a'.repeat(64)}`,
  };
}

test('reconstructed UAA selector binds a single standalone experiment and immutable JDK, not full source closure', () => {
  const request = uaaReplayRequest();
  const selected = selectRequiredUaaCompilerReplay(request);
  assert.equal(selected.receiptPath, resolve(dirname(fileURLToPath(import.meta.url)), '../..', request.receiptPath));
  assert.equal(selected.expectedImageId, request.expectedImageId);
});

test('canonical maintained UAA selector is explicit and never authenticates a copied compiler result', () => {
  const request = { ...uaaReplayRequest(),
    receiptPath: '.artifacts/standalone-uaa-source-build/build-SKWDge/report.json' };
  assert.equal(selectRequiredUaaCompilerReplay(request).receiptPath,
    resolve(dirname(fileURLToPath(import.meta.url)), '../..', request.receiptPath));
  for (const result of [true, { exitCode: 0, report: {
    compilerOutputReplayVerified: true, sourceClosureVerified: false, nativeAcceptance: false,
  } }]) {
    const scope = { request, result };
    const evidence = verifyRequiredRecoveredUaaEvidence(scope);
    assert.equal(evidence.status, 'fail');
    assert.equal(evidence.maintainedCompilerOutputReplayVerified, false);
    const evaluated = evaluateRequiredSourceGates(auditFixture(), [], undefined, scope);
    assert.deepEqual(evaluated.summary,
      { required: 3, passed: 0, failed: 3, skipped: 0, rejectedSourceSkips: 0 });
    assert.equal(evaluated.fullSourceClosureVerified, false);
    assert.equal(evaluated.nativeAcceptance, false);
  }
});

for (const path of [
  '.artifacts/standalone-uaa-source-build/report.json',
  '.artifacts/standalone-uaa-source-build/../build-ID/report.json',
  '.artifacts/standalone-uaa-source-build/build-ID/receipt.json',
  '.artifacts/standalone-uaa-source-build-copy/build-ID/report.json',
  'standalone-uaa/source/build-ID/report.json',
]) {
  test(`maintained UAA rejects noncanonical receipt selector ${path}`, () => {
    assert.throws(() => selectRequiredUaaCompilerReplay({ ...uaaReplayRequest(), receiptPath: path }));
  });
}

for (const [name, request] of [
  ['boolean', true],
  ['null', null],
  ['array', []],
  ['missing fields', {}],
  ['absolute receipt', { ...uaaReplayRequest(), receiptPath: '/tmp/report.json' }],
  ['traversal', { ...uaaReplayRequest(), receiptPath: '.artifacts/standalone-uaa-editable-RUN/../build-ID/report.json' }],
  ['legacy UAA', { ...uaaReplayRequest(), receiptPath: '.artifacts/legacy-ibzuaa/build-ID/report.json' }],
  ['starter only', { ...uaaReplayRequest(), receiptPath: '.artifacts/standalone-uaa-starter-build/build-ID/report.json' }],
  ['source presence only', { ...uaaReplayRequest(), receiptPath: '.artifacts/standalone-uaa-recovery-R4/report.json' }],
  ['wrong receipt filename', { ...uaaReplayRequest(), receiptPath: uaaReplayRequest().receiptPath.replace('report.json', 'receipt.json') }],
  ['image tag', { ...uaaReplayRequest(), expectedImageId: 'maven:latest' }],
  ['copied pass result', { ...uaaReplayRequest(), result: { compilerOutputReplayVerified: true } }],
  ['runner injection', { ...uaaReplayRequest(), execute: () => ({ status: 0 }) }],
  ['root override', { ...uaaReplayRequest(), root: 'fixtures/source' }],
  ['classpath override', { ...uaaReplayRequest(), classpath: [] }],
  ['promotion claim', { ...uaaReplayRequest(), sourceClosureVerified: true }],
]) {
  test(`reconstructed UAA rejects ${name} selector and retains all mandatory gates`, () => {
    assert.throws(() => selectRequiredUaaCompilerReplay(request));
    const report = evaluateRequiredSourceGates(auditFixture(), [], undefined, { request });
    assert.equal(report.compilerEvidence.reconstructedUaaEvidence.status, 'fail');
    assert.deepEqual(report.summary, { required: 3, passed: 0, failed: 3, skipped: 0, rejectedSourceSkips: 0 });
    assert.equal(report.compilerEvidence.allRequiredComponentsVerified, false);
    assert.equal(report.compilerEvidence.requiredComponents.every(item =>
      item.status === 'fail' && item.reconstructedCompilerOutputReplayVerified === false), true);
    assert.equal(report.nativeAcceptance, false);
  });
}

for (const [name, scope] of [
  ['no request', undefined],
  ['boolean result', { request: uaaReplayRequest(), result: true }],
  ['copied class replay', { request: uaaReplayRequest(), result: {
    exitCode: 0, report: { compilerOutputReplayVerified: true, sourceClosureVerified: false,
      protocolRuntimeParityVerified: false, nativeAcceptance: false },
  } }],
  ['invented native closure', { request: uaaReplayRequest(), result: {
    exitCode: 0, report: { sourceClosureVerified: true, standaloneSourceBuildVerified: true, nativeAcceptance: true },
  } }],
  ['explicit dependency failure', { request: uaaReplayRequest(), error: 'implicit-classpath' }],
]) {
  test(`reconstructed UAA ${name} cannot produce a live replay capability or promote S06/D01`, () => {
    const evidence = verifyRequiredRecoveredUaaEvidence(scope);
    assert.equal(evidence.status, 'fail');
    assert.equal(evidence.reconstructedCompilerOutputReplayVerified, false);
    assert.equal(evidence.ownDependencySourceClosureVerified, false);
    assert.equal(evidence.protocolRuntimeParityVerified, false);
    assert.equal(evidence.nativeAcceptance, false);
    assert.equal(Object.hasOwn(evidence, 'failureReplay'), false);
    const report = evaluateRequiredSourceGates(auditFixture(), [], undefined, scope);
    assert.equal(report.summary.failed, 3);
    assert.equal(report.summary.skipped, 0);
  });
}

for (const [name, request] of [
  ['controlled audit', uaaReplayRequest()],
  ['controlled maintained audit', { ...uaaReplayRequest(),
    receiptPath: '.artifacts/standalone-uaa-source-build/build-ID/report.json' }],
  ['malformed JSON', { parseError: 'Malformed reconstructed UAA request JSON' }],
  ['unselected legacy build', { ...uaaReplayRequest(), receiptPath: 'vendor-upstream/ibzuaa/receipt.json' }],
]) {
  test(`required runner persists ${name} reconstructed UAA failure without calling Docker or dropping gates`, t => {
    const { report, reportPath } = runRequiredSourceGates({
      reportDir: directory(t), execute: controlledAudit, uaaCompilerRequest: request,
    });
    assert.equal(report.summary.failed, 3);
    assert.equal(report.summary.skipped, 0);
    assert.equal(report.compilerEvidence.reconstructedUaaEvidence.status, 'fail');
    assert.ok(report.errors.length);
    assert.equal(Object.hasOwn(report, 'uaaCompilerReplayReport'), false);
    assert.deepEqual(JSON.parse(fs.readFileSync(reportPath)), report);
    if (name.startsWith('controlled')) assert.match(report.errors[0], /Controlled required runners/);
  });
}

test('UAA candidate replay has no supplied boolean, closure or native promotion CLI switch', () => {
  for (const option of ['--uaa-source-closure', '--uaa-replay-verified', '--uaa-native-accepted']) {
    assert.throws(() => main([option, 'true']), /Unknown option/);
  }
});
