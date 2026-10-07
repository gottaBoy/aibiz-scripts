import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  inspectRegressionResult, regressionSteps, runLocalizationRegression,
} from '../harness-localization-regression.mjs';
import { parseExternalUiConfig } from '../external-ui-harness.mjs';

const root = dirname(fileURLToPath(import.meta.url));
const tap = '# tests 2\n# pass 2\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n';
const success = { status: 0, stdout: tap, stderr: '' };
const childStep = { report: 'report.json', acceptedStatus: 'pass', requiredChecks: ['mandatory'] };
const childReport = {
  schemaVersion: 1, mode: 'required', status: 'pass',
  checks: [{ name: 'mandatory', status: 'pass' }],
};

function passingReport(step) {
  const checks = step.requiredChecks.map(name => ({
    [step.entryChecks ? 'id' : 'name']: name, status: 'pass',
    ...(step.entryChecks ? { required: true } : {}),
  }));
  if (!step.entryChecks) {
    return { schemaVersion: 1, mode: 'required', status: 'pass', checks: [
      ...checks, ...(step.diagnosticChecks ?? []).map(name => ({ name, status: 'pass' })),
    ] };
  }
  return { schemaVersion: 1, mode: 'required', status: 'pass',
    entries: ['Central', 'ModelDesign'].map(app => ({
      app, checks: structuredClone(checks),
      cleanup: { needed: true, attempted: true, status: 'pass' },
      anonymousCleanup: { needed: false, attempted: false, status: 'not-needed' },
    })),
  };
}

function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'localization-regression-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return { directory, reportDir: join(directory, 'run') };
}

test('full roster retains required source/native gates and opts into PLM known/deep suites', () => {
  const steps = regressionSteps({ reportDir: '/tmp/run' });
  assert.deepEqual(steps.map(step => step.id), [
    'scripts-contracts', 'plm-test-config', 'version-ledger', 'version-ledger-live',
    'required-source-gates', 'task-bytecode-inputs', 'modeling-runtime', 'external-ui',
    'browser-contracts', 'native-platform-api', 'native-modeldesign', 'plm-all-features',
  ]);
  for (const id of ['modeling-runtime', 'external-ui', 'native-platform-api']) {
    assert.ok(steps.find(step => step.id === id).args.includes('--required'));
  }
  const plm = steps.at(-1);
  assert.equal(plm.env.PLM_E2E_INCLUDE_KNOWN, '1');
  assert.equal(plm.env.PLM_E2E_INCLUDE_SWEEP, '1');
  assert.equal(plm.env.PLM_E2E_ARTIFACT_DIR, '/tmp/run/plm');
  assert.equal(plm.env.PLM_E2E_REPORT_DIR, '/tmp/run/plm/reports');
  assert.equal(plm.args.includes('--grep'), false);
  for (const step of steps.filter(item => item.tap)) {
    assert.ok(step.args.indexOf('--test-reporter=tap') < step.args.findIndex(arg => arg.endsWith('.mjs')));
  }
});

test('baseline is an explicit subset and never claims to run native/business acceptance', () => {
  const steps = regressionSteps({ baseline: true, reportDir: '/tmp/run' });
  assert.equal(steps.length, 8);
  assert.equal(steps.some(step => /native-modeldesign|plm-all/.test(step.id)), false);
  assert.equal(steps.some(step => step.id === 'required-source-gates'), true);
  assert.equal(steps.some(step => step.id === 'version-ledger-live'), true);
});

for (const [name, result] of [
  ['nonzero', { ...success, status: 1 }],
  ['partial source evidence', { ...success, status: 2 }],
  ['timeout', { ...success, error: { code: 'ETIMEDOUT' } }],
  ['signal', { ...success, signal: 'SIGTERM' }],
  ['missing exit', { stdout: tap }],
  ['no TAP summary', { ...success, stdout: 'ok' }],
  ['zero tests', { ...success, stdout: tap.replaceAll(' 2', ' 0') }],
  ['skip', { ...success, stdout: tap.replace('# skipped 0', '# skipped 1') }],
  ['todo', { ...success, stdout: tap.replace('# todo 0', '# todo 1') }],
  ['cancel', { ...success, stdout: tap.replace('# cancelled 0', '# cancelled 1') }],
  ['failed test', { ...success, stdout: tap.replace('# fail 0', '# fail 1') }],
  ['inconsistent count', { ...success, stdout: tap.replace('# tests 2', '# tests 3') }],
  ['multiple summaries', { ...success, stdout: tap + tap }],
]) {
  test(`required regression rejects ${name}`, () => {
    assert.equal(inspectRegressionResult({ tap: true }, result).status, 'fail');
  });
}

test('complete TAP run passes with exact counts', () => {
  const verdict = inspectRegressionResult({ tap: true }, success);
  assert.equal(verdict.status, 'pass');
  assert.equal(verdict.counts.tests, 2);
});

for (const [name, overrides] of [
  ['missing report', null], ['skip', { status: 'skip' }],
  ['missing checks', { checks: undefined }],
  ['empty checks', { checks: [] }],
  ['skipped check', { checks: [{ name: 'mandatory', status: 'skip' }] }],
  ['failed check', { checks: [{ name: 'mandatory', status: 'fail' }] }],
  ['warn-only', { checks: [{ name: 'mandatory', status: 'warn' }] }],
  ['disabled detection', { mode: 'off' }],
  ['optional detection', { mode: 'auto' }],
  ['missing mode', { mode: undefined }],
  ['unsupported schema', { schemaVersion: 2 }],
  ['missing mandatory check', { checks: [{ name: 'unrelated', status: 'pass' }] }],
  ['duplicate check', { checks: [
    { name: 'mandatory', status: 'pass' }, { name: 'mandatory', status: 'pass' },
  ] }],
  ['unnamed check', { checks: [{ status: 'pass' }] }],
  ['unapproved warning', { checks: [
    { name: 'mandatory', status: 'pass' }, { name: 'extra', status: 'warn', required: false },
  ] }],
]) {
  test(`child report rejects ${name} even with exit zero`, () => {
    const report = overrides === null ? null : { ...childReport, ...overrides };
    assert.equal(inspectRegressionResult(
      childStep, success, () => report,
    ).status, 'fail');
  });
}

test('child summary may retain only approved diagnostic warnings while mandatory checks pass', () => {
  const step = { ...childStep, warningChecks: ['diagnostic'] };
  const report = { ...childReport, checks: [
    ...childReport.checks, { name: 'diagnostic', status: 'warn' },
  ] };
  assert.equal(inspectRegressionResult(step, success, () => report).status, 'pass');
  const requiredWarning = structuredClone(report);
  requiredWarning.checks[1].required = true;
  assert.equal(inspectRegressionResult(step, success, () => requiredWarning).status, 'fail');
  const failed = structuredClone(report);
  failed.checks[0].status = 'fail';
  assert.equal(inspectRegressionResult(step, success, () => failed).status, 'fail');
  assert.equal(inspectRegressionResult({ ...childStep, requiredChecks: [] }, success,
    () => childReport).status, 'fail');
});

for (const id of ['modeling-runtime', 'external-ui', 'native-platform-api']) {
  test(`${id} requires every real mandatory check and permits no mandatory warnings`, () => {
    const step = regressionSteps({ reportDir: '/tmp/run' }).find(item => item.id === id);
    const report = passingReport(step);
    assert.equal(inspectRegressionResult(step, success, () => report).status, 'pass');
    for (const name of step.requiredChecks) {
      for (const status of ['missing', 'warn', 'skip']) {
        const candidate = structuredClone(report);
        const checks = step.entryChecks ? candidate.entries[1].checks : candidate.checks;
        const index = checks.findIndex(check => (check.id ?? check.name) === name);
        if (status === 'missing') checks.splice(index, 1);
        else checks[index].status = status;
        assert.equal(inspectRegressionResult(step, success, () => candidate).status, 'fail',
          `${name}: ${status}`);
      }
    }
  });
}

test('modeling runtime retains its real log diagnostics without omitting them', () => {
  const step = regressionSteps({ reportDir: '/tmp/run' }).find(item => item.id === 'modeling-runtime');
  const report = passingReport(step);
  for (const check of report.checks.filter(row => step.diagnosticChecks.includes(row.name))) {
    check.status = 'warn';
  }
  assert.equal(inspectRegressionResult(step, success, () => report).status, 'pass');
  report.checks = report.checks.filter(check => check.name !== step.diagnosticChecks[0]);
  assert.equal(inspectRegressionResult(step, success, () => report).status, 'fail');
});

test('native platform summary verifies both applications and rejects missing or skipped checks', () => {
  const step = regressionSteps({ reportDir: '/tmp/run' }).find(item => item.id === 'native-platform-api');
  const report = passingReport(step);
  assert.equal(inspectRegressionResult(step, success, () => report).status, 'pass');
  for (const change of [
    candidate => { candidate.entries.pop(); },
    candidate => { candidate.entries[1].checks = []; },
    candidate => { candidate.entries[1].checks[0].status = 'skip'; },
    candidate => { candidate.entries[1].checks[0].required = false; },
    candidate => { candidate.entries[1].cleanup.status = 'fail'; },
    candidate => { candidate.entries[1].cleanup.attempted = false; },
    candidate => { candidate.entries[1].anonymousCleanup.needed = true; },
  ]) {
    const candidate = structuredClone(report);
    change(candidate);
    assert.equal(inspectRegressionResult(step, success, () => candidate).status, 'fail');
  }
});

for (const [name, stats, errors] of [
  ['pass', { expected: 1, unexpected: 0, skipped: 0, flaky: 0 }, []],
  ['skip', { expected: 1, unexpected: 0, skipped: 1, flaky: 0 }, []],
  ['flaky', { expected: 1, unexpected: 0, skipped: 0, flaky: 1 }, []],
  ['failed', { expected: 1, unexpected: 1, skipped: 0, flaky: 0 }, []],
  ['empty', { expected: 0, unexpected: 0, skipped: 0, flaky: 0 }, []],
  ['missing counts', {}, []],
  ['global error', { expected: 1, unexpected: 0, skipped: 0, flaky: 0 }, ['setup failed']],
]) {
  test(`Playwright report handles ${name}`, () => {
    const verdict = inspectRegressionResult({ playwrightReport: 'results.json' }, success,
      () => ({ stats, errors }));
    assert.equal(verdict.status, name === 'pass' ? 'pass' : 'fail');
  });
}

test('runner preserves failures and runs subsequent gates serially with private immutable logs', t => {
  const { reportDir } = fixture(t);
  const calls = [];
  const result = runLocalizationRegression({
    baseline: true, reportDir,
    execute(executable, args, options) {
      calls.push({ executable, args, options });
      return calls.length === 3 ? { ...success, status: 1 } : success;
    },
  });
  assert.equal(calls.length, 8);
  assert.equal(result.report.evidenceOrigin, 'controlled-test-runner');
  assert.equal(result.report.scope, 'baseline-regression-subset');
  assert.equal(result.report.summary.skipped, 0);
  assert.equal(result.report.status, 'fail');
  assert.equal(result.report.nativeAcceptance, false);
  assert.equal(result.report.releaseAcceptance, false);
  assert.equal(result.report.steps[2].status, 'fail');
  assert.equal(result.report.steps[3].status, 'pass');
  assert.equal(result.report.steps[6].status, 'fail', 'missing child report cannot pass');
  const stored = JSON.parse(readFileSync(result.reportPath));
  assert.deepEqual(stored, result.report);
  const log = result.report.steps[0].stdout;
  const bytes = readFileSync(join(reportDir, log.path));
  assert.equal(log.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(statSync(join(reportDir, log.path)).mode & 0o777, 0o600);
  assert.equal(calls.every(call => call.options.env.NODE_OPTIONS === ''), true);
  assert.throws(() => runLocalizationRegression({ baseline: true, reportDir }), /must not be overwritten/);
});

test('required external UI overrides inherited weakening settings and records only its gate policy', t => {
  const { reportDir } = fixture(t);
  const inherited = {
    AIBIZ_EXTERNAL_UI_ALLOWED_STATUS: '503',
    AIBIZ_EXTERNAL_UI_FAIL_ON_HTTP_ERRORS: 'false',
    AIBIZ_EXTERNAL_UI_ALLOWED_CONSOLE_ERRORS: 'ERROR',
    AIBIZ_EXTERNAL_UI_IGNORED_HTTP_URLS: 'http',
    AIBIZ_EXTERNAL_UI_URL: 'http://127.0.0.1:19324/',
    AIBIZ_EXTERNAL_UI_VIEWPORT_WIDTH: '390',
    AIBIZ_EXTERNAL_UI_TIMEOUT_MS: '12345',
    AIBIZ_MODELING_PASSWORD: 'private-test-password',
  };
  const original = Object.fromEntries(Object.keys(inherited).map(key => [key, process.env[key]]));
  Object.assign(process.env, inherited);
  t.after(() => {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });
  let config;
  const result = runLocalizationRegression({
    baseline: true, reportDir,
    execute(_executable, args, options) {
      if (args.includes('scripts/external-ui-harness.mjs')) {
        config = parseExternalUiConfig(args.slice(1), options.env);
      }
      return success;
    },
  });
  assert.equal(config.mode, 'required');
  assert.equal(config.failOnHttpErrors, true);
  assert.deepEqual(config.allowedStatuses, []);
  assert.deepEqual(config.allowedConsoleErrors, []);
  assert.deepEqual(config.ignoredHttpUrls, []);
  assert.equal(config.url, inherited.AIBIZ_EXTERNAL_UI_URL);
  assert.equal(config.viewport.width, 390);
  assert.equal(config.timeoutMs, 12345);
  assert.deepEqual(result.report.steps.at(-1).gatePolicy, {
    mode: 'required', failOnHttpErrors: true,
    allowedStatuses: [], allowedConsoleErrors: [], ignoredHttpUrls: [],
  });
  assert.equal(JSON.stringify(result.report).includes(inherited.AIBIZ_MODELING_PASSWORD), false);
});

test('runner binds exact passed and malformed child report bytes to immutable step evidence', t => {
  const { reportDir } = fixture(t);
  const steps = regressionSteps({ baseline: true, reportDir });
  const result = runLocalizationRegression({
    baseline: true, reportDir,
    execute(_executable, args) {
      const step = steps.find(item => JSON.stringify(item.args) === JSON.stringify(args));
      if (step.report) {
        const path = join(reportDir, step.report);
        mkdirSync(dirname(path), { recursive: true });
        writeFileSync(path, step.id === 'external-ui' ? '{malformed report' :
          JSON.stringify(passingReport(step)));
      }
      return success;
    },
  });
  assert.equal(result.report.steps[6].status, 'pass');
  assert.equal(result.report.steps[7].status, 'fail');
  for (const step of result.report.steps.slice(6)) {
    assert.equal(step.childReports.length, 1);
    const receipt = step.childReports[0];
    const bytes = readFileSync(join(reportDir, receipt.path));
    assert.equal(receipt.bytes, bytes.length);
    assert.equal(receipt.sha256, createHash('sha256').update(bytes).digest('hex'));
    assert.deepEqual(JSON.parse(readFileSync(join(reportDir, `step-${step.id}.json`))).childReports,
      step.childReports);
  }
});

test('launch errors do not prevent later diagnostics and never count as skip', t => {
  const { reportDir } = fixture(t);
  let calls = 0;
  const result = runLocalizationRegression({
    baseline: true, reportDir, execute() {
      calls++;
      if (calls === 1) throw new Error('failed');
      if (calls === 2) return undefined;
      return success;
    },
  });
  assert.equal(calls, 8);
  assert.equal(result.report.steps[0].status, 'fail');
  assert.equal(result.report.steps[1].status, 'fail');
  assert.equal(result.report.summary.skipped, 0);
});

test('symlink report roots are rejected before executing commands', t => {
  const { directory } = fixture(t);
  symlinkSync(directory, join(directory, 'link'));
  let called = false;
  assert.throws(() => runLocalizationRegression({
    baseline: true, reportDir: join(directory, 'link', 'run'),
    execute() { called = true; return success; },
  }), /Symlink/);
  assert.equal(called, false);
});

test('CLI help and unsupported weakening options never execute gates', () => {
  const script = join(root, '../harness-localization-regression.mjs');
  const help = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /does not certify/);
  for (const option of ['--auto', '--off', '--skip', '--ignore-errors']) {
    const result = spawnSync(process.execPath, [script, option], { encoding: 'utf8' });
    assert.equal(result.status, 1);
  }
});
