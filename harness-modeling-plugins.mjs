#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import {
  assertSavedDocument, coverageProblems, deploymentTarget, DocumentLedger, documentPath, downloadOnClick,
  assertRendering, editorUrl, errorSummary, flowSteps, inspectRendering, jsonClient, languages, viewports,
} from './modeling-browser-contract.mjs';
import { assertDomainEdit, invalidDomainDocument } from './modeling-browser-cases.mjs';
import { validateCatalog } from './harness-modeling-extension-inventory.mjs';
import { checkArtifact, checkLive } from '../modelingweb/app/scripts/modeling-plugins-deployment.mjs';

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const app = join(workspace, 'modelingweb/app');
const catalogPath = join(app, 'src/modeling-plugins/catalog.json');
let catalog = [];
const stamp = `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}`;
const output = join(workspace, '.artifacts/modeling-plugins', stamp);
await mkdir(output, { recursive: true });
const require = createRequire(join(workspace, 'ibiz-app-hub/package.json'));
const deployedBase = process.env.AIBIZ_MODELING_PLUGINS_URL || '';
const deployed = Boolean(deployedBase);
const report = {
  schemaVersion: 2, startedAt: new Date().toISOString(),
  catalogSha256: null,
  implementation: 'independent-local-reimplementation',
  storage: deployed ? 'deployed-sidecar-files' : 'isolated-local-workspace-files',
  executionMode: deployed ? 'deployed-sidecar' : 'isolated-local-server',
  serverRestart: deployed ? 'not-tested-no-service-mutation' : 'not-tested',
  platformIntegration: 'not-verified',
  upstreamIntegration: 'not-verified',
  fullyLocalized: false,
  clientArtifactMatched: false,
  serverArtifactVerification: 'not-verified-from-http',
  phase: 'preflight',
  results: [], browserErrors: [], externalRequests: [], failedRequests: [], viewportResults: [],
  cleanup: { status: deployed ? 'not-run' : 'not-applicable', attempted: 0, deleted: 0, alreadyAbsent: 0, failures: [], retained: [] },
};
let child;
let browser;
let log = '';
const failures = [];
const persistedModels = new Map();
const titlePrefix = `Harness ${randomUUID()} `;
let visit = 0;
const labels = {
  'zh-CN': {
    save: '保存模型', saved: '已保存 · 版本', name: '模型名称',
    undo: '撤销', redo: '重做', exported: '导出模型', imported: '已导入副本',
    remove: '删除文档', deleted: '文档已删除',
  },
  en: {
    save: 'Save model', saved: 'Saved · Revision', name: 'Model name',
    undo: 'Undo', redo: 'Redo', exported: 'Export model', imported: 'Copy imported',
    remove: 'Delete document', deleted: 'Document deleted',
  },
};
let ui = labels['zh-CN'];

async function port() {
  const socket = createServer();
  await new Promise((resolvePromise, reject) => {
    socket.once('error', reject);
    socket.listen(0, '127.0.0.1', resolvePromise);
  });
  const value = socket.address().port;
  await new Promise(resolvePromise => socket.close(resolvePromise));
  return value;
}
let chosenPort;
let origin;
let pageBase;
let pageOrigin;
let request;
let ledger;

async function readDocument(pluginId, id) {
  const response = await request(documentPath(pluginId, id));
  assert.equal(response.status, 200);
  return response.body;
}

function pageUrl(pluginId, language, documentId) {
  visit += 1;
  return editorUrl(pageBase, pluginId, language, documentId, `${stamp}-${visit}`);
}

async function start() {
  if (deployed) {
    const response = await request('/api/modeling-plugins/catalog');
    assert.equal(response.status, 200, 'Deployed catalog is not ready');
    assert.ok(Array.isArray(response.body) && response.body.length === 23 &&
      response.body.every(item => item.conditionalDelete === 'revision+sha256'),
    'Deployed sidecar lacks atomic digest-checked deletion; rebuild/deploy before running writable smoke');
    return;
  }
  child = spawn(process.execPath, [join(app, 'dist-modeling-plugins/server.mjs')], {
    cwd: app, env: { ...process.env, MODELING_PLUGIN_PORT: String(chosenPort), MODELING_PLUGIN_DATA: join(output, 'data') },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout.on('data', data => { log += data.toString(); });
  child.stderr.on('data', data => { log += data.toString(); });
  child.on('error', error => { log += error.message; });
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Local server failed: ${log}`);
    try {
      if ((await request('/api/modeling-plugins/catalog')).status === 200) return;
    } catch (error) {
      if (/EPERM|EACCES/.test(error.message)) throw error;
    }
    await delay(100);
  }
  throw new Error('Local modeling server did not become ready');
}

async function stop() {
  if (deployed) return;
  if (!child || !child.pid || child.exitCode !== null || child.signalCode !== null) return;
  const running = child;
  await new Promise(resolvePromise => {
    const timeout = setTimeout(() => running.kill('SIGKILL'), 5000);
    running.once('exit', () => { clearTimeout(timeout); resolvePromise(); });
    running.kill('SIGTERM');
  });
}

async function json(page) {
  await page.getByTestId('model-tab').click();
  return JSON.parse(await page.getByTestId('document-json').innerText());
}

async function rendered(page, entry, document) {
  await page.getByTestId('plugin-editor').waitFor();
  if (entry.family === 'graph') {
    await page.locator('[data-testid="graph-canvas"] .x6-node').first().waitFor();
  }
  if (await page.getByTestId('chart-preview').count()) {
    await page.locator('[data-testid="chart-preview"] canvas').first().waitFor();
  }
  await page.evaluate(() => new Promise(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const evidence = await page.evaluate(inspectRendering);
  assertRendering(entry, document, evidence);
  return evidence;
}

async function saved(page, revision) {
  const draft = await json(page);
  assert.equal(draft.revision + 1, revision);
  if (ledger) {
    await ledger.beforeSave(draft);
    // Leave a recoverable ownership record even if the browser or process fails later.
    await writeFile(join(output, 'owned-documents.json'), `${JSON.stringify(
      [...ledger.documents.values()].map(owner => ({
        path: owner.path, snapshots: [...owner.snapshots.values()], acknowledged: [...owner.acknowledged],
      })),
      null, 2,
    )}\n`, { mode: 0o600 });
  }
  await page.getByRole('button', { name: ui.save, exact: true }).click();
  await page.getByRole('status').filter({ hasText: `${ui.saved} ${revision}` }).waitFor({ timeout: 10000 });
  const acknowledged = await json(page);
  assertSavedDocument(draft, acknowledged);
  ledger?.acknowledge(acknowledged);
  return acknowledged;
}

async function trackContext(context) {
  await context.route('**/*', async route => {
    const url = route.request().url();
    if (url.startsWith(`${pageOrigin}/`) || url.startsWith('data:') || url.startsWith('blob:')) return route.continue();
    report.externalRequests.push(url);
    return route.abort();
  });
  context.on('page', page => {
    page.on('requestfailed', request => report.failedRequests.push({
      pluginId: report.activePlugin, language: report.activeLanguage,
      url: request.url(), error: request.failure()?.errorText,
    }));
    page.on('response', response => {
      if (response.status() >= 400) report.failedRequests.push({
        pluginId: report.activePlugin, language: report.activeLanguage,
        url: response.url(), status: response.status(),
      });
    });
    page.on('pageerror', error => report.browserErrors.push({
      pluginId: report.activePlugin, language: report.activeLanguage, message: error.message,
    }));
    page.on('console', message => {
      if (message.type() === 'error') report.browserErrors.push({
        pluginId: report.activePlugin, language: report.activeLanguage, type: 'console', message: message.text(),
      });
    });
  });
}

try {
  const catalogBytes = await readFile(catalogPath);
  catalog = JSON.parse(catalogBytes);
  report.catalogSha256 = createHash('sha256').update(catalogBytes).digest('hex');
  validateCatalog(catalog);
  const manifest = await checkArtifact();
  report.artifactManifestSha256 = createHash('sha256').update(
    await readFile(join(app, 'dist-modeling-plugins/plugin-manifest.json')),
  ).digest('hex');
  report.runnerSha256 = createHash('sha256').update(await readFile(fileURLToPath(import.meta.url))).digest('hex');
  report.contractSha256 = createHash('sha256').update(await readFile(new URL('./modeling-browser-contract.mjs', import.meta.url))).digest('hex');
  report.domainCasesSha256 = createHash('sha256').update(await readFile(new URL('./modeling-browser-cases.mjs', import.meta.url))).digest('hex');
  if (deployed) {
    const target = deploymentTarget(deployedBase);
    pageBase = target.pageBase;
    pageOrigin = target.origin;
    origin = pageOrigin;
  } else {
    await readFile(join(app, 'dist-modeling-plugins/server.mjs'));
    chosenPort = await port();
    origin = `http://127.0.0.1:${chosenPort}`;
    pageBase = origin;
    pageOrigin = origin;
  }
  request = jsonClient(pageOrigin);
  if (deployed) ledger = new DocumentLedger(request, titlePrefix);
  report.origin = pageBase;
  report.phase = 'api-readiness';
  await start();
  report.phase = 'client-artifact-check';
  await checkLive(pageOrigin, manifest, { assetPrefix: `${pageBase.slice(pageOrigin.length)}/` });
  report.clientArtifactMatched = true;
  report.phase = 'browser-launch';
  const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
  browser = await chromium.launch({ headless: true, timeout: 30000, executablePath: process.env.CHROME_PATH || undefined });
  report.browserVersion = browser.version();
  const context = await browser.newContext({ locale: 'zh-CN', viewport: { width: 1440, height: 1000 }, acceptDownloads: true });
  context.setDefaultTimeout(10000);
  context.setDefaultNavigationTimeout(20000);
  await trackContext(context);
  const page = await context.newPage();
  page.on('dialog', dialog => dialog.accept());

  const catalogResponse = await request('/api/modeling-plugins/catalog');
  assert.equal(catalogResponse.status, 200);
  const serverCatalog = catalogResponse.body;
  assert.deepEqual(serverCatalog.map(item => item.id), catalog.map(item => item.id));
  assert.equal(serverCatalog.length, 23);

  report.phase = 'browser-flows';
  for (const language of languages) {
   ui = labels[language];
   for (const entry of catalog) {
    report.activePlugin = entry.id;
    report.activeLanguage = language;
    const result = { id: entry.id, language, title: entry.title, steps: [], status: 'running' };
    report.results.push(result);
    const step = async (name, action) => { await action(); result.steps.push({ name, status: 'pass' }); };
    try {
      let initial;
      let original;
      let changed;
      await step('load-local-editor', async () => {
        const response = await page.goto(pageUrl(entry.id, language), { waitUntil: 'networkidle' });
        assert.equal(response.status(), 200);
        await page.getByTestId('plugin-editor').waitFor();
        assert.equal(await page.locator('.mp-navigation [data-plugin-id]').count(), 23);
        assert.equal(await page.locator('html').getAttribute('lang'), language);
        if (language === 'en') {
          assert.doesNotMatch(await page.locator('.mp-navigation nav').innerText(), /[\u3400-\u9fff]/u);
        }
        initial = await json(page);
        assert.equal(initial.pluginId, entry.id);
        assert.equal(initial.revision, 0, 'Each case must begin with a new document');
        await page.getByTestId('design-tab').click();
      });
      await step('edit-domain-model', async () => {
        await page.getByRole('textbox', { name: ui.name, exact: true }).fill(`${titlePrefix}${entry.id} ${language}`);
        await page.getByTestId('add-item').click();
        changed = await json(page);
        assertDomainEdit(entry.id, initial, changed);
      });
      await step('switch-language-preserves-draft', async () => {
        const before = await json(page);
        await page.getByTestId('design-tab').click();
        await rendered(page, entry, before);
        const editor = await page.getByTestId('plugin-editor').elementHandle();
        assert.ok(editor);
        const other = language === 'en' ? 'zh-CN' : 'en';
        try {
          for (const target of [other, language]) {
            await page.getByTestId('language-select').selectOption(target);
            assert.equal(await page.locator('html').getAttribute('lang'), target);
            assert.equal(await editor.evaluate(element =>
              element === document.querySelector('[data-testid="plugin-editor"]') && element.isConnected), true,
            'Language change remounted or removed the domain editor');
            await rendered(page, entry, before);
          }
        } finally {
          await editor.dispose();
        }
        assert.deepEqual(await json(page), before);
      });
      await step('save-and-read-back', async () => {
        original = await saved(page, 1);
        assert.deepEqual(original.content, changed.content, 'Save discarded a domain edit');
        assert.equal(original.title, changed.title);
        const persisted = await readDocument(entry.id, original.id);
        assert.deepEqual(persisted, original);
      });
      await step('reload-and-compare', async () => {
        await page.reload({ waitUntil: 'networkidle' });
        assert.deepEqual((await json(page)).content, original.content);
      });
      await step('undo-redo-and-update', async () => {
        const name = page.getByRole('textbox', { name: ui.name, exact: true });
        await name.fill(`${titlePrefix}Updated ${entry.id} ${language}`);
        await page.getByRole('button', { name: ui.undo, exact: true }).click();
        assert.equal(await name.inputValue(), original.title);
        await page.getByRole('button', { name: ui.redo, exact: true }).click();
        assert.equal(await name.inputValue(), `${titlePrefix}Updated ${entry.id} ${language}`);
        original = await saved(page, 2);
      });
      await step('reject-invalid-import', async () => {
        const invalid = invalidDomainDocument(original);
        const file = join(output, `${entry.id}-${language}-invalid.json`);
        await writeFile(file, `${JSON.stringify(invalid, null, 2)}\n`);
        await page.getByTestId('model-import').setInputFiles(file);
        const alert = page.getByRole('alert');
        await alert.waitFor();
        if (language === 'en') assert.doesNotMatch(await alert.innerText(), /[\u3400-\u9fff]/u);
        assert.deepEqual(await json(page), original, 'Rejected import changed the editor document');
      });
      await step('reject-invalid-api-write', async () => {
        const response = await request(documentPath(entry.id, original.id), {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(invalidDomainDocument(original)),
        });
        assert.equal(response.status, 422, 'Invalid domain data must be rejected');
        assert.equal(response.body.error, 'validation_failed');
        assert.deepEqual(await readDocument(entry.id, original.id), original, 'Invalid write changed stored revision/content');
      });
      await step('export-and-import-copy', async () => {
        const download = await downloadOnClick(page, () =>
          page.getByRole('button', { name: ui.exported, exact: true }).click());
        const exported = join(output, `${entry.id}-${language}.json`);
        await download.saveAs(exported);
        assert.deepEqual(JSON.parse(await readFile(exported, 'utf8')), original);
        await page.getByTestId('model-import').setInputFiles(exported);
        await page.getByRole('status').filter({ hasText: ui.imported }).waitFor();
        const copy = await json(page);
        assert.notEqual(copy.id, original.id);
        assert.equal(copy.revision, 0);
        assert.deepEqual(copy.content, original.content);
        await saved(page, 1);
      });
      await step('delete-copy', async () => {
        const copy = await json(page);
        await page.getByRole('button', { name: ui.remove, exact: true }).click();
        await page.getByRole('status').filter({ hasText: ui.deleted }).waitFor();
        const absent = await request(documentPath(entry.id, copy.id));
        assert.equal(absent.status, 404);
        assert.equal(absent.body.error, 'not_found');
      });
      await step('desktop-render', async () => {
        await page.goto(pageUrl(entry.id, language, original.id), { waitUntil: 'networkidle' });
        assert.deepEqual(await json(page), original);
        await page.getByTestId('design-tab').click();
        await page.getByTestId('plugin-editor').waitFor();
        const box = await page.getByTestId('plugin-editor').boundingBox();
        assert.ok(box && box.width > 400 && box.height > 100);
        result.rendering = await rendered(page, entry, original);
        await page.screenshot({ path: join(output, `${entry.id}-${language}-desktop.png`), fullPage: true });
      });
      result.documentId = original.id;
      result.revision = original.revision;
      persistedModels.set(`${entry.id}:${language}`, original);
      result.status = 'pending-recovery';
    } catch (error) {
      result.status = 'fail';
      result.error = error.message;
      failures.push(`${entry.id} (${language}): ${error.message}`);
      await page.screenshot({ path: join(output, `${entry.id}-${language}-failure.png`), fullPage: true }).catch(() => {});
      if (/EPERM|EACCES/.test(errorSummary(error))) throw error;
    }
    console.log(`${result.status.toUpperCase()} ${entry.id} (${language}): ${result.steps.length}/${flowSteps.length} initial flows`);
   }
  }

  report.phase = 'recovery';
  if (!deployed) {
    await stop();
    await start();
    report.serverRestart = 'performed';
  }
  for (const result of report.results.filter(item => item.status === 'pending-recovery')) {
    report.activePlugin = result.id;
    report.activeLanguage = result.language;
    let fresh;
    try {
      const persisted = await readDocument(result.id, result.documentId);
      assert.deepEqual(persisted, persistedModels.get(`${result.id}:${result.language}`), 'Persistence changed the model');
      if (!deployed) result.steps.push({ name: 'server-restart-recovery', status: 'pass' });
      fresh = await browser.newContext({ locale: result.language === 'en' ? 'en-US' : 'zh-CN' });
      fresh.setDefaultTimeout(10000);
      fresh.setDefaultNavigationTimeout(20000);
      await trackContext(fresh);
      const freshPage = await fresh.newPage();
      await freshPage.goto(pageUrl(result.id, result.language, result.documentId));
      await freshPage.getByTestId('plugin-editor').waitFor();
      assert.deepEqual(await json(freshPage), persisted, 'Fresh browser session changed the document');
      result.steps.push({ name: 'fresh-session-reload', status: 'pass' });
      result.status = 'pass';
    } catch (error) {
      result.status = 'fail';
      result.error = errorSummary(error);
      failures.push(`${result.id} (${result.language}) recovery: ${result.error}`);
    } finally {
      await fresh?.close();
    }
  }

  report.phase = 'viewports';
  for (const viewport of viewports) {
    await page.setViewportSize(viewport);
    for (const language of languages) {
     for (const entry of catalog) {
      report.activePlugin = entry.id;
      report.activeLanguage = language;
      const result = { id: entry.id, language, viewport, status: 'running' };
      report.viewportResults.push(result);
      try {
        const persisted = persistedModels.get(`${entry.id}:${language}`);
        assert.ok(persisted, 'Missing saved model for viewport check');
        await page.goto(pageUrl(entry.id, language, persisted.id), { waitUntil: 'networkidle' });
        assert.deepEqual(await json(page), persisted);
        await page.getByTestId('design-tab').click();
        await page.getByTestId('plugin-editor').waitFor();
        const dimensions = await page.evaluate(() => ({
          viewport: window.innerWidth, width: document.documentElement.scrollWidth,
          height: document.querySelector('[data-testid="plugin-editor"]').getBoundingClientRect().height,
        }));
        assert.ok(dimensions.width <= dimensions.viewport + 1, `Horizontal overflow: ${JSON.stringify(dimensions)}`);
        assert.ok(dimensions.height > 100);
        result.rendering = await rendered(page, entry, persisted);
        await page.screenshot({ path: join(output, `${entry.id}-${language}-${viewport.width}.png`), fullPage: true });
        result.status = 'pass';
      } catch (error) {
        result.status = 'fail'; result.error = error.message;
        failures.push(`${entry.id} (${language}) @ ${viewport.width}: ${error.message}`);
      }
     }
    }
  }
  assert.equal(report.externalRequests.length, 0, 'Runtime requested non-local dependencies');
  assert.equal(report.browserErrors.length, 0, 'Unfiltered browser errors were observed');
} catch (error) {
  report.failedPhase = report.phase;
  failures.push(errorSummary(error));
} finally {
  try { await browser?.close(); } catch (error) { failures.push(`Browser close: ${errorSummary(error)}`); }
  if (ledger) {
    report.cleanup = await ledger.cleanup();
    if (report.cleanup.status !== 'pass') failures.push('Deployed cleanup failed; see cleanup.retained');
  }
  try { await stop(); } catch (error) { failures.push(`Server close: ${errorSummary(error)}`); }
  delete report.activePlugin;
  delete report.activeLanguage;
  report.completedAt = new Date().toISOString();
  report.coverageProblems = coverageProblems(report, catalog);
  if (report.coverageProblems.length) failures.push('Required browser coverage is incomplete');
  report.phase = 'complete';
  report.status = failures.length ? 'fail' : 'pass';
  report.failures = failures;
  await writeFile(join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(join(output, 'server.log'), log);
  await writeFile(join(output, 'report.md'), [
    '# Local Modeling Plugin Harness', '',
    `Generated: ${report.completedAt}`, '',
    `Local flow result: **${report.status.toUpperCase()}**`,
    `Execution: ${report.executionMode}; storage: ${report.storage}`,
    `Server restart: ${report.serverRestart}`,
    `Cleanup: ${report.cleanup.status}; retained: ${report.cleanup.retained.length}`,
    `Plugin/language cases passed: ${report.results.filter(item => item.status === 'pass').length}/46`,
    `Browser errors: ${report.browserErrors.length}; non-local requests: ${report.externalRequests.length}`,
    'Original system integration and original exact-version packages: **NOT VERIFIED / NOT COMPLETE**.', '',
    '| Plugin | Language | Local Flows | Result |', '|---|---|---:|---|',
    ...report.results.map(item => `| ${item.id} | ${item.language} | ${item.steps.length}/${flowSteps.length + (deployed ? 1 : 2)} | ${item.status} |`),
    '', '## Failures', '', ...(failures.length ? failures.map(error => `- ${error}`) : ['None in the tested local scope.']), '',
  ].join('\n'));
  console.log(`Report: ${join(output, 'report.json')}`);
  console.log(`Local flows: ${report.status}; fully localized original platform: false`);
  process.exitCode = failures.length ? 1 : 0;
}
