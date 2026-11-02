#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { PinnedDirectories, readPinnedFile } from './native-candidate-files.mjs';

const scriptRoot = dirname(fileURLToPath(import.meta.url));
const workspace = resolve(scriptRoot, '..');
const sha256 = data => createHash('sha256').update(data).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;

const externalUiPolicy = {
  mode: 'required', failOnHttpErrors: true,
  allowedStatuses: [], allowedConsoleErrors: [], ignoredHttpUrls: [],
};
const externalUiEnvironment = {
  AIBIZ_EXTERNAL_UI_FAIL_ON_HTTP_ERRORS: 'true',
  AIBIZ_EXTERNAL_UI_ALLOWED_STATUS: '',
  AIBIZ_EXTERNAL_UI_ALLOWED_CONSOLE_ERRORS: '',
  // A nonempty, empty CSV list overrides the standalone favicon default.
  AIBIZ_EXTERNAL_UI_IGNORED_HTTP_URLS: ',',
};
const modelingRequiredChecks = [
  'container:modelingservice', 'container:modelingweb', 'container:modeling-plugins',
  'modelingservice-login', 'modelingservice-psdevusers-fetchdefault',
  'http:modelingservice-root-auth', 'http:modelingservice-proxy-business',
  'http:modelingweb-page', 'http:modelingweb-doc', 'http:modelingweb-doc-readme',
  'http:plugin-sidecar-through-web', 'http:local-remotemodel', 'http:local-jsonschema',
  'http:modelingservice-proxy-auth',
];
const modelingDiagnosticChecks = [
  'logs:modelingservice', 'logs:modelingweb', 'logs:modeling-plugins',
];
const externalUiRequiredChecks = [
  'main-response', 'document-body', 'expected-selector', 'expected-selector-visible',
  'console-errors', 'page-errors', 'failed-requests', 'http-errors', 'screenshot',
];
const nativePlatformRequiredChecks = [
  'login', 'messages-anonymous-denied', 'messages-fetch',
  'configs-anonymous-get-denied', 'configs-anonymous-baseline',
  'configs-anonymous-put-denied', 'configs-anonymous-state-preserved',
  'configs-baseline', 'configs-put', 'configs-same-session-get', 'login-new-session',
  'configs-new-session-get', 'configs-update', 'configs-update-get',
  'configs-other-session-update-get', 'configs-reset', 'configs-reset-get',
  'configs-other-session-reset-get', 'configs-roundtrip', 'cleanup-put-1', 'cleanup-get-1',
];

export function regressionSteps({ baseline = false, reportDir }) {
  const node = (id, args, extra = {}) => ({
    id, executable: process.execPath, args, cwd: workspace, timeoutMs: 1_200_000,
    ...extra,
  });
  const contractTests = readdirSync(join(scriptRoot, 'tests'))
    .filter(name => name.endsWith('.test.mjs')).sort()
    .map(name => `scripts/tests/${name}`);
  const steps = [
    node('scripts-contracts', ['--test', '--test-reporter=tap', ...contractTests], { tap: true }),
    node('plm-test-config', ['--test', '--test-reporter=tap',
      'plm-e2e/config-tests/artifact-isolation.test.mjs'], { tap: true }),
    node('version-ledger', ['scripts/version-ledger.mjs', '--json']),
    node('version-ledger-live', ['scripts/version-ledger.mjs', '--live', '--json']),
    node('required-source-gates', ['scripts/harness-required-source-gates.mjs',
      '--report-dir', join(reportDir, 'required-source')]),
    node('task-bytecode-inputs', ['scripts/audit-task-bytecode-inputs.mjs',
      '--output', join(reportDir, 'task-inputs', 'report.json')]),
    node('modeling-runtime', ['scripts/harness-modeling-runtime.mjs',
      '--required', '--report-dir', join(reportDir, 'modeling-runtime')],
    { report: 'modeling-runtime/report.json', acceptedStatus: 'pass',
      requiredChecks: modelingRequiredChecks, diagnosticChecks: modelingDiagnosticChecks,
      warningChecks: modelingDiagnosticChecks }),
    node('external-ui', ['scripts/external-ui-harness.mjs', '--required',
      '--report-dir', join(reportDir, 'external-ui')],
    { report: 'external-ui/report.json', acceptedStatus: 'pass',
      requiredChecks: externalUiRequiredChecks, env: externalUiEnvironment,
      gatePolicy: externalUiPolicy }),
  ];
  if (baseline) return steps;
  return [...steps,
    node('browser-contracts', ['--test', '--test-reporter=tap', 'scripts/tests/native-login-reload.browser.mjs',
      'scripts/tests/native-global-util.browser.mjs', 'scripts/tests/native-studio-theme.browser.mjs'],
    { tap: true }),
    node('native-platform-api', ['scripts/harness-native-platform-api.mjs', '--required',
      '--report-dir', join(reportDir, 'native-platform-api')],
    { report: 'native-platform-api/report.json', acceptedStatus: 'pass', entryChecks: true,
      requiredChecks: nativePlatformRequiredChecks }),
    node('native-modeldesign', ['modelingweb/app/tests/native-modeldesign.browser.mjs'], {
      env: { MODEL_DESIGN_ARTIFACT_DIR: join(reportDir, 'native-modeldesign') },
    }),
    node('plm-all-features', ['node_modules/@playwright/test/cli.js', 'test'], {
      cwd: join(workspace, 'plm-e2e'), timeoutMs: 7_200_000,
      env: {
        PLM_E2E_BASE_URL: process.env.PLM_E2E_BASE_URL || 'http://127.0.0.1:30250/ibizplm-plmweb/',
        PLM_E2E_ARTIFACT_DIR: join(reportDir, 'plm'),
        PLM_E2E_INCLUDE_KNOWN: '1', PLM_E2E_INCLUDE_SWEEP: '1',
        PLM_E2E_OUTPUT_DIR: join(reportDir, 'plm', 'test-results'),
        PLM_E2E_REPORT_DIR: join(reportDir, 'plm', 'reports'),
      },
      playwrightReport: 'plm/reports/test-results.json',
    }),
  ];
}

function inspectRequiredChecks(step, checks) {
  assert.ok(Array.isArray(step.requiredChecks) && step.requiredChecks.length > 0,
    'Required child check roster is missing');
  assert.ok(Array.isArray(checks) && checks.length > 0, 'Required child checks are missing');
  const byName = new Map();
  for (const check of checks) {
    const name = check?.id ?? check?.name;
    assert.ok(typeof name === 'string' && name.length > 0, 'Child check name is missing');
    assert.ok(!byName.has(name), `Duplicate child check: ${name}`);
    byName.set(name, check);
    const diagnosticWarning = check.status === 'warn' && check.required !== true
      && step.warningChecks?.includes(name);
    assert.ok(check.status === 'pass' || diagnosticWarning, `Child check did not pass: ${name}`);
  }
  for (const name of step.requiredChecks) {
    assert.equal(byName.get(name)?.status, 'pass', `Required child check did not pass: ${name}`);
    if (step.entryChecks) {
      assert.equal(byName.get(name).required, true, `Native check is not required: ${name}`);
    }
  }
  for (const name of step.diagnosticChecks ?? []) {
    assert.ok(byName.has(name), `Child diagnostic check is missing: ${name}`);
  }
}

export function inspectRegressionResult(step, result, readReport) {
  const failures = [];
  if (result.status !== 0) failures.push(`Command exit: ${result.status ?? 'unavailable'}`);
  if (result.error) failures.push(`Command launch: ${result.error.code ?? 'error'}`);
  if (result.signal) failures.push(`Command signal: ${result.signal}`);
  let counts;
  if (step.tap) {
    const text = String(result.stdout ?? '');
    counts = Object.fromEntries(['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'].map(key => {
      const matches = [...text.matchAll(new RegExp(`^# ${key} (\\d+)\\r?$`, 'gm'))];
      return [key, matches.length === 1 ? Number(matches[0][1]) : null];
    }));
    if (!Number.isSafeInteger(counts.tests) || counts.tests < 1
      || counts.pass !== counts.tests
      || ['fail', 'cancelled', 'skipped', 'todo'].some(key => counts[key] !== 0)) {
      failures.push('Required TAP run is missing, incomplete, failed or contains skips/todos');
    }
  }
  if (step.report) {
    try {
      const report = readReport(step.report);
      assert.equal(report.schemaVersion, 1, 'Required child schema is unsupported');
      assert.equal(report.mode, 'required', 'Required child detection was disabled or optional');
      assert.equal(report.status, step.acceptedStatus, 'Required child report did not pass');
      if (step.entryChecks) {
        assert.deepEqual(report.entries?.map(entry => entry.app), ['Central', 'ModelDesign'],
          'Required native platform applications are missing');
        for (const entry of report.entries) {
          inspectRequiredChecks(step, entry.checks);
          assert.ok(entry.cleanup?.needed === true && entry.cleanup.attempted === true
            && entry.cleanup.status === 'pass', 'Required native configuration cleanup did not pass');
          assert.ok(entry.anonymousCleanup?.needed === false &&
            entry.anonymousCleanup.status === 'not-needed',
          'Anonymous native writes required cleanup despite denial');
        }
      } else {
        inspectRequiredChecks(step, report.checks);
      }
    } catch (error) { failures.push(error.message); }
  }
  if (step.playwrightReport) {
    try {
      const report = readReport(step.playwrightReport);
      const { stats } = report;
      assert.ok(stats && ['expected', 'unexpected', 'flaky', 'skipped'].every(key =>
        Number.isSafeInteger(stats[key]) && stats[key] >= 0), 'Playwright statistics are missing');
      assert.ok(stats.expected > 0 && stats.unexpected === 0
        && stats.flaky === 0 && stats.skipped === 0, 'Required Playwright run failed, skipped or was flaky');
      assert.ok(Array.isArray(report.errors) && report.errors.length === 0,
        'Playwright reported global errors');
      counts = stats;
    } catch (error) { failures.push(error.message); }
  }
  return { status: failures.length ? 'fail' : 'pass', failures, ...(counts ? { counts } : {}) };
}

export function runLocalizationRegression({
  baseline = false, reportDir = join(workspace, '.artifacts/localization-regression',
    `run-${randomUUID()}`), execute = spawnSync, onStep = () => {},
} = {}) {
  const directories = new PinnedDirectories();
  const destination = resolve(reportDir);
  try {
    const run = directories.open(destination, { create: true, exclusive: true });
    const logs = directories.open(join(destination, 'logs'), { create: true });
    const report = {
      contract: 'localization-regression-command-run-v1',
      scope: baseline ? 'baseline-regression-subset' : 'full-regression-command-roster',
      evidenceOrigin: execute === spawnSync ? 'local-command-execution' : 'controlled-test-runner',
      startedAt: new Date().toISOString(), required: true,
      nativeAcceptance: false, releaseAcceptance: false, steps: [],
      limitations: [
        'Command regression is not complete source, Docker or feature-matrix acceptance.',
        'Source receipts, native non-admin/root isolation, all 11 actions, every plugin and persistence require independent evidence.',
        'No service restart, source edit, automatic commit or failed-test suppression is performed by this runner.',
      ],
    };
    for (const step of regressionSteps({ baseline, reportDir: destination })) {
      onStep({ id: step.id, status: 'running' });
      const startedAt = new Date().toISOString();
      let result;
      try {
        result = execute(step.executable, step.args, {
          cwd: step.cwd, encoding: 'utf8', timeout: step.timeoutMs,
          maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
          env: { ...process.env, NODE_OPTIONS: '', NODE_PATH: '', FORCE_COLOR: '0', ...step.env },
        });
        assert.ok(result && typeof result === 'object', 'Missing command result');
      } catch (error) { result = { status: null, error }; }
      const stdout = Buffer.from(result.stdout ?? '');
      const stderr = Buffer.from(result.stderr ?? '');
      const stdoutName = `${step.id}.stdout.log`;
      const stderrName = `${step.id}.stderr.log`;
      directories.write(logs, stdoutName, stdout);
      directories.write(logs, stderrName, stderr);
      const childReports = [];
      const readReport = path => {
        const absolute = join(destination, path);
        const { data } = readPinnedFile(directories, directories.open(dirname(absolute)), basename(absolute));
        childReports.push({ path, bytes: data.length, sha256: sha256(data) });
        return JSON.parse(data);
      };
      const verdict = inspectRegressionResult(step, result, readReport);
      const evidence = {
        id: step.id, required: true, startedAt, finishedAt: new Date().toISOString(),
        command: { executable: step.executable, args: step.args, cwd: step.cwd },
        ...(step.gatePolicy ? { gatePolicy: step.gatePolicy } : {}),
        exitCode: result.status ?? null, signal: result.signal ?? null, ...verdict,
        childReports,
        stdout: { path: `logs/${stdoutName}`, bytes: stdout.length, sha256: sha256(stdout) },
        stderr: { path: `logs/${stderrName}`, bytes: stderr.length, sha256: sha256(stderr) },
      };
      report.steps.push(evidence);
      directories.write(run, `step-${step.id}.json`, json(evidence));
      onStep(evidence);
    }
    report.finishedAt = new Date().toISOString();
    report.summary = {
      total: report.steps.length, passed: report.steps.filter(step => step.status === 'pass').length,
      failed: report.steps.filter(step => step.status === 'fail').length, skipped: 0,
    };
    report.status = report.summary.failed ? 'fail' : 'pass';
    directories.write(run, 'report.json', json(report));
    return { report, reportPath: join(destination, 'report.json') };
  } finally { directories.close(); }
}

export function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: {
    baseline: { type: 'boolean' }, 'report-dir': { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) {
    console.log('Usage: node scripts/harness-localization-regression.mjs [--baseline] [--report-dir NEW_DIRECTORY]');
    console.log('Default: all regression commands, including native writes and PLM known/deep suites.');
    console.log('--baseline: contracts, source audits, live ledger, runtime and portal only.');
    console.log('Serial, no skip/auto/off mode; failed steps are retained and remaining steps still execute.');
    console.log('This runner does not certify final source/Docker/feature acceptance or commit changes.');
    return 0;
  }
  const { report, reportPath } = runLocalizationRegression({
    baseline: values.baseline, reportDir: values['report-dir'],
    onStep: step => console.log(`[localization-regression] ${step.status.toUpperCase()}: ${step.id}`),
  });
  console.log(json({ ...report.summary, status: report.status, reportPath,
    nativeAcceptance: false, releaseAcceptance: false }).trim());
  return report.status === 'pass' ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
