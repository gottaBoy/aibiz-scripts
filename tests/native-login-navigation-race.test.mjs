import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test, { after, before } from 'node:test';
import { launchChromium } from '../browser-launch.mjs';
import { workspace } from '../localization-baseline.mjs';

const require = createRequire(join(workspace, 'modelingweb/app/package.json'));
const ts = require('typescript');
const playwright = createRequire(join(workspace, 'ibiz-app-hub/package.json'))('playwright');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const providerPath = 'modelingweb/packages-latest/@ibiz-template/vue3-components/src/web-app/util/app-func-block-provider/app-func-block-provider.ts';
const specifications = [
  { name: 'hub-engine', className: 'LoginViewEngine',
    path: 'ibiz-app-hub/components/ibiz-next-vue3/src/view-engine/login-view.engine.ts', engine: true, thirdAuth: true },
  { name: 'hub-util', className: 'AppUtil',
    path: 'ibiz-app-hub/components/ibiz-next-vue3/src/util/app-util/app-util.ts' },
  { name: 'snapshot-provider', className: 'AppFuncBlockProvider', path: providerPath, provider: true, thirdAuth: true },
  { name: 'snapshot-util', className: 'AppUtil',
    path: 'modelingweb/packages-latest/@ibiz-template/vue3-components/src/util/app-util/app-util.ts', delegated: true, thirdAuth: true },
  { name: 'snapshot-engine', className: 'LoginViewEngine',
    path: 'modelingweb/packages-latest/@ibiz-template/vue3-components/src/view-engine/login-view.engine.ts',
    engine: true, delegated: true, thirdAuth: true },
];
const inputs = new Map();
function actualLoginMethod(path, className) {
  const bytes = fs.readFileSync(join(workspace, path));
  inputs.set(path, hash(bytes));
  const parsed = ts.createSourceFile(path, bytes.toString(), ts.ScriptTarget.Latest, true);
  const owner = parsed.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === className);
  assert.ok(owner, `Missing production class ${className}`);
  const methods = owner.members.filter(node => ts.isMethodDeclaration(node) && node.name.getText(parsed) === 'login');
  assert.equal(methods.length, 1);
  return ts.transpileModule(`class NativeLoginMethod { ${methods[0].getText(parsed)} }\nexports.NativeLoginMethod = NativeLoginMethod;`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
}
const methods = specifications.map(spec => ({ ...spec, code: actualLoginMethod(spec.path, spec.className) }));
const providerCode = methods.find(spec => spec.provider).code;
let server;
let browser;
let origin;
let serial = 0;
const generations = new Map();
before(async () => {
  server = createServer((request, response) => {
    if (request.url === '/org-bootstrap') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end('{"controlledFixtureOnly":true}');
      return;
    }
    if (request.url === '/favicon.ico') { response.writeHead(204); response.end(); return; }
    const pathname = new URL(request.url, 'http://fixture').pathname;
    const generation = (generations.get(pathname) ?? 0) + 1;
    generations.set(pathname, generation);
    const send = () => {
      response.writeHead(200, { 'content-type': 'text/html' });
      response.end(`<!doctype html><html><body><main id="fixture">Controlled login transition</main><script>
        const read = () => JSON.parse(sessionStorage.getItem('login-transition') || '{"documents":0,"hashchanges":[],"popstates":[],"pushes":[],"auth":[],"callbacks":[]}');
        const update = fn => { const value = read(); fn(value); sessionStorage.setItem('login-transition', JSON.stringify(value)); };
        update(value => { value.documents++; value.lastHash = location.hash; value.lastState = history.state; });
        addEventListener('hashchange', () => {
          update(value => value.hashchanges.push({ hash: location.hash, documents: value.documents }));
          const request = new XMLHttpRequest();
          request.open('GET', '/org-bootstrap');
          request.send();
        });
        addEventListener('popstate', () => update(value => value.popstates.push(location.hash)));
        const nativePush = history.pushState.bind(history);
        history.pushState = (state, title, url) => {
          update(value => value.pushes.push({ state, title, url: url === undefined ? null : url }));
          return nativePush(state, title, url);
        };
        window.transitionFixture = { read, update };
      </script></body></html>`);
    };
    // Keep the old document alive long enough to observe the real post-login hashchange.
    if (generation > 1) setTimeout(send, 120);
    else send();
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  origin = `http://127.0.0.1:${server.address().port}`;
  browser = await launchChromium(playwright.chromium, { args: ['--no-sandbox'] });
});
after(async () => {
  await browser?.close();
  await new Promise(done => { server.closeAllConnections(); server.close(done); });
  for (const [path, sha256] of inputs) assert.equal(hash(fs.readFileSync(join(workspace, path))), sha256);
});

async function execute(t, spec, { ok = true, authThrows = false,
  ru = '/psdevslnsys=controlled_root/modelingindex/-?title=A%26B&name=C%3DD',
  thirdFailure = false } = {}) {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  t.after(() => context.close());
  const page = await context.newPage();
  const pathname = `/case-${++serial}`;
  const search = thirdFailure ? '?srfthird_auth_success=false' : '?keep=source';
  const loginHash = `/login${ru === undefined ? '' : `?ru=${encodeURIComponent(ru)}`}`;
  await page.goto(`${origin}${pathname}${search}#${loginHash}`);
  await page.evaluate(() => history.replaceState({ staleLoginState: true }, '', location.href));
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('requestfailed', request => errors.push(
    `${request.method()} ${new URL(request.url()).pathname}: ${request.failure()?.errorText}`,
  ));
  let returnValue;
  try {
    returnValue = await page.evaluate(async input => {
      const { update } = window.transitionFixture;
      window.ibiz = { auth: { login: async (...args) => {
        update(value => value.auth.push(args));
        if (input.authThrows) throw new Error('controlled-auth-failure');
        return input.ok;
      } } };
      const evaluate = code => {
        const exports = {};
        new Function('exports', 'ibiz', 'notNilEmpty', 'getAppFuncBlockProvider', code)(
          exports, window.ibiz, value => value !== undefined && value !== null && value !== '',
          async () => provider,
        );
        return exports.NativeLoginMethod;
      };
      const Provider = evaluate(input.providerCode);
      const provider = new Provider();
      const Method = evaluate(input.spec.code);
      const owner = new Method();
      owner.route = { query: { ru: input.ru } };
      owner.router = { currentRoute: { value: { query: { ru: input.ru } } } };
      owner.view = { layoutPanel: { validate: async () => true, data: { isRemember: true } },
        evt: { emit: (_name, event) => update(value => value.callbacks.push(event.ok)) } };
      const callback = result => update(value => value.callbacks.push(result));
      try {
        const result = input.spec.engine
          ? await owner.login({ data: [{ username: 'controlled-user', password: 'controlled-password' }] })
          : input.spec.provider
            ? await owner.login({ loginname: 'controlled-user', password: 'controlled-password',
              rememberme: true, headers: { 'x-controlled': 'value' } }, callback)
            : await owner.login('controlled-user', 'controlled-password', true, { 'x-controlled': 'value' });
        return { result: result ?? null };
      } catch (error) { return { error: error.message }; }
    }, { spec, providerCode, ok, authThrows, ru });
  } catch (error) {
    assert.match(error.message, /Execution context was destroyed|Cannot find context|navigation/i);
  }
  if (ok && !authThrows) {
    await page.waitForFunction(() => window.transitionFixture?.read().documents >= 2);
    await page.waitForLoadState('load');
  } else await page.waitForTimeout(30);
  const result = await page.evaluate(() => ({
    ...window.transitionFixture.read(), href: location.href, hash: location.hash, state: history.state,
  }));
  assert.deepEqual(errors, []);
  return { ...result, returnValue, pathname, search };
}

for (const spec of methods) {
  test(`${spec.name}: actual login method changes URL/state once, reloads, and never dispatches old-document hashchange`, async t => {
    const result = await execute(t, spec);
    assert.equal(result.documents, 2);
    assert.equal(result.hash, '#/psdevslnsys=controlled_root/modelingindex/-?title=A%26B&name=C%3DD');
    assert.deepEqual(result.state, {});
    assert.deepEqual(result.hashchanges, [], 'A post-login hashchange must not bootstrap the old document before reload');
    assert.deepEqual(result.popstates, []);
    assert.equal(result.pushes.length, 1);
    assert.deepEqual(result.pushes[0], { state: {}, title: '',
      url: `${origin}${result.pathname}${result.search}#/psdevslnsys=controlled_root/modelingindex/-?title=A%26B&name=C%3DD` });
    assert.equal(result.auth.length, 1);
    assert.equal(result.auth[0][0], 'controlled-user');
    if (spec.engine || spec.provider) assert.deepEqual(result.callbacks, [true]);
  });

  test(`${spec.name}: failed authentication leaves URL, history state and the existing error/result chain intact`, async t => {
    const result = await execute(t, spec, { ok: false });
    assert.equal(result.documents, 1);
    assert.ok(result.hash.startsWith('#/login?ru='));
    assert.deepEqual(result.state, { staleLoginState: true });
    assert.deepEqual(result.pushes, []);
    assert.deepEqual(result.hashchanges, []);
    if (!spec.engine) assert.equal(result.returnValue.result, false);
    if (spec.engine || spec.provider) assert.deepEqual(result.callbacks, [false]);
  });

  test(`${spec.name}: a rejected authentication promise never becomes a navigation or reload`, async t => {
    const result = await execute(t, spec, { authThrows: true });
    assert.equal(result.documents, 1);
    assert.deepEqual(result.pushes, []);
    assert.deepEqual(result.state, { staleLoginState: true });
    assert.deepEqual(result.hashchanges, []);
    assert.equal(result.returnValue.error, 'controlled-auth-failure');
  });

  test(`${spec.name}: an empty return URL retains the existing root fallback without old-document navigation events`, async t => {
    const result = await execute(t, spec, { ru: '' });
    assert.equal(result.documents, 2);
    assert.equal(result.hash, '#/');
    assert.deepEqual(result.state, {});
    assert.deepEqual(result.hashchanges, []);
    assert.equal(result.pushes[0].url, `${origin}${result.pathname}${result.search}#/`);
  });

  test(`${spec.name}: a hash-prefixed return URL preserves native hash-setter semantics`, async t => {
    const result = await execute(t, spec, { ru: '#/modelingindex/-?name=A%20B' });
    assert.equal(result.documents, 2);
    assert.equal(result.hash, '#/modelingindex/-?name=A%20B');
    assert.deepEqual(result.hashchanges, []);
    assert.deepEqual(result.state, {});
    assert.equal(result.pushes[0].url, `${origin}${result.pathname}${result.search}#/modelingindex/-?name=A%20B`);
  });

  if (spec.thirdAuth) test(`${spec.name}: the existing third-auth failure parameter cleanup still performs one clean navigation`, async t => {
    const result = await execute(t, spec, { thirdFailure: true });
    assert.equal(result.documents, 2);
    assert.equal(new URL(result.href).search, '');
    assert.equal(result.href.includes('srfthird_auth_success=false'), false);
    assert.equal(result.hash, '#/psdevslnsys=controlled_root/modelingindex/-?title=A%26B&name=C%3DD');
    assert.deepEqual(result.hashchanges, []);
    assert.equal(result.pushes.length, 1);
    assert.deepEqual(result.pushes[0].state, {});
  });
}

test('snapshot provider still rejects a login-loop return URL without changing logout or unrelated redirect methods', async t => {
  const result = await execute(t, methods.find(spec => spec.provider), { ru: '/login?ru=loop' });
  assert.equal(result.hash, '#/');
  assert.deepEqual(result.hashchanges, []);
});
