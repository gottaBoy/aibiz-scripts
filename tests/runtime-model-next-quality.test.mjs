import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import nodeTest, { after } from 'node:test';
import {
  controllerFixture, docsFixture, implementation, knownOriginalIssues, plain,
  rawNode, settle, sha256, sourceFiles, ts, workspace,
} from './runtime-model-test-support.mjs';

const sourceRoot = join(workspace, 'modelingweb/local-plugins/runtime-model-next/src');
const output = join(workspace, '.artifacts/runtime-model-next-quality', `probe-${randomUUID()}`);
const baselineReport = join(workspace,
  '.artifacts/runtime-model-source-build/build-d29dd4cb-76ab-4764-8797-4d44263e6840/report.json');
const report = {
  contract: 'runtime-model-next-independent-functional-quality',
  candidateVersion: '0.2.2-local.2', baselineVersion: '0.2.2-local.1',
  startedAt: new Date().toISOString(), sourceRoot,
  boundary: 'Editable source classes with controlled HTTP/timers; built-loader DOM tests are separate.',
  nativeAcceptance: false, originalSourceRecovered: false,
  intentionalDifferences: knownOriginalIssues.map(issue => issue.id),
  sourceInputs: sourceFiles(sourceRoot).map(path => ({
    path, sha256: sha256(readFileSync(path)),
  })),
  tests: [],
};

const fixed = () => implementation('recovered', { sourceRoot });
function test(name, run) {
  return nodeTest(name, async () => {
    const result = { name, status: 'failed' };
    report.tests.push(result);
    try {
      await run();
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
    ? 'local-functional-quality-passed-not-native-accepted' : 'failed';
  await mkdir(output, { recursive: true });
  await writeFile(join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`runtime-model .2 independent quality evidence: ${join(output, 'report.json')}`);
});

test('frozen .1 source inputs and immutable historical receipt remain unchanged', () => {
  const bytes = readFileSync(baselineReport);
  assert.equal(sha256(bytes), '61fef68adefb10918750c6593418eab357e7d1dc8ca6ffaa6e771236417d7910');
  const baseline = JSON.parse(bytes);
  assert.equal(baseline.candidateVersion, report.baselineVersion);
  const entries = baseline.inputs.files.entries.filter(item => item.path.startsWith('src/'));
  assert.ok(entries.length > 0);
  for (const entry of entries) {
    assert.equal(sha256(readFileSync(join(baseline.packageRoot, entry.path))), entry.sha256,
      `Preserved .1 source drift: ${entry.path}`);
  }
  report.baselineProtection = {
    reportPath: baselineReport, reportSha256: sha256(bytes), sourceFilesVerified: entries.length,
    boundary: 'Historical receipt and live source hashes only; not a new dependency/build verifier verdict.',
  };
});

test('successful fresh empty root is complete without an error log and retains request context', async () => {
  const env = fixed();
  const controller = controllerFixture(env);
  env.respond(async () => ({ data: [] }));
  await controller.loadRootData({ srfparentkey: 'empty-parent' });
  assert.equal(controller.data.loaded, true);
  assert.deepEqual(plain(controller.data.rootData), {});
  assert.deepEqual(plain(controller.data.list), []);
  assert.deepEqual(plain(controller.data.activeList), []);
  assert.equal(controller.data.errorMessage, null);
  assert.equal(controller.historyCache.size, 0);
  assert.equal(env.refs.get('rootLoadingPanel').visible, false);
  assert.deepEqual(JSON.parse(env.calls[0].body), { srfkey: '#', srfparentkey: 'empty-parent' });
  assert.deepEqual(env.logs, [], 'A valid empty root is not a model-loading failure');
});

test('failed root followed by empty root clears its stale error and may be retried to populated data', async () => {
  const env = fixed();
  const controller = controllerFixture(env);
  env.respond(async () => ({ status: 403, data: { message: 'root-forbidden' } }));
  await controller.loadRootData();
  assert.equal(controller.data.errorMessage, 'root-forbidden');
  assert.equal(controller.data.loaded, true);
  env.respond(async () => ({ data: [] }));
  await controller.loadRootData({ srfparentkey: 'retry-parent' });
  assert.equal(controller.data.errorMessage, null);
  assert.deepEqual(env.logs, []);
  env.respond(async (_url, options) => ({
    data: JSON.parse(options.body).srfkey === '#'
      ? [rawNode('ROOT@retry', 'Retry root', 0)]
      : [rawNode('VALUE@retry', 'Retry value')],
  }));
  await controller.loadRootData({ srfparentkey: 'retry-parent' });
  assert.equal(controller.data.loaded, true);
  assert.equal(controller.data.rootData.id, 'ROOT@retry');
  assert.equal(controller.data.list[0][0].id, 'VALUE@retry');
  assert.equal(controller.data.activeList[0].id, 'ROOT@retry');
  assert.deepEqual(env.calls.slice(-2).map(call => JSON.parse(call.body)), [
    { srfkey: '#', srfparentkey: 'retry-parent' },
    { srfkey: 'ROOT@retry', srfparentkey: 'retry-parent' },
  ]);
  env.timer.advance();
  assert.equal(env.refs.get('rootLoadingPanel').visible, false);
  assert.equal(env.refs.get('loadingPanel').visible, false);
});

test('default or empty-ID child requests retain # transport without caching an unidentified node', async () => {
  const env = fixed();
  const controller = controllerFixture(env);
  env.respond(async () => ({ data: [rawNode('VALUE@default', 'Default value')] }));
  await controller.load();
  await controller.load({ id: '' });
  assert.deepEqual(env.calls.map(call => JSON.parse(call.body).srfkey), ['#', '#']);
  assert.deepEqual([...controller.historyCache.keys()], []);
  controller.setCache(undefined, controller.data.list[0]);
  controller.setCache('', controller.data.list[0]);
  assert.equal(controller.getCache(undefined), null);
  assert.equal(controller.getCache(''), null);
  await controller.loadChildren(-1);
  assert.equal(env.calls.length, 3, 'Unidentified requests must not share an undefined cache hit');
  env.timer.advance();
});

test('named cache hits clone nested data and trim stale columns and selection without POST', async () => {
  const env = fixed();
  const controller = controllerFixture(env);
  controller.setCache('0', [{
    id: 'VALUE@cached', leaf: true, data: { logicName: 'Cached value' },
  }]);
  controller.data.list = [[{ id: 'old', leaf: true, data: {} }], []];
  controller.data.activeList = [{ id: '0' }, { id: 'old' }];
  await controller.loadChildren(-1, { id: '0' });
  assert.equal(env.calls.length, 0);
  assert.equal(controller.data.list.length, 1);
  assert.equal(controller.data.activeList.length, 0);
  controller.data.list[0][0].data.logicName = 'Changed visible value';
  assert.equal(controller.getCache('0')[0].data.logicName, 'Cached value');
});

test('response-shadows-cache-key: deferred responses retain the request ID even when the selection changes', async () => {
  const env = fixed();
  const controller = controllerFixture(env);
  const selection = { id: 'requested-branch' };
  const otherItems = [{ id: 'VALUE@other', leaf: true, data: { logicName: 'Other cache' } }];
  controller.setCache('changed-branch', otherItems);
  let release;
  env.respond(() => new Promise(done => { release = done; }));
  const pending = controller.loadModelData(selection);
  await settle();
  assert.deepEqual(JSON.parse(env.calls[0].body), { srfkey: 'requested-branch' });
  selection.id = 'changed-branch';
  release({ data: [rawNode('VALUE@requested', 'Requested value')] });
  await pending;
  assert.ok(controller.getCache('requested-branch'), 'Response cached under a different request ID');
  assert.equal(controller.getCache('requested-branch')[0].id, 'VALUE@requested');
  assert.deepEqual(plain(controller.getCache('changed-branch')), otherItems);
  controller.data.list[0][0].data.logicName = 'Visible copy changed';
  assert.equal(controller.getCache('requested-branch')[0].data.logicName, 'Requested value');
  const calls = env.calls.length;
  await controller.loadChildren(-1, { id: 'requested-branch' });
  assert.equal(env.calls.length, calls, 'The original request ID must be a real cache hit');
  env.timer.advance();
});

test('empty-root-never-loaded: a deferred empty reload removes the populated state before completion', async () => {
  const env = fixed();
  const controller = controllerFixture(env);
  await controller.loadRootData({ srfparentkey: 'populated' });
  env.timer.advance();
  assert.ok(controller.data.rootData.id);
  assert.ok(controller.data.list.length > 0);
  assert.ok(controller.historyCache.size > 0);
  controller.data.errorMessage = 'obsolete-error';
  let release;
  env.respond(() => new Promise(done => { release = done; }));
  const pending = controller.loadRootData({ srfparentkey: 'empty' });
  await settle();
  assert.equal(controller.data.loaded, false);
  assert.deepEqual(plain(controller.data.rootData), {});
  assert.deepEqual(plain(controller.data.list), []);
  assert.deepEqual(plain(controller.data.activeList), []);
  assert.equal(controller.data.errorMessage, null);
  assert.equal(controller.historyCache.size, 0);
  assert.equal(env.refs.get('rootLoadingPanel').visible, true);
  assert.deepEqual(JSON.parse(env.calls.at(-1).body), { srfkey: '#', srfparentkey: 'empty' });
  release({ data: [] });
  await pending;
  assert.equal(controller.data.loaded, true);
  assert.equal(env.refs.get('rootLoadingPanel').visible, false);
  assert.deepEqual(plain(controller.data.rootData), {});
  assert.deepEqual(plain(controller.data.list), []);
  assert.deepEqual(env.logs, []);
});

test('children-promise-does-not-wait: completion waits for deferred configuration enrichment and caching', async () => {
  const env = fixed();
  const controller = controllerFixture(env);
  let release;
  env.respond(async url => {
    if (url.startsWith(controller.configBaseUrl)) {
      return new Promise(done => { release = done; });
    }
    return { data: [rawNode('METHOD@child@PSSYSAPP', 'openChild#Branch ==> value', 0)] };
  });
  let complete = false;
  const pending = controller.loadChildren(-1, { id: 'branch' })
    .then(() => { complete = true; });
  await settle();
  assert.equal(typeof release, 'function', 'Real formatting must request documentation');
  assert.equal(complete, false);
  assert.deepEqual(plain(controller.data.list), []);
  assert.equal(controller.getCache('branch'), null);
  assert.equal(env.refs.get('loadingPanel').visible, true);
  release({ data: docsFixture });
  await pending;
  assert.equal(complete, true);
  assert.equal(controller.data.list[0][0].data.apiMethod, 'openChild()');
  assert.equal(controller.data.list[0][0].data.apiDescription, 'Open a child model');
  assert.deepEqual(plain(controller.getCache('branch')), plain(controller.data.list[0]));
  assert.deepEqual(env.calls.map(call => ({ url: call.url, method: call.method })), [
    { url: '/fixture/nodes', method: 'POST' },
    { url: '/fixture/config/IPSAPPLICATION.json', method: 'GET' },
  ]);
  env.timer.advance();
  assert.equal(env.refs.get('loadingPanel').visible, false);
  assert.equal(env.refs.get('rootLoadingMask').visible, false);
});

for (const status of [403, 504]) {
  test(`uncached children Promise waits for deferred ${status} state handling, without claiming rejection`, async () => {
    const env = fixed();
    const controller = controllerFixture(env);
    let release;
    env.respond(() => new Promise(done => { release = done; }));
    let complete = false;
    const pending = controller.loadChildren(0, { id: 'failure' })
      .then(() => { complete = true; });
    await settle();
    assert.equal(complete, false);
    assert.equal(controller.data.errorMessage, null);
    release({ status, data: { message: `child-${status}` } });
    await pending;
    assert.equal(complete, true);
    assert.equal(controller.data.errorMessage,
      status === 504 ? '模型加载超时，请稍后再试!' : `child-${status}`);
    assert.equal(controller.getCache('failure'), null);
    assert.deepEqual(plain(controller.data.list), []);
    env.timer.advance();
    assert.equal(env.refs.get('loadingPanel').visible, false);
    assert.equal(env.refs.get('rootLoadingMask').visible, false);
  });
}

test('config-http-status-unchecked: a real JSON 404 cannot enrich or invent API methods', async () => {
  const env = fixed();
  const controller = controllerFixture(env);
  const forged = {
    'openChild()': { description: 'FORGED matching operation', return: 'forged.Return' },
    'forgedOnly()': { description: 'FORGED documentation-only operation', return: 'forged.Extra' },
  };
  const response = () => new Response(JSON.stringify(forged), {
    status: 404, headers: { 'Content-Type': 'application/json' },
  });
  env.respond(async () => response());
  await assert.rejects(env.exported.ModelRuntimeService.getConfig('/fixture/config', 'PSSYSAPP'),
    error => error instanceof Response && error.status === 404 &&
      assert.deepEqual(plain(error.data), forged) === undefined);
  const items = await controller.formatItems([
    rawNode('METHOD@child@PSSYSAPP', 'openChild#Real branch ==> real-value', 0),
  ]);
  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'METHOD@child@PSSYSAPP');
  assert.deepEqual(plain(items[0].data), {
    methodName: 'openChild', logicName: 'Real branch', val: 'real-value',
  });
  assert.equal(items.some(item => item.isApi), false);
  assert.deepEqual(env.logs.map(item => item.args), [['配置方法解析异常']]);
  assert.ok(env.calls.every(call =>
    call.url === '/fixture/config/IPSAPPLICATION.json' && call.method === 'GET'));
});

for (const status of [403, 404, 500]) {
  test(`non-JSON configuration ${status} retains the HTTP failure rather than a JSON SyntaxError`, async () => {
    const env = fixed();
    env.respond(async () => new Response('<html>missing documentation</html>', { status }));
    await assert.rejects(env.exported.ModelRuntimeService.getConfig('/config', 'PSSYSAPP'),
      error => error instanceof Response && error.status === status);
    assert.equal(env.calls[0].url, '/config/IPSAPPLICATION.json');
    const controller = controllerFixture(env);
    env.respond(async () => new Response('<html>missing documentation</html>', { status }));
    const items = await controller.formatItems([
      rawNode('METHOD@open@PSSYSAPP', 'open#Real operation ==> real-value'),
    ]);
    assert.equal(items.length, 1);
    assert.equal(items[0].data.methodName, 'open');
    assert.equal(items[0].data.apiMethod, undefined);
    assert.deepEqual(env.logs.map(item => item.args), [['配置方法解析异常']]);
  });
}

for (const [name, failure] of [
  ['network rejection', new TypeError('documentation network failure')],
  ['invalid successful JSON', new SyntaxError('invalid documentation JSON')],
]) {
  test(`configuration ${name} remains a failure; real model rows survive without phantom APIs`, async () => {
    const env = fixed();
    const respond = async () => {
      if (failure instanceof TypeError) throw failure;
      return { status: 200, jsonError: failure };
    };
    env.respond(respond);
    await assert.rejects(env.exported.ModelRuntimeService.getConfig('/config', 'PSDE'),
      error => error === failure);
    const controller = controllerFixture(env);
    env.respond(respond);
    const items = await controller.formatItems([
      rawNode('METHOD@open@PSDE', 'open#Real operation ==> real-value'),
    ]);
    assert.equal(items.length, 1);
    assert.equal(items.some(item => item.isApi), false);
    assert.equal(items[0].data.logicName, 'Real operation');
    assert.deepEqual(env.logs.map(item => item.args), [['配置方法解析异常']]);
  });
}

test('supported JSON-encoded documentation and exact GET/type mapping preserve enrichment', async () => {
  const env = fixed();
  const controller = controllerFixture(env);
  env.respond(async () => ({ data: JSON.stringify(docsFixture) }));
  const items = await controller.formatItems([
    rawNode('METHOD@open@PSSYSAPP', 'openChild#Branch ==> value', 0),
  ]);
  assert.equal(items[0].data.apiMethod, 'openChild()');
  assert.equal(items[0].data.apiDescription, 'Open a child model');
  assert.equal(items[0].data.apiReturn, 'Child');
  assert.equal(items[1].id, 'onlyDocumentation()');
  assert.equal(items[1].data.apiReturn, 'List<Doc>');
  assert.deepEqual(env.calls, [{
    url: '/fixture/config/IPSAPPLICATION.json', method: 'GET', mode: null, headers: {}, body: null,
  }]);
  assert.deepEqual(env.logs, []);
});

test('no METHOD type makes no documentation GET and does not alter real values', async () => {
  const env = fixed();
  const controller = controllerFixture(env);
  const items = await controller.formatItems([
    rawNode('VALUE@plain', 'Plain operation ==> plain-value'),
  ]);
  assert.deepEqual(env.calls, []);
  assert.deepEqual(plain(items[0].data), { logicName: 'Plain operation', val: 'plain-value' });
});

test('rapid literal-search inputs apply only the last debounced query and preserve controller case contract', () => {
  const env = fixed();
  const controller = controllerFixture(env);
  controller.searchValue = 'alpha';
  assert.equal(controller.isSearchContent('ALPHA'), true);
  assert.equal(controller.isSearchContent('alpha'), false, 'No incidental controller i-flag delta');
  const list = env.instance('IBizModelRuntimeList');
  list.items = [
    { id: 'bracket', leaf: true, data: { logicName: 'Literal [ value' } },
    { id: 'slash', leaf: true, data: { logicName: 'Literal \\ value' } },
  ];
  list.componentWillLoad();
  list.setSearchValue({ target: { value: '[' } });
  env.timer.advance(200);
  list.setSearchValue({ target: { value: ' \\ ' } });
  env.timer.advance(299);
  assert.equal(list.$searchValue, '');
  env.timer.advance(1);
  assert.equal(list.$searchValue, '\\');
  assert.deepEqual(plain(list.showList.map(item => item.id)), ['slash']);
  list.setSearchValue({ target: { value: '**' } });
  env.timer.advance(300);
  assert.equal(list.showList.length, 2);
});

test('unescaped-search-expression: all metacharacters are literal and every wildcard works in both controls', () => {
  const env = fixed();
  const controller = controllerFixture(env);
  const list = env.instance('IBizModelRuntimeList');
  for (const literal of ['[', ']', '(', ')', '.', '+', '?', '^', '$', '{', '}', '|', '\\']) {
    controller.searchValue = literal;
    assert.equal(controller.isSearchContent(`BEFORE${literal}AFTER`), true);
    assert.equal(controller.isSearchContent('UNRELATED'), false);
    list.items = [
      { id: 'match', leaf: true, data: { logicName: `Before${literal}After` } },
      { id: 'other', leaf: true, data: { logicName: 'Unrelated' } },
    ];
    list.watchItems();
    list.setSearchValue({ target: { value: literal } });
    env.timer.advance(300);
    assert.deepEqual(plain(list.showList.map(item => item.id)), ['match']);
  }
  list.items = [
    { id: 'match', leaf: true, data: { logicName: 'Alpha first Beta second Gamma' } },
    { id: 'missing-middle', leaf: true, data: { logicName: 'Alpha Gamma' } },
  ];
  list.watchItems();
  for (const query of ['alpha*beta*gamma', 'alpha**beta***gamma']) {
    controller.searchValue = query;
    assert.equal(controller.isSearchContent('ALPHA FIRST BETA SECOND GAMMA'), true);
    assert.equal(controller.isSearchContent('ALPHA GAMMA'), false);
    list.setSearchValue({ target: { value: query } });
    env.timer.advance(300);
    assert.deepEqual(plain(list.showList.map(item => item.id)), ['match']);
  }
  controller.searchValue = '';
  assert.equal(controller.isSearchContent('ANYTHING'), true);
  list.setSearchValue({ target: { value: '' } });
  env.timer.advance(300);
  assert.equal(list.showList.length, 2);
});

test('pagination-delete-count: empty, exact and partial page boundaries never mutate or duplicate rows', () => {
  const env = fixed();
  for (const count of [0, 1, 29, 30, 31, 40, 41, 95]) {
    const list = env.instance('IBizModelRuntimeList');
    list.items = Array.from({ length: count }, (_, index) => ({
      id: `node-${index}`, leaf: true, data: { logicName: `Value ${index}` },
    }));
    const original = plain(list.items);
    list.componentWillLoad();
    assert.equal(list.showList.length, Math.min(30, count));
    for (let page = 0; page < Math.ceil(count / 10) + 2; page++) {
      const previous = list.showList.length;
      list.load();
      assert.equal(list.showList.length, Math.min(count, previous + 10));
      assert.deepEqual(plain(list.showList), original.slice(0, list.showList.length));
    }
    assert.equal(list.isLoadMore, false);
    assert.deepEqual(plain(list.showList), original);
    assert.deepEqual(plain(list.items), original);
    assert.deepEqual(plain(list.list), original);
  }
});

test('filtered pagination preserves a selected nonmatch, stable order and immutable source data', () => {
  const env = fixed();
  const list = env.instance('IBizModelRuntimeList');
  list.items = Array.from({ length: 90 }, (_, index) => ({
    id: `node-${index}`, leaf: true,
    data: { logicName: index % 2 ? 'Other' : 'Match' },
  }));
  const original = plain(list.items);
  list.activeData = list.items[1];
  list.componentWillLoad();
  list.setSearchValue({ target: { value: 'match' } });
  env.timer.advance(300);
  const expected = list.items.filter((_, index) => index % 2 === 0 || index === 1)
    .map(item => item.id);
  assert.equal(list.showList.length, 30);
  list.load();
  assert.equal(list.showList.length, 40);
  list.load();
  assert.equal(list.showList.length, 46);
  list.load();
  assert.equal(list.showList.length, 46);
  assert.equal(list.isLoadMore, false);
  assert.deepEqual(plain(list.showList.map(item => item.id)), expected);
  assert.deepEqual(plain(list.items), original);
  assert.deepEqual(plain(list.list), original);
});

test('selection leaf/duplicate guards, refresh reset and Ctrl/Meta copy do not change the public contract', () => {
  const env = fixed();
  const list = env.instance('IBizModelRuntimeList');
  const calls = [];
  list.controller = {
    loadChildren: (...args) => calls.push(['children', ...args]),
    setActiveItem: item => calls.push(['active', item]),
    clearCache: () => calls.push(['clear']),
  };
  list.index = 1;
  list.parent = { id: 'parent' };
  const branch = { id: 'branch', leaf: false, data: {} };
  const leaf = { id: 'leaf', leaf: true, data: {} };
  const event = { stopPropagation() {} };
  list.rowSelect(event, leaf);
  assert.deepEqual(calls, []);
  list.rowSelect(event, branch);
  list.rowSelect(event, branch);
  assert.deepEqual(calls, [['children', 1, branch], ['active', branch]]);
  assert.equal(list.isActive(branch), true);
  list.refresh();
  assert.deepEqual(calls.slice(-3), [['clear'], ['children', 0, list.parent], ['active', list.parent]]);
  assert.deepEqual(plain(list.activeData), {});
  const document = env.platform.document;
  document.execCommand = command => {
    assert.equal(command, 'copy');
    return true;
  };
  let selected = 0;
  let stopped = 0;
  const copied = [];
  list.hiddenInput = { value: '', select() { selected++; } };
  list.floatText = (_event, text) => copied.push(text);
  const before = calls.length;
  for (const modifier of ['ctrlKey', 'metaKey']) {
    list.copyPasteboard({ [modifier]: true, stopPropagation() { stopped++; } }, 'copied-value');
  }
  list.copyPasteboard({ stopPropagation() { stopped++; } }, 'not-copied');
  assert.equal(calls.length, before);
  assert.equal(selected, 2);
  assert.equal(stopped, 2);
  assert.deepEqual(copied, ['成功复制：copied-value', '成功复制：copied-value']);
});

test('selection-not-reactive: Stencil state and immediate selection precede a deferred child response', async () => {
  const path = join(sourceRoot, 'components/ibiz-model-runtime-list/ibiz-model-runtime-list.tsx');
  const ast = ts.createSourceFile(path, readFileSync(path, 'utf8'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const component = ast.statements.find(ts.isClassDeclaration);
  const selection = component.members.find(member => member.name?.text === 'activeData');
  assert.ok(selection.decorators?.some(decorator =>
    ts.isCallExpression(decorator.expression) &&
      decorator.expression.expression.getText(ast) === 'State'));
  const props = component.members.filter(member => member.decorators?.some(decorator =>
    ts.isCallExpression(decorator.expression) &&
      decorator.expression.expression.getText(ast) === 'Prop'));
  assert.deepEqual(props.map(member => member.name.text), ['controller', 'items', 'index', 'parent']);
  const env = fixed();
  const controller = controllerFixture(env);
  const list = env.instance('IBizModelRuntimeList');
  const branch = { id: 'branch', leaf: false, data: { logicName: 'Branch' } };
  list.controller = controller;
  list.index = 0;
  list.items = [branch];
  list.componentWillLoad();
  let release;
  env.respond(() => new Promise(done => { release = done; }));
  list.rowSelect({ stopPropagation() {} }, branch);
  await settle();
  assert.equal(list.activeData.id, 'branch');
  assert.equal(list.isActive(branch), true);
  assert.deepEqual(plain(controller.data.list), []);
  assert.equal(controller.getCache('branch'), null);
  assert.deepEqual(plain(controller.data.activeList), [branch]);
  list.rowSelect({ stopPropagation() {} }, branch);
  assert.equal(env.calls.length, 1, 'Duplicate selection cannot issue another pending request');
  release({ data: [rawNode('VALUE@child', 'Child value')] });
  await settle();
  assert.equal(controller.getCache('branch')[0].id, 'VALUE@child');
  assert.equal(list.isActive(branch), true);
  env.timer.advance();
});
