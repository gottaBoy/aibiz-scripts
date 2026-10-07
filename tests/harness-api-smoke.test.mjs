import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const script = new URL('../harness-api-smoke.sh', import.meta.url);
const source = await readFile(script, 'utf8');
const marker = source.indexOf('record "AIBiz Harness API smoke"');
assert.ok(marker > 0);
const definitions = source.slice(0, marker);

async function runCheck(t, call, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'aibiz-api-smoke-contract-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bin = join(directory, 'bin');
  await mkdir(bin);
  const curl = join(bin, 'curl');
  await writeFile(curl, `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
const headerIndex = args.indexOf('-D');
if (headerIndex >= 0) fs.writeFileSync(args[headerIndex + 1], 'HTTP/1.1 200 OK\\r\\nX-Total: 1\\r\\n\\r\\n');
fs.writeFileSync(args[args.indexOf('-o') + 1], process.env.FIXTURE_BODY);
process.stdout.write(process.env.FIXTURE_STATUS);
process.exit(Number(process.env.FIXTURE_CURL_EXIT));
`);
  await chmod(curl, 0o755);
  const report = join(directory, 'report');
  const result = spawnSync('/bin/bash', ['-s'], {
    input: `${definitions}\n${call}\nexit "$FAILED"\n`,
    encoding: 'utf8', timeout: 5000,
    env: {
      ...process.env, PATH: `${bin}:${process.env.PATH}`, TMPDIR: directory,
      AIBIZ_NETWORK_MODE: 'host', AIBIZ_REPORT_DIR: report,
      FIXTURE_BODY: options.body ?? '{"token":"private-fixture-token"}',
      FIXTURE_STATUS: options.status ?? '200',
      FIXTURE_CURL_EXIT: String(options.curlExit ?? 0),
    },
  });
  assert.ifError(result.error);
  const checks = (await readFile(join(report, 'checks.jsonl'), 'utf8'))
    .trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  assert.doesNotMatch(result.stdout + result.stderr, /private-fixture-token/);
  return { ...result, checks };
}

const listCall = `check_json_endpoint POST "/ai_agents/fetch_default" \
"http://127.0.0.1:30250/api/ai_agents/fetch_default" '{"page":0,"size":20}'`;

test('modeling service smoke uses the authenticated modelapi business route', async t => {
  const result = await runCheck(t, `
MODELING_AUTH_HEADER="Authorization: Bearer fixture"
check_modeling_service_fetchdefault
`, { body: '[]' });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.equal(result.checks.length, 1);
  assert.equal(
    result.checks[0].check,
    'POST /ibizmodeling/modelapi/psdevusers/fetchdefault',
  );
  assert.equal(result.checks[0].status, 'PASS');
});

for (const [name, call, body] of [
  ['login', 'login plm http://127.0.0.1:30250 user password PLM_AUTH_HEADER', '{"token":"private-fixture-token"}'],
  ['list', listCall, '[]'],
  ['schema', 'check_schema_endpoint', '{"type":"object","properties":{"id":{"type":"string"}}}'],
  ['native fetch transport', 'MODELING_AUTH_HEADER="Authorization: Bearer fixture"; check_modeldesign_fetchdefault', '[]'],
]) {
  test(`API smoke rejects failed ${name} transfers despite HTTP 200 and valid JSON`, async t => {
    const result = await runCheck(t, call, { body, curlExit: 28 });
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.equal(result.checks.length, 1);
    assert.equal(result.checks[0].status, 'FAIL');
    assert.match(result.checks[0].detail, /curl_exit=28/);
  });
}

test('API list smoke validates records, not just JSON syntax', async t => {
  for (const body of [
    'true', '42', '"ok"', '{}', '{"error":"database unavailable"}',
    '{"success":false,"data":[]}', '{"type":"SystemRuntimeException","data":[]}',
    '{"data":null}', '[null]', '[{"name":"missing ID"}]', '[{"id":""}]',
  ]) {
    const result = await runCheck(t, listCall, { body });
    assert.equal(result.status, 1, `${body}\n${result.stdout}${result.stderr}`);
    assert.equal(result.checks[0].status, 'FAIL');
  }
  for (const body of ['[]', '[{"id":"agent-1"}]', '{"data":[]}', '{"items":[{"id":"agent-1"}]}', '{"rows":[]}']) {
    const result = await runCheck(t, listCall, { body });
    assert.equal(result.status, 0, `${body}\n${result.stdout}${result.stderr}`);
    assert.equal(result.checks[0].status, 'PASS');
  }
});

test('API appdata rejects scalar, empty and application-error responses', async t => {
  const call = 'check_json_endpoint GET /appdata http://127.0.0.1:30250/api/appdata';
  for (const body of ['true', '[]', '{}', '{"error":"unauthorized"}', '{"success":false}']) {
    const result = await runCheck(t, call, { body });
    assert.equal(result.status, 1, `${body}\n${result.stdout}${result.stderr}`);
  }
  const valid = await runCheck(t, call, { body: '{"srfusername":"fixture-user"}' });
  assert.equal(valid.status, 0, valid.stdout + valid.stderr);
});

test('API schema smoke rejects an empty placeholder schema', async t => {
  const result = await runCheck(t, 'check_schema_endpoint', { body: '{"properties":{}}' });
  assert.equal(result.status, 1, result.stdout + result.stderr);
});

test('container response-copy failure is recorded instead of silently abandoning a check', async t => {
  const result = await runCheck(t, `
AIBIZ_NETWORK_MODE=container
docker() { return 1; }
response_file=/tmp/aibiz-harness-api/fixture
pull_temp response_file
`);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.equal(result.checks[0].status, 'FAIL');
  assert.match(result.checks[0].detail, /copy_failed/);
});

test('explicit database checks fail when the requested MySQL container is missing', async t => {
  const result = await runCheck(t, 'docker() { return 1; }; check_database_tables');
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.equal(result.checks[0].status, 'FAIL');
});
