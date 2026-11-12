#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outputRoot = join(workspace, '.artifacts');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;

function docker(args) {
  const result = spawnSync('docker', args, {
    encoding: 'utf8', timeout: 120_000, maxBuffer: 64 * 1024 * 1024,
  });
  assert.equal(result.status, 0, `docker ${args[0]} failed`);
  return result.stdout;
}

function inspectImageIds(containerIds) {
  if (!containerIds.length) return new Map();
  const rows = JSON.parse(docker(['inspect', ...containerIds]));
  return new Map(rows.map(row => [row.Id, row.Image]));
}

function parseLines(text) {
  return text.split('\n').filter(Boolean).map(line => JSON.parse(line));
}

function canonicalRunning(containers) {
  return containers.filter(row => row.running).map(row => ({
    id: row.id, name: row.name, image: row.image, status: row.status,
    createdAt: row.createdAt, labels: row.labels,
  })).sort((a, b) => a.name.localeCompare(b.name));
}

export function classifyAibizDockerInventory({
  containers, images, networks,
}) {
  assert.ok(Array.isArray(containers) && Array.isArray(images) && Array.isArray(networks));
  const running = containers.filter(row => row.running);
  const stopped = containers.filter(row => !row.running);
  const aibizImages = images.filter(row => row.repository.startsWith('aibiz/'));
  const uniqueImageIds = new Set(aibizImages.map(row => row.id));
  const activeImageIds = new Set(running.map(row => row.imageId).filter(Boolean));
  const activeNames = new Set(running.map(row => row.name));
  const candidates = stopped.filter(row => {
    const labels = row.labels ?? {};
    return /^n01-r4-|^p0[4-9]-|^s07-|^plmweb-|^aibiz-compiler-/.test(row.name)
      && labels['aibiz.native-fixture.run'] === undefined;
  }).map(row => ({
    id: row.id, name: row.name, image: row.image, status: row.status,
    createdAt: row.createdAt, hasVolumes: row.hasVolumes, labels: row.labels,
    deletion: 'candidate-only-not-deleted',
  })).sort((a, b) => a.name.localeCompare(b.name));
  return {
    contract: 'aibiz-docker-version-inventory-v1',
    generatedAt: new Date().toISOString(),
    runningCount: running.length,
    stoppedOrCreatedCount: stopped.length,
    aibizTagCount: aibizImages.length,
    aibizUniqueImageIdCount: uniqueImageIds.size,
    activeImageIdCount: activeImageIds.size,
    activeNames: [...activeNames].sort(),
    activeImageIds: [...activeImageIds].sort(),
    running: canonicalRunning(containers),
    historicalCleanupCandidates: candidates,
    protectedRules: [
      'Never remove a running container.',
      'Never remove a container with aibiz.native-fixture.run ownership without its bound cleanup receipt.',
      'Never remove a container with mounts/volumes until its volume and evidence ownership are inspected.',
      'Never remove a tag/image referenced by a running container or retained receipt.',
      'Never remove shared port 30250 or its source containers from this audit.',
    ],
    networks: networks.filter(row => row.name.startsWith('aibiz-') || row.name.startsWith('nf-'))
      .map(row => ({ id: row.id, name: row.name, driver: row.driver, scope: row.scope }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

export function writeInventoryReport(report, {
  output = `.artifacts/aibiz-docker-inventory-${new Date().toISOString().slice(0, 10)}/report.json`,
} = {}) {
  const path = resolve(workspace, output);
  assert.ok(path.startsWith(`${outputRoot}/`));
  fs.mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  assert.ok(!fs.existsSync(path), 'Inventory report is immutable');
  const bytes = Buffer.from(json(report));
  fs.writeFileSync(path, bytes, { mode: 0o600, flag: 'wx' });
  fs.writeFileSync(`${path}.sha256`, `${hash(bytes)}\n`, { mode: 0o600, flag: 'wx' });
  return { path, sha256: hash(bytes), bytes: bytes.length };
}

export function runAudit({ output } = {}) {
  const containers = parseLines(docker(['ps', '-a', '--no-trunc', '--format',
    '{{json .}}']).replaceAll('{\n', '{'));
  const normalizedContainers = containers.filter(row => {
    const name = row.Names ?? '';
    const image = row.Image ?? '';
    return name.includes('aibiz') || image.startsWith('aibiz/')
      || name.startsWith('nf-') || name.startsWith('compose-modelingweb')
      || /^n01-r4-/.test(name) || /^p0[4-9]-/.test(name)
      || /^s07-/.test(name) || name.startsWith('plmweb-');
  }).map(row => ({
    id: row.ID, name: row.Names, image: row.Image, imageId: row.ImageID ?? null,
    status: row.Status, createdAt: row.CreatedAt ?? null,
    running: /^Up /.test(row.Status ?? ''),
    hasVolumes: null, labels: {},
  }));
  const images = parseLines(docker(['image', 'ls', '--no-trunc', '--format',
    '{{json .}}'])).filter(row => (row.Repository ?? '').startsWith('aibiz/'))
    .map(row => ({ repository: row.Repository, tag: row.Tag, id: row.ID }));
  const networks = parseLines(docker(['network', 'ls', '--no-trunc', '--format',
    '{{json .}}'])).map(row => ({ id: row.ID, name: row.Name, driver: row.Driver, scope: row.Scope }));
  const imageIds = inspectImageIds(normalizedContainers.map(row => row.id));
  for (const row of normalizedContainers) row.imageId = imageIds.get(row.id) ?? null;
  const report = classifyAibizDockerInventory({
    containers: normalizedContainers, images, networks,
  });
  return { report, binding: writeInventoryReport(report, { output }) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const result = runAudit({
    output: process.argv.find(value => value.startsWith('--output='))
      ?.slice('--output='.length),
  });
  console.log(JSON.stringify(result, null, 2));
}
