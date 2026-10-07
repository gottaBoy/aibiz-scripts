import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { runInThisContext, runInNewContext } from 'node:vm';
import {
  buildLocalFileToBase64,
  pluginRoot,
} from '../../modelingweb/local-plugins/file-to-base64/build.mjs';

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const appRequire = createRequire(join(workspace, 'modelingweb/app/package.json'));
const hubRequire = createRequire(join(workspace, 'ibiz-app-hub/package.json'));
const ts = appRequire('typescript');
const { Window } = hubRequire('happy-dom');
const window = new Window();
for (const name of [
  'window', 'document', 'Node', 'Element', 'HTMLElement', 'HTMLInputElement',
  'SVGElement', 'Event', 'FocusEvent', 'KeyboardEvent', 'File', 'Blob', 'FileReader',
]) {
  globalThis[name] = name === 'window' ? window : window[name];
}
// Vue captures document at import time; set the isolated DOM first.
const vue = appRequire('vue');

function loadSource(file, boundaries = {}, cache = new Map()) {
  const absolute = resolve(file);
  if (cache.has(absolute)) return cache.get(absolute).exports;
  const module = { exports: {} };
  cache.set(absolute, module);
  const code = ts.transpileModule(readFileSync(absolute, 'utf8'), {
    fileName: absolute,
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2020,
      useDefineForClassFields: false,
      esModuleInterop: true,
    },
  }).outputText;
  const require = id => {
    if (Object.hasOwn(boundaries, id)) return boundaries[id];
    if (id === 'vue') return vue;
    if (id.startsWith('.')) {
      return loadSource(resolve(dirname(absolute), `${id}.ts`), boundaries, cache);
    }
    throw new Error(`Unspecified source-test boundary: ${id} from ${absolute}`);
  };
  runInThisContext(`(function(require,module,exports){${code}\n})`, {
    filename: absolute,
  })(require, module, module.exports);
  return module.exports;
}

const runtimeRoot = join(workspace, 'ibiz-app-hub/packages/runtime/src');
const propsRoot = join(workspace, 'ibiz-app-hub/packages/vue3-util/src/props');
const unused = () => { throw new Error('Unused runtime boundary invoked'); };
const { EditorController } = loadSource(
  join(runtimeRoot, 'controller/common/editor/editor.controller.ts'),
  {
    '@ibiz-template/core': { DataTypes: { isDate: unused } },
    dayjs: unused,
    '../../../utils': { convertNavData: unused },
    '../../utils': { ValueExUtil: { toText: unused } },
    '../control': { ControlController: class {} },
  },
);
const { RegisterCenter } = loadSource(join(runtimeRoot, 'register/register-center.ts'));
const registry = loadSource(join(runtimeRoot, 'register/helper/editor-register.ts'), {
  '../custom-register': { CustomRegister: { getRegisterKey: () => 'NO_CUSTOM_PROVIDER' } },
});
const vueUtil = {
  ...loadSource(join(propsRoot, 'editor/common.ts')),
  ...loadSource(join(propsRoot, 'editor/upload.ts')),
};
const runtime = { EditorController, registerEditorProvider: registry.registerEditorProvider };
const plugin = loadSource(join(pluginRoot, 'src/index.ts'), {
  '@ibiz-template/runtime': runtime,
  '@ibiz-template/vue3-util': vueUtil,
});
const logic = loadSource(join(pluginRoot, 'src/file-logic.ts'));
const parent = () => ({ context: { srfappid: 'fixture' }, params: { test: true } });
const file = (name = 'report.txt', size = 2, type = 'text/plain') => ({ name, size, type });
const errorCode = code => error =>
  error.name === 'FileConversionError' && error.code === code;
const modelsRoot = join(
  workspace,
  'vendor-upstream/ibizmodeling-standard/modelapi-core/src/main/resources/model/net/ibizsys/modeling/PSSYSAPPS/ModelDesign/PSAPPDATAENTITIES',
);
const nativePaths = [
  'PSDEPrint/PSFORMS/QuickCreate.json',
  'PSDEPrint/PSFORMS/QuickCfg.json',
  'PSDEReport/PSFORMS/QuickCreate.json',
  'PSDEReport/PSFORMS/QuickCfg.json',
];
function findEditors(value, result = []) {
  if (!value || typeof value !== 'object') return result;
  if (value.editorStyle === 'FILE_TO_BASE64') result.push(value);
  for (const child of Object.values(value)) findEditors(child, result);
  return result;
}
const nativeEditors = nativePaths.map(path => {
  const editors = findEditors(JSON.parse(readFileSync(join(modelsRoot, path), 'utf8')));
  assert.equal(editors.length, 1, path);
  return editors[0];
});

test('four native editors resolve their concrete scalar and filename contract', () => {
  for (const model of nativeEditors) {
    assert.equal(model.editorType, 'FILEUPLOADER_ONE');
    assert.ok(['printmodel', 'reportmodel'].includes(model.name));
    assert.equal(model.getPSSysPFPlugin.pluginType, 'EDITOR_CUSTOMSTYLE');
    assert.equal(model.getPSSysPFPlugin.pluginCode, 'FILE_TO_BASE64');
    assert.deepEqual(logic.resolveFileConfig(model), {
      encoding: 'data-url', accept: '', maxFileCount: 1, maxSizeBytes: Infinity,
      filenameField: 'reportfile', readonly: false, disabled: false,
    });
    assert.equal(model.editorParams.encoding, undefined);
  }
});

test('configuration accepts explicit local encoding and boolean aliases', () => {
  for (const encoding of ['base64', 'raw-base64', 'BASE64']) {
    assert.equal(logic.resolveFileConfig({}, { ENCODING: encoding }).encoding, 'base64');
  }
  for (const encoding of ['data-url', 'dataurl', 'DATAURL']) {
    assert.equal(logic.resolveFileConfig({}, { encoding }).encoding, 'data-url');
  }
  assert.equal(logic.resolveFileConfig({}, { RAWBASE64: ' TRUE ' }).encoding, 'base64');
  const config = logic.resolveFileConfig({}, {
    encoding: 'data-url', rawbase64: true, filename: ' reportfile ',
    READONLY: '1', Disabled: true,
  });
  assert.equal(config.encoding, 'data-url');
  assert.equal(config.filenameField, 'reportfile');
  assert.equal(config.readonly, true);
  assert.equal(config.disabled, true);
  assert.throws(() => logic.resolveFileConfig({}, { encoding: 'binary' }), errorCode('config'));
  assert.throws(() => logic.resolveFileConfig({}, { filename: {} }), errorCode('config'));
  assert.throws(() => logic.resolveFileConfig({ name: 'value' }, { filename: 'VALUE' }), errorCode('config'));
});

test('accept normalizes extensions, MIME and wildcard rules with explicit precedence', () => {
  assert.equal(logic.normalizeAccept(' *.TXT; pdf, IMAGE/*,application/json '),
    '.txt,.pdf,image/*,application/json');
  const accepted = logic.resolveFileConfig({ fileExts: 'xml' }, { accept: '.txt;image/*' });
  assert.equal(logic.matchesAccept(file('REPORT.TXT', 2, ''), accepted.accept), true);
  assert.equal(logic.matchesAccept(file('image', 2, 'image/png'), accepted.accept), true);
  assert.equal(logic.matchesAccept(file('report.pdf'), accepted.accept), false);
  assert.equal(logic.matchesAccept(file(), 'text/plain'), true);
  assert.equal(logic.matchesAccept(file('archive.TAR.GZ'), '.tar.gz'), true);
  for (const any of ['*', '*.*', '*/*']) {
    assert.equal(logic.matchesAccept(file(), logic.normalizeAccept(any)), true);
  }
  assert.equal(logic.resolveFileConfig({ fileExts: 'xml' }).accept, '.xml');
  assert.equal(logic.resolveFileConfig({ fileExts: 'xml' }, { FILEEXTS: 'pdf' }).accept, '.pdf');
  assert.equal(logic.resolveFileConfig({ fileExts: 'xml' }, { accept: '' }).accept, '');
  assert.throws(() => logic.normalizeAccept('bad type'), errorCode('config'));
  assert.throws(() => logic.normalizeAccept(['txt']), errorCode('config'));
});

test('size limits use explicit bytes or local MiB and include their exact boundary', () => {
  for (const params of [{ size: '1' }, { MAXFILESIZE: 1 }]) {
    const config = logic.resolveFileConfig({}, params);
    assert.equal(config.maxSizeBytes, 1024 * 1024);
    assert.equal(logic.validateSelection([file('r.txt', 1024 * 1024)], config).size, 1024 * 1024);
    assert.throws(() => logic.validateSelection([file('r.txt', 1024 * 1024 + 1)], config), errorCode('size'));
  }
  assert.equal(logic.resolveFileConfig({ maxFileSize: 2 }).maxSizeBytes, 2 * 1024 * 1024);
  assert.equal(logic.resolveFileConfig({ maxFileSize: 2 }, { size: 0.5 }).maxSizeBytes, 524288);
  assert.equal(logic.resolveFileConfig({}, { maxsizebytes: 5, size: 20 }).maxSizeBytes, 5);
  assert.equal(logic.resolveFileConfig({}, { size: null }).maxSizeBytes, Infinity);
  assert.equal(logic.resolveFileConfig({}, { maxsizebytes: null, size: 1 }).maxSizeBytes, 1048576);
  for (const size of [-1, 0, '-1', '0']) {
    assert.equal(logic.resolveFileConfig({}, { size }).maxSizeBytes, Infinity);
  }
  for (const size of [-2, -0.5, NaN, Infinity, 'bad', '', ' ', true, {}, []]) {
    assert.throws(() => logic.resolveFileConfig({}, { size }), errorCode('config'), String(size));
  }
  assert.throws(() => logic.resolveFileConfig({}, { size: Number.MAX_VALUE }), errorCode('config'));
});

test('scalar selection rejects multiple files, bad metadata and unsupported counts', () => {
  const config = logic.resolveFileConfig({}, { accept: '.txt', maxsizebytes: 3 });
  assert.equal(logic.validateSelection([], config), undefined);
  assert.equal(logic.validateSelection([file()], config).name, 'report.txt');
  assert.throws(() => logic.validateSelection([file(), file()], config), errorCode('count'));
  assert.throws(() => logic.validateSelection([file('bad.pdf')], config), errorCode('type'));
  for (const size of [-1, NaN, Infinity, 4]) {
    assert.throws(() => logic.validateSelection([file('report.txt', size)], config), errorCode('size'));
  }
  assert.equal(logic.resolveFileConfig({}, { MAXFILECNT: -1 }).maxFileCount, 1);
  for (const count of [0, 2, 1.5, 'bad']) {
    assert.throws(() => logic.resolveFileConfig({}, { MAXFILECNT: count }), errorCode('config'));
  }
});

test('data URL conversion preserves MIME and handles empty and binary base64', () => {
  for (const payload of ['', 'YQ==', 'YWI=', 'YWJj', 'AP/+']) {
    const url = `data:application/octet-stream;base64,${payload}`;
    assert.equal(logic.dataUrlToValue(url, 'data-url'), url);
    assert.equal(logic.dataUrlToValue(url, 'base64'), payload);
  }
  for (const invalid of [null, 123, 'hello', 'data:text/plain,hello',
    'data:;base64,Y', 'data:;base64,YQ=', 'data:;base64,YQ==junk', 'data:;base64, YQ==']) {
    assert.throws(() => logic.dataUrlToValue(invalid, 'base64'), errorCode('read'));
  }
});

class ControlledReader {
  static instances = [];
  result = null;
  onload = null;
  onerror = null;
  onabort = null;
  aborted = false;
  constructor() { ControlledReader.instances.push(this); }
  readAsDataURL(blob) { this.file = blob; }
  abort() { this.aborted = true; this.onabort?.(); }
  succeed(value = 'data:text/plain;base64,YWI=') {
    this.result = value;
    this.onload?.();
  }
  fail() { this.onerror?.(); }
}
function expectClean(reader) {
  assert.equal(reader.onload, null);
  assert.equal(reader.onerror, null);
  assert.equal(reader.onabort, null);
}

test('FileReader success, error, malformed result and cancellation clean up handlers', async () => {
  const blob = new Blob(['ab']);
  const reader = new ControlledReader();
  const success = logic.readFileAsValue(blob, 'base64', undefined, () => reader);
  reader.succeed();
  assert.equal(await success, 'YWI=');
  expectClean(reader);

  for (const action of ['fail', 'malformed', 'abort']) {
    const current = new ControlledReader();
    const promise = logic.readFileAsValue(blob, 'data-url', undefined, () => current);
    const rejection = assert.rejects(promise, errorCode(action === 'abort' ? 'aborted' : 'read'));
    if (action === 'malformed') current.succeed('invalid');
    else current[action]();
    await rejection;
    expectClean(current);
  }
  const abort = new AbortController();
  const current = new ControlledReader();
  const pending = logic.readFileAsValue(blob, 'base64', abort.signal, () => current);
  const rejection = assert.rejects(pending, errorCode('aborted'));
  abort.abort();
  await rejection;
  assert.equal(current.aborted, true);
  expectClean(current);
  current.succeed();
  await assert.rejects(logic.readFileAsValue(blob, 'base64', abort.signal, unused), errorCode('aborted'));
  await assert.rejects(logic.readFileAsValue(blob, 'base64', undefined, () => { throw new Error(); }), errorCode('read'));
  const throws = new ControlledReader();
  throws.readAsDataURL = () => { throw new Error(); };
  await assert.rejects(logic.readFileAsValue(blob, 'base64', undefined, () => throws), errorCode('read'));
  expectClean(throws);
});

test('real FileReader converts text, binary and zero-byte files', async () => {
  for (const bytes of [new Uint8Array(), new Uint8Array([0, 255, 254]), new Uint8Array([97, 98])]) {
    const blob = new File([bytes], 'report.bin', { type: 'application/octet-stream' });
    const value = await logic.readFileAsValue(blob, 'data-url');
    assert.equal(value, `data:application/octet-stream;base64,${Buffer.from(bytes).toString('base64')}`);
    assert.equal(await logic.readFileAsValue(blob, 'base64'), Buffer.from(bytes).toString('base64'));
  }
});

test('change tuple contract has no invented attachment serialization', () => {
  assert.deepEqual(logic.valueChanges('YWI=', 'r.txt', 'reportfile'), [
    ['YWI='], ['r.txt', 'reportfile'],
  ]);
  assert.deepEqual(logic.valueChanges(null, null, 'reportfile'), [[null], [null, 'reportfile']]);
  assert.deepEqual(logic.valueChanges('YWI=', 'r.txt', ''), [['YWI=']]);
  assert.equal(logic.formatFileSize(0), '0 B');
  assert.equal(logic.formatFileSize(1024), '1.0 KiB');
  assert.equal(logic.formatFileSize(1048576), '1.0 MiB');
});

test('provider awaits real local EditorController initialization for all native models', async () => {
  const provider = new plugin.FileToBase64Provider();
  assert.equal(provider.formEditor, 'AIBizFileToBase64');
  assert.equal(provider.gridEditor, 'AIBizFileToBase64');
  for (const original of nativeEditors) {
    const model = {
      ...structuredClone(original), id: 'self', readOnly: true, placeHolder: 'Choose report',
      editorWidth: 0.5, cssStyle: 'min-height:30px',
      editorItems: [{ id: 'self' }, { id: 'reportfile' }],
    };
    const container = parent();
    const controller = await provider.createController(model, container);
    assert.ok(controller instanceof EditorController);
    assert.equal(controller.context, container.context);
    assert.equal(controller.params, container.params);
    assert.equal(controller.placeHolder, 'Choose report');
    assert.equal(controller.style.width, '50%');
    assert.equal(controller.style['min-height'], '30px');
    assert.equal(controller.readonly, true);
    assert.equal(controller.config.filenameField, 'reportfile');
    assert.deepEqual(controller.editorParams, model.editorParams);
    assert.deepEqual(controller.model.editorItems, [{ id: 'reportfile' }]);
    assert.equal(controller.extraParams.emptyHiddenUnit, true);
  }
  await assert.rejects(provider.createController({ editorParams: { encoding: 'no' } }, parent()), errorCode('config'));

  const original = plugin.FileToBase64Controller.prototype.init;
  let release;
  let initialized = false;
  plugin.FileToBase64Controller.prototype.init = async function () {
    await new Promise(resolve => { release = resolve; });
    await original.call(this);
    initialized = true;
  };
  try {
    let returned = false;
    const pending = provider.createController({}, parent()).then(c => { returned = true; return c; });
    await Promise.resolve();
    assert.equal(returned, false);
    release();
    await pending;
    assert.equal(initialized, true);
  } finally {
    plugin.FileToBase64Controller.prototype.init = original;
  }
});

test('default plugin registers the exact real runtime lookup key and component', async () => {
  const register = new RegisterCenter();
  const loads = [];
  globalThis.ibiz = {
    register,
    log: { debug() {}, warn() {} },
    i18n: { t: key => key },
    hub: {
      getPlugin: () => nativeEditors[0].getPSSysPFPlugin,
      getApp: () => ({ model: {} }),
    },
    plugin: { loadPlugin: async (...args) => { loads.push(args); } },
  };
  const components = new Map();
  plugin.default.install({ component: (name, component) => { components.set(name, component); } });
  assert.equal(plugin.PROVIDER_KEY, 'EDITOR_CUSTOMSTYLE_FILE_TO_BASE64');
  assert.equal(components.get('AIBizFileToBase64'), plugin.AIBizFileToBase64);
  assert.ok(register.get('EDITOR_EDITOR_CUSTOMSTYLE_FILE_TO_BASE64') instanceof plugin.FileToBase64Provider);
  assert.equal(register.get('EDITOR_FILEUPLOADER_ONE'), undefined);
  const resolved = await registry.getEditorProvider({
    ...nativeEditors[0], appId: 'fixture', sysPFPluginId: 'file_to_base64',
  });
  assert.ok(resolved instanceof plugin.FileToBase64Provider);
  assert.equal(loads.length, 1);
  assert.equal(loads[0][1], 'fixture');
});

async function mountEditor({ params = {}, value = null, data = {}, readonly = false,
  disabled = false, model = {}, autoFocus = false } = {}) {
  const controller = await new plugin.FileToBase64Provider().createController({
    editorParams: params, ...model,
  }, parent());
  const state = vue.reactive({ value, data, readonly, disabled });
  const changes = [];
  const focus = [];
  const element = document.createElement('div');
  document.body.append(element);
  const app = vue.createApp({
    setup: () => () => vue.h(plugin.AIBizFileToBase64, {
      ...state, controller, autoFocus,
      onChange(...args) {
        changes.push(args);
        if (args[1]) state.data[args[1]] = args[0];
        else state.value = args[0];
      },
      onFocus: () => focus.push('focus'),
      onBlur: () => focus.push('blur'),
      onEnter: () => focus.push('enter'),
    }),
  });
  app.mount(element);
  await vue.nextTick();
  return {
    state, changes, focus, element, controller,
    input: () => element.querySelector('input'),
    choose(files) {
      const input = element.querySelector('input');
      assert.ok(input);
      Object.defineProperty(input, 'files', { configurable: true, value: files });
      input.dispatchEvent(new Event('change', { bubbles: true }));
    },
    dispose() { app.unmount(); element.remove(); },
  };
}
async function settled() {
  await new Promise(resolve => setTimeout(resolve, 10));
  await window.happyDOM.whenAsyncComplete();
  await vue.nextTick();
}

test('Vue editor reads a file, emits value/filename, reselection and remove work', async () => {
  const editor = await mountEditor({ params: { filename: 'reportfile', encoding: 'base64', accept: '.txt' } });
  try {
    const blob = new File(['ab'], 'report.txt', { type: 'text/plain' });
    assert.equal(editor.input().accept, '.txt');
    assert.equal(editor.input().multiple, false);
    editor.choose([blob]);
    await settled();
    assert.deepEqual(editor.changes, [['YWI='], ['report.txt', 'reportfile']]);
    assert.equal(editor.state.value, 'YWI=');
    assert.equal(editor.state.data.reportfile, 'report.txt');
    assert.equal(editor.input().value, '');
    assert.equal(editor.element.querySelector('.aibiz-file-to-base64__name').textContent, 'report.txt');
    assert.equal(editor.element.querySelector('.aibiz-file-to-base64__size').textContent, '2 B');
    editor.choose([blob]);
    await settled();
    assert.equal(editor.changes.length, 4);
    editor.element.querySelector('button').click();
    await vue.nextTick();
    assert.deepEqual(editor.changes.slice(-2), [[null], [null, 'reportfile']]);
    assert.equal(editor.element.querySelector('button'), null);
    assert.equal(editor.element.querySelector('[role=alert]'), null);
  } finally { editor.dispose(); }
});

test('Vue default data URL and raw empty file are usable and removable', async () => {
  for (const encoding of ['data-url', 'base64']) {
    const editor = await mountEditor({ params: { encoding, filename: 'reportfile' } });
    try {
      editor.choose([new File([], 'empty.txt', { type: 'text/plain' })]);
      await settled();
      assert.equal(editor.state.value, encoding === 'base64' ? '' : 'data:text/plain;base64,');
      assert.ok(editor.element.querySelector('button'));
      assert.match(editor.element.textContent, /empty\.txt/);
      editor.element.querySelector('button').click();
      await vue.nextTick();
      assert.equal(editor.state.value, null);
      assert.equal(editor.state.data.reportfile, null);
    } finally { editor.dispose(); }
  }
});

test('Vue validation retains previous values and renders safe filenames', async () => {
  const editor = await mountEditor({
    params: { accept: '.txt', maxsizebytes: 2, filename: 'reportfile' },
    value: 'old', data: { reportfile: '<script>stored</script>' },
  });
  try {
    assert.equal(editor.element.querySelector('script'), null);
    for (const files of [
      [new File(['ab'], 'bad.pdf')],
      [new File(['abc'], 'large.txt')],
      [new File(['a'], 'one.txt'), new File(['b'], 'two.txt')],
    ]) {
      editor.choose(files);
      await vue.nextTick();
      assert.ok(editor.element.querySelector('[role=alert]'));
      assert.equal(editor.state.value, 'old');
      assert.equal(editor.state.data.reportfile, '<script>stored</script>');
      assert.equal(editor.changes.length, 0);
    }
    editor.choose([]);
    await vue.nextTick();
    assert.equal(editor.element.querySelector('[role=alert]'), null);
    assert.equal(editor.state.value, 'old');
  } finally { editor.dispose(); }
});

test('Vue respects prop, model and config readOnly/disabled states and editor events', async () => {
  for (const options of [
    { readonly: true }, { model: { readOnly: true } }, { params: { readonly: 'true' } },
  ]) {
    const editor = await mountEditor({ value: 'old', ...options });
    try {
      assert.equal(editor.input(), null);
      assert.equal(editor.element.querySelector('button'), null);
      assert.match(editor.element.textContent, /Stored file/);
    } finally { editor.dispose(); }
  }
  for (const options of [{ disabled: true }, { params: { disabled: '1' } }]) {
    const editor = await mountEditor({ value: 'old', ...options });
    try {
      assert.equal(editor.input().disabled, true);
      assert.equal(editor.element.querySelector('button').disabled, true);
      editor.choose([new File(['ab'], 'report.txt')]);
      await settled();
      assert.equal(editor.changes.length, 0);
    } finally { editor.dispose(); }
  }
  const editor = await mountEditor({ autoFocus: true });
  try {
    assert.equal(document.activeElement, editor.input());
    editor.input().dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    editor.input().blur();
    await vue.nextTick();
    assert.deepEqual(editor.focus, ['focus', 'enter', 'blur']);
  } finally { editor.dispose(); }
});

test('Vue cancels stale selection and publishes only the newest FileReader result', async () => {
  const OriginalReader = globalThis.FileReader;
  globalThis.FileReader = ControlledReader;
  const editor = await mountEditor({ params: { encoding: 'base64', filename: 'reportfile' } });
  try {
    editor.choose([new File(['old'], 'old.txt')]);
    const old = ControlledReader.instances.at(-1);
    const staleLoad = old.onload;
    await vue.nextTick();
    assert.ok(editor.element.querySelector('[role=status]'));
    editor.choose([new File(['new'], 'new.txt')]);
    const latest = ControlledReader.instances.at(-1);
    assert.equal(old.aborted, true);
    old.result = 'data:text/plain;base64,b2xk';
    staleLoad();
    latest.succeed('data:text/plain;base64,bmV3');
    await settled();
    assert.deepEqual(editor.changes, [['bmV3'], ['new.txt', 'reportfile']]);
    assert.equal(editor.element.querySelector('[role=status]'), null);
  } finally {
    editor.dispose();
    globalThis.FileReader = OriginalReader;
  }
});

test('Vue external changes, locking, remove and unmount abort active reads', async () => {
  const OriginalReader = globalThis.FileReader;
  globalThis.FileReader = ControlledReader;
  try {
    for (const action of ['external', 'readonly', 'disabled', 'remove', 'unmount']) {
      const editor = await mountEditor({ value: 'old', params: { filename: 'reportfile' } });
      let disposed = false;
      try {
        editor.choose([new File(['ab'], 'report.txt')]);
        const reader = ControlledReader.instances.at(-1);
        await vue.nextTick();
        if (action === 'external') editor.state.value = 'external';
        if (action === 'readonly') editor.state.readonly = true;
        if (action === 'disabled') editor.state.disabled = true;
        if (action === 'remove') editor.element.querySelector('button').click();
        if (action === 'unmount') { editor.dispose(); disposed = true; }
        await vue.nextTick();
        assert.equal(reader.aborted, true, action);
        reader.succeed();
        await settled();
        assert.deepEqual(editor.changes, action === 'remove' ? [[null], [null, 'reportfile']] : [], action);
        if (!disposed) assert.equal(editor.element.querySelector('[role=alert]'), null, action);
      } finally { if (!disposed) editor.dispose(); }
    }
  } finally { globalThis.FileReader = OriginalReader; }
});

test('Vue read errors remain recoverable and do not publish partial values', async () => {
  const OriginalReader = globalThis.FileReader;
  globalThis.FileReader = ControlledReader;
  const editor = await mountEditor({ value: 'old' });
  try {
    editor.choose([new File(['ab'], 'report.txt')]);
    ControlledReader.instances.at(-1).fail();
    await settled();
    assert.equal(editor.state.value, 'old');
    assert.equal(editor.changes.length, 0);
    assert.match(editor.element.querySelector('[role=alert]').textContent, /could not be read/);
    editor.choose([new File(['ab'], 'report.txt')]);
    ControlledReader.instances.at(-1).succeed();
    await settled();
    assert.equal(editor.state.value, 'data:text/plain;base64,YWI=');
    assert.equal(editor.element.querySelector('[role=alert]'), null);
  } finally {
    editor.dispose();
    globalThis.FileReader = OriginalReader;
  }
});

test('build is reproducible, external-only, honestly identified and SystemJS-installable', async () => {
  const directory = await mkdtemp(join(pluginRoot, '.test-build-'));
  try {
    const first = await buildLocalFileToBase64({ outputDir: join(directory, 'first') });
    const second = await buildLocalFileToBase64({ outputDir: join(directory, 'second') });
    assert.deepEqual(first, second);
    const manifest = JSON.parse(await readFile(join(pluginRoot, 'package.json'), 'utf8'));
    assert.equal(manifest.name, '@aibiz/file-to-base64');
    assert.equal(manifest.version, '0.1.0');
    assert.equal(manifest.gitHead, undefined);
    assert.equal(manifest.peerDependencies['@ibiz-template/runtime'], '0.7.41-alpha.86');
    assert.equal(manifest.peerDependencies['@ibiz-template/vue3-util'], '0.7.41-alpha.86');
    for (const [name, directory] of [
      ['@ibiz-template/runtime', 'ibiz-app-hub/packages/runtime'],
      ['@ibiz-template/vue3-util', 'ibiz-app-hub/packages/vue3-util'],
    ]) {
      const local = JSON.parse(await readFile(join(workspace, directory, 'package.json'), 'utf8'));
      assert.equal(local.version, manifest.peerDependencies[name]);
    }
    assert.equal(first.sourceStatus, 'independent-local-implementation');
    assert.equal(first.originalSourceRecovered, false);
    assert.equal(first.nativeCompatibilityVerified, false);
    assert.deepEqual(first.runtimeImports, ['@ibiz-template/runtime', '@ibiz-template/vue3-util', 'vue']);
    assert.equal(first.toolchain.typescript.version, '5.3.3');
    assert.equal(first.toolchain.rollup.version, '4.9.3');
    for (const output of [...first.outputs, { path: 'build-receipt.json' }]) {
      const a = await readFile(join(directory, 'first', output.path));
      const b = await readFile(join(directory, 'second', output.path));
      assert.deepEqual(a, b, output.path);
      if (output.sha256) {
        assert.equal(createHash('sha256').update(a).digest('hex'), output.sha256);
      }
    }
    const exports = {};
    const calls = [];
    const modules = {
      vue,
      '@ibiz-template/runtime': {
        EditorController,
        registerEditorProvider: (key, factory) => calls.push([key, factory]),
      },
      '@ibiz-template/vue3-util': vueUtil,
    };
    const system = {
      register(dependencies, declaration) {
        const module = declaration((key, value) => {
          if (typeof key === 'object') Object.assign(exports, key);
          else exports[key] = value;
          return value;
        });
        dependencies.forEach((name, index) => {
          assert.ok(modules[name], `Unexpected runtime import: ${name}`);
          module.setters[index](modules[name]);
        });
        module.execute();
      },
    };
    runInNewContext(await readFile(join(directory, 'first/index.system.js'), 'utf8'), { System: system });
    let component;
    exports.default.install({ component: (...args) => { component = args; } });
    assert.equal(component[0], 'AIBizFileToBase64');
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'EDITOR_CUSTOMSTYLE_FILE_TO_BASE64');
    assert.equal(calls[0][1]().formEditor, 'AIBizFileToBase64');
    const builtController = await calls[0][1]().createController(nativeEditors[0], parent());
    assert.equal(builtController.config.filenameField, 'reportfile');
    const pure = await import(`file://${join(directory, 'first/file-logic.mjs')}`);
    assert.equal(pure.dataUrlToValue('data:;base64,YWI=', 'base64'), 'YWI=');
  } finally { await rm(directory, { recursive: true, force: true }); }
  await assert.rejects(buildLocalFileToBase64({ outputDir: workspace }), /inside the local plugin/);
});
