#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  acquireNotificationDeploymentLock, normalizeNotificationFileMetadata,
  notificationHostMutationProgram, notificationContainerInventoryProgram,
  parseNotificationContainerInventory,
} from './deploy-existing-plm-notification-style.mjs';
import { reviewGuardStartup, guardStartupEnvironmentProgram } from './deploy-existing-plm-guard-overlay.mjs';
import { languageSourceInventory } from './prepare-plm-language-runtime-candidate.mjs';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = path.join(workspace, '.artifacts');
const hostDist = path.join(workspace, 'plm-web/dist');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const scopes = ['host', 'container'];
const hash = /^[a-f0-9]{64}$/;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
export const languageDeploymentSeals = Object.freeze({
  manifest: '271fc7444d0a20b573faa53059c4e60869a2d29a5be1ec8702ed53978e3f0d58',
  revision: '85bb771e88717181',
  originalIndex: 'e3fb42281e0eeb22c128c94fb8c4f65e6e843212705431e75f0c6e15fdb33a19',
  newIndex: '1c43304ba453019479697ac5d5fdc2d66bfe3da140ea8e9aae91149ffc9aed5e',
  captionManifest: 'ed9f89bbbdbbaffa9d09b8918f3c140aea6048f7ec48c7f06991ae5becd071e9',
  layoutManifest: '97d73a02e4db6d3ac92799e139f8b63222600a9606eaa8213e75a7dff991d2e6',
  captionIndex: 'ed62777f1bb743fdd9e1c2ac1592c3f48947e7c865e70229356541851b22b8de',
  container: '70327c269425370bed8648bcaa90feadf441ff7a6c5f75b975889cf4c5416612',
  image: 'sha256:027de06a1f8d8d5e44e17b849d44d39a421c6fe0787433b5e229ba00655ca99c',
});
const toolFiles = [
  'scripts/deploy-existing-plm-language-runtime.mjs',
  'scripts/tests/deploy-existing-plm-language-runtime.test.mjs',
  'scripts/deploy-existing-plm-notification-style.mjs',
  'scripts/deploy-existing-plm-guard-overlay.mjs',
  'scripts/prepare-plm-language-runtime-candidate.mjs',
  'scripts/prepare-plm-caption-entry.mjs',
  'scripts/prepare-plm-view-theme-layout.mjs',
];
const sourceSeal = () => toolFiles.map(relative => ({ path: relative,
  sha256: sha(fs.readFileSync(path.join(workspace, relative))) }));

function safe(relative) {
  assert.ok(relative && !path.isAbsolute(relative) && !/[\0\\\r\n]/.test(relative));
  assert.ok(relative.split('/').every(part => part && part !== '.' && part !== '..'));
}
function privateRead(filename) {
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const info = fs.fstatSync(fd);
    assert.ok(info.isFile() && info.uid === process.geteuid() && (info.mode & 0o077) === 0);
    return fs.readFileSync(fd);
  } finally { fs.closeSync(fd); }
}
function syncDir(directory) {
  const fd = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function journalAt(output) {
  assert.equal(fs.realpathSync(path.dirname(output)), artifacts);
  assert.match(path.basename(output), /^plm-language-(?:prepare|apply|rollback)-[a-z0-9-]+$/);
  fs.mkdirSync(output, { mode: 0o700 });
  syncDir(artifacts);
  let sequence = 0;
  const bytes = (relative, value) => {
    safe(relative);
    const filename = path.join(output, relative);
    fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
    const fd = fs.openSync(filename, 'wx', 0o600);
    try { fs.writeFileSync(fd, value); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    for (let directory = path.dirname(filename); directory.startsWith(output); directory = path.dirname(directory)) {
      syncDir(directory);
      if (directory === output) break;
    }
  };
  return { bytes, fixed: (name, value) => bytes(name, json(value)), event(stage, data) {
    bytes(`event-${String(++sequence).padStart(4, '0')}-${stage}.private.json`,
      json({ stage, ...data, at: new Date().toISOString() }));
  } };
}
export function languagePending(relative, epoch, rollback = false) {
  safe(relative);
  assert.match(epoch, uuid);
  return `${relative}.aibiz-language-${epoch}${rollback ? '-rollback' : ''}.pending`;
}
function compact(value) {
  return value.exists ? normalizeNotificationFileMetadata({ ...value,
    bytes: value.bytes.length, sha256: sha(value.bytes) }) : { exists: false };
}
function exact(actual, expected, message = 'Exact file drift') {
  assert.deepEqual(actual, expected.exists ? normalizeNotificationFileMetadata(expected) : { exists: false }, message);
}
function owned(actual, expected) {
  if (!actual.exists || !expected?.exists) return false;
  try { exact(actual, expected); return true; } catch { return false; }
}
export function loadLanguageDeploymentCandidate(directory) {
  assert.equal(fs.realpathSync(path.dirname(directory)), artifacts);
  assert.equal(fs.realpathSync(directory), directory);
  const layout = fs.existsSync(path.join(directory, 'view-theme-layout-candidate.private.json'));
  const caption = fs.existsSync(path.join(directory, 'caption-entry-candidate.private.json'));
  assert.ok(!(layout && caption));
  const bytes = privateRead(path.join(directory, layout ? 'view-theme-layout-candidate.private.json'
    : caption ? 'caption-entry-candidate.private.json' : 'language-runtime-candidate.private.json'));
  assert.equal(sha(bytes), layout ? languageDeploymentSeals.layoutManifest
    : caption ? languageDeploymentSeals.captionManifest : languageDeploymentSeals.manifest);
  const manifest = JSON.parse(bytes);
  assert.equal(manifest.status, 'PREPARED-NOT-PUBLISHED');
  if (!caption && !layout) assert.equal(manifest.revision, languageDeploymentSeals.revision);
  if (layout) assert.equal(manifest.contract, 'plm-view-theme-layout-candidate-v1');
  assert.equal(manifest.files.length, caption || layout ? 2 : 18);
  assert.equal(manifest.files.at(-1).path, 'index.html');
  const prefix = `language-${manifest.revision}/`;
  for (const file of manifest.files) {
    safe(file.path);
    assert.ok(layout ? file.path === 'index.html' || file.path === manifest.cssPath
      : caption ? file.path === 'index.html' || file.path === manifest.appEntry
      : file.path === 'index.html' || file.path === manifest.mapPath ||
        file.path.startsWith(`extras/js/@ibiz-template/runtime/${prefix}`) ||
        file.path.startsWith(`extras/js/@ibiz-template/vue3-components/${prefix}`));
  }
  assert.equal(new Set(manifest.files.map(file => file.path)).size, caption || layout ? 2 : 18);
  const payload = new Map(manifest.files.map(file => {
    const value = privateRead(path.join(directory, 'overlay', file.path));
    assert.equal(sha(value), file.sha256);
    assert.equal(value.length, file.bytes);
    return [file.path, value];
  }));
  const originalIndex = privateRead(path.join(directory, 'rollback/index.html'));
  assert.equal(sha(originalIndex), layout ? languageDeploymentSeals.captionIndex
    : caption ? languageDeploymentSeals.newIndex : languageDeploymentSeals.originalIndex);
  assert.equal(sha(originalIndex), manifest.originalIndexSha256);
  if (!caption && !layout) assert.equal(sha(payload.get('index.html')), languageDeploymentSeals.newIndex);
  const originalMap = privateRead(path.join(directory, 'rollback', manifest.activeOriginalEntries.importMap));
  assert.equal(sha(originalMap), manifest.originalMapSha256);
  const verifySources = () => {
    assert.equal(sha(privateRead(path.join(directory, 'executed-preparer.private.mjs'))), manifest.preparerSha256);
    assert.equal(sha(fs.readFileSync(path.join(workspace, layout ? 'scripts/prepare-plm-view-theme-layout.mjs'
      : caption ? 'scripts/prepare-plm-caption-entry.mjs'
      : 'scripts/prepare-plm-language-runtime-candidate.mjs'))),
      manifest.preparerSha256);
    for (const item of manifest.source) {
      const current = path.join(workspace, caption ? item.package : `ibiz-app-hub/${item.package}`);
      assert.deepEqual(languageSourceInventory(current), item.files);
      assert.deepEqual(languageSourceInventory(path.join(directory, 'snapshot', item.package)), item.files);
    }
    for (const item of manifest.tools ?? []) assert.equal(sha(fs.readFileSync(item.path)), item.sha256);
    for (const item of manifest.sourceFiles ?? []) {
      safe(item.path);
      assert.equal(sha(fs.readFileSync(path.join(workspace, item.path))), item.sha256);
      assert.equal(sha(privateRead(path.join(directory, 'snapshot', item.path))), item.sha256);
    }
  };
  verifySources();
  return { directory, manifest, payload, originalIndex, originalMap, verifySources,
    files: manifest.files, manifestSha256: sha(bytes) };
}

export async function prepareLanguageDeployment({ sealed, io, journal, lock, epoch = randomUUID() }) {
  lock.assertHeld();
  sealed.verifySources();
  assert.match(epoch, uuid);
  const sources = sourceSeal();
  for (const item of sources) journal.bytes(`sources/${item.path}`, fs.readFileSync(path.join(workspace, item.path)));
  const observation = await io.observe();
  const preserved = await io.preserve(epoch);
  const targets = {};
  for (const scope of scopes) {
    targets[scope] = {};
    for (const file of sealed.files) {
      const current = await io.read(scope, file.path);
      const info = compact(current);
      if (file.path === 'index.html') {
        assert.equal(info.sha256, sealed.manifest.originalIndexSha256);
        journal.bytes(`backup/${scope}/index.html`, current.bytes);
      } else assert.equal(info.exists, false, `New target already exists: ${scope}:${file.path}`);
      targets[scope][file.path] = info;
      for (const restoring of [false, true]) assert.equal((await io.read(scope,
        languagePending(file.path, epoch, restoring))).exists, false);
    }
    const map = compact(await io.read(scope, sealed.manifest.activeOriginalEntries.importMap));
    assert.equal(map.sha256, sealed.manifest.originalMapSha256);
  }
  for (const relative of ['index.html', sealed.manifest.activeOriginalEntries.importMap]) {
    const response = await io.http(relative);
    assert.equal(response.status, 200);
    assert.equal(sha(response.bytes), relative === 'index.html' ? sealed.manifest.originalIndexSha256
      : sealed.manifest.originalMapSha256);
  }
  for (const file of sealed.files) journal.bytes(`payload/${file.path}`, sealed.payload.get(file.path));
  journal.fixed('preserved.private.json', preserved);
  assert.deepEqual(await io.preserve(epoch), preserved);
  assert.deepEqual(await io.observe(), observation);
  for (const scope of scopes) for (const file of sealed.files) exact(compact(await io.read(scope, file.path)),
    targets[scope][file.path], 'Target drift during prepare');
  sealed.verifySources();
  lock.assertHeld();
  const plan = { contract: 'plm-language-runtime-deployment-v1', status: 'PREPARED-NOT-APPLIED', epoch,
    candidate: sealed.directory, manifestSha256: sealed.manifestSha256, sourceSeal: sources,
    files: sealed.files, targets, observation, preserved,
    order: ['all-new-runtime-and-component-files', 'new-import-map', 'host-index-last', 'container-index-last'],
    concurrency: { cooperativeSharedLock: lock.witness.path, trustedExclusiveWriterWindowRequired: true,
      atomicCompareAndSwapClaimed: false, externalUncooperativeWriterProtectionClaimed: false },
    rollback: 'Only exact published epoch inode/dev/hash/uid/gid/mode; restore both indexes before removing verified new files',
    forbidden: ['nginx-edit', 'environment-edit', 'container-lifecycle', 'plugin-edit', 'model-edit',
      'plmwiki-edit', 'recursive-delete', 'old-import-map-overwrite'], functionalAcceptance: false,
    preparedAt: new Date().toISOString() };
  journal.fixed('prepared.private.json', plan);
  return plan;
}

export async function mutateLanguageDeployment({
  plan, sealed, io, journal, lock, expectedEpoch, expectedPlanSha256,
  trustedExclusiveWriterWindow, appliedReport, expectedApplySha256, rollback = false,
}) {
  const report = { contract: rollback ? 'plm-language-runtime-rollback-v1' : 'plm-language-runtime-apply-v1',
    epoch: plan?.epoch, planSha256: expectedPlanSha256, manifestSha256: sealed.manifestSha256,
    status: 'VALIDATING-NOT-YET-WRITING', mutations: [], recovery: [], transportErrors: [],
    functionalAcceptance: false, atomicCompareAndSwapClaimed: false, startedAt: new Date().toISOString() };
  const ledger = new Map();
  const key = (scope, relative) => `${scope}:${relative}`;
  const read = async (scope, relative) => compact(await io.read(scope, relative));
  const uncertain = async (scope, relative) => {
    try { return await read(scope, relative); } catch (error) { return { exists: null, error: error.message }; }
  };
  const guard = async () => {
    lock.assertHeld();
    assert.deepEqual(sourceSeal(), plan.sourceSeal);
    sealed.verifySources();
    assert.deepEqual(await io.observe(), plan.observation, 'Lifecycle/startup/configuration drift');
  };
  const install = async (scope, file, bytes, before, restoring = false) => {
    await guard();
    const pending = languagePending(file.path, plan.epoch, restoring);
    exact(await read(scope, file.path), before);
    assert.equal((await read(scope, pending)).exists, false);
    const original = plan.targets[scope]['index.html'];
    const desired = { exists: true, bytes: bytes.length, sha256: sha(bytes), uid: original.uid,
      gid: original.gid, mode: file.path === 'index.html' ? original.mode : '644' };
    journal.event('before-stage', { scope, path: file.path, pending, before, desired });
    try { await io.stage(scope, pending, bytes, desired); }
    catch (error) {
      journal.event('uncertain-stage', { scope, pending, error: error.message, actual: await uncertain(scope, pending) });
      throw error;
    }
    const staged = await read(scope, pending);
    for (const field of ['sha256', 'bytes', 'uid', 'gid', 'mode']) assert.equal(staged[field], desired[field]);
    ledger.set(key(scope, pending), staged);
    journal.event('verified-stage', { scope, pending, staged });
    await guard();
    exact(await read(scope, file.path), before);
    journal.event('before-publish', { scope, path: file.path, pending, before, staged });
    try { await io.publish(scope, pending, file.path, before, staged); }
    catch (error) {
      const actual = await uncertain(scope, file.path), stage = await uncertain(scope, pending);
      const committed = owned(actual, staged) && stage.exists === false;
      report.transportErrors.push({ scope, path: file.path, error: error.message, actual, stage, committed });
      journal.event('uncertain-publication', report.transportErrors.at(-1));
      if (!restoring || !committed) throw error;
    }
    exact(await read(scope, file.path), staged);
    assert.equal((await read(scope, pending)).exists, false);
    ledger.set(key(scope, file.path), staged);
    journal.event('published', { scope, path: file.path, ...staged });
    return staged;
  };
  const remove = async (scope, relative, expected) => {
    await guard();
    exact(await read(scope, relative), expected);
    journal.event('before-remove', { scope, path: relative, expected });
    try { await io.remove(scope, relative, expected); }
    catch (error) {
      const actual = await uncertain(scope, relative);
      report.transportErrors.push({ scope, path: relative, error: error.message, actual });
      journal.event('uncertain-removal', report.transportErrors.at(-1));
      if (actual.exists !== false) throw error;
    }
    assert.equal((await read(scope, relative)).exists, false);
  };
  let intent = false;
  const restore = async published => {
    const originals = new Map();
    for (const scope of [...scopes].reverse()) {
      try {
        await guard();
        const actual = await read(scope, 'index.html');
        let result;
        if (owned(actual, plan.targets[scope]['index.html'])) result = actual;
        else {
          const expected = published.get(key(scope, 'index.html'));
          assert.ok(owned(actual, expected), 'Unknown index retained');
          result = await install(scope, { path: 'index.html' }, sealed.originalIndex, actual, true);
        }
        originals.set(scope, result);
        report.recovery.push({ scope, path: 'index.html', status: 'ORIGINAL-VERIFIED', ...result });
      } catch (error) { report.recovery.push({ scope, path: 'index.html', status: 'RETAINED', error: error.message }); }
    }
    const verifyOriginals = async () => {
      for (const scope of scopes) {
        assert.ok(originals.has(scope), 'Both original indexes required before dependency cleanup');
        exact(await read(scope, 'index.html'), originals.get(scope));
      }
    };
    for (const scope of scopes) {
      for (const file of [...sealed.files].reverse().filter(file => file.path !== 'index.html')) {
        try {
          await verifyOriginals();
          const current = await read(scope, file.path);
          if (current.exists) {
            assert.ok(owned(current, published.get(key(scope, file.path))), 'Unknown new file retained');
            await remove(scope, file.path, current);
          }
          report.recovery.push({ scope, path: file.path, status: 'ABSENT-OR-REMOVED' });
        } catch (error) { report.recovery.push({ scope, path: file.path, status: 'RETAINED', error: error.message }); }
      }
    }
    for (const scope of scopes) for (const file of sealed.files) for (const restoring of [false, true]) {
      const relative = languagePending(file.path, plan.epoch, restoring);
      try {
        const current = await read(scope, relative);
        if (!current.exists) continue;
        assert.ok(owned(current, ledger.get(key(scope, relative))), 'Unknown stage retained');
        await remove(scope, relative, current);
      } catch (error) { report.recovery.push({ scope, path: relative, status: 'RETAINED', error: error.message }); }
    }
    report.recoveryStatus = report.recovery.some(item => item.status === 'RETAINED')
      ? 'INCOMPLETE-RETAINED' : 'BOTH-ORIGINAL-INDEXES-RESTORED-OWNED-NEW-FILES-REMOVED';
    if (report.recoveryStatus === 'BOTH-ORIGINAL-INDEXES-RESTORED-OWNED-NEW-FILES-REMOVED') {
      assert.deepEqual(await io.preserve(plan.epoch), plan.preserved);
      const response = await io.http('index.html');
      assert.equal(response.status, 200);
      assert.equal(sha(response.bytes), sealed.manifest.originalIndexSha256);
    }
  };
  try {
    assert.equal(plan.contract, 'plm-language-runtime-deployment-v1');
    assert.equal(plan.status, 'PREPARED-NOT-APPLIED');
    assert.equal(plan.epoch, expectedEpoch);
    assert.match(expectedEpoch ?? '', uuid);
    assert.match(expectedPlanSha256 ?? '', hash);
    assert.equal(sha(json(plan)), expectedPlanSha256);
    assert.equal(plan.manifestSha256, sealed.manifestSha256);
    assert.ok([languageDeploymentSeals.manifest, languageDeploymentSeals.captionManifest,
      languageDeploymentSeals.layoutManifest].includes(sealed.manifestSha256));
    assert.deepEqual(plan.files, sealed.files);
    assert.equal(trustedExclusiveWriterWindow, true);
    await guard();
    assert.deepEqual(await io.preserve(plan.epoch), plan.preserved);
    const published = new Map();
    if (rollback) {
      assert.match(expectedApplySha256 ?? '', hash);
      assert.equal(sha(json(appliedReport)), expectedApplySha256);
      assert.equal(appliedReport.status, 'APPLIED-STATIC-BUSINESS-ACCEPTANCE-PENDING');
      assert.equal(appliedReport.contract, 'plm-language-runtime-apply-v1');
      assert.equal(appliedReport.epoch, plan.epoch);
      assert.equal(appliedReport.planSha256, expectedPlanSha256);
      assert.equal(appliedReport.mutations.length, sealed.files.length * 2);
      for (const item of appliedReport.mutations) published.set(key(item.scope, item.path), item);
      assert.equal(published.size, sealed.files.length * 2);
    }
    for (const scope of scopes) for (const file of sealed.files) {
      exact(await read(scope, file.path), rollback ? published.get(key(scope, file.path)) : plan.targets[scope][file.path]);
      for (const restoring of [false, true]) assert.equal((await read(scope,
        languagePending(file.path, plan.epoch, restoring))).exists, false);
    }
    journal.fixed(rollback ? 'rollback-intent.private.json' : 'apply-intent.private.json',
      { ...report, plan, lock: lock.witness, expectedApplySha256 });
    intent = true;
    if (rollback) {
      await restore(published);
      assert.equal(report.recoveryStatus, 'BOTH-ORIGINAL-INDEXES-RESTORED-OWNED-NEW-FILES-REMOVED');
      report.status = 'ROLLED-BACK-EXACT-EPOCH';
    } else {
      for (const file of sealed.files) for (const scope of scopes) {
        const actual = await install(scope, file, sealed.payload.get(file.path), plan.targets[scope][file.path]);
        report.mutations.push({ scope, path: file.path, ...actual });
      }
      for (const item of report.mutations) exact(await read(item.scope, item.path), item);
      for (const file of sealed.files) {
        const response = await io.http(file.path);
        assert.equal(response.status, 200, `HTTP failure: ${file.path}`);
        assert.equal(sha(response.bytes), file.sha256, `HTTP bytes differ: ${file.path}`);
        journal.event('http-readback', { path: file.path, sha256: sha(response.bytes), bytes: response.bytes.length });
      }
      assert.deepEqual(await io.preserve(plan.epoch), plan.preserved);
      await guard();
      report.status = 'APPLIED-STATIC-BUSINESS-ACCEPTANCE-PENDING';
    }
    return report;
  } catch (error) {
    report.status = intent ? (rollback ? 'FAILED-ROLLBACK-RETAINED' : 'FAILED-APPLY-CONDITIONAL-RECOVERY')
      : 'REFUSED-BEFORE-MUTATION';
    report.error = error.message;
    if (intent && !rollback) {
      const published = new Map();
      for (const scope of scopes) for (const file of sealed.files) {
        const expected = ledger.get(key(scope, languagePending(file.path, plan.epoch)));
        if (expected) published.set(key(scope, file.path), expected);
      }
      try { await restore(published); }
      catch (recoveryError) { report.recoveryStatus = 'INCOMPLETE-RETAINED'; report.recoveryError = recoveryError.message; }
    }
    throw Object.assign(error, { evidence: report });
  } finally {
    report.finishedAt = new Date().toISOString();
    journal.fixed('report.private.json', report);
  }
}

const walk = `set -efu
set -f
root=$1
relative=$2
create=$3
test -d "$root" && test ! -L "$root"
current=$root
old_ifs=$IFS
IFS=/
set -- $relative
IFS=$old_ifs
while test "$#" -gt 1; do
  current="$current/$1"
  test ! -L "$current"
  if test ! -e "$current"; then
    if test "$create" = yes; then mkdir -m 755 "$current"; sync "$(dirname "$current")"
    else printf 'ABSENT\\n'; exit 0; fi
  fi
  test -d "$current"
  shift
done
target="$current/$1"
test ! -L "$target"
`;
function shellGuard(variable, value) {
  const item = normalizeNotificationFileMetadata(value);
  if (!item.exists) return `test ! -e "$${variable}" && test ! -L "$${variable}"`;
  return `test -f "$${variable}" && test ! -L "$${variable}"
test "$(stat -c '%u:%g:%a:%d:%i:%s' "$${variable}")" = '${item.uid}:${item.gid}:${item.mode}:${item.dev}:${item.ino}:${item.bytes}'
test "$(sha256sum "$${variable}" | cut -d ' ' -f 1)" = '${item.sha256}'`;
}
function hostInventory(root, excluded = new Set(), prefix = '') {
  const rows = [];
  for (const item of fs.readdirSync(path.join(root, prefix), { withFileTypes: true })) {
    const relative = path.posix.join(prefix, item.name);
    safe(relative);
    assert.ok(!item.isSymbolicLink());
    if (item.isDirectory()) rows.push(...hostInventory(root, excluded, relative));
    else if (!excluded.has(relative)) rows.push({ path: relative, sha256: sha(fs.readFileSync(path.join(root, relative))) });
  }
  return rows.sort((a, b) => a.path.localeCompare(b.path));
}
export function createLanguageDeploymentIo(sealed) {
  const allowed = new Set([...sealed.files.map(file => file.path), sealed.manifest.activeOriginalEntries.importMap]);
  const check = relative => {
    safe(relative);
    if (allowed.has(relative)) return;
    const match = relative.match(/^(.*)\.aibiz-language-([a-f0-9-]+)(-rollback)?\.pending$/);
    assert.ok(match && allowed.has(match[1]) && uuid.test(match[2]));
  };
  const run = (program, args, input) => {
    const result = spawnSync(program, args, { input, timeout: 30_000, maxBuffer: 32 * 1024 * 1024 });
    assert.equal(result.status, 0, `${program} ${args[0]} failed: ${String(result.stderr ?? '').slice(0, 500)}`);
    return Buffer.from(result.stdout ?? '');
  };
  const id = languageDeploymentSeals.container;
  const docker = (args, input) => run('docker', args, input);
  const shell = (script, relative, create = 'no', input, user = '0') => {
    check(relative);
    return docker(['exec', '-i', '--user', user, id, 'sh', '-c', script, 'language-deploy', '/dist', relative, create], input);
  };
  const hostPath = (relative, create = false, owner) => {
    check(relative);
    assert.equal(fs.realpathSync(hostDist), hostDist);
    let current = hostDist;
    for (const part of relative.split('/').slice(0, -1)) {
      current = path.join(current, part);
      try {
        const stat = fs.lstatSync(current);
        assert.ok(stat.isDirectory() && !stat.isSymbolicLink());
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
        if (!create) return null;
        fs.mkdirSync(current, { mode: 0o755 });
        fs.chownSync(current, Number(owner.uid), Number(owner.gid));
        syncDir(path.dirname(current));
      }
    }
    return path.join(hostDist, relative);
  };
  const read = async (scope, relative) => {
    check(relative);
    if (scope === 'host') {
      const filename = hostPath(relative);
      if (!filename) return { exists: false };
      let fd;
      try {
        fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        const stat = fs.fstatSync(fd, { bigint: true });
        assert.ok(stat.isFile());
        return { exists: true, bytes: fs.readFileSync(fd), uid: String(stat.uid), gid: String(stat.gid),
          mode: (stat.mode & 0o7777n).toString(8), dev: String(stat.dev), ino: String(stat.ino) };
      } catch (error) { if (error.code === 'ENOENT') return { exists: false }; throw error; }
      finally { if (fd !== undefined) fs.closeSync(fd); }
    }
    assert.equal(scope, 'container');
    const bytes = shell(`${walk}
if test ! -e "$target"; then printf 'ABSENT\\n'; exit 0; fi
test -f "$target"
printf 'FILE '
stat -c '%u %g %a %d %i %s' "$target"
cat "$target"`, relative);
    const separator = bytes.indexOf(10), header = bytes.subarray(0, separator).toString();
    if (header === 'ABSENT') return { exists: false };
    const match = header.match(/^FILE (\d+) (\d+) ([0-7]+) (\d+) (\d+) (\d+)$/);
    assert.ok(match);
    const value = bytes.subarray(separator + 1);
    assert.equal(value.length, Number(match[6]));
    return { exists: true, bytes: value, uid: match[1], gid: match[2], mode: match[3], dev: match[4], ino: match[5] };
  };
  const observe = async () => {
    const [container] = JSON.parse(docker(['inspect', id]));
    assert.equal(container.Id, id);
    assert.equal(container.Image, languageDeploymentSeals.image);
    assert.equal(container.Name, '/plmweb');
    assert.equal(container.State.Status, 'running');
    assert.equal(container.Config.Labels?.['com.docker.compose.service'], 'plmweb');
    const mounts = [...container.Mounts].sort((a, b) => a.Destination.localeCompare(b.Destination));
    for (const [destination, source] of [['/opt/aibiz/local-dist', hostDist],
      ['/opt/aibiz/local-plugins', path.join(workspace, 'plm-web/public/plugins')],
      ['/app/model', path.join(workspace, 'plm/model')]]) {
      assert.ok(mounts.some(item => item.Type === 'bind' && item.Destination === destination && item.Source === source && !item.RW));
    }
    assert.ok(!mounts.some(item => item.Destination === '/dist' || item.Destination.startsWith('/dist/')));
    const startup = docker(['exec', id, 'cat', '/start.sh']);
    const review = reviewGuardStartup(startup.toString());
    assert.equal(sha(fs.readFileSync(path.join(workspace, 'plm-web/start.sh'))), review.sha256);
    const environmentSource = fs.readFileSync(path.join(hostDist, 'environments/environment.js'));
    const environment = docker(['exec', id, 'cat', '/dist/environments/environment.js']);
    const configuration = docker(['exec', id, 'cat', '/environment.config']);
    const rendered = docker(['exec', '-i', '--env', 'LC_ALL=C', id, 'awk', '-F:',
      guardStartupEnvironmentProgram(startup.toString()), '/environment.config', '-'], environmentSource);
    assert.equal(sha(rendered), sha(environment));
    const nginx = docker(['exec', id, 'nginx', '-T']);
    return { id, image: container.Image, startedAt: container.State.StartedAt, restartCount: container.RestartCount,
      mounts, configurationSha256: sha(json({ config: container.Config, host: container.HostConfig })),
      startup: review.sha256, hostStartup: review.sha256, environmentSource: sha(environmentSource),
      renderedEnvironment: sha(environment), environmentConfig: sha(configuration), nginxSha256: sha(nginx) };
  };
  const preserve = async epoch => {
    const excluded = new Set(sealed.files.flatMap(file => [file.path, languagePending(file.path, epoch),
      languagePending(file.path, epoch, true)]));
    const container = parseNotificationContainerInventory(
      docker(['exec', '--user', '0', id, 'sh', '-c', notificationContainerInventoryProgram]), excluded);
    const result = { hostDist: hostInventory(hostDist, excluded), containerDist: container,
      plugins: hostInventory(path.join(workspace, 'plm-web/public/plugins')),
      model: hostInventory(path.join(workspace, 'plm/model')) };
    if (sealed.manifest.contract === 'plm-caption-entry-candidate-v1') {
      const hostModules = new Map(result.hostDist.map(item => [item.path, item.sha256]));
      const liveModules = new Map(result.containerDist.map(item => [item.path, item.sha256]));
      for (const item of sealed.manifest.inherited) {
        assert.equal(hostModules.get(item.path), item.sha256, `Startup literal dependency drift: ${item.path}`);
        assert.equal(liveModules.get(item.path), item.sha256, `Live literal dependency drift: ${item.path}`);
      }
    }
    return Object.fromEntries(Object.entries(result).map(([name, inventory]) => [name,
      { files: inventory.length, sha256: sha(json(inventory)), inventory }]));
  };
  const hostMutation = (action, relative, pending, before, staged, bytes) => run(process.execPath,
    ['-e', notificationHostMutationProgram, hostDist, action, relative, pending, JSON.stringify(before), JSON.stringify(staged)], bytes);
  return { read, observe, preserve,
    async stage(scope, relative, bytes, metadata) {
      metadata = normalizeNotificationFileMetadata(metadata, true);
      if (scope === 'host') {
        hostPath(relative, true, metadata);
        return hostMutation('stage', relative, '', { exists: false }, metadata, bytes);
      }
      assert.equal(scope, 'container');
      shell(`${walk}
test ! -e "$target" && test ! -L "$target"
umask 077
set -C
exec 3>"$target"
owned="$(stat -Lc '%d:%i' /proc/$$/fd/3)"
dd conv=fsync status=none >&3
chown '${metadata.uid}:${metadata.gid}' /proc/$$/fd/3
chmod '${metadata.mode}' /proc/$$/fd/3
test ! -L "$target" && test "$(stat -c '%d:%i' "$target")" = "$owned"
sync "$target"
exec 3>&-
sync "$current"`, relative, 'yes', bytes, `${metadata.uid}:${metadata.gid}`);
    },
    async publish(scope, pending, relative, before, staged) {
      check(pending); check(relative);
      before = before.exists ? normalizeNotificationFileMetadata(before) : { exists: false };
      staged = normalizeNotificationFileMetadata(staged);
      if (scope === 'host') return hostMutation('publish', relative, pending, before, staged);
      const publication = before.exists ? 'mv -T -- "$pending" "$target"' : 'ln -T -- "$pending" "$target"\nrm -- "$pending"';
      shell(`${walk}
pending="$root/${pending}"
${shellGuard('pending', staged)}
${shellGuard('target', before)}
${publication}
${shellGuard('target', staged)}
sync "$target"
sync "$current"`, relative);
    },
    async remove(scope, relative, expected) {
      check(relative);
      expected = normalizeNotificationFileMetadata(expected);
      if (scope === 'host') return hostMutation('remove', relative, '', expected, {});
      shell(`${walk}
${shellGuard('target', expected)}
rm -- "$target"
sync "$current"`, relative);
    },
    async http(relative) {
      check(relative);
      const response = await fetch(`http://127.0.0.1:30250/ibizplm-plmweb/${relative}`, { signal: AbortSignal.timeout(20_000) });
      return { status: response.status, bytes: Buffer.from(await response.arrayBuffer()) };
    } };
}

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: {
    prepare: { type: 'boolean' }, apply: { type: 'boolean' }, rollback: { type: 'boolean' },
    candidate: { type: 'string' }, output: { type: 'string' }, plan: { type: 'string' },
    epoch: { type: 'string' }, 'plan-sha256': { type: 'string' },
    'apply-report': { type: 'string' }, 'apply-report-sha256': { type: 'string' },
    'trusted-exclusive-writer-window': { type: 'boolean' },
  } });
  assert.equal([values.prepare, values.apply, values.rollback].filter(Boolean).length, 1);
  assert.ok(values.output && path.isAbsolute(values.output));
  let plan, appliedReport;
  if (values.prepare) {
    assert.ok(values.candidate && path.isAbsolute(values.candidate));
    assert.equal(values['trusted-exclusive-writer-window'], undefined);
    for (const name of ['plan', 'epoch', 'plan-sha256', 'apply-report', 'apply-report-sha256']) assert.equal(values[name], undefined);
  } else {
    assert.equal(values['trusted-exclusive-writer-window'], true);
    assert.ok(values.plan && path.isAbsolute(values.plan));
    assert.equal(path.basename(values.plan), 'prepared.private.json');
    assert.equal(fs.realpathSync(path.dirname(path.dirname(values.plan))), artifacts);
    const bytes = privateRead(values.plan);
    assert.match(values['plan-sha256'] ?? '', hash);
    assert.equal(sha(bytes), values['plan-sha256']);
    plan = JSON.parse(bytes);
    if (values.rollback) {
      assert.ok(values['apply-report'] && path.isAbsolute(values['apply-report']));
      const bytes = privateRead(values['apply-report']);
      assert.equal(sha(bytes), values['apply-report-sha256']);
      appliedReport = JSON.parse(bytes);
    }
  }
  const lock = acquireNotificationDeploymentLock();
  try {
    const sealed = loadLanguageDeploymentCandidate(plan?.candidate ?? values.candidate);
    if (plan) {
      const directory = path.dirname(values.plan);
      assert.deepEqual(JSON.parse(privateRead(path.join(directory, 'preserved.private.json'))), plan.preserved);
      for (const file of sealed.files) assert.equal(sha(privateRead(path.join(directory, 'payload', file.path))), file.sha256);
      for (const scope of scopes) assert.equal(sha(privateRead(path.join(directory, 'backup', scope, 'index.html'))),
        sealed.manifest.originalIndexSha256);
      for (const item of plan.sourceSeal) assert.equal(sha(privateRead(path.join(directory, 'sources', item.path))), item.sha256);
    }
    const io = createLanguageDeploymentIo(sealed), journal = journalAt(values.output);
    const result = values.prepare ? await prepareLanguageDeployment({ sealed, io, journal, lock })
      : await mutateLanguageDeployment({ plan, sealed, io, journal, lock, expectedEpoch: values.epoch,
        expectedPlanSha256: values['plan-sha256'], trustedExclusiveWriterWindow: values['trusted-exclusive-writer-window'],
        rollback: values.rollback === true, appliedReport, expectedApplySha256: values['apply-report-sha256'] });
    console.log(JSON.stringify({ status: result.status, epoch: result.epoch, output: values.output,
      planSha256: plan ? values['plan-sha256'] : sha(privateRead(path.join(values.output, 'prepared.private.json'))),
      reportSha256: plan ? sha(privateRead(path.join(values.output, 'report.private.json'))) : undefined,
      functionalAcceptance: false }));
    return result;
  } finally { lock.release(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.stack); process.exitCode = 1; });
}
