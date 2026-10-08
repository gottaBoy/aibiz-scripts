#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { isIP } from 'node:net';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  backendImageProbeCommand, PINNED_BACKEND_RUNTIME_IMAGE, verifyBackendSourceImages,
} from './harness-backend-source-images.mjs';
import { PinnedDirectories, directoryPath, readPinnedFile, readTree } from './native-candidate-files.mjs';
import { isolatedLaunchInput } from './native-model-design-isolated-launch.mjs';
import {
  stripNativePlmCounterNginxBlock, verifyNativeAiCodeRuntimeAssets,
} from './prepare-native-ai-code-runtime-assets.mjs';
import { validateDeployment } from './run-owned-native-permission-http.mjs';

const defaultWorkspace = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const toolPath = 'scripts/native-model-design-owned-backend-input.mjs';
const outputRoot = '.artifacts/native-model-design-owned-backend';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const shaPattern = /^[a-f0-9]{64}$/;
const imagePattern = /^sha256:[a-f0-9]{64}$/;
const ownerLabel = 'aibiz.native-fixture.run';

function keys(value, expected) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(), [...expected].sort());
}

function childOf(root, path) {
  assert.equal(typeof path, 'string');
  const absolute = resolve(root, path);
  const child = relative(root, absolute);
  assert.ok(child && child !== '..' && !child.startsWith(`..${sep}`) && !child.startsWith(sep));
  assert.ok(!/[,\r\n\0:]/.test(absolute), 'Ambiguous input path');
  return absolute;
}

function read(directories, path, { privateInput = false } = {}) {
  const parent = directories.open(dirname(path));
  const file = readPinnedFile(directories, parent, basename(path));
  if (privateInput) {
    assert.equal(file.identity.uid, process.geteuid());
    assert.equal(file.identity.mode & 0o077, 0);
  }
  return { path, ...file, sha256: hash(file.data) };
}

function readJSON(directories, path, options) {
  const file = read(directories, path, options);
  return { ...file, value: JSON.parse(file.data.toString('utf8')) };
}

function bind(file) {
  return { path: file.path, bytes: file.data.length, sha256: file.sha256 };
}

function dockerJSON(args, execute) {
  assert.ok((args[0] === 'inspect' && args.slice(1).every(id => shaPattern.test(id))) ||
    (args[0] === 'network' && args[1] === 'inspect' && args.length === 3 && shaPattern.test(args[2])) ||
    (args[0] === 'image' && args[1] === 'inspect' && args.length === 3 &&
      args[2] === 'aibiz/modelingweb:local'), 'Only read-only Docker inspection is allowed');
  const result = execute('docker', args, {
    encoding: 'utf8', timeout: 60_000, maxBuffer: 16 * 1024 * 1024,
  });
  assert.ok(!result.error && result.status === 0 && !result.signal, 'Docker inspection failed');
  const value = JSON.parse(result.stdout);
  assert.ok(Array.isArray(value));
  return value;
}

// Existing image verification rechecks source/JAR/recipe/log bindings. Its
// immutable-image file probes are replayed from bound logs, never launched.
// Live image inspect still has to agree with the originally probed image ID.
export function verifyOwnedBackendImagesReadOnly({
  workspace = defaultWorkspace, reportPath, execute = spawnSync,
  verifyImages = verifyBackendSourceImages,
} = {}) {
  const directories = new PinnedDirectories();
  try {
    reportPath = childOf(workspace, reportPath);
    const persisted = readJSON(directories, reportPath);
    const report = persisted.value;
    const probes = new Map();
    const logBindings = [];
    const imageReferences = new Set([PINNED_BACKEND_RUNTIME_IMAGE]);
    const inspected = new Set();
    const replayed = new Set();
    for (const component of report.components) {
      assert.match(component.image.id, imagePattern);
      imageReferences.add(component.reference);
      const command = backendImageProbeCommand({
        imageId: component.image.id, name: component.probeName,
        files: component.imageFiles.map(file => file.path),
      });
      const recorded = report.commands.find(row => row.executable === command.executable &&
        JSON.stringify(row.args) === JSON.stringify(command.args));
      assert.ok(recorded?.exitCode === 0 && recorded.signal === null && recorded.error === null);
      assert.equal(recorded.log.path, `${component.name}-probe.log`);
      const log = read(directories, join(dirname(reportPath), recorded.log.path));
      assert.deepEqual(recorded.log, {
        path: basename(log.path), bytes: log.data.length, sha256: log.sha256,
      });
      assert.ok(!probes.has(JSON.stringify(command.args)));
      probes.set(JSON.stringify(command.args), log.data.toString('utf8'));
      logBindings.push(log);
    }
    const result = verifyImages({ workspace, reportPath, execute: (executable, args, options) => {
      assert.equal(executable, 'docker');
      if (args[0] === 'image') {
        assert.equal(args.length, 5);
        assert.deepEqual(args.slice(0, 4), ['image', 'inspect', '--format', '{{json .}}']);
        assert.ok(imageReferences.has(args[4]), 'Undeclared image inspection');
        const value = execute(executable, args, options);
        inspected.add(args[4]);
        return value;
      }
      const recorded = probes.get(JSON.stringify(args));
      assert.ok(recorded !== undefined, 'Unrecorded or mutating Docker command refused');
      replayed.add(JSON.stringify(args));
      return { status: 0, signal: null, stdout: recorded };
    } });
    assert.deepEqual([...inspected].sort(), [...imageReferences].sort());
    assert.deepEqual([...replayed].sort(), [...probes.keys()].sort());
    assert.equal(result.reportPath, reportPath);
    assert.equal(result.reportSha256, persisted.sha256);
    assert.equal(result.imageArtifactBindingVerified, true);
    assert.deepEqual(result.report, report);
    for (const file of [persisted, ...logBindings]) {
      assert.equal(read(directories, file.path).sha256, file.sha256);
    }
    return { ...result, verificationMode: 'source-and-recorded-probes-with-live-image-inspection',
      freshImageFileProbeExecuted: false };
  } finally { directories.close(); }
}

export function ownedBackendNginx(source, origins) {
  const origin = (value, port) => {
    const url = new URL(value);
    assert.equal(url.origin, value);
    assert.equal(url.protocol, 'http:');
    assert.equal(isIP(url.hostname), 4);
    const [a, b] = url.hostname.split('.').map(Number);
    assert.ok(a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168));
    assert.equal(url.port, String(port));
  };
  origin(origins.backend, 30086);
  origin(origins.uaa, 32666);
  // The owned private network has no PLM service, so the localized counter
  // bridge added by the runtime asset generator must not reach this deployment.
  source = stripNativePlmCounterNginxBlock(source);
  const changes = [
    ['set $native_service http://modelingservice:32002;', `set $native_service ${origins.backend};`],
    ['set $native_auth http://ibiz-ebsx-allinone:30000;', `set $native_auth ${origins.backend};`],
    ['set $native_uaa http://ibizlab-uaa-api:32666;', `set $native_uaa ${origins.uaa};`],
    ['        rewrite ^/api/nativeapicode/(.*)$ /ibizmodeling/modelapi/$1 break;\n', ''],
  ];
  let result = source;
  for (const [before, after] of changes) {
    assert.equal(result.split(before).length, 2, 'Native route contract changed; review required');
    result = result.replace(before, after);
  }
  // Variable proxy_pass retains the URI (including the app API prefix) when
  // no rewrite precedes it; the gateway, not nginx, resolves the native app.
  assert.deepEqual([...result.matchAll(/^\s*set\s+(\$native_\w+)\s+([^;]+);$/gm)]
    .map(match => [match[1], match[2]]).sort(), [
    ['$native_auth', origins.backend], ['$native_service', origins.backend], ['$native_uaa', origins.uaa],
  ].sort());
  assert.ok(!/(modelingservice|ibiz-ebsx-allinone|ibizlab-uaa-api|compose_agent_network|\/ibizmodeling\/modelapi)/.test(result));
  const proxies = [...result.matchAll(/^\s*proxy_pass\s+([^;]+);$/gm)].map(match => match[1]);
  assert.equal(proxies.length, 7, 'Unexpected API proxy inventory');
  assert.ok(proxies.every(value => ['$native_service', '$native_auth', '$native_uaa'].includes(value)));
  assert.ok(!/^\s*(include|upstream|proxy_redirect|error_page|auth_request)\b/m.test(result),
    'Undeclared proxy or fallback directive');
  // Do not let a backend redirect forward fixture credentials to another host.
  result = result.replace(/^(\s*proxy_pass\s+\$native_(?:service|auth|uaa);)$/gm,
    '$1\n        proxy_redirect off;\n        proxy_hide_header Location;\n        proxy_hide_header Refresh;');
  return result;
}

function mountSnapshot(mounts) {
  return mounts.map(mount => {
    assert.equal(mount.readOnly, true);
    const info = fs.lstatSync(mount.source);
    assert.ok(!info.isSymbolicLink());
    directoryPath(info.isDirectory() ? mount.source : dirname(mount.source));
    if (info.isDirectory()) {
      const { files, bytes, fingerprint } = readTree(mount.source, { jsonOnly: false });
      return { ...mount, kind: 'directory', files, bytes, fingerprint };
    }
    const directories = new PinnedDirectories();
    try {
      const file = read(directories, mount.source);
      return { ...mount, kind: 'file', bytes: file.data.length, sha256: file.sha256 };
    } finally { directories.close(); }
  });
}

function topologyWitness(topology) {
  return {
    networkSha256: hash(json(topology.network)),
    frontendImageId: topology.image.Id,
    containers: topology.containers.map(container => ({
      id: container.Id, image: container.Image, name: container.Name,
      running: container.State.Running, startedAt: container.State.StartedAt,
      restartCount: container.RestartCount, configurationSha256: hash(json(container.Config)),
      hostConfigSha256: hash(json(container.HostConfig)), mountsSha256: hash(json(container.Mounts)),
      networksSha256: hash(json(container.NetworkSettings)),
    })).sort((a, b) => a.id.localeCompare(b.id)),
  };
}

function inspectDeployment(manifest, resources, deployment, imageReceipt, execute) {
  const ids = [
    resources.mysqlId, ...Object.values(deployment.services).map(row => row.containerId),
    ...(deployment.auxiliaryContainers ?? []).map(row => row.containerId),
  ];
  assert.ok(ids.every(id => shaPattern.test(id)) && new Set(ids).size === ids.length);
  assert.match(resources.networkId, shaPattern);
  const networks = dockerJSON(['network', 'inspect', resources.networkId], execute);
  assert.equal(networks.length, 1);
  const containers = dockerJSON(['inspect', ...ids], execute);
  const origins = validateDeployment(manifest, resources, deployment, containers, networks[0], imageReceipt);
  for (const container of containers) {
    assert.ok(Object.values(container.HostConfig.PortBindings ?? {}).every(value => value === null));
    assert.ok(Object.values(container.NetworkSettings.Ports ?? {}).every(value => value === null));
  }
  const images = dockerJSON(['image', 'inspect', 'aibiz/modelingweb:local'], execute);
  assert.equal(images.length, 1);
  assert.match(images[0].Id, imagePattern);
  assert.equal(images[0].Os, 'linux');
  return { network: networks[0], containers, origins, image: images[0] };
}

function deploymentShape(deployment) {
  keys(deployment, ['contract', 'runId', 'imageReceipt', 'services', 'auxiliaryContainers', 'endpoints']);
  assert.equal(deployment.contract, 'run-owned-native-permission-deployment-input-v2');
  assert.match(deployment.runId, /^[a-f0-9]{12}$/);
  keys(deployment.imageReceipt, ['path', 'sha256']);
  assert.match(deployment.imageReceipt.sha256, shaPattern);
  keys(deployment.services, ['allinone', 'gateway', 'provider', 'uaa']);
  for (const service of Object.values(deployment.services)) keys(service, ['containerId', 'imageId']);
  assert.ok(Array.isArray(deployment.auxiliaryContainers));
  assert.ok(deployment.auxiliaryContainers.length <= 2);
  const roles = new Set();
  for (const auxiliary of deployment.auxiliaryContainers) {
    keys(auxiliary, ['containerId', 'imageId', 'role']);
    assert.ok(['nacos', 'redis'].includes(auxiliary.role) && !roles.has(auxiliary.role));
    roles.add(auxiliary.role);
  }
  keys(deployment.endpoints, ['uaa', 'backend']);
  for (const endpoint of Object.values(deployment.endpoints)) {
    keys(endpoint, ['transport', 'service', 'containerPort', 'containerId', 'networkId', 'endpointId', 'ipv4']);
    assert.equal(endpoint.transport, 'private-inspected-ipv4');
  }
}

export async function prepareOwnedModelDesignInput({
  workspace = defaultWorkspace, launchInput, launchInputSha256,
  deploymentInput, deploymentInputSha256, name, output,
} = {}, {
  execute = spawnSync, verifyAssets = verifyNativeAiCodeRuntimeAssets,
  verifyImages = verifyOwnedBackendImagesReadOnly,
} = {}) {
  workspace = resolve(workspace);
  const directories = new PinnedDirectories();
  let stage = 'input-contract';
  try {
    const tool = read(directories, join(defaultWorkspace, toolPath));
    assert.match(name ?? '', /^[a-z][a-z0-9-]{5,63}$/);
    assert.match(launchInputSha256 ?? '', shaPattern);
    assert.match(deploymentInputSha256 ?? '', shaPattern);
    const destination = childOf(workspace, output ?? join(outputRoot, name));
    assert.equal(dirname(destination), join(workspace, outputRoot));
    assert.match(basename(destination), /^[A-Za-z0-9][A-Za-z0-9._-]*$/);
    assert.ok(!fs.existsSync(destination), 'Existing evidence cannot be overwritten');
    directoryPath(dirname(destination), { allowMissing: true });
    const basis = readJSON(directories, childOf(join(workspace, '.artifacts/native-model-design-isolated'),
      resolve(workspace, launchInput)));
    assert.equal(basename(basis.path), 'input.json');
    assert.equal(basis.sha256, launchInputSha256);
    const original = basis.value;
    const originalReport = readJSON(directories, join(dirname(basis.path), 'report.json'));
    assert.equal(originalReport.value.contract, 'native-model-design-isolated-launch');
    assert.equal(originalReport.value.inputSha256, basis.sha256);
    assert.equal(originalReport.value.status, 'PREPARED-NOT-ACCEPTED');
    assert.equal(originalReport.value.run, false);
    assert.deepEqual(originalReport.value.errors, []);
    assert.deepEqual(originalReport.value.containers, []);
    assert.equal(originalReport.value.nativeAccepted, false);
    assert.equal(originalReport.value.acceptedForProduction, false);
    assert.notEqual(original.name, name, 'A new isolated frontend identity is required');
    assert.equal(original.applications.length, 2);
    const reconstructed = isolatedLaunchInput({
      workspace, candidate: original.candidate, assets: original.assets, name: original.name,
      centralPort: Number(new URL(original.applications[0].entry).port),
      modeldesignPort: Number(new URL(original.applications[1].entry).port),
      platformHost: original.applications[0].environment.NATIVE_PLATFORM_HOST,
    });
    assert.deepEqual(original, { ...reconstructed, evidence: original.evidence },
      'Original command/mount/environment contract differs');
    stage = 'source-and-asset-binding';
    const verified = verifyAssets({ workspace, assets: original.assets });
    assert.equal(verified.directory, original.assets);
    assert.equal(verified.candidate, original.candidate);
    assert.ok(verified.receipt.modelDesignRuntime);
    const candidate = readJSON(directories, join(verified.candidate, 'receipt.json'));
    const assets = readJSON(directories, join(verified.directory, 'receipt.json'));
    assert.deepEqual(assets.value, verified.receipt);
    assert.deepEqual(original.evidence, {
      candidateReceiptSha256: candidate.sha256, runtimeReceiptSha256: assets.sha256,
      sourceBuildReport: verified.receipt.modelDesignRuntime.sourceBuildReport,
      runtime: verified.receipt.modelDesignRuntime.runtime,
    });
    const mounted = mountSnapshot(original.mounts);
    for (const mount of original.mounts) {
      const child = relative(mount.source, destination);
      assert.ok(child && (child === '..' || child.startsWith(`..${sep}`) || child.startsWith(sep)),
        'Output must be disjoint from all mounted input trees');
    }
    const nginx = read(directories, join(verified.directory, 'nginx-native.conf'));
    stage = 'private-deployment-binding';
    const deployment = readJSON(directories,
      childOf(join(workspace, '.artifacts/native-nonadmin-fixtures'),
        resolve(workspace, deploymentInput)), { privateInput: true });
    assert.equal(basename(deployment.path), 'deployment-input.private.json');
    assert.equal(deployment.sha256, deploymentInputSha256);
    deploymentShape(deployment.value);
    const runId = deployment.value.runId;
    const fixtureDirectory = join(workspace, '.artifacts/native-nonadmin-fixtures', runId);
    childOf(fixtureDirectory, deployment.path);
    assert.match(basename(dirname(deployment.path)), /^backend-runtime-[a-z0-9][a-z0-9-]{0,48}$/);
    const manifest = readJSON(directories, join(fixtureDirectory, 'manifest.json'));
    const resources = readJSON(directories, join(fixtureDirectory, 'resources.private.json'), { privateInput: true });
    const imageReceipt = readJSON(directories, childOf(workspace, deployment.value.imageReceipt.path));
    assert.equal(imageReceipt.sha256, deployment.value.imageReceipt.sha256);
    stage = 'backend-source-image-binding';
    const images = verifyImages({ workspace, reportPath: imageReceipt.path, execute });
    assert.equal(images.reportSha256, imageReceipt.sha256);
    assert.deepEqual(images.report, imageReceipt.value);
    assert.equal(images.imageArtifactBindingVerified, true);
    assert.equal(images.verificationMode, 'source-and-recorded-probes-with-live-image-inspection');
    assert.equal(images.freshImageFileProbeExecuted, false);
    stage = 'owned-topology-inspection';
    const topology = inspectDeployment(manifest.value, resources.value, deployment.value, images.report, execute);
    const overlay = ownedBackendNginx(nginx.data.toString('utf8'), topology.origins);
    const input = isolatedLaunchInput({
      workspace, candidate: original.candidate, assets: original.assets, name,
      centralPort: Number(new URL(original.applications[0].entry).port),
      modeldesignPort: Number(new URL(original.applications[1].entry).port),
      platformHost: new URL(topology.origins.backend).hostname,
    });
    input.contract = 'native-model-design-owned-backend-launch-input-v1';
    input.mounts[0].source = join(destination, 'nginx-native.conf');
    for (const application of input.applications) {
      // Reconstruct from the validated baseline; only these known operands change.
      const args = application.args;
      args[args.indexOf('--network') + 1] = topology.network.Id;
      const mountIndex = args.indexOf('--mount');
      args[mountIndex + 1] = `type=bind,src=${input.mounts[0].source},dst=${input.mounts[0].target},readonly`;
      const entrypointIndex = args.indexOf('--entrypoint');
      args[entrypointIndex + 2] = topology.image.Id;
      args.splice(entrypointIndex, 0, '--label', `${ownerLabel}=${runId}`);
    }
    input.evidence = original.evidence;
    input.ownedBackend = {
      runId, networkId: topology.network.Id, networkName: topology.network.Name,
      endpoints: deployment.value.endpoints, originalLaunchInput: bind(basis),
      deploymentInput: { sha256: deployment.sha256, credentialsIncluded: false },
      imageReceipt: bind(imageReceipt), frontendImageId: topology.image.Id,
      originalNginx: bind(nginx), overlaySha256: hash(overlay),
    };
    input.launchAuthorized = false;
    input.boundary = 'Preparation only; owned backend must be reinspected and frontend peers explicitly authorized before launch';
    stage = 'final-drift-check';
    assert.deepEqual(verifyAssets({ workspace, assets: original.assets }), verified);
    const repeatedImages = verifyImages({ workspace, reportPath: imageReceipt.path, execute });
    assert.equal(repeatedImages.reportSha256, images.reportSha256);
    assert.deepEqual(repeatedImages.report, images.report);
    assert.deepEqual(topologyWitness(inspectDeployment(
      manifest.value, resources.value, deployment.value, images.report, execute)), topologyWitness(topology));
    assert.deepEqual(mountSnapshot(original.mounts), mounted);
    const files = [basis, originalReport, candidate, assets, deployment, manifest, resources, imageReceipt, nginx, tool];
    for (const file of files) {
      const current = read(directories, file.path, { privateInput: file === deployment || file === resources });
      assert.equal(current.sha256, file.sha256);
      assert.equal(current.identity.ino, file.identity.ino);
      assert.equal(current.identity.dev, file.identity.dev);
    }
    const report = {
      schemaVersion: 1, contract: 'native-model-design-owned-backend-preparation-v1',
      status: 'PREPARED-NOT-ACCEPTED', preparedAt: new Date().toISOString(),
      run: false, launchAuthorized: false, containersStarted: 0, httpRequestsSent: 0,
      nativeAccepted: false, permissionAcceptance: false, acceptedForProduction: false,
      sourceAndAssetBindingVerified: true, inspectedOwnedTopologyVerified: true,
      imageVerificationMode: images.verificationMode, freshImageFileProbeExecuted: false,
      inputSha256: hash(json(input)), nginxSha256: hash(overlay), tool: bind(tool),
      sourceEvidence: input.evidence, originalLaunchInput: bind(basis),
      originalLaunchReport: bind(originalReport),
      ownedBackend: input.ownedBackend, mountedInputs: mounted,
      topology: topologyWitness(topology), credentialsIncluded: false, errors: [],
      limitations: [
        'No HTTP login, root, edit, save, refresh, fresh-session or action-execution acceptance.',
        'Backend file probes are verified recorded evidence bound to live immutable image identities, not freshly executed.',
        'Backend-only peer inventory is required during preparation; any later launch needs explicit peer authorization and reinspection.',
      ],
    };
    stage = 'exclusive-output-write';
    const target = directories.open(destination, { create: true, exclusive: true });
    directories.write(target, 'nginx-native.conf', overlay);
    directories.write(target, 'input.json', json(input));
    directories.write(target, 'report.json', json(report));
    fs.chmodSync(directories.entry(target, 'nginx-native.conf'), 0o644);
    fs.chmodSync(target.access, 0o755);
    return { destination, input, report };
  } catch {
    throw new Error(`Owned frontend preparation refused at ${stage}; private details suppressed`);
  } finally { directories.close(); }
}

export async function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({ args: argv, options: {
    'launch-input': { type: 'string' }, 'launch-input-sha256': { type: 'string' },
    'deployment-input': { type: 'string' }, 'deployment-input-sha256': { type: 'string' },
    name: { type: 'string' }, output: { type: 'string' }, help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) {
    console.log('Prepare only (no launch/HTTP): node scripts/native-model-design-owned-backend-input.mjs ' +
      '--launch-input PATH --launch-input-sha256 SHA --deployment-input PATH ' +
      '--deployment-input-sha256 SHA --name NEW [--output PATH]');
    return 0;
  }
  const result = await prepareOwnedModelDesignInput({
    launchInput: values['launch-input'], launchInputSha256: values['launch-input-sha256'],
    deploymentInput: values['deployment-input'], deploymentInputSha256: values['deployment-input-sha256'],
    name: values.name, output: values.output,
  });
  console.log(`${result.report.status}: ${result.destination}`);
  return 2;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => { process.exitCode = code; })
    .catch(() => { console.error('Owned frontend preparation refused; private details suppressed'); process.exitCode = 1; });
}
