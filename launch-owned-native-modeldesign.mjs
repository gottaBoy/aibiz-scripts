#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import { connect, createServer, isIP } from 'node:net';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { PinnedDirectories, directoryPath, readPinnedFile } from './native-candidate-files.mjs';
import {
  isolatedLaunchInput, verifyNativeCentralServiceCandidate,
} from './native-model-design-isolated-launch.mjs';
import {
  mountedTreeSnapshot, ownedBackendNginx, ownedFrontendTopologyWitness, ownedFrontendOverrides,
  verifyOwnedBackendImagesReadOnly,
} from './native-model-design-owned-backend-input.mjs';
import { ownedNativeRuntimeContext } from './owned-native-runtime-context.mjs';
import { verifyNativeAiCodeRuntimeAssets } from './prepare-native-ai-code-runtime-assets.mjs';
import { validateDeployment, validatePrivateEndpoint } from './run-owned-native-permission-http.mjs';
import { inspectMysqlFixtureVolumes } from './owned-mysql-volume.mjs';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const toolPath = fileURLToPath(import.meta.url);
const outputRoot = '.artifacts/owned-native-modeldesign-launch';
const fixtureLabel = 'aibiz.native-fixture.run';
const frontendLabel = 'aibiz.native-model-design-isolated';
const launchLabel = 'aibiz.owned-modeldesign.launch';
const idPattern = /^[a-f0-9]{64}$/;
const imagePattern = /^sha256:[a-f0-9]{64}$/;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const delay = ms => new Promise(done => setTimeout(done, ms));

function childPath(root, path) {
  assert.equal(typeof path, 'string');
  const absolute = resolve(root, path);
  const child = relative(root, absolute);
  assert.ok(child && child !== '..' && !child.startsWith(`..${sep}`) && !child.startsWith(sep));
  assert.ok(!/[,\r\n\0:]/.test(absolute));
  return absolute;
}

function exactKeys(value, keys) {
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort());
}

function readBound(directories, path, { privateInput = false } = {}) {
  const file = readPinnedFile(directories, directories.open(dirname(path)), basename(path));
  if (privateInput) {
    assert.equal(file.identity.uid, process.geteuid());
    assert.equal(file.identity.mode & 0o077, 0);
  }
  return { ...file, path, bytes: file.data.length, sha256: hash(file.data) };
}

function binding(file) {
  return { path: file.path, bytes: file.bytes, sha256: file.sha256 };
}

function docker(args, execute, { allowFailure = false } = {}) {
  const result = execute('docker', args, {
    encoding: 'utf8', timeout: 120_000, maxBuffer: 16 * 1024 * 1024,
  });
  if (!allowFailure) assert.ok(!result.error && result.status === 0 && !result.signal,
    'Owned Docker operation failed; raw output suppressed');
  return result;
}

function inspect(args, execute) {
  const value = JSON.parse(docker(args, execute).stdout);
  assert.ok(Array.isArray(value));
  return value;
}

function snapshotMounts(mounts) {
  return mounts.map(mount => {
    assert.equal(mount.readOnly, true);
    const info = fs.lstatSync(mount.source);
    assert.ok(!info.isSymbolicLink());
    if (info.isDirectory()) return { ...mount, kind: 'directory', ...mountedTreeSnapshot(mount.source) };
    const directories = new PinnedDirectories();
    try {
      const file = readBound(directories, mount.source);
      return { ...mount, kind: 'file', bytes: file.bytes, sha256: file.sha256 };
    } finally { directories.close(); }
  });
}

function metadata(info) {
  return Object.fromEntries(['dev', 'ino', 'mode', 'size', 'mtimeNs', 'ctimeNs']
    .map(key => {
      assert.equal(typeof info[key], 'bigint', 'Nanosecond-capable Linux file metadata required');
      return [key, String(info[key])];
    }));
}

export function mountedMetadataSnapshot(mounts) {
  const directories = new PinnedDirectories();
  try {
    return mounts.map(mount => {
      assert.equal(mount.readOnly, true);
      const entries = [];
      let files = 0;
      let bytes = 0n;
      let directoryCount = 0;
      const stat = path => {
        const value = fs.lstatSync(path, { bigint: true });
        assert.ok(!value.isSymbolicLink() && (value.isDirectory() || value.isFile()));
        return value;
      };
      const visit = (directory, prefix, depth = 0) => {
        assert.ok(++directoryCount <= 50_000);
        assert.ok(depth < 512, 'Mounted tree exceeds its depth budget');
        const before = fs.fstatSync(directory.descriptor, { bigint: true });
        const names = fs.readdirSync(directory.access).sort();
        entries.push({ path: prefix, kind: 'directory', ...metadata(before) });
        for (const name of names) {
          const path = directories.entry(directory, name);
          const first = stat(path);
          const child = prefix ? `${prefix}/${name}` : name;
          if (first.isDirectory()) {
            const descriptor = fs.openSync(path,
              fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
            try {
              assert.deepEqual(metadata(fs.fstatSync(descriptor, { bigint: true })), metadata(first));
              visit({ descriptor, access: `/proc/self/fd/${descriptor}` }, child, depth + 1);
            } finally { fs.closeSync(descriptor); }
          } else {
            assert.ok(++files <= 50_000 && first.size <= 64n * 1024n * 1024n);
            bytes += first.size;
            assert.ok(bytes <= 512n * 1024n * 1024n);
            entries.push({ path: child, kind: 'file', ...metadata(first) });
          }
          assert.deepEqual(metadata(stat(path)), metadata(first), 'Mounted entry changed during metadata inspection');
        }
        assert.deepEqual(fs.readdirSync(directory.access).sort(), names, 'Mounted directory inventory changed');
        assert.deepEqual(metadata(fs.fstatSync(directory.descriptor, { bigint: true })), metadata(before),
          'Mounted directory changed during inspection');
      };
      const root = stat(mount.source);
      if (root.isDirectory()) {
        const directory = directories.open(mount.source);
        visit(directory, '');
        directories.verify(directory);
      } else {
        const parent = directories.open(dirname(mount.source));
        const path = directories.entry(parent, basename(mount.source));
        entries.push({ path: '', kind: 'file', ...metadata(root) });
        assert.deepEqual(metadata(stat(path)), metadata(root));
        directories.verify(parent);
      }
      assert.deepEqual(metadata(stat(mount.source)), metadata(root), 'Mounted root changed during inspection');
      return { ...mount, entries: entries.sort((a, b) => a.path.localeCompare(b.path)) };
    });
  } finally { directories.close(); }
}

function verifyAttemptContainer(input, app, attempt, container) {
  assert.equal(attempt.application, app.application);
  assert.equal(attempt.name, app.container);
  assert.match(attempt.launchToken ?? '', /^[a-f0-9]{36}$/);
  assert.match(container.Id, idPattern);
  assert.equal(container.Name, `/${attempt.name}`);
  assert.equal(container.Image, input.ownedBackend.frontendImageId);
  assert.equal(container.Config.Labels?.[launchLabel], attempt.launchToken,
    'A name collision is not proof of this invocation ownership');
  assert.equal(container.Config.Labels?.[fixtureLabel], input.ownedBackend.runId);
  assert.equal(container.Config.Labels?.[frontendLabel], input.name);
  assert.ok(Number.isFinite(Date.parse(container.Created))
    && Date.parse(container.Created) >= Date.parse(attempt.startedAt) - 1000,
  'A pre-existing container cannot be recovered as this invocation');
}

// Never execute the persisted argument array. Rebuild its entire contract first.
export function rebuildOwnedFrontendInput({ workspace, original, destination, manifest, resources,
  deployment, frontendImage, origins, evidence, originalBinding, manifestBinding, resourcesBinding,
  imageBinding, nginxBinding, overlaySha256 }) {
  const reconstructed = isolatedLaunchInput({
    workspace, candidate: original.candidate, assets: original.assets, name: original.name,
    frontend: original.frontend,
    serviceCandidate: original.serviceCandidate,
    centralPort: Number(new URL(original.applications[0].entry).port),
    modeldesignPort: Number(new URL(original.applications[1].entry).port),
    platformHost: original.applications[0].environment.NATIVE_PLATFORM_HOST,
  });
  assert.deepEqual(original, { ...reconstructed, evidence });
  const input = isolatedLaunchInput({
    workspace, candidate: original.candidate, assets: original.assets, name: basename(destination),
    frontend: original.frontend,
    serviceCandidate: original.serviceCandidate,
    centralPort: Number(new URL(original.applications[0].entry).port),
    modeldesignPort: Number(new URL(original.applications[1].entry).port),
    platformHost: new URL(origins.backend).hostname,
  });
  input.contract = 'native-model-design-owned-backend-launch-input-v1';
  input.network = resources.networkId;
  input.mounts[0].source = join(destination, 'nginx-native.conf');
  for (const application of input.applications) {
    const args = application.args;
    args[args.indexOf('--network') + 1] = resources.networkId;
    args[args.indexOf('--mount') + 1] =
      `type=bind,src=${input.mounts[0].source},dst=${input.mounts[0].target},readonly`;
    const entrypointIndex = args.indexOf('--entrypoint');
    args[entrypointIndex + 2] = frontendImage.Id;
    for (const [key, value] of Object.entries(ownedFrontendOverrides(manifest, application.application))) {
      application.environment[key] = value;
      args.splice(args.indexOf('--entrypoint'), 0, '--env', `${key}=${value}`);
    }
    args.splice(args.indexOf('--entrypoint'), 0, '--label', `${fixtureLabel}=${manifest.runId}`);
  }
  input.evidence = evidence;
  input.ownedBackend = {
    runId: manifest.runId, networkId: resources.networkId, networkName: resources.networkName,
    endpoints: deployment.endpoints, originalLaunchInput: originalBinding,
    manifest: manifestBinding, resources: resourcesBinding, modelDesignRoot: manifest.roots[0].rootId,
    deploymentInput: { sha256: hash(json(deployment)), credentialsIncluded: false },
    imageReceipt: imageBinding, frontendImageId: frontendImage.Id,
    originalNginx: nginxBinding, overlaySha256,
  };
  input.launchAuthorized = false;
  input.boundary = 'Preparation only; owned backend must be reinspected and frontend peers explicitly authorized before launch';
  return input;
}

export function ownedFrontendRunArguments(input, app, cidPath, launchToken) {
  assert.ok(input.applications.includes(app));
  assert.equal(app.command, 'docker');
  assert.equal(dirname(cidPath), resolve(dirname(cidPath)));
  assert.equal(basename(cidPath), `${app.application.toLowerCase()}.cid`);
  assert.ok(!/[,\r\n\0:]/.test(cidPath));
  assert.match(launchToken ?? '', /^[a-f0-9]{36}$/);
  const args = [...app.args];
  const publish = args.indexOf('--publish');
  assert.ok(publish > 0 && args.lastIndexOf('--publish') === publish);
  assert.equal(args[publish + 1], `127.0.0.1:${new URL(app.entry).port}:8080`);
  args.splice(publish, 2);
  args.splice(2, 0, '--cidfile', cidPath);
  args.splice(args.indexOf('--entrypoint'), 0, '--label', `${launchLabel}=${launchToken}`);
  return args;
}

export function verifyOwnedFrontendContainer(input, app, container, network, {
  healthy = true, expectedId, expectedLaunchToken,
} = {}) {
  assert.match(container.Id, idPattern);
  if (expectedId) assert.equal(container.Id, expectedId);
  assert.equal(container.Name, `/${app.container}`);
  assert.equal(container.Image, input.ownedBackend.frontendImageId);
  assert.equal(container.Config.Image, input.ownedBackend.frontendImageId);
  assert.equal(container.Config.Labels?.[frontendLabel], input.name);
  assert.equal(container.Config.Labels?.[fixtureLabel], input.ownedBackend.runId);
  assert.match(container.Config.Labels?.[launchLabel] ?? '', /^[a-f0-9]{36}$/);
  if (expectedLaunchToken) assert.equal(container.Config.Labels[launchLabel], expectedLaunchToken);
  assert.deepEqual(container.Config.Entrypoint, ['/bin/sh']);
  assert.deepEqual(container.Config.Cmd, ['/start.sh']);
  assert.equal(container.HostConfig.NetworkMode, input.network);
  assert.equal(container.HostConfig.Privileged, false);
  assert.ok(!container.HostConfig.CapAdd?.length);
  assert.ok(!container.HostConfig.PidMode);
  assert.ok(!container.HostConfig.IpcMode || container.HostConfig.IpcMode === 'private');
  assert.ok(!container.HostConfig.Binds?.length);
  assert.ok(!container.HostConfig.Devices?.length);
  assert.ok(!container.HostConfig.ExtraHosts?.length);
  assert.equal(container.HostConfig.PublishAllPorts, false);
  assert.ok(Object.values(container.HostConfig.PortBindings ?? {}).every(row => row === null));
  assert.ok(Object.values(container.NetworkSettings.Ports ?? {}).every(row => row === null));
  assert.deepEqual(container.HostConfig.Tmpfs, { '/dist': 'uid=101,gid=101,mode=0755' });
  for (const [key, value] of Object.entries(app.environment)) {
    assert.equal(container.Config.Env.filter(row => row.startsWith(`${key}=`)).length, 1);
    assert.ok(container.Config.Env.includes(`${key}=${value}`));
  }
  if (app.application !== 'ModelDesign') {
    assert.ok(!container.Config.Env.some(row => row.startsWith('NATIVE_MODELING_SYSTEM_ID=')));
  }
  assert.deepEqual(container.Config.Healthcheck.Test,
    ['CMD-SHELL', app.args[app.args.indexOf('--health-cmd') + 1]]);
  const binds = container.Mounts.filter(row => row.Type === 'bind');
  const temporary = container.Mounts.filter(row => row.Type === 'tmpfs');
  assert.equal(binds.length, input.mounts.length);
  assert.ok(temporary.length <= 1, 'Only one optional inspected tmpfs is permitted');
  assert.equal(container.Mounts.length, binds.length + temporary.length, 'Unexpected mount type');
  for (const mount of temporary) {
    assert.equal(mount.Destination, '/dist', 'Only the declared /dist tmpfs is permitted');
    assert.ok(mount.Source === undefined || mount.Source === '', 'Unexpected tmpfs source');
    assert.ok(mount.RW === undefined || mount.RW === true, 'The /dist tmpfs must remain writable');
  }
  for (const mount of input.mounts) {
    const actual = binds.filter(row => row.Destination === mount.target);
    assert.equal(actual.length, 1);
    assert.equal(actual[0].Source, mount.source);
    assert.equal(actual[0].RW, false);
  }
  assert.equal(network.Id, input.network);
  assert.equal(network.Name, input.ownedBackend.networkName);
  assert.equal(network.Internal, true);
  assert.equal(network.Driver, 'bridge');
  assert.equal(network.Labels?.[fixtureLabel], input.ownedBackend.runId);
  assert.deepEqual(Object.keys(container.NetworkSettings.Networks), [network.Name]);
  const attachment = container.NetworkSettings.Networks[network.Name];
  const endpoint = {
    transport: 'private-inspected-ipv4', service: 'gateway', containerPort: 30086,
    containerId: container.Id, networkId: network.Id, endpointId: attachment.EndpointID,
    ipv4: attachment.IPAddress,
  };
  // The reusable endpoint validator also checks the whole RFC1918 subnet,
  // gateway exclusion, exact network inventory record and absent publication.
  validatePrivateEndpoint(endpoint, { gateway: { containerId: container.Id, imageId: container.Image } },
    [{ ...container, State: { ...container.State, Running: true } }], network);
  if (healthy) {
    assert.equal(container.State.Running, true);
    assert.equal(container.State.Health?.Status, 'healthy');
  }
  return {
    containerId: container.Id, imageId: container.Image, ipv4: attachment.IPAddress,
    launchToken: container.Config.Labels[launchLabel],
    endpointId: attachment.EndpointID, networkId: network.Id, containerPort: 8080,
    configurationSha256: hash(json(container.Config)), hostConfigSha256: hash(json(container.HostConfig)),
    mountsSha256: hash(json([...container.Mounts].sort((a, b) => a.Destination.localeCompare(b.Destination)))),
  };
}

export function projectOwnedBackendNetwork({ baseline, network, frontends }) {
  assert.match(baseline.Id, idPattern);
  assert.equal(network.Id, baseline.Id);
  assert.equal(baseline.Internal, true);
  assert.equal(baseline.Driver, 'bridge');
  const backendIds = Object.keys(baseline.Containers);
  assert.equal(backendIds.length, 8, 'Exact eight-node backend baseline required');
  assert.ok(backendIds.every(id => idPattern.test(id)));
  assert.ok(Array.isArray(frontends) && frontends.length <= 2);
  assert.equal(new Set(frontends.map(row => row.containerId)).size, frontends.length);
  assert.equal(new Set(frontends.map(row => row.ipv4)).size, frontends.length);
  assert.deepEqual(Object.keys(network.Containers).sort(),
    [...backendIds, ...frontends.map(row => row.containerId)].sort(), 'Undeclared network peer');
  const projected = structuredClone(network);
  const ipv4 = address => {
    assert.equal(isIP(address), 4);
    return address.split('.').reduce((value, byte) => value * 256 + Number(byte), 0);
  };
  const subnetMatch = (address, subnet) => {
    const parts = subnet.split('/');
    if (parts.length !== 2 || isIP(parts[0]) !== 4 || !/^(?:[1-9]|[12][0-9]|3[0-2])$/.test(parts[1])) return false;
    const size = 2 ** (32 - Number(parts[1]));
    const base = ipv4(parts[0]);
    assert.equal(base % size, 0, 'Unnormalized network subnet');
    const ip = ipv4(address);
    return ip > base && ip < base + size - 1;
  };
  const originalSubnets = baseline.Status?.IPAM?.Subnets;
  const actualSubnets = network.Status?.IPAM?.Subnets;
  const counters = [];
  const increments = new Map();
  if (originalSubnets !== undefined) {
    assert.ok(originalSubnets && actualSubnets && typeof originalSubnets === 'object'
      && typeof actualSubnets === 'object' && !Array.isArray(originalSubnets) && !Array.isArray(actualSubnets));
    assert.deepEqual(Object.keys(actualSubnets).sort(), Object.keys(originalSubnets).sort());
  } else assert.equal(actualSubnets, undefined, 'Network IPAM status appeared without a bound baseline');
  for (const frontend of frontends) {
    assert.match(frontend.containerId, idPattern);
    assert.ok(!backendIds.includes(frontend.containerId));
    assert.equal(frontend.networkId, baseline.Id);
    assert.match(frontend.endpointId, idPattern);
    const peer = network.Containers[frontend.containerId];
    assert.equal(peer.EndpointID, frontend.endpointId);
    const parts = peer.IPv4Address.split('/');
    assert.equal(parts.length, 2);
    assert.equal(parts[0], frontend.ipv4);
    assert.ok(!Object.values(baseline.Containers).some(row => row.IPv4Address.split('/')[0] === frontend.ipv4));
    const configurations = baseline.IPAM.Config.filter(row => subnetMatch(frontend.ipv4, row.Subnet));
    assert.equal(configurations.length, 1, 'Each frontend must match exactly one bound IPAM subnet');
    const subnet = configurations[0].Subnet;
    assert.equal(parts[1], subnet.split('/')[1]);
    if (originalSubnets !== undefined) {
      assert.ok(Object.hasOwn(originalSubnets, subnet), 'Frontend subnet lacks bound allocation counters');
      increments.set(subnet, (increments.get(subnet) ?? 0) + 1);
    }
    delete projected.Containers[frontend.containerId];
  }
  for (const subnet of Object.keys(originalSubnets ?? {})) {
    const before = originalSubnets[subnet];
    const actual = actualSubnets[subnet];
    for (const field of ['IPsInUse', 'DynamicIPsAvailable']) {
      assert.ok(Number.isSafeInteger(before[field]) && before[field] >= 0,
        'Bound IPAM counters must be nonnegative integer address counts');
      assert.ok(Number.isSafeInteger(actual[field]) && actual[field] >= 0,
        'Actual IPAM counters must be nonnegative integer address counts');
    }
    const count = increments.get(subnet) ?? 0;
    assert.equal(actual.IPsInUse, before.IPsInUse + count, 'Unexplained IPsInUse allocation drift');
    assert.equal(actual.DynamicIPsAvailable, before.DynamicIPsAvailable - count,
      'Unexplained DynamicIPsAvailable allocation drift');
    projected.Status.IPAM.Subnets[subnet].IPsInUse = before.IPsInUse;
    projected.Status.IPAM.Subnets[subnet].DynamicIPsAvailable = before.DynamicIPsAvailable;
    counters.push({ subnet, verifiedFrontendCount: count,
      baseline: { IPsInUse: before.IPsInUse, DynamicIPsAvailable: before.DynamicIPsAvailable },
      actual: { IPsInUse: actual.IPsInUse, DynamicIPsAvailable: actual.DynamicIPsAvailable } });
  }
  assert.deepEqual(projected, baseline, 'Network fields drift beyond verified frontend allocation counters');
  return {
    network: projected,
    evidence: {
      contract: 'owned-frontend-ipam-allocation-projection-v1', baselinePeers: backendIds.length,
      verifiedFrontends: frontends.map(row => ({
        containerId: row.containerId, endpointId: row.endpointId, ipv4: row.ipv4,
      })),
      counters, allOtherNetworkFieldsUnchanged: true,
    },
  };
}

async function unusedPort(port) {
  const server = createServer();
  try {
    await new Promise((done, reject) => {
      server.once('error', reject);
      server.listen(port, '127.0.0.1', done);
    });
  } finally {
    if (server.listening) await new Promise(done => server.close(done));
  }
}

export function bridgeProcessIdentity(pid) {
  assert.ok(Number.isSafeInteger(pid) && pid > 1 && pid !== process.pid);
  const base = `/proc/${pid}`;
  const stat = fs.readFileSync(join(base, 'stat'), 'utf8');
  const fields = stat.slice(stat.lastIndexOf(') ') + 2).trim().split(/\s+/);
  assert.ok(fields.length > 19);
  assert.match(fields[19], /^[0-9]+$/);
  const uid = fs.readFileSync(join(base, 'status'), 'utf8').match(/^Uid:\s+(.+)$/m);
  assert.ok(uid);
  assert.deepEqual(uid[1].trim().split(/\s+/).map(Number), Array(4).fill(process.geteuid()));
  return {
    pid, uid: process.geteuid(), startTicks: fields[19],
    executable: fs.readlinkSync(join(base, 'exe')),
    commandSha256: hash(fs.readFileSync(join(base, 'cmdline'))),
  };
}

export function verifyBridgeProcess(identity, specPath, specSha256, readIdentity = bridgeProcessIdentity) {
  exactKeys(identity, ['pid', 'uid', 'startTicks', 'executable', 'commandSha256']);
  assert.equal(identity.uid, process.geteuid());
  assert.match(identity.startTicks, /^[0-9]+$/);
  assert.equal(identity.executable, fs.realpathSync(process.execPath));
  assert.equal(identity.commandSha256, hash(Buffer.from([
    process.execPath, toolPath, '--bridge-worker', specPath, '--bridge-worker-sha256', specSha256, '',
  ].join('\0'))));
  assert.deepEqual(readIdentity(identity.pid), identity, 'Bridge PID identity changed; refusing to signal');
}

function processOwnsListener(pid, port) {
  const inodes = new Set(fs.readdirSync(`/proc/${pid}/fd`).flatMap(fd => {
    try {
      const target = fs.readlinkSync(`/proc/${pid}/fd/${fd}`).match(/^socket:\[([0-9]+)\]$/);
      return target ? [target[1]] : [];
    } catch { return []; }
  }));
  const wanted = `0100007F:${port.toString(16).toUpperCase().padStart(4, '0')}`;
  return fs.readFileSync(`/proc/${pid}/net/tcp`, 'utf8').trim().split('\n').slice(1).some(line => {
    const row = line.trim().split(/\s+/);
    return row[1] === wanted && row[3] === '0A' && inodes.has(row[9]);
  });
}

export async function startLoopbackBridge({
  directory, directories, application, inputFile, pin, peerIds, runtime, frontendPins, registerBridge,
  spawnProcess = spawn, readIdentity = bridgeProcessIdentity,
}) {
  const code = application.application.toLowerCase();
  const specPath = join(directory.path, `${code}.bridge.private.json`);
  const readyPath = join(directory.path, `${code}.bridge-ready.private.json`);
  const spec = {
    contract: 'owned-modeldesign-loopback-bridge-v1', application: application.application,
    input: binding(inputFile), inputDirectory: dirname(inputFile.path),
    launcherSha256: hash(fs.readFileSync(toolPath)), pin, peerIds: [...peerIds].sort(),
    runtime, frontendPins,
    port: Number(new URL(application.entry).port), readyPath,
  };
  const specBytes = json(spec);
  directories.write(directory, basename(specPath), specBytes);
  const specSha256 = hash(specBytes);
  let bridge;
  try {
    const child = spawnProcess(process.execPath,
      [toolPath, '--bridge-worker', specPath, '--bridge-worker-sha256', specSha256],
      { detached: true, stdio: 'ignore' });
    await new Promise((done, reject) => {
      child.once('error', reject);
      child.once('spawn', done);
    });
    child.unref();
    const identity = readIdentity(child.pid);
    bridge = { specPath, specSha256, identity, port: spec.port };
    verifyBridgeProcess(identity, specPath, specSha256);
    registerBridge(bridge);
    const deadline = Date.now() + 60_000;
    while (Date.now() < deadline && !fs.existsSync(readyPath)) {
      verifyBridgeProcess(identity, specPath, specSha256);
      await delay(100);
    }
    const ready = readBound(directories, readyPath, { privateInput: true });
    assert.deepEqual(JSON.parse(ready.data), {
      contract: spec.contract, pid: child.pid, specSha256, port: spec.port, host: '127.0.0.1',
    });
    verifyBridgeProcess(identity, specPath, specSha256);
    assert.ok(processOwnsListener(identity.pid, spec.port), 'Bridge must own the exact loopback listener');
    return bridge;
  } catch {
    if (bridge) await stopLoopbackBridge(bridge);
    throw new Error('Owned loopback bridge failed; private details suppressed');
  }
}

function bridgeKernelState(pid) {
  const base = `/proc/${pid}`;
  const stat = fs.readFileSync(join(base, 'stat'), 'utf8');
  const fields = stat.slice(stat.lastIndexOf(') ') + 2).trim().split(/\s+/);
  assert.ok(fields.length > 19);
  assert.match(fields[19], /^[0-9]+$/);
  const uid = fs.readFileSync(join(base, 'status'), 'utf8').match(/^Uid:\s+(.+)$/m);
  assert.ok(uid);
  assert.deepEqual(uid[1].trim().split(/\s+/).map(Number), Array(4).fill(process.geteuid()));
  return { state: fields[0], uid: process.geteuid(), startTicks: fields[19] };
}

export async function bridgeProcessStopped(bridge, {
  readKernelState = bridgeKernelState,
  verifyLive = () => verifyBridgeProcess(bridge.identity, bridge.specPath, bridge.specSha256),
  wait = delay,
} = {}) {
  const terminal = () => {
    try {
      const kernel = readKernelState(bridge.identity.pid);
      assert.equal(kernel.uid, bridge.identity.uid, 'Bridge PID identity changed; refusing to signal');
      assert.equal(kernel.startTicks, bridge.identity.startTicks, 'Bridge PID identity changed; refusing to signal');
      return /^[ZX]$/.test(kernel.state);
    } catch (error) {
      if (error.code === 'ENOENT') return true;
      throw error;
    }
  };
  if (terminal()) return true;
  try { verifyLive(); }
  catch (error) {
    // Exit can clear /proc/cmdline before the task reaches Z. Only accept an
    // absent PID or the same kernel birth/UID reaching a terminal state.
    for (let attempt = 0; attempt < 5; attempt++) {
      if (terminal()) return true;
      await wait(10);
    }
    throw error;
  }
  return false;
}

export async function stopLoopbackBridge(bridge) {
  try { fs.lstatSync(`/proc/${bridge.identity.pid}`); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  const stopped = () => bridgeProcessStopped(bridge);
  if (await stopped()) return;
  process.kill(bridge.identity.pid, 'SIGTERM');
  for (let attempt = 0; attempt < 50; attempt++) {
    if (await stopped()) return;
    await delay(100);
  }
  // A synchronous Docker inspection can delay the worker's signal handler.
  // Recheck the full kernel identity immediately before escalating.
  verifyBridgeProcess(bridge.identity, bridge.specPath, bridge.specSha256);
  process.kill(bridge.identity.pid, 'SIGKILL');
  for (let attempt = 0; attempt < 50; attempt++) {
    if (await stopped()) return { forced: true };
    await delay(100);
  }
  throw new Error('Exact owned bridge did not exit after verified termination');
}

export function verifyOwnedBridgeRuntime({
  workspace = workspaceRoot, directories, input, runtime, frontendPins, execute = spawnSync,
  fullMountedHash = false,
}) {
  exactKeys(runtime, ['bindings', 'backendIds', 'manifestPath', 'resourcesPath', 'deploymentPath',
    'imageReceiptPath', 'topology', 'mounts', 'mountedInputs', 'mountedMetadata', 'networkBaseline']);
  assert.equal(runtime.backendIds.length, 8);
  assert.equal(new Set(runtime.backendIds).size, 8);
  assert.ok(runtime.backendIds.every(id => idPattern.test(id)));
  assert.equal(frontendPins.length, 2);
  assert.deepEqual(frontendPins.map(row => row.application).sort(), ['Central', 'ModelDesign']);
  const files = new Map();
  for (const row of runtime.bindings) {
    exactKeys(row, ['path', 'bytes', 'sha256', 'privateInput']);
    assert.equal(typeof row.privateInput, 'boolean');
    childPath(workspace, row.path);
    assert.ok(!files.has(row.path));
    const file = readBound(directories, row.path, { privateInput: row.privateInput });
    assert.deepEqual(binding(file), { path: row.path, bytes: row.bytes, sha256: row.sha256 },
      'Owned worker input drift');
    files.set(row.path, file);
  }
  const fixture = join(workspace, '.artifacts/native-nonadmin-fixtures', input.ownedBackend.runId);
  assert.equal(runtime.manifestPath, join(fixture, 'manifest.json'));
  assert.equal(runtime.resourcesPath, join(fixture, 'owned-resources.json'));
  assert.equal(dirname(dirname(runtime.deploymentPath)), fixture);
  assert.equal(basename(runtime.deploymentPath), 'deployment-input.private.json');
  for (const path of [runtime.resourcesPath, runtime.deploymentPath, join(fixture, 'credentials.private.json')]) {
    assert.ok(runtime.bindings.some(row => row.path === path && row.privateInput === true));
  }
  const manifest = JSON.parse(files.get(runtime.manifestPath).data);
  const resources = JSON.parse(files.get(runtime.resourcesPath).data);
  const deployment = JSON.parse(files.get(runtime.deploymentPath).data);
  const images = JSON.parse(files.get(runtime.imageReceiptPath).data);
  assert.equal(resolve(workspace, deployment.imageReceipt.path), runtime.imageReceiptPath);
  assert.equal(files.get(runtime.imageReceiptPath).sha256, deployment.imageReceipt.sha256);
  assert.deepEqual(deployment.auxiliaryContainers.map(row => row.role).sort(), ['nacos', 'redis', 'zookeeper']);
  const expectedIds = [resources.mysqlId, ...Object.values(deployment.services).map(row => row.containerId),
    ...deployment.auxiliaryContainers.map(row => row.containerId)];
  assert.deepEqual([...expectedIds].sort(), [...runtime.backendIds].sort());
  const frontIds = frontendPins.map(row => row.pin.containerId);
  assert.equal(new Set([...expectedIds, ...frontIds]).size, 10);
  const all = inspect(['inspect', ...expectedIds, ...frontIds], execute);
  assert.equal(all.length, 10);
  const [network] = inspect(['network', 'inspect', input.network], execute);
  assert.deepEqual(Object.keys(network.Containers).sort(), [...expectedIds, ...frontIds].sort());
  for (const row of frontendPins) {
    const container = all.find(container => container.Id === row.pin.containerId);
    const app = input.applications.find(app => app.application === row.application);
    assert.deepEqual(verifyOwnedFrontendContainer(input, app, container, network, {
      expectedId: row.pin.containerId, expectedLaunchToken: row.pin.launchToken,
    }), row.pin);
  }
  const { network: backendNetwork } = projectOwnedBackendNetwork({
    baseline: runtime.networkBaseline, network, frontends: frontendPins.map(row => row.pin),
  });
  const backend = all.filter(container => expectedIds.includes(container.Id));
  const origins = validateDeployment(manifest, resources, deployment, backend, backendNetwork,
    images, inspectMysqlFixtureVolumes(resources, { execute }));
  assert.deepEqual(origins, {
    backend: `http://${input.ownedBackend.endpoints.backend.ipv4}:30086`,
    uaa: `http://${input.ownedBackend.endpoints.uaa.ipv4}:32666`,
  });
  assert.deepEqual(ownedFrontendTopologyWitness({
    containers: backend, network: backendNetwork, image: { Id: input.ownedBackend.frontendImageId },
  }), runtime.topology, 'Owned backend lifecycle, configuration or storage witness drift');
  assert.deepEqual(mountedMetadataSnapshot(runtime.mounts), runtime.mountedMetadata, 'Owned mounted metadata or inventory drift');
  if (fullMountedHash) {
    assert.deepEqual(snapshotMounts(runtime.mounts), runtime.mountedInputs, 'Owned mounted input drift');
    assert.deepEqual(mountedMetadataSnapshot(runtime.mounts), runtime.mountedMetadata,
      'Owned mounted metadata changed during full hashing');
  }
}

async function runBridgeWorker(specPath, specSha256) {
  assert.match(specSha256 ?? '', idPattern);
  const directories = new PinnedDirectories();
  let server;
  try {
    specPath = childPath(join(workspaceRoot, outputRoot), specPath);
    const file = readBound(directories, specPath, { privateInput: true });
    assert.equal(file.sha256, specSha256);
    const spec = JSON.parse(file.data);
    exactKeys(spec, ['contract', 'application', 'input', 'inputDirectory', 'launcherSha256',
      'pin', 'peerIds', 'port', 'readyPath', 'runtime', 'frontendPins']);
    assert.equal(spec.contract, 'owned-modeldesign-loopback-bridge-v1');
    assert.ok(['Central', 'ModelDesign'].includes(spec.application));
    assert.equal(spec.launcherSha256, hash(fs.readFileSync(toolPath)));
    assert.equal(spec.readyPath, join(dirname(specPath), `${spec.application.toLowerCase()}.bridge-ready.private.json`));
    assert.ok(spec.peerIds.length === 10 && new Set(spec.peerIds).size === 10);
    assert.ok(spec.peerIds.every(id => idPattern.test(id)));
    assert.equal(dirname(spec.input.path), spec.inputDirectory);
    childPath(join(workspaceRoot, '.artifacts/native-model-design-owned-backend'), spec.input.path);
    const inputFile = readBound(directories, spec.input.path);
    assert.deepEqual(binding(inputFile), spec.input);
    const input = JSON.parse(inputFile.data);
    const app = input.applications.find(row => row.application === spec.application);
    assert.equal(Number(new URL(app.entry).port), spec.port);
    const guard = (fullMountedHash = false) => {
      assert.equal(hash(fs.readFileSync(toolPath)), spec.launcherSha256);
      assert.equal(readBound(directories, spec.input.path).sha256, spec.input.sha256);
      verifyOwnedBridgeRuntime({
        directories, input, runtime: spec.runtime, frontendPins: spec.frontendPins, fullMountedHash,
      });
      assert.deepEqual(spec.frontendPins.find(row => row.application === spec.application).pin, spec.pin);
      assert.deepEqual([...spec.runtime.backendIds, ...spec.frontendPins.map(row => row.pin.containerId)].sort(),
        spec.peerIds);
    };
    guard(true);
    const sockets = new Set();
    server = createServer(incoming => {
      try { guard(); }
      catch { incoming.destroy(); return; }
      const upstream = connect({ host: spec.pin.ipv4, port: 8080 });
      for (const socket of [incoming, upstream]) {
        sockets.add(socket);
        socket.once('close', () => sockets.delete(socket));
        socket.on('error', () => { incoming.destroy(); upstream.destroy(); });
        socket.setTimeout(120_000, () => { incoming.destroy(); upstream.destroy(); });
      }
      incoming.pipe(upstream);
      upstream.pipe(incoming);
    });
    await new Promise((done, reject) => {
      server.once('error', reject);
      server.listen(spec.port, '127.0.0.1', done);
    });
    const close = () => {
      for (const socket of sockets) socket.destroy();
      server.close(() => { directories.close(); process.exit(0); });
    };
    process.once('SIGTERM', close);
    process.once('SIGINT', close);
    directories.write(directories.open(dirname(spec.readyPath)), basename(spec.readyPath), json({
      contract: spec.contract, pid: process.pid, specSha256, port: spec.port, host: '127.0.0.1',
    }));
  } catch {
    server?.close();
    directories.close();
    throw new Error('Owned bridge worker refused; private details suppressed');
  }
}

export async function launchOwnedNativeModelDesign({
  workspace = workspaceRoot, input: inputPath, inputSha256, deploymentInput, deploymentInputSha256,
  output, allowOwnedFrontendLaunch = false,
} = {}, {
  execute = spawnSync, verifyAssets = verifyNativeAiCodeRuntimeAssets,
  verifyImages = verifyOwnedBackendImagesReadOnly, openRuntime = ownedNativeRuntimeContext,
  startBridge = startLoopbackBridge, stopBridge = stopLoopbackBridge, checkPort = unusedPort,
  request = fetch, wait = delay, readyAttempts = 90,
} = {}) {
  assert.equal(allowOwnedFrontendLaunch, true, 'Explicit owned frontend launch opt-in required');
  assert.match(inputSha256 ?? '', idPattern);
  assert.match(deploymentInputSha256 ?? '', idPattern);
  workspace = resolve(workspace);
  const directories = new PinnedDirectories();
  let context;
  const state = { containers: [], bridges: [], attempts: [] };
  let input;
  let destination;
  let target;
  let stage = 'input-contract';
  const report = {
    schemaVersion: 1, contract: 'owned-native-modeldesign-launch-v1', startedAt: new Date().toISOString(),
    nativeAcceptance: false, nativeAccepted: false, permissionAcceptance: false,
    acceptedForProduction: false, errors: [], containers: [], bridges: [],
  };
  try {
    inputPath = childPath(join(workspace, '.artifacts/native-model-design-owned-backend'),
      resolve(workspace, inputPath));
    assert.equal(basename(inputPath), 'input.json');
    const inputFile = readBound(directories, inputPath);
    assert.equal(inputFile.sha256, inputSha256);
    input = JSON.parse(inputFile.data);
    assert.equal(input.contract, 'native-model-design-owned-backend-launch-input-v1');
    assert.equal(basename(dirname(inputPath)), input.name);
    const preparationFile = readBound(directories, join(dirname(inputPath), 'report.json'));
    const preparation = JSON.parse(preparationFile.data);
    assert.equal(preparation.contract, 'native-model-design-owned-backend-preparation-v1');
    assert.equal(preparation.status, 'PREPARED-NOT-ACCEPTED');
    assert.equal(preparation.inputSha256, inputSha256);
    assert.deepEqual(preparation.errors, []);
    assert.equal(preparation.run, false);
    assert.equal(preparation.launchAuthorized, false);
    assert.equal(preparation.nativeAccepted, false);
    assert.equal(preparation.acceptedForProduction, false);
    assert.equal(input.launchAuthorized, false);
    assert.equal(input.nativeAccepted, false);
    assert.equal(input.acceptedForProduction, false);
    assert.equal(input.ownedBackend.deploymentInput.sha256, deploymentInputSha256);
    const originalFile = readBound(directories, input.ownedBackend.originalLaunchInput.path);
    assert.deepEqual(binding(originalFile), input.ownedBackend.originalLaunchInput);
    childPath(join(workspace, '.artifacts/native-model-design-isolated'), originalFile.path);
    const original = JSON.parse(originalFile.data);
    const originalReportFile = readBound(directories, join(dirname(originalFile.path), 'report.json'));
    const originalReport = JSON.parse(originalReportFile.data);
    assert.deepEqual(binding(originalReportFile), preparation.originalLaunchReport);
    assert.equal(originalReport.inputSha256, originalFile.sha256);
    assert.equal(originalReport.contract, 'native-model-design-isolated-launch');
    assert.equal(originalReport.status, 'PREPARED-NOT-ACCEPTED');
    assert.equal(originalReport.run, false);
    assert.deepEqual(originalReport.containers, []);
    assert.deepEqual(originalReport.errors, []);
    stage = 'source-assets';
    const assets = verifyAssets({ workspace, assets: original.assets });
    assert.equal(assets.directory, original.assets);
    assert.equal(assets.candidate, original.candidate);
    assert.ok(assets.receipt.modelDesignRuntime);
    assert.deepEqual(input.frontend, original.frontend);
    assert.deepEqual(original.frontend, assets.receipt.frontend,
      'Mounted frontend and runtime assets must bind the same source distribution');
    const serviceCandidate = original.serviceCandidate
      ? verifyNativeCentralServiceCandidate({
        workspace, receiptPath: original.serviceCandidate.receipt.path,
      }) : undefined;
    assert.deepEqual(serviceCandidate, original.serviceCandidate,
      'Mounted Central service candidate binding changed');
    const frontendReceiptFile = original.frontend
      ? readBound(directories, original.frontend.receipt.path) : undefined;
    const serviceReceiptFile = original.serviceCandidate
      ? readBound(directories, original.serviceCandidate.receipt.path) : undefined;
    const serviceModelFile = original.serviceCandidate
      ? readBound(directories, original.serviceCandidate.file.path) : undefined;
    if (serviceReceiptFile) assert.deepEqual(binding(serviceReceiptFile), serviceCandidate.receipt);
    if (serviceModelFile) assert.deepEqual(binding(serviceModelFile), serviceCandidate.file);
    if (frontendReceiptFile) assert.deepEqual(binding(frontendReceiptFile), original.frontend.receipt);
    const candidateFile = readBound(directories, join(assets.candidate, 'receipt.json'));
    const assetFile = readBound(directories, join(assets.directory, 'receipt.json'));
    assert.deepEqual(JSON.parse(assetFile.data), assets.receipt);
    assert.deepEqual(input.evidence, {
      candidateReceiptSha256: candidateFile.sha256, runtimeReceiptSha256: assetFile.sha256,
      sourceBuildReport: assets.receipt.modelDesignRuntime.sourceBuildReport,
      runtime: assets.receipt.modelDesignRuntime.runtime,
    });
    const mountedMetadata = mountedMetadataSnapshot(original.mounts);
    assert.deepEqual(snapshotMounts(original.mounts), preparation.mountedInputs);
    assert.deepEqual(mountedMetadataSnapshot(original.mounts), mountedMetadata);
    stage = 'owned-runtime';
    const deploymentFile = readBound(directories, childPath(workspace, deploymentInput), { privateInput: true });
    assert.equal(deploymentFile.sha256, deploymentInputSha256);
    context = openRuntime({
      workspace, runId: input.ownedBackend.runId, deploymentInput: deploymentFile.path, execute,
    });
    const { manifest, resources, deployment } = context;
    assert.equal(deployment.runId, input.ownedBackend.runId);
    assert.equal(resources.networkId, input.network);
    assert.deepEqual([...deployment.auxiliaryContainers.map(row => row.role)].sort(), ['nacos', 'redis', 'zookeeper']);
    assert.deepEqual(Object.keys(deployment.services).sort(), ['allinone', 'gateway', 'provider', 'uaa']);
    const manifestFile = readBound(directories, input.ownedBackend.manifest.path);
    const resourcesFile = readBound(directories, input.ownedBackend.resources.path, { privateInput: true });
    assert.equal(manifestFile.path, join(context.base, 'manifest.json'));
    assert.equal(resourcesFile.path, join(context.base, 'owned-resources.json'));
    assert.deepEqual(binding(manifestFile), input.ownedBackend.manifest);
    assert.deepEqual(binding(resourcesFile), input.ownedBackend.resources);
    assert.deepEqual(JSON.parse(manifestFile.data), manifest);
    assert.deepEqual(JSON.parse(resourcesFile.data), resources);
    assert.deepEqual(JSON.parse(deploymentFile.data), deployment);
    const images = verifyImages({ workspace, reportPath: input.ownedBackend.imageReceipt.path, execute });
    const imageFile = readBound(directories, input.ownedBackend.imageReceipt.path);
    assert.equal(imageFile.path, resolve(workspace, deployment.imageReceipt.path));
    assert.deepEqual(binding(imageFile), input.ownedBackend.imageReceipt);
    assert.equal(images.reportSha256, imageFile.sha256);
    assert.deepEqual(images.report, JSON.parse(imageFile.data));
    assert.equal(images.imageArtifactBindingVerified, true);
    assert.equal(images.verificationMode, 'source-and-recorded-probes-with-live-image-inspection');
    const [frontendImage] = inspect(['image', 'inspect', 'aibiz/modelingweb:local'], execute);
    assert.match(frontendImage.Id, imagePattern);
    assert.equal(frontendImage.Os, 'linux');
    const topology = context.guard();
    assert.equal(topology.containers.length, 8, 'Complete eight-node backend topology required');
    const backendIds = topology.containers.map(row => row.Id);
    const witness = ownedFrontendTopologyWitness({ ...topology, image: frontendImage });
    assert.deepEqual(witness, preparation.topology);
    const nginxFile = readBound(directories, input.ownedBackend.originalNginx.path);
    assert.equal(nginxFile.path, join(assets.directory, 'nginx-native.conf'));
    assert.deepEqual(binding(nginxFile), input.ownedBackend.originalNginx);
    const overlay = ownedBackendNginx(nginxFile.data.toString('utf8'), topology.origins);
    const overlayFile = readBound(directories, join(dirname(inputPath), 'nginx-native.conf'));
    assert.equal(overlayFile.data.toString('utf8'), overlay);
    assert.equal(overlayFile.sha256, preparation.nginxSha256);
    const rebuilt = rebuildOwnedFrontendInput({
      workspace, original, destination: dirname(inputPath), manifest, resources, deployment,
      frontendImage, origins: topology.origins, evidence: input.evidence,
      originalBinding: binding(originalFile), manifestBinding: binding(manifestFile),
      resourcesBinding: binding(resourcesFile), imageBinding: binding(imageFile),
      nginxBinding: binding(nginxFile), overlaySha256: overlayFile.sha256,
    });
    assert.deepEqual(input, rebuilt, 'Persisted command, environment, mount or ownership contract changed');
    stage = 'exclusive-output';
    destination = childPath(workspace, output ?? join(outputRoot, input.name));
    assert.equal(dirname(destination), join(workspace, outputRoot));
    assert.match(basename(destination), /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$/);
    directoryPath(dirname(destination), { allowMissing: true });
    for (const mount of input.mounts) {
      assert.ok(!resolve(destination).startsWith(`${resolve(mount.source)}/`) && destination !== mount.source);
    }
    assert.ok(!fs.existsSync(destination), 'Previous launch evidence cannot be overwritten');
    const names = docker(['ps', '--all', '--format', '{{.Names}}'], execute).stdout.trim().split('\n');
    for (const app of input.applications) {
      assert.ok(!names.includes(app.container), 'Frontend name already exists');
      await checkPort(Number(new URL(app.entry).port));
    }
    target = directories.open(destination, { create: true, exclusive: true });
    report.input = binding(inputFile);
    report.deploymentInput = binding(deploymentFile);
    report.preparation = binding(preparationFile);
    report.tool = { path: toolPath, sha256: hash(fs.readFileSync(toolPath)) };
    directories.write(target, 'network-baseline.private.json', json(topology.network));
    const networkBaselineFile = readBound(directories,
      join(destination, 'network-baseline.private.json'), { privateInput: true });
    report.privateNetworkBaseline = binding(networkBaselineFile);
    const guardFiles = [inputFile, preparationFile, originalFile, originalReportFile, candidateFile,
      assetFile, deploymentFile, manifestFile, resourcesFile, imageFile, nginxFile, overlayFile,
      networkBaselineFile];
    if (frontendReceiptFile) guardFiles.push(frontendReceiptFile);
    if (serviceReceiptFile) guardFiles.push(serviceReceiptFile);
    if (serviceModelFile) guardFiles.push(serviceModelFile);
    for (const row of context.bindings) {
      if (guardFiles.some(file => file.path === row.path)) continue;
      const file = readBound(directories, row.path, {
        privateInput: basename(row.path).endsWith('.private.json') || basename(row.path) === 'owned-resources.json',
      });
      assert.deepEqual(binding(file), row);
      guardFiles.push(file);
    }
    const runtime = {
      bindings: guardFiles.map(file => ({
        ...binding(file), privateInput: file === deploymentFile || file === resourcesFile
          || basename(file.path).endsWith('.private.json'),
      })),
      backendIds, manifestPath: manifestFile.path, resourcesPath: resourcesFile.path,
      deploymentPath: deploymentFile.path, imageReceiptPath: imageFile.path, topology: witness,
      mounts: original.mounts, mountedInputs: preparation.mountedInputs,
      mountedMetadata, networkBaseline: topology.network,
    };
    let networkInspectionSequence = 0;
    const guard = ({ healthy = true } = {}) => {
      const backend = inspect(['inspect', ...backendIds], execute);
      const [network] = inspect(['network', 'inspect', input.network], execute);
      assert.deepEqual(Object.keys(network.Containers).sort(),
        [...backendIds, ...state.containers.map(row => row.id)].sort(), 'Unexpected network peer');
      for (const row of state.containers) {
        const [container] = inspect(['inspect', row.id], execute);
        row.pin = verifyOwnedFrontendContainer(input, input.applications.find(app =>
          app.application === row.application), container, network, { healthy, expectedId: row.id });
        assert.equal(row.pin.launchToken, row.launchToken);
      }
      let inspectionReceipt;
      if (state.containers.length) {
        const sequence = String(++networkInspectionSequence).padStart(4, '0');
        const name = `network-attached-${sequence}.private.json`;
        directories.write(target, name, json({
          contract: 'owned-frontend-attached-network-v1', at: new Date().toISOString(), stage,
          baseline: binding(networkBaselineFile), network,
          verifiedFrontends: state.containers.map(row => row.pin),
        }));
        inspectionReceipt = {
          snapshot: binding(readBound(directories, join(destination, name), { privateInput: true })),
          sequence,
        };
        report.privateNetworkInspections ??= [];
        report.privateNetworkInspections.push(inspectionReceipt);
      }
      const projection = projectOwnedBackendNetwork({
        baseline: topology.network, network, frontends: state.containers.map(row => row.pin),
      });
      const backendNetwork = projection.network;
      if (inspectionReceipt) {
        const name = `network-projection-${inspectionReceipt.sequence}.private.json`;
        directories.write(target, name, json(projection.evidence));
        inspectionReceipt.proof = binding(readBound(directories,
          join(destination, name), { privateInput: true }));
      }
      const origins = validateDeployment(manifest, resources, deployment, backend, backendNetwork,
        images.report, inspectMysqlFixtureVolumes(resources, { execute }));
      assert.deepEqual(origins, topology.origins);
      assert.deepEqual(ownedFrontendTopologyWitness({
        containers: backend, network: backendNetwork, image: frontendImage,
      }), witness, 'Backend topology, configuration or lifecycle drift');
      for (const file of guardFiles) {
        const current = readBound(directories, file.path, {
          privateInput: file === deploymentFile || file === resourcesFile || basename(file.path).endsWith('.private.json'),
        });
        assert.equal(current.sha256, file.sha256, 'Bound input drift');
        assert.equal(current.identity.ino, file.identity.ino, 'Bound input replaced');
        assert.equal(current.identity.dev, file.identity.dev, 'Bound input device changed');
      }
    };
    stage = 'final-source-assets';
    assert.deepEqual(verifyAssets({ workspace, assets: original.assets }), assets);
    if (serviceCandidate) assert.deepEqual(verifyNativeCentralServiceCandidate({
      workspace, receiptPath: serviceCandidate.receipt.path,
    }), serviceCandidate, 'Central service candidate changed before launch');
    assert.deepEqual(snapshotMounts(original.mounts), preparation.mountedInputs);
    const repeatedImages = verifyImages({ workspace, reportPath: imageFile.path, execute });
    assert.deepEqual(repeatedImages, images);
    guard();
    for (const app of input.applications) {
      stage = `launch-${app.application.toLowerCase()}`;
      guard();
      const cidPath = join(destination, `${app.application.toLowerCase()}.cid`);
      assert.ok(!fs.existsSync(cidPath));
      const attempt = {
        application: app.application, name: app.container, cidPath,
        launchToken: randomBytes(18).toString('hex'), startedAt: new Date().toISOString(),
      };
      state.attempts.push(attempt);
      directories.write(target, `${app.application.toLowerCase()}.attempt.private.json`, json(attempt));
      const result = docker(ownedFrontendRunArguments(rebuilt, rebuilt.applications.find(row =>
        row.application === app.application), cidPath, attempt.launchToken), execute, { allowFailure: true });
      let candidate;
      if (fs.existsSync(cidPath)) {
        const cid = readBound(directories, cidPath).data.toString('utf8').trim();
        assert.match(cid, idPattern, 'Invalid owned container ID file');
        [candidate] = inspect(['inspect', cid], execute);
      } else {
        const recovery = docker(['container', 'inspect', attempt.name], execute, { allowFailure: true });
        if (recovery.status === 0 && !recovery.error && !recovery.signal) {
          const found = JSON.parse(recovery.stdout);
          assert.equal(found.length, 1);
          [candidate] = found;
        }
      }
      if (candidate) {
        verifyAttemptContainer(input, app, attempt, candidate);
        state.containers.push({
          application: app.application, id: candidate.Id, launchToken: attempt.launchToken,
        });
        attempt.containerId = candidate.Id;
      }
      assert.ok(!result.error && result.status === 0 && !result.signal,
        'Owned frontend launch failed; raw output suppressed');
      assert.equal(state.containers.at(-1)?.application, app.application, 'Docker did not create its ID file');
      const row = state.containers.at(-1);
      assert.equal(result.stdout.trim(), row.id);
      let ready = false;
      for (let attempt = 0; attempt < readyAttempts; attempt++) {
        guard({ healthy: false });
        const [container] = inspect(['inspect', row.id], execute);
        if (!container.State.Running) break;
        if (container.State.Health?.Status === 'healthy') {
          const response = await request(`http://${row.pin.ipv4}:8080/${app.application.toLowerCase()}/`,
            { redirect: 'error', signal: AbortSignal.timeout(3000) });
          await response.arrayBuffer();
          if (response.status === 200) { ready = true; break; }
        }
        await wait(1000);
      }
      assert.ok(ready, 'Owned frontend failed readiness');
      guard();
    }
    stage = 'loopback-bridges';
    const peerIds = [...backendIds, ...state.containers.map(row => row.id)];
    for (const app of input.applications) {
      guard();
      const row = state.containers.find(row => row.application === app.application);
      let registered;
      const bridge = await startBridge({
        directory: target, directories, application: app, inputFile, input, pin: row.pin, peerIds,
        runtime, frontendPins: state.containers.map(row => ({ application: row.application, pin: row.pin })),
        registerBridge: value => {
          assert.ok(!registered, 'A bridge must be registered exactly once');
          registered = { application: app.application, ...value };
          state.bridges.push(registered);
        },
      });
      assert.ok(registered && bridge.specPath === registered.specPath);
      const response = await request(app.entry, { redirect: 'error', signal: AbortSignal.timeout(5000) });
      await response.arrayBuffer();
      assert.equal(response.status, 200);
    }
    stage = 'final-verification';
    guard();
    assert.deepEqual(snapshotMounts(original.mounts), preparation.mountedInputs);
    report.status = 'RUNNING-OWNED-FRONTEND-NOT-ACCEPTED';
    report.containers = state.containers.map(row => ({ application: row.application, id: row.id,
      pin: row.pin, entry: input.applications.find(app => app.application === row.application).entry }));
    report.bridges = state.bridges.map(row => ({ application: row.application, identity: row.identity, port: row.port }));
  } catch (error) {
    report.status = 'FAILED-NOT-ACCEPTED';
    report.errors.push(`Owned frontend launch refused at ${stage}; private details suppressed`);
    const privateDiagnostic = (name, data) => {
      directories.write(target, name, typeof data === 'string' ? data : json(data));
      return binding(readBound(directories, join(destination, name), { privateInput: true }));
    };
    if (target) {
      try {
        report.privateFailure = privateDiagnostic('failure.private.json', {
          contract: 'owned-native-modeldesign-private-failure-v1', stage, at: new Date().toISOString(),
          error: { name: error?.name ?? null, message: String(error?.message ?? error),
            stack: typeof error?.stack === 'string' ? error.stack : null, code: error?.code ?? null },
        });
      } catch { report.errors.push('Private failure details could not be written'); }
    }
    for (const bridge of [...state.bridges].reverse()) {
      try {
        const result = await stopBridge(bridge);
        report.bridgeCleanup ??= [];
        report.bridgeCleanup.push({
          application: bridge.application, pid: bridge.identity.pid, forced: result?.forced === true,
        });
      }
      catch { report.errors.push('Exact bridge cleanup refused; identity may have changed'); }
    }
    for (const row of [...state.containers].reverse()) {
      try {
        const [container] = inspect(['inspect', row.id], execute);
        assert.equal(container.Id, row.id);
        const app = input.applications.find(app => app.application === row.application);
        const attempt = state.attempts.find(attempt => attempt.application === row.application);
        verifyAttemptContainer(input, app, attempt, container);
        assert.equal(attempt.launchToken, row.launchToken);
        if (target) {
          try {
            const code = row.application.toLowerCase();
            const inspection = privateDiagnostic(`${code}.failure-inspect.private.json`, container);
            const logs = docker(['logs', '--timestamps', '--tail', '200', row.id], execute, { allowFailure: true });
            const stdout = privateDiagnostic(`${code}.failure-stdout.private.log`, logs.stdout ?? '');
            const stderr = privateDiagnostic(`${code}.failure-stderr.private.log`, logs.stderr ?? '');
            const command = privateDiagnostic(`${code}.failure-logs.private.json`, {
              containerId: row.id, tail: 200, exitCode: logs.status ?? null, signal: logs.signal ?? null,
              error: logs.error ? { name: logs.error.name, code: logs.error.code ?? null } : null,
              stdout, stderr,
            });
            report.privateContainerDiagnostics ??= [];
            report.privateContainerDiagnostics.push({ application: row.application, id: row.id, inspection, command });
          } catch { report.errors.push('Exact owned container private diagnostics could not be completed'); }
        }
        docker(['rm', '--force', row.id], execute);
        row.removed = true;
      } catch { report.errors.push('Exact container cleanup refused; identity may have changed'); }
    }
    report.containers = state.containers.map(({ application, id, removed }) => ({ application, id, removed: !!removed }));
  } finally {
    report.finishedAt = new Date().toISOString();
    try {
      if (target) {
        try {
          directories.write(target, 'launch-state.private.json', json({
            contract: 'owned-native-modeldesign-launch-state-v1', input: report.input,
            toolSha256: report.tool.sha256, containers: state.containers, bridges: state.bridges,
            attempts: state.attempts,
          }));
        } catch {
          report.status = 'FAILED-NOT-ACCEPTED';
          report.errors.push('Private launch state could not be written');
        }
        directories.write(target, 'report.json', json(report));
      }
    } finally {
      context?.close();
      directories.close();
    }
  }
  return { destination, report };
}

export async function cleanupOwnedNativeModelDesign({
  workspace = workspaceRoot, launchDirectory, stateSha256, allowOwnedFrontendCleanup = false,
} = {}, { execute = spawnSync, stopBridge = stopLoopbackBridge } = {}) {
  assert.equal(allowOwnedFrontendCleanup, true, 'Explicit owned frontend cleanup opt-in required');
  assert.match(stateSha256 ?? '', idPattern);
  const directories = new PinnedDirectories();
  let target;
  const report = {
    contract: 'owned-native-modeldesign-cleanup-v1', status: 'FAILED-NOT-ACCEPTED',
    removed: [], errors: [], nativeAcceptance: false, nativeAccepted: false, acceptedForProduction: false,
  };
  try {
    const base = childPath(join(resolve(workspace), outputRoot), resolve(workspace, launchDirectory));
    assert.equal(dirname(base), join(resolve(workspace), outputRoot));
    target = directories.open(base);
    const stateFile = readBound(directories, join(base, 'launch-state.private.json'), { privateInput: true });
    report.state = binding(stateFile);
    assert.equal(stateFile.sha256, stateSha256);
    const state = JSON.parse(stateFile.data);
    exactKeys(state, ['contract', 'input', 'toolSha256', 'containers', 'bridges', 'attempts']);
    assert.equal(state.contract, 'owned-native-modeldesign-launch-state-v1');
    assert.equal(state.toolSha256, hash(fs.readFileSync(toolPath)));
    const inputFile = readBound(directories, state.input.path);
    assert.deepEqual(binding(inputFile), state.input);
    const input = JSON.parse(inputFile.data);
    assert.equal(input.contract, 'native-model-design-owned-backend-launch-input-v1');
    childPath(join(resolve(workspace), '.artifacts/native-model-design-owned-backend'), inputFile.path);
    assert.ok(Array.isArray(state.containers) && state.containers.length <= 2);
    assert.ok(Array.isArray(state.bridges) && state.bridges.length <= 2);
    assert.equal(new Set(state.containers.map(row => row.id)).size, state.containers.length);
    for (const rows of [state.containers, state.bridges]) {
      assert.ok(rows.every(row => ['Central', 'ModelDesign'].includes(row.application)));
      assert.equal(new Set(rows.map(row => row.application)).size, rows.length);
    }
    assert.ok(Array.isArray(state.attempts) && state.attempts.length <= 2);
    assert.equal(new Set(state.attempts.map(row => row.application)).size, state.attempts.length);
    const owned = [...state.containers];
    for (const attempt of state.attempts) {
      const app = input.applications.find(app => app.application === attempt.application);
      assert.ok(app);
      assert.equal(attempt.cidPath, join(base, `${attempt.application.toLowerCase()}.cid`));
      const { containerId, ...intent } = attempt;
      const intentFile = readBound(directories,
        join(base, `${attempt.application.toLowerCase()}.attempt.private.json`), { privateInput: true });
      assert.deepEqual(JSON.parse(intentFile.data), intent);
      const registered = owned.find(row => row.application === attempt.application);
      if (registered) {
        assert.equal(registered.launchToken, attempt.launchToken);
        if (containerId) assert.equal(registered.id, containerId);
      } else {
        const result = docker(['container', 'inspect', attempt.name], execute, { allowFailure: true });
        if (result.status === 0 && !result.error && !result.signal) {
          const found = JSON.parse(result.stdout);
          assert.equal(found.length, 1);
          verifyAttemptContainer(input, app, attempt, found[0]);
          owned.push({ application: app.application, id: found[0].Id, launchToken: attempt.launchToken });
        }
      }
    }
    assert.ok(owned.every(row => state.attempts.some(attempt => attempt.application === row.application
      && attempt.launchToken === row.launchToken)));
    const existing = docker(['ps', '--all', '--no-trunc', '--format', '{{.ID}}'], execute)
      .stdout.trim().split('\n');
    for (const row of owned) {
      assert.match(row.id, idPattern);
      const app = input.applications.find(app => app.application === row.application);
      if (existing.includes(row.id)) {
        const [container] = inspect(['inspect', row.id], execute);
        assert.equal(container.Id, row.id);
        assert.equal(container.Name, `/${app.container}`);
        assert.equal(container.Image, input.ownedBackend.frontendImageId);
        assert.equal(container.Config.Labels?.[frontendLabel], input.name);
        assert.equal(container.Config.Labels?.[fixtureLabel], input.ownedBackend.runId);
        assert.equal(container.Config.Labels?.[launchLabel], row.launchToken);
      }
    }
    for (const row of state.bridges) {
      assert.equal(row.specPath, join(base, `${row.application.toLowerCase()}.bridge.private.json`));
      const spec = readBound(directories, row.specPath, { privateInput: true });
      assert.equal(spec.sha256, row.specSha256);
      assert.equal(JSON.parse(spec.data).port, row.port);
      try { fs.lstatSync(`/proc/${row.identity.pid}`); }
      catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      verifyBridgeProcess(row.identity, row.specPath, row.specSha256);
    }
    report.bridgesStopped = [];
    for (const row of [...state.bridges].reverse()) {
      const result = await stopBridge(row);
      report.bridgesStopped.push({
        application: row.application, pid: row.identity.pid, forced: result?.forced === true,
      });
    }
    for (const row of [...owned].reverse()) {
      if (existing.includes(row.id)) { docker(['rm', '--force', row.id], execute); report.removed.push(row.id); }
    }
    report.status = 'CLEANED-OWNED-FRONTEND-NOT-ACCEPTED';
  } catch {
    report.errors.push('Owned frontend cleanup refused; private identity or input details suppressed');
  } finally {
    report.finishedAt = new Date().toISOString();
    try {
      if (target) directories.write(target, `cleanup-${randomBytes(6).toString('hex')}.json`, json(report));
    } finally { directories.close(); }
  }
  return report;
}

export async function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({ args: argv, options: {
    input: { type: 'string' }, 'input-sha256': { type: 'string' },
    'deployment-input': { type: 'string' }, 'deployment-input-sha256': { type: 'string' },
    output: { type: 'string' }, 'allow-owned-frontend-launch': { type: 'boolean' },
    'cleanup-launch': { type: 'string' }, 'state-sha256': { type: 'string' },
    'allow-owned-frontend-cleanup': { type: 'boolean' },
    'bridge-worker': { type: 'string' }, 'bridge-worker-sha256': { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) {
    console.log('Launch: --input PATH --input-sha256 SHA --deployment-input PRIVATE_PATH ' +
      '--deployment-input-sha256 SHA --allow-owned-frontend-launch [--output NEW_PATH]\n' +
      'Cleanup: --cleanup-launch PATH --state-sha256 SHA --allow-owned-frontend-cleanup');
    return 0;
  }
  if (values['bridge-worker']) {
    assert.deepEqual(Object.keys(values).sort(), ['bridge-worker', 'bridge-worker-sha256']);
    await runBridgeWorker(values['bridge-worker'], values['bridge-worker-sha256']);
    return 0;
  }
  if (values['cleanup-launch']) {
    assert.deepEqual(Object.keys(values).sort(),
      ['allow-owned-frontend-cleanup', 'cleanup-launch', 'state-sha256']);
    const report = await cleanupOwnedNativeModelDesign({
      launchDirectory: values['cleanup-launch'], stateSha256: values['state-sha256'],
      allowOwnedFrontendCleanup: values['allow-owned-frontend-cleanup'],
    });
    console.log(report.status);
    return report.errors.length ? 1 : 0;
  }
  const result = await launchOwnedNativeModelDesign({
    input: values.input, inputSha256: values['input-sha256'],
    deploymentInput: values['deployment-input'], deploymentInputSha256: values['deployment-input-sha256'],
    output: values.output, allowOwnedFrontendLaunch: values['allow-owned-frontend-launch'],
  });
  console.log(`${result.report.status}: ${result.destination ?? 'no launch output'}`);
  return result.report.errors.length ? 1 : 2;
}

if (process.argv[1] && resolve(process.argv[1]) === toolPath) {
  main().then(code => { process.exitCode = code; })
    .catch(() => { console.error('Owned frontend operation refused; private details suppressed'); process.exitCode = 1; });
}
