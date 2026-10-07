#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { WORKSPACE } from './harness-modeling-core-audit.mjs';
import { readTree } from './native-candidate-files.mjs';
import { verifyNativeAiCodeRuntimeAssets } from './prepare-native-ai-code-runtime-assets.mjs';

const packageRepo = '@ibiz-template-plugin/ai-code@0.0.3-alpha.141';
const packageName = '@ibiz-template-plugin/ai-code';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const stageNames = [
  'http-delivery', 'factory-registration', 'component-render',
  'edit-and-prop-sync', 'readonly-disabled', 'unmount-and-runtime-errors',
];

export function localRuntimeEntry(value) {
  const url = new URL(value);
  assert.equal(url.protocol, 'http:', 'The runtime harness requires a local HTTP entry');
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname),
    'The runtime harness must not target remote applications');
  assert.equal(url.username + url.password + url.search + url.hash, '');
  assert.ok(url.pathname.endsWith('/'), 'Application entries must end with a slash');
  return url.href;
}

export function runtimeEntries(centralUrl, modeldesignUrl) {
  const entries = [centralUrl, modeldesignUrl].map(localRuntimeEntry);
  const canonical = entries.map(entry => {
    const url = new URL(entry);
    if (url.hostname === 'localhost') url.hostname = '127.0.0.1';
    return url.href;
  });
  assert.notEqual(canonical[0], canonical[1],
    'Central and ModelDesign must use distinct runtime entries');
  return entries;
}

export function verifyRuntimeIdentity(application, environment) {
  assert.ok(['Central', 'ModelDesign'].includes(application), 'Unknown runtime application');
  assert.equal(environment?.nativeModelApp, application, 'Runtime application identity differs');
  assert.equal(environment?.appId, `ibizmodeling__${application.toLowerCase()}`,
    'Runtime appId differs');
  return { nativeModelApp: environment.nativeModelApp, appId: environment.appId };
}

export async function captureRuntimeIdentity(application, page) {
  return verifyRuntimeIdentity(application, await page.evaluate(() => ({
    nativeModelApp: window.Environment?.nativeModelApp,
    appId: window.ibiz?.env?.appId,
  })));
}

export async function verifyRuntimeHttpDelivery(entry, { pluginEntries, runtimeEntries } = {}) {
  const base = localRuntimeEntry(entry);
  const checks = [];
  for (const [prefix, entries] of [
    [`plugins/${packageRepo}/`, pluginEntries],
    ['', runtimeEntries.filter(file => file.path !== 'nginx-native.conf')],
    ['/', runtimeEntries.filter(file => file.path.startsWith('plugins/monaco-editor@0.52.2/min/'))],
  ]) {
    for (const file of entries) {
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
    'plugins/@ibiz-template-plugin/ai-code@0.0.3-alpha.92/package.json',
    `plugins/${packageRepo}/missing.js`,
  ]) {
    const response = await fetch(new URL(path, base), {
      redirect: 'error', signal: AbortSignal.timeout(10_000),
    });
    checks.push({ path: new URL(path, base).pathname, status: response.status });
    assert.equal(response.status, 404, 'Missing/old plugin files must return 404 without aliases');
  }
  return checks;
}

export function summarizeRuntimeReport(applications) {
  let entriesAndIdentitiesVerified = false;
  try {
    runtimeEntries(applications.Central.entry, applications.ModelDesign.entry);
    for (const application of ['Central', 'ModelDesign']) {
      verifyRuntimeIdentity(application, applications[application].identity);
    }
    entriesAndIdentitiesVerified = true;
  } catch {}
  const isolatedRuntimePassed = entriesAndIdentitiesVerified &&
    Object.keys(applications).sort().join(',') === 'Central,ModelDesign' &&
    Object.values(applications).every(app =>
      Array.isArray(app.runtimeErrors) && app.runtimeErrors.length === 0 &&
      Object.keys(app.stages).sort().join(',') === [...stageNames].sort().join(',') &&
      stageNames.every(name => app.stages[name].status === 'PASS'));
  return {
    isolatedRuntimePassed, nativeRuntimeAccepted: false, acceptedForProduction: false,
    fullApplicationAcceptanceRequired: true,
  };
}

export async function runNativeAiCodeRuntimeHarness({
  workspace = WORKSPACE, assets, output,
  centralUrl = 'http://127.0.0.1:32008/central/',
  modeldesignUrl = 'http://127.0.0.1:32009/modeldesign/',
  executablePath = process.env.CHROME_BIN || '/usr/bin/google-chrome',
} = {}) {
  workspace = resolve(workspace);
  const verified = verifyNativeAiCodeRuntimeAssets({ workspace, assets });
  const entries = runtimeEntries(centralUrl, modeldesignUrl);
  const destination = resolve(workspace, output ??
    join('.artifacts/native-ai-code-runtime', `runtime-${randomUUID()}`));
  assert.equal(dirname(destination), join(workspace, '.artifacts/native-ai-code-runtime'));
  assert.match(relative(dirname(destination), destination), /^[A-Za-z0-9][A-Za-z0-9._-]*$/);
  assert.ok(!fs.existsSync(destination), 'Runtime reports must not overwrite earlier evidence');
  const pluginEntries = readTree(join(verified.candidate, 'plugins', packageRepo),
    { jsonOnly: false }).entries;
  const modelReceipt = fs.readFileSync(join(verified.candidate, 'receipt.json'));
  const runtimeReceipt = fs.readFileSync(join(verified.directory, 'receipt.json'));
  const report = {
    schemaVersion: 1, contract: 'native-ai-code-isolated-browser-runtime',
    startedAt: new Date().toISOString(), applications: {}, errors: [],
    sourceEvidence: {
      runtimeAssets: { path: relative(workspace, verified.directory), receiptSha256: hash(runtimeReceipt) },
      candidate: { path: relative(workspace, verified.candidate), receiptSha256: hash(modelReceipt) },
      pluginRepo: packageRepo,
    },
    boundary: 'Real plugin/provider in an isolated test host; no model save or fresh-session readback',
    nativeRuntimeAccepted: false, acceptedForProduction: false,
  };
  fs.mkdirSync(destination, { recursive: true });
  const require = createRequire(join(workspace, 'ibiz-app-hub/package.json'));
  let browser;
  try {
    const { chromium } = require('playwright');
    browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
    for (const [application, entry] of [['Central', entries[0]], ['ModelDesign', entries[1]]]) {
      const app = { entry, stages: {}, bootErrors: [], runtimeErrors: [], runtimeRequests: [] };
      report.applications[application] = app;
      const context = await browser.newContext({
        locale: 'zh-CN', viewport: { width: 1440, height: 900 },
      });
      const page = await context.newPage();
      let runtimeStarted = false;
      const recordError = event => (runtimeStarted ? app.runtimeErrors : app.bootErrors).push(event);
      page.on('pageerror', error => recordError({ kind: 'pageerror', text: String(error) }));
      page.on('console', message => {
        if (message.type() === 'error') recordError({ kind: 'console', text: message.text() });
      });
      page.on('response', response => {
        if (!runtimeStarted) return;
        const path = new URL(response.url()).pathname;
        if (/\/(plugins|extras)\//.test(path)) {
          app.runtimeRequests.push({ path, status: response.status() });
        }
        if (response.status() >= 400) recordError({ kind: 'response', path, status: response.status() });
      });
      page.on('requestfailed', request => recordError({
        kind: 'requestfailed', url: request.url(), error: request.failure()?.errorText,
      }));
      const stage = async (name, run) => {
        try { app.stages[name] = { status: 'PASS', evidence: await run() }; }
        catch (error) { app.stages[name] = { status: 'FAIL', error: String(error) }; }
      };
      try {
        await stage('http-delivery', () => verifyRuntimeHttpDelivery(entry, {
          pluginEntries, runtimeEntries: verified.receipt.delivery.entries,
        }));
        await stage('factory-registration', async () => {
          await page.goto(entry, { waitUntil: 'networkidle', timeout: 30_000 });
          await page.waitForFunction(() => window.ibiz?.plugin && window.System, { timeout: 20_000 });
          app.identity = await captureRuntimeIdentity(application, page);
          runtimeStarted = true;
          const result = await page.evaluate(async ({ packageName, packageRepo }) => {
            const loaded = await ibiz.plugin.loadPluginRef(packageName, packageRepo);
            const [vue, pinia, element, core] = await Promise.all(
              ['vue', 'pinia', 'element-plus', '@ibiz-template/core']
                .map(name => System.import(name)),
            );
            const app = vue.createApp({ render: () => null });
            ibiz.plugin.register(app);
            const component = app.component('IBizAICode');
            const model = {
              id: 'local-runtime-code', name: 'local-runtime-code', editorType: 'CODE',
              appId: ibiz.env.appId, editorStyle: 'AI_CODE',
              editorParams: { codeType: 'typescript', completionmode: 'aichat' },
            };
            const provider = ibiz.register.get('EDITOR_EDITOR_CUSTOMSTYLE_AI_CODE');
            const testProvider = ibiz.register.get('EDITOR_EDITOR_CUSTOMSTYLE_AI_CODE_TEST');
            if (!loaded || !component || !provider || !testProvider) {
              throw new Error('Plugin factory must install the component and both editor providers');
            }
            const parent = {
              context: core.IBizContext.create({ srfappid: ibiz.env.appId }), params: {},
              panel: { view: { state: { isLoading: false } } },
            };
            const controller = await provider.createController(model, parent);
            window.__aiCodeRuntimeHarness = {
              vue, pinia, element, component, controller, changes: [],
              state: vue.reactive({ value: 'const localValue = 1;', readonly: false, disabled: false }),
            };
            const test = window.__aiCodeRuntimeHarness;
            test.mount = () => {
              const host = document.createElement('div');
              host.id = 'ai-code-runtime-test-host';
              host.style.cssText = 'position:fixed;inset:20px;z-index:10000;background:white;';
              document.body.append(host);
              test.app = vue.createApp({
                render: () => vue.h(component, {
                  controller, data: {}, ...test.state,
                  onChange: value => { test.changes.push(value); test.state.value = value; },
                }),
              });
              test.app.use(pinia.createPinia());
              test.app.use(element.default);
              ibiz.plugin.register(test.app);
              test.app.mount(host);
            };
            return { loaded, component: component.name,
              formEditor: provider.formEditor, gridEditor: provider.gridEditor,
              testProvider: !!testProvider, controller: controller.constructor.name };
          }, { packageName, packageRepo });
          assert.equal(result.component, 'IBizAICode');
          assert.equal(result.formEditor, 'IBizAICode');
          assert.equal(result.gridEditor, 'IBizAICode');
          return result;
        });
        await stage('component-render', async () => {
          await page.evaluate(() => {
            const test = window.__aiCodeRuntimeHarness;
            if (!test) throw new Error('Plugin registration prerequisite failed');
            test.mount();
          });
          await page.waitForFunction(() => {
            const test = window.__aiCodeRuntimeHarness;
            return test?.controller.editor?.getValue() === test.state.value &&
              !!document.querySelector('#ai-code-runtime-test-host .monaco-editor .view-lines');
          }, undefined, { timeout: 30_000 });
          const result = await page.evaluate(async () => {
            const test = window.__aiCodeRuntimeHarness;
            const rect = test.controller.editor.getDomNode().getBoundingClientRect();
            const diagnostics = await Promise.race([
              (async () => {
                const worker = await test.controller.monaco.languages.typescript.getTypeScriptWorker();
                const uri = test.controller.editor.getModel().uri;
                const client = await worker(uri);
                return client.getSyntacticDiagnostics(uri.toString());
              })(),
              new Promise((_, reject) => setTimeout(() => reject(new Error('TypeScript worker timed out')), 15_000)),
            ]);
            return { value: test.controller.editor.getValue(), width: rect.width, height: rect.height,
              typescriptWorkerDiagnostics: diagnostics };
          });
          assert.ok(result.width > 100 && result.height > 100, 'Monaco must have a visible stable viewport');
          assert.deepEqual(result.typescriptWorkerDiagnostics, [], 'Local TypeScript worker must execute');
          const screenshot = `${application.toLowerCase()}-editor.png`;
          await page.screenshot({ path: join(destination, screenshot), fullPage: true });
          return { ...result, screenshot };
        });
        await stage('edit-and-prop-sync', async () => {
          const changed = 'const localValue = 2;';
          const external = 'const externalValue = 3;';
          await page.evaluate(() => window.__aiCodeRuntimeHarness.controller.editor.focus());
          await page.keyboard.press('ControlOrMeta+A');
          await page.keyboard.insertText(changed);
          await page.waitForFunction(value => {
            const test = window.__aiCodeRuntimeHarness;
            return test?.changes.includes(value) && test.controller.editor.getValue() === value;
          }, changed, { timeout: 10_000 });
          await page.evaluate(value => { window.__aiCodeRuntimeHarness.state.value = value; }, external);
          await page.waitForFunction(value => window.__aiCodeRuntimeHarness.controller.editor.getValue() === value,
            external, { timeout: 10_000 });
          return { keyboardChange: changed, externalPropReadback: external };
        });
        await stage('readonly-disabled', async () => {
          for (const flag of ['readonly', 'disabled']) {
            await page.evaluate(flag => { window.__aiCodeRuntimeHarness.state[flag] = true; }, flag);
            await page.waitForFunction(() => {
              const test = window.__aiCodeRuntimeHarness;
              return test.controller.editor.getRawOptions().readOnly === true;
            }, undefined, { timeout: 10_000 });
            const before = await page.evaluate(() => window.__aiCodeRuntimeHarness.controller.editor.getValue());
            await page.evaluate(() => window.__aiCodeRuntimeHarness.controller.editor.focus());
            await page.keyboard.insertText('forbidden');
            assert.equal(await page.evaluate(() => window.__aiCodeRuntimeHarness.controller.editor.getValue()),
              before, `${flag} must block keyboard changes`);
            await page.evaluate(flag => { window.__aiCodeRuntimeHarness.state[flag] = false; }, flag);
            await page.waitForFunction(() =>
              window.__aiCodeRuntimeHarness.controller.editor.getRawOptions().readOnly === false,
            undefined, { timeout: 10_000 });
          }
          return { readonly: true, disabled: true, editableRestored: true };
        });
        await stage('unmount-and-runtime-errors', async () => {
          const result = await page.evaluate(async () => {
            const test = window.__aiCodeRuntimeHarness;
            if (!test?.app || !test.controller.editor) throw new Error('Rendered editor required');
            const editor = test.controller.editor;
            let disposed = false;
            editor.onDidDispose(() => { disposed = true; });
            test.app.unmount();
            document.getElementById('ai-code-runtime-test-host').remove();
            window.dispatchEvent(new Event('resize'));
            window.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            test.mount();
            test.app.unmount();
            document.getElementById('ai-code-runtime-test-host').remove();
            await test.vue.nextTick();
            window.dispatchEvent(new Event('resize'));
            window.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
            return { disposed, remainingEditors: window.monaco.editor.getEditors().length,
              rapidUnmount: true, postUnmountEvents: ['resize', 'mousedown'] };
          });
          await page.waitForLoadState('networkidle', { timeout: 10_000 });
          await page.waitForTimeout(1000);
          result.remainingEditors = await page.evaluate(() => window.monaco.editor.getEditors().length);
          assert.equal(result.disposed, true, 'Unmount must dispose the editor');
          assert.equal(result.remainingEditors, 0, 'Unmount must leave no live test editors');
          assert.equal(app.runtimeErrors.length, 0, `Runtime errors: ${JSON.stringify(app.runtimeErrors)}`);
          return result;
        });
      } finally {
        await context.close();
        if (app.runtimeErrors.length && app.stages['unmount-and-runtime-errors']?.status === 'PASS') {
          app.stages['unmount-and-runtime-errors'] = {
            status: 'FAIL', error: `Late runtime errors: ${JSON.stringify(app.runtimeErrors)}`,
          };
        }
      }
    }
    assert.deepEqual(verifyNativeAiCodeRuntimeAssets({ workspace, assets }).receipt, verified.receipt,
      'Runtime asset evidence changed during browser checks');
    assert.deepEqual(readTree(join(verified.candidate, 'plugins', packageRepo), { jsonOnly: false }).entries,
      pluginEntries, 'Plugin evidence changed during browser checks');
  } catch (error) { report.errors.push(String(error)); }
  finally {
    if (browser) {
      try { await browser.close(); } catch (error) { report.errors.push(String(error)); }
    }
    report.verdict = summarizeRuntimeReport(report.applications);
    if (report.errors.length) report.verdict.isolatedRuntimePassed = false;
    report.completedAt = new Date().toISOString();
    report.status = report.verdict.isolatedRuntimePassed
      ? 'isolated-runtime-passed-native-not-accepted' : 'failed';
    fs.writeFileSync(join(destination, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  }
  return { destination, report };
}

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: {
    assets: { type: 'string' }, output: { type: 'string' }, 'central-url': { type: 'string' },
    'modeldesign-url': { type: 'string' }, help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) {
    console.log('Usage: node harness-native-ai-code-runtime.mjs --assets PATH [--output PATH] [--central-url URL] [--modeldesign-url URL]');
    return;
  }
  const { destination, report } = await runNativeAiCodeRuntimeHarness({
    assets: values.assets, output: values.output,
    centralUrl: values['central-url'], modeldesignUrl: values['modeldesign-url'],
  });
  console.log(`Runtime report: ${join(destination, 'report.json')}`);
  console.log(`Isolated runtime passed: ${report.verdict.isolatedRuntimePassed}; native acceptance remains false`);
  process.exitCode = report.verdict.isolatedRuntimePassed ? 2 : 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch(error => { console.error(String(error)); process.exitCode = 1; });
}
