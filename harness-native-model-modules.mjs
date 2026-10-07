#!/usr/bin/env node
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual, promisify } from 'node:util';

const scriptPath = fileURLToPath(import.meta.url);
const executeFile = promisify(execFile);
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const pageSize = 100;
const maxBytes = 2 * 1024 * 1024;
const scope = 'Only verifies module read projection and connectivity; '
  + 'does not prove isolation, authorization correctness or UI workflows.';
const checkIds = [
  'input-validation', 'mysql-reference-read', 'mysql-reference-nonempty',
  'mysql-reference-unique', 'native-login', 'modules-anonymous-denied',
  'modules-explicit-fetch', 'modules-explicit-nonempty', 'modules-explicit-unique',
  'modules-system-identity', 'modules-pagination-complete', 'modules-exact-db-projection',
  'execution-integrity',
];

class HarnessFailure extends Error {
  constructor(code) {
    super('Module read verification failed');
    this.code = code;
  }
}

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validate(config) {
  const result = { ...config };
  const rawUrl = result.modeldesignUrl;
  let url;
  try { url = new URL(rawUrl); } catch { throw new Error('Invalid native entry URL'); }
  if (typeof rawUrl !== 'string' || /[\s\\?#]/.test(rawUrl)
    || !['http:', 'https:'].includes(url.protocol) || url.username || url.password
    || !['/modeldesign', '/modeldesign/'].includes(url.pathname)) {
    throw new Error('Invalid native entry URL');
  }
  url.pathname = '/modeldesign/';
  result.modeldesignUrl = url.href;
  for (const key of ['devSlnSysId', 'systemId']) {
    if (typeof result[key] !== 'string' || !uuid.test(result[key])) {
      throw new Error('Invalid model system identifier');
    }
    result[key] = result[key].toUpperCase();
  }
  for (const [key, pattern] of [
    ['mysqlContainer', /^[a-z0-9][a-z0-9_.-]{0,127}$/i],
    ['mysqlDatabase', /^[a-z][a-z0-9_]{0,63}$/i],
    ['mysqlUser', /^[a-z0-9_][a-z0-9_.-]{0,63}$/i],
  ]) {
    if (typeof result[key] !== 'string' || !pattern.test(result[key])) {
      throw new Error('Invalid MySQL connection identifier');
    }
  }
  if (!Number.isSafeInteger(result.timeoutMs) || result.timeoutMs <= 0
    || result.timeoutMs > 120000) throw new Error('Timeout must be an integer from 1 to 120000');
  for (const key of ['loginName', 'password', 'mysqlPassword']) {
    if (typeof result[key] !== 'string' || !result[key].trim()
      || /[\u0000\r\n]/.test(result[key])) throw new Error('Valid credentials are required');
  }
  if (typeof result.reportDir !== 'string' || !result.reportDir.trim()
    || /[\u0000\r\n]/.test(result.reportDir)) throw new Error('Invalid report directory');
  result.reportDir = resolve(result.reportDir);
  return result;
}

export function parseArgs(argv, env = process.env) {
  const config = {
    modeldesignUrl: env.AIBIZ_NATIVE_MODELDESIGN_URL ?? 'http://127.0.0.1:32009/modeldesign/',
    devSlnSysId: env.AIBIZ_NATIVE_MODEL_MODULES_PSDEVSLNSYS
      ?? '28F7326A-7C72-4C2D-A497-A16372ABBADC',
    systemId: env.AIBIZ_NATIVE_MODEL_MODULES_PSSYSTEMID
      ?? '2C40DFCD-0DF5-47BF-91A5-C45F810B0001',
    loginName: env.AIBIZ_LOGINNAME ?? 'aibizhi',
    password: env.AIBIZ_PASSWORD ?? '123456',
    mysqlContainer: env.AIBIZ_MYSQL_CONTAINER ?? 'mysql',
    mysqlDatabase: env.AIBIZ_MYSQL_MODEL_DATABASE ?? 'scloud9471c1eca',
    mysqlUser: env.AIBIZ_MYSQL_ROOT_USER ?? 'root',
    mysqlPassword: env.AIBIZ_MYSQL_ROOT_PASSWORD ?? 'Mysql@2022',
    timeoutMs: Number(env.AIBIZ_NATIVE_MODEL_MODULES_TIMEOUT_MS ?? 15000),
    reportDir: env.AIBIZ_NATIVE_MODEL_MODULES_REPORT_DIR ?? join(
      dirname(scriptPath), '.artifacts/native-model-modules',
      `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`,
    ),
  };
  const options = new Map([
    ['--modeldesign-url', 'modeldesignUrl'], ['--psdevslnsys', 'devSlnSysId'],
    ['--pssystemid', 'systemId'], ['--mysql-container', 'mysqlContainer'],
    ['--mysql-database', 'mysqlDatabase'], ['--mysql-user', 'mysqlUser'],
    ['--report-dir', 'reportDir'], ['--timeout-ms', 'timeoutMs'],
  ]);
  for (let index = 0; index < argv.length; index++) {
    const option = argv[index];
    if (option === '--required') continue;
    const key = options.get(option);
    if (!key) throw new Error('Unknown option; only required read verification is supported');
    const value = argv[++index];
    if (!value || value.startsWith('--')) throw new Error(`${option} requires a value`);
    config[key] = key === 'timeoutMs' ? Number(value) : value;
  }
  return validate(config);
}

async function deadline(operation, timeoutMs, onTimeout, code) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(operation),
      new Promise((_, reject) => {
        timer = setTimeout(() => {
          onTimeout();
          reject(new HarnessFailure(code));
        }, timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function request(url, { token, data, timeoutMs }, fetchResponse) {
  const controller = new AbortController();
  const metadata = {
    httpStatus: null, bytes: 0, json: false, empty: false, jsonMediaType: false,
    pagination: { page: null, size: null, total: null }, error: null,
  };
  try {
    return await deadline(async () => {
      const response = await fetchResponse(url, {
        method: 'POST', redirect: 'manual', signal: controller.signal,
        headers: {
          accept: 'application/json', 'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(data),
      });
      if (!Number.isInteger(response.status) || response.status < 100 || response.status > 599) {
        throw new HarnessFailure('invalid-http-response');
      }
      metadata.httpStatus = response.status;
      metadata.jsonMediaType = /^application\/(?:json|[a-z0-9.+-]+\+json)(?:;|$)/i
        .test(response.headers.get('content-type') ?? '');
      for (const [key, header] of [['page', 'x-page'], ['size', 'x-per-page'], ['total', 'x-total']]) {
        const value = response.headers.get(header);
        if (value === null) continue;
        if (!/^(0|[1-9][0-9]*)$/.test(value) || !Number.isSafeInteger(Number(value))) {
          throw new HarnessFailure('invalid-pagination');
        }
        metadata.pagination[key] = Number(value);
      }
      // Keep the deadline active through body consumption, including controlled test responses.
      const text = await response.text();
      metadata.bytes = Buffer.byteLength(text);
      metadata.empty = text.trim() === '';
      if (metadata.bytes > maxBytes) throw new HarnessFailure('response-too-large');
      if (metadata.empty) return { ...metadata };
      if (!metadata.jsonMediaType) throw new HarnessFailure('invalid-media-type');
      let parsed;
      try { parsed = JSON.parse(text); } catch { throw new HarnessFailure('invalid-json'); }
      return { ...metadata, json: true, data: parsed };
    }, timeoutMs, () => controller.abort(), 'timeout');
  } catch (error) {
    return {
      ...metadata,
      error: error instanceof HarnessFailure ? error.code
        : controller.signal.aborted ? 'timeout' : 'transport-error',
    };
  }
}

function accessToken(data) {
  return [data?.token, data?.access_token, data?.data?.token, data?.data?.access_token]
    .find(value => typeof value === 'string' && value.trim() && !/[\u0000\r\n]/.test(value));
}

function projection(data) {
  if (!Array.isArray(data) || !data.every(row => object(row)
    && ['psmoduleid', 'pssystemid', 'psmodulename'].every(field => Object.hasOwn(row, field))
    && typeof row.psmoduleid === 'string' && row.psmoduleid.trim()
    && row.psmoduleid.length <= 100
    && typeof row.pssystemid === 'string' && uuid.test(row.pssystemid)
    && (row.psmodulename === null || typeof row.psmodulename === 'string'))) {
    throw new HarnessFailure('invalid-module-projection');
  }
  return data.map(row => ({
    psmoduleid: row.psmoduleid, pssystemid: row.pssystemid, psmodulename: row.psmodulename,
  })).sort((a, b) => a.psmoduleid < b.psmoduleid ? -1 : a.psmoduleid > b.psmoduleid ? 1 : 0);
}

function hash(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function statistics(rows) {
  return {
    count: rows.length, uniqueIds: new Set(rows.map(row => row.psmoduleid)).size,
    identitySha256: hash(rows.map(row => row.psmoduleid)), projectionSha256: hash(rows),
  };
}

async function readReference(config, execute) {
  const sql = "SELECT JSON_OBJECT('psmoduleid',PSMODULEID,'pssystemid',PSSYSTEMID,"
    + "'psmodulename',PSMODULENAME) FROM T_SRFPSMODULE "
    + `WHERE PSSYSTEMID='${config.systemId}' ORDER BY PSMODULEID`;
  try {
    const result = await deadline(() => execute('docker', [
      'exec', '-e', 'MYSQL_PWD', config.mysqlContainer, 'mysql',
      '--batch', '--raw', '--skip-column-names', '--default-character-set=utf8mb4',
      `--user=${config.mysqlUser}`, config.mysqlDatabase, '-e', sql,
    ], {
      encoding: 'utf8', timeout: config.timeoutMs, maxBuffer: maxBytes,
      env: { ...process.env, MYSQL_PWD: config.mysqlPassword },
    }), config.timeoutMs, () => {}, 'database-timeout');
    if (!object(result) || typeof result.stdout !== 'string' || typeof result.stderr !== 'string'
      || result.stderr.trim() || (result.exitCode !== undefined && result.exitCode !== 0)
      || Buffer.byteLength(result.stdout) > maxBytes) {
      throw new HarnessFailure('invalid-database-result');
    }
    const text = result.stdout.replace(/\r?\n$/, '');
    let rows;
    try { rows = text === '' ? [] : text.split(/\r?\n/).map(line => JSON.parse(line)); }
    catch { throw new HarnessFailure('invalid-database-json'); }
    return { rows: projection(rows), error: null };
  } catch (error) {
    return {
      rows: null,
      error: error instanceof HarnessFailure ? error.code
        : error?.killed ? 'database-timeout' : 'database-command-error',
    };
  }
}

function responseMetadata(result) {
  const { data, ...metadata } = result;
  return metadata;
}

export async function runHarness(input, dependencies = {}) {
  const controlled = Object.keys(dependencies).length !== 0
    || dependencies.fetch !== undefined || dependencies.execFile !== undefined;
  const report = {
    schemaVersion: 1, mode: 'required', status: 'fail', nativeAcceptance: false,
    evidence: controlled ? 'controlled-responses-not-native-evidence' : 'native-read-projection-attempt',
    readProjectionVerified: false, persistentWrites: false, scope,
    startedAt: new Date().toISOString(), runId: randomUUID(), entries: [{
      app: 'ModelDesign', authentication: 'native-v7-login',
      checks: checkIds.map(id => ({ id, required: true, status: 'fail', error: 'not-completed' })),
      observations: [], statistics: {},
    }],
  };
  const entry = report.entries[0];
  const check = (id, ok, error, result, path) => {
    Object.assign(entry.checks.find(row => row.id === id), {
      status: ok ? 'pass' : 'fail', error: ok ? null : error,
      ...(result ? { request: { method: 'POST', path }, response: responseMetadata(result) } : {}),
    });
  };
  let config;
  try {
    config = validate(input);
    if (Object.keys(dependencies).some(key => !['fetch', 'execFile'].includes(key))
      || (dependencies.fetch !== undefined && typeof dependencies.fetch !== 'function')
      || (dependencies.execFile !== undefined && typeof dependencies.execFile !== 'function')) {
      throw new Error('Invalid controlled dependencies');
    }
    check('input-validation', true);
    const apiUrl = new URL('/api/ibizmodeling__modeldesign/', config.modeldesignUrl);
    const moduleUrl = new URL(`psdevslnsys/${config.devSlnSysId}/psmodules/fetchcursys`, apiUrl);
    const loginUrl = new URL('v7/login', apiUrl);
    const call = (url, data, token) => request(url, {
      data, token, timeoutMs: config.timeoutMs,
    }, dependencies.fetch ?? globalThis.fetch);
    const query = { pssystemid: config.systemId, size: pageSize };
    const [reference, anonymous, login] = await Promise.all([
      readReference(config, dependencies.execFile ?? executeFile),
      call(moduleUrl, query),
      call(loginUrl, { loginname: config.loginName, password: config.password }),
    ]);
    check('mysql-reference-read', reference.rows !== null, reference.error);
    check('mysql-reference-nonempty', Boolean(reference.rows?.length), 'empty-or-unavailable-reference');
    check('mysql-reference-unique', reference.rows !== null
      && statistics(reference.rows).uniqueIds === reference.rows.length, 'duplicate-or-unavailable-reference');
    if (reference.rows) entry.statistics.database = statistics(reference.rows);
    check('modules-anonymous-denied', !anonymous.error && anonymous.httpStatus === 401,
      anonymous.error ?? 'expected-http-401', anonymous, moduleUrl.pathname);
    const token = accessToken(login.data);
    const loggedIn = !login.error && login.httpStatus === 200 && login.json && Boolean(token);
    check('native-login', loggedIn, login.error ?? 'invalid-native-login', login, loginUrl.pathname);
    let integrity = !reference.error && !anonymous.error && !login.error;
    if (loggedIn) {
      const missing = await call(moduleUrl, { size: pageSize }, token);
      let missingRows;
      let observationError = missing.error;
      if (!observationError && missing.httpStatus === 200) {
        try { missingRows = projection(missing.data); }
        catch { observationError = 'invalid-module-projection'; }
      }
      // This observation never contributes a passing check, even when it returns real rows.
      entry.observations.push({
        id: 'fetch-without-model-root', status: observationError ? 'fail' : 'observed',
        acceptanceEvidence: false, request: { method: 'POST', path: moduleUrl.pathname },
        response: responseMetadata(missing), error: observationError ?? null,
        ...(missingRows ? { statistics: statistics(missingRows) } : {}),
      });
      integrity &&= !observationError;
      const explicit = await call(moduleUrl, query, token);
      let rows = null;
      let error = explicit.error;
      if (!error && explicit.httpStatus === 200 && explicit.json) {
        try { rows = projection(explicit.data); }
        catch { error = 'invalid-module-projection'; }
      } else {
        error ??= 'expected-http-200-module-array';
      }
      check('modules-explicit-fetch', rows !== null, error, explicit, moduleUrl.pathname);
      check('modules-explicit-nonempty', Boolean(rows?.length), 'empty-or-unavailable-modules');
      check('modules-explicit-unique', rows !== null
        && statistics(rows).uniqueIds === rows.length, 'duplicate-or-unavailable-modules');
      check('modules-system-identity', rows !== null && reference.rows !== null
        && [...rows, ...reference.rows].every(row => row.pssystemid === config.systemId),
      'wrong-or-unavailable-model-system');
      const pagination = explicit.pagination;
      check('modules-pagination-complete', rows !== null && rows.length <= pageSize
        && (pagination.page === null || pagination.page === 0)
        && (pagination.size === null || pagination.size === pageSize)
        && (pagination.total === null || pagination.total === rows.length), 'incomplete-module-page');
      check('modules-exact-db-projection', rows !== null && reference.rows !== null
        && isDeepStrictEqual(rows, reference.rows), 'module-projection-mismatch');
      if (rows) entry.statistics.api = statistics(rows);
      integrity &&= !error;
    } else {
      entry.observations.push({
        id: 'fetch-without-model-root', status: 'fail', acceptanceEvidence: false,
        error: 'native-login-unavailable',
      });
    }
    check('execution-integrity', integrity, 'request-or-database-error');
  } catch {
    check(config ? 'execution-integrity' : 'input-validation', false, 'validation-or-execution-error');
  }
  const checks = entry.checks;
  report.summary = {
    required: checks.length, passed: checks.filter(row => row.status === 'pass').length,
    failed: checks.filter(row => row.status === 'fail').length, skipped: 0,
    observations: entry.observations.length,
  };
  report.status = report.summary.failed === 0 ? 'pass' : 'fail';
  report.exitCode = report.status === 'pass' ? 0 : 1;
  report.readProjectionVerified = !controlled && report.exitCode === 0;
  report.finishedAt = new Date().toISOString();
  const reportDir = config?.reportDir ?? input?.reportDir;
  if (typeof reportDir !== 'string' || !reportDir.trim() || /[\u0000\r\n]/.test(reportDir)) {
    throw new Error('Cannot write failure report without a valid report directory');
  }
  await mkdir(reportDir, { recursive: true });
  const path = join(reportDir, 'report.json');
  const temporary = `${path}.${report.runId}.tmp`;
  await writeFile(temporary, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
  return report.exitCode;
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  try {
    const config = parseArgs(process.argv.slice(2));
    const code = await runHarness(config);
    console.log(`NATIVE MODULE READ PROJECTION ${code === 0 ? 'PASS' : 'FAIL'}`);
    console.log('nativeAcceptance=false; read projection/connectivity only, not isolation, permissions or UI');
    console.log(`Report: ${join(config.reportDir, 'report.json')}`);
    process.exitCode = code;
  } catch {
    console.error('Module read harness failed; check validated inputs and artifact permissions');
    process.exitCode = 1;
  }
}
