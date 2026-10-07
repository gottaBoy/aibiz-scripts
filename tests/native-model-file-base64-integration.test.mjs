import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { loadMigrationContract, WORKSPACE } from '../harness-modeling-core-audit.mjs';
import { readTree } from '../native-candidate-files.mjs';
import { readFileBase64Replacement } from '../prepare-native-file-base64-replacement.mjs';
import { prepareNativeModelCandidate, rewritePluginReferences } from '../prepare-native-model-candidate.mjs';

const original = '@ibiz-template-plugin/file-to-base64@0.1.8-alpha.165';
const replacement = '@aibiz/file-to-base64@0.1.0';
const sourcePath = 'modelingweb/local-plugins/file-to-base64';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = (path, value) => {
  fs.mkdirSync(dirname(path), { recursive: true });
  fs.writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
};

function fixture(t) {
  const workspace = fs.mkdtempSync(join(tmpdir(), 'native-file-base64-integration-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const contract = structuredClone(loadMigrationContract());
  contract.migrationMappings = contract.migrationMappings.filter(mapping => mapping.from === original);
  contract.plugins = contract.plugins.filter(plugin => plugin.repo === original);
  assert.equal(contract.migrationMappings[0].build.status, 'missing-receipt');
  const modelRoot = join(workspace, contract.evidence.modelRoot);
  const originals = [];
  for (const application of ['Central', 'ModelDesign']) {
    for (const name of ['PSSYSAPP.json', 'PSSYSAPP.simple.json', 'PSSYSAPP.hubsubapp.json']) {
      const path = `PSSYSAPPS/${application}/${name}`;
      const model = { application, name, rTObjectRepo: original, note: original };
      json(join(modelRoot, path), model);
      const bytes = fs.readFileSync(join(modelRoot, path));
      originals.push({ path, bytes, model });
      if (name === 'PSSYSAPP.json') {
        contract.evidence.applications[application] = {
          ...contract.evidence.applications[application], inputSha256: hash(bytes), bytes: bytes.length,
          references: [{ repo: original, locations: ['/rTObjectRepo'] }],
        };
      }
    }
  }
  json(join(workspace, 'scripts/fixtures/modeling-core-migration-contract.json'), contract);
  fs.mkdirSync(join(workspace, sourcePath), { recursive: true });
  fs.cpSync(join(WORKSPACE, sourcePath), join(workspace, sourcePath), { recursive: true });
  fs.copyFileSync(join(WORKSPACE, 'modelingweb/nginx-native.conf'),
    join(workspace, 'modelingweb/nginx-native.conf'));
  return { workspace, contract, originals, modelRoot,
    output: join(workspace, '.artifacts/native-model-migration/file-editor') };
}

test('explicit independent replacement binds five delivery files and all six models without source claims', t => {
  const data = fixture(t);
  const verified = readFileBase64Replacement(data);
  const receipt = prepareNativeModelCandidate({ ...data, fileBase64Replacement: true });
  assert.deepEqual(receipt.plugins, [verified.plugin]);
  assert.deepEqual(readTree(join(data.output, 'plugins', replacement), { jsonOnly: false }).entries,
    verified.files.entries);
  assert.equal(receipt.unresolvedMappings.length, 0);
  assert.equal(receipt.acceptedForProduction, false);
  assert.deepEqual(receipt.independentReplacementMappings, [{
    from: original, to: replacement, originalSourceRecovered: false,
    nativeCompatibilityVerified: false,
    originalMigrationAcceptance: 'not-satisfied-by-independent-replacement',
  }]);
  assert.equal(receipt.plugins[0].originalSourceRecovered, false);
  assert.equal(receipt.plugins[0].nativeCompatibilityVerified, false);
  assert.equal(fs.existsSync(join(data.output, 'plugins', original)), false);
  for (const file of data.originals) {
    assert.deepEqual(fs.readFileSync(join(data.modelRoot, file.path)), file.bytes);
    const rewritten = JSON.parse(fs.readFileSync(join(data.output, 'model', file.path)));
    assert.equal(rewritten.rTObjectRepo, replacement);
    assert.equal(rewritten.note, original);
    assert.deepEqual(rewritePluginReferences(rewritten, new Map([[replacement, original]])).model, file.model);
  }
  assert.deepEqual(loadMigrationContract(data.workspace), data.contract);
});

test('without explicit selection the independent replacement is not deployed', t => {
  const data = fixture(t);
  assert.throws(() => prepareNativeModelCandidate(data), /No locally built/);
  assert.equal(fs.existsSync(data.output), false);
});

test('replacement source drift fails before publishing any candidate files', t => {
  const data = fixture(t);
  fs.appendFileSync(join(data.workspace, sourcePath, 'src/editor.ts'), '\n');
  assert.throws(() => prepareNativeModelCandidate({ ...data, fileBase64Replacement: true }),
    /source input hashes/);
  assert.equal(fs.existsSync(data.output), false);
});

test('replacement selection rejects truthy strings without publishing a candidate', t => {
  const data = fixture(t);
  assert.throws(() => prepareNativeModelCandidate({ ...data, fileBase64Replacement: 'true' }),
    /must be boolean/);
  assert.equal(fs.existsSync(data.output), false);
});
