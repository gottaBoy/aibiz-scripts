import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { workspace } from '../localization-baseline.mjs';

const require = createRequire(join(workspace, 'modelingweb/app/package.json'));
const ts = require('typescript');
const vue = require('vue');
const sources = [
  ['hub', 'ibiz-app-hub/components/ibiz-next-vue3/src/web-app/components/router-shell/router-shell.tsx',
    'ibiz-app-hub/packages/vue3-util/src'],
  ['active', 'modelingweb/packages-latest/@ibiz-template/vue3-components/src/web-app/components/router-shell/router-shell.tsx',
    'modelingweb/packages-latest/@ibiz-template/vue3-util/src'],
];
const digest = value => createHash('sha256').update(value).digest('hex');
const plain = value => JSON.parse(JSON.stringify(value));
const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const routeData = (root = 'root-a', first = 'modelingindex', second = 'moduleview') => {
  const fullPath = `/psdevslnsys=${root}/${first}/-/${second}/-`;
  return {
    path: fullPath,
    fullPath,
    matched: [{}, {}],
    params: { appContext: `psdevslnsys=${root}`, view1: first, params1: '-',
      view2: second, params2: '-' },
  };
};

function fixture(t, source, utilSource, { depth = 1, actualParser = false } = {}) {
  const inputs = new Map();
  const compile = relative => {
    const path = join(workspace, relative);
    const bytes = fs.readFileSync(path);
    inputs.set(path, digest(bytes));
    return ts.transpileModule(bytes.toString('utf8'), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
        esModuleInterop: true,
        jsx: ts.JsxEmit.React,
        jsxFactory: 'h',
      },
    }).outputText;
  };
  const parseRequests = [];
  const modelRequests = [];
  const created = [];
  const destroyed = [];
  const navigations = [];
  const errors = [];
  const unmounted = [];
  let token = 'controlled-token-a';
  const route = vue.reactive(routeData());
  const runtime = {
    env: { routePlaceholder: '-' },
    appData: { context: { srfuserid: 'account-a' },
      srfmodelcontext: { psdevslnsys: 'root-a', pssystemid: 'logical-a' } },
    auth: { getAuthInfo: () => ({ token }) },
    hub: { config: { view: { get: name => {
      const request = { name, ...deferred() };
      modelRequests.push(request);
      return request.promise;
    } } } },
    i18n: { t: key => key },
    util: { error: { handle: error => errors.push(error) } },
  };
  const core = {
    RuntimeError: class RuntimeError extends Error {},
    IBizContext: { create: context => {
      const value = { ...context, destroy: () => destroyed.push(value) };
      created.push(value);
      return value;
    } },
  };
  const evaluate = (relative, dependencies) => {
    const exports = {};
    vm.runInNewContext(compile(relative), {
      exports, ibiz: runtime,
      require: name => Object.prototype.hasOwnProperty.call(dependencies, name)
        ? dependencies[name] : require(name),
    }, { filename: relative });
    return exports;
  };
  const helper = evaluate(`${utilSource}/util/route/model-context.ts`, {
    '@ibiz-template/core': core,
  });
  const constants = evaluate(
    'modelingweb/packages-latest/@ibiz-template/runtime/src/constant/view-type.ts', {},
  );
  const runtimeModule = {
    ...constants,
    RouteConst: { ROUTE_MODAL_TAG: 'modal' },
    ViewMode: { ROUTE: 'ROUTE' },
    Modal: class Modal { constructor(options) { Object.assign(this, options); } },
  };
  let parseRouteViewData = (_route, routeDepth) => {
    const request = { route: plain(_route), depth: routeDepth, ...deferred() };
    parseRequests.push(request);
    return request.promise;
  };
  if (actualParser) {
    parseRouteViewData = evaluate(`${utilSource}/util/route/route.ts`, {
      '@ibiz-template/core': core,
      '@ibiz-template/runtime': runtimeModule,
      './model-context': helper,
    }).parseRouteViewData;
  }
  const component = evaluate(source, {
    vue: { ...vue, onUnmounted: callback => unmounted.push(callback),
      onActivated: () => {}, onDeactivated: () => {} },
    'vue-router': { useRoute: () => route,
      useRouter: () => ({ push: value => { navigations.push(value); return Promise.resolve(); } }) },
    '@ibiz-template/vue3-util': { ...helper, parseRouteViewData },
    '@ibiz-template/runtime': runtimeModule,
    '@ibiz-template/core': core,
  }).RouterShell;
  const scope = vue.effectScope();
  const state = scope.run(() => component.setup({ modal: { routeDepth: depth } }));
  let disposed = false;
  const unmount = () => {
    if (disposed) return;
    disposed = true;
    unmounted.forEach(callback => callback());
    scope.stop();
  };
  t.after(() => {
    unmount();
    for (const [path, sha256] of inputs) assert.equal(digest(fs.readFileSync(path)), sha256);
  });
  const flush = async () => {
    await vue.nextTick();
    await new Promise(resolve => setImmediate(resolve));
    await vue.nextTick();
  };
  const succeed = async (index, root = `root-${index === 0 ? 'a' : 'b'}`) => {
    parseRequests[index].resolve({
      context: { psdevslnsys: root },
      viewConfig: { id: `modeldesign.${root}`, codeName: root },
    });
    await flush();
  };
  const switchRoute = async value => {
    Object.assign(route, value);
    await flush();
  };
  return {
    state, route, runtime, created, destroyed, errors, navigations, parseRequests, modelRequests,
    ModelContextError: helper.ModelContextError, unmount, flush, succeed, switchRoute,
    setToken: value => { token = value; },
  };
}

for (const [name, source, utilSource] of sources) {
  test(`${name}: the actual shell publishes a context only after its own lookup resolves`, async t => {
    const f = fixture(t, source, utilSource);
    assert.equal(f.state.isLoaded.value, false);
    assert.deepEqual(plain(f.state.viewData.value), {});
    assert.equal(f.created.length, 0);
    await f.succeed(0);
    assert.equal(f.state.isLoaded.value, true);
    assert.equal(f.state.viewData.value.context.psdevslnsys, 'root-a');
    assert.equal(f.created.length, 1);
    assert.equal(f.destroyed.length, 0);
    assert.deepEqual(f.errors, []);
    assert.deepEqual(f.navigations, []);
  });

  for (const depth of [1, 2]) {
    test(`${name}: depth ${depth} reloads the same view on a root switch and destroys the old context once`, async t => {
      const f = fixture(t, source, utilSource, { depth });
      await f.succeed(0);
      await f.switchRoute(routeData('root-b'));
      assert.equal(f.parseRequests.length, 2);
      assert.equal(f.state.isLoaded.value, false);
      assert.deepEqual(plain(f.state.viewData.value), {});
      assert.deepEqual(f.destroyed, [f.created[0]]);
      await f.succeed(1);
      assert.equal(f.state.viewData.value.context.psdevslnsys, 'root-b');
      f.unmount();
      assert.deepEqual(f.destroyed, f.created);
    });

    test(`${name}: depth ${depth} reloads when its own view changes without changing the root`, async t => {
      const f = fixture(t, source, utilSource, { depth });
      await f.succeed(0);
      await f.switchRoute(routeData('root-a',
        depth === 1 ? 'replacementindex' : 'modelingindex',
        depth === 2 ? 'replacementmodule' : 'moduleview'));
      assert.equal(f.parseRequests.length, 2);
      assert.equal(f.state.isLoaded.value, false);
      assert.deepEqual(f.destroyed, [f.created[0]]);
      await f.succeed(1, 'root-a');
      assert.equal(f.state.isLoaded.value, true);
    });
  }

  test(`${name}: a loaded parent keeps its context during child navigation`, async t => {
    const f = fixture(t, source, utilSource);
    await f.succeed(0);
    await f.switchRoute(routeData('root-a', 'modelingindex', 'anothermodule'));
    assert.equal(f.parseRequests.length, 1);
    assert.equal(f.state.isLoaded.value, true);
    assert.equal(f.created.length, 1);
    assert.deepEqual(f.destroyed, []);
  });

  test(`${name}: child navigation while loading retries the actual route and discards the stale success`, async t => {
    const f = fixture(t, source, utilSource);
    await f.switchRoute(routeData('root-a', 'modelingindex', 'anothermodule'));
    assert.equal(f.parseRequests.length, 2);
    assert.equal(f.parseRequests[1].route.params.view2, 'anothermodule');
    await f.succeed(0);
    assert.equal(f.state.isLoaded.value, false);
    assert.equal(f.created.length, 0);
    await f.succeed(1, 'root-a');
    assert.equal(f.state.isLoaded.value, true);
    assert.equal(f.created.length, 1);
    assert.deepEqual(f.errors, []);
  });

  test(`${name}: an older success cannot replace a newer view or create a leaked context`, async t => {
    const f = fixture(t, source, utilSource);
    await f.switchRoute(routeData('root-b'));
    await f.succeed(1);
    await f.succeed(0);
    assert.equal(f.state.viewData.value.context.psdevslnsys, 'root-b');
    assert.equal(f.created.length, 1);
    assert.deepEqual(f.destroyed, []);
  });

  for (const kind of ['unknown', 'unavailable', 'changed']) {
    test(`${name}: a stale ${kind} failure cannot navigate or report an error over the newer view`, async t => {
      const f = fixture(t, source, utilSource);
      await f.switchRoute(routeData('root-b'));
      await f.succeed(1);
      f.parseRequests[0].reject(kind === 'unknown'
        ? new Error('Controlled old unknown view') : new f.ModelContextError(kind));
      await f.flush();
      assert.equal(f.state.viewData.value.context.psdevslnsys, 'root-b');
      assert.deepEqual(f.errors, []);
      assert.deepEqual(f.navigations, []);
    });

    test(`${name}: unmount discards a pending ${kind} failure without any navigation or visible error`, async t => {
      const f = fixture(t, source, utilSource);
      f.unmount();
      f.parseRequests[0].reject(kind === 'unknown'
        ? new Error('Controlled disposed lookup') : new f.ModelContextError(kind));
      await f.flush();
      assert.equal(f.state.isLoaded.value, false);
      assert.deepEqual(plain(f.state.viewData.value), {});
      assert.equal(f.created.length, 0);
      assert.deepEqual(f.errors, []);
      assert.deepEqual(f.navigations, []);
    });
  }

  test(`${name}: unmount before a late success prevents context creation and stops route watchers`, async t => {
    const f = fixture(t, source, utilSource);
    f.unmount();
    await f.succeed(0);
    await f.switchRoute(routeData('root-b'));
    assert.equal(f.state.isLoaded.value, false);
    assert.equal(f.created.length, 0);
    assert.equal(f.parseRequests.length, 1);
    assert.deepEqual(f.navigations, []);
  });

  test(`${name}: unmount destroys a published context exactly once and clears its render state`, async t => {
    const f = fixture(t, source, utilSource);
    await f.succeed(0);
    f.unmount();
    f.unmount();
    assert.equal(f.state.isLoaded.value, false);
    assert.deepEqual(plain(f.state.viewData.value), {});
    assert.deepEqual(f.destroyed, [f.created[0]]);
  });

  for (const kind of ['unavailable', 'changed']) {
    test(`${name}: an active ${kind} context error uses the normal error mechanism, not a misleading 404`, async t => {
      const f = fixture(t, source, utilSource);
      const error = new f.ModelContextError(kind);
      f.parseRequests[0].reject(error);
      await f.flush();
      assert.equal(f.state.isLoaded.value, false);
      assert.equal(f.created.length, 0);
      assert.deepEqual(f.errors, [error]);
      assert.deepEqual(f.navigations, []);
      await f.switchRoute(routeData('root-b'));
      await f.succeed(1);
      assert.equal(f.state.viewData.value.context.psdevslnsys, 'root-b');
      assert.equal(f.errors.length, 1);
    });
  }

  test(`${name}: an active unknown-view failure preserves the existing 404 route`, async t => {
    const f = fixture(t, source, utilSource, { depth: 2 });
    f.parseRequests[0].reject(new Error('Controlled unknown view'));
    await f.flush();
    assert.deepEqual(plain(f.navigations), [{ name: 'errorView2', params: { code: '404' } }]);
    assert.deepEqual(f.errors, []);
    assert.equal(f.state.isLoaded.value, false);
  });

  test(`${name}: the actual route parser reports invalid model metadata before a model request`, async t => {
    const f = fixture(t, source, utilSource, { actualParser: true });
    f.modelRequests[0].resolve({ id: 'modeldesign.modelingindex' });
    await f.flush();
    f.runtime.appData.srfmodelcontext = { psdevslnsys: 'root-b', pssystemid: '' };
    await f.switchRoute(routeData('root-b'));
    assert.equal(f.modelRequests.length, 1);
    assert.equal(f.state.isLoaded.value, false);
    assert.equal(f.errors.length, 1);
    assert.ok(f.errors[0] instanceof f.ModelContextError);
    assert.equal(f.errors[0].kind, 'unavailable');
    assert.deepEqual(f.navigations, []);
    assert.deepEqual(f.destroyed, [f.created[0]]);
  });

  test(`${name}: the actual route parser exposes an account change during lookup without publishing stale context`, async t => {
    const f = fixture(t, source, utilSource, { actualParser: true });
    f.setToken('controlled-token-b');
    f.modelRequests[0].resolve({ id: 'modeldesign.modelingindex' });
    await f.flush();
    assert.equal(f.state.isLoaded.value, false);
    assert.equal(f.created.length, 0);
    assert.equal(f.errors.length, 1);
    assert.ok(f.errors[0] instanceof f.ModelContextError);
    assert.equal(f.errors[0].kind, 'changed');
    assert.deepEqual(f.navigations, []);
  });

  test(`${name}: a shell with no route depth does not initiate a view lookup`, async t => {
    const f = fixture(t, source, utilSource, { depth: 0 });
    await f.flush();
    assert.equal(f.parseRequests.length, 0);
    assert.equal(f.state.isLoaded.value, false);
    assert.equal(f.created.length, 0);
  });
}
