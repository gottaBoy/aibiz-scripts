import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workspace = new URL('../../', import.meta.url);
const read = path => readFileSync(new URL(path, workspace), 'utf8');
const json = path => JSON.parse(read(path));
const base = 'plm/model/PSMODULES/TestMgmt/PSDATAENTITIES';
const logicName = 'plan_compar_ative_analysis';
const schemePaths = [
  'plm/model/PSSYSBISCHEMES/BIScheme.json',
  'plm/model/PSSYSAPPS/plmweb/PSAPPBISCHEMES/BIScheme.json',
];
const revisedMeasures = [
  'work_items_completed_on_schedule',
  'work_item_completion_rate_on_schedule',
  'overdue_completed_work_item',
  'overdue_completed_work_item_rate',
  'overdue_unfinished_work_item',
  'overdue_unfinished_work_item_rate',
  'workload_type_ratio',
];
function measureFrom(model, codeName) {
  if (!model || typeof model !== 'object') return null;
  if (model.codeName === codeName && model.measureFormula) return model;
  for (const value of Object.values(model)) {
    const result = measureFrom(value, codeName);
    if (result) return result;
  }
  return null;
}
const sources = ['run', 'test_case'].map(entity => {
  const path = `${base}/${entity}/PSDELOGICS/${logicName}.json`;
  const logic = json(path);
  const node = logic.getPSDELogicNodes.find(item => item.logicNodeType === 'RAWSQLCALL');
  const embedded = json(`${base}/${entity}.json`).getAllPSDELogics
    .find(item => item.codeName === logicName).getPSDELogicNodes
    .find(item => item.logicNodeType === 'RAWSQLCALL');
  const drl = read(`${path}.drl`);
  const literal = drl.match(/String strSql=("(?:[^"\\]|\\.)*");/);
  assert.ok(literal, `${entity}: generated DRL SQL literal`);
  const namedSql = JSON.parse(literal[1]);
  const bindingOrder = [...namedSql.matchAll(/#\{et\.param(\d+)\}/g)].map(match => +match[1]);
  return {
    entity, path, node, embedded,
    drlSql: namedSql.replace(/#\{et\.param\d+\}/g, '?'),
    bindingOrder,
  };
});

let DatabaseSync;
try {
  ({ DatabaseSync } = await import('node:sqlite'));
} catch (error) {
  if (error.code !== 'ERR_UNKNOWN_BUILTIN_MODULE') throw error;
}

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.function('CONCAT', { varargs: true }, (...values) =>
    values.some(value => value === null) ? null : values.join(''));
  db.function('FIND_IN_SET', (value, list) => value === null || list === null ? null :
    String(list).split(',').indexOf(String(value)) + 1);
  db.exec(`
    CREATE TABLE test_plan (ID TEXT PRIMARY KEY, NAME TEXT);
    CREATE TABLE test_case (ID TEXT PRIMARY KEY, TEST_LIBRARY_ID TEXT);
    CREATE TABLE run (ID TEXT PRIMARY KEY, plan_id TEXT, case_id TEXT, status TEXT,
      executor_id TEXT, executed_at TEXT);
    CREATE TABLE run_history (ID TEXT PRIMARY KEY, run_id TEXT, status TEXT);
  `);
  const plan = db.prepare('INSERT INTO test_plan VALUES (?, ?)');
  const testCase = db.prepare('INSERT INTO test_case VALUES (?, ?)');
  const run = db.prepare('INSERT INTO run VALUES (?, ?, ?, ?, ?, ?)');
  for (const [id, statuses, library] of [
    ['partial', ['10', '20', null, null], 'library'],
    ['unexecuted', [null, null], 'library'],
    ['all-passed', ['10', '10'], 'library'],
    ['other-library', ['10'], 'other-library'],
    ['empty', [], 'library'],
  ]) {
    plan.run(id, `${id} plan`);
    statuses.forEach((status, index) => {
      const key = `${id}-${index}`;
      testCase.run(key, library);
      run.run(key, id, key, status, index < 2 ? 'alice' : 'bob',
        status === null ? null : '2026-11-14 12:00:00');
    });
  }
  return db;
}

function execute(db, source, sql, filters = {}) {
  const defaults = { n_test_library_id_eq: 'library', ...filters };
  const params = source.node.getPSDELogicNodeParams
    .filter(param => param.paramAction === 'SQLPARAM')
    .map(param => defaults[param.srcFieldName.toLowerCase()] ?? null);
  assert.equal((sql.match(/\?/g) ?? []).length, params.length);
  return db.prepare(sql).all(...params).map(row => ({
    plan: row.filter_type,
    total: row.TotalRuns,
    executed: row.ExecutedRuns,
    passed: row.PassedRuns,
    executionRate: Number.parseFloat(row.ExecutionRate),
    passRate: Number.parseFloat(row.PassRate),
  }));
}

test('comparison consumer labels passrate as the manual all-plan test execution pass rate', () => {
  const chartPath = 'plm/model/PSSYSAPPS/plmweb/PSAPPDATAENTITIES/run/PSCHARTS/comparative_analysis_view_chart.json';
  const chart = json(chartPath);
  const headers = JSON.parse(chart.getUserParam['EC.gridHeaders']);
  assert.equal(headers.find(header => header.id === 'passrate').name, '测试执行通过率');
  assert.equal(chart.getFetchPSControlAction.getPSAppDEMethod.id, 'fetch_comparative_analysis');
  const dataset = json(`${base}/run.json`).getAllPSDEDataSets
    .find(item => item.codeName === 'comparativeAnalysis');
  assert.equal(dataset.getPSDELogic.path, `PSMODULES/TestMgmt/PSDATAENTITIES/run/PSDELOGICS/${logicName}.json`);
  const view = read('plm-web/src/publish/model/views/run-comparative-analysis-report-view.ts');
  assert.ok(view.includes('"id":"passrate","name":"测试执行通过率"'));
  assert.ok(view.includes("appDEDataSetId: 'fetch_comparative_analysis'"));
});

test('standalone, entity aggregate and generated DRL retain identical SQL and binding order', () => {
  for (const source of sources) {
    assert.equal(source.node.sql, source.embedded.sql, `${source.entity}: embedded SQL`);
    assert.deepEqual(source.node.getPSDELogicNodeParams, source.embedded.getPSDELogicNodeParams);
    assert.equal(source.drlSql, source.node.sql, `${source.entity}: DRL decoded SQL`);
    assert.deepEqual(source.bindingOrder, source.node.getPSDELogicNodeParams.map((_, index) => index));
  }
});

test('actual source SQL executes counts and full-plan denominator in isolated memory', {
  skip: !DatabaseSync && 'Execution requires Node with node:sqlite; run this suite on Node 24',
}, () => {
  for (const source of sources) {
    for (const [kind, sql] of [['logic', source.node.sql], ['embedded', source.embedded.sql], ['DRL', source.drlSql]]) {
      const db = fixture();
      try {
        const rows = execute(db, source, sql);
        assert.deepEqual(rows, [
          { plan: 'all-passed', total: 2, executed: 2, passed: 2, executionRate: 100, passRate: 100 },
          { plan: 'partial', total: 4, executed: 2, passed: 1, executionRate: 50, passRate: 25 },
          { plan: 'unexecuted', total: 2, executed: 0, passed: 0, executionRate: 0, passRate: 0 },
        ], `${source.entity}/${kind}`);
        assert.ok(!rows.some(row => row.plan === 'empty'), 'Empty-plan inclusion policy is unchanged');
      } finally {
        db.close();
      }
    }
  }
});

test('same planned case history never multiplies report denominator and latest status controls pass rate', {
  skip: !DatabaseSync && 'Execution requires Node with node:sqlite; run this suite on Node 24',
}, () => {
  for (const source of sources) {
    const db = fixture();
    try {
      db.prepare('INSERT INTO run_history VALUES (?, ?, ?)').run('old', 'partial-1', '20');
      db.prepare('INSERT INTO run_history VALUES (?, ?, ?)').run('new', 'partial-1', '10');
      db.prepare('UPDATE run SET status = ? WHERE ID = ?').run('10', 'partial-1');
      let row = execute(db, source, source.node.sql).find(item => item.plan === 'partial');
      assert.deepEqual(row, { plan: 'partial', total: 4, executed: 2, passed: 2, executionRate: 50, passRate: 50 });
      db.prepare('UPDATE run SET status = NULL WHERE ID = ?').run('partial-1');
      row = execute(db, source, source.node.sql).find(item => item.plan === 'partial');
      assert.deepEqual(row, { plan: 'partial', total: 4, executed: 1, passed: 1, executionRate: 25, passRate: 25 },
        'Current-status execution counting after reset is an unchanged policy, not manual acceptance');
    } finally {
      db.close();
    }
  }
});

test('run filters remain bound and constrain the same population as the report counts', {
  skip: !DatabaseSync && 'Execution requires Node with node:sqlite; run this suite on Node 24',
}, () => {
  const source = sources.find(item => item.entity === 'run');
  const db = fixture();
  try {
    const plan = execute(db, source, source.node.sql, { n_plan_name_eq: 'partial' });
    assert.equal(plan.length, 1);
    assert.equal(plan[0].passRate, 25);
    const executor = execute(db, source, source.node.sql, {
      n_plan_name_eq: 'partial', n_executor_id_eq: 'alice',
    });
    assert.deepEqual(executor, [
      { plan: 'partial', total: 2, executed: 2, passed: 1, executionRate: 100, passRate: 50 },
    ]);
    const status = execute(db, source, source.node.sql, {
      n_plan_name_eq: 'partial', n_status_eq: '10',
    });
    assert.equal(status[0].total, 1);
    assert.equal(status[0].passRate, 100);
    assert.deepEqual(execute(db, source, source.node.sql, {
      n_plan_name_eq: "partial') OR 1=1 --",
    }), [], 'Filter values are parameters, never SQL text');
    assert.deepEqual(execute(db, source, source.node.sql, {
      n_executed_at_gtandeq: '2026-11-15 00:00:00',
      n_executed_at_ltandeq: '2026-11-16 00:00:00',
    }), []);
  } finally {
    db.close();
  }
});

test('MV12 zero-estimate and empty-set policies remain unchanged and explicit, not silently replaced', () => {
  const measures = model => {
    const result = [];
    const visit = value => {
      if (!value || typeof value !== 'object') return;
      if (['estimated_deviation_rate', 'test_run_pass_rate'].includes(value.codeName)) result.push(value);
      for (const child of Object.values(value)) visit(child);
    };
    visit(model);
    return result;
  };
  const [backend, frontend] = schemePaths.map(path => measures(json(path)));
  assert.equal(backend.length, 2);
  for (const measure of backend) {
    assert.equal(measure.measureFormula, frontend.find(item => item.codeName === measure.codeName).measureFormula);
  }
  const estimate = backend.find(item => item.codeName === 'estimated_deviation_rate');
  assert.ok(estimate.measureFormula.includes('if(estimated_workload = 0, 1, estimated_workload)'),
    'Changing zero-estimate policy needs a separate approved contract');
  const passRate = backend.find(item => item.codeName === 'test_run_pass_rate');
  assert.ok(passRate.measureFormula.includes('countif(library_is_deleted = 0)'),
    'BI denominator remains the planned population, including unexecuted cases');
});

// This adapter executes the affected SQL-like BI formulas, not the production BI compiler.
function biFixture() {
  const db = new DatabaseSync(':memory:');
  db.function('if', (condition, yes, no) => condition ? yes : no);
  db.function('now', () => '2026-11-14 12:00:00');
  db.function('multiif', { varargs: true }, (...args) => {
    for (let index = 0; index < args.length - 1; index += 2) {
      if (args[index]) return args[index + 1];
    }
    return args.at(-1);
  });
  db.aggregate('countif', { start: 0, step: (count, condition) => count + (condition ? 1 : 0) });
  db.aggregate('sumif', { start: 0, step: (sum, value, condition) => sum + (condition ? Number(value ?? 0) : 0) });
  db.exec(`
    CREATE TABLE work_item (id TEXT PRIMARY KEY, state_type TEXT, state TEXT, end_at TEXT,
      completed_at TEXT, is_deleted INTEGER, project_is_deleted INTEGER);
    INSERT INTO work_item VALUES
      ('on-time-closed', 'closed', 'custom-closed', '2026-11-10', '2026-11-09', 0, 0),
      ('late-completed', 'completed', 'custom-done', '2026-11-10', '2026-11-11', 0, 0),
      ('late-pending', 'pending', '40', '2026-11-10', NULL, 0, 0),
      ('future-progress', 'in_progress', 'custom-progress', '2026-11-20', NULL, 0, 0),
      ('future-pending', 'pending', 'other', '2026-11-21', NULL, 0, 0),
      ('deleted-late', 'completed', 'custom-done', '2026-11-10', '2026-11-11', 1, 0),
      ('deleted-project', 'closed', 'custom-closed', '2026-11-10', '2026-11-11', 0, 1);
    CREATE TABLE workload (id TEXT PRIMARY KEY, type_id TEXT, duration REAL);
    INSERT INTO workload VALUES ('long', '1', 8), ('short', '2', 1), ('shorter', '2', 1);
  `);
  return db;
}

function biExpression(expression, params = {}) {
  const literal = value => typeof value === 'number' ? String(value) : `'${String(value).replaceAll("'", "''")}'`;
  const sql = expression
    .replace(/params\((\w+),\s*\(([^()]*)\)\)/g, (_, key, fallback) =>
      Object.hasOwn(params, key) ? [].concat(params[key]).map(literal).join(',') : fallback)
    .replace(/param\((\w+),\s*('(?:[^']|'')*'|-?\d+(?:\.\d+)?)\)/g, (_, key, fallback) =>
      Object.hasOwn(params, key) ? literal(params[key]) : fallback);
  assert.doesNotMatch(sql, /\bparams?\(/, 'Unexpected BI parameter syntax needs an explicit test adapter');
  return sql;
}

test('revised BI formulas stay identical across server and application models with aligned drill predicates', () => {
  const [backend, frontend] = schemePaths.map(json);
  for (const codeName of revisedMeasures) {
    const measure = measureFrom(backend, codeName);
    assert.equal(measure.measureFormula, measureFrom(frontend, codeName).measureFormula, codeName);
    assert.ok(measure.drillDetailCustomCond, `${codeName}: source drill predicate`);
  }
  const types = json('plm/model/PSMODULES/ProjMgmt/PSCODELISTS/state_type.json')
    .getPSCodeItems.map(item => item.value);
  assert.ok(types.includes('completed') && types.includes('closed'));
  const fields = json('plm/model/PSMODULES/ProjMgmt/PSDATAENTITIES/work_item.json').getAllPSDEFields;
  assert.ok(fields.some(field => field.name === 'COMPLETED_AT' && field.logicName === '完成时间'));
  assert.ok(json('plm/model/PSMODULES/Base/PSDATAENTITIES/workload.json').getAllPSDEFields
    .some(field => field.name === 'DURATION' && field.logicName === '时长'));
});

test('actual BI formulas execute terminal denominators, completion dates, custom states and duration weights', {
  skip: !DatabaseSync && 'Execution requires Node with node:sqlite; run this suite on Node 24',
}, () => {
  for (const path of schemePaths) {
    const scheme = json(path);
    const db = biFixture();
    const rate = (key, params = {}) => db.prepare(`SELECT ${
      biExpression(measureFrom(scheme, key).measureFormula, params)
    } AS rate FROM ${key === 'workload_type_ratio' ? 'workload' : 'work_item'}`).get().rate;
    try {
      assert.equal(rate('work_item_completion_rate_on_schedule'), 0.5, path);
      assert.equal(rate('work_items_completed_on_schedule'), 1);
      assert.equal(rate('overdue_completed_work_item_rate'), 0.5,
        'An on-time completion must stay on time after its deadline passes');
      assert.equal(rate('overdue_completed_work_item'), 1);
      assert.equal(rate('overdue_unfinished_work_item_rate'), 1 / 3,
        'The custom pending state value 40 is not automatically completed');
      assert.equal(rate('overdue_unfinished_work_item'), 1);
      assert.equal(rate('workload_type_ratio'), 0.8, 'Eight hours out of ten, not one row out of three');
      assert.equal(rate('workload_type_ratio', { type_id: '2' }), 0.2);
      assert.equal(rate('work_item_completion_rate_on_schedule', { code_type: '10', state_type: 'closed' }), 1);
      assert.equal(rate('overdue_completed_work_item_rate', { code_type: '20', state: 'custom-done' }), 1);
      db.exec("DELETE FROM work_item WHERE state_type NOT IN ('completed', 'closed')");
      assert.equal(rate('work_item_completion_rate_on_schedule'), 0.5, 'Adding pending work must not dilute completion denominator');
    } finally {
      db.close();
    }
  }
});

test('server drill predicates select exactly the measured numerator for revised work-item metrics', {
  skip: !DatabaseSync && 'Execution requires Node with node:sqlite; run this suite on Node 24',
}, () => {
  const scheme = json(schemePaths[0]);
  const db = biFixture();
  try {
    for (const [codeName, expected] of [
      ['work_items_completed_on_schedule', ['on-time-closed']],
      ['work_item_completion_rate_on_schedule', ['on-time-closed']],
      ['overdue_completed_work_item', ['late-completed']],
      ['overdue_completed_work_item_rate', ['late-completed']],
      ['overdue_unfinished_work_item', ['late-pending']],
      ['overdue_unfinished_work_item_rate', ['late-pending']],
    ]) {
      const condition = biExpression(measureFrom(scheme, codeName).drillDetailCustomCond);
      const rows = db.prepare(`SELECT id FROM work_item WHERE ${condition} ORDER BY id`).all();
      assert.deepEqual(rows.map(row => row.id), expected, codeName);
    }
  } finally {
    db.close();
  }
});
