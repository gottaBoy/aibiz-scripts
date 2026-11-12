#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const workspaceDefault = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const runId = '25dd6a7232c7';
const deploymentInput = `.artifacts/native-nonadmin-fixtures/${runId}/backend-runtime-registry-backend-config-r6/deployment-input.private.json`;
const deploymentReport = `.artifacts/native-nonadmin-fixtures/${runId}/backend-runtime-registry-backend-config-r6/report.json`;
const configReadReport = `.artifacts/native-nonadmin-fixtures/${runId}/editor-config-registry-config-r6/report.json`;
const routeReport = `.artifacts/native-nonadmin-fixtures/${runId}/platform-http-registry-config-routes-r1/report.json`;
const sourcePaths = [
  'run-owned-native-permission-http.mjs',
  'prepare-run-owned-native-nonadmin-matrix.mjs',
  'owned-platform-http.mjs',
];

const read = (workspace, path) => {
  const absolute = resolve(workspace, path);
  const bytes = fs.readFileSync(absolute);
  return { path, absolute, bytes, text: bytes.toString('utf8'), sha256: hash(bytes) };
};

export function inspectA01Readiness({ workspace = workspaceDefault } = {}) {
  workspace = resolve(workspace);
  const deployment = JSON.parse(read(workspace, deploymentReport).bytes);
  const input = read(workspace, deploymentInput);
  const config = JSON.parse(read(workspace, configReadReport).bytes);
  const route = JSON.parse(read(workspace, routeReport).bytes);
  const sources = Object.fromEntries(sourcePaths.map(path => [path, read(workspace, `scripts/${path}`)]));
  assert.equal(deployment.contract, 'run-owned-native-backend-startup-v1');
  assert.equal(deployment.status, 'passed-owned-backend-http-transport-only');
  assert.equal(deployment.actualBackendStarted, true);
  assert.equal(deployment.retainedOwned, true);
  assert.equal(config.status, 'passed-authenticated-config-route-read');
  assert.equal(route.status, 'passed-bounded-platform-http');
  assert.equal(Object.values(config.checks).every(row => row.status === 200 && row.rows === 0), true);
  const runner = sources['run-owned-native-permission-http.mjs'].text;
  const matrix = sources['prepare-run-owned-native-nonadmin-matrix.mjs'].text;
  const invalidRootCasesPlanned = matrix.includes('invalidRootCases.push');
  const invalidRootCasesDispatched = runner.includes('matrix.invalidRootCases');
  const typedRootTransport = !runner.includes('applicationContext: row.appContext')
    && runner.includes('headers: { accept:');
  return {
    contract: 'authorization-a01-fresh-http-readiness-v1',
    runId,
    status: invalidRootCasesDispatched ? 'READY-FOR-EXECUTION' : 'BLOCKED-HARNESS-MISSING-DISPATCH',
    deployment: {
      report: deploymentReport, reportSha256: hash(read(workspace, deploymentReport).bytes),
      input: deploymentInput, inputSha256: input.sha256,
      actualBackendStarted: deployment.actualBackendStarted,
      retainedOwned: deployment.retainedOwned,
      startupFatalChecks: deployment.startupLogChecks.filter(row => row.phase === 'final-log'),
    },
    authenticatedConfig: {
      report: configReadReport, status: config.status,
      allThreeRoutes200: Object.values(config.checks).every(row => row.status === 200),
      allThreeEmpty: Object.values(config.checks).every(row => row.rows === 0),
      routeReport,
    },
    matrix: {
      invalidRootCasesPlanned,
      invalidRootCasesDispatched,
      typedRootTransportSupported: false,
      sourceBound: Object.fromEntries(Object.entries(sources).map(([path, file]) =>
        [path, { sha256: file.sha256, bytes: file.bytes.length }])),
    },
    acceptance: {
      ordinaryRoleRootHTTPCanRun: true,
      a01FreshHTTPCanRun: false,
      nativeAcceptance: false,
      permissionAcceptance: false,
    },
    blocker: invalidRootCasesDispatched ? null
      : 'Current executeOwnedMatrix never dispatches matrix.invalidRootCases; request validation only accepts canonical applicationContext headers, so null/number/typed PSDEVSLNSYS cannot be transported without inventing headers.',
    nextAction: 'Add a reviewed transport contract for malformed roots or a server-side test endpoint; then execute invalid-root reads with full physical snapshots and require 403 or bounded input rejection.',
  };
}

function outputPath(workspace, output) {
  const absolute = resolve(workspace, output);
  const child = relative(resolve(workspace, '.artifacts'), absolute);
  assert.ok(child && child !== '..' && !child.startsWith('../') && !child.startsWith('/'));
  assert.match(absolute, /authorization-a01-[a-z0-9][a-z0-9-]*\/report\.json$/);
  return absolute;
}

export function writeA01ReadinessReceipt(report, {
  workspace = workspaceDefault, output = `.artifacts/native-nonadmin-fixtures/${runId}/authorization-a01-readiness-r1/report.json`,
} = {}) {
  workspace = resolve(workspace);
  const absolute = outputPath(workspace, output);
  fs.mkdirSync(dirname(absolute), { recursive: true, mode: 0o700 });
  assert.ok(!fs.existsSync(absolute));
  const bytes = Buffer.from(json(report));
  const descriptor = fs.openSync(absolute, fs.constants.O_WRONLY | fs.constants.O_CREAT
    | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); }
  finally { fs.closeSync(descriptor); }
  return { path: absolute, sha256: hash(bytes), bytes: bytes.length };
}

export function main(argv = process.argv.slice(2)) {
  const options = {};
  for (const argument of argv) {
    const match = /^--output=(.+)$/.exec(argument);
    assert.ok(match && !Object.hasOwn(options, 'output'));
    options.output = match[1];
  }
  const report = inspectA01Readiness();
  const binding = writeA01ReadinessReceipt(report, { output: options.output });
  console.log(json({ path: binding.path, sha256: binding.sha256, status: report.status,
    ordinaryRoleRootHTTPCanRun: report.acceptance.ordinaryRoleRootHTTPCanRun,
    a01FreshHTTPCanRun: report.acceptance.a01FreshHTTPCanRun }));
  return { report, binding };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { main(); } catch { console.error('A01 readiness receipt refused.'); process.exitCode = 1; }
}
