#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { request } from 'node:http';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { collectPluginReferences } from './harness-plugin-audit.mjs';
import { directoryPath, PinnedDirectories, readPinnedFile } from './native-candidate-files.mjs';

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fields = ['system', 'styles', 'main', 'module', 'types', 'typings'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const maximumFileBytes = 64 * 1024 * 1024;

export function normalizePluginOutput(value) {
  assert.equal(typeof value, 'string', 'Output declaration must be a string');
  const path = value.split(/[?#]/, 1)[0].replace(/^(?:\.\/)+/, '');
  assert.ok(path && !path.startsWith('/') && !/[\\:\x00-\x1f\x7f]/.test(path),
    'Unsafe output path');
  const segments = path.split('/').map(segment => {
    assert.ok(segment, 'Empty output path segment');
    const decoded = decodeURIComponent(segment);
    assert.ok(decoded && !['.', '..'].includes(decoded)
      && !/[\\/\x00-\x1f\x7f]/.test(decoded)
      && !/%[a-f0-9]{2}/i.test(decoded), 'Unsafe encoded output path');
    return decoded;
  });
  return { path: segments.join('/'), encodedPath: segments.map(encodeURIComponent).join('/') };
}

export function loopbackPluginBase(value) {
  assert.equal(typeof value, 'string', 'Explicit loopback application URL required');
  const match = /^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::([0-9]{1,5}))?(\/[^?#]*)$/.exec(value);
  assert.ok(match && match[3].endsWith('/'), 'Only a loopback HTTP application base is allowed');
  if (match[2]) assert.ok(Number(match[2]) > 0 && Number(match[2]) <= 65535, 'Invalid port');
  const path = match[3] === '/' ? '/' : `/${normalizePluginOutput(match[3].slice(1, -1)).encodedPath}/`;
  const url = new URL(value);
  assert.equal(url.pathname, path, 'Application base must use a canonical encoded path');
  // Do not resolve "localhost" through DNS or a configurable hosts file.
  if (url.hostname === 'localhost') url.hostname = '127.0.0.1';
  return url;
}

function localFile(directories, root, path, limit) {
  try {
    const full = join(root, path);
    const parent = directories.open(dirname(full));
    const info = fs.lstatSync(directories.entry(parent, basename(full)));
    if (info.size > limit) return { status: 'too-large' };
    const file = readPinnedFile(directories, parent, basename(full), info);
    return { status: 'present', bytes: file.data.length, sha256: hash(file.data), data: file.data };
  } catch (error) {
    if (error.code === 'ENOENT' || error.message.startsWith('Missing directory:')) {
      return { status: 'missing' };
    }
    if (/Symlink|Non-regular|Not a directory|Invalid directory/.test(error.message)) {
      return { status: 'unsafe' };
    }
    return { status: 'read-error' };
  }
}

function observation({ data, ...file }) {
  return file;
}

function comparison(left, right) {
  return left?.sha256 && right?.sha256
    ? left.sha256 === right.sha256 ? 'match' : 'mismatch'
    : 'unavailable';
}

function fetchHash(url, { maxFileBytes, timeoutMs, budget }) {
  if (budget.remaining <= 0) return Promise.resolve({ status: 'budget-exhausted' });
  return new Promise(accept => {
    let settled = false;
    let responseStatus;
    const done = value => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      accept(value);
    };
    const req = request(url, {
      method: 'GET',
      headers: { 'Accept-Encoding': 'identity', 'Cache-Control': 'no-cache' },
      agent: false,
    }, response => {
      responseStatus = response.statusCode;
      const reject = status => {
        done({ status, httpStatus: responseStatus });
        response.destroy();
      };
      if (responseStatus >= 300 && responseStatus < 400) return reject('redirect-refused');
      if (responseStatus === 404) return reject('not-found');
      if (responseStatus !== 200) return reject('http-error');
      if (response.headers['content-encoding']
          && response.headers['content-encoding'].toLowerCase() !== 'identity') {
        return reject('encoding-refused');
      }
      const length = response.headers['content-length'];
      if (length && (!/^\d+$/.test(length) || Number(length) > maxFileBytes
          || Number(length) > budget.remaining)) return reject('too-large');
      const digest = createHash('sha256');
      let bytes = 0;
      response.on('data', chunk => {
        bytes += chunk.length;
        budget.remaining -= chunk.length;
        if (bytes > maxFileBytes || budget.remaining < 0) return reject('too-large');
        digest.update(chunk);
      });
      response.on('end', () => done({
        status: 'present', httpStatus: responseStatus, bytes, sha256: digest.digest('hex'),
      }));
      response.on('error', () => done({ status: 'response-error', httpStatus: responseStatus }));
      response.on('aborted', () => done({ status: 'response-error', httpStatus: responseStatus }));
    });
    const timer = setTimeout(() => {
      done({ status: 'timeout', ...(responseStatus ? { httpStatus: responseStatus } : {}) });
      req.destroy();
    }, timeoutMs);
    req.on('error', () => done({ status: 'request-error' }));
    req.end();
  });
}

function declarations(manifest) {
  const outputs = new Map();
  const issues = [];
  if (typeof manifest.system !== 'string' || !manifest.system) issues.push('missing-system-declaration');
  for (const field of fields) {
    if (!Object.hasOwn(manifest, field)) continue;
    const values = field === 'styles' && Array.isArray(manifest[field])
      ? manifest[field] : [manifest[field]];
    for (const value of values) {
      try {
        const normalized = normalizePluginOutput(value);
        const previous = outputs.get(normalized.path);
        if (previous) previous.fields.push(field);
        else outputs.set(normalized.path, { ...normalized, fields: [field] });
      } catch {
        issues.push(`invalid-${field}-declaration`);
      }
    }
  }
  return { outputs: [...outputs.values()], issues };
}

export async function auditPlmPluginServedBytes({
  model = join(workspace, 'plm/model/PSSYSAPPS/plmweb/PSSYSAPP.simple.json'),
  publicPlugins = join(workspace, 'plm-web/public/plugins'),
  dist = join(workspace, 'plm-web/dist'),
  sourcePlugins,
  baseUrl = 'http://127.0.0.1:30250/ibizplm-plmweb/',
  packages = [],
  maxFiles = 1000,
  maxFileBytes = 16 * 1024 * 1024,
  maxHttpBytes = 256 * 1024 * 1024,
  timeoutMs = 5000,
} = {}) {
  const base = loopbackPluginBase(baseUrl);
  assert.ok(Array.isArray(packages) && packages.every(value => typeof value === 'string'));
  assert.ok(Number.isSafeInteger(maxFiles) && maxFiles > 0 && maxFiles <= 5000);
  assert.ok(Number.isSafeInteger(maxFileBytes) && maxFileBytes > 0 && maxFileBytes <= maximumFileBytes);
  assert.ok(Number.isSafeInteger(maxHttpBytes) && maxHttpBytes > 0 && maxHttpBytes <= 1024 * 1024 * 1024);
  assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs >= 10 && timeoutMs <= 30_000);
  model = resolve(model);
  publicPlugins = resolve(publicPlugins);
  dist = resolve(dist);
  if (sourcePlugins) sourcePlugins = resolve(sourcePlugins);
  const directories = new PinnedDirectories();
  const budget = { remaining: maxHttpBytes };
  const checks = [];
  try {
    const modelFile = localFile(directories, dirname(model), basename(model), maximumFileBytes);
    assert.equal(modelFile.status, 'present', 'The explicit model input is unavailable or unsafe');
    const references = collectPluginReferences(JSON.parse(modelFile.data.toString('utf8')));
    assert.equal(references.invalidReferences.length, 0, 'Invalid model plugin references');
    assert.ok(references.packages.length > 0, 'No model plugin references');
    for (const selected of packages) {
      assert.ok(references.packages.some(row => row.repo === selected), 'Unknown selected plugin');
    }
    const selected = references.packages.filter(row => !packages.length || packages.includes(row.repo));
    const report = {
      contract: 'plm-plugin-served-bytes-v1', startedAt: new Date().toISOString(),
      scope: 'Model-referenced manifest-declared plugin files only; no transitive asset or build acceptance',
      readOnly: true, deployed: false, sourceBuildVerified: false, nativeAcceptance: false,
      runner: { path: fileURLToPath(import.meta.url), sha256: hash(fs.readFileSync(fileURLToPath(import.meta.url))),
        node: process.version },
      limits: { maxFiles, maxFileBytes, maxHttpBytes, timeoutMs },
      inputs: { model, modelSha256: modelFile.sha256, publicPlugins, dist,
        sourcePlugins: sourcePlugins ?? null, baseUrl: base.href },
      coverage: {
        referenceSource: 'collectPluginReferences(model.rTObjectRepo)',
        declarationSource: 'public plugin package.json',
        fields, includesPackageManifest: true, transitiveAssets: false,
        sourceComparison: sourcePlugins ? 'declared-build-output-bytes-only' : 'not-requested',
        completeReferenceSelection: packages.length === 0,
        totalReferencedPackages: references.packages.length,
        selectedPackages: selected.length,
      },
      packages: [], issues: [],
    };
    const file = async (repo, output) => {
      assert.ok(checks.length < maxFiles, 'Declared file count exceeds the explicit budget');
      const path = `plugins/${repo}/${output.path}`;
      const encodedRepo = repo.split('/').map(encodeURIComponent).join('/');
      const url = new URL(`plugins/${encodedRepo}/${output.encodedPath}`, base);
      assert.equal(url.origin, base.origin);
      assert.ok(url.pathname.startsWith(`${base.pathname}plugins/${encodedRepo}/`));
      assert.equal(url.search, '');
      assert.equal(url.hash, '');
      const publicFile = localFile(directories, publicPlugins, `${repo}/${output.path}`, maxFileBytes);
      const distFile = localFile(directories, dist, path, maxFileBytes);
      const sourceFile = sourcePlugins
        ? localFile(directories, sourcePlugins, `${repo}/${output.path}`, maxFileBytes) : undefined;
      const http = await fetchHash(url, { maxFileBytes, timeoutMs, budget });
      const row = { path, fields: output.fields, requestPath: url.pathname,
        public: observation(publicFile), dist: observation(distFile), http,
        ...(sourceFile ? { source: observation(sourceFile) } : {}),
        comparisons: {
          publicDist: comparison(publicFile, distFile), distHttp: comparison(distFile, http),
          publicHttp: comparison(publicFile, http),
          ...(sourceFile ? { sourcePublic: comparison(sourceFile, publicFile) } : {}),
        }, issues: [] };
      for (const [stage, observed] of Object.entries({
        public: publicFile, dist: distFile, http, ...(sourceFile ? { source: sourceFile } : {}),
      })) if (observed.status !== 'present') row.issues.push(`${stage}-${observed.status}`);
      for (const [stage, status] of Object.entries(row.comparisons)) {
        if (status === 'mismatch') row.issues.push(`${stage}-bytes-mismatch`);
      }
      row.passed = row.issues.length === 0;
      checks.push({ row, observations: { public: observation(publicFile), dist: observation(distFile),
        ...(sourceFile ? { source: observation(sourceFile) } : {}) } });
      return { row, publicFile };
    };
    for (const reference of selected) {
      const pkg = { repo: reference.repo, locations: reference.locations, files: [], issues: [] };
      report.packages.push(pkg);
      const manifest = await file(reference.repo, {
        path: 'package.json', encodedPath: 'package.json', fields: ['manifest'],
      });
      pkg.files.push(manifest.row);
      if (manifest.publicFile.status !== 'present') {
        pkg.issues.push('public-manifest-unavailable');
        continue;
      }
      try {
        const value = JSON.parse(manifest.publicFile.data.toString('utf8'));
        assert.ok(value && typeof value === 'object' && !Array.isArray(value));
        if (value.name !== reference.name || value.version !== reference.version) {
          pkg.issues.push('public-manifest-identity-mismatch');
        }
        const declared = declarations(value);
        pkg.issues.push(...declared.issues);
        for (const output of declared.outputs) {
          if (output.path === 'package.json') {
            manifest.row.fields.push(...output.fields);
          } else pkg.files.push((await file(reference.repo, output)).row);
        }
      } catch (error) {
        if (error.message === 'Declared file count exceeds the explicit budget') throw error;
        pkg.issues.push('invalid-public-manifest');
      }
    }
    // A green comparison must not silently span changing local reference bytes.
    for (const check of checks) {
      for (const [stage, before] of Object.entries(check.observations)) {
        const root = stage === 'dist' ? dist : stage === 'source' ? sourcePlugins : publicPlugins;
        const path = stage === 'dist' ? check.row.path : check.row.path.slice('plugins/'.length);
        const after = observation(localFile(directories, root, path, maxFileBytes));
        if (JSON.stringify(after) !== JSON.stringify(before)) {
          check.row.issues.push(`${stage}-changed-during-audit`);
          check.row.passed = false;
        }
      }
    }
    if (localFile(directories, dirname(model), basename(model), maximumFileBytes).sha256 !== modelFile.sha256) {
      report.issues.push('model-changed-during-audit');
    }
    for (const pkg of report.packages) {
      pkg.passed = pkg.issues.length === 0 && pkg.files.every(row => row.passed);
    }
    report.summary = {
      packages: report.packages.length, files: checks.length,
      matchedFiles: checks.filter(check => check.row.passed).length,
      httpBytesRead: maxHttpBytes - budget.remaining,
      failedPackages: report.packages.filter(pkg => !pkg.passed).length,
      fileIssues: checks.reduce((sum, check) => sum + check.row.issues.length, 0),
      issueCounts: Object.fromEntries([...new Set(checks.flatMap(check => check.row.issues))]
        .sort().map(issue => [issue, checks.filter(check => check.row.issues.includes(issue)).length])),
    };
    report.passed = report.issues.length === 0 && report.packages.every(pkg => pkg.passed);
    report.status = report.passed ? 'matched-declared-plugin-bytes-only' : 'failed-declared-plugin-byte-audit';
    report.finishedAt = new Date().toISOString();
    return report;
  } finally { directories.close(); }
}

function privateDestination(output) {
  const destination = resolve(output);
  assert.equal(dirname(destination), join(workspace, '.artifacts'),
    'Output must be a new direct child of workspace .artifacts');
  assert.match(basename(destination), /^[A-Za-z0-9][A-Za-z0-9._-]*$/);
  assert.ok(!fs.existsSync(destination), 'Existing audit evidence cannot be overwritten');
  directoryPath(dirname(destination), { allowMissing: true });
  return destination;
}

export function writePlmPluginByteReport(report, output) {
  const destination = privateDestination(output);
  const directories = new PinnedDirectories();
  try {
    const target = directories.open(destination, { create: true, exclusive: true });
    directories.write(target, 'report.private.json', `${JSON.stringify(report, null, 2)}\n`);
    return join(destination, 'report.private.json');
  } finally { directories.close(); }
}

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: {
    model: { type: 'string' }, 'public-plugins': { type: 'string' }, dist: { type: 'string' },
    'source-plugins': { type: 'string' }, 'base-url': { type: 'string' },
    package: { type: 'string', multiple: true }, output: { type: 'string' },
    'max-files': { type: 'string' }, 'max-file-bytes': { type: 'string' },
    'max-http-bytes': { type: 'string' }, 'timeout-ms': { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) {
    console.log('Read-only: node scripts/audit-plm-plugin-served-bytes.mjs --output .artifacts/NEW [--model JSON] [--public-plugins DIR] [--dist DIR] [--source-plugins DIR] [--base-url http://127.0.0.1:30250/ibizplm-plmweb/] [--package NAME@VERSION]');
    console.log('Only model-referenced package.json and manifest system/styles/main/module/types/typings files are compared. No redirects, credentials, browser execution, Docker or SQL.');
    return 0;
  }
  assert.ok(values.output, 'A new private output directory is required');
  privateDestination(values.output);
  const report = await auditPlmPluginServedBytes({
    model: values.model, publicPlugins: values['public-plugins'], dist: values.dist,
    sourcePlugins: values['source-plugins'], baseUrl: values['base-url'], packages: values.package,
    ...Object.fromEntries([
      ['max-files', 'maxFiles'], ['max-file-bytes', 'maxFileBytes'],
      ['max-http-bytes', 'maxHttpBytes'], ['timeout-ms', 'timeoutMs'],
    ].filter(([key]) => values[key] !== undefined).map(([key, target]) => [target, Number(values[key])])),
  });
  const path = writePlmPluginByteReport(report, values.output);
  console.log(JSON.stringify({ status: report.status, summary: report.summary, report: path }, null, 2));
  return report.passed ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => { process.exitCode = code; })
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
