import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { fingerprint } from '../native-candidate-files.mjs';
import { readFileBase64Replacement } from '../prepare-native-file-base64-replacement.mjs';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sourcePath = 'modelingweb/local-plugins/file-to-base64';
const original = '@ibiz-template-plugin/file-to-base64@0.1.8-alpha.165';
const replacement = '@aibiz/file-to-base64@0.1.0';
const script = join(workspaceRoot, 'scripts/prepare-native-file-base64-replacement.mjs');
const nativeContract = JSON.parse(fs.readFileSync(join(workspaceRoot,
  'scripts/fixtures/modeling-core-migration-contract.json'), 'utf8'));
const hash = data => createHash('sha256').update(data).digest('hex');
const json = (path, value) => fs.writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);

function fixture(t) {
  const directory = fs.mkdtempSync(join(tmpdir(), 'native-file-base64-replacement-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const workspace = join(directory, 'workspace');
  const root = join(workspace, sourcePath);
  fs.mkdirSync(dirname(root), { recursive: true });
  fs.cpSync(join(workspaceRoot, sourcePath), root, { recursive: true });
  const contract = structuredClone(nativeContract);
  const contractPath = join(workspace, 'scripts/fixtures/modeling-core-migration-contract.json');
  fs.mkdirSync(dirname(contractPath), { recursive: true });
  json(contractPath, contract);
  return { directory, workspace, root, contract, contractPath,
    receiptPath: join(root, 'dist/build-receipt.json'),
    manifestPath: join(root, 'package.json') };
}

function changeJson(path, mutate) {
  const value = JSON.parse(fs.readFileSync(path, 'utf8'));
  mutate(value);
  json(path, value);
}

function refreshHash(data, section, path) {
  changeJson(data.receiptPath, receipt => {
    const base = section === 'outputs' ? join(data.root, 'dist') : data.root;
    receipt[section].find(entry => entry.path === path).sha256 = hash(fs.readFileSync(join(base, path)));
  });
}

function snapshot(root) {
  const entries = [];
  function visit(path, prefix = '') {
    for (const name of fs.readdirSync(path).sort()) {
      const target = join(path, name);
      const relative = prefix ? `${prefix}/${name}` : name;
      const info = fs.lstatSync(target);
      if (info.isSymbolicLink()) entries.push({ path: relative, link: fs.readlinkSync(target) });
      else if (info.isDirectory()) {
        entries.push({ path: relative, directory: true });
        visit(target, relative);
      } else entries.push({ path: relative, sha256: hash(fs.readFileSync(target)), mode: info.mode });
    }
  }
  visit(root);
  return entries;
}

test('returns exactly manifest and four outputs with an honest independent identity, read-only', t => {
  const data = fixture(t);
  const before = snapshot(data.directory);
  const originalContract = structuredClone(data.contract);
  const result = readFileBase64Replacement(data);
  assert.deepEqual(result.files.entries.map(file => file.path), [
    'dist/file-logic.mjs', 'dist/index.mjs', 'dist/index.system.js', 'dist/style.css', 'package.json',
  ]);
  assert.deepEqual(result.files.entries, result.files.contents.map(({ path, bytes, sha256 }) =>
    ({ path, bytes, sha256 })));
  assert.equal(result.files.fingerprint, fingerprint(result.files.entries).fingerprint);
  for (const file of result.files.contents) {
    assert.deepEqual(file.data, fs.readFileSync(join(data.root, file.path)));
    assert.equal(hash(file.data), file.sha256);
    assert.equal(file.bytes, file.data.length);
    assert.equal(Object.hasOwn(file, 'identity'), false);
  }
  const manifest = JSON.parse(result.files.contents.find(file => file.path === 'package.json').data);
  assert.equal(`${manifest.name}@${manifest.version}`, replacement);
  assert.equal(Object.hasOwn(manifest, 'gitHead'), false);
  assert.equal(result.plugin.from, original);
  assert.equal(result.plugin.to, replacement);
  assert.equal(result.plugin.contract, 'native-file-base64-independent-replacement');
  assert.equal(result.plugin.sourceStatus, 'independent-local-implementation');
  assert.equal(result.plugin.sourceInputs.length, 8);
  assert.equal(result.plugin.buildOutputs.length, 4);
  assert.equal(result.plugin.sourceFingerprint, fingerprint(result.plugin.sourceInputs).fingerprint);
  assert.equal(result.plugin.buildOutputFingerprint, fingerprint(result.plugin.buildOutputs).fingerprint);
  assert.equal(result.plugin.outputFingerprint, result.files.fingerprint);
  assert.equal(result.plugin.buildReceipt.path, `${sourcePath}/dist/build-receipt.json`);
  assert.equal(result.plugin.buildReceipt.sha256, hash(fs.readFileSync(data.receiptPath)));
  assert.equal(result.plugin.originalMigrationAcceptance, 'not-satisfied-by-independent-replacement');
  for (const flag of [
    'originalSourceRecovered', 'originalRepositoryAuthenticated',
    'nativeCompatibilityVerified', 'acceptedForProduction',
  ]) assert.equal(result.plugin[flag], false);
  assert.equal(result.plugin.compatibility, 'not-verified');
  assert.deepEqual(result.plugin.runtimeImports, ['@ibiz-template/runtime', '@ibiz-template/vue3-util', 'vue']);
  assert.equal(result.plugin.peerDependencies['@ibiz-template/runtime'], '0.7.41-alpha.86');
  assert.deepEqual(data.contract, originalContract);
  assert.deepEqual(snapshot(data.directory), before);
  assert.deepEqual(readFileBase64Replacement(data), result);
});

for (const path of [
  'build.mjs', 'package.json', 'src/controller.ts', 'src/editor.ts', 'src/file-logic.ts',
  'src/index.ts', 'src/provider.ts', 'src/style.css',
]) {
  test(`refuses source drift: ${path}`, t => {
    const data = fixture(t);
    fs.appendFileSync(join(data.root, path), '\n');
    const before = snapshot(data.directory);
    assert.throws(() => readFileBase64Replacement(data), /source input hashes/);
    assert.deepEqual(snapshot(data.directory), before);
  });
}

for (const path of ['index.mjs', 'index.system.js', 'file-logic.mjs', 'style.css']) {
  test(`refuses output drift: ${path}`, t => {
    const data = fixture(t);
    fs.appendFileSync(join(data.root, 'dist', path), '\n');
    assert.throws(() => readFileBase64Replacement(data), /build output hashes/);
  });
}

for (const path of ['extra.mjs', 'src/extra.ts', 'dist/extra.js', 'src/empty', 'dist/empty']) {
  test(`refuses unrecorded files or empty directories: ${path}`, t => {
    const data = fixture(t);
    const target = join(data.root, path);
    if (path.endsWith('/empty')) fs.mkdirSync(target);
    else fs.writeFileSync(target, 'unrecorded\n');
    assert.throws(() => readFileBase64Replacement(data), /Unexpected replacement file set/);
  });
}

for (const [name, mutate, pattern] of [
  ['missing source inventory entry', receipt => { receipt.inputs.pop(); }, /source input hashes/],
  ['duplicate source entry', receipt => { receipt.inputs.push(receipt.inputs[0]); }, /source input hashes/],
  ['missing output entry', receipt => { receipt.outputs.pop(); }, /build output hashes/],
  ['extra output entry', receipt => { receipt.outputs.push({ path: 'extra.js', sha256: 'a'.repeat(64) }); },
    /build output hashes/],
  ['parent traversal input', receipt => { receipt.inputs[0].path = '../outside.mjs'; }, /source input hashes/],
  ['absolute output path', receipt => { receipt.outputs[0].path = '/tmp/outside.mjs'; }, /build output hashes/],
  ['backslash input path', receipt => { receipt.inputs[0].path = 'src\\index.ts'; }, /source input hashes/],
  ['receipt package alias', receipt => { receipt.package.name = '@ibiz-template-plugin/file-to-base64'; },
    /receipt package identity/],
  ['receipt gitHead', receipt => { receipt.package.gitHead = 'invented'; }, /receipt package identity/],
  ['claimed recovered source', receipt => { receipt.originalSourceRecovered = true; }, /recovery cannot be claimed/],
  ['claimed native compatibility', receipt => { receipt.nativeCompatibilityVerified = true; },
    /compatibility cannot be claimed/],
  ['claimed authenticated source status', receipt => { receipt.sourceStatus = 'verified'; }, /source status/],
  ['extra receipt acceptance claim', receipt => { receipt.acceptedForProduction = true; }, /receipt fields/],
  ['missing receipt field', receipt => { delete receipt.nativeCompatibilityVerified; }, /receipt fields/],
  ['unknown receipt schema', receipt => { receipt.schemaVersion = 2; }, /receipt schema/],
  ['invalid toolchain digest', receipt => { receipt.toolchain.rollup.sha256 = 'invalid'; }, /toolchain hash/],
  ['unexpected toolchain version', receipt => { receipt.toolchain.typescript.version = 'next'; },
    /toolchain version/],
  ['expanded compiler verification', receipt => { receipt.compilerChecks = 'full typecheck'; },
    /verification scope/],
  ['recorded versioned external alias', receipt => { receipt.runtimeImports[0] += '@0.7.41-alpha.86'; },
    /Recorded external import identity/],
]) {
  test(`refuses ${name}`, t => {
    const data = fixture(t);
    changeJson(data.receiptPath, mutate);
    assert.throws(() => readFileBase64Replacement(data), pattern);
  });
}

for (const [name, mutate, pattern] of [
  ['original package name', manifest => { manifest.name = '@ibiz-template-plugin/file-to-base64'; }, /manifest differs/],
  ['original version', manifest => { manifest.version = '0.1.8-alpha.165'; }, /manifest differs/],
  ['gitHead even when null', manifest => { manifest.gitHead = null; }, /cannot contain gitHead/],
  ['outside SystemJS entry', manifest => { manifest.system = '../index.js'; }, /manifest differs/],
  ['outside style entry', manifest => { manifest.styles = ['/tmp/style.css']; }, /manifest differs/],
  ['external importmap', manifest => {
    manifest['systemjs-importmap'] = { imports: { vue: 'https://example.invalid/vue.js' } };
  }, /manifest differs/],
  ['runtime peer version', manifest => { manifest.peerDependencies['@ibiz-template/runtime'] = '*'; },
    /manifest differs/],
]) {
  test(`refuses manifest ${name} even with a refreshed receipt hash`, t => {
    const data = fixture(t);
    changeJson(data.manifestPath, mutate);
    refreshHash(data, 'inputs', 'package.json');
    assert.throws(() => readFileBase64Replacement(data), pattern);
  });
}

for (const [name, path, mutate, pattern] of [
  ['ESM external alias', 'index.mjs',
    text => text.replace("'@ibiz-template/runtime'", "'@ibiz-template/runtime@0.7.41-alpha.86'"),
    /ESM external import identity/],
  ['SystemJS external alias', 'index.system.js',
    text => text.replace("'@ibiz-template/runtime'", "'@ibiz-template/runtime@0.7.41-alpha.86'"),
    /SystemJS external import identity/],
  ['extra dynamic import', 'index.mjs', text => `${text}\nimport('unrecorded');\n`, /Dynamic external loading/],
  ['pure logic external import', 'file-logic.mjs', text => `import 'vue';\n${text}`, /Pure file logic/],
  ['non-SystemJS output', 'index.system.js', () => 'export default {};\n', /SystemJS bundle contains ESM|System.register/],
  ['named SystemJS registration', 'index.system.js',
    text => text.replace('System.register(', 'System.register("@aibiz/file-to-base64", '),
    /anonymous System.register/],
  ['missing SystemJS default', 'index.system.js',
    text => text.replace('exports("default",', 'exports("not-default",'), /SystemJS default plugin/],
  ['missing ESM default', 'index.mjs', text => text.replace('plugin as default', 'plugin as notDefault'),
    /ESM default plugin/],
  ['malformed JavaScript', 'index.mjs', text => `${text}\n{\n`, /Invalid JavaScript/],
  ['changed CSS with a refreshed output hash', 'style.css', text => `${text}\n.changed {}\n`,
    /Built styles differ/],
]) {
  test(`refuses ${name} even with a refreshed output hash`, t => {
    const data = fixture(t);
    const target = join(data.root, 'dist', path);
    fs.writeFileSync(target, mutate(fs.readFileSync(target, 'utf8')));
    refreshHash(data, 'outputs', path);
    assert.throws(() => readFileBase64Replacement(data), pattern);
  });
}

for (const path of ['package.json', 'README.md', 'build.mjs', 'src/index.ts',
  'dist/index.system.js', 'dist/style.css', 'dist/build-receipt.json']) {
  test(`refuses a symlink file: ${path}`, t => {
    const data = fixture(t);
    const target = join(data.root, path);
    const outside = join(data.directory, 'outside-file');
    fs.renameSync(target, outside);
    fs.symlinkSync(outside, target);
    const before = snapshot(data.directory);
    assert.throws(() => readFileBase64Replacement(data), /Symlink resource rejected/);
    assert.deepEqual(snapshot(data.directory), before);
  });
}

for (const path of ['', 'modelingweb', 'modelingweb/local-plugins', sourcePath,
  `${sourcePath}/src`, `${sourcePath}/dist`]) {
  test(`refuses a symlink directory or ancestor: ${path || 'workspace'}`, t => {
    const data = fixture(t);
    const target = join(data.workspace, path);
    const outside = join(data.directory, 'outside-directory');
    fs.renameSync(target, outside);
    fs.symlinkSync(outside, target, 'dir');
    assert.throws(() => readFileBase64Replacement(data), /Symlink directory rejected/);
  });
}

for (const [name, mutate, pattern] of [
  ['missing original mapping', contract => {
    contract.migrationMappings = contract.migrationMappings.filter(mapping => mapping.from !== original);
  }, /mapping must exist exactly once/],
  ['duplicate original mapping', contract => {
    contract.migrationMappings.push(structuredClone(contract.migrationMappings.find(mapping => mapping.from === original)));
  }, /mapping must exist exactly once/],
  ['missing original plugin', contract => {
    contract.plugins = contract.plugins.filter(plugin => plugin.repo !== original);
  }, /native plugin contract/],
  ['independent contract passed as native', contract => { contract.contract = 'independent-replacement'; },
    /Expected native migration contract/],
]) {
  test(`refuses ${name}`, t => {
    const data = fixture(t);
    mutate(data.contract);
    const before = structuredClone(data.contract);
    assert.throws(() => readFileBase64Replacement(data), pattern);
    assert.deepEqual(data.contract, before);
  });
}

test('does not consume or promote original migration acceptance and rejects an omitted contract', t => {
  const data = fixture(t);
  const mapping = data.contract.migrationMappings.find(item => item.from === original);
  assert.notEqual(mapping.build.status, 'verified');
  const before = structuredClone(mapping);
  assert.equal(readFileBase64Replacement(data).plugin.acceptedForProduction, false);
  assert.deepEqual(mapping, before);
  assert.throws(() => readFileBase64Replacement({ workspace: data.workspace }), /native migration contract/);
});

test('CLI checks fixture read-only and exits 2 for integrity-only, not native acceptance', t => {
  const data = fixture(t);
  const before = snapshot(data.directory);
  const result = spawnSync(process.execPath, [script, '--workspace', data.workspace], { encoding: 'utf8' });
  assert.equal(result.status, 2, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.plugin.acceptedForProduction, false);
  assert.equal(report.plugin.compatibility, 'not-verified');
  assert.equal(report.files.entries.length, 5);
  assert.equal(Object.hasOwn(report.files, 'contents'), false);
  assert.deepEqual(snapshot(data.directory), before);
  const help = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /no deployment or native acceptance/);
  changeJson(data.receiptPath, receipt => { receipt.originalSourceRecovered = true; });
  const rejected = spawnSync(process.execPath, [script, '--workspace', data.workspace], { encoding: 'utf8' });
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /recovery cannot be claimed/);
});
