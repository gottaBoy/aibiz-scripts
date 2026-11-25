import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  acquireNotificationDeploymentLock, applyNotificationDeployment, createNotificationActualIo, main, notificationHostMutationProgram,
  notificationContainerInventoryProgram, notificationPaths, notificationPending, notificationSeals,
  normalizeNotificationFileMetadata, parseNotificationContainerInventory, prepareNotificationDeployment,
  rollbackNotificationDeployment, validateNotificationFiles,
} from '../deploy-existing-plm-notification-style.mjs';
import { addNotificationStyleLink, compileNotificationStyles } from '../prepare-plm-notification-style.mjs';
import { acquireNotificationRecoveryLock } from '../recover-existing-plm-notification-style.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const jsonDigest = value => digest(Buffer.from(`${JSON.stringify(value, null, 2)}\n`));
const epoch = '12345678-1234-4234-8234-123456789abc';
const key = (scope, relative) => `${scope}:${relative}`;
const originalIndex = fs.readFileSync(new URL(
  '../../.artifacts/plm-notification-deploy-20261123-r2/backup/host/index.html', import.meta.url,
));
assert.equal(digest(originalIndex), notificationSeals.originalIndex, 'The fixed deployment original HTML must be available');
const css = Buffer.from(compileNotificationStyles().css);
assert.equal(digest(css), notificationSeals.css);
const index = Buffer.from(addNotificationStyleLink(originalIndex.toString(), notificationPaths[0]));
assert.equal(digest(index), notificationSeals.index);

function journal(hooks, events) {
  const records = new Map();
  return { records, bytes(name, bytes) {
    assert.ok(!records.has(name), `Evidence is exclusive: ${name}`);
    records.set(name, Buffer.from(bytes));
  }, fixed(name, value) {
    hooks.journal?.(name, value);
    assert.ok(!records.has(name), `Evidence is exclusive: ${name}`);
    records.set(name, structuredClone(value));
  }, event(stage, value) {
    hooks.event?.(stage, value);
    events.push({ stage, ...structuredClone(value) });
  } };
}

function fixture() {
  const state = new Map(), calls = [], hooks = {}, events = [];
  let inode = 10;
  const makeFile = (scope, bytes, extra = {}) => ({ exists: true, bytes: Buffer.from(bytes),
    uid: scope === 'host' ? '1000' : '101', gid: scope === 'host' ? '1000' : '101',
    mode: scope === 'host' ? '664' : '644', dev: scope === 'host' ? '1' : '2', ino: String(++inode), ...extra });
  for (const scope of ['host', 'container']) state.set(key(scope, 'index.html'), makeFile(scope, originalIndex));
  const observation = { runtime: { id: notificationSeals.container, image: notificationSeals.image, restartCount: 0 },
    sourceInputsSha256: 'a'.repeat(64), startupSha256: 'b'.repeat(64) };
  const preserved = { hostDist: { files: 4, sha256: 'c'.repeat(64) },
    containerDist: { files: 4, sha256: 'd'.repeat(64) }, modelSource: { files: 5, sha256: 'e'.repeat(64) } };
  const payload = new Map([[notificationPaths[0], css], ['index.html', index]]);
  const sealed = { directory: '/private/fixed-candidate', manifestSha256: notificationSeals.manifest,
    originalIndex, payload, files: [...payload].map(([relative, bytes]) => ({
      path: relative, bytes: bytes.length, sha256: digest(bytes),
    })) };
  const evidence = journal(hooks, events);
  const lock = { witness: { path: '/private/shared-lock', ino: '1' }, assertHeld() { hooks.lock?.(); } };
  const io = {
    async observe() { calls.push({ method: 'observe' }); hooks.observe?.(); return structuredClone(observation); },
    async preserve() { calls.push({ method: 'preserve' }); hooks.preserve?.(); return structuredClone(preserved); },
    async read(scope, relative) {
      calls.push({ method: 'read', scope, path: relative });
      hooks.read?.(scope, relative);
      const file = state.get(key(scope, relative));
      return file ? { ...file, bytes: Buffer.from(file.bytes) } : { exists: false };
    },
    async stage(scope, relative, bytes, metadata) {
      calls.push({ method: 'stage', scope, path: relative });
      assert.ok(!state.has(key(scope, relative)));
      hooks.beforeStage?.(scope, relative, bytes);
      state.set(key(scope, relative), makeFile(scope, bytes, {
        uid: metadata.uid, gid: metadata.gid, mode: metadata.mode,
      }));
      hooks.afterStage?.(scope, relative);
    },
    async publish(scope, pending, relative, expected, staged) {
      calls.push({ method: 'publish', scope, path: relative, pending });
      hooks.beforePublish?.(scope, pending, relative);
      const source = state.get(key(scope, pending));
      const target = state.get(key(scope, relative));
      for (const [actual, desired] of [[source, staged], [target, expected]]) {
        if (desired.exists) {
          assert.ok(actual);
          for (const field of ['uid', 'gid', 'mode', 'dev', 'ino']) assert.equal(actual[field], desired[field]);
          assert.equal(digest(actual.bytes), desired.sha256);
        } else assert.equal(actual, undefined);
      }
      state.set(key(scope, relative), source);
      state.delete(key(scope, pending));
      hooks.afterPublish?.(scope, pending, relative);
    },
    async remove(scope, relative, expected) {
      calls.push({ method: 'remove', scope, path: relative });
      const actual = state.get(key(scope, relative));
      assert.equal(actual.ino, expected.ino);
      assert.equal(digest(actual.bytes), expected.sha256);
      state.delete(key(scope, relative));
      hooks.afterRemove?.(scope, relative);
    },
    async http(relative) {
      calls.push({ method: 'http', path: relative });
      const response = { status: 200, bytes: Buffer.from(state.get(key('container', relative)).bytes) };
      return hooks.http?.(relative, response) ?? response;
    },
  };
  const mutating = () => calls.filter(call => ['stage', 'publish', 'remove'].includes(call.method));
  return { state, calls, hooks, events, journal: evidence, observation, preserved, sealed, io, makeFile, mutating, lock,
    prepare: () => prepareNotificationDeployment({ sealed, io, journal: evidence, lock, epoch }),
    apply: plan => applyNotificationDeployment({ sealed, io, journal: evidence, lock, plan,
      expectedEpoch: epoch, expectedPlanSha256: jsonDigest(plan), trustedExclusiveWriterWindow: true }),
    rollback(plan, appliedReport, overrides = {}) {
      const rollbackJournal = journal(hooks, events);
      return rollbackNotificationDeployment({ sealed, io, journal: rollbackJournal, lock, plan, appliedReport,
        expectedEpoch: epoch, expectedPlanSha256: jsonDigest(plan),
        expectedApplyReceiptSha256: jsonDigest(appliedReport), trustedExclusiveWriterWindow: true, ...overrides });
    },
    assertOriginal() {
      for (const scope of ['host', 'container']) assert.deepEqual(state.get(key(scope, 'index.html')).bytes, originalIndex);
    },
  };
}

test('only the two exact hash/size/path outputs and UUID epoch stages are eligible', () => {
  const f = fixture();
  validateNotificationFiles(f.sealed.files);
  for (const relative of ['plugins/test.js', 'static/js/index.js', '../index.html', 'environments/environment.js']) {
    const files = structuredClone(f.sealed.files);
    files[0].path = relative;
    assert.throws(() => validateNotificationFiles(files));
  }
  for (const field of ['bytes', 'sha256']) {
    const files = structuredClone(f.sealed.files);
    files[0][field] = field === 'bytes' ? 1 : '0'.repeat(64);
    assert.throws(() => validateNotificationFiles(files));
  }
  assert.throws(() => notificationPending('index.html', '../outside'));
});

test('BusyBox-compatible inventory keeps hash/path records separate and refuses malformed or unsafe records', () => {
  assert.ok(!notificationContainerInventoryProgram.includes('sha256sum -z'));
  const a = 'a'.repeat(64), b = 'b'.repeat(64);
  const rows = parseNotificationContainerInventory(Buffer.from(`${a}\0/dist/name with spaces.js\0${b}\0/dist/index.html\0`),
    new Set(['index.html']));
  assert.deepEqual(rows, [{ path: 'name with spaces.js', sha256: a }]);
  for (const text of [`${a}\0/dist/../bad\0`, `${a}\0/dist/a\\bad\0`, `${a}\0/dist/new\nline\0`,
    `${a}\0/dist/missing-terminator`, `${a}\0/dist/a\0${a}\0/dist/a\0`, `invalid\0/dist/a\0`]) {
    assert.throws(() => parseNotificationContainerInventory(Buffer.from(text)));
  }
});

test('preparation only observes and seals both exact originals, payload, executor, tests and preservation inventory', async () => {
  const f = fixture();
  const plan = await f.prepare();
  assert.equal(plan.status, 'PREPARED-NOT-APPLIED');
  assert.equal(f.mutating().length, 0);
  assert.equal(plan.concurrency.atomicCompareAndSwapClaimed, false);
  assert.equal(plan.concurrency.protectionAgainstUncooperativeExternalWritersClaimed, false);
  assert.deepEqual(f.journal.records.get('backup/host/index.html'), originalIndex);
  assert.deepEqual(f.journal.records.get('backup/container/index.html'), originalIndex);
  for (const name of ['executor-source.private.mjs', 'executor-test-source.private.mjs',
    'startup-helper-source.private.mjs', 'preserved-inputs.private.json', 'prepared.private.json']) {
    assert.ok(f.journal.records.has(name));
  }
});

test('exact application publishes two new CSS files before both indexes and verifies actual HTTP bytes', async () => {
  const f = fixture(), plan = await f.prepare();
  const report = await f.apply(plan);
  assert.equal(report.status, 'APPLIED-STATIC-ONLY-BUSINESS-ACCEPTANCE-PENDING');
  assert.equal(report.functionalAcceptance, false);
  assert.deepEqual(f.calls.filter(item => item.method === 'publish').map(item => [item.scope, item.path]), [
    ['host', notificationPaths[0]], ['container', notificationPaths[0]], ['host', 'index.html'], ['container', 'index.html'],
  ]);
  assert.equal(report.mutations.length, 4);
  assert.equal(f.calls.filter(item => item.method === 'http').length, 3);
  assert.ok(f.journal.records.has('apply-intent.private.json'));
  assert.ok([...f.state.keys()].every(name => !name.endsWith('.pending')));
});

test('epoch, plan SHA, payload, lifecycle, preservation or target drift refuses every mutation', async () => {
  for (const kind of ['epoch', 'plan', 'payload', 'runtime', 'preserved', 'index-inode', 'css-exists']) {
    const f = fixture(), plan = await f.prepare();
    const args = { sealed: f.sealed, io: f.io, journal: f.journal, lock: f.lock, plan,
      expectedEpoch: epoch, expectedPlanSha256: jsonDigest(plan), trustedExclusiveWriterWindow: true };
    if (kind === 'epoch') args.expectedEpoch = undefined;
    if (kind === 'plan') args.expectedPlanSha256 = '0'.repeat(64);
    if (kind === 'payload') f.sealed.payload.set('index.html', Buffer.from('foreign'));
    if (kind === 'runtime') f.observation.runtime.restartCount++;
    if (kind === 'preserved') f.preserved.hostDist.sha256 = '0'.repeat(64);
    if (kind === 'index-inode') f.state.set('host:index.html', f.makeFile('host', originalIndex));
    if (kind === 'css-exists') f.state.set(key('host', notificationPaths[0]), f.makeFile('host', css));
    await assert.rejects(applyNotificationDeployment(args), error => error.evidence.status === 'REFUSED-BEFORE-MUTATION');
    assert.equal(f.mutating().length, 0, kind);
  }
});

test('preparation refuses existing CSS, stale pending paths and drift during observation', async () => {
  for (const kind of ['css', 'pending', 'drift']) {
    const f = fixture();
    if (kind === 'css') f.state.set(key('host', notificationPaths[0]), f.makeFile('host', css));
    if (kind === 'pending') f.state.set(key('container', notificationPending('index.html', epoch)), f.makeFile('container', index));
    if (kind === 'drift') {
      let reads = 0;
      f.hooks.read = (scope, relative) => {
        if (scope === 'host' && relative === 'index.html' && ++reads === 2) f.state.set('host:index.html', f.makeFile('host', originalIndex));
      };
    }
    await assert.rejects(f.prepare());
    assert.equal(f.mutating().length, 0);
  }
});

test('failed durable intent refuses all staging and keeps the original targets', async () => {
  const f = fixture(), plan = await f.prepare();
  f.hooks.journal = name => { if (name === 'apply-intent.private.json') throw new Error('disk full at intent fsync'); };
  await assert.rejects(f.apply(plan), error => error.evidence.status === 'REFUSED-BEFORE-MUTATION');
  assert.equal(f.mutating().length, 0);
  f.assertOriginal();
});

test('lost response after final index rename is read back then conditionally recovers exact originals and CSS', async () => {
  const f = fixture(), plan = await f.prepare();
  let failed = false;
  f.hooks.afterPublish = (scope, pending, relative) => {
    if (!failed && scope === 'container' && relative === 'index.html') {
      failed = true;
      throw new Error('lost response after rename');
    }
  };
  await assert.rejects(f.apply(plan), error => {
    assert.equal(error.evidence.recoveryStatus, 'ORIGINAL-INDEXES-RESTORED-OWNED-CSS-REMOVED');
    assert.equal(error.evidence.transportErrors[0].committedReadback, true);
    return true;
  });
  f.assertOriginal();
  assert.equal(f.state.size, 2);
  assert.ok(f.events.some(item => item.stage === 'uncertain-publish-readback' && item.committed));
});

test('served CSS/index mismatch preserves the raw failure and recovers after verifying both originals', async () => {
  for (const failedPath of notificationPaths) {
    const f = fixture(), plan = await f.prepare();
    f.hooks.http = (relative, response) => relative === failedPath && digest(response.bytes) !== notificationSeals.originalIndex
      ? { status: 200, bytes: Buffer.from('wrong served bytes') } : response;
    await assert.rejects(f.apply(plan), error => {
      assert.match(error.evidence.error, /Actual HTTP bytes differ/);
      assert.equal(error.evidence.recoveryStatus, 'ORIGINAL-INDEXES-RESTORED-OWNED-CSS-REMOVED');
      return true;
    });
    f.assertOriginal();
    assert.equal(f.state.size, 2);
  }
});

test('an interrupted unverified stage is retained and never adopted, while verified epoch files are recoverable', async () => {
  const f = fixture(), plan = await f.prepare();
  const pending = notificationPending(notificationPaths[0], epoch);
  f.hooks.beforeStage = (scope, relative) => {
    if (scope === 'container') {
      f.state.set(key(scope, relative), f.makeFile(scope, Buffer.from('partial stage')));
      throw new Error('partial upload');
    }
  };
  await assert.rejects(f.apply(plan), error => error.evidence.recoveryStatus === 'INCOMPLETE-RETAINED-FOR-REVIEW');
  f.assertOriginal();
  assert.ok(f.state.has(key('container', pending)));
  assert.ok(!f.calls.some(item => item.method === 'remove' && item.scope === 'container' && item.path === pending));
  assert.ok(f.events.some(item => item.stage === 'uncertain-stage-readback'));
});

test('a foreign same-hash index inode retains both scopes CSS until all originals can be verified', async () => {
  const f = fixture(), plan = await f.prepare();
  f.hooks.http = () => {
    f.state.set('container:index.html', f.makeFile('container', index));
    return { status: 503, bytes: Buffer.from('readback unavailable') };
  };
  await assert.rejects(f.apply(plan), error => error.evidence.recoveryStatus === 'INCOMPLETE-RETAINED-FOR-REVIEW');
  assert.deepEqual(f.state.get('host:index.html').bytes, originalIndex);
  for (const scope of ['host', 'container']) assert.ok(f.state.has(key(scope, notificationPaths[0])));
});

test('changed CSS inode/owner/content or lifecycle blocks deletion during failure recovery', async () => {
  for (const kind of ['inode', 'owner', 'content', 'runtime']) {
    const f = fixture(), plan = await f.prepare();
    f.hooks.http = () => {
      const file = f.state.get(key('host', notificationPaths[0]));
      if (kind === 'inode') file.ino = '99999';
      if (kind === 'owner') file.uid = '99999';
      if (kind === 'content') file.bytes = Buffer.from('external drift');
      if (kind === 'runtime') f.observation.runtime.restartCount++;
      return { status: 503, bytes: Buffer.from('failed') };
    };
    await assert.rejects(f.apply(plan), error => error.evidence.recoveryStatus === 'INCOMPLETE-RETAINED-FOR-REVIEW');
    assert.ok(f.state.has(key('host', notificationPaths[0])));
    assert.ok(!f.calls.some(item => item.method === 'remove' && item.scope === 'host' && item.path === notificationPaths[0]));
  }
});

test('rollback requires exact successful receipt/epoch/plan and restores both indexes before CSS removal', async () => {
  const f = fixture(), plan = await f.prepare(), applied = await f.apply(plan);
  const report = await f.rollback(plan, applied);
  assert.equal(report.status, 'ROLLED-BACK-EXACT-INDEXES-REMOVED-VERIFIED-EPOCH-CSS');
  assert.deepEqual(report.restoredIndexes.map(item => item.scope), ['container', 'host']);
  assert.equal(report.removedCss.length, 2);
  f.assertOriginal();
  assert.equal(f.state.size, 2);
});

test('rollback rejects changed receipt, epoch, plan, index inode and CSS metadata before every mutation', async () => {
  for (const kind of ['receipt', 'receipt-inode', 'epoch', 'plan', 'index', 'css-owner', 'intent']) {
    const f = fixture(), plan = await f.prepare(), applied = await f.apply(plan);
    const before = f.mutating().length, overrides = {};
    if (kind === 'receipt') overrides.expectedApplyReceiptSha256 = '0'.repeat(64);
    if (kind === 'receipt-inode') delete applied.mutations[0].ino;
    if (kind === 'epoch') overrides.expectedEpoch = 'abcdef01-1234-4234-8234-123456789abc';
    if (kind === 'plan') overrides.expectedPlanSha256 = '0'.repeat(64);
    if (kind === 'index') f.state.set('container:index.html', f.makeFile('container', index));
    if (kind === 'css-owner') f.state.get(key('host', notificationPaths[0])).uid = '999';
    if (kind === 'intent') f.hooks.journal = name => { if (name === 'rollback-intent.private.json') throw new Error('intent fsync failed'); };
    await assert.rejects(f.rollback(plan, applied, overrides), error => error.evidence.status === 'REFUSED-ROLLBACK-BEFORE-MUTATION');
    assert.equal(f.mutating().length, before);
  }
});

test('lost rollback rename/remove responses are read back; confirmed completed operations retain transport errors', async () => {
  const f = fixture(), plan = await f.prepare(), applied = await f.apply(plan);
  let renameFailure = false, removeFailure = false;
  f.hooks.afterPublish = (scope, pending) => {
    if (!renameFailure && pending.endsWith('-rollback.pending')) { renameFailure = true; throw new Error('lost rollback rename response'); }
  };
  f.hooks.afterRemove = () => {
    if (!removeFailure) { removeFailure = true; throw new Error('lost removal response'); }
  };
  const report = await f.rollback(plan, applied);
  assert.equal(report.status, 'ROLLED-BACK-EXACT-INDEXES-REMOVED-VERIFIED-EPOCH-CSS');
  assert.equal(report.transportErrors.length, 2);
  f.assertOriginal();
  assert.equal(f.state.size, 2);
});

test('drift after first rollback index restoration retains all CSS and refuses repeat adoption', async () => {
  const f = fixture(), plan = await f.prepare(), applied = await f.apply(plan);
  f.hooks.afterPublish = (scope, pending) => {
    if (scope === 'container' && pending.endsWith('-rollback.pending')) f.state.set('host:index.html', f.makeFile('host', index));
  };
  await assert.rejects(f.rollback(plan, applied), error => {
    assert.equal(error.evidence.status, 'ROLLBACK-FAILED-RETAINED-FOR-REVIEW');
    assert.equal(error.evidence.removedCss.length, 0);
    return true;
  });
  for (const scope of ['host', 'container']) assert.ok(f.state.has(key(scope, notificationPaths[0])));
  const before = f.mutating().length;
  await assert.rejects(f.rollback(plan, applied));
  assert.equal(f.mutating().length, before);
});

test('actual container adapter uses fixed FD exclusive staging and same-shell full target/stage guards', async () => {
  const calls = [], io = createNotificationActualIo({ expectedRuntime: { id: notificationSeals.container } },
    (program, args, options) => { calls.push({ program, args, options }); return { status: 0, stdout: Buffer.alloc(0) }; });
  const pending = notificationPending(notificationPaths[0], epoch);
  const metadata = { exists: true, uid: '101', gid: '101', mode: '644', bytes: css.length, sha256: digest(css) };
  await io.stage('container', pending, css, metadata);
  assert.equal(calls[0].program, 'docker');
  assert.equal(calls[0].args[calls[0].args.indexOf('--user') + 1], '101:101');
  assert.ok(calls[0].args.some(arg => arg.includes('exec 3>"$target"') && arg.includes('set -C') && arg.includes('/proc/$$/fd/3')));
  const staged = { ...metadata, dev: '1', ino: '2' };
  await io.publish('container', pending, notificationPaths[0], { exists: false }, staged);
  const command = calls[1].args.find(arg => arg.includes('pending='));
  assert.match(command, /%u:%g:%a:%d:%i:%s/);
  assert.match(command, /ln -T/);
  assert.match(command, /sync "\$target"/);
});

test('real host child writes an exclusive fixed FD, publishes exact inode, refuses drift and never overwrites unknown files', t => {
  const root = fs.mkdtempSync(path.join(tmpdir(), 'notification-host-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const target = 'index.html', pending = notificationPending('index.html', epoch);
  fs.writeFileSync(path.join(root, target), originalIndex, { mode: 0o600 });
  const info = filename => {
    const stat = fs.statSync(path.join(root, filename), { bigint: true });
    const bytes = fs.readFileSync(path.join(root, filename));
    return { exists: true, uid: String(stat.uid), gid: String(stat.gid), mode: (stat.mode & 0o7777n).toString(8),
      dev: String(stat.dev), ino: String(stat.ino), bytes: bytes.length, sha256: digest(bytes) };
  };
  const before = info(target);
  const desired = { exists: true, uid: before.uid, gid: before.gid, mode: before.mode, bytes: index.length, sha256: digest(index) };
  const run = (action, relative, stage, expected, staged, input) => spawnSync(process.execPath,
    ['-e', notificationHostMutationProgram, root, action, relative, stage, JSON.stringify(expected), JSON.stringify(staged)],
    { input, encoding: 'utf8' });
  assert.equal(run('stage', pending, '', { exists: false }, desired, index).status, 0);
  assert.notEqual(run('stage', pending, '', { exists: false }, desired, index).status, 0);
  const staged = info(pending);
  fs.chmodSync(path.join(root, target), 0o640);
  assert.notEqual(run('publish', target, pending, before, staged).status, 0);
  assert.equal(info(pending).ino, staged.ino);
  fs.chmodSync(path.join(root, target), 0o600);
  assert.equal(run('publish', target, pending, before, staged).status, 0);
  assert.equal(info(target).ino, staged.ino);
  assert.equal(info(target).sha256, digest(index));
  const foreign = { ...info(target), ino: '9999' };
  assert.notEqual(run('remove', target, '', foreign, {}).status, 0);
  assert.equal(run('remove', target, '', info(target), {}).status, 0);
  assert.equal(fs.existsSync(path.join(root, target)), false);
});

test('real container shell stages through a fixed FD and refuses replaced target/stage metadata', async t => {
  const root = fs.mkdtempSync(path.join(tmpdir(), 'notification-container-shell-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'static/css'), { recursive: true });
  fs.writeFileSync(path.join(root, 'index.html'), originalIndex, { mode: 0o600 });
  const io = createNotificationActualIo({ expectedRuntime: { id: notificationSeals.container } },
    (program, args, options) => {
      assert.equal(program, 'docker');
      const script = args[args.indexOf('sh') + 2];
      return spawnSync('/bin/sh', ['-c', script, 'private-notification-shell', root, args.at(-1)], {
        input: options.input, maxBuffer: 128 * 1024,
      });
    });
  const original = await io.read('container', 'index.html');
  const compact = file => ({ ...file, bytes: file.bytes.length, sha256: digest(file.bytes) });
  const before = compact(original);
  const pending = notificationPending('index.html', epoch);
  const desired = { exists: true, uid: before.uid, gid: before.gid, mode: before.mode,
    bytes: index.length, sha256: digest(index) };
  await io.stage('container', pending, index, desired);
  await assert.rejects(io.stage('container', pending, index, desired));
  const staged = compact(await io.read('container', pending));
  fs.chmodSync(path.join(root, 'index.html'), 0o640);
  await assert.rejects(io.publish('container', pending, 'index.html', before, staged));
  fs.chmodSync(path.join(root, 'index.html'), Number.parseInt(before.mode, 8));
  await io.publish('container', pending, 'index.html', before, staged);
  const published = compact(await io.read('container', 'index.html'));
  assert.equal(published.ino, staged.ino);
  assert.equal(published.sha256, notificationSeals.index);
  await assert.rejects(io.remove('container', 'index.html', { ...published, ino: '99999' }));
  await io.remove('container', 'index.html', published);
  assert.deepEqual(await io.read('container', 'index.html'), { exists: false });
});

test('a failed lost-response readback preserves the initiating error and retains unknown files', async () => {
  const f = fixture(), plan = await f.prepare();
  let failed = false;
  f.hooks.afterPublish = (scope, pending, relative) => {
    if (!failed && scope === 'container' && relative === 'index.html') {
      failed = true;
      f.hooks.read = currentScope => { if (currentScope === 'container') throw new Error('readback unavailable'); };
      throw new Error('original lost publish response');
    }
  };
  await assert.rejects(f.apply(plan), error => {
    assert.equal(error.evidence.error, 'original lost publish response');
    assert.equal(error.evidence.recoveryStatus, 'INCOMPLETE-RETAINED-FOR-REVIEW');
    return true;
  });
  assert.ok(f.events.some(item => item.stage === 'uncertain-publish-readback' &&
    item.actual.readbackError === 'readback unavailable'));
  for (const scope of ['host', 'container']) assert.ok(f.state.has(key(scope, notificationPaths[0])));
});

test('CLI requires explicit operation and exact apply/rollback authorization before candidate access', async () => {
  for (const args of [[], ['--apply', '--rollback'], ['--prepare', '--output', '/tmp/nope'],
    ['--apply', '--output', '/tmp/nope'], ['--rollback', '--output', '/tmp/nope']]) {
    await assert.rejects(main(args));
  }
});

test('full receipt scope/path context is excluded and missing exact inode metadata is refused', () => {
  const full = { scope: 'host', path: 'index.html', exists: true, bytes: 1, sha256: 'a'.repeat(64),
    uid: '1', gid: '1', mode: '644', dev: '2', ino: '3' };
  const normalized = normalizeNotificationFileMetadata(full);
  assert.ok(!('scope' in normalized) && !('path' in normalized));
  assert.equal(normalized.ino, '3');
  assert.throws(() => normalizeNotificationFileMetadata({ ...full, ino: undefined }));
});

test('real actual host adapter accepts full receipts for stage, index replacement and exact CSS removal', async t => {
  const root = fs.mkdtempSync(path.join(tmpdir(), 'notification-full-receipt-host-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'static/css'), { recursive: true });
  fs.writeFileSync(path.join(root, 'index.html'), index, { mode: 0o600 });
  fs.writeFileSync(path.join(root, notificationPaths[0]), css, { mode: 0o600 });
  const receipt = relative => {
    const stat = fs.statSync(path.join(root, relative), { bigint: true });
    const bytes = fs.readFileSync(path.join(root, relative));
    return { scope: 'host', path: relative, exists: true, bytes: bytes.length, sha256: digest(bytes),
      uid: String(stat.uid), gid: String(stat.gid), mode: (stat.mode & 0o7777n).toString(8),
      dev: String(stat.dev), ino: String(stat.ino) };
  };
  const io = createNotificationActualIo({ expectedRuntime: { id: notificationSeals.container } }, (program, args, options) => {
    assert.equal(program, process.execPath);
    const redirected = [...args];
    redirected[2] = root;
    return spawnSync(program, redirected, { input: options.input, maxBuffer: 128 * 1024 });
  });
  const before = receipt('index.html'), pending = notificationPending('index.html', epoch, true);
  await io.stage('host', pending, originalIndex, { ...before, bytes: originalIndex.length, sha256: digest(originalIndex) });
  const staged = receipt(pending);
  await io.publish('host', pending, 'index.html', before, staged);
  assert.equal(receipt('index.html').ino, staged.ino);
  assert.equal(receipt('index.html').sha256, notificationSeals.originalIndex);
  const cssReceipt = receipt(notificationPaths[0]);
  await assert.rejects(io.remove('host', notificationPaths[0], { ...cssReceipt, ino: '99999' }));
  await io.remove('host', notificationPaths[0], cssReceipt);
  assert.equal(fs.existsSync(path.join(root, notificationPaths[0])), false);
});

test('deployment and frozen recovery tools share one exclusive lock and retain replaced lock files', t => {
  const root = fs.mkdtempSync(path.join(tmpdir(), 'notification-shared-writer-lock-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const filename = path.join(root, 'shared.lock');
  const deploy = acquireNotificationDeploymentLock(filename);
  assert.throws(() => acquireNotificationRecoveryLock(filename), /EEXIST/);
  deploy.release();
  const recovery = acquireNotificationRecoveryLock(filename);
  assert.throws(() => acquireNotificationDeploymentLock(filename), /EEXIST/);
  recovery.release();
  const replaced = acquireNotificationDeploymentLock(filename);
  fs.unlinkSync(filename);
  fs.writeFileSync(filename, 'foreign', { mode: 0o600 });
  assert.throws(() => replaced.assertHeld());
  assert.throws(() => replaced.release());
  assert.equal(fs.readFileSync(filename, 'utf8'), 'foreign');
});

test('missing trusted writer acknowledgement or lost lock refuses apply and rollback mutations', async () => {
  for (const change of ['window', 'lock']) {
    const f = fixture(), plan = await f.prepare();
    if (change === 'lock') f.hooks.lock = () => { throw new Error('shared lock drift'); };
    await assert.rejects(applyNotificationDeployment({ plan, sealed: f.sealed, io: f.io, journal: f.journal, lock: f.lock,
      expectedEpoch: epoch, expectedPlanSha256: jsonDigest(plan), trustedExclusiveWriterWindow: change === 'window' ? undefined : true }),
    error => error.evidence.status === 'REFUSED-BEFORE-MUTATION');
    assert.equal(f.mutating().length, 0);
  }
  const f = fixture(), plan = await f.prepare(), applied = await f.apply(plan), before = f.mutating().length;
  await assert.rejects(f.rollback(plan, applied, { trustedExclusiveWriterWindow: undefined }),
    error => error.evidence.status === 'REFUSED-ROLLBACK-BEFORE-MUTATION');
  assert.equal(f.mutating().length, before);
});
