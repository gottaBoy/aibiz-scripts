import assert from 'node:assert/strict';
import fs from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('..', import.meta.url));
const record = JSON.parse(fs.readFileSync(resolve(root, 'records/aibiz-embedded-modeling-20261116.json')));
const documentPath = resolve(root, 'docs/EMBEDDED-MODELING-20261116.md');
const document = fs.readFileSync(documentPath, 'utf8');

test('source follow-up cannot promote a preview into shared or complete capability acceptance', () => {
  assert.equal(record.status, 'FIXED-SOURCE-NOT-DEPLOYED');
  assert.equal(record.preview.staticResourceOverridesRecorded, true);
  assert.equal(record.preview.modelAndApiResponsesSubstituted, false);
  assert.equal(record.preview.sharedUrlFixed, false);
  for (const key of ['nativeAcceptance', 'sharedDeploymentAcceptance', 'fullCapabilityAcceptance']) {
    assert.equal(record[key], false);
  }
  assert.deepEqual(record.canonicalItemsClosed, []);
  for (const commit of Object.values(record.versionBinding).filter(value => typeof value === 'string')) {
    assert.match(commit, /^[a-f0-9]{40}$/);
  }
});

test('source fixes and observed backend failures are separate, unique issue rows', () => {
  const rows = [...record.sourceFixes, ...record.openIssues];
  assert.deepEqual(rows.map(row => row.id), ['EIDE-01', 'EIDE-02', 'EIDE-03', 'EIDE-04',
    'EIDE-05', 'EIDE-06', 'EIDE-07']);
  assert.ok(record.sourceFixes.every(row => row.status === 'FIXED-SOURCE'));
  assert.equal(record.openIssues.find(row => row.id === 'EIDE-04').status, 'FAILED-LIVE');
  assert.equal(record.openIssues.find(row => row.id === 'EIDE-05').status, 'FAILED-LIVE');
  assert.equal(record.openIssues.find(row => row.id === 'EIDE-06').status, 'BLOCKED-BEFORE-DISPATCH');
  assert.equal(record.preview.entityEntryAccepted, false);
  assert.equal(record.preview.preservedPlmPreAuthConsoleErrors, 2);
});

test('focused test and preview evidence never becomes a full live E2E pass', () => {
  assert.equal(record.regression.tests, 176);
  assert.equal(record.regression.passed, record.regression.tests);
  for (const key of ['failed', 'cancelled', 'skipped', 'todo', 'e2eSyntaxDiagnostics']) {
    assert.equal(record.regression[key], 0);
  }
  assert.equal(record.regression.controlledBrowserCells, 8);
  assert.equal(record.regression.fullLiveE2eSpecExecuted, false);
  assert.equal(record.regression.sourceOnlyAcceptance, true);
  assert.ok(record.preview.footerBounds.top >= 0);
  assert.ok(record.preview.footerBounds.bottom <= record.preview.footerBounds.frameHeight);
});

test('private receipt references are bounded without loading their payloads', () => {
  assert.equal(new Set(record.receipts.map(row => row.path)).size, record.receipts.length);
  for (const row of record.receipts) {
    assert.match(row.path, /^\.artifacts\/[a-zA-Z0-9_./-]+$/);
    assert.ok(!row.path.split('/').includes('..'));
    assert.match(row.sha256, /^[a-f0-9]{64}$/);
  }
  assert.ok(record.receipts.some(row => row.kind === 'failed-readonly-entity-entry-preserved'));
});

test('resource and canonical boundaries remain explicit and document links resolve', () => {
  assert.deepEqual([record.resources.sharedServices, record.resources.retainedImageIds,
    record.resources.ownedOrHistoricalContainers, record.resources.comparedHostInputs], [12, 18, 0, 33]);
  assert.equal(record.resources.serviceRestarts, false);
  assert.equal(record.resources.volumesRemoved, false);
  assert.equal(record.resources.wholeDatabaseOrCacheInvarianceClaim, false);
  const canonical = fs.readFileSync(resolve(root, 'docs/ALL-TASKS-20261111.md'), 'utf8');
  assert.match(canonical, /^\| B04 \| PARTIAL \|.*EMBEDDED-MODELING-20261116\.md/m);
  for (const [, target] of document.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
    assert.ok(fs.existsSync(resolve(dirname(documentPath), target)));
  }
  assert.ok(document.includes('controlled source-preview evidence') &&
    document.includes('not proof that the shared URL is fixed'));
});
