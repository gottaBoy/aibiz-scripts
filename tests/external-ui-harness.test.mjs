import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  isAcceptedMainStatus,
  isUnavailableError,
  parseExternalUiConfig,
  runExternalUiHarness,
} from '../external-ui-harness.mjs';

test('external UI config defaults to the project test target and auto mode', () => {
  const config = parseExternalUiConfig([], {}, new Date('2026-09-28T00:00:00.000Z'));
  assert.equal(config.url, 'http://127.0.0.1:19323/#?');
  assert.equal(config.mode, 'auto');
  assert.equal(config.selector, 'body');
  assert.equal(config.failOnHttpErrors, true);
});

test('external UI config supports required mode and rejects embedded credentials', () => {
  const config = parseExternalUiConfig(
    ['--url', 'http://127.0.0.1:19323/#?', '--required', '--selector', '#app'],
    {},
  );
  assert.equal(config.mode, 'required');
  assert.equal(config.selector, '#app');
  assert.throws(
    () => parseExternalUiConfig(['--url', 'http://user:pass@127.0.0.1:19323/'], {}),
    /without embedded credentials/,
  );
  assert.throws(
    () => parseExternalUiConfig(['--url', 'https://example.com/'], {}),
    /local loopback host/,
  );
});

test('external UI status and transport classifiers are strict', () => {
  assert.equal(isAcceptedMainStatus(200), true);
  assert.equal(isAcceptedMainStatus(302), true);
  assert.equal(isAcceptedMainStatus(404), false);
  assert.equal(isAcceptedMainStatus(401, [200, 401]), true);
  assert.equal(isAcceptedMainStatus(401, [200]), false);
  assert.equal(isUnavailableError(Object.assign(new Error('connect'), { code: 'ECONNREFUSED' })), true);
  assert.equal(isUnavailableError(new Error('page returned 500')), false);
});

async function fixture(t, body) {
  const server = createServer((request, response) => {
    response.setHeader('content-type', 'text/html; charset=utf-8');
    const result = body(request.url);
    if (typeof result === 'object') {
      response.statusCode = result.status;
      response.end(result.body);
      return;
    }
    response.end(result);
  });
  t.after(
    () =>
      new Promise(resolve => {
        server.closeAllConnections();
        server.close(resolve);
      }),
  );
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return `http://127.0.0.1:${server.address().port}/`;
}

test(
  'external UI browser harness passes a clean page and writes screenshot/report',
  { timeout: 60000 },
  async t => {
    const url = await fixture(
      t,
      () =>
        '<!doctype html><title>Harness fixture</title><main id="app">Ready</main>',
    );
    const reportDir = await mkdtemp(join(tmpdir(), 'aibiz-external-ui-pass-'));
    t.after(() => rm(reportDir, { recursive: true, force: true }));
    const report = await runExternalUiHarness(
      parseExternalUiConfig(
        ['--url', url, '--mode', 'required', '--report-dir', reportDir, '--selector', '#app'],
        {},
      ),
    );
    assert.equal(report.status, 'pass');
    assert.equal(report.title, 'Harness fixture');
    assert.ok(report.screenshot);
    assert.deepEqual(
      JSON.parse(await readFile(report.reportFile, 'utf8')).status,
      'pass',
    );
  },
);

test(
  'external UI browser harness fails on page errors and HTTP asset errors',
  { timeout: 60000 },
  async t => {
    const url = await fixture(
      t,
      requestUrl => {
        if (requestUrl === '/') {
          return '<!doctype html><title>Broken fixture</title><main id="app">Ready</main><script>console.error("fixture error")</script><img src="/missing.png">';
        }
        return { status: 404, body: 'missing' };
      },
    );
    const reportDir = await mkdtemp(join(tmpdir(), 'aibiz-external-ui-fail-'));
    t.after(() => rm(reportDir, { recursive: true, force: true }));
    const report = await runExternalUiHarness(
      parseExternalUiConfig(
        ['--url', url, '--mode', 'required', '--report-dir', reportDir],
        {},
      ),
    );
    assert.equal(report.status, 'fail');
    assert.ok(report.consoleErrors.some(error => error.text.includes('fixture error')));
    assert.ok(report.httpErrors.some(error => error.url.endsWith('/missing.png')));
  },
);

test('external UI auto mode skips an unavailable target without a browser', async () => {
  const reportDir = await mkdtemp(join(tmpdir(), 'aibiz-external-ui-skip-'));
  const port = 39000 + Math.floor(Math.random() * 1000);
  try {
    const report = await runExternalUiHarness(
      parseExternalUiConfig(
        [
          '--url',
          `http://127.0.0.1:${port}/#?`,
          '--mode',
          'auto',
          '--report-dir',
          reportDir,
          '--timeout-ms',
          '250',
        ],
        {},
      ),
    );
    assert.equal(report.status, 'skip');
    assert.equal(report.probe.error !== undefined, true);
    assert.deepEqual(report.checks, [
      {
        name: 'external-ui-reachable',
        status: 'skip',
        detail: 'service is not running',
      },
    ]);
  } finally {
    await rm(reportDir, { recursive: true, force: true });
  }
});

test('external UI required mode records probe failure in failureSummary', async () => {
  const reportDir = await mkdtemp(join(tmpdir(), 'aibiz-external-ui-required-fail-'));
  const port = 40000 + Math.floor(Math.random() * 1000);
  try {
    const report = await runExternalUiHarness(
      parseExternalUiConfig(
        [
          '--url',
          `http://127.0.0.1:${port}/#?`,
          '--mode',
          'required',
          '--report-dir',
          reportDir,
          '--timeout-ms',
          '250',
        ],
        {},
      ),
    );
    assert.equal(report.status, 'fail');
    assert.deepEqual(report.failureSummary, [
      `external-ui-reachable: ${report.probe.error}`,
    ]);
    assert.deepEqual(
      JSON.parse(await readFile(report.reportFile, 'utf8')).failureSummary,
      report.failureSummary,
    );
  } finally {
    await rm(reportDir, { recursive: true, force: true });
  }
});
