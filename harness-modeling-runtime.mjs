#!/usr/bin/env node

import { execFile as execFileCallback } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { promisify } from 'node:util';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFile = promisify(execFileCallback);
const scriptPath = fileURLToPath(import.meta.url);
const workspaceRoot = resolve(dirname(scriptPath), '..');
const defaultContainers = [
  { name: 'modelingservice', expectedHealth: 'healthy' },
  { name: 'modelingweb', expectedHealth: 'healthy' },
  { name: 'modeling-plugins', expectedHealth: 'healthy' },
];

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function parseArgs(argv, environment = process.env) {
  const config = {
    mode: environment.AIBIZ_MODELING_RUNTIME_MODE ?? 'required',
    reportDir:
      environment.AIBIZ_MODELING_REPORT_DIR ??
      join(workspaceRoot, '.artifacts/modeling-runtime', timestamp()),
    serviceUrl:
      environment.AIBIZ_MODELING_SERVICE_URL ??
      'http://127.0.0.1:32002/ibizmodeling/modelapi',
    authUrl: environment.AIBIZ_MODELING_AUTH_URL ?? '',
    serviceToken: environment.AIBIZ_MODELING_SERVICE_TOKEN ?? '',
    serviceLoginName:
      environment.AIBIZ_MODELING_LOGINNAME ??
      environment.AIBIZ_LOGINNAME ??
      'aibizhi',
    servicePassword:
      environment.AIBIZ_MODELING_PASSWORD ??
      environment.AIBIZ_PASSWORD ??
      '123456',
    webUrl:
      environment.AIBIZ_MODELING_WEB_URL ?? 'http://127.0.0.1:32003',
    logSince: environment.AIBIZ_MODELING_LOG_SINCE ?? '15m',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--required') {
      config.mode = 'required';
    } else if (value === '--mode') {
      config.mode = argv[++index];
    } else if (value === '--report-dir') {
      config.reportDir = argv[++index];
    } else if (value === '--service-url') {
      config.serviceUrl = argv[++index];
    } else if (value === '--auth-url') {
      config.authUrl = argv[++index];
      if (!config.authUrl) throw new Error('--auth-url requires a value');
    } else if (value === '--web-url') {
      config.webUrl = argv[++index];
    } else if (value === '--service-token') {
      config.serviceToken = argv[++index];
    } else if (value === '--log-since') {
      config.logSince = argv[++index];
    } else if (value === '--help' || value === '-h') {
      console.log(
        [
          'Usage: node harness-modeling-runtime.mjs [options]',
          '  --required                 Require the modeling stack (default)',
          '  --mode auto|required|off   Select missing-stack behavior',
          '  --report-dir DIRECTORY     Write report.json and log evidence here',
          '  --service-url URL          Modelingservice base URL',
          '  --auth-url URL             Authentication base URL (default: web API)',
          '  --service-token TOKEN     Use a pre-issued modeling API token',
          '  --web-url URL              Modelingweb base URL',
          '  --log-since DURATION       Docker log window (default: 15m)',
        ].join('\n'),
      );
      return { help: true, ...config };
    } else {
      throw new Error(`Unknown option: ${value}`);
    }
  }

  if (!['auto', 'required', 'off'].includes(config.mode)) {
    throw new Error(`Invalid --mode: ${config.mode}`);
  }
  for (const [label, value] of [
    ['--report-dir', config.reportDir],
    ['--service-url', config.serviceUrl],
    ['--web-url', config.webUrl],
    ['--log-since', config.logSince],
  ]) {
    if (!value) throw new Error(`${label} requires a value`);
  }
  if (!config.authUrl) {
    config.authUrl = new URL(
      '/api/ibizmodeling__modeldesign/',
      config.webUrl,
    ).href;
  }
  return config;
}

async function command(command, args, { allowFailure = false } = {}) {
  try {
    return await execFile(command, args, {
      cwd: workspaceRoot,
      maxBuffer: 8 * 1024 * 1024,
    });
  } catch (error) {
    if (allowFailure) {
      return {
        stdout: error.stdout ?? '',
        stderr: error.stderr ?? '',
        code: error.code,
      };
    }
    const details = [error.stdout, error.stderr, error.message]
      .filter(Boolean)
      .join('\n')
      .trim();
    throw new Error(`${command} ${args.join(' ')} failed\n${details}`);
  }
}

async function pathExists(path) {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function inspectState(raw) {
  const state = JSON.parse(raw);
  return {
    status: state.Status ?? null,
    running: state.Running === true,
    exitCode: state.ExitCode ?? null,
    oomKilled: state.OOMKilled === true,
    health: state.Health
      ? {
          status: state.Health.Status ?? null,
          log: (state.Health.Log ?? []).slice(-3).map(item => ({
            start: item.Start ?? null,
            end: item.End ?? null,
            exitCode: item.ExitCode ?? null,
            output: String(item.Output ?? '').slice(0, 500),
          })),
        }
      : null,
  };
}

function addCheck(report, name, status, detail, extra = {}) {
  const check = { name, status, detail, ...extra };
  report.checks.push(check);
  const prefix = status === 'pass' ? 'PASS' : status === 'warn' ? 'WARN' : 'FAIL';
  console.log(`[modeling-runtime] ${prefix}: ${name} ${detail}`);
  if (status === 'fail') report.failures.push(`${name}: ${detail}`);
  if (status === 'warn') report.warnings.push(`${name}: ${detail}`);
  return check;
}

function analyzeDockerLogs(result, containerName) {
  const logText = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  const commandFailed =
    result.code !== undefined && Number(result.code) !== 0;
  if (commandFailed) {
    return {
      status: 'fail',
      detail: `docker logs exited with code ${result.code}; see logs/${containerName}.log`,
      lines: logText
        .split(/\r?\n/)
        .filter(Boolean)
        .slice(-20),
    };
  }

  const fatalLines = logText
    .split(/\r?\n/)
    .filter(line =>
      /(OutOfMemory|Fatal|BindException|APPLICATION FAILED|startup failed|address already in use)/i.test(
        line,
      ),
    )
    .slice(-20);
  if (fatalLines.length > 0) {
    return {
      status: 'fail',
      detail: `${fatalLines.length} fatal-looking log line(s); see logs/${containerName}.log`,
      lines: fatalLines,
    };
  }

  const diagnosticLines = logText
    .split(/\r?\n/)
    .filter(line => /\b(ERROR|Exception)\b/i.test(line))
    .slice(-20);
  return {
    status: diagnosticLines.length > 0 ? 'warn' : 'pass',
    detail:
      diagnosticLines.length > 0
        ? `${diagnosticLines.length} diagnostic line(s); see logs/${containerName}.log`
        : 'no startup-level error markers',
    ...(diagnosticLines.length > 0 ? { lines: diagnosticLines } : {}),
  };
}

async function inspectContainer(report, container, reportDir) {
  const result = await command(
    'docker',
    ['inspect', '--format', '{{json .State}}', container.name],
    { allowFailure: true },
  );
  if (!result.stdout.trim()) {
    addCheck(report, `container:${container.name}`, 'fail', 'container is missing');
    return null;
  }

  let state;
  try {
    state = inspectState(result.stdout.trim());
  } catch (error) {
    addCheck(
      report,
      `container:${container.name}`,
      'fail',
      `invalid Docker state: ${error.message}`,
    );
    return null;
  }

  report.containers.push({ name: container.name, ...state });
  await writeFile(
    join(reportDir, 'logs', `${container.name}.health.json`),
    `${JSON.stringify(state.health?.log ?? [], null, 2)}\n`,
  );

  const healthy =
    state.running &&
    !state.oomKilled &&
    state.health?.status === container.expectedHealth;
  addCheck(
    report,
    `container:${container.name}`,
    healthy ? 'pass' : 'fail',
    `status=${state.status} running=${state.running} health=${state.health?.status ?? 'none'} exit=${state.exitCode} oom=${state.oomKilled}`,
  );

  const logs = await command(
    'docker',
    ['logs', '--since', report.logSince, '--tail', '300', container.name],
    { allowFailure: true },
  );
  const logText = `${logs.stdout}${logs.stderr}`;
  await writeFile(join(reportDir, 'logs', `${container.name}.log`), logText);
  const logCheck = analyzeDockerLogs(logs, container.name);
  addCheck(report, `logs:${container.name}`, logCheck.status, logCheck.detail, {
    ...(logCheck.lines ? { lines: logCheck.lines } : {}),
  });
  return state;
}

async function request(url, expectedStatuses, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeoutMs ?? 5000,
  );
  try {
    const response = await fetch(url, {
      method: options.method ?? 'GET',
      headers: options.headers,
      body: options.body,
      signal: controller.signal,
      redirect: 'manual',
    });
    const body = await response.text();
    const expected = expectedStatuses.includes(response.status);
    const contentType = response.headers.get('content-type') ?? '';
    const expectedContentType = options.expectedContentType;
    const contentTypeOk =
      !expectedContentType ||
      contentType.split(';', 1)[0].trim().toLowerCase() ===
        expectedContentType.toLowerCase();
    const bodyOk =
      typeof options.bodyIncludes !== 'string' ||
      body.includes(options.bodyIncludes);
    let parsedBody;
    let jsonOk = true;
    if (options.expectJson || options.bodyValidator) {
      try {
        parsedBody = JSON.parse(body);
      } catch {
        jsonOk = false;
      }
    }
    const bodyValid =
      typeof options.bodyValidator !== 'function' ||
      (jsonOk && options.bodyValidator(parsedBody));
    return {
      ok: expected && bodyOk && contentTypeOk && jsonOk && bodyValid,
      status: response.status,
      contentType,
      bytes: Buffer.byteLength(body),
      bodyPreview: options.exposeBody === false ? '' : body.slice(0, 240),
      expectedStatuses,
      bodyOk,
      bodyValid,
      jsonOk,
      parsedBody,
      expectedContentType,
      contentTypeOk,
    };
  } catch (error) {
    return {
      ok: false,
      status: null,
      contentType: '',
      bytes: 0,
      bodyPreview: '',
      expectedStatuses,
      bodyOk: false,
      bodyValid: false,
      jsonOk: false,
      expectedContentType: options.expectedContentType,
      contentTypeOk: false,
      error: error.message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function accessToken(body) {
  if (!body || typeof body !== 'object') return null;
  const candidates = [
    body.token,
    body.access_token,
    body.data?.token,
    body.data?.access_token,
  ];
  return candidates.find(value =>
    typeof value === 'string' && value.trim().length > 0,
  ) ?? null;
}

function validFetchDefaultList(body) {
  return Array.isArray(body) && body.every(item =>
    item !== null &&
    typeof item === 'object' &&
    !Array.isArray(item) &&
    typeof item.id === 'string' &&
    item.id.trim().length > 0,
  );
}

function validApplicationModel(body) {
  return body !== null && typeof body === 'object' && !Array.isArray(body) &&
    typeof body.codeName === 'string' && body.codeName.trim().length > 0 &&
    ['getAllPSAppDataEntities', 'getAllPSAppViews'].every(key =>
      Array.isArray(body[key]) && body[key].length > 0 &&
      body[key].every(item => item !== null && typeof item === 'object' && !Array.isArray(item)));
}

function validObjectSchema(body) {
  return body !== null && typeof body === 'object' && !Array.isArray(body) &&
    body.type === 'object' && body.properties !== null &&
    typeof body.properties === 'object' && !Array.isArray(body.properties) &&
    Object.keys(body.properties).length > 0;
}

async function authenticateModelingService(config) {
  if (config.serviceToken) {
    return { ok: true, token: config.serviceToken, source: 'configured-token' };
  }
  const result = await request(
    new URL('v7/login', `${config.authUrl.replace(/\/+$/, '')}/`),
    [200],
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        loginname: config.serviceLoginName,
        password: config.servicePassword,
      }),
      expectJson: true,
      exposeBody: false,
    },
  );
  const token = result.jsonOk ? accessToken(result.parsedBody) : null;
  return {
    ok: result.ok && Boolean(token),
    token,
    source: 'login',
    result,
  };
}

async function checkModelingServiceBusiness(report, config) {
  const auth = await authenticateModelingService(config);
  if (!auth.ok) {
    const result = auth.result;
    const detail = result?.error
      ? `login request error=${result.error}`
      : `login HTTP ${result?.status ?? 'none'} token_present=${Boolean(auth.token)}`;
    addCheck(report, 'modelingservice-login', 'fail', detail);
    return null;
  }

  addCheck(
    report,
    'modelingservice-login',
    'pass',
    `authentication=${auth.source} token_present=true`,
  );
  const result = await request(
    new URL(
      'psdevusers/fetchdefault',
      `${config.serviceUrl.replace(/\/+$/, '')}/`,
    ),
    [200],
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${auth.token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ page: 0, size: 20 }),
      expectJson: true,
      bodyValidator: validFetchDefaultList,
    },
  );
  const detail = result.error
    ? `request error=${result.error}`
    : `HTTP ${result.status} bytes=${result.bytes} response_shape=${
        result.bodyValid ? 'list' : 'invalid'
      }`;
  addCheck(
    report,
    'modelingservice-psdevusers-fetchdefault',
    result.ok ? 'pass' : 'fail',
    detail,
    {
      actualStatus: result.status,
      expectedStatuses: [200],
      bodyValid: result.bodyValid,
    },
  );
  return auth.token;
}

async function checkHttp(report, name, baseUrl, path, expectedStatuses, options) {
  const url = new URL(path, `${baseUrl.replace(/\/+$/, '')}/`).toString();
  const result = await request(url, expectedStatuses, options);
  const detail = result.error
    ? `request error=${result.error}`
    : `HTTP ${result.status} bytes=${result.bytes} content-type=${result.contentType || 'none'}${
        options?.expectedContentType
          ? ` expected-content-type=${options.expectedContentType}`
          : ''
      }`;
  addCheck(report, `http:${name}`, result.ok ? 'pass' : 'fail', detail, {
    url,
    expectedStatuses,
    actualStatus: result.status,
    actualContentType: result.contentType,
    ...(options?.expectedContentType
      ? { expectedContentType: options.expectedContentType }
      : {}),
    bodyPreview: result.bodyPreview,
  });
  return result;
}

function summarizeStackResults(results) {
  let existing = 0;
  let running = 0;
  let errors = 0;
  for (const result of results) {
    if (result.code !== undefined) {
      errors += 1;
      continue;
    }
    if (!result.stdout?.trim()) continue;
    existing += 1;
    try {
      if (inspectState(result.stdout.trim()).running) running += 1;
    } catch {
      errors += 1;
    }
  }
  return { existing, running, errors };
}

async function inspectStack() {
  const results = await Promise.all(
    defaultContainers.map(container =>
      command(
        'docker',
        ['inspect', '--format', '{{json .State}}', container.name],
        { allowFailure: true },
      ),
    ),
  );
  return summarizeStackResults(results);
}

async function runHarness(config) {
  const reportDir = resolve(config.reportDir);
  await mkdir(join(reportDir, 'logs'), { recursive: true });
  const report = {
    schemaVersion: 1,
    status: 'fail',
    exitCode: 1,
    timestamp: new Date().toISOString(),
    mode: config.mode,
    workspaceRoot,
    serviceUrl: config.serviceUrl,
    authUrl: config.authUrl,
    webUrl: config.webUrl,
    logSince: config.logSince,
    reportDir,
    containers: [],
    checks: [],
    warnings: [],
    failures: [],
    artifacts: {
      logs: 'logs/',
      report: 'report.json',
    },
  };

  const save = async () => {
    await writeFile(join(reportDir, 'report.json'), `${JSON.stringify(report, null, 2)}\n`);
  };

  if (config.mode === 'off') {
    report.status = 'skip';
    report.exitCode = 0;
    report.checks.push({
      name: 'modeling-runtime',
      status: 'skip',
      detail: 'disabled by --mode off',
    });
    await save();
    console.log(`[modeling-runtime] SKIP: report=${join(reportDir, 'report.json')}`);
    return 0;
  }

  const dockerInfo = await command('docker', ['info'], { allowFailure: true });
  if (dockerInfo.code !== undefined) {
    if (config.mode === 'auto') {
      report.status = 'skip';
      report.exitCode = 0;
      report.checks.push({
        name: 'docker',
        status: 'skip',
        detail: 'Docker daemon is unavailable',
      });
      await save();
      console.log(`[modeling-runtime] SKIP: report=${join(reportDir, 'report.json')}`);
      return 0;
    }
    addCheck(report, 'docker', 'fail', 'Docker daemon is unavailable');
    await save();
    return 1;
  }

  const stack = await inspectStack();
  report.stack = stack;
  if (config.mode === 'auto' && stack.running === 0 && stack.errors === 0) {
    report.status = 'skip';
    report.exitCode = 0;
    report.checks.push({
      name: 'modeling-runtime',
      status: 'skip',
      detail:
        stack.existing === 0
          ? 'modeling containers are not present'
          : 'modeling containers are present but none are running',
    });
    await save();
    console.log(`[modeling-runtime] SKIP: report=${join(reportDir, 'report.json')}`);
    return 0;
  }

  for (const container of defaultContainers) {
    await inspectContainer(report, container, reportDir);
  }

  await checkHttp(
    report,
    'modelingservice-root-auth',
    config.serviceUrl,
    '',
    [401, 403],
  );
  const token = await checkModelingServiceBusiness(report, config);
  if (token) {
    await checkHttp(
      report,
      'modelingservice-proxy-business',
      config.webUrl,
      '/api/ibizmodeling__modeldesign/psdevusers/fetchdefault',
      [200],
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ page: 0, size: 20 }),
        expectJson: true,
        bodyValidator: validFetchDefaultList,
      },
    );
  }
  await checkHttp(
    report,
    'modelingweb-page',
    config.webUrl,
    '/modeldesign/',
    [200],
  );
  await checkHttp(
    report,
    'modelingweb-doc',
    config.webUrl,
    '/modeldesign/doc/',
    [200],
  );
  await checkHttp(
    report,
    'modelingweb-doc-readme',
    config.webUrl,
    '/modeldesign/doc/README.md',
    [200],
    { expectedContentType: 'text/markdown' },
  );
  await checkHttp(
    report,
    'plugin-sidecar-through-web',
    config.webUrl,
    '/modeling-plugins/healthz',
    [200],
  );
  await checkHttp(
    report,
    'local-remotemodel',
    config.webUrl,
    '/api/ibizmodeling__modeldesign/remotemodel/PSSYSAPP.hub.json',
    [200],
    {
      expectedContentType: 'application/json',
      expectJson: true,
      bodyValidator: validApplicationModel,
      exposeBody: false,
    },
  );
  await checkHttp(
    report,
    'local-jsonschema',
    config.webUrl,
    '/api/ibizmodeling__modeldesign/jsonschema/IDEA',
    [200],
    {
      expectedContentType: 'application/schema+json',
      expectJson: true,
      bodyValidator: validObjectSchema,
      exposeBody: false,
    },
  );
  await checkHttp(
    report,
    'modelingservice-proxy-auth',
    config.webUrl,
    '/api/ibizmodeling__modeldesign/',
    [401, 403],
  );

  report.status = report.failures.length === 0 ? 'pass' : 'fail';
  report.exitCode = report.status === 'pass' ? 0 : 1;
  await save();
  console.log(
    `[modeling-runtime] ${report.status.toUpperCase()}: report=${join(reportDir, 'report.json')}`,
  );
  return report.exitCode;
}

export {
  analyzeDockerLogs,
  authenticateModelingService,
  checkModelingServiceBusiness,
  parseArgs,
  request,
  runHarness,
  summarizeStackResults,
  validApplicationModel,
  validFetchDefaultList,
  validObjectSchema,
};

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  try {
    const config = parseArgs(process.argv.slice(2));
    if (config.help) process.exit(0);
    process.exitCode = await runHarness(config);
  } catch (error) {
    console.error(`[modeling-runtime] FAIL: ${error.stack ?? error.message}`);
    process.exitCode = 1;
  }
}
