#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PinnedDirectories, readPinnedFile } from './native-candidate-files.mjs';
import { A01_SOURCE_PATHS, createA01RootPlan, verifyA01NativeSources } from './owned-a01-root-http.mjs';

const workspaceDefault = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;

export function inspectA01Readiness({ workspace = workspaceDefault, manifest } = {}) {
  workspace = resolve(workspace);
  const directories = new PinnedDirectories();
  const inputs = [];
  const read = path => {
    const file = readPinnedFile(directories, directories.open(dirname(join(workspace, path))), basename(path));
    inputs.push({ path, sha256: hash(file.data), bytes: file.data.length });
    return file.data.toString('utf8');
  };
  try {
    const sources = Object.fromEntries(Object.entries(A01_SOURCE_PATHS)
      .map(([key, path]) => [key, read(`ibiz-service-hub/${path}`)]));
    verifyA01NativeSources(sources);
    const dispatcher = read('scripts/owned-a01-root-http.mjs');
    const runner = read('scripts/run-owned-a01-root-http.mjs');
    read('scripts/prepare-run-owned-native-nonadmin-matrix.mjs');
    assert.ok(dispatcher.includes('for (const row of plan.invalidRootCases.filter'));
    assert.ok(runner.includes('report = await runOwnedA01Checks('));
    const plan = manifest ? createA01RootPlan(manifest) : null;
    return {
      contract: 'authorization-a01-fresh-http-readiness-v2',
      status: 'partial-runner-implemented-awaiting-fresh-owned-http',
      runId: manifest?.runId ?? null, liveResourcesInspected: false, retiredFixtureReused: false,
      runner: {
        entry: 'scripts/run-owned-a01-root-http.mjs', dispatcher: 'scripts/owned-a01-root-http.mjs',
        invalidRootCasesConsumed: true,
        representable: ['whitespace', 'system-id-as-root', 'unknown-root'],
        blocked: ['absent', 'null', 'empty', 'number-zero'],
        counts: plan?.counts ?? { planned: 84, representable: 36, blocked: 48 },
        requiresFreshOwnedDeployment: true, requiresExplicitDeniedUpdateOptIn: true,
      },
      acceptance: {
        sourceBoundRunnerImplemented: true, ordinaryRoleRootHTTPCanRun: false, a01FreshHTTPCanRun: false,
        boundedRepresentableRootAcceptance: false, fullA01Acceptance: false,
        nativeAcceptance: false, permissionAcceptance: false,
      },
      inputs,
      blockers: [
        'No active owned runtime was inspected. Historical config-r6 and its retired peers cannot establish current readiness.',
        'Native parent pkey is String. Missing/empty/JSON-null/numeric roots remain blocked, not client-side-denial acceptance.',
        'Current Java typed-root service tests were not compiled or replayed by this readiness tool.',
      ],
      nextAction: 'Root coordinates one fresh owned stack, then explicitly invokes run-owned-a01-root-http.mjs with its run-id and deployment-input.',
    };
  } finally { directories.close(); }
}

export function writeA01ReadinessReceipt(report, {
  workspace = workspaceDefault, output = '.artifacts/authorization-a01-readiness-20261114/report.json',
} = {}) {
  workspace = resolve(workspace);
  const path = resolve(workspace, output);
  const child = relative(resolve(workspace, '.artifacts'), path);
  assert.ok(child && child !== '..' && !child.startsWith('../') && !child.startsWith('/'));
  assert.match(path, /authorization-a01-[a-z0-9][a-z0-9-]*\/report\.json$/);
  const directories = new PinnedDirectories();
  try {
    const parent = directories.open(dirname(path), { create: true });
    const bytes = json(report);
    directories.write(parent, basename(path), bytes);
    return { path, sha256: hash(bytes), bytes: Buffer.byteLength(bytes) };
  } finally { directories.close(); }
}

export function main(argv = process.argv.slice(2)) {
  const options = {};
  for (const argument of argv) {
    const match = /^--output=(.+)$/.exec(argument);
    assert.ok(match && !Object.hasOwn(options, 'output'), 'Readiness accepts only one explicit output');
    options.output = match[1];
  }
  const report = inspectA01Readiness();
  const binding = writeA01ReadinessReceipt(report, { output: options.output });
  console.log(json({ path: binding.path, sha256: binding.sha256, status: report.status,
    liveResourcesInspected: false, fullA01Acceptance: false }));
  return { report, binding };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { main(); } catch { console.error('A01 readiness receipt refused.'); process.exitCode = 1; }
}
