#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  createNotificationActualIo, loadSealedNotificationCandidate, notificationPaths, notificationPending,
  notificationSeals,
} from './deploy-existing-plm-notification-style.mjs';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = path.join(workspace, '.artifacts');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const jsonBytes = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const hashPattern = /^[a-f0-9]{64}$/;
const metadataFields = ['exists', 'bytes', 'sha256', 'uid', 'gid', 'mode', 'dev', 'ino'];
const scopes = ['host', 'container'];
const sourcePaths = {
  executorSha256: 'scripts/deploy-existing-plm-notification-style.mjs',
  executorTestSha256: 'scripts/tests/deploy-existing-plm-notification-style.test.mjs',
  startupHelperSha256: 'scripts/deploy-existing-plm-guard-overlay.mjs',
};
const frozenSourceNames = {
  executorSha256: 'executor-source.private.mjs',
  executorTestSha256: 'executor-test-source.private.mjs',
  startupHelperSha256: 'startup-helper-source.private.mjs',
};
export const recoveryBindings = Object.freeze({
  oldEpoch: '712fac50-bdce-47ad-9989-f2ecd8d65d9c',
  oldPlanSha256: '12f2053a42b7a84ac69320e6a2c60068f013aeda499cd0797c0bbbd7bc8fd33c',
  applyReceiptSha256: 'db065f40df6ab039233804fc5d83eb25e6f8fa43f76527fd4532606f3caeb938',
  failedRollbackSha256: '977ca8cff046ea5444453b5670567c37168a69f53c9c319f2c6992a5a6b0ecf6',
  oldSourceSeal: Object.freeze({
    executorSha256: 'f9938dd14b2fc4f59a8278cc8ba453ebc5de87eee0aa802d4fd170303d570228',
    executorTestSha256: '639a4eef9835afaea7db1832947bc01498addc94573ec59711c999ee8d4d26bb',
    startupHelperSha256: 'ac06dccdb6e36179e9f6d385184cdbe22f65c5451aa0147e27e9cc8dd3e5e698',
  }),
});

export function normalizeNotificationMetadata(value) {
  assert.ok(value && typeof value === 'object');
  assert.equal(value.exists, true, 'A complete existing-file receipt is required');
  assert.ok(Number.isSafeInteger(value.bytes) && value.bytes > 0);
  assert.match(value.sha256 ?? '', hashPattern);
  for (const field of ['uid', 'gid', 'dev', 'ino']) assert.match(value[field] ?? '', /^\d+$/);
  assert.match(value.mode ?? '', /^[0-7]{3,4}$/);
  return Object.fromEntries(metadataFields.map(field => [field, value[field]]));
}

export function normalizedNotificationIo(io) {
  return { ...io,
    stage(scope, relative, bytes, desired) {
      const normalized = normalizeNotificationMetadata({ ...desired, dev: '0', ino: '0' });
      return io.stage(scope, relative, bytes, Object.fromEntries(metadataFields
        .filter(field => field !== 'dev' && field !== 'ino').map(field => [field, normalized[field]])));
    },
    publish(scope, pending, relative, before, staged) {
      return io.publish(scope, pending, relative, normalizeNotificationMetadata(before), normalizeNotificationMetadata(staged));
    },
    remove(scope, relative, expected) {
      return io.remove(scope, relative, normalizeNotificationMetadata(expected));
    },
  };
}

function compact(file) {
  if (!file.exists) return { exists: false };
  assert.ok(Buffer.isBuffer(file.bytes));
  return normalizeNotificationMetadata({ ...file, bytes: file.bytes.length, sha256: sha(file.bytes) });
}

function assertFile(actual, expected, message) {
  assert.deepEqual(actual, normalizeNotificationMetadata(expected), message);
}

function isSame(actual, expected) {
  return actual.exists === true && metadataFields.every(field => actual[field] === expected[field]);
}

function privateBytes(filename) {
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    assert.ok(stat.isFile() && stat.uid === process.geteuid() && (stat.mode & 0o077) === 0);
    return fs.readFileSync(fd);
  } finally { fs.closeSync(fd); }
}

function privateArtifact(filename, basename) {
  assert.ok(path.isAbsolute(filename));
  assert.equal(path.basename(filename), basename);
  assert.equal(fs.realpathSync(path.dirname(path.dirname(filename))), artifacts);
  assert.equal(fs.realpathSync(path.dirname(filename)), path.dirname(filename));
  return privateBytes(filename);
}

export function validateNotificationRecoverySources(sources) {
  assert.deepEqual(Object.keys(sources).sort(), Object.keys(sourcePaths).sort());
  for (const [field, relative] of Object.entries(sourcePaths)) {
    assert.ok(Buffer.isBuffer(sources[field]));
    assert.equal(sha(sources[field]), recoveryBindings.oldSourceSeal[field],
      `The frozen original source changed: ${relative}`);
  }
}

function verifyOldSources(inputs) {
  const directory = path.dirname(inputs.paths.oldPlan);
  const sources = Object.fromEntries(Object.entries(frozenSourceNames)
    .map(([field, filename]) => [field, privateBytes(path.join(directory, filename))]));
  validateNotificationRecoverySources(sources);
  return sources;
}

function recoverySourceSeal() {
  return { recoveryExecutorSha256: sha(fs.readFileSync(fileURLToPath(import.meta.url))),
    recoveryTestSha256: sha(fs.readFileSync(path.join(workspace, 'scripts/tests/recover-existing-plm-notification-style.test.mjs'))) };
}

function validateReceipts(inputs) {
  const { oldPlan, applied, failed } = inputs;
  assert.deepEqual(inputs.bindings, recoveryBindings);
  assert.equal(oldPlan.contract, 'existing-plm-notification-style-plan-v1');
  assert.equal(oldPlan.status, 'PREPARED-NOT-APPLIED');
  assert.equal(oldPlan.epoch, recoveryBindings.oldEpoch);
  assert.deepEqual(oldPlan.sourceSeal, recoveryBindings.oldSourceSeal);
  assert.equal(oldPlan.manifestSha256, notificationSeals.manifest);
  assert.equal(applied.contract, 'existing-plm-notification-style-apply-v1');
  assert.equal(applied.status, 'APPLIED-STATIC-ONLY-BUSINESS-ACCEPTANCE-PENDING');
  assert.equal(applied.epoch, recoveryBindings.oldEpoch);
  assert.equal(applied.planSha256, recoveryBindings.oldPlanSha256);
  assert.equal(applied.manifestSha256, notificationSeals.manifest);
  assert.deepEqual(applied.sourceSeal, recoveryBindings.oldSourceSeal);
  assert.equal(applied.mutations.length, 4);
  const published = new Map(applied.mutations.map(item => [`${item.scope}:${item.path}`, item]));
  assert.equal(published.size, 4);
  for (const scope of scopes) {
    for (const file of oldPlan.files) {
      const item = published.get(`${scope}:${file.path}`);
      normalizeNotificationMetadata(item);
      assert.equal(item.sha256, file.sha256);
      assert.equal(item.bytes, file.bytes);
      const original = oldPlan.targets[scope]['index.html'];
      for (const field of ['uid', 'gid']) assert.equal(item[field], original[field]);
      assert.equal(item.mode, file.path === 'index.html' ? original.mode : '644');
    }
  }
  assert.equal(failed.contract, 'existing-plm-notification-style-rollback-v1');
  assert.equal(failed.status, 'ROLLBACK-FAILED-RETAINED-FOR-REVIEW');
  assert.equal(failed.epoch, recoveryBindings.oldEpoch);
  assert.equal(failed.planSha256, recoveryBindings.oldPlanSha256);
  assert.equal(failed.applyReceiptSha256, recoveryBindings.applyReceiptSha256);
  assert.match(failed.error, /File drift: scope/);
  assert.deepEqual(failed.removedCss, []);
  assert.equal(failed.restoredIndexes.length, 1);
  const restored = failed.restoredIndexes[0];
  assert.equal(restored.scope, 'container');
  assert.equal(restored.path, 'index.html');
  normalizeNotificationMetadata(restored);
  const original = oldPlan.targets.container['index.html'];
  for (const field of ['bytes', 'sha256', 'uid', 'gid', 'mode', 'dev']) assert.equal(restored[field], original[field]);
  assert.equal(restored.sha256, notificationSeals.originalIndex);
  assert.deepEqual(failed.retained, scopes.map(scope => ({ scope, path: notificationPaths[0] })));
  return { host: {
    'index.html': published.get('host:index.html'),
    [notificationPaths[0]]: published.get(`host:${notificationPaths[0]}`),
  }, container: {
    'index.html': restored,
    [notificationPaths[0]]: published.get(`container:${notificationPaths[0]}`),
  } };
}

export function loadNotificationRecoveryInputs({ oldPlan: planPath, applyReceipt: applyPath, failedRollback: failedPath }) {
  const paths = { oldPlan: planPath, applied: applyPath, failed: failedPath };
  const content = {
    oldPlan: privateArtifact(planPath, 'prepared.private.json'),
    applied: privateArtifact(applyPath, 'report.private.json'),
    failed: privateArtifact(failedPath, 'report.private.json'),
  };
  for (const [key, seal] of [['oldPlan', 'oldPlanSha256'], ['applied', 'applyReceiptSha256'], ['failed', 'failedRollbackSha256']]) {
    assert.equal(sha(content[key]), recoveryBindings[seal], `Only the statically bound ${key} receipt is eligible`);
  }
  const inputs = { paths, bindings: recoveryBindings,
    ...Object.fromEntries(Object.entries(content).map(([key, bytes]) => [key, JSON.parse(bytes)])) };
  verifyOldSources(inputs);
  validateReceipts(inputs);
  const sealed = loadSealedNotificationCandidate(inputs.oldPlan.candidate);
  for (const scope of scopes) {
    assert.equal(sha(privateBytes(path.join(path.dirname(planPath), 'backup', scope, 'index.html'))), notificationSeals.originalIndex);
  }
  return { ...inputs, sealed };
}

function reverifyInputFiles(inputs) {
  for (const [key, seal] of [['oldPlan', 'oldPlanSha256'], ['applied', 'applyReceiptSha256'], ['failed', 'failedRollbackSha256']]) {
    assert.equal(sha(privateBytes(inputs.paths[key])), recoveryBindings[seal], `Bound ${key} receipt drifted`);
  }
  verifyOldSources(inputs);
}

function inventorySeal(preserved) {
  return { sha256: sha(jsonBytes(preserved)),
    trees: Object.fromEntries(Object.entries(preserved).map(([name, tree]) => [name, { files: tree.files, sha256: tree.sha256 }])) };
}

function stages(epoch) {
  const old = scopes.flatMap(scope => notificationPaths.flatMap(relative => [false, true].map(rollback => ({
    scope, path: notificationPending(relative, recoveryBindings.oldEpoch, rollback),
  }))));
  return [...old, { scope: 'host', path: notificationPending('index.html', epoch, true) }];
}

async function assertStagesAbsent(io, epoch) {
  for (const item of stages(epoch)) assert.equal((await io.read(item.scope, item.path)).exists, false, `Stage exists: ${item.scope}:${item.path}`);
}

export async function prepareNotificationRecovery({ inputs, io, journal, lock, epoch = randomUUID() }) {
  assert.match(epoch, uuid);
  assert.notEqual(epoch, recoveryBindings.oldEpoch);
  lock.assertHeld();
  reverifyInputFiles(inputs);
  const targets = validateReceipts(inputs);
  const sourceSeal = recoverySourceSeal();
  journal.bytes('recovery-executor-source.private.mjs', fs.readFileSync(fileURLToPath(import.meta.url)));
  journal.bytes('recovery-test-source.private.mjs', fs.readFileSync(path.join(workspace, 'scripts/tests/recover-existing-plm-notification-style.test.mjs')));
  for (const [field, bytes] of Object.entries(verifyOldSources(inputs))) journal.bytes(`frozen-sources/${field}.private.mjs`, bytes);
  for (const [key, filename] of Object.entries(inputs.paths)) journal.bytes(`receipts/${key}.private.json`, privateBytes(filename));
  journal.bytes('original-index.private.html', inputs.sealed.originalIndex);
  const observation = await io.observe();
  assert.deepEqual(observation, inputs.oldPlan.observation, 'The old runtime/startup/source observation changed');
  const preserved = await io.preserve(recoveryBindings.oldEpoch);
  assert.deepEqual(preserved, inputs.oldPlan.preserved, 'Preserved inputs drifted after the partial rollback');
  journal.fixed('preserved-inputs.private.json', preserved);
  for (const scope of scopes) {
    for (const relative of notificationPaths) assertFile(compact(await io.read(scope, relative)), targets[scope][relative], 'Not the exact bound partial rollback state');
  }
  await assertStagesAbsent(io, epoch);
  const response = await io.http('index.html');
  assert.equal(response.status, 200);
  assert.equal(sha(response.bytes), notificationSeals.originalIndex, 'The partially restored container must serve the original index');
  journal.event('original-http-index', { status: response.status, sha256: sha(response.bytes) });
  assert.deepEqual(await io.preserve(recoveryBindings.oldEpoch), preserved);
  assert.deepEqual(await io.observe(), observation);
  for (const scope of scopes) {
    for (const relative of notificationPaths) assertFile(compact(await io.read(scope, relative)), targets[scope][relative], 'Partial state drifted during preparation');
  }
  lock.assertHeld();
  const plan = { contract: 'existing-plm-notification-style-recovery-plan-v1', status: 'PREPARED-NOT-APPLIED',
    epoch, bindings: recoveryBindings, inputPaths: inputs.paths, sourceSeal, observation,
    preserved: inventorySeal(preserved), targets,
    stage: notificationPending('index.html', epoch, true),
    order: ['restore-only-host-index', 'verify-both-original-indexes', 'remove-only-host-css', 'remove-only-container-css'],
    concurrency: { sharedLocalLock: 'only-this-recovery-tool', trustedExclusiveWriterWindowRequired: true,
      atomicCompareAndSwapClaimed: false, protectionAgainstUncooperativeExternalWritersClaimed: false },
    failure: 'Stop, retain unknown or drifted files, and keep the original journal; no retry or recursive deletion',
    lifecycleChanges: false, functionalAcceptance: false, preparedAt: new Date().toISOString() };
  journal.fixed('prepared.private.json', plan);
  return plan;
}

export async function applyNotificationRecovery({
  plan, inputs, io: originalIo, journal, lock, expectedEpoch, expectedPlanSha256, trustedExclusiveWriterWindow,
}) {
  const io = normalizedNotificationIo(originalIo);
  const report = { contract: 'existing-plm-notification-style-recovery-apply-v1', epoch: plan?.epoch,
    status: 'VALIDATING-NOT-YET-WRITING', planSha256: expectedPlanSha256, bindings: recoveryBindings,
    restoredHostIndex: null, removedCss: [], transportErrors: [], retained: [],
    trustedExclusiveWriterWindow: trustedExclusiveWriterWindow === true, atomicCompareAndSwapClaimed: false,
    functionalAcceptance: false, startedAt: new Date().toISOString() };
  let intent = false;
  const read = async (scope, relative) => compact(await io.read(scope, relative));
  const readUncertain = async (scope, relative) => {
    try { return await read(scope, relative); }
    catch (error) { return { exists: null, readbackError: error.message }; }
  };
  const guard = async () => {
    lock.assertHeld();
    reverifyInputFiles(inputs);
    assert.deepEqual(recoverySourceSeal(), plan.sourceSeal, 'Recovery source or tests changed');
    assert.deepEqual(await io.observe(), plan.observation, 'Runtime, source or startup observation drifted');
  };
  try {
    assert.equal(plan.contract, 'existing-plm-notification-style-recovery-plan-v1');
    assert.equal(plan.status, 'PREPARED-NOT-APPLIED');
    assert.match(expectedEpoch ?? '', uuid);
    assert.equal(plan.epoch, expectedEpoch);
    assert.match(expectedPlanSha256 ?? '', hashPattern);
    assert.equal(sha(jsonBytes(plan)), expectedPlanSha256, 'The explicitly reviewed recovery plan changed');
    assert.equal(trustedExclusiveWriterWindow, true, 'The trusted exclusive writer window must be explicitly acknowledged');
    assert.deepEqual(plan.bindings, recoveryBindings);
    assert.deepEqual(plan.inputPaths, inputs.paths);
    const targets = validateReceipts(inputs);
    assert.deepEqual(plan.targets, targets);
    assert.equal(plan.stage, notificationPending('index.html', plan.epoch, true));
    await guard();
    assert.deepEqual(inventorySeal(await io.preserve(recoveryBindings.oldEpoch)), plan.preserved);
    for (const scope of scopes) {
      for (const relative of notificationPaths) assertFile(await read(scope, relative), targets[scope][relative], 'Partial rollback state drifted before recovery');
    }
    await assertStagesAbsent(io, plan.epoch);
    await guard();
    journal.fixed('recovery-intent.private.json', { ...report, plan, lock: lock.witness,
      exactScope: ['host:index.html', `host:${notificationPaths[0]}`, `container:${notificationPaths[0]}`] });
    intent = true;
    const original = inputs.oldPlan.targets.host['index.html'];
    const desired = { exists: true, bytes: inputs.sealed.originalIndex.length, sha256: notificationSeals.originalIndex,
      uid: original.uid, gid: original.gid, mode: original.mode };
    const before = targets.host['index.html'];
    await guard();
    assertFile(await read('host', 'index.html'), before, 'Host index drifted before staging');
    journal.event('before-host-index-stage', { target: 'index.html', pending: plan.stage, desired, before });
    try { await io.stage('host', plan.stage, inputs.sealed.originalIndex, desired); }
    catch (error) {
      const actual = await readUncertain('host', plan.stage);
      report.transportErrors.push({ operation: 'stage', error: error.message, actual, stageOwnershipUnverified: true });
      journal.event('uncertain-stage-readback', report.transportErrors.at(-1));
      throw error;
    }
    const staged = await read('host', plan.stage);
    for (const field of ['sha256', 'bytes', 'uid', 'gid', 'mode']) assert.equal(staged[field], desired[field], `Original-index stage ${field} differs`);
    journal.event('verified-host-stage', { pending: plan.stage, staged });
    await guard();
    assertFile(await read('host', 'index.html'), before, 'Host index drifted before publication');
    journal.event('before-host-index-publish', { pending: plan.stage, before, staged });
    try { await io.publish('host', plan.stage, 'index.html', before, staged); }
    catch (error) {
      const actual = await readUncertain('host', 'index.html');
      const pending = await readUncertain('host', plan.stage);
      const committed = isSame(actual, staged) && pending.exists === false;
      report.transportErrors.push({ operation: 'publish', error: error.message, actual, pending, committed });
      journal.event('uncertain-publish-readback', report.transportErrors.at(-1));
      if (!committed) throw error;
    }
    assertFile(await read('host', 'index.html'), staged, 'Restored host index differs from the exact stage');
    assert.equal((await read('host', plan.stage)).exists, false);
    report.restoredHostIndex = { scope: 'host', path: 'index.html', ...staged };
    journal.event('restored-host-original-index', report.restoredHostIndex);
    const verifyOriginals = async () => {
      assertFile(await read('host', 'index.html'), staged, 'Host original index drifted; retain CSS');
      assertFile(await read('container', 'index.html'), targets.container['index.html'], 'Container original index drifted; retain CSS');
    };
    await verifyOriginals();
    for (const scope of scopes) {
      await guard();
      await verifyOriginals();
      const relative = notificationPaths[0];
      const expected = targets[scope][relative];
      assertFile(await read(scope, relative), expected, 'Exact original epoch CSS drifted; retain it');
      journal.event('before-owned-css-remove', { scope, relative, expected });
      try { await io.remove(scope, relative, expected); }
      catch (error) {
        const actual = await readUncertain(scope, relative);
        report.transportErrors.push({ operation: 'remove', scope, error: error.message, actual, absent: actual.exists === false });
        journal.event('uncertain-remove-readback', report.transportErrors.at(-1));
        if (actual.exists !== false) throw error;
      }
      assert.equal((await read(scope, relative)).exists, false);
      report.removedCss.push({ scope, path: relative, ...normalizeNotificationMetadata(expected) });
      journal.event('removed-exact-epoch-css', report.removedCss.at(-1));
    }
    await verifyOriginals();
    await assertStagesAbsent(io, plan.epoch);
    assert.deepEqual(inventorySeal(await io.preserve(recoveryBindings.oldEpoch)), plan.preserved);
    const response = await io.http('index.html');
    assert.equal(response.status, 200);
    assert.equal(sha(response.bytes), notificationSeals.originalIndex);
    journal.event('restored-http-index', { status: response.status, sha256: sha(response.bytes) });
    await guard();
    report.status = 'RECOVERED-BOTH-ORIGINAL-INDEXES-REMOVED-EXACT-EPOCH-CSS';
    return report;
  } catch (error) {
    report.status = intent ? 'RECOVERY-FAILED-RETAINED-FOR-REVIEW' : 'REFUSED-RECOVERY-BEFORE-MUTATION';
    report.error = error.message;
    if (intent) {
      for (const scope of scopes) {
        for (const relative of notificationPaths) report.retained.push({ scope, path: relative, actual: await readUncertain(scope, relative) });
      }
      report.retained.push({ scope: 'host', path: plan.stage, actual: await readUncertain('host', plan.stage) });
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

export function acquireNotificationRecoveryLock(filename = path.join(artifacts, '.plm-notification-style-recovery.lock')) {
  assert.equal(fs.realpathSync(path.dirname(filename)), path.dirname(filename));
  const token = jsonBytes({ contract: 'notification-recovery-local-writer-lock-v1', pid: process.pid, nonce: randomUUID() });
  const fd = fs.openSync(filename, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  let closed = false;
  try {
    fs.writeFileSync(fd, token);
    fs.fsyncSync(fd);
    syncDirectory(path.dirname(filename));
  } catch (error) { fs.closeSync(fd); throw error; }
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

function journalDirectory(output) {
  assert.equal(fs.realpathSync(path.dirname(output)), artifacts);
  assert.match(path.basename(output), /^plm-notification-recovery-(?:prepare|apply)-[a-z0-9-]+$/);
  fs.mkdirSync(output, { mode: 0o700 });
  syncDirectory(artifacts);
  let sequence = 0;
  const bytes = (relative, content) => {
    assert.ok(relative && !path.isAbsolute(relative) && relative.split('/').every(part => part && part !== '.' && part !== '..'));
    const filename = path.join(output, relative);
    fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
    const fd = fs.openSync(filename, 'wx', 0o600);
    try { fs.writeFileSync(fd, content); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    for (let directory = path.dirname(filename); directory.startsWith(output); directory = path.dirname(directory)) {
      syncDirectory(directory);
      if (directory === output) break;
    }
  };
  return { bytes, fixed: (filename, value) => bytes(filename, jsonBytes(value)), event(stage, value) {
    bytes(`event-${String(++sequence).padStart(4, '0')}-${stage}.private.json`, jsonBytes({ stage, ...value, recordedAt: new Date().toISOString() }));
  } };
}

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: {
    prepare: { type: 'boolean' }, apply: { type: 'boolean' }, output: { type: 'string' },
    'old-plan': { type: 'string' }, 'apply-receipt': { type: 'string' }, 'failed-rollback': { type: 'string' },
    plan: { type: 'string' }, epoch: { type: 'string' }, 'plan-sha256': { type: 'string' },
    'trusted-exclusive-writer-window': { type: 'boolean' },
  } });
  assert.equal([values.prepare, values.apply].filter(Boolean).length, 1, 'Choose one explicit --prepare or --apply');
  assert.ok(values.output && path.isAbsolute(values.output));
  let plan;
  if (values.prepare) {
    for (const field of ['plan', 'epoch', 'plan-sha256', 'trusted-exclusive-writer-window']) assert.equal(values[field], undefined);
    for (const field of ['old-plan', 'apply-receipt', 'failed-rollback']) assert.ok(values[field] && path.isAbsolute(values[field]));
  } else {
    for (const field of ['old-plan', 'apply-receipt', 'failed-rollback']) assert.equal(values[field], undefined);
    assert.match(values.epoch ?? '', uuid);
    assert.match(values['plan-sha256'] ?? '', hashPattern);
    assert.equal(values['trusted-exclusive-writer-window'], true);
    const bytes = privateArtifact(values.plan, 'prepared.private.json');
    assert.equal(sha(bytes), values['plan-sha256']);
    plan = JSON.parse(bytes);
  }
  const lock = acquireNotificationRecoveryLock();
  try {
    const inputs = loadNotificationRecoveryInputs(plan ? {
      oldPlan: plan.inputPaths.oldPlan, applyReceipt: plan.inputPaths.applied, failedRollback: plan.inputPaths.failed,
    } : { oldPlan: values['old-plan'], applyReceipt: values['apply-receipt'], failedRollback: values['failed-rollback'] });
    if (plan) {
      const directory = path.dirname(values.plan);
      assert.equal(sha(privateBytes(path.join(directory, 'recovery-executor-source.private.mjs'))), plan.sourceSeal.recoveryExecutorSha256);
      assert.equal(sha(privateBytes(path.join(directory, 'recovery-test-source.private.mjs'))), plan.sourceSeal.recoveryTestSha256);
      assert.deepEqual(inventorySeal(JSON.parse(privateBytes(path.join(directory, 'preserved-inputs.private.json')))), plan.preserved);
      assert.equal(sha(privateBytes(path.join(directory, 'original-index.private.html'))), notificationSeals.originalIndex);
      for (const [key, seal] of [['oldPlan', 'oldPlanSha256'], ['applied', 'applyReceiptSha256'], ['failed', 'failedRollbackSha256']]) {
        assert.equal(sha(privateBytes(path.join(directory, `receipts/${key}.private.json`))), recoveryBindings[seal]);
      }
      for (const field of Object.keys(sourcePaths)) {
        assert.equal(sha(privateBytes(path.join(directory, `frozen-sources/${field}.private.mjs`))), recoveryBindings.oldSourceSeal[field]);
      }
    }
    const journal = journalDirectory(values.output);
    const io = createNotificationActualIo(inputs.sealed);
    const result = values.prepare ? await prepareNotificationRecovery({ inputs, io, journal, lock })
      : await applyNotificationRecovery({ plan, inputs, io, journal, lock, expectedEpoch: values.epoch,
        expectedPlanSha256: values['plan-sha256'], trustedExclusiveWriterWindow: values['trusted-exclusive-writer-window'] });
    console.log(JSON.stringify({ status: result.status, epoch: result.epoch, output: values.output,
      planSha256: plan ? values['plan-sha256'] : sha(privateBytes(path.join(values.output, 'prepared.private.json'))),
      reportSha256: plan ? sha(privateBytes(path.join(values.output, 'report.private.json'))) : undefined,
      functionalAcceptance: false, atomicCompareAndSwapClaimed: false }));
    return result;
  } finally { lock.release(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
