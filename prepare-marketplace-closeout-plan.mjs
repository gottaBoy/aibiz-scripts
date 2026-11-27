#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const workspaceDefault = path.resolve(import.meta.dirname, '..');
const recordPath = 'scripts/records/aibiz-real-marketplace-package-20261122.json';
const offlineRecordPath = 'scripts/records/aibiz-offline-implementation-20261122.json';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;

function privateFile(workspace, relative, { required = true, strictPrivate = false } = {}) {
  const filename = path.resolve(workspace, relative);
  const child = path.relative(workspace, filename);
  assert.ok(child && !child.startsWith('../') && !path.isAbsolute(child));
  try {
    const stat = fs.lstatSync(filename);
    assert.ok(stat.isFile() && !stat.isSymbolicLink(), `Private evidence must be a regular file: ${relative}`);
    if (strictPrivate) {
      assert.equal(stat.uid, process.geteuid(), `Private evidence owner changed: ${relative}`);
      assert.equal(stat.mode & 0o077, 0, `Private evidence permissions changed: ${relative}`);
    }
    const bytes = fs.readFileSync(filename);
    return { path: relative, filename, bytes, sha256: hash(bytes), json: () => JSON.parse(bytes) };
  } catch (error) {
    if (!required && error.code === 'ENOENT') return null;
    throw error;
  }
}

function existingPath(workspace, relative) {
  const filename = path.resolve(workspace, relative);
  const child = path.relative(workspace, filename);
  assert.ok(child && !child.startsWith('../') && !path.isAbsolute(child));
  try {
    const stat = fs.lstatSync(filename);
    return { path: relative, exists: true, regular: stat.isFile() && !stat.isSymbolicLink(),
      bytes: stat.isFile() ? stat.size : null };
  } catch (error) {
    if (error.code === 'ENOENT') return { path: relative, exists: false, regular: false, bytes: null };
    throw error;
  }
}

function sourceBinding(workspace, relative) {
  const file = privateFile(workspace, relative);
  return { path: relative, bytes: file.bytes.length, sha256: file.sha256 };
}

export function classifyMarketplaceCloseoutGates({ packageReports, replay, offline, sourceBindings }) {
  assert.ok(Array.isArray(packageReports) && packageReports.length >= 2);
  assert.ok(replay && offline && Array.isArray(sourceBindings));
  const packageNativeFlags = packageReports.map(row => ({
    version: row.version, manifestSha256: row.manifestSha256,
    nativeInstallationExecuted: row.nativeInstallationExecuted === true,
    nativeMarketplaceAcceptance: row.nativeMarketplaceAcceptance === true,
  }));
  const localReplay = {
    status: replay.status,
    kernelIsolated: replay.kernelNoNewPrivs === 1 && replay.kernelSeccompMode === 2,
    localInstallUpdateRollbackObserved: replay.observations?.length >= 4
      && replay.nativeInstallationExecuted === false
      && replay.nativeMarketplaceAcceptance === false,
    nativeInstallationExecuted: replay.nativeInstallationExecuted === true,
    nativeMarketplaceAcceptance: replay.nativeMarketplaceAcceptance === true,
  };
  const offlineBuild = {
    sourceBindings: sourceBindings.length,
    networkGuard: offline.networkIsolation?.guardedNativeProcess?.fetch === 'EACCES'
      && offline.networkIsolation?.guardedChildProcess?.tcp === 'EACCES',
    focusedTests: offline.focusedVerification?.passed === offline.focusedVerification?.tests
      && offline.focusedVerification?.failed === 0 && offline.focusedVerification?.skipped === 0,
    fullCleanHostRebuild: false,
    completeToolchainClosure: false,
  };
  return {
    K02: {
      status: 'BLOCKED-NATIVE-MARKET-UNEXECUTED',
      localBundleBytesVerified: packageNativeFlags.every(row => row.nativeMarketplaceAcceptance === false),
      nativeRegistration: false, nativeOssUpload: false, systemMerge: false,
      runtimeReload: false, actualBusinessReadback: false, actualPermissionReadback: false,
      blockers: ['native OSS/system/source/merge registration was not executed',
        'runtime resource reload and served-byte readback were not executed',
        'local file-store package is not a native marketplace request'],
    },
    K03: {
      status: 'BLOCKED-NATIVE-UPDATE-ROLLBACK-UNEXECUTED',
      localFailureRecoveryEvidence: localReplay.localInstallUpdateRollbackObserved,
      nativeUpdate: false, nativeFailureRecovery: false, nativeRollback: false,
      runtimeReload: false, dataPermissionRelationshipReadback: false,
      blockers: ['native marketplace revision update was not executed',
        'native runtime reload and failure rollback were not executed',
        'business data, permissions and relationships were not read back after native update'],
    },
    O01: {
      status: 'PARTIAL-OFFLINE-SAME-HOST-ONLY',
      sameHostGuardedEvidence: offlineBuild.networkGuard && offlineBuild.focusedTests,
      fullCleanHostRebuild: offlineBuild.fullCleanHostRebuild,
      completeToolchainClosure: offlineBuild.completeToolchainClosure,
      recursiveDependencySourceClosure: false,
      blockers: ['current evidence uses existing cached dependencies and same-host tools',
        'complete 12-component clean-host rebuild was not executed',
        'recursive dependency and compiler/toolchain source closure is not proven'],
    },
  };
}

export function prepareMarketplaceCloseoutPlan({
  workspace = workspaceDefault, output, catalogId = 'EXTENSION.ibizmodeling.modelperspectivetool',
} = {}) {
  workspace = path.resolve(workspace);
  output = path.resolve(workspace, output);
  assert.equal(path.dirname(output), path.join(workspace, '.artifacts'));
  assert.match(path.basename(output), /^marketplace-closeout-plan-[a-z0-9][a-z0-9-]{0,69}$/);
  assert.equal(fs.existsSync(output), false, 'A new closeout plan directory is required');
  const sourceRecord = privateFile(workspace, recordPath);
  const offlineRecord = privateFile(workspace, offlineRecordPath);
  const generatorPath = path.relative(workspace, fileURLToPath(import.meta.url));
  const generatorSha256 = hash(fs.readFileSync(fileURLToPath(import.meta.url)));
  const record = sourceRecord.json();
  const offline = offlineRecord.json();
  assert.equal(record.status, 'real-official-source-package-built-and-file-replayed-native-market-not-installed');
  assert.equal(record.officialCatalog.catalogId, catalogId);
  const reports = record.localDeliveries.map(delivery => {
    const report = privateFile(workspace, delivery.receipt.path, { strictPrivate: true });
    assert.equal(report.sha256, delivery.receipt.sha256);
    const value = report.json();
    assert.equal(value.catalogId, catalogId);
    assert.equal(value.manifestSha256, delivery.manifestSha256);
    return { path: delivery.receipt.path, reportSha256: report.sha256, ...value };
  });
  const replayFile = privateFile(workspace, record.verification.replayReceipt.path, { strictPrivate: true });
  assert.equal(replayFile.sha256, record.verification.replayReceipt.sha256);
  const replay = replayFile.json();
  const sourceBindings = record.sourceInputs.map(input => ({
    ...input, current: sourceBinding(workspace, input.path),
    unchanged: sourceBinding(workspace, input.path).sha256 === input.sha256,
  }));
  const offlineBinding = { path: record.verification.replayReceipt.path,
    sha256: replayFile.sha256, bytes: replayFile.bytes.length };
  const gates = classifyMarketplaceCloseoutGates({
    packageReports: reports, replay, offline, sourceBindings,
  });
  const plan = {
    contract: 'marketplace-native-closeout-plan-v1',
    generatedAt: new Date().toISOString(),
    status: 'READONLY-PLAN-NATIVE-K02-K03-BLOCKED-O01-PARTIAL',
    generator: { path: generatorPath, sha256: generatorSha256 },
    catalog: { id: catalogId, sourceRevision: record.officialCatalog.revision,
      sourceTree: record.officialCatalog.tree, sourcePath: record.officialCatalog.sourcePath },
    historicalReceipts: {
      sourceRecord: { path: recordPath, sha256: sourceRecord.sha256 },
      offlineRecord: { path: offlineRecordPath, sha256: offlineRecord.sha256 },
      packageReports: reports.map(row => ({ path: row.path, sha256: row.reportSha256,
        version: row.version, manifestSha256: row.manifestSha256 })),
      replay: { path: record.verification.replayReceipt.path,
        sha256: replayFile.sha256, status: replay.status },
    },
    sourceBindings,
    offlineBinding,
    reusableRunners: [
      { path: 'scripts/owned-marketplace-offline.mjs',
        scope: 'owned private file-store install/update/rollback/recovery only',
        nativeMarketplace: false },
      { path: 'scripts/package-owned-marketplace-offline.mjs',
        scope: 'source package/model ZIP/native parser build only',
        nativeMarketplace: false },
      { path: 'scripts/prepare-owned-marketplace-offline.mjs',
        scope: 'source/input identity plan only', nativeMarketplace: false },
      { path: 'scripts/tools/offline-network-guard.c',
        scope: 'kernel network denial wrapper; not a clean-host rebuild', nativeMarketplace: false },
    ],
    gates,
    nativeRequiredInputs: {
      K02: ['official OSS/source registration receipt', 'system/source/merge relationship IDs',
        'native resource merge/reload receipt', 'served bytes and business/permission readback',
        'exact runtime/container/mount witness'],
      K03: ['retained native previous revision', 'native next revision',
        'transaction journal and failure injection', 'runtime reload/readback',
        'business data/permission/relationship preservation and exact rollback receipt'],
      O01: ['clean isolated host or explicitly bounded reconstruction target',
        'all required component source/build inputs', 'recursive dependencies and compiler/toolchain policy',
        'offline build journal and critical service/business readback'],
    },
    forbiddenSubstitutions: [
      'owned offline store manifest is not a native marketplace request',
      'native model ZIP parser success is not OSS/system/source registration',
      'local install/update/rollback is not native runtime reload or business permission preservation',
      'same-host cached dependency replay is not clean-host complete reconstruction',
    ],
    operations: { docker: false, network: false, pull: false, sharedWrites: false,
      databaseWrites: false, nativeMarketplaceRegistration: false },
  };
  fs.mkdirSync(output, { recursive: true, mode: 0o700 });
  const bytes = Buffer.from(json(plan));
  const reportPath = path.join(output, 'plan.private.json');
  fs.writeFileSync(reportPath, bytes, { flag: 'wx', mode: 0o600 });
  const summary = {
    contract: plan.contract, status: plan.status, catalogId, K02: gates.K02.status,
    K03: gates.K03.status, O01: gates.O01.status, report: 'plan.private.json',
    reportSha256: hash(bytes), operations: plan.operations,
  };
  fs.writeFileSync(path.join(output, 'summary.json'), Buffer.from(json(summary)),
    { flag: 'wx', mode: 0o600 });
  return { plan, reportPath, reportSha256: hash(bytes), summary };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { output: { type: 'string' }, 'catalog-id': { type: 'string' } },
    strict: true });
  const result = prepareMarketplaceCloseoutPlan({ output: values.output, catalogId: values['catalog-id'] });
  console.log(`${JSON.stringify(result.summary, null, 2)}\n`);
}
