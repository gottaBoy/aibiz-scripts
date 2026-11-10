#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { PinnedDirectories, readPinnedFile } from './native-candidate-files.mjs';
import { rewriteCentralMemberSessionBinding } from './prepare-native-service-candidate.mjs';

const workspaceDefault = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const contractPath = 'scripts/fixtures/native-service-migration-contract.json';
const probePath = 'scripts/fixtures/CentralMemberBindingSqlProbe.java';
const hash = value => createHash('sha256').update(value).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
export const centralBindingDependencies = [
  'ibiz-model-8.1.0.584.1.jar', 'h2-1.4.200.jar',
  'jackson-annotations-2.11.3.jar', 'jackson-core-2.11.3.jar',
  'jackson-databind-2.11.3.jar', 'commons-io-2.11.0.jar',
  'spring-core-5.3.1.jar', 'spring-jcl-5.3.1.jar',
];
const entityPaths = [
  'SysDesign/PSDevSln', 'SysDesign/PSDevSlnUser', 'DevCenter/PSDevUser',
  'DevCenter/PSDevUserObj', 'DevCenter/PSDevCenter', 'DevCenter/PSDCDeployCenter',
].map(value => {
  const [module, entity] = value.split('/');
  return `PSMODULES/${module}/PSDATAENTITIES/${entity}.json`;
});

export function centralMemberBindingInput({ workspace = workspaceDefault } = {}) {
  workspace = resolve(workspace);
  const directories = new PinnedDirectories();
  const bindings = [];
  const read = path => {
    const file = readPinnedFile(directories, directories.open(dirname(path)), path.split('/').at(-1));
    bindings.push({ path: relative(workspace, path), sha256: hash(file.data), bytes: file.data.length });
    return JSON.parse(file.data);
  };
  try {
    const contract = read(join(workspace, contractPath));
    assert.equal(contract.memberBinding.contract, 'native-central-member-session-binding-candidate');
    assert.equal(contract.permissionAcceptance.rowIsolationVerified, false);
    const root = resolve(workspace, contract.sourceModelRoot);
    assert.ok(root.startsWith(`${workspace}/vendor-upstream/ibizmodeling-standard/`));
    const documents = {};
    for (const [key, entry] of Object.entries({ ...contract.files, ...contract.memberBinding.files })) {
      documents[key] = read(join(root, entry.path));
      assert.equal(bindings.at(-1).sha256, entry.sha256, 'Pinned native Central source drift');
    }
    const changed = rewriteCentralMemberSessionBinding(documents);
    const entities = entityPaths.map(path => ({ path, model: read(join(root, path)) }));
    const original = Object.fromEntries(['backendEntity', 'centerAdminSQL', 'schemeAdminSQL', 'memberSQL']
      .map(key => [key, documents[key]]));
    const candidate = { ...original, backendEntity: changed.backendEntity, memberSQL: changed.memberSQL };
    assert.deepEqual(candidate.centerAdminSQL, original.centerAdminSQL);
    assert.deepEqual(candidate.schemeAdminSQL, original.schemeAdminSQL);
    return { bindings, document: {
      contract: 'central-member-binding-native-model-sql-input-v1', original, candidate, entities,
    } };
  } finally { directories.close(); }
}

export function verifyCentralProbeContainer(container, expected) {
  assert.equal(container.Id, expected.id);
  assert.equal(container.Name, `/${expected.name}`);
  assert.equal(container.Image, expected.imageId);
  assert.equal(container.Config?.Labels?.['aibiz.central-member-sql.nonce'], expected.nonce);
  assert.equal(container.Config?.User, expected.user);
  assert.equal(container.HostConfig?.NetworkMode, 'none');
  assert.equal(container.HostConfig?.ReadonlyRootfs, true);
  assert.equal(container.HostConfig?.Privileged, false);
  assert.deepEqual(container.HostConfig?.CapDrop, ['ALL']);
  assert.deepEqual(container.HostConfig?.SecurityOpt, ['no-new-privileges']);
  assert.ok(Object.keys(container.NetworkSettings?.Networks ?? {}).every(name => name === 'none'));
  assert.ok(container.Mounts.length === 3 && container.Mounts.every(mount =>
    mount.Type === 'bind' && mount.RW === false
    && expected.mounts.some(([source, target]) => mount.Source === source && mount.Destination === target)));
}

export async function executeCentralMemberBindingSql({
  workspace = workspaceDefault, label, dependencies, compilerImage,
}, { execute = spawnSync } = {}) {
  assert.match(label ?? '', /^[a-z0-9][a-z0-9-]{0,63}$/);
  assert.match(compilerImage ?? '', /^sha256:[a-f0-9]{64}$/);
  assert.equal(typeof dependencies, 'string', 'Explicit local dependency directory is required');
  workspace = resolve(workspace);
  const dependencyRoot = resolve(workspace, dependencies);
  assert.ok(dependencyRoot.startsWith(`${workspace}/.artifacts/`));
  const input = centralMemberBindingInput({ workspace });
  const directories = new PinnedDirectories();
  const output = join(workspace, '.artifacts/central-member-binding-sql', label);
  let target;
  let container;
  const report = {
    contract: 'offline-central-member-binding-native-model-sql-v1', label,
    status: 'running', startedAt: new Date().toISOString(), inputs: input.bindings,
    nativeAcceptance: false, permissionAcceptance: false, productionAcceptance: false,
    compilerImageId: compilerImage, compilerRelease: 17,
    sqlEngine: 'H2 1.4.200 in-memory MODE=MySQL',
    network: 'none', existingRuntimeMutated: false, dependencies: [], cleanup: 'not-created',
  };
  const docker = (args, { allowFailure = false } = {}) => {
    const result = execute('docker', args, {
      encoding: 'utf8', timeout: 180_000, maxBuffer: 8 * 1024 * 1024,
    });
    if (!allowFailure) assert.ok(result.status === 0 && !result.error && !result.signal,
      'Isolated Central SQL probe Docker operation failed; see retained evidence');
    return result;
  };
  const read = path => readPinnedFile(directories, directories.open(dirname(path)), path.split('/').at(-1)).data;
  try {
    target = directories.open(output, { create: true, exclusive: true });
    const source = read(join(workspace, probePath));
    report.probe = { path: probePath, sha256: hash(source) };
    report.generator = { path: 'scripts/harness-central-member-binding-sql.mjs',
      sha256: hash(read(fileURLToPath(import.meta.url))) };
    for (const name of centralBindingDependencies) {
      const bytes = read(join(dependencyRoot, name));
      report.dependencies.push({ path: relative(workspace, join(dependencyRoot, name)),
        sha256: hash(bytes), bytes: bytes.length });
    }
    const inputBytes = json(input.document);
    directories.write(target, 'input.json', inputBytes);
    report.inputBinding = { path: relative(workspace, join(output, 'input.json')), sha256: hash(inputBytes) };
    const image = JSON.parse(docker(['image', 'inspect', compilerImage]).stdout)[0];
    assert.equal(image.Id, compilerImage);
    assert.equal(image.Os, 'linux');
    const nonce = randomUUID();
    const name = `central-member-sql-${nonce}`;
    const user = `${process.getuid()}:${process.getgid()}`;
    const mounts = [
      [join(workspace, probePath), '/source/CentralMemberBindingSqlProbe.java'],
      [dependencyRoot, '/dependencies'], [output, '/input'],
    ];
    const classpath = centralBindingDependencies.map(name => `/dependencies/${name}`).join(':');
    const created = docker(['create', '--pull=never', '--name', name,
      '--network=none', '--read-only', '--user', user, '--cap-drop=ALL',
      '--security-opt=no-new-privileges', '--pids-limit=128', '--memory=1g', '--cpus=1',
      '--tmpfs=/tmp:rw,nosuid,nodev,size=268435456',
      '--label', `aibiz.central-member-sql.nonce=${nonce}`,
      ...mounts.flatMap(([source, target]) => ['--mount', `type=bind,source=${source},target=${target},readonly`]),
      compilerImage, 'java', '--source', '17', '-cp', classpath,
      '/source/CentralMemberBindingSqlProbe.java', '/input/input.json']);
    const id = created.stdout.trim();
    assert.match(id, /^[a-f0-9]{64}$/);
    container = { id, name, user, imageId: compilerImage, nonce, mounts };
    directories.write(target, 'container.json', json(container));
    verifyCentralProbeContainer(JSON.parse(docker(['inspect', id]).stdout)[0], container);
    const result = docker(['start', '--attach', id], { allowFailure: true });
    directories.write(target, 'stdout.log', result.stdout ?? '');
    directories.write(target, 'stderr.log', result.stderr ?? '');
    report.process = { status: result.status, signal: result.signal, error: result.error?.message };
    assert.ok(result.status === 0 && !result.signal && !result.error, 'Native model SQL probe did not pass');
    const actual = JSON.parse(result.stdout.trim());
    assert.equal(actual.contract, 'central-member-binding-native-model-sql-result-v1');
    assert.equal(actual.status, 'passed-offline-native-model-sql-only');
    assert.equal(actual.baselineRestored, true);
    assert.ok(actual.checks.length >= 30 && actual.checks.every(check => check.passed === true));
    report.result = actual;
    assert.deepEqual(centralMemberBindingInput({ workspace }).bindings, input.bindings, 'Source changed during isolated probe');
    for (const binding of report.dependencies) {
      assert.equal(hash(read(join(workspace, binding.path))), binding.sha256, 'Probe dependency drift');
    }
    assert.equal(hash(read(join(workspace, probePath))), report.probe.sha256, 'Probe source drift');
    assert.equal(hash(read(fileURLToPath(import.meta.url))), report.generator.sha256, 'Probe generator drift');
    report.status = 'passed-offline-native-model-sql-only';
  } catch (error) {
    report.status = 'failed';
    report.error = { name: error.name, message: error.message, stack: error.stack };
  } finally {
    if (container) {
      try {
        const current = JSON.parse(docker(['inspect', container.id]).stdout)[0];
        verifyCentralProbeContainer(current, container);
        docker(['rm', '--force', container.id]);
        report.cleanup = 'exact-isolated-container-removed';
      } catch (error) {
        report.cleanup = 'refused-or-failed';
        report.cleanupError = String(error);
        report.status = 'failed';
      }
    }
    report.finishedAt = new Date().toISOString();
    if (target) directories.write(target, 'report.json', json(report), 0o644);
    directories.close();
  }
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: {
    label: { type: 'string' }, dependencies: { type: 'string' }, 'compiler-image': { type: 'string' },
  }, strict: true, allowPositionals: false });
  const result = await executeCentralMemberBindingSql({
    label: values.label, dependencies: values.dependencies, compilerImage: values['compiler-image'],
  });
  console.log(json({ status: result.status, cleanup: result.cleanup, checks: result.result?.checks.length,
    nativeAcceptance: false, permissionAcceptance: false }));
  if (result.status !== 'passed-offline-native-model-sql-only') process.exitCode = 1;
}
