import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import {
  MODEL_CONTEXT_VIEW_PATHS, overlayNativeModelContext, readNativeModelContextOverlay,
  validateNativeModelContextCandidateBinding, verifyNativeModelContextCandidate,
  verifyNativeModelContextOverlay,
} from '../native-model-context-overlay.mjs';
import { PinnedDirectories, readTree } from '../native-candidate-files.mjs';
import { stageOwnedModelInput } from '../launch-run-owned-native-backend.mjs';
import { isolatedLaunchInput } from '../native-model-design-isolated-launch.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const workspaceRoot = new URL('../../', import.meta.url).pathname;
const upstream = join(workspaceRoot,
  'vendor-upstream/ibizmodeling-standard/modelapi-core/src/main/resources/model/net/ibizsys/modeling');
const originalBytes = MODEL_CONTEXT_VIEW_PATHS.map(path => fs.readFileSync(join(upstream, path)));
const json = value => `${JSON.stringify(value, null, 2)}\n`;

function fixture(t) {
  const workspace = fs.mkdtempSync(join(tmpdir(), 'native-context-overlay-'));
  const sourceRoot = join(workspace, 'readonly-source');
  const candidate = join(workspace, '.artifacts/native-model-migration/controlled');
  const directories = new PinnedDirectories();
  t.after(() => { directories.close(); fs.rmSync(workspace, { recursive: true, force: true }); });
  const write = (path, bytes) => {
    fs.mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    fs.writeFileSync(path, bytes, { mode: 0o644 });
  };
  for (const [index, path] of MODEL_CONTEXT_VIEW_PATHS.entries()) write(join(sourceRoot, path), originalBytes[index]);
  write(join(sourceRoot, 'unchanged.json'), '{"keep":"all original bytes"}\n');
  const overlay = readNativeModelContextOverlay({ workspace, sourceRoot });
  for (const file of overlay.contents) write(join(candidate, 'model', file.path), file.data);
  const receipt = {
    contract: 'native-modeling-source-backed-candidate', status: 'prepared-not-accepted',
    acceptedForProduction: false, sourceModelRoot: 'readonly-source',
    modelContextOverlay: overlay.receipt,
  };
  write(join(candidate, 'receipt.json'), json(receipt));
  return { workspace, sourceRoot, candidate, overlay, directories, write };
}

test('the structured overlay changes only three reviewed PSSYSTEM bindings and never original model bytes', () => {
  for (const [index, path] of MODEL_CONTEXT_VIEW_PATHS.entries()) {
    const original = JSON.parse(originalBytes[index]);
    const before = structuredClone(original);
    const result = overlayNativeModelContext(original, path);
    assert.equal(result.changes.length, 2);
    const binding = result.model.getPSAppViewNavContexts.find(row => row.key === 'PSSYSTEM');
    assert.equal(binding.value, 'pssystemid');
    assert.equal(binding.rawValue, false);
    assert.deepEqual(original, before);
    assert.deepEqual(fs.readFileSync(join(upstream, path)), originalBytes[index]);
    assert.throws(() => overlayNativeModelContext(result.model, path), /review is required/);
  }
  assert.throws(() => overlayNativeModelContext({}, 'PSSYSAPPS/ModelDesign/other.json'));
});

for (const change of [
  model => { model.getPSAppViewNavContexts = []; },
  model => { model.getPSAppViewNavContexts.push(model.getPSAppViewNavContexts.find(row => row.key === 'PSSYSTEM')); },
  model => { model.getPSAppViewNavContexts.find(row => row.key === 'PSSYSTEM').value = 'different-system'; },
  model => { model.getPSAppViewNavContexts.find(row => row.key === 'PSSYSTEM').rawValue = false; },
  model => { model.getPSAppViewNavContexts.find(row => row.key === 'PSSYSTEM').extra = 'not-reviewed'; },
]) {
  test('changed upstream binding is refused before any candidate write', () => {
    const model = JSON.parse(originalBytes[0]);
    change(model);
    assert.throws(() => overlayNativeModelContext(model, MODEL_CONTEXT_VIEW_PATHS[0]));
  });
}

test('overlay evidence binds exact source/output bytes, six property changes and incomplete native acceptance', t => {
  const f = fixture(t);
  assert.equal(f.overlay.receipt.files.length, 3);
  assert.equal(f.overlay.receipt.files.flatMap(file => file.changes).length, 6);
  assert.equal(f.overlay.receipt.nativeAcceptance, false);
  assert.equal(f.overlay.receipt.acceptedForProduction, false);
  assert.deepEqual(verifyNativeModelContextOverlay({
    workspace: f.workspace, sourceRoot: f.sourceRoot, modelRoot: join(f.candidate, 'model'),
    receipt: f.overlay.receipt,
  }), f.overlay.receipt);
  for (const [index, file] of f.overlay.receipt.files.entries()) {
    assert.equal(file.inputSha256, hash(originalBytes[index]));
    assert.equal(file.outputSha256, hash(fs.readFileSync(join(f.candidate, 'model', file.path))));
    assert.deepEqual(fs.readFileSync(join(f.sourceRoot, file.path)), originalBytes[index]);
  }
});

test('owned backend staging overlays only those three files and retains every other source byte', t => {
  const f = fixture(t);
  const before = readTree(f.sourceRoot, { jsonOnly: false });
  const outputPath = join(f.workspace, 'fresh-owned-stage');
  const result = stageOwnedModelInput({
    workspace: f.workspace, directories: f.directories, source: f.sourceRoot,
    outputPath, modelContextOverlay: true,
  });
  const after = readTree(f.sourceRoot, { jsonOnly: false });
  const staged = readTree(outputPath, { jsonOnly: false });
  assert.deepEqual(after.entries, before.entries);
  assert.deepEqual(result.modelContextOverlay, f.overlay.receipt);
  assert.equal(staged.entries.filter(file => file.sha256 !==
    before.entries.find(original => original.path === file.path).sha256).length, 3);
  assert.equal(staged.entries.find(file => file.path === 'unchanged.json').sha256,
    before.entries.find(file => file.path === 'unchanged.json').sha256);
  assert.throws(() => stageOwnedModelInput({
    workspace: f.workspace, directories: f.directories, source: f.sourceRoot,
    outputPath, modelContextOverlay: true,
  }));
});

test('an unselected owned stage keeps the default model byte-identical and refuses nonboolean selection', t => {
  const f = fixture(t);
  const result = stageOwnedModelInput({
    workspace: f.workspace, directories: f.directories, source: f.sourceRoot,
    outputPath: join(f.workspace, 'default-stage'),
  });
  assert.equal(Object.hasOwn(result, 'modelContextOverlay'), false);
  assert.equal(result.fingerprint, readTree(f.sourceRoot, { jsonOnly: false }).fingerprint);
  assert.throws(() => stageOwnedModelInput({
    workspace: f.workspace, directories: f.directories, source: f.sourceRoot,
    outputPath: join(f.workspace, 'invalid-stage'), modelContextOverlay: 'true',
  }));
});

test('frontend candidate binding mounts the exact three candidate views read-only in both applications', t => {
  const f = fixture(t);
  const binding = verifyNativeModelContextCandidate(f);
  validateNativeModelContextCandidateBinding(binding, f.workspace, f.candidate);
  const input = isolatedLaunchInput({
    workspace: f.workspace, candidate: f.candidate, assets: join(f.workspace, 'assets'),
    name: 'context-candidate-unit', modelContextOverlay: true, modelContextCandidate: binding,
  });
  assert.equal(input.modelContextOverlay, true);
  assert.deepEqual(input.modelContextCandidate, binding);
  for (const file of binding.files) {
    const mount = input.mounts.find(row => row.target === `/app/model/${file.modelPath}`);
    assert.deepEqual(mount, { source: file.path, target: `/app/model/${file.modelPath}`, readOnly: true });
    for (const app of input.applications) {
      assert.ok(app.args.includes(`type=bind,src=${file.path},dst=${mount.target},readonly`));
    }
  }
  for (const options of [
    { modelContextOverlay: true }, { modelContextCandidate: binding },
    { modelContextOverlay: 'true', modelContextCandidate: binding },
  ]) assert.throws(() => isolatedLaunchInput({
    workspace: f.workspace, candidate: f.candidate, assets: join(f.workspace, 'assets'),
    name: 'context-rejected-unit', ...options,
  }));
});

for (const kind of ['source', 'candidate', 'receipt', 'symlink', 'unreadable', 'wrong-candidate']) {
  test(`complete candidate verification refuses ${kind} drift`, t => {
    const f = fixture(t);
    const binding = verifyNativeModelContextCandidate(f);
    const output = join(f.candidate, 'model', MODEL_CONTEXT_VIEW_PATHS[0]);
    if (kind === 'source') fs.appendFileSync(join(f.sourceRoot, MODEL_CONTEXT_VIEW_PATHS[0]), '\n');
    if (kind === 'candidate') fs.appendFileSync(output, '\n');
    if (kind === 'receipt') fs.appendFileSync(join(f.candidate, 'receipt.json'), '\n');
    if (kind === 'symlink') {
      fs.rmSync(output);
      fs.symlinkSync(join(f.sourceRoot, MODEL_CONTEXT_VIEW_PATHS[0]), output);
    }
    if (kind === 'unreadable') fs.chmodSync(output, 0o600);
    if (kind === 'wrong-candidate') {
      binding.files[0].path = join(f.sourceRoot, MODEL_CONTEXT_VIEW_PATHS[0]);
      assert.throws(() => validateNativeModelContextCandidateBinding(binding, f.workspace, f.candidate));
      return;
    }
    if (kind === 'receipt') {
      assert.notDeepEqual(verifyNativeModelContextCandidate(f), binding);
    } else assert.throws(() => verifyNativeModelContextCandidate(f));
  });
}
