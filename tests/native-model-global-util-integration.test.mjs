import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { loadMigrationContract, WORKSPACE } from '../harness-modeling-core-audit.mjs';
import { readTree } from '../native-candidate-files.mjs';
import { readFileBase64Replacement } from '../prepare-native-file-base64-replacement.mjs';
import { readGlobalUtilReplacement } from '../prepare-native-global-util-replacement.mjs';
import { prepareNativeModelCandidate, rewritePluginReferences } from '../prepare-native-model-candidate.mjs';
import { fixtureSnapshot } from './helpers/native-ai-code-source-deps-fixture.mjs';

const original = '@ibiz-template-plugin/global-util-design@0.0.3-alpha.87';
const replacement = '@aibiz/global-util@0.1.0';
const sourcePath = 'modelingweb/local-plugins/global-util';
const base64Original = '@ibiz-template-plugin/file-to-base64@0.1.8-alpha.165';
const base64Replacement = '@aibiz/file-to-base64@0.1.0';
const base64SourcePath = 'modelingweb/local-plugins/file-to-base64';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = (path, value) => {
  fs.mkdirSync(dirname(path), { recursive: true });
  fs.writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};

function fixture(t, { withBase64 = false } = {}) {
  const workspace = fs.mkdtempSync(join(tmpdir(), 'native-model-global-util-integration-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const contract = structuredClone(loadMigrationContract());
  const identities = withBase64 ? [original, base64Original] : [original];
  contract.migrationMappings = contract.migrationMappings.filter(mapping => identities.includes(mapping.from));
  contract.plugins = contract.plugins.filter(plugin => identities.includes(plugin.repo));
  assert.equal(contract.migrationMappings.length, identities.length);
  for (const mapping of contract.migrationMappings) assert.equal(mapping.build.status, 'missing-receipt');
  const modelRoot = join(workspace, contract.evidence.modelRoot);
  const originals = [];
  for (const application of ['Central', 'ModelDesign']) {
    for (const name of ['PSSYSAPP.json', 'PSSYSAPP.simple.json', 'PSSYSAPP.hubsubapp.json']) {
      const path = `PSSYSAPPS/${application}/${name}`;
      const model = {
        application, name, rTObjectRepo: original, note: original,
        nested: { 'a/b~c': [{ RTOBJECTREPO: original, note: original }] },
        ...(withBase64 ? { editors: [{ rtobjectrepo: base64Original, note: base64Original }] } : {}),
      };
      json(join(modelRoot, path), model);
      const bytes = fs.readFileSync(join(modelRoot, path));
      originals.push({ path, bytes, model });
      if (name === 'PSSYSAPP.json') {
        contract.evidence.applications[application] = {
          ...contract.evidence.applications[application], inputSha256: hash(bytes), bytes: bytes.length,
          references: [
            { repo: original, locations: ['/rTObjectRepo', '/nested/a~1b~0c/0/RTOBJECTREPO'] },
            ...(withBase64 ? [{ repo: base64Original, locations: ['/editors/0/rtobjectrepo'] }] : []),
          ],
        };
      }
    }
  }
  const contractPath = join(workspace, 'scripts/fixtures/modeling-core-migration-contract.json');
  json(contractPath, contract);
  for (const path of [sourcePath, ...(withBase64 ? [base64SourcePath] : [])]) {
    fs.mkdirSync(dirname(join(workspace, path)), { recursive: true });
    fs.cpSync(join(WORKSPACE, path), join(workspace, path), { recursive: true });
  }
  fs.copyFileSync(join(WORKSPACE, 'modelingweb/nginx-native.conf'),
    join(workspace, 'modelingweb/nginx-native.conf'));
  return { workspace, contract, contractPath, originals, modelRoot,
    output: join(workspace, '.artifacts/native-model-migration/global-util') };
}

function independentMapping(from, to) {
  return {
    from, to, originalSourceRecovered: false, nativeCompatibilityVerified: false,
    originalMigrationAcceptance: 'not-satisfied-by-independent-replacement',
  };
}

function assertCandidate(data, receipt, verifiedPlugins) {
  const replacements = new Map(verifiedPlugins.map(({ plugin }) => [plugin.from, plugin.to]));
  assert.equal(receipt.schemaVersion, 1);
  assert.equal(receipt.contract, 'native-modeling-source-backed-candidate');
  assert.equal(receipt.status, 'prepared-not-accepted');
  assert.equal(receipt.acceptedForProduction, false);
  assert.deepEqual(receipt.plugins, verifiedPlugins.map(item => item.plugin));
  assert.deepEqual(receipt.independentReplacementMappings,
    verifiedPlugins.map(({ plugin }) => independentMapping(plugin.from, plugin.to)));
  assert.deepEqual(JSON.parse(fs.readFileSync(join(data.output, 'receipt.json'))), receipt);
  assert.equal(receipt.sourceModelRoot, data.contract.evidence.modelRoot);
  assert.deepEqual(receipt.remainingAcceptance, [
    'complete editable source for every native plugin and its iBiz dependencies',
    'native plugin runtime compatibility',
    'native editor operations and model save',
    'fresh-session model readback',
  ]);
  assert.deepEqual(receipt.unresolvedMappings,
    data.contract.migrationMappings.filter(mapping => !replacements.has(mapping.from))
      .map(mapping => ({ repo: mapping.from, blockers: mapping.blockers })));
  const expectedPluginEntries = verifiedPlugins.flatMap(({ plugin, files }) =>
    files.entries.map(file => ({ ...file, path: `${plugin.to}/${file.path}` })))
    .sort((a, b) => a.path.localeCompare(b.path));
  assert.deepEqual(readTree(join(data.output, 'plugins'), { jsonOnly: false }).entries, expectedPluginEntries);
  for (const { plugin, files } of verifiedPlugins) {
    assert.deepEqual(readTree(join(data.output, 'plugins', plugin.to), { jsonOnly: false }).entries, files.entries);
    assert.equal(fs.existsSync(join(data.output, 'plugins', plugin.from)), false);
    for (const flag of ['originalSourceRecovered', 'originalRepositoryAuthenticated',
      'nativeCompatibilityVerified', 'acceptedForProduction']) assert.equal(plugin[flag], false);
    assert.equal(plugin.compatibility, 'not-verified');
  }
  assert.deepEqual(Object.keys(receipt.applications).sort(), ['Central', 'ModelDesign']);
  assert.equal(Object.values(receipt.applications).flatMap(application => application.files).length, 6);
  for (const application of ['Central', 'ModelDesign']) {
    assert.deepEqual(receipt.applications[application].files.map(file => file.path),
      data.originals.filter(file => file.model.application === application).map(file => file.path));
  }
  for (const file of data.originals) {
    assert.deepEqual(fs.readFileSync(join(data.modelRoot, file.path)), file.bytes);
    const outputBytes = fs.readFileSync(join(data.output, 'model', file.path));
    const rewritten = JSON.parse(outputBytes);
    const expectedChanges = [
      ...(replacements.has(original) ? [
        { location: '/rTObjectRepo', from: original, to: replacement },
        { location: '/nested/a~1b~0c/0/RTOBJECTREPO', from: original, to: replacement },
      ] : []),
      ...(replacements.has(base64Original) ? [
        { location: '/editors/0/rtobjectrepo', from: base64Original, to: base64Replacement },
      ] : []),
    ];
    const expectedModel = structuredClone(file.model);
    expectedModel.rTObjectRepo = replacements.get(original) ?? original;
    expectedModel.nested['a/b~c'][0].RTOBJECTREPO = replacements.get(original) ?? original;
    if (expectedModel.editors) {
      expectedModel.editors[0].rtobjectrepo = replacements.get(base64Original) ?? base64Original;
    }
    assert.deepEqual(rewritten, expectedModel);
    assert.deepEqual(outputBytes, Buffer.from(`${JSON.stringify(expectedModel, null, 2)}\n`));
    const record = receipt.applications[file.model.application].files.find(item => item.path === file.path);
    assert.deepEqual(record, {
      path: file.path, inputSha256: hash(file.bytes), outputSha256: hash(outputBytes),
      changes: expectedChanges,
      unresolved: [original, ...(file.model.editors ? [base64Original] : [])]
        .filter(repo => !replacements.has(repo)).sort(),
    });
    assert.deepEqual(rewritePluginReferences(rewritten,
      new Map([...replacements].map(([from, to]) => [to, from]))).model, file.model);
  }
  const expectedPaths = [
    'receipt.json', 'nginx-native.conf', ...data.originals.map(file => `model/${file.path}`),
    ...expectedPluginEntries.map(file => `plugins/${file.path}`),
  ].sort((a, b) => a.localeCompare(b));
  assert.deepEqual(readTree(data.output, { jsonOnly: false }).entries.map(file => file.path), expectedPaths);
  for (const path of expectedPaths) assert.equal(fs.statSync(join(data.output, path)).mode & 0o777, 0o644);
  const nginxInput = fs.readFileSync(join(data.workspace, 'modelingweb/nginx-native.conf'));
  const nginxOutput = fs.readFileSync(join(data.output, 'nginx-native.conf'));
  assert.deepEqual(receipt.nginx, { inputSha256: hash(nginxInput), outputSha256: hash(nginxOutput) });
  assert.match(nginxOutput.toString(), /location \^~ \/nativeappcode\/plugins\/ \{/);
  assert.match(nginxOutput.toString(), /alias \/opt\/aibiz\/native-candidate-plugins\/;/);
  assert.deepEqual(loadMigrationContract(data.workspace), data.contract);
}

test('explicit global replacement rewrites all six models and binds exact delivery without native acceptance', t => {
  const data = fixture(t);
  const verified = readGlobalUtilReplacement(data);
  const sourceBefore = readTree(join(data.workspace, sourcePath), { jsonOnly: false }).entries;
  const contractBefore = fs.readFileSync(data.contractPath);
  const receipt = prepareNativeModelCandidate({ ...data, globalUtilReplacement: true });
  assertCandidate(data, receipt, [verified]);
  assert.deepEqual(readTree(join(data.workspace, sourcePath), { jsonOnly: false }).entries, sourceBefore);
  assert.deepEqual(fs.readFileSync(data.contractPath), contractBefore);
  assert.deepEqual(readGlobalUtilReplacement(data), verified);
});

test('simultaneously selected Base64 and global replacements retain two independent mappings and exact sibling trees', t => {
  const data = fixture(t, { withBase64: true });
  const global = readGlobalUtilReplacement(data);
  const base64 = readFileBase64Replacement(data);
  const sourcesBefore = [sourcePath, base64SourcePath].map(path =>
    readTree(join(data.workspace, path), { jsonOnly: false }).entries);
  const receipt = prepareNativeModelCandidate({
    ...data, globalUtilReplacement: true, fileBase64Replacement: true,
  });
  assertCandidate(data, receipt, [base64, global]);
  for (const [index, path] of [sourcePath, base64SourcePath].entries()) {
    assert.deepEqual(readTree(join(data.workspace, path), { jsonOnly: false }).entries, sourcesBefore[index]);
  }
});

for (const withBase64 of [false, true]) {
  test(`global replacement${withBase64 ? ' with Base64' : ''} under umask 0077 changes only candidate permissions`, t => {
    const previousMask = process.umask(0o077);
    try {
      const data = fixture(t, { withBase64 });
      fs.mkdirSync(dirname(data.output), { recursive: true });
      const verified = [
        ...(withBase64 ? [readFileBase64Replacement(data)] : []),
        readGlobalUtilReplacement(data),
      ];
      const privateParents = [
        data.workspace, join(data.workspace, '.artifacts'), dirname(data.output),
        data.modelRoot, dirname(join(data.workspace, sourcePath)), dirname(data.contractPath),
      ];
      for (const path of privateParents) {
        assert.equal(fs.lstatSync(path).mode & 0o7777, 0o700, path);
      }
      const protectedRoots = [
        data.modelRoot, data.contractPath, join(data.workspace, 'modelingweb/nginx-native.conf'),
        join(data.workspace, sourcePath),
        ...(withBase64 ? [join(data.workspace, base64SourcePath)] : []),
      ];
      const before = protectedRoots.map(fixtureSnapshot);
      const receipt = prepareNativeModelCandidate({
        ...data, globalUtilReplacement: true, fileBase64Replacement: withBase64,
      });
      assertCandidate(data, receipt, verified);
      for (const entry of fixtureSnapshot(data.output)) {
        assert.equal(entry.target, undefined, entry.path);
        assert.equal(fs.lstatSync(join(data.output, entry.path)).mode & 0o7777,
          entry.directory ? 0o755 : 0o644, entry.path || 'candidate root');
      }
      assert.deepEqual(protectedRoots.map(fixtureSnapshot), before);
      for (const path of privateParents) {
        assert.equal(fs.lstatSync(path).mode & 0o7777, 0o700, path);
      }
      assert.equal(process.umask(), 0o077);
    } finally {
      process.umask(previousMask);
    }
  });
}

for (const [name, globalSelected] of [['global only', true], ['Base64 only', false]]) {
  test(`${name} leaves the unselected independent mapping and model references unresolved`, t => {
    const data = fixture(t, { withBase64: true });
    const selected = globalSelected ? readGlobalUtilReplacement(data) : readFileBase64Replacement(data);
    const receipt = prepareNativeModelCandidate({
      ...data, globalUtilReplacement: globalSelected, fileBase64Replacement: !globalSelected,
    });
    assertCandidate(data, receipt, [selected]);
    assert.equal(receipt.unresolvedMappings.length, 1);
    assert.equal(fs.existsSync(join(data.output, 'plugins',
      globalSelected ? base64Replacement : replacement)), false);
  });
}

test('does not silently opt into an independent global replacement', t => {
  const data = fixture(t);
  assert.throws(() => prepareNativeModelCandidate(data), /No locally built/);
  assert.equal(fs.existsSync(data.output), false);
});

for (const [name, mutate, pattern] of [
  ['source drift', data => fs.appendFileSync(join(data.workspace, sourcePath, 'src/index.ts'), '\n'),
    /source input hashes/],
  ['build drift', data => fs.appendFileSync(join(data.workspace, sourcePath, 'dist/index.system.js'), '\n'),
    /build output hashes/],
  ['missing receipt', data => fs.rmSync(join(data.workspace, sourcePath, 'dist/build-receipt.json')),
    /Unexpected global utility source\/build file set/],
  ['original source claim', data => {
    const path = join(data.workspace, sourcePath, 'dist/build-receipt.json');
    const receipt = JSON.parse(fs.readFileSync(path));
    receipt.originalSourceRecovered = true;
    json(path, receipt);
  }, /Original source recovery cannot be claimed/],
  ['native compatibility claim', data => {
    const path = join(data.workspace, sourcePath, 'dist/build-receipt.json');
    const receipt = JSON.parse(fs.readFileSync(path));
    receipt.nativeCompatibilityVerified = true;
    json(path, receipt);
  }, /Native compatibility cannot be claimed/],
  ['unaudited original model drift', data => {
    fs.appendFileSync(join(data.modelRoot, 'PSSYSAPPS/ModelDesign/PSSYSAPP.json'), '\n');
  }, /Original ModelDesign model has changed/],
  ['missing sixth model', data => {
    fs.rmSync(join(data.modelRoot, 'PSSYSAPPS/ModelDesign/PSSYSAPP.hubsubapp.json'));
  }, /ENOENT/],
]) {
  test(`rejects ${name} before publishing a candidate`, t => {
    const data = fixture(t);
    mutate(data);
    assert.throws(() => prepareNativeModelCandidate({ ...data, globalUtilReplacement: true }), pattern);
    assert.equal(fs.existsSync(data.output), false);
  });
}

test('global replacement selection rejects truthy strings without publishing', t => {
  const data = fixture(t);
  assert.throws(() => prepareNativeModelCandidate({ ...data, globalUtilReplacement: 'true' }), /must be boolean/);
  assert.equal(fs.existsSync(data.output), false);
});

test('candidate preparation does not overwrite existing evidence', t => {
  const data = fixture(t);
  const evidence = join(data.output, 'existing.json');
  json(evidence, { acceptedForProduction: false, marker: 'preserve' });
  const before = fs.readFileSync(evidence);
  assert.throws(() => prepareNativeModelCandidate({ ...data, globalUtilReplacement: true }),
    /existing evidence must not be overwritten/);
  assert.deepEqual(fs.readdirSync(data.output), ['existing.json']);
  assert.deepEqual(fs.readFileSync(evidence), before);
});

test('CLI advertises the independent switch and rejects a value attached to its boolean option', () => {
  const script = join(WORKSPACE, 'scripts/prepare-native-model-candidate.mjs');
  const help = spawnSync(process.execPath, [script, '--help'], { encoding: 'utf8', timeout: 15000 });
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /--global-util-replacement \(does not recover original source\)/);
  assert.match(help.stdout, /--file-base64-replacement/);
  assert.match(help.stdout, /native acceptance remains incomplete/);
  const invalid = spawnSync(process.execPath, [script, '--global-util-replacement=true'],
    { encoding: 'utf8', timeout: 15000 });
  assert.equal(invalid.status, 1);
  assert.equal(invalid.stdout, '');
  assert.match(invalid.stderr, /does not take an argument/);
});
