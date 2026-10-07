#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { fingerprint, PinnedDirectories, readPinnedFile } from './native-candidate-files.mjs';
import { inspectBackendArchive, verifyBackendSourcePackage } from './harness-backend-source-package.mjs';

const defaultWorkspace = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const contract = 'isolated-backend-source-images-v1';
const hash = data => createHash('sha256').update(data).digest('hex');
const successful = command => command?.exitCode === 0 && command.signal === null && command.error === null;
export const PINNED_BACKEND_RUNTIME_IMAGE =
  'eclipse-temurin@sha256:bc033b57e11b773c3043babfd664e7a5ef110805548b921cbfc3e8c67a0725d6';
export const BACKEND_IMAGES = Object.freeze([
  Object.freeze({ name: 'allinone', archive: 'ibiz-ebsx-runtime/ibiz-ebsx-allinone-rt.jar',
    recipe: 'ibiz-ebsx-runtime/src/main/docker/Dockerfile', port: '20000/tcp' }),
  Object.freeze({ name: 'gateway', archive: 'ibiz-ebsx-gateway/ibiz-ebsx-gateway.jar',
    recipe: 'ibiz-ebsx-gateway/src/main/docker/Dockerfile', port: '20086/tcp' }),
  Object.freeze({ name: 'provider', archive: 'ibiz-service-runner/ibizservicerunner-provider.jar',
    recipe: 'modelingservice/Dockerfile', port: '32002/tcp' }),
]);
const providerScripts = ['docker/wait-for.sh', 'docker/entrypoint-waitfor.sh'];

function childOf(parent, path) {
  assert.equal(typeof path, 'string', 'Required path missing');
  const absolute = resolve(parent, path);
  const child = relative(parent, absolute);
  assert.ok(child && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child),
    'Path must be inside its required root');
  return absolute;
}

function read(path) {
  const directories = new PinnedDirectories();
  try { return readPinnedFile(directories, directories.open(dirname(path)), basename(path)).data; }
  finally { directories.close(); }
}

function packageSummary(verified) {
  assert.equal(verified.sourcePackageVerified, true, 'Source package not verified');
  assert.equal(verified.report.status, 'passed-package-and-unit-only');
  assert.match(verified.reportSha256, /^[a-f0-9]{64}$/);
  for (const key of ['nativeAcceptance', 'sourceClosure', 'acceptedForProduction']) {
    assert.equal(verified[key], false, 'Package evidence must not claim native/closure acceptance');
    assert.equal(verified.report[key], false);
  }
  return { path: verified.reportPath, sha256: verified.reportSha256,
    sourceFingerprint: verified.report.sourceInputs.before.fingerprint };
}

export function backendImageRecipe(spec, source) {
  assert.ok(BACKEND_IMAGES.includes(spec), 'Unknown backend component');
  if (spec.name === 'provider') {
    assert.ok(source.startsWith('ARG RUNTIME_IMAGE=eclipse-temurin:17-jdk\nFROM ${RUNTIME_IMAGE}\n'),
      'Provider runtime recipe changed; review before pinning');
    return source;
  }
  assert.ok(source.startsWith('FROM eclipse-temurin:17-jre\n'),
    'Platform runtime recipe changed; review before pinning');
  return source.replace('FROM eclipse-temurin:17-jre\n', 'ARG RUNTIME_IMAGE\nFROM ${RUNTIME_IMAGE}\n');
}

function recipeFiles(workspace, packageReport, spec) {
  const source = spec.name === 'provider' ? workspace : packageReport.worktree;
  const original = read(join(source, spec.recipe));
  const files = [{ path: 'Dockerfile', data: Buffer.from(backendImageRecipe(spec, original.toString('utf8'))) }];
  const inputs = [{ path: spec.recipe, bytes: original.length, sha256: hash(original) }];
  if (spec.name === 'provider') {
    for (const path of providerScripts) {
      const data = read(join(workspace, 'modelingservice', path));
      inputs.push({ path: `modelingservice/${path}`, bytes: data.length, sha256: hash(data) });
      files.push({ path, data });
    }
  }
  return { inputs: inputs.sort((a, b) => a.path.localeCompare(b.path)),
    files: files.map(({ path, data }) => ({ path, data, bytes: data.length, sha256: hash(data) }))
      .sort((a, b) => a.path.localeCompare(b.path)) };
}

function copyArchive(directories, from, destination, name) {
  const source = directories.open(dirname(from));
  const path = directories.entry(source, basename(from));
  const before = fs.lstatSync(path);
  assert.ok(before.isFile() && !before.isSymbolicLink(), 'Nonregular source archive rejected');
  const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  const signature = info => [info.dev, info.ino, info.size, info.mtimeMs, info.ctimeMs];
  try {
    assert.deepEqual(signature(fs.fstatSync(fd)), signature(before), 'Source archive changed while opening');
    directories.verify(destination);
    fs.copyFileSync(`/proc/self/fd/${fd}`, directories.entry(destination, name), fs.constants.COPYFILE_EXCL);
    assert.deepEqual(signature(fs.fstatSync(fd)), signature(before), 'Source archive changed during copy');
    assert.deepEqual(signature(fs.lstatSync(path)), signature(before), 'Source archive path changed during copy');
    directories.verify(source);
    directories.verify(destination);
  } finally { fs.closeSync(fd); }
}

function contextEntries(root, spec, python) {
  const directories = new PinnedDirectories();
  const entries = [];
  const expected = ['Dockerfile', basename(spec.archive), ...(spec.name === 'provider' ? providerScripts : [])]
    .sort((left, right) => left.localeCompare(right));
  function visit(directory, prefix = '') {
    for (const entry of fs.readdirSync(directory.access, { withFileTypes: true })) {
      const path = prefix ? `${prefix}/${entry.name}` : entry.name;
      assert.ok(!entry.isSymbolicLink(), 'Context symlink rejected');
      if (entry.isDirectory()) {
        assert.equal(path, 'docker', 'Unexpected context directory');
        visit(directories.open(join(directory.path, entry.name)), path);
      } else {
        assert.ok(expected.includes(path), 'Unexpected context file');
        const identity = path === basename(spec.archive)
          ? inspectBackendArchive(join(directory.path, entry.name), { python })
          : (() => {
            const data = readPinnedFile(directories, directory, entry.name).data;
            return { bytes: data.length, sha256: hash(data) };
          })();
        entries.push({ path, bytes: identity.bytes, sha256: identity.sha256 });
      }
    }
    directories.verify(directory);
  }
  try { visit(directories.open(root)); }
  finally { directories.close(); }
  entries.sort((a, b) => a.path.localeCompare(b.path));
  assert.deepEqual(entries.map(entry => entry.path), expected, 'Context inventory mismatch');
  return { ...fingerprint(entries), entries };
}

export function backendImageBuildCommand({ context, iidFile, reference, architecture, packageReceipt, spec }) {
  assert.ok(BACKEND_IMAGES.includes(spec));
  for (const path of [context, iidFile]) {
    assert.ok(typeof path === 'string' && isAbsolute(path) && !/[\r\n]/.test(path), 'Invalid build path');
  }
  assert.equal(dirname(iidFile), dirname(context), 'IID file must be beside context');
  assert.match(reference, new RegExp(`^aibiz/backend-source-${spec.name}:[a-f0-9-]{36}$`), 'Invalid candidate reference');
  assert.ok(['arm64', 'amd64'].includes(architecture), 'Unsupported runtime architecture');
  assert.match(packageReceipt.sha256, /^[a-f0-9]{64}$/);
  assert.match(packageReceipt.sourceFingerprint, /^[a-f0-9]{64}$/);
  return { executable: 'docker', args: [
    'build', '--pull=false', '--network=none', '--platform', `linux/${architecture}`,
    '--build-arg', `RUNTIME_IMAGE=${PINNED_BACKEND_RUNTIME_IMAGE}`,
    '--label', `io.aibiz.backend.package-report=${packageReceipt.sha256}`,
    '--label', `io.aibiz.backend.source=${packageReceipt.sourceFingerprint}`,
    '--label', `io.aibiz.backend.component=${spec.name}`,
    '--tag', reference, '--iidfile', iidFile, context,
  ] };
}

export function backendImageProbeCommand({ imageId, name, files }) {
  assert.match(imageId, /^sha256:[a-f0-9]{64}$/, 'Image probe must use immutable ID');
  assert.match(name, /^backend-image-probe-[a-f0-9-]{36}-(allinone|gateway|provider)$/);
  assert.ok(Array.isArray(files) && files.length > 0);
  assert.ok(files.every(path => /^\/(?:[\w.-]+)$/.test(path)), 'Invalid image file path');
  assert.equal(new Set(files).size, files.length, 'Duplicate image file path');
  return { executable: 'docker', args: [
    'run', '--rm', '--pull=never', '--network=none', '--read-only', '--cap-drop=ALL',
    '--security-opt=no-new-privileges', '--user', '65534:65534', '--name', name,
    '--entrypoint', '/usr/bin/sha256sum', imageId, '--zero', '--', ...files,
  ] };
}

export function parseImageFileHashes(data, files) {
  const text = Buffer.isBuffer(data) ? data.toString('utf8') : data;
  assert.ok(typeof text === 'string' && text.endsWith('\0'), 'Missing complete NUL-delimited image hashes');
  const rows = text.slice(0, -1).split('\0').map(row => {
    const match = /^([a-f0-9]{64}) [ *](\/[\w.-]+)$/.exec(row);
    assert.ok(match, 'Malformed image hash output');
    return { path: match[2], sha256: match[1] };
  });
  assert.deepEqual(rows.map(row => row.path), files, 'Image file inventory mismatch');
  return rows;
}

function inspectionCommand(reference) {
  return { executable: 'docker', args: ['image', 'inspect', '--format', '{{json .}}', reference] };
}

function baseIdentity(data) {
  const image = JSON.parse(data);
  assert.match(image.Id, /^sha256:[a-f0-9]{64}$/);
  assert.equal(image.Os, 'linux');
  assert.ok(['arm64', 'amd64'].includes(image.Architecture));
  assert.ok(image.RepoDigests?.includes(PINNED_BACKEND_RUNTIME_IMAGE), 'Runtime base digest mismatch');
  assert.deepEqual(Object.keys(image.Config.Volumes ?? {}), [], 'Runtime base must not create volumes');
  return { reference: PINNED_BACKEND_RUNTIME_IMAGE, id: image.Id, os: image.Os, architecture: image.Architecture };
}

export function validateBackendImage(data, { spec, imageId, architecture, packageReceipt, baseLayers }) {
  const image = typeof data === 'string' || Buffer.isBuffer(data) ? JSON.parse(data) : data;
  assert.equal(image.Id, imageId, 'Built image ID mismatch');
  assert.equal(image.Os, 'linux');
  assert.equal(image.Architecture, architecture, 'Built image architecture mismatch');
  assert.equal(image.Config.Labels?.['io.aibiz.backend.package-report'], packageReceipt.sha256, 'Package label mismatch');
  assert.equal(image.Config.Labels?.['io.aibiz.backend.source'], packageReceipt.sourceFingerprint, 'Source label mismatch');
  assert.equal(image.Config.Labels?.['io.aibiz.backend.component'], spec.name, 'Component label mismatch');
  assert.deepEqual(Object.keys(image.Config.Volumes ?? {}), [], 'Candidate must not create implicit volumes');
  assert.deepEqual(Object.keys(image.Config.ExposedPorts ?? {}), [spec.port], 'Candidate exposed ports mismatch');
  assert.ok(Array.isArray(baseLayers) && baseLayers.length > 0 &&
    baseLayers.every(layer => /^sha256:[a-f0-9]{64}$/.test(layer)), 'Missing runtime base layers');
  assert.ok(image.RootFS?.Layers?.length > baseLayers.length, 'Candidate lacks application layers');
  assert.deepEqual(image.RootFS.Layers.slice(0, baseLayers.length), baseLayers, 'Candidate runtime base layers mismatch');
  return { id: image.Id, os: image.Os, architecture: image.Architecture, layers: image.RootFS.Layers };
}

function runCommand(directories, destination, path, command, execute, timeout = 120_000) {
  directories.verify(destination);
  const fd = fs.openSync(directories.entry(destination, path),
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  let result;
  try {
    result = execute(command.executable, command.args, {
      stdio: ['ignore', fd, fd], timeout, env: { ...process.env, LC_ALL: 'C' },
    });
  } catch (error) {
    fs.writeSync(fd, `${error.message}\n`);
    result = { status: null, error };
  } finally { fs.closeSync(fd); }
  const data = readPinnedFile(directories, destination, path).data;
  return { ...command, exitCode: result.status ?? null, signal: result.signal ?? null,
    error: result.error?.message ?? null, log: { path, bytes: data.length, sha256: hash(data) } };
}

function imageFiles(spec, context) {
  return context.entries.filter(entry => entry.path !== 'Dockerfile')
    .map(entry => ({ path: `/${basename(entry.path)}`, bytes: entry.bytes, sha256: entry.sha256 }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

export function runBackendSourceImages({
  workspace = defaultWorkspace, packageReport, output, python = 'python3', execute = spawnSync,
  verifyPackage = verifyBackendSourcePackage,
} = {}) {
  workspace = resolve(workspace);
  const packagePath = childOf(workspace, packageReport);
  const verified = verifyPackage({ workspace, reportPath: packagePath, python });
  const packageReceipt = packageSummary(verified);
  output = resolve(workspace, output ?? `.artifacts/backend-source-images-${randomUUID()}`);
  assert.equal(dirname(output), join(workspace, '.artifacts'), 'Output must be a new direct artifact directory');
  assert.match(basename(output), /^[A-Za-z0-9][A-Za-z0-9_.-]*$/);
  assert.notEqual(output, dirname(packagePath), 'Cannot overwrite package evidence');
  const runId = randomUUID();
  const report = {
    schemaVersion: 1, contract, workspace, output, runId, packageReceipt,
    status: 'failed', imageArtifactBindingVerified: false, nativeAcceptance: false,
    sourceClosure: false, acceptedForProduction: false, startedAt: new Date().toISOString(),
    base: null, baseLayers: null, components: [], commands: [], errors: [],
    limitations: [
      'Image byte identity only; no service startup, authentication, permissions, persistence or native business acceptance.',
      'Package receipts do not establish closure of all iBiz-owned Maven dependencies.',
      'No shared service is restarted and no deployment archive is overwritten.',
    ],
  };
  const directories = new PinnedDirectories();
  let destination;
  const run = (path, command, timeout) => {
    const result = runCommand(directories, destination, path, command, execute, timeout);
    report.commands.push(result);
    assert.ok(successful(result), `Command failed: ${path}`);
    return read(join(output, path));
  };
  try {
    destination = directories.open(output, { create: true, exclusive: true });
    const baseData = run('base-inspect.log', inspectionCommand(PINNED_BACKEND_RUNTIME_IMAGE), 10_000);
    report.base = baseIdentity(baseData);
    report.baseLayers = JSON.parse(baseData).RootFS?.Layers;
    for (const spec of BACKEND_IMAGES) {
      const archive = verified.report.packages.archives.find(item => item.path === spec.archive);
      assert.ok(archive, 'Required deployment archive missing');
      const recipe = recipeFiles(workspace, verified.report, spec);
      const context = join(output, `${spec.name}-context`);
      const directory = directories.open(context, { create: true, exclusive: true });
      for (const file of recipe.files) {
        directories.write(directories.open(dirname(join(context, file.path)), { create: true }), basename(file.path), file.data);
      }
      copyArchive(directories, join(verified.report.worktree, spec.archive), directory, basename(spec.archive));
      const inventory = contextEntries(context, spec, python);
      assert.deepEqual(inventory.entries.find(item => item.path === basename(spec.archive)),
        { path: basename(spec.archive), bytes: archive.bytes, sha256: archive.sha256 }, 'Context JAR differs from source package');
      const component = {
        name: spec.name, context, iidFile: join(output, `${spec.name}.iid`),
        reference: `aibiz/backend-source-${spec.name}:${runId}`, recipeInputs: recipe.inputs,
        inventory, image: null, imageFiles: imageFiles(spec, inventory),
        probeName: `backend-image-probe-${runId}-${spec.name}`,
      };
      report.components.push(component);
      run(`${spec.name}-build.log`, backendImageBuildCommand({
        ...component, architecture: report.base.architecture, packageReceipt, spec,
      }), 30 * 60_000);
      const imageId = read(component.iidFile).toString('utf8').trim();
      assert.match(imageId, /^sha256:[a-f0-9]{64}$/, 'Missing immutable build ID');
      component.image = validateBackendImage(run(`${spec.name}-inspect.log`, inspectionCommand(component.reference), 10_000),
        { spec, imageId, architecture: report.base.architecture, packageReceipt, baseLayers: report.baseLayers });
      const probe = backendImageProbeCommand({
        imageId, name: component.probeName, files: component.imageFiles.map(item => item.path),
      });
      const hashes = parseImageFileHashes(run(`${spec.name}-probe.log`, probe), probe.args.slice(probe.args.indexOf('--') + 1));
      assert.deepEqual(hashes, component.imageFiles.map(({ path, sha256 }) => ({ path, sha256 })), 'Image file hashes differ from context');
      assert.deepEqual(contextEntries(context, spec, python), inventory, 'Build context changed');
    }
  } catch (error) {
    if (!destination) throw error;
    report.errors.push(error.message);
    const failedProbe = report.commands.at(-1);
    if (failedProbe?.args[0] === 'run' && !successful(failedProbe)) {
      const name = failedProbe.args[failedProbe.args.indexOf('--name') + 1];
      report.commands.push(runCommand(directories, destination, 'failed-probe-cleanup.log',
        { executable: 'docker', args: ['rm', '--force', name] }, execute, 30_000));
    }
  } finally {
    if (destination) {
      try {
        assert.deepEqual(packageSummary(verifyPackage({ workspace, reportPath: packagePath, python })), packageReceipt,
          'Package receipt changed during image build');
        for (const component of report.components) {
          const spec = BACKEND_IMAGES.find(item => item.name === component.name);
          assert.deepEqual(recipeFiles(workspace, verified.report, spec).inputs, component.recipeInputs, 'Runtime recipe inputs changed');
        }
      } catch (error) { report.errors.push(error.message); }
      report.imageArtifactBindingVerified = report.errors.length === 0 && report.components.length === BACKEND_IMAGES.length;
      report.status = report.imageArtifactBindingVerified ? 'passed-image-artifact-binding-only' : 'failed';
      report.finishedAt = new Date().toISOString();
      try { directories.write(destination, 'report.json', `${JSON.stringify(report, null, 2)}\n`); }
      finally { directories.close(); }
    } else { directories.close(); }
  }
  return { report, reportPath: join(output, 'report.json') };
}

function currentInspection(command, execute) {
  const result = execute(command.executable, command.args, {
    encoding: 'utf8', timeout: 120_000, maxBuffer: 1024 * 1024, env: { ...process.env, LC_ALL: 'C' },
  });
  assert.ok(!result.error && result.status === 0 && !result.signal, 'Live Docker identity verification failed');
  return result.stdout;
}

export function verifyBackendSourceImages({
  workspace = defaultWorkspace, reportPath, python = 'python3', execute = spawnSync,
  verifyPackage = verifyBackendSourcePackage,
} = {}) {
  workspace = resolve(workspace);
  reportPath = childOf(workspace, reportPath);
  const data = read(reportPath);
  const report = JSON.parse(data);
  const output = dirname(reportPath);
  assert.equal(basename(reportPath), 'report.json');
  assert.equal(dirname(output), join(workspace, '.artifacts'));
  assert.equal(report.contract, contract);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.workspace, workspace);
  assert.equal(report.output, output);
  assert.match(report.runId, /^[a-f0-9-]{36}$/);
  assert.equal(report.status, 'passed-image-artifact-binding-only');
  assert.equal(report.imageArtifactBindingVerified, true);
  for (const key of ['nativeAcceptance', 'sourceClosure', 'acceptedForProduction']) assert.equal(report[key], false);
  assert.deepEqual(report.errors, []);
  const verified = verifyPackage({ workspace, reportPath: childOf(workspace, report.packageReceipt.path), python });
  assert.deepEqual(packageSummary(verified), report.packageReceipt, 'Package receipt mismatch');
  assert.deepEqual(report.components.map(item => item.name), BACKEND_IMAGES.map(item => item.name), 'Component inventory mismatch');
  const commands = [inspectionCommand(PINNED_BACKEND_RUNTIME_IMAGE)];
  const logs = ['base-inspect.log'];
  const baseData = read(join(output, logs[0]));
  assert.deepEqual(baseIdentity(baseData), report.base);
  assert.deepEqual(JSON.parse(baseData).RootFS.Layers, report.baseLayers);
  const liveBase = currentInspection(commands[0], execute);
  assert.deepEqual(baseIdentity(liveBase), report.base, 'Live base image identity changed');
  assert.deepEqual(JSON.parse(liveBase).RootFS.Layers, report.baseLayers, 'Live base layers changed');
  for (const [index, component] of report.components.entries()) {
    const spec = BACKEND_IMAGES[index];
    assert.equal(component.context, join(output, `${spec.name}-context`));
    assert.equal(component.iidFile, join(output, `${spec.name}.iid`));
    assert.equal(component.reference, `aibiz/backend-source-${spec.name}:${report.runId}`);
    assert.equal(component.probeName, `backend-image-probe-${report.runId}-${spec.name}`);
    const recipe = recipeFiles(workspace, verified.report, spec);
    assert.deepEqual(recipe.inputs, component.recipeInputs, 'Runtime recipe inputs changed');
    const inventory = contextEntries(component.context, spec, python);
    assert.deepEqual(inventory, component.inventory, 'Recorded context drift');
    for (const file of recipe.files) {
      assert.deepEqual(inventory.entries.find(item => item.path === file.path),
        { path: file.path, bytes: file.bytes, sha256: file.sha256 }, 'Context recipe drift');
    }
    const archive = verified.report.packages.archives.find(item => item.path === spec.archive);
    assert.ok(archive);
    assert.deepEqual(inventory.entries.find(item => item.path === basename(spec.archive)),
      { path: basename(spec.archive), bytes: archive.bytes, sha256: archive.sha256 }, 'Package/context JAR drift');
    assert.deepEqual(imageFiles(spec, inventory), component.imageFiles);
    const imageId = read(component.iidFile).toString('utf8').trim();
    const options = { spec, imageId, architecture: report.base.architecture,
      packageReceipt: report.packageReceipt, baseLayers: report.baseLayers };
    assert.deepEqual(validateBackendImage(read(join(output, `${spec.name}-inspect.log`)), options), component.image);
    const probe = backendImageProbeCommand({
      imageId, name: component.probeName, files: component.imageFiles.map(item => item.path),
    });
    commands.push(backendImageBuildCommand({ ...component, architecture: report.base.architecture,
      packageReceipt: report.packageReceipt, spec }), inspectionCommand(component.reference), probe);
    logs.push(`${spec.name}-build.log`, `${spec.name}-inspect.log`, `${spec.name}-probe.log`);
    const expected = component.imageFiles.map(({ path, sha256 }) => ({ path, sha256 }));
    assert.deepEqual(parseImageFileHashes(read(join(output, `${spec.name}-probe.log`)), probe.args.slice(probe.args.indexOf('--') + 1)),
      expected, 'Recorded image files mismatch');
    assert.deepEqual(validateBackendImage(currentInspection(inspectionCommand(component.reference), execute), options),
      component.image, 'Live candidate identity changed');
    assert.deepEqual(parseImageFileHashes(currentInspection(probe, execute), component.imageFiles.map(item => item.path)),
      expected, 'Live candidate files mismatch');
  }
  assert.deepEqual(report.commands.map(({ executable, args }) => ({ executable, args })), commands, 'Image command receipt mismatch');
  for (const [index, command] of report.commands.entries()) {
    assert.ok(successful(command), 'Failed image command cannot satisfy receipt');
    assert.equal(command.log.path, logs[index]);
    const bytes = read(join(output, logs[index]));
    assert.deepEqual(command.log, { path: logs[index], bytes: bytes.length, sha256: hash(bytes) }, 'Image log drift');
  }
  assert.deepEqual(packageSummary(verifyPackage({ workspace, reportPath: report.packageReceipt.path, python })),
    report.packageReceipt, 'Package drift during image verification');
  assert.deepEqual(read(reportPath), data, 'Image report changed during verification');
  return { reportPath, reportSha256: hash(data), report, imageArtifactBindingVerified: true,
    nativeAcceptance: false, sourceClosure: false, acceptedForProduction: false };
}

export function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({ args: argv, options: {
    workspace: { type: 'string' }, 'package-report': { type: 'string' }, output: { type: 'string' },
    python: { type: 'string' }, verify: { type: 'string' }, help: { type: 'boolean' },
  } });
  if (values.help) {
    console.log('Build: node scripts/harness-backend-source-images.mjs --package-report .artifacts/PACKAGE/report.json [--output .artifacts/NEW]\n' +
      'Replay: node scripts/harness-backend-source-images.mjs --verify .artifacts/IMAGES/report.json');
    return 0;
  }
  const options = { workspace: values.workspace, python: values.python };
  const result = values.verify
    ? verifyBackendSourceImages({ ...options, reportPath: values.verify })
    : runBackendSourceImages({ ...options, packageReport: values['package-report'], output: values.output });
  console.log(JSON.stringify({
    reportPath: result.reportPath, reportSha256: result.reportSha256 ?? hash(read(result.reportPath)),
    status: result.report.status, imageArtifactBindingVerified: result.report.imageArtifactBindingVerified,
    images: result.report.components.map(({ name, reference, image }) => ({ name, reference, image })),
    nativeAcceptance: false, sourceClosure: false, acceptedForProduction: false, errors: result.report.errors,
  }, null, 2));
  return result.report.imageArtifactBindingVerified ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
