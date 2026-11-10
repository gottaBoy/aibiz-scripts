import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  cp, link, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile,
} from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';
import {
  buildLocalDesignIndex, pluginRoot,
} from '../../modelingweb/local-plugins/design-index/build.mjs';
import { loadMigrationContract } from '../harness-modeling-core-audit.mjs';
import { readDesignIndexReplacement } from '../prepare-native-design-index-replacement.mjs';

const workspace = resolve(pluginRoot, '../../..');
const require = createRequire(join(workspace, 'modelingweb/app/package.json'));
const ts = require('typescript');
const postcss = require('postcss');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const plain = value => JSON.parse(JSON.stringify(value));
const inputNames = [
  'build.mjs', 'package.json', 'src/controller.ts', 'src/index.ts', 'src/model.ts',
  'src/style.css', 'tests/permitted-menu.test.mjs', 'tests/todo-counter.test.mjs',
];
const outputNames = ['build-receipt.json', 'index.mjs', 'index.system.js', 'style.css'];
const receipt = JSON.parse(await readFile(join(pluginRoot, 'dist/build-receipt.json'), 'utf8'));
const esmCode = await readFile(join(pluginRoot, 'dist/index.mjs'), 'utf8');
const systemCode = await readFile(join(pluginRoot, 'dist/index.system.js'), 'utf8');
const controls = ['appmenu', 'leftsidemenu', 'rightsidemenu', 'topsidemenu', 'bottomsidemenu', 'captionbar'];
const tick = () => new Promise(done => setImmediate(done));

async function files(root, prefix = '') {
  const paths = [];
  for (const entry of await readdir(join(root, prefix), { withFileTypes: true })) {
    assert.equal(entry.isSymbolicLink(), false, entry.name);
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) paths.push(...await files(root, path));
    else paths.push(path);
  }
  return paths.sort();
}

async function buildFixture(t) {
  const base = await mkdtemp(join(tmpdir(), 'design-index-build-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = join(base, 'modelingweb/local-plugins/design-index');
  const app = join(base, 'modelingweb/app');
  await mkdir(dirname(root), { recursive: true });
  await cp(pluginRoot, root, { recursive: true });
  await mkdir(app, { recursive: true });
  await symlink(join(workspace, 'modelingweb/app/node_modules'), join(app, 'node_modules'), 'dir');
  const { buildLocalDesignIndex: build } = await import(pathToFileURL(join(root, 'build.mjs')));
  const output = join(root, 'dist');
  const outside = join(base, 'outside');
  await mkdir(outside);
  const before = new Map(await Promise.all(outputNames.map(async name =>
    [name, await readFile(join(output, name))])));
  return { base, root, build, output, outside, before };
}

async function unchanged(data, excluded = []) {
  for (const [name, bytes] of data.before) {
    if (!excluded.includes(name)) assert.deepEqual(await readFile(join(data.output, name)), bytes, name);
  }
}

function emitter() {
  const listeners = new Map();
  return {
    on(event, callback) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(callback);
    },
    off(event, callback) { listeners.get(event)?.delete(callback); },
    emit(event, ...args) {
      for (const callback of [...(listeners.get(event) ?? [])]) callback(...args);
    },
    count(event) { return listeners.get(event)?.size ?? 0; },
  };
}

function loadHostSource(path, runtime, boundaries = {}) {
  const compiled = ts.transpileModule(path.code, {
    fileName: path.name, reportDiagnostics: true,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  });
  assert.equal(compiled.diagnostics.length, 0);
  const exports = {};
  runInNewContext(compiled.outputText, {
    exports, ibiz: runtime,
    require(id) {
      assert.ok(Object.hasOwn(boundaries, id), `Unspecified host-test dependency: ${id}`);
      return boundaries[id];
    },
  }, { filename: path.name });
  return exports;
}

const hostRegister = {
  name: 'register-center.ts',
  code: await readFile(join(workspace,
    'ibiz-app-hub/packages/runtime/src/register/register-center.ts'), 'utf8'),
};
const hostCommon = {
  name: 'common-register.ts',
  code: await readFile(join(workspace,
    'ibiz-app-hub/packages/runtime/src/register/helper/common-register.ts'), 'utf8'),
};
const hostViewRegister = {
  name: 'view-register.ts',
  code: await readFile(join(workspace,
    'ibiz-app-hub/packages/runtime/src/register/helper/view-register.ts'), 'utf8'),
};
const hostExtendMenu = {
  name: 'extend-menu-base.controller.ts',
  code: await readFile(join(workspace,
    'modelingweb/packages-latest/@ibiz-template/vue3-components/src/panel-component/app-extend-menu/extend-menu-base/extend-menu-base.controller.ts'), 'utf8'),
};
const linkedHostExtendMenu = {
  name: 'linked-extend-menu-base.controller.ts',
  code: await readFile(join(workspace,
    'ibiz-app-hub/components/ibiz-next-vue3/src/panel-component/app-extend-menu/extend-menu-base/extend-menu-base.controller.ts'), 'utf8'),
};

function model() {
  return {
    id: 'modelingindex', appId: 'ModelDesign', viewType: 'APPINDEXVIEW',
    sysPFPluginId: 'design_index_view',
    controls: [{ id: 'captionbar', name: 'captionbar', caption: 'Original caption' }],
    viewLayoutPanel: {
      id: 'layout', controls: controls.filter(name => name !== 'captionbar')
        .map(name => ({ id: name, name, appMenuItems: [] })),
    },
  };
}

function fixture(format = 'system', hostVersion = 'latest') {
  const dispatched = [];
  const config = new Map();
  const funcs = new Map();
  const errors = [];
  const warnings = [];
  // Controlled host transport boundary for the work-item counter. The real host
  // exposes an axios-like `ibiz.net`, so the fixture records requests and lets a
  // test choose the payload, a transport failure or a deferred response.
  const counter = {
    requests: [], payload: { my_todo_count: 0 }, failure: undefined,
    deferred: false, resolve: null, reject: null,
  };
  const runtime = {
    env: { appId: 'ModelDesign' },
    log: { error: error => errors.push(error), warn: error => warnings.push(error) },
    net: {
      async post(url, params) {
        counter.requests.push({ url, params });
        if (counter.deferred) {
          const response = await new Promise((done, fail) => {
            counter.resolve = done;
            counter.reject = fail;
          });
          if (response instanceof Error) throw response;
          return response;
        }
        if (counter.failure) throw counter.failure;
        return { status: 200, ok: true, data: counter.payload };
      },
    },
    hub: {
      getApp() { return { getAppFunc: id => funcs.get(id), model: { appPFPluginRefs: [] } }; },
      getPlugin(id) {
        return id === 'design_index_view'
          ? { pluginType: 'VIEW_CUSTOM', pluginCode: 'DESIGN_INDEX_VIEW' } : undefined;
      },
      config: { view: { async get(id) { return config.get(id); } } },
    },
    plugin: { async loadPlugin() {} },
    commands: {
      execute(...args) {
        dispatched.push(args);
        return Promise.resolve({ rendered: false, fixtureDispatch: true });
      },
    },
    debugCalls: 0,
    devTool: { triggerVisible() { runtime.debugCalls += 1; return true; } },
    dynamicMenus: [],
    async calcDynamicMenu(...args) { runtime.dynamicMenus.push(args); },
  };
  const { RegisterCenter } = loadHostSource(hostRegister, runtime);
  runtime.register = new RegisterCenter();
  const common = loadHostSource(hostCommon, runtime);
  const registry = loadHostSource(hostViewRegister, runtime, { './common-register': common });
  // Controlled lifecycle boundary; actual installed host exports are checked separately below.
  class HostViewController {
    constructor(input, context, params, ctx) {
      this.model = input;
      this.context = context;
      this.params = params;
      this.ctx = ctx ?? { evt: emitter() };
      this.state = { presetClassList: [], isCreated: false };
      this.engines = [{}];
    }
    async onCreated() { this.state.isCreated = true; }
    async onMounted() { this.state.isMounted = true; }
    async onDestroyed() { this.state.isDestroyed = true; }
    setLayoutPanel(panel) { this.layoutPanel = panel; }
  }
  const hostView = { name: 'IBizView', fixtureHostComponent: true };
  const peers = {
    '@ibiz-template/runtime': {
      ViewController: HostViewController, AppFuncCommand: { TAG: 'AppFunc' },
      calcDynamicMenu: (...args) => runtime.calcDynamicMenu(...args),
      registerViewProvider: registry.registerViewProvider,
    },
    '@ibiz-template/vue3-util': { IBizView: hostView },
  };
  if (hostVersion === 'linked') delete peers['@ibiz-template/runtime'].calcDynamicMenu;
  const exported = {};
  const sandbox = { ibiz: runtime };
  if (format === 'system') {
    let registrations = 0;
    runInNewContext(systemCode, {
      ...sandbox,
      System: {
        register(dependencies, declare) {
          registrations += 1;
          assert.deepEqual(plain(dependencies).sort(), receipt.runtimeImports);
          const declaration = declare((name, value) => {
            if (typeof name === 'object') Object.assign(exported, name);
            else exported[name] = value;
            return value;
          });
          assert.equal(declaration.setters.length, dependencies.length);
          declaration.setters.forEach((setter, index) => setter(peers[dependencies[index]]));
          declaration.execute();
        },
      },
    }, { filename: 'design-index/dist/index.system.js' });
    assert.equal(registrations, 1);
  } else {
    const compiled = ts.transpileModule(esmCode, {
      reportDiagnostics: true,
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    });
    assert.equal(compiled.diagnostics.length, 0);
    runInNewContext(compiled.outputText, {
      ...sandbox, exports: exported,
      require(id) {
        assert.ok(Object.hasOwn(peers, id), `Unexpected bundled/external dependency: ${id}`);
        return peers[id];
      },
    }, { filename: 'design-index/dist/index.mjs (CommonJS test transform)' });
  }
  const components = [];
  exported.default.install({ component: (...args) => components.push(args) });
  const provider = runtime.register.get('VIEW_VIEW_CUSTOM_DESIGN_INDEX_VIEW');
  const context = {
    srfappid: 'ModelDesign',
    clone() { return { srfappid: this.srfappid }; },
  };
  const controller = provider.createController(model(), context, { retained: true });
  return { exported, provider, controller, runtime, context, peers, components, registry,
    dispatched, config, funcs, errors, warnings, counter, HostViewController, hostView };
}

function panelFixture(items = {}) {
  const originals = new Map();
  const clicked = [];
  const nav = {
    model: { id: 'nav', rawItem: { predefinedType: 'NAV_POS_INDEX' } },
    state: { currentKey: '' }, created: [], closed: [],
    onViewCreated(event) { this.created.push(event); },
    async closeViewByKeys(keys) { this.closed.push(keys); return true; },
  };
  const tabs = { model: { id: 'tabs', rawItem: { predefinedType: 'NAV_TABS' } } };
  const shortcut = { model: { id: 'shortcut', rawItem: { predefinedType: 'SHORTCUT' } } };
  const menus = {};
  for (const name of controls.filter(name => name.endsWith('sidemenu'))) {
    const appMenuItems = items[name] ?? [];
    const states = {};
    const visit = values => {
      for (const item of values) {
        states[item.id] = { visible: true, permitted: true };
        visit(item.appMenuItems ?? []);
      }
    };
    visit(appMenuItems);
    menus[name] = {
      appMenu: { name, appMenuItems }, state: { menuItemsState: states },
      context: { srfappid: 'ModelDesign', clone() { return { srfappid: this.srfappid }; } },
      params: { nativeParam: 42 }, routeDepth: 2, itemProviders: {},
      async handleClickMenuItem(item, event, useDepth) {
        clicked.push({ menu: name, item, event, useDepth });
        return item.fixtureFailure ? Promise.reject(new Error(item.fixtureFailure)) : true;
      },
    };
    originals.set(menus[name], menus[name].handleClickMenuItem);
  }
  originals.set(nav, { onViewCreated: nav.onViewCreated, closeViewByKeys: nav.closeViewByKeys });
  const panel = {
    state: { isCreated: true }, evt: emitter(),
    panelItems: { nav, tabs, shortcut, ...menus },
    providers: { shortcut: { component: 'IBizShortCut' } },
  };
  return { panel, nav, menus, clicked, originals };
}

async function nativePanelFixture(data, items = {}, hostVersion = 'latest') {
  const layout = panelFixture();
  const permissions = new Set();
  const providerCalls = [];
  const app = { authority: { calcByResCode: key => !permissions.has(key) } };
  data.runtime.hub.getApp = () => ({ ...app, getAppFunc: id => data.funcs.get(id) });
  data.runtime.i18n = { t: (_tag, fallback) => fallback };
  class PanelItemController {
    constructor(input, panel) {
      this.model = input;
      this.panel = panel;
      this.state = { items: [], menuItemsState: {} };
    }
    async onInit() {}
  }
  const { ExtendMenuBaseController } = loadHostSource(
    hostVersion === 'linked' ? linkedHostExtendMenu : hostExtendMenu, data.runtime, {
    'qx-util': { notNilEmpty: value => Array.isArray(value) && value.length > 0 },
    '@ibiz-template/runtime': {
      PanelItemController, AppFuncCommand: { TAG: 'AppFunc' },
      // Reproduce the host's initial missing appMenu, not an already-bound synthetic menu.
      getControl: () => undefined,
      calcDynamicMenu: (...args) => data.runtime.calcDynamicMenu(...args),
      async getAppMenuItemProvider(item) {
        providerCalls.push(item.id);
        return item.fixtureProvider;
      },
    },
    '@ibiz-template/core': {
      RuntimeModelError: Error,
      recursiveIterate(root, visit) {
        visit(root);
        for (const { item } of (root.appMenuItems ?? []).flatMap(function flatten(item) {
          return [{ item }, ...(item.appMenuItems ?? []).flatMap(flatten)];
        })) visit(item);
      },
    },
    './extend-menu-base.state': { ExtendMenuBase: class {} },
  });
  const roles = ['LEFT_SIDE_MENU', 'RIGHT_SIDE_MENU', 'TOP_SIDE_MENU', 'BOTTOM_SIDE_MENU'];
  for (const [index, name] of controls.filter(name => name.endsWith('sidemenu')).entries()) {
    const control = data.controller.model.viewLayoutPanel.controls.find(item => item.name === name);
    control.appMenuItems = items[name] ?? [];
    const panel = {
      context: data.context, params: { nativeParam: 42 },
      view: { model: data.controller.model, modal: { routeDepth: 2 } },
    };
    const menu = new ExtendMenuBaseController({
      id: `host-${name}`, rawItem: { predefinedType: roles[index] },
    }, panel);
    menu.appMenuName = name;
    await menu.onInit();
    assert.equal(menu.appMenu, undefined);
    assert.deepEqual(plain(menu.state.items), []);
    layout.panel.panelItems[name] = menu;
    layout.menus[name] = menu;
  }
  return { ...layout, permissions, providerCalls };
}

function hostSystemExports(path, code) {
  const options = { allowJs: true, noLib: true, noResolve: true, noEmit: true };
  const host = ts.createCompilerHost(options);
  const ast = ts.createSourceFile(path, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.equal(ast.parseDiagnostics.length, 0);
  host.getSourceFile = name => name === path ? ast : undefined;
  const program = ts.createProgram([path], options, host);
  const checker = program.getTypeChecker();
  let declare;
  const find = node => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) &&
        node.expression.expression.getText(ast) === 'System' && node.expression.name.text === 'register') {
      assert.equal(declare, undefined, 'Host should contain one System.register declaration');
      declare = node.arguments.find(arg => ts.isFunctionExpression(arg) || ts.isArrowFunction(arg));
    }
    ts.forEachChild(node, find);
  };
  find(ast);
  assert.ok(declare?.parameters[0], path);
  const exportSymbol = checker.getSymbolAtLocation(declare.parameters[0].name);
  assert.ok(exportSymbol);
  const exports = new Map();
  const collect = node => {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) &&
        checker.getSymbolAtLocation(node.expression) === exportSymbol) {
      if (ts.isStringLiteral(node.arguments[0])) exports.set(node.arguments[0].text, node.arguments[1]);
      else if (ts.isObjectLiteralExpression(node.arguments[0])) {
        for (const property of node.arguments[0].properties) {
          if (ts.isPropertyAssignment(property)) exports.set(property.name.text, property.initializer);
        }
      }
    }
    ts.forEachChild(node, collect);
  };
  collect(declare.body);
  return { ast, exports };
}

test('editable source, unchanged manifest and exact four-file dist match the reader contract', async () => {
  assert.deepEqual(await files(pluginRoot),
    ['README.md', ...inputNames, ...outputNames.map(name => `dist/${name}`)].sort());
  assert.deepEqual(await files(join(pluginRoot, 'dist')), outputNames);
  assert.deepEqual(await readFile(join(pluginRoot, 'src/style.css')),
    await readFile(join(pluginRoot, 'dist/style.css')));
  const manifest = JSON.parse(await readFile(join(pluginRoot, 'package.json'), 'utf8'));
  assert.deepEqual(manifest, {
    name: '@aibiz/design-index', version: '0.1.0', private: true, type: 'module',
    main: 'dist/index.mjs', module: 'dist/index.mjs', system: 'dist/index.system.js',
    styles: ['dist/style.css'],
    scripts: {
      build: 'node build.mjs',
      test: 'node build.mjs && node --experimental-strip-types --test tests/permitted-menu.test.mjs tests/todo-counter.test.mjs',
    },
    peerDependencies: { '@ibiz-template/runtime': '*', '@ibiz-template/vue3-util': '*' },
    devDependencies: { rollup: '4.9.3', typescript: '5.3.3' },
  });
});

test('receipt binds every source/artifact and real pinned toolchain without Swagger or native claims', async () => {
  assert.deepEqual(Object.keys(receipt).sort(), [
    'compilerChecks', 'inputs', 'nativeCompatibilityVerified', 'originalSourceRecovered', 'outputs',
    'package', 'runtimeImports', 'schemaVersion', 'sourceStatus', 'supportedPluginCodes', 'toolchain',
  ]);
  assert.equal(receipt.schemaVersion, 1);
  assert.deepEqual(receipt.package, { name: '@aibiz/design-index', version: '0.1.0' });
  assert.equal(receipt.sourceStatus, 'independent-local-implementation');
  assert.equal(receipt.originalSourceRecovered, false);
  assert.equal(receipt.nativeCompatibilityVerified, false);
  assert.deepEqual(receipt.supportedPluginCodes, ['DESIGN_INDEX_VIEW']);
  assert.equal(receipt.compilerChecks,
    'TypeScript isolated transpilation and syntax diagnostics; no full host application typecheck');
  assert.deepEqual(receipt.inputs.map(item => item.path), inputNames);
  assert.deepEqual(receipt.outputs.map(item => item.path), outputNames.filter(name => name !== 'build-receipt.json'));
  for (const input of receipt.inputs) {
    assert.equal(input.sha256, hash(await readFile(join(pluginRoot, input.path))), input.path);
  }
  for (const output of receipt.outputs) {
    assert.equal(output.sha256, hash(await readFile(join(pluginRoot, 'dist', output.path))), output.path);
  }
  assert.deepEqual(receipt.toolchain, {
    typescript: { version: '5.3.3', sha256: hash(await readFile(require.resolve('typescript'))) },
    rollup: { version: '4.9.3',
      sha256: hash(await readFile(createRequire(require.resolve('vite')).resolve('rollup'))) },
  });
  assert.deepEqual(receipt.runtimeImports, ['@ibiz-template/runtime', '@ibiz-template/vue3-util']);
});

test('in-memory build reproduces exact committed artifacts and receipt without creating its output', async () => {
  const outputDir = join(pluginRoot, '.in-memory-no-output');
  await assert.rejects(readdir(outputDir), { code: 'ENOENT' });
  const built = await buildLocalDesignIndex({ writeOutputs: false, outputDir });
  assert.deepEqual(built.receipt, receipt);
  assert.deepEqual([...built.artifacts.keys()], ['index.mjs', 'index.system.js', 'style.css']);
  for (const [name, bytes] of built.artifacts) {
    assert.deepEqual(Buffer.from(bytes), await readFile(join(pluginRoot, 'dist', name)));
  }
  await assert.rejects(readdir(outputDir), { code: 'ENOENT' });
});

test('reader consumes the actual package with partial replacement and fail-closed provenance', () => {
  const { plugin, files: delivery } = readDesignIndexReplacement({
    workspace, contract: loadMigrationContract(workspace),
  });
  assert.equal(plugin.from, '@ibiz-template-plugin/layout-design@0.0.3-alpha.90');
  assert.equal(plugin.to, '@aibiz/design-index@0.1.0');
  assert.equal(plugin.pluginType, 'VIEW_CUSTOM');
  assert.equal(plugin.pluginCode, 'DESIGN_INDEX_VIEW');
  assert.deepEqual(plugin.supportedPluginCodes, ['DESIGN_INDEX_VIEW']);
  assert.equal(plugin.partialReplacement, true);
  for (const name of ['originalSourceRecovered', 'originalRepositoryAuthenticated',
    'nativeCompatibilityVerified', 'acceptedForProduction']) assert.equal(plugin[name], false, name);
  assert.equal(plugin.originalMigrationAcceptance, 'not-satisfied-by-independent-replacement');
  assert.deepEqual(delivery.entries.map(file => file.path).sort(),
    ['dist/index.mjs', 'dist/index.system.js', 'dist/style.css', 'package.json']);
});

test('both local host SystemJS versions satisfy every mandatory peer import and controller method', async () => {
  const imported = new Map();
  const namespaces = [];
  const ast = ts.createSourceFile('design-index.mjs', esmCode, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  assert.equal(ast.parseDiagnostics.length, 0);
  for (const statement of ast.statements) {
    if (!ts.isImportDeclaration(statement)) continue;
    if (ts.isNamespaceImport(statement.importClause.namedBindings)) {
      namespaces.push(statement.moduleSpecifier.text);
      continue;
    }
    const names = statement.importClause.namedBindings.elements
      .map(item => (item.propertyName ?? item.name).text).sort();
    imported.set(statement.moduleSpecifier.text, names);
  }
  assert.deepEqual([...imported], [
    ['@ibiz-template/runtime', ['AppFuncCommand', 'ViewController', 'registerViewProvider'].sort()],
    ['@ibiz-template/vue3-util', ['IBizView']],
  ]);
  assert.deepEqual(namespaces, ['@ibiz-template/runtime']);
  for (const [peer, names] of imported) {
    for (const base of ['ibiz-app-hub/packages', 'modelingweb/packages-latest/@ibiz-template']) {
      const path = join(workspace, base, peer.split('/')[1], 'dist/index.system.min.js');
      const { exports, ast: hostAst } = hostSystemExports(path, await readFile(path, 'utf8'));
      for (const name of names) assert.ok(exports.has(name), `Missing actual host export: ${peer}/${name}`);
      if (peer === '@ibiz-template/runtime') {
        const view = exports.get('ViewController');
        assert.equal(ts.isClassExpression(view), true);
        const methods = view.members.map(member => member.name?.text);
        for (const name of ['onCreated', 'onMounted', 'onDestroyed', 'setLayoutPanel']) {
          assert.ok(methods.includes(name), `Missing actual host ViewController method: ${name}`);
        }
        assert.match(view.getText(hostAst), /initEngines/);
      }
    }
  }
});

for (const format of ['system', 'esm']) {
  test(`${format} built installer uses real host registry resolution and registers no Swagger provider`, async () => {
    const data = fixture(format);
    assert.deepEqual(Object.keys(data.exported).sort(), [
      'DesignIndexController', 'DesignIndexProvider', 'default', 'requiredControlNames', 'supportedPluginCodes',
    ]);
    assert.deepEqual(plain(data.exported.supportedPluginCodes), ['DESIGN_INDEX_VIEW']);
    assert.deepEqual(plain(data.exported.requiredControlNames), controls);
    assert.equal(Object.isFrozen(data.exported.supportedPluginCodes), true);
    assert.deepEqual(data.components, [['AibizDesignIndexView', data.hostView]]);
    assert.equal(data.provider.component, 'AibizDesignIndexView');
    assert.ok(await data.registry.getViewProvider(model()) instanceof data.exported.DesignIndexProvider,
      'The installed host registry must resolve the exact supplied sysPFPluginId');
    assert.equal(data.runtime.register.get('VIEW_VIEW_CUSTOM_SWAGGER_PREVIEW_VIEW'), undefined);
  });
}

test('installed provider resolves the real plugin key, uses a cloned model and preserves caller params', async () => {
  const data = fixture();
  const resolved = await data.registry.getViewProvider(model());
  assert.ok(resolved instanceof data.exported.DesignIndexProvider);
  assert.equal(data.runtime.register.get('VIEW_VIEW_CUSTOM_SWAGGER_PREVIEW_VIEW'), undefined);
  const input = model();
  const before = structuredClone(input);
  const params = { parentData: '{"original":true}', kept: 'yes' };
  const controller = resolved.createController(input, data.context, params, { evt: emitter() });
  assert.ok(controller instanceof data.HostViewController);
  assert.ok(controller instanceof data.exported.DesignIndexController);
  assert.notEqual(controller.model, input);
  controller.model.viewLayoutPanel.controls[0].caption = 'local-only';
  controller.params.kept = 'changed';
  assert.deepEqual(input, before);
  assert.deepEqual(params, { parentData: '{"original":true}', kept: 'yes' });
  assert.equal(controller.sourceStatus, 'independent-local-implementation');
});

test('invalid/untransformed index, missing or duplicated six controls and Swagger fail explicitly', () => {
  const data = fixture();
  const malformed = [
    null, { viewType: 'APPINDEXVIEW' }, { ...model(), viewType: 'DEEDITVIEW' },
    { ...model(), sysPFPluginId: 'swagger_preview_view' },
  ];
  for (const name of controls) {
    const missing = model();
    missing.controls = missing.controls.filter(control => control.name !== name);
    missing.viewLayoutPanel.controls = missing.viewLayoutPanel.controls.filter(control => control.name !== name);
    malformed.push(missing);
    const duplicate = model();
    duplicate.controls.push({ name });
    malformed.push(duplicate);
  }
  for (const input of malformed) {
    assert.throws(() => data.provider.createController(input, data.context), /requires|Swagger/);
  }
});

test('engine and real layout/SHORTCUT requirements cannot turn missing host support into success', async () => {
  const data = fixture();
  data.controller.engines = [];
  await assert.rejects(data.controller.onCreated(), /APPINDEXVIEW engine/);
  for (const role of ['nav', 'tabs', 'shortcut', 'wrong-shortcut']) {
    const controller = data.provider.createController(model(), data.context);
    await controller.onCreated();
    const layout = panelFixture();
    if (role === 'wrong-shortcut') layout.panel.providers.shortcut.component = 'IBizRawItem';
    else delete layout.panel.panelItems[role];
    assert.throws(() => controller.setLayoutPanel(layout.panel), /NAV_POS_INDEX|IBizShortCut/);
    await assert.rejects(controller.onMounted(), /layout was not initialized/);
    await controller.onDestroyed();
  }
});

test('deferred layout bind retains original methods until creation and reports missing menu placeholders', async () => {
  const data = fixture();
  data.controller.model.viewLayoutPanel.controls.find(item => item.name === 'rightsidemenu')
    .appMenuItems.push({ id: 'preserved-right-target' });
  await data.controller.onCreated();
  const layout = panelFixture();
  delete layout.panel.panelItems.rightsidemenu;
  layout.panel.state.isCreated = false;
  const original = layout.nav.closeViewByKeys;
  data.controller.setLayoutPanel(layout.panel);
  assert.equal(layout.nav.closeViewByKeys, original);
  layout.panel.state.isCreated = true;
  layout.panel.evt.emit('onCreated');
  assert.notEqual(layout.nav.closeViewByKeys, original);
  assert.deepEqual(plain(data.controller.state.designIndexErrors), [{
    phase: 'layout', menu: 'rightsidemenu', message: 'Model menu has no host side-menu placeholder.',
  }]);
  await data.controller.onDestroyed();
  assert.equal(layout.nav.closeViewByKeys, original);
  assert.equal(layout.panel.evt.count('onCreated'), 0);
});

test('real host side-menu methods bind layout controls without appMenu and preserve permission/provider handling', async () => {
  const data = fixture();
  const target = { id: 'target', appFuncId: 'target', openDefault: true };
  const denied = { id: 'denied', appFuncId: 'denied', accessKey: 'denied', openDefault: true };
  const invisible = { id: 'invisible', hidden: true, openDefault: true };
  let providerClicks = 0;
  const custom = { id: 'custom', fixtureProvider: { onClick() { providerClicks += 1; return true; } } };
  const layout = await nativePanelFixture(data, {
    leftsidemenu: [target, denied, invisible, custom],
  });
  layout.permissions.add('denied');
  const menu = layout.menus.leftsidemenu;
  const originalItems = menu.state.items;
  const originalStates = menu.state.menuItemsState;
  const originalProviders = menu.itemProviders;
  const originalClick = menu.handleClickMenuItem;
  await data.controller.onCreated();
  data.controller.setLayoutPanel(layout.panel);
  await data.controller.onMounted();
  await data.controller.defaultOpenTasks.get('leftsidemenu:target');
  assert.equal(menu.appMenu, data.controller.model.viewLayoutPanel.controls.find(item => item.name === 'leftsidemenu'));
  assert.equal(menu.state.items, menu.appMenu.appMenuItems);
  assert.deepEqual(plain(menu.state.menuItemsState), {
    target: { visible: true, permitted: true },
    denied: { visible: false, permitted: false },
    invisible: { visible: false, permitted: true },
    custom: { visible: true, permitted: true },
  });
  assert.deepEqual(plain(menu.allAppMenuItems.map(item => item.id)), ['target', 'denied', 'invisible', 'custom']);
  assert.deepEqual(layout.providerCalls, ['target', 'denied', 'invisible', 'custom']);
  assert.equal(data.runtime.dynamicMenus.length, 4);
  assert.equal(data.dispatched.length, 1);
  assert.equal(data.dispatched[0][1], 'target');
  await assert.rejects(menu.handleClickMenuItem(denied), /not permitted/);
  await assert.rejects(menu.handleClickMenuItem(invisible), /not permitted/);
  assert.equal(await menu.handleClickMenuItem(custom), true);
  assert.equal(providerClicks, 1);
  data.controller.setLayoutPanel(layout.panel);
  await data.controller.onMounted();
  assert.equal(data.runtime.dynamicMenus.length, 4, 'A panel must bind once');
  assert.equal(data.dispatched.length, 1, 'Default targets must open once');
  await data.controller.onDestroyed();
  assert.equal(menu.appMenu, undefined);
  assert.equal(menu.state.items, originalItems);
  assert.equal(menu.state.menuItemsState, originalStates);
  assert.equal(menu.itemProviders, originalProviders);
  assert.equal(menu.handleClickMenuItem, originalClick);
});

test('native binding recognizes transformed predefined types and named controllers without granting stale denials', async () => {
  const data = fixture();
  const item = { id: 'denied', appFuncId: 'denied', openDefault: true };
  const revoked = { id: 'revoked', accessKey: 'revoked', appFuncId: 'revoked', openDefault: true };
  const layout = await nativePanelFixture(data, { leftsidemenu: [item, revoked] });
  layout.permissions.add('revoked');
  layout.menus.leftsidemenu.model = { id: 'placeholder', predefinedType: 'LEFT_SIDE_MENU' };
  layout.menus.rightsidemenu.model = { id: 'RIGHTSIDEMENU' };
  layout.menus.topsidemenu.model = { name: 'topsidemenu' };
  layout.menus.bottomsidemenu.model = {};
  layout.menus.bottomsidemenu.id = 'bottomsidemenu';
  layout.menus.leftsidemenu.state.menuItemsState.denied = { visible: false, permitted: false };
  layout.menus.leftsidemenu.state.menuItemsState.revoked = { visible: true, permitted: true };
  await data.controller.onCreated();
  data.controller.setLayoutPanel(layout.panel);
  await data.controller.onMounted();
  assert.equal(data.runtime.dynamicMenus.length, 4);
  assert.equal(data.controller.defaultOpenTasks.size, 0);
  await assert.rejects(layout.menus.leftsidemenu.handleClickMenuItem(item), /not permitted/);
  await assert.rejects(layout.menus.leftsidemenu.handleClickMenuItem(revoked), /not permitted/);
  assert.deepEqual(data.dispatched, []);
  await data.controller.onDestroyed();
});

for (const format of ['esm', 'system']) {
  test(`${format} legacy source controller binds static menus without newer runtime exports`, async () => {
    const data = fixture(format, 'linked');
    const target = { id: 'target', appFuncId: 'target', openDefault: true };
    const denied = { id: 'denied', appFuncId: 'denied', accessKey: 'denied', openDefault: true };
    const layout = await nativePanelFixture(data, { leftsidemenu: [target, denied] }, 'linked');
    layout.permissions.add('denied');
    await data.controller.onCreated();
    data.controller.setLayoutPanel(layout.panel);
    await data.controller.onMounted();
    await data.controller.defaultOpenTasks.get('leftsidemenu:target');
    assert.equal(data.peers['@ibiz-template/runtime'].calcDynamicMenu, undefined);
    assert.equal(layout.menus.leftsidemenu.convertMultipleLanguages, undefined);
    assert.deepEqual(data.runtime.dynamicMenus, []);
    assert.equal(data.dispatched.length, 1);
    assert.equal(data.dispatched[0][1], 'target');
    await assert.rejects(layout.menus.leftsidemenu.handleClickMenuItem(denied), /not permitted/);
    await data.controller.onDestroyed();
    assert.equal(layout.menus.leftsidemenu.appMenu, undefined);
  });

  test(`${format} legacy source controller rejects unsupported dynamic menus without publishing`, async () => {
    const data = fixture(format, 'linked');
    const layout = await nativePanelFixture(data, {
      leftsidemenu: [{ id: 'target', appFuncId: 'target', openDefault: true }],
    }, 'linked');
    const control = data.controller.model.viewLayoutPanel.controls.find(item => item.name === 'leftsidemenu');
    control.dynamicMode = 1;
    const originalItems = layout.menus.leftsidemenu.state.items;
    await data.controller.onCreated();
    data.controller.setLayoutPanel(layout.panel);
    await assert.rejects(data.controller.onMounted(), /require the host calcDynamicMenu API/);
    assert.equal(layout.menus.leftsidemenu.appMenu, undefined);
    assert.equal(layout.menus.leftsidemenu.state.items, originalItems);
    assert.deepEqual(data.dispatched, []);
    assert.equal(data.controller.state.designIndexErrors[0].phase, 'menu-binding');
    await data.controller.onDestroyed();
  });
}

test('late dynamic menu initialization cannot publish or dispatch after disposal', async () => {
  const data = fixture();
  const layout = await nativePanelFixture(data, {
    leftsidemenu: [{ id: 'late', appFuncId: 'late', openDefault: true }],
  });
  const finish = [];
  data.runtime.calcDynamicMenu = () => new Promise(done => finish.push(done));
  const originalItems = layout.menus.leftsidemenu.state.items;
  await data.controller.onCreated();
  data.controller.setLayoutPanel(layout.panel);
  const mounted = data.controller.onMounted();
  await tick();
  assert.equal(finish.length, 4, 'All side menus must be awaiting dynamic initialization');
  await data.controller.onDestroyed();
  finish.forEach(done => done());
  await assert.rejects(mounted, /destroyed/);
  await tick();
  assert.equal(layout.menus.leftsidemenu.appMenu, undefined);
  assert.equal(layout.menus.leftsidemenu.state.items, originalItems);
  assert.deepEqual(data.dispatched, []);
  assert.deepEqual(data.errors, []);
});

test('default targets start independently, retain failures and do not assert a pending terminal rendered', async () => {
  const data = fixture();
  const drawer = { id: 'drawer', appFuncId: 'drawer', openDefault: true };
  const terminal = { id: 'terminal', appFuncId: 'terminal', openDefault: true };
  const failed = { id: 'failed', appFuncId: 'failed', openDefault: true, fixtureFailure: 'host target failure' };
  const layout = panelFixture({ leftsidemenu: [drawer, failed], bottomsidemenu: [terminal] });
  let finishDrawer;
  layout.menus.leftsidemenu.handleClickMenuItem = item => item === drawer
    ? new Promise(done => { finishDrawer = done; })
    : Promise.reject(new Error(item.fixtureFailure));
  await data.controller.onCreated();
  data.controller.setLayoutPanel(layout.panel);
  await data.controller.onMounted();
  await tick();
  assert.equal(layout.clicked.length, 1);
  assert.equal(layout.clicked[0].item, terminal);
  assert.equal(data.controller.state.designIndexDefaultOpens['leftsidemenu:drawer'], 'pending');
  assert.equal(await data.controller.defaultOpenTasks.get('bottomsidemenu:terminal'), true);
  await assert.rejects(data.controller.defaultOpenTasks.get('leftsidemenu:failed'), /host target failure/);
  assert.equal(data.errors.length, 1);
  assert.deepEqual(plain(data.controller.state.designIndexErrors), [{
    phase: 'default-open', menu: 'leftsidemenu', item: 'failed', message: 'Default menu failed: failed.',
  }]);
  finishDrawer(true);
  await data.controller.defaultOpenTasks.get('leftsidemenu:drawer');
  await data.controller.onMounted();
  assert.equal(layout.clicked.length, 1, 'Repeated mount must not dispatch defaults again');
  await data.controller.onDestroyed();
});

test('hidden, disabled, nonpermitted and unavailable ancestor defaults never dispatch', async () => {
  const data = fixture();
  const values = [
    { id: 'hidden', hidden: true, openDefault: true },
    { id: 'disabled', disabled: true, openDefault: true },
    { id: 'forbidden', openDefault: true },
    { id: 'invisible', openDefault: true },
    { id: 'parent', appMenuItems: [{ id: 'nested', openDefault: true }] },
  ];
  const layout = panelFixture({ leftsidemenu: values });
  const menu = layout.menus.leftsidemenu;
  menu.state.menuItemsState.forbidden.permitted = false;
  menu.state.menuItemsState.invisible.visible = false;
  menu.state.menuItemsState.parent.permitted = false;
  await data.controller.onCreated();
  data.controller.setLayoutPanel(layout.panel);
  await data.controller.onMounted();
  assert.equal(data.controller.defaultOpenTasks.size, 0);
  for (const item of [...values.slice(0, 4), values[4].appMenuItems[0], { id: 'invented' }]) {
    await assert.rejects(menu.handleClickMenuItem(item), /not permitted/);
  }
  assert.deepEqual(layout.clicked, []);
  assert.deepEqual(data.dispatched, []);
  await data.controller.onDestroyed();
});

test('existing nested route is retained but drawer defaults and missing configuration are not hidden', async () => {
  const data = fixture();
  const tab = { id: 'tab', appFuncId: 'tab', openDefault: true };
  const drawer = { id: 'drawer', appFuncId: 'drawer', openDefault: true };
  const missing = { id: 'missing', appFuncId: 'missing', openDefault: true };
  for (const item of [tab, drawer, missing]) {
    data.funcs.set(item.appFuncId, { appFuncType: 'APPVIEW', appViewId: item.id });
  }
  data.config.set('tab', { openMode: 'INDEXVIEWTAB' });
  data.config.set('drawer', { openMode: 'DRAWER' });
  const layout = panelFixture({ leftsidemenu: [tab, drawer, missing] });
  layout.nav.state.currentKey = 'existing/nested/route';
  await data.controller.onCreated();
  data.controller.setLayoutPanel(layout.panel);
  await data.controller.onMounted();
  assert.equal(await data.controller.defaultOpenTasks.get('leftsidemenu:tab'), 'existing-route');
  assert.equal(data.controller.state.designIndexDefaultOpens['leftsidemenu:tab'], 'existing-route');
  assert.equal(await data.controller.defaultOpenTasks.get('leftsidemenu:drawer'), true);
  await assert.rejects(data.controller.defaultOpenTasks.get('leftsidemenu:missing'), /configuration is missing/);
  assert.deepEqual(layout.clicked.map(entry => entry.item), [drawer]);
  assert.equal(layout.nav.state.currentKey, 'existing/nested/route');
  await data.controller.onDestroyed();
});

test('disableClose coalesces clicks, protects only matching local child tabs/modal and restores after disposal', async () => {
  const data = fixture();
  const item = { id: 'target', appFuncId: 'target', disableClose: true };
  const layout = panelFixture({ leftsidemenu: [item] });
  data.funcs.set('target', { appFuncType: 'APPVIEW', appViewId: 'protectedview' });
  let complete;
  data.runtime.commands.execute = (...args) => {
    data.dispatched.push(args);
    return new Promise(done => { complete = done; });
  };
  await data.controller.onCreated();
  data.controller.setLayoutPanel(layout.panel);
  const click = layout.menus.leftsidemenu.handleClickMenuItem(item, { type: 'click' }, true);
  assert.equal(layout.menus.leftsidemenu.handleClickMenuItem(item), click);
  await tick();
  assert.equal(data.dispatched.length, 1);
  const [tag, func, context, params, options] = data.dispatched[0];
  assert.equal(tag, 'AppFunc');
  assert.equal(func, 'target');
  assert.equal(context.toRouteDepth, 3);
  assert.equal(context.srfappid, 'ModelDesign');
  assert.deepEqual(plain(params), { nativeParam: 42 });
  assert.equal(options.view, data.controller);
  let dismissCalls = 0;
  const modal = { async dismiss() { dismissCalls += 1; return true; } };
  const originalDismiss = modal.dismiss;
  const child = {
    model: { id: 'ProtectedView', appId: 'modeldesign', viewType: 'DEEDITVIEW' },
    evt: emitter(), state: { isCreated: false },
  };
  data.controller.ctx.evt.emit('onRegister', 'child', child);
  child.modal = modal;
  child.state.isCreated = true;
  child.evt.emit('onCreated');
  assert.equal(await modal.dismiss(), false);
  assert.equal(dismissCalls, 0);
  layout.nav.state.currentKey = 'protected-tab';
  layout.nav.onViewCreated({ view: child });
  await layout.nav.closeViewByKeys(['protected-tab', 'other-tab']);
  assert.deepEqual(plain(layout.nav.closed), [['other-tab']]);
  assert.equal(await layout.nav.closeViewByKeys(['protected-tab']), false);
  complete(true);
  assert.equal(await click, true);
  await data.controller.onDestroyed();
  assert.equal(modal.dismiss, originalDismiss);
  assert.equal(await modal.dismiss(), true);
  assert.equal(dismissCalls, 1);
  assert.equal(data.controller.ctx.evt.count('onRegister'), 0);
  assert.equal(child.evt.count('onCreated'), 0);
  assert.equal(data.controller.defaultOpenTasks.size, 0);
  assert.equal(layout.nav.onViewCreated, layout.originals.get(layout.nav).onViewCreated);
  assert.equal(layout.nav.closeViewByKeys, layout.originals.get(layout.nav).closeViewByKeys);
});

test('DEBUG calls the real devtool, missing devtool/AppFunc reject and normal/provider clicks remain host-owned', async () => {
  const data = fixture();
  const debug = { id: 'DEBUG' };
  const normal = { id: 'normal', appFuncId: 'normal' };
  const protectedMissing = { id: 'missing', appFuncId: 'missing', disableClose: true };
  const layout = panelFixture({ leftsidemenu: [debug, normal, protectedMissing] });
  await data.controller.onCreated();
  data.controller.setLayoutPanel(layout.panel);
  assert.equal(await layout.menus.leftsidemenu.handleClickMenuItem(debug), true);
  assert.equal(data.runtime.debugCalls, 1);
  data.runtime.devTool = undefined;
  await assert.rejects(layout.menus.leftsidemenu.handleClickMenuItem(debug), /devTool.triggerVisible/);
  await assert.rejects(layout.menus.leftsidemenu.handleClickMenuItem(protectedMissing), /APPVIEW function/);
  assert.equal(await layout.menus.leftsidemenu.handleClickMenuItem(normal), true);
  layout.menus.leftsidemenu.itemProviders.DEBUG = { onClick() {} };
  assert.equal(await layout.menus.leftsidemenu.handleClickMenuItem(debug), true);
  assert.deepEqual(layout.clicked.map(entry => entry.item), [normal, debug]);
  await data.controller.onDestroyed();
});

test('disposal prevents late configuration dispatch and does not overwrite a later method owner', async () => {
  const data = fixture();
  const item = { id: 'late', appFuncId: 'late', openDefault: true };
  data.funcs.set('late', { appFuncType: 'APPVIEW', appViewId: 'late' });
  let finish;
  data.runtime.hub.config.view.get = () => new Promise(done => { finish = done; });
  const layout = panelFixture({ leftsidemenu: [item] });
  await data.controller.onCreated();
  data.controller.setLayoutPanel(layout.panel);
  const captured = layout.menus.leftsidemenu.handleClickMenuItem;
  await data.controller.onMounted();
  await tick();
  const pending = data.controller.defaultOpenTasks.get('leftsidemenu:late');
  const successor = async () => 'later-owner';
  layout.menus.leftsidemenu.handleClickMenuItem = successor;
  await data.controller.onDestroyed();
  finish({ openMode: 'DRAWER' });
  await assert.rejects(pending, /destroyed/);
  await assert.rejects(captured(item), /destroyed/);
  assert.equal(layout.menus.leftsidemenu.handleClickMenuItem, successor);
  assert.deepEqual(layout.clicked, []);
  assert.deepEqual(data.dispatched, []);
  assert.deepEqual(data.errors, []);
});

const counterEndpoint = '/work_items/count_my_todo';

test('work-item counter loads through the real host transport without touching layout binding', async () => {
  const data = fixture();
  data.counter.payload = { my_todo_count: '7' };
  await data.controller.onCreated();
  await tick();
  // `params` is created inside the plugin realm, so compare a structural copy.
  assert.deepEqual(plain(data.counter.requests), [{ url: counterEndpoint, params: {} }]);
  assert.equal(data.controller.state.myTodoCount, 7);
  assert.equal(data.controller.state.myTodoCountStatus, 'ready');
  assert.deepEqual(plain(data.controller.state.designIndexErrors), []);
  assert.deepEqual(data.errors, []);
  assert.deepEqual(data.warnings, []);
  assert.deepEqual(data.dispatched, []);
  await data.controller.onDestroyed();
});

for (const format of ['esm', 'system']) {
  for (const [name, payload, message] of [
    ['missing counter field', {}, /nonnegative decimal integer/],
    ['null response data', null, /nonnegative decimal integer/],
    ['undefined response data', undefined, /nonnegative decimal integer/],
    ['non-numeric string', { my_todo_count: 'many' }, /nonnegative decimal integer/],
    ['whitespace string', { my_todo_count: ' 7 ' }, /nonnegative decimal integer/],
    ['boolean', { my_todo_count: true }, /nonnegative decimal integer/],
    ['negative count', { my_todo_count: -1 }, /safe nonnegative integer/],
    ['fractional count', { my_todo_count: 1.5 }, /safe nonnegative integer/],
    ['unsafe integer', { my_todo_count: Number.MAX_SAFE_INTEGER + 2 }, /safe nonnegative integer/],
    ['unsafe decimal string', { my_todo_count: '9007199254740992' }, /safe nonnegative integer/],
    ['infinite count', { my_todo_count: Infinity }, /safe nonnegative integer/],
    ['NaN count', { my_todo_count: NaN }, /safe nonnegative integer/],
  ]) {
    test(`${format} work-item counter rejects ${name} without publishing a count`, async () => {
      const data = fixture(format);
      data.counter.payload = payload;
      await data.controller.onCreated();
      await tick();
      assert.equal(data.controller.state.myTodoCount, undefined);
      assert.equal(data.controller.state.myTodoCountStatus, 'error');
      assert.deepEqual(plain(data.controller.state.designIndexErrors), [{
        phase: 'my-todo-counter', message: `Error: my_todo_count must be a ${
          /decimal/.test(message) ? 'nonnegative decimal integer' : 'safe nonnegative integer'}.`,
      }]);
      assert.equal(data.errors.length, 1);
      assert.match(data.errors[0].message, message);
      assert.deepEqual(data.warnings, []);
      await data.controller.onDestroyed();
    });
  }
}

test('work-item counter transport failure is retained and does not block default targets', async () => {
  const data = fixture();
  data.counter.failure = new Error('counter transport unavailable');
  const target = { id: 'target', appFuncId: 'target', openDefault: true };
  const layout = panelFixture({ leftsidemenu: [target] });
  await data.controller.onCreated();
  data.controller.setLayoutPanel(layout.panel);
  await data.controller.onMounted();
  await data.controller.defaultOpenTasks.get('leftsidemenu:target');
  await tick();
  assert.deepEqual(plain(data.controller.state.designIndexErrors), [{
    phase: 'my-todo-counter', message: 'Error: counter transport unavailable',
  }]);
  assert.equal(data.controller.state.myTodoCount, undefined);
  assert.equal(data.controller.state.myTodoCountStatus, 'error');
  assert.equal(layout.clicked.length, 1);
  assert.equal(layout.clicked[0].item, target);
  assert.deepEqual(data.dispatched, [], 'A plain default target stays with the host click handler');
  await data.controller.onDestroyed();
});

for (const format of ['esm', 'system']) {
  for (const count of [0, '7']) {
    test(`${format} counter remains pending without a fabricated count while real menu binding continues, then becomes ready`, async () => {
      const data = fixture(format);
      data.counter.deferred = true;
      const target = { id: 'target', appFuncId: 'target', openDefault: true };
      const layout = await nativePanelFixture(data, { leftsidemenu: [target] });
      await data.controller.onCreated();
      assert.equal(data.controller.state.myTodoCountStatus, 'pending');
      assert.equal(data.controller.state.myTodoCount, undefined);
      assert.deepEqual(plain(data.counter.requests), [{ url: counterEndpoint, params: {} }]);
      data.controller.setLayoutPanel(layout.panel);
      await data.controller.onMounted();
      await data.controller.defaultOpenTasks.get('leftsidemenu:target');
      assert.equal(data.dispatched.length, 1);
      assert.equal(data.dispatched[0][1], 'target');
      assert.equal(data.controller.state.myTodoCountStatus, 'pending');
      data.counter.resolve({ status: 200, ok: true, data: { my_todo_count: count } });
      await tick();
      assert.equal(data.controller.state.myTodoCount, Number(count));
      assert.equal(data.controller.state.myTodoCountStatus, 'ready');
      assert.deepEqual(plain(data.controller.state.designIndexErrors), []);
      assert.deepEqual(data.errors, []);
      assert.deepEqual(data.warnings, []);
      await data.controller.onDestroyed();
      assert.equal(layout.menus.leftsidemenu.appMenu, undefined);
    });
  }

  for (const status of [404, 405]) {
    test(`${format} actual numeric HTTP ${status} counter failure stays unavailable, retains warning evidence and menu binding`, async () => {
      const data = fixture(format);
      const failure = Object.assign(new Error(`actual HTTP ${status}`), { status });
      data.counter.failure = failure;
      const target = { id: 'target', appFuncId: 'target', openDefault: true };
      const layout = await nativePanelFixture(data, { leftsidemenu: [target] });
      await data.controller.onCreated();
      data.controller.setLayoutPanel(layout.panel);
      await data.controller.onMounted();
      await data.controller.defaultOpenTasks.get('leftsidemenu:target');
      await tick();
      assert.equal(data.controller.state.myTodoCountStatus, 'unavailable');
      assert.equal(data.controller.state.myTodoCount, undefined);
      assert.deepEqual(plain(data.counter.requests), [{ url: counterEndpoint, params: {} }]);
      assert.deepEqual(plain(data.controller.state.designIndexErrors), []);
      assert.deepEqual(data.warnings, [failure]);
      assert.deepEqual(data.errors, []);
      assert.equal(data.dispatched.length, 1);
      assert.equal(data.dispatched[0][1], 'target');
      await data.controller.onDestroyed();
    });
  }

  test(`${format} counter authorization/client/server/transport and string-status failures stay error without blocking default menus`, async () => {
    for (const status of [400, 401, 403, 408, 422, 500, 502, 503, 504, '404', '405', null, undefined]) {
      const data = fixture(format);
      const failure = Object.assign(new Error(`actual failure ${String(status)}`), { status });
      data.counter.failure = failure;
      const target = { id: 'target', appFuncId: 'target', openDefault: true };
      const layout = panelFixture({ leftsidemenu: [target] });
      await data.controller.onCreated();
      data.controller.setLayoutPanel(layout.panel);
      await data.controller.onMounted();
      await data.controller.defaultOpenTasks.get('leftsidemenu:target');
      await tick();
      assert.equal(data.controller.state.myTodoCountStatus, 'error', String(status));
      assert.equal(data.controller.state.myTodoCount, undefined);
      assert.deepEqual(plain(data.counter.requests), [{ url: counterEndpoint, params: {} }]);
      assert.deepEqual(plain(data.controller.state.designIndexErrors), [{
        phase: 'my-todo-counter', message: String(failure),
      }]);
      assert.deepEqual(data.errors, [failure]);
      assert.deepEqual(data.warnings, []);
      assert.equal(layout.clicked.length, 1);
      await data.controller.onDestroyed();
    }
  });

  test(`${format} a resolved failed/missing HTTP status cannot publish a plausible count`, async () => {
    for (const status of [404, 405, 400, 401, 403, 500, 503, '404', '405', undefined, NaN]) {
      const data = fixture(format);
      data.counter.deferred = true;
      await data.controller.onCreated();
      const response = { status, data: { my_todo_count: 99 } };
      data.counter.resolve(response);
      await tick();
      const unavailable = status === 404 || status === 405;
      assert.equal(data.controller.state.myTodoCountStatus, unavailable ? 'unavailable' : 'error');
      assert.equal(data.controller.state.myTodoCount, undefined);
      const logged = unavailable ? data.warnings : data.errors;
      assert.equal(logged.length, 1);
      assert.equal(logged[0].response, response, 'Actual response evidence must stay attached to the failure');
      assert.equal(logged[0].status, status);
      assert.equal(data.controller.state.designIndexErrors.length, unavailable ? 0 : 1);
      await data.controller.onDestroyed();
    }
  });

  for (const [name, settle] of [
    ['valid count resolve', counter => counter.resolve({ status: 200, data: { my_todo_count: 9 } })],
    ['invalid count resolve', counter => counter.resolve({ status: 200, data: {} })],
    ['404 resolve', counter => counter.resolve({ status: 404, data: { message: 'absent' } })],
    ['404 reject', counter => counter.reject(Object.assign(new Error('late unavailable'), { status: 404 }))],
    ['403 reject', counter => counter.reject(Object.assign(new Error('late denied'), { status: 403 }))],
    ['transport reject', counter => counter.reject(new Error('late network failure'))],
  ]) {
    test(`${format} late counter ${name} after destroy changes no state or logs`, async () => {
      const data = fixture(format);
      data.counter.deferred = true;
      await data.controller.onCreated();
      assert.equal(data.controller.state.myTodoCountStatus, 'pending');
      assert.equal(data.counter.requests.length, 1);
      await data.controller.onDestroyed();
      const destroyedState = plain(data.controller.state);
      settle(data.counter);
      await tick();
      assert.deepEqual(plain(data.controller.state), destroyedState);
      assert.equal(data.controller.state.myTodoCount, undefined);
      assert.deepEqual(data.errors, []);
      assert.deepEqual(data.warnings, []);
      assert.deepEqual(data.dispatched, []);
      assert.equal(data.counter.requests.length, 1, 'Disposal must not erase the original network request');
    });
  }
}

test('substantive CSS stays within the local index class without global imports or resource URLs', async () => {
  const css = postcss.parse(await readFile(join(pluginRoot, 'dist/style.css'), 'utf8'));
  assert.ok(css.nodes.length);
  assert.equal(css.nodes.every(node => node.type === 'rule'), true);
  const properties = new Set();
  css.walkRules(rule => {
    for (const selector of rule.selectors) assert.match(selector, /^\.aibiz-design-index(?:$|\s)/);
    assert.ok(rule.nodes.length);
    rule.walkDecls(declaration => {
      assert.doesNotMatch(declaration.value, /url\s*\(/i);
      properties.add(declaration.prop);
    });
  });
  assert.deepEqual([...properties].sort(), ['max-width', 'min-height', 'min-width']);
});

test('safe custom output reproduces all four files without modifying source/manifest', async t => {
  const data = await buildFixture(t);
  const outputDir = join(data.root, 'custom/nested-dist');
  const built = await data.build({ outputDir });
  assert.deepEqual(built.receipt, receipt);
  assert.deepEqual(await files(outputDir), outputNames);
  for (const name of outputNames) {
    assert.deepEqual(await readFile(join(outputDir, name)), data.before.get(name));
  }
  await unchanged(data);
  for (const name of inputNames) {
    assert.deepEqual(await readFile(join(data.root, name)), await readFile(join(pluginRoot, name)));
  }
});

test('invalid boolean/root/escaped destinations reject without touching existing outputs', async t => {
  const data = await buildFixture(t);
  await assert.rejects(data.build({ writeOutputs: 'false' }), /must be boolean/);
  await assert.rejects(data.build({ outputDir: data.root }), /inside the local plugin/);
  await assert.rejects(data.build({ outputDir: data.outside }), /inside the local plugin/);
  await assert.rejects(data.build({ outputDir: join(data.root, '../escaped') }), /inside the local plugin/);
  await unchanged(data);
  assert.deepEqual(await readdir(data.outside), []);
});

for (const kind of ['output-directory', 'missing-child-ancestor', 'existing-child-ancestor']) {
  test(`safe build rejects ${kind} symlink without writing outside the package`, async t => {
    const data = await buildFixture(t);
    const linkPath = join(data.root, 'linked');
    if (kind === 'existing-child-ancestor') await mkdir(join(data.outside, 'dist'));
    await symlink(data.outside, linkPath, 'dir');
    const outputDir = kind === 'output-directory' ? linkPath : join(linkPath, 'dist');
    await assert.rejects(data.build({ outputDir }), /non-symlink directory ancestors/);
    await unchanged(data);
    if (kind === 'existing-child-ancestor') assert.deepEqual(await readdir(join(data.outside, 'dist')), []);
    else assert.deepEqual(await readdir(data.outside), []);
  });
}

for (const kind of ['symlink', 'hardlink', 'directory']) {
  for (const name of outputNames) {
    test(`safe build rejects ${kind} output ${name} before truncating any member of the group`, async t => {
      const data = await buildFixture(t);
      const target = join(data.output, name);
      const sentinel = join(data.outside, 'sentinel');
      await writeFile(sentinel, 'outside bytes must remain unchanged');
      await rm(target);
      if (kind === 'symlink') await symlink(sentinel, target);
      else if (kind === 'hardlink') await link(sentinel, target);
      else await mkdir(target);
      await assert.rejects(data.build(), /single-link regular file/);
      assert.equal(await readFile(sentinel, 'utf8'), 'outside bytes must remain unchanged');
      await unchanged(data, [name]);
    });
  }
}

test('syntax errors fail before touching a complete existing dist', async t => {
  const data = await buildFixture(t);
  await writeFile(join(data.root, 'src/model.ts'), 'export const invalid = ;\n');
  await assert.rejects(data.build(), /Expression expected/);
  await unchanged(data);
});

test('undeclared bare imports, imports escaping source and ambiguous source paths are rejected', async t => {
  for (const kind of ['undeclared', 'escaping', 'ambiguous']) {
    await t.test(kind, async t => {
      const data = await buildFixture(t);
      const entry = join(data.root, 'src/index.ts');
      const original = await readFile(entry, 'utf8');
      if (kind === 'undeclared') {
        await writeFile(entry, `import { foreign } from 'unrecorded-host';\n${original}\nexport { foreign };\n`);
      } else if (kind === 'escaping') {
        await writeFile(entry, `import { foreign } from '../foreign';\n${original}\nexport { foreign };\n`);
        await writeFile(join(data.root, 'foreign.ts'), 'export const foreign = true;\n');
      } else {
        await mkdir(join(data.root, 'src/model'));
        await writeFile(join(data.root, 'src/model/index.ts'), 'export const foreign = true;\n');
      }
      await assert.rejects(data.build(), /Undeclared host peer|Missing or ambiguous/);
      await unchanged(data);
    });
  }
});

test('linked source inputs are rejected rather than fingerprinting external editable bytes', async t => {
  for (const kind of ['symlink', 'hardlink', 'directory-symlink']) {
    await t.test(kind, async t => {
      const data = await buildFixture(t);
      const target = join(data.root, 'src/model.ts');
      const external = join(data.outside, 'model.ts');
      await writeFile(external, await readFile(target));
      if (kind === 'directory-symlink') {
        await rm(join(data.root, 'src'), { recursive: true });
        await symlink(data.outside, join(data.root, 'src'), 'dir');
      } else {
        await rm(target);
        if (kind === 'symlink') await symlink(external, target);
        else await link(external, target);
      }
      await assert.rejects(data.build(), /non-symlink|single-link regular/);
      await unchanged(data);
    });
  }
});
