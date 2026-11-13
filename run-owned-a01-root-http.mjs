#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PinnedDirectories, readPinnedFile } from './native-candidate-files.mjs';
import { ownedNativeRuntimeContext } from './owned-native-runtime-context.mjs';
import { readNativeFiveDatasetContract } from './native-five-dataset-contract.mjs';
import {
  editorPhysicalInventorySQL, editorPhysicalSnapshotSQL, normalizeEditorPhysicalSnapshot,
  validateEditorPhysicalInventory,
} from './probe-owned-editor-registry-http.mjs';
import {
  A01_SOURCE_PATHS, createA01RootPlan, runOwnedA01Checks, verifyA01NativeSources,
} from './owned-a01-root-http.mjs';

const workspaceDefault = fileURLToPath(new URL('../', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const modelApiPath = 'vendor-upstream/ibizmodeling-standard/modelapi-core/src/main/resources/model/net/ibizsys/modeling/PSSYSSERVICEAPIS/ModelAPI.json';
const tools = [
  'scripts/owned-a01-root-http.mjs', 'scripts/run-owned-a01-root-http.mjs',
  'scripts/prepare-run-owned-native-nonadmin-matrix.mjs', 'scripts/owned-platform-http.mjs',
  'scripts/owned-native-runtime-context.mjs', 'scripts/run-owned-native-permission-http.mjs',
  'scripts/native-five-dataset-contract.mjs', 'scripts/probe-owned-editor-registry-http.mjs',
  'scripts/harness-run-owned-uaa-runtime.mjs',
];
const inside = (workspace, path) => {
  const child = relative(resolve(workspace), resolve(path));
  assert.ok(child && child !== '..' && !child.startsWith('../') && !child.startsWith('/'),
    'A01 input must remain within the workspace');
};

export function verifyA01PublishedMethods(api) {
  const relation = api.getPSDEServiceAPIRSs.filter(row => row.getMajorPSDEServiceAPI.id === 'PSDevSlnSys'
    && row.getMinorPSDEServiceAPI.id === 'PSModule');
  assert.equal(relation.length, 1);
  for (const [name, method, permission, key] of [
    ['Get', 'GET', 'READ', true], ['FetchCurSys', 'POST', 'READ', false], ['Update', 'PUT', 'UPDATE', true],
  ]) {
    const matches = relation[0].getPSDEServiceAPIMethods.filter(row => row.name === name);
    assert.equal(matches.length, 1);
    assert.deepEqual([matches[0].requestMethod, matches[0].dataAccessAction,
      matches[0].needResourceKey === true], [method, permission, key]);
  }
  return true;
}

export function a01MountedModelPath(context, live, deploymentInput) {
  const provider = live.containers.find(container => container.Id === context.deployment.services.provider.containerId);
  assert.ok(provider);
  const mounts = provider.Mounts.filter(mount => mount.Destination === '/app/model');
  assert.equal(mounts.length, 1);
  assert.equal(mounts[0].Type, 'bind');
  assert.equal(mounts[0].RW, false);
  const model = join(dirname(deploymentInput), 'model-input');
  assert.equal(mounts[0].Source, model, 'Only this deployment own staged model is eligible');
  inside(context.base, model);
  return join(model, 'PSSYSSERVICEAPIS/ModelAPI.json');
}

export function guardA01Bindings(context, directories, bindings) {
  const live = context.guard();
  for (const binding of bindings) {
    const file = readPinnedFile(directories, binding.parent, binding.name);
    assert.equal(hash(file.data), binding.sha256, 'A01 source or deployment evidence drift');
  }
  return live;
}

export function assertA01ReadOnlySQL(statement) {
  assert.equal(typeof statement, 'string');
  assert.ok(statement.trim() && statement.length < 16 * 1024 * 1024);
  assert.ok(!/\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP|GRANT|REVOKE|TRUNCATE|INTO|OUTFILE|DUMPFILE|CALL|LOAD)\b/i.test(statement));
  assert.ok(!/--|\/\*|\\/.test(statement));
  const statements = statement.trim().split(';').map(part => part.trim()).filter(Boolean);
  assert.ok(statements.length > 0 && statements.every(part => part.startsWith('SELECT JSON_OBJECT(')));
  return true;
}

export async function executeOwnedA01({
  workspace = workspaceDefault, runId, deploymentInput, label,
  executeOwned = false, allowDeniedUpdates = false,
  contextFactory = ownedNativeRuntimeContext, execute = spawnSync,
} = {}) {
  assert.equal(executeOwned, true, 'Explicit owned A01 execution is required');
  assert.equal(allowDeniedUpdates, true, 'Explicit owned denied UPDATE opt-in is required');
  assert.match(runId ?? '', /^[a-f0-9]{12}$/);
  assert.match(label ?? '', /^[a-z0-9][a-z0-9-]{0,48}$/);
  assert.equal(typeof deploymentInput, 'string');
  workspace = resolve(workspace);
  const context = contextFactory({ workspace, runId, deploymentInput, execute });
  const directories = new PinnedDirectories();
  const bindings = [];
  let output;
  let report;
  let stage = 'fresh-owned-runtime-inspection';
  let serial = 0;
  const read = path => {
    path = resolve(workspace, path);
    inside(workspace, path);
    const parent = directories.open(dirname(path));
    const name = basename(path);
    const file = readPinnedFile(directories, parent, name);
    bindings.push({ path, parent, name, sha256: hash(file.data), bytes: file.data.length });
    return file.data;
  };
  const guard = () => guardA01Bindings(context, directories, bindings);
  const write = (name, value) => {
    const bytes = json(value);
    const identity = directories.write(output, name, bytes);
    const fd = fs.openSync(directories.entry(output, name), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      assert.equal(fs.fstatSync(fd).ino, identity.ino);
      fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    fs.fsyncSync(output.descriptor);
    return { path: join(output.path, name), sha256: hash(bytes), bytes: Buffer.byteLength(bytes) };
  };
  const sql = statement => {
    assertA01ReadOnlySQL(statement);
    guard();
    const result = execute('docker', ['exec', '-i', context.resources.mysqlId, 'sh', '-c',
      'test -n "$MYSQL_ROOT_PASSWORD" && MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -h127.0.0.1 --protocol=TCP -uroot --default-character-set=utf8mb4 --batch --raw --skip-column-names'],
    { input: statement, encoding: 'utf8', timeout: 60_000, maxBuffer: 64 * 1024 * 1024 });
    write(`sql-${String(++serial).padStart(4, '0')}.private.json`, {
      statementSha256: hash(statement), exitCode: result.status, signal: result.signal,
      stdoutSha256: hash(result.stdout ?? ''), stderrSha256: hash(result.stderr ?? ''),
    });
    assert.ok(result.status === 0 && !result.error && !result.signal, 'A01 owned physical snapshot failed');
    guard();
    const lines = result.stdout.trim().split('\n').filter(Boolean);
    assert.ok(lines.length <= 100_000);
    return lines.map(line => JSON.parse(line));
  };
  try {
    // Fresh inspection is mandatory before any output/SQL/HTTP. An old receipt
    // cannot turn a retired fixture into a live target.
    context.guard();
    output = directories.open(join(context.base, `authorization-a01-${label}`), { create: true, exclusive: true });
    stage = 'source-and-native-transport-contract';
    for (const path of tools) read(path);
    const images = JSON.parse(read(context.deployment.imageReceipt.path));
    assert.equal(bindings.at(-1).sha256, context.deployment.imageReceipt.sha256);
    const build = JSON.parse(read(images.packageReceipt.path));
    assert.equal(bindings.at(-1).sha256, images.packageReceipt.sha256);
    assert.equal(build.status, 'passed-package-and-unit-only');
    const sources = {};
    for (const [key, path] of Object.entries(A01_SOURCE_PATHS)) {
      const bytes = read(join(build.worktree, path));
      assert.equal(hash(bytes), build.sourceInputs.before.entries.find(row => row.path === path)?.sha256);
      assert.equal(hash(read(join(workspace, 'ibiz-service-hub', path))), hash(bytes));
      sources[key] = bytes.toString('utf8');
    }
    verifyA01NativeSources(sources);
    const modelApiBytes = read(modelApiPath);
    const stagedApiBytes = read(a01MountedModelPath(context, guard(), resolve(workspace, deploymentInput)));
    assert.equal(hash(stagedApiBytes), hash(modelApiBytes), 'Mounted native ModelAPI must match the reviewed source');
    verifyA01PublishedMethods(JSON.parse(stagedApiBytes));
    const schema = readNativeFiveDatasetContract({ workspace });
    const schemaHash = hash(json(schema));
    for (const input of schema.inputs.filter(input => input.bytes <= 64 * 1024 * 1024)) {
      assert.equal(hash(read(input.path)), input.sha256);
    }
    write('plan.json', createA01RootPlan(context.manifest));
    stage = 'complete-physical-model-snapshot';
    const inventorySQL = editorPhysicalInventorySQL(context.manifest);
    const inventory = sql(inventorySQL);
    const targets = validateEditorPhysicalInventory(context.manifest, schema, inventory);
    const snapshotSQL = editorPhysicalSnapshotSQL(targets);
    const snapshot = () => {
      assert.deepEqual(sql(inventorySQL), inventory, 'A01 physical schema drift');
      return normalizeEditorPhysicalSnapshot(inventory, targets, sql(snapshotSQL));
    };
    stage = 'native-invalid-root-dispatch-and-controls';
    report = await runOwnedA01Checks({
      context: { ...context, guard }, snapshot, allowDeniedUpdates,
      record: async (name, value) => write(name, value),
    });
    stage = 'final-source-and-runtime-integrity';
    guard();
    // The large source schema dump is guarded by its own no-symlink reader;
    // re-read after HTTP so an unpinned large source cannot evade final drift.
    assert.equal(hash(json(readNativeFiveDatasetContract({ workspace }))), schemaHash);
    report.inputs = [...context.bindings, ...bindings.map(({ parent, name, ...binding }) => binding)];
    report.snapshotCoverage = { tables: targets.length, columns: inventory.length,
      schemas: context.manifest.roots.map(root => root.database), everyHTTPBeforeAndAfter: true };
    report.liveResourcesInspected = true;
    report.stage = 'complete';
  } catch {
    report ??= { contract: 'owned-a01-native-root-http-v1', runId, authentication: [], controls: [],
      invalidRootCases: [], fullA01Acceptance: false, nativeAcceptance: false, permissionAcceptance: false,
      unresolved: [] };
    report.status = 'failed-owned-a01-http';
    report.boundedRepresentableRootAcceptance = false;
    report.stage = stage;
    report.unresolved.push('Fresh owned peer/source/native-route or snapshot gate failed. No shared fallback and no full A01 acceptance.');
  } finally {
    if (output) {
      report.completedAt = new Date().toISOString();
      write('report.json', report);
    }
    directories.close(); context.close();
  }
  return { report, reportPath: output ? join(output.path, 'report.json') : null };
}

export async function main(argv = process.argv.slice(2)) {
  const options = {};
  for (const argument of argv) {
    const flag = { '--execute-owned-a01': 'executeOwned', '--allow-owned-denied-updates': 'allowDeniedUpdates' }[argument];
    if (flag) { assert.ok(!options[flag], 'Duplicate A01 option'); options[flag] = true; continue; }
    const match = /^--(run-id|deployment-input|label)=(.+)$/.exec(argument);
    assert.ok(match && !Object.hasOwn(options, match[1]), 'Only explicit owned A01 options are allowed');
    options[match[1]] = match[2];
  }
  const result = await executeOwnedA01({
    runId: options['run-id'], deploymentInput: options['deployment-input'], label: options.label,
    executeOwned: options.executeOwned ?? false, allowDeniedUpdates: options.allowDeniedUpdates ?? false,
  });
  console.log(json({ reportPath: result.reportPath, status: result.report.status,
    boundedRepresentableRootAcceptance: result.report.boundedRepresentableRootAcceptance,
    fullA01Acceptance: false }));
  if (!result.report.boundedRepresentableRootAcceptance) process.exitCode = 1;
  return result;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(() => { console.error('Owned A01 execution refused; private details suppressed.'); process.exitCode = 1; });
}
