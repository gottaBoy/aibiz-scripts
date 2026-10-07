import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import fs from 'node:fs';
import { createServer } from 'node:http';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  prepareAiCodeDockerContext, runAiCodeDockerHarness, verifyAiCodeHttpDelivery,
} from '../harness-native-ai-code-docker.mjs';
import { fingerprint, PinnedDirectories, readTree } from '../native-candidate-files.mjs';
import {
  AI_CODE_PUBLISHED, AI_CODE_SOURCE, AUDITED_AI_CODE_BUILD, prepareNativeAiCodeDeployment,
} from '../prepare-native-ai-code-deployment.mjs';

const workspaceRoot = fileURLToPath(new URL('../../', import.meta.url));
const templateRoot = fileURLToPath(new URL('../containers/native-ai-code/', import.meta.url));
const repo = '@ibiz-template-plugin/ai-code@0.0.3-alpha.141';
const realSource = join(workspaceRoot, AI_CODE_SOURCE);
const realPublished = join(workspaceRoot, AI_CODE_PUBLISHED);
const buildReceiptPath = source => join(source, '.artifacts/build-receipt.json');
const buildReceiptBytes = fs.readFileSync(buildReceiptPath(realSource));
const buildReceipt = JSON.parse(buildReceiptBytes);
const prefixes = ['/plugins/', '/central/plugins/', '/modeldesign/plugins/'];
const hash = data => createHash('sha256').update(data).digest('hex');
const tree = root => readTree(root, { jsonOnly: false });
const deploymentEntries = [
  ...buildReceipt.outputs,
  buildReceipt.inputs.find(entry => entry.path === 'package.json'),
].sort((left, right) => left.path.localeCompare(right.path));
const deliveryFiles = deploymentEntries.map(entry => ({
  ...entry, data: fs.readFileSync(join(realSource, entry.path)),
}));

function write(path, data) {
  fs.mkdirSync(dirname(path), { recursive: true });
  fs.writeFileSync(path, data);
}

function copy(from, to) {
  fs.mkdirSync(dirname(to), { recursive: true });
  fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
}

function editJson(path, edit) {
  const value = JSON.parse(fs.readFileSync(path, 'utf8'));
  edit(value);
  fs.writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
}

function fixture(t) {
  const workspace = fs.mkdtempSync(join(tmpdir(), 'native-ai-code-docker-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const source = join(workspace, AI_CODE_SOURCE);
  const published = join(workspace, AI_CODE_PUBLISHED);
  for (const entry of [...buildReceipt.inputs, ...buildReceipt.outputs]) {
    copy(join(realSource, entry.path), join(source, entry.path));
  }
  write(buildReceiptPath(source), buildReceiptBytes);
  copy(join(realPublished, 'package.json'), join(published, 'package.json'));
  for (const root of ['src', 'dist/assets']) {
    for (const entry of tree(join(realPublished, root)).entries) {
      copy(join(realPublished, root, entry.path), join(published, root, entry.path));
    }
  }
  const candidate = join(workspace, '.artifacts/native-ai-code-deployment/candidate');
  prepareNativeAiCodeDeployment({
    workspace, source, published, expectedBuild: AUDITED_AI_CODE_BUILD, output: candidate,
  });
  return {
    workspace, source, published, expectedBuild: AUDITED_AI_CODE_BUILD,
    receipt: join(candidate, 'receipt.json'),
    output: join(workspace, '.artifacts/native-ai-code-docker/run'),
  };
}

// Snapshot links without following them, including evidence intentionally made invalid.
function snapshot(root) {
  const entries = [];
  function visit(path, name) {
    const info = fs.lstatSync(path);
    const entry = { path: name, mode: info.mode & 0o777 };
    if (info.isSymbolicLink()) {
      entries.push({ ...entry, type: 'symlink', target: fs.readlinkSync(path) });
    } else if (info.isDirectory()) {
      entries.push({ ...entry, type: 'directory' });
      for (const child of fs.readdirSync(path).sort()) {
        visit(join(path, child), name ? `${name}/${child}` : child);
      }
    } else {
      const data = fs.readFileSync(path);
      entries.push({ ...entry, type: 'file', bytes: data.length, sha256: hash(data) });
    }
  }
  try { fs.lstatSync(root); }
  catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  visit(root, '');
  return entries;
}

function evidence(options) {
  return {
    source: snapshot(options.source),
    published: snapshot(options.published),
    deployment: snapshot(dirname(options.receipt)),
  };
}

function assertRejected(options, expected, message) {
  const before = evidence(options);
  const destination = resolve(options.workspace, options.output);
  const outputBefore = snapshot(destination);
  assert.throws(() => prepareAiCodeDockerContext(options), expected, message);
  assert.deepEqual(snapshot(destination), outputBefore);
  assert.deepEqual(evidence(options), before);
}

function assertNotAccepted(verified) {
  assert.equal(verified.status, 'verified-deployment-not-accepted');
  assert.equal(verified.deploymentIntegrityVerified, true);
  assert.equal(verified.acceptedForProduction, false);
  assert.equal(verified.originalRepositoryAuthenticated, false);
  assert.deepEqual(verified.mapping, {
    requested: '@ibiz-template-plugin/ai-code@0.0.3-alpha.92',
    candidate: repo, compatibility: 'not-verified',
  });
  assert.equal(verified.dependencies.ibizDependencySourceBuildsVerified, false);
}

test('fresh context binds exactly 68 deployment files and the two unchanged templates', t => {
  const options = fixture(t);
  const before = evidence(options);
  options.output = relative(options.workspace, options.output);
  const prepared = prepareAiCodeDockerContext(options);
  const expectedFiles = [
    ...['Dockerfile', 'nginx.conf'].map(path => ({
      path, data: fs.readFileSync(join(templateRoot, path)),
    })),
    ...tree(join(dirname(options.receipt), 'plugins', repo)).contents.map(file => ({
      path: `plugins/${repo}/${file.path}`, data: file.data,
    })),
  ].sort((left, right) => left.path.localeCompare(right.path));
  const entries = expectedFiles.map(({ path, data }) => ({
    path, bytes: data.length, sha256: hash(data),
  }));
  assert.equal(prepared.workspace, options.workspace);
  assert.equal(prepared.destination, resolve(options.workspace, options.output));
  assert.equal(prepared.contextPath, join(prepared.destination, 'context'));
  assert.deepEqual(fs.readdirSync(prepared.destination), ['context']);
  assert.deepEqual(fs.readdirSync(prepared.contextPath).sort(), ['Dockerfile', 'nginx.conf', 'plugins']);
  assert.deepEqual(fs.readdirSync(join(prepared.contextPath, 'plugins')), ['@ibiz-template-plugin']);
  assert.deepEqual(fs.readdirSync(join(prepared.contextPath, 'plugins', '@ibiz-template-plugin')),
    ['ai-code@0.0.3-alpha.141']);
  assert.deepEqual(tree(prepared.contextPath).entries, entries);
  assert.deepEqual(prepared.context, { ...fingerprint(entries), entries });
  assert.equal(prepared.context.files, 68 + 2);
  assert.deepEqual(tree(join(prepared.contextPath, 'plugins', repo)).entries, deploymentEntries);
  for (const file of expectedFiles) {
    assert.deepEqual(fs.readFileSync(join(prepared.contextPath, file.path)), file.data, file.path);
  }
  for (const entry of snapshot(prepared.destination)) {
    assert.equal(entry.mode, entry.type === 'directory' ? 0o700 : 0o600, entry.path);
  }
  assert.deepEqual(prepared.deploymentReceipt, {
    path: relative(options.workspace, options.receipt),
    sha256: hash(fs.readFileSync(options.receipt)),
  });
  assertNotAccepted(prepared.verified);
  assert.equal(JSON.parse(fs.readFileSync(options.receipt)).status, 'prepared-not-accepted');
  assert.deepEqual(evidence(options), before);
});

for (const [label, mutate] of [
  ['production acceptance', receipt => { receipt.acceptedForProduction = true; }],
  ['deployment entry hash', receipt => { receipt.deployment.entries[0].sha256 = '0'.repeat(64); }],
]) {
  test(`context rejects receipt tampering: ${label}`, t => {
    const options = fixture(t);
    editJson(options.receipt, mutate);
    assertRejected(options, /Deployment receipt differs/);
  });
}

for (const [label, mutate, expected] of [
  ['recorded source edit', options => {
    fs.appendFileSync(join(options.source, 'README.md'), '\nchanged input\n');
  }, /Audited source\/build fingerprint mismatch/],
  ['built output edit', options => {
    fs.appendFileSync(join(options.source, 'es/index.mjs'), '\nchanged output\n');
  }, /Audited source\/build fingerprint mismatch/],
  ['unrecorded source file', options => {
    write(join(options.source, 'src/unrecorded.ts'), 'export {};\n');
  }, /Audited source\/build fingerprint mismatch/],
  ['deployed output edit', options => {
    fs.appendFileSync(join(dirname(options.receipt), 'plugins', repo, 'es/index.mjs'), '\nchanged copy\n');
  }, /Deployment differs/],
  ['extra deployed file', options => {
    write(join(dirname(options.receipt), 'plugins', repo, 'extra.js'), 'unrecorded\n');
  }, /Deployment differs/],
]) {
  test(`context rejects drift without changing inputs: ${label}`, t => {
    const options = fixture(t);
    mutate(options);
    assertRejected(options, expected);
  });
}

for (const type of ['directory', 'file', 'symlink', 'dangling symlink']) {
  test(`existing output ${type} is never overwritten`, t => {
    const options = fixture(t);
    const target = join(options.workspace, 'existing-context');
    let targetBefore;
    fs.mkdirSync(dirname(options.output), { recursive: true });
    if (type === 'directory') write(join(options.output, 'sentinel'), 'retain existing context\n');
    else if (type === 'file') write(options.output, 'retain existing file\n');
    else {
      if (type === 'symlink') write(join(target, 'sentinel'), 'retain linked content\n');
      fs.symlinkSync(target, options.output, 'dir');
      targetBefore = snapshot(target);
    }
    assertRejected(options, /Existing destination must not be overwritten/);
    if (type.includes('symlink')) assert.deepEqual(snapshot(target), targetBefore);
  });
}

test('output root, nesting, traversal, overlap and invalid names reject before context creation', t => {
  const options = fixture(t);
  const root = join(options.workspace, '.artifacts/native-ai-code-docker');
  for (const [label, output, expected] of [
    ['artifact root', root, /Output must be a direct child/],
    ['nested child', join(root, 'run/nested'), /Output must be a direct child/],
    ['workspace escape', '../escaped-context', /Output must be a direct child/],
    ['artifact traversal', '.artifacts/native-ai-code-docker/../escaped', /Output must be a direct child/],
    ['source overlap', options.source, /Output must be a direct child/],
    ['deployment overlap', dirname(options.receipt), /Output must be a direct child/],
    ['invalid name', join(root, '-invalid'), /Invalid output name/],
  ]) {
    assertRejected({ ...options, output }, expected, label);
  }
  assert.equal(fs.existsSync(root), false);
});

test('a linked Docker artifact ancestor is rejected without changing its target', t => {
  const options = fixture(t);
  const target = join(options.workspace, 'linked-artifact-root');
  write(join(target, 'sentinel'), 'retain ancestor target\n');
  fs.symlinkSync(target, dirname(options.output), 'dir');
  const before = snapshot(target);
  assertRejected(options, /Symlink directory rejected/);
  assert.deepEqual(snapshot(target), before);
});

for (const kind of ['receipt', 'deployed file']) {
  test(`context rejects a linked ${kind} even when target bytes match`, t => {
    const options = fixture(t);
    const path = kind === 'receipt' ? options.receipt
      : join(dirname(options.receipt), 'plugins', repo, 'package.json');
    const target = join(options.workspace, 'linked-evidence');
    fs.renameSync(path, target);
    fs.symlinkSync(target, path, 'file');
    const before = snapshot(target);
    assertRejected(options, /Symlink/);
    assert.deepEqual(snapshot(target), before);
  });
}

test('a failed context write retains its partial context and cannot be retried over it', t => {
  const options = fixture(t);
  const before = evidence(options);
  const originalWrite = PinnedDirectories.prototype.write;
  let writes = 0;
  const mockedWrite = t.mock.method(PinnedDirectories.prototype, 'write', function (...args) {
    if (++writes === 3) throw new Error('Injected context write failure');
    return Reflect.apply(originalWrite, this, args);
  });
  assert.throws(() => prepareAiCodeDockerContext(options), /Injected context write failure/);
  mockedWrite.mock.restore();
  assert.deepEqual(tree(join(options.output, 'context')).entries.map(entry => entry.path),
    ['Dockerfile', 'nginx.conf']);
  assert.deepEqual(fs.readdirSync(options.output), ['context']);
  assert.deepEqual(evidence(options), before);
  assertRejected(options, /Existing destination must not be overwritten/);
});

test('pre-Docker failure retains a report that cannot imply native or production acceptance', async t => {
  const options = fixture(t);
  const before = evidence(options);
  // An invalid base image is rejected before the first Docker command.
  const report = await runAiCodeDockerHarness({ ...options, baseImage: '--invalid' });
  assert.equal(report.status, 'failed');
  assert.equal(report.deliveryStatus, 'failed');
  assert.equal(report.acceptedForProduction, false);
  assert.equal(report.nativeRuntimeAccepted, false);
  assert.equal(report.ibizDependencySourceBuildsVerified, false);
  assert.equal(report.mapping.compatibility, 'not-verified');
  assert.deepEqual(report.errors, ['Invalid base image']);
  assert.deepEqual(report.cleanup, { status: 'not-created' });
  assert.deepEqual(report.checks, []);
  assert.equal(report.context.files, 70);
  assert.deepEqual(fs.readdirSync(options.output).sort(), ['context', 'report.json']);
  const { reportPath, ...persisted } = report;
  assert.equal(reportPath, relative(options.workspace, join(options.output, 'report.json')));
  assert.deepEqual(JSON.parse(fs.readFileSync(join(options.workspace, reportPath))), persisted);
  assert.deepEqual(evidence(options), before);
});

async function httpFixture(t, mutate = () => {}) {
  const routes = new Map(prefixes.flatMap(prefix => deliveryFiles.map(file => [
    `${prefix}${repo}/${file.path}`, { status: 200, body: file.data },
  ])));
  mutate(routes);
  const requests = [];
  const server = createServer((request, response) => {
    requests.push({ path: request.url, method: request.method });
    const route = routes.get(request.url) ?? { status: 404, body: Buffer.from('not found\n') };
    response.writeHead(route.status, {
      'content-type': 'application/octet-stream',
      'content-length': route.body.length,
      ...route.headers,
    });
    response.end(route.body);
  });
  t.after(async () => {
    if (!server.listening) return;
    await new Promise((done, reject) => {
      server.close(error => error ? reject(error) : done());
      server.closeAllConnections();
    });
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  return { baseUrl: `http://127.0.0.1:${server.address().port}`, requests };
}

function expectedHttpChecks() {
  return prefixes.flatMap(prefix => [
    ...deploymentEntries.map(({ path, bytes, sha256 }) => ({
      path: `${prefix}${repo}/${path}`, status: 200, bytes, sha256,
    })),
    { path: `${prefix}@ibiz-template-plugin/ai-code@0.0.3-alpha.92/package.json`, status: 404 },
    { path: `${prefix}${repo}/missing.js`, status: 404 },
  ]);
}

function fakeDockerFixture(t, options, baseUrl, {
  logWriteFails = false, removalFails = false, baseVolume = false, finalVolume = false,
  wrongOwner = false, runtimeFailure = null,
  createTimesOut = false, invalidCreateStdout = false,
} = {}) {
  const root = fs.mkdtempSync(join(tmpdir(), 'native-ai-code-fake-docker-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(fs.statSync(root).mode & 0o777, 0o700);
  const containerId = 'c'.repeat(64);
  const baseImage = 'test/native-ai-code-nginx:local';
  const callsPath = join(root, 'calls.jsonl');
  const statePath = join(root, 'state.json');
  const config = {
    containerId, baseImage, callsPath, statePath, output: options.output,
    port: new URL(baseUrl).port, logWriteFails, removalFails, baseVolume, finalVolume, wrongOwner,
    runtimeFailure, invalidCreateStdout,
  };
  const script = `#!${process.execPath}
const fs = require('node:fs');
const { join } = require('node:path');
const config = ${JSON.stringify(config)};
const args = process.argv.slice(2);
fs.appendFileSync(config.callsPath, JSON.stringify(args) + '\\n', { mode: 0o600 });
const state = fs.existsSync(config.statePath)
  ? JSON.parse(fs.readFileSync(config.statePath, 'utf8')) : {};
const save = () => fs.writeFileSync(config.statePath, JSON.stringify(state), { mode: 0o600 });
const emit = value => process.stdout.write(value + '\\n');
const fail = message => { process.stderr.write(message + '\\n'); process.exitCode = 1; };
const baseLayer = 'sha256:' + 'd'.repeat(64);
if (args[0] === 'image' && args[1] === 'inspect' &&
    (args[2] === config.baseImage || args[2] === state.imageTag)) {
  const base = args[2] === config.baseImage;
  emit(JSON.stringify([{
    Id: 'sha256:' + (base ? 'a' : 'b').repeat(64), Architecture: 'amd64',
    RootFS: { Layers: base ? [baseLayer] : [baseLayer, 'sha256:' + 'e'.repeat(64)] },
    Config: {
      User: '101:101',
      Volumes: (base ? config.baseVolume : config.finalVolume) ? { '/unexpected': {} } : null,
    },
  }]));
} else if (args[0] === 'build') {
  state.imageTag = args[args.indexOf('--tag') + 1];
  save();
  emit('Fake Docker image built');
} else if (args[0] === 'create') {
  state.created = true;
  state.containerName = args[args.indexOf('--name') + 1];
  const labelIndex = args.indexOf('--label');
  state.runLabel = labelIndex < 0 ? null : args[labelIndex + 1].split('=').slice(1).join('=');
  save();
  emit(config.invalidCreateStdout ? 'invalid-container-id' : config.containerId);
} else if (args[0] === 'start' && args[1] === config.containerId && state.created) {
  state.started = true;
  save();
} else if (args[0] === 'inspect' &&
    (args[1] === config.containerId || args[1] === state.containerName ||
      /^aibiz-native-ai-code-[a-f0-9-]+$/.test(args[1]))) {
  if (!state.created || state.removed) fail('No such container: ' + args[1]);
  else emit(JSON.stringify([{
    Id: config.containerId, Name: '/' + state.containerName,
    Image: 'sha256:' + 'b'.repeat(64),
    Config: {
      User: '101:101', Volumes: null,
      Labels: { 'io.aibiz.native-ai-code.run': config.wrongOwner ? 'foreign-run' : state.runLabel },
    },
    HostConfig: {
      ReadonlyRootfs: true, Tmpfs: { '/tmp': 'uid=101,gid=101,mode=0700' },
      CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges:true'],
      ...(config.runtimeFailure === 'capAdd' ? { CapAdd: ['SYS_ADMIN'] } : {}),
      ...(config.runtimeFailure === 'privileged' ? { Privileged: true } : {}),
    },
    Mounts: config.runtimeFailure === 'persistentMount'
      ? [{ Type: 'volume', Name: 'unexpected', Destination: '/srv/plugins', RW: true }] : [],
    State: { Status: state.started ? 'running' : 'created', Running: !!state.started },
    NetworkSettings: { Ports: { '8080/tcp': [{ HostIp: '127.0.0.1', HostPort: config.port }] } },
  }]));
} else if (args[0] === 'logs' && args[1] === config.containerId && state.created) {
  if (config.logWriteFails) {
    fs.writeFileSync(join(config.output, 'container.log'), 'retain existing container log\\n',
      { flag: 'wx', mode: 0o600 });
  }
  emit('Fake container log');
} else if (args.length === 4 && args[0] === 'rm' && args[1] === '--force' &&
    args[2] === '--volumes' && args[3] === config.containerId) {
  state.removalAttempted = true;
  state.removed = !config.removalFails;
  save();
  if (config.removalFails) fail('Injected fake Docker removal failure');
  else emit(config.containerId);
} else {
  fail('Unexpected fake Docker arguments: ' + JSON.stringify(args));
}
`;
  fs.writeFileSync(join(root, 'docker'), script, { flag: 'wx', mode: 0o700 });
  return {
    containerId,
    calls: () => fs.readFileSync(callsPath, 'utf8').trim().split('\n').map(line => JSON.parse(line)),
    state: () => fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath, 'utf8')) : {},
    run: async () => {
      const previousPath = process.env.PATH;
      const originalSpawn = childProcess.spawnSync;
      let mockedSpawn;
      // Only this executable is reachable; unknown commands never invoke real Docker.
      process.env.PATH = root;
      try {
        if (createTimesOut) {
          mockedSpawn = t.mock.method(childProcess, 'spawnSync', function (command, args, spawnOptions) {
            const result = Reflect.apply(originalSpawn, this, [command, args, spawnOptions]);
            if (command === 'docker' && args[0] === 'create' && !result.error && result.status === 0) {
              return {
                ...result, status: null, signal: 'SIGTERM', stdout: '',
                error: Object.assign(new Error('spawnSync docker ETIMEDOUT'), { code: 'ETIMEDOUT' }),
              };
            }
            return result;
          });
          syncBuiltinESMExports();
        }
        return await runAiCodeDockerHarness({ ...options, baseImage });
      } finally {
        if (mockedSpawn) {
          mockedSpawn.mock.restore();
          syncBuiltinESMExports();
        }
        if (previousPath === undefined) delete process.env.PATH;
        else process.env.PATH = previousPath;
      }
    },
  };
}

function assertRetainedFailedReport(options, report, before) {
  assert.equal(report.status, 'failed');
  assert.equal(report.acceptedForProduction, false);
  assert.equal(report.nativeRuntimeAccepted, false);
  assert.equal(report.ibizDependencySourceBuildsVerified, false);
  assert.equal(report.mapping.compatibility, 'not-verified');
  const { reportPath, ...persisted } = report;
  assert.equal(reportPath, relative(options.workspace, join(options.output, 'report.json')));
  assert.deepEqual(JSON.parse(fs.readFileSync(join(options.workspace, reportPath))), persisted);
  assert.equal(report.context.files, 70);
  assert.deepEqual(tree(join(options.output, 'context')).entries, report.context.entries);
  assert.deepEqual(evidence(options), before);
}

function assertOwnedCleanup(fake, report) {
  const runId = report.container.name.slice('aibiz-native-ai-code-'.length);
  assert.match(runId, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
  const created = fake.calls().find(args => args[0] === 'create');
  assert.equal(created[created.indexOf('--label') + 1], `io.aibiz.native-ai-code.run=${runId}`);
  assert.equal(fake.state().runLabel, runId);
  assert.equal(report.container.id, fake.containerId);
  assert.deepEqual(fake.calls().slice(-4), [
    ['inspect', report.container.name],
    ['logs', fake.containerId],
    ['rm', '--force', '--volumes', fake.containerId],
    ['inspect', report.container.name],
  ]);
  assert.equal(fake.state().removalAttempted, true);
}

for (const logWriteFails of [true, false]) {
  const failure = logWriteFails ? 'container.log write' : 'container removal';
  test(`${failure} failure still inspects cleanup and retains a non-accepted failed report`, {
    timeout: 15_000,
  }, async t => {
    const options = fixture(t);
    const before = evidence(options);
    const { baseUrl, requests } = await httpFixture(t, routes => {
      routes.set('/health', { status: 200, body: Buffer.from('ok\n') });
    });
    const fake = fakeDockerFixture(t, options, baseUrl, {
      logWriteFails, removalFails: !logWriteFails,
    });
    const previousPath = process.env.PATH;
    const report = await fake.run();
    assert.equal(process.env.PATH, previousPath);
    assert.equal(report.deliveryStatus, 'passed');
    assert.deepEqual(report.checks, expectedHttpChecks());
    assert.deepEqual(requests, [
      { path: '/health', method: 'GET' },
      ...expectedHttpChecks().map(({ path }) => ({ path, method: 'GET' })),
    ]);
    assertOwnedCleanup(fake, report);
    assert.deepEqual(report.container.isolation, {
      verified: true, imageId: 'sha256:' + 'b'.repeat(64), user: '101:101',
      readOnly: true, tmpfs: { '/tmp': 'uid=101,gid=101,mode=0700' }, mounts: [],
      ownership: { label: 'io.aibiz.native-ai-code.run', value: fake.state().runLabel },
    });
    assert.equal(fake.state().removed, logWriteFails);
    assert.deepEqual(report.cleanup, {
      status: logWriteFails ? 'passed' : 'failed', containerId: fake.containerId,
    });
    assert.equal(report.errors.length, 1);
    if (logWriteFails) {
      assert.match(report.errors[0], /EEXIST.*container\.log/);
      assert.equal(fs.readFileSync(join(options.output, 'container.log'), 'utf8'),
        'retain existing container log\n');
    } else {
      assert.equal(report.errors[0], 'Failed to confirm isolated container cleanup');
      assert.equal(fs.readFileSync(join(options.output, 'container.log'), 'utf8'),
        'Fake container log\n');
    }
    assertRetainedFailedReport(options, report, before);
  });
}

test('a container created before client timeout is recovered by name and removed with volumes', {
  timeout: 15_000,
}, async t => {
  const options = fixture(t);
  const before = evidence(options);
  const fake = fakeDockerFixture(t, options, 'http://127.0.0.1:1', { createTimesOut: true });
  const originalSpawn = childProcess.spawnSync;
  const originalPath = process.env.PATH;
  const report = await fake.run();
  assert.equal(childProcess.spawnSync, originalSpawn);
  assert.equal(process.env.PATH, originalPath);
  assert.equal(report.deliveryStatus, 'failed');
  assert.equal(report.errors.length, 1);
  assert.match(report.errors[0], /ETIMEDOUT/);
  assert.equal(fake.state().created, true);
  assert.equal(fake.state().started, undefined);
  assert.equal(fake.state().removed, true);
  assert.equal(fake.calls().some(args => args[0] === 'start'), false);
  assertOwnedCleanup(fake, report);
  assert.deepEqual(report.cleanup, { status: 'passed', containerId: fake.containerId });
  assert.equal(report.container.isolation, undefined);
  assert.deepEqual(report.checks, []);
  assertRetainedFailedReport(options, report, before);
});

test('invalid create stdout recovers the owned container by name and removes it with volumes', {
  timeout: 15_000,
}, async t => {
  const options = fixture(t);
  const before = evidence(options);
  const fake = fakeDockerFixture(t, options, 'http://127.0.0.1:1', { invalidCreateStdout: true });
  const originalPath = process.env.PATH;
  const report = await fake.run();
  assert.equal(process.env.PATH, originalPath);
  assert.equal(report.deliveryStatus, 'failed');
  assert.equal(report.errors.length, 1);
  assert.match(report.errors[0], /invalid-container-id/);
  assert.equal(fake.state().created, true);
  assert.equal(fake.state().started, undefined);
  assert.equal(fake.state().removed, true);
  assert.equal(fake.calls().some(args => args[0] === 'start'), false);
  assertOwnedCleanup(fake, report);
  assert.deepEqual(report.cleanup, { status: 'passed', containerId: fake.containerId });
  assert.equal(report.container.isolation, undefined);
  assert.deepEqual(report.checks, []);
  assert.equal(fs.readFileSync(join(options.output, 'container.log'), 'utf8'),
    'Fake container log\n');
  assertRetainedFailedReport(options, report, before);
});

for (const [subject, flags] of [
  ['Base image', { baseVolume: true }],
  ['Built image', { finalVolume: true }],
]) {
  test(`${subject} persistent volume declarations reject before container creation`, {
    timeout: 15_000,
  }, async t => {
    const options = fixture(t);
    const before = evidence(options);
    const fake = fakeDockerFixture(t, options, 'http://127.0.0.1:1', flags);
    const report = await fake.run();
    assert.equal(report.deliveryStatus, 'failed');
    assert.deepEqual(report.cleanup, { status: 'not-created' });
    assert.equal(report.errors.length, 1);
    assert.ok(report.errors[0].includes(`${subject} must not declare persistent volumes`));
    assert.equal(fake.calls().some(args => ['create', 'start', 'inspect', 'logs', 'rm'].includes(args[0])),
      false);
    assert.equal(fake.calls().some(args => args[0] === 'build'), subject === 'Built image');
    assert.notEqual(fake.state().created, true);
    assert.deepEqual(report.checks, []);
    assertRetainedFailedReport(options, report, before);
  });
}

test('a matching container name with a foreign owner label is neither logged nor removed', {
  timeout: 15_000,
}, async t => {
  const options = fixture(t);
  const before = evidence(options);
  const fake = fakeDockerFixture(t, options, 'http://127.0.0.1:1', { wrongOwner: true });
  const report = await fake.run();
  assert.equal(report.deliveryStatus, 'failed');
  assert.equal(report.cleanup.status, 'failed');
  assert.ok(report.errors.length > 0);
  for (const error of report.errors) assert.match(error, /Isolated container ownership differs/);
  assert.deepEqual(fake.calls().at(-1), ['inspect', report.container.name]);
  assert.deepEqual(fake.calls().filter(args => ['logs', 'rm'].includes(args[0])), []);
  assert.equal(fake.state().created, true);
  assert.equal(fake.state().removalAttempted, undefined);
  assert.notEqual(fake.state().removed, true);
  assert.equal(report.container.isolation, undefined);
  assert.deepEqual(report.checks, []);
  assert.equal(fs.existsSync(join(options.output, 'container.log')), false);
  assertRetainedFailedReport(options, report, before);
});

for (const [label, runtimeFailure, expected] of [
  ['persistent volume mount', 'persistentMount', /Unexpected container mount/],
  ['added capability', 'capAdd', /Container must not add capabilities/],
  ['privileged mode', 'privileged', /Privileged container rejected/],
]) {
  test(`runtime ${label} is rejected and the owned container is still removed`, {
    timeout: 15_000,
  }, async t => {
    const options = fixture(t);
    const before = evidence(options);
    const fake = fakeDockerFixture(t, options, 'http://127.0.0.1:1', { runtimeFailure });
    const report = await fake.run();
    assert.equal(report.deliveryStatus, 'failed');
    assert.equal(report.errors.length, 1);
    assert.match(report.errors[0], expected);
    assert.equal(fake.state().started, true);
    assertOwnedCleanup(fake, report);
    assert.equal(fake.state().removed, true);
    assert.deepEqual(report.cleanup, { status: 'passed', containerId: fake.containerId });
    assert.equal(report.container.isolation, undefined);
    assert.deepEqual(report.checks, []);
    assert.equal(fs.readFileSync(join(options.output, 'container.log'), 'utf8'),
      'Fake container log\n');
    assertRetainedFailedReport(options, report, before);
  });
}

test('HTTP verifier checks all 68 files at all three prefixes and both negative routes', {
  timeout: 15_000,
}, async t => {
  const { baseUrl, requests } = await httpFixture(t);
  const checks = await verifyAiCodeHttpDelivery(baseUrl, deploymentEntries);
  const expected = expectedHttpChecks();
  assert.equal(deploymentEntries.length, 68);
  assert.equal(checks.length, 68 * 3 + 2 * 3);
  assert.deepEqual(checks, expected);
  assert.deepEqual(requests, expected.map(({ path }) => ({ path, method: 'GET' })));
});

for (const [label, change, expected] of [
  ['wrong status', route => ({ ...route, status: 503 }), /Plugin HTTP failure/],
  ['wrong length', route => ({
    ...route, body: Buffer.concat([route.body, Buffer.from('extra')]),
  }), /Plugin HTTP length differs/],
  ['same-length wrong hash', route => {
    const body = Buffer.from(route.body);
    body[0] ^= 0xff;
    return { ...route, body };
  }, /Plugin HTTP hash differs/],
]) {
  test(`HTTP verifier rejects ${label} and stops at the mismatched file`, {
    timeout: 15_000,
  }, async t => {
    const path = `${prefixes[1]}${repo}/${deploymentEntries[0].path}`;
    const { baseUrl, requests } = await httpFixture(t, routes => {
      routes.set(path, change(routes.get(path)));
    });
    await assert.rejects(verifyAiCodeHttpDelivery(baseUrl, deploymentEntries), expected);
    assert.equal(requests.length, 68 + 2 + 1);
    assert.equal(requests.at(-1).path, path);
  });
}

for (const [label, suffix] of [
  ['old alpha.92 package', '@ibiz-template-plugin/ai-code@0.0.3-alpha.92/package.json'],
  ['missing current file', `${repo}/missing.js`],
]) {
  test(`HTTP verifier rejects a 200 fallback for the ${label}`, {
    timeout: 15_000,
  }, async t => {
    const path = `${prefixes[2]}${suffix}`;
    const { baseUrl, requests } = await httpFixture(t, routes => {
      routes.set(path, { status: 200, body: Buffer.from('<html>fallback</html>') });
    });
    await assert.rejects(verifyAiCodeHttpDelivery(baseUrl, deploymentEntries),
      /Missing files must not receive a fallback/);
    assert.equal(requests.at(-1).path, path);
    assert.equal(requests.length, label === 'old alpha.92 package' ? 209 : 210);
  });
}
