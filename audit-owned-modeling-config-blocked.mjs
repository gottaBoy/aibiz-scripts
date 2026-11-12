#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { PinnedDirectories, readPinnedFile } from './native-candidate-files.mjs';
import { readNativeFiveDatasetContract } from './native-five-dataset-contract.mjs';

const workspaceDefault = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = value => createHash('sha256').update(value).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const configEntities = ['PSPF', 'PSPFStyle', 'PSAppType'];

function readPrivate(directories, workspace, path, bindings) {
  path = resolve(workspace, path);
  assert.ok(path.startsWith(`${resolve(workspace)}/`));
  const parent = directories.open(dirname(path));
  const file = readPinnedFile(directories, parent, basename(path));
  const binding = { path: relative(workspace, path), sha256: hash(file.data), bytes: file.data.length };
  bindings.push(binding);
  return JSON.parse(file.data);
}

export function buildOwnedModelingConfigBlockedReceipt({
  workspace = workspaceDefault, runId, deploymentInput, configReadReport,
  routeReport, seedReceipt,
} = {}) {
  workspace = resolve(workspace);
  assert.match(runId ?? '', /^[a-f0-9]{12}$/);
  const directories = new PinnedDirectories();
  const bindings = [];
  try {
    const base = join(workspace, '.artifacts/native-nonadmin-fixtures', runId);
    const manifest = readPrivate(directories, workspace, join(base, 'manifest.json'), bindings);
    assert.equal(manifest.runId, runId);
    const deployment = readPrivate(directories, workspace, deploymentInput, bindings);
    const config = readPrivate(directories, workspace, configReadReport, bindings);
    const route = readPrivate(directories, workspace, routeReport, bindings);
    const seed = readPrivate(directories, workspace, seedReceipt, bindings);
    assert.equal(config.contract, 'owned-editor-config-read-v1');
    assert.equal(config.runId, runId);
    assert.equal(config.status, 'passed-authenticated-config-route-read');
    assert.deepEqual(Object.keys(config.checks).sort(), configEntities.toSorted());
    for (const entity of configEntities) {
      assert.equal(config.checks[entity].status, 200);
      assert.equal(config.checks[entity].rows, 0,
        `Current owned config ${entity} is not empty; retain actual evidence and stop`);
      assert.match(config.checks[entity].responseSha256, /^[a-f0-9]{64}$/);
    }
    assert.equal(route.contract, 'owned-native-platform-http-v1');
    assert.match(route.status, /^passed-/);
    assert.equal(seed.runId, runId);
    assert.equal(seed.status, 'partial-native-create-seeds-app-config-blocked');
    assert.equal(seed.records.length, 8);
    assert.ok(seed.blocked.length > 0);
    assert.ok(seed.records.every(record => record.entity !== 'PSSysApp'));
    const contract = readNativeFiveDatasetContract({ workspace });
    const sourceContractSha256 = hash(json(contract));
    assert.equal(deployment.contract, 'run-owned-native-permission-deployment-input-v2');
    const report = {
      contract: 'owned-modeling-config-blocked-receipt-v1', runId,
      status: 'blocked-config-rows-empty-after-authenticated-read',
      startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(),
      bindings, deploymentInput: bindings.find(binding =>
        binding.path === relative(workspace, resolve(workspace, deploymentInput))),
      routeEvidence: bindings.find(binding =>
        binding.path === relative(workspace, resolve(workspace, routeReport))),
      configReadEvidence: bindings.find(binding =>
        binding.path === relative(workspace, resolve(workspace, configReadReport))),
      partialSeedEvidence: bindings.find(binding =>
        binding.path === relative(workspace, resolve(workspace, seedReceipt))),
      sourceContractSha256,
      configEntities: configEntities.map(entity => ({
        entity, status: config.checks[entity].status, rows: config.checks[entity].rows,
        responseSha256: config.checks[entity].responseSha256,
      })),
      partialNativeRegistry: {
        status: seed.status, records: seed.records.length, appRecords: 0,
        receiptPath: relative(workspace, resolve(workspace, seedReceipt)),
      },
      blockedReasons: [
        'PSPF/PSPFStyle/PSAppType authenticated native READ returned 200 [] for each entity.',
        'No source-bound production configuration IDs or rows are available for App native CREATE.',
        'Historical shared modelingservice/sql/init.sql examples are not owned fixture evidence and are excluded.',
      ],
      sourceContract: {
        contract: contract.contract, entities: contract.datasets.map(row => row.entity),
        inputs: contract.inputs,
      },
      nativeConfigCreateExecuted: false, appNativeCreateExecuted: false,
      sqlMutation: false, productionAcceptance: false, permissionAcceptance: false,
      nextGate: 'Provide exact owned config routes/readback with real coherent PSPF, PSPFStyle and PSAppType rows; then rerun native App CREATE only after full preflight.',
    };
    return report;
  } finally { directories.close(); }
}

export function writeOwnedModelingConfigBlockedReceipt({
  workspace = workspaceDefault, label, ...inputs
} = {}) {
  assert.match(label ?? '', /^[a-z0-9][a-z0-9-]{0,48}$/);
  const workspacePath = resolve(workspace);
  const base = join(workspacePath, '.artifacts/native-nonadmin-fixtures', inputs.runId);
  const directories = new PinnedDirectories();
  try {
    const output = directories.open(join(base, `modeling-config-blocked-${label}`),
      { create: true, exclusive: true });
    const report = buildOwnedModelingConfigBlockedReceipt({ workspace: workspacePath, ...inputs });
    const bytes = Buffer.from(json(report));
    const path = join(output.path, 'report.json');
    const identity = directories.write(output, 'report.json', bytes, 0o600);
    assert.equal(identity.uid, process.geteuid());
    assert.equal(identity.mode & 0o077, 0);
    return { path, sha256: hash(bytes), report };
  } finally { directories.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: {
    label: { type: 'string' }, 'run-id': { type: 'string' },
    'deployment-input': { type: 'string' }, 'config-read-report': { type: 'string' },
    'route-report': { type: 'string' }, 'seed-receipt': { type: 'string' },
  }, strict: true, allowPositionals: false });
  const result = writeOwnedModelingConfigBlockedReceipt({
    label: values.label, runId: values['run-id'], deploymentInput: values['deployment-input'],
    configReadReport: values['config-read-report'], routeReport: values['route-report'],
    seedReceipt: values['seed-receipt'],
  });
  console.log(json({ status: result.report.status, path: result.path,
    sha256: result.sha256, sqlMutation: result.report.sqlMutation,
    configRows: result.report.configEntities.map(row => row.rows) }));
}
