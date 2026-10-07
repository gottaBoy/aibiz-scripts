import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import test from 'node:test';
import { launchChromium } from '../browser-launch.mjs';
import { captureNativeLogin } from '../../modelingweb/app/tests/native-model-contract.mjs';

const require = createRequire(new URL('../../ibiz-app-hub/package.json', import.meta.url));
const { chromium } = require('playwright');
const applicationId = 'ibizmodeling__central';
const loginPath = `/api/${applicationId}/v7/login`;
const storageKey = 'fixture-native-login-token';
const marker = 'fixture-private-login-value';
const validToken = `${marker}.valid`;

function fixtureDocument(documentId, { storageToken, runtimeDelay, importMode }) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Local login fixture</title>
<link rel="icon" href="data:,"></head><body>
<form><button type="submit">Log in</button></form>
<script>
window.fixtureDocumentId = ${documentId};
window.fixtureRuntimePending = ${Boolean(documentId > 1 && runtimeDelay)};
if (!window.fixtureRuntimePending) window.ibiz = {};
window.fixtureScheduleRuntimeInitialization = () => {
  setTimeout(() => {
    window.ibiz = {};
    window.fixtureRuntimePending = false;
  }, ${runtimeDelay ?? 0});
};
window.fixtureCoreImports = 0;
window.fixturePrematureCoreImports = 0;
window.fixtureImportPending = false;
window.System = {
  async import(name) {
    if (name !== '@ibiz-template/core') throw new Error('Unexpected fixture import');
    if (!window.ibiz) {
      window.fixturePrematureCoreImports += 1;
      throw new Error('The reloaded fixture runtime is not initialized');
    }
    window.fixtureCoreImports += 1;
    if (${documentId > 1 && importMode === 'pending'}) {
      window.fixtureImportPending = true;
      return new Promise(() => {});
    }
    if (${documentId > 1 && importMode === 'throw-token'}) {
      throw new Error(localStorage.getItem(${JSON.stringify(storageKey)}));
    }
    if (${documentId === 2 && importMode === 'reload-during-import'}) {
      window.fixtureImportPending = true;
      sessionStorage.setItem('fixture-import-reload-fired', 'true');
      setTimeout(() => location.reload(), 25);
      return new Promise(() => {});
    }
    return { getToken: () => localStorage.getItem(${JSON.stringify(storageKey)}) };
  }
};
document.querySelector('form').addEventListener('submit', async event => {
  event.preventDefault();
  try {
    const response = await fetch(${JSON.stringify(loginPath)}, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'local-fixture', password: 'local-fixture' })
    });
    const text = await response.text();
    let payload;
    try { payload = JSON.parse(text); } catch {}
    if (typeof payload?.token === 'string') {
      localStorage.setItem(${JSON.stringify(storageKey)},
        ${storageToken === undefined ? 'payload.token' : JSON.stringify(storageToken)});
      location.reload();
      return;
    }
    document.body.dataset.loginComplete = 'true';
  } catch {
    document.body.dataset.loginFailed = 'true';
  }
});
</script></body></html>`;
}

async function startFixture(t, scenario) {
  const requests = [];
  let documentLoads = 0;
  const server = createServer((request, response) => {
    const path = new URL(request.url, 'http://127.0.0.1').pathname;
    requests.push({ method: request.method, path });
    response.setHeader('Cache-Control', 'no-store');
    if (request.method === 'GET' && path === '/central/') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      response.end(fixtureDocument(++documentLoads, scenario));
    } else if (request.method === 'POST' && path === loginPath) {
      request.resume();
      response.writeHead(scenario.status ?? 200, {
        'Content-Type': scenario.contentType ?? 'application/json; charset=utf-8',
      });
      response.end(scenario.body);
    } else {
      response.writeHead(404);
      response.end();
    }
  });
  t.after(() => new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
    server.closeAllConnections();
  }));
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    entry: `http://127.0.0.1:${server.address().port}/central/`,
    requests,
    documentLoads: () => documentLoads,
  };
}

const scenarios = [
  {
    name: 'captures the login bytes despite immediate storage write and real document reload',
    body: JSON.stringify({ token: validToken }),
    reload: true,
  },
  {
    name: 'waits for delayed ibiz initialization before importing the reloaded core',
    body: JSON.stringify({ token: validToken }),
    reload: true,
    runtimeDelay: 300,
  },
  {
    name: 'rejects an empty token even when the page stores it and reloads',
    body: JSON.stringify({ token: '' }),
    reload: true,
    error: /nonempty valid token/,
  },
  {
    name: 'rejects a whitespace-only token after reload',
    body: JSON.stringify({ token: ' \t ' }),
    reload: true,
    error: /nonempty valid token/,
  },
  {
    name: 'rejects a padded token without disclosing it',
    body: JSON.stringify({ token: ` ${marker} ` }),
    reload: true,
    error: /nonempty valid token/,
  },
  {
    name: 'rejects a CRLF injection token without disclosing it',
    body: JSON.stringify({ token: `${marker}\r\nInjected: header` }),
    reload: true,
    error: /nonempty valid token/,
  },
  {
    name: 'rejects a NUL injection token without disclosing it',
    body: JSON.stringify({ token: `${marker}\u0000suffix` }),
    reload: true,
    error: /nonempty valid token/,
  },
  {
    name: 'rejects a missing token rather than accepting the completed submit',
    body: JSON.stringify({ message: marker }),
    error: /nonempty valid token/,
  },
  {
    name: 'rejects a non-string token',
    body: JSON.stringify({ token: 123, message: marker }),
    error: /nonempty valid token/,
  },
  {
    name: 'rejects HTTP 401 even when its token is persisted and the page reloads',
    status: 401,
    body: JSON.stringify({ token: validToken }),
    reload: true,
    error: /requires HTTP 200, got 401/,
  },
  {
    name: 'rejects an HTML fallback without returning response-body evidence',
    contentType: 'text/html; charset=utf-8',
    body: `<!doctype html><title>${marker}</title>`,
    error: /requires JSON/,
  },
  {
    name: 'rejects valid JSON served as HTML even after token persistence and reload',
    contentType: 'text/html; charset=utf-8',
    body: JSON.stringify({ token: validToken }),
    reload: true,
    error: /requires JSON/,
  },
  {
    name: 'rejects malformed JSON without returning its partial token',
    body: `{"token":"${marker}",`,
    error: /returned invalid JSON/,
  },
  {
    name: 'does not accept a valid response when the reloaded core holds a different token',
    body: JSON.stringify({ token: validToken }),
    storageToken: 'fixture-stale-value',
    reload: true,
    timeout: 1500,
    expectFalse: true,
    expectTimeout: true,
    error: /^Native login token persistence timed out$/,
  },
  {
    name: 'rejects a permanently pending real core import within the host deadline',
    body: JSON.stringify({ token: validToken }),
    reload: true,
    importMode: 'pending',
    timeout: 750,
    expectTimeout: true,
    error: /^Native login token persistence timed out$/,
  },
  {
    name: 'sanitizes a real core import error containing the persisted token',
    body: JSON.stringify({ token: validToken }),
    reload: true,
    importMode: 'throw-token',
    error: /^Native login token verification failed$/,
  },
  {
    name: 'retries an execution context destroyed by another reload during core import',
    body: JSON.stringify({ token: validToken }),
    reload: true,
    importMode: 'reload-during-import',
    documentLoads: 3,
  },
];

test('native login reload browser regressions with local fixtures only',
  { timeout: 60_000 }, async t => {
    const browser = await launchChromium(chromium);
    t.after(() => browser.close());
    for (const scenario of scenarios) {
      await t.test(scenario.name, { timeout: 10_000 }, async t => {
        const fixture = await startFixture(t, scenario);
        const context = await browser.newContext({ serviceWorkers: 'block' });
        t.after(() => context.close());
        const page = await context.newPage();
        page.setDefaultTimeout(5000);
        const origin = new URL(fixture.entry).origin;
        const nonlocalRequests = [];
        const pageErrors = [];
        page.on('pageerror', error => pageErrors.push(error.message));
        await context.route('**/*', route => {
          if (new URL(route.request().url()).origin === origin) return route.continue();
          nonlocalRequests.push(route.request().url());
          return route.abort('blockedbyclient');
        });
        await page.goto(fixture.entry, { waitUntil: 'load' });
        const originalDocument = await page.evaluate(() => window.fixtureDocumentId);
        let outcome;
        let failure;
        let verificationStarted;
        try {
          outcome = await captureNativeLogin(page, {
            entry: fixture.entry, applicationId, timeout: scenario.timeout ?? 5000,
          }, async () => {
            await page.getByRole('button', { name: 'Log in', exact: true }).click();
            if (scenario.reload) {
              // Verify only after the original document has really been replaced.
              await page.waitForFunction(previous => window.fixtureDocumentId > previous,
                originalDocument);
              await page.waitForLoadState('load');
              if (scenario.runtimeDelay) {
                assert.ok(await page.evaluate(() => {
                  const pending = window.fixtureRuntimePending && !window.ibiz;
                  window.fixtureScheduleRuntimeInitialization();
                  return pending;
                }), 'Token verification must start while the reloaded ibiz is still unavailable');
              }
            } else {
              await page.waitForFunction(() => document.body.dataset.loginComplete === 'true');
            }
            verificationStarted = performance.now();
          });
        } catch (error) {
          failure = error;
        }

        const visibleEvidence = JSON.stringify({
          outcome,
          failure: failure && {
            message: failure.message, stack: failure.stack, evidence: failure.evidence,
            fields: Object.fromEntries(Object.entries(failure)),
          },
        });
        assert.ok(!visibleEvidence.includes(marker), 'Login evidence must not disclose token bytes');
        assert.ok(!visibleEvidence.includes('fixture-stale-value'),
          'Login evidence must not disclose stored token bytes');
        if (scenario.error) {
          assert.ok(failure, 'An invalid login must reject rather than return success evidence');
          assert.match(failure.message, scenario.error);
          assert.equal(outcome, undefined);
          if (scenario.expectTimeout) {
            const elapsed = performance.now() - verificationStarted;
            assert.ok(elapsed >= scenario.timeout - 50,
              'A false or pending result must not be accepted before the verification deadline');
            assert.ok(elapsed < scenario.timeout + 2000,
              'A pending browser evaluation must not bypass the bounded host deadline');
            t.diagnostic(JSON.stringify({
              scope: 'local-http-fixture-only',
              condition: scenario.expectFalse ? 'primitive-false' : 'pending-core-import',
              verification: 'timeout-rejection',
              timeoutMs: scenario.timeout, elapsedMs: Math.round(elapsed),
            }));
          }
          if (scenario.expectFalse) {
            assert.equal(await page.evaluate(async expected => {
              const core = await window.System.import('@ibiz-template/core');
              return core.getToken() === expected;
            }, validToken), false, 'The browser must return the primitive false, not a wrapper object');
            assert.ok(await page.evaluate(() => window.fixtureCoreImports >= 2),
              'The helper must poll the false result rather than accepting its first Promise');
          }
          if (scenario.importMode === 'pending') {
            assert.ok(await page.evaluate(() =>
              window.fixtureImportPending && window.fixtureCoreImports === 1),
            'The real import must still be pending when the host rejects');
          }
          if (scenario.importMode === 'throw-token') {
            assert.equal(failure.cause, undefined, 'The sanitized error must not retain its secret cause');
          }
        } else {
          assert.equal(failure, undefined);
          assert.deepEqual(outcome, {
            origin, path: loginPath, method: 'POST', status: 200,
            contentType: 'application/json; charset=utf-8',
            tokenIssued: true, tokenPersisted: true,
          });
          assert.equal(await page.evaluate(() => Boolean(window.ibiz)), true,
            'The helper must not report token persistence before the reloaded runtime exists');
          assert.ok(await page.evaluate(async expected => {
            const core = await window.System.import('@ibiz-template/core');
            return core.getToken() === expected;
          }, validToken), 'The new document must read the issued token from real localStorage');
          assert.ok(await page.evaluate(() => window.fixtureCoreImports >= 2),
            'Capture must verify the token through the reloaded core module');
        }
        assert.equal(fixture.documentLoads(), scenario.documentLoads ?? (scenario.reload ? 2 : 1));
        if (scenario.importMode === 'reload-during-import') {
          assert.ok(await page.evaluate(() =>
            sessionStorage.getItem('fixture-import-reload-fired') === 'true'),
          'The import itself must trigger the additional document replacement');
        }
        assert.equal(fixture.requests.filter(request => request.method === 'POST' &&
          request.path === loginPath).length, 1, 'The local server must receive one actual login POST');
        assert.equal(await page.evaluate(() => performance.getEntriesByType('navigation')[0].type),
          scenario.reload ? 'reload' : 'navigate');
        assert.deepEqual(nonlocalRequests, [], 'The browser must not contact a real platform');
        assert.deepEqual(pageErrors, []);
        assert.equal(await page.evaluate(() => window.fixturePrematureCoreImports), 0,
          'The core module must not be imported before the reloaded ibiz is initialized');
      });
    }
  });
