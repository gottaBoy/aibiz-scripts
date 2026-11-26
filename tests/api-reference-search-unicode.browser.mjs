import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { launchChromium } from '../browser-launch.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(join(root, 'ibiz-app-hub/package.json'));
const { chromium } = require('playwright');
const ts = require('typescript');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const output = join(root, `.artifacts/documentation-unicode-browser/probe-${randomUUID()}`);
const sourcePaths = [
  'plm/doc/docsify/index.html', 'plm/doc/docsify/script/aibiz-api-reference.js',
  'plm/doc/docsify/script/docsify.js', 'plm/doc/docsify/script/docsify-plugin-table-fixed.js',
  'plm/doc/docsify/css/local-theme.css', 'plm/doc/docsify/css/main.css',
  'modelingweb/app/vite-plugins/local-documentation.ts',
  'scripts/tests/api-reference-search-unicode.browser.mjs', 'scripts/browser-launch.mjs',
];
const sources = await Promise.all(sourcePaths.map(async path => ({ path, bytes: await readFile(join(root, path)) })));
const middlewareSource = sources.find(source => source.path.endsWith('local-documentation.ts'));
const compiled = ts.transpileModule(middlewareSource.bytes.toString(), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const { documentationMiddleware } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const cases = [
  { code: 'nfkc_expansion', body: `${'ﬃ'.repeat(100)} needle ${'x'.repeat(250)}`, term: 'needle nfkc_expansion', original: 'ﬃ' },
  { code: 'combining_contraction', body: `${'e\u0301'.repeat(200)} needle ${'x'.repeat(250)}`, term: 'needle combining_contraction', original: 'e\u0301' },
  { code: 'lowercase_expansion', body: `${'İ'.repeat(150)} needle ${'x'.repeat(250)}`, term: 'needle lowercase_expansion', original: 'İ' },
  ...['🙂', '👩🏽‍💻', 'e\u0301'].map((grapheme, index) => ({
    code: `grapheme_${index}`, body: `${'x'.repeat(179)}${grapheme}suffix`,
    term: `grapheme_${index}`, expected: `${'x'.repeat(179)}${grapheme}…`,
  })),
  { code: 'short_fallback', body: '🙂 e\u0301 👩🏽‍💻', term: 'short_fallback' },
];
const marker = 'fields-1234567890abcdef';

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

test('actual local Docsify preserves Unicode snippet positions and graphemes on desktop and mobile', { timeout: 90_000 }, async t => {
  await mkdir(output, { recursive: true, mode: 0o700 });
  const candidate = join(output, 'candidate');
  const report = { contract: 'api-reference-unicode-browser-v1', status: 'FAILED',
    controlledDocumentationFixture: true, nativeApplicationAcceptance: false,
    apiExecutionAcceptance: false, cases: [] };
  t.after(async () => {
    report.sourceAfter = await Promise.all(sources.map(async source => ({
      path: source.path, sha256: digest(await readFile(join(root, source.path))),
      unchanged: digest(await readFile(join(root, source.path))) === digest(source.bytes),
    })));
    report.sourceInputsUnchanged = report.sourceAfter.every(source => source.unchanged);
    report.status = report.cases.length === 8 && report.cases.every(row => row.status === 'PASS') &&
      report.sourceInputsUnchanged ? 'PASS' : 'FAILED';
    await writeFile(join(output, 'report.private.json'), `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    console.log(`Unicode API search browser report: ${output}/report.private.json`);
    assert.equal(report.sourceInputsUnchanged, true);
  });
  report.sources = [];
  for (const [index, source] of sources.entries()) {
    const snapshot = `source/${index}-${source.path.split('/').at(-1)}`;
    await mkdir(dirname(join(output, snapshot)), { recursive: true, mode: 0o700 });
    await writeFile(join(output, snapshot), source.bytes, { mode: 0o600, flag: 'wx' });
    report.sources.push({ path: source.path, snapshot, sha256: digest(source.bytes) });
    if (source.path.startsWith('plm/doc/docsify/')) {
      const target = join(candidate, source.path.slice('plm/doc/docsify/'.length));
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await writeFile(target, source.bytes, { mode: 0o600, flag: 'wx' });
    }
  }
  for (const language of ['en', 'zh-CN']) {
    const page = `# ${language === 'en' ? 'Unicode search fixture' : 'Unicode 搜索测试'}\n\n## Details :id=${marker}\n\nFixture content.\n`;
    const entries = cases.map(item => ({ label: item.code, code: item.code, keywords: item.code,
      body: item.body, path: `#/api-reference/${language}/entities/unicode_fixture?id=${marker}` }));
    for (const [name, value] of [
      ['entities/unicode_fixture.md', page],
      ['_sidebar.md', `- [Unicode](#/api-reference/${language}/entities/unicode_fixture)\n`],
      ['search.json', JSON.stringify({ schemaVersion: 2, language, contractSha256: digest(JSON.stringify(entries)), entries })],
    ]) {
      const target = join(candidate, 'api-reference', language, name);
      await mkdir(dirname(target), { recursive: true, mode: 0o700 });
      await writeFile(target, value, { mode: 0o600, flag: 'wx' });
    }
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
  ]) for (const [language, fallback] of [['en', false], ['zh-CN', false], ['en', true], ['en', 'missing-intl']]) {
    const fallbackSuffix = fallback === 'missing-intl' ? '-no-Intl' : fallback ? '-no-Segmenter' : '';
    await t.test(`${viewportName}/${language}${fallbackSuffix}`, async () => {
      const row = { viewport: viewportName, language, fallback, status: 'FAILED', errors: [], failures: [], httpFailures: [], externalRequests: [], snippets: [] };
      report.cases.push(row);
      const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
      try {
        if (fallback) await context.addInitScript(mode => {
          if (mode === 'missing-intl') globalThis.Intl = undefined;
          else Intl.Segmenter = undefined;
        }, fallback);
        await context.route('**/*', route => {
          if (new URL(route.request().url()).origin === origin) return route.continue();
          row.externalRequests.push(route.request().url());
          return route.abort();
        });
        const page = await context.newPage();
        page.on('pageerror', error => row.errors.push(error.message));
        page.on('console', message => { if (message.type() === 'error') row.errors.push(message.text()); });
        page.on('requestfailed', request => row.failures.push(request.url()));
        page.on('response', response => { if (response.status() >= 400) row.httpFailures.push({ path: new URL(response.url()).pathname, status: response.status() }); });
        await page.goto(`${origin}/doc/#/api-reference/${language}/entities/unicode_fixture`);
        await page.waitForFunction(() => document.querySelector('[data-aibiz-api-search]')?.disabled === false);
        await openSidebar(page, viewportName === 'mobile');
        const input = page.locator('[data-aibiz-api-search]');
        for (const item of cases) {
          await input.fill(item.term);
          const result = page.locator('[data-aibiz-api-results] li');
          assert.equal(await result.count(), 1);
          const preview = result.locator('.aibiz-api-search-snippet');
          const snippet = await preview.count() ? await preview.textContent() : null;
          if (fallback && item.body.length > 180) assert.equal(snippet, null);
          else if (fallback) assert.equal(snippet, item.body);
          else if (item.expected) assert.equal(snippet, item.expected);
          else if (item.original) {
            assert.ok(snippet.includes('needle'));
            assert.ok(snippet.includes(item.original), 'Source display remains unnormalized');
          } else assert.equal(snippet, item.body);
          if (snippet !== null) assert.equal(snippet.isWellFormed(), true);
          row.snippets.push({ code: item.code, displayed: snippet !== null, exact: true, sha256: snippet === null ? null : digest(snippet) });
          if (item.code === 'grapheme_1') {
            await page.screenshot({ path: join(output, `${viewportName}-${language}${fallbackSuffix}-grapheme.png`) });
          }
        }
        const before = new URL(page.url()).hash;
        await input.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
        assert.equal(new URL(page.url()).hash, before);
        await input.press('Enter');
        await page.waitForFunction(marker => location.hash.endsWith(`?id=${marker}`) && Boolean(document.getElementById(marker)), marker);
        await page.reload();
        await page.waitForFunction(() => document.querySelector('[data-aibiz-api-search]')?.disabled === false);
        await openSidebar(page, viewportName === 'mobile');
        assert.equal(await input.inputValue(), cases.at(-1).term);
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        await page.screenshot({ path: join(output, `${viewportName}-${language}${fallbackSuffix}.png`) });
        assert.deepEqual(row.errors, []);
        assert.deepEqual(row.failures, []);
        assert.deepEqual(row.httpFailures, []);
        assert.deepEqual(row.externalRequests, []);
        row.status = 'PASS';
      } finally { await context.close(); }
    });
  }
});
