import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { join } from 'node:path';
import { fingerprint, PinnedDirectories, readPinnedFile } from './native-candidate-files.mjs';

const generatedDirectories = new Set(['.git', '.artifacts', 'target']);

export function sourceBuildInputs(root, { generatedArtifacts = [] } = {}) {
  const directories = new PinnedDirectories();
  const entries = [];
  function visit(directory, prefix = '') {
    directories.verify(directory);
    for (const entry of fs.readdirSync(directory.access, { withFileTypes: true })) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (generatedDirectories.has(entry.name) || generatedArtifacts.includes(path)) continue;
      assert.ok(!entry.name.includes('\\'), 'Ambiguous source input path');
      assert.ok(!entry.isSymbolicLink(), 'Symlink source input rejected');
      if (entry.isDirectory()) {
        visit(directories.open(join(directory.path, entry.name)), path);
      } else {
        const { data, identity } = readPinnedFile(directories, directory, entry.name);
        entries.push({
          path, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex'),
          mode: identity.mode & 0o777,
        });
      }
    }
    directories.verify(directory);
  }
  try { visit(directories.open(root)); }
  finally { directories.close(); }
  assert.ok(entries.length, 'Source input inventory is empty');
  entries.sort((left, right) => left.path.localeCompare(right.path));
  return { ...fingerprint(entries), entries };
}

export function verifyRecordedBuildInputs(root, receipt, options = {}) {
  try {
    assert.equal(receipt.sourceInputs?.contract, 'source-build-input-inventory-v1',
      'No build-time input inventory contract');
    const current = sourceBuildInputs(root, options);
    assert.deepEqual(receipt.sourceInputs.before, current, 'Build-time source input inventory differs');
    assert.deepEqual(receipt.sourceInputs.after, current, 'Post-build source input inventory differs');
    assert.deepEqual(sourceBuildInputs(root, options), current, 'Source input inventory changed during audit');
    return { ok: true, reason: 'Build-time input inventories match current source, resources, dependencies and build scripts' };
  } catch {
    return { ok: false, reason: 'Missing, stale or unverifiable build-time source input inventories; commit-only receipts are insufficient' };
  }
}

export function verifyCommittedSource(root, receiptCommit, execute = execFileSync) {
  try {
    const commit = execute('git', ['-C', root, 'rev-parse', '--verify', 'HEAD'], {
      encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(commit)) {
      return { ok: false, reason: 'Source Git identity is unavailable' };
    }
    if (receiptCommit !== commit) {
      return { ok: false, reason: 'Source build receipt does not match the current commit', commit };
    }
    const changes = execute('git', [
      '-C', root, 'status', '--porcelain=v1', '--untracked-files=all', '--', '.',
    ], {
      encoding: 'utf8', timeout: 10_000, stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
    if (changes) {
      return { ok: false, reason: 'Commit-only receipt cannot verify modified or untracked source inputs', commit };
    }
    return { ok: true, reason: 'Current committed source tree is clean', commit };
  } catch {
    return { ok: false, reason: 'Source Git identity could not be verified' };
  }
}
