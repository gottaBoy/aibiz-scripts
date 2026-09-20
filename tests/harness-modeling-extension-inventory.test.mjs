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
  ACCEPTANCE_CRITERIA, buildInventory, CATALOG, EXPECTED_CORE_REFS, EXPECTED_EXTENSIONS,
  OUTPUT, parseSystemInserts, scanLocalSources, selectLatestCoreAudit, SQL,
  validateCatalog, verifyCoreAudit, WORKSPACE, writeInventory,
} from '../harness-modeling-extension-inventory.mjs';
import { directoryCandidate, validateCandidate } from '../harness-modeling-core-audit.mjs';

const script = fileURLToPath(new URL('../harness-modeling-extension-inventory.mjs', import.meta.url));
const coreScript = 'scripts/harness-modeling-core-audit.mjs';
const coreRoot = '.artifacts/modeling-core-localization';
const hash = data => createHash('sha256').update(data).digest('hex');
const completeRepo = '@ibiz-template-plugin/logic-tree-design@0.0.3-alpha.56';
const columns = ['ID', 'NAME', 'PRODUCT_ID', 'TYPE', 'HTTP_URL_TO_REPO', 'DEFAULT_BRANCH'];
const sqlString = value => value === null ? 'NULL' : `'${String(value).replaceAll('\\', '\\\\').replaceAll("'", "''")}'`;
const makeInsert = (values, cols = columns) =>
  `INSERT INTO \`fixture\`.\`system\` (${cols.map(col => `\`${col}\``).join(', ')}) VALUES (${values.map(sqlString).join(', ')});`;
const catalog = () => EXPECTED_EXTENSIONS.map(item => ({ ...item, title: `Title ${item.id}` }));

function put(path, data) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof data === 'object' && !Buffer.isBuffer(data) ? JSON.stringify(data, null, 2) : data);
}

function fixture(t) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'modeling-extension-inventory-')));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  put(join(root, CATALOG), catalog());
  const rows = EXPECTED_EXTENSIONS.filter(item => item.upstreamProductId).map(item =>
    makeInsert([item.id, `Title ${item.id}`, item.id, item.family === 'tool' ? 'EXTENSION' : 'BASE',
      `https://example.test/upstream/${item.id}.git`, null]));
  rows.push(makeInsert(['ibizmodeling', 'Core', 'ibizmodeling', 'CORE', 'https://example.test/upstream/core.git', null]));
  put(join(root, SQL), rows.join('\n'));
  put(join(root, 'PLUGIN-LOCALIZATION-AUDIT.md'), '# Historical evidence, not current acceptance\n');
  put(join(root, coreScript), readFileSync(join(WORKSPACE, coreScript)));
  return root;
}

function coreFixture(root, name = 'newest-run', generatedAt = '2026-09-13T13:10:27.599Z') {
  const run = join(root, coreRoot, name);
  const packages = EXPECTED_CORE_REFS.map(repo => {
    const at = repo.lastIndexOf('@');
    return {
      repo, name: repo.slice(0, at), version: repo.slice(at + 1),
      references: ['Central', 'ModelDesign'].map(app => ({
        input: `fixture:${app}`, app, locations: [`/refs/${EXPECTED_CORE_REFS.indexOf(repo)}/rTObjectRepo`],
      })),
    };
  });
  const refs = {
    schemaVersion: 1, invalidReferences: [],
    consistency: Object.fromEntries(['Central', 'ModelDesign'].map(app => [app, { inputs: 1, referenceSetsAgree: true }])),
    inputs: ['Central', 'ModelDesign'].map(app => ({
      id: `fixture:${app}`, app, origin: `fixture/${app}/PSSYSAPP.json`,
      bytes: 123, sha256: hash(app), referenceCount: EXPECTED_CORE_REFS.length, refs: [...EXPECTED_CORE_REFS],
    })),
    packages,
  };
  const complete = packages.find(pkg => pkg.repo === completeRepo);
  const staging = `staging/plugins/${complete.repo}`;
  const packagePath = join(run, staging);
  put(join(packagePath, 'package.json'), {
    name: complete.name, version: complete.version, system: 'dist/index.system.js', styles: ['dist/style.css'],
  });
  put(join(packagePath, 'dist/index.system.js'), 'System.register([], function () {});');
  put(join(packagePath, 'dist/style.css'), '.plugin { color: red; }');
  put(join(packagePath, 'src/index.ts'), 'export const source = true;');
  const evidence = validateCandidate(complete, directoryCandidate(packagePath)).evidence;
  const audit = {
    schemaVersion: 1, generatedAt,
    generator: { script: coreScript, sha256: hash(readFileSync(join(root, coreScript))) },
    summary: { requested: 13, completeExact: 1, missingExact: 12, scanErrors: 0, runtimeVerified: 0 },
    coverage: [{ kind: 'directory-tree', path: root, state: 'scanned', errorCount: 0 }],
    scanErrors: [], rejectedArtifacts: [],
    plugins: packages.map(pkg => ({
      ...pkg,
      status: pkg.repo === completeRepo ? 'exact-complete-local-package' : 'no-complete-exact-package-found',
      exactCandidates: pkg.repo === completeRepo ? [evidence] : [],
      otherVersions: pkg.repo === completeRepo ? [] : [{ version: '9.9.9', eligible: false }],
      metadataOnly: pkg.repo === completeRepo ? [] : [{ kind: 'metadata-only', downloaded: false }],
      staging: pkg.repo === completeRepo ? {
        path: staging, source: evidence.location, files: evidence.files.length, fingerprint: evidence.fingerprint,
      } : null,
    })),
  };
  const write = () => {
    put(join(run, 'audit.json'), audit);
    put(join(run, 'plugin-references.json'), refs);
  };
  write();
  return { run, audit, refs, write, packagePath };
}

function snapshot(root) {
  const files = {};
  function visit(path) {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const file = join(path, entry.name);
      if (entry.isDirectory()) visit(file);
      else if (entry.isFile()) files[file] = hash(readFileSync(file));
    }
  }
  visit(root);
  return files;
}

test('catalog contract pins all 23 exact IDs, families and the two unknown upstream identities', () => {
  assert.equal(validateCatalog(catalog()).length, 23);
  assert.deepEqual(EXPECTED_EXTENSIONS.filter(item => !item.upstreamProductId).map(item => item.id),
    ['modeling-materials', 'modeling-sync']);
  for (const broken of [catalog().slice(1), [...catalog(), catalog()[0]],
    catalog().map((item, i) => i === 0 ? { ...item, id: 'replacement' } : item),
    catalog().map(item => item.id === 'modeling-sync' ? { ...item, upstreamProductId: 'invented-sync-id' } : item),
    catalog().map((item, i) => i === 0 ? { ...item, family: 'tool' } : item)]) {
    assert.throws(() => validateCatalog(broken), /catalog-/);
  }
});

test('SQL scanner handles comments, multiple rows, quote escapes, reordered columns and NULL', () => {
  const text = `# INSERT INTO system is only a comment
-- another comment with a semicolon ;
/* 'quotes', (parentheses) ; */
INSERT INTO secrets (password) VALUES ('never-emit-this');
INSERT INTO \`db\`.\`system\`
(\`NAME\`, \`ID\`, \`TYPE\`, \`PRODUCT_ID\`, \`HTTP_URL_TO_REPO\`, \`DEFAULT_BRANCH\`)
VALUES ('Editor, O''Brien; (standard)', 'one', 'BASE', 'logicdesign',
'https://user:never-emit-this@example.test/editor.git?token=never-emit-this#fragment', NULL),
('Backslash \\'quote\\' \\\\ path', 'two', 'BASE', 'formdesign', NULL, 'main');
`;
  const rows = parseSystemInserts(text);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].title, "Editor, O'Brien; (standard)");
  assert.equal(rows[0].productId, 'logicdesign');
  assert.equal(rows[0].repository, 'https://example.test/editor.git');
  assert.equal(rows[0].defaultBranch, null);
  assert.equal(rows[1].title, "Backslash 'quote' \\ path");
  assert.equal(rows[1].defaultBranch, 'main');
  assert.equal(rows[0].line, 5);
  assert.equal(JSON.stringify(rows).includes('never-emit-this'), false);
});

test('SQL quoted backticks, double-quoted strings, integer literals and INSERT IGNORE are supported', () => {
  const text = 'insert ignore into `d``b`.`system` (`ID`,`NAME`,`PRODUCT_ID`,`TYPE`,`HTTP_URL_TO_REPO`,`EXTRA`) values ("a","Name ""quoted""","a","BASE",NULL,12);';
  assert.equal(parseSystemInserts(text)[0].title, 'Name "quoted"');
});

test('SQL malformed values, duplicate IDs, executable expressions and unterminated input fail closed', () => {
  const valid = makeInsert(['one', 'Logic', 'logicdesign', 'BASE', null, null]);
  for (const text of [
    valid.replace("'Logic'", "CONCAT('bad', 'expression')"),
    valid.replace("'Logic'", "'unterminated"),
    valid.replace(', NULL);', ');'),
    valid.replace("'one',", "'one', 'extra',"),
    valid.replace('`ID`, `NAME`', '`ID`, `ID`'),
    `${valid}\n${valid}`,
    `${valid}\n${makeInsert(['two', 'Logic again', 'logicdesign', 'BASE', null, null])}`,
    valid.replace('VALUES', 'SELECT'),
    valid.replace(');', ',);'),
    valid.replace(');', '),;'),
    `${valid} /* unclosed comment`,
    `/*! ${valid} */`,
    valid.replace(');', ') ON DUPLICATE KEY UPDATE NAME = 1;'),
  ]) assert.throws(() => parseSystemInserts(text), /sql-/);
});

test('real catalog and SQL map 21 requested products plus one separate core without fabricating missing IDs', () => {
  const items = validateCatalog(JSON.parse(readFileSync(join(WORKSPACE, CATALOG))));
  const rows = parseSystemInserts(readFileSync(join(WORKSPACE, SQL), 'utf8'));
  assert.equal(rows.length, 22);
  assert.equal(items.filter(item => rows.some(row => row.productId === item.upstreamProductId)).length, 21);
  assert.deepEqual(rows.filter(row => !items.some(item => item.upstreamProductId === row.productId)).map(row => [row.productId, row.type]),
    [['ibizmodeling', 'CORE']]);
});

test('latest core audit uses report time, not directory name or modification time', t => {
  const root = fixture(t);
  const latest = coreFixture(root, 'aaa', '2026-09-13T13:10:27.599Z');
  coreFixture(root, 'zzz', '2026-09-13T13:03:00.000Z');
  assert.equal(selectLatestCoreAudit(root), latest.run);
  assert.equal(verifyCoreAudit(root).summary.missingExact, 12);
});

test('an unreadable/invalid run or ambiguous newest time never silently selects an older successful audit', t => {
  const root = fixture(t);
  const good = coreFixture(root);
  put(join(root, coreRoot, 'incomplete-new-run', 'audit.json'), '{');
  assert.equal(verifyCoreAudit(root).status, 'invalid-or-unavailable');
  assert.equal(verifyCoreAudit(root, good.run).status, 'verified-local-audit-artifacts');
  rmSync(join(root, coreRoot, 'incomplete-new-run'), { recursive: true });
  coreFixture(root, 'same-time');
  assert.ok(verifyCoreAudit(root).issues.includes('core-audit-ambiguous-latest'));
});

test('core verification rehashes the exact staged package without promoting other versions, metadata or source presence', t => {
  const root = fixture(t);
  coreFixture(root);
  const result = verifyCoreAudit(root);
  assert.equal(result.status, 'verified-local-audit-artifacts');
  assert.equal(result.summary.requested, 13);
  assert.equal(result.summary.completeExact, 1);
  assert.equal(result.summary.missingExact, 12);
  assert.deepEqual(result.missingExact, EXPECTED_CORE_REFS.filter(repo => repo !== completeRepo));
  const complete = result.plugins.find(pkg => pkg.repo === completeRepo);
  assert.equal(complete.stagedAssets.sourceFilesPresent, true);
  assert.equal(complete.buildVerified, false);
  assert.equal(complete.executionVerified, false);
  assert.ok(result.plugins.every(pkg => pkg.otherVersionsEligible === false));
  assert.ok(result.artifacts.every(item => /^[a-f0-9]{64}$/.test(item.sha256)));
});

test('changed stage bytes, renamed-version manifests, missing styles and substituted package versions invalidate evidence', t => {
  for (const mutate of [
    f => put(join(f.packagePath, 'dist/index.system.js'), 'different bytes'),
    f => put(join(f.packagePath, 'package.json'), {
      name: '@ibiz-template-plugin/logic-tree-design', version: '9.9.9', system: 'dist/index.system.js',
    }),
    f => rmSync(join(f.packagePath, 'dist/style.css')),
    f => { f.audit.plugins[0].version = '9.9.9'; f.write(); },
    f => { f.refs.packages[0].repo = '@ibiz-template-plm/drbar-ex@9.9.9'; f.write(); },
  ]) {
    const root = fixture(t);
    const f = coreFixture(root);
    mutate(f);
    const result = verifyCoreAudit(root);
    assert.equal(result.status, 'invalid-or-unavailable');
    assert.equal(result.summary, null);
    assert.deepEqual(result.missingExact, []);
  }
});

test('core counters, file fingerprints, reference pointers, snapshot hashes and scan coverage must be consistent', t => {
  for (const mutate of [
    f => { f.audit.summary.completeExact = 13; },
    f => { f.audit.generator.sha256 = '0'.repeat(64); },
    f => { f.refs.inputs[0].sha256 = null; },
    f => { f.refs.inputs[0].refs.pop(); },
    f => { f.refs.consistency.Central.inputs = 2; },
    f => { f.audit.plugins[0].references[0].locations = []; },
    f => { f.audit.coverage[0].state = 'partial'; },
    f => { f.audit.plugins[0].otherVersions[0].eligible = true; },
    f => { f.audit.plugins[0].exactCandidates = [{ packageComplete: true }]; },
    f => { f.audit.plugins.find(pkg => pkg.staging).staging.fingerprint = '0'.repeat(64); },
  ]) {
    const root = fixture(t);
    const f = coreFixture(root);
    mutate(f); f.write();
    assert.equal(verifyCoreAudit(root).status, 'invalid-or-unavailable');
  }
});

test('core audit and staged symlink escapes are not read', t => {
  const root = fixture(t);
  const f = coreFixture(root);
  const outside = fixture(t);
  assert.ok(verifyCoreAudit(root, outside).issues.includes('core-audit-run-outside-evidence-root'));
  rmSync(join(f.packagePath, 'dist/style.css'));
  symlinkSync('/etc/hosts', join(f.packagePath, 'dist/style.css'));
  assert.equal(verifyCoreAudit(root).status, 'invalid-or-unavailable');
  rmSync(join(f.run, 'audit.json'));
  symlinkSync(join(outside, CATALOG), join(f.run, 'audit.json'));
  assert.ok(verifyCoreAudit(root, f.run).issues.includes('symlink-input-not-read'));
});

test('source candidates and named/repository-matched packages are not authenticated upstream sources or exact packages', t => {
  const root = fixture(t);
  const original = join(root, 'sources/logicdesign');
  put(join(original, 'package.json'), {
    name: 'logicdesign', version: '9.9.9', repository: 'https://example.test/upstream/logicdesign.git',
    system: 'dist/index.system.js', scripts: { build: 'NEVER_EXECUTE' },
  });
  put(join(original, 'src/editor.ts'), 'export const editor = true;');
  put(join(original, 'dist/index.system.js'), 'System.register([], function () {});');
  put(join(original, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
  const products = parseSystemInserts(readFileSync(join(root, SQL), 'utf8'));
  const before = snapshot(root);
  const result = scanLocalSources(root, products);
  assert.deepEqual(snapshot(root), before);
  const candidate = result.originals.logicdesign[0];
  assert.equal(candidate.provenanceVerified, false);
  assert.equal(candidate.source.files.length, 1);
  assert.equal(candidate.runtime.declaredAssetsPresent, true);
  assert.equal(candidate.runtime.exactUpstreamVersionVerified, false);
  assert.equal(candidate.runtime.expectedVersion, null);
  assert.equal(candidate.lockfiles.length, 1);
  assert.deepEqual(candidate.matchedBy, ['directory-name-only', 'manifest-name-only', 'manifest-repository-claim']);
});

test('metadata entries, declaration files and independent family editors never count as completed original extensions', t => {
  const root = fixture(t);
  coreFixture(root);
  put(join(root, 'modelingweb/app/src/modeling-plugins/graph/model.ts'), 'export const draft = {};');
  put(join(root, 'modelingweb/app/src/modeling-plugins/layout/types.d.ts'), 'export declare const field: string;');
  put(join(root, 'modelingweb/app/src/modeling-plugins/tools/package.json'), {
    name: 'logicdesign', repository: 'https://example.test/upstream/logicdesign.git',
  });
  put(join(root, 'modelingweb/app/src/modeling-plugins/tools/logicdesign/index.ts'), 'export const localOnly = true;');
  const result = buildInventory(root);
  assert.equal(result.summary.requestedExtensions, 23);
  assert.equal(result.summary.sqlRegisteredExtensions, 21);
  assert.equal(result.summary.sqlRegisteredSystems, 22);
  assert.equal(result.summary.originalSourceCandidates, 0);
  assert.equal(result.summary.originalExtensionsVerified, 0);
  assert.equal(result.summary.independentExtensionsVerified, 0);
  assert.equal(result.summary.independentFamiliesWithSource, 2);
  assert.equal(result.summary.inputEvidenceValid, true);
  assert.equal(result.summary.originalCompleteness, false);
  assert.equal(result.summary.fullFlowVerified, false);
  assert.equal(result.summary.exitCode, 1);
  assert.equal(result.extensions[0].independent.status, 'family-source-present-unverified');
  assert.equal(result.extensions.find(item => item.id === 'formdesign').independent.familyCodeFiles, 0);
  assert.equal(result.extensions[0].upstream.sourceAvailability, 'not-found-in-scanned-candidates');
  assert.equal(result.extensions[0].upstream.runtimePackageAvailability, 'not-found-in-scanned-candidates');
  const materials = result.extensions.find(item => item.id === 'modeling-materials').upstream;
  assert.equal(materials.availability, 'unknown-upstream-identity');
  assert.equal(materials.sourceAvailability, 'unknown-upstream-identity');
  assert.equal(materials.runtimePackageAvailability, 'unknown-upstream-identity');
  assert.equal(materials.exactRuntimePackageIdentity, null);
  for (const item of result.extensions) {
    assert.equal(item.independent.upstreamEquivalent, false);
    for (const implementation of [item.upstream, item.independent]) {
      assert.deepEqual(Object.keys(implementation.criteria), Object.keys(ACCEPTANCE_CRITERIA));
      assert.ok(Object.values(implementation.criteria).every(criterion => criterion.passed === false));
    }
  }
});

test('missing SQL mappings and unavailable core evidence produce an incomplete-input gate, not a successful inventory', t => {
  const root = fixture(t);
  const sql = readFileSync(join(root, SQL), 'utf8').split('\n').filter(line => !line.includes("'formdesign'")).join('\n');
  put(join(root, SQL), sql);
  const result = buildInventory(root);
  assert.equal(result.summary.exitCode, 2);
  assert.equal(result.summary.inputEvidenceValid, false);
  assert.equal(result.summary.coreExactMissing, null);
  assert.ok(result.issues.some(issue => issue.id === 'formdesign' && issue.error === 'expected-sql-product-missing'));
});

test('new SQL-only materials/sync identifiers are exposed as contract drift, never guessed as upstream mappings', t => {
  const root = fixture(t);
  coreFixture(root);
  put(join(root, SQL), `${readFileSync(join(root, SQL), 'utf8')}\n${makeInsert([
    'new', 'Materials', 'made-up-materials', 'EXTENSION', null, null,
  ])}`);
  const result = buildInventory(root);
  assert.equal(result.summary.exitCode, 2);
  assert.ok(result.issues.some(issue => issue.error === 'sql-core-or-extension-contract-drift'));
  assert.equal(result.extensions.find(item => item.id === 'modeling-materials').sql, null);
});

test('inventory output is isolated, hashed and immutable; it cannot overwrite files or traverse links', t => {
  const root = fixture(t);
  coreFixture(root);
  const report = buildInventory(root);
  const before = snapshot(root);
  const output = join(root, OUTPUT, 'run');
  writeInventory(root, output, report);
  const bytes = readFileSync(join(output, 'inventory.json'));
  assert.equal(readFileSync(join(output, 'inventory.sha256'), 'utf8'), `${hash(bytes)}  inventory.json\n`);
  assert.equal(JSON.parse(bytes).summary.exitCode, 1);
  for (const [path, fingerprint] of Object.entries(before)) assert.equal(hash(readFileSync(path)), fingerprint);
  assert.throws(() => writeInventory(root, output, report), /already exists/);
  assert.throws(() => writeInventory(root, join(root, 'production'), report), /Output must/);
  assert.throws(() => writeInventory(root, join(root, OUTPUT), report), /Output must/);
  const outside = fixture(t);
  symlinkSync(outside, join(root, OUTPUT, 'linked'));
  assert.throws(() => writeInventory(root, join(root, OUTPUT, 'linked/run'), report), /links/);
  assert.equal(existsSync(join(outside, 'run')), false);
});

test('CLI help succeeds and unsupported options or unsafe output fail without starting an inventory', () => {
  const help = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  assert.match(help.stdout, /cannot certify completeness or exit 0/);
  for (const args of [['--fake-complete'], ['--output', '/tmp/not-an-approved-inventory-run']]) {
    const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Extension inventory failed/);
  }
});
