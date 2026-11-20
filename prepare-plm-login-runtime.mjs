#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, realpath, symlink, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { treeInventory } from '../plm-web/tools/plm-candidate-host.mjs';

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hub = join(workspace, 'ibiz-app-hub');
const source = join(hub, 'components/ibiz-next-vue3');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

export async function preparePlmLoginRuntime({ candidate, output }) {
  const input = await realpath(candidate);
  const destination = resolve(output);
  assert.equal(await realpath(dirname(destination)), join(workspace, '.artifacts'));
  const receiptBytes = await readFile(join(input, 'source-build.json'));
  const receipt = JSON.parse(receiptBytes);
  assert.equal(receipt.sharedDistUnchanged, true);
  const inputFiles = await treeInventory(join(input, 'dist'));
  assert.deepEqual(inputFiles, receipt.outputFiles, 'Input candidate changed after its build');
  const sourceFiles = await treeInventory(join(source, 'src'));
  const originalDist = await treeInventory(join(source, 'dist'));
  const sharedDist = await treeInventory(join(workspace, 'plm-web/dist'));
  await mkdir(destination, { mode: 0o700 });
  const ownedWorkspace = join(destination, 'workspace');
  const snapshot = join(ownedWorkspace, 'components/ibiz-next-vue3');
  await mkdir(dirname(snapshot), { recursive: true });
  await cp(source, snapshot, {
    recursive: true,
    filter: path => !['node_modules', 'dist', 'es', 'lib', '.git'].includes(
      path.slice(source.length + 1).split('/')[0]),
  });
  await cp(join(hub, 'tsconfig.json'), join(ownedWorkspace, 'tsconfig.json'));
  await symlink(join(source, 'node_modules'), join(snapshot, 'node_modules'));
  await symlink(join(hub, 'node_modules'), join(ownedWorkspace, 'node_modules'));
  assert.deepEqual(await treeInventory(join(snapshot, 'src')), sourceFiles);
  await new Promise((accept, reject) => {
    const child = spawn(join(source, 'node_modules/.bin/ibiz-temp'), ['build', '-c'], {
      cwd: snapshot, env: { ...process.env, NODE_ENV: 'production' }, stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? accept() : reject(new Error(`Runtime build exited with ${code}`)));
  });
  assert.deepEqual(await treeInventory(join(source, 'src')), sourceFiles);
  assert.deepEqual(await treeInventory(join(source, 'dist')), originalDist,
    'The installed framework distribution must not change');
  assert.deepEqual(await treeInventory(join(snapshot, 'src')), sourceFiles);
  const runtimeFiles = await treeInventory(join(snapshot, 'dist'));
  assert.ok(runtimeFiles.some(file => file.path === 'index.system.min.js' && file.bytes > 0));
  const dist = join(destination, 'dist');
  await cp(join(input, 'dist'), dist, { recursive: true });
  await cp(join(snapshot, 'dist'), join(dist, 'extras/js/@ibiz-template/vue3-components'),
    { recursive: true, force: true });
  assert.deepEqual(await treeInventory(join(input, 'dist')), inputFiles);
  assert.deepEqual(await treeInventory(join(workspace, 'plm-web/dist')), sharedDist,
    'Shared PLM distribution must not change');
  const outputFiles = await treeInventory(dist);
  const prefix = 'extras/js/@ibiz-template/vue3-components/';
  assert.deepEqual(outputFiles.filter(file => !file.path.startsWith(prefix)),
    inputFiles.filter(file => !file.path.startsWith(prefix)), 'Only the declared framework may differ');
  await writeFile(join(destination, 'source-build.json'), JSON.stringify({
    ...receipt, outputFiles,
    inheritedApplicationReceiptSha256: digest(receiptBytes),
    runtimeOverrides: [{
      package: '@ibiz-template/vue3-components',
      sourceRoot: source, sourceFiles, outputFiles: runtimeFiles,
      dependencies: 'Existing local pinned dependencies; no package installation',
      sourceBuildOnly: true,
    }],
    sharedDistUnchanged: true, nativeAcceptance: false, deployed: false,
  }, null, 2), { flag: 'wx', mode: 0o600 });
  return destination;
}

export async function assemblePlmLoginCandidate({ candidate, runtime, output }) {
  const appRoot = await realpath(candidate);
  const runtimeRoot = await realpath(runtime);
  const destination = resolve(output);
  assert.equal(await realpath(dirname(destination)), join(workspace, '.artifacts'));
  const appBytes = await readFile(join(appRoot, 'source-build.json'));
  const runtimeBytes = await readFile(join(runtimeRoot, 'source-build.json'));
  const appReceipt = JSON.parse(appBytes);
  const runtimeReceipt = JSON.parse(runtimeBytes);
  assert.equal(appReceipt.sharedDistUnchanged, true);
  assert.deepEqual(await treeInventory(join(appRoot, 'dist')), appReceipt.outputFiles);
  const [override] = runtimeReceipt.runtimeOverrides;
  assert.equal(runtimeReceipt.runtimeOverrides.length, 1);
  assert.equal(override.package, '@ibiz-template/vue3-components');
  assert.equal(override.sourceBuildOnly, true);
  assert.deepEqual(await treeInventory(join(source, 'src')), override.sourceFiles);
  const compiled = join(runtimeRoot, 'workspace/components/ibiz-next-vue3/dist');
  assert.deepEqual(await treeInventory(compiled), override.outputFiles, 'Compiled runtime changed');
  await mkdir(destination, { mode: 0o700 });
  await cp(join(appRoot, 'dist'), join(destination, 'dist'), { recursive: true });
  await cp(compiled, join(destination, 'dist/extras/js/@ibiz-template/vue3-components'),
    { recursive: true, force: true });
  const outputFiles = await treeInventory(join(destination, 'dist'));
  const prefix = 'extras/js/@ibiz-template/vue3-components/';
  assert.deepEqual(outputFiles.filter(file => !file.path.startsWith(prefix)),
    appReceipt.outputFiles.filter(file => !file.path.startsWith(prefix)));
  assert.deepEqual(await treeInventory(join(appRoot, 'dist')), appReceipt.outputFiles);
  assert.deepEqual(await treeInventory(compiled), override.outputFiles);
  await writeFile(join(destination, 'source-build.json'), JSON.stringify({
    ...appReceipt, outputFiles, runtimeOverrides: [override],
    inheritedApplicationReceiptSha256: digest(appBytes),
    runtimeBuildReceiptSha256: digest(runtimeBytes),
    sharedDistUnchanged: true, nativeAcceptance: false, deployed: false,
  }, null, 2), { flag: 'wx', mode: 0o600 });
  return destination;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: {
    candidate: { type: 'string' }, output: { type: 'string' }, runtime: { type: 'string' },
  } });
  const run = values.runtime ? assemblePlmLoginCandidate : preparePlmLoginRuntime;
  run(values).then(output => console.log(`Prepared private candidate: ${output}`))
    .catch(error => { console.error(error); process.exitCode = 1; });
}
