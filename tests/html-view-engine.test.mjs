import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { mock, test } from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const appRoot = join(root, 'modelingweb/app');
const appRequire = createRequire(join(appRoot, 'package.json'));
const ts = appRequire('typescript');
const { rollup } = createRequire(appRequire.resolve('vite'))('rollup');
const { minify } = appRequire('terser');
const userRegister = join(appRoot, 'src/user-register.ts');
const appId = 'ibizmodeling__modeldesign';
const productionEngineModel = {
  engineCat: 'VIEW',
  engineType: 'HtmlView',
  id: 'engine',
  appId,
};

const variants = [
  {
    name: 'ibiz-app-hub source',
    runtime: join(root, 'ibiz-app-hub/packages/runtime/src'),
    registry: join(root, 'ibiz-app-hub/components/ibiz-next-vue3/src/view-engine/index.ts'),
    extension: '.ts',
  },
  {
    name: 'modelingweb source-debug',
    runtime: join(root, 'modelingweb/packages-latest/@ibiz-template/runtime/src'),
    registry: join(root, 'modelingweb/packages-latest/@ibiz-template/vue3-components/src/view-engine/index.ts'),
    extension: '.ts',
  },
  {
    name: 'production user-register with installed runtime',
    runtime: join(appRoot, 'node_modules/@ibiz-template/runtime/out'),
    registry: userRegister,
    extension: '.js',
  },
];

function transpile(file, module = ts.ModuleKind.CommonJS) {
  return ts.transpileModule(readFileSync(file, 'utf8'), {
    fileName: file,
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module,
      esModuleInterop: true,
      allowJs: true,
    },
  }).outputText;
}

function evaluateModule(file, ibiz, dependencies = {}) {
  const module = { exports: {} };
  runInNewContext(transpile(file), {
    module,
    exports: module.exports,
    ibiz,
    require(name) {
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected import ${name} in ${file}`);
      return dependencies[name];
    },
  }, { filename: file });
  return module.exports;
}

function createFixture(variant) {
  const listeners = new Set();
  const ibiz = {
    log: { error: mock.fn(), debug: mock.fn() },
    i18n: { t: (key, params) => `${key}: ${JSON.stringify(params)}` },
    env: { isMob: false },
    mc: {
      command: {
        change: {
          on: callback => listeners.add(callback),
          off: callback => listeners.delete(callback),
        },
      },
    },
    hub: {
      getApp: mock.fn(() => {
        throw new Error('An HTML view must not fetch entity data on mount');
      }),
    },
  };
  const file = path => join(variant.runtime, `${path}${variant.extension}`);
  const constants = {
    ...evaluateModule(file('constant/view-call-tag'), ibiz),
    ...evaluateModule(file('constant/sys-uiaction-tag'), ibiz),
  };
  const coreRoot = resolve(variant.runtime, '../../core', variant.extension === '.ts' ? 'src' : 'out');
  const recursive = evaluateModule(join(
    coreRoot, `utils/recursive/find-recursive-child${variant.extension}`,
  ), ibiz, { ramda: appRequire('ramda') });
  const model = evaluateModule(file('model/utils/util'), ibiz, {
    '@ibiz-template/core': { RuntimeModelError: Error },
    'qx-util': {},
    '../../constant': constants,
  });
  const { EngineFactory } = evaluateModule(file('engine/engine-factory'), ibiz);
  const { ViewEngineBase } = evaluateModule(file('engine/view-base.engine'), ibiz, {
    '@ibiz-template/core': { RuntimeError: Error, ...recursive },
    qs: appRequire('qs'),
    ramda: appRequire('ramda'),
    '../constant': constants,
    '../model': model,
    '../service': {},
  });
  ibiz.engine = new EngineFactory();
  const closeGuards = [];
  const view = {
    model: {
      id: 'html-view',
      codeName: 'html_view',
      viewType: 'DEHTMLVIEW',
      appId,
      appDataEntityId: 'pscoreprdfunc',
      showCaptionBar: false,
      viewLayoutPanel: { rootPanelItems: [], controls: [] },
    },
    context: { srfappid: appId },
    params: {},
    state: { htmlUrl: '/docs?product=example', isLoading: false },
    childNames: [],
    modal: { hooks: { shouldDismiss: { tapPromise: fn => closeGuards.push(fn) } } },
    getController: () => undefined,
  };
  return { ibiz, view, ViewEngineBase, constants, listeners, closeGuards };
}

function installRegistry(variant, fixture) {
  const dependencies = {
    '@ibiz-template/runtime': { ViewEngineBase: fixture.ViewEngineBase },
  };
  // Other view engines are not instantiated by this focused registration test.
  const source = ts.createSourceFile(
    variant.registry, readFileSync(variant.registry, 'utf8'), ts.ScriptTarget.Latest,
  );
  for (const statement of source.statements) {
    if ((ts.isImportDeclaration(statement) || ts.isExportDeclaration(statement)) &&
        statement.moduleSpecifier?.text.startsWith('.')) {
      dependencies[statement.moduleSpecifier.text] = {};
    }
  }
  const registry = evaluateModule(variant.registry, fixture.ibiz, dependencies);
  (registry.IBizViewEngine || registry.default).install({});
}

function assertHtmlEngine(fixture, model = productionEngineModel) {
  const engine = fixture.ibiz.engine.getEngine(model, fixture.view);
  assert.ok(engine instanceof fixture.ViewEngineBase, `Missing ${model.engineCat}_${model.engineType}`);
  assert.equal(engine.view, fixture.view);
  assert.equal(fixture.ibiz.log.error.mock.callCount(), 0);
  return engine;
}

async function assertLifecycle(fixture, engine) {
  const originalUrl = fixture.view.state.htmlUrl;
  await engine.onCreated();
  await engine.onMounted();
  assert.equal(fixture.listeners.size, 1, 'Shared data-change subscription is active');
  assert.equal(fixture.closeGuards.length, 1, 'Shared modal close guard is installed');
  assert.ok(fixture.view.childNames.includes('toolbar'));
  const guardContext = { allowClose: true };
  fixture.view.state.isLoading = true;
  await fixture.closeGuards[0](guardContext);
  assert.equal(guardContext.allowClose, false);
  assert.equal((await engine.call(fixture.constants.ViewCallTag.GET_DATA)).length, 0);
  assert.equal(fixture.view.state.htmlUrl, originalUrl, 'Controller-owned URL is preserved');
  assert.equal(fixture.ibiz.hub.getApp.mock.callCount(), 0);
  await engine.onDestroyed();
  assert.equal(fixture.listeners.size, 0, 'Shared subscription is removed on destruction');
}

for (const variant of variants) {
  test(`${variant.name}: resolves the exact production HtmlView model`, () => {
    const fixture = createFixture(variant);
    installRegistry(variant, fixture);
    assertHtmlEngine(fixture);
  });

  test(`${variant.name}: resolves DEHTMLVIEW when the model has no explicit engine`, () => {
    const fixture = createFixture(variant);
    installRegistry(variant, fixture);
    assertHtmlEngine(fixture, { engineCat: 'VIEW', engineType: 'DEHTMLVIEW', appId });
  });

  test(`${variant.name}: registers behavior, not a no-op engine`, async () => {
    const fixture = createFixture(variant);
    installRegistry(variant, fixture);
    await assertLifecycle(fixture, assertHtmlEngine(fixture));
  });

  test(`${variant.name}: engines are per-view and not restricted to one app`, () => {
    const fixture = createFixture(variant);
    installRegistry(variant, fixture);
    const first = assertHtmlEngine(fixture);
    const otherView = { ...fixture.view, state: { htmlUrl: '/another-page' } };
    const second = fixture.ibiz.engine.getEngine(
      { ...productionEngineModel, appId: 'ibizplm__plmweb' }, otherView,
    );
    assert.ok(second instanceof fixture.ViewEngineBase);
    assert.notEqual(first, second);
    assert.equal(second.view, otherView);
    assert.equal(fixture.ibiz.log.error.mock.callCount(), 0);
  });

  test(`${variant.name}: unknown engines still report errors and failures propagate`, () => {
    const fixture = createFixture(variant);
    installRegistry(variant, fixture);
    const unknown = { ...productionEngineModel, engineType: 'MissingView' };
    assert.equal(fixture.ibiz.engine.getEngine(unknown, fixture.view), undefined);
    assert.equal(fixture.ibiz.log.error.mock.callCount(), 1);
    assert.equal(fixture.ibiz.log.error.mock.calls[0].arguments[1], unknown);
    assert.equal(fixture.ibiz.engine.getEngine(
      { ...productionEngineModel, engineCat: 'CTRL' }, fixture.view,
    ), undefined);
    assert.equal(fixture.ibiz.log.error.mock.callCount(), 2);
    const failure = new Error('engine constructor failed');
    fixture.ibiz.engine.register('VIEW_BrokenView', () => { throw failure; });
    assert.throws(() => fixture.ibiz.engine.getEngine(
      { ...productionEngineModel, engineType: 'BrokenView' }, fixture.view,
    ), error => error === failure);
  });
}

test('all three checked-in HTML view models resolve their configured engine', () => {
  const fixture = createFixture(variants[2]);
  installRegistry(variants[2], fixture);
  for (const name of ['modeling_ide', 'api_show', 'data_model']) {
    const model = JSON.parse(readFileSync(join(
      root, 'plm/model/PSSYSAPPS/plmweb/PSAPPDEVIEWS',
      `ps_core_prd_func_${name}_html_view.json`,
    ), 'utf8'));
    assert.equal(model.viewType, 'DEHTMLVIEW');
    assert.equal(model.getPSAppViewEngines.length, 1);
    assertHtmlEngine(fixture, { ...model.getPSAppViewEngines[0], appId });
  }
});

test('minified SystemJS main entry installs the fix with prebuilt runtime exports', async () => {
  const bundle = await rollup({
    input: join(appRoot, 'src/main.ts'),
    external: id => !id.startsWith('.') && !isAbsolute(id),
    plugins: [{
      name: 'isolated-typescript-entry',
      resolveId(id, importer) {
        if (id.startsWith('.') && importer) return resolve(dirname(importer), `${id}.ts`);
        return null;
      },
      load(id) {
        if (id.endsWith('.ts')) return transpile(id, ts.ModuleKind.ESNext);
        return null;
      },
    }],
  });
  let output;
  try {
    ({ output } = await bundle.generate({ format: 'system' }));
  } finally {
    await bundle.close();
  }
  assert.equal(output.length, 1);
  assert.ok(output[0].modules[userRegister], 'Production main must include user-register');
  const { code } = await minify(output[0].code);
  assert.ok(code);

  const fixture = createFixture(variants[2]);
  let plugins;
  const externals = {
    '@ibiz-template/runtime': { ViewEngineBase: fixture.ViewEngineBase },
    '@ibiz-template/vue3-components': { runApp: value => { plugins = value; } },
    '@ibiz-template/vue3-util': { AppHooks: { appResorceInited: { tap() {} } } },
    'vue-text-format': { default: { install() {} } },
    'vue-grid-layout': { default: { install() {} } },
  };
  runInNewContext(code, {
    ibiz: fixture.ibiz,
    System: {
      register(dependencies, declare) {
        assert.ok(dependencies.includes('@ibiz-template/runtime'));
        const registration = declare(() => {});
        dependencies.forEach((dependency, index) => {
          assert.ok(Object.hasOwn(externals, dependency), dependency);
          registration.setters[index](externals[dependency]);
        });
        registration.execute();
      },
    },
  });
  assert.equal(plugins.length, 3);
  plugins.forEach(plugin => plugin.install({}));
  await assertLifecycle(fixture, assertHtmlEngine(fixture));
  assertHtmlEngine(fixture, { engineCat: 'VIEW', engineType: 'DEHTMLVIEW', appId });
});
