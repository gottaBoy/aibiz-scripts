import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { workspace } from '../localization-baseline.mjs';

const require = createRequire(join(workspace, 'modelingweb/app/package.json'));
const ts = require('typescript');
const variants = [
  {
    name: 'hub',
    packages: 'ibiz-app-hub/packages',
    host: 'ibiz-app-hub/components/ibiz-next-vue3/src/web-app',
    automaticSubAppDiscovery: false,
  },
  {
    name: 'modeling',
    packages: 'modelingweb/packages-latest/@ibiz-template',
    host: 'modelingweb/packages-latest/@ibiz-template/vue3-components/src/web-app',
    automaticSubAppDiscovery: true,
  },
];
const plain = value => JSON.parse(JSON.stringify(value));
const noopClass = class {};

function load(file, runtime, window, imports = {}, globals = {}) {
  const exports = {};
  const output = ts.transpileModule(fs.readFileSync(join(workspace, file), 'utf8'), {
    fileName: file,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true,
    },
  }).outputText;
  vm.runInNewContext(output, {
    exports, ibiz: runtime, window, URL, ...globals,
    document: { getElementById: () => null },
    require: id => {
      assert.ok(Object.hasOwn(imports, id), `Unexpected import ${id} from ${file}`);
      return imports[id];
    },
  }, { filename: file });
  return exports;
}

function fixture(variant, deployment = {}, response = { status: 404 }, realScripts = false) {
  const window = {
    Environment: deployment,
    location: { search: '', origin: 'http://127.0.0.1:32118', pathname: '/modeldesign/' },
  };
  const enumValues = {
    LoginMode: { DEFAULT: 'DEFAULT' }, MenuPermissionMode: { MIXIN: 'MIXIN' },
  };
  const { Environment } = load(
    `${variant.packages}/core/src/environment/environment.ts`, {}, window,
    { '../interface': enumValues },
  );
  const { IBizSys } = load(`${variant.packages}/core/src/ibizsys.ts`, {}, window, {
    './command': { CommandController: noopClass },
    './environment/environment': { Environment },
    './utils': { Net: noopClass, MessageCenter: noopClass },
    './utils/logger/logger': { logger: { setLevel() {} } },
  });
  const runtime = new IBizSys();
  const requests = [];
  const warnings = [];
  const errors = [];
  const loads = [];
  const scripts = [];
  const importMaps = [];
  const scriptRequests = [];
  const scriptResources = new Map();
  const systemNode = realScripts ? require('systemjs') : undefined;
  const system = realScripts ? new systemNode.System.constructor() : undefined;
  if (system) {
    systemNode.setBaseUrl(system, `${window.location.origin}${window.location.pathname}`);
    const originalAdd = system.addImportMap.bind(system);
    system.addImportMap = map => {
      importMaps.push(plain(map));
      originalAdd(map);
    };
    system.fetch = async url => {
      scriptRequests.push(url);
      assert.ok(scriptResources.has(url), `Unexpected script URL: ${url}`);
      const resource = scriptResources.get(url);
      if (resource instanceof Error) throw resource;
      return {
        ok: true, status: 200,
        headers: { get: header => header === 'content-type' ? 'application/javascript' : null },
        text: async () => resource,
      };
    };
  }
  const RuntimeError = class extends Error {};
  const RuntimeModelError = class extends Error {
    constructor(model, message) {
      super(message);
      this.model = model;
    }
  };
  const core = { RuntimeError, RuntimeModelError, getToken: () => undefined };
  runtime.env.appId = 'main-app';
  runtime.env.pluginBaseUrl = '';
  runtime.i18n = { t: (key, params) => `${key}:${JSON.stringify(params || {})}` };
  runtime.log = { setLevel() {}, warn: value => warnings.push(value), error: value => errors.push(value) };
  runtime.net.axios = async request => {
    requests.push(plain(request));
    const result = typeof response === 'function' ? response(request, requests.length) : response;
    if (result instanceof Error) throw result;
    return { ...result, data: { ...result.data } };
  };
  runtime.util = {
    rawValue: {
      format(value) {
        if (value === 'true') return true;
        if (value === 'false') return false;
        return value;
      },
    },
  };
  const { RemotePluginItem } = load(
    `${variant.packages}/runtime/src/plugin/remote-plugin-item/remote-plugin-item.ts`, runtime, window,
  );
  const { AppHooks } = realScripts ? load(
    `${variant.packages}/vue3-util/src/hooks/app/app.hooks.ts`, runtime, window,
    { 'qx-util': require('qx-util') },
  ) : { AppHooks: {} };
  const vueApp = realScripts ? require('vue').createApp({}) : undefined;
  if (realScripts) {
    AppHooks.useComponent.tap((_, plugin, extraParams) => vueApp.use(plugin, extraParams));
  }
  const { PluginFactory } = load(
    `${variant.packages}/vue3-util/src/plugin/plugin-factory/plugin-factory.ts`, runtime, window,
    {
      '@ibiz-template/core': core,
      '@ibiz-template/runtime': { RemotePluginItem },
      'path-browserify': require('path-browserify'),
      '../../hooks': { AppHooks },
    },
    { System: system },
  );
  const factory = new PluginFactory();
  const originalLoad = factory.loadPlugin.bind(factory);
  factory.loadPlugin = async (...args) => {
    loads.push(args);
    return originalLoad(...args);
  };
  const originalLoadScript = factory.loadScript.bind(factory);
  if (!realScripts) factory.loadPluginExternal = async () => {};
  factory.loadScript = async plugin => {
    scripts.push(plugin);
    if (realScripts) return originalLoadScript(plugin);
  };
  runtime.plugin = factory;
  const created = [];
  const { AppHub } = load(`${variant.packages}/runtime/src/app-hub.ts`, runtime, window, {
    '@ibiz-template/core': core,
    './application': {
      Application: class {
        constructor(model) { this.model = model; created.push(model); }
        async init() {}
      },
    },
    './hub': { Convert: noopClass, AppConfigService: noopClass },
    './controller': { HubController: noopClass },
    './service': { ConfigService: noopClass },
    './controller/notification': { NoticeController: noopClass },
    './micro-app': { MicroAppConfigCenter: noopClass },
  });
  const hub = new AppHub();
  runtime.hub = hub;
  const { attachEnvironmentConfig } = load(
    `${variant.host}/attach-environment-config.ts`, runtime, window,
    { qs: require('qs'), ramda: require('ramda') },
  );
  const { AuthGuard } = load(
    `${variant.host}/guard/auth-guard/auth-guard.ts`, runtime, window,
    {
      '@ibiz-template/core': core,
      ramda: require('ramda'),
      '@ibiz-template/vue3-util': { AppHooks: {} },
      '@ibiz-template/runtime': {},
      '@ibiz-template/devtool': {},
    },
  );
  const guard = new AuthGuard();
  return {
    runtime, hub, factory, guard, window, created, loads, scripts, requests, warnings, errors,
    system, vueApp, importMaps, scriptRequests, scriptResources, RemotePluginItem,
    async withRealSystem(operation) {
      const previous = globalThis.System;
      globalThis.System = system;
      try {
        return await operation();
      } finally {
        globalThis.System = previous;
      }
    },
    attach: attachEnvironmentConfig,
  };
}

for (const variant of variants) {
  test(`${variant.name}: an older runtime without the optional key retains actual discovery`, async () => {
    const f = fixture(variant);
    delete f.runtime.env.enableExtensionPlugin;
    await f.hub.loadExtensionPlugin('main-app');
    assert.equal(f.loads.length, 1);
    assert.equal(f.requests.length, 1);
    assert.equal(f.factory.pluginCache.size, 0);
  });

  test(`${variant.name}: extension discovery warning has actual Chinese and English resource entries`, () => {
    for (const [language, exported] of [['en', 'en'], ['zh-CN', 'zhCn']]) {
      const source = load(`${variant.packages}/runtime/src/locale/${language}/index.ts`, {}, {});
      const message = source[exported]?.runtime?.hub?.noExtensionPlugin;
      assert.equal(typeof message, 'string');
      assert.match(message, /\{appId\}/);
      assert.ok(message.length > 20);
    }
  });

  for (const [name, deployment, expected] of [
    ['absent', {}, true],
    ['enabled', { enableExtensionPlugin: true }, true],
    ['disabled', { enableExtensionPlugin: false }, false],
  ]) {
    test(`${variant.name}: real Core and host attach preserve ${name} deployment capability`, async () => {
      const f = fixture(variant, deployment);
      assert.equal(f.runtime.env.enableExtensionPlugin, true);
      await f.attach();
      assert.equal(f.runtime.env.enableExtensionPlugin, expected);
      const result = await f.hub.loadExtensionPlugin('child-app');
      assert.equal(result, undefined, 'The optional loader does not invent a plugin success result');
      assert.equal(f.loads.length, expected ? 1 : 0);
      assert.equal(f.requests.length, expected ? 1 : 0);
      assert.equal(f.warnings.length, expected ? 1 : 0);
      if (expected) {
        assert.equal(f.requests[0].url, variant.name === 'hub'
          ? 'http://127.0.0.1:32118/api/child-app/remotemodel/ext/package.json'
          : '/api/child-app/remotemodel/ext/package.json');
        assert.equal(f.requests[0].method, 'get');
        assert.match(f.warnings[0], /runtime\.hub\.noExtensionPlugin.*child-app/);
      }
      assert.equal(f.factory.pluginCache.size, 0);
      assert.equal(f.factory.loadQueue.size, 0);
      assert.deepEqual(f.scripts, []);
    });
  }

  for (const value of ['false', 'true', 0, 1, null, undefined, {}, []]) {
    test(`${variant.name}: invalid deployment value ${String(value)} is rejected by the real attach path`, async () => {
      const f = fixture(variant, { enableExtensionPlugin: value });
      await assert.rejects(f.attach(), /enableExtensionPlugin must be a boolean data property/);
      assert.equal(f.loads.length, 0);
      assert.equal(f.requests.length, 0);
      assert.equal(f.runtime.env.enableExtensionPlugin, true);
    });
    test(`${variant.name}: invalid runtime value ${String(value)} is not coerced to a discovery decision`, async () => {
      const f = fixture(variant);
      f.runtime.env.enableExtensionPlugin = value;
      await assert.rejects(f.hub.loadExtensionPlugin('main-app'),
        /enableExtensionPlugin must be a boolean data property/);
      assert.equal(f.loads.length, 0);
      assert.equal(f.requests.length, 0);
      assert.deepEqual(f.warnings, []);
    });
  }

  for (const site of ['deployment', 'runtime']) {
    test(`${variant.name}: ${site} accessor is rejected without executing its getter`, async () => {
      const f = fixture(variant);
      let getterCalls = 0;
      Object.defineProperty(site === 'deployment' ? f.window.Environment : f.runtime.env,
        'enableExtensionPlugin', {
          configurable: true, enumerable: true,
          get() { getterCalls += 1; return false; },
        });
      if (site === 'deployment') {
        await assert.rejects(f.attach(), /enableExtensionPlugin must be a boolean data property/);
      }
      await assert.rejects(f.hub.loadExtensionPlugin('main-app'),
        /enableExtensionPlugin must be a boolean data property/);
      assert.equal(getterCalls, 0);
      assert.equal(f.requests.length, 0);
      assert.equal(f.loads.length, 0);
    });
  }

  test(`${variant.name}: inherited deployment flag is not an explicit deployment capability`, async () => {
    const f = fixture(variant, Object.create({ enableExtensionPlugin: false }));
    await f.attach();
    assert.equal(f.runtime.env.enableExtensionPlugin, true);
    await f.hub.loadExtensionPlugin('main-app');
    assert.equal(f.requests.length, 1);
  });

  test(`${variant.name}: inherited deployment getter is not evaluated by attach or discovery`, async () => {
    let getterCalls = 0;
    const inherited = Object.defineProperty({}, 'enableExtensionPlugin', {
      get() { getterCalls += 1; return false; },
    });
    const f = fixture(variant, Object.create(inherited));
    await f.attach();
    await f.hub.loadExtensionPlugin('main-app');
    assert.equal(getterCalls, 0);
    assert.equal(f.requests.length, 1);
  });

  for (const [deployed, model] of [[false, 'true'], [true, 'false']]) {
    test(`${variant.name}: explicit deployment ${deployed} survives real model parameter override ${model}`, async () => {
      const f = fixture(variant, { enableExtensionPlugin: deployed });
      await f.attach();
      await f.guard.initEnvironment({ userParam: { enableExtensionPlugin: model } });
      assert.equal(f.runtime.env.enableExtensionPlugin, model === 'true',
        'The actual model attach path still runs; the deployment decision has its own precedence');
      await f.hub.loadExtensionPlugin('main-app');
      assert.equal(f.loads.length, deployed ? 1 : 0);
      assert.equal(f.requests.length, deployed ? 1 : 0);
      assert.equal(f.factory.pluginCache.size, 0);
    });
  }

  test(`${variant.name}: absent deployment permits the existing model-level boolean decision`, async () => {
    const f = fixture(variant);
    await f.attach();
    await f.guard.initEnvironment({ userParam: { enableExtensionPlugin: 'false' } });
    await f.hub.loadExtensionPlugin('main-app');
    assert.equal(f.requests.length, 0);
    assert.equal(f.loads.length, 0);
    await f.guard.initEnvironment({ userParam: { enableExtensionPlugin: 'true' } });
    await f.hub.loadExtensionPlugin('main-app');
    assert.equal(f.requests.length, 1);
  });

  test(`${variant.name}: a query parameter cannot disable an available extension`, async () => {
    const f = fixture(variant);
    f.window.location.search = '?enableExtensionPlugin=false';
    await f.attach();
    await f.hub.loadExtensionPlugin('main-app');
    assert.equal(f.requests.length, 1);
  });

  test(`${variant.name}: request rejection remains observable and uncached, including the next retry`, async () => {
    const failure = Object.assign(new Error('HTTP 503 from manifest'), { status: 503 });
    const f = fixture(variant, { enableExtensionPlugin: true }, failure);
    await f.attach();
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      await assert.rejects(f.factory.loadPlugin({
        runtimeObject: true, rtobjectName: 'ExtensionPlugin',
        rtobjectRepo: '/api/main-app/remotemodel/ext',
      }), error => error.model?.rtobjectName === 'ExtensionPlugin');
      await f.hub.loadExtensionPlugin('main-app');
      assert.equal(f.requests.length, attempt * 2);
      assert.equal(f.warnings.length, attempt);
      assert.equal(f.factory.pluginCache.size, 0);
      assert.equal(f.factory.loadQueue.size, 0);
    }
    assert.deepEqual(f.scripts, []);
  });

  test(`${variant.name}: enabled real manifest loading registers only after the script boundary succeeds`, async () => {
    const f = fixture(variant, { enableExtensionPlugin: true }, {
      status: 200,
      data: { name: 'owned-extension', version: '1', system: 'index.js' },
    });
    await f.attach();
    await f.hub.loadExtensionPlugin('main-app');
    assert.equal(f.requests.length, 1);
    assert.equal(f.scripts.length, 1);
    assert.equal(f.factory.pluginCache.size, 1);
    assert.ok(f.factory.pluginCache.has('ExtensionPlugin'));
    assert.deepEqual(f.warnings, []);
    await f.hub.loadExtensionPlugin('main-app');
    assert.equal(f.requests.length, 1, 'The real plugin factory owns successful-load caching');
  });

  test(`${variant.name}: disabling discovery neither creates nor deletes plugin registry entries`, async () => {
    const f = fixture(variant, { enableExtensionPlugin: false });
    const other = { name: 'real-other-plugin' };
    f.factory.pluginCache.set('other-plugin', other);
    await f.attach();
    await f.hub.loadExtensionPlugin('main-app');
    assert.equal(f.factory.pluginCache.size, 1);
    assert.equal(f.factory.pluginCache.get('other-plugin'), other);
    assert.equal(f.loads.length, 0);
    assert.equal(f.requests.length, 0);
  });

  test(`${variant.name}: a disabled attempt does not suppress a later enabled manifest request`, async () => {
    const f = fixture(variant, { enableExtensionPlugin: false });
    await f.attach();
    await f.hub.loadExtensionPlugin('main-app');
    assert.equal(f.requests.length, 0);
    f.window.Environment.enableExtensionPlugin = true;
    await f.hub.loadExtensionPlugin('main-app');
    assert.equal(f.loads.length, 1);
    assert.equal(f.requests.length, 1);
    assert.equal(f.warnings.length, 1);
    assert.equal(f.factory.pluginCache.size, 0);
  });

  for (const enabled of [false, true]) {
    test(`${variant.name}: createApp keeps the existing subapp discovery policy when capability is ${enabled}`, async () => {
      const f = fixture(variant, { enableExtensionPlugin: enabled });
      await f.attach();
      f.hub.registerModelLoaderProvider({
        getApp: async id => ({ id }),
        getSubAppRef: async () => undefined,
        initApp: async () => {},
      });
      const app = await f.hub.createApp('child-app');
      assert.equal(app.model.id, 'child-app');
      assert.equal(f.created.length, 1);
      assert.equal(f.loads.length, variant.automaticSubAppDiscovery && enabled ? 1 : 0);
      assert.equal(f.requests.length, variant.automaticSubAppDiscovery && enabled ? 1 : 0);
    });
  }
}

const hubVariant = variants[0];
for (const [baseUrl, origin, expected] of [
  ['/api', 'http://127.0.0.1:32118', 'http://127.0.0.1:32118/api/own-app/remotemodel/ext/package.json'],
  ['/platform/api/', 'https://localhost:32119', 'https://localhost:32119/platform/api/own-app/remotemodel/ext/package.json'],
  ['https://backend.example.test/api', 'null', 'https://backend.example.test/api/own-app/remotemodel/ext/package.json'],
  ['http://backend.example.test:8080/platform/api/', undefined, 'http://backend.example.test:8080/platform/api/own-app/remotemodel/ext/package.json'],
]) {
  test(`hub explicit entry resolves ${baseUrl} through the real plugin factory without changing API origin`, async () => {
    const f = fixture(hubVariant, { enableExtensionPlugin: true });
    f.runtime.env.baseUrl = baseUrl;
    f.window.location.origin = origin;
    await f.attach();
    await f.hub.loadExtensionPlugin('own-app');
    assert.equal(f.requests.length, 1);
    assert.equal(f.requests[0].url, expected);
    const url = new URL(f.requests[0].url);
    assert.notEqual(url.hostname, 'api');
    assert.ok(['http:', 'https:'].includes(url.protocol));
  });
}

for (const [baseUrl, origin] of [
  ['//api', 'http://localhost:32118'],
  ['file:///api', 'http://localhost:32118'],
  ['javascript:alert(1)', 'http://localhost:32118'],
  ['ftp://backend.example.test/api', 'http://localhost:32118'],
  ['api', 'http://localhost:32118'],
  ['/api', 'null'],
  ['/api', undefined],
  ['/api', 'file:///'],
  ['/api', 'https://localhost:32118/unexpected-path'],
  ['/api', 'https://user:secret@localhost:32118'],
  ['https://backend.example.test/api?other=path', 'http://localhost:32118'],
  ['https://user:secret@backend.example.test/api', 'http://localhost:32118'],
]) {
  test(`hub explicit entry rejects unsafe API/origin ${baseUrl} / ${String(origin)} before dispatch`, async () => {
    const f = fixture(hubVariant, { enableExtensionPlugin: true });
    f.runtime.env.baseUrl = baseUrl;
    f.window.location.origin = origin;
    await assert.rejects(f.hub.loadExtensionPlugin('own-app'),
      /Extension plugin requires a valid HTTP\(S\) API URL/);
    assert.equal(f.loads.length, 0);
    assert.equal(f.requests.length, 0);
    assert.deepEqual(f.warnings, [], 'Configuration errors are not downgraded into discovery warnings');
  });
}

test('hub explicit entry binds encoded application identity and configured remote model prefix', async () => {
  const f = fixture(hubVariant, { enableExtensionPlugin: true });
  f.runtime.env.remoteModelUrl = '/native/remotemodel/';
  await f.hub.loadExtensionPlugin('app&own');
  assert.equal(f.requests[0].url,
    'http://127.0.0.1:32118/api/app%26own/native/remotemodel/ext/package.json');
});

test('hub explicit false does not resolve an origin, parse malformed paths or call the real factory', async () => {
  const f = fixture(hubVariant, { enableExtensionPlugin: false });
  let originReads = 0;
  Object.defineProperty(f.window.location, 'origin', {
    get() { originReads += 1; throw new Error('No origin is available'); },
  });
  f.runtime.env.baseUrl = 'file:///not-an-api';
  f.runtime.env.remoteModelUrl = null;
  await f.hub.loadExtensionPlugin('');
  assert.equal(originReads, 0);
  assert.equal(f.loads.length, 0);
  assert.equal(f.requests.length, 0);
  assert.equal(f.factory.pluginCache.size, 0);
});

const realExtensionModule = `System.register([], function (exports) {
  return { execute: function () {
    exports('default', { install: function (app, options) {
      app.config.globalProperties.ownedExtensionInstall = { installed: true, options: options };
      app.component('OwnedExtension', { render: function () { return null; } });
    } });
  } };
});`;

for (const [name, baseUrl, entry, styles, expectedScript, expectedStyles] of [
  [
    'relative API',
    '/api',
    './chunks/index.system.js',
    ['./styles/main.css', '../shared/theme.css', '/assets/global.css', 'https://cdn.example.test/base.css'],
    'http://127.0.0.1:32118/api/main-app/remotemodel/ext/chunks/index.system.js',
    [
      'http://127.0.0.1:32118/api/main-app/remotemodel/ext/styles/main.css',
      'http://127.0.0.1:32118/api/main-app/remotemodel/shared/theme.css',
      'http://127.0.0.1:32118/assets/global.css',
      'https://cdn.example.test/base.css',
    ],
  ],
  [
    'absolute HTTPS API',
    'https://backend.example.test/platform/api',
    '../shared/index.system.js',
    './theme.css',
    'https://backend.example.test/platform/api/main-app/remotemodel/shared/index.system.js',
    ['https://backend.example.test/platform/api/main-app/remotemodel/ext/theme.css'],
  ],
]) {
  test(`hub ${name}: actual SystemJS imports the exact script and real Vue installation receives normalized styles`, async () => {
    const f = fixture(hubVariant, { enableExtensionPlugin: true }, {
      status: 200,
      data: { name: 'owned-extension-real', version: '1', system: entry, styles },
    }, true);
    f.runtime.env.baseUrl = baseUrl;
    f.scriptResources.set(expectedScript, realExtensionModule);
    await f.withRealSystem(() => f.hub.loadExtensionPlugin('main-app'));
    assert.deepEqual(f.importMaps, [{
      imports: { 'owned-extension-real': expectedScript },
      styles: { 'owned-extension-real': expectedStyles },
    }]);
    assert.deepEqual(f.scriptRequests, [expectedScript]);
    assert.equal(f.system.resolve('owned-extension-real'), expectedScript);
    assert.equal(f.vueApp.config.globalProperties.ownedExtensionInstall.installed, true);
    assert.deepEqual(plain(f.vueApp.config.globalProperties.ownedExtensionInstall.options), {});
    assert.ok(f.vueApp.component('OwnedExtension'));
    assert.equal(f.factory.pluginCache.size, 1);
    assert.equal(f.factory.cache.size, 1);
    assert.ok(f.factory.cache.has(expectedScript));
    assert.equal(f.factory.pluginCodes.length, 1);
    assert.deepEqual(f.errors, []);
    assert.deepEqual(f.warnings, []);
    const secondApp = require('vue').createApp({});
    f.factory.register(secondApp);
    assert.equal(secondApp.config.globalProperties.ownedExtensionInstall.installed, true);
    await f.withRealSystem(() => f.hub.loadExtensionPlugin('main-app'));
    assert.equal(f.requests.length, 1, 'Successful plugin caching skips a second manifest request');
    assert.deepEqual(f.scriptRequests, [expectedScript]);
    assert.equal(f.importMaps.length, 1);
  });
}

for (const [name, script, styles, expectedScript, expectedStyles] of [
  [
    'ordinary local repository',
    './chunks/index.system.js',
    ['./styles/main.css', '../shared.css'],
    'https://plugins.example.test/base/@owned/plugin/chunks/index.system.js',
    [
      'https://plugins.example.test/base/@owned/plugin/styles/main.css',
      'https://plugins.example.test/base/@owned/shared.css',
    ],
  ],
  [
    'absolute script and style in a local repository',
    'https://scripts.example.test/extension/index.system.js',
    'https://styles.example.test/extension/main.css',
    'https://scripts.example.test/extension/index.system.js',
    ['https://styles.example.test/extension/main.css'],
  ],
]) {
  test(`hub ${name}: real factory preserves local join behavior and absolute HTTP(S) assets`, async () => {
    const f = fixture(hubVariant, {}, {
      status: 200,
      data: { name: 'owned-extension-local', version: '1', system: script, styles },
    }, true);
    f.runtime.env.pluginBaseUrl = 'https://plugins.example.test/base';
    f.scriptResources.set(expectedScript, realExtensionModule);
    const loaded = await f.withRealSystem(() => f.factory.loadPlugin({
      runtimeObject: true, rtobjectName: 'OwnedLocalExtension',
      rtobjectRepo: '@owned/plugin', pluginParams: { ownValue: 'unchanged' },
    }));
    assert.equal(loaded, true);
    assert.equal(f.requests[0].url,
      'https://plugins.example.test/base/@owned/plugin/package.json');
    assert.deepEqual(f.importMaps, [{
      imports: { 'owned-extension-local': expectedScript },
      styles: { 'owned-extension-local': expectedStyles },
    }]);
    assert.deepEqual(f.scriptRequests, [expectedScript]);
    assert.deepEqual(plain(f.vueApp.config.globalProperties.ownedExtensionInstall.options),
      { ownValue: 'unchanged' });
    assert.equal(f.factory.pluginCodes.length, 1);
    assert.deepEqual(f.errors, []);
  });
}

test('hub manifest failure retries through the real factory and actual SystemJS without a fabricated loaded state', async () => {
  const expectedScript = 'http://127.0.0.1:32118/api/main-app/remotemodel/ext/index.system.js';
  const f = fixture(hubVariant, { enableExtensionPlugin: true }, (_, count) => count === 1
    ? Object.assign(new Error('Controlled HTTP 503'), { status: 503 })
    : {
      status: 200,
      data: { name: 'owned-extension-retry', version: '1', system: 'index.system.js', styles: 'style.css' },
    }, true);
  f.scriptResources.set(expectedScript, realExtensionModule);
  await f.withRealSystem(() => f.hub.loadExtensionPlugin('main-app'));
  assert.equal(f.factory.pluginCache.size, 0);
  assert.equal(f.factory.cache.size, 0);
  assert.equal(f.factory.pluginCodes.length, 0);
  assert.deepEqual(f.scriptRequests, []);
  assert.equal(f.warnings.length, 1);
  await f.withRealSystem(() => f.hub.loadExtensionPlugin('main-app'));
  assert.equal(f.requests.length, 2);
  assert.deepEqual(f.scriptRequests, [expectedScript]);
  assert.equal(f.factory.pluginCache.size, 1);
  assert.equal(f.factory.cache.size, 1);
  assert.equal(f.vueApp.config.globalProperties.ownedExtensionInstall.installed, true);
  assert.deepEqual(f.errors, []);
});

test('hub actual SystemJS script rejection remains uncached and a corrected manifest can retry the installation', async () => {
  const prefix = 'http://127.0.0.1:32118/api/main-app/remotemodel/ext';
  const failedScript = `${prefix}/unavailable.system.js`;
  const correctedScript = `${prefix}/corrected.system.js`;
  const failure = new Error('Controlled unavailable script');
  const f = fixture(hubVariant, { enableExtensionPlugin: true }, (_, count) => ({
    status: 200,
    data: {
      name: 'owned-extension-script-retry', version: String(count),
      system: count === 1 ? 'unavailable.system.js' : 'corrected.system.js', styles: [],
    },
  }), true);
  f.scriptResources.set(failedScript, failure);
  f.scriptResources.set(correctedScript, realExtensionModule);
  await f.withRealSystem(() => f.hub.loadExtensionPlugin('main-app'));
  assert.equal(f.factory.pluginCache.size, 0);
  assert.equal(f.factory.cache.size, 0);
  assert.equal(f.factory.pluginCodes.length, 0);
  assert.equal(f.errors.length, 1);
  assert.equal(f.errors[0], failure);
  assert.equal(f.vueApp.config.globalProperties.ownedExtensionInstall, undefined);
  await f.withRealSystem(() => f.hub.loadExtensionPlugin('main-app'));
  assert.deepEqual(f.scriptRequests, [failedScript, correctedScript]);
  assert.equal(f.factory.pluginCache.size, 1);
  assert.equal(f.factory.cache.size, 1);
  assert.equal(f.factory.cache.has(failedScript), false);
  assert.equal(f.factory.cache.has(correctedScript), true);
  assert.equal(f.vueApp.config.globalProperties.ownedExtensionInstall.installed, true);
  assert.equal(f.errors.length, 1, 'The previous failure remains part of the evidence');
});
