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
const source = new URL('../../modelingweb/local-plugins/studio-theme/', import.meta.url);
const output = fileURLToPath(new URL(`../../.artifacts/native-studio-theme-browser/probe-${randomUUID()}/`, import.meta.url));
const resources = new Map(await Promise.all([
  ['/color.css', new URL('dist/color/style.css', source), 'text/css'],
  ['/icon.css', new URL('dist/icon/style.css', source), 'text/css'],
  ['/color.mjs', new URL('dist/color/index.mjs', source), 'text/javascript'],
  ['/icon.mjs', new URL('dist/icon/index.mjs', source), 'text/javascript'],
  ['/font.woff2', new URL('../../modelingweb/app/dist/assets/font-awesome-4.7.0/fonts/fontawesome-webfont.woff2',
    import.meta.url), 'font/woff2'],
].map(async ([path, file, type]) => [path, { bytes: await readFile(file), type }])));
const html = `<!doctype html><html class="studio_dark studio_icon"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Studio theme contract fixture</title><link rel="icon" href="data:,">
<link rel="stylesheet" href="/color.css"><link rel="stylesheet" href="/icon.css">
<style>
@font-face{font-family:FontAwesome;src:url("/font.woff2") format("woff2");font-weight:normal;font-style:normal}
body{margin:0;font:16px sans-serif}main{padding:24px;max-width:800px}
.surface{padding:16px;background:var(--ibiz-color-bg-1);border:1px solid var(--ibiz-color-border)}
button{margin-top:16px;padding:8px 16px;border:0;background:var(--ibiz-color-primary);color:var(--ibiz-color-primary-text)}
.studio-icon{display:inline-block;font-size:28px;margin:12px}
</style></head><body><main>
<section class="surface"><h1>Studio</h1><i class="studio-icon pssysapp"></i>
<i class="studio-icon psdeserviceapi"></i><br><button type="button" id="toggle">Theme</button></section>
</main><script type="module">
import color from '/color.mjs';import icon from '/icon.mjs';
window.provided=[];const host={provide:(key,value)=>window.provided.push({key,value})};
color.install(host);icon.install(host);window.ready=true;
document.getElementById('toggle').onclick=()=>document.documentElement.classList.toggle('studio_dark');
</script></body></html>`;

test('local studio themes render real colors and FontAwesome glyph pixels on desktop and mobile',
  { timeout: 60_000 }, async t => {
    const report = {
      contract: 'local-studio-theme-browser-contract',
      boundary: 'Local source fixture, not native modeling workflow acceptance',
      originalSourceRecovered: false, nativeCompatibilityVerified: false, acceptedForProduction: false,
      viewports: {},
    };
    await mkdir(output, { recursive: true });
    t.after(async () => {
      report.status = Object.keys(report.viewports).length === 2 &&
        Object.values(report.viewports).every(item => item.status === 'PASS') ? 'passed' : 'failed';
      await writeFile(`${output}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
    });
    const server = createServer((request, response) => {
      const path = new URL(request.url, 'http://127.0.0.1').pathname;
      const resource = resources.get(path);
      response.setHeader('Cache-Control', 'no-store');
      if (path === '/') {
        response.writeHead(200, { 'Content-Type': 'text/html' });
        response.end(html);
      } else if (resource) {
        response.writeHead(200, { 'Content-Type': resource.type });
        response.end(resource.bytes);
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
      ['desktop', { width: 1440, height: 900 }], ['mobile', { width: 390, height: 844 }],
    ]) {
      await t.test(name, async () => {
        const result = { viewport, status: 'FAIL', errors: [], nonlocalRequests: [] };
        report.viewports[name] = result;
        const context = await browser.newContext({ viewport, serviceWorkers: 'block' });
        try {
          await context.route('**/*', route => {
            if (new URL(route.request().url()).origin === origin) return route.continue();
            result.nonlocalRequests.push(route.request().url());
            return route.abort();
          });
          const page = await context.newPage();
          page.on('pageerror', error => result.errors.push(error.message));
          page.on('console', message => {
            if (message.type() === 'error') result.errors.push(message.text());
          });
          await page.goto(origin);
          await page.waitForFunction(() => window.ready === true);
          result.rendering = await page.evaluate(async () => {
            await document.fonts.ready;
            const root = document.documentElement;
            const computed = getComputedStyle(root);
            const icons = [...document.querySelectorAll('.studio-icon')].map(element => {
              const style = getComputedStyle(element, '::before');
              return { content: style.content, font: style.fontFamily, bounds: element.getBoundingClientRect().toJSON() };
            });
            const glyphs = ['\uf108', '\uf0ec'].map(glyph => {
              const canvas = document.createElement('canvas');
              canvas.width = 80;
              canvas.height = 64;
              const drawing = canvas.getContext('2d');
              drawing.fillStyle = '#ffffff';
              drawing.fillRect(0, 0, 80, 64);
              drawing.font = '32px FontAwesome';
              drawing.fillStyle = '#000000';
              drawing.fillText(glyph, 8, 40);
              const pixels = drawing.getImageData(0, 0, 80, 64).data;
              return { inkPixels: Array.from({ length: pixels.length / 4 }, (_, index) => index)
                .filter(index => pixels[index * 4] < 200).length, image: canvas.toDataURL() };
            });
            return {
              background: computed.backgroundColor,
              text: computed.color,
              primary: computed.getPropertyValue('--ibiz-color-primary').trim(),
              fonts: [...document.fonts].map(font => ({ family: font.family, status: font.status })),
              icons, glyphs, provided: window.provided.map(item => item.key),
              horizontalOverflow: root.scrollWidth > window.innerWidth,
            };
          });
          assert.equal(result.rendering.background, 'rgb(26, 27, 29)');
          assert.equal(result.rendering.text, 'rgb(240, 242, 244)');
          assert.equal(result.rendering.primary, '#78d3c1');
          assert.deepEqual(result.rendering.provided, ['aibiz.studioColorTheme', 'aibiz.studioIconTheme']);
          assert.deepEqual(result.rendering.icons.map(icon => icon.content), ['"\uf108"', '"\uf0ec"']);
          assert.ok(result.rendering.icons.every(icon => icon.font === 'FontAwesome' && icon.bounds.width > 0));
          assert.ok(result.rendering.fonts.some(font => font.family === 'FontAwesome' && font.status === 'loaded'));
          assert.ok(result.rendering.glyphs.every(glyph => glyph.inkPixels > 80));
          assert.notEqual(result.rendering.glyphs[0].image, result.rendering.glyphs[1].image);
          result.rendering.glyphs = result.rendering.glyphs.map(({ inkPixels }) => ({ inkPixels }));
          assert.equal(result.rendering.horizontalOverflow, false);
          await page.screenshot({ path: `${output}/${name}-dark.png` });
          await page.getByRole('button', { name: 'Theme', exact: true }).click();
          assert.equal(await page.evaluate(() =>
            getComputedStyle(document.documentElement).getPropertyValue('--ibiz-color-primary').trim()), '');
          await page.getByRole('button', { name: 'Theme', exact: true }).click();
          assert.equal(await page.evaluate(() =>
            getComputedStyle(document.documentElement).getPropertyValue('--ibiz-color-primary').trim()), '#78d3c1');
          assert.deepEqual(result.nonlocalRequests, []);
          assert.deepEqual(result.errors, []);
          result.status = 'PASS';
        } finally {
          await context.close();
        }
      });
    }
    console.log(`Studio theme browser report: ${output}/report.json`);
  });
