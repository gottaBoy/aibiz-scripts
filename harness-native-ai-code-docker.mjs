#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setImmediate as nextTurn, setTimeout as sleep } from 'node:timers/promises';
import { parseArgs } from 'node:util';
import {
  fingerprint, PinnedDirectories, readPinnedFile, readTree,
} from './native-candidate-files.mjs';
import { verifyNativeAiCodeDeployment } from './prepare-native-ai-code-deployment.mjs';
import { WORKSPACE } from './repair-native-model-resources.mjs';

const templates = fileURLToPath(new URL('./containers/native-ai-code/', import.meta.url));
const hash = data => createHash('sha256').update(data).digest('hex');
const packageName = '@ibiz-template-plugin/ai-code@0.0.3-alpha.141';
const prefixes = ['/plugins/', '/central/plugins/', '/modeldesign/plugins/'];
const runLabel = 'io.aibiz.native-ai-code.run';

function outputPath(workspace, output) {
  const root = join(workspace, '.artifacts/native-ai-code-docker');
  const destination = resolve(workspace, output ?? join(root, `delivery-${randomUUID()}`));
  assert.equal(dirname(destination), root, 'Output must be a direct child of .artifacts/native-ai-code-docker');
  assert.match(relative(root, destination), /^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'Invalid output name');
  return { root, destination };
}

function templateFiles() {
  const directories = new PinnedDirectories();
  try {
    const directory = directories.open(templates);
    return ['Dockerfile', 'nginx.conf'].map(path => {
      const { data } = readPinnedFile(directories, directory, path);
      return { path, data, bytes: data.length, sha256: hash(data) };
    });
  } finally { directories.close(); }
}

export function prepareAiCodeDockerContext(options = {}) {
  const workspace = resolve(options.workspace ?? WORKSPACE);
  const { root, destination } = outputPath(workspace, options.output);
  const verified = verifyNativeAiCodeDeployment({ ...options, workspace });
  const deployment = readTree(resolve(workspace, verified.deployment.path), { jsonOnly: false });
  assert.deepEqual(deployment.entries, verified.deployment.entries, 'Deployment changed before context copy');
  const files = [
    ...templateFiles(),
    ...deployment.contents.map(file => ({ ...file, path: `plugins/${packageName}/${file.path}` })),
  ].sort((a, b) => a.path.localeCompare(b.path));
  const entries = files.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 }));
  const directories = new PinnedDirectories();
  try {
    directories.open(root, { create: true });
    const run = directories.open(destination, { create: true, exclusive: true });
    const contextPath = join(destination, 'context');
    directories.open(contextPath, { create: true, exclusive: true });
    for (const file of files) {
      const path = join(contextPath, file.path);
      directories.write(directories.open(dirname(path), { create: true }), relative(dirname(path), path), file.data);
    }
    assert.deepEqual(readTree(contextPath, { jsonOnly: false }).entries, entries, 'Docker context differs');
    assert.deepEqual(verifyNativeAiCodeDeployment({ ...options, workspace }), verified,
      'Deployment evidence changed during context preparation');
    directories.verify(run);
    return {
      workspace, destination, contextPath, verified, context: { ...fingerprint(entries), entries },
      deploymentReceipt: {
        path: relative(workspace, resolve(workspace, options.receipt)),
        sha256: hash(readPinnedFile(directories,
          directories.open(dirname(resolve(workspace, options.receipt))), 'receipt.json').data),
      },
    };
  } finally { directories.close(); }
}

function docker(args, { allowFailure = false, timeout = 120_000 } = {}) {
  const result = spawnSync('docker', args, {
    encoding: 'utf8', timeout, maxBuffer: 16 * 1024 * 1024,
  });
  if (!allowFailure && (result.error || result.status !== 0)) {
    throw new Error(`docker ${args[0]} failed: ${result.error?.message ?? result.stderr}`);
  }
  return result;
}

function inspectImage(image) {
  assert.ok(typeof image === 'string' && image && !image.startsWith('-'), 'Invalid base image');
  const [result] = JSON.parse(docker(['image', 'inspect', image]).stdout);
  assert.match(result.Id, /^sha256:[a-f0-9]{64}$/);
  return result;
}

function assertNoVolumes(config, subject) {
  assert.deepEqual(Object.keys(config.Volumes ?? {}), [], `${subject} must not declare persistent volumes`);
}

function ownedContainer(stdout, { containerName, containerId, imageId, id }) {
  const containers = JSON.parse(stdout);
  assert.equal(containers.length, 1, 'Expected exactly one isolated container');
  const [container] = containers;
  assert.match(container.Id, /^[a-f0-9]{64}$/);
  if (containerId) assert.equal(container.Id, containerId, 'Isolated container ID changed');
  assert.equal(container.Name, `/${containerName}`, 'Isolated container name differs');
  assert.equal(container.Config.Labels?.[runLabel], id, 'Isolated container ownership differs');
  assert.equal(container.Image, imageId, 'Isolated container image differs');
  return container;
}

function verifyIsolation(container) {
  assertNoVolumes(container.Config, 'Container');
  assert.equal(container.Config.User, '101:101', 'Container must run as non-root nginx');
  assert.equal(container.HostConfig.ReadonlyRootfs, true, 'Container root must be read-only');
  assert.deepEqual(container.HostConfig.Tmpfs, { '/tmp': 'uid=101,gid=101,mode=0700' },
    'Only the isolated /tmp tmpfs is allowed');
  assert.deepEqual(container.HostConfig.CapDrop, ['ALL'], 'Container must drop all capabilities');
  assert.deepEqual(container.HostConfig.CapAdd ?? [], [], 'Container must not add capabilities');
  assert.deepEqual(container.HostConfig.SecurityOpt, ['no-new-privileges:true']);
  assert.equal(container.HostConfig.Privileged ?? false, false, 'Privileged container rejected');
  assert.deepEqual(container.HostConfig.Binds ?? [], [], 'Bind mounts rejected');
  assert.deepEqual(container.HostConfig.Mounts ?? [], [], 'Additional host mounts rejected');
  assert.deepEqual(container.HostConfig.VolumesFrom ?? [], [], 'Inherited volumes rejected');
  assert.ok(Array.isArray(container.Mounts), 'Container mounts must be inspected');
  assert.ok(container.Mounts.every(mount => mount.Type === 'tmpfs' && mount.Destination === '/tmp'),
    'Unexpected container mount');
}

async function httpBytes(url, { signal, timeout = 5000 } = {}) {
  signal?.throwIfAborted();
  const controller = new AbortController();
  const cancel = () => controller.abort(signal.reason);
  signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('HTTP delivery request timed out')), timeout);
  try {
    const response = await fetch(url, { redirect: 'error', signal: controller.signal });
    const bytes = Buffer.from(await response.arrayBuffer());
    signal?.throwIfAborted();
    return { status: response.status, bytes };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
  }
}

export async function verifyAiCodeHttpDelivery(baseUrl, entries, options = {}) {
  const checks = [];
  for (const prefix of prefixes) {
    for (const entry of entries) {
      const path = `${prefix}${packageName}/${entry.path}`;
      const { status, bytes } = await httpBytes(new URL(path, baseUrl), options);
      assert.equal(status, 200, `Plugin HTTP failure: ${path}`);
      assert.equal(bytes.length, entry.bytes, `Plugin HTTP length differs: ${path}`);
      assert.equal(hash(bytes), entry.sha256, `Plugin HTTP hash differs: ${path}`);
      checks.push({ path, status, bytes: bytes.length, sha256: hash(bytes) });
    }
    for (const path of [
      `${prefix}@ibiz-template-plugin/ai-code@0.0.3-alpha.92/package.json`,
      `${prefix}${packageName}/missing.js`,
    ]) {
      const { status } = await httpBytes(new URL(path, baseUrl), options);
      assert.equal(status, 404, `Missing files must not receive a fallback: ${path}`);
      checks.push({ path, status: 404 });
    }
  }
  return checks;
}

export async function runAiCodeDockerHarness(options = {}) {
  const prepared = prepareAiCodeDockerContext(options);
  const { workspace, destination, contextPath, verified } = prepared;
  const id = randomUUID();
  const imageTag = `aibiz/native-ai-code-delivery:${id}`;
  const containerName = `aibiz-native-ai-code-${id}`;
  const report = {
    schemaVersion: 1, contract: 'native-ai-code-isolated-docker-delivery',
    startedAt: new Date().toISOString(), status: 'failed', deliveryStatus: 'failed',
    acceptedForProduction: false, nativeRuntimeAccepted: false,
    ibizDependencySourceBuildsVerified: verified.dependencies.ibizDependencySourceBuildsVerified,
    compilerBuildInDockerVerified: false,
    ...(verified.dependencies.sourceBuildEvidence
      ? { sourceBuildEvidence: verified.dependencies.sourceBuildEvidence } : {}),
    mapping: verified.mapping, deploymentReceipt: prepared.deploymentReceipt,
    deployment: verified.deployment, context: prepared.context,
    image: { tag: imageTag }, container: { name: containerName },
    checks: [], cleanup: { status: 'not-created' }, errors: [],
  };
  const directories = new PinnedDirectories();
  const signal = options.signal;
  let creationAttempted = false;
  let containerId;
  try {
    signal?.throwIfAborted();
    const run = directories.open(destination);
    const baseName = options.baseImage ?? 'nginxinc/nginx-unprivileged:alpine';
    const base = inspectImage(baseName);
    assertNoVolumes(base.Config, 'Base image');
    report.image.base = { requested: baseName, id: base.Id, architecture: base.Architecture };
    const built = docker([
      'build', '--pull=false', '--network=none', '--build-arg', `NGINX_IMAGE=${baseName}`,
      '--tag', imageTag, contextPath,
    ], { allowFailure: true });
    directories.write(run, 'docker-build.log', `${built.stdout ?? ''}${built.stderr ?? ''}`);
    assert.ok(!built.error && built.status === 0, `Docker build failed: ${built.error?.message ?? built.stderr}`);
    const image = inspectImage(imageTag);
    assertNoVolumes(image.Config, 'Built image');
    assert.equal(inspectImage(baseName).Id, base.Id, 'Base image changed during build');
    assert.deepEqual(image.RootFS.Layers.slice(0, base.RootFS.Layers.length), base.RootFS.Layers,
      'Built image does not use the observed local base layers');
    assert.equal(image.Architecture, base.Architecture);
    assert.equal(image.Config.User, '101:101', 'Image must run as non-root nginx');
    report.image.id = image.Id;
    report.image.architecture = image.Architecture;
    report.image.user = image.Config.User;
    assert.deepEqual(readTree(contextPath, { jsonOnly: false }).entries, prepared.context.entries,
      'Docker context changed during build');
    signal?.throwIfAborted();
    creationAttempted = true;
    const createdId = docker([
      'create', '--name', containerName, '--publish', '127.0.0.1::8080',
      '--label', `${runLabel}=${id}`,
      '--read-only', '--tmpfs', '/tmp:uid=101,gid=101,mode=0700',
      '--cap-drop=ALL', '--security-opt=no-new-privileges:true', image.Id,
    ]).stdout.trim();
    assert.match(createdId, /^[a-f0-9]{64}$/);
    containerId = createdId;
    report.container.id = containerId;
    docker(['start', containerId]);
    const container = ownedContainer(docker(['inspect', containerId]).stdout, {
      containerName, containerId, imageId: image.Id, id,
    });
    verifyIsolation(container);
    report.container.isolation = {
      verified: true, imageId: container.Image, user: container.Config.User,
      readOnly: container.HostConfig.ReadonlyRootfs,
      tmpfs: container.HostConfig.Tmpfs, mounts: container.Mounts,
      ownership: { label: runLabel, value: id },
    };
    const [port] = container.NetworkSettings.Ports['8080/tcp'];
    assert.equal(port.HostIp, '127.0.0.1', 'Test container must bind only loopback');
    assert.match(port.HostPort, /^[1-9][0-9]{0,4}$/);
    const baseUrl = `http://127.0.0.1:${port.HostPort}`;
    report.container.url = baseUrl;
    let ready = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      signal?.throwIfAborted();
      try {
        const { status, bytes } = await httpBytes(`${baseUrl}/health`, { signal, timeout: 1000 });
        ready = status === 200 && bytes.toString('utf8') === 'ok\n';
      } catch (error) {
        signal?.throwIfAborted();
      }
      if (ready) break;
      await sleep(200, undefined, { signal });
    }
    assert.ok(ready, 'Isolated nginx did not become ready');
    report.checks = await verifyAiCodeHttpDelivery(baseUrl, verified.deployment.entries, { signal });
    assert.deepEqual(verifyNativeAiCodeDeployment(options), verified,
      'Source/deployment evidence changed during Docker delivery checks');
    assert.deepEqual(readTree(contextPath, { jsonOnly: false }).entries, prepared.context.entries,
      'Docker context changed during delivery checks');
    report.deliveryStatus = 'passed';
  } catch (error) {
    report.errors.push(error.message);
  } finally {
    if (creationAttempted) {
      report.cleanup = { status: 'failed' };
      try {
        // Recover creation after a client failure, but never delete an unowned name.
        const observed = docker(['inspect', containerName], { allowFailure: true, timeout: 10_000 });
        const absent = result => !result.error && result.status !== 0 &&
          /No such (?:object|container)/i.test(result.stderr);
        if (absent(observed)) {
          report.cleanup = { status: 'passed' };
        } else {
          assert.ok(!observed.error && observed.status === 0, 'Could not inspect isolated container for cleanup');
          const container = ownedContainer(observed.stdout, {
            containerName, containerId, imageId: report.image.id, id,
          });
          containerId = container.Id;
          report.container.id = containerId;
          try {
            const logs = docker(['logs', containerId], { allowFailure: true, timeout: 10_000 });
            assert.ok(!logs.error && logs.status === 0, 'Could not capture isolated container logs');
            directories.write(directories.open(destination), 'container.log', `${logs.stdout ?? ''}${logs.stderr ?? ''}`);
          } catch (error) {
            report.errors.push(error.message);
          }
          const removed = docker(['rm', '--force', '--volumes', containerId],
            { allowFailure: true, timeout: 30_000 });
          const missing = docker(['inspect', containerName], { allowFailure: true, timeout: 10_000 });
          const clean = !removed.error && removed.status === 0 && absent(missing);
          report.cleanup = { status: clean ? 'passed' : 'failed', containerId };
          if (!clean) report.errors.push('Failed to confirm isolated container cleanup');
        }
      } catch (error) {
        report.errors.push(error.message);
      }
    }
    // Cross a poll boundary before reporting signals queued during synchronous cleanup.
    await nextTurn();
    await nextTurn();
    report.finishedAt = new Date().toISOString();
    if (signal?.aborted) {
      const reason = signal.reason;
      report.interruption = { signal: reason?.signal ?? null, reason: reason?.message ?? String(reason) };
      if (!report.errors.includes(report.interruption.reason)) report.errors.push(report.interruption.reason);
      report.status = 'interrupted';
    } else if (report.deliveryStatus === 'passed' && report.cleanup.status === 'passed' && !report.errors.length) {
      report.status = 'docker-delivery-passed-native-not-accepted';
    }
    try {
      directories.write(directories.open(destination), 'report.json', `${JSON.stringify(report, null, 2)}\n`);
    } finally { directories.close(); }
  }
  return { ...report, reportPath: relative(workspace, join(destination, 'report.json')) };
}

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({
    args, options: {
      'deployment-receipt': { type: 'string' }, output: { type: 'string' },
      'source-deps-report': { type: 'string' },
      'base-image': { type: 'string' }, help: { type: 'boolean', short: 'h' },
    },
  });
  if (values.help) {
    console.log('Usage: node scripts/harness-native-ai-code-docker.mjs --deployment-receipt PATH [--output PATH] [--base-image LOCAL_IMAGE]');
    console.log('Builds an isolated static delivery image, tests every plugin HTTP hash, then removes its loopback container.');
    console.log('Pass --source-deps-report PATH when the deployment consumes a fresh framework-source build.');
    console.log('Requires local Docker/nginx base, trusted artifact ancestors and one writer; failed artifacts and images remain.');
    console.log('Exit 2: Docker delivery passed but native/source-dependency acceptance remains open; exit 1: failure.');
    console.log('SIGINT/SIGTERM: cleanup then exit 130/143; synchronous Docker commands use bounded timeouts. SIGKILL cannot be handled.');
    return 0;
  }
  assert.ok(values['deployment-receipt'], '--deployment-receipt is required');
  const controller = new AbortController();
  const handlers = ['SIGINT', 'SIGTERM'].map((signal, index) => {
    const handler = () => {
      const error = new Error(`Interrupted by ${signal}`);
      error.signal = signal;
      error.exitCode = index === 0 ? 130 : 143;
      controller.abort(error);
    };
    process.on(signal, handler);
    return { signal, handler };
  });
  try {
    const report = await runAiCodeDockerHarness({
      receipt: values['deployment-receipt'], output: values.output, baseImage: values['base-image'],
      sourceReport: values['source-deps-report'],
      signal: controller.signal,
    });
    console.log(JSON.stringify(report, null, 2));
    if (controller.signal.aborted) return controller.signal.reason.exitCode;
    return report.status === 'docker-delivery-passed-native-not-accepted' ? 2 : 1;
  } finally {
    for (const { signal, handler } of handlers) process.removeListener(signal, handler);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = await main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
