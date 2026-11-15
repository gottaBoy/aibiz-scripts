import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { workspace } from '../localization-baseline.mjs';

const require = createRequire(join(workspace, 'modelingweb/app/package.json'));
const ts = require('typescript');
const router = require('vue-router');
const sources = [
  ['hub', 'ibiz-app-hub/components/ibiz-next-vue3/src/web-app'],
  ['active', 'modelingweb/packages-latest/@ibiz-template/vue3-components/src/web-app'],
];
const loginMode = { DEFAULT: 'DEFAULT', CUSTOM: 'CUSTOM', CAS: 'CAS', OAUTH: 'OAUTH' };
const deepLink = '/psdevslnsys=owned-root/modelingindex/-?name=A%26B#section';
const plain = value => JSON.parse(JSON.stringify(value));

function sourceClass(path, runtime, core = {}) {
  const exports = {};
  const dependencies = {
    '@ibiz-template/core': core,
    'vue-router': router,
    qs: require('qs'),
    '@ibiz-template/runtime': { RouteConst: { ROUTE_MODAL_TAG: 'modal' } },
    '@ibiz-template/vue3-util': { AppRedirectView: {} },
    '../../view': { LoginView: {}, ErrorView: {}, UnauthorizedView: {} },
    '../components': { ModalRouterShell: {}, RouterShell: {} },
    '../../view/share-view/share-view': { ShareView: {} },
    nprogress: { configure() {}, start() {}, done() {} },
  };
  const output = ts.transpileModule(fs.readFileSync(path, 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(output, {
    exports, ibiz: runtime, require: name => dependencies[name] ?? {},
  }, { filename: path });
  return exports;
}

for (const [name, directory] of sources) {
  const file = suffix => join(workspace, directory, suffix);
  const fixture = () => {
    const cookies = new Map();
    let authInfo;
    const calls = [];
    const runtime = {
      env: { routePlaceholder: '-', loginMode: 'DEFAULT', enableAnonymous: false },
      auth: { getAuthInfo: () => authInfo },
    };
    const { AuthGuard } = sourceClass(file('guard/auth-guard/auth-guard.ts'), runtime, {
      LoginMode: loginMode, CoreConst: { TOKEN_REMEMBER: 'remember', REFRESH_TOKEN: 'refresh' },
      getAppCookie: key => cookies.get(key),
    });
    const { AppRouter } = sourceClass(file('router/index.ts'), runtime);
    const guard = new AuthGuard();
    AppRouter.setAuthGuard(async (context, notLogin) => {
      calls.push({ context: plain(context), notLogin });
      return true;
    }, returnUrl => guard.getLoginRedirect(returnUrl));
    const instance = router.createRouter({
      history: router.createMemoryHistory(), routes: AppRouter.getRoutes(),
    });
    return { guard, AppRouter, instance, runtime, calls, cookies,
      setAuth: value => { authInfo = value; } };
  };

  test(`${name}: normal no-credential entry redirects through real Vue Router without calling protected initialization`, async () => {
    const f = fixture();
    const errors = [];
    f.instance.onError(error => errors.push(error));
    const failure = await f.instance.push(deepLink);
    await f.instance.isReady();
    assert.equal(failure, undefined, 'A redirect is not an aborted navigation');
    assert.deepEqual(errors, []);
    assert.equal(f.instance.currentRoute.value.path, '/login');
    assert.equal(f.instance.currentRoute.value.query.ru, deepLink);
    assert.deepEqual(f.calls, [{ context: {}, notLogin: false }],
      'Only the login model may initialize, not protected organization/appdata');
    assert.equal(f.instance.options.history.state.back ?? null, null);
  });

  test(`${name}: encoded return route is preserved as data without an external navigation target`, () => {
    const f = fixture();
    assert.deepEqual(plain(f.guard.getLoginRedirect(deepLink)), {
      path: '/login', replace: true, query: { ru: deepLink },
    });
    assert.equal(f.guard.getLoginRedirect('/login?ru=anything'), undefined);
  });

  test(`${name}: share and app-redirect entries use the same no-credential login boundary`, async () => {
    for (const target of ['/share?key=owned', '/appredirectview?view=owned']) {
      const f = fixture();
      await f.instance.push(target);
      assert.equal(f.instance.currentRoute.value.path, '/login');
      assert.equal(f.instance.currentRoute.value.query.ru, target);
      assert.deepEqual(f.calls, [{ context: {}, notLogin: false }]);
    }
  });

  test(`${name}: direct login and error views remain public without protected initialization`, async () => {
    for (const target of ['/login?ru=%2Fowned', '/error/500']) {
      const f = fixture();
      await f.instance.push(target);
      assert.equal(f.instance.currentRoute.value.fullPath, target);
      assert.equal(f.calls.length, target.startsWith('/login') ? 1 : 0);
    }
  });

  for (const [state, configure] of [
    ['stored token', f => f.setAuth({ token: 'existing-token', isAnonymous: false })],
    ['anonymous mode', f => { f.runtime.env.enableAnonymous = true; }],
    ['remembered refresh', f => { f.cookies.set('remember', '1'); f.cookies.set('refresh', 'existing-refresh'); }],
    ...['CAS', 'OAUTH', 'CUSTOM'].map(mode => [mode, f => { f.runtime.env.loginMode = mode; }]),
  ]) {
    test(`${name}: ${state} preserves the actual protected authentication guard`, async () => {
      const f = fixture();
      configure(f);
      assert.equal(f.guard.getLoginRedirect(deepLink), undefined);
      await f.instance.push(deepLink);
      assert.equal(f.instance.currentRoute.value.fullPath, deepLink);
      assert.deepEqual(f.calls, [{ context: { psdevslnsys: 'owned-root' }, notLogin: undefined }]);
    });
  }

  test(`${name}: unremembered refresh or remember without refresh does not skip login`, () => {
    for (const [key, value] of [['refresh', 'existing-refresh'], ['remember', '1']]) {
      const f = fixture();
      f.cookies.set(key, value);
      assert.equal(f.guard.getLoginRedirect(deepLink)?.path, '/login');
    }
  });

  test(`${name}: existing auth denial and real errors remain observable`, async () => {
    const f = fixture();
    f.setAuth({ token: 'existing-token' });
    f.AppRouter.setAuthGuard(async () => false, url => f.guard.getLoginRedirect(url));
    assert.ok(router.isNavigationFailure(await f.instance.push(deepLink),
      router.NavigationFailureType.aborted));
    const error = new Error('actual-service-failure');
    const errors = [];
    f.instance.onError(value => errors.push(value));
    f.AppRouter.setAuthGuard(async () => { throw error; }, url => f.guard.getLoginRedirect(url));
    await assert.rejects(f.instance.push(deepLink), value => value === error);
    assert.deepEqual(errors, [error]);
  });

  test(`${name}: custom guards without the new optional redirect retain their existing API`, async () => {
    const f = fixture();
    f.AppRouter.setAuthGuard(async (context, notLogin) => {
      f.calls.push({ context: plain(context), notLogin });
      return true;
    });
    await f.instance.push(deepLink);
    assert.equal(f.instance.currentRoute.value.fullPath, deepLink);
    const source = fs.readFileSync(file('main.ts'), 'utf8');
    assert.match(source, /opts\?\.getAuthGuard\s*\?\s*undefined\s*:/);
    assert.match(source, /authGuard\.getLoginRedirect\(returnUrl\)/);
  });
}
