import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const workspace = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
const sourceRoot = process.env.CONTROL_LIFECYCLE_SOURCE_ROOT || workspace;
const require = createRequire(path.join(workspace, 'ibiz-app-hub/package.json'));
const ts = require('typescript');
const runtime = 'ibiz-app-hub/packages/runtime/src';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

class EventBus {
  listeners = new Map();
  on(name, handler) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(handler);
  }
  off(name, handler) { this.listeners.get(name)?.delete(handler); }
  emit(name, ...args) { this.listeners.get(name)?.forEach(handler => handler(...args)); }
  async asyncEmit(name, ...args) {
    return Promise.all([...this.listeners.get(name) || []].map(handler => handler(...args)));
  }
  reset() { this.listeners.clear(); }
}

function load(relative, dependencies, ibiz) {
  const file = path.join(sourceRoot, runtime, relative);
  const compiled = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    reportDiagnostics: true,
  });
  assert.equal(compiled.diagnostics?.length, 0, `The real maintained source must transpile: ${relative}`);
  const exports = {};
  new Function('exports', 'require', 'ibiz', compiled.outputText)(exports, name => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency in ${relative}: ${name}`);
    return dependencies[name];
  }, ibiz);
  return exports;
}

function extendLifecycle(relative, className, Parent, dependencies, ibiz) {
  const file = path.join(sourceRoot, relative);
  const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true);
  const declaration = source.statements.find(statement =>
    ts.isClassDeclaration(statement) && statement.name?.text === className);
  assert.ok(declaration, `The maintained inheritance step must exist: ${className}`);
  const methods = declaration.members.filter(member => ts.isMethodDeclaration(member) &&
    ['onCreated', 'onMounted'].includes(member.name.getText(source)));
  assert.ok(methods.some(member => member.name.getText(source) === 'onCreated'));
  const compiled = ts.transpileModule(
    `class Subject extends Parent { ${methods.map(method => method.getText(source)).join('\n')} }\nexports.Subject = Subject;`,
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  );
  const exports = {};
  new Function('exports', 'Parent', 'ibiz', ...Object.keys(dependencies), compiled.outputText)(
    exports, Parent, ibiz, ...Object.values(dependencies),
  );
  return exports.Subject;
}

function fixture({ delayedProvider = false, withPanel = true, ignoreMessages = false, numberGrid = false } = {}) {
  const provider = deferred();
  const providerEntered = deferred();
  const messages = new Set();
  const calls = { provider: 0, scheduler: 0, timer: 0, destroyedScheduler: 0, changes: 0, force: 0,
    uiActions: 0, dataEntity: 0, gridService: 0, autoSave: 0, createdEvents: 0, mountedEvents: 0, load: 0 };
  const schedulers = [];
  const ibiz = {
    config: { view: { loadingText: 'Loading' } },
    util: { layoutPanel: { get() {} } },
    log: { debug() {}, warn() {} },
    i18n: { t: value => value },
    scheduler: {
      createControlScheduler() {
        calls.scheduler += 1;
        const scheduler = {
          hasControlEventTrigger: true, hasDestroyed: false,
          triggerControlEvent() {
            if (this.hasDestroyed) return;
          },
          startTimerTrigger() {
            assert.equal(this.hasDestroyed, false, 'A destroyed scheduler must not start a timer');
            calls.timer += 1;
          },
          destroy() { this.hasDestroyed = true; calls.destroyedScheduler += 1; },
        };
        schedulers.push(scheduler);
        return scheduler;
      },
    },
    mc: { command: { change: {
      on: handler => messages.add(handler),
      off: handler => messages.delete(handler),
    } } },
    hub: { async getAppDataEntity() {
      calls.dataEntity += 1;
      return { appDEFields: [{ id: 'owned-field', name: 'owned-field' }] };
    } },
  };
  const qx = { QXEvent: EventBus, clearAll: values => values.splice(0), createUUID: () => 'owned-control' };
  const { QXEventEx } = load('controller/utils/event/qx-event-ex.ts', { 'qx-util': qx }, ibiz);
  const { ControllerEvent } = load('controller/utils/event/controller-event.ts', { './qx-event-ex': { QXEventEx } }, ibiz);
  const { Counter } = load('controller/utils/counter/counter.ts', {}, ibiz);
  const { ActivityCounter } = load('controller/utils/counter/mounted-counter.ts', { './counter': { Counter } }, ibiz);
  const { BaseController } = load('controller/common/base.controller.ts', {
    'qx-util': qx, '../utils': { ActivityCounter, ControllerEvent },
  }, ibiz);
  const { CTXState } = load('controller/ctx/ctx.state.ts', {}, ibiz);
  const { CTX } = load('controller/ctx/ctx.ts', { 'qx-util': qx, './ctx.state': { CTXState } }, ibiz);
  class Params {
    constructor(values = {}, parent = {}) { Object.assign(this, parent, values); }
    reset(values, parent) { Object.assign(this, parent, values); }
    destroy() { this.disposed = true; }
  }
  const { ControlController } = load('controller/common/control/control.controller.ts', {
    '..': { BaseController },
    '@ibiz-template/core': { IBizParams: Params, IBizContext: { create: (value, parent) => new Params(value, parent) } },
    ramda: { clone: structuredClone, isNil: value => value == null, isNotNil: value => value != null },
    'qx-util': { notNilEmpty: value => value != null && Object.keys(value).length > 0 },
    '../../../register': { getControlProvider: async () => {
      calls.provider += 1;
      providerEntered.resolve();
      return delayedProvider ? provider.promise : { kind: 'normal-provider' };
    } },
    '../../../utils': { convertNavData: () => ({}) },
    '../../../model': { getControlPanel: model => model.controlPanel, calcDeCodeNameById: () => 'OwnedEntity' },
    '../../../service': { ControlVO: class {} },
  }, ibiz);
  const ctx = new CTX();
  ctx.view = { name: 'owned-view', model: { id: 'owned-view', name: 'owned-view' } };
  let Controller = ControlController;
  if (numberGrid) {
    Controller = extendLifecycle(`${runtime}/controller/common/control/md-control.controller.ts`,
      'MDControlController', Controller, {}, ibiz);
    Controller = extendLifecycle(`${runtime}/controller/control/grid/grid/grid.controller.ts`,
      'GridController', Controller, {
        convertNavData: value => value,
        GridService: class {
          constructor() { calls.gridService += 1; }
          async init() {}
        },
        debounceAndAsyncMerge: handler => handler,
      }, ibiz);
    Controller = extendLifecycle('plm-web/plugin-src/@ibiz-template-plugin/number-grid/src/index.ts',
      'Xe', Controller, {}, ibiz);
  }
  const control = new Controller({
    id: 'owned-control', name: 'owned-control', codeName: 'owned-control', controlType: 'GRID',
    appDataEntityId: 'owned-entity', controlLogics: [{ triggerType: 'CTRLEVENT' }],
    controlParam: { ctrlParams: { DEFAULTEXPANDALL: 'true' } },
    ...(withPanel ? { controlPanel: { name: 'owned-panel' } } : {}),
  }, {}, {}, ctx);
  if (ignoreMessages) control.controlParams.ignoremcmsg = 'true';
  control.onDEDataChange = () => { calls.changes += 1; };
  control.force = callback => { calls.force += 1; callback?.(); };
  control.defaultExpandAll = false;
  control.fieldIdNameMap = new Map();
  control.initUIActions = async () => { calls.uiActions += 1; };
  control.setSort = () => {};
  control.initByEntitySchema = async () => {};
  control.initColumnStates = () => {};
  control.initGridColumns = async () => {};
  control.dataChangeNotify = () => {};
  control.initGroup = async () => {};
  control.initExportData = async () => {};
  control.initAutoSaveTimer = () => { calls.autoSave += 1; };
  control.load = () => { calls.load += 1; };
  control.evt.on('onCreated', () => { calls.createdEvents += 1; });
  control.evt.on('onMounted', () => { calls.mountedEvents += 1; });
  return { ctx, control, calls, messages, schedulers, provider, providerEntered };
}

async function settle() {
  for (let index = 0; index < 12; index += 1) await Promise.resolve();
}

function assertCancelled(f) {
  assert.equal(f.control.triggerKey, '', 'Cancelled initialization must not synthesize a trigger key');
  assert.equal(f.calls.scheduler, 0);
  assert.equal(f.calls.timer, 0);
  assert.equal(f.messages.size, 0);
  assert.equal(f.control.state.isCreated, false);
  assert.equal(f.control.state.isMounted, false);
  assert.equal(f.calls.force, 0);
  assert.equal(f.calls.createdEvents, 0);
  assert.equal(f.calls.mountedEvents, 0);
  assert.deepEqual(Object.keys(f.control.providers), []);
}

test('ctx destruction before creation cancels initialization without resource registrations', async () => {
  const f = fixture();
  f.ctx.destroy();
  await f.control.created();
  await settle();
  assertCancelled(f);
  assert.equal(f.calls.provider, 0);
});

test('ctx destruction during the base creation await cancels before resolving a panel provider', async () => {
  const f = fixture();
  const created = f.control.created();
  f.ctx.destroy();
  await created;
  await settle();
  assertCancelled(f);
  assert.equal(f.calls.provider, 0);
});

test('a real delayed provider cannot initialize scheduler, message subscription or mounting after ctx.destroy', async () => {
  const f = fixture({ delayedProvider: true });
  const created = f.control.created();
  await f.providerEntered.promise;
  f.ctx.destroy();
  assert.equal(f.ctx.view, null, 'Exercise the real CTX.destroy clearing the view');
  f.provider.resolve({ kind: 'late-provider' });
  await created;
  await settle();
  assertCancelled(f);
});

test('control destruction while its provider is pending cancels completion even if its ctx remains live', async () => {
  const f = fixture({ delayedProvider: true });
  const created = f.control.created();
  await f.providerEntered.promise;
  await f.control.destroyed();
  assert.equal(f.ctx.isDestroyed, false);
  assert.equal(f.control.state.isDestroyed, true);
  f.provider.resolve({ kind: 'late-provider' });
  await created;
  await settle();
  assertCancelled(f);
});

test('a pending before-destroy handler blocks a late provider before isDestroyed becomes true', async () => {
  const f = fixture({ delayedProvider: true });
  const beforeDestroy = deferred();
  const entered = deferred();
  f.control.evt.on('onBeforeDestroy', () => { entered.resolve(); return beforeDestroy.promise; });
  const created = f.control.created();
  await f.providerEntered.promise;
  const destroyed = f.control.destroyed();
  await entered.promise;
  assert.equal(f.control.state.isDestroyed, false);
  f.provider.resolve({ kind: 'late-provider' });
  await created;
  await settle();
  assertCancelled(f);
  beforeDestroy.resolve();
  await destroyed;
});

test('ctx destruction between creation and scheduled mounting never starts a timer', async () => {
  const f = fixture({ withPanel: false });
  let mounted;
  f.control.force = callback => { f.calls.force += 1; mounted = callback; };
  await f.control.created();
  assert.equal(f.control.state.isCreated, true);
  f.ctx.destroy();
  mounted();
  await settle();
  assert.equal(f.calls.timer, 0);
  assert.equal(f.control.state.isMounted, false);
  await f.control.destroyed();
  assert.equal(f.messages.size, 0);
  assert.equal(f.calls.destroyedScheduler, 1);
});

test('ctx destruction during the mounted await does not start timers or mark mounting complete', async () => {
  const f = fixture({ withPanel: false });
  let mountCallback;
  f.control.force = callback => { f.calls.force += 1; mountCallback = callback; };
  await f.control.created();
  mountCallback();
  f.ctx.destroy();
  await settle();
  assert.equal(f.calls.timer, 0);
  assert.equal(f.control.state.isMounted, false);
  await f.control.destroyed();
  assert.equal(f.messages.size, 0);
});

test('normal creation keeps the exact trigger key, provider and event delivery, then releases resources', async () => {
  const f = fixture();
  let createdEvents = 0;
  f.control.evt.on('onCreated', () => { createdEvents += 1; });
  await f.control.created();
  await settle();
  assert.equal(f.control.triggerKey, 'owned-view@OwnedEntity@GRID@owned-control');
  assert.equal(f.control.providers['owned-panel'].kind, 'normal-provider');
  assert.equal(f.control.state.isCreated, true);
  assert.equal(createdEvents, 1);
  assert.equal(f.calls.scheduler, 1);
  assert.equal(f.messages.size, 1);
  [...f.messages][0]({});
  assert.equal(f.calls.changes, 1);
  await f.control.destroyed();
  assert.equal(f.control.state.isDestroyed, true);
  assert.equal(f.calls.destroyedScheduler, 1);
  assert.equal(f.messages.size, 0);
  assert.equal(f.control.params.disposed, true);
});

test('normal controls without layout panels mount once and preserve ignoremcmsg behavior', async () => {
  const f = fixture({ withPanel: false, ignoreMessages: true });
  await f.control.created();
  await settle();
  assert.equal(f.calls.provider, 0);
  assert.equal(f.control.state.isCreated, true);
  assert.equal(f.control.state.isMounted, true);
  assert.equal(f.calls.timer, 1);
  assert.equal(f.messages.size, 0);
  await f.control.destroyed();
  assert.equal(f.calls.destroyedScheduler, 1);
  assert.equal(f.messages.size, 0);
});

test('a live provider failure remains a rejection rather than a successful cancellation', async () => {
  const f = fixture({ delayedProvider: true });
  const created = f.control.created();
  await f.providerEntered.promise;
  const failure = new Error('controlled provider failure');
  f.provider.reject(failure);
  await assert.rejects(created, error => error === failure);
  assertCancelled(f);
});

test('delayed cancellation unwinds the real MD, Grid and number-grid onCreated inheritance chain', async () => {
  const f = fixture({ delayedProvider: true, numberGrid: true });
  const created = f.control.created();
  await f.providerEntered.promise;
  f.ctx.destroy();
  f.provider.resolve({ kind: 'late-provider' });
  await created;
  await settle();
  assertCancelled(f);
  assert.equal(f.calls.uiActions, 0);
  assert.equal(f.calls.dataEntity, 0);
  assert.equal(f.calls.gridService, 0);
  assert.equal(f.calls.autoSave, 0);
  assert.equal(f.control.defaultExpandAll, false, 'The plugin continuation must not run after parent cancellation');
});

test('normal creation completes the real MD, Grid and number-grid initialization chain', async () => {
  const f = fixture({ numberGrid: true });
  await f.control.created();
  await settle();
  assert.equal(f.control.state.isCreated, true);
  assert.equal(f.calls.uiActions, 1);
  assert.equal(f.calls.dataEntity, 1);
  assert.equal(f.calls.gridService, 1);
  assert.equal(f.calls.autoSave, 1);
  assert.equal(f.control.defaultExpandAll, true);
  await f.control.destroyed();
  assert.equal(f.messages.size, 0);
});

test('cancelled mounting unwinds MD loadDefault after the real Control mounted await', async () => {
  const f = fixture({ numberGrid: true, withPanel: false });
  let mountCallback;
  f.control.force = callback => { mountCallback = callback; };
  f.control.state.loadDefault = true;
  await f.control.created();
  mountCallback();
  f.ctx.destroy();
  await settle();
  assert.equal(f.control.state.isMounted, false);
  assert.equal(f.calls.timer, 0);
  assert.equal(f.calls.load, 0);
  assert.equal(f.calls.mountedEvents, 0);
  await f.control.destroyed();
});

test('an active derived grid initialization error retains its original identity', async () => {
  const f = fixture({ numberGrid: true });
  const failure = new Error('controlled active grid column failure');
  f.control.initGridColumns = async () => { throw failure; };
  await assert.rejects(f.control.created(), error => error === failure);
  assert.equal(f.control.state.isCreated, false);
  assert.equal(f.calls.createdEvents, 0);
  assert.equal(f.control.defaultExpandAll, false);
  await f.control.destroyed();
  assert.equal(f.messages.size, 0);
});
