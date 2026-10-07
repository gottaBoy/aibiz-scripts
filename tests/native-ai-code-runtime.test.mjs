import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import http from 'node:http';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import {
  captureRuntimeIdentity, localRuntimeEntry, runtimeEntries, summarizeRuntimeReport, verifyRuntimeHttpDelivery,
  verifyRuntimeIdentity,
} from '../harness-native-ai-code-runtime.mjs';

const stages = [
  'http-delivery', 'factory-registration', 'component-render',
  'edit-and-prop-sync', 'readonly-disabled', 'unmount-and-runtime-errors',
];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const entry = (path, bytes) => ({ path, bytes: Buffer.byteLength(bytes), sha256: hash(bytes) });
const passed = () => Object.fromEntries(['Central', 'ModelDesign'].map(name =>
  [name, {
    entry: `http://127.0.0.1:${name === 'Central' ? 32008 : 32009}/${name.toLowerCase()}/`,
    identity: { nativeModelApp: name, appId: `ibizmodeling__${name.toLowerCase()}` },
    runtimeErrors: [],
    stages: Object.fromEntries(stages.map(stage => [stage, { status: 'PASS' }])),
  }]));

async function deliveryServer(t, mutate = () => {}) {
  const files = new Map([
    ['/central/plugins/@ibiz-template-plugin/ai-code@0.0.3-alpha.141/package.json', '{}'],
    ['/central/extras/json/system-import.json', '{"imports":{}}'],
    ['/central/plugins/monaco-editor@0.52.2/min/vs/base/worker/workerMain.js', 'worker'],
    ['/plugins/monaco-editor@0.52.2/min/vs/base/worker/workerMain.js', 'worker'],
  ]);
  mutate(files);
  const server = http.createServer((request, response) => {
    const bytes = files.get(request.url);
    response.statusCode = bytes === undefined ? 404 : 200;
    response.end(bytes ?? 'missing');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve, reject) => {
    server.closeAllConnections();
    server.close(error => error ? reject(error) : resolve());
  }));
  return {
    url: `http://127.0.0.1:${server.address().port}/central/`,
    options: {
      pluginEntries: [entry('package.json', '{}')],
      runtimeEntries: [
        entry('extras/json/system-import.json', '{"imports":{}}'),
        entry('plugins/monaco-editor@0.52.2/min/vs/base/worker/workerMain.js', 'worker'),
        entry('nginx-native.conf', 'not served'),
      ],
    },
  };
}

test('runtime entry validation allows only explicit local HTTP entries', () => {
  assert.equal(localRuntimeEntry('http://localhost:32008/central/'), 'http://localhost:32008/central/');
  assert.equal(localRuntimeEntry('http://[::1]:32008/central/'), 'http://[::1]:32008/central/');
  for (const url of [
    'https://localhost/central/', 'http://example.com/central/', 'http://localhost/central',
    'http://user:password@localhost/central/', 'http://localhost/central/?alias=1',
    'http://localhost/central/#/route',
  ]) assert.throws(() => localRuntimeEntry(url));
});

test('isolated runtime passes only exact applications and stages, never native acceptance', () => {
  assert.deepEqual(summarizeRuntimeReport(passed()), {
    isolatedRuntimePassed: true, nativeRuntimeAccepted: false, acceptedForProduction: false,
    fullApplicationAcceptanceRequired: true,
  });
  for (const mutate of [
    value => { delete value.Central; },
    value => { value.Extra = value.Central; },
    value => { delete value.ModelDesign.stages['component-render']; },
    value => { value.Central.stages['http-delivery'].status = 'FAIL'; },
    value => { value.Central.stages.extra = { status: 'PASS' }; },
    value => { value.Central.runtimeErrors.push({ kind: 'pageerror', text: 'late resize error' }); },
    value => { value.ModelDesign.runtimeErrors.push({ kind: 'requestfailed', error: 'net::ERR_FAILED' }); },
    value => { delete value.Central.runtimeErrors; },
    value => { value.ModelDesign.entry = value.Central.entry; },
    value => { value.ModelDesign.identity.nativeModelApp = 'Central'; },
    value => { value.Central.identity.appId = 'ibizplm__plmweb'; },
    value => { delete value.Central.identity; },
  ]) {
    const value = passed();
    mutate(value);
    assert.equal(summarizeRuntimeReport(value).isolatedRuntimePassed, false);
  }
});

test('runtime entries reject reuse of one page including localhost aliases', () => {
  assert.deepEqual(runtimeEntries('http://localhost:32008/central/',
    'http://127.0.0.1:32009/modeldesign/'), [
    'http://localhost:32008/central/', 'http://127.0.0.1:32009/modeldesign/',
  ]);
  assert.throws(() => runtimeEntries('http://localhost:32008/central/',
    'http://127.0.0.1:32008/central/'), /distinct runtime entries/);
});

test('runtime identity must match both native application and actual appId', () => {
  for (const name of ['Central', 'ModelDesign']) {
    const identity = { nativeModelApp: name, appId: `ibizmodeling__${name.toLowerCase()}` };
    assert.deepEqual(verifyRuntimeIdentity(name, identity), identity);
    assert.throws(() => verifyRuntimeIdentity(name, { ...identity, nativeModelApp: 'Other' }),
      /application identity differs/);
    assert.throws(() => verifyRuntimeIdentity(name, { ...identity, appId: 'ibizplm__plmweb' }),
      /appId differs/);
  }
  assert.throws(() => verifyRuntimeIdentity('Other', {}), /Unknown runtime application/);
});

const identityPage = window => ({
  evaluate: callback => runInNewContext(`(${callback.toString()})()`, { window }),
});

for (const name of ['Central', 'ModelDesign']) {
  test(`browser identity captures injected ${name} selector and actual runtime appId`, async () => {
    const identity = { nativeModelApp: name, appId: `ibizmodeling__${name.toLowerCase()}` };
    for (const nativeModelApp of [undefined, 'unrelated-runtime-property']) {
      const page = identityPage({
        Environment: { nativeModelApp: name, appId: 'not-the-runtime-appId' },
        ibiz: { env: { appId: identity.appId, nativeModelApp } },
      });
      assert.deepEqual(await captureRuntimeIdentity(name, page), identity);
    }
  });
}

for (const [label, mutate, message] of [
  ['missing injection', window => { delete window.Environment; }, /application identity differs/],
  ['missing injected selector', window => { delete window.Environment.nativeModelApp; },
    /application identity differs/],
  ['wrong injected selector', window => { window.Environment.nativeModelApp = 'ModelDesign'; },
    /application identity differs/],
  ['selector casing mismatch', window => { window.Environment.nativeModelApp = 'central'; },
    /application identity differs/],
  ['wrong runtime appId', window => { window.ibiz.env.appId = 'ibizplm__plmweb'; }, /appId differs/],
  ['missing runtime appId', window => { delete window.ibiz.env.appId; }, /appId differs/],
  ['missing runtime environment', window => { delete window.ibiz.env; }, /appId differs/],
  ['missing runtime', window => { delete window.ibiz; }, /appId differs/],
]) {
  test(`browser identity rejects ${label} without fallback identities`, async () => {
    const window = {
      Environment: { nativeModelApp: 'Central', appId: 'ibizmodeling__central' },
      ibiz: { env: { nativeModelApp: 'Central', appId: 'ibizmodeling__central' } },
    };
    mutate(window);
    await assert.rejects(captureRuntimeIdentity('Central', identityPage(window)), message);
  });
}

test('HTTP delivery binds app-relative assets, root workers and true negative 404s', async t => {
  const { url, options } = await deliveryServer(t);
  const checks = await verifyRuntimeHttpDelivery(url, options);
  assert.equal(checks.length, 6);
  assert.deepEqual(checks.map(check => check.status), [200, 200, 200, 200, 404, 404]);
  assert.ok(checks.every(check => !check.path.includes('nativeappcode')));
  assert.ok(checks.some(check => check.path.startsWith('/plugins/monaco-editor')));
});

for (const [label, mutate, message] of [
  ['plugin bytes', files => files.set(
    '/central/plugins/@ibiz-template-plugin/ai-code@0.0.3-alpha.141/package.json', '[]'), /hash differs/],
  ['import map', files => files.delete('/central/extras/json/system-import.json'), /status differs/],
  ['root worker', files => files.delete('/plugins/monaco-editor@0.52.2/min/vs/base/worker/workerMain.js'),
    /status differs/],
  ['old version fallback', files => files.set(
    '/central/plugins/@ibiz-template-plugin/ai-code@0.0.3-alpha.92/package.json', '{}'), /404 without aliases/],
]) {
  test(`HTTP delivery rejects ${label}`, async t => {
    const { url, options } = await deliveryServer(t, mutate);
    await assert.rejects(verifyRuntimeHttpDelivery(url, options), message);
  });
}
