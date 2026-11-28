import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  applyPersonDeployment, loadPersonDeploymentCandidate, main, personDeploymentDependencies,
  personDeploymentFiles, personDeploymentScopes, personHostInventory, personPending, preparePersonDeployment,
  rollbackPersonDeployment, validatePersonDependencyBindings, validatePersonDeploymentFiles, validatePersonMutationPath,
} from '../deploy-existing-person-select.mjs';

const workspace = path.resolve(import.meta.dirname, '../..');
const candidateDirectory = path.join(workspace, '.artifacts/person-select-closeout-20261128-r4');
const actual = loadPersonDeploymentCandidate(candidateDirectory);
const frozenInputs = actual.verifyInputs();
const epoch = '12345678-1234-4234-8234-123456789abc';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const digestJson = value => hash(Buffer.from(`${JSON.stringify(value, null, 2)}\n`));
const key = (scope, relative) => `${scope}:${relative}`;
const metadata = file => file?.exists ? { exists: true, bytes: file.bytes.length, sha256: hash(file.bytes),
  ...Object.fromEntries(['uid', 'gid', 'mode', 'dev', 'ino'].map(field => [field, file[field]])) } : { exists: false };
function memoryJournal(hooks, events) {
  const records = new Map();
  const put = (name, value) => { assert.ok(!records.has(name)); hooks.journal?.(name, value); records.set(name, value); };
  return { directory: '/private/person-prepare', records,
    bytes: (name, value) => put(name, Buffer.from(value)),
    fixed: (name, value) => put(name, structuredClone(value)),
    event(stage, value) { events.push({ stage, ...structuredClone(value) }); hooks.event?.(stage, value); } };
}
function fixture() {
  const state = new Map(), calls = [], events = [], hooks = {};
  let inode = 10;
  const make = (scope, bytes, extra = {}) => ({ exists: true, bytes: Buffer.from(bytes),
    uid: scope === 'container' ? '0' : '1000', gid: scope === 'container' ? '0' : '1000',
    mode: scope === 'host-public' ? '664' : '644', dev: scope === 'container' ? '2' : '1',
    ino: String(++inode), ...extra });
  for (const scope of personDeploymentScopes) for (const file of personDeploymentFiles) {
    const original = fs.readFileSync(path.join(candidateDirectory, 'rollback', scope === 'host-dist' ? 'dist' : 'public', file.path));
    state.set(key(scope, file.path), make(scope, scope === 'container' && file.path.endsWith('.css')
      ? Buffer.concat([original, Buffer.from('\n/* distinct existing container original */\n')]) : original));
  }
  const original = new Map([...state].map(([name, value]) => [name, Buffer.from(value.bytes)]));
  const sourceInputs = structuredClone(frozenInputs);
  const sealed = { ...actual, payload: new Map([...actual.payload].map(([name, bytes]) => [name, Buffer.from(bytes)])),
    backups: new Map(), verifyInputs: () => structuredClone(sourceInputs) };
  const observation = { runtime: { id: 'a'.repeat(64), image: `sha256:${'b'.repeat(64)}`, restartCount: 0 },
    startup: { publicPluginOverlayFollowsDist: true }, parentInodes: ['1', '2', '3'] };
  const preserved = { hostPublicPlugins: { sha256: 'c'.repeat(64), files: 100 },
    hostDist: { sha256: 'd'.repeat(64), files: 200 }, containerDist: { sha256: 'e'.repeat(64), files: 200 } };
  const directDependencies = { records: [{ kind: 'index', path: 'index.html', bytes: 2, sha256: 'f'.repeat(64), actualHttp: true },
    { kind: 'import-map', path: 'importmap.json', bytes: 2, sha256: '1'.repeat(64), actualHttp: true }],
  dependencies: personDeploymentDependencies.map((reference, index) => ({ reference, path: `extras/${index}.js`,
    bytes: 2, sha256: '2'.repeat(64), actualHttp: true, hostDistMatchesContainer: true })), recursiveRuntimeClosureClaimed: false };
  const journal = memoryJournal(hooks, events);
  const lock = { witness: { pid: 17, ino: '1' }, assertHeld() { hooks.lock?.(); } };
  const io = {
    async observe() { calls.push({ method: 'observe' }); hooks.observe?.(); return structuredClone(observation); },
    async preserve() { calls.push({ method: 'preserve' }); hooks.preserve?.(); return structuredClone(preserved); },
    async bindDirectDependencies() { calls.push({ method: 'dependencies' }); hooks.dependencies?.(); return structuredClone(directDependencies); },
    async read(scope, relative) {
      calls.push({ method: 'read', scope, path: relative }); hooks.read?.(scope, relative);
      const current = state.get(key(scope, relative));
      return current ? { ...current, bytes: Buffer.from(current.bytes) } : { exists: false };
    },
    async stage(scope, relative, bytes, fields) {
      calls.push({ method: 'stage', scope, path: relative }); hooks.beforeStage?.(scope, relative);
      assert.equal(state.has(key(scope, relative)), false);
      state.set(key(scope, relative), make(scope, bytes, { uid: fields.uid, gid: fields.gid, mode: fields.mode }));
      hooks.afterStage?.(scope, relative);
    },
    async publish(scope, pending, relative, before, staged) {
      calls.push({ method: 'publish', scope, path: relative }); hooks.beforePublish?.(scope, pending, relative);
      assert.deepEqual(metadata(state.get(key(scope, relative))), before);
      assert.deepEqual(metadata(state.get(key(scope, pending))), staged);
      state.set(key(scope, relative), state.get(key(scope, pending)));
      state.delete(key(scope, pending)); hooks.afterPublish?.(scope, pending, relative);
    },
    async removeStage(scope, relative, before) {
      calls.push({ method: 'removeStage', scope, path: relative });
      assert.ok(relative.endsWith('.pending')); assert.deepEqual(metadata(state.get(key(scope, relative))), before);
      state.delete(key(scope, relative)); hooks.afterRemove?.(scope, relative);
    },
    async http(relative) {
      calls.push({ method: 'http', path: relative });
      const result = { status: 200, bytes: Buffer.from(state.get(key('container', relative)).bytes) };
      return hooks.http?.(relative, result) ?? result;
    },
  };
  const prepare = () => preparePersonDeployment({ sealed, io, journal, lock, epoch });
  const applyArgs = plan => ({ sealed, io, journal, lock, plan, expectedEpoch: epoch,
    expectedPlanSha256: digestJson(plan), trustedExclusiveWriterWindow: true });
  const apply = plan => applyPersonDeployment(applyArgs(plan));
  const rollbackArgs = (plan, appliedReport) => ({ ...applyArgs(plan), appliedReport,
    expectedApplyReceiptSha256: digestJson(appliedReport), journal: memoryJournal(hooks, events) });
  const mutating = () => calls.filter(call => ['stage', 'publish', 'removeStage'].includes(call.method));
  return { sealed, state, original, sourceInputs, observation, preserved, directDependencies, make, hooks,
    events, journal, io, lock, calls, prepare, apply, applyArgs, rollbackArgs, mutating,
    assertOriginal() { for (const [name, bytes] of original) assert.deepEqual(state.get(name)?.bytes, bytes, name); } };
}

test('only the exact 434 four-file sizes/hashes and UUID epoch stage paths are eligible', () => {
  validatePersonDeploymentFiles(personDeploymentFiles);
  for (const file of personDeploymentFiles) {
    validatePersonMutationPath(file.path); validatePersonMutationPath(personPending(file.path, epoch));
    validatePersonMutationPath(personPending(file.path, epoch, true));
  }
  for (const relative of ['index.html', '../index.es.js', 'plugins/other/index.es.js',
    'assets/../../foreign', 'importmap.json', 'static/js/model/x.js', 'index.es.js.pending',
    'index.es.js.aibiz-person-invalid.pending']) assert.throws(() => validatePersonMutationPath(relative));
  for (const field of ['path', 'bytes', 'sha256']) {
    const changed = structuredClone(personDeploymentFiles);
    changed[0][field] = field === 'bytes' ? 1 : 'foreign';
    assert.throws(() => validatePersonDeploymentFiles(changed));
  }
});

test('seven direct dependency bindings require real HTTP, native host/container agreement and complete references', () => {
  const f = fixture();
  validatePersonDependencyBindings(f.directDependencies);
  for (const mutate of [
    value => value.dependencies.pop(),
    value => { value.dependencies[0].reference = 'foreign'; },
    value => { value.dependencies[0].actualHttp = false; },
    value => { value.dependencies[0].hostDistMatchesContainer = false; },
    value => { value.records[0].path = '../index.html'; },
    value => { value.dependencies[0].bytes = 0; },
  ]) {
    const changed = structuredClone(f.directDependencies); mutate(changed);
    assert.throws(() => validatePersonDependencyBindings(changed));
  }
});

test('the preserved inventory includes real zero-byte files and rejects links instead of treating empty bytes as target acceptance', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aibiz-person-preserved-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'empty.keep'), Buffer.alloc(0));
  fs.writeFileSync(path.join(root, 'runtime.js'), 'real bytes');
  const result = personHostInventory(root);
  assert.equal(result.files, 2);
  assert.deepEqual(result.inventory.find(row => row.path === 'empty.keep'), {
    path: 'empty.keep', bytes: 0, sha256: hash(Buffer.alloc(0)),
  });
  fs.symlinkSync(path.join(root, 'runtime.js'), path.join(root, 'foreign-link'));
  assert.throws(() => personHostInventory(root));
});

test('read-only prepare seals all twelve distinct originals, metadata, source, payload and preserved graph without staging', async () => {
  const f = fixture(), plan = await f.prepare();
  assert.equal(f.mutating().length, 0);
  assert.equal(plan.switchOrder.length, 12);
  assert.equal(plan.functionalAcceptance, false);
  assert.equal(plan.multiFileAtomicPublicationClaimed, false);
  for (const scope of personDeploymentScopes) for (const file of personDeploymentFiles) {
    assert.deepEqual(f.journal.records.get(`backup/${scope}/${file.path}`), f.original.get(key(scope, file.path)));
    assert.equal(plan.newMetadata[scope][file.path].mode, plan.targets[scope][file.path].mode);
    assert.equal(plan.newMetadata[scope][file.path].uid, plan.targets[scope][file.path].uid);
    assert.equal(plan.newMetadata[scope][file.path].inodeAssignedOnlyAfterVerifiedStage, true);
  }
  assert.notEqual(plan.targets['host-public']['style.css'].sha256, plan.targets.container['style.css'].sha256);
});

test('apply performs exactly four existing-file replacements per scope, preserves metadata and changes legacy JS last', async () => {
  const f = fixture(), plan = await f.prepare(), report = await f.apply(plan);
  assert.equal(report.status, 'APPLIED-TWELVE-PLUGIN-FILES-NATIVE-ACCEPTANCE-PENDING');
  assert.equal(report.mutations.length, 12); assert.equal(report.functionalAcceptance, false);
  assert.deepEqual(f.calls.filter(row => row.method === 'publish').map(row => ({ scope: row.scope, path: row.path })), plan.switchOrder);
  assert.equal(plan.switchOrder.at(-1).path, 'index.legacy.js');
  assert.equal(f.state.size, 12);
  for (const row of report.mutations) {
    assert.equal(row.uid, plan.targets[row.scope][row.path].uid);
    assert.equal(row.gid, plan.targets[row.scope][row.path].gid);
    assert.equal(row.mode, plan.targets[row.scope][row.path].mode);
    assert.notEqual(row.ino, plan.targets[row.scope][row.path].ino);
  }
});

test('missing acknowledgement, changed epoch/plan, source/runtime/preserved/dependency drift or replaced old inode refuses before writes', async () => {
  for (const kind of ['ack', 'epoch', 'plan', 'source', 'runtime', 'preserved', 'dependency', 'inode', 'payload', 'pending']) {
    const f = fixture(), plan = await f.prepare(), args = f.applyArgs(plan);
    if (kind === 'ack') args.trustedExclusiveWriterWindow = false;
    if (kind === 'epoch') args.expectedEpoch = undefined;
    if (kind === 'plan') args.expectedPlanSha256 = '0'.repeat(64);
    if (kind === 'source') f.sourceInputs.sha256 = '0'.repeat(64);
    if (kind === 'runtime') f.observation.runtime.restartCount++;
    if (kind === 'preserved') f.preserved.hostDist.sha256 = '0'.repeat(64);
    if (kind === 'dependency') f.directDependencies.dependencies[0].sha256 = '0'.repeat(64);
    if (kind === 'inode') f.state.set(key('host-dist', 'style.css'), f.make('host-dist', f.original.get(key('host-dist', 'style.css'))));
    if (kind === 'payload') f.sealed.payload.set('index.es.js', Buffer.from('foreign'));
    if (kind === 'pending') f.state.set(key('host-public', personPending('style.css', epoch)), f.make('host-public', Buffer.from('unknown')));
    await assert.rejects(applyPersonDeployment(args), error => error.evidence.status === 'REFUSED-BEFORE-MUTATION', kind);
    assert.equal(f.mutating().length, 0, kind);
  }
});

test('prepare refuses missing targets, stale stages or drift observed during the read-only phase', async () => {
  for (const kind of ['missing', 'pending', 'drift']) {
    const f = fixture();
    if (kind === 'missing') f.state.delete(key('container', 'style.css'));
    if (kind === 'pending') f.state.set(key('host-dist', personPending('index.es.js', epoch)), f.make('host-dist', Buffer.from('unknown')));
    if (kind === 'drift') {
      let reads = 0;
      f.hooks.read = (scope, relative) => {
        if (scope === 'container' && relative === 'index.es.js' && ++reads === 2) {
          const current = f.state.get(key(scope, relative));
          f.state.set(key(scope, relative), f.make(scope, current.bytes));
        }
      };
    }
    await assert.rejects(f.prepare()); assert.equal(f.mutating().length, 0);
  }
});

test('a failed fsynced intent never starts a stage', async () => {
  const f = fixture(), plan = await f.prepare();
  f.hooks.journal = name => { if (name === 'apply-intent.private.json') throw Error('intent fsync failed'); };
  await assert.rejects(f.apply(plan), error => error.evidence.status === 'REFUSED-BEFORE-MUTATION');
  assert.equal(f.mutating().length, 0); f.assertOriginal();
});

test('lost acknowledgement after rename is read back by exact inode and triggers recovery of all known originals', async () => {
  const f = fixture(), plan = await f.prepare();
  let failed = false;
  f.hooks.afterPublish = (scope, _pending, relative) => {
    if (!failed && scope === 'container' && relative === 'index.legacy.js') { failed = true; throw Error('lost rename response'); }
  };
  await assert.rejects(f.apply(plan), error => {
    assert.equal(error.evidence.recoveryStatus, 'EXACT-ORIGINAL-BYTES-AND-METADATA-RESTORED');
    assert.ok(error.evidence.transportErrors.some(row => row.committedReadback === true));
    return true;
  });
  f.assertOriginal(); assert.equal(f.state.size, 12);
});

test('unknown stage responses retain the unverified inode even when its bytes match the candidate', async () => {
  const f = fixture(), plan = await f.prepare();
  let failed = false;
  f.hooks.afterStage = () => { if (!failed) { failed = true; throw Error('stage response unknown'); } };
  await assert.rejects(f.apply(plan), error => {
    assert.equal(error.evidence.recoveryStatus, 'INCOMPLETE-UNKNOWN-INODES-RETAINED');
    assert.ok(error.evidence.retained.some(row => row.path.endsWith('.pending')));
    return true;
  });
  f.assertOriginal(); assert.equal(f.state.size, 13);
  assert.equal(f.calls.filter(row => row.method === 'removeStage').length, 0);
});

test('foreign same-byte replacement is retained while the other verified target changes are recovered', async () => {
  const f = fixture(), plan = await f.prepare();
  let changed = false, foreignInode;
  f.hooks.afterPublish = (scope, _pending, relative) => {
    if (!changed && scope === 'host-public' && relative === 'style.css') {
      changed = true;
      const current = f.state.get(key(scope, relative)), foreign = f.make(scope, current.bytes);
      foreignInode = foreign.ino; f.state.set(key(scope, relative), foreign);
      throw Error('external writer replaced the published inode');
    }
  };
  await assert.rejects(f.apply(plan), error => {
    assert.equal(error.evidence.recoveryStatus, 'INCOMPLETE-UNKNOWN-INODES-RETAINED');
    assert.ok(error.evidence.retained.some(row => row.scope === 'host-public' && row.path === 'style.css'));
    return true;
  });
  assert.equal(f.state.get(key('host-public', 'style.css')).ino, foreignInode);
});

test('served byte mismatch retains the real failure and conditionally restores twelve originals', async () => {
  const f = fixture(), plan = await f.prepare();
  f.hooks.http = (relative, value) => relative === 'index.es.js' && hash(value.bytes) === personDeploymentFiles[2].sha256
    ? { status: 200, bytes: Buffer.from('wrong served file') } : value;
  await assert.rejects(f.apply(plan), error => {
    assert.match(error.evidence.error, /Served plugin bytes differ/);
    assert.equal(error.evidence.recoveryStatus, 'EXACT-ORIGINAL-BYTES-AND-METADATA-RESTORED'); return true;
  });
  f.assertOriginal();
});

test('rollback requires the actual successful receipt SHA and exact twelve published inodes', async () => {
  for (const kind of ['receipt', 'inode', 'epoch']) {
    const f = fixture(), plan = await f.prepare(), applied = await f.apply(plan), args = f.rollbackArgs(plan, applied);
    const beforeCalls = f.mutating().length;
    if (kind === 'receipt') args.expectedApplyReceiptSha256 = '0'.repeat(64);
    if (kind === 'epoch') args.expectedEpoch = undefined;
    if (kind === 'inode') {
      const current = f.state.get(key('container', 'index.es.js'));
      f.state.set(key('container', 'index.es.js'), f.make('container', current.bytes));
    }
    await assert.rejects(rollbackPersonDeployment(args), error => error.evidence.status === 'REFUSED-ROLLBACK-BEFORE-MUTATION');
    assert.equal(f.mutating().length, beforeCalls);
  }
});

test('successful rollback restores every separate old scope byte/uid/gid/mode and verifies served dependencies', async () => {
  const f = fixture(), plan = await f.prepare(), applied = await f.apply(plan);
  const report = await rollbackPersonDeployment(f.rollbackArgs(plan, applied));
  assert.equal(report.status, 'ROLLED-BACK-TWELVE-EXACT-PLUGIN-ORIGINALS');
  assert.equal(report.restored.length, 12); f.assertOriginal(); assert.equal(f.state.size, 12);
  for (const row of report.restored) for (const field of ['uid', 'gid', 'mode']) {
    assert.equal(row[field], plan.targets[row.scope][row.path][field]);
  }
});

test('CLI requires one mode, a new private output and explicit plan/epoch/receipt review arguments before runtime access', async () => {
  for (const args of [[], ['--prepare'], ['--prepare', '--apply', '--output', '/unused'],
    ['--apply', '--output', '/unused'], ['--rollback', '--output', '/unused']]) await assert.rejects(main(args));
});
