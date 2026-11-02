import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  auditNativeDeployment, expectedNativeMounts, inspectNativeAsset, inspectNativeDeployment,
} from '../harness-native-deployment.mjs';
import { resolveNativeModelingConfig } from '../native-modeling-config.mjs';

const scripts = fileURLToPath(new URL('../', import.meta.url));
const config = resolveNativeModelingConfig({}, '/tmp/native-workspace');
function passingInspection(application, target = config, workspace = '/tmp/native-workspace') {
  return {
    Id: 'test-container',
    State: { Running: true, Health: { Status: 'healthy' } },
    Config: { Env: [`NATIVE_MODEL_APP=${application}`, `NATIVE_PLATFORM_HOST=${target.platformHost}`] },
    Mounts: expectedNativeMounts(target, application, workspace).map(mount => ({
      Type: 'bind', Source: mount.source, Destination: mount.target, RW: false,
    })),
  };
}

test('healthy native containers must use the selected read-only mounts and platform', () => {
  for (const app of ['Central', 'ModelDesign']) {
    assert.deepEqual(inspectNativeDeployment(config, app, passingInspection(app),
      '/tmp/native-workspace'), []);
  }
});

for (const [name, mutate] of [
  ['old Central grid mount', state => { state.Mounts.at(-1).Source = '/old/query.json'; }],
  ['writable candidate', state => { state.Mounts[2].RW = true; }],
  ['missing mount', state => { state.Mounts.pop(); }],
  ['duplicate mount', state => { state.Mounts.push(state.Mounts[0]); }],
  ['wrong mount type', state => { state.Mounts[2].Type = 'volume'; }],
  ['stopped container', state => { state.State.Running = false; }],
  ['unhealthy container', state => { state.State.Health.Status = 'unhealthy'; }],
  ['wrong platform', state => { state.Config.Env[1] = 'NATIVE_PLATFORM_HOST=old-platform'; }],
  ['duplicate platform', state => { state.Config.Env.push(state.Config.Env[1]); }],
]) {
  test(`deployment audit rejects ${name}`, () => {
    const inspection = passingInspection('Central');
    mutate(inspection);
    assert.ok(inspectNativeDeployment(config, 'Central', inspection, '/tmp/native-workspace').length);
  });
}

test('HTTP success must match exact asset bytes and redirects are not followed', async () => {
  const bytes = Buffer.from('current source output');
  for (const [status, body, expected] of [
    [200, bytes, 'pass'], [200, 'old bundle', 'fail'], [200, '<html>fallback</html>', 'fail'],
    [302, bytes, 'fail'], [404, bytes, 'fail'],
  ]) {
    const result = await inspectNativeAsset('http://fixture/asset', bytes, async (_url, options) => {
      assert.equal(options.redirect, 'manual');
      assert.ok(options.signal instanceof AbortSignal);
      return new Response(body, { status });
    });
    assert.equal(result.status, expected);
  }
});

test('audit records every failure, binds current source and never claims native acceptance', async t => {
  const workspace = mkdtempSync(join(tmpdir(), 'native-deployment-'));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  const target = resolveNativeModelingConfig({}, workspace);
  const data = Buffer.from('current');
  const put = path => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, data);
  };
  put(join(target.nativeServiceCandidateRoot, 'model',
    'PSSYSAPPS/Central/PSAPPDEVIEWS/PSDevSlnGridView.json'));
  const plugin = join(target.nativeCandidateRoot, 'plugins/@aibiz/design-index@0.1.0/package.json');
  put(plugin);
  const requested = [];
  const options = {
    workspace, env: {},
    inspect: name => passingInspection(name.includes('central') ? 'Central' : 'ModelDesign',
      target, workspace),
    request: async url => {
      requested.push(new URL(url).pathname);
      return new Response(data);
    },
    indexSource: () => ({
      plugin: { sourceFingerprint: 'fixture-only' },
      files: { contents: [{ path: 'package.json', data }] },
    }),
  };
  const passing = await auditNativeDeployment(options);
  assert.equal(passing.status, 'pass');
  assert.equal(passing.evidenceOrigin, 'controlled-test-runner');
  assert.equal(passing.nativeAcceptance, false);
  assert.equal(passing.sourceClosure, false);
  assert.equal(passing.checks.length, 4);
  assert.deepEqual(requested, [
    '/api/ibizmodeling__central/remotemodel/PSSYSAPPS/Central/PSAPPDEVIEWS/PSDevSlnGridView.json',
    '/modeldesign/plugins/@aibiz/design-index@0.1.0/package.json',
  ]);
  writeFileSync(plugin, 'stale candidate');
  const stale = await auditNativeDeployment(options);
  assert.equal(stale.status, 'fail');
  assert.equal(stale.checks.at(-1).files[0].status, 'fail');
  const failed = await auditNativeDeployment({
    ...options,
    inspect() { throw new Error('container missing'); },
    request() { throw new Error('transport failed'); },
    indexSource() { throw new Error('source receipt mismatch'); },
  });
  assert.equal(failed.checks.length, 4);
  assert.ok(failed.checks.every(check => check.status === 'fail'));
});

test('audit checks every JS and CSS delivery after candidate and served byte mismatches', async t => {
  const workspace = mkdtempSync(join(tmpdir(), 'native-deployment-assets-'));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  const target = resolveNativeModelingConfig({}, workspace);
  const gridPath = 'PSSYSAPPS/Central/PSAPPDEVIEWS/PSDevSlnGridView.json';
  const grid = Buffer.from('current grid');
  const source = [
    { path: 'package.json', data: Buffer.from('{"name":"@aibiz/design-index"}') },
    { path: 'dist/index.mjs', data: Buffer.from('export const current = true;') },
    { path: 'dist/style.css', data: Buffer.from('.current { color: green; }') },
    { path: 'dist/index.system.js', data: Buffer.from('System.register([], function () {});') },
  ];
  const put = (path, data) => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, data);
  };
  put(join(target.nativeServiceCandidateRoot, 'model', gridPath), grid);
  const prefix = '/modeldesign/plugins/@aibiz/design-index@0.1.0/';
  const responses = new Map([[`/api/ibizmodeling__central/remotemodel/${gridPath}`, grid]]);
  for (const file of source) {
    put(join(target.nativeCandidateRoot, 'plugins/@aibiz/design-index@0.1.0', file.path),
      file.path === 'dist/index.mjs' ? Buffer.from('stale candidate JS') : file.data);
    responses.set(`${prefix}${file.path}`,
      file.path === 'dist/style.css' ? Buffer.from('.stale { color: red; }') : file.data);
  }
  const requested = [];
  const report = await auditNativeDeployment({
    workspace, env: {},
    inspect: name => passingInspection(name.includes('central') ? 'Central' : 'ModelDesign',
      target, workspace),
    request: async url => {
      const path = new URL(url).pathname;
      requested.push(path);
      assert.ok(responses.has(path), `Unexpected asset path: ${path}`);
      return new Response(responses.get(path));
    },
    indexSource: () => ({
      plugin: { sourceFingerprint: 'multi-file-fixture-only' },
      files: { contents: source },
    }),
  });
  assert.equal(report.status, 'fail');
  assert.equal(report.checks.length, 4);
  assert.ok(report.checks.slice(0, -1).every(check => check.status === 'pass'));
  const delivery = report.checks.at(-1);
  assert.equal(delivery.status, 'fail');
  assert.deepEqual(delivery.files.map(file => [file.path, file.status]), [
    ['package.json', 'pass'], ['dist/index.mjs', 'fail'],
    ['dist/style.css', 'fail'], ['dist/index.system.js', 'pass'],
  ]);
  assert.notEqual(delivery.files[1].candidateSha256, delivery.files[1].expectedSha256);
  assert.equal(delivery.files[1].actualSha256, delivery.files[1].expectedSha256);
  assert.equal(delivery.files[2].candidateSha256, delivery.files[2].expectedSha256);
  assert.notEqual(delivery.files[2].actualSha256, delivery.files[2].expectedSha256);
  assert.deepEqual(requested, [
    `/api/ibizmodeling__central/remotemodel/${gridPath}`,
    ...source.map(file => `${prefix}${file.path}`),
  ]);
});

test('documented regression and deployment commands are executable and expose help without Docker', () => {
  const manifest = JSON.parse(readFileSync(join(scripts, 'package.json')));
  for (const name of ['test:localization', 'test:localization:baseline', 'test:native-deployment']) {
    assert.ok(manifest.scripts[name], name);
    const result = spawnSync('npm', ['run', name, '--', '--help'], {
      cwd: scripts, encoding: 'utf8', timeout: 10_000,
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Usage:/);
  }
});
