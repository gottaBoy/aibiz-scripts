import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { fingerprint } from '../native-candidate-files.mjs';
import { readGlobalUtilReplacement } from '../prepare-native-global-util-replacement.mjs';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sourcePath = 'modelingweb/local-plugins/global-util';
const original = '@ibiz-template-plugin/global-util-design@0.0.3-alpha.87';
const replacement = '@aibiz/global-util@0.1.0';
const script = join(workspaceRoot, 'scripts/prepare-native-global-util-replacement.mjs');
const nativeContract = JSON.parse(fs.readFileSync(join(workspaceRoot,
  'scripts/fixtures/modeling-core-migration-contract.json'), 'utf8'));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = (path, value) => fs.writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);

function fixture(t) {
  const directory = fs.mkdtempSync(join(tmpdir(), 'native-global-util-replacement-'));
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
    const entry = receipt[section].find(item => item.path === path);
    assert.ok(entry, `Fixture receipt must contain ${section}/${path}`);
    entry.sha256 = hash(fs.readFileSync(join(base, path)));
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
        entries.push({ path: relative, mode: info.mode, directory: true });
        visit(target, relative);
      } else entries.push({ path: relative, mode: info.mode, sha256: hash(fs.readFileSync(target)) });
    }
  }
  visit(root);
  return entries;
}

test('binds exact delivery, source, build and receipt without claiming original or native acceptance', t => {
  const data = fixture(t);
  const before = snapshot(data.directory);
  const contractBefore = structuredClone(data.contract);
  const { files, plugin } = readGlobalUtilReplacement(data);
  assert.deepEqual(files.entries.map(file => file.path),
    ['dist/index.mjs', 'dist/index.system.js', 'package.json']);
  assert.deepEqual(files.entries, files.contents.map(({ path, bytes, sha256 }) => ({ path, bytes, sha256 })));
  assert.equal(files.fingerprint, fingerprint(files.entries).fingerprint);
  for (const file of files.contents) {
    assert.deepEqual(file.data, fs.readFileSync(join(data.root, file.path)));
    assert.equal(file.sha256, hash(file.data));
    assert.equal(file.bytes, file.data.length);
    assert.equal(Object.hasOwn(file, 'identity'), false);
  }
  const manifest = JSON.parse(files.contents.find(file => file.path === 'package.json').data);
  assert.equal(`${manifest.name}@${manifest.version}`, replacement);
  assert.equal(Object.hasOwn(manifest, 'gitHead'), false);
  assert.equal(manifest.main, manifest.module);
  assert.equal(manifest.exports['.'], `./${manifest.module}`);
  assert.equal(plugin.from, original);
  assert.equal(plugin.to, replacement);
  assert.equal(plugin.sourcePath, sourcePath);
  assert.equal(plugin.contract, 'native-global-util-independent-replacement');
  assert.equal(plugin.sourceStatus, 'independent-local-implementation');
  assert.deepEqual(plugin.sourceInputs.map(file => file.path), ['build.mjs', 'package.json', 'src/index.ts']);
  assert.deepEqual(plugin.buildOutputs.map(file => file.path), ['index.mjs', 'index.system.js']);
  for (const [entries, root] of [
    [plugin.sourceInputs, data.root], [plugin.buildOutputs, join(data.root, 'dist')],
  ]) {
    for (const entry of entries) {
      const bytes = fs.readFileSync(join(root, entry.path));
      assert.equal(entry.sha256, hash(bytes));
      assert.equal(entry.bytes, bytes.length);
    }
  }
  assert.equal(plugin.sourceFingerprint, fingerprint(plugin.sourceInputs).fingerprint);
  assert.equal(plugin.buildOutputFingerprint, fingerprint(plugin.buildOutputs).fingerprint);
  assert.equal(plugin.outputFingerprint, files.fingerprint);
  assert.equal(plugin.buildCommand, `node ${sourcePath}/build.mjs`);
  assert.equal(plugin.buildReceipt.path, `${sourcePath}/dist/build-receipt.json`);
  assert.equal(plugin.buildReceipt.sha256, hash(fs.readFileSync(data.receiptPath)));
  const receipt = JSON.parse(fs.readFileSync(data.receiptPath));
  assert.equal(plugin.buildReceipt.compilerChecks, receipt.compilerChecks);
  assert.deepEqual(plugin.buildReceipt.recordedToolchain, receipt.toolchain);
  assert.deepEqual(plugin.peerDependencies, manifest.peerDependencies);
  assert.deepEqual(plugin.runtimeImports, []);
  assert.equal(plugin.verificationScope, 'local-source-and-build-artifact-integrity-only');
  assert.equal(plugin.originalMigrationAcceptance, 'not-satisfied-by-independent-replacement');
  for (const flag of ['originalSourceRecovered', 'originalRepositoryAuthenticated',
    'nativeCompatibilityVerified', 'acceptedForProduction']) assert.equal(plugin[flag], false);
  assert.equal(plugin.compatibility, 'not-verified');
  assert.deepEqual(data.contract, contractBefore);
  assert.deepEqual(readGlobalUtilReplacement(data), { files, plugin });
  assert.deepEqual(snapshot(data.directory), before);
});

// Run actual loaders in an isolated process so their globals cannot leak between tests.
const loadModule = String.raw`
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
const [root, format, requirePath] = process.argv.slice(1);
// Initialize the actual Node loader before exposing the isolated DOM fixture.
const loader = format === 'systemjs' ? createRequire(requirePath)('systemjs').System : null;
const manifest = JSON.parse(fs.readFileSync(join(root, 'package.json')));
const listeners = new Map();
const document = {
  fullscreenElement: null,
  addEventListener(type, fn) {
    const values = listeners.get(type) ?? new Set();
    values.add(fn);
    listeners.set(type, values);
  },
  removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
};
document.defaultView = document;
const runtime = {
  openView: { push() {} }, hub: { getApp() {} }, fullscreenUtil: { original: true },
  appData: { fixture: true }, modelClipboard: { fixture: true }, log: { error() {} },
};
const originalSlots = { ...runtime };
globalThis.ibiz = runtime;
globalThis.document = document;
const entry = pathToFileURL(join(root, format === 'esm' ? manifest.module : manifest.system)).href;
const plugin = format === 'esm' ? await import(entry) :
  await loader.import(entry);
assert.deepEqual(Object.keys(plugin).sort(),
  ['GlobalAppUtil', 'ModelingFullscreenUtil', 'default', 'installGlobalAppUtil']);
assert.equal(typeof plugin.default.install, 'function');
const provides = [];
plugin.default.install({ provide: (...args) => provides.push(args) });
const instance = runtime.globalAppUtil;
assert.ok(instance instanceof plugin.GlobalAppUtil);
assert.equal(instance.sourceStatus, 'independent-local-implementation');
assert.ok(instance.fullscreen instanceof plugin.ModelingFullscreenUtil);
assert.equal(runtime.fullscreenUtil, instance.fullscreen);
assert.notEqual(runtime.fullscreenUtil, originalSlots.fullscreenUtil);
plugin.default.install({ provide: (...args) => provides.push(args) });
assert.deepEqual(provides, [['aibiz.globalAppUtil', instance], ['aibiz.globalAppUtil', instance]]);
for (const key of ['openView', 'hub', 'appData', 'modelClipboard']) {
  assert.equal(runtime[key], originalSlots[key]);
}
assert.equal(listeners.get('fullscreenchange').size, 1);
assert.equal(listeners.get('pagehide').size, 1);
assert.equal(await instance.dispose(), true);
assert.equal(runtime.fullscreenUtil, originalSlots.fullscreenUtil);
assert.equal(Object.hasOwn(runtime, 'globalAppUtil'), false);
assert.equal(listeners.get('fullscreenchange').size, 0);
assert.equal(listeners.get('pagehide').size, 0);
delete globalThis.ibiz;
assert.throws(() => plugin.default.install({ provide() {} }), /runtime must initialize/);
console.log(JSON.stringify({ format, exports: Object.keys(plugin).sort(), installedAndDisposed: true }));
`;

for (const format of ['esm', 'systemjs']) {
  test(`manifest ${format} entry loads and installs with the actual local loader`, t => {
    const data = fixture(t);
    const before = snapshot(data.directory);
    readGlobalUtilReplacement(data);
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', loadModule,
      data.root, format, join(workspaceRoot, 'modelingweb/app/package.json')],
    { encoding: 'utf8', timeout: 15000 });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
    assert.deepEqual(JSON.parse(result.stdout), {
      format, exports: ['GlobalAppUtil', 'ModelingFullscreenUtil', 'default', 'installGlobalAppUtil'],
      installedAndDisposed: true,
    });
    assert.deepEqual(snapshot(data.directory), before);
  });
}

for (const [section, paths, pattern] of [
  ['source', ['build.mjs', 'package.json', 'src/index.ts'], /source input hashes/],
  ['build', ['dist/index.mjs', 'dist/index.system.js'], /build output hashes/],
]) {
  for (const path of paths) {
    test(`rejects ${section} drift: ${path}`, t => {
      const data = fixture(t);
      fs.appendFileSync(join(data.root, path), '\n');
      const before = snapshot(data.directory);
      assert.throws(() => readGlobalUtilReplacement(data), pattern);
      assert.deepEqual(snapshot(data.directory), before);
    });
  }
}

for (const [name, mutate, pattern] of [
  ['original receipt identity', receipt => { receipt.package.name = '@ibiz-template-plugin/global-util-design'; },
    /receipt identity differs/],
  ['claimed original source recovery', receipt => { receipt.originalSourceRecovered = true; },
    /Original source recovery cannot be claimed/],
  ['claimed native compatibility', receipt => { receipt.nativeCompatibilityVerified = true; },
    /Native compatibility cannot be claimed/],
  ['authenticated source status', receipt => { receipt.sourceStatus = 'verified'; },
    /Independent source status required/],
  ['extra production acceptance flag', receipt => { receipt.acceptedForProduction = true; }, /receipt fields/],
  ['missing false source claim', receipt => { delete receipt.originalSourceRecovered; }, /receipt fields/],
  ['missing source inventory', receipt => { receipt.inputs.pop(); }, /source input hashes/],
  ['duplicate build output', receipt => { receipt.outputs.push(receipt.outputs[0]); }, /build output hashes/],
  ['expanded compiler claim', receipt => { receipt.compilerChecks = 'full application typecheck'; },
    /Compiler verification scope differs/],
  ['recorded external dependency', receipt => { receipt.runtimeImports = ['vue']; },
    /runtime imports must be empty/],
  ['unexpected toolchain version', receipt => { receipt.toolchain.rollup.version = 'next'; },
    /Toolchain version differs/],
]) {
  test(`rejects ${name}`, t => {
    const data = fixture(t);
    changeJson(data.receiptPath, mutate);
    assert.throws(() => readGlobalUtilReplacement(data), pattern);
  });
}

for (const [name, mutate] of [
  ['original identity', manifest => {
    manifest.name = '@ibiz-template-plugin/global-util-design';
    manifest.version = '0.0.3-alpha.87';
  }],
  ['gitHead provenance claim', manifest => { manifest.gitHead = 'invented'; }],
  ['escaping SystemJS entry', manifest => { manifest.system = '../outside.js'; }],
  ['runtime peer substitution', manifest => { manifest.peerDependencies['@ibiz-template/runtime'] = '*'; }],
]) {
  test(`rejects manifest ${name} even with a refreshed input hash`, t => {
    const data = fixture(t);
    changeJson(data.manifestPath, mutate);
    refreshHash(data, 'inputs', 'package.json');
    assert.throws(() => readGlobalUtilReplacement(data), /Exact independent global utility manifest differs/);
  });
}

for (const [name, path, mutate, pattern] of [
  ['static external import', 'index.mjs', text => `import 'vue';\n${text}`,
    /Global utilities must have no external imports/],
  ['dynamic ESM import', 'index.mjs', text => `${text}\nimport('vue');\n`, /Dynamic external loading rejected/],
  ['SystemJS dynamic import', 'index.system.js',
    text => text.replace("'use strict';", "'use strict'; System.import('vue');"),
    /Dynamic external loading rejected/],
  ['SystemJS dependency', 'index.system.js', text => text.replace('System.register([]', 'System.register(["vue"]'),
    /SystemJS dependencies must be empty/],
  ['named SystemJS registration', 'index.system.js',
    text => text.replace('System.register(', 'System.register("@aibiz/global-util", '),
    /anonymous System.register/],
  ['missing ESM plugin', 'index.mjs', text => text.replace('index as default', 'index as notDefault'),
    /ESM default plugin export is missing/],
  ['missing SystemJS plugin', 'index.system.js',
    text => text.replace('exports("default",', 'exports("not-default",'),
    /SystemJS default plugin export is missing/],
  ['malformed module', 'index.mjs', text => `${text}\n{\n`, /Invalid global utility JavaScript/],
]) {
  test(`rejects ${name} despite a refreshed output hash`, t => {
    const data = fixture(t);
    const target = join(data.root, 'dist', path);
    const before = fs.readFileSync(target, 'utf8');
    const after = mutate(before);
    assert.notEqual(after, before, 'Mutation must change the intended module contract');
    fs.writeFileSync(target, after);
    refreshHash(data, 'outputs', path);
    assert.throws(() => readGlobalUtilReplacement(data), pattern);
  });
}

test('rejects missing delivery and extra source files', t => {
  const data = fixture(t);
  const target = join(data.root, 'dist/index.system.js');
  const bytes = fs.readFileSync(target);
  fs.rmSync(target);
  assert.throws(() => readGlobalUtilReplacement(data), /Unexpected global utility source\/build file set/);
  fs.writeFileSync(target, bytes);
  fs.writeFileSync(join(data.root, 'src/extra.ts'), 'export {};\n');
  assert.throws(() => readGlobalUtilReplacement(data), /Unexpected global utility source\/build file set/);
});

for (const path of ['dist/index.system.js', 'modelingweb']) {
  test(`rejects linked delivery or ancestor: ${path}`, t => {
    const data = fixture(t);
    const target = path === 'modelingweb' ? join(data.workspace, path) : join(data.root, path);
    const outside = join(data.directory, 'outside');
    const directory = fs.lstatSync(target).isDirectory();
    fs.renameSync(target, outside);
    fs.symlinkSync(outside, target, directory ? 'dir' : 'file');
    const before = snapshot(data.directory);
    assert.throws(() => readGlobalUtilReplacement(data), /Symlink (resource|directory) rejected/);
    assert.deepEqual(snapshot(data.directory), before);
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
]) {
  test(`rejects ${name} without mutating native audit evidence`, t => {
    const data = fixture(t);
    mutate(data.contract);
    const before = structuredClone(data.contract);
    assert.throws(() => readGlobalUtilReplacement(data), pattern);
    assert.deepEqual(data.contract, before);
  });
}

test('requires a native contract and never promotes its unresolved original mapping', t => {
  const data = fixture(t);
  const mapping = data.contract.migrationMappings.find(item => item.from === original);
  assert.equal(mapping.build.status, 'missing-receipt');
  const before = structuredClone(mapping);
  assert.equal(readGlobalUtilReplacement(data).plugin.acceptedForProduction, false);
  assert.deepEqual(mapping, before);
  assert.throws(() => readGlobalUtilReplacement({ workspace: data.workspace }), /native migration contract/);
  const independentContract = { ...data.contract, contract: 'native-global-util-independent-replacement' };
  assert.throws(() => readGlobalUtilReplacement({ workspace: data.workspace, contract: independentContract }),
    /Expected native migration contract/);
});

test('CLI remains read-only, exits 2 for integrity-only and rejects an original-source claim', t => {
  const data = fixture(t);
  const contract = structuredClone(data.contract);
  contract.migrationMappings = contract.migrationMappings.filter(mapping => mapping.from === original);
  contract.plugins = contract.plugins.filter(plugin => plugin.repo === original);
  for (const app of Object.values(contract.evidence.applications)) {
    app.references = app.references.filter(reference => reference.repo === original);
  }
  json(data.contractPath, contract);
  const before = snapshot(data.directory);
  const result = spawnSync(process.execPath, [script, '--workspace', data.workspace],
    { encoding: 'utf8', timeout: 15000 });
  assert.equal(result.status, 2, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.plugin.acceptedForProduction, false);
  assert.equal(report.plugin.originalSourceRecovered, false);
  assert.equal(report.plugin.nativeCompatibilityVerified, false);
  assert.equal(report.plugin.compatibility, 'not-verified');
  assert.equal(report.files.entries.length, 3);
  assert.equal(Object.hasOwn(report.files, 'contents'), false);
  assert.deepEqual(snapshot(data.directory), before);
  const help = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /Read-only.*native acceptance remains unfinished/);
  changeJson(data.receiptPath, receipt => { receipt.originalSourceRecovered = true; });
  const mutated = snapshot(data.directory);
  const rejected = spawnSync(process.execPath, [script, '--workspace', data.workspace],
    { encoding: 'utf8', timeout: 15000 });
  assert.equal(rejected.status, 1);
  assert.equal(rejected.stdout, '');
  assert.match(rejected.stderr, /Original source recovery cannot be claimed/);
  assert.deepEqual(snapshot(data.directory), mutated);
});
