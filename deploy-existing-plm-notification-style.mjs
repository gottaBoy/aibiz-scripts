#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { guardStartupEnvironmentProgram, reviewGuardStartup } from './deploy-existing-plm-guard-overlay.mjs';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = path.join(workspace, '.artifacts');
const hostDist = path.join(workspace, 'plm-web/dist');
const startupSource = path.join(workspace, 'plm-web/start.sh');
const helperSource = path.join(workspace, 'scripts/deploy-existing-plm-guard-overlay.mjs');
const testSource = path.join(workspace, 'scripts/tests/deploy-existing-plm-notification-style.test.mjs');
const sha = value => createHash('sha256').update(value).digest('hex');
const jsonBytes = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const hashPattern = /^[a-f0-9]{64}$/;
const scopes = ['host', 'container'];
const deploymentLockPath = path.join(artifacts, '.plm-notification-style-recovery.lock');
const fileMetadataFields = ['exists', 'bytes', 'sha256', 'uid', 'gid', 'mode', 'dev', 'ino'];
export const notificationPaths = ['static/css/plm-notification-949d52b67c38b672.css', 'index.html'];
export const notificationSeals = Object.freeze({
  manifest: '40f712d79e3d7b60812b866b12058e16c47c4e3be6e844f757e61781b6fc146a',
  css: '949d52b67c38b672a4678c944fe810b4f5afd83085cf0d1ba4d8a33b715b4178',
  index: 'e3fb42281e0eeb22c128c94fb8c4f65e6e843212705431e75f0c6e15fdb33a19',
  originalIndex: '1d12c09ece14b684dbf9e53f3bdd955fce9982ca1666afced5e23a02a5abc236',
  preparer: '4aabcf551677b8d97170bf70b9749e6daf11cb0d46a0fa1c8084dddbe98b0ebb',
  helper: 'ac06dccdb6e36179e9f6d385184cdbe22f65c5451aa0147e27e9cc8dd3e5e698',
  container: '70327c269425370bed8648bcaa90feadf441ff7a6c5f75b975889cf4c5416612',
  image: 'sha256:027de06a1f8d8d5e44e17b849d44d39a421c6fe0787433b5e229ba00655ca99c',
});

function safeRelative(relative) {
  assert.ok(typeof relative === 'string' && relative && !path.posix.isAbsolute(relative));
  assert.ok(relative.split('/').every(part => part && part !== '.' && part !== '..'));
  assert.ok(!/[\0\\\r\n]/.test(relative));
}

export function notificationPending(relative, epoch, rollback = false) {
  assert.ok(notificationPaths.includes(relative));
  assert.match(epoch, uuid);
  return `${relative}.aibiz-notification-${epoch}${rollback ? '-rollback' : ''}.pending`;
}

function deploymentPath(relative) {
  if (notificationPaths.includes(relative)) return;
  const match = relative.match(/^(.*)\.aibiz-notification-([a-f0-9-]+)(-rollback)?\.pending$/);
  assert.ok(match && notificationPaths.includes(match[1]) && uuid.test(match[2]),
    'Only the two notification targets and their exact epoch stages are eligible');
}

export function validateNotificationFiles(files) {
  assert.deepEqual(files, [
    { path: notificationPaths[0], bytes: 6015, sha256: notificationSeals.css },
    { path: 'index.html', bytes: 2317, sha256: notificationSeals.index },
  ], 'Only the reviewed CSS and index bytes are eligible');
}

function compact(file) {
  if (!file.exists) return { exists: false };
  assert.ok(Buffer.isBuffer(file.bytes));
  for (const field of ['uid', 'gid', 'dev', 'ino']) assert.match(file[field], /^\d+$/);
  assert.match(file.mode, /^[0-7]{3,4}$/);
  return { exists: true, bytes: file.bytes.length, sha256: sha(file.bytes),
    ...Object.fromEntries(['uid', 'gid', 'mode', 'dev', 'ino'].map(field => [field, file[field]])) };
}

export function normalizeNotificationFileMetadata(value, staged = false) {
  if (value.exists === false) return { exists: false };
  assert.equal(value.exists, true);
  assert.ok(Number.isSafeInteger(value.bytes) && value.bytes > 0);
  assert.match(value.sha256 ?? '', hashPattern);
  for (const field of staged ? ['uid', 'gid'] : ['uid', 'gid', 'dev', 'ino']) assert.match(value[field] ?? '', /^\d+$/);
  assert.match(value.mode ?? '', /^[0-7]{3,4}$/);
  return Object.fromEntries(fileMetadataFields.filter(field => !staged || !['dev', 'ino'].includes(field))
    .map(field => [field, value[field]]));
}

function assertFile(actual, expected, message) {
  assert.equal(actual.exists, expected.exists, message);
  if (expected.exists) {
    for (const field of ['sha256', 'bytes', 'uid', 'gid', 'mode', 'dev', 'ino']) {
      if (expected[field] !== undefined) assert.equal(actual[field], expected[field], `${message}: ${field}`);
    }
  }
}

function isOwned(actual, expected) {
  return actual.exists && expected?.exists &&
    ['sha256', 'bytes', 'uid', 'gid', 'mode', 'dev', 'ino'].every(field => actual[field] === expected[field]);
}

function sourceSeal() {
  return { executorSha256: sha(fs.readFileSync(fileURLToPath(import.meta.url))),
    executorTestSha256: sha(fs.readFileSync(testSource)),
    startupHelperSha256: sha(fs.readFileSync(helperSource)) };
}

function validatePlan(plan, sealed, expectedEpoch, expectedPlanSha256) {
  assert.equal(plan.contract, 'existing-plm-notification-style-plan-v1');
  assert.equal(plan.status, 'PREPARED-NOT-APPLIED');
  assert.match(expectedEpoch ?? '', uuid);
  assert.equal(plan.epoch, expectedEpoch);
  assert.match(expectedPlanSha256 ?? '', hashPattern);
  assert.equal(sha(jsonBytes(plan)), expectedPlanSha256, 'The explicitly reviewed plan changed');
  validateNotificationFiles(plan.files);
  assert.deepEqual(plan.files, sealed.files);
  assert.equal(plan.manifestSha256, notificationSeals.manifest);
  assert.equal(sealed.manifestSha256, plan.manifestSha256);
  assert.deepEqual(plan.sourceSeal, sourceSeal(), 'Executor, tests or read-only startup helper changed');
  assert.equal(plan.sourceSeal.startupHelperSha256, notificationSeals.helper);
  assert.deepEqual(plan.concurrency, { sharedLocalLock: deploymentLockPath, trustedExclusiveWriterWindowRequired: true,
    atomicCompareAndSwapClaimed: false, protectionAgainstUncooperativeExternalWritersClaimed: false });
  assert.equal(sha(sealed.originalIndex), notificationSeals.originalIndex);
  for (const file of plan.files) {
    assert.equal(sha(sealed.payload.get(file.path)), file.sha256);
    assert.equal(sealed.payload.get(file.path).length, file.bytes);
  }
}

export async function prepareNotificationDeployment({ sealed, io, journal, lock, epoch = randomUUID() }) {
  lock.assertHeld();
  assert.match(epoch, uuid);
  validateNotificationFiles(sealed.files);
  assert.equal(sealed.manifestSha256, notificationSeals.manifest);
  const source = sourceSeal();
  assert.equal(source.startupHelperSha256, notificationSeals.helper);
  journal.bytes('executor-source.private.mjs', fs.readFileSync(fileURLToPath(import.meta.url)));
  journal.bytes('executor-test-source.private.mjs', fs.readFileSync(testSource));
  journal.bytes('startup-helper-source.private.mjs', fs.readFileSync(helperSource));
  const observation = await io.observe();
  const preserved = await io.preserve(epoch);
  journal.fixed('preserved-inputs.private.json', preserved);
  const originalResponse = await io.http('index.html');
  assert.equal(originalResponse.status, 200);
  assert.equal(sha(originalResponse.bytes), notificationSeals.originalIndex, 'The currently served original index drifted');
  journal.event('original-http-index', { status: originalResponse.status, sha256: sha(originalResponse.bytes) });
  const targets = {};
  for (const scope of scopes) {
    targets[scope] = {};
    for (const file of sealed.files) {
      const current = await io.read(scope, file.path);
      const observed = compact(current);
      if (file.path === 'index.html') {
        assert.equal(observed.sha256, notificationSeals.originalIndex, `${scope} original index drifted`);
        journal.bytes(`backup/${scope}/index.html`, current.bytes);
      } else assert.equal(observed.exists, false, `${scope} CSS must be absent before this epoch`);
      for (const rollback of [false, true]) {
        assert.equal((await io.read(scope, notificationPending(file.path, epoch, rollback))).exists, false);
      }
      targets[scope][file.path] = observed;
    }
  }
  for (const scope of scopes) {
    for (const file of sealed.files) {
      assertFile(compact(await io.read(scope, file.path)), targets[scope][file.path], 'Preparation target drift');
    }
  }
  for (const file of sealed.files) journal.bytes(`payload/${file.path}`, sealed.payload.get(file.path));
  assert.deepEqual(await io.preserve(epoch), preserved, 'Preserved inputs changed during preparation');
  assert.deepEqual(await io.observe(), observation, 'Runtime or source changed during preparation');
  lock.assertHeld();
  const plan = { contract: 'existing-plm-notification-style-plan-v1', status: 'PREPARED-NOT-APPLIED',
    epoch, candidate: sealed.directory, manifestSha256: sealed.manifestSha256, sourceSeal: source,
    observation, preserved, targets, files: sealed.files,
    switchOrder: ['host-new-css', 'container-new-css', 'host-index-last', 'container-index-last'],
    newCssMetadata: { mode: '644', uidGid: 'same-as-original-index-in-each-scope' },
    concurrency: { sharedLocalLock: deploymentLockPath, trustedExclusiveWriterWindowRequired: true,
      atomicCompareAndSwapClaimed: false, protectionAgainstUncooperativeExternalWritersClaimed: false },
    recovery: { originalIndexSha256: notificationSeals.originalIndex,
      index: 'Restore only the unchanged exact inode/dev/hash/owner/mode published by this epoch',
      css: 'Remove only after both original indexes are verified, and only the unchanged exact epoch inode',
      unknown: 'Retain unknown or drifted files; never adopt or recursively delete them' },
    forbidden: ['container-create', 'restart', 'image-pull', 'nginx-reload', 'other-static-overwrite',
      'plugin-overwrite', 'model-overwrite', 'environment-overwrite', 'import-map-overwrite'],
    functionalAcceptance: false, preparedAt: new Date().toISOString() };
  journal.fixed('prepared.private.json', plan);
  return plan;
}

function operations({ plan, sealed, io, journal, report, ledger, lock }) {
  const read = async (scope, relative) => compact(await io.read(scope, relative));
  const key = (scope, relative) => `${scope}:${relative}`;
  const guard = async () => {
    lock.assertHeld();
    assert.deepEqual(sourceSeal(), plan.sourceSeal, 'Deployment source changed during the epoch');
    assert.deepEqual(await io.observe(), plan.observation, 'Runtime, startup, source or parent directory drift');
  };
  const uncertainRead = async (scope, relative) => {
    try { return await read(scope, relative); }
    catch (error) { return { exists: null, readbackError: error.message }; }
  };
  const install = async (scope, relative, bytes, before, rollback = false, recovering = false) => {
    const pending = notificationPending(relative, plan.epoch, rollback);
    const original = plan.targets[scope]['index.html'];
    const desired = { exists: true, bytes: bytes.length, sha256: sha(bytes),
      uid: original.uid, gid: original.gid, mode: relative === 'index.html' ? original.mode : '644' };
    await guard();
    assertFile(await read(scope, relative), before, 'Target drift before stage');
    assert.equal((await read(scope, pending)).exists, false, 'Epoch stage already exists');
    journal.event('before-stage', { scope, relative, pending, before, desired, rollback });
    try { await io.stage(scope, pending, bytes, desired); }
    catch (error) {
      journal.event('uncertain-stage-readback', { scope, pending, actual: await uncertainRead(scope, pending),
        error: error.message, unverifiedStageWillBeRetained: true });
      report.transportErrors.push({ scope, relative: pending, error: error.message, stageOwnershipUnverified: true });
      throw error;
    }
    const staged = await read(scope, pending);
    assertFile(staged, desired, 'Exclusive stage bytes or owner differ');
    ledger.set(key(scope, pending), staged);
    journal.event('verified-stage', { scope, pending, staged, rollback });
    await guard();
    assertFile(await read(scope, relative), before, 'Target drift before publish');
    journal.event('before-publish', { scope, relative, pending, before, staged, rollback });
    try { await io.publish(scope, pending, relative, before, staged); }
    catch (error) {
      const actual = await uncertainRead(scope, relative);
      const pendingActual = await uncertainRead(scope, pending);
      const committed = isOwned(actual, staged) && pendingActual.exists === false;
      journal.event('uncertain-publish-readback', { scope, relative, actual, pendingActual,
        committed, error: error.message });
      report.transportErrors.push({ scope, relative, error: error.message, committedReadback: committed });
      if (!recovering || !committed) throw error;
    }
    const actual = await read(scope, relative);
    assertFile(actual, staged, 'Published inode or bytes differ from the verified stage');
    assert.equal((await read(scope, pending)).exists, false);
    ledger.set(key(scope, relative), actual);
    journal.event('published-file', { scope, relative, actual, rollback });
    return actual;
  };
  const remove = async (scope, relative, expected) => {
    await guard();
    assertFile(await read(scope, relative), expected, 'Removal target drift');
    journal.event('before-owned-remove', { scope, relative, expected });
    try { await io.remove(scope, relative, expected); }
    catch (error) {
      const actual = await uncertainRead(scope, relative);
      journal.event('uncertain-remove-readback', { scope, relative, actual, error: error.message });
      report.transportErrors.push({ scope, relative, error: error.message, absentReadback: actual.exists === false });
      if (actual.exists !== false) throw error;
    }
    assert.equal((await read(scope, relative)).exists, false);
  };
  return { read, guard, install, remove, key };
}

async function recoverApplication({ plan, sealed, io, journal, report, ledger, ops }) {
  const restored = {};
  for (const scope of [...scopes].reverse()) {
    try {
      await ops.guard();
      const current = await ops.read(scope, 'index.html');
      const original = plan.targets[scope]['index.html'];
      if (isOwned(current, original)) restored[scope] = current;
      else if (isOwned(current, ledger.get(ops.key(scope, notificationPending('index.html', plan.epoch))))) {
        restored[scope] = await ops.install(scope, 'index.html', sealed.originalIndex, current, true, true);
      } else throw new Error('Unknown or drifted index retained');
      report.recovery.push({ scope, path: 'index.html', status: 'VERIFIED-ORIGINAL', ...restored[scope] });
    } catch (error) {
      report.recovery.push({ scope, path: 'index.html', status: 'RETAINED-OR-BLOCKED', error: error.message });
    }
  }
  const verifyIndexes = async () => {
    for (const scope of scopes) {
      assert.ok(restored[scope], 'Both original indexes must be verified before removing any CSS');
      assertFile(await ops.read(scope, 'index.html'), restored[scope], 'Restored index drift');
    }
  };
  for (const scope of scopes) {
    try {
      await ops.guard();
      const relative = notificationPaths[0];
      const current = await ops.read(scope, relative);
      if (current.exists) {
        await verifyIndexes();
        assert.ok(isOwned(current, ledger.get(ops.key(scope, notificationPending(relative, plan.epoch)))),
          'Unknown or drifted CSS retained');
        await ops.remove(scope, relative, current);
      }
      report.recovery.push({ scope, path: relative, status: 'ABSENT-OR-REMOVED-VERIFIED-EPOCH-CSS' });
    } catch (error) {
      report.recovery.push({ scope, path: notificationPaths[0], status: 'RETAINED-OR-BLOCKED', error: error.message });
    }
  }
  for (const scope of scopes) {
    for (const relative of notificationPaths) {
      for (const rollback of [false, true]) {
        const pending = notificationPending(relative, plan.epoch, rollback);
        try {
          await ops.guard();
          const current = await ops.read(scope, pending);
          if (!current.exists) continue;
          assert.ok(isOwned(current, ledger.get(ops.key(scope, pending))), 'Unverified stage retained');
          await ops.remove(scope, pending, current);
        } catch (error) {
          report.recovery.push({ scope, path: pending, status: 'RETAINED-OR-BLOCKED', error: error.message });
        }
      }
    }
  }
  report.recoveryStatus = report.recovery.some(item => item.status === 'RETAINED-OR-BLOCKED')
    ? 'INCOMPLETE-RETAINED-FOR-REVIEW' : 'ORIGINAL-INDEXES-RESTORED-OWNED-CSS-REMOVED';
  if (report.recoveryStatus === 'ORIGINAL-INDEXES-RESTORED-OWNED-CSS-REMOVED') {
    try {
      await verifyIndexes();
      assert.deepEqual(await io.preserve(plan.epoch), plan.preserved);
      const response = await io.http('index.html');
      assert.equal(response.status, 200);
      assert.equal(sha(response.bytes), notificationSeals.originalIndex);
      journal.event('recovered-http-index', { status: response.status, sha256: sha(response.bytes) });
    } catch (error) {
      report.recoveryStatus = 'INCOMPLETE-RETAINED-FOR-REVIEW';
      report.recovery.push({ status: 'RETAINED-OR-BLOCKED', error: error.message });
    }
  }
}

export async function applyNotificationDeployment({
  plan, sealed, io, journal, lock, expectedEpoch, expectedPlanSha256, trustedExclusiveWriterWindow,
}) {
  const report = { contract: 'existing-plm-notification-style-apply-v1', epoch: plan?.epoch,
    status: 'VALIDATING-NOT-YET-WRITING', mutations: [], transportErrors: [], recovery: [],
    planSha256: expectedPlanSha256, sourceSeal: plan?.sourceSeal, manifestSha256: plan?.manifestSha256,
    functionalAcceptance: false, trustedExclusiveWriterWindow: trustedExclusiveWriterWindow === true,
    atomicCompareAndSwapClaimed: false, startedAt: new Date().toISOString() };
  const ledger = new Map();
  const ops = operations({ plan, sealed, io, journal, report, ledger, lock });
  let intent = false;
  try {
    validatePlan(plan, sealed, expectedEpoch, expectedPlanSha256);
    assert.equal(trustedExclusiveWriterWindow, true, 'Explicit trusted exclusive writer window acknowledgement is required');
    await ops.guard();
    assert.deepEqual(await io.preserve(plan.epoch), plan.preserved, 'Preserved input graph drift');
    for (const scope of scopes) {
      for (const relative of notificationPaths) {
        assertFile(await ops.read(scope, relative), plan.targets[scope][relative], 'Pre-apply target drift');
        for (const rollback of [false, true]) {
          assert.equal((await ops.read(scope, notificationPending(relative, plan.epoch, rollback))).exists, false);
        }
      }
    }
    await ops.guard();
    journal.fixed('apply-intent.private.json', { ...report, plan, explicitEpoch: expectedEpoch, lock: lock.witness });
    intent = true;
    report.status = 'APPLYING-EXACT-NOTIFICATION-FILES';
    for (const relative of notificationPaths) {
      for (const scope of scopes) {
        const actual = await ops.install(scope, relative, sealed.payload.get(relative), plan.targets[scope][relative]);
        report.mutations.push({ scope, path: relative, ...actual });
      }
    }
    for (const item of report.mutations) {
      assertFile(await ops.read(item.scope, item.path), item, 'Final exact file readback');
    }
    for (const file of plan.files) {
      const response = await io.http(file.path);
      assert.equal(response.status, 200, `Actual HTTP file failed: ${file.path}`);
      assert.equal(sha(response.bytes), file.sha256, `Actual HTTP bytes differ: ${file.path}`);
      journal.event('http-readback', { path: file.path, status: response.status, sha256: sha(response.bytes) });
    }
    assert.deepEqual(await io.preserve(plan.epoch), plan.preserved, 'Preserved inputs changed during application');
    await ops.guard();
    report.status = 'APPLIED-STATIC-ONLY-BUSINESS-ACCEPTANCE-PENDING';
    return report;
  } catch (error) {
    report.status = intent ? 'FAILED-APPLY-CONDITIONAL-RECOVERY' : 'REFUSED-BEFORE-MUTATION';
    report.error = error.message;
    if (intent) await recoverApplication({ plan, sealed, io, journal, report, ledger, ops });
    throw Object.assign(error, { evidence: report });
  } finally {
    report.finishedAt = new Date().toISOString();
    journal.fixed('report.private.json', report);
  }
}

export async function rollbackNotificationDeployment({
  plan, appliedReport, expectedApplyReceiptSha256, sealed, io, journal, lock, expectedEpoch, expectedPlanSha256,
  trustedExclusiveWriterWindow,
}) {
  const report = { contract: 'existing-plm-notification-style-rollback-v1', epoch: plan?.epoch,
    status: 'VALIDATING-NOT-YET-WRITING', planSha256: expectedPlanSha256,
    applyReceiptSha256: expectedApplyReceiptSha256, restoredIndexes: [], removedCss: [],
    retained: [], transportErrors: [], functionalAcceptance: false,
    trustedExclusiveWriterWindow: trustedExclusiveWriterWindow === true,
    atomicCompareAndSwapClaimed: false, startedAt: new Date().toISOString() };
  const ledger = new Map();
  const ops = operations({ plan, sealed, io, journal, report, ledger, lock });
  let intent = false;
  try {
    validatePlan(plan, sealed, expectedEpoch, expectedPlanSha256);
    assert.equal(trustedExclusiveWriterWindow, true, 'Explicit trusted exclusive writer window acknowledgement is required');
    assert.match(expectedApplyReceiptSha256 ?? '', hashPattern);
    assert.equal(sha(jsonBytes(appliedReport)), expectedApplyReceiptSha256, 'The explicit apply receipt changed');
    assert.equal(appliedReport.contract, 'existing-plm-notification-style-apply-v1');
    assert.equal(appliedReport.status, 'APPLIED-STATIC-ONLY-BUSINESS-ACCEPTANCE-PENDING');
    assert.equal(appliedReport.epoch, expectedEpoch);
    assert.equal(appliedReport.planSha256, expectedPlanSha256);
    assert.equal(appliedReport.manifestSha256, notificationSeals.manifest);
    assert.deepEqual(appliedReport.sourceSeal, plan.sourceSeal);
    assert.equal(appliedReport.mutations.length, 4);
    const published = new Map(appliedReport.mutations.map(item => [ops.key(item.scope, item.path), item]));
    assert.equal(published.size, 4);
    await ops.guard();
    assert.deepEqual(await io.preserve(plan.epoch), plan.preserved);
    for (const scope of scopes) {
      for (const file of plan.files) {
        const item = published.get(ops.key(scope, file.path));
        assert.ok(item?.exists);
        assert.equal(item.sha256, file.sha256);
        assert.equal(item.bytes, file.bytes);
        for (const field of ['uid', 'gid', 'dev', 'ino']) assert.match(item[field] ?? '', /^\d+$/);
        assert.match(item.mode ?? '', /^[0-7]{3,4}$/);
        const original = plan.targets[scope]['index.html'];
        assert.equal(item.uid, original.uid);
        assert.equal(item.gid, original.gid);
        assert.equal(item.mode, file.path === 'index.html' ? original.mode : '644');
        assertFile(await ops.read(scope, file.path), item, 'Published object drift prevents rollback');
        for (const rollback of [false, true]) {
          assert.equal((await ops.read(scope, notificationPending(file.path, plan.epoch, rollback))).exists, false);
        }
      }
    }
    await ops.guard();
    journal.fixed('rollback-intent.private.json', { ...report, plan, published: appliedReport.mutations, lock: lock.witness,
      order: ['container-index', 'host-index', 'verify-both-original-indexes', 'remove-owned-css'] });
    intent = true;
    for (const scope of [...scopes].reverse()) {
      const actual = await ops.install(scope, 'index.html', sealed.originalIndex,
        published.get(ops.key(scope, 'index.html')), true, true);
      report.restoredIndexes.push({ scope, path: 'index.html', ...actual });
    }
    const verifyIndexes = async () => {
      for (const scope of scopes) {
        const item = report.restoredIndexes.find(item => item.scope === scope);
        assert.ok(item);
        assertFile(await ops.read(scope, 'index.html'), item, 'Original index drift; retain CSS');
      }
    };
    await verifyIndexes();
    for (const scope of scopes) {
      await verifyIndexes();
      await ops.remove(scope, notificationPaths[0], published.get(ops.key(scope, notificationPaths[0])));
      report.removedCss.push({ scope, path: notificationPaths[0] });
    }
    await verifyIndexes();
    assert.deepEqual(await io.preserve(plan.epoch), plan.preserved);
    const response = await io.http('index.html');
    assert.equal(response.status, 200);
    assert.equal(sha(response.bytes), notificationSeals.originalIndex);
    journal.event('restored-http-index', { status: response.status, sha256: sha(response.bytes) });
    await ops.guard();
    report.status = 'ROLLED-BACK-EXACT-INDEXES-REMOVED-VERIFIED-EPOCH-CSS';
    return report;
  } catch (error) {
    report.status = intent ? 'ROLLBACK-FAILED-RETAINED-FOR-REVIEW' : 'REFUSED-ROLLBACK-BEFORE-MUTATION';
    report.error = error.message;
    if (intent) {
      for (const scope of scopes) {
        if (!report.removedCss.some(item => item.scope === scope)) report.retained.push({ scope, path: notificationPaths[0] });
        const pending = notificationPending('index.html', plan.epoch, true);
        try {
          const actual = await ops.read(scope, pending);
          if (isOwned(actual, ledger.get(ops.key(scope, pending)))) await ops.remove(scope, pending, actual);
          else if (actual.exists) report.retained.push({ scope, path: pending, reason: 'Unverified stage' });
        } catch (cleanupError) { report.retained.push({ scope, path: pending, error: cleanupError.message }); }
      }
    }
    throw Object.assign(error, { evidence: report });
  } finally {
    report.finishedAt = new Date().toISOString();
    journal.fixed('report.private.json', report);
  }
}

function syncDirectory(directory) {
  const fd = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

export function acquireNotificationDeploymentLock(filename = deploymentLockPath) {
  assert.equal(fs.realpathSync(path.dirname(filename)), path.dirname(filename));
  const token = jsonBytes({ contract: 'notification-deployment-local-writer-lock-v1', pid: process.pid, nonce: randomUUID() });
  const fd = fs.openSync(filename, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  let closed = false;
  try { fs.writeFileSync(fd, token); fs.fsyncSync(fd); syncDirectory(path.dirname(filename)); }
  catch (error) { fs.closeSync(fd); throw error; }
  const stat = fs.fstatSync(fd, { bigint: true });
  const witness = { path: filename, dev: String(stat.dev), ino: String(stat.ino), sha256: sha(token), pid: process.pid };
  const assertHeld = () => {
    assert.equal(closed, false);
    const named = fs.lstatSync(filename, { bigint: true });
    assert.ok(named.isFile() && !named.isSymbolicLink());
    assert.equal(String(named.dev), witness.dev);
    assert.equal(String(named.ino), witness.ino);
    assert.equal(named.uid, BigInt(process.geteuid()));
    assert.equal(named.mode & 0o7777n, 0o600n);
    assert.equal(sha(privateBytes(filename)), witness.sha256);
  };
  return { witness, assertHeld, release() {
    try { assertHeld(); fs.unlinkSync(filename); syncDirectory(path.dirname(filename)); }
    finally { closed = true; fs.closeSync(fd); }
  } };
}

function privateBytes(filename) {
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    assert.ok(stat.isFile() && stat.uid === process.geteuid() && (stat.mode & 0o077) === 0);
    return fs.readFileSync(fd);
  } finally { fs.closeSync(fd); }
}

function durableJournal(output) {
  assert.equal(fs.realpathSync(path.dirname(output)), artifacts);
  assert.match(path.basename(output), /^plm-notification-(?:deploy|apply|rollback)-[a-z0-9-]+$/);
  fs.mkdirSync(output, { mode: 0o700 });
  syncDirectory(artifacts);
  let sequence = 0;
  const bytes = (relative, content) => {
    safeRelative(relative);
    const filename = path.join(output, relative);
    fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
    const fd = fs.openSync(filename, 'wx', 0o600);
    try { fs.writeFileSync(fd, content); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    for (let directory = path.dirname(filename); directory.startsWith(output); directory = path.dirname(directory)) {
      syncDirectory(directory);
      if (directory === output) break;
    }
  };
  return { bytes, fixed: (relative, value) => bytes(relative, jsonBytes(value)), event(stage, data) {
    bytes(`event-${String(++sequence).padStart(4, '0')}-${stage}.private.json`,
      jsonBytes({ stage, ...data, recordedAt: new Date().toISOString() }));
  } };
}

export function loadSealedNotificationCandidate(directory) {
  const root = fs.realpathSync(directory);
  assert.equal(path.dirname(root), artifacts);
  const manifestBytes = privateBytes(path.join(root, 'notification-style.private.json'));
  assert.equal(sha(manifestBytes), notificationSeals.manifest);
  const manifest = JSON.parse(manifestBytes);
  assert.equal(manifest.status, 'PREPARED-NOT-DEPLOYED');
  assert.equal(manifest.preparerSha256, notificationSeals.preparer);
  assert.equal(sha(privateBytes(path.join(root, 'executed-preparer.private.mjs'))), notificationSeals.preparer);
  const inputs = [...manifest.sources, ...manifest.mixinDependencies,
    ...manifest.tools.map(item => ({ ...item, snapshotPrefix: 'tool-inputs' })),
    { path: 'scripts/prepare-plm-notification-style.mjs', sha256: notificationSeals.preparer, noSnapshot: true }];
  for (const item of inputs) {
    safeRelative(item.path);
    assert.equal(sha(fs.readFileSync(path.join(workspace, item.path))), item.sha256, `Source dependency drift: ${item.path}`);
    if (!item.noSnapshot) {
      assert.equal(sha(privateBytes(path.join(root, item.snapshotPrefix ?? 'sources', item.path))), item.sha256);
    }
  }
  const files = manifest.files.map(item => ({ ...item, path: item.path.replace(/^overlay\//, '') }));
  validateNotificationFiles(files);
  const payload = new Map();
  for (const file of files) {
    const bytes = privateBytes(path.join(root, 'overlay', file.path));
    assert.equal(sha(bytes), file.sha256);
    assert.equal(bytes.length, file.bytes);
    payload.set(file.path, bytes);
  }
  const originalIndex = privateBytes(path.join(root, 'rollback/index.html'));
  assert.equal(sha(originalIndex), notificationSeals.originalIndex);
  assert.equal(manifest.after.id, notificationSeals.container);
  assert.equal(manifest.after.image, notificationSeals.image);
  assert.deepEqual(manifest.before, manifest.after);
  return { directory: root, files, payload, originalIndex, manifestSha256: sha(manifestBytes),
    expectedRuntime: manifest.after, inputs };
}

export const notificationContainerPathProgram = `set -efu
set -f
root=$1
relative=$2
test -d "$root" && test ! -L "$root"
current=$root
old_ifs=$IFS
IFS=/
set -- $relative
IFS=$old_ifs
while test "$#" -gt 1; do
  current="$current/$1"
  test -d "$current" && test ! -L "$current"
  shift
done
target="$current/$1"
test ! -L "$target"
`;
const walk = notificationContainerPathProgram;
export const notificationContainerInventoryProgram = `set -efu
test -z "$(find /dist ! -type f ! -type d -print -quit)"
find /dist -type f -exec sh -c 'set -efu
for input do
  result=$(sha256sum "$input")
  printf "%s\\000%s\\000" "\${result%% *}" "$input"
done' notification-inventory {} +
`;

export function parseNotificationContainerInventory(raw, excluded = new Set()) {
  const records = raw.toString().split('\0');
  assert.equal(records.pop(), '', 'A complete NUL-delimited inventory is required');
  assert.equal(records.length % 2, 0);
  const rows = [];
  for (let index = 0; index < records.length; index += 2) {
    assert.match(records[index], hashPattern);
    assert.ok(records[index + 1].startsWith('/dist/'));
    const relative = records[index + 1].slice('/dist/'.length);
    safeRelative(relative);
    if (!excluded.has(relative)) rows.push({ path: relative, sha256: records[index] });
  }
  assert.equal(new Set(rows.map(item => item.path)).size, rows.length);
  return rows.sort((a, b) => a.path.localeCompare(b.path));
}

function shellFileGuard(variable, expected) {
  if (!expected.exists) return `test ! -e "$${variable}" && test ! -L "$${variable}"`;
  for (const field of ['uid', 'gid', 'dev', 'ino', 'bytes']) assert.match(String(expected[field]), /^\d+$/);
  assert.match(expected.mode, /^[0-7]{3,4}$/);
  assert.match(expected.sha256, hashPattern);
  return `test -f "$${variable}" && test ! -L "$${variable}"
test "$(stat -c '%u:%g:%a:%d:%i:%s' "$${variable}")" = '${expected.uid}:${expected.gid}:${expected.mode}:${expected.dev}:${expected.ino}:${expected.bytes}'
test "$(sha256sum "$${variable}" | cut -d ' ' -f 1)" = '${expected.sha256}'`;
}

// The host child keeps path validation, file checks, rename and fsync in one process.
export const notificationHostMutationProgram = `
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const [root, action, relative, pending, beforeJson, stageJson] = process.argv.slice(1);
const before = JSON.parse(beforeJson), staged = JSON.parse(stageJson);
const check = (value, message) => { if (!value) throw new Error(message); };
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const filename = relative => {
  check(relative && !path.isAbsolute(relative) && relative.split('/').every(p => p && p !== '.' && p !== '..'), 'Unsafe path');
  check(fs.realpathSync(root) === root, 'Root symlink');
  let current = root;
  for (const part of relative.split('/').slice(0, -1)) {
    current = path.join(current, part);
    const stat = fs.lstatSync(current);
    check(stat.isDirectory() && !stat.isSymbolicLink(), 'Parent symlink');
  }
  return path.join(root, relative);
};
const syncDir = name => {
  const fd = fs.openSync(path.dirname(name), fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
};
const verify = (name, expected) => {
  if (!expected.exists) {
    try { fs.lstatSync(name); throw new Error('Expected absence'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    return;
  }
  const fd = fs.openSync(name, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd, { bigint: true });
    const actual = { uid: String(stat.uid), gid: String(stat.gid), mode: (stat.mode & 0o7777n).toString(8),
      dev: String(stat.dev), ino: String(stat.ino), bytes: Number(stat.size), sha256: hash(fs.readFileSync(fd)) };
    check(stat.isFile(), 'Non-file');
    for (const key of ['uid', 'gid', 'mode', 'dev', 'ino', 'bytes', 'sha256']) {
      if (expected[key] !== undefined) check(actual[key] === expected[key], 'File drift: ' + key);
    }
  } finally { fs.closeSync(fd); }
};
const target = filename(relative);
if (action === 'stage') {
  verify(target, { exists: false });
  const fd = fs.openSync(target, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try {
    fs.writeFileSync(fd, fs.readFileSync(0));
    fs.fchownSync(fd, Number(staged.uid), Number(staged.gid));
    fs.fchmodSync(fd, parseInt(staged.mode, 8));
    fs.fsyncSync(fd);
    const owned = fs.fstatSync(fd, { bigint: true }), named = fs.lstatSync(target, { bigint: true });
    check(owned.dev === named.dev && owned.ino === named.ino && !named.isSymbolicLink(), 'Stage path replaced');
  } finally { fs.closeSync(fd); }
  verify(target, staged);
  syncDir(target);
} else if (action === 'publish') {
  const source = filename(pending);
  verify(source, staged);
  verify(target, before);
  if (before.exists) fs.renameSync(source, target);
  else { fs.linkSync(source, target); fs.unlinkSync(source); }
  verify(target, staged);
  const fd = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  syncDir(target);
} else if (action === 'remove') {
  verify(target, before);
  fs.unlinkSync(target);
  syncDir(target);
} else throw new Error('Unknown action');
`;

function hostRead(relative) {
  deploymentPath(relative);
  assert.equal(fs.realpathSync(hostDist), hostDist);
  let current = hostDist;
  for (const component of relative.split('/').slice(0, -1)) {
    current = path.join(current, component);
    const stat = fs.lstatSync(current);
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink());
  }
  let fd;
  try {
    fd = fs.openSync(path.join(hostDist, relative), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const stat = fs.fstatSync(fd, { bigint: true });
    assert.ok(stat.isFile());
    return { exists: true, bytes: fs.readFileSync(fd), uid: String(stat.uid), gid: String(stat.gid),
      mode: (stat.mode & 0o7777n).toString(8), dev: String(stat.dev), ino: String(stat.ino) };
  } catch (error) { if (error.code === 'ENOENT') return { exists: false }; throw error; }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}

function hostInventory(root, excluded = new Set()) {
  assert.equal(fs.realpathSync(root), root);
  const rows = [];
  const visit = directory => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const filename = path.join(directory, entry.name);
      const relative = path.relative(root, filename).split(path.sep).join('/');
      safeRelative(relative);
      assert.ok(!entry.isSymbolicLink(), `A preserved input is a symlink: ${relative}`);
      if (entry.isDirectory()) visit(filename);
      else {
        assert.ok(entry.isFile());
        if (!excluded.has(relative)) rows.push({ path: relative, sha256: sha(fs.readFileSync(filename)) });
      }
    }
  };
  visit(root);
  rows.sort((a, b) => a.path.localeCompare(b.path));
  return { files: rows.length, sha256: sha(jsonBytes(rows)), inventory: rows };
}

export function createNotificationActualIo(sealed, execute = (program, args, options = {}) => spawnSync(program, args, {
  timeout: 30_000, maxBuffer: 16 * 1024 * 1024, ...options,
})) {
  const id = sealed.expectedRuntime.id;
  assert.equal(id, notificationSeals.container);
  const run = (program, args, input) => {
    const result = execute(program, args, { input });
    assert.equal(result.status, 0, `${program} command failed: ${String(result.stderr ?? '').slice(0, 400)}`);
    return Buffer.from(result.stdout ?? '');
  };
  const docker = (args, input) => run('docker', args, input);
  const shell = (script, relative, input, user = '0') => {
    deploymentPath(relative);
    assert.match(user, /^\d+(?::\d+)?$/);
    return docker(['exec', '-i', '--user', user, id, 'sh', '-c', script,
      'aibiz-notification', '/dist', relative], input);
  };
  const read = async (scope, relative) => {
    deploymentPath(relative);
    if (scope === 'host') return hostRead(relative);
    assert.equal(scope, 'container');
    const bytes = shell(`${walk}
if test ! -e "$target"; then printf 'ABSENT\\n'; exit 0; fi
test -f "$target"
printf 'FILE '
stat -c '%u %g %a %d %i %s' "$target"
cat "$target"
`, relative);
    const newline = bytes.indexOf(10);
    const header = bytes.subarray(0, newline).toString();
    if (header === 'ABSENT') return { exists: false };
    const match = header.match(/^FILE (\d+) (\d+) ([0-7]+) (\d+) (\d+) (\d+)$/);
    assert.ok(match);
    const content = bytes.subarray(newline + 1);
    assert.equal(content.length, Number(match[6]));
    return { exists: true, uid: match[1], gid: match[2], mode: match[3], dev: match[4], ino: match[5], bytes: content };
  };
  const observe = async () => {
    for (const item of sealed.inputs) {
      assert.equal(sha(fs.readFileSync(path.join(workspace, item.path))), item.sha256, `Source dependency drift: ${item.path}`);
    }
    const [container] = JSON.parse(docker(['inspect', id]));
    const expected = sealed.expectedRuntime;
    assert.equal(container.Id, id);
    assert.equal(container.Name, '/plmweb');
    assert.equal(container.Image, notificationSeals.image);
    assert.equal(container.State.Status, 'running');
    assert.equal(container.State.StartedAt, expected.startedAt);
    assert.equal(container.RestartCount, expected.restartCount);
    assert.equal(container.Config.Labels?.['com.docker.compose.project'], 'compose');
    assert.equal(container.Config.Labels?.['com.docker.compose.service'], 'plmweb');
    assert.deepEqual(container.Config.Entrypoint, ['/start.sh']);
    assert.deepEqual(container.Config.Cmd, []);
    const configurationSha256 = sha(Buffer.from(JSON.stringify({ config: container.Config, host: container.HostConfig })));
    assert.equal(configurationSha256, expected.configSha256);
    const mounts = [...container.Mounts].sort((a, b) => a.Destination.localeCompare(b.Destination));
    assert.deepEqual(mounts, expected.mounts);
    assert.ok(!mounts.some(item => item.Destination === '/dist' || item.Destination.startsWith('/dist/')));
    for (const [destination, source] of [
      ['/opt/aibiz/local-dist', hostDist], ['/opt/aibiz/local-plugins', path.join(workspace, 'plm-web/public/plugins')],
      ['/app/model', path.join(workspace, 'plm/model')],
    ]) {
      const mount = mounts.find(item => item.Destination === destination);
      assert.ok(mount && mount.Type === 'bind' && mount.Source === source && mount.RW === false);
      assert.equal(fs.realpathSync(source), source);
    }
    const startup = docker(['exec', id, 'cat', '/start.sh']);
    const startupReview = reviewGuardStartup(startup.toString());
    assert.equal(sha(fs.readFileSync(startupSource)), startupReview.sha256);
    const environmentSource = fs.readFileSync(path.join(hostDist, 'environments/environment.js'));
    const program = guardStartupEnvironmentProgram(startup.toString());
    const environmentConfiguration = docker(['exec', id, 'cat', '/environment.config']);
    const rendered = docker(['exec', '-i', '--env', 'LC_ALL=C', id, 'awk', '-F:', program, '/environment.config', '-'], environmentSource);
    const served = docker(['exec', id, 'cat', '/dist/environments/environment.js']);
    assert.equal(sha(rendered), sha(served), 'Environment no longer reproduces from startup inputs');
    const nginx = docker(['exec', id, 'nginx', '-T']);
    assert.match(nginx.toString(), /location\s+\^~\s+\/ibizplm-plmweb\/\s*\{[^}]*alias\s+\/dist\/;/);
    const hostParents = ['', 'static', 'static/css'].map(relative => {
      const filename = path.join(hostDist, relative);
      const stat = fs.lstatSync(filename, { bigint: true });
      assert.ok(stat.isDirectory() && !stat.isSymbolicLink());
      return { path: relative, dev: String(stat.dev), ino: String(stat.ino), uid: String(stat.uid),
        gid: String(stat.gid), mode: (stat.mode & 0o7777n).toString(8) };
    });
    const containerParents = docker(['exec', id, 'sh', '-c',
      'set -efu; for item in /dist /dist/static /dist/static/css; do test -d "$item" && test ! -L "$item"; stat -c "%n %u %g %a %d %i" "$item"; done']).toString();
    return { runtime: { id, image: container.Image, startedAt: expected.startedAt, restartCount: expected.restartCount,
      configurationSha256, mounts }, startup: startupReview, hostParents, containerParents,
    environment: { sourceSha256: sha(environmentSource), configurationSha256: sha(environmentConfiguration),
      programSha256: sha(Buffer.from(program)), renderedSha256: sha(rendered), servedSha256: sha(served) },
    nginxConfigurationSha256: sha(nginx),
    sourceInputsSha256: sha(jsonBytes(sealed.inputs.map(item => ({ path: item.path, sha256: item.sha256 })))) };
  };
  const preserve = async epoch => {
    assert.match(epoch, uuid);
    const excluded = new Set(notificationPaths.flatMap(relative => [relative,
      notificationPending(relative, epoch), notificationPending(relative, epoch, true)]));
    const raw = docker(['exec', '--user', '0', id, 'sh', '-c', notificationContainerInventoryProgram]);
    const rows = parseNotificationContainerInventory(raw, excluded);
    return { hostDist: hostInventory(hostDist, excluded),
      containerDist: { files: rows.length, sha256: sha(jsonBytes(rows)), inventory: rows },
      pluginSource: hostInventory(path.join(workspace, 'plm-web/public/plugins')),
      modelSource: hostInventory(path.join(workspace, 'plm/model')) };
  };
  const hostMutation = (action, relative, pending, before, staged, input) => run(process.execPath,
    ['-e', notificationHostMutationProgram, hostDist, action, relative, pending, JSON.stringify(before), JSON.stringify(staged)], input);
  const stage = async (scope, relative, bytes, metadata) => {
    deploymentPath(relative);
    metadata = normalizeNotificationFileMetadata(metadata, true);
    for (const field of ['uid', 'gid']) assert.match(metadata[field], /^\d+$/);
    assert.match(metadata.mode, /^[0-7]{3,4}$/);
    if (scope === 'host') return hostMutation('stage', relative, '', { exists: false }, metadata, bytes);
    assert.equal(scope, 'container');
    shell(`${walk}
test ! -e "$target" && test ! -L "$target"
umask 077
set -C
exec 3>"$target"
owned="$(stat -Lc '%d:%i' /proc/$$/fd/3)"
dd conv=fsync status=none >&3
chown '${metadata.uid}:${metadata.gid}' /proc/$$/fd/3
chmod '${metadata.mode}' /proc/$$/fd/3
test ! -L "$target" && test "$(stat -c '%d:%i' "$target")" = "$owned"
sync "$target"
exec 3>&-
sync "$current"
`, relative, bytes, `${metadata.uid}:${metadata.gid}`);
  };
  const publish = async (scope, pending, relative, before, staged) => {
    deploymentPath(relative);
    deploymentPath(pending);
    before = normalizeNotificationFileMetadata(before);
    staged = normalizeNotificationFileMetadata(staged);
    if (scope === 'host') return hostMutation('publish', relative, pending, before, staged);
    assert.equal(scope, 'container');
    const publication = before.exists ? 'mv -T -- "$pending" "$target"'
      : 'ln -T -- "$pending" "$target"\nrm -- "$pending"';
    shell(`${walk}
pending="$root/${pending}"
${shellFileGuard('pending', staged)}
${shellFileGuard('target', before)}
${publication}
${shellFileGuard('target', staged)}
sync "$target"
sync "$current"
`, relative);
  };
  const remove = async (scope, relative, expected) => {
    deploymentPath(relative);
    expected = normalizeNotificationFileMetadata(expected);
    if (scope === 'host') return hostMutation('remove', relative, '', expected, {});
    assert.equal(scope, 'container');
    shell(`${walk}
${shellFileGuard('target', expected)}
rm -- "$target"
sync "$current"
`, relative);
  };
  return { observe, preserve, read, stage, publish, remove, async http(relative) {
    assert.ok(notificationPaths.includes(relative));
    const response = await fetch(`http://127.0.0.1:30250/ibizplm-plmweb/${relative}`,
      { signal: AbortSignal.timeout(15_000), cache: 'no-store' });
    return { status: response.status, bytes: Buffer.from(await response.arrayBuffer()) };
  } };
}

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: {
    prepare: { type: 'boolean' }, apply: { type: 'boolean' }, rollback: { type: 'boolean' },
    candidate: { type: 'string' }, output: { type: 'string' }, plan: { type: 'string' },
    epoch: { type: 'string' }, 'plan-sha256': { type: 'string' },
    'apply-receipt': { type: 'string' }, 'apply-receipt-sha256': { type: 'string' },
    'trusted-exclusive-writer-window': { type: 'boolean' },
  } });
  assert.equal([values.prepare, values.apply, values.rollback].filter(Boolean).length, 1,
    'Exactly one explicit --prepare, --apply or --rollback is required');
  assert.ok(values.output && path.isAbsolute(values.output));
  let plan, appliedReport;
  if (values.prepare) {
    assert.equal(values['trusted-exclusive-writer-window'], undefined);
    assert.ok(values.candidate && path.isAbsolute(values.candidate));
    for (const option of ['plan', 'epoch', 'plan-sha256', 'apply-receipt', 'apply-receipt-sha256']) {
      assert.equal(values[option], undefined);
    }
  } else {
    assert.equal(values['trusted-exclusive-writer-window'], true,
      'Explicit --trusted-exclusive-writer-window is required for apply and rollback');
    assert.equal(values.candidate, undefined);
    assert.ok(values.plan && path.isAbsolute(values.plan));
    assert.equal(path.basename(values.plan), 'prepared.private.json');
    assert.equal(fs.realpathSync(path.dirname(path.dirname(values.plan))), artifacts);
    assert.match(values.epoch ?? '', uuid);
    assert.match(values['plan-sha256'] ?? '', hashPattern);
    const bytes = privateBytes(values.plan);
    assert.equal(sha(bytes), values['plan-sha256']);
    plan = JSON.parse(bytes);
    if (values.rollback) {
      assert.ok(values['apply-receipt'] && path.isAbsolute(values['apply-receipt']));
      assert.equal(path.basename(values['apply-receipt']), 'report.private.json');
      assert.equal(fs.realpathSync(path.dirname(path.dirname(values['apply-receipt']))), artifacts);
      assert.match(values['apply-receipt-sha256'] ?? '', hashPattern);
      const receipt = privateBytes(values['apply-receipt']);
      assert.equal(sha(receipt), values['apply-receipt-sha256']);
      appliedReport = JSON.parse(receipt);
    } else {
      assert.equal(values['apply-receipt'], undefined);
      assert.equal(values['apply-receipt-sha256'], undefined);
    }
  }
  const lock = acquireNotificationDeploymentLock();
  try {
    const sealed = loadSealedNotificationCandidate(plan?.candidate ?? values.candidate);
    if (plan) {
      const directory = path.dirname(values.plan);
      for (const file of sealed.files) assert.equal(sha(privateBytes(path.join(directory, 'payload', file.path))), file.sha256);
      for (const scope of scopes) {
        assert.equal(sha(privateBytes(path.join(directory, 'backup', scope, 'index.html'))), notificationSeals.originalIndex);
      }
      for (const [filename, field] of [['executor-source.private.mjs', 'executorSha256'],
        ['executor-test-source.private.mjs', 'executorTestSha256'], ['startup-helper-source.private.mjs', 'startupHelperSha256']]) {
        assert.equal(sha(privateBytes(path.join(directory, filename))), plan.sourceSeal[field]);
      }
      assert.deepEqual(JSON.parse(privateBytes(path.join(directory, 'preserved-inputs.private.json'))), plan.preserved);
    }
    const journal = durableJournal(path.resolve(values.output));
    const io = createNotificationActualIo(sealed);
    const parameters = { plan, sealed, io, journal, lock, expectedEpoch: values.epoch, expectedPlanSha256: values['plan-sha256'],
      trustedExclusiveWriterWindow: values['trusted-exclusive-writer-window'] };
    const result = values.prepare ? await prepareNotificationDeployment(parameters)
      : values.rollback ? await rollbackNotificationDeployment({ ...parameters, appliedReport,
        expectedApplyReceiptSha256: values['apply-receipt-sha256'] }) : await applyNotificationDeployment(parameters);
    console.log(JSON.stringify({ status: result.status, epoch: result.epoch, output: values.output,
      planSha256: plan ? values['plan-sha256'] : sha(fs.readFileSync(path.join(values.output, 'prepared.private.json'))),
      reportSha256: plan ? sha(fs.readFileSync(path.join(values.output, 'report.private.json'))) : undefined,
      functionalAcceptance: false, atomicCompareAndSwapClaimed: false }));
    return result;
  } finally { lock.release(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
