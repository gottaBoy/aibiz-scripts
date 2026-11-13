#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { PinnedDirectories } from './native-candidate-files.mjs';

const workspaceDefault = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const imagePattern = /^sha256:[a-f0-9]{64}$/;
const historicalName = /^(?:n01-|p0[4-9]-|s07-|plmweb-|aibiz-compiler-)/;
const sharedNames = new Set([
  'ibizlab-uaa-api', 'modelingservice', 'ibiz-ebsx-allinone', 'ibiz-ebsx-gateway',
  'plmweb', 'plmservice', 'task', 'modelingweb', 'modeling-plugins', 'nacos',
  'compose-modelingweb-candidate-central-1', 'compose-modelingweb-candidate-modeldesign-1',
]);

function docker(args, execute = spawnSync) {
  const result = execute('docker', args, {
    encoding: 'utf8', timeout: 120_000, maxBuffer: 64 * 1024 * 1024,
  });
  assert.ok(result.status === 0 && !result.error && !result.signal,
    `Docker ${args[0]} inspection failed; private details suppressed`);
  return result.stdout;
}

function chunks(values, size = 40) {
  return Array.from({ length: Math.ceil(values.length / size) }, (_, index) =>
    values.slice(index * size, (index + 1) * size));
}

function evidenceLabels(labels = {}) {
  return Object.fromEntries(Object.entries(labels).filter(([name]) =>
    /^(?:aibiz\.|io\.aibiz\.|com\.docker\.compose\.)/.test(name)));
}

export function normalizeAibizContainer(container) {
  assert.match(container.Id ?? '', /^[a-f0-9]{64}$/);
  assert.match(container.Image ?? '', imagePattern);
  const name = container.Name.replace(/^\//, '');
  const labels = evidenceLabels(container.Config.Labels);
  const owned = name.startsWith('nf-') || Boolean(labels['aibiz.native-fixture.run']);
  const mounts = (container.Mounts ?? []).map(mount => ({
    type: mount.Type, source: mount.Source, destination: mount.Destination,
    writable: mount.RW, ...(mount.Name ? { volume: mount.Name } : {}),
  })).sort((a, b) => a.destination.localeCompare(b.destination));
  const stopped = ['exited', 'created', 'dead'].includes(container.State.Status);
  const blockers = [];
  if (!stopped || container.State.Running) blockers.push('active-or-transitional-state');
  if (owned) blockers.push('owned-fixture-receipt-required');
  if (mounts.length) blockers.push('mounts-require-separate-review');
  if (container.HostConfig.AutoRemove) blockers.push('auto-remove-lifecycle');
  return {
    id: container.Id, name, image: container.Config.Image, imageId: container.Image,
    state: container.State.Status, running: container.State.Running === true,
    createdAt: container.Created, startedAt: container.State.StartedAt,
    restartCount: container.RestartCount, labels, mounts,
    hasVolumes: mounts.some(mount => mount.type === 'volume'),
    kind: owned ? 'owned-fixture' : sharedNames.has(name) ? 'shared-runtime' : 'historical-or-other',
    configurationSha256: hash(json(container.Config)),
    hostConfigurationSha256: hash(json(container.HostConfig)),
    ports: container.NetworkSettings.Ports ?? {},
    networks: Object.fromEntries(Object.entries(container.NetworkSettings.Networks ?? {}).map(([key, value]) =>
      [key, { networkId: value.NetworkID, endpointId: value.EndpointID, ipv4: value.IPAddress }])),
    cleanup: { eligible: false, reviewCandidate: stopped && historicalName.test(name) && blockers.length === 0,
      blockers: [...blockers, 'writable-layer-logs-and-receipt-review-required'] },
  };
}

export function classifyAibizDockerInventory({ containers, images, networks, allContainerReferences = containers }) {
  assert.ok(Array.isArray(containers) && Array.isArray(images) && Array.isArray(networks));
  const aibizImages = images.filter(row => row.repository.startsWith('aibiz/'));
  for (const image of aibizImages) assert.match(image.id, imagePattern);
  const groups = new Map();
  for (const image of aibizImages) {
    const group = groups.get(image.id) ?? new Set();
    group.add(`${image.repository}:${image.tag}`);
    groups.set(image.id, group);
  }
  const running = containers.filter(row => row.running);
  const tagBindings = new Map(aibizImages.map(row => [`${row.repository}:${row.tag}`, row.id]));
  const protectedImages = new Set(allContainerReferences.map(row => row.imageId));
  const duplicateTags = [...groups].filter(([, refs]) => refs.size > 1).map(([imageId, refs]) => ({
    imageId, tags: [...refs].sort(),
    containerReferences: allContainerReferences.filter(row => row.imageId === imageId)
      .map(row => ({ id: row.id, name: row.name, state: row.state, image: row.image })),
    disposition: 'review-aliases-only-never-delete-image-by-id',
  })).sort((a, b) => a.imageId.localeCompare(b.imageId));
  return {
    contract: 'aibiz-docker-version-inventory-v2', generatedAt: new Date().toISOString(),
    runningCount: running.length,
    sharedRunningCount: running.filter(row => row.kind === 'shared-runtime').length,
    ownedRunningCount: running.filter(row => row.kind === 'owned-fixture').length,
    stoppedOrCreatedCount: containers.filter(row => !row.running).length,
    aibizTagCount: aibizImages.length, aibizUniqueImageIdCount: groups.size,
    activeImageIdCount: new Set(running.map(row => row.imageId)).size,
    containerReferencedAibizImageCount: [...groups.keys()].filter(id => protectedImages.has(id)).length,
    unreferencedByContainers: [...groups.keys()].filter(id => !protectedImages.has(id)),
    acceptance: 'observed-runtime-only-not-a-validated-release',
    tagDrift: running.filter(row => tagBindings.has(row.image) && tagBindings.get(row.image) !== row.imageId)
      .map(row => ({ name: row.name, reference: row.image, runningImageId: row.imageId,
        currentTagImageId: tagBindings.get(row.image) })),
    running, stopped: containers.filter(row => !row.running), duplicateTags,
    historicalCleanupCandidates: containers.filter(row => row.cleanup.reviewCandidate),
    imageCleanupCandidates: [],
    protectedRules: [
      'Inspect all containers, including stopped, digest-launched and unrelated-name references.',
      'No deletion is authorized by this inventory; absent container references do not establish absent receipt references.',
      'Never delete owned fixtures, writable layers, volumes, networks or images referenced by receipts.',
      'Image ID locking does not freeze bind-mounted JARs, plugins, models, startup scripts or dynamic configuration.',
    ],
    networks: networks.filter(row => row.name.startsWith('aibiz-') || row.name.startsWith('nf-')),
  };
}

export function composeImageLock(report) {
  const services = {};
  const selected = report.running.filter(row => row.kind === 'shared-runtime');
  for (const row of selected) {
    const service = row.labels['com.docker.compose.service'];
    assert.match(service ?? '', /^[A-Za-z0-9][A-Za-z0-9_.-]*$/);
    assert.equal(row.labels['com.docker.compose.project'], 'compose');
    assert.ok(!Object.hasOwn(services, service), 'Duplicate shared Compose service');
    assert.match(row.imageId, imagePattern);
    services[service] = { image: row.imageId, pull_policy: 'never' };
  }
  assert.ok(selected.length > 0, 'No inspected shared Compose service');
  return { services: Object.fromEntries(Object.entries(services).sort(([a], [b]) => a.localeCompare(b))) };
}

export function verifyComposeImageLock(report, lock) {
  assert.deepEqual(lock, composeImageLock(report), 'Observed shared images differ from the pinned local image lock');
  return { status: 'passed-observed-image-lock-only', acceptedRelease: false,
    services: Object.keys(lock.services).length, bindMountContentsFrozen: false };
}

function hashInputFile(path, before) {
  const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const identity = fs.fstatSync(fd);
    assert.equal(identity.ino, before.ino);
    assert.equal(identity.dev, before.dev);
    const digest = createHash('sha256');
    const buffer = Buffer.alloc(1024 * 1024);
    for (;;) {
      const length = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (!length) break;
      digest.update(buffer.subarray(0, length));
    }
    for (const after of [fs.fstatSync(fd), fs.lstatSync(path)]) {
      for (const key of ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs']) {
        assert.equal(after[key], before[key], 'Host input changed while hashing');
      }
    }
    return digest.digest('hex');
  } finally { fs.closeSync(fd); }
}

export function captureHostInputs(report) {
  const paths = new Map();
  const add = (path, use) => {
    assert.ok(path.startsWith('/'), 'Inspected host input must be absolute');
    const uses = paths.get(path) ?? [];
    uses.push(use); paths.set(path, uses);
  };
  for (const row of report.running.filter(row => row.kind === 'shared-runtime')) {
    for (const mount of row.mounts.filter(mount => mount.type === 'bind')) {
      add(mount.source, { service: row.labels['com.docker.compose.service'],
        destination: mount.destination, writable: mount.writable });
    }
    for (const field of ['config_files', 'environment_file']) {
      for (const path of (row.labels[`com.docker.compose.project.${field}`] ?? '').split(',').filter(Boolean)) {
        add(path, { service: row.labels['com.docker.compose.service'], compose: field });
      }
    }
  }
  return [...paths].sort(([a], [b]) => a.localeCompare(b)).map(([path, uses]) => {
    const info = fs.lstatSync(path);
    if (info.isSymbolicLink()) return { path, uses, kind: 'symlink', bytesFrozen: false };
    if (info.isDirectory()) return { path, uses, kind: 'mutable-directory', bytesFrozen: false };
    assert.ok(info.isFile(), 'Unsupported host input type');
    return { path, uses, kind: 'file', bytes: info.size, mode: info.mode & 0o777,
      sha256: hashInputFile(path, info), bytesFrozen: false,
      evidence: 'current-file-bytes-measured-not-copied-or-enforced' };
  });
}

export function collectInventory({ execute = spawnSync } = {}) {
  const ids = docker(['ps', '-aq', '--no-trunc'], execute).trim().split('\n').filter(Boolean);
  const raw = chunks(ids).flatMap(part => JSON.parse(docker(['container', 'inspect', ...part], execute)));
  assert.deepEqual(raw.map(row => row.Id).sort(), ids.toSorted());
  const images = docker(['image', 'ls', '--no-trunc', '--format', '{{json .}}'], execute)
    .split('\n').filter(Boolean).map(JSON.parse)
    .filter(row => row.Repository.startsWith('aibiz/'))
    .map(row => ({ repository: row.Repository, tag: row.Tag, id: row.ID }));
  const imageIds = new Set(images.map(row => row.id));
  const containers = raw.filter(row =>
    imageIds.has(row.Image) || row.Config.Image.startsWith('aibiz/')
    || sharedNames.has(row.Name.slice(1)) || historicalName.test(row.Name.slice(1))
    || row.Name.startsWith('/nf-') || row.Config.Labels?.['aibiz.native-fixture.run'])
    .map(normalizeAibizContainer);
  const allContainerReferences = raw.map(row => ({
    id: row.Id, name: row.Name.slice(1), imageId: row.Image,
    image: row.Config.Image, state: row.State.Status,
  }));
  const networks = docker(['network', 'ls', '--no-trunc', '--format', '{{json .}}'], execute)
    .split('\n').filter(Boolean).map(JSON.parse)
    .map(row => ({ id: row.ID, name: row.Name, driver: row.Driver, scope: row.Scope }));
  const finalIds = docker(['ps', '-aq', '--no-trunc'], execute).trim().split('\n').filter(Boolean);
  assert.deepEqual(finalIds.toSorted(), ids.toSorted(), 'Container inventory changed during inspection');
  return classifyAibizDockerInventory({ containers, images, networks, allContainerReferences });
}

export function writeInventoryReport(report, {
  workspace = workspaceDefault,
  output = `.artifacts/aibiz-docker-inventory-${new Date().toISOString().slice(0, 10)}/report.json`,
} = {}) {
  workspace = resolve(workspace);
  const path = resolve(workspace, output);
  const child = relative(join(workspace, '.artifacts'), path);
  assert.ok(child && child !== '..' && !child.startsWith('../') && !child.startsWith('/'));
  assert.equal(basename(path), 'report.json');
  const directories = new PinnedDirectories();
  try {
    const destination = directories.open(dirname(path), { create: true, exclusive: true });
    const bytes = json(report);
    directories.write(destination, 'report.json', bytes);
    directories.write(destination, 'report.sha256', `${hash(bytes)}\n`);
    directories.write(destination, 'compose.images.lock.json', json(composeImageLock(report)));
    return { path, sha256: hash(bytes), bytes: Buffer.byteLength(bytes),
      composeImageLock: join(dirname(path), 'compose.images.lock.json') };
  } finally { directories.close(); }
}

export function runAudit({ output, workspace = workspaceDefault, execute = spawnSync } = {}) {
  const report = collectInventory({ execute });
  report.hostInputs = captureHostInputs(report);
  report.fullDeploymentLocked = false;
  return { report, binding: writeInventoryReport(report, { output, workspace }) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: {
      output: { type: 'string' }, 'verify-lock': { type: 'string' },
    } });
    if (values['verify-lock']) {
      assert.equal(values.output, undefined);
      const report = collectInventory();
      const lock = JSON.parse(fs.readFileSync(resolve(values['verify-lock'])));
      console.log(json(verifyComposeImageLock(report, lock)));
      process.exitCode = 0;
    } else {
      const { report, binding } = runAudit({ output: values.output });
      console.log(json({ binding, running: report.runningCount, shared: report.sharedRunningCount,
        owned: report.ownedRunningCount, historical: report.stoppedOrCreatedCount,
        tags: report.aibizTagCount, uniqueImages: report.aibizUniqueImageIdCount,
        duplicateTagGroups: report.duplicateTags.length, acceptedRelease: false }));
    }
  } catch {
    console.error('Docker inventory refused; private details suppressed.');
    process.exitCode = 1;
  }
}
