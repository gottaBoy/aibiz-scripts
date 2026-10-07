#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { dirname, join, posix, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { optionalStat, PinnedDirectories, readPinnedFile, readTree } from './native-candidate-files.mjs';

export const CLI_SOURCE_API = 'https://gitee.com/api/v5/repos/iBizModeling/ibiz-template-cli';
export const CLI_SOURCE_RAW = 'https://gitee.com/iBizModeling/ibiz-template-cli/raw';
export const CLI_SOURCE_RELEASES = Object.freeze([
  { version: '0.3.0', commit: '15ab40e917b0c0bde9a3b7473f3ca30a37cd116c',
    tree: '01e9c0943d83e8fc1f55ebb1866b28cf24d79fe4' },
  { version: '0.3.23', commit: 'a592a88de74abb9985e99a53d452d413d370ad7c',
    tree: '305b5108f73846807fdcb68d9579159fe58cc07e' },
  { version: '0.3.30', commit: '2277d0680777d5d147d912fecab779a6747807eb',
    tree: '05e1c337cac5dacce68b7a9db704b35fc3cbff87' },
].map(pin => Object.freeze(pin)));
const defaultWorkspace = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = data => createHash('sha256').update(data).digest('hex');
const validSha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);
const MAX_BLOB_BYTES = 8 * 1024 * 1024;
const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;
const MAX_SOURCE_BYTES = 128 * 1024 * 1024;
const jsonBytes = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);

export function gitObjectHash(type, bytes) {
  return createHash('sha1').update(`${type} ${bytes.length}\0`).update(bytes).digest('hex');
}

export function validateSourcePath(path) {
  assert.ok(typeof path === 'string' && path.length > 0 && path.length <= 4096 &&
    !path.includes('\\') && !/[\x00-\x1f\x7f]/.test(path) && !/^[A-Za-z]:/.test(path),
  'Invalid source path');
  assert.ok(path.split('/').every(part => part && part !== '.' && part !== '..' &&
    part.toLowerCase() !== '.git'), `Unsafe source path: ${path}`);
  return path;
}

export function protectedSourcePath(path) {
  return path.split('/').some(part => /^(?:\.npmrc|\.netrc|\.git-credentials|credentials(?:\..*)?|id_(?:rsa|dsa|ecdsa|ed25519)|\.env(?:\..*)?)$/i.test(part) ||
    /\.(?:pem|p12|pfx|key)$/i.test(part));
}

// Reconstruct every directory object: truncated=false alone does not establish completeness.
export function verifySourceTree(document, expectedSha) {
  assert.ok(validSha(expectedSha) && document?.sha === expectedSha, 'Tree SHA mismatch');
  assert.equal(document.truncated, false, 'Truncated or unspecified tree rejected');
  assert.ok(Array.isArray(document.tree) && document.tree.length <= 20000, 'Invalid source tree');
  const entries = new Map();
  let sourceBytes = 0;
  for (const entry of document.tree) {
    validateSourcePath(entry.path);
    assert.ok(!entries.has(entry.path), `Duplicate source path: ${entry.path}`);
    assert.ok(validSha(entry.sha), `Invalid object SHA: ${entry.path}`);
    if (entry.type === 'tree') {
      assert.ok(entry.mode === '40000' || entry.mode === '040000',
        `Unsupported tree mode: ${entry.path}`);
    } else {
      assert.ok(entry.type === 'blob' && ['100644', '100755'].includes(entry.mode),
        `Symlink, gitlink or unsupported entry rejected: ${entry.path}`);
      assert.ok(Number.isSafeInteger(entry.size) && entry.size >= 0 &&
        entry.size <= MAX_BLOB_BYTES, `Invalid blob size: ${entry.path}`);
      sourceBytes += entry.size;
    }
    entries.set(entry.path, { ...entry, mode: entry.type === 'tree' ? '40000' : entry.mode });
  }
  assert.ok(sourceBytes <= MAX_SOURCE_BYTES, 'Source tree too large');
  const children = new Map([['', []]]);
  for (const entry of entries.values()) {
    if (entry.type === 'tree') children.set(entry.path, []);
  }
  for (const entry of entries.values()) {
    const parent = posix.dirname(entry.path) === '.' ? '' : posix.dirname(entry.path);
    assert.ok(children.has(parent), `Missing parent tree: ${entry.path}`);
    children.get(parent).push(entry);
  }
  for (const [path, items] of [...children].sort((a, b) => b[0].split('/').length -
    a[0].split('/').length || b[0].length - a[0].length)) {
    items.sort((a, b) => Buffer.compare(
      Buffer.from(posix.basename(a.path) + (a.type === 'tree' ? '/' : '')),
      Buffer.from(posix.basename(b.path) + (b.type === 'tree' ? '/' : ''))));
    const bytes = Buffer.concat(items.flatMap(entry => [
      Buffer.from(`${entry.mode} ${posix.basename(entry.path)}\0`),
      Buffer.from(entry.sha, 'hex'),
    ]));
    assert.equal(gitObjectHash('tree', bytes), path ? entries.get(path).sha : expectedSha,
      `Incomplete or altered tree: ${path || '/'}`);
  }
  return [...entries.values()].sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
}

export function verifySourceBlob(document, expectedSha, expectedSize) {
  assert.ok(document?.sha === expectedSha && validSha(expectedSha), 'Blob SHA mismatch');
  assert.equal(document.encoding, 'base64', 'Unexpected blob encoding');
  assert.ok(typeof document.content === 'string', 'Missing blob content');
  const encoded = document.content.replace(/[ \t\r\n]/g, '');
  assert.ok(/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded),
    'Invalid blob base64');
  const bytes = Buffer.from(encoded, 'base64');
  assert.equal(bytes.toString('base64'), encoded, 'Noncanonical blob base64');
  assert.ok(bytes.length <= MAX_BLOB_BYTES, 'Blob too large');
  assert.equal(bytes.length, expectedSize, 'Blob size differs from tree');
  assert.equal(document.size, bytes.length, 'Blob API size mismatch');
  assert.equal(gitObjectHash('blob', bytes), expectedSha, 'Git blob hash mismatch');
  return bytes;
}

export function publicRawUrl(commit, path) {
  assert.ok(validSha(commit), 'Invalid raw source commit');
  validateSourcePath(path);
  return `${CLI_SOURCE_RAW}/${commit}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

export function validateRawRedirect(location, sourceUrl) {
  const source = new URL(sourceUrl);
  const target = new URL(location, source);
  assert.ok(source.origin === 'https://gitee.com' &&
    source.pathname.startsWith('/iBizModeling/ibiz-template-cli/raw/'),
  'Unexpected raw source origin');
  assert.ok(target.origin === 'https://raw.giteeusercontent.com' &&
    target.pathname === source.pathname && !target.username && !target.password && !target.hash,
  'Unexpected public raw redirect');
  return target.href;
}

function verifyRawBlob(bytes, expectedSha, expectedSize) {
  assert.equal(bytes.length, expectedSize, 'Raw blob size differs from tree');
  assert.equal(gitObjectHash('blob', bytes), expectedSha, 'Raw Git blob hash mismatch');
  return bytes;
}

async function responseBytes(response) {
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_RESPONSE_BYTES) {
        const error = new Error('Public API response too large');
        error.partial = Buffer.concat(chunks);
        throw error;
      }
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  } catch (error) {
    error.partial ??= Buffer.concat(chunks);
    throw error;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

function writeSourceFile(directories, root, entry, bytes) {
  const parent = directories.open(join(root, posix.dirname(entry.path)), { create: true });
  const name = posix.basename(entry.path);
  const identity = directories.write(parent, name, bytes);
  const descriptor = fs.openSync(directories.entry(parent, name),
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const actual = fs.fstatSync(descriptor);
    assert.ok(actual.dev === identity.dev && actual.ino === identity.ino,
      `Source file changed: ${entry.path}`);
    fs.fchmodSync(descriptor, entry.mode === '100755' ? 0o755 : 0o644);
  } finally { fs.closeSync(descriptor); }
  directories.verify(parent);
}

export async function fetchNativeCliSource({
  workspace = defaultWorkspace, output, fetchImpl = globalThis.fetch,
  releases = CLI_SOURCE_RELEASES, concurrency = 3, attempts = 3, timeoutMs = 15000,
  retryDelayMs = 60000, requestIntervalMs = 1000, cacheFrom = [], onProgress = () => {},
  transport = 'blob-api',
} = {}) {
  workspace = resolve(workspace);
  const artifactRoot = join(workspace, '.artifacts/native-cli-source-fetch');
  output = resolve(output ?? join(artifactRoot, `fetch-${randomUUID()}`));
  assert.equal(dirname(output), artifactRoot,
    'Output must be a direct child of .artifacts/native-cli-source-fetch');
  assert.ok(Number.isInteger(concurrency) && concurrency >= 1 && concurrency <= 8,
    'Concurrency must be between 1 and 8');
  assert.ok(Number.isInteger(attempts) && attempts >= 1 && attempts <= 5, 'Invalid attempt limit');
  assert.ok(Number.isFinite(timeoutMs) && timeoutMs > 0, 'Invalid request timeout');
  assert.ok(Number.isFinite(retryDelayMs) && retryDelayMs >= 0, 'Invalid retry delay');
  assert.ok(Number.isFinite(requestIntervalMs) && requestIntervalMs >= 0 &&
    requestIntervalMs <= 60000, 'Invalid request interval');
  assert.ok(Array.isArray(cacheFrom), 'Cache sources must be an array');
  assert.ok(['blob-api', 'public-raw'].includes(transport), 'Invalid blob transport');
  const cachePaths = cacheFrom.map(path => resolve(path));
  for (const path of cachePaths) {
    assert.ok(dirname(path) === artifactRoot && path !== output,
      'Cache source must be another candidate under .artifacts/native-cli-source-fetch');
  }
  assert.ok(Array.isArray(releases) && releases.length > 0 &&
    new Set(releases.map(pin => pin.version)).size === releases.length, 'Invalid release pins');
  for (const pin of releases) {
    assert.ok(/^\d+\.\d+\.\d+$/.test(pin.version) && validSha(pin.commit) && validSha(pin.tree),
      'Invalid release pin');
  }
  const directories = new PinnedDirectories();
  const report = {
    schemaVersion: 1, contract: 'public-pinned-native-cli-source-fetch',
    startedAt: new Date().toISOString(), destination: output, repository: CLI_SOURCE_API,
    sourceOnly: true, buildsExecuted: false, installsExecuted: false,
    nativeAccepted: false, acceptedForProduction: false, fullLocalization: false,
    toolchainSourceBuilt: false, originalVersionReproductionVerified: false,
    trustBoundary: 'Trusted artifact ancestors and cooperative single writer; no arbitrary concurrent replacement guarantee',
    protectedInputPolicy: 'Never fetch or read npmrc/credential-like paths or their shared blob identities',
    cacheScope: 'Fresh candidate; prior public metadata and blob responses rehashed, trees and blobs reverified by pinned Git SHA; never prior source trees or shared installations',
    metadataFreshness: 'Cached public snapshots are acquisition evidence, not a live repository visibility check',
    cacheSources: cachePaths,
    requestPolicy: { concurrency, attempts, timeoutMs, retryDelayMs, requestIntervalMs, transport },
    requests: [], cachedMetadata: [], cachedBlobRequests: [], cacheMisses: [],
    blobs: [], releases: releases.map(pin => ({
      ...pin, status: 'not-started', sourceComplete: false, materializedFiles: 0,
    })),
    errors: [],
  };
  let created = false;
  let active;
  let evidence;
  let blobDirectory;
  let receiptDirectory;
  const cache = new Map();
  const priorCaches = [];
  let cacheHits = 0;
  let requestTurn = Promise.resolve();
  let nextRequestAt = 0;
  function paceRequest() {
    const turn = requestTurn.then(async () => {
      for (let wait = nextRequestAt - performance.now(); wait > 0;
        wait = nextRequestAt - performance.now()) {
        await sleep(wait);
      }
      nextRequestAt = performance.now() + requestIntervalMs;
    });
    requestTurn = turn.catch(() => {});
    return turn;
  }
  async function capture(label, route, { rawUrl } = {}) {
    const url = rawUrl ?? `${CLI_SOURCE_API}${route}`;
    const rawFormat = rawUrl ? 'bytes' : 'json';
    for (let attempt = 1; attempt <= attempts; attempt++) {
      await paceRequest();
      const record = { label, url, attempt, startedAt: new Date().toISOString() };
      report.requests.push(record);
      let retryable = true;
      try {
        const options = {
          redirect: 'manual', credentials: 'omit',
          headers: { Accept: rawUrl ? 'application/octet-stream' : 'application/json' },
          signal: AbortSignal.timeout(timeoutMs),
        };
        let response = await fetchImpl(url, options);
        if (rawUrl && [301, 302, 307, 308].includes(response.status)) {
          const location = response.headers.get('location');
          const raw = `evidence/${label}-attempt-${attempt}.redirect.response.bin`;
          record.status = response.status;
          record.location = location;
          record.initialResponse = { status: response.status, url, location, raw };
          retryable = false;
          let redirectBytes;
          try { redirectBytes = await responseBytes(response); }
          catch (error) {
            if (error.partial) {
              record.partial = true;
              Object.assign(record.initialResponse, {
                partial: true, bytes: error.partial.length, sha256: sha256(error.partial),
              });
              directories.write(evidence, posix.basename(raw), error.partial);
            }
            throw error;
          }
          Object.assign(record.initialResponse, {
            bytes: redirectBytes.length, sha256: sha256(redirectBytes),
          });
          directories.write(evidence, posix.basename(raw), redirectBytes);
          assert.ok(location, 'Missing public raw redirect location');
          // Reject unsafe redirects only after retaining and releasing their body.
          record.finalUrl = validateRawRedirect(location, url);
          await paceRequest();
          retryable = true;
          response = await fetchImpl(record.finalUrl, {
            ...options, signal: AbortSignal.timeout(timeoutMs),
          });
        }
        record.status = response.status;
        record.contentType = response.headers.get('content-type');
        record.location = response.headers.get('location');
        record.retryAfter = response.headers.get('retry-after');
        record.rateLimit = Object.fromEntries(
          ['x-ratelimit-limit', 'x-ratelimit-remaining', 'x-ratelimit-reset']
            .map(name => [name, response.headers.get(name)]).filter(([, value]) => value !== null));
        let bytes;
        try { bytes = await responseBytes(response); }
        catch (error) {
          if (error.partial) {
            record.partial = true;
            record.bytes = error.partial.length;
            record.sha256 = sha256(error.partial);
            record.raw = `evidence/${label}-attempt-${attempt}.response.${rawUrl ? 'bin' : 'json'}`;
            directories.write(evidence, posix.basename(record.raw), error.partial);
          }
          throw error;
        }
        record.bytes = bytes.length;
        record.sha256 = sha256(bytes);
        record.rawFormat = rawFormat;
        record.raw = `evidence/${label}-attempt-${attempt}.response.${rawUrl ? 'bin' : 'json'}`;
        directories.write(evidence, posix.basename(record.raw), bytes);
        if (response.status !== 200) {
          const rateLimited = response.status === 403 &&
            bytes.toString('utf8').trim() === '403 Forbidden (Rate Limit Exceeded)';
          retryable = response.status === 429 || response.status >= 500 || rateLimited;
          record.retryReason = rateLimited || response.status === 429 ? 'public-rate-limit' :
            response.status >= 500 ? 'server-error' : 'not-retryable';
          throw new Error(`${label}: HTTP ${response.status}`);
        }
        retryable = false;
        return rawUrl ? bytes : JSON.parse(bytes.toString('utf8'));
      } catch (error) {
        record.error = error.message;
        if (error.cause?.code) record.causeCode = error.cause.code;
        if (!retryable) throw error;
        const retryAfter = record.retryAfter == null ? NaN : Number(record.retryAfter);
        const dateDelay = record.retryAfter == null ? NaN : Date.parse(record.retryAfter) - Date.now();
        const headerDelay = Number.isFinite(retryAfter) && retryAfter >= 0 ?
          retryAfter * 1000 : Number.isFinite(dateDelay) ? Math.max(0, dateDelay) : 0;
        const delay = Math.max(retryDelayMs * attempt, headerDelay);
        assert.ok(Number.isFinite(delay) && delay <= 300000,
          'Retry wait exceeds five minutes; retry later');
        record.retryDelayMs = delay;
        if (record.retryReason === 'public-rate-limit') {
          nextRequestAt = Math.max(nextRequestAt, performance.now() + delay);
        }
        if (attempt === attempts) throw error;
        onProgress(`Retrying ${label} after ${delay}ms: ${record.error}`);
        await sleep(delay);
      } finally { record.finishedAt = new Date().toISOString(); }
    }
  }
  function cachedRaw(prior, record, label) {
    assert.ok(typeof record.raw === 'string' && record.raw.startsWith('evidence/') &&
      new RegExp(`^${label}-(?:attempt-[1-5]|cache)\\.response\\.json$`)
        .test(record.raw.slice('evidence/'.length)), 'Invalid prior raw response evidence path');
    const bytes = readPinnedFile(directories, prior.evidence, posix.basename(record.raw)).data;
    assert.ok(bytes.length <= MAX_RESPONSE_BYTES, 'Prior response too large');
    assert.equal(bytes.length, record.bytes, 'Prior raw response size mismatch');
    assert.ok(typeof record.sha256 === 'string' && /^[a-f0-9]{64}$/.test(record.sha256),
      'Prior raw response lacks SHA-256 evidence');
    assert.equal(sha256(bytes), record.sha256, 'Prior raw response hash mismatch');
    return bytes;
  }
  async function metadata(label, route) {
    const url = `${CLI_SOURCE_API}${route}`;
    for (const prior of priorCaches) {
      const record = [...prior.report.requests, ...(prior.report.cachedMetadata ?? [])]
        .find(item => item.label === label && item.url === url &&
          item.status === 200 && !item.error && !item.partial);
      if (!record) continue;
      const bytes = cachedRaw(prior, record, label);
      const document = JSON.parse(bytes.toString('utf8'));
      const raw = `evidence/${label}-cache.response.json`;
      directories.write(evidence, posix.basename(raw), bytes);
      report.cachedMetadata.push({
        label, url, status: 200, bytes: bytes.length, sha256: sha256(bytes), raw,
        cacheSource: prior.path,
        capturedAt: record.capturedAt ?? record.startedAt,
        reusedAt: new Date().toISOString(),
      });
      onProgress(`Reverified cached public metadata: ${label}`);
      return document;
    }
    return capture(label, route);
  }
  function cacheMiss(prior, entry, reason) {
    report.cacheMisses.push({ cacheSource: prior.path, sha: entry.sha, reason });
  }
  function cachedBlobRequest(prior, previous, entry, rawFormat, sourceUrl) {
    const label = `blob-${entry.sha}`;
    const records = [...prior.report.requests, ...(prior.report.cachedBlobRequests ?? [])]
      .filter(record => record.label === label &&
        record.status === 200 && !record.error && !record.partial);
    assert.ok(records.length <= 1, 'Ambiguous prior successful blob HTTP provenance');
    const record = records[0];
    if (!record || record.raw === undefined || record.bytes === undefined ||
      record.sha256 === undefined || (rawFormat === 'bytes' && record.rawFormat === undefined)) {
      cacheMiss(prior, entry, 'missing-successful-http-provenance');
      return null;
    }
    assert.equal(record.url, sourceUrl, 'Prior blob HTTP source URL mismatch');
    assert.equal(record.rawFormat ?? 'json', rawFormat, 'Prior blob HTTP response format mismatch');
    assert.ok(Number.isInteger(record.attempt) && record.attempt >= 1 && record.attempt <= 5,
      'Invalid prior blob HTTP attempt');
    const fromCache = prior.report.cachedBlobRequests?.includes(record);
    if (fromCache) {
      assert.ok(typeof record.cacheSource === 'string' && dirname(record.cacheSource) === artifactRoot,
        'Invalid prior blob HTTP cache source');
      assert.equal(previous.cacheSource, record.cacheSource, 'Prior blob HTTP cache source mismatch');
      assert.ok(typeof record.cacheReportSha256 === 'string' &&
        /^[a-f0-9]{64}$/.test(record.cacheReportSha256), 'Invalid prior blob HTTP cache report hash');
      assert.equal(record.capturedAt, record.startedAt, 'Prior blob HTTP capture time mismatch');
    }
    const raw = previous.raw ?? record.raw;
    assert.ok(typeof raw === 'string' && new RegExp(
      `^evidence/${label}-(?:attempt-[1-5]|cache)\\.response\\.${rawFormat === 'bytes' ? 'bin' : 'json'}$`)
      .test(raw), 'Invalid prior raw blob evidence path');
    assert.equal(record.raw, raw, 'Prior blob request path mismatch');
    assert.equal(raw, `evidence/${label}-${fromCache ? 'cache' : `attempt-${record.attempt}`}` +
      `.response.${rawFormat === 'bytes' ? 'bin' : 'json'}`, 'Prior blob HTTP evidence kind mismatch');
    assert.ok(Number.isSafeInteger(record.bytes) && record.bytes >= 0 &&
      record.bytes <= MAX_RESPONSE_BYTES, 'Invalid prior raw blob request size');
    assert.ok(typeof record.sha256 === 'string' && /^[a-f0-9]{64}$/.test(record.sha256),
      'Prior blob lacks raw SHA-256 evidence');
    if (previous.rawSha256 !== undefined) {
      assert.equal(previous.rawSha256, record.sha256, 'Prior blob request hash mismatch');
    }
    const bytes = readPinnedFile(directories, prior.evidence, posix.basename(raw)).data;
    assert.equal(sha256(bytes), record.sha256, 'Prior raw blob response hash mismatch');
    assert.equal(bytes.length, record.bytes, 'Prior raw blob request size mismatch');
    let redirectBytes;
    if (record.initialResponse !== undefined) {
      assert.equal(rawFormat, 'bytes', 'Unexpected prior blob HTTP redirect');
      const initial = record.initialResponse;
      assert.ok(initial && !initial.error && !initial.partial, 'Incomplete prior raw redirect evidence');
      assert.equal(initial.url, sourceUrl, 'Prior initial raw source URL mismatch');
      assert.ok([301, 302, 307, 308].includes(initial.status), 'Invalid prior raw redirect status');
      assert.ok(typeof initial.location === 'string' && initial.location.length > 0,
        'Missing prior public raw redirect location');
      assert.equal(record.finalUrl, validateRawRedirect(initial.location, sourceUrl),
        'Prior final raw source URL mismatch');
      assert.equal(initial.raw,
        `evidence/${label}-attempt-${record.attempt}.redirect.response.bin`,
        'Invalid prior raw redirect evidence path');
      assert.ok(Number.isSafeInteger(initial.bytes) && initial.bytes >= 0 &&
        initial.bytes <= MAX_RESPONSE_BYTES, 'Invalid prior raw redirect size');
      assert.ok(typeof initial.sha256 === 'string' && /^[a-f0-9]{64}$/.test(initial.sha256),
        'Prior raw redirect lacks SHA-256 evidence');
      redirectBytes = readPinnedFile(directories, prior.evidence,
        posix.basename(initial.raw)).data;
      assert.equal(redirectBytes.length, initial.bytes, 'Prior raw redirect size mismatch');
      assert.equal(sha256(redirectBytes), initial.sha256, 'Prior raw redirect hash mismatch');
    } else assert.ok(!record.finalUrl, 'Unbound prior raw redirect');
    return { record, bytes, redirectBytes };
  }
  async function blob(entry, release) {
    if (!cache.has(entry.sha)) {
      cache.set(entry.sha, (async () => {
        for (const prior of priorCaches) {
          const name = `${entry.sha}.bin`;
          const info = optionalStat(directories.entry(prior.blobs, name));
          if (!info) continue;
          const { data } = readPinnedFile(directories, prior.blobs, name, info);
          assert.equal(data.length, entry.size, 'Prior cached blob size mismatch');
          assert.equal(gitObjectHash('blob', data), entry.sha, 'Prior cached Git blob hash mismatch');
          const matches = prior.report.blobs.filter(record => record.sha === entry.sha);
          assert.ok(matches.length <= 1, 'Ambiguous prior blob evidence');
          const previous = matches[0];
          assert.ok(previous, 'Prior cache lacks blob evidence');
          assert.equal(previous.cached, `blobs/${name}`, 'Invalid prior cached blob path');
          assert.equal(previous.bytes, data.length, 'Prior cached blob evidence size mismatch');
          assert.equal(previous.sha256, sha256(data), 'Prior cached blob evidence hash mismatch');
          const rawFormat = previous.rawFormat ?? 'json';
          assert.ok(['json', 'bytes'].includes(rawFormat), 'Invalid prior blob response format');
          const sourceUrl = rawFormat === 'bytes' ? previous.sourceUrl :
            `${CLI_SOURCE_API}/git/blobs/${entry.sha}`;
          if (rawFormat === 'json' && previous.sourceUrl !== undefined) {
            assert.equal(previous.sourceUrl, sourceUrl, 'Prior blob source URL mismatch');
          }
          const http = cachedBlobRequest(prior, previous, entry, rawFormat, sourceUrl);
          if (!http) continue;
          let sourceEntry;
          if (rawFormat === 'bytes') {
            validateSourcePath(previous.sourcePath);
            assert.equal(previous.transport, 'public-raw', 'Invalid prior raw source transport');
            sourceEntry = prior.report.releases.find(pin =>
              sourceUrl === publicRawUrl(pin.commit, previous.sourcePath));
            assert.ok(sourceEntry, 'Prior raw source URL differs from pinned source');
            const treeRecord = [...prior.report.requests, ...(prior.report.cachedMetadata ?? [])]
              .find(record => record.label === `tree-${sourceEntry.version}` &&
                record.url === `${CLI_SOURCE_API}/git/trees/${sourceEntry.tree}?recursive=1` &&
                record.status === 200 && !record.error && !record.partial);
            assert.ok(treeRecord, 'Prior raw blob lacks pinned tree evidence');
            const treeDocument = JSON.parse(cachedRaw(prior, treeRecord,
              `tree-${sourceEntry.version}`).toString('utf8'));
            const original = verifySourceTree(treeDocument, sourceEntry.tree)
              .find(item => item.path === previous.sourcePath);
            assert.ok(original?.type === 'blob' && original.sha === entry.sha &&
              original.size === entry.size && !protectedSourcePath(original.path),
            'Prior raw blob path differs from pinned tree');
          } else {
            assert.equal(previous.transport ?? 'blob-api', 'blob-api',
              'Invalid prior blob API transport');
          }
          const original = http.bytes;
          const decoded = rawFormat === 'bytes' ? verifyRawBlob(original, entry.sha, entry.size) :
            verifySourceBlob(JSON.parse(original.toString('utf8')), entry.sha, entry.size);
          assert.deepEqual(decoded, data, 'Prior cached blob differs from raw evidence');
          // A narrower candidate cannot authenticate an origin release it does not retain.
          if (sourceEntry && !report.releases.some(pin => pin.version === sourceEntry.version &&
            pin.commit === sourceEntry.commit && pin.tree === sourceEntry.tree)) {
            cacheMiss(prior, entry, 'raw-origin-release-not-in-current-candidate');
            continue;
          }
          const rawName = `blob-${entry.sha}-cache.response.${rawFormat === 'bytes' ? 'bin' : 'json'}`;
          directories.write(evidence, rawName, original);
          if (http.redirectBytes !== undefined) {
            directories.write(evidence, posix.basename(http.record.initialResponse.raw),
              http.redirectBytes);
          }
          report.cachedBlobRequests.push({
            ...http.record, raw: `evidence/${rawName}`, cacheSource: prior.path,
            cacheReportSha256: prior.reportSha256,
            capturedAt: http.record.capturedAt ?? http.record.startedAt,
            reusedAt: new Date().toISOString(),
          });
          const identity = directories.write(blobDirectory, name, data);
          report.blobs.push({
            sha: entry.sha, bytes: data.length, sha256: sha256(data), verifiedGitBlob: true,
            cached: `blobs/${name}`, raw: `evidence/${rawName}`, rawSha256: sha256(original),
            cacheSource: prior.path,
            rawFormat, transport: rawFormat === 'bytes' ? 'public-raw' : 'blob-api',
            ...(rawFormat === 'bytes' ? { sourceUrl, sourcePath: previous.sourcePath } : {}),
          });
          return identity;
        }
        const sourceUrl = transport === 'public-raw' ? publicRawUrl(release.commit, entry.path) : null;
        const document = await capture(`blob-${entry.sha}`, `/git/blobs/${entry.sha}`,
          sourceUrl ? { rawUrl: sourceUrl } : {});
        const bytes = sourceUrl ? verifyRawBlob(document, entry.sha, entry.size) :
          verifySourceBlob(document, entry.sha, entry.size);
        const identity = directories.write(blobDirectory, `${entry.sha}.bin`, bytes);
        const request = report.requests.find(record => record.label === `blob-${entry.sha}` &&
          record.status === 200 && !record.error);
        report.blobs.push({ sha: entry.sha, bytes: bytes.length, sha256: sha256(bytes),
          verifiedGitBlob: true, cached: `blobs/${entry.sha}.bin`,
          raw: request.raw, rawSha256: request.sha256,
          rawFormat: sourceUrl ? 'bytes' : 'json', transport,
          ...(sourceUrl ? { sourceUrl, sourcePath: entry.path } : {}),
        });
        return identity;
      })());
    } else cacheHits++;
    const identity = await cache.get(entry.sha);
    const { data } = readPinnedFile(directories, blobDirectory, `${entry.sha}.bin`, identity);
    assert.equal(data.length, entry.size, 'Cached blob size mismatch');
    assert.equal(gitObjectHash('blob', data), entry.sha, 'Cached Git blob hash mismatch');
    return data;
  }
  try {
    directories.open(output, { create: true, exclusive: true });
    created = true;
    evidence = directories.open(join(output, 'evidence'), { create: true });
    blobDirectory = directories.open(join(output, 'blobs'), { create: true });
    receiptDirectory = directories.open(join(output, 'receipts'), { create: true });
    for (const path of cachePaths) {
      const directory = directories.open(path);
      const original = readPinnedFile(directories, directory, 'report.json').data;
      const digest = readPinnedFile(directories, directory, 'report.sha256').data.toString('utf8').trim();
      assert.equal(sha256(original), digest, 'Prior cache report hash mismatch');
      const previous = JSON.parse(original.toString('utf8'));
      assert.ok(previous.contract === report.contract && previous.repository === CLI_SOURCE_API &&
        Array.isArray(previous.blobs) && Array.isArray(previous.requests), 'Invalid prior cache report');
      assert.ok(previous.cachedMetadata === undefined || Array.isArray(previous.cachedMetadata),
        'Invalid prior metadata cache');
      assert.ok(previous.cachedBlobRequests === undefined || Array.isArray(previous.cachedBlobRequests),
        'Invalid prior blob HTTP cache');
      assert.ok(Array.isArray(previous.releases), 'Invalid prior release cache');
      priorCaches.push({
        path, report: previous, reportSha256: digest,
        blobs: directories.open(join(path, 'blobs')),
        evidence: directories.open(join(path, 'evidence')),
      });
    }
    const repository = await metadata('repository', '');
    assert.ok(repository.private === false && repository.public === true, 'Repository is not public');
    // Audit all trees before fetching blobs so a protected identity is never read via another path.
    const audited = [];
    const protectedShas = new Set();
    for (const release of report.releases) {
      active = release;
      release.status = 'auditing-tree';
      const commit = await metadata(`commit-${release.version}`, `/commits/${release.commit}`);
      assert.equal(commit.sha, release.commit, 'Commit SHA mismatch');
      assert.equal(commit.commit?.tree?.sha, release.tree, 'Commit tree mismatch');
      const document = await metadata(`tree-${release.version}`,
        `/git/trees/${release.tree}?recursive=1`);
      const entries = verifySourceTree(document, release.tree);
      release.treeEntries = entries.length;
      release.treeVerified = true;
      release.originalFiles = entries.filter(entry => entry.type === 'blob').length;
      for (const entry of entries.filter(entry => entry.type === 'blob' &&
        protectedSourcePath(entry.path))) protectedShas.add(entry.sha);
      audited.push({ release, entries });
      release.status = 'tree-verified';
      onProgress(`Verified tree ${release.version}: ${release.originalFiles} original files`);
    }
    for (const { release, entries } of audited) {
      release.exclusions = entries.filter(entry => entry.type === 'blob' &&
        protectedShas.has(entry.sha)).map(({ path, sha, size, mode }) => ({
        path, sha, bytes: size, mode,
        reason: protectedSourcePath(path) ? 'protected-path-not-read' : 'shared-protected-blob-not-read',
      }));
    }
    for (const { release, entries } of audited) {
      active = release;
      release.status = 'fetching-blobs';
      const source = join(output, 'source', release.version);
      release.sourceDirectory = source;
      directories.open(source, { create: true, exclusive: true });
      for (const entry of entries.filter(entry => entry.type === 'tree')) {
        directories.open(join(source, entry.path), { create: true });
      }
      const files = entries.filter(entry => entry.type === 'blob' && !protectedShas.has(entry.sha));
      const sourceEntries = [];
      let index = 0;
      let failure;
      const workers = Array.from({ length: Math.min(concurrency, files.length) }, async () => {
        while (!failure && index < files.length) {
          const entry = files[index++];
          try {
            const bytes = await blob(entry, release);
            writeSourceFile(directories, source, entry, bytes);
            sourceEntries.push({ path: entry.path, bytes: bytes.length,
              sha256: sha256(bytes), gitBlob: entry.sha, mode: entry.mode });
            if (sourceEntries.length % 50 === 0) {
              onProgress(`Fetched ${release.version}: ${sourceEntries.length}/${files.length} files`);
            }
          } catch (error) { failure ??= error; }
        }
      });
      await Promise.all(workers);
      release.materializedFiles = sourceEntries.length;
      if (failure) throw failure;
      sourceEntries.sort((a, b) => a.path.localeCompare(b.path));
      const inventory = readTree(source, { jsonOnly: false });
      assert.deepEqual(inventory.entries, sourceEntries.map(({ path, bytes, sha256: digest }) =>
        ({ path, bytes, sha256: digest })), 'Materialized source inventory mismatch');
      const required = ['LICENSE', 'package.json', 'tsconfig.json', '.eslintrc.js',
        'pnpm-lock.yaml', 'pnpm-workspace.yaml',
        'packages/cli/package.json', 'packages/cli/tsconfig.json', 'packages/cli/src/index.ts',
        'packages/core/package.json', 'packages/core/tsconfig.json', 'packages/core/src/build/build.ts'];
      assert.ok(required.every(path => sourceEntries.some(entry => entry.path === path)),
        'Required original build inputs missing');
      const packages = [];
      for (const [path, name] of [
        ['packages/core', '@ibiz-template/cli-core'], ['packages/cli', '@ibiz-template/cli'],
      ]) {
        const directory = directories.open(join(source, path));
        const { data } = readPinnedFile(directories, directory, 'package.json');
        const manifest = JSON.parse(data.toString('utf8'));
        assert.equal(manifest.name, name, 'Source package identity mismatch');
        assert.equal(manifest.version, release.version, 'Source package version mismatch');
        if (name === '@ibiz-template/cli') {
          assert.equal(manifest.dependencies?.['@ibiz-template/cli-core'], 'workspace:*',
            'Original CLI/core workspace dependency mismatch');
        }
        packages.push({ name, version: manifest.version, path,
          scripts: manifest.scripts, dependencies: manifest.dependencies,
          devDependencies: manifest.devDependencies });
      }
      release.status = release.exclusions.length ? 'source-acquired-with-protected-exclusions' :
        'source-acquired';
      release.sourceComplete = release.exclusions.length === 0;
      release.sourceFingerprint = inventory.fingerprint;
      release.sourceBytes = inventory.bytes;
      release.receipt = join(output, 'receipts', `${release.version}.json`);
      const receipt = {
        schemaVersion: 1, repository: CLI_SOURCE_API, version: release.version,
        commit: release.commit, tree: release.tree, recursiveTreeVerified: true,
        sourceDirectory: source, sourceComplete: release.sourceComplete,
        originalFiles: release.originalFiles, materializedFiles: sourceEntries.length,
        allMaterializedGitBlobsVerified: true, sourceFingerprint: inventory.fingerprint,
        fingerprintKind: inventory.fingerprintKind, sourceBytes: inventory.bytes,
        files: sourceEntries, exclusions: release.exclusions, packages,
        minimalOwnBuildClosure: ['@ibiz-template/cli-core', '@ibiz-template/cli'],
        sourceManifestModified: false, buildsExecuted: false, installsExecuted: false,
        nativeAccepted: false, acceptedForProduction: false, fullLocalization: false,
      };
      const bytes = jsonBytes(receipt);
      directories.write(receiptDirectory, `${release.version}.json`, bytes);
      release.receiptSha256 = sha256(bytes);
      onProgress(`Acquired ${release.version}: ${sourceEntries.length} verified files; ` +
        `${release.exclusions.length} protected paths excluded; ${release.receipt}`);
    }
    active = null;
    report.sourceComplete = report.releases.every(release => release.sourceComplete);
    report.status = report.sourceComplete ? 'source-acquired-not-built-not-accepted' :
      'source-acquired-with-protected-exclusions-not-built-not-accepted';
    report.exitCode = 2;
  } catch (error) {
    if (!created) throw error;
    if (active) active.status = 'failed';
    report.errors.push({ version: active?.version ?? null, message: error.message });
    report.sourceComplete = false;
    report.status = 'source-fetch-failed';
    report.exitCode = 1;
  } finally {
    try {
      if (created) {
        report.finishedAt = new Date().toISOString();
        report.uniqueBlobs = report.blobs.length;
        report.downloadedBlobs = report.blobs.filter(blob => !blob.cacheSource).length;
        report.reusedVerifiedBlobs = report.blobs.filter(blob => blob.cacheSource).length;
        report.reusedVerifiedMetadata = report.cachedMetadata.length;
        report.blobCacheHits = cacheHits;
        const bytes = jsonBytes(report);
        directories.write(directories.open(output), 'report.json', bytes);
        directories.write(directories.open(output), 'report.sha256', `${sha256(bytes)}\n`);
      }
    } finally { directories.close(); }
  }
  return { destination: output, reportPath: join(output, 'report.json'),
    exitCode: report.exitCode, report };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({
      options: {
        output: { type: 'string' }, concurrency: { type: 'string' },
        attempts: { type: 'string' }, 'timeout-ms': { type: 'string' },
        'request-interval-ms': { type: 'string' }, 'retry-delay-ms': { type: 'string' },
        'cache-from': { type: 'string', multiple: true },
        transport: { type: 'string', default: 'blob-api' },
      },
      strict: true,
    });
    const result = await fetchNativeCliSource({
      output: values.output, concurrency: values.concurrency ? Number(values.concurrency) : 3,
      attempts: values.attempts ? Number(values.attempts) : 3,
      timeoutMs: values['timeout-ms'] ? Number(values['timeout-ms']) : 15000,
      requestIntervalMs: values['request-interval-ms'] === undefined ?
        1000 : Number(values['request-interval-ms']),
      retryDelayMs: values['retry-delay-ms'] === undefined ? 60000 : Number(values['retry-delay-ms']),
      cacheFrom: values['cache-from'] ?? [],
      transport: values.transport,
      onProgress: message => console.error(message),
    });
    console.log(JSON.stringify({
      status: result.report.status, exitCode: result.exitCode, report: result.reportPath,
      uniqueBlobs: result.report.uniqueBlobs, blobCacheHits: result.report.blobCacheHits,
      downloadedBlobs: result.report.downloadedBlobs,
      reusedVerifiedBlobs: result.report.reusedVerifiedBlobs,
      reusedVerifiedMetadata: result.report.reusedVerifiedMetadata,
      nativeAccepted: false,
      releases: result.report.releases.map(({ version, status, sourceDirectory, sourceComplete }) =>
        ({ version, status, sourceDirectory, sourceComplete })),
      errors: result.report.errors,
    }, null, 2));
    process.exitCode = result.exitCode;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
