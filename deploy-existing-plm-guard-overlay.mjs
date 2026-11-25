#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = path.join(workspace, '.artifacts');
const hostDist = path.join(workspace, 'plm-web/dist');
const hostPlugins = path.join(workspace, 'plm-web/public/plugins');
const startupSource = path.join(workspace, 'plm-web/start.sh');
const sha = value => createHash('sha256').update(value).digest('hex');
const revision = '8388128f7ab5b027';
const runtimeDirectory = `extras/js/@ibiz-template/vue3-components/guard-${revision}/`;
const frameworkFiles = [
  'chart-B_uQaEfA.js', 'html2canvas.esm-ktJ_fyY7.js', 'ibiz-markdown-editor-7aqenXW-.js',
  'index-CsmVWoSQ.js', 'index-DWAfH-e8.js', 'index-DXR88r2n.js', 'index.es-D01alCCk.js',
  'index.min.css', 'index.system.min.js', 'map-chart-nwkjjlMK.js', 'map-chart-user-D2lgUtGX.js',
  'purify.es-BjIEdDys.js', 'wang-editor-BQpgI1OA.js', 'xlsx-util-3HiSLRza.js',
];
export const guardOverlayPaths = [
  ...frameworkFiles.map(filename => runtimeDirectory + filename),
  'static/js/index-legacy-d5b42c12.js',
  `extras/json/system-import-guard-${revision}.json`, 'index.html',
];
export const sealedGuardHashes = Object.freeze({
  manifest: '3da977e7bba23bb938dc588bac051dcc83bed8e1c9b835e5911bd7ab091d02f9',
  outputs: '1a8c4c589a6ec70eabf8305501c4bccdd1d5f6f10641034fb53228e32ab238b9',
  preparer: '77966520101a3a90241ff01cee435bdd5b2ecdee887ad74ee5396365ec750281',
  inheritedReceipt: '4ca0225ac5cb8c0b9a2ab9763ae5a16cc3d97b3c1bbeca71c6ef5898fa29dd7b',
  originalIndex: '16f8f8701ae5f78293d236cbc0074dd351b4b61e0c1bc5d080cf0e0db4c8eed2',
  startup: 'c8d01f1f35bfd2fbb219d00facbc3b39ed1e81415108bd93f023dce90fd4d97d',
});
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const hashes = /^[a-f0-9]{64}$/;
const scopes = ['host', 'container'];

export function validateGuardOverlayFiles(files) {
  assert.ok(Array.isArray(files));
  assert.deepEqual(files.map(file => file.path).sort(), [...guardOverlayPaths].sort(),
    'Only the sealed seventeen guard files are eligible');
  for (const file of files) {
    assert.match(file.sha256, hashes);
    assert.ok(Number.isSafeInteger(file.bytes) && file.bytes > 0);
  }
}

export function reviewGuardStartup(text) {
  assert.equal(sha(Buffer.from(text)), sealedGuardHashes.startup, 'The reviewed startup source changed');
  const sourceCopy = text.indexOf('cp -R "$LOCAL_DIST_SOURCE"/. /dist/');
  const pluginCopy = text.indexOf('cp -R "$LOCAL_PLUGIN_SOURCE"/. /dist/plugins/');
  const environment = text.indexOf('environment_file=/dist/environments/environment.js');
  const nginx = text.indexOf('nginx -g "daemon off;"');
  assert.ok(sourceCopy >= 0 && pluginCopy > sourceCopy && environment > pluginCopy && nginx > environment);
  assert.ok(guardOverlayPaths.every(filename => !/^(?:plugins|environments)\//.test(filename) &&
    !filename.startsWith('static/js/model/')));
  return { sha256: sealedGuardHashes.startup, copyOrder: ['host-dist', 'plugins-subtree', 'environment-overrides', 'nginx'],
    targetsOutsidePluginAndEnvironmentOverrides: true };
}

export function guardStartupEnvironmentProgram(text) {
  reviewGuardStartup(text);
  const marker = "awk -F: '";
  assert.equal(text.split(marker).length, 2);
  const start = text.indexOf(marker) + marker.length;
  const end = text.indexOf("' /environment.config \"$environment_file\"", start);
  assert.ok(end > start);
  return text.slice(start, end);
}

function safeRelative(relative) {
  assert.ok(typeof relative === 'string' && relative.length > 0 && !path.posix.isAbsolute(relative));
  assert.ok(relative.split('/').every(part => part && part !== '.' && part !== '..'));
  assert.ok(!/[\0\\\r\n]/.test(relative));
}

function deploymentPath(relative) {
  safeRelative(relative);
  if (guardOverlayPaths.includes(relative)) return;
  const match = relative.match(/^(.*)\.aibiz-guard-([a-f0-9-]+)(-rollback)?\.pending$/);
  assert.ok(match && guardOverlayPaths.includes(match[1]) && uuid.test(match[2]),
    'A target is outside this exact guard deployment');
}

function compact(file) {
  if (!file.exists) return { exists: false };
  assert.ok(Buffer.isBuffer(file.bytes));
  for (const field of ['uid', 'gid', 'dev', 'ino']) assert.match(file[field], /^\d+$/);
  assert.match(file.mode, /^[0-7]{3,4}$/);
  return { exists: true, bytes: file.bytes.length, sha256: sha(file.bytes), uid: file.uid,
    gid: file.gid, mode: file.mode, dev: file.dev, ino: file.ino };
}

function assertFile(actual, expected, message) {
  assert.equal(actual.exists, expected.exists, message);
  if (expected.exists) {
    for (const key of ['sha256', 'bytes', 'uid', 'gid', 'mode', 'dev', 'ino']) {
      if (expected[key] !== undefined) assert.equal(actual[key], expected[key], `${message}: ${key}`);
    }
  }
}

function sameOwnedFile(actual, expected) {
  return actual.exists && expected && ['sha256', 'dev', 'ino'].every(key => actual[key] === expected[key]);
}

function pendingName(relative, epoch, rollback = false) {
  assert.match(epoch, uuid);
  deploymentPath(relative);
  return `${relative}.aibiz-guard-${epoch}${rollback ? '-rollback' : ''}.pending`;
}

export async function prepareGuardDeployment({ sealed, io, journal, epoch = randomUUID() }) {
  assert.match(epoch, uuid);
  validateGuardOverlayFiles(sealed.files);
  assert.equal(sealed.manifestSha256, sealedGuardHashes.manifest);
  const deployerSource = fs.readFileSync(fileURLToPath(import.meta.url));
  const testSource = fs.readFileSync(path.join(workspace, 'scripts/tests/deploy-existing-plm-guard-overlay.test.mjs'));
  journal.bytes('executor-source.private.mjs', deployerSource);
  journal.bytes('executor-test-source.private.mjs', testSource);
  const observation = await io.observe();
  const preservedGraph = await io.verifyPreservedGraph(sealed.graph);
  const targets = {};
  for (const scope of scopes) {
    targets[scope] = {};
    for (const file of sealed.files) {
      const current = await io.read(scope, file.path);
      const observed = compact(current);
      if (file.path === 'index.html') {
        assert.equal(observed.sha256, sha(sealed.originalIndex), `${scope} index changed`);
        journal.bytes(`backup/${scope}/index.html`, current.bytes);
      } else assert.equal(observed.exists, false, `${scope} new target already exists: ${file.path}`);
      assert.equal((await io.read(scope, pendingName(file.path, epoch))).exists, false);
      assert.equal((await io.read(scope, pendingName(file.path, epoch, true))).exists, false);
      targets[scope][file.path] = observed;
    }
  }
  for (const scope of scopes) {
    for (const file of sealed.files) {
      assertFile(compact(await io.read(scope, file.path)), targets[scope][file.path], 'Target changed during preparation');
    }
  }
  for (const file of sealed.files) {
    const bytes = sealed.payload.get(file.path);
    assert.equal(sha(bytes), file.sha256);
    assert.equal(bytes.length, file.bytes);
    journal.bytes(`payload/${file.path}`, bytes);
  }
  assert.deepEqual(await io.observe(), observation, 'Runtime or startup inputs changed during preparation');
  const plan = {
    contract: 'existing-plm-guard-overlay-deployment-v1', status: 'PREPARED-NOT-APPLIED', epoch,
    candidate: sealed.directory, manifestSha256: sealed.manifestSha256,
    outputInventorySha256: sealedGuardHashes.outputs, preparerSha256: sealedGuardHashes.preparer,
    deployerSha256: sha(deployerSource), deployerTestSha256: sha(testSource),
    observation, preservedGraph, targets, files: sealed.files,
    newFilePolicy: { mode: '644', owner: 'same-as-original-index-in-each-scope' },
    newDirectoryPolicy: { mode: '755', owner: 'same-as-original-index-in-each-scope',
      containerCreationUser: 'recorded-index-uid:gid-so-the-startup-user-can-remove-its-own-tree' },
    switchOrder: ['host-sixteen-new-files', 'container-sixteen-new-files', 'host-index', 'container-index'],
    recovery: { originalIndexSha256: sha(sealed.originalIndex),
      indexes: 'Restore only if current hash, device and inode equal this epoch committed stage',
      newFiles: 'Remove only if absent at preparation and current hash, device and inode match this epoch stage',
      dependencyRetention: 'Retain new dependencies whenever the index in that scope cannot be verified as restored',
      pendingFiles: 'Remove only if a verified staged hash, device and inode remain unchanged',
      directories: 'Retain created directories; never recursively remove them',
      drift: 'Retain every unknown or changed object and report incomplete recovery' },
    forbidden: ['container-create', 'image-pull', 'restart', 'nginx-reload', 'full-tree-copy',
      'plugin-overwrite', 'model-overwrite', 'environment-overwrite', 'old-import-map-overwrite'],
    sourceDifferences: sealed.sourceDifferences, dynamicImportCount: 10, inheritedCss404Count: 3,
    labelMismatchRetained: true, functionalAcceptance: false, preparedAt: new Date().toISOString(),
  };
  journal.fixed('prepared.private.json', plan);
  return plan;
}

export async function applyGuardDeployment({ plan, sealed, io, journal, expectedEpoch }) {
  assert.equal(plan.contract, 'existing-plm-guard-overlay-deployment-v1');
  assert.equal(plan.status, 'PREPARED-NOT-APPLIED');
  assert.match(expectedEpoch ?? '', uuid);
  assert.equal(plan.epoch, expectedEpoch, 'An explicitly reviewed epoch is required');
  assert.equal(plan.manifestSha256, sealedGuardHashes.manifest);
  assert.equal(sealed.manifestSha256, plan.manifestSha256);
  assert.equal(plan.outputInventorySha256, sealedGuardHashes.outputs);
  assert.equal(plan.deployerSha256, sha(fs.readFileSync(fileURLToPath(import.meta.url))),
    'The deployment implementation changed after preparation');
  validateGuardOverlayFiles(plan.files);
  assert.deepEqual(plan.files, sealed.files);
  assert.equal(plan.recovery.originalIndexSha256, sha(sealed.originalIndex));
  for (const file of plan.files) {
    assert.equal(sha(sealed.payload.get(file.path)), file.sha256, 'A sealed payload changed before application');
    assert.equal(sealed.payload.get(file.path).length, file.bytes);
  }
  const ledger = new Map();
  const report = { contract: 'existing-plm-guard-overlay-apply-v1', epoch: plan.epoch,
    status: 'VALIDATING-NOT-YET-WRITING', functionalAcceptance: false, mutations: [],
    planSha256: sha(Buffer.from(`${JSON.stringify(plan, null, 2)}\n`)), deployerSha256: plan.deployerSha256,
    manifestSha256: plan.manifestSha256, outputInventorySha256: plan.outputInventorySha256,
    recovery: [], preservedGraph: null, startedAt: new Date().toISOString() };
  const guard = async () => assert.deepEqual(await io.observe(), plan.observation,
    'Runtime lifecycle, mounts, configuration or startup inputs drifted');
  const read = async (scope, relative) => compact(await io.read(scope, relative));
  const key = (scope, relative) => `${scope}:${relative}`;
  const metadata = (scope, relative) => relative === 'index.html' ? plan.targets[scope][relative]
    : { ...plan.targets[scope]['index.html'], mode: '644' };
  const install = async (scope, file, bytes, before, rollback = false) => {
    if (!rollback) {
      assert.equal(sha(bytes), file.sha256);
      assert.equal(bytes.length, file.bytes);
    }
    const pending = pendingName(file.path, plan.epoch, rollback);
    const desired = { exists: true, bytes: bytes.length, sha256: sha(bytes),
      ...Object.fromEntries(['uid', 'gid', 'mode'].map(field => [field, metadata(scope, file.path)[field]])) };
    await guard();
    assertFile(await read(scope, file.path), before, 'Target drift before staging');
    assert.equal((await read(scope, pending)).exists, false, 'An epoch staging path already exists');
    journal.event('before-stage', { scope, target: file.path, pending, desired, before, rollback });
    await io.stage(scope, pending, bytes, desired, created => journal.event('created-directory', { scope, path: created }));
    const staged = await read(scope, pending);
    assertFile(staged, desired, 'Uploaded file differs from its sealed payload');
    ledger.set(key(scope, pending), staged);
    journal.event('verified-stage', { scope, pending, staged, rollback });
    await guard();
    assertFile(await read(scope, file.path), before, 'Target drift before atomic publication');
    journal.event('before-publish', { scope, target: file.path, pending, before, staged, rollback });
    await io.publish(scope, pending, file.path, before, staged);
    const result = await read(scope, file.path);
    assertFile(result, staged, 'Atomic publication did not retain the exact staged inode and bytes');
    ledger.set(key(scope, file.path), staged);
    journal.event('published-file', { scope, target: file.path, result, rollback });
    assert.equal((await read(scope, pending)).exists, false, 'Published staging link remains');
    if (!rollback) report.mutations.push({ scope, path: file.path, ...result });
  };
  let mutationIntent = false;
  try {
    await guard();
    report.preservedGraph = await io.verifyPreservedGraph(sealed.graph);
    assert.deepEqual(report.preservedGraph, plan.preservedGraph, 'Preserved static dependencies changed');
    for (const scope of scopes) {
      for (const file of plan.files) {
        assertFile(await read(scope, file.path), plan.targets[scope][file.path], 'Pre-apply target drift');
        assert.equal((await read(scope, pendingName(file.path, plan.epoch))).exists, false);
        assert.equal((await read(scope, pendingName(file.path, plan.epoch, true))).exists, false);
      }
    }
    await guard();
    journal.fixed('apply-intent.private.json', { ...report, plan, explicitEpoch: expectedEpoch,
      planSha256: sha(Buffer.from(`${JSON.stringify(plan, null, 2)}\n`)) });
    mutationIntent = true;
    report.status = 'APPLYING-EXACT-GUARD-FILES';
    const newFiles = plan.files.filter(file => file.path !== 'index.html');
    for (const scope of scopes) {
      for (const file of newFiles) {
        await install(scope, file, sealed.payload.get(file.path), { exists: false });
      }
    }
    for (const scope of scopes) {
      for (const file of newFiles) assertFile(await read(scope, file.path), ledger.get(key(scope, file.path)), 'New input drift');
      assertFile(await read(scope, 'index.html'), plan.targets[scope]['index.html'], 'Index changed before final switches');
    }
    const index = plan.files.find(file => file.path === 'index.html');
    for (const scope of scopes) {
      await install(scope, index, sealed.payload.get('index.html'), plan.targets[scope]['index.html']);
    }
    for (const scope of scopes) {
      for (const file of plan.files) assertFile(await read(scope, file.path), ledger.get(key(scope, file.path)), 'Final file readback');
    }
    for (const file of plan.files) {
      const response = await io.http(file.path);
      assert.equal(response.status, 200, `Actual served file failed: ${file.path}`);
      assert.equal(sha(response.bytes), file.sha256, `Actual served bytes differ: ${file.path}`);
      journal.event('http-file-readback', { path: file.path, status: response.status, bytes: response.bytes.length,
        sha256: sha(response.bytes) });
    }
    assert.deepEqual(await io.verifyPreservedGraph(sealed.graph), plan.preservedGraph);
    await guard();
    report.status = 'APPLIED-STATIC-ONLY-BUSINESS-ACCEPTANCE-PENDING';
    return report;
  } catch (error) {
    report.status = mutationIntent ? 'FAILED-APPLY-CONDITIONAL-RECOVERY' : 'REFUSED-BEFORE-MUTATION';
    report.error = error.message;
    if (mutationIntent) {
      for (const scope of [...scopes].reverse()) {
        try {
          await guard();
          const actual = await read(scope, 'index.html');
          const staged = ledger.get(key(scope, pendingName('index.html', plan.epoch)));
          const original = plan.targets[scope]['index.html'];
          if (actual.sha256 === original.sha256 && ['uid', 'gid', 'mode'].every(field => actual[field] === original[field])) {
            report.recovery.push({ scope, path: 'index.html', status: 'ALREADY-ORIGINAL' });
          } else if (sameOwnedFile(actual, staged)) {
            await install(scope, { path: 'index.html' }, sealed.originalIndex, actual, true);
            report.recovery.push({ scope, path: 'index.html', status: 'RESTORED-EXACT-ORIGINAL' });
          } else report.recovery.push({ scope, path: 'index.html', status: 'RETAINED-UNKNOWN-OR-DRIFTED' });
        } catch (restoreError) {
          report.recovery.push({ scope, path: 'index.html', status: 'RECOVERY-BLOCKED', error: restoreError.message });
        }
      }
      const blockedIndexScopes = new Set(report.recovery.filter(item => item.path === 'index.html' &&
        /RETAINED|BLOCKED/.test(item.status)).map(item => item.scope));
      for (const scope of scopes) {
        for (const file of plan.files.filter(file => file.path !== 'index.html').reverse()) {
          const pending = pendingName(file.path, plan.epoch);
          const owned = ledger.get(key(scope, pending));
          try {
            await guard();
            const current = await read(scope, file.path);
            if (!current.exists) report.recovery.push({ scope, path: file.path, status: 'ABSENT' });
            else if (blockedIndexScopes.has(scope)) {
              report.recovery.push({ scope, path: file.path, status: 'RETAINED-INDEX-RECOVERY-BLOCKED' });
            }
            else if (sameOwnedFile(current, owned)) {
              journal.event('before-owned-remove', { scope, path: file.path, expected: current });
              await io.remove(scope, file.path, current);
              assert.equal((await read(scope, file.path)).exists, false);
              report.recovery.push({ scope, path: file.path, status: 'REMOVED-VERIFIED-EPOCH-FILE' });
            } else report.recovery.push({ scope, path: file.path, status: 'RETAINED-UNKNOWN-OR-DRIFTED' });
          } catch (cleanupError) {
            report.recovery.push({ scope, path: file.path, status: 'RECOVERY-BLOCKED', error: cleanupError.message });
          }
        }
      }
      const pendingPaths = scopes.flatMap(scope => plan.files.flatMap(file => [false, true].map(rollback => ({
        scope, relative: pendingName(file.path, plan.epoch, rollback),
      }))));
      for (const { scope, relative } of pendingPaths) {
        const expected = ledger.get(key(scope, relative));
        try {
          await guard();
          const current = await read(scope, relative);
          if (sameOwnedFile(current, expected)) {
            journal.event('before-owned-pending-remove', { scope, path: relative, expected: current });
            await io.remove(scope, relative, current);
          } else if (current.exists) {
            report.recovery.push({ scope, path: relative, status: 'RETAINED-UNKNOWN-OR-DRIFTED' });
          }
        } catch (cleanupError) {
          report.recovery.push({ scope, path: relative, status: 'RECOVERY-BLOCKED', error: cleanupError.message });
        }
      }
      const retained = report.recovery.some(item => /RETAINED|BLOCKED/.test(item.status));
      report.recoveryStatus = retained ? 'INCOMPLETE-RETAINED-FOR-REVIEW' : 'RESTORED-ORIGINAL-INDEXES-AND-REMOVED-VERIFIED-FILES';
    }
    throw Object.assign(error, { evidence: report });
  } finally {
    report.finishedAt = new Date().toISOString();
    journal.fixed('report.private.json', report);
  }
}

export async function rollbackGuardDeployment({
  plan, appliedReport, expectedApplyReportSha256, sealed, io, journal, expectedEpoch,
}) {
  const report = { contract: 'existing-plm-guard-overlay-rollback-v1', epoch: plan?.epoch,
    status: 'VALIDATING-NOT-YET-WRITING', functionalAcceptance: false, restoredIndexes: [],
    removedFiles: [], retained: [], startedAt: new Date().toISOString() };
  const stages = new Map();
  const key = (scope, relative) => `${scope}:${relative}`;
  const read = async (scope, relative) => compact(await io.read(scope, relative));
  let mutationIntent = false;
  const guard = async () => assert.deepEqual(await io.observe(), plan.observation,
    'Rollback refuses a changed runtime, mount, configuration or startup input');
  try {
    assert.equal(plan.contract, 'existing-plm-guard-overlay-deployment-v1');
    assert.equal(plan.status, 'PREPARED-NOT-APPLIED');
    assert.match(expectedEpoch ?? '', uuid);
    assert.equal(plan.epoch, expectedEpoch);
    assert.equal(plan.manifestSha256, sealedGuardHashes.manifest);
    assert.equal(sealed.manifestSha256, plan.manifestSha256);
    assert.equal(plan.outputInventorySha256, sealedGuardHashes.outputs);
    assert.equal(plan.deployerSha256, sha(fs.readFileSync(fileURLToPath(import.meta.url))));
    validateGuardOverlayFiles(plan.files);
    assert.deepEqual(plan.files, sealed.files);
    assert.equal(sha(sealed.originalIndex), plan.recovery.originalIndexSha256);
    assert.match(expectedApplyReportSha256 ?? '', hashes);
    assert.equal(sha(Buffer.from(`${JSON.stringify(appliedReport, null, 2)}\n`)), expectedApplyReportSha256,
      'The explicitly reviewed successful apply receipt changed');
    assert.equal(appliedReport.contract, 'existing-plm-guard-overlay-apply-v1');
    assert.equal(appliedReport.status, 'APPLIED-STATIC-ONLY-BUSINESS-ACCEPTANCE-PENDING');
    assert.equal(appliedReport.epoch, expectedEpoch);
    assert.equal(appliedReport.planSha256, sha(Buffer.from(`${JSON.stringify(plan, null, 2)}\n`)));
    for (const field of ['deployerSha256', 'manifestSha256', 'outputInventorySha256']) {
      assert.equal(appliedReport[field], plan[field]);
    }
    assert.equal(appliedReport.mutations.length, plan.files.length * scopes.length);
    const published = new Map(appliedReport.mutations.map(file => [key(file.scope, file.path), file]));
    assert.equal(published.size, plan.files.length * scopes.length);
    await guard();
    assert.deepEqual(await io.verifyPreservedGraph(sealed.graph), plan.preservedGraph);
    for (const scope of scopes) {
      for (const file of plan.files) {
        const expected = published.get(key(scope, file.path));
        assert.ok(expected, 'A successful published-file receipt is missing');
        assert.equal(expected.exists, true);
        assert.equal(expected.sha256, file.sha256);
        assert.equal(expected.bytes, file.bytes);
        for (const field of ['dev', 'ino', 'uid', 'gid']) assert.match(expected[field], /^\d+$/);
        const original = plan.targets[scope]['index.html'];
        assert.equal(expected.uid, original.uid);
        assert.equal(expected.gid, original.gid);
        assert.equal(expected.mode, file.path === 'index.html' ? original.mode : '644');
        assertFile(await read(scope, file.path), expected, 'Published object drift prevents rollback');
        for (const rollback of [false, true]) {
          assert.equal((await read(scope, pendingName(file.path, expectedEpoch, rollback))).exists, false,
            'A pending path prevents adoption of an earlier or unknown rollback');
        }
      }
    }
    await guard();
    report.planSha256 = appliedReport.planSha256;
    report.applyReportSha256 = expectedApplyReportSha256;
    report.deployerSha256 = plan.deployerSha256;
    report.manifestSha256 = plan.manifestSha256;
    journal.fixed('rollback-intent.private.json', { ...report, plan, published: appliedReport.mutations,
      order: ['container-index', 'host-index', 'verify-both-original-indexes', 'remove-only-verified-new-files'] });
    mutationIntent = true;
    for (const scope of [...scopes].reverse()) {
      const relative = 'index.html';
      const pending = pendingName(relative, expectedEpoch, true);
      const before = published.get(key(scope, relative));
      const original = plan.targets[scope][relative];
      const desired = { exists: true, bytes: sealed.originalIndex.length, sha256: sha(sealed.originalIndex),
        uid: original.uid, gid: original.gid, mode: original.mode };
      await guard();
      assertFile(await read(scope, relative), before, 'Index drift before rollback staging');
      journal.event('before-rollback-stage', { scope, target: relative, pending, desired, before });
      await io.stage(scope, pending, sealed.originalIndex, desired,
        created => journal.event('created-directory', { scope, path: created }));
      const staged = await read(scope, pending);
      assertFile(staged, desired, 'The original-index restoration input changed');
      stages.set(key(scope, pending), staged);
      journal.event('verified-rollback-stage', { scope, pending, staged });
      await guard();
      assertFile(await read(scope, relative), before, 'Index drift before conditional restoration');
      journal.event('before-rollback-publish', { scope, target: relative, pending, before, staged });
      await io.publish(scope, pending, relative, before, staged);
      assertFile(await read(scope, relative), staged, 'Restoration did not retain the verified original-index inode');
      assert.equal((await read(scope, pending)).exists, false);
      stages.set(key(scope, relative), staged);
      report.restoredIndexes.push({ scope, path: relative, ...staged });
      journal.event('restored-original-index', { scope, path: relative, ...staged });
    }
    const verifyOriginalIndexes = async () => {
      for (const scope of scopes) {
        assertFile(await read(scope, 'index.html'), stages.get(key(scope, 'index.html')),
          'An index changed after restoration; dependencies must remain');
      }
    };
    await verifyOriginalIndexes();
    for (const scope of scopes) {
      for (const file of plan.files.filter(file => file.path !== 'index.html').reverse()) {
        await guard();
        await verifyOriginalIndexes();
        const expected = published.get(key(scope, file.path));
        assertFile(await read(scope, file.path), expected, 'New file drift prevents conditional deletion');
        journal.event('before-rollback-owned-remove', { scope, path: file.path, expected });
        await io.remove(scope, file.path, expected);
        assert.equal((await read(scope, file.path)).exists, false);
        report.removedFiles.push({ scope, path: file.path, sha256: expected.sha256, dev: expected.dev, ino: expected.ino });
        journal.event('removed-rollback-owned-file', report.removedFiles.at(-1));
      }
    }
    await verifyOriginalIndexes();
    assert.deepEqual(await io.verifyPreservedGraph(sealed.graph), plan.preservedGraph);
    const response = await io.http('index.html');
    assert.equal(response.status, 200);
    assert.equal(sha(response.bytes), plan.recovery.originalIndexSha256, 'Restored HTTP index differs from its backup');
    journal.event('restored-http-index', { status: response.status, bytes: response.bytes.length, sha256: sha(response.bytes) });
    await guard();
    report.status = 'ROLLED-BACK-EXACT-INDEXES-REMOVED-VERIFIED-EPOCH-FILES';
    return report;
  } catch (error) {
    report.status = mutationIntent ? 'ROLLBACK-FAILED-RETAINED-FOR-REVIEW' : 'REFUSED-ROLLBACK-BEFORE-MUTATION';
    report.error = error.message;
    if (mutationIntent) {
      for (const scope of scopes) {
        for (const file of plan.files.filter(file => file.path !== 'index.html')) {
          if (!report.removedFiles.some(removed => removed.scope === scope && removed.path === file.path)) {
            report.retained.push({ scope, path: file.path, reason: 'No deletion after an incomplete or drifted rollback' });
          }
        }
        const pending = pendingName('index.html', expectedEpoch, true);
        try {
          await guard();
          const actual = await read(scope, pending);
          if (sameOwnedFile(actual, stages.get(key(scope, pending)))) {
            journal.event('before-rollback-owned-pending-remove', { scope, path: pending, expected: actual });
            await io.remove(scope, pending, actual);
          } else if (actual.exists) report.retained.push({ scope, path: pending, reason: 'Unverified restoration stage' });
        } catch (cleanupError) {
          report.retained.push({ scope, path: pending, reason: cleanupError.message });
        }
      }
    }
    throw Object.assign(error, { evidence: report });
  } finally {
    report.finishedAt = new Date().toISOString();
    journal.fixed('report.private.json', report);
  }
}

function fsyncDirectory(directory) {
  const descriptor = fs.openSync(directory, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
}

function durableJournal(output) {
  assert.equal(fs.realpathSync(path.dirname(output)), artifacts);
  assert.match(path.basename(output), /^plm-guard-(?:deploy|apply|rollback)-[a-z0-9-]+$/);
  fs.mkdirSync(output, { mode: 0o700 });
  fsyncDirectory(artifacts);
  let sequence = 0;
  const bytes = (relative, content) => {
    safeRelative(relative);
    const directory = path.dirname(path.join(output, relative));
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    const descriptor = fs.openSync(path.join(output, relative), 'wx', 0o600);
    try { fs.writeFileSync(descriptor, content); fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    let current = directory;
    while (current !== path.dirname(output)) {
      fsyncDirectory(current);
      if (current === output) break;
      current = path.dirname(current);
    }
  };
  const fixed = (filename, value) => bytes(filename, `${JSON.stringify(value, null, 2)}\n`);
  return { bytes, fixed, event(stage, data) {
    fixed(`event-${String(++sequence).padStart(4, '0')}-${stage}.private.json`,
      { stage, ...data, recordedAt: new Date().toISOString() });
  } };
}

function readPrivate(filename) {
  const info = fs.lstatSync(filename);
  assert.ok(info.isFile() && !info.isSymbolicLink() && (info.mode & 0o077) === 0 && info.uid === process.geteuid(),
    'A sealed input must remain an owned private regular file');
  return fs.readFileSync(filename);
}

export function loadSealedGuardCandidate(directory) {
  const root = fs.realpathSync(directory);
  assert.equal(path.dirname(root), artifacts);
  const bytes = readPrivate(path.join(root, 'guard-overlay.private.json'));
  assert.equal(sha(bytes), sealedGuardHashes.manifest, 'Only the reviewed candidate manifest is eligible');
  const manifest = JSON.parse(bytes);
  assert.equal(manifest.status, 'PREPARED-NOT-DEPLOYED');
  assert.equal(manifest.outputInventorySha256, sealedGuardHashes.outputs);
  assert.equal(manifest.preparerSha256, sealedGuardHashes.preparer);
  assert.equal(sha(fs.readFileSync(path.join(workspace, 'scripts/prepare-plm-guard-overlay.mjs'))), sealedGuardHashes.preparer);
  assert.equal(sha(readPrivate(path.join(root, 'inherited-source-build.private.json'))), sealedGuardHashes.inheritedReceipt);
  validateGuardOverlayFiles(manifest.outputFiles);
  assert.equal(sha(Buffer.from(JSON.stringify(manifest.outputFiles))), sealedGuardHashes.outputs);
  assert.equal(manifest.staticFiles.length, 3231);
  assert.equal(manifest.nonliteralDynamicImports.length, 10);
  assert.equal(manifest.conditionalCssReferences.length, 3);
  const payload = new Map();
  for (const file of manifest.staticFiles) {
    safeRelative(file.path);
    assert.ok(['source-built-overlay', 'actual-live-http-bytes'].includes(file.source));
    const content = readPrivate(path.join(root, file.source === 'source-built-overlay' ? 'overlay' : 'base', file.path));
    assert.equal(sha(content), file.sha256, `Sealed static dependency changed: ${file.path}`);
    assert.equal(content.length, file.bytes);
    if (file.source === 'source-built-overlay') payload.set(file.path, content);
  }
  for (const file of manifest.sourceFiles) {
    const content = readPrivate(path.join(root, 'sources', file.path));
    assert.equal(sha(content), file.sha256);
    assert.equal(sha(fs.readFileSync(path.join(workspace, file.path))), file.sha256,
      `The reviewed guard source changed: ${file.path}`);
  }
  const originalIndex = readPrivate(path.join(root, 'rollback/index.html'));
  assert.equal(sha(originalIndex), sealedGuardHashes.originalIndex);
  return { directory: root, manifestSha256: sha(bytes), files: manifest.outputFiles, payload, originalIndex,
    graph: manifest.staticFiles.filter(file => file.source === 'actual-live-http-bytes'),
    expectedRuntime: manifest.after, sourceDifferences: manifest.sourceDifferences };
}

const walkContainerPath = `set -efu
set -f
root=$1
relative=$2
create=$3
shift 3
test -d "$root" && test ! -L "$root"
current=$root
old_ifs=$IFS
IFS=/
set -- $relative
IFS=$old_ifs
while test "$#" -gt 1; do
  current="$current/$1"
  test ! -L "$current"
  if test -e "$current"; then
    test -d "$current"
  elif test "$create" = yes; then
    mkdir -m 755 "$current"
    printf 'CREATED %s\\n' "$current"
  else
    printf 'ABSENT\\n'
    exit 0
  fi
  shift
done
target="$current/$1"
test ! -L "$target"
`;

export function createActualIo(sealed, execute = (args, options = {}) => spawnSync('docker', args, {
  timeout: 20_000, maxBuffer: 8 * 1024 * 1024, ...options,
})) {
  const id = sealed.expectedRuntime.id;
  let environmentWitness;
  assert.match(id, /^[a-f0-9]{64}$/);
  const run = (args, input) => {
    const result = execute(args, { input });
    assert.equal(result.status, 0, `Existing-container command failed: ${args[0]} ${String(result.stderr ?? '').slice(0, 400)}`);
    return Buffer.from(result.stdout ?? '');
  };
  const shell = (script, relative, create = 'no', input, user = '0') => {
    assert.match(user, /^\d+(?::\d+)?$/);
    return run(['exec', '-i', '--user', user, id, 'sh', '-c', script, 'plm-guard', '/dist', relative, create], input);
  };
  const hostPath = (relative, create = false, onCreated = () => {}) => {
    deploymentPath(relative);
    assert.equal(fs.realpathSync(hostDist), hostDist);
    let current = hostDist;
    for (const component of relative.split('/').slice(0, -1)) {
      current = path.join(current, component);
      if (!fs.existsSync(current)) {
        try {
          const possible = fs.lstatSync(current);
          assert.ok(!possible.isSymbolicLink());
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (!create) return null;
        fs.mkdirSync(current, { mode: 0o755 });
        fsyncDirectory(path.dirname(current));
        onCreated(current);
      }
      const info = fs.lstatSync(current);
      assert.ok(info.isDirectory() && !info.isSymbolicLink(), 'A host target parent is not a plain directory');
    }
    return path.join(hostDist, relative);
  };
  const read = async (scope, relative) => {
    deploymentPath(relative);
    if (scope === 'host') {
      const filename = hostPath(relative);
      if (!filename) return { exists: false };
      let descriptor;
      try {
        descriptor = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
        const stat = fs.fstatSync(descriptor, { bigint: true });
        assert.ok(stat.isFile());
        return { exists: true, bytes: fs.readFileSync(descriptor), uid: String(stat.uid), gid: String(stat.gid),
          mode: (stat.mode & 0o7777n).toString(8), dev: String(stat.dev), ino: String(stat.ino) };
      } catch (error) { if (error.code === 'ENOENT') return { exists: false }; throw error; }
      finally { if (descriptor !== undefined) fs.closeSync(descriptor); }
    }
    assert.equal(scope, 'container');
    const bytes = shell(`${walkContainerPath}
if test ! -e "$target"; then printf 'ABSENT\\n'; exit 0; fi
test -f "$target"
printf 'FILE '
stat -c '%u %g %a %d %i %s' "$target"
cat "$target"
`, relative);
    const separator = bytes.indexOf(10);
    const metadata = bytes.subarray(0, separator).toString();
    if (metadata === 'ABSENT') return { exists: false };
    const match = metadata.match(/^FILE (\d+) (\d+) ([0-7]+) (\d+) (\d+) (\d+)$/);
    assert.ok(match, 'Container file metadata could not be established');
    const content = bytes.subarray(separator + 1);
    assert.equal(content.length, Number(match[6]));
    return { exists: true, uid: match[1], gid: match[2], mode: match[3], dev: match[4], ino: match[5], bytes: content };
  };
  const observe = async () => {
    const [current] = JSON.parse(run(['inspect', id]));
    assert.equal(current.Id, id);
    assert.equal(current.Image, sealed.expectedRuntime.image);
    assert.equal(current.Name, '/plmweb');
    assert.equal(current.Config.Labels?.['com.docker.compose.project'], 'compose');
    assert.equal(current.Config.Labels?.['com.docker.compose.service'], 'plmweb');
    assert.equal(current.State.Status, 'running');
    assert.equal(current.State.StartedAt, sealed.expectedRuntime.startedAt);
    assert.equal(current.RestartCount, sealed.expectedRuntime.restartCount);
    assert.deepEqual(current.Config.Entrypoint, ['/start.sh']);
    assert.deepEqual(current.Config.Cmd, []);
    const mounts = [...current.Mounts].sort((left, right) => left.Destination.localeCompare(right.Destination));
    assert.deepEqual(mounts, sealed.expectedRuntime.mounts);
    assert.ok(!mounts.some(mount => mount.Destination === '/dist' || mount.Destination.startsWith('/dist/')));
    for (const [destination, source] of [['/opt/aibiz/local-dist', hostDist], ['/opt/aibiz/local-plugins', hostPlugins]]) {
      const mount = mounts.find(item => item.Destination === destination);
      assert.ok(mount && mount.Type === 'bind' && mount.Source === source && mount.RW === false);
      assert.equal(fs.realpathSync(source), source);
    }
    const environment = Object.fromEntries(current.Config.Env.map(value => [value.slice(0, value.indexOf('=')), value.slice(value.indexOf('=') + 1)]));
    assert.equal(environment.LOCAL_DIST_SOURCE, '/opt/aibiz/local-dist');
    assert.equal(environment.LOCAL_PLUGIN_SOURCE, '/opt/aibiz/local-plugins');
    const startup = run(['exec', id, 'cat', '/start.sh']);
    const startupReview = reviewGuardStartup(startup.toString());
    assert.equal(sha(fs.readFileSync(startupSource)), startupReview.sha256);
    const environmentSource = fs.readFileSync(path.join(hostDist, 'environments/environment.js'));
    const environmentConfiguration = run(['exec', id, 'cat', '/environment.config']);
    const environmentProgram = guardStartupEnvironmentProgram(startup.toString());
    const environmentRendered = run(['exec', '-i', '--env', 'LC_ALL=C', id, 'awk', '-F:', environmentProgram,
      '/environment.config', '-'], environmentSource);
    const environmentActual = run(['exec', id, 'cat', '/dist/environments/environment.js']);
    assert.equal(sha(environmentRendered), sha(environmentActual),
      'The current served environment does not reproduce from reviewed startup inputs');
    environmentWitness = { path: 'environments/environment.js', sourceSha256: sha(environmentSource),
      configurationSha256: sha(environmentConfiguration), renderedSha256: sha(environmentRendered),
      servedSha256: sha(environmentActual), programSha256: sha(Buffer.from(environmentProgram)),
      verification: 'read-only-awk-with-existing-container-environment-and-host-source-stdin' };
    const nginx = run(['exec', id, 'nginx', '-T']).toString();
    assert.match(nginx, /location\s+\^~\s+\/ibizplm-plmweb\/\s*\{[^}]*alias\s+\/dist\/;/);
    const configurationSha256 = sha(Buffer.from(JSON.stringify({ config: current.Config, host: current.HostConfig })));
    assert.equal(configurationSha256, sealed.expectedRuntime.configurationSha256);
    return { runtime: { id, image: current.Image, startedAt: current.State.StartedAt, restartCount: current.RestartCount,
      mounts, configurationSha256 },
    startup: startupReview, environment: environmentWitness, nginxConfigurationSha256: sha(Buffer.from(nginx)),
    hostStartupSource: startupSource, hostDist, containerDist: '/dist', pluginOverridePrefix: '/dist/plugins/' };
  };
  const verifyPreservedGraph = async files => {
    const actual = [], startupInputs = [];
    assert.ok(environmentWitness, 'A startup environment transformation witness is required first');
    for (let index = 0; index < files.length; index += 64) {
      const batch = files.slice(index, index + 64);
      for (const file of batch) safeRelative(file.path);
      const lines = run(['exec', '--user', '0', id, 'sha256sum', ...batch.map(file => `/dist/${file.path}`)])
        .toString().trimEnd().split('\n');
      assert.equal(lines.length, batch.length);
      for (const [offset, file] of batch.entries()) {
        const expectedLine = `${file.sha256}  /dist/${file.path}`;
        assert.equal(lines[offset], expectedLine, `Actual preserved service input changed: ${file.path}`);
        const content = fs.readFileSync(path.join(hostDist, file.path));
        const expectedSource = file.path === environmentWitness.path ? environmentWitness.sourceSha256 : file.sha256;
        assert.equal(sha(content), expectedSource, `Preserved startup input changed: ${file.path}`);
        actual.push({ path: file.path, sha256: file.sha256, bytes: file.bytes });
        startupInputs.push({ path: file.path, sha256: sha(content), bytes: content.length });
      }
    }
    return { files: actual.length, unchangedServedInputsVerified: true,
      inventorySha256: sha(Buffer.from(JSON.stringify(actual))),
      startupInputInventorySha256: sha(Buffer.from(JSON.stringify(startupInputs))),
      explicitStartupTransformations: [environmentWitness] };
  };
  const stage = async (scope, relative, bytes, metadata, onCreated) => {
    deploymentPath(relative);
    if (scope === 'host') {
      const filename = hostPath(relative, true, onCreated);
      const descriptor = fs.openSync(filename, 'wx', Number.parseInt(metadata.mode, 8));
      try {
        fs.writeFileSync(descriptor, bytes);
        fs.fchownSync(descriptor, Number(metadata.uid), Number(metadata.gid));
        fs.fchmodSync(descriptor, Number.parseInt(metadata.mode, 8));
        fs.fsyncSync(descriptor);
      } finally { fs.closeSync(descriptor); }
      fsyncDirectory(path.dirname(filename));
    } else {
      assert.equal(scope, 'container');
      const created = shell(`${walkContainerPath}
test ! -e "$target" && test ! -L "$target"
umask 077
set -C
dd conv=fsync status=none >"$target"
chown '${metadata.uid}:${metadata.gid}' "$target"
chmod '${metadata.mode}' "$target"
sync "$target"
sync "$current"
`, relative, 'yes', bytes, `${metadata.uid}:${metadata.gid}`);
      for (const line of created.toString().split('\n').filter(Boolean)) {
        assert.ok(line.startsWith('CREATED /dist/'));
        onCreated(line.slice('CREATED '.length));
      }
    }
  };
  const remove = async (scope, relative, expected) => {
    deploymentPath(relative);
    assertFile(compact(await read(scope, relative)), expected, 'Conditional removal refuses a changed inode or payload');
    if (scope === 'host') {
      const filename = hostPath(relative);
      fs.unlinkSync(filename);
      fsyncDirectory(path.dirname(filename));
    } else shell(`${walkContainerPath}
test -f "$target"
test "$(stat -c '%d:%i' "$target")" = '${expected.dev}:${expected.ino}'
test "$(sha256sum "$target" | cut -d ' ' -f 1)" = '${expected.sha256}'
rm -- "$target"
sync "$current"
`, relative);
  };
  const publish = async (scope, pending, relative, expected, staged) => {
    deploymentPath(relative);
    deploymentPath(pending);
    assertFile(compact(await read(scope, relative)), expected, 'Publication target changed');
    assertFile(compact(await read(scope, pending)), staged, 'Staging input changed');
    if (scope === 'host') {
      const source = hostPath(pending), target = hostPath(relative);
      if (expected.exists) fs.renameSync(source, target);
      else {
        fs.linkSync(source, target);
        await remove(scope, pending, staged);
      }
      fsyncDirectory(path.dirname(target));
    } else {
      const originalGuard = expected.exists ? `
test -f "$target"
test "$(stat -c '%d:%i' "$target")" = '${expected.dev}:${expected.ino}'
test "$(sha256sum "$target" | cut -d ' ' -f 1)" = '${expected.sha256}'
mv -T -- "$pending" "$target"` : `
test ! -e "$target" && test ! -L "$target"
ln -T -- "$pending" "$target"
rm -- "$pending"`;
      shell(`${walkContainerPath}
pending='/dist/${pending}'
test -f "$pending" && test ! -L "$pending"
test "$(stat -c '%d:%i' "$pending")" = '${staged.dev}:${staged.ino}'
test "$(sha256sum "$pending" | cut -d ' ' -f 1)" = '${staged.sha256}'
${originalGuard}
sync "$target"
sync "$current"
`, relative);
    }
  };
  return { observe, read, verifyPreservedGraph, stage, publish, remove, async http(relative) {
    deploymentPath(relative);
    const response = await fetch(`http://127.0.0.1:30250/ibizplm-plmweb/${relative}`, { signal: AbortSignal.timeout(15_000) });
    return { status: response.status, bytes: Buffer.from(await response.arrayBuffer()) };
  } };
}

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: {
    apply: { type: 'boolean' }, candidate: { type: 'string' }, output: { type: 'string' },
    plan: { type: 'string' }, epoch: { type: 'string' }, 'plan-sha256': { type: 'string' },
    rollback: { type: 'boolean' }, 'apply-report': { type: 'string' }, 'apply-report-sha256': { type: 'string' },
  } });
  assert.ok(values.output && path.isAbsolute(values.output));
  assert.ok(!(values.apply === true && values.rollback === true), 'Apply and rollback are distinct explicit operations');
  let plan, appliedReport;
  if (values.apply === true || values.rollback === true) {
    assert.ok(values.plan && path.isAbsolute(values.plan));
    assert.match(values.epoch ?? '', uuid);
    assert.match(values['plan-sha256'] ?? '', hashes);
    const content = readPrivate(values.plan);
    assert.equal(sha(content), values['plan-sha256'], 'The explicitly reviewed plan bytes changed');
    plan = JSON.parse(content);
    assert.equal(values.candidate, undefined, 'Apply uses only the candidate bound by its reviewed plan');
    if (values.rollback === true) {
      assert.ok(values['apply-report'] && path.isAbsolute(values['apply-report']));
      assert.match(values['apply-report-sha256'] ?? '', hashes);
      assert.equal(path.basename(values['apply-report']), 'report.private.json');
      assert.equal(path.dirname(path.dirname(values['apply-report'])), artifacts);
      const reportBytes = readPrivate(values['apply-report']);
      assert.equal(sha(reportBytes), values['apply-report-sha256']);
      appliedReport = JSON.parse(reportBytes);
    } else {
      assert.equal(values['apply-report'], undefined);
      assert.equal(values['apply-report-sha256'], undefined);
    }
  } else {
    assert.equal(values.plan, undefined);
    assert.equal(values.epoch, undefined);
    assert.equal(values['plan-sha256'], undefined);
    assert.equal(values['apply-report'], undefined);
    assert.equal(values['apply-report-sha256'], undefined);
    assert.ok(values.candidate && path.isAbsolute(values.candidate));
  }
  const sealed = loadSealedGuardCandidate(plan?.candidate ?? values.candidate);
  if (plan) {
    assert.equal(path.basename(values.plan), 'prepared.private.json');
    assert.equal(path.dirname(path.dirname(values.plan)), artifacts);
    for (const file of sealed.files) {
      const bytes = readPrivate(path.join(path.dirname(values.plan), 'payload', file.path));
      assert.equal(sha(bytes), file.sha256);
    }
    for (const scope of scopes) {
      assert.equal(sha(readPrivate(path.join(path.dirname(values.plan), 'backup', scope, 'index.html'))), sealedGuardHashes.originalIndex);
    }
    assert.equal(sha(readPrivate(path.join(path.dirname(values.plan), 'executor-source.private.mjs'))), plan.deployerSha256);
    assert.equal(sha(readPrivate(path.join(path.dirname(values.plan), 'executor-test-source.private.mjs'))), plan.deployerTestSha256);
  }
  const output = path.resolve(values.output);
  const journal = durableJournal(output);
  const io = createActualIo(sealed);
  const result = values.rollback === true
    ? await rollbackGuardDeployment({ plan, appliedReport, sealed, io, journal, expectedEpoch: values.epoch,
      expectedApplyReportSha256: values['apply-report-sha256'] })
    : plan ? await applyGuardDeployment({ plan, sealed, io, journal, expectedEpoch: values.epoch })
    : await prepareGuardDeployment({ sealed, io, journal });
  console.log(JSON.stringify({ status: result.status, output, epoch: result.epoch,
    planSha256: plan ? values['plan-sha256'] : sha(fs.readFileSync(path.join(output, 'prepared.private.json'))),
    reportSha256: plan ? sha(fs.readFileSync(path.join(output, 'report.private.json'))) : undefined,
    functionalAcceptance: false }));
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
