#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { PinnedDirectories, readPinnedFile } from './native-candidate-files.mjs';

const script = fileURLToPath(import.meta.url);
const defaultWorkspace = resolve(dirname(script), '..');
const contract = 'standalone-uaa-input-observation-v1';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export const OUTPUT_ROOT = '.artifacts/standalone-uaa-inputs';
export const OUTER_JAR = 'runtime-jars/ibizlab-uaa-api.jar';
export const EXTRACTED_ROOT = 'runtime-analysis/extracted/ibizlab-uaa-api';
export const OWN_JARS = Object.freeze([
  ['uaa-core', 'cn.ibizlab', '2.0.0-SNAPSHOT'],
  ['uaa-user', 'cn.ibizlab', '2.0.0-SNAPSHOT'],
  ['ibizlab-boot-starter', 'cn.ibizlab.plugin', '2.6.12.10'],
  ['ibizlab-boot-starter-data', 'cn.ibizlab.plugin', '2.6.12.10'],
].map(([artifactId, groupId, version]) => Object.freeze({
  artifactId, groupId, version, filename: `${artifactId}-${version}.jar`,
})));
const boundary = Object.freeze({
  readinessPromoted: false, originalSourceRecovered: false, sourceAuthenticityVerified: false,
  sourceClosureVerified: false, compilerBuildVerified: false, nativeAcceptance: false,
  acceptedForProduction: false,
});
const publishedSourceClues = Object.freeze({
  'cn.ibizlab.plugin:ibizlab-boot-starter:2.6.12.10':
    'fd8ea741daf620cb2f263bd134350e8cd81b938df35108f44119068978993f75',
  'cn.ibizlab.plugin:ibizlab-boot-starter-data:2.6.12.10':
    '87d45ef2cde4709686d623845a0d4e2685a3c59dc964417eebf25bcb85e94a37',
});

// Parse pinned ZIP bytes and allowlisted Maven metadata, never extract or execute
// classes/resources. No resource, configuration, key or credential text is emitted.
const parser = String.raw`
import hashlib, io, json, re, stat, sys, zipfile
import xml.etree.ElementTree as ET
from urllib.parse import urlsplit
from xml.parsers import expat

class ObservationError(Exception):
    pass

def require(ok, message):
    if not ok:
        raise ObservationError(message)

def reject(*unused):
    raise ObservationError("DTD/entities are forbidden in Maven POM")

def scalar(node, name):
    values = node.findall(name) if node is not None else []
    require(len(values) <= 1, "Ambiguous Maven field: " + name)
    return (values[0].text or "").strip() if values else None

def coordinate(value):
    require(value is not None and re.fullmatch(r"[A-Za-z0-9_.\x24{}+-]+", value),
            "Missing or invalid Maven coordinate")
    return value

def public_url(value):
    if value is None:
        return None
    candidate = value.removeprefix("scm:git:").removeprefix("scm:svn:")
    url = urlsplit(candidate)
    if (url.scheme not in ("http", "https") or not url.hostname or url.username is not None
        or url.password is not None or url.query or url.fragment or any(c.isspace() for c in candidate)):
        return {"state": "withheld-nonpublic-url"}
    return {"state": "unverified-declared-url", "url": candidate}

def properties(blob):
    text = blob.decode("iso-8859-1")
    result = {}
    for line in text.splitlines():
        line = line.strip()
        if not line or line.startswith(("#", "!")):
            continue
        require(not line.endswith("\\") and "\\" not in line, "Ambiguous Maven properties escaping")
        parts = re.split(r"\s*[=:]\s*|\s+", line, maxsplit=1)
        require(len(parts) == 2 and parts[0] not in result, "Ambiguous Maven properties")
        result[parts[0]] = parts[1].strip()
    return {name: coordinate(result.get(name)) for name in ("groupId", "artifactId", "version")}

def pom(blob):
    xml = expat.ParserCreate()
    xml.StartDoctypeDeclHandler = reject
    xml.EntityDeclHandler = reject
    xml.ExternalEntityRefHandler = reject
    xml.Parse(blob, True)
    root = ET.fromstring(blob)
    require(root.tag in ("project", "{http://maven.apache.org/POM/4.0.0}project"),
            "Unexpected Maven POM root")
    for node in root.iter():
        if node.tag.startswith("{http://maven.apache.org/POM/4.0.0}"):
            node.tag = node.tag.split("}", 1)[1]
    require(len(root.findall("parent")) <= 1, "Ambiguous Maven parent")
    parent = root.find("parent")
    parent_coords = ({name: coordinate(scalar(parent, name))
                      for name in ("groupId", "artifactId", "version")} if parent is not None else None)
    own = {name: scalar(root, name) for name in ("groupId", "artifactId", "version")}
    resolved = {name: coordinate(own[name] or ((parent_coords or {}).get(name)
                if name != "artifactId" else None)) for name in own}
    dependencies = []
    for item in root.findall("dependencies/dependency"):
        dependencies.append({name: coordinate(scalar(item, name)) if scalar(item, name) else None
                             for name in ("groupId", "artifactId", "version", "scope", "type", "classifier")})
        require(dependencies[-1]["groupId"] and dependencies[-1]["artifactId"],
                "Incomplete Maven dependency")
    urls = []
    for path in ("url", "scm/url", "scm/connection", "scm/developerConnection",
                 "repositories/repository/url", "distributionManagement/repository/url",
                 "distributionManagement/snapshotRepository/url"):
        for item in root.findall(path):
            urls.append({"field": path, **public_url((item.text or "").strip())})
    return {"coordinates": resolved, "parent": parent_coords,
            "dependencies": dependencies, "declaredSourceLookupUrls": urls}

def maven(records, contents):
    roots = sorted({name.rsplit("/", 1)[0] for name in contents
                    if re.fullmatch(r"META-INF/maven/[^/]+/[^/]+/pom\.(xml|properties)", name)})
    require(len(roots) == 1, "Expected exactly one own Maven metadata pair")
    root = roots[0]
    xml_path, props_path = root + "/pom.xml", root + "/pom.properties"
    require(xml_path in contents and props_path in contents, "Missing Maven POM/properties pair")
    declared = pom(contents[xml_path])
    coords = properties(contents[props_path])
    require(declared["coordinates"] == coords, "POM and properties coordinates differ")
    require(root == "META-INF/maven/" + coords["groupId"] + "/" + coords["artifactId"],
            "Maven metadata path and coordinates differ")
    return {**declared, "coordinates": coords,
            "pom": records[xml_path], "properties": records[props_path],
            "coordinatesMatch": True}

def inspect(blob, label, nested_names=None):
    entries, classes, resources, nested, contents, payloads = [], [], [], [], {}, {}
    records, seen = {}, set()
    with zipfile.ZipFile(io.BytesIO(blob)) as archive:
        infos = archive.infolist()
        require(len(infos) <= 100000, "ZIP entry count limit exceeded")
        require(sum(info.file_size for info in infos) <= 512 * 1024 * 1024,
                "ZIP expanded size limit exceeded")
        for info in infos:
            name = info.filename
            require(name and "\\" not in name and "!" not in name and not name.startswith("/")
                    and all(part and part not in (".", "..") and ":" not in part
                            for part in name.rstrip("/").split("/")), "Unsafe ZIP entry")
            require(name not in seen, "Duplicate ZIP entry")
            seen.add(name)
            require(not stat.S_ISLNK(info.external_attr >> 16) and not info.flag_bits & 1,
                    "Symlink/encrypted ZIP entry")
            record = {"path": name, "directory": info.is_dir(), "bytes": info.file_size,
                      "compressedBytes": info.compress_size, "compressionMethod": info.compress_type,
                      "crc32": "%08x" % info.CRC}
            if not info.is_dir():
                content = archive.read(info)
                record["sha256"] = hashlib.sha256(content).hexdigest()
                records[name] = record
                if name.startswith("META-INF/maven/") and name.endswith(("pom.xml", "pom.properties")):
                    require(len(content) <= 1024 * 1024, "Maven descriptor size limit exceeded")
                    contents[name] = content
                if name.endswith(".class"):
                    require(len(content) > 0, "Empty class entry")
                    normalized = name.removeprefix("BOOT-INF/classes/").removeprefix("WEB-INF/classes/")
                    version = None
                    match = re.match(r"META-INF/versions/(\d+)/(.*)", normalized)
                    if match:
                        version, normalized = int(match[1]), match[2]
                    binary = normalized[:-6].replace("/", ".")
                    classes.append({**record, "binaryName": binary, "release": version,
                                    "own": normalized.startswith(("cn/ibizlab/", "net/ibizsys/")),
                                    "applicationClass": name.startswith("BOOT-INF/classes/"),
                                    "inferredSourcePath": normalized[:-6].split("$", 1)[0] + ".java"})
                elif name.endswith((".jar", ".war", ".zip")):
                    nested.append(record)
                    if nested_names is not None and name in nested_names:
                        payloads[name] = content
                else:
                    resources.append(record)
            entries.append(record)
    entries.sort(key=lambda item: item["path"])
    classes.sort(key=lambda item: item["path"])
    resources.sort(key=lambda item: item["path"])
    nested.sort(key=lambda item: item["path"])
    if nested_names is not None:
        require(set(payloads) == set(nested_names), "Missing exact own nested JAR")
    else:
        require(not nested, "Unexpected archive inside an own nested JAR")
    return {"id": label, "zipEntries": entries, "classes": classes, "resources": resources,
            "nestedArchives": nested, "maven": maven(records, contents)}, payloads

try:
    names = json.loads(sys.argv[1])
    outer, payloads = inspect(sys.stdin.buffer.read(), "uaa-api", names)
    nested = [inspect(payloads[name], name)[0] for name in names]
    json.dump({"outer": outer, "nested": nested}, sys.stdout)
except Exception as error:
    # Never echo parser input or arbitrary XML/credential text.
    message = str(error) if isinstance(error, ObservationError) else "Malformed ZIP/XML input"
    json.dump({"error": message if len(message) < 160 else "Malformed ZIP/XML input"}, sys.stdout)
    sys.exit(1)
`;

function readJar(directories, workspace, path) {
  const absolute = join(workspace, path);
  const directory = directories.open(dirname(absolute));
  directories.verify(directory);
  const access = directories.entry(directory, basename(absolute));
  const before = fs.lstatSync(access);
  assert.ok(before.isFile() && !before.isSymbolicLink(), `Non-regular JAR rejected: ${path}`);
  assert.ok(before.size > 0 && before.size <= 256 * 1024 * 1024, `Invalid JAR size: ${path}`);
  const fd = fs.openSync(access, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK);
  try {
    const opened = fs.fstatSync(fd);
    assert.equal(opened.ino, before.ino, `JAR changed: ${path}`);
    assert.equal(opened.dev, before.dev, `JAR changed: ${path}`);
    const data = fs.readFileSync(fd);
    const after = fs.fstatSync(fd);
    const current = fs.lstatSync(access);
    for (const key of ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs']) {
      assert.equal(after[key], opened[key], `JAR changed during read: ${path}`);
      assert.equal(current[key], after[key], `JAR path changed during read: ${path}`);
    }
    assert.equal(data.length, opened.size, `Incomplete JAR read: ${path}`);
    directories.verify(directory);
    return { data, input: { path, bytes: data.length, sha256: hash(data) } };
  } finally { fs.closeSync(fd); }
}

function sourceClues(coordinates) {
  const { groupId, artifactId, version } = coordinates;
  const repositoryPath = `${groupId.replaceAll('.', '/')}/${artifactId}/${version}`;
  const claimedSha256 = publishedSourceClues[`${groupId}:${artifactId}:${version}`];
  return {
    state: 'lookup-clues-only-not-authenticated-source',
    mavenRepositoryPath: repositoryPath,
    expectedSourceArchive: `${repositoryPath}/${artifactId}-${version}-sources.jar`,
    expectedPom: `${repositoryPath}/${artifactId}-${version}.pom`,
    sourceJarObserved: false, originalSourceRecovered: false,
    ...(claimedSha256 ? { publishedSourceHandoff: {
      repository: 'Maven Central', claimedSha256, evidence: 'main-thread-source-acquisition-handoff',
      verifiedByThisInventory: false,
    } } : {}),
  };
}

function relationships(archives) {
  const occurrences = new Map();
  const innerClasses = [];
  for (const archive of archives) {
    for (const item of archive.classes.filter(item => item.own)) {
      const key = `${item.binaryName}@${item.release ?? 'base'}`;
      const location = { archive: archive.id, path: item.path, bytes: item.bytes, sha256: item.sha256 };
      occurrences.set(key, [...occurrences.get(key) ?? [], location]);
      if (item.binaryName.includes('$')) {
        const outerBinaryName = item.binaryName.split('$')[0];
        const outer = archive.classes.filter(candidate => candidate.binaryName === outerBinaryName
          && candidate.release === item.release);
        innerClasses.push({
          archive: archive.id, inner: item.binaryName, release: item.release, outer: outerBinaryName,
          outerPresentInSameArchive: outer.length === 1,
          evidence: 'binary-name-heuristic-not-InnerClasses-or-source-proof',
        });
      }
    }
  }
  const ownClassDuplicates = [...occurrences].filter(([, locations]) => locations.length > 1)
    .map(([identity, locations]) => ({
      identity, locations, identicalBytes: new Set(locations.map(item => item.sha256)).size === 1,
    })).sort((left, right) => left.identity.localeCompare(right.identity));
  return { ownClassDuplicates, innerClasses };
}

export function inspectStandaloneUaaInputs({
  workspace = defaultWorkspace, python = 'python3', execute = spawnSync,
} = {}) {
  workspace = resolve(workspace);
  const report = {
    contract, workspace, target: 'uaa-standalone-sys-person',
    status: 'incomplete-input-observation', verification: 'source-acquisition-input-observation-only',
    ...boundary, ownClassPrefixes: ['cn/ibizlab/', 'net/ibizsys/'],
    sourceIdentityBoundary: 'ibiz-cloud-uaa* sources do not establish standalone uaa-api/core/user source identity',
    inputs: [], archives: [], nestedBindings: [], ownClassDuplicates: [], innerClasses: [],
    sourceAcquisitionGaps: [], errors: [],
  };
  const directories = new PinnedDirectories();
  try {
    const paths = [OUTER_JAR, ...OWN_JARS.map(item => `${EXTRACTED_ROOT}/${item.filename}`)];
    const observed = paths.map(path => readJar(directories, workspace, path));
    report.inputs = observed.map(item => item.input);
    const result = execute(python, ['-I', '-c', parser,
      JSON.stringify(OWN_JARS.map(item => `BOOT-INF/lib/${item.filename}`))], {
      input: observed[0].data, encoding: 'utf8', timeout: 60_000, maxBuffer: 64 * 1024 * 1024,
      env: { PATH: process.env.PATH, LANG: 'C.UTF-8' },
    });
    assert.ok(!result.error && !result.signal, 'ZIP/XML parser did not complete');
    let parsed;
    try { parsed = JSON.parse(result.stdout); }
    catch { throw new Error('Invalid structured ZIP/XML parser result'); }
    assert.ok(result.status === 0 && !parsed.error, `Invalid archive observation: ${parsed.error ?? 'parser failed'}`);
    const archives = [parsed.outer, ...parsed.nested];
    const expected = [{ artifactId: 'uaa-api', groupId: 'cn.ibizlab', version: '2.0.0-SNAPSHOT' }, ...OWN_JARS];
    for (let index = 0; index < archives.length; index++) {
      const archive = archives[index];
      const { artifactId, groupId, version } = expected[index];
      assert.deepEqual(archive.maven.coordinates, { groupId, artifactId, version },
        `Unexpected Maven coordinates for ${artifactId}`);
      archive.id = artifactId;
      archive.input = report.inputs[index];
      archive.sourceLookup = sourceClues(archive.maven.coordinates);
      archive.parentSourceLookup = archive.maven.parent ? sourceClues(archive.maven.parent) : null;
      if (index > 0) {
        const nestedPath = `BOOT-INF/lib/${expected[index].filename}`;
        const embedded = parsed.outer.nestedArchives.find(item => item.path === nestedPath);
        assert.ok(embedded, `Missing outer/nested binding: ${artifactId}`);
        assert.equal(embedded.bytes, archive.input.bytes, `Extracted JAR size differs: ${artifactId}`);
        assert.equal(embedded.sha256, archive.input.sha256, `Extracted JAR bytes differ: ${artifactId}`);
        report.nestedBindings.push({ outer: report.inputs[0], entry: embedded, extracted: archive.input,
          exactBytesMatch: true });
      }
      report.sourceAcquisitionGaps.push({
        coordinates: archive.maven.coordinates, requiredSourceArchive: archive.sourceLookup.expectedSourceArchive,
        state: 'original-editable-source-and-build-provenance-unverified',
        ownClassCount: archive.classes.filter(item => item.own).length,
      });
    }
    report.archives = archives;
    Object.assign(report, relationships(archives));
    for (let index = 0; index < paths.length; index++) {
      assert.deepEqual(readJar(directories, workspace, paths[index]).input, report.inputs[index],
        `JAR inputs drifted during observation: ${paths[index]}`);
    }
    report.status = 'observed-inputs-only';
  } catch (error) { report.errors.push({ message: error.message }); }
  finally { directories.close(); }
  report.counts = {
    jars: report.archives.length, classes: report.archives.reduce((sum, item) => sum + item.classes.length, 0),
    ownClasses: report.archives.reduce((sum, item) => sum + item.classes.filter(entry => entry.own).length, 0),
    resources: report.archives.reduce((sum, item) => sum + item.resources.length, 0),
    exactNestedBindings: report.nestedBindings.length, ownClassDuplicates: report.ownClassDuplicates.length,
    innerClasses: report.innerClasses.length, errors: report.errors.length,
  };
  return report;
}

function outputPath(workspace, output) {
  const root = resolve(workspace, OUTPUT_ROOT);
  const path = resolve(workspace, output);
  const child = relative(root, path);
  assert.ok(child && !child.startsWith(`..${sep}`) && child !== '..' && !child.startsWith(sep),
    'Output must be a new artifact run below .artifacts/standalone-uaa-inputs');
  return path;
}

export function writeStandaloneUaaInventory(report, { workspace = report.workspace, output } = {}) {
  assert.equal(resolve(workspace), report.workspace, 'Report workspace differs');
  const path = outputPath(workspace, output ?? join(OUTPUT_ROOT, `observation-${randomUUID()}`));
  const directories = new PinnedDirectories();
  try {
    const directory = directories.open(path, { create: true, exclusive: true });
    const bytes = Buffer.from(`${JSON.stringify(report, null, 2)}\n`);
    directories.write(directory, 'report.json', bytes);
    directories.write(directory, 'report.sha256', `${hash(bytes)}\n`);
    for (const name of ['report.json', 'report.sha256']) {
      fs.chmodSync(directories.entry(directory, name), 0o444);
    }
    directories.verify(directory);
    return { reportPath: join(path, 'report.json'), reportSha256: hash(bytes) };
  } finally { directories.close(); }
}

export function verifyStandaloneUaaInventory({ reportPath, python = 'python3', execute = spawnSync }) {
  const directories = new PinnedDirectories();
  try {
    reportPath = resolve(reportPath);
    assert.equal(basename(reportPath), 'report.json', 'Expected report.json');
    const directory = directories.open(dirname(reportPath));
    const first = readPinnedFile(directories, directory, 'report.json');
    const digest = readPinnedFile(directories, directory, 'report.sha256');
    assert.equal(digest.data.toString(), `${hash(first.data)}\n`, 'Report hash differs');
    const report = JSON.parse(first.data);
    assert.equal(report.contract, contract, 'Unexpected observation contract');
    assert.equal(dirname(reportPath), outputPath(report.workspace, dirname(reportPath)));
    const current = inspectStandaloneUaaInputs({ workspace: report.workspace, python, execute });
    assert.equal(current.errors.length, 0, 'Cannot verify incomplete archive observation');
    assert.deepEqual(report, current, 'Observation differs from current inputs or boundary');
    assert.equal(hash(readPinnedFile(directories, directory, 'report.json', first.identity).data),
      hash(first.data), 'Report changed during verification');
    assert.equal(hash(readPinnedFile(directories, directory, 'report.sha256', digest.identity).data),
      hash(digest.data), 'Report digest changed during verification');
    return { reportPath, reportSha256: hash(first.data), status: report.status, counts: report.counts, ...boundary };
  } finally { directories.close(); }
}

export function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: {
    workspace: { type: 'string' }, output: { type: 'string' }, python: { type: 'string' },
    verify: { type: 'string' }, help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) {
    console.log('Usage: node scripts/inspect-standalone-uaa-inputs.mjs [--workspace PATH] [--output NEW-ARTIFACT-RUN] [--python python3]\n' +
      'Verify: node scripts/inspect-standalone-uaa-inputs.mjs --verify RUN/report.json\n' +
      'Read-only ZIP/Maven source lookup observations; exit 0 is not readiness or native acceptance.');
    return 0;
  }
  if (values.verify) {
    assert.ok(!values.workspace && !values.output, '--verify cannot be combined with input/output options');
    console.log(JSON.stringify(verifyStandaloneUaaInventory({
      reportPath: values.verify, python: values.python,
    }), null, 2));
    return 0;
  }
  const workspace = resolve(values.workspace ?? defaultWorkspace);
  if (values.output) outputPath(workspace, values.output);
  const report = inspectStandaloneUaaInputs({ workspace, python: values.python });
  const receipt = writeStandaloneUaaInventory(report, { workspace, output: values.output });
  console.log(JSON.stringify({ ...receipt, status: report.status, counts: report.counts,
    errors: report.errors, ...boundary }, null, 2));
  return report.status === 'observed-inputs-only' ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === script) {
  try { process.exitCode = main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
