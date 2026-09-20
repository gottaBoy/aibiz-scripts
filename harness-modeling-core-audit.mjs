#!/usr/bin/env node

import {
  existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync,
  statSync, writeFileSync,
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep, win32 } from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectPluginReferences } from './harness-plugin-audit.mjs';

const scriptPath = fileURLToPath(import.meta.url);
export const WORKSPACE = resolve(dirname(scriptPath), '..');
export const OUTPUT_ROOT = join(WORKSPACE, '.artifacts/modeling-core-localization');
const MAX_FILE = 64 * 1024 * 1024;
const MAX_PACKAGE = 256 * 1024 * 1024;
const APPS = ['Central', 'ModelDesign'];
const hash = data => createHash('sha256').update(data).digest('hex');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const slash = path => path.split(sep).join('/');

export function inside(root, path) {
  const part = relative(resolve(root), resolve(path));
  return part === '' || (!isAbsolute(part) && part !== '..' && !part.startsWith(`..${sep}`));
}

export function safePath(path) {
  return typeof path === 'string' && path.length > 0 && path.trim() === path &&
    !isAbsolute(path) && !win32.isAbsolute(path) && !/[\x00-\x1f\x7f\\:%?#]/.test(path) &&
    path.replace(/^\.\//, '').split('/').every(part => !['.', '..', ''].includes(part));
}

function excluded(path) {
  return path.split('/').some(part =>
    ['.git', 'node_modules', '.npmrc', '.yarnrc', '.yarnrc.yml', '.DS_Store'].includes(part) ||
    part === '.env' || part.startsWith('.env.'));
}

function readBounded(path) {
  const info = lstatSync(path);
  if (!info.isFile() || info.size > MAX_FILE) throw new Error('not-regular-or-too-large');
  return readFileSync(path);
}

export function safeUrl(value) {
  if (typeof value !== 'string') return null;
  try {
    const url = new URL(value);
    if (!['http:', 'https:', 'file:'].includes(url.protocol)) return null;
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString();
  } catch {
    return null;
  }
}

// Use locally installed npm readers, never npm commands or network fetchers.
export function localReaders() {
  const candidates = [
    createRequire(import.meta.url),
    createRequire(join(dirname(dirname(realpathSync(process.execPath))), 'lib/node_modules/npm/package.json')),
    createRequire('/usr/share/nodejs/npm/package.json'),
    createRequire('/usr/local/lib/node_modules/npm/package.json'),
    createRequire('/opt/homebrew/lib/node_modules/npm/package.json'),
  ];
  for (const require of candidates) {
    try {
      const readers = {};
      const provenance = {};
      for (const name of ['cacache', 'tar', 'ssri', 'semver']) {
        readers[name] = require(name);
        const manifest = require(`${name}/package.json`);
        provenance[name] = { version: manifest.version, path: require.resolve(name) };
      }
      return { ...readers, provenance };
    } catch {
      // A Node installation without npm may use one of the other local readers.
    }
  }
  throw new Error('Local npm readers (cacache, tar, ssri, semver) unavailable; no installation attempted');
}

export function extractReferences(models, semver = localReaders().semver) {
  const packages = new Map();
  const invalid = [];
  const inputs = [];
  for (const model of models) {
    const bytes = Buffer.isBuffer(model.data) ? model.data : Buffer.from(model.data);
    const parsed = JSON.parse(bytes.toString('utf8'));
    const refs = collectPluginReferences(parsed);
    const input = {
      id: model.id, app: model.app, origin: model.origin,
      bytes: bytes.length, sha256: hash(bytes), referenceCount: refs.referenceCount,
      refs: refs.packages.map(pkg => pkg.repo),
    };
    inputs.push(input);
    invalid.push(...refs.invalidReferences.map(ref => ({
      input: model.id, location: ref.location, error: ref.error,
    })));
    for (const pkg of refs.packages) {
      if (semver.valid(pkg.version) !== pkg.version) {
        invalid.push({ input: model.id, repo: pkg.repo, error: 'not-an-exact-semver' });
        continue;
      }
      if (!packages.has(pkg.repo)) {
        packages.set(pkg.repo, { repo: pkg.repo, name: pkg.name, version: pkg.version, references: [] });
      }
      packages.get(pkg.repo).references.push({
        input: model.id, app: model.app, locations: pkg.locations,
      });
    }
  }
  const byApp = {};
  for (const app of APPS) {
    const variants = inputs.filter(input => input.app === app)
      .map(input => JSON.stringify([...input.refs].sort()));
    byApp[app] = { inputs: variants.length, referenceSetsAgree: new Set(variants).size <= 1 };
  }
  return {
    schemaVersion: 1,
    inputs,
    consistency: byApp,
    invalidReferences: invalid,
    packages: [...packages.values()].sort((a, b) => a.repo.localeCompare(b.repo)),
  };
}

export function loadModels(options = {}) {
  const models = [];
  if (options.modelRoot) {
    const root = resolve(options.modelRoot);
    const system = JSON.parse(readBounded(join(root, 'PSSYSTEM.json')));
    if (system.codeName?.toLowerCase() !== 'ibizmodeling') throw new Error('Not an iBizModeling core model');
    for (const app of APPS) {
      const path = join(root, 'PSSYSAPPS', app, 'PSSYSAPP.json');
      models.push({ id: `${root}:${app}`, app, origin: path, data: readBounded(path) });
    }
    return models;
  }
  const container = options.container || 'ibiz-ebsx-allinone';
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(container)) throw new Error('Invalid container name');
  const docker = args => execFileSync('docker', args, {
    maxBuffer: MAX_FILE, timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const paths = docker([
    'exec', container, 'find', '/app/file/datafile/dynamicmodel',
    '-maxdepth', '3', '-name', 'PSSYSTEM.json',
  ]).toString('utf8').trim().split('\n').filter(Boolean).sort();
  for (const path of paths) {
    if (!/^\/app\/file\/datafile\/dynamicmodel\/[a-f0-9]+\/[a-f0-9]+\/PSSYSTEM\.json$/.test(path)) {
      throw new Error('Unexpected Docker cache path');
    }
    const system = JSON.parse(docker(['exec', container, 'cat', path]));
    if (system.codeName?.toLowerCase() !== 'ibizmodeling') continue;
    const root = path.slice(0, -'/PSSYSTEM.json'.length);
    for (const app of APPS) {
      const file = `${root}/PSSYSAPPS/${app}/PSSYSAPP.json`;
      models.push({
        id: `${container}:${root}:${app}`, app, origin: `${container}:${file}`,
        data: docker(['exec', container, 'cat', file]),
      });
    }
  }
  if (!models.length) throw new Error('No readable iBizModeling core cache found');
  return models;
}

export function directoryCandidate(root) {
  const manifestPath = join(root, 'package.json');
  const manifest = JSON.parse(readBounded(manifestPath));
  return {
    kind: 'directory', location: root, manifest,
    files() {
      const files = new Map();
      function visit(path = '') {
        for (const entry of readdirSync(join(root, path), { withFileTypes: true })) {
          const child = path ? `${path}/${entry.name}` : entry.name;
          if (excluded(child)) continue;
          if (!safePath(child)) throw new Error('unsafe-package-path');
          if (entry.isSymbolicLink()) throw new Error('package-symlink-not-staged');
          if (entry.isDirectory()) visit(child);
          else if (entry.isFile()) {
            const file = join(root, child);
            files.set(child, () => readBounded(file));
          } else throw new Error('unsupported-package-file');
        }
      }
      visit();
      return files;
    },
  };
}

export function pnpmCandidate(indexFile, store, readers = localReaders()) {
  const index = JSON.parse(readBounded(indexFile));
  if (!object(index.files) || !index.files['package.json']) throw new Error('pnpm-index-without-manifest');
  function readBlob(info) {
    if (!object(info) || typeof info.integrity !== 'string') throw new Error('pnpm-missing-integrity');
    const sri = readers.ssri.parse(info.integrity, { strict: true });
    if (!sri) throw new Error('pnpm-invalid-integrity');
    const algorithm = sri.pickAlgorithm();
    const digest = sri[algorithm][0].hexDigest();
    if (algorithm !== 'sha512' || !/^[a-f0-9]{128}$/.test(digest)) throw new Error('unsupported-pnpm-digest');
    const path = join(store, 'files', digest.slice(0, 2), digest.slice(2));
    const possible = info.mode & 0o111 ? [`${path}-exec`, path] : [path];
    const file = possible.find(value => existsSync(value));
    if (!file) throw new Error('pnpm-content-unavailable');
    const bytes = readBounded(file);
    if (typeof info.size === 'number' && info.size !== bytes.length) throw new Error('pnpm-size-mismatch');
    if (!readers.ssri.checkData(bytes, info.integrity, { strict: true })) throw new Error('pnpm-integrity-mismatch');
    return bytes;
  }
  const manifest = JSON.parse(readBlob(index.files['package.json']));
  if ((index.name && index.name !== manifest.name) || (index.version && index.version !== manifest.version)) {
    throw new Error('pnpm-index-identity-mismatch');
  }
  return {
    kind: 'pnpm-store', location: indexFile, manifest,
    files() {
      const files = new Map();
      for (const [path, info] of Object.entries(index.files)) {
        if (!safePath(path)) throw new Error('unsafe-pnpm-path');
        if (!excluded(path)) files.set(path, () => readBlob(info));
      }
      return files;
    },
  };
}

export async function tarCandidate(bytes, location, kind = 'tarball', readers = localReaders()) {
  if (bytes.length > MAX_FILE) throw new Error('archive-too-large');
  const entries = new Map();
  let size = 0;
  await new Promise((resolvePromise, reject) => {
    let failure;
    const parser = new readers.tar.Parse({
      strict: true,
      onentry(entry) {
        const path = entry.path.replace(/^\.\//, '');
        if (entry.type === 'Directory') {
          entry.resume();
          return;
        }
        if (!safePath(path) || entry.type !== 'File' || entries.has(path)) {
          failure ||= new Error('unsafe-or-duplicate-archive-entry');
          entry.resume();
          return;
        }
        if (excluded(path)) {
          entry.resume();
          return;
        }
        entries.set(path, null);
        const chunks = [];
        let entrySize = 0;
        entry.on('data', chunk => {
          size += chunk.length;
          entrySize += chunk.length;
          if (size > MAX_PACKAGE || entrySize > MAX_FILE) failure ||= new Error('expanded-archive-too-large');
          if (!failure) chunks.push(chunk);
        });
        entry.on('end', () => entries.set(path, Buffer.concat(chunks)));
      },
    });
    parser.on('error', reject);
    parser.on('end', () => failure ? reject(failure) : resolvePromise());
    parser.end(bytes);
  });
  let files = entries;
  if (!entries.has('package.json')) {
    const roots = [...entries.keys()].filter(path =>
      path.endsWith('/package.json') && path.split('/').length === 2);
    if (roots.length !== 1) throw new Error('archive-without-root-package-json');
    const prefix = roots[0].slice(0, -'package.json'.length);
    if (![...entries.keys()].every(path => path.startsWith(prefix))) throw new Error('archive-mixed-package-roots');
    files = new Map([...entries].map(([path, data]) => [path.slice(prefix.length), data]));
  }
  const manifest = JSON.parse(files.get('package.json'));
  return {
    kind, location, manifest,
    files: () => new Map([...files].map(([path, data]) => [path, () => data])),
  };
}

export function validateCandidate(reference, candidate) {
  const manifest = candidate.manifest;
  const evidence = {
    kind: candidate.kind, location: candidate.location,
    name: manifest.name, version: manifest.version,
    exactIdentity: manifest.name === reference.name && manifest.version === reference.version,
    runtimeComplete: false, packageComplete: false, issues: [],
    sourcePresent: false, buildVerified: false, executionVerified: false,
  };
  if (!evidence.exactIdentity) return { evidence, contents: null };
  const required = [];
  const requirePath = (field, path) => {
    if (!safePath(path)) evidence.issues.push({ field, error: 'unsafe-or-invalid-declared-path' });
    else required.push({ path: path.replace(/^\.\//, ''), field });
  };
  requirePath('system', manifest.system);
  if ('styles' in manifest) {
    const styles = Array.isArray(manifest.styles) ? manifest.styles : [manifest.styles];
    for (const path of styles) requirePath('styles', path);
  }
  for (const field of ['main', 'module', 'types', 'typings']) {
    if (field in manifest) requirePath(field, manifest[field]);
  }
  let contents;
  try {
    const files = candidate.files();
    contents = new Map();
    let size = 0;
    for (const [path, read] of files) {
      if (!safePath(path) || excluded(path)) throw new Error('unsafe-candidate-path');
      const bytes = read();
      size += bytes.length;
      if (bytes.length > MAX_FILE || size > MAX_PACKAGE) throw new Error('package-too-large');
      contents.set(path, bytes);
    }
    const copiedManifest = JSON.parse(contents.get('package.json'));
    if (JSON.stringify(copiedManifest) !== JSON.stringify(manifest)) throw new Error('manifest-changed-during-audit');
    for (const { path, field } of required) {
      if (!contents.has(path) || contents.get(path).length === 0) {
        evidence.issues.push({ field, path, error: 'missing-or-empty-declared-file' });
      }
    }
    evidence.sourcePresent = [...contents.keys()].some(path =>
      path.startsWith('src/') && /\.(?:[cm]?[jt]sx?|vue|svelte)$/.test(path) && !/\.d\.[cm]?ts$/.test(path));
    evidence.files = [...contents].map(([path, data]) => ({
      path, bytes: data.length, sha256: hash(data),
    })).sort((a, b) => a.path.localeCompare(b.path));
    evidence.bytes = size;
    evidence.fingerprint = hash(JSON.stringify(evidence.files));
    evidence.runtimeComplete = !evidence.issues.some(issue => ['system', 'styles'].includes(issue.field));
    evidence.packageComplete = evidence.issues.length === 0;
  } catch (error) {
    evidence.issues.push({ error: error instanceof SyntaxError ? 'invalid-json' : error.message });
    contents = null;
  }
  return { evidence, contents: evidence.packageComplete ? contents : null };
}

export function defaultRoots(workspace = WORKSPACE, home = homedir()) {
  return {
    directories: [
      workspace, join(home, '.npm/_npx'), join(home, 'Library/Caches/Yarn'),
      join(home, '.cache'), join(home, '.local/share/pnpm/global'),
      join(home, 'Library/pnpm/global'),
    ],
    npm: [join(home, '.npm/_cacache')],
    pnpm: [join(workspace, '.pnpm-store'), join(home, '.pnpm-store'),
      join(home, 'Library/pnpm/store'), join(home, '.local/share/pnpm/store')],
    metadata: [join(home, 'Library/Caches/pnpm'), join(home, '.cache/pnpm')],
  };
}

export async function auditSources(references, roots, readers = localReaders(), options = {}) {
  const wanted = new Map(references.packages.map(ref => [ref.repo, ref]));
  const names = new Set(references.packages.map(ref => ref.name));
  const candidates = new Map();
  const metadata = [];
  const coverage = [];
  const errors = [];
  const rejections = [];
  const excludeRoots = (options.excludeRoots || [OUTPUT_ROOT]).map(resolvePath => resolve(resolvePath));
  const skipped = new Set(['.git', '.pnpm-store', '_cacache', 'content-v2', 'index-v5']);
  function problem(scope, path, error) {
    scope.errorCount += 1;
    if (scope.state === 'scanned') scope.state = 'partial';
    errors.push({
      kind: scope.kind, path,
      error: error.code || (error instanceof SyntaxError ? 'invalid-json' : error.message),
    });
  }
  function candidateProblem(scope, path, error) {
    // A fully read malformed manifest/non-package archive is a rejected asset,
    // not an unreadable search location. Retain the evidence either way.
    if (error instanceof SyntaxError || [
      'archive-without-root-package-json', 'archive-mixed-package-roots',
      'unsafe-or-duplicate-archive-entry',
    ].includes(error.message)) {
      scope.rejectedCount += 1;
      rejections.push({
        kind: scope.kind, path,
        reason: error instanceof SyntaxError ? 'invalid-json' : error.message,
      });
    } else problem(scope, path, error);
  }
  function scope(kind, path) {
    const result = {
      kind, path, state: 'scanned', files: 0, examined: 0,
      errorCount: 0, rejectedCount: 0, symlinksSkipped: 0,
    };
    coverage.push(result);
    try {
      if (!statSync(path).isDirectory()) throw new Error('not-a-directory');
    } catch (error) {
      result.state = error.code === 'ENOENT' ? 'absent' : 'unavailable';
      if (result.state === 'unavailable') problem(result, path, error);
    }
    return result;
  }
  function add(candidate) {
    if (!object(candidate.manifest) || !names.has(candidate.manifest.name)) return;
    const key = `${candidate.kind}:${candidate.location}`;
    candidates.set(key, candidate);
  }
  function visit(root, info, accept) {
    if (info.state !== 'scanned') return;
    function walk(path) {
      if (excludeRoots.some(rootPath => inside(rootPath, path))) return;
      let entries;
      try { entries = readdirSync(path, { withFileTypes: true }); }
      catch (error) { problem(info, path, error); return; }
      for (const entry of entries) {
        const child = join(path, entry.name);
        if (entry.isSymbolicLink()) { info.symlinksSkipped += 1; continue; }
        if (entry.isDirectory()) {
          if (!skipped.has(entry.name)) walk(child);
        } else if (entry.isFile()) {
          info.files += 1;
          accept(child);
        }
      }
    }
    walk(root);
  }
  function inspectMetadata(data, location) {
    if (!object(data) || !names.has(data.name) || !object(data.versions)) return;
    for (const ref of wanted.values()) {
      const version = ref.name === data.name ? data.versions[ref.version] : null;
      if (version) metadata.push({
        repo: ref.repo, location, kind: 'metadata-only', downloaded: false,
        advertisedTarball: safeUrl(version.dist?.tarball),
      });
    }
  }

  const archives = [];
  for (const root of [...new Set(roots.directories || [])]) {
    const info = scope('directory-tree', root);
    visit(root, info, path => {
      if (path.endsWith('/package.json')) {
        info.examined += 1;
        try { add(directoryCandidate(dirname(path))); }
        catch (error) { candidateProblem(info, path, error); }
      } else if (/\.(tgz|tar\.gz)$/.test(path)) {
        archives.push({ path, info });
      }
    });
  }
  for (const { path, info } of archives) {
    info.examined += 1;
    try { add(await tarCandidate(readBounded(path), path, 'tarball', readers)); }
    catch (error) { candidateProblem(info, path, error); }
  }
  for (const root of [...new Set(roots.pnpm || [])]) {
    for (const version of ['v3', 'v10']) {
      const store = join(root, version);
      const directory = join(store, version === 'v3' ? 'files' : 'index');
      const info = scope(`pnpm-${version}`, directory);
      visit(directory, info, path => {
        if (!(version === 'v3' ? path.endsWith('-index.json') : path.endsWith('.json'))) return;
        info.examined += 1;
        try {
          const index = JSON.parse(readBounded(path));
          if (index.name && !names.has(index.name)) return;
          add(pnpmCandidate(path, store, readers));
        } catch (error) { problem(info, path, error); }
      });
    }
  }
  for (const root of [...new Set(roots.metadata || [])]) {
    const info = scope('pnpm-metadata', root);
    visit(root, info, path => {
      if (!path.endsWith('.json')) return;
      info.examined += 1;
      try { inspectMetadata(JSON.parse(readBounded(path)), path); }
      catch (error) { problem(info, path, error); }
    });
  }
  for (const cache of [...new Set(roots.npm || [])]) {
    const info = scope('npm-cacache', cache);
    if (info.state !== 'scanned') continue;
    try {
      const entries = Object.values(await readers.cacache.ls(cache));
      info.files = entries.length;
      const seen = new Set();
      const entryUrl = entry => {
        const start = entry.key.search(/https?:\/\//);
        return start >= 0 ? safeUrl(entry.key.slice(start)) : null;
      };
      async function examine(entry) {
        seen.add(entry.key);
        info.examined += 1;
        const url = entryUrl(entry);
        const location = `${cache}#${hash(entry.key).slice(0, 16)}`;
        try {
          if (entry.size > MAX_FILE) throw new Error('cache-entry-too-large');
          const bytes = await readers.cacache.get.byDigest(cache, entry.integrity);
          if (bytes[0] === 0x1f && bytes[1] === 0x8b) {
            const candidate = await tarCandidate(bytes, location, 'npm-cacache', readers);
            candidate.cachedUrl = url;
            add(candidate);
          } else {
            inspectMetadata(JSON.parse(bytes), location);
          }
        } catch (error) { problem(info, location, error); }
      }
      for (const entry of entries) {
        let decoded;
        try { decoded = decodeURIComponent(entry.key); } catch { continue; }
        if ([...names].some(name => decoded.includes(name))) await examine(entry);
      }
      // Cached packuments can point to opaque CDN tarball URLs without a package name.
      const advertised = new Set(metadata.map(item => item.advertisedTarball).filter(Boolean));
      for (const entry of entries) {
        if (!seen.has(entry.key) && advertised.has(entryUrl(entry))) await examine(entry);
      }
    } catch (error) { problem(info, cache, error); info.state = 'unavailable'; }
  }

  const plugins = [];
  const staging = new Map();
  const candidateRank = candidate => candidate.location.includes('/public/plugins/') ? 0 :
    candidate.location.includes('/dist/plugins/') ? 2 : 1;
  const orderedCandidates = [...candidates.values()].sort((a, b) =>
    candidateRank(a) - candidateRank(b) || a.location.localeCompare(b.location));
  for (const ref of wanted.values()) {
    const exact = [];
    const alternatives = [];
    for (const candidate of orderedCandidates) {
      if (candidate.manifest.name !== ref.name) continue;
      if (candidate.manifest.version !== ref.version) {
        alternatives.push({
          kind: candidate.kind, location: candidate.location, version: candidate.manifest.version,
          eligible: false, reason: 'different-exact-version',
        });
        continue;
      }
      const checked = validateCandidate(ref, candidate);
      if (candidate.cachedUrl) checked.evidence.cachedUrl = candidate.cachedUrl;
      exact.push(checked.evidence);
      if (checked.contents && !staging.has(ref.repo)) {
        staging.set(ref.repo, { contents: checked.contents, source: checked.evidence });
      }
    }
    plugins.push({
      ...ref,
      status: staging.has(ref.repo) ? 'exact-complete-local-package' : 'no-complete-exact-package-found',
      exactCandidates: exact,
      otherVersions: alternatives,
      metadataOnly: metadata.filter(item => item.repo === ref.repo),
      staging: null,
    });
  }
  return {
    report: {
      schemaVersion: 1, generatedAt: new Date().toISOString(),
      generator: { script: 'scripts/harness-modeling-core-audit.mjs', sha256: hash(readFileSync(scriptPath)) },
      readers: readers.provenance,
      policy: {
        network: 'disabled: no fetch/install/build commands',
        productionWrites: false,
        staging: 'Exact manifest identity, system/styles and all declared main/module/types/typings files; all copied files hashed.',
        excludedPackageFiles: '.git, node_modules, .npmrc, .yarnrc*, .env*, .DS_Store',
        notVerified: [
          'Browser loading, transitive SystemJS/peer dependencies and source builds',
          'Symlinked directories (physical pnpm package trees are scanned separately)',
          'Database assets, nested JAR/ZIP contents and caches outside listed roots',
        ],
      },
      coverage, scanErrors: errors, rejectedArtifacts: rejections,
      summary: {
        requested: wanted.size, completeExact: staging.size, missingExact: wanted.size - staging.size,
        metadataOnly: plugins.filter(pkg => pkg.metadataOnly.length && !staging.has(pkg.repo)).length,
        scanErrors: coverage.reduce((sum, item) => sum + item.errorCount, 0),
        rejectedArtifacts: rejections.length,
        runtimeVerified: 0,
      },
      plugins,
    },
    staging,
  };
}

function assertUnlinked(path) {
  let current = resolve(path);
  while (true) {
    try {
      const info = lstatSync(current);
      if (info.isSymbolicLink() || (info.isFile() && info.nlink > 1)) throw new Error('Output path must not contain links');
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    const parent = dirname(current);
    if (parent === current) return;
    current = parent;
  }
}

export function assertOutput(path, allowedRoot = OUTPUT_ROOT) {
  if (!inside(allowedRoot, path) || resolve(path) === resolve(allowedRoot)) {
    throw new Error('Output must be a new run directory inside .artifacts/modeling-core-localization');
  }
  assertUnlinked(path);
  if (existsSync(path)) throw new Error('Output run already exists; refusing to overwrite');
}

export function renderReport(report, references) {
  const cell = value => String(value).replaceAll('|', '\\|').replaceAll('\n', ' ');
  const lines = [
    '# Modeling Core Local Plugin Audit', '',
    `Generated: ${report.generatedAt}`, '',
    `Inputs: ${references.inputs.length} model documents; exact plugin versions: ${report.summary.requested}.`,
    `Complete local packages: ${report.summary.completeExact}; missing exact packages: ${report.summary.missingExact}; scan errors: ${report.summary.scanErrors}.`,
    '',
    'No services, application configuration, dependencies or production assets were modified.',
    'Metadata and other versions do not satisfy an exact runtime reference. Staged files have not been executed or built.',
    '',
    '| Exact Reference | Result | Complete Source | Staging |',
    '|---|---|---|---|',
  ];
  for (const pkg of report.plugins) {
    lines.push(`| ${cell(pkg.repo)} | ${cell(pkg.status)} | ${cell(pkg.staging?.source || 'Not confirmed in scanned roots')} | ${cell(pkg.staging?.path || 'None')} |`);
  }
  lines.push('', '## Missing Exact Versions', '');
  for (const pkg of report.plugins.filter(pkg => !pkg.staging)) {
    lines.push(`- \`${pkg.repo}\``);
    for (const candidate of pkg.exactCandidates) {
      lines.push(`  - Incomplete: \`${cell(candidate.location)}\`; ${cell(candidate.issues.map(issue => issue.error).join(', '))}`);
    }
    for (const candidate of pkg.otherVersions) {
      lines.push(`  - Other version (not substituted): \`${cell(candidate.version)}\` at \`${cell(candidate.location)}\``);
    }
    for (const item of pkg.metadataOnly) {
      lines.push(`  - Cached metadata only: \`${cell(item.location)}\`; advertised tarball: \`${cell(item.advertisedTarball || 'unknown')}\``);
    }
  }
  lines.push('', '## Coverage', '', '| Kind | Root | State | Examined | Errors | Rejected |', '|---|---|---|---:|---:|---:|');
  for (const scope of report.coverage) {
    lines.push(`| ${scope.kind} | ${cell(scope.path)} | ${scope.state} | ${scope.examined} | ${scope.errorCount} | ${scope.rejectedCount} |`);
  }
  lines.push('', '## Limits', '', ...report.policy.notVerified.map(value => `- ${value}`));
  lines.push('', 'See plugin-references.json for input hashes and JSON pointers; audit.json for package file hashes and error evidence.', '');
  return lines.join('\n');
}

export function writeArtifacts(path, references, result, allowedRoot = OUTPUT_ROOT) {
  assertOutput(path, allowedRoot);
  mkdirSync(dirname(path), { recursive: true });
  mkdirSync(path);
  for (const pkg of result.report.plugins) {
    const source = result.staging.get(pkg.repo);
    if (!source) continue;
    if (!safePath(pkg.repo)) throw new Error('Unsafe staging package reference');
    const relativeRoot = `staging/plugins/${pkg.repo}`;
    const target = join(path, relativeRoot);
    for (const [file, bytes] of source.contents) {
      if (!safePath(file) || excluded(file)) throw new Error('Unsafe staging file');
      const destination = join(target, file);
      if (!inside(target, destination)) throw new Error('Staging path escaped');
      mkdirSync(dirname(destination), { recursive: true });
      writeFileSync(destination, bytes, { flag: 'wx', mode: 0o644 });
      if (hash(readFileSync(destination)) !== hash(bytes)) throw new Error('Staging hash verification failed');
    }
    pkg.staging = {
      path: relativeRoot, source: source.source.location, kind: source.source.kind,
      files: source.contents.size, fingerprint: source.source.fingerprint,
      verified: 'byte-for-byte hashes; not executed',
    };
  }
  const write = (name, data) => writeFileSync(join(path, name), data, { flag: 'wx' });
  write('plugin-references.json', `${JSON.stringify(references, null, 2)}\n`);
  write('audit.json', `${JSON.stringify(result.report, null, 2)}\n`);
  write('report.md', renderReport(result.report, references));
}

const help = `Usage: node scripts/harness-modeling-core-audit.mjs [options]

  --model-root PATH       Offline core model root; otherwise read Docker cache
  --container NAME        Read-only Docker source (default: ibiz-ebsx-allinone)
  --directory PATH        Additional package/source tree (repeatable)
  --npm-cache PATH        Additional npm _cacache directory (repeatable)
  --pnpm-store PATH       Additional pnpm store containing v3/v10 (repeatable)
  --metadata PATH         Additional cached packument directory (repeatable)
  --no-default-roots      Only inspect explicitly provided local roots
  --output PATH          New run directory within .artifacts/modeling-core-localization
  --help                 Show usage

No fetch, install, build, service mutation or production writes. Exact complete
packages are copied to this run's independent staging. Existing runs are not overwritten.
Exit codes: 0 = all exact assets found; 1 = gaps; 2 = incomplete audit/invalid input.
`;

export async function main(args = process.argv.slice(2)) {
  try {
    const options = {};
    const additional = { directories: [], npm: [], pnpm: [], metadata: [] };
    const repeat = {
      '--directory': 'directories', '--npm-cache': 'npm',
      '--pnpm-store': 'pnpm', '--metadata': 'metadata',
    };
    const single = {
      '--model-root': 'modelRoot', '--container': 'container', '--output': 'output',
    };
    for (let index = 0; index < args.length; index += 1) {
      const key = args[index];
      if (key === '--help' || key === '-h') { process.stdout.write(help); return 0; }
      if (key === '--no-default-roots') { options.noDefaults = true; continue; }
      if (!repeat[key] && !single[key]) throw new Error(`Unknown argument: ${key}`);
      const value = args[++index];
      if (!value || value.startsWith('--')) throw new Error(`Missing value for ${key}`);
      if (repeat[key]) additional[repeat[key]].push(resolve(value));
      else {
        if (options[single[key]]) throw new Error(`Repeated argument: ${key}`);
        options[single[key]] = key === '--container' ? value : resolve(value);
      }
    }
    if (options.modelRoot && options.container) throw new Error('Choose --model-root or --container, not both');
    const output = options.output || join(OUTPUT_ROOT,
      `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}`);
    assertOutput(output);
    const readers = localReaders();
    const references = extractReferences(loadModels(options), readers.semver);
    if (references.invalidReferences.length) throw new Error('Invalid or non-exact model references');
    if (!references.packages.length) throw new Error('Core models contain no runtime plugin references');
    const roots = options.noDefaults ? { directories: [], npm: [], pnpm: [], metadata: [] } : defaultRoots();
    for (const key of Object.keys(roots)) roots[key].push(...additional[key]);
    const result = await auditSources(references, roots, readers);
    writeArtifacts(output, references, result);
    process.stdout.write(`${JSON.stringify({ output, ...result.report.summary }, null, 2)}\n`);
    return result.report.summary.scanErrors ? 2 : result.report.summary.missingExact ? 1 : 0;
  } catch (error) {
    // Docker/JSON errors can contain credentials or entire input lines.
    const message = error.stderr ? 'Docker model cache could not be read (no services changed)' :
      error instanceof SyntaxError ? 'Invalid JSON input' : error.message;
    process.stderr.write(`Modeling core audit failed: ${message}\n`);
    return 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  process.exitCode = await main();
}
