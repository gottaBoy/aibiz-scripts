import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync,
  rmSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  assertOutput, auditMigrationMappings, auditSources, defaultRoots, directoryCandidate,
  extractReferences, fingerprintDirectory, loadMigrationContract, loadModels, localReaders,
  MIGRATION_CONTRACT, MIGRATION_RUNTIME_REQUIREMENTS, OUTPUT_ROOT, pnpmCandidate, safePath,
  safeUrl, renderReport, tarCandidate, validateBuildReceipt, validateCandidate,
  validateMigrationMapping, WORKSPACE, writeArtifacts,
} from '../harness-modeling-core-audit.mjs';

const readers = localReaders();
const script = fileURLToPath(new URL('../harness-modeling-core-audit.mjs', import.meta.url));
const ref = { repo: '@example/plugin@1.2.3-alpha.4', name: '@example/plugin', version: '1.2.3-alpha.4' };
const manifest = {
  name: ref.name, version: ref.version, system: 'dist/index.system.js',
  styles: ['dist/style.css'], main: 'lib/index.cjs', module: 'es/index.js',
  types: 'es/index.d.ts', scripts: { build: 'NEVER_EXECUTE_ME' },
};
const files = {
  'package.json': JSON.stringify(manifest),
  'dist/index.system.js': 'System.register([], function () {});',
  'dist/chunk.js': 'export default {};',
  'dist/style.css': '.plugin {}',
  'lib/index.cjs': 'module.exports = {};',
  'es/index.js': 'export {};',
  'es/index.d.ts': 'export declare const value: unknown;',
  'src/index.ts': 'export const value = 1;',
};

function put(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof data === 'object' && !Buffer.isBuffer(data) ? JSON.stringify(data) : data);
}

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'modeling-core-audit-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function install(root, entries = files) {
  for (const [path, data] of Object.entries(entries)) put(join(root, path), data);
  return root;
}

function references(repo = ref.repo) {
  return extractReferences([
    { id: 'central', app: 'Central', origin: 'fixture/Central', data: JSON.stringify({ rTObjectRepo: repo }) },
    { id: 'modeldesign', app: 'ModelDesign', origin: 'fixture/ModelDesign', data: JSON.stringify({ rtObjectRepo: repo }) },
  ], readers.semver);
}

function pnpmFixture(root, version, entries = files, identity = false) {
  const store = join(root, version);
  const index = { files: {} };
  if (identity) Object.assign(index, { name: ref.name, version: ref.version });
  for (const [path, data] of Object.entries(entries)) {
    const bytes = Buffer.from(data);
    const digest = createHash('sha512').update(bytes).digest();
    const hex = digest.toString('hex');
    const mode = path.endsWith('.cjs') ? 0o755 : 0o644;
    put(join(store, 'files', hex.slice(0, 2), hex.slice(2) + (version === 'v10' && mode & 0o111 ? '-exec' : '')), bytes);
    index.files[path] = { integrity: `sha512-${digest.toString('base64')}`, size: bytes.length, mode };
  }
  const path = join(store, version === 'v3' ? 'files' : 'index', 'ab', 'opaque-index.json');
  put(path, index);
  return { path, store, index };
}

function snapshot(root) {
  const result = {};
  function visit(path = '') {
    for (const entry of readdirSync(join(root, path), { withFileTypes: true })) {
      const child = join(path, entry.name);
      if (entry.isDirectory()) visit(child);
      else if (entry.isFile()) result[child] = createHash('sha256').update(readFileSync(join(root, child))).digest('hex');
    }
  }
  visit();
  return result;
}

async function archive(root, entries = files) {
  install(join(root, 'package'), entries);
  const chunks = [];
  for await (const chunk of readers.tar.c({ cwd: root, gzip: true }, ['package'])) chunks.push(chunk);
  return Buffer.concat(chunks);
}

function migrationMappingFixture(root) {
  const sourcePath = 'source';
  const targetPath = 'target';
  const packageManifest = {
    name: ref.name,
    version: ref.version,
    gitHead: 'a'.repeat(40),
  };
  put(join(root, sourcePath, 'package.json'), packageManifest);
  put(join(root, sourcePath, 'src/index.ts'), 'export const value = 1;\n');
  put(join(root, targetPath, 'package.json'), packageManifest);
  put(join(root, targetPath, 'dist/index.system.js'), 'System.register([], function () {});\n');
  const source = fingerprintDirectory(root, sourcePath);
  const target = fingerprintDirectory(root, targetPath);
  const fileEvidence = (directory, path) => {
    const data = readFileSync(join(root, directory, path));
    return { path, bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') };
  };
  const inputs = [fileEvidence(sourcePath, 'package.json'), fileEvidence(sourcePath, 'src/index.ts')];
  const outputs = [fileEvidence(targetPath, 'package.json'), fileEvidence(targetPath, 'dist/index.system.js')];
  const fingerprint = entries => createHash('sha256').update(JSON.stringify([...entries]
    .map(file => ({ path: file.path, bytes: file.bytes, sha256: file.sha256 }))
    .sort((a, b) => a.path.localeCompare(b.path)))).digest('hex');
  const runtimeReport = JSON.stringify({
    schemaVersion: 1,
    status: 'passed',
    targetRepo: ref.repo,
    sourceFingerprint: source.fingerprint,
    outputFingerprint: target.fingerprint,
    applications: Object.fromEntries(['Central', 'ModelDesign'].map(app => [app, {
      status: 'passed',
      exactLocalTargetPackage: ref.repo,
      pluginAsset404s: 0,
      unexplainedBrowserErrors: 0,
    }])),
  });
  put(join(root, 'runtime.json'), runtimeReport);
  const required = [...MIGRATION_RUNTIME_REQUIREMENTS];
  return {
    from: ref.repo,
    target: {
      status: 'observed',
      repo: ref.repo,
      artifact: {
        status: 'observed', path: targetPath, fingerprintKind: 'target-file-set',
        fingerprint: target.fingerprint, files: target.files, bytes: target.bytes,
      },
    },
    compatibility: {
      status: 'verified',
      basis: [
        { kind: 'same-package-name', status: 'verified', evidence: 'Exact package name.' },
        { kind: 'editable-source', status: 'verified', evidence: 'Source directory is present.' },
        { kind: 'runtime-compatibility', status: 'verified', evidence: 'Both applications passed.' },
      ],
      requiredProof: ['source-build-receipt', 'browser-runtime'],
      rationale: 'All required local evidence is present.',
    },
    source: {
      status: 'verified', path: sourcePath, fingerprintKind: 'source-file-set',
      fingerprint: source.fingerprint, files: source.files, bytes: source.bytes,
      packageGitHead: packageManifest.gitHead,
    },
    build: {
      status: 'verified', fingerprintKind: 'source-build-receipt',
      sourceFingerprint: source.fingerprint, outputFingerprint: target.fingerprint,
      receipt: {
        schemaVersion: 1, status: 'passed', command: 'pnpm build', exitCode: 0,
        package: { name: ref.name, version: ref.version },
        sourceFingerprint: fingerprint(inputs), outputFingerprint: fingerprint(outputs),
        inputs, outputs,
      },
    },
    runtime: {
      status: 'passed', required, evidence: {
        command: 'node runtime-verification.mjs',
        reportPath: 'runtime.json', reportSha256: createHash('sha256').update(runtimeReport).digest('hex'),
        applications: ['Central', 'ModelDesign'],
      },
    },
    status: 'verified',
    blockers: [],
  };
}

test('defaults are workspace/home based and writes have a single allowed root', () => {
  assert.equal(OUTPUT_ROOT, join(WORKSPACE, '.artifacts/modeling-core-localization'));
  const roots = defaultRoots('/workspace', '/home/user');
  assert.ok(roots.directories.includes('/workspace'));
  assert.ok(roots.npm.includes('/home/user/.npm/_cacache'));
  assert.ok(roots.pnpm.includes('/workspace/.pnpm-store'));
  assert.ok(roots.pnpm.includes('/home/user/Library/pnpm/store'));
});

test('the checked-in migration contract contains only the audited exact model references', () => {
  const contract = loadMigrationContract();
  assert.equal(MIGRATION_CONTRACT, join(WORKSPACE, 'scripts/fixtures/modeling-core-migration-contract.json'));
  assert.equal(contract.plugins.length, 11);
  assert.equal(new Set(contract.plugins.map(plugin => plugin.repo)).size, 11);
  assert.equal(contract.migrationMappings.length, 11);
  assert.deepEqual(contract.migrationPolicy.runtimeApplications, ['Central', 'ModelDesign']);
  assert.deepEqual(contract.migrationPolicy.requiredRuntimeChecks, [...MIGRATION_RUNTIME_REQUIREMENTS]);
  assert.equal(contract.migrationMappings.filter(mapping => mapping.status === 'verified').length, 0);
  assert.equal(contract.migrationMappings.filter(mapping => mapping.source.status === 'verified').length, 1);
  assert.equal(contract.migrationMappings.filter(mapping => mapping.source.status === 'reconstructed').length, 4);
  assert.equal(contract.migrationMappings.filter(mapping => mapping.source.status === 'missing').length, 6);
  assert.equal(contract.migrationMappings.filter(mapping => mapping.target.status === 'observed').length, 7);
  assert.equal(contract.migrationMappings.filter(mapping => mapping.target.status === 'missing').length, 4);
  assert.equal(contract.evidence.applications.Central.inputSha256,
    '11cbdd30fc1e3fc7c067b1dabc363bccd2d977c8282895bcae1f0fe36885d564');
  assert.equal(contract.plugins.find(plugin =>
    plugin.repo === '@ibiz-template-plugin/logic-tree-design@0.0.3-alpha.56')?.build?.status, 'verified');
  const logicTree = contract.migrationMappings.find(mapping =>
    mapping.from === '@ibiz-template-plugin/logic-tree-design@0.0.3-alpha.56');
  assert.equal(logicTree.build.receipt.sourceFingerprint, logicTree.source.fingerprint);
  assert.equal(logicTree.build.receipt.outputFingerprint, logicTree.target.artifact.fingerprint);
  assert.equal(logicTree.runtime.status, 'not-verified');
});

test('build receipts are independent from package fingerprints and fail closed', () => {
  const inputs = [
    { path: 'package.json', bytes: 1, sha256: 'c'.repeat(64) },
    { path: 'src/index.ts', bytes: 1, sha256: 'e'.repeat(64) },
  ];
  const outputs = [{ path: 'dist/index.system.js', bytes: 1, sha256: 'd'.repeat(64) }];
  const fingerprint = files => createHash('sha256').update(JSON.stringify([...files]
    .map(file => ({ path: file.path, bytes: file.bytes, sha256: file.sha256 }))
    .sort((a, b) => a.path.localeCompare(b.path)))).digest('hex');
  const valid = {
    schemaVersion: 1, status: 'passed', command: 'pnpm build', exitCode: 0,
    package: { name: ref.name, version: ref.version },
    sourceFingerprint: fingerprint(inputs), outputFingerprint: fingerprint(outputs),
    inputs, outputs,
  };
  assert.deepEqual(validateBuildReceipt(valid), { valid: true });
  assert.equal(validateBuildReceipt({ ...valid, exitCode: 1 }).valid, false);
  assert.equal(validateBuildReceipt({ ...valid, sourceFingerprint: valid.outputFingerprint }).valid, false);
  assert.equal(validateBuildReceipt({ ...valid, inputs: [{ path: 'package.json', bytes: 1, sha256: 'not-a-digest' }] }).valid, false);
  assert.equal(validateBuildReceipt({ ...valid, inputs: [{ path: 'package.json', sha256: 'c'.repeat(64) }] }).reason,
    'invalid-build-receipt-file');
  assert.equal(validateBuildReceipt({ ...valid, outputFingerprint: 'f'.repeat(64) }).reason,
    'build-receipt-fingerprint-mismatch');
});

test('migration mappings require same-package identity, source, build and runtime evidence', t => {
  const root = fixture(t);
  const valid = migrationMappingFixture(root);
  assert.deepEqual(validateMigrationMapping(valid, root), { valid: true, ready: true, blockers: [] });

  const crossPlugin = structuredClone(valid);
  crossPlugin.target.repo = '@other/plugin@1.2.3-alpha.4';
  assert.ok(validateMigrationMapping(crossPlugin, root).blockers.includes('cross-package-substitution'));

  const sourceMismatch = structuredClone(valid);
  sourceMismatch.source.fingerprint = 'c'.repeat(64);
  assert.ok(validateMigrationMapping(sourceMismatch, root).blockers.includes('source-fingerprint-mismatch'));

  const reconstructed = structuredClone(valid);
  reconstructed.source.status = 'reconstructed';
  reconstructed.status = 'blocked';
  reconstructed.blockers = ['reconstructed-source-not-original'];
  assert.deepEqual(validateMigrationMapping(reconstructed, root), { valid: true, ready: false, blockers: [] });
  const missingProvenanceBlocker = structuredClone(reconstructed);
  missingProvenanceBlocker.blockers = ['runtime-not-verified'];
  assert.ok(validateMigrationMapping(missingProvenanceBlocker, root).blockers.includes('reconstructed-source-must-block'));
  const falselyVerified = structuredClone(reconstructed);
  falselyVerified.status = 'verified';
  falselyVerified.blockers = [];
  assert.equal(validateMigrationMapping(falselyVerified, root).ready, false);

  for (const path of [
    'plm-web/public/plugins/example',
    'plm-web/dist/plugins/example',
    '.artifacts/modeling-core-localization/staging/plugins/example',
    'plm-web/node_modules/example',
  ]) {
    const publishedAsSource = structuredClone(valid);
    publishedAsSource.source.path = path;
    assert.ok(validateMigrationMapping(publishedAsSource, root).blockers.includes('source-path-is-build-artifact'), path);
  }

  const buildMismatch = structuredClone(valid);
  buildMismatch.build.sourceFingerprint = 'd'.repeat(64);
  assert.ok(validateMigrationMapping(buildMismatch, root).blockers.includes('invalid-build-evidence'));

  const staleBuildBlocker = structuredClone(valid);
  staleBuildBlocker.status = 'blocked';
  staleBuildBlocker.blockers = ['missing-build-receipt'];
  assert.ok(validateMigrationMapping(staleBuildBlocker, root).blockers.includes('stale-missing-build-receipt'));

  const runtimeMismatch = structuredClone(valid);
  runtimeMismatch.runtime.evidence.applications = ['Central'];
  assert.ok(validateMigrationMapping(runtimeMismatch, root).blockers.includes('invalid-runtime-evidence'));

  const missingReport = structuredClone(valid);
  missingReport.runtime.evidence.reportPath = 'missing-runtime.json';
  assert.ok(validateMigrationMapping(missingReport, root).blockers.includes('runtime-report-unreadable'));
  const wrongReportHash = structuredClone(valid);
  wrongReportHash.runtime.evidence.reportSha256 = 'f'.repeat(64);
  assert.ok(validateMigrationMapping(wrongReportHash, root).blockers.includes('runtime-report-sha256-mismatch'));
  const failedBrowser = structuredClone(valid);
  const report = JSON.parse(readFileSync(join(root, 'runtime.json'), 'utf8'));
  report.applications.ModelDesign.pluginAsset404s = 1;
  const bytes = JSON.stringify(report);
  put(join(root, 'runtime.json'), bytes);
  failedBrowser.runtime.evidence.reportSha256 = createHash('sha256').update(bytes).digest('hex');
  assert.ok(validateMigrationMapping(failedBrowser, root).blockers.includes('invalid-runtime-report'));
});

test('missing source evidence is a valid blocked record but never a usable mapping', () => {
  const contract = loadMigrationContract();
  const mapping = contract.migrationMappings.find(item =>
    item.from === '@ibiz-template-plugin/ai-code@0.0.3-alpha.92');
  const checked = validateMigrationMapping(mapping);
  assert.equal(checked.valid, true);
  assert.equal(checked.ready, false);
  assert.equal(mapping.source.status, 'missing');
  assert.ok(mapping.blockers.includes('missing-source-evidence'));
});

test('migration audit output counts mapped, verified, blocked and missing entries', async t => {
  const root = fixture(t);
  const valid = migrationMappingFixture(root);
  const refs = { packages: [{ repo: ref.repo }] };
  const verified = auditMigrationMappings(refs, [valid]);
  assert.deepEqual({
    requested: verified.requested,
    mapped: verified.mapped,
    verified: verified.verified,
    blocked: verified.blocked,
    missing: verified.missing,
    ready: verified.ready,
  }, { requested: 1, mapped: 1, verified: 1, blocked: 0, missing: 0, ready: true });

  const blocked = structuredClone(valid);
  blocked.status = 'blocked';
  blocked.blockers = ['missing-build-receipt'];
  const result = await auditSources(
    references(), { directories: [] }, readers, { migrationMappings: [blocked] },
  );
  assert.equal(result.report.summary.migrationMapped, 1);
  assert.equal(result.report.summary.migrationVerified, 0);
  assert.equal(result.report.summary.migrationBlocked, 1);
  assert.equal(result.report.summary.migrationReady, false);
  assert.match(renderReport(result.report, references()), /## Migration Mappings/);
  assert.match(renderReport(result.report, references()), /missing-build-receipt/);
});

test('deduplicates both apps and multiple cache snapshots with traceable JSON pointers', () => {
  const models = [
    { id: 'a', app: 'Central', origin: 'cache/a', data: JSON.stringify({ 'x/y': [{ rTObjectRepo: ref.repo }] }) },
    { id: 'b', app: 'ModelDesign', origin: 'cache/b', data: JSON.stringify({ rtObjectRepo: ref.repo }) },
    { id: 'c', app: 'Central', origin: 'cache/c', data: JSON.stringify({ RTOBJECTREPO: ref.repo }) },
  ];
  const result = extractReferences(models, readers.semver);
  assert.equal(result.packages.length, 1);
  assert.equal(result.packages[0].references.length, 3);
  assert.deepEqual(result.packages[0].references[0].locations, ['/x~1y/0/rTObjectRepo']);
  assert.match(result.inputs[0].sha256, /^[a-f0-9]{64}$/);
  assert.equal(result.consistency.Central.referenceSetsAgree, true);
});

test('rejects tags, ranges, unsafe references and records differing cache reference sets', () => {
  const result = extractReferences([
    { id: 'a', app: 'Central', origin: 'a', data: JSON.stringify([{ rTObjectRepo: '@example/plugin@latest' }, { rTObjectRepo: '../secret@1.0.0' }]) },
    { id: 'b', app: 'Central', origin: 'b', data: JSON.stringify({ rTObjectRepo: ref.repo }) },
  ], readers.semver);
  assert.equal(result.invalidReferences.length, 2);
  assert.equal(result.consistency.Central.referenceSetsAgree, false);
  assert.equal(result.packages.length, 1);
  assert.ok(result.invalidReferences.every(issue => !('value' in issue)));
});

test('offline input requires an actual Modeling root and both model documents', t => {
  const root = fixture(t);
  put(join(root, 'PSSYSTEM.json'), { codeName: 'iBizModeling' });
  for (const app of ['Central', 'ModelDesign']) {
    put(join(root, 'PSSYSAPPS', app, 'PSSYSAPP.json'), { rTObjectRepo: ref.repo });
  }
  assert.equal(loadModels({ modelRoot: root }).length, 2);
  put(join(root, 'PSSYSTEM.json'), { codeName: 'iBizPLM' });
  assert.throws(() => loadModels({ modelRoot: root }), /Not an iBizModeling/);
});

test('accepts a complete exact package, hashes all chunks and distinguishes source from build verification', t => {
  const root = install(fixture(t));
  const checked = validateCandidate(ref, directoryCandidate(root));
  assert.equal(checked.evidence.packageComplete, true);
  assert.equal(checked.evidence.runtimeComplete, true);
  assert.equal(checked.evidence.sourcePresent, true);
  assert.equal(checked.evidence.buildVerified, false);
  assert.equal(checked.evidence.executionVerified, false);
  assert.ok(checked.contents.has('dist/chunk.js'));
  assert.equal(checked.evidence.files.length, Object.keys(files).length);
});

test('manifest identity wins over directory names and other versions never satisfy an exact reference', t => {
  const root = install(join(fixture(t), ref.repo));
  put(join(root, 'package.json'), { ...manifest, version: '1.2.3-alpha.5' });
  const checked = validateCandidate(ref, directoryCandidate(root));
  assert.equal(checked.evidence.exactIdentity, false);
  assert.equal(checked.contents, null);
});

test('missing system, CSS, main or declarations prevents staging', t => {
  for (const missing of ['dist/index.system.js', 'dist/style.css', 'lib/index.cjs', 'es/index.d.ts']) {
    const root = join(fixture(t), missing.replaceAll('/', '-'));
    const subset = { ...files };
    delete subset[missing];
    const checked = validateCandidate(ref, directoryCandidate(install(root, subset)));
    assert.equal(checked.evidence.packageComplete, false, missing);
    assert.equal(checked.contents, null);
    assert.ok(checked.evidence.issues.some(issue => issue.path === missing));
  }
});

test('a shared missing system/main path still fails runtime completeness', t => {
  const root = install(fixture(t), {
    ...files, 'package.json': JSON.stringify({ ...manifest, system: 'missing.js', main: 'missing.js' }),
  });
  const checked = validateCandidate(ref, directoryCandidate(root));
  assert.equal(checked.evidence.runtimeComplete, false);
  assert.equal(checked.evidence.packageComplete, false);
});

test('absent styles and empty styles arrays are valid, malformed paths and symlinks are not', t => {
  for (const styles of [undefined, []]) {
    const root = install(fixture(t), { ...files, 'package.json': JSON.stringify({ ...manifest, styles }) });
    assert.equal(validateCandidate(ref, directoryCandidate(root)).evidence.packageComplete, true);
  }
  const root = install(fixture(t));
  put(join(root, 'package.json'), { ...manifest, system: '../../production.js' });
  assert.equal(validateCandidate(ref, directoryCandidate(root)).contents, null);
  put(join(root, 'package.json'), manifest);
  symlinkSync('/etc/hosts', join(root, 'dist/linked.txt'));
  const checked = validateCandidate(ref, directoryCandidate(root));
  assert.equal(checked.contents, null);
  assert.ok(checked.evidence.issues.some(issue => issue.error === 'package-symlink-not-staged'));
});

test('v3 opaque indexes without identity are resolved through verified manifest blobs', t => {
  const f = pnpmFixture(fixture(t), 'v3');
  assert.equal('name' in f.index, false);
  const candidate = pnpmCandidate(f.path, f.store, readers);
  assert.equal(candidate.manifest.name, ref.name);
  assert.equal(validateCandidate(ref, candidate).evidence.packageComplete, true);
});

test('v10 executable blobs work and corrupt blobs never become staging assets', t => {
  const f = pnpmFixture(fixture(t), 'v10', files, true);
  const candidate = pnpmCandidate(f.path, f.store, readers);
  assert.equal(validateCandidate(ref, candidate).evidence.packageComplete, true);
  const data = f.index.files['dist/style.css'];
  const hex = Buffer.from(data.integrity.split('-')[1], 'base64').toString('hex');
  put(join(f.store, 'files', hex.slice(0, 2), hex.slice(2)), 'x'.repeat(data.size));
  const checked = validateCandidate(ref, candidate);
  assert.equal(checked.contents, null);
  assert.ok(checked.evidence.issues.some(issue => issue.error === 'pnpm-integrity-mismatch'));
});

test('rejects pnpm index identity mismatches and unsafe indexed paths', t => {
  const f = pnpmFixture(fixture(t), 'v3', files, true);
  f.index.version = '9.9.9';
  put(f.path, f.index);
  assert.throws(() => pnpmCandidate(f.path, f.store, readers), /identity-mismatch/);
  f.index.version = ref.version;
  f.index.files['../outside.js'] = f.index.files['dist/chunk.js'];
  put(f.path, f.index);
  assert.equal(validateCandidate(ref, pnpmCandidate(f.path, f.store, readers)).contents, null);
});

test('npm tarballs are inspected in memory and package symlinks are rejected', async t => {
  const root = fixture(t);
  const bytes = await archive(root);
  const candidate = await tarCandidate(bytes, 'fixture.tgz', 'tarball', readers);
  assert.equal(validateCandidate(ref, candidate).evidence.packageComplete, true);
  symlinkSync('/etc/hosts', join(root, 'package/dist/link'));
  const chunks = [];
  for await (const chunk of readers.tar.c({ cwd: root, gzip: true }, ['package'])) chunks.push(chunk);
  await assert.rejects(() => tarCandidate(Buffer.concat(chunks), 'unsafe.tgz', 'tarball', readers), /unsafe/);
});

test('Yarn archives with a single non-package root are recognized', async t => {
  const root = fixture(t);
  install(join(root, 'plugin-v1'), files);
  const chunks = [];
  for await (const chunk of readers.tar.c({ cwd: root, gzip: true }, ['plugin-v1'])) chunks.push(chunk);
  const candidate = await tarCandidate(Buffer.concat(chunks), 'yarn.tgz', 'tarball', readers);
  assert.equal(validateCandidate(ref, candidate).evidence.packageComplete, true);
});

test('an unsafe archive is retained as rejected evidence and never staged', async t => {
  const root = fixture(t);
  install(join(root, 'pack/package'));
  symlinkSync('/etc/hosts', join(root, 'pack/package/dist/link'));
  const chunks = [];
  for await (const chunk of readers.tar.c({ cwd: join(root, 'pack'), gzip: true }, ['package'])) chunks.push(chunk);
  const search = join(root, 'archives');
  put(join(search, 'unsafe.tgz'), Buffer.concat(chunks));
  const result = await auditSources(references(), { directories: [search] }, readers);
  assert.equal(result.report.summary.completeExact, 0);
  assert.equal(result.report.summary.scanErrors, 0);
  assert.equal(result.report.summary.rejectedArtifacts, 1);
  assert.equal(result.report.rejectedArtifacts[0].reason, 'unsafe-or-duplicate-archive-entry');
  assert.equal(result.staging.size, 0);
});

test('metadata-only npm entries do not count as downloaded and credentials are not reported', async t => {
  const root = fixture(t);
  const cache = join(root, 'npm');
  await readers.cacache.put(cache, 'make-fetch-happen:request-cache:https://user:secret@registry.example/@example%2fplugin?token=hidden', JSON.stringify({
    name: ref.name, versions: { [ref.version]: { dist: { tarball: 'https://user:secret@registry.example/plugin.tgz?token=hidden' } } },
  }));
  const before = snapshot(cache);
  const result = await auditSources(references(), { npm: [cache] }, readers);
  assert.equal(result.report.summary.completeExact, 0);
  assert.equal(result.report.summary.metadataOnly, 1);
  assert.equal(result.staging.size, 0);
  assert.deepEqual(snapshot(cache), before);
  assert.doesNotMatch(JSON.stringify(result.report), /secret|hidden/);
  assert.equal(result.report.plugins[0].metadataOnly[0].advertisedTarball, 'https://registry.example/plugin.tgz');
});

test('cached npm tarball integrity is checked without changing the input cache', async t => {
  const root = fixture(t);
  const cache = join(root, 'npm');
  await readers.cacache.put(cache, 'make-fetch-happen:request-cache:https://registry.example/@example/plugin/-/plugin-1.2.3-alpha.4.tgz', await archive(join(root, 'pack')));
  const before = snapshot(cache);
  const result = await auditSources(references(), { npm: [cache] }, readers);
  assert.equal(result.report.summary.completeExact, 1);
  assert.equal(result.staging.get(ref.repo).source.kind, 'npm-cacache');
  assert.deepEqual(snapshot(cache), before);
});

test('core audit forwards a source-build receipt only for the matching exact staged artifact', async t => {
  const root = fixture(t);
  const mapping = migrationMappingFixture(root);
  install(join(root, 'target'));
  const target = fingerprintDirectory(root, 'target');
  mapping.target.artifact.fingerprint = target.fingerprint;
  mapping.target.artifact.files = target.files;
  mapping.target.artifact.bytes = target.bytes;
  mapping.build.outputFingerprint = target.fingerprint;
  mapping.build.receipt.outputs = target.entries;
  mapping.build.receipt.outputFingerprint = target.fingerprint;
  const plugin = {
    repo: ref.repo,
    packageEvidence: { status: 'observed', fingerprint: target.fingerprint },
    build: { status: 'verified', receipt: mapping.build.receipt },
  };
  const run = async evidence => auditSources(references(), { directories: [join(root, 'target')] }, readers, {
    migrationMappings: [mapping], pluginEvidence: [evidence],
  });
  const verified = (await run(plugin)).report.plugins[0];
  assert.equal(verified.buildVerified, true);
  assert.deepEqual(verified.buildReceipt, mapping.build.receipt);
  assert.equal(verified.buildFingerprint, target.fingerprint);
  const mismatched = (await run({
    ...plugin, packageEvidence: { ...plugin.packageEvidence, fingerprint: '0'.repeat(64) },
  })).report.plugins[0];
  assert.equal(mismatched.buildReceipt, undefined);
  assert.equal(mismatched.buildVerified, undefined);
  assert.equal((await auditSources(references(), { directories: [join(root, 'target')] }, readers))
    .report.plugins[0].buildReceipt, undefined);
});

test('cached packuments locate opaque CDN tarball URLs without fetching', async t => {
  const root = fixture(t);
  const cache = join(root, 'npm');
  const url = 'https://cdn.example/objects/aabbcc.tgz';
  await readers.cacache.put(cache, 'request-cache:https://registry.example/@example%2fplugin', JSON.stringify({
    name: ref.name, versions: { [ref.version]: { dist: { tarball: url } } },
  }));
  await readers.cacache.put(cache, `request-cache:${url}`, await archive(join(root, 'pack')));
  const before = snapshot(cache);
  const result = await auditSources(references(), { npm: [cache] }, readers);
  assert.equal(result.report.summary.completeExact, 1);
  assert.equal(result.report.coverage[0].examined, 2);
  assert.deepEqual(snapshot(cache), before);
});

test('discovers physical node_modules/source packages, ignores prior staging and reports alternatives', async t => {
  const root = fixture(t);
  install(join(root, 'node_modules/.pnpm/example/node_modules/@example/plugin'));
  const wrong = join(root, 'other/source-package');
  install(wrong, { ...files, 'package.json': JSON.stringify({ ...manifest, version: '2.0.0' }) });
  const output = join(root, 'artifacts');
  install(join(output, 'previous/staging/plugins', ref.repo));
  const result = await auditSources(references(), { directories: [root] }, readers, { excludeRoots: [output] });
  assert.equal(result.report.summary.completeExact, 1);
  assert.equal(result.report.plugins[0].exactCandidates.length, 1);
  assert.equal(result.report.plugins[0].otherVersions[0].version, '2.0.0');
});

test('writes only an independent immutable run and verifies staged bytes without executing scripts', async t => {
  const root = fixture(t);
  const source = install(join(root, 'source'));
  put(join(source, '.npmrc'), '//registry.example/:_authToken=SECRET');
  put(join(source, '.env'), 'PASSWORD=SECRET');
  const before = snapshot(source);
  const refs = references();
  const result = await auditSources(refs, { directories: [source] }, readers);
  const allowed = join(root, '.artifacts/modeling-core-localization');
  const output = join(allowed, 'test-run');
  writeArtifacts(output, refs, result, allowed);
  const report = JSON.parse(readFileSync(join(output, 'audit.json')));
  assert.equal(report.plugins[0].staging.files, Object.keys(files).length);
  const staged = join(output, 'staging/plugins', ref.repo);
  assert.equal(readFileSync(join(staged, 'dist/chunk.js'), 'utf8'), files['dist/chunk.js']);
  assert.equal(existsSync(join(staged, '.npmrc')), false);
  assert.equal(existsSync(join(staged, '.env')), false);
  assert.deepEqual(snapshot(source), before);
  assert.throws(() => writeArtifacts(output, refs, result, allowed), /already exists/);
  assert.throws(() => assertOutput(join(root, 'production'), allowed), /inside/);
});

test('output symlinks, path traversal and unsafe CLI output cannot write production', t => {
  const root = fixture(t);
  const allowed = join(root, 'allowed');
  mkdirSync(allowed);
  const outside = join(root, 'production');
  mkdirSync(outside);
  symlinkSync(outside, join(allowed, 'linked'));
  assert.throws(() => assertOutput(join(allowed, 'linked/run'), allowed), /links/);
  for (const path of ['../x', '/x', 'C:\\x', 'x\\y', 'x%2fy', 'x?y', 'x//y']) assert.equal(safePath(path), false);
  const cli = spawnSync(process.execPath, [script, '--output', outside], { encoding: 'utf8' });
  assert.equal(cli.status, 2);
  assert.equal(readdirSync(outside).length, 0);
});

test('unavailable roots remain explicit coverage gaps, absent roots are not nonexistent packages', async t => {
  const root = fixture(t);
  put(join(root, 'not-a-directory'), 'file');
  const result = await auditSources(references(), {
    directories: [join(root, 'missing'), join(root, 'not-a-directory')],
  }, readers);
  assert.deepEqual(result.report.coverage.map(scope => scope.state), ['absent', 'unavailable']);
  assert.equal(result.report.summary.scanErrors, 1);
  assert.equal(result.report.plugins[0].status, 'no-complete-exact-package-found');
});

test('fully read malformed manifests remain rejected evidence, not access failures or secret output', async t => {
  const root = fixture(t);
  put(join(root, 'package.json'), 'THIS_IS_SECRET invalid json');
  const result = await auditSources(references(), { directories: [root] }, readers);
  assert.equal(result.report.summary.rejectedArtifacts, 1);
  assert.equal(result.report.summary.scanErrors, 0);
  assert.equal(result.report.summary.completeExact, 0);
  assert.equal(result.report.rejectedArtifacts[0].reason, 'invalid-json');
  assert.doesNotMatch(JSON.stringify(result.report), /THIS_IS_SECRET/);
});

test('URL provenance redaction removes credentials, queries and fragments', () => {
  assert.equal(safeUrl('https://u:p@example.test/x?token=a#b'), 'https://example.test/x');
  assert.equal(safeUrl('javascript:alert(1)'), null);
});
