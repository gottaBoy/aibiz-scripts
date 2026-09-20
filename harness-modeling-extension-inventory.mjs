#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import {
  existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  assertOutput, directoryCandidate, inside, safeUrl, validateCandidate,
} from './harness-modeling-core-audit.mjs';

const SCRIPT = fileURLToPath(import.meta.url);
export const WORKSPACE = resolve(dirname(SCRIPT), '..');
export const CATALOG = 'modelingweb/app/src/modeling-plugins/catalog.json';
export const SQL = 'modelingservice/sql/init.sql';
export const OUTPUT = '.artifacts/modeling-extension-inventory';
const CORE_OUTPUT = '.artifacts/modeling-core-localization';
const CORE_SCRIPT = 'scripts/harness-modeling-core-audit.mjs';
const FAMILY_ROOT = 'modelingweb/app/src/modeling-plugins';
const MAX_FILE = 64 * 1024 * 1024;
const hash = data => createHash('sha256').update(data).digest('hex');
const slash = path => path.split(sep).join('/');
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const digest = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const sameSet = (a, b) => {
  const sorted = [...b].sort();
  return a.length === b.length && new Set(a).size === a.length &&
    [...a].sort().every((value, index) => value === sorted[index]);
};
const codeFile = path => /\.(?:[cm]?[jt]sx?|vue|svelte|java|py|go|rs|cs)$/.test(path) &&
  !/\.d\.[cm]?ts$/.test(path);
const SKIP = new Set([
  '.git', '.agents', '.codex', '.artifacts', '.pnpm-store', 'node_modules',
  'target', '__pycache__', 'logs', '.cache',
]);

export const EXPECTED_EXTENSIONS = Object.freeze([
  ['logicdesign', 'graph'], ['plm4modeling', 'tool'],
  ['ibizappviewcreator', 'tool'], ['modelperspectivetool', 'tool'],
  ['ibizmodelingadvanced', 'tool'], ['modeling-materials', 'tool'],
  ['modeling-sync', 'tool'], ['formdesign', 'layout'],
  ['workflowdesign', 'graph'], ['erdesign', 'graph'],
  ['griddesign', 'layout'], ['toolbardesign', 'layout'],
  ['dataquerydesign', 'graph'], ['menudesign', 'layout'],
  ['treeviewdesign', 'layout'], ['dataflowdesign', 'graph'],
  ['viewdesign', 'layout'], ['mddesign', 'layout'],
  ['dashboarddesign', 'layout'], ['valueruledesign', 'graph'],
  ['chartdesign', 'layout'], ['bireportdesign', 'layout'],
  ['ibizdbschemaimporter', 'tool'],
].map(([id, family]) => Object.freeze({
  id, family, upstreamProductId: id.startsWith('modeling-') ? null : id,
})));

// This is the audited core-model contract, not a set of acceptable replacements.
export const EXPECTED_CORE_REFS = Object.freeze([
  '@ibiz-template-plm/drbar-ex@0.0.3-dev.51',
  '@ibiz-template-plm/list-tree@0.0.2-dev.145',
  '@ibiz-template-plm/route-picker@0.0.2-dev.142',
  '@ibiz-template-plugin/ai-code@0.0.3-alpha.109',
  '@ibiz-template-plugin/console-terminal@0.0.3-alpha.87',
  '@ibiz-template-plugin/file-to-base64@0.1.8-alpha.165',
  '@ibiz-template-plugin/global-util-design@0.0.3-alpha.111',
  '@ibiz-template-plugin/img-to-base64@0.1.8-alpha.144',
  '@ibiz-template-plugin/index-blank-placeholder@0.0.3-alpha.116',
  '@ibiz-template-plugin/layout-design@0.0.3-alpha.115',
  '@ibiz-template-plugin/logic-tree-design@0.0.3-alpha.56',
  '@ibiz-template-plugin/model-design@0.0.3-alpha.113',
  '@ibiz-template-plugin/search-criteria@0.0.3-alpha.106',
]);

export const ACCEPTANCE_CRITERIA = Object.freeze({
  source: 'Complete editable source, provenance/license, pinned dependencies and local build entry; metadata or a src file alone is insufficient.',
  build: 'Successful local source build with command, exit status, lockfile/input hashes and hashed output assets; prebuilt assets are insufficient.',
  load: 'Real browser opens the built editor with its expected controls, no missing assets or unexpected remote dependencies; retain trace/network evidence.',
  coreEdit: 'Exercise plugin-specific operations and validation on a real model with before/after assertions; a generic JSON/draft editor is insufficient.',
  save: 'Persist the edit through the intended platform API and verify acknowledged model/revision; localStorage or download alone is insufficient.',
  reload: 'A fresh browser/session loads the persisted model and preserves its semantics and revision.',
  platformIntegration: 'Authenticated platform launch, permissions, real model/API contracts and runtime consumption are verified end to end without mocked services.',
});

function readEvidence(root, path) {
  const file = resolve(root, path);
  if (!inside(root, file)) throw new Error('input-outside-workspace');
  for (let current = file; current !== resolve(root); current = dirname(current)) {
    if (lstatSync(current).isSymbolicLink()) throw new Error('symlink-input-not-read');
  }
  const info = lstatSync(file);
  if (!info.isFile() || info.size > MAX_FILE) throw new Error('input-not-regular-or-too-large');
  const bytes = readFileSync(file);
  return { bytes, evidence: { path: slash(relative(root, file)), bytes: bytes.length, sha256: hash(bytes) } };
}

// Tokenize the known MySQL dump syntax, never execute SQL or split on quoted commas.
function sqlTokens(text) {
  const tokens = [];
  let pos = 0;
  let line = 1;
  const advance = () => {
    const char = text[pos++];
    if (char === '\n') line += 1;
    return char;
  };
  while (pos < text.length) {
    const char = text[pos];
    if (/\s/.test(char)) { advance(); continue; }
    if (char === '#' || (text.startsWith('--', pos) && /\s/.test(text[pos + 2] || '\n'))) {
      while (pos < text.length && advance() !== '\n') { /* Skip a line comment. */ }
      continue;
    }
    if (text.startsWith('/*', pos)) {
      if (text.startsWith('/*!', pos)) throw new Error(`sql-executable-comment-not-supported:line-${line}`);
      advance(); advance();
      while (pos < text.length && !text.startsWith('*/', pos)) advance();
      if (pos === text.length) throw new Error(`sql-unclosed-comment:line-${line}`);
      advance(); advance();
      continue;
    }
    const at = line;
    if (char === "'" || char === '"' || char === '`') {
      const quote = advance();
      let value = '';
      let closed = false;
      while (pos < text.length) {
        const next = advance();
        if (next === quote) {
          if (text[pos] === quote) { advance(); value += quote; }
          else { closed = true; break; }
        } else if (next === '\\' && quote !== '`') {
          if (pos === text.length) break;
          const escaped = advance();
          const escapes = { '0': '\0', b: '\b', n: '\n', r: '\r', t: '\t', Z: '\x1a' };
          value += escapes[escaped] ?? (['_', '%'].includes(escaped) ? `\\${escaped}` : escaped);
        } else value += next;
      }
      if (!closed) throw new Error(`sql-unclosed-quote:line-${at}`);
      tokens.push({ type: quote === '`' ? 'identifier' : 'string', value, line: at });
    } else if ('(),.;'.includes(char)) {
      tokens.push({ type: 'symbol', value: advance(), line: at });
    } else {
      let value = '';
      while (pos < text.length && !/\s/.test(text[pos]) && !'(),.;\'"`'.includes(text[pos]) &&
        !text.startsWith('/*', pos) && text[pos] !== '#') value += advance();
      tokens.push({ type: 'word', value, line: at });
    }
  }
  return tokens;
}

export function parseSystemInserts(text) {
  const tokens = sqlTokens(text);
  const rows = [];
  let cursor = 0;
  while (cursor < tokens.length) {
    const end = tokens.findIndex((token, index) => index >= cursor && token.type === 'symbol' && token.value === ';');
    const statement = tokens.slice(cursor, end < 0 ? tokens.length : end);
    cursor = end < 0 ? tokens.length : end + 1;
    if (!statement.length) continue;
    let index = 0;
    const is = value => statement[index]?.type === 'word' && statement[index].value.toUpperCase() === value;
    if (!is('INSERT')) continue;
    index += 1;
    if (is('IGNORE')) index += 1;
    if (!is('INTO')) throw new Error(`sql-invalid-insert:line-${statement[0].line}`);
    index += 1;
    const identifier = () => {
      const token = statement[index++];
      if (!token || !['identifier', 'word'].includes(token.type)) throw new Error('sql-expected-identifier');
      return token.value;
    };
    const symbol = value => statement[index]?.type === 'symbol' && statement[index].value === value;
    let table = identifier();
    while (symbol('.')) { index += 1; table = identifier(); }
    if (table.toLowerCase() !== 'system') continue;
    const expect = value => {
      if (!symbol(value)) throw new Error(`sql-expected-${value}:line-${statement[0].line}`);
      index += 1;
    };
    expect('(');
    const columns = [identifier().toUpperCase()];
    while (symbol(',')) { index += 1; columns.push(identifier().toUpperCase()); }
    expect(')');
    if (new Set(columns).size !== columns.length) throw new Error('sql-duplicate-column');
    if (!is('VALUES')) throw new Error('sql-only-literal-system-values-supported');
    index += 1;
    do {
      expect('(');
      const values = [];
      while (!symbol(')')) {
        const token = statement[index++];
        if (!token) throw new Error('sql-truncated-values');
        if (token.type === 'string') values.push(token.value);
        else if (token.type === 'word' && token.value.toUpperCase() === 'NULL') values.push(null);
        else if (token.type === 'word' && /^-?\d+$/.test(token.value)) values.push(Number(token.value));
        else throw new Error('sql-nonliteral-system-value');
        if (!symbol(',')) break;
        index += 1;
        if (symbol(')')) throw new Error('sql-trailing-value-comma');
      }
      expect(')');
      if (values.length !== columns.length) throw new Error('sql-column-value-count-mismatch');
      const value = Object.fromEntries(columns.map((column, i) => [column, values[i]]));
      for (const field of ['ID', 'NAME', 'PRODUCT_ID', 'TYPE']) {
        if (typeof value[field] !== 'string' || !value[field].trim()) throw new Error(`sql-missing-${field}`);
      }
      const repository = safeUrl(value.HTTP_URL_TO_REPO);
      if (value.HTTP_URL_TO_REPO && !repository) throw new Error('sql-invalid-repository-url');
      rows.push({
        productId: value.PRODUCT_ID, id: value.ID, title: value.NAME, type: value.TYPE,
        repository, defaultBranch: value.DEFAULT_BRANCH ?? null, line: statement[0].line,
      });
      if (!symbol(',')) break;
      index += 1;
      if (index === statement.length) throw new Error('sql-truncated-row-list');
    } while (index < statement.length);
    if (index !== statement.length) throw new Error('sql-unsupported-system-insert-tail');
  }
  if (!rows.length) throw new Error('sql-no-system-products');
  if (new Set(rows.map(row => row.productId)).size !== rows.length) throw new Error('sql-duplicate-product-id');
  if (new Set(rows.map(row => row.id)).size !== rows.length) throw new Error('sql-duplicate-system-id');
  return rows;
}

export function validateCatalog(catalog) {
  if (!Array.isArray(catalog) || !sameSet(catalog.map(item => item?.id), EXPECTED_EXTENSIONS.map(item => item.id))) {
    throw new Error('catalog-must-contain-exactly-23-requested-ids-without-duplicates');
  }
  return EXPECTED_EXTENSIONS.map(expected => {
    const item = catalog.find(entry => entry.id === expected.id);
    if (item.family !== expected.family || item.upstreamProductId !== expected.upstreamProductId ||
      typeof item.title !== 'string' || !item.title.trim()) throw new Error(`catalog-invalid-entry:${expected.id}`);
    return { ...expected, title: item.title };
  });
}

function walk(root, path, visit, coverage) {
  let entries;
  try {
    if (lstatSync(path).isSymbolicLink()) throw new Error('symlink-root-not-read');
    entries = readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
  } catch (error) {
    if (error.code === 'ENOENT') return;
    coverage.errors.push({ path: slash(relative(root, path)), error: error.code || error.message });
    return;
  }
  coverage.directories += 1;
  for (const entry of entries) {
    if (SKIP.has(entry.name) || entry.name === '.env' || entry.name.startsWith('.env.')) continue;
    const file = join(path, entry.name);
    if (entry.isSymbolicLink()) { coverage.symlinksSkipped += 1; continue; }
    visit(file, entry);
    if (entry.isDirectory()) walk(root, file, visit, coverage);
  }
}

function sourceFiles(root, path) {
  const files = [];
  const coverage = { directories: 0, symlinksSkipped: 0, errors: [] };
  walk(root, path, (file, entry) => {
    if (!entry.isFile() || !codeFile(file) ||
      slash(relative(path, file)).split('/').some(part => ['dist', 'es', 'lib'].includes(part))) return;
    try { files.push(readEvidence(root, file).evidence); }
    catch (error) { coverage.errors.push({ path: slash(relative(root, file)), error: error.code || error.message }); }
  }, coverage);
  return { path: slash(relative(root, path)), files, coverage, fingerprint: hash(JSON.stringify(files)) };
}

function repositoryKey(value) {
  const url = safeUrl(value);
  return url ? url.replace(/\.git\/?$/, '').replace(/\/$/, '') : null;
}

function inspectOriginalCandidate(root, path, matchedBy) {
  const source = sourceFiles(root, path);
  const result = {
    path: slash(relative(root, path)), matchedBy, source,
    provenanceVerified: false, manifest: null, runtime: null, lockfiles: [],
  };
  for (const name of ['pnpm-lock.yaml', 'package-lock.json', 'yarn.lock', 'pom.xml', 'Cargo.lock', 'go.sum']) {
    if (existsSync(join(path, name))) result.lockfiles.push(readEvidence(root, join(path, name)).evidence);
  }
  if (existsSync(join(path, 'package.json'))) {
    const input = readEvidence(root, join(path, 'package.json'));
    const manifest = JSON.parse(input.bytes);
    result.manifest = {
      ...input.evidence, name: manifest.name, version: manifest.version,
      scriptNames: object(manifest.scripts) ? Object.keys(manifest.scripts).sort() : [],
      repository: safeUrl(typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url),
    };
    if (typeof manifest.name === 'string' && typeof manifest.version === 'string') {
      const { evidence } = validateCandidate({ name: manifest.name, version: manifest.version }, directoryCandidate(path));
      result.runtime = {
        declaredAssetsPresent: evidence.runtimeComplete, packageComplete: evidence.packageComplete,
        files: evidence.files ?? [], issues: evidence.issues,
        expectedVersion: null, exactUpstreamVersionVerified: false, executionVerified: false,
      };
    }
  }
  return result;
}

export function scanLocalSources(root, products) {
  const coverage = { root: '.', directories: 0, manifests: 0, symlinksSkipped: 0, errors: [], rejectedManifests: [], excluded: [...SKIP] };
  const matches = new Map(products.map(product => [product.productId, new Map()]));
  const names = new Map();
  const repositories = new Map();
  for (const product of products) {
    for (const name of [product.productId, product.repository && basename(new URL(product.repository).pathname).replace(/\.git$/, '')].filter(Boolean)) {
      if (!names.has(name)) names.set(name, []);
      names.get(name).push(product.productId);
    }
    if (product.repository) repositories.set(repositoryKey(product.repository), product.productId);
  }
  const add = (id, path, reason) => {
    if (inside(join(root, FAMILY_ROOT), path)) return;
    const found = matches.get(id);
    if (!found.has(path)) found.set(path, new Set());
    found.get(path).add(reason);
  };
  walk(root, root, (path, entry) => {
    if (entry.isDirectory()) {
      for (const id of names.get(entry.name) || []) add(id, path, 'directory-name-only');
    } else if (entry.isFile() && entry.name === 'package.json') {
      coverage.manifests += 1;
      try {
        const manifest = JSON.parse(readEvidence(root, path).bytes);
        if (!object(manifest)) throw new Error('non-object-manifest');
        const name = typeof manifest.name === 'string' ? manifest.name.split('/').at(-1) : null;
        for (const id of names.get(name) || []) add(id, dirname(path), 'manifest-name-only');
        const repo = typeof manifest.repository === 'string' ? manifest.repository : manifest.repository?.url;
        const id = repositories.get(repositoryKey(repo));
        if (id) add(id, dirname(path), 'manifest-repository-claim');
      } catch (error) {
        const record = { path: slash(relative(root, path)), error: error instanceof SyntaxError ? 'invalid-json' : error.code || error.message };
        if (error instanceof SyntaxError || error.message === 'non-object-manifest') coverage.rejectedManifests.push(record);
        else coverage.errors.push(record);
      }
    }
  }, coverage);
  const originals = {};
  for (const [id, candidates] of matches) {
    originals[id] = [];
    for (const [path, reasons] of candidates) {
      try { originals[id].push(inspectOriginalCandidate(root, path, [...reasons].sort())); }
      catch (error) { coverage.errors.push({ path: slash(relative(root, path)), error: error instanceof SyntaxError ? 'invalid-json' : error.code || error.message }); }
    }
  }
  const independent = {};
  for (const [family, directory] of [['graph', 'graph'], ['layout', 'layout'], ['tool', 'tools']]) {
    independent[family] = sourceFiles(root, join(root, FAMILY_ROOT, directory));
  }
  return { coverage, originals, independent };
}

export function selectLatestCoreAudit(root) {
  const base = join(root, CORE_OUTPUT);
  // The producer permits custom run names, so select by generatedAt, not by mtime or lexical name.
  const runs = readdirSync(base, { withFileTypes: true }).filter(entry => entry.isDirectory());
  if (!runs.length) throw new Error('core-audit-no-runs');
  const candidates = runs.map(entry => {
    const path = join(base, entry.name);
    const report = JSON.parse(readEvidence(root, join(path, 'audit.json')).bytes);
    const time = Date.parse(report.generatedAt);
    if (!Number.isFinite(time)) throw new Error('core-audit-invalid-generated-at');
    return { path, time };
  }).sort((a, b) => b.time - a.time || a.path.localeCompare(b.path));
  if (candidates.length > 1 && candidates[0].time === candidates[1].time) throw new Error('core-audit-ambiguous-latest');
  return candidates[0].path;
}

export function verifyCoreAudit(root, explicitRun) {
  const result = {
    status: 'invalid-or-unavailable', run: null, artifacts: [], issues: [],
    plugins: [], summary: null, missingExact: [],
    modelSnapshots: 'Recorded input hashes only; original Docker model documents were not reread.',
    scope: 'Historical local filesystem/cache audit, not upstream authenticity, a live cache rescan, source build or browser verification.',
  };
  try {
    const run = explicitRun ? resolve(root, explicitRun) : selectLatestCoreAudit(root);
    if (!inside(join(root, CORE_OUTPUT), run) || run === join(root, CORE_OUTPUT)) throw new Error('core-audit-run-outside-evidence-root');
    result.run = slash(relative(root, run));
    const auditFile = readEvidence(root, join(run, 'audit.json'));
    const refsFile = readEvidence(root, join(run, 'plugin-references.json'));
    result.artifacts = [auditFile.evidence, refsFile.evidence];
    const audit = JSON.parse(auditFile.bytes);
    const refs = JSON.parse(refsFile.bytes);
    const require = (condition, message) => { if (!condition) throw new Error(message); };
    require(audit.schemaVersion === 1 && refs.schemaVersion === 1, 'core-audit-unsupported-schema');
    require(Number.isFinite(Date.parse(audit.generatedAt)), 'core-audit-invalid-generated-at');
    require(audit.generator?.script === CORE_SCRIPT &&
      audit.generator.sha256 === readEvidence(root, CORE_SCRIPT).evidence.sha256, 'core-audit-generator-hash-mismatch');
    require(Array.isArray(refs.packages) && sameSet(refs.packages.map(pkg => pkg.repo), EXPECTED_CORE_REFS), 'core-reference-contract-drift');
    require(Array.isArray(audit.plugins) && sameSet(audit.plugins.map(pkg => pkg.repo), EXPECTED_CORE_REFS), 'core-audit-package-set-mismatch');
    require(Array.isArray(refs.invalidReferences) && refs.invalidReferences.length === 0, 'core-invalid-model-references');
    require(Array.isArray(refs.inputs) && refs.inputs.length >= 2 &&
      new Set(refs.inputs.map(input => input.id)).size === refs.inputs.length, 'core-audit-invalid-model-inputs');
    for (const input of refs.inputs) {
      require(digest(input.sha256) && Number.isInteger(input.bytes) && input.bytes > 0 &&
        ['Central', 'ModelDesign'].includes(input.app) && Array.isArray(input.refs) &&
        input.refs.every(repo => EXPECTED_CORE_REFS.includes(repo)), 'core-model-input-without-valid-hash-or-refs');
    }
    require(sameSet([...new Set(refs.inputs.flatMap(input => input.refs))], EXPECTED_CORE_REFS), 'core-model-input-reference-set-mismatch');
    for (const app of ['Central', 'ModelDesign']) {
      const inputs = refs.inputs.filter(input => input.app === app);
      require(inputs.length > 0 && refs.consistency?.[app]?.referenceSetsAgree === true &&
        refs.consistency[app].inputs === inputs.length &&
        inputs.every(input => sameSet(input.refs, inputs[0].refs)), 'core-model-snapshots-disagree');
    }
    require(Array.isArray(audit.scanErrors) && audit.scanErrors.length === 0 &&
      audit.summary?.scanErrors === 0 && Array.isArray(audit.coverage) && audit.coverage.length > 0 &&
      audit.coverage.every(scope => ['scanned', 'absent'].includes(scope.state) && scope.errorCount === 0), 'core-audit-incomplete-scan');
    for (const ref of refs.packages) {
      const pkg = audit.plugins.find(item => item.repo === ref.repo);
      require(`${ref.name}@${ref.version}` === ref.repo && pkg.name === ref.name && pkg.version === ref.version, 'core-package-identity-mismatch');
      require(Array.isArray(ref.references) && ref.references.length > 0 &&
        JSON.stringify(ref.references) === JSON.stringify(pkg.references), 'core-package-reference-evidence-mismatch');
      for (const reference of ref.references) {
        const input = refs.inputs.find(item => item.id === reference.input);
        require(input?.app === reference.app && input.refs.includes(ref.repo) &&
          Array.isArray(reference.locations) && reference.locations.length > 0 &&
          reference.locations.every(path => typeof path === 'string' && path.startsWith('/')), 'core-package-invalid-model-pointer');
      }
      require(Array.isArray(pkg.exactCandidates) && Array.isArray(pkg.otherVersions) &&
        Array.isArray(pkg.metadataOnly), 'core-package-invalid-evidence');
      require(pkg.otherVersions.every(other => other.version !== ref.version && other.eligible === false), 'core-other-version-eligible');
      let reverified = null;
      if (pkg.status === 'exact-complete-local-package') {
        require(pkg.staging?.path === `staging/plugins/${ref.repo}`, 'core-package-invalid-staging-path');
        const source = pkg.exactCandidates.find(candidate =>
          candidate.location === pkg.staging.source && candidate.fingerprint === pkg.staging.fingerprint);
        require(source?.exactIdentity === true && source.packageComplete === true &&
          source.runtimeComplete === true && source.name === ref.name && source.version === ref.version &&
          Array.isArray(source.files) && source.fingerprint === hash(JSON.stringify(source.files)), 'core-package-invalid-recorded-fingerprint');
        readEvidence(root, join(run, pkg.staging.path, 'package.json'));
        const checked = validateCandidate(ref, directoryCandidate(join(run, pkg.staging.path))).evidence;
        require(checked.packageComplete && checked.fingerprint === source.fingerprint &&
          checked.files.length === pkg.staging.files, 'core-staging-bytes-or-identity-changed');
        reverified = { path: pkg.staging.path, fingerprint: checked.fingerprint, files: checked.files.length, sourceFilesPresent: checked.sourcePresent };
      } else {
        require(pkg.status === 'no-complete-exact-package-found' && pkg.staging === null &&
          pkg.exactCandidates.every(candidate => !candidate.packageComplete), 'core-missing-package-contradiction');
      }
      result.plugins.push({
        repo: ref.repo, name: ref.name, version: ref.version, status: pkg.status,
        references: ref.references, stagedAssets: reverified,
        otherVersions: [...new Set(pkg.otherVersions.map(other => other.version))].sort(),
        otherVersionsEligible: false, metadataOnly: pkg.metadataOnly.length,
        buildVerified: false, executionVerified: false,
      });
    }
    const complete = result.plugins.filter(pkg => pkg.stagedAssets).length;
    require(audit.summary.requested === EXPECTED_CORE_REFS.length &&
      audit.summary.completeExact === complete &&
      audit.summary.missingExact === EXPECTED_CORE_REFS.length - complete, 'core-audit-summary-mismatch');
    result.generatedAt = audit.generatedAt;
    result.inputModels = refs.inputs;
    result.coverage = audit.coverage;
    result.rejectedArtifacts = audit.rejectedArtifacts?.length ?? null;
    result.summary = { requested: EXPECTED_CORE_REFS.length, completeExact: complete, missingExact: EXPECTED_CORE_REFS.length - complete };
    result.missingExact = result.plugins.filter(pkg => !pkg.stagedAssets).map(pkg => pkg.repo);
    result.status = 'verified-local-audit-artifacts';
  } catch (error) {
    result.issues.push(error instanceof SyntaxError ? 'core-audit-invalid-json' : error.code || error.message);
    result.summary = null;
    result.missingExact = [];
  }
  return result;
}

function unverifiedCriteria(sourceStatus) {
  return Object.fromEntries(Object.keys(ACCEPTANCE_CRITERIA).map(key => [
    key, { status: key === 'source' ? sourceStatus : 'not-run', passed: false, evidence: [] },
  ]));
}

export function buildInventory(root = WORKSPACE, options = {}) {
  root = resolve(root);
  const catalogFile = readEvidence(root, CATALOG);
  const sqlFile = readEvidence(root, SQL);
  const previousAudit = readEvidence(root, 'PLUGIN-LOCALIZATION-AUDIT.md');
  const catalog = validateCatalog(JSON.parse(catalogFile.bytes));
  const products = parseSystemInserts(sqlFile.bytes.toString('utf8'));
  const local = scanLocalSources(root, products.filter(product => product.type !== 'CORE'));
  const core = verifyCoreAudit(root, options.coreAuditRun);
  const issues = [...local.coverage.errors];
  for (const family of Object.values(local.independent)) issues.push(...family.coverage.errors);
  for (const candidates of Object.values(local.originals)) {
    for (const candidate of candidates) issues.push(...candidate.source.coverage.errors);
  }
  const extensions = catalog.map(plugin => {
    const product = products.find(item => item.productId === plugin.upstreamProductId) ?? null;
    const candidates = product ? local.originals[product.productId] : [];
    const familySource = local.independent[plugin.family];
    if (plugin.upstreamProductId && !product) issues.push({ id: plugin.id, error: 'expected-sql-product-missing' });
    if (product && product.type !== (plugin.family === 'tool' ? 'EXTENSION' : 'BASE')) {
      issues.push({ id: plugin.id, error: 'sql-product-type-mismatch' });
    }
    return {
      ...plugin,
      sql: product ? { ...product, path: SQL } : null,
      upstream: {
        productIdentity: product ? 'sql-registered' : 'unknown-not-in-sql',
        availability: !product ? 'unknown-upstream-identity' :
          candidates.length ? 'local-candidates-provenance-unverified' : 'not-found-in-scanned-roots',
        sourceAvailability: !product ? 'unknown-upstream-identity' :
          candidates.some(candidate => candidate.source.files.length) ? 'candidate-source-files-provenance-unverified' : 'not-found-in-scanned-candidates',
        runtimePackageAvailability: !product ? 'unknown-upstream-identity' :
          candidates.some(candidate => candidate.runtime?.declaredAssetsPresent) ? 'candidate-runtime-assets-identity-unverified' : 'not-found-in-scanned-candidates',
        exactRuntimePackageIdentity: null,
        repository: product?.repository ?? null, remoteAvailability: 'not-probed',
        candidates, complete: false, criteria: unverifiedCriteria(candidates.length ? 'candidate-only' : 'not-verified'),
      },
      independent: {
        sourceRoot: familySource.path, familySourceFingerprint: familySource.fingerprint,
        familyCodeFiles: familySource.files.length,
        status: familySource.files.length ? 'family-source-present-unverified' : 'no-family-source-observed',
        attribution: 'Family-level source evidence only; this does not establish this specific plugin is implemented.',
        implementationVerified: false, upstreamEquivalent: false,
        criteria: unverifiedCriteria(familySource.files.length ? 'candidate-only' : 'not-verified'),
      },
    };
  });
  const extras = products.filter(product => !catalog.some(plugin => plugin.upstreamProductId === product.productId));
  if (extras.some(product => product.productId !== 'ibizmodeling' || product.type !== 'CORE') ||
    !extras.some(product => product.productId === 'ibizmodeling' && product.type === 'CORE')) {
    issues.push({ error: 'sql-core-or-extension-contract-drift' });
  }
  const valid = !issues.length && core.status === 'verified-local-audit-artifacts';
  return {
    schemaVersion: 1, generatedAt: new Date().toISOString(),
    generator: { script: slash(relative(WORKSPACE, SCRIPT)), sha256: hash(readFileSync(SCRIPT)) },
    policy: {
      network: 'disabled; no remote probes, credential lookup/use, installs, clones or application changes',
      acceptance: 'Static inventory never awards implementation, upstream equivalence or full-flow acceptance.',
      originalCompleteness: 'All 23 original source/build/load/coreEdit/save/reload/platformIntegration criteria and exact core runtime assets must pass. Unknown or unrun evidence fails closed.',
      substitutions: 'Other package versions, metadata, bundled host libraries, PLM business plugins and independent draft editors do not satisfy original extensions or exact core references.',
      sql: 'Known MySQL INSERT INTO system (...) VALUES (...) scanner, default backslash escapes; only literal values supported. Other tables are not emitted.',
      sourceDiscovery: 'Workspace directory/product/repository-name matches and package.json repository claims are candidates, not authenticated upstream provenance. Renamed/unattributed trees may be missed.',
    },
    inputs: [catalogFile.evidence, sqlFile.evidence, previousAudit.evidence],
    acceptanceCriteria: ACCEPTANCE_CRITERIA,
    coverage: local.coverage, independentFamilies: local.independent,
    sqlProductsOutsideRequestedExtensions: extras,
    coreRuntime: core, extensions, issues,
    summary: {
      requestedExtensions: extensions.length, sqlRegisteredExtensions: extensions.filter(item => item.sql).length,
      sqlRegisteredSystems: products.length,
      unknownUpstreamProductIds: extensions.filter(item => !item.upstreamProductId).map(item => item.id),
      originalSourceCandidates: extensions.filter(item => item.upstream.candidates.length).length,
      originalExtensionsVerified: 0, independentExtensionsVerified: 0,
      independentFamiliesWithSource: Object.values(local.independent).filter(item => item.files.length).length,
      coreExactRequested: core.summary?.requested ?? null,
      coreExactComplete: core.summary?.completeExact ?? null,
      coreExactMissing: core.summary?.missingExact ?? null,
      inputEvidenceValid: valid, originalCompleteness: false, fullFlowVerified: false,
      exitCode: valid ? 1 : 2,
    },
  };
}

export function writeInventory(root, output, report) {
  const allowed = join(resolve(root), OUTPUT);
  assertOutput(output, allowed);
  mkdirSync(dirname(output), { recursive: true });
  mkdirSync(output);
  const bytes = `${JSON.stringify(report, null, 2)}\n`;
  writeFileSync(join(output, 'inventory.json'), bytes, { flag: 'wx' });
  writeFileSync(join(output, 'inventory.sha256'), `${hash(bytes)}  inventory.json\n`, { flag: 'wx' });
}

const HELP = `Usage: node scripts/harness-modeling-extension-inventory.mjs [options]

  --core-audit-run PATH  Pin an existing run under ${CORE_OUTPUT}
  --output PATH          New run under ${OUTPUT}
  --help                 Show usage

Reads the exact 23-entry catalog, SQL products, local source roots and latest
hash-evidenced core audit. No network, installs, builds, credentials or runtime
mutation. No metadata/draft/source-presence promotion to implementation.
Exit 1: reproducible inventory with original/full-flow gaps.
Exit 2: invalid, unavailable, changed or incomplete input evidence.
This static inventory alone cannot certify completeness or exit 0.
`;

export function main(args = process.argv.slice(2)) {
  try {
    const { values } = parseArgs({
      args, options: {
        'core-audit-run': { type: 'string' }, output: { type: 'string' },
        help: { type: 'boolean', short: 'h' },
      },
    });
    if (values.help) { process.stdout.write(HELP); return 0; }
    const output = values.output ? resolve(values.output) :
      join(WORKSPACE, OUTPUT, `${new Date().toISOString().replaceAll(':', '-')}-${randomUUID().slice(0, 8)}`);
    assertOutput(output, join(WORKSPACE, OUTPUT));
    const report = buildInventory(WORKSPACE, { coreAuditRun: values['core-audit-run'] });
    writeInventory(WORKSPACE, output, report);
    process.stdout.write(`${JSON.stringify({ output, ...report.summary }, null, 2)}\n`);
    return report.summary.exitCode;
  } catch (error) {
    // SQL and JSON parsing errors must never echo dump contents or credentials.
    process.stderr.write(`Extension inventory failed: ${error instanceof SyntaxError ? 'invalid-json-input' : error.code || error.message}\n`);
    return 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT) process.exitCode = main();
