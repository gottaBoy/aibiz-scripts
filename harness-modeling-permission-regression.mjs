#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  fingerprint, optionalStat, PinnedDirectories, readPinnedFile, readTree,
} from './native-candidate-files.mjs';
import { sourceBuildInputs } from './source-build-identity.mjs';

const workspaceDefault = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const PINNED_MAVEN_IMAGE =
  'maven@sha256:42a3ac393abbc64dae6c96703e5ead2e921fe9103371ac58b5b404b0d6a26502';
export const MODELING_CORE_MODULE = 'libs/ibiz-modeling-core';
export const REQUIRED_PERMISSION_SUITES = Object.freeze([
  'net.ibizsys.modeling.core.dataentity.security.PSModelDEAccessManagerTest',
  'net.ibizsys.modeling.core.security.PSDevUserCacheCodecTest',
  'net.ibizsys.modeling.core.security.SystemAccessManagerCacheTest',
  'net.ibizsys.modeling.core.security.SystemAccessManagerEditorRegistryTest',
  'net.ibizsys.modeling.core.security.SystemAccessManagerGrantTest',
  'net.ibizsys.modeling.core.security.SystemAccessManagerJsonCacheTest',
  'net.ibizsys.modeling.core.security.SystemAccessManagerRequestCacheTest',
  'net.ibizsys.modeling.core.security.SystemAccessManagerSchemeGrantTest',
  'net.ibizsys.modeling.core.sysutil.addin.ModelSysUtilRTAddinAuthorizationTest',
]);
// Deployment outputs of nonselected modules, not permission-reactor compiler inputs.
export const GENERATED_DEPLOYMENT_ARCHIVES = Object.freeze([
  'ibiz-ebsx-gateway/ibiz-ebsx-gateway.jar',
  'ibiz-ebsx-runtime/ibiz-ebsx-allinone-rt.jar',
  'ibiz-service-runner/ibizservicerunner-provider.jar',
]);
const exclusions = ['.git', '.artifacts', 'target'];
const contract = 'modeling-permission-regression-v1';
const hash = data => createHash('sha256').update(data).digest('hex');
const slash = path => path.split(sep).join('/');
const successful = command =>
  command?.exitCode === 0 && command.signal === null && command.error === null;

// Parse XML through the standard library, not console-summary or XML regexes.
// The preliminary Expat pass rejects DTDs before any entity expansion.
const xmlParser = String.raw`
import base64, json, sys
import xml.etree.ElementTree as ET
from xml.parsers import expat
def reject(*args):
    raise ValueError("DTD/entities are not allowed in Surefire reports")
result = []
for report in json.load(sys.stdin):
    data = base64.b64decode(report["data"], validate=True)
    parser = expat.ParserCreate()
    parser.StartDoctypeDeclHandler = reject
    parser.ExternalEntityRefHandler = reject
    parser.Parse(data, True)
    root = ET.fromstring(data)
    if root.tag != "testsuite":
        raise ValueError("Expected a Surefire testsuite root")
    if any(child.tag not in ("properties", "testcase", "system-out", "system-err") for child in root):
        raise ValueError("Unsupported Surefire suite child")
    cases = []
    for case in root.findall("testcase"):
        if any(child.tag not in ("failure", "error", "skipped", "system-out", "system-err") for child in case):
            raise ValueError("Unsupported Surefire testcase child")
        cases.append({"name": case.get("name"), "classname": case.get("classname"),
                      "outcomes": [child.tag for child in case if child.tag in ("failure", "error", "skipped")]})
    result.append({"path": report["path"], "attributes": dict(root.attrib), "cases": cases})
json.dump(result, sys.stdout)
`;

function pinnedRead(path) {
  const directories = new PinnedDirectories();
  try {
    return readPinnedFile(directories, directories.open(dirname(path)), basename(path)).data;
  } finally { directories.close(); }
}

function childOf(parent, path) {
  const absolute = resolve(parent, path);
  const child = relative(parent, absolute);
  assert.ok(child && child !== '..' && !child.startsWith(`..${sep}`) && !isAbsolute(child),
    'Path must be a child of its required root');
  return absolute;
}

function disjoint(left, right) {
  const contains = (parent, path) => {
    const child = relative(parent, path);
    return !child || (!isAbsolute(child) && child !== '..' && !child.startsWith(`..${sep}`));
  };
  assert.ok(!contains(left, right) && !contains(right, left), 'Overlapping input/output paths rejected');
}

function expectedFullSuites(inputs) {
  const prefix = `${MODELING_CORE_MODULE}/src/test/java/`;
  const suites = inputs.entries.filter(entry => entry.path.startsWith(prefix) &&
    /^(?:Test.*|.*Test|.*Tests|.*TestCase)\.java$/.test(basename(entry.path)))
    .map(entry => entry.path.slice(prefix.length, -'.java'.length).split('/').join('.')).sort();
  for (const name of REQUIRED_PERMISSION_SUITES) {
    assert.ok(suites.includes(name), `Required permission suite absent from source: ${name}`);
  }
  return suites;
}

export function parseSurefireSuites(reports, { python = 'python3' } = {}) {
  assert.ok(Array.isArray(reports) && reports.length, 'No Surefire XML suites found');
  const parsed = spawnSync(python, ['-I', '-c', xmlParser], {
    input: JSON.stringify(reports.map(({ path, data }) => ({
      path, data: Buffer.from(data).toString('base64'),
    }))),
    encoding: 'utf8', timeout: 30_000, maxBuffer: 32 * 1024 * 1024,
  });
  assert.ok(!parsed.error && parsed.status === 0 && !parsed.signal,
    `Invalid Surefire XML: ${parsed.error?.message ?? parsed.stderr}`);
  const suites = JSON.parse(parsed.stdout);
  const seen = new Set();
  for (const suite of suites) {
    const { name } = suite.attributes;
    assert.ok(typeof name === 'string' && /^[\w$]+(?:\.[\w$]+)+$/.test(name),
      'Invalid Surefire suite name');
    assert.equal(basename(suite.path), `TEST-${name}.xml`, 'Suite filename/name mismatch');
    assert.ok(!seen.has(`${dirname(suite.path)}/${name}`), 'Duplicate Surefire suite');
    seen.add(`${dirname(suite.path)}/${name}`);
    for (const field of ['tests', 'failures', 'errors', 'skipped']) {
      const value = suite.attributes[field];
      assert.ok(typeof value === 'string' && /^\d+$/.test(value), `Invalid suite ${field} count`);
      suite[field] = Number(value);
      assert.ok(Number.isSafeInteger(suite[field]), `Unsafe suite ${field} count`);
    }
    assert.ok(suite.tests > 0, 'Empty Surefire suite rejected');
    assert.equal(suite.tests, suite.cases.length, 'Suite/testcase count mismatch');
    const actual = { failures: 0, errors: 0, skipped: 0 };
    for (const item of suite.cases) {
      assert.ok(typeof item.name === 'string' && item.name.trim(), 'Missing testcase name');
      assert.ok(typeof item.classname === 'string' && item.classname.trim(), 'Missing testcase classname');
      assert.equal(item.classname, name, 'Testcase classname/suite mismatch');
      assert.ok(item.outcomes.length <= 1, 'Conflicting testcase outcomes');
      if (item.outcomes[0]) {
        actual[{ failure: 'failures', error: 'errors', skipped: 'skipped' }[item.outcomes[0]]] += 1;
      }
    }
    for (const field of Object.keys(actual)) {
      assert.equal(suite[field], actual[field], `Suite/testcase ${field} count mismatch`);
    }
    suite.name = name;
    delete suite.attributes;
  }
  return suites;
}

export function auditPermissionSuites(suites, { stage, fullSuites } = {}) {
  assert.ok(stage === 'focused' || stage === 'full', 'Invalid regression stage');
  assert.ok(Array.isArray(suites) && suites.length, 'No parsed Surefire suites found');
  const expected = stage === 'focused' ? REQUIRED_PERMISSION_SUITES : fullSuites;
  assert.ok(Array.isArray(expected) && expected.length, 'Full source suite inventory missing');
  const primary = suites.filter(suite =>
    dirname(suite.path) === `${MODELING_CORE_MODULE}/target/surefire-reports`);
  assert.deepEqual(primary.map(suite => suite.name).sort(), [...expected].sort(),
    `${stage} required suite inventory mismatch`);
  for (const suite of suites) {
    for (const field of ['tests', 'failures', 'errors', 'skipped']) {
      assert.ok(Number.isSafeInteger(suite[field]) && suite[field] >= 0, 'Invalid parsed suite count');
    }
    assert.ok(suite.tests > 0, 'Empty suite rejected');
    assert.equal(suite.failures + suite.errors + suite.skipped, 0,
      `Failures, errors or required skips in ${suite.name}`);
  }
  const total = items => items.reduce((sum, suite) => sum + suite.tests, 0);
  assert.ok(Number.isSafeInteger(total(suites)), 'Unsafe aggregate test count');
  return { suites, suiteCount: suites.length, tests: total(suites),
    modelingCoreTests: total(primary), failures: 0, errors: 0, skipped: 0 };
}

function collectSurefire(worktree, inputs, python) {
  const entries = [];
  const xml = [];
  for (const pom of inputs.entries.filter(entry => basename(entry.path) === 'pom.xml')) {
    const prefix = slash(join(dirname(pom.path), 'target/surefire-reports'));
    const root = join(worktree, prefix);
    if (!optionalStat(root)) continue;
    const files = readTree(root, { jsonOnly: false });
    for (const file of files.contents) {
      const path = `${prefix}/${file.path}`;
      assert.ok(!/\.(?:dump|dumpstream)$/.test(path), `Surefire crash evidence: ${path}`);
      entries.push({ path, bytes: file.bytes, sha256: file.sha256 });
      if (file.path.endsWith('.xml')) xml.push({ path, data: file.data });
    }
  }
  entries.sort((left, right) => left.path.localeCompare(right.path));
  return { files: { ...fingerprint(entries), entries }, suites: parseSurefireSuites(xml, { python }) };
}

export function permissionMavenCommand({ worktree, snapshot, repository, containerName, stage, uid, gid }) {
  assert.ok(stage === 'focused' || stage === 'full', 'Invalid Maven stage');
  assert.ok(/^modeling-permission-[a-f0-9-]{36}$/.test(containerName), 'Invalid isolated container name');
  for (const id of [uid, gid]) {
    assert.ok(Number.isSafeInteger(id) && id >= 0, 'Invalid container user identity');
  }
  for (const path of [worktree, snapshot, repository]) {
    assert.ok(typeof path === 'string' && isAbsolute(path) && !path.includes(','),
      'Invalid Docker bind path');
  }
  disjoint(worktree, snapshot);
  disjoint(worktree, repository);
  const args = [
    'run', '--rm', '--pull=never', '--network=none', '--read-only', '--cap-drop=ALL',
    '--security-opt=no-new-privileges', '--name', containerName, '--user', `${uid}:${gid}`,
    '--tmpfs', '/tmp:rw,exec,nosuid,size=1g',
    '--env', 'HOME=/tmp', '--env', 'MAVEN_CONFIG=/tmp/.m2',
    '--mount', `type=bind,source=${worktree},target=/workspace/ibiz-service-hub`,
    '--mount', `type=bind,source=${snapshot},target=/snapshot,readonly`,
    '--mount', `type=bind,source=${repository},target=/maven-repository,readonly`,
    '--workdir', '/workspace/ibiz-service-hub', '--entrypoint', 'mvn', PINNED_MAVEN_IMAGE,
    '-B', '-o', '-ntp', '-Dmaven.repo.local=/maven-repository',
    '-DskipTests=false', '-Dmaven.test.skip=false', '-Dmaven.test.failure.ignore=false',
    '-Dsurefire.skipAfterFailureCount=0', '-Dsurefire.failIfNoSpecifiedTests=false',
  ];
  if (stage === 'focused') {
    args.push(`-Dtest=${REQUIRED_PERMISSION_SUITES.map(name => name.split('.').at(-1)).join(',')}`);
  }
  args.push('-pl', MODELING_CORE_MODULE, '-am', 'test');
  return { executable: 'docker', args };
}

function copyCommand(from, to, { generatedArtifacts = [] } = {}) {
  return { executable: 'rsync', args: [
    '-a', '--no-owner', '--no-group', ...exclusions.map(name => `--exclude=${name}`),
    ...generatedArtifacts.map(path => `--exclude=/${path}`),
    '--', `${from}/`, `${to}/`,
  ] };
}

function runCommand(directories, output, name, command, execute, timeout) {
  directories.verify(output);
  const path = directories.entry(output, name);
  const fd = fs.openSync(path,
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  let result;
  try {
    result = execute(command.executable, command.args, {
      stdio: ['ignore', fd, fd], timeout, env: { ...process.env, LC_ALL: 'C' },
    });
  } catch (error) {
    fs.writeSync(fd, `${error.message}\n`);
    result = { status: null, signal: null, error };
  } finally { fs.closeSync(fd); }
  const { data } = readPinnedFile(directories, output, name);
  return { ...command, exitCode: result.status ?? null, signal: result.signal ?? null,
    error: result.error?.message ?? null, log: { path: name, bytes: data.length, sha256: hash(data) } };
}

function inspectImage(command, path) {
  assert.ok(successful(command), 'Pinned Maven image inspection failed; preload the pinned image');
  const image = JSON.parse(pinnedRead(path));
  assert.ok(/^sha256:[a-f0-9]{64}$/.test(image.Id), 'Invalid Docker image identity');
  assert.equal(image.Os, 'linux', 'Maven image must be Linux');
  assert.ok(typeof image.Architecture === 'string' && image.Architecture, 'Missing image architecture');
  assert.ok(image.RepoDigests?.includes(PINNED_MAVEN_IMAGE), 'Pinned Maven image digest mismatch');
  return { reference: PINNED_MAVEN_IMAGE, id: image.Id, os: image.Os, architecture: image.Architecture };
}

export function runModelingPermissionRegression({
  workspace = workspaceDefault, source = 'ibiz-service-hub', output,
  mavenRepository = process.env.MODELING_PERMISSION_MAVEN_REPOSITORY ?? join(homedir(), '.m2/repository'),
  python = 'python3', execute = spawnSync,
} = {}) {
  workspace = resolve(workspace);
  source = childOf(workspace, source);
  const artifacts = join(workspace, '.artifacts');
  output = resolve(workspace, output ??
    join('.artifacts', `modeling-permission-regression-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${randomUUID()}`));
  assert.equal(dirname(output), artifacts, 'Output must be a new direct child of .artifacts');
  assert.ok(/^[a-zA-Z0-9][a-zA-Z0-9_.-]*$/.test(basename(output)), 'Invalid output name');
  mavenRepository = resolve(mavenRepository);
  for (const input of [source, mavenRepository]) {
    assert.ok(!input.includes(','), 'Docker bind paths must not contain commas');
    disjoint(input, output);
  }
  assert.ok(!output.includes(','), 'Docker bind paths must not contain commas');
  const directories = new PinnedDirectories();
  const snapshot = join(output, 'snapshot');
  const repository = join(output, 'repository');
  const report = {
    contract, status: 'failed', unitRegression: false, nativeAcceptance: false,
    acceptedForProduction: false, workspace, source, output, snapshot, repository, mavenRepository,
    startedAt: new Date().toISOString(), uid: process.geteuid(), gid: process.getegid(),
    image: null, commands: [], expectedFullSuites: [], stages: [], errors: [],
    sourceInputs: { contract: 'source-build-input-inventory-v1',
      generatedArtifacts: GENERATED_DEPLOYMENT_ARCHIVES, before: null, after: null },
    snapshotInputs: { before: null, after: null }, repositoryInputs: { before: null, after: null },
  };
  let destination;
  try {
    directories.open(source);
    directories.open(mavenRepository);
    destination = directories.open(output, { create: true, exclusive: true });
    const sourceOptions = { generatedArtifacts: GENERATED_DEPLOYMENT_ARCHIVES };
    report.sourceInputs.before = sourceBuildInputs(source, sourceOptions);
    report.expectedFullSuites = expectedFullSuites(report.sourceInputs.before);
    directories.open(snapshot, { create: true, exclusive: true });
    const copy = runCommand(directories, destination, 'snapshot-rsync.log',
      copyCommand(source, snapshot, sourceOptions), execute, 120_000);
    report.commands.push(copy);
    assert.ok(successful(copy), 'Source snapshot rsync failed');
    report.snapshotInputs.before = sourceBuildInputs(snapshot);
    assert.deepEqual(report.snapshotInputs.before, report.sourceInputs.before, 'Source snapshot drift');
    assert.deepEqual(sourceBuildInputs(source, sourceOptions), report.sourceInputs.before,
      'Source drift during snapshot');
    directories.open(repository, { create: true, exclusive: true });
    const seed = sourceBuildInputs(mavenRepository);
    const cache = runCommand(directories, destination, 'repository-rsync.log',
      copyCommand(mavenRepository, repository), execute, 120_000);
    report.commands.push(cache);
    assert.ok(successful(cache), 'Maven repository snapshot rsync failed');
    report.repositoryInputs.before = sourceBuildInputs(repository);
    assert.deepEqual(report.repositoryInputs.before, seed, 'Maven repository snapshot drift');
    assert.deepEqual(sourceBuildInputs(mavenRepository), seed, 'Maven repository drift during snapshot');
    const inspection = runCommand(directories, destination, 'image-inspect.log', {
      executable: 'docker', args: ['image', 'inspect', '--format', '{{json .}}', PINNED_MAVEN_IMAGE],
    }, execute, 10_000);
    report.commands.push(inspection);
    report.image = inspectImage(inspection, join(output, inspection.log.path));
    for (const stage of ['focused', 'full']) {
      assert.deepEqual(sourceBuildInputs(snapshot), report.snapshotInputs.before, 'Immutable snapshot drift');
      const worktree = join(output, stage);
      directories.open(worktree, { create: true, exclusive: true });
      const record = { stage, worktree, containerName: `modeling-permission-${randomUUID()}`,
        status: 'failed', before: null, after: null, commands: [], errors: [] };
      report.stages.push(record);
      try {
        const copy = runCommand(directories, destination, `${stage}-rsync.log`,
          copyCommand(snapshot, worktree), execute, 120_000);
        record.commands.push(copy);
        assert.ok(successful(copy), `${stage} worktree rsync failed`);
        record.before = sourceBuildInputs(worktree);
        assert.deepEqual(record.before, report.sourceInputs.before, `${stage} pre-build source drift`);
        record.command = runCommand(directories, destination, `${stage}.log`,
          permissionMavenCommand({ ...record, snapshot, repository, uid: report.uid, gid: report.gid }),
          execute, 30 * 60_000);
        if (!successful(record.command)) {
          record.errors.push(`${stage} Maven execution failed`);
          // Only this harness's uniquely named container may be removed after a timeout.
          record.commands.push(runCommand(directories, destination, `${stage}-cleanup.log`, {
            executable: 'docker', args: ['rm', '--force', record.containerName],
          }, execute, 30_000));
        }
        record.after = sourceBuildInputs(worktree);
        assert.deepEqual(record.after, record.before, `${stage} post-build source drift`);
        const collected = collectSurefire(worktree, record.before, python);
        record.reportFiles = collected.files;
        record.results = auditPermissionSuites(collected.suites,
          { stage, fullSuites: report.expectedFullSuites });
        if (!record.errors.length) record.status = 'passed';
      } catch (error) {
        record.errors.push(error.message);
      }
      report.errors.push(...record.errors);
    }
  } catch (error) {
    if (!destination) throw error;
    report.errors.push(error.message);
  } finally {
    if (destination) {
      for (const [key, root] of [
        ['sourceInputs', source], ['snapshotInputs', snapshot], ['repositoryInputs', repository],
      ]) {
        if (!report[key].before) continue;
        try {
          report[key].after = sourceBuildInputs(root, key === 'sourceInputs'
            ? { generatedArtifacts: GENERATED_DEPLOYMENT_ARCHIVES } : {});
          assert.deepEqual(report[key].after, report[key].before, `${key} source drift`);
        } catch (error) { report.errors.push(error.message); }
      }
      report.unitRegression = report.errors.length === 0 && report.stages.length === 2 &&
        report.stages.every(stage => stage.status === 'passed');
      report.status = report.unitRegression ? 'passed-unit-regression-only' : 'failed';
      report.finishedAt = new Date().toISOString();
      try { directories.write(destination, 'report.json', `${JSON.stringify(report, null, 2)}\n`); }
      finally { directories.close(); }
    } else {
      directories.close();
    }
  }
  return { report, reportPath: join(output, 'report.json') };
}

export function verifyModelingPermissionRegression({
  workspace = workspaceDefault, reportPath, python = 'python3',
} = {}) {
  workspace = resolve(workspace);
  reportPath = childOf(workspace, reportPath);
  assert.equal(basename(reportPath), 'report.json', 'Expected report.json');
  const bytes = pinnedRead(reportPath);
  const report = JSON.parse(bytes);
  const output = dirname(reportPath);
  assert.equal(dirname(output), join(workspace, '.artifacts'), 'Invalid regression output root');
  assert.equal(report.contract, contract, 'Invalid regression report contract');
  assert.equal(report.workspace, workspace);
  assert.equal(report.output, output);
  assert.equal(report.snapshot, join(output, 'snapshot'));
  assert.equal(report.repository, join(output, 'repository'));
  assert.equal(report.status, 'passed-unit-regression-only', 'Regression receipt is not passing');
  assert.equal(report.unitRegression, true);
  assert.equal(report.nativeAcceptance, false, 'Unit tests cannot establish nativeAcceptance');
  assert.equal(report.acceptedForProduction, false);
  assert.deepEqual(report.errors, []);
  childOf(workspace, report.source);
  disjoint(report.source, output);
  assert.ok(isAbsolute(report.mavenRepository), 'Invalid Maven repository seed path');
  disjoint(report.mavenRepository, output);
  assert.equal(report.sourceInputs.contract, 'source-build-input-inventory-v1');
  assert.deepEqual(report.sourceInputs.generatedArtifacts, GENERATED_DEPLOYMENT_ARCHIVES,
    'Generated deployment archive exclusions mismatch');
  for (const [key, root] of [
    ['sourceInputs', report.source], ['snapshotInputs', report.snapshot], ['repositoryInputs', report.repository],
  ]) {
    const inputs = sourceBuildInputs(root, key === 'sourceInputs'
      ? { generatedArtifacts: GENERATED_DEPLOYMENT_ARCHIVES } : {});
    assert.deepEqual(report[key].before, inputs, `${key} recorded inventory drift`);
    assert.deepEqual(report[key].after, inputs, `${key} post-build inventory drift`);
  }
  assert.deepEqual(report.snapshotInputs.before, report.sourceInputs.before, 'Snapshot/source mismatch');
  assert.deepEqual(report.expectedFullSuites, expectedFullSuites(report.sourceInputs.before));
  const verifyLog = command => {
    assert.ok(command && command.log && basename(command.log.path) === command.log.path, 'Invalid command log');
    const data = pinnedRead(join(output, command.log.path));
    assert.deepEqual(command.log, { path: command.log.path, bytes: data.length, sha256: hash(data) },
      'Command log drift');
    assert.ok(successful(command), 'Failed command cannot satisfy regression evidence');
  };
  assert.equal(report.commands.length, 3, 'Missing preparation commands');
  const inspection = report.commands.at(-1);
  assert.deepEqual(report.commands.map(({ executable, args }) => ({ executable, args })), [
    copyCommand(report.source, report.snapshot, { generatedArtifacts: GENERATED_DEPLOYMENT_ARCHIVES }),
    copyCommand(report.mavenRepository, report.repository),
    { executable: 'docker', args: ['image', 'inspect', '--format', '{{json .}}', PINNED_MAVEN_IMAGE] },
  ], 'Preparation command mismatch');
  report.commands.forEach(verifyLog);
  assert.deepEqual(report.image, inspectImage(inspection, join(output, inspection.log.path)));
  assert.deepEqual(report.stages.map(stage => stage.stage), ['focused', 'full'], 'Missing/invalid stages');
  for (const record of report.stages) {
    assert.equal(record.worktree, join(output, record.stage), 'In-place build rejected');
    assert.equal(record.status, 'passed');
    assert.deepEqual(record.errors, []);
    assert.deepEqual(record.before, report.sourceInputs.before, 'Worktree/source mismatch');
    assert.deepEqual(record.after, record.before, 'Recorded worktree source drift');
    assert.deepEqual(sourceBuildInputs(record.worktree), record.before, 'Worktree source drift');
    assert.equal(record.commands.length, 1, 'Invalid stage preparation');
    assert.deepEqual({ executable: record.commands[0].executable, args: record.commands[0].args },
      copyCommand(report.snapshot, record.worktree));
    record.commands.forEach(verifyLog);
    const expected = permissionMavenCommand({
      ...record, snapshot: report.snapshot, repository: report.repository, uid: report.uid, gid: report.gid,
    });
    assert.deepEqual({ executable: record.command.executable, args: record.command.args }, expected,
      'Maven command mismatch or required skip flag missing');
    verifyLog(record.command);
    const collected = collectSurefire(record.worktree, record.before, python);
    assert.deepEqual(record.reportFiles, collected.files, 'Surefire report file drift');
    assert.deepEqual(record.results, auditPermissionSuites(collected.suites,
      { stage: record.stage, fullSuites: report.expectedFullSuites }), 'Suite/count/schema receipt mismatch');
  }
  assert.deepEqual(pinnedRead(reportPath), bytes, 'Regression report changed during verification');
  return { report, reportPath, reportSha256: hash(bytes), unitRegression: true, nativeAcceptance: false };
}

export function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({ args: argv, options: {
    workspace: { type: 'string' }, source: { type: 'string' }, output: { type: 'string' },
    'maven-repository': { type: 'string' }, python: { type: 'string' },
    verify: { type: 'string' }, help: { type: 'boolean' },
  } });
  if (values.help) {
    console.log('Usage: node scripts/harness-modeling-permission-regression.mjs [--workspace PATH] [--source ibiz-service-hub] [--output .artifacts/NEW-RUN] [--maven-repository PATH] [--python python3]\n' +
      'Verify: node scripts/harness-modeling-permission-regression.mjs --verify .artifacts/RUN/report.json');
    return 0;
  }
  const options = { workspace: values.workspace, python: values.python };
  if (values.verify) {
    const verified = verifyModelingPermissionRegression({ ...options, reportPath: values.verify });
    console.log(JSON.stringify({ reportPath: verified.reportPath, reportSha256: verified.reportSha256,
      unitRegression: true, nativeAcceptance: false }, null, 2));
    return 0;
  }
  const result = runModelingPermissionRegression({
    ...options, source: values.source, output: values.output, mavenRepository: values['maven-repository'],
  });
  console.log(JSON.stringify({ reportPath: result.reportPath, status: result.report.status,
    unitRegression: result.report.unitRegression, nativeAcceptance: false, errors: result.report.errors }, null, 2));
  return result.report.unitRegression ? 0 : 1;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
