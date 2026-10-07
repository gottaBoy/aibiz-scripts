#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { PinnedDirectories, readPinnedFile } from './native-candidate-files.mjs';

const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const jsonBytes = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const maxArchiveBytes = 4 * 1024 * 1024;
export const UAA_STARTER_SOURCE_PINS = Object.freeze([
  Object.freeze({
    artifact: 'ibizlab-boot-starter', version: '2.6.12.10',
    sha256: 'fd8ea741daf620cb2f263bd134350e8cd81b938df35108f44119068978993f75',
  }),
  Object.freeze({
    artifact: 'ibizlab-boot-starter-data', version: '2.6.12.10',
    sha256: '87d45ef2cde4709686d623845a0d4e2685a3c59dc964417eebf25bcb85e94a37',
  }),
]);
export const UAA_PARENT_PIN = Object.freeze({
  group: 'cn.ibizlab.plugin', artifact: 'ibizlab-boot-starter-parent', version: '2.6.12.10',
  sha256: 'a407c5dc8ad0443d1cd655ba888fa60760ebb0671c9dda6e628c924ae5bac2b2',
  url: 'https://repo.maven.apache.org/maven2/cn/ibizlab/plugin/ibizlab-boot-starter-parent/2.6.12.10/ibizlab-boot-starter-parent-2.6.12.10.pom',
});

export function parseUaaParentPom(bytes) {
  assert.ok(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= 1024 * 1024,
    'Invalid parent POM size');
  const result = spawnSync('python3', ['-I', '-c', String.raw`
import json, sys
import xml.etree.ElementTree as ET
from xml.parsers import expat
def reject(*args):
    raise ValueError("DTD/entities are forbidden")
try:
    data = sys.stdin.buffer.read()
    parser = expat.ParserCreate()
    parser.StartDoctypeDeclHandler = reject
    parser.EntityDeclHandler = reject
    parser.ExternalEntityRefHandler = reject
    parser.Parse(data, True)
    root = ET.fromstring(data)
    ns = "{http://maven.apache.org/POM/4.0.0}"
    if root.tag != ns + "project":
        raise ValueError("Unexpected Maven project")
    def text(node, tag):
        values = node.findall(ns + tag) if node is not None else []
        if len(values) != 1 or not values[0].text:
            raise ValueError("Missing/ambiguous Maven field")
        return values[0].text.strip()
    coordinate = {key: text(root, tag) for key, tag in
                  (("group", "groupId"), ("artifact", "artifactId"), ("version", "version"))}
    parents = root.findall(ns + "parent")
    if len(parents) != 1 or text(root, "packaging") != "pom":
        raise ValueError("Unexpected Maven parent/packaging")
    parent = {key: text(parents[0], tag) for key, tag in
              (("group", "groupId"), ("artifact", "artifactId"), ("version", "version"))}
    json.dump({"coordinate": coordinate, "parent": parent}, sys.stdout)
except Exception:
    sys.stderr.write("Invalid standalone UAA parent POM")
    sys.exit(1)
`], { input: bytes, encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024 });
  assert.ok(!result.error && result.status === 0 && !result.signal, 'Invalid standalone UAA parent POM');
  const parsed = JSON.parse(result.stdout);
  assert.deepEqual(parsed.coordinate, {
    group: UAA_PARENT_PIN.group, artifact: UAA_PARENT_PIN.artifact, version: UAA_PARENT_PIN.version,
  }, 'Parent POM coordinate mismatch');
  assert.deepEqual(parsed.parent, {
    group: 'org.springframework.boot', artifact: 'spring-boot-starter-parent', version: '2.6.14',
  }, 'Parent Spring Boot version mismatch');
  return parsed;
}

// Parse ZIP and POM from pinned bytes; do not let an archive choose output paths.
const parser = String.raw`
import base64, hashlib, io, json, stat, sys, zipfile
import xml.etree.ElementTree as ET
from xml.parsers import expat
def reject(*args):
    raise ValueError("DTD/entities are not allowed")
payload = sys.stdin.buffer.read()
expected = sys.argv[1]
version = sys.argv[2]
entries, files, seen = [], [], set()
size = 0
pom_name = "META-INF/maven/cn.ibizlab.plugin/" + expected + "/pom.xml"
with zipfile.ZipFile(io.BytesIO(payload)) as archive:
    infos = archive.infolist()
    if len(infos) > 2000:
        raise ValueError("Archive entry count limit exceeded")
    for info in infos:
        name = info.filename
        parts = name.rstrip("/").split("/")
        if (not name or "\\" in name or name.startswith("/") or
            any(not part or part in (".", "..") or ":" in part or
                any(ord(char) < 32 or ord(char) == 127 for char in part) for part in parts)):
            raise ValueError("Unsafe archive entry")
        if name in seen:
            raise ValueError("Duplicate archive entry")
        seen.add(name)
        if stat.S_ISLNK(info.external_attr >> 16) or info.flag_bits & 1:
            raise ValueError("Symlink/encrypted archive entry")
        size += info.file_size
        if info.file_size > 1024 * 1024 or size > 16 * 1024 * 1024:
            raise ValueError("Archive size limit exceeded")
        if info.is_dir():
            continue
        # Only published Java sources and their POM are read or extracted.
        if not (name.startswith("cn/ibizlab/") and name.endswith(".java") or name == pom_name):
            if name.endswith(".class") or name.endswith((".jar", ".war")):
                raise ValueError("Compiled input in source archive")
            entries.append({"path": name, "bytes": info.file_size, "selected": False})
            continue
        data = archive.read(info)
        if not data:
            raise ValueError("Empty source input")
        target = "pom.xml" if name == pom_name else "src/main/java/" + name
        files.append({"path": target, "archivePath": name, "bytes": len(data),
                      "sha256": hashlib.sha256(data).hexdigest(),
                      "base64": base64.b64encode(data).decode("ascii")})
    matches = [item for item in files if item["path"] == "pom.xml"]
    if len(matches) != 1:
        raise ValueError("Missing Maven POM")
    pom = base64.b64decode(matches[0]["base64"])
    xml = expat.ParserCreate()
    xml.StartDoctypeDeclHandler = reject
    xml.ExternalEntityRefHandler = reject
    xml.Parse(pom, True)
    root = ET.fromstring(pom)
    ns = "{http://maven.apache.org/POM/4.0.0}"
    if root.tag != ns + "project":
        raise ValueError("Unexpected Maven project")
    def text(parent, tag):
        value = parent.find(ns + tag)
        return value.text.strip() if value is not None and value.text else None
    parent = root.find(ns + "parent")
    group = text(root, "groupId") or (text(parent, "groupId") if parent is not None else None)
    actual_version = text(root, "version") or (text(parent, "version") if parent is not None else None)
    if (group, text(root, "artifactId"), actual_version) != ("cn.ibizlab.plugin", expected, version):
        raise ValueError("Maven source coordinate mismatch")
    java = [item for item in files if item["path"].endswith(".java")]
    if not java:
        raise ValueError("No editable Java sources")
    result = {"coordinate": {"group": group, "artifact": expected, "version": version},
              "parent": None if parent is None else
                {"group": text(parent, "groupId"), "artifact": text(parent, "artifactId"),
                 "version": text(parent, "version")},
              "files": sorted(files, key=lambda item: item["path"]),
              "excludedEntries": sorted(entries, key=lambda item: item["path"])}
json.dump(result, sys.stdout)
`;

export function parseUaaStarterSource(bytes, pin, {
  python = 'python3', execute = spawnSync,
} = {}) {
  assert.ok(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= maxArchiveBytes,
    'Invalid source archive size');
  const result = execute(python, ['-I', '-c', parser, pin.artifact, pin.version], {
    input: bytes, encoding: 'utf8', timeout: 30_000, maxBuffer: 32 * 1024 * 1024,
  });
  assert.ok(!result.error && result.status === 0 && !result.signal,
    `Invalid source archive: ${result.error?.message ?? result.stderr ?? result.signal}`);
  return JSON.parse(result.stdout);
}

export function uaaStarterSourceUrl(pin) {
  assert.ok(UAA_STARTER_SOURCE_PINS.some(candidate =>
    candidate.artifact === pin.artifact && candidate.version === pin.version
      && candidate.sha256 === pin.sha256), 'Unpinned standalone UAA source');
  return `https://repo.maven.apache.org/maven2/cn/ibizlab/plugin/${pin.artifact}/${pin.version}/${pin.artifact}-${pin.version}-sources.jar`;
}

async function fetchBytes(url, fetchImpl) {
  const response = await fetchImpl(url, {
    redirect: 'error', credentials: 'omit', signal: AbortSignal.timeout(30_000),
    headers: { Accept: 'application/java-archive' },
  });
  assert.equal(response.status, 200, 'Published source download failed');
  const reader = response.body?.getReader();
  assert.ok(reader, 'Missing source response body');
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      assert.ok(size <= maxArchiveBytes, 'Source download size limit exceeded');
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks);
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function fetchStandaloneUaaParent({
  workspace = workspaceRoot, output, fetchImpl = globalThis.fetch,
} = {}) {
  const parent = join(resolve(workspace), '.artifacts/standalone-uaa-parent-fetch');
  output = resolve(output ?? join(parent, `fetch-${randomUUID()}`));
  assert.equal(dirname(output), parent, 'Output must be a new standalone UAA parent acquisition directory');
  const directories = new PinnedDirectories();
  try {
    const destination = directories.open(output, { create: true, exclusive: true });
    const bytes = await fetchBytes(UAA_PARENT_PIN.url, fetchImpl);
    assert.equal(hash(bytes), UAA_PARENT_PIN.sha256, 'Published parent POM hash mismatch');
    const parsed = parseUaaParentPom(bytes);
    directories.write(destination, 'pom.xml', bytes);
    verifyFile(directories, output, { path: 'pom.xml', bytes: bytes.length, sha256: UAA_PARENT_PIN.sha256 });
    const report = {
      schemaVersion: 1, contract: 'standalone-uaa-parent-acquisition-v1',
      generatedAt: new Date().toISOString(), status: 'acquired-not-built',
      target: 'uaa-standalone-sys-person', ...parsed, url: UAA_PARENT_PIN.url,
      file: { path: 'pom.xml', bytes: bytes.length, sha256: UAA_PARENT_PIN.sha256 },
      repositoryAuthenticityVerified: false, licenseAuthenticated: false,
      sourceBuildVerified: false, compilerBuildInDockerVerified: false, nativeAcceptance: false,
    };
    const record = jsonBytes(report);
    directories.write(destination, 'report.json', record);
    directories.write(destination, 'report.sha256', Buffer.from(`${hash(record)}\n`));
    return { report, reportPath: join(output, 'report.json') };
  } finally { directories.close(); }
}

function verifyFile(directories, root, file) {
  const path = join(root, file.path);
  const { data } = readPinnedFile(directories, directories.open(dirname(path)), basename(path));
  assert.equal(data.length, file.bytes, 'Acquired source size changed');
  assert.equal(hash(data), file.sha256, 'Acquired source bytes changed');
}

export async function fetchStandaloneUaaSources({
  workspace = workspaceRoot, output, fetchImpl = globalThis.fetch,
} = {}) {
  const parent = join(resolve(workspace), '.artifacts/standalone-uaa-source-fetch');
  output = resolve(output ?? join(parent, `fetch-${randomUUID()}`));
  assert.equal(dirname(output), parent, 'Output must be a new standalone UAA acquisition directory');
  const directories = new PinnedDirectories();
  const packages = [];
  try {
    const destination = directories.open(output, { create: true, exclusive: true });
    for (const pin of UAA_STARTER_SOURCE_PINS) {
      const url = uaaStarterSourceUrl(pin);
      const archive = await fetchBytes(url, fetchImpl);
      assert.equal(hash(archive), pin.sha256, 'Published source archive hash mismatch');
      const parsed = parseUaaStarterSource(archive, pin);
      const archiveName = `${pin.artifact}-${pin.version}-sources.jar`;
      directories.write(destination, archiveName, archive);
      const packageRoot = join(output, 'sources', pin.artifact);
      const files = [];
      for (const file of parsed.files) {
        const bytes = Buffer.from(file.base64, 'base64');
        assert.equal(hash(bytes), file.sha256);
        const target = join(packageRoot, file.path);
        directories.write(directories.open(dirname(target), { create: true }), basename(target), bytes);
        const { base64, ...record } = file;
        files.push(record);
        verifyFile(directories, packageRoot, record);
      }
      verifyFile(directories, output, { path: archiveName, bytes: archive.length, sha256: pin.sha256 });
      packages.push({
        ...parsed.coordinate, parent: parsed.parent, url,
        sourceKind: 'published-source-archive', repositoryAuthenticityVerified: false,
        licenseAuthenticated: false,
        archive: { path: archiveName, bytes: archive.length, sha256: pin.sha256 },
        sourceRoot: `sources/${pin.artifact}`, files,
        excludedEntries: parsed.excludedEntries,
        sourceBuildVerified: false, runtimeCompatibilityVerified: false,
      });
    }
    for (const item of packages) {
      for (const file of item.files) verifyFile(directories, join(output, item.sourceRoot), file);
    }
    const report = {
      schemaVersion: 1, contract: 'standalone-uaa-starter-source-acquisition-v1',
      generatedAt: new Date().toISOString(), status: 'acquired-not-built',
      target: 'uaa-standalone-sys-person', packages,
      summary: { packages: packages.length,
        javaFiles: packages.reduce((total, item) =>
          total + item.files.filter(file => file.path.endsWith('.java')).length, 0) },
      standaloneBusinessSourceComplete: false, sourceBuildVerified: false,
      compilerBuildInDockerVerified: false, nativeAcceptance: false,
      limitations: [
        'Published starter sources are only two dependencies, not uaa-api/core/user business source.',
        'Matching Maven coordinates do not prove matching runtime bytecode or semantic behavior.',
        'Source build, parent/toolchain closure, protocol and effective encoder remain unverified.',
        'No keypair, credential, configuration or compiled own implementation is extracted.',
        'This receipt must not satisfy S06, D01, N01-N04 or H01 by itself.',
      ],
    };
    const bytes = jsonBytes(report);
    directories.write(destination, 'report.json', bytes);
    directories.write(destination, 'report.sha256', Buffer.from(`${hash(bytes)}\n`));
    return { report, reportPath: join(output, 'report.json') };
  } finally {
    directories.close();
  }
}

export async function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({ args: argv, options: {
    output: { type: 'string' }, parent: { type: 'boolean', default: false },
  } });
  if (values.parent) {
    const { report, reportPath } = await fetchStandaloneUaaParent({ output: values.output });
    console.log(JSON.stringify({ reportPath, coordinate: report.coordinate,
      status: report.status, nativeAcceptance: false }, null, 2));
    return 0;
  }
  const { report, reportPath } = await fetchStandaloneUaaSources({ output: values.output });
  console.log(JSON.stringify({ reportPath, ...report.summary,
    status: report.status, nativeAcceptance: false }, null, 2));
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().then(code => { process.exitCode = code; }).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
