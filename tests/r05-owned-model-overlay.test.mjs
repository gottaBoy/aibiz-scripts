import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { PinnedDirectories, readTree } from '../native-candidate-files.mjs';
import {
  prepareR05OwnedModel, r05Files, r05ModelRoot,
} from '../prepare-r05-owned-model.mjs';
import {
  bindStagedR05OwnedModel, readR05OwnedModelOverlay, verifyR05OwnedModelProviderMount,
  verifyStagedR05OwnedModelBinding,
} from '../r05-owned-model-overlay.mjs';
import { stageOwnedModelInput } from '../launch-run-owned-native-backend.mjs';
import { MODEL_CONTEXT_VIEW_PATHS } from '../native-model-context-overlay.mjs';

const actualWorkspace = new URL('../../', import.meta.url).pathname;

function fixture(t, { context = false } = {}) {
  const workspace = fs.mkdtempSync(join(os.tmpdir(), 'aibiz-r05-overlay-'));
  const directories = new PinnedDirectories();
  t.after(() => { directories.close(); fs.rmSync(workspace, { recursive: true, force: true }); });
  const source = join(workspace, r05ModelRoot);
  for (const path of [...Object.values(r05Files), ...(context ? MODEL_CONTEXT_VIEW_PATHS : [])]) {
    fs.mkdirSync(dirname(join(source, path)), { recursive: true });
    fs.copyFileSync(join(actualWorkspace, r05ModelRoot, path), join(source, path));
  }
  fs.writeFileSync(join(source, 'unrelated.json'), '{"preserve":"original"}\n');
  const r05OwnedModelCandidate = join(workspace, '.artifacts/r05-owned-model/candidate');
  prepareR05OwnedModel({ workspace, output: r05OwnedModelCandidate });
  return {
    workspace, source, directories, r05OwnedModelCandidate,
    outputPath: join(workspace,
      '.artifacts/native-nonadmin-fixtures/123456789abc/backend-runtime-r05-r1/model-input'),
  };
}

test('R05 stage is opt-in and otherwise retains every original model byte', t => {
  const options = fixture(t);
  const { r05OwnedModelCandidate, ...unselected } = options;
  const source = readTree(options.source, { jsonOnly: false });
  const staged = stageOwnedModelInput(unselected);
  assert.deepEqual(readTree(options.outputPath, { jsonOnly: false }).entries, source.entries);
  assert.equal(staged.r05OwnedModelBinding, undefined);
});

test('R05 selection stages exactly four candidate files plus the entire unchanged base file set', t => {
  const options = fixture(t);
  const source = readTree(options.source, { jsonOnly: false });
  const overlay = readR05OwnedModelOverlay({
    workspace: options.workspace, sourceRoot: options.source,
    candidatePath: options.r05OwnedModelCandidate,
  });
  const staged = stageOwnedModelInput(options);
  const output = readTree(options.outputPath, { jsonOnly: false });
  const changed = output.entries.filter(file =>
    source.entries.find(original => original.path === file.path)?.sha256 !== file.sha256);
  assert.deepEqual(changed.map(file => file.path).sort(), Object.values(r05Files).sort());
  assert.deepEqual(output.entries.map(file => file.path), source.entries.map(file => file.path));
  assert.deepEqual(readTree(options.source, { jsonOnly: false }).entries, source.entries);
  assert.equal(staged.r05OwnedModelBinding.contract, 'staged-r05-owned-model-binding-v1');
  assert.deepEqual(staged.r05OwnedModelBinding.candidate, overlay.binding);
  assert.equal(staged.r05OwnedModelBinding.source.fingerprint, source.fingerprint);
  assert.equal(staged.r05OwnedModelBinding.staged.fingerprint, output.fingerprint);
  assert.equal(staged.r05OwnedModelBinding.nativeAcceptance, false);
  assert.equal(staged.r05OwnedModelBinding.runtimeBindingVerified, false);
  assert.equal(verifyStagedR05OwnedModelBinding(staged.r05OwnedModelBinding), staged.r05OwnedModelBinding);
  assert.throws(() => stageOwnedModelInput(options), /Existing destination/);
});

test('R05 and the three system context overlays compose without discarding either transformation', t => {
  const options = fixture(t, { context: true });
  const source = readTree(options.source, { jsonOnly: false });
  const staged = stageOwnedModelInput({ ...options, modelContextOverlay: true });
  const output = readTree(options.outputPath, { jsonOnly: false });
  const changed = output.entries.filter(file =>
    source.entries.find(original => original.path === file.path)?.sha256 !== file.sha256);
  assert.deepEqual(changed.map(file => file.path).sort(),
    [...Object.values(r05Files), ...MODEL_CONTEXT_VIEW_PATHS].sort());
  assert.equal(staged.modelContextOverlay.files.length, 3);
  assert.equal(staged.r05OwnedModelBinding.staged.fingerprint, staged.fingerprint);
  verifyStagedR05OwnedModelBinding(staged.r05OwnedModelBinding);
});

test('R05 input selection rejects nonowned outputs and wrong authoritative source before writing', t => {
  const options = fixture(t);
  for (const change of [
    value => { value.outputPath = join(options.workspace, '.artifacts/staged'); },
    value => { value.outputPath = join(options.workspace, 'shared-model'); },
    value => { value.source = join(options.workspace, 'other-source'); },
    value => { value.r05OwnedModelCandidate = false; },
    value => { value.r05OwnedModelCandidate = ''; },
    value => { value.r05OwnedModelCandidate = join(options.workspace, 'shared-candidate'); },
  ]) {
    const selected = { ...options };
    change(selected);
    assert.throws(() => stageOwnedModelInput(selected));
    assert.equal(fs.existsSync(selected.outputPath), false);
  }
});

test('old or fabricated receipt claims cannot select an R05 overlay', t => {
  const options = fixture(t);
  const receiptPath = join(options.r05OwnedModelCandidate, 'receipt.json');
  const original = fs.readFileSync(receiptPath);
  for (const change of [
    value => { value.nativeAcceptance = true; },
    value => { value.runtimeBindingVerified = true; },
    value => { value.generatorSha256 = '0'.repeat(64); },
    value => { value.inputs.entries.pop(); },
    value => { value.outputs.entries[0].sha256 = '0'.repeat(64); },
  ]) {
    const receipt = JSON.parse(original);
    change(receipt);
    fs.writeFileSync(receiptPath, JSON.stringify(receipt));
    assert.throws(() => stageOwnedModelInput(options));
    assert.equal(fs.existsSync(options.outputPath), false);
  }
});

test('unreadable candidates and symlinked output ancestors fail before a stage is created', t => {
  const options = fixture(t);
  const file = join(options.r05OwnedModelCandidate, 'model', r05Files.action);
  fs.chmodSync(file, 0);
  assert.throws(() => stageOwnedModelInput(options), /not owner-readable|EACCES/);
  assert.equal(fs.existsSync(options.outputPath), false);
  fs.chmodSync(file, 0o600);
  const parent = dirname(options.outputPath);
  fs.mkdirSync(dirname(parent), { recursive: true });
  const elsewhere = join(options.workspace, 'elsewhere');
  fs.mkdirSync(elsewhere);
  fs.symlinkSync(elsewhere, parent);
  assert.throws(() => stageOwnedModelInput(options), /Symlink directory/);
  assert.equal(fs.existsSync(join(elsewhere, 'model-input')), false);
});

test('private candidate permissions, exact inventory and readable source remain mandatory', t => {
  const options = fixture(t);
  const receipt = join(options.r05OwnedModelCandidate, 'receipt.json');
  fs.chmodSync(receipt, 0o644);
  assert.throws(() => stageOwnedModelInput(options), /permissions are too broad/);
  assert.equal(fs.existsSync(options.outputPath), false);
  fs.chmodSync(receipt, 0o600);
  const extra = join(options.r05OwnedModelCandidate, 'extra.json');
  fs.writeFileSync(extra, '{}\n', { mode: 0o600 });
  assert.throws(() => stageOwnedModelInput(options), /differs from reviewed generation/);
  assert.equal(fs.existsSync(options.outputPath), false);
  fs.rmSync(extra);
  fs.chmodSync(join(options.source, 'unrelated.json'), 0);
  assert.throws(() => stageOwnedModelInput(options), /not owner-readable|EACCES/);
  assert.equal(fs.existsSync(options.outputPath), false);
});

test('R05 verification rejects JSON-forged proofs and altered binding metadata', t => {
  const options = fixture(t);
  const staged = stageOwnedModelInput(options);
  assert.throws(() => verifyStagedR05OwnedModelBinding(
    JSON.parse(JSON.stringify(staged.r05OwnedModelBinding))), /freshly bound/);
  staged.r05OwnedModelBinding.runtimeBindingVerified = true;
  assert.throws(() => verifyStagedR05OwnedModelBinding(staged.r05OwnedModelBinding), /metadata changed/);
});

test('exported R05 binder derives trusted complete output and rejects caller-supplied extra changes', t => {
  const options = fixture(t);
  stageOwnedModelInput(options);
  fs.appendFileSync(join(options.outputPath, 'unrelated.json'), '\n');
  const inventedEntries = readTree(options.outputPath, { jsonOnly: false }).entries;
  assert.throws(() => bindStagedR05OwnedModel({
    workspace: options.workspace, sourceRoot: options.source,
    candidatePath: options.r05OwnedModelCandidate, modelRoot: options.outputPath,
    expectedEntries: inventedEntries,
  }), /Complete R05 composed stage output differs/);
});

test('provider inspection must retain the exact freshly bound model as one read-only bind', t => {
  const options = fixture(t);
  const staged = stageOwnedModelInput(options);
  const provider = { Mounts: [{
    Destination: '/app/model', Source: options.outputPath, Type: 'bind', RW: false,
  }] };
  verifyR05OwnedModelProviderMount(staged.r05OwnedModelBinding, provider);
  for (const change of [
    value => { value.Mounts = []; },
    value => { value.Mounts.push({ ...value.Mounts[0] }); },
    value => { value.Mounts[0].RW = true; },
    value => { value.Mounts[0].Type = 'volume'; },
    value => { value.Mounts[0].Source = `${options.outputPath}-old`; },
  ]) {
    const changed = structuredClone(provider);
    change(changed);
    assert.throws(() => verifyR05OwnedModelProviderMount(staged.r05OwnedModelBinding, changed));
  }
  assert.throws(() => verifyR05OwnedModelProviderMount(staged.r05OwnedModelBinding, undefined));
  fs.appendFileSync(join(options.outputPath, 'unrelated.json'), '\n');
  assert.throws(() => verifyR05OwnedModelProviderMount(staged.r05OwnedModelBinding, provider),
    /complete staged model drift/);
});

for (const target of ['candidate', 'source', 'stage', 'unrelated-source', 'unrelated-stage', 'stage-mode']) {
  test(`fresh R05 binding verification rejects subsequent ${target} drift`, t => {
    const options = fixture(t);
    const staged = stageOwnedModelInput(options);
    const files = {
      candidate: join(options.r05OwnedModelCandidate, 'model', r05Files.action),
      source: join(options.source, r05Files.action),
      stage: join(options.outputPath, r05Files.action),
      'unrelated-source': join(options.source, 'unrelated.json'),
      'unrelated-stage': join(options.outputPath, 'unrelated.json'),
      'stage-mode': join(options.outputPath, r05Files.action),
    };
    if (target === 'stage-mode') fs.chmodSync(files[target], 0o600);
    else fs.appendFileSync(files[target], '\n');
    assert.throws(() => verifyStagedR05OwnedModelBinding(staged.r05OwnedModelBinding));
  });
}
