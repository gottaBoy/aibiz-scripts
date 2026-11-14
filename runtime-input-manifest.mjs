#!/usr/bin/env node
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { collectInventory } from './audit-aibiz-docker-inventory.mjs';
import { PinnedDirectories, optionalStat } from './native-candidate-files.mjs';

const workspaceDefault = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const encode = value => `${JSON.stringify(value, null, 2)}\n`;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const inside = (root, path) => {
  const child = relative(root, path);
  return child !== '..' && !child.startsWith('../') && !isAbsolute(child);
};
const identityKeys = ['dev', 'ino', 'mode', 'uid', 'gid', 'nlink', 'size', 'mtimeMs', 'ctimeMs'];
const unchanged = (before, after) => {
  for (const key of identityKeys) assert.equal(after[key], before[key], `Input ${key} changed`);
};
const limits = { maxBytes: 4 * 1024 ** 3, maxEntries: 150000 };

function hashFile(directories, parent, name, info, budget) {
  assert.ok(info.isFile() && info.nlink === 1, 'Only single-link regular files can be bound');
  assert.ok(budget.bytes + info.size <= budget.maxBytes, 'Input byte budget exceeded');
  const path = directories.entry(parent, name);
  const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  const hash = createHash('sha256');
  let bytes = 0;
  try {
    unchanged(info, fs.fstatSync(fd));
    const buffer = Buffer.alloc(1024 * 1024);
    for (;;) {
      const length = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (!length) break;
      bytes += length;
      assert.ok(budget.bytes + bytes <= budget.maxBytes, 'Input byte budget exceeded');
      hash.update(buffer.subarray(0, length));
    }
    unchanged(info, fs.fstatSync(fd));
    unchanged(info, fs.lstatSync(path));
    assert.equal(bytes, info.size);
  } finally { fs.closeSync(fd); }
  directories.verify(parent);
  budget.bytes += bytes;
  return { bytes, sha256: hash.digest('hex') };
}

export function measureRuntimePath(path, budget = { ...limits, bytes: 0, entries: 0 }) {
  const directories = new PinnedDirectories();
  const entries = [];
  const add = entry => {
    assert.ok(++budget.entries <= budget.maxEntries, 'Input entry budget exceeded');
    entries.push(entry);
  };
  const visit = (parent, name, prefix) => {
    directories.verify(parent);
    const info = fs.lstatSync(directories.entry(parent, name));
    assert.ok(!info.isSymbolicLink(), 'Symlink input is not followed');
    if (info.isDirectory()) {
      const directory = directories.open(join(parent.path, name));
      try {
        const before = fs.fstatSync(directory.descriptor);
        const names = fs.readdirSync(directory.access).sort(compare);
        add({ path: prefix, kind: 'directory', mode: info.mode & 0o7777, uid: info.uid, gid: info.gid });
        for (const child of names) visit(directory, child, prefix === '.' ? child : `${prefix}/${child}`);
        assert.deepEqual(fs.readdirSync(directory.access).sort(compare), names, 'Directory membership changed');
        unchanged(before, fs.fstatSync(directory.descriptor));
        unchanged(info, fs.lstatSync(directories.entry(parent, name)));
        directories.verify(directory);
      } finally { directories.release(directory); }
    } else {
      const file = hashFile(directories, parent, name, info, budget);
      add({ path: prefix, kind: 'file', mode: info.mode & 0o7777, uid: info.uid, gid: info.gid, ...file });
    }
  };
  try {
    path = resolve(path);
    const parent = directories.open(dirname(path));
    visit(parent, relative(parent.path, path), '.');
  } finally { directories.close(); }
  entries.sort((a, b) => compare(a.path, b.path));
  return { entries, fingerprint: digest(JSON.stringify(entries)),
    files: entries.filter(entry => entry.kind === 'file').length,
    bytes: entries.reduce((sum, entry) => sum + (entry.bytes || 0), 0) };
}

function inputPlan(report, workspace) {
  assert.equal(report.contract, 'aibiz-docker-version-inventory-v2');
  const rows = report.running.filter(row => row.kind === 'shared-runtime');
  assert.ok(rows.length > 0);
  const sources = new Map();
  const add = (path, use) => {
    assert.ok(typeof path === 'string' && isAbsolute(path));
    path = resolve(path);
    const uses = sources.get(path) || [];
    uses.push(use); sources.set(path, uses);
  };
  for (const row of rows) {
    assert.equal(row.running, true);
    assert.match(row.imageId, /^sha256:[a-f0-9]{64}$/);
    for (const mount of row.mounts.filter(mount => mount.type === 'bind')) {
      add(mount.source, { container: row.name, destination: mount.destination, writable: mount.writable });
    }
    for (const field of ['config_files', 'environment_file']) {
      for (const path of (row.labels[`com.docker.compose.project.${field}`] || '').split(',').filter(Boolean)) {
        add(path, { container: row.name, compose: field });
      }
    }
  }
  const bindings = rows.map(row => ({
    id: row.id, name: row.name, imageId: row.imageId,
    configurationSha256: row.configurationSha256, hostConfigurationSha256: row.hostConfigurationSha256,
    mounts: row.mounts,
  })).sort((a, b) => compare(a.name, b.name));
  return { bindings, sources: [...sources].sort(([a], [b]) => compare(a, b))
    .map(([path, uses]) => ({ path,
      uses: uses.sort((a, b) => compare(JSON.stringify(a), JSON.stringify(b))),
      allowed: inside(workspace, path) })) };
}

function repositoryState(workspace, path) {
  let directory = fs.lstatSync(path).isDirectory() ? path : dirname(path);
  while (inside(workspace, directory)) {
    if (optionalStat(join(directory, '.git'))) {
      const environment = Object.fromEntries(Object.entries(process.env)
        .filter(([key]) => !key.startsWith('GIT_')));
      Object.assign(environment, { GIT_OPTIONAL_LOCKS: '0', GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: '/dev/null', LC_ALL: 'C' });
      const git = args => execFileSync('git', ['-C', directory, '-c', 'core.fsmonitor=false', ...args], {
        env: environment,
        timeout: 30000, maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'],
      });
      assert.equal(resolve(git(['rev-parse', '--show-toplevel']).toString().trim()), directory,
        'Git worktree does not match the measured repository');
      const commit = git(['rev-parse', 'HEAD']).toString().trim();
      assert.match(commit, /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/);
      const status = git(['status', '--porcelain=v1', '-z', '--untracked-files=normal']);
      return { path: relative(workspace, directory) || '.', commit,
        dirty: status.length > 0, statusSha256: digest(status),
        indexSha256: digest(git(['ls-files', '--stage', '-z'])),
        unmountedSourceContentsBound: false };
    }
    if (directory === workspace) break;
    directory = dirname(directory);
  }
  return null;
}

export function captureRuntimeInputs({
  workspace = workspaceDefault, inspect = collectInventory, budgets = limits, outputPath,
} = {}) {
  workspace = resolve(workspace);
  const maximum = { ...limits, ...budgets };
  for (const value of Object.values(maximum)) assert.ok(Number.isSafeInteger(value) && value > 0);
  const plan = inputPlan(inspect(), workspace);
  const inputs = [];
  const repositories = new Map();
  const budget = { ...maximum, bytes: 0, entries: 0 };
  for (const item of plan.sources) {
    assert.ok(item.allowed, 'Runtime input outside this workspace requires separate ownership review');
    assert.ok(!outputPath || !inside(item.path, resolve(outputPath)),
      'Receipt output overlaps a measured runtime input');
    const measurement = measureRuntimePath(item.path, budget);
    const repository = repositoryState(workspace, item.path);
    if (repository) {
      const previous = repositories.get(repository.path);
      if (previous) assert.deepEqual(previous, repository, 'Repository changed during capture');
      repositories.set(repository.path, repository);
    }
    inputs.push({ path: relative(workspace, item.path), uses: item.uses,
      repository: repository?.path ?? null, ...measurement });
  }
  const secondBudget = { ...maximum, bytes: 0, entries: 0 };
  for (const input of inputs) {
    assert.deepEqual(measureRuntimePath(join(workspace, input.path), secondBudget), {
      entries: input.entries, fingerprint: input.fingerprint, files: input.files, bytes: input.bytes,
    }, 'Runtime bytes changed between capture passes');
    assert.deepEqual(repositoryState(workspace, join(workspace, input.path)),
      input.repository === null ? null : repositories.get(input.repository),
      'Repository changed between capture passes');
  }
  assert.deepEqual(inputPlan(inspect(), workspace), plan, 'Runtime configuration changed during capture');
  const binding = { containers: plan.bindings, repositories: [...repositories.values()], inputs };
  return {
    contract: 'aibiz-observed-runtime-inputs-v1', generatedAt: new Date().toISOString(),
    status: 'OBSERVED', acceptedRelease: false, fullSourceClosure: false, servedHTTPBytesVerified: false,
    contentsFrozen: false, atomicSnapshot: false,
    limitations: [
      'Two matching read passes are an observation, not a filesystem freeze or backup.',
      'Repository commit/status/index bind identity, not every unmounted dirty source file.',
      'Image-internal files, named volumes, generated-at-start copies and HTTP output are not measured.',
      'No build receipt or source-to-artifact equivalence is established by this manifest.',
    ],
    budgets: maximum, fingerprint: digest(JSON.stringify(binding)), ...binding,
  };
}

export function verifyRuntimeInputs(recorded, options = {}) {
  assert.equal(recorded.contract, 'aibiz-observed-runtime-inputs-v1');
  assert.equal(recorded.status, 'OBSERVED');
  for (const field of ['acceptedRelease', 'fullSourceClosure', 'servedHTTPBytesVerified', 'contentsFrozen', 'atomicSnapshot']) {
    assert.equal(recorded[field], false, 'Manifest must not claim release acceptance');
  }
  const current = captureRuntimeInputs(options);
  const binding = { containers: recorded.containers, repositories: recorded.repositories, inputs: recorded.inputs };
  assert.equal(recorded.fingerprint, digest(JSON.stringify(binding)), 'Recorded fingerprint is inconsistent');
  assert.deepEqual(current.containers, recorded.containers, 'Container bindings differ');
  assert.deepEqual(current.repositories, recorded.repositories, 'Repository identities differ');
  assert.deepEqual(current.inputs, recorded.inputs, 'Mounted inputs differ');
  assert.equal(current.fingerprint, recorded.fingerprint);
  return { status: 'MATCH', acceptedRelease: false, contentsFrozen: false,
    inputs: current.inputs.length, repositories: current.repositories.length, fingerprint: current.fingerprint };
}

function artifactLocation(workspace, path) {
  const absolute = resolve(workspace, path);
  const child = relative(join(workspace, '.artifacts'), absolute);
  assert.ok(child && child !== '..' && !child.startsWith('../') && !isAbsolute(child));
  assert.match(absolute, /\/runtime-inputs-[a-z0-9][a-z0-9-]*\/report\.json$/);
  return absolute;
}

export function main(argv = process.argv.slice(2), options = {}) {
  const workspace = resolve(options.workspace || workspaceDefault);
  const { values } = parseArgs({ args: argv, options: {
    capture: { type: 'boolean' }, output: { type: 'string' }, verify: { type: 'string' }, help: { type: 'boolean' },
  } });
  if (values.help) {
    assert.equal(argv.length, 1);
    console.log('Usage: node scripts/runtime-input-manifest.mjs --capture --output=.artifacts/runtime-inputs-ID/report.json\n       node scripts/runtime-input-manifest.mjs --verify=.artifacts/runtime-inputs-ID/report.json');
    return;
  }
  const directories = new PinnedDirectories();
  try {
    if (values.verify) {
      assert.equal(argv.length, 1);
      assert.equal(values.capture, undefined);
      assert.equal(values.output, undefined);
      const path = artifactLocation(workspace, values.verify);
      const parent = directories.open(dirname(path));
      const file = directories.entry(parent, 'report.json');
      const info = fs.lstatSync(file);
      assert.ok(info.isFile() && info.nlink === 1 && info.size <= 128 * 1024 ** 2);
      const fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
      let bytes;
      try {
        unchanged(info, fs.fstatSync(fd));
        bytes = fs.readFileSync(fd);
        unchanged(info, fs.fstatSync(fd));
        unchanged(info, fs.lstatSync(file));
      } finally { fs.closeSync(fd); }
      directories.verify(parent);
      const result = verifyRuntimeInputs(JSON.parse(bytes), { ...options, workspace });
      console.log(encode(result)); return result;
    }
    assert.equal(values.capture, true);
    assert.equal(argv.length, 2);
    assert.ok(values.output);
    const path = artifactLocation(workspace, values.output);
    const parent = directories.open(dirname(path), { create: true, exclusive: true });
    const report = captureRuntimeInputs({ ...options, workspace, outputPath: path });
    const bytes = Buffer.from(encode(report));
    directories.write(parent, 'report.json', bytes);
    const result = { status: report.status, acceptedRelease: false,
      inputs: report.inputs.length, repositories: report.repositories.length,
      bytes: bytes.length, sha256: digest(bytes), fingerprint: report.fingerprint };
    console.log(encode(result)); return result;
  } finally { directories.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); }
  catch {
    console.error('Runtime input manifest refused; details remain private. No service was changed.');
    process.exitCode = 1;
  }
}
