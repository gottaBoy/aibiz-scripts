#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { fingerprint, PinnedDirectories, readPinnedFile } from './native-candidate-files.mjs';
import { sourceBuildInputs } from './source-build-identity.mjs';

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const contract = 'task-bytecode-input-screen-v1';
const hash = data => createHash('sha256').update(data).digest('hex');
const archiveExtension = /\.(?:jar|war|zip)$/i;
const classExtension = /\.class$/i;
const antPath = 'SAPAAS/resources/classes/build.xml';
export const TASK_OWN_CLASS_PREFIXES = Object.freeze(['SA/', 'net/ibizsys/', 'cn/ibizlab/']);

// Standard-library archive/XML parsers consume pinned bytes, never mutable paths.
const parser = String.raw`
import hashlib, io, json, stat, sys, zipfile
import xml.etree.ElementTree as ET
from xml.parsers import expat
def reject(*args):
    raise ValueError("DTD/entities are not allowed")
data = sys.stdin.buffer.read()
if sys.argv[1] == "ant":
    xml = expat.ParserCreate()
    xml.StartDoctypeDeclHandler = reject
    xml.ExternalEntityRefHandler = reject
    xml.Parse(data, True)
    root = ET.fromstring(data)
    if root.tag != "project":
        raise ValueError("Expected an Ant project root")
    targets = root.findall("target")
    names = [target.get("name") for target in targets]
    if any(not name for name in names) or len(names) != len(set(names)):
        raise ValueError("Missing or duplicate Ant targets")
    result = {
        "project": dict(root.attrib),
        "properties": [dict(item.attrib) for item in root.findall("property")],
        "paths": [{"attributes": dict(item.attrib),
                   "elements": [{"tag": child.tag, "attributes": dict(child.attrib)} for child in item]}
                  for item in root.findall("path")],
        "targets": [{"attributes": dict(target.attrib),
                     "javac": [{"attributes": dict(item.attrib),
                                "excludes": [dict(child.attrib) for child in item.findall("exclude")]}
                               for item in target.findall("javac")],
                     "copies": [{"attributes": dict(item.attrib),
                                 "filesets": [dict(child.attrib) for child in item.findall("fileset")]}
                                for item in target.findall("copy")]}
                    for target in targets]
    }
else:
    classes, archives = [], []
    budget = [0, 0]
    def visit(blob, chain, depth):
        if depth > 4:
            raise ValueError("Nested archive depth limit exceeded")
        with zipfile.ZipFile(io.BytesIO(blob)) as archive:
            infos = archive.infolist()
            seen = set()
            for info in infos:
                name = info.filename
                parts = name.rstrip("/").split("/")
                if (not name or "\\" in name or "!" in name or name.startswith("/")
                    or any(part in ("", ".", "..") or ":" in part for part in parts)):
                    raise ValueError("Unsafe archive entry: " + repr(name))
                if name in seen:
                    raise ValueError("Duplicate archive entry: " + name)
                seen.add(name)
                mode = info.external_attr >> 16
                if stat.S_ISLNK(mode) or info.flag_bits & 1:
                    raise ValueError("Symlink/encrypted archive entry: " + name)
                budget[0] += 1
                budget[1] += info.file_size
                if budget[0] > 250000 or budget[1] > 512 * 1024 * 1024:
                    raise ValueError("Archive input size/count limit exceeded")
                if info.is_dir():
                    continue
                # Reading every entry validates CRCs, including non-class resources.
                content = archive.read(info)
                suffix = name.lower()
                record = {"archiveChain": chain, "entry": name, "bytes": len(content),
                          "sha256": hashlib.sha256(content).hexdigest()}
                if suffix.endswith(".class"):
                    if not content:
                        raise ValueError("Empty class entry: " + name)
                    classes.append(record)
                elif suffix.endswith((".jar", ".war", ".zip")):
                    archives.append(record)
                    visit(content, chain + [name], depth + 1)
    visit(data, [], 0)
    result = {"classes": classes, "nestedArchives": archives}
json.dump(result, sys.stdout)
`;

function parseBytes(kind, data, python, execute) {
  const result = execute(python, ['-I', '-c', parser, kind], {
    input: data, encoding: 'utf8', timeout: 30_000, maxBuffer: 64 * 1024 * 1024,
  });
  assert.ok(!result.error && result.status === 0 && !result.signal,
    `Invalid ${kind} input: ${result.error?.message ?? result.stderr ?? result.signal}`);
  return JSON.parse(result.stdout);
}

function readInput(directories, root, entry) {
  const path = join(root, entry.path);
  const { data } = readPinnedFile(directories, directories.open(dirname(path)), basename(path));
  assert.equal(data.length, entry.bytes, `Input size changed: ${entry.path}`);
  assert.equal(hash(data), entry.sha256, `Input bytes changed: ${entry.path}`);
  return data;
}

function classPath(name) {
  let path = name;
  for (const prefix of ['WEB-INF/classes/', 'BOOT-INF/classes/']) {
    if (path.startsWith(prefix)) path = path.slice(prefix.length);
  }
  const parts = path.split('/');
  if (parts[0] === 'META-INF' && parts[1] === 'versions' && /^\d+$/.test(parts[2] ?? '')) {
    path = parts.slice(3).join('/');
  }
  return path;
}

function sourceIndex(inputs) {
  const index = new Map();
  for (const entry of inputs.entries) {
    if (!entry.path.startsWith('SAPAAS/src/') || !entry.path.endsWith('.java')) continue;
    const parts = entry.path.split('/');
    for (let start = 2; start < parts.length; start++) {
      const suffix = parts.slice(start).join('/');
      const matches = index.get(suffix) ?? [];
      matches.push(entry);
      index.set(suffix, matches);
    }
  }
  return index;
}

function sourceCandidates(index, name) {
  const path = classPath(name).replace(/\.class$/i, '.java');
  const outer = path.replace(/\$[^/]+(?=\.java$)/, '');
  return [...new Map([...index.get(path) ?? [], ...index.get(outer) ?? []]
    .map(entry => [entry.path, entry])).values()];
}

function classify(index, name) {
  const path = classPath(name);
  const candidates = sourceCandidates(index, name);
  const prefix = TASK_OWN_CLASS_PREFIXES.find(item => path.startsWith(item));
  return { own: Boolean(prefix || candidates.length), ownPrefix: prefix ?? null,
    sourceCandidates: candidates };
}

function looseClassPath(path) {
  for (const prefix of ['SAPAAS/resources/classes/', 'SAPAAS/webapp/WEB-INF/classes/']) {
    if (path.startsWith(prefix)) return path.slice(prefix.length);
  }
  return path;
}

export function auditTaskBytecodeInputs({
  root = join(workspace, 'task7'), python = 'python3', execute = spawnSync,
} = {}) {
  root = resolve(root);
  const report = {
    contract, root, status: 'blocked', verification: 'input-screen-only',
    sourceClosureVerified: false, compilerBuildInDockerVerified: false, nativeAcceptance: false,
    ownClassPrefixes: [...TASK_OWN_CLASS_PREFIXES],
    sourceInputs: {}, ant: null, looseClasses: [], archives: [], findings: [], errors: [],
  };
  const directories = new PinnedDirectories();
  try {
    const inputs = sourceBuildInputs(root);
    report.sourceInputs.before = inputs;
    const descriptor = inputs.entries.find(entry => entry.path === antPath);
    assert.ok(descriptor, 'Canonical Task Ant descriptor is missing');
    assert.ok(inputs.entries.some(entry =>
      entry.path.startsWith('SAPAAS/src/') && entry.path.endsWith('.java')), 'Editable Task Java source is missing');
    const index = sourceIndex(inputs);
    report.ant = { input: descriptor, declarations: parseBytes(
      'ant', readInput(directories, root, descriptor), python, execute,
    ) };
    const targets = report.ant.declarations.targets.map(target => target.attributes.name);
    for (const required of ['compile', 'prepare-webapp', 'war']) {
      assert.ok(targets.includes(required), `Canonical Task Ant target is missing: ${required}`);
    }
    for (const entry of inputs.entries) {
      if (classExtension.test(entry.path)) {
        const data = readInput(directories, root, entry);
        assert.ok(data.length > 0, `Empty loose class input: ${entry.path}`);
        const identity = classify(index, looseClassPath(entry.path));
        const item = { input: entry, ...identity };
        report.looseClasses.push(item);
        // Even unknown namespaces cannot establish provenance for loose bytecode.
        report.findings.push({ kind: 'unproven-loose-class-input', ...item });
      } else if (archiveExtension.test(entry.path)) {
        const item = { input: entry, classes: [], nestedArchives: [] };
        report.archives.push(item);
        try {
          const parsed = parseBytes('archive', readInput(directories, root, entry), python, execute);
          item.nestedArchives = parsed.nestedArchives;
          item.classes = parsed.classes.map(record => ({ ...record, ...classify(index, record.entry) }));
          for (const compiled of item.classes.filter(record => record.own)) {
            report.findings.push({ kind: 'precompiled-own-archive-input', input: entry, ...compiled });
          }
        } catch (error) {
          report.errors.push({ path: entry.path, message: error.message });
        }
      }
    }
    report.sourceInputs.after = sourceBuildInputs(root);
    assert.deepEqual(report.sourceInputs.after, inputs, 'Source inputs changed during bytecode audit');
    if (!report.findings.length && !report.errors.length) report.status = 'passed-input-screen-only';
  } catch (error) {
    report.errors.push({ message: error.message });
  } finally { directories.close(); }
  report.counts = {
    looseClasses: report.looseClasses.length,
    archives: report.archives.length,
    archiveClasses: report.archives.reduce((sum, item) => sum + item.classes.length, 0),
    nestedArchives: report.archives.reduce((sum, item) => sum + item.nestedArchives.length, 0),
    ownArchiveClasses: report.findings.filter(item => item.kind === 'precompiled-own-archive-input').length,
    findings: report.findings.length, errors: report.errors.length,
  };
  return report;
}

export function writeTaskBytecodeAudit(report, output) {
  const directories = new PinnedDirectories();
  try {
    const directory = directories.open(dirname(resolve(output)), { create: true });
    directories.write(directory, basename(output), `${JSON.stringify(report, null, 2)}\n`);
    return resolve(output);
  } finally { directories.close(); }
}

export function verifyTaskBytecodeAudit({ reportPath, python = 'python3', execute = spawnSync }) {
  const directories = new PinnedDirectories();
  try {
    const directory = directories.open(dirname(resolve(reportPath)));
    const first = readPinnedFile(directories, directory, basename(reportPath));
    const report = JSON.parse(first.data);
    assert.equal(report.contract, contract, 'Unexpected bytecode audit contract');
    assert.equal(report.nativeAcceptance, false, 'Input screening cannot establish native acceptance');
    assert.equal(report.sourceClosureVerified, false, 'Input screening cannot establish source closure');
    assert.equal(report.compilerBuildInDockerVerified, false, 'Input screening cannot prove compiler execution');
    assert.ok(typeof report.root === 'string' && resolve(report.root) === report.root, 'Invalid source root');
    assert.deepEqual(report.sourceInputs.before, sourceBuildInputs(report.root), 'Recorded source inputs drifted');
    assert.deepEqual(report.sourceInputs.after, report.sourceInputs.before, 'Missing or inconsistent post-audit inputs');
    const current = auditTaskBytecodeInputs({ root: report.root, python, execute });
    assert.equal(current.errors.length, 0, 'Cannot verify incomplete bytecode audit evidence');
    assert.deepEqual(report, current, 'Bytecode audit evidence differs from independently replayed inputs');
    const last = readPinnedFile(directories, directory, basename(reportPath), first.identity);
    assert.equal(hash(last.data), hash(first.data), 'Bytecode audit report changed during verification');
    return { reportPath: resolve(reportPath), reportSha256: hash(first.data), status: report.status,
      counts: report.counts, sourceClosureVerified: false, compilerBuildInDockerVerified: false,
      nativeAcceptance: false };
  } finally { directories.close(); }
}

export function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: {
    root: { type: 'string' }, output: { type: 'string' }, python: { type: 'string' },
    verify: { type: 'string' }, help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) {
    console.log('Usage: node scripts/audit-task-bytecode-inputs.mjs [--root task7] [--output NEW-REPORT.json] [--python python3]\n' +
      'Verify: node scripts/audit-task-bytecode-inputs.mjs --verify REPORT.json\n' +
      'Read-only input screen; no builds, services, databases or source/native acceptance.');
    return 0;
  }
  if (values.verify) {
    assert.ok(!values.root && !values.output, '--verify cannot be combined with --root or --output');
    const result = verifyTaskBytecodeAudit({ reportPath: values.verify, python: values.python });
    console.log(JSON.stringify(result, null, 2));
    return result.status === 'passed-input-screen-only' ? 0 : 1;
  }
  const report = auditTaskBytecodeInputs({ root: values.root, python: values.python });
  const output = values.output ?? join(workspace, '.artifacts/task-bytecode-input-audit',
    `audit-${randomUUID()}`, 'report.json');
  const reportPath = writeTaskBytecodeAudit(report, output);
  const compiledEntries = report.archives.flatMap(archive => archive.classes.map(item => ({
    path: [archive.input.path, ...item.archiveChain, item.entry].join('!'),
    bytes: item.bytes, sha256: item.sha256,
  })));
  console.log(JSON.stringify({
    reportPath, status: report.status, sourceInputFingerprint: report.sourceInputs.before?.fingerprint,
    archiveClassInventory: fingerprint(compiledEntries),
    counts: report.counts, findings: report.findings, errors: report.errors,
    sourceClosureVerified: false, compilerBuildInDockerVerified: false, nativeAcceptance: false,
  }, null, 2));
  return report.status === 'passed-input-screen-only' ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
