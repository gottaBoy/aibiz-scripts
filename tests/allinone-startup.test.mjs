import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync } from 'node:fs';
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';

const root = fileURLToPath(new URL('../../', import.meta.url));
const entrypoint = join(root, 'scripts/allinone-entrypoint.sh');

// Runtime commands are stubbed. Compose checks only use daemon-free config rendering.
const mockCommand = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const command = path.basename(process.argv[1]);
const args = process.argv.slice(2);
const directory = process.env.MOCK_DIRECTORY;
const file = name => path.join(directory, name);
const trace = line => fs.appendFileSync(file('trace'), line + '\\n');
const counter = name => {
  const old = fs.existsSync(file(name)) ? Number(fs.readFileSync(file(name), 'utf8')) : 0;
  fs.writeFileSync(file(name), String(old + 1));
  return old + 1;
};
if (command === 'date') {
  console.log(counter('clock'));
} else if (command === 'sleep') {
  setTimeout(() => {}, 25);
} else if (command === 'timeout') {
  const durationIndex = args[0] === '-t' ? 1 : 0;
  const commandIndex = durationIndex + 1;
  const result = spawnSync(args[commandIndex], args.slice(commandIndex + 1), {
    env: process.env, stdio: 'inherit', timeout: Number(args[durationIndex]) * 1000,
  });
  process.exit(result.status ?? 124);
} else if (command === 'bash' && args[0] === '-c') {
  const host = args[args.length - 2];
  const port = args[args.length - 1];
  trace('tcp ' + host + ':' + port);
  if (host === '127.0.0.1') {
    const probe = counter('listener-probes');
    const listening = process.env.MOCK_LISTENER === 'open' ||
      (process.env.MOCK_JAVA === 'ready' && fs.existsSync(file('java.json'))) ||
      (process.env.MOCK_JAVA === 'lose-listener' && fs.existsSync(file('java.json')) && probe <= 2);
    process.exit(listening ? 0 : 1);
  }
  process.exit(process.env.MOCK_DEPENDENCY === host ? 1 : 0);
} else if (command === 'nc') {
  const host = args[args.length - 2];
  const port = args[args.length - 1];
  trace('tcp ' + host + ':' + port);
  if (host === '127.0.0.1') {
    const probe = counter('listener-probes');
    const listening = process.env.MOCK_LISTENER === 'open' ||
      (process.env.MOCK_JAVA === 'ready' && fs.existsSync(file('java.json'))) ||
      (process.env.MOCK_JAVA === 'lose-listener' && fs.existsSync(file('java.json')) && probe <= 2);
    process.exit(listening ? 0 : 1);
  }
  process.exit(process.env.MOCK_DEPENDENCY === host ? 1 : 0);
} else if (command === 'curl') {
  trace('nacos-health');
  fs.writeFileSync(file('curl.json'), JSON.stringify(args));
  const attempt = counter('nacos-probes');
  process.exit(process.env.MOCK_NACOS === 'down' || (process.env.MOCK_NACOS === 'delayed' && attempt < 2) ? 22 : 0);
} else if (command === 'java') {
  trace('java');
  fs.writeFileSync(file('java.json'), JSON.stringify({ args, pid: process.pid, serverPort: process.env.SERVER_PORT }));
  process.on('SIGTERM', () => {
    trace('java-term');
    if (process.env.MOCK_JAVA !== 'ignore-term') process.exit(143);
  });
  if (process.env.MOCK_JAVA === 'crash') process.exit(7);
  if (process.env.MOCK_JAVA === 'exit-zero') process.exit(0);
  setInterval(() => {}, 100);
} else {
  throw new Error('Unexpected mock command: ' + command);
}
`;

async function fixture(t, overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'allinone-startup-'));
  const bin = join(directory, 'bin');
  await mkdir(bin);
  await writeFile(join(directory, 'app.jar'), 'mock application');
  await writeFile(join(directory, 'trace'), '');
  const commands = ['java', 'bash', 'curl', 'timeout', 'date', 'sleep'];
  if (overrides.NO_NC !== 'true') commands.push('nc');
  for (const command of commands) {
    const path = join(bin, command);
    await writeFile(path, mockCommand);
    await chmod(path, 0o755);
  }
  // On this host /bin is a symlink to /usr/bin, so keeping either on PATH
  // leaves the real nc visible and the fallback branch is never taken.
  const environment = {
    PATH: overrides.NO_NC === 'true'
      ? `${bin}:${dirname(process.execPath)}`
      : `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`,
    HOME: directory, LC_ALL: 'C', MOCK_DIRECTORY: directory,
    ALLINONE_JAR: join(directory, 'app.jar'),
    ALLINONE_DEPENDENCY_TIMEOUT: '3', ALLINONE_STARTUP_TIMEOUT: '3',
    ALLINONE_PROBE_INTERVAL: '1', ALLINONE_SHUTDOWN_TIMEOUT: '2', ALLINONE_FAILURE_THRESHOLD: '2',
    SERVER_PORT: '30000', TZ: 'Asia/Shanghai', JAVA_OPTS: '-Xms64m -Xmx128m -Dliteral=*',
    ...overrides,
  };
  const children = [];
  t.after(async () => {
    for (const child of children) {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = once(child, 'exit');
        child.kill('SIGKILL');
        await exited;
      }
    }
    const java = await readFile(join(directory, 'java.json'), 'utf8').then(JSON.parse).catch(() => null);
    if (java) {
      try { process.kill(java.pid, 'SIGKILL'); } catch {}
    }
    await rm(directory, { recursive: true, force: true });
  });
  return {
    directory,
    environment,
    async read(name) {
      return readFile(join(directory, name), 'utf8').catch(error => {
        if (error.code === 'ENOENT') return '';
        throw error;
      });
    },
    start(args = ['mysql:3306', 'nacos:8848', 'emqx:8083']) {
      const child = spawn('/bin/sh', [entrypoint, ...args], { env: environment, cwd: directory, stdio: ['ignore', 'pipe', 'pipe'] });
      children.push(child);
      let output = '';
      child.stdout.on('data', value => { output += value; });
      child.stderr.on('data', value => { output += value; });
      const result = new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', (code, signal) => resolve({ code, signal, output }));
      });
      return { child, result, output: () => output };
    },
  };
}

async function waitFor(predicate) {
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(20);
  }
  assert.fail('Mock condition did not become ready');
}

function assertStopped(pid) {
  assert.throws(() => process.kill(pid, 0), { code: 'ESRCH' });
}

test('both compose stacks use bounded launch and listener health without changing runtime volumes or JVM sizing', async t => {
  // These two stacks are operator supplied at the workspace root, and this
  // workspace deploys through plm/deploy/compose. restart-modeling-stack.sh
  // only reaches for the platform file when a running container says so, so the
  // check follows the same rule instead of failing on a stack that is absent.
  const stacks = ['docker-compose-platform.yml', 'docker-compose-local.yml'].filter(
    filename => existsSync(join(root, filename)),
  );
  if (stacks.length === 0) {
    t.skip('no root level allinone stack file to render');
    return;
  }
  for (const filename of stacks) {
    const rendered = spawnSync('docker', ['compose', '-f', join(root, filename), 'config', '--format', 'json'], {
      cwd: root, encoding: 'utf8', timeout: 10000,
    });
    assert.equal(rendered.status, 0, rendered.stderr || rendered.error?.message);
    const config = JSON.parse(rendered.stdout);
    const service = config.services['ibiz-ebsx-allinone'];
    assert.deepEqual(service.entrypoint, ['/bin/sh', '/usr/local/bin/allinone-entrypoint.sh']);
    assert.deepEqual(service.command, ['mysql:3306', 'nacos:8848', 'emqx:8083']);
    assert.deepEqual(service.healthcheck.test, ['CMD', '/bin/sh', '/usr/local/bin/allinone-entrypoint.sh', '--healthcheck']);
    assert.equal(service.healthcheck.start_period, '5m0s');
    assert.equal(service.stop_grace_period, '30s');
    assert.equal(service.ports[0].target, 30000);
    assert.equal(service.ports[0].published, '30000');
    assert.equal(service.volumes[0].source, 'aibiz_allinone');
    assert.equal(service.volumes[0].target, '/app/file');
    const mount = service.volumes.find(value => value.type === 'bind');
    assert.equal(mount.source, entrypoint);
    assert.equal(mount.read_only, true);
    assert.ok(mount.bind);
    assert.ok(!Object.values(service.networks).some(network => network?.aliases?.includes('nacos.ibizcloud.cn')));
    assert.equal(service.environment.SERVER_PORT, '30000');
    assert.equal(service.environment.SPRING_DATASOURCE_DEFAULTSCHEMA, 'a_lab01_3f9ebc219');
    assert.equal(service.environment.ALLINONE_PREPARE_LIQUIBASE_DRIVER, 'true');
    assert.equal(service.environment.JAVA_OPTS, filename.includes('platform')
      ? '-Xms1024m -Xmx3072m -Xss512K' : '-Xms256m -Xmx1024m -Xss256K');
    const downstream = config.services[filename.includes('platform') ? 'ibiz-ebsx-gateway' : 'ibizlab-uaa-api'];
    assert.equal(downstream.depends_on['ibiz-ebsx-allinone'].condition, 'service_healthy');
  }
});

test('the production development compose uses the same allinone wrapper and keeps modeling in the modeling profile', () => {
  const composePath = join(root, 'plm/deploy/compose/docker-compose-dev.yml');
  const rendered = spawnSync('docker', [
    'compose', '-f', composePath, '--env-file', join(root, 'plm/deploy/compose/.dev'),
    'config', '--format', 'json',
  ], { cwd: root, encoding: 'utf8', timeout: 10000 });
  assert.equal(rendered.status, 0, rendered.stderr || rendered.error?.message);
  const config = JSON.parse(rendered.stdout);
  const service = config.services['ibiz-ebsx-allinone'];
  assert.deepEqual(service.entrypoint, ['/bin/sh', '/usr/local/bin/allinone-entrypoint.sh']);
  assert.deepEqual(service.command, ['mysql:3306', 'nacos:8848', 'emqx:8083']);
  assert.equal(service.environment.SPRING_DATASOURCE_DEFAULTSCHEMA, 'a_lab01_3f9ebc219');
  assert.equal(service.environment.ALLINONE_PREPARE_LIQUIBASE_DRIVER, 'true');
  assert.deepEqual(service.healthcheck.test, ['CMD', '/bin/sh', '/usr/local/bin/allinone-entrypoint.sh', '--healthcheck']);
  assert.equal(service.healthcheck.start_period, '5m0s');
  assert.ok(service.volumes.some(value =>
    value.type === 'bind' && value.source === join(root, 'scripts/allinone-entrypoint.sh') &&
    value.target === '/usr/local/bin/allinone-entrypoint.sh' && value.read_only === true));
  assert.ok(!Object.values(service.networks).some(network => network?.aliases?.includes('nacos.ibizcloud.cn')));
  assert.ok(config.services.modelingservice.profiles.includes('modeling'));
  assert.ok(config.services['modeling-plugins'].profiles.includes('modeling'));
  const modelingWeb = config.services.modelingweb;
  assert.deepEqual(modelingWeb.command, [
    '/bin/sh', '-c',
    'cp /opt/aibiz/nginx-local.conf /etc/nginx/conf.d/nginx.conf && /bin/bash /opt/aibiz/local-start.sh',
  ]);
  assert.ok(modelingWeb.volumes.some(value =>
    value.type === 'bind' && value.source === join(root, 'modelingweb/start.sh') &&
    value.target === '/opt/aibiz/local-start.sh' && value.read_only === true));
  assert.equal(config.services.task.restart, 'unless-stopped');
  assert.deepEqual(config.services.task.entrypoint, ['/bin/bash', '/usr/local/bin/task-entrypoint.sh']);
  assert.deepEqual(config.services.task.command, ['mysql:3306']);
  assert.deepEqual(config.services.task.healthcheck.test, ['CMD', '/bin/bash', '/usr/local/bin/task-entrypoint.sh', '--healthcheck']);
  assert.equal(config.services.task.healthcheck.start_period, '30m0s');
  assert.equal(config.services.task.stop_grace_period, '30s');
  assert.ok(config.services.task.volumes.some(value =>
    value.type === 'volume' && value.source === 'task_data' &&
    value.target === '/app/application/taskfile/nasfolder'));
  assert.ok(config.services.task.volumes.some(value =>
    value.type === 'bind' && value.read_only === true &&
    value.source === join(root, 'scripts/task-entrypoint.sh')));
});

test('entrypoint passes POSIX shell syntax validation', () => {
  const result = spawnSync('/bin/sh', ['-n', entrypoint], { encoding: 'utf8', env: { ...process.env, LC_ALL: 'C' } });
  assert.equal(result.status, 0, result.stderr);
});

test('waits for both dependencies and Nacos API, preserves image JVM args, then forwards SIGTERM and reaps Java', { timeout: 12000 }, async t => {
  const testbed = await fixture(t, {
    MOCK_JAVA: 'ready',
    MOCK_NACOS: 'delayed',
    ALLINONE_NACOS_HTTP_CHECK: 'true',
  });
  const run = testbed.start();
  await waitFor(() => run.output().includes('listener ready'));
  const java = JSON.parse(await testbed.read('java.json'));
  assert.deepEqual(java.args.slice(0, 3), ['-Xms64m', '-Xmx128m', '-Dliteral=*']);
  assert.ok(java.args.includes('-Duser.timezone=Asia/Shanghai'));
  assert.ok(java.args.includes('-Djava.security.egd=file:/dev/./urandom'));
  assert.ok(!java.args.some(arg => arg.startsWith('-Xbootclasspath/a:')));
  assert.deepEqual(java.args.slice(-3), ['-jar', join(testbed.directory, 'app.jar'), '--server.port=30000']);
  const trace = (await testbed.read('trace')).trim().split('\n');
  assert.deepEqual(trace.slice(0, 5), [
    'tcp mysql:3306', 'tcp nacos:8848', 'tcp emqx:8083',
    'nacos-health', 'nacos-health',
  ]);
  // Java is spawned in the background, so the mock recording its own launch can
  // land either side of the first listener probe. Assert only the ordering the
  // entrypoint actually guarantees: Java starts after readiness of the
  // dependencies, and the port is then polled until it answers.
  assert.ok(trace.indexOf('java') > trace.lastIndexOf('nacos-health'));
  assert.ok(trace.indexOf('tcp 127.0.0.1:30000') > trace.indexOf('java'));
  const curl = JSON.parse(await testbed.read('curl.json'));
  assert.ok(curl.includes('--max-time'));
  assert.equal(curl.at(-1), 'http://nacos:8848/nacos/actuator/health');
  run.child.kill('SIGTERM');
  const result = await run.result;
  assert.equal(result.code, 143, result.output);
  assert.match(await testbed.read('trace'), /java-term/);
  assertStopped(java.pid);
});

test('uses the Bash TCP fallback when nc is unavailable', { timeout: 12000 }, async t => {
  const testbed = await fixture(t, { NO_NC: 'true', MOCK_JAVA: 'ready' });
  const run = testbed.start();
  await waitFor(() => run.output().includes('listener ready'));
  assert.match(await testbed.read('trace'), /tcp mysql:3306/);
  assert.match(await testbed.read('trace'), /tcp nacos:8848/);
  assert.match(await testbed.read('trace'), /tcp emqx:8083/);
  run.child.kill('SIGTERM');
  const result = await run.result;
  assert.equal(result.code, 143, result.output);
});

for (const dependency of ['mysql', 'nacos']) {
  test(`unavailable ${dependency} times out without starting Java`, { timeout: 10000 }, async t => {
    const testbed = await fixture(t, { MOCK_DEPENDENCY: dependency });
    const result = await testbed.start().result;
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, new RegExp(`dependency timed out: ${dependency}:`));
    assert.equal(await testbed.read('java.json'), '');
  });
}

test('an open Nacos TCP port with a failing HTTP health endpoint cannot start Java', { timeout: 10000 }, async t => {
  const testbed = await fixture(t, { MOCK_NACOS: 'down', ALLINONE_NACOS_HTTP_CHECK: 'true' });
  const result = await testbed.start().result;
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /Nacos health endpoint timed out/);
  assert.equal(await testbed.read('java.json'), '');
});

test('a Java process that stays alive without any listener is terminated and the container entrypoint fails', { timeout: 10000 }, async t => {
  const testbed = await fixture(t, { MOCK_JAVA: 'no-listener' });
  const result = await testbed.start().result;
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /startup timed out without a listener on 30000/);
  assert.match(await testbed.read('trace'), /java-term/);
  assertStopped(JSON.parse(await testbed.read('java.json')).pid);
});

test('loss of a previously ready listener cannot leave a live Java process marked Up indefinitely', { timeout: 10000 }, async t => {
  const testbed = await fixture(t, { MOCK_JAVA: 'lose-listener' });
  const result = await testbed.start().result;
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /listener ready/);
  assert.match(result.output, /listener lost for 2 consecutive probes/);
  assertStopped(JSON.parse(await testbed.read('java.json')).pid);
});

test('startup failure forcibly reaps a JVM that ignores SIGTERM', { timeout: 10000 }, async t => {
  const testbed = await fixture(t, { MOCK_JAVA: 'ignore-term' });
  const result = await testbed.start().result;
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /sending SIGKILL/);
  assertStopped(JSON.parse(await testbed.read('java.json')).pid);
});

for (const [mode, exitCode] of [['crash', 7], ['exit-zero', 1]]) {
  test(`Java ${mode} never becomes a false successful service start`, { timeout: 10000 }, async t => {
    const testbed = await fixture(t, { MOCK_JAVA: mode });
    const result = await testbed.start().result;
    assert.equal(result.code, exitCode, result.output);
    assert.match(result.output, /Java exited with status/);
    assertStopped(JSON.parse(await testbed.read('java.json')).pid);
  });
}

test('listener healthcheck is independent of startup, Java and upstream services', { timeout: 10000 }, async t => {
  const testbed = await fixture(t);
  const missing = await testbed.start(['--healthcheck']).result;
  assert.equal(missing.code, 1, missing.output);
  assert.match(missing.output, /no listener at 127.0.0.1:30000/);
  testbed.environment.MOCK_LISTENER = 'open';
  const ready = await testbed.start(['--healthcheck']).result;
  assert.equal(ready.code, 0, ready.output);
  assert.equal(await testbed.read('java.json'), '');
  assert.equal(await testbed.read('curl.json'), '');
  assert.equal(await testbed.read('trace'), 'tcp 127.0.0.1:30000\ntcp 127.0.0.1:30000\n');
});

test('invalid arguments, timeout settings and a missing JAR fail before any network probe or Java launch', { timeout: 10000 }, async t => {
  const testbed = await fixture(t);
  for (const args of [['nacos'], ['mysql:0'], ['nacos:65536'], ['-bad:8848']]) {
    assert.equal((await testbed.start(args).result).code, 1);
  }
  testbed.environment.ALLINONE_STARTUP_TIMEOUT = '0';
  assert.match((await testbed.start().result).output, /must be a positive integer/);
  testbed.environment.ALLINONE_STARTUP_TIMEOUT = '3';
  testbed.environment.ALLINONE_JAR = join(testbed.directory, 'missing.jar');
  assert.match((await testbed.start().result).output, /JAR is not readable/);
  assert.equal(await testbed.read('trace'), '');
});

test('default dependency endpoints and the supervised listener follow configured host/port values', { timeout: 10000 }, async t => {
  const testbed = await fixture(t, {
    MYSQL_HOST: 'database', MYSQL_PORT: '3307', NACOS_HOST: 'config', NACOS_PORT: '8850',
    SERVER_PORT: '30001', MOCK_JAVA: 'ready', ALLINONE_NACOS_HTTP_CHECK: 'true',
  });
  const run = testbed.start([]);
  await waitFor(() => run.output().includes('listener ready at 127.0.0.1:30001'));
  const trace = await testbed.read('trace');
  assert.match(trace, /^tcp database:3307\ntcp config:8850\ntcp emqx:8083/);
  assert.match(trace, /tcp 127.0.0.1:30001/);
  assert.equal(JSON.parse(await testbed.read('curl.json')).at(-1), 'http://config:8850/nacos/actuator/health');
  assert.ok(JSON.parse(await testbed.read('java.json')).args.includes('--server.port=30001'));
  run.child.kill('SIGTERM');
  assert.equal((await run.result).code, 143);
});
