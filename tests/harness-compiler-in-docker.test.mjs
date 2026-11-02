import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  collectCompilerInputs, DEFAULT_COMPILER_IMAGE, isLiveCompilerResult, main,
  runCompilerInDocker, verifyCompilerReceipt, verifyRecoveredUaaCompilerOutputs,
  isLiveRecoveredUaaCompilerReplay, recoveredUaaReplayFailureEvidence,
  verifyMaintainedUaaCompilerOutputs, isLiveMaintainedUaaCompilerReplay,
  maintainedUaaReplayFailureEvidence, MAINTAINED_UAA_BUILD_CONTRACT,
  MAINTAINED_UAA_OAUTH2_TESTS, verifyMaintainedOauth2Evidence,
} from '../harness-compiler-in-docker.mjs';
import {
  evaluateRequiredSourceGates, verifyRequiredRecoveredUaaEvidence,
} from '../harness-required-source-gates.mjs';
import { sourceBuildInputs } from '../source-build-identity.mjs';
import { REQUIRED_TESTS as focusedUaaTests } from '../../standalone-uaa/tools/receipt.mjs';

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const evidence = process.env.AIBIZ_COMPILER_TEST_REPORT_DIR
  ? resolve(process.env.AIBIZ_COMPILER_TEST_REPORT_DIR) : null;
const source = 'package demo; public final class Main { public static class Inner {} }\n';

function write(path, value) {
  fs.mkdirSync(dirname(path), { recursive: true });
  fs.writeFileSync(path, value);
}

function fixture(t, javaSource = source) {
  const base = evidence ? join(evidence, `case-${randomUUID()}`)
    : fs.mkdtempSync(join(tmpdir(), 'compiler-in-docker-test-'));
  const root = join(base, 'source');
  const output = join(base, 'run');
  write(join(root, 'src/demo/Main.java'), javaSource);
  write(join(root, 'README.txt'), 'Synthetic compiler mechanics only; not native or S06 evidence.\n');
  t.after(() => { if (!evidence) fs.rmSync(base, { recursive: true, force: true }); });
  return { root, output, base };
}

function assertFailed(result) {
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.status, 'failed', JSON.stringify(result.report.errors));
  assert.equal(result.report.compilerBuildInDockerVerified, false);
  assert.equal(result.report.nativeAcceptance, false);
  assert.equal(result.report.fullSourceClosureVerified, false);
  assert.equal(result.report.summary.skipped, 0);
  assert.ok(result.report.errors.length);
  assert.equal(isLiveCompilerResult(result), false);
  assert.equal(JSON.parse(fs.readFileSync(result.receiptPath)).status, 'failed');
  assert.equal(fs.existsSync(join(dirname(result.receiptPath), 'private')), false);
}

function delegate(command, args, options) {
  return spawnSync(command, args, options);
}

function tamperReceipt(result, change) {
  const report = JSON.parse(fs.readFileSync(result.receiptPath));
  change(report);
  const bytes = `${JSON.stringify(report, null, 2)}\n`;
  write(result.receiptPath, bytes);
  write(join(dirname(result.receiptPath), 'receipt.sha256'), `${hash(bytes)}\n`);
}

test('actual Docker compilation and fresh replay are live, but copies/booleans never authenticate', t => {
  const f = fixture(t);
  const result = runCompilerInDocker({ root: f.root, output: f.output });
  assert.equal(result.exitCode, 0, JSON.stringify(result.report.errors));
  assert.equal(result.report.status, 'passed');
  assert.equal(result.report.nativeAcceptance, false);
  assert.equal(result.report.fullSourceClosureVerified, false);
  assert.equal(result.report.summary.skipped, 0);
  assert.match(result.report.compiler.version, /^javac 17/);
  assert.match(result.report.compiler.imageId, /^sha256:[a-f0-9]{64}$/);
  assert.match(result.report.compiler.javacSha256, /^[a-f0-9]{64}$/);
  assert.match(result.report.compiler.jdkModulesSha256, /^[a-f0-9]{64}$/);
  assert.equal(result.report.compiler.sourceFiles, 1);
  assert.equal(result.report.compiler.manifestClasspath.status, 'pass');
  assert.deepEqual(result.report.compiler.manifestClasspath.rejectedJars, []);
  assert.equal(result.report.output.files, 2);
  assert.equal(result.report.controls.positive, 'pass');
  assert.equal(result.report.controls.negative, 'pass');
  assert.equal(result.report.cleanup.containerRemoved, true);
  assert.equal(isLiveCompilerResult(result, {
    root: f.root, inputFingerprint: collectCompilerInputs(f.root).fingerprint,
  }), true);
  assert.equal(isLiveCompilerResult(result, { inputFingerprint: '0'.repeat(64) }), false);
  assert.equal(isLiveCompilerResult(result, { root: f.base }), false);
  assert.equal(isLiveCompilerResult(result, { expectedImageId: `sha256:${'0'.repeat(64)}` }), false);
  assert.equal(isLiveCompilerResult({ ...result }), false);
  assert.equal(isLiveCompilerResult(JSON.parse(JSON.stringify(result))), false);
  assert.equal(isLiveCompilerResult({ report: { compilerBuildInDockerVerified: true } }), false);
  const replay = verifyCompilerReceipt({
    receiptPath: result.receiptPath, root: f.root, output: join(f.base, 'replay'),
    expectedImageId: result.report.compiler.imageId,
  });
  assert.equal(replay.exitCode, 0, JSON.stringify(replay.report.errors));
  assert.equal(replay.verificationStatus, 'fresh-docker-replay-passed');
  assert.equal(isLiveCompilerResult(replay), true);
  assert.notEqual(replay.report.container.id, result.report.container.id);
  assert.notEqual(replay.report.controls.nonce, result.report.controls.nonce);
  assert.equal(replay.verifiedReceiptSha256, result.receiptSha256);
  assert.deepEqual(replay.report.output, result.report.output);
  tamperReceipt(result, report => { report.fullSourceClosureVerified = true; });
  assert.throws(() => verifyCompilerReceipt({
    receiptPath: result.receiptPath, output: join(f.base, 'claimed-full-closure'),
    execute() { assert.fail('Full closure promotion must fail before Docker'); },
  }), /cannot claim full source closure/);
  tamperReceipt(result, report => { report.fullSourceClosureVerified = false; });
  const controlledReplay = verifyCompilerReceipt({
    receiptPath: result.receiptPath, root: f.root, output: join(f.base, 'controlled-replay'), execute: delegate,
  });
  assertFailed(controlledReplay);
  assert.match(controlledReplay.report.errors.join(' '), /Controlled runner cannot authenticate/);
});

test('direct live compilation cannot acquire caller-invented candidate receipt provenance', t => {
  const f = fixture(t);
  const result = runCompilerInDocker({ root: f.root, output: f.output });
  assert.equal(result.exitCode, 0, JSON.stringify(result.report.errors));
  for (const [key, value] of [
    ['verificationStatus', 'fresh-docker-replay-passed'],
    ['verifiedReceiptPath', result.receiptPath],
    ['verifiedReceiptSha256', result.receiptSha256],
  ]) {
    result[key] = value;
    assert.equal(isLiveCompilerResult(result), false, `Invented ${key} must not become replay evidence`);
    delete result[key];
    assert.equal(isLiveCompilerResult(result), true);
    result[key] = undefined;
    assert.equal(isLiveCompilerResult(result), false, `Undefined ${key} is still invented metadata`);
    delete result[key];
    const prototype = Object.getPrototypeOf(result);
    Object.setPrototypeOf(result, { [key]: value });
    assert.equal(isLiveCompilerResult(result), false, `Inherited ${key} is still invented metadata`);
    Object.setPrototypeOf(result, prototype);
    assert.equal(isLiveCompilerResult(result), true);
  }
});

test('fresh replay capability binds candidate metadata, receipt bytes, snapshot and bytecode', t => {
  const f = fixture(t);
  const original = runCompilerInDocker({ root: f.root, output: f.output });
  assert.equal(original.exitCode, 0, JSON.stringify(original.report.errors));
  const replay = verifyCompilerReceipt({
    receiptPath: original.receiptPath, root: f.root, output: join(f.base, 'replay'),
    expectedImageId: original.report.compiler.imageId,
  });
  assert.equal(replay.exitCode, 0, JSON.stringify(replay.report.errors));
  assert.equal(isLiveCompilerResult(replay), true);
  for (const [key, value] of [
    ['verificationStatus', 'claimed'],
    ['verifiedReceiptPath', join(f.base, 'unverified/receipt.json')],
    ['verifiedReceiptSha256', '0'.repeat(64)],
  ]) {
    const saved = replay[key];
    replay[key] = value;
    assert.equal(isLiveCompilerResult(replay), false, `Changed ${key} must revoke candidate evidence`);
    replay[key] = saved;
    delete replay[key];
    assert.equal(isLiveCompilerResult(replay), false, `Missing ${key} must revoke candidate evidence`);
    replay[key] = saved;
    assert.equal(isLiveCompilerResult(replay), true);
  }
  const receipt = fs.readFileSync(original.receiptPath);
  const sidecar = join(f.output, 'receipt.sha256');
  write(original.receiptPath, Buffer.concat([receipt, Buffer.from(' ')]));
  write(sidecar, `${hash(fs.readFileSync(original.receiptPath))}\n`);
  assert.equal(isLiveCompilerResult(replay), false, 'Resigned candidate bytes must revoke replay evidence');
  write(original.receiptPath, receipt);
  write(sidecar, `${original.receiptSha256}\n`);
  assert.equal(isLiveCompilerResult(replay), true);
  for (const path of [
    sidecar, join(f.output, 'snapshot/README.txt'), join(f.output, 'build/classes/demo/Main.class'),
  ]) {
    const saved = fs.readFileSync(path);
    write(path, 'changed candidate evidence\n');
    assert.equal(isLiveCompilerResult(replay), false, `Candidate evidence drift must be rejected: ${path}`);
    write(path, saved);
    assert.equal(isLiveCompilerResult(replay), true);
  }
  write(join(f.output, 'snapshot/README.txt'), 'changed before receipt verification\n');
  assert.throws(() => verifyCompilerReceipt({
    receiptPath: original.receiptPath, root: f.root, output: join(f.base, 'must-not-replay'),
    execute() { assert.fail('Candidate snapshot drift must fail before Docker'); },
  }), /snapshot inputs differ/);
  assert.equal(fs.existsSync(join(f.base, 'must-not-replay')), false);
});

test('real syntax-invalid javac cannot promote a Docker gate and retains failure evidence', t => {
  const f = fixture(t, 'package demo; public class Main { syntax error }\n');
  const result = runCompilerInDocker({ root: f.root, output: f.output });
  assertFailed(result);
  assert.ok(result.report.errors.some(error => error.includes('javac-failed')));
  assert.equal(result.report.cleanup.status, 'pass');
  assert.ok(fs.statSync(join(f.output, 'build/compiler.stderr')).size > 0);
});

test('real JDK17 release8 emits major52 including target package and inner classes', t => {
  const f = fixture(t, 'package target; public class Main { class Inner {} }\n');
  const result = runCompilerInDocker({ root: f.root, output: f.output, release: 8 });
  assert.equal(result.exitCode, 0, JSON.stringify(result.report.errors));
  assert.equal(result.report.output.files, 2);
  for (const entry of result.report.output.entries) {
    const bytes = fs.readFileSync(join(f.output, 'build/classes', entry.path));
    assert.equal(bytes.readUInt16BE(6), 52);
  }
});

test('controlled runner invoking actual Docker still cannot become required-gate evidence', t => {
  const f = fixture(t);
  const result = runCompilerInDocker({ root: f.root, output: f.output, execute: delegate });
  assert.equal(result.report.status, 'passed', JSON.stringify(result.report.errors));
  assert.equal(result.report.evidenceOrigin, 'controlled-runner-not-required-gate-evidence');
  assert.equal(result.report.compilerBuildInDockerVerified, false);
  assert.equal(result.exitCode, 1);
  assert.equal(isLiveCompilerResult(result), false);
  assert.throws(() => verifyCompilerReceipt({ receiptPath: result.receiptPath }), /false !== true/);
});

test('recomputed receipt sidecar cannot forge javac version; verification freshly invokes Docker', t => {
  const f = fixture(t);
  const result = runCompilerInDocker({ root: f.root, output: f.output });
  assert.equal(result.exitCode, 0, JSON.stringify(result.report.errors));
  tamperReceipt(result, report => { report.compiler.version = 'javac 17.0.forged'; });
  assert.equal(isLiveCompilerResult(result), false);
  const replay = verifyCompilerReceipt({
    receiptPath: result.receiptPath, output: join(f.base, 'tampered-replay'),
  });
  assert.equal(replay.exitCode, 1);
  assert.equal(replay.verificationStatus, 'failed');
  assert.equal(replay.report.status, 'failed');
  assert.equal(replay.report.compilerBuildInDockerVerified, false);
  assert.equal(isLiveCompilerResult(replay), false);
  assert.match(replay.report.errors.join(' '), /version differs/);
  assert.equal(JSON.parse(fs.readFileSync(replay.receiptPath)).status, 'failed');
  assert.notEqual(replay.report.container.id, result.report.container.id);
});

test('source, bytecode and report drift revoke a previously authentic result', t => {
  const f = fixture(t);
  const result = runCompilerInDocker({ root: f.root, output: f.output });
  assert.equal(result.exitCode, 0, JSON.stringify(result.report.errors));
  const readme = join(f.root, 'README.txt');
  const original = fs.readFileSync(readme);
  write(readme, 'changed source input\n');
  assert.equal(isLiveCompilerResult(result), false);
  assert.throws(() => verifyCompilerReceipt({ receiptPath: result.receiptPath }), /source inputs differ/);
  write(readme, original);
  assert.equal(isLiveCompilerResult(result), true);
  result.report.compiler.release = 8;
  assert.equal(isLiveCompilerResult(result), false);
  result.report.compiler.release = 17;
  assert.equal(isLiveCompilerResult(result), true);
  const classFile = join(f.output, 'build/classes/demo/Main.class');
  const bytes = fs.readFileSync(classFile);
  write(classFile, Buffer.from('not bytecode'));
  assert.equal(isLiveCompilerResult(result), false);
  assert.throws(() => verifyCompilerReceipt({ receiptPath: result.receiptPath }), /Invalid compiler bytecode/);
  write(classFile, bytes);
  assert.equal(isLiveCompilerResult(result), true);
  tamperReceipt(result, report => { report.checks.pop(); });
  assert.throws(() => verifyCompilerReceipt({ receiptPath: result.receiptPath }), /required checks differ/);
});

test('input drift after Docker cleanup fails instead of validating only a stale snapshot', t => {
  const f = fixture(t);
  const execute = (command, args, options) => {
    const result = delegate(command, args, options);
    if (args[0] === 'rm') write(join(f.root, 'README.txt'), 'late drift\n');
    return result;
  };
  const result = runCompilerInDocker({ root: f.root, output: f.output, execute });
  assertFailed(result);
  assert.ok(result.report.errors.some(error => error.includes('source changed')));
});

test('forged proof fields fail the invocation MAC even when project compilation really succeeded', t => {
  const f = fixture(t);
  const execute = (command, args, options) => {
    const result = delegate(command, args, options);
    if (args[0] === 'start') {
      const path = join(f.output, 'build/proof.properties');
      write(path, fs.readFileSync(path, 'utf8').replace('positiveExitCode=0', 'positiveExitCode=7'));
    }
    return result;
  };
  const result = runCompilerInDocker({ root: f.root, output: f.output, execute });
  assertFailed(result);
  assert.match(result.report.errors.join(' '), /proof MAC differs/);
});

test('lost create response recovers and removes only its owned disposable container', t => {
  const f = fixture(t);
  let createdId;
  const execute = (command, args, options) => {
    const result = delegate(command, args, options);
    if (args[0] === 'create') {
      createdId = result.stdout.trim();
      return { ...result, status: null, error: new Error('lost client response') };
    }
    return result;
  };
  const result = runCompilerInDocker({ root: f.root, output: f.output, execute });
  assertFailed(result);
  assert.match(createdId, /^[a-f0-9]{64}$/);
  assert.equal(result.report.cleanup.status, 'pass');
  assert.notEqual(spawnSync('docker', ['inspect', createdId]).status, 0);
});

test('failure to confirm cleanup cannot pass; test cleanup preserves unrelated containers', t => {
  const f = fixture(t);
  const execute = (command, args, options) => {
    const result = delegate(command, args, options);
    if (args[0] === 'container' && args[1] === 'ls') {
      return { ...result, stdout: JSON.stringify('0'.repeat(64)) };
    }
    return result;
  };
  const result = runCompilerInDocker({ root: f.root, output: f.output, execute });
  assertFailed(result);
  assert.equal(result.report.cleanup.status, 'fail');
  assert.match(result.report.errors.join(' '), /remains after cleanup/);
});

test('inspection isolation mismatch fails before starting compiler and cleans the owned container', t => {
  const f = fixture(t);
  let starts = 0;
  const execute = (command, args, options) => {
    if (args[0] === 'start') starts++;
    const result = delegate(command, args, options);
    if (args[0] === 'inspect' && result.status === 0) {
      const observed = JSON.parse(result.stdout);
      observed.HostConfig.NetworkMode = 'bridge';
      return { ...result, stdout: JSON.stringify(observed) };
    }
    return result;
  };
  const result = runCompilerInDocker({ root: f.root, output: f.output, execute });
  assertFailed(result);
  assert.equal(starts, 0);
  assert.equal(result.report.cleanup.status, 'pass');
});

test('actual explicit dependency JAR compiles while a discovered annotation processor is never executed', t => {
  const dep = fixture(t);
  write(join(dep.root, 'src/fixture/Dependency.java'), 'package fixture; public final class Dependency {}\n');
  write(join(dep.root, 'src/fixture/RejectingProcessor.java'), [
    'package fixture;',
    'import javax.annotation.processing.*;',
    'import javax.lang.model.SourceVersion;',
    'import javax.lang.model.element.TypeElement;',
    'import java.util.Set;',
    '@SupportedAnnotationTypes("*")',
    '@SupportedSourceVersion(SourceVersion.RELEASE_17)',
    'public final class RejectingProcessor extends AbstractProcessor {',
    'public boolean process(Set<? extends TypeElement> types, RoundEnvironment env) {',
    'throw new IllegalStateException("Project processors must not execute");',
    '} }',
  ].join('\n'));
  const built = runCompilerInDocker({ root: dep.root, output: dep.output });
  assert.equal(built.exitCode, 0, JSON.stringify(built.report.errors));
  const f = fixture(t, 'package demo; public class Main { public fixture.Dependency dependency; }\n');
  const jarRoot = join(dep.base, 'jar');
  fs.cpSync(join(dep.output, 'build/classes'), jarRoot, { recursive: true });
  write(join(jarRoot, 'META-INF/services/javax.annotation.processing.Processor'), 'fixture.RejectingProcessor\n');
  fs.mkdirSync(join(f.root, 'lib'));
  const jar = join(f.root, 'lib/fixture.jar');
  const zipped = spawnSync('zip', ['-q', '-r', jar, '.'], { cwd: jarRoot, encoding: 'utf8' });
  assert.equal(zipped.status, 0, zipped.stderr);
  const result = runCompilerInDocker({
    root: f.root, output: f.output, classpath: ['lib/fixture.jar'],
  });
  assert.equal(result.exitCode, 0, JSON.stringify(result.report.errors));
  assert.equal(result.report.source.inputs.files, 3);
  assert.equal(isLiveCompilerResult(result), true);
  const missing = runCompilerInDocker({ root: f.root, output: join(f.base, 'no-classpath') });
  assertFailed(missing);
  assert.match(missing.report.errors.join(' '), /javac-failed/);
});

test('dependency manifest cannot import verifier control bytecode outside explicit inputs', t => {
  const f = fixture(t, 'public final class Main { String control = DockerCompilerChallenge.NONCE; }\n');
  fs.mkdirSync(join(f.root, 'lib'));
  const extensions = ['file:/output/control/', 'explicit.jar file:/tmp/SENSITIVE_MANIFEST_VALUE'];
  const classpath = ['lib/implicit.jar', 'lib/second.jar'];
  for (const [index, path] of classpath.entries()) {
    const jarRoot = join(f.base, `jar-${index}`);
    write(join(jarRoot, 'META-INF/MANIFEST.MF'),
      `Manifest-Version: 1.0\r\nClass-Path: ${extensions[index]}\r\n\r\n`);
    const zipped = spawnSync('zip', ['-q', '-r', join(f.root, path), '.'],
      { cwd: jarRoot, encoding: 'utf8' });
    assert.equal(zipped.status, 0, zipped.stderr);
  }
  const result = runCompilerInDocker({ root: f.root, output: f.output, classpath });
  assertFailed(result);
  assert.match(result.report.errors.join(' '), /implicit-classpath/);
  const diagnostic = result.report.compiler.manifestClasspath;
  assert.equal(diagnostic.status, 'fail');
  assert.equal(diagnostic.evidenceOrigin, 'live-independent-docker-jdk-manifest-inspection');
  assert.deepEqual(diagnostic.rejectedJars, classpath.map((path, index) => ({
    path, jarSha256: hash(fs.readFileSync(join(f.root, path))),
    classPathSha256: hash(extensions[index]), targetCount: index + 1,
  })));
  assert.equal(JSON.stringify(result.report).includes('SENSITIVE_MANIFEST_VALUE'), false);
  assert.equal(fs.existsSync(join(f.output, 'build/classes')), false,
    'An implicit Class-Path must fail before project compilation');
  const tampered = runCompilerInDocker({
    root: f.root, output: join(f.base, 'tampered-audit'), classpath,
    execute(command, args, options) {
      const response = spawnSync(command, args, options);
      if (args[0] === 'start' && response.status === 0) {
        write(join(f.base, 'tampered-audit/build/classpath-rejections.tsv'), '');
      }
      return response;
    },
  });
  assertFailed(tampered);
  assert.match(tampered.report.errors.join(' '), /Manifest audit bytes differ/);
});

function recoveredUaaFixture(t) {
  const { base } = fixture(t);
  const candidateBase = join(workspace, '.artifacts', `standalone-uaa-editable-controlled-D01-${randomUUID()}`);
  const candidate = join(candidateBase, 'build-controlled');
  t.after(() => { if (!evidence) fs.rmSync(candidateBase, { recursive: true, force: true }); });
  const root = join(candidate, 'source');
  const modules = ['uaa-core', 'uaa-user', 'uaa-api'];
  for (const [index, module] of modules.entries()) {
    const name = ['Core', 'User', 'Api'][index];
    write(join(root, module, 'src/main/java/sample', `${name}.java`),
      `package sample; public class ${name} { ${index ? `public ${index === 1 ? 'Core' : 'User'} value;` : ''} }\n`);
  }
  write(join(root, 'uaa-core/src/main/resources/mapper.xml'), '<fixture-not-native/>\n');
  write(join(root, 'uaa-core/src/main/resources/{{projectName}}/Abstract{{api}}.java.hbs'),
    'Template resource, inventoried literally and never executed.\n');
  const compiled = runCompilerInDocker({ root, output: join(base, 'candidate-compile'), release: 8 });
  assert.equal(compiled.exitCode, 0, JSON.stringify(compiled.report.errors));
  const report = {
    schemaVersion: 1, contract: 'standalone-uaa-recovered-source-compilation-experiment-v1',
    target: 'uaa-standalone-sys-person',
    status: 'recovered-source-built-focused-fixture-tested-not-native-accepted',
    originalSourceRecovered: false, sourceAuthenticityVerified: false, sourceClosureVerified: false,
    standaloneSourceBuildVerified: false, protocolRuntimeParityVerified: false, nativeAcceptance: false,
    image: { id: compiled.report.compiler.imageId }, errors: [],
    sourceInputs: { contract: 'source-build-input-inventory-v1',
      before: sourceBuildInputs(root), after: sourceBuildInputs(root) },
    dependencyInputs: {}, dependencies: {}, packages: [],
  };
  for (const [index, name] of ['third-party', 'starters'].entries()) {
    const jarRoot = join(base, `jar-${index}`);
    write(join(jarRoot, 'fixture.txt'), 'Controlled dependency; no native or source authenticity evidence.\n');
    const jar = join(candidate, name, `fixture-${index}.jar`);
    fs.mkdirSync(dirname(jar), { recursive: true });
    const zipped = spawnSync('zip', ['-q', '-r', jar, '.'], { cwd: jarRoot, encoding: 'utf8' });
    assert.equal(zipped.status, 0, zipped.stderr);
    const key = index === 0 ? 'thirdParty' : 'starters';
    report.dependencyInputs[key] = sourceBuildInputs(dirname(jar));
    report.dependencies[key] = collectCompilerInputs(dirname(jar)).entries.map(entry =>
      ({ ...entry, path: `${name}/${entry.path}` }));
  }
  for (const [index, module] of modules.entries()) {
    const entry = compiled.report.output.entries.find(entry =>
      entry.path === `sample/${['Core', 'User', 'Api'][index]}.class`);
    write(join(candidate, 'classes', module, entry.path),
      fs.readFileSync(join(base, 'candidate-compile/build/classes', entry.path)));
    report.packages.push({ module, javaSources: 1, compiledClasses: [entry] });
  }
  const receiptPath = join(candidate, 'report.json');
  const persist = () => {
    const bytes = `${JSON.stringify(report, null, 2)}\n`;
    write(receiptPath, bytes);
    write(join(candidate, 'report.sha256'), `${hash(bytes)}\n`);
  };
  persist();
  return { base, candidate, root, report, receiptPath, persist,
    expectedImageId: report.image.id };
}

function assertUaaReplayFailed(result) {
  assert.equal(result.exitCode, 1);
  assert.equal(result.report.compilerOutputReplayVerified, false);
  assert.equal(result.report.sourceClosureVerified, false);
  assert.equal(result.report.fullSourceClosureVerified, false);
  assert.equal(result.report.nativeAcceptance, false);
  assert.equal(result.report.summary.skipped, 0);
  assert.ok(result.report.errors.length);
  assert.equal(isLiveRecoveredUaaCompilerReplay(result), false);
  assert.equal(isLiveMaintainedUaaCompilerReplay(result), false);
  assert.deepEqual(JSON.parse(fs.readFileSync(result.reportPath)), result.report);
}

test('independent reconstructed UAA replay binds every module, source/resource, dependency and output without promotion', async t => {
  const f = recoveredUaaFixture(t);
  const request = { receiptPath: f.receiptPath, expectedImageId: f.expectedImageId };
  const result = verifyRecoveredUaaCompilerOutputs({ ...request, output: join(f.base, 'replay') });
  assert.equal(result.exitCode, 0, JSON.stringify(result.report.errors));
  assert.equal(result.report.compilerOutputReplayVerified, true);
  assert.equal(result.report.output.classes, 3);
  assert.equal(result.report.sourceClosureVerified, false);
  assert.equal(result.report.fullSourceClosureVerified, false);
  assert.equal(result.report.standaloneSourceBuildVerified, false);
  assert.equal(result.report.protocolRuntimeParityVerified, false);
  assert.equal(result.report.nativeAcceptance, false);
  assert.equal(result.report.summary.skipped, 0);
  assert.equal(isLiveRecoveredUaaCompilerReplay(result, request), true);
  assert.equal(isLiveRecoveredUaaCompilerReplay({ ...result }), false);
  assert.equal(isLiveRecoveredUaaCompilerReplay(JSON.parse(JSON.stringify(result))), false);
  assert.equal(isLiveRecoveredUaaCompilerReplay(result, { expectedImageId: `sha256:${'0'.repeat(64)}` }), false);
  assert.equal(isLiveRecoveredUaaCompilerReplay(result, { receiptPath: join(f.base, 'other.json') }), false);
  const scope = { request: { ...request, receiptPath: f.receiptPath.slice(`${workspace}/`.length) }, result };
  const scopedEvidence = verifyRequiredRecoveredUaaEvidence(scope);
  assert.equal(scopedEvidence.status, 'pass', scopedEvidence.reason);
  assert.equal(scopedEvidence.reconstructedCompilerOutputReplayVerified, true);
  assert.equal(scopedEvidence.fullComponentBuildVerified, false);
  assert.equal(scopedEvidence.ownDependencySourceClosureVerified, false);
  assert.equal(scopedEvidence.protocolRuntimeParityVerified, false);
  assert.equal(scopedEvidence.nativeAcceptance, false);
  const required = evaluateRequiredSourceGates({}, [], undefined, scope);
  assert.equal(required.compilerEvidence.reconstructedUaaEvidence.status, 'pass');
  assert.deepEqual(required.compilerEvidence.summary, { requested: 1, passed: 1, failed: 0, skipped: 0 });
  assert.deepEqual(required.compilerEvidence.projectionSummary, { requested: 0, passed: 0, failed: 0, skipped: 0 });
  assert.equal(required.compilerEvidence.requiredComponents.find(item =>
    item.component === 'uaa-standalone').reconstructedCompilerOutputReplayVerified, true);
  assert.equal(required.compilerEvidence.allRequiredComponentsVerified, false);
  assert.equal(required.compilerBuildInDockerVerified, false);
  assert.equal(required.nativeAcceptance, false);
  assert.deepEqual(required.summary, { required: 3, passed: 0, failed: 3, skipped: 0, rejectedSourceSkips: 0 });
  for (const copied of [{ ...result }, JSON.parse(JSON.stringify(result))]) {
    assert.equal(verifyRequiredRecoveredUaaEvidence({ ...scope, result: copied }).status, 'fail');
  }
  for (const path of [
    f.receiptPath, join(f.candidate, 'report.sha256'),
    join(f.root, 'uaa-core/src/main/resources/mapper.xml'),
    join(f.candidate, 'third-party/fixture-0.jar'),
    join(f.candidate, 'starters/fixture-1.jar'),
    join(f.candidate, 'classes/uaa-core/sample/Core.class'),
    result.reportPath, join(dirname(result.reportPath), 'verification.sha256'),
    join(dirname(result.reportPath), 'input/source/uaa-core/src/main/resources/mapper.xml'),
    join(dirname(result.reportPath), 'compiler/build/classes/sample/Core.class'),
  ]) {
    const bytes = fs.readFileSync(path);
    write(path, Buffer.concat([bytes, Buffer.from('drift')]));
    assert.equal(isLiveRecoveredUaaCompilerReplay(result), false, `Evidence drift was accepted: ${path}`);
    write(path, bytes);
    assert.equal(isLiveRecoveredUaaCompilerReplay(result), true);
  }
  result.report.output.classes++;
  assert.equal(isLiveRecoveredUaaCompilerReplay(result), false);
  result.report.output.classes--;
  assert.equal(isLiveRecoveredUaaCompilerReplay(result), true);
  await t.test('controlled runner invoking Docker cannot authenticate this replay', () => {
    const failed = verifyRecoveredUaaCompilerOutputs({
      ...request, output: join(f.base, 'controlled-replay'), execute: delegate,
    });
    assertUaaReplayFailed(failed);
    assert.match(failed.report.errors.join(' '), /did not authenticate.*controlled-runner/);
  });
  for (const [name, change, expected] of [
    ['native claim', r => { r.nativeAcceptance = true; }, /nativeAcceptance/],
    ['source closure claim', r => { r.sourceClosureVerified = true; }, /sourceClosureVerified/],
    ['full source closure claim', r => { r.fullSourceClosureVerified = true; }, /fullSourceClosureVerified/],
    ['protocol parity claim', r => { r.protocolRuntimeParityVerified = true; }, /protocolRuntimeParityVerified/],
    ['wrong contract', r => { r.contract = 'fixture-pass'; }, /fixture-pass/],
    ['missing module', r => { r.packages.pop(); }, /module roster differs/],
    ['duplicate module', r => { r.packages[2].module = 'uaa-user'; }, /module roster differs/],
    ['incorrect class count', r => { r.packages[0].javaSources = 2; }, /source count differs/],
    ['omitted dependency', r => { r.dependencies.thirdParty = []; }, /dependency receipt differs/],
    ['stale source inventory', r => { r.sourceInputs.before.fingerprint = '0'.repeat(64); }, /source inputs differ/],
    ['wrong selected JDK', r => { r.image.id = `sha256:${'0'.repeat(64)}`; }, /selected JDK image differ/],
  ]) {
    await t.test(`replay fails before Docker for ${name} and retains a failed report`, () => {
      const saved = structuredClone(f.report);
      change(f.report);
      f.persist();
      const failed = verifyRecoveredUaaCompilerOutputs({
        ...request, output: join(f.base, `bad-${name.replaceAll(' ', '-')}`),
        execute() { assert.fail('Malformed candidate must fail before Docker'); },
      });
      assertUaaReplayFailed(failed);
      assert.match(failed.report.errors.join(' '), expected);
      for (const key of Object.keys(f.report)) delete f.report[key];
      Object.assign(f.report, saved);
      f.persist();
    });
  }
  await t.test('a resigned candidate class inventory must still match fresh actual compiler bytes', () => {
    const path = join(f.candidate, 'classes/uaa-core/sample/Core.class');
    const bytes = fs.readFileSync(path);
    const changed = Buffer.from(bytes);
    changed[changed.length - 1] ^= 1;
    write(path, changed);
    f.report.packages[0].compiledClasses[0].sha256 = hash(changed);
    f.persist();
    const failed = verifyRecoveredUaaCompilerOutputs({
      ...request, output: join(f.base, 'resigned-class-replay'),
    });
    assertUaaReplayFailed(failed);
    assert.match(failed.report.errors.join(' '), /Fresh UAA class outputs differ/);
    assert.equal(failed.report.checks.some(check => check.id === 'fresh-independent-docker-javac'), true);
    write(path, bytes);
  });
});

function maintainedInputFixture(t) {
  const { base } = fixture(t);
  const candidate = join(workspace, '.artifacts/standalone-uaa-source-build',
    `build-controlled${randomUUID().replaceAll('-', '')}`);
  t.after(() => { if (!evidence) fs.rmSync(candidate, { recursive: true, force: true }); });
  const maintained = join(workspace, 'standalone-uaa');
  const sourceRoot = join(maintained, 'source');
  const starterRoot = join(maintained, 'starters');
  const provenancePath = join(maintained, 'provenance.json');
  const provenance = JSON.parse(fs.readFileSync(provenancePath));
  fs.mkdirSync(candidate, { recursive: true });
  fs.cpSync(sourceRoot, join(candidate, 'source'), { recursive: true });
  fs.cpSync(starterRoot, join(candidate, 'starter-source'), {
    recursive: true, filter: path => !path.split('/').includes('target'),
  });
  fs.copyFileSync(join(maintained, 'settings.xml'), join(candidate, 'settings.xml'));
  const tools = ['build.mjs', 'dependencies.mjs', 'BootControllerMappingTests.java',
    'SourceContractTests.java', 'OAuth2TokenSecurityTests.java', 'receipt.mjs', 'receipt.test.mjs'].map(name => {
    const path = join(maintained, 'tools', name);
    const bytes = fs.readFileSync(path);
    write(join(candidate, 'tool-source', name), bytes);
    return { path, snapshotPath: `tool-source/${name}`, sha256: hash(bytes) };
  });
  const logs = ['receipt-tests.log', 'starter-maven.log', 'boot-mapping-tests.log', 'focused-tests.log',
    'oauth2-security-tests.log',
    ...['uaa-core', 'uaa-user', 'uaa-api'].map(module => `${module}-compile.log`)];
  const commands = logs.map(path => {
    const bytes = 'Controlled log; not actual build/native evidence.\n';
    write(join(candidate, path), bytes);
    return { executable: 'controlled-fixture', exitCode: 0, signal: null, error: null,
      log: { path, bytes: Buffer.byteLength(bytes), sha256: hash(bytes) } };
  });
  const focused = { schemaVersion: 2, contract: 'standalone-uaa-recovered-source-focused-regression-v2',
    suite: 'SourceContractTests', tests: focusedUaaTests.length, executed: [...focusedUaaTests],
    failures: 0, skipped: 0, errors: [], nativeAcceptance: false };
  const focusedBytes = `${JSON.stringify(focused)}\n`;
  write(join(candidate, 'focused/report.json'), focusedBytes);
  const oauth2Security = {
    schemaVersion: 1, contract: 'standalone-uaa-real-oauth2-security-regression-v1',
    suite: 'OAuth2TokenSecurityTests', tests: 13, failures: 0, skipped: 0,
    executed: [...MAINTAINED_UAA_OAUTH2_TESTS],
    errors: [], tokenEvidence: Array.from({ length: 8 }, (_, index) => ({ case: `case-${index}` })),
    nativeAcceptance: false,
    fixture: 'real-source-oauth2-service-adapter-filter; real-library-in-memory-token-store; no-boot-or-db',
    classOrigins: {
      'cn.ibizlab.core.oauth2.config.OAuth2TokenAdapter': 'file:/packages/uaa-user-reconstructed.jar',
      'cn.ibizlab.util.security.AuthorizationTokenFilter': 'file:/starters/ibizlab-boot-starter-2.6.12.10.jar',
    },
  };
  const oauth2SecurityBytes = `${JSON.stringify(oauth2Security)}\n`;
  write(join(candidate, 'focused/oauth2-security-report.json'), oauth2SecurityBytes);
  const transforms = new Map(provenance.dependencies.compilerInputTransforms.map(item => [item.path, item]));
  const thirdParty = provenance.dependencies.thirdParty.map(item => ({
    ...item,
    compilerInputTransform: transforms.get(item.path) ?? null,
    originalSha256: item.sha256,
    originalBytes: item.bytes,
  }));
  const source = sourceBuildInputs(sourceRoot);
  const starters = sourceBuildInputs(starterRoot);
  const toolInputs = sourceBuildInputs(join(candidate, 'tool-source'));
  const receiptPath = join(candidate, 'report.json');
  const report = {
    schemaVersion: 1, contract: MAINTAINED_UAA_BUILD_CONTRACT, target: 'uaa-standalone-sys-person',
    status: 'maintained-source-built-focused-fixture-tested-not-native-accepted',
    originalSourceRecovered: false, sourceAuthenticityVerified: false, sourceClosureVerified: false,
    standaloneSourceBuildVerified: false, protocolRuntimeParityVerified: false, nativeAcceptance: false,
    javaCompilationVerified: true, compilerBuildInDockerVerified: true, focusedSourceContractVerified: true,
    reconstructionInputs: null, errors: [], image: { id: `sha256:${'a'.repeat(64)}` },
    sourceInputs: { contract: 'source-build-input-inventory-v1', before: source, after: source },
    maintainedInputs: { sourceRoot, starterRoot, sourceBefore: source, sourceAfter: source,
      starterBefore: starters, starterAfter: starters },
    receipts: [{ path: provenancePath, sha256: hash(fs.readFileSync(provenancePath)) }],
    tools, orchestrator: { path: tools[0].path, sha256: tools[0].sha256 },
    importedHelpers: ['native-candidate-files.mjs', 'source-build-identity.mjs'].map(name => {
      const path = join(workspace, 'scripts', name);
      return { path, sha256: hash(fs.readFileSync(path)) };
    }),
    toolInputs: { before: toolInputs, after: toolInputs }, commands,
    focused: { path: 'focused/report.json', sha256: hash(focusedBytes), ...focused },
    oauth2Security: {
      path: 'focused/oauth2-security-report.json', sha256: hash(oauth2SecurityBytes), ...oauth2Security,
    },
    dependencies: {
      excludedOriginalOwn: provenance.dependencies.excludedOriginalOwn,
      thirdParty,
      starters: provenance.starterPackages.map(({ artifact, version }) => ({
        path: `starters/${artifact}-${version}.jar`, sourceRoot: join(starterRoot, artifact), buildReceiptPath: receiptPath,
      })),
    },
  };
  const persist = () => {
    const bytes = `${JSON.stringify(report)}\n`;
    write(receiptPath, bytes);
    write(join(candidate, 'report.sha256'), `${hash(bytes)}\n`);
  };
  persist();
  return { base, candidate, report, receiptPath, persist, expectedImageId: report.image.id };
}

test('maintained OAuth2 evidence requires all thirteen named security tests', t => {
  const f = maintainedInputFixture(t);
  const valid = f.report.oauth2Security;
  assert.equal(valid.tests, 13);
  assert.ok(valid.executed.includes('resourceServerLoadAuthenticationRejectsStoredInvalidTokens'));
  verifyMaintainedOauth2Evidence(valid);
  for (const change of [
    receipt => { receipt.tests = 12; receipt.executed.pop(); },
    receipt => { receipt.executed.pop(); },
    receipt => { receipt.executed[0] = receipt.executed[1]; },
    receipt => { receipt.executed[0] = 'unrelated-security-test'; },
    receipt => { receipt.executed.push('extra-test'); receipt.tests++; },
    receipt => { receipt.skipped = 1; },
    receipt => { receipt.failures = 1; },
    receipt => { receipt.nativeAcceptance = true; },
    receipt => { receipt.fixture = 'unverified'; },
  ]) {
    const invalid = structuredClone(valid);
    change(invalid);
    assert.throws(() => verifyMaintainedOauth2Evidence(invalid));
  }
});

test('controlled maintained input contracts reject current-source, tool, starter and fixture drift without native promotion', async t => {
  const f = maintainedInputFixture(t);
  const saved = structuredClone(f.report);
  const restore = () => {
    for (const key of Object.keys(f.report)) delete f.report[key];
    Object.assign(f.report, structuredClone(saved));
    f.persist();
  };
  const request = { receiptPath: f.receiptPath, expectedImageId: f.expectedImageId };
  let index = 0;
  const replay = () => verifyMaintainedUaaCompilerOutputs({
    ...request, output: join(f.base, `maintained-${index++}`),
    execute() { assert.fail('Controlled incomplete candidate must never reach Docker'); },
  });
  const incomplete = replay();
  assertUaaReplayFailed(incomplete);
  assert.match(incomplete.report.errors.join(' '), /third-party/,
    'Even correctly bound current input claims fail when dependency/output bytes are missing');
  assert.equal(maintainedUaaReplayFailureEvidence(incomplete, request), null);
  for (const [name, change, expected] of [
    ['failed build', r => { r.status = 'failed'; }, /failed/],
    ['native claim', r => { r.nativeAcceptance = true; }, /nativeAcceptance/],
    ['full closure claim', r => { r.fullSourceClosureVerified = true; }, /fullSourceClosureVerified/],
    ['missing Docker eligibility', r => { r.compilerBuildInDockerVerified = false; }, /compilerBuildInDockerVerified/],
    ['historical input substitution', r => { r.reconstructionInputs = {}; }, /historical reconstruction/],
    ['output-only source root', r => { r.maintainedInputs.sourceRoot = join(f.candidate, 'source'); }, /source root differs/],
    ['stale current source', r => { r.maintainedInputs.sourceBefore.fingerprint = '0'.repeat(64); }, /maintained source inputs differ/],
    ['stale post-build source', r => { r.maintainedInputs.sourceAfter.fingerprint = '0'.repeat(64); }, /maintained source inputs differ/],
    ['binary-only starter root', r => { r.maintainedInputs.starterRoot = join(f.candidate, 'starters'); }, /starter root differs/],
    ['stale starter source', r => { r.maintainedInputs.starterBefore.fingerprint = '0'.repeat(64); }, /maintained starter inputs differ/],
    ['stale post-build starters', r => { r.maintainedInputs.starterAfter.fingerprint = '0'.repeat(64); }, /maintained starter inputs differ/],
    ['provenance drift', r => { r.receipts[0].sha256 = '0'.repeat(64); }, /provenance binding/],
    ['orchestrator drift', r => { r.orchestrator.sha256 = '0'.repeat(64); }, /orchestrator differs/],
    ['untracked dependency helper', r => { r.tools.splice(1, 1); }, /tool bindings differ/],
    ['tool hash drift', r => { r.tools[1].sha256 = '0'.repeat(64); }, /tool bindings differ/],
    ['helper hash drift', r => { r.importedHelpers[0].sha256 = '0'.repeat(64); }, /helper bindings differ/],
    ['post-build tool inventory drift', r => { r.toolInputs.after.fingerprint = '0'.repeat(64); }, /tool inventory differs/],
    ['copied focused metadata', r => { r.focused.tests = 20; }, /focused report bytes differ/],
    ['copied OAuth2 security metadata', r => { r.oauth2Security.tests = 11; },
      /OAuth2 security report bytes differ/],
    ['omitted build command', r => { r.commands.pop(); }, /Missing maintained command/],
    ['duplicate command log', r => { r.commands.push(r.commands[0]); }, /Duplicate maintained command/],
    ['failed command', r => { r.commands[0].exitCode = 1; }, /Failed maintained build command/],
    ['log hash drift', r => { r.commands[0].log.sha256 = '0'.repeat(64); }, /command log hash differs/],
    ['log traversal', r => { r.commands[0].log.path = '../shared.log'; }, /Unsafe relative path/],
    ['binary own fallback exclusion drift', r => { r.dependencies.excludedOriginalOwn = []; }, /binary exclusions differ/],
    ['third-party byte drift', r => { r.dependencies.thirdParty[0].sha256 = '0'.repeat(64); }, /compiler inputs differ from provenance/],
    ['starter build receipt substitution', r => { r.dependencies.starters[0].buildReceiptPath = '/tmp/static.json'; }, /starter source\/build binding/],
  ]) {
    await t.test(`maintained candidate rejects ${name}`, () => {
      restore();
      change(f.report);
      f.persist();
      const result = replay();
      assertUaaReplayFailed(result);
      assert.match(result.report.errors.join(' '), expected);
    });
  }
  restore();
  for (const [name, path, expected] of [
    ['current-source snapshot drift', join(f.candidate, 'source',
      saved.sourceInputs.before.entries[0].path), /source snapshot differs/],
    ['starter snapshot drift', join(f.candidate, 'starter-source',
      saved.maintainedInputs.starterBefore.entries[0].path), /starter snapshot differs/],
    ['settings snapshot drift', join(f.candidate, 'settings.xml'), /settings snapshot differs/],
    ['dependency helper snapshot drift', join(f.candidate, 'tool-source/dependencies.mjs'), /tool snapshot differs/],
    ['command log drift', join(f.candidate, 'receipt-tests.log'), /command log (?:length|hash) differs/],
  ]) {
    await t.test(name, () => {
      const bytes = fs.readFileSync(path);
      write(path, Buffer.concat([bytes, Buffer.from('drift')]));
      try {
        const result = replay();
        assertUaaReplayFailed(result);
        assert.match(result.report.errors.join(' '), expected);
      } finally { write(path, bytes); }
    });
  }
  for (const [name, change, expected] of [
    ['fixture skip', r => { r.skipped = 1; }, /1 !== 0/],
    ['fixture failure', r => { r.failures = 1; }, /1 !== 0/],
    ['omitted required fixture test', r => { r.executed.pop(); }, /required test roster/],
    ['duplicate required fixture test', r => { r.executed[1] = r.executed[0]; }, /required test roster/],
  ]) {
    await t.test(name, () => {
      const path = join(f.candidate, 'focused/report.json');
      const bytes = fs.readFileSync(path);
      const focused = JSON.parse(bytes);
      change(focused);
      const changed = `${JSON.stringify(focused)}\n`;
      write(path, changed);
      f.report.focused = { path: 'focused/report.json', sha256: hash(changed), ...focused };
      f.persist();
      try {
        const result = replay();
        assertUaaReplayFailed(result);
        assert.match(result.report.errors.join(' '), expected);
      } finally {
        write(path, bytes);
        restore();
      }
    });
  }
});

test('maintained replay never accepts historical contracts, missing reports or compiler overrides', t => {
  const f = fixture(t);
  const receiptPath = join(f.base, 'candidate/report.json');
  const options = { receiptPath, expectedImageId: `sha256:${'a'.repeat(64)}`,
    execute() { assert.fail('Unselected or missing maintained receipt cannot reach Docker'); } };
  assertUaaReplayFailed(verifyMaintainedUaaCompilerOutputs({ ...options, output: join(f.base, 'missing') }));
  const bytes = `${JSON.stringify({ schemaVersion: 1,
    contract: 'standalone-uaa-recovered-source-compilation-experiment-v1' })}\n`;
  write(receiptPath, bytes);
  write(join(dirname(receiptPath), 'report.sha256'), `${hash(bytes)}\n`);
  const rejected = verifyMaintainedUaaCompilerOutputs({ ...options, output: join(f.base, 'historical') });
  assertUaaReplayFailed(rejected);
  assert.match(rejected.report.errors.join(' '), /standalone-uaa-recovered/);
  for (const key of ['maintainedRoot', 'sourceRoot', 'classpath', 'release', 'image', 'nativeAcceptance', 'skip']) {
    assert.throws(() => verifyMaintainedUaaCompilerOutputs({ ...options, [key]: true }), /Unknown UAA replay option/);
  }
  assert.throws(() => main(['--uaa-receipt', receiptPath, '--maintained-uaa-receipt', receiptPath]),
    /Select only one UAA build contract/);
  assert.throws(() => main(['--maintained-uaa-receipt', receiptPath,
    '--expected-image-id', options.expectedImageId, '--release', '8']), /does not allow/);
});

test('required consumer preserves live failed UAA replay diagnostics without accepting copies, drift or closure', t => {
  const f = recoveredUaaFixture(t);
  const jarRoot = join(f.base, 'rejected-manifest-jar');
  const extension = 'file:/output/control/ SENSITIVE_MANIFEST_TARGET';
  write(join(jarRoot, 'META-INF/MANIFEST.MF'),
    `Manifest-Version: 1.0\r\nClass-Path: ${extension}\r\n\r\n`);
  const jar = join(f.candidate, 'third-party/fixture-0.jar');
  const zipped = spawnSync('zip', ['-q', '-r', jar, '.'], { cwd: jarRoot, encoding: 'utf8' });
  assert.equal(zipped.status, 0, zipped.stderr);
  f.report.dependencyInputs.thirdParty = sourceBuildInputs(dirname(jar));
  f.report.dependencies.thirdParty = collectCompilerInputs(dirname(jar)).entries.map(entry =>
    ({ ...entry, path: `third-party/${entry.path}` }));
  f.persist();
  const request = { receiptPath: f.receiptPath, expectedImageId: f.expectedImageId };
  const result = verifyRecoveredUaaCompilerOutputs({ ...request, output: join(f.base, 'manifest-replay') });
  assertUaaReplayFailed(result);
  assert.match(result.report.errors.join(' '), /implicit-classpath/);
  const diagnostic = recoveredUaaReplayFailureEvidence(result, request);
  assert.equal(diagnostic.reportSha256, result.reportSha256);
  assert.equal(diagnostic.compilerReceipt.sha256, result.report.compilerReceipt.sha256);
  assert.equal(diagnostic.manifestClasspathDiagnostic.status, 'fail');
  assert.equal(diagnostic.manifestClasspathDiagnostic.rejectedJars[0].classPathSha256, hash(extension));
  assert.equal(JSON.stringify(diagnostic).includes('SENSITIVE_MANIFEST_TARGET'), false);
  const scope = {
    request: { ...request, receiptPath: f.receiptPath.slice(`${workspace}/`.length) },
    result, error: result.report.errors.join('; '),
  };
  const required = evaluateRequiredSourceGates({}, [], undefined, scope);
  const evidence = required.compilerEvidence.reconstructedUaaEvidence;
  assert.deepEqual(required.compilerEvidence.summary, { requested: 1, passed: 0, failed: 1, skipped: 0 });
  assert.deepEqual(required.compilerEvidence.projectionSummary, { requested: 0, passed: 0, failed: 0, skipped: 0 });
  assert.equal(evidence.failureReplay.reportSha256, result.reportSha256);
  assert.equal(evidence.failureReplay.reportPath, relative(workspace, result.reportPath));
  assert.equal(evidence.failureReplay.compilerReceipt.path,
    relative(workspace, result.report.compilerReceipt.path));
  assert.equal(evidence.failureReplay.manifestClasspathDiagnostic.status, 'fail');
  assert.equal(evidence.reconstructedCompilerOutputReplayVerified, false);
  assert.equal(required.fullSourceClosureVerified, false);
  assert.equal(required.nativeAcceptance, false);
  assert.deepEqual(required.summary, { required: 3, passed: 0, failed: 3, skipped: 0, rejectedSourceSkips: 0 });
  for (const copied of [null, true, { ...result }, JSON.parse(JSON.stringify(result))]) {
    assert.equal(recoveredUaaReplayFailureEvidence(copied, request), null);
    assert.equal(Object.hasOwn(verifyRequiredRecoveredUaaEvidence({ ...scope, result: copied }), 'failureReplay'),
      false);
  }
  assert.equal(recoveredUaaReplayFailureEvidence(result, { ...request, expectedImageId: `sha256:${'0'.repeat(64)}` }),
    null);
  assert.equal(recoveredUaaReplayFailureEvidence(result, { ...request, receiptPath: join(f.base, 'other.json') }),
    null);
  for (const path of [
    result.reportPath, join(dirname(result.reportPath), 'verification.sha256'),
    result.report.compilerReceipt.path, join(dirname(result.report.compilerReceipt.path), 'receipt.sha256'),
    join(dirname(result.report.compilerReceipt.path), 'build/classpath-rejections.tsv'),
  ]) {
    const bytes = fs.readFileSync(path);
    write(path, Buffer.concat([bytes, Buffer.from('drift')]));
    assert.equal(recoveredUaaReplayFailureEvidence(result, request), null, `Failed receipt drift accepted: ${path}`);
    assert.equal(Object.hasOwn(verifyRequiredRecoveredUaaEvidence(scope), 'failureReplay'), false);
    write(path, bytes);
    assert.deepEqual(recoveredUaaReplayFailureEvidence(result, request), diagnostic);
  }
  result.report.manifestClasspathDiagnostic.rejectedJars[0].targetCount++;
  assert.equal(recoveredUaaReplayFailureEvidence(result, request), null);
  result.report.manifestClasspathDiagnostic.rejectedJars[0].targetCount--;
  assert.deepEqual(recoveredUaaReplayFailureEvidence(result, request), diagnostic);
  const controlled = verifyRecoveredUaaCompilerOutputs({
    ...request, output: join(f.base, 'controlled-manifest-replay'), execute: delegate,
  });
  assertUaaReplayFailed(controlled);
  assert.equal(recoveredUaaReplayFailureEvidence(controlled, request), null);
});

test('UAA malformed or missing receipt persists failure; no caller boolean, image or release bypasses', t => {
  const f = fixture(t);
  const options = { receiptPath: join(f.base, 'missing/report.json'),
    expectedImageId: `sha256:${'0'.repeat(64)}`, output: join(f.base, 'missing-replay'),
    execute() { assert.fail('Missing candidate must not call Docker'); } };
  assertUaaReplayFailed(verifyRecoveredUaaCompilerOutputs(options));
  for (const key of ['nativeAcceptance', 'skip', 'classpath', 'sourceRoot', 'release', 'image']) {
    assert.throws(() => verifyRecoveredUaaCompilerOutputs({ ...options, [key]: true }), /Unknown UAA replay option/);
  }
  assert.throws(() => verifyRecoveredUaaCompilerOutputs({
    ...options, expectedImageId: DEFAULT_COMPILER_IMAGE,
  }), /immutable JDK image/);
  assert.throws(() => main(['--uaa-receipt', options.receiptPath,
    '--expected-image-id', options.expectedImageId, '--release', '8']), /does not allow/);
});

for (const [name, response] of [
  ['launch exception', () => { throw new Error('secret not logged'); }],
  ['nonzero', () => ({ status: 1, stdout: '', stderr: 'secret not logged' })],
  ['signal', () => ({ status: 0, signal: 'SIGTERM', stdout: '' })],
  ['timeout', () => ({ status: null, error: Object.assign(new Error('timeout'), { code: 'ETIMEDOUT' }) })],
  ['malformed JSON', () => ({ status: 0, stdout: 'not JSON' })],
]) {
  test(`Docker ${name} writes fail-closed receipt, no skipped checks or secrets`, t => {
    const f = fixture(t);
    const result = runCompilerInDocker({ root: f.root, output: f.output, execute: response });
    assertFailed(result);
    assert.ok(!JSON.stringify(result.report).includes('secret not logged'));
  });
}

test('real missing local image fails without pulling or leaking private config', t => {
  const f = fixture(t);
  assertFailed(runCompilerInDocker({
    root: f.root, output: f.output, image: `aibiz-compiler-missing-${randomUUID()}:none`,
  }));
});

test('independently expected immutable image mismatch fails before create', t => {
  const f = fixture(t);
  const result = runCompilerInDocker({ root: f.root, output: f.output, expectedImageId: `sha256:${'0'.repeat(64)}` });
  assertFailed(result);
  assert.match(result.report.errors.join(' '), /Expected compiler image differs/);
  assert.equal(result.report.cleanup.containerRemoved, false);
});

test('image-declared volumes are rejected instead of silently extending container mounts', t => {
  const f = fixture(t);
  const result = runCompilerInDocker({
    root: f.root, output: f.output,
    execute: () => ({
      status: 0,
      stdout: JSON.stringify({
        Id: `sha256:${'a'.repeat(64)}`, Os: 'linux', Architecture: 'arm64', Config: { Volumes: { '/untracked': {} } },
      }),
    }),
  });
  assertFailed(result);
  assert.match(result.report.errors.join(' '), /Image volumes rejected/);
});

test('input inventory includes resources/JARs and excludes only named generated directories at any depth', t => {
  const f = fixture(t);
  write(join(f.root, 'nested/target/generated.class'), 'excluded');
  write(join(f.root, '.artifacts/old/receipt.json'), '{}');
  write(join(f.root, '.git/config'), 'excluded');
  write(join(f.root, 'lib/dependency.jar'), 'included dependency input');
  write(join(f.root, 'src/resources/a config.xml'), '<xml/>');
  const inventory = collectCompilerInputs(f.root);
  assert.equal(inventory.files, 4);
  assert.ok(inventory.entries.some(entry => entry.path === 'lib/dependency.jar'));
  write(join(f.root, 'src/resources/a config.xml'), '<changed/>');
  assert.notEqual(collectCompilerInputs(f.root).fingerprint, inventory.fingerprint);
});

for (const [name, setup, match] of [
  ['symlink file', f => fs.symlinkSync(join(f.root, 'README.txt'), join(f.root, 'linked')), /Symlink/],
  ['symlink directory', f => fs.symlinkSync(join(f.root, 'src'), join(f.root, 'linked')), /Symlink/],
  ['symlink root', f => { fs.symlinkSync(f.root, join(f.base, 'link')); f.root = join(f.base, 'link'); }, /Symlink/],
  ['loose bytecode', f => write(join(f.root, 'lib/Old.class'), 'class'), /Loose input bytecode/],
  ['unsafe Java path', f => write(join(f.root, 'src/Unsafe Name.java'), 'class X {}'), /Unsafe compiler path/],
  ['template Java path', f => write(join(f.root, 'src/{{Name}}.java'), 'class X {}'), /Unsafe compiler path/],
  ['no Java sources', f => fs.rmSync(join(f.root, 'src'), { recursive: true }), /No Java/],
  ['ambiguous resource name', f => write(join(f.root, 'bad\nname.txt'), 'bad'), /Unsafe relative path/],
]) {
  test(`rejects ${name} before invoking Docker`, t => {
    const f = fixture(t);
    setup(f);
    let calls = 0;
    assert.throws(() => runCompilerInDocker({
      root: f.root, output: f.output, execute: () => { calls++; throw new Error('must not invoke'); },
    }), match);
    assert.equal(calls, 0);
  });
}

for (const [name, options, match] of [
  ['missing JAR', { classpath: ['lib/missing.jar'] }, /inventoried/],
  ['absolute JAR', { classpath: ['/etc/jar'] }, /Unsafe relative/],
  ['parent traversal', { classpath: ['../a.jar'] }, /Unsafe relative/],
  ['classpath switch injection', { classpath: ['--release'] }, /inventoried/],
  ['release bypass', { release: 0 }, /release/],
  ['release string', { release: '17' }, /release/],
  ['zero timeout', { timeout: 0 }, /timeout/],
  ['image switch', { image: '--privileged' }, /image/],
  ['boolean evidence', { compilerBuildInDockerVerified: true }, /Unknown compiler option/],
  ['source exclusion bypass', { excludeDirectories: ['src'] }, /Unknown compiler option/],
  ['skip compiler', { skip: true }, /Unknown compiler option/],
]) {
  test(`rejects ${name} as input, never weakens a required gate`, t => {
    const f = fixture(t);
    assert.throws(() => runCompilerInDocker({ root: f.root, output: f.output, ...options }), match);
  });
}

test('source/output overlap, existing destinations and symlink output ancestors are rejected', t => {
  const f = fixture(t);
  assert.throws(() => runCompilerInDocker({ root: f.root, output: join(f.root, 'output') }), /overlap/);
  assert.throws(() => runCompilerInDocker({ root: f.root, output: f.base }), /overlap/);
  fs.mkdirSync(f.output);
  assert.throws(() => runCompilerInDocker({ root: f.root, output: f.output }), /overwritten/);
  fs.symlinkSync(f.output, join(f.base, 'output-link'));
  assert.throws(() => runCompilerInDocker({
    root: f.root, output: join(f.base, 'output-link/new'),
  }), /Symlink/);
});

test('CLI rejects off/skip/boolean flags and receipt verifier rejects unknown bypasses', () => {
  assert.throws(() => main(['--skip']), /Unknown option/);
  assert.throws(() => main(['--off']), /Unknown option/);
  assert.throws(() => main(['--compilerBuildInDockerVerified']), /Unknown option/);
  assert.throws(() => main([]), /--root is required/);
  assert.throws(() => verifyCompilerReceipt({ skip: true }), /Unknown receipt verifier option/);
});
