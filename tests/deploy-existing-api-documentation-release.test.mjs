import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  compactDocumentationFile, documentationPending, prepareApiDocumentationInstall, mutateApiDocumentation,
} from '../deploy-existing-api-documentation-release.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const epoch = '12345678-1234-4234-8234-123456789abc';
const key = (scope, relative) => `${scope}:${relative}`;
function fixture() {
  let inode = 100;
  const state = new Map(), directories = new Map(), calls = [], events = [], hooks = {};
  const parents = Object.fromEntries(['host', 'container'].map(scope => [scope,
    { uid: scope === 'host' ? '1000' : '101', gid: scope === 'host' ? '1000' : '101', mode: '755', dev: '1', ino: scope === 'host' ? '11' : '12' }]));
  const metadata = (scope, bytes, desired = {}) => ({ exists: true, bytes: Buffer.from(bytes),
    uid: parents[scope].uid, gid: parents[scope].gid, mode: '664', dev: parents[scope].dev,
    ino: String(++inode), ...desired });
  const payload = new Map([['api-reference/en/search.json', Buffer.from('new-index')],
    ['css/main.css', Buffer.from('new-style')], ['index.html', Buffer.from('new-html')]]);
  const originals = new Map(), delta = {};
  for (const scope of ['host', 'container']) {
    delta[scope] = [...payload].map(([relative, bytes]) => {
      const previous = relative.startsWith('api-reference/') ? { exists: false }
        : metadata(scope, `original-${relative}`);
      if (previous.exists) {
        state.set(key(scope, relative), previous);
        originals.set(key(scope, relative), Buffer.from(previous.bytes));
      }
      return { path: relative, previous: compactDocumentationFile(previous),
        candidate: { bytes: bytes.length, sha256: hash(bytes) } };
    });
    state.set(key(scope, 'module/original.md'), metadata(scope, 'untouched-data-model'));
  }
  const sealed = {
    directory: '/private/release', sha256: 'a'.repeat(64), payload,
    release: { runtime: { id: 'fixed-container', image: 'fixed-image' }, prefix: '/ibizplm-plmweb/doc/', delta },
    verify() { hooks.source?.(); },
    original: (scope, relative) => originals.get(key(scope, relative)),
  };
  const journal = () => {
    const names = new Set();
    return { bytes(name) { assert.ok(!names.has(name)); names.add(name); },
      fixed(name, value) { assert.ok(!names.has(name)); names.add(name); events.push({ stage: name, value }); },
      event(stage, value) { events.push({ stage, ...structuredClone(value) }); } };
  };
  const lock = { witness: { path: '/private/shared-lock' }, assertHeld() { hooks.lock?.(); } };
  const io = {
    async observe() { return hooks.observe?.() ?? structuredClone(sealed.release.runtime); },
    async rootMetadata() { return structuredClone(parents); },
    async preserve() {
      return hooks.preserve?.() ?? Object.fromEntries(['host', 'container'].map(scope =>
        [scope, hash(state.get(key(scope, 'module/original.md')).bytes)]));
    },
    async read(scope, relative) {
      hooks.read?.(scope, relative);
      const file = state.get(key(scope, relative));
      return file ? { ...file, bytes: Buffer.from(file.bytes) } : { exists: false };
    },
    async ensureParents(scope, relative) {
      hooks.beforeParents?.(scope, relative);
      if (!relative.startsWith('api-reference/')) return [];
      const name = key(scope, 'api-reference/en');
      if (directories.has(name)) return [];
      const row = { scope, path: 'api-reference/en', ...parents[scope], ino: String(++inode) };
      directories.set(name, row);
      return [row];
    },
    async stage(scope, relative, bytes, desired) {
      calls.push({ method: 'stage', scope, path: relative });
      assert.equal(state.has(key(scope, relative)), false);
      state.set(key(scope, relative), metadata(scope, bytes, { uid: desired.uid, gid: desired.gid, mode: desired.mode }));
      hooks.afterStage?.(scope, relative);
    },
    async publish(scope, pending, relative, before, staged) {
      calls.push({ method: 'publish', scope, path: relative });
      hooks.beforePublish?.(scope, relative);
      assert.deepEqual(compactDocumentationFile(state.get(key(scope, relative)) ?? { exists: false }), before);
      const value = state.get(key(scope, pending));
      assert.deepEqual(compactDocumentationFile(value), staged);
      state.set(key(scope, relative), value); state.delete(key(scope, pending));
      hooks.afterPublish?.(scope, relative);
    },
    async remove(scope, relative, expected) {
      calls.push({ method: 'remove', scope, path: relative });
      assert.deepEqual(compactDocumentationFile(state.get(key(scope, relative))), expected);
      state.delete(key(scope, relative));
      hooks.afterRemove?.(scope, relative);
    },
    async removeEmptyDirectory(row) {
      assert.deepEqual(directories.get(key(row.scope, row.path)), row);
      assert.equal([...state.keys()].some(name => name.startsWith(key(row.scope, `${row.path}/`))), false);
      directories.delete(key(row.scope, row.path));
    },
    async http(relative) {
      const value = { status: 200, bytes: Buffer.from(state.get(key('container', relative)).bytes) };
      return hooks.http?.(relative, value) ?? value;
    },
  };
  const originalBytes = (scope, relative) => originals.get(key(scope, relative));
  return { state, calls, events, hooks, directories, metadata, payload, originals, sealed, io, lock,
    prepare: () => prepareApiDocumentationInstall({ sealed, io, journal: journal(), lock, epoch }),
    apply: (plan, extra = {}) => mutateApiDocumentation({ plan, sealed, io, journal: journal(), lock,
      expectedPlanSha256: hash(json(plan)), trustedExclusiveWriterWindow: true, originalBytes, ...extra }),
    rollback: (plan, appliedReport, extra = {}) => mutateApiDocumentation({ plan, sealed, io, journal: journal(), lock,
      expectedPlanSha256: hash(json(plan)), trustedExclusiveWriterWindow: true, originalBytes,
      rollback: true, appliedReport, expectedApplySha256: hash(json(appliedReport)), ...extra }),
  };
}

test('preparation snapshots existing bytes, checks absence, holds the shared lock and performs no writes', async () => {
  const f = fixture(), plan = await f.prepare();
  assert.equal(plan.status, 'PREPARED-NOT-APPLIED');
  assert.equal(plan.targets.host.length, 3);
  assert.ok(plan.sourceSeal.some(source => source.path.endsWith('deploy-existing-api-documentation-release.test.mjs')));
  assert.deepEqual(f.calls, []);
  assert.equal(f.directories.size, 0);
});

test('exact delta publication installs all dependencies before either document index and verifies served bytes', async () => {
  const f = fixture(), plan = await f.prepare(), result = await f.apply(plan);
  assert.equal(result.status, 'APPLIED-STATIC-DOCUMENTATION-NATIVE-ACCEPTANCE-PENDING');
  assert.equal(result.parentAcceptance, false);
  const writes = f.calls.filter(call => call.method === 'publish');
  assert.deepEqual(writes.slice(-2).map(call => `${call.scope}:${call.path}`), ['host:index.html', 'container:index.html']);
  assert.ok(writes.slice(0, -2).every(call => call.path !== 'index.html'));
  for (const row of result.ledger) assert.equal(row.installed, true);
  assert.equal(f.state.get('host:css/main.css').mode, '664');
  assert.equal(f.state.get('host:api-reference/en/search.json').mode, '644');
});

test('only a matching apply receipt permits exact rollback and owned empty directory cleanup', async () => {
  const f = fixture(), plan = await f.prepare(), applied = await f.apply(plan);
  const result = await f.rollback(plan, applied);
  assert.equal(result.status, 'ROLLED-BACK-EXACT-DOCUMENTATION');
  assert.equal(f.directories.size, 0);
  for (const scope of ['host', 'container']) {
    assert.equal(f.state.has(key(scope, 'api-reference/en/search.json')), false);
    assert.equal(f.state.get(key(scope, 'index.html')).bytes.toString(), 'original-index.html');
    assert.equal(f.state.get(key(scope, 'css/main.css')).bytes.toString(), 'original-css/main.css');
  }
});

test('an uncertain successful rename is recorded and recovered using the verified staged inode', async () => {
  const f = fixture(), plan = await f.prepare();
  let failed = false;
  f.hooks.afterPublish = (_scope, relative) => {
    if (!failed && relative === 'css/main.css') { failed = true; throw new Error('lost transport response'); }
  };
  const result = await f.apply(plan);
  assert.equal(result.status, 'FAILED-MUTATION-CONDITIONAL-RECOVERY');
  assert.equal(result.transportErrors[0].committed, true);
  assert.equal(result.recoveryVerified, true);
  assert.equal(f.state.get('host:css/main.css').bytes.toString(), 'original-css/main.css');
  assert.equal(f.state.has('host:api-reference/en/search.json'), false);
  assert.ok(f.events.some(event => event.stage === 'uncertain-publication'));
});

test('a later HTTP mismatch restores indexes and original style before removing exact owned new files', async () => {
  const f = fixture(), plan = await f.prepare();
  f.hooks.http = (_path, result) => ({ ...result, bytes: Buffer.from('unexpected-live-bytes') });
  const report = await f.apply(plan);
  assert.equal(report.status, 'FAILED-MUTATION-CONDITIONAL-RECOVERY');
  assert.equal(report.recoveryVerified, true);
  assert.ok(report.recovery.slice(0, 2).every(row => row.path === 'index.html'));
  assert.equal(f.directories.size, 0);
});

test('a foreign index is retained and prevents new dependency deletion during rollback', async () => {
  const f = fixture(), plan = await f.prepare(), applied = await f.apply(plan);
  f.state.set('container:index.html', f.metadata('container', 'foreign-document-index'));
  const result = await f.rollback(plan, applied);
  assert.equal(result.status, 'FAILED-MUTATION-CONDITIONAL-RECOVERY');
  assert.equal(f.state.get('container:index.html').bytes.toString(), 'foreign-document-index');
  assert.equal(f.state.has('container:api-reference/en/search.json'), true);
  assert.ok(result.recovery.some(row => row.status === 'RETAINED'));
});

test('an uncertain stage without a verified inode is retained instead of being guessed as owned', async () => {
  const f = fixture(), plan = await f.prepare();
  f.hooks.afterStage = () => { throw new Error('stage response lost'); };
  const result = await f.apply(plan);
  assert.equal(result.recoveryVerified, false);
  assert.ok(result.recovery.some(row => row.status === 'RETAINED-UNCERTAIN-STAGE'));
  assert.ok(f.state.has(key('host', documentationPending('api-reference/en/search.json', epoch))));
});

test('parent creation has a durable intent and an uncertain result never reports full recovery', async () => {
  const f = fixture(), plan = await f.prepare();
  f.hooks.beforeParents = () => { throw new Error('directory command response lost'); };
  const result = await f.apply(plan);
  assert.equal(result.recoveryVerified, false);
  assert.ok(f.events.some(event => event.stage === 'before-parent-creation'));
  assert.ok(result.recovery.some(row => row.status === 'RETAINED-UNCERTAIN-PARENTS'));
});

test('a changed target list cannot expand the approved release delta even with a matching edited plan digest', async () => {
  const f = fixture(), plan = await f.prepare();
  plan.targets.host[0].path = 'module/original.md';
  const result = await f.apply(plan);
  assert.equal(result.status, 'REFUSED-BEFORE-MUTATION');
  assert.deepEqual(f.calls, []);
});

for (const [name, change] of [
  ['missing exclusive writer acknowledgement', f => ({ trustedExclusiveWriterWindow: false })],
  ['changed plan digest', f => ({ expectedPlanSha256: '0'.repeat(64) })],
  ['damaged rollback backup', f => ({ originalBytes: () => Buffer.from('damaged-backup') })],
  ['source drift', f => { f.hooks.source = () => { throw new Error('source changed'); }; return {}; }],
  ['runtime drift', f => { f.hooks.observe = () => ({ id: 'replaced' }); return {}; }],
  ['lock lost', f => { f.hooks.lock = () => { throw new Error('lock lost'); }; return {}; }],
]) test(`${name} refuses before any file stage or directory creation`, async () => {
  const f = fixture(), plan = await f.prepare(), extra = change(f);
  const result = await f.apply(plan, extra);
  assert.equal(result.status, 'REFUSED-BEFORE-MUTATION');
  assert.deepEqual(f.calls, []);
  assert.equal(f.directories.size, 0);
});

test('modified rollback receipt cannot authorize a second mutation', async () => {
  const f = fixture(), plan = await f.prepare(), applied = await f.apply(plan);
  const calls = f.calls.length;
  const result = await f.rollback(plan, applied, { expectedApplySha256: '0'.repeat(64) });
  assert.equal(result.status, 'REFUSED-BEFORE-MUTATION');
  assert.equal(f.calls.length, calls);
});

test('pending paths cannot escape the document root or share an unbounded epoch', () => {
  for (const relative of ['../index.html', '/index.html', 'api-reference/../index.html', 'x\\y']) {
    assert.throws(() => documentationPending(relative, epoch));
  }
  assert.throws(() => documentationPending('index.html', 'wrong'));
});
