import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { launchChromium } from '../browser-launch.mjs';
import { renderedSearchFixture } from './api-reference-search-fixture.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(join(root, 'ibiz-app-hub/package.json'));
const { chromium } = require('playwright');
const ts = require('typescript');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const output = join(root, `.artifacts/documentation-rendered-search/probe-${randomUUID()}`);
const paths = [
  'plm/doc/docsify/index.html', 'plm/doc/docsify/script/aibiz-api-reference.js',
  'plm/doc/docsify/script/docsify.js', 'plm/doc/docsify/script/docsify-plugin-table-fixed.js',
  'plm/doc/docsify/css/local-theme.css', 'plm/doc/docsify/css/main.css',
  'plm/doc/tools/api-reference.mjs', 'plm/doc/tools/api-reference-dto.mjs',
  'plm/doc/tools/api-reference-logic.mjs', 'modelingweb/app/vite-plugins/local-documentation.ts',
  'scripts/tests/api-reference-rendered-search.browser.mjs',
  'scripts/tests/api-reference-search-fixture.mjs', 'scripts/browser-launch.mjs',
];
const sources = await Promise.all(paths.map(async path => ({ path, bytes: await readFile(join(root, path)) })));
const compiled = ts.transpileModule(sources.find(item => item.path.endsWith('local-documentation.ts')).bytes.toString(), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const { documentationMiddleware } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);

test('actual Docsify searches the visible text of authority-generated DTO labels and literal formats', { timeout: 90_000 }, async t => {
  await mkdir(output, { recursive: true, mode: 0o700 });
  const report = { contract: 'api-reference-rendered-search-browser-v1', status: 'FAILED',
    controlledSourceModelFixture: true, apiExecutionAcceptance: false, nativeApplicationAcceptance: false,
    cases: [], sources: [], generated: [] };
  t.after(async () => {
    report.sourceAfter = await Promise.all(sources.map(async item => ({
      path: item.path, unchanged: hash(await readFile(join(root, item.path))) === hash(item.bytes),
    })));
    report.inputsUnchanged = report.sourceAfter.every(item => item.unchanged);
    report.status = report.cases.length === 4 && report.cases.every(row => row.status === 'PASS') &&
      report.inputsUnchanged ? 'PASS' : 'FAILED';
    await writeFile(join(output, 'report.private.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    console.log(`Rendered API search browser report: ${output}/report.private.json`);
  });
  const candidate = join(output, 'candidate');
  for (const [index, item] of sources.entries()) {
    const snapshot = `source/${index}-${item.path.split('/').at(-1)}`;
    await mkdir(dirname(join(output, snapshot)), { recursive: true, mode: 0o700 });
    await writeFile(join(output, snapshot), item.bytes, { mode: 0o600, flag: 'wx' });
    report.sources.push({ path: item.path, snapshot, sha256: hash(item.bytes) });
    if (item.path.startsWith('plm/doc/docsify/')) {
      const target = join(candidate, item.path.slice('plm/doc/docsify/'.length));
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await writeFile(target, item.bytes, { mode: 0o600, flag: 'wx' });
    }
  }
  const fixture = renderedSearchFixture();
  assert.deepEqual(renderedSearchFixture().files, fixture.files);
  for (const [path, bytes] of fixture.files) {
    const target = join(candidate, path);
    await mkdir(dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, bytes, { mode: 0o600, flag: 'wx' });
    report.generated.push({ path, sha256: hash(bytes) });
  }
  for (const language of ['en', 'zh-CN']) {
    const search = JSON.parse(fixture.files.get(`api-reference/${language}/search.json`));
    const dto = search.entries.find(entry => entry.code === 'rendered_dto');
    const markdown = fixture.files.get(`api-reference/${language}/entities/rendered_fixture.md`).toString();
    assert.ok(markdown.includes(dto.body), 'Raw search evidence remains an exact generated section');
    assert.ok(dto.body.includes('<code>') && dto.body.includes('&#38;'));
  }
  const middleware = documentationMiddleware(candidate, ['/doc/']);
  const server = createServer((request, response) => {
    void middleware(request, response, () => { response.statusCode = 404; response.end(); });
  });
  t.after(() => new Promise(resolve => { server.close(resolve); server.closeAllConnections(); }));
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await launchChromium(chromium);
  t.after(() => browser.close());
  for (const [viewportName, viewport] of [
    ['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }],
  ]) for (const language of ['zh-CN', 'en']) await t.test(`${language}/${viewportName}`, async () => {
    const row = { language, viewport: viewportName, status: 'FAILED', errors: [], failures: [], httpFailures: [], externalRequests: [], requests: [], queries: [] };
    report.cases.push(row);
    const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
    try {
      await context.route('**/*', route => {
        if (new URL(route.request().url()).origin === origin) return route.continue();
        row.externalRequests.push(route.request().url()); return route.abort();
      });
      const page = await context.newPage();
      page.on('request', request => row.requests.push(new URL(request.url()).pathname));
      page.on('pageerror', error => row.errors.push(error.message));
      page.on('console', message => { if (message.type() === 'error') row.errors.push(message.text()); });
      page.on('requestfailed', request => row.failures.push(request.url()));
      page.on('response', response => { if (response.status() >= 400) row.httpFailures.push({ path: new URL(response.url()).pathname, status: response.status() }); });
      const base = `${origin}/doc/`;
      await page.goto(`${base}#/api-reference/${language}/entities/rendered_fixture?id=${fixture.anchor}`);
      await page.waitForFunction(() => document.querySelector('[data-aibiz-api-search]')?.disabled === false);
      const rowLabel = language === 'en' ? fixture.englishLabel : fixture.label;
      const fieldRow = page.locator('.markdown-section tr').filter({ hasText: fixture.format });
      assert.equal(await fieldRow.count(), 1);
      assert.equal(await fieldRow.locator('td').nth(1).textContent(), rowLabel);
      assert.equal(await fieldRow.locator('td').last().locator('code').textContent(), fixture.format);
      assert.equal(await page.locator('.markdown-section img, .markdown-section script').count(), 0);
      if (viewportName === 'mobile') {
        await page.locator('.sidebar-toggle').click();
        await page.waitForFunction(() => document.querySelector('.sidebar').getBoundingClientRect().left >= -1);
      }
      const input = page.locator('[data-aibiz-api-search]');
      await input.scrollIntoViewIfNeeded();
      for (const term of [
        'alpha&beta|gamma', '`code`', '**stars**', '_under_', '[brackets]', 'src="/never-load.png"',
        ...(language === 'en' ? ['<rendered-label>'] : []),
      ]) {
        await input.fill(term);
        const match = page.locator(`[data-aibiz-api-results] a[href="#/api-reference/${language}/entities/rendered_fixture?id=${fixture.anchor}"]`);
        assert.equal(await match.count(), 1, `The rendered DTO must be found for visible query ${term}`);
        const preview = await match.locator('..').locator('.aibiz-api-search-snippet').textContent();
        assert.ok(preview.includes(term), `The plain-text preview must retain visible ${term}`);
        assert.doesNotMatch(preview, /<code>|&#(?:38|124|96);|&amp;/);
        assert.equal(await page.locator('[data-aibiz-api-results] img, [data-aibiz-api-results] script').count(), 0);
        assert.equal(await page.evaluate(() => window.renderedSearchSideEffect), undefined);
        row.queries.push({ term, exactVisibleMatch: true, previewSha256: hash(preview) });
      }
      await page.screenshot({ path: join(output, `${language}-${viewportName}.png`) });
      await input.fill('alpha&beta|gamma');
      await input.press('Enter');
      await page.waitForFunction(anchor => location.hash.endsWith(`?id=${anchor}`), fixture.anchor);
      await page.reload();
      await page.waitForFunction(() => document.querySelector('[data-aibiz-api-search]')?.disabled === false);
      assert.equal(await input.inputValue(), 'alpha&beta|gamma');
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      assert.deepEqual(row.errors, []);
      assert.deepEqual(row.failures, []);
      assert.deepEqual(row.httpFailures, []);
      assert.deepEqual(row.externalRequests, []);
      assert.equal(row.requests.includes('/never-load.png'), false);
      row.extractionRemainedInert = true;
      row.status = 'PASS';
    } finally { await context.close(); }
  });
});
