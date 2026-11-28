import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  assertLanguageDeploymentCandidateApproval, languagePending,
  mutateLanguageDeployment, prepareLanguageDeployment,
} from '../deploy-existing-plm-language-runtime.mjs';
import { rewriteDevelopmentLayoutIndex } from '../prepare-plm-development-layout.mjs';

const workspace = path.resolve(new URL('../..', import.meta.url).pathname);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const epoch = '12345678-1234-4234-8234-123456789abc';
const key = (scope, relative) => `${scope}:${relative}`;
function fixture() {
  const originalMap = json({ imports: { '@ibiz-template/runtime': '../same-runtime.js' } });
  const originalIndex = Buffer.from('<!doctype html><html><head>' +
    '<script type="systemjs-importmap" src="./extras/json/current.json"></script></head><body>' +
    '<script id="vite-legacy-entry" data-src="./static/js/current.js"></script></body></html>');
  const css = fs.readFileSync(path.join(workspace, 'plm-web/src/runtime/development-layout.css'));
  const revision = digest(css).slice(0, 16);
  const cssPath = `static/css/plm-development-layout-${revision}.css`;
  const payload = new Map([[cssPath, css], ['index.html', rewriteDevelopmentLayoutIndex(originalIndex, cssPath)]]);
  const files = [...payload].map(([relative, bytes]) => ({ path: relative, bytes: bytes.length, sha256: digest(bytes) }));
  const manifest = { contract: 'plm-development-layout-candidate-v1', status: 'PREPARED-NOT-PUBLISHED',
    revision, cssPath, files, originalIndexSha256: digest(originalIndex), originalMapSha256: digest(originalMap),
    activeOriginalEntries: { importMap: 'extras/json/current.json', appEntry: 'static/js/current.js' },
    mobileOnly: true, runtimeRebuild: false, originalApplicationEntryPreserved: true,
    originalImportMapPreserved: true };
  const approval = { contract: manifest.contract, manifestSha256: digest(json(manifest)) };
  const hooks = {}, state = new Map(), calls = [], events = [];
  let inode = 100;
  const metadata = bytes => ({ exists: true, bytes: Buffer.from(bytes), uid: '1000', gid: '1000',
    mode: '644', dev: '1', ino: String(++inode) });
  for (const scope of ['host', 'container']) {
    state.set(key(scope, 'index.html'), metadata(originalIndex));
    state.set(key(scope, manifest.activeOriginalEntries.importMap), metadata(originalMap));
  }
  const sealed = { manifest, payload, files, originalIndex, originalMap, directory: '/private/candidate',
    manifestSha256: approval.manifestSha256, verifySources() { hooks.sources?.(); } };
  const compact = row => row ? { ...row, bytes: row.bytes.length, sha256: digest(row.bytes) } : { exists: false };
  const observation = { container: 'fixed', restartCount: 0 };
  const preserved = { oldMap: 'fixed', runtime: 'fixed', docs: 'fixed', models: 'fixed' };
  const io = {
    async read(scope, relative) {
      const value = state.get(key(scope, relative));
      return value ? { ...value, bytes: Buffer.from(value.bytes) } : { exists: false };
    },
    async observe() { return structuredClone(observation); },
    async preserve() { return structuredClone(preserved); },
    async stage(scope, relative, bytes) {
      hooks.beforeStage?.(scope, relative);
      calls.push({ method: 'stage', scope, relative });
      assert.equal(state.has(key(scope, relative)), false);
      state.set(key(scope, relative), metadata(bytes));
    },
    async publish(scope, pending, relative, before, staged) {
      assert.deepEqual(compact(state.get(key(scope, relative))), before);
      const source = state.get(key(scope, pending));
      assert.deepEqual(compact(source), staged);
      state.set(key(scope, relative), source);
      state.delete(key(scope, pending));
      calls.push({ method: 'publish', scope, relative });
      hooks.afterPublish?.(scope, relative);
    },
    async remove(scope, relative, expected) {
      assert.deepEqual(compact(state.get(key(scope, relative))), expected);
      state.delete(key(scope, relative));
      calls.push({ method: 'remove', scope, relative });
    },
    async http(relative) {
      const response = { status: 200, bytes: Buffer.from(state.get(key('container', relative)).bytes) };
      return hooks.http?.(relative, response) ?? response;
    },
  };
  const journal = () => ({ bytes() {}, fixed(name) { hooks.fixed?.(name); },
    event(stage, value) { events.push({ stage, ...value }); } });
  const lock = { witness: { path: '/private/common-lock' }, assertHeld() { hooks.lock?.(); } };
  return { sealed, approval, state, calls, hooks, events, observation, preserved, metadata,
    prepare: () => prepareLanguageDeployment({ sealed, io, journal: journal(), lock, epoch }),
    apply: (plan, changes = {}) => mutateLanguageDeployment({ plan, sealed, io, journal: journal(), lock,
      expectedEpoch: epoch, expectedPlanSha256: digest(json(plan)), trustedExclusiveWriterWindow: true,
      developmentLayoutApproval: approval, ...changes }),
  };
}

test('development layout requires its own exact full-manifest approval and rejects lifecycle authorization', () => {
  const f = fixture();
  assertLanguageDeploymentCandidateApproval(f.sealed, undefined, f.approval);
  assert.throws(() => assertLanguageDeploymentCandidateApproval(f.sealed));
  assert.throws(() => assertLanguageDeploymentCandidateApproval(f.sealed, f.approval));
  assert.throws(() => assertLanguageDeploymentCandidateApproval(f.sealed, undefined,
    { ...f.approval, manifestSha256: '0'.repeat(64) }));
  assert.throws(() => assertLanguageDeploymentCandidateApproval(f.sealed,
    { contract: 'plm-control-lifecycle-runtime-candidate-v1', manifestSha256: f.approval.manifestSha256 }, f.approval));
  for (const contract of ['plm-language-runtime-candidate-v1', 'plm-control-lifecycle-runtime-candidate-v1']) {
    assert.throws(() => assertLanguageDeploymentCandidateApproval(
      { ...f.sealed, manifest: { ...f.sealed.manifest, contract } }, undefined, f.approval));
  }
});

test('extra files, new scripts, import-map changes and broad CSS cannot enter the narrow contract', () => {
  for (const kind of ['extra-file', 'script', 'map', 'css', 'entries']) {
    const f = fixture();
    if (kind === 'extra-file') f.sealed.files.push({ path: 'outside.js', sha256: digest('x'), bytes: 1 });
    if (kind === 'script') f.sealed.payload.set('index.html', Buffer.from('foreign application'));
    if (kind === 'map') f.sealed.payload.set('extras/json/current.json', Buffer.from('foreign map'));
    if (kind === 'css') f.sealed.payload.set(f.sealed.manifest.cssPath, Buffer.from('iframe{display:none}'));
    if (kind === 'entries') f.sealed.manifest.activeOriginalEntries.appEntry = 'foreign.js';
    assert.throws(() => assertLanguageDeploymentCandidateApproval(f.sealed, undefined, f.approval), kind);
  }
});

test('prepare writes only private records and apply publishes both CSS copies before either root index', async () => {
  const f = fixture(), plan = await f.prepare();
  assert.equal(f.calls.length, 0);
  assert.deepEqual(plan.developmentLayoutApproval, f.approval);
  assert.equal(plan.controlLifecycleApproval, undefined);
  assert.deepEqual(plan.order, ['new-development-css', 'host-index-last', 'container-index-last']);
  const applied = await f.apply(plan);
  assert.equal(applied.mutations.length, 4);
  assert.equal(applied.status, 'APPLIED-STATIC-BUSINESS-ACCEPTANCE-PENDING');
  assert.deepEqual(f.calls.filter(call => call.method === 'publish').map(call => [call.scope, call.relative]), [
    ['host', f.sealed.manifest.cssPath], ['container', f.sealed.manifest.cssPath],
    ['host', 'index.html'], ['container', 'index.html'],
  ]);
  for (const scope of ['host', 'container']) {
    assert.deepEqual(f.state.get(key(scope, f.sealed.manifest.activeOriginalEntries.importMap)).bytes,
      f.sealed.originalMap);
  }
});

test('missing approval, stale plan, epoch, lock, source or lifecycle drift rejects before every shared write', async () => {
  for (const kind of ['approval', 'plan-approval', 'epoch', 'window', 'source', 'lock', 'lifecycle', 'preserved', 'intent']) {
    const f = fixture(), plan = await f.prepare(), changes = {};
    if (kind === 'approval') changes.developmentLayoutApproval = undefined;
    if (kind === 'plan-approval') plan.developmentLayoutApproval.manifestSha256 = '0'.repeat(64);
    if (kind === 'epoch') changes.expectedEpoch = undefined;
    if (kind === 'window') changes.trustedExclusiveWriterWindow = false;
    if (kind === 'source') f.hooks.sources = () => { throw new Error('source changed'); };
    if (kind === 'lock') f.hooks.lock = () => { throw new Error('lock lost'); };
    if (kind === 'lifecycle') f.observation.restartCount++;
    if (kind === 'preserved') f.preserved.docs = 'changed';
    if (kind === 'intent') f.hooks.fixed = name => { if (name === 'apply-intent.private.json') throw new Error('fsync failed'); };
    await assert.rejects(f.apply(plan, changes), error => error.evidence.status === 'REFUSED-BEFORE-MUTATION');
    assert.equal(f.calls.length, 0, kind);
  }
});

test('lost final publication or wrong served CSS restores both indexes before removing owned stylesheets', async () => {
  for (const kind of ['rename', 'http']) {
    const f = fixture(), plan = await f.prepare();
    let failed = false;
    if (kind === 'rename') f.hooks.afterPublish = (scope, relative) => {
      if (!failed && scope === 'container' && relative === 'index.html') {
        failed = true; throw new Error('rename response lost');
      }
    };
    else f.hooks.http = (relative, response) => relative === f.sealed.manifest.cssPath && !failed
      ? (failed = true, { status: 200, bytes: Buffer.from('foreign CSS') }) : response;
    await assert.rejects(f.apply(plan), error =>
      error.evidence.recoveryStatus === 'BOTH-ORIGINAL-INDEXES-RESTORED-OWNED-NEW-FILES-REMOVED');
    assert.equal(f.state.size, 4);
    for (const scope of ['host', 'container']) {
      assert.deepEqual(f.state.get(key(scope, 'index.html')).bytes, f.sealed.originalIndex);
    }
    const removed = f.calls.findIndex(call => call.method === 'remove');
    assert.ok(f.calls.slice(0, removed).filter(call => call.method === 'publish' && call.relative === 'index.html').length >= 4);
  }
});

test('unknown partial stage and foreign inode are retained instead of guessed as owned', async () => {
  const f = fixture(), plan = await f.prepare();
  const relative = languagePending(f.sealed.files[0].path, epoch);
  f.hooks.beforeStage = (scope, pending) => {
    f.state.set(key(scope, pending), f.metadata(Buffer.from('unknown partial')));
    throw new Error('upload interrupted');
  };
  await assert.rejects(f.apply(plan), error => error.evidence.recoveryStatus === 'INCOMPLETE-RETAINED');
  assert.equal(f.state.has(key('host', relative)), true);
});

test('rollback requires the exact successful four-file epoch receipt and refuses a replaced inode', async () => {
  for (const kind of ['hash', 'inode', 'success']) {
    const f = fixture(), plan = await f.prepare(), applied = await f.apply(plan);
    const before = f.calls.length;
    if (kind === 'inode') f.state.get('host:index.html').ino = '999999';
    const operation = f.apply(plan, { rollback: true, appliedReport: applied,
      expectedApplySha256: kind === 'hash' ? '0'.repeat(64) : digest(json(applied)) });
    if (kind === 'success') {
      assert.equal((await operation).status, 'ROLLED-BACK-EXACT-EPOCH');
      assert.equal(f.state.size, 4);
    } else {
      await assert.rejects(operation, error => error.evidence.status === 'REFUSED-BEFORE-MUTATION');
      assert.equal(f.calls.length, before);
    }
  }
});
