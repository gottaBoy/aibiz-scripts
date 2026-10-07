#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { loadMigrationContract, WORKSPACE } from './harness-modeling-core-audit.mjs';
import { directoryPath, readTree } from './native-candidate-files.mjs';
import {
  captureRuntimeIdentity, localRuntimeEntry, runtimeEntries, verifyRuntimeIdentity,
} from './harness-native-ai-code-runtime.mjs';
import { verifyNativeAiCodeRuntimeAssets } from './prepare-native-ai-code-runtime-assets.mjs';
import { readFileBase64Replacement } from './prepare-native-file-base64-replacement.mjs';

export const FILE_BASE64_IDENTITY = Object.freeze({
  from: '@ibiz-template-plugin/file-to-base64@0.1.8-alpha.165',
  to: '@aibiz/file-to-base64@0.1.0',
  name: '@aibiz/file-to-base64',
  component: 'AIBizFileToBase64',
  provider: 'EDITOR_EDITOR_CUSTOMSTYLE_FILE_TO_BASE64',
});
export const FILE_BASE64_STAGES = Object.freeze([
  'http-delivery', 'factory-registration', 'component-render',
  'conversion-and-filename', 'selection-restrictions', 'readonly-disabled',
  'external-sync-and-removal', 'pending-read-cancellation', 'unmount-and-runtime-errors',
]);
const outputRoot = '.artifacts/native-file-base64-runtime';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const deploymentPaths = [
  'dist/file-logic.mjs', 'dist/index.mjs', 'dist/index.system.js', 'dist/style.css', 'package.json',
];
const nativeRoot = 'vendor-upstream/ibizmodeling-standard/modelapi-core/src/main/resources/model/' +
  'net/ibizsys/modeling/PSSYSAPPS/ModelDesign/PSAPPDATAENTITIES';
const nativePaths = [
  'PSDEPrint/PSFORMS/QuickCreate.json', 'PSDEPrint/PSFORMS/QuickCfg.json',
  'PSDEReport/PSFORMS/QuickCreate.json', 'PSDEReport/PSFORMS/QuickCfg.json',
];

export function verifyFileBase64Candidate(receipt, replacement) {
  const { plugin, files } = replacement;
  assert.equal(plugin.contract, 'native-file-base64-independent-replacement');
  assert.equal(plugin.from, FILE_BASE64_IDENTITY.from);
  assert.equal(plugin.to, FILE_BASE64_IDENTITY.to);
  assert.equal(plugin.sourceStatus, 'independent-local-implementation');
  assert.equal(plugin.originalSourceRecovered, false);
  assert.equal(plugin.originalRepositoryAuthenticated, false);
  assert.equal(plugin.nativeCompatibilityVerified, false);
  assert.equal(plugin.compatibility, 'not-verified');
  assert.equal(plugin.acceptedForProduction, false);
  assert.equal(plugin.originalMigrationAcceptance, 'not-satisfied-by-independent-replacement');
  assert.equal(receipt.contract, 'native-modeling-source-backed-candidate');
  assert.equal(receipt.status, 'prepared-not-accepted');
  assert.equal(receipt.acceptedForProduction, false);
  assert.deepEqual(receipt.plugins.filter(item =>
    item.contract === plugin.contract || item.from === plugin.from || item.to === plugin.to), [plugin],
  'Exactly one current independent file editor must be included in the verified candidate');
  assert.ok(Array.isArray(receipt.independentReplacementMappings), 'Explicit independent replacement mapping is required');
  assert.deepEqual(receipt.independentReplacementMappings.filter(item =>
    item.from === plugin.from || item.to === plugin.to), [{
    from: plugin.from, to: plugin.to, originalSourceRecovered: false,
    nativeCompatibilityVerified: false,
    originalMigrationAcceptance: 'not-satisfied-by-independent-replacement',
  }], 'Explicit independent replacement mapping is required');
  assert.deepEqual(files.entries.map(file => file.path).sort(), deploymentPaths,
    'Only the manifest and four real build outputs can be deployed');
  return plugin;
}

export function verifyFileSelectionSnapshot(snapshot, { value, filename, filenameField = 'reportfile' }) {
  assert.equal(snapshot.value, value, 'Converted value differs');
  assert.equal(snapshot.filename, filename, 'Sibling filename value differs');
  assert.deepEqual(snapshot.changes, [[value], [filename, filenameField]],
    'Expected primary change followed by the sibling filename tuple');
  assert.equal(snapshot.busy, false, 'Reader must finish before passing');
  assert.equal(snapshot.error, '', 'Successful selection must not display an error');
  assert.equal(snapshot.displayName, filename, 'Displayed filename differs');
  assert.equal(snapshot.inputValue, '', 'File input must reset for same-file reselection');
  return snapshot;
}

export function verifyFileBase64ExternalResolution(entry, importMap, resolutions) {
  const mapUrl = new URL('extras/json/system-import.json', localRuntimeEntry(entry));
  for (const name of ['vue', '@ibiz-template/runtime', '@ibiz-template/vue3-util']) {
    const path = importMap.imports?.[name];
    assert.equal(typeof path, 'string', `Required external import is absent: ${name}`);
    const expected = new URL(path, mapUrl);
    assert.equal(expected.origin, mapUrl.origin, 'Runtime externals must remain local');
    assert.equal(resolutions[name], expected.href, `Actual SystemJS external resolution differs: ${name}`);
  }
  return resolutions;
}

export async function captureFileBase64ExternalResolutions() {
  return Object.fromEntries(await Promise.all(
    ['vue', '@ibiz-template/runtime', '@ibiz-template/vue3-util']
      .map(async name => [name, await window.System.resolve(name)]),
  ));
}

export async function verifyFileBase64HttpDelivery(entry, { pluginEntries, runtimeEntries: assets } = {}) {
  const base = localRuntimeEntry(entry);
  assert.deepEqual(pluginEntries.map(file => file.path).sort(), deploymentPaths,
    'Complete replacement deployment inventory is required');
  const maps = assets.filter(file => file.path === 'extras/json/system-import.json');
  assert.equal(maps.length, 1, 'Exactly one verified runtime import map is required');
  const checks = [];
  for (const [prefix, files] of [[`plugins/${FILE_BASE64_IDENTITY.to}/`, pluginEntries], ['', maps]]) {
    for (const file of files) {
      const url = new URL(prefix + file.path, base);
      const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(10_000) });
      const bytes = Buffer.from(await response.arrayBuffer());
      const check = { path: url.pathname, status: response.status, bytes: bytes.length, sha256: hash(bytes) };
      checks.push(check);
      assert.equal(check.status, 200, `Runtime HTTP status differs: ${url.pathname}`);
      assert.equal(check.bytes, file.bytes, `Runtime HTTP length differs: ${url.pathname}`);
      assert.equal(check.sha256, file.sha256, `Runtime HTTP hash differs: ${url.pathname}`);
    }
  }
  for (const path of [
    `plugins/${FILE_BASE64_IDENTITY.from}/package.json`,
    `plugins/${FILE_BASE64_IDENTITY.to}/missing.js`,
    `plugins/${FILE_BASE64_IDENTITY.to}/dist/build-receipt.json`,
    `plugins/${FILE_BASE64_IDENTITY.to}/src/editor.ts`,
  ]) {
    const url = new URL(path, base);
    const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(10_000) });
    checks.push({ path: url.pathname, status: response.status });
    await response.arrayBuffer();
    assert.equal(response.status, 404, 'Original aliases, missing files and source/receipt must return 404');
  }
  return checks;
}

export function summarizeFileBase64RuntimeReport(applications) {
  let identities = false;
  try {
    runtimeEntries(applications.Central.entry, applications.ModelDesign.entry);
    for (const name of ['Central', 'ModelDesign']) verifyRuntimeIdentity(name, applications[name].identity);
    identities = true;
  } catch {}
  const isolatedRuntimePassed = identities &&
    Object.keys(applications).sort().join(',') === 'Central,ModelDesign' &&
    Object.values(applications).every(app =>
      Array.isArray(app.runtimeErrors) && !app.runtimeErrors.length &&
      Object.keys(app.stages ?? {}).sort().join(',') === [...FILE_BASE64_STAGES].sort().join(',') &&
      FILE_BASE64_STAGES.every(name => app.stages[name]?.status === 'PASS'));
  return {
    isolatedRuntimePassed, originalSourceRecovered: false, nativeCompatibilityVerified: false,
    nativeRuntimeAccepted: false, nativeSaveReadbackVerified: false, acceptedForProduction: false,
    compatibility: 'not-verified', fullApplicationAcceptanceRequired: true,
  };
}

function readNativeEditors(workspace) {
  return nativePaths.map(path => {
    const file = join(nativeRoot, path);
    const bytes = fs.readFileSync(join(workspace, file));
    const editors = [];
    const visit = node => {
      if (!node || typeof node !== 'object') return;
      if (node.editorStyle === 'FILE_TO_BASE64') editors.push(node);
      for (const child of Object.values(node)) visit(child);
    };
    visit(JSON.parse(bytes));
    assert.equal(editors.length, 1, `Expected one native FILE_TO_BASE64 editor: ${file}`);
    const [model] = editors;
    assert.equal(model.editorType, 'FILEUPLOADER_ONE');
    assert.deepEqual(model.getPSSysPFPlugin, {
      pluginType: 'EDITOR_CUSTOMSTYLE', pluginCode: 'FILE_TO_BASE64', runtimeObject: true,
    });
    assert.equal(model.editorParams.filename, 'reportfile');
    assert.equal(model.editorParams.encoding, undefined);
    return { path: file, sha256: hash(bytes), model };
  });
}

// Only race tests delay event delivery; conversion still uses the browser's native FileReader.
export function installFileReaderProbe() {
  const NativeReader = window.FileReader;
  const probe = { reads: 0, aborts: 0, pending: [], results: [], released: 0 };
  class DelayedReader {
    constructor() {
      this.reader = new NativeReader();
      this.onload = this.onerror = this.onabort = null;
      this.reader.onload = event => {
        probe.results.push(this.reader.result);
        probe.pending.push(() => { probe.released += 1; this.onload?.(event); });
      };
      this.reader.onerror = event => this.onerror?.(event);
      this.reader.onabort = event => this.onabort?.(event);
    }
    get result() { return this.reader.result; }
    get error() { return this.reader.error; }
    readAsDataURL(file) { probe.reads += 1; this.reader.readAsDataURL(file); }
    abort() { probe.aborts += 1; this.reader.abort(); }
  }
  window.FileReader = DelayedReader;
  window.__fileBase64ReaderProbe = probe;
  probe.release = () => { for (const deliver of probe.pending.splice(0)) deliver(); };
  probe.restore = () => { window.FileReader = NativeReader; };
}

export async function runNativeFileBase64RuntimeHarness({
  workspace = WORKSPACE, assets, output,
  centralUrl = 'http://127.0.0.1:32008/central/',
  modeldesignUrl = 'http://127.0.0.1:32009/modeldesign/',
  executablePath = process.env.CHROME_BIN || '/usr/bin/google-chrome',
} = {}) {
  workspace = resolve(workspace);
  const verified = verifyNativeAiCodeRuntimeAssets({ workspace, assets });
  const replacement = readFileBase64Replacement({ workspace, contract: loadMigrationContract(workspace) });
  const candidateBytes = fs.readFileSync(join(verified.candidate, 'receipt.json'));
  const runtimeBytes = fs.readFileSync(join(verified.directory, 'receipt.json'));
  const plugin = verifyFileBase64Candidate(JSON.parse(candidateBytes), replacement);
  const pluginDirectory = join(verified.candidate, 'plugins', plugin.to);
  assert.deepEqual(readTree(pluginDirectory, { jsonOnly: false }).entries, replacement.files.entries,
    'Actual candidate plugin files differ from the verified independent build');
  const nativeEditors = readNativeEditors(workspace);
  const importMap = JSON.parse(fs.readFileSync(join(verified.directory, 'extras/json/system-import.json')));
  const entries = runtimeEntries(centralUrl, modeldesignUrl);
  const destination = resolve(workspace, output ?? join(outputRoot, `runtime-${randomUUID()}`));
  assert.equal(dirname(destination), join(workspace, outputRoot), 'Reports must stay in the isolated artifact root');
  assert.match(relative(dirname(destination), destination), /^[A-Za-z0-9][A-Za-z0-9._-]*$/);
  directoryPath(dirname(destination), { allowMissing: true });
  fs.mkdirSync(dirname(destination), { recursive: true });
  directoryPath(dirname(destination));
  fs.mkdirSync(destination);
  const report = {
    schemaVersion: 1, contract: 'independent-file-base64-isolated-browser-runtime',
    startedAt: new Date().toISOString(), applications: {}, errors: [],
    sourceEvidence: {
      runtimeAssets: { path: relative(workspace, verified.directory), receiptSha256: hash(runtimeBytes) },
      candidate: { path: relative(workspace, verified.candidate), receiptSha256: hash(candidateBytes) },
      plugin, deploymentFiles: replacement.files.entries,
      nativeEditorInputs: nativeEditors,
    },
    boundary: 'Independent local editor mounted in isolated hosts in real candidate applications; ' +
      'no original source recovery, native form save or fresh-session server readback',
    originalSourceRecovered: false, nativeCompatibilityVerified: false,
    nativeRuntimeAccepted: false, nativeSaveReadbackVerified: false, acceptedForProduction: false,
  };
  let browser;
  try {
    const require = createRequire(join(workspace, 'ibiz-app-hub/package.json'));
    const { chromium } = require('playwright');
    browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
    for (const [application, entry] of [['Central', entries[0]], ['ModelDesign', entries[1]]]) {
      const app = { entry, stages: {}, bootErrors: [], runtimeErrors: [], runtimeRequests: [] };
      report.applications[application] = app;
      const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();
      page.setDefaultTimeout(10_000);
      let isolated = false;
      const record = event => (isolated ? app.runtimeErrors : app.bootErrors).push(event);
      page.on('pageerror', error => record({ kind: 'pageerror', text: String(error) }));
      page.on('console', message => {
        if (message.type() === 'error') record({ kind: 'console', text: message.text() });
      });
      page.on('requestfailed', request => record({
        kind: 'requestfailed', url: request.url(), error: request.failure()?.errorText,
      }));
      page.on('response', response => {
        const path = new URL(response.url()).pathname;
        if (/\/(plugins|extras)\//.test(path)) {
          app.runtimeRequests.push({ path, status: response.status(), phase: isolated ? 'isolated' : 'boot' });
        }
        if (response.status() >= 400) record({ kind: 'response', path, status: response.status() });
      });
      const stage = async (name, run) => {
        try { app.stages[name] = { status: 'PASS', evidence: await run() }; }
        catch (error) { app.stages[name] = { status: 'FAIL', error: String(error) }; }
      };
      const host = '#file-base64-runtime-test-host';
      const input = `${host} input[type=file]`;
      const remove = `${host} .aibiz-file-to-base64__remove`;
      const mount = options => page.evaluate(options => window.__fileBase64RuntimeHarness.mount(options), options);
      const snapshot = () => page.evaluate(() => window.__fileBase64RuntimeHarness.snapshot());
      const select = async (name, mimeType, buffer) => {
        await page.locator(input).setInputFiles({ name, mimeType, buffer });
        await page.waitForFunction(() => {
          const test = window.__fileBase64RuntimeHarness;
          return test.changes.length === 2 && !test.snapshot().busy;
        }, undefined, { timeout: 10_000 });
        return snapshot();
      };
      try {
        await stage('http-delivery', () => verifyFileBase64HttpDelivery(entry, {
          pluginEntries: replacement.files.entries, runtimeEntries: verified.receipt.delivery.entries,
        }));
        await stage('factory-registration', async () => {
          await page.goto(entry, { waitUntil: 'networkidle', timeout: 30_000 });
          await page.waitForFunction(() => window.ibiz?.plugin && window.System, undefined, { timeout: 20_000 });
          app.identity = await captureRuntimeIdentity(application, page);
          isolated = true;
          const result = await page.evaluate(async ({ identity, models }) => {
            const loaded = await ibiz.plugin.loadPluginRef(identity.name, identity.to);
            const [vue, pinia, element, core] = await Promise.all(
              ['vue', 'pinia', 'element-plus', '@ibiz-template/core'].map(name => System.import(name)),
            );
            const registration = vue.createApp({ render: () => null });
            ibiz.plugin.register(registration);
            const component = registration.component(identity.component);
            const provider = ibiz.register.get(identity.provider);
            if (!loaded || !component || !provider) throw new Error('Real plugin/provider registration is required');
            const parent = {
              context: core.IBizContext.create({ srfappid: ibiz.env.appId }), params: {},
              panel: { view: { state: { isLoading: false } } },
            };
            const modelFor = (model, params = {}) => ({
              ...model, appId: ibiz.env.appId, editorParams: { ...model.editorParams, ...params },
            });
            const configs = [];
            for (const model of models) {
              const controller = await provider.createController(modelFor(model), parent);
              configs.push({ name: model.name, encoding: controller.config.encoding,
                filenameField: controller.config.filenameField, maxFileCount: controller.config.maxFileCount,
                unlimitedSize: controller.config.maxSizeBytes === Infinity });
            }
            const test = { vue, component, provider, parent, changes: [], app: null, host: null };
            window.__fileBase64RuntimeHarness = test;
            test.unmount = () => {
              test.app?.unmount();
              test.host?.remove();
              test.app = test.host = null;
            };
            test.mount = async (options = {}) => {
              test.unmount();
              const controller = await provider.createController(modelFor(models[0], options.params), parent);
              test.controller = controller;
              test.changes = [];
              test.state = vue.reactive({
                value: options.value ?? null, readonly: options.readonly ?? false,
                disabled: options.disabled ?? false, data: { reportfile: options.filename ?? null },
              });
              const host = document.createElement('div');
              host.id = 'file-base64-runtime-test-host';
              host.style.cssText = 'position:fixed;top:24px;left:24px;right:24px;z-index:10000;' +
                'min-height:180px;padding:24px;background:white;color:black;';
              test.host = host;
              document.body.append(host);
              test.app = vue.createApp({
                render: () => vue.h(component, {
                  controller, ...test.state,
                  onChange: (...change) => {
                    test.changes.push(change);
                    if (change.length === 1) test.state.value = change[0];
                    else test.state.data[change[1]] = change[0];
                  },
                }),
              });
              test.app.use(pinia.createPinia());
              test.app.use(element.default);
              ibiz.plugin.register(test.app);
              test.app.mount(host);
              await vue.nextTick();
            };
            test.snapshot = () => ({
              value: test.state.value, filename: test.state.data.reportfile, changes: [...test.changes],
              busy: test.host?.querySelector('[aria-busy]')?.getAttribute('aria-busy') === 'true',
              displayName: test.host?.querySelector('.aibiz-file-to-base64__name')?.textContent ?? null,
              error: test.host?.querySelector('[role=alert]')?.textContent ?? '',
              inputValue: test.host?.querySelector('input[type=file]')?.value ?? null,
            });
            return {
              loaded, component: component.name, formEditor: provider.formEditor, gridEditor: provider.gridEditor,
              provider: identity.provider, configs,
            };
          }, { identity: FILE_BASE64_IDENTITY, models: nativeEditors.map(item => item.model) });
          assert.equal(result.component, FILE_BASE64_IDENTITY.component);
          assert.equal(result.formEditor, FILE_BASE64_IDENTITY.component);
          assert.equal(result.gridEditor, FILE_BASE64_IDENTITY.component);
          assert.deepEqual(result.configs, nativeEditors.map(({ model }) => ({
            name: model.name, encoding: 'data-url', filenameField: 'reportfile',
            maxFileCount: 1, unlimitedSize: true,
          })), 'Real controller init must resolve all four native editor configurations');
          result.resolutions = await page.evaluate(captureFileBase64ExternalResolutions);
          verifyFileBase64ExternalResolution(entry, importMap, result.resolutions);
          return result;
        });
        await stage('component-render', async () => {
          await mount({});
          const rect = await page.locator(`${host} .aibiz-file-to-base64`).boundingBox();
          assert.ok(rect && rect.width > 100 && rect.height > 10, 'Actual editor must be visible');
          assert.equal(await page.locator(input).getAttribute('multiple'), null);
          assert.equal(await page.locator(input).isEnabled(), true);
          assert.deepEqual((await snapshot()).changes, [], 'Mount must not publish synthetic changes');
          return { rect, initialChanges: [] };
        });
        await stage('conversion-and-filename', async () => {
          const cases = [];
          const fixtures = [
            ['report.txt', 'text/plain', Buffer.from('local report\n')],
            ['empty.txt', 'text/plain', Buffer.alloc(0)],
            ['binary.bin', 'application/octet-stream', Buffer.from([0, 255, 128, 1, 10, 13, 0])],
          ];
          for (const encoding of ['data-url', 'base64']) {
            for (const [name, mimeType, bytes] of fixtures) {
              await mount({ params: { encoding } });
              const expected = encoding === 'base64' ? bytes.toString('base64') :
                `data:${mimeType};base64,${bytes.toString('base64')}`;
              const result = verifyFileSelectionSnapshot(await select(name, mimeType, bytes),
                { value: expected, filename: name });
              assert.equal(await page.locator(remove).count(), 1, 'Even an empty raw file must be removable');
              await page.evaluate(() => { window.__fileBase64RuntimeHarness.changes = []; });
              verifyFileSelectionSnapshot(await select(name, mimeType, bytes), { value: expected, filename: name });
              cases.push({ encoding, filename: name, bytes: bytes.length, sourceSha256: hash(bytes),
                value: result.value, changes: result.changes, sameFileReselection: true });
            }
          }
          const screenshot = `${application.toLowerCase()}-file-editor.png`;
          await page.screenshot({ path: join(destination, screenshot), fullPage: true });
          return { cases, screenshot, conversionEngine: 'unmodified-browser-FileReader' };
        });
        await stage('selection-restrictions', async () => {
          await mount({ params: { accept: '.txt', maxsizebytes: '4' } });
          assert.equal(await page.locator(input).getAttribute('accept'), '.txt');
          const baseline = await select('boundary.txt', 'text/plain', Buffer.from('1234'));
          const cases = [];
          for (const [name, mimeType, bytes, message] of [
            ['wrong.bin', 'application/octet-stream', Buffer.from('12'), 'This file type is not allowed.'],
            ['large.txt', 'text/plain', Buffer.from('12345'), 'The file exceeds the configured size limit.'],
          ]) {
            await page.evaluate(() => { window.__fileBase64RuntimeHarness.changes = []; });
            await page.locator(input).setInputFiles({ name, mimeType, buffer: bytes });
            await page.waitForFunction(message =>
              window.__fileBase64RuntimeHarness.snapshot().error === message, message);
            const result = await snapshot();
            assert.equal(result.value, baseline.value);
            assert.equal(result.filename, baseline.filename);
            assert.equal(result.displayName, baseline.displayName);
            assert.equal(result.busy, false);
            assert.deepEqual(result.changes, [], 'Rejected selection must preserve old values without emitting');
            cases.push({ filename: name, error: result.error, oldValuePreserved: true });
          }
          await page.evaluate(() => {
            const transfer = new DataTransfer();
            transfer.items.add(new File(['1'], 'one.txt', { type: 'text/plain' }));
            transfer.items.add(new File(['2'], 'two.txt', { type: 'text/plain' }));
            const input = window.__fileBase64RuntimeHarness.host.querySelector('input');
            input.files = transfer.files;
            input.dispatchEvent(new Event('change', { bubbles: true }));
          });
          await page.waitForFunction(() =>
            window.__fileBase64RuntimeHarness.snapshot().error === 'Select only one file.');
          assert.equal((await snapshot()).value, baseline.value);
          assert.deepEqual((await snapshot()).changes, []);
          await page.locator(input).setInputFiles([]);
          await page.waitForFunction(() => window.__fileBase64RuntimeHarness.snapshot().error === '');
          assert.equal((await snapshot()).value, baseline.value);
          assert.deepEqual((await snapshot()).changes, []);
          return { accept: '.txt', sizeBoundaryBytes: 4, cases, multipleRejected: true, emptySelectionPreserved: true };
        });
        await stage('readonly-disabled', async () => {
          const cases = [];
          for (const flag of ['readonly', 'disabled']) {
            for (const mode of ['prop', 'config']) {
              await mount({
                value: 'data:text/plain;base64,MTIzNA==', filename: 'stored.txt',
                ...(mode === 'prop' ? {} : { params: { [flag]: 'true' } }),
              });
              if (mode === 'prop') {
                await page.evaluate(async flag => {
                  const test = window.__fileBase64RuntimeHarness;
                  test.state[flag] = true;
                  await test.vue.nextTick();
                }, flag);
              }
              if (flag === 'readonly') {
                assert.equal(await page.locator(input).count(), 0);
                assert.equal(await page.locator(remove).count(), 0);
              } else {
                assert.equal(await page.locator(input).isDisabled(), true);
                assert.equal(await page.locator(remove).isDisabled(), true);
                await page.locator(input).setInputFiles({
                  name: 'forbidden.txt', mimeType: 'text/plain', buffer: Buffer.from('forbidden'),
                });
                await page.locator(remove).dispatchEvent('click');
              }
              await page.waitForTimeout(50);
              const result = await snapshot();
              assert.equal(result.value, 'data:text/plain;base64,MTIzNA==');
              assert.equal(result.filename, 'stored.txt');
              assert.deepEqual(result.changes, [], `${mode} ${flag} must reject changes`);
              if (mode === 'prop') {
                await page.evaluate(async flag => {
                  const test = window.__fileBase64RuntimeHarness;
                  test.state[flag] = false;
                  await test.vue.nextTick();
                }, flag);
                assert.equal(await page.locator(input).isEnabled(), true);
                verifyFileSelectionSnapshot(await select('restored.txt', 'text/plain', Buffer.from('ok')),
                  { value: 'data:text/plain;base64,b2s=', filename: 'restored.txt' });
              }
              cases.push({ flag, mode, noLockedChanges: true, editableRestored: mode === 'prop' });
            }
          }
          return { cases };
        });
        await stage('external-sync-and-removal', async () => {
          await mount({});
          await select('selected.txt', 'text/plain', Buffer.from('selected'));
          await page.evaluate(async () => {
            const test = window.__fileBase64RuntimeHarness;
            test.changes = [];
            test.state.value = 'data:text/plain;base64,ZXh0ZXJuYWw=';
            test.state.data.reportfile = 'external.txt';
            await test.vue.nextTick();
          });
          const external = await snapshot();
          assert.equal(external.displayName, 'external.txt');
          assert.deepEqual(external.changes, [], 'External props must not echo change events');
          assert.equal(await page.locator(`${host} .aibiz-file-to-base64__size`).count(), 0,
            'External values must not retain selected file size');
          await page.locator(remove).click();
          await page.waitForFunction(() => window.__fileBase64RuntimeHarness.changes.length === 2);
          const removed = await snapshot();
          assert.equal(removed.value, null);
          assert.equal(removed.filename, null);
          assert.equal(removed.displayName, null);
          assert.deepEqual(removed.changes, [[null], [null, 'reportfile']]);
          assert.equal(await page.locator(remove).count(), 0);
          assert.equal(await page.locator(input).isEnabled(), true);
          return { external, removed, boundary: 'Reactive host state only, not server save/readback' };
        });
        await stage('pending-read-cancellation', async () => {
          const cases = [];
          const scenarios = ['unmount', 'readonly', 'disabled', 'external-sync', 'remove'];
          await page.evaluate(installFileReaderProbe);
          try {
            for (const scenario of scenarios) {
              await mount({ value: 'stored-value', filename: 'stored.txt' });
              await page.locator(input).setInputFiles({
                name: 'late.txt', mimeType: 'text/plain', buffer: Buffer.from('late'),
              });
              await page.waitForFunction(() => window.__fileBase64ReaderProbe.pending.length === 1);
              const before = await snapshot();
              assert.equal(before.busy, true, 'Race must actually start before cancellation');
              assert.deepEqual(before.changes, []);
              const result = await page.evaluate(async scenario => {
                const test = window.__fileBase64RuntimeHarness;
                const probe = window.__fileBase64ReaderProbe;
                const previousAborts = probe.aborts;
                if (scenario === 'unmount') test.unmount();
                else if (scenario === 'external-sync') {
                  test.state.value = 'external-value';
                  test.state.data.reportfile = 'external.txt';
                } else if (scenario === 'remove') {
                  test.host.querySelector('button').click();
                } else test.state[scenario] = true;
                await test.vue.nextTick();
                probe.release();
                await test.vue.nextTick();
                await new Promise(resolve => setTimeout(resolve, 30));
                return {
                  ...test.snapshot(), aborts: probe.aborts - previousAborts,
                  reads: probe.reads, released: probe.released, pending: probe.pending.length,
                  lastReaderResult: probe.results.at(-1),
                  hostCount: document.querySelectorAll('#file-base64-runtime-test-host').length,
                };
              }, scenario);
              assert.equal(result.aborts, 1, 'Cancellation must abort the active real read');
              assert.equal(result.pending, 0);
              assert.equal(result.reads, cases.length + 1);
              assert.equal(result.released, cases.length + 1, 'Queued native reader completion must be released');
              assert.equal(result.lastReaderResult, 'data:text/plain;base64,bGF0ZQ==',
                'Race fixture must use actual native conversion, not a fabricated result');
              assert.equal(result.busy, false);
              assert.equal(result.value, scenario === 'remove' ? null :
                scenario === 'external-sync' ? 'external-value' : 'stored-value');
              assert.equal(result.filename, scenario === 'remove' ? null :
                scenario === 'external-sync' ? 'external.txt' : 'stored.txt');
              assert.deepEqual(result.changes, scenario === 'remove' ? [[null], [null, 'reportfile']] : [],
                'A cancelled/late read must not publish either value or filename');
              assert.equal(result.hostCount, scenario === 'unmount' ? 0 : 1);
              cases.push({ scenario, ...result });
            }
          } finally {
            await page.evaluate(() => {
              window.__fileBase64RuntimeHarness?.unmount();
              window.__fileBase64ReaderProbe?.restore();
            });
          }
          return { cases, instrumentation: 'Native FileReader conversion with controlled load-event delivery' };
        });
        await stage('unmount-and-runtime-errors', async () => {
          await mount({});
          const result = await page.evaluate(async () => {
            const test = window.__fileBase64RuntimeHarness;
            test.unmount();
            await test.mount();
            test.unmount();
            await test.vue.nextTick();
            return { hosts: document.querySelectorAll('#file-base64-runtime-test-host').length,
              changes: [...test.changes], fileReaderRestored: !window.__fileBase64ReaderProbe ||
                !window.FileReader.name.includes('Delayed') };
          });
          await page.waitForLoadState('networkidle', { timeout: 10_000 });
          await page.waitForTimeout(1000);
          assert.equal(result.hosts, 0);
          assert.deepEqual(result.changes, []);
          assert.equal(result.fileReaderRestored, true);
          assert.equal(app.runtimeErrors.length, 0, `Isolated runtime errors: ${JSON.stringify(app.runtimeErrors)}`);
          return result;
        });
      } finally {
        try {
          if (!page.isClosed()) await page.evaluate(() => {
            window.__fileBase64RuntimeHarness?.unmount();
            window.__fileBase64ReaderProbe?.restore();
          });
        } catch (error) { app.runtimeErrors.push({ kind: 'cleanup', text: String(error) }); }
        await context.close();
      }
    }
    assert.deepEqual(verifyNativeAiCodeRuntimeAssets({ workspace, assets }).receipt, verified.receipt,
      'Source/build/runtime evidence changed during checks');
    assert.deepEqual(readFileBase64Replacement({
      workspace, contract: loadMigrationContract(workspace),
    }), replacement, 'Independent source/build changed during checks');
    assert.deepEqual(readTree(pluginDirectory, { jsonOnly: false }).entries, replacement.files.entries,
      'Candidate plugin changed during checks');
    assert.deepEqual(readNativeEditors(workspace), nativeEditors, 'Native editor inputs changed during checks');
  } catch (error) { report.errors.push(String(error)); }
  finally {
    if (browser) {
      try { await browser.close(); } catch (error) { report.errors.push(String(error)); }
    }
    report.verdict = summarizeFileBase64RuntimeReport(report.applications);
    if (report.errors.length) report.verdict.isolatedRuntimePassed = false;
    report.completedAt = new Date().toISOString();
    report.status = report.verdict.isolatedRuntimePassed ?
      'isolated-runtime-passed-independent-replacement-not-accepted' : 'failed';
    fs.writeFileSync(join(destination, 'report.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
  }
  return { destination, report };
}

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: {
    assets: { type: 'string' }, output: { type: 'string' }, 'central-url': { type: 'string' },
    'modeldesign-url': { type: 'string' }, help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) {
    console.log('Usage: node scripts/harness-native-file-base64-runtime.mjs --assets PATH ' +
      '[--output PATH] [--central-url URL] [--modeldesign-url URL]');
    console.log('Requires verified runtime assets whose candidate includes the explicit independent replacement.');
    console.log('Exit 2: isolated runtime passed only; native compatibility/save/readback/production remain unverified.');
    return;
  }
  const { destination, report } = await runNativeFileBase64RuntimeHarness({
    assets: values.assets, output: values.output,
    centralUrl: values['central-url'], modeldesignUrl: values['modeldesign-url'],
  });
  console.log(`Runtime report: ${join(destination, 'report.json')}`);
  console.log(`Isolated replacement runtime passed: ${report.verdict.isolatedRuntimePassed}; native acceptance remains false`);
  process.exitCode = report.verdict.isolatedRuntimePassed ? 2 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(String(error)); process.exitCode = 1; });
}
