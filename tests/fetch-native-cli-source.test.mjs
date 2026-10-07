import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix } from 'node:path';
import test from 'node:test';
import {
  CLI_SOURCE_API, CLI_SOURCE_RELEASES, fetchNativeCliSource, gitObjectHash,
  protectedSourcePath, publicRawUrl, validateRawRedirect, validateSourcePath,
  verifySourceBlob, verifySourceTree,
} from '../fetch-native-cli-source.mjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function fixture(t, versions = ['0.3.0', '0.3.23', '0.3.30'], extraFiles = {}) {
  const workspace = fs.mkdtempSync(join(tmpdir(), 'cli-source-fetch-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const blobs = new Map();
  const documents = new Map([[CLI_SOURCE_API, { private: false, public: true }]]);
  const protectedShas = new Set();
  const pins = [];
  const filesByVersion = new Map();
  const calls = [];
  for (const version of versions) {
    const files = {
      LICENSE: 'MIT fixture copyright retained\n',
      'package.json': JSON.stringify({ name: 'fixture-cli-monorepo', private: true }),
      'tsconfig.json': '{"compilerOptions":{"strict":true}}\n',
      '.eslintrc.js': 'module.exports = {};\n',
      'pnpm-lock.yaml': 'lockfileVersion: 6\n',
      'pnpm-workspace.yaml': 'packages:\n  - packages/*\n',
      '.npmrc': 'must not be fetched or inspected by downloader',
      'packages/cli/package.json': JSON.stringify({
        name: '@ibiz-template/cli', version,
        dependencies: { '@ibiz-template/cli-core': 'workspace:*' },
        scripts: { build: 'npm run lint && tsc --build' },
      }),
      'packages/cli/tsconfig.json': '{"extends":"../../tsconfig.json"}\n',
      'packages/cli/src/index.ts': 'export const cli = true;\n',
      'packages/core/package.json': JSON.stringify({
        name: '@ibiz-template/cli-core', version,
        scripts: { build: 'npm run lint && tsc --build' },
      }),
      'packages/core/tsconfig.json': '{"extends":"../../tsconfig.json"}\n',
      'packages/core/src/build/build.ts': 'export const build = true;\n',
      'packages/core/src/create-plugin/template/.gitignore': 'node_modules\n',
      'packages/core/src/create-plugin/template/src/index.ts': 'export const plugin = true;\n',
      '.husky/pre-commit': '#!/bin/sh\nexit 0\n',
      ...extraFiles,
    };
    const entries = new Map();
    for (const [path, text] of Object.entries(files)) {
      const bytes = Buffer.from(text);
      const sha = gitObjectHash('blob', bytes);
      blobs.set(sha, bytes);
      if (protectedSourcePath(path)) protectedShas.add(sha);
      entries.set(path, { path, mode: path === '.husky/pre-commit' ? '100755' : '100644',
        type: 'blob', sha, size: bytes.length });
      for (let parent = posix.dirname(path); parent !== '.'; parent = posix.dirname(parent)) {
        if (!entries.has(parent)) entries.set(parent, { path: parent, mode: '40000', type: 'tree' });
      }
    }
    const dirs = ['', ...[...entries.values()].filter(entry => entry.type === 'tree').map(e => e.path)];
    let tree;
    for (const parent of dirs.sort((a, b) => b.length - a.length)) {
      const children = [...entries.values()].filter(entry =>
        (posix.dirname(entry.path) === '.' ? '' : posix.dirname(entry.path)) === parent);
      children.sort((a, b) => Buffer.compare(
        Buffer.from(posix.basename(a.path) + (a.type === 'tree' ? '/' : '')),
        Buffer.from(posix.basename(b.path) + (b.type === 'tree' ? '/' : ''))));
      const bytes = Buffer.concat(children.flatMap(entry => [
        Buffer.from(`${entry.mode} ${posix.basename(entry.path)}\0`),
        Buffer.from(entry.sha, 'hex'),
      ]));
      const sha = gitObjectHash('tree', bytes);
      if (parent) entries.get(parent).sha = sha;
      else tree = sha;
    }
    const commit = gitObjectHash('commit', Buffer.from(`${version} fixture commit ${tree}`));
    const pin = { version, commit, tree };
    pins.push(pin);
    filesByVersion.set(version, files);
    documents.set(`${CLI_SOURCE_API}/commits/${commit}`, { sha: commit, commit: { tree: { sha: tree } } });
    documents.set(`${CLI_SOURCE_API}/git/trees/${tree}?recursive=1`,
      { sha: tree, truncated: false, tree: [...entries.values()] });
  }
  for (const [sha, bytes] of blobs) {
    documents.set(`${CLI_SOURCE_API}/git/blobs/${sha}`, {
      sha, size: bytes.length, encoding: 'base64', content: `${bytes.toString('base64')}\n`,
    });
  }
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    assert.ok(url.startsWith(CLI_SOURCE_API));
    const sha = /\/git\/blobs\/([a-f0-9]{40})$/.exec(url)?.[1];
    assert.ok(!protectedShas.has(sha), 'A protected blob must never be requested');
    assert.ok(documents.has(url), `Unknown fixture route: ${url}`);
    return new Response(JSON.stringify(documents.get(url)), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    });
  };
  return {
    workspace, output: join(workspace, '.artifacts/native-cli-source-fetch/run'),
    releases: pins, fetchImpl, attempts: 1, retryDelayMs: 0, requestIntervalMs: 0,
    documents, blobs, filesByVersion, calls, protectedShas,
  };
}

function rawFixture(options, { redirect = true, targetOrigin = 'https://raw.giteeusercontent.com',
  transform = bytes => bytes } = {}) {
  const calls = [];
  return {
    calls,
    fetchImpl: async (url, request) => {
      if (url.startsWith(CLI_SOURCE_API)) return options.fetchImpl(url, request);
      calls.push({ url, options: request });
      const parsed = new URL(url);
      assert.equal(request.redirect, 'manual');
      assert.equal(request.credentials, 'omit');
      assert.deepEqual(request.headers, { Accept: 'application/octet-stream' });
      const prefix = '/iBizModeling/ibiz-template-cli/raw/';
      assert.ok(parsed.pathname.startsWith(prefix), `Unexpected raw route: ${url}`);
      if (parsed.origin === 'https://gitee.com' && redirect) {
        return new Response('Public source redirect', { status: 302, headers: {
          Location: `${targetOrigin}${parsed.pathname}?metadata=public-fixture&signature=public-fixture`,
        } });
      }
      const [commit, ...segments] = parsed.pathname.slice(prefix.length).split('/');
      const path = segments.map(decodeURIComponent).join('/');
      const pin = options.releases.find(item => item.commit === commit);
      const tree = options.documents.get(`${CLI_SOURCE_API}/git/trees/${pin.tree}?recursive=1`);
      const entry = tree.tree.find(item => item.path === path);
      assert.ok(!options.protectedShas.has(entry.sha), 'Protected raw source must not be fetched');
      return new Response(transform(options.blobs.get(entry.sha)), { status: 200 });
    },
  };
}

function rewriteFixtureReport(result, change) {
  const report = JSON.parse(fs.readFileSync(result.reportPath));
  change(report);
  const bytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(result.reportPath, bytes);
  fs.writeFileSync(join(result.destination, 'report.sha256'), `${digest(bytes)}\n`);
  return report;
}

test('production pins retain all three exact release commits and trees', () => {
  assert.deepEqual(CLI_SOURCE_RELEASES.map(pin => [pin.version, pin.commit, pin.tree]), [
    ['0.3.0', '15ab40e917b0c0bde9a3b7473f3ca30a37cd116c', '01e9c0943d83e8fc1f55ebb1866b28cf24d79fe4'],
    ['0.3.23', 'a592a88de74abb9985e99a53d452d413d370ad7c', '305b5108f73846807fdcb68d9579159fe58cc07e'],
    ['0.3.30', '2277d0680777d5d147d912fecab779a6747807eb', '05e1c337cac5dacce68b7a9db704b35fc3cbff87'],
  ]);
});

test('unsafe paths cannot enter source staging', () => {
  for (const path of ['', '/tmp/out', '../out', 'src/../out', './src', 'src//out', 'src/',
    'src\\out', 'C:out', 'src/\0out', '.git/config', 'src/.Git/config']) {
    assert.throws(() => validateSourcePath(path), /source path/);
  }
  assert.equal(validateSourcePath('packages/core/src/template/.gitignore'),
    'packages/core/src/template/.gitignore');
});

test('tree object hashes establish completeness, including nested directories', t => {
  const options = fixture(t, ['0.3.30']);
  const pin = options.releases[0];
  const document = options.documents.get(`${CLI_SOURCE_API}/git/trees/${pin.tree}?recursive=1`);
  assert.equal(verifySourceTree(document, pin.tree).length, document.tree.length);
  const missing = structuredClone(document);
  missing.tree = missing.tree.filter(entry => entry.path !== 'packages/cli/src/index.ts');
  assert.throws(() => verifySourceTree(missing, pin.tree), /Incomplete or altered tree/);
  const altered = structuredClone(document);
  altered.tree.find(entry => entry.path === 'LICENSE').sha = 'a'.repeat(40);
  assert.throws(() => verifySourceTree(altered, pin.tree), /Incomplete or altered tree/);
});

test('truncated trees, duplicate paths, missing parents, symlinks and gitlinks are rejected', t => {
  const options = fixture(t, ['0.3.30']);
  const pin = options.releases[0];
  const document = options.documents.get(`${CLI_SOURCE_API}/git/trees/${pin.tree}?recursive=1`);
  assert.throws(() => verifySourceTree({ ...document, truncated: true }, pin.tree), /Truncated/);
  assert.throws(() => verifySourceTree({ ...document, tree: [...document.tree, document.tree[0]] },
    pin.tree), /Duplicate/);
  const missing = structuredClone(document);
  missing.tree = missing.tree.filter(entry => entry.path !== 'packages/cli/src');
  assert.throws(() => verifySourceTree(missing, pin.tree), /Missing parent/);
  for (const [type, mode] of [['blob', '120000'], ['commit', '160000']]) {
    const invalid = structuredClone(document);
    invalid.tree.find(entry => entry.path === 'LICENSE').type = type;
    invalid.tree.find(entry => entry.path === 'LICENSE').mode = mode;
    assert.throws(() => verifySourceTree(invalid, pin.tree), /Symlink, gitlink/);
  }
});

test('blob validation requires original bytes, size, encoding and canonical base64', () => {
  const bytes = Buffer.from('original source\n');
  const sha = gitObjectHash('blob', bytes);
  const document = { sha, encoding: 'base64', size: bytes.length, content: bytes.toString('base64') };
  assert.deepEqual(verifySourceBlob(document, sha, bytes.length), bytes);
  assert.throws(() => verifySourceBlob({ ...document, content: Buffer.from('different source').toString('base64') },
    sha, bytes.length), /hash mismatch/);
  assert.throws(() => verifySourceBlob(document, sha, bytes.length + 1), /size differs/);
  assert.throws(() => verifySourceBlob({ ...document, size: 0 }, sha, bytes.length), /API size/);
  assert.throws(() => verifySourceBlob({ ...document, encoding: 'utf8' }, sha, bytes.length), /encoding/);
  assert.throws(() => verifySourceBlob({ ...document, content: '%%%=' }, sha, bytes.length), /base64/);
  assert.throws(() => verifySourceBlob({ ...document, sha: 'a'.repeat(40) }, sha, bytes.length), /SHA mismatch/);
});

test('public raw redirects accept only the official HTTPS host and exact pinned path', () => {
  const url = publicRawUrl(CLI_SOURCE_RELEASES[2].commit, 'packages/core/src/file name.ts');
  assert.ok(url.endsWith('/file%20name.ts'));
  const path = new URL(url).pathname;
  assert.equal(validateRawRedirect(`https://raw.giteeusercontent.com${path}?signature=public`, url),
    `https://raw.giteeusercontent.com${path}?signature=public`);
  for (const location of [
    'https://gitee.com/login', `https://example.com${path}`,
    `http://raw.giteeusercontent.com${path}`, `https://raw.giteeusercontent.com:444${path}`,
    `https://user:password@raw.giteeusercontent.com${path}`,
    `https://raw.giteeusercontent.com${path}#fragment`,
    `https://raw.giteeusercontent.com${path.replace('/file%20name.ts', '/other.ts')}`,
  ]) assert.throws(() => validateRawRedirect(location, url), /Unexpected public raw redirect/);
});

test('public raw acquisition preserves redirect and binary response evidence without fabricating API data', async t => {
  const options = fixture(t);
  const raw = rawFixture(options);
  const result = await fetchNativeCliSource({ ...options, transport: 'public-raw', fetchImpl: raw.fetchImpl });
  assert.equal(result.exitCode, 2, JSON.stringify(result.report.errors));
  assert.equal(options.calls.filter(call => call.url.includes('/git/blobs/')).length, 0);
  assert.equal(raw.calls.length, result.report.uniqueBlobs * 2);
  for (const blob of result.report.blobs) {
    assert.equal(blob.transport, 'public-raw');
    assert.equal(blob.rawFormat, 'bytes');
    const bytes = fs.readFileSync(join(result.destination, blob.raw));
    assert.equal(gitObjectHash('blob', bytes), blob.sha);
    assert.equal(digest(bytes), blob.rawSha256);
    const request = result.report.requests.find(item => item.label === `blob-${blob.sha}`);
    assert.equal(request.url, blob.sourceUrl);
    assert.equal(request.initialResponse.status, 302);
    assert.equal(request.status, 200);
    assert.equal(new URL(request.finalUrl).origin, 'https://raw.giteeusercontent.com');
    assert.equal(digest(fs.readFileSync(join(result.destination, request.initialResponse.raw))),
      request.initialResponse.sha256);
  }
  assert.equal(result.report.toolchainSourceBuilt, false);
  assert.equal(result.report.nativeAccepted, false);
  assert.equal(result.report.fullLocalization, false);
});

test('public raw caches reverify pinned paths and bytes offline across chained candidates', async t => {
  const options = fixture(t);
  const raw = rawFixture(options);
  const first = await fetchNativeCliSource({ ...options, transport: 'public-raw', fetchImpl: raw.fetchImpl });
  assert.equal(first.exitCode, 2, JSON.stringify(first.report.errors));
  const offline = async () => assert.fail('Complete raw cache must not make network requests');
  const second = await fetchNativeCliSource({
    ...options, output: join(dirname(options.output), 'raw-second'),
    cacheFrom: [first.destination], fetchImpl: offline,
  });
  assert.equal(second.exitCode, 2, JSON.stringify(second.report.errors));
  assert.equal(second.report.reusedVerifiedBlobs, first.report.uniqueBlobs);
  assert.equal(second.report.requests.length, 0);
  assert.equal(second.report.cachedBlobRequests.length, first.report.uniqueBlobs);
  assert.ok(second.report.blobs.every(blob => blob.rawFormat === 'bytes' && blob.raw.endsWith('.bin')));
  const third = await fetchNativeCliSource({
    ...options, output: join(dirname(options.output), 'raw-third'),
    cacheFrom: [second.destination], fetchImpl: offline,
  });
  assert.equal(third.exitCode, 2, JSON.stringify(third.report.errors));
  assert.equal(third.report.reusedVerifiedBlobs, first.report.uniqueBlobs);
  assert.equal(third.report.requests.length, 0);
  assert.equal(third.report.cachedBlobRequests.length, first.report.uniqueBlobs);
  for (const original of first.report.requests.filter(record => record.label.startsWith('blob-'))) {
    for (const result of [second, third]) {
      const record = result.report.cachedBlobRequests.find(item => item.label === original.label);
      const blob = result.report.blobs.find(item => `blob-${item.sha}` === record.label);
      assert.equal(record.status, original.status);
      assert.equal(record.url, original.url);
      assert.equal(record.finalUrl, original.finalUrl);
      assert.equal(record.raw, blob.raw);
      assert.equal(record.sha256, original.sha256);
      assert.equal(record.bytes, original.bytes);
      assert.equal(record.startedAt, original.startedAt);
      assert.equal(record.finishedAt, original.finishedAt);
      assert.equal(record.capturedAt, original.startedAt);
      assert.deepEqual(record.initialResponse, original.initialResponse);
      assert.deepEqual(fs.readFileSync(join(result.destination, record.initialResponse.raw)),
        fs.readFileSync(join(first.destination, original.initialResponse.raw)));
    }
  }
  assert.ok(third.report.cachedBlobRequests.every(record =>
    record.cacheSource === second.destination &&
    record.cacheReportSha256 === digest(fs.readFileSync(second.reportPath))));
});

test('three-version raw cache narrows with actual refetches and remains reusable on the next round', async t => {
  const options = fixture(t);
  const raw = rawFixture(options);
  const first = await fetchNativeCliSource({
    ...options, transport: 'public-raw', fetchImpl: raw.fetchImpl,
  });
  assert.equal(first.exitCode, 2);
  const originalReport = fs.readFileSync(first.reportPath);
  const receipts = first.report.releases.map(release => fs.readFileSync(release.receipt));
  const pin = options.releases.find(item => item.version === '0.3.30');
  raw.calls.length = 0;
  const second = await fetchNativeCliSource({
    ...options, releases: [pin], output: join(dirname(options.output), 'raw-narrow'),
    transport: 'public-raw', cacheFrom: [first.destination], fetchImpl: raw.fetchImpl,
  });
  assert.equal(second.exitCode, 2, JSON.stringify(second.report.errors));
  const misses = second.report.cacheMisses;
  assert.ok(misses.length > 0);
  assert.ok(misses.every(item => item.reason === 'raw-origin-release-not-in-current-candidate'));
  assert.equal(second.report.downloadedBlobs, misses.length);
  assert.equal(raw.calls.length, misses.length * 2);
  const prefix = publicRawUrl(pin.commit, 'LICENSE').slice(0, -'LICENSE'.length);
  assert.ok(raw.calls.filter(call => call.url.startsWith('https://gitee.com/'))
    .every(call => call.url.startsWith(prefix)));
  assert.ok(second.report.blobs.every(blob => blob.sourceUrl.startsWith(prefix)));
  for (const miss of misses) {
    const original = first.report.blobs.find(blob => blob.sha === miss.sha);
    const actual = second.report.requests.find(item => item.label === `blob-${miss.sha}`);
    assert.ok(actual);
    assert.notEqual(actual.url, original.sourceUrl, 'Narrowing must perform a real new request');
  }
  const third = await fetchNativeCliSource({
    ...options, releases: [pin], output: join(dirname(options.output), 'raw-narrow-chain'),
    cacheFrom: [second.destination],
    fetchImpl: async () => assert.fail('Narrowed HTTP evidence must resume completely offline'),
  });
  assert.equal(third.exitCode, 2, JSON.stringify(third.report.errors));
  assert.equal(third.report.downloadedBlobs, 0);
  assert.equal(third.report.reusedVerifiedBlobs, second.report.uniqueBlobs);
  assert.equal(third.report.cacheMisses.length, 0);
  assert.equal(third.report.requests.length, 0);
  assert.equal(third.report.releases[0].sourceFingerprint, second.report.releases[0].sourceFingerprint);
  assert.deepEqual(fs.readFileSync(first.reportPath), originalReport);
  for (const [index, release] of first.report.releases.entries()) {
    assert.deepEqual(fs.readFileSync(release.receipt), receipts[index]);
  }
});

test('direct HTTP200 raw responses remain distinguishable from preserved redirect evidence', async t => {
  const options = fixture(t, ['0.3.30']);
  const raw = rawFixture(options, { redirect: false });
  let previous = await fetchNativeCliSource({
    ...options, transport: 'public-raw', fetchImpl: raw.fetchImpl,
  });
  assert.equal(previous.exitCode, 2);
  for (const output of ['direct-second', 'direct-third']) {
    previous = await fetchNativeCliSource({
      ...options, output: join(dirname(options.output), output), cacheFrom: [previous.destination],
      fetchImpl: async () => assert.fail('Direct raw HTTP evidence must resume offline'),
    });
    assert.equal(previous.exitCode, 2, JSON.stringify(previous.report.errors));
    assert.ok(previous.report.cachedBlobRequests.every(record =>
      record.status === 200 && record.initialResponse === undefined && record.finalUrl === undefined));
  }
});

for (const mode of ['missing-location', 'foreign-location', 'malformed-location', 'partial-body']) {
  test(`raw redirect ${mode} retains body evidence and releases its reader before rejection`, async t => {
    const options = fixture(t, ['0.3.30']);
    const body = Buffer.from('Public redirect body');
    let requests = 0;
    let cancels = 0;
    let releases = 0;
    let reads = 0;
    const result = await fetchNativeCliSource({
      ...options, concurrency: 1, attempts: 3, transport: 'public-raw',
      fetchImpl: async (url, request) => {
        if (url.startsWith(CLI_SOURCE_API)) return options.fetchImpl(url, request);
        requests++;
        assert.equal(new URL(url).origin, 'https://gitee.com', 'Must not follow or retry this redirect');
        return {
          status: 302,
          headers: new Headers(mode === 'missing-location' ? {} : {
            Location: mode === 'malformed-location' ? 'https://[' : 'https://example.com/source',
          }),
          body: { getReader: () => ({
            read: async () => {
              if (++reads === 1) return { done: false, value: body };
              if (mode === 'partial-body') throw new Error('Fixture redirect read failure');
              return { done: true };
            },
            cancel: async () => { cancels++; },
            releaseLock: () => { releases++; },
          }) },
        };
      },
    });
    assert.equal(result.exitCode, 1);
    assert.equal(requests, 1);
    assert.equal(cancels, 1);
    assert.equal(releases, 1);
    const record = result.report.requests.find(item => item.label.startsWith('blob-'));
    assert.equal(record.status, 302);
    assert.equal(record.initialResponse.url, record.url);
    assert.equal(record.initialResponse.status, 302);
    assert.equal(record.initialResponse.bytes, body.length);
    assert.equal(record.initialResponse.sha256, digest(body));
    assert.deepEqual(fs.readFileSync(join(result.destination, record.initialResponse.raw)), body);
    assert.equal(record.finalUrl, undefined);
    assert.equal(result.report.uniqueBlobs, 0);
    assert.equal(fs.readdirSync(join(result.destination, 'receipts')).length, 0);
    if (mode === 'partial-body') {
      assert.equal(record.partial, true);
      assert.equal(record.initialResponse.partial, true);
      assert.match(record.error, /Fixture redirect read failure/);
    } else assert.match(record.error, mode === 'missing-location' ?
      /Missing public raw redirect location/ : mode === 'malformed-location' ?
        /Invalid URL/ : /Unexpected public raw redirect/);
  });
}

test('raw responses reject foreign redirects, repeated redirects and altered Git bytes', async t => {
  for (const mode of ['foreign', 'second-redirect', 'bytes']) {
    const options = fixture(t, ['0.3.30']);
    const raw = rawFixture(options, {
      ...(mode === 'foreign' ? { targetOrigin: 'https://example.com' } : {}),
      ...(mode === 'bytes' ? { transform: bytes => Buffer.alloc(bytes.length, 65) } : {}),
    });
    const result = await fetchNativeCliSource({
      ...options, concurrency: 1, attempts: 2, transport: 'public-raw',
      fetchImpl: async (url, request) => {
        if (mode === 'second-redirect' && url.startsWith('https://raw.giteeusercontent.com/')) {
          return new Response('login', { status: 302, headers: { Location: 'https://example.com/login' } });
        }
        return raw.fetchImpl(url, request);
      },
    });
    assert.equal(result.exitCode, 1);
    assert.match(result.report.errors[0].message, mode === 'foreign' ?
      /Unexpected public raw redirect/ : mode === 'bytes' ? /Raw Git blob hash mismatch/ : /HTTP 302/);
    assert.equal(result.report.uniqueBlobs, 0);
    assert.ok(raw.calls.every(call => !call.url.startsWith('https://example.com')));
    assert.equal(fs.readdirSync(join(result.destination, 'receipts')).length, 0);
  }
});

test('fresh staging preserves original configs, lock, license, templates and executable modes', async t => {
  const options = fixture(t);
  const result = await fetchNativeCliSource(options);
  assert.equal(result.exitCode, 2, JSON.stringify(result.report.errors));
  assert.equal(result.report.errors.length, 0);
  for (const release of result.report.releases) {
    for (const [path, original] of Object.entries(options.filesByVersion.get(release.version))) {
      if (protectedSourcePath(path)) {
        assert.ok(!fs.existsSync(join(release.sourceDirectory, path)));
      } else {
        assert.equal(fs.readFileSync(join(release.sourceDirectory, path), 'utf8'), original);
      }
    }
    assert.equal(fs.statSync(join(release.sourceDirectory, '.husky/pre-commit')).mode & 0o777, 0o755);
    assert.equal(fs.statSync(join(release.sourceDirectory, 'LICENSE')).mode & 0o777, 0o644);
    const raw = fs.readFileSync(release.receipt);
    assert.equal(digest(raw), release.receiptSha256);
    const receipt = JSON.parse(raw);
    assert.deepEqual(receipt.minimalOwnBuildClosure, ['@ibiz-template/cli-core', '@ibiz-template/cli']);
    assert.equal(receipt.packages[1].dependencies['@ibiz-template/cli-core'], 'workspace:*');
    assert.equal(receipt.sourceComplete, false);
    assert.equal(receipt.exclusions[0].path, '.npmrc');
    assert.equal(receipt.allMaterializedGitBlobsVerified, true);
    assert.equal(receipt.nativeAccepted, false);
    assert.equal(receipt.acceptedForProduction, false);
    assert.equal(receipt.fullLocalization, false);
    assert.equal(receipt.buildsExecuted, false);
    assert.equal(receipt.installsExecuted, false);
  }
  assert.equal(result.report.sourceComplete, false);
  assert.equal(result.report.toolchainSourceBuilt, false);
  assert.equal(result.report.originalVersionReproductionVerified, false);
  assert.ok(!fs.existsSync(join(options.workspace, 'node_modules')));
  assert.equal(fs.readFileSync(join(options.output, 'report.sha256'), 'utf8').trim(),
    digest(fs.readFileSync(result.reportPath)));
});

test('same SHA blobs are fetched once across versions; raw response hashes remain verifiable', async t => {
  const options = fixture(t);
  const { report } = await fetchNativeCliSource(options);
  const blobCalls = options.calls.filter(call => call.url.includes('/git/blobs/'));
  assert.equal(blobCalls.length, new Set(blobCalls.map(call => call.url)).size);
  assert.equal(blobCalls.length, report.uniqueBlobs);
  assert.ok(report.blobCacheHits > 0);
  for (const record of report.requests) {
    const raw = fs.readFileSync(join(options.output, record.raw));
    assert.equal(raw.length, record.bytes);
    assert.equal(digest(raw), record.sha256);
  }
  for (const { options: request } of options.calls) {
    assert.equal(request.redirect, 'manual');
    assert.equal(request.credentials, 'omit');
    assert.deepEqual(request.headers, { Accept: 'application/json' });
  }
});

test('existing candidates, outside outputs and symlink ancestors are never overwritten', async t => {
  const options = fixture(t);
  for (const output of [join(options.workspace, 'outside'), join(options.output, 'nested')]) {
    await assert.rejects(fetchNativeCliSource({ ...options, output }), /direct child/);
    assert.ok(!fs.existsSync(output));
  }
  fs.mkdirSync(options.output, { recursive: true });
  fs.writeFileSync(join(options.output, 'keep.txt'), 'existing evidence');
  await assert.rejects(fetchNativeCliSource(options), /must not be overwritten/);
  assert.deepEqual(fs.readdirSync(options.output), ['keep.txt']);
  assert.equal(fs.readFileSync(join(options.output, 'keep.txt'), 'utf8'), 'existing evidence');
  const target = join(options.workspace, 'untouched');
  fs.mkdirSync(target);
  const artifactLink = join(options.workspace, '.artifacts/linked');
  fs.symlinkSync(target, artifactLink, 'dir');
  await assert.rejects(fetchNativeCliSource({
    ...options, workspace: artifactLink,
    output: join(artifactLink, '.artifacts/native-cli-source-fetch/run'),
  }), /Symlink directory rejected/);
  assert.deepEqual(fs.readdirSync(target), []);
  assert.equal(options.calls.length, 0);
});

test('all trees are verified before blob downloads; failures retain evidence, not receipts', async t => {
  const options = fixture(t);
  const pin = options.releases[1];
  options.documents.get(`${CLI_SOURCE_API}/git/trees/${pin.tree}?recursive=1`).truncated = true;
  const { report, reportPath } = await fetchNativeCliSource(options);
  assert.equal(report.exitCode, 1);
  assert.equal(report.status, 'source-fetch-failed');
  assert.match(report.errors[0].message, /Truncated/);
  assert.equal(report.releases[1].status, 'failed');
  assert.equal(report.releases[2].status, 'not-started');
  assert.equal(report.uniqueBlobs, 0);
  assert.ok(fs.existsSync(reportPath));
  assert.equal(fs.readdirSync(join(options.output, 'receipts')).length, 0);
  assert.ok(fs.existsSync(join(options.output, 'evidence/tree-0.3.23-attempt-1.response.json')));
  assert.ok(!fs.existsSync(join(options.output, 'source')));
});

test('bad blob bytes stop acquisition and preserve raw response and partial source', async t => {
  const options = fixture(t, ['0.3.30']);
  const license = Buffer.from(options.filesByVersion.get('0.3.30').LICENSE);
  const sha = gitObjectHash('blob', license);
  options.documents.get(`${CLI_SOURCE_API}/git/blobs/${sha}`).content =
    Buffer.alloc(license.length, 65).toString('base64');
  const { report } = await fetchNativeCliSource({ ...options, concurrency: 1 });
  assert.equal(report.exitCode, 1);
  assert.match(report.errors[0].message, /Git blob hash mismatch/);
  assert.ok(fs.existsSync(join(options.output, `evidence/blob-${sha}-attempt-1.response.json`)));
  assert.ok(fs.existsSync(join(options.output, 'source/0.3.30')));
  assert.ok(!fs.existsSync(join(options.output, 'source/0.3.30/LICENSE')));
  assert.equal(fs.readdirSync(join(options.output, 'receipts')).length, 0);
});

test('HTTP failures are recorded; retry only transient failures and never follow redirects', async t => {
  const options = fixture(t, ['0.3.30']);
  let calls = 0;
  const result = await fetchNativeCliSource({
    ...options, attempts: 2,
    fetchImpl: async (...args) => {
      if (++calls === 1) return new Response('temporary unavailable', { status: 503 });
      return options.fetchImpl(...args);
    },
  });
  assert.equal(result.exitCode, 2);
  assert.equal(result.report.requests[0].status, 503);
  assert.equal(result.report.requests[1].attempt, 2);
  assert.equal(fs.readFileSync(join(options.output, result.report.requests[0].raw), 'utf8'),
    'temporary unavailable');
  const redirect = fixture(t, ['0.3.30']);
  let redirects = 0;
  const failure = await fetchNativeCliSource({
    ...redirect, attempts: 3,
    fetchImpl: async () => {
      redirects++;
      return new Response('login required', { status: 302, headers: { Location: '/login' } });
    },
  });
  assert.equal(failure.exitCode, 1);
  assert.equal(redirects, 1);
  assert.match(failure.report.errors[0].message, /HTTP 302/);
  assert.equal(failure.report.requests[0].location, '/login');
});

test('nonpublic repositories and commit/tree mismatch cannot produce source receipts', async t => {
  for (const failure of ['private', 'commit', 'tree']) {
    const options = fixture(t, ['0.3.30']);
    const pin = options.releases[0];
    if (failure === 'private') options.documents.get(CLI_SOURCE_API).private = true;
    else if (failure === 'commit') {
      options.documents.get(`${CLI_SOURCE_API}/commits/${pin.commit}`).sha = 'a'.repeat(40);
    } else {
      options.documents.get(`${CLI_SOURCE_API}/commits/${pin.commit}`).commit.tree.sha = 'b'.repeat(40);
    }
    const { report } = await fetchNativeCliSource(options);
    assert.equal(report.exitCode, 1);
    assert.equal(report.uniqueBlobs, 0);
    assert.equal(fs.readdirSync(join(options.output, 'receipts')).length, 0);
  }
});

test('only explicit rate-limit 403 is retried; generic forbidden responses stop', async t => {
  const options = fixture(t, ['0.3.30']);
  let calls = 0;
  const result = await fetchNativeCliSource({
    ...options, attempts: 2,
    fetchImpl: async (...args) => {
      if (++calls === 1) {
        return new Response('403 Forbidden (Rate Limit Exceeded)', { status: 403,
          headers: { 'Retry-After': '0', 'X-RateLimit-Remaining': '0' } });
      }
      return options.fetchImpl(...args);
    },
  });
  assert.equal(result.exitCode, 2);
  assert.equal(result.report.requests[0].retryReason, 'public-rate-limit');
  assert.equal(result.report.requests[0].retryAfter, '0');
  assert.equal(result.report.requests[0].rateLimit['x-ratelimit-remaining'], '0');
  const forbidden = fixture(t, ['0.3.30']);
  let rejectedCalls = 0;
  const failed = await fetchNativeCliSource({
    ...forbidden, attempts: 3,
    fetchImpl: async () => {
      rejectedCalls++;
      return new Response('Access denied', { status: 403 });
    },
  });
  assert.equal(failed.exitCode, 1);
  assert.equal(rejectedCalls, 1);
  assert.equal(failed.report.requests[0].retryReason, 'not-retryable');
});

test('global request pacing applies across concurrent workers', async t => {
  const options = fixture(t, ['0.3.30']);
  const times = [];
  const { report } = await fetchNativeCliSource({
    ...options, concurrency: 3, requestIntervalMs: 10,
    fetchImpl: async (...args) => {
      times.push(performance.now());
      return options.fetchImpl(...args);
    },
  });
  assert.equal(report.exitCode, 2);
  assert.ok(times.at(-1) - times[0] >= (times.length - 1) * 8,
    'Request starts must be globally paced, including parallel blob workers');
});

test('rate-limit cooldown pauses other queued blob workers as well as the retry', async t => {
  const options = fixture(t, ['0.3.30']);
  let limitedAt;
  const laterRequests = [];
  const { report } = await fetchNativeCliSource({
    ...options, concurrency: 3, attempts: 2, retryDelayMs: 50, requestIntervalMs: 10,
    fetchImpl: async (...args) => {
      if (args[0].includes('/git/blobs/') && limitedAt === undefined) {
        limitedAt = performance.now();
        return new Response('403 Forbidden (Rate Limit Exceeded)', { status: 403 });
      }
      if (limitedAt !== undefined) laterRequests.push(performance.now());
      return options.fetchImpl(...args);
    },
  });
  assert.equal(report.exitCode, 2);
  assert.ok(laterRequests.length > 0);
  assert.ok(Math.min(...laterRequests) - limitedAt >= 45,
    'A queued worker must recheck a cooldown extended while it was waiting');
  assert.equal(report.requests.find(record => record.status === 403).retryDelayMs, 50);
});

test('Retry-After HTTP dates are respected and excessive waits stop without an early retry', async t => {
  const options = fixture(t, ['0.3.30']);
  let calls = 0;
  const retryAt = new Date(Date.now() + 1200).toUTCString();
  const { report } = await fetchNativeCliSource({
    ...options, attempts: 2,
    fetchImpl: async (...args) => {
      if (++calls === 1) return new Response('rate limited', { status: 429,
        headers: { 'Retry-After': retryAt } });
      assert.ok(Date.now() >= Date.parse(retryAt), 'Retry must not precede the HTTP date');
      return options.fetchImpl(...args);
    },
  });
  assert.equal(report.exitCode, 2);
  assert.ok(report.requests[0].retryDelayMs > 0);
  const excessive = fixture(t, ['0.3.30']);
  let stoppedCalls = 0;
  const failed = await fetchNativeCliSource({
    ...excessive, attempts: 2,
    fetchImpl: async () => {
      stoppedCalls++;
      return new Response('rate limited', { status: 429,
        headers: { 'Retry-After': '600' } });
    },
  });
  assert.equal(failed.exitCode, 1);
  assert.equal(stoppedCalls, 1);
  assert.match(failed.report.errors[0].message, /Retry wait exceeds five minutes/);
});

test('a protected blob cannot be read via an ordinary-looking duplicate path', async t => {
  const options = fixture(t, ['0.3.30'], {
    'packages/core/src/ordinary.txt': 'must not be fetched or inspected by downloader',
  });
  const { report } = await fetchNativeCliSource(options);
  assert.equal(report.exitCode, 2);
  const release = report.releases[0];
  assert.equal(release.sourceComplete, false);
  assert.ok(!fs.existsSync(join(release.sourceDirectory, 'packages/core/src/ordinary.txt')));
  const excluded = release.exclusions.find(entry => entry.path === 'packages/core/src/ordinary.txt');
  assert.equal(excluded.reason, 'shared-protected-blob-not-read');
  assert.ok(options.calls.every(call => !call.url.endsWith(excluded.sha)));
});

test('failed acquisition explicitly leaves sourceComplete false for every release', async t => {
  const options = fixture(t);
  const { report } = await fetchNativeCliSource({
    ...options,
    fetchImpl: async () => new Response('403 Forbidden (Rate Limit Exceeded)', { status: 403 }),
  });
  assert.equal(report.exitCode, 1);
  assert.ok(report.releases.every(release => release.sourceComplete === false &&
    release.materializedFiles === 0 && release.status === 'not-started'));
  assert.equal(report.sourceComplete, false);
  assert.ok(report.releases.every(release => release.receipt === undefined));
});

test('a fresh candidate can reverify prior blob evidence without refetching or changing it', async t => {
  const options = fixture(t);
  const first = await fetchNativeCliSource(options);
  const originalReport = fs.readFileSync(first.reportPath);
  const originalReceipts = first.report.releases.map(release => fs.readFileSync(release.receipt));
  options.calls.length = 0;
  const output = join(dirname(options.output), 'second');
  const second = await fetchNativeCliSource({ ...options, output, cacheFrom: [options.output] });
  assert.equal(second.exitCode, 2, JSON.stringify(second.report.errors));
  assert.equal(second.report.downloadedBlobs, 0);
  assert.equal(second.report.reusedVerifiedBlobs, first.report.uniqueBlobs);
  assert.equal(options.calls.filter(call => call.url.includes('/git/blobs/')).length, 0);
  assert.deepEqual(fs.readFileSync(first.reportPath), originalReport);
  for (const [index, release] of first.report.releases.entries()) {
    assert.deepEqual(fs.readFileSync(release.receipt), originalReceipts[index]);
  }
  for (const record of second.report.blobs) {
    assert.equal(digest(fs.readFileSync(join(output, record.raw))), record.rawSha256);
  }
  assert.equal(second.report.releases[0].sourceFingerprint, first.report.releases[0].sourceFingerprint);
});

test('a complete cache resumes offline and keeps public metadata freshness explicit', async t => {
  const options = fixture(t);
  const first = await fetchNativeCliSource(options);
  options.calls.length = 0;
  const second = await fetchNativeCliSource({
    ...options, output: join(dirname(options.output), 'offline'),
    cacheFrom: [options.output],
    fetchImpl: async () => assert.fail('Complete verified cache must not make network requests'),
  });
  assert.equal(second.exitCode, 2, JSON.stringify(second.report.errors));
  assert.equal(second.report.requests.length, 0);
  assert.equal(second.report.reusedVerifiedMetadata, 1 + options.releases.length * 2);
  assert.equal(second.report.downloadedBlobs, 0);
  assert.match(second.report.metadataFreshness, /not a live repository visibility check/);
  for (const record of second.report.cachedMetadata) {
    assert.equal(record.cacheSource, options.output);
    assert.equal(record.status, 200);
    assert.ok(record.capturedAt);
    assert.equal(digest(fs.readFileSync(join(second.destination, record.raw))), record.sha256);
  }
  const third = await fetchNativeCliSource({
    ...options, output: join(dirname(options.output), 'offline-chain'),
    cacheFrom: [second.destination],
    fetchImpl: async () => assert.fail('Chained verified cache must not make network requests'),
  });
  assert.equal(third.exitCode, 2, JSON.stringify(third.report.errors));
  assert.equal(third.report.reusedVerifiedMetadata, second.report.reusedVerifiedMetadata);
  assert.equal(third.report.reusedVerifiedBlobs, first.report.uniqueBlobs);
  assert.deepEqual(third.report.cachedMetadata.map(record => record.capturedAt),
    second.report.cachedMetadata.map(record => record.capturedAt));
});

test('partial acquisition resumes only missing blobs without refetching pinned metadata', async t => {
  const options = fixture(t, ['0.3.30']);
  let count = 0;
  const first = await fetchNativeCliSource({
    ...options, concurrency: 1,
    fetchImpl: (...args) => args[0].includes('/git/blobs/') && ++count === 4 ?
      new Response('temporary unavailable', { status: 503 }) : options.fetchImpl(...args),
  });
  assert.equal(first.exitCode, 1);
  assert.equal(first.report.uniqueBlobs, 3);
  const oldReport = fs.readFileSync(first.reportPath);
  options.calls.length = 0;
  const second = await fetchNativeCliSource({
    ...options, output: join(dirname(options.output), 'resume'),
    cacheFrom: [options.output],
  });
  assert.equal(second.exitCode, 2, JSON.stringify(second.report.errors));
  assert.equal(second.report.reusedVerifiedMetadata, 3);
  assert.equal(second.report.reusedVerifiedBlobs, 3);
  assert.ok(options.calls.length > 0);
  assert.ok(options.calls.every(call => call.url.includes('/git/blobs/')));
  assert.deepEqual(fs.readFileSync(first.reportPath), oldReport);
});

test('legacy blob caches bind raw bytes to their original matching HTTP request hash', async t => {
  const options = fixture(t, ['0.3.30']);
  const first = await fetchNativeCliSource(options);
  const report = structuredClone(first.report);
  for (const blob of report.blobs) {
    delete blob.raw;
    delete blob.rawSha256;
  }
  const bytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(first.reportPath, bytes);
  fs.writeFileSync(join(options.output, 'report.sha256'), `${digest(bytes)}\n`);
  const second = await fetchNativeCliSource({
    ...options, output: join(dirname(options.output), 'legacy'),
    cacheFrom: [options.output],
    fetchImpl: async () => assert.fail('Legacy response hashes must support verified offline reuse'),
  });
  assert.equal(second.exitCode, 2, JSON.stringify(second.report.errors));
  assert.equal(second.report.reusedVerifiedBlobs, first.report.uniqueBlobs);
  for (const blob of second.report.blobs) {
    assert.equal(digest(fs.readFileSync(join(second.destination, blob.raw))), blob.rawSha256);
  }
});

for (const mode of ['missing-request', 'status', 'error', 'partial', 'raw', 'bytes', 'hash']) {
  test(`incomplete HTTP provenance (${mode}) is a cache miss, never an offline verified hit`, async t => {
    const options = fixture(t, ['0.3.30']);
    const first = await fetchNativeCliSource({ ...options, concurrency: 1 });
    assert.equal(first.exitCode, 2);
    const sha = first.report.blobs[0].sha;
    rewriteFixtureReport(first, report => {
      const record = report.requests.find(item => item.label === `blob-${sha}`);
      if (mode === 'missing-request') report.requests = report.requests.filter(item => item !== record);
      if (mode === 'status') record.status = 401;
      if (mode === 'error') record.error = 'Historical HTTP failure';
      if (mode === 'partial') record.partial = true;
      if (mode === 'raw') delete record.raw;
      if (mode === 'bytes') delete record.bytes;
      if (mode === 'hash') delete record.sha256;
    });
    const original = fs.readFileSync(first.reportPath);
    const raw = fs.readFileSync(join(first.destination, first.report.blobs[0].raw));
    const calls = [];
    const second = await fetchNativeCliSource({
      ...options, concurrency: 1, output: join(dirname(options.output), `missing-${mode}`),
      cacheFrom: [first.destination], fetchImpl: async (url, request) => {
        calls.push(url);
        assert.equal(url, `${CLI_SOURCE_API}/git/blobs/${sha}`,
          'Only the blob without HTTP provenance may be fetched');
        return options.fetchImpl(url, request);
      },
    });
    assert.equal(second.exitCode, 2, JSON.stringify(second.report.errors));
    assert.deepEqual(calls, [`${CLI_SOURCE_API}/git/blobs/${sha}`]);
    assert.equal(second.report.downloadedBlobs, 1);
    assert.equal(second.report.reusedVerifiedBlobs, first.report.uniqueBlobs - 1);
    assert.deepEqual(second.report.cacheMisses, [{
      cacheSource: first.destination, sha, reason: 'missing-successful-http-provenance',
    }]);
    assert.equal(second.report.requests.length, 1);
    assert.equal(second.report.requests[0].status, 200);
    assert.ok(second.report.cachedBlobRequests.every(item => item.label !== `blob-${sha}`));
    assert.deepEqual(fs.readFileSync(first.reportPath), original);
    assert.deepEqual(fs.readFileSync(join(first.destination, first.report.blobs[0].raw)), raw);
    const third = await fetchNativeCliSource({
      ...options, output: join(dirname(options.output), `missing-${mode}-chain`),
      cacheFrom: [second.destination],
      fetchImpl: async () => assert.fail('Genuinely reacquired HTTP evidence must resume offline'),
    });
    assert.equal(third.exitCode, 2, JSON.stringify(third.report.errors));
    assert.equal(third.report.reusedVerifiedBlobs, first.report.uniqueBlobs);
    assert.equal(third.report.requests.length, 0);
  });
}

for (const format of ['blob-api', 'public-raw']) {
  test(`old ${format} cached reports without retained HTTP provenance safely reacquire all blobs`, async t => {
    const options = fixture(t, ['0.3.30']);
    const raw = rawFixture(options);
    const fetchImpl = format === 'public-raw' ? raw.fetchImpl : options.fetchImpl;
    const first = await fetchNativeCliSource({ ...options, transport: format, fetchImpl });
    assert.equal(first.exitCode, 2);
    const second = await fetchNativeCliSource({
      ...options, output: join(dirname(options.output), 'legacy-cache'), cacheFrom: [first.destination],
      fetchImpl: async () => assert.fail('Initial valid cache must resume offline'),
    });
    assert.equal(second.exitCode, 2);
    rewriteFixtureReport(second, report => { delete report.cachedBlobRequests; });
    const original = fs.readFileSync(second.reportPath);
    const third = await fetchNativeCliSource({
      ...options, output: join(dirname(options.output), 'legacy-refetched'),
      cacheFrom: [second.destination], transport: format, fetchImpl,
    });
    assert.equal(third.exitCode, 2, JSON.stringify(third.report.errors));
    assert.equal(third.report.reusedVerifiedBlobs, 0);
    assert.equal(third.report.downloadedBlobs, first.report.uniqueBlobs);
    assert.equal(third.report.cacheMisses.length, first.report.uniqueBlobs);
    assert.equal(third.report.cachedBlobRequests.length, 0);
    assert.ok(third.report.cacheMisses.every(item => item.reason === 'missing-successful-http-provenance'));
    assert.deepEqual(fs.readFileSync(second.reportPath), original);
    const fourth = await fetchNativeCliSource({
      ...options, output: join(dirname(options.output), 'legacy-refetched-chain'),
      cacheFrom: [third.destination],
      fetchImpl: async () => assert.fail('Refetched evidence must restore a complete cache chain'),
    });
    assert.equal(fourth.exitCode, 2, JSON.stringify(fourth.report.errors));
    assert.equal(fourth.report.reusedVerifiedBlobs, first.report.uniqueBlobs);
    assert.equal(fourth.report.requests.length, 0);
  });
}

test('insufficient old HTTP provenance can fall through to a separately verified cache without network', async t => {
  const options = fixture(t, ['0.3.30']);
  const first = await fetchNativeCliSource(options);
  const second = await fetchNativeCliSource({
    ...options, output: join(dirname(options.output), 'complete-cache'), cacheFrom: [first.destination],
    fetchImpl: async () => assert.fail('Complete original HTTP evidence must resume offline'),
  });
  assert.equal(second.exitCode, 2);
  rewriteFixtureReport(first, report => {
    report.requests = report.requests.filter(item => !item.label.startsWith('blob-'));
  });
  const third = await fetchNativeCliSource({
    ...options, output: join(dirname(options.output), 'alternate-cache'),
    cacheFrom: [first.destination, second.destination],
    fetchImpl: async () => assert.fail('A valid alternative cache must avoid network requests'),
  });
  assert.equal(third.exitCode, 2, JSON.stringify(third.report.errors));
  assert.equal(third.report.requests.length, 0);
  assert.equal(third.report.downloadedBlobs, 0);
  assert.equal(third.report.reusedVerifiedBlobs, first.report.uniqueBlobs);
  assert.equal(third.report.cacheMisses.length, first.report.uniqueBlobs);
  assert.ok(third.report.cachedBlobRequests.every(record => record.cacheSource === second.destination));
});

const httpMutations = [
  ['url', record => { record.url = `${CLI_SOURCE_API}/git/blobs/${'f'.repeat(40)}`; },
    /HTTP source URL mismatch/],
  ['format', record => { record.rawFormat = record.rawFormat === 'bytes' ? 'json' : 'bytes'; },
    /HTTP response format mismatch/],
  ['attempt', record => { record.attempt = 6; }, /Invalid prior blob HTTP attempt/],
  ['size', record => { record.bytes++; }, /raw blob request size mismatch/],
  ['negative-size', record => { record.bytes = -1; }, /Invalid prior raw blob request size/],
  ['hash-length', record => { record.sha256 = 'a'.repeat(40); }, /lacks raw SHA-256 evidence/],
  ['hash', record => { record.sha256 = 'a'.repeat(64); }, /request hash mismatch/],
  ['path', record => { record.raw = 'evidence/../report.json'; }, /Prior blob request path mismatch/],
  ['shared-unsafe-path', (record, records, report) => {
    record.raw = 'evidence/../report.json';
    report.blobs.find(blob => `blob-${blob.sha}` === record.label).raw = record.raw;
  }, /Invalid prior raw blob evidence path/],
  ['duplicate', (record, records) => { records.push(structuredClone(record)); },
    /Ambiguous prior successful blob HTTP provenance/],
];

for (const transport of ['blob-api', 'public-raw']) {
  for (const generation of ['captured', 'cached']) {
    for (const [name, change, message] of httpMutations) {
      test(`${generation} ${transport} HTTP ${name} tampering fails closed before any network fallback`, async t => {
        const options = fixture(t, ['0.3.30']);
        const raw = rawFixture(options);
        let prior = await fetchNativeCliSource({
          ...options, concurrency: 1, transport,
          fetchImpl: transport === 'public-raw' ? raw.fetchImpl : options.fetchImpl,
        });
        assert.equal(prior.exitCode, 2);
        if (generation === 'cached') {
          prior = await fetchNativeCliSource({
            ...options, concurrency: 1, output: join(dirname(options.output), 'cached-generation'),
            cacheFrom: [prior.destination],
            fetchImpl: async () => assert.fail('Valid capture must be reusable offline'),
          });
          assert.equal(prior.exitCode, 2);
        }
        const sha = prior.report.blobs[0].sha;
        rewriteFixtureReport(prior, report => {
          const records = generation === 'cached' ? report.cachedBlobRequests : report.requests;
          change(records.find(item => item.label === `blob-${sha}`), records, report);
        });
        const original = fs.readFileSync(prior.reportPath);
        let calls = 0;
        const result = await fetchNativeCliSource({
          ...options, concurrency: 1, output: join(dirname(options.output), 'tampered-next'),
          cacheFrom: [prior.destination], fetchImpl: async () => {
            calls++;
            assert.fail('Conflicting HTTP evidence must fail, not silently reacquire');
          },
        });
        assert.equal(result.exitCode, 1);
        assert.equal(calls, 0);
        assert.match(result.report.errors[0].message, message);
        assert.equal(result.report.uniqueBlobs, 0);
        assert.equal(result.report.cachedBlobRequests.length, 0);
        assert.equal(fs.readdirSync(join(result.destination, 'receipts')).length, 0);
        assert.deepEqual(fs.readFileSync(prior.reportPath), original);
      });
    }
  }
}

const redirectMutations = [
  ['status', record => { record.initialResponse.status = 200; }, /redirect status/],
  ['url', record => { record.initialResponse.url = 'https://example.com/source'; },
    /initial raw source URL mismatch/],
  ['missing-location', record => { delete record.initialResponse.location; }, /redirect location/],
  ['foreign-location', record => { record.initialResponse.location = 'https://example.com/source'; },
    /Unexpected public raw redirect/],
  ['wrong-path', record => {
    record.initialResponse.location = record.initialResponse.location.replace(/\/raw\/[^/]+\//,
      `/raw/${'a'.repeat(40)}/`);
  }, /Unexpected public raw redirect/],
  ['final-url', record => { record.finalUrl += '&modified=1'; }, /final raw source URL mismatch/],
  ['unbound-final-url', record => { delete record.initialResponse; }, /Unbound prior raw redirect/],
  ['missing-final-url', record => { delete record.finalUrl; }, /final raw source URL mismatch/],
  ['path', record => { record.initialResponse.raw = 'evidence/../report.json'; },
    /raw redirect evidence path/],
  ['size', record => { record.initialResponse.bytes++; }, /raw redirect size mismatch/],
  ['hash-length', record => { record.initialResponse.sha256 = 'b'.repeat(40); },
    /raw redirect lacks SHA-256 evidence/],
  ['hash', record => { record.initialResponse.sha256 = 'b'.repeat(64); }, /raw redirect hash mismatch/],
  ['partial', record => { record.initialResponse.partial = true; }, /Incomplete prior raw redirect/],
  ['body', (record, destination) => {
    const path = join(destination, record.initialResponse.raw);
    const body = fs.readFileSync(path);
    body[0] ^= 1;
    fs.writeFileSync(path, body);
  }, /raw redirect hash mismatch/],
  ['missing-body', (record, destination) => {
    fs.unlinkSync(join(destination, record.initialResponse.raw));
  }, /ENOENT/],
];

for (const generation of ['captured', 'cached']) {
  for (const [name, change, message] of redirectMutations) {
    test(`${generation} raw redirect ${name} tampering cannot survive the next cache round`, async t => {
      const options = fixture(t, ['0.3.30']);
      const raw = rawFixture(options);
      let prior = await fetchNativeCliSource({
        ...options, concurrency: 1, transport: 'public-raw', fetchImpl: raw.fetchImpl,
      });
      assert.equal(prior.exitCode, 2);
      if (generation === 'cached') {
        prior = await fetchNativeCliSource({
          ...options, concurrency: 1, output: join(dirname(options.output), 'redirect-cache'),
          cacheFrom: [prior.destination],
          fetchImpl: async () => assert.fail('Valid raw HTTP evidence must resume offline'),
        });
        assert.equal(prior.exitCode, 2, JSON.stringify(prior.report.errors));
      }
      const sha = prior.report.blobs[0].sha;
      rewriteFixtureReport(prior, report => {
        const records = generation === 'cached' ? report.cachedBlobRequests : report.requests;
        change(records.find(item => item.label === `blob-${sha}`), prior.destination);
      });
      const original = fs.readFileSync(prior.reportPath);
      let calls = 0;
      const result = await fetchNativeCliSource({
        ...options, concurrency: 1, output: join(dirname(options.output), 'redirect-tampered-next'),
        cacheFrom: [prior.destination], fetchImpl: async () => {
          calls++;
          assert.fail('Invalid redirect evidence must not be silently refetched');
        },
      });
      assert.equal(result.exitCode, 1);
      assert.equal(calls, 0);
      assert.match(result.report.errors[0].message, message);
      assert.equal(result.report.uniqueBlobs, 0);
      assert.equal(result.report.cachedBlobRequests.length, 0);
      assert.equal(fs.readdirSync(join(result.destination, 'receipts')).length, 0);
      assert.deepEqual(fs.readFileSync(prior.reportPath), original);
    });
  }
}

for (const name of ['cache-source', 'cache-report-hash', 'capture-time']) {
  test(`cached HTTP ${name} stays consistent with its blob and original capture`, async t => {
    const options = fixture(t, ['0.3.30']);
    const first = await fetchNativeCliSource({ ...options, concurrency: 1 });
    const second = await fetchNativeCliSource({
      ...options, concurrency: 1, output: join(dirname(options.output), 'provenance-cache'),
      cacheFrom: [first.destination],
      fetchImpl: async () => assert.fail('Original complete cache must resume offline'),
    });
    assert.equal(second.exitCode, 2);
    rewriteFixtureReport(second, report => {
      const record = report.cachedBlobRequests[0];
      if (name === 'cache-source') record.cacheSource = join(dirname(options.output), 'unrelated-cache');
      if (name === 'cache-report-hash') record.cacheReportSha256 = 'f'.repeat(40);
      if (name === 'capture-time') record.capturedAt = '2000-01-01T00:00:00.000Z';
    });
    const result = await fetchNativeCliSource({
      ...options, concurrency: 1, output: join(dirname(options.output), 'provenance-tampered'),
      cacheFrom: [second.destination],
      fetchImpl: async () => assert.fail('Contradictory origin evidence must not be refetched'),
    });
    assert.equal(result.exitCode, 1);
    assert.match(result.report.errors[0].message, name === 'cache-source' ?
      /cache source mismatch/ : name === 'cache-report-hash' ?
        /cache report hash/ : /capture time mismatch/);
    assert.equal(result.report.uniqueBlobs, 0);
  });
}

for (const mutation of ['bytes', 'hash', 'path', 'size']) {
  test(`cached metadata with altered ${mutation} fails closed without network fallback`, async t => {
    const options = fixture(t, ['0.3.30']);
    const first = await fetchNativeCliSource(options);
    const report = structuredClone(first.report);
    const record = report.requests.find(item => item.label === 'repository');
    if (mutation === 'bytes') fs.appendFileSync(join(options.output, record.raw), '\n');
    if (mutation === 'hash') record.sha256 = '0'.repeat(64);
    if (mutation === 'path') record.raw = 'evidence/../report.json';
    if (mutation === 'size') record.bytes++;
    const bytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`);
    fs.writeFileSync(first.reportPath, bytes);
    fs.writeFileSync(join(options.output, 'report.sha256'), `${digest(bytes)}\n`);
    let calls = 0;
    const second = await fetchNativeCliSource({
      ...options, output: join(dirname(options.output), 'bad-cache'),
      cacheFrom: [options.output], fetchImpl: async () => {
        calls++;
        assert.fail('Corrupted metadata must not silently refetch');
      },
    });
    assert.equal(second.exitCode, 1);
    assert.equal(calls, 0);
    assert.match(second.report.errors[0].message, /Prior raw response|Invalid prior raw response/);
    assert.equal(second.report.uniqueBlobs, 0);
    assert.equal(fs.readdirSync(join(second.destination, 'receipts')).length, 0);
  });
}

test('cached tree completeness is reverified even if its response hash is recomputed', async t => {
  const options = fixture(t, ['0.3.30']);
  const first = await fetchNativeCliSource(options);
  const report = structuredClone(first.report);
  const record = report.requests.find(item => item.label === 'tree-0.3.30');
  const path = join(options.output, record.raw);
  const tree = JSON.parse(fs.readFileSync(path));
  tree.tree = tree.tree.filter(entry => entry.path !== 'packages/cli/src/index.ts');
  const response = Buffer.from(JSON.stringify(tree));
  fs.writeFileSync(path, response);
  record.bytes = response.length;
  record.sha256 = digest(response);
  const bytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`);
  fs.writeFileSync(first.reportPath, bytes);
  fs.writeFileSync(join(options.output, 'report.sha256'), `${digest(bytes)}\n`);
  const second = await fetchNativeCliSource({
    ...options, output: join(dirname(options.output), 'altered-tree'),
    cacheFrom: [options.output],
    fetchImpl: async () => assert.fail('Tree must fail before any new requests'),
  });
  assert.equal(second.exitCode, 1);
  assert.match(second.report.errors[0].message, /Incomplete or altered tree/);
  assert.equal(second.report.uniqueBlobs, 0);
});

test('cached blob response hashes are bound even when decoded Git bytes still match', async t => {
  const options = fixture(t, ['0.3.30']);
  const first = await fetchNativeCliSource(options);
  const record = first.report.blobs[0];
  const path = join(options.output, record.raw);
  fs.appendFileSync(path, '\n');
  assert.doesNotThrow(() => JSON.parse(fs.readFileSync(path)));
  const second = await fetchNativeCliSource({
    ...options, output: join(dirname(options.output), 'altered-response'),
    cacheFrom: [options.output], concurrency: 1,
    fetchImpl: async () => assert.fail('Corrupt blob evidence must not silently refetch'),
  });
  assert.equal(second.exitCode, 1);
  assert.match(second.report.errors[0].message, /Prior raw blob response hash mismatch/);
  assert.equal(second.report.downloadedBlobs, 0);
  assert.ok(second.report.releases.every(release => release.sourceComplete === false));
});

test('corrupt prior cache bytes fail closed and do not get overwritten or silently refetched', async t => {
  const options = fixture(t, ['0.3.30']);
  const first = await fetchNativeCliSource(options);
  const record = first.report.blobs[0];
  const file = join(options.output, record.cached);
  fs.writeFileSync(file, 'corrupt prior bytes');
  options.calls.length = 0;
  const second = await fetchNativeCliSource({
    ...options, output: join(dirname(options.output), 'second'),
    cacheFrom: [options.output], concurrency: 1,
  });
  assert.equal(second.exitCode, 1);
  assert.match(second.report.errors[0].message, /Prior cached/);
  assert.equal(fs.readFileSync(file, 'utf8'), 'corrupt prior bytes');
  assert.equal(options.calls.filter(call => call.url.includes('/git/blobs/')).length, 0);
  assert.ok(second.report.releases.every(release => release.sourceComplete === false));
});
