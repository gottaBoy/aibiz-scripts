import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { parseArgs, runHarness } from '../harness-native-model-modules.mjs';

const systemId = '2C40DFCD-0DF5-47BF-91A5-C45F810B0001';
const token = 'private-controlled-login-token';
const password = 'private-login-password';
const mysqlPassword = 'private-mysql-password';
const privateBody = 'private-body-must-never-be-reported';
const modules = [
  { psmoduleid: 'module-beta', pssystemid: systemId, psmodulename: 'private-module-beta-name' },
  { psmoduleid: 'module-alpha', pssystemid: systemId, psmodulename: 'private-module-alpha-name' },
];

function response(status, value, headers = {}) {
  return new Response(value === undefined ? null : JSON.stringify(value), {
    status, headers: { 'content-type': 'application/json', ...headers },
  });
}

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'native-model-modules-unit-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const config = parseArgs(['--report-dir', directory, '--timeout-ms', '2000'], {
    AIBIZ_LOGINNAME: 'controlled-user', AIBIZ_PASSWORD: password,
    AIBIZ_MYSQL_ROOT_PASSWORD: mysqlPassword,
  });
  const requests = [];
  const commands = [];
  const dependencies = {
    async fetch(url, request) {
      const data = JSON.parse(request.body);
      requests.push({ path: url.pathname, ...request, data });
      if (url.pathname.endsWith('/v7/login')) {
        if (options.loginThrow) throw new Error(`${password} ${privateBody}`);
        return options.loginResponse?.()
          ?? response(200, { data: { access_token: token }, private: privateBody });
      }
      if (!request.headers.authorization) {
        return options.anonymousResponse?.() ?? response(401, { private: privateBody });
      }
      if (!Object.hasOwn(data, 'pssystemid')) {
        return options.missingResponse?.() ?? response(200, options.missingRows ?? []);
      }
      if (options.explicitThrow) throw new Error(`${token} ${privateBody}`);
      return options.explicitResponse?.() ?? response(200,
        options.apiRows ?? modules.map(row => ({ ...row, private: privateBody, token })), {
          'x-page': '0', 'x-per-page': '100',
          'x-total': String((options.apiRows ?? modules).length),
        });
    },
    async execFile(command, args, settings) {
      commands.push({ command, args, settings });
      if (options.dbThrow) throw new Error(`${mysqlPassword} ${privateBody}`);
      if (options.dbResult) return options.dbResult;
      return {
        stdout: (options.dbRows ?? modules).map(row => JSON.stringify(row)).join('\n')
          + ((options.dbRows ?? modules).length ? '\n' : ''),
        stderr: '',
      };
    },
  };
  return {
    config, requests, commands, dependencies,
    async run(overrides = {}) {
      const code = await runHarness({ ...config, ...overrides }, dependencies);
      const text = await readFile(join(directory, 'report.json'), 'utf8');
      const report = JSON.parse(text);
      assert.equal(report.exitCode, code);
      assert.equal(report.status, code === 0 ? 'pass' : 'fail');
      assert.equal(report.nativeAcceptance, false);
      assert.equal(report.readProjectionVerified, false);
      assert.equal(report.evidence, 'controlled-responses-not-native-evidence');
      assert.equal(report.persistentWrites, false);
      assert.equal(report.summary.skipped, 0);
      assert.match(report.scope, /does not prove isolation, authorization correctness or UI workflows/);
      assert.ok(report.entries[0].checks.every(row => row.required
        && ['pass', 'fail'].includes(row.status)));
      for (const secret of [
        password, mysqlPassword, token, privateBody, systemId,
        ...modules.flatMap(row => [row.psmoduleid, row.psmodulename]),
      ]) assert.ok(!text.includes(secret), 'Reports must not retain private data');
      assert.equal((await stat(join(directory, 'report.json'))).mode & 0o777, 0o600);
      return { code, report, entry: report.entries[0] };
    },
  };
}

function checked(entry, id) {
  return entry.checks.find(row => row.id === id);
}

test('defaults select the requested native app, model system and local MySQL', () => {
  const config = parseArgs([], {});
  assert.equal(config.modeldesignUrl, 'http://127.0.0.1:32009/modeldesign/');
  assert.equal(config.devSlnSysId, '28F7326A-7C72-4C2D-A497-A16372ABBADC');
  assert.equal(config.systemId, systemId);
  assert.equal(config.loginName, 'aibizhi');
  assert.equal(config.password, '123456');
  assert.equal(config.mysqlContainer, 'mysql');
  assert.equal(config.mysqlDatabase, 'scloud9471c1eca');
  assert.equal(config.mysqlUser, 'root');
  assert.equal(config.mysqlPassword, 'Mysql@2022');
  assert.equal(config.timeoutMs, 15000);
});

test('options override safe environment configuration without accepting credentials in argv', () => {
  const config = parseArgs([
    '--required', '--modeldesign-url', 'https://example.test/modeldesign',
    '--pssystemid', systemId.toLowerCase(), '--mysql-container', 'local-db',
    '--mysql-database', 'model_test', '--mysql-user', 'read_only', '--timeout-ms', '500',
  ], {
    AIBIZ_NATIVE_MODELDESIGN_URL: 'http://127.0.0.1:1/modeldesign/',
    AIBIZ_NATIVE_MODEL_MODULES_TIMEOUT_MS: '1000',
    AIBIZ_MYSQL_ROOT_PASSWORD: mysqlPassword,
  });
  assert.equal(config.modeldesignUrl, 'https://example.test/modeldesign/');
  assert.equal(config.systemId, systemId);
  assert.equal(config.mysqlContainer, 'local-db');
  assert.equal(config.mysqlDatabase, 'model_test');
  assert.equal(config.mysqlUser, 'read_only');
  assert.equal(config.timeoutMs, 500);
  assert.equal(config.mysqlPassword, mysqlPassword);
  for (const option of ['--token', '--password', '--mysql-password', '--sql', '--skip', '--mode']) {
    assert.throws(() => parseArgs([option, 'private'], {}), /required/);
  }
});

test('URL, SQL, command and identifier injection are rejected before execution', () => {
  for (const url of [
    'file:///modeldesign/', 'http://name:password@example.test/modeldesign/',
    'http://example.test/modeldesign/?token=secret', 'http://example.test/modeldesign/#secret',
    'http://example.test/modeldesign/\n', 'http://example.test\\modeldesign/',
    'http://example.test/%6dodeldesign/', 'http://example.test/other/',
  ]) assert.throws(() => parseArgs(['--modeldesign-url', url], {}), /URL/);
  for (const option of ['--psdevslnsys', '--pssystemid']) {
    for (const value of ["x' OR 1=1 --", '../other', `${systemId}/other`, 'not-a-uuid']) {
      assert.throws(() => parseArgs([option, value], {}), /identifier/);
    }
  }
  for (const option of ['--mysql-container', '--mysql-database', '--mysql-user']) {
    for (const value of ['x; DROP TABLE x', '`x`', 'x$(id)', '../x']) {
      assert.throws(() => parseArgs([option, value], {}), /identifier/);
    }
  }
  for (const value of ['0', '-1', 'NaN', 'Infinity', '1.5', '120001']) {
    assert.throws(() => parseArgs(['--timeout-ms', value], {}));
  }
  assert.throws(() => parseArgs(['--report-dir'], {}), /requires/);
  assert.throws(() => parseArgs([], { AIBIZ_PASSWORD: '' }), /credentials/);
});

test('invalid direct configurations produce a failed report without HTTP or Docker', async t => {
  const f = await fixture(t);
  const { code, entry } = await f.run({ systemId: `${systemId}' OR 1=1 --` });
  assert.equal(code, 1);
  assert.equal(checked(entry, 'input-validation').status, 'fail');
  assert.equal(f.requests.length, 0);
  assert.equal(f.commands.length, 0);
});

test('controlled full-set matching is order-independent and never counts as native acceptance', async t => {
  const f = await fixture(t, { dbRows: [...modules].reverse() });
  const { code, entry } = await f.run();
  assert.equal(code, 0);
  assert.ok(entry.checks.every(row => row.status === 'pass'));
  assert.equal(entry.statistics.api.count, 2);
  assert.equal(entry.statistics.api.uniqueIds, 2);
  assert.equal(entry.statistics.api.projectionSha256, entry.statistics.database.projectionSha256);
  assert.match(entry.statistics.api.identitySha256, /^[0-9a-f]{64}$/);
  assert.equal(entry.observations[0].status, 'observed');
  assert.equal(entry.observations[0].acceptanceEvidence, false);
  assert.equal(entry.observations[0].statistics.count, 0);
  assert.ok(!entry.checks.some(row => row.id.includes('without-model-root')));
  assert.equal(f.requests.length, 4);
  const reads = f.requests.filter(row => row.headers.authorization);
  assert.deepEqual(reads.map(row => row.data), [
    { size: 100 }, { pssystemid: systemId, size: 100 },
  ]);
  assert.ok(f.requests.every(row => row.method === 'POST' && row.redirect === 'manual'));
  assert.ok(f.requests.every(row => row.path.endsWith('/v7/login')
    || row.path.endsWith('/psmodules/fetchcursys')));
  assert.ok(f.requests.filter(row => !row.path.endsWith('/v7/login')).every(row =>
    row.path === '/api/ibizmodeling__modeldesign/psdevslnsys/'
      + '28F7326A-7C72-4C2D-A497-A16372ABBADC/psmodules/fetchcursys'));
  const command = f.commands[0];
  assert.equal(command.command, 'docker');
  assert.deepEqual(command.args.slice(0, 6), ['exec', '-e', 'MYSQL_PWD', 'mysql', 'mysql', '--batch']);
  assert.ok(command.args.includes('--raw'));
  assert.ok(command.args.includes('--skip-column-names'));
  assert.ok(command.args.includes('--default-character-set=utf8mb4'));
  assert.equal(command.settings.env.MYSQL_PWD, mysqlPassword);
  assert.equal(command.settings.timeout, f.config.timeoutMs);
  assert.equal(command.settings.shell, undefined);
  assert.ok(!command.args.join(' ').includes(mysqlPassword));
  const sql = command.args.at(-1);
  assert.match(sql, /^SELECT JSON_OBJECT\('psmoduleid',PSMODULEID,/);
  assert.match(sql, new RegExp(`WHERE PSSYSTEMID='${systemId}' ORDER BY PSMODULEID$`));
  assert.doesNotMatch(sql, /\b(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP|GRANT)\b|;/i);
});

test('inherited controlled transports cannot be classified as native evidence', async t => {
  const f = await fixture(t);
  const transports = { ...f.dependencies };
  delete f.dependencies.fetch;
  delete f.dependencies.execFile;
  Object.setPrototypeOf(f.dependencies, transports);
  const { code, report } = await f.run();
  assert.equal(code, 0);
  assert.equal(report.evidence, 'controlled-responses-not-native-evidence');
  assert.equal(report.readProjectionVerified, false);
});

test('UTF-8 and nullable module names match exactly without entering the report', async t => {
  const privateName = '\u4e2d\u6587\u6a21\u5757\ud83d\udd12\n\t"\\';
  const rows = [
    { ...modules[0], psmodulename: privateName },
    { ...modules[1], psmodulename: null },
  ];
  const f = await fixture(t, { apiRows: rows, dbRows: [...rows].reverse() });
  const { code, report, entry } = await f.run();
  assert.equal(code, 0);
  assert.equal(checked(entry, 'modules-exact-db-projection').status, 'pass');
  assert.ok(!JSON.stringify(report).includes(JSON.stringify(privateName).slice(1, -1)));
});

test('a populated missing-context observation cannot rescue an empty explicit request', async t => {
  const f = await fixture(t, { missingRows: modules, apiRows: [] });
  const { code, entry } = await f.run();
  assert.equal(code, 1);
  assert.equal(entry.observations[0].status, 'observed');
  assert.equal(entry.observations[0].statistics.count, modules.length);
  assert.equal(checked(entry, 'modules-explicit-nonempty').status, 'fail');
  assert.equal(checked(entry, 'modules-exact-db-projection').status, 'fail');
});

test('a valid rejected missing-context request remains an observation, not a passing check', async t => {
  const f = await fixture(t, { missingResponse: () => response(400, { private: privateBody }) });
  const { code, entry } = await f.run();
  assert.equal(code, 0);
  assert.equal(entry.observations[0].status, 'observed');
  assert.equal(entry.observations[0].response.httpStatus, 400);
  assert.equal(entry.observations[0].acceptanceEvidence, false);
});

test('equal counts with different module identities or names fail exact projection matching', async t => {
  for (const apiRows of [
    [modules[0], { ...modules[1], psmoduleid: 'different-module' }],
    [modules[0], { ...modules[1], psmodulename: 'different-name' }],
  ]) {
    const f = await fixture(t, { apiRows });
    const { code, entry } = await f.run();
    assert.equal(code, 1);
    assert.equal(entry.statistics.api.count, entry.statistics.database.count);
    assert.equal(checked(entry, 'modules-exact-db-projection').status, 'fail');
  }
});

test('duplicates fail even when both API and DB provide the same duplicated projection', async t => {
  const repeated = [modules[0], modules[0]];
  const f = await fixture(t, { apiRows: repeated, dbRows: repeated });
  const { code, entry } = await f.run();
  assert.equal(code, 1);
  assert.equal(checked(entry, 'modules-exact-db-projection').status, 'pass');
  assert.equal(checked(entry, 'modules-explicit-unique').status, 'fail');
  assert.equal(checked(entry, 'mysql-reference-unique').status, 'fail');
});

test('empty equal projections are not real read evidence', async t => {
  const f = await fixture(t, { apiRows: [], dbRows: [] });
  const { code, entry } = await f.run();
  assert.equal(code, 1);
  assert.equal(checked(entry, 'modules-explicit-nonempty').status, 'fail');
  assert.equal(checked(entry, 'mysql-reference-nonempty').status, 'fail');
});

test('wrong-system rows fail even when their complete DB and API projections agree', async t => {
  const wrong = modules.map(row => ({ ...row, pssystemid: '00000000-0000-0000-0000-000000000000' }));
  const f = await fixture(t, { apiRows: wrong, dbRows: wrong });
  const { code, entry } = await f.run();
  assert.equal(code, 1);
  assert.equal(checked(entry, 'modules-system-identity').status, 'fail');
});

test('entity-specific fields are mandatory; generic identity and envelopes are not accepted', async t => {
  for (const explicitResponse of [
    () => response(200, [{ id: 'generic-module', name: 'generic-name', pssystemid: systemId }]),
    () => response(200, { data: modules }),
    () => response(200, null),
    () => response(200, [{ ...modules[0], psmoduleid: 42 }]),
    () => response(200),
  ]) {
    const f = await fixture(t, { explicitResponse });
    const { code, entry } = await f.run();
    assert.equal(code, 1);
    assert.equal(checked(entry, 'modules-explicit-fetch').status, 'fail');
  }
});

test('pagination cannot hide a truncated or unexpected page', async t => {
  for (const headers of [
    { 'x-total': '3' }, { 'x-page': '1' }, { 'x-per-page': '20' }, { 'x-total': 'NaN' },
  ]) {
    const f = await fixture(t, { explicitResponse: () => response(200, modules, headers) });
    const { code, entry } = await f.run();
    assert.equal(code, 1);
    assert.equal(checked(entry, 'modules-pagination-complete').status, 'fail');
  }
});

test('valid matching projection without pagination headers still compares the complete DB set', async t => {
  const f = await fixture(t, { explicitResponse: () => response(200, modules) });
  assert.equal((await f.run()).code, 0);
});

test('more than 100 matching modules cannot bypass the fixed-size pagination gate', async t => {
  const rows = Array.from({ length: 101 }, (_, index) => ({
    ...modules[0], psmoduleid: `module-${index}`,
  }));
  const f = await fixture(t, { apiRows: rows, dbRows: rows });
  const { code, entry } = await f.run();
  assert.equal(code, 1);
  assert.equal(checked(entry, 'modules-exact-db-projection').status, 'pass');
  assert.equal(checked(entry, 'modules-pagination-complete').status, 'fail');
});

test('absent pagination headers cannot hide a module missing from the DB reference', async t => {
  const f = await fixture(t, { explicitResponse: () => response(200, [modules[0]]) });
  const { code, entry } = await f.run();
  assert.equal(code, 1);
  assert.equal(checked(entry, 'modules-pagination-complete').status, 'pass');
  assert.equal(checked(entry, 'modules-exact-db-projection').status, 'fail');
});

test('anonymous fetch must be 401, not a successful empty stub or redirect', async t => {
  for (const anonymousResponse of [
    () => response(200, []),
    () => response(302, { private: privateBody }, { location: '/private-redirect-target' }),
  ]) {
    const f = await fixture(t, { anonymousResponse });
    const { code, entry } = await f.run();
    assert.equal(code, 1);
    assert.equal(checked(entry, 'modules-anonymous-denied').status, 'fail');
  }
});

test('invalid JSON and unexpected media types always produce failure reports', async t => {
  for (const explicitResponse of [
    () => new Response(`${privateBody} ${token}`, { headers: { 'content-type': 'application/json' } }),
    () => new Response(JSON.stringify(modules), { headers: { 'content-type': 'text/html' } }),
  ]) {
    const f = await fixture(t, { explicitResponse });
    const { code, entry } = await f.run();
    assert.equal(code, 1);
    assert.equal(checked(entry, 'execution-integrity').status, 'fail');
  }
  const f = await fixture(t, {
    anonymousResponse: () => new Response(privateBody, {
      status: 401, headers: { 'content-type': 'application/json' },
    }),
  });
  assert.equal((await f.run()).code, 1);
});

test('missing-context parsing errors cannot disappear behind successful explicit evidence', async t => {
  const f = await fixture(t, {
    missingResponse: () => new Response(privateBody, { headers: { 'content-type': 'application/json' } }),
  });
  const { code, entry } = await f.run();
  assert.equal(code, 1);
  assert.equal(entry.observations[0].status, 'fail');
  assert.equal(checked(entry, 'modules-exact-db-projection').status, 'pass');
  assert.equal(checked(entry, 'execution-integrity').status, 'fail');
});

test('DB failures, malformed rows, stderr and extra output fail without retaining diagnostics', async t => {
  for (const options of [
    { dbThrow: true },
    { dbResult: { stdout: `${privateBody}\n`, stderr: '' } },
    { dbResult: { stdout: `${JSON.stringify(modules[0])}\n\n`, stderr: '' } },
    { dbResult: { stdout: `${JSON.stringify(modules[0])}\n`, stderr: mysqlPassword } },
    { dbResult: { stdout: JSON.stringify(modules[0]), stderr: '', exitCode: 1 } },
    { dbRows: [{ id: 'generic-module', pssystemid: systemId }] },
  ]) {
    const f = await fixture(t, options);
    const { code, entry } = await f.run();
    assert.equal(code, 1);
    assert.equal(checked(entry, 'mysql-reference-read').status, 'fail');
    assert.equal(checked(entry, 'execution-integrity').status, 'fail');
  }
});

test('rejected native login tokens are neither trusted nor reported', async t => {
  const f = await fixture(t, { loginResponse: () => response(401, { token, private: privateBody }) });
  const { code, entry } = await f.run();
  assert.equal(code, 1);
  assert.equal(checked(entry, 'native-login').status, 'fail');
  assert.equal(checked(entry, 'modules-explicit-fetch').status, 'fail');
  assert.ok(f.requests.every(row => !row.headers.authorization));
  assert.equal(entry.observations[0].status, 'fail');
});

test('HTTP transport exceptions become redacted failed checks rather than skipped evidence', async t => {
  for (const options of [{ loginThrow: true }, { explicitThrow: true }]) {
    const f = await fixture(t, options);
    const { code, entry } = await f.run();
    assert.equal(code, 1);
    assert.equal(checked(entry, 'execution-integrity').status, 'fail');
  }
});

test('HTTP timeout includes body reads even if a controlled response ignores abort', async t => {
  const f = await fixture(t, {
    explicitResponse: () => ({
      status: 200, headers: new Headers({ 'content-type': 'application/json' }),
      text: () => new Promise(() => {}),
    }),
  });
  const { code, entry } = await f.run({ timeoutMs: 30 });
  assert.equal(code, 1);
  assert.equal(checked(entry, 'modules-explicit-fetch').response.error, 'timeout');
});

test('database deadline also covers a stalled controlled executor', async t => {
  const f = await fixture(t);
  f.dependencies.execFile = () => new Promise(() => {});
  const { code, entry } = await f.run({ timeoutMs: 30 });
  assert.equal(code, 1);
  assert.equal(checked(entry, 'mysql-reference-read').error, 'database-timeout');
});

test('actual fetch does not follow redirects or leak the login body to the target', async t => {
  const f = await fixture(t);
  const paths = [];
  const server = createServer((request, reply) => {
    paths.push(request.url);
    reply.writeHead(307, {
      location: '/must-not-follow', 'content-type': 'application/json',
    });
    reply.end(JSON.stringify({ private: privateBody }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  f.dependencies.fetch = globalThis.fetch;
  const { code, entry } = await f.run({
    modeldesignUrl: `http://127.0.0.1:${server.address().port}/modeldesign/`,
  });
  assert.equal(code, 1);
  assert.equal(checked(entry, 'native-login').response.httpStatus, 307);
  assert.equal(paths.length, 2);
  assert.ok(!paths.includes('/must-not-follow'));
});
