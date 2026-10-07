import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import nodeTest, { after } from 'node:test';
import {
  childrenFixture, componentTags, controllerFixture, docsFixture, implementation,
  knownOriginalIssues, plain, rawNode, settle, sha256, sourceFiles, ts, workspace,
} from './runtime-model-test-support.mjs';

const sourceRoot = join(workspace, 'modelingweb/local-plugins/runtime-model-next/src');
const output = join(workspace, '.artifacts/runtime-model-next-unit', `probe-${randomUUID()}`);
const report = {
  contract: 'runtime-model-local-fixes-fixture',
  version: '0.2.2-local.2', baselineVersion: '0.2.2-local.1',
  startedAt: new Date().toISOString(), sourceRoot,
  boundary: 'Real source classes with controlled platform/API fixtures; DOM reactivity requires the separate built-loader browser gate.',
  nativeAccepted: false, originalSourceRecovered: false,
  sourceInputs: sourceFiles(sourceRoot).map(path => ({
    path, sha256: sha256(readFileSync(path)),
  })),
  intentionalDifferences: knownOriginalIssues.map(issue => issue.id), tests: [],
};
const fixed = () => implementation('recovered', { sourceRoot });
const baseline = () => implementation('recovered');

function test(name, run) {
  return nodeTest(name, async t => {
    const result = { name, status: 'failed' };
    report.tests.push(result);
    try {
      await run(t);
      result.status = 'passed';
    } catch (error) {
      result.error = error.stack || String(error);
      throw error;
    }
  });
}

after(async () => {
  report.completedAt = new Date().toISOString();
  report.status = report.tests.length > 0 && report.tests.every(item => item.status === 'passed')
    ? 'local-fixes-fixture-passed-not-native-accepted' : 'failed';
  await mkdir(output, { recursive: true });
  await writeFile(join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`runtime-model .2 unit evidence: ${join(output, 'report.json')}`);
});

async function parity(run) {
  const observed = await run(implementation('original'));
  const preserved = await run(baseline());
  const changed = await run(fixed());
  assert.deepEqual(plain(preserved), plain(observed), 'Preserved .1 differs from the observation');
  assert.deepEqual(plain(changed), plain(observed), 'Unaffected .2 behavior differs from the observation');
}

test('separate revision retains four editable component declarations and a complete seven-item delta ledger', () => {
  const env = fixed();
  const manifest = JSON.parse(readFileSync(join(sourceRoot, '../package.json')));
  assert.equal(manifest.version, report.version);
  assert.equal(manifest.aibiz.baselineVersion, report.baselineVersion);
  assert.deepEqual(manifest.aibiz.intentionalDifferences, report.intentionalDifferences);
  assert.equal(manifest.aibiz.originalSourceRecovered, false);
  assert.equal(manifest.aibiz.nativeAccepted, false);
  assert.deepEqual(env.local.declarations.map(item => item.tag).sort(), [...componentTags].sort());
  assert.ok(env.local.files.every(path => path.startsWith(`${sourceRoot}/`)));
});

test('response-shadows-cache-key: actual request IDs cache detached items and do not collide', async () => {
  for (const [env, repaired] of [[baseline(), false], [fixed(), true]]) {
    const controller = controllerFixture(env);
    env.respond(async (_url, options) => ({
      data: [rawNode(JSON.parse(options.body).srfkey, 'Node')],
    }));
    await controller.load({ id: 'first' });
    await controller.load({ id: 'second' });
    if (repaired) {
      assert.deepEqual([...controller.historyCache.keys()], ['first', 'second']);
      const first = controller.getCache('first');
      assert.equal(first[0].id, 'first');
      first[0].data.logicName = 'modified copy';
      assert.equal(controller.getCache('first')[0].data.logicName, 'Node');
      const calls = env.calls.length;
      await controller.loadChildren(-1, { id: 'first' });
      assert.equal(env.calls.length, calls, 'Revisiting a cached branch must not fetch');
      assert.equal(controller.data.list[0][0].id, 'first');
    } else {
      assert.deepEqual([...controller.historyCache.keys()], [undefined]);
      assert.equal(controller.getCache('first'), null);
    }
    env.timer.advance();
  }
});

test('children-promise-does-not-wait: uncached completion waits for the response and formatting', async () => {
  for (const [env, repaired] of [[baseline(), false], [fixed(), true]]) {
    const controller = controllerFixture(env);
    let release;
    env.respond(() => new Promise(done => { release = done; }));
    let completed = false;
    const promise = controller.loadChildren(0, { id: 'uncached' })
      .then(() => { completed = true; });
    await settle();
    assert.equal(completed, !repaired);
    assert.equal(controller.data.list.length, 0);
    release({ data: [rawNode('VALUE@child', 'Delayed child')] });
    await promise;
    await settle();
    assert.equal(controller.data.list[0][0].text, 'Delayed child');
    assert.equal(completed, true);
    env.timer.advance();
    assert.equal(env.refs.get('loadingPanel').visible, false);
  }
});

test('children await path releases loading and records a failed response rather than fabricating items', async () => {
  const env = fixed();
  const controller = controllerFixture(env);
  env.respond(async () => ({ status: 403, data: { message: 'forbidden-child' } }));
  await controller.loadChildren(0, { id: 'forbidden' });
  assert.equal(controller.data.errorMessage, 'forbidden-child');
  assert.equal(controller.getCache('forbidden'), null);
  assert.equal(controller.data.list.length, 0);
  env.timer.advance();
  assert.equal(env.refs.get('loadingPanel').visible, false);
});

test('pagination-delete-count: 30 initial rows advance in ten-row pages with no duplication', () => {
  for (const [env, repaired] of [[baseline(), false], [fixed(), true]]) {
    const list = env.instance('IBizModelRuntimeList');
    list.items = Array.from({ length: 95 }, (_, index) =>
      ({ id: `node-${index}`, leaf: true, data: { logicName: `Value ${index}` } }));
    list.componentWillLoad();
    assert.equal(list.showList.length, 30);
    list.load();
    assert.equal(list.showList.length, repaired ? 40 : 70);
    if (!repaired) continue;
    const counts = [];
    for (let index = 0; index < 7; index++) {
      list.load();
      counts.push(list.showList.length);
    }
    assert.deepEqual(counts, [50, 60, 70, 80, 90, 95, 95]);
    assert.equal(list.isLoadMore, false);
    assert.equal(new Set(list.showList.map(item => item.id)).size, 95);
    assert.deepEqual(list.showList.map(item => item.id), list.items.map(item => item.id));
    assert.equal(list.list.length, 95, 'Page slicing must not mutate the source list');
  }
});

for (const query of ['[', ']', '(', ')', '.', '+', '?', '^', '$', '{', '}', '|', '\\']) {
  test(`unescaped-search-expression: ${JSON.stringify(query)} is literal in both search controls`, () => {
    const env = fixed();
    const controller = controllerFixture(env);
    controller.searchValue = query;
    assert.equal(controller.isSearchContent(`BEFORE${query}AFTER`), true);
    assert.equal(controller.isSearchContent('unrelated'), false);
    const list = env.instance('IBizModelRuntimeList');
    list.items = [
      { id: 'match', data: { logicName: `Before${query}After` } },
      { id: 'other', data: { logicName: 'unrelated' } },
    ];
    list.componentWillLoad();
    list.setSearchValue({ target: { value: query } });
    env.timer.advance(300);
    assert.deepEqual(plain(list.showList.map(item => item.id)), ['match']);
  });
}

test('unescaped-search-expression: every wildcard is expanded and empty/case behavior remains usable', () => {
  const env = fixed();
  const controller = controllerFixture(env);
  controller.searchValue = 'alpha*beta*gamma';
  assert.equal(controller.isSearchContent('ALPHA FIRST BETA SECOND GAMMA'), true);
  assert.equal(controller.isSearchContent('ALPHA GAMMA'), false);
  controller.searchValue = '';
  assert.equal(controller.isSearchContent('ANYTHING'), true);
  const list = env.instance('IBizModelRuntimeList');
  list.items = [
    { id: 'match', data: { logicName: 'Alpha first Beta second Gamma' } },
    { id: 'other', data: { logicName: 'Alpha Gamma' } },
  ];
  list.componentWillLoad();
  list.setSearchValue({ target: { value: ' alpha*beta*gamma ' } });
  env.timer.advance(300);
  assert.equal(list.$searchValue, 'alpha*beta*gamma');
  assert.deepEqual(plain(list.showList.map(item => item.id)), ['match']);
});

test('empty-root-never-loaded: first empty response finishes and always closes its root panel', async () => {
  for (const [env, repaired] of [[baseline(), false], [fixed(), true]]) {
    const controller = controllerFixture(env);
    env.respond(async () => ({ data: [] }));
    await controller.loadRootData();
    assert.equal(controller.data.loaded, repaired);
    assert.deepEqual(plain(controller.data.rootData), {});
    assert.deepEqual(plain(controller.data.list), []);
    assert.equal(env.refs.get('rootLoadingPanel').visible, false);
    assert.equal(env.calls.length, 1);
  }
});

test('empty-root reload clears stale root, columns, selection, cache and previous error before the request resolves', async () => {
  const env = fixed();
  const controller = controllerFixture(env);
  await controller.loadRootData();
  assert.equal(controller.data.loaded, true);
  controller.data.errorMessage = 'obsolete failure';
  let release;
  env.respond(() => new Promise(done => { release = done; }));
  const reload = controller.loadRootData({ srfparentkey: 'second-root' });
  await settle();
  assert.equal(controller.data.loaded, false);
  assert.deepEqual(plain(controller.data.rootData), {});
  assert.deepEqual(plain(controller.data.list), []);
  assert.deepEqual(plain(controller.data.activeList), []);
  assert.equal(controller.data.errorMessage, null);
  assert.equal(controller.historyCache.size, 0);
  release({ data: [] });
  await reload;
  assert.equal(controller.data.loaded, true);
  assert.equal(env.refs.get('rootLoadingPanel').visible, false);
});

for (const status of [199, 300, 401, 403, 404, 500, 504]) {
  test(`config-http-status-unchecked: configuration ${status} rejects with parsed response data`, async () => {
    const env = fixed();
    const data = { message: `config-${status}`, 'fakeMethod()': { description: 'not a method' } };
    env.respond(async () => ({ status, data }));
    await assert.rejects(env.exported.ModelRuntimeService.getConfig('/config', 'PSDE'), error =>
      error.status === status && assert.deepEqual(plain(error.data), data) === undefined);
    const controller = controllerFixture(env);
    env.respond(async () => ({ status, data }));
    const items = await controller.formatItems([
      rawNode('METHOD@open@PSSYSAPP', 'open#Branch ==> value', 0),
    ]);
    assert.equal(items.length, 1, 'HTTP error JSON must not create synthetic methods');
    assert.equal(items[0].data.apiMethod, undefined);
    assert.equal(env.logs.length, 1);
  });
}

test('selection-not-reactive: the local source marks activeData as Stencil state without changing public props', () => {
  const path = join(sourceRoot, 'components/ibiz-model-runtime-list/ibiz-model-runtime-list.tsx');
  const ast = ts.createSourceFile(path, readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const component = ast.statements.find(ts.isClassDeclaration);
  const selection = component.members.find(member => member.name?.text === 'activeData');
  assert.ok(selection.decorators?.some(decorator =>
    ts.isCallExpression(decorator.expression) && decorator.expression.expression.getText(ast) === 'State'));
  const props = component.members.filter(member => member.decorators?.some(decorator =>
    ts.isCallExpression(decorator.expression) && decorator.expression.expression.getText(ast) === 'Prop'));
  assert.deepEqual(props.map(member => member.name.text), ['controller', 'items', 'index', 'parent']);
});

for (const status of [200, 201, 299]) {
  test(`unaffected POST/config ${status} preserve observation and .1 transport contracts`, async () => {
    await parity(async env => {
      env.respond(async () => ({ status, data: docsFixture }));
      const post = await env.exported.ModelRuntimeService.getRuntimeNodes('/nodes',
        { Authorization: 'Bearer unchanged' }, { srfkey: 'node', tenant: 'one' });
      const config = await env.exported.ModelRuntimeService.getConfig('/docs', 'PSSYSAPP');
      return { post, config, calls: env.calls };
    });
  });
}

test('unaffected successful root workflow preserves normalized items, context, active path and requests', async () => {
  await parity(async env => {
    const controller = controllerFixture(env);
    await controller.loadRootData({ srfparentkey: 'one', tenant: 'same' });
    env.timer.advance();
    assert.equal(controller.data.list[0].length, childrenFixture.length + 1);
    return { data: controller.data, calls: env.calls, logs: env.logs };
  });
});

test('unaffected cached branch cloning, API documentation enrichment and return types retain parity', async () => {
  await parity(async env => {
    const controller = controllerFixture(env);
    const items = await controller.formatItems(childrenFixture);
    controller.setCache('branch', items);
    await controller.loadChildren(-1, { id: 'branch' });
    controller.data.list[0][0].data.logicName = 'detached';
    return {
      cached: controller.getCache('branch'), docs: items,
      returns: ['net.example.One', 'java.util.List<net.example.Two>', 'void']
        .map(value => controller.getMethodReturn(value)), calls: env.calls,
    };
  });
});

test('unaffected store subscriptions, force updates, reset and disposal retain parity', async () => {
  await parity(env => {
    const store = new env.exported.QXStore({ count: 0 });
    const changes = [];
    const callback = value => changes.push(value);
    store.on('count', callback);
    store.data.count = 1;
    store.forceUpdate('count');
    store.off(callback);
    store.data.count = 2;
    store.reset();
    store.dispose();
    return { changes, count: store.data.count, listeners: store.evtCache.size };
  });
});
