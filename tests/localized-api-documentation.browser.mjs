import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
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
const { documentationMiddleware, publishDocumentation } = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const generated = await buildApiReferenceFiles({ sourceDirectory });
const search = JSON.parse(generated.get('api-reference/en/search.json'));
const method = search.entries.find(entry => entry.path.startsWith('#/api-reference/en/entities/article_page?id=op-'));
assert.ok(method);
const marker = method.path.split('?id=')[1];
const scoreMethod = search.entries.find(entry => entry.code === 'get_customer_score' &&
  entry.path.startsWith('#/api-reference/en/entities/idea?id=op-'));
assert.ok(scoreMethod);
const fieldEntry = search.entries.find(entry => entry.code === 'article_page' && entry.path.includes('?id=fields-'));
assert.ok(fieldEntry && fieldEntry.body.includes('Access Password'));

async function openMobileSidebar(page) {
  if (!await page.locator('body').evaluate(element => element.classList.contains('close'))) {
    await page.locator('.sidebar-toggle').click();
  }
  await page.waitForFunction(() => {
    const sidebar = document.querySelector('.sidebar').getBoundingClientRect();
    return sidebar.left >= -1 && sidebar.right <= innerWidth + 1;
  });
  await page.locator('[data-aibiz-api-search]').scrollIntoViewIfNeeded();
}

test('actual local Docsify supports bilingual API deep links, search anchors and Data Model isolation',
  { timeout: 120_000 }, async t => {
    const report = { contract: 'localized-api-docs-browser-v1', status: 'FAILED',
      nativeApplicationAcceptance: false, apiExecutionAcceptance: false, remoteTranslation: false, cases: [] };
    await mkdir(output, { recursive: true });
    t.after(async () => {
      report.status = report.cases.length === 4 && report.cases.every(row => row.status === 'PASS') &&
        report.searchStateRecovery?.status === 'PASS' ? 'PASS' : 'FAILED';
      await writeFile(join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
      console.log(`Localized API reference browser report: ${output}/report.json`);
    });
    assert.deepEqual(await buildApiReferenceFiles({ sourceDirectory }), generated,
      'The private document candidate must be reproducible from unchanged current inputs');
    const candidate = join(output, 'candidate');
    await publishDocumentation(sourceDirectory, candidate, async () => generated);
    for (const [path, bytes] of generated) assert.deepEqual(await readFile(join(candidate, path)), bytes);
    report.candidate = { path: candidate, generatedFiles: generated.size,
      manifestSha256: createHash('sha256').update(generated.get('api-reference/manifest.json')).digest('hex'),
      sourceInputs: JSON.parse(generated.get('api-reference/manifest.json')).inputHashes,
      assets: await Promise.all(['index.html', 'script/aibiz-api-reference.js', 'script/docsify.js', 'css/local-theme.css']
        .map(async path => ({ path, sha256: createHash('sha256').update(await readFile(join(candidate, path))).digest('hex') }))) };
    const middleware = documentationMiddleware(candidate, ['/doc/', '/modeldesign/doc/']);
    let searchFault = null;
    const server = createServer((req, res) => {
      if (searchFault && req.url.split('?')[0] === '/doc/api-reference/en/search.json') {
        if (searchFault.kind === 'hold') {
          const resolve = searchFault.resolve;
          searchFault = null;
          resolve(() => { void middleware(req, res, () => { res.statusCode = 404; res.end(); }); });
          return;
        }
        searchFault = null;
        res.setHeader('content-type', 'application/json');
        res.end('{"schemaVersion":2,"language":"en","entries":"invalid-negative-control"}');
        return;
      }
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
            await openMobileSidebar(page);
          };
          await openSidebar();
          const input = page.getByRole('searchbox', { name: language === 'en' ? 'Search API reference' : '搜索接口参考' });
          await input.fill('__no_matching_reference_20261122__');
          await page.getByRole('status').filter({ hasText: language === 'en' ? 'No results' : '未找到结果' }).waitFor();
          assert.equal(await page.locator('[data-aibiz-api-results] a').count(), 0);
          await input.fill('  ');
          await page.getByRole('status').filter({ hasText: language === 'en' ? 'reference entries' : '条参考条目' }).waitFor();
          assert.equal(await page.locator('[data-aibiz-api-results] a').count(), 0);
          await input.fill('article_page');
          row.compositionKeyboard = await input.evaluate(element => {
            const before = location.hash;
            const results = [];
            const dispatch = (mode, init) => {
              const event = new KeyboardEvent('keydown', {
                key: 'Enter', bubbles: true, cancelable: true, ...init,
              });
              element.dispatchEvent(event);
              results.push({ mode, defaultPrevented: event.defaultPrevented, routeUnchanged: location.hash === before });
            };
            element.dispatchEvent(new CompositionEvent('compositionstart', { data: '输入' }));
            dispatch('composition-lifecycle', {});
            element.dispatchEvent(new CompositionEvent('compositionend', { data: '输入' }));
            dispatch('isComposing', { isComposing: true });
            dispatch('legacy-keycode', { keyCode: 229 });
            return { controlledDomEvents: true, operatingSystemIMEVerified: false, results };
          });
          assert.ok(row.compositionKeyboard.results.every(result => result.routeUnchanged && !result.defaultPrevented),
            'IME confirmation remains in the search field instead of opening a result');
          await input.fill('customer_score_precent get_customer_score');
          const firstResultPath = await page.locator('[data-aibiz-api-results] a').first().getAttribute('href');
          assert.notEqual(firstResultPath, new URL(page.url()).hash);
          await input.press('Enter');
          await page.waitForFunction(expected => location.hash === expected, firstResultPath);
          await page.waitForFunction(() => document.querySelector('[data-aibiz-api-search]')?.disabled === false);
          row.compositionKeyboard.normalEnterNavigated = true;
          await openSidebar();
          await input.fill('article_page');
          const methodLink = page.locator(`[data-aibiz-api-results] a[href="${method.path.replace('/en/', `/${language}/`)}"]`);
          await methodLink.click();
          await page.waitForFunction(id => Boolean(document.getElementById(id)), marker);
          assert.ok(page.url().includes(`?id=${marker}`));
          await page.reload();
          await page.waitForFunction(id => Boolean(document.getElementById(id)), marker);
          await page.waitForFunction(() => document.querySelector('[data-aibiz-api-search]')?.disabled === false);
          assert.equal(await page.locator('[data-aibiz-api-search]').inputValue(), 'article_page',
            'Search query survives normal result navigation and reload in the same tab');
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
            assert.equal(await page.locator('.sidebar').evaluate(element => element.scrollWidth > element.clientWidth), false);
            await page.screenshot({ path: join(output, `${locale}-${name}-sidebar.png`), fullPage: false });
            await page.locator('.sidebar-toggle').click();
            await page.waitForFunction(() => document.querySelector('.sidebar').getBoundingClientRect().right <= 1);
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
          await page.waitForFunction(() => document.querySelector('[data-aibiz-api-search]')?.disabled === false);
          await openSidebar();
          const fieldTerm = language === 'en' ? 'Access Password' : '访问密码';
          await page.locator('[data-aibiz-api-search]').fill(fieldTerm);
          const fieldPath = fieldEntry.path.replace('/en/', `/${language}/`);
          const fieldMarker = fieldPath.split('?id=')[1];
          await page.locator(`[data-aibiz-api-results] a[href="${fieldPath}"]`).click();
          await page.waitForFunction(marker => Boolean(document.getElementById(marker)), fieldMarker);
          await page.reload();
          await page.waitForFunction(marker => Boolean(document.getElementById(marker)), fieldMarker);
          await page.waitForFunction(() => document.querySelector('[data-aibiz-api-search]')?.disabled === false);
          assert.equal(await page.locator('[data-aibiz-api-search]').inputValue(), fieldTerm);
          assert.equal(new URL(page.url()).hash, fieldPath);
          row.fullTextFieldAnchor = fieldMarker;
          await page.locator('.markdown-section p')
            .getByRole('link', { name: other === 'en' ? 'English' : '中文', exact: true }).first().click();
          await page.waitForFunction(other =>
            location.hash === `#/api-reference/${other}/entities/article_page`, other);
          const scorePath = scoreMethod.path.replace('/en/', `/${language}/`);
          await page.goto(`${base}?language=${language}${scorePath}`);
          await page.waitForFunction(() => document.querySelector('[data-aibiz-api-search]')?.disabled === false);
          await openSidebar();
          await page.locator('[data-aibiz-api-search]').fill('customer_score_precent get_customer_score');
          const scoreResult = page.locator(`[data-aibiz-api-results] a[href="${scorePath}"]`);
          await scoreResult.waitFor();
          assert.match(await scoreResult.locator('..').innerText(), /customer_score_precent/);
          await scoreResult.click();
          await page.locator('.markdown-section h4').filter({ hasText: language === 'en'
            ? 'Logic-Defined Response Fields (Not DTO Declarations)'
            : '逻辑输出字段（不是 DTO 声明）' }).first().waitFor();
          const scoreContent = await page.locator('.markdown-section').innerText();
          assert.equal((scoreContent.match(/customer_score_precent/g) ?? []).length, 2);
          assert.doesNotMatch(scoreContent, /customer_score_percent/);
          assert.match(scoreContent, /dto-fields-not-declared/);
          assert.match(scoreContent, /PSDELOGICS\/get_customer_score\.json/);
          await page.reload();
          const scoreHeading = page.locator('.markdown-section h4').filter({ hasText: language === 'en'
            ? 'Logic-Defined Response Fields (Not DTO Declarations)'
            : '逻辑输出字段（不是 DTO 声明）' }).first();
          await scoreHeading.waitFor();
          await scoreHeading.scrollIntoViewIfNeeded();
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
          if (language === 'en') {
            const lineCounts = await page.locator('.markdown-section td').evaluateAll(cells =>
              cells.filter(cell => cell.textContent.trim() === 'Unspecified').map(cell => {
                const range = document.createRange();
                range.selectNodeContents(cell);
                return range.getClientRects().length;
              }));
            assert.ok(lineCounts.length >= 4);
            assert.ok(lineCounts.every(count => count === 1), 'Unspecified must remain a complete word inside the scrollable table');
          }
          await page.screenshot({ path: join(output, `${locale}-${name}-logic-fields.png`), fullPage: false });
          await page.goto(`${base}?language=${language}#/api-reference/${language}/entities/view_theme_setting`);
          await page.waitForFunction(() => document.querySelector('.markdown-section')?.textContent
            .includes('system-dto-fields-not-declared'));
          const settingsContent = await page.locator('.markdown-section').innerText();
          assert.match(settingsContent, /PSSYSTEM\.json/);
          assert.match(settingsContent, /Usr1014979662DTO/);
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
          row.logicResponseFields = ['customer_score', 'customer_score_precent'];
          row.sourceSystemDtoGapRetained = true;
          await page.goto(`${base}?language=en#/api/ServiceAPI/ServiceAPI`);
          await page.waitForFunction(() => location.hash === '#/api-reference/en/ServiceAPI' &&
            document.title === 'Service API Reference' &&
            /^Service API(?:: ServiceAPI)?$/.test(document.querySelector('.markdown-section h1')?.textContent.trim() ?? ''));
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
    await t.test('actual static candidate exposes loading, invalid-index error and successful retry without uploading queries', async () => {
      const state = { status: 'FAILED', errors: [], requests: [] };
      report.searchStateRecovery = state;
      const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
      try {
        let release;
        const held = new Promise(resolve => { release = resolve; });
        searchFault = { kind: 'hold', resolve: release };
        await context.route('**/*', route => {
          const request = route.request();
          state.requests.push({ origin: new URL(request.url()).origin, path: new URL(request.url()).pathname,
            search: new URL(request.url()).search, method: request.method() });
          return new URL(request.url()).origin === origin ? route.continue() : route.abort();
        });
        const page = await context.newPage();
        page.on('pageerror', error => state.errors.push(error.message));
        page.on('console', message => { if (message.type() === 'error') state.errors.push(message.text()); });
        await page.goto(`${origin}/doc/#/api-reference/en/entities/idea`);
        const respond = await held;
        await page.locator('[data-aibiz-api-panel][aria-busy="true"]').waitFor({ state: 'attached' });
        assert.equal(await page.locator('[data-aibiz-api-search]').isDisabled(), true);
        assert.match(await page.getByRole('status').innerText(), /Loading API index/);
        respond();
        await page.waitForFunction(() => document.querySelector('[data-aibiz-api-search]')?.disabled === false);
        const searchInput = page.locator('[data-aibiz-api-search]');
        await openMobileSidebar(page);
        await searchInput.click();
        await searchInput.fill('customer_score_precent get_customer_score');
        await page.locator(`[data-aibiz-api-results] a[href="${scoreMethod.path}"]`).waitFor();
        searchFault = { kind: 'invalid' };
        await page.reload();
        await page.getByRole('alert').filter({ hasText: 'API search index unavailable' }).waitFor();
        await openMobileSidebar(page);
        await page.getByRole('button', { name: 'Retry', exact: true }).click();
        await page.waitForFunction(() => document.querySelector('[data-aibiz-api-search]')?.disabled === false);
        assert.equal(await searchInput.inputValue(), 'customer_score_precent get_customer_score');
        await page.locator(`[data-aibiz-api-results] a[href="${scoreMethod.path}"]`).waitFor();
        await searchInput.fill('customer_score');
        await searchInput.press('ArrowDown');
        assert.equal(await page.locator('[data-aibiz-api-results] a').first().evaluate(element => element === document.activeElement), true);
        await openMobileSidebar(page);
        state.sidebarGeometry = await page.locator('.sidebar').evaluate(element => {
          const rect = element.getBoundingClientRect();
          return { left: rect.left, right: rect.right, viewportWidth: innerWidth,
            horizontalOverflow: element.scrollWidth > element.clientWidth };
        });
        assert.ok(state.sidebarGeometry.left >= -1 && state.sidebarGeometry.right <= state.sidebarGeometry.viewportWidth + 1);
        assert.equal(state.sidebarGeometry.horizontalOverflow, false);
        assert.ok(state.requests.every(request => request.origin === origin && request.method === 'GET'));
        assert.ok(state.requests.every(request => !request.search.includes('customer_score')), 'Query text is only matched locally');
        assert.deepEqual(state.errors, []);
        await page.screenshot({ path: join(output, 'mobile-search-retry.png'), fullPage: false });
        state.status = 'PASS';
      } finally { await context.close(); }
    });
  });
