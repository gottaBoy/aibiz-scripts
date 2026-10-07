#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { fingerprint, optionalStat, PinnedDirectories, readPinnedFile, readTree } from './native-candidate-files.mjs';
import { sourceBuildInputs } from './source-build-identity.mjs';
import {
  GENERATED_DEPLOYMENT_ARCHIVES, MODELING_CORE_MODULE, parseSurefireSuites,
  PINNED_MAVEN_IMAGE, verifyModelingPermissionRegression,
} from './harness-modeling-permission-regression.mjs';

const defaultWorkspace = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const contract = 'isolated-backend-source-package-v1';
const hash = data => createHash('sha256').update(data).digest('hex');
const success = command => command?.exitCode === 0 && command.signal === null && command.error === null;
const sourceOptions = { generatedArtifacts: GENERATED_DEPLOYMENT_ARCHIVES };
export const SAAS_MODULE = 'libs/ibiz-cloud-saas-core';
export const RUNNER_MODULE = 'ibiz-service-runner/ibizservicerunner-core';
export const EMPTY_PLACEHOLDERS = Object.freeze([
  'libs/ibiz-model-util/target/surefire-reports/TEST-net.ibizsys.model.util.merger.Test1.xml',
  'libs/ibiz-psmodel-runtime/target/surefire-reports/TEST-net.ibizsys.psmodel.runtime.Test.xml',
  'libs/ibiz-psmodel-runtime/target/surefire-reports/TEST-net.ibizsys.psmodel.runtime.Test2.xml',
]);
const deployments = [
  { path: GENERATED_DEPLOYMENT_ARCHIVES[0], module: 'ibiz-ebsx-gateway',
    startClass: 'net.ibizsys.ebsx.gateway.boot.EBSXGatewayApplication', embeddedModules: [] },
  { path: GENERATED_DEPLOYMENT_ARCHIVES[1], module: 'ibiz-ebsx-runtime',
    startClass: 'net.ibizsys.ebsx.allinone.boot.EBSXAllInOneApplication', embeddedModules: [SAAS_MODULE] },
  { path: GENERATED_DEPLOYMENT_ARCHIVES[2], module: 'ibiz-service-runner/ibizservicerunner-provider',
    startClass: 'cn.ibizlab.runner.servicerunner.IBizRuntimeApplication',
    embeddedModules: [MODELING_CORE_MODULE, RUNNER_MODULE] },
];

function childOf(parent, path) {
  assert.equal(typeof path, 'string', 'Required path missing');
  const absolute = resolve(parent, path);
  const child = relative(parent, absolute);
  assert.ok(child && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child),
    'Path must be inside its required root');
  return absolute;
}

function disjoint(left, right) {
  const contains = (parent, path) => {
    const child = relative(parent, path);
    return !child || (!isAbsolute(child) && child !== '..' && !child.startsWith(`..${sep}`));
  };
  assert.ok(!contains(left, right) && !contains(right, left), 'Overlapping input/output paths rejected');
}

function read(path) {
  const directories = new PinnedDirectories();
  try { return readPinnedFile(directories, directories.open(dirname(path)), basename(path)).data; }
  finally { directories.close(); }
}

// Fat deployment JARs exceed readPinnedFile's limit. Hash the pinned descriptor
// in bounded chunks, checking both inode and mutation metadata around the read.
function withFile(path, callback) {
  const directories = new PinnedDirectories();
  let fd;
  try {
    const parent = directories.open(dirname(path));
    const entry = directories.entry(parent, basename(path));
    const before = fs.lstatSync(entry);
    assert.ok(before.isFile() && !before.isSymbolicLink(), 'Nonregular archive rejected');
    assert.ok(before.size > 0 && before.size <= 2 * 1024 ** 3, 'Empty/oversized archive rejected');
    fd = fs.openSync(entry, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
    const signature = info => [info.dev, info.ino, info.size, info.mtimeMs, info.ctimeMs];
    assert.deepEqual(signature(fs.fstatSync(fd)), signature(before), 'Archive changed while opening');
    const digest = createHash('sha256');
    const buffer = Buffer.alloc(1024 * 1024);
    let offset = 0;
    let count;
    while ((count = fs.readSync(fd, buffer, 0, buffer.length, offset)) > 0) {
      digest.update(buffer.subarray(0, count));
      offset += count;
    }
    assert.equal(offset, before.size, 'Archive length changed');
    const result = callback(fd, { bytes: offset, sha256: digest.digest('hex') });
    assert.deepEqual(signature(fs.fstatSync(fd)), signature(before), 'Archive changed while reading');
    assert.deepEqual(signature(fs.lstatSync(entry)), signature(before), 'Archive path changed while reading');
    directories.verify(parent);
    return result;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
    directories.close();
  }
}

const zipParser = String.raw`
import hashlib, json, stat, sys, zipfile
entries, seen = [], set()
with zipfile.ZipFile("/proc/self/fd/3") as archive:
    if len(archive.infolist()) > 100000:
        raise ValueError("Too many archive entries")
    total = 0
    for info in archive.infolist():
        path = info.filename
        if (not path or path.startswith("/") or "\\" in path or
            any(not part or part in (".", "..") or ":" in part for part in path.rstrip("/").split("/"))
            or path in seen or stat.S_ISLNK(info.external_attr >> 16) or info.flag_bits & 1):
            raise ValueError("Unsafe/duplicate archive entry")
        seen.add(path)
        if info.is_dir():
            continue
        total += info.file_size
        if total > 4 * 1024**3 or info.file_size > 2 * 1024**3:
            raise ValueError("Oversized archive entries")
        digest, size = hashlib.sha256(), 0
        with archive.open(info) as member:
            for block in iter(lambda: member.read(1024 * 1024), b""):
                digest.update(block)
                size += len(block)
        if size != info.file_size:
            raise ValueError("Archive entry length mismatch")
        entries.append({"path": path, "bytes": size, "sha256": digest.hexdigest()})
    raw = archive.read("META-INF/MANIFEST.MF")
    if len(raw) > 65536:
        raise ValueError("Oversized archive manifest")
    logical = []
    for line in raw.decode("utf-8").replace("\r\n", "\n").split("\n"):
        if not line:
            break
        if line.startswith(" "):
            if not logical:
                raise ValueError("Malformed manifest continuation")
            logical[-1] += line[1:]
        else:
            logical.append(line)
    manifest = {}
    for line in logical:
        key, separator, value = line.partition(": ")
        if not separator or key in manifest:
            raise ValueError("Malformed/duplicate manifest attribute")
        manifest[key] = value
    json.dump({"entries": sorted(entries, key=lambda item: item["path"]),
               "manifest": {key: manifest.get(key) for key in
                            ("Main-Class", "Start-Class", "Spring-Boot-Version")}}, sys.stdout)
`;

export function inspectBackendArchive(path, { python = 'python3' } = {}) {
  return withFile(path, (fd, identity) => {
    const parsed = spawnSync(python, ['-I', '-c', zipParser], {
      stdio: ['ignore', 'pipe', 'pipe', fd], encoding: 'utf8',
      timeout: 120_000, maxBuffer: 32 * 1024 * 1024,
    });
    assert.ok(!parsed.error && parsed.status === 0 && !parsed.signal,
      `Invalid backend archive: ${parsed.error?.message ?? parsed.stderr}`);
    const result = JSON.parse(parsed.stdout);
    assert.ok(result.entries.length > 0, 'Archive has no files');
    return { ...identity, ...result };
  });
}

function protectedArchives(source) {
  return GENERATED_DEPLOYMENT_ARCHIVES.map(path => {
    const absolute = join(source, path);
    return optionalStat(absolute)
      ? { path, exists: true, ...withFile(absolute, (_fd, identity) => identity) }
      : { path, exists: false };
  });
}

function freshTree(root) {
  const directories = new PinnedDirectories();
  function visit(directory) {
    for (const entry of fs.readdirSync(directory.access, { withFileTypes: true })) {
      assert.ok(!entry.isSymbolicLink(), 'Symlink in frozen inputs rejected');
      assert.notEqual(entry.name, 'target', 'Stale target outputs in frozen inputs');
      if (entry.isDirectory()) visit(directories.open(join(directory.path, entry.name)));
    }
    directories.verify(directory);
  }
  try { visit(directories.open(root)); }
  finally { directories.close(); }
  for (const path of GENERATED_DEPLOYMENT_ARCHIVES) {
    assert.ok(!optionalStat(join(root, path)), 'Stale generated deployment archive in frozen inputs');
  }
}

const classifyXml = String.raw`
import base64, json, sys
import xml.etree.ElementTree as ET
from xml.parsers import expat
def reject(*args):
    raise ValueError("DTD/entities are not allowed")
result = []
for item in json.load(sys.stdin):
    data = base64.b64decode(item["data"], validate=True)
    parser = expat.ParserCreate()
    parser.StartDoctypeDeclHandler = reject
    parser.ExternalEntityRefHandler = reject
    parser.Parse(data, True)
    root = ET.fromstring(data)
    if root.tag != "testsuite":
        raise ValueError("Expected Surefire testsuite")
    result.append({"path": item["path"], "attributes": dict(root.attrib),
                   "children": [child.tag for child in root]})
json.dump(result, sys.stdout)
`;

export function parseBackendSuites(xml, { python = 'python3' } = {}) {
  const result = spawnSync(python, ['-I', '-c', classifyXml], {
    input: JSON.stringify(xml.map(({ path, data }) => ({ path, data: Buffer.from(data).toString('base64') }))),
    encoding: 'utf8', timeout: 30_000, maxBuffer: 32 * 1024 * 1024,
  });
  assert.ok(!result.error && result.status === 0 && !result.signal, `Invalid backend XML: ${result.stderr}`);
  const classified = JSON.parse(result.stdout);
  const placeholders = [];
  const positive = [];
  for (const [index, item] of classified.entries()) {
    if (item.attributes.tests !== '0') {
      positive.push(xml[index]);
      continue;
    }
    assert.ok(EMPTY_PLACEHOLDERS.includes(item.path), 'Unknown empty suite rejected');
    assert.equal(basename(item.path), `TEST-${item.attributes.name}.xml`, 'Placeholder identity mismatch');
    for (const field of ['tests', 'failures', 'errors', 'skipped']) {
      assert.equal(item.attributes[field], '0', 'Invalid placeholder counts');
    }
    assert.ok(item.children.every(tag => ['properties', 'system-out', 'system-err'].includes(tag)),
      'Placeholder contains testcases or unsupported children');
    placeholders.push({ path: item.path, name: item.attributes.name,
      tests: 0, failures: 0, errors: 0, skipped: 0, coverage: 'none-zero-test-placeholder' });
  }
  assert.deepEqual(placeholders.map(item => item.path).sort(), [...EMPTY_PLACEHOLDERS].sort(),
    'Zero-test placeholder inventory mismatch');
  return { suites: parseSurefireSuites(positive, { python }),
    placeholders: placeholders.sort((a, b) => a.path.localeCompare(b.path)) };
}

function sourceSuites(inputs, module) {
  const prefix = `${module}/src/test/java/`;
  return inputs.entries.filter(entry => entry.path.startsWith(prefix) &&
    /^(?:Test.*|.*Test|.*Tests|.*TestCase)\.java$/.test(basename(entry.path)))
    .map(entry => entry.path.slice(prefix.length, -5).replaceAll('/', '.')).sort();
}

function auditResults(parsed, inputs, permission) {
  const modules = [
    { module: MODELING_CORE_MODULE, tests: permission.stages.find(stage => stage.stage === 'full').results.modelingCoreTests },
    { module: SAAS_MODULE, tests: 24 },
    { module: RUNNER_MODULE, tests: 36 },
  ].map(({ module, tests }) => {
    const suites = parsed.suites.filter(item => dirname(item.path) === `${module}/target/surefire-reports`);
    const expected = sourceSuites(inputs, module);
    assert.ok(expected.length > 0, `Missing source suites: ${module}`);
    assert.deepEqual(suites.map(item => item.name).sort(), expected, `Required package suite inventory mismatch: ${module}`);
    assert.equal(suites.reduce((sum, item) => sum + item.tests, 0), tests, `Required package test count mismatch: ${module}`);
    return { module, tests, suiteCount: suites.length };
  });
  assert.equal(parsed.suites.length, modules.reduce((sum, item) => sum + item.suiteCount, 0),
    'Unexpected positive suite module');
  for (const suite of parsed.suites) {
    assert.ok(suite.tests > 0, 'Required suites must have positive tests');
    assert.equal(suite.failures + suite.errors + suite.skipped, 0, `Failures/errors/skips in ${suite.name}`);
  }
  const modeling = parsed.suites.filter(item => dirname(item.path) === `${MODELING_CORE_MODULE}/target/surefire-reports`);
  const prior = permission.stages.find(stage => stage.stage === 'full').results.suites.filter(item =>
    dirname(item.path) === `${MODELING_CORE_MODULE}/target/surefire-reports`);
  assert.deepEqual(modeling, prior, 'Modeling suites/testcases do not match permission receipt');
  for (const item of parsed.placeholders) {
    const module = item.path.split('/target/')[0];
    assert.ok(sourceSuites(inputs, module).includes(item.name), 'Placeholder absent from frozen source');
  }
  return { ...parsed, modules, tests: modules.reduce((sum, item) => sum + item.tests, 0),
    suiteCount: parsed.suites.length, failures: 0, errors: 0, skipped: 0,
    placeholderCoverage: 'none; not passing workflows' };
}

function collectSurefire(worktree, inputs, permission, python) {
  const files = [];
  const xml = [];
  for (const pom of inputs.entries.filter(item => basename(item.path) === 'pom.xml')) {
    const prefix = `${dirname(pom.path)}/target/surefire-reports`.replace(/^\.\//, '');
    const root = join(worktree, prefix);
    if (!optionalStat(root)) continue;
    if (fs.readdirSync(root).length === 0) continue;
    for (const item of readTree(root, { jsonOnly: false }).contents) {
      const path = `${prefix}/${item.path}`;
      assert.ok(!/\.(?:dump|dumpstream)$/.test(path), `Surefire crash evidence: ${path}`);
      files.push({ path, bytes: item.bytes, sha256: item.sha256 });
      if (item.path.endsWith('.xml')) xml.push({ path, data: item.data });
    }
  }
  files.sort((a, b) => a.path.localeCompare(b.path));
  xml.sort((a, b) => a.path.localeCompare(b.path));
  return { reportFiles: { ...fingerprint(files), entries: files },
    results: auditResults(parseBackendSuites(xml, { python }), inputs, permission) };
}

function targetJar(worktree, module) {
  const directories = new PinnedDirectories();
  try {
    const parent = directories.open(join(worktree, module, 'target'));
    const jars = fs.readdirSync(parent.access).filter(name =>
      name.endsWith('.jar') && !/-(?:sources|javadoc|tests)\.jar$/.test(name));
    assert.equal(jars.length, 1, `Missing/ambiguous fresh target JAR: ${module}`);
    directories.verify(parent);
    const path = `${module}/target/${jars[0]}`;
    return { path, ...withFile(join(worktree, path), (_fd, identity) => identity) };
  } finally { directories.close(); }
}

const pomParser = String.raw`
import json, posixpath, re, sys
import xml.etree.ElementTree as ET
from xml.parsers import expat
def reject(*args):
    raise ValueError("DTD/entities are not allowed in source POMs")
documents = {}
for item in json.load(sys.stdin):
    parser = expat.ParserCreate()
    parser.StartDoctypeDeclHandler = reject
    parser.ExternalEntityRefHandler = reject
    parser.Parse(item["data"], True)
    root = ET.fromstring(item["data"])
    for element in root.iter():
        element.tag = element.tag.split("}")[-1]
    if root.tag != "project":
        raise ValueError("Expected source project POM")
    documents[item["path"]] = root
def text(root, path, default=None):
    node = root.find(path)
    return node.text.strip() if node is not None and node.text else default
def safe_path(base, child):
    path = posixpath.normpath(posixpath.join(base, child))
    if path.startswith("/") or path == ".." or path.startswith("../") or "\\" in path:
        raise ValueError("Source POM path escapes snapshot")
    return path
resolved, resolving = {}, set()
def effective(path):
    if path in resolved:
        return resolved[path]
    if path in resolving:
        raise ValueError("Cyclic source POM parent")
    resolving.add(path)
    root = documents[path]
    parent = root.find("parent")
    inherited = {}
    if parent is not None:
        relative = text(parent, "relativePath", "../pom.xml")
        if relative.startswith("/") or "\\" in relative:
            raise ValueError("Invalid source POM parent path")
        parent_path = posixpath.normpath(posixpath.join(posixpath.dirname(path), relative))
        if parent_path in documents and parent_path != path:
            inherited = effective(parent_path)
            for field in ("groupId", "artifactId", "version"):
                if text(parent, field) != inherited[field]:
                    raise ValueError("Local source POM parent coordinate mismatch")
    properties = dict(inherited.get("properties", {}))
    own_properties = root.find("properties")
    if own_properties is not None:
        properties.update({node.tag: (node.text or "").strip() for node in own_properties})
    values = {
        "groupId": text(root, "groupId", inherited.get("groupId") or text(root, "parent/groupId")),
        "artifactId": text(root, "artifactId"),
        "version": text(root, "version", inherited.get("version") or text(root, "parent/version")),
        "packaging": text(root, "packaging", "jar"),
    }
    def expand(value):
        if value is None:
            raise ValueError("Missing source Maven coordinate")
        for attempt in range(20):
            expanded = re.sub(r"\$\{([^}]+)\}", lambda match: properties.get(match[1], match[0]), value)
            if expanded == value:
                break
            value = expanded
        if "\${" in value:
            raise ValueError("Unresolved source Maven coordinate")
        return value
    properties.update({"project." + key: value for key, value in values.items() if value is not None})
    values = {key: expand(value) for key, value in values.items()}
    values["properties"] = properties
    resolving.remove(path)
    resolved[path] = values
    return values
visited, records, identities = set(), [], set()
def visit(path):
    if path in visited:
        raise ValueError("Ambiguous/duplicate reactor module")
    visited.add(path)
    if path not in documents:
        raise ValueError("Reactor module POM absent from frozen source")
    value = effective(path)
    coordinate = tuple(value[key] for key in ("groupId", "artifactId", "version"))
    if coordinate in identities:
        raise ValueError("Duplicate source Maven coordinate")
    identities.add(coordinate)
    records.append({"module": posixpath.dirname(path) or ".", "pom": path,
                    **{key: value[key] for key in ("groupId", "artifactId", "version", "packaging")}})
    root = documents[path]
    for node in root.findall("modules/module") + root.findall("profiles/profile/modules/module"):
        if not node.text or not node.text.strip():
            raise ValueError("Empty reactor module")
        visit(safe_path(posixpath.dirname(path), node.text.strip() + "/pom.xml"))
visit("pom.xml")
json.dump(sorted(records, key=lambda item: item["module"]), sys.stdout)
`;

function reactorCoordinates(worktree, inputs, python) {
  const poms = inputs.entries.filter(entry => basename(entry.path) === 'pom.xml');
  const parsed = spawnSync(python, ['-I', '-c', pomParser], {
    input: JSON.stringify(poms.map(entry => ({
      path: entry.path, data: read(join(worktree, entry.path)).toString('utf8'),
    }))), encoding: 'utf8', timeout: 30_000, maxBuffer: 32 * 1024 * 1024,
  });
  assert.ok(!parsed.error && parsed.status === 0 && !parsed.signal,
    `Invalid source reactor POM mapping: ${parsed.stderr}`);
  return JSON.parse(parsed.stdout).map(item => ({
    ...item, pomSha256: inputs.entries.find(entry => entry.path === item.pom).sha256,
  }));
}

function collectArchives(worktree, inputs, python) {
  const coordinates = reactorCoordinates(worktree, inputs, python);
  const coordinateByJarName = new Map();
  for (const coordinate of coordinates.filter(item => item.packaging === 'jar')) {
    const name = `${coordinate.artifactId}-${coordinate.version}.jar`;
    assert.ok(!coordinateByJarName.has(name), `Ambiguous source POM coordinate for embedded JAR: ${name}`);
    coordinateByJarName.set(name, coordinate);
  }
  const targets = coordinates.filter(item => item.packaging === 'jar' &&
    optionalStat(join(worktree, item.module, 'target')) &&
    fs.readdirSync(join(worktree, item.module, 'target')).some(name =>
      name.endsWith('.jar') && !/-(?:sources|javadoc|tests)\.jar$/.test(name)))
    .map(item => {
      const target = targetJar(worktree, item.module);
      assert.equal(basename(target.path), `${item.artifactId}-${item.version}.jar`,
        'Fresh target filename/source coordinate mismatch');
      return { ...item, ...target };
    });
  const archives = deployments.map(item => {
    const archive = inspectBackendArchive(join(worktree, item.path), { python });
    const target = targets.find(entry => entry.module === item.module);
    assert.ok(target, 'Selected deployment target absent from fresh source reactor');
    assert.notEqual(archive.sha256, target.sha256, 'Thin target JAR cannot substitute for repackage deployment');
    assert.equal(archive.manifest['Main-Class'], 'org.springframework.boot.loader.JarLauncher');
    assert.equal(archive.manifest['Start-Class'], item.startClass, 'Wrong deployment entry point');
    assert.equal(archive.manifest['Spring-Boot-Version'], '2.4.0', 'Wrong Spring Boot version');
    const classPath = `${item.startClass.replaceAll('.', '/')}.class`;
    const applicationEntries = readTree(join(worktree, item.module, 'target/classes'), { jsonOnly: false }).entries;
    const bootApplicationEntries = archive.entries.filter(entry => entry.path.startsWith('BOOT-INF/classes/'))
      .map(entry => ({ ...entry, path: entry.path.slice('BOOT-INF/classes/'.length) }))
      .sort((a, b) => a.path.localeCompare(b.path));
    const bootPaths = new Set(bootApplicationEntries.map(entry => entry.path));
    const relocatedApplicationEntries = applicationEntries.filter(entry => !bootPaths.has(entry.path))
      .map(entry => {
        assert.ok(entry.path.startsWith('META-INF/'),
          `Deployment application file missing from BOOT-INF/classes: ${entry.path}`);
        const archiveEntry = archive.entries.find(candidate => candidate.path === entry.path);
        assert.deepEqual(archiveEntry, entry, `Relocated application file differs: ${entry.path}`);
        return { ...entry, archivePath: entry.path, location: 'root-META-INF' };
      });
    const expectedBootEntries = applicationEntries.filter(entry => bootPaths.has(entry.path));
    assert.deepEqual(bootApplicationEntries, expectedBootEntries,
      'Deployment application files differ from fresh compiler/resource output');
    const mainClass = read(join(worktree, item.module, 'target/classes', classPath));
    assert.ok(mainClass.length >= 8 && mainClass.subarray(0, 4).equals(Buffer.from('cafebabe', 'hex')),
      'Missing/invalid freshly compiled entry class');
    assert.deepEqual(archive.entries.find(entry => entry.path === `BOOT-INF/classes/${classPath}`),
      { path: `BOOT-INF/classes/${classPath}`, bytes: mainClass.length, sha256: hash(mainClass) },
      'Deployment entry class differs from fresh compiler output');
    const embedded = item.embeddedModules.map(module => {
      const built = targets.find(entry => entry.module === module);
      assert.ok(built, `Required fresh embedded module missing: ${module}`);
      const path = `BOOT-INF/lib/${basename(built.path)}`;
      assert.deepEqual(archive.entries.find(entry => entry.path === path),
        { path, bytes: built.bytes, sha256: built.sha256 }, `Embedded source-built module mismatch: ${module}`);
      return { module, path, sha256: built.sha256, bytes: built.bytes };
    });
    const reactorDependencies = [];
    const unknownOwnDependencies = [];
    const embeddedLibraries = [];
    for (const entry of archive.entries.filter(entry => entry.path.startsWith('BOOT-INF/lib/') &&
      entry.path.endsWith('.jar'))) {
      const name = basename(entry.path);
      const ownArtifact = name.startsWith('ibiz');
      const coordinate = coordinateByJarName.get(name);
      const candidates = coordinates.filter(coordinate =>
        name.startsWith(`${coordinate.artifactId}-`) && coordinate.packaging === 'jar' &&
        /^\d/.test(name.slice(coordinate.artifactId.length + 1)));
      if (!coordinate) {
        assert.equal(candidates.length, 0, `Embedded source reactor version mismatch: ${name}`);
        const unknown = {
          ...entry,
          ownership: ownArtifact ? 'own-ibiz-namespace' : 'external',
          classification: ownArtifact ? 'unknown-own-binary' : 'external-binary',
          sourcePom: null,
          evidence: ownArtifact
            ? 'binary-dependency-only; no matching frozen source POM coordinate'
            : 'binary-dependency-only; not present in frozen source reactor',
        };
        embeddedLibraries.push(unknown);
        if (ownArtifact) unknownOwnDependencies.push(unknown);
        continue;
      }
      const built = targets.find(target => target.module === coordinate.module);
      assert.ok(built, `Embedded reactor dependency has no fresh target: ${coordinate.module}`);
      assert.deepEqual(entry, { path: entry.path, bytes: built.bytes, sha256: built.sha256 },
        `Embedded reactor dependency bytes mismatch: ${coordinate.module}`);
      const sourcePom = {
        path: coordinate.pom, sha256: coordinate.pomSha256, groupId: coordinate.groupId,
        artifactId: coordinate.artifactId, version: coordinate.version,
      };
      const matched = {
        module: coordinate.module, groupId: coordinate.groupId, artifactId: coordinate.artifactId,
        version: coordinate.version, sourcePom, targetPath: built.path,
        targetBytes: built.bytes, targetSha256: built.sha256, ownership: 'source-reactor',
        classification: 'reactor-source', ...entry,
      };
      embeddedLibraries.push({ ...matched, freshTarget: {
        path: built.path, bytes: built.bytes, sha256: built.sha256,
      } });
      reactorDependencies.push(matched);
    }
    return { path: item.path, module: item.module, ...archive,
      applicationEntries: { ...fingerprint(applicationEntries), entries: applicationEntries },
      bootApplicationEntries: { ...fingerprint(bootApplicationEntries), entries: bootApplicationEntries },
      relocatedApplicationEntries, embedded, embeddedLibraries,
      reactorDependencies, unknownOwnDependencies };
  });
  return { coordinates, targets, archives };
}

function copyCommand(from, to) {
  return { executable: 'rsync', args: ['-a', '--no-owner', '--no-group',
    '--exclude=.git', '--exclude=.artifacts', '--exclude=target',
    ...GENERATED_DEPLOYMENT_ARCHIVES.map(path => `--exclude=/${path}`),
    '--', `${from}/`, `${to}/`] };
}

export function backendPackageCommand({ worktree, snapshot, repository, containerName, uid, gid }) {
  assert.ok(/^backend-package-[a-f0-9-]{36}$/.test(containerName), 'Invalid isolated container name');
  for (const id of [uid, gid]) assert.ok(Number.isSafeInteger(id) && id >= 0, 'Invalid container user');
  for (const path of [worktree, snapshot, repository]) {
    assert.ok(typeof path === 'string' && isAbsolute(path) && !/[,\r\n]/.test(path), 'Invalid bind path');
  }
  disjoint(worktree, snapshot);
  disjoint(worktree, repository);
  disjoint(snapshot, repository);
  return { executable: 'docker', args: [
    'run', '--rm', '--pull=never', '--network=none', '--read-only', '--cap-drop=ALL',
    '--security-opt=no-new-privileges', '--name', containerName, '--user', `${uid}:${gid}`,
    '--tmpfs', '/tmp:rw,exec,nosuid,size=1g', '--env', 'HOME=/tmp', '--env', 'MAVEN_CONFIG=/tmp/.m2',
    '--mount', `type=bind,source=${worktree},target=/workspace/ibiz-service-hub`,
    '--mount', `type=bind,source=${snapshot},target=/snapshot,readonly`,
    '--mount', `type=bind,source=${repository},target=/maven-repository,readonly`,
    '--workdir', '/workspace/ibiz-service-hub', '--entrypoint', 'mvn', PINNED_MAVEN_IMAGE,
    '-B', '-o', '-ntp', '-Dmaven.repo.local=/maven-repository',
    '-DskipTests=false', '-Dmaven.test.skip=false', '-Dmaven.test.failure.ignore=false',
    '-Dmaven.javadoc.skip=true', '-Dmaven.source.skip=true', '-Dmaven.deploy.skip=true',
    '-Dsurefire.skipAfterFailureCount=0',
    '-pl', 'ibiz-ebsx-runtime,ibiz-ebsx-gateway,ibiz-service-runner/ibizservicerunner-provider',
    '-am', '-P', 'runtime,gateway,runner', 'package',
  ] };
}

function runCommand(directories, destination, name, command, execute, timeout) {
  directories.verify(destination);
  const fd = fs.openSync(directories.entry(destination, name),
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
  const data = readPinnedFile(directories, destination, name).data;
  return { ...command, exitCode: result.status ?? null, signal: result.signal ?? null,
    error: result.error?.message ?? null, log: { path: name, bytes: data.length, sha256: hash(data) } };
}

function imageIdentity(command, output) {
  assert.ok(success(command), 'Pinned Maven image inspection failed');
  const image = JSON.parse(read(join(output, command.log.path)));
  assert.ok(/^sha256:[a-f0-9]{64}$/.test(image.Id), 'Invalid Docker image identity');
  assert.equal(image.Os, 'linux');
  assert.ok(typeof image.Architecture === 'string' && image.Architecture, 'Missing image architecture');
  assert.ok(image.RepoDigests?.includes(PINNED_MAVEN_IMAGE), 'Pinned image digest mismatch');
  return { reference: PINNED_MAVEN_IMAGE, id: image.Id, os: image.Os, architecture: image.Architecture };
}

function permissionSummary(verified) {
  return { path: verified.reportPath, sha256: verified.reportSha256,
    focused: verified.report.stages.find(stage => stage.stage === 'focused').results.tests,
    full: verified.report.stages.find(stage => stage.stage === 'full').results.tests,
    sourceFingerprint: verified.report.sourceInputs.before.fingerprint };
}

export function runBackendSourcePackage({
  workspace = defaultWorkspace, permissionReport, output, python = 'python3', execute = spawnSync,
} = {}) {
  workspace = resolve(workspace);
  const permission = verifyModelingPermissionRegression({ workspace,
    reportPath: childOf(workspace, permissionReport), python });
  output = resolve(workspace, output ?? `.artifacts/backend-source-package-20261006-${randomUUID()}`);
  assert.equal(dirname(output), join(workspace, '.artifacts'), 'Output must be a new direct artifact directory');
  assert.ok(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(basename(output)), 'Invalid output name');
  for (const input of [permission.report.source, permission.report.output, permission.report.mavenRepository]) {
    disjoint(input, output);
  }
  assert.ok(!/[,\r\n]/.test(output), 'Invalid output bind path');
  const directories = new PinnedDirectories();
  let destination;
  const report = {
    schemaVersion: 1, contract, status: 'failed', sourcePackageVerified: false, unitRegression: false,
    nativeAcceptance: false, sourceClosure: false, acceptedForProduction: false,
    workspace, output, snapshot: join(output, 'snapshot'), repository: join(output, 'repository'),
    worktree: join(output, 'worktree'), permissionReceipt: permissionSummary(permission),
    uid: process.geteuid(), gid: process.getegid(), containerName: `backend-package-${randomUUID()}`,
    startedAt: new Date().toISOString(), commands: [], image: null, errors: [],
    sourceInputs: { contract: 'source-build-input-inventory-v1',
      generatedArtifacts: GENERATED_DEPLOYMENT_ARCHIVES, before: null, after: null },
    snapshotInputs: { before: null, after: null }, repositoryInputs: { before: null, after: null },
    originalArchives: { before: null, after: null }, originalCache: { before: null, after: null },
    reportFiles: null, results: null, packages: null,
    limitations: [
      'Package/unit evidence only: no native workflows, source closure, image/deployment or production acceptance.',
      'Binary Maven dependencies remain dependencies, not proof of reconstructed local source.',
      'The three recorded zero-test placeholder suites provide no coverage and are not passing workflows.',
    ],
  };
  const run = (name, command, timeout = 120_000) => {
    const result = runCommand(directories, destination, name, command, execute, timeout);
    report.commands.push(result);
    return result;
  };
  try {
    destination = directories.open(output, { create: true, exclusive: true });
    report.originalArchives.before = protectedArchives(permission.report.source);
    report.originalCache.before = sourceBuildInputs(permission.report.mavenRepository);
    for (const [key, from, to, name, expected] of [
      ['snapshotInputs', permission.report.snapshot, report.snapshot, 'snapshot-rsync.log', permission.report.snapshotInputs.before],
      ['repositoryInputs', permission.report.repository, report.repository, 'repository-rsync.log', permission.report.repositoryInputs.before],
    ]) {
      directories.open(to, { create: true, exclusive: true });
      assert.ok(success(run(name, copyCommand(from, to))), `${key} copy failed`);
      report[key].before = sourceBuildInputs(to);
      assert.deepEqual(report[key].before, expected, `${key} snapshot drift`);
      assert.deepEqual(sourceBuildInputs(from), expected, `${key} input drift during copy`);
    }
    freshTree(report.snapshot);
    const inspection = run('image-inspect.log', {
      executable: 'docker', args: ['image', 'inspect', '--format', '{{json .}}', PINNED_MAVEN_IMAGE],
    }, 10_000);
    report.image = imageIdentity(inspection, output);
    directories.open(report.worktree, { create: true, exclusive: true });
    assert.ok(success(run('worktree-rsync.log', copyCommand(report.snapshot, report.worktree))), 'Worktree copy failed');
    freshTree(report.worktree);
    report.sourceInputs.before = sourceBuildInputs(report.worktree, sourceOptions);
    assert.deepEqual(report.sourceInputs.before, report.snapshotInputs.before, 'Worktree input drift');
    const build = run('package.log', backendPackageCommand(report), 30 * 60_000);
    if (!success(build)) {
      report.errors.push('Maven package command failed');
      run('cleanup.log', { executable: 'docker', args: ['rm', '--force', report.containerName] }, 30_000);
    }
    Object.assign(report, collectSurefire(report.worktree, report.sourceInputs.before, permission.report, python));
    report.packages = collectArchives(report.worktree, report.sourceInputs.before, python);
  } catch (error) {
    if (!destination) throw error;
    report.errors.push(error.message);
  } finally {
    if (destination) {
      const check = callback => {
        try { callback(); } catch (error) { report.errors.push(error.message); }
      };
      for (const [key, root, options] of [
        ['sourceInputs', report.worktree, sourceOptions], ['snapshotInputs', report.snapshot, {}],
        ['repositoryInputs', report.repository, {}], ['originalCache', permission.report.mavenRepository, {}],
      ]) {
        if (!report[key].before) continue;
        check(() => {
          report[key].after = sourceBuildInputs(root, options);
          assert.deepEqual(report[key].after, report[key].before, `${key} post-build drift`);
        });
      }
      if (report.originalArchives.before) check(() => {
        report.originalArchives.after = protectedArchives(permission.report.source);
        assert.deepEqual(report.originalArchives.after, report.originalArchives.before, 'Original deployment archive drift');
      });
      check(() => {
        const verified = verifyModelingPermissionRegression({ workspace, reportPath: permission.reportPath, python });
        assert.deepEqual(permissionSummary(verified), report.permissionReceipt, 'Permission receipt drift');
      });
      report.sourcePackageVerified = report.errors.length === 0 && report.packages !== null && report.results !== null;
      report.unitRegression = report.sourcePackageVerified;
      report.status = report.sourcePackageVerified ? 'passed-package-and-unit-only' : 'failed';
      report.finishedAt = new Date().toISOString();
      try { directories.write(destination, 'report.json', `${JSON.stringify(report, null, 2)}\n`); }
      finally { directories.close(); }
    } else { directories.close(); }
  }
  return { report, reportPath: join(output, 'report.json') };
}

export function verifyBackendSourcePackage({ workspace = defaultWorkspace, reportPath, python = 'python3' } = {}) {
  workspace = resolve(workspace);
  reportPath = childOf(workspace, reportPath);
  assert.equal(basename(reportPath), 'report.json');
  const data = read(reportPath);
  const report = JSON.parse(data);
  const output = dirname(reportPath);
  assert.equal(dirname(output), join(workspace, '.artifacts'));
  assert.equal(report.contract, contract);
  assert.equal(report.schemaVersion, 1);
  assert.equal(report.workspace, workspace);
  assert.equal(report.output, output);
  for (const name of ['snapshot', 'repository', 'worktree']) assert.equal(report[name], join(output, name));
  assert.equal(report.status, 'passed-package-and-unit-only');
  assert.equal(report.sourcePackageVerified, true);
  assert.equal(report.unitRegression, true);
  for (const name of ['nativeAcceptance', 'sourceClosure', 'acceptedForProduction']) assert.equal(report[name], false);
  assert.deepEqual(report.errors, []);
  const permission = verifyModelingPermissionRegression({ workspace, reportPath: report.permissionReceipt.path, python });
  assert.deepEqual(report.permissionReceipt, permissionSummary(permission), 'Permission receipt mismatch');
  for (const input of [permission.report.output, permission.report.source, permission.report.mavenRepository]) disjoint(input, output);
  assert.equal(report.sourceInputs.contract, 'source-build-input-inventory-v1');
  assert.deepEqual(report.sourceInputs.generatedArtifacts, GENERATED_DEPLOYMENT_ARCHIVES);
  for (const [key, root, options] of [
    ['sourceInputs', report.worktree, sourceOptions], ['snapshotInputs', report.snapshot, {}],
    ['repositoryInputs', report.repository, {}], ['originalCache', permission.report.mavenRepository, {}],
  ]) {
    const current = sourceBuildInputs(root, options);
    assert.deepEqual(report[key].before, current, `${key} input inventory drift`);
    assert.deepEqual(report[key].after, current, `${key} post-build inventory drift`);
  }
  freshTree(report.snapshot);
  assert.deepEqual(report.sourceInputs.before, permission.report.sourceInputs.before);
  assert.deepEqual(report.snapshotInputs.before, permission.report.snapshotInputs.before);
  assert.deepEqual(report.repositoryInputs.before, permission.report.repositoryInputs.before);
  const originals = protectedArchives(permission.report.source);
  assert.deepEqual(report.originalArchives.before, originals, 'Original archive drift');
  assert.deepEqual(report.originalArchives.after, originals, 'Original archive post-build drift');
  const expected = [
    copyCommand(permission.report.snapshot, report.snapshot),
    copyCommand(permission.report.repository, report.repository),
    { executable: 'docker', args: ['image', 'inspect', '--format', '{{json .}}', PINNED_MAVEN_IMAGE] },
    copyCommand(report.snapshot, report.worktree), backendPackageCommand(report),
  ];
  assert.deepEqual(report.commands.map(({ executable, args }) => ({ executable, args })), expected,
    'Package/preparation commands mismatch');
  for (const [index, command] of report.commands.entries()) {
    assert.ok(success(command), 'Failed command cannot satisfy package receipt');
    assert.equal(command.log.path, ['snapshot-rsync.log', 'repository-rsync.log', 'image-inspect.log', 'worktree-rsync.log', 'package.log'][index]);
    const bytes = read(join(output, command.log.path));
    assert.deepEqual(command.log, { path: command.log.path, bytes: bytes.length, sha256: hash(bytes) }, 'Command log drift');
  }
  assert.deepEqual(report.image, imageIdentity(report.commands[2], output));
  const collected = collectSurefire(report.worktree, report.sourceInputs.before, permission.report, python);
  assert.deepEqual(report.reportFiles, collected.reportFiles, 'Surefire XML receipt drift');
  assert.deepEqual(report.results, collected.results, 'Suite/result receipt mismatch');
  assert.deepEqual(report.packages, collectArchives(report.worktree, report.sourceInputs.before, python), 'Archive receipt drift');
  assert.deepEqual(read(reportPath), data, 'Package report changed during verification');
  return { reportPath, reportSha256: hash(data), report, sourcePackageVerified: true,
    nativeAcceptance: false, sourceClosure: false, acceptedForProduction: false };
}

export function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({ args: argv, options: {
    workspace: { type: 'string' }, 'permission-report': { type: 'string' },
    output: { type: 'string' }, python: { type: 'string' }, verify: { type: 'string' }, help: { type: 'boolean' },
  } });
  if (values.help) {
    console.log('Run: node scripts/harness-backend-source-package.mjs --permission-report .artifacts/PERMISSION/report.json [--output .artifacts/NEW]\n' +
      'Verify: node scripts/harness-backend-source-package.mjs --verify .artifacts/RUN/report.json');
    return 0;
  }
  const options = { workspace: values.workspace, python: values.python };
  const result = values.verify
    ? verifyBackendSourcePackage({ ...options, reportPath: values.verify })
    : runBackendSourcePackage({ ...options, permissionReport: values['permission-report'], output: values.output });
  console.log(JSON.stringify({
    reportPath: result.reportPath, reportSha256: result.reportSha256 ?? hash(read(result.reportPath)),
    status: result.report.status, sourcePackageVerified: result.report.sourcePackageVerified,
    tests: result.report.results?.tests ?? null, placeholders: result.report.results?.placeholders ?? [],
    nativeAcceptance: false, sourceClosure: false, acceptedForProduction: false, errors: result.report.errors,
  }, null, 2));
  return result.report.sourcePackageVerified ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
