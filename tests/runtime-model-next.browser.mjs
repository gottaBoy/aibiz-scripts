import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, join, resolve } from 'node:path';
import test from 'node:test';
import { launchChromium } from '../browser-launch.mjs';
import {
  componentTags, docsFixture, rawNode, rootNode, runtimeModelResourceResponse,
  screenshotPixels, sha256, sourceBuildEvidence, verifyRuntimeModelLoadedResources,
  waitForRuntimeModelScrollEnd, workspace,
} from './runtime-model-test-support.mjs';

const require = createRequire(new URL('../../ibiz-app-hub/package.json', import.meta.url));
const { chromium } = require('playwright');
const builtRootPath = process.env.RUNTIME_MODEL_BUILT_ROOT;
const sourceReportPath = process.env.RUNTIME_MODEL_SOURCE_BUILD_REPORT;
const sourceRoot = resolve(workspace, 'modelingweb/local-plugins/runtime-model-next/src');
const output = resolve(process.env.RUNTIME_MODEL_NEXT_BROWSER_OUTPUT ||
  join(workspace, '.artifacts/runtime-model-next-browser', `probe-${randomUUID()}`));
const viewportCases = [
  ['desktop', { width: 1440, height: 900 }],
  ['mobile', { width: 390, height: 844 }],
];
const children = [
  rawNode('METHOD@branch@PSSYSAPP', 'openChild#Child branch ==> child-value', 0),
  rawNode('METHOD@missing@PSSYSAPP', 'missing#Missing config ==> missing-value'),
  ...Array.from({ length: 73 }, (_, index) =>
    rawNode(`METHOD@value${index}@PSSYSAPP`, `getValue${index}#Value ${index} ==> value-${index}`,
      index === 0 ? 0 : 1)),
];
const nestedChildren = [
  rawNode('VALUE@branch-one', 'Branch one ==> branch-one-value'),
  rawNode('VALUE@branch-two', 'Branch two ==> branch-two-value'),
];

function fixtureHtml(viewport, scenario, loaderRelative) {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>runtime-model-next browser contract</title>
<style>html,body,#fixture{height:100%;margin:0}ibiz-model-runtime{display:block}</style>
</head><body><div id="fixture"></div><script type="module">
window.fixture={ready:false,viewport:${JSON.stringify(viewport)},scenario:${JSON.stringify(scenario)}};
const {defineCustomElements}=await import('/packages/recovered/${loaderRelative}');
await defineCustomElements(window);
await Promise.all(${JSON.stringify(componentTags)}.map(tag=>customElements.whenDefined(tag)));
const rootPanel=document.createElement('loading-panel');rootPanel.id='rootLoadingPanel';
const rootMask=document.createElement('loading-mask');rootMask.id='rootLoadingMask';
document.getElementById('fixture').append(rootPanel,rootMask);
await Promise.all([rootPanel.componentOnReady(),rootMask.componentOnReady()]);
const runtime=document.createElement('ibiz-model-runtime');runtime.id='runtime';
runtime.setAttribute('url','/api/recovered/${viewport}/${scenario}/nodes');
runtime.setAttribute('config-base-url','/api/recovered/${viewport}/${scenario}/config');
runtime.setAttribute('parent-key','initial');
runtime.headers={Authorization:'Bearer next-fixture','X-Fixture':'runtime-next'};
document.getElementById('fixture').append(runtime);
await runtime.componentOnReady();
window.fixture.ready=true;
</script></body></html>`;
}

function configPayload() {
  return {
    'openChild()': { description: 'Open a child model', return: 'net.example.Child' },
    'onlyDocumentation()': {
      description: 'Documentation-only operation', return: 'java.util.List<net.example.Doc>',
    },
    'missing()': { description: 'FORGED 404 method', return: 'forged.Return' },
  };
}

function createFixtureServer(sourceBuild) {
  const calls = [];
  const failures = [];
  const pending = new Map();
  const state = new Map();
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      response.setHeader('Cache-Control', 'no-store');
      const page = url.pathname.match(/^\/fixture\/(desktop|mobile)\/([\w-]+)$/);
      if (page) {
        const [viewport, scenario] = page.slice(1);
        state.set(`${viewport}/${scenario}`, { rootCalls: 0 });
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        response.end(fixtureHtml(viewport, scenario, sourceBuild.loaderEntryRelative));
        return;
      }
      const asset = url.pathname.match(/^\/packages\/recovered\/(.+)$/);
      if (asset) {
        const file = resolve(sourceBuild.buildRoot, decodeURIComponent(asset[1]));
        assert.ok(file.startsWith(`${resolve(sourceBuild.buildRoot)}/`),
          'Loader asset path escaped the verified package');
        const bytes = await readFile(file);
        const contentType = {
          '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css',
          '.json': 'application/json', '.svg': 'image/svg+xml',
        }[extname(file)] || 'application/octet-stream';
        response.writeHead(200, { 'Content-Type': contentType });
        response.end(bytes);
        return;
      }
      const config = url.pathname.match(
        /^\/api\/recovered\/(desktop|mobile)\/([\w-]+)\/config\/[^/]+\.json$/,
      );
      if (config) {
        const [viewport, scenario] = config.slice(1);
        const status = scenario.startsWith('config-') ? 404 : 200;
        calls.push({ viewport, scenario, endpoint: 'config', method: request.method, status });
        if (scenario === 'config-html-404') {
          response.writeHead(status, { 'Content-Type': 'text/html' });
          response.end('<html><body>Missing optional documentation</body></html>');
        } else {
          response.writeHead(status, { 'Content-Type': 'application/json' });
          response.end(JSON.stringify(status === 404 ? configPayload() : docsFixture));
        }
        return;
      }
      const api = url.pathname.match(
        /^\/api\/recovered\/(desktop|mobile)\/([\w-]+)\/nodes$/,
      );
      if (api) {
        const [viewport, scenario] = api.slice(1);
        const key = `${viewport}/${scenario}`;
        const body = await Array.fromAsync(request).then(chunks => Buffer.concat(chunks).toString());
        const params = body ? JSON.parse(body) : {};
        calls.push({
          viewport, scenario, endpoint: 'nodes', method: request.method, params,
          authorization: request.headers.authorization || null,
          fixtureHeader: request.headers['x-fixture'] || null,
        });
        assert.equal(request.method, 'POST');
        assert.equal(request.headers.authorization, 'Bearer next-fixture');
        assert.equal(request.headers['x-fixture'], 'runtime-next');
        response.setHeader('Content-Type', 'application/json');
        if (params.srfkey === '#') {
          const current = state.get(key);
          current.rootCalls += 1;
          if ((scenario === 'empty-reload' && params.srfparentkey === 'empty') ||
              (scenario === 'fresh-empty-retry' && current.rootCalls === 1)) {
            response.end('[]');
            return;
          }
          response.end(JSON.stringify([rootNode]));
          return;
        }
        if (params.srfkey === rootNode.psmodelrtid) {
          response.end(JSON.stringify(children));
          return;
        }
        if (params.srfkey === 'METHOD@branch@PSSYSAPP') {
          await new Promise(done => pending.set(key, done));
          pending.delete(key);
          response.end(JSON.stringify(nestedChildren));
          return;
        }
        if (params.srfkey === 'METHOD@value0@PSSYSAPP') {
          response.end(JSON.stringify([rawNode('VALUE@alternate', 'Alternate branch value')]));
          return;
        }
        assert.fail(`Unexpected runtime-model-next API key ${params.srfkey}`);
      }
      response.writeHead(404);
      response.end('Unknown runtime-model-next fixture route');
    } catch (error) {
      failures.push({ url: request.url, error: error.stack || String(error) });
      if (!response.headersSent) response.writeHead(500);
      response.end('runtime-model-next fixture failure');
    }
  });
  return {
    calls, failures, pending,
    listen: () => new Promise((done, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', done);
    }),
    get origin() {
      return `http://127.0.0.1:${server.address().port}`;
    },
    release(viewport, scenario) {
      const release = pending.get(`${viewport}/${scenario}`);
      assert.ok(release, 'No pending child response to release');
      release();
    },
    close: () => new Promise(done => {
      for (const release of pending.values()) release();
      server.close(done);
      server.closeAllConnections();
    }),
  };
}

async function waitForRows(page, counts) {
  await page.waitForFunction(expected => {
    const lists = [...document.querySelectorAll('#runtime ibiz-model-runtime-list')];
    return lists.length === expected.length &&
      lists.every((list, index) =>
        list.querySelectorAll('.model-runtime-list-item').length === expected[index]);
  }, counts);
}

async function waitForCall(fixture, predicate) {
  const deadline = Date.now() + 10_000;
  while (!fixture.calls.some(predicate)) {
    assert.ok(Date.now() < deadline, 'Expected real runtime-model API request was not observed');
    await new Promise(done => setTimeout(done, 20));
  }
}

async function loadedState(page) {
  return page.evaluate(() => {
    const controller = document.querySelector('#runtime ibiz-model-runtime-list')?.controller ||
      window.fixture.controller;
    if (!controller) throw new Error('Real public list controller is missing');
    window.fixture.controller = controller;
    return {
      loaded: controller.data.loaded,
      listLength: controller.data.list.length,
      rootData: controller.data.rootData,
      list: controller.data.list,
    };
  });
}

async function screenshot(page, result, stage) {
  await page.evaluate(() => document.activeElement?.blur());
  const path = join(output, `${result.viewport}-${result.scenario}-${stage}.png`);
  const bytes = await page.screenshot({ path, animations: 'disabled', caret: 'hide' });
  const image = screenshotPixels(bytes);
  const viewport = page.viewportSize();
  assert.equal(image.width, viewport.width);
  assert.equal(image.height, viewport.height);
  assert.ok(image.colors > 50, `Blank/flat screenshot: ${image.colors} colors`);
  assert.ok(image.luminanceRange > 80, 'Screenshot lacks visible content contrast');
  result.screenshots.push({
    stage, path, sha256: sha256(bytes), width: image.width, height: image.height,
    colors: image.colors, luminanceRange: image.luminanceRange,
  });
}

async function waitForEmpty(page) {
  await page.waitForFunction(() => {
    const empty = document.querySelector('#runtime .ibiz-model-runtime-empty');
    const content = document.querySelector('#runtime .ibiz-model-runtime-content');
    const panel = document.getElementById('rootLoadingPanel');
    return empty && content && panel && getComputedStyle(empty).display !== 'none' &&
      getComputedStyle(content).display === 'none' &&
      getComputedStyle(panel).display === 'none' &&
      document.querySelectorAll('#runtime ibiz-model-runtime-list').length === 0;
  });
  const retry = page.locator('#runtime .ibiz-model-runtime-empty-refresh a');
  assert.equal(await retry.isVisible(), true, 'Empty result must expose a real retry control');
  const box = await retry.boundingBox();
  assert.ok(box && box.x >= 0 && box.y >= 0 &&
    box.x + box.width <= page.viewportSize().width &&
    box.y + box.height <= page.viewportSize().height, 'Empty retry control is outside the viewport');
}

function nodeCalls(fixture, result) {
  return fixture.calls.filter(call => call.viewport === result.viewport &&
    call.scenario === result.scenario && call.endpoint === 'nodes');
}

async function exerciseNormal(page, fixture, result) {
  await page.waitForFunction(() => window.fixture?.ready === true);
  await waitForRows(page, [30]);
  await waitForRuntimeModelScrollEnd(page);
  const firstList = page.locator('#runtime ibiz-model-runtime-list').first();
  result.initialCount = await firstList.locator('.model-runtime-list-item').count();
  await screenshot(page, result, 'initial');

  await firstList.locator('.model-runtime-item-arrow').first().click();
  await waitForCall(fixture, call =>
    call.viewport === result.viewport && call.scenario === 'normal' &&
    call.endpoint === 'nodes' && call.params.srfkey === 'METHOD@branch@PSSYSAPP');
  assert.ok(fixture.pending.has(`${result.viewport}/normal`),
    'Child request must remain pending while active state is observed');
  try {
    await page.waitForFunction(() => {
      const active = document.querySelectorAll(
        '#runtime ibiz-model-runtime-list:first-of-type .model-runtime-list-item.active',
      );
      return active.length === 1 &&
        active[0].querySelector('.model-runtime-item-content-method')?.title === 'openChild';
    }, undefined, { timeout: 2_000 });
    assert.ok(fixture.pending.has(`${result.viewport}/normal`),
      'Active state was observed only after the child response');
    result.activeBeforeChildResponse = true;
  } finally {
    fixture.release(result.viewport, 'normal');
  }
  await waitForRows(page, [30, 2]);
  await waitForRuntimeModelScrollEnd(page);

  await firstList.locator('.ibiz-model-runtime-list').evaluate(element => {
    element.scrollTop = element.scrollHeight;
  });
  await waitForRows(page, [40, 2]);
  result.pagination = [30, 40];
  await firstList.locator('.ibiz-model-runtime-list').evaluate(element => {
    element.scrollTop = element.scrollHeight;
  });
  await waitForRows(page, [50, 2]);
  result.pagination.push(50);

  const search = firstList.locator('.ibiz-model-runtime-list-search-input');
  await search.fill('[');
  await page.waitForTimeout(350);
  await waitForRows(page, [1, 2]);
  assert.equal(await firstList.locator('.model-runtime-list-item.active').count(), 1,
    'Literal search must preserve the selected branch');
  result.literalBracket = {
    rows: await firstList.locator('.model-runtime-list-item').count(),
    pageErrors: result.pageErrors.length,
  };
  await search.fill('**');
  await page.waitForTimeout(350);
  await waitForRows(page, [30, 2]);
  result.repeatedWildcard = {
    rows: await firstList.locator('.model-runtime-list-item').count(),
    pageErrors: result.pageErrors.length,
  };
  await search.fill('');
  await page.waitForTimeout(350);
  await waitForRows(page, [30, 2]);
  await firstList.locator('.ibiz-model-runtime-list').evaluate(element => { element.scrollTop = 0; });
  const callsBeforeCopy = nodeCalls(fixture, result).length;
  result.copy = [];
  for (const [selector, modifier, expected] of [
    ['.model-runtime-item-content-method', 'Control', 'openChild'],
    ['.model-runtime-item-content-value', 'Meta', 'child-value'],
  ]) {
    await firstList.locator(selector).first().click({ modifiers: [modifier] });
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), expected);
    assert.ok((await page.locator('.dynamic-model-copy-float-text').allTextContents())
      .some(text => text.includes(expected)));
    result.copy.push({ modifier, text: expected });
  }
  assert.equal(nodeCalls(fixture, result).length, callsBeforeCopy,
    'Ctrl/Meta copy must not navigate the selected branch');
  await firstList.locator('.model-runtime-item-arrow').first().click();
  await firstList.locator('.model-runtime-item-content-method[title="missing"]').click();
  assert.equal(nodeCalls(fixture, result).length, callsBeforeCopy,
    'Duplicate branch and leaf clicks must not issue child requests');
  assert.equal(await firstList.locator('.model-runtime-list-item.active').count(), 1);

  const alternate = firstList.locator('.model-runtime-item-content-method[title="getValue0"]');
  await alternate.click();
  await waitForRows(page, [30, 1]);
  assert.equal(await firstList.locator('.model-runtime-list-item.active').count(), 1);
  assert.equal(await firstList.locator('.model-runtime-list-item.active .model-runtime-item-content-method')
    .getAttribute('title'), 'getValue0');
  const callsBeforeCachedReturn = nodeCalls(fixture, result).length;
  await firstList.locator('.model-runtime-item-arrow').first().click();
  await waitForRows(page, [30, 2]);
  assert.equal(nodeCalls(fixture, result).length, callsBeforeCachedReturn,
    'Revisiting a named branch must use the independently tested cache');
  assert.equal(await firstList.locator('.model-runtime-list-item.active').count(), 1);
  assert.equal(await firstList.locator('.model-runtime-list-item.active .model-runtime-item-content-method')
    .getAttribute('title'), 'openChild');
  result.selection = { switched: true, cacheRevisited: true, activeRows: 1 };
  await screenshot(page, result, 'navigation');
  await firstList.locator('.ibiz-model-runtime-refresh').click();
  await waitForRows(page, [30]);
  await waitForRuntimeModelScrollEnd(page);
  assert.equal(nodeCalls(fixture, result).length, callsBeforeCachedReturn + 1);
  assert.equal(await firstList.locator('.model-runtime-list-item.active').count(), 0);
  result.refresh = { nextRequest: true, activeRows: 0, staleChildColumnsRemoved: true };
  await screenshot(page, result, 'refresh');
  assert.equal(result.pageErrors.length, 0);
}

async function exerciseConfig404(page, fixture, result) {
  await page.waitForFunction(() => window.fixture?.ready === true);
  await waitForRows(page, [30]);
  const state = await loadedState(page);
  const items = state.list[0] || [];
  const missing = items.find(item => item.data?.methodName === 'missing');
  assert.ok(missing, 'Missing-config method was not rendered');
  assert.equal(missing.data.apiMethod, undefined, '404 fake method was consumed');
  assert.equal(missing.data.apiDescription, undefined, '404 fake description was consumed');
  assert.equal(missing.data.apiReturn, undefined, '404 fake return was consumed');
  assert.equal(items.some(item => item.isApi), false, '404 config invented an API item');
  assert.ok(fixture.calls.some(call =>
    call.viewport === result.viewport && call.scenario === result.scenario &&
    call.endpoint === 'config' && call.status === 404));
  result.config404 = {
    missingData: missing.data,
    apiItems: items.filter(item => item.isApi).length,
    status: 404,
  };
  await screenshot(page, result, 'documentation-fallback');
}

async function exerciseEmptyReload(page, fixture, result) {
  await page.waitForFunction(() => window.fixture?.ready === true);
  await waitForRows(page, [30]);
  const before = await loadedState(page);
  assert.equal(before.rootData.id, rootNode.psmodelrtid);
  await page.locator('#runtime').evaluate(element => element.setAttribute('parent-key', 'empty'));
  await waitForCall(fixture, call =>
    call.viewport === result.viewport && call.scenario === 'empty-reload' &&
    call.endpoint === 'nodes' && call.params.srfparentkey === 'empty');
  await page.waitForFunction(() => {
    const controller = window.fixture.controller;
    return controller.data.loaded === true && controller.data.list.length === 0 &&
      document.querySelectorAll('#runtime ibiz-model-runtime-list').length === 0;
  });
  assert.equal(await page.locator('#runtime ibiz-model-runtime-list').count(), 0);
  await waitForEmpty(page);
  const state = await loadedState(page);
  assert.equal(state.rootData.id, undefined, 'Empty reload retained the old root');
  result.emptyReload = { loaded: state.loaded, listLength: state.listLength, oldRootRemoved: true };
  await screenshot(page, result, 'empty-reload');
}

async function exerciseFreshEmptyRetry(page, fixture, result) {
  await page.waitForFunction(() => window.fixture?.ready === true);
  await waitForEmpty(page);
  assert.deepEqual(nodeCalls(fixture, result).map(call => call.params), [
    { srfkey: '#', srfparentkey: 'initial' },
  ]);
  await screenshot(page, result, 'fresh-empty');
  await page.locator('#runtime .ibiz-model-runtime-empty-refresh a').click();
  await waitForRows(page, [30]);
  const state = await loadedState(page);
  assert.equal(state.loaded, true);
  assert.equal(state.rootData.id, rootNode.psmodelrtid);
  assert.deepEqual(nodeCalls(fixture, result).map(call => call.params), [
    { srfkey: '#', srfparentkey: 'initial' },
    { srfkey: '#', srfparentkey: 'initial' },
    { srfkey: rootNode.psmodelrtid, srfparentkey: 'initial' },
  ]);
  assert.equal(await page.locator('#runtime .ibiz-model-runtime-empty').isVisible(), false);
  result.freshEmptyRetry = { completedEmpty: true, retryRequests: 2, populatedRows: 30 };
  await screenshot(page, result, 'retry-populated');
}

async function runPage(browser, fixture, sourceBuild, viewportName, viewport, scenario, exercise, result) {
  const context = await browser.newContext({
    viewport, serviceWorkers: 'block', permissions: ['clipboard-read', 'clipboard-write'],
  });
  context.setDefaultTimeout(15_000);
  const resourceReads = [];
  try {
    await context.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.origin === fixture.origin || url.protocol === 'data:') return route.continue();
      result.externalRequests.push(route.request().url());
      return route.abort();
    });
    const page = await context.newPage();
    page.setDefaultTimeout(15_000);
    page.on('pageerror', error => result.pageErrors.push(error.message));
    page.on('console', message => {
      if (message.type() === 'error') result.consoleErrors.push(message.text());
    });
    page.on('requestfailed', request => result.requestFailures.push({
      url: request.url(), error: request.failure()?.errorText,
    }));
    page.on('response', response => {
      const url = new URL(response.url());
      if (response.status() >= 400) {
        result.httpErrors.push({ url: response.url(), status: response.status() });
      }
      if (url.origin === fixture.origin && url.pathname.startsWith('/packages/')) {
        resourceReads.push((async () => {
          const bytes = await response.body();
          result.loadedResources.push(runtimeModelResourceResponse({
            sourceBuild, side: 'recovered', origin: fixture.origin, url: response.url(),
            status: response.status(), resourceType: response.request().resourceType(), bytes,
          }));
        })().catch(error => {
          result.resourceErrors.push({ url: response.url(), error: error.stack || String(error) });
        }));
      }
    });
    await page.goto(`${fixture.origin}/fixture/${viewportName}/${scenario}`);
    await exercise(page, fixture, result);
    await Promise.all(resourceReads);
    assert.deepEqual(result.resourceErrors, []);
    result.browserResourcesVerified = verifyRuntimeModelLoadedResources(
      sourceBuild, 'recovered', result.loadedResources,
    );
    assert.deepEqual(result.externalRequests, []);
    assert.deepEqual(result.requestFailures, []);
    assert.deepEqual(result.pageErrors, []);
    if (scenario.startsWith('config-')) {
      assert.deepEqual(result.httpErrors, [{
        url: `${fixture.origin}/api/recovered/${viewportName}/${scenario}/config/IPSAPPLICATION.json`,
        status: 404,
      }]);
      assert.deepEqual([...result.consoleErrors].sort(), [
        'Failed to load resource: the server responded with a status of 404 (Not Found)',
        '配置方法解析异常',
      ].sort());
    } else {
      assert.deepEqual(result.httpErrors, []);
      assert.deepEqual(result.consoleErrors, []);
    }
    assert.deepEqual(fixture.failures, []);
    result.loadedResources.sort((a, b) => a.path.localeCompare(b.path));
    result.status = 'passed';
  } catch (error) {
    result.error = error.stack || String(error);
    throw error;
  } finally {
    await Promise.all(resourceReads);
    result.apiCalls = fixture.calls.filter(call =>
      call.viewport === viewportName && call.scenario === scenario);
    await context.close();
  }
  return result;
}

const report = {
  contract: 'runtime-model-next-fixed-loader-browser',
  startedAt: new Date().toISOString(),
  sourceBuild: null,
  fixtureAcceptance: false,
  nativeAcceptance: false,
  boundary: 'Fresh source-built runtime-model .2 loader in Chromium; controlled HTTP fixture, not native or PLM acceptance',
  viewports: {},
  errors: [],
};

test('runtime-model-next fresh source-built loader: desktop/mobile fixed behavior and asset provenance',
  { timeout: 180_000 }, async t => {
    await mkdir(output, { recursive: true });
    t.after(async () => {
      report.completedAt = new Date().toISOString();
      const cases = Object.values(report.viewports).flatMap(item => Object.values(item));
      report.fixtureAcceptance = cases.length === viewportCases.length * 5 &&
        cases.every(item => item.status === 'passed') && report.errors.length === 0;
      report.status = report.fixtureAcceptance
        ? 'fixed-fixture-passed-not-native-accepted' : 'failed';
      await writeFile(join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
      t.diagnostic(`runtime-model-next browser evidence: ${join(output, 'report.json')}`);
    });
    assert.ok(builtRootPath, 'RUNTIME_MODEL_BUILT_ROOT must point to a fresh .2 package build');
    assert.ok(sourceReportPath, 'RUNTIME_MODEL_SOURCE_BUILD_REPORT must point to a fresh .2 report');
    try {
      report.sourceBuild = sourceBuildEvidence(resolve(builtRootPath), {
        reportPath: sourceReportPath, sourceRoot,
      });
      assert.equal(report.sourceBuild.candidateVersion, '0.2.2-local.2');
      assert.equal(report.sourceBuild.candidateRevision, 'fixed');
      assert.equal(report.sourceBuild.nativeAcceptance, false);
    } catch (error) {
      report.errors.push(error.stack || String(error));
      await t.test('fresh .2 source-build provenance', () => { throw error; });
      return;
    }
    await t.test('fresh .2 source-build provenance', () => {
      assert.equal(report.sourceBuild.sourceBuildVerified, true);
      assert.equal(report.sourceBuild.reproducibleBuildVerified, true);
    });
    const fixture = createFixtureServer(report.sourceBuild);
    await fixture.listen();
    t.after(fixture.close);
    const browser = await launchChromium(chromium);
    t.after(() => browser.close());
    for (const [viewportName, viewport] of viewportCases) {
      report.viewports[viewportName] = {};
      for (const [scenario, exercise] of [
        ['normal', exerciseNormal],
        ['config-404', exerciseConfig404],
        ['config-html-404', exerciseConfig404],
        ['empty-reload', exerciseEmptyReload],
        ['fresh-empty-retry', exerciseFreshEmptyRetry],
      ]) {
        await t.test(`${viewportName}/${scenario}`, async () => {
          const result = {
            viewport: viewportName, scenario, status: 'failed', pageErrors: [], consoleErrors: [],
            requestFailures: [], httpErrors: [], externalRequests: [], loadedResources: [],
            resourceErrors: [], browserResourcesVerified: false, screenshots: [],
          };
          report.viewports[viewportName][scenario] = result;
          try {
            await runPage(
              browser, fixture, report.sourceBuild, viewportName, viewport, scenario, exercise, result,
            );
          } catch (error) {
            result.error = error.stack || String(error);
            report.errors.push(`${viewportName}/${scenario}: ${
              error.stack || String(error)}`);
            throw error;
          }
        });
      }
    }
  });
