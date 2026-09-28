import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const scriptsRoot = resolve(import.meta.dirname, '..');
const harness = resolve(scriptsRoot, 'harness-uaa-task-readiness.mjs');

function runHarness() {
  try {
    execFileSync(process.execPath, [harness], {
      cwd: scriptsRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    return JSON.parse(error.stdout);
  }
  assert.fail('readiness harness must remain fail-closed while source evidence is incomplete');
}

function runHarnessWithReport(reportPath) {
  try {
    execFileSync(process.execPath, [harness], {
      cwd: scriptsRoot,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, UAA_TASK_READINESS_REPORT: reportPath },
    });
  } catch (error) {
    return JSON.parse(error.stdout);
  }
  assert.fail('readiness harness must remain fail-closed while source evidence is incomplete');
}

test('UAA and Task readiness gate reports both services separately', () => {
  const report = runHarness();
  assert.equal(typeof report.readiness.uaa32666, 'boolean');
  assert.equal(report.readiness.task30088, false);
  assert.ok(report.services.uaa32666.some((item) => item.id === 'uaa-source-build-evidence'));
  assert.ok(report.services.uaa32666.some((item) => item.id === 'uaa-source-image-evidence'));
  assert.ok(report.services.task30088.some((item) => item.id === 'task-local-dependencies'));
  assert.ok(report.services.task30088.some((item) => item.id === 'task-war-assembly'));
});

test('readiness gate only marks UAA ready with hash-verified source evidence', () => {
  const report = JSON.parse(readFileSync(resolve(scriptsRoot, '.artifacts/uaa-task-readiness.json'), 'utf8'));
  const sourceBuild = report.checks.find((item) => item.id === 'uaa-source-build-evidence');
  if (sourceBuild.status === 'pass') {
    assert.match(
      sourceBuild.reason,
      /current UAA source commit.*produced.*hash-verified standalone artifact/i,
    );
  } else {
    assert.match(sourceBuild.reason, /prebuilt image is not accepted/);
  }
});

test('readiness report creates missing parent directories for explicit paths', () => {
  const directory = mkdtempSync(join(tmpdir(), 'uaa-readiness-report-'));
  const reportPath = join(directory, 'nested', 'readiness.json');
  try {
    const report = runHarnessWithReport(reportPath);
    assert.equal(report.readiness.task30088, false);
    assert.deepEqual(JSON.parse(readFileSync(reportPath, 'utf8')), report);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
