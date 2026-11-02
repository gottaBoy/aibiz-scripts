#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { resolveNativeModelingConfig, WORKSPACE_ROOT } from './native-modeling-config.mjs';

const scriptPath = fileURLToPath(import.meta.url);
const configFolder = 'customtheme';
const messagePath = 'extension/internal_messages/fetch_cur_receiver';
const messageQuery = { page: 0, size: 20, sort: 'timestamp,desc' };

export function parseArgs(argv, env = process.env) {
  const native = resolveNativeModelingConfig(env);
  const entries = Object.fromEntries(native.entries);
  const config = {
    centralUrl: env.AIBIZ_NATIVE_CENTRAL_URL ?? entries.Central,
    modeldesignUrl: env.AIBIZ_NATIVE_MODELDESIGN_URL ?? entries.ModelDesign,
    loginName: env.AIBIZ_LOGINNAME ?? 'aibizhi',
    password: env.AIBIZ_PASSWORD ?? '123456',
    timeoutMs: Number(env.AIBIZ_NATIVE_PLATFORM_TIMEOUT_MS ?? 15000),
    reportDir: env.AIBIZ_NATIVE_PLATFORM_REPORT_DIR ?? join(
      WORKSPACE_ROOT, '.artifacts/native-platform-api',
      `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`,
    ),
  };
  const options = new Map([
    ['--central-url', 'centralUrl'], ['--modeldesign-url', 'modeldesignUrl'],
    ['--report-dir', 'reportDir'], ['--timeout-ms', 'timeoutMs'],
  ]);
  for (let index = 0; index < argv.length; index++) {
    const option = argv[index];
    if (option === '--required') continue;
    const key = options.get(option);
    if (!key) throw new Error('Unknown option; this harness only supports required execution');
    const value = argv[++index];
    if (!value || value.startsWith('--')) throw new Error(`${option} requires a value`);
    config[key] = key === 'timeoutMs' ? Number(value) : value;
  }
  for (const key of ['centralUrl', 'modeldesignUrl']) {
    let url;
    try { url = new URL(config[key]); } catch { throw new Error('Invalid native entry URL'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password
      || url.search || url.hash) throw new Error('Invalid native entry URL');
    config[key] = url.href;
  }
  if (!Number.isSafeInteger(config.timeoutMs) || config.timeoutMs <= 0) {
    throw new Error('HTTP timeout must be a positive integer');
  }
  if (!config.loginName || !config.password) throw new Error('Login credentials are required');
  config.reportDir = resolve(config.reportDir);
  return config;
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function accessToken(data) {
  const values = [data?.token, data?.access_token, data?.data?.token, data?.data?.access_token];
  return values.find(value => typeof value === 'string' && value.trim()
    && !/[\r\n]/.test(value)) ?? null;
}

async function request(url, { method = 'GET', token, data, timeoutMs }) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const result = {
    status: null, bytes: 0, json: false, empty: false, jsonMediaType: false,
    pagination: { page: null, size: null, total: null }, error: null,
  };
  try {
    const response = await fetch(url, {
      method, redirect: 'manual', signal: controller.signal,
      headers: {
        accept: 'application/json',
        ...(data !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
    });
    result.status = response.status;
    result.jsonMediaType = /^application\/(?:json|[a-z0-9.+-]+\+json)(?:;|$)/i
      .test(response.headers.get('content-type') ?? '');
    for (const [key, header] of [['page', 'x-page'], ['size', 'x-per-page'], ['total', 'x-total']]) {
      const value = response.headers.get(header);
      if (value !== null && /^(0|[1-9][0-9]*)$/.test(value)
        && Number.isSafeInteger(Number(value))) result.pagination[key] = Number(value);
    }
    const text = await response.text();
    result.bytes = Buffer.byteLength(text);
    result.empty = text.trim() === '';
    if (!result.empty) {
      try {
        result.data = JSON.parse(text);
        result.json = true;
      } catch {
        result.error = 'invalid-json';
      }
    }
  } catch {
    // Never retain exception messages or response previews: either can echo credentials.
    result.error = controller.signal.aborted ? 'timeout' : 'transport-error';
  } finally {
    clearTimeout(timeout);
  }
  return result;
}

function absent(result) {
  return !result.error && result.status === 200
    && (result.empty || (result.json && result.data === null));
}

function configValue(result) {
  return absent(result) || (!result.error && result.status === 200
    && result.jsonMediaType && result.json && object(result.data));
}

function booleanSuccess(result) {
  return !result.error && result.status === 200 && result.jsonMediaType
    && result.json && result.data === true;
}

function validMessages(result) {
  return !result.error && result.status === 200 && result.jsonMediaType
    && result.json && Array.isArray(result.data)
    && result.data.every(row => object(row) && typeof row.id === 'string' && row.id.trim())
    && result.pagination.page === messageQuery.page
    && result.pagination.size === messageQuery.size
    && result.pagination.total !== null && result.pagination.total >= result.data.length
    && result.data.length <= messageQuery.size;
}

function addCheck(entry, id, ok, detail, result, path, method = 'GET', session = 'initial') {
  entry.checks.push({
    id, required: true, status: ok ? 'pass' : 'fail', detail,
    ...(result ? {
      request: { method, path, session },
      response: {
        httpStatus: result.status, bytes: result.bytes, json: result.json,
        empty: result.empty, jsonMediaType: result.jsonMediaType,
        pagination: result.pagination, error: result.error,
      },
    } : {}),
  });
  return ok;
}

async function checkEntry(config, app, entryUrl, runId) {
  const apiUrl = new URL(`/api/ibizmodeling__${app.toLowerCase()}/`, entryUrl);
  const tag = `native_platform_harness_${app.toLowerCase()}_${runId}`;
  const path = `configs/${configFolder}/${tag}?share=false`;
  const anonymousTag = `native_platform_harness_anonymous_${app.toLowerCase()}_${randomUUID()}`;
  const anonymousPath = `configs/${configFolder}/${anonymousTag}?share=false`;
  const entry = {
    app, entryUrl, apiUrl: apiUrl.href, configFolder, tag, anonymousTag,
    authentication: 'native-v7-login', checks: [],
    cleanup: { needed: false, attempted: false, restoredExisting: false, status: 'not-needed' },
    anonymousCleanup: { needed: false, attempted: false, restoredExisting: false, status: 'not-needed' },
  };
  const call = (endpoint, options = {}) => request(
    new URL(endpoint, apiUrl), { timeoutMs: config.timeoutMs, ...options },
  );
  const login = async (id) => {
    const response = await call('v7/login', {
      method: 'POST', data: { loginname: config.loginName, password: config.password },
    });
    const token = accessToken(response.data);
    const ok = !response.error && response.status === 200
      && response.json && response.jsonMediaType && Boolean(token);
    addCheck(entry, id, ok, 'Native v7 login must return HTTP 200 and a token',
      response, 'v7/login', 'POST', id);
    return ok ? token : null;
  };
  const cleanupConfig = async (endpoint, original, initialToken, state, prefix) => {
    Object.assign(state, {
      needed: true, attempted: true, restoredExisting: original !== null, status: 'fail',
    });
    let cleanupToken = initialToken;
    for (let attempt = 1; attempt <= 2; attempt++) {
      const restored = await call(endpoint, { method: 'PUT', token: cleanupToken, data: original });
      const restoredOk = addCheck(entry, `${prefix}-put-${attempt}`, booleanSuccess(restored),
        'Finally restore the original isolated-tag value, or reset our own tag',
        restored, endpoint, 'PUT', 'cleanup');
      const finalRead = await call(endpoint, { token: cleanupToken });
      const finalOk = addCheck(entry, `${prefix}-get-${attempt}`, original === null
        ? absent(finalRead) : configValue(finalRead) && isDeepStrictEqual(finalRead.data, original),
      'Verify the isolated tag is restored or absent after cleanup', finalRead, endpoint, 'GET', 'cleanup');
      if (restoredOk && finalOk) {
        state.status = 'pass';
        break;
      }
      if (attempt === 1) {
        cleanupToken = await login(`${prefix}-login`);
        if (!cleanupToken) break;
      }
    }
  };
  const token = await login('login');
  if (!token) {
    addCheck(entry, 'messages-fetch', false, 'Cannot validate messages: native login failed');
    addCheck(entry, 'configs-anonymous-get-denied', false, 'Cannot validate anonymous configuration: native login failed');
    addCheck(entry, 'configs-anonymous-put-denied', false, 'Cannot safely probe anonymous writes: native login failed');
    addCheck(entry, 'configs-anonymous-state-preserved', false, 'Cannot verify configuration state: native login failed');
    addCheck(entry, 'configs-roundtrip', false, 'Cannot validate configuration: native login failed');
    return entry;
  }

  const anonymous = await call(messagePath, { method: 'POST', data: messageQuery });
  addCheck(entry, 'messages-anonymous-denied', !anonymous.error && anonymous.status === 401,
    'Message fetch without a token must return HTTP 401', anonymous, messagePath, 'POST', 'anonymous');
  const messages = await call(messagePath, { method: 'POST', token, data: messageQuery });
  addCheck(entry, 'messages-fetch', validMessages(messages),
    'Authenticated fetch must return HTTP 200, a message list and valid pagination headers',
    messages, messagePath, 'POST');

  const anonymousConfig = await call(anonymousPath);
  addCheck(entry, 'configs-anonymous-get-denied', !anonymousConfig.error && anonymousConfig.status === 401,
    'Configuration GET without a token must return HTTP 401',
    anonymousConfig, anonymousPath, 'GET', 'anonymous');
  let anonymousOriginal = null;
  let anonymousMutationAttempted = false;
  try {
    const baseline = await call(anonymousPath, { token });
    if (addCheck(entry, 'configs-anonymous-baseline', configValue(baseline),
      'Read the independent anonymous-test tag before probing an unauthenticated write',
      baseline, anonymousPath)) {
      anonymousOriginal = absent(baseline) ? null : baseline.data;
      anonymousMutationAttempted = true;
      const attempted = await call(anonymousPath, {
        method: 'PUT', data: { harness: 'native-platform-api-anonymous', marker: randomUUID() },
      });
      const denied = addCheck(entry, 'configs-anonymous-put-denied', !attempted.error && attempted.status === 401,
        'Configuration PUT without a token must return HTTP 401',
        attempted, anonymousPath, 'PUT', 'anonymous');
      const afterAttempt = await call(anonymousPath, { token });
      const preserved = addCheck(entry, 'configs-anonymous-state-preserved', anonymousOriginal === null
        ? absent(afterAttempt) : configValue(afterAttempt) && isDeepStrictEqual(afterAttempt.data, anonymousOriginal),
      'Authenticated read after anonymous PUT must match the original baseline',
      afterAttempt, anonymousPath);
      if (denied && preserved) anonymousMutationAttempted = false;
    } else {
      addCheck(entry, 'configs-anonymous-put-denied', false,
        'Cannot safely probe an anonymous write without a valid authenticated baseline');
      addCheck(entry, 'configs-anonymous-state-preserved', false,
        'Cannot verify state preservation without a valid authenticated baseline');
    }
  } finally {
    if (anonymousMutationAttempted) {
      await cleanupConfig(anonymousPath, anonymousOriginal, token, entry.anonymousCleanup,
        'configs-anonymous-cleanup');
    }
  }

  let original = null;
  let mutationAttempted = false;
  let readerToken = null;
  try {
    const baseline = await call(path, { token });
    if (!addCheck(entry, 'configs-baseline', configValue(baseline),
      'Read the isolated tag before changing it', baseline, path)) return entry;
    original = absent(baseline) ? null : baseline.data;
    const payload = {
      harness: 'native-platform-api', runId, app, marker: randomUUID(),
      values: { enabled: true, revision: 1, labels: ['isolated', 'roundtrip'] },
    };
    // A failed PUT can still have reached storage; cleanup is required before sending it.
    mutationAttempted = true;
    const saved = await call(path, { method: 'PUT', token, data: payload });
    if (!addCheck(entry, 'configs-put', booleanSuccess(saved),
      'Save the isolated tag; HTTP 200 with boolean true is required', saved, path, 'PUT')) return entry;

    const sameSession = await call(path, { token });
    const sameSessionOk = addCheck(entry, 'configs-same-session-get', configValue(sameSession)
      && isDeepStrictEqual(sameSession.data, payload),
    'The session that read the baseline must immediately read the saved payload',
    sameSession, path);

    readerToken = await login('login-new-session');
    if (!readerToken) {
      addCheck(entry, 'configs-new-session-get', false, 'Cannot read configuration: new login failed');
      return entry;
    }
    const loaded = await call(path, { token: readerToken });
    if (!addCheck(entry, 'configs-new-session-get', configValue(loaded)
      && isDeepStrictEqual(loaded.data, payload),
    'A separately authenticated session must read the exact saved payload',
    loaded, path, 'GET', 'new-session')) return entry;

    const updatedPayload = {
      ...payload, values: { ...payload.values, revision: 2 },
    };
    const updated = await call(path, { method: 'PUT', token, data: updatedPayload });
    const updateOk = addCheck(entry, 'configs-update', booleanSuccess(updated),
      'Update the isolated tag in the original session', updated, path, 'PUT');
    const updatedRead = await call(path, { token });
    const updatedReadOk = addCheck(entry, 'configs-update-get', configValue(updatedRead)
      && isDeepStrictEqual(updatedRead.data, updatedPayload),
    'The writer must immediately read the updated payload', updatedRead, path);
    const readerUpdate = await call(path, { token: readerToken });
    const readerUpdateOk = addCheck(entry, 'configs-other-session-update-get', configValue(readerUpdate)
      && isDeepStrictEqual(readerUpdate.data, updatedPayload),
    'An already authenticated reader must read the update without relogin',
    readerUpdate, path, 'GET', 'new-session');

    const reset = await call(path, { method: 'PUT', token: readerToken, data: null });
    const resetOk = addCheck(entry, 'configs-reset', booleanSuccess(reset),
      'Reset uses PUT null and must return HTTP 200 with boolean true',
      reset, path, 'PUT', 'new-session');
    const afterReset = await call(path, { token: readerToken });
    const resetReadOk = addCheck(entry, 'configs-reset-get', absent(afterReset),
      'The tag must be absent after reset (HTTP 200, empty body or JSON null)',
      afterReset, path, 'GET', 'new-session');
    const writerAfterReset = await call(path, { token });
    const writerResetOk = addCheck(entry, 'configs-other-session-reset-get', absent(writerAfterReset),
      'The original session must also observe the reset without relogin',
      writerAfterReset, path);
    addCheck(entry, 'configs-roundtrip', sameSessionOk && updateOk && updatedReadOk
      && readerUpdateOk && resetOk && resetReadOk && writerResetOk,
    'Isolated tag save -> same/new-session reads -> update -> both-session reads -> reset -> both-session reads');
  } finally {
    if (mutationAttempted) {
      await cleanupConfig(path, original, readerToken ?? token, entry.cleanup, 'cleanup');
    }
    if (!entry.checks.some(row => row.id === 'configs-roundtrip')) {
      addCheck(entry, 'configs-roundtrip', false, 'Configuration roundtrip did not complete');
    }
  }
  return entry;
}

export async function runHarness(config) {
  const report = {
    schemaVersion: 1, mode: 'required', status: 'fail',
    startedAt: new Date().toISOString(), runId: randomUUID(), entries: [],
  };
  for (const [app, url] of [['Central', config.centralUrl], ['ModelDesign', config.modeldesignUrl]]) {
    report.entries.push(await checkEntry(config, app, url, report.runId));
  }
  const checks = report.entries.flatMap(entry => entry.checks);
  report.summary = {
    required: checks.length, passed: checks.filter(row => row.status === 'pass').length,
    failed: checks.filter(row => row.status === 'fail').length,
  };
  report.status = report.summary.failed === 0 ? 'pass' : 'fail';
  report.exitCode = report.status === 'pass' ? 0 : 1;
  report.finishedAt = new Date().toISOString();
  await mkdir(config.reportDir, { recursive: true });
  const path = join(config.reportDir, 'report.json');
  await writeFile(`${path}.tmp`, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  await rename(`${path}.tmp`, path);
  return report.exitCode;
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  try {
    const config = parseArgs(process.argv.slice(2));
    const code = await runHarness(config);
    console.log(`NATIVE PLATFORM API ${code === 0 ? 'PASS' : 'FAIL'}`);
    console.log(`Report: ${join(config.reportDir, 'report.json')}`);
    process.exitCode = code;
  } catch {
    console.error('Native platform API harness failed; check arguments, credentials and artifact permissions');
    process.exitCode = 1;
  }
}
