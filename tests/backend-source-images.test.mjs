import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { inspectBackendArchive } from '../harness-backend-source-package.mjs';
import {
  BACKEND_IMAGES,
  PINNED_BACKEND_RUNTIME_IMAGE,
  backendImageBuildCommand,
  backendImageProbeCommand,
  backendImageRecipe,
  parseImageFileHashes,
  runBackendSourceImages,
  validateBackendImage,
  verifyBackendSourceImages,
} from '../harness-backend-source-images.mjs';

const hash = data => createHash('sha256').update(data).digest('hex');
const digest = value => `sha256:${value.repeat(64)}`;
const packageReceipt = { sha256: 'a'.repeat(64), sourceFingerprint: 'b'.repeat(64) };

test('backend image inventory is fixed to the three executable services', () => {
  assert.deepEqual(BACKEND_IMAGES.map(item => item.name), ['allinone', 'gateway', 'provider']);
  assert.deepEqual(BACKEND_IMAGES.map(item => item.archive), [
    'ibiz-ebsx-runtime/ibiz-ebsx-allinone-rt.jar',
    'ibiz-ebsx-gateway/ibiz-ebsx-gateway.jar',
    'ibiz-service-runner/ibizservicerunner-provider.jar',
  ]);
  assert.equal(PINNED_BACKEND_RUNTIME_IMAGE,
    'eclipse-temurin@sha256:bc033b57e11b773c3043babfd664e7a5ef110805548b921cbfc3e8c67a0725d6');
});

test('runtime recipes require the pinned JDK digest and preserve startup content', () => {
  const provider = 'ARG RUNTIME_IMAGE=eclipse-temurin:17-jdk\nFROM ${RUNTIME_IMAGE}\nCOPY app.jar /app.jar\n';
  const platform = 'FROM eclipse-temurin:17-jre\nCMD ["java", "-jar", "/app.jar"]\n';
  assert.match(backendImageRecipe(BACKEND_IMAGES[2], provider),
    /^ARG RUNTIME_IMAGE=eclipse-temurin:17-jdk\nFROM \$\{RUNTIME_IMAGE\}/);
  assert.equal(backendImageRecipe(BACKEND_IMAGES[0], platform),
    'ARG RUNTIME_IMAGE\nFROM ${RUNTIME_IMAGE}\nCMD ["java", "-jar", "/app.jar"]\n');
  assert.throws(() => backendImageRecipe(BACKEND_IMAGES[0], 'FROM ubuntu\n'), /runtime recipe changed/);
});

test('image build command is offline, platform-pinned and labeled with package/source receipts', () => {
  const command = backendImageBuildCommand({
    context: '/tmp/image-context',
    iidFile: '/tmp/image.iid',
    reference: 'aibiz/backend-source-provider:00000000-0000-0000-0000-000000000000',
    architecture: 'arm64',
    packageReceipt,
    spec: BACKEND_IMAGES[2],
  });
  assert.equal(command.executable, 'docker');
  for (const flag of ['build', '--pull=false', '--network=none', '--platform', 'linux/arm64']) {
    assert.ok(command.args.includes(flag));
  }
  assert.ok(command.args.includes(`RUNTIME_IMAGE=${PINNED_BACKEND_RUNTIME_IMAGE}`));
  assert.ok(command.args.includes(`io.aibiz.backend.package-report=${packageReceipt.sha256}`));
  assert.ok(command.args.includes(`io.aibiz.backend.source=${packageReceipt.sourceFingerprint}`));
  assert.ok(command.args.includes('io.aibiz.backend.component=provider'));
  assert.throws(() => backendImageBuildCommand({
    context: '/tmp/context', iidFile: '/tmp/other/image.iid',
    reference: 'aibiz/backend-source-provider:00000000-0000-0000-0000-000000000000',
    architecture: 'arm64', packageReceipt, spec: BACKEND_IMAGES[2],
  }), /beside context/);
});

test('image probe command and NUL-delimited hash parser bind exact files', () => {
  const files = ['/ibizservicerunner-provider.jar', '/wait-for.sh'];
  const command = backendImageProbeCommand({
    imageId: digest('c'), name: 'backend-image-probe-00000000-0000-0000-0000-000000000000-provider', files,
  });
  assert.deepEqual(command.args.slice(-2), files);
  const bytes = Buffer.from(`${hash('provider')} *${files[0]}\0${hash('wait')}  ${files[1]}\0`);
  assert.deepEqual(parseImageFileHashes(bytes, files), [
    { path: files[0], sha256: hash('provider') },
    { path: files[1], sha256: hash('wait') },
  ]);
  assert.throws(() => parseImageFileHashes(bytes.subarray(0, -1), files), /NUL/);
  assert.throws(() => parseImageFileHashes(bytes, [...files].reverse()), /inventory mismatch/);
});

function write(path, data) {
  fs.mkdirSync(dirname(path), { recursive: true });
  fs.writeFileSync(path, data);
}

function fixture(t) {
  const workspace = fs.mkdtempSync(join(tmpdir(), 'backend-image-contract-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const packagePath = join(workspace, '.artifacts/package/report.json');
  const worktree = join(workspace, '.artifacts/package/worktree');
  const archives = [];
  for (const spec of BACKEND_IMAGES) {
    const path = join(worktree, spec.archive);
    fs.mkdirSync(dirname(path), { recursive: true });
    const zip = spawnSync('python3', ['-I', '-c', String.raw`
import sys, zipfile
with zipfile.ZipFile(sys.argv[1], "w") as archive:
    archive.writestr("META-INF/MANIFEST.MF", "Manifest-Version: 1.0\r\n\r\n")
    archive.writestr("fixture.txt", "SYNTHETIC PACKAGE ONLY; NO COMPILER")
`, path], { encoding: 'utf8' });
    assert.equal(zip.status, 0, zip.stderr);
    archives.push({ path: spec.archive, ...inspectBackendArchive(path) });
    if (spec.name !== 'provider') {
      write(join(worktree, spec.recipe),
        `FROM eclipse-temurin:17-jre\nCOPY ${basename(spec.archive)} /${basename(spec.archive)}\nEXPOSE ${spec.port.split('/')[0]}\n`);
    }
  }
  write(join(workspace, 'modelingservice/Dockerfile'),
    'ARG RUNTIME_IMAGE=eclipse-temurin:17-jdk\nFROM ${RUNTIME_IMAGE}\nCOPY app.jar /app.jar\n');
  for (const name of ['wait-for.sh', 'entrypoint-waitfor.sh']) {
    write(join(workspace, 'modelingservice/docker', name), '#!/bin/sh\n# Synthetic test fixture only.\n');
  }
  const report = {
    status: 'passed-package-and-unit-only', sourcePackageVerified: true,
    nativeAcceptance: false, sourceClosure: false, acceptedForProduction: false,
    worktree, sourceInputs: { before: { fingerprint: 'b'.repeat(64) } }, packages: { archives },
  };
  write(packagePath, JSON.stringify(report));
  let packageFailure = null;
  const verifyPackage = () => {
    if (packageFailure) throw new Error(packageFailure);
    return {
      reportPath: packagePath, reportSha256: hash(fs.readFileSync(packagePath)), report,
      sourcePackageVerified: true, nativeAcceptance: false, sourceClosure: false, acceptedForProduction: false,
    };
  };
  const baseLayers = [digest('e')];
  const base = {
    Id: digest('1'), Os: 'linux', Architecture: 'arm64',
    RepoDigests: [PINNED_BACKEND_RUNTIME_IMAGE], Config: {}, RootFS: { Layers: baseLayers },
  };
  const images = new Map();
  const commands = [];
  const output = join(workspace, '.artifacts/images');
  let onCommand = () => {};
  const execute = (executable, args, options) => {
    commands.push({ executable, args });
    assert.equal(executable, 'docker', 'Fixture never runs Docker or Java');
    const overridden = onCommand(args, options);
    if (overridden) return overridden;
    const emit = data => {
      if (options.stdio) fs.writeSync(options.stdio[1], data);
      return { status: 0, signal: null, stdout: data };
    };
    if (args[0] === 'build') {
      const context = args.at(-1);
      const reference = args[args.indexOf('--tag') + 1];
      const spec = BACKEND_IMAGES.find(item => reference.startsWith(`aibiz/backend-source-${item.name}:`));
      const labels = {};
      for (const [index, arg] of args.entries()) {
        if (arg !== '--label') continue;
        const value = args[index + 1];
        const split = value.indexOf('=');
        labels[value.slice(0, split)] = value.slice(split + 1);
      }
      const imageId = `sha256:${hash(reference)}`;
      write(args[args.indexOf('--iidfile') + 1], `${imageId}\n`);
      const files = new Map();
      files.set(`/${basename(spec.archive)}`, hash(fs.readFileSync(join(context, basename(spec.archive)))));
      if (spec.name === 'provider') {
        for (const name of ['wait-for.sh', 'entrypoint-waitfor.sh']) {
          files.set(`/${name}`, hash(fs.readFileSync(join(context, 'docker', name))));
        }
      }
      const image = {
        Id: imageId, Os: 'linux', Architecture: 'arm64',
        Config: { Labels: labels, ExposedPorts: { [spec.port]: {} } },
        RootFS: { Layers: [...baseLayers, `sha256:${hash(context)}`] },
      };
      const record = { image, files };
      images.set(reference, record);
      images.set(imageId, record);
      return emit('CONTROLLED FIXTURE; NO DOCKER BUILD EXECUTED\n');
    }
    if (args[0] === 'image') {
      return emit(JSON.stringify(args.at(-1) === PINNED_BACKEND_RUNTIME_IMAGE
        ? base : images.get(args.at(-1)).image));
    }
    if (args[0] === 'run') {
      const imageId = args[args.indexOf('--zero') - 1];
      const files = args.slice(args.indexOf('--') + 1);
      return emit(files.map(path => `${images.get(imageId).files.get(path)}  ${path}\0`).join(''));
    }
    if (args[0] === 'rm') return emit('');
    throw new Error(`Unexpected fixture command: ${args[0]}`);
  };
  const options = { workspace, output, packageReport: packagePath, verifyPackage, execute };
  return {
    workspace, output, packagePath, worktree, images, base, commands, options,
    run: () => runBackendSourceImages(options),
    verify: reportPath => verifyBackendSourceImages({ ...options, reportPath }),
    command: callback => { onCommand = callback; },
    rejectPackage: reason => { packageFailure = reason; },
  };
}

function editReport(path, callback) {
  const report = JSON.parse(fs.readFileSync(path, 'utf8'));
  callback(report);
  write(path, JSON.stringify(report));
}

test('controlled integrated image run and live replay verify all three candidates without native promotion', t => {
  const f = fixture(t);
  const result = f.run();
  assert.equal(result.report.status, 'passed-image-artifact-binding-only', result.report.errors.join('\n'));
  assert.equal(result.report.components.length, 3);
  assert.equal(result.report.commands.length, 10);
  for (const key of ['nativeAcceptance', 'sourceClosure', 'acceptedForProduction']) assert.equal(result.report[key], false);
  const verified = f.verify(result.reportPath);
  assert.equal(verified.imageArtifactBindingVerified, true);
  assert.equal(verified.reportSha256, hash(fs.readFileSync(result.reportPath)));
  assert.equal(f.commands.filter(command => command.args[0] === 'run').length, 6);
  for (const command of f.commands.filter(command => command.args[0] === 'run')) {
    for (const flag of ['--network=none', '--read-only', '--pull=never', '--cap-drop=ALL', '--user']) {
      assert.ok(command.args.includes(flag));
    }
    assert.equal(command.args.some(arg => arg.startsWith('--mount') || arg.startsWith('--publish')), false);
  }
});

for (const [name, mutate, pattern] of [
  ['native promotion', report => { report.nativeAcceptance = true; }, /strictly equal/],
  ['source closure promotion', report => { report.sourceClosure = true; }, /strictly equal/],
  ['production promotion', report => { report.acceptedForProduction = true; }, /strictly equal/],
  ['missing component', report => { report.components.pop(); }, /inventory mismatch/],
  ['forged package binding', report => { report.packageReceipt.sha256 = '0'.repeat(64); }, /Package receipt mismatch/],
  ['forged context', report => { report.components[0].inventory.entries[0].sha256 = '0'.repeat(64); }, /context drift/],
  ['forged command', report => { report.commands[1].args.push('--network=host'); }, /command receipt mismatch/],
  ['forged command exit', report => { report.commands[1].exitCode = 1; }, /Failed image command/],
  ['forged log hash', report => { report.commands[1].log.sha256 = '0'.repeat(64); }, /log drift/],
  ['mutable image ID', report => { report.components[0].image.id = 'latest'; }, /strictly deep-equal/],
]) {
  test(`image receipt fails closed for ${name}`, t => {
    const f = fixture(t);
    const result = f.run();
    assert.equal(result.report.imageArtifactBindingVerified, true, result.report.errors.join('\n'));
    editReport(result.reportPath, mutate);
    assert.throws(() => f.verify(result.reportPath), pattern);
  });
}

for (const [name, mutate, pattern] of [
  ['tag moved to other image', record => { record.image.Id = digest('0'); }, /Built image ID mismatch/],
  ['JAR bytes differ', record => { record.files.set('/ibiz-ebsx-allinone-rt.jar', '0'.repeat(64)); }, /Live candidate files mismatch/],
  ['runtime base layers differ', record => { record.image.RootFS.Layers[0] = digest('0'); }, /runtime base layers mismatch/],
]) {
  test(`independent replay rejects ${name}`, t => {
    const f = fixture(t);
    const result = f.run();
    const component = result.report.components[0];
    mutate(f.images.get(component.reference));
    assert.throws(() => f.verify(result.reportPath), pattern);
  });
}

test('package input failure occurs before Docker invocation or output creation', t => {
  const f = fixture(t);
  f.rejectPackage('Current editable source drift');
  assert.throws(() => f.run(), /source drift/);
  assert.equal(f.commands.length, 0);
  assert.equal(fs.existsSync(f.output), false);
});

test('existing artifact output is not overwritten', t => {
  const f = fixture(t);
  write(join(f.output, 'sentinel'), 'keep');
  assert.throws(() => f.run(), /must not be overwritten/);
  assert.equal(fs.readFileSync(join(f.output, 'sentinel'), 'utf8'), 'keep');
  assert.equal(f.commands.length, 0);
});

test('failed image build preserves failed receipt and does not probe a candidate', t => {
  const f = fixture(t);
  f.command(args => args[0] === 'build' ? { status: 1, signal: null } : undefined);
  const result = f.run();
  assert.equal(result.report.status, 'failed');
  assert.equal(result.report.imageArtifactBindingVerified, false);
  assert.match(result.report.errors.join('\n'), /Command failed/);
  assert.equal(f.commands.some(command => command.args[0] === 'run'), false);
  assert.throws(() => f.verify(result.reportPath));
});

test('runtime scripts, context files and logs are independently rechecked', t => {
  const f = fixture(t);
  const result = f.run();
  const script = join(f.workspace, 'modelingservice/docker/wait-for.sh');
  const original = fs.readFileSync(script);
  write(script, 'drift\n');
  assert.throws(() => f.verify(result.reportPath), /recipe inputs changed/);
  write(script, original);
  write(join(result.report.components[0].context, 'unexpected'), 'extra');
  assert.throws(() => f.verify(result.reportPath), /Unexpected context file/);
});

test('CLI help is available without Docker or source receipts', () => {
  const harness = fileURLToPath(new URL('../harness-backend-source-images.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [harness, '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /--package-report/);
  assert.match(result.stdout, /--verify/);
});

test('image identity validation rejects wrong source labels, base layers and ports', () => {
  const spec = BACKEND_IMAGES[2];
  const imageId = digest('d');
  const baseLayers = [digest('e')];
  const image = {
    Id: imageId, Os: 'linux', Architecture: 'arm64',
    Config: {
      Labels: {
        'io.aibiz.backend.package-report': packageReceipt.sha256,
        'io.aibiz.backend.source': packageReceipt.sourceFingerprint,
        'io.aibiz.backend.component': spec.name,
      },
      Volumes: {},
      ExposedPorts: { [spec.port]: {} },
    },
    RootFS: { Layers: [...baseLayers, digest('f')] },
  };
  assert.deepEqual(validateBackendImage(image, {
    spec, imageId, architecture: 'arm64', packageReceipt, baseLayers,
  }), { id: imageId, os: 'linux', architecture: 'arm64', layers: image.RootFS.Layers });
  for (const mutate of [
    value => { value.Config.Labels['io.aibiz.backend.source'] = '0'.repeat(64); },
    value => { value.Config.ExposedPorts = { '9999/tcp': {} }; },
    value => { value.RootFS.Layers = [digest('f')]; },
  ]) {
    const copy = structuredClone(image);
    mutate(copy);
    assert.throws(() => validateBackendImage(copy, {
      spec, imageId, architecture: 'arm64', packageReceipt, baseLayers,
    }));
  }
});
