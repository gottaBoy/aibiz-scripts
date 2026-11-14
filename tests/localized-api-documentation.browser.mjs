import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { buildApiReferenceFiles } from '../../plm/doc/tools/api-reference.mjs';
import { launchChromium } from '../browser-launch.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(join(root, 'ibiz-app-hub/package.json'));
const ts = require('typescript');
const { chromium } = require('playwright');
const sourceDirectory = join(root, 'plm/doc/docsify');
const output = join(root, `.artifacts/localized-api-docs-browser/probe-${randomUUID()}`);
const source = await readFile(join(root, 'modelingweb/app/vite-plugins/local-documentation.ts'), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
}).outputText;
const { documentationMiddleware } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const generated = await buildApiReferenceFiles({ sourceDirectory });
const search = JSON.parse(generated.get('api-reference/en/search.json'));
const method = search.entries.find(entry => entry.path.startsWith('#/api-reference/en/entities/article_page?id=op-'));
assert.ok(method);
const marker = method.path.split('?id=')[1];

test('actual local Docsify supports bilingual API deep links, search anchors and Data Model isolation',
  { timeout: 120_000 }, async t => {
    const report = { contract: 'localized-api-docs-browser-v1', status: 'FAILED',
      nativeApplicationAcceptance: false, apiExecutionAcceptance: false, remoteTranslation: false, cases: [] };
    await mkdir(output, { recursive: true });
    t.after(async () => {
      report.status = report.cases.length === 4 && report.cases.every(row => row.status === 'PASS') ? 'PASS' : 'FAILED';
      await writeFile(join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
      console.log(`Localized API reference browser report: ${output}/report.json`);
    });
    const middleware = documentationMiddleware(sourceDirectory, ['/doc/', '/modeldesign/doc/'], async () => generated);
    const server = createServer((req, res) => {
      void middleware(req, res, () => { res.statusCode = 404; res.end(); });
    });
    t.after(() => new Promise(done => { server.close(done); server.closeAllConnections(); }));
    await new Promise(done => server.listen(0, '127.0.0.1', done));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const browser = await launchChromium(chromium);
    t.after(() => browser.close());
    for (const locale of ['zh-CN', 'en-US']) for (const [name, viewport] of [
      ['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }],
    ]) {
      await t.test(`${locale}/${name}`, async () => {
        const row = { locale, viewport: name, status: 'FAILED', errors: [], nonlocalRequests: [], failures: [], httpFailures: [] };
        report.cases.push(row);
        const context = await browser.newContext({ locale, viewport, serviceWorkers: 'block' });
        try {
          await context.addInitScript(language => localStorage.setItem('language', language), locale);
          await context.route('**/*', route => {
            if (new URL(route.request().url()).origin === origin) return route.continue();
            row.nonlocalRequests.push(route.request().url()); return route.abort();
          });
          const page = await context.newPage();
          page.on('pageerror', error => row.errors.push({ type: 'pageerror', message: error.message }));
          page.on('console', message => {
            if (message.type() === 'error') row.errors.push({ type: 'console', message: message.text() });
          });
          page.on('requestfailed', request => row.failures.push({ url: request.url(), error: request.failure()?.errorText }));
          page.on('response', response => {
            if (response.status() >= 400) row.httpFailures.push({ url: response.url(), status: response.status() });
          });
          const language = locale === 'en-US' ? 'en' : 'zh-CN';
          const base = `${origin}/${name === 'desktop' ? 'doc' : 'modeldesign/doc'}/`;
          await page.goto(`${base}#/api/ServiceAPI/deapi/article_page`);
          await page.waitForFunction(expected => location.hash === `#/api-reference/${expected}/entities/article_page`, language);
          await page.waitForFunction(() => document.querySelector('[data-aibiz-api-search]')?.disabled === false);
          assert.equal(await page.title(), language === 'en' ? 'Service API Reference' : '服务接口参考');
          assert.equal(await page.locator('.app-name-link').innerText(), language === 'en' ? 'Service API Reference' : '服务接口参考');
          const openSidebar = async () => {
            if (name !== 'mobile') return;
            const input = page.locator('[data-aibiz-api-search]');
            const actionable = await input.evaluate(element => {
              const rect = element.getBoundingClientRect();
              return rect.left >= 0 && rect.right <= innerWidth;
            });
            if (!actionable) await page.locator('.sidebar-toggle').click();
          };
          await openSidebar();
          const input = page.getByRole('searchbox', { name: language === 'en' ? 'Search API reference' : '搜索接口参考' });
          await input.fill('article_page');
          const methodLink = page.locator(`[data-aibiz-api-results] a[href="${method.path.replace('/en/', `/${language}/`)}"]`);
          await methodLink.click();
          await page.waitForFunction(id => Boolean(document.getElementById(id)), marker);
          assert.ok(page.url().includes(`?id=${marker}`));
          await page.reload();
          await page.waitForFunction(id => Boolean(document.getElementById(id)), marker);
          assert.ok(page.url().includes(`?id=${marker}`), 'Method links remain addressable after reload');
          const other = language === 'en' ? 'zh-CN' : 'en';
          await openSidebar();
          const switcher = page.locator('[data-aibiz-api-panel] nav')
            .getByRole('link', { name: other === 'en' ? 'English' : '中文', exact: true });
          await switcher.click();
          await page.waitForFunction(({ other, marker }) =>
            location.hash === `#/api-reference/${other}/entities/article_page?id=${marker}` &&
            Boolean(document.getElementById(marker)) &&
            document.title === (other === 'en' ? 'Service API Reference' : '服务接口参考'), { other, marker });
          assert.equal(await page.title(), other === 'en' ? 'Service API Reference' : '服务接口参考');
          if (name === 'mobile') {
            await openSidebar();
            await page.screenshot({ path: join(output, `${locale}-${name}-sidebar.png`), fullPage: false });
            await page.locator('.sidebar-toggle').click();
          }
          await page.locator(`[id="${marker}"]`).scrollIntoViewIfNeeded();
          row.geometry = await page.locator('.markdown-section').evaluate((element, marker) => {
            const rect = element.getBoundingClientRect();
            const heading = document.getElementById(marker).getBoundingClientRect();
            return { left: rect.left, right: rect.right, top: rect.top,
              headingTop: heading.top, headingBottom: heading.bottom,
              viewportWidth: innerWidth, viewportHeight: innerHeight,
              horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
              sidebarPosition: getComputedStyle(document.querySelector('.sidebar')).position };
          }, marker);
          assert.ok(row.geometry.left >= 0 && row.geometry.right <= row.geometry.viewportWidth + 1);
          assert.equal(row.geometry.horizontalOverflow, false);
          assert.ok(row.geometry.headingTop >= 0 && row.geometry.headingBottom <= row.geometry.viewportHeight);
          assert.equal(row.geometry.sidebarPosition, 'fixed');
          await page.screenshot({ path: join(output, `${locale}-${name}-api.png`), fullPage: false });
          if (other === 'en') {
            const text = await page.locator('.markdown-section').evaluate(element => {
              const copy = element.cloneNode(true);
              copy.querySelectorAll('code').forEach(node => node.remove());
              copy.querySelectorAll('a').forEach(node => {
                if (node.textContent.trim() === '中文' &&
                    new URL(node.href, location.href).hash.startsWith('#/api-reference/zh-CN/')) node.remove();
              });
              return copy.textContent;
            });
            assert.deepEqual([...new Set(text.match(/[\u3400-\u9fff]+/g) || [])], [],
              'English human text excludes only language selectors and unchanged protocol identifiers');
          }
          const schemaLink = page.locator('.markdown-section td a[href*="?id=dto-"]').first();
          const schemaHref = await schemaLink.getAttribute('href');
          assert.match(schemaHref, new RegExp(`^#/api-reference/${other}/entities/[a-zA-Z_][a-zA-Z0-9_-]*\\?id=dto-[a-f0-9]{16}$`));
          const schemaMarker = schemaHref.split('?id=')[1];
          await schemaLink.click();
          await page.waitForFunction(({ href, marker }) => {
            const heading = document.getElementById(marker);
            if (location.hash !== href || !heading) return false;
            const rect = heading.getBoundingClientRect();
            return rect.top >= 0 && rect.bottom <= innerHeight;
          }, { href: schemaHref, marker: schemaMarker });
          await page.reload();
          await page.waitForFunction(({ href, marker }) =>
            location.hash === href && Boolean(document.getElementById(marker)),
          { href: schemaHref, marker: schemaMarker });
          await openSidebar();
          const schemaSwitch = page.locator('[data-aibiz-api-panel] nav')
            .getByRole('link', { name: language === 'en' ? 'English' : '中文', exact: true });
          await page.waitForFunction(({ marker, language }) =>
            document.querySelector(`[data-aibiz-api-panel] a[href^="#/api-reference/${language}/"]`)?.hash.endsWith(`?id=${marker}`),
          { marker: schemaMarker, language });
          await schemaSwitch.click();
          await page.waitForFunction(({ marker, language }) =>
            location.hash.includes(`/api-reference/${language}/`) &&
            location.hash.endsWith(`?id=${marker}`) && Boolean(document.getElementById(marker)),
          { marker: schemaMarker, language });
          row.dtoAnchor = schemaMarker;
          await page.locator('.markdown-section p')
            .getByRole('link', { name: other === 'en' ? 'English' : '中文', exact: true }).first().click();
          await page.waitForFunction(other =>
            location.hash === `#/api-reference/${other}/entities/article_page`, other);
          await page.goto(`${base}?language=en#/api/ServiceAPI/ServiceAPI`);
          await page.waitForFunction(() => location.hash === '#/api-reference/en/ServiceAPI' &&
            document.title === 'Service API Reference');
          assert.match(await page.locator('.markdown-section h1').innerText(), /^Service API(?:: ServiceAPI)?$/);
          await page.locator('.markdown-section td a[href$="/entities/article_page"]').click();
          await page.waitForFunction(() => location.hash === '#/api-reference/en/entities/article_page' &&
            document.querySelector('.markdown-section h1')?.textContent.includes('(article_page)'));
          await page.goto(`${base}#/api/ServiceAPI/deapi/comment#comment`);
          await page.waitForFunction(() => location.hash.endsWith('/entities/comment') &&
            document.querySelector('.markdown-section h1')?.textContent.includes('(comment)'));
          assert.equal(new URL(page.url()).hash, `#/api-reference/${language}/entities/comment`,
            'Old entity anchors intentionally fall back to the new entity page');
          await page.goto(`${base}#/`);
          await page.getByRole('heading', { name: '产品生命周期管理系统', exact: true }).waitFor();
          assert.equal(await page.title(), '产品生命周期管理系统文档');
          assert.equal(await page.locator('[data-aibiz-api-panel]').count(), 0);
          assert.equal(await page.locator('.app-name-link').innerText(), '技术文档');
          row.locationAfterDataModel = new URL(page.url()).hash;
          assert.equal(row.locationAfterDataModel, '#/');
          assert.deepEqual(row.nonlocalRequests, [], 'No external request may be attempted');
          assert.deepEqual(row.errors, []);
          assert.deepEqual(row.failures, []);
          assert.deepEqual(row.httpFailures, []);
          row.status = 'PASS';
        } finally { await context.close(); }
      });
    }
  });
