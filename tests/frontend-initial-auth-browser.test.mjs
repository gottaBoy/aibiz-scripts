import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { mkdtemp, mkdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { launchChromium } from '../browser-launch.mjs';
import { workspace } from '../localization-baseline.mjs';

const require = createRequire(join(workspace, 'modelingweb/app/package.json'));
const { build } = require('vite');
const ts = require('typescript');
const playwright = createRequire(join(workspace, 'ibiz-app-hub/package.json'))('playwright');
const sourceRoots = [
  ['hub', 'ibiz-app-hub/components/ibiz-next-vue3/src/web-app'],
  ['active', 'modelingweb/packages-latest/@ibiz-template/vue3-components/src/web-app'],
];
const origin = 'http://127.0.0.1:32491';
const returnUrl = '/psdevslnsys=owned-root/modelingindex/-?name=A%26B';
const hash = value => createHash('sha256').update(value).digest('hex');

async function browserFixture(directory) {
  const inputs = ['guard/auth-guard/auth-guard.ts', 'router/index.ts'].map(suffix => {
    const path = join(workspace, directory, suffix);
    const bytes = fs.readFileSync(path);
    return { path, sha256: hash(bytes), code: ts.transpileModule(bytes.toString('utf8'), {
      compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
    }).outputText };
  });
  const entry = join(workspace, 'modelingweb/app/initial-auth-browser-fixture.mjs');
  const source = `
import { createApp, h } from 'vue';
import * as router from 'vue-router';
import qs from 'qs';
window.observation = { protectedRequests: [], modelPermissions: [], errors: [] };
const state = window.observation;
window.ibiz = {
  env: { routePlaceholder: '-', loginMode: 'DEFAULT', enableAnonymous: false,
    requireOrganizationContext: true, dcSystem: 'owned-fixture' },
  auth: { getAuthInfo: () => undefined },
  hub: { loadExtensionPlugin: async () => undefined },
  net: { get: path => { state.protectedRequests.push(path); return fetch('/unexpected-api'); } },
  util: { error: { handle: error => { state.errors.push(String(error)); } } }
};
const LoginView = { render: () => h('main', { id: 'login-fixture' }, 'Controlled Login Fixture') };
const components = {
  LoginView, ErrorView: {}, UnauthorizedView: {},
  ModalRouterShell: {}, RouterShell: { render: () => h('main', { id: 'protected-fixture' }, 'Protected') },
  ShareView: {}, AppRedirectView: {}
};
const dependencies = {
  'vue-router': router, qs,
  '@ibiz-template/core': {
    CoreConst: { TOKEN_REMEMBER: 'remember', REFRESH_TOKEN: 'refresh' },
    LoginMode: { DEFAULT: 'DEFAULT' }, getAppCookie: () => undefined,
  },
  '@ibiz-template/runtime': { RouteConst: { ROUTE_MODAL_TAG: 'modal' } },
  '@ibiz-template/vue3-util': {
    AppRedirectView: components.AppRedirectView,
    AppHooks: { beforeInitApp: { call: async () => undefined } },
  },
  '../../view': components, '../components': components,
  '../../view/share-view/share-view': components,
  nprogress: { configure() {}, start() {}, done() {} },
};
const evaluate = code => {
  const exports = {};
  new Function('exports', 'ibiz', 'require', code)(exports, window.ibiz, name => dependencies[name] || {});
  return exports;
};
const { AuthGuard } = evaluate(${JSON.stringify(inputs[0].code)});
const { AppRouter } = evaluate(${JSON.stringify(inputs[1].code)});
const guard = new AuthGuard();
guard.initModel = async (_context, permission) => { state.modelPermissions.push(permission); };
AppRouter.setAuthGuard((context, notLogin) => guard.verify(context, notLogin),
  url => guard.getLoginRedirect(url));
const appRouter = AppRouter.getRouter();
appRouter.onError(error => state.errors.push(String(error)));
const app = createApp({ render: () => h(router.RouterView) });
app.use(appRouter);
app.mount('#app');
appRouter.isReady().then(() => {
  state.path = appRouter.currentRoute.value.path;
  state.returnUrl = appRouter.currentRoute.value.query.ru;
  state.ready = true;
}).catch(error => state.errors.push(String(error)));
`;
  const result = await build({
    configFile: false, publicDir: false, logLevel: 'silent', mode: 'production',
    define: { 'process.env.NODE_ENV': '"production"', __VUE_OPTIONS_API__: true, __VUE_PROD_DEVTOOLS__: false },
    resolve: { alias: {
      vue: join(dirname(require.resolve('vue/package.json')), 'dist/vue.runtime.esm-bundler.js'),
      'vue-router': join(dirname(require.resolve('vue-router/package.json')), 'dist/vue-router.mjs'),
      qs: require.resolve('qs'),
    } },
    plugins: [{ name: 'controlled-source-auth-route',
      resolveId: value => value === entry ? entry : undefined,
      load: value => value === entry ? source : undefined }],
    build: { write: false, minify: false,
      lib: { entry, formats: ['iife'], name: 'ControlledSourceAuthRoute' } },
  });
  const chunks = (Array.isArray(result) ? result : [result])
    .flatMap(row => row.output).filter(row => row.type === 'chunk');
  assert.equal(chunks.length, 1);
  return { code: chunks[0].code, inputs: inputs.map(({ code, ...input }) => input) };
}

for (const [name, directory] of sourceRoots) {
  test(`${name}: actual source guard/router redirects deep links before any protected HTTP in four browser contexts`, async t => {
    const compiled = await browserFixture(directory);
    const artifactRoot = join(workspace, '.artifacts/initial-auth-controlled-browser');
    await mkdir(artifactRoot, { recursive: true, mode: 0o700 });
    const output = await mkdtemp(join(artifactRoot, `${name}-`));
    const browser = await launchChromium(playwright.chromium, { args: ['--no-sandbox'] });
    t.after(() => browser.close());
    for (const locale of ['zh-CN', 'en-US']) {
      for (const [viewport, size] of Object.entries({
        desktop: { width: 1440, height: 900 }, mobile: { width: 390, height: 844 },
      })) {
        const context = await browser.newContext({ locale, viewport: size, serviceWorkers: 'block' });
        const page = await context.newPage();
        const errors = [];
        const failures = [];
        const blocked = [];
        let observation;
        let completed = false;
        page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
        page.on('pageerror', error => errors.push(error.message));
        page.on('requestfailed', request => failures.push(request.failure()?.errorText));
        await context.route('**/*', route => {
          const url = new URL(route.request().url());
          if (url.origin === origin && url.pathname === '/fixture') return route.fulfill({
            contentType: 'text/html',
            body: '<!doctype html><html><body><div id="app"></div><script src="/fixture.js"></script></body></html>',
          });
          if (url.origin === origin && url.pathname === '/fixture.js') return route.fulfill({
            contentType: 'application/javascript', body: compiled.code,
          });
          blocked.push(url.pathname);
          return route.abort();
        });
        try {
          await page.goto(`${origin}/fixture#${returnUrl}`);
          await page.waitForFunction(() => window.observation?.ready);
          assert.equal(await page.locator('#login-fixture').isVisible(), true);
          assert.equal(await page.locator('#protected-fixture').count(), 0);
          observation = await page.evaluate(() => window.observation);
          assert.deepEqual(observation, {
            protectedRequests: [], modelPermissions: [false], errors: [],
            path: '/login', returnUrl, ready: true,
          });
          await page.screenshot({ path: join(output, `${locale}-${viewport}.png`), fullPage: true });
          completed = true;
        } finally {
          await context.close();
          fs.writeFileSync(join(output, `${locale}-${viewport}.json`), `${JSON.stringify({
            controlledFixtureOnly: true, nativeAcceptance: false, sourceInputs: compiled.inputs,
            completed, observation, errors, failures, blocked,
          }, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
        }
        assert.deepEqual(errors, []);
        assert.deepEqual(failures, []);
        assert.deepEqual(blocked, []);
      }
    }
    for (const input of compiled.inputs) assert.equal(hash(fs.readFileSync(input.path)), input.sha256);
  });
}
