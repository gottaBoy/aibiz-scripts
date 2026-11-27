#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import {
  acquireNotificationDeploymentLock, notificationHostMutationProgram,
  notificationContainerPathProgram, notificationContainerInventoryProgram,
  parseNotificationContainerInventory, normalizeNotificationFileMetadata,
} from './deploy-existing-plm-notification-style.mjs';
import { apiDocumentationDelta, apiDocumentationRuntimeWitness } from './prepare-existing-api-documentation-release.mjs';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = path.join(workspace, '.artifacts');
const hostRoot = path.join(workspace, 'plm-web/dist/doc');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const scopes = ['host', 'container'];
const metadataKeys = ['exists', 'bytes', 'sha256', 'uid', 'gid', 'mode', 'dev', 'ino'];
const writable = /^(?:index\.html|css\/(?:main|local-theme)\.css|script\/aibiz-api-reference\.js|api-reference\/(?:manifest\.json|(?:en|zh-CN)\/(?:ServiceAPI\.md|_sidebar\.md|search\.json|entities\/[A-Za-z_][A-Za-z0-9_-]*\.md)))$/;
const sourcePaths = [
  'scripts/deploy-existing-api-documentation-release.mjs',
  'scripts/tests/deploy-existing-api-documentation-release.test.mjs',
  'scripts/prepare-existing-api-documentation-release.mjs',
  'scripts/tests/prepare-existing-api-documentation-release.test.mjs',
  'scripts/deploy-existing-plm-notification-style.mjs',
  'scripts/deploy-existing-plm-guard-overlay.mjs',
];
function safe(relative) {
  assert.ok(relative && !path.isAbsolute(relative) && !/[\0\\\r\n]/.test(relative));
  assert.ok(relative.split('/').every(part => part && part !== '.' && part !== '..'));
}
function command(program, args, input) {
  const result = spawnSync(program, args, { input, timeout: 120_000, maxBuffer: 64 * 1024 * 1024 });
  assert.equal(result.status, 0, `${program} exact documentation command failed`);
  return Buffer.from(result.stdout ?? '');
}
function privateRead(file) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    assert.ok(stat.isFile() && stat.uid === process.geteuid() && (stat.mode & 0o077) === 0);
    return fs.readFileSync(fd);
  } finally { fs.closeSync(fd); }
}
function syncDirectory(directory) {
  const fd = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function journalAt(output) {
  assert.equal(fs.realpathSync(path.dirname(output)), artifacts);
  assert.match(path.basename(output), /^api-documentation-install-(?:prepare|apply|rollback)-[a-z0-9-]+$/);
  fs.mkdirSync(output, { mode: 0o700 });
  let sequence = 0;
  const bytes = (relative, value) => {
    safe(relative);
    const file = path.join(output, relative);
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const fd = fs.openSync(file, 'wx', 0o600);
    try { fs.writeFileSync(fd, value); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    syncDirectory(path.dirname(file));
  };
  return { output, bytes, fixed: (name, value) => bytes(name, json(value)), event(stage, value) {
    bytes(`event-${String(++sequence).padStart(5, '0')}-${stage}.private.json`, json({ stage, ...value, at: new Date().toISOString() }));
  } };
}
export function documentationPending(relative, epoch, restoring = false) {
  safe(relative);
  assert.match(epoch, /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  return `${relative}.aibiz-api-documentation-${epoch}${restoring ? '-rollback' : ''}.pending`;
}
export function compactDocumentationFile(value) {
  if (value.exists === false) return { exists: false };
  assert.ok(Buffer.isBuffer(value.bytes));
  return { exists: true, bytes: value.bytes.length, sha256: hash(value.bytes),
    ...Object.fromEntries(['uid', 'gid', 'mode', 'dev', 'ino'].map(key => [key, value[key]])) };
}
function originalMetadata(value) {
  return value.exists === false ? { exists: false } : { exists: true,
    ...Object.fromEntries(metadataKeys.filter(key => key !== 'exists').map(key => [key, value[key]])) };
}
function equal(actual, expected) { assert.deepEqual(actual, expected, 'Documentation file or metadata drift'); }
function owned(actual, expected) {
  return expected?.exists === true && actual?.exists === true &&
    metadataKeys.every(key => actual[key] === expected[key]);
}
function sameOriginal(actual, expected) {
  return actual.exists === expected.exists && (!actual.exists ||
    ['bytes', 'sha256', 'uid', 'gid', 'mode'].every(key => actual[key] === expected[key]));
}
function sourceSeal() {
  return sourcePaths.map(relative => ({ path: relative, sha256: hash(fs.readFileSync(path.join(workspace, relative))) }));
}
export function loadApiDocumentationRelease(directory, expectedSha256) {
  directory = fs.realpathSync(directory);
  assert.equal(path.dirname(directory), artifacts);
  assert.match(expectedSha256, /^[a-f0-9]{64}$/);
  const bytes = privateRead(path.join(directory, 'plan.private.json'));
  assert.equal(hash(bytes), expectedSha256);
  const release = JSON.parse(bytes);
  assert.equal(release.contract, 'existing-api-documentation-release-v1');
  assert.equal(release.status, 'PREPARED-NOT-PUBLISHED');
  assert.equal(release.prefix, '/ibizplm-plmweb/doc/');
  assert.equal(release.runtime.id, '70327c269425370bed8648bcaa90feadf441ff7a6c5f75b975889cf4c5416612');
  assert.equal(release.runtime.image, 'sha256:027de06a1f8d8d5e44e17b849d44d39a421c6fe0787433b5e229ba00655ca99c');
  assert.equal(release.candidate.payloadDirectory, path.join(directory, 'payload/doc'));
  assert.deepEqual(apiDocumentationDelta(release.candidate.files, release.existingInventories.host,
    release.existingInventories.container), release.delta);
  for (const scope of scopes) {
    assert.ok(release.delta[scope].some(row => row.path === 'index.html'));
    for (const row of release.delta[scope]) assert.ok(writable.test(row.path));
  }
  const payload = new Map();
  for (const file of release.candidate.files) {
    safe(file.path);
    const filename = path.join(release.candidate.payloadDirectory, file.path);
    assert.equal(fs.realpathSync(filename), filename);
    const value = fs.readFileSync(filename);
    assert.equal(hash(value), file.sha256);
    assert.equal(value.length, file.bytes);
    payload.set(file.path, value);
  }
  for (const scope of scopes) {
    const backup = release.rollback[scope];
    assert.equal(backup.path, `rollback/${scope}-doc.private.tar`);
    assert.equal(hash(privateRead(path.join(directory, backup.path))), backup.sha256);
  }
  const original = (scope, relative) => {
    safe(relative);
    const bytes = command('tar', ['-xOf', path.join(directory, release.rollback[scope].path), `doc/${relative}`]);
    const expected = release.delta[scope].find(row => row.path === relative)?.previous;
    assert.ok(expected && expected.exists !== false);
    assert.equal(hash(bytes), expected.sha256);
    assert.equal(bytes.length, expected.bytes);
    return bytes;
  };
  return { directory, release, payload, sha256: expectedSha256, original,
    verify() {
      assert.equal(hash(privateRead(path.join(directory, 'plan.private.json'))), expectedSha256);
      for (const [repo, revision] of Object.entries(release.candidate.revisions)) {
        const result = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: path.join(workspace, repo), encoding: 'utf8' });
        assert.equal(result.status, 0);
        assert.equal(result.stdout.trim(), revision, 'Committed document source changed');
      }
    } };
}

export async function prepareApiDocumentationInstall({ sealed, io, journal, lock, epoch = randomUUID() }) {
  lock.assertHeld(); sealed.verify();
  const release = sealed.release;
  equal(await io.observe(), release.runtime);
  const parents = await io.rootMetadata();
  const targets = {};
  for (const scope of scopes) {
    targets[scope] = [];
    for (const item of release.delta[scope]) {
      const before = originalMetadata(item.previous);
      equal(compactDocumentationFile(await io.read(scope, item.path)), before);
      for (const restoring of [false, true]) {
        assert.equal((await io.read(scope, documentationPending(item.path, epoch, restoring))).exists, false);
      }
      if (before.exists) journal.bytes(`original/${scope}/${item.path}`, sealed.original(scope, item.path));
      targets[scope].push({ path: item.path, before, candidate: item.candidate });
      if (targets[scope].length % 100 === 0) console.log(JSON.stringify({
        stage: 'documentation-prepare-readonly', scope, checked: targets[scope].length,
      }));
    }
  }
  const sources = sourceSeal();
  for (const item of sources) journal.bytes(`sources/${item.path}`, fs.readFileSync(path.join(workspace, item.path)));
  const preserved = await io.preserve(epoch);
  const plan = { contract: 'api-documentation-exact-install-v1', status: 'PREPARED-NOT-APPLIED', epoch,
    releaseDirectory: sealed.directory, releaseSha256: sealed.sha256,
    runtime: release.runtime, parents, targets, preserved, sourceSeal: sources,
    prefix: release.prefix, sharedOutputChanged: false, parentAcceptance: false,
    trustedExclusiveWriterWindowRequired: true, atomicCompareAndSwapClaimed: false,
    order: 'All non-index delta files in both scopes, then host/container doc index; restore both original indexes before dependency cleanup.',
    preparedAt: new Date().toISOString() };
  equal(await io.observe(), release.runtime);
  equal(sourceSeal(), sources);
  sealed.verify(); lock.assertHeld();
  journal.fixed('prepared.private.json', plan);
  return plan;
}

export async function mutateApiDocumentation({
  plan, sealed, io, journal, lock, expectedPlanSha256, trustedExclusiveWriterWindow,
  originalBytes, rollback = false, appliedReport, expectedApplySha256,
}) {
  const report = { contract: rollback ? 'api-documentation-exact-rollback-v1' : 'api-documentation-exact-apply-v1',
    status: 'VALIDATING-NOT-YET-WRITING', epoch: plan?.epoch, planSha256: expectedPlanSha256,
    releaseSha256: sealed.sha256, ledger: [], recovery: [], transportErrors: [], directories: [],
    parentAcceptance: false, startedAt: new Date().toISOString() };
  const read = async (scope, relative) => compactDocumentationFile(await io.read(scope, relative));
  const guard = async () => {
    lock.assertHeld(); sealed.verify();
    equal(sourceSeal(), plan.sourceSeal);
    equal(await io.observe(), plan.runtime);
    equal(await io.rootMetadata(), plan.parents);
  };
  const uncertain = async (scope, relative) => {
    try { return await read(scope, relative); } catch (error) { return { exists: null, error: error.message }; }
  };
  const install = async (scope, item, bytes, before, restoring = false) => {
    await guard();
    const pending = documentationPending(item.path, plan.epoch, restoring);
    equal(await read(scope, item.path), before);
    assert.equal((await io.read(scope, pending)).exists, false);
    const parent = plan.parents[scope];
    const desired = { exists: true, bytes: bytes.length, sha256: hash(bytes),
      uid: before.exists ? before.uid : parent.uid, gid: before.exists ? before.gid : parent.gid,
      mode: before.exists ? before.mode : '644' };
    const entry = { scope, path: item.path, pending, before, desired, restoring, stageDispatched: false, publishDispatched: false };
    report.ledger.push(entry);
    journal.event('before-parent-creation', { scope, path: item.path, parent });
    try { report.directories.push(...await io.ensureParents(scope, item.path, parent)); }
    catch (error) { entry.uncertainParents = true; journal.event('uncertain-parent-creation', { scope, path: item.path, error: error.message }); throw error; }
    journal.event('before-stage', entry);
    entry.stageDispatched = true;
    try { await io.stage(scope, pending, bytes, desired); }
    catch (error) {
      entry.uncertainStage = await uncertain(scope, pending);
      journal.event('uncertain-stage', { ...entry, error: error.message });
      throw error;
    }
    entry.staged = await read(scope, pending);
    for (const key of ['exists', 'bytes', 'sha256', 'uid', 'gid', 'mode']) assert.equal(entry.staged[key], desired[key]);
    journal.event('verified-stage', entry);
    await guard();
    equal(await read(scope, item.path), before);
    journal.event('before-publish', entry);
    entry.publishDispatched = true;
    try { await io.publish(scope, pending, item.path, before, entry.staged); }
    catch (error) {
      const actual = await uncertain(scope, item.path), pendingActual = await uncertain(scope, pending);
      entry.uncertainPublication = { actual, pendingActual, committed: owned(actual, entry.staged) && pendingActual.exists === false };
      report.transportErrors.push({ scope, path: item.path, error: error.message, ...entry.uncertainPublication });
      journal.event('uncertain-publication', report.transportErrors.at(-1));
      if (!restoring || !entry.uncertainPublication.committed) throw error;
    }
    equal(await read(scope, item.path), entry.staged);
    assert.equal((await io.read(scope, pending)).exists, false);
    entry.installed = true;
    journal.event('published', entry);
    return entry.staged;
  };
  const remove = async (scope, relative, expected) => {
    await guard(); equal(await read(scope, relative), expected);
    journal.event('before-remove', { scope, path: relative, expected });
    try { await io.remove(scope, relative, expected); }
    catch (error) {
      const actual = await uncertain(scope, relative);
      report.transportErrors.push({ scope, path: relative, error: error.message, actual });
      journal.event('uncertain-removal', report.transportErrors.at(-1));
      if (actual.exists !== false) throw error;
    }
    assert.equal((await io.read(scope, relative)).exists, false);
  };
  const recover = async ledger => {
    const latest = (scope, relative) => [...ledger].reverse().find(entry => entry.scope === scope &&
      entry.path === relative && entry.publishDispatched && entry.staged);
    const indexes = new Map();
    for (const scope of [...scopes].reverse()) {
      const item = plan.targets[scope].find(row => row.path === 'index.html');
      try {
        assert.ok(item, 'Each scope needs the changed document index');
        const actual = await read(scope, item.path);
        if (!sameOriginal(actual, item.before)) {
          const entry = latest(scope, item.path);
          assert.ok(owned(actual, entry?.staged), 'Unknown document index retained');
          await install(scope, item, originalBytes(scope, item.path), actual, true);
        }
        assert.ok(sameOriginal(await read(scope, item.path), item.before));
        indexes.set(scope, true);
        report.recovery.push({ scope, path: item.path, status: 'ORIGINAL-CONTENT-AND-OWNERSHIP-VERIFIED' });
      } catch (error) { report.recovery.push({ scope, path: item?.path, status: 'RETAINED', error: error.message }); }
    }
    if (indexes.size === scopes.length) for (const scope of scopes) {
      for (const item of [...plan.targets[scope]].reverse().filter(row => row.path !== 'index.html')) {
        try {
          const actual = await read(scope, item.path);
          if (!sameOriginal(actual, item.before)) {
            const entry = latest(scope, item.path);
            assert.ok(owned(actual, entry?.staged), 'Unknown document file retained');
            if (item.before.exists) await install(scope, item, originalBytes(scope, item.path), actual, true);
            else await remove(scope, item.path, actual);
          }
          assert.ok(sameOriginal(await read(scope, item.path), item.before));
          report.recovery.push({ scope, path: item.path, status: 'ORIGINAL-OR-ABSENCE-VERIFIED' });
        } catch (error) { report.recovery.push({ scope, path: item.path, status: 'RETAINED', error: error.message }); }
      }
    }
    for (const entry of [...new Set([...ledger, ...report.ledger])]) if (entry.staged) {
      try {
        const actual = await read(entry.scope, entry.pending);
        if (actual.exists) { assert.ok(owned(actual, entry.staged)); await remove(entry.scope, entry.pending, actual); }
      } catch (error) { report.recovery.push({ scope: entry.scope, path: entry.pending, status: 'RETAINED', error: error.message }); }
    } else if (entry.stageDispatched && entry.uncertainStage && entry.uncertainStage.exists !== false) {
      report.recovery.push({ scope: entry.scope, path: entry.pending, status: 'RETAINED-UNCERTAIN-STAGE' });
    }
    for (const entry of ledger.filter(entry => entry.uncertainParents)) {
      report.recovery.push({ scope: entry.scope, path: entry.path, status: 'RETAINED-UNCERTAIN-PARENTS' });
    }
    for (const directory of [...report.directories].reverse()) {
      try { await io.removeEmptyDirectory(directory); }
      catch (error) { report.recovery.push({ scope: directory.scope, path: directory.path, status: 'DIRECTORY-RETAINED', error: error.message }); }
    }
  };
  let intent = false;
  try {
    assert.equal(plan.contract, 'api-documentation-exact-install-v1');
    assert.equal(plan.status, 'PREPARED-NOT-APPLIED');
    assert.equal(hash(json(plan)), expectedPlanSha256);
    assert.equal(plan.releaseSha256, sealed.sha256);
    equal(plan.targets, Object.fromEntries(scopes.map(scope => [scope, sealed.release.delta[scope].map(item => ({
      path: item.path, before: originalMetadata(item.previous), candidate: item.candidate,
    }))])));
    assert.equal(trustedExclusiveWriterWindow, true, 'Explicit exclusive writer window required');
    for (const scope of scopes) for (const item of plan.targets[scope].filter(item => item.before.exists)) {
      const bytes = originalBytes(scope, item.path);
      assert.ok(Buffer.isBuffer(bytes));
      assert.equal(bytes.length, item.before.bytes, 'Original backup size changed');
      assert.equal(hash(bytes), item.before.sha256, 'Original backup digest changed');
    }
    if (rollback) {
      assert.equal(hash(json(appliedReport)), expectedApplySha256);
      assert.equal(appliedReport.contract, 'api-documentation-exact-apply-v1');
      assert.equal(appliedReport.status, 'APPLIED-STATIC-DOCUMENTATION-NATIVE-ACCEPTANCE-PENDING');
      assert.equal(appliedReport.planSha256, expectedPlanSha256);
      assert.equal(appliedReport.epoch, plan.epoch);
    }
    await guard();
    equal(await io.preserve(plan.epoch), plan.preserved);
    journal.fixed('mutation-intent.private.json', { rollback, epoch: plan.epoch, planSha256: expectedPlanSha256,
      lock: lock.witness, trustedExclusiveWriterWindow: true });
    intent = true;
    if (rollback) {
      report.directories = appliedReport.directories;
      await recover(appliedReport.ledger);
      assert.ok(!report.recovery.some(row => row.status.includes('RETAINED')));
      report.status = 'ROLLED-BACK-EXACT-DOCUMENTATION';
    } else {
      for (const index of [false, true]) for (const scope of scopes) {
        for (const item of plan.targets[scope].filter(row => (row.path === 'index.html') === index)) {
          const bytes = sealed.payload.get(item.path);
          assert.equal(hash(bytes), item.candidate.sha256);
          await install(scope, item, bytes, item.before);
          if (report.ledger.length % 50 === 0) console.log(JSON.stringify({
            stage: 'documentation-delta-published', files: report.ledger.length, scope, path: item.path,
          }));
        }
      }
      for (const item of plan.targets.container) {
        const response = await io.http(item.path);
        assert.equal(response.status, 200);
        assert.equal(hash(response.bytes), item.candidate.sha256, 'Served document bytes differ');
      }
      report.status = 'APPLIED-STATIC-DOCUMENTATION-NATIVE-ACCEPTANCE-PENDING';
    }
    equal(await io.preserve(plan.epoch), plan.preserved);
    await guard();
  } catch (error) {
    report.status = intent ? 'FAILED-MUTATION-CONDITIONAL-RECOVERY' : 'REFUSED-BEFORE-MUTATION';
    report.error = error.message;
    if (intent && !rollback) {
      await recover([...report.ledger]);
      try {
        assert.ok(!report.recovery.some(row => row.status.includes('RETAINED')));
        for (const scope of scopes) for (const item of plan.targets[scope]) {
          assert.ok(sameOriginal(await read(scope, item.path), item.before));
        }
        equal(await io.preserve(plan.epoch), plan.preserved);
        await guard();
        report.recoveryVerified = true;
      } catch (failure) { report.recoveryVerified = false; report.recoveryFailure = failure.message; }
    }
  } finally {
    report.finishedAt = new Date().toISOString();
    journal.fixed('report.private.json', report);
  }
  return report;
}

function shellGuard(variable, expected) {
  if (!expected.exists) return `test ! -e "$${variable}" && test ! -L "$${variable}"`;
  for (const key of ['uid', 'gid', 'dev', 'ino', 'bytes']) assert.match(String(expected[key]), /^\d+$/);
  assert.match(expected.mode, /^[0-7]{3,4}$/); assert.match(expected.sha256, /^[a-f0-9]{64}$/);
  return `test -f "$${variable}" && test ! -L "$${variable}"
test "$(stat -c '%u:%g:%a:%d:%i:%s' "$${variable}")" = '${expected.uid}:${expected.gid}:${expected.mode}:${expected.dev}:${expected.ino}:${expected.bytes}'
test "$(sha256sum "$${variable}" | cut -d ' ' -f 1)" = '${expected.sha256}'`;
}
function directoryMetadata(stat) {
  return { uid: String(stat.uid), gid: String(stat.gid), mode: (stat.mode & 0o7777).toString(8),
    dev: String(stat.dev), ino: String(stat.ino) };
}
function hostFile(relative) {
  safe(relative); assert.equal(fs.realpathSync(hostRoot), hostRoot);
  let current = hostRoot;
  for (const part of relative.split('/').slice(0, -1)) {
    current = path.join(current, part);
    try { const stat = fs.lstatSync(current); assert.ok(stat.isDirectory() && !stat.isSymbolicLink()); }
    catch (error) { if (error.code === 'ENOENT') return null; throw error; }
  }
  return path.join(hostRoot, relative);
}
export function createApiDocumentationActualIo(sealed, epoch) {
  const release = sealed.release, id = release.runtime.id;
  const paths = new Set(scopes.flatMap(scope => release.delta[scope].map(row => row.path)));
  const eligible = new Set([...paths].flatMap(relative => [relative, documentationPending(relative, epoch),
    documentationPending(relative, epoch, true)]));
  const ensure = relative => { safe(relative); assert.ok(eligible.has(relative), 'Unplanned document path'); };
  const walk = notificationContainerPathProgram;
  const docker = (args, input) => command('docker', args, input);
  const shell = (program, relative, input) => {
    ensure(relative);
    return docker(['exec', '-i', '--user', '0', id, 'sh', '-c', program, 'aibiz-api-documentation', '/dist/doc', relative], input);
  };
  const read = async (scope, relative) => {
    ensure(relative);
    if (scope === 'host') {
      const filename = hostFile(relative);
      if (filename === null) return { exists: false };
      let fd;
      try {
        fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        const stat = fs.fstatSync(fd);
        assert.ok(stat.isFile());
        return { exists: true, bytes: fs.readFileSync(fd), ...directoryMetadata(stat) };
      } catch (error) { if (error.code === 'ENOENT') return { exists: false }; throw error; }
      finally { if (fd !== undefined) fs.closeSync(fd); }
    }
    assert.equal(scope, 'container');
    const bytes = shell(`set -efu
root=$1; relative=$2; current=$root
test -d "$root" && test ! -L "$root"
old_ifs=$IFS; IFS=/; set -- $relative; IFS=$old_ifs
while test "$#" -gt 1; do
 current="$current/$1"
 if test ! -e "$current" && test ! -L "$current"; then printf 'ABSENT\\n'; exit 0; fi
 test -d "$current" && test ! -L "$current"
 shift
done
target="$current/$1"; test ! -L "$target"
if test ! -e "$target"; then printf 'ABSENT\\n'; exit 0; fi
test -f "$target"; printf 'FILE '; stat -c '%u %g %a %d %i %s' "$target"; cat "$target"`, relative);
    const newline = bytes.indexOf(10), header = bytes.subarray(0, newline).toString();
    if (header === 'ABSENT') return { exists: false };
    const match = header.match(/^FILE (\d+) (\d+) ([0-7]+) (\d+) (\d+) (\d+)$/);
    assert.ok(match);
    const content = bytes.subarray(newline + 1); assert.equal(content.length, Number(match[6]));
    return { exists: true, uid: match[1], gid: match[2], mode: match[3], dev: match[4], ino: match[5], bytes: content };
  };
  const roots = async () => {
    const host = fs.lstatSync(hostRoot); assert.ok(host.isDirectory() && !host.isSymbolicLink());
    const fields = docker(['exec', id, 'sh', '-c', 'test -d /dist/doc && test ! -L /dist/doc; stat -c "%u %g %a %d %i" /dist/doc'])
      .toString().trim().split(' ');
    assert.equal(fields.length, 5);
    return { host: directoryMetadata(host), container: Object.fromEntries(['uid', 'gid', 'mode', 'dev', 'ino'].map((key, i) => [key, fields[i]])) };
  };
  const observe = async () => {
    const value = apiDocumentationRuntimeWitness(JSON.parse(docker(['inspect', id]))[0]);
    for (const [relative, expected] of Object.entries(release.guarded)) {
      const current = relative.startsWith('host/')
        ? fs.readFileSync(path.join(workspace, 'plm-web/dist', relative.slice(5)))
        : docker(['exec', id, 'cat', relative.startsWith('container/') ? `/dist/${relative.slice(10)}` : relative]);
      assert.equal(hash(current), expected, 'Preserved application input drift');
    }
    return value;
  };
  const ensureParents = async (scope, relative, parent) => {
    ensure(relative);
    assert.ok(scopes.includes(scope));
    for (const key of ['uid', 'gid']) assert.match(parent[key], /^\d+$/);
    const directories = [], parts = relative.split('/').slice(0, -1);
    let current = '';
    for (const part of parts) {
      current = path.posix.join(current, part);
      if (scope === 'host') {
        const filename = path.join(hostRoot, current);
        try { const stat = fs.lstatSync(filename); assert.ok(stat.isDirectory() && !stat.isSymbolicLink()); }
        catch (error) {
          if (error.code !== 'ENOENT') throw error;
          fs.mkdirSync(filename, { mode: 0o755 }); fs.chownSync(filename, Number(parent.uid), Number(parent.gid));
          syncDirectory(path.dirname(filename));
          directories.push({ scope, path: current, ...directoryMetadata(fs.lstatSync(filename)) });
        }
      } else {
        const target = `/dist/doc/${current}`;
        const output = docker(['exec', '--user', '0', id, 'sh', '-c', `set -efu
target=$1
if test -e "$target" || test -L "$target"; then test -d "$target" && test ! -L "$target"
else mkdir -- "$target"; chown '${parent.uid}:${parent.gid}' "$target"; chmod 755 "$target"; printf 'CREATED '; stat -c '%u %g %a %d %i' "$target"; sync "$(dirname "$target")"; fi`, 'doc-parent', target]).toString().trim();
        if (output) {
          const values = output.replace(/^CREATED /, '').split(' ');
          assert.equal(values.length, 5);
          directories.push({ scope, path: current, ...Object.fromEntries(['uid', 'gid', 'mode', 'dev', 'ino'].map((key, i) => [key, values[i]])) });
        }
      }
    }
    return directories;
  };
  const hostMutation = (action, relative, pending, before, staged, bytes) => command(process.execPath,
    ['-e', notificationHostMutationProgram, hostRoot, action, relative, pending, JSON.stringify(before), JSON.stringify(staged)], bytes);
  return { read, observe, rootMetadata: roots, ensureParents,
    async preserve() {
      const host = [];
      const visit = (directory, relative = '') => {
        for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
          const name = path.posix.join(relative, entry.name); safe(name);
          assert.equal(entry.isSymbolicLink(), false);
          if (entry.isDirectory()) visit(path.join(directory, entry.name), name);
          else { assert.ok(entry.isFile()); if (!eligible.has(name)) host.push({ path: name, sha256: hash(fs.readFileSync(path.join(directory, entry.name))) }); }
        }
      };
      visit(hostRoot); host.sort((a, b) => a.path.localeCompare(b.path));
      const raw = docker(['exec', id, 'sh', '-c', notificationContainerInventoryProgram.replaceAll('/dist', '/dist/doc')]);
      const container = parseNotificationContainerInventory(raw).map(row => ({ path: row.path.slice('doc/'.length), sha256: row.sha256 }))
        .filter(row => !eligible.has(row.path));
      return { host: { files: host.length, sha256: hash(json(host)) }, container: { files: container.length, sha256: hash(json(container)) } };
    },
    async stage(scope, relative, bytes, desired) {
      ensure(relative);
      desired = normalizeNotificationFileMetadata(desired, true);
      if (scope === 'host') return hostMutation('stage', relative, '', { exists: false }, desired, bytes);
      shell(`${walk}
test ! -e "$target" && test ! -L "$target"
umask 077; set -C; exec 3>"$target"
owned="$(stat -Lc '%d:%i' /proc/$$/fd/3)"
cat >&3
chown '${desired.uid}:${desired.gid}' /proc/$$/fd/3
chmod '${desired.mode}' /proc/$$/fd/3
test ! -L "$target" && test "$(stat -c '%d:%i' "$target")" = "$owned"
sync "$target"; exec 3>&-; sync "$current"`, relative, bytes);
    },
    async publish(scope, pending, relative, before, staged) {
      ensure(relative); ensure(pending);
      if (scope === 'host') return hostMutation('publish', relative, pending, before, staged);
      shell(`${walk}
pending="$root/${pending}"
${shellGuard('pending', staged)}
${shellGuard('target', before)}
${before.exists ? 'mv -T -- "$pending" "$target"' : 'ln -T -- "$pending" "$target"\nrm -- "$pending"'}
${shellGuard('target', staged)}
sync "$target"; sync "$current"`, relative);
    },
    async remove(scope, relative, expected) {
      ensure(relative);
      if (scope === 'host') return hostMutation('remove', relative, '', expected, {});
      shell(`${walk}
${shellGuard('target', expected)}
rm -- "$target"; sync "$current"`, relative);
    },
    async removeEmptyDirectory(row) {
      safe(row.path);
      assert.ok([...paths].some(relative => relative.startsWith(`${row.path}/`)));
      if (row.scope === 'host') {
        const filename = path.join(hostRoot, row.path), stat = fs.lstatSync(filename);
        equal(directoryMetadata(stat), Object.fromEntries(['uid', 'gid', 'mode', 'dev', 'ino'].map(key => [key, row[key]])));
        assert.ok(stat.isDirectory() && !stat.isSymbolicLink()); fs.rmdirSync(filename); syncDirectory(path.dirname(filename));
      } else docker(['exec', '--user', '0', id, 'sh', '-c', `set -efu
target=$1; test -d "$target" && test ! -L "$target"
test "$(stat -c '%u:%g:%a:%d:%i' "$target")" = '${row.uid}:${row.gid}:${row.mode}:${row.dev}:${row.ino}'
rmdir -- "$target"; sync "$(dirname "$target")"`, 'doc-empty-directory', `/dist/doc/${row.path}`]);
    },
    async http(relative) {
      assert.ok(paths.has(relative));
      const response = await fetch(`http://127.0.0.1:30250${release.prefix}${relative}`, {
        redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(15_000),
      });
      return { status: response.status, bytes: Buffer.from(await response.arrayBuffer()) };
    } };
}

export async function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({ args: argv, options: {
    prepare: { type: 'boolean' }, apply: { type: 'boolean' }, rollback: { type: 'boolean' },
    candidate: { type: 'string' }, 'candidate-sha256': { type: 'string' },
    plan: { type: 'string' }, 'plan-sha256': { type: 'string' },
    'apply-receipt': { type: 'string' }, 'apply-receipt-sha256': { type: 'string' },
    output: { type: 'string' }, 'trusted-exclusive-writer-window': { type: 'boolean' },
  }, strict: true });
  assert.equal([values.prepare, values.apply, values.rollback].filter(Boolean).length, 1);
  const output = path.resolve(values.output);
  const journal = journalAt(output), lock = acquireNotificationDeploymentLock();
  try {
    let plan, preparedDirectory, expectedPlanSha256;
    if (!values.prepare) {
      const planPath = path.resolve(values.plan);
      assert.equal(path.basename(planPath), 'prepared.private.json');
      preparedDirectory = fs.realpathSync(path.dirname(planPath));
      assert.equal(path.dirname(preparedDirectory), artifacts);
      const bytes = privateRead(planPath);
      assert.equal(hash(bytes), values['plan-sha256']);
      plan = JSON.parse(bytes); expectedPlanSha256 = hash(bytes);
      for (const item of plan.sourceSeal) {
        assert.equal(hash(privateRead(path.join(preparedDirectory, 'sources', item.path))), item.sha256);
      }
    }
    const sealed = loadApiDocumentationRelease(values.prepare ? values.candidate : plan.releaseDirectory,
      values.prepare ? values['candidate-sha256'] : plan.releaseSha256);
    const epoch = plan?.epoch ?? randomUUID(), io = createApiDocumentationActualIo(sealed, epoch);
    if (values.prepare) {
      plan = await prepareApiDocumentationInstall({ sealed, io, journal, lock, epoch });
      console.log(JSON.stringify({ status: plan.status, epoch, output, planSha256: hash(json(plan)), sharedOutputChanged: false }));
    } else {
      const appliedBytes = values.rollback ? privateRead(path.resolve(values['apply-receipt'])) : null;
      if (appliedBytes) assert.equal(hash(appliedBytes), values['apply-receipt-sha256']);
      const report = await mutateApiDocumentation({ plan, sealed, io, journal, lock, expectedPlanSha256,
        trustedExclusiveWriterWindow: values['trusted-exclusive-writer-window'] === true,
        originalBytes(scope, relative) {
          const bytes = privateRead(path.join(preparedDirectory, 'original', scope, relative));
          const expected = plan.targets[scope].find(row => row.path === relative).before;
          assert.equal(hash(bytes), expected.sha256); assert.equal(bytes.length, expected.bytes);
          return bytes;
        }, rollback: values.rollback === true,
        appliedReport: appliedBytes ? JSON.parse(appliedBytes) : undefined,
        expectedApplySha256: values['apply-receipt-sha256'] });
      console.log(JSON.stringify({ status: report.status, output, writes: report.ledger.filter(row => row.installed).length,
        recovery: report.recovery.length, error: report.error ?? null, parentAcceptance: false }));
      if (!['APPLIED-STATIC-DOCUMENTATION-NATIVE-ACCEPTANCE-PENDING', 'ROLLED-BACK-EXACT-DOCUMENTATION'].includes(report.status)) process.exitCode = 1;
    }
  } finally { lock.release(); }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
