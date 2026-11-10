#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { PinnedDirectories, readPinnedFile } from './native-candidate-files.mjs';
import { sourceBuildInputs } from './source-build-identity.mjs';
import { ownedNativeRuntimeContext } from './owned-native-runtime-context.mjs';
import { retainedPeerWitness } from './launch-run-owned-native-backend.mjs';
import { validateDeployment } from './run-owned-native-permission-http.mjs';
import { inspectMysqlFixtureVolumes } from './owned-mysql-volume.mjs';
import {
  parseJavaProperties, privateContainerOrigin, probeUaaHttp, UAA_JAVA_OPTIONS,
  verifyCandidate, verifyProbeContainer,
} from './harness-run-owned-uaa-runtime.mjs';
import { prepareOwnedTokenWitness } from './owned-uaa-token-witness.mjs';
import { assertCurrentSource } from '../standalone-uaa/tools/token-security.mjs';
import { runtimeRoster, verifyBuildForPackaging } from '../standalone-uaa/tools/runtime-image.mjs';

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const owner = 'aibiz.native-fixture.run';

export function ownedUaaNetworkAliases({ runId, oldName, aliases, authenticationServiceUrl }) {
  assert.match(runId, /^[a-f0-9]{12}$/);
  const owned = new RegExp(`^nf-${runId}-uaa-[a-z0-9][a-z0-9-]{0,100}$`);
  assert.match(oldName, owned);
  assert.ok(Array.isArray(aliases) && aliases.every(alias => typeof alias === 'string'));
  const origin = new URL(authenticationServiceUrl);
  assert.equal(origin.protocol, 'http:');
  assert.equal(origin.port, '32666');
  assert.equal(origin.pathname + origin.search + origin.hash + origin.username + origin.password, '/');
  assert.match(origin.hostname, owned);
  return [...new Set([oldName, origin.hostname, ...aliases.filter(alias => owned.test(alias))])].sort();
}

export function verifyProtectedNativePeers(before, current) {
  assert.equal(before.length, 7);
  assert.equal(current.length, before.length);
  for (const previous of before) {
    const match = current.find(x => x.Id === previous.Id);
    assert.equal(match?.State.Running, true);
    assert.deepEqual(retainedPeerWitness(match), retainedPeerWitness(previous),
      'A protected owned peer changed during UAA replacement');
  }
}

export function ownedUaaRollbackInventory({ original, current, replacement, network, runId, label, imageId }) {
  assert.equal(current.Id, original.Id);
  assert.equal(current.Config.Labels?.[owner], runId);
  const immutable = container => {
    const { startedAt, restartCount, networks, ...witness } = retainedPeerWitness(container);
    return witness;
  };
  assert.deepEqual(immutable(current), immutable(original), 'Original owned UAA configuration drift');
  assert.ok(Object.keys(current.NetworkSettings.Networks)
    .every(name => name === network.Name), 'Original UAA joined an unexpected network');
  const oldAttached = Object.hasOwn(current.NetworkSettings.Networks, network.Name);
  if (oldAttached) assert.equal(current.NetworkSettings.Networks[network.Name].NetworkID, network.Id);
  if (replacement) {
    assert.notEqual(replacement.Id, original.Id);
    assert.match(replacement.Id, /^[a-f0-9]{64}$/);
    assert.equal(replacement.Name, `/nf-${runId}-uaa-${label}`);
    assert.equal(replacement.Image, imageId);
    assert.equal(replacement.Config.Labels?.[owner], runId);
    assert.equal(replacement.Config.Labels?.['aibiz.owned-uaa.replacement'], label);
    assert.ok(Object.keys(replacement.NetworkSettings.Networks)
      .every(name => name === network.Name), 'Replacement joined an unexpected network');
    if (Object.hasOwn(replacement.NetworkSettings.Networks, network.Name)) {
      assert.equal(replacement.NetworkSettings.Networks[network.Name].NetworkID, network.Id);
    }
  }
  return { oldAttached, oldRunning: current.State.Running,
    replacementId: replacement?.Id ?? null };
}

export async function replaceOwnedUaa({ runId, deploymentInput, runtimeReport, label }) {
  assert.match(label ?? '', /^[a-z0-9][a-z0-9-]{0,32}$/);
  const context = ownedNativeRuntimeContext({ workspace, runId, deploymentInput });
  const directories = new PinnedDirectories();
  const output = join(context.base, `backend-runtime-uaa-${label}`);
  const report = {
    contract: 'owned-source-uaa-replacement-v1', runId, label, status: 'running',
    startedAt: new Date().toISOString(), nativeAcceptance: false, permissionAcceptance: false,
    sharedServicesChanged: false, oldUaaStopped: false, oldUaaDetached: false,
    newUaaId: null, oldUaaRetainedForRollback: false, rollback: null, errors: [],
  };
  let target;
  let old;
  let protectedPeers;
  let network;
  let attachment;
  let newId;
  let candidateName;
  let candidateImage;
  let transitionStarted = false;
  let newLogWritten = false;
  let deployment;
  const docker = (args, allowFailure = false, input) => {
    const result = spawnSync('docker', args, {
      input, encoding: 'utf8', timeout: 180_000, maxBuffer: 16 * 1024 * 1024,
    });
    if (!allowFailure) assert.ok(result.status === 0 && !result.error && !result.signal,
      'Owned UAA replacement command failed; raw output suppressed');
    return result;
  };
  const inspect = id => JSON.parse(docker(['inspect', id]).stdout)[0];
  const inspectNetwork = () => JSON.parse(docker(['network', 'inspect', network.Id]).stdout)[0];
  const read = path => readPinnedFile(directories, directories.open(dirname(path)), basename(path)).data;
  const protectedGuard = extraIds => {
    verifyProtectedNativePeers(protectedPeers, protectedPeers.map(x => inspect(x.Id)));
    const current = inspectNetwork();
    assert.equal(current.Id, network.Id);
    assert.equal(current.Name, network.Name);
    assert.equal(current.Internal, true);
    assert.equal(current.Labels?.[owner], runId);
    assert.deepEqual(Object.keys(current.Containers).sort(),
      [...protectedPeers.map(x => x.Id), ...extraIds].sort());
    return current;
  };
  try {
    target = directories.open(output, { create: true, exclusive: true });
    const live = context.guard();
    network = live.network;
    old = live.containers.find(x => x.Id === context.deployment.services.uaa.containerId);
    assert.ok(old.Name.startsWith(`/nf-${runId}-uaa-`));
    protectedPeers = live.containers.filter(x => x.Id !== old.Id);
    attachment = old.NetworkSettings.Networks[network.Name];
    const oldOrigin = privateContainerOrigin(old, network, 32666);
    report.oldUaa = { id: old.Id, imageId: old.Image, name: old.Name, origin: oldOrigin };
    report.inputs = context.bindings;

    const runtimePath = resolve(workspace, runtimeReport);
    assert.equal(dirname(dirname(runtimePath)), join(workspace, '.artifacts/standalone-uaa-source-runtime'));
    assert.equal(basename(runtimePath), 'report.json');
    const runtimeBytes = read(runtimePath);
    const runtime = JSON.parse(runtimeBytes);
    const image = JSON.parse(docker(['image', 'inspect', runtime.image.id]).stdout)[0];
    verifyCandidate(runtime, image);
    const buildBytes = read(runtime.inputBuild.path);
    assert.equal(hash(buildBytes), runtime.inputBuild.sha256);
    const build = JSON.parse(buildBytes);
    verifyBuildForPackaging(build);
    assertCurrentSource(build);
    assert.deepEqual(runtime.binding.expected, runtimeRoster(build));
    for (const item of runtimeRoster(build)) {
      assert.equal(hash(read(join(dirname(runtime.inputBuild.path), item.path))), item.sha256);
    }
    assert.deepEqual(sourceBuildInputs(join(workspace, 'standalone-uaa/starters')),
      build.maintainedInputs.starterBefore);
    report.runtime = { path: runtimePath, sha256: hash(runtimeBytes), imageId: image.Id,
      sourceFingerprint: runtime.sourceFingerprint };
    const configMount = old.Mounts.filter(x => x.Destination === '/opt/uaa/config');
    assert.equal(configMount.length, 1);
    assert.equal(configMount[0].Type, 'bind');
    assert.equal(configMount[0].RW, false);
    assert.ok(configMount[0].Source.startsWith(`${context.base}/`));
    const properties = read(join(configMount[0].Source, 'application.properties'));
    const configuration = parseJavaProperties(properties);
    assert.equal(configuration['ibiz.jwt.expiration'], '20000');
    assert.equal(configuration['spring.datasource.username'], `nf_${runId}_uaa_app`);
    assert.equal(configuration['spring.datasource.defaultSchema'], context.manifest.schemas.uaa);
    const config = directories.open(join(output, 'config'), { create: true, exclusive: true });
    directories.write(config, 'application.properties', properties, 0o644);
    directories.write(config, 'logback.xml', read(join(configMount[0].Source, 'logback.xml')), 0o644);
    fs.chmodSync(config.path, 0o755);
    report.configurationSha256 = hash(properties);
    report.tokenExpirationMilliseconds = 20000;
    const redis = context.deployment.auxiliaryContainers.find(x => x.role === 'redis');
    const redisName = live.containers.find(x => x.Id === redis.containerId).Name.slice(1);
    const witness = prepareOwnedTokenWitness({
      directories, output, workspace, imageId: image.Id, runId, redisName, docker,
    });
    report.tokenStoreWitness = witness.evidence;
    const name = `nf-${runId}-uaa-${label}`;
    candidateName = name;
    candidateImage = image.Id;
    const absent = docker(['container', 'inspect', name], true);
    assert.equal(absent.status, 1);
    assert.equal(absent.stderr.trim(), `Error response from daemon: No such container: ${name}`);
    const basis = directories.open(dirname(resolve(workspace, deploymentInput)));
    const configs = readPinnedFile(directories, basis, 'nacos-configs.private.json').data;
    const originalReport = JSON.parse(readPinnedFile(directories, basis, 'report.json').data);
    const authConfig = JSON.parse(configs).find(row => row.dataId === 'cloud-auth-agent-rt');
    assert.equal(authConfig.group, `nf_${runId}`);
    assert.equal(hash(authConfig.content), originalReport.nacosConfigurationBindings
      .find(row => row.dataId === authConfig.dataId)?.sha256);
    assert.ok(authConfig.content.startsWith('---\n'));
    const networkAliases = ownedUaaNetworkAliases({
      runId, oldName: old.Name.slice(1), aliases: attachment.Aliases ?? [],
      authenticationServiceUrl: JSON.parse(authConfig.content.slice(4)).serviceurl,
    });
    for (const peer of protectedPeers) {
      const names = [peer.Name.slice(1), ...(peer.NetworkSettings.Networks[network.Name].Aliases ?? [])];
      assert.ok(networkAliases.every(alias => !names.includes(alias)), 'UAA alias conflicts with another owned peer');
    }
    report.preservedNetworkAliases = networkAliases;
    directories.write(target, 'nacos-configs.private.json', configs);
    report.nacosConfigurationBindings = originalReport.nacosConfigurationBindings;

    context.guard();
    // Docker may complete a transition even when its client times out.
    transitionStarted = true;
    docker(['stop', '--time', '30', old.Id]);
    report.oldUaaStopped = true;
    docker(['network', 'disconnect', network.Id, old.Id]);
    report.oldUaaDetached = true;
    protectedGuard([]);
    const args = ['run', '--detach', '--pull=never', '--name', name,
      '--network', network.Id, '--ip', attachment.IPAddress,
      ...networkAliases.flatMap(alias => ['--network-alias', alias]),
      '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges',
      '--label', `${owner}=${runId}`, '--label', `aibiz.owned-uaa.replacement=${label}`,
      '--tmpfs', '/tmp:rw,nosuid,nodev,size=268435456',
      '--mount', `type=bind,src=${config.path},dst=/opt/uaa/config,readonly`,
      '--mount', `type=bind,src=${witness.classesPath},dst=/opt/uaa/witness,readonly`,
      '--env', 'SPRING_CLOUD_BOOTSTRAP_ENABLED=false',
      '--env', 'SPRING_CLOUD_NACOS_CONFIG_ENABLED=false',
      '--env', 'SPRING_CLOUD_NACOS_DISCOVERY_ENABLED=false',
      '--env', `JAVA_TOOL_OPTIONS=${UAA_JAVA_OPTIONS}`,
      image.Id, '--spring.config.location=classpath:/,file:/opt/uaa/config/application.properties'];
    newId = docker(args).stdout.trim();
    assert.match(newId, /^[a-f0-9]{64}$/);
    report.newUaaId = newId;
    const deadline = Date.now() + 120_000;
    let ready = false;
    while (Date.now() < deadline) {
      const current = inspect(newId);
      verifyProbeContainer(current, { imageId: image.Id, runId, networkId: network.Id,
        networkName: network.Name, name });
      protectedGuard([newId]);
      try {
        const response = await fetch(`${oldOrigin}/auths/user-info/self`, {
          redirect: 'manual', signal: AbortSignal.timeout(3000),
        });
        await response.arrayBuffer();
        if (response.status === 401) { ready = true; break; }
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    assert.equal(ready, true, 'New owned UAA did not become ready');
    const current = inspect(newId);
    deployment = structuredClone(context.deployment);
    deployment.services.uaa = { containerId: newId, imageId: image.Id };
    deployment.endpoints.uaa.containerId = newId;
    deployment.endpoints.uaa.endpointId = current.NetworkSettings.Networks[network.Name].EndpointID;
    const guard = () => {
      const net = protectedGuard([newId]);
      verifyProbeContainer(inspect(newId), { imageId: image.Id, runId, networkId: network.Id,
        networkName: network.Name, name });
      assert.equal(hash(read(join(config.path, 'application.properties'))), hash(properties));
      return validateDeployment(context.manifest, context.resources, deployment,
        [...protectedPeers.map(x => inspect(x.Id)), inspect(newId)], net,
        JSON.parse(read(context.deployment.imageReceipt.path)), inspectMysqlFixtureVolumes(context.resources));
    };
    const store = witness.forContainer(newId, guard);
    const security = await probeUaaHttp(oldOrigin, context.manifest, context.credentials, () => { guard(); },
      { jwtSecret: configuration['ibiz.jwt.secret'], securityStore: store, maxExpiryWaitMs: 30_000 });
    report.securityChecks = security.map(({ reason, ...row }) => ({
      ...row, ...(reason ? { reason: 'Required owned UAA security check failed' } : {}),
    }));
    assert.equal(security.length, 16);
    assert.ok(security.every(x => x.status === 'pass'));
    guard();
    directories.write(target, 'deployment-input.private.json', json(deployment));
    report.deploymentInput = { path: join(output, 'deployment-input.private.json'),
      sha256: hash(json(deployment)) };
    report.protectedPeersUnchanged = true;
    report.oldUaaRetainedForRollback = true;
    report.status = 'passed-owned-uaa-security-and-replacement';
  } catch {
    report.status = 'failed-owned-uaa-replacement';
    report.errors.push('Owned replacement prerequisite, transition or security check failed.');
    if (transitionStarted) {
      try {
        const candidate = docker(['container', 'inspect', newId ?? candidateName], true);
        let replacement = null;
        if (candidate.status === 0 && !candidate.error && !candidate.signal) {
          replacement = JSON.parse(candidate.stdout)[0];
        } else {
          assert.equal(candidate.status, 1);
          assert.equal(candidate.stderr.trim(),
            `Error response from daemon: No such container: ${newId ?? candidateName}`);
        }
        const inventory = ownedUaaRollbackInventory({
          original: old, current: inspect(old.Id), replacement, network,
          runId, label, imageId: candidateImage,
        });
        const liveNetwork = inspectNetwork();
        protectedGuard([old.Id, inventory.replacementId]
          .filter(id => id && Object.hasOwn(liveNetwork.Containers, id)));
        if (inventory.replacementId) {
          newId = inventory.replacementId;
          report.newUaaId = newId;
          const log = docker(['logs', '--tail', '3000', newId], true);
          directories.write(target, 'uaa.private.log', `${log.stdout ?? ''}${log.stderr ?? ''}`);
          newLogWritten = true;
          docker(['rm', '--force', newId]);
        }
        if (!inventory.oldAttached) {
          const aliases = (attachment.Aliases ?? [])
            .flatMap(alias => ['--alias', alias]);
          docker(['network', 'connect', '--ip', attachment.IPAddress, ...aliases,
            network.Id, old.Id]);
        }
        if (!inventory.oldRunning) docker(['start', old.Id]);
        protectedGuard([old.Id]);
        const restored = inspect(old.Id);
        const restoredInventory = ownedUaaRollbackInventory({
          original: old, current: restored, network, runId, label, imageId: candidateImage,
        });
        assert.equal(restoredInventory.oldRunning, true);
        assert.equal(privateContainerOrigin(restored, inspectNetwork(), 32666), report.oldUaa.origin);
        report.rollback = 'original-owned-uaa-restarted';
      } catch {
        report.rollback = 'failed-manual-owned-recovery-required';
      }
    }
  } finally {
    if (target) {
      if (newId && !newLogWritten) {
        const log = docker(['logs', '--tail', '3000', newId], true);
        directories.write(target, 'uaa.private.log', `${log.stdout ?? ''}${log.stderr ?? ''}`);
      }
      report.completedAt = new Date().toISOString();
      directories.write(target, 'report.json', json(report));
    }
    context.close();
    directories.close();
  }
  return { reportPath: join(output, 'report.json'), report };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: {
      'replace-owned-uaa': { type: 'boolean' }, 'run-id': { type: 'string' },
      'deployment-input': { type: 'string' }, 'runtime-report': { type: 'string' },
      label: { type: 'string' },
    } });
    assert.equal(values['replace-owned-uaa'], true);
    const result = await replaceOwnedUaa({ runId: values['run-id'], deploymentInput: values['deployment-input'],
      runtimeReport: values['runtime-report'], label: values.label });
    console.log(JSON.stringify({ reportPath: result.reportPath, status: result.report.status,
      securityChecks: result.report.securityChecks?.length ?? 0,
      protectedPeersUnchanged: result.report.protectedPeersUnchanged ?? false }, null, 2));
    if (result.report.status.startsWith('failed')) process.exitCode = 1;
  } catch {
    console.error('Owned UAA replacement refused; private details suppressed.');
    process.exitCode = 1;
  }
}
