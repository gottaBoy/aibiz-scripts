import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const scriptsRoot = fileURLToPath(new URL('..', import.meta.url));
const workspaceRoot = resolve(scriptsRoot, '..');
const recordPath = resolve(scriptsRoot, 'records/aibiz-functional-baseline-20261116.json');
const documentPath = resolve(scriptsRoot, 'docs/BASELINE-20261116.md');
const baseline = JSON.parse(readFileSync(recordPath, 'utf8'));
const canonical = readFileSync(resolve(scriptsRoot, 'docs/ALL-TASKS-20261111.md'), 'utf8');
const anchorCommits = {
  backend: '2638748be0223b78f97fb3e7da79b3fdde5f946b',
  hub: 'c9c7895a45eab1c18107f878e72d24b8d580f10b',
  modeling: 'cd5458f03d9189a0711443f3ecf6f5818ef3383b',
  scripts: 'b8fefe115f888ea81034e2f9bfb3fb8204ed7790',
};
const requiredFlags = {
  route: [
    'exactSystemEndpointBound', 'publishedConfigurationSourceBound',
    'nativeQueryToAppContextBound', 'genericIdentityEndpointRemainsSeparate',
  ],
  http: [
    'routingMetadataResponseAcceptance', 'realResponsesDispatched', 'allExpectedRoleRootCasesVerified',
    'ordinaryAuthAnd20SecondTokensUnchanged', 'noSyntheticIdentityOrProjection',
    'twoModelSchemasAllRowsUnchanged', 'allErrorsAccountedWithoutFiltering',
  ],
  browser: [
    'ordinaryUiLoginAndRootBootstrap', 'nativeProjectionConsumed', 'expectedTargetObserved',
    'loaderFreeStableReadiness', 'noForcedClickOrControllerInjection',
    'consolePageNetworkAndBlockedErrorsAccounted',
  ],
  cleanup: [
    'exactOwnedResourcesRetired', 'finalPhysicalModelComparisonPassed',
    'sharedLifecycleAndConfigurationUnchanged', 'declaredInputComparisonPassed',
    'noGlobalPruneOrPersistentVolumeDeletion', 'allCleanupErrorsAccounted',
  ],
};
const requiredReceiptKinds = {
  route: 'owned-native-route-binding',
  http: 'owned-native-routing-http',
  browser: 'owned-native-browser-bootstrap',
  cleanup: 'exact-owned-cleanup',
};
const sorted = values => [...values].sort();
const clone = () => structuredClone(baseline);
const sha = 'a'.repeat(64);
const date = '2026-11-16T00:00:00+08:00';
const expectedCoverage = {
  authenticatedQueries: 12, authorizedProjections: 4,
  authenticatedAbsentProjections: 8, anonymousDenials: 2,
};
const expectedCells = ['zh-CN/desktop', 'zh-CN/mobile', 'en-US/desktop', 'en-US/mobile'];
const nonClaims = [
  'completeNativeCrud', 'fullRoleMatrix', 'allLocalesAndLayouts', 'uaaStateInvariance',
  'metadataStateInvariance', 'cacheStateInvariance', 'nativeUnicodeMigratedAndApiAccepted',
  'sharedCandidateDeployed', 'sharedReleaseAccepted', 'allCanonicalTasksComplete',
];

function privateReference(receipt, kind) {
  assert.ok(receipt && typeof receipt === 'object', `Missing ${kind} receipt`);
  assert.equal(receipt.kind, kind, `Unexpected receipt kind for ${kind}`);
  assert.match(receipt.path ?? '', /^\.artifacts\/[A-Za-z0-9_./-]+$/);
  assert.ok(!receipt.path.split('/').some(part => part === '..' || part === '.'));
  assert.match(receipt.sha256 ?? '', /^[a-f0-9]{64}$/);
}

function currentBinding(data) {
  const value = data.freshAcceptance.candidateBinding;
  assert.equal(value.status, 'VERIFIED-BYTE-BOUND', 'Current commit/byte binding required');
  assert.equal(value.byteEquivalenceVerified, true);
  assert.equal(value.sourcePackageImagesBound, true);
  assert.equal(value.frontendServedBytesBound, true);
  assert.match(value.testedSourceInputsSha256 ?? '', /^[a-f0-9]{64}$/);
  assert.equal(value.deliveredSourceInputsSha256, value.testedSourceInputsSha256);
  privateReference(value.currentCommitReceipt, 'current-commit-source-byte-binding');
  for (const key of Object.keys(anchorCommits)) {
    assert.match(value.executionCommits?.[key] ?? '', /^[a-f0-9]{40}$/);
    assert.match(value.deliveryCommits?.[key] ?? '', /^[a-f0-9]{40}$/);
    if (value.deliveryCommits[key] !== data.sourceAnchor[key].commit
        || value.executionCommits[key] !== data.sourceAnchor[key].commit) {
      const delta = value.reviewedChangesFromAnchor.find(change => change.repository === key);
      assert.ok(delta, `${key}: missing reviewed change from the anchor`);
      assert.equal(delta.from, data.sourceAnchor[key].commit);
      assert.equal(delta.to, value.deliveryCommits[key]);
      assert.equal(delta.reviewed, true);
      privateReference(delta.receipt, 'reviewed-source-delta');
    }
  }
}

function currentRun(data) {
  const run = data.freshAcceptance.run;
  assert.match(run?.runId ?? '', /^[a-f0-9]{12}$/);
  assert.ok(!data.retiredRunIds.includes(run.runId), 'Retired campaign cannot become this fresh run');
  assert.equal(run.freshlyInspectedOwnedResources, true);
  assert.equal(run.activeAtDispatch, true);
  assert.equal(run.retiredBeforeExecution, false);
  assert.ok(Number.isFinite(Date.parse(run.startedAt)), 'Execution start date required');
  assert.match(run.identityWitnessSha256 ?? '', /^[a-f0-9]{64}$/);
  return run;
}

function boundedScope(data, name) {
  const scope = data.freshAcceptance[name];
  assert.ok(['NOT-RUN', 'IN-PROGRESS', 'FAILED', 'BLOCKED', 'VERIFIED-BOUNDED'].includes(scope.status));
  assert.deepEqual(sorted(Object.keys(scope.flags)), sorted(requiredFlags[name]),
    `${name}: required flags cannot be removed or replaced`);
  assert.ok(Object.values(scope.flags).every(value => typeof value === 'boolean'));
  if (scope.status !== 'VERIFIED-BOUNDED') return;
  currentBinding(data);
  const run = currentRun(data);
  assert.ok(Object.values(scope.flags).every(value => value === true),
    `${name}: every required flag must be true`);
  privateReference(scope.receipt, requiredReceiptKinds[name]);
  assert.equal(scope.receipt.runId, run.runId);
  assert.ok(!Object.values(data.receiptCatalog).some(receipt => receipt.path === scope.receipt.path),
    'Historical catalog receipt cannot be relabeled as a fresh result');
  assert.ok(!data.retiredRunIds.some(id => scope.receipt.path.includes(`/${id}/`)),
    'Retired run path cannot be used as a fresh receipt');
  assert.equal(scope.receipt.sourceOnly, false, 'Source-only evidence cannot verify native scope');
  assert.equal(scope.receipt.executed, true);
  assert.equal(scope.receipt.retiredBeforeExecution, false);
  assert.ok(Number.isFinite(Date.parse(scope.receipt.observedAt)));
  assert.ok(Date.parse(scope.receipt.observedAt) >= Date.parse(run.startedAt));
  if (name === 'http') {
    assert.deepEqual(scope.observedCoverage, expectedCoverage);
    assert.equal(Object.hasOwn(scope.flags, 'readonlyMetadataAcceptance'), false,
      'Retired response flags cannot stand in for the current routing contract');
  }
  if (name === 'browser') {
    const cells = scope.observedCells.map(cell => `${cell.locale}/${cell.viewport}`);
    assert.equal(new Set(cells).size, 4, 'Duplicate browser cells cannot replace missing cells');
    assert.deepEqual(sorted(cells), sorted(expectedCells));
    for (const cell of scope.observedCells) {
      assert.equal(cell.status, 'PASSED-BOUNDED-BOOTSTRAP');
      for (const counter of ['consoleErrors', 'pageErrors', 'failedRequests', 'blockedRequests']) {
        assert.equal(cell[counter], 0, `${counter}: errors must be explained before bootstrap can pass`);
      }
    }
  }
}

function validate(data) {
  assert.equal(data.schemaVersion, 1);
  assert.equal(data.baselineVersion, '2026-11-16.1');
  assert.equal(data.checkpointDate, '2026-11-15');
  assert.equal(data.validationDate, '2026-11-16');
  assert.equal(data.recordedDate, '2026-11-16');
  assert.equal(data.timezone, 'Asia/Singapore');
  assert.deepEqual(Object.fromEntries(Object.entries(data.sourceAnchor)
    .map(([key, value]) => [key, value.commit])), anchorCommits);
  const rows = [...canonical.split('## Agent Receipts')[0].matchAll(
    /^\| ([A-Z]\d{2}) \| (VERIFIED|PARTIAL|ACTIVE|BLOCKED|OPEN) \|/gm,
  )].map(([, id, status]) => ({ id, status }));
  assert.equal(rows.length, 30);
  assert.equal(data.canonicalBoundary.totalTopLevelItems, 30);
  assert.equal(data.canonicalBoundary.notFullyAcceptedCount, 25);
  assert.deepEqual(sorted(data.canonicalBoundary.notFullyAcceptedIds),
    sorted(rows.filter(row => row.status !== 'VERIFIED').map(row => row.id)));
  assert.equal(new Set(data.canonicalBoundary.notFullyAcceptedIds).size, 25);
  assert.deepEqual(sorted(data.canonicalBoundary.retainedRegressionIds),
    sorted(rows.filter(row => row.status === 'VERIFIED').map(row => row.id)));
  assert.equal(data.canonicalBoundary.baselineMayCloseCanonicalItems, false);
  for (const [id, receipt] of Object.entries(data.receiptCatalog)) {
    privateReference(receipt, receipt.kind);
    assert.equal(receipt.liveEligible, false, `${id}: history is never a live fixture`);
  }
  for (const observation of [...data.historicalEvidence, ...data.knownRisks]) {
    assert.ok(observation.scope || observation.fact);
    for (const id of observation.receipts) assert.ok(data.receiptCatalog[id], `Unknown receipt ${id}`);
  }
  const lock = data.observedRuntimeLock;
  assert.equal(lock.status, 'OBSERVED-IMAGE-LOCK-NOT-RELEASE');
  assert.deepEqual([lock.sharedServices, lock.imageTags, lock.imageIds], [12, 18, 18]);
  for (const name of ['liveNowClaim', 'functionalAcceptance', 'sharedReleaseAcceptance']) {
    assert.equal(lock[name], false);
  }
  assert.deepEqual(sorted(Object.keys(data.permanentNonClaims)), sorted(nonClaims));
  assert.ok(Object.values(data.permanentNonClaims).every(value => value === false),
    'Bounded bootstrap cannot claim CRUD, state invariance, Unicode migration or release');
  assert.equal(data.freshAcceptance.route.method, 'GET');
  assert.equal(data.freshAcceptance.route.pathTemplate, '/ibizmodeling/appdata?psdevslnsys=$ROOT_ID');
  assert.equal(data.freshAcceptance.route.genericIdentityPath, '/appdata');
  const originalFailure = data.attemptHistory?.find(attempt => attempt.id === 'baseline-system-r1');
  assert.equal(originalFailure?.status, 'FAILED', 'Original failure must not become a successful retry');
  assert.equal(originalFailure.runId, '2fb3e0583a53');
  assert.equal(originalFailure.preserveAfterSuccessfulRetry, true);
  privateReference(originalFailure.receipt, 'failed-owned-native-routing-http');
  assert.equal(originalFailure.receipt.sha256, '7125725f5020597372c667370e1e88d7680571827e6706aceb2ebd3f7ba2f02d');
  assert.deepEqual(data.freshAcceptance.http.requiredCoverage, expectedCoverage);
  assert.deepEqual(sorted(data.freshAcceptance.browser.requiredCells.map(cell =>
    `${cell.locale}/${cell.viewport}`)), sorted(expectedCells));
  for (const name of Object.keys(requiredFlags)) boundedScope(data, name);
  const fresh = data.freshAcceptance;
  assert.ok(['NOT-RUN', 'IN-PROGRESS', 'FAILED', 'VERIFIED-BOUNDED-BOOTSTRAP-ONLY'].includes(fresh.status));
  if (fresh.status === 'VERIFIED-BOUNDED-BOOTSTRAP-ONLY') {
    assert.equal(data.status, fresh.status);
    assert.ok(Object.keys(requiredFlags).every(name => fresh[name].status === 'VERIFIED-BOUNDED'),
      'HTTP, route, browser and cleanup are all required');
    assert.ok(Date.parse(fresh.cleanup.receipt.observedAt) >= Date.parse(fresh.browser.receipt.observedAt),
      'Cleanup cannot predate the browser evidence');
  } else {
    assert.ok(['AWAITING-FRESH-BOUNDED-VALIDATION', 'IN-PROGRESS', 'FAILED'].includes(data.status));
  }
}

function hypotheticalBoundedFixture() {
  const data = clone();
  const fresh = data.freshAcceptance;
  const runId = '012345abcdef';
  const reference = kind => ({
    path: `.artifacts/controlled-baseline-fixture/${kind}.private.json`,
    sha256: sha, kind, runId, sourceOnly: false, executed: true,
    retiredBeforeExecution: false, observedAt: '2026-11-16T01:00:00+08:00',
  });
  fresh.run = {
    runId, startedAt: date, freshlyInspectedOwnedResources: true, activeAtDispatch: true,
    retiredBeforeExecution: false, identityWitnessSha256: sha,
  };
  Object.assign(fresh.candidateBinding, {
    status: 'VERIFIED-BYTE-BOUND', executionCommits: { ...anchorCommits },
    deliveryCommits: { ...anchorCommits }, testedSourceInputsSha256: sha,
    deliveredSourceInputsSha256: sha, byteEquivalenceVerified: true,
    sourcePackageImagesBound: true, frontendServedBytesBound: true,
    currentCommitReceipt: reference('current-commit-source-byte-binding'),
    reviewedChangesFromAnchor: [],
  });
  for (const name of Object.keys(requiredFlags)) {
    fresh[name].status = 'VERIFIED-BOUNDED';
    fresh[name].flags = Object.fromEntries(requiredFlags[name].map(flag => [flag, true]));
    fresh[name].receipt = reference(requiredReceiptKinds[name]);
  }
  fresh.http.observedCoverage = { ...expectedCoverage };
  fresh.browser.observedCells = fresh.browser.requiredCells.map(cell => ({
    ...cell, status: 'PASSED-BOUNDED-BOOTSTRAP',
    consoleErrors: 0, pageErrors: 0, failedRequests: 0, blockedRequests: 0,
  }));
  fresh.status = 'VERIFIED-BOUNDED-BOOTSTRAP-ONLY';
  data.status = fresh.status;
  return data;
}

test('checkpoint pins the four source revisions and keeps canonical 25 items unchanged', () => {
  validate(baseline);
  if (baseline.freshAcceptance.status === 'NOT-RUN') {
    assert.equal(baseline.freshAcceptance.run, null);
    for (const name of Object.keys(requiredFlags)) {
      assert.equal(baseline.freshAcceptance[name].status, 'NOT-RUN');
      assert.equal(baseline.freshAcceptance[name].receipt, null);
      assert.ok(Object.values(baseline.freshAcceptance[name].flags).every(value => value === false));
    }
  }
});

test('source-route preparation is not a native pass and past campaign resources are retired', () => {
  assert.equal(baseline.preparationObservation.scheduledOwnedRunId, '2fb3e0583a53');
  assert.equal(baseline.preparationObservation.sourceResultOnly, true);
  assert.equal(baseline.preparationObservation.freshNativeHttpPassed, false);
  assert.equal(baseline.preparationObservation.freshNativeBrowserPassed, false);
  assert.ok(baseline.retiredRunIds.includes('b5dc5669e6d1'));
  const data = hypotheticalBoundedFixture();
  data.freshAcceptance.run.runId = 'b5dc5669e6d1';
  assert.throws(() => validate(data), /Retired campaign/);
});

test('schema permits a complete hypothetical bounded record without claiming any wider capability', () => {
  const before = structuredClone(baseline);
  const data = hypotheticalBoundedFixture();
  validate(data);
  assert.ok(Object.values(data.permanentNonClaims).every(value => value === false));
  assert.deepEqual(baseline, before,
    'Contract test fixture must never be persisted as native evidence');
});

test('source-only receipt or source tests cannot verify native HTTP', () => {
  const sourceOnly = hypotheticalBoundedFixture();
  sourceOnly.freshAcceptance.http.receipt.sourceOnly = true;
  assert.throws(() => validate(sourceOnly), /Source-only evidence/);
  const wrongKind = hypotheticalBoundedFixture();
  wrongKind.freshAcceptance.http.receipt.kind = 'unit-test';
  assert.throws(() => validate(wrongKind), /Unexpected receipt kind/);
  const unbound = hypotheticalBoundedFixture();
  unbound.freshAcceptance.candidateBinding.currentCommitReceipt = null;
  assert.throws(() => validate(unbound), /Missing current-commit/);
});

test('missing required flags, missing cleanup or missing dispatch cannot be green', () => {
  const missing = hypotheticalBoundedFixture();
  delete missing.freshAcceptance.http.flags.realResponsesDispatched;
  assert.throws(() => validate(missing), /required flags/);
  const falseFlag = hypotheticalBoundedFixture();
  falseFlag.freshAcceptance.http.flags.realResponsesDispatched = false;
  assert.throws(() => validate(falseFlag), /every required flag/);
  const cleanup = hypotheticalBoundedFixture();
  cleanup.freshAcceptance.cleanup.status = 'NOT-RUN';
  assert.throws(() => validate(cleanup), /cleanup are all required/);
});

test('retired receipt, wrong run, missing fresh inspection or stale receipt date is rejected', () => {
  for (const mutation of [
    data => { data.freshAcceptance.http.receipt.retiredBeforeExecution = true; },
    data => { data.freshAcceptance.http.receipt.runId = 'b5dc5669e6d1'; },
    data => { data.freshAcceptance.run.freshlyInspectedOwnedResources = false; },
    data => { data.freshAcceptance.run.activeAtDispatch = false; },
    data => { data.freshAcceptance.http.receipt.observedAt = '2026-11-14T00:00:00+08:00'; },
  ]) {
    const data = hypotheticalBoundedFixture();
    mutation(data);
    assert.throws(() => validate(data));
  }
});

test('generic appdata success, incomplete role coverage or a retired acceptance flag is insufficient', () => {
  const generic = hypotheticalBoundedFixture();
  generic.freshAcceptance.route.pathTemplate = '/appdata?psdevslnsys=$ROOT_ID';
  assert.throws(() => validate(generic));
  const coverage = hypotheticalBoundedFixture();
  coverage.freshAcceptance.http.observedCoverage.authorizedProjections = 0;
  assert.throws(() => validate(coverage));
  const retiredFlag = hypotheticalBoundedFixture();
  retiredFlag.freshAcceptance.http.flags.readonlyMetadataAcceptance = true;
  assert.throws(() => validate(retiredFlag), /required flags/);
});

test('missing/duplicate browser cells or recorded browser errors prevent bounded acceptance', () => {
  for (const mutation of [
    data => { data.freshAcceptance.browser.observedCells.pop(); },
    data => { data.freshAcceptance.browser.observedCells[1] = data.freshAcceptance.browser.observedCells[0]; },
    data => { data.freshAcceptance.browser.observedCells[0].consoleErrors = 1; },
    data => { data.freshAcceptance.browser.observedCells[0].blockedRequests = 1; },
    data => { data.freshAcceptance.browser.flags.loaderFreeStableReadiness = false; },
  ]) {
    const data = hypotheticalBoundedFixture();
    mutation(data);
    assert.throws(() => validate(data));
  }
});

test('changed commits or source bytes require reviewed upgrade comparison and current byte equivalence', () => {
  const changed = hypotheticalBoundedFixture();
  changed.freshAcceptance.candidateBinding.deliveryCommits.scripts = 'f'.repeat(40);
  assert.throws(() => validate(changed), /missing reviewed change/);
  changed.freshAcceptance.candidateBinding.reviewedChangesFromAnchor.push({
    repository: 'scripts', from: anchorCommits.scripts, to: 'f'.repeat(40), reviewed: true,
    receipt: { path: '.artifacts/controlled-baseline-fixture/delta.private.json',
      kind: 'reviewed-source-delta', sha256: sha },
  });
  validate(changed);
  changed.freshAcceptance.candidateBinding.deliveredSourceInputsSha256 = 'b'.repeat(64);
  assert.throws(() => validate(changed));
});

test('bounded bootstrap never grants full CRUD, Unicode migration, whole-state invariance or release', () => {
  for (const flag of Object.keys(baseline.permanentNonClaims)) {
    const data = hypotheticalBoundedFixture();
    data.permanentNonClaims[flag] = true;
    assert.throws(() => validate(data), /Bounded bootstrap cannot claim/);
  }
  const lock = clone();
  lock.observedRuntimeLock.functionalAcceptance = true;
  assert.throws(() => validate(lock));
});

test('private references cannot escape artifacts and historic evidence cannot become live', () => {
  const escape = hypotheticalBoundedFixture();
  escape.freshAcceptance.http.receipt.path = '.artifacts/../public/report.json';
  assert.throws(() => validate(escape));
  const live = clone();
  live.receiptCatalog['historical-context-failure'].liveEligible = true;
  assert.throws(() => validate(live), /history is never a live fixture/);
  const relabeled = hypotheticalBoundedFixture();
  relabeled.freshAcceptance.http.receipt.path = baseline.receiptCatalog['historical-context-failure'].path;
  assert.throws(() => validate(relabeled), /Historical catalog receipt|Retired run path/);
});

test('regression roster has explicit source subsets, no all-test wildcard or implicit native execution', () => {
  const ids = baseline.regressionCommands.map(command => command.id);
  assert.ok(baseline.regressionCommands.find(command => command.id === 'OWNED-BROWSER')
    .command.includes('--require-owned-model-context'));
  assert.equal(new Set(ids).size, ids.length);
  for (const entry of baseline.regressionCommands) {
    assert.ok(entry.command.startsWith('node '));
    assert.ok(!entry.command.includes('*') && !entry.command.includes('npm test'));
    const files = entry.command.split(' ').filter(argument => argument.endsWith('.mjs'));
    assert.ok(files.length);
    for (const file of files) assert.ok(existsSync(resolve(workspaceRoot, file)), `Missing ${file}`);
    if (entry.kind === 'source-only') {
      assert.ok(entry.command.includes('--test'));
      assert.ok(!entry.command.includes('--execute-owned') && !entry.command.includes('--run-readonly-browser'));
      assert.equal(entry.canPromoteFunctionalAcceptance, false);
    } else {
      assert.ok(entry.command.includes('$RUN_ID'));
      assert.ok(!entry.command.includes('b5dc5669e6d1'), 'Retired run cannot be an execution template');
    }
  }
});

test('baseline document and provenance links resolve without loading private evidence', () => {
  const document = readFileSync(documentPath, 'utf8');
  for (const path of baseline.sourceDocuments) assert.ok(existsSync(resolve(scriptsRoot, path)));
  for (const [, target] of document.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    assert.ok(!/^(?:https?:|file:|javascript:)/i.test(target));
    assert.ok(existsSync(resolve(dirname(documentPath), target.split('#')[0])), `Broken ${target}`);
  }
  for (const phrase of ['手册要求', '本地实现观察', '当前版本验收证据', '待决策/阻塞']) {
    assert.ok(document.includes(phrase), `Missing factual boundary ${phrase}`);
  }
  assert.ok(document.includes('不运行') && document.includes('25'));
});
