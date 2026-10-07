import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import test from 'node:test';
import { parseArgs, runHarness } from '../harness-native-platform-api.mjs';

const script = fileURLToPath(new URL('../harness-native-platform-api.mjs', import.meta.url));
const runNode = promisify(execFile);
const password = 'private-fixture-password';
const existingTheme = { themeVars: { color: 'do-not-change' } };
const anonymousPrivateValue = 'private-anonymous-config-contents';
const anonymousResponseToken = 'private-anonymous-response-token';

async function fixture(t, options = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'native-platform-api-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const requests = [];
  const sessions = new Map();
  const values = new Map();
  const originals = new Map();
  const sessionConfigs = new Map();
  const realThemePath = '/configs/customtheme/ibizmodeling__central_light_theme_config';
  values.set(realThemePath, existingTheme);
  const counts = new Map();
  const server = createServer(async (request, response) => {
    let raw = '';
    for await (const chunk of request) raw += chunk;
    const url = new URL(request.url, 'http://fixture');
    const app = url.pathname.includes('__central/') ? 'Central' : 'ModelDesign';
    const path = url.pathname.replace(/^\/api\/ibizmodeling__(central|modeldesign)/, '');
    const data = raw ? JSON.parse(raw) : undefined;
    const row = { app, path, method: request.method, data, authorization: request.headers.authorization };
    requests.push(row);
    const send = (status, value, headers = {}) => {
      response.writeHead(status, { 'content-type': 'application/json', ...headers });
      response.end(value === undefined ? '' : JSON.stringify(value));
    };
    if (path === '/v7/login') {
      const count = (counts.get(app) ?? 0) + 1;
      counts.set(app, count);
      if ((options.loginFailure && count === 1) || (options.reloginFailure && count === 2)) {
        send(options.loginFailure ?? 401, { token: 'must-not-leak-rejected-token' });
        return;
      }
      if (options.loginEmpty) { send(200); return; }
      if (options.loginNoToken) { send(200, {}); return; }
      const token = `private-${app}-token-${count}`;
      sessions.set(`Bearer ${token}`, app);
      send(200, options.nestedToken ? { data: { access_token: token } } : { token });
      return;
    }
    if (path.startsWith('/configs/customtheme/native_platform_harness_anonymous_')
      && url.search === '?share=false') {
      if (!originals.has(path)) {
        originals.set(path, options.anonymousConfigOriginal ?? null);
        if (options.anonymousConfigOriginal) values.set(path, options.anonymousConfigOriginal);
      }
      if (!sessions.has(request.headers.authorization)) {
        const status = request.method === 'GET'
          ? options.anonymousConfigGetStatus ?? 401 : options.anonymousConfigPutStatus ?? 401;
        if (request.method === 'PUT' && (status !== 401 || options.anonymousConfigPutTimeout
          || options.anonymousConfigPutPersistsOn401)) {
          if (!options.anonymousConfigPutDoesNothing) values.set(path, data);
          if (options.anonymousConfigPutTimeout) return;
        }
        send(status, status === 401 ? undefined : {
          ...data, privateValue: anonymousPrivateValue, token: anonymousResponseToken,
        }, status === 302 ? { location: '/anonymous-config-success' } : {});
        return;
      }
      const cleanupRequests = requests.filter(row => row.path === path
        && row.method === 'PUT' && row.authorization);
      if (request.method === 'GET') {
        const verifyingState = cleanupRequests.length === 0 && requests.some(row => row.path === path
          && row.method === 'PUT' && !row.authorization);
        if (verifyingState && options.anonymousConfigStateTimeout) {
          return;
        }
        if (verifyingState && options.anonymousConfigStateFailure) {
          send(500, { privateValue: anonymousPrivateValue, token: anonymousResponseToken });
        } else if (options.anonymousConfigBaselineFailure && cleanupRequests.length === 0) {
          send(500, {});
        } else if (options.anonymousConfigCleanupReadMismatch && cleanupRequests.length > 0) {
          send(200, { privateValue: anonymousPrivateValue });
        } else {
          send(200, values.get(path));
        }
        return;
      }
      if (request.method !== 'PUT') { send(405, {}); return; }
      if (options.anonymousConfigCleanupFailure
        || (options.anonymousConfigCleanupFailOnce && cleanupRequests.length === 1)) {
        send(500, false);
        return;
      }
      if (data === null) values.delete(path);
      else values.set(path, data);
      send(200, true);
      return;
    }
    if (!sessions.has(request.headers.authorization)) {
      if (options.anonymousStub) send(200, []);
      else send(401);
      return;
    }
    if (path === '/extension/internal_messages/fetch_cur_receiver') {
      if (options.messageTimeout) return;
      if (options.messageRedirect) { send(302, [], { location: '/success' }); return; }
      const payload = Object.hasOwn(options, 'messageBody') ? options.messageBody : [];
      const headers = options.noPagination ? {} : {
        'x-page': options.page ?? '0', 'x-per-page': '20', 'x-total': options.total ?? '0',
      };
      if (options.messageHtml) {
        response.writeHead(200, { 'content-type': 'text/html', ...headers });
        response.end('<html>not an API response</html>');
      } else if (options.messageInvalidJson) {
        response.writeHead(200, { 'content-type': 'application/json', ...headers });
        response.end('not-json');
      } else {
        send(options.messageStatus ?? 200, payload, headers);
      }
      return;
    }
    if (!path.startsWith('/configs/customtheme/native_platform_harness_')
      || url.search !== '?share=false') { send(404, {}); return; }
    if (!originals.has(path)) {
      originals.set(path, options.original ?? null);
      if (options.original) values.set(path, options.original);
    }
    const saved = requests.some(row => row.path === path && row.method === 'PUT' && row.data !== null);
    if (request.method === 'GET') {
      if (options.baselineFailure && !saved) { send(500, {}); return; }
      let value = values.get(path);
      if (options.sessionConfigCache) {
        const cacheKey = `${request.headers.authorization}:${path}`;
        if (!sessionConfigs.has(cacheKey)) sessionConfigs.set(cacheKey, value);
        value = sessionConfigs.get(cacheKey);
      }
      if (options.readMismatch && saved && value !== undefined) {
        send(200, { wrong: true });
      } else if (options.resetObjectStub && saved && value === undefined) {
        send(200, {});
      } else if (options.nullBody && value === undefined) {
        send(200, null);
      } else {
        send(200, value);
      }
      return;
    }
    if (request.method !== 'PUT') { send(405, {}); return; }
    const nullCount = requests.filter(row => row.path === path && row.method === 'PUT' && row.data === null).length;
    if (data === null) {
      if (!options.resetDoesNothing) values.delete(path);
      if (options.cleanupFailure && nullCount > 1) { send(500, false); return; }
      if (options.resetFailure && nullCount === 1) { send(500, false); return; }
    } else {
      values.set(path, data);
      if (options.putTimeout && !data.original) return;
      if (options.putFailure && !data.original) { send(500, false); return; }
      if (options.putEmpty && !data.original) { send(200); return; }
      if (options.putFalse && !data.original) { send(200, false); return; }
    }
    send(200, true);
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const config = parseArgs([
    '--central-url', `${base}/central/`, '--modeldesign-url', `${base}/modeldesign/`,
    '--report-dir', directory,
  ], { AIBIZ_LOGINNAME: 'fixture-user', AIBIZ_PASSWORD: password });
  return {
    requests, values, originals, counts, config, base,
    async run() {
      const code = await runHarness(config);
      const report = JSON.parse(await readFile(join(directory, 'report.json'), 'utf8'));
      assert.equal(report.exitCode, code);
      assert.equal(report.status, code === 0 ? 'pass' : 'fail');
      assert.equal(values.get(realThemePath), existingTheme);
      const text = JSON.stringify(report);
      assert.ok(!text.includes(password));
      assert.ok(!text.includes('private-Central-token'));
      assert.ok(!text.includes('private-ModelDesign-token'));
      assert.ok(!text.includes('must-not-leak-rejected-token'));
      assert.ok(!text.includes(anonymousPrivateValue));
      assert.ok(!text.includes(anonymousResponseToken));
      for (const request of requests) {
        if (request.data?.marker) assert.ok(!text.includes(request.data.marker));
      }
      assert.ok(report.entries.flatMap(entry => entry.checks)
        .every(check => check.required && ['pass', 'fail'].includes(check.status)));
      return { code, report };
    },
  };
}

test('defaults target both native entries and expose no token or skip option', () => {
  const config = parseArgs([], {});
  assert.equal(config.centralUrl, 'http://127.0.0.1:32006/central/');
  assert.equal(config.modeldesignUrl, 'http://127.0.0.1:32007/modeldesign/');
  assert.equal(config.timeoutMs, 15000);
  assert.throws(() => parseArgs(['--mode', 'off'], {}), /required/);
  assert.throws(() => parseArgs(['--token', 'secret'], {}), /required/);
  assert.throws(() => parseArgs(['--tag', 'light_theme_config'], {}), /required/);
});

test('options and environment configure entries, timeout and artifact location', () => {
  const config = parseArgs(['--required', '--timeout-ms', '1000'], {
    AIBIZ_NATIVE_CENTRAL_URL: 'http://127.0.0.1:123/central/',
    AIBIZ_NATIVE_MODELDESIGN_URL: 'http://127.0.0.1:124/modeldesign/',
    AIBIZ_NATIVE_PLATFORM_REPORT_DIR: '/tmp/native-test',
    AIBIZ_LOGINNAME: 'fixture-user', AIBIZ_PASSWORD: password,
  });
  assert.equal(config.loginName, 'fixture-user');
  assert.equal(config.password, password);
  assert.equal(config.timeoutMs, 1000);
  assert.equal(config.reportDir, '/tmp/native-test');
  assert.equal(new URL(config.centralUrl).port, '123');
  assert.equal(new URL(config.modeldesignUrl).port, '124');
});

for (const argv of [
  ['--central-url'], ['--report-dir'], ['--timeout-ms', '0'],
  ['--timeout-ms', 'NaN'], ['--timeout-ms', '1.5'],
  ['--central-url', 'file:///tmp/central'],
  ['--central-url', 'http://user:secret@127.0.0.1/central/'],
  ['--modeldesign-url', 'http://127.0.0.1/modeldesign/?token=secret'],
]) {
  test(`invalid argument contract: ${argv[0]} ${argv[1] ?? '(missing)'}`, () => {
    assert.throws(() => parseArgs(argv, {}));
  });
}

test('both native entries perform authenticated message fetch and a new-session config roundtrip', async t => {
  const fixtureData = await fixture(t);
  const { code, report } = await fixtureData.run();
  assert.equal(code, 0);
  assert.equal(report.summary.failed, 0);
  assert.equal(report.entries.length, 2);
  for (const entry of report.entries) {
    assert.equal(entry.authentication, 'native-v7-login');
    assert.equal(entry.cleanup.status, 'pass');
    assert.deepEqual(entry.anonymousCleanup, {
      needed: false, attempted: false, restoredExisting: false, status: 'not-needed',
    });
    assert.match(entry.tag, /^native_platform_harness_(central|modeldesign)_[a-f0-9-]{36}$/);
    assert.match(entry.anonymousTag,
      /^native_platform_harness_anonymous_(central|modeldesign)_[a-f0-9-]{36}$/);
    assert.notEqual(entry.anonymousTag, entry.tag);
    const requests = fixtureData.requests.filter(row => row.app === entry.app);
    const logins = requests.filter(row => row.path === '/v7/login');
    assert.equal(logins.length, 2);
    assert.ok(logins.every(row => row.method === 'POST'
      && row.data.loginname === 'fixture-user' && row.data.password === password));
    const messages = requests.filter(row => row.path.includes('/internal_messages/'));
    assert.equal(messages.length, 2);
    assert.equal(messages[0].authorization, undefined);
    assert.equal(messages[1].authorization, `Bearer private-${entry.app}-token-1`);
    assert.deepEqual(messages[1].data, { page: 0, size: 20, sort: 'timestamp,desc' });
    const anonymousConfigs = requests.filter(row => row.path.endsWith(entry.anonymousTag));
    assert.deepEqual(anonymousConfigs.map(row => row.method), ['GET', 'GET', 'PUT', 'GET']);
    assert.deepEqual(anonymousConfigs.map(row => row.authorization),
      [undefined, `Bearer private-${entry.app}-token-1`, undefined, `Bearer private-${entry.app}-token-1`]);
    assert.ok(!fixtureData.values.has(anonymousConfigs[0].path));
    for (const id of ['configs-anonymous-get-denied', 'configs-anonymous-put-denied']) {
      const check = entry.checks.find(row => row.id === id);
      assert.equal(check.status, 'pass');
      assert.equal(check.response.httpStatus, 401);
      assert.equal(check.request.session, 'anonymous');
    }
    const preserved = entry.checks.find(row => row.id === 'configs-anonymous-state-preserved');
    assert.equal(preserved.required, true);
    assert.equal(preserved.status, 'pass');
    assert.equal(preserved.response.httpStatus, 200);
    assert.equal(preserved.request.method, 'GET');
    assert.equal(preserved.request.session, 'initial');
    assert.ok(!entry.checks.some(row => row.id.startsWith('configs-anonymous-cleanup')));
    const configs = requests.filter(row => row.path.endsWith(entry.tag));
    assert.deepEqual(configs.map(row => row.method),
      ['GET', 'PUT', 'GET', 'GET', 'PUT', 'GET', 'GET', 'PUT', 'GET', 'GET', 'PUT', 'GET']);
    assert.equal(configs[2].authorization, `Bearer private-${entry.app}-token-1`);
    assert.equal(configs[3].authorization, `Bearer private-${entry.app}-token-2`);
    assert.equal(configs[4].data.values.revision, 2);
    assert.equal(configs[5].authorization, `Bearer private-${entry.app}-token-1`);
    assert.equal(configs[6].authorization, `Bearer private-${entry.app}-token-2`);
    assert.equal(configs[7].data, null);
    assert.equal(configs[9].authorization, `Bearer private-${entry.app}-token-1`);
    assert.equal(configs[10].data, null);
    assert.ok(configs.every(row => row.path.endsWith(entry.tag)));
    assert.equal(fixtureData.values.has(configs[0].path), false);
    assert.ok(entry.checks.every(row => row.status === 'pass'));
  }
  assert.notEqual(report.entries[0].tag, report.entries[1].tag);
  assert.notEqual(report.entries[0].anonymousTag, report.entries[1].anonymousTag);
});

for (const status of [200, 204, 302, 403, 404, 500]) {
  test(`anonymous configuration GET returning ${status} fails without disrupting authenticated roundtrips`, async t => {
    const fixtureData = await fixture(t, { anonymousConfigGetStatus: status });
    const { code, report } = await fixtureData.run();
    assert.equal(code, 1);
    for (const entry of report.entries) {
      const check = entry.checks.find(row => row.id === 'configs-anonymous-get-denied');
      assert.equal(check.status, 'fail');
      assert.equal(check.response.httpStatus, status);
      assert.equal(entry.checks.find(row => row.id === 'configs-anonymous-put-denied').status, 'pass');
      assert.equal(entry.checks.find(row => row.id === 'configs-anonymous-state-preserved').status, 'pass');
      assert.equal(entry.checks.find(row => row.id === 'configs-roundtrip').status, 'pass');
      assert.equal(entry.anonymousCleanup.status, 'not-needed');
      assert.equal(entry.cleanup.status, 'pass');
    }
    assert.ok(!fixtureData.requests.some(row => row.path === '/anonymous-config-success'));
  });
}

for (const status of [200, 204, 302, 403, 404, 500]) {
  test(`anonymous configuration PUT returning ${status} fails and is cleaned up with an authenticated session`, async t => {
    const fixtureData = await fixture(t, { anonymousConfigPutStatus: status });
    const { code, report } = await fixtureData.run();
    assert.equal(code, 1);
    for (const entry of report.entries) {
      const check = entry.checks.find(row => row.id === 'configs-anonymous-put-denied');
      assert.equal(check.status, 'fail');
      assert.equal(check.response.httpStatus, status);
      assert.equal(entry.checks.find(row => row.id === 'configs-anonymous-state-preserved').status, 'fail');
      assert.deepEqual(entry.anonymousCleanup, {
        needed: true, attempted: true, restoredExisting: false, status: 'pass',
      });
      const anonymousRequests = fixtureData.requests.filter(row => row.path.endsWith(entry.anonymousTag));
      assert.deepEqual(anonymousRequests.map(row => row.method), ['GET', 'GET', 'PUT', 'GET', 'PUT', 'GET']);
      assert.equal(anonymousRequests[2].authorization, undefined);
      assert.equal(anonymousRequests[3].authorization, `Bearer private-${entry.app}-token-1`);
      assert.equal(anonymousRequests[4].data, null);
      assert.equal(anonymousRequests[4].authorization, anonymousRequests[3].authorization);
      assert.equal(anonymousRequests[5].authorization, anonymousRequests[4].authorization);
      assert.equal(fixtureData.values.has(anonymousRequests[0].path), false);
      assert.equal(entry.checks.find(row => row.id === 'configs-anonymous-cleanup-put-1').status, 'pass');
      assert.equal(entry.checks.find(row => row.id === 'configs-anonymous-cleanup-get-1').status, 'pass');
      assert.equal(entry.checks.find(row => row.id === 'configs-roundtrip').status, 'pass');
      assert.equal(entry.cleanup.status, 'pass');
    }
    assert.ok(!fixtureData.requests.some(row => row.path === '/anonymous-config-success'));
  });
}

for (const original of [null, { original: true, privateValue: 'private-anonymous-401-original' }]) {
  test(`an anonymous PUT that persists but responds 401 fails state preservation and is restored (${original ? 'restore' : 'reset'})`, async t => {
    const fixtureData = await fixture(t, {
      anonymousConfigPutPersistsOn401: true, anonymousConfigOriginal: original,
    });
    const { code, report } = await fixtureData.run();
    assert.equal(code, 1);
    assert.equal(report.summary.failed, 2);
    for (const entry of report.entries) {
      const denied = entry.checks.find(row => row.id === 'configs-anonymous-put-denied');
      assert.equal(denied.status, 'pass');
      assert.equal(denied.response.httpStatus, 401);
      const preserved = entry.checks.find(row => row.id === 'configs-anonymous-state-preserved');
      assert.equal(preserved.required, true);
      assert.equal(preserved.status, 'fail');
      assert.equal(preserved.response.httpStatus, 200);
      assert.deepEqual(entry.anonymousCleanup, {
        needed: true, attempted: true, restoredExisting: original !== null, status: 'pass',
      });
      const anonymousRequests = fixtureData.requests.filter(row => row.path.endsWith(entry.anonymousTag));
      assert.deepEqual(anonymousRequests.map(row => row.method), ['GET', 'GET', 'PUT', 'GET', 'PUT', 'GET']);
      assert.equal(anonymousRequests[2].authorization, undefined);
      assert.ok(anonymousRequests.slice(3).every(row => row.authorization === `Bearer private-${entry.app}-token-1`));
      assert.deepEqual(anonymousRequests[4].data, original);
      assert.equal(entry.checks.find(row => row.id === 'configs-anonymous-cleanup-put-1').status, 'pass');
      assert.equal(entry.checks.find(row => row.id === 'configs-anonymous-cleanup-get-1').status, 'pass');
      const path = `/configs/customtheme/${entry.anonymousTag}`;
      if (original) assert.deepEqual(fixtureData.values.get(path), original);
      else assert.equal(fixtureData.values.has(path), false);
      assert.equal(entry.checks.find(row => row.id === 'configs-roundtrip').status, 'pass');
      assert.equal(entry.cleanup.status, 'pass');
    }
    if (original) assert.ok(!JSON.stringify(report).includes(original.privateValue));
  });
}

for (const [name, options] of [
  ['failed', { anonymousConfigStateFailure: true }],
  ['timed out', { anonymousConfigStateTimeout: true }],
]) {
  for (const original of [null, { original: true, privateValue: 'private-anonymous-unreadable-original' }]) {
    test(`a ${name} state read after anonymous PUT fails and still verifies cleanup (${original ? 'restore' : 'reset'})`, async t => {
      const fixtureData = await fixture(t, {
        ...options, anonymousConfigOriginal: original, anonymousConfigPutPersistsOn401: true,
      });
      if (options.anonymousConfigStateTimeout) fixtureData.config.timeoutMs = 100;
      const { code, report } = await fixtureData.run();
      assert.equal(code, 1);
      assert.equal(report.summary.failed, 2);
      for (const entry of report.entries) {
        assert.equal(entry.checks.find(row => row.id === 'configs-anonymous-put-denied').status, 'pass');
        const preserved = entry.checks.find(row => row.id === 'configs-anonymous-state-preserved');
        assert.equal(preserved.status, 'fail');
        if (options.anonymousConfigStateTimeout) assert.equal(preserved.response.error, 'timeout');
        else assert.equal(preserved.response.httpStatus, 500);
        assert.deepEqual(entry.anonymousCleanup, {
          needed: true, attempted: true, restoredExisting: original !== null, status: 'pass',
        });
        const cleanupRequests = fixtureData.requests.filter(row => row.path.endsWith(entry.anonymousTag)
          && row.method === 'PUT' && row.authorization);
        assert.equal(cleanupRequests.length, 1);
        assert.equal(cleanupRequests[0].authorization, `Bearer private-${entry.app}-token-1`);
        assert.deepEqual(cleanupRequests[0].data, original);
        assert.equal(entry.checks.find(row => row.id === 'configs-anonymous-cleanup-get-1').status, 'pass');
        const path = `/configs/customtheme/${entry.anonymousTag}`;
        if (original) assert.deepEqual(fixtureData.values.get(path), original);
        else assert.equal(fixtureData.values.has(path), false);
        assert.equal(entry.checks.find(row => row.id === 'configs-roundtrip').status, 'pass');
      }
      if (original) assert.ok(!JSON.stringify(report).includes(original.privateValue));
    });
  }
}

test('an unreadable state after a genuinely denied anonymous PUT still requires verified cleanup', async t => {
  const fixtureData = await fixture(t, { anonymousConfigStateFailure: true });
  const { code, report } = await fixtureData.run();
  assert.equal(code, 1);
  for (const entry of report.entries) {
    assert.equal(entry.checks.find(row => row.id === 'configs-anonymous-put-denied').status, 'pass');
    assert.equal(entry.checks.find(row => row.id === 'configs-anonymous-state-preserved').status, 'fail');
    assert.equal(entry.anonymousCleanup.status, 'pass');
    assert.equal(entry.checks.find(row => row.id === 'configs-anonymous-cleanup-get-1').status, 'pass');
    assert.equal(fixtureData.values.has(`/configs/customtheme/${entry.anonymousTag}`), false);
  }
});

test('a non-401 anonymous PUT requires cleanup even when the state read matches the baseline', async t => {
  const fixtureData = await fixture(t, { anonymousConfigPutStatus: 200, anonymousConfigPutDoesNothing: true });
  const { code, report } = await fixtureData.run();
  assert.equal(code, 1);
  for (const entry of report.entries) {
    assert.equal(entry.checks.find(row => row.id === 'configs-anonymous-put-denied').status, 'fail');
    assert.equal(entry.checks.find(row => row.id === 'configs-anonymous-state-preserved').status, 'pass');
    assert.equal(entry.anonymousCleanup.needed, true);
    assert.equal(entry.anonymousCleanup.status, 'pass');
    assert.equal(entry.checks.find(row => row.id === 'configs-anonymous-cleanup-get-1').status, 'pass');
  }
});

test('a normal anonymous 401 leaves a preexisting baseline unchanged without cleanup', async t => {
  const original = { original: true, privateValue: 'private-anonymous-preserved-original' };
  const fixtureData = await fixture(t, { anonymousConfigOriginal: original });
  const { code, report } = await fixtureData.run();
  assert.equal(code, 0);
  for (const entry of report.entries) {
    assert.equal(entry.checks.find(row => row.id === 'configs-anonymous-put-denied').status, 'pass');
    assert.equal(entry.checks.find(row => row.id === 'configs-anonymous-state-preserved').status, 'pass');
    assert.deepEqual(entry.anonymousCleanup, {
      needed: false, attempted: false, restoredExisting: false, status: 'not-needed',
    });
    assert.deepEqual(fixtureData.values.get(`/configs/customtheme/${entry.anonymousTag}`), original);
    assert.ok(!fixtureData.requests.some(row => row.path.endsWith(entry.anonymousTag)
      && row.method === 'PUT' && row.authorization));
  }
  assert.ok(!JSON.stringify(report).includes(original.privateValue));
});

test('anonymous configuration GET and PUT mistakenly allowed together cannot pass after successful cleanup', async t => {
  const fixtureData = await fixture(t, { anonymousConfigGetStatus: 200, anonymousConfigPutStatus: 200 });
  const { code, report } = await fixtureData.run();
  assert.equal(code, 1);
  for (const entry of report.entries) {
    assert.equal(entry.checks.find(row => row.id === 'configs-anonymous-get-denied').status, 'fail');
    assert.equal(entry.checks.find(row => row.id === 'configs-anonymous-put-denied').status, 'fail');
    assert.equal(entry.anonymousCleanup.status, 'pass');
    assert.equal(entry.checks.find(row => row.id === 'configs-roundtrip').status, 'pass');
  }
});

test('an accepted anonymous write restores an existing anonymous-test tag without exposing its contents', async t => {
  const original = { original: true, privateValue: 'private-anonymous-original' };
  const fixtureData = await fixture(t, { anonymousConfigPutStatus: 200, anonymousConfigOriginal: original });
  const { code, report } = await fixtureData.run();
  assert.equal(code, 1);
  for (const entry of report.entries) {
    assert.equal(entry.anonymousCleanup.status, 'pass');
    assert.equal(entry.anonymousCleanup.restoredExisting, true);
    assert.deepEqual(fixtureData.values.get(`/configs/customtheme/${entry.anonymousTag}`), original);
  }
  assert.ok(!JSON.stringify(report).includes(original.privateValue));
});

test('anonymous writes are not attempted if the authenticated cleanup baseline cannot be established', async t => {
  const fixtureData = await fixture(t, { anonymousConfigBaselineFailure: true });
  const { code, report } = await fixtureData.run();
  assert.equal(code, 1);
  for (const entry of report.entries) {
    assert.equal(entry.checks.find(row => row.id === 'configs-anonymous-baseline').status, 'fail');
    assert.equal(entry.checks.find(row => row.id === 'configs-anonymous-put-denied').status, 'fail');
    assert.equal(entry.checks.find(row => row.id === 'configs-anonymous-state-preserved').status, 'fail');
    assert.equal(entry.anonymousCleanup.status, 'not-needed');
    assert.equal(entry.checks.find(row => row.id === 'configs-roundtrip').status, 'pass');
    assert.ok(!fixtureData.requests.some(row => row.path.endsWith(entry.anonymousTag) && row.method === 'PUT'));
  }
});

for (const [name, options, checkId] of [
  ['cleanup write failure', { anonymousConfigCleanupFailure: true }, 'configs-anonymous-cleanup-put-1'],
  ['cleanup read mismatch', { anonymousConfigCleanupReadMismatch: true }, 'configs-anonymous-cleanup-get-1'],
]) {
  test(`an accepted anonymous configuration PUT with ${name} remains failed and records cleanup failure`, async t => {
    const fixtureData = await fixture(t, { anonymousConfigPutStatus: 200, ...options });
    const { code, report } = await fixtureData.run();
    assert.equal(code, 1);
    for (const entry of report.entries) {
      assert.equal(entry.anonymousCleanup.needed, true);
      assert.equal(entry.anonymousCleanup.attempted, true);
      assert.equal(entry.anonymousCleanup.status, 'fail');
      assert.equal(entry.checks.find(row => row.id === checkId).status, 'fail');
      assert.equal(entry.checks.find(row => row.id === 'configs-anonymous-cleanup-login').status, 'pass');
      assert.equal(entry.checks.find(row => row.id === 'configs-roundtrip').status, 'pass');
      const cleanupRequests = fixtureData.requests.filter(row => row.path.endsWith(entry.anonymousTag)
        && row.method === 'PUT' && row.authorization);
      assert.equal(cleanupRequests.length, 2);
      assert.ok(cleanupRequests.every(row => row.data === null));
    }
  });
}

test('an anonymous cleanup retry uses a fresh login without erasing the failed checks', async t => {
  const fixtureData = await fixture(t, { anonymousConfigPutStatus: 200, anonymousConfigCleanupFailOnce: true });
  const { code, report } = await fixtureData.run();
  assert.equal(code, 1);
  for (const entry of report.entries) {
    assert.equal(entry.checks.find(row => row.id === 'configs-anonymous-cleanup-put-1').status, 'fail');
    assert.equal(entry.checks.find(row => row.id === 'configs-anonymous-cleanup-get-1').status, 'fail');
    assert.equal(entry.checks.find(row => row.id === 'configs-anonymous-cleanup-put-2').status, 'pass');
    assert.equal(entry.checks.find(row => row.id === 'configs-anonymous-cleanup-get-2').status, 'pass');
    assert.equal(entry.anonymousCleanup.status, 'pass');
    const cleanupRequests = fixtureData.requests.filter(row => row.path.endsWith(entry.anonymousTag)
      && row.method === 'PUT' && row.authorization);
    assert.deepEqual(cleanupRequests.map(row => row.authorization),
      [`Bearer private-${entry.app}-token-1`, `Bearer private-${entry.app}-token-2`]);
    assert.equal(fixtureData.values.has(`/configs/customtheme/${entry.anonymousTag}`), false);
    assert.equal(entry.checks.find(row => row.id === 'configs-roundtrip').status, 'pass');
  }
});

test('an unacknowledged anonymous PUT is cleaned up and verified after timeout', async t => {
  const fixtureData = await fixture(t, { anonymousConfigPutTimeout: true });
  fixtureData.config.timeoutMs = 100;
  const { code, report } = await fixtureData.run();
  assert.equal(code, 1);
  for (const entry of report.entries) {
    const check = entry.checks.find(row => row.id === 'configs-anonymous-put-denied');
    assert.equal(check.status, 'fail');
    assert.equal(check.response.error, 'timeout');
    assert.equal(entry.anonymousCleanup.status, 'pass');
    assert.equal(fixtureData.values.has(`/configs/customtheme/${entry.anonymousTag}`), false);
    assert.equal(entry.checks.find(row => row.id === 'configs-roundtrip').status, 'pass');
  }
});

test('a colliding isolated tag is restored in finally without recording its original contents', async t => {
  const original = { original: true, privateValue: 'not-for-report' };
  const fixtureData = await fixture(t, { original });
  const { code, report } = await fixtureData.run();
  assert.equal(code, 0);
  for (const entry of report.entries) {
    assert.equal(entry.cleanup.restoredExisting, true);
    const path = `/configs/customtheme/${entry.tag}`;
    assert.deepEqual(fixtureData.values.get(path), original);
  }
  assert.ok(!JSON.stringify(report).includes(original.privateValue));
});

test('JSON null and nested access tokens conform to the source contract', async t => {
  const { code } = await (await fixture(t, { nullBody: true, nestedToken: true })).run();
  assert.equal(code, 0);
});

test('populated message responses are validated without retaining their private contents', async t => {
  const privateContent = 'private-message-contents';
  const fixtureData = await fixture(t, {
    messageBody: [{ id: 'fixture-message', content: privateContent }], total: '1',
  });
  const { code, report } = await fixtureData.run();
  assert.equal(code, 0);
  assert.ok(!JSON.stringify(report).includes(privateContent));
  assert.ok(report.entries.every(entry => entry.checks
    .find(check => check.id === 'messages-fetch').response.pagination.total === 1));
});

for (const [name, options, checkId] of [
  ['login 401', { loginFailure: 401 }, 'login'],
  ['login 404', { loginFailure: 404 }, 'login'],
  ['login 500', { loginFailure: 500 }, 'login'],
  ['empty login', { loginEmpty: true }, 'login'],
  ['login without token', { loginNoToken: true }, 'login'],
  ['message 404', { messageStatus: 404 }, 'messages-fetch'],
  ['message 500', { messageStatus: 500 }, 'messages-fetch'],
  ['empty message body', { messageBody: undefined }, 'messages-fetch'],
  ['wrong message shape', { messageBody: {} }, 'messages-fetch'],
  ['invalid message record', { messageBody: [{}], total: '1' }, 'messages-fetch'],
  ['HTML message body', { messageHtml: true }, 'messages-fetch'],
  ['invalid JSON message body', { messageInvalidJson: true }, 'messages-fetch'],
  ['missing pagination', { noPagination: true }, 'messages-fetch'],
  ['wrong pagination', { page: '2' }, 'messages-fetch'],
  ['invalid total', { total: 'NaN' }, 'messages-fetch'],
  ['redirected message request', { messageRedirect: true }, 'messages-fetch'],
  ['anonymous empty-response stub', { anonymousStub: true }, 'messages-anonymous-denied'],
  ['baseline failure', { baselineFailure: true }, 'configs-baseline'],
  ['uncertain PUT failure', { putFailure: true }, 'configs-put'],
  ['empty PUT response', { putEmpty: true }, 'configs-put'],
  ['false PUT response', { putFalse: true }, 'configs-put'],
  ['new login failure', { reloginFailure: true }, 'login-new-session'],
  ['incorrect persisted data', { readMismatch: true }, 'configs-new-session-get'],
  ['reset failed', { resetFailure: true }, 'configs-reset'],
  ['reset does not delete', { resetDoesNothing: true }, 'configs-reset-get'],
  ['reset returns an object stub', { resetObjectStub: true }, 'configs-reset-get'],
  ['finally reset fails', { cleanupFailure: true }, 'cleanup-put-1'],
]) {
  test(`${name} is required, fails nonzero and never skips the second native entry`, async t => {
    const fixtureData = await fixture(t, options);
    const { code, report } = await fixtureData.run();
    assert.equal(code, 1);
    assert.equal(report.entries.length, 2);
    assert.ok(report.summary.failed > 0);
    for (const entry of report.entries) {
      assert.equal(entry.checks.find(row => row.id === checkId)?.status, 'fail');
      if (entry.cleanup.needed) assert.equal(entry.cleanup.attempted, true);
    }
    if (options.putFailure || options.putEmpty || options.putFalse || options.reloginFailure
      || options.readMismatch || options.resetFailure) {
      for (const entry of report.entries) {
        assert.equal(entry.cleanup.status, 'pass');
        assert.equal(fixtureData.values.has(`/configs/customtheme/${entry.tag}`), false);
      }
    }
    if (options.baselineFailure || options.loginFailure || options.loginEmpty || options.loginNoToken) {
      assert.ok(!fixtureData.requests.some(row => row.method === 'PUT' && row.authorization));
      if (!options.baselineFailure) assert.ok(!fixtureData.requests.some(row => row.method === 'PUT'));
    }
    if (options.messageRedirect) assert.ok(!fixtureData.requests.some(row => row.path === '/success'));
  });
}

test('finally restores a preexisting isolated tag even after a failed or uncertain PUT', async t => {
  const original = { original: true, privateValue: 'restore-after-error' };
  const fixtureData = await fixture(t, { original, putFailure: true });
  const { code, report } = await fixtureData.run();
  assert.equal(code, 1);
  for (const entry of report.entries) {
    assert.equal(entry.cleanup.status, 'pass');
    assert.deepEqual(fixtureData.values.get(`/configs/customtheme/${entry.tag}`), original);
  }
});

test('stale per-session configuration caches fail reset verification even when storage was deleted', async t => {
  const fixtureData = await fixture(t, { sessionConfigCache: true });
  const { code, report } = await fixtureData.run();
  assert.equal(code, 1);
  for (const entry of report.entries) {
    assert.equal(entry.checks.find(check => check.id === 'configs-same-session-get').status, 'fail');
    assert.equal(entry.checks.find(check => check.id === 'configs-new-session-get').status, 'pass');
    assert.equal(entry.checks.find(check => check.id === 'configs-update-get').status, 'fail');
    assert.equal(entry.checks.find(check => check.id === 'configs-other-session-update-get').status, 'fail');
    assert.equal(entry.checks.find(check => check.id === 'configs-reset').status, 'pass');
    assert.equal(entry.checks.find(check => check.id === 'configs-reset-get').status, 'fail');
    assert.equal(entry.checks.find(check => check.id === 'configs-roundtrip').status, 'fail');
    assert.equal(entry.checks.find(check => check.id === 'cleanup-get-1').status, 'fail');
    assert.equal(entry.checks.find(check => check.id === 'cleanup-login').status, 'pass');
    assert.equal(entry.checks.find(check => check.id === 'cleanup-get-2').status, 'pass');
    assert.equal(entry.cleanup.status, 'pass');
    assert.equal(fixtureData.values.has(`/configs/customtheme/${entry.tag}`), false);
    assert.equal(fixtureData.counts.get(entry.app), 3);
  }
});

for (const original of [null, { original: true, privateValue: 'restore-after-timeout' }]) {
  test(`an unacknowledged PUT is cleaned up after timeout (${original ? 'restore' : 'reset'})`, async t => {
    const fixtureData = await fixture(t, { original, putTimeout: true });
    fixtureData.config.timeoutMs = 100;
    const { code, report } = await fixtureData.run();
    assert.equal(code, 1);
    for (const entry of report.entries) {
      assert.equal(entry.checks.find(check => check.id === 'configs-put').response.error, 'timeout');
      assert.equal(entry.checks.find(check => check.id === 'configs-roundtrip').status, 'fail');
      assert.equal(entry.cleanup.status, 'pass');
      const path = `/configs/customtheme/${entry.tag}`;
      if (original) assert.deepEqual(fixtureData.values.get(path), original);
      else assert.equal(fixtureData.values.has(path), false);
    }
  });
}

test('timeouts are recorded safely and other required flows still execute', async t => {
  const fixtureData = await fixture(t, { messageTimeout: true });
  fixtureData.config.timeoutMs = 50;
  const { code, report } = await fixtureData.run();
  assert.equal(code, 1);
  for (const entry of report.entries) {
    assert.equal(entry.checks.find(row => row.id === 'messages-fetch').response.error, 'timeout');
    assert.equal(entry.checks.find(row => row.id === 'configs-roundtrip').status, 'pass');
    assert.equal(entry.cleanup.status, 'pass');
  }
});

test('unreachable native entry fails rather than falling back or skipping', async t => {
  const fixtureData = await fixture(t);
  fixtureData.config.centralUrl = 'http://127.0.0.1:1/central/';
  const { code, report } = await fixtureData.run();
  assert.equal(code, 1);
  assert.equal(report.entries[0].checks[0].response.error, 'transport-error');
  assert.ok(report.entries[0].checks.every(row => row.status === 'fail'));
  assert.ok(report.entries[1].checks.every(row => row.status === 'pass'));
});

test('the CLI emits no credentials and returns nonzero with a persisted failure receipt', async t => {
  const fixtureData = await fixture(t, { putEmpty: true });
  let result;
  try {
    await runNode(process.execPath, [
      script, '--required',
      '--central-url', fixtureData.config.centralUrl,
      '--modeldesign-url', fixtureData.config.modeldesignUrl,
      '--report-dir', fixtureData.config.reportDir,
    ], { env: { ...process.env, AIBIZ_LOGINNAME: 'fixture-user', AIBIZ_PASSWORD: password } });
    assert.fail('CLI must reject a false-success response');
  } catch (error) {
    result = error;
  }
  assert.equal(result.code, 1);
  assert.match(result.stdout, /NATIVE PLATFORM API FAIL/);
  assert.ok(!`${result.stdout}${result.stderr}`.includes(password));
  assert.ok(!`${result.stdout}${result.stderr}`.includes('private-Central-token'));
  const report = JSON.parse(await readFile(join(fixtureData.config.reportDir, 'report.json'), 'utf8'));
  assert.equal(report.status, 'fail');
  assert.ok(report.entries.every(entry => entry.cleanup.status === 'pass'));
});
