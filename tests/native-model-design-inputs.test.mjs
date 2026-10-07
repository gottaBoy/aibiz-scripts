import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  AUDITED_MODEL_DESIGN_SOURCE, main, MODEL_DESIGN_SOURCE,
  prepareNativeModelDesignBuildInputs, verifyNativeModelDesignBuildInputs,
} from '../prepare-native-model-design-inputs.mjs';
import {
  repairNativeModelResources, RESOURCE_INPUT, WORKSPACE,
} from '../repair-native-model-resources.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const tool = fileURLToPath(new URL('../prepare-native-model-design-inputs.mjs', import.meta.url));
const resourcePath = 'public/assets/json/runtime-model';
const openedPath = path => typeof path === 'number' ? fs.readlinkSync(`/proc/self/fd/${path}`) : path;
const blockers = [
  'complete-runtime-model-0.2.2-source-and-build-config-missing',
  'isolated-dependency-lock-and-install-missing',
  'runtime-model-loader-delivery-not-verified',
  'built-dist-and-es-resource-copy-not-verified',
  'local-typecheck-and-build-not-run',
  'native-version-compatibility-and-editor-save-reload-not-verified',
];

function tree(root) {
  const entries = [];
  function visit(directory, prefix = '') {
    assert.equal(fs.lstatSync(directory).isSymbolicLink(), false);
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      const info = fs.lstatSync(path);
      assert.equal(info.isSymbolicLink(), false);
      if (info.isDirectory()) visit(path, name);
      else {
        assert.equal(info.isFile(), true);
        const data = fs.readFileSync(path);
        entries.push({ path: name, bytes: data.length, sha256: hash(data) });
      }
    }
  }
  visit(root);
  entries.sort((a, b) => a.path.localeCompare(b.path));
  return {
    entries, files: entries.length,
    bytes: entries.reduce((sum, entry) => sum + entry.bytes, 0),
    fingerprintKind: 'relative-file-set',
    fingerprint: hash(JSON.stringify(entries)),
  };
}

function write(path, data) {
  fs.mkdirSync(dirname(path), { recursive: true });
  fs.writeFileSync(path, data);
}

function fixture(t) {
  const root = join(WORKSPACE, '.artifacts/native-resource-repair');
  fs.mkdirSync(root, { recursive: true });
  const workspace = fs.mkdtempSync(join(root, 'test-model-design-inputs-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const source = join(workspace, 'published-model-design');
  const manifest = {
    name: '@ibiz-template-plugin/model-design', version: '0.0.3-alpha.122',
    license: 'MIT', gitHead: 'a'.repeat(40),
    scripts: {
      typecheck: 'vue-tsc --noEmit',
      build: 'ibiz-temp build -c && vue-tsc --declaration --emitDeclarationOnly',
    },
    dependencies: {
      '@ibiz-template-plugin/runtime-model': '0.2.2',
      '@ibiz-template/core': '0.7.41-alpha.28',
      '@ibiz-template/runtime': '0.7.41-alpha.31',
      '@ibiz/model-core': '^0.1.58',
    },
    peerDependencies: { '@ibiz-template/runtime': '^0.7.0' },
    devDependencies: {
      '@ibiz-template/cli': '0.3.30', typescript: '~5.2.2', 'vue-tsc': '~1.8.19',
    },
  };
  write(join(source, 'package.json'), `${JSON.stringify(manifest, null, 2)}\n`);
  write(join(source, 'ibiz.config.cjs'), 'module.exports = { external: () => true };\n');
  write(join(source, 'tsconfig.json'), '{"include":["src/**/*.ts","src/**/*.tsx"]}\n');
  write(join(source, 'CHANGELOG.md'), '# Published source fixture\n');
  write(join(source, 'src/index.ts'),
    'import { defineCustomElements } from "@ibiz-template-plugin/runtime-model/loader";\n' +
    'export const install = () => defineCustomElements();\n');
  write(join(source, 'src/components/panel.tsx'), 'export const panel = () => <div />;\n');
  write(join(source, 'src/types.d.ts'), 'declare const fixtureValue: string;\n');
  const sourceTree = tree(join(source, 'src'));
  const inputTree = tree(source);
  const expectedSource = {
    files: sourceTree.files, implementationFiles: 2,
    fingerprint: sourceTree.fingerprint,
    manifestSha256: hash(fs.readFileSync(join(source, 'package.json'))),
    inputFiles: inputTree.files,
    inputFingerprint: inputTree.fingerprint,
  };
  const input = join(workspace, 'original-resources');
  write(join(input, 'valid.json'), '{\n"value":"literal \\\\n"\n}\n');
  write(join(input, 'nested/broken.json'), '{"value":"a\nb"}\n');
  const expectedResources = {
    files: 2, changedFiles: 1, unchangedFiles: 1, escapedLf: 1,
    inputFingerprint: tree(input).fingerprint,
  };
  const repairOutput = join(workspace, '.artifacts/native-resource-repair/repaired');
  repairNativeModelResources({ workspace, input, output: repairOutput, expected: expectedResources });
  return {
    workspace, source, input, expectedSource, expectedResources,
    repairReceipt: join(repairOutput, 'receipt.json'),
    output: join(workspace, '.artifacts/native-model-design-inputs/candidate'),
  };
}

function evidence(options) {
  return {
    source: tree(options.source),
    input: tree(options.input),
    repair: tree(dirname(options.repairReceipt)),
  };
}

function verify(options) {
  return verifyNativeModelDesignBuildInputs({
    ...options, receipt: join(options.output, 'receipt.json'),
  });
}

function editJson(path, edit) {
  const value = JSON.parse(fs.readFileSync(path, 'utf8'));
  edit(value);
  fs.writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function assertBlocked(receipt) {
  assert.equal(receipt.buildReady, false);
  assert.equal(receipt.acceptedForProduction, false);
  assert.equal(receipt.runtimeModelSourceRecovered, false);
  assert.deepEqual(receipt.mapping, {
    requested: '@ibiz-template-plugin/model-design@0.0.3-alpha.90',
    candidate: '@ibiz-template-plugin/model-design@0.0.3-alpha.122',
    compatibility: 'not-verified',
  });
  assert.deepEqual(receipt.blockers, blockers);
  assert.equal(receipt.dependencies.resolved, false);
  assert.equal(receipt.dependencies.installed, false);
  assert.equal(receipt.dependencies.lockfile, null);
  assert.equal(receipt.commands.typecheck.status, 'not-run');
  assert.equal(receipt.commands.build.status, 'not-run');
}

test('default source identity and audit pin the recorded published snapshot', () => {
  assert.equal(MODEL_DESIGN_SOURCE,
    'vendor-upstream/gottaboy-plm-web/plugin-src/@ibiz-template-plugin/model-design@0.0.3-alpha.122');
  assert.deepEqual(AUDITED_MODEL_DESIGN_SOURCE, {
    files: 68, implementationFiles: 55,
    fingerprint: '18ed657dc47ce9aeea380581207c7e847a30c8e494cd52d5891e0a37f0134a9c',
    manifestSha256: 'e1c4407a548d50c7cdce33d7663947724fe445c965f34d7ed714b22b254baff7',
    inputFiles: 72,
    inputFingerprint: 'a2eff77ed8cdefebfa24636620baa77b8e067458d92033edb0492465ca21ed06',
  });
  assert.equal(Object.isFrozen(AUDITED_MODEL_DESIGN_SOURCE), true);
});

test('staging preserves published source/config bytes and adds only verified public/assets resources', t => {
  const options = fixture(t);
  const before = evidence(options);
  const receipt = prepareNativeModelDesignBuildInputs(options);
  const packageRoot = join(options.output, 'package');
  assert.equal(receipt.schemaVersion, 1);
  assert.equal(receipt.contract, 'native-model-design-isolated-build-inputs');
  assert.equal(receipt.status, 'prepared-build-blocked');
  assertBlocked(receipt);
  assert.ok(Number.isFinite(Date.parse(receipt.generatedAt)));
  assert.deepEqual(JSON.parse(fs.readFileSync(join(options.output, 'receipt.json'), 'utf8')), receipt);
  assert.deepEqual(receipt.source.entries, before.source.entries);
  assert.deepEqual(receipt.source.audit, options.expectedSource);
  assert.equal(receipt.source.audit.inputFiles, before.source.files);
  assert.equal(receipt.source.audit.inputFingerprint, before.source.fingerprint);
  assert.equal(receipt.source.package, '@ibiz-template-plugin/model-design');
  assert.equal(receipt.source.version, '0.0.3-alpha.122');
  assert.equal(receipt.source.packageGitHead, 'a'.repeat(40));
  assert.equal(receipt.source.fingerprint, before.source.fingerprint);
  assert.equal(receipt.resources.packagePath, resourcePath);
  assert.equal(receipt.resources.repairReceiptSha256, hash(fs.readFileSync(options.repairReceipt)));
  assert.equal(receipt.resources.status, 'verified-resource-candidate-not-accepted');
  const resources = join(dirname(options.repairReceipt), 'resources');
  for (const entry of before.source.entries) {
    assert.deepEqual(fs.readFileSync(join(packageRoot, entry.path)),
      fs.readFileSync(join(options.source, entry.path)));
  }
  for (const entry of tree(resources).entries) {
    const staged = fs.readFileSync(join(packageRoot, resourcePath, entry.path));
    assert.deepEqual(staged, fs.readFileSync(join(resources, entry.path)));
    assert.doesNotThrow(() => JSON.parse(staged));
  }
  const staged = tree(packageRoot);
  assert.deepEqual(receipt.package.entries, staged.entries);
  assert.equal(receipt.package.fingerprint, staged.fingerprint);
  assert.equal(receipt.package.bytes, staged.bytes);
  assert.equal(receipt.package.files, before.source.files + options.expectedResources.files);
  assert.equal(receipt.package.path, '.artifacts/native-model-design-inputs/candidate/package');
  for (const path of ['dist', 'es', 'node_modules', 'pnpm-lock.yaml']) {
    assert.equal(fs.existsSync(join(packageRoot, path)), false);
  }
  assert.equal(fs.existsSync(join(options.source, 'public')), false);
  assert.equal(fs.existsSync(join(packageRoot, 'src/assets/json/runtime-model')), false);
  assert.equal(fs.existsSync(join(options.output, '.receipt.tmp')), false);
  assert.deepEqual(evidence(options), before);
});

test('declared dependency/toolchain versions are retained, not treated as installed resolutions', t => {
  const options = fixture(t);
  const manifest = JSON.parse(fs.readFileSync(join(options.source, 'package.json'), 'utf8'));
  const receipt = prepareNativeModelDesignBuildInputs(options);
  assert.deepEqual(receipt.dependencies.declared, manifest.dependencies);
  assert.deepEqual(receipt.dependencies.declaredPeers, manifest.peerDependencies);
  assert.deepEqual(receipt.dependencies.declaredToolchain, manifest.devDependencies);
  assert.equal(receipt.dependencies.declared['@ibiz-template-plugin/runtime-model'], '0.2.2');
  assert.equal(receipt.dependencies.declaredToolchain['@ibiz-template/cli'], '0.3.30');
  assert.equal(receipt.dependencies.declaredToolchain.typescript, '~5.2.2');
  assert.equal(receipt.dependencies.declaredToolchain['vue-tsc'], '~1.8.19');
  assert.equal(receipt.commands.typecheck.command, manifest.scripts.typecheck);
  assert.equal(receipt.commands.build.command, manifest.scripts.build);
  assertBlocked(receipt);
});

test('verification is read-only and proves input integrity without build or runtime acceptance', t => {
  const options = fixture(t);
  const receipt = prepareNativeModelDesignBuildInputs(options);
  const before = { evidence: evidence(options), candidate: tree(options.output) };
  const verified = verify(options);
  assert.equal(verified.status, 'verified-inputs-build-blocked');
  assert.equal(verified.inputIntegrityVerified, true);
  assertBlocked(verified);
  assert.deepEqual(verified.package, receipt.package);
  verified.blockers.length = 0;
  receipt.source.entries.length = 0;
  assertBlocked(verify(options));
  assert.deepEqual({ evidence: evidence(options), candidate: tree(options.output) }, before);
});

test('default outputs are unique and leave existing candidate evidence intact', t => {
  const options = fixture(t);
  delete options.output;
  const first = prepareNativeModelDesignBuildInputs(options);
  const firstRoot = join(options.workspace, dirname(first.package.path));
  const before = tree(firstRoot);
  const second = prepareNativeModelDesignBuildInputs(options);
  assert.notEqual(first.package.path, second.package.path);
  assert.match(second.package.path, /^\.artifacts\/native-model-design-inputs\/inputs-[^/]+\/package$/);
  assert.deepEqual(tree(firstRoot), before);
});

for (const [name, edit, error] of [
  ['package name', value => { value.name = '@other/model-design'; }, /Unexpected source package identity/],
  ['package version', value => { value.version = '0.0.3-alpha.90'; }, /Unexpected source package version/],
  ['runtime version', value => { value.dependencies['@ibiz-template-plugin/runtime-model'] = '0.2.3'; },
    /Runtime-model dependency changed/],
  ['runtime dependency', value => { delete value.dependencies['@ibiz-template-plugin/runtime-model']; },
    /Runtime-model dependency changed/],
  ['typecheck command', value => { delete value.scripts.typecheck; }, /Missing declared typecheck command/],
  ['build command', value => { delete value.scripts.build; }, /Missing declared build command/],
]) {
  test(`changed ${name} fails closed without staging or rewriting evidence`, t => {
    const options = fixture(t);
    editJson(join(options.source, 'package.json'), edit);
    options.expectedSource.manifestSha256 = hash(fs.readFileSync(join(options.source, 'package.json')));
    options.expectedSource.inputFingerprint = tree(options.source).fingerprint;
    const before = evidence(options);
    assert.throws(() => prepareNativeModelDesignBuildInputs(options), error);
    assert.equal(fs.existsSync(options.output), false);
    assert.deepEqual(evidence(options), before);
  });
}

for (const name of [
  'files', 'implementationFiles', 'fingerprint', 'manifestSha256', 'inputFiles', 'inputFingerprint',
]) {
  test(`incorrect expected source ${name} is rejected before staging`, t => {
    const options = fixture(t);
    options.expectedSource[name] = typeof options.expectedSource[name] === 'number'
      ? options.expectedSource[name] + 1 : '0'.repeat(64);
    const before = evidence(options);
    assert.throws(() => prepareNativeModelDesignBuildInputs(options), /Published source audit mismatch/);
    assert.equal(fs.existsSync(options.output), false);
    assert.deepEqual(evidence(options), before);
  });
}

for (const [name, bytes] of [
  ['ibiz.config.cjs', 'module.exports = { external: () => false };\n'],
  ['tsconfig.json', '{"include":["src/index.ts"]}\n'],
]) {
  test(`${name} drift before generation fails the full source/config audit without staging`, t => {
    const options = fixture(t);
    const expectedBefore = structuredClone(options.expectedSource);
    fs.writeFileSync(join(options.source, name), bytes);
    const before = evidence(options);
    const descriptors = fs.readdirSync('/proc/self/fd').length;
    assert.throws(() => prepareNativeModelDesignBuildInputs(options), /Published source audit mismatch/);
    assert.equal(fs.existsSync(options.output), false);
    assert.equal(fs.existsSync(dirname(options.output)), false);
    assert.deepEqual(options.expectedSource, expectedBefore);
    assert.deepEqual(evidence(options), before);
    assert.equal(fs.readdirSync('/proc/self/fd').length, descriptors);
  });
}

for (const name of ['package.json', 'ibiz.config.cjs', 'tsconfig.json', 'src/index.ts']) {
  test(`missing required source ${name} is rejected`, t => {
    const options = fixture(t);
    fs.unlinkSync(join(options.source, name));
    const before = evidence(options);
    assert.throws(() => prepareNativeModelDesignBuildInputs(options), /Missing source input/);
    assert.equal(fs.existsSync(options.output), false);
    assert.deepEqual(evidence(options), before);
  });
}

for (const name of [
  'dist/index.system.min.js', 'es/index.mjs', 'node_modules/compiled.mjs',
  'pnpm-lock.yaml', '.artifacts/build-receipt.json', 'record-build.mjs',
]) {
  test(`unexpected published input ${name} is not accepted as original source`, t => {
    const options = fixture(t);
    write(join(options.source, name), 'not authenticated source\n');
    const before = evidence(options);
    assert.throws(() => prepareNativeModelDesignBuildInputs(options), /Unexpected source input/);
    assert.equal(fs.existsSync(options.output), false);
    assert.deepEqual(evidence(options), before);
  });
}

test('published source cannot contain candidate-only public runtime resources', t => {
  const options = fixture(t);
  write(join(options.source, resourcePath, 'valid.json'), '{"unexpected":true}');
  const before = evidence(options);
  assert.throws(() => prepareNativeModelDesignBuildInputs(options),
    /Unexpected source input: public\/assets\/json\/runtime-model\/valid.json/);
  assert.equal(fs.existsSync(options.output), false);
  assert.deepEqual(evidence(options), before);
});

for (const kind of ['directory', 'file', 'symlink', 'dangling symlink']) {
  test(`existing output ${kind} is never overwritten or cleaned up`, t => {
    const options = fixture(t);
    fs.mkdirSync(dirname(options.output), { recursive: true });
    if (kind === 'directory') write(join(options.output, 'sentinel'), 'keep');
    else if (kind === 'file') fs.writeFileSync(options.output, 'keep');
    else fs.symlinkSync(kind === 'symlink' ? options.source : join(options.workspace, 'absent'),
      options.output);
    const before = evidence(options);
    assert.throws(() => prepareNativeModelDesignBuildInputs(options), /must not be overwritten/);
    if (kind === 'directory') assert.deepEqual(fs.readdirSync(options.output), ['sentinel']);
    if (kind === 'directory' || kind === 'file') {
      assert.equal(fs.readFileSync(kind === 'file' ? options.output : join(options.output, 'sentinel'),
        'utf8'), 'keep');
    } else assert.equal(fs.lstatSync(options.output).isSymbolicLink(), true);
    assert.deepEqual(evidence(options), before);
  });
}

test('output escapes, artifact root and nested destinations are rejected without writes', t => {
  const options = fixture(t);
  const before = evidence(options);
  for (const output of [
    options.source, options.workspace, dirname(options.output),
    join(options.output, 'nested'), join(options.workspace, '..', 'outside'),
  ]) {
    assert.throws(() => prepareNativeModelDesignBuildInputs({ ...options, output }),
      /Output must be a direct child/);
  }
  assert.equal(fs.existsSync(dirname(options.output)), false);
  assert.deepEqual(evidence(options), before);
});

test('source outside the workspace is rejected without opening it or staging', t => {
  const options = fixture(t);
  assert.throws(() => prepareNativeModelDesignBuildInputs({
    ...options, source: join(options.workspace, '..', 'outside'),
  }), /Source must be a child/);
  assert.equal(fs.existsSync(options.output), false);
});

test('resource input encompassing the build-output root is rejected before any filesystem write', t => {
  const options = fixture(t);
  const input = dirname(options.output);
  fs.renameSync(options.input, input);
  const repairOutput = join(options.workspace, '.artifacts/native-resource-repair/overlap-evidence');
  repairNativeModelResources({
    workspace: options.workspace, input, output: repairOutput, expected: options.expectedResources,
  });
  options.input = input;
  options.repairReceipt = join(repairOutput, 'receipt.json');
  const before = evidence(options);
  const mutations = [];
  for (const method of [
    'mkdirSync', 'writeFileSync', 'linkSync', 'unlinkSync', 'rmdirSync', 'rmSync', 'renameSync',
  ]) {
    t.mock.method(fs, method, (...args) => {
      mutations.push({ method, path: args[0] });
      throw new Error('Unexpected preflight write');
    });
  }
  const open = fs.openSync;
  t.mock.method(fs, 'openSync', (path, flags, ...args) => {
    if (flags & (fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_WRONLY |
      fs.constants.O_RDWR)) {
      mutations.push({ method: 'openSync', path });
      throw new Error('Unexpected preflight write');
    }
    return open(path, flags, ...args);
  });
  try {
    assert.throws(() => prepareNativeModelDesignBuildInputs(options), /[Ii]nput.*overlap|[Rr]esource.*overlap/);
    assert.deepEqual(mutations, []);
  } finally { t.mock.reset(); }
  assert.equal(fs.existsSync(options.output), false);
  assert.deepEqual(evidence(options), before);
});

for (const field of ['source', 'input', 'repairReceipt']) {
  for (const location of ['equal', 'ancestor', 'descendant']) {
    test(`${field} ${location} to output ROOT is rejected in preflight with zero writes`, t => {
      const options = fixture(t);
      const before = evidence(options);
      const root = dirname(options.output);
      const path = {
        equal: root, ancestor: dirname(root), descendant: join(root, 'uncreated-input'),
      }[location];
      const mutations = [];
      for (const method of [
        'mkdirSync', 'writeFileSync', 'linkSync', 'unlinkSync', 'rmdirSync', 'rmSync', 'renameSync',
      ]) {
        t.mock.method(fs, method, (...args) => {
          mutations.push({ method, path: args[0] });
          throw new Error('Unexpected preflight write');
        });
      }
      const open = fs.openSync;
      t.mock.method(fs, 'openSync', (path, flags, ...args) => {
        if (flags & (fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_WRONLY |
          fs.constants.O_RDWR)) {
          mutations.push({ method: 'openSync', path });
          throw new Error('Unexpected preflight write');
        }
        return open(path, flags, ...args);
      });
      try {
        assert.throws(() => prepareNativeModelDesignBuildInputs({ ...options, [field]: path }),
          /must not overlap/);
        assert.deepEqual(mutations, []);
      } finally { t.mock.reset(); }
      assert.equal(fs.existsSync(options.output), false);
      assert.equal(fs.existsSync(root), false);
      assert.deepEqual(evidence(options), before);
    });
  }
}

for (const kind of ['root', 'ancestor', 'file', 'directory']) {
  test(`symlinked source ${kind} is rejected without following it`, t => {
    const options = fixture(t);
    if (kind === 'root' || kind === 'ancestor') {
      const link = join(options.workspace, 'linked');
      fs.symlinkSync(kind === 'root' ? options.source : options.workspace, link);
      options.source = kind === 'root' ? link : join(link, 'published-model-design');
    } else {
      const target = kind === 'file' ? join(options.source, 'src/index.ts') : join(options.source, 'src');
      const moved = join(options.workspace, 'moved-source');
      fs.renameSync(target, moved);
      fs.symlinkSync(moved, target);
    }
    const repairBefore = tree(dirname(options.repairReceipt));
    assert.throws(() => prepareNativeModelDesignBuildInputs(options), /Symlink/);
    assert.equal(fs.existsSync(options.output), false);
    assert.deepEqual(tree(dirname(options.repairReceipt)), repairBefore);
  });
}

test('symlinked output ancestor receives zero external writes', t => {
  const options = fixture(t);
  const external = join(options.workspace, 'external');
  write(join(external, 'sentinel'), 'keep');
  fs.symlinkSync(external, dirname(options.output));
  const before = evidence(options);
  assert.throws(() => prepareNativeModelDesignBuildInputs(options), /Symlink directory rejected/);
  assert.deepEqual(fs.readdirSync(external), ['sentinel']);
  assert.equal(fs.readFileSync(join(external, 'sentinel'), 'utf8'), 'keep');
  assert.deepEqual(evidence(options), before);
});

for (const name of ['receipt.json', 'resources', 'resources/valid.json']) {
  test(`symlinked repair ${name} is rejected instead of imported`, t => {
    const options = fixture(t);
    const target = join(dirname(options.repairReceipt), name);
    const moved = join(options.workspace, 'moved-repair');
    fs.renameSync(target, moved);
    fs.symlinkSync(moved, target);
    assert.throws(() => prepareNativeModelDesignBuildInputs(options), /Symlink/);
    assert.equal(fs.existsSync(options.output), false);
    assert.equal(fs.lstatSync(target).isSymbolicLink(), true);
  });
}

const staleInputs = [
  ['published source', options => join(options.source, 'src/index.ts'),
    'export const changed = true;\n', /Published source audit mismatch/],
  ['source config', options => join(options.source, 'ibiz.config.cjs'),
    'module.exports = { changed: true };\n', /Published source audit mismatch/],
  ['original resources', options => join(options.input, 'valid.json'),
    '{"changed":"original"}', /Input fingerprint mismatch/],
  ['repaired resources', options => join(dirname(options.repairReceipt), 'resources/valid.json'),
    '{"changed":"repaired"}', /Current repaired resources differ/],
  ['staged source', options => join(options.output, 'package/src/index.ts'),
    'export const changed = true;\n', /Staged package differs/],
  ['staged resources', options => join(options.output, 'package', resourcePath, 'valid.json'),
    '{"changed":"staged"}', /Staged package differs/],
];
for (const [name, path, bytes, error] of staleInputs) {
  test(`verification rejects stale ${name} without rewriting any evidence`, t => {
    const options = fixture(t);
    prepareNativeModelDesignBuildInputs(options);
    fs.writeFileSync(path(options), bytes);
    const before = { evidence: evidence(options), candidate: tree(options.output) };
    assert.throws(() => verify(options), error);
    assert.deepEqual({ evidence: evidence(options), candidate: tree(options.output) }, before);
  });
}

test('repair receipt hash is bound even when changed metadata preserves resource validity', t => {
  const options = fixture(t);
  prepareNativeModelDesignBuildInputs(options);
  editJson(options.repairReceipt, value => { value.generatedAt = '2000-01-01T00:00:00.000Z'; });
  const before = { evidence: evidence(options), candidate: tree(options.output) };
  assert.throws(() => verify(options), /Build-input receipt differs/);
  assert.deepEqual({ evidence: evidence(options), candidate: tree(options.output) }, before);
});

test('invalid repair evidence fails before a build-input candidate is created', t => {
  const options = fixture(t);
  editJson(options.repairReceipt, value => { value.files[0].repairedSha256 = '0'.repeat(64); });
  const before = evidence(options);
  assert.throws(() => prepareNativeModelDesignBuildInputs(options), /Receipt per-file evidence differs/);
  assert.equal(fs.existsSync(options.output), false);
  assert.deepEqual(evidence(options), before);
});

for (const [name, edit] of [
  ['schema', value => { value.schemaVersion = 2; }],
  ['contract', value => { value.contract = 'source-complete'; }],
  ['status', value => { value.status = 'accepted'; }],
  ['build readiness', value => { value.buildReady = true; }],
  ['production acceptance', value => { value.acceptedForProduction = true; }],
  ['runtime source recovery', value => { value.runtimeModelSourceRecovered = true; }],
  ['requested mapping', value => { value.mapping.requested = value.mapping.candidate; }],
  ['candidate mapping', value => { value.mapping.candidate = value.mapping.requested; }],
  ['mapping compatibility', value => { value.mapping.compatibility = 'verified'; }],
  ['source hash', value => { value.source.fingerprint = '0'.repeat(64); }],
  ['complete source/config file count', value => { value.source.audit.inputFiles++; }],
  ['complete source/config fingerprint', value => { value.source.audit.inputFingerprint = '0'.repeat(64); }],
  ['legacy source audit', value => {
    delete value.source.audit.inputFiles;
    delete value.source.audit.inputFingerprint;
  }],
  ['dependency versions', value => { value.dependencies.declared['@ibiz-template/runtime'] = 'latest'; }],
  ['resolved dependencies', value => { value.dependencies.resolved = true; }],
  ['installed dependencies', value => { value.dependencies.installed = true; }],
  ['lockfile', value => { value.dependencies.lockfile = 'pnpm-lock.yaml'; }],
  ['build result', value => { value.commands.build.status = 'passed'; }],
  ['package path', value => { value.package.path = '../outside'; }],
  ['package hash', value => { value.package.fingerprint = '0'.repeat(64); }],
  ['missing file', value => { value.package.entries.pop(); }],
  ['duplicate file', value => { value.package.entries.push(value.package.entries[0]); }],
  ['blockers', value => { value.blockers = []; }],
  ['unknown evidence', value => { value.sourceVerified = true; }],
]) {
  test(`verification rejects altered ${name} receipt without mutating files`, t => {
    const options = fixture(t);
    prepareNativeModelDesignBuildInputs(options);
    editJson(join(options.output, 'receipt.json'), edit);
    const before = { evidence: evidence(options), candidate: tree(options.output) };
    assert.throws(() => verify(options), /Build-input receipt differs/);
    assert.deepEqual({ evidence: evidence(options), candidate: tree(options.output) }, before);
  });
}

test('invalid generation time and malformed receipt JSON fail closed', t => {
  const options = fixture(t);
  prepareNativeModelDesignBuildInputs(options);
  const receipt = join(options.output, 'receipt.json');
  editJson(receipt, value => { value.generatedAt = 'not a date'; });
  assert.throws(() => verify(options), /Invalid build-input generation time/);
  fs.writeFileSync(receipt, '{"truncated":');
  const before = fs.readFileSync(receipt);
  assert.throws(() => verify(options), SyntaxError);
  assert.deepEqual(fs.readFileSync(receipt), before);
});

for (const name of ['dist/index.system.min.js', 'es/index.mjs', 'node_modules/compiled.mjs', 'pnpm-lock.yaml']) {
  test(`unexpected staged ${name} cannot turn input staging into build acceptance`, t => {
    const options = fixture(t);
    prepareNativeModelDesignBuildInputs(options);
    write(join(options.output, 'package', name), 'unverified output');
    const before = tree(options.output);
    assert.throws(() => verify(options), /Staged package differs/);
    assert.deepEqual(tree(options.output), before);
  });
}

for (const name of ['receipt.json', 'package', `package/${resourcePath}`]) {
  test(`verification rejects symlinked candidate ${name} without following it`, t => {
    const options = fixture(t);
    prepareNativeModelDesignBuildInputs(options);
    const target = join(options.output, name);
    const moved = join(options.workspace, 'moved-candidate-part');
    fs.renameSync(target, moved);
    fs.symlinkSync(moved, target);
    const before = fs.lstatSync(moved).isDirectory() ? tree(moved) : fs.readFileSync(moved);
    assert.throws(() => verify(options), /Symlink/);
    assert.equal(fs.lstatSync(target).isSymbolicLink(), true);
    assert.deepEqual(fs.lstatSync(moved).isDirectory() ? tree(moved) : fs.readFileSync(moved), before);
  });
}

test('missing receipts, path escapes and partial candidates are rejected', t => {
  const options = fixture(t);
  prepareNativeModelDesignBuildInputs(options);
  assert.throws(() => verifyNativeModelDesignBuildInputs(options), /receipt path is required/);
  for (const receipt of [
    join(options.workspace, 'receipt.json'),
    join(options.output, 'wrong.json'),
    join(options.output, 'nested/receipt.json'),
    join(dirname(options.output), 'absent/receipt.json'),
  ]) {
    assert.throws(() => verifyNativeModelDesignBuildInputs({ ...options, receipt }),
      /Output must be a direct child|Expected a candidate|Missing directory/);
  }
  write(join(options.output, '.receipt.tmp'), 'partial');
  const before = tree(options.output);
  assert.throws(() => verify(options), /Unexpected build-input candidate files/);
  assert.deepEqual(tree(options.output), before);
});

for (const phase of ['resource write', 'receipt open', 'receipt write']) {
  test(`failure during ${phase} retains its candidate, rejects partial evidence and closes descriptors`, t => {
    const options = fixture(t);
    const before = evidence(options);
    const descriptors = fs.readdirSync('/proc/self/fd').length;
    let injected = false;
    if (phase === 'resource write') {
      const original = fs.writeFileSync;
      t.mock.method(fs, 'writeFileSync', (path, ...args) => {
        if (!injected && openedPath(path).includes(`/package/${resourcePath}/`)) {
          injected = true;
          throw new Error('Injected staging failure');
        }
        return original(path, ...args);
      });
    } else if (phase === 'receipt open') {
      const original = fs.openSync;
      t.mock.method(fs, 'openSync', (path, flags, ...args) => {
        if (!injected && (flags & fs.constants.O_CREAT) && path.endsWith('/receipt.json')) {
          injected = true;
          throw new Error('Injected staging failure');
        }
        return original(path, flags, ...args);
      });
    } else {
      const original = fs.writeFileSync;
      t.mock.method(fs, 'writeFileSync', (path, data, ...args) => {
        if (!injected && openedPath(path) === join(options.output, 'receipt.json')) {
          injected = true;
          original(path, '{"truncated":', ...args);
          throw new Error('Injected staging failure');
        }
        return original(path, data, ...args);
      });
    }
    assert.throws(() => prepareNativeModelDesignBuildInputs(options), /Injected staging failure/);
    assert.equal(injected, true);
    assert.equal(fs.existsSync(options.output), true);
    if (phase === 'receipt write') {
      assert.equal(fs.readFileSync(join(options.output, 'receipt.json'), 'utf8'), '{"truncated":');
      assert.throws(() => verify(options), SyntaxError);
    } else {
      assert.equal(fs.existsSync(join(options.output, 'receipt.json')), false);
      assert.throws(() => verify(options), /ENOENT/);
    }
    assert.deepEqual(evidence(options), before);
    assert.equal(fs.readdirSync('/proc/self/fd').length, descriptors);
  });
}

test('copy drift retains failed bytes without publishing an acceptable build-input receipt', t => {
  const options = fixture(t);
  const before = evidence(options);
  const original = fs.writeFileSync;
  let injected = false;
  t.mock.method(fs, 'writeFileSync', (path, data, ...args) => {
    if (!injected && openedPath(path).endsWith('/package/src/index.ts')) {
      injected = true;
      return original(path, 'export const corrupted = true;\n', ...args);
    }
    return original(path, data, ...args);
  });
  assert.throws(() => prepareNativeModelDesignBuildInputs(options), /Staged package differs/);
  assert.equal(injected, true);
  assert.equal(fs.existsSync(options.output), true);
  assert.equal(fs.existsSync(join(options.output, 'receipt.json')), false);
  assert.throws(() => verify(options), /ENOENT/);
  assert.deepEqual(evidence(options), before);
});

for (const changed of ['source', 'resources', 'repair receipt', 'staged package', 'published receipt']) {
  test(`${changed} drift during receipt write fails closed and preserves the failed candidate`, t => {
    const options = fixture(t);
    const sourceBefore = tree(options.source);
    const repairBefore = tree(dirname(options.repairReceipt));
    const original = fs.writeFileSync;
    let injected = false;
    t.mock.method(fs, 'writeFileSync', (path, data, ...args) => {
      const target = openedPath(path);
      original(path, data, ...args);
      if (injected || target !== join(options.output, 'receipt.json')) return;
      injected = true;
      if (changed === 'source') fs.writeFileSync(join(options.source, 'src/index.ts'), 'changed source');
      else if (changed === 'resources') {
        fs.writeFileSync(join(dirname(options.repairReceipt), 'resources/valid.json'), '{"changed":true}');
      } else if (changed === 'repair receipt') {
        editJson(options.repairReceipt, value => { value.generatedAt = '2000-01-01T00:00:00.000Z'; });
      } else if (changed === 'staged package') {
        fs.writeFileSync(join(options.output, 'package/src/index.ts'), 'changed staged source');
      } else original(target, '{"changed":"published receipt"}');
    });
    assert.throws(() => prepareNativeModelDesignBuildInputs(options),
      /Published source audit mismatch|Current repaired resources differ|Build inputs changed|Staged package differs|Published build-input receipt changed/);
    assert.equal(injected, true);
    assert.equal(fs.existsSync(options.output), true);
    const verificationError = changed === 'published receipt' ? /Invalid build-input generation time/
      : /Published source audit mismatch|Current repaired resources differ|Build-input receipt differs|Staged package differs/;
    assert.throws(() => verify(options), verificationError);
    if (changed !== 'source') assert.deepEqual(tree(options.source), sourceBefore);
    if (!['resources', 'repair receipt'].includes(changed)) {
      assert.deepEqual(tree(dirname(options.repairReceipt)), repairBefore);
    }
  });
}

for (const name of ['candidate', 'package', 'resource directory']) {
  test(`${name} replacement before a file open cannot redirect writes to a symlink target`, t => {
    const options = fixture(t);
    const before = evidence(options);
    const external = join(options.workspace, 'external');
    write(join(external, 'sentinel'), 'keep');
    const replaced = {
      candidate: options.output,
      package: join(options.output, 'package'),
      'resource directory': join(options.output, 'package', resourcePath),
    }[name];
    const moved = join(options.workspace, 'moved-owned-directory');
    const original = fs.openSync;
    let injected = false;
    t.mock.method(fs, 'openSync', (path, flags, ...args) => {
      if (!injected && (flags & fs.constants.O_CREAT) &&
        (name !== 'resource directory' || path.endsWith('/valid.json'))) {
        injected = true;
        fs.renameSync(replaced, moved);
        fs.symlinkSync(external, replaced);
      }
      return original(path, flags, ...args);
    });
    assert.throws(() => prepareNativeModelDesignBuildInputs(options), /Directory changed/);
    assert.equal(injected, true);
    assert.deepEqual(fs.readdirSync(external), ['sentinel']);
    assert.equal(fs.readFileSync(join(external, 'sentinel'), 'utf8'), 'keep');
    assert.equal(fs.existsSync(join(options.output, 'receipt.json')), false);
    assert.deepEqual(evidence(options), before);
  });
}

test('independently inserted publication receipt survives exclusive-open failure', t => {
  const options = fixture(t);
  const before = evidence(options);
  const original = fs.openSync;
  const independent = join(options.workspace, 'independent-receipt');
  fs.writeFileSync(independent, 'keep independent receipt');
  let injected = false;
  t.mock.method(fs, 'openSync', (path, flags, ...args) => {
    if (!injected && (flags & fs.constants.O_CREAT) && path.endsWith('/receipt.json')) {
      injected = true;
      fs.renameSync(independent, path);
    }
    return original(path, flags, ...args);
  });
  assert.throws(() => prepareNativeModelDesignBuildInputs(options), /EEXIST/);
  assert.equal(injected, true);
  assert.deepEqual(fs.readdirSync(options.output).sort(), ['package', 'receipt.json']);
  assert.equal(fs.readFileSync(join(options.output, 'receipt.json'), 'utf8'), 'keep independent receipt');
  assert.throws(() => verify(options), SyntaxError);
  assert.deepEqual(evidence(options), before);
});

test('successful prepare/verify and failed verification close all file and directory descriptors', t => {
  const options = fixture(t);
  const descriptors = fs.readdirSync('/proc/self/fd').length;
  prepareNativeModelDesignBuildInputs(options);
  assert.equal(fs.readdirSync('/proc/self/fd').length, descriptors);
  verify(options);
  assert.equal(fs.readdirSync('/proc/self/fd').length, descriptors);
  fs.writeFileSync(join(options.output, 'package/src/index.ts'), 'changed staged source');
  assert.throws(() => verify(options), /Staged package differs/);
  assert.equal(fs.readdirSync('/proc/self/fd').length, descriptors);
});

for (const operation of ['prepare', 'verify']) {
  for (const change of ['bytes', 'additional source', 'removed source', 'candidate entry']) {
    test(`${operation} rejects staged ${change} introduced during the final loadInputs source read`, t => {
      const options = fixture(t);
      if (operation === 'verify') prepareNativeModelDesignBuildInputs(options);
      const before = evidence(options);
      const descriptors = fs.readdirSync('/proc/self/fd').length;
      const staged = join(options.output, 'package/src/index.ts');
      const receipt = join(options.output, 'receipt.json');
      const read = fs.readFileSync;
      let outputRead = false;
      let injected = false;
      t.mock.method(fs, 'readFileSync', (path, ...args) => {
        const target = openedPath(path);
        const result = read(path, ...args);
        if (target === staged) outputRead = true;
        if (!injected && outputRead && fs.existsSync(receipt) &&
          target === join(options.source, 'src/index.ts')) {
          injected = true;
          if (change === 'bytes') fs.writeFileSync(staged, 'export const late = true;\n');
          else if (change === 'additional source') {
            fs.writeFileSync(join(options.output, 'package/src/late.ts'), 'export {};\n', { flag: 'wx' });
          } else if (change === 'removed source') fs.unlinkSync(staged);
          else fs.writeFileSync(join(options.output, 'late.json'), '{}', { flag: 'wx' });
        }
        return result;
      });
      assert.throws(() => operation === 'prepare' ? prepareNativeModelDesignBuildInputs(options)
        : verify(options), /Staged package (?:differs|changed)|Unexpected build-input candidate files|ENOENT/);
      assert.equal(injected, true, 'The final loadInputs read must actually exercise the output mutation');
      assert.deepEqual(evidence(options), before);
      assert.equal(fs.readdirSync('/proc/self/fd').length, descriptors);
    });
  }
}

// Same-UID 0700 replacement before the first stat is outside the single-writer boundary.
for (const phase of ['after mkdir', 'before directory open']) {
  for (const replacement of ['symlink', 'regular directory']) {
    const label = phase === 'after mkdir' && replacement === 'regular directory'
      ? 'regular directory (0755)' : replacement;
    test(`build-output ${label} substitution ${phase} cannot be accepted or cleaned as owned`, t => {
      const options = fixture(t);
      const before = evidence(options);
      const external = join(options.workspace, 'external');
      write(join(external, 'sentinel'), 'keep');
      const moved = join(options.workspace, 'moved-owned-candidate');
      const descriptors = fs.readdirSync('/proc/self/fd').length;
      const mkdir = fs.mkdirSync;
      const open = fs.openSync;
      let injected = false;
      let substitute;
      const replace = () => {
        injected = true;
        fs.renameSync(options.output, moved);
        if (replacement === 'symlink') fs.symlinkSync(external, options.output);
        else {
          mkdir(options.output, { mode: 0o755 });
          fs.chmodSync(options.output, 0o755);
          substitute = fs.lstatSync(options.output);
        }
      };
      if (phase === 'after mkdir') {
        t.mock.method(fs, 'mkdirSync', (path, ...args) => {
          const result = mkdir(path, ...args);
          if (!injected && path.endsWith('/candidate')) replace();
          return result;
        });
      } else {
        t.mock.method(fs, 'openSync', (path, flags, ...args) => {
          if (!injected && (flags & fs.constants.O_DIRECTORY) && path.endsWith('/candidate')) replace();
          return open(path, flags, ...args);
        });
      }
      const error = phase === 'after mkdir' && replacement === 'regular directory'
        ? /Created directory permissions changed/ : /Directory changed|Symlink|ELOOP|ENOTDIR/;
      assert.throws(() => prepareNativeModelDesignBuildInputs(options), error);
      assert.equal(injected, true);
      assert.deepEqual(fs.readdirSync(external), ['sentinel']);
      assert.equal(fs.readFileSync(join(external, 'sentinel'), 'utf8'), 'keep');
      if (replacement === 'regular directory') {
        const current = fs.lstatSync(options.output);
        assert.equal(current.dev, substitute.dev);
        assert.equal(current.ino, substitute.ino);
        assert.deepEqual(fs.readdirSync(options.output), []);
      } else assert.equal(fs.lstatSync(options.output).isSymbolicLink(), true);
      assert.deepEqual(evidence(options), before);
      assert.equal(fs.readdirSync('/proc/self/fd').length, descriptors);
    });
  }
}

test('build-input receipt publication is exclusive and cannot unlink a substituted temporary receipt', t => {
  const options = fixture(t);
  const before = evidence(options);
  const open = fs.openSync;
  const link = fs.linkSync;
  const unlink = fs.unlinkSync;
  const writes = [];
  const links = [];
  const unlinks = [];
  t.mock.method(fs, 'openSync', (path, flags, ...args) => {
    if ((flags & fs.constants.O_CREAT) && path.endsWith('/receipt.json')) writes.push(flags);
    return open(path, flags, ...args);
  });
  t.mock.method(fs, 'linkSync', (...args) => {
    links.push(args);
    return link(...args);
  });
  t.mock.method(fs, 'unlinkSync', path => {
    unlinks.push(path);
    if (path.endsWith('/.receipt.tmp')) {
      fs.renameSync(path, join(options.workspace, 'owned-receipt-backup'));
      fs.writeFileSync(path, 'keep independent temporary receipt', { flag: 'wx' });
    }
    return unlink(path);
  });
  prepareNativeModelDesignBuildInputs(options);
  assert.deepEqual(links, [], 'Publication must not hard-link a mutable temporary pathname');
  assert.deepEqual(unlinks, [], 'Publication must not delete a mutable temporary pathname');
  assert.equal(writes.length, 1);
  for (const flag of [fs.constants.O_CREAT, fs.constants.O_EXCL, fs.constants.O_NOFOLLOW]) {
    assert.ok(writes[0] & flag, `Receipt open must include flag ${flag}`);
  }
  assert.equal(fs.existsSync(join(options.output, '.receipt.tmp')), false);
  assert.deepEqual(evidence(options), before);
});

test('ambiguous build-input failure cannot unlink or rmdir a substituted cleanup pathname', t => {
  const options = fixture(t);
  const before = evidence(options);
  const descriptors = fs.readdirSync('/proc/self/fd').length;
  const open = fs.openSync;
  const unlink = fs.unlinkSync;
  const rmdir = fs.rmdirSync;
  const deletions = [];
  let injected = false;
  t.mock.method(fs, 'openSync', (path, flags, ...args) => {
    if (!injected && (flags & fs.constants.O_CREAT) &&
      /\/(?:receipt\.json|\.receipt\.tmp)$/.test(path)) {
      injected = true;
      throw new Error('Injected ambiguous publication failure');
    }
    return open(path, flags, ...args);
  });
  t.mock.method(fs, 'unlinkSync', path => {
    deletions.push(path);
    fs.renameSync(path, join(options.workspace, 'cleanup-owned-backup'));
    fs.writeFileSync(path, 'keep independent cleanup substitute', { flag: 'wx' });
    return unlink(path);
  });
  t.mock.method(fs, 'rmdirSync', path => {
    deletions.push(path);
    return rmdir(path);
  });
  assert.throws(() => prepareNativeModelDesignBuildInputs(options), /Injected ambiguous publication failure/);
  assert.equal(injected, true);
  assert.deepEqual(deletions, [], 'Identity checks cannot authorize later pathname deletion');
  assert.equal(fs.existsSync(join(options.output, 'receipt.json')), false);
  assert.deepEqual(evidence(options), before);
  assert.equal(fs.readdirSync('/proc/self/fd').length, descriptors);
});

test('exported main and real CLI help perform no staging and explain blocked exit status', t => {
  const options = fixture(t);
  const before = evidence(options);
  const lines = [];
  t.mock.method(console, 'log', (...args) => { lines.push(args.join(' ')); });
  assert.equal(main(['--help']), 0);
  assert.match(lines.join('\n'), /Exit 2 means build remains blocked/);
  assert.throws(() => main([]), /--repair-receipt is required/);
  assert.throws(() => main([
    '--repair-receipt', options.repairReceipt,
    '--verify-receipt', join(options.output, 'receipt.json'), '--output', options.output,
  ]), /cannot be combined/);
  const result = spawnSync(process.execPath, [tool, '--help'], {
    cwd: options.workspace, encoding: 'utf8', timeout: 10_000,
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Stages immutable source\/config copies and verified resources/);
  assert.match(result.stdout, /Exit 2 means build remains blocked/);
  assert.equal(result.stderr, '');
  assert.equal(fs.existsSync(options.output), false);
  assert.deepEqual(evidence(options), before);
});

test('real CLI prepares and verifies audited inputs with exit 2, never source/build acceptance', t => {
  const sourceBefore = tree(join(WORKSPACE, MODEL_DESIGN_SOURCE));
  const resourcesBefore = tree(join(WORKSPACE, RESOURCE_INPUT));
  const repaired = repairNativeModelResources();
  const repairRoot = join(WORKSPACE, dirname(repaired.output.path));
  t.after(() => fs.rmSync(repairRoot, { recursive: true, force: true }));
  const output = join(WORKSPACE, '.artifacts/native-model-design-inputs', `test-cli-${randomUUID()}`);
  t.after(() => fs.rmSync(output, { recursive: true, force: true }));
  const repairBefore = tree(repairRoot);
  const args = ['--repair-receipt', join(repairRoot, 'receipt.json')];
  const run = additional => {
    const result = spawnSync(process.execPath, [tool, ...args, ...additional], {
      cwd: WORKSPACE, encoding: 'utf8', timeout: 30_000, maxBuffer: 4 * 1024 * 1024,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 2, result.stderr);
    assert.equal(result.stderr, '');
    return JSON.parse(result.stdout);
  };
  const receipt = run(['--output', output]);
  assert.equal(receipt.status, 'prepared-build-blocked');
  assertBlocked(receipt);
  assert.deepEqual(receipt.source.audit, AUDITED_MODEL_DESIGN_SOURCE);
  assert.equal(receipt.resources.summary.outputParseableFiles, 1414);
  const candidateBefore = tree(output);
  const verified = run(['--verify-receipt', join(output, 'receipt.json')]);
  assert.equal(verified.status, 'verified-inputs-build-blocked');
  assert.equal(verified.inputIntegrityVerified, true);
  assertBlocked(verified);
  assert.deepEqual(tree(output), candidateBefore);
  assert.deepEqual(tree(repairRoot), repairBefore);
  assert.deepEqual(tree(join(WORKSPACE, MODEL_DESIGN_SOURCE)), sourceBefore);
  assert.deepEqual(tree(join(WORKSPACE, RESOURCE_INPUT)), resourcesBefore);
});
