import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parseArgs, runHarness } from '../harness-modeling-runtime.mjs';

test('modeling runtime harness validates modes and writes an explicit skip report', async () => {
  const reportDir = await mkdtemp(join(tmpdir(), 'modeling-runtime-contract-'));
  const config = parseArgs(['--mode', 'off', '--report-dir', reportDir]);

  assert.equal(config.mode, 'off');
  assert.equal(await runHarness(config), 0);

  const report = JSON.parse(await readFile(join(reportDir, 'report.json'), 'utf8'));
  assert.equal(report.status, 'skip');
  assert.equal(report.exitCode, 0);
  assert.equal(report.checks[0].status, 'skip');
  assert.match(report.checks[0].detail, /disabled by --mode off/);
});

test('modeling runtime harness rejects unknown modes and options', () => {
  assert.throws(
    () => parseArgs(['--mode', 'sometimes']),
    /Invalid --mode: sometimes/,
  );
  assert.throws(
    () => parseArgs(['--unknown']),
    /Unknown option: --unknown/,
  );
});
