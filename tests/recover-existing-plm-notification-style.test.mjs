import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  acquireNotificationRecoveryLock, applyNotificationRecovery, loadNotificationRecoveryInputs, main,
  normalizeNotificationMetadata, normalizedNotificationIo, prepareNotificationRecovery, recoveryBindings,
  validateNotificationRecoverySources,
} from '../recover-existing-plm-notification-style.mjs';
import {
  createNotificationActualIo, notificationPaths, notificationPending, notificationSeals,
} from '../deploy-existing-plm-notification-style.mjs';

const workspace = path.resolve(new URL('../..', import.meta.url).pathname);
const artifacts = path.join(workspace, '.artifacts');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const jsonDigest = value => digest(Buffer.from(`${JSON.stringify(value, null, 2)}\n`));
const epoch = 'abcdef01-1234-4234-8234-123456789abc';
const boundPaths = {
  oldPlan: path.join(artifacts, 'plm-notification-deploy-20261123-r2/prepared.private.json'),
  applyReceipt: path.join(artifacts, 'plm-notification-apply-20261123-r1/report.private.json'),
  failedRollback: path.join(artifacts, 'plm-notification-rollback-20261123-r1/report.private.json'),
};
// This recovery is deliberately bound to these retained private receipts.
const inputs = loadNotificationRecoveryInputs(boundPaths);
const metadataFields = ['exists', 'bytes', 'sha256', 'uid', 'gid', 'mode', 'dev', 'ino'];
const original = inputs.sealed.originalIndex;
const key = (scope, relative) => `${scope}:${relative}`;
const metadata = file => normalizeNotificationMetadata({ ...file, bytes: file.bytes.length, sha256: digest(file.bytes) });

function memoryJournal(hooks, events) {
  const records = new Map();
  return { records, bytes(name, bytes) {
    assert.ok(!records.has(name));
    records.set(name, bytes);
  }, fixed(name, value) {
    hooks.journal?.(name, value);
    assert.ok(!records.has(name));
    records.set(name, value);
  }, event(stage, value) {
    hooks.event?.(stage, value);
    events.push({ stage, ...value });
  } };
}

function fixture() {
  const state = new Map(), calls = [], events = [], hooks = {};
  const journal = memoryJournal(hooks, events);
  const lock = { witness: { path: '/private/own-lock', ino: '1' }, assertHeld() {
    calls.push({ method: 'lock' });
    hooks.lock?.();
  } };
  let inode = 30000000;
  const makeFile = (scope, bytes, desired) => ({ ...desired, exists: true, bytes: Buffer.from(bytes),
    dev: scope === 'host' ? '66306' : '1048743', ino: String(++inode) });
  for (const item of inputs.applied.mutations) {
    const receipt = item.scope === 'container' && item.path === 'index.html' ? inputs.failed.restoredIndexes[0] : item;
    const bytes = item.scope === 'container' && item.path === 'index.html' ? original : inputs.sealed.payload.get(item.path);
    state.set(key(item.scope, item.path), { ...receipt, bytes: Buffer.from(bytes) });
  }
  const io = {
    async observe() { calls.push({ method: 'observe' }); return hooks.observe?.() ?? inputs.oldPlan.observation; },
    async preserve() { calls.push({ method: 'preserve' }); return hooks.preserve?.() ?? inputs.oldPlan.preserved; },
    async read(scope, relative) {
      calls.push({ method: 'read', scope, path: relative });
      hooks.read?.(scope, relative);
      const file = state.get(key(scope, relative));
      return file ? { ...file, bytes: Buffer.from(file.bytes) } : { exists: false };
    },
    async stage(scope, relative, bytes, desired) {
      calls.push({ method: 'stage', scope, path: relative });
      assert.ok(!state.has(key(scope, relative)));
      assert.ok(!('scope' in desired) && !('path' in desired) && !('ino' in desired) && !('dev' in desired));
      hooks.beforeStage?.(scope, relative, bytes, desired);
      state.set(key(scope, relative), makeFile(scope, bytes, desired));
      hooks.afterStage?.(scope, relative);
    },
    async publish(scope, pending, relative, before, staged) {
      calls.push({ method: 'publish', scope, path: relative, pending });
      hooks.beforePublish?.(scope, pending, relative);
      assert.deepEqual(Object.keys(before), metadataFields);
      assert.deepEqual(Object.keys(staged), metadataFields);
      assert.deepEqual(metadata(state.get(key(scope, relative))), before);
      const source = state.get(key(scope, pending));
      assert.deepEqual(metadata(source), staged);
      state.set(key(scope, relative), source);
      state.delete(key(scope, pending));
      hooks.afterPublish?.(scope, pending, relative);
    },
    async remove(scope, relative, expected) {
      calls.push({ method: 'remove', scope, path: relative });
      assert.deepEqual(Object.keys(expected), metadataFields);
      assert.deepEqual(metadata(state.get(key(scope, relative))), expected);
      state.delete(key(scope, relative));
      hooks.afterRemove?.(scope, relative);
    },
    async http(relative) {
      calls.push({ method: 'http', path: relative });
      const response = { status: 200, bytes: Buffer.from(state.get(key('container', relative)).bytes) };
      return hooks.http?.(relative, response) ?? response;
    },
  };
  return { state, calls, events, hooks, journal, lock, io, makeFile,
    mutating: () => calls.filter(item => ['stage', 'publish', 'remove'].includes(item.method)),
    prepare: () => prepareNotificationRecovery({ inputs, io, journal, lock, epoch }),
    apply(plan, extra = {}) {
      const applyJournal = memoryJournal(hooks, events);
      return applyNotificationRecovery({ inputs, io, journal: applyJournal, lock, plan,
        expectedEpoch: epoch, expectedPlanSha256: jsonDigest(plan), trustedExclusiveWriterWindow: true, ...extra });
    },
    assertOriginal() {
      for (const scope of ['host', 'container']) assert.deepEqual(state.get(key(scope, 'index.html')).bytes, original);
    },
  };
}

test('metadata normalization strips complete receipt context but requires every file identity field', () => {
  const receipt = inputs.applied.mutations[0];
  assert.ok('scope' in receipt && 'path' in receipt);
  assert.deepEqual(Object.keys(normalizeNotificationMetadata(receipt)), metadataFields);
  for (const field of metadataFields) {
    const missing = { ...receipt };
    delete missing[field];
    assert.throws(() => normalizeNotificationMetadata(missing), field);
  }
});

test('the old plan, successful apply, failed rollback and old sources stay statically sealed', () => {
  assert.deepEqual(inputs.bindings, recoveryBindings);
  assert.equal(digest(fs.readFileSync(boundPaths.oldPlan)), recoveryBindings.oldPlanSha256);
  assert.equal(digest(fs.readFileSync(boundPaths.applyReceipt)), recoveryBindings.applyReceiptSha256);
  assert.equal(digest(fs.readFileSync(boundPaths.failedRollback)), recoveryBindings.failedRollbackSha256);
  assert.equal(inputs.failed.restoredIndexes[0].scope, 'container');
  assert.equal(inputs.failed.removedCss.length, 0);
});

test('recovery binds retained source bytes and rejects changed, missing or extra source snapshots', () => {
  const sources = Object.fromEntries([
    ['executorSha256', 'executor-source.private.mjs'],
    ['executorTestSha256', 'executor-test-source.private.mjs'],
    ['startupHelperSha256', 'startup-helper-source.private.mjs'],
  ].map(([field, filename]) => [field, fs.readFileSync(path.join(path.dirname(boundPaths.oldPlan), filename))]));
  validateNotificationRecoverySources(sources);
  for (const field of Object.keys(sources)) {
    assert.throws(() => validateNotificationRecoverySources({ ...sources, [field]: Buffer.from('drift') }));
    const missing = { ...sources };
    delete missing[field];
    assert.throws(() => validateNotificationRecoverySources(missing));
  }
  assert.throws(() => validateNotificationRecoverySources({ ...sources, extra: Buffer.from('foreign') }));
});

test('read-only preparation seals exactly the known partial state and records the trusted writer limitation', async () => {
  const f = fixture(), plan = await f.prepare();
  assert.equal(plan.status, 'PREPARED-NOT-APPLIED');
  assert.equal(f.mutating().length, 0);
  assert.equal(plan.targets.host['index.html'].sha256, notificationSeals.index);
  assert.equal(plan.targets.container['index.html'].sha256, notificationSeals.originalIndex);
  assert.equal(plan.concurrency.atomicCompareAndSwapClaimed, false);
  assert.equal(plan.concurrency.protectionAgainstUncooperativeExternalWritersClaimed, false);
  assert.ok(f.journal.records.has('preserved-inputs.private.json'));
  assert.ok(f.journal.records.has('receipts/failed.private.json'));
  assert.ok(f.journal.records.has('recovery-executor-source.private.mjs'));
});

test('only host index is published, then both exact CSS files are removed after verifying original indexes', async () => {
  const f = fixture(), plan = await f.prepare();
  const containerBefore = metadata(f.state.get('container:index.html'));
  const result = await f.apply(plan);
  assert.equal(result.status, 'RECOVERED-BOTH-ORIGINAL-INDEXES-REMOVED-EXACT-EPOCH-CSS');
  assert.equal(result.functionalAcceptance, false);
  assert.deepEqual(f.calls.filter(item => item.method === 'publish').map(item => [item.scope, item.path]), [['host', 'index.html']]);
  assert.deepEqual(f.calls.filter(item => item.method === 'remove').map(item => [item.scope, item.path]),
    [['host', notificationPaths[0]], ['container', notificationPaths[0]]]);
  assert.deepEqual(metadata(f.state.get('container:index.html')), containerBefore);
  assert.equal(f.state.size, 2);
  f.assertOriginal();
});

test('unexpected partial rollback state refuses preparation without adopting identical-hash foreign inodes', async () => {
  for (const change of ['host-original', 'container-candidate', 'container-inode', 'host-css-absent', 'css-owner', 'old-stage', 'new-stage']) {
    const f = fixture();
    if (change === 'host-original') f.state.set('host:index.html', f.makeFile('host', original, metadata(f.state.get('host:index.html'))));
    if (change === 'container-candidate') f.state.get('container:index.html').bytes = Buffer.from(inputs.sealed.payload.get('index.html'));
    if (change === 'container-inode') f.state.get('container:index.html').ino = '9999';
    if (change === 'host-css-absent') f.state.delete(key('host', notificationPaths[0]));
    if (change === 'css-owner') f.state.get(key('container', notificationPaths[0])).uid = '9999';
    if (change === 'old-stage') f.state.set(key('host', notificationPending('index.html', recoveryBindings.oldEpoch, true)),
      f.makeFile('host', original, metadata(f.state.get('host:index.html'))));
    if (change === 'new-stage') f.state.set(key('host', notificationPending('index.html', epoch, true)),
      f.makeFile('host', original, metadata(f.state.get('host:index.html'))));
    await assert.rejects(f.prepare(), undefined, change);
    assert.equal(f.mutating().length, 0);
  }
});

test('missing window acknowledgement, wrong epoch/plan, lost local lock and changed runtime refuse all recovery writes', async () => {
  for (const change of ['window', 'epoch', 'plan', 'lock', 'runtime', 'preserved']) {
    const f = fixture(), plan = await f.prepare(), extra = {};
    if (change === 'window') extra.trustedExclusiveWriterWindow = false;
    if (change === 'epoch') extra.expectedEpoch = recoveryBindings.oldEpoch;
    if (change === 'plan') extra.expectedPlanSha256 = '0'.repeat(64);
    if (change === 'lock') f.hooks.lock = () => { throw new Error('lock replaced'); };
    if (change === 'runtime') f.hooks.observe = () => ({ changed: true });
    if (change === 'preserved') f.hooks.preserve = () => ({ changed: true });
    await assert.rejects(f.apply(plan, extra), error => error.evidence.status === 'REFUSED-RECOVERY-BEFORE-MUTATION');
    assert.equal(f.mutating().length, 0, change);
  }
});

test('intent fsync failure and target drift after preparation refuse every mutation', async () => {
  for (const change of ['intent', 'host-inode', 'container-inode', 'css-inode']) {
    const f = fixture(), plan = await f.prepare();
    if (change === 'intent') f.hooks.journal = name => { if (name === 'recovery-intent.private.json') throw new Error('intent fsync failed'); };
    if (change === 'host-inode') f.state.get('host:index.html').ino = '9999';
    if (change === 'container-inode') f.state.get('container:index.html').ino = '9999';
    if (change === 'css-inode') f.state.get(key('host', notificationPaths[0])).ino = '9999';
    await assert.rejects(f.apply(plan), error => error.evidence.status === 'REFUSED-RECOVERY-BEFORE-MUTATION');
    assert.equal(f.mutating().length, 0);
  }
});

test('interrupted stage and unknown publication drift retain state and never delete CSS', async () => {
  for (const change of ['partial-stage', 'target-drift', 'stage-drift']) {
    const f = fixture(), plan = await f.prepare();
    if (change === 'partial-stage') f.hooks.beforeStage = (scope, relative) => {
      f.state.set(key(scope, relative), f.makeFile(scope, Buffer.from('partial'), metadata(f.state.get('host:index.html'))));
      throw new Error('stage interrupted');
    };
    if (change === 'target-drift') f.hooks.afterStage = () => { f.state.get('host:index.html').ino = '9999'; };
    if (change === 'stage-drift') f.hooks.beforePublish = (scope, pending) => { f.state.get(key(scope, pending)).ino = '9999'; };
    await assert.rejects(f.apply(plan), error => error.evidence.status === 'RECOVERY-FAILED-RETAINED-FOR-REVIEW');
    assert.equal(f.calls.filter(item => item.method === 'remove').length, 0);
    for (const scope of ['host', 'container']) assert.ok(f.state.has(key(scope, notificationPaths[0])));
  }
});

test('confirmed lost publication and deletion responses retain raw errors while completing exact recovery', async () => {
  const f = fixture(), plan = await f.prepare();
  f.hooks.afterPublish = () => { throw new Error('lost host rename response'); };
  f.hooks.afterRemove = () => { throw new Error('lost CSS deletion response'); };
  const report = await f.apply(plan);
  assert.equal(report.status, 'RECOVERED-BOTH-ORIGINAL-INDEXES-REMOVED-EXACT-EPOCH-CSS');
  assert.equal(report.transportErrors.length, 3);
  assert.equal(report.transportErrors[0].committed, true);
  assert.ok(report.transportErrors.slice(1).every(item => item.absent));
  f.assertOriginal();
  assert.equal(f.state.size, 2);
});

test('unavailable lost-response readback preserves the initiating error and retains both CSS files', async () => {
  const f = fixture(), plan = await f.prepare();
  f.hooks.afterPublish = () => {
    f.hooks.read = () => { throw new Error('readback unavailable'); };
    throw new Error('original rename response lost');
  };
  await assert.rejects(f.apply(plan), error => {
    assert.equal(error.evidence.error, 'original rename response lost');
    assert.equal(error.evidence.transportErrors[0].actual.readbackError, 'readback unavailable');
    return true;
  });
  assert.equal(f.calls.filter(item => item.method === 'remove').length, 0);
});

test('index drift after host restoration blocks both CSS removals and changed CSS is never deleted', async () => {
  for (const change of ['container-index', 'host-css']) {
    const f = fixture(), plan = await f.prepare();
    f.hooks.afterPublish = () => {
      if (change === 'container-index') f.state.get('container:index.html').ino = '9999';
      else f.state.get(key('host', notificationPaths[0])).bytes = Buffer.from('unknown newer content');
    };
    await assert.rejects(f.apply(plan), error => error.evidence.status === 'RECOVERY-FAILED-RETAINED-FOR-REVIEW');
    assert.equal(f.calls.filter(item => item.method === 'remove').length, 0);
    for (const scope of ['host', 'container']) assert.ok(f.state.has(key(scope, notificationPaths[0])));
  }
});

test('a completed recovery cannot be repeated or used to adopt a new original-index inode', async () => {
  const f = fixture(), plan = await f.prepare();
  await f.apply(plan);
  const before = f.mutating().length;
  await assert.rejects(f.apply(plan), error => error.evidence.status === 'REFUSED-RECOVERY-BEFORE-MUTATION');
  assert.equal(f.mutating().length, before);
});

test('current host adapter accepts full scope/path receipts and restores exact original inode bytes', async t => {
  const root = fs.mkdtempSync(path.join(tmpdir(), 'notification-recovery-host-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const candidate = inputs.sealed.payload.get('index.html');
  fs.writeFileSync(path.join(root, 'index.html'), candidate, { mode: 0o600 });
  const fileReceipt = filename => {
    const stat = fs.statSync(path.join(root, filename), { bigint: true });
    return { scope: 'host', path: filename, exists: true, bytes: stat.size > 0n ? Number(stat.size) : 0,
      sha256: digest(fs.readFileSync(path.join(root, filename))), uid: String(stat.uid), gid: String(stat.gid),
      mode: (stat.mode & 0o7777n).toString(8), dev: String(stat.dev), ino: String(stat.ino) };
  };
  const commands = [];
  const actual = createNotificationActualIo(inputs.sealed, (program, args, options) => {
    assert.equal(program, process.execPath);
    const redirected = [...args];
    assert.equal(redirected[0], '-e');
    redirected[2] = root;
    commands.push(redirected);
    return spawnSync(program, redirected, { input: options.input, maxBuffer: 128 * 1024 });
  });
  const io = normalizedNotificationIo(actual);
  const before = fileReceipt('index.html');
  assert.ok('scope' in before && 'path' in before);
  const pending = notificationPending('index.html', epoch, true);
  const desired = { ...before, bytes: original.length, sha256: digest(original) };
  await io.stage('host', pending, original, desired);
  const staged = fileReceipt(pending);
  await actual.publish('host', pending, 'index.html', before, staged);
  assert.equal(fileReceipt('index.html').ino, staged.ino);
  assert.equal(fileReceipt('index.html').sha256, notificationSeals.originalIndex);
  assert.ok(commands.every(command => command[2] === root));
  const published = fileReceipt('index.html');
  await assert.rejects(io.remove('host', 'index.html', { ...published, ino: '99999' }));
  await io.remove('host', 'index.html', published);
  assert.equal(fs.existsSync(path.join(root, 'index.html')), false);
});

test('the common recovery lock refuses concurrent runs and never removes a replaced lock inode', t => {
  const directory = fs.mkdtempSync(path.join(tmpdir(), 'notification-recovery-lock-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const filename = path.join(directory, 'writer.lock');
  const first = acquireNotificationRecoveryLock(filename);
  assert.throws(() => acquireNotificationRecoveryLock(filename), /EEXIST/);
  first.assertHeld();
  first.release();
  assert.equal(fs.existsSync(filename), false);
  const second = acquireNotificationRecoveryLock(filename);
  fs.unlinkSync(filename);
  fs.writeFileSync(filename, 'foreign lock', { mode: 0o600 });
  assert.throws(() => second.assertHeld());
  assert.throws(() => second.release());
  assert.equal(fs.readFileSync(filename, 'utf8'), 'foreign lock');
});

test('CLI rejects missing explicit operation, input receipts or trusted writer acknowledgement', async () => {
  for (const args of [[], ['--prepare', '--apply'], ['--prepare', '--output', '/tmp/nope'],
    ['--apply', '--output', '/tmp/nope'], ['--apply', '--output', '/tmp/nope', '--epoch', epoch, '--plan-sha256', '0'.repeat(64)]]) {
    await assert.rejects(main(args));
  }
});
