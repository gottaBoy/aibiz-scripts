import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import {
  initializeOfflineMarketplaceStore, installOfflineMarketplaceBundle, offlineMarketplaceStatus,
  recoverOfflineMarketplaceLock, rollbackOfflineMarketplaceBundle, verifyOfflineMarketplaceBundle,
} from '../owned-marketplace-offline.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const toolPath = resolve(import.meta.dirname, '../owned-marketplace-offline.mjs');
const sourceInventory = fs.readFileSync(resolve(import.meta.dirname,
  '../docs/MARKETPLACE-SOURCE-INVENTORY-20261103.json'));
const catalogId = JSON.parse(sourceInventory).entries[0].catalogId;

function write(path, content) {
  fs.mkdirSync(dirname(path), { recursive: true });
  fs.writeFileSync(path, content);
}

function fixture(t) {
  const workspace = fs.mkdtempSync(join(tmpdir(), 'aibiz-offline-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  write(join(workspace, 'scripts/docs/MARKETPLACE-SOURCE-INVENTORY-20261103.json'), sourceInventory);
  const runId = randomBytes(6).toString('hex');
  const store = join(workspace, '.artifacts/owned-marketplace-offline', runId);
  return { workspace, runId, store };
}

function bundle(f, version, mutate = () => {}) {
  const path = join(f.workspace, 'bundles', version);
  const file = (name, data, role) => {
    const bytes = Buffer.from(data);
    write(join(path, 'payload', name), bytes);
    return { path: name, bytes: bytes.length, sha256: digest(bytes), role };
  };
  const files = [
    file('dist/index.js', `export const version = ${JSON.stringify(version)};\n`, 'frontend'),
    file('icon.png', Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), 'icon'),
    file('README.md', '测试 Unicode 😀 e\u0301 "quoted" \\\n', 'readme'),
    file('CHANGELOG.md', `Local test bundle ${version}\n`, 'changelog'),
    file('LICENSE', 'Controlled fixture license declaration only\n', 'license'),
    file('package.json', json({ name: 'controlled-fixture', version,
      scripts: { postinstall: `touch ${join(f.workspace, 'forbidden-script-marker')}` } }), 'dependency'),
  ];
  const manifest = {
    contract: 'owned-marketplace-offline-bundle-v1', schemaVersion: 1, catalogId, version,
    source: { repository: 'https://gitee.com/ibizlab-appstore/logic-design-standard.git',
      revision: 'a'.repeat(40), licensePath: 'LICENSE' }, files,
  };
  mutate(manifest, path);
  const bytes = Buffer.from(json(manifest));
  write(join(path, 'manifest.json'), bytes);
  return { bundlePath: path, manifestSha256: digest(bytes), manifest };
}

function install(f, source, extras = {}) {
  return installOfflineMarketplaceBundle({ ...f, ...source,
    expectedStateSha256: offlineMarketplaceStatus(f).stateSha256, ...extras });
}

function patchFS(replacements, action) {
  const original = Object.fromEntries(Object.keys(replacements).map(key => [key, fs[key]]));
  for (const [key, wrap] of Object.entries(replacements)) fs[key] = wrap(original[key]);
  try { return action(); }
  finally { for (const [key, value] of Object.entries(original)) fs[key] = value; }
}

test('local install, update and rollback bind complete artifacts and preserve Unicode data byte for byte', t => {
  const f = fixture(t);
  const initial = initializeOfflineMarketplaceStore(f);
  assert.equal(initial.state.generation, 0);
  const dataPath = join(f.store, 'data', 'business.json');
  const data = Buffer.from(json({ text: '中文 😀 e\u0301 "quoted" \\\n', relation: 'keep-id' }));
  write(dataPath, data);
  const v1 = bundle(f, '1.0.0');
  const checked = verifyOfflineMarketplaceBundle({ ...f, ...v1 });
  assert.equal(checked.files.length, 6);
  assert.equal(checked.sourceDeclarationVerified, false);
  assert.equal(checked.nativeMarketplaceAcceptance, false);
  const installed = install(f, v1);
  assert.equal(installed.operation, 'install');
  assert.equal(installed.dataUnchanged, true);
  assert.deepEqual(fs.readFileSync(dataPath), data);
  assert.equal(fs.readFileSync(join(f.store, 'releases', v1.manifestSha256, 'payload/README.md'), 'utf8'),
    '测试 Unicode 😀 e\u0301 "quoted" \\\n');
  const v2 = bundle(f, '2.0.0');
  const updated = install(f, v2);
  assert.equal(updated.operation, 'update');
  const rolled = rollbackOfflineMarketplaceBundle({ ...f, catalogId,
    manifestSha256: v1.manifestSha256, expectedStateSha256: updated.stateSha256 });
  assert.equal(rolled.operation, 'rollback');
  assert.equal(rolled.generation, 3);
  assert.deepEqual(fs.readFileSync(dataPath), data);
  const status = offlineMarketplaceStatus(f);
  assert.equal(status.state.installed[catalogId].manifestSha256, v1.manifestSha256);
  assert.deepEqual(status.state.history.map(entry => entry.generation), [0, 1, 2]);
  assert.equal(fs.existsSync(join(f.workspace, 'forbidden-script-marker')), false,
    'Offline installation must never execute package lifecycle scripts');
});

test('failed update retains the committed pointer and retries the exact staged revision', t => {
  const f = fixture(t);
  initializeOfflineMarketplaceStore(f);
  const v1 = bundle(f, '1.0.0');
  install(f, v1);
  const before = fs.readFileSync(join(f.store, 'state.json'));
  const v2 = bundle(f, '2.0.0');
  assert.throws(() => install(f, v2, { beforeCommit() { throw new Error('controlled-failure-before-commit'); } }),
    /controlled-failure/);
  assert.deepEqual(fs.readFileSync(join(f.store, 'state.json')), before);
  assert.equal(fs.existsSync(join(f.store, 'lock.json')), false);
  assert.equal(fs.existsSync(join(f.store, 'releases', v2.manifestSha256)), true);
  const result = install(f, v2);
  assert.equal(result.operation, 'update');
  assert.equal(result.manifestSha256, v2.manifestSha256);
});

test('a journal failure after atomic commit reports the changed revision instead of claiming rollback', t => {
  const f = fixture(t);
  initializeOfflineMarketplaceStore(f);
  install(f, bundle(f, '1.0.0'));
  const v2 = bundle(f, '2.0.0');
  assert.throws(() => install(f, v2, { beforeCommit() {
    const pending = fs.readdirSync(join(f.store, 'transactions')).find(name =>
      !fs.existsSync(join(f.store, 'transactions', name, 'committed.json')));
    assert.ok(pending);
    write(join(f.store, 'transactions', pending, 'committed.json'), 'controlled-journal-collision');
  } }), /Revision published; inspect status/);
  const status = offlineMarketplaceStatus(f);
  assert.equal(status.state.installed[catalogId].manifestSha256, v2.manifestSha256);
  assert.equal(status.state.generation, 2);
  assert.equal(fs.existsSync(join(f.store, 'lock.json')), false);
});

test('stale state, duplicate install and a concurrent live transaction cannot publish another revision', t => {
  const f = fixture(t);
  const initial = initializeOfflineMarketplaceStore(f);
  const v1 = bundle(f, '1.0.0');
  const installed = install(f, v1);
  const v2 = bundle(f, '2.0.0');
  assert.throws(() => installOfflineMarketplaceBundle({ ...f, ...v2,
    expectedStateSha256: initial.stateSha256 }), /Stale store state/);
  assert.throws(() => install(f, v1), /already installed/);
  assert.equal(offlineMarketplaceStatus(f).stateSha256, installed.stateSha256);
  install(f, v2, { beforeCommit() {
    assert.throws(() => install(f, bundle(f, '3.0.0')), /EEXIST/);
    const owner = JSON.parse(fs.readFileSync(join(f.store, 'lock.json')));
    assert.throws(() => recoverOfflineMarketplaceLock({ ...f,
      transactionId: owner.transactionId, expectedStateSha256: installed.stateSha256 }),
    /live transaction cannot be recovered/);
  } });
});

test('unknown catalog IDs, unsafe paths, missing offline metadata and credential URLs are refused', t => {
  const f = fixture(t);
  const cases = [
    manifest => { manifest.catalogId = 'UNKNOWN'; },
    manifest => { manifest.files[0].path = '../../outside'; },
    manifest => { manifest.files[0].path = '/absolute'; },
    manifest => { manifest.files[0].path = 'dist\\index.js'; },
    manifest => { manifest.files[0].path = 'data/../index.js'; },
    manifest => { manifest.files[0].sha256 = '0'.repeat(64); },
    manifest => { manifest.files[0].bytes++; },
    manifest => { manifest.files[1].role = 'source'; },
    manifest => { manifest.source.licensePath = 'missing'; },
    manifest => { manifest.source.revision = 'latest'; },
    manifest => { manifest.source.repository = 'https://example.test/unrelated.git'; },
    manifest => { manifest.source.repository = 'https://secret@example.test/repo.git'; },
    manifest => { manifest.source.repository = 'https://example.test/repo.git?token=secret'; },
    manifest => { manifest.files.push({ ...manifest.files[0], path: 'DIST/INDEX.JS' }); },
    manifest => { manifest.execute = 'npm install'; },
  ];
  cases.forEach((mutate, index) => {
    const input = bundle(f, `invalid-${index}`, mutate);
    assert.throws(() => verifyOfflineMarketplaceBundle({ ...f, ...input }));
  });
  assert.equal(fs.existsSync(f.store), false);
});

test('manifest hashes, extra files, symlink inputs and output aliases cannot escape the owned store', t => {
  const f = fixture(t);
  const v1 = bundle(f, '1.0.0');
  assert.throws(() => verifyOfflineMarketplaceBundle({ ...f, ...v1, manifestSha256: '0'.repeat(64) }),
    /manifest hash differs/);
  write(join(v1.bundlePath, 'extra.txt'), 'undeclared');
  assert.throws(() => verifyOfflineMarketplaceBundle({ ...f, ...v1 }), /undeclared files/);
  fs.unlinkSync(join(v1.bundlePath, 'extra.txt'));
  fs.unlinkSync(join(v1.bundlePath, 'payload/icon.png'));
  fs.symlinkSync('/etc/hosts', join(v1.bundlePath, 'payload/icon.png'));
  assert.throws(() => verifyOfflineMarketplaceBundle({ ...f, ...v1 }), /Symlink/);
  fs.mkdirSync(dirname(f.store), { recursive: true });
  fs.symlinkSync(join(f.workspace, 'other'), f.store);
  assert.throws(() => initializeOfflineMarketplaceStore(f), /Existing destination|Symlink/);
  assert.equal(fs.existsSync(join(f.workspace, 'other')), false);
});

test('concurrent data changes and selected release tampering fail before the revision pointer changes', t => {
  const f = fixture(t);
  initializeOfflineMarketplaceStore(f);
  const v1 = bundle(f, '1.0.0');
  install(f, v1);
  const prior = offlineMarketplaceStatus(f);
  const v2 = bundle(f, '2.0.0');
  assert.throws(() => install(f, v2, { beforeCommit() {
    write(join(f.store, 'data/business.txt'), 'external write');
  } }), /Owned data changed/);
  assert.equal(offlineMarketplaceStatus(f).stateSha256, prior.stateSha256);
  assert.equal(fs.readFileSync(join(f.store, 'data/business.txt'), 'utf8'), 'external write');
  assert.throws(() => install(f, v2, { beforeCommit() {
    write(join(f.store, 'releases', v2.manifestSha256, 'payload/dist/index.js'), 'tampered');
  } }), /payload differs/);
  assert.equal(offlineMarketplaceStatus(f).stateSha256, prior.stateSha256);
});

test('rollback requires a previously committed exact catalog revision and rehashes retained payloads', t => {
  const f = fixture(t);
  initializeOfflineMarketplaceStore(f);
  const v1 = bundle(f, '1.0.0');
  install(f, v1);
  const v2 = bundle(f, '2.0.0');
  const active = install(f, v2);
  assert.throws(() => rollbackOfflineMarketplaceBundle({ ...f, catalogId,
    manifestSha256: 'b'.repeat(64), expectedStateSha256: active.stateSha256 }), /never committed/);
  write(join(f.store, 'releases', v1.manifestSha256, 'payload/LICENSE'), 'tampered');
  assert.throws(() => rollbackOfflineMarketplaceBundle({ ...f, catalogId,
    manifestSha256: v1.manifestSha256, expectedStateSha256: active.stateSha256 }), /payload differs/);
  assert.equal(offlineMarketplaceStatus(f).stateSha256, active.stateSha256);
});

test('an actually killed installer leaves the old revision readable and supports exact dead-owner recovery', t => {
  const f = fixture(t);
  initializeOfflineMarketplaceStore(f);
  const data = Buffer.from('business data 😀\n');
  write(join(f.store, 'data/business.txt'), data);
  install(f, bundle(f, '1.0.0'));
  const v2 = bundle(f, '2.0.0');
  const before = offlineMarketplaceStatus(f);
  const input = { workspace: f.workspace, runId: f.runId, bundlePath: v2.bundlePath,
    manifestSha256: v2.manifestSha256, expectedStateSha256: before.stateSha256 };
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { installOfflineMarketplaceBundle } from ${JSON.stringify(new URL(`file://${toolPath}`).href)};
    installOfflineMarketplaceBundle({ ...${JSON.stringify(input)},
      beforeCommit() { process.kill(process.pid, 'SIGKILL'); } });
  `], { encoding: 'utf8', timeout: 10000 });
  assert.equal(child.signal, 'SIGKILL', child.stderr);
  assert.equal(offlineMarketplaceStatus(f).stateSha256, before.stateSha256);
  const lock = JSON.parse(fs.readFileSync(join(f.store, 'lock.json')));
  assert.throws(() => recoverOfflineMarketplaceLock({ ...f,
    transactionId: randomBytes(16).toString('hex'), expectedStateSha256: before.stateSha256 }));
  const recovered = recoverOfflineMarketplaceLock({ ...f, transactionId: lock.transactionId,
    expectedStateSha256: before.stateSha256 });
  assert.equal(recovered.stateChanged, false);
  assert.equal(fs.existsSync(join(f.store, `recovered-${lock.transactionId}.json`)), true);
  const retried = install(f, v2);
  assert.equal(retried.operation, 'update');
  assert.deepEqual(fs.readFileSync(join(f.store, 'data/business.txt')), data);
});

test('store identities cannot be adopted from arbitrary directories or changed ownership markers', t => {
  const f = fixture(t);
  initializeOfflineMarketplaceStore(f);
  assert.throws(() => initializeOfflineMarketplaceStore(f), /Existing destination/);
  const marker = JSON.parse(fs.readFileSync(join(f.store, 'owner.json')));
  write(join(f.store, 'owner.json'), json({ ...marker, runId: 'f'.repeat(12) }));
  assert.throws(() => offlineMarketplaceStatus(f));
  assert.throws(() => initializeOfflineMarketplaceStore({ ...f, runId: '../escape' }));
});

test('history budget exhaustion is rejected before staging or publishing an unreadable next state', t => {
  const f = fixture(t);
  initializeOfflineMarketplaceStore(f);
  const path = join(f.store, 'state.json');
  const state = JSON.parse(fs.readFileSync(path));
  state.generation = 1000;
  state.history = Array.from({ length: 1000 }, (_, generation) => ({ generation, installed: {} }));
  write(path, json(state));
  const prior = fs.readFileSync(path);
  assert.throws(() => install(f, bundle(f, '1.0.0')), /history budget reached/);
  assert.deepEqual(fs.readFileSync(path), prior);
  assert.deepEqual(fs.readdirSync(join(f.store, 'releases')), []);
});

test('owner-write failure cannot publish an ownerless active lock or block a later retry', t => {
  const f = fixture(t);
  initializeOfflineMarketplaceStore(f);
  const v1 = bundle(f, '1.0.0');
  const prior = offlineMarketplaceStatus(f);
  const expected = new Error('controlled-owner-write-failure');
  let ownerFd;
  patchFS({
    openSync: original => (...args) => {
      const fd = original(...args);
      if (typeof args[0] === 'string' && args[0].includes('/lock-candidate-')
          && (args[1] & fs.constants.O_WRONLY)) ownerFd = fd;
      return fd;
    },
    writeFileSync: original => (...args) => {
      if (args[0] === ownerFd) throw expected;
      return original(...args);
    },
  }, () => assert.throws(() => install(f, v1), error => error === expected));
  assert.equal(fs.existsSync(join(f.store, 'lock.json')), false);
  assert.equal(offlineMarketplaceStatus(f).stateSha256, prior.stateSha256);
  assert.equal(install(f, v1).operation, 'install');
});

test('an actual crash during lock retirement retains complete owner bytes without leaving an active lock', t => {
  const f = fixture(t);
  initializeOfflineMarketplaceStore(f);
  const data = Buffer.from('retirement keeps data 😀\n');
  write(join(f.store, 'data/business.txt'), data);
  install(f, bundle(f, '1.0.0'));
  const v2 = bundle(f, '2.0.0');
  const input = { workspace: f.workspace, runId: f.runId, bundlePath: v2.bundlePath,
    manifestSha256: v2.manifestSha256, expectedStateSha256: offlineMarketplaceStatus(f).stateSha256 };
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import fs from 'node:fs';
    import { installOfflineMarketplaceBundle } from ${JSON.stringify(new URL(`file://${toolPath}`).href)};
    const rename = fs.renameSync;
    fs.renameSync = (...args) => {
      const value = rename(...args);
      if (String(args[0]).endsWith('/lock.json')) process.kill(process.pid, 'SIGKILL');
      return value;
    };
    installOfflineMarketplaceBundle(${JSON.stringify(input)});
  `], { encoding: 'utf8', timeout: 10000 });
  assert.equal(child.signal, 'SIGKILL', child.stderr);
  assert.equal(fs.existsSync(join(f.store, 'lock.json')), false);
  assert.equal(offlineMarketplaceStatus(f).state.installed[catalogId].manifestSha256, v2.manifestSha256);
  const owners = fs.readdirSync(f.store).filter(name => name.startsWith('retired-lock-'))
    .map(name => JSON.parse(fs.readFileSync(join(f.store, name))));
  assert.ok(owners.some(owner => owner.pid === child.pid && typeof owner.processBirth === 'string'));
  assert.equal(install(f, bundle(f, '3.0.0')).operation, 'update');
  assert.deepEqual(fs.readFileSync(join(f.store, 'data/business.txt')), data);
});

test('fsync failure after state rename reports publication and preserves the exact primary cause', t => {
  const f = fixture(t);
  initializeOfflineMarketplaceStore(f);
  install(f, bundle(f, '1.0.0'));
  const v2 = bundle(f, '2.0.0');
  const expected = new Error('controlled-state-directory-fsync-failure');
  let renamed = false;
  let caught;
  patchFS({
    renameSync: original => (...args) => {
      const value = original(...args);
      if (String(args[1]).endsWith('/state.json')) renamed = true;
      return value;
    },
    fsyncSync: original => (...args) => {
      if (renamed) {
        renamed = false;
        throw expected;
      }
      return original(...args);
    },
  }, () => {
    try { install(f, v2); }
    catch (error) { caught = error; }
  });
  assert.equal(caught?.revisionPublished, true);
  assert.equal(caught.cause, expected);
  assert.deepEqual(caught.suppressed, []);
  assert.equal(caught.stateSha256, offlineMarketplaceStatus(f).stateSha256);
  assert.equal(offlineMarketplaceStatus(f).state.installed[catalogId].manifestSha256, v2.manifestSha256);
  assert.equal(fs.existsSync(join(f.store, 'lock.json')), false);
});

test('post-publication journal and lock-release failures retain primary and cleanup causes separately', t => {
  const f = fixture(t);
  initializeOfflineMarketplaceStore(f);
  const v1 = bundle(f, '1.0.0');
  const primary = new Error('controlled-journal-open-failure');
  const secondary = new Error('controlled-lock-retirement-failure');
  let caught;
  patchFS({
    openSync: original => (...args) => {
      if (typeof args[0] === 'string' && args[0].endsWith('/committed.json')) throw primary;
      return original(...args);
    },
    renameSync: original => (...args) => {
      if (String(args[0]).endsWith('/lock.json')) throw secondary;
      return original(...args);
    },
  }, () => {
    try { install(f, v1); }
    catch (error) { caught = error; }
  });
  assert.equal(caught?.revisionPublished, true);
  assert.equal(caught.cause, primary);
  assert.deepEqual(caught.suppressed, [secondary]);
  assert.equal(caught.stateSha256, offlineMarketplaceStatus(f).stateSha256);
  assert.equal(offlineMarketplaceStatus(f).state.installed[catalogId].manifestSha256, v1.manifestSha256);
  assert.match(JSON.parse(fs.readFileSync(join(f.store, 'lock.json'))).transactionId, /^[a-f0-9-]{36}$/);
});

test('a pre-publication action error is not replaced by a failed lock retirement', t => {
  const f = fixture(t);
  initializeOfflineMarketplaceStore(f);
  const prior = offlineMarketplaceStatus(f);
  const v1 = bundle(f, '1.0.0');
  const primary = new Error('controlled-pre-publication-action-failure');
  const secondary = new Error('controlled-pre-publication-release-failure');
  patchFS({
    renameSync: original => (...args) => {
      if (String(args[0]).endsWith('/lock.json')) throw secondary;
      return original(...args);
    },
  }, () => assert.throws(() => install(f, v1, { beforeCommit() { throw primary; } }),
    error => error === primary && error.suppressed?.[0] === secondary));
  assert.equal(offlineMarketplaceStatus(f).stateSha256, prior.stateSha256);
  assert.match(JSON.parse(fs.readFileSync(join(f.store, 'lock.json'))).transactionId, /^[a-f0-9-]{36}$/);
});
