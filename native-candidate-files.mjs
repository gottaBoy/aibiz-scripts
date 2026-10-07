import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { dirname, join, parse, relative, resolve, sep } from 'node:path';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');

export function optionalStat(path) {
  try { return fs.lstatSync(path); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export function directoryPath(path, { allowMissing = false } = {}) {
  let current = parse(path).root;
  let info;
  for (const component of path.slice(current.length).split(sep).filter(Boolean)) {
    current = join(current, component);
    info = optionalStat(current);
    if (!info && allowMissing) return null;
    assert.ok(info, `Missing directory: ${current}`);
    assert.ok(!info.isSymbolicLink(), `Symlink directory rejected: ${current}`);
    assert.ok(info.isDirectory(), `Not a directory: ${current}`);
  }
  return info;
}

function sameIdentity(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

// Each operation uses a pinned parent and a single basename, never a mutable
// ancestor path. Linux procfs supplies the directory-relative paths Node needs.
// Creation requires trusted parents and a single writer. Failed candidates are
// retained: Node cannot atomically compare an inode and unlink its pathname.
export class PinnedDirectories {
  directories = new Map();

  constructor() {
    assert.equal(process.platform, 'linux', 'Resource repair requires Linux with /proc/self/fd');
  }

  entry(directory, name) {
    assert.ok(name && name !== '.' && name !== '..' &&
      !name.includes(sep) && !name.includes('\\'), 'Invalid directory entry');
    return join(directory.access, name);
  }

  verify(directory) {
    if (directory.parent) {
      this.verify(directory.parent);
      const current = optionalStat(this.entry(directory.parent, directory.name));
      assert.ok(current?.isDirectory() && !current.isSymbolicLink() &&
        sameIdentity(directory.identity, current), `Directory changed: ${directory.path}`);
    }
    assert.ok(sameIdentity(directory.identity, fs.fstatSync(directory.descriptor)),
      `Directory descriptor changed: ${directory.path}`);
  }

  open(path, { create = false, exclusive = false } = {}) {
    path = resolve(path);
    const cached = this.directories.get(path);
    if (cached) {
      assert.ok(!exclusive, 'Existing destination must not be overwritten');
      this.verify(cached);
      return cached;
    }
    const root = parse(path).root;
    const parent = path === root ? null : this.open(dirname(path), { create });
    const name = path === root ? null : relative(dirname(path), path);
    const access = parent ? this.entry(parent, name) : root;
    let info = optionalStat(access);
    let created = false;
    if (exclusive) assert.ok(!info, 'Existing destination must not be overwritten');
    if (!info && create) {
      fs.mkdirSync(access, { mode: 0o700 });
      created = true;
      info = fs.lstatSync(access);
    }
    assert.ok(info, `Missing directory: ${path}`);
    assert.ok(!info.isSymbolicLink(), `Symlink directory rejected: ${path}`);
    assert.ok(info.isDirectory(), `Not a directory: ${path}`);
    if (created) {
      assert.equal(info.uid, process.geteuid(), `Created directory owner changed: ${path}`);
      assert.equal(info.mode & 0o777, 0o700, `Created directory permissions changed: ${path}`);
    }
    const descriptor = fs.openSync(access,
      fs.constants.O_RDONLY | fs.constants.O_DIRECTORY | fs.constants.O_NOFOLLOW);
    try {
      const directory = {
        path, parent, name, descriptor, identity: fs.fstatSync(descriptor),
        access: `/proc/self/fd/${descriptor}`,
      };
      assert.ok(sameIdentity(info, directory.identity), `Directory changed while opening: ${path}`);
      assert.ok(sameIdentity(directory.identity, fs.statSync(directory.access)),
        'Resource repair requires accessible Linux /proc/self/fd');
      this.verify(directory);
      this.directories.set(path, directory);
      return directory;
    } catch (error) {
      fs.closeSync(descriptor);
      throw error;
    }
  }

  write(directory, name, data, mode = 0o600) {
    this.verify(directory);
    assert.ok(mode === 0o600 || mode === 0o644, 'Unsupported pinned file mode');
    const path = this.entry(directory, name);
    const descriptor = fs.openSync(path,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW,
      mode);
    let identity;
    try {
      identity = fs.fstatSync(descriptor);
      fs.writeFileSync(descriptor, data);
    } finally {
      fs.closeSync(descriptor);
    }
    this.verify(directory);
    const current = optionalStat(path);
    assert.ok(current?.isFile() && !current.isSymbolicLink() && sameIdentity(identity, current),
      `Resource path changed while writing: ${name}`);
    assert.equal(current.mode & 0o777, mode, `Resource mode changed while writing: ${name}`);
    return identity;
  }

  release(directory) {
    assert.equal(this.directories.get(directory.path), directory, 'Directory is not pinned');
    assert.ok(![...this.directories.values()].some(current => current.parent === directory),
      'Pinned child directories must be released first');
    fs.closeSync(directory.descriptor);
    this.directories.delete(directory.path);
  }

  close() {
    for (const directory of [...this.directories.values()].reverse()) {
      fs.closeSync(directory.descriptor);
    }
    this.directories.clear();
  }
}

export function readPinnedFile(directories, directory, name, expected) {
  directories.verify(directory);
  const path = directories.entry(directory, name);
  const info = fs.lstatSync(path);
  assert.ok(!info.isSymbolicLink(), `Symlink resource rejected: ${name}`);
  assert.ok(info.isFile(), `Non-regular resource rejected: ${name}`);
  assert.ok(info.size <= 64 * 1024 * 1024, `Resource too large: ${name}`);
  if (expected) assert.ok(sameIdentity(expected, info), `Resource identity changed: ${name}`);
  const descriptor = fs.openSync(path,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  let data;
  try {
    const opened = fs.fstatSync(descriptor);
    assert.ok(opened.isFile() && sameIdentity(info, opened),
      `Resource changed while opening: ${name}`);
    data = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor);
    assert.ok(after.size === data.length && after.mtimeMs === opened.mtimeMs &&
      after.ctimeMs === opened.ctimeMs, `Resource changed while reading: ${name}`);
    const current = fs.lstatSync(path);
    assert.ok(sameIdentity(current, after) && current.size === after.size &&
      current.mtimeMs === after.mtimeMs && current.ctimeMs === after.ctimeMs,
    `Resource path changed while reading: ${name}`);
  } finally {
    fs.closeSync(descriptor);
  }
  directories.verify(directory);
  return { data, identity: info };
}

export function fingerprint(entries) {
  return {
    files: entries.length,
    bytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
    fingerprintKind: 'relative-file-set',
    fingerprint: hash(JSON.stringify(entries)),
  };
}

export function readTree(root, { jsonOnly = true } = {}) {
  const files = [];
  let bytes = 0;
  const directories = new PinnedDirectories();
  function visit(directory, prefix = '') {
    directories.verify(directory);
    for (const entry of fs.readdirSync(directory.access, { withFileTypes: true })) {
      const path = directories.entry(directory, entry.name);
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      const info = fs.lstatSync(path);
      assert.ok(!info.isSymbolicLink(), `Symlink resource rejected: ${name}`);
      assert.ok(!entry.name.includes('\\'), `Ambiguous resource path rejected: ${name}`);
      if (info.isDirectory()) {
        visit(directories.open(join(directory.path, entry.name)), name);
        continue;
      }
      if (jsonOnly) assert.ok(name.endsWith('.json'), `Non-JSON resource rejected: ${name}`);
      const { data } = readPinnedFile(directories, directory, entry.name, info);
      bytes += data.length;
      assert.ok(bytes <= 256 * 1024 * 1024, 'Resource tree too large');
      files.push({ path: name, bytes: data.length, sha256: hash(data), data });
    }
    directories.verify(directory);
  }
  try { visit(directories.open(root)); }
  finally { directories.close(); }
  assert.ok(files.length, jsonOnly ? 'Resource tree contains no JSON files' : 'Input tree contains no files');
  files.sort((a, b) => a.path.localeCompare(b.path));
  const entries = files.map(({ path, bytes: size, sha256 }) => ({ path, bytes: size, sha256 }));
  return { contents: files, entries, ...fingerprint(entries) };
}
