import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';
import { workspace } from '../localization-baseline.mjs';

const require = createRequire(join(workspace, 'modelingweb/app/package.json'));
const ts = require('typescript');
const roots = [
  ['hub', 'ibiz-app-hub/packages/vue3-util/src'],
  ['active', 'modelingweb/packages-latest/@ibiz-template/vue3-util/src'],
];
const plain = value => JSON.parse(JSON.stringify(value));
const route = (root = 'root-a') => ({
  path: `/${root ? `psdevslnsys=${root}` : '-'}/modelingindex/-`,
  fullPath: `/${root ? `psdevslnsys=${root}` : '-'}/modelingindex/-`,
  matched: [{}],
  params: { appContext: root ? `psdevslnsys=${root}` : '-', params1: '-' },
});
const projection = () => ({ psdevslnsys: 'root-a', pssystemid: 'logical-a' });

function fixture(source) {
  let token = 'controlled-account-a-token';
  let getView = async () => ({ id: 'modeldesign.modelingindex' });
  const runtime = {
    env: { routePlaceholder: '-' },
    appData: { context: { srfuserid: 'account-a', srforgid: 'org-a' }, srfmodelcontext: projection() },
    auth: { getAuthInfo: () => token === undefined ? undefined : { token } },
    hub: { config: { view: { get: (...args) => getView(...args) } } },
    i18n: { t: key => key },
  };
  const compile = file => ts.transpileModule(fs.readFileSync(join(workspace, source, file), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  let helper;
  const constants = {};
  vm.runInNewContext(ts.transpileModule(fs.readFileSync(join(workspace,
    'modelingweb/packages-latest/@ibiz-template/runtime/src/constant/view-type.ts'), 'utf8'), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText, { exports: constants });
  const evaluate = file => {
    const exports = {};
    vm.runInNewContext(compile(file), {
      exports, ibiz: runtime,
      require: name => {
        if (name === '@ibiz-template/core') return { RuntimeError: class extends Error {} };
        if (name === '@ibiz-template/runtime') return {
          ...constants, RouteConst: { ROUTE_MODAL_TAG: 'modal' },
        };
        if (name === './model-context') return helper;
        return require(name);
      },
    });
    return exports;
  };
  helper = evaluate('util/route/model-context.ts');
  return { runtime, helper, parse: evaluate('util/route/route.ts').parseRouteViewData,
    token: value => { token = value; }, getView: value => { getView = value; } };
}

for (const [name, source] of roots) {
  test(`${name}: actual route parser binds only the two authorized logical-context identifiers`, async () => {
    const f = fixture(source);
    const original = structuredClone(f.runtime.appData);
    const result = await f.parse(route(), 1);
    assert.deepEqual(plain(result.context), {
      srfuserid: 'account-a', srforgid: 'org-a', psdevslnsys: 'root-a',
      pssystem: 'logical-a', pssystemid: 'logical-a',
    });
    assert.deepEqual(f.runtime.appData, original);
  });

  test(`${name}: an unrooted route does not inherit the previous model's logical identifiers`, async () => {
    const f = fixture(source);
    const result = await f.parse(route(null), 1);
    assert.deepEqual(plain(result.context), { srfuserid: 'account-a', srforgid: 'org-a' });
  });

  test(`${name}: older servers without a projection retain their existing route semantics, not new authorization`, async () => {
    const f = fixture(source);
    delete f.runtime.appData.srfmodelcontext;
    const result = await f.parse(route(), 1);
    assert.deepEqual(plain(result.context), {
      srfuserid: 'account-a', srforgid: 'org-a', psdevslnsys: 'root-a',
    });
  });

  for (const [caseName, value] of [
    ['null', null], ['array', []], ['string', 'logical-a'],
    ['missing root', { pssystemid: 'logical-a' }],
    ['extra field', { ...projection(), secret: 'not-a-projection' }],
    ['numeric system', { ...projection(), pssystemid: 12 }],
    ['blank system', { ...projection(), pssystemid: '' }],
    ['space system', { ...projection(), pssystemid: 'logical a' }],
    ['unicode space', { ...projection(), pssystemid: '\u00a0logical-a' }],
    ['control character', { ...projection(), pssystemid: 'logical-a\n' }],
    ['numeric root', { ...projection(), psdevslnsys: 12 }],
    ['empty root', { ...projection(), psdevslnsys: '' }],
  ]) {
    test(`${name}: ${caseName} projection fails before any route model request`, async () => {
      const f = fixture(source);
      f.runtime.appData.srfmodelcontext = value;
      let requests = 0;
      f.getView(async () => { requests++; return {}; });
      await assert.rejects(f.parse(route(), 1), /modelContextUnavailable/);
      assert.equal(requests, 0);
    });
  }

  test(`${name}: projection accessors cannot execute arbitrary getters`, () => {
    const f = fixture(source);
    let invoked = 0;
    const getter = () => { invoked++; return 'logical-a'; };
    f.runtime.appData.srfmodelcontext = Object.defineProperty(
      { psdevslnsys: 'root-a' }, 'pssystemid', { get: getter },
    );
    assert.throws(() => f.helper.captureModelContext(), /modelContextUnavailable/);
    Object.defineProperty(f.runtime.appData, 'srfmodelcontext', { get: getter });
    assert.throws(() => f.helper.captureModelContext(), /modelContextUnavailable/);
    assert.equal(invoked, 0);
  });

  for (const [caseName, context] of [
    ['foreign root', { psdevslnsys: 'root-b' }],
    ['root-as-number', { psdevslnsys: 12 }],
    ['foreign system key', { psdevslnsys: 'root-a', pssystem: 'logical-b' }],
    ['foreign system filter', { psdevslnsys: 'root-a', pssystemid: 'logical-b' }],
  ]) {
    test(`${name}: ${caseName} is rejected without mutating the supplied context`, () => {
      const f = fixture(source);
      const before = structuredClone(context);
      assert.throws(() => f.helper.bindModelContext(f.helper.captureModelContext(), context), /modelContextUnavailable/);
      assert.deepEqual(context, before);
    });
  }

  for (const token of [undefined, null, '', 0]) {
    test(`${name}: missing or invalid current credentials cannot adopt a projection: ${token}`, () => {
      const f = fixture(source);
      f.token(token);
      const context = { psdevslnsys: 'root-a' };
      assert.throws(() => f.helper.bindModelContext(f.helper.captureModelContext(), context), /modelContextUnavailable/);
      assert.deepEqual(context, { psdevslnsys: 'root-a' });
    });
  }

  for (const [caseName, change] of [
    ['account/token changed', f => f.token('controlled-account-b-token')],
    ['appdata replaced', f => { f.runtime.appData = structuredClone(f.runtime.appData); }],
    ['projection replaced', f => { f.runtime.appData.srfmodelcontext = projection(); }],
    ['root changed in place', f => { f.runtime.appData.srfmodelcontext.psdevslnsys = 'root-b'; }],
    ['logical system changed in place', f => { f.runtime.appData.srfmodelcontext.pssystemid = 'logical-b'; }],
  ]) {
    test(`${name}: delayed actual route-model lookup refuses ${caseName}`, async () => {
      const f = fixture(source);
      let release;
      f.getView(() => new Promise(resolve => { release = resolve; }));
      const loading = f.parse(route(), 1);
      change(f);
      release({ id: 'modeldesign.modelingindex' });
      await assert.rejects(loading, /modelContextChanged/);
    });
  }

  test(`${name}: switching the reactive route during model lookup cannot return the old root`, async () => {
    const f = fixture(source);
    const selected = route();
    let release;
    f.getView(() => new Promise(resolve => { release = resolve; }));
    const loading = f.parse(selected, 1);
    Object.assign(selected, route('root-b'));
    release({ id: 'modeldesign.modelingindex' });
    await assert.rejects(loading, /modelContextChanged/);
  });

  test(`${name}: a projection introduced during a legacy route lookup cannot mix the two response generations`, async () => {
    const f = fixture(source);
    delete f.runtime.appData.srfmodelcontext;
    let release;
    f.getView(() => new Promise(resolve => { release = resolve; }));
    const loading = f.parse(route(), 1);
    f.runtime.appData.srfmodelcontext = projection();
    release({ id: 'modeldesign.modelingindex' });
    await assert.rejects(loading, /modelContextChanged/);
  });

  test(`${name}: nested navigation cannot substitute a foreign physical root`, async () => {
    const f = fixture(source);
    const selected = {
      path: '/psdevslnsys=root-a/modelingindex/-/moduleview/-',
      fullPath: '/psdevslnsys=root-a/modelingindex/-/moduleview/-',
      matched: [{}, {}],
      params: { appContext: 'psdevslnsys=root-a', params1: '-',
        params2: `srfnavctx=${encodeURIComponent(JSON.stringify({ psdevslnsys: 'root-b' }))}` },
    };
    await assert.rejects(f.parse(selected, 2), /modelContextUnavailable/);
  });

  test(`${name}: localized context failures have nonempty Chinese and English messages`, () => {
    for (const language of ['en', 'zh-CN']) {
      const exports = {};
      vm.runInNewContext(ts.transpileModule(fs.readFileSync(
        join(workspace, source, 'locale', language, 'index.ts'), 'utf8',
      ), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText, { exports });
      const messages = exports[language === 'en' ? 'en' : 'zhCn'].vue3Util.util;
      for (const key of ['modelContextUnavailable', 'modelContextChanged']) {
        assert.equal(typeof messages[key], 'string');
        assert.ok(messages[key].length > 10);
        if (language === 'zh-CN') assert.match(messages[key], /[\u3400-\u9fff]/);
      }
    }
  });
}
