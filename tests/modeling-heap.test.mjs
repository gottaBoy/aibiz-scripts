import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const workspace = fileURLToPath(new URL('../../', import.meta.url));
const source = readFileSync(join(workspace, 'modelingservice/start-docker.sh'), 'utf8');

function run(t, overrides = {}) {
  const root = mkdtempSync(join(tmpdir(), 'modeling-heap-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const directory of ['bin', 'service/.runtime', 'service/stubs/src']) {
    mkdirSync(join(root, directory), { recursive: true });
  }
  writeFileSync(join(root, 'service/start.sh'), source);
  writeFileSync(join(root, 'service/.runtime/ibiz-plugin-stubs.jar'), 'fixture');
  writeFileSync(join(root, 'provider.jar'), 'fixture');
  const trace = join(root, 'docker.jsonl');
  writeFileSync(join(root, 'bin/docker'), `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(process.env.TRACE, JSON.stringify(args) + '\\n');
if (args[0] === 'container') {
  if (process.env.LIST_DENIED === '1') {
    console.error('permission denied');
    process.exit(1);
  }
  if (process.env.EXISTING === '1') console.log('existing-container');
} else if (args[0] === 'run') console.log('test-container');
else process.exit(2);
`, { mode: 0o755 });
  const env = {
    ...process.env,
    PATH: `${join(root, 'bin')}:${process.env.PATH}`,
    TRACE: trace,
    MODELING_SERVICE_PROVIDER_JAR: join(root, 'provider.jar'),
    MODELING_SERVICE_IMAGE: 'fixture:jdk17',
    MODELING_SERVICE_PLATFORM: 'linux/arm64/v8',
  };
  delete env.MODELING_SERVICE_JAVA_XMS;
  delete env.MODELING_SERVICE_JAVA_XMX;
  const result = spawnSync('bash', [join(root, 'service/start.sh')], {
    env: { ...env, ...overrides }, encoding: 'utf8', timeout: 10000,
  });
  assert.ifError(result.error);
  const calls = readFileSync(trace, 'utf8').trim().split('\n').map(JSON.parse);
  return { result, calls, root };
}

test('Docker launcher uses 512M/2G with the local provider and unchanged application settings', t => {
  const { result, calls, root } = run(t);
  assert.equal(result.status, 0, result.stderr);
  const args = calls.find(call => call[0] === 'run');
  assert.ok(args.includes('-Xms512m'));
  assert.ok(args.includes('-Xmx2048m'));
  assert.equal(args[args.indexOf('--restart') + 1], 'unless-stopped');
  assert.ok(args.includes(`${join(root, 'provider.jar')}:/ibizservicerunner-provider.jar:ro`));
  assert.ok(args.includes('--ibiz.deploysystems.ibizmodeling.extension=false'));
  assert.ok(args.includes('fixture:jdk17'));
  assert.ok(!calls.some(call => ['rm', 'stop', 'rename'].includes(call[0])));
});

test('heap overrides remain effective', t => {
  const { result, calls } = run(t, {
    MODELING_SERVICE_JAVA_XMS: '1g', MODELING_SERVICE_JAVA_XMX: '3g',
  });
  assert.equal(result.status, 0, result.stderr);
  const args = calls.find(call => call[0] === 'run');
  assert.ok(args.includes('-Xms1g'));
  assert.ok(args.includes('-Xmx3g'));
  assert.ok(!args.includes('-Xmx2048m'));
});

test('existing containers and daemon errors cannot trigger deletion or replacement', t => {
  for (const overrides of [{ EXISTING: '1' }, { LIST_DENIED: '1' }]) {
    const { result, calls } = run(t, overrides);
    assert.notEqual(result.status, 0);
    assert.equal(calls.length, 1);
    assert.equal(calls[0][0], 'container');
  }
});

test('local launcher and Compose retain matching heap defaults', () => {
  const local = readFileSync(join(workspace, 'modelingservice/start-local.sh'), 'utf8');
  assert.ok(local.includes('JAVA_XMS=${MODELING_SERVICE_JAVA_XMS:-512m}'));
  assert.ok(local.includes('JAVA_XMX=${MODELING_SERVICE_JAVA_XMX:-2048m}'));
  assert.ok(local.includes('-Xmx$JAVA_XMX -Xms$JAVA_XMS'));
  const rendered = spawnSync('docker', [
    'compose', '-f', join(workspace, 'plm/deploy/compose/docker-compose-dev.yml'),
    '--env-file', join(workspace, 'plm/deploy/compose/.dev'), 'config', '--format', 'json',
  ], { encoding: 'utf8', timeout: 10000 });
  assert.equal(rendered.status, 0, rendered.stderr || rendered.error?.message);
  const service = JSON.parse(rendered.stdout).services.modelingservice;
  assert.equal(service.environment.JAVA_OPTS, '-Xms512m -Xmx2048m -Xss512K');
  assert.equal(service.restart, 'unless-stopped');
  assert.equal(service.environment.IBIZ_DEPLOYSYSTEMS_IBIZMODELING_EXTENSION, 'false');
});
