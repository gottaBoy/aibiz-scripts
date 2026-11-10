import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectMysqlColdArchive, verifyMysqlColdArchiveManifest } from '../mysql-cold-backup-archive.mjs';
import { coldRunId, coldArchiveEntries, createColdTestArchive } from './mysql-cold-backup-fixture.mjs';

test('a parsed gzip/tar manifest preserves every file hash, directory, numeric owner, mode and empty directory', () => {
  const bytes = createColdTestArchive();
  const manifest = inspectMysqlColdArchive(coldRunId, bytes);
  assert.equal(manifest.entries.length, 11);
  assert.equal(manifest.archiveBytes, bytes.length);
  assert.ok(manifest.entries.every(row => row.uid === 1001 && row.gid === 1001));
  verifyMysqlColdArchiveManifest(coldRunId, manifest);
  assert.deepEqual(inspectMysqlColdArchive(coldRunId, bytes), manifest);
});

for (const [name, entry] of [
  ['parent traversal', { path: '../escape', kind: 'file' }],
  ['absolute path', { path: '/escape', kind: 'file' }],
  ['backslash path', { path: 'data\\escape', kind: 'file' }],
  ['symbolic link', { path: 'data/link', kind: 'symlink', link: '/etc/passwd' }],
  ['hard link', { path: 'data/link', kind: 'hardlink', link: 'data/ibdata1' }],
  ['device', { path: 'data/device', kind: 'device' }],
  ['FIFO', { path: 'data/fifo', kind: 'fifo' }],
  ['root-owned file', { path: 'data/root', kind: 'file', uid: 0 }],
  ['foreign group', { path: 'data/foreign', kind: 'file', gid: 0 }],
  ['setuid permission', { path: 'data/setuid', kind: 'file', mode: 0o4750 }],
  ['world writable permission', { path: 'data/write', kind: 'file', mode: 0o777 }],
  ['foreign fixture data', { path: 'data/nf_ffffffffffff_model_a/record', kind: 'file' }],
  ['foreign wildcard data', { path: 'data/nfxffffffffffff_model_a/record', kind: 'file' }],
  ['unexpected top-level path', { path: 'external/data', kind: 'file' }],
]) {
  test(`cold backup rejects ${name} before extraction`, () => {
    assert.throws(() => inspectMysqlColdArchive(coldRunId, createColdTestArchive([...coldArchiveEntries(), entry])));
  });
}

test('duplicate entries, absent system/model files and a changed byte cannot satisfy the original backup', () => {
  const rows = coldArchiveEntries();
  assert.throws(() => inspectMysqlColdArchive(coldRunId, createColdTestArchive([...rows, rows[0]])));
  for (const path of ['data/auto.cnf', 'data/mysql/user.frm', `data/nf_${coldRunId}_model_b/t_srfpsmodule.ibd`]) {
    assert.throws(() => inspectMysqlColdArchive(coldRunId, createColdTestArchive(rows.filter(row => row.path !== path))));
  }
  const before = inspectMysqlColdArchive(coldRunId, createColdTestArchive(rows));
  const changed = structuredClone(rows);
  changed.at(-1).content = 'different physical bytes';
  const after = inspectMysqlColdArchive(coldRunId, createColdTestArchive(changed));
  assert.notEqual(after.manifestSha256, before.manifestSha256);
  assert.notDeepEqual(after.entries, before.entries);
});

test('gzip CRC, truncated archives, non-gzip input and oversize input are rejected', () => {
  const bytes = createColdTestArchive();
  const corrupt = Buffer.from(bytes);
  corrupt[corrupt.length - 8] ^= 0xff;
  for (const data of [Buffer.alloc(0), Buffer.from('not a gzip archive'), bytes.subarray(0, 20),
    bytes.subarray(0, bytes.length - 4), corrupt]) assert.throws(() => inspectMysqlColdArchive(coldRunId, data));
  assert.throws(() => inspectMysqlColdArchive(coldRunId, Buffer.alloc(64 * 1024 * 1024 + 1)));
});

test('manifest validation rejects reordered, duplicate, changed owner, unbounded and disguised special entries', () => {
  const original = inspectMysqlColdArchive(coldRunId, createColdTestArchive());
  for (const mutate of [
    row => { row.entries.reverse(); },
    row => { row.entries.push(row.entries[0]); },
    row => { row.entries[0].uid = 0; },
    row => { row.entries[0].mode = 0o4777; },
    row => { row.entries.at(-1).bytes = 1024 ** 3 + 1; },
    row => { row.entries.at(-1).sha256 = ''; },
    row => { row.expandedBytes++; },
    row => { row.entries[0].kind = 'symlink'; },
    row => { row.entries.at(-1).link = '/etc/passwd'; },
  ]) {
    const manifest = structuredClone(original);
    mutate(manifest);
    assert.throws(() => verifyMysqlColdArchiveManifest(coldRunId, manifest));
  }
});
