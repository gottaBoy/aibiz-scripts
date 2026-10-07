import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import nodeTest, { after } from 'node:test';
import {
  childrenFixture, classNames, componentTags, controllerFixture, docsFixture,
  implementation, knownOriginalIssues, originalAst, originalBytes, plain, rawNode, settle,
  sha256, sourceFiles, sourceRoot, ts, workspace,
} from './runtime-model-test-support.mjs';

const output = resolveOutput();
const report = {
  contract: 'runtime-model-business-differential-fixture',
  startedAt: new Date().toISOString(), fixtureAcceptance: false, nativeAcceptance: false,
  boundary: 'Real original/reconstructed business classes in VM with controlled platform/API fixtures; not native application acceptance',
  sourceRoot, originalEntrySha256: sha256(originalBytes),
  knownOriginalIssues, tests: [],
};
function resolveOutput() {
  return join(workspace, '.artifacts/runtime-model-reconstruction-unit', `probe-${randomUUID()}`);
}
function test(name, ...args) {
  const run = args.pop();
  return nodeTest(name, ...args, async t => {
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
  report.fixtureAcceptance = report.tests.length >= 38 &&
    report.tests.every(item => item.status === 'passed');
  report.status = report.fixtureAcceptance ? 'fixture-parity-passed-not-native-accepted' : 'failed';
  await mkdir(output, { recursive: true });
  await writeFile(join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`runtime-model unit evidence: ${join(output, 'report.json')}`);
});

async function differential(run, check) {
  const original = await run(implementation('original'));
  check?.(original);
  const recovered = await run(implementation('recovered'));
  assert.deepEqual(plain(recovered), plain(original), 'Recovered business behavior differs from original runtime-model@0.2.2');
  return original;
}

test('AST audit identifies named original business classes and every restored real component', () => {
  const names = originalAst.statements.filter(ts.isClassDeclaration).map(item => item.name.text);
  for (const name of classNames) assert.ok(names.includes(name), name);
  const env = implementation('recovered');
  assert.equal(env.local.declarations.length, 4);
  assert.deepEqual(env.local.declarations.map(item => item.tag).sort(), [...componentTags].sort());
  assert.ok(sourceFiles().length >= 4);
  assert.ok(env.local.dependencies.every(id =>
    ['@stencil/core', '@stencil/store', 'ramda', '@webcreate/infinite-ajax-scroll'].includes(id)));
});

for (const status of [200, 201, 204, 299]) {
  test(`POST ${status}: URL, CORS, real Headers, exact JSON body and successful data parity`, async () => {
    await differential(async env => {
      env.respond(async () => ({ status, data: { nodes: ['one'], status } }));
      const value = await env.exported.ModelRuntimeService.getRuntimeNodes('/nodes?scope=one',
        { Authorization: 'Bearer token', 'Content-Type': 'application/json', 'X-Tenant': 'test' },
        { srfkey: '#', srfparentkey: 'parent', nested: { values: [1, false] } });
      return { value, calls: env.calls };
    }, value => {
      assert.equal(value.calls[0].method, 'POST');
      assert.equal(value.calls[0].mode, 'cors');
      assert.equal(value.calls[0].headers.authorization, 'Bearer token');
      assert.deepEqual(JSON.parse(value.calls[0].body),
        { srfkey: '#', srfparentkey: 'parent', nested: { values: [1, false] } });
    });
  });
}

for (const status of [199, 300, 400, 401, 500, 504]) {
  test(`POST ${status}: rejects the actual response with parsed .data, without inventing success`, async () => {
    await differential(async env => {
      env.respond(async () => ({ status, data: { message: `failure-${status}` } }));
      try {
        await env.exported.ModelRuntimeService.getRuntimeNodes('/nodes', {});
        assert.fail('Non-2xx must reject');
      } catch (error) {
        assert.equal(error.status, status);
        assert.deepEqual(error.data, { message: `failure-${status}` });
        return { status: error.status, data: error.data, calls: env.calls };
      }
    });
  });
}

test('POST undefined/null/Headers inputs and circular JSON conversion failure preserve the original transport contract', async () => {
  await differential(async env => {
    env.respond(async () => ({ data: { ok: true } }));
    const service = env.exported.ModelRuntimeService;
    await service.getRuntimeNodes('/default', new Headers({ 'X-One': '1' }));
    await service.getRuntimeNodes('/null', undefined, null);
    const cyclic = {};
    cyclic.self = cyclic;
    await service.getRuntimeNodes('/cyclic', {}, cyclic);
    return { calls: env.calls, logs: env.logs };
  }, result => {
    assert.equal(result.calls[0].body, '{}');
    assert.equal(result.calls[1].body, '');
    assert.equal(result.calls[2].body, '');
    assert.equal(result.logs.length, 1);
  });
});

test('network and JSON decoding exceptions retain identity and do not become data', async () => {
  await differential(async env => {
    const service = env.exported.ModelRuntimeService;
    const network = new Error('network-fixture');
    env.respond(async () => { throw network; });
    await assert.rejects(service.getRuntimeNodes('/offline', {}), error => error === network);
    const parseError = new SyntaxError('invalid-json-fixture');
    env.respond(async () => ({ status: 200, jsonError: parseError }));
    await assert.rejects(service.getRuntimeNodes('/json', {}), error => error === parseError);
    return env.calls;
  });
});

test('itemType special-case, case conversion and actual configuration GET URL parity', async () => {
  await differential(async env => {
    const service = env.exported.ModelRuntimeService;
    env.respond(async () => ({ data: docsFixture }));
    const types = ['PSSYSAPP', 'pssysapp', 'PSDE', 'psappview', '', 'METHOD'];
    const names = types.map(type => service.itemType(type));
    const config = await service.getConfig('/docs', 'PSSYSAPP');
    return { names, config, calls: env.calls };
  }, result => {
    assert.deepEqual(result.names, ['IPSAPPLICATION', 'IPSSYSAPP', 'IPSDE', 'IPSAPPVIEW', 'I', 'IMETHOD']);
    assert.equal(result.calls[0].url, '/docs/IPSAPPLICATION.json');
    assert.equal(result.calls[0].method, 'GET');
  });
});

test('known original config status omission is measured: JSON from a 404 is still returned', async t => {
  t.diagnostic(JSON.stringify(knownOriginalIssues.find(item => item.id === 'config-http-status-unchecked')));
  await differential(async env => {
    env.respond(async () => ({ status: 404, data: { message: 'missing-config' } }));
    return env.exported.ModelRuntimeService.getConfig('/docs', 'PSDE');
  }, value => assert.deepEqual(value, { message: 'missing-config' }));
});

test('formatting preserves raw input, flags, names, matched API docs and synthetic documentation-only methods', async () => {
  await differential(async env => {
    const controller = controllerFixture(env);
    const input = [
      rawNode('METHOD@open@PSSYSAPP', 'openChild#Child branch ==> child-value', 0),
      rawNode('VALUE@label', 'Label ==> label-value'),
      rawNode('VALUE@plain', 'Plain value'),
      rawNode('VALUE@unknown', 'Unknown leaf', undefined),
    ];
    const before = structuredClone(input);
    const formatted = await controller.formatItems(input);
    assert.deepEqual(input, before, 'Raw source must not be mutated');
    assert.deepEqual(docsFixture, {
      'openChild()': { description: 'Open a child model', return: 'net.example.Child' },
      'onlyDocumentation()': { description: 'Documentation-only operation', return: 'java.util.List<net.example.Doc>' },
    });
    return { formatted, calls: env.calls };
  }, result => {
    assert.equal(result.formatted.length, 5);
    assert.equal(result.formatted[0].leaf, false);
    assert.equal(result.formatted[0].data.apiReturn, 'Child');
    assert.equal(result.formatted[1].data.logicName, 'Label');
    assert.equal(result.formatted[1].data.val, 'label-value');
    assert.equal(result.formatted[2].data.logicName, 'Plain value');
    assert.equal(result.formatted[4].isApi, true);
    assert.equal(result.formatted[4].data.apiReturn, 'List<Doc>');
  });
});

for (const kind of ['object', 'string', 'invalid-string', 'rejected']) {
  test(`formatting with ${kind} config faithfully enriches or reports the original failure`, async () => {
    await differential(async env => {
      const controller = controllerFixture(env);
      env.respond(async () => {
        if (kind === 'rejected') throw new Error('config-network-failure');
        return { data: kind === 'object' ? docsFixture : kind === 'string' ? JSON.stringify(docsFixture) : '{invalid' };
      });
      const formatted = await controller.formatItems([
        rawNode('METHOD@open@PSSYSAPP', 'openChild#Child branch ==> child-value', 0),
      ]);
      return { formatted, logs: env.logs };
    }, result => {
      if (['object', 'string'].includes(kind)) assert.equal(result.formatted.length, 2);
      else {
        assert.equal(result.formatted.length, 1);
        assert.equal(result.logs.length, 1);
        assert.equal(result.logs[0].level, 'error');
      }
    });
  });
}

test('empty formatting never fetches configuration and return type shortening matches generics/wildcards', async () => {
  await differential(async env => {
    const controller = controllerFixture(env);
    const empty = await controller.formatItems();
    const returns = ['', 'net.example.Widget', 'java.util.List<net.example.Widget>', 'java.util.List<?>',
      'java.util.Map<java.lang.String,net.example.Widget>', 'void']
      .map(value => controller.getMethodReturn(value));
    return { empty, returns, calls: env.calls };
  }, result => {
    assert.deepEqual(plain(result.empty), []);
    assert.deepEqual(result.returns, ['', 'Widget', 'List<Widget>', 'List<?>', 'Map<Widget>', 'void']);
    assert.equal(result.calls.length, 0);
  });
});

test('cache set/get deep clone isolates nested objects, arrays, dates, regex and typed arrays', async () => {
  await differential(env => {
    const controller = new env.exported.ModelRuntimeController();
    const input = [{ nested: { values: [1, 2] }, date: new Date('2026-10-06T00:00:00Z'),
      regexp: /alpha/gi, buffer: new Uint8Array([2, 4]) }];
    controller.setCache('cache-one', input);
    input[0].nested.values[0] = 99;
    input[0].buffer[0] = 99;
    const first = controller.getCache('cache-one');
    assert.equal(first[0].nested.values[0], 1);
    assert.equal(first[0].buffer[0], 2);
    first[0].nested.values.push(3);
    first[0].date.setUTCFullYear(1999);
    const second = controller.getCache('cache-one');
    assert.deepEqual(plain(second[0].nested.values), [1, 2]);
    assert.equal(second[0].date.getUTCFullYear(), 2026);
    assert.notEqual(first, second);
    assert.notEqual(first[0], second[0]);
    controller.clearCache();
    return { missing: controller.getCache('missing'), cleared: controller.getCache('cache-one'),
      date: second[0].date.toISOString(), regexp: String(second[0].regexp), bytes: [...second[0].buffer] };
  });
});

test('root load performs both real service POSTs, context propagation, active selection and loading lifecycle', async () => {
  await differential(async env => {
    const controller = controllerFixture(env);
    controller.setCache('obsolete', [{ id: 'old' }]);
    await controller.loadRootData({ srfparentkey: 'parent-one', tenant: 'tenant-one' });
    env.timer.advance();
    return { data: controller.data, calls: env.calls, cacheKeys: [...controller.historyCache.keys()],
      rootLoading: env.refs.get('rootLoadingPanel').visible,
      loading: env.refs.get('loadingPanel').visible, mask: env.refs.get('rootLoadingMask').visible };
  }, result => {
    assert.equal(result.data.loaded, true);
    assert.equal(result.data.list.length, 1);
    assert.equal(result.data.activeList[0].id, 'PSSYSAPP@ROOT');
    assert.equal(result.data.list[0].length, childrenFixture.length + 1);
    assert.equal(JSON.parse(result.calls[0].body).srfkey, '#');
    assert.equal(JSON.parse(result.calls[1].body).srfkey, 'PSSYSAPP@ROOT');
    assert.equal(JSON.parse(result.calls[1].body).tenant, 'tenant-one');
    assert.equal(result.rootLoading, false);
    assert.equal(result.loading, false);
    assert.equal(result.mask, false);
  });
});

test('known original response-shadow cache bug is preserved and separately diagnosed', async t => {
  t.diagnostic(JSON.stringify(knownOriginalIssues.find(item => item.id === 'response-shadows-cache-key')));
  await differential(async env => {
    const controller = controllerFixture(env);
    await controller.load({ id: 'requested-node' });
    env.timer.advance();
    return { requested: controller.getCache('requested-node'), keys: [...controller.historyCache.keys()],
      responseCached: Boolean(controller.getCache(undefined)) };
  }, result => {
    assert.equal(result.requested, null);
    assert.deepEqual(result.keys, [undefined]);
    assert.equal(result.responseCached, true);
  });
});

test('cached child load trims lists/active path and publishes a detached cached column without HTTP', async () => {
  await differential(async env => {
    const controller = controllerFixture(env);
    controller.data.list = [[{ id: 'root' }], [{ id: 'discard-one' }], [{ id: 'discard-two' }]];
    controller.data.activeList = [{ id: 'root' }, { id: 'discard-one' }, { id: 'discard-two' }];
    const cache = [{ id: 'cached-child', nested: { value: 1 } }];
    controller.setCache('child', cache);
    let changes = 0;
    controller.store.on('list', () => changes++);
    await controller.loadChildren(0, { id: 'child' });
    controller.data.list[1][0].nested.value = 2;
    controller.setActiveItem({ id: 'child' });
    return { list: controller.data.list, active: controller.data.activeList,
      cache: controller.getCache('child'), changes, calls: env.calls };
  }, result => {
    assert.equal(result.list.length, 2);
    assert.equal(result.cache[0].nested.value, 1);
    assert.equal(result.changes, 1);
    assert.equal(result.calls.length, 0);
  });
});

test('uncached child load promises expose original early completion, then publish only after network resolution', async t => {
  t.diagnostic(JSON.stringify(knownOriginalIssues.find(item => item.id === 'children-promise-does-not-wait')));
  await differential(async env => {
    const controller = controllerFixture(env);
    let release;
    env.respond(() => new Promise(done => { release = done; }));
    await controller.loadChildren(0, { id: 'uncached' });
    const before = controller.data.list.length;
    release({ data: [rawNode('VALUE@child', 'Delayed child')] });
    await settle();
    env.timer.advance();
    return { before, after: controller.data.list, calls: env.calls,
      loading: env.refs.get('loadingPanel').visible };
  }, result => {
    assert.equal(result.before, 0);
    assert.equal(result.after.length, 1);
    assert.equal(result.after[0][0].text, 'Delayed child');
  });
});

for (const status of [401, 403, 500, 504]) {
  test(`root error ${status} releases loading and preserves error-message behavior`, async () => {
    await differential(async env => {
      const controller = controllerFixture(env);
      env.respond(async () => ({ status, data: { message: 'fixture-failure' } }));
      await controller.loadRootData();
      env.timer.advance();
      return { loaded: controller.data.loaded, error: controller.data.errorMessage,
        visible: env.refs.get('rootLoadingPanel').visible, calls: env.calls };
    }, result => {
      assert.equal(result.loaded, true);
      assert.equal(result.visible, false);
      assert.equal(result.error, status === 401 ? null : status === 504 ? '模型加载超时，请稍后再试!' : 'fixture-failure');
    });
  });
}

test('known original empty root logs failure and leaves loaded=false; no silent acceptance', async t => {
  t.diagnostic(JSON.stringify(knownOriginalIssues.find(item => item.id === 'empty-root-never-loaded')));
  await differential(async env => {
    const controller = controllerFixture(env);
    env.respond(async () => ({ data: [] }));
    await controller.loadRootData();
    return { data: controller.data, logs: env.logs, visible: env.refs.get('rootLoadingPanel').visible };
  }, result => {
    assert.equal(result.data.loaded, false);
    assert.equal(result.logs[0].level, 'error');
    assert.equal(result.visible, false);
  });
});

test('search wildcard/case behavior and invalid regex failures match without masking original limitations', async t => {
  t.diagnostic(JSON.stringify(knownOriginalIssues.find(item => item.id === 'unescaped-search-expression')));
  await differential(env => {
    const controller = new env.exported.ModelRuntimeController();
    controller.searchValue = 'foo*bar';
    const matches = ['FOO___BAR', 'foo___bar', 'OTHER'].map(value => controller.isSearchContent(value));
    assert.throws(() => { controller.searchValue = '['; }, { name: 'SyntaxError' });
    return { matches, value: controller.searchValue, expression: String(controller.searchReg) };
  }, result => assert.deepEqual(result.matches, [true, false, false]));
});

test('store subscriptions, off, forced notifications, reset and dispose use actual business classes', async () => {
  await differential(env => {
    const store = new env.exported.QXStore({ count: 0, name: 'initial' });
    const changes = [];
    const subscriber = value => changes.push(value);
    store.on('count', subscriber);
    store.data.count = 1;
    store.forceUpdate('count');
    store.off(subscriber);
    store.data.count = 2;
    store.on('count', subscriber);
    store.reset();
    store.dispose();
    store.data.count = 3;
    return { changes, count: store.data.count, events: store.evtCache.size };
  }, result => {
    assert.deepEqual(result.changes, [1, 1, 0, 0]);
    assert.equal(result.events, 0);
  });
});

test('list watch clones source; original pagination is measured, not corrected by the test', async t => {
  t.diagnostic(JSON.stringify(knownOriginalIssues.find(item => item.id === 'pagination-delete-count')));
  await differential(env => {
    const list = env.instance('IBizModelRuntimeList');
    list.items = Array.from({ length: 90 }, (_, index) =>
      ({ id: `node-${index}`, leaf: true, data: { logicName: `Value ${index}` } }));
    list.componentWillLoad();
    const initial = list.showList.length;
    list.load();
    const second = list.showList.length;
    list.load();
    list.load();
    const final = list.showList.length;
    const exhausted = list.isLoadMore;
    list.list[0].data.logicName = 'detached';
    assert.equal(list.items[0].data.logicName, 'Value 0');
    list.items = [{ id: 'replacement', data: { logicName: 'Replacement' } }];
    list.watchItems();
    return { initial, second, final, exhausted, replacement: list.showList };
  }, result => {
    assert.equal(result.initial, 30);
    assert.equal(result.second, 70);
    assert.equal(result.final, 90);
    assert.equal(result.exhausted, false);
    assert.equal(result.replacement[0].id, 'replacement');
  });
});

test('list debounce/search tests all enriched fields and retains active rows; no native host substitution', async () => {
  await differential(env => {
    const list = env.instance('IBizModelRuntimeList');
    list.items = [
      { id: 'logic', data: { logicName: 'Alpha' } }, { id: 'method', data: { methodName: 'AlphaMethod' } },
      { id: 'value', data: { val: 'alpha-value' } }, { id: 'api', data: { apiMethod: 'AlphaApi()' } },
      { id: 'description', data: { apiDescription: 'Alpha docs' } }, { id: 'other', data: { logicName: 'other' } },
    ];
    list.componentWillLoad();
    list.activeData = list.list.at(-1);
    list.setSearchValue({ target: { value: 'ignored' } });
    list.setSearchValue({ target: { value: ' alpha* ' } });
    env.timer.advance(299);
    const before = list.$searchValue;
    env.timer.advance(1);
    return { before, search: list.$searchValue, ids: list.showList.map(item => item.id),
      regexp: String(list.searchReg), timers: env.timer.pending };
  }, result => {
    assert.equal(result.before, '');
    assert.equal(result.search, 'alpha*');
    assert.equal(result.ids.length, 6);
    assert.equal(result.timers, 0);
  });
});

test('list row selection and refresh call the real controller and preserve active path/cache semantics', async () => {
  await differential(async env => {
    const controller = controllerFixture(env);
    await controller.loadRootData();
    const list = env.instance('IBizModelRuntimeList');
    list.controller = controller;
    list.items = controller.data.list[0];
    list.index = 0;
    list.parent = controller.data.rootData;
    list.componentWillLoad();
    let stopped = 0;
    const event = { stopPropagation: () => stopped++ };
    const child = list.list.find(item => !item.leaf);
    list.rowSelect(event, child);
    await settle();
    const afterSelection = plain(controller.data.activeList);
    const requests = env.calls.length;
    list.rowSelect(event, child);
    list.rowSelect(event, list.list.find(item => item.leaf));
    assert.equal(env.calls.length, requests, 'Duplicate or leaf selection must not load again');
    list.refresh();
    await settle();
    env.timer.advance();
    return { stopped, afterSelection, data: controller.data, active: list.activeData, calls: env.calls };
  }, result => {
    assert.equal(result.stopped, 3);
    assert.equal(result.afterSelection.length, 2);
    assert.equal(result.data.activeList.length, 1);
    assert.deepEqual(plain(result.active), {});
  });
});

test('parentKey watcher, root context and breadcrumb geometry execute real component/controller methods', async () => {
  await differential(async env => {
    const runtime = env.instance('IBizModelRuntime');
    runtime.url = '/fixture/nodes';
    runtime.headers = {};
    runtime.configBaseUrl = '/fixture/config';
    controllerFixture(env);
    runtime.parentKey = 'parent-watch';
    runtime.componentDidLoad();
    await settle();
    env.timer.advance();
    const firstCalls = env.calls.length;
    runtime.watchParentKey('parent-watch', 'parent-watch');
    assert.equal(env.calls.length, firstCalls);
    runtime.parentKey = 'next-parent';
    runtime.watchParentKey('next-parent', 'parent-watch');
    await settle();
    env.timer.advance();
    runtime.contentContainer = { offsetWidth: 400, scrollWidth: 1600, scrollLeft: 0 };
    runtime.changePosition(2);
    env.timer.advance(20);
    runtime.breadcrumbMouseEnter(2);
    const hover = runtime.breadcrumbHoverIndex;
    runtime.breadcrumbMouseLeave();
    return { calls: env.calls, hover, left: runtime.contentContainer.scrollLeft,
      hoverAfter: runtime.breadcrumbHoverIndex, breadcrumb: runtime.isShowBreadcrumb() };
  }, result => {
    assert.equal(result.hover, 2);
    assert.equal(result.hoverAfter, -1);
    assert.equal(result.left, 800);
    assert.equal(result.breadcrumb, true);
  });
});

test('LoadingController nesting/deferred hides and both actual loading components retain public method behavior', async () => {
  await differential(async env => {
    const loading = new env.exported.LoadingController();
    loading.show('first');
    loading.show('nested');
    const shown = {
      count: loading.loadingCount, loading: loading.isLoading,
      panel: env.refs.get('loadingPanel').visible, mask: env.refs.get('rootLoadingMask').visible,
      message: env.refs.get('loadingPanel').message,
    };
    loading.hide();
    const deferred = loading.loadingCount;
    env.timer.advance();
    const nested = loading.isLoading;
    loading.hide();
    env.timer.advance();
    const panel = env.instance('LoadingPanel');
    panel.defaultShow = true;
    panel.componentDidLoad();
    const defaultVisible = panel.visible;
    await panel.show('working');
    const message = panel.message;
    await panel.hide();
    const mask = env.instance('LoadingMask');
    await mask.show();
    const maskVisible = mask.visible;
    await mask.hide();
    return { shown, deferred, nested, final: loading.isLoading, count: loading.loadingCount,
      defaultVisible, message, hiddenMessage: panel.message, panelVisible: panel.visible,
      maskVisible, maskHidden: mask.visible };
  }, result => {
    assert.equal(result.shown.count, 2);
    assert.equal(result.shown.message, 'first');
    assert.equal(result.deferred, 2);
    assert.equal(result.nested, true);
    assert.equal(result.final, false);
    assert.equal(result.count, 0);
    assert.equal(result.defaultVisible, true);
    assert.equal(result.hiddenMessage, 'Loading...');
    assert.equal(result.panelVisible, false);
    assert.equal(result.maskHidden, false);
  });
});
