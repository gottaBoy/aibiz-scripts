import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  languageDeploymentSeals, languagePending, loadLanguageDeploymentCandidate,
  mutateLanguageDeployment, prepareLanguageDeployment,
} from '../deploy-existing-plm-language-runtime.mjs';

const workspace = path.resolve(new URL('../..', import.meta.url).pathname);
const sealedInput = loadLanguageDeploymentCandidate(path.join(workspace, '.artifacts/plm-language-runtime-20261124-r4'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const jsonDigest = value => digest(Buffer.from(`${JSON.stringify(value, null, 2)}\n`));
const epoch = '12345678-1234-4234-8234-123456789abc';
const key = (scope, relative) => `${scope}:${relative}`;
function fixture() {
  const calls = [], state = new Map(), events = [], hooks = {}, records = new Map();
  let inode = 100;
  const metadata = (scope, bytes, extra = {}) => ({ exists: true, bytes: Buffer.from(bytes),
    uid: scope === 'host' ? '1000' : '101', gid: scope === 'host' ? '1000' : '101',
    mode: scope === 'host' ? '664' : '644', dev: scope === 'host' ? '1' : '2', ino: String(++inode), ...extra });
  for (const scope of ['host', 'container']) {
    state.set(key(scope, 'index.html'), metadata(scope, sealedInput.originalIndex));
    state.set(key(scope, sealedInput.manifest.activeOriginalEntries.importMap), metadata(scope, sealedInput.originalMap));
  }
  const compact = file => file ? { ...Object.fromEntries(['exists', 'uid', 'gid', 'mode', 'dev', 'ino'].map(field => [field, file[field]])),
    bytes: file.bytes.length, sha256: digest(file.bytes) } : { exists: false };
  const observation = { id: languageDeploymentSeals.container, restartCount: 0, nginx: 'original' };
  const preserved = { host: 'includes-existing-assets-plugins-plmwiki', container: 'includes-active-old-map' };
  const journal = { bytes(name, bytes) { assert.ok(!records.has(name)); records.set(name, bytes); },
    fixed(name, value) { hooks.fixed?.(name); assert.ok(!records.has(name)); records.set(name, structuredClone(value)); },
    event(stage, data) { events.push({ stage, ...structuredClone(data) }); } };
  const lock = { witness: { path: '/private/shared-lock' }, assertHeld() { hooks.lock?.(); } };
  const sealed = { ...sealedInput, verifySources() { hooks.sources?.(); } };
  const io = {
    async observe() { hooks.observe?.(); return structuredClone(observation); },
    async preserve() { hooks.preserve?.(); return structuredClone(preserved); },
    async read(scope, relative) {
      hooks.read?.(scope, relative);
      const value = state.get(key(scope, relative));
      return value ? { ...value, bytes: Buffer.from(value.bytes) } : { exists: false };
    },
    async stage(scope, relative, bytes, desired) {
      calls.push({ method: 'stage', scope, path: relative });
      assert.ok(!state.has(key(scope, relative)));
      hooks.beforeStage?.(scope, relative);
      state.set(key(scope, relative), metadata(scope, bytes, { uid: desired.uid, gid: desired.gid, mode: desired.mode }));
      hooks.afterStage?.(scope, relative);
    },
    async publish(scope, pending, relative, before, staged) {
      calls.push({ method: 'publish', scope, path: relative });
      hooks.beforePublish?.(scope, pending, relative);
      assert.deepEqual(compact(state.get(key(scope, relative))), before);
      const source = state.get(key(scope, pending));
      assert.deepEqual(compact(source), staged);
      state.set(key(scope, relative), source);
      state.delete(key(scope, pending));
      hooks.afterPublish?.(scope, pending, relative);
    },
    async remove(scope, relative, expected) {
      calls.push({ method: 'remove', scope, path: relative });
      assert.deepEqual(compact(state.get(key(scope, relative))), expected);
      state.delete(key(scope, relative));
      hooks.afterRemove?.(scope, relative);
    },
    async http(relative) {
      const response = { status: 200, bytes: Buffer.from(state.get(key('container', relative)).bytes) };
      return hooks.http?.(relative, response) ?? response;
    },
  };
  const freshJournal = () => {
    const saved = new Map();
    return { bytes() {}, fixed(name, value) { hooks.fixed?.(name); assert.ok(!saved.has(name)); saved.set(name, value); },
      event(stage, value) { events.push({ stage, ...value }); } };
  };
  return { calls, state, events, hooks, records, observation, preserved, sealed, io, journal, lock, metadata,
    prepare: () => prepareLanguageDeployment({ sealed, io, journal, lock, epoch }),
    apply: (plan, overrides = {}) => mutateLanguageDeployment({ plan, sealed, io, journal: freshJournal(), lock,
      expectedEpoch: epoch, expectedPlanSha256: jsonDigest(plan), trustedExclusiveWriterWindow: true, ...overrides }),
    rollback: (plan, applied, overrides = {}) => mutateLanguageDeployment({ plan, sealed, io, journal: freshJournal(), lock,
      expectedEpoch: epoch, expectedPlanSha256: jsonDigest(plan), trustedExclusiveWriterWindow: true,
      rollback: true, appliedReport: applied, expectedApplySha256: jsonDigest(applied), ...overrides }),
  };
}

test('sealed r4 sources and all eighteen outputs are verified, with only new paths and index eligible', () => {
  assert.equal(sealedInput.files.length, 18);
  assert.equal(sealedInput.manifestSha256, languageDeploymentSeals.manifest);
  assert.ok(sealedInput.files.every(item => item.path === 'index.html' || item.path.startsWith('extras/')));
  assert.equal(sealedInput.manifest.activeOriginalEntries.appEntry, 'static/js/index-legacy-d5b42c12.js');
  assert.throws(() => languagePending('../outside', epoch));
});
test('the published caption receipt stays sealed while later source changes forbid redeploying that candidate', () => {
  const directory = path.join(workspace, '.artifacts/plm-caption-entry-candidate-20261124-r2');
  const bytes = fs.readFileSync(path.join(directory, 'caption-entry-candidate.private.json'));
  assert.equal(digest(bytes), languageDeploymentSeals.captionManifest);
  const manifest = JSON.parse(bytes);
  assert.equal(manifest.files.length, 2);
  assert.equal(manifest.files[0].path, 'static/js/index-legacy-27013305.js');
  assert.equal(manifest.mapPath, 'extras/json/system-import-language-85bb771e88717181.json');
  assert.equal(manifest.inherited.length, 3148);
  assert.equal(manifest.originalIndexSha256, languageDeploymentSeals.newIndex);
  for (const file of manifest.files) {
    assert.equal(digest(fs.readFileSync(path.join(directory, 'overlay', file.path))), file.sha256);
  }
  assert.throws(() => loadLanguageDeploymentCandidate(directory), { code: 'ERR_ASSERTION' });
});
test('the current layout candidate changes only its source CSS and index while retaining application entries', () => {
  const layout = loadLanguageDeploymentCandidate(path.join(workspace,
    '.artifacts/plm-view-theme-layout-candidate-20261124-r1'));
  assert.equal(layout.manifestSha256, languageDeploymentSeals.layoutManifest);
  assert.equal(layout.files.length, 2);
  assert.equal(layout.files[0].path, 'static/css/plm-view-theme-8d775a21c79771cb.css');
  assert.equal(layout.manifest.originalIndexSha256, languageDeploymentSeals.captionIndex);
  const css = layout.payload.get(layout.files[0].path).toString();
  assert.match(css, /^@media \(max-width: 767px\)/);
  assert.ok(!css.includes('url('));
  assert.equal(layout.payload.get('index.html').toString().replace(
    `  <link rel="stylesheet" href="./${layout.files[0].path}">\n  </head>`, '</head>'),
  layout.originalIndex.toString());
});
test('prepare writes only private backups/source/payload records, preserves old map and all other inputs', async () => {
  const f = fixture(), plan = await f.prepare();
  assert.equal(plan.status, 'PREPARED-NOT-APPLIED');
  assert.equal(plan.files.length, 18);
  assert.equal(f.calls.length, 0);
  assert.ok(f.records.has('backup/host/index.html'));
  assert.ok(f.records.has('preserved.private.json'));
  assert.equal(plan.concurrency.atomicCompareAndSwapClaimed, false);
});
test('apply publishes thirty-four new files with the new map after modules, and switches both indexes last', async () => {
  const f = fixture(), plan = await f.prepare(), applied = await f.apply(plan);
  assert.equal(applied.status, 'APPLIED-STATIC-BUSINESS-ACCEPTANCE-PENDING');
  assert.equal(applied.mutations.length, 36);
  const published = f.calls.filter(item => item.method === 'publish');
  assert.deepEqual(published.slice(-4).map(item => [item.scope, item.path]), [
    ['host', sealedInput.manifest.mapPath], ['container', sealedInput.manifest.mapPath],
    ['host', 'index.html'], ['container', 'index.html'],
  ]);
  assert.ok(f.state.has(key('host', sealedInput.manifest.activeOriginalEntries.importMap)));
});
test('missing epoch/hash/window, source drift, lifecycle or preserved graph changes refuse writes', async () => {
  for (const kind of ['epoch', 'hash', 'window', 'source', 'lifecycle', 'preserved', 'lock']) {
    const f = fixture(), plan = await f.prepare(), changes = {};
    if (kind === 'epoch') changes.expectedEpoch = undefined;
    if (kind === 'hash') changes.expectedPlanSha256 = '0'.repeat(64);
    if (kind === 'window') changes.trustedExclusiveWriterWindow = false;
    if (kind === 'source') f.hooks.sources = () => { throw new Error('source changed'); };
    if (kind === 'lifecycle') f.observation.restartCount++;
    if (kind === 'preserved') f.preserved.host = 'changed';
    if (kind === 'lock') f.hooks.lock = () => { throw new Error('lock lost'); };
    await assert.rejects(f.apply(plan, changes), error => error.evidence.status === 'REFUSED-BEFORE-MUTATION');
    assert.equal(f.calls.length, 0, kind);
  }
});
test('existing new target, old index drift or stale epoch stage refuses preparation', async () => {
  for (const kind of ['target', 'index', 'stage']) {
    const f = fixture();
    const relative = kind === 'target' ? sealedInput.files[0].path
      : kind === 'stage' ? languagePending('index.html', epoch) : 'index.html';
    f.state.set(key('host', relative), f.metadata('host', Buffer.from('unknown')));
    await assert.rejects(f.prepare());
    assert.equal(f.calls.length, 0);
  }
});
test('failed durable intent refuses every write', async () => {
  const f = fixture(), plan = await f.prepare();
  f.hooks.fixed = name => { if (name === 'apply-intent.private.json') throw new Error('fsync failed'); };
  await assert.rejects(f.apply(plan), error => error.evidence.status === 'REFUSED-BEFORE-MUTATION');
  assert.equal(f.calls.length, 0);
});
test('lost final index rename response is read back and restores both exact indexes before new file cleanup', async () => {
  const f = fixture(), plan = await f.prepare();
  let failed = false;
  f.hooks.afterPublish = (scope, pending, relative) => {
    if (!failed && scope === 'container' && relative === 'index.html') { failed = true; throw new Error('rename response lost'); }
  };
  await assert.rejects(f.apply(plan), error => {
    assert.equal(error.evidence.recoveryStatus, 'BOTH-ORIGINAL-INDEXES-RESTORED-OWNED-NEW-FILES-REMOVED');
    assert.equal(error.evidence.transportErrors[0].committed, true);
    return true;
  });
  assert.equal(f.state.size, 4);
  for (const scope of ['host', 'container']) assert.deepEqual(f.state.get(key(scope, 'index.html')).bytes, sealedInput.originalIndex);
});
test('unverified interrupted stage or drifted index remains, and CSS/dependencies are never deleted under an unknown index', async () => {
  for (const kind of ['stage', 'index']) {
    const f = fixture(), plan = await f.prepare();
    if (kind === 'stage') f.hooks.beforeStage = (scope, relative) => {
      f.state.set(key(scope, relative), f.metadata(scope, Buffer.from('partial')));
      throw new Error('upload interrupted');
    };
    else f.hooks.http = () => {
      f.state.set('container:index.html', f.metadata('container', sealedInput.payload.get('index.html')));
      return { status: 503, bytes: Buffer.alloc(0) };
    };
    await assert.rejects(f.apply(plan), error => error.evidence.recoveryStatus === 'INCOMPLETE-RETAINED');
    if (kind === 'stage') assert.equal(f.calls.filter(item => item.method === 'remove').length, 0);
    else assert.ok(f.state.has(key('container', sealedInput.files[0].path)));
  }
});
test('explicit rollback binds the successful receipt and restores both indexes before exact new files removal', async () => {
  const f = fixture(), plan = await f.prepare(), applied = await f.apply(plan);
  const result = await f.rollback(plan, applied);
  assert.equal(result.status, 'ROLLED-BACK-EXACT-EPOCH');
  assert.equal(f.state.size, 4);
  assert.equal(f.calls.filter(item => item.method === 'remove').length, 34);
  const count = f.calls.length;
  await assert.rejects(f.rollback(plan, applied), error => error.evidence.status === 'REFUSED-BEFORE-MUTATION');
  assert.equal(f.calls.length, count);
});
test('modified apply receipt or new foreign inode blocks all explicit rollback writes', async () => {
  for (const kind of ['receipt', 'inode']) {
    const f = fixture(), plan = await f.prepare(), applied = await f.apply(plan), count = f.calls.length;
    if (kind === 'inode') f.state.get('host:index.html').ino = '99999';
    await assert.rejects(f.rollback(plan, applied, kind === 'receipt' ? { expectedApplySha256: '0'.repeat(64) } : {}),
      error => error.evidence.status === 'REFUSED-BEFORE-MUTATION');
    assert.equal(f.calls.length, count);
  }
});
