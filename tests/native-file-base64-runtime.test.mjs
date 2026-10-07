import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import http from 'node:http';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { captureRuntimeIdentity } from '../harness-native-ai-code-runtime.mjs';
import {
  captureFileBase64ExternalResolutions, FILE_BASE64_IDENTITY, FILE_BASE64_STAGES, installFileReaderProbe,
  summarizeFileBase64RuntimeReport, verifyFileBase64Candidate, verifyFileBase64ExternalResolution,
  verifyFileBase64HttpDelivery, verifyFileSelectionSnapshot,
} from '../harness-native-file-base64-runtime.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const paths = [
  'dist/file-logic.mjs', 'dist/index.mjs', 'dist/index.system.js', 'dist/style.css', 'package.json',
];
const entry = (path, data) => ({ path, bytes: Buffer.byteLength(data), sha256: hash(data) });
const passed = () => Object.fromEntries(['Central', 'ModelDesign'].map(name => [name, {
  entry: `http://127.0.0.1:${name === 'Central' ? 32008 : 32009}/${name.toLowerCase()}/`,
  identity: { nativeModelApp: name, appId: `ibizmodeling__${name.toLowerCase()}` },
  bootErrors: [{ kind: 'response', status: 401 }], runtimeErrors: [],
  stages: Object.fromEntries(FILE_BASE64_STAGES.map(stage => [stage, { status: 'PASS' }])),
}]));

function candidate() {
  const plugin = {
    contract: 'native-file-base64-independent-replacement', ...FILE_BASE64_IDENTITY,
    sourceStatus: 'independent-local-implementation', sourceFingerprint: 'source-evidence',
    originalSourceRecovered: false, originalRepositoryAuthenticated: false,
    nativeCompatibilityVerified: false, compatibility: 'not-verified', acceptedForProduction: false,
    originalMigrationAcceptance: 'not-satisfied-by-independent-replacement',
  };
  const replacement = { plugin, files: { entries: paths.map(path => entry(path, path)) } };
  const receipt = {
    contract: 'native-modeling-source-backed-candidate', status: 'prepared-not-accepted',
    acceptedForProduction: false, plugins: [structuredClone(plugin)],
    independentReplacementMappings: [{
      from: plugin.from, to: plugin.to, originalSourceRecovered: false, nativeCompatibilityVerified: false,
      originalMigrationAcceptance: 'not-satisfied-by-independent-replacement',
    }],
  };
  return { replacement, receipt };
}

test('candidate must explicitly include the current independent replacement evidence', () => {
  const { receipt, replacement } = candidate();
  assert.deepEqual(verifyFileBase64Candidate(receipt, replacement), replacement.plugin);
});

test('candidate permits unrelated independent global utility alongside the exact Base64 mapping', () => {
  const { receipt, replacement } = candidate();
  const globalUtility = {
    contract: 'native-global-util-independent-replacement',
    from: '@ibiz-template-plugin/global-util-design@0.0.3-alpha.87',
    to: '@aibiz/global-util@0.1.0', originalSourceRecovered: false,
    nativeCompatibilityVerified: false,
    originalMigrationAcceptance: 'not-satisfied-by-independent-replacement',
  };
  receipt.plugins.push(globalUtility);
  receipt.independentReplacementMappings.unshift({
    from: globalUtility.from, to: globalUtility.to,
    originalSourceRecovered: false, nativeCompatibilityVerified: false,
    originalMigrationAcceptance: globalUtility.originalMigrationAcceptance,
  });
  assert.deepEqual(verifyFileBase64Candidate(receipt, replacement), replacement.plugin);
});

for (const [label, mutate] of [
  ['missing replacement', ({ receipt }) => { receipt.plugins = []; }],
  ['duplicate replacement', ({ receipt }) => { receipt.plugins.push(receipt.plugins[0]); }],
  ['stale source fingerprint', ({ receipt }) => { receipt.plugins[0].sourceFingerprint = 'old'; }],
  ['original alias', ({ receipt }) => { receipt.plugins[0].to = FILE_BASE64_IDENTITY.from; }],
  ['missing explicit mapping', ({ receipt }) => { receipt.independentReplacementMappings = []; }],
  ['duplicate explicit mapping', ({ receipt }) => {
    receipt.independentReplacementMappings.push(structuredClone(receipt.independentReplacementMappings[0]));
  }],
  ['wrong mapping original', ({ receipt }) => {
    receipt.independentReplacementMappings[0].from = '@ibiz-template-plugin/global-util-design@0.0.3-alpha.87';
  }],
  ['wrong mapping replacement', ({ receipt }) => {
    receipt.independentReplacementMappings[0].to = '@aibiz/global-util@0.1.0';
  }],
  ['conflicting mapping original alongside valid mapping', ({ receipt }) => {
    receipt.independentReplacementMappings.push({
      ...receipt.independentReplacementMappings[0], from: '@aibiz/global-util@0.1.0',
    });
  }],
  ['conflicting mapping replacement alongside valid mapping', ({ receipt }) => {
    receipt.independentReplacementMappings.push({
      ...receipt.independentReplacementMappings[0], to: '@aibiz/global-util@0.1.0',
    });
  }],
  ['authenticated original claim', ({ receipt, replacement }) => {
    replacement.plugin.originalRepositoryAuthenticated = true;
    receipt.plugins[0].originalRepositoryAuthenticated = true;
  }],
  ['recovered original claim', ({ replacement }) => { replacement.plugin.originalSourceRecovered = true; }],
  ['native compatibility claim', ({ replacement }) => { replacement.plugin.nativeCompatibilityVerified = true; }],
  ['production claim', ({ receipt }) => { receipt.acceptedForProduction = true; }],
  ['native acceptance substitution', ({ replacement }) => {
    replacement.plugin.originalMigrationAcceptance = 'satisfied';
  }],
  ['source delivery', ({ replacement }) => { replacement.files.entries.push(entry('src/editor.ts', 'source')); }],
  ['receipt delivery', ({ replacement }) => {
    replacement.files.entries.push(entry('dist/build-receipt.json', '{}'));
  }],
  ['missing SystemJS output', ({ replacement }) => { replacement.files.entries.splice(2, 1); }],
]) {
  test(`candidate binding rejects ${label}`, () => {
    const fixture = candidate();
    mutate(fixture);
    assert.throws(() => verifyFileBase64Candidate(fixture.receipt, fixture.replacement));
  });
}

test('isolated report never elevates independent source identity or native acceptance', () => {
  assert.deepEqual(summarizeFileBase64RuntimeReport(passed()), {
    isolatedRuntimePassed: true, originalSourceRecovered: false, nativeCompatibilityVerified: false,
    nativeRuntimeAccepted: false, nativeSaveReadbackVerified: false, acceptedForProduction: false,
    compatibility: 'not-verified', fullApplicationAcceptanceRequired: true,
  });
});

const identityPage = window => ({
  evaluate: callback => runInNewContext(`(${callback.toString()})()`, { window }),
});

test('replacement verdict uses injected selectors and actual runtime appIds for both applications', async () => {
  const apps = passed();
  for (const name of ['Central', 'ModelDesign']) {
    const window = {
      Environment: { nativeModelApp: name, appId: 'not-the-runtime-appId' },
      ibiz: { env: { appId: `ibizmodeling__${name.toLowerCase()}` } },
    };
    apps[name].identity = await captureRuntimeIdentity(name, identityPage(window));
  }
  assert.equal(summarizeFileBase64RuntimeReport(apps).isolatedRuntimePassed, true);
  assert.equal(summarizeFileBase64RuntimeReport(apps).nativeRuntimeAccepted, false);
});

for (const [label, mutate, message] of [
  ['missing injection', window => { delete window.Environment; }, /application identity differs/],
  ['missing injected selector', window => { delete window.Environment.nativeModelApp; },
    /application identity differs/],
  ['wrong injected selector', window => { window.Environment.nativeModelApp = 'Central'; },
    /application identity differs/],
  ['selector casing mismatch', window => { window.Environment.nativeModelApp = 'modeldesign'; },
    /application identity differs/],
  ['wrong runtime appId', window => { window.ibiz.env.appId = 'ibizmodeling__central'; }, /appId differs/],
  ['missing runtime appId', window => { delete window.ibiz.env.appId; }, /appId differs/],
  ['missing runtime environment', window => { delete window.ibiz.env; }, /appId differs/],
  ['missing runtime', window => { delete window.ibiz; }, /appId differs/],
]) {
  test(`replacement browser identity rejects ${label} without aliasing the original plugin`, async () => {
    const apps = passed();
    delete apps.ModelDesign.identity;
    const window = {
      Environment: { nativeModelApp: 'ModelDesign', appId: 'ibizmodeling__modeldesign' },
      ibiz: { env: { nativeModelApp: 'ModelDesign', appId: 'ibizmodeling__modeldesign' } },
    };
    mutate(window);
    await assert.rejects(captureRuntimeIdentity('ModelDesign', identityPage(window)), message);
    assert.equal(summarizeFileBase64RuntimeReport(apps).isolatedRuntimePassed, false);
  });
}

for (const [label, mutate] of [
  ['missing application', apps => { delete apps.ModelDesign; }],
  ['extra application', apps => { apps.Extra = apps.Central; }],
  ['same entry', apps => { apps.ModelDesign.entry = apps.Central.entry; }],
  ['localhost alias', apps => {
    apps.ModelDesign.entry = apps.Central.entry.replace('127.0.0.1', 'localhost');
  }],
  ['wrong native app', apps => { apps.ModelDesign.identity.nativeModelApp = 'Central'; }],
  ['wrong actual appId', apps => { apps.Central.identity.appId = 'ibizplm__plmweb'; }],
  ['missing identity', apps => { delete apps.Central.identity; }],
  ['missing runtime error inventory', apps => { delete apps.Central.runtimeErrors; }],
  ['late error', apps => { apps.Central.runtimeErrors.push({ kind: 'pageerror', text: 'late callback' }); }],
  ['missing cancellation stage', apps => { delete apps.Central.stages['pending-read-cancellation']; }],
  ['failed conversion stage', apps => { apps.Central.stages['conversion-and-filename'].status = 'FAIL'; }],
  ['extra stage', apps => { apps.Central.stages.extra = { status: 'PASS' }; }],
  ['missing stages', apps => { delete apps.ModelDesign.stages; }],
]) {
  test(`runtime verdict rejects ${label}`, () => {
    const apps = passed();
    mutate(apps);
    assert.equal(summarizeFileBase64RuntimeReport(apps).isolatedRuntimePassed, false);
  });
}

function selection(value = 'data:text/plain;base64,YQ==', filename = 'report.txt') {
  return { value, filename, changes: [[value], [filename, 'reportfile']], busy: false,
    error: '', displayName: filename, inputValue: '' };
}

test('full event tuples validate text, binary, and raw empty scalar with filename', () => {
  for (const value of ['data:text/plain;base64,YQ==', 'AP+A', '']) {
    verifyFileSelectionSnapshot(selection(value), { value, filename: 'report.txt' });
  }
});
for (const [label, mutate] of [
  ['lost empty string', value => { value.value = null; }],
  ['filename not synchronized', value => { value.filename = null; }],
  ['wrong event arity', value => { value.changes[0].push(null); }],
  ['reversed tuple order', value => { value.changes.reverse(); }],
  ['missing filename emission', value => { value.changes.pop(); }],
  ['extra emission', value => { value.changes.push(['unexpected']); }],
  ['wrong sibling field', value => { value.changes[1][1] = 'printmodel'; }],
  ['reader still active', value => { value.busy = true; }],
  ['stale selected name', value => { value.displayName = 'old.txt'; }],
  ['input not reset', value => { value.inputValue = 'C:\\fakepath\\report.txt'; }],
  ['hidden error', value => { value.error = 'The file could not be read.'; }],
]) {
  test(`selection evidence rejects ${label}`, () => {
    const value = selection('');
    mutate(value);
    assert.throws(() => verifyFileSelectionSnapshot(value, { value: '', filename: 'report.txt' }));
  });
}

const externalNames = ['vue', '@ibiz-template/runtime', '@ibiz-template/vue3-util'];
function externals() {
  const url = 'http://127.0.0.1:32008/central/';
  const imports = Object.fromEntries(externalNames.map(name => [name, `../js/${name}/index.system.js`]));
  const resolutions = Object.fromEntries(Object.entries(imports).map(([name, path]) =>
    [name, new URL(path, `${url}extras/json/system-import.json`).href]));
  return { url, map: { imports }, resolutions };
}
test('actual SystemJS externals must resolve relative to the verified import map', () => {
  const { url, map, resolutions } = externals();
  assert.deepEqual(verifyFileBase64ExternalResolution(url, map, resolutions), resolutions);
});

for (const mode of ['sync', 'async']) {
  test(`browser captures exact ${mode} SystemJS resolutions before evidence serialization`, async () => {
    const { url, map, resolutions } = externals();
    const calls = [];
    const window = {
      System: {
        resolve(name) {
          assert.equal(this, window.System);
          calls.push(name);
          return mode === 'async' ? Promise.resolve(resolutions[name]) : resolutions[name];
        },
      },
    };
    const actual = await identityPage(window).evaluate(captureFileBase64ExternalResolutions);
    const serialized = JSON.parse(JSON.stringify(actual));
    assert.deepEqual(calls, externalNames);
    assert.deepEqual(serialized, resolutions);
    verifyFileBase64ExternalResolution(url, map, serialized);
  });
}

test('browser capture propagates rejected async SystemJS resolutions', async () => {
  const window = {
    System: {
      async resolve(name) {
        if (name === '@ibiz-template/runtime') throw new Error('Runtime external resolution failed');
        return 'http://127.0.0.1:32008/central/unused.js';
      },
    },
  };
  await assert.rejects(identityPage(window).evaluate(captureFileBase64ExternalResolutions),
    /Runtime external resolution failed/);
});

test('awaited SystemJS results cannot replace exact runtime import-map binding', async () => {
  const { url, map, resolutions } = externals();
  const window = {
    System: { resolve: async name => `${resolutions[name]}&alias=1` },
  };
  const actual = await identityPage(window).evaluate(captureFileBase64ExternalResolutions);
  assert.throws(() => verifyFileBase64ExternalResolution(url, map, actual),
    /Actual SystemJS external resolution differs/);
});

for (const [label, mutate] of [
  ['missing runtime identity', fixture => { delete fixture.map.imports['@ibiz-template/runtime']; }],
  ['remote binary', fixture => { fixture.map.imports.vue = 'https://cdn.example/vue.js'; }],
  ['alternate runtime', fixture => { fixture.resolutions['@ibiz-template/runtime'] += '?original=1'; }],
  ['incorrect relative base', fixture => {
    fixture.resolutions.vue = new URL(fixture.map.imports.vue, fixture.url).href;
  }],
]) {
  test(`external import binding rejects ${label}`, () => {
    const fixture = externals();
    mutate(fixture);
    assert.throws(() => verifyFileBase64ExternalResolution(fixture.url, fixture.map, fixture.resolutions));
  });
}

async function deliveryServer(t, mutate = () => {}, redirect = false) {
  const prefix = `/central/plugins/${FILE_BASE64_IDENTITY.to}/`;
  const files = new Map(paths.map(path => [prefix + path, path]));
  files.set('/central/extras/json/system-import.json', '{"imports":{}}');
  mutate(files);
  const server = http.createServer((request, response) => {
    if (redirect && request.url === prefix + 'package.json') {
      response.writeHead(302, { location: '/central/alternate.json' });
      response.end();
      return;
    }
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
      pluginEntries: paths.map(path => entry(path, path)),
      runtimeEntries: [entry('extras/json/system-import.json', '{"imports":{}}')],
    },
  };
}

test('HTTP delivery binds all five deployment files/import map and four true 404 exclusions', async t => {
  const { url, options } = await deliveryServer(t);
  const checks = await verifyFileBase64HttpDelivery(url, options);
  assert.deepEqual(checks.map(check => check.status), [200, 200, 200, 200, 200, 200, 404, 404, 404, 404]);
  assert.ok(checks.every(check => check.path.startsWith('/central/')));
});
for (const [label, path, value, error] of [
  ['manifest tamper', `plugins/${FILE_BASE64_IDENTITY.to}/package.json`, 'tampered', /length differs/],
  ['same-size output tamper', `plugins/${FILE_BASE64_IDENTITY.to}/dist/style.css`,
    'xxxxxxxxxxxxxx', /hash differs/],
  ['missing SystemJS', `plugins/${FILE_BASE64_IDENTITY.to}/dist/index.system.js`, undefined, /status differs/],
  ['import-map tamper', 'extras/json/system-import.json', '{"imports":[]}', /hash differs/],
  ['original identity alias', `plugins/${FILE_BASE64_IDENTITY.from}/package.json`, '{}', /return 404/],
  ['missing-file fallback', `plugins/${FILE_BASE64_IDENTITY.to}/missing.js`, '<html>', /return 404/],
  ['receipt leak', `plugins/${FILE_BASE64_IDENTITY.to}/dist/build-receipt.json`, '{}', /return 404/],
  ['source leak', `plugins/${FILE_BASE64_IDENTITY.to}/src/editor.ts`, 'source', /return 404/],
]) {
  test(`HTTP delivery rejects ${label}`, async t => {
    const { url, options } = await deliveryServer(t, files => {
      if (value === undefined) files.delete('/central/' + path);
      else files.set('/central/' + path, value);
    });
    await assert.rejects(verifyFileBase64HttpDelivery(url, options), error);
  });
}
test('HTTP delivery refuses redirects even to another local resource', async t => {
  const { url, options } = await deliveryServer(t, () => {}, true);
  await assert.rejects(verifyFileBase64HttpDelivery(url, options), /fetch failed/);
});
test('HTTP preflight refuses incomplete deployment or absent verified import map', async t => {
  const { url, options } = await deliveryServer(t);
  await assert.rejects(verifyFileBase64HttpDelivery(url, {
    ...options, pluginEntries: options.pluginEntries.slice(1),
  }), /Complete replacement deployment/);
  await assert.rejects(verifyFileBase64HttpDelivery(url, { ...options, runtimeEntries: [] }),
    /Exactly one verified runtime import map/);
});

test('reader race probe delegates conversion and abort, releases queued callbacks, restores identity', t => {
  const readers = [];
  class NativeFixture {
    result = null;
    reads = [];
    aborts = 0;
    constructor() { readers.push(this); }
    readAsDataURL(file) { this.reads.push(file); }
    abort() { this.aborts += 1; this.onabort?.({ type: 'abort' }); }
  }
  const previous = globalThis.window;
  globalThis.window = { FileReader: NativeFixture };
  t.after(() => {
    if (previous === undefined) delete globalThis.window;
    else globalThis.window = previous;
  });
  installFileReaderProbe();
  const probe = window.__fileBase64ReaderProbe;
  const wrapped = new window.FileReader();
  const blob = {};
  let emitted = 0;
  wrapped.onload = () => { emitted += 1; };
  wrapped.readAsDataURL(blob);
  assert.deepEqual(readers[0].reads, [blob]);
  readers[0].result = 'data:text/plain;base64,YQ==';
  readers[0].onload({ type: 'load' });
  assert.equal(probe.pending.length, 1);
  assert.equal(emitted, 0);
  assert.equal(wrapped.result, readers[0].result);
  wrapped.onload = null;
  wrapped.abort();
  probe.release();
  assert.equal(probe.released, 1);
  assert.equal(probe.aborts, 1);
  assert.equal(readers[0].aborts, 1);
  assert.equal(emitted, 0, 'Cleared callbacks cannot reappear after release');
  wrapped.onload = () => { emitted += 1; };
  readers[0].onload({ type: 'load' });
  probe.release();
  assert.equal(emitted, 1, 'Positive control must deliver uncancelled reads');
  probe.restore();
  assert.equal(window.FileReader, NativeFixture);
});
