import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { rewriteCentralSchemeFetch } from '../prepare-native-service-candidate.mjs';
import {
  centralNavigationSelectors,
  captureNativeLogin,
  expectedAuthenticationEvent,
  inspectCentralNavigationRendering,
  inspectCentralNavigationRequest,
  inspectCentralNavigationResponse,
  inspectCentralNavigationService,
  inspectNativeAppModel,
  inspectNativeLoginResponse,
  inspectNativeThemeReferences,
  matchesCentralNavigationRequest,
  summarizeNativeBrowserReport,
  verifyCentralNavigation,
  verifyNativeLogin,
} from '../../modelingweb/app/tests/native-model-contract.mjs';

const modelRoot = new URL(
  '../../vendor-upstream/ibizmodeling-standard/modelapi-core/src/main/resources/model/net/ibizsys/modeling/',
  import.meta.url,
);
const appRequire = createRequire(new URL('../../modelingweb/app/package.json', import.meta.url));
const ts = appRequire('typescript');

const loginOptions = { entry: 'http://127.0.0.1:32008/central/', applicationId: 'ibizmodeling__central' };
const loginEvent = {
  origin: 'http://127.0.0.1:32008', path: '/api/ibizmodeling__central/v7/login',
  method: 'POST', status: 200, contentType: 'application/json;charset=UTF-8',
  body: JSON.stringify({ token: 'fixture-secret-token' }),
};

test('native login requires the exact application response and never exposes its token', () => {
  const evidence = inspectNativeLoginResponse(loginEvent, loginOptions);
  assert.equal(evidence.tokenIssued, true);
  assert.equal(JSON.stringify(evidence).includes('fixture-secret-token'), false);
  for (const change of [
    { origin: 'http://other.test' }, { path: '/api/ibizmodeling__modeldesign/v7/login' },
    { method: 'GET' }, { status: 204 }, { status: 401 }, { status: 500 },
    { contentType: 'text/html' }, { body: 'broken' },
  ]) {
    assert.throws(() => inspectNativeLoginResponse({ ...loginEvent, ...change }, loginOptions), /Native login/);
  }
  for (const payload of [null, [], {}, { token: null }, { token: true }, { token: 123 },
    { token: '' }, { token: ' ' }, { token: ' token' }, { token: 'token ' },
    { token: 'token\nvalue' }, { token: 'token\u0000value' }, { data: { token: 'nested' } }]) {
    assert.throws(() => inspectNativeLoginResponse({
      ...loginEvent, body: JSON.stringify(payload),
    }, loginOptions), /valid token/);
  }
});

function loginFixture({ event = loginEvent, persisted = true } = {}) {
  const response = {
    url: () => `${event.origin}${event.path}`,
    request: () => ({ method: () => event.method }),
    status: () => event.status,
    headers: () => ({ 'content-type': event.contentType }),
    text: async () => event.body,
  };
  let checks = 0;
  return {
    response, checks: () => checks,
    page: {
      async evaluate(fn, expected) {
        checks += 1;
        assert.equal(expected, 'fixture-secret-token');
        const window = {
          ibiz: { env: { appId: 'ibizmodeling__central' } },
          System: { async import(name) {
            assert.equal(name, '@ibiz-template/core');
            return { getToken: () => persisted ? expected : 'stale-token' };
          } },
        };
        return await runInNewContext(`(${fn})(expected)`, { window, expected });
      },
    },
  };
}

test('native login also requires the actual front-end token persistence', async () => {
  const fixture = loginFixture();
  const evidence = await verifyNativeLogin(fixture.page, fixture.response, loginOptions);
  assert.equal(evidence.tokenPersisted, true);
  assert.equal(fixture.checks(), 1);
  assert.equal(JSON.stringify(evidence).includes('fixture-secret-token'), false);
  const stale = loginFixture({ persisted: false });
  await assert.rejects(verifyNativeLogin(stale.page, stale.response, { ...loginOptions, timeout: 5 }),
    /persistence timed out/);
  const invalid = loginFixture({ event: { ...loginEvent, body: '{}' } });
  await assert.rejects(verifyNativeLogin(invalid.page, invalid.response, loginOptions), /valid token/);
  assert.equal(invalid.checks(), 0);
});

test('native login token polling does not import the core before the refreshed runtime exists', async () => {
  const fixture = loginFixture();
  let earlyImports = 0;
  fixture.page.evaluate = async (fn, expected) => {
    for (const window of [{}, { System: { import: () => { earlyImports += 1; } } }]) {
      assert.equal(await runInNewContext(`(${fn})(expected)`, { window, expected }), false);
    }
    const window = {
      ibiz: {}, System: { import: async () => ({ getToken: () => expected }) },
    };
    assert.equal(await runInNewContext(`(${fn})(expected)`, { window, expected }), true);
    return true;
  };
  const evidence = await verifyNativeLogin(fixture.page, fixture.response, loginOptions);
  assert.equal(earlyImports, 0);
  assert.equal(evidence.tokenPersisted, true);
});

test('native login retries real false values and transient reload errors, not truthy objects', async () => {
  const fixture = loginFixture();
  const results = [false, { value: false }, new Error('Execution context was destroyed'), true];
  fixture.page.evaluate = async () => {
    const value = results.shift();
    if (value instanceof Error) throw value;
    return value;
  };
  const evidence = await verifyNativeLogin(fixture.page, fixture.response, loginOptions);
  assert.equal(evidence.tokenPersisted, true);
  assert.deepEqual(results, []);
});

test('native login bounds stalled imports and sanitizes unexpected browser errors', async () => {
  const fixture = loginFixture();
  fixture.page.evaluate = () => new Promise(() => {});
  await assert.rejects(verifyNativeLogin(fixture.page, fixture.response, { ...loginOptions, timeout: 5 }),
    /persistence timed out/);
  fixture.page.evaluate = async () => { throw new Error('fixture-secret-token'); };
  await assert.rejects(verifyNativeLogin(fixture.page, fixture.response, loginOptions), error =>
    error.message === 'Native login token verification failed' &&
    !error.stack.includes('fixture-secret-token'));
});

function captureLoginFixture({ event = loginEvent, fetchError, fulfillError, noResponse = false } = {}) {
  const fixture = loginFixture();
  let reads = 0;
  let reloaded = false;
  let registration;
  let removed = false;
  const request = { url: () => `${event.origin}${event.path}`, method: () => event.method };
  const route = {
    request: () => request,
    async fetch(options) {
      assert.equal(options.maxRedirects, 0);
      assert.ok(options.timeout > 0);
      if (fetchError) throw fetchError;
      return {
        status: () => event.status, headers: () => ({ 'content-type': event.contentType }),
        async body() {
          assert.equal(reloaded, false, 'Upstream body must be captured before forwarding');
          reads += 1;
          return Buffer.from(event.body);
        },
      };
    },
    async fulfill({ response, body }) {
      if (fulfillError) throw fulfillError;
      assert.equal(reads, 1);
      assert.equal(response.status(), event.status);
      assert.equal(body.toString(), event.body, 'Forwarded bytes must be unchanged');
      reloaded = true;
    },
    async continue() { assert.equal(request.method(), 'GET'); },
    async abort() { reloaded = false; },
  };
  return {
    page: { ...fixture.page,
      async route(matches, handler) {
        assert.equal(matches(new URL(request.url())), true);
        assert.equal(matches(new URL('http://other.test' + loginEvent.path)), false);
        assert.equal(matches(new URL(loginOptions.entry + 'other')), false);
        registration = { matches, handler };
      },
      async unroute(matches, handler) {
        assert.deepEqual({ matches, handler }, registration);
        removed = true;
      },
    },
    async submit() {
      assert.ok(registration, 'Capture must be registered before the button click');
      if (!noResponse) await registration.handler(route);
    },
    reads: () => reads, reloaded: () => reloaded, removed: () => removed,
  };
}

test('native login captures actual upstream bytes before forwarding the reload-triggering response', async () => {
  const fixture = captureLoginFixture();
  const evidence = await captureNativeLogin(fixture.page, loginOptions, fixture.submit);
  assert.equal(fixture.reads(), 1);
  assert.equal(fixture.reloaded(), true);
  assert.equal(fixture.removed(), true);
  assert.equal(evidence.tokenPersisted, true);
  assert.equal(JSON.stringify(evidence).includes('fixture-secret-token'), false);
});

test('native login capture rejects invalid upstream replies and removes its handler', async () => {
  for (const event of [
    { ...loginEvent, status: 401 }, { ...loginEvent, status: 302 },
    { ...loginEvent, contentType: 'text/html' }, { ...loginEvent, body: '{}' },
  ]) {
    const fixture = captureLoginFixture({ event });
    await assert.rejects(captureNativeLogin(fixture.page, loginOptions, fixture.submit), /Native login/);
    assert.equal(fixture.removed(), true);
    assert.equal(fixture.reads(), 1);
  }
});

test('native login capture cleans up after fetch, fulfillment and submission failures', async () => {
  for (const options of [
    { fetchError: new Error('Upstream failed') }, { fulfillError: new Error('Forwarding failed') },
  ]) {
    const fixture = captureLoginFixture(options);
    await assert.rejects(captureNativeLogin(fixture.page, loginOptions, fixture.submit), /failed/);
    assert.equal(fixture.removed(), true);
  }
  const fixture = captureLoginFixture();
  await assert.rejects(captureNativeLogin(fixture.page, loginOptions, async () => {
    throw new Error('Button click failed');
  }), /Button click failed/);
  assert.equal(fixture.removed(), true);
});

test('native login capture times out missing or non-POST replies without leaving a handler', async () => {
  for (const options of [{ noResponse: true }, { event: { ...loginEvent, method: 'GET' } }]) {
    const fixture = captureLoginFixture(options);
    await assert.rejects(captureNativeLogin(fixture.page, { ...loginOptions, timeout: 5 },
      fixture.submit), /response timed out/);
    assert.equal(fixture.reads(), 0);
    assert.equal(fixture.removed(), true);
  }
  await assert.rejects(captureNativeLogin({}, loginOptions), /submit action/);
});

function evaluateContractModule(path, dependencies, ibiz) {
  const file = new URL(`../../${path}`, import.meta.url);
  const module = { exports: {} };
  const compiled = ts.transpileModule(readFileSync(file, 'utf8'), {
    fileName: fileURLToPath(file),
    compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, allowJs: true,
    },
  }).outputText;
  runInNewContext(compiled, {
    module, exports: module.exports, ibiz,
    require(id) {
      assert.ok(Object.hasOwn(dependencies, id), `Unexpected contract module import: ${id}`);
      return dependencies[id];
    },
  }, { filename: fileURLToPath(file) });
  return module.exports;
}

const modelRequire = createRequire(new URL('../../ibiz-app-hub/models/rt-model-api/package.json',
  import.meta.url));
const { AppDEMethodWriter } = evaluateContractModule(
  'ibiz-app-hub/models/rt-model-api/src/app/dataentity/app-demethod-writer.ts',
  { '../../model-object-writer': modelRequire('./lib/model-object-writer.js') },
);
const compileAppMethod = source => {
  const model = {};
  new AppDEMethodWriter().fillDSL({ s() {}, m() {} }, source, model);
  return model;
};

function fetchRuntimeFixture(directory, extension) {
  const calls = [];
  let localReads = 0;
  class HttpResponse {
    constructor(data, status = 200) {
      this.data = data;
      this.status = status;
    }
  }
  class ModelError extends Error {
    constructor(model, message) {
      super(message);
      this.model = model;
    }
  }
  const core = { HttpResponse, ModelError, RuntimeModelError: ModelError };
  const app = {
    net: Object.fromEntries(['get', 'post'].map(method => [method, async (path, params) => {
      calls.push({ method: method.toUpperCase(), path, params });
      return new HttpResponse([]);
    }])),
  };
  const ibiz = {
    hub: { getApp: () => app },
    i18n: { t: (key, params) => `${key}: ${JSON.stringify(params)}` },
  };
  const { Method } = evaluateContractModule(`${directory}/method${extension}`, {
    '@ibiz-template/core': core,
    '../../../utils': { calcResPath: () => '' },
    './method-input': { MethodInput: class {} },
    './method-renturn': { MethodReturn: class { async format(context, value) { return value; } } },
  }, ibiz);
  // Execute the real fetch dispatch and request logic; isolate DTOs, conditions and networking.
  const { FetchMethod } = evaluateContractModule(`${directory}/fetch${extension}`, {
    '@ibiz-template/core': core,
    'lodash-es': { isArray: Array.isArray },
    'ramda': {
      clone: structuredClone, isEmpty: value => Object.keys(value).length === 0,
      isNil: value => value === undefined || value === null,
    },
    'qx-util': {},
    '../../../utils': {
      DEDQCondUtil: { getCond: () => null },
      SearchFilter: class { constructor() { this.page = 0; this.size = 20; } },
    },
    './method': { Method },
    '../../../../de-logic': { async execFieldLogics() {} },
    '../../../../utils': {
      ScriptFactory: { async asyncExecScriptFn() { assert.fail('DATAQUERY must not execute a script'); } },
    },
  }, ibiz);
  return {
    calls,
    localReads: () => localReads,
    fetch: (method, local = false) => new FetchMethod({
      local: { getList() { localReads += 1; return []; } },
      createEntity: value => value,
    }, { appId: 'central', deapicodeName2: 'psdevslns' }, compileAppMethod(method), local),
  };
}

for (const application of ['Central', 'ModelDesign']) {
  test(`native ${application} contract reads the real index and all exact plugin refs`, () => {
    const model = JSON.parse(readFileSync(
      new URL(`PSSYSAPPS/${application}/PSSYSAPP.json`, modelRoot),
    ));
    const result = inspectNativeAppModel(model, application);
    assert.equal(result.application, application);
    assert.equal(result.modelPath, model.dynaModelFilePath);
    assert.equal(result.indexPath, model.getDefaultPSAppIndexView.path);
    assert.equal(result.plugins.length, application === 'Central' ? 4 : 8);
    assert.ok(result.plugins.every(plugin => plugin.locations.length > 0));
    assert.equal(result.themes.length, application === 'Central' ? 0 : 2);
    const swapped = structuredClone(model);
    swapped.codeName = 'plmweb';
    assert.throws(() => inspectNativeAppModel(swapped, application), /native/);
    const missingIndex = structuredClone(model);
    missingIndex.cache.getPSAppViews = [];
    assert.throws(() => inspectNativeAppModel(missingIndex, application), /cached index/);
    const missingPlugins = structuredClone(model);
    missingPlugins.getAllPSAppPFPluginRefs = [];
    assert.throws(() => inspectNativeAppModel(missingPlugins, application), /plugin references/);
  });
}

test('native theme preflight includes both startup packages and exact source locations', () => {
  const model = JSON.parse(readFileSync(
    new URL('PSSYSAPPS/ModelDesign/PSSYSAPP.json', modelRoot),
  ));
  const themes = inspectNativeThemeReferences(model);
  assert.deepEqual(themes.map(theme => theme.repo).sort(), [
    '@ibiz-template-theme/studio-icon@0.0.3-alpha.68',
    '@ibiz-template-theme/studio-theme@0.0.3-alpha.92',
  ]);
  assert.deepEqual(themes.find(theme => theme.name.endsWith('/studio-theme')).themes,
    [{ tag: 'studio_dark', type: 'COLOR' }]);
  assert.deepEqual(themes.find(theme => theme.name.endsWith('/studio-icon')).themes,
    [{ tag: 'studio_icon', type: 'ICON' }]);
  for (const theme of themes) {
    assert.equal(theme.locations.length, 1);
    assert.match(theme.locations[0], /^\/getAllPSAppUIThemes\/[01]\/themeParams\/theme-package-path$/);
  }
  assert.deepEqual(inspectNativeThemeReferences({}), []);
  const shared = structuredClone(model.getAllPSAppUIThemes[0]);
  shared.themeTag = 'another_theme';
  model.getAllPSAppUIThemes.push(shared);
  const merged = inspectNativeThemeReferences(model).find(theme => theme.name.endsWith('/studio-theme'));
  assert.equal(merged.locations.length, 2);
  assert.equal(merged.themes.length, 2);
});

test('native theme preflight rejects invalid or external packages instead of ignoring them', () => {
  const theme = {
    themeTag: 'fixture', themeParams: { 'theme-package-path': '@aibiz/studio-theme@0.1.0' },
  };
  for (const repo of [undefined, '', null, '@aibiz/studio-theme',
    'https://cdn.example.test/studio-theme', '../studio-theme@0.1.0',
    '@aibiz/studio-theme@0.1.0?fallback=true']) {
    assert.throws(() => inspectNativeThemeReferences({
      getAllPSAppUIThemes: [{ ...theme, themeParams: { 'theme-package-path': repo } }],
    }), /Native theme/);
  }
  for (const themes of [{}, [null], [{ ...theme, themeTag: 'bad tag' }],
    [{ ...theme, themeParams: [] }], [theme, structuredClone(theme)]]) {
    assert.throws(() => inspectNativeThemeReferences({ getAllPSAppUIThemes: themes }), /Native theme/);
  }
  assert.equal(inspectNativeThemeReferences({
    getAllPSAppUIThemes: [{ themeTag: 'fixture', themeUrl: '@aibiz/studio-theme@0.1.0' }],
  })[0].repo, '@aibiz/studio-theme@0.1.0');
});

test('only the narrow unauthenticated appdata/navigation events are expected', () => {
  const appId = 'ibizmodeling__central';
  const response = {
    kind: 'response', authenticated: false, status: 401,
    path: `/api/${appId}/appdata`,
  };
  assert.equal(expectedAuthenticationEvent(response, appId), true);
  assert.equal(expectedAuthenticationEvent({ ...response, authenticated: true }, appId), false);
  assert.equal(expectedAuthenticationEvent({ ...response, status: 404 }, appId), false);
  assert.equal(expectedAuthenticationEvent({ ...response, path: '/plugins/missing/package.json' }, appId), false);
  const console = {
    kind: 'console', authenticated: false,
    text: 'Navigation aborted from "/" to "/-/index/-" via a navigation guard.',
  };
  assert.equal(expectedAuthenticationEvent(console, appId), true);
  assert.equal(expectedAuthenticationEvent({ ...console, authenticated: true }, appId), false);
  assert.equal(expectedAuthenticationEvent({ ...console, text: '模型配置缺失' }, appId), false);
});

test('partial startup never becomes full-flow or successful prerequisite acceptance', () => {
  const applications = {
    Central: { stages: { model: { status: 'PASS' }, home: { status: 'PASS' },
      'plugin-assets': { status: 'FAIL' } } },
    ModelDesign: { stages: { model: { status: 'PASS' }, home: { status: 'FAIL' },
      'plugin-assets': { status: 'FAIL' } } },
  };
  const verdict = summarizeNativeBrowserReport(applications);
  assert.equal(verdict.prerequisiteChecksPassed, false);
  assert.equal(verdict.centralStartupVerified, true);
  assert.equal(verdict.modelDesignStartupVerified, false);
  assert.equal(verdict.pluginAssetsVerified, false);
  assert.equal(verdict.failures, 3);
  assert.deepEqual(verdict.remainingAcceptance,
    ['native editor operations', 'model save', 'fresh-session model readback']);
  assert.equal('fullFlowVerified' in verdict, false);
  assert.equal(summarizeNativeBrowserReport({}).prerequisiteChecksPassed, false);
  assert.equal(summarizeNativeBrowserReport({
    Central: { stages: { home: { status: 'PASS' } } },
  }).prerequisiteChecksPassed, false);
});

const centralEntry = 'http://127.0.0.1:32008/central/';
const centralEntity = JSON.parse(readFileSync(new URL(
  'PSSYSAPPS/Central/PSAPPDATAENTITIES/PSDevSln.json', modelRoot,
)));
const centralView = JSON.parse(readFileSync(new URL(
  'PSSYSAPPS/Central/PSAPPDEVIEWS/PSDevSlnGridView.json', modelRoot,
)));
const centralService = JSON.parse(readFileSync(new URL('PSSYSSERVICEAPIS/ModelAPI.json', modelRoot)));
const gridFetch = view => view.getPSControls.find(control =>
  control.controlType === 'GRID' && control.name === 'grid').getFetchPSControlAction;
const handlerFetch = view => view.getPSControls.find(control =>
  control.controlType === 'GRID' && control.name === 'grid')
  .getPSControlHandler.getPSHandlerActions.find(action => action.name === 'fetch');
const selectedMethod = entity => entity.getAllPSAppDEMethods.find(method =>
  method.codeName === 'FetchCurDCSLNUser');
const backendEntity = JSON.parse(readFileSync(new URL(
  'PSMODULES/SysDesign/PSDATAENTITIES/PSDevSln.json', modelRoot,
)));
const overlayView = rewriteCentralSchemeFetch({
  view: centralView, entity: centralEntity, service: centralService, backendEntity,
});
const expectedRequest = inspectCentralNavigationRequest(centralEntity, centralEntry, overlayView);
const datasetEvent = body => ({
  origin: expectedRequest.origin, path: expectedRequest.path, method: expectedRequest.method,
  status: 200, contentType: 'application/json;charset=UTF-8', body: JSON.stringify(body),
});
const emptyRendering = () => ({
  treeVisible: true, listVisible: true, selectedNode: centralNavigationSelectors.nodeText,
  gridVisible: true, loading: false, rows: [], emptyVisible: true,
});

test('Central navigation refuses the original FetchDefault DATAQUERY without guessing a route', () => {
  assert.equal(gridFetch(centralView).getPSAppDEMethod.id, 'FetchDefault');
  assert.equal(handlerFetch(centralView).getPSAppDEMethod.id, 'FetchDefault');
  const original = centralEntity.getAllPSAppDEMethods.find(method => method.codeName === 'FetchDefault');
  assert.equal(original.methodType, 'FETCH');
  assert.equal(original.dataSetType, 'DATAQUERY');
  assert.equal(original.requestMethod, undefined);
  assert.equal(original.requestPath, undefined);
  assert.throws(() => inspectCentralNavigationRequest(centralEntity, centralEntry, centralView),
    /not a remote FETCH: DATAQUERY/);
  const invented = structuredClone(centralEntity);
  Object.assign(invented.getAllPSAppDEMethods.find(method => method.codeName === 'FetchDefault'), {
    requestMethod: 'POST', requestPath: '/fetchdefault',
  });
  assert.throws(() => inspectCentralNavigationRequest(invented, centralEntry, centralView),
    /not a remote FETCH: DATAQUERY/);
  const api = centralService.getPSDEServiceAPIs.find(api => api.codeName === centralEntity.codeName);
  assert.equal(api.getPSDEServiceAPIMethods.some(method => method.codeName === 'FetchDefault'), false);
  assert.throws(() => inspectCentralNavigationService(centralService, invented, {
    ...expectedRequest, dataset: 'FetchDefault',
    path: '/api/ibizmodeling__central/psdevslns/fetchdefault',
  }), /matching READ declaration/);
});

test('Central navigation requires the complete two-reference candidate repair', () => {
  assert.equal(gridFetch(overlayView).getPSAppDEMethod.id, 'FetchCurDCSLNUser');
  assert.equal(handlerFetch(overlayView).getPSAppDEMethod.id, 'FetchCurDCSLNUser');
  for (const reference of [gridFetch, handlerFetch]) {
    const partial = structuredClone(overlayView);
    reference(partial).getPSAppDEMethod.id = 'FetchDefault';
    assert.throws(() => inspectCentralNavigationRequest(centralEntity, centralEntry, partial),
      /matching grid and READ handler/);
  }
  const restored = structuredClone(overlayView);
  for (const reference of [gridFetch, handlerFetch]) {
    reference(restored).getPSAppDEMethod.id = 'FetchDefault';
  }
  assert.deepEqual(restored, centralView);
});

test('the actual model writer preserves DATAQUERY and defaults only omitted source types to REMOTE', () => {
  const original = centralEntity.getAllPSAppDEMethods.find(method => method.codeName === 'FetchDefault');
  const before = structuredClone({ original, published: selectedMethod(centralEntity) });
  const query = compileAppMethod(original);
  assert.equal(query.methodType, 'FETCH');
  assert.equal(query.dataSetType, 'DATAQUERY');
  assert.equal(query.actionType, 'REMOTE');
  assert.equal(query.requestMethod, undefined);
  assert.equal(query.requestPath, undefined);
  const published = compileAppMethod(selectedMethod(centralEntity));
  assert.equal(published.methodType, 'FETCH');
  assert.equal(published.dataSetType, 'REMOTE');
  assert.equal(published.actionType, 'REMOTE');
  assert.equal(published.requestMethod, 'POST');
  assert.equal(published.requestPath, '/fetchcurdcslnuser');
  assert.deepEqual({ original, published: selectedMethod(centralEntity) }, before);
});

for (const [name, directory, extension] of [
  ['source', 'ibiz-app-hub/packages/runtime/src/service/service/entity/method', '.ts'],
  ['source-debug', 'modelingweb/packages-latest/@ibiz-template/runtime/src/service/service/entity/method', '.ts'],
  ['installed', 'modelingweb/app/node_modules/@ibiz-template/runtime/out/service/service/entity/method', '.js'],
]) {
  test(`${name} fetch runtime rejects remote DATAQUERY even with an invented explicit route`, async () => {
    const fixture = fetchRuntimeFixture(directory, extension);
    const original = centralEntity.getAllPSAppDEMethods.find(method => method.codeName === 'FetchDefault');
    for (const method of [original, {
      ...original, requestMethod: 'POST', requestPath: '/fetchdefault',
    }]) {
      await assert.rejects(fixture.fetch(method).exec({ srfappid: 'central' }, {}), error => {
        assert.match(error.message, /noSupportedDataSource/);
        assert.match(error.message, /DATAQUERY/);
        assert.equal(error.model.codeName, 'FetchDefault');
        return true;
      });
    }
    assert.equal(fixture.localReads(), 0);
    assert.deepEqual(fixture.calls, []);
  });

  test(`${name} fetch runtime permits DATAQUERY only through local querying, without HTTP evidence`, async () => {
    const fixture = fetchRuntimeFixture(directory, extension);
    const original = centralEntity.getAllPSAppDEMethods.find(method => method.codeName === 'FetchDefault');
    const response = await fixture.fetch(original, true).exec({ srfappid: 'central' }, {});
    assert.equal(response.status, 200);
    assert.equal(response.data.length, 0);
    assert.equal(fixture.localReads(), 1);
    assert.deepEqual(fixture.calls, []);
    assert.throws(() => inspectCentralNavigationRequest(centralEntity, centralEntry, centralView),
      /not a remote FETCH: DATAQUERY/);
  });

  test(`${name} fetch runtime uses the repaired method's exact declared HTTP verb and endpoint`, async () => {
    const fixture = fetchRuntimeFixture(directory, extension);
    const params = { page: 0, size: 20 };
    const response = await fixture.fetch(selectedMethod(centralEntity))
      .exec({ srfappid: 'central' }, params);
    assert.equal(response.status, 200);
    assert.deepEqual(fixture.calls, [{
      method: expectedRequest.method,
      path: expectedRequest.path.replace('/api/ibizmodeling__central', ''), params,
    }]);
    assert.equal(fixture.localReads(), 0);
    assert.equal(inspectCentralNavigationService(centralService, centralEntity, expectedRequest)
      .dataset, 'CurDCSLNUser');
  });
}

test('Central navigation resolves the served grid reference to the explicitly declared method', () => {
  assert.equal(expectedRequest.path, '/api/ibizmodeling__central/psdevslns/fetchcurdcslnuser');
  assert.equal(expectedRequest.method, 'POST');
  assert.equal(expectedRequest.dataset, 'FetchCurDCSLNUser');
  assert.equal(expectedRequest.dataSetType, undefined);
  const before = structuredClone({ entity: centralEntity, view: overlayView });
  assert.deepEqual(inspectCentralNavigationRequest(centralEntity, centralEntry, overlayView),
    expectedRequest);
  assert.deepEqual({ entity: centralEntity, view: overlayView }, before);
  const otherView = structuredClone(overlayView);
  gridFetch(otherView).getPSAppDEMethod.id = 'FetchCurDC';
  handlerFetch(otherView).getPSAppDEMethod.id = 'FetchCurDC';
  assert.equal(inspectCentralNavigationRequest(centralEntity, centralEntry, otherView).path,
    '/api/ibizmodeling__central/psdevslns/fetchcurdc');
});

test('Central navigation requires explicit read routing with no HTTP method or path defaults', () => {
  const candidate = structuredClone(centralEntity);
  const method = selectedMethod(candidate);
  method.dataSetType = 'REMOTE';
  assert.equal(inspectCentralNavigationRequest(candidate, centralEntry, overlayView).dataSetType, 'REMOTE');
  for (const invalidPath of [undefined, null, '', '//external.test/fetch', '/fetch?x=1',
    '/../fetch', '/fetch/nested', '/%66etch', '/fetch#fragment']) {
    method.requestPath = invalidPath;
    assert.throws(() => inspectCentralNavigationRequest(candidate, centralEntry, overlayView),
      /explicit requestMethod\/requestPath/);
  }
  method.requestPath = '/fetchcurdcslnuser';
  for (const invalidMethod of [undefined, null, '', 'post', 'PUT', 'DELETE', 'PATCH']) {
    method.requestMethod = invalidMethod;
    assert.throws(() => inspectCentralNavigationRequest(candidate, centralEntry, overlayView),
      /explicit requestMethod\/requestPath/);
  }
  method.requestMethod = 'GET';
  assert.equal(inspectCentralNavigationRequest(candidate, centralEntry, overlayView).method, 'GET');
});

test('Central navigation fails closed on missing, ambiguous or wrong-entity grid method references', () => {
  assert.throws(() => inspectCentralNavigationRequest(centralEntity, centralEntry), /served native/);
  for (const mutate of [
    model => { model.entity.codeName = 'PSDevCenter'; },
    model => { model.entity.dEAPICodeName2 = 'psdevcenters'; },
    model => { model.entity.dynaModelFilePath = 'OtherEntity.json'; },
    model => { model.view.codeName = 'OtherView'; },
    model => { model.view.dynaModelFilePath = 'OtherView.json'; },
    model => { model.view.getPSAppDataEntity.path = 'OtherEntity.json'; },
    model => { model.view.getPSControls = []; },
    model => { model.view.getPSControls = null; },
    model => { model.view.getPSControls.push(structuredClone(model.view.getPSControls[2])); },
    model => { gridFetch(model.view).actionType = 'DEACTION'; },
    model => { gridFetch(model.view).name = 'other'; },
    model => { gridFetch(model.view).getPSAppDEMethod.modelref = false; },
    model => { gridFetch(model.view).getPSAppDataEntity.path = 'OtherEntity.json'; },
    model => { delete gridFetch(model.view).getPSAppDEMethod; },
    model => { gridFetch(model.view).getPSAppDEMethod.id = 'UndeclaredFetch'; },
    model => { delete model.entity.getAllPSAppDEMethods; },
    model => { model.entity.getAllPSAppDEMethods.push(structuredClone(selectedMethod(model.entity))); },
    model => { selectedMethod(model.entity).methodType = 'DEACTION'; },
    model => { selectedMethod(model.entity).builtinMethod = true; },
    model => { selectedMethod(model.entity).dataSetType = 'DATAQUERY'; },
    model => { selectedMethod(model.entity).actionType = 'SCRIPT'; },
    model => { delete model.view.getPSControls[2].getPSControlHandler; },
    model => { model.view.getPSControls[2].getPSControlHandler.userDRAction = 'UPDATE'; },
    model => { model.view.getPSControls[2].getPSControlHandler.getPSHandlerActions = null; },
    model => { handlerFetch(model.view).name = 'other'; },
    model => { handlerFetch(model.view).actionType = 'DEACTION'; },
    model => { handlerFetch(model.view).getPSAppDataEntity.path = 'OtherEntity.json'; },
    model => { handlerFetch(model.view).getPSAppDEMethod.modelref = false; },
    model => { handlerFetch(model.view).getPSAppDEMethod.id = 'FetchCurDC'; },
    model => { delete handlerFetch(model.view).getPSAppDEMethod; },
    model => { model.view.getPSControls[2].getPSControlHandler.getPSHandlerActions.push(
      structuredClone(handlerFetch(model.view))); },
  ]) {
    const model = structuredClone({ entity: centralEntity, view: overlayView });
    mutate(model);
    assert.throws(() => inspectCentralNavigationRequest(model.entity, centralEntry, model.view),
      /Central navigation/);
  }
  const reordered = structuredClone(overlayView);
  reordered.getPSControls.reverse();
  reordered.getPSControls.find(control => control.name === 'grid')
    .getPSControlHandler.getPSHandlerActions.reverse();
  assert.deepEqual(inspectCentralNavigationRequest(centralEntity, centralEntry, reordered), expectedRequest);
});

test('Central selected remote FETCH has matching native backend READ publication', () => {
  const declaration = inspectCentralNavigationService(centralService, centralEntity, expectedRequest);
  assert.equal(declaration.method, 'FetchCurDCSLNUser');
  assert.equal(declaration.requestMethod, 'POST');
  assert.equal(declaration.dataAccessAction, 'READ');
  assert.equal(declaration.dataset, 'CurDCSLNUser');
  assert.equal(declaration.modelPath, 'PSSYSSERVICEAPIS/ModelAPI.json');
});

test('Central navigation rejects unpublished, non-READ or inconsistent backend methods', () => {
  const serviceApi = service => service.getPSDEServiceAPIs.find(api => api.codeName === 'PSDevSln');
  const serviceFetch = service => serviceApi(service).getPSDEServiceAPIMethods.find(method =>
    method.codeName === expectedRequest.dataset);
  for (const mutate of [
    model => { model.service.serviceCodeName = 'OtherAPI'; },
    model => { model.service.dynaModelFilePath = 'OtherAPI.json'; },
    model => { model.service.getPSDEServiceAPIs = []; },
    model => { model.service.getPSDEServiceAPIs.push(structuredClone(serviceApi(model.service))); },
    model => { serviceApi(model.service).getPSDataEntity.path = 'OtherEntity.json'; },
    model => { serviceApi(model.service).codeName2 = 'OtherEntities'; },
    model => { serviceFetch(model.service).codeName = 'UnpublishedFetch'; },
    model => { serviceFetch(model.service).methodType = 'DEACTION'; },
    model => { delete serviceFetch(model.service).dataAccessAction; },
    model => { serviceFetch(model.service).dataAccessAction = 'UPDATE'; },
    model => { serviceFetch(model.service).requestMethod = 'GET'; },
    model => { serviceFetch(model.service).getPSDEDataSet.id = 'Default'; },
    model => { delete selectedMethod(model.entity).dataSetTag; },
    model => { serviceApi(model.service).getPSDEServiceAPIMethods.push(
      structuredClone(serviceFetch(model.service))); },
  ]) {
    const model = structuredClone({ entity: centralEntity, service: centralService });
    mutate(model);
    assert.throws(() => inspectCentralNavigationService(model.service, model.entity, expectedRequest),
      /Central navigation/);
  }
});

test('Central navigation only accepts its same-origin POST dataset, not background APIs', () => {
  const event = datasetEvent([]);
  assert.equal(matchesCentralNavigationRequest(event, expectedRequest), true);
  for (const change of [
    { origin: 'http://elsewhere.test' }, { method: 'GET' },
    { path: '/api/ibizmodeling__modeldesign/psdevslns/fetchcurdcslnuser' },
    { path: '/api/ibizmodeling__central/psdevslns/fetchdefault' },
    { path: '/api/ibizmodeling__central/extension/internal_messages/fetch_cur_receiver' },
    { path: `${expectedRequest.path}/other` }, { path: '/central/' },
  ]) {
    assert.equal(matchesCentralNavigationRequest({ ...event, ...change }, expectedRequest), false);
  }
});

test('even empty Central data needs HTTP 200 and a real JSON dataset response', () => {
  const event = datasetEvent([]);
  const response = inspectCentralNavigationResponse(event, expectedRequest);
  assert.equal(response.rowCount, 0);
  assert.match(response.sha256, /^[a-f0-9]{64}$/);
  for (const status of [204, 302, 401, 404, 500]) {
    assert.throws(() => inspectCentralNavigationResponse({ ...event, status }, expectedRequest), /HTTP/);
  }
  assert.throws(() => inspectCentralNavigationResponse(null, expectedRequest), /no matching/);
  assert.throws(() => inspectCentralNavigationResponse({
    ...event, contentType: 'text/html', body: '<html>index</html>',
  }, expectedRequest), /HTML fallback/);
  assert.throws(() => inspectCentralNavigationResponse({
    ...event, body: 'broken',
  }, expectedRequest), /invalid JSON/);
  for (const body of [null, {}, { data: [] }, { error: 'unsupported model' }, [null],
    [{ psdevslnid: 'id' }], [{ psdevslnid: '', psdevslnname: 'name' }]]) {
    assert.throws(() => inspectCentralNavigationResponse(datasetEvent(body), expectedRequest), /record array/);
  }
});

test('Central list-tree empty rendering cannot disguise a missing or failed query', () => {
  const response = inspectCentralNavigationResponse(datasetEvent([]), expectedRequest);
  const snapshot = emptyRendering();
  assert.deepEqual(inspectCentralNavigationRendering(snapshot, response), {
    state: 'loaded-empty', rowCount: 0,
  });
  assert.throws(() => inspectCentralNavigationRendering(snapshot, null), /dataset evidence/);
  assert.throws(() => inspectCentralNavigationRendering(snapshot, { ...response, status: 500 }),
    /dataset evidence/);
  for (const change of [
    { treeVisible: false }, { listVisible: false }, { selectedNode: 'other' },
    { gridVisible: false }, { loading: true }, { emptyVisible: false },
    { rows: [{ cells: ['stale row'] }] },
  ]) {
    assert.throws(() => inspectCentralNavigationRendering({ ...snapshot, ...change }, response),
      /Central navigation/);
  }
});

test('Central navigation must show the fetched record names in the actual grid rows', () => {
  const response = inspectCentralNavigationResponse(datasetEvent([
    { psdevslnid: 'one', psdevslnname: 'First solution' },
    { psdevslnid: 'two', psdevslnname: 'Second solution' },
  ]), expectedRequest);
  const snapshot = {
    ...emptyRendering(), emptyVisible: false,
    rows: [{ cells: ['First solution', 'code_one'] }, { cells: ['Second solution', 'code_two'] }],
  };
  assert.deepEqual(inspectCentralNavigationRendering(snapshot, response), {
    state: 'loaded-rows', rowCount: 2,
  });
  for (const change of [
    { rows: [] }, { rows: snapshot.rows.slice(0, 1) }, { emptyVisible: true },
    { rows: [{ cells: ['First solution suffix'] }, { cells: ['Second solution'] }] },
    { rows: [{ cells: ['unrelated'] }, { cells: ['Second solution'] }] },
  ]) {
    assert.throws(() => inspectCentralNavigationRendering({ ...snapshot, ...change }, response),
      /Central navigation/);
  }
});

function navigationPage({ event = datasetEvent([]), snapshot = emptyRendering(), missing = false } = {}) {
  const calls = [];
  const response = {
    url: () => `${event.origin}${event.path}`,
    request: () => ({ method: () => event.method }),
    status: () => event.status,
    headers: () => ({ 'content-type': event.contentType }),
    body: async () => Buffer.from(event.body),
  };
  let listener;
  let resolve;
  const pending = new Promise(done => { resolve = done; });
  const locator = {
    first() { return this; },
    async waitFor() {},
    locator() { return this; },
    async allTextContents() { return [centralNavigationSelectors.nodeText]; },
    getByText() { return this; },
    async click() { calls.push('node-click'); },
  };
  return {
    calls,
    page: {
      waitForResponse(predicate) {
        calls.push('response-listener');
        listener = predicate;
        return missing ? Promise.reject(new Error('No dataset request')) : pending;
      },
      getByText(text) {
        assert.equal(text, 'devops');
        return { first: () => ({
          async click() {
            calls.push('devops-click');
            assert.ok(listener, 'Dataset listener must exist before automatic navigation');
            if (!missing) {
              assert.equal(listener(response), true);
              resolve(response);
            }
          },
        }) };
      },
      async waitForURL(pattern) { calls.push(pattern.source); },
      locator(selector) {
        assert.equal(selector, centralNavigationSelectors.tree);
        return locator;
      },
      async evaluate() { return structuredClone(snapshot); },
    },
  };
}

test('Central browser navigation catches automatic child fetches before the menu click', async () => {
  const mock = navigationPage();
  const evidence = await verifyCentralNavigation(mock.page, expectedRequest, { timeout: 1 });
  assert.deepEqual(mock.calls.slice(0, 2), ['response-listener', 'devops-click']);
  assert.equal(evidence.response.status, 200);
  assert.equal(evidence.loaded.state, 'loaded-empty');
  assert.ok(mock.calls.includes('psdevslngridview'));
});

test('Central browser navigation fails with evidence when the empty grid never issued a query', async () => {
  const mock = navigationPage({ missing: true });
  await assert.rejects(verifyCentralNavigation(mock.page, expectedRequest, { timeout: 1 }), error => {
    assert.match(error.message, /did not receive POST/);
    assert.equal(error.evidence.response, null);
    assert.equal(error.evidence.rendering.emptyVisible, true);
    return true;
  });
});

test('Central browser navigation does not accept a failed HTTP query or stale grid', async () => {
  const failed = navigationPage({ event: { ...datasetEvent([]), status: 500 } });
  await assert.rejects(verifyCentralNavigation(failed.page, expectedRequest, { timeout: 1 }), error => {
    assert.match(error.message, /HTTP 500/);
    assert.equal(error.evidence.response.status, 500);
    return true;
  });
  const stale = navigationPage({ snapshot: { ...emptyRendering(), emptyVisible: false } });
  await assert.rejects(verifyCentralNavigation(stale.page, expectedRequest, { timeout: 1 }),
    /loaded empty state/);
});
