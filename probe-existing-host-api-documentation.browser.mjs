#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { spawnSync } from 'node:child_process';
import { launchChromium } from './browser-launch.mjs';
import { apiDocumentationRuntimeWitness } from './prepare-existing-api-documentation-release.mjs';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const origin = 'http://127.0.0.1:30250';
const entry = `${origin}/ibizplm-plmweb/doc/`;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const require = createRequire(path.join(workspace, 'ibiz-app-hub/package.json'));
const { chromium } = require('playwright');
function privateRead(file) {
  const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    assert.ok(stat.isFile() && stat.uid === process.geteuid() && (stat.mode & 0o077) === 0);
    return fs.readFileSync(fd);
  } finally { fs.closeSync(fd); }
}
export function existingHostDocumentRequest(url, method) {
  const parsed = new URL(url);
  return parsed.origin === origin && method === 'GET' && parsed.pathname.startsWith('/ibizplm-plmweb/doc/') &&
    !/[%\\]/.test(parsed.pathname) && !parsed.pathname.split('/').some(part => part === '.' || part === '..');
}
export function validateAppliedDocumentation(plan, apply, planSha256) {
  assert.equal(plan.contract, 'api-documentation-exact-install-v1');
  assert.equal(apply.contract, 'api-documentation-exact-apply-v1');
  assert.equal(apply.status, 'APPLIED-STATIC-DOCUMENTATION-NATIVE-ACCEPTANCE-PENDING');
  assert.equal(apply.planSha256, planSha256);
  assert.equal(apply.epoch, plan.epoch);
  assert.equal(apply.releaseSha256, plan.releaseSha256);
  assert.equal(apply.error, undefined);
  assert.equal(apply.ledger.length, plan.targets.host.length + plan.targets.container.length);
  assert.equal(apply.recovery.length, 0);
  assert.equal(apply.transportErrors.length, 0);
  for (const scope of ['host', 'container']) for (const item of plan.targets[scope]) {
    const rows = apply.ledger.filter(row => row.scope === scope && row.path === item.path && row.installed && !row.restoring);
    assert.equal(rows.length, 1, 'Each approved file requires one verified install record');
    assert.equal(rows[0].staged.sha256, item.candidate.sha256);
  }
  assert.equal(apply.parentAcceptance, false);
}
async function openSidebar(page, mobile) {
  if (!mobile) return;
  if (!await page.locator('body').evaluate(element => element.classList.contains('close'))) {
    await page.locator('.sidebar-toggle').click();
  }
  await page.waitForFunction(() => {
    const rect = document.querySelector('.sidebar').getBoundingClientRect();
    return rect.left >= -1 && rect.right <= innerWidth + 1;
  });
  await page.locator('[data-aibiz-api-search]').scrollIntoViewIfNeeded();
}
function capture(page, row) {
  page.on('pageerror', error => row.pageErrors.push(error.message));
  page.on('console', message => { if (message.type() === 'error') row.consoleErrors.push(message.text()); });
  page.on('requestfailed', request => row.failedRequests.push({ path: new URL(request.url()).pathname, error: request.failure()?.errorText }));
  page.on('response', response => {
    if (response.status() >= 400) row.httpErrors.push({ path: new URL(response.url()).pathname, status: response.status() });
  });
}
function noRawErrors(row) {
  for (const name of ['pageErrors', 'consoleErrors', 'failedRequests', 'httpErrors', 'blockedRequests']) assert.deepEqual(row[name], []);
}
function rowFor(kind, language, viewport) {
  return { kind, language, viewport, status: 'FAILED', pageErrors: [], consoleErrors: [],
    failedRequests: [], httpErrors: [], blockedRequests: [] };
}

export async function probeExistingHostApiDocumentation(options) {
  const output = path.resolve(options.output);
  assert.equal(fs.realpathSync(path.dirname(output)), path.join(workspace, '.artifacts'));
  assert.match(path.basename(output), /^host-api-documentation-[a-z0-9-]+$/);
  const planBytes = privateRead(path.resolve(options.plan));
  const applyBytes = privateRead(path.resolve(options.apply));
  assert.equal(hash(planBytes), options.planSha256);
  assert.equal(hash(applyBytes), options.applySha256);
  const plan = JSON.parse(planBytes), applied = JSON.parse(applyBytes);
  validateAppliedDocumentation(plan, applied, options.planSha256);
  const releaseBytes = privateRead(path.join(plan.releaseDirectory, 'plan.private.json'));
  assert.equal(hash(releaseBytes), plan.releaseSha256);
  const release = JSON.parse(releaseBytes);
  assert.equal(release.prefix, '/ibizplm-plmweb/doc/');
  const inspect = () => {
    const result = spawnSync('docker', ['inspect', plan.runtime.id], { encoding: 'utf8', timeout: 15_000 });
    assert.equal(result.status, 0);
    return apiDocumentationRuntimeWitness(JSON.parse(result.stdout)[0]);
  };
  fs.mkdirSync(output, { mode: 0o700 });
  const source = fs.readFileSync(fileURLToPath(import.meta.url));
  fs.writeFileSync(path.join(output, 'executed-probe.private.mjs'), source, { mode: 0o600, flag: 'wx' });
  const report = { contract: 'existing-host-api-documentation-browser-v1', status: 'FAILED',
    startedAt: new Date().toISOString(), entry, planSha256: hash(planBytes), applySha256: hash(applyBytes),
    runtimeBefore: inspect(), runtimeAfter: null, sourceSha256: hash(source), staticCells: [],
    nativeHostCells: [], recovery: null, servedBytes: [], apiExecutionAcceptance: false, parentAcceptance: false,
    databaseTotalInvarianceClaimed: false, privateStaticServerUsed: false };
  report.sourceBindings = ['scripts/probe-existing-host-api-documentation.browser.mjs',
    'scripts/tests/probe-existing-host-api-documentation.test.mjs', 'scripts/browser-launch.mjs',
    'scripts/prepare-existing-api-documentation-release.mjs'].map((relative, index) => {
    const bytes = fs.readFileSync(path.join(workspace, relative));
    const snapshot = `source-${index}.private.mjs`;
    fs.writeFileSync(path.join(output, snapshot), bytes, { mode: 0o600, flag: 'wx' });
    return { path: relative, sha256: hash(bytes), snapshot };
  });
  let browser;
  try {
    assert.deepEqual(report.runtimeBefore, plan.runtime);
    const exactGet = async relative => {
      const response = await fetch(`${entry}${relative}`, { redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(15_000) });
      const bytes = Buffer.from(await response.arrayBuffer());
      const expected = release.candidate.files.find(item => item.path === relative);
      assert.ok(expected);
      report.servedBytes.push({ path: relative, status: response.status, bytes: bytes.length, sha256: hash(bytes) });
      assert.equal(response.status, 200); assert.equal(hash(bytes), expected.sha256);
      return bytes;
    };
    for (const relative of ['index.html', 'script/docsify.js', 'script/aibiz-api-reference.js',
      'css/local-theme.css', 'api-reference/manifest.json']) await exactGet(relative);
    const searches = {};
    for (const language of ['en', 'zh-CN']) searches[language] = JSON.parse(await exactGet(`api-reference/${language}/search.json`));
    browser = await launchChromium(chromium);
    for (const language of ['zh-CN', 'en']) for (const [viewportName, viewport] of [
      ['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }],
    ]) {
      const row = rowFor('actual-shared-document', language, viewportName);
      report.staticCells.push(row);
      const context = await browser.newContext({ locale: language === 'en' ? 'en-US' : 'zh-CN',
        viewport, serviceWorkers: 'block' });
      try {
        await context.addInitScript(value => localStorage.setItem('language', value), language);
        await context.route('**/*', route => {
          if (existingHostDocumentRequest(route.request().url(), route.request().method())) return route.continue();
          row.blockedRequests.push({ path: new URL(route.request().url()).pathname, method: route.request().method() });
          return route.abort();
        });
        const page = await context.newPage(); page.setDefaultTimeout(20_000); capture(page, row);
        await page.goto(`${entry}#/api/ServiceAPI/deapi/article_page`);
        await page.waitForFunction(value => location.hash === `#/api-reference/${value}/entities/article_page` &&
          document.querySelector('[data-aibiz-api-search]')?.disabled === false, language);
        assert.equal(await page.title(), language === 'en' ? 'Service API Reference' : '服务接口参考');
        const field = searches[language].entries.find(item => item.code === 'article_page' && item.path.includes('?id=fields-'));
        const method = searches[language].entries.find(item => item.code === 'get_customer_score' && item.path.includes('/entities/idea?id=op-'));
        assert.ok(field && method);
        await openSidebar(page, viewportName === 'mobile');
        await page.locator('[data-aibiz-api-search]').fill(language === 'en' ? 'Access Password' : '访问密码');
        await page.locator(`[data-aibiz-api-results] a[href="${field.path}"]`).click();
        const marker = field.path.split('?id=')[1];
        await page.waitForFunction(id => Boolean(document.getElementById(id)), marker);
        await page.reload();
        await page.waitForFunction(id => Boolean(document.getElementById(id)) &&
          document.querySelector('[data-aibiz-api-search]')?.disabled === false, marker);
        assert.equal(await page.locator('[data-aibiz-api-search]').inputValue(), language === 'en' ? 'Access Password' : '访问密码');
        row.fieldAnchor = marker;
        await openSidebar(page, viewportName === 'mobile');
        const input = page.locator('[data-aibiz-api-search]');
        await input.fill('customer_score_precent get_customer_score');
        await page.locator(`[data-aibiz-api-results] a[href="${method.path}"]`).waitFor();
        const prior = new URL(page.url()).hash;
        await input.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
        assert.equal(new URL(page.url()).hash, prior);
        await input.press('Enter');
        await page.waitForFunction(expected => location.hash === expected, method.path);
        await page.locator('.markdown-section').filter({ hasText: 'customer_score_precent' }).waitFor();
        row.methodPath = method.path;
        const other = language === 'en' ? 'zh-CN' : 'en';
        await page.waitForFunction(() => document.querySelector('[data-aibiz-api-search]')?.disabled === false);
        await openSidebar(page, viewportName === 'mobile');
        await page.locator('[data-aibiz-api-panel] nav').getByRole('link', { name: other === 'en' ? 'English' : '中文', exact: true }).click();
        await page.waitForFunction(value => location.hash.includes(`/api-reference/${value}/`) &&
          document.querySelector('[data-aibiz-api-search]')?.disabled === false, other);
        assert.equal(await page.locator('[data-aibiz-api-search]').inputValue(), 'customer_score_precent get_customer_score');
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await page.screenshot({ path: path.join(output, `${language}-${viewportName}.png`) });
        await page.goto(`${entry}#/`);
        await page.getByRole('heading', { name: '产品生命周期管理系统', exact: true }).waitFor();
        assert.equal(await page.locator('[data-aibiz-api-panel]').count(), 0);
        noRawErrors(row); row.status = 'PASS';
      } finally { await context.close(); }
    }
    const row = rowFor('controlled-index-failure-and-real-host-retry', 'en', 'mobile');
    report.recovery = row;
    const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
    try {
      let fault = false, faults = 0;
      await context.route('**/*', route => {
        const request = route.request();
        if (!existingHostDocumentRequest(request.url(), request.method())) {
          row.blockedRequests.push({ path: new URL(request.url()).pathname, method: request.method() }); return route.abort();
        }
        if (fault && new URL(request.url()).pathname.endsWith('/api-reference/en/search.json')) {
          fault = false; faults += 1;
          return route.fulfill({ status: 200, contentType: 'application/json', body: '{"schemaVersion":2,"language":"en","entries":"controlled-invalid-index"}' });
        }
        return route.continue();
      });
      const page = await context.newPage(); page.setDefaultTimeout(20_000); capture(page, row);
      await page.goto(`${entry}#/api-reference/en/entities/idea`);
      await page.waitForFunction(() => document.querySelector('[data-aibiz-api-search]')?.disabled === false);
      await openSidebar(page, true);
      await page.locator('[data-aibiz-api-search]').fill('customer_score_precent get_customer_score');
      fault = true; await page.reload();
      await page.locator('[role="alert"]').filter({ hasText: 'API search index unavailable' }).waitFor();
      await openSidebar(page, true);
      await page.getByRole('button', { name: 'Retry', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('[data-aibiz-api-search]')?.disabled === false);
      assert.equal(await page.locator('[data-aibiz-api-search]').inputValue(), 'customer_score_precent get_customer_score');
      assert.ok(await page.locator('[data-aibiz-api-results] a').count());
      assert.equal(faults, 1); row.controlledUiFaults = faults; row.realApiNegativeAcceptance = false;
      noRawErrors(row); row.status = 'PASS';
    } finally { await context.close(); }
    report.status = 'PASS-SHARED-STATIC-DOCUMENTATION-HOST-EMBEDDING-AND-API-PENDING';
  } catch (error) { report.failure = { type: error.name, message: error.message }; }
  finally {
    if (browser) await browser.close();
    report.runtimeAfter = inspect(); report.runtimeUnchanged = JSON.stringify(report.runtimeAfter) === JSON.stringify(report.runtimeBefore);
    if (!report.runtimeUnchanged) report.status = 'FAILED-RUNTIME-DRIFT';
    report.sourceUnchanged = hash(fs.readFileSync(fileURLToPath(import.meta.url))) === report.sourceSha256;
    report.sourceBindingsUnchanged = report.sourceBindings.every(item =>
      hash(fs.readFileSync(path.join(workspace, item.path))) === item.sha256 &&
      hash(privateRead(path.join(output, item.snapshot))) === item.sha256);
    if (!report.sourceBindingsUnchanged) report.status = 'FAILED-PROBE-INPUT-DRIFT';
    if (!report.sourceUnchanged) report.status = 'FAILED-PROBE-SOURCE-DRIFT';
    report.finishedAt = new Date().toISOString();
    fs.writeFileSync(path.join(output, 'report.private.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { plan: { type: 'string' }, 'plan-sha256': { type: 'string' },
    apply: { type: 'string' }, 'apply-sha256': { type: 'string' }, output: { type: 'string' } }, strict: true });
  probeExistingHostApiDocumentation({ plan: values.plan, planSha256: values['plan-sha256'],
    apply: values.apply, applySha256: values['apply-sha256'], output: values.output })
    .then(report => {
      console.log(JSON.stringify({ status: report.status, cells: report.staticCells.map(row => row.status),
        recovery: report.recovery?.status, runtimeUnchanged: report.runtimeUnchanged, parentAcceptance: false }));
      if (!report.status.startsWith('PASS-')) process.exitCode = 1;
    }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
