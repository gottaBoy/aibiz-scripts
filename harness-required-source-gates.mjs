#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { PinnedDirectories, readPinnedFile } from './native-candidate-files.mjs';
import {
  collectCompilerInputs, isLiveCompilerResult, verifyCompilerReceipt,
  isLiveRecoveredUaaCompilerReplay, verifyRecoveredUaaCompilerOutputs,
  recoveredUaaReplayFailureEvidence,
  isLiveMaintainedUaaCompilerReplay, verifyMaintainedUaaCompilerOutputs,
  maintainedUaaReplayFailureEvidence,
} from './harness-compiler-in-docker.mjs';
import {
  ownSourceBytecodeClosureReadiness, standaloneUaaProtocolClosureReadiness,
  verifyTaskOwnSourceClosureEvidence,
  STANDALONE_UAA_EDITABLE_INPUTS,
} from './harness-uaa-task-readiness.mjs';
import { verifyStatefulReceipt } from '../standalone-uaa/tools/stateful-token-runtime.mjs';
import { verifyBuildForPackaging } from '../standalone-uaa/tools/runtime-image.mjs';
import { verifyClosureReceipt } from '../standalone-uaa/tools/source-closure.mjs';
import { runBackendSourcePackage } from './harness-backend-source-package.mjs';
import {
  BACKEND_IMAGES, runBackendSourceImages, verifyBackendSourceImages,
} from './harness-backend-source-images.mjs';
import { verifyRuntimeModelSourceBuild } from './harness-runtime-model-source-build.mjs';
import { verifyNativeCliSourceBuild } from './harness-native-cli-source-build.mjs';
import {
  MIGRATION_RUNTIME_REQUIREMENTS, safePath, validateBuildReceipt, validateMigrationMapping,
} from './harness-modeling-core-audit.mjs';
import { collectPluginReferences } from './harness-plugin-audit.mjs';

const scriptsRoot = dirname(fileURLToPath(import.meta.url));
const workspace = resolve(scriptsRoot, '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const liveBackendBuilds = new WeakMap();
const backendComponents = Object.freeze({
  allinone: 'allinone', gateway: 'gateway', provider: 'modeling-backend',
});
const serviceChecks = {
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
export const REQUIRED_SOURCE_GATES = Object.freeze([
  's06-uaa-own-source', 's06-task-own-source', 'd01-compiler-in-docker',
]);
// This is a mandatory lower bound, not a substitute for the complete S01 inventory.
export const REQUIRED_D01_COMPONENTS = Object.freeze([
  'uaa-standalone', 'task', 'modeling-backend', 'plm-backend', 'allinone', 'gateway',
  'plm-frontend', 'modeling-frontend', 'app-framework', 'modeling-plugins',
  'runtime-model', 'native-cli',
]);
const javaSourceRoots = Object.freeze({
  'modeling-backend': 'ibiz-service-hub',
  'plm-backend': 'plm/backend',
  allinone: 'ibiz-service-hub/ibiz-ebsx-runtime',
  gateway: 'ibiz-service-hub/ibiz-ebsx-gateway',
  task: 'task7',
});
const canonicalUaaReportPattern = /^\.artifacts\/standalone-uaa-(?:source-build\/build-[A-Za-z0-9]+|source-runtime\/runtime-[A-Za-z0-9]+|stateful-security\/security-[A-Za-z0-9]+|source-closure\/closure-[A-Za-z0-9]+)\/report\.json$/;
const migrationContractPath = 'scripts/fixtures/modeling-core-migration-contract.json';
const migrationModelRoot = 'vendor-upstream/ibizmodeling-standard/modelapi-core/src/main/resources/model/net/ibizsys/modeling';
const migrationApplications = Object.freeze(['Central', 'ModelDesign']);
const componentEvidencePathContracts = Object.freeze({
  backendImageReport: /^\.artifacts\/d01-backend-source-images-[A-Za-z0-9][A-Za-z0-9._-]*\/report\.json$/,
  runtimeModelSourceReport: /^\.artifacts\/runtime-model-source-build\/[A-Za-z0-9][A-Za-z0-9._-]*\/report\.json$/,
  nativeCliSourceReport: /^\.artifacts\/native-cli-source-build\/[A-Za-z0-9][A-Za-z0-9._-]*\/report\.json$/,
});

export function selectRequiredComponentEvidenceRequest(request) {
  assert.ok(request && typeof request === 'object' && !Array.isArray(request),
    'Component evidence request must be an object');
  assert.deepEqual(Object.keys(request).sort(), Object.keys(componentEvidencePathContracts).sort(),
    'Component evidence requires exactly the supported partial D01 reports');
  for (const [key, pattern] of Object.entries(componentEvidencePathContracts)) {
    assert.equal(typeof request[key], 'string', `Component evidence ${key} must be a string`);
    assert.match(request[key], pattern, `Unsafe or unsupported component evidence ${key}`);
  }
  return Object.fromEntries(Object.entries(request)
    .map(([key, path]) => [key, resolve(workspace, path)]));
}

function migrationInventory(directories, root, path) {
  assert.ok(safePath(path), 'Unsafe migration input path');
  const entries = [];
  let bytes = 0;
  function visit(directory, prefix = '') {
    directories.verify(directory);
    for (const entry of fs.readdirSync(directory.access, { withFileTypes: true })) {
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (['.git', 'node_modules', '.npmrc', '.yarnrc', '.yarnrc.yml', '.DS_Store'].includes(entry.name)
        || entry.name === '.env' || entry.name.startsWith('.env.')) continue;
      assert.ok(safePath(name), 'Unsafe migration file path');
      assert.ok(!entry.isSymbolicLink(), 'Symlink migration input rejected');
      if (entry.isDirectory()) visit(directories.open(join(directory.path, entry.name)), name);
      else {
        const { data } = readPinnedFile(directories, directory, entry.name);
        bytes += data.length;
        assert.ok(bytes <= 256 * 1024 * 1024, 'Migration file inventory too large');
        entries.push({ path: name, bytes: data.length, sha256: hash(data) });
      }
    }
    directories.verify(directory);
  }
  visit(directories.open(join(root, path)));
  assert.ok(entries.length > 0, 'Empty migration file inventory');
  entries.sort((a, b) => a.path.localeCompare(b.path));
  return { entries, files: entries.length, bytes, fingerprint: hash(JSON.stringify(entries)) };
}

// Receipts and current file sets are diagnostics, never an independent build capability.
export function auditRequiredMigrationBindings(root = workspace) {
  root = resolve(root);
  const directories = new PinnedDirectories();
  const checks = [];
  const errors = [];
  const models = [];
  const mappings = [];
  const snapshots = new Map();
  const observed = new Map();
  let contractSha256 = null;
  const read = path => {
    assert.ok(safePath(path), 'Unsafe migration evidence path');
    const file = readPinnedFile(directories, directories.open(dirname(join(root, path))),
      path.split('/').at(-1)).data;
    const digest = hash(file);
    if (observed.has(path)) assert.equal(digest, observed.get(path), 'Migration file changed during audit');
    observed.set(path, digest);
    return file;
  };
  const inventory = path => {
    const current = migrationInventory(directories, root, path);
    if (snapshots.has(path)) assert.deepEqual(current, snapshots.get(path), 'Migration inventory changed during audit');
    snapshots.set(path, current);
    return current;
  };
  const check = (id, run) => {
    try { run(); checks.push({ id, status: 'pass' }); }
    catch (cause) {
      const reason = typeof cause?.message === 'string' ? cause.message : 'Migration binding audit failed';
      checks.push({ id, status: 'fail', reason });
      errors.push({ id, reason });
    }
  };
  try {
    let contract;
    check('migration-contract', () => {
      const bytes = read(migrationContractPath);
      contractSha256 = hash(bytes);
      contract = JSON.parse(bytes);
      assert.equal(contract.schemaVersion, 1);
      assert.equal(contract.contract, 'ibizmodeling-core-migration');
      assert.equal(contract.evidence?.modelRoot, migrationModelRoot, 'Migration model root differs');
      assert.deepEqual(Object.keys(contract.evidence.applications).sort(), [...migrationApplications].sort());
      assert.ok(Array.isArray(contract.plugins) && Array.isArray(contract.migrationMappings));
      const policy = contract.migrationPolicy;
      assert.equal(policy?.statusForUse, 'verified-only');
      for (const key of ['sourceRequired', 'buildRequired', 'runtimeRequired']) assert.equal(policy[key], true);
      assert.deepEqual([...policy.runtimeApplications].sort(), [...migrationApplications].sort());
      assert.deepEqual([...policy.requiredRuntimeChecks].sort(), [...MIGRATION_RUNTIME_REQUIREMENTS].sort());
      const required = [...new Set(migrationApplications.flatMap(app =>
        contract.evidence.applications[app].references.map(ref => ref.repo)))].sort();
      assert.ok(required.length > 0, 'Empty migration reference roster');
      assert.deepEqual(contract.plugins.map(plugin => plugin.repo).sort(), required, 'Migration plugin roster differs');
      assert.deepEqual(contract.migrationMappings.map(mapping => mapping.from).sort(), required,
        'Missing, duplicate or extra migration mapping');
    });
    if (checks[0].status === 'pass') {
      for (const app of migrationApplications) check(`migration-model-${app}`, () => {
        const path = `${migrationModelRoot}/PSSYSAPPS/${app}/PSSYSAPP.json`;
        const bytes = read(path);
        const expected = contract.evidence.applications[app];
        assert.equal(bytes.length, expected.bytes, 'Current migration model length differs');
        assert.equal(hash(bytes), expected.inputSha256, 'Current migration model hash differs');
        const refs = collectPluginReferences(JSON.parse(bytes));
        assert.deepEqual(refs.invalidReferences, [], 'Invalid current migration model reference');
        const normalize = references => references.map(ref => ({
          repo: ref.repo, locations: [...ref.locations].sort(),
        })).sort((a, b) => a.repo.localeCompare(b.repo));
        assert.deepEqual(normalize(refs.packages), normalize(expected.references),
          'Current migration model reference identities or pointers differ');
        models.push({ app, path, bytes: bytes.length, sha256: hash(bytes), references: refs.packages.length });
      });
      for (const mapping of contract.migrationMappings) {
        const result = {
          from: mapping.from, declaredEvidenceConsistent: false, inputBindingsVerified: false,
          sourceFileSetBound: false, targetFileSetBound: false, receiptFileSetsBound: false,
          fullSourceClosureVerified: false,
          declaredSource: mapping.source?.status, declaredBuild: mapping.build?.status,
          declaredRuntime: mapping.runtime?.status,
          blockers: Array.isArray(mapping.blockers) ? [...mapping.blockers] : [],
        };
        mappings.push(result);
        check(`migration-package-${mapping.from}`, () => {
          const source = mapping.source?.status !== 'missing' ? inventory(mapping.source.path) : null;
          const output = mapping.target?.status === 'observed' ? inventory(mapping.target.artifact.path) : null;
          for (const [kind, current, recorded] of [
            ['source', source, mapping.source], ['target', output, mapping.target?.artifact],
          ]) {
            if (!current) continue;
            result[`${kind}Fingerprint`] = current.fingerprint;
            assert.equal(current.fingerprint, recorded.fingerprint, `Current migration ${kind} fingerprint differs`);
            assert.equal(current.files, recorded.files, `Current migration ${kind} file count differs`);
            assert.equal(current.bytes, recorded.bytes, `Current migration ${kind} byte count differs`);
          }
          const validation = validateMigrationMapping(mapping, root);
          assert.ok(validation.valid, `Invalid migration mapping: ${validation.blockers.join(',')}`);
          if (mapping.runtime.status === 'passed') {
            assert.equal(hash(read(mapping.runtime.evidence.reportPath)), mapping.runtime.evidence.reportSha256,
              'Migration runtime report changed');
          }
          if (mapping.build.status === 'verified') {
            const receipt = mapping.build.receipt;
            assert.ok(validateBuildReceipt(receipt).valid, 'Invalid migration build receipt');
            assert.equal(receipt.sourceFingerprint, source.fingerprint,
              'Migration receipt source fingerprint differs from current source');
            assert.equal(receipt.outputFingerprint, output.fingerprint,
              'Migration receipt output fingerprint differs from current output');
            const ordered = entries => [...entries].map(({ path, bytes, sha256 }) =>
              ({ path, bytes, sha256 })).sort((a, b) => a.path.localeCompare(b.path));
            assert.deepEqual(ordered(receipt.inputs), source.entries, 'Migration receipt input file set differs');
            assert.deepEqual(ordered(receipt.outputs), output.entries, 'Migration receipt output file set differs');
            const plugin = contract.plugins.find(entry => entry.repo === mapping.from);
            if (plugin.build?.status === 'verified') assert.deepEqual(plugin.build.receipt, receipt,
              'Migration plugin and mapping build receipts differ');
          }
          result.declaredEvidenceConsistent = true;
          result.sourceFileSetBound = source !== null;
          result.targetFileSetBound = output !== null;
          result.receiptFileSetsBound = mapping.build.status === 'verified';
          result.inputBindingsVerified = result.sourceFileSetBound
            && result.targetFileSetBound && result.receiptFileSetsBound;
        });
      }
      check('migration-post-audit-input-recheck', () => {
        for (const path of observed.keys()) read(path);
        for (const path of snapshots.keys()) inventory(path);
      });
      if (checks.at(-1).status !== 'pass') {
        for (const mapping of mappings) {
          mapping.declaredEvidenceConsistent = false;
          mapping.inputBindingsVerified = false;
          mapping.sourceFileSetBound = false;
          mapping.targetFileSetBound = false;
          mapping.receiptFileSetsBound = false;
        }
      }
    }
  } finally { directories.close(); }
  const failed = checks.filter(item => item.status === 'fail').length;
  return {
    contract: 'required-current-migration-input-bindings-v1',
    status: failed === 0 ? 'passed-input-bindings-only' : 'failed',
    verification: 'read-only-current-model-source-output-and-receipt-file-set-binding-only',
    controlledRoot: root !== workspace,
    compilerBuildInDockerVerified: false, fullSourceClosureVerified: false, nativeAcceptance: false,
    path: migrationContractPath, contractSha256, models, mappings, checks, errors,
    summary: { passed: checks.length - failed, failed, skipped: 0 },
    limitations: [
      'Matching current input/output receipts does not authenticate a build invocation or dependency closure.',
      'Consistent missing-evidence declarations do not bind absent source or receipt file sets.',
      'Reconstructed, missing or runtime-unverified migration mappings retain their blockers.',
      'No fixture, static receipt or input fingerprint can close S06, D01 or native acceptance.',
    ],
  };
}

export function selectRequiredBackendBuild(request) {
  assert.ok(request && typeof request === 'object' && !Array.isArray(request),
    'Backend build request must be an object');
  assert.deepEqual(Object.keys(request).sort(), ['permissionReportPath'],
    'Only an independently verified permission receipt may select a backend rebuild');
  assert.equal(typeof request.permissionReportPath, 'string', 'Permission receipt path must be a string');
  assert.match(request.permissionReportPath, /^\.artifacts\/[A-Za-z0-9][A-Za-z0-9_.-]*\/report\.json$/,
    'Permission receipt must be a safe direct workspace artifact report');
  return { permissionReportPath: resolve(workspace, request.permissionReportPath) };
}

function backendBuildEvidence(verified, result) {
  const report = verified.report;
  return {
    contract: 'required-current-source-backend-rebuild-v1',
    status: 'pass', nativeAcceptance: false, fullSourceClosureVerified: false,
    verification: 'live-isolated-maven-package-and-image-file-binding-only',
    packageReceipt: {
      path: relative(workspace, report.packageReceipt.path),
      sha256: report.packageReceipt.sha256,
      inputFingerprint: report.packageReceipt.sourceFingerprint,
    },
    imageReceipt: { path: relative(workspace, verified.reportPath), sha256: verified.reportSha256 },
    components: report.components.map(item => ({
      component: backendComponents[item.name],
      currentSourcePackageInDockerVerified: true, imageArtifactBindingVerified: true,
      ownDependencySourceClosureVerified: false, fullComponentBuildVerified: false,
      imageId: item.image.id,
      archiveSha256: item.inventory.entries.find(entry => entry.path.endsWith('.jar')).sha256,
    })),
    tests: result.tests,
    unknownOwnDependencies: result.unknownOwnDependencies,
    limitations: [
      'Fresh complete backend reactor packaging and candidate image bytes only; not all-component D01 or deployment.',
      'Binary dependency inputs and source-reactor hash matches do not establish recursive editable-source closure.',
      'No UAA/Task protocol, native workflows, permission integration or production acceptance.',
    ],
  };
}

// This entry point deliberately has no injectable runner or supplied package/image receipts.
export function rebuildRequiredBackendEvidence(request) {
  const result = { status: 'fail', nativeAcceptance: false, fullSourceClosureVerified: false };
  try {
    const selection = selectRequiredBackendBuild(request);
    const directories = new PinnedDirectories();
    let permission;
    try {
      permission = JSON.parse(readPinnedFile(directories,
        directories.open(dirname(selection.permissionReportPath)), 'report.json').data);
    } finally { directories.close(); }
    assert.equal(permission.source, resolve(workspace, 'ibiz-service-hub'),
      'Backend rebuild must bind the actual production source root');
    const id = randomUUID();
    const packaged = runBackendSourcePackage({
      permissionReport: selection.permissionReportPath,
      output: join(workspace, '.artifacts', `d01-backend-package-${id}`),
    });
    result.packageReportPath = packaged.reportPath;
    assert.equal(packaged.report.sourcePackageVerified, true, 'Fresh isolated backend package failed');
    const images = runBackendSourceImages({
      packageReport: packaged.reportPath,
      output: join(workspace, '.artifacts', `d01-backend-images-${id}`),
    });
    result.imageReportPath = images.reportPath;
    assert.equal(images.report.imageArtifactBindingVerified, true, 'Fresh backend candidate image binding failed');
    const verified = verifyBackendSourceImages({ reportPath: images.reportPath });
    result.tests = {
      passed: packaged.report.results.tests, failed: packaged.report.results.failures,
      errors: packaged.report.results.errors, skipped: packaged.report.results.skipped,
      zeroTestPlaceholders: packaged.report.results.placeholders.length,
    };
    assert.ok(result.tests.passed > 0 && result.tests.failed === 0
      && result.tests.errors === 0 && result.tests.skipped === 0, 'Backend regression must have no failures or skips');
    result.unknownOwnDependencies = packaged.report.packages.archives.flatMap(archive =>
      archive.unknownOwnDependencies.map(entry => ({
        archive: archive.path, path: entry.path, sha256: entry.sha256,
      })));
    result.status = 'pass';
    result.evidence = backendBuildEvidence(verified, result);
    liveBackendBuilds.set(result, {
      request: JSON.stringify(request), digest: hash(JSON.stringify(result)),
      imageReceiptSha256: verified.reportSha256,
    });
  } catch (cause) {
    result.reason = typeof cause?.message === 'string' ? cause.message : 'Required backend rebuild failed';
  }
  return result;
}

export function verifyRequiredBackendBuildResult(scope) {
  const failed = {
    contract: 'required-current-source-backend-rebuild-v1',
    status: 'fail', nativeAcceptance: false, fullSourceClosureVerified: false, components: [],
  };
  if (scope === undefined) return { ...failed, reason: 'No fresh isolated backend rebuild requested' };
  try {
    selectRequiredBackendBuild(scope?.request);
    if (scope?.error) throw new Error(scope.error);
    const result = scope?.result;
    const capability = liveBackendBuilds.get(result);
    assert.ok(capability, 'Copied, controlled or claimed backend build results cannot authenticate live source rebuilds');
    assert.equal(JSON.stringify(scope.request), capability.request, 'Backend rebuild request differs');
    assert.equal(hash(JSON.stringify(result)), capability.digest, 'Backend build result changed');
    const verified = verifyBackendSourceImages({ reportPath: result.imageReportPath });
    assert.equal(verified.reportSha256, capability.imageReceiptSha256, 'Backend image receipt changed');
    assert.deepEqual(verified.report.components.map(item => item.name), BACKEND_IMAGES.map(item => item.name));
    assert.equal(verified.report.packageReceipt.path, result.packageReportPath);
    const evidence = backendBuildEvidence(verified, result);
    assert.deepEqual(evidence, result.evidence, 'Backend rebuild evidence changed');
    return evidence;
  } catch (cause) {
    return { ...failed, reason: typeof cause?.message === 'string'
      ? cause.message : 'Required backend rebuild verification failed' };
  }
}

export function selectRequiredUaaCompilerReplay(request) {
  assert.ok(request && typeof request === 'object' && !Array.isArray(request),
    'UAA compiler replay request must be an object');
  assert.deepEqual(Object.keys(request).sort(), ['expectedImageId', 'receiptPath'],
    'UAA compiler replay accepts only a candidate receipt and independently selected immutable JDK');
  assert.equal(typeof request.receiptPath, 'string', 'UAA candidate receipt path must be a string');
  assert.match(request.receiptPath,
    /^\.artifacts\/(?:standalone-uaa-editable-[A-Za-z0-9_-]+|standalone-uaa-source-build)\/build-[A-Za-z0-9]+\/report\.json$/,
    'UAA candidate must be an explicit reconstructed or canonical maintained standalone build');
  assert.match(request.expectedImageId ?? '', /^sha256:[a-f0-9]{64}$/,
    'UAA replay requires an independently selected immutable JDK image');
  return { receiptPath: resolve(workspace, request.receiptPath), expectedImageId: request.expectedImageId };
}

export function selectRequiredUaaSourceClosureEvidence(request) {
  assert.ok(request && typeof request === 'object' && !Array.isArray(request),
    'UAA source closure evidence request must be an object');
  assert.deepEqual(Object.keys(request).sort(),
    ['buildReport', 'closureReport', 'runtimeReport', 'statefulReport'],
    'UAA source closure evidence requires all four canonical reports');
  const selected = {};
  for (const [key, path] of Object.entries(request)) {
    assert.equal(typeof path, 'string', `UAA ${key} must be a canonical report path`);
    assert.match(path, canonicalUaaReportPattern, `UAA ${key} is not a canonical artifact`);
    selected[key] = resolve(workspace, path);
  }
  return selected;
}

function readCanonicalReport(path) {
  const directories = new PinnedDirectories();
  try {
    const directory = directories.open(dirname(path));
    const bytes = readPinnedFile(directories, directory, 'report.json').data;
    const sidecar = readPinnedFile(directories, directory, 'report.sha256').data.toString('utf8').trim();
    const match = sidecar.match(/^([a-f0-9]{64})(?:[ \t]+report\.json)?$/);
    assert.ok(match, 'Canonical report sidecar is malformed');
    const sha256 = hash(bytes);
    assert.equal(match[1], sha256, 'Canonical report sidecar digest differs');
    return { bytes, sha256, report: JSON.parse(bytes) };
  } finally {
    directories.close();
  }
}

function maintainedUaaRequest(request) {
  return request?.receiptPath?.startsWith('.artifacts/standalone-uaa-source-build/') === true;
}

export function verifyRequiredRecoveredUaaEvidence(scope) {
  const failed = {
    status: 'fail', reconstructedCompilerOutputReplayVerified: false,
    maintainedCompilerOutputReplayVerified: false,
    fullComponentBuildVerified: false, ownDependencySourceClosureVerified: false,
    fullSourceClosureVerified: false, protocolRuntimeParityVerified: false, nativeAcceptance: false,
  };
  if (scope === undefined) return { ...failed, reason: 'No independent reconstructed UAA compiler replay requested' };
  let selected;
  try {
    selected = selectRequiredUaaCompilerReplay(scope?.request);
    if (scope?.error) throw new Error(scope.error);
    const maintained = maintainedUaaRequest(scope.request);
    const isLive = maintained ? isLiveMaintainedUaaCompilerReplay : isLiveRecoveredUaaCompilerReplay;
    assert.ok(isLive(scope?.result, selected),
      'Copied, claimed, controlled or stale reconstructed UAA receipts cannot authenticate independent replay');
    const { report, reportPath, reportSha256 } = scope.result;
    return {
      ...failed, status: 'pass', reconstructedCompilerOutputReplayVerified: !maintained,
      maintainedCompilerOutputReplayVerified: maintained,
      verification: maintained ? 'live-maintained-current-source-three-module-java-class-replay-only'
        : 'live-reconstructed-three-module-java-class-replay-only',
      reportPath: relative(workspace, reportPath), reportSha256,
      candidateReceiptSha256: report.candidate.sha256,
      sourceFingerprint: report.candidate.sourceFingerprint,
      replayInputFingerprint: report.replayInputs.fingerprint, imageId: report.candidate.imageId,
      classes: report.output.classes,
      ...(maintained ? { maintainedInputs: report.candidate.maintainedInputs } : {}),
      limitations: report.limitations,
    };
  } catch (cause) {
    const failureEvidence = maintainedUaaRequest(scope?.request)
      ? maintainedUaaReplayFailureEvidence : recoveredUaaReplayFailureEvidence;
    const diagnostic = selected && failureEvidence(scope?.result, selected);
    return {
      ...failed, reason: typeof cause?.message === 'string'
        ? cause.message : 'Required reconstructed UAA replay verification failed',
      ...(diagnostic ? {
        failureReplay: {
          ...diagnostic, reportPath: relative(workspace, diagnostic.reportPath),
          ...(diagnostic.compilerReceipt ? {
            compilerReceipt: { ...diagnostic.compilerReceipt,
              path: relative(workspace, diagnostic.compilerReceipt.path) },
          } : {}),
        },
      } : {}),
    };
  }
}

export function verifyRequiredUaaSourceClosureEvidence(scope) {
  const failed = {
    status: 'fail', maintainedSourceBuildVerified: false, runtimeImageBindingVerified: false,
    statefulRuntimeSecurityVerified: false, scopedOwnSourceClosureVerified: false,
    fullSourceClosureVerified: false, nativeAcceptance: false,
  };
  if (scope === undefined) {
    return { ...failed, reason: 'No independent UAA source closure evidence requested' };
  }
  let selected;
  try {
    selected = selectRequiredUaaSourceClosureEvidence(scope.request);
    if (scope.error) throw new Error(scope.error);
    const [build, runtime, stateful, closure] = ['buildReport', 'runtimeReport',
      'statefulReport', 'closureReport'].map(key => readCanonicalReport(selected[key]));
    const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
    const imageId = value => typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value);

    assert.equal(build.report.contract, 'standalone-uaa-maintained-source-compilation-v1');
    assert.equal(build.report.status, 'maintained-source-built-focused-fixture-tested-not-native-accepted');
    verifyBuildForPackaging(build.report);
    assert.equal(runtime.report.contract, 'standalone-uaa-recovered-source-runtime-packaging-v1');
    assert.equal(runtime.report.status, 'runtime-image-byte-bound-not-started-not-native-accepted');
    assert.equal(runtime.report.inputBuild.path, selected.buildReport,
      'UAA runtime input build path differs from the selected build report');
    assert.equal(runtime.report.inputBuild.bytes, build.bytes.length,
      'UAA runtime input build bytes differ');
    assert.equal(runtime.report.inputBuild.sha256, build.sha256);
    assert.ok(imageId(runtime.report.image.id), 'UAA runtime image id is malformed');
    assert.equal(runtime.report.image.id, stateful.report.image.id);
    assert.ok(digest(runtime.report.sourceFingerprint), 'UAA runtime source fingerprint is malformed');
    assert.equal(stateful.report.image.sourceBuildReceiptSha256, build.sha256);
    verifyStatefulReceipt(stateful.report);
    assert.ok(Array.isArray(stateful.report.inputs), 'UAA stateful report inputs are malformed');
    assert.deepEqual(
      stateful.report.inputs.map(input => ({ path: input.path, sha256: input.sha256 })).sort((a, b) =>
        a.path.localeCompare(b.path)),
      [
        { path: selected.runtimeReport, sha256: runtime.sha256 },
        { path: selected.buildReport, sha256: build.sha256 },
      ].sort((a, b) => a.path.localeCompare(b.path)),
      'UAA stateful inputs do not bind the selected runtime and build reports');
    assert.equal(closure.report.contract, 'standalone-uaa-maintained-source-class-closure-v1');
    assert.equal(closure.report.status, 'passed-scoped-editable-class-closure-not-native');
    verifyClosureReceipt(closure.report);
    assert.equal(closure.report.buildReceipt.path, selected.buildReport,
      'UAA closure build receipt path differs from the selected build report');
    assert.equal(closure.report.buildReceipt.bytes, build.bytes.length,
      'UAA closure build receipt bytes differ');
    assert.equal(closure.report.buildReceipt.sha256, build.sha256);
    assert.ok(digest(closure.report.starterFingerprint), 'UAA starter fingerprint is malformed');
    assert.equal(closure.report.sourceFingerprint, build.report.maintainedInputs.sourceBefore.fingerprint);
    assert.equal(runtime.report.sourceFingerprint, closure.report.sourceFingerprint);
    assert.equal(stateful.report.sourceFingerprint, closure.report.sourceFingerprint);
    assert.deepEqual(closure.report.modules.map(module => module.module),
      ['ibizlab-boot-starter', 'ibizlab-boot-starter-data', 'uaa-core', 'uaa-user', 'uaa-api']);

    return {
      ...failed, status: 'pass', maintainedSourceBuildVerified: true,
      runtimeImageBindingVerified: true, statefulRuntimeSecurityVerified: true,
      scopedOwnSourceClosureVerified: true,
      verification: 'canonical-scoped-uaa-source-build-image-stateful-closure-evidence',
      reports: {
        build: relative(workspace, selected.buildReport), buildSha256: build.sha256,
        runtime: relative(workspace, selected.runtimeReport), runtimeSha256: runtime.sha256,
        stateful: relative(workspace, selected.statefulReport), statefulSha256: stateful.sha256,
        closure: relative(workspace, selected.closureReport), closureSha256: closure.sha256,
      },
      sourceFingerprint: closure.report.sourceFingerprint,
      starterFingerprint: closure.report.starterFingerprint,
      imageId: runtime.report.image.id,
      modules: closure.report.modules.map(({ module, javaSources, classes }) =>
        ({ module, javaSources, classes })),
      statefulChecks: stateful.report.checks.length,
      limitations: closure.report.limitations,
    };
  } catch (cause) {
    return {
      ...failed,
      reason: typeof cause?.message === 'string' && cause.message
        ? cause.message : 'Required UAA source closure evidence verification failed',
      ...(selected ? {
        requested: Object.fromEntries(Object.entries(selected)
          .map(([key, path]) => [key, relative(workspace, path)])),
      } : {}),
    };
  }
}

function compilerSelection(request) {
  assert.ok(request && typeof request === 'object' && !Array.isArray(request),
    'Compiler request must be an object');
  assert.ok(Object.keys(request).every(key =>
    ['component', 'root', 'receiptPath', 'expectedImageId'].includes(key)),
  'Unknown compiler request field');
  assert.equal(typeof request.component, 'string', 'Compiler component must be a string');
  assert.ok(Object.hasOwn(javaSourceRoots, request.component),
    'No independently selected editable Java source binding for this component');
  assert.ok(typeof request.root === 'string' && request.root.length > 0
    && !/[\r\n\\,]/.test(request.root)
    && request.root.split('/').every((part, index) =>
      (index === 0 && part === '') || (part && part !== '.' && part !== '..')),
  'Unsafe compiler source root');
  const root = resolve(workspace, request.root);
  const allowed = resolve(workspace, javaSourceRoots[request.component]);
  assert.ok(root.startsWith(`${allowed}/`), 'Compiler source root is outside its required component');
  const path = relative(workspace, root);
  assert.ok(/(?:^|\/)src\/main\/java(?:\/|$)/.test(path),
    'Only explicit production Java source projections are supported');
  assert.ok(!path.split('/').some(part =>
    ['.git', '.artifacts', 'target', 'dist', 'fixtures', 'tests', 'test', 'node_modules'].includes(part)),
  'Generated, fixture or test roots cannot become required compiler evidence');
  assert.match(request.expectedImageId ?? '', /^sha256:[a-f0-9]{64}$/,
    'An independently selected immutable compiler image ID is required');
  assert.ok(typeof request.receiptPath === 'string' && request.receiptPath.length > 0
    && request.receiptPath.trim().length > 0
    && !/[\r\n\0]/.test(request.receiptPath), 'A safe compiler receipt path is required');
  return {
    component: request.component, root, path, expectedImageId: request.expectedImageId,
    receiptPath: resolve(workspace, request.receiptPath),
  };
}

function assertRequestedCompilerReceipt(selection, result) {
  assert.equal(selection.receiptPath, result.verifiedReceiptPath ?? result.receiptPath,
    'Requested compiler receipt differs from the authenticated direct or replay candidate');
}

// This predicate is diagnostic only; it never issues a compiler/source capability.
export function archiveFreeProjectionInputs(inputs, classpath) {
  const entries = inputs?.entries;
  const valid = Array.isArray(entries) && entries.length > 0
    && entries.every(entry => typeof entry?.path === 'string'
      && Number.isSafeInteger(entry.bytes) && entry.bytes >= 0
      && /^[a-f0-9]{64}$/.test(entry.sha256))
    && new Set(entries.map(entry => entry.path)).size === entries.length
    && Array.isArray(classpath);
  const opaqueInputs = valid ? entries.filter(entry =>
    /\.(?:class|jar|war|zip|ear|aar|jmod)$/i.test(entry.path)).map(entry => entry.path) : [];
  return {
    ok: valid && classpath.length === 0 && opaqueInputs.length === 0,
    verification: 'input-predicate-only-not-source-evidence',
    opaqueInputs, explicitClasspathEntries: valid ? classpath.length : null,
  };
}

export function verifyScopedOwnSourceClosure(scope) {
  const failed = {
    contract: 'independent-archive-free-java-projection-closure-v1',
    status: 'fail', projectionSourceClosureVerified: false,
    fullComponentSourceClosureVerified: false, nativeAcceptance: false,
  };
  try {
    const selection = compilerSelection(scope?.request);
    const inputs = collectCompilerInputs(selection.root);
    assert.ok(isLiveCompilerResult(scope?.result, {
      root: selection.root, inputFingerprint: inputs.fingerprint,
      expectedImageId: selection.expectedImageId,
    }), 'Own-source projection closure requires a current live independent Docker compiler capability');
    assertRequestedCompilerReceipt(selection, scope.result);
    const screen = archiveFreeProjectionInputs(inputs, scope.result.report.compiler.classpath);
    assert.ok(screen.ok,
      'Opaque bytecode/archive or explicit dependency inputs require independent dependency source closure');
    return {
      ...failed, status: 'pass', projectionSourceClosureVerified: true,
      currentInputFingerprint: inputs.fingerprint,
      compilerReceiptSha256: scope.result.receiptSha256,
      verification: 'live-archive-free-fixed-exclusion-java-projection-only',
      limitations: [
        'Only the inventoried Java slice and pinned JDK; not project/resource/dependency/runtime closure.',
        'No full component build, stub semantics, original-source provenance or UAA protocol verification.',
      ],
    };
  } catch (cause) {
    return { ...failed, reason: typeof cause?.message === 'string'
      ? cause.message : 'Independent projection closure verification failed' };
  }
}

function compilerScopeResult(scope) {
  const failed = { status: 'fail', fullComponentBuildVerified: false, nativeAcceptance: false };
  try {
    assert.ok(scope && typeof scope === 'object', 'Malformed scoped compiler result');
    if (scope.error) throw new Error(scope.error);
    const selection = compilerSelection(scope.request);
    const current = collectCompilerInputs(selection.root);
    assert.ok(isLiveCompilerResult(scope.result, {
      root: selection.root, inputFingerprint: current.fingerprint,
      expectedImageId: selection.expectedImageId,
    }), 'Copied, controlled, stale or failed compiler results cannot authenticate a source projection');
    assertRequestedCompilerReceipt(selection, scope.result);
    const { report, receiptPath, receiptSha256 } = scope.result;
    return {
      ...failed, status: 'pass', component: selection.component, root: selection.path,
      verification: 'live-docker-javac-current-production-source-projection-only',
      inputFingerprint: current.fingerprint, inputContract: 'compiler-source-file-inventory',
      sourceFiles: report.compiler.sourceFiles, outputFiles: report.output.files,
      imageId: report.compiler.imageId, receiptPath: relative(workspace, receiptPath),
      receiptSha256,
      ownSourceClosure: verifyScopedOwnSourceClosure(scope),
      ...(scope.result.verifiedReceiptSha256
        ? { candidateReceiptSha256: scope.result.verifiedReceiptSha256 } : {}),
    };
  } catch (cause) {
    const receiptPath = scope?.result?.receiptPath;
    const receiptSha256 = scope?.result?.receiptSha256;
    const failureEvidence = typeof receiptPath === 'string'
      && receiptPath.trim().length > 0 && !/[\r\n\0]/.test(receiptPath)
      && typeof receiptSha256 === 'string' && /^[a-f0-9]{64}$/.test(receiptSha256)
      ? { receiptPath: relative(workspace, receiptPath), receiptSha256 } : {};
    return {
      ...failed,
      ...(typeof scope?.request?.component === 'string'
        && Object.hasOwn(javaSourceRoots, scope.request.component)
        ? { component: scope.request.component } : {}),
      reason: typeof cause?.message === 'string' ? cause.message : 'Scoped compiler verification failed',
      ...failureEvidence,
    };
  }
}

function compilerCoverage(scopes, backendScope, uaaCompilerScope, componentEvidence) {
  const valid = Array.isArray(scopes) && scopes.length <= REQUIRED_D01_COMPONENTS.length;
  const projections = valid ? Array.from(scopes, compilerScopeResult)
    : [{ status: 'fail', reason: 'Malformed or excessive scoped compiler evidence', nativeAcceptance: false }];
  const seen = new Set();
  for (const projection of projections) {
    if (projection.component && seen.has(projection.component)) {
      projection.status = 'fail';
      projection.reason = 'Duplicate component scope cannot replace independent required coverage';
    }
    if (projection.component) seen.add(projection.component);
  }
  const passed = projections.filter(projection => projection.status === 'pass').length;
  const backendEvidence = verifyRequiredBackendBuildResult(backendScope);
  const reconstructedUaaEvidence = verifyRequiredRecoveredUaaEvidence(uaaCompilerScope);
  const attempts = [
    ...projections,
    ...(backendScope === undefined ? [] : [backendEvidence]),
    ...(uaaCompilerScope === undefined ? [] : [reconstructedUaaEvidence]),
  ];
  const attemptsPassed = attempts.filter(attempt => attempt.status === 'pass').length;
  return {
    contract: 'required-docker-source-coverage-v1',
    mechanismVerifiedForScopes: passed > 0 && projections.every(projection => projection.status === 'pass'),
    allRequiredComponentsVerified: false, componentInventoryVerified: false,
    fullSourceClosureVerified: false, nativeAcceptance: false,
    summaryScope: 'requested-scoped-evidence-only-not-required-component-closure',
    summary: {
      requested: attempts.length, passed: attemptsPassed,
      failed: attempts.length - attemptsPassed, skipped: 0,
    },
    projectionSummary: { requested: projections.length, passed, failed: projections.length - passed, skipped: 0 },
    projections,
    backendEvidence,
    reconstructedUaaEvidence,
    requiredComponents: REQUIRED_D01_COMPONENTS.map(component => {
      const backend = backendEvidence.components.find(item => item.component === component);
      const evidence = componentEvidence?.capabilities[component];
      return {
        component, status: 'fail', required: true,
        scopedCompilerVerified: projections.some(projection =>
          projection.component === component && projection.status === 'pass'),
        reconstructedCompilerOutputReplayVerified: component === 'uaa-standalone'
          && reconstructedUaaEvidence.reconstructedCompilerOutputReplayVerified,
        maintainedCompilerOutputReplayVerified: component === 'uaa-standalone'
          && reconstructedUaaEvidence.maintainedCompilerOutputReplayVerified,
        currentSourcePackageInDockerVerified: backend?.currentSourcePackageInDockerVerified === true
          || evidence?.currentSourcePackageInDockerVerified === true,
        imageArtifactBindingVerified: backend?.imageArtifactBindingVerified === true
          || evidence?.imageArtifactBindingVerified === true,
        sourceBuildVerified: evidence?.sourceBuildVerified === true,
        reproducibleBuildVerified: evidence?.reproducibleBuildVerified === true,
        ownDependencySourceClosureVerified: false, fullComponentBuildVerified: false,
        fullSourceClosureVerified: false,
        blockers: evidence?.blockers ?? [
          'No independently verified partial component evidence was requested for this component.',
        ],
        reason: backend
          ? 'Current source package and isolated candidate image bytes verified; recursive own-dependency source closure and complete D01 inventory remain unverified'
          : evidence?.sourceBuildVerified === true
            || evidence?.reproducibleBuildVerified === true
            || evidence?.currentSourcePackageInDockerVerified === true
            || evidence?.imageArtifactBindingVerified === true
            ? 'Independently verified partial evidence exists; recursive own-dependency closure, complete component inventory and native acceptance remain unverified'
            : 'Full current-source Docker build, own-dependency closure and artifact/image binding verifier is not integrated; a Java projection is insufficient',
      };
    }),
    blockers: [
      'The complete S01 per-component/package inventory is not independently bound to D01.',
      'Scoped javac replay does not run complete project/resource/codegen/package builds or prove editable dependency closure.',
      'A maintained standalone UAA scoped source build may be selected, but recursive dependency-source replay and actual protocol/encoder/grant closure remain unverified.',
    ],
  };
}

export function verifyRequiredComponentEvidence(scope) {
  const result = {
    contract: 'required-d01-component-evidence-audit-v1',
    status: 'fail',
    verification: 'read-only-partial-component-evidence-not-full-closure',
    nativeAcceptance: false,
    fullSourceClosureVerified: false,
    capabilities: Object.fromEntries(REQUIRED_D01_COMPONENTS.map(component => [component, {
      sourceBuildVerified: false,
      reproducibleBuildVerified: false,
      currentSourcePackageInDockerVerified: false,
      imageArtifactBindingVerified: false,
      blockers: ['Component evidence was not independently verified.'],
    }])),
    blockers: [],
  };
  if (scope === undefined) {
    return {
      ...result,
      status: 'not-requested',
      blockers: ['No partial component evidence audit was requested.'],
    };
  }
  try {
    const selection = selectRequiredComponentEvidenceRequest(scope);
    const capabilities = structuredClone(result.capabilities);
    const update = (component, evidence) => {
      capabilities[component] = {
        ...capabilities[component],
        ...evidence,
        blockers: [
          'Verified source/build/image evidence does not prove recursive iBiz-owned dependency source closure.',
          'Verified source/build/image evidence does not prove complete component inventory or native acceptance.',
        ],
      };
    };
    const backend = verifyBackendSourceImages({ reportPath: selection.backendImageReport });
    for (const item of backend.report.components) {
      update(backendComponents[item.name], {
        currentSourcePackageInDockerVerified: true,
        imageArtifactBindingVerified: true,
        imageId: item.image.id,
        archiveSha256: item.inventory.entries.find(entry => entry.path.endsWith('.jar')).sha256,
      });
    }
    const runtimeModel = verifyRuntimeModelSourceBuild({
      sourceReport: relative(workspace, selection.runtimeModelSourceReport),
    });
    update('runtime-model', {
      sourceBuildVerified: runtimeModel.report.sourceBuildVerified === true,
      reproducibleBuildVerified: runtimeModel.report.reproducibleBuildVerified === true,
      sourceFingerprint: runtimeModel.report.inputs.files.fingerprint,
      outputFingerprint: runtimeModel.report.outputs.fingerprint,
      reportSha256: runtimeModel.reportSha256,
    });
    const nativeCli = verifyNativeCliSourceBuild({
      sourceReport: relative(workspace, selection.nativeCliSourceReport),
    });
    update('native-cli', {
      sourceBuildVerified: nativeCli.cliSourceBuildVerified === true,
      sourceFingerprint: nativeCli.report.source.fingerprint,
      version: nativeCli.version,
      reportSha256: nativeCli.reportSha256,
    });
    return {
      ...result,
      status: 'passed-partial-evidence-audit',
      capabilities,
      reports: {
        backendImages: {
          path: relative(workspace, backend.reportPath),
          sha256: backend.reportSha256,
        },
        runtimeModel: {
          path: relative(workspace, runtimeModel.reportPath),
          sha256: runtimeModel.reportSha256,
        },
        nativeCli: {
          path: relative(workspace, nativeCli.reportPath),
          sha256: nativeCli.reportSha256,
        },
      },
      blockers: [
        'UAA and Task canonical closure are separate S06 evidence and are not promoted by this audit.',
        'PLM backend, frontend, app-framework and plugins still require component-specific source/build/runtime evidence.',
        'No partial component evidence can prove all-D01 full source closure or native acceptance.',
      ],
    };
  } catch (cause) {
    return {
      ...result,
      status: 'fail',
      reason: typeof cause?.message === 'string'
        ? cause.message : 'Component evidence audit failed',
      blockers: [
        ...result.blockers,
        'Component evidence audit failed before all reports could be verified.',
      ],
    };
  }
}

export function verifyRequiredTaskSourceClosureEvidence(scope) {
  const failed = {
    status: 'fail', scopedOwnSourceClosureVerified: false,
    fullSourceClosureVerified: false, nativeAcceptance: false,
  };
  if (scope === undefined) {
    return { ...failed, reason: 'No independent Task source closure evidence requested' };
  }
  try {
    const request = scope.request;
    assert.ok(request && typeof request === 'object' && !Array.isArray(request),
      'Task source closure evidence request must be an object');
    assert.deepEqual(Object.keys(request).sort(),
      ['inputClosure', 'inputScreen', 'warBinding'],
      'Task source closure evidence requires all three canonical reports');
    const selected = {};
    for (const [key, path] of Object.entries(request)) {
      assert.equal(typeof path, 'string', `Task ${key} must be a canonical report path`);
      assert.match(path,
        /^task7\/\.artifacts\/task7-independent-compiler-[A-Za-z0-9]+\/(?:current-input-screen|input-screen|war-output-binding)\.json$/,
        `Task ${key} is not a canonical artifact`);
      selected[key] = resolve(workspace, path);
    }
    if (scope.error) throw new Error(scope.error);
    const readiness = readCanonicalReport(
      join(workspace, '.artifacts/uaa-task-readiness-current/report.json')).report;
    const result = verifyTaskOwnSourceClosureEvidence({
      taskEvidence: {
        artifactReady: true, imageReady: true,
        evidence: readiness.sourceBuildEvidence.task30088,
      },
      buildReceiptPath: join(workspace,
        'task7/.artifacts/source-build/source-build.json'),
      inputScreenPath: selected.inputScreen,
      inputClosurePath: selected.inputClosure,
      warBindingPath: selected.warBinding,
    });
    assert.equal(result.ok, true, 'Task closure evidence is missing, stale or inconsistent');
    return {
      status: 'pass',
      scopedOwnSourceClosureVerified: true,
      fullSourceClosureVerified: false,
      nativeAcceptance: false,
      verification: 'task7-war-output-binding-v1',
      sourceFingerprint: result.evidence.sourceFingerprint,
      buildCommit: result.evidence.buildCommit,
      warSha256: result.evidence.warSha256,
      classes: result.evidence.classes,
      jars: result.evidence.jars,
      findings: [],
    };
  } catch (cause) {
    return { ...failed, reason: typeof cause?.message === 'string'
      ? cause.message : 'Required Task source closure verification failed' };
  }
}

function serviceResult(report, service, id) {
  const expected = serviceChecks[service];
  const fullRoster = Object.values(serviceChecks).flat();
  const rosterValid = Array.isArray(report?.checks)
    && report.checks.length === fullRoster.length
    && new Set(report.checks.map(check => check?.id)).size === fullRoster.length
    && report.checks.every(check => check && Object.hasOwn(serviceChecks, check.service)
      && serviceChecks[check.service].includes(check.id));
  const checks = rosterValid ? report.checks.filter(check => check.service === service) : [];
  const names = checks.map(check => check.id);
  const readyKey = service === 'uaa' ? 'uaa32666' : 'task30088';
  const evidence = report?.sourceBuildEvidence?.[readyKey];
  const inputs = evidence?.currentInputs;
  const stubs = evidence?.knownStubAudit;
  const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
  const commit = value => typeof value === 'string' && /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(value);
  const safeInput = entry => typeof entry?.path === 'string'
    && !entry.path.includes('\\') && !entry.path.startsWith('/')
    && entry.path.split('/').every(part => part && part !== '.' && part !== '..')
    && Number.isSafeInteger(entry.bytes) && entry.bytes > 0 && digest(entry.sha256);
  const bytecode = evidence?.ownSourceBytecodeClosure;
  const bytecodeDiagnosticsValid = bytecode?.contract === 'source-bytecode-closure-readiness-v1'
    && bytecode.state === 'unverified'
    && digest(bytecode.currentInputFingerprint)
    && bytecode.currentInputFingerprint === inputs?.fingerprint
    && Array.isArray(bytecode.compiledInputs)
    && bytecode.compiledInputs.length <= inputs?.files
    && bytecode.compiledInputs.every(entry => safeInput(entry) && entry.path.endsWith('.class'))
    && new Set(bytecode.compiledInputs.map(entry => entry.path)).size === bytecode.compiledInputs.length
    && Number.isSafeInteger(bytecode.archiveInputs) && bytecode.archiveInputs >= 0
    && bytecode.archiveInputs + bytecode.compiledInputs.length <= inputs?.files;
  const image = evidence?.sourceImageObservation;
  const imageObservationValid = image?.contract === 'source-image-identity-observation-v1'
    && image.state === 'observed-identity-only'
    && image.verification === 'image-identity-only-not-compiler-or-artifact-binding'
    && image.evidenceOrigin === 'live-read-only-image-inspection'
    && digest(image.currentInputFingerprint) && image.currentInputFingerprint === inputs?.fingerprint
    && commit(image.sourceCommit) && image.sourceCommit === evidence?.recordedSourceCommit
    && digest(image.artifactSha256) && image.artifactSha256 === evidence?.artifactSha256
    && typeof image.imageTag === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/@-]{0,255}$/.test(image.imageTag)
    && typeof image.imageId === 'string' && /^sha256:[a-f0-9]{64}$/.test(image.imageId)
    && image.platform === 'linux/arm64' && image.observations === 2;
  const authSource = evidence?.standaloneAuthSource;
  const runtime = report?.runtimeTargetObservation;
  const binding = runtime?.evidence;
  const runtimeBindingValid = service !== 'uaa' || (
    runtime?.ok === true
    && binding?.contract === 'uaa-standalone-runtime-artifact-observation-v1'
    && binding.target === 'uaa-standalone-sys-person'
    && binding.state === 'observed-identity-only'
    && binding.verification === 'runtime-artifact-identity-only-not-source-or-protocol'
    && binding.evidenceOrigin === 'live-read-only-runtime-observation'
    && binding.nativeAcceptance === false && binding.sourceRuntimeCompatible === false
    && binding.effectivePasswordEncoderVerified === false
    && binding.container === 'ibizlab-uaa-api'
    && digest(binding.containerId)
    && typeof binding.imageId === 'string' && /^sha256:[a-f0-9]{64}$/.test(binding.imageId)
    && binding.platform === 'linux/arm64'
    && typeof binding.startedAt === 'string' && Number.isFinite(Date.parse(binding.startedAt))
    && binding.entrypointPath === '/entrypoint.sh' && binding.jarFilename === 'uaa-api'
    && binding.runtimeJarPath === '/uaa-api.jar'
    && binding.localJarPath === 'runtime-jars/ibizlab-uaa-api.jar'
    && digest(binding.entrypointSha256) && digest(binding.runtimeJarSha256)
    && binding.runtimeJarSha256 === binding.localJarSha256
  );
  const protocol = service === 'uaa' ? standaloneUaaProtocolClosureReadiness() : null;
  const authProtocol = evidence?.standaloneAuthProtocol;
  const standaloneProtocolValid = service !== 'uaa' || (
    authProtocol?.contract === protocol.evidence.contract
    && authProtocol.target === protocol.evidence.target
    && authProtocol.state === 'unverified'
    && digest(authProtocol.currentInputFingerprint)
    && authProtocol.currentInputFingerprint === inputs?.fingerprint
    && JSON.stringify(authProtocol.requiredContract) === JSON.stringify(protocol.evidence.requiredContract)
    && JSON.stringify(authProtocol.requiredVerification) === JSON.stringify(protocol.evidence.requiredVerification)
  );
  const standaloneSourceValid = service !== 'uaa' || (
    authSource?.contract === 'uaa-standalone-editable-inputs-v1'
    && authSource.target === 'uaa-standalone-sys-person'
    && authSource.verification === 'input-presence-only-not-source-or-native-provenance'
    && digest(authSource.currentInputFingerprint)
    && authSource.currentInputFingerprint === inputs?.fingerprint
    && JSON.stringify(authSource.requiredInputs) === JSON.stringify(STANDALONE_UAA_EDITABLE_INPUTS)
    && Array.isArray(authSource.missingInputs) && authSource.missingInputs.length === 0
    && Array.isArray(authSource.presentInputs)
    && authSource.presentInputs.length === STANDALONE_UAA_EDITABLE_INPUTS.length
    && STANDALONE_UAA_EDITABLE_INPUTS.every(required => {
      const matches = authSource.presentInputs.filter(entry => entry?.required === required);
      return matches.length === 1 && typeof matches[0].path === 'string'
        && (matches[0].path === required || matches[0].path.endsWith(`/${required}`))
        && !matches[0].path.includes('\\')
        && matches[0].path.split('/').every(part => part && part !== '.' && part !== '..')
        && Number.isSafeInteger(matches[0].bytes) && matches[0].bytes > 0
        && digest(matches[0].sha256);
    })
  );
  const valid = report?.schemaVersion === 1
    && report.contract === 'uaa-task-own-source-readiness'
    && report.nativeAcceptance === false
    && report.compilerBuildInDockerVerified === false
    && report.runBuild === false
    && report.readiness?.[readyKey] === true
    && evidence?.receiptState === 'verified-current-inputs'
    && evidence?.recordedInputContract === 'source-build-input-inventory-v1'
    && evidence?.buildExitCode === 0 && evidence?.recordedPlatform === 'linux/arm64'
    && digest(evidence?.receiptSha256) && digest(evidence?.artifactSha256)
    && commit(evidence?.recordedSourceCommit)
    && evidence.recordedSourceCommit === report.source?.[service === 'uaa' ? 'uaaCommit' : 'taskCommit']
    && Number.isSafeInteger(inputs?.files) && inputs.files > 0
    && Number.isSafeInteger(inputs?.bytes) && inputs.bytes > 0
    && inputs?.fingerprintKind === 'relative-file-set' && digest(inputs?.fingerprint)
    && stubs?.contract === 'known-decompilation-stub-audit-v1'
    && digest(stubs.currentInputFingerprint) && stubs.currentInputFingerprint === inputs.fingerprint
    && bytecodeDiagnosticsValid && imageObservationValid
    && standaloneSourceValid
    && standaloneProtocolValid
    && runtimeBindingValid
    && Number.isSafeInteger(stubs?.javaFiles) && stubs.javaFiles > 0 && stubs.javaFiles <= inputs.files
    && Array.isArray(stubs?.findings) && stubs.findings.length === 0
    && names.length === expected.length
    && new Set(names).size === expected.length
    && expected.every(name => names.includes(name))
    && checks.every(check => check.status === 'pass')
    && JSON.stringify(report.services?.[readyKey]) === JSON.stringify(checks);
  // A supplied pass status cannot invent the independent verifier we lack.
  const closure = service === 'task'
    ? verifyTaskOwnSourceClosureEvidence({
      taskEvidence: { artifactReady: valid, imageReady: valid, evidence },
      buildReceiptPath: join(workspace,
        'task7/.artifacts/source-build/source-build.json'),
      inputScreenPath: report?.taskOwnSourceClosure?.evidence?.inputScreen?.reportPath,
      inputClosurePath: report?.taskOwnSourceClosure?.evidence?.inputClosure?.reportPath,
      warBindingPath: report?.taskOwnSourceClosure?.evidence?.warBinding?.reportPath,
    }) : ownSourceBytecodeClosureReadiness();
  const passed = valid && closure.ok && (service !== 'uaa' || protocol.ok);
  return {
    id, required: true, status: passed ? 'pass' : 'fail',
    fullSourceClosureVerified: false,
    ...(service === 'task' ? {
      verification: closure.ok ? 'task7-war-output-binding-v1' : null,
      scopedOwnSourceClosureVerified: closure.ok,
    } : {}),
    inputDiagnostics: {
      verification: 'readiness-observation-only-not-independent-source-closure',
      currentInputFingerprint: digest(inputs?.fingerprint) ? inputs.fingerprint : null,
      scannedJavaFiles: Number.isSafeInteger(stubs?.javaFiles) && stubs.javaFiles >= 0 ? stubs.javaFiles : null,
      knownStubFindings: Array.isArray(stubs?.findings) ? stubs.findings.length : null,
      archiveInputs: Number.isSafeInteger(bytecode?.archiveInputs) && bytecode.archiveInputs >= 0
        ? bytecode.archiveInputs : null,
      compiledInputs: Array.isArray(bytecode?.compiledInputs) ? bytecode.compiledInputs.length : null,
    },
    unmetChecks: expected.filter(name => !checks.some(check => check.id === name && check.status === 'pass')),
    reason: passed
      ? service === 'task'
        ? 'Current Task inputs, independent compiler outputs and WAR bytes are byte-bound; not native acceptance'
        : 'Every independent current-source and image readiness check passed; not native acceptance'
      : valid ? [protocol?.reason, closure.reason].filter(Boolean).join(' ')
        : 'Missing, duplicate, skipped, failed or inconsistent required target-source, current-input, stub or own-bytecode closure evidence',
  };
}

export function evaluateRequiredSourceGates(report, compilerScopes = [], backendScope,
  uaaCompilerScope, uaaSourceClosureScope, taskSourceClosureScope, componentEvidenceScope) {
  const componentEvidence = verifyRequiredComponentEvidence(componentEvidenceScope);
  const compilerEvidence = compilerCoverage(
    compilerScopes, backendScope, uaaCompilerScope, componentEvidence,
  );
  const uaaSourceClosureEvidence = verifyRequiredUaaSourceClosureEvidence(uaaSourceClosureScope);
  const taskSourceClosureEvidence = verifyRequiredTaskSourceClosureEvidence(taskSourceClosureScope);
  const uaaReadinessEvidence = serviceResult(report, 'uaa', REQUIRED_SOURCE_GATES[0]);
  const checks = [
    {
      ...uaaReadinessEvidence,
      ...uaaSourceClosureEvidence,
      unmetChecks: uaaSourceClosureEvidence.status === 'pass'
        ? [] : uaaReadinessEvidence.unmetChecks,
      reason: uaaSourceClosureEvidence.status === 'pass'
        ? 'Canonical maintained build, image binding, stateful Boot/MySQL/Redis/token security and scoped own-source closure passed; not native acceptance'
        : uaaSourceClosureEvidence.reason,
    },
    {
      ...serviceResult(report, 'task', REQUIRED_SOURCE_GATES[1]),
      ...taskSourceClosureEvidence,
      unmetChecks: taskSourceClosureEvidence.status === 'pass'
        ? [] : serviceResult(report, 'task', REQUIRED_SOURCE_GATES[1]).unmetChecks,
      reason: taskSourceClosureEvidence.status === 'pass'
        ? 'Canonical Task source build, input screen and independent compiler-to-WAR byte binding passed; not native acceptance'
        : taskSourceClosureEvidence.reason,
    },
    {
      id: REQUIRED_SOURCE_GATES[2], required: true, status: 'fail', fullSourceClosureVerified: false,
      reason: 'The independent compiler-in-Docker verifier supports scoped Java replay only; missing all-component source/build/dependency/image closure remains required and failed',
      unmetComponents: [...REQUIRED_D01_COMPONENTS],
    },
  ];
  const rejectedSourceSkips = Array.isArray(report?.checks)
    ? report.checks.filter(check => check?.status === 'skip').length : 0;
  return {
    schemaVersion: 1, contract: 'required-own-source-gates',
    status: checks.every(check => check.status === 'pass') ? 'passed' : 'failed',
    nativeAcceptance: false, compilerBuildInDockerVerified: false, fullSourceClosureVerified: false,
    compilerEvidence,
    componentEvidence,
    requiredGates: [...REQUIRED_SOURCE_GATES],
    checks,
    summary: {
      required: checks.length,
      passed: checks.filter(check => check.status === 'pass').length,
      failed: checks.filter(check => check.status === 'fail').length,
      skipped: 0, rejectedSourceSkips,
    },
    limitations: [
      'This is the mandatory S06 UAA/Task and D01 compiler subset, not full H01/native acceptance.',
      'Frontend, controlled fixture and static-delivery results are never promoted to compiler or native evidence.',
      'UAA/Task source inventory checks do not replace pinned compiler/image provenance.',
      'Verified production Java projections are not complete component builds or all-D01 coverage.',
      'S06 cannot pass while its independent own-bytecode/dependency source closure verifier is missing.',
      'Legacy IBZUSER source/build receipts cannot substitute for standalone sys_person /auths/login editable inputs.',
      'Standalone UAA protocol closure cannot be supplied by claimed booleans, same-name source files or copied runtime hashes.',
      'Live entrypoint/JAR identity observations cannot replace editable standalone source or protocol/encoder verification.',
      'Packaged password configuration and login grants cannot replace effective encoder and authenticated fine-grant verification.',
      'Fresh backend packaging and image byte binding cannot promote binary dependencies or missing D01 components to source closure.',
      'Reconstructed UAA class-output replay does not establish starter/source dependency closure, native protocol or deployment parity.',
    ],
  };
}

export function runRequiredSourceGates(options = {}) {
  assert.ok(options && typeof options === 'object' && !Array.isArray(options),
    'Required source gate options must be an object');
  const destination = resolve(options.reportDir ??
    join(workspace, '.artifacts/required-source-gates', `audit-${randomUUID()}`));
  const directories = new PinnedDirectories();
  try {
    const run = directories.open(destination, { create: true, exclusive: true });
    try {
      for (const key of Object.keys(options)) assert.ok([
        'reportDir', 'execute', 'compilerRequests', 'compilerExecute',
        'backendBuildRequest', 'uaaCompilerRequest', 'uaaSourceClosureRequest',
        'taskSourceClosureRequest', 'componentEvidenceRequest',
      ].includes(key), `Unsupported required source gate option: ${key}`);
      for (const key of ['execute', 'compilerExecute']) {
        assert.ok(options[key] === undefined || typeof options[key] === 'function',
          `Required source gate ${key} must be a function`);
      }
    } catch (cause) {
      const report = {
        ...evaluateRequiredSourceGates(null), generatedAt: new Date().toISOString(),
        evidence: 'rejected-run-configuration-not-source-evidence',
        command: {
          path: relative(workspace, join(scriptsRoot, 'harness-uaa-task-readiness.mjs')),
          exitCode: null, signal: null,
        },
        errors: [cause.message],
      };
      const reportPath = join(destination, 'report.json');
      directories.write(run, 'report.json', `${JSON.stringify(report, null, 2)}\n`);
      return { report, reportPath };
    }
    const readinessPath = join(destination, 'uaa-task-readiness.json');
    const execute = options.execute ?? spawnSync;
    let command = {};
    let readiness;
    let evidenceSha256;
    let error;
    try {
      command = execute(process.execPath, [
        join(scriptsRoot, 'harness-uaa-task-readiness.mjs'),
      ], {
        cwd: workspace, encoding: 'utf8', timeout: 60_000,
        maxBuffer: 8 * 1024 * 1024,
        env: { ...process.env, UAA_TASK_READINESS_REPORT: readinessPath, NODE_OPTIONS: '', NODE_PATH: '' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      directories.verify(run);
      assert.ok(command && typeof command === 'object', 'UAA/Task audit returned no command result');
      assert.ok(!command.error && !command.signal, 'UAA/Task audit launch failed, timed out or was signalled');
      assert.ok(command.status === 0 || command.status === 1, 'Unexpected UAA/Task audit exit');
      const { data: file } = readPinnedFile(directories, run, 'uaa-task-readiness.json');
      readiness = JSON.parse(file);
      assert.deepEqual(readiness, JSON.parse(command.stdout), 'UAA/Task stdout and report differ');
      const serviceReady = readiness.readiness?.uaa32666 === true
        && readiness.readiness?.task30088 === true;
      assert.equal(command.status, serviceReady ? 0 : 1, 'UAA/Task audit exit conflicts with report');
      evidenceSha256 = hash(file);
    } catch (cause) {
      error = typeof cause?.message === 'string' && cause.message
        ? cause.message : 'Independent source audit failed without a structured error';
      readiness = null;
      if (!command || typeof command !== 'object') command = {};
    }
    const compilerScopes = [];
    const requests = options.compilerRequests ?? [];
    if (!Array.isArray(requests) || requests.length > REQUIRED_D01_COMPONENTS.length) {
      compilerScopes.push({ error: 'Malformed or excessive compiler replay requests' });
    } else {
      const components = new Set();
      for (const [index, request] of requests.entries()) {
        const scope = { request };
        compilerScopes.push(scope);
        try {
          const selection = compilerSelection(request);
          assert.ok(!components.has(selection.component), 'Duplicate component compiler request');
          components.add(selection.component);
          assert.ok(typeof request.receiptPath === 'string' && request.receiptPath.length > 0,
            'Compiler receipt path is required');
          scope.result = verifyCompilerReceipt({
            receiptPath: resolve(workspace, request.receiptPath), root: selection.root,
            expectedImageId: selection.expectedImageId,
            output: join(destination, `compiler-replay-${index}`),
            ...(options.compilerExecute ? { execute: options.compilerExecute } : {}),
          });
        } catch (cause) {
          scope.error = typeof cause?.message === 'string' ? cause.message : 'Compiler replay failed';
        }
      }
    }
    let backendScope;
    if (Object.hasOwn(options, 'backendBuildRequest')) {
      backendScope = { request: options.backendBuildRequest };
      try {
        selectRequiredBackendBuild(backendScope.request);
        assert.ok(!options.execute && !options.compilerExecute,
          'Controlled required runners cannot launch or promote live backend rebuilds');
        backendScope.result = rebuildRequiredBackendEvidence(backendScope.request);
        if (backendScope.result.status !== 'pass') backendScope.error = backendScope.result.reason;
      } catch (cause) {
        backendScope.error = typeof cause?.message === 'string' ? cause.message : 'Required backend rebuild failed';
      }
    }
    let uaaCompilerScope;
    if (Object.hasOwn(options, 'uaaCompilerRequest')) {
      uaaCompilerScope = { request: options.uaaCompilerRequest };
      try {
        const selected = selectRequiredUaaCompilerReplay(uaaCompilerScope.request);
        assert.ok(!options.execute && !options.compilerExecute,
          'Controlled required runners cannot launch or promote live reconstructed UAA replay');
        const verify = maintainedUaaRequest(uaaCompilerScope.request)
          ? verifyMaintainedUaaCompilerOutputs : verifyRecoveredUaaCompilerOutputs;
        uaaCompilerScope.result = verify({
          ...selected, output: join(destination, 'reconstructed-uaa-compiler-replay'),
        });
        if (uaaCompilerScope.result.exitCode !== 0) {
          uaaCompilerScope.error = uaaCompilerScope.result.report.errors.join('; ');
        }
      } catch (cause) {
        uaaCompilerScope.error = typeof cause?.message === 'string'
          ? cause.message : 'Required reconstructed UAA replay failed';
      }
    }
    let uaaSourceClosureScope;
    if (Object.hasOwn(options, 'uaaSourceClosureRequest')) {
      uaaSourceClosureScope = { request: options.uaaSourceClosureRequest };
    }
    let taskSourceClosureScope;
    if (Object.hasOwn(options, 'taskSourceClosureRequest')) {
      taskSourceClosureScope = { request: options.taskSourceClosureRequest };
    }
    const evaluated = evaluateRequiredSourceGates(
      readiness, compilerScopes, backendScope, uaaCompilerScope,
      uaaSourceClosureScope, taskSourceClosureScope, options.componentEvidenceRequest,
    );
    const errors = [
      ...(error ? [error] : []),
      ...evaluated.compilerEvidence.projections.filter(scope => scope.status === 'fail')
        .map(scope => scope.reason),
      ...(backendScope && evaluated.compilerEvidence.backendEvidence.status !== 'pass'
        ? [evaluated.compilerEvidence.backendEvidence.reason] : []),
      ...(uaaCompilerScope && evaluated.compilerEvidence.reconstructedUaaEvidence.status !== 'pass'
        ? [evaluated.compilerEvidence.reconstructedUaaEvidence.reason] : []),
    ];
    const report = {
      ...evaluated, generatedAt: new Date().toISOString(),
      migrationInputAudit: auditRequiredMigrationBindings(),
      evidence: options.execute
        ? 'controlled-runner-not-native-evidence' : 'live-read-only-source-readiness-audit',
      command: {
        path: relative(workspace, join(scriptsRoot, 'harness-uaa-task-readiness.mjs')),
        exitCode: command.status ?? null, signal: command.signal ?? null,
      },
      ...(readiness ? {
        readinessEvidence: {
          path: relative(workspace, readinessPath),
          sha256: evidenceSha256,
        },
      } : {}),
      ...(backendScope ? {
        backendBuildReports: ['packageReportPath', 'imageReportPath']
          .filter(key => typeof backendScope.result?.[key] === 'string')
          .map(key => ({ stage: key, path: relative(workspace, backendScope.result[key]) })),
      } : {}),
      ...(uaaCompilerScope?.result ? {
        uaaCompilerReplayReport: {
          path: relative(workspace, uaaCompilerScope.result.reportPath),
          sha256: uaaCompilerScope.result.reportSha256,
        },
      } : {}),
      ...(uaaSourceClosureScope ? {
        uaaSourceClosureEvidence: {
          request: uaaSourceClosureScope.request,
          verification: evaluated.checks[0].verification,
        },
      } : {}),
      ...(taskSourceClosureScope ? {
        taskSourceClosureEvidence: {
          request: taskSourceClosureScope.request,
          verification: evaluated.checks[1].verification,
        },
      } : {}),
      ...(options.componentEvidenceRequest ? {
        componentEvidenceRequest: options.componentEvidenceRequest,
      } : {}),
      ...(errors.length ? { errors } : {}),
    };
    const reportPath = join(destination, 'report.json');
    directories.write(run, 'report.json', `${JSON.stringify(report, null, 2)}\n`);
    return { report, reportPath };
  } finally { directories.close(); }
}

export function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({
    args, options: {
      'report-dir': { type: 'string' },
      'compiler-request': { type: 'string', multiple: true },
      'backend-build-request': { type: 'string' },
      'uaa-compiler-request': { type: 'string' },
      'uaa-source-closure-request': { type: 'string' },
      'task-source-closure-request': { type: 'string' },
      'component-evidence-request': { type: 'string' },
      help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log('Usage: node scripts/harness-required-source-gates.mjs [--report-dir NEW_DIRECTORY] [--compiler-request JSON]');
    console.log('Compiler request: {"component":"modeling-backend","root":"production/src/main/java","receiptPath":"receipt.json","expectedImageId":"sha256:..."}');
    console.log('UAA/Task audit is read-only; requested Java receipts invoke fresh isolated Docker replay.');
    console.log('No skips or native promotion; projections cannot satisfy missing all-component D01 closure.');
    console.log('Optional --backend-build-request JSON: {"permissionReportPath":".artifacts/RUN/report.json"}');
    console.log('Backend requests actually rebuild isolated source packages and unique candidate images; no shared-service restarts or full closure promotion.');
    console.log('Optional --uaa-compiler-request JSON: {"receiptPath":".artifacts/standalone-uaa-editable-RUN/build-ID/report.json","expectedImageId":"sha256:..."}; fresh class replay only, S06/D01 remain required.');
    console.log('Canonical maintained receiptPath also supported: .artifacts/standalone-uaa-source-build/build-ID/report.json; binds current maintained inputs, scoped class replay only.');
    console.log('Optional --uaa-source-closure-request JSON: {"buildReport":".artifacts/standalone-uaa-source-build/build-ID/report.json","runtimeReport":".artifacts/standalone-uaa-source-runtime/runtime-ID/report.json","statefulReport":".artifacts/standalone-uaa-stateful-security/security-ID/report.json","closureReport":".artifacts/standalone-uaa-source-closure/closure-ID/report.json"}');
    console.log('Optional --task-source-closure-request JSON: {"inputScreen":"task7/.artifacts/task7-independent-compiler-RUN/current-input-screen.json","inputClosure":"task7/.artifacts/task7-independent-compiler-RUN/input-screen.json","warBinding":"task7/.artifacts/task7-independent-compiler-RUN/war-output-binding.json"}');
    console.log('Optional --component-evidence-request JSON: {"backendImageReport":".artifacts/d01-backend-source-images-RUN/report.json","runtimeModelSourceReport":".artifacts/runtime-model-source-build/RUN/report.json","nativeCliSourceReport":".artifacts/native-cli-source-build/RUN/report.json"}; read-only partial evidence audit, never full closure promotion.');
    return 0;
  }
  const compilerRequests = (values['compiler-request'] ?? []).map(value => {
    try { return JSON.parse(value); }
    catch { return { parseError: 'Malformed compiler request JSON' }; }
  });
  const uaaSourceClosureRequest = values['uaa-source-closure-request'] !== undefined
    ? (() => {
      try { return JSON.parse(values['uaa-source-closure-request']); }
      catch { return { parseError: 'Malformed UAA source closure request JSON' }; }
    })() : undefined;
  const taskSourceClosureRequest = values['task-source-closure-request'] !== undefined
    ? (() => {
      try { return JSON.parse(values['task-source-closure-request']); }
      catch { return { parseError: 'Malformed Task source closure request JSON' }; }
    })() : undefined;
  const componentEvidenceRequest = values['component-evidence-request'] !== undefined
    ? (() => {
      try { return JSON.parse(values['component-evidence-request']); }
      catch { return { parseError: 'Malformed component evidence request JSON' }; }
    })() : undefined;
  const { report, reportPath } = runRequiredSourceGates({
    reportDir: values['report-dir'], compilerRequests,
    ...(values['backend-build-request'] !== undefined ? {
      backendBuildRequest: (() => {
        try { return JSON.parse(values['backend-build-request']); }
        catch { return { parseError: 'Malformed backend build request JSON' }; }
      })(),
    } : {}),
    ...(values['uaa-compiler-request'] !== undefined ? {
      uaaCompilerRequest: (() => {
        try { return JSON.parse(values['uaa-compiler-request']); }
        catch { return { parseError: 'Malformed reconstructed UAA compiler request JSON' }; }
      })(),
    } : {}),
    ...(uaaSourceClosureRequest !== undefined ? { uaaSourceClosureRequest } : {}),
    ...(taskSourceClosureRequest !== undefined ? { taskSourceClosureRequest } : {}),
    ...(componentEvidenceRequest !== undefined ? { componentEvidenceRequest } : {}),
  });
  console.log(JSON.stringify({ ...report, reportPath }, null, 2));
  return report.status === 'passed' ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
