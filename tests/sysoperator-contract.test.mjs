import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const filter = fileURLToPath(new URL('../check-sysoperator.jq', import.meta.url));
const check = input => spawnSync('jq', ['-e', '-f', filter], {
  input: JSON.stringify(input), encoding: 'utf8', timeout: 3000,
});

test('SysOperator accepts its precise empty response and typed employee items', () => {
  for (const input of [
    { code: 'SysOperator' },
    { code: 'SysOperator', items: [] },
    { code: 'SysOperator', items: [{ value: 'employee-1', text: 'Example' }] },
  ]) {
    const result = check(input);
    assert.equal(result.status, 0, result.stderr || result.error?.message);
  }
});

test('an array alone, wrong code or application error cannot masquerade as a dictionary', () => {
  for (const input of [
    null, [], {}, { items: [] },
    { code: 'Other', items: [] },
    { code: 1, message: 'failed', items: [] },
    { code: 'SysOperator', error: 'database', items: [] },
    { code: 'SysOperator', type: 'SystemRuntimeException', items: [] },
    { code: 'SysOperator', message: 'unauthorized', items: [] },
    { code: 'SysOperator', success: false, items: [] },
    { code: 'SysOperator', items: null },
    { code: 'SysOperator', items: ['not-an-employee'] },
    { code: 'SysOperator', items: [{ value: '', text: 'Missing ID' }] },
    { code: 'SysOperator', items: [{ value: 'id', text: 42 }] },
  ]) assert.notEqual(check(input).status, 0, JSON.stringify(input));
});

test('the real baseline rejects failed curl transfers even if they print HTTP 200 and valid JSON', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'baseline-contract-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bin = join(directory, 'bin');
  await mkdir(bin);
  const stub = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const name = path.basename(process.argv[1]);
const args = process.argv.slice(2);
if (name === 'nc') process.exit(0);
if (name === 'docker') {
  if (args.includes('--format')) {
    const format = args[args.indexOf('--format') + 1];
    if (format === '{{.State.Running}}') console.log('true');
    else if (format === '{{.State.OOMKilled}}') console.log('false');
    else if (format.includes('.State.Health')) console.log('none');
    else console.log('fixture');
  }
  process.exit(0);
}
if (name === 'curl') {
  const url = args.at(-1);
  const codelist = url.endsWith('/dictionaries/codelist/SysOperator');
  const file = args[args.indexOf('-o') + 1];
  const body = codelist ? process.env.FIXTURE_BODY : '{"token":"private-fixture-token"}';
  if (file && file !== '/dev/null') fs.writeFileSync(file, body);
  process.stdout.write(codelist ? process.env.FIXTURE_STATUS : '200');
  process.exit(codelist ? Number(process.env.FIXTURE_EXIT) : 0);
}
process.exit(1);
`;
  for (const command of ['docker', 'nc', 'curl']) {
    const path = join(bin, command);
    await writeFile(path, stub);
    await chmod(path, 0o755);
  }
  const baseline = fileURLToPath(new URL('../harness-baseline.sh', import.meta.url));
  const cases = [
    { body: '{"code":"SysOperator"}', status: '200', exit: '0', expected: 0 },
    { body: '{"code":"SysOperator","items":[]}', status: '200', exit: '28', expected: 1 },
    { body: '{"code":"Other","items":[]}', status: '200', exit: '0', expected: 1 },
    { body: '{"code":"SysOperator","items":[]}', status: '500', exit: '0', expected: 1 },
  ];
  for (const [index, example] of cases.entries()) {
    const report = join(directory, `report-${index}`);
    const result = spawnSync('/bin/bash', [baseline], {
      encoding: 'utf8', timeout: 20000,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, LC_ALL: 'C',
        AIBIZ_REPORT_DIR: report, FIXTURE_BODY: example.body, FIXTURE_STATUS: example.status, FIXTURE_EXIT: example.exit },
    });
    assert.equal(result.status, example.expected, result.stdout + result.stderr);
    const summary = await readFile(join(report, 'summary.txt'), 'utf8');
    assert.doesNotMatch(summary, /private-fixture-token/);
    if (example.exit !== '0') assert.match(summary, /SysOperator HTTP 200 curl_exit=28/);
    if (example.expected === 0) assert.match(summary, /organization identity and employee data are not verified/);
  }
});
