#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { launchChromium } from './browser-launch.mjs';

const scriptRoot = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(scriptRoot, '..');
const playwrightRequire = createRequire(
  join(workspaceRoot, 'plm-e2e/package.json'),
);
const defaultUrl = 'http://127.0.0.1:19323/#?';

function integer(value, fallback, label) {
  if (value === undefined || value === '') return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function boolean(value, fallback) {
  if (value === undefined || value === '') return fallback;
  if (['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase()))
    return true;
  if (['0', 'false', 'no', 'off'].includes(String(value).toLowerCase()))
    return false;
  throw new Error(`invalid boolean value: ${value}`);
}

function patterns(value, fallback = []) {
  if (value === undefined || value === '') return [...fallback];
  return String(value)
    .split(',')
    .map(item => item.trim())
    .filter(Boolean);
}

function validateUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`AIBIZ_EXTERNAL_UI_URL is not a valid URL: ${value}`);
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error(
      'AIBIZ_EXTERNAL_UI_URL must use HTTP(S) without embedded credentials',
    );
  }
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) {
    throw new Error(
      'AIBIZ_EXTERNAL_UI_URL must target the local loopback host',
    );
  }
  return url.href;
}

export function parseExternalUiConfig(
  argv = [],
  env = process.env,
  now = new Date(),
) {
  const values = {
    url: env.AIBIZ_EXTERNAL_UI_URL || defaultUrl,
    mode:
      env.AIBIZ_EXTERNAL_UI_MODE ||
      (boolean(env.AIBIZ_EXTERNAL_UI_REQUIRED, false) ? 'required' : 'auto'),
    reportDir:
      env.AIBIZ_EXTERNAL_UI_REPORT_DIR ||
      join(
        workspaceRoot,
        '.artifacts/external-ui',
        `${now.toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}`,
      ),
    timeoutMs: integer(env.AIBIZ_EXTERNAL_UI_TIMEOUT_MS, 30000, 'timeout'),
    waitMs: integer(env.AIBIZ_EXTERNAL_UI_WAIT_MS, 750, 'wait'),
    selector: env.AIBIZ_EXTERNAL_UI_SELECTOR || 'body',
    expectedText: env.AIBIZ_EXTERNAL_UI_EXPECT_TEXT || '',
    browserModule: env.PLAYWRIGHT_MODULE || '@playwright/test',
    failOnHttpErrors: boolean(env.AIBIZ_EXTERNAL_UI_FAIL_ON_HTTP_ERRORS, true),
    viewport: {
      width: integer(env.AIBIZ_EXTERNAL_UI_VIEWPORT_WIDTH, 1440, 'viewport width'),
      height: integer(env.AIBIZ_EXTERNAL_UI_VIEWPORT_HEIGHT, 1000, 'viewport height'),
    },
    allowedStatuses: patterns(env.AIBIZ_EXTERNAL_UI_ALLOWED_STATUS).map(Number),
    allowedConsoleErrors: patterns(env.AIBIZ_EXTERNAL_UI_ALLOWED_CONSOLE_ERRORS),
    ignoredHttpUrls: patterns(env.AIBIZ_EXTERNAL_UI_IGNORED_HTTP_URLS, [
      'favicon.ico',
    ]),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const next = () => {
      const value = argv[++index];
      if (!value) throw new Error(`${argument} requires a value`);
      return value;
    };
    if (argument === '--url') values.url = next();
    else if (argument === '--mode') values.mode = next();
    else if (argument === '--required') values.mode = 'required';
    else if (argument === '--off') values.mode = 'off';
    else if (argument === '--report-dir') values.reportDir = next();
    else if (argument === '--timeout-ms')
      values.timeoutMs = integer(next(), values.timeoutMs, 'timeout');
    else if (argument === '--wait-ms')
      values.waitMs = integer(next(), values.waitMs, 'wait');
    else if (argument === '--selector') values.selector = next();
    else if (argument === '--expect-text') values.expectedText = next();
    else if (argument === '--help' || argument === '-h') {
      return { help: true };
    } else {
      throw new Error(`unknown option: ${argument}`);
    }
  }

  values.url = validateUrl(values.url);
  if (!['auto', 'required', 'off'].includes(values.mode)) {
    throw new Error(`mode must be auto, required, or off: ${values.mode}`);
  }
  if (!values.selector.trim()) throw new Error('selector must not be empty');
  if (
    values.allowedStatuses.some(
      status => !Number.isInteger(status) || status < 100 || status > 599,
    )
  ) {
    throw new Error('AIBIZ_EXTERNAL_UI_ALLOWED_STATUS must contain HTTP codes');
  }
  values.reportDir = resolve(values.reportDir);
  return values;
}

export function matchesPattern(value, matchers) {
  return matchers.some(matcher => String(value).includes(matcher));
}

export function isAcceptedMainStatus(status, allowedStatuses = []) {
  if (!Number.isInteger(status)) return false;
  if (allowedStatuses.length > 0) return allowedStatuses.includes(status);
  return status >= 200 && status < 400;
}

export function isUnavailableError(error) {
  const code = error?.cause?.code || error?.code || '';
  return (
    ['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EHOSTUNREACH'].includes(
      code,
    ) ||
    /fetch failed|failed to fetch|network timeout|timed out|connection refused/i.test(
      error?.message || String(error),
    )
  );
}

async function probe(url, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: 'manual',
    });
    await response.body?.cancel();
    return { status: response.status };
  } finally {
    clearTimeout(timer);
  }
}

function errorText(error) {
  return error?.stack || error?.message || String(error);
}

async function writeReport(report, reportDir) {
  await mkdir(reportDir, { recursive: true });
  const reportFile = join(reportDir, 'report.json');
  report.reportFile = reportFile;
  await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`);
  return reportFile;
}

function loadPlaywright(moduleName) {
  try {
    return playwrightRequire(moduleName);
  } catch (error) {
    const fallback =
      moduleName === 'playwright' ? '@playwright/test' : 'playwright';
    try {
      return playwrightRequire(fallback);
    } catch {
      throw error;
    }
  }
}

export async function runExternalUiHarness(config) {
  const startedAt = new Date().toISOString();
  const report = {
    schemaVersion: 1,
    startedAt,
    finishedAt: null,
    url: config.url,
    mode: config.mode,
    status: 'running',
    probe: null,
    title: '',
    finalUrl: '',
    checks: [],
    consoleErrors: [],
    pageErrors: [],
    failedRequests: [],
    httpErrors: [],
    screenshot: null,
    reportFile: null,
  };
  const failures = [];
  const check = (name, passed, detail = '') => {
    const item = { name, status: passed ? 'pass' : 'fail' };
    if (detail) item.detail = detail;
    report.checks.push(item);
    if (!passed) failures.push(`${name}${detail ? `: ${detail}` : ''}`);
  };
  const skip = (name, detail = '') => {
    const item = { name, status: 'skip' };
    if (detail) item.detail = detail;
    report.checks.push(item);
  };
  const finish = async status => {
    report.status = status;
    report.finishedAt = new Date().toISOString();
    if (failures.length > 0) report.failureSummary = failures;
    report.reportFile = await writeReport(report, config.reportDir);
    return report;
  };

  if (config.mode === 'off') {
    report.probe = { status: 'disabled' };
    report.checks.push({
      name: 'external-ui-enabled',
      status: 'skip',
      detail: 'disabled by configuration',
    });
    return finish('skip');
  }

  try {
    report.probe = await probe(config.url, config.timeoutMs);
  } catch (error) {
    report.probe = { error: errorText(error) };
    if (config.mode === 'auto' && isUnavailableError(error)) {
      skip('external-ui-reachable', 'service is not running');
      return finish('skip');
    }
    check('external-ui-reachable', false, errorText(error));
    return finish('fail');
  }

  let browser;
  let context;
  let page;
  try {
    const { chromium } = loadPlaywright(config.browserModule);
    browser = await launchChromium(chromium, { timeout: config.timeoutMs });
    context = await browser.newContext({
      locale: 'zh-CN',
      timezoneId: 'Asia/Shanghai',
      viewport: config.viewport,
    });
    context.setDefaultTimeout(config.timeoutMs);
    context.setDefaultNavigationTimeout(config.timeoutMs);
    page = await context.newPage();

    page.on('console', message => {
      if (message.type() !== 'error') return;
      report.consoleErrors.push({
        text: message.text(),
        location: message.location(),
      });
    });
    page.on('pageerror', error => {
      report.pageErrors.push({ message: error.message, stack: error.stack });
    });
    page.on('requestfailed', request => {
      report.failedRequests.push({
        url: request.url(),
        method: request.method(),
        error: request.failure()?.errorText || 'unknown',
      });
    });
    page.on('response', response => {
      if (response.status() < 400) return;
      if (matchesPattern(response.url(), config.ignoredHttpUrls)) return;
      report.httpErrors.push({
        url: response.url(),
        status: response.status(),
        statusText: response.statusText(),
      });
    });

    let mainResponse;
    try {
      mainResponse = await page.goto(config.url, {
        waitUntil: 'domcontentloaded',
        timeout: config.timeoutMs,
      });
      await delay(config.waitMs);
    } catch (error) {
      check('page-load', false, errorText(error));
    }

    if (mainResponse) {
      check(
        'main-response',
        isAcceptedMainStatus(mainResponse.status(), config.allowedStatuses),
        `HTTP ${mainResponse.status()}`,
      );
    }

    report.finalUrl = page.url();
    report.title = await page.title().catch(() => '');
    check('document-body', (await page.locator('body').count()) > 0);

    const target = page.locator(config.selector).first();
    const targetCount = await target.count();
    check(
      'expected-selector',
      targetCount > 0,
      `${config.selector} matched ${targetCount} elements`,
    );
    if (targetCount > 0) {
      check(
        'expected-selector-visible',
        await target.isVisible().catch(() => false),
        config.selector,
      );
    }

    if (config.expectedText) {
      const bodyText = await page.locator('body').innerText().catch(() => '');
      check(
        'expected-text',
        bodyText.includes(config.expectedText),
        JSON.stringify(config.expectedText),
      );
    }

    const unexpectedConsoleErrors = report.consoleErrors.filter(
      item => !matchesPattern(item.text, config.allowedConsoleErrors),
    );
    const unexpectedPageErrors = report.pageErrors.filter(
      item => !matchesPattern(item.message, config.allowedConsoleErrors),
    );
    check(
      'console-errors',
      unexpectedConsoleErrors.length === 0,
      `${unexpectedConsoleErrors.length} unexpected console errors`,
    );
    check(
      'page-errors',
      unexpectedPageErrors.length === 0,
      `${unexpectedPageErrors.length} unexpected page errors`,
    );
    check(
      'failed-requests',
      report.failedRequests.length === 0,
      `${report.failedRequests.length} failed requests`,
    );
    if (config.failOnHttpErrors) {
      check(
        'http-errors',
        report.httpErrors.length === 0,
        `${report.httpErrors.length} HTTP errors`,
      );
    }

    const screenshotPath = join(config.reportDir, 'page.png');
    try {
      await mkdir(config.reportDir, { recursive: true });
      await page.screenshot({ path: screenshotPath, fullPage: true });
      report.screenshot = screenshotPath;
      check('screenshot', true);
    } catch (error) {
      check('screenshot', false, errorText(error));
    }
  } catch (error) {
    check('browser-run', false, errorText(error));
  } finally {
    await context?.close().catch(() => {});
    await browser?.close().catch(() => {});
  }

  return finish(failures.length > 0 ? 'fail' : 'pass');
}

function printHelp() {
  console.log(`Usage: node scripts/external-ui-harness.mjs [options]

Options:
  --url URL             Target page (default: ${defaultUrl})
  --mode MODE           auto, required, or off (default: auto)
  --required            Alias for --mode required
  --off                 Alias for --mode off
  --report-dir DIR      Artifact directory
  --timeout-ms N        Probe and browser timeout
  --wait-ms N           Wait after DOMContentLoaded
  --selector CSS        Required visible selector (default: body)
  --expect-text TEXT    Required text in document body
`);
}

async function main() {
  const config = parseExternalUiConfig(process.argv.slice(2));
  if (config.help) {
    printHelp();
    return;
  }
  const report = await runExternalUiHarness(config);
  const label = report.status.toUpperCase();
  const detail =
    report.status === 'skip'
      ? report.probe?.error || 'service unavailable'
      : report.failureSummary?.join('; ') || report.title || 'ok';
  console.log(`[external-ui] ${label} ${config.url} ${detail}`);
  console.log(`[external-ui] report ${report.reportFile}`);
  if (report.status === 'fail') process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch(error => {
    console.error(`[external-ui] FAIL ${errorText(error)}`);
    process.exitCode = 1;
  });
}
