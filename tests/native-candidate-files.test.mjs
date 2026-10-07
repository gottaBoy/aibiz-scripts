import assert from 'node:assert/strict';
import { chmodSync, fstatSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { PinnedDirectories } from '../native-candidate-files.mjs';

test('pinned directory release retains parents and rejects live children and stale handles', t => {
  const root = mkdtempSync(join(tmpdir(), 'aibiz-pinned-release-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const directories = new PinnedDirectories();
  try {
    const parent = directories.open(root);
    const child = directories.open(join(root, 'child'), { create: true });
    assert.throws(() => directories.release(parent), /child directories/);
    directories.verify(parent);
    directories.release(child);
    assert.throws(() => fstatSync(child.descriptor), /EBADF/);
    assert.throws(() => directories.release(child), /not pinned/);
    directories.verify(parent);
    const reopened = directories.open(join(root, 'child'));
    assert.notEqual(reopened, child);
    directories.verify(reopened);
    directories.release(reopened);
    directories.release(parent);
  } finally { directories.close(); }
  assert.equal(directories.directories.size, 0);
  assert.doesNotThrow(() => directories.close());
});

test('pinned writes preserve explicit security-sensitive and shared-read modes', t => {
  const root = mkdtempSync(join(tmpdir(), 'aibiz-pinned-write-mode-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const directories = new PinnedDirectories();
  try {
    const parent = directories.open(root);
    directories.write(parent, 'private.json', 'private\n');
    directories.write(parent, 'shared.jar', 'shared\n', 0o644);
    assert.equal(statSync(join(root, 'private.json')).mode & 0o777, 0o600);
    assert.equal(statSync(join(root, 'shared.jar')).mode & 0o777, 0o644);
    assert.throws(() => directories.write(parent, 'invalid.bin', 'invalid\n', 0o755),
      /Unsupported pinned file mode/);
    chmodSync(join(root, 'shared.jar'), 0o755);
    assert.throws(() => directories.write(parent, 'shared.jar', 'changed\n', 0o644),
      /EEXIST/);
  } finally {
    directories.close();
  }
});

test('many sequential pinned directories use bounded handles and can be reopened after close', t => {
  const root = mkdtempSync(join(tmpdir(), 'aibiz-pinned-bounded-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const directories = new PinnedDirectories();
  try {
    const parent = directories.open(root);
    const bound = directories.directories.size;
    for (let index = 0; index < 100; index++) {
      const child = directories.open(join(root, `child-${index}`), { create: true });
      assert.equal(directories.directories.size, bound + 1);
      directories.release(child);
      assert.equal(directories.directories.size, bound);
      directories.verify(parent);
    }
    directories.close();
    directories.verify(directories.open(root));
  } finally { directories.close(); }
});
