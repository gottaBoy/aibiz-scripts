import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import http from 'node:http';
import { createRequire } from 'node:module';
import { dirname, extname, join, relative, resolve, sep } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { launchChromium } from '../browser-launch.mjs';
import { buildLocalModelEdit } from '../../modelingweb/local-plugins/model-edit/build.mjs';

// This is an isolated HTTP fixture, not a native-host or backend acceptance gate.
// There is deliberately no platform URL, credential, or real-data mode.
const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(join(workspace, 'ibiz-app-hub/package.json'));
const { chromium } = require('playwright');
const pluginRoot = join(workspace, 'modelingweb/local-plugins/model-edit');
const appDist = join(workspace, 'modelingweb/app/dist');
const sourceDeps = join(workspace,
  'vendor-upstream/gottaboy-plm-web/plugin-src/@ibiz-template-plugin/ai-code@0.0.3-alpha.141/node_modules');
const modelRoot = join(workspace,
  'vendor-upstream/ibizmodeling-standard/modelapi-core/src/main/resources/model/net/ibizsys/modeling');
const prefix = '/modeldesign/';
const appId = 'ibizmodeling__modeldesign';
const packageRepo = '@aibiz/model-edit@0.1.0';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => `${JSON.stringify(value)}\n`;
const original = () => ({ name: 'FIXTURE_FIELD', memo: 'fixture original', controls: [] });
const clone = value => JSON.parse(JSON.stringify(value));

function modelContract() {
  const entityPath = 'PSSYSAPPS/ModelDesign/PSAPPDATAENTITIES/PSDEField.json';
  const viewPath = 'PSSYSAPPS/ModelDesign/PSAPPDEVIEWS/PSDEFieldCurDEGridView.json';
  const entityBytes = readFileSync(join(modelRoot, entityPath));
  const viewBytes = readFileSync(join(modelRoot, viewPath));
  const entity = JSON.parse(entityBytes);
  const view = JSON.parse(viewBytes);
  const item = view.getPSControls[1].getPSDEToolbarItems[10].getPSDEToolbarItems[3];
  const action = item.getPSUIAction;
  assert.equal(view.getPSAppDataEntity.path, entityPath);
  assert.equal(item.name, 'tbitem22_modeledit');
  assert.equal(action.actionTarget, 'SINGLEDATA');
  assert.equal(action.getPSSysPFPlugin.pluginType, 'DEUIACTION');
  assert.equal(action.getPSSysPFPlugin.pluginCode, 'MODEL_EDIT');
  assert.equal(entity.codeName, 'PSDEField');
  const methods = Object.fromEntries(['ExportModelV2', 'ImportModelV2'].map(name => {
    const method = entity.getAllPSAppDEMethods.find(value => value.codeName === name);
    assert.equal(method.requestMethod, 'POST');
    assert.equal(method.requestParamType, 'ENTITY');
    assert.equal(method.requestPath, `/${name.toLowerCase()}`);
    assert.equal(method.needResourceKey === true, name === 'ExportModelV2');
    return [name, { path: method.requestPath, needResourceKey: method.needResourceKey === true }];
  }));
  return {
    appId, methods,
    entity: {
      id: 'modeldesign.psdefield', codeName: entity.codeName,
      keyAppDEFieldId: entity.getKeyPSAppDEField.codeName.toLowerCase(),
      deapicodeName2: entity.dEAPICodeName2,
    },
    action: {
      id: 'modeledit', name: action.name, caption: action.caption,
      actionTarget: action.actionTarget, uiactionMode: action.uIActionMode,
      uiactionTag: action.uIActionTag, sysPFPluginId: 'model_edit', appId,
    },
    evidence: [
      { path: entityPath, sha256: sha256(entityBytes) },
      { path: viewPath, sha256: sha256(viewBytes),
        actionLocation: '/getPSControls/1/getPSDEToolbarItems/10/getPSDEToolbarItems/3' },
    ],
  };
}

async function bootFixture(config) {
  const [vue, runtime, core, plugin] = await Promise.all(
    ['vue', '@ibiz-template/runtime', '@ibiz-template/core', '@aibiz/model-edit']
      .map(name => System.import(name)),
  );
  const sessionId = crypto.randomUUID();
  const state = window.__modelEditFixture = {
    vue, runtime, config, messages: [], completed: 0, refreshes: 0, hooks: [],
  };
  const context = core.IBizContext.create({
    srfappid: config.appId, psdefield: config.key, srfmodelv2scope: config.scope,
  });
  const url = method => `${config.api}/${config.entity.deapicodeName2}` +
    (config.methods[method].needResourceKey ? `/${encodeURIComponent(config.key)}` : '') +
    config.methods[method].path;
  const request = async (path, method = 'GET', data) => {
    const response = await fetch(path, {
      method, cache: 'no-store', headers: {
        'Content-Type': 'application/json', 'X-Fixture-Session': sessionId,
      },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    return { status: response.status, data: await response.json() };
  };
  const service = {
    async exec(method, actualContext, data, params) {
      if (!Object.hasOwn(config.methods, method) || actualContext.psdefield !== config.key ||
          params.fixture !== true) throw new Error('Unexpected fixture service invocation');
      return request(url(method), 'POST', data);
    },
    reset() {},
  };
  const actions = [
    config.action,
    { ...config.action, id: 'modeledit-readonly', uiactionParamJO: { readonly: 'true' } },
  ];
  const application = {
    model: { appPFPluginRefs: [] },
    getUIAction: async id => actions.find(action => action.id === id),
    deService: { getService: async () => service, reset() {} },
  };
  const domainManager = new runtime.UIDomainManager();
  const makeHook = () => {
    const callbacks = new Set();
    const hook = {
      tapPromise: callback => callbacks.add(callback),
      removeTapPromise: callback => callbacks.delete(callback),
      run: async value => { for (const callback of [...callbacks]) await callback(value); },
      get count() { return callbacks.size; },
    };
    state.hooks.push(hook);
    return hook;
  };
  const host = window.ibiz = {
    env: { pluginBaseUrl: './plugins', appId: config.appId },
    register: new runtime.RegisterCenter(),
    log: { debug() {}, warn() {}, error() {} },
    i18n: { t: key => key },
    message: { error: text => state.messages.push(text) },
    confirm: { warning: async () => window.confirm('Discard fixture changes?') },
    util: { record: { addTriggerLogic() {} } },
    uiDomainManager: domainManager,
    hub: {
      getApp: () => application,
      getAllApps: () => [application],
      getAppDataEntity: async (name, actualAppId) => {
        if (![config.entity.id, config.entity.codeName].includes(name) ||
            actualAppId !== config.appId) throw new Error('Unexpected fixture entity');
        return config.entity;
      },
      getPlugin: () => ({ pluginType: 'DEUIACTION', pluginCode: 'MODEL_EDIT' }),
    },
    plugin: { loadPlugin: async () => plugin.default.install() },
    overlay: {
      createDrawer(render) {
        let finish;
        const dismissal = new Promise(resolve => { finish = resolve; });
        const element = document.createElement('div');
        element.id = 'fixture-drawer';
        const hooks = { shouldDismiss: makeHook(), beforeDismiss: makeHook() };
        const unmount = () => {
          state.mountedApp?.unmount();
          state.mountedApp = undefined;
          element.remove();
        };
        const modal = {
          hooks,
          async dismiss(result = { ok: false }) {
            const check = { allowClose: true };
            await hooks.shouldDismiss.run(check);
            if (check.allowClose === false) return false;
            await hooks.beforeDismiss.run(result);
            unmount();
            finish(result);
            return true;
          },
        };
        state.forceUnmount = () => { unmount(); finish({ ok: false }); };
        state.modal = modal;
        return {
          onWillDismiss: () => dismissal,
          async present() {
            document.body.append(element);
            state.mountedApp = vue.createApp({ render: () => render(modal) });
            state.mountedApp.mount(element);
            await vue.nextTick();
          },
          dismiss: result => modal.dismiss(result),
        };
      },
    },
  };
  plugin.default.install();
  if (!(host.register.get('UIACTION_DEUIACTION_MODEL_EDIT') instanceof plugin.ModelEditProvider)) {
    throw new Error('The actual MODEL_EDIT provider was not registered');
  }
  const readRow = async () => {
    const response = await request(`${config.api}/${config.entity.deapicodeName2}/${config.key}`);
    if (response.status !== 200) throw new Error('Fixture readback failed');
    state.row = response.data;
    document.getElementById('row-memo').textContent = response.data.memo;
  };
  const view = {
    context, model: { appId: config.appId, appDataEntityId: config.entity.id, caption: 'Fixture field' },
    state: {}, modal: {},
    call: async tag => {
      if (tag !== runtime.ViewCallTag.VALIDATE) throw new Error('Unexpected fixture view call');
      return true;
    },
    async callUIAction(tag) {
      if (tag !== runtime.SysUIActionTag.REFRESH) throw new Error('Unexpected refresh action');
      await readRow();
      state.refreshes += 1;
    },
  };
  const open = readonly => {
    state.action = runtime.UIActionUtil.execAndResolved(
      readonly ? 'modeledit-readonly' : 'modeledit',
      { context, params: { fixture: true }, data: [{ srfkey: config.key }], view },
      config.appId,
    ).then(() => { state.completed += 1; }).catch(error => {
      state.actionError = String(error);
      throw error;
    });
  };
  document.getElementById('open-edit').onclick = () => open(false);
  document.getElementById('open-readonly').onclick = () => open(true);
  state.counts = () => ({
    editors: window.monaco?.editor.getEditors().length ?? 0,
    models: window.monaco?.editor.getModels().length ?? 0,
    hooks: state.hooks.reduce((sum, hook) => sum + hook.count, 0),
    domains: domainManager.domainMap.size,
    refreshes: state.refreshes, completed: state.completed,
    actionError: state.actionError ?? null, messages: [...state.messages],
  });
  await readRow();
  state.ready = true;
}

async function createFixture(contract, artifacts) {
  const key = `fixture-${randomUUID()}`;
  const api = `/api/${appId}`;
  const config = { ...contract, key, scope: `FIXTURE#${key}`, api };
  const state = {
    model: original(), imports: [], requests: [], mode: 'persist',
    pending: undefined, release: undefined,
  };
  const files = new Map([
    [`${prefix}plugins/${packageRepo}/dist/index.system.js`, artifacts.get('index.system.js')],
    [`${prefix}plugins/${packageRepo}/dist/style.css`, artifacts.get('style.css')],
    [`${prefix}loader.system.js`,
      "System.register([],function(exports){return{execute(){exports('default',globalThis.monaco_loader);}};});"],
    [`${prefix}fixture.js`, `(${bootFixture.toString()})(${JSON.stringify(config)}).catch(error => {
      window.__fixtureBootError = String(error); console.error(error);
    });`],
  ]);
  const rawMap = JSON.parse(await readFile(join(appDist, 'extras/json/system-import.json')));
  const imports = Object.fromEntries(Object.entries(rawMap.imports).map(([name, value]) => [
    name, new URL(value, 'http://fixture.invalid/modeldesign/extras/json/system-import.json').pathname,
  ]));
  imports['@aibiz/model-edit'] = `${prefix}plugins/${packageRepo}/dist/index.system.js`;
  imports['@monaco-editor/loader'] = `${prefix}loader.system.js`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Model edit isolated fixture</title>
    <link rel="icon" href="data:,">
    <link rel="stylesheet" href="${prefix}plugins/${packageRepo}/dist/style.css">
    <style>body{margin:16px;font:14px sans-serif}#fixture-drawer{
      position:fixed;inset:16px;background:white;z-index:2;border:1px solid #999}</style>
    </head><body><button id="open-edit">Open fixture editor</button>
    <button id="open-readonly">Open fixture readonly</button><p id="row-memo"></p>
    <script src="${prefix}monaco-loader.js"></script><script src="${prefix}system.js"></script>
    <script type="systemjs-importmap">${JSON.stringify({ imports })}</script>
    <script src="${prefix}fixture.js"></script></body></html>`;
  const paths = {
    get: `${api}/${contract.entity.deapicodeName2}/${key}`,
    export: `${api}/${contract.entity.deapicodeName2}/${key}${contract.methods.ExportModelV2.path}`,
    import: `${api}/${contract.entity.deapicodeName2}${contract.methods.ImportModelV2.path}`,
  };
  const staticFile = async (pathname, root, route) => {
    const path = resolve(root, pathname.slice(route.length));
    assert.ok(path.startsWith(`${resolve(root)}${sep}`), 'Static fixture path escaped its root');
    return readFile(path);
  };
  const server = http.createServer(async (request, response) => {
    const path = new URL(request.url, 'http://fixture.invalid').pathname;
    const log = { method: request.method, path, session: request.headers['x-fixture-session'] ?? null };
    state.requests.push(log);
    const send = (status, bytes, contentType) => {
      log.status = status;
      log.sha256 = sha256(bytes);
      response.writeHead(status, { 'Content-Type': contentType, 'Cache-Control': 'no-store' });
      response.end(bytes);
    };
    try {
      if (path.startsWith(`${api}/`)) {
        if (request.method === 'GET' && path === paths.get) {
          return send(200, json({ [contract.entity.keyAppDEFieldId]: key, memo: state.model.memo }),
            'application/json');
        }
        assert.equal(request.method, 'POST');
        const chunks = [];
        let size = 0;
        for await (const bytes of request) {
          size += bytes.length;
          assert.ok(size < 65536, 'Fixture input is too large');
          chunks.push(bytes);
        }
        const data = JSON.parse(Buffer.concat(chunks));
        if (path === paths.export) {
          assert.deepEqual(data, {});
          return send(200, json({ model: state.model }), 'application/json');
        }
        assert.equal(path, paths.import);
        assert.deepEqual(Object.keys(data).sort(),
          [contract.entity.keyAppDEFieldId, 'srfmodelv2scope', 'model'].sort());
        assert.equal(data[contract.entity.keyAppDEFieldId], key);
        assert.equal(data.srfmodelv2scope, config.scope);
        assert.equal(typeof data.model, 'object');
        assert.ok(data.model !== null && !Array.isArray(data.model));
        state.imports.push({ data: clone(data), session: log.session });
        if (state.mode === 'failure') {
          return send(500, json({ message: 'fixture-private-server-error' }), 'application/json');
        }
        if (state.mode === 'pending') {
          state.pending = new Promise(resolve => { state.release = resolve; });
          await state.pending;
        }
        if (state.mode !== 'acknowledge-without-write') state.model = clone(data.model);
        return send(200, json({ [contract.entity.keyAppDEFieldId]: key, memo: state.model.memo }),
          'application/json');
      }
      if (request.method !== 'GET') return send(405, 'Fixture method rejected', 'text/plain');
      if (path === prefix) return send(200, html, 'text/html');
      let bytes = files.get(path);
      if (bytes === undefined && path === `${prefix}system.js`) {
        bytes = await readFile(join(workspace, 'modelingweb/app/node_modules/systemjs/dist/s.min.js'));
      }
      if (bytes === undefined && path === `${prefix}monaco-loader.js`) {
        bytes = await readFile(join(sourceDeps, '@monaco-editor/loader/lib/umd/monaco-loader.min.js'));
      }
      if (bytes === undefined && path.startsWith(`${prefix}extras/js/`)) {
        bytes = await staticFile(path, join(appDist, 'extras/js'), `${prefix}extras/js/`);
      }
      const monacoRoute = `${prefix}plugins/monaco-editor@0.52.2/min/`;
      if (bytes === undefined && path.startsWith(monacoRoute)) {
        bytes = await staticFile(path, join(sourceDeps, 'monaco-editor/min'), monacoRoute);
      }
      if (bytes === undefined) return send(404, 'Fixture asset missing', 'text/plain');
      const type = {
        '.css': 'text/css', '.json': 'application/json', '.ttf': 'font/ttf',
        '.js': 'text/javascript',
      }[extname(path)] ?? 'application/octet-stream';
      return send(200, bytes, type);
    } catch (error) {
      log.error = error.code === 'ENOENT' ? 'Missing fixture file' : String(error);
      send(error.code === 'ENOENT' ? 404 : 400, 'Fixture contract rejected', 'text/plain');
    }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  return {
    origin, entry: origin + prefix, state, paths,
    async close() {
      state.release?.();
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
      state.model = undefined;
      state.imports.length = 0;
    },
  };
}

async function openPage(browser, fixture, { width = 1440, height = 900 } = {}) {
  const context = await browser.newContext({ viewport: { width, height } });
  const errors = [];
  const outsideRequests = [];
  await context.route('**/*', async route => {
    if (new URL(route.request().url()).origin !== fixture.origin) {
      outsideRequests.push(route.request().url());
      return route.abort('blockedbyclient');
    }
    return route.continue();
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(String(error)));
  context.on('close', () => {
    const index = errors.findIndex(error => error === 'Canceled: Canceled');
    if (index >= 0) errors.splice(index, 1);
  });
  const navigate = async () => {
    await page.goto(fixture.entry);
    await page.waitForFunction(() => window.__modelEditFixture?.ready || window.__fixtureBootError,
      undefined, { timeout: 30000 });
    assert.equal(await page.evaluate(() => window.__fixtureBootError ?? null), null);
  };
  try { await navigate(); }
  catch (error) { await context.close(); throw error; }
  return { context, page, errors, outsideRequests };
}

async function openEditor(page, readonly = false) {
  await page.locator(readonly ? '#open-readonly' : '#open-edit').click();
  await page.waitForFunction(() => {
    const editor = window.monaco?.editor.getEditors()[0];
    return editor && editor.getValue() !== '' &&
      JSON.parse(editor.getValue()).name === 'FIXTURE_FIELD' &&
      !document.querySelector('.aibiz-model-edit__loading');
  }, undefined, { timeout: 30000 }).catch(async error => {
    const current = await page.evaluate(() => ({
      value: window.monaco?.editor.getEditors()[0]?.getValue(),
      loading: Boolean(document.querySelector('.aibiz-model-edit__loading')),
      counts: window.__modelEditFixture?.counts(),
    }));
    error.message = `${error.message}\neditor=${JSON.stringify(current)}`;
    throw error;
  });
  const result = await page.evaluate(async () => {
    const editor = window.monaco.editor.getEditors()[0];
    const uri = editor.getModel().uri;
    const worker = await window.monaco.languages.json.getWorker();
    const client = await worker(uri);
    const rect = editor.getDomNode().getBoundingClientRect();
    return {
      readOnly: editor.getRawOptions().readOnly, width: rect.width, height: rect.height,
      diagnostics: await client.doValidation(uri.toString()),
    };
  });
  assert.ok(result.width > 200 && result.height > 200, 'Monaco must render visibly');
  assert.equal(result.readOnly, readonly);
  assert.deepEqual(result.diagnostics, [], 'The actual local JSON worker must execute');
  return result;
}

async function keyboardModel(page, model) {
  await page.evaluate(() => {
    const editor = window.monaco.editor.getEditors()[0];
    editor.focus();
    editor.setSelection(editor.getModel().getFullModelRange());
  });
  const before = await page.evaluate(() => {
    const editor = window.monaco.editor.getEditors()[0];
    return {
      value: editor.getValue(),
      readOnly: editor.getRawOptions().readOnly,
      focused: document.activeElement === editor.getDomNode(),
      activeElement: document.activeElement?.outerHTML,
    };
  });
  const afterSelectAll = await page.evaluate(() => {
    const editor = window.monaco.editor.getEditors()[0];
    return { value: editor.getValue(), selection: String(editor.getSelection()) };
  });
  const text = typeof model === 'string' ? model : JSON.stringify(model);
  await page.evaluate(text => window.monaco.editor.getEditors()[0]
    .trigger('fixture-keyboard', 'type', { text }), text);
  try {
    await page.waitForFunction(text => window.monaco.editor.getEditors()[0].getValue() === text,
      text, { timeout: 5000 });
  } catch (error) {
    const afterInsert = await page.evaluate(() => {
      const editor = window.monaco.editor.getEditors()[0];
      return {
        value: editor.getValue(),
        readOnly: editor.getRawOptions().readOnly,
        focused: document.activeElement === editor.getDomNode(),
        activeElement: document.activeElement?.outerHTML,
      };
    });
    error.message = `${error.message}\nkeyboard before=${JSON.stringify(before)}` +
      `\nkeyboard select-all=${JSON.stringify(afterSelectAll)}` +
      `\nkeyboard insert=${JSON.stringify(afterInsert)}`;
    throw error;
  }
}

async function waitCompleted(page, count = 1) {
  try {
    await page.waitForFunction(count => window.__modelEditFixture.completed === count,
      count, { timeout: 10000 });
  } catch (error) {
    const current = await page.evaluate(() => window.__modelEditFixture.counts());
    error.message = `${error.message}\ncompleted counts=${JSON.stringify(current)}`;
    throw error;
  }
  const counts = await page.evaluate(() => window.__modelEditFixture.counts());
  assert.equal(counts.actionError, null);
  assert.equal(counts.editors, 0);
  assert.equal(counts.models, 0);
  assert.equal(counts.hooks, 0);
  assert.equal(counts.domains, 0);
  return counts;
}

test('MODEL_EDIT real browser fixture; native/backend acceptance remains false', { timeout: 180000 }, async t => {
  const contract = modelContract();
  const built = await buildLocalModelEdit({ writeOutputs: false });
  const receipt = JSON.parse(await readFile(join(pluginRoot, 'dist/build-receipt.json')));
  assert.deepEqual(receipt, built.receipt, 'The local plugin must have a current reproducible build');
  for (const output of receipt.outputs) {
    assert.equal(sha256(await readFile(join(pluginRoot, 'dist', output.path))), output.sha256);
    assert.equal(sha256(built.artifacts.get(output.path)), output.sha256);
  }
  for (const flag of ['originalSourceRecovered', 'nativeCompatibilityVerified', 'acceptedForProduction']) {
    assert.equal(receipt[flag], false);
  }
  const root = join(workspace, '.artifacts/native-model-edit');
  await mkdir(root, { recursive: true });
  const destination = await mkdtemp(join(root, 'fixture-20261006-'));
  const report = {
    schemaVersion: 1, contract: 'model-edit-isolated-http-browser-fixture',
    startedAt: new Date().toISOString(), status: 'running',
    sourceEvidence: {
      plugin: packageRepo, receiptSha256: sha256(json(receipt)), outputs: receipt.outputs,
      models: contract.evidence,
    },
    boundary: {
      actual: ['built plugin', 'Vue', 'runtime UIActionUtil/registration/navigation',
        'IBizContext/UIDomainManager', 'Monaco and JSON worker', 'browser keyboard and HTTP'],
      fixture: ['hub/entity service transport', 'drawer host/hooks', 'in-memory backend and selected data'],
      nativeHostVerified: false, nativeBackendVerified: false,
      nativeCompatibilityVerified: false, acceptedForProduction: false,
    },
    stages: [], requests: [], errors: [],
  };
  let browser;
  const contexts = new Set();
  const fixtures = new Set();
  const stage = async (name, run) => t.test(name, async () => {
    const fixture = await createFixture(contract, built.artifacts);
    fixtures.add(fixture);
    let active;
    try {
      active = await openPage(browser, fixture, name === 'readonly' ? { width: 390, height: 844 } : {});
      contexts.add(active.context);
      const evidence = await run(active, fixture);
      assert.deepEqual(active.errors.filter(error => error !== 'Canceled: Canceled'), []);
      assert.deepEqual(active.outsideRequests, []);
      assert.equal(fixture.state.requests.filter(item => item.error).length, 0,
        'Fixture route/body contract failures must fail the test');
      assert.equal(fixture.state.requests.filter(item => item.status >= 400 &&
        !(name === 'save-failure-and-discard' && item.path === fixture.paths.import &&
          item.status === 500)).length, 0, 'Unexpected HTTP failures');
      report.stages.push({ name, status: 'PASS', evidence });
    } catch (error) {
      report.stages.push({ name, status: 'FAIL', error: String(error) });
      throw error;
    } finally {
      fixture.state.release?.();
      if (active) {
        await active.context.close();
        contexts.delete(active.context);
      }
      report.requests.push(...fixture.state.requests);
      await fixture.close();
      fixtures.delete(fixture);
    }
  });
  try {
    browser = await launchChromium(chromium, { args: ['--no-sandbox'] });
    await stage('save-refresh-reload-fresh-session', async (active, fixture) => {
      const { page } = active;
      const rendering = await openEditor(page);
      const edited = { ...original(), memo: `fixture saved ${randomUUID()}` };
      await keyboardModel(page, edited);
      const imported = page.waitForResponse(response =>
        new URL(response.url()).pathname === fixture.paths.import && response.request().method() === 'POST');
      await page.getByRole('button', { name: 'Save', exact: true }).click();
      assert.equal((await imported).status(), 200);
      await page.waitForFunction(() =>
        document.querySelector('.aibiz-model-edit__status')?.textContent === 'Saved');
      assert.equal(await page.locator('.aibiz-model-edit').count(), 1);
      assert.equal(await page.evaluate(() => window.__modelEditFixture.refreshes), 0);
      assert.deepEqual(fixture.state.model, edited);
      assert.equal(fixture.state.imports.length, 1);
      await page.screenshot({ path: join(destination, 'saved-desktop.png') });
      await page.getByRole('button', { name: 'Close', exact: true }).click();
      const counts = await waitCompleted(page);
      assert.equal(counts.refreshes, 1, 'Actual UIActionUtil must consume provider refresh only after close');
      assert.equal(await page.locator('#row-memo').textContent(), edited.memo);
      await page.evaluate(() => localStorage.setItem('fixture-session-marker', 'first-context-only'));
      await page.reload();
      await page.waitForFunction(() => window.__modelEditFixture?.ready, undefined, { timeout: 30000 });
      assert.equal(await page.locator('#row-memo').textContent(), edited.memo);
      await openEditor(page);
      assert.deepEqual(await page.evaluate(() =>
        JSON.parse(window.monaco.editor.getEditors()[0].getValue())), edited);
      await page.getByRole('button', { name: 'Close', exact: true }).click();
      assert.equal((await waitCompleted(page)).refreshes, 0, 'A read must not invent a save');
      await active.context.close();
      contexts.delete(active.context);
      const fresh = await openPage(browser, fixture);
      contexts.add(fresh.context);
      try {
        assert.deepEqual((await fresh.context.storageState()).cookies, []);
        const storage = await fresh.context.storageState();
        assert.deepEqual(storage.origins, storage.origins.filter(origin =>
          origin.localStorage.some(item => item.name === 'loglevel')));
        await openEditor(fresh.page, true);
        assert.deepEqual(await fresh.page.evaluate(() =>
          JSON.parse(window.monaco.editor.getEditors()[0].getValue())), edited);
        await fresh.page.getByRole('button', { name: 'Close', exact: true }).click();
        assert.equal((await waitCompleted(fresh.page)).refreshes, 0);
        assert.deepEqual(fresh.errors, []);
        assert.deepEqual(fresh.outsideRequests, []);
      } finally {
        await fresh.context.close();
        contexts.delete(fresh.context);
      }
      const exports = fixture.state.requests.filter(item => item.path === fixture.paths.export);
      assert.equal(new Set(exports.map(item => item.session)).size, 3,
        'Save, document reload, and fresh BrowserContext must execute independent HTTP exports');
      return { rendering, imports: 1, refreshes: 1, independentExportSessions: 3,
        exactModelReadback: true, screenshot: 'saved-desktop.png' };
    });
    await stage('readonly', async ({ page }, fixture) => {
      const rendering = await openEditor(page, true);
      const before = await page.evaluate(() => window.monaco.editor.getEditors()[0].getValue());
      await page.evaluate(() => window.monaco.editor.getEditors()[0].focus());
      await page.keyboard.insertText('forbidden fixture mutation');
      assert.equal(await page.evaluate(() => window.monaco.editor.getEditors()[0].getValue()), before);
      assert.equal(await page.getByRole('button', { name: 'Save', exact: true }).count(), 0);
      assert.equal(await page.getByRole('button', { name: 'Save and close', exact: true }).count(), 0);
      await page.screenshot({ path: join(destination, 'readonly-mobile.png') });
      await page.getByRole('button', { name: 'Close', exact: true }).click();
      assert.equal((await waitCompleted(page)).refreshes, 0);
      assert.equal(fixture.state.imports.length, 0);
      assert.deepEqual(fixture.state.model, original());
      return { rendering, imports: 0, screenshot: 'readonly-mobile.png' };
    });
    await stage('save-failure-and-discard', async ({ page }, fixture) => {
      await openEditor(page);
      await keyboardModel(page, '[]');
      await page.getByRole('button', { name: 'Save and close', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: 'valid JSON object' }).waitFor();
      assert.equal(fixture.state.imports.length, 0);
      await keyboardModel(page, { ...original(), memo: 'rejected fixture save' });
      fixture.state.mode = 'failure';
      await page.getByRole('button', { name: 'Save and close', exact: true }).click();
      await page.getByRole('alert').filter({ hasText: 'could not be saved' }).waitFor();
      assert.equal(fixture.state.imports.length, 1);
      assert.deepEqual(fixture.state.model, original());
      assert.equal(await page.locator('.aibiz-model-edit__status').textContent(), 'Unsaved');
      page.once('dialog', dialog => dialog.dismiss());
      await page.getByRole('button', { name: 'Close', exact: true }).click();
      await page.getByRole('button', { name: 'Close', exact: true }).waitFor();
      assert.equal(await page.evaluate(() => window.__modelEditFixture.completed), 0);
      page.once('dialog', dialog => dialog.accept());
      await page.getByRole('button', { name: 'Close', exact: true }).click();
      const counts = await waitCompleted(page);
      assert.equal(counts.refreshes, 0);
      assert.equal(JSON.stringify(counts.messages).includes('fixture-private-server-error'), false);
      return { invalidObjectImports: 0, failedImportStatus: 500, refreshes: 0,
        discardCancellationHonored: true, privateErrorNotExposed: true };
    });
    await stage('http-200-is-not-persistence-evidence', async (active, fixture) => {
      const { page } = active;
      await openEditor(page);
      const edited = { ...original(), memo: 'must not pass without persistence' };
      await keyboardModel(page, edited);
      fixture.state.mode = 'acknowledge-without-write';
      await page.getByRole('button', { name: 'Save and close', exact: true }).click();
      assert.equal((await waitCompleted(page)).refreshes, 1);
      await page.waitForFunction(() => !document.querySelector('#fixture-drawer'));
      assert.notEqual(await page.locator('#row-memo').textContent(), edited.memo);
      await openEditor(page, true);
      const readback = await page.evaluate(() => JSON.parse(window.monaco.editor.getEditors()[0].getValue()));
      assert.notDeepEqual(readback, edited, 'An HTTP acknowledgement without persisted data must not pass');
      assert.deepEqual(readback, original());
      await page.getByRole('button', { name: 'Close', exact: true }).click();
      await waitCompleted(page, 2);
      assert.deepEqual(active.errors.filter(error => error !== 'Canceled: Canceled'), []);
      assert.deepEqual(active.outsideRequests, []);
      return { importStatus: 200, falsePersistenceDetected: true, nativeAccepted: false };
    });
    await stage('disposed-inflight-save', async ({ page }, fixture) => {
      await openEditor(page);
      fixture.state.mode = 'pending';
      await keyboardModel(page, { ...original(), memo: 'inflight fixture request' });
      await page.getByRole('button', { name: 'Save and close', exact: true }).click();
      await page.waitForFunction(() =>
        document.querySelector('button') &&
        [...document.querySelectorAll('.aibiz-model-edit button')].every(button => button.disabled));
      await t.assert.ok(fixture.state.imports.length === 1 || await new Promise(resolve => {
        const deadline = Date.now() + 5000;
        const poll = () => fixture.state.release ? resolve(true) :
          Date.now() >= deadline ? resolve(false) : setTimeout(poll, 20);
        poll();
      }));
      await page.evaluate(() => window.__modelEditFixture.forceUnmount());
      const counts = await waitCompleted(page);
      assert.equal(counts.refreshes, 0);
      fixture.state.release();
      await page.waitForLoadState('networkidle');
      await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 50)));
      const after = await page.evaluate(() => window.__modelEditFixture.counts());
      assert.deepEqual(after, counts, 'Late save must not message, refresh, remount, or retain editor hooks');
      assert.equal(fixture.state.model.memo, 'inflight fixture request',
        'Disposal cannot revoke an import already sent; this is only in-memory fixture data');
      return { disposed: counts, lateUiUpdates: 0, alreadySentImportCannotBeRevoked: true };
    });
  } catch (error) {
    report.errors.push(String(error));
    throw error;
  } finally {
    for (const fixture of fixtures) fixture.state.release?.();
    for (const context of contexts) await context.close();
    if (browser) await browser.close();
    for (const fixture of fixtures) await fixture.close();
    report.status = report.errors.length === 0 && report.stages.length === 5 &&
      report.stages.every(stage => stage.status === 'PASS')
      ? 'fixture-passed-native-not-accepted' : 'failed';
    report.completedAt = new Date().toISOString();
    await writeFile(join(destination, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
    console.log(`MODEL_EDIT fixture evidence: ${relative(workspace, destination)}/report.json`);
  }
});
