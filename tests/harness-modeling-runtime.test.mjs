import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  analyzeDockerLogs,
  parseArgs,
  runHarness,
  summarizeStackResults,
} from '../harness-modeling-runtime.mjs';

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

test('modeling runtime harness fails when docker logs itself exits non-zero', () => {
  const result = analyzeDockerLogs(
    { stdout: '', stderr: 'permission denied\n', code: 13 },
    'modelingservice',
  );
  assert.equal(result.status, 'fail');
  assert.match(result.detail, /docker logs exited with code 13/);
  assert.deepEqual(result.lines, ['permission denied']);
});

test('modeling runtime auto mode only skips when no modeling container is running', () => {
  const stopped = summarizeStackResults([
    { stdout: '{"Status":"exited","Running":false}' },
    { stdout: '' },
    { stdout: '{"Status":"created","Running":false}' },
  ]);
  assert.deepEqual(stopped, { existing: 2, running: 0 });

  const partial = summarizeStackResults([
    { stdout: '{"Status":"running","Running":true}' },
    { stdout: '{"Status":"exited","Running":false}' },
    { stdout: '' },
  ]);
  assert.deepEqual(partial, { existing: 2, running: 1 });
});
