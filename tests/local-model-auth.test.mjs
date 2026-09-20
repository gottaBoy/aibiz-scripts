import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const app = join(root, 'modelingweb/app');
const require = createRequire(join(app, 'package.json'));
const ts = require('typescript');
const guardPath = 'web-app/guard/auth-guard/auth-guard';
const variants = [
  ['desktop', 'ibiz-app-hub/components/ibiz-next-vue3/src', '.ts'],
  ['source-debug', 'modelingweb/packages-latest/@ibiz-template/vue3-components/src', '.ts'],
  ['installed-es', 'modelingweb/app/node_modules/@ibiz-template/vue3-components/es', '.mjs'],
  ['installed-cjs', 'modelingweb/app/node_modules/@ibiz-template/vue3-components/lib', '.cjs'],
  ['source-debug-es', 'modelingweb/packages-latest/@ibiz-template/vue3-components/es', '.mjs'],
  ['source-debug-cjs', 'modelingweb/packages-latest/@ibiz-template/vue3-components/lib', '.cjs'],
  ['mobile', 'ibiz-app-hub/components/ibiz-next-mob-vue3/src', '.ts'],
];
const modes = [
  { isSaaSMode: true, isLocalModel: true, orgCalls: 0 },
  { isSaaSMode: true, isLocalModel: false, orgCalls: 1 },
  { isSaaSMode: true, isLocalModel: undefined, orgCalls: 1 },
  { isSaaSMode: false, isLocalModel: true, orgCalls: 0 },
  { isSaaSMode: false, isLocalModel: false, orgCalls: 0 },
  { isSaaSMode: undefined, isLocalModel: undefined, orgCalls: 0 },
  { isSaaSMode: 'true', isLocalModel: true, orgCalls: 0 },
  { isSaaSMode: true, isLocalModel: 'true', orgCalls: 1 },
];

function fixture(name, directory, extension, mode, failStatus) {
  const file = join(root, directory, `${name === 'mobile' ? guardPath.replace('web-app/', 'mob-app/') : guardPath}${extension}`);
  const calls = { org: 0, appdata: 0, model: 0, refresh: 0 };
  const failure = Object.assign(new Error('Backend failure'), { status: failStatus });
  const ibiz = {
    env: { ...mode, appId: 'ibizmodeling__modeldesign' },
    auth: {
      async refreshToken() { calls.refresh += 1; },
      async extendLogin() {},
    },
    hub: { async loadExtensionPlugin() {}, notice: { async init() {} } },
    util: { theme: { async initCustomTheme() {} } },
  };
  const hook = { async call() {} };
  const dependencies = {
    '@ibiz-template/core': {
      CoreConst: { TOKEN_REMEMBER: 'remember', REFRESH_TOKEN: 'refresh' },
      getAppCookie: key => key === 'remember' ? true : 'test-refresh-token',
    },
    '@ibiz-template/vue3-util': { AppHooks: { beforeInitApp: hook, authedApp: hook } },
    '@ibiz-template/runtime': {},
    '@ibiz-template/devtool': { updateDevToolConfig() {} },
    'ramda': {},
    '../auth-guard-hooks': { AuthGuardHooks: { beforeAuth: hook, afterAuth: hook } },
  };
  const module = { exports: {} };
  const compiled = ts.transpileModule(readFileSync(file, 'utf8'), {
    fileName: file,
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, allowJs: true },
  }).outputText;
  runInNewContext(compiled, {
    module, exports: module.exports, ibiz,
    require(id) {
      assert.ok(Object.hasOwn(dependencies, id), `Unexpected import: ${id}`);
      return dependencies[id];
    },
  }, { filename: file });
  const guard = new module.exports.AuthGuard();
  guard.loadOrgData = async () => { calls.org += 1; };
  guard.loadAppData = async () => {
    calls.appdata += 1;
    if (failStatus && calls.appdata === 1) throw failure;
  };
  guard.initModel = async () => { calls.model += 1; };
  return { guard, calls, failure };
}

for (const variant of variants) {
  test(`${variant[0]}: local mode skips only the SaaS organization lookup`, async () => {
    for (const mode of modes) {
      const { guard, calls } = fixture(...variant, mode);
      await guard.appInit({});
      assert.deepEqual(calls, { org: mode.orgCalls, appdata: 1, model: 1, refresh: 0 });
    }
  });

  if (variant[0] !== 'mobile') {
    test(`${variant[0]}: refresh retry preserves local and SaaS behavior`, async () => {
      for (const mode of modes.slice(0, 3)) {
        const { guard, calls } = fixture(...variant, mode, 401);
        await guard.appInit({});
        assert.deepEqual(calls, { org: mode.orgCalls * 2, appdata: 2, model: 1, refresh: 1 });
      }
    });
  }

  test(`${variant[0]}: local mode never masks application backend failures`, async () => {
    const { guard, calls, failure } = fixture(...variant, modes[0], 502);
    await assert.rejects(guard.appInit({}), error => error === failure);
    assert.deepEqual(calls, { org: 0, appdata: 1, model: 0, refresh: 0 });
  });
}

test('pnpm patch is parseable and contains both executable guard variants', () => {
  const file = 'patches/@ibiz-template__vue3-components@0.7.41-alpha.78.patch';
  const result = spawnSync('git', ['apply', '--numstat', file], { cwd: app, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /2\s+2\s+es\/web-app\/guard\/auth-guard\/auth-guard.mjs/);
  assert.match(result.stdout, /2\s+2\s+lib\/web-app\/guard\/auth-guard\/auth-guard.cjs/);
});

test('published SystemJS guards match source behavior, including the refresh branch', async () => {
  const directory = join(app, 'dist/extras/js/@ibiz-template/vue3-components');
  let conditions = 0;
  for (const name of readdirSync(directory).filter(name => name.endsWith('.js'))) {
    const source = readFileSync(join(directory, name), 'utf8');
    const clauses = source.match(/!0===ibiz\.env\.isSaaSMode(?:&&!0!==ibiz\.env\.isLocalModel)?&&await this\.loadOrgData\(\)/g) || [];
    for (const clause of clauses) {
      assert.ok(clause.includes('isLocalModel'), `Unpatched SystemJS guard in ${name}`);
      for (const mode of modes) {
        let called = 0;
        await runInNewContext(`(async function () { ${clause}; })`, { ibiz: { env: mode } })
          .call({ async loadOrgData() { called += 1; } });
        assert.equal(called, mode.orgCalls);
      }
      conditions += 1;
    }
  }
  assert.equal(conditions, 2, 'Both initial authentication and refresh guards must be present');
});
