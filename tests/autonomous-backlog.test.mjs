import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const scriptsRoot = fileURLToPath(new URL('..', import.meta.url));
const ledgerPath = resolve(scriptsRoot, 'records/aibiz-execution-backlog-20261115.json');
const planPath = resolve(scriptsRoot, 'docs/AUTONOMOUS-EXECUTION-20261115.md');
const canonicalPath = resolve(scriptsRoot, 'docs/ALL-TASKS-20261111.md');
const ledger = JSON.parse(readFileSync(ledgerPath, 'utf8'));
const plan = readFileSync(planPath, 'utf8');
const canonical = readFileSync(canonicalPath, 'utf8');
const canonicalRows = [...canonical.split('## Agent Receipts')[0].matchAll(
  /^\| ([A-Z]\d{2}) \| (VERIFIED|PARTIAL|ACTIVE|BLOCKED|OPEN) \|/gm,
)].map(([, id, status]) => ({ id, status }));
const outstandingRows = canonicalRows.filter(row => row.status !== 'VERIFIED');
const baselineRows = canonicalRows.filter(row => row.status === 'VERIFIED');
const sorted = values => [...values].sort();
const itemIds = new Set(outstandingRows.map(row => row.id));
const clone = () => structuredClone(ledger);

function checkUnique(values, message) {
  assert.equal(new Set(values).size, values.length, message);
}

function checkAcceptance(item, data) {
  if (item.status !== 'VERIFIED') return;
  const acceptance = item.acceptance;
  assert.ok(acceptance, `${item.id}: VERIFIED requires acceptance evidence`);
  assert.equal(acceptance.currentVersion, true, `${item.id}: current version binding required`);
  assert.equal(acceptance.cleanupComplete, true, `${item.id}: cleanup evidence required`);
  assert.ok(typeof acceptance.binding === 'string' && acceptance.binding.trim(),
    `${item.id}: source/model/build/runtime binding required`);
  assert.ok(Array.isArray(acceptance.receipts) && acceptance.receipts.length,
    `${item.id}: passing receipts required`);
  for (const requiredKind of data.requiredEvidenceKinds[item.id]) {
    const evidence = acceptance.receipts.find(receipt =>
      receipt.kind === requiredKind
      && receipt.pass === true
      && receipt.currentVersion === true
      && typeof receipt.reference === 'string'
      && receipt.reference.trim());
    assert.ok(evidence, `${item.id}: missing ${requiredKind} evidence`);
  }
  assert.ok(item.subTasks.every(task => task.status === 'verified'),
    `${item.id}: unfinished subtasks prevent acceptance`);
  for (const workstream of data.crossCuttingWorkstreams.filter(row => row.items.includes(item.id))) {
    assert.equal(workstream.status, 'verified',
      `${item.id}: cross-cutting ${workstream.id} is not accepted`);
    assert.ok(workstream.evidence?.currentVersion === true
      && workstream.evidence?.pass === true
      && workstream.evidence?.cleanupComplete === true
      && typeof workstream.evidence?.reference === 'string'
      && workstream.evidence.reference.trim(),
    `${workstream.id}: current passing evidence with cleanup is required`);
  }
  for (const group of data.manualCoverage.filter(row => row.items.includes(item.id))) {
    assert.equal(group.status, 'verified',
      `${item.id}: manual group ${group.id} is not accepted`);
    assert.ok(group.evidence?.currentVersion === true
      && group.evidence?.pass === true
      && group.evidence?.cleanupComplete === true
      && typeof group.evidence?.reference === 'string'
      && group.evidence.reference.trim(),
    `${group.id}: current passing evidence with cleanup is required`);
  }
}

function checkGraph(data) {
  const nodes = new Map();
  for (const item of data.items) {
    nodes.set(item.id, [...item.dependencies, ...item.subTasks.map(task => task.id)]);
    for (const task of item.subTasks) nodes.set(task.id, task.dependsOn);
  }
  const visiting = new Set();
  const visited = new Set();
  const visit = (id, path = []) => {
    assert.ok(nodes.has(id), `Unresolved dependency ${id}`);
    assert.ok(!visiting.has(id), `Dependency cycle: ${[...path, id].join(' -> ')}`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of nodes.get(id)) visit(dependency, [...path, id]);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of nodes.keys()) visit(id);
}

function validate(data, { compareCanonicalStatus = true } = {}) {
  assert.equal(data.schemaVersion, 1);
  assert.equal(data.checkpointDate, '2026-11-15');
  assert.equal(data.timezone, 'Asia/Singapore');
  assert.equal(data.scope.topLevelOutstandingCount, 25);
  assert.equal(data.items.length, 25);
  assert.deepEqual(sorted(data.items.map(item => item.id)), sorted([...itemIds]));
  assert.deepEqual(sorted(data.scope.topLevelOutstandingIds), sorted([...itemIds]));
  assert.deepEqual(sorted(Object.keys(data.requiredEvidenceKinds)), sorted([...itemIds]));
  checkUnique(data.items.map(item => item.id), 'Duplicate top-level item');
  checkUnique(data.scope.topLevelOutstandingIds, 'Duplicate scoped item');
  const allSubtasks = data.items.flatMap(item => item.subTasks.map(task => task.id));
  checkUnique(allSubtasks, 'Duplicate subtask');
  assert.ok(allSubtasks.every(id => !itemIds.has(id)), 'Subtask collides with a top-level item');

  for (const item of data.items) {
    const canonicalRow = outstandingRows.find(row => row.id === item.id);
    if (compareCanonicalStatus) {
      assert.equal(item.status, canonicalRow.status, `${item.id}: canonical status changed`);
    }
    assert.ok(Object.hasOwn(data.executionClasses, item.executionClass),
      `${item.id}: unknown execution class`);
    for (const key of ['owner', 'objective', 'cleanup']) {
      assert.ok(typeof item[key] === 'string' && item[key].trim(), `${item.id}: missing ${key}`);
    }
    for (const key of ['roles', 'locales', 'viewports', 'acceptanceGates']) {
      assert.ok(Array.isArray(item[key]) && item[key].length, `${item.id}: missing ${key}`);
      checkUnique(item[key], `${item.id}: duplicate ${key}`);
    }
    assert.deepEqual(sorted(item.locales), ['en', 'zh-CN'], `${item.id}: bilingual scope required`);
    assert.ok(Array.isArray(item.externalInputs), `${item.id}: external input declaration required`);
    if (item.executionClass !== 'auto') {
      assert.ok(item.externalInputs.length, `${item.id}: name required external inputs`);
    }
    assert.ok(item.subTasks.length >= 3, `${item.id}: executable steps required`);
    for (const task of item.subTasks) {
      assert.match(task.id, new RegExp(`^${item.id}-S\\d{2}$`));
      assert.ok(typeof task.action === 'string' && task.action.trim(), `${task.id}: missing action`);
      assert.ok(Array.isArray(task.dependsOn), `${task.id}: dependencies required`);
      assert.ok(['todo', 'active', 'blocked', 'verified'].includes(task.status),
        `${task.id}: unknown status`);
      if (task.status === 'verified') {
        assert.ok(task.evidence?.currentVersion === true && task.evidence?.pass === true
          && typeof task.evidence?.reference === 'string' && task.evidence.reference.trim(),
        `${task.id}: verified step requires current passing evidence`);
      }
    }
    assert.ok(data.requiredEvidenceKinds[item.id].length,
      `${item.id}: no substantive evidence requirement`);
    assert.ok(!data.requiredEvidenceKinds[item.id].some(kind =>
      ['unit', 'unit-test', 'source', 'source-test'].includes(kind)),
    `${item.id}: source-only requirement cannot close top-level acceptance`);
    checkAcceptance(item, data);
  }
  checkGraph(data);
}

test('ledger has exactly the canonical 25 outstanding rows and unchanged states', () => {
  assert.equal(canonicalRows.length, 30);
  assert.equal(outstandingRows.length, 25);
  validate(ledger);
});

test('F01-F05 remain separate verified regression baselines, not outstanding work', () => {
  const expected = ['F01', 'F02', 'F03', 'F04', 'F05'];
  assert.deepEqual(sorted(baselineRows.map(row => row.id)), expected);
  assert.deepEqual(sorted(ledger.scope.regressionBaselineIds), expected);
  assert.deepEqual(sorted(ledger.regressionBaselines.map(item => item.id)), expected);
  for (const item of ledger.regressionBaselines) {
    assert.equal(item.status, 'VERIFIED');
    assert.equal(item.mustRemainPassing, true);
    assert.ok(!itemIds.has(item.id));
  }
});

test('every subtask ID is unique and item/subtask dependencies resolve without cycles', () => {
  checkGraph(ledger);
  const changed = clone();
  changed.items[0].subTasks[0].dependsOn = ['MISSING-S01'];
  assert.throws(() => checkGraph(changed), /Unresolved dependency/);
  const cyclic = clone();
  cyclic.items[0].subTasks[0].dependsOn = [cyclic.items[0].id];
  assert.throws(() => checkGraph(cyclic), /Dependency cycle/);
});

test('duplicate top-level or subtask IDs fail the ledger contract', () => {
  const duplicateItem = clone();
  duplicateItem.items[1].id = duplicateItem.items[0].id;
  assert.throws(() => validate(duplicateItem));
  const duplicateSubtask = clone();
  duplicateSubtask.items[1].subTasks[0].id = duplicateSubtask.items[0].subTasks[0].id;
  assert.throws(() => validate(duplicateSubtask), /Duplicate subtask/);
});

test('a top-level runtime item cannot be marked VERIFIED by source/unit tests', () => {
  const changed = clone();
  const item = changed.items.find(entry => entry.id === 'M03');
  item.status = 'VERIFIED';
  item.acceptance = {
    currentVersion: true,
    cleanupComplete: true,
    binding: 'controlled-source-only-fixture',
    receipts: [{ kind: 'unit-test', pass: true, currentVersion: true, reference: 'private-test' }],
  };
  assert.throws(() => validate(changed, { compareCanonicalStatus: false }),
    /missing runtime-http evidence/);
});

test('even substantive current evidence cannot close an item without cleanup', () => {
  const changed = clone();
  const item = changed.items.find(entry => entry.id === 'A01');
  item.status = 'VERIFIED';
  item.acceptance = {
    currentVersion: true,
    cleanupComplete: false,
    binding: 'controlled-fixture',
    receipts: [{ kind: 'runtime-http', pass: true, currentVersion: true, reference: 'private-test' }],
  };
  assert.throws(() => validate(changed, { compareCanonicalStatus: false }),
    /cleanup evidence required/);
});

test('historical or failed receipts cannot close current-version acceptance', () => {
  for (const receipt of [
    { kind: 'runtime-http', pass: false, currentVersion: true, reference: 'private-test' },
    { kind: 'runtime-http', pass: true, currentVersion: false, reference: 'private-test' },
  ]) {
    const changed = clone();
    const item = changed.items.find(entry => entry.id === 'A01');
    item.status = 'VERIFIED';
    item.acceptance = {
      currentVersion: true,
      cleanupComplete: true,
      binding: 'controlled-fixture',
      receipts: [receipt],
    };
    assert.throws(() => validate(changed, { compareCanonicalStatus: false }),
      /missing runtime-http evidence/);
  }
});

test('subtask completion also requires explicit current passing evidence', () => {
  const changed = clone();
  changed.items[0].subTasks[0].status = 'verified';
  assert.throws(() => validate(changed), /verified step requires current passing evidence/);
});

test('runtime receipts alone cannot bypass unfinished subtasks or cross-cutting/manual gates', () => {
  const changed = clone();
  const item = changed.items.find(entry => entry.id === 'B01');
  item.status = 'VERIFIED';
  item.acceptance = {
    currentVersion: true,
    cleanupComplete: true,
    binding: 'controlled-fixture',
    receipts: changed.requiredEvidenceKinds.B01.map(kind =>
      ({ kind, pass: true, currentVersion: true, reference: 'private-test' })),
  };
  assert.throws(() => validate(changed, { compareCanonicalStatus: false }),
    /unfinished subtasks/);
  for (const task of item.subTasks) {
    task.status = 'verified';
    task.evidence = { currentVersion: true, pass: true, reference: 'private-step-test' };
  }
  assert.throws(() => validate(changed, { compareCanonicalStatus: false }),
    /cross-cutting X-UNICODE is not accepted/);
  for (const workstream of changed.crossCuttingWorkstreams.filter(row => row.items.includes('B01'))) {
    workstream.status = 'verified';
    workstream.evidence = {
      currentVersion: true, pass: true, cleanupComplete: true, reference: 'private-workstream-test',
    };
  }
  assert.throws(() => validate(changed, { compareCanonicalStatus: false }),
    /manual group MV01 is not accepted/);
});

test('manual MV01-MV15 and runtime R01-R10 are mapped without creating top-level rows', () => {
  const expectedManual = Array.from({ length: 15 }, (_, index) =>
    `MV${String(index + 1).padStart(2, '0')}`);
  assert.deepEqual(sorted(ledger.manualCoverage.map(row => row.id)), expectedManual);
  checkUnique(ledger.manualCoverage.map(row => row.id), 'Duplicate manual group');
  checkUnique(ledger.crossCuttingWorkstreams.map(row => row.id), 'Duplicate cross-cutting workstream');
  for (const row of [...ledger.manualCoverage, ...ledger.crossCuttingWorkstreams,
    ...ledger.manualSpecificationGaps]) {
    assert.ok(row.items.length);
    for (const id of row.items) assert.ok(itemIds.has(id), `Unknown mapped item ${id}`);
  }
  for (const row of [...ledger.manualCoverage, ...ledger.crossCuttingWorkstreams]) {
    assert.ok(['todo', 'active', 'blocked', 'verified'].includes(row.status),
      `${row.id}: explicit progress status required`);
  }
  const blockers = new Set(ledger.crossCuttingWorkstreams.flatMap(row => row.blockers));
  const expectedBlockers = Array.from({ length: 10 }, (_, index) =>
    `R${String(index + 1).padStart(2, '0')}`);
  assert.deepEqual(sorted(blockers), expectedBlockers);
});

test('external conditions are named while local OAuth remains independently executable', () => {
  assert.equal(ledger.items.find(row => row.id === 'A04').executionClass, 'auto');
  const release = ledger.items.find(row => row.id === 'O03');
  assert.equal(release.executionClass, 'production-window-required');
  assert.ok(release.externalInputs.some(input => /approval/i.test(input)));
  for (const id of ['X-INTEGRATIONS', 'X-MQTT', 'X-METRIC-POLICY']) {
    const row = ledger.crossCuttingWorkstreams.find(entry => entry.id === id);
    assert.equal(row.executionClass, 'external-input-required');
    assert.ok(row.externalInputs.length);
  }
  assert.ok(ledger.requiredEvidenceKinds.B04.includes('external-broker'));
});

test('priority phases cover each outstanding item exactly once and keep F01-F05 out', () => {
  const phased = ledger.phases.flatMap(phase => phase.items);
  checkUnique(phased, 'Top-level item repeated in phases');
  assert.deepEqual(sorted(phased), sorted([...itemIds]));
  assert.ok(ledger.schedulingRules.some(rule => /priority waves/.test(rule)));
  assert.ok(ledger.schedulingRules.some(rule => /one owned runtime/.test(rule)));
});

test('source-of-truth paths and plan links resolve locally', () => {
  for (const relativePath of ledger.sourceOfTruth) {
    assert.ok(existsSync(resolve(scriptsRoot, relativePath)), `Missing source ${relativePath}`);
  }
  const targets = [...plan.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)].map(([, target]) => target);
  assert.ok(targets.length >= 8);
  for (const target of targets) {
    assert.ok(!/^(?:https?:|file:|javascript:)/i.test(target),
      `Plan references should be local: ${target}`);
    const [path] = target.split('#');
    assert.ok(existsSync(resolve(dirname(planPath), path)), `Broken plan link ${target}`);
  }
  for (const { id } of ledger.items) {
    assert.match(plan, new RegExp(`^\\| ${id} \\|`, 'm'), `Plan omits ${id}`);
  }
});

test('the plan explicitly separates manual requirements, implementation, evidence and blockers', () => {
  for (const phrase of ['手册要求', '本地实现观察', '当前版本验收证据', '待决策/阻塞']) {
    assert.ok(plan.includes(phrase), `Missing factual boundary ${phrase}`);
  }
  assert.equal(ledger.evidencePolicy.unitOrSourceTestsAloneCannotClose, true);
  assert.ok(ledger.evidencePolicy.notAcceptance.includes('old receipt or retired fixture'));
  assert.ok(ledger.evidencePolicy.notAcceptance.includes('filtering errors from the report'));
});
