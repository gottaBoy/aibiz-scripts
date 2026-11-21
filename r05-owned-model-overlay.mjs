import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { PinnedDirectories, readPinnedFile, readTree } from './native-candidate-files.mjs';
import { r05Files, r05ModelRoot, verifyR05OwnedModel } from './prepare-r05-owned-model.mjs';
import { readNativeModelContextOverlay } from './native-model-context-overlay.mjs';
import { readCentralMemberModelOverlay } from './owned-modeling-application-routes.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const digest = value => hash(JSON.stringify(value));
const stageBindings = new WeakMap();
const summary = ({ entries, contents, ...value }) => value;

function plainJSON(value, depth = 0, budget = { nodes: 0 }) {
  assert.ok(depth <= 24 && ++budget.nodes <= 10000, 'R05 binding JSON exceeds its structural budget');
  if (value === null || ['string', 'boolean'].includes(typeof value)) return;
  if (typeof value === 'number') {
    assert.ok(Number.isFinite(value), 'R05 binding contains a non-JSON number');
    return;
  }
  assert.ok(value && typeof value === 'object', 'R05 binding must contain only JSON values');
  assert.ok(Array.isArray(value) || Object.getPrototypeOf(value) === Object.prototype
    || Object.getPrototypeOf(value) === null, 'R05 binding contains a non-JSON object');
  for (const descriptor of Object.values(Object.getOwnPropertyDescriptors(value))) {
    assert.ok(Object.hasOwn(descriptor, 'value'), 'R05 binding accessors are not allowed');
    plainJSON(descriptor.value, depth + 1, budget);
  }
}

function roots({ workspace, sourceRoot, candidatePath, modelRoot }) {
  workspace = resolve(workspace);
  assert.equal(resolve(sourceRoot), join(workspace, r05ModelRoot),
    'R05 overlay requires the actual authoritative model source');
  assert.ok(typeof candidatePath === 'string' && candidatePath,
    'Explicit R05 owned model candidate path required');
  candidatePath = resolve(workspace, candidatePath);
  assert.ok(!/[,\r\n\0\\]/.test(candidatePath), 'Unsafe R05 candidate path');
  const child = relative(join(workspace, '.artifacts/r05-owned-model'), candidatePath);
  assert.ok(child && child !== '..' && !child.startsWith(`..${sep}`) && !child.startsWith(sep),
    'R05 candidate must remain in the owned model artifact root');
  if (modelRoot !== undefined) {
    modelRoot = resolve(modelRoot);
    const staged = relative(join(workspace, '.artifacts/native-nonadmin-fixtures'), modelRoot);
    assert.match(staged, /^[a-f0-9]{12}\/backend-runtime-[a-z0-9][a-z0-9-]{0,48}\/model-input$/,
      'R05 backend model stage must belong to one owned backend run');
  }
  return { workspace, sourceRoot: resolve(sourceRoot), candidatePath, modelRoot };
}

function readableTree(root, { container = false, owned = false } = {}) {
  const directories = new PinnedDirectories();
  const visit = directory => {
    const mode = directory.identity.mode & 0o777;
    assert.ok((mode & 0o500) === 0o500, 'Model directory is not owner-readable/searchable');
    if (owned) {
      assert.equal(directory.identity.uid, process.geteuid(), 'R05 candidate has another owner');
      assert.equal(mode & 0o077, 0, 'R05 candidate directory permissions are too broad');
    }
    if (container) assert.equal(mode & 0o005, 0o005, 'Staged model directory is not container-readable');
    for (const name of fs.readdirSync(directory.access)) {
      const path = directories.entry(directory, name);
      const info = fs.lstatSync(path);
      assert.ok(!info.isSymbolicLink(), 'Symlink model resource rejected');
      if (info.isDirectory()) {
        visit(directories.open(join(directory.path, name)));
      } else {
        assert.ok(info.isFile(), 'Non-regular model resource rejected');
        assert.equal(info.mode & 0o400, 0o400, 'Model resource is not owner-readable');
        if (owned) {
          assert.equal(info.uid, process.geteuid(), 'R05 candidate resource has another owner');
          assert.equal(info.mode & 0o077, 0, 'R05 candidate resource permissions are too broad');
        }
        if (container) assert.equal(info.mode & 0o004, 0o004, 'Staged model resource is not container-readable');
      }
    }
    directories.verify(directory);
  };
  try { visit(directories.open(root)); }
  finally { directories.close(); }
}

export function readR05OwnedModelOverlay(options) {
  const paths = roots(options);
  readableTree(paths.sourceRoot);
  readableTree(paths.candidatePath, { owned: true });
  const verified = verifyR05OwnedModel({ workspace: paths.workspace, output: paths.candidatePath });
  const directories = new PinnedDirectories();
  try {
    const receipt = readPinnedFile(directories, directories.open(paths.candidatePath), 'receipt.json');
    const files = readTree(join(paths.candidatePath, 'model'));
    assert.deepEqual(files.entries.map(file => `model/${file.path}`),
      verified.outputs.entries.map(file => file.path), 'R05 overlay output inventory differs');
    const contents = files.contents.map(file => ({
      path: file.path, data: file.data, sha256: file.sha256,
    }));
    assert.deepEqual(contents.map(file => file.path).sort(), Object.values(r05Files).sort());
    const binding = {
      path: relative(paths.workspace, paths.candidatePath),
      receipt: {
        path: relative(paths.workspace, join(paths.candidatePath, 'receipt.json')),
        bytes: receipt.data.length, sha256: hash(receipt.data),
      },
      generatorSha256: verified.generatorSha256,
      inputs: verified.inputs,
      outputs: verified.outputs,
      expectedRuntime: verified.expectedRuntime,
      nativeAcceptance: false, runtimeBindingVerified: false,
    };
    assert.deepEqual(verifyR05OwnedModel({ workspace: paths.workspace, output: paths.candidatePath }),
      verified, 'R05 candidate changed during overlay reading');
    readableTree(paths.candidatePath, { owned: true });
    return { contents, inputs: verified.inputs.entries, binding };
  } finally { directories.close(); }
}

export function bindStagedR05OwnedModel({
  workspace, sourceRoot, candidatePath, modelRoot, centralMemberReceiptPath, modelContextOverlay = false,
}) {
  assert.equal(typeof modelContextOverlay, 'boolean');
  const paths = roots({ workspace, sourceRoot, candidatePath, modelRoot });
  const overlay = readR05OwnedModelOverlay(paths);
  const source = readTree(paths.sourceRoot, { jsonOnly: false });
  const central = centralMemberReceiptPath === undefined ? undefined : readCentralMemberModelOverlay({
    workspace: paths.workspace, receiptPath: centralMemberReceiptPath,
  });
  const context = modelContextOverlay ? readNativeModelContextOverlay(paths) : undefined;
  const replacements = [...overlay.contents, ...(central?.contents ?? []), ...(context?.contents ?? [])];
  assert.equal(new Set(replacements.map(file => file.path)).size, replacements.length,
    'R05 composed model overlays cannot overlap');
  for (const input of [...overlay.inputs, ...(central?.inputs ?? [])]) {
    assert.equal(source.entries.find(file => file.path === input.path)?.sha256, input.sha256,
      'Selected candidate does not match the actual complete model source');
  }
  const expectedEntries = source.entries.map(file => {
    const replacement = replacements.find(candidate => candidate.path === file.path);
    return replacement ? { ...file, bytes: replacement.data.length, sha256: replacement.sha256 } : file;
  });
  const staged = readTree(paths.modelRoot, { jsonOnly: false });
  assert.deepEqual(staged.entries, expectedEntries, 'Complete R05 composed stage output differs');
  assert.deepEqual(staged.entries.map(file => file.path), source.entries.map(file => file.path),
    'R05 stage must retain the complete model file set');
  for (const output of overlay.contents) {
    assert.equal(staged.entries.find(file => file.path === output.path)?.sha256, output.sha256,
      'Staged R05 model output drift');
  }
  readableTree(paths.sourceRoot);
  readableTree(paths.modelRoot, { container: true });
  assert.deepEqual(readTree(paths.sourceRoot, { jsonOnly: false }).entries, source.entries,
    'R05 model source changed during stage binding');
  const binding = {
    contract: 'staged-r05-owned-model-binding-v1',
    candidate: overlay.binding,
    source: summary(source),
    staged: { path: relative(paths.workspace, paths.modelRoot), ...summary(staged) },
    ...(central ? { centralMemberReceipt: central.receipt } : {}),
    ...(context ? { modelContextOverlay: context.receipt } : {}),
    nativeAcceptance: false, runtimeBindingVerified: false, acceptedForProduction: false,
  };
  stageBindings.set(binding, {
    paths, sourceEntries: source.entries, expectedEntries: structuredClone(expectedEntries),
    digest: digest(binding),
    centralMemberReceiptPath: centralMemberReceiptPath === undefined
      ? undefined : resolve(paths.workspace, centralMemberReceiptPath),
    modelContextOverlay,
  });
  verifyStagedR05OwnedModelBinding(binding);
  return binding;
}

export function verifyStagedR05OwnedModelBinding(binding) {
  const proof = binding && stageBindings.get(binding);
  assert.ok(proof, 'A freshly bound in-process R05 stage is required');
  assert.equal(digest(binding), proof.digest, 'R05 stage binding metadata changed');
  const overlay = readR05OwnedModelOverlay(proof.paths);
  assert.deepEqual(overlay.binding, binding.candidate, 'R05 candidate binding changed');
  if (proof.centralMemberReceiptPath !== undefined) {
    assert.deepEqual(readCentralMemberModelOverlay({
      workspace: proof.paths.workspace, receiptPath: proof.centralMemberReceiptPath,
    }).receipt, binding.centralMemberReceipt, 'R05 composed Central candidate changed');
  }
  if (proof.modelContextOverlay) {
    assert.deepEqual(readNativeModelContextOverlay(proof.paths).receipt,
      binding.modelContextOverlay, 'R05 composed context candidate changed');
  }
  const source = readTree(proof.paths.sourceRoot, { jsonOnly: false });
  const staged = readTree(proof.paths.modelRoot, { jsonOnly: false });
  assert.deepEqual(source.entries, proof.sourceEntries, 'R05 complete source model drift');
  assert.deepEqual(staged.entries, proof.expectedEntries, 'R05 complete staged model drift');
  readableTree(proof.paths.sourceRoot);
  readableTree(proof.paths.modelRoot, { container: true });
  return binding;
}

function assertProviderModelMount(proof, provider) {
  assert.ok(proof, 'A freshly bound in-process R05 stage is required');
  assert.ok(Array.isArray(provider?.Mounts), 'R05 provider mount inspection is required');
  const modelMounts = provider.Mounts.filter(mount => mount.Destination === '/app/model');
  assert.equal(modelMounts.length, 1, 'R05 provider must mount the freshly bound model once');
  assert.equal(modelMounts[0].Source, proof.paths.modelRoot, 'R05 provider model source differs');
  assert.equal(modelMounts[0].Type, 'bind');
  assert.equal(modelMounts[0].RW, false, 'R05 provider model input must remain read-only');
}

export function verifyR05OwnedModelProviderMount(binding, provider) {
  verifyStagedR05OwnedModelBinding(binding);
  assertProviderModelMount(stageBindings.get(binding), provider);
  return binding;
}

export function rebindSerializedR05OwnedModel({
  workspace, runId, deploymentPath, binding, provider,
}) {
  assert.match(runId ?? '', /^[a-f0-9]{12}$/);
  workspace = resolve(workspace);
  deploymentPath = resolve(workspace, deploymentPath);
  const base = join(workspace, '.artifacts/native-nonadmin-fixtures', runId);
  assert.equal(dirname(dirname(deploymentPath)), base, 'R05 deployment belongs to another run');
  assert.match(basename(dirname(deploymentPath)), /^backend-runtime-[a-z0-9][a-z0-9-]{0,48}$/);
  assert.equal(basename(deploymentPath), 'deployment-input.private.json');
  assert.ok(binding && typeof binding === 'object' && !Array.isArray(binding),
    'Serialized R05 binding is required');
  plainJSON(binding);
  const modelRoot = join(dirname(deploymentPath), 'model-input');
  assert.equal(binding.staged?.path, relative(workspace, modelRoot),
    'R05 serialized stage belongs to another deployment');
  assert.equal(binding.contract, 'staged-r05-owned-model-binding-v1');
  assert.equal(binding.nativeAcceptance, false);
  assert.equal(binding.runtimeBindingVerified, false);
  assert.equal(binding.acceptedForProduction, false);
  const fresh = bindStagedR05OwnedModel({
    workspace, sourceRoot: join(workspace, r05ModelRoot), modelRoot,
    candidatePath: binding.candidate?.path,
    centralMemberReceiptPath: binding.centralMemberReceipt?.path,
    modelContextOverlay: Object.hasOwn(binding, 'modelContextOverlay'),
  });
  assert.deepEqual(binding, fresh, 'Serialized R05 binding differs from freshly derived verified inputs');
  // The fresh binder has just completed the full input/stage verification.
  assertProviderModelMount(stageBindings.get(fresh), provider);
  return fresh;
}
