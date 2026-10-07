#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { PinnedDirectories, readPinnedFile } from './native-candidate-files.mjs';
import { sourceBuildInputs } from './source-build-identity.mjs';
import {
  UAA_PARENT_PIN, UAA_STARTER_SOURCE_PINS, parseUaaParentPom, parseUaaStarterSource,
} from './fetch-standalone-uaa-sources.mjs';
import { PINNED_MAVEN_IMAGE } from './harness-modeling-permission-regression.mjs';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const success = result => result.exitCode === 0 && result.signal === null && result.error === null;
const jsonBytes = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const reactor = Buffer.from(`<project xmlns="http://maven.apache.org/POM/4.0.0">
  <modelVersion>4.0.0</modelVersion><groupId>local.aibiz.harness</groupId>
  <artifactId>standalone-uaa-starters-source</artifactId><version>1</version><packaging>pom</packaging>
  <modules><module>ibizlab-boot-starter-parent</module><module>ibizlab-boot-starter</module>
    <module>ibizlab-boot-starter-data</module></modules>
</project>\n`);
const settings = Buffer.from(`<settings xmlns="http://maven.apache.org/SETTINGS/1.2.0">
  <mirrors><mirror><id>public-central-only</id><mirrorOf>*</mirrorOf>
    <url>https://repo.maven.apache.org/maven2</url></mirror></mirrors>
</settings>\n`);

function read(directories, path) {
  return readPinnedFile(directories, directories.open(dirname(path)), basename(path)).data;
}

export function starterDockerCommand({ source, repository, settingsPath, containerName, uid, gid }) {
  for (const path of [source, repository, settingsPath]) {
    assert.ok(typeof path === 'string' && isAbsolute(path) && !/[\r\n,]/.test(path),
      'Invalid Docker bind path');
  }
  assert.notEqual(source, repository, 'Source and repository must be separate');
  assert.ok(/^uaa-starters-[a-f0-9-]{36}$/.test(containerName), 'Invalid build container name');
  for (const id of [uid, gid]) assert.ok(Number.isSafeInteger(id) && id >= 0, 'Invalid container user');
  return { executable: 'docker', args: [
    'run', '--rm', '--pull=never', '--network=bridge', '--read-only', '--cap-drop=ALL',
    '--security-opt=no-new-privileges', '--name', containerName, '--user', `${uid}:${gid}`,
    '--tmpfs', '/tmp:rw,exec,nosuid,size=1g', '--env', 'HOME=/tmp', '--env', 'MAVEN_CONFIG=/tmp/.m2',
    '--mount', `type=bind,source=${source},target=/workspace`,
    '--mount', `type=bind,source=${repository},target=/repository`,
    '--mount', `type=bind,source=${settingsPath},target=/settings.xml,readonly`,
    '--workdir', '/workspace', '--entrypoint', 'mvn', PINNED_MAVEN_IMAGE,
    '-B', '-ntp', '-s', '/settings.xml', '-Dmaven.repo.local=/repository',
    '-DskipTests=false', '-Dmaven.test.skip=false', '-Dmaven.test.failure.ignore=false',
    'clean', 'install',
  ] };
}

export function inspectStarterJar(bytes, sourcePaths, artifact) {
  assert.ok(Buffer.isBuffer(bytes) && bytes.length > 0, 'Missing source-built starter JAR');
  const result = spawnSync('python3', ['-I', '-c', String.raw`
import hashlib, io, json, stat, sys, zipfile
try:
    entries, classes, seen = [], [], set()
    with zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())) as archive:
        for info in archive.infolist():
            path = info.filename
            if (not path or path.startswith("/") or "\\" in path or
                any(not part or part in (".", "..") or ":" in part for part in path.rstrip("/").split("/"))
                or path in seen or stat.S_ISLNK(info.external_attr >> 16) or info.flag_bits & 1):
                raise ValueError("Unsafe/duplicate output entry")
            seen.add(path)
            if info.is_dir():
                continue
            if path.endswith((".jar", ".war")):
                raise ValueError("Nested compiled dependency in starter output")
            data = archive.read(info)
            entries.append({"path": path, "bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()})
            if path.endswith(".class"):
                if len(data) < 8 or data[:4] != b"\xca\xfe\xba\xbe" or int.from_bytes(data[6:8], "big") != 52:
                    raise ValueError("Wrong/malformed Java 8 bytecode")
                classes.append(path)
    json.dump({"entries": sorted(entries, key=lambda item: item["path"]), "classes": sorted(classes)}, sys.stdout)
except Exception:
    sys.stderr.write("Invalid source-built starter JAR")
    sys.exit(1)
`], { input: bytes, encoding: 'utf8', timeout: 30_000, maxBuffer: 16 * 1024 * 1024 });
  assert.ok(!result.error && result.status === 0 && !result.signal, 'Invalid source-built starter JAR');
  const parsed = JSON.parse(result.stdout);
  assert.ok(parsed.classes.length > 0, 'No compiled Java classes in starter JAR');
  const expected = sourcePaths.filter(path => path.endsWith('.java') && !path.endsWith('/package-info.java'))
    .map(path => path.replace(/^src\/main\/java\//, '').slice(0, -5) + '.class');
  assert.ok(expected.length > 0, 'No expected editable Java classes');
  for (const path of expected) assert.ok(parsed.classes.includes(path), `Missing compiled editable source: ${path}`);
  assert.ok(parsed.entries.some(entry =>
    entry.path === `META-INF/maven/cn.ibizlab.plugin/${artifact}/pom.xml`), 'Missing output Maven identity');
  return parsed;
}

function run(directories, destination, name, command, execute, timeout) {
  const fd = fs.openSync(directories.entry(destination, name),
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  let result;
  try {
    result = execute(command.executable, command.args, {
      stdio: ['ignore', fd, fd], timeout, env: { ...process.env, LC_ALL: 'C' },
    });
  } catch (error) { result = { status: null, error }; }
  finally { fs.closeSync(fd); }
  const data = read(directories, join(destination.path, name));
  return { ...command, exitCode: result.status ?? null, signal: result.signal ?? null,
    error: result.error?.message ?? null, log: { path: name, bytes: data.length, sha256: hash(data) } };
}

export function buildStandaloneUaaStarters({
  workspace = workspaceRoot, sourceReport, parentReport, output, execute = spawnSync,
} = {}) {
  assert.ok(typeof sourceReport === 'string' && typeof parentReport === 'string',
    'Both pinned acquisition reports are required');
  workspace = resolve(workspace);
  const parent = join(workspace, '.artifacts/standalone-uaa-starter-build');
  output = resolve(output ?? join(parent, `build-${randomUUID()}`));
  assert.equal(dirname(output), parent, 'Output must be a new standalone UAA starter build directory');
  const directories = new PinnedDirectories();
  let destination;
  const report = {
    schemaVersion: 1, contract: 'standalone-uaa-starter-docker-compilation-v1',
    target: 'uaa-standalone-sys-person', startedAt: new Date().toISOString(),
    status: 'failed', javaCompilationVerified: false, compilerBuildInDockerVerified: false,
    standaloneSourceBuildVerified: false, nativeAcceptance: false, acceptedForProduction: false,
    commands: [], packages: [], image: null, inputReceipts: [],
    sourceInputs: { contract: 'source-build-input-inventory-v1', before: null, after: null },
    errors: [], limitations: [
      'This lane compiles two published starter Java source trees, not the standalone UAA API/core/user.',
      'Original runtime resources, runtime bytecode parity and effective authentication remain unverified.',
      'No runtime deployment, native acceptance or global S06/D01 completion is claimed.',
    ],
  };
  try {
    const sourceBytes = read(directories, resolve(sourceReport));
    const parentBytes = read(directories, resolve(parentReport));
    const acquired = JSON.parse(sourceBytes);
    const acquiredParent = JSON.parse(parentBytes);
    assert.equal(acquired.contract, 'standalone-uaa-starter-source-acquisition-v1');
    assert.equal(acquired.status, 'acquired-not-built');
    assert.equal(acquiredParent.contract, 'standalone-uaa-parent-acquisition-v1');
    assert.equal(acquiredParent.status, 'acquired-not-built');
    assert.equal(acquired.nativeAcceptance, false);
    assert.equal(acquiredParent.nativeAcceptance, false);
    assert.equal(acquired.packages.length, UAA_STARTER_SOURCE_PINS.length);
    const pom = read(directories, join(dirname(resolve(parentReport)), 'pom.xml'));
    assert.equal(hash(pom), UAA_PARENT_PIN.sha256, 'Pinned parent POM changed');
    parseUaaParentPom(pom);
    const parsedPackages = UAA_STARTER_SOURCE_PINS.map((pin, index) => {
      const item = acquired.packages[index];
      assert.equal(item.artifact, pin.artifact);
      assert.equal(item.version, pin.version);
      const archiveName = `${pin.artifact}-${pin.version}-sources.jar`;
      const archive = read(directories, join(dirname(resolve(sourceReport)), archiveName));
      assert.equal(hash(archive), pin.sha256, 'Pinned starter source archive changed');
      const parsed = parseUaaStarterSource(archive, pin);
      const files = parsed.files.map(({ base64, ...file }) => file);
      assert.deepEqual(item.files, files, 'Acquisition source inventory changed');
      assert.equal(item.sourceRoot, `sources/${pin.artifact}`);
      for (const file of files) {
        assert.equal(hash(read(directories, join(dirname(resolve(sourceReport)), item.sourceRoot, file.path))),
          file.sha256, 'Acquired editable source changed');
      }
      return { pin, parsed };
    });
    destination = directories.open(output, { create: true, exclusive: true });
    const source = join(output, 'source');
    const repository = join(output, 'repository');
    directories.open(source, { create: true, exclusive: true });
    directories.open(repository, { create: true, exclusive: true });
    const write = (path, bytes) => directories.write(
      directories.open(dirname(path), { create: true }), basename(path), bytes);
    write(join(source, 'pom.xml'), reactor);
    write(join(output, 'settings.xml'), settings);
    write(join(source, UAA_PARENT_PIN.artifact, 'pom.xml'), pom);
    for (const { pin, parsed } of parsedPackages) {
      for (const file of parsed.files) write(join(source, pin.artifact, file.path), Buffer.from(file.base64, 'base64'));
    }
    report.inputReceipts = [
      { path: resolve(sourceReport), sha256: hash(sourceBytes) },
      { path: resolve(parentReport), sha256: hash(parentBytes) },
    ];
    report.settingsSha256 = hash(settings);
    report.sourceInputs.before = sourceBuildInputs(source);
    const inspection = run(directories, destination, 'image.json', {
      executable: 'docker', args: ['image', 'inspect', '--format', '{{json .}}', PINNED_MAVEN_IMAGE],
    }, execute, 30_000);
    report.commands.push(inspection);
    assert.ok(success(inspection), 'Pinned Maven image inspection failed');
    const image = JSON.parse(read(directories, join(output, 'image.json')));
    assert.ok(/^sha256:[a-f0-9]{64}$/.test(image.Id), 'Invalid Maven image identity');
    assert.equal(image.Os, 'linux');
    assert.equal(image.Architecture, 'arm64');
    assert.ok(image.RepoDigests.includes(PINNED_MAVEN_IMAGE), 'Pinned Maven image digest mismatch');
    report.image = { reference: PINNED_MAVEN_IMAGE, id: image.Id, platform: 'linux/arm64' };
    const compilation = run(directories, destination, 'maven.log', starterDockerCommand({
      source, repository, settingsPath: join(output, 'settings.xml'),
      containerName: `uaa-starters-${randomUUID()}`, uid: process.geteuid(), gid: process.getegid(),
    }), execute, 900_000);
    report.commands.push(compilation);
    assert.ok(success(compilation), 'Standalone starter Java compilation failed; inspect retained maven.log');
    report.sourceInputs.after = sourceBuildInputs(source);
    assert.deepEqual(report.sourceInputs.after, report.sourceInputs.before, 'Editable build inputs changed');
    for (const { pin, parsed } of parsedPackages) {
      const path = `${pin.artifact}/target/${pin.artifact}-${pin.version}.jar`;
      const bytes = read(directories, join(source, path));
      const jar = inspectStarterJar(bytes, parsed.files.map(file => file.path), pin.artifact);
      const installedPath = join(repository, 'cn/ibizlab/plugin', pin.artifact, pin.version,
        `${pin.artifact}-${pin.version}.jar`);
      assert.equal(hash(read(directories, installedPath)), hash(bytes), 'Installed own dependency differs from build');
      report.packages.push({ artifact: pin.artifact, version: pin.version,
        javaSources: parsed.files.filter(file => file.path.endsWith('.java')).length,
        artifactPath: `source/${path}`, bytes: bytes.length, sha256: hash(bytes), ...jar });
    }
    assert.equal(hash(read(directories, resolve(sourceReport))), hash(sourceBytes), 'Source receipt changed during build');
    assert.equal(hash(read(directories, resolve(parentReport))), hash(parentBytes), 'Parent receipt changed during build');
    assert.equal(hash(read(directories, join(output, 'settings.xml'))), hash(settings), 'Repository settings changed');
    report.status = 'java-compiled-not-native-accepted';
    report.javaCompilationVerified = true;
    report.compilerBuildInDockerVerified = true;
  } catch (error) {
    if (!destination) throw error;
    report.errors.push(error.message);
  } finally { if (!destination) directories.close(); }
  try {
    report.finishedAt = new Date().toISOString();
    const bytes = jsonBytes(report);
    directories.write(destination, 'report.json', bytes);
    directories.write(destination, 'report.sha256', Buffer.from(`${hash(bytes)}\n`));
    return { report, reportPath: join(output, 'report.json') };
  } finally { directories.close(); }
}

export function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({ args: argv, options: {
    'source-report': { type: 'string' }, 'parent-report': { type: 'string' }, output: { type: 'string' },
  } });
  const { report, reportPath } = buildStandaloneUaaStarters({
    sourceReport: values['source-report'], parentReport: values['parent-report'], output: values.output,
  });
  console.log(JSON.stringify({ reportPath, status: report.status,
    javaCompilationVerified: report.javaCompilationVerified,
    compilerBuildInDockerVerified: report.compilerBuildInDockerVerified,
    standaloneSourceBuildVerified: false, nativeAcceptance: false,
    packages: report.packages.map(({ artifact, javaSources, classes }) =>
      ({ artifact, javaSources, compiledClasses: classes.length })), errors: report.errors }, null, 2));
  return report.javaCompilationVerified ? 2 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
