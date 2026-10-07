#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { basename, dirname, join, posix, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  fingerprint, optionalStat, PinnedDirectories, readPinnedFile, readTree,
} from './native-candidate-files.mjs';
import {
  CLI_SOURCE_API, CLI_SOURCE_RELEASES, gitObjectHash, protectedSourcePath,
  publicRawUrl, validateRawRedirect, validateSourcePath, verifySourceBlob, verifySourceTree,
} from './fetch-native-cli-source.mjs';

const workspaceDefault = fileURLToPath(new URL('../', import.meta.url));
const hash = data => createHash('sha256').update(data).digest('hex');
const jsonBytes = value => `${JSON.stringify(value, null, 2)}\n`;
const inside = (root, path) => path === root || path.startsWith(`${root}${sep}`);
const framework = name => /^@(?:ibiz(?:-template(?:-plugin)?)?|ibizlab)\//.test(name);
const packageName = /^(?:@[A-Za-z0-9._-]+\/)?[A-Za-z0-9._-]+$/;
const openLicenses = new Set([
  'MIT', 'MIT-0', 'ISC', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', '0BSD',
  'CC0-1.0', 'Unlicense', 'WTFPL', 'Zlib', 'BlueOak-1.0.0', 'Python-2.0',
  '(MIT OR Apache-2.0)', '(BSD-2-Clause OR MIT OR Apache-2.0)',
  '(MIT AND Zlib)', '(MIT OR CC0-1.0)',
]);
const specs = [
  { id: 'core', path: 'packages/core', name: '@ibiz-template/cli-core',
    required: ['dist/index.js', 'dist/index.d.ts'] },
  { id: 'cli', path: 'packages/cli', name: '@ibiz-template/cli',
    required: ['dist/exports.js', 'dist/exports.d.ts', 'dist/bin.js'] },
];

function readFile(directories, path) {
  return readPinnedFile(directories, directories.open(dirname(path)), basename(path)).data;
}

function fixedReportPath(workspace, path, folder) {
  assert.ok(typeof path === 'string' && path, 'A report path is required');
  const reportPath = resolve(workspace, path);
  assert.equal(basename(reportPath), 'report.json', 'Expected report.json');
  assert.equal(dirname(dirname(reportPath)), join(workspace, '.artifacts', folder),
    `Report must belong to a direct child of .artifacts/${folder}`);
  return reportPath;
}

function destinationFor(workspace, output) {
  const root = join(workspace, '.artifacts/native-cli-source-build');
  const destination = resolve(workspace, output ?? join(root, `build-${randomUUID()}`));
  assert.equal(dirname(destination), root,
    'Output must be a direct child of .artifacts/native-cli-source-build');
  assert.match(basename(destination), /^[A-Za-z0-9][A-Za-z0-9._-]*$/, 'Invalid output name');
  return destination;
}

function excludedInput(path) {
  const parts = path.split('/');
  return parts.some(part => ['node_modules', '.artifacts', '.cache', 'coverage'].includes(part)) ||
    /^(?:packages\/(?:core|cli)\/)?(?:dist|out|es|lib)\//.test(path) ||
    path.endsWith('.tsbuildinfo');
}

function outputPath(path) {
  return /^packages\/(?:core|cli)\/dist\//.test(path) ||
    /^(?:packages\/(?:core|cli)\/)?[^/]+\.tsbuildinfo$/.test(path);
}

function modulePath(path) {
  return /^(?:packages\/(?:core|cli)\/)?node_modules(?:\/|$)/.test(path);
}

function installedPublicModule(path, identity) {
  return identity?.name === '@babel/parser' && identity?.version === '7.22.5' &&
    ['lib/parse-error/credentials.js', 'lib/parse-error/credentials.js.map'].includes(path);
}

// Check names before reading bytes, including protected files not listed in a receipt.
function checkedTree(root, { staged = false, installed = false, packageIdentity } = {}) {
  function checkPath(path) {
    validateSourcePath(path);
    // Babel's reviewed parse-error module is code, not a credential store.
    const exception = installed && installedPublicModule(path, packageIdentity);
    assert.ok(!protectedSourcePath(path) || exception, `Protected input must not be read: ${path}`);
    return exception;
  }
  const directories = new PinnedDirectories();
  function visit(directory, prefix = '') {
    for (const name of fs.readdirSync(directory.access).sort()) {
      const path = prefix ? `${prefix}/${name}` : name;
      if ((staged && modulePath(path)) || (installed && path === 'node_modules')) continue;
      const exception = checkPath(path);
      const info = fs.lstatSync(directories.entry(directory, name));
      assert.ok(!info.isSymbolicLink(), `Symlink input rejected: ${path}`);
      if (exception) assert.ok(info.isFile(), `Installed public module must be a regular file: ${path}`);
      if (info.isDirectory()) visit(directories.open(join(directory.path, name)), path);
      else assert.ok(info.isFile(), `Non-regular input rejected: ${path}`);
    }
    directories.verify(directory);
  }
  try { visit(directories.open(root)); }
  finally { directories.close(); }
  if (!staged && !installed) return readTree(root, { jsonOnly: false });
  const files = [];
  const pinned = new PinnedDirectories();
  let bytes = 0;
  function read(directory, prefix = '') {
    for (const name of fs.readdirSync(directory.access).sort()) {
      const path = prefix ? `${prefix}/${name}` : name;
      if ((staged && modulePath(path)) || (installed && path === 'node_modules')) continue;
      const exception = checkPath(path);
      const info = fs.lstatSync(pinned.entry(directory, name));
      assert.ok(!info.isSymbolicLink(), `Symlink input rejected: ${path}`);
      if (exception) assert.ok(info.isFile(), `Installed public module must be a regular file: ${path}`);
      if (info.isDirectory()) read(pinned.open(join(directory.path, name)), path);
      else {
        const data = readPinnedFile(pinned, directory, name, info).data;
        bytes += data.length;
        assert.ok(bytes <= 256 * 1024 * 1024, 'Input tree too large');
        files.push({ path, bytes: data.length, sha256: hash(data), data });
      }
    }
    pinned.verify(directory);
  }
  try { read(pinned.open(root)); }
  finally { pinned.close(); }
  files.sort((a, b) => a.path.localeCompare(b.path));
  const entries = files.map(({ path, bytes: size, sha256 }) => ({ path, bytes: size, sha256 }));
  return { contents: files, entries, ...fingerprint(entries) };
}

export function verifyNativeCliFetchReport({
  workspace = workspaceDefault, fetchReport, version, pins = CLI_SOURCE_RELEASES,
} = {}) {
  workspace = resolve(workspace);
  assert.ok(CLI_SOURCE_RELEASES.some(pin => pin.version === version), 'Unsupported exact CLI version');
  const pin = pins.find(item => item.version === version);
  assert.ok(pin, 'Missing release pin');
  const reportPath = fixedReportPath(workspace, fetchReport, 'native-cli-source-fetch');
  const destination = dirname(reportPath);
  const directories = new PinnedDirectories();
  try {
    const reportBytes = readFile(directories, reportPath);
    assert.equal(readFile(directories, join(destination, 'report.sha256')).toString().trim(),
      hash(reportBytes), 'Fetch report hash mismatch');
    const report = JSON.parse(reportBytes);
    assert.equal(report.schemaVersion, 1, 'Unsupported fetch report schema');
    assert.equal(report.contract, 'public-pinned-native-cli-source-fetch', 'Unexpected fetch contract');
    assert.equal(report.repository, CLI_SOURCE_API, 'Unexpected source repository');
    assert.equal(report.destination, destination, 'Fetch destination mismatch');
    assert.ok(['source-acquired-not-built-not-accepted',
      'source-acquired-with-protected-exclusions-not-built-not-accepted'].includes(report.status),
    'Fetch did not complete');
    assert.equal(report.exitCode, 2, 'Fetch did not complete');
    assert.deepEqual(report.errors, [], 'Fetch contains errors');
    assert.equal(report.buildsExecuted, false, 'Fetch source must not have been built');
    assert.equal(report.installsExecuted, false, 'Fetch source must not have been installed');
    assert.ok(Array.isArray(report.releases) && report.releases.length > 0 &&
      new Set(report.releases.map(item => item.version)).size === report.releases.length,
    'Invalid fetched release set');
    assert.ok(Array.isArray(report.requests) && Array.isArray(report.blobs), 'Missing raw evidence');
    for (const field of ['cachedMetadata', 'cachedBlobRequests', 'cacheMisses']) {
      assert.ok(report[field] === undefined || Array.isArray(report[field]), `Invalid ${field} evidence`);
    }
    const cachedBlobRequests = report.cachedBlobRequests ?? [];
    const cachedCaptures = new Set(cachedBlobRequests);
    const blobCaptures = [...report.requests, ...cachedBlobRequests];
    const records = [...blobCaptures, ...(report.cachedMetadata ?? [])];
    const evidence = new Map();
    function capturedBytes(record, raw, pattern) {
      assert.ok(typeof raw === 'string' && pattern.test(raw), 'Unexpected raw evidence path');
      const bytes = readFile(directories, join(destination, raw));
      assert.equal(bytes.length, record.bytes, 'Raw evidence size mismatch');
      assert.equal(hash(bytes), record.sha256, 'Raw evidence hash mismatch');
      evidence.set(raw, { path: raw, bytes: bytes.length, sha256: hash(bytes) });
      return bytes;
    }
    function request(label, route) {
      const matches = records.filter(item => item.label === label &&
        item.status === 200 && !item.error && !item.partial);
      assert.equal(matches.length, 1, `Missing or ambiguous raw evidence: ${label}`);
      const record = matches[0];
      assert.equal(record.url, `${CLI_SOURCE_API}${route}`, `Raw endpoint mismatch: ${label}`);
      assert.equal(record.rawFormat ?? 'json', 'json', 'Metadata evidence must be JSON');
      const bytes = capturedBytes(record, record.raw,
        new RegExp(`^evidence/${label}-(?:attempt-[1-5]|cache)\\.response\\.json$`));
      return JSON.parse(bytes);
    }
    const repository = request('repository', '');
    assert.ok(repository.public === true && repository.private === false, 'Repository is not public');
    const trees = new Map();
    const protectedShas = new Set();
    for (const release of report.releases) {
      const expected = pins.find(item => item.version === release.version);
      assert.ok(expected, 'Unpinned fetched release');
      assert.equal(release.commit, expected.commit, 'Pinned commit mismatch');
      assert.equal(release.tree, expected.tree, 'Pinned tree mismatch');
      const commit = request(`commit-${release.version}`, `/commits/${expected.commit}`);
      assert.equal(commit.sha, expected.commit, 'Commit SHA mismatch');
      assert.equal(commit.commit?.tree?.sha, expected.tree, 'Commit tree mismatch');
      const tree = verifySourceTree(request(`tree-${release.version}`,
        `/git/trees/${expected.tree}?recursive=1`), expected.tree);
      trees.set(release.version, tree);
      for (const entry of tree.filter(item => item.type === 'blob' && protectedSourcePath(item.path))) {
        protectedShas.add(entry.sha);
      }
    }
    // A shared protected blob must not be read through another release or filename.
    for (const record of report.blobs) {
      assert.ok(!protectedShas.has(record.sha), 'Protected blob evidence rejected');
    }
    function pinnedRawSource(url, sha, sourcePath) {
      for (const release of report.releases) {
        for (const entry of trees.get(release.version)) {
          if (entry.type !== 'blob' || entry.sha !== sha || protectedShas.has(sha)) continue;
          if (sourcePath != null && sourcePath !== entry.path) continue;
          if (url === publicRawUrl(release.commit, entry.path)) return entry;
        }
      }
      assert.fail('Public raw endpoint differs from pinned source tree');
    }
    for (const record of records) {
      assert.ok(record && typeof record === 'object' && !Array.isArray(record), 'Invalid raw evidence record');
      assert.match(record.label, /^(?:repository|(?:commit|tree)-0\.3\.(?:0|23|30)|blob-[a-f0-9]{40})$/,
        'Unexpected raw evidence label');
      const sha = /^blob-([a-f0-9]{40})$/.exec(record.label)?.[1];
      assert.ok(!protectedShas.has(sha), 'Protected raw blob evidence rejected');
      const format = record.rawFormat ?? (sha &&
        record.url.startsWith('https://gitee.com/iBizModeling/ibiz-template-cli/raw/') ? 'bytes' : 'json');
      assert.ok(['json', 'bytes'].includes(format), 'Unknown raw evidence format');
      if (cachedCaptures.has(record)) {
        assert.ok(sha, 'Cached blob HTTP evidence must describe a blob');
        assert.equal(record.status, 200, 'Cached blob HTTP capture did not succeed');
        assert.ok(!record.error && !record.partial, 'Incomplete cached blob HTTP capture');
        assert.ok(Number.isInteger(record.attempt) && record.attempt >= 1 && record.attempt <= 5,
          'Invalid cached blob HTTP attempt');
        assert.equal(record.raw,
          `evidence/${record.label}-cache.response.${format === 'bytes' ? 'bin' : 'json'}`,
          'Cached blob HTTP evidence kind mismatch');
        assert.ok(typeof record.cacheSource === 'string' &&
          dirname(record.cacheSource) === join(workspace, '.artifacts/native-cli-source-fetch') &&
          record.cacheSource !== destination, 'Invalid cached blob HTTP cache source');
        assert.match(record.cacheReportSha256 ?? '', /^[a-f0-9]{64}$/,
          'Invalid cached blob HTTP cache report hash');
        assert.ok(typeof record.capturedAt === 'string' && record.capturedAt.length > 0,
          'Missing cached blob HTTP capture time');
        assert.equal(record.capturedAt, record.startedAt, 'Cached blob HTTP capture time mismatch');
        const blob = report.blobs.find(item => item.sha === sha);
        assert.ok(blob, 'Cached blob HTTP evidence lacks a blob');
        assert.equal(record.cacheSource, blob.cacheSource, 'Cached blob HTTP cache source mismatch');
      }
      if (sha) {
        if (format === 'bytes') pinnedRawSource(record.url, sha);
        else assert.equal(record.url, `${CLI_SOURCE_API}/git/blobs/${sha}`, 'Raw blob endpoint mismatch');
      } else {
        assert.equal(format, 'json', 'Metadata evidence must be JSON');
        const release = report.releases.find(item =>
          record.label === `commit-${item.version}` || record.label === `tree-${item.version}`);
        const expected = record.label === 'repository' ? CLI_SOURCE_API :
          record.label.startsWith('commit-') ? `${CLI_SOURCE_API}/commits/${release?.commit}` :
            `${CLI_SOURCE_API}/git/trees/${release?.tree}?recursive=1`;
        assert.equal(record.url, expected, 'Raw metadata endpoint mismatch');
      }
      if (record.initialResponse) {
        assert.ok(sha && format === 'bytes', 'Unexpected metadata redirect');
        const initial = record.initialResponse;
        if (cachedCaptures.has(record)) {
          assert.ok(!initial.error && !initial.partial, 'Incomplete cached raw redirect evidence');
          assert.ok(typeof initial.location === 'string' && initial.location.length > 0,
            'Missing cached public raw redirect location');
          assert.equal(initial.raw,
            `evidence/${record.label}-attempt-${record.attempt}.redirect.response.bin`,
            'Cached raw redirect evidence kind mismatch');
        }
        assert.equal(initial.url, record.url, 'Initial raw endpoint mismatch');
        assert.ok([301, 302, 307, 308].includes(initial.status), 'Invalid public raw redirect status');
        assert.equal(record.finalUrl, validateRawRedirect(initial.location, record.url),
          'Final public raw endpoint mismatch');
        capturedBytes(initial, initial.raw,
          new RegExp(`^evidence/${record.label}-attempt-[1-5]\\.redirect\\.response\\.bin$`));
      } else assert.ok(!record.finalUrl, 'Unbound public raw redirect');
      if (!record.raw) continue;
      capturedBytes(record, record.raw,
        new RegExp(`^evidence/${record.label}-(?:attempt-[1-5]|cache)\\.response\\.${format === 'bytes' ? 'bin' : 'json'}$`));
    }
    const release = report.releases.find(item => item.version === version);
    assert.ok(release, 'Exact release not fetched');
    const original = join(destination, 'source', version);
    assert.equal(release.sourceDirectory, original, 'Original source directory mismatch');
    assert.equal(release.receipt, join(destination, 'receipts', `${version}.json`),
      'Fetch receipt path mismatch');
    const receiptBytes = readFile(directories, release.receipt);
    assert.equal(hash(receiptBytes), release.receiptSha256, 'Fetch receipt hash mismatch');
    const receipt = JSON.parse(receiptBytes);
    assert.equal(receipt.schemaVersion, 1, 'Unsupported fetch receipt schema');
    assert.equal(receipt.repository, CLI_SOURCE_API, 'Receipt repository mismatch');
    for (const key of ['version', 'commit', 'tree']) {
      assert.equal(receipt[key], pin[key], `Receipt ${key} mismatch`);
    }
    assert.equal(receipt.sourceDirectory, original, 'Receipt source directory mismatch');
    const entries = trees.get(version).filter(item => item.type === 'blob');
    const exclusions = entries.filter(item => protectedShas.has(item.sha)).map(item => ({
      path: item.path, sha: item.sha, bytes: item.size, mode: item.mode,
      reason: protectedSourcePath(item.path) ? 'protected-path-not-read' : 'shared-protected-blob-not-read',
    }));
    assert.deepEqual(receipt.exclusions, exclusions, 'Protected exclusions mismatch');
    assert.deepEqual(release.exclusions, exclusions, 'Release exclusions mismatch');
    const complete = exclusions.length === 0;
    assert.equal(receipt.sourceComplete, complete, 'Whole sourceComplete overclaim');
    assert.equal(release.sourceComplete, complete, 'Whole sourceComplete overclaim');
    assert.equal(release.status, complete ? 'source-acquired' : 'source-acquired-with-protected-exclusions',
      'Selected release acquisition incomplete');
    const files = entries.filter(item => !protectedShas.has(item.sha));
    assert.ok(new Set(report.blobs.map(item => item.sha)).size === report.blobs.length,
      'Duplicate blob evidence');
    const inventory = checkedTree(original);
    const expectedFiles = files.map(entry => {
      const file = inventory.contents.find(item => item.path === entry.path);
      assert.ok(file, `Missing original Git blob: ${entry.path}`);
      assert.equal(file.bytes, entry.size, `Original blob size mismatch: ${entry.path}`);
      assert.equal(gitObjectHash('blob', file.data), entry.sha,
        `Original Git blob mismatch: ${entry.path}`);
      assert.equal(fs.lstatSync(join(original, entry.path)).mode & 0o111,
        entry.mode === '100755' ? 0o111 : 0, `Original Git executable mode mismatch: ${entry.path}`);
      const record = report.blobs.find(item => item.sha === entry.sha);
      assert.ok(record && record.verifiedGitBlob === true, `Missing blob evidence: ${entry.path}`);
      assert.equal(record.cached, `blobs/${entry.sha}.bin`, 'Unexpected blob cache path');
      const cached = readFile(directories, join(destination, record.cached));
      assert.deepEqual(cached, file.data, `Cached blob mismatch: ${entry.path}`);
      assert.equal(record.bytes, file.bytes, 'Cached blob size mismatch');
      assert.equal(record.sha256, file.sha256, 'Cached blob hash mismatch');
      const captures = blobCaptures.filter(item => item.label === `blob-${entry.sha}` &&
        item.status === 200 && !item.error && !item.partial);
      assert.ok(captures.length <= 1, 'Ambiguous successful raw blob capture');
      const captured = captures[0];
      const format = record.rawFormat ?? 'json';
      assert.ok(['json', 'bytes'].includes(format), 'Unknown raw blob format');
      assert.equal(record.transport ?? 'blob-api', format === 'bytes' ? 'public-raw' : 'blob-api',
        'Raw blob transport/format mismatch');
      if (format === 'bytes') {
        assert.equal(pinnedRawSource(record.sourceUrl, entry.sha, record.sourcePath).size,
          entry.size, 'Public raw source size mismatch');
        assert.ok(typeof record.sourcePath === 'string', 'Missing public raw source path');
      }
      const raw = record.raw ?? captured?.raw;
      assert.ok(typeof raw === 'string' && new RegExp(
        `^evidence/blob-${entry.sha}-(?:attempt-[1-5]|cache)\\.response\\.${format === 'bytes' ? 'bin' : 'json'}$`).test(raw),
      'Missing or invalid raw blob evidence');
      const bytes = readFile(directories, join(destination, raw));
      assert.equal(hash(bytes), record.rawSha256 ?? captured?.sha256, 'Raw blob evidence hash mismatch');
      if (report.cachedBlobRequests !== undefined && /-cache\.response\./.test(raw)) {
        assert.ok(captured && cachedCaptures.has(captured), 'Missing cached blob HTTP provenance');
      }
      if (captured) {
        assert.equal(captured.url, format === 'bytes' ? record.sourceUrl :
          `${CLI_SOURCE_API}/git/blobs/${entry.sha}`, 'Raw blob capture endpoint mismatch');
        assert.equal(captured.raw, raw, 'Raw blob capture path mismatch');
        assert.equal(captured.rawFormat ?? 'json', format, 'Raw blob capture format mismatch');
        assert.equal(captured.sha256, hash(bytes), 'Raw blob capture hash mismatch');
      } else assert.ok(/-cache\.response\./.test(raw), 'Missing raw blob request');
      if (format === 'bytes') {
        assert.equal(bytes.length, entry.size, 'Raw blob size differs from tree');
        assert.equal(gitObjectHash('blob', bytes), entry.sha, 'Raw Git blob hash mismatch');
        assert.deepEqual(bytes, file.data, 'Raw blob differs from original');
      } else {
        assert.deepEqual(verifySourceBlob(JSON.parse(bytes), entry.sha, entry.size), file.data,
          'Raw blob differs from original');
      }
      evidence.set(raw, { path: raw, bytes: bytes.length, sha256: hash(bytes) });
      return { path: entry.path, bytes: file.bytes, sha256: file.sha256,
        gitBlob: entry.sha, mode: entry.mode };
    }).sort((a, b) => a.path.localeCompare(b.path));
    assert.deepEqual(inventory.entries, expectedFiles.map(({ path, bytes, sha256 }) =>
      ({ path, bytes, sha256 })), 'Original source inventory mismatch');
    assert.deepEqual(receipt.files, expectedFiles, 'Receipt file inventory mismatch');
    for (const owner of [receipt, release]) {
      assert.equal(owner.originalFiles, entries.length, 'Original file count mismatch');
      assert.equal(owner.materializedFiles, files.length, 'Materialized file count mismatch');
      assert.equal(owner.sourceFingerprint, inventory.fingerprint, 'Source fingerprint mismatch');
      assert.equal(owner.sourceBytes, inventory.bytes, 'Source byte count mismatch');
    }
    assert.equal(receipt.recursiveTreeVerified, true, 'Missing tree verification');
    assert.equal(receipt.allMaterializedGitBlobsVerified, true, 'Missing blob verification');
    const required = ['LICENSE', 'package.json', 'tsconfig.json', '.eslintrc.js',
      'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'packages/core/package.json',
      'packages/core/tsconfig.json', 'packages/core/src/index.ts', 'packages/core/src/build/build.ts',
      'packages/cli/package.json', 'packages/cli/tsconfig.json', 'packages/cli/src/index.ts',
      'packages/cli/src/bin.ts', 'packages/cli/src/exports.ts'];
    for (const path of required) {
      assert.ok(inventory.entries.some(item => item.path === path && item.bytes > 0),
        `Missing original build input: ${path}`);
    }
    const manifests = {};
    for (const [id, path] of [['root', ''], ...specs.map(item => [item.id, item.path])]) {
      manifests[id] = JSON.parse(inventory.contents.find(item =>
        item.path === posix.join(path, 'package.json')).data);
    }
    for (const spec of specs) {
      const value = manifests[spec.id];
      assert.equal(value.name, spec.name, 'Original package identity mismatch');
      assert.equal(value.version, version, 'Original package version mismatch');
      assert.equal(value.main, spec.required[0], 'Unsupported main entry');
      assert.equal(value.types, spec.required[1], 'Unsupported types entry');
    }
    assert.equal(manifests.cli.bin?.['ibiz-temp'], 'dist/bin.js', 'Unsupported CLI bin entry');
    assert.equal(manifests.cli.dependencies?.['@ibiz-template/cli-core'], 'workspace:*',
      'Original CLI/core dependency mismatch');
    assert.deepEqual(readFile(directories, reportPath), reportBytes, 'Fetch report drift');
    return {
      reportPath, reportSha256: hash(reportBytes), receiptSha256: hash(receiptBytes),
      version, commit: pin.commit, tree: pin.tree, original, sourceComplete: complete,
      exclusions, ...fingerprint(inventory.entries), files: expectedFiles, manifests,
      rawEvidence: [...evidence.values()].sort((a, b) => a.path.localeCompare(b.path)),
      productionPinsVerified: pins === CLI_SOURCE_RELEASES ||
        JSON.stringify(pins) === JSON.stringify(CLI_SOURCE_RELEASES),
      contents: inventory.contents,
    };
  } finally { directories.close(); }
}

function sourceEvidence(source) {
  const { contents, manifests, ...evidence } = source;
  return evidence;
}

function declarations(value, { dev = false } = {}) {
  return ['dependencies', 'optionalDependencies', 'peerDependencies',
    ...(dev ? ['devDependencies'] : [])].flatMap(section =>
    Object.entries(value[section] ?? {}).map(([name, range]) => ({
      name, range, section,
      optional: Object.hasOwn(value.optionalDependencies ?? {}, name) ||
        (section === 'peerDependencies' && value.peerDependenciesMeta?.[name]?.optional === true),
    })));
}

function licenseDeclarations(value) {
  const result = [];
  function descriptor(entry, field) {
    let id = entry;
    if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
      assert.ok(Object.keys(entry).every(key => ['type', 'url'].includes(key)) &&
        typeof entry.type === 'string', `Invalid legacy license descriptor: ${value.name}`);
      if (entry.url !== undefined) {
        assert.ok(typeof entry.url === 'string', `Invalid legacy license URL: ${value.name}`);
        const url = new URL(entry.url);
        assert.ok(['http:', 'https:'].includes(url.protocol) && !url.username && !url.password,
          `Invalid legacy license URL: ${value.name}`);
      }
      id = entry.type;
    }
    assert.ok(typeof id === 'string' && id.length > 0 && id === id.trim(),
      `Invalid license declaration: ${value.name}`);
    result.push({ field, id });
  }
  if (value.license !== undefined && value.license !== null) descriptor(value.license, 'license');
  if (value.licenses !== undefined && value.licenses !== null) {
    assert.ok(Array.isArray(value.licenses) && value.licenses.length > 0 && value.licenses.length <= 16,
      `Invalid legacy licenses array: ${value.name}`);
    for (const entry of value.licenses) descriptor(entry, 'licenses');
  }
  assert.ok(result.length > 0, `Unverified open-source license: ${value.name}`);
  return result;
}

function thirdPartyLicensePolicy(value, directories, realpath) {
  const declared = licenseDeclarations(value);
  if (declared.every(item => openLicenses.has(item.id))) {
    if (typeof value.license === 'string' && value.licenses == null) {
      return { id: 'explicit-spdx-allowlist' };
    }
    return { id: 'structured-legacy-license-allowlist', declarations: declared };
  }
  // Package-specific data reuse, not a general CC software-license exception.
  if (value.name === 'caniuse-lite' && declared.every(item => item.id === 'CC-BY-4.0')) {
    const path = join(realpath, 'LICENSE');
    assert.ok(optionalStat(path), 'Missing CC-BY-4.0 license evidence: caniuse-lite');
    const bytes = readFile(directories, path);
    assert.match(bytes.toString(), /^Attribution 4\.0 International\r?\n/,
      'Unverified CC-BY-4.0 license evidence: caniuse-lite');
    assert.ok(bytes.includes(Buffer.from(
      'Creative Commons Attribution 4.0 International Public License')),
    'Unverified CC-BY-4.0 license evidence: caniuse-lite');
    return {
      id: 'caniuse-lite-cc-by-4.0-data-reuse', scope: 'installed-third-party-data-reuse',
      licenseFile: 'LICENSE', licenseSha256: hash(bytes),
      attributionAndLicenseRetentionRequired: true, redistributionComplianceVerified: false,
    };
  }
  if (value.name === 'spdx-exceptions' && ['2.3.0', '2.5.0'].includes(value.version) &&
    declared.every(item => item.id === 'CC-BY-3.0')) {
    const path = join(realpath, 'README.md');
    assert.ok(optionalStat(path), 'Missing CC-BY-3.0 license evidence: spdx-exceptions');
    const bytes = readFile(directories, path);
    assert.ok(bytes.includes(Buffer.from('Creative Commons Attribution License 3.0 Unported')) &&
      bytes.includes(Buffer.from('The Linux Foundation')),
    'Unverified CC-BY-3.0 license evidence: spdx-exceptions');
    const data = JSON.parse(readFile(directories, join(realpath, 'index.json')));
    assert.ok(Array.isArray(data) && data.length > 0 && data.every(item =>
      typeof item === 'string' && /^[A-Za-z0-9][A-Za-z0-9.+-]*$/.test(item)),
    'Unverified spdx-exceptions data inventory');
    return {
      id: 'spdx-exceptions-cc-by-3.0-data-reuse', scope: 'installed-third-party-data-reuse',
      licenseFile: 'README.md', licenseSha256: hash(bytes),
      attributionAndLicenseRetentionRequired: true, redistributionComplianceVerified: false,
    };
  }
  assert.fail(`Unverified open-source license: ${value.name}`);
}

function dependencyPlan(workspace, owners, source, stage, supplemental = []) {
  assert.ok(owners && Object.keys(owners).sort().join(',') === 'cli,core,root',
    'Explicit third-party owners root/core/cli are required');
  assert.ok(Array.isArray(supplemental), 'Supplemental dependencyOwners must be an array');
  const directories = new PinnedDirectories();
  const packages = new Map();
  const links = new Map();
  const aliases = new Map();
  const aliasTools = [];
  let aliasToolkit;
  let loadingAliasToolkit = false;
  let dependencyOwners = [];
  const unavailablePackages = [];
  const omittedDevDependencies = [];
  const thirdPartyOwners = {};
  const ownerManifests = new Map();
  function ownerPath(path) {
    assert.ok(typeof path === 'string' && path, 'Explicit third-party owner directory required');
    path = resolve(workspace, path);
    assert.ok(inside(workspace, path) && !inside(join(workspace, '.artifacts'), path),
      'Third-party owner must be inside workspace outside artifacts');
    directories.open(path);
    const bytes = readFile(directories, join(path, 'package.json'));
    const value = JSON.parse(bytes);
    // An installed own package is only a resolver context. Never inspect its outputs.
    ownerManifests.set(path, { path, name: value.name, sha256: hash(bytes),
      resolverOnly: true, compiledOwnFilesRead: false });
    return path;
  }
  function installedPath(lookupOwners, name, { parser = false } = {}) {
    const roots = lookupOwners.flatMap(owner =>
      createRequire(join(owner, 'package.json')).resolve.paths('__native_cli_npm_lookup__'))
      .filter(root => inside(workspace, root));
    return [...roots, ...(parser ? roots.map(root => join(root, '.pnpm/node_modules')) : [])]
      .map(root => join(root, name, 'package.json'))
      .find(candidate => fs.existsSync(candidate));
  }
  function loadAliasToolkit(lookupOwners) {
    if (aliasToolkit) return aliasToolkit;
    assert.ok(!loadingAliasToolkit, 'Cyclic npm alias parser dependency');
    loadingAliasToolkit = true;
    const contexts = [...new Set([...lookupOwners, ...Object.values(thirdPartyOwners).flat(),
      ...dependencyOwners])];
    const path = installedPath(contexts, 'npm-package-arg', { parser: true });
    assert.ok(path, 'Installed npm-package-arg required to audit an npm alias');
    const parser = auditPackage(fs.realpathSync(dirname(path)), 'npm-package-arg');
    const semverPath = installedPath([parser.realpath], 'semver');
    assert.ok(semverPath, 'Installed semver required to audit an npm alias');
    const semver = auditPackage(fs.realpathSync(dirname(semverPath)), 'semver');
    function load(pkg) {
      const req = createRequire(join(pkg.realpath, 'package.json'));
      const entry = req.resolve(pkg.realpath);
      assert.ok(inside(pkg.realpath, entry), 'Alias audit tool entry escapes package');
      const bytes = readFile(directories, entry);
      aliasTools.push({ name: pkg.name, version: pkg.version, realpath: pkg.realpath,
        entry, entrySha256: hash(bytes), sourceVerified: false });
      return req(entry);
    }
    aliasToolkit = { parser: load(parser), semver: load(semver) };
    loadingAliasToolkit = false;
    return aliasToolkit;
  }
  function lookup(lookupOwners, item) {
    assert.match(item.name, packageName, 'Invalid dependency name');
    assert.ok(!framework(item.name), `Published own/framework dependency rejected: ${item.name}`);
    assert.ok(typeof item.range === 'string', 'Invalid dependency range');
    let alias;
    if (item.range.startsWith('npm:')) {
      const toolkit = loadAliasToolkit(lookupOwners);
      const parsed = toolkit.parser.resolve(item.name, item.range, lookupOwners[0]);
      assert.ok(parsed.type === 'alias' && parsed.subSpec?.registry === true &&
        ['range', 'version'].includes(parsed.subSpec.type), `Unsupported npm alias: ${item.name}`);
      assert.match(parsed.subSpec.name, packageName, 'Invalid npm alias target name');
      assert.ok(!framework(parsed.subSpec.name),
        `Published own/framework alias target rejected: ${parsed.subSpec.name}`);
      assert.ok(toolkit.semver.validRange(parsed.subSpec.rawSpec), `Invalid npm alias range: ${item.name}`);
      alias = { owner: lookupOwners[0], name: item.name, section: item.section,
        declaration: item.range, actualName: parsed.subSpec.name, targetRange: parsed.subSpec.rawSpec };
    }
    const path = installedPath(lookupOwners, item.name);
    if (!path) {
      unavailablePackages.push({ owner: lookupOwners[0], ...item });
      assert.ok(item.optional, `Required dependency unavailable: ${lookupOwners[0]} -> ${item.name}`);
      return null;
    }
    const realpath = fs.realpathSync(dirname(path));
    const pkg = auditPackage(realpath, alias?.actualName ?? item.name);
    if (alias) {
      assert.ok(aliasToolkit.semver.valid(pkg.version) &&
        aliasToolkit.semver.satisfies(pkg.version, alias.targetRange),
      `Npm alias installed version outside declared range: ${item.name}`);
      const record = { ...alias, realpath, version: pkg.version, targetRangeVerified: true };
      aliases.set(JSON.stringify([alias.owner, alias.name, alias.section, alias.declaration]), record);
    }
    return pkg;
  }
  function auditPackage(realpath, expectedName) {
    assert.ok(inside(workspace, realpath) && !inside(join(workspace, '.artifacts'), realpath),
      'Installed package must be inside workspace outside artifacts');
    directories.open(realpath);
    const value = JSON.parse(readFile(directories, join(realpath, 'package.json')));
    assert.ok(!framework(value.name), `Published own/framework package rejected: ${value.name}`);
    assert.equal(value.name, expectedName, `Installed package identity mismatch: ${expectedName}`);
    const licensePolicy = thirdPartyLicensePolicy(value, directories, realpath);
    if (packages.has(realpath)) return packages.get(realpath);
    const inventory = checkedTree(realpath, { installed: true, packageIdentity: value });
    const pkg = { name: value.name, version: value.version, realpath, license: value.license ?? null, licensePolicy,
      entries: inventory.entries, ...fingerprint(inventory.entries), sourceVerified: false,
      manifest: value };
    packages.set(realpath, pkg);
    // Transitives must resolve from the real installed package itself, as Node does.
    for (const declaration of declarations(value)) lookup([realpath], declaration);
    return pkg;
  }
  try {
    dependencyOwners = [...new Set(supplemental.map(ownerPath))];
    for (const id of ['root', 'core', 'cli']) {
      const paths = Array.isArray(owners[id]) ? owners[id] : [owners[id]];
      assert.ok(paths.length > 0, `Missing third-party owner: ${id}`);
      thirdPartyOwners[id] = [...new Set(paths.map(ownerPath))];
    }
    for (const id of ['root', 'core', 'cli']) {
      const cwd = id === 'root' ? stage : join(stage, 'packages', id);
      for (const item of declarations(source.manifests[id], { dev: true })) {
        if (id === 'cli' && item.name === '@ibiz-template/cli-core') {
          links.set(join(cwd, 'node_modules', item.name), {
            path: join(cwd, 'node_modules', item.name), target: join(stage, 'packages/core'),
            name: item.name, owner: id, kind: 'source-built-own',
          });
          continue;
        }
        const buildDev = id !== 'root' ? item.name !== 'cpx' || source.version !== '0.3.0' :
          /^(?:typescript|eslint(?:-|$)|prettier$|@types\/|@typescript-eslint\/)/.test(item.name);
        if (item.section === 'devDependencies' && !buildDev) {
          omittedDevDependencies.push({ owner: id, ...item, reason: 'not-in-build-command-plan' });
          continue;
        }
        const pkg = lookup([...new Set([...thirdPartyOwners[id], ...dependencyOwners])], item);
        if (pkg) links.set(join(cwd, 'node_modules', item.name), {
          path: join(cwd, 'node_modules', item.name), target: pkg.realpath,
          name: item.name, owner: id, kind: 'installed-third-party',
        });
      }
    }
    const tools = [];
    for (const [id, name, bin] of [
      ['root', 'typescript', 'tsc'], ['core', 'eslint', 'eslint'], ['cli', 'eslint', 'eslint'],
      ...(source.version === '0.3.0' ? [] : [['core', 'cpx', 'cpx']]),
    ]) {
      const cwd = id === 'root' ? stage : join(stage, 'packages', id);
      const mapping = links.get(join(cwd, 'node_modules', name)) ??
        links.get(join(stage, 'node_modules', name));
      assert.ok(mapping, `Explicit installed build tool unavailable: ${name} (${id})`);
      const pkg = packages.get(mapping.target);
      const entryName = typeof pkg.manifest.bin === 'string' ?
        pkg.manifest.bin : pkg.manifest.bin?.[bin];
      assert.ok(typeof entryName === 'string', `Missing explicit tool entry: ${name}`);
      validateSourcePath(entryName.replace(/^\.\//, ''));
      const entry = resolve(pkg.realpath, entryName);
      assert.ok(inside(pkg.realpath, entry), 'Tool entry escapes package');
      const data = readFile(directories, entry);
      tools.push({ owner: id, name, version: pkg.version, realpath: pkg.realpath,
        entry, entrySha256: hash(data), sourceVerified: false });
    }
    return {
      thirdPartyOwners, dependencyOwners,
      ownerManifests: [...ownerManifests.values()].sort((a, b) => a.path.localeCompare(b.path)),
      aliases: [...aliases.values()].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
      aliasTools: aliasTools.sort((a, b) => a.name.localeCompare(b.name)),
      links: [...links.values()].sort((a, b) => a.path.localeCompare(b.path)),
      packages: [...packages.values()].map(({ manifest, ...pkg }) => pkg)
        .sort((a, b) => a.realpath.localeCompare(b.realpath)),
      tools, unavailablePackages, omittedDevDependencies,
      declaredRangeCompatibility: 'non-alias-not-verified; npm-alias-target-range-verified',
      aliasSupport: 'explicit-npm-registry-alias-only',
    };
  } finally { directories.close(); }
}

function commandPlan(source, dependencies, stage) {
  const tool = (owner, name) => {
    const value = dependencies.tools.find(item => item.owner === owner && item.name === name);
    assert.ok(value, `Missing build tool: ${owner}/${name}`);
    return value.entry;
  };
  const commands = [];
  for (const spec of specs) {
    const scripts = source.manifests[spec.id].scripts;
    const templates = spec.id === 'core' && source.version !== '0.3.0';
    assert.equal(scripts?.build, templates ?
      'npm run sync:plugin && npm run lint && tsc --build' : 'npm run lint && tsc --build',
    `Unsupported original build script: ${spec.id}`);
    assert.equal(scripts.lint, templates ?
      "eslint 'src/**/*.ts' --ignore-pattern 'src/create-plugin/template/**'" : "eslint 'src/**/*.ts'",
    `Unsupported original lint script: ${spec.id}`);
    const cwd = join(stage, spec.path);
    if (templates) {
      assert.equal(scripts['sync:plugin'], (source.version === '0.3.30' ?
        'rm -rf dist/template && ' : '') + "cpx 'src/create-plugin/template/**/*' 'dist/template'",
      'Unsupported original template script');
      assert.ok(source.files.some(item => item.path.startsWith('packages/core/src/create-plugin/template/')),
        'Original template inputs missing');
      // The original rm is a no-op in a fresh context; never delete shared outputs.
      commands.push({ id: 'core-template', owner: spec.id, cwd,
        entry: tool('core', 'cpx'), args: ['src/create-plugin/template/**/*', 'dist/template'] });
    }
    commands.push({ id: `${spec.id}-lint`, owner: spec.id, cwd, entry: tool(spec.id, 'eslint'),
      args: ['src/**/*.ts', ...(templates ? ['--ignore-pattern', 'src/create-plugin/template/**'] : [])] });
    commands.push({ id: `${spec.id}-tsc`, owner: spec.id, cwd,
      entry: tool('root', 'typescript'), args: ['--build'] });
  }
  commands.push({ id: 'cli-help', owner: 'cli', cwd: join(stage, 'packages/cli'),
    entry: join(stage, 'packages/cli/dist/bin.js'), args: ['--help'] });
  return commands;
}

function verifyLinks(dependencies, stage) {
  for (const id of ['root', 'core', 'cli']) {
    const root = join(id === 'root' ? stage : join(stage, 'packages', id), 'node_modules');
    const expected = dependencies.links.filter(item => item.owner === id);
    const actual = [];
    if (optionalStat(root)) {
      const directories = new PinnedDirectories();
      try {
        const directory = directories.open(root);
        for (const name of fs.readdirSync(directory.access).sort()) {
          if (name.startsWith('@')) {
            const scope = directories.open(join(root, name));
            for (const child of fs.readdirSync(scope.access).sort()) actual.push(`${name}/${child}`);
          } else actual.push(name);
        }
      } finally { directories.close(); }
    }
    assert.deepEqual(actual.sort(), expected.map(item => item.name).sort(), 'Module link inventory changed');
    for (const item of expected) {
      assert.ok(optionalStat(item.path)?.isSymbolicLink(), `Module link missing: ${item.name}`);
      assert.equal(fs.readlinkSync(item.path), item.target, `Published fallback/link drift: ${item.name}`);
      assert.equal(fs.realpathSync(item.path), item.target, `Module link target drift: ${item.name}`);
    }
  }
}

function inventories(stage) {
  const tree = checkedTree(stage, { staged: true });
  const inputs = tree.entries.filter(item => !outputPath(item.path));
  const outputs = tree.entries.filter(item => outputPath(item.path));
  return {
    inputs: { entries: inputs, ...fingerprint(inputs) },
    outputs: { entries: outputs, ...fingerprint(outputs) },
  };
}

function packageOutputs(inventory, id) {
  const entries = inventory.entries.filter(item => item.path.startsWith(`packages/${id}/`));
  return { entries, ...fingerprint(entries) };
}

function privateEnvironment(directories, destination) {
  const bin = directories.open(join(destination, 'bin'), { create: true });
  for (const name of ['home', 'cache', 'tmp']) directories.open(join(destination, name), { create: true });
  directories.write(bin, 'deny.cjs',
    '#!/usr/bin/env node\nconsole.error("Package managers forbidden"); process.exit(126);\n');
  fs.chmodSync(directories.entry(bin, 'deny.cjs'), 0o700);
  for (const name of ['npm', 'npx', 'pnpm', 'pnpx', 'yarn', 'yarnpkg', 'corepack', 'bun']) {
    fs.symlinkSync('deny.cjs', directories.entry(bin, name));
  }
  fs.symlinkSync(process.execPath, directories.entry(bin, 'node'));
  return {
    PATH: `${bin.path}:/usr/bin:/bin`, HOME: join(destination, 'home'),
    TMPDIR: join(destination, 'tmp'), XDG_CACHE_HOME: join(destination, 'cache'),
    LANG: 'C.UTF-8', npm_config_offline: 'true', npm_config_ignore_scripts: 'true',
    npm_config_registry: 'http://127.0.0.1:9/', COREPACK_ENABLE_NETWORK: '0',
  };
}

function assertRequiredOutputs(source, outputs, id) {
  const spec = specs.find(item => item.id === id);
  for (const path of spec.required) {
    assert.ok(outputs.entries.some(item => item.path === `${spec.path}/${path}` && item.bytes > 0),
      `Missing fresh build output: ${id}/${path}`);
  }
  if (id === 'core' && source.version !== '0.3.0') {
    const prefix = 'packages/core/src/create-plugin/template/';
    const expected = source.files.filter(item => item.path.startsWith(prefix) &&
      !item.path.slice(prefix.length).split('/').some(part => part.startsWith('.')))
      .map(({ path, bytes, sha256 }) => ({
        path: `packages/core/dist/template/${path.slice(prefix.length)}`, bytes, sha256,
      })).sort((a, b) => a.path.localeCompare(b.path));
    const actual = outputs.entries.filter(item => item.path.startsWith('packages/core/dist/template/'));
    assert.ok(expected.length > 0, 'Original template input inventory empty');
    assert.deepEqual(actual, expected, 'Template output differs from original inputs');
  }
}

function verifyInputModes(stage, source) {
  for (const item of source.files.filter(item => !excludedInput(item.path))) {
    assert.equal(fs.lstatSync(join(stage, item.path)).mode & 0o111,
      item.mode === '100755' ? 0o111 : 0, `Staged Git executable mode drift: ${item.path}`);
  }
}

export function runNativeCliSourceBuild(options = {}) {
  const workspace = resolve(options.workspace ?? workspaceDefault);
  const destination = destinationFor(workspace, options.output);
  const stage = join(destination, 'source');
  const pins = options.pins ?? CLI_SOURCE_RELEASES;
  const timeout = options.timeout ?? 600_000;
  assert.ok(Number.isSafeInteger(timeout) && timeout > 0 && timeout <= 600_000, 'Invalid command timeout');
  const directories = new PinnedDirectories();
  const report = {
    schemaVersion: 1, contract: 'native-cli-isolated-source-build',
    startedAt: new Date().toISOString(), workspace, destination, stage,
    version: options.version, status: 'failed', exitCode: 1,
    sourceBuildsCompleted: false, cliSourceBuildVerified: false, toolchainSourceBuilt: false,
    nativeAccepted: false, acceptedForProduction: false, fullLocalization: false,
    originalVersionReproductionVerified: false, dependencySourcesBuilt: false,
    node: { executable: process.execPath, version: process.version },
    trustBoundary: 'Trusted pinned sources, installed third parties and cooperative single writer; no atomic snapshot or OS/network security sandbox',
    installsExecuted: false, networkRequestsExecutedByHarness: false, arbitraryNpmScriptsExecuted: false,
    source: null, inputs: null, stagingExclusions: [], dependencies: null,
    plannedCommands: [], commands: [], completedOutputs: {}, outputs: null,
    sourceDrift: 'not-checked', outputDrift: [], errors: [],
    limitations: [
      'Installed open-source third parties are reused, not source-built; dependency ranges are not verified.',
      'Only pinned CLI/core lint, tsc, template copy and bin --help are supported, never arbitrary npm scripts.',
      'Private cwd/home/cache and package-manager guards are not a security or network sandbox.',
      'This does not establish downstream source-dependency integration or native editor acceptance.',
      'Non-production pin injection is fixture evidence only and rejected by the default verifier.',
    ],
  };
  let run;
  let source;
  let dependencies;
  function currentSource() {
    const actual = verifyNativeCliFetchReport({
      workspace, fetchReport: options.fetchReport, version: options.version, pins,
    });
    assert.deepEqual(sourceEvidence(actual), report.source, 'Original source/evidence drift');
    return actual;
  }
  function checkInputs() {
    currentSource();
    assert.deepEqual(inventories(stage).inputs, report.inputs, 'Staged source input drift');
    verifyInputModes(stage, source);
    verifyLinks(dependencies, stage);
    report.sourceDrift = 'unchanged';
  }
  function checkOutputs(phase) {
    report.outputs = inventories(stage).outputs;
    for (const [id, expected] of Object.entries(report.completedOutputs)) {
      const actual = packageOutputs(report.outputs, id);
      if (actual.fingerprint === expected.fingerprint) continue;
      report.outputDrift.push({ owner: id, phase, expected, actual });
      assert.fail(`Build output drift: ${id} (${phase})`);
    }
  }
  try {
    run = directories.open(destination, { create: true, exclusive: true });
    source = verifyNativeCliFetchReport({
      workspace, fetchReport: options.fetchReport, version: options.version, pins,
    });
    report.source = sourceEvidence(source);
    report.stagingExclusions = source.files.filter(item => excludedInput(item.path))
      .map(item => ({ ...item, reason: 'prebuilt-output-or-nonbuild-cache-not-copied' }));
    const files = source.contents.filter(item => !excludedInput(item.path));
    const entries = files.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 }));
    report.inputs = { entries, ...fingerprint(entries) };
    directories.open(stage, { create: true, exclusive: true });
    for (const file of files) {
      const directory = directories.open(join(stage, posix.dirname(file.path)), { create: true });
      const name = posix.basename(file.path);
      const identity = directories.write(directory, name, file.data);
      const descriptor = fs.openSync(directories.entry(directory, name),
        fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      try {
        const info = fs.fstatSync(descriptor);
        assert.ok(info.dev === identity.dev && info.ino === identity.ino, 'Staged input identity changed');
        const mode = source.files.find(item => item.path === file.path).mode;
        fs.fchmodSync(descriptor, mode === '100755' ? 0o755 : 0o600);
      } finally { fs.closeSync(descriptor); }
    }
    dependencies = dependencyPlan(workspace, options.thirdPartyOwners, source, stage,
      options.dependencyOwners);
    report.dependencies = dependencies;
    report.plannedCommands = commandPlan(source, dependencies, stage);
    assert.deepEqual(inventories(stage).inputs, report.inputs, 'Staged source input drift');
    assert.equal(inventories(stage).outputs.files, 0, 'Prebuilt outputs must not be staged');
    for (const item of dependencies.links) {
      const directory = directories.open(dirname(item.path), { create: true });
      fs.symlinkSync(item.target, directories.entry(directory, basename(item.path)), 'dir');
    }
    const env = privateEnvironment(directories, destination);
    const logs = directories.open(join(destination, 'logs'), { create: true });
    for (const plan of report.plannedCommands) {
      checkInputs();
      checkOutputs(`before ${plan.id}`);
      const logName = `${plan.id}.log`;
      directories.write(logs, logName, '');
      const descriptor = fs.openSync(directories.entry(logs, logName),
        fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_NOFOLLOW);
      const started = Date.now();
      let result;
      let entryBytes;
      try {
        entryBytes = readFile(directories, plan.entry);
        try {
          result = spawnSync(process.execPath, [plan.entry, ...plan.args], {
            cwd: plan.cwd, env, timeout, stdio: ['ignore', descriptor, descriptor], shell: false,
          });
        } catch (error) {
          result = { status: null, signal: null, error };
        }
      } finally { fs.closeSync(descriptor); }
      const bytes = readPinnedFile(directories, logs, logName).data;
      const evidence = {
        ...plan, executable: process.execPath, entrySha256: hash(entryBytes),
        exitCode: result.status, signal: result.signal ?? null, error: result.error?.message ?? null,
        durationMs: Date.now() - started, log: `logs/${logName}`,
        logBytes: bytes.length, logSha256: hash(bytes),
      };
      report.commands.push(evidence);
      report.outputs = inventories(stage).outputs;
      evidence.outputs = report.outputs;
      assert.ok(!result.error && result.status === 0 && !result.signal,
        `Build command failed: ${plan.id}: ${result.error?.message ?? result.status}`);
      if (plan.id === 'cli-help') {
        assert.match(bytes.toString(), /Usage:/, 'CLI --help did not print Usage');
      }
      checkInputs();
      checkOutputs(`after ${plan.id}`);
      if (plan.id.endsWith('-tsc')) {
        assertRequiredOutputs(source, report.outputs, plan.owner);
        report.completedOutputs[plan.owner] = packageOutputs(report.outputs, plan.owner);
      }
    }
    assert.deepEqual(dependencyPlan(workspace, dependencies.thirdPartyOwners, source, stage,
      dependencies.dependencyOwners),
      dependencies, 'Installed third-party/tool drift');
    report.sourceBuildsCompleted = true;
    report.cliSourceBuildVerified = source.productionPinsVerified;
    report.toolchainSourceBuilt = source.productionPinsVerified;
    report.status = 'cli-source-build-complete-not-accepted';
    report.exitCode = 2;
  } catch (error) {
    if (!run) throw error;
    report.errors.push(error.message);
  } finally {
    try {
      if (run) {
        if (source && dependencies) {
          try { checkInputs(); }
          catch (error) { report.sourceDrift = 'detected'; report.errors.push(error.message); }
        }
        if (optionalStat(stage)) {
          try { checkOutputs('final report'); }
          catch (error) { report.errors.push(error.message); }
        }
        if (report.errors.length) {
          report.status = 'failed';
          report.exitCode = 1;
          report.sourceBuildsCompleted = false;
          report.cliSourceBuildVerified = false;
          report.toolchainSourceBuilt = false;
        }
        report.finishedAt = new Date().toISOString();
        const bytes = jsonBytes(report);
        directories.write(run, 'report.json', bytes);
        directories.write(run, 'report.sha256', `${hash(bytes)}\n`);
      }
    } finally { directories.close(); }
  }
  return { report, destination, reportPath: join(destination, 'report.json'), exitCode: report.exitCode };
}

export function verifyNativeCliSourceBuild({
  workspace = workspaceDefault, sourceReport, pins = CLI_SOURCE_RELEASES,
} = {}) {
  workspace = resolve(workspace);
  const reportPath = fixedReportPath(workspace, sourceReport, 'native-cli-source-build');
  const destination = destinationFor(workspace, dirname(reportPath));
  const stage = join(destination, 'source');
  const directories = new PinnedDirectories();
  try {
    const reportBytes = readFile(directories, reportPath);
    assert.equal(readFile(directories, join(destination, 'report.sha256')).toString().trim(),
      hash(reportBytes), 'Build report hash mismatch');
    const report = JSON.parse(reportBytes);
    assert.equal(report.schemaVersion, 1, 'Unsupported build report schema');
    assert.equal(report.contract, 'native-cli-isolated-source-build', 'Unexpected build report contract');
    assert.equal(report.status, 'cli-source-build-complete-not-accepted', 'CLI source build did not complete');
    assert.equal(report.exitCode, 2, 'CLI source build did not complete');
    assert.equal(report.workspace, workspace, 'Workspace mismatch');
    assert.equal(report.destination, destination, 'Build destination mismatch');
    assert.equal(report.stage, stage, 'Staged source path mismatch');
    assert.equal(report.sourceBuildsCompleted, true, 'Build steps incomplete');
    for (const key of ['nativeAccepted', 'acceptedForProduction', 'fullLocalization',
      'originalVersionReproductionVerified', 'dependencySourcesBuilt', 'installsExecuted',
      'networkRequestsExecutedByHarness', 'arbitraryNpmScriptsExecuted']) {
      assert.equal(report[key], false, `Unsupported acceptance: ${key}`);
    }
    assert.deepEqual(report.errors, [], 'Build report contains errors');
    assert.deepEqual(report.outputDrift, [], 'Build report contains output drift');
    assert.equal(report.sourceDrift, 'unchanged', 'Source drift detected');
    assert.deepEqual(report.node, { executable: process.execPath, version: process.version },
      'Node tool identity drift');
    const source = verifyNativeCliFetchReport({
      workspace, fetchReport: report.source.reportPath, version: report.version, pins,
    });
    assert.deepEqual(sourceEvidence(source), report.source, 'Original source/evidence drift');
    assert.equal(report.cliSourceBuildVerified, source.productionPinsVerified, 'Pinned build claim mismatch');
    assert.equal(report.toolchainSourceBuilt, source.productionPinsVerified, 'Toolchain build claim mismatch');
    const exclusions = source.files.filter(item => excludedInput(item.path))
      .map(item => ({ ...item, reason: 'prebuilt-output-or-nonbuild-cache-not-copied' }));
    assert.deepEqual(report.stagingExclusions, exclusions, 'Staging exclusions mismatch');
    const entries = source.files.filter(item => !excludedInput(item.path))
      .map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 }));
    const current = inventories(stage);
    assert.deepEqual(report.inputs, { entries, ...fingerprint(entries) }, 'Input inventory changed');
    assert.deepEqual(current.inputs, report.inputs, 'Staged source input drift');
    verifyInputModes(stage, source);
    const dependencies = dependencyPlan(workspace, report.dependencies.thirdPartyOwners, source, stage,
      report.dependencies.dependencyOwners);
    assert.deepEqual(dependencies, report.dependencies, 'Installed third-party/tool drift');
    verifyLinks(dependencies, stage);
    const plan = commandPlan(source, dependencies, stage);
    assert.deepEqual(report.plannedCommands, plan, 'Build command plan changed');
    assert.equal(report.commands.length, plan.length, 'Build commands incomplete');
    for (const [index, expected] of plan.entries()) {
      const command = report.commands[index];
      assert.deepEqual(Object.fromEntries(Object.keys(expected).map(key => [key, command[key]])),
        expected, 'Build command changed');
      assert.equal(command.executable, process.execPath, 'Build executable changed');
      assert.equal(command.entrySha256, hash(readFile(directories, expected.entry)), 'Tool entry drift');
      assert.equal(command.exitCode, 0, 'Build command failed');
      assert.equal(command.signal, null, 'Build command interrupted');
      assert.equal(command.error, null, 'Build command error');
      assert.equal(command.log, `logs/${expected.id}.log`, 'Build log path changed');
      const bytes = readFile(directories, join(destination, command.log));
      assert.equal(command.logBytes, bytes.length, 'Build log size drift');
      assert.equal(command.logSha256, hash(bytes), 'Build log hash drift');
      if (expected.id === 'cli-help') assert.match(bytes.toString(), /Usage:/, 'Missing CLI --help evidence');
    }
    assert.deepEqual(Object.keys(report.completedOutputs).sort(), ['cli', 'core'], 'Completed output set changed');
    for (const spec of specs) {
      assertRequiredOutputs(source, current.outputs, spec.id);
      assert.deepEqual(report.completedOutputs[spec.id], packageOutputs(current.outputs, spec.id),
        `Build output drift: ${spec.id}`);
      const built = report.commands.find(item => item.id === `${spec.id}-tsc`);
      assert.deepEqual(packageOutputs(built.outputs, spec.id), report.completedOutputs[spec.id],
        `Completed command output drift: ${spec.id}`);
    }
    assert.deepEqual(report.outputs, current.outputs, 'Build output drift');
    assert.deepEqual(report.commands.at(-1).outputs, current.outputs, 'Final command output drift');
    assert.deepEqual(readFile(directories, reportPath), reportBytes, 'Build report drift during verification');
    return {
      report, reportPath, reportSha256: hash(reportBytes),
      version: source.version,
      core: { path: join(stage, 'packages/core'), entry: join(stage, 'packages/core/dist/index.js'),
        types: join(stage, 'packages/core/dist/index.d.ts') },
      cli: { path: join(stage, 'packages/cli'), entry: join(stage, 'packages/cli/dist/exports.js'),
        types: join(stage, 'packages/cli/dist/exports.d.ts'), bin: join(stage, 'packages/cli/dist/bin.js') },
      cliSourceBuildVerified: source.productionPinsVerified, nativeAccepted: false,
    };
  } finally { directories.close(); }
}

export function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({ args: argv, strict: true, options: {
    workspace: { type: 'string' }, output: { type: 'string' }, version: { type: 'string' },
    'fetch-report': { type: 'string' }, 'verify-report': { type: 'string' },
    'root-owner': { type: 'string', multiple: true },
    'core-owner': { type: 'string', multiple: true },
    'cli-owner': { type: 'string', multiple: true },
    'dependency-owner': { type: 'string', multiple: true },
  } });
  if (values['verify-report']) {
    assert.ok(!['output', 'version', 'fetch-report', 'root-owner', 'core-owner', 'cli-owner', 'dependency-owner']
      .some(key => values[key]), '--verify-report cannot be combined with build options');
    const result = verifyNativeCliSourceBuild({
      workspace: values.workspace, sourceReport: values['verify-report'],
    });
    console.log(JSON.stringify({ status: 'verified-cli-source-build-not-accepted',
      report: result.reportPath, reportSha256: result.reportSha256,
      cliSourceBuildVerified: result.cliSourceBuildVerified, nativeAccepted: false }, null, 2));
    process.exitCode = 2;
    return;
  }
  const result = runNativeCliSourceBuild({
    workspace: values.workspace, output: values.output, version: values.version,
    fetchReport: values['fetch-report'],
    thirdPartyOwners: { root: values['root-owner'], core: values['core-owner'], cli: values['cli-owner'] },
    dependencyOwners: values['dependency-owner'],
  });
  console.log(JSON.stringify({ status: result.report.status, report: result.reportPath,
    exitCode: result.exitCode, errors: result.report.errors, nativeAccepted: false }, null, 2));
  process.exitCode = result.exitCode;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
