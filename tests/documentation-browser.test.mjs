import assert from 'node:assert/strict';
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { attachBrowserSourceDiagnostics } from '../browser-source-diagnostics.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(join(root, 'ibiz-app-hub/package.json'));
const ts = require('typescript');
const { chromium } = require('playwright');
const source = await readFile(
  join(root, 'modelingweb/app/vite-plugins/local-documentation.ts'),
  'utf8',
);
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
  },
}).outputText;
const { documentationMiddleware } = await import(
  `data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`
);

test(
  'clean browser renders local Docsify and records a synthetic reporter error without hiding it',
  { timeout: 30000 },
  async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'documentation-browser-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    await mkdir(join(directory, 'script'));
    await copyFile(
      join(root, 'plm/doc/docsify/script/docsify.js'),
      join(directory, 'script/docsify.js'),
    );
    await writeFile(
      join(directory, 'index.html'),
      `<!doctype html>
    <meta charset="utf-8"><title>Local documentation fixture</title>
    <div id="app"></div><script>window.$docsify={name:'Local documentation',emoji:false};</script>
    <script src="script/docsify.js"></script>`,
    );
    await writeFile(
      join(directory, 'README.md'),
      '# Documentation fixture\n\nLocal markdown content.',
    );
    const middleware = documentationMiddleware(directory, [
      '/modeldesign/doc/',
    ]);
    const server = createServer((req, res) => {
      void middleware(req, res, () => {
        res.statusCode = 404;
        res.end();
      });
    });
    t.after(
      () =>
        new Promise((resolve) => {
          server.closeAllConnections();
          server.close(resolve);
        }),
    );
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROME_PATH || undefined,
    });
    t.after(() => browser.close());
    const page = await browser.newPage();
    const url = `http://127.0.0.1:${server.address().port}/modeldesign/doc/`;
    const requests = [];
    const errors = [];
    page.on('request', (req) => requests.push(req.url()));
    page.on('pageerror', (error) => errors.push(error));
    await page.route('**/*', (route) => {
      if (route.request().url().startsWith(new URL(url).origin))
        return route.continue();
      return route.abort('connectionfailed');
    });
    const diagnostics = await attachBrowserSourceDiagnostics(page);
    await page.goto(url, { waitUntil: 'networkidle' });
    await page
      .getByRole('heading', { name: 'Documentation fixture', exact: true })
      .waitFor();
    assert.equal(errors.length, 0);
    assert.equal(diagnostics.report.status, 'not_observed');
    assert.ok(requests.every((request) => !request.includes('livereload')));

    const failure = page.waitForEvent('pageerror');
    await page.evaluate(() => {
      setTimeout(() => {
        class et {
          reportAllChanges() {
            const entry = undefined;
            return entry.startTime;
          }
        }
        new et().reportAllChanges();
      }, 0);
    });
    assert.match((await failure).message, /startTime/);
    await page
      .addScriptTag({
        url: 'https://plm.ibizlab.cn:45571/livereload.js?snipver=1',
      })
      .catch(() => {});
    await page.waitForTimeout(300);
    await diagnostics.close();
    const reporter = diagnostics.report.records.find(
      (record) => record.type === 'start-time-reporter-error',
    );
    const reload = diagnostics.report.records.find(
      (record) => record.type === 'livereload-request',
    );
    assert.ok(reporter);
    assert.ok(
      reporter.sources.some(
        (item) =>
          item.markers.includes('reportAllChanges') &&
          item.markers.includes('startTime'),
      ),
    );
    assert.ok(
      reporter.sources.every(
        (item) => item.attribution !== 'browser-extension',
      ),
    );
    assert.ok(reload);
    assert.ok(reload.failure);
    assert.equal(errors.length, 1);
    assert.ok(
      !diagnostics.report.records.some(
        (record) => record.type === 'diagnostic-error',
      ),
    );
    t.diagnostic(
      'Actual local Docsify runtime rendered; synthetic VM error remained visible and was not misclassified as an extension.',
    );
  },
);
