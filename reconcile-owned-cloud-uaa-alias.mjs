#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PinnedDirectories, readPinnedFile } from './native-candidate-files.mjs';
import { privateContainerOrigin } from './harness-run-owned-uaa-runtime.mjs';
import { ownedNativeRuntimeContext } from './owned-native-runtime-context.mjs';
import {
  bindOwnedCloudUaaSource, ownedCloudUaaAlias, publishOwnedUaaAlias, removeOwnedUaaAlias,
} from './owned-nacos-service-alias.mjs';

const workspaceDefault = fileURLToPath(new URL('../', import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
export const CLOUD_UAA_ALIAS_TOOL_INPUTS = Object.freeze([
  'scripts/reconcile-owned-cloud-uaa-alias.mjs', 'scripts/owned-nacos-service-alias.mjs',
  'scripts/owned-native-runtime-context.mjs', 'scripts/harness-run-owned-uaa-runtime.mjs',
  'scripts/native-candidate-files.mjs', 'scripts/run-owned-native-permission-http.mjs',
  'scripts/native-model-design-owned-backend-input.mjs', 'scripts/owned-mysql-volume.mjs',
]);

export function inspectOwnedCloudUaaAlias(context, live, sourceFingerprint, imageId) {
  assert.deepEqual(Object.keys(context.deployment.services).sort(), ['allinone', 'gateway', 'provider', 'uaa']);
  assert.deepEqual(context.deployment.auxiliaryContainers.map(row => row.role).sort(), ['nacos', 'redis', 'zookeeper']);
  const expected = [context.resources.mysqlId, ...Object.values(context.deployment.services).map(row => row.containerId),
    ...context.deployment.auxiliaryContainers.map(row => row.containerId)];
  assert.equal(new Set(expected).size, 8);
  assert.deepEqual(live.containers.map(row => row.Id).sort(), expected.sort(), 'Exactly the existing eight owned peers are required');
  for (const container of live.containers) {
    assert.equal(container.State.Running, true);
    assert.equal(container.Config.Labels?.['aibiz.native-fixture.run'], context.manifest.runId);
  }
  const target = live.containers.find(row => row.Id === context.deployment.services.allinone.containerId);
  assert.equal(target.Image, imageId);
  assert.equal(target.Image, context.deployment.services.allinone.imageId);
  const nacosService = context.deployment.auxiliaryContainers.find(row => row.role === 'nacos');
  const nacos = live.containers.find(row => row.Id === nacosService.containerId);
  assert.equal(nacos.Image, nacosService.imageId);
  return {
    nacosOrigin: privateContainerOrigin(nacos, live.network, 8848),
    alias: ownedCloudUaaAlias({
      runId: context.manifest.runId, origin: privateContainerOrigin(target, live.network, 30000),
      target: { containerId: target.Id, imageId: target.Image, name: target.Name.slice(1) }, sourceFingerprint,
    }),
  };
}

async function http(origin, path, options = {}) {
  const response = await fetch(`${origin}${path}`, {
    ...options, redirect: 'error', signal: AbortSignal.timeout(5000),
  });
  const chunks = [];
  let length = 0;
  for await (const value of response.body ?? []) {
    length += value.length;
    assert.ok(length <= 1024 * 1024, 'Owned Nacos response exceeds its limit');
    chunks.push(value);
  }
  return { status: response.status, bytes: Buffer.concat(chunks) };
}

export async function reconcileOwnedCloudUaaAlias({
  workspace = workspaceDefault, runId, deploymentInput, label, removeReceipt, executeOwned = false,
  execute = spawnSync, contextFactory = ownedNativeRuntimeContext, request = http,
} = {}) {
  assert.equal(executeOwned, true, 'Explicit owned alias reconciliation is required');
  assert.match(runId ?? '', /^[a-f0-9]{12}$/);
  assert.match(label ?? '', /^[a-z0-9][a-z0-9-]{0,48}$/);
  assert.equal(typeof deploymentInput, 'string');
  workspace = resolve(workspace);
  const directories = new PinnedDirectories();
  const bindings = [];
  let context;
  let output;
  const report = {
    contract: 'reconcile-owned-cloud-uaa-alias-v1', runId, label,
    action: removeReceipt ? 'remove' : 'publish', status: 'running', created: false,
    operations: [], nativeAcceptance: false, permissionAcceptance: false, logAcceptance: false,
    mountedConfigurationChanged: false, containersChanged: false,
    limitation: 'Only the exact ibizcloud-uaa alias transition is covered; service-principal logging remains unverified.',
  };
  const read = input => {
    const path = resolve(workspace, input);
    const child = relative(workspace, path);
    assert.ok(child && child !== '..' && !child.startsWith('../') && !child.startsWith('/'));
    const parent = directories.open(dirname(path));
    const name = basename(path);
    const file = readPinnedFile(directories, parent, name);
    bindings.push({ path, parent, name, sha256: hash(file.data), bytes: file.data.length });
    return file.data;
  };
  let identity;
  const guard = () => {
    const live = context.guard();
    for (const binding of bindings) {
      assert.equal(hash(readPinnedFile(directories, binding.parent, binding.name).data), binding.sha256,
        'Alias source/startup/package/tool input drift');
    }
    const current = inspectOwnedCloudUaaAlias(context, live, report.source.fingerprint, report.source.imageId);
    assert.deepEqual(current, identity, 'Owned alias target or registry identity changed');
    return live;
  };
  const guardedRequest = async (origin, path, options) => {
    assert.equal(origin, identity.nacosOrigin);
    const result = await request(origin, path, options);
    report.operations.push({
      method: options?.method ?? 'GET', path, httpStatus: result.status,
      requestBodySha256: options?.body ? hash(options.body.toString()) : null,
      responseSha256: hash(result.bytes),
    });
    return result;
  };
  try {
    context = contextFactory({ workspace, runId, deploymentInput, execute });
    const live = context.guard();
    output = directories.open(join(context.base, `cloud-uaa-alias-${label}`), { create: true, exclusive: true });
    for (const path of CLOUD_UAA_ALIAS_TOOL_INPUTS) read(path);
    const startupPath = join(dirname(resolve(workspace, deploymentInput)), 'report.json');
    const startupBytes = read(startupPath);
    assert.equal(read(join(dirname(startupPath), 'report.sha256')).toString().trim(), hash(startupBytes));
    const startup = JSON.parse(startupBytes);
    assert.equal(startup.contract, 'run-owned-native-backend-startup-v1');
    assert.equal(startup.runId, runId);
    assert.equal(startup.retainedOwned, true);
    assert.equal(startup.actualBackendStarted, true);
    assert.equal(startup.status, 'passed-owned-backend-http-transport-only');
    assert.deepEqual(startup.services, context.deployment.services);
    assert.equal(resolve(workspace, startup.deploymentInput.path), resolve(workspace, deploymentInput));
    assert.equal(hash(read(deploymentInput)), startup.deploymentInput.sha256);
    const imageBytes = read(context.deployment.imageReceipt.path);
    assert.equal(hash(imageBytes), context.deployment.imageReceipt.sha256);
    report.source = bindOwnedCloudUaaSource({ workspace, images: JSON.parse(imageBytes), read });
    identity = inspectOwnedCloudUaaAlias(context, live, report.source.fingerprint, report.source.imageId);
    report.alias = identity.alias;
    report.peers = live.containers.map(row => ({ containerId: row.Id, imageId: row.Image }));
    if (removeReceipt) {
      const path = resolve(workspace, removeReceipt);
      assert.equal(dirname(dirname(path)), context.base);
      assert.match(basename(dirname(path)), /^cloud-uaa-alias-[a-z0-9][a-z0-9-]{0,48}$/);
      assert.equal(basename(path), 'report.json');
      const priorBytes = read(path);
      const priorSha256 = hash(priorBytes);
      assert.equal(read(join(dirname(path), 'report.sha256')).toString().trim(), priorSha256);
      const prior = JSON.parse(priorBytes);
      assert.equal(prior.contract, report.contract);
      assert.equal(prior.runId, runId);
      assert.equal(prior.action, 'publish');
      assert.ok(prior.created === true || prior.status === 'passed-owned-cloud-uaa-alias-transition');
      assert.deepEqual(prior.alias, identity.alias);
      report.removalInput = { path, sha256: priorSha256 };
      report.result = await removeOwnedUaaAlias(identity.nacosOrigin, identity.alias,
        { request: guardedRequest, guard });
    } else {
      report.result = await publishOwnedUaaAlias(identity.nacosOrigin, identity.alias, {
        request: guardedRequest, guard, onCreated: () => { report.created = true; },
      });
    }
    guard();
    report.status = 'passed-owned-cloud-uaa-alias-transition';
  } catch (error) {
    report.status = 'failed-owned-cloud-uaa-alias-transition';
    if (output) {
      const bytes = json({ name: error?.name, message: error?.message, stack: error?.stack });
      directories.write(output, 'failure.private.json', bytes);
      report.failureEvidence = { path: join(output.path, 'failure.private.json'), sha256: hash(bytes) };
    }
  } finally {
    try {
      if (output) {
        report.inputs = [...(context.bindings ?? []), ...bindings.map(({ parent, name, ...entry }) => entry)];
        report.completedAt = new Date().toISOString();
        const bytes = json(report);
        directories.write(output, 'report.json', bytes);
        directories.write(output, 'report.sha256', `${hash(bytes)}\n`);
        fs.fsyncSync(output.descriptor);
      }
    } finally { directories.close(); context?.close(); }
  }
  return { report, reportPath: output ? join(output.path, 'report.json') : null };
}

export async function main(argv = process.argv.slice(2)) {
  const options = {};
  for (const argument of argv) {
    if (argument === '--execute-owned') {
      assert.equal(options.executeOwned, undefined);
      options.executeOwned = true;
    } else {
      const match = /^--(run-id|deployment-input|label|remove-receipt)=(.+)$/.exec(argument);
      assert.ok(match && !Object.hasOwn(options, match[1]), 'Only exact owned alias inputs are allowed');
      options[match[1]] = match[2];
    }
  }
  const result = await reconcileOwnedCloudUaaAlias({
    runId: options['run-id'], deploymentInput: options['deployment-input'], label: options.label,
    removeReceipt: options['remove-receipt'], executeOwned: options.executeOwned ?? false,
  });
  console.log(json({ reportPath: result.reportPath, status: result.report.status, nativeAcceptance: false }));
  if (result.report.status !== 'passed-owned-cloud-uaa-alias-transition') process.exitCode = 1;
  return result;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(() => { console.error('Owned alias reconciliation refused; private details suppressed.'); process.exitCode = 1; });
}
