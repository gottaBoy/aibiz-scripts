import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm, symlink, utimes, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  collectHarnessStatus,
  createHarnessServer,
  discoverHarnessReports,
  parseHarnessConfig,
  renderHarnessPage,
  renderReportsPage,
} from '../harness-ui-server.mjs';

async function fixture(t, status = 200, body = 'ok') {
  const server = createServer((_request, response) => {
    response.statusCode = status;
    response.end(body);
  });
  t.after(() => server.close());
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}/`;
}

test('harness config defaults to host-accessible PLM and Modeling endpoints', () => {
  const config = parseHarnessConfig({});
  assert.equal(config.port, 19323);
  assert.match(config.plmUrl, /127\.0\.0\.1:30250/);
  assert.match(config.modelingUrl, /127\.0\.0\.1:32003\/modeldesign/);
  assert.match(config.modelingServiceUrl, /127\.0\.0\.1:32002\/ibizmodeling\/modelapi/);
  assert.equal(config.reportRoots.length, 2);
});

test('harness status is fail-closed when a required dependency is unavailable', async t => {
  const okUrl = await fixture(t);
  const authUrl = await fixture(t, 401);
  const badUrl = 'http://127.0.0.1:1/unavailable';
  const status = await collectHarnessStatus({
    plmUrl: okUrl,
    modelingServiceUrl: authUrl,
    modelingUrl: okUrl,
    modelingDocUrl: okUrl,
    modelingPluginsUrl: badUrl,
    publicPlmUrl: okUrl,
    publicModelingUrl: okUrl,
    publicModelingDocUrl: okUrl,
    timeoutMs: 250,
  });
  assert.equal(status.status, 'fail');
  assert.equal(status.checks.filter(check => check.ok).length, 4);
  assert.equal(status.checks.find(check => check.id === 'modeling-plugins').ok, false);
  assert.match(renderHarnessPage(status), /BLOCKED/);
});

test('harness server returns 200 only after all checks pass', async t => {
  const okUrl = await fixture(t);
  const authUrl = await fixture(t, 403);
  const reportRoot = await mkdtemp(join(tmpdir(), 'aibiz-harness-empty-reports-'));
  t.after(() => rm(reportRoot, { recursive: true, force: true }));
  const config = {
    plmUrl: okUrl,
    modelingServiceUrl: authUrl,
    modelingUrl: okUrl,
    modelingDocUrl: okUrl,
    modelingPluginsUrl: okUrl,
    publicPlmUrl: okUrl,
    publicModelingUrl: okUrl,
    publicModelingDocUrl: okUrl,
    reportRoots: [reportRoot],
    timeoutMs: 1000,
  };
  const server = createHarnessServer(config);
  t.after(() => server.close());
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const root = `http://127.0.0.1:${server.address().port}/`;
  const response = await fetch(root);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /AIBIZ local verification harness/);
  const health = await fetch(`${root}healthz`);
  assert.equal(health.status, 200);
  assert.equal(await health.text(), 'pass\n');
});

for (const upstreamStatus of [200, 404]) {
  test(`root, health and status bypass report discovery without hiding HTTP ${upstreamStatus}`, async t => {
    const config = parseHarnessConfig({});
    Object.defineProperty(config, 'reportRoots', {
      get() { throw new Error('Readiness must not traverse the report catalog'); },
    });
    let probes = 0;
    const server = createHarnessServer(config, async url => {
      probes++;
      return new Response(null, {
        status: url === config.modelingServiceUrl ? 401 : upstreamStatus,
      });
    });
    t.after(() => server.close());
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    const expected = upstreamStatus === 200 ? 'pass' : 'fail';
    for (const path of ['/', '/healthz', '/api/status']) {
      const response = await fetch(`${base}${path}`);
      assert.equal(response.status, upstreamStatus === 200 ? 200 : 503);
      if (path === '/api/status') {
        const result = await response.json();
        assert.equal(result.status, expected);
        assert.equal(result.checks.length, 5);
      } else if (path === '/healthz') {
        assert.equal(await response.text(), `${expected}\n`);
      } else {
        assert.match(await response.text(), upstreamStatus === 200 ? /READY/ : /BLOCKED/);
      }
    }
    assert.equal(probes, 15, 'All five dependencies must be checked on every request');
  });
}

test('harness fails when the modeling backend is down even if all web pages work', async t => {
  const okUrl = await fixture(t);
  const status = await collectHarnessStatus({
    plmUrl: okUrl,
    modelingUrl: okUrl,
    modelingDocUrl: okUrl,
    modelingPluginsUrl: okUrl,
    modelingServiceUrl: 'http://127.0.0.1:1/ibizmodeling/modelapi/',
    timeoutMs: 250,
  });
  assert.equal(status.status, 'fail');
  assert.equal(status.checks.find(check => check.id === 'modeling-service').ok, false);
  assert.equal(status.checks.filter(check => check.ok).length, 4);
});

test('redirects and non-page success codes are not readiness evidence', async t => {
  const config = parseHarnessConfig({});
  for (const statusCode of [201, 204, 301, 302, 304, 307, 308]) {
    const status = await collectHarnessStatus(config, async (url, options) => {
      assert.equal(options.redirect, 'manual');
      return new Response(null, {
        status: url === config.modelingServiceUrl ? 401 : statusCode,
      });
    });
    assert.equal(status.status, 'fail', String(statusCode));
    assert.equal(status.checks.filter(check => check.ok).length, 1);
  }
});

test('report catalog discovers the repo Playwright report and historical report roots', async t => {
  const root = await mkdtemp(join(tmpdir(), 'aibiz-harness-reports-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const current = join(root, 'plm-e2e', 'playwright-report');
  const historical = join(root, '.artifacts', 'run-001', 'reports', 'playwright-report');
  await mkdir(join(current, 'data'), { recursive: true });
  await mkdir(historical, { recursive: true });
  await writeFile(join(current, 'index.html'), '<html>current</html>');
  await writeFile(join(current, 'data', 'asset.js'), 'window.current = true;');
  await writeFile(join(historical, 'index.html'), '<html>historical</html>');
  const reports = await discoverHarnessReports({
    reportRoots: [join(root, 'plm-e2e', 'playwright-report'), join(root, '.artifacts')],
  });
  assert.equal(reports.length, 2);
  assert.equal(reports.every(report => report.id && report.source), true);
  assert.match(renderReportsPage(reports), /Open original report/);
});

test('report API follows explicit mounted roots and discovers new reports newest-first', async t => {
  const root = await mkdtemp(join(tmpdir(), 'aibiz-harness-live-reports-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const current = join(root, 'plm-e2e', 'playwright-report');
  const artifacts = join(root, '.artifacts');
  await mkdir(current, { recursive: true });
  await mkdir(artifacts, { recursive: true });
  const config = parseHarnessConfig({
    AIBIZ_HARNESS_REPORT_ROOTS: ` ${current}, ${artifacts} `,
  });
  assert.deepEqual(config.reportRoots, [current, artifacts]);
  const server = createHarnessServer(config);
  t.after(() => server.close());
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  async function catalog() {
    const response = await fetch(`${base}/api/reports`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    return (await response.json()).reports;
  }
  assert.deepEqual(await catalog(), []);

  const currentIndex = join(current, 'index.html');
  await writeFile(currentIndex, '<html>current report</html>');
  await utimes(currentIndex, new Date('2026-10-05T00:00:00Z'), new Date('2026-10-05T00:00:00Z'));
  const initial = await catalog();
  assert.deepEqual(initial.map(report => report.indexPath), [currentIndex]);

  const latest = join(artifacts, 'new-run', 'reports', 'playwright-report');
  await mkdir(latest, { recursive: true });
  const latestIndex = join(latest, 'index.html');
  const latestBytes = '<html>newly completed report</html>';
  await writeFile(latestIndex, latestBytes);
  await utimes(latestIndex, new Date('2026-10-06T00:00:00Z'), new Date('2026-10-06T00:00:00Z'));
  const updated = await catalog();
  assert.deepEqual(updated.map(report => report.indexPath), [latestIndex, currentIndex]);
  assert.equal(updated[1].id, initial[0].id);
  const response = await fetch(`${base}/reports/${updated[0].id}/`);
  assert.equal(response.status, 200);
  assert.equal(await response.text(), latestBytes);
});

test('historical report UI is served independently while readiness remains fail-closed', async t => {
  const root = await mkdtemp(join(tmpdir(), 'aibiz-harness-report-server-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const reportRoot = join(root, 'playwright-report');
  await mkdir(join(reportRoot, 'data'), { recursive: true });
  await writeFile(join(reportRoot, 'index.html'), '<html>original playwright ui</html>');
  await writeFile(join(reportRoot, 'data', 'app.js'), 'console.log("report");');
  const badUrl = 'http://127.0.0.1:1/unavailable';
  const config = {
    plmUrl: badUrl,
    modelingServiceUrl: badUrl,
    modelingUrl: badUrl,
    modelingDocUrl: badUrl,
    modelingPluginsUrl: badUrl,
    reportRoots: [reportRoot],
    timeoutMs: 100,
  };
  const server = createHarnessServer(config);
  t.after(() => server.close());
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const reports = await fetch(`${base}/reports/`);
  assert.equal(reports.status, 200);
  assert.match(await reports.text(), /original report/);
  const report = JSON.parse(await (await fetch(`${base}/api/reports`)).text())
    .reports[0];
  const reportPage = await fetch(`${base}/reports/${report.id}/`);
  assert.equal(reportPage.status, 200);
  assert.match(await reportPage.text(), /original playwright ui/);
  const reportPageWithoutSlash = await fetch(`${base}/reports/${report.id}`);
  assert.equal(reportPageWithoutSlash.status, 200);
  assert.match(await reportPageWithoutSlash.text(), /original playwright ui/);
  const asset = await fetch(`${base}/reports/${report.id}/data/app.js`);
  assert.equal(asset.status, 200);
  assert.equal(asset.headers.get('content-type'), 'text/javascript; charset=utf-8');
  const rootResponse = await fetch(`${base}/`);
  assert.equal(rootResponse.status, 503);
  const statusResponse = await fetch(`${base}/api/status`);
  assert.equal(statusResponse.status, 503);
});

test('historical report paths cannot escape the report root', async t => {
  const root = await mkdtemp(join(tmpdir(), 'aibiz-harness-report-safe-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const reportRoot = join(root, 'playwright-report');
  await mkdir(reportRoot, { recursive: true });
  await writeFile(join(reportRoot, 'index.html'), 'safe');
  await writeFile(join(root, 'secret.txt'), 'secret');
  const server = createHarnessServer({
    plmUrl: 'http://127.0.0.1:1',
    modelingServiceUrl: 'http://127.0.0.1:1',
    modelingUrl: 'http://127.0.0.1:1',
    modelingDocUrl: 'http://127.0.0.1:1',
    modelingPluginsUrl: 'http://127.0.0.1:1',
    reportRoots: [reportRoot],
    timeoutMs: 100,
  });
  t.after(() => server.close());
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const report = (await (await fetch(`${base}/api/reports`)).json()).reports[0];
  const response = await fetch(
    `${base}/reports/${report.id}/%2e%2e/secret.txt`,
  );
  assert.equal(response.status, 404);
});

for (const kind of ['index', 'root', 'ancestor', 'nested-report']) {
  test(`report discovery rejects a symlinked ${kind}`, async t => {
    const root = await mkdtemp(join(tmpdir(), 'aibiz-harness-symlink-discovery-'));
    t.after(() => rm(root, { recursive: true, force: true }));
    const outside = join(root, 'outside');
    const reports = join(root, 'reports');
    await mkdir(outside);
    await mkdir(reports);
    await writeFile(join(outside, 'index.html'), 'private report sentinel');
    let configuredRoot = reports;
    if (kind === 'index') {
      await symlink(join(outside, 'index.html'), join(reports, 'index.html'));
    } else if (kind === 'nested-report') {
      await symlink(outside, join(reports, 'linked-report'), 'dir');
    } else {
      await symlink(outside, join(reports, 'linked-root'), 'dir');
      configuredRoot = join(reports, 'linked-root');
      if (kind === 'ancestor') {
        await mkdir(join(outside, 'child'));
        await writeFile(join(outside, 'child', 'index.html'), 'private child sentinel');
        configuredRoot = join(configuredRoot, 'child');
      }
    }
    assert.deepEqual(await discoverHarnessReports({ reportRoots: [configuredRoot] }), []);
    const server = createHarnessServer({ reportRoots: [configuredRoot] });
    t.after(() => server.close());
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const base = `http://127.0.0.1:${server.address().port}`;
    const id = Buffer.from(configuredRoot).toString('base64url');
    const response = await fetch(`${base}/reports/${id}/`);
    assert.equal(response.status, 404);
    assert.equal(await response.text(), 'not found');
  });
}

test('report assets reject symlink files and directories but preserve regular nested files', async t => {
  const root = await mkdtemp(join(tmpdir(), 'aibiz-harness-symlink-assets-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const reportRoot = join(root, 'reports');
  const outside = join(root, 'outside');
  await mkdir(join(reportRoot, 'data'), { recursive: true });
  await mkdir(outside);
  await writeFile(join(reportRoot, 'index.html'), 'public report');
  await writeFile(join(reportRoot, 'data', 'index.html'), 'public nested report');
  await writeFile(join(reportRoot, 'data', 'app.js'), 'public asset');
  await writeFile(join(outside, 'secret.txt'), 'private asset sentinel');
  await writeFile(join(outside, 'index.html'), 'private index sentinel');
  await symlink(join(outside, 'secret.txt'), join(reportRoot, 'file-link.txt'));
  await symlink(outside, join(reportRoot, 'directory-link'), 'dir');
  await symlink(join(outside, 'index.html'), join(reportRoot, 'data', 'index-link.html'));
  const server = createHarnessServer({ reportRoots: [reportRoot] });
  t.after(() => server.close());
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/reports/${Buffer.from(reportRoot).toString('base64url')}`;
  for (const path of ['file-link.txt', 'directory-link', 'directory-link/secret.txt',
    'directory-link/', 'data/index-link.html', 'data%2findex.html', 'data%5cindex.html']) {
    const response = await fetch(`${base}/${path}`);
    assert.equal(response.status, 404, path);
    assert.equal(await response.text(), 'not found', path);
  }
  for (const [path, expected] of [['', 'public report'], ['data/', 'public nested report'],
    ['data/app.js', 'public asset']]) {
    const response = await fetch(`${base}/${path}`);
    assert.equal(response.status, 200, path);
    assert.equal(await response.text(), expected);
  }
});

test('direct report lookup enforces catalog roots, depth, index and canonical identifiers', async t => {
  const root = await mkdtemp(join(tmpdir(), 'aibiz-harness-direct-report-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const allowedRoot = join(root, 'reports');
  const nested = join(allowedRoot, 'run', 'playwright-report');
  const hidden = join(nested, 'data');
  const outside = join(root, 'reports-other');
  const missingIndex = join(allowedRoot, 'no-report');
  const depthSeven = join(allowedRoot, ...Array.from({ length: 7 }, (_, i) => `d${i}`));
  const depthEight = join(allowedRoot, 'deep', ...Array.from({ length: 7 }, (_, i) => `d${i}`));
  for (const directory of [nested, hidden, outside, missingIndex, depthSeven, depthEight]) {
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'asset.js'), 'public asset');
    if (directory !== missingIndex) {
      await writeFile(join(directory, 'index.html'), `report ${directory}`);
    }
  }
  const config = { reportRoots: [allowedRoot] };
  const server = createHarnessServer(config);
  t.after(() => server.close());
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/reports`;
  const id = directory => Buffer.from(directory).toString('base64url');
  for (const invalid of [
    id(outside), id(missingIndex), id(hidden), id(depthEight),
    `${id(nested)}=`, id(`${nested}/.`), Buffer.from([255]).toString('base64url'),
    id('relative/report'), id(`${nested}\0`),
  ]) {
    const response = await fetch(`${base}/${encodeURIComponent(invalid)}/asset.js`);
    assert.equal(response.status, 404, invalid);
    assert.equal(await response.text(), 'not found');
  }
  for (const directory of [nested, depthSeven]) {
    const response = await fetch(`${base}/${id(directory)}/asset.js`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'public asset');
  }
  config.reportRoots.push(hidden);
  const explicitlyMounted = await fetch(`${base}/${id(hidden)}/asset.js`);
  assert.equal(explicitlyMounted.status, 200);
  assert.equal(await explicitlyMounted.text(), 'public asset');
  await rm(join(nested, 'index.html'));
  const removedIndex = await fetch(`${base}/${id(nested)}/asset.js`);
  assert.equal(removedIndex.status, 404);
});

test('direct report lookup does not traverse unrelated report directories', async t => {
  const root = await mkdtemp(join(tmpdir(), 'aibiz-harness-no-discovery-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const report = join(root, 'run', 'playwright-report');
  await mkdir(report, { recursive: true });
  await writeFile(join(report, 'index.html'), 'direct report');
  const server = createHarnessServer({
    reportRoots: [root],
  });
  t.after(() => server.close());
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  const { syncBuiltinESMExports } = await import('node:module');
  const fsPromises = (await import('node:fs/promises')).default;
  const originalReaddir = fsPromises.readdir;
  fsPromises.readdir = async () => { throw new Error('Report assets must not scan the catalog'); };
  syncBuiltinESMExports();
  try {
    const response = await fetch(`${base}/reports/${Buffer.from(report).toString('base64url')}/`);
    assert.equal(response.status, 200);
    assert.equal(await response.text(), 'direct report');
  } finally {
    fsPromises.readdir = originalReaddir;
    syncBuiltinESMExports();
  }
});

test('harness endpoints return 503 when an upstream returns HTTP 404', async t => {
  const badUrl = await fixture(t, 404);
  const reportRoot = await mkdtemp(join(tmpdir(), 'aibiz-harness-empty-reports-'));
  t.after(() => rm(reportRoot, { recursive: true, force: true }));
  const config = {
    plmUrl: badUrl,
    modelingServiceUrl: badUrl,
    modelingUrl: badUrl,
    modelingDocUrl: badUrl,
    modelingPluginsUrl: badUrl,
    reportRoots: [reportRoot],
    timeoutMs: 1000,
  };
  const server = createHarnessServer(config);
  t.after(() => server.close());
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const root = `http://127.0.0.1:${server.address().port}/`;
  for (const pathname of ['', 'api/status', 'healthz']) {
    const response = await fetch(`${root}${pathname}`);
    assert.equal(response.status, 503, pathname || 'root');
    if (pathname === 'api/status') {
      const status = await response.json();
      assert.equal(status.status, 'fail');
      assert.equal(status.checks.every(check => check.status === 404), true);
    } else {
      await response.text();
    }
  }
});
