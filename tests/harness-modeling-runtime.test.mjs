import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  analyzeDockerLogs,
  authenticateModelingService,
  checkModelingServiceBusiness,
  parseArgs,
  request,
  runHarness,
  summarizeStackResults,
  validApplicationModel,
  validFetchDefaultList,
  validObjectSchema,
} from '../harness-modeling-runtime.mjs';

test('modeling login uses the authentication proxy, not the business prefix', () => {
  const config = parseArgs([], {});
  assert.equal(config.authUrl, 'http://127.0.0.1:32003/api/ibizmodeling__modeldesign/');
  assert.equal(config.serviceUrl, 'http://127.0.0.1:32002/ibizmodeling/modelapi');
  assert.equal(
    parseArgs(['--web-url', 'http://127.0.0.1:32005/modeldesign/'], {}).authUrl,
    'http://127.0.0.1:32005/api/ibizmodeling__modeldesign/',
  );
  assert.equal(parseArgs(['--auth-url', 'http://fixture/auth'], {}).authUrl, 'http://fixture/auth');
  assert.throws(() => parseArgs(['--auth-url'], {}), /--auth-url requires a value/);
});

test('modeling business verification logs in separately and keeps tokens out of reports', async t => {
  const requests = [];
  const token = 'private-fixture-token';
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const chunk of request) body += chunk;
    requests.push({ path: request.url, body, authorization: request.headers.authorization });
    response.setHeader('Content-Type', 'application/json');
    if (request.url === '/auth/v7/login') {
      response.end(JSON.stringify({ token }));
    } else if (request.url === '/business/psdevusers/fetchdefault') {
      response.end('[]');
    } else {
      response.statusCode = 404;
      response.end('{}');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.address().port}`;
  const config = parseArgs(['--auth-url', `${base}/auth`, '--service-url', `${base}/business`], {});
  const report = { checks: [], failures: [], warnings: [] };
  assert.equal(await checkModelingServiceBusiness(report, config), token);
  assert.equal(report.failures.length, 0);
  assert.equal(report.checks.length, 2);
  assert.equal(JSON.stringify(report).includes(token), false);
  assert.deepEqual(requests.map(item => item.path), [
    '/auth/v7/login', '/business/psdevusers/fetchdefault',
  ]);
  assert.equal(requests[1].authorization, `Bearer ${token}`);
  assert.deepEqual(JSON.parse(requests[0].body), { loginname: 'aibizhi', password: '123456' });
});

test('configured modeling tokens do not require a login request', async () => {
  assert.deepEqual(await authenticateModelingService({ serviceToken: 'configured' }), {
    ok: true, token: 'configured', source: 'configured-token',
  });
});

test('modeling runtime request enforces an expected media type', async (t) => {
  const server = createServer((request, response) => {
    response.statusCode = 200;
    response.setHeader(
      'Content-Type',
      request.url === '/readme.md'
        ? 'text/markdown; charset=utf-8'
        : 'application/octet-stream',
    );
    response.end('# docs');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => server.close());
  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const valid = await request(`${baseUrl}/readme.md`, [200], {
    expectedContentType: 'text/markdown',
  });
  assert.equal(valid.ok, true);
  assert.equal(valid.contentTypeOk, true);

  const invalid = await request(`${baseUrl}/readme.txt`, [200], {
    expectedContentType: 'text/markdown',
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.contentTypeOk, false);
});

test('expectJson rejects invalid JSON even without a body validator', async t => {
  const server = createServer((incoming, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.end(incoming.url === '/valid' ? '{"ok":true}' : '{"ok":}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const valid = await request(`${base}/valid`, [200], { expectJson: true });
  assert.equal(valid.ok, true);
  const invalid = await request(`${base}/invalid`, [200], { expectJson: true });
  assert.equal(invalid.jsonOk, false);
  assert.equal(invalid.ok, false);
});

test('modeling runtime request never follows redirects and times out during body reading', async t => {
  let followed = false;
  const server = createServer((incoming, response) => {
    if (incoming.url === '/redirect') {
      response.writeHead(302, { Location: '/target' });
      response.end();
    } else if (incoming.url === '/target') {
      followed = true;
      response.end('{}');
    } else {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.flushHeaders();
      response.write('[');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  assert.equal((await request(`${base}/redirect`, [200])).ok, false);
  assert.equal(followed, false);
  const stalled = await request(`${base}/stalled`, [200], { expectJson: true, timeoutMs: 100 });
  assert.equal(stalled.ok, false);
  assert.equal(stalled.jsonOk, false);
  assert.ok(stalled.error);
});

test('required local models reject HTML fallback, invalid JSON and unrelated objects', async t => {
  const application = {
    codeName: 'plmweb', getAllPSAppDataEntities: [{ id: 'idea' }], getAllPSAppViews: [{ id: 'main' }],
  };
  const schema = { type: 'object', properties: { id: { type: 'string' } } };
  const server = createServer((incoming, response) => {
    const [kind, fault] = incoming.url.slice(1).split('/');
    response.setHeader('Content-Type', fault === 'html' ? 'text/html'
      : kind === 'application' ? 'application/json' : 'application/schema+json');
    response.end(fault === 'html' ? '<html>SPA fallback</html>'
      : fault === 'invalid' ? '[invalid]' : fault === 'unrelated' ? '{"ok":true}'
        : JSON.stringify(kind === 'application' ? application : schema));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const [kind, contentType, validator] of [
    ['application', 'application/json', validApplicationModel],
    ['schema', 'application/schema+json', validObjectSchema],
  ]) {
    for (const fault of ['valid', 'html', 'invalid', 'unrelated']) {
      const result = await request(`${base}/${kind}/${fault}`, [200], {
        expectJson: true, expectedContentType: contentType, bodyValidator: validator,
      });
      assert.equal(result.ok, fault === 'valid', `${kind}/${fault}`);
    }
  }
  assert.equal(validApplicationModel({ ...application, getAllPSAppViews: [] }), false);
  assert.equal(validApplicationModel({ ...application, codeName: '' }), false);
  assert.equal(validObjectSchema({ type: 'array', properties: schema.properties }), false);
  assert.equal(validObjectSchema({ type: 'object', properties: [] }), false);
  assert.equal(validObjectSchema({ type: 'object', properties: {} }), false);
});

test('modeling service business contract requires an authenticated list response', async (t) => {
  let received;
  const server = createServer(async (request, response) => {
    received = {
      method: request.method,
      url: request.url,
      authorization: request.headers.authorization,
      body: '',
    };
    for await (const chunk of request) received.body += chunk;
    response.statusCode = 200;
    response.setHeader('Content-Type', 'application/json');
    response.end('[]');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => server.close());
  const address = server.address();
  const result = await request(
    `http://127.0.0.1:${address.port}/ibizmodeling/modelapi/psdevusers/fetchdefault`,
    [200],
    {
      method: 'POST',
      headers: { authorization: 'Bearer fixture' },
      body: JSON.stringify({ page: 0, size: 20 }),
      expectJson: true,
      bodyValidator: validFetchDefaultList,
    },
  );
  assert.equal(result.ok, true);
  assert.equal(result.bodyValid, true);
  assert.deepEqual(received, {
    method: 'POST',
    url: '/ibizmodeling/modelapi/psdevusers/fetchdefault',
    authorization: 'Bearer fixture',
    body: '{"page":0,"size":20}',
  });
});

test('modeling service list validation rejects false-success payloads', () => {
  assert.equal(validFetchDefaultList([]), true);
  assert.equal(validFetchDefaultList([{ id: 'user-1' }]), true);
  assert.equal(validFetchDefaultList({ data: [] }), false);
  assert.equal(validFetchDefaultList([{}]), false);
  assert.equal(validFetchDefaultList([null]), false);
});

test('modeling runtime harness validates modes and writes an explicit skip report', async () => {
  const reportDir = await mkdtemp(join(tmpdir(), 'modeling-runtime-contract-'));
  const config = parseArgs(['--mode', 'off', '--report-dir', reportDir]);

  assert.equal(config.mode, 'off');
  assert.equal(await runHarness(config), 0);

  const report = JSON.parse(await readFile(join(reportDir, 'report.json'), 'utf8'));
  assert.equal(report.status, 'skip');
  assert.equal(report.exitCode, 0);
  assert.equal(report.checks[0].status, 'skip');
  assert.match(report.checks[0].detail, /disabled by --mode off/);
});

test('required mode writes a failure with zero skipped checks when Docker is unavailable', async t => {
  const reportDir = await mkdtemp(join(tmpdir(), 'modeling-runtime-required-'));
  t.after(() => rm(reportDir, { recursive: true, force: true }));
  const config = parseArgs(['--required', '--report-dir', reportDir], {});
  const previousPath = process.env.PATH;
  let exitCode;
  try {
    process.env.PATH = reportDir;
    exitCode = await runHarness(config);
  } finally {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
  }
  const report = JSON.parse(await readFile(join(reportDir, 'report.json'), 'utf8'));
  assert.equal(exitCode, 1);
  assert.equal(report.status, 'fail');
  assert.equal(report.exitCode, 1);
  assert.ok(report.failures.length > 0);
  assert.equal(report.checks.filter(check => check.status === 'skip').length, 0);
  assert.equal(report.checks.find(check => check.name === 'docker').status, 'fail');
});

test('modeling runtime harness rejects unknown modes and options', () => {
  assert.throws(
    () => parseArgs(['--mode', 'sometimes']),
    /Invalid --mode: sometimes/,
  );
  assert.throws(
    () => parseArgs(['--unknown']),
    /Unknown option: --unknown/,
  );
});

test('modeling runtime harness fails when docker logs itself exits non-zero', () => {
  const result = analyzeDockerLogs(
    { stdout: '', stderr: 'permission denied\n', code: 13 },
    'modelingservice',
  );
  assert.equal(result.status, 'fail');
  assert.match(result.detail, /docker logs exited with code 13/);
  assert.deepEqual(result.lines, ['permission denied']);
});

test('modeling runtime auto mode only skips when no modeling container is running', () => {
  const stopped = summarizeStackResults([
    { stdout: '{"Status":"exited","Running":false}' },
    { stdout: '' },
    { stdout: '{"Status":"created","Running":false}' },
  ]);
  assert.deepEqual(stopped, { existing: 2, running: 0, errors: 0 });

  const partial = summarizeStackResults([
    { stdout: '{"Status":"running","Running":true}' },
    { stdout: '{"Status":"exited","Running":false}' },
    { stdout: '' },
  ]);
  assert.deepEqual(partial, { existing: 2, running: 1, errors: 0 });
});

test('modeling runtime does not auto-skip Docker inspect errors', () => {
  assert.deepEqual(
    summarizeStackResults([
      { stdout: '', stderr: 'daemon error', code: 1 },
      { stdout: '{"Status":"running","Running":true}' },
    ]),
    { existing: 1, running: 1, errors: 1 },
  );
});
