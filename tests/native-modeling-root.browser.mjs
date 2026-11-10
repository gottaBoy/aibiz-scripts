import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { mountedTreeSnapshot } from '../native-model-design-owned-backend-input.mjs';

const workspace = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(new URL('../../ibiz-app-hub/package.json', import.meta.url));
const { chromium } = require('playwright');
const dist = join(workspace, 'modelingweb/app/dist');
const output = resolve(process.env.NATIVE_ROOT_REPORT_DIR ??
  join(workspace, '.artifacts/native-root-browser', new Date().toISOString().replaceAll(':', '-')));
assert.ok(!fs.existsSync(output), 'Browser receipts cannot be overwritten');
fs.mkdirSync(output, { recursive: true, mode: 0o700 });
const hash = value => createHash('sha256').update(value).digest('hex');
const originalIndex = fs.readFileSync(join(dist, 'index.html'));
const entryName = /data-src="\.\/assets\/([^"?]+)\?/.exec(originalIndex.toString())?.[1];
assert.ok(entryName, 'A production SystemJS entry is required');
const rootA = 'nf_5d3585516a77_root_a';
const rootB = 'nf_5d3585516a77_root_b';
const defaultRoot = '28F7326A-7C72-4C2D-A497-A16372ABBADC';
const report = {
  contract: 'native-modeling-root-browser-v1', startedAt: new Date().toISOString(),
  status: 'running', nativeAcceptance: false, permissionAcceptance: false,
  boundary: 'Built entry and actual startup environment serialization only; all API requests aborted',
  entry: { path: `modelingweb/app/dist/assets/${entryName}`,
    sha256: hash(fs.readFileSync(join(dist, 'assets', entryName))) },
  checks: [], backendRequestsSent: 0,
};
const inventoryBefore = mountedTreeSnapshot(dist);
report.distBefore = inventoryBefore;
let browser;

function renderedEnvironment(root) {
  const directory = fs.mkdtempSync(join(tmpdir(), 'native-root-env-'));
  try {
    const fixtureDist = join(directory, 'dist');
    fs.mkdirSync(join(fixtureDist, 'environments'), { recursive: true });
    const environment = join(fixtureDist, 'environments/environment.js');
    fs.copyFileSync(join(dist, 'environments/environment.js'), environment);
    const bin = join(directory, 'bin');
    fs.mkdirSync(bin);
    fs.writeFileSync(join(bin, 'nginx'), '#!/bin/sh\nexit 0\n', { mode: 0o700 });
    const startup = fs.readFileSync(join(workspace, 'modelingweb/start.sh'), 'utf8')
      .replaceAll('/opt/aibiz/nginx-native.conf', join(workspace, 'modelingweb/nginx-native.conf'))
      .replaceAll('/etc/nginx/conf.d/nginx.conf', join(directory, 'nginx.conf'))
      .replaceAll('/environment.config', join(workspace, 'modelingweb/environment.config'))
      .replaceAll('/dist', fixtureDist);
    const script = join(directory, 'start.sh');
    fs.writeFileSync(script, startup, { mode: 0o600 });
    const result = spawnSync('sh', [script], {
      encoding: 'utf8', timeout: 10_000,
      env: {
        PATH: `${bin}:/usr/bin:/bin`, NATIVE_MODEL_APP: 'ModelDesign', NATIVEMODELAPP: 'ModelDesign',
        APPCODE: 'modeldesign', APICODE: 'ibizmodeling__modeldesign',
        BASEURL: 'ibizmodeling__modeldesign', HUB: 'true', ISLOCALMODEL: 'true',
        ISSAASMODE: 'false', ENABLEMQTT: 'false', PLUGINBASEURL: './plugins',
        ...(root === undefined ? {} : { NATIVE_MODELING_SYSTEM_ID: root }),
      },
    });
    assert.equal(result.status, 0, 'Actual startup serializer must succeed');
    const bytes = fs.readFileSync(environment);
    const context = { window: {} };
    runInNewContext(bytes.toString(), context, { timeout: 1000 });
    assert.equal(context.window.Environment.nativeModelingSystemId, root);
    return bytes;
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
}

try {
  browser = await chromium.launch({
    executablePath: process.env.CHROME_BIN || '/usr/bin/google-chrome',
    headless: true, args: ['--no-sandbox'],
  });
  const cases = [
    { name: 'owned-a-desktop-zh', root: rootA, expected: rootA, locale: 'zh-CN', width: 1440, height: 900 },
    { name: 'owned-b-mobile-en', root: rootB, expected: rootB, locale: 'en-US', width: 390, height: 844 },
    { name: 'default-compatibility', expected: defaultRoot, locale: 'en-US', width: 1440, height: 900 },
    { name: 'deep-link-preserved', root: rootA, expected: rootB, locale: 'zh-CN',
      hash: `/psdevslnsys=${rootB}/modelingindex/-`, width: 390, height: 844 },
    { name: 'invalid-config-rejected', root: '../foreign', invalid: true,
      locale: 'en-US', width: 1440, height: 900 },
  ];
  for (const scenario of cases) {
    const environment = renderedEnvironment(scenario.root);
    const check = { name: scenario.name, status: 'failed', locale: scenario.locale,
      viewport: { width: scenario.width, height: scenario.height },
      environmentSha256: hash(environment), apiRequestsAborted: 0, externalRequests: 0, pageErrors: [] };
    report.checks.push(check);
    const types = { '.js': 'application/javascript', '.css': 'text/css', '.json': 'application/json',
      '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };
    const server = createServer((request, response) => {
      const path = new URL(request.url, 'http://localhost').pathname;
      if (path.startsWith('/api/')) {
        report.backendRequestsSent++;
        response.writeHead(500).end();
        return;
      }
      const relative = decodeURIComponent(path).replace(/^\/modeldesign\//, '');
      if (!path.startsWith('/modeldesign/') ||
          relative.split('/').some(part => part === '..' || part.includes('\\') || part.includes('\0'))) {
        response.writeHead(404).end();
        return;
      }
      const file = join(dist, relative || 'index.html');
      if (!fs.existsSync(file) || !fs.statSync(file).isFile()) {
        response.writeHead(404).end();
        return;
      }
      const bytes = file === join(dist, 'environments/environment.js') ? environment : fs.readFileSync(file);
      const suffix = /\.[a-z0-9]+$/.exec(basename(file))?.[0];
      response.writeHead(200, { 'content-type': types[suffix] ?? 'application/octet-stream',
        'cache-control': 'no-store' }).end(bytes);
    });
    let context;
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(0, '127.0.0.1', resolve);
      });
      const origin = `http://127.0.0.1:${server.address().port}`;
      context = await browser.newContext({ locale: scenario.locale, viewport: check.viewport });
      await context.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.origin !== origin) {
          check.externalRequests++;
          return route.abort('blockedbyclient');
        }
        if (url.pathname.startsWith('/api/')) {
          check.apiRequestsAborted++;
          return route.abort('blockedbyclient');
        }
        return route.continue();
      });
      const page = await context.newPage();
      page.on('pageerror', error => check.pageErrors.push(error.message));
      const navigations = [];
      page.on('framenavigated', frame => {
        if (frame === page.mainFrame()) navigations.push(frame.url());
      });
      await page.goto(`${origin}/modeldesign/${scenario.hash ? `#${scenario.hash}` : ''}`,
        { waitUntil: 'domcontentloaded' });
      if (scenario.invalid) {
        await page.waitForFunction(() => document.readyState === 'complete');
        for (let i = 0; i < 100 && !check.pageErrors.some(x => x.includes('Invalid native modeling system ID')); i++) {
          await new Promise(resolve => setTimeout(resolve, 50));
        }
        assert.ok(check.pageErrors.some(x => x.includes('Invalid native modeling system ID')));
        assert.ok(!navigations.some(url => url.includes('/psdevslnsys=')),
          'Invalid configured root must never fall back to the shared default');
      } else {
        const expected = `#/psdevslnsys=${scenario.expected}/modelingindex/-`;
        await page.waitForURL(url => url.hash.startsWith(expected), { timeout: 15_000 });
        check.selectedRoot = scenario.expected;
        assert.ok(navigations.some(url => new URL(url).hash.startsWith(expected)));
      }
      assert.equal(check.externalRequests, 0);
      check.finalUrl = page.url().replace(origin, 'http://loopback');
      check.screenshot = `${scenario.name}.png`;
      await page.screenshot({ path: join(output, check.screenshot) });
      check.status = 'passed';
    } finally {
      await context?.close();
      await new Promise(resolve => server.close(resolve));
      server.closeAllConnections();
    }
  }
  report.distAfter = mountedTreeSnapshot(dist);
  assert.deepEqual(report.distAfter, inventoryBefore, 'Built frontend changed during browser verification');
  assert.equal(report.backendRequestsSent, 0);
  report.status = 'passed-startup-root-only';
} catch (error) {
  report.status = 'failed-startup-root-only';
  report.error = error.message;
  process.exitCode = 1;
} finally {
  await browser?.close();
  report.completedAt = new Date().toISOString();
  fs.writeFileSync(join(output, 'report.json'), `${JSON.stringify(report, null, 2)}\n`,
    { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ path: join(output, 'report.json'), status: report.status,
    checks: report.checks.map(x => ({ name: x.name, status: x.status })) }, null, 2));
}
