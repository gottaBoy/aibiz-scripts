import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { main, verifyPlmBackendSourceRuntimeContract }
  from '../harness-plm-backend-source.mjs';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const evidence = '.artifacts/plm-backend-current-source-regression-20261007';

function zip(path) {
  const entries = [['BOOT-INF/lib/groovy-3.0.20.jar', 'controlled groovy'],
    ['BOOT-INF/lib/ibiz-plugin-groovy-8.1.0.584.1.jar', 'controlled iBiz plugin']];
  const result = spawnSync('python3', ['-I', '-c', String.raw`
import base64, json, sys, zipfile
with zipfile.ZipFile(sys.argv[1], "w") as archive:
    for item in json.load(sys.stdin):
        archive.writestr(item[0], base64.b64decode(item[1]))
`, path], {
    input: JSON.stringify(entries.map(([name, data]) =>
      [name, Buffer.from(data).toString('base64')])), encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
}

function write(path, data) {
  fs.mkdirSync(dirname(path), { recursive: true });
  fs.writeFileSync(path, data);
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'plm-backend-source-'));
  const source = join(root, 'plm/backend');
  const report = JSON.parse(fs.readFileSync(join(workspaceRoot, evidence, 'report.json'), 'utf8'));
  write(join(source, 'pom.xml'), `<project><parent><version>2.4.0</version></parent>
<properties><ibiz.cloud.version>8.1.0.584.1</ibiz.cloud.version>
<groovy.version>3.0.20</groovy.version></properties></project>\n`);
  write(join(source, 'Dockerfile'), 'ARG JRE_IMAGE=eclipse-temurin:11-jre\nFROM ${JRE_IMAGE}\n');
  write(join(source, 'build-local-image.sh'), 'MAVEN_IMAGE="${PLM_MAVEN_IMAGE:-maven:3.9-eclipse-temurin-11}"\nJRE="${PLM_JRE_IMAGE:-eclipse-temurin:11-jre}"\n');
  const jar = join(source, 'plm-provider.jar');
  zip(jar);
  const jarSha256 = createHash('sha256').update(fs.readFileSync(jar)).digest('hex');
  write(join(root, evidence, 'dependency-tree.txt'),
    'org.codehaus.groovy:groovy:jar:3.0.20:compile\n');
  write(join(root, evidence, 'report.json'), JSON.stringify({
    ...report,
    source: {
      ...report.source,
      dependencyTree: {
        ...report.source.dependencyTree,
        path: `${evidence}/dependency-tree.txt`,
      },
      fatJar: { ...report.source.fatJar, sha256: jarSha256 },
    },
  }));
  return { root, source, report, options: {
    workspace: root,
    dependencyTree: `${evidence}/dependency-tree.txt`,
    runtimeReport: `${evidence}/report.json`,
    jar: 'plm/backend/plm-provider.jar',
    python: 'python3',
  } };
}

test('live PLM backend contract verifies Groovy 3 and runtime evidence without promotion', () => {
  const result = verifyPlmBackendSourceRuntimeContract();
  assert.equal(result.status, 'passed-partial-source-runtime-contract');
  assert.equal(result.sourceBuildVerified, true);
  assert.equal(result.runtimeCompatibilityVerified, true);
  assert.equal(result.apiRegressionVerified, true);
  assert.equal(result.ownDependencySourceClosureVerified, true);
  assert.equal(result.ibizDependencyClosure.moduleCount, 6);
  assert.ok(result.ibizDependencyClosure.sourceFileCount > 0);
  for (const field of ['unitTestsVerified', 'fullComponentBuildVerified',
    'fullSourceClosureVerified', 'nativeAcceptance']) {
    assert.equal(result[field], false);
  }
  assert.match(result.fatJarSha256, /^[a-f0-9]{64}$/);
  assert.match(result.sourceFingerprint, /^[a-f0-9]{64}$/);
});

test('live PLM runtime evidence binds tracked source and both Java images', () => {
  const report = JSON.parse(fs.readFileSync(
    join(workspaceRoot, evidence, 'report.json'), 'utf8'));
  const inputs = JSON.parse(fs.readFileSync(
    join(workspaceRoot, evidence, 'source-inputs.json'), 'utf8'));
  assert.equal(report.source.commit, '1b567a7a7e811e2bd6a52adf9c3a2ece010dc208');
  assert.equal(report.source.sourceFingerprint, inputs.fingerprint);
  assert.equal(inputs.files, 1440);
  assert.equal(inputs.entries.some(entry => entry.path === 'plm-provider.jar'), false);
  assert.equal(inputs.entries.some(entry => entry.path === 'groovy-dependency-tree.txt'), false);
  assert.match(report.source.sourceFingerprint, /^[a-f0-9]{64}$/);
  assert.match(report.runtime.java11.imageId, /^sha256:[a-f0-9]{64}$/);
  assert.match(report.runtime.java17.imageId, /^sha256:[a-f0-9]{64}$/);
  assert.match(report.runtime.java11.jarSha256, /^[a-f0-9]{64}$/);
  assert.match(report.runtime.java17.jarSha256, /^[a-f0-9]{64}$/);
  assert.equal(report.runtime.java11.javaVersion.startsWith('11.'), true);
  assert.equal(report.runtime.java17.javaVersion.startsWith('17.'), true);
  assert.equal(report.runtime.defaultJavaVersion, '11');
  assert.equal(report.runtime.java17DefaultAccepted, false);
  assert.equal(report.source.fatJar.reproducibleAcrossJavaVersions, false);
  for (const field of ['businessFlowRegressionVerified', 'unitTestsVerified',
    'fullComponentBuildVerified', 'fullSourceClosureVerified', 'nativeAcceptance',
    'acceptedForProduction']) {
    assert.equal(report[field], false);
  }
});

test('missing explicit Groovy pin fails closed', () => {
  const f = fixture();
  write(join(f.source, 'pom.xml'), `<project><parent><version>2.4.0</version></parent>
<properties><ibiz.cloud.version>8.1.0.584.1</ibiz.cloud.version></properties></project>\n`);
  assert.throws(() => verifyPlmBackendSourceRuntimeContract(f.options),
    /must not silently select Groovy 2\.5\.13/);
  fs.rmSync(f.root, { recursive: true, force: true });
});

test('Groovy 2.5.13 in dependency tree fails closed', () => {
  const f = fixture();
  write(join(f.root, `${evidence}/dependency-tree.txt`),
    'org.codehaus.groovy:groovy:jar:2.5.13:compile\n');
  assert.throws(() => verifyPlmBackendSourceRuntimeContract(f.options), /2\.5\.13/);
  fs.rmSync(f.root, { recursive: true, force: true });
});

test('Java 17 evidence cannot silently become the default runtime', () => {
  const f = fixture();
  const report = structuredClone(f.report);
  report.runtime.java17DefaultAccepted = true;
  report.source.fatJar.sha256 = createHash('sha256')
    .update(fs.readFileSync(join(f.source, 'plm-provider.jar'))).digest('hex');
  write(join(f.root, `${evidence}/report.json`), JSON.stringify(report));
  assert.throws(() => verifyPlmBackendSourceRuntimeContract(f.options), /true !== false/);
  fs.rmSync(f.root, { recursive: true, force: true });
});

test('runtime evidence cannot claim full closure or native acceptance', () => {
  const f = fixture();
  for (const field of ['businessFlowRegressionVerified', 'unitTestsVerified',
    'fullComponentBuildVerified',
    'fullSourceClosureVerified', 'nativeAcceptance', 'acceptedForProduction']) {
  const report = structuredClone(f.report);
  report[field] = true;
  report.source.fatJar.sha256 = createHash('sha256')
    .update(fs.readFileSync(join(f.source, 'plm-provider.jar'))).digest('hex');
    write(join(f.root, `${evidence}/report.json`), JSON.stringify(report));
    assert.throws(() => verifyPlmBackendSourceRuntimeContract(f.options),
      new RegExp(field));
  }
  fs.rmSync(f.root, { recursive: true, force: true });
});

test('CLI help succeeds and malformed invocation fails', () => {
  assert.equal(main(['--help']), 0);
  assert.throws(() => main(['--unexpected']), /This harness takes no arguments/);
});
