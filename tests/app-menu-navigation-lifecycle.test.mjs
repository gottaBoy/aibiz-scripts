import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const workspace = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const require = createRequire(path.join(workspace, 'ibiz-app-hub/package.json'));
const ts = require('typescript');
const runtimeRequire = createRequire(path.join(workspace, 'ibiz-app-hub/packages/runtime/package.json'));
const { clone, equals } = runtimeRequire('ramda');
const runtime = 'ibiz-app-hub/packages/runtime/src';
const menuPath = `${runtime}/controller/control/app-menu/app-menu.controller.ts`;

function deferred() {
  let resolve;
  const promise = new Promise(yes => { resolve = yes; });
  return { promise, resolve };
}
function classSource(relative, className) {
  const filename = relative === menuPath && process.env.APP_MENU_NAVIGATION_SOURCE
    ? process.env.APP_MENU_NAVIGATION_SOURCE : path.join(workspace, relative);
  const source = ts.createSourceFile(filename, fs.readFileSync(filename, 'utf8'), ts.ScriptTarget.Latest, true);
  const owner = source.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === className);
  assert.ok(owner);
  return { source, owner };
}
function memberSource(relative, className, names) {
  const { source, owner } = classSource(relative, className);
  const members = owner.members.filter(node =>
    (ts.isMethodDeclaration(node) || ts.isGetAccessorDeclaration(node) || ts.isPropertyDeclaration(node)) &&
      names.includes(node.name.getText(source)));
  assert.equal(members.length, names.length);
  return members.map(node => node.getText(source)).join('\n');
}
function realMethods(relative, className, names, values, extra = '') {
  const text = memberSource(relative, className, names);
  const compiled = ts.transpileModule(`class Subject { ${extra}\n${text} }\nexports.Subject = Subject;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  });
  const exports = {};
  new Function('exports', ...Object.keys(values), compiled.outputText)(exports, ...Object.values(values));
  return exports.Subject;
}
function actualContextClass() {
  const filename = path.join(workspace, 'ibiz-app-hub/packages/core/src/context/index.ts');
  const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  });
  const exports = {};
  new Function('exports', 'require', compiled.outputText)(exports, name => {
    assert.equal(name, 'ramda');
    return { clone };
  });
  return exports.IBizContext;
}

function fixture({ mode = 'INDEXVIEWTAB', delay = 'view', noWaitRoute = false, modalOption = {} } = {}) {
  const ready = new Map(), gates = new Map(), viewCalls = new Map(), rootTasks = [];
  const pushes = [], otherOpens = [], commands = [];
  const window = { location: { href: 'http://owned.invalid/#/owned/index' } };
  const router = { currentRoute: { value: { fullPath: '/owned/index' } },
    push({ path: target }) {
      pushes.push({ method: 'push', path: target });
      this.currentRoute.value.fullPath = target;
      window.location.href = `http://owned.invalid/#${target}`;
    },
    replace({ path: target }) {
      this.push({ path: target });
      pushes.at(-1).method = 'replace';
    } };
  const waiters = id => {
    if (!ready.has(id)) { ready.set(id, deferred()); gates.set(id, deferred()); }
    return { entered: ready.get(id), gate: gates.get(id) };
  };
  const pause = async id => {
    const pending = waiters(id);
    pending.entered.resolve();
    await pending.gate.promise;
  };
  const ibiz = {
    env: { appId: 'owned-app' }, config: { appMenu: { echoMode: 'VIEW' } },
    i18n: { t: key => key },
    hub: {
      async getAppAsync() {
        return { getAppFunc: id => ({ appFuncType: 'APPVIEW', appViewId: `owned.${id}` }) };
      },
      config: { view: { async get(id) {
        const count = (viewCalls.get(id) || 0) + 1;
        viewCalls.set(id, count);
        if (delay === 'view' && count === 2) await pause(id);
        return { id, openMode: mode };
      } } },
    },
    commands: {},
  };
  const ErrorType = class extends Error {};
  const AppFunc = realMethods(`${runtime}/command/app/app-func/app-func.ts`, 'AppFuncCommand',
    ['exec', 'openAppView'], { ibiz, RuntimeError: ErrorType, ModelError: ErrorType,
      convertNavData: () => ({}), OpenAppViewCommand: { TAG: 'open-view' } });
  const OpenApp = realMethods(`${runtime}/command/app/open-app-view/open-app-view.ts`, 'OpenAppViewCommand',
    ['exec', 'openIndexViewTab', 'openIndexViewTabByModal', 'openModal', 'openPopover',
      'openDrawer', 'openPopupApp', 'openUserCustom'],
    { ibiz, RuntimeError: ErrorType, ModelError: ErrorType, clone, Srfuf: { CREATE: 0 } });
  const OpenView = realMethods('ibiz-app-hub/components/ibiz-next-vue3/src/util/open-view-util/open-view-util.ts',
    'OpenViewUtil', ['root'], { ibiz, generateRoutePath: async appView => {
      if (delay === 'route') await pause(appView.id);
      return { path: `/owned/${appView.id.split('.').at(-1)}` };
    } });
  const { source: menuSource, owner } = classSource(menuPath, 'AppMenuController');
  const generation = owner.members.find(node => ts.isPropertyDeclaration(node) &&
    node.name.getText(menuSource) === 'menuNavigationGeneration')?.getText(menuSource) || '';
  const Menu = realMethods(menuPath, 'AppMenuController', ['onClickMenuItem', 'routeDepth'], {
    ibiz, window, clone, equals, RuntimeError: ErrorType, RuntimeModelError: ErrorType,
    findRecursiveChild: (_model, id) => id === 'missing' ? undefined : ({ id, appId: 'owned-app', appFuncId: id }),
    AppFuncCommand: { TAG: 'app-function' },
  }, `${generation}\n${memberSource(`${runtime}/controller/common/control/control.controller.ts`, 'ControlController', ['view'])}`);
  const open = new OpenView();
  open.router = router;
  ibiz.openView = {
    root(...args) {
      const pending = open.root(...args);
      rootTasks.push(pending);
      return pending;
    },
    ...Object.fromEntries(['rootByModal', 'modal', 'popover', 'drawer', 'popupApp', 'custom'].map(name =>
      [name, async (...args) => { otherOpens.push({ name, args }); return { ok: false }; }])),
  };
  const appFunc = new AppFunc(), openApp = new OpenApp();
  ibiz.commands.execute = (tag, ...args) => {
    commands.push(tag);
    if (tag === 'app-function') return appFunc.exec(...args);
    assert.equal(tag, 'open-view');
    return openApp.exec(...args);
  };
  const Context = actualContextClass();
  const parent = Context.create({ root: 'owned-root', srfappid: 'owned-app' });
  const context = Context.create({}, parent);
  const view = { model: { id: 'owned-index' }, modal: { routeDepth: 1 } };
  const ctx = { view, isDestroyed: false };
  const menu = new Menu();
  Object.assign(menu, { ctx, state: { isDestroyed: false }, isDestroying: false,
    model: {}, evt: { emit() {} }, itemProviders: {}, params: {}, context });
  return { menu, context, parent, ctx, view, router, window, pushes, otherOpens, commands, ibiz, modalOption,
    begin: (id = 'workspace', overrides = {}) => menu.onClickMenuItem(id, { type: 'owned-click' }, true,
      { noWaitRoute, event: { type: 'owned-click' }, modalOption, ...overrides }),
    wait: id => waiters(`owned.${id}`).entered.promise,
    release: id => waiters(`owned.${id}`).gate.resolve(),
    async finish(operation) { await operation; await Promise.all(rootTasks); },
    navigate(target) {
      router.currentRoute.value.fullPath = target;
      window.location.href = `http://owned.invalid/#${target}`;
    },
  };
}

for (const delay of ['view', 'route']) {
  test(`a newer deep link cancels the real default-menu chain after delayed ${delay} resolution`, async () => {
    const f = fixture({ delay });
    const operation = f.begin();
    await f.wait('workspace');
    f.navigate('/owned/api-reference');
    f.release('workspace');
    await f.finish(operation);
    assert.deepEqual(f.pushes, []);
    assert.equal(f.router.currentRoute.value.fullPath, '/owned/api-reference');
  });
}

for (const change of ['hash', 'path-query', 'context-reset', 'parent-context', 'view', 'ctx-destroyed',
  'control-destroyed', 'before-destroy']) {
  test(`${change} change invalidates a pending menu route without navigation`, async () => {
    const f = fixture();
    const operation = f.begin();
    await f.wait('workspace');
    if (change === 'hash') f.window.location.href = 'http://owned.invalid/#/owned/new-link';
    if (change === 'path-query') f.window.location.href = 'http://owned.invalid/another?query=changed#/owned/index';
    if (change === 'context-reset') f.context.reset({ srfappid: 'owned-app', root: 'replacement-root' });
    if (change === 'parent-context') f.parent.root = 'replacement-parent-root';
    if (change === 'view') f.ctx.view = { model: { id: 'replacement-view' } };
    if (change === 'ctx-destroyed') { f.ctx.isDestroyed = true; f.ctx.view = null; }
    if (change === 'control-destroyed') f.menu.state.isDestroyed = true;
    if (change === 'before-destroy') f.menu.isDestroying = true;
    f.release('workspace');
    await f.finish(operation);
    assert.deepEqual(f.pushes, []);
  });
}

test('the latest menu intent wins while both model resolutions started from the same URL', async () => {
  const f = fixture();
  const first = f.begin('workspace');
  await f.wait('workspace');
  const second = f.begin('second');
  await f.wait('second');
  f.release('workspace');
  await first;
  assert.deepEqual(f.pushes, []);
  f.release('second');
  await f.finish(second);
  assert.deepEqual(f.pushes, [{ method: 'push', path: '/owned/second' }]);
});

for (const mode of ['INDEXVIEWTAB', 'INDEXVIEWTAB_POPUP', 'UNRECOGNIZED-ROUTE-FALLBACK']) {
  for (const noWaitRoute of [false, true]) {
    test(`${mode} noWaitRoute=${noWaitRoute} retains ordinary navigation and carries cancellation to root`, async () => {
      for (const cancel of [false, true]) {
        const f = fixture({ mode, noWaitRoute });
        const operation = f.begin();
        await f.wait('workspace');
        if (cancel) f.navigate('/owned/explicit-link');
        f.release('workspace');
        await f.finish(operation);
        assert.deepEqual(f.pushes, cancel ? [] : [{ method: 'push', path: '/owned/workspace' }]);
      }
    });
  }
}

test('existing modal options and shouldNavigate are preserved without mutating caller options', async () => {
  for (const allowed of [false, true]) {
    let checks = 0;
    const modalOption = { replace: true, ownedOption: 'preserved', shouldNavigate() { checks += 1; return allowed; } };
    const original = modalOption.shouldNavigate;
    const f = fixture({ modalOption });
    const operation = f.begin();
    await f.wait('workspace');
    f.release('workspace');
    await f.finish(operation);
    assert.ok(checks > 0);
    assert.equal(modalOption.shouldNavigate, original);
    assert.equal(modalOption.ownedOption, 'preserved');
    assert.deepEqual(f.pushes, allowed ? [{ method: 'replace', path: '/owned/workspace' }] : []);
  }
});

test('a genuine model failure is propagated with its original identity', async () => {
  const f = fixture();
  const failure = new Error('controlled real model initialization failure');
  f.ibiz.hub.getAppAsync = async () => { throw failure; };
  await assert.rejects(f.begin(), error => error === failure);
  assert.deepEqual(f.pushes, []);
});

test('missing menus retain their original rejection and destroyed controls dispatch no commands', async () => {
  const f = fixture();
  await assert.rejects(f.begin('missing'), /noFindMenu/);
  f.ctx.isDestroyed = true;
  const operation = f.begin();
  if (f.commands.length) {
    await f.wait('workspace');
    f.release('workspace');
    await f.finish(operation);
  } else await operation;
  assert.deepEqual(f.commands, []);
});

test('custom menu providers retain their exact existing call contract', async () => {
  const f = fixture();
  const observed = [];
  f.menu.itemProviders.workspace = { async onClick(...args) { observed.push(args); } };
  await f.begin();
  assert.equal(observed.length, 1);
  assert.equal(observed[0][0].appFuncId, 'workspace');
  assert.equal(observed[0][1].type, 'owned-click');
  assert.equal(observed[0][2], f.menu);
  assert.deepEqual(f.commands, []);
});

for (const [mode, method] of [
  ['INDEXVIEWTAB_POPUPMODAL', 'rootByModal'], ['POPUPMODAL', 'modal'], ['POPOVER', 'popover'],
  ['DRAWER_LEFT', 'drawer'], ['POPUPAPP', 'popupApp'], ['USER', 'custom'],
]) {
  test(`${mode} keeps its existing ${method} dispatch; stale modal cancellation is outside this route-only change`, async () => {
    const f = fixture({ mode });
    await f.begin();
    assert.equal(f.otherOpens.length, 1);
    assert.equal(f.otherOpens[0].name, method);
    assert.deepEqual(f.pushes, []);
  });
}
