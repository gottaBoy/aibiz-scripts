import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { verifyAiCodeHttpDelivery } from '../harness-native-ai-code-docker.mjs';
import { readTree } from '../native-candidate-files.mjs';
import {
  AI_CODE_PUBLISHED, AI_CODE_SOURCE, prepareNativeAiCodeDeployment,
} from '../prepare-native-ai-code-deployment.mjs';

const workspaceRoot = fileURLToPath(new URL('../../', import.meta.url));
const scriptsRoot = join(workspaceRoot, 'scripts');

function copy(from, to) {
  fs.mkdirSync(dirname(to), { recursive: true });
  fs.copyFileSync(from, to, fs.constants.COPYFILE_EXCL);
}

async function stalledHttp(t) {
  let requested;
  const pendingRequest = new Promise(resolve => { requested = resolve; });
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-length': '4096' });
    response.write('partial body');
    requested(request.url);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => {
    await new Promise((resolve, reject) => {
      server.close(error => error ? reject(error) : resolve());
      server.closeAllConnections();
    });
  });
  return { url: `http://127.0.0.1:${server.address().port}`, pendingRequest };
}

function cliFixture(t, url, { failedStart = false, cleanupSignal = null } = {}) {
  const workspace = fs.mkdtempSync(join(tmpdir(), 'native-ai-code-signals-'));
  const source = join(workspaceRoot, AI_CODE_SOURCE);
  const published = join(workspaceRoot, AI_CODE_PUBLISHED);
  const receipt = JSON.parse(fs.readFileSync(join(source, '.artifacts/build-receipt.json')));
  for (const entry of [...receipt.inputs, ...receipt.outputs]) {
    copy(join(source, entry.path), join(workspace, AI_CODE_SOURCE, entry.path));
  }
  copy(join(source, '.artifacts/build-receipt.json'),
    join(workspace, AI_CODE_SOURCE, '.artifacts/build-receipt.json'));
  copy(join(published, 'package.json'), join(workspace, AI_CODE_PUBLISHED, 'package.json'));
  for (const directory of ['src', 'dist/assets']) {
    for (const entry of readTree(join(published, directory), { jsonOnly: false }).entries) {
      copy(join(published, directory, entry.path),
        join(workspace, AI_CODE_PUBLISHED, directory, entry.path));
    }
  }
  for (const file of [
    'harness-native-ai-code-docker.mjs', 'native-candidate-files.mjs',
    'prepare-native-ai-code-deployment.mjs', 'repair-native-model-resources.mjs',
    'harness-native-ai-code-source-deps.mjs',
    'harness-native-cli-source-build.mjs', 'fetch-native-cli-source.mjs',
    'containers/native-ai-code/Dockerfile', 'containers/native-ai-code/nginx.conf',
  ]) {
    copy(join(scriptsRoot, file), join(workspace, 'scripts', file));
  }
  const candidate = join(workspace, '.artifacts/native-ai-code-deployment/candidate');
  prepareNativeAiCodeDeployment({ workspace, output: candidate });
  const output = join(workspace, '.artifacts/native-ai-code-docker/run');
  const bin = join(workspace, 'bin');
  fs.mkdirSync(bin);
  const statePath = join(workspace, 'docker-state.json');
  const callsPath = join(workspace, 'docker-calls.jsonl');
  const containerId = 'c'.repeat(64);
  const script = `#!${process.execPath}
const fs = require('node:fs');
const statePath = ${JSON.stringify(statePath)};
const callsPath = ${JSON.stringify(callsPath)};
const args = process.argv.slice(2);
const state = fs.existsSync(statePath) ? JSON.parse(fs.readFileSync(statePath)) : {};
const save = () => fs.writeFileSync(statePath, JSON.stringify(state));
const emit = value => process.stdout.write(value + '\\n');
fs.appendFileSync(callsPath, JSON.stringify(args) + '\\n');
if (args[0] === 'image') {
  const base = args[2] === 'test/native-ai-code:local';
  emit(JSON.stringify([{
    Id: 'sha256:' + (base ? 'a' : 'b').repeat(64), Architecture: 'arm64',
    Config: { User: '101:101' },
    RootFS: { Layers: base ? ['base'] : ['base', 'built'] },
  }]));
} else if (args[0] === 'build') {
  emit('built');
} else if (args[0] === 'create') {
  state.name = args[args.indexOf('--name') + 1];
  state.owner = args[args.indexOf('--label') + 1].split('=')[1];
  save();
  emit('${containerId}');
} else if (args[0] === 'start') {
  state.started = true;
  save();
  if (${failedStart}) {
    process.stderr.write('Injected start failure');
    process.exitCode = 1;
  }
} else if (args[0] === 'inspect') {
  if (state.removed) {
    process.stderr.write('No such container: ' + args[1]);
    process.exitCode = 1;
    if (${JSON.stringify(cleanupSignal)}) process.kill(process.ppid, ${JSON.stringify(cleanupSignal)});
  } else {
    emit(JSON.stringify([{
      Id: '${containerId}', Name: '/' + state.name, Image: 'sha256:' + 'b'.repeat(64),
      Config: { User: '101:101', Labels: { 'io.aibiz.native-ai-code.run': state.owner } },
      HostConfig: {
        ReadonlyRootfs: true, Tmpfs: { '/tmp': 'uid=101,gid=101,mode=0700' },
        CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges:true'],
      },
      Mounts: [],
      NetworkSettings: { Ports: { '8080/tcp': [{
        HostIp: '127.0.0.1', HostPort: '${new URL(url).port}',
      }] } },
    }]));
  }
} else if (args[0] === 'logs') {
  emit('interrupted container log');
} else if (args[0] === 'rm') {
  state.removed = true;
  save();
  emit('${containerId}');
} else {
  process.stderr.write('Unexpected Docker command: ' + JSON.stringify(args));
  process.exitCode = 1;
}
`;
  fs.writeFileSync(join(bin, 'docker'), script, { mode: 0o700, flag: 'wx' });
  const child = spawn(process.execPath, [
    join(workspace, 'scripts/harness-native-ai-code-docker.mjs'),
    '--deployment-receipt', join(candidate, 'receipt.json'),
    '--output', output, '--base-image', 'test/native-ai-code:local',
  ], { env: { ...process.env, PATH: bin }, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  const closed = once(child, 'close');
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await closed;
    fs.rmSync(workspace, { recursive: true, force: true });
  });
  return { child, closed, output, callsPath, statePath, containerId,
    streams: () => ({ stdout, stderr }) };
}

for (const [signal, exitCode] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  test(`CLI ${signal} cancels an unfinished HTTP body and confirms owned-container cleanup`, {
    timeout: 15_000,
  }, async t => {
    const http = await stalledHttp(t);
    const fixture = cliFixture(t, http.url);
    const first = await Promise.race([
      http.pendingRequest.then(path => ({ path })),
      fixture.closed.then(([code, killed]) => ({ code, killed })),
    ]);
    assert.deepEqual(first, { path: '/health' }, fixture.streams().stderr);
    assert.equal(fixture.child.kill(signal), true);
    assert.deepEqual(await fixture.closed, [exitCode, null]);
    const { stdout, stderr } = fixture.streams();
    assert.equal(stderr, '');
    const report = JSON.parse(stdout);
    const { reportPath, ...persisted } = report;
    assert.deepEqual(JSON.parse(fs.readFileSync(join(fixture.output, 'report.json'))), persisted);
    assert.match(reportPath, /native-ai-code-docker\/run\/report\.json$/);
    assert.equal(report.status, 'interrupted');
    assert.deepEqual(report.interruption, { signal, reason: `Interrupted by ${signal}` });
    assert.deepEqual(report.cleanup, { status: 'passed', containerId: fixture.containerId });
    assert.equal(report.acceptedForProduction, false);
    assert.equal(report.nativeRuntimeAccepted, false);
    assert.equal(JSON.parse(fs.readFileSync(fixture.statePath)).removed, true);
    const calls = fs.readFileSync(fixture.callsPath, 'utf8').trim().split('\n').map(JSON.parse);
    assert.deepEqual(calls.at(-2), ['rm', '--force', '--volumes', fixture.containerId]);
    assert.equal(calls.at(-1)[0], 'inspect');
    assert.equal(calls.at(-1)[1], report.container.name);
  });

  test(`CLI records ${signal} received during the last synchronous cleanup command (20 repetitions)`, {
    timeout: 60_000,
  }, async t => {
    for (let iteration = 0; iteration < 20; iteration++) {
      const fixture = cliFixture(t, 'http://127.0.0.1:1', { failedStart: true, cleanupSignal: signal });
      assert.deepEqual(await fixture.closed, [exitCode, null], `iteration ${iteration}`);
      const { stdout, stderr } = fixture.streams();
      assert.equal(stderr, '');
      const report = JSON.parse(stdout);
      assert.equal(report.status, 'interrupted');
      assert.deepEqual(report.interruption, { signal, reason: `Interrupted by ${signal}` });
      assert.deepEqual(report.cleanup, { status: 'passed', containerId: fixture.containerId });
      assert.equal(report.acceptedForProduction, false);
      assert.equal(report.nativeRuntimeAccepted, false);
      assert.equal(JSON.parse(fs.readFileSync(fixture.statePath)).removed, true);
      assert.equal(JSON.parse(fs.readFileSync(join(fixture.output, 'report.json'))).status, 'interrupted');
    }
  });
}

test('HTTP verifier honors cancellation before sending any request', async () => {
  const controller = new AbortController();
  const reason = new Error('cancel before delivery');
  controller.abort(reason);
  await assert.rejects(verifyAiCodeHttpDelivery('http://127.0.0.1:1', [
    { path: 'index.js', bytes: 1, sha256: 'unused' },
  ], { signal: controller.signal }), error => error === reason);
});

test('HTTP verifier cancellation covers response-body reading', { timeout: 5000 }, async t => {
  const { url, pendingRequest } = await stalledHttp(t);
  const controller = new AbortController();
  const reason = new Error('cancel partial body');
  const delivery = verifyAiCodeHttpDelivery(url, [
    { path: 'index.js', bytes: 4096, sha256: 'unused' },
  ], { signal: controller.signal });
  const rejected = assert.rejects(delivery, /cancel partial body|aborted/i);
  assert.match(await pendingRequest, /\/index\.js$/);
  controller.abort(reason);
  await rejected;
});
