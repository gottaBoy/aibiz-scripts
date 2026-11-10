import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const inspector = String.raw`
import gzip, hashlib, json, pathlib, sys, tarfile
rows, seen, expanded = [], set(), 0
compressed = gzip.GzipFile(fileobj=sys.stdin.buffer, mode="rb")
with tarfile.open(fileobj=compressed, mode="r|") as archive:
    for member in archive:
        path = pathlib.PurePosixPath(member.name)
        if path.is_absolute() or ".." in path.parts or "\\" in member.name or "\0" in member.name:
            raise ValueError("Unsafe archive path")
        name = str(path)
        if name in seen or len(seen) >= 20000:
            raise ValueError("Duplicate or excessive archive entries")
        seen.add(name)
        if not (member.isfile() or member.isdir()) or member.linkname:
            raise ValueError("Links, devices and special files are forbidden")
        if member.uid != 1001 or member.gid != 1001 or member.mode & ~0o777:
            raise ValueError("Unexpected archive ownership or special mode")
        if member.size < 0 or member.size > 1024 * 1024 * 1024:
            raise ValueError("Oversized archive member")
        expanded += member.size
        if expanded > 4 * 1024 * 1024 * 1024:
            raise ValueError("Oversized expanded archive")
        row = dict(path=name, kind="file" if member.isfile() else "directory",
                   mode=member.mode, uid=member.uid, gid=member.gid, bytes=member.size)
        if member.isfile():
            digest, count = hashlib.sha256(), 0
            stream = archive.extractfile(member)
            for data in iter(lambda: stream.read(1048576), b""):
                digest.update(data)
                count += len(data)
            if count != member.size:
                raise ValueError("Truncated archive member")
            row["sha256"] = digest.hexdigest()
        rows.append(row)
padding = 0
for data in iter(lambda: compressed.read(16384), b""):
    padding += len(data)
    if padding > 65536 or any(data):
        raise ValueError("Unexpected trailing archive payload")
json.dump(dict(entries=sorted(rows, key=lambda row: row["path"]), expandedBytes=expanded), sys.stdout)
`;

export function verifyMysqlColdArchiveManifest(runId, manifest) {
  assert.match(runId, /^[a-f0-9]{12}$/);
  assert.ok(manifest && Array.isArray(manifest.entries) && manifest.entries.length > 0);
  assert.ok(manifest.entries.length <= 20000);
  const paths = new Map();
  let expanded = 0;
  for (const row of manifest.entries) {
    assert.equal(typeof row.path, 'string');
    assert.ok(row.path === '.' || /^data(?:\/[a-zA-Z0-9_.@#$-]+)*$/.test(row.path),
      'Only the reviewed data directory may be archived');
    assert.ok(row.path.split('/').every(value => !['..', ''].includes(value)));
    assert.ok(!paths.has(row.path), 'Duplicate archive path');
    assert.ok(['directory', 'file'].includes(row.kind));
    assert.deepEqual(Object.keys(row).sort(), ['bytes', 'gid', 'kind', 'mode', 'path', 'uid',
      ...(row.kind === 'file' ? ['sha256'] : [])].sort());
    assert.equal(row.uid, 1001);
    assert.equal(row.gid, 1001);
    assert.ok(Number.isInteger(row.mode) && row.mode >= 0 && row.mode <= 0o777);
    assert.ok(!(row.mode & 0o002), 'World-writable backup entries are forbidden');
    assert.ok(Number.isSafeInteger(row.bytes) && row.bytes >= 0 && row.bytes <= 1024 ** 3);
    if (row.kind === 'directory') assert.equal(row.bytes, 0);
    else assert.match(row.sha256, /^[a-f0-9]{64}$/);
    expanded += row.bytes;
    assert.ok(expanded <= 4 * 1024 ** 3);
    paths.set(row.path, row);
  }
  assert.equal(manifest.expandedBytes, expanded);
  assert.deepEqual(manifest.entries.map(row => row.path), [...paths.keys()].sort());
  for (const name of ['.', 'data', 'data/mysql', `data/nf_${runId}_model_a`, `data/nf_${runId}_model_b`]) {
    assert.equal(paths.get(name)?.kind, 'directory', `Missing required backup directory ${name}`);
  }
  for (const name of ['data/auto.cnf', 'data/ibdata1', 'data/ib_logfile0',
    `data/nf_${runId}_model_a/t_srfpsmodule.ibd`, `data/nf_${runId}_model_b/t_srfpsmodule.ibd`]) {
    assert.equal(paths.get(name)?.kind, 'file', `Missing required physical database file ${name}`);
  }
  assert.ok([...paths.keys()].some(name => /^data\/mysql\/user\.(?:frm|MYD|ibd)$/.test(name)),
    'Physical recovery must include the original SQL account tables');
  const schemas = new Set([...paths.keys()].filter(name => name.startsWith('data/')).map(name => name.split('/')[1]));
  for (const schema of schemas) {
    assert.ok(!schema.startsWith('nf_') || schema.startsWith(`nf_${runId}_`), 'Foreign fixture data in backup');
    assert.ok(!schema.startsWith('nfx') || schema.startsWith(`nfx${runId}_`), 'Foreign wildcard-probe data in backup');
  }
  return true;
}

export function inspectMysqlColdArchive(runId, bytes, execute = spawnSync) {
  assert.ok(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= 64 * 1024 * 1024,
    'A bounded private gzip archive is required');
  const result = execute('python3', ['-c', inspector], {
    input: bytes, encoding: 'utf8', timeout: 180_000, maxBuffer: 16 * 1024 * 1024,
  });
  assert.ok(!result.error && !result.signal && result.status === 0,
    'Owned database archive is unsafe, corrupt or incomplete; private content suppressed');
  const manifest = JSON.parse(result.stdout);
  verifyMysqlColdArchiveManifest(runId, manifest);
  return { ...manifest, archiveBytes: bytes.length, archiveSha256: hash(bytes),
    manifestSha256: hash(JSON.stringify(manifest)) };
}
