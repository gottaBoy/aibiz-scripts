import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import {
  applyGuardDeployment, createActualIo, guardOverlayPaths, guardStartupEnvironmentProgram, prepareGuardDeployment, reviewGuardStartup,
  rollbackGuardDeployment, sealedGuardHashes, validateGuardOverlayFiles,
} from '../deploy-existing-plm-guard-overlay.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const epoch = '12345678-1234-4234-8234-123456789abc';
const originalIndex = Buffer.from('<html>original public entry</html>\n');
const key = (scope, relative) => `${scope}:${relative}`;

function fixture() {
  let inode = 10;
  const state = new Map();
  const calls = [];
  const events = [];
  const records = new Map();
  const hooks = {};
  const observation = { runtime: { id: 'a'.repeat(64), image: `sha256:${'b'.repeat(64)}`,
    startedAt: '2026-11-23T00:00:00Z', restartCount: 0, mounts: [] },
  startup: { sha256: sealedGuardHashes.startup }, nginxConfigurationSha256: 'c'.repeat(64) };
  const makeFile = (scope, bytes, metadata = {}) => ({
    exists: true, bytes: Buffer.from(bytes), uid: scope === 'host' ? '1000' : '0',
    gid: scope === 'host' ? '1000' : '0', mode: scope === 'host' ? '664' : '644',
    dev: scope === 'host' ? '1' : '2', ino: String(++inode), ...metadata,
  });
  for (const scope of ['host', 'container']) state.set(key(scope, 'index.html'), makeFile(scope, originalIndex));
  const payload = new Map(guardOverlayPaths.map(relative => [relative, Buffer.from(`sealed:${relative}\n`)]));
  const files = guardOverlayPaths.map(relative => ({ path: relative,
    bytes: payload.get(relative).length, sha256: digest(payload.get(relative)) }));
  const sealed = { directory: '/private/fake-sealed-candidate', manifestSha256: sealedGuardHashes.manifest,
    originalIndex, files, payload, graph: [{ path: 'unchanged.js', sha256: 'd'.repeat(64), bytes: 123 }],
    sourceDifferences: [{ path: 'historical-locale-source', recorded: 'old', current: 'new' }] };
  const journal = {
    bytes(name, bytes) {
      assert.ok(!records.has(name), `Evidence cannot be overwritten: ${name}`);
      records.set(name, Buffer.from(bytes));
    },
    fixed(name, value) {
      hooks.journal?.(name, value);
      assert.ok(!records.has(name), `Evidence cannot be overwritten: ${name}`);
      records.set(name, structuredClone(value));
    },
    event(stage, data) {
      hooks.event?.(stage, data);
      events.push({ stage, ...structuredClone(data) });
    },
  };
  const snapshot = file => ({ exists: true, bytes: Buffer.from(file.bytes), uid: file.uid, gid: file.gid,
    mode: file.mode, dev: file.dev, ino: file.ino });
  const io = {
    async observe() {
      calls.push({ method: 'observe' });
      hooks.observe?.();
      return structuredClone(observation);
    },
    async verifyPreservedGraph(graph) {
      calls.push({ method: 'graph' });
      hooks.graph?.();
      return { files: graph.length, hostAndContainerBytesMatch: true, inventorySha256: 'e'.repeat(64) };
    },
    async read(scope, relative) {
      calls.push({ method: 'read', scope, path: relative });
      hooks.read?.(scope, relative);
      const file = state.get(key(scope, relative));
      return file ? snapshot(file) : { exists: false };
    },
    async stage(scope, relative, bytes, metadata) {
      calls.push({ method: 'stage', scope, path: relative });
      assert.ok(!state.has(key(scope, relative)));
      hooks.beforeStage?.(scope, relative, bytes, metadata);
      state.set(key(scope, relative), makeFile(scope, bytes, {
        uid: metadata.uid, gid: metadata.gid, mode: metadata.mode,
      }));
      hooks.afterStage?.(scope, relative);
    },
    async publish(scope, pending, relative, before, staged) {
      calls.push({ method: 'publish', scope, path: relative, pending });
      hooks.beforePublish?.(scope, pending, relative);
      const target = state.get(key(scope, relative));
      const source = state.get(key(scope, pending));
      assert.ok(source);
      assert.equal(digest(source.bytes), staged.sha256);
      assert.equal(source.ino, staged.ino);
      if (before.exists) {
        assert.equal(target.ino, before.ino);
        assert.equal(digest(target.bytes), before.sha256);
      } else assert.equal(target, undefined, 'New files must use exclusive publication');
      state.set(key(scope, relative), source);
      state.delete(key(scope, pending));
      hooks.afterPublish?.(scope, pending, relative);
    },
    async remove(scope, relative, expected) {
      calls.push({ method: 'remove', scope, path: relative });
      const actual = state.get(key(scope, relative));
      assert.equal(digest(actual.bytes), expected.sha256);
      assert.equal(actual.ino, expected.ino);
      state.delete(key(scope, relative));
    },
    async http(relative) {
      calls.push({ method: 'http', path: relative });
      const response = { status: 200, bytes: Buffer.from(state.get(key('container', relative)).bytes) };
      return hooks.http?.(relative, response) ?? response;
    },
  };
  return { state, calls, events, records, hooks, observation, sealed, journal, io, makeFile,
    async prepare() {
      return prepareGuardDeployment({ sealed, io, journal, epoch });
    },
    async apply(plan) {
      return applyGuardDeployment({ plan, sealed, io, journal, expectedEpoch: epoch });
    },
    mutating() { return calls.filter(call => ['stage', 'publish', 'remove'].includes(call.method)); },
    assertOriginalIndexes() {
      for (const scope of ['host', 'container']) assert.deepEqual(state.get(key(scope, 'index.html')).bytes, originalIndex);
    },
  };
}

function rollbackInput(f, plan, appliedReport) {
  const records = new Map();
  const journal = {
    bytes(name, bytes) {
      assert.ok(!records.has(name));
      records.set(name, Buffer.from(bytes));
    },
    fixed(name, value) {
      f.hooks.journal?.(name, value);
      assert.ok(!records.has(name));
      records.set(name, structuredClone(value));
    },
    event(stage, data) { f.events.push({ stage, ...structuredClone(data) }); },
  };
  return { plan, appliedReport, expectedApplyReportSha256: digest(Buffer.from(`${JSON.stringify(appliedReport, null, 2)}\n`)),
    sealed: f.sealed, io: f.io, journal, expectedEpoch: plan.epoch, records };
}

test('only the exact seventeen-file overlay is eligible; plugins, models, environment and old import map are excluded', () => {
  const f = fixture();
  assert.doesNotThrow(() => validateGuardOverlayFiles(f.sealed.files));
  for (const relative of ['plugins/foreign/index.js', 'static/js/model/entities/article-page-legacy.js',
    'environments/environment.js', 'extras/json/system-import.json', '../outside', 'index.html']) {
    const files = structuredClone(f.sealed.files);
    files[0].path = relative;
    assert.throws(() => validateGuardOverlayFiles(files));
  }
  assert.throws(() => validateGuardOverlayFiles(f.sealed.files.slice(1)));
});

test('startup auditing binds the whole known script and verifies dist, plugin and environment copy order', () => {
  const source = fs.readFileSync(new URL('../../plm-web/start.sh', import.meta.url), 'utf8');
  const audit = reviewGuardStartup(source);
  assert.deepEqual(audit.copyOrder, ['host-dist', 'plugins-subtree', 'environment-overrides', 'nginx']);
  assert.equal(audit.targetsOutsidePluginAndEnvironmentOverrides, true);
  assert.throws(() => reviewGuardStartup(source.replace('/dist/plugins/', '/dist/')));
});

test('the exact startup AWK program reproduces environment overrides without editing the source or executing startup copies', t => {
  const root = fs.mkdtempSync(path.join(tmpdir(), 'plm-guard-awk-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = fs.readFileSync(new URL('../../plm-web/start.sh', import.meta.url), 'utf8');
  const program = guardStartupEnvironmentProgram(source);
  const configuration = path.join(root, 'environment.config');
  fs.writeFileSync(configuration, 'enableMqtt:PLM_GUARD_TEST_MQTT\napiUrl:PLM_GUARD_TEST_URL\n', { mode: 0o600 });
  const before = Buffer.from('window.Environment = { retained: true };\n// BEGIN PLMWEB ENV OVERRIDES\nold override\n// END PLMWEB ENV OVERRIDES\n');
  const url = '中文 e\u0301 " \\ \n\u2028';
  const rendered = spawnSync('awk', ['-F:', program, configuration, '-'], { input: before,
    env: { ...process.env, LC_ALL: 'C', PLM_GUARD_TEST_MQTT: 'false', PLM_GUARD_TEST_URL: url } });
  assert.equal(rendered.status, 0, rendered.stderr.toString());
  const context = { window: {} };
  vm.runInNewContext(rendered.stdout.toString(), context);
  assert.equal(context.window.Environment.retained, true);
  assert.equal(context.window.Environment.enableMqtt, false);
  assert.equal(context.window.Environment.apiUrl, url);
  assert.ok(before.toString().includes('old override'));
  assert.ok(!rendered.stdout.toString().includes('old override'));
});

test('default preparation seals payload and original-index backups without calling a mutating operation', async () => {
  const f = fixture();
  const plan = await f.prepare();
  assert.equal(plan.status, 'PREPARED-NOT-APPLIED');
  assert.equal(plan.epoch, epoch);
  assert.equal(f.mutating().length, 0);
  assert.equal(f.records.get('prepared.private.json').status, 'PREPARED-NOT-APPLIED');
  assert.deepEqual(f.records.get('backup/host/index.html'), originalIndex);
  assert.deepEqual(f.records.get('backup/container/index.html'), originalIndex);
  assert.equal([...f.records.keys()].filter(name => name.startsWith('payload/')).length, 17);
});

test('the actual container staging adapter creates its tree as the recorded startup file owner', async () => {
  const commands = [];
  const payload = Buffer.from('sealed executable bytes');
  const pending = `${guardOverlayPaths[0]}.aibiz-guard-${epoch}.pending`;
  const io = createActualIo({ expectedRuntime: { id: 'a'.repeat(64) } }, (args, options) => {
    commands.push(args);
    assert.equal(args[0], 'exec');
    assert.equal(args[args.indexOf('--user') + 1], '101:101',
      'Root-owned directories would prevent the existing UID 101 startup cleanup');
    assert.deepEqual(options.input, payload);
    assert.equal(args.at(-2), pending);
    assert.equal(args.at(-1), 'yes');
    return { status: 0, stdout: Buffer.from('CREATED /dist/extras/js/@ibiz-template/vue3-components/guard-8388128f7ab5b027\n') };
  });
  const created = [];
  await io.stage('container', pending, payload, { uid: '101', gid: '101', mode: '644' }, directory => created.push(directory));
  assert.equal(commands.length, 1);
  assert.equal(created.length, 1);
});

test('explicit application installs exactly sixteen files per scope before switching the two indexes last', async () => {
  const f = fixture();
  const plan = await f.prepare();
  const report = await f.apply(plan);
  assert.equal(report.status, 'APPLIED-STATIC-ONLY-BUSINESS-ACCEPTANCE-PENDING');
  assert.equal(report.functionalAcceptance, false);
  const published = f.calls.filter(call => call.method === 'publish');
  assert.equal(published.length, 34);
  assert.deepEqual(published.slice(-2).map(call => [call.scope, call.path]),
    [['host', 'index.html'], ['container', 'index.html']]);
  assert.ok(published.slice(0, -2).every(call => call.path !== 'index.html'));
  assert.equal(f.calls.filter(call => call.method === 'http').length, 17);
  assert.ok(f.records.has('apply-intent.private.json'));
  assert.equal(f.records.get('report.private.json').status, report.status);
  for (const scope of ['host', 'container']) {
    for (const file of plan.files) {
      const actual = f.state.get(key(scope, file.path));
      assert.equal(digest(actual.bytes), file.sha256);
      assert.equal(actual.mode, file.path === 'index.html' && scope === 'host' ? '664' : '644');
    }
  }
  assert.ok([...f.state.keys()].every(name => !name.endsWith('.pending')));
});

test('a missing or different epoch, changed payload or lifecycle refuses all mutations', async () => {
  for (const kind of ['epoch', 'payload', 'lifecycle']) {
    const f = fixture();
    const plan = await f.prepare();
    if (kind === 'payload') f.sealed.payload.set(plan.files[0].path, Buffer.from('changed sealed bytes'));
    if (kind === 'lifecycle') f.observation.runtime.restartCount++;
    await assert.rejects(applyGuardDeployment({ plan, sealed: f.sealed, io: f.io, journal: f.journal,
      expectedEpoch: kind === 'epoch' ? undefined : epoch }));
    assert.equal(f.mutating().length, 0);
    f.assertOriginalIndexes();
  }
});

test('a pre-existing new target or a target changed during preparation is refused without adoption', async () => {
  for (const driftDuringRead of [false, true]) {
    const f = fixture();
    const relative = f.sealed.files[0].path;
    if (!driftDuringRead) f.state.set(key('host', relative), f.makeFile('host', Buffer.from('foreign')));
    else {
      let indexReads = 0;
      f.hooks.read = (scope, name) => {
        if (scope === 'host' && name === 'index.html' && ++indexReads === 2) {
          f.state.set(key('host', 'index.html'), f.makeFile('host', Buffer.from('newer original')));
        }
      };
    }
    await assert.rejects(f.prepare());
    assert.equal(f.mutating().length, 0);
  }
});

test('a disk-full intent write prevents every staging and publication operation', async () => {
  const f = fixture();
  const plan = await f.prepare();
  f.hooks.journal = name => { if (name === 'apply-intent.private.json') throw new Error('private intent fsync failed'); };
  await assert.rejects(f.apply(plan), error => error.evidence.status === 'REFUSED-BEFORE-MUTATION');
  assert.equal(f.mutating().length, 0);
  f.assertOriginalIndexes();
});

test('an uncertain post-rename failure restores both exact indexes and removes only verified epoch files', async () => {
  const f = fixture();
  const plan = await f.prepare();
  let failed = false;
  f.hooks.afterPublish = (scope, pending, relative) => {
    if (!failed && scope === 'container' && relative === 'index.html') {
      failed = true;
      throw new Error('connection lost after atomic rename');
    }
  };
  await assert.rejects(f.apply(plan), error => {
    assert.match(error.message, /connection lost/);
    assert.equal(error.evidence.recoveryStatus, 'RESTORED-ORIGINAL-INDEXES-AND-REMOVED-VERIFIED-FILES');
    return true;
  });
  f.assertOriginalIndexes();
  assert.deepEqual([...f.state.keys()].sort(), ['container:index.html', 'host:index.html']);
  assert.equal(f.records.get('report.private.json').status, 'FAILED-APPLY-CONDITIONAL-RECOVERY');
});

test('actual served-byte mismatch after both switches restores original metadata and preserves the failure', async () => {
  const f = fixture();
  const plan = await f.prepare();
  f.hooks.http = () => ({ status: 200, bytes: Buffer.from('wrong served bytes') });
  await assert.rejects(f.apply(plan), error => {
    assert.match(error.message, /Actual served bytes differ/);
    assert.equal(error.evidence.recoveryStatus, 'RESTORED-ORIGINAL-INDEXES-AND-REMOVED-VERIFIED-FILES');
    return true;
  });
  f.assertOriginalIndexes();
  assert.equal(f.state.get('host:index.html').mode, '664');
  assert.equal(f.state.get('container:index.html').uid, '0');
});

test('a partial unverified stage remains for review while committed verified files are removed', async () => {
  const f = fixture();
  const plan = await f.prepare();
  let pending;
  f.hooks.beforeStage = (scope, relative) => {
    if (scope === 'host' && relative.startsWith(plan.files[1].path)) {
      pending = relative;
      f.state.set(key(scope, relative), f.makeFile(scope, Buffer.from('partial unverified upload')));
      throw new Error('upload interrupted');
    }
  };
  await assert.rejects(f.apply(plan), error => error.evidence.recoveryStatus === 'INCOMPLETE-RETAINED-FOR-REVIEW');
  f.assertOriginalIndexes();
  assert.deepEqual(f.state.get(key('host', pending)).bytes, Buffer.from('partial unverified upload'));
  assert.ok(!f.calls.some(call => call.method === 'remove' && call.path === pending));
  assert.ok(!f.state.has(key('host', plan.files[0].path)));
});

test('changed new-file bytes are retained during recovery rather than deleted as an owned candidate', async () => {
  const f = fixture();
  const plan = await f.prepare();
  const retained = plan.files[0].path;
  f.hooks.http = () => {
    f.state.get(key('host', retained)).bytes = Buffer.from('newer external content');
    return { status: 503, bytes: Buffer.from('actual static failure') };
  };
  await assert.rejects(f.apply(plan), error => error.evidence.recoveryStatus === 'INCOMPLETE-RETAINED-FOR-REVIEW');
  f.assertOriginalIndexes();
  assert.deepEqual(f.state.get(key('host', retained)).bytes, Buffer.from('newer external content'));
  assert.ok(!f.calls.some(call => call.method === 'remove' && call.scope === 'host' && call.path === retained));
});

test('an identical-hash index with a foreign inode retains that index and all its new dependencies', async () => {
  const f = fixture();
  const plan = await f.prepare();
  f.hooks.http = () => {
    f.state.set('container:index.html', f.makeFile('container', f.sealed.payload.get('index.html')));
    return { status: 503, bytes: Buffer.from('readback interrupted') };
  };
  await assert.rejects(f.apply(plan), error => {
    assert.equal(error.evidence.recoveryStatus, 'INCOMPLETE-RETAINED-FOR-REVIEW');
    assert.ok(error.evidence.recovery.some(item => item.scope === 'container' && item.path === 'index.html' &&
      item.status === 'RETAINED-UNKNOWN-OR-DRIFTED'));
    return true;
  });
  assert.deepEqual(f.state.get('host:index.html').bytes, originalIndex);
  for (const file of plan.files) assert.ok(f.state.has(key('container', file.path)));
  assert.ok(!f.calls.some(call => call.method === 'remove' && call.scope === 'container' && !call.path.endsWith('.pending')));
});

test('lifecycle drift during a write blocks recovery mutations against the changed runtime', async () => {
  const f = fixture();
  const plan = await f.prepare();
  f.hooks.afterStage = () => { f.observation.runtime.restartCount++; };
  await assert.rejects(f.apply(plan), error => error.evidence.recoveryStatus === 'INCOMPLETE-RETAINED-FOR-REVIEW');
  assert.equal(f.calls.filter(call => call.method === 'publish').length, 0);
  assert.equal(f.calls.filter(call => call.method === 'remove').length, 0);
  f.assertOriginalIndexes();
});

test('explicit rollback consumes the successful receipt, restores exact indexes and then removes only its new files', async () => {
  const f = fixture();
  const plan = await f.prepare();
  const applied = await f.apply(plan);
  const input = rollbackInput(f, plan, applied);
  f.hooks.beforeStage = (scope, relative) => {
    if (relative.endsWith('-rollback.pending')) assert.ok(input.records.has('rollback-intent.private.json'));
  };
  const report = await rollbackGuardDeployment(input);
  assert.equal(report.status, 'ROLLED-BACK-EXACT-INDEXES-REMOVED-VERIFIED-EPOCH-FILES');
  assert.equal(report.functionalAcceptance, false);
  assert.deepEqual(report.restoredIndexes.map(item => item.scope), ['container', 'host']);
  assert.equal(report.removedFiles.length, 32);
  assert.deepEqual([...f.state.keys()].sort(), ['container:index.html', 'host:index.html']);
  f.assertOriginalIndexes();
  assert.equal(f.state.get('host:index.html').mode, '664');
  assert.equal(f.state.get('container:index.html').mode, '644');
  assert.equal(input.records.get('report.private.json').status, report.status);
});

test('changed successful-report bytes or a changed epoch cannot authorize rollback writes', async () => {
  for (const change of ['report-hash', 'epoch']) {
    const f = fixture();
    const plan = await f.prepare();
    const applied = await f.apply(plan);
    const input = rollbackInput(f, plan, applied);
    const before = f.mutating().length;
    if (change === 'report-hash') input.expectedApplyReportSha256 = '0'.repeat(64);
    else input.expectedEpoch = '87654321-1234-4234-8234-123456789abc';
    await assert.rejects(rollbackGuardDeployment(input), error =>
      error.evidence.status === 'REFUSED-ROLLBACK-BEFORE-MUTATION');
    assert.equal(f.mutating().length, before);
  }
});

test('foreign index inode or changed new-file bytes refuse the entire rollback before any write', async () => {
  for (const change of ['foreign-index-inode', 'foreign-new-file-bytes']) {
    const f = fixture();
    const plan = await f.prepare();
    const applied = await f.apply(plan);
    if (change === 'foreign-index-inode') {
      f.state.set('container:index.html', f.makeFile('container', f.sealed.payload.get('index.html')));
    } else f.state.get(key('host', plan.files[0].path)).bytes = Buffer.from('external changed bytes');
    const before = f.mutating().length;
    await assert.rejects(rollbackGuardDeployment(rollbackInput(f, plan, applied)), error =>
      error.evidence.status === 'REFUSED-ROLLBACK-BEFORE-MUTATION');
    assert.equal(f.mutating().length, before);
    for (const scope of ['host', 'container']) {
      for (const file of plan.files) assert.ok(f.state.has(key(scope, file.path)));
    }
  }
});

test('repeating a completed rollback is refused without writes or adoption of original-content files', async () => {
  const f = fixture();
  const plan = await f.prepare();
  const applied = await f.apply(plan);
  await rollbackGuardDeployment(rollbackInput(f, plan, applied));
  const before = f.mutating().length;
  await assert.rejects(rollbackGuardDeployment(rollbackInput(f, plan, applied)), error =>
    error.evidence.status === 'REFUSED-ROLLBACK-BEFORE-MUTATION');
  assert.equal(f.mutating().length, before);
  f.assertOriginalIndexes();
});

test('rollback intent fsync failure and changed runtime identity both refuse every rollback mutation', async () => {
  for (const change of ['intent', 'lifecycle']) {
    const f = fixture();
    const plan = await f.prepare();
    const applied = await f.apply(plan);
    const input = rollbackInput(f, plan, applied);
    if (change === 'intent') f.hooks.journal = name => {
      if (name === 'rollback-intent.private.json') throw new Error('rollback intent fsync failed');
    };
    else f.observation.runtime.restartCount++;
    const before = f.mutating().length;
    await assert.rejects(rollbackGuardDeployment(input), error =>
      error.evidence.status === 'REFUSED-ROLLBACK-BEFORE-MUTATION');
    assert.equal(f.mutating().length, before);
  }
});

test('index drift after the first restoration retains all new dependencies and reports an incomplete rollback', async () => {
  const f = fixture();
  const plan = await f.prepare();
  const applied = await f.apply(plan);
  f.hooks.afterPublish = (scope, pending, relative) => {
    if (scope === 'container' && pending.endsWith('-rollback.pending') && relative === 'index.html') {
      f.state.set('host:index.html', f.makeFile('host', f.sealed.payload.get('index.html')));
    }
  };
  await assert.rejects(rollbackGuardDeployment(rollbackInput(f, plan, applied)), error => {
    assert.equal(error.evidence.status, 'ROLLBACK-FAILED-RETAINED-FOR-REVIEW');
    assert.equal(error.evidence.removedFiles.length, 0);
    assert.equal(error.evidence.retained.filter(item => !item.path.endsWith('.pending')).length, 32);
    return true;
  });
  assert.deepEqual(f.state.get('container:index.html').bytes, originalIndex);
  for (const scope of ['host', 'container']) {
    for (const file of plan.files) assert.ok(f.state.has(key(scope, file.path)));
  }
});

test('a completed rollback supports a new prepared epoch and another exact publication', async () => {
  const f = fixture();
  const plan = await f.prepare();
  const applied = await f.apply(plan);
  await rollbackGuardDeployment(rollbackInput(f, plan, applied));
  const fresh = rollbackInput(f, plan, applied);
  const nextEpoch = 'abcdef01-1234-4234-8234-123456789abc';
  const nextPlan = await prepareGuardDeployment({ sealed: f.sealed, io: f.io, journal: fresh.journal, epoch: nextEpoch });
  const result = await applyGuardDeployment({ plan: nextPlan, sealed: f.sealed, io: f.io,
    journal: fresh.journal, expectedEpoch: nextEpoch });
  assert.equal(result.status, 'APPLIED-STATIC-ONLY-BUSINESS-ACCEPTANCE-PENDING');
  assert.equal(result.epoch, nextEpoch);
  for (const scope of ['host', 'container']) {
    for (const file of nextPlan.files) assert.equal(digest(f.state.get(key(scope, file.path)).bytes), file.sha256);
  }
});
