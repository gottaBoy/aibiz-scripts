import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import test from 'node:test';

const sourceUrl = new URL('../../vendor-upstream/gottaboy-plm-web/plugin-src/' +
  '@ibiz-template-plugin/ai-code@0.0.3-alpha.141/src/monaco-editor/monaco-editor.tsx',
import.meta.url);
const require = createRequire(new URL('../../vendor-upstream/gottaboy-plm-web/plugin-src/' +
  '@ibiz-template-plugin/ai-code@0.0.3-alpha.141/package.json', import.meta.url));
const ts = require('typescript');
const source = ts.createSourceFile(fileURLToPath(sourceUrl), fs.readFileSync(sourceUrl, 'utf8'),
  ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const setups = [];
function visit(node) {
  if (ts.isMethodDeclaration(node) && node.name.getText(source) === 'setup') setups.push(node);
  ts.forEachChild(node, visit);
}
visit(source);
assert.equal(setups.length, 1, 'Execute the real component setup, not a lifecycle reimplementation');
const { outputText } = ts.transpileModule(
  `globalThis.createSetup = function${setups[0].getText(source).slice('setup'.length)};`,
  { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } },
);

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

function eventTarget() {
  const listeners = new Map();
  return {
    listeners,
    addEventListener(name, handler) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(handler);
    },
    removeEventListener(name, handler) { listeners.get(name)?.delete(handler); },
    dispatch(name) {
      for (const handler of [...(listeners.get(name) || [])]) handler({ target: {} });
    },
    count(name) { return listeners.get(name)?.size || 0; },
  };
}

async function flush() {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

function fixture({ workerFactory } = {}) {
  const window = eventTarget();
  const hooks = {};
  const timers = new Map();
  const intervals = new Map();
  const pendingLoaders = [];
  const editors = [];
  const warnings = [];
  let timerId = 0;
  const monaco = {
    Uri: { parse: value => value },
    languages: { typescript: {
      typescriptDefaults: {
        getExtraLibs: () => workerFactory ? {} : { 'ibiz-global.d.ts': {} },
      },
      getTypeScriptWorker: workerFactory,
    } },
    editor: {
      create() {
        const dom = eventTarget();
        const editor = {
          dom, disposed: false, layouts: 0, value: '', __instanceId: '',
          layout() {
            assert.equal(this.disposed, false, 'A disposed editor must never receive layout');
            this.layouts += 1;
          },
          getDomNode: () => dom,
          getContribution: () => undefined,
          getValue() { return this.value; },
          setValue(value) {
            assert.equal(this.disposed, false, 'A disposed editor must never receive setValue');
            this.value = value;
          },
          onDidFocusEditorText() {},
          onDidBlurEditorText() {},
          onDidChangeModelContent() {},
          onDidChangeCursorSelection() {},
          dispose() { this.disposed = true; },
        };
        editors.push(editor);
        return editor;
      },
      getEditors: () => editors.filter(editor => !editor.disposed),
    },
  };
  const controller = {
    model: { editorParams: { completionmode: 'aichat' } },
    placeHolder: '', language: 'typescript',
    onCreated(editor) { this.editor = editor; },
  };
  const context = {
    URL, window, document: { baseURI: 'http://localhost/central/' },
    ibiz: {
      env: { pluginBaseUrl: './plugins' },
      i18n: { getLang: () => 'zh-CN', t: value => value },
      aiChatUtil: { calcAiToolbarItemsByAc: () => ({ functionToolbarItems: [] }) },
      log: { warn: warning => warnings.push(String(warning)) },
    },
    ref: value => ({ value }),
    watch(getter, handler, options) { if (options?.immediate) handler(getter()); },
    nextTick: handler => Promise.resolve().then(handler),
    onMounted: handler => { hooks.mount = handler; },
    onUnmounted: handler => { hooks.unmount = handler; },
    useUIStore: () => ({ zIndex: { increment: () => 1 } }),
    useNamespace: () => ({ cssVarBlockName: value => value }),
    createUUID: () => 'test-instance',
    LanguageManager: class { theme = 'test'; },
    CodeModuleCenter: class {},
    loader: {
      config() {},
      init() {
        const load = deferred();
        pendingLoaders.push(load);
        return load.promise;
      },
    },
    setTimeout(handler) { const id = ++timerId; timers.set(id, handler); return id; },
    clearTimeout: id => timers.delete(id),
    setInterval(handler) { const id = ++timerId; intervals.set(id, handler); return id; },
    clearInterval: id => intervals.delete(id),
  };
  vm.runInNewContext(outputText, context);
  const state = context.createSetup({ controller, value: 'const value = 1;' }, { emit() {} });
  state.codeEditBox.value = {};
  return {
    window, hooks, state, monaco, timers, intervals, pendingLoaders, editors, warnings,
    async mount() { hooks.mount(); await flush(); },
    async loaded(index = pendingLoaders.length - 1) {
      pendingLoaders[index].resolve(monaco);
      await flush();
    },
  };
}

test('unmount removes identical window/DOM handlers and every pending timeout', async () => {
  const f = fixture();
  await f.mount();
  await f.loaded();
  assert.equal(f.editors.length, 1);
  assert.equal(f.window.count('resize'), 1);
  assert.equal(f.window.count('mousedown'), 1);
  f.window.dispatch('resize');
  assert.equal(f.editors[0].layouts, 1);
  f.editors[0].dom.dispatch('click');
  assert.equal(f.timers.size, 2);
  f.hooks.unmount();
  assert.equal(f.editors[0].disposed, true);
  assert.equal(f.window.count('resize'), 0);
  assert.equal(f.window.count('mousedown'), 0);
  assert.equal(f.editors[0].dom.count('click'), 0);
  assert.equal(f.timers.size, 0);
  f.window.dispatch('resize');
  f.window.dispatch('mousedown');
  assert.equal(f.editors[0].layouts, 1);
});

test('immediate unmount cancels initialization before nextTick starts the loader', async () => {
  const f = fixture();
  f.hooks.mount();
  f.hooks.unmount();
  await flush();
  assert.equal(f.pendingLoaders.length, 0);
  assert.equal(f.editors.length, 0);
  assert.equal(f.window.count('mousedown'), 0);
});

test('a loader resolved after unmount cannot create an orphaned editor', async () => {
  const f = fixture();
  await f.mount();
  f.hooks.unmount();
  await f.loaded();
  assert.equal(f.editors.length, 0);
  assert.equal(f.timers.size, 0);
  assert.equal(f.window.count('resize'), 0);
});

test('fullscreen replacement ignores stale loader resolutions and keeps one resize handler', async () => {
  const f = fixture();
  await f.mount();
  await f.state.changeFullScreenState();
  await flush();
  assert.equal(f.pendingLoaders.length, 2);
  await f.loaded(0);
  assert.equal(f.editors.length, 0);
  await f.loaded(1);
  assert.equal(f.editors.length, 1);
  await f.state.changeFullScreenState();
  await flush();
  assert.equal(f.editors[0].disposed, true);
  assert.equal(f.timers.size, 0);
  await f.loaded(2);
  assert.equal(f.editors.length, 2);
  assert.equal(f.window.count('resize'), 1);
  f.hooks.unmount();
  assert.equal(f.window.count('resize'), 0);
});

test('pending TypeScript worker initialization is ignored after unmount', async () => {
  const worker = deferred();
  const f = fixture({ workerFactory: () => worker.promise });
  await f.mount();
  await f.loaded();
  assert.equal(f.state.isTSFileLoading.value, true);
  f.hooks.unmount();
  worker.resolve(async () => ({ getScriptFileNames: async () => [] }));
  await flush();
  assert.equal(f.intervals.size, 0);
  assert.equal(f.state.isTSFileLoading.value, false);
});

test('TypeScript polling is canceled on unmount and worker rejection is handled', async () => {
  const f = fixture({ workerFactory: async () => async () => ({
    getScriptFileNames: async () => { throw new Error('worker unavailable'); },
  }) });
  await f.mount();
  await f.loaded();
  assert.equal(f.intervals.size, 1);
  [...f.intervals.values()][0]();
  await flush();
  assert.equal(f.intervals.size, 0);
  assert.equal(f.state.isTSFileLoading.value, false);
  assert.deepEqual(f.warnings, ['Error: worker unavailable']);
  f.hooks.unmount();
});

test('an active TypeScript polling interval cannot survive unmount', async () => {
  const f = fixture({ workerFactory: async () => async () => ({
    getScriptFileNames: async () => [],
  }) });
  await f.mount();
  await f.loaded();
  assert.equal(f.intervals.size, 1);
  f.hooks.unmount();
  assert.equal(f.intervals.size, 0);
});
