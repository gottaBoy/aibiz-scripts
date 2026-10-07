import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { extname, join, resolve } from 'node:path';
import test from 'node:test';
import { launchChromium } from '../browser-launch.mjs';
import {
  branchNode, builtRoot, componentTags, docsFixture, knownOriginalIssues, originalRoot,
  rawNode, rootNode, runtimeModelResourceResponse, screenshotPixels, sha256,
  sourceBuildEvidence, verifyRuntimeModelLoadedResources, waitForRuntimeModelScrollEnd, workspace,
} from './runtime-model-test-support.mjs';

const require = createRequire(new URL('../../ibiz-app-hub/package.json', import.meta.url));
const { chromium } = require('playwright');
const output = resolve(process.env.RUNTIME_MODEL_BROWSER_OUTPUT ||
  join(workspace, '.artifacts/runtime-model-reconstruction-browser', `probe-${randomUUID()}`));
const children = [branchNode, ...Array.from({ length: 90 }, (_, index) =>
  rawNode(`METHOD@value${index}@PSSYSAPP`, `getValue${index}#Value ${index} ==> value-${index}`))];
const nestedNode = rawNode('METHOD@nested@PSSYSAPP', 'getNested#Nested branch ==> nested-value', 0);
const scenarios = ['workflow', 'error401', 'error403', 'error504', 'empty-root'];
const viewportCases = [
  ['desktop', { width: 1440, height: 900 }],
  ['mobile', { width: 390, height: 844 }],
];

function fixtureHtml(side, scenario, loaderRelative) {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="icon" href="data:,"><title>runtime-model loader differential</title>
<style>html,body,#fixture{height:100%;margin:0}ibiz-model-runtime{display:block}</style>
</head><body><div id="fixture"></div><script type="module">
window.fixture={ready:false,stage:'initial',mounted:[],loader:'/packages/${side}/${loaderRelative}'};
document.addEventListener('mounted',event=>fixture.mounted.push({
  target:event.target.tagName.toLowerCase(),bubbles:event.bubbles,cancelable:event.cancelable,
  composed:event.composed,detail:event.detail===undefined?'undefined':event.detail,
  stage:fixture.stage,index:event.target.index,parentId:event.target.parent?.id ?? null,
  itemCount:event.target.items?.length ?? null,
  listCount:document.querySelectorAll('ibiz-model-runtime-list').length,
}));
const {defineCustomElements}=await import(fixture.loader);
await defineCustomElements(window);
await Promise.all(${JSON.stringify(componentTags)}.map(tag=>customElements.whenDefined(tag)));
const rootPanel=document.createElement('loading-panel');rootPanel.id='rootLoadingPanel';
const rootMask=document.createElement('loading-mask');rootMask.id='rootLoadingMask';
document.getElementById('fixture').append(rootPanel,rootMask);
await Promise.all([rootPanel.componentOnReady(),rootMask.componentOnReady()]);
const runtime=document.createElement('ibiz-model-runtime');runtime.id='runtime';
runtime.setAttribute('url','/api/${side}/${scenario}/nodes');
runtime.setAttribute('config-base-url','/api/${side}/${scenario}/config');
runtime.setAttribute('parent-key','parent-first');
runtime.headers={Authorization:'Bearer fixture','X-Fixture':'controlled'};
document.getElementById('fixture').append(runtime);
await runtime.componentOnReady();
fixture.ready=true;
</script></body></html>`;
}

async function fixtureServer(sourceBuild) {
  const calls = new Map();
  const failures = [];
  const state = new Map();
  const pendingRootChildren = new Map();
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      response.setHeader('Cache-Control', 'no-store');
      const page = url.pathname.match(/^\/fixture\/(original|recovered)\/([\w-]+)$/);
      if (page && scenarios.includes(page[2])) {
        const key = `${page[1]}/${page[2]}`;
        calls.set(key, []);
        state.set(key, { rootCalls: 0 });
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        const loader = page[1] === 'original'
          ? sourceBuild?.originalLoaderEntryRelative : sourceBuild?.loaderEntryRelative;
        assert.ok(loader, 'A verified source-built loader is required for the reconstructed fixture');
        response.end(fixtureHtml(page[1], page[2], loader));
        return;
      }
      const api = url.pathname.match(/^\/api\/(original|recovered)\/([\w-]+)\/(nodes|config\/[^/]+\.json)$/);
      if (api) {
        const key = `${api[1]}/${api[2]}`;
        const body = await Array.fromAsync(request).then(chunks => Buffer.concat(chunks).toString());
        const params = body ? JSON.parse(body) : {};
        calls.get(key).push({
          endpoint: api[3], method: request.method, params,
          authorization: request.headers.authorization || null,
          fixtureHeader: request.headers['x-fixture'] || null,
          contentType: request.headers['content-type'] || null,
        });
        response.setHeader('Content-Type', 'application/json');
        if (api[3].startsWith('config/')) {
          assert.equal(request.method, 'GET');
          response.end(JSON.stringify(docsFixture));
          return;
        }
        assert.equal(request.method, 'POST');
        assert.equal(request.headers.authorization, 'Bearer fixture');
        assert.equal(request.headers['x-fixture'], 'controlled');
        const current = state.get(key);
        if (params.srfkey === '#') {
          current.rootCalls++;
          if (api[2].startsWith('error') && current.rootCalls === 1) {
            response.writeHead(Number(api[2].slice(5)));
            response.end(JSON.stringify({ message: 'fixture-failure' }));
            return;
          }
          if (api[2] === 'empty-root') {
            response.end('[]');
            return;
          }
          response.end(JSON.stringify([rootNode]));
        } else if (params.srfkey === rootNode.psmodelrtid) {
          if (params.srfparentkey === 'parent-second') {
            await new Promise(done => pendingRootChildren.set(key, done));
          }
          response.end(JSON.stringify(children));
        } else if (params.srfkey === branchNode.psmodelrtid) {
          response.end(JSON.stringify([nestedNode, rawNode('VALUE@branch-leaf', 'Branch leaf ==> branch-leaf-value')]));
        } else if (params.srfkey === nestedNode.psmodelrtid) {
          response.end(JSON.stringify([rawNode('VALUE@final', 'Final value ==> final-value')]));
        } else {
          assert.fail(`Unexpected native API key ${params.srfkey}`);
        }
        return;
      }
      const asset = url.pathname.match(/^\/packages\/(original|recovered)\/(.+)$/);
      if (asset) {
        const root = asset[1] === 'original' ? originalRoot : builtRoot;
        const file = resolve(root, decodeURIComponent(asset[2]));
        assert.ok(file.startsWith(`${resolve(root)}/`), 'Asset path escaped package');
        const contentType = { '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css',
          '.json': 'application/json', '.svg': 'image/svg+xml' }[extname(file)] || 'application/octet-stream';
        const bytes = await readFile(file);
        response.writeHead(200, { 'Content-Type': contentType });
        response.end(bytes);
        return;
      }
      response.writeHead(404);
      response.end('Unknown fixture route');
    } catch (error) {
      failures.push({ url: request.url, error: error.stack || String(error) });
      if (!response.headersSent) response.writeHead(500);
      response.end('Fixture server failure');
    }
  });
  await new Promise((done, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', done);
  });
  return {
    origin: `http://127.0.0.1:${server.address().port}`, calls, failures,
    pendingRootChildren,
    releaseRootChildren(key) {
      const release = pendingRootChildren.get(key);
      assert.ok(release, `No pending root-child request for ${key}`);
      pendingRootChildren.delete(key);
      release();
    },
    close: () => new Promise(done => {
      for (const release of pendingRootChildren.values()) release();
      pendingRootChildren.clear();
      server.close(done);
      server.closeAllConnections();
    }),
  };
}

async function snapshot(page) {
  return page.evaluate(() => {
    const runtime = document.getElementById('runtime');
    const lists = [...runtime.querySelectorAll('ibiz-model-runtime-list')];
    function dom(node) {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent;
      if (node.nodeType !== Node.ELEMENT_NODE) return null;
      return {
        tag: node.tagName.toLowerCase(),
        attrs: Object.fromEntries([...node.attributes]
          .filter(attribute => !['s-id', 'c-id'].includes(attribute.name) &&
            !(attribute.name === 'style' && attribute.value === ''))
          .sort((a, b) => a.name.localeCompare(b.name)).map(attribute => [attribute.name, attribute.value])),
        children: [...node.childNodes].map(dom).filter(value => value !== null),
      };
    }
    const content = runtime.querySelector('.ibiz-model-runtime-content');
    return {
      dom: dom(runtime),
      props: {
        url: runtime.url.replace(/\/(original|recovered)\//, '/SIDE/'),
        parentKey: runtime.parentKey,
        configBaseUrl: runtime.configBaseUrl.replace(/\/(original|recovered)\//, '/SIDE/'),
        headers: runtime.headers,
        lists: lists.map(list => ({ index: list.index, parent: list.parent, items: list.items })),
      },
      rows: lists.map(list => [...list.querySelectorAll('.model-runtime-list-item')].map(row => ({
        text: row.textContent, active: row.classList.contains('active'), api: row.classList.contains('api'),
        titles: [...row.querySelectorAll('[title]')].map(element => element.title),
      }))),
      layout: {
        contentWidth: content.clientWidth, scrollWidth: content.scrollWidth,
        scrollLeft: Math.round(content.scrollLeft),
        columns: [...runtime.querySelectorAll('.ibiz-model-runtime-column')].map(column => ({
          width: column.getBoundingClientRect().width, height: column.getBoundingClientRect().height,
        })),
        breadcrumbDisplay: getComputedStyle(runtime.querySelector('.ibiz-model-runtime-breadcrumb-container')).display,
        emptyDisplay: getComputedStyle(runtime.querySelector('.ibiz-model-runtime-empty')).display,
      },
    };
  });
}

function normalizeSnapshot(value) {
  // Only server routing prefixes differ; hydration ids are already excluded above.
  return JSON.parse(JSON.stringify(value).replaceAll('/original/', '/SIDE/').replaceAll('/recovered/', '/SIDE/'));
}

async function screenshot(page, side, viewport, stage, result) {
  await page.evaluate(() => document.activeElement?.blur());
  const path = join(output, `${viewport}-${side}-${stage}.png`);
  const bytes = await page.screenshot({ path, animations: 'disabled', caret: 'hide' });
  const image = screenshotPixels(bytes);
  const dimensions = page.viewportSize();
  assert.equal(image.width, dimensions.width);
  assert.equal(image.height, dimensions.height);
  assert.ok(image.colors > 50, `Blank/flat screenshot: ${image.colors} colors`);
  assert.ok(image.luminanceRange > 80, 'Screenshot has no meaningful content contrast');
  result.screenshots.push({
    stage, path, sha256: sha256(bytes), width: image.width, height: image.height,
    colors: image.colors, luminanceRange: image.luminanceRange,
  });
}

async function waitForRows(page, counts) {
  await page.waitForFunction(expected => {
    const lists = [...document.querySelectorAll('#runtime ibiz-model-runtime-list')];
    return lists.length === expected.length &&
      lists.every((list, index) => list.querySelectorAll('.model-runtime-list-item').length === expected[index]);
  }, counts);
  await page.waitForFunction(() => ['rootLoadingPanel', 'rootLoadingMask', 'loadingPanel']
    .every(id => {
      const host = document.getElementById(id);
      const element = id === 'rootLoadingMask' ? host.querySelector('.loading-mask') : host;
      return getComputedStyle(element).display === 'none';
    }));
}

async function waitForNodeCalls(fixture, key, count) {
  const deadline = Date.now() + 10_000;
  while (fixture.calls.get(key).filter(call => call.endpoint === 'nodes').length < count) {
    assert.ok(Date.now() < deadline, `Expected ${count} real native POST requests for ${key}`);
    await new Promise(done => setTimeout(done, 20));
  }
}

async function loadingMethods(page) {
  return page.evaluate(async () => {
    const panel = document.getElementById('rootLoadingPanel');
    const mask = document.getElementById('rootLoadingMask');
    const defaultPanel = document.createElement('loading-panel');
    defaultPanel.setAttribute('default-show', '');
    document.getElementById('fixture').append(defaultPanel);
    await defaultPanel.componentOnReady();
    await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
    const defaultState = { prop: defaultPanel.defaultShow, display: getComputedStyle(defaultPanel).display };
    await defaultPanel.hide();
    defaultPanel.remove();
    const exposed = { panelShow: typeof panel.show, panelHide: typeof panel.hide,
      maskShow: typeof mask.show, maskHide: typeof mask.hide };
    const show = panel.show('Working fixture');
    const returnsPromise = show instanceof Promise;
    await show;
    await mask.show();
    await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
    const shown = { panel: getComputedStyle(panel).display, mask: getComputedStyle(mask.querySelector('.loading-mask')).display };
    await panel.hide();
    await mask.hide();
    await new Promise(done => requestAnimationFrame(() => requestAnimationFrame(done)));
    const hidden = { panel: getComputedStyle(panel).display, mask: getComputedStyle(mask.querySelector('.loading-mask')).display };
    return { exposed, returnsPromise, defaultState, shown, hidden };
  });
}

async function workflow(page, fixture, key, side, viewport, result) {
  await waitForRows(page, [30]);
  await waitForRuntimeModelScrollEnd(page);
  result.checkpoints.initial = normalizeSnapshot(await snapshot(page));
  const firstList = page.locator('#runtime ibiz-model-runtime-list').first();
  assert.equal(await firstList.locator('.ibiz-model-runtime-list-title').textContent(), rootNode.psmodelrtname);
  assert.equal(await firstList.locator('.model-runtime-item-content-method').first().textContent(), 'openChild:');
  const headers = result.checkpoints.initial.props.headers;
  assert.deepEqual(headers, { Authorization: 'Bearer fixture', 'X-Fixture': 'controlled' });
  assert.equal(result.checkpoints.initial.props.lists[0].items[0].data.apiReturn, 'Child');
  await screenshot(page, side, viewport, 'initial', result);
  result.loadingMethods = await loadingMethods(page);
  assert.deepEqual(result.loadingMethods.exposed, {
    panelShow: 'function', panelHide: 'function', maskShow: 'function', maskHide: 'function',
  });
  assert.equal(result.loadingMethods.returnsPromise, true);
  assert.deepEqual(result.loadingMethods.defaultState, { prop: true, display: 'flex' });
  assert.deepEqual(result.loadingMethods.shown, { panel: 'flex', mask: 'flex' });
  assert.deepEqual(result.loadingMethods.hidden, { panel: 'none', mask: 'none' });

  const input = firstList.locator('.ibiz-model-runtime-list-search-input');
  await input.fill('ignored');
  await input.fill(' Value 7 ');
  assert.equal(await firstList.locator('.model-runtime-list-item').count(), 30, 'Debounce must not run synchronously');
  await waitForRows(page, [11]);
  result.checkpoints.search = normalizeSnapshot(await snapshot(page));
  assert.ok(result.checkpoints.search.rows[0].every(row => /Value 7/.test(row.text)));
  await input.fill('');
  await waitForRows(page, [30]);
  await firstList.locator('.ibiz-model-runtime-list').evaluate(element => { element.scrollTop = element.scrollHeight; });
  await waitForRows(page, [70]);
  result.pagination = { initial: 30, firstScroll: 70, expectedPageSize: 10,
    originalIssue: 'pagination-delete-count', functionalAcceptance: false };
  await firstList.locator('.ibiz-model-runtime-list').evaluate(element => { element.scrollTop = element.scrollHeight; });
  await waitForRows(page, [92]);
  result.pagination.secondScroll = 92;
  assert.equal(await firstList.locator('.model-runtime-list-item.api').count(), 1);
  await firstList.locator('.ibiz-model-runtime-list').evaluate(element => { element.scrollTop = 0; });
  const beforeCopy = fixture.calls.get(key).filter(call => call.endpoint === 'nodes').length;
  result.copy = [];
  for (const [selector, modifier, expected] of [
    ['.model-runtime-item-content-method', 'Control', 'openChild'],
    ['.model-runtime-item-content-value', 'Meta', 'child-value'],
  ]) {
    await firstList.locator(selector).first().click({ modifiers: [modifier] });
    await page.waitForFunction(() => document.querySelector('.dynamic-model-copy-float-text') !== null);
    const text = await page.evaluate(() => navigator.clipboard.readText());
    assert.equal(text, expected, 'Actual browser clipboard must contain the native copied text');
    const floats = await page.locator('.dynamic-model-copy-float-text').allTextContents();
    assert.ok(floats.some(value => value.includes(expected) && value.includes('\u6210\u529f\u590d\u5236')));
    result.copy.push({ modifier, text, float: floats.find(value => value.includes(expected)) });
  }
  assert.equal(fixture.calls.get(key).filter(call => call.endpoint === 'nodes').length, beforeCopy,
    'Ctrl/Meta copy must not trigger child navigation');
  await firstList.locator('.model-runtime-item-arrow').first().click();
  await waitForRows(page, [92, 4]);
  result.selection = {
    renderedActiveRows: await firstList.locator('.model-runtime-list-item.active').count(),
    expectedActiveRows: 1, originalIssue: 'selection-not-reactive', functionalAcceptance: false,
  };
  assert.equal(result.selection.renderedActiveRows, 0,
    'Diagnose the original non-reactive selection; do not claim UI selection acceptance');
  const secondList = page.locator('#runtime ibiz-model-runtime-list').nth(1);
  await secondList.locator('.model-runtime-item-arrow').first().click();
  await waitForRows(page, [92, 4, 1]);
  await page.waitForFunction(() => document.querySelector('.dynamic-model-copy-float-text') === null);
  await waitForRuntimeModelScrollEnd(page);
  result.checkpoints.navigation = normalizeSnapshot(await snapshot(page));
  assert.equal(result.checkpoints.navigation.layout.breadcrumbDisplay, 'block');
  assert.equal(result.checkpoints.navigation.props.lists[2].parent.id, nestedNode.psmodelrtid);
  await screenshot(page, side, viewport, 'navigation', result);
  const breadcrumb = page.locator('.ibiz-model-runtime-breadcrumb-item').first();
  await breadcrumb.hover();
  await page.waitForFunction(() => document.querySelector('.ibiz-model-runtime-column').classList.contains('hover'));
  await breadcrumb.click();
  await page.waitForFunction(() => document.querySelector('.ibiz-model-runtime-content').scrollLeft === 0);
  result.breadcrumb = { returnedToFirstColumn: true, firstColumnHover: true };
  await page.mouse.move(0, 100);
  const beforeRefresh = fixture.calls.get(key).filter(call => call.endpoint === 'nodes').length;
  await page.evaluate(() => { window.fixture.stage = 'refresh'; });
  await firstList.locator('.ibiz-model-runtime-refresh').click();
  await waitForRows(page, [30]);
  await waitForRuntimeModelScrollEnd(page);
  assert.equal(fixture.calls.get(key).filter(call => call.endpoint === 'nodes').length, beforeRefresh + 1);
  assert.equal(await firstList.locator('.model-runtime-list-item.active').count(), 0);
  result.checkpoints.refresh = normalizeSnapshot(await snapshot(page));

  const beforeWatcher = fixture.calls.get(key).filter(call => call.endpoint === 'nodes').length;
  await page.evaluate(() => { window.fixture.stage = 'parent-watcher'; });
  await page.locator('#runtime').evaluate(element => element.setAttribute('parent-key', 'parent-second'));
  await page.waitForFunction(() => document.getElementById('runtime').parentKey === 'parent-second');
  await waitForNodeCalls(fixture, key, beforeWatcher + 2);
  assert.ok(fixture.pendingRootChildren.has(key), 'The replacement child response must remain pending');
  try {
    await page.waitForFunction(() =>
      document.querySelectorAll('#runtime ibiz-model-runtime-list').length === 0 &&
      getComputedStyle(document.getElementById('rootLoadingPanel')).display !== 'none');
    result.parentReloadBoundary = { oldColumnsRemovedWhileChildPending: true };
  } finally {
    fixture.releaseRootChildren(key);
  }
  await waitForRows(page, [30]);
  await page.waitForFunction(() => window.fixture.mounted.some(event =>
    event.stage === 'parent-watcher' && event.index === 0 &&
    event.parentId === 'PSSYSAPP@ROOT' && event.itemCount === 92));
  await page.waitForFunction(() => document.getElementById('rootLoadingPanel').style.display === '');
  await waitForRuntimeModelScrollEnd(page);
  const afterWatcher = fixture.calls.get(key).filter(call => call.endpoint === 'nodes');
  assert.equal(afterWatcher.length, beforeWatcher + 2);
  assert.deepEqual(afterWatcher.slice(-2).map(call => call.params), [
    { srfkey: '#', srfparentkey: 'parent-second' },
    { srfkey: rootNode.psmodelrtid, srfparentkey: 'parent-second' },
  ]);
  await page.locator('#runtime').evaluate(element => element.setAttribute('parent-key', 'parent-second'));
  await page.waitForTimeout(350);
  assert.equal(fixture.calls.get(key).filter(call => call.endpoint === 'nodes').length, afterWatcher.length);
  result.checkpoints.parentWatcher = normalizeSnapshot(await snapshot(page));
  result.attributeCoercion = await firstList.evaluate(list => {
    list.setAttribute('index', '7');
    const numeric = { value: list.index, type: typeof list.index };
    list.setAttribute('index', '0');
    return { numeric, restored: list.index, headersAttribute: document.getElementById('runtime').getAttribute('headers') };
  });
  assert.deepEqual(result.attributeCoercion, { numeric: { value: 7, type: 'number' }, restored: 0, headersAttribute: null });
  await firstList.evaluate(list => {
    list.items = [{ id: 'watch-one', leaf: true,
      data: { logicName: 'Watch replacement', methodName: 'getWatch', val: 'watch-value' } }];
  });
  await waitForRows(page, [1]);
  assert.ok((await firstList.locator('.model-runtime-list-item').textContent()).includes('Watch replacement'));
  await firstList.evaluate(list => { list.items[0].data.logicName = 'Mutated input'; });
  await input.fill('Watch replacement');
  await waitForRows(page, [1]);
  await page.waitForTimeout(350);
  assert.ok((await firstList.locator('.model-runtime-list-item').textContent()).includes('Watch replacement'),
    'Actual items watcher must deep clone, not leak the mutated input into the next render');
  result.checkpoints.itemsWatcher = normalizeSnapshot(await snapshot(page));
  result.knownDefectStart = result.pageErrors.length;
  await input.fill('[');
  await page.waitForFunction(() => window.fixture.invalidSearchObserved === true);
  result.invalidSearch = {
    errors: result.pageErrors.slice(result.knownDefectStart),
    originalIssue: 'unescaped-search-expression', functionalAcceptance: false,
  };
  assert.equal(result.invalidSearch.errors.length, 1);
  assert.match(result.invalidSearch.errors[0], /Invalid regular expression.*Unterminated character class/);
}

async function errorScenario(page, fixture, key, scenario, result) {
  if (scenario === 'empty-root') {
    await page.waitForFunction(() => getComputedStyle(document.getElementById('rootLoadingPanel')).display === 'none');
    assert.equal(await page.locator('#runtime ibiz-model-runtime-list').count(), 0);
    result.checkpoints.emptyRoot = normalizeSnapshot(await snapshot(page));
    assert.equal(result.checkpoints.emptyRoot.layout.emptyDisplay, 'none');
    assert.notEqual(await page.locator('.ibiz-model-runtime-content').evaluate(element => getComputedStyle(element).display), 'none');
    assert.deepEqual(result.consoleErrors, ['\u6839\u8282\u70b9\u6570\u636e\u52a0\u8f7d\u5f02\u5e38']);
    result.knownDefect = { id: 'empty-root-never-loaded', functionalAcceptance: false };
    return;
  }
  await page.waitForFunction(() =>
    getComputedStyle(document.querySelector('.ibiz-model-runtime-empty')).display !== 'none' &&
    getComputedStyle(document.getElementById('rootLoadingPanel')).display === 'none');
  assert.equal(await page.locator('#runtime ibiz-model-runtime-list').count(), 0);
  result.checkpoints.error = normalizeSnapshot(await snapshot(page));
  const message = scenario === 'error401' ? '' : scenario === 'error504'
    ? '\u6a21\u578b\u52a0\u8f7d\u8d85\u65f6\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5!' : 'fixture-failure';
  assert.equal(await page.locator('.ibiz-model-runtime-empty-error').textContent(), message);
  await page.locator('.ibiz-model-runtime-empty-refresh a').click();
  await waitForRows(page, [30]);
  result.checkpoints.reloaded = normalizeSnapshot(await snapshot(page));
  assert.equal(fixture.calls.get(key).filter(call => call.endpoint === 'nodes').length, 3);
}

test('real original loader vs independently source-built loader: browser fixture parity, never native acceptance',
  { timeout: 180_000 }, async t => {
    const report = {
      contract: 'runtime-model-real-loader-browser-differential',
      startedAt: new Date().toISOString(), fixtureAcceptance: false, nativeAcceptance: false,
      boundary: 'Real Stencil loaders/components/clipboard in Chromium; controlled HTTP API fixtures, not native ModelDesign or PLM acceptance',
      builtRoot, originalRoot, sourceBuild: null, knownOriginalIssues,
      viewports: {}, errors: [],
    };
    await mkdir(output, { recursive: true });
    t.after(async () => {
      report.completedAt = new Date().toISOString();
      const cases = Object.values(report.viewports).flatMap(viewport => Object.values(viewport));
      report.fixtureAcceptance = cases.length === viewportCases.length * scenarios.length &&
        cases.every(item => item.status === 'passed') && report.errors.length === 0;
      report.status = report.fixtureAcceptance ? 'fixture-parity-passed-not-native-accepted' : 'failed';
      await writeFile(join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
      t.diagnostic(`runtime-model browser evidence: ${join(output, 'report.json')}`);
    });
    let provenanceError;
    try {
      report.sourceBuild = sourceBuildEvidence();
    } catch (error) {
      report.errors.push(error.stack || String(error));
      provenanceError = error;
    }
    await t.test('independent source-build provenance and exact tested output hashes', () => {
      if (provenanceError) throw provenanceError;
      assert.equal(report.sourceBuild.sourceBuildVerified, true);
    });
    if (provenanceError) return;
    const fixture = await fixtureServer(report.sourceBuild);
    t.after(fixture.close);
    const browser = await launchChromium(chromium);
    t.after(() => browser.close());
    for (const [viewportName, viewport] of viewportCases) {
      report.viewports[viewportName] = {};
      for (const scenario of scenarios) {
        await t.test(`${viewportName}/${scenario}`, { timeout: 45_000 }, async () => {
          const comparison = { status: 'failed', viewport, sides: {} };
          report.viewports[viewportName][scenario] = comparison;
          for (const side of ['original', 'recovered']) {
            const result = {
              status: 'failed', checkpoints: {}, screenshots: [],
              pageErrors: [], consoleErrors: [], requestFailures: [], httpErrors: [], externalRequests: [],
              loadedResources: [], resourceErrors: [], browserResourcesVerified: false,
            };
            comparison.sides[side] = result;
            const context = await browser.newContext({
              viewport, serviceWorkers: 'block', permissions: ['clipboard-read', 'clipboard-write'],
            });
            const key = `${side}/${scenario}`;
            const resourceReads = [];
            try {
              if (side === 'recovered' && provenanceError) throw provenanceError;
              await context.route('**/*', route => {
                if (new URL(route.request().url()).origin === fixture.origin) return route.continue();
                result.externalRequests.push(route.request().url());
                return route.abort();
              });
              const page = await context.newPage();
              page.setDefaultTimeout(10_000);
              page.on('pageerror', error => {
                result.pageErrors.push(error.message);
                if (/Invalid regular expression.*Unterminated character class/.test(error.message)) {
                  void page.evaluate(() => { window.fixture.invalidSearchObserved = true; }).catch(() => {});
                }
              });
              page.on('console', message => {
                if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:')) {
                  result.consoleErrors.push(message.text());
                }
              });
              page.on('requestfailed', request => result.requestFailures.push({
                url: request.url(), error: request.failure()?.errorText,
              }));
              page.on('response', response => {
                if (response.status() >= 400) result.httpErrors.push({ url: response.url(), status: response.status() });
                const url = new URL(response.url());
                if (url.origin === fixture.origin && url.pathname.startsWith('/packages/')) {
                  resourceReads.push((async () => {
                    const bytes = await response.body();
                    result.loadedResources.push(runtimeModelResourceResponse({
                      sourceBuild: report.sourceBuild, side, origin: fixture.origin,
                      url: response.url(), status: response.status(),
                      resourceType: response.request().resourceType(), bytes,
                    }));
                  })().catch(error => {
                    result.resourceErrors.push({ url: response.url(), error: error.stack || String(error) });
                  }));
                }
              });
              await page.goto(`${fixture.origin}/fixture/${side}/${scenario}`);
              await page.waitForFunction(() => window.fixture?.ready === true);
              if (scenario === 'workflow') await workflow(page, fixture, key, side, viewportName, result);
              else await errorScenario(page, fixture, key, scenario, result);
              await page.waitForTimeout(100);
              await Promise.all(resourceReads);
              assert.deepEqual(result.resourceErrors, [], 'Actual browser loader resource verification failed');
              result.browserResourcesVerified = verifyRuntimeModelLoadedResources(
                report.sourceBuild, side, result.loadedResources,
              );
              result.mounted = await page.evaluate(() => window.fixture.mounted);
              result.apiCalls = fixture.calls.get(key);
              assert.ok(scenario === 'empty-root' || result.mounted.length > 0, 'Actual mounted events are required');
              assert.ok(result.mounted.every(event => event.target === 'ibiz-model-runtime-list' &&
                event.bubbles && event.cancelable && event.composed && event.detail === null));
              assert.deepEqual(result.externalRequests, []);
              assert.deepEqual(result.requestFailures, []);
              const allowedPageErrors = scenario === 'workflow' ? result.invalidSearch.errors : [];
              assert.deepEqual(result.pageErrors, allowedPageErrors, 'Unexpected real component JS errors');
              assert.deepEqual(result.consoleErrors,
                scenario === 'empty-root' ? ['\u6839\u8282\u70b9\u6570\u636e\u52a0\u8f7d\u5f02\u5e38'] : []);
              assert.deepEqual(result.httpErrors.map(item => item.status),
                scenario.startsWith('error') ? [Number(scenario.slice(5))] : []);
              assert.equal(fixture.failures.length, 0, JSON.stringify(fixture.failures));
              assert.ok(result.apiCalls.some(call => call.params.srfkey === '#'));
              result.status = 'passed';
            } catch (error) {
              result.error = error.stack || String(error);
              const page = context.pages()[0];
              if (page && !page.isClosed()) {
                await page.screenshot({ path: join(output, `${viewportName}-${side}-${scenario}-failure.png`) }).catch(() => {});
              }
            } finally {
              await Promise.all(resourceReads);
              result.loadedResources.sort((a, b) => a.path.localeCompare(b.path));
              await context.close();
            }
          }
          const { original, recovered } = comparison.sides;
          try {
            assert.equal(original.status, 'passed', original.error);
            assert.equal(recovered.status, 'passed', recovered.error);
            for (const key of ['checkpoints', 'loadingMethods', 'pagination', 'copy', 'selection', 'breadcrumb',
              'attributeCoercion', 'parentReloadBoundary', 'invalidSearch', 'knownDefect', 'mounted',
              'apiCalls', 'consoleErrors']) {
              assert.deepEqual(recovered[key], original[key], `${key}: source-built behavior/DOM differs from original`);
            }
            comparison.status = 'passed';
          } catch (error) {
            comparison.error = error.stack || String(error);
            report.errors.push(`${viewportName}/${scenario}: ${comparison.error}`);
            throw error;
          }
        });
      }
    }
  });
