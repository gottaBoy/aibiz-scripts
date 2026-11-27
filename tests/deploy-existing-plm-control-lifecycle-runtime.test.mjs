import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  assertLanguageDeploymentCandidateApproval, assertLanguageInheritedInventory, languagePending,
  mutateLanguageDeployment, prepareLanguageDeployment,
} from '../deploy-existing-plm-language-runtime.mjs';
import { lifecycleRuntimeMap } from '../prepare-plm-control-lifecycle-runtime.mjs';
import { rewriteGuardEntry } from '../prepare-plm-guard-overlay.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const epoch = '12345678-1234-4234-8234-123456789abc';
const key = (scope, relative) => `${scope}:${relative}`;

function fixture() {
  const originalMap = json({ imports: { '@ibiz-template/runtime': '../runtime-old.js',
    '@ibiz-template/core': '../core-old.js' }, styles: { component: '../same.css' } });
  const originalIndex = Buffer.from('<!doctype html><html><head>' +
    '<script type="systemjs-importmap" src="./extras/json/current.json"></script>' +
    '</head><body><script id="vite-legacy-entry" data-src="./static/js/current.js"></script></body></html>');
  const runtimeBytes = Buffer.from('System.register([],function(publish){return{setters:[],execute:function(){publish("Owned",1)}}});');
  const revision = digest(runtimeBytes).slice(0, 16);
  const runtimeFile = `extras/js/@ibiz-template/runtime/lifecycle-${revision}/index.system.min.js`;
  const mapPath = `extras/json/system-import-lifecycle-${revision}.json`;
  const payload = new Map([[runtimeFile, runtimeBytes],
    [mapPath, json(lifecycleRuntimeMap(JSON.parse(originalMap), revision))],
    ['index.html', Buffer.from(rewriteGuardEntry(originalIndex.toString(), {
      appEntry: './static/js/current.js', importMap: `./${mapPath}`,
    }))]]);
  const files = [...payload].map(([relative, bytes]) => ({ path: relative, bytes: bytes.length, sha256: digest(bytes) }));
  const manifest = { contract: 'plm-control-lifecycle-runtime-candidate-v1', status: 'PREPARED-NOT-PUBLISHED',
    files, revision, runtimeFile, mapPath, originalIndexSha256: digest(originalIndex), originalMapSha256: digest(originalMap),
    activeOriginalEntries: { appEntry: 'static/js/current.js', importMap: 'extras/json/current.json' } };
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
  const preserved = { oldMap: 'fixed', plugins: 'fixed', docs: 'fixed', components: 'fixed' };
  const io = {
    async read(scope, relative) {
      const value = state.get(key(scope, relative));
      return value ? { ...value, bytes: Buffer.from(value.bytes) } : { exists: false };
    },
    async observe() { return structuredClone(observation); },
    async preserve() { hooks.preserve?.(); return structuredClone(preserved); },
    async stage(scope, relative, bytes) {
      calls.push({ method: 'stage', scope, relative });
      hooks.beforeStage?.(scope, relative);
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
  const journal = () => ({ bytes() {}, fixed() {}, event(stage, value) { events.push({ stage, ...value }); } });
  const lock = { witness: { path: '/private/common-lock' }, assertHeld() { hooks.lock?.(); } };
  return { sealed, approval, state, calls, hooks, events, observation, preserved, metadata,
    prepare: () => prepareLanguageDeployment({ sealed, io, journal: journal(), lock, epoch }),
    apply: (plan, changes = {}) => mutateLanguageDeployment({ plan, sealed, io, journal: journal(), lock,
      expectedEpoch: epoch, expectedPlanSha256: digest(json(plan)), trustedExclusiveWriterWindow: true,
      controlLifecycleApproval: approval, ...changes }),
  };
}

test('the new three-file contract requires explicit full manifest approval and cannot impersonate a legacy seal', () => {
  const f = fixture();
  assertLanguageDeploymentCandidateApproval(f.sealed, f.approval);
  assert.throws(() => assertLanguageDeploymentCandidateApproval(f.sealed));
  assert.throws(() => assertLanguageDeploymentCandidateApproval(f.sealed,
    { ...f.approval, manifestSha256: '0'.repeat(64) }));
  assert.throws(() => assertLanguageDeploymentCandidateApproval(
    { ...f.sealed, manifest: { ...f.sealed.manifest, contract: 'plm-language-runtime-candidate-v1' } }, f.approval));
  const extra = { path: 'extras/js/@ibiz-template/core/foreign.js', bytes: 1, sha256: '0'.repeat(64) };
  assert.throws(() => assertLanguageDeploymentCandidateApproval(
    { ...f.sealed, files: [...f.sealed.files, extra] }, f.approval));
});

test('changing another import, a stylesheet or application entry refuses the narrow path', () => {
  for (const mutation of ['other-import', 'style', 'entry']) {
    const f = fixture(), payload = new Map(f.sealed.payload);
    if (mutation === 'entry') payload.set('index.html', Buffer.from('foreign entry'));
    else {
      const map = JSON.parse(payload.get(f.sealed.manifest.mapPath));
      if (mutation === 'other-import') map.imports['@ibiz-template/core'] = '../new-core.js';
      else map.styles.component = '../new.css';
      payload.set(f.sealed.manifest.mapPath, json(map));
    }
    assert.throws(() => assertLanguageDeploymentCandidateApproval({ ...f.sealed, payload }, f.approval));
  }
});

test('startup and live inventories must both retain the exact old runtime and direct dependency bytes', () => {
  const manifest = { contract: 'plm-control-lifecycle-runtime-candidate-v1',
    inherited: [{ path: 'extras/core.js', sha256: 'core-hash' }],
    currentRuntime: { path: 'extras/old-runtime.js', sha256: 'runtime-hash' } };
  const inventory = [...manifest.inherited, manifest.currentRuntime];
  assertLanguageInheritedInventory(manifest, { hostDist: inventory, containerDist: inventory });
  for (const scope of ['hostDist', 'containerDist']) {
    for (const changed of inventory) {
      const inventories = { hostDist: structuredClone(inventory), containerDist: structuredClone(inventory) };
      inventories[scope].find(row => row.path === changed.path).sha256 = 'foreign';
      assert.throws(() => assertLanguageInheritedInventory(manifest, inventories));
    }
  }
});

test('prepare has no shared writes and apply installs runtime, map and both indexes in order', async () => {
  const f = fixture(), plan = await f.prepare();
  assert.equal(f.calls.length, 0);
  assert.deepEqual(plan.controlLifecycleApproval, f.approval);
  assert.equal(plan.directoryInvarianceClaimed, false);
  const applied = await f.apply(plan);
  assert.equal(applied.status, 'APPLIED-STATIC-BUSINESS-ACCEPTANCE-PENDING');
  assert.equal(applied.mutations.length, 6);
  assert.deepEqual(f.calls.filter(row => row.method === 'publish').map(row => [row.scope, row.relative]),
    f.sealed.files.flatMap(file => [['host', file.path], ['container', file.path]]));
});

test('missing approval, source, lock and lifecycle drift fail before mutation', async () => {
  for (const kind of ['approval', 'source', 'lock', 'lifecycle', 'preserved']) {
    const f = fixture(), plan = await f.prepare(), changes = {};
    if (kind === 'approval') changes.controlLifecycleApproval = undefined;
    if (kind === 'source') f.hooks.sources = () => { throw new Error('source drift'); };
    if (kind === 'lock') f.hooks.lock = () => { throw new Error('lock lost'); };
    if (kind === 'lifecycle') f.observation.restartCount += 1;
    if (kind === 'preserved') f.preserved.docs = 'foreign bytes';
    await assert.rejects(f.apply(plan, changes), error => error.evidence.status === 'REFUSED-BEFORE-MUTATION');
    assert.equal(f.calls.length, 0);
  }
});

test('lost final rename and bad HTTP restore indexes before removing exact new runtime and map files', async () => {
  for (const kind of ['rename', 'http']) {
    const f = fixture(), plan = await f.prepare();
    let failed = false;
    if (kind === 'rename') f.hooks.afterPublish = (scope, relative) => {
      if (!failed && scope === 'container' && relative === 'index.html') {
        failed = true; throw new Error('lost rename response');
      }
    };
    else f.hooks.http = (relative, response) => relative === f.sealed.manifest.runtimeFile && !failed
      ? (failed = true, { status: 200, bytes: Buffer.from('bad served bytes') }) : response;
    await assert.rejects(f.apply(plan), error => {
      assert.equal(error.evidence.recoveryStatus, 'BOTH-ORIGINAL-INDEXES-RESTORED-OWNED-NEW-FILES-REMOVED');
      return true;
    });
    assert.equal(f.state.size, 4);
    for (const scope of ['host', 'container']) {
      assert.deepEqual(f.state.get(key(scope, 'index.html')).bytes, f.sealed.originalIndex);
    }
  }
});

test('an uncertain stage with no verified inode is retained and is never guessed as owned', async () => {
  const f = fixture(), plan = await f.prepare();
  const relative = languagePending(f.sealed.files[0].path, epoch);
  f.hooks.beforeStage = (scope, pending) => {
    f.state.set(key(scope, pending), f.metadata(Buffer.from('unknown partial stage')));
    throw new Error('interrupted before verified ownership');
  };
  await assert.rejects(f.apply(plan), error => error.evidence.recoveryStatus === 'INCOMPLETE-RETAINED');
  assert.equal(f.state.has(key('host', relative)), true);
});

test('only the exact successful apply receipt authorizes rollback of the six-file epoch', async () => {
  const f = fixture(), plan = await f.prepare(), applied = await f.apply(plan);
  await assert.rejects(f.apply(plan, { rollback: true, appliedReport: applied, expectedApplySha256: '0'.repeat(64) }),
    error => error.evidence.status === 'REFUSED-BEFORE-MUTATION');
  const rolledBack = await f.apply(plan, { rollback: true, appliedReport: applied, expectedApplySha256: digest(json(applied)) });
  assert.equal(rolledBack.status, 'ROLLED-BACK-EXACT-EPOCH');
  assert.equal(f.state.size, 4);
});
