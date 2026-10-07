#!/usr/bin/env node
import { readdir } from 'node:fs/promises';
import { createServer } from 'node:http';
import {
  basename,
  dirname,
  extname,
  relative,
  resolve,
  sep,
} from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PinnedDirectories, optionalStat, readPinnedFile } from './native-candidate-files.mjs';

const DEFAULT_PORT = 19323;
const DEFAULT_TIMEOUT_MS = 5000;
const scriptRoot = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(scriptRoot, '..');
const DEFAULT_REPORT_ROOTS = [
  resolve(workspaceRoot, 'plm-e2e/playwright-report'),
  resolve(workspaceRoot, '.artifacts'),
];

function positiveInteger(value, fallback, label) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function reportRoots(value) {
  const roots = String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
    .map(item => resolve(workspaceRoot, item));
  return roots.length ? roots : [...DEFAULT_REPORT_ROOTS];
}

export function parseHarnessConfig(env = process.env) {
  return {
    host: env.AIBIZ_HARNESS_HOST || '0.0.0.0',
    port: positiveInteger(env.AIBIZ_HARNESS_PORT, DEFAULT_PORT, 'port'),
    timeoutMs: positiveInteger(
      env.AIBIZ_HARNESS_TIMEOUT_MS,
      DEFAULT_TIMEOUT_MS,
      'timeout',
    ),
    plmUrl:
      env.AIBIZ_HARNESS_PLM_URL ||
      'http://127.0.0.1:30250/ibizplm-plmweb/',
    modelingUrl:
      env.AIBIZ_HARNESS_MODELING_URL ||
      'http://127.0.0.1:32003/modeldesign/',
    modelingDocUrl:
      env.AIBIZ_HARNESS_MODELING_DOC_URL ||
      'http://127.0.0.1:32003/modeldesign/doc/',
    modelingPluginsUrl:
      env.AIBIZ_HARNESS_MODELING_PLUGINS_URL ||
      'http://127.0.0.1:32003/modeling-plugins/healthz',
    modelingServiceUrl:
      env.AIBIZ_HARNESS_MODELING_SERVICE_URL ||
      'http://127.0.0.1:32002/ibizmodeling/modelapi/',
    publicPlmUrl:
      env.AIBIZ_HARNESS_PUBLIC_PLM_URL ||
      'http://127.0.0.1:30250/ibizplm-plmweb/',
    publicModelingUrl:
      env.AIBIZ_HARNESS_PUBLIC_MODELING_URL ||
      'http://127.0.0.1:32003/modeldesign/',
    publicModelingDocUrl:
      env.AIBIZ_HARNESS_PUBLIC_MODELING_DOC_URL ||
      'http://127.0.0.1:32003/modeldesign/doc/',
    publicModelingServiceUrl:
      env.AIBIZ_HARNESS_PUBLIC_MODELING_SERVICE_URL ||
      'http://127.0.0.1:32002/ibizmodeling/modelapi/',
    reportRoots: reportRoots(env.AIBIZ_HARNESS_REPORT_ROOTS),
  };
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function acceptedStatus(status) {
  return status === 200;
}

function reportId(directory) {
  return Buffer.from(directory).toString('base64url');
}

function reportSource(directory) {
  const source = relative(workspaceRoot, directory);
  return source && !source.startsWith('..') ? source : directory;
}

function inspectReport(directories, directory) {
  const indexPath = resolve(directory.path, 'index.html');
  try {
    directories.verify(directory);
    const index = optionalStat(directories.entry(directory, 'index.html'));
    if (!index?.isFile() || index.isSymbolicLink()) return null;
    return {
      id: reportId(directory.path),
      name: basename(directory.path) === 'playwright-report'
        ? 'Playwright HTML report'
        : basename(directory.path),
      source: reportSource(directory.path),
      root: directory.path,
      modifiedAt: index.mtime.toISOString(),
      indexPath,
    };
  } catch {
    return null;
  }
}

async function collectReportDirectories(directories, directory, depth, reports) {
  let pinned;
  try {
    pinned = directories.open(directory);
    const directReport = inspectReport(directories, pinned);
    if (directReport) {
      reports.push(directReport);
      return;
    }
    if (depth <= 0) return;
    const entries = await readdir(pinned.access, { withFileTypes: true });
    directories.verify(pinned);
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.isSymbolicLink()) continue;
      await collectReportDirectories(
        directories, resolve(directory, entry.name), depth - 1, reports,
      );
    }
  } catch {
    return;
  } finally {
    if (pinned) directories.release(pinned);
  }
}

export async function discoverHarnessReports(config = {}) {
  const roots = config.reportRoots?.length
    ? config.reportRoots
    : DEFAULT_REPORT_ROOTS;
  const reports = [];
  await Promise.all(
    [...new Set(roots.map(root => resolve(root)))].map(async root => {
      const directories = new PinnedDirectories();
      try { await collectReportDirectories(directories, root, 7, reports); }
      finally { directories.close(); }
    }),
  );
  const unique = new Map(reports.map(report => [report.root, report]));
  return [...unique.values()].sort((left, right) =>
    right.modifiedAt.localeCompare(left.modifiedAt),
  );
}

async function probe(url, timeoutMs, fetchImpl = fetch, accepted = acceptedStatus) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      redirect: 'manual',
    });
    await response.body?.cancel?.();
    return {
      url,
      status: response.status,
      ok: accepted(response.status),
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      url,
      status: null,
      ok: false,
      durationMs: Date.now() - startedAt,
      error: error?.message || String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function collectHarnessStatus(config, fetchImpl = fetch) {
  const checks = await Promise.all([
    probe(
      config.modelingServiceUrl,
      config.timeoutMs,
      fetchImpl,
      status => status === 401 || status === 403,
    ).then(result => ({
      id: 'modeling-service',
      label: 'Modeling service',
      ...result,
      publicUrl: config.publicModelingServiceUrl,
    })),
    probe(config.plmUrl, config.timeoutMs, fetchImpl).then(result => ({
      id: 'plm',
      label: 'PLM web',
      ...result,
      publicUrl: config.publicPlmUrl,
    })),
    probe(config.modelingUrl, config.timeoutMs, fetchImpl).then(result => ({
      id: 'modeling',
      label: 'Modeling web',
      ...result,
      publicUrl: config.publicModelingUrl,
    })),
    probe(config.modelingDocUrl, config.timeoutMs, fetchImpl).then(result => ({
      id: 'modeling-doc',
      label: 'Modeling documentation',
      ...result,
      publicUrl: config.publicModelingDocUrl,
    })),
    probe(config.modelingPluginsUrl, config.timeoutMs, fetchImpl).then(result => ({
      id: 'modeling-plugins',
      label: 'Modeling plugins',
      ...result,
      publicUrl: config.publicModelingUrl,
    })),
  ]);
  return {
    checkedAt: new Date().toISOString(),
    status: checks.every(check => check.ok) ? 'pass' : 'fail',
    checks,
  };
}

function statusText(check) {
  if (check.ok) return `HTTP ${check.status}`;
  if (check.status !== null) return `HTTP ${check.status}`;
  return check.error || 'request failed';
}

function reportLink(report) {
  return `/reports/${encodeURIComponent(report.id)}/`;
}

export function renderReportsPage(reports) {
  const rows = reports.length
    ? reports
        .map(
          report => `
        <li class="report">
          <div>
            <strong>${escapeHtml(report.name)}</strong>
            <span>${escapeHtml(report.source)}</span>
            <time datetime="${escapeHtml(report.modifiedAt)}">${escapeHtml(report.modifiedAt)}</time>
          </div>
          <a href="${reportLink(report)}">Open original report</a>
        </li>`,
        )
        .join('')
    : '<li class="empty">No Playwright HTML reports are available.</li>';
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Historical Playwright reports</title>
    <style>
      :root { color-scheme: light; font-family: system-ui, sans-serif; }
      body { margin: 0; background: #f4f6f8; color: #18212b; }
      main { max-width: 960px; margin: 0 auto; padding: 48px 24px; }
      header { display: flex; align-items: start; justify-content: space-between; gap: 24px; flex-wrap: wrap; }
      h1 { margin: 0; font-size: 28px; line-height: 1.2; }
      p, time, .report span { color: #52606d; }
      .reports { list-style: none; padding: 0; margin: 32px 0 0; display: grid; gap: 10px; }
      .report { display: flex; align-items: center; justify-content: space-between; gap: 20px; padding: 16px; border: 1px solid #d7dee5; border-radius: 8px; background: #fff; }
      .report div { display: grid; gap: 5px; min-width: 0; }
      .report span, .report time { font-size: 13px; overflow-wrap: anywhere; }
      .empty { padding: 18px; border: 1px dashed #d7dee5; border-radius: 8px; background: #fff; color: #52606d; }
      a { color: #175cd3; font-weight: 600; }
      @media (max-width: 620px) { .report { align-items: start; flex-direction: column; } }
    </style>
  </head>
  <body>
    <main id="reports">
      <header>
        <div>
          <h1>Historical Playwright reports</h1>
          <p>The original Playwright HTML report is served unchanged for each entry.</p>
        </div>
        <a href="/">Back to harness</a>
      </header>
      <ul class="reports">${rows}</ul>
    </main>
  </body>
</html>
`;
}

export function renderHarnessPage(status, reports = []) {
  const rows = status.checks
    .map(
      check => `
        <li class="check ${check.ok ? 'pass' : 'fail'}">
          <span class="indicator" aria-hidden="true">${check.ok ? 'OK' : 'FAIL'}</span>
          <span class="check-copy">
            <strong>${escapeHtml(check.label)}</strong>
            <span>${escapeHtml(statusText(check))}</span>
          </span>
          <a href="${escapeHtml(check.publicUrl)}" target="_blank" rel="noreferrer">Open</a>
        </li>`,
    )
    .join('');
  const overallLabel = status.status === 'pass' ? 'READY' : 'BLOCKED';
  const overallClass = status.status === 'pass' ? 'pass' : 'fail';
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>AIBIZ local verification harness</title>
    <style>
      :root { color-scheme: light; font-family: system-ui, sans-serif; }
      body { margin: 0; background: #f4f6f8; color: #18212b; }
      main { max-width: 860px; margin: 0 auto; padding: 48px 24px; }
      header { display: flex; align-items: start; justify-content: space-between; gap: 24px; flex-wrap: wrap; }
      h1 { margin: 0; font-size: 28px; line-height: 1.2; }
      p { color: #52606d; }
      .summary { max-width: 100%; padding: 14px 16px; border: 1px solid #d7dee5; border-radius: 8px; background: #fff; text-align: center; overflow-wrap: anywhere; box-sizing: border-box; }
      .summary strong { display: block; font-size: 20px; }
      .summary.pass strong { color: #147d4d; }
      .summary.fail strong { color: #b42318; }
      .checks { list-style: none; padding: 0; margin: 32px 0 0; display: grid; gap: 10px; }
      .check { display: flex; align-items: center; gap: 14px; padding: 16px; border: 1px solid #d7dee5; border-radius: 8px; background: #fff; }
      .indicator { min-width: 44px; font-size: 12px; font-weight: 700; }
      .pass .indicator { color: #147d4d; }
      .fail .indicator { color: #b42318; }
      .check-copy { display: grid; gap: 4px; flex: 1; min-width: 0; }
      .check-copy span { color: #52606d; font-size: 14px; overflow-wrap: anywhere; }
      a { color: #175cd3; font-weight: 600; }
      footer { margin-top: 28px; color: #66737f; font-size: 13px; }
    </style>
  </head>
  <body>
    <main id="app" data-status="${escapeHtml(status.status)}">
      <header>
        <div>
          <h1>AIBIZ local verification harness</h1>
          <p>Service readiness for the local PLM and Modeling workflow.</p>
        </div>
        <div class="summary ${overallClass}" aria-label="overall status">
          <strong>${overallLabel}</strong>
          <span>${escapeHtml(status.checkedAt)}</span>
        </div>
      </header>
      <ul class="checks">${rows}</ul>
      <p><a href="/reports/">Browse historical Playwright reports</a></p>
      <footer>Checks are performed server-side from the project network.</footer>
    </main>
  </body>
</html>
`;
}

function send(response, statusCode, contentType, body) {
  response.statusCode = statusCode;
  response.setHeader('content-type', contentType);
  response.setHeader('cache-control', 'no-store');
  response.end(body);
}

function contentType(filePath) {
  const types = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ttf': 'font/ttf',
    '.webmanifest': 'application/manifest+json; charset=utf-8',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
    '.zip': 'application/zip',
  };
  return types[extname(filePath).toLowerCase()] || 'application/octet-stream';
}

function decodeReportPath(pathname) {
  const prefix = '/reports/';
  if (!pathname.startsWith(prefix)) return null;
  const value = pathname.slice(prefix.length);
  const separator = value.indexOf('/');
  const encodedId = separator === -1 ? value : value.slice(0, separator);
  if (!encodedId) return null;
  let id;
  try {
    id = decodeURIComponent(encodedId);
  } catch {
    return null;
  }
  const suffix = separator === -1 ? '' : value.slice(separator + 1);
  return { id, suffix };
}

function openRequestedReport(directories, config, id) {
  if (!/^[A-Za-z0-9_-]+$/.test(id)) return null;
  const root = Buffer.from(id, 'base64url').toString('utf8');
  if (root.includes('\0') || reportId(root) !== id || resolve(root) !== root) return null;
  const roots = config.reportRoots?.length ? config.reportRoots : DEFAULT_REPORT_ROOTS;
  for (const configuredRoot of roots) {
    const allowedRoot = resolve(configuredRoot);
    const suffix = relative(allowedRoot, root);
    if (suffix === '..' || suffix.startsWith(`..${sep}`) || suffix.startsWith(sep)) continue;
    const components = suffix ? suffix.split(sep) : [];
    if (components.length > 7) continue;
    try {
      let directory = directories.open(allowedRoot);
      let hidden = false;
      for (const component of components) {
        if (inspectReport(directories, directory)) {
          hidden = true;
          break;
        }
        directory = directories.open(resolve(directory.path, component));
      }
      if (!hidden) {
        const report = inspectReport(directories, directory);
        if (report) return report;
      }
    } catch {
      continue;
    }
  }
  return null;
}

async function serveReport(response, pathname, config) {
  const request = decodeReportPath(pathname);
  if (!request) {
    send(response, 404, 'text/plain; charset=utf-8', 'not found');
    return;
  }
  let segments;
  try {
    segments = request.suffix
      ? request.suffix
          .split('/')
          .filter(Boolean)
          .map(segment => decodeURIComponent(segment))
      : ['index.html'];
  } catch {
    send(response, 404, 'text/plain; charset=utf-8', 'not found');
    return;
  }
  if (
    !segments.length ||
    segments.some(segment => !segment || segment === '.' || segment === '..' ||
      segment.includes('\0') || segment.includes('/') || segment.includes('\\'))
  ) {
    send(response, 404, 'text/plain; charset=utf-8', 'not found');
    return;
  }
  const directories = new PinnedDirectories();
  try {
    const report = openRequestedReport(directories, config, request.id);
    if (!report) {
      send(response, 404, 'text/plain; charset=utf-8', 'not found');
      return;
    }
    const target = resolve(report.root, ...segments);
    let filePath = target;
    let parent = directories.open(dirname(target));
    const targetStat = optionalStat(directories.entry(parent, basename(target)));
    if (targetStat?.isDirectory() && !targetStat.isSymbolicLink()) {
      parent = directories.open(target);
      filePath = resolve(target, 'index.html');
    }
    const { data: body } = readPinnedFile(directories, parent, basename(filePath));
    response.statusCode = 200;
    response.setHeader('content-type', contentType(filePath));
    response.setHeader('cache-control', 'no-store');
    response.setHeader('content-length', body.byteLength);
    response.end(body);
  } catch {
    send(response, 404, 'text/plain; charset=utf-8', 'not found');
  } finally {
    directories.close();
  }
}

export function createHarnessServer(config, fetchImpl = fetch) {
  return createServer(async (request, response) => {
    const pathname = new URL(request.url || '/', 'http://localhost').pathname;
    if (request.method !== 'GET') {
      send(response, 405, 'text/plain; charset=utf-8', 'method not allowed');
      return;
    }
    if (pathname === '/favicon.ico') {
      response.statusCode = 204;
      response.end();
      return;
    }
    if (pathname === '/reports') {
      response.statusCode = 301;
      response.setHeader('location', '/reports/');
      response.end();
      return;
    }
    if (
      !['/', '/api/status', '/api/reports', '/healthz', '/reports/'].includes(pathname) &&
      !pathname.startsWith('/reports/')
    ) {
      send(response, 404, 'text/plain; charset=utf-8', 'not found');
      return;
    }

    if (pathname === '/' || pathname === '/api/status' || pathname === '/healthz') {
      const status = await collectHarnessStatus(config, fetchImpl);
      if (pathname === '/') {
        send(
          response,
          status.status === 'pass' ? 200 : 503,
          'text/html; charset=utf-8',
          renderHarnessPage(status),
        );
        return;
      }
      const isStatus = pathname === '/api/status';
      send(
        response,
        status.status === 'pass' ? 200 : 503,
        isStatus ? 'application/json; charset=utf-8' : 'text/plain; charset=utf-8',
        isStatus ? `${JSON.stringify(status)}\n` : `${status.status}\n`,
      );
      return;
    }

    if (pathname.startsWith('/reports/') && pathname !== '/reports/') {
      await serveReport(response, pathname, config);
      return;
    }
    const reports = await discoverHarnessReports(config);
    if (pathname === '/reports/') {
      send(
        response,
        200,
        'text/html; charset=utf-8',
        renderReportsPage(reports),
      );
      return;
    }
    if (pathname === '/api/reports') {
      send(
        response,
        200,
        'application/json; charset=utf-8',
        `${JSON.stringify({ reports })}\n`,
      );
      return;
    }
  });
}

export async function startHarnessServer(config = parseHarnessConfig()) {
  const server = createHarnessServer(config);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.port, config.host, resolve);
  });
  return server;
}

function printHelp() {
  console.log(`Usage: node scripts/harness-ui-server.mjs

Environment:
  AIBIZ_HARNESS_HOST       bind host (default: 0.0.0.0)
  AIBIZ_HARNESS_PORT       listen port (default: ${DEFAULT_PORT})
  AIBIZ_HARNESS_TIMEOUT_MS probe timeout (default: ${DEFAULT_TIMEOUT_MS})
  AIBIZ_HARNESS_PLM_URL    internal PLM URL
  AIBIZ_HARNESS_MODELING_URL internal Modeling URL
  AIBIZ_HARNESS_MODELING_DOC_URL internal Modeling documentation URL
  AIBIZ_HARNESS_MODELING_PLUGINS_URL internal plugin health URL
  AIBIZ_HARNESS_REPORT_ROOTS comma-separated report roots inside the container
`);
}

async function main() {
  if (process.argv.includes('--help') || process.argv.includes('-h')) {
    printHelp();
    return;
  }
  const config = parseHarnessConfig();
  const server = await startHarnessServer(config);
  console.log(
    `[harness-ui] listening on http://${config.host}:${config.port}/`,
  );
  const close = () =>
    new Promise(resolve => server.close(() => resolve()));
  process.once('SIGINT', () => close().finally(() => process.exit(0)));
  process.once('SIGTERM', () => close().finally(() => process.exit(0)));
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch(error => {
    console.error(`[harness-ui] FAIL ${error?.stack || error}`);
    process.exitCode = 1;
  });
}
