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
      environment.AIBIZ_MODELING_SERVICE_URL ?? 'http://127.0.0.1:32002',
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
    } else if (value === '--web-url') {
      config.webUrl = argv[++index];
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
  const fatalLines = logText
    .split(/\r?\n/)
    .filter(line =>
      /(OutOfMemory|Fatal|BindException|APPLICATION FAILED|startup failed|address already in use)/i.test(
        line,
      ),
    )
    .slice(-20);
  if (fatalLines.length > 0) {
    addCheck(
      report,
      `logs:${container.name}`,
      'fail',
      `${fatalLines.length} fatal-looking log line(s); see logs/${container.name}.log`,
      { lines: fatalLines },
    );
  } else {
    const diagnosticLines = logText
      .split(/\r?\n/)
      .filter(line => /\b(ERROR|Exception)\b/i.test(line))
      .slice(-20);
    addCheck(
      report,
      `logs:${container.name}`,
      diagnosticLines.length > 0 ? 'warn' : 'pass',
      diagnosticLines.length > 0
        ? `${diagnosticLines.length} diagnostic line(s); see logs/${container.name}.log`
        : 'no startup-level error markers',
      diagnosticLines.length > 0 ? { lines: diagnosticLines } : {},
    );
  }
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
      signal: controller.signal,
      redirect: 'manual',
    });
    const body = await response.text();
    const expected = expectedStatuses.includes(response.status);
    const contentType = response.headers.get('content-type') ?? '';
    const bodyOk =
      typeof options.bodyIncludes !== 'string' ||
      body.includes(options.bodyIncludes);
    return {
      ok: expected && bodyOk,
      status: response.status,
      contentType,
      bytes: Buffer.byteLength(body),
      bodyPreview: body.slice(0, 240),
      expectedStatuses,
      bodyOk,
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
      error: error.message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function checkHttp(report, name, baseUrl, path, expectedStatuses, options) {
  const url = new URL(path, `${baseUrl.replace(/\/+$/, '')}/`).toString();
  const result = await request(url, expectedStatuses, options);
  const detail = result.error
    ? `request error=${result.error}`
    : `HTTP ${result.status} bytes=${result.bytes} content-type=${result.contentType || 'none'}`;
  addCheck(report, `http:${name}`, result.ok ? 'pass' : 'fail', detail, {
    url,
    expectedStatuses,
    actualStatus: result.status,
    bodyPreview: result.bodyPreview,
  });
  return result;
}

async function stackExists() {
  const results = await Promise.all(
    defaultContainers.map(container =>
      command('docker', ['inspect', container.name], { allowFailure: true }),
    ),
  );
  return results.some(result => result.stdout.trim());
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
  if (dockerInfo.code !== undefined && !dockerInfo.stdout.trim()) {
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

  if (config.mode === 'auto' && !(await stackExists())) {
    report.status = 'skip';
    report.exitCode = 0;
    report.checks.push({
      name: 'modeling-runtime',
      status: 'skip',
      detail: 'modeling containers are not running',
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
    '/',
    [401, 403],
  );
  await checkHttp(
    report,
    'modelingservice-serviceapi-auth',
    config.serviceUrl,
    '/ibizservicerunner/serviceapi/',
    [401, 403],
  );
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
  );
  await checkHttp(
    report,
    'local-jsonschema',
    config.webUrl,
    '/api/ibizmodeling__modeldesign/jsonschema/IDEA',
    [200],
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

export { parseArgs, request, runHarness };

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
