import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { link, mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runInNewContext } from 'node:vm';
import test, { after } from 'node:test';
import { buildLocalGlobalUtil, pluginRoot } from '../../modelingweb/local-plugins/global-util/build.mjs';

const require = createRequire(new URL('../../modelingweb/app/package.json', import.meta.url));
const ts = require('typescript');
const { Window } = createRequire(new URL('../../ibiz-app-hub/package.json', import.meta.url))('happy-dom');
const cssWindow = new Window();
after(() => cssWindow.close());
const code = ts.transpileModule(await readFile(`${pluginRoot}/src/index.ts`, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;

function source(runtime, document) {
  const exports = {};
  runInNewContext(code, { exports, globalThis: { ibiz: runtime, document } });
  return exports;
}

function backgroundOf(element) {
  return Object.fromEntries([...new Set([
    ...Array.from({ length: element.style.length }, (_, index) => element.style.item(index)),
    ...(element.style.getPropertyValue('background') ? ['background'] : []),
  ])]
    .filter(name => name.startsWith('background') && name !== 'background-blend-mode')
    .sort().map(name => [name, {
      value: element.style.getPropertyValue(name), priority: element.style.getPropertyPriority(name),
    }]));
}

function fixture() {
  const errors = [];
  const listeners = new Map();
  const document = {
    fullscreenElement: null, exitCalls: 0,
    addEventListener(type, fn) {
      const values = listeners.get(type) ?? new Set();
      values.add(fn);
      listeners.set(type, values);
    },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    dispatch(type, event = { persisted: false }) {
      for (const fn of listeners.get(type) ?? []) fn(event);
    },
    async exitFullscreen() {
      this.exitCalls += 1;
      if (this.exitFailure) throw new Error('fixture denial');
      if (!this.noExit) {
        this.fullscreenElement = null;
        this.dispatch('fullscreenchange');
      }
    },
  };
  document.defaultView = {
    addEventListener: (type, fn) => document.addEventListener(type, fn),
    removeEventListener: (type, fn) => document.removeEventListener(type, fn),
  };
  const runtime = {
    openView: { push() {} }, hub: { getApp() {} },
    appData: { context: { fixture: true } }, modelClipboard: { fixture: true },
    fullscreenUtil: { fixture: 'original' }, log: { error: error => errors.push(error.message) },
  };
  const plugin = source(runtime, document);
  function element() {
    const classes = new Set(['existing']);
    const style = cssWindow.document.createElement('div').style;
    style.setProperty('background', 'red', 'important');
    const target = {
      ownerDocument: document, isConnected: true, requestCalls: 0, classes, style,
      classList: {
        contains: name => classes.has(name),
        add: name => classes.add(name),
        remove: name => classes.delete(name),
      },
      async requestFullscreen() {
        this.requestCalls += 1;
        if (this.failure) throw new Error('fixture denial');
        if (!this.noEntry) {
          document.fullscreenElement = this;
          document.dispatch('fullscreenchange');
        }
      },
    };
    return target;
  }
  return { runtime, document, plugin, errors, listeners, element,
    install: () => plugin.installGlobalAppUtil(runtime, document) };
}

test('installation is substantive, idempotent across Vue roots and preserves other framework APIs', async () => {
  const data = fixture();
  const original = { ...data.runtime };
  const instance = data.install();
  assert.notEqual(data.runtime.fullscreenUtil, original.fullscreenUtil);
  assert.equal(data.runtime.fullscreenUtil, instance.fullscreen);
  assert.equal(data.runtime.globalAppUtil, instance);
  assert.equal(instance.sourceStatus, 'independent-local-implementation');
  const provided = [];
  data.plugin.default.install({ provide: (...args) => provided.push(args) });
  data.plugin.default.install({ provide: (...args) => provided.push(args) });
  assert.equal(data.install(), instance);
  assert.deepEqual(provided, [['aibiz.globalAppUtil', instance], ['aibiz.globalAppUtil', instance]]);
  for (const key of ['openView', 'hub', 'appData', 'modelClipboard']) {
    assert.equal(data.runtime[key], original[key]);
  }
  assert.equal(data.listeners.get('fullscreenchange').size, 1);
  assert.equal(data.listeners.get('pagehide').size, 1);
  assert.equal(data.listeners.get('pageshow').size, 1);
  await instance.dispose();
});

test('real fullscreen state, deduplicated classes and inline background priority restore on exit', async () => {
  const data = fixture();
  const util = data.install().fullscreen;
  const target = data.element();
  const before = backgroundOf(target);
  assert.equal(util.isFullScreen, false);
  assert.equal(await util.openElementFullscreen(target, { class: 'existing chosen chosen second' }), true);
  assert.equal(util.isFullScreen, true);
  assert.deepEqual([...target.classes], ['existing', 'chosen', 'second']);
  assert.equal(target.style.getPropertyValue('background'), 'var(--ibiz-color-bg-1)');
  assert.equal(target.style.getPropertyPriority('background'), '');
  assert.equal(await util.openElementFullscreen(target), true);
  assert.equal(target.requestCalls, 1);
  assert.equal(await util.closeElementFullscreen(), true);
  assert.equal(util.isFullScreen, false);
  assert.deepEqual([...target.classes], ['existing']);
  assert.deepEqual(backgroundOf(target), before);
  assert.equal(await util.closeElementFullscreen(), true);
  assert.equal(data.document.exitCalls, 1);
  assert.deepEqual(data.errors, []);
});

test('legacy FullscreenClass and browser Escape cleanup work without an injected toolbar', async () => {
  const data = fixture();
  const util = data.install().fullscreen;
  const target = data.element();
  target.style.removeProperty('background');
  util.FullscreenClass = 'design-fullscreen';
  await util.openElementFullscreen(target);
  assert.ok(target.classes.has('design-fullscreen'));
  data.document.fullscreenElement = null;
  data.document.dispatch('fullscreenchange');
  assert.deepEqual([...target.classes], ['existing']);
  assert.deepEqual(backgroundOf(target), {});
});

test('denied or unsupported requests report a failure without fake state or style mutation', async () => {
  for (const mode of ['denied', 'no-entry', 'disconnected', 'wrong-document', 'unsupported', 'bad-class']) {
    const data = fixture();
    const util = data.install().fullscreen;
    const target = data.element();
    const before = backgroundOf(target);
    if (mode === 'denied') target.failure = true;
    if (mode === 'no-entry') target.noEntry = true;
    if (mode === 'disconnected') target.isConnected = false;
    if (mode === 'wrong-document') target.ownerDocument = {};
    if (mode === 'unsupported') target.requestFullscreen = undefined;
    assert.equal(await util.openElementFullscreen(target, { class: mode === 'bad-class' ? 123 : 'chosen' }), false);
    assert.equal(util.isFullScreen, false);
    assert.deepEqual([...target.classes], ['existing']);
    assert.deepEqual(backgroundOf(target), before);
    assert.equal(data.errors.length, 1);
    assert.ok(util.lastError);
  }
});

test('does not steal fullscreen from another element and rejected exit keeps existing state', async () => {
  const data = fixture();
  const util = data.install().fullscreen;
  const target = data.element();
  await util.openElementFullscreen(target, { class: 'chosen' });
  const another = data.element();
  assert.equal(await util.openElementFullscreen(another), false);
  assert.equal(another.requestCalls, 0);
  for (const flag of ['exitFailure', 'noExit']) {
    data.document[flag] = true;
    assert.equal(await util.closeElementFullscreen(), false);
    assert.equal(util.isFullScreen, true);
    assert.ok(target.classes.has('chosen'));
    data.document[flag] = false;
  }
  assert.equal(await util.closeElementFullscreen(), true);
  assert.equal(util.lastError, null);
});

test('coalesces pending entry and close waits for actual fullscreen completion', async () => {
  const data = fixture();
  const util = data.install().fullscreen;
  const target = data.element();
  let resolve;
  target.requestFullscreen = () => {
    target.requestCalls += 1;
    return new Promise(done => { resolve = done; });
  };
  const opening = util.openElementFullscreen(target);
  assert.equal(target.requestCalls, 1, 'Browser API must run before yielding user activation');
  assert.equal(util.openElementFullscreen(target), opening);
  assert.equal(await util.openElementFullscreen(data.element()), false);
  const closing = util.closeElementFullscreen();
  assert.equal(data.document.exitCalls, 0);
  data.document.fullscreenElement = target;
  resolve();
  assert.equal(await opening, true);
  assert.equal(await closing, true);
  assert.equal(data.document.exitCalls, 1);
  assert.equal(util.isFullScreen, false);
});

test('disposal during entry waits, exits only its own target and removes listeners', async () => {
  const data = fixture();
  const original = data.runtime.fullscreenUtil;
  const instance = data.install();
  const target = data.element();
  let resolve;
  target.requestFullscreen = () => new Promise(done => { resolve = done; });
  const pending = instance.fullscreen.openElementFullscreen(target);
  const disposing = instance.dispose();
  assert.equal(data.runtime.fullscreenUtil, original);
  assert.equal(Object.hasOwn(data.runtime, 'globalAppUtil'), false);
  assert.equal(instance.dispose(), disposing);
  data.document.fullscreenElement = target;
  resolve();
  assert.equal(await pending, false);
  assert.equal(await disposing, true);
  assert.equal(data.document.exitCalls, 1);
  assert.equal(data.listeners.get('fullscreenchange').size, 0);
  assert.equal(data.listeners.get('pagehide').size, 0);
  assert.equal(data.listeners.get('pageshow').size, 0);
  assert.equal(await instance.fullscreen.openElementFullscreen(target), false);
  assert.notEqual(data.install(), instance);
});

test('pagehide restores descriptors and never overwrites a later runtime tool owner', async () => {
  const data = fixture();
  const previous = { fixture: true };
  Object.defineProperty(data.runtime, 'globalAppUtil', {
    value: previous, writable: false, enumerable: false, configurable: true,
  });
  const descriptor = Object.getOwnPropertyDescriptor(data.runtime, 'globalAppUtil');
  const instance = data.install();
  const successor = { fixture: 'new owner' };
  data.runtime.fullscreenUtil = successor;
  data.document.fullscreenElement = data.element();
  data.document.dispatch('pagehide');
  await instance.dispose();
  assert.equal(data.runtime.fullscreenUtil, successor);
  assert.deepEqual(Object.getOwnPropertyDescriptor(data.runtime, 'globalAppUtil'), descriptor);
  assert.equal(data.document.exitCalls, 0);
});

test('persisted pagehide/pageshow retains the installed instance and reconciles browser fullscreen', async () => {
  const data = fixture();
  const original = data.runtime.fullscreenUtil;
  const instance = data.install();
  const provided = [];
  data.plugin.default.install({ provide: (...args) => provided.push(args) });
  const target = data.element();
  const before = backgroundOf(target);
  await instance.fullscreen.openElementFullscreen(target, { class: 'chosen' });
  data.document.dispatch('pagehide', { persisted: true });
  assert.equal(data.runtime.globalAppUtil, instance);
  assert.equal(data.runtime.fullscreenUtil, instance.fullscreen);
  assert.equal(provided[0][1], instance);
  assert.equal(data.install(), instance);
  assert.equal(data.listeners.get('pagehide').size, 1);
  assert.equal(data.listeners.get('pageshow').size, 1);
  data.document.fullscreenElement = null;
  data.document.dispatch('pageshow', { persisted: true });
  data.document.dispatch('pageshow', { persisted: true });
  assert.deepEqual(backgroundOf(target), before);
  assert.deepEqual([...target.classes], ['existing']);
  assert.equal(await instance.fullscreen.openElementFullscreen(target), true);
  data.document.dispatch('pageshow', { persisted: true });
  assert.equal(instance.fullscreen.isFullScreen, true);
  data.document.dispatch('pagehide', { persisted: false });
  assert.equal(await instance.dispose(), true);
  assert.equal(data.runtime.fullscreenUtil, original);
  assert.equal(Object.hasOwn(data.runtime, 'globalAppUtil'), false);
  for (const type of ['fullscreenchange', 'pagehide', 'pageshow']) {
    assert.equal(data.listeners.get(type).size, 0);
  }
  data.document.dispatch('pageshow', { persisted: true });
  assert.equal(Object.hasOwn(data.runtime, 'globalAppUtil'), false);
});

test('CSSStyleDeclaration longhands and mixed priorities survive every cleanup without reverting unrelated styles',
  async t => {
    for (const cleanup of ['exit', 'escape', 'dispose', 'pageshow']) {
      await t.test(cleanup, async () => {
        const data = fixture();
        const instance = data.install();
        const target = data.element();
        target.style.cssText = [
          'background-color: red !important',
          'background-image: linear-gradient(red, blue)',
          'background-repeat: no-repeat',
          'background-position: 10px 20px',
          'background-size: 30px 40px',
          'background-attachment: fixed',
          'background-origin: padding-box',
          'background-clip: content-box !important',
          'background-blend-mode: screen',
          'color: red',
          '--fixture-marker: before',
        ].join(';');
        const before = backgroundOf(target);
        assert.equal(target.style.getPropertyValue('background'), '');
        assert.equal(await instance.fullscreen.openElementFullscreen(target, { class: 'chosen' }), true);
        target.style.setProperty('color', 'blue', 'important');
        target.style.setProperty('margin-left', '7px');
        target.style.setProperty('--fixture-marker', 'after', 'important');
        target.style.setProperty('background-blend-mode', 'multiply', 'important');
        if (cleanup === 'exit') await instance.fullscreen.closeElementFullscreen();
        else if (cleanup === 'dispose') await instance.dispose();
        else {
          if (cleanup === 'pageshow') data.document.dispatch('pagehide', { persisted: true });
          data.document.fullscreenElement = null;
          data.document.dispatch(cleanup === 'escape' ? 'fullscreenchange' : 'pageshow', { persisted: true });
        }
        assert.deepEqual(backgroundOf(target), before);
        assert.deepEqual([...target.classes], ['existing']);
        assert.equal(target.style.getPropertyValue('color'), 'blue');
        assert.equal(target.style.getPropertyPriority('color'), 'important');
        assert.equal(target.style.getPropertyValue('margin-left'), '7px');
        assert.equal(target.style.getPropertyValue('--fixture-marker'), 'after');
        assert.equal(target.style.getPropertyPriority('--fixture-marker'), 'important');
        assert.equal(target.style.getPropertyValue('background-blend-mode'), 'multiply');
        assert.equal(target.style.getPropertyPriority('background-blend-mode'), 'important');
        await instance.dispose();
      });
    }
  });

test('invalid or immutable runtimes fail before changing tools or attaching listeners', () => {
  for (const mode of ['missing-route', 'missing-hub', 'immutable', 'non-extensible']) {
    const data = fixture();
    if (mode === 'missing-route') delete data.runtime.openView;
    if (mode === 'missing-hub') delete data.runtime.hub;
    if (mode === 'immutable') Object.defineProperty(data.runtime, 'fullscreenUtil', { configurable: false });
    if (mode === 'non-extensible') Object.preventExtensions(data.runtime);
    const original = data.runtime.fullscreenUtil;
    assert.throws(data.install, /framework|configurable|non-extensible/);
    assert.equal(data.runtime.fullscreenUtil, original);
    assert.equal(data.listeners.size, 0);
  }
  const plugin = source(undefined, {});
  assert.throws(() => plugin.default.install({ provide() {} }), /runtime must initialize/);
});

test('current ESM and SystemJS outputs both execute the real local implementation', async () => {
  const esm = await import(`${pluginRoot}/dist/index.mjs`);
  const outputs = await readFile(`${pluginRoot}/dist/index.system.js`, 'utf8');
  let exports;
  runInNewContext(outputs, {
    System: {
      register(dependencies, declare) {
        assert.equal(dependencies.length, 0);
        exports = {};
        declare((name, value) => { exports[name] = value; }).execute();
      },
    },
  });
  for (const plugin of [esm, exports]) {
    const data = fixture();
    const target = data.element();
    const instance = plugin.installGlobalAppUtil(data.runtime, data.document);
    assert.equal(await instance.fullscreen.openElementFullscreen(target), true);
    assert.equal(await instance.dispose(), true);
    assert.equal(data.document.fullscreenElement, null);
  }
});

test('strict local build is reproducible and refuses output outside the plugin', async () => {
  const before = await readFile(`${pluginRoot}/dist/build-receipt.json`, 'utf8');
  const receipt = await buildLocalGlobalUtil({ writeOutputs: false });
  assert.deepEqual(receipt, JSON.parse(before));
  assert.equal(await readFile(`${pluginRoot}/dist/build-receipt.json`, 'utf8'), before);
  assert.match(receipt.compilerChecks, /strict isolated-plugin/);
  assert.deepEqual(receipt.runtimeImports, []);
  assert.equal(receipt.originalSourceRecovered, false);
  assert.equal(receipt.nativeCompatibilityVerified, false);
  for (const outputDir of [pluginRoot, '/tmp/global-util-output', `${pluginRoot}/../outside`]) {
    await assert.rejects(buildLocalGlobalUtil({ outputDir }), /inside the local plugin/);
  }
});

test('build rejects unsafe directory ancestors and all unsafe output files before changing any sibling bytes',
  async t => {
    const root = await mkdtemp(join(pluginRoot, '.build-safety-'));
    const outside = await mkdtemp(join(tmpdir(), 'global-util-build-safety-'));
    t.after(async () => {
      await rm(root, { recursive: true, force: true });
      await rm(outside, { recursive: true, force: true });
    });
    const external = join(outside, 'sentinel');
    await writeFile(external, 'outside-unchanged');
    for (const [name, target] of [['linked-directory', outside], ['dangling-directory', join(outside, 'missing')]]) {
      await t.test(name, async () => {
        const path = join(root, name);
        await symlink(target, path, 'dir');
        for (const outputDir of [path, join(path, 'nested')]) {
          await assert.rejects(buildLocalGlobalUtil({ outputDir }), /non-symlink/);
        }
        assert.deepEqual(await readdir(outside), ['sentinel']);
        assert.equal(await readFile(external, 'utf8'), 'outside-unchanged');
      });
    }
    const names = ['index.mjs', 'index.system.js', 'build-receipt.json'];
    for (const [index, name] of names.entries()) {
      await t.test(`symlink-${name}`, async () => {
        const outputDir = join(root, `files-${index}`);
        await mkdir(outputDir);
        for (const sibling of names.filter(item => item !== name)) {
          await writeFile(join(outputDir, sibling), `old-${sibling}`);
        }
        await symlink(external, join(outputDir, name));
        await assert.rejects(buildLocalGlobalUtil({ outputDir }), /non-symlink/);
        for (const sibling of names.filter(item => item !== name)) {
          assert.equal(await readFile(join(outputDir, sibling), 'utf8'), `old-${sibling}`);
        }
        assert.equal(await readFile(external, 'utf8'), 'outside-unchanged');
        assert.deepEqual((await readdir(outputDir)).sort(), [...names].sort());
      });
    }
    await t.test('dangling-output-symlink', async () => {
      const outputDir = join(root, 'dangling-file');
      await mkdir(outputDir);
      await writeFile(join(outputDir, 'index.mjs'), 'old-esm');
      await symlink(join(outside, 'missing-file'), join(outputDir, 'build-receipt.json'));
      await assert.rejects(buildLocalGlobalUtil({ outputDir }), /non-symlink/);
      assert.equal(await readFile(join(outputDir, 'index.mjs'), 'utf8'), 'old-esm');
      assert.deepEqual((await readdir(outputDir)).sort(), ['build-receipt.json', 'index.mjs']);
      assert.deepEqual(await readdir(outside), ['sentinel']);
    });
    for (const mode of ['non-regular-receipt', 'hardlinked-receipt']) {
      await t.test(mode, async () => {
        const outputDir = join(root, mode);
        await mkdir(outputDir);
        await writeFile(join(outputDir, 'index.mjs'), 'old-esm');
        await writeFile(join(outputDir, 'index.system.js'), 'old-system');
        const receipt = join(outputDir, 'build-receipt.json');
        if (mode === 'non-regular-receipt') await mkdir(receipt);
        else {
          const target = join(root, 'hardlink-sentinel');
          await writeFile(target, 'linked-unchanged');
          await link(target, receipt);
        }
        await assert.rejects(buildLocalGlobalUtil({ outputDir }), /single-link regular file/);
        assert.equal(await readFile(join(outputDir, 'index.mjs'), 'utf8'), 'old-esm');
        assert.equal(await readFile(join(outputDir, 'index.system.js'), 'utf8'), 'old-system');
        if (mode === 'hardlinked-receipt') {
          assert.equal(await readFile(join(root, 'hardlink-sentinel'), 'utf8'), 'linked-unchanged');
        }
      });
    }
  });

test('build safely creates nested output and replaces the complete regular previous artifact group', async t => {
  const root = await mkdtemp(join(pluginRoot, '.build-overwrite-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const outputDir = join(root, 'nested', 'dist');
  const receipt = await buildLocalGlobalUtil({ outputDir });
  const names = ['index.mjs', 'index.system.js', 'build-receipt.json'];
  const before = await Promise.all(names.map(name => readFile(join(outputDir, name))));
  for (const name of names) await writeFile(join(outputDir, name), `previous-${name}`);
  assert.deepEqual(await buildLocalGlobalUtil({ outputDir }), receipt);
  assert.deepEqual(await Promise.all(names.map(name => readFile(join(outputDir, name)))), before);
  assert.deepEqual((await readdir(outputDir)).sort(), [...names].sort());
});
