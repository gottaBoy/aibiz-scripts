import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

const source = await readFile(
  new URL('../harness-baseline.sh', import.meta.url),
  'utf8',
);

test('baseline keeps ordinary login separate from optional OAuth API-client verification', () => {
  assert.match(source, /AIBIZ_OAUTH_CLIENT_ID=\$\{AIBIZ_OAUTH_CLIENT_ID:-\}/);
  assert.match(source, /AIBIZ_OAUTH_CLIENT_SECRET=\$\{AIBIZ_OAUTH_CLIENT_SECRET:-\}/);
  assert.match(
    source,
    /SKIP allinone POST .*uaa\/oauth\/token .*AIBIZ_OAUTH_CLIENT_ID/,
  );
  assert.match(
    source,
    /FAIL OAuth client configuration requires both AIBIZ_OAUTH_CLIENT_ID and AIBIZ_OAUTH_CLIENT_SECRET/,
  );
  assert.match(source, /--data-urlencode 'grant_type=client_credentials'/);
  assert.match(source, /--data-urlencode "client_id=\$AIBIZ_OAUTH_CLIENT_ID"/);
  assert.match(source, /--data-urlencode "client_secret=\$AIBIZ_OAUTH_CLIENT_SECRET"/);
  assert.doesNotMatch(
    source,
    /--arg client_id "\$AIBIZ_LOGINNAME"[\s\S]*--arg client_secret "\$AIBIZ_PASSWORD"/,
  );
});

const hasJq = spawnSync('jq', ['--version'], { encoding: 'utf8' }).status === 0;
const definitions = source.slice(0, source.indexOf('record "AIBiz Harness baseline"'));
assert.ok(definitions.includes('check_allinone_oauth()'));
assert.ok(!definitions.includes('run_capture docker-info.txt'));

test('baseline declares strict page checks and explicitly opts the protected task API into auth responses', () => {
  assert.match(source, /^check_http nacos http:\/\/127\.0\.0\.1:8848\/nacos\/ 200$/m);
  assert.match(source, /^check_http modelingweb http:\/\/127\.0\.0\.1:32003\/modeldesign\/ 200$/m);
  assert.match(source, /^\s+check_http task http:\/\/127\.0\.0\.1:30088\/SAPAAS\/ 200 401 403$/m);
});

test('baseline allows candidate allinone and gateway ports without changing formal defaults', () => {
  assert.match(source, /AIBIZ_ALLINONE_PORT=\$\{AIBIZ_ALLINONE_PORT:-30000\}/);
  assert.match(source, /AIBIZ_GATEWAY_PORT=\$\{AIBIZ_GATEWAY_PORT:-30086\}/);
  assert.match(source, /AIBIZ_ALLINONE_URL=\$\{AIBIZ_ALLINONE_URL:-"http:\/\/127\.0\.0\.1:\$\{AIBIZ_ALLINONE_PORT\}"\}/);
  assert.match(source, /check_port allinone "\$AIBIZ_ALLINONE_PORT"/);
  assert.match(source, /check_port gateway "\$AIBIZ_GATEWAY_PORT"/);
  assert.match(source, /"\$AIBIZ_ALLINONE_URL\/v7\/login"/);
  assert.match(source, /"\$AIBIZ_ALLINONE_URL\/dictionaries\/codelist\/SysOperator"/);
});

test('baseline marks capture timeouts as failures and has a no-timeout fallback', () => {
  assert.match(source, /capture_status=124/);
  assert.match(source, /FAILED=1/);
  assert.match(source, /capture_pid=\$!/);
  assert.match(source, /kill "\$capture_pid"/);
});

test('baseline fallback terminates a wedged capture when timeout is unavailable', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'aibiz-capture-fallback-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bin = join(directory, 'bin');
  await mkdir(bin);
  for (const command of ['date', 'mkdir', 'sleep']) {
    await symlink(`/usr/bin/${command}`, join(bin, command));
  }
  const report = join(directory, 'report');
  const result = spawnSync('/bin/bash', [], {
    input: `${definitions}
AIBIZ_CAPTURE_TIMEOUT=1
run_capture wedged sleep 2
printf 'FAILED=%s\n' "$FAILED"
`,
    encoding: 'utf8',
    timeout: 10_000,
    env: {
      ...process.env,
      PATH: bin,
      AIBIZ_REPORT_DIR: report,
    },
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /FAILED=1/);
  assert.match(await readFile(join(report, 'wedged'), 'utf8'), /timed out after 1s/);
});

async function runHttp(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'aibiz-http-harness-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const result = spawnSync('/bin/bash', [
    '-s', '--', 'probe', 'http://127.0.0.1/contract',
    ...(options.allowedCodes ?? []),
  ], {
    input: `${definitions}
curl() {
  printf '%s' "$MOCK_HTTP_STATUS"
  return "$MOCK_CURL_EXIT"
}
check_http "$@"
${options.checkDefaultAfter ? 'check_http static-page http://127.0.0.1/static\n' : ''}exit "$FAILED"
`,
    encoding: 'utf8',
    timeout: 10_000,
    env: {
      ...process.env,
      AIBIZ_REPORT_DIR: join(directory, 'report'),
      MOCK_HTTP_STATUS: options.status ?? '200',
      MOCK_CURL_EXIT: String(options.curlExit ?? 0),
    },
  });
  assert.ifError(result.error);
  const summary = await readFile(join(directory, 'report/summary.txt'), 'utf8');
  assert.equal(summary, result.stdout);
  return result;
}

const httpPolicies = [
  ['default static page', [], ['200']],
  ['explicit static page', ['200'], ['200']],
  ['protected API', ['200', '401', '403'], ['200', '401', '403']],
];

for (const [name, allowedCodes, acceptedCodes] of httpPolicies) {
  for (const status of [
    '200', '201', '204', '206', '301', '302', '307', '308',
    '401', '403', '404', '500', '503', '000', '', '200401',
  ]) {
    test(`${name} HTTP gate handles ${status || 'empty status'}`, async t => {
      const result = await runHttp(t, { allowedCodes, status });
      const accepted = acceptedCodes.includes(status);
      assert.equal(result.status, accepted ? 0 : 1, result.stderr);
      assert.ok(result.stdout.includes(
        `${accepted ? 'PASS' : 'FAIL'} http ${status || '000'} (probe)`,
      ), result.stdout);
      assert.doesNotMatch(result.stdout, accepted ? /FAIL/ : /PASS/);
    });
  }
}

for (const [name, allowedCodes, acceptedCodes] of httpPolicies) {
  for (const status of acceptedCodes) {
    for (const curlExit of [7, 28]) {
      test(`${name} rejects curl exit ${curlExit} even with allowed HTTP ${status}`, async t => {
        const result = await runHttp(t, { allowedCodes, status, curlExit });
        assert.equal(result.status, 1, result.stderr);
        assert.ok(result.stdout.includes(`FAIL http ${status} (probe)`), result.stdout);
        assert.match(result.stdout, new RegExp(`curl_exit=${curlExit}`));
        assert.doesNotMatch(result.stdout, /PASS/);
      });
    }
  }
}

for (const status of ['401', '403']) {
  test(`protected API allowance for ${status} does not leak into a subsequent default page check`, async t => {
    const result = await runHttp(t, {
      allowedCodes: ['200', '401', '403'],
      status,
      checkDefaultAfter: true,
    });
    assert.equal(result.status, 1, result.stderr);
    assert.ok(result.stdout.includes(`PASS http ${status} (probe)`), result.stdout);
    assert.ok(result.stdout.includes(`FAIL http ${status} (static-page)`), result.stdout);
    assert.doesNotMatch(result.stdout, /PASS.*static-page/);
  });
}

async function runOAuth(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'aibiz-oauth-harness-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bin = join(directory, 'bin');
  const report = join(directory, 'report');
  const log = join(directory, 'requests.json');
  await mkdir(bin);
  await mkdir(report);
  const curl = join(bin, 'curl');
  await writeFile(curl, `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.writeFileSync(process.env.MOCK_REQUEST_LOG, JSON.stringify(args));
const output = args[args.indexOf('-o') + 1];
fs.writeFileSync(output, process.env.MOCK_OAUTH_BODY);
process.stdout.write(process.env.MOCK_OAUTH_STATUS);
process.exit(Number(process.env.MOCK_CURL_EXIT));
`);
  await chmod(curl, 0o755);
  if (options.withoutJq) {
    const jq = join(bin, 'jq');
    await writeFile(jq, `#!${process.execPath}
const fs = require('node:fs');
fs.appendFileSync(process.env.MOCK_JQ_LOG, 'invoked\n');
process.exit(99);
`);
    await chmod(jq, 0o755);
  }
  const result = spawnSync('/bin/bash', [], {
    input: `${definitions}\ncheck_allinone_oauth\nexit "$FAILED"\n`,
    encoding: 'utf8',
    timeout: 10_000,
    env: {
      ...process.env,
      PATH: `${bin}:/usr/bin:/bin`,
      TMPDIR: directory,
      AIBIZ_REPORT_DIR: report,
      AIBIZ_LOGINNAME: 'ordinary-user',
      AIBIZ_PASSWORD: 'ordinary-password',
      AIBIZ_OAUTH_CLIENT_ID: options.id ?? '',
      AIBIZ_OAUTH_CLIENT_SECRET: options.secret ?? '',
      MOCK_REQUEST_LOG: log,
      MOCK_OAUTH_BODY: options.body ?? '{"access_token":"test-token"}',
      MOCK_OAUTH_STATUS: options.status ?? '200',
      MOCK_CURL_EXIT: String(options.curlExit ?? 0),
      MOCK_JQ_LOG: join(directory, 'jq.log'),
    },
  });
  assert.ifError(result.error);
  const requests = await readFile(log, 'utf8').then(JSON.parse).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  const remaining = await import('node:fs/promises').then(fs => fs.readdir(directory));
  assert.ok(
    !remaining.some(name => name.startsWith('aibiz-harness-oauth.')),
    'temporary OAuth response must be removed',
  );
  return { ...result, requests };
}

test('unconfigured OAuth is explicitly skipped without making a request', { skip: !hasJq }, async t => {
  const result = await runOAuth(t);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /SKIP allinone POST \/uaa\/oauth\/token/);
  assert.doesNotMatch(result.stdout, /PASS|FAIL/);
  assert.equal(result.requests, null);
});

test('unconfigured OAuth is skipped even when jq is unavailable', async t => {
  const result = await runOAuth(t, { withoutJq: true });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /SKIP allinone POST \/uaa\/oauth\/token/);
  assert.doesNotMatch(result.stdout, /FAIL/);
  assert.equal(result.requests, null);
});

for (const config of [{ id: 'client' }, { secret: 'secret' }]) {
  test(`partial OAuth configuration fails before curl (${Object.keys(config)[0]})`, { skip: !hasJq }, async t => {
    const result = await runOAuth(t, config);
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, /FAIL OAuth client configuration requires both/);
    assert.equal(result.requests, null);
  });
}

test('OAuth sends client credentials as encoded form fields, not ordinary login credentials', { skip: !hasJq }, async t => {
  const id = 'local client+&=id';
  const secret = 'secret+&=/value with spaces';
  const result = await runOAuth(t, { id, secret });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PASS http 200 .*token present/);
  const args = result.requests;
  const formFields = args.flatMap((arg, index) =>
    arg === '--data-urlencode' ? [args[index + 1]] : []);
  assert.deepEqual(formFields, [
    'grant_type=client_credentials', `client_id=${id}`, `client_secret=${secret}`,
  ]);
  assert.ok(args.includes('Content-Type: application/x-www-form-urlencoded'));
  assert.equal(args.at(-1), 'http://127.0.0.1:30000/uaa/oauth/token');
  assert.ok(!args.includes('--data-raw'));
  assert.doesNotMatch(result.stdout + result.stderr, /secret\+|ordinary-password/);
});

for (const [name, config, message] of [
  ['HTTP rejection', { status: '401' }, /FAIL http 401/],
  ['missing token', { body: '{}' }, /token missing/],
  ['empty token', { body: '{"access_token":""}' }, /token missing/],
  ['non-string token', { body: '{"access_token":123}' }, /token missing/],
  ['malformed JSON', { body: 'not JSON' }, /token missing/],
  ['curl failure with a success-looking response', { curlExit: 28 }, /curl_exit=28/],
]) {
  test(`OAuth cannot pass on ${name}`, { skip: !hasJq }, async t => {
    const result = await runOAuth(t, { id: 'client', secret: 'secret', ...config });
    assert.equal(result.status, 1, result.stderr);
    assert.match(result.stdout, message);
    assert.doesNotMatch(result.stdout, /PASS/);
    assert.ok(result.requests);
  });
}
