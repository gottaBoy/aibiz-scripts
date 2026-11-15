import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
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
const browserErrorCounters = [
  'consoleErrors', 'pageErrors', 'failedRequests', 'blockedRequests', 'httpErrors',
  'unexpectedHttpErrors', 'unfinishedRequests', 'routingErrors', 'accountingErrors', 'allErrors',
];
const preservedFailures = {
  'baseline-system-r1': {
    kind: 'failed-owned-native-routing-http',
    path: '.artifacts/native-nonadmin-fixtures/2fb3e0583a53/model-context-http-baseline-system-r1/report.json',
    sha256: '7125725f5020597372c667370e1e88d7680571827e6706aceb2ebd3f7ba2f02d',
  },
  'browser-r1': {
    kind: 'failed-owned-native-browser-attempt',
    path: '.artifacts/modeling-baseline-campaign-20261116-r1/browser-r1-failure.private.json',
    sha256: 'c67bf16bbec38d016ca5b5b6f5d5c8635789c0527df716f778d114c320134ae2',
  },
  'browser-r2': {
    kind: 'failed-owned-native-browser-attempt',
    path: '.artifacts/owned-modeling-bootstrap-browser/modeling-baseline-20261116-r2/report.private.json',
    sha256: '490834300c437e35846e9fbc15229b62ebdd36344d72d708a1710343134051c5',
  },
  'browser-r3': {
    kind: 'failed-owned-native-browser-attempt',
    path: '.artifacts/owned-modeling-bootstrap-browser/modeling-baseline-20261116-r3/report.private.json',
    sha256: '9f2331b772fd4fb6e1cc5d45a839dc729d345f0d6ebd12561609b63a2225088e',
  },
  'browser-r4': {
    kind: 'failed-owned-native-browser-attempt',
    path: '.artifacts/owned-modeling-bootstrap-browser/modeling-baseline-20261116-r4/report.private.json',
    sha256: '66005158a44c50aa23f3ad1ec2be8704c864c4643872e14d0aade86ad46c05df',
  },
  'browser-r5': {
    kind: 'failed-owned-browser-preflight',
    path: '.artifacts/owned-modeling-bootstrap-browser/modeling-baseline-20261116-r5/report.private.json',
    sha256: '5472691e89dd170a19ed3e1c04a37523dae04223e6d5dae6ca59af7d601275bc',
  },
  'browser-r6': {
    kind: 'failed-owned-native-browser-attempt',
    path: '.artifacts/owned-modeling-bootstrap-browser/modeling-baseline-20261116-r6/report.private.json',
    sha256: '112e88b8ef9463745dca9270546d932adcd5e58a1135eb55a4046e9b93066239',
  },
};
const nonClaims = [
  'completeNativeCrud', 'fullRoleMatrix', 'allLocalesAndLayouts', 'uaaStateInvariance',
  'metadataStateInvariance', 'cacheStateInvariance', 'nativeUnicodeMigratedAndApiAccepted',
  'sharedCandidateDeployed', 'sharedReleaseAccepted', 'allCanonicalTasksComplete',
];

function privateReference(receipt, kind) {
  assert.ok(receipt && typeof receipt === 'object' && !Array.isArray(receipt), `Missing ${kind} receipt`);
  assert.equal(receipt.kind, kind, `Unexpected receipt kind for ${kind}`);
  assert.match(receipt.path ?? '', /^\.artifacts\/[A-Za-z0-9_./-]+$/);
  assert.ok(!receipt.path.split('/').some(part => part === '..' || part === '.'));
  assert.match(receipt.sha256 ?? '', /^[a-f0-9]{64}$/);
}

function commitMap(value, label) {
  assert.deepEqual(sorted(Object.keys(value ?? {})), sorted(Object.keys(anchorCommits)),
    `${label}: all four source commits are required`);
  for (const commit of Object.values(value)) assert.match(commit, /^[a-f0-9]{40}$/);
}

function inputBinding(value, label) {
  assert.match(value?.deploymentSha256 ?? '', /^[a-f0-9]{64}$/, `${label}: deployment hash required`);
  assert.match(value?.sourceInputsSha256 ?? '', /^[a-f0-9]{64}$/, `${label}: source input hash required`);
  commitMap(value?.executionCommits, `${label} execution`);
  return {
    deploymentSha256: value.deploymentSha256,
    sourceInputsSha256: value.sourceInputsSha256,
    executionCommits: value.executionCommits,
  };
}

function reviewedDelta(data, phase, commits) {
  const changes = data.freshAcceptance.candidateBinding.reviewedChangesFromAnchor;
  assert.ok(Array.isArray(changes), 'Reviewed source deltas are required');
  for (const key of Object.keys(anchorCommits)) {
    if (commits[key] === data.sourceAnchor[key].commit) continue;
    const matches = changes.filter(change => change.repository === key && change.phase === phase);
    assert.equal(matches.length, 1, `${key}/${phase}: missing reviewed change from the anchor`);
    const [delta] = matches;
    assert.equal(delta.from, data.sourceAnchor[key].commit);
    assert.equal(delta.to, commits[key], `${key}/${phase}: reviewed delta must cover the actual commit`);
    assert.equal(delta.reviewed, true);
    privateReference(delta.receipt, 'reviewed-source-delta');
  }
}

function currentBinding(data) {
  const value = data.freshAcceptance.candidateBinding;
  const run = currentRun(data);
  assert.equal(value.status, 'VERIFIED-BYTE-BOUND', 'Current commit/byte binding required');
  assert.equal(value.byteEquivalenceVerified, true);
  assert.equal(value.sourcePackageImagesBound, true);
  assert.equal(value.frontendServedBytesBound, true);
  assert.match(value.testedSourceInputsSha256 ?? '', /^[a-f0-9]{64}$/);
  assert.equal(value.deliveredSourceInputsSha256, value.testedSourceInputsSha256);
  assert.match(value.deploymentSha256 ?? '', /^[a-f0-9]{64}$/);
  commitMap(value.executionCommits, 'Candidate execution');
  commitMap(value.deliveryCommits, 'Candidate delivery');
  privateReference(value.currentCommitReceipt, 'current-commit-source-byte-binding');
  const receipt = value.currentCommitReceipt;
  assert.equal(receipt.runId, run.runId, 'Current source binding must name the current run');
  assert.equal(receipt.identityWitnessSha256, run.identityWitnessSha256);
  assert.deepEqual(inputBinding(receipt, 'Current source receipt'), {
    deploymentSha256: value.deploymentSha256,
    sourceInputsSha256: value.testedSourceInputsSha256,
    executionCommits: value.executionCommits,
  }, 'Current source receipt must bind the tested candidate');
  assert.deepEqual(receipt.deliveryCommits, value.deliveryCommits,
    'Current source receipt must bind the delivered source, not metadata sealing HEAD');
  reviewedDelta(data, 'execution', value.executionCommits);
  reviewedDelta(data, 'delivery', value.deliveryCommits);
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

function scopeInputBinding(data, scope, name, run) {
  const candidate = data.freshAcceptance.candidateBinding;
  const actual = inputBinding(scope.receipt, `${name} receipt`);
  const expected = {
    deploymentSha256: candidate.deploymentSha256,
    sourceInputsSha256: candidate.testedSourceInputsSha256,
    executionCommits: candidate.executionCommits,
  };
  assert.equal(scope.receipt.identityWitnessSha256, run.identityWitnessSha256,
    `${name}: receipt must bind the owned resource witness`);
  if (isDeepStrictEqual(actual, expected)) {
    assert.ok(!scope.runtimeEquivalenceReceipt,
      `${name}: redundant runtime equivalence cannot replace a direct input binding`);
    return;
  }
  assert.ok(['route', 'http'].includes(name),
    `${name}: current browser/cleanup inputs cannot be replaced with an earlier candidate`);
  const equivalence = scope.runtimeEquivalenceReceipt;
  privateReference(equivalence, 'owned-runtime-input-equivalence');
  assert.equal(equivalence.scope, name);
  assert.equal(equivalence.runId, run.runId);
  assert.equal(equivalence.identityWitnessSha256, run.identityWitnessSha256);
  assert.equal(equivalence.verified, true, `${name}: runtime equivalence must be explicitly verified`);
  assert.deepEqual(inputBinding(equivalence.from, `${name} equivalence from`), actual);
  assert.deepEqual(inputBinding(equivalence.to, `${name} equivalence to`), expected);
  assert.match(equivalence.fromRuntimeInputsSha256 ?? '', /^[a-f0-9]{64}$/);
  assert.equal(equivalence.toRuntimeInputsSha256, equivalence.fromRuntimeInputsSha256,
    `${name}: early execution needs identical scope runtime inputs`);
  assert.ok(Number.isFinite(Date.parse(equivalence.observedAt)));
  assert.ok(Date.parse(equivalence.observedAt) >= Date.parse(scope.receipt.observedAt),
    `${name}: equivalence cannot predate the execution it binds`);
}

function failureHistory(data) {
  assert.ok(Array.isArray(data.attemptHistory), 'Failure attempt history is required');
  for (const key of ['id', 'path', 'sha256']) {
    const values = data.attemptHistory.map(attempt => key === 'id' ? attempt.id : attempt.receipt?.[key]);
    assert.equal(new Set(values).size, values.length, `Duplicate failure ${key} is not an independent attempt`);
  }
  for (const attempt of data.attemptHistory) {
    assert.match(attempt.id ?? '', /^[a-z][a-z0-9-]{0,95}$/);
    assert.equal(attempt.status, 'FAILED', 'Failed attempts must remain failed after retry');
    assert.match(attempt.runId ?? '', /^[a-f0-9]{12}$/);
    assert.match(attempt.deploymentSha256 ?? '', /^[a-f0-9]{64}$/);
    assert.ok(Number.isFinite(Date.parse(attempt.observedAt)));
    assert.ok(typeof attempt.classification === 'string' && attempt.classification.trim().length > 0);
    assert.equal(attempt.preserveAfterSuccessfulRetry, true, `${attempt.id}: failures must be preserved`);
    assert.match(attempt.receipt?.kind ?? '', /^failed-owned-[a-z0-9-]+$/);
    privateReference(attempt.receipt, attempt.receipt.kind);
  }
  for (const [id, receipt] of Object.entries(preservedFailures)) {
    const attempt = data.attemptHistory.find(value => value.id === id);
    assert.ok(attempt, `${id}: original failure must be preserved`);
    assert.equal(attempt.runId, '2fb3e0583a53');
    assert.equal(attempt.deploymentSha256, '3ed71303c375d19b18be6a51bf572b9900203b1e0722c49d8fac27991d3be69e');
    for (const [key, value] of Object.entries(receipt)) {
      assert.equal(attempt.receipt[key], value, `${id}: original failure ${key} is immutable`);
    }
  }
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
  scopeInputBinding(data, scope, name, run);
  if (name === 'http') {
    assert.deepEqual(scope.observedCoverage, expectedCoverage);
    assert.equal(Object.hasOwn(scope.flags, 'readonlyMetadataAcceptance'), false,
      'Retired response flags cannot stand in for the current routing contract');
  }
  if (name === 'browser') {
    assert.equal(scope.rawFinalVerdict, 'OBSERVED-APPINDEX-BOOTSTRAP-NOT-FULL-ACCEPTANCE',
      'The unmodified final browser verdict must pass its bounded raw gate');
    const cells = scope.observedCells.map(cell => `${cell.locale}/${cell.viewport}`);
    assert.equal(new Set(cells).size, 4, 'Duplicate browser cells cannot replace missing cells');
    assert.deepEqual(sorted(cells), sorted(expectedCells));
    for (const cell of scope.observedCells) {
      assert.equal(cell.status, 'PASSED-BOUNDED-BOOTSTRAP');
      assert.equal(cell.rawFinalVerdict, 'BOOTSTRAP-APPINDEX-ONLY-OBSERVED-NOT-NATIVE-ACCEPTED',
        'Every cell must retain its raw APPINDEX-only verdict');
      for (const counter of browserErrorCounters) {
        assert.equal(cell[counter], 0, `${counter}: errors must be explained before bootstrap can pass`);
      }
      assert.ok(Number.isSafeInteger(cell.expectedPreAuthDenials) && cell.expectedPreAuthDenials >= 0,
        'Expected pre-auth denials need an explicit independent count');
      assert.equal(cell.rawHttpErrorResponses, cell.expectedPreAuthDenials + cell.unexpectedHttpErrors,
        'Raw HTTP errors cannot be discarded when expected pre-auth denials are classified');
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
  failureHistory(data);
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
    identityWitnessSha256: sha, deploymentSha256: sha, sourceInputsSha256: sha,
    executionCommits: { ...anchorCommits },
  });
  fresh.run = {
    runId, startedAt: date, freshlyInspectedOwnedResources: true, activeAtDispatch: true,
    retiredBeforeExecution: false, identityWitnessSha256: sha,
  };
  Object.assign(fresh.candidateBinding, {
    status: 'VERIFIED-BYTE-BOUND', executionCommits: { ...anchorCommits },
    deliveryCommits: { ...anchorCommits }, testedSourceInputsSha256: sha,
    deliveredSourceInputsSha256: sha, deploymentSha256: sha, byteEquivalenceVerified: true,
    sourcePackageImagesBound: true, frontendServedBytesBound: true,
    currentCommitReceipt: reference('current-commit-source-byte-binding'),
    reviewedChangesFromAnchor: [],
  });
  fresh.candidateBinding.currentCommitReceipt.deliveryCommits = { ...anchorCommits };
  for (const name of Object.keys(requiredFlags)) {
    fresh[name].status = 'VERIFIED-BOUNDED';
    fresh[name].flags = Object.fromEntries(requiredFlags[name].map(flag => [flag, true]));
    fresh[name].receipt = reference(requiredReceiptKinds[name]);
    delete fresh[name].runtimeEquivalenceReceipt;
  }
  fresh.http.observedCoverage = { ...expectedCoverage };
  fresh.browser.rawFinalVerdict = 'OBSERVED-APPINDEX-BOOTSTRAP-NOT-FULL-ACCEPTANCE';
  fresh.browser.observedCells = fresh.browser.requiredCells.map(cell => ({
    ...cell, status: 'PASSED-BOUNDED-BOOTSTRAP',
    rawFinalVerdict: 'BOOTSTRAP-APPINDEX-ONLY-OBSERVED-NOT-NATIVE-ACCEPTED',
    ...Object.fromEntries(browserErrorCounters.map(counter => [counter, 0])),
    expectedPreAuthDenials: 0, rawHttpErrorResponses: 0,
  }));
  fresh.status = 'VERIFIED-BOUNDED-BOOTSTRAP-ONLY';
  data.status = fresh.status;
  return data;
}

function hypotheticalEarlyHttpFixture() {
  const data = hypotheticalBoundedFixture();
  const fresh = data.freshAcceptance;
  const scope = fresh.http;
  scope.receipt.sourceInputsSha256 = 'b'.repeat(64);
  scope.receipt.deploymentSha256 = 'c'.repeat(64);
  scope.receipt.executionCommits.scripts = 'd'.repeat(40);
  scope.runtimeEquivalenceReceipt = {
    kind: 'owned-runtime-input-equivalence',
    path: '.artifacts/controlled-baseline-fixture/http-equivalence.private.json',
    sha256: sha, scope: 'http', runId: fresh.run.runId,
    identityWitnessSha256: fresh.run.identityWitnessSha256,
    observedAt: '2026-11-16T02:00:00+08:00', verified: true,
    from: inputBinding(scope.receipt, 'Controlled early HTTP'),
    to: {
      deploymentSha256: fresh.candidateBinding.deploymentSha256,
      sourceInputsSha256: fresh.candidateBinding.testedSourceInputsSha256,
      executionCommits: { ...fresh.candidateBinding.executionCommits },
    },
    fromRuntimeInputsSha256: 'e'.repeat(64),
    toRuntimeInputsSha256: 'e'.repeat(64),
  };
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

test('raw browser verdict and every error category are required, not only four zero counters', () => {
  for (const counter of browserErrorCounters) {
    for (const mutate of [
      cell => { cell[counter] = 1; },
      cell => { delete cell[counter]; },
    ]) {
      const data = hypotheticalBoundedFixture();
      mutate(data.freshAcceptance.browser.observedCells[0]);
      assert.throws(() => validate(data), new RegExp(counter));
    }
  }
  for (const mutate of [
    browser => { browser.rawFinalVerdict = 'FAILED-LIVE-BROWSER-REMAINING-BLOCKERS'; },
    browser => { delete browser.rawFinalVerdict; },
    browser => { browser.observedCells[0].rawFinalVerdict = 'FAILED'; },
  ]) {
    const data = hypotheticalBoundedFixture();
    mutate(data.freshAcceptance.browser);
    assert.throws(() => validate(data), /raw/);
  }
});

test('expected pre-auth denials remain separately counted without hiding raw HTTP errors', () => {
  const data = hypotheticalBoundedFixture();
  const cell = data.freshAcceptance.browser.observedCells[0];
  cell.expectedPreAuthDenials = 2;
  cell.rawHttpErrorResponses = 2;
  validate(data);
  for (const mutate of [
    value => { delete value.expectedPreAuthDenials; },
    value => { value.expectedPreAuthDenials = -1; },
    value => { value.expectedPreAuthDenials = 0.5; },
    value => { value.rawHttpErrorResponses = 0; },
    value => { delete value.rawHttpErrorResponses; },
  ]) {
    const invalid = structuredClone(data);
    mutate(invalid.freshAcceptance.browser.observedCells[0]);
    assert.throws(() => validate(invalid));
  }
});

test('current source receipt and each scope are bound to the same candidate and owned witness', () => {
  for (const mutate of [
    value => { value.currentCommitReceipt.runId = 'fedcba654321'; },
    value => { value.currentCommitReceipt.identityWitnessSha256 = 'b'.repeat(64); },
    value => { value.currentCommitReceipt.deploymentSha256 = 'b'.repeat(64); },
    value => { value.currentCommitReceipt.sourceInputsSha256 = 'b'.repeat(64); },
    value => { value.currentCommitReceipt.executionCommits.hub = 'b'.repeat(40); },
  ]) {
    const data = hypotheticalBoundedFixture();
    mutate(data.freshAcceptance.candidateBinding);
    assert.throws(() => validate(data));
  }
  for (const name of Object.keys(requiredFlags)) {
    for (const mutate of [
      receipt => { delete receipt.deploymentSha256; },
      receipt => { delete receipt.sourceInputsSha256; },
      receipt => { delete receipt.executionCommits; },
      receipt => { receipt.identityWitnessSha256 = 'b'.repeat(64); },
      receipt => { receipt.sourceInputsSha256 = 'b'.repeat(64); },
    ]) {
      const data = hypotheticalBoundedFixture();
      mutate(data.freshAcceptance[name].receipt);
      assert.throws(() => validate(data));
    }
  }
});

test('early HTTP requires an explicit same-runtime bridge to the final candidate', () => {
  validate(hypotheticalEarlyHttpFixture());
  for (const mutate of [
    scope => { delete scope.runtimeEquivalenceReceipt; },
    scope => { scope.runtimeEquivalenceReceipt.scope = 'route'; },
    scope => { scope.runtimeEquivalenceReceipt.runId = 'fedcba654321'; },
    scope => { scope.runtimeEquivalenceReceipt.identityWitnessSha256 = 'b'.repeat(64); },
    scope => { scope.runtimeEquivalenceReceipt.verified = false; },
    scope => { scope.runtimeEquivalenceReceipt.from.sourceInputsSha256 = sha; },
    scope => { scope.runtimeEquivalenceReceipt.to.executionCommits.hub = 'b'.repeat(40); },
    scope => { scope.runtimeEquivalenceReceipt.toRuntimeInputsSha256 = 'f'.repeat(64); },
    scope => { scope.runtimeEquivalenceReceipt.observedAt = date; },
  ]) {
    const data = hypotheticalEarlyHttpFixture();
    mutate(data.freshAcceptance.http);
    assert.throws(() => validate(data));
  }
  const browser = hypotheticalEarlyHttpFixture();
  browser.freshAcceptance.browser.receipt.deploymentSha256 = 'c'.repeat(64);
  browser.freshAcceptance.browser.runtimeEquivalenceReceipt =
    structuredClone(browser.freshAcceptance.http.runtimeEquivalenceReceipt);
  assert.throws(() => validate(browser), /current browser\/cleanup inputs/);
});

test('changed commits or source bytes require reviewed upgrade comparison and current byte equivalence', () => {
  const changed = hypotheticalBoundedFixture();
  changed.freshAcceptance.candidateBinding.deliveryCommits.scripts = 'f'.repeat(40);
  changed.freshAcceptance.candidateBinding.currentCommitReceipt.deliveryCommits.scripts = 'f'.repeat(40);
  assert.throws(() => validate(changed), /missing reviewed change/);
  changed.freshAcceptance.candidateBinding.reviewedChangesFromAnchor.push({
    repository: 'scripts', phase: 'delivery',
    from: anchorCommits.scripts, to: 'f'.repeat(40), reviewed: true,
    receipt: { path: '.artifacts/controlled-baseline-fixture/delta.private.json',
      kind: 'reviewed-source-delta', sha256: sha },
  });
  validate(changed);
  changed.freshAcceptance.candidateBinding.deliveredSourceInputsSha256 = 'b'.repeat(64);
  assert.throws(() => validate(changed));
});

test('reviewed delivery changes cannot stand in for execution commit review', () => {
  const data = hypotheticalBoundedFixture();
  const binding = data.freshAcceptance.candidateBinding;
  binding.executionCommits.scripts = 'e'.repeat(40);
  binding.deliveryCommits.scripts = 'f'.repeat(40);
  binding.currentCommitReceipt.executionCommits.scripts = 'e'.repeat(40);
  binding.currentCommitReceipt.deliveryCommits.scripts = 'f'.repeat(40);
  for (const name of Object.keys(requiredFlags)) {
    data.freshAcceptance[name].receipt.executionCommits.scripts = 'e'.repeat(40);
  }
  const delta = phase => ({
    repository: 'scripts', phase, from: anchorCommits.scripts, to: 'f'.repeat(40),
    reviewed: true, receipt: {
      path: `.artifacts/controlled-baseline-fixture/${phase}-delta.private.json`,
      kind: 'reviewed-source-delta', sha256: sha,
    },
  });
  binding.reviewedChangesFromAnchor.push(delta('delivery'));
  assert.throws(() => validate(data), /scripts\/execution: missing reviewed change/);
  binding.reviewedChangesFromAnchor.push(delta('execution'));
  assert.throws(() => validate(data), /execution: reviewed delta must cover the actual commit/);
  binding.reviewedChangesFromAnchor[1].to = 'e'.repeat(40);
  validate(data);
  binding.reviewedChangesFromAnchor.push(structuredClone(binding.reviewedChangesFromAnchor[1]));
  assert.throws(() => validate(data), /scripts\/execution: missing reviewed change/);
});

test('all original HTTP and browser failure receipts survive successful retries unchanged', () => {
  for (const id of Object.keys(preservedFailures)) {
    for (const mutate of [
      history => history.filter(attempt => attempt.id !== id),
      history => {
        history.find(attempt => attempt.id === id).receipt.sha256 = 'f'.repeat(64);
        return history;
      },
      history => {
        history.find(attempt => attempt.id === id).status = 'VERIFIED-BOUNDED';
        return history;
      },
      history => {
        history.find(attempt => attempt.id === id).preserveAfterSuccessfulRetry = false;
        return history;
      },
    ]) {
      const data = hypotheticalBoundedFixture();
      data.attemptHistory = mutate(data.attemptHistory);
      assert.throws(() => validate(data));
    }
  }
});

test('failure history rejects duplicate attempts and missing receipt or classification evidence', () => {
  for (const mutate of [
    attempt => { attempt.id = 'new-browser-failure'; },
    attempt => { attempt.receipt.path = '.artifacts/controlled-baseline-fixture/new-failure.private.json'; },
    attempt => { attempt.receipt.sha256 = 'f'.repeat(64); },
  ]) {
    const data = hypotheticalBoundedFixture();
    const duplicate = structuredClone(data.attemptHistory[0]);
    mutate(duplicate);
    data.attemptHistory.push(duplicate);
    assert.throws(() => validate(data), /Duplicate failure/);
  }
  for (const mutate of [
    attempt => { delete attempt.receipt; },
    attempt => { attempt.receipt.kind = 'source-test'; },
    attempt => { attempt.classification = ''; },
    attempt => { attempt.observedAt = 'not-a-date'; },
    attempt => { attempt.deploymentSha256 = ''; },
  ]) {
    const data = hypotheticalBoundedFixture();
    mutate(data.attemptHistory[0]);
    assert.throws(() => validate(data));
  }
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
