import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import {
  auditPlmPluginServedBytes, loopbackPluginBase, normalizePluginOutput,
  main, writePlmPluginByteReport,
} from '../audit-plm-plugin-served-bytes.mjs';

const repo = '@example/plugin@1.2.3';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

function write(path, value) {
  fs.mkdirSync(dirname(path), { recursive: true });
  fs.writeFileSync(path, typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value));
}

async function fixture(t, { system = 'dist/index.js', styles = ['dist/style.css'], source = false } = {}) {
  const root = fs.mkdtempSync(join(tmpdir(), 'plm-served-bytes-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const model = join(root, 'model.json');
  const publicPlugins = join(root, 'public/plugins');
  const dist = join(root, 'dist');
  const sourcePlugins = source ? join(root, 'source') : undefined;
  const manifest = { name: '@example/plugin', version: '1.2.3', system, styles };
  const relativeSystem = normalizePluginOutput(system).path;
  const payloads = new Map([
    ['package.json', JSON.stringify(manifest)],
    [relativeSystem, 'export const value = 41;\n'],
    ...styles.map(style => [normalizePluginOutput(style).path, 'body { color: red; }\n']),
  ]);
  write(model, { first: { rTObjectRepo: repo }, duplicate: { rTObjectRepo: repo } });
  for (const [path, bytes] of payloads) {
    write(join(publicPlugins, repo, path), bytes);
    write(join(dist, 'plugins', repo, path), bytes);
    if (sourcePlugins) write(join(sourcePlugins, repo, path), bytes);
  }
  const requests = [];
  const state = { root, model, publicPlugins, dist, sourcePlugins, manifest, payloads, requests,
    response() { return undefined; } };
  const server = createServer((request, response) => {
    requests.push(request.url);
    const custom = state.response(request, response);
    if (custom === true) return;
    const prefix = `/app/plugins/${repo}/`;
    const decoded = decodeURIComponent(request.url);
    const body = decoded.startsWith(prefix) ? payloads.get(decoded.slice(prefix.length)) : undefined;
    if (body === undefined) {
      response.writeHead(404);
      response.end('missing');
    } else {
      response.writeHead(200, { 'Content-Type': 'application/octet-stream' });
      response.end(body);
    }
  });
  await new Promise(accept => server.listen(0, '127.0.0.1', accept));
  t.after(() => new Promise(accept => {
    server.close(accept);
    server.closeAllConnections();
  }));
  state.options = { model, publicPlugins, dist, sourcePlugins,
    baseUrl: `http://127.0.0.1:${server.address().port}/app/` };
  state.audit = overrides => auditPlmPluginServedBytes({ ...state.options, ...overrides });
  state.find = (report, path = relativeSystem) =>
    report.packages[0].files.find(row => row.path === `plugins/${repo}/${path}`);
  return state;
}

test('model references and declared outputs bind complete SHA256 public/dist/HTTP bytes', async t => {
  const s = await fixture(t, { source: true });
  const report = await s.audit();
  assert.equal(report.passed, true);
  assert.equal(report.summary.packages, 1);
  assert.equal(report.summary.files, 3);
  assert.equal(report.summary.matchedFiles, 3);
  assert.equal(report.sourceBuildVerified, false);
  assert.equal(report.nativeAcceptance, false);
  assert.equal(report.coverage.transitiveAssets, false);
  assert.equal(report.coverage.sourceComparison, 'declared-build-output-bytes-only');
  const row = s.find(report);
  assert.equal(row.http.sha256, digest(s.payloads.get('dist/index.js')));
  assert.equal(row.http.sha256.length, 64);
  assert.deepEqual(row.comparisons, {
    publicDist: 'match', distHttp: 'match', publicHttp: 'match', sourcePublic: 'match',
  });
  assert.equal(s.requests.length, 3);
  assert.equal(JSON.stringify(report).includes('export const'), false);
});

test('200 responses with different bytes are reported as mismatches, not success', async t => {
  const s = await fixture(t);
  s.payloads.set('dist/index.js', 'old served version');
  const report = await s.audit();
  assert.equal(report.passed, false);
  assert.equal(s.find(report).http.httpStatus, 200);
  assert.ok(s.find(report).issues.includes('distHttp-bytes-mismatch'));
  assert.ok(s.find(report).issues.includes('publicHttp-bytes-mismatch'));
});

test('hash comparison uses complete binary bytes without text decoding', async t => {
  const s = await fixture(t);
  const bytes = Buffer.from([0, 255, 195, 169, 13, 10, 128]);
  s.payloads.set('dist/style.css', bytes);
  write(join(s.publicPlugins, repo, 'dist/style.css'), bytes);
  write(join(s.dist, 'plugins', repo, 'dist/style.css'), bytes);
  const report = await s.audit();
  assert.equal(report.passed, true);
  assert.equal(s.find(report, 'dist/style.css').http.bytes, bytes.length);
  assert.equal(s.find(report, 'dist/style.css').http.sha256, digest(bytes));
});

test('missing local file and actual HTTP 404 are distinct failures', async t => {
  const s = await fixture(t);
  fs.unlinkSync(join(s.dist, 'plugins', repo, 'dist/index.js'));
  s.payloads.delete('dist/style.css');
  const report = await s.audit();
  assert.ok(s.find(report).issues.includes('dist-missing'));
  const missingHttp = s.find(report, 'dist/style.css');
  assert.ok(missingHttp.issues.includes('http-not-found'));
  assert.equal(missingHttp.http.httpStatus, 404);
  assert.equal(missingHttp.comparisons.distHttp, 'unavailable');
  assert.equal(report.passed, false);
});

test('source output mismatches are retained separately from public/dist/HTTP success', async t => {
  const s = await fixture(t, { source: true });
  write(join(s.sourcePlugins, repo, 'dist/index.js'), 'source-built variant');
  const report = await s.audit();
  assert.equal(s.find(report).comparisons.distHttp, 'match');
  assert.equal(s.find(report).comparisons.sourcePublic, 'mismatch');
  assert.equal(report.passed, false);
});

test('query/hash are removed while encoded Unicode, spaces, percent and plus retain file identity', async t => {
  const system = './dist/%E4%B8%AD%20a%2Bb%25.js?time=123#module';
  const s = await fixture(t, { system, styles: [] });
  const report = await s.audit();
  assert.equal(report.passed, true);
  assert.equal(s.requests[1], `/app/plugins/%40example/plugin%401.2.3/dist/%E4%B8%AD%20a%2Bb%25.js`);
  assert.equal(s.requests.some(path => /[?#]/.test(path)), false);
  assert.equal(s.find(report).path, `plugins/${repo}/dist/\u4e2d a+b%.js`);
});

test('all supported manifest fields are audited and duplicate output paths are fetched once', async t => {
  const s = await fixture(t, { styles: [] });
  Object.assign(s.manifest, { main: './dist/index.js?cache=1', module: 'es/module.mjs',
    types: 'types/index.d.ts', typings: 'types/index.d.ts#type' });
  s.payloads.set('package.json', JSON.stringify(s.manifest));
  s.payloads.set('es/module.mjs', 'export {};');
  s.payloads.set('types/index.d.ts', 'export declare const value: number;');
  for (const [path, bytes] of s.payloads) {
    write(join(s.publicPlugins, repo, path), bytes);
    write(join(s.dist, 'plugins', repo, path), bytes);
  }
  const report = await s.audit();
  assert.equal(report.passed, true);
  assert.equal(report.summary.files, 4);
  assert.deepEqual(s.find(report).fields, ['system', 'main']);
  assert.deepEqual(s.find(report, 'types/index.d.ts').fields, ['types', 'typings']);
});

for (const path of ['../escape.js', 'dist/../escape.js', '/api/read', '//evil.invalid/x',
  'http://evil.invalid/x', 'dist\\escape.js', '%2e%2e/x.js', 'dist/%2E/x.js',
  'dist/a%2fb.js', 'dist/a%5cb.js', 'dist/%00.js', 'dist/%252e%252e/x.js',
  'dist/%252fapi', 'dist/%zz.js', 'dist/%C0%AF.js', 'dist//x.js', '']) {
  test(`unsafe declared path is rejected before any file or HTTP selection: ${JSON.stringify(path)}`, () => {
    assert.throws(() => normalizePluginOutput(path));
  });
}

test('an invalid manifest path cannot cause arbitrary or external HTTP requests', async t => {
  const s = await fixture(t, { styles: [] });
  s.manifest.system = '../../../api/private?secret=discarded';
  s.payloads.set('package.json', JSON.stringify(s.manifest));
  write(join(s.publicPlugins, repo, 'package.json'), s.payloads.get('package.json'));
  write(join(s.dist, 'plugins', repo, 'package.json'), s.payloads.get('package.json'));
  const report = await s.audit();
  assert.equal(report.passed, false);
  assert.ok(report.packages[0].issues.includes('invalid-system-declaration'));
  assert.equal(s.requests.length, 1);
  assert.match(s.requests[0], /\/package.json$/);
});

for (const url of ['https://127.0.0.1:30250/app/', 'http://example.com/app/',
  'http://127.1:30250/app/', 'http://127.0.0.1.evil.invalid/app/',
  'http://user:password@localhost/app/', 'http://127.0.0.1:30250/app/?key=secret',
  'http://127.0.0.1:30250/app/#hash', 'http://127.0.0.1:30250/app/../',
  'http://127.0.0.1:30250/app/%2e%2e/', 'http://127.0.0.1:0/app/',
  'http://127.0.0.1:30250/app', 'http://127.0.0.1:30250//app/']) {
  test(`nonlocal or normalized base URL is rejected: ${url}`, () => {
    assert.throws(() => loopbackPluginBase(url));
  });
}

test('localhost is pinned to loopback without a DNS lookup', () => {
  assert.equal(loopbackPluginBase('http://localhost:30250/app/').href,
    'http://127.0.0.1:30250/app/');
  assert.equal(loopbackPluginBase('http://[::1]:30250/app/').href, 'http://[::1]:30250/app/');
});

test('redirects are reported and never followed, including same-origin redirects', async t => {
  const s = await fixture(t, { styles: [] });
  s.response = (request, response) => {
    response.writeHead(302, { Location: request.url.endsWith('package.json')
      ? 'http://example.invalid/private' : '/api/private' });
    response.end();
    return true;
  };
  const report = await s.audit();
  assert.equal(report.passed, false);
  assert.equal(s.requests.length, 2);
  assert.ok(report.packages[0].files.every(row => row.http.status === 'redirect-refused'));
  assert.equal(JSON.stringify(report).includes('example.invalid'), false);
});

test('oversized, encoded, non-200 and hanging responses cannot be accepted as matched', async t => {
  for (const mode of ['size', 'encoding', 'status', 'timeout']) {
    const s = await fixture(t, { styles: [] });
    s.response = (request, response) => {
      if (!request.url.endsWith('/dist/index.js')) return;
      if (mode === 'timeout') {
        response.writeHead(200);
        response.write('hanging');
      } else {
        response.writeHead(mode === 'status' ? 500 : 200,
          mode === 'encoding' ? { 'Content-Encoding': 'gzip' } : {});
        response.end(mode === 'size' ? 'x'.repeat(2048) : 'bad');
      }
      return true;
    };
    const report = await s.audit({ maxFileBytes: 1024, timeoutMs: 30 });
    assert.equal(s.find(report).http.status,
      { size: 'too-large', encoding: 'encoding-refused', status: 'http-error', timeout: 'timeout' }[mode]);
    assert.equal(report.passed, false);
  }
});

test('aggregate HTTP byte budget bounds subsequent requests', async t => {
  const s = await fixture(t);
  const report = await s.audit({ maxHttpBytes: 1 });
  assert.equal(s.requests.length, 1);
  assert.equal(report.passed, false);
  assert.equal(report.packages[0].files[0].http.status, 'too-large');
});

test('symlink local outputs are rejected rather than followed outside the selected root', async t => {
  const s = await fixture(t);
  const output = join(s.publicPlugins, repo, 'dist/index.js');
  fs.unlinkSync(output);
  fs.symlinkSync(join(s.dist, 'plugins', repo, 'dist/index.js'), output);
  const report = await s.audit();
  assert.equal(s.find(report).public.status, 'unsafe');
  assert.equal(report.passed, false);
});

test('local bytes changing while HTTP is observed invalidate the comparison', async t => {
  const s = await fixture(t);
  s.response = (request, response) => {
    if (!request.url.endsWith('/dist/index.js')) return;
    write(join(s.dist, 'plugins', repo, 'dist/index.js'), 'changed during request');
    response.end(s.payloads.get('dist/index.js'));
    return true;
  };
  const report = await s.audit();
  assert.ok(s.find(report).issues.includes('dist-changed-during-audit'));
  assert.equal(report.passed, false);
});

test('missing/invalid manifests and package identity drift remain explicit gaps', async t => {
  const s = await fixture(t);
  s.manifest.name = '@example/other';
  write(join(s.publicPlugins, repo, 'package.json'), s.manifest);
  const report = await s.audit();
  assert.ok(report.packages[0].issues.includes('public-manifest-identity-mismatch'));
  fs.unlinkSync(join(s.publicPlugins, repo, 'package.json'));
  const missing = await s.audit();
  assert.ok(missing.packages[0].issues.includes('public-manifest-unavailable'));
  assert.equal(missing.summary.files, 1);
  assert.equal(missing.passed, false);
});

test('selection is explicit, unknown packages and unsafe model references fail before HTTP', async t => {
  const s = await fixture(t);
  const selected = await s.audit({ packages: [repo] });
  assert.equal(selected.coverage.completeReferenceSelection, false);
  await assert.rejects(s.audit({ packages: ['other@1'] }), /Unknown selected plugin/);
  const before = s.requests.length;
  write(s.model, { rTObjectRepo: '../../escape@1' });
  await assert.rejects(s.audit(), /Invalid model plugin references/);
  assert.equal(s.requests.length, before);
});

test('explicit file budgets fail instead of silently truncating audited declarations', async t => {
  const s = await fixture(t);
  await assert.rejects(s.audit({ maxFiles: 1 }), /file count/);
  await assert.rejects(s.audit({ maxFileBytes: 65 * 1024 * 1024 }));
  await assert.rejects(s.audit({ timeoutMs: 0 }));
});

test('private report destination cannot escape workspace artifacts', () => {
  assert.throws(() => writePlmPluginByteReport({}, '/tmp/audit'));
  assert.throws(() => writePlmPluginByteReport({}, '../outside'));
});

test('CLI rejects an unsafe output destination before sending any HTTP request', async t => {
  const s = await fixture(t);
  await assert.rejects(main([
    '--model', s.model, '--public-plugins', s.publicPlugins, '--dist', s.dist,
    '--base-url', s.options.baseUrl, '--output', join(s.root, 'report'),
  ]), /direct child/);
  assert.equal(s.requests.length, 0);
});
