#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { launchChromium } from './browser-launch.mjs';
import { createPlmCandidateServer, treeInventory } from '../plm-web/tools/plm-candidate-host.mjs';

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(join(workspace, 'plm-e2e/package.json'));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const basePath = '/ibizplm-plmweb/';

export function startupCells() {
  return ['zh-CN', 'en'].flatMap(language => [
    { language, device: 'desktop', viewport: { width: 1440, height: 1000 } },
    { language, device: 'mobile', viewport: { width: 390, height: 844 } },
  ]);
}

export function startupCellPassed(cell) {
  return cell.loginVisible === true && cell.entryIdentityVerified === true &&
    cell.closed === true && cell.pageErrors.length === 0 &&
    cell.consoleErrors.length === 0 && cell.httpErrors.length === 0 &&
    cell.failedRequests.length === 0 && cell.externalRequests.length === 0 &&
    cell.errors.length === 0;
}

export async function checkPlmSourceStartup({ candidate, upstream, output }) {
  assert.ok(candidate && output && upstream, 'candidate, upstream and output are required');
  const destination = resolve(output);
  assert.equal(await realpath(dirname(destination)), join(workspace, '.artifacts'));
  const root = await realpath(candidate);
  const dist = await realpath(join(root, 'dist'));
  const receiptBytes = await readFile(join(root, 'source-build.json'));
  const receipt = JSON.parse(receiptBytes);
  assert.equal(receipt.freshApplicationBuild, true);
  assert.equal(receipt.sharedDistUnchanged, true);
  assert.deepEqual(await treeInventory(dist), receipt.outputFiles, 'Candidate bytes drifted after build');
  const expected = new Map(receipt.outputFiles.map(file => [file.path, file.sha256]));
  const entries = receipt.outputFiles.filter(file =>
    file.path === 'index.html' || /^static\/js\/index-legacy-[\w-]+\.js$/.test(file.path));
  assert.equal(entries.length, 2, 'A single generated legacy entry and index are required');
  for (const runtime of receipt.runtimeOverrides ?? []) {
    assert.equal(runtime.package, '@ibiz-template/vue3-components');
    const entry = 'extras/js/@ibiz-template/vue3-components/index.system.min.js';
    const file = runtime.outputFiles.find(file => file.path === 'index.system.min.js');
    assert.ok(file, 'A rebuilt runtime entry is required');
    assert.equal(expected.get(entry), file.sha256, 'Runtime entry differs from its build');
    entries.push({ path: entry, sha256: file.sha256 });
  }
  await mkdir(destination, { mode: 0o700 });
  const report = {
    scope: 'Actual PLM source candidate pre-login startup only; no business or deployment acceptance',
    nativeAcceptance: false, sharedDeployment: false, businessWritesExecuted: false,
    sourceBuildReceiptSha256: digest(receiptBytes),
    runnerSha256: digest(await readFile(fileURLToPath(import.meta.url))),
    candidate, node: process.version, cells: [], serverRequests: [], errors: [],
    startedAt: new Date().toISOString(),
  };
  let server;
  let browser;
  try {
    server = await createPlmCandidateServer({
      dist, upstream, log: event => report.serverRequests.push(event),
    });
    await new Promise((accept, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', accept);
    });
    const origin = `http://127.0.0.1:${server.address().port}`;
    const { chromium } = require('@playwright/test');
    browser = await launchChromium(chromium);
    for (const config of startupCells()) {
      const cell = { ...config, loginVisible: false, entryIdentityVerified: false,
        closed: false, servedEntries: [], pageErrors: [], consoleErrors: [],
        warnings: [], httpErrors: [], failedRequests: [], externalRequests: [], errors: [] };
      report.cells.push(cell);
      const context = await browser.newContext({ viewport: config.viewport, locale: config.language });
      const tasks = [];
      try {
        await context.addInitScript(language => localStorage.setItem('language', language), config.language);
        await context.route('**/*', route => {
          const url = new URL(route.request().url());
          if (url.origin === origin || ['data:', 'blob:'].includes(url.protocol)) return route.continue();
          cell.externalRequests.push({ method: route.request().method(), origin: url.origin, path: url.pathname });
          return route.abort('blockedbyclient');
        });
        const page = await context.newPage();
        page.on('pageerror', error => cell.pageErrors.push(error.message));
        page.on('console', message => {
          if (message.type() === 'error') cell.consoleErrors.push(message.text());
          if (message.type() === 'warning') cell.warnings.push(message.text());
        });
        page.on('requestfailed', request => cell.failedRequests.push({
          method: request.method(), path: new URL(request.url()).pathname,
          reason: request.failure()?.errorText ?? 'unknown',
        }));
        page.on('response', response => {
          const url = new URL(response.url());
          if (response.status() >= 400) cell.httpErrors.push({
            method: response.request().method(), path: url.pathname, status: response.status(),
          });
          const path = url.pathname.slice(basePath.length) || 'index.html';
          if (url.origin !== origin || !url.pathname.startsWith(basePath) ||
            !entries.some(entry => entry.path === path)) return;
          tasks.push((async () => {
            const bytes = await response.body();
            assert.equal(response.status(), 200);
            assert.equal(digest(bytes), expected.get(path), `Served entry differs: ${path}`);
            cell.servedEntries.push({ path, sha256: digest(bytes) });
          })().catch(error => cell.errors.push(error.message)));
        });
        await page.goto(`${origin}${basePath}#/-/index/-/workspace_tab_exp_view/srfnav=dashboard/recent_custom_dashboard_view/-`,
          { waitUntil: 'load', timeout: 60_000 });
        const password = page.locator('input[type="password"]').first();
        await password.waitFor({ state: 'visible', timeout: 30_000 });
        const bounds = await password.boundingBox();
        cell.loginVisible = Boolean(bounds && bounds.width > 0 && bounds.height > 0 &&
          bounds.x >= 0 && bounds.x + bounds.width <= config.viewport.width);
        cell.documentLanguage = await page.locator('html').getAttribute('lang');
        assert.equal(cell.documentLanguage, config.language, 'The requested UI language was not applied');
        await page.waitForLoadState('networkidle', { timeout: 20_000 });
        await Promise.all(tasks);
        cell.entryIdentityVerified = entries.every(entry =>
          cell.servedEntries.some(served => served.path === entry.path && served.sha256 === entry.sha256));
        await page.screenshot({
          path: join(destination, `${config.device}-${config.language}.png`),
          fullPage: true, animations: 'disabled',
        });
      } catch (error) {
        cell.errors.push(error.message);
      } finally {
        try { await context.close(); cell.closed = true; }
        catch (error) { cell.errors.push(`Context close failed: ${error.message}`); }
        await Promise.all(tasks);
      }
      cell.passed = startupCellPassed(cell);
      console.log(`${config.device}/${config.language}: ${cell.passed ? 'PASS' : 'FAIL'} ` +
        `(console=${cell.consoleErrors.length}, http=${cell.httpErrors.length}, exceptions=${cell.pageErrors.length})`);
    }
  } catch (error) {
    report.errors.push(error.message);
  } finally {
    if (browser) {
      try { await browser.close(); }
      catch (error) { report.errors.push(`Browser close failed: ${error.message}`); }
    }
    if (server) {
      await new Promise(accept => {
        server.close(accept);
        server.closeAllConnections();
      });
    }
    report.finishedAt = new Date().toISOString();
    report.passed = report.errors.length === 0 && report.cells.length === 4 &&
      report.cells.every(startupCellPassed);
    report.status = report.passed ? 'passed-prelogin-startup-only' : 'failed';
    await writeFile(join(destination, 'report.private.json'), `${JSON.stringify(report, null, 2)}\n`,
      { flag: 'wx', mode: 0o600 });
  }
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: {
    candidate: { type: 'string' }, upstream: { type: 'string' }, output: { type: 'string' },
  } });
  checkPlmSourceStartup(values).then(report => {
    console.log(JSON.stringify({ status: report.status, output: values.output,
      cases: report.cells.map(cell => ({ language: cell.language, device: cell.device,
        passed: cell.passed, errors: cell.errors, consoleErrors: cell.consoleErrors.length,
        httpErrors: cell.httpErrors.length, pageErrors: cell.pageErrors.length })) }, null, 2));
    process.exitCode = report.passed ? 0 : 1;
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
