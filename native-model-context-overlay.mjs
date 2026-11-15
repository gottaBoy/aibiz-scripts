import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { PinnedDirectories, readPinnedFile } from './native-candidate-files.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
export const MODEL_CONTEXT_VIEW_PATHS = Object.freeze([
  'PSSYSAPPS/ModelDesign/PSAPPDEVIEWS/PSSystemDashboardView.json',
  'PSSYSAPPS/ModelDesign/PSAPPDEVIEWS/PSSystemDashboardView_SysInfo.json',
  'PSSYSAPPS/ModelDesign/PSAPPDEVIEWS/PSSystemSettingInfoView.json',
]);
const originalSystem = '2C40DFCD-0DF5-47BF-91A5-C45F810B0001';
const inside = (root, path) => {
  const child = relative(resolve(root), resolve(path));
  assert.ok(child && child !== '..' && !child.startsWith(`..${sep}`) && !child.startsWith(sep));
};
const read = (directories, path) => {
  const file = readPinnedFile(directories, directories.open(dirname(path)), basename(path));
  return { path, ...file, sha256: hash(file.data) };
};
const bind = file => ({ path: file.path, bytes: file.data.length, sha256: file.sha256 });

export function overlayNativeModelContext(model, path) {
  assert.ok(MODEL_CONTEXT_VIEW_PATHS.includes(path), 'Only the three reviewed system views may be overlaid');
  assert.ok(model && typeof model === 'object' && !Array.isArray(model));
  const contexts = model.getPSAppViewNavContexts;
  assert.ok(Array.isArray(contexts));
  const indexes = contexts.flatMap((row, index) => row.key === 'PSSYSTEM' ? [index] : []);
  assert.equal(indexes.length, 1, 'Exactly one existing system binding is required');
  const index = indexes[0];
  assert.deepEqual(contexts[index], {
    key: 'PSSYSTEM', name: 'PSSYSTEM', value: originalSystem, rawValue: true,
  }, 'Upstream system binding changed; review is required instead of force-applying');
  const candidate = structuredClone(model);
  candidate.getPSAppViewNavContexts[index].value = 'pssystemid';
  candidate.getPSAppViewNavContexts[index].rawValue = false;
  const restored = structuredClone(candidate);
  restored.getPSAppViewNavContexts[index] = structuredClone(contexts[index]);
  assert.deepEqual(restored, model, 'No other model property may change');
  return { model: candidate, changes: [
    { pointer: `/getPSAppViewNavContexts/${index}/value`, from: originalSystem, to: 'pssystemid' },
    { pointer: `/getPSAppViewNavContexts/${index}/rawValue`, from: true, to: false },
  ] };
}

export function readNativeModelContextOverlay({ workspace, sourceRoot }) {
  workspace = resolve(workspace);
  sourceRoot = resolve(sourceRoot);
  inside(workspace, sourceRoot);
  const directories = new PinnedDirectories();
  try {
    const files = [];
    const contents = [];
    const originals = [];
    for (const path of MODEL_CONTEXT_VIEW_PATHS) {
      const original = read(directories, join(sourceRoot, path));
      const transformed = overlayNativeModelContext(JSON.parse(original.data), path);
      const data = Buffer.from(`${JSON.stringify(transformed.model, null, 2)}\n`);
      files.push({ path, inputBytes: original.data.length, inputSha256: original.sha256,
        outputBytes: data.length, outputSha256: hash(data), changes: transformed.changes });
      contents.push({ path, data, sha256: hash(data) });
      originals.push(original);
    }
    for (const original of originals) {
      const current = read(directories, original.path);
      assert.equal(current.sha256, original.sha256, 'Original system view changed during overlay reading');
      assert.equal(current.identity.ino, original.identity.ino);
      assert.equal(current.identity.dev, original.identity.dev);
    }
    return {
      receipt: { contract: 'native-model-context-overlay-v1', enabled: true,
        sourceModelRoot: relative(workspace, sourceRoot), files,
        nativeAcceptance: false, acceptedForProduction: false },
      contents,
    };
  } finally { directories.close(); }
}

export function verifyNativeModelContextOverlay({ workspace, sourceRoot, modelRoot, receipt }) {
  const expected = readNativeModelContextOverlay({ workspace, sourceRoot });
  assert.deepEqual(receipt, expected.receipt, 'Model context overlay receipt/source drift');
  const directories = new PinnedDirectories();
  try {
    for (const file of expected.contents) {
      const output = read(directories, join(modelRoot, file.path));
      assert.equal(output.sha256, file.sha256, 'Model context view output drift');
      assert.equal(output.identity.mode & 0o004, 0o004, 'Model context view must be readable by the unprivileged frontend');
    }
  } finally { directories.close(); }
  return expected.receipt;
}

export function validateNativeModelContextCandidateBinding(binding, workspace, candidate) {
  assert.deepEqual(Object.keys(binding ?? {}).sort(), ['contract', 'files', 'receipt']);
  assert.equal(binding.contract, 'native-model-context-candidate-binding-v1');
  candidate = resolve(candidate);
  inside(join(resolve(workspace), '.artifacts/native-model-migration'), candidate);
  assert.equal(binding.receipt.path, join(candidate, 'receipt.json'));
  assert.deepEqual(binding.files.map(file => file.modelPath), [...MODEL_CONTEXT_VIEW_PATHS]);
  for (const file of [binding.receipt, ...binding.files]) {
    assert.deepEqual(Object.keys(file).sort(),
      file === binding.receipt ? ['bytes', 'path', 'sha256'] : ['bytes', 'modelPath', 'path', 'sha256']);
    assert.match(file.sha256 ?? '', /^[a-f0-9]{64}$/);
    assert.ok(Number.isSafeInteger(file.bytes) && file.bytes > 0 && file.bytes <= 64 * 1024 * 1024);
    assert.equal(file.path, resolve(file.path));
    assert.ok(!/[:,\r\n\0\\]/.test(file.path));
    if (file !== binding.receipt) assert.equal(file.path, join(candidate, 'model', file.modelPath));
  }
}

export function verifyNativeModelContextCandidate({ workspace, candidate }) {
  workspace = resolve(workspace);
  candidate = resolve(workspace, candidate);
  inside(join(workspace, '.artifacts/native-model-migration'), candidate);
  const directories = new PinnedDirectories();
  try {
    const receiptFile = read(directories, join(candidate, 'receipt.json'));
    const receipt = JSON.parse(receiptFile.data);
    assert.equal(receipt.contract, 'native-modeling-source-backed-candidate');
    assert.equal(receipt.status, 'prepared-not-accepted');
    assert.equal(receipt.acceptedForProduction, false);
    const sourceRoot = resolve(workspace, receipt.sourceModelRoot);
    inside(workspace, sourceRoot);
    verifyNativeModelContextOverlay({ workspace, sourceRoot, modelRoot: join(candidate, 'model'),
      receipt: receipt.modelContextOverlay });
    const files = MODEL_CONTEXT_VIEW_PATHS.map(modelPath => ({
      ...bind(read(directories, join(candidate, 'model', modelPath))), modelPath,
    }));
    const result = { contract: 'native-model-context-candidate-binding-v1',
      receipt: bind(receiptFile), files };
    validateNativeModelContextCandidateBinding(result, workspace, candidate);
    assert.equal(read(directories, receiptFile.path).sha256, receiptFile.sha256,
      'Model context candidate receipt changed during verification');
    return result;
  } finally { directories.close(); }
}
