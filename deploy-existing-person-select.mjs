#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  acquireNotificationDeploymentLock, normalizeNotificationFileMetadata, notificationContainerInventoryProgram,
  notificationContainerPathProgram, notificationHostMutationProgram, parseNotificationContainerInventory,
} from './deploy-existing-plm-notification-style.mjs';
import { guardStartupEnvironmentProgram, reviewGuardStartup } from './deploy-existing-plm-guard-overlay.mjs';
import { captionHtmlEntries } from './prepare-plm-caption-entry.mjs';
import { resolveGuardResource } from './prepare-plm-guard-overlay.mjs';
import { inspectPersonSelectRuntime, personSelectRef, personSelectTree } from './prepare-person-select-closeout.mjs';

const workspace = path.resolve(import.meta.dirname, '..');
const artifacts = path.join(workspace, '.artifacts');
const web = path.join(workspace, 'plm-web');
const sha = value => createHash('sha256').update(value).digest('hex');
const json = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const hash = /^[a-f0-9]{64}$/;
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const pluginPrefix = `plugins/${personSelectRef}/dist/`;
const sharedLock = path.join(artifacts, '.plm-notification-style-recovery.lock');
const origin = 'http://127.0.0.1:30250/ibizplm-plmweb/';
export const personDeploymentScopes = Object.freeze(['host-public', 'host-dist', 'container']);
export const personDeploymentFiles = Object.freeze([
  { path: 'assets/style.css', bytes: 7694, sha256: 'be1f9624149682e30486a94889182323ab2eeeeca39da053c2a4a5a2b29fbff1' },
  { path: 'style.css', bytes: 7694, sha256: 'be1f9624149682e30486a94889182323ab2eeeeca39da053c2a4a5a2b29fbff1' },
  { path: 'index.es.js', bytes: 28329, sha256: '2d28466b0dafd0f8fe0e5d3687d1db6aad7860fd9269c9ff6add487d7d339b46' },
  { path: 'index.legacy.js', bytes: 20467, sha256: 'fcdb109cf78b8dad3aac4be933e391ca099f9e4520078ccd6c63c4300e591420' },
].map(file => Object.freeze(file)));
export const personDeploymentDependencies = Object.freeze([
  '@ibiz-template/runtime', '@ibiz-template/vue3-util', 'vue', 'lodash-es', 'ramda', '@ibiz-template/core', 'qx-util',
]);
export const personDeploymentSeals = Object.freeze({
  report: 'a80541e362abf583e709df4739cd72ba019707bdde33dd1c795cb67f99745934',
  plan: '152942ba21c643e21445330f8d8a8ca0840710ab52c8516cc8f328d589e10503',
  verification: '068f9aaf0f3326ac73df5e04a4f2906dc5bd01a729a884823df73844944cd7d4',
  preparer: '90b8b0bb0bbc634cae1415b44576702815caec6570a9a39cd124cf98d152d4b1',
});
const toolPaths = [
  'scripts/deploy-existing-person-select.mjs', 'scripts/tests/deploy-existing-person-select.test.mjs',
  'scripts/deploy-existing-plm-notification-style.mjs', 'scripts/deploy-existing-plm-guard-overlay.mjs',
  'scripts/prepare-plm-caption-entry.mjs', 'scripts/prepare-plm-guard-overlay.mjs',
  'scripts/prepare-person-select-closeout.mjs', 'scripts/native-candidate-files.mjs',
];
const sourceSeal = () => toolPaths.map(relative => ({ path: relative,
  sha256: sha(fs.readFileSync(path.join(workspace, relative))) }));
const roots = {
  'host-public': path.join(web, 'public/plugins', personSelectRef, 'dist'),
  'host-dist': path.join(web, 'dist/plugins', personSelectRef, 'dist'),
  container: `/dist/${pluginPrefix}`.replace(/\/$/, ''),
};
function safe(relative) {
  assert.ok(typeof relative === 'string' && relative && !path.isAbsolute(relative) && !/[\0\\\r\n?#]/.test(relative));
  assert.ok(relative.split('/').every(item => item && item !== '.' && item !== '..'));
}
export function personPending(relative, epoch, rollback = false) {
  assert.ok(personDeploymentFiles.some(file => file.path === relative));
  assert.match(epoch, uuid);
  return `${relative}.aibiz-person-${epoch}${rollback ? '-rollback' : ''}.pending`;
}
export function validatePersonMutationPath(relative) {
  if (personDeploymentFiles.some(file => file.path === relative)) return;
  const match = relative?.match(/^(.*)\.aibiz-person-([a-f0-9-]+)(-rollback)?\.pending$/);
  assert.ok(match && personDeploymentFiles.some(file => file.path === match[1]) && uuid.test(match[2]),
    'Only the four reviewed 434 files and their exact epoch stages are eligible');
}
export function validatePersonDeploymentFiles(files) {
  assert.deepEqual(files, personDeploymentFiles, 'Only the reviewed four-file runtime delta is eligible');
}
export function validatePersonDependencyBindings(value) {
  assert.equal(value.records.length, 2);
  assert.deepEqual(value.records.map(row => row.kind), ['index', 'import-map']);
  assert.equal(value.records[0].path, 'index.html');
  assert.deepEqual(value.dependencies.map(row => row.reference), personDeploymentDependencies);
  for (const row of [...value.records, ...value.dependencies]) {
    safe(row.path); assert.match(row.sha256 ?? '', hash);
    assert.ok(Number.isSafeInteger(row.bytes) && row.bytes > 0);
    assert.equal(row.actualHttp, true);
  }
  assert.equal(value.recursiveRuntimeClosureClaimed, false);
  for (const row of value.dependencies) assert.equal(row.hostDistMatchesContainer, true);
}
const compact = value => value.exists ? normalizeNotificationFileMetadata({ ...value,
  bytes: value.bytes.length, sha256: sha(value.bytes) }) : { exists: false };
const exact = (actual, expected, message = 'Exact file or inode drift') =>
  assert.deepEqual(actual, normalizeNotificationFileMetadata(expected), message);
const owned = (actual, expected) => {
  if (!actual.exists || !expected?.exists) return false;
  try { exact(actual, expected); return true; } catch { return false; }
};
const key = (scope, relative) => `${scope}:${relative}`;
function privateRead(filename) {
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
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
  assert.match(path.basename(output), /^person-select-(?:prepare|apply|rollback)-[a-z0-9][a-z0-9-]{0,80}$/);
  fs.mkdirSync(output, { mode: 0o700 });
  syncDirectory(artifacts);
  let sequence = 0;
  const bytes = (relative, value) => {
    safe(relative);
    const filename = path.join(output, relative);
    fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
    const fd = fs.openSync(filename, 'wx', 0o600);
    try { fs.writeFileSync(fd, value); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    for (let directory = path.dirname(filename); ; directory = path.dirname(directory)) {
      syncDirectory(directory);
      if (directory === output) break;
    }
  };
  return { directory: output, bytes, fixed: (name, value) => bytes(name, json(value)), event(stage, value) {
    bytes(`event-${String(++sequence).padStart(4, '0')}-${stage}.private.json`,
      json({ stage, ...value, at: new Date().toISOString() }));
    console.log(JSON.stringify({ stage, sequence }));
  } };
}

export function loadPersonDeploymentCandidate(directory) {
  assert.equal(directory, path.join(artifacts, 'person-select-closeout-20261128-r4'));
  assert.equal(fs.realpathSync(directory), directory);
  const readJson = (name, expected) => {
    const bytes = privateRead(path.join(directory, name));
    assert.equal(sha(bytes), expected);
    return JSON.parse(bytes);
  };
  const report = readJson('report.private.json', personDeploymentSeals.report);
  const plan = readJson('plan.private.json', personDeploymentSeals.plan);
  const verified = readJson('verification.private.json', personDeploymentSeals.verification);
  assert.equal(report.status, 'PREPARED-REPRODUCIBLE-SINGLE-PLUGIN-DELTA-NOT-PUBLISHED');
  assert.equal(report.pluginRef, personSelectRef);
  assert.equal(verified.status, 'PASS');
  assert.equal(report.planSha256, personDeploymentSeals.plan);
  assert.deepEqual(report.first.inventory, report.second.inventory);
  assert.deepEqual(report.runtimeContract.generated.dependencies, personDeploymentDependencies);
  assert.equal(sha(privateRead(path.join(directory, 'executed-preparer.private.mjs'))), personDeploymentSeals.preparer);
  assert.equal(personSelectTree(path.join(directory, 'payload'), { ignore: new Set() }).fingerprint, report.payload.fingerprint);
  const payload = new Map(personDeploymentFiles.map(file => {
    const data = privateRead(path.join(directory, 'payload', pluginPrefix, file.path));
    assert.equal(data.length, file.bytes); assert.equal(sha(data), file.sha256);
    return [file.path, data];
  }));
  assert.deepEqual([...report.payload.entries].map(row => row.path).sort(),
    personDeploymentFiles.map(file => `${pluginPrefix}${file.path}`).sort());
  const verifyInputs = ({ full = false } = {}) => {
    const bindings = [];
    const bind = (filename, expected, relative = filename) => {
      const stat = fs.lstatSync(filename);
      assert.ok(stat.isFile() && !stat.isSymbolicLink());
      const value = sha(fs.readFileSync(filename));
      assert.equal(value, expected, `Candidate input drift: ${relative}`);
      bindings.push({ path: relative, sha256: value });
    };
    for (const item of plan.source.inventory.entries) {
      bind(path.join(web, plan.source.path, item.path), item.sha256, `plm-web/${plan.source.path}/${item.path}`);
      bind(path.join(directory, 'inputs/plm-web', plan.source.path, item.path), item.sha256,
        `snapshot/${plan.source.path}/${item.path}`);
    }
    assert.deepEqual(personSelectTree(path.join(web, plan.source.path)), plan.source.inventory);
    for (const item of plan.roots) {
      bind(path.join(web, item.path), item.workingCopySha256, `working/plm-web/${item.path}`);
      bind(path.join(directory, 'inputs/plm-web', item.path), item.sha256, `committed/${item.fromExactCommit}/${item.path}`);
    }
    for (const item of plan.evidenceBindings) {
      bind(item.path, item.sha256, item.relative);
      bind(path.join(directory, 'evidence-inputs', item.relative), item.sha256, `snapshot/${item.relative}`);
    }
    bind(path.join(workspace, 'scripts/prepare-person-select-closeout.mjs'), personDeploymentSeals.preparer,
      'scripts/prepare-person-select-closeout.mjs');
    const inputs = { bindings: [...bindings], sha256: sha(json(bindings)),
      toolchainBindings: plan.tools, offlineGuard: plan.guard,
      cachedDistributionFingerprint: plan.dependencies.fingerprint, recursiveDependencySourceClosureClaimed: false };
    if (full) {
      for (const item of plan.tools) bind(item.path, item.sha256);
      bind(plan.guard.path, plan.guard.sha256);
      for (const dependency of plan.dependencies.packages) {
        assert.deepEqual(personSelectTree(dependency.path,
          { ignore: new Set(['node_modules', '.git', '.artifacts']) }), dependency.inventory);
      }
    }
    return inputs;
  };
  verifyInputs({ full: true });
  return { directory, files: personDeploymentFiles, payload, verifyInputs, backups: new Map(),
    provenance: { reportSha256: personDeploymentSeals.report, buildPlanSha256: personDeploymentSeals.plan,
      verificationSha256: personDeploymentSeals.verification, generatedFingerprint: report.generatedFingerprint },
    hostBaselines: plan.baselines, generatedRuntime: report.runtimeContract.generated };
}

function validateSealed(sealed) {
  validatePersonDeploymentFiles(sealed.files);
  assert.deepEqual(Object.keys(sealed.provenance).sort(),
    ['buildPlanSha256', 'generatedFingerprint', 'reportSha256', 'verificationSha256']);
  assert.equal(sealed.provenance.reportSha256, personDeploymentSeals.report);
  assert.equal(sealed.provenance.buildPlanSha256, personDeploymentSeals.plan);
  assert.equal(sealed.provenance.verificationSha256, personDeploymentSeals.verification);
  assert.equal(sealed.provenance.generatedFingerprint, '262303b6a26d063c0c9c0135a598e7784f3eabf960f11c39577a3425307963ac');
  for (const file of sealed.files) {
    const bytes = sealed.payload.get(file.path);
    assert.ok(Buffer.isBuffer(bytes)); assert.equal(bytes.length, file.bytes); assert.equal(sha(bytes), file.sha256);
  }
  assert.equal(sealed.payload.size, 4);
}
function validatePlan(plan, sealed, epoch, planSha256) {
  validateSealed(sealed);
  assert.match(epoch ?? '', uuid); assert.equal(plan.epoch, epoch);
  assert.match(planSha256 ?? '', hash); assert.equal(sha(json(plan)), planSha256, 'The explicitly reviewed plan changed');
  assert.equal(plan.contract, 'existing-person-select-plan-v1'); assert.equal(plan.status, 'PREPARED-NOT-APPLIED');
  assert.equal(plan.pluginRef, personSelectRef);
  assert.deepEqual(plan.files, personDeploymentFiles); assert.deepEqual(plan.scopes, personDeploymentScopes);
  assert.deepEqual(plan.switchOrder, personDeploymentFiles.flatMap(file =>
    personDeploymentScopes.map(scope => ({ scope, path: file.path }))));
  validatePersonDependencyBindings(plan.directDependencies);
  assert.deepEqual(plan.scopeRoots, roots); assert.deepEqual(plan.provenance, sealed.provenance);
  assert.deepEqual(plan.sourceSeal, sourceSeal(), 'Executor, tests or imported implementation changed');
  assert.deepEqual(plan.sourceInputs, sealed.verifyInputs());
  assert.deepEqual(plan.concurrency, { sharedLocalLock: sharedLock, trustedExclusiveWriterWindowRequired: true,
    atomicCompareAndSwapClaimed: false, protectionAgainstUncooperativeExternalWritersClaimed: false });
  assert.deepEqual(Object.keys(plan.targets).sort(), [...personDeploymentScopes].sort());
  for (const scope of personDeploymentScopes) for (const file of personDeploymentFiles) {
    assert.deepEqual(Object.keys(plan.targets[scope]).sort(), personDeploymentFiles.map(row => row.path).sort());
    const original = plan.targets[scope][file.path];
    normalizeNotificationFileMetadata(original);
    assert.equal(original.exists, true);
    assert.deepEqual(plan.newMetadata[scope][file.path], { exists: true, bytes: file.bytes, sha256: file.sha256,
      uid: original.uid, gid: original.gid, mode: original.mode, inodeAssignedOnlyAfterVerifiedStage: true });
    const bytes = sealed.backups.get(key(scope, file.path));
    assert.ok(Buffer.isBuffer(bytes)); assert.equal(sha(bytes), original.sha256); assert.equal(bytes.length, original.bytes);
  }
}
export async function preparePersonDeployment({ sealed, io, journal, lock, epoch = randomUUID() }) {
  lock.assertHeld(); assert.match(epoch, uuid); validateSealed(sealed);
  sealed.verifyInputs({ full: true });
  const tools = sourceSeal(), sourceInputs = sealed.verifyInputs();
  for (const item of tools) journal.bytes(`source/${item.path}`, fs.readFileSync(path.join(workspace, item.path)));
  const observation = await io.observe();
  journal.event('observed-existing-runtime-and-startup', { observation });
  const directDependencies = await io.bindDirectDependencies();
  validatePersonDependencyBindings(directDependencies);
  const preserved = await io.preserve(epoch);
  journal.fixed('preserved-inputs.private.json', preserved);
  const targets = {}, newMetadata = {};
  for (const scope of personDeploymentScopes) {
    targets[scope] = {}; newMetadata[scope] = {};
    for (const file of personDeploymentFiles) {
      const current = await io.read(scope, file.path), original = compact(current);
      assert.equal(original.exists, true, 'All twelve existing files must be present; this executor never creates target directories');
      for (const restoring of [false, true]) assert.equal((await io.read(scope, personPending(file.path, epoch, restoring))).exists, false);
      journal.bytes(`backup/${scope}/${file.path}`, current.bytes);
      sealed.backups.set(key(scope, file.path), Buffer.from(current.bytes));
      targets[scope][file.path] = original;
      newMetadata[scope][file.path] = { exists: true, bytes: file.bytes, sha256: file.sha256,
        uid: original.uid, gid: original.gid, mode: original.mode, inodeAssignedOnlyAfterVerifiedStage: true };
    }
    journal.event('sealed-one-scope-originals', { scope, files: 4 });
  }
  const ts = createRequire(path.join(web, 'package.json'))('typescript');
  for (const scope of personDeploymentScopes) {
    assert.deepEqual(inspectPersonSelectRuntime(ts, sealed.backups.get(key(scope, 'index.legacy.js')).toString()),
      sealed.generatedRuntime, 'A baseline cannot silently have a different external/export surface');
    for (const file of personDeploymentFiles) exact(compact(await io.read(scope, file.path)), targets[scope][file.path]);
  }
  for (const file of personDeploymentFiles) {
    const response = await io.http(file.path);
    assert.equal(response.status, 200); assert.equal(sha(response.bytes), targets.container[file.path].sha256);
    journal.bytes(`served-before/${file.path}`, response.bytes);
  }
  assert.deepEqual(await io.bindDirectDependencies(), directDependencies);
  assert.deepEqual(await io.preserve(epoch), preserved);
  assert.deepEqual(await io.observe(), observation);
  assert.deepEqual(sealed.verifyInputs({ full: true }), sourceInputs);
  assert.deepEqual(sourceSeal(), tools); lock.assertHeld();
  for (const file of personDeploymentFiles) journal.bytes(`payload/${file.path}`, sealed.payload.get(file.path));
  const plan = { contract: 'existing-person-select-plan-v1', status: 'PREPARED-NOT-APPLIED', epoch,
    pluginRef: personSelectRef, candidate: sealed.directory, preparedDirectory: journal.directory,
    files: personDeploymentFiles, scopes: personDeploymentScopes, scopeRoots: roots, targets, newMetadata,
    provenance: sealed.provenance, sourceSeal: tools, sourceInputs, observation, directDependencies, preserved,
    switchOrder: personDeploymentFiles.flatMap(file => personDeploymentScopes.map(scope => ({ scope, path: file.path }))),
    startupOrder: ['host-dist', 'host-public-plugin-overlay', 'environment-overrides', 'nginx'],
    concurrency: { sharedLocalLock: sharedLock, trustedExclusiveWriterWindowRequired: true,
      atomicCompareAndSwapClaimed: false, protectionAgainstUncooperativeExternalWritersClaimed: false },
    recovery: 'Restore only exact verified epoch dev/inode/hash/uid/gid/mode; retain every unknown or unverified inode',
    forbidden: ['container-create', 'restart', 'image-pull', 'directory-create-or-remove', 'nginx-reload',
      'root-index-overwrite', 'import-map-overwrite', 'model-overwrite', 'other-plugin-overwrite'],
    multiFileAtomicPublicationClaimed: false, functionalAcceptance: false, preparedAt: new Date().toISOString() };
  journal.fixed('prepared.private.json', plan);
  return plan;
}

function mutationOperations({ plan, sealed, io, journal, lock, report, ledger }) {
  const read = async (scope, relative) => compact(await io.read(scope, relative));
  const guard = async () => {
    lock.assertHeld();
    assert.deepEqual(sourceSeal(), plan.sourceSeal);
    assert.deepEqual(sealed.verifyInputs(), plan.sourceInputs);
    assert.deepEqual(await io.observe(), plan.observation, 'Container, image, inputs, startup or pinned parent drift');
  };
  const uncertainRead = async (scope, relative) => {
    try { return await read(scope, relative); }
    catch (error) { return { exists: null, readbackError: error.message }; }
  };
  const install = async (scope, relative, bytes, before, restoring = false, recovering = false) => {
    const pending = personPending(relative, plan.epoch, restoring), old = plan.targets[scope][relative];
    const desired = { exists: true, bytes: bytes.length, sha256: sha(bytes), uid: old.uid, gid: old.gid, mode: old.mode };
    await guard(); exact(await read(scope, relative), before, 'Target changed before exclusive stage');
    assert.equal((await read(scope, pending)).exists, false);
    journal.event('before-stage', { scope, relative, pending, before, desired, restoring });
    try { await io.stage(scope, pending, bytes, desired); }
    catch (error) {
      const actual = await uncertainRead(scope, pending);
      report.transportErrors.push({ scope, path: pending, error: error.message, stageOwnershipUnverified: true, actual });
      journal.event('uncertain-stage-retained', { scope, pending, actual, ownershipClaimed: false });
      throw error;
    }
    const staged = await read(scope, pending);
    for (const [field, value] of Object.entries(desired)) assert.equal(staged[field], value);
    ledger.set(key(scope, pending), staged);
    journal.event('verified-stage', { scope, pending, staged, restoring });
    await guard(); exact(await read(scope, relative), before, 'Target changed before conditional rename');
    journal.event('before-publish', { scope, relative, pending, before, staged, restoring });
    try { await io.publish(scope, pending, relative, before, staged); }
    catch (error) {
      const actual = await uncertainRead(scope, relative), stageActual = await uncertainRead(scope, pending);
      const committed = owned(actual, staged) && stageActual.exists === false;
      report.transportErrors.push({ scope, path: relative, error: error.message, committedReadback: committed });
      journal.event('uncertain-publish-readback', { scope, relative, pending, actual, stageActual, committed });
      if (!recovering || !committed) throw error;
    }
    const actual = await read(scope, relative);
    exact(actual, staged, 'Published inode differs from the verified private stage');
    assert.equal((await read(scope, pending)).exists, false);
    ledger.set(key(scope, relative), actual);
    journal.event('published-file', { scope, relative, actual, restoring });
    return actual;
  };
  const removeStage = async (scope, relative, expected) => {
    validatePersonMutationPath(relative);
    assert.ok(relative.endsWith('.pending'), 'Only verified private epoch stages can be removed');
    await guard(); exact(await read(scope, relative), expected);
    journal.event('before-verified-stage-remove', { scope, relative, expected });
    try { await io.removeStage(scope, relative, expected); }
    catch (error) {
      const actual = await uncertainRead(scope, relative);
      report.transportErrors.push({ scope, path: relative, error: error.message, absentReadback: actual.exists === false });
      if (actual.exists !== false) throw error;
    }
    assert.equal((await read(scope, relative)).exists, false);
  };
  return { read, guard, install, removeStage };
}

async function cleanupStages(plan, io, ops, ledger, report) {
  for (const scope of personDeploymentScopes) for (const file of personDeploymentFiles) {
    for (const restoring of [false, true]) {
      const pending = personPending(file.path, plan.epoch, restoring);
      try {
        const actual = await ops.read(scope, pending);
        if (!actual.exists) continue;
        assert.ok(owned(actual, ledger.get(key(scope, pending))), 'Unverified or replaced stage inode retained');
        await ops.removeStage(scope, pending, actual);
      } catch (error) { report.retained.push({ scope, path: pending, reason: error.message }); }
    }
  }
}

async function recoverKnownApplication({ plan, sealed, io, ops, ledger, report }) {
  for (const { scope, path: relative } of [...plan.switchOrder].reverse()) {
    try {
      await ops.guard();
      const actual = await ops.read(scope, relative), original = plan.targets[scope][relative];
      if (owned(actual, original)) report.recovered.push({ scope, path: relative, ...actual, unchangedOriginal: true });
      else {
        const published = ledger.get(key(scope, personPending(relative, plan.epoch)));
        assert.ok(owned(actual, published), 'Unknown or replaced target inode retained');
        const restored = await ops.install(scope, relative, sealed.backups.get(key(scope, relative)), actual, true, true);
        report.recovered.push({ scope, path: relative, ...restored });
      }
    } catch (error) { report.retained.push({ scope, path: relative, reason: error.message }); }
  }
  await cleanupStages(plan, io, ops, ledger, report);
  report.recoveryStatus = report.retained.length ? 'INCOMPLETE-UNKNOWN-INODES-RETAINED' : 'EXACT-ORIGINAL-BYTES-AND-METADATA-RESTORED';
  if (!report.retained.length) {
    try {
      assert.equal(report.recovered.length, 12);
      for (const item of report.recovered) exact(await ops.read(item.scope, item.path),
        normalizeNotificationFileMetadata(item));
      for (const file of personDeploymentFiles) {
        const response = await io.http(file.path);
        assert.equal(response.status, 200); assert.equal(sha(response.bytes), plan.targets.container[file.path].sha256);
      }
      assert.deepEqual(await io.bindDirectDependencies(), plan.directDependencies);
      assert.deepEqual(await io.preserve(plan.epoch), plan.preserved);
      await ops.guard();
    } catch (error) {
      report.recoveryStatus = 'INCOMPLETE-UNKNOWN-INODES-RETAINED';
      report.retained.push({ reason: error.message });
    }
  }
}

export async function applyPersonDeployment({
  plan, sealed, io, journal, lock, expectedEpoch, expectedPlanSha256, trustedExclusiveWriterWindow,
}) {
  const report = { contract: 'existing-person-select-apply-v1', status: 'VALIDATING-NOT-YET-WRITING',
    epoch: plan?.epoch, planSha256: expectedPlanSha256, provenance: sealed?.provenance, sourceSeal: plan?.sourceSeal,
    mutations: [], transportErrors: [], recovered: [], retained: [], functionalAcceptance: false,
    multiFileAtomicPublicationClaimed: false, startedAt: new Date().toISOString() };
  const ledger = new Map(), ops = mutationOperations({ plan, sealed, io, journal, lock, report, ledger });
  let intent = false;
  try {
    validatePlan(plan, sealed, expectedEpoch, expectedPlanSha256);
    assert.equal(trustedExclusiveWriterWindow, true, 'Explicit trusted exclusive writer window is required');
    sealed.verifyInputs({ full: true }); await ops.guard();
    assert.deepEqual(await io.preserve(plan.epoch), plan.preserved);
    assert.deepEqual(await io.bindDirectDependencies(), plan.directDependencies);
    for (const scope of personDeploymentScopes) for (const file of personDeploymentFiles) {
      exact(await ops.read(scope, file.path), plan.targets[scope][file.path], 'Pre-apply old inode drift');
      for (const restoring of [false, true]) assert.equal((await ops.read(scope,
        personPending(file.path, plan.epoch, restoring))).exists, false);
    }
    journal.fixed('apply-intent.private.json', { ...report, plan, lock: lock.witness, explicitExclusiveWriterWindow: true });
    intent = true;
    report.status = 'APPLYING-EXACT-TWELVE-EXISTING-PLUGIN-FILES';
    for (const { scope, path: relative } of plan.switchOrder) {
      const actual = await ops.install(scope, relative, sealed.payload.get(relative), plan.targets[scope][relative]);
      report.mutations.push({ scope, path: relative, ...actual });
    }
    assert.equal(report.mutations.length, 12);
    for (const item of report.mutations) exact(await ops.read(item.scope, item.path), normalizeNotificationFileMetadata(item));
    for (const file of personDeploymentFiles) {
      const response = await io.http(file.path);
      assert.equal(response.status, 200); assert.equal(sha(response.bytes), file.sha256, 'Served plugin bytes differ');
      journal.event('actual-http-readback', { path: file.path, status: 200, bytes: response.bytes.length, sha256: sha(response.bytes) });
    }
    assert.deepEqual(await io.bindDirectDependencies(), plan.directDependencies);
    assert.deepEqual(await io.preserve(plan.epoch), plan.preserved);
    sealed.verifyInputs({ full: true }); await ops.guard();
    report.status = 'APPLIED-TWELVE-PLUGIN-FILES-NATIVE-ACCEPTANCE-PENDING';
    return report;
  } catch (error) {
    report.status = intent ? 'FAILED-APPLY-CONDITIONAL-RECOVERY' : 'REFUSED-BEFORE-MUTATION';
    report.error = error.message;
    if (intent) await recoverKnownApplication({ plan, sealed, io, ops, ledger, report });
    throw Object.assign(error, { evidence: report });
  } finally { report.finishedAt = new Date().toISOString(); journal.fixed('report.private.json', report); }
}

export async function rollbackPersonDeployment({
  plan, appliedReport, expectedApplyReceiptSha256, sealed, io, journal, lock,
  expectedEpoch, expectedPlanSha256, trustedExclusiveWriterWindow,
}) {
  const report = { contract: 'existing-person-select-rollback-v1', status: 'VALIDATING-NOT-YET-WRITING',
    epoch: plan?.epoch, planSha256: expectedPlanSha256, applyReceiptSha256: expectedApplyReceiptSha256,
    restored: [], transportErrors: [], retained: [], functionalAcceptance: false, startedAt: new Date().toISOString() };
  const ledger = new Map(), ops = mutationOperations({ plan, sealed, io, journal, lock, report, ledger });
  let intent = false;
  try {
    validatePlan(plan, sealed, expectedEpoch, expectedPlanSha256);
    assert.equal(trustedExclusiveWriterWindow, true);
    assert.match(expectedApplyReceiptSha256 ?? '', hash);
    assert.equal(sha(json(appliedReport)), expectedApplyReceiptSha256, 'An exact actual successful apply receipt is required');
    assert.equal(appliedReport.contract, 'existing-person-select-apply-v1');
    assert.equal(appliedReport.status, 'APPLIED-TWELVE-PLUGIN-FILES-NATIVE-ACCEPTANCE-PENDING');
    assert.equal(appliedReport.epoch, expectedEpoch); assert.equal(appliedReport.planSha256, expectedPlanSha256);
    assert.deepEqual(appliedReport.provenance, plan.provenance); assert.deepEqual(appliedReport.sourceSeal, plan.sourceSeal);
    assert.equal(appliedReport.mutations.length, 12);
    const published = new Map(appliedReport.mutations.map(item => [key(item.scope, item.path), item]));
    assert.equal(published.size, 12); await ops.guard();
    assert.deepEqual(await io.preserve(plan.epoch), plan.preserved);
    assert.deepEqual(await io.bindDirectDependencies(), plan.directDependencies);
    for (const scope of personDeploymentScopes) for (const file of personDeploymentFiles) {
      const actual = published.get(key(scope, file.path));
      assert.ok(actual); assert.equal(actual.sha256, file.sha256); assert.equal(actual.bytes, file.bytes);
      for (const field of ['uid', 'gid', 'mode']) assert.equal(actual[field], plan.targets[scope][file.path][field]);
      exact(await ops.read(scope, file.path), normalizeNotificationFileMetadata(actual), 'Actual published inode changed');
      for (const restoring of [false, true]) assert.equal((await ops.read(scope,
        personPending(file.path, plan.epoch, restoring))).exists, false);
    }
    journal.fixed('rollback-intent.private.json', { ...report, plan, actualPublished: appliedReport.mutations, lock: lock.witness });
    intent = true;
    for (const { scope, path: relative } of [...plan.switchOrder].reverse()) {
      const actual = await ops.install(scope, relative, sealed.backups.get(key(scope, relative)),
        normalizeNotificationFileMetadata(published.get(key(scope, relative))), true, true);
      report.restored.push({ scope, path: relative, ...actual });
    }
    for (const item of report.restored) {
      exact(await ops.read(item.scope, item.path), normalizeNotificationFileMetadata(item));
      assert.equal(item.sha256, plan.targets[item.scope][item.path].sha256);
    }
    for (const file of personDeploymentFiles) {
      const response = await io.http(file.path);
      assert.equal(response.status, 200); assert.equal(sha(response.bytes), plan.targets.container[file.path].sha256);
    }
    await cleanupStages(plan, io, ops, ledger, report);
    assert.deepEqual(report.retained, []);
    assert.deepEqual(await io.bindDirectDependencies(), plan.directDependencies);
    assert.deepEqual(await io.preserve(plan.epoch), plan.preserved);
    sealed.verifyInputs({ full: true }); await ops.guard();
    report.status = 'ROLLED-BACK-TWELVE-EXACT-PLUGIN-ORIGINALS';
    return report;
  } catch (error) {
    report.status = intent ? 'ROLLBACK-FAILED-UNKNOWN-INODES-RETAINED' : 'REFUSED-ROLLBACK-BEFORE-MUTATION';
    report.error = error.message;
    if (intent) {
      for (const scope of personDeploymentScopes) for (const file of personDeploymentFiles) {
        try {
          const actual = await ops.read(scope, file.path);
          const restored = report.restored.find(item => item.scope === scope && item.path === file.path);
          if (!owned(actual, restored)) report.retained.push({ scope, path: file.path, actual,
            reason: 'Target was not verified as a restored epoch inode; retained without guessing' });
        } catch (readError) { report.retained.push({ scope, path: file.path, reason: readError.message }); }
      }
      await cleanupStages(plan, io, ops, ledger, report);
    }
    throw Object.assign(error, { evidence: report });
  } finally { report.finishedAt = new Date().toISOString(); journal.fixed('report.private.json', report); }
}

function hostFilename(root, relative) {
  safe(relative); assert.equal(fs.realpathSync(root), root);
  let parent = root;
  for (const part of relative.split('/').slice(0, -1)) {
    parent = path.join(parent, part);
    const info = fs.lstatSync(parent);
    assert.ok(info.isDirectory() && !info.isSymbolicLink(), 'Every existing file parent must be a real directory');
  }
  return path.join(root, relative);
}
function hostRead(root, relative) {
  const filename = hostFilename(root, relative);
  let fd;
  try {
    fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const before = fs.fstatSync(fd, { bigint: true });
    assert.ok(before.isFile() && before.size <= 256n * 1024n * 1024n);
    const bytes = fs.readFileSync(fd), after = fs.fstatSync(fd, { bigint: true });
    const named = fs.lstatSync(filename, { bigint: true });
    for (const field of ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs']) {
      assert.equal(before[field], after[field]); assert.equal(named[field], after[field]);
    }
    assert.equal(bytes.length, Number(before.size));
    return { exists: true, bytes, uid: String(before.uid), gid: String(before.gid),
      mode: (before.mode & 0o7777n).toString(8), dev: String(before.dev), ino: String(before.ino) };
  } catch (error) { if (error.code === 'ENOENT') return { exists: false }; throw error; }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}
export function personHostInventory(root, excluded = new Set()) {
  assert.equal(fs.realpathSync(root), root);
  const inventory = [];
  const visit = (directory, prefix = '') => {
    for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
      const relative = prefix ? `${prefix}/${item.name}` : item.name;
      safe(relative); assert.ok(!item.isSymbolicLink());
      if (item.isDirectory()) visit(path.join(directory, item.name), relative);
      else {
        assert.ok(item.isFile());
        if (!excluded.has(relative)) {
          assert.ok(inventory.length < 100000);
          const value = hostRead(root, relative);
          assert.equal(value.exists, true);
          inventory.push({ path: relative, bytes: value.bytes.length, sha256: sha(value.bytes) });
        }
      }
    }
  };
  visit(root); inventory.sort((left, right) => left.path.localeCompare(right.path));
  return { files: inventory.length, bytes: inventory.reduce((total, row) => total + row.bytes, 0),
    sha256: sha(json(inventory)), fingerprintKind: 'complete-relative-file-set-content-sha256', inventory };
}
function shellGuard(variable, expected) {
  expected = normalizeNotificationFileMetadata(expected);
  assert.equal(expected.exists, true);
  return `test -f "$${variable}" && test ! -L "$${variable}"
test "$(stat -c '%u:%g:%a:%d:%i:%s' "$${variable}")" = '${expected.uid}:${expected.gid}:${expected.mode}:${expected.dev}:${expected.ino}:${expected.bytes}'
test "$(sha256sum "$${variable}" | cut -d ' ' -f 1)" = '${expected.sha256}'`;
}
const containerReadProgram = `${notificationContainerPathProgram}
if test ! -e "$target"; then printf 'ABSENT\\n'; exit 0; fi
test -f "$target"
exec 3<"$target"
before="$(stat -Lc '%u %g %a %d %i %s %Y %Z' /proc/$$/fd/3)"
printf 'FILE %s\\n' "$before"
cat <&3
test "$(stat -Lc '%u %g %a %d %i %s %Y %Z' /proc/$$/fd/3)" = "$before"
test ! -L "$target" && test "$(stat -c '%u %g %a %d %i %s %Y %Z' "$target")" = "$before"
`;
export function createPersonDeploymentIo(sealed, execute = (program, args, options) =>
  spawnSync(program, args, { timeout: 30000, maxBuffer: 32 * 1024 * 1024, ...options })) {
  const run = (program, args, input) => {
    const result = execute(program, args, { input });
    assert.equal(result.status, 0, `${program} ${args[0]} failed: ${String(result.stderr ?? '').slice(0, 400)}`);
    return Buffer.from(result.stdout ?? '');
  };
  const docker = (args, input) => run('docker', args, input);
  const [first] = JSON.parse(docker(['inspect', 'plmweb']));
  assert.match(first.Id ?? '', hash); assert.match(first.Image ?? '', /^sha256:[a-f0-9]{64}$/);
  const id = first.Id;
  const shell = (script, root, relative, input) => {
    safe(relative);
    return docker(['exec', '-i', '--user', '0', id, 'sh', '-c', script, 'aibiz-person-select', root, relative], input);
  };
  const containerRead = (root, relative) => {
    const result = shell(containerReadProgram, root, relative), split = result.indexOf(10);
    assert.ok(split >= 0);
    const header = result.subarray(0, split).toString();
    if (header === 'ABSENT') { assert.equal(result.length, split + 1); return { exists: false }; }
    const fields = header.match(/^FILE (\d+) (\d+) ([0-7]+) (\d+) (\d+) (\d+) (\d+) (\d+)$/);
    assert.ok(fields);
    const bytes = result.subarray(split + 1);
    assert.equal(bytes.length, Number(fields[6]));
    return { exists: true, bytes, uid: fields[1], gid: fields[2], mode: fields[3], dev: fields[4], ino: fields[5] };
  };
  const read = async (scope, relative) => {
    assert.ok(personDeploymentScopes.includes(scope)); validatePersonMutationPath(relative);
    return scope === 'container' ? containerRead(roots.container, relative) : hostRead(roots[scope], relative);
  };
  const staticRead = (scope, relative) => scope === 'container'
    ? containerRead('/dist', relative) : hostRead(path.join(web, 'dist'), relative);
  const fetchStatic = async relative => {
    safe(relative);
    const response = await fetch(new URL(relative, origin), { redirect: 'error', cache: 'no-store',
      signal: AbortSignal.timeout(15000) });
    return { status: response.status, bytes: Buffer.from(await response.arrayBuffer()) };
  };
  const parentPaths = root => {
    const result = [];
    let current = path.parse(root).root;
    for (const part of root.slice(current.length).split('/')) {
      current = path.join(current, part);
      const stat = fs.lstatSync(current, { bigint: true });
      assert.ok(stat.isDirectory() && !stat.isSymbolicLink());
      result.push({ path: current, uid: String(stat.uid), gid: String(stat.gid),
        mode: (stat.mode & 0o7777n).toString(8), dev: String(stat.dev), ino: String(stat.ino) });
    }
    return result;
  };
  const observe = async () => {
    const [container] = JSON.parse(docker(['inspect', id]));
    assert.equal(container.Id, id); assert.equal(container.Name, '/plmweb');
    assert.equal(container.Image, first.Image); assert.equal(container.State.Status, 'running');
    assert.equal(container.Config.Labels?.['com.docker.compose.project'], 'compose');
    assert.equal(container.Config.Labels?.['com.docker.compose.service'], 'plmweb');
    assert.deepEqual(container.Config.Entrypoint, ['/start.sh']); assert.deepEqual(container.Config.Cmd, []);
    const [image] = JSON.parse(docker(['image', 'inspect', container.Image]));
    assert.equal(image.Id, container.Image);
    const mounts = [...container.Mounts].sort((left, right) => left.Destination.localeCompare(right.Destination));
    for (const [destination, source] of [
      ['/opt/aibiz/local-dist', path.join(web, 'dist')],
      ['/opt/aibiz/local-plugins', path.join(web, 'public/plugins')],
      ['/app/model', path.join(workspace, 'plm/model')],
    ]) {
      assert.equal(fs.realpathSync(source), source);
      assert.ok(mounts.some(item => item.Destination === destination && item.Source === source
        && item.Type === 'bind' && item.RW === false));
    }
    assert.ok(!mounts.some(item => item.Destination === '/dist' || item.Destination.startsWith('/dist/')));
    const env = new Map();
    for (const entry of container.Config.Env) {
      const split = entry.indexOf('='), name = entry.slice(0, split), value = entry.slice(split + 1);
      assert.ok(!env.has(name)); env.set(name, value);
    }
    assert.equal(env.get('LOCAL_DIST_SOURCE'), '/opt/aibiz/local-dist');
    assert.equal(env.get('LOCAL_PLUGIN_SOURCE'), '/opt/aibiz/local-plugins');
    const startup = docker(['exec', id, 'cat', '/start.sh']);
    const review = reviewGuardStartup(startup.toString());
    assert.equal(sha(fs.readFileSync(path.join(web, 'start.sh'))), review.sha256);
    const environmentSource = fs.readFileSync(path.join(web, 'dist/environments/environment.js'));
    const configuration = docker(['exec', id, 'cat', '/environment.config']);
    const rendered = docker(['exec', '-i', '--env', 'LC_ALL=C', id, 'awk', '-F:',
      guardStartupEnvironmentProgram(startup.toString()), '/environment.config', '-'], environmentSource);
    const servedEnvironment = docker(['exec', id, 'cat', '/dist/environments/environment.js']);
    assert.equal(sha(rendered), sha(servedEnvironment));
    const nginx = docker(['exec', id, 'nginx', '-T']);
    assert.match(nginx.toString(), /location\s+\^~\s+\/ibizplm-plmweb\/\s*\{[^}]*alias\s+\/dist\/;/);
    const containerParentNames = ['/dist', '/dist/plugins', '/dist/plugins/@ibiz-template-plm',
      `/dist/plugins/${personSelectRef}`, roots.container, `${roots.container}/assets`];
    const containerParents = docker(['exec', '--user', '0', id, 'sh', '-c',
      'set -efu; for item do test -d "$item" && test ! -L "$item"; stat -c "%n %u %g %a %d %i" "$item"; done',
      'aibiz-person-parent-inventory', ...containerParentNames]).toString();
    return { runtime: { id, image: container.Image, imageContentId: image.Id,
      startedAt: container.State.StartedAt, restartCount: container.RestartCount, mounts,
      configurationSha256: sha(json({ config: container.Config, host: container.HostConfig })) },
    startup: { sha256: review.sha256, copyOrder: review.copyOrder, publicPluginOverlayFollowsDist: true },
    hostParents: [...parentPaths(roots['host-public']), ...parentPaths(`${roots['host-public']}/assets`),
      ...parentPaths(roots['host-dist']), ...parentPaths(`${roots['host-dist']}/assets`)],
    containerParents, environment: { sourceSha256: sha(environmentSource), configurationSha256: sha(configuration),
      renderedSha256: sha(rendered), servedSha256: sha(servedEnvironment) },
    nginxSha256: sha(nginx), sourceInputsSha256: sealed.verifyInputs().sha256 };
  };
  const bindDirectDependencies = async () => {
    const index = staticRead('container', 'index.html');
    assert.ok(index.exists);
    assert.deepEqual(staticRead('host-dist', 'index.html').bytes, index.bytes);
    const entries = captionHtmlEntries(index.bytes.toString());
    const mapping = staticRead('container', entries.importMap);
    assert.ok(mapping.exists); assert.deepEqual(staticRead('host-dist', entries.importMap).bytes, mapping.bytes);
    const parsed = JSON.parse(mapping.bytes), records = [];
    for (const [kind, relative, content] of [['index', 'index.html', index.bytes],
      ['import-map', entries.importMap, mapping.bytes]]) {
      const response = await fetchStatic(relative);
      assert.equal(response.status, 200); assert.deepEqual(response.bytes, content);
      records.push({ kind, path: relative, bytes: content.length, sha256: sha(content), actualHttp: true });
    }
    const dependencies = [];
    for (const reference of personDeploymentDependencies) {
      const relative = resolveGuardResource(reference, `${pluginPrefix}index.legacy.js`, parsed, entries.importMap);
      safe(relative);
      const host = staticRead('host-dist', relative), served = staticRead('container', relative);
      assert.ok(host.exists && served.exists); assert.deepEqual(host.bytes, served.bytes);
      const response = await fetchStatic(relative);
      assert.equal(response.status, 200); assert.deepEqual(response.bytes, served.bytes);
      dependencies.push({ reference, path: relative, bytes: served.bytes.length, sha256: sha(served.bytes),
        hostDistMatchesContainer: true, actualHttp: true });
    }
    return { records, dependencies, recursiveRuntimeClosureClaimed: false };
  };
  const preserve = async epoch => {
    assert.match(epoch, uuid);
    const excluded = new Set(personDeploymentFiles.flatMap(file => [file.path, personPending(file.path, epoch),
      personPending(file.path, epoch, true)]).map(relative => `${pluginPrefix}${relative}`));
    const publicExcluded = new Set([...excluded].map(relative => relative.slice('plugins/'.length)));
    const raw = docker(['exec', '--user', '0', id, 'sh', '-c', notificationContainerInventoryProgram]);
    const rows = parseNotificationContainerInventory(raw, excluded);
    return { hostPublicPlugins: personHostInventory(path.join(web, 'public/plugins'), publicExcluded),
      hostDist: personHostInventory(path.join(web, 'dist'), excluded),
      containerDist: { files: rows.length, sha256: sha(json(rows)),
        fingerprintKind: 'complete-relative-file-set-content-sha256', inventory: rows },
      modelSource: personHostInventory(path.join(workspace, 'plm/model')) };
  };
  const mutateHost = (scope, action, relative, pending, before, staged, bytes) => {
    assert.ok(['host-public', 'host-dist'].includes(scope));
    return run(process.execPath, ['-e', notificationHostMutationProgram, roots[scope], action, relative, pending,
      JSON.stringify(before), JSON.stringify(staged)], bytes);
  };
  return { read, observe, bindDirectDependencies, preserve,
    async stage(scope, relative, bytes, metadata) {
      validatePersonMutationPath(relative); assert.ok(relative.endsWith('.pending'));
      metadata = normalizeNotificationFileMetadata(metadata, true);
      if (scope !== 'container') return mutateHost(scope, 'stage', relative, '', { exists: false }, metadata, bytes);
      shell(`${notificationContainerPathProgram}
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
sync "$current"`, roots.container, relative, bytes);
    },
    async publish(scope, pending, relative, before, staged) {
      validatePersonMutationPath(relative); validatePersonMutationPath(pending);
      assert.ok(personDeploymentFiles.some(file => file.path === relative) && pending.startsWith(`${relative}.aibiz-person-`));
      before = normalizeNotificationFileMetadata(before); staged = normalizeNotificationFileMetadata(staged);
      assert.equal(before.exists, true);
      if (scope !== 'container') return mutateHost(scope, 'publish', relative, pending, before, staged);
      shell(`${notificationContainerPathProgram}
pending="$root/${pending}"
${shellGuard('pending', staged)}
${shellGuard('target', before)}
mv -T -- "$pending" "$target"
${shellGuard('target', staged)}
sync "$target"
sync "$current"`, roots.container, relative);
    },
    async removeStage(scope, relative, expected) {
      validatePersonMutationPath(relative); assert.ok(relative.endsWith('.pending'));
      expected = normalizeNotificationFileMetadata(expected);
      if (scope !== 'container') return mutateHost(scope, 'remove', relative, '', expected, {});
      shell(`${notificationContainerPathProgram}
${shellGuard('target', expected)}
rm -- "$target"
sync "$current"`, roots.container, relative);
    },
    http: relative => {
      assert.ok(personDeploymentFiles.some(file => file.path === relative));
      return fetchStatic(`${pluginPrefix}${relative}`);
    } };
}

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, strict: true, options: {
    prepare: { type: 'boolean' }, apply: { type: 'boolean' }, rollback: { type: 'boolean' },
    candidate: { type: 'string' }, output: { type: 'string' }, plan: { type: 'string' },
    epoch: { type: 'string' }, 'plan-sha256': { type: 'string' },
    'apply-receipt': { type: 'string' }, 'apply-receipt-sha256': { type: 'string' },
    'trusted-exclusive-writer-window': { type: 'boolean' },
  } });
  assert.equal([values.prepare, values.apply, values.rollback].filter(Boolean).length, 1);
  assert.ok(values.output && path.isAbsolute(values.output));
  let plan, appliedReport;
  if (values.prepare) {
    assert.ok(values.candidate && path.isAbsolute(values.candidate));
    for (const option of ['plan', 'epoch', 'plan-sha256', 'apply-receipt', 'apply-receipt-sha256',
      'trusted-exclusive-writer-window']) assert.equal(values[option], undefined);
  } else {
    assert.equal(values['trusted-exclusive-writer-window'], true);
    assert.equal(values.candidate, undefined);
    assert.ok(values.plan && path.isAbsolute(values.plan));
    assert.equal(path.basename(values.plan), 'prepared.private.json');
    assert.equal(fs.realpathSync(path.dirname(path.dirname(values.plan))), artifacts);
    assert.match(values.epoch ?? '', uuid); assert.match(values['plan-sha256'] ?? '', hash);
    const bytes = privateRead(values.plan);
    assert.equal(sha(bytes), values['plan-sha256']); plan = JSON.parse(bytes);
    assert.equal(plan.preparedDirectory, path.dirname(values.plan));
    if (values.rollback) {
      assert.ok(values['apply-receipt'] && path.isAbsolute(values['apply-receipt']));
      assert.equal(path.basename(values['apply-receipt']), 'report.private.json');
      assert.equal(fs.realpathSync(path.dirname(path.dirname(values['apply-receipt']))), artifacts);
      assert.match(values['apply-receipt-sha256'] ?? '', hash);
      const bytes = privateRead(values['apply-receipt']);
      assert.equal(sha(bytes), values['apply-receipt-sha256']); appliedReport = JSON.parse(bytes);
    } else {
      assert.equal(values['apply-receipt'], undefined); assert.equal(values['apply-receipt-sha256'], undefined);
    }
  }
  const lock = acquireNotificationDeploymentLock();
  let journal;
  try {
    const sealed = loadPersonDeploymentCandidate(plan?.candidate ?? values.candidate);
    if (plan) {
      for (const file of personDeploymentFiles) {
        const payload = privateRead(path.join(plan.preparedDirectory, 'payload', file.path));
        assert.equal(sha(payload), file.sha256);
        for (const scope of personDeploymentScopes) {
          const bytes = privateRead(path.join(plan.preparedDirectory, 'backup', scope, file.path));
          assert.equal(sha(bytes), plan.targets[scope][file.path].sha256);
          sealed.backups.set(key(scope, file.path), bytes);
        }
      }
      for (const tool of plan.sourceSeal) assert.equal(sha(privateRead(path.join(plan.preparedDirectory, 'source', tool.path))), tool.sha256);
      assert.deepEqual(JSON.parse(privateRead(path.join(plan.preparedDirectory, 'preserved-inputs.private.json'))), plan.preserved);
    }
    journal = journalAt(values.output);
    const io = createPersonDeploymentIo(sealed);
    const parameters = { sealed, io, journal, lock, plan, expectedEpoch: values.epoch,
      expectedPlanSha256: values['plan-sha256'], trustedExclusiveWriterWindow: values['trusted-exclusive-writer-window'] };
    const report = values.prepare ? await preparePersonDeployment(parameters)
      : values.rollback ? await rollbackPersonDeployment({ ...parameters, appliedReport,
        expectedApplyReceiptSha256: values['apply-receipt-sha256'] }) : await applyPersonDeployment(parameters);
    console.log(JSON.stringify({ status: report.status, epoch: report.epoch, output: values.output,
      planSha256: plan ? values['plan-sha256'] : sha(privateRead(path.join(values.output, 'prepared.private.json'))),
      receiptSha256: plan ? sha(privateRead(path.join(values.output, 'report.private.json'))) : undefined,
      sharedMutationExecuted: !values.prepare, functionalAcceptance: false }, null, 2));
    return report;
  } catch (error) {
    if (journal) journal.fixed('failure.private.json', { error: error.message, at: new Date().toISOString(),
      prepareOnly: Boolean(values.prepare), evidenceReceipt: Boolean(error.evidence) });
    throw error;
  } finally { lock.release(); }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
