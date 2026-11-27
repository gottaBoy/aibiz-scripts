#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { PinnedDirectories, readPinnedFile, readTree } from './native-candidate-files.mjs';

const workspaceDefault = resolve(import.meta.dirname, '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const storeContract = 'owned-marketplace-offline-store-v1';
const bundleContract = 'owned-marketplace-offline-bundle-v1';
const inventoryPath = 'scripts/docs/MARKETPLACE-SOURCE-INVENTORY-20261103.json';
const fileRoles = new Set(['model', 'frontend', 'backend', 'icon', 'readme', 'changelog',
  'license', 'dependency', 'source']);
const itemKeys = ['manifestSha256', 'version'];

function exactKeys(value, keys, label) {
  assert.ok(plain(value), `${label} must be an object`);
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), `${label} fields differ`);
}

function safePath(value) {
  return typeof value === 'string' && value.length <= 240
    && /^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(value)
    && value.split('/').every(part => part && part !== '.' && part !== '..');
}

function inside(workspace, path) {
  const child = relative(workspace, path);
  assert.ok(child && !child.startsWith('../') && child !== '..' && !child.startsWith('/'),
    'Local input must remain inside the workspace');
  return path;
}

function storePath(workspace, runId) {
  assert.match(runId ?? '', /^[a-f0-9]{12}$/);
  return join(workspace, '.artifacts/owned-marketplace-offline', runId);
}

function read(directories, path) {
  return readPinnedFile(directories, directories.open(dirname(path)), basename(path)).data;
}

function writeDurable(directories, directory, name, bytes) {
  const identity = directories.write(directory, name, bytes);
  const fd = fs.openSync(directories.entry(directory, name),
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  directories.verify(directory);
  fs.fsyncSync(directory.descriptor);
  return identity;
}

function snapshotData(path) {
  const directory = fs.lstatSync(path);
  assert.ok(directory.isDirectory() && !directory.isSymbolicLink(), 'Owned data directory changed');
  if (!fs.readdirSync(path).length) return { entries: [], fingerprint: hash('[]') };
  const tree = readTree(path, { jsonOnly: false });
  return { entries: tree.entries, fingerprint: tree.fingerprint };
}

function processBirth(pid) {
  try {
    const text = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    return text.slice(text.lastIndexOf(')') + 2).split(' ')[19];
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'ESRCH') return null;
    throw error;
  }
}

function verifyStore(directories, workspace, runId) {
  const path = storePath(workspace, runId);
  const directory = directories.open(path);
  assert.equal(directory.identity.uid, process.geteuid(), 'Owned store owner changed');
  assert.equal(directory.identity.mode & 0o777, 0o700, 'Owned store must remain private');
  const marker = JSON.parse(read(directories, join(path, 'owner.json')));
  exactKeys(marker, ['contract', 'runId', 'uid'], 'Store ownership');
  assert.deepEqual(marker, { contract: storeContract, runId, uid: process.geteuid() });
  for (const child of ['releases', 'staging', 'transactions', 'data']) {
    directories.open(join(path, child));
  }
  return { directory, path };
}

function verifyInstalled(installed, catalogIds) {
  assert.ok(plain(installed), 'Installed catalog state must be an object');
  assert.ok(Object.keys(installed).length <= 23);
  for (const [id, item] of Object.entries(installed)) {
    assert.ok(catalogIds.has(id), 'Installed state contains an unknown catalog ID');
    exactKeys(item, itemKeys, 'Installed revision');
    assert.ok(digest(item.manifestSha256));
    assert.ok(typeof item.version === 'string' && /^[A-Za-z0-9][A-Za-z0-9._+-]{0,79}$/.test(item.version));
  }
}

function catalog(directories, workspace) {
  const bytes = read(directories, join(workspace, inventoryPath));
  const inventory = JSON.parse(bytes);
  assert.equal(inventory.contract, 'marketplace-local-source-observations-v1');
  assert.equal(inventory.entries.length, 23);
  const ids = new Set(inventory.entries.map(row => row.catalogId));
  assert.equal(ids.size, 23, 'Canonical catalog IDs must be unique');
  return { ids, entries: new Map(inventory.entries.map(row => [row.catalogId, row])), sha256: hash(bytes) };
}

function readState(directories, path, catalogIds) {
  const bytes = read(directories, join(path, 'state.json'));
  const state = JSON.parse(bytes);
  exactKeys(state, ['contract', 'runId', 'generation', 'installed', 'history'], 'Store state');
  assert.equal(state.contract, storeContract);
  assert.equal(state.runId, basename(path));
  assert.ok(Number.isSafeInteger(state.generation) && state.generation >= 0);
  verifyInstalled(state.installed, catalogIds);
  assert.ok(Array.isArray(state.history) && state.history.length === state.generation
    && state.history.length <= 1000, 'Store history is invalid or exceeds this tool boundary');
  state.history.forEach((entry, index) => {
    exactKeys(entry, ['generation', 'installed'], 'Store history entry');
    assert.equal(entry.generation, index);
    verifyInstalled(entry.installed, catalogIds);
  });
  return { state, bytes, sha256: hash(bytes) };
}

export function verifyOfflineMarketplaceBundle({
  workspace = workspaceDefault, bundlePath, manifestSha256,
} = {}) {
  workspace = resolve(workspace);
  assert.ok(digest(manifestSha256), 'Exact expected manifest SHA-256 is required');
  assert.equal(typeof bundlePath, 'string');
  const path = inside(workspace, resolve(workspace, bundlePath));
  const directories = new PinnedDirectories();
  try {
    const { ids, entries, sha256: catalogSha256 } = catalog(directories, workspace);
    const bytes = read(directories, join(path, 'manifest.json'));
    assert.equal(hash(bytes), manifestSha256, 'Local bundle manifest hash differs');
    const manifest = JSON.parse(bytes);
    exactKeys(manifest, ['contract', 'schemaVersion', 'catalogId', 'version', 'source', 'files'], 'Bundle manifest');
    assert.equal(manifest.contract, bundleContract);
    assert.equal(manifest.schemaVersion, 1);
    assert.ok(ids.has(manifest.catalogId), 'Unknown canonical marketplace catalog ID');
    assert.match(manifest.version, /^[A-Za-z0-9][A-Za-z0-9._+-]{0,79}$/);
    exactKeys(manifest.source, ['repository', 'revision', 'licensePath'], 'Bundle source declaration');
    const repository = new URL(manifest.source.repository);
    assert.equal(manifest.source.repository, entries.get(manifest.catalogId).repository,
      'Bundle source repository differs from its canonical catalog identity');
    assert.equal(repository.protocol, 'https:');
    assert.ok(!repository.username && !repository.password && !repository.search && !repository.hash,
      'Repository metadata must not contain credentials, query or fragment');
    assert.match(manifest.source.revision, /^[a-f0-9]{40}(?:[a-f0-9]{24})?$/);
    assert.ok(Array.isArray(manifest.files) && manifest.files.length > 0 && manifest.files.length <= 10000);
    let size = 0;
    const paths = new Set();
    for (const file of manifest.files) {
      exactKeys(file, ['path', 'bytes', 'sha256', 'role'], 'Bundle file');
      assert.ok(safePath(file.path), 'Unsafe bundle file path');
      assert.ok(!paths.has(file.path.toLowerCase()), 'Duplicate or case-colliding bundle path');
      paths.add(file.path.toLowerCase());
      assert.ok(Number.isSafeInteger(file.bytes) && file.bytes >= 0 && file.bytes <= 64 * 1024 * 1024);
      assert.ok(digest(file.sha256));
      assert.ok(fileRoles.has(file.role), 'Unknown bundle file role');
      size += file.bytes;
    }
    assert.ok(size <= 256 * 1024 * 1024, 'Bundle exceeds local file budget');
    assert.ok(manifest.files.some(file => file.path === manifest.source.licensePath && file.role === 'license'),
      'Declared source license must be included and hashed');
    for (const role of ['icon', 'readme', 'changelog']) {
      assert.ok(manifest.files.some(file => file.role === role), `Offline ${role} bytes are required`);
    }
    assert.ok(manifest.files.some(file => ['model', 'frontend', 'backend'].includes(file.role)),
      'Bundle must declare an application artifact');
    const tree = readTree(join(path, 'payload'), { jsonOnly: false });
    const expected = manifest.files.map(({ path: file, bytes, sha256 }) => ({ path: file, bytes, sha256 }))
      .sort((a, b) => a.path.localeCompare(b.path));
    assert.deepEqual(tree.entries, expected, 'Bundle payload differs from its complete declared file set');
    assert.deepEqual(readTree(path, { jsonOnly: false }).entries,
      [{ path: 'manifest.json', bytes: bytes.length, sha256: manifestSha256 },
        ...expected.map(file => ({ ...file, path: `payload/${file.path}` }))]
        .sort((a, b) => a.path.localeCompare(b.path)),
    'Bundle has undeclared files outside its payload');
    return {
      contract: bundleContract, manifest, manifestBytes: bytes, manifestSha256,
      path, files: tree.contents, catalogSha256,
      sourceDeclarationVerified: false, sourceClosureVerified: false,
      dependencyClosureVerified: false, nativeMarketplaceAcceptance: false,
    };
  } finally { directories.close(); }
}

export function initializeOfflineMarketplaceStore({ workspace = workspaceDefault, runId } = {}) {
  workspace = resolve(workspace);
  const path = storePath(workspace, runId);
  const directories = new PinnedDirectories();
  try {
    catalog(directories, workspace);
    const directory = directories.open(path, { create: true, exclusive: true });
    for (const child of ['releases', 'staging', 'transactions', 'data']) {
      directories.open(join(path, child), { create: true, exclusive: true });
    }
    writeDurable(directories, directory, 'owner.json',
      json({ contract: storeContract, runId, uid: process.geteuid() }));
    writeDurable(directories, directory, 'state.json',
      json({ contract: storeContract, runId, generation: 0, installed: {}, history: [] }));
    return offlineMarketplaceStatus({ workspace, runId });
  } finally { directories.close(); }
}

export function offlineMarketplaceStatus({ workspace = workspaceDefault, runId } = {}) {
  workspace = resolve(workspace);
  const directories = new PinnedDirectories();
  try {
    const store = verifyStore(directories, workspace, runId);
    const current = readState(directories, store.path, catalog(directories, workspace).ids);
    for (const [catalogId, item] of Object.entries(current.state.installed)) {
      const bundle = verifyRelease(workspace, join(store.path, 'releases', item.manifestSha256),
        item.manifestSha256);
      assert.equal(bundle.manifest.catalogId, catalogId, 'Active release catalog differs');
      assert.equal(bundle.manifest.version, item.version, 'Active release version differs');
    }
    return { contract: storeContract, runId, path: relative(workspace, store.path),
      stateSha256: current.sha256, state: current.state,
      data: snapshotData(join(store.path, 'data')), nativeMarketplaceAcceptance: false };
  } finally { directories.close(); }
}

function verifyRelease(workspace, path, sha256) {
  return verifyOfflineMarketplaceBundle({ workspace, bundlePath: path, manifestSha256: sha256 });
}

function prepareLock(directories, store) {
  const transactionId = randomUUID();
  const owner = { transactionId, pid: process.pid, uid: process.geteuid(),
    processBirth: processBirth(process.pid) };
  assert.match(owner.processBirth ?? '', /^\d+$/);
  const candidate = `lock-candidate-${transactionId}.json`;
  const identity = writeDurable(directories, store.directory, candidate, json(owner));
  return { owner, candidate, identity, published: false };
}

function publishLock(directories, store, lock) {
  directories.verify(store.directory);
  // A hard link publishes complete owner bytes without replacing a live lock.
  fs.linkSync(directories.entry(store.directory, lock.candidate),
    directories.entry(store.directory, 'lock.json'));
  lock.published = true;
  fs.fsyncSync(store.directory.descriptor);
}

function releaseLock(directories, store, lock) {
  assert.deepEqual(JSON.parse(readPinnedFile(directories, store.directory, 'lock.json', lock.identity).data),
    lock.owner);
  directories.verify(store.directory);
  const retired = `retired-lock-${lock.owner.transactionId}.json`;
  assert.ok(!fs.existsSync(join(store.path, retired)), 'Retired lock archive already exists');
  fs.renameSync(directories.entry(store.directory, 'lock.json'),
    directories.entry(store.directory, retired));
  lock.published = false;
  fs.fsyncSync(store.directory.descriptor);
}

function publishState(directories, store, current, next, onPublished) {
  assert.equal(hash(read(directories, join(store.path, 'state.json'))), current.sha256,
    'Store state changed during transaction');
  const name = `state-${randomUUID()}.tmp`;
  const bytes = json(next);
  const sha256 = hash(bytes);
  writeDurable(directories, store.directory, name, bytes);
  directories.verify(store.directory);
  fs.renameSync(directories.entry(store.directory, name), directories.entry(store.directory, 'state.json'));
  onPublished(sha256);
  fs.fsyncSync(store.directory.descriptor);
  return sha256;
}

function transact({ workspace, runId, expectedStateSha256, select, beforeCommit = () => {} }) {
  assert.ok(digest(expectedStateSha256), 'Expected state SHA-256 is required for every change');
  const directories = new PinnedDirectories();
  let lock;
  let store;
  let result;
  let failure;
  let failed = false;
  let publication;
  const cleanupFailures = [];
  try {
    store = verifyStore(directories, workspace, runId);
    lock = prepareLock(directories, store);
    publishLock(directories, store, lock);
    const current = readState(directories, store.path, catalog(directories, workspace).ids);
    assert.equal(current.sha256, expectedStateSha256, 'Stale store state; read current state before changing it');
    assert.ok(current.state.generation < 1000, 'Store history budget reached; do not publish an unreadable state');
    const dataBefore = snapshotData(join(store.path, 'data'));
    const selected = select({ directories, store, current, transactionId: lock.owner.transactionId });
    const transaction = directories.open(join(store.path, 'transactions', lock.owner.transactionId),
      { create: true, exclusive: true });
    writeDurable(directories, transaction, 'intent.json',
      json({ operation: selected.operation, catalogId: selected.catalogId,
        manifestSha256: selected.item.manifestSha256, expectedStateSha256,
        dataFingerprint: dataBefore.fingerprint }));
    beforeCommit();
    const release = verifyRelease(workspace, join(store.path, 'releases', selected.item.manifestSha256),
      selected.item.manifestSha256);
    assert.equal(release.manifest.catalogId, selected.catalogId, 'Selected release catalog differs');
    assert.equal(release.manifest.version, selected.item.version, 'Selected release version differs');
    assert.deepEqual(snapshotData(join(store.path, 'data')), dataBefore,
      'Owned data changed during transaction; revision was not switched');
    const installed = { ...current.state.installed, [selected.catalogId]: selected.item };
    const next = { ...current.state, generation: current.state.generation + 1, installed,
      history: [...current.state.history,
        { generation: current.state.generation, installed: current.state.installed }] };
    const stateSha256 = publishState(directories, store, current, next, sha256 => {
      publication = { stateSha256: sha256, generation: next.generation };
    });
    writeDurable(directories, transaction, 'committed.json', json({ stateSha256, generation: next.generation }));
    result = { contract: storeContract, runId, operation: selected.operation, catalogId: selected.catalogId,
      manifestSha256: selected.item.manifestSha256, generation: next.generation, stateSha256,
      dataUnchanged: true, dataFingerprint: dataBefore.fingerprint,
      transactionId: lock.owner.transactionId, nativeMarketplaceAcceptance: false };
  } catch (cause) {
    failed = true;
    failure = cause;
  } finally {
    try { if (lock?.published) releaseLock(directories, store, lock); }
    catch (cause) { cleanupFailures.push(cause); }
    try { directories.close(); }
    catch (cause) { cleanupFailures.push(cause); }
  }
  if (failed || cleanupFailures.length) {
    if (publication) {
      const cause = failed ? failure : cleanupFailures.shift();
      const error = new Error('Revision published; inspect status before retrying', { cause });
      Object.assign(error, publication, { revisionPublished: true, suppressed: cleanupFailures });
      throw error;
    }
    const primary = failed ? failure : cleanupFailures.shift();
    if (!cleanupFailures.length) throw primary;
    if (primary instanceof Error && Object.isExtensible(primary)) {
      primary.suppressed = [...(primary.suppressed ?? []), ...cleanupFailures];
      throw primary;
    }
    throw new AggregateError([primary, ...cleanupFailures], 'Transaction and lock cleanup failed', { cause: primary });
  }
  return result;
}

export function installOfflineMarketplaceBundle({
  workspace = workspaceDefault, runId, bundlePath, manifestSha256, expectedStateSha256,
  beforeCommit,
} = {}) {
  workspace = resolve(workspace);
  const bundle = verifyOfflineMarketplaceBundle({ workspace, bundlePath, manifestSha256 });
  return transact({ workspace, runId, expectedStateSha256, beforeCommit,
    select({ directories, store, current, transactionId }) {
      const active = current.state.installed[bundle.manifest.catalogId];
      assert.notEqual(active?.manifestSha256, manifestSha256, 'Requested bundle is already installed');
      const stage = directories.open(join(store.path, 'staging', transactionId),
        { create: true, exclusive: true });
      writeDurable(directories, stage, 'manifest.json', bundle.manifestBytes);
      for (const file of bundle.files) {
        const parent = directories.open(join(stage.path, 'payload', dirname(file.path)), { create: true });
        writeDurable(directories, parent, basename(file.path), file.data);
      }
      verifyRelease(workspace, stage.path, manifestSha256);
      const releases = directories.open(join(store.path, 'releases'));
      const release = join(releases.path, manifestSha256);
      if (fs.existsSync(release)) verifyRelease(workspace, release, manifestSha256);
      else {
        directories.verify(releases);
        const staging = directories.open(join(store.path, 'staging'));
        directories.verify(staging);
        fs.renameSync(directories.entry(staging, transactionId), directories.entry(releases, manifestSha256));
        fs.fsyncSync(releases.descriptor);
        fs.fsyncSync(staging.descriptor);
      }
      // Recheck the immutable destination before publishing its active revision.
      const verified = verifyRelease(workspace, release, manifestSha256);
      return { operation: active ? 'update' : 'install', catalogId: verified.manifest.catalogId,
        item: { manifestSha256, version: verified.manifest.version } };
    } });
}

export function rollbackOfflineMarketplaceBundle({
  workspace = workspaceDefault, runId, catalogId, manifestSha256, expectedStateSha256, beforeCommit,
} = {}) {
  workspace = resolve(workspace);
  assert.ok(digest(manifestSha256));
  return transact({ workspace, runId, expectedStateSha256, beforeCommit,
    select({ directories, store, current }) {
      const active = current.state.installed[catalogId];
      assert.ok(active, 'Cannot roll back an uninstalled catalog');
      assert.notEqual(active.manifestSha256, manifestSha256, 'Rollback target is already active');
      const prior = current.state.history.some(entry =>
        entry.installed[catalogId]?.manifestSha256 === manifestSha256);
      assert.ok(prior, 'Rollback target was never committed for this catalog');
      const bundle = verifyRelease(workspace, join(store.path, 'releases', manifestSha256), manifestSha256);
      assert.equal(bundle.manifest.catalogId, catalogId, 'Rollback target belongs to another catalog');
      return { operation: 'rollback', catalogId,
        item: { manifestSha256, version: bundle.manifest.version } };
    } });
}

export function recoverOfflineMarketplaceLock({
  workspace = workspaceDefault, runId, transactionId, expectedStateSha256,
} = {}) {
  workspace = resolve(workspace);
  assert.match(transactionId ?? '', /^[a-f0-9-]{36}$/);
  assert.ok(digest(expectedStateSha256));
  const directories = new PinnedDirectories();
  try {
    const store = verifyStore(directories, workspace, runId);
    const current = readState(directories, store.path, catalog(directories, workspace).ids);
    assert.equal(current.sha256, expectedStateSha256, 'Recovery requires the current exact state');
    const lock = readPinnedFile(directories, store.directory, 'lock.json');
    const owner = JSON.parse(lock.data);
    exactKeys(owner, ['transactionId', 'pid', 'uid', 'processBirth'], 'Lock owner');
    assert.equal(owner.transactionId, transactionId, 'Recovery transaction differs');
    assert.equal(owner.uid, process.geteuid(), 'Recovery lock belongs to another owner');
    assert.ok(Number.isSafeInteger(owner.pid) && owner.pid > 0);
    assert.match(owner.processBirth ?? '', /^\d+$/);
    assert.notEqual(processBirth(owner.pid), owner.processBirth, 'A live transaction cannot be recovered');
    assert.deepEqual(JSON.parse(readPinnedFile(directories, store.directory, 'lock.json', lock.identity).data), owner,
      'Recovery lock changed during inspection');
    directories.verify(store.directory);
    const archive = `recovered-${transactionId}.json`;
    assert.ok(!fs.existsSync(join(store.path, archive)), 'Recovery archive already exists');
    fs.renameSync(directories.entry(store.directory, 'lock.json'), directories.entry(store.directory, archive));
    fs.fsyncSync(store.directory.descriptor);
    return { contract: storeContract, runId, recoveredTransactionId: transactionId,
      stateSha256: current.sha256, stateChanged: false, nativeMarketplaceAcceptance: false };
  } finally { directories.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ strict: true, allowPositionals: false, options: {
    action: { type: 'string' }, 'run-id': { type: 'string' }, bundle: { type: 'string' },
    'manifest-sha256': { type: 'string' }, 'expected-state-sha256': { type: 'string' },
    'catalog-id': { type: 'string' }, 'transaction-id': { type: 'string' },
  } });
  const common = { runId: values['run-id'] };
  let result;
  if (values.action === 'init') result = initializeOfflineMarketplaceStore(common);
  else if (values.action === 'status') result = offlineMarketplaceStatus(common);
  else if (values.action === 'verify') {
    const bundle = verifyOfflineMarketplaceBundle({
      bundlePath: values.bundle, manifestSha256: values['manifest-sha256'],
    });
    result = { contract: bundle.contract, catalogId: bundle.manifest.catalogId,
      version: bundle.manifest.version, manifestSha256: bundle.manifestSha256,
      files: bundle.files.length, sourceClosureVerified: false, nativeMarketplaceAcceptance: false };
  } else if (values.action === 'install') result = installOfflineMarketplaceBundle({
    ...common, bundlePath: values.bundle, manifestSha256: values['manifest-sha256'],
    expectedStateSha256: values['expected-state-sha256'],
  });
  else if (values.action === 'rollback') result = rollbackOfflineMarketplaceBundle({
    ...common, catalogId: values['catalog-id'], manifestSha256: values['manifest-sha256'],
    expectedStateSha256: values['expected-state-sha256'],
  });
  else if (values.action === 'recover') result = recoverOfflineMarketplaceLock({
    ...common, transactionId: values['transaction-id'],
    expectedStateSha256: values['expected-state-sha256'],
  });
  else throw new Error('Explicit action must be init, status, verify, install, rollback or recover');
  console.log(json(result).toString('utf8'));
}
