import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { launchChromium } from '../browser-launch.mjs';

const require = createRequire(new URL('../../ibiz-app-hub/package.json', import.meta.url));
const { chromium } = require('playwright');
const moduleBytes = await readFile(new URL('../../modelingweb/local-plugins/global-util/dist/index.mjs', import.meta.url));
const output = fileURLToPath(new URL(`../../.artifacts/native-global-util-browser/probe-${randomUUID()}/`, import.meta.url));
const html = `<!doctype html><html><head><meta charset="utf-8"><title>Fullscreen contract fixture</title>
<link rel="icon" href="data:,"><style>
:root{--ibiz-color-bg-1:white}body{margin:0;font:16px sans-serif}#target{padding:12px;box-sizing:border-box}
#target:fullscreen{width:100%;height:100%}
</style></head><body><section id="target" class="existing" style="background:rgb(10, 20, 30)!important">
<button id="enter">Enter</button><button id="exit">Exit</button><button id="dispose">Dispose</button>
</section><script type="module">
import plugin, { ModelingFullscreenUtil } from '/plugin.mjs';
window.errors=[];window.original={fixture:true};
window.ibiz={fullscreenUtil:window.original,openView:{push(){}},hub:{getApp(){}},
log:{error:error=>window.errors.push(error.message)}};
const provides=[];plugin.install({provide:(...args)=>provides.push(args)});
plugin.install({provide:(...args)=>provides.push(args)});
window.installed=ibiz.globalAppUtil;
window.ready=ibiz.fullscreenUtil instanceof ModelingFullscreenUtil &&
provides.length===2 && provides[0][1]===provides[1][1];
const element=document.getElementById('target');
document.getElementById('enter').onclick=()=>{
window.result=undefined;
ibiz.fullscreenUtil.openElementFullscreen(element,{class:'existing design-fullscreen'}).then(value=>window.result=value);
};
document.getElementById('exit').onclick=()=>{
window.result=undefined;ibiz.fullscreenUtil.closeElementFullscreen().then(value=>window.result=value);
};
document.getElementById('dispose').onclick=()=>{
window.result=undefined;ibiz.globalAppUtil.dispose().then(value=>window.result=value);
};
</script></body></html>`;

test('local GlobalUtil uses real Chromium fullscreen on desktop and narrow viewports',
  { timeout: 60_000 }, async t => {
    const report = {
      contract: 'local-global-util-browser-contract', startedAt: new Date().toISOString(),
      boundary: 'Local fixture and real browser API, not native application acceptance',
      nativeRuntimeAccepted: false, originalSourceRecovered: false, acceptedForProduction: false,
      viewports: {}, errors: [],
    };
    await mkdir(output, { recursive: true });
    t.after(async () => {
      report.completedAt = new Date().toISOString();
      report.status = Object.values(report.viewports).length === 2 &&
        Object.values(report.viewports).every(item => item.status === 'PASS') ? 'passed' : 'failed';
      await writeFile(`${output}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
    });
    const server = createServer((request, response) => {
      const path = new URL(request.url, 'http://127.0.0.1').pathname;
      response.setHeader('Cache-Control', 'no-store');
      if (path === '/') {
        response.writeHead(200, { 'Content-Type': 'text/html' });
        response.end(html);
      } else if (path === '/plugin.mjs') {
        response.writeHead(200, { 'Content-Type': 'text/javascript' });
        response.end(moduleBytes);
      } else {
        response.writeHead(404);
        response.end();
      }
    });
    t.after(() => new Promise(resolve => {
      server.close(resolve);
      server.closeAllConnections();
    }));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const browser = await launchChromium(chromium);
    t.after(() => browser.close());
    for (const [name, viewport] of [
      ['desktop', { width: 1440, height: 900 }], ['narrow', { width: 390, height: 844 }],
    ]) {
      await t.test(name, async () => {
        const result = { viewport, status: 'FAIL', pageErrors: [], nonlocalRequests: [] };
        report.viewports[name] = result;
        const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
        try {
          await context.route('**/*', route => {
            if (new URL(route.request().url()).origin === origin) return route.continue();
            result.nonlocalRequests.push(route.request().url());
            return route.abort();
          });
          const page = await context.newPage();
          page.on('pageerror', error => result.pageErrors.push(error.message));
          await page.goto(origin);
          await page.waitForFunction(() => window.ready === true);
          const style = element => Object.fromEntries(
            [...new Set([
              ...Array.from({ length: element.style.length }, (_, index) => element.style.item(index)),
              ...(element.style.getPropertyValue('background') ? ['background'] : []),
            ])]
              .filter(name => name.startsWith('background') && name !== 'background-blend-mode')
              .sort().map(name => [name, {
                value: element.style.getPropertyValue(name),
                priority: element.style.getPropertyPriority(name),
              }]));
          const before = await page.locator('#target').evaluate(style);
          await page.locator('#enter').click();
          await page.waitForFunction(() => window.result === true && document.fullscreenElement?.id === 'target');
          result.fullscreen = await page.evaluate(() => {
            const rect = document.getElementById('target').getBoundingClientRect();
            return { width: rect.width, height: rect.height, screenWidth: innerWidth, screenHeight: innerHeight };
          });
          assert.equal(result.fullscreen.width, result.fullscreen.screenWidth);
          assert.equal(result.fullscreen.height, result.fullscreen.screenHeight);
          assert.ok(await page.locator('#target').evaluate(element => element.classList.contains('design-fullscreen')));
          await page.screenshot({ path: `${output}/${name}-fullscreen.png` });
          await page.locator('#exit').click();
          await page.waitForFunction(() => window.result === true && !document.fullscreenElement);
          assert.deepEqual(await page.locator('#target').evaluate(style), before);
          assert.equal(await page.locator('#target').getAttribute('class'), 'existing');
          result.backgroundCases = [];
          for (const [caseName, cssText] of [
            ['mixed-longhands', [
              'background-image: linear-gradient(red, blue)',
              'background-color: rgb(10, 20, 30) !important',
              'background-repeat: no-repeat',
              'background-position: 10px 20px',
              'background-size: 30px 40px',
              'background-attachment: fixed',
              'background-origin: padding-box',
              'background-clip: content-box !important',
              'background-blend-mode: screen',
              'color: red',
              '--fixture-marker: before',
            ].join(';')],
            ['layered-background-axis-priorities', [
              'background: linear-gradient(red, blue) left top / 10px 20px no-repeat padding-box content-box',
              'background-position-x: 5px !important',
              'background-position-y: 8px',
              'background-color: rgb(20, 30, 40) !important',
              'background-image: linear-gradient(red, blue), linear-gradient(white, black)',
              'background-repeat: no-repeat, repeat',
              'background-blend-mode: screen',
              '--fixture-marker: before',
            ].join(';')],
            ['variable-shorthand', [
              '--fixture-bg: rgb(20, 30, 40) no-repeat',
              'background: var(--fixture-bg) !important',
              'background-blend-mode: screen',
              'color: red',
            ].join(';')],
            ['no-inline-background', 'color: red; --fixture-marker: before'],
          ]) {
            await page.locator('#target').evaluate((element, value) => {
              element.style.cssText = value;
            }, cssText);
            const expected = await page.locator('#target').evaluate(style);
            if (caseName === 'mixed-longhands') {
              assert.equal(await page.locator('#target').evaluate(element =>
                element.style.getPropertyValue('background')), '');
              assert.equal(expected['background-color'].priority, 'important');
              assert.equal(expected['background-image'].priority, '');
            }
            if (caseName === 'variable-shorthand') {
              assert.deepEqual(expected.background, { value: 'var(--fixture-bg)', priority: 'important' });
            }
            await page.locator('#enter').click();
            await page.waitForFunction(() => window.result === true && !!document.fullscreenElement);
            await page.locator('#target').evaluate(element => {
              element.style.setProperty('color', 'rgb(40, 50, 60)', 'important');
              element.style.setProperty('margin-left', '7px');
              element.style.setProperty('--fixture-marker', 'after', 'important');
              element.style.setProperty('background-blend-mode', 'multiply', 'important');
            });
            await page.locator('#exit').click();
            await page.waitForFunction(() => window.result === true && !document.fullscreenElement);
            const restored = await page.locator('#target').evaluate(style);
            assert.deepEqual(restored, expected);
            assert.deepEqual(await page.locator('#target').evaluate(element => ({
              color: element.style.getPropertyValue('color'),
              colorPriority: element.style.getPropertyPriority('color'),
              margin: element.style.getPropertyValue('margin-left'),
              marker: element.style.getPropertyValue('--fixture-marker'),
              markerPriority: element.style.getPropertyPriority('--fixture-marker'),
              blend: element.style.getPropertyValue('background-blend-mode'),
              blendPriority: element.style.getPropertyPriority('background-blend-mode'),
            })), {
              color: 'rgb(40, 50, 60)', colorPriority: 'important', margin: '7px',
              marker: 'after', markerPriority: 'important', blend: 'multiply', blendPriority: 'important',
            });
            assert.equal(await page.locator('#target').getAttribute('class'), 'existing');
            result.backgroundCases.push({ name: caseName, before: expected, after: restored, status: 'PASS' });
          }
          result.persistedLifecycle = await page.evaluate(() => {
            const instance = window.installed;
            window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
            window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
            window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
            return {
              eventBoundary: 'Real browser PageTransitionEvent dispatch, not a claimed history-cache navigation',
              sameGlobal: ibiz.globalAppUtil === instance,
              sameFullscreen: ibiz.fullscreenUtil === instance.fullscreen,
            };
          });
          assert.equal(result.persistedLifecycle.sameGlobal, true);
          assert.equal(result.persistedLifecycle.sameFullscreen, true);
          const lastBackground = await page.locator('#target').evaluate(style);
          await page.locator('#enter').click();
          await page.waitForFunction(() => window.result === true && !!document.fullscreenElement);
          await page.locator('#exit').click();
          await page.waitForFunction(() => window.result === true && !document.fullscreenElement);
          assert.deepEqual(await page.locator('#target').evaluate(style), lastBackground);
          assert.equal(await page.evaluate(() => ibiz.globalAppUtil === window.installed), true);
          result.persistedLifecycle.fullscreenAfterResume = true;
          await page.locator('#enter').click();
          await page.waitForFunction(() => window.result === true && !!document.fullscreenElement);
          await page.locator('#dispose').click();
          await page.waitForFunction(() => window.result === true && !document.fullscreenElement);
          assert.deepEqual(await page.locator('#target').evaluate(style), lastBackground);
          assert.equal(await page.evaluate(() => ibiz.fullscreenUtil === window.original &&
            !Object.hasOwn(ibiz, 'globalAppUtil')), true);
          assert.equal(await page.evaluate(() => {
            window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
            return ibiz.fullscreenUtil === window.original && !Object.hasOwn(ibiz, 'globalAppUtil');
          }), true);
          assert.deepEqual(await page.evaluate(() => window.errors), []);
          assert.deepEqual(result.pageErrors, []);
          assert.deepEqual(result.nonlocalRequests, []);
          result.status = 'PASS';
        } catch (error) {
          result.error = error.message;
          throw error;
        } finally {
          await context.close();
        }
      });
    }
    console.log(`GlobalUtil browser report: ${output}/report.json`);
  });
