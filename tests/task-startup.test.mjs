import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { chmod, mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import test from 'node:test';

const entrypoint = fileURLToPath(new URL('../task-entrypoint.sh', import.meta.url));
const bash = '/bin/bash';

// No Docker calls. Only the isolated legacy fixture writes application data.
// Real process groups, signals and sleep exercise supervision and cleanup.
const mockCommand = `#!${process.execPath}
const fs = require('node:fs');
const path = require('node:path');
const command = path.basename(process.argv[1]);
const args = process.argv.slice(2);
const file = name => path.join(process.env.MOCK_DIRECTORY, name);
const trace = line => fs.appendFileSync(file('trace'), line + '\\n');
if (command === 'timeout') {
  trace('dependency ' + args.slice(-2).join(':'));
  fs.writeFileSync(file('timeout.json'), JSON.stringify(args));
  process.exit(process.env.MOCK_DEPENDENCY === 'down' ? 124 : 0);
} else if (command === 'curl') {
  trace('http');
  fs.writeFileSync(file('curl.json'), JSON.stringify(args));
  const sequence = (process.env.MOCK_HTTP || '200').split(',');
  const count = fs.existsSync(file('http-count')) ? Number(fs.readFileSync(file('http-count'))) : 0;
  fs.writeFileSync(file('http-count'), String(count + 1));
  const code = sequence[Math.min(count, sequence.length - 1)];
  process.stdout.write(code + ' ' + (process.env.MOCK_BODY_BYTES || '382'));
  process.exit(Number(process.env.MOCK_CURL_EXIT || (code === '000' ? 7 : 0)));
} else if (command === 'initialize') {
  trace('initialize');
  fs.writeFileSync(file('initialize.json'), JSON.stringify({
    args, javaOpts: process.env.JAVA_OPTS, batch: process.env.IMPORT_BATCH_SIZE,
    database: process.env.COREDBNAME, pidFile: process.env.CATALINA_PID,
  }));
} else if (command === 'java' || command === 'tail') {
  trace(command);
  fs.writeFileSync(file(command + '.json'), JSON.stringify({ pid: process.pid }));
  process.on('SIGTERM', () => {
    trace(command + '-term');
    if (process.env.MOCK_IGNORE_TERM !== 'true') process.exit(143);
  });
  setInterval(() => {
    if (command === 'java' && fs.existsSync(file('crash-java'))) process.exit(7);
    if (command === 'tail' && fs.existsSync(file('exit-legacy'))) process.exit(0);
  }, 20);
} else {
  throw new Error('Unexpected mock command');
}
`;

const legacyScript = `#!/bin/bash
initialize "$@"
case "\${MOCK_LEGACY:-}" in
  exit) exit 9 ;;
  hang) exec tail ;;
esac
java &
java_pid=$!
case "\${MOCK_PID:-}" in
  missing) ;;
  invalid) printf '%s\\n' invalid > "$CATALINA_PID" ;;
  foreign) printf '%s\\n' "$MOCK_FOREIGN_PID" > "$CATALINA_PID" ;;
  *) printf '%s\\n' "$java_pid" > "$CATALINA_PID" ;;
esac
tail
`;

const darwinPs = `#!/usr/bin/perl
use strict;
use warnings;
use JSON::PP qw(decode_json);
die "Legacy procps requires separate -o options for empty headers\\n" if grep { /=,/ } @ARGV;
my @pids;
if ($ARGV[-2] eq '-p') {
  @pids = ($ARGV[-1]);
} else {
  for my $name ('java', 'tail') {
    my $file = "$ENV{MOCK_DIRECTORY}/$name.json";
    if (open my $fh, '<', $file) {
      local $/;
      push @pids, decode_json(<$fh>)->{pid};
    }
  }
}
my $found = 0;
for my $pid (@pids) {
  next unless kill 0, $pid;
  my $group = getpgrp($pid);
  next if $group < 0;
  print "$group S\\n";
  $found = 1;
}
exit($found ? 0 : 1);
`;

async function fixture(t, overrides = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'task-startup-'));
  const bin = join(directory, 'bin');
  await mkdir(bin);
  const volume = join(directory, 'task_data');
  await mkdir(volume);
  await writeFile(join(volume, 'sentinel'), 'existing task data');
  await writeFile(join(volume, 'inherited.pid'), 'untouched PID file');
  await writeFile(join(directory, 'trace'), '');
  const legacy = join(directory, 'legacy-entrypoint.sh');
  await writeFile(legacy, legacyScript);
  for (const command of ['timeout', 'curl', 'initialize', 'java', 'tail']) {
    await writeFile(join(bin, command), mockCommand);
    await chmod(join(bin, command), 0o755);
  }
  // Portable adapters inspect only the fixture's own PIDs on macOS.
  // Linux uses the actual utilities, including their zombie-state reporting.
  if (process.platform === 'darwin') {
    await writeFile(join(bin, 'setsid'),
      '#!/usr/bin/perl\nuse POSIX qw(setsid);\nsetsid() >= 0 or die "setsid failed";\nexec @ARGV or die "exec failed";\n');
    await chmod(join(bin, 'setsid'), 0o755);
    await writeFile(join(bin, 'ps'), darwinPs);
    await chmod(join(bin, 'ps'), 0o755);
  }
  const env = {
    PATH: `${bin}:${dirname(process.execPath)}:/usr/bin:/bin`,
    HOME: directory, LC_ALL: 'C', LANG: 'C', MOCK_DIRECTORY: directory,
    TASK_LEGACY_ENTRYPOINT: legacy,
    TASK_DEPENDENCY_TIMEOUT: '2', TASK_STARTUP_TIMEOUT: '3',
    TASK_PROBE_INTERVAL: '1', TASK_SHUTDOWN_TIMEOUT: '1',
    TASK_FAILURE_THRESHOLD: '2', TASK_HTTP_TIMEOUT: '1',
    JAVA_OPTS: '-Xms128m -Xmx512m -Xss512K',
    IMPORT_BATCH_SIZE: '500', COREDBNAME: 'ibizapi',
    CATALINA_PID: join(volume, 'inherited.pid'),
    ...overrides,
  };
  const runs = [];
  const read = name => readFile(join(directory, name), 'utf8').catch(error => {
    if (error.code === 'ENOENT') return '';
    throw error;
  });
  t.after(async () => {
    for (const run of runs) {
      if (run.child.exitCode === null && run.child.signalCode === null) {
        run.child.kill('SIGKILL');
        await once(run.child, 'exit');
      }
    }
    for (const name of ['java', 'tail']) {
      const record = await read(`${name}.json`);
      if (record) {
        try { process.kill(JSON.parse(record).pid, 'SIGKILL'); } catch {}
      }
    }
    const initialized = await read('initialize.json');
    if (initialized) {
      const runtime = dirname(JSON.parse(initialized).pidFile);
      if (/^\/tmp\/task-start\.[A-Za-z0-9]+$/.test(runtime)) {
        await rm(runtime, { recursive: true, force: true });
      }
    }
    await rm(directory, { recursive: true, force: true });
  });
  return {
    directory, env, read,
    write: (name, text) => writeFile(join(directory, name), text),
    start(args = []) {
      const child = spawn(bash, [entrypoint, ...args], {
        env, cwd: directory, stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '';
      child.stdout.on('data', chunk => { output += chunk; });
      child.stderr.on('data', chunk => { output += chunk; });
      const result = new Promise((resolve, reject) => {
        child.once('error', reject);
        child.once('close', (code, signal) => resolve({ code, signal, output }));
      });
      const run = { child, result, output: () => output };
      runs.push(run);
      return run;
    },
  };
}

async function waitFor(predicate) {
  const deadline = Date.now() + 7000;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await delay(20);
  }
  assert.fail('Fixture did not reach the expected state');
}

function stopped(pid) {
  try {
    process.kill(pid, 0);
    if (process.platform === 'linux') {
      return /^State:\s+[ZX]/m.test(readFileSync(`/proc/${pid}/status`, 'utf8'));
    }
    return false;
  } catch (error) {
    if (['ESRCH', 'ENOENT'].includes(error.code)) return true;
    throw error;
  }
}

async function waitForReady(run) {
  await waitFor(() => {
    if (run.child.exitCode !== null || run.child.signalCode !== null) {
      assert.fail(`Wrapper exited before readiness:\n${run.output()}`);
    }
    return run.output().includes('SAPAAS ready');
  });
}

async function assertChildrenStopped(testbed) {
  for (const name of ['java', 'tail']) {
    const record = await testbed.read(`${name}.json`);
    if (record) await waitFor(() => stopped(JSON.parse(record).pid));
  }
}

test('wrapper passes Bash syntax validation', () => {
  const result = spawnSync(bash, ['-n', entrypoint], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
});

test('process queries support the pinned image procps empty-header syntax', () => {
  const script = readFileSync(entrypoint, 'utf8');
  assert.match(script, /ps -o pgid= -o stat= -p/);
  assert.match(script, /ps -e -o pgid= -o stat=/);
  assert.doesNotMatch(script, /ps[^\n]*=,/);
});

test('bounded dependencies precede unchanged legacy initialization; TERM stops Java and tail', { timeout: 12000 }, async t => {
  const testbed = await fixture(t);
  const original = await testbed.read('legacy-entrypoint.sh');
  const run = testbed.start(['mysql:3306', 'another-db:3307']);
  await waitForReady(run);
  const initialized = JSON.parse(await testbed.read('initialize.json'));
  assert.deepEqual(initialized.args, []);
  assert.equal(initialized.javaOpts, testbed.env.JAVA_OPTS);
  assert.equal(initialized.batch, '500');
  assert.equal(initialized.database, 'ibizapi');
  assert.match(initialized.pidFile, /^\/tmp\/task-start\.[A-Za-z0-9]+\/catalina.pid$/);
  const trace = (await testbed.read('trace')).trim().split('\n');
  assert.deepEqual(trace.slice(0, 3), ['dependency mysql:3306', 'dependency another-db:3307', 'initialize']);
  const timeout = JSON.parse(await testbed.read('timeout.json'));
  assert.deepEqual(timeout.slice(0, 2), ['-k', '1']);
  assert.ok(Number(timeout[2]) > 0 && Number(timeout[2]) <= 2);
  assert.equal(await testbed.read('task_data/sentinel'), 'existing task data');
  assert.equal(await testbed.read('task_data/inherited.pid'), 'untouched PID file');
  assert.equal(await testbed.read('legacy-entrypoint.sh'), original);
  run.child.kill('SIGTERM');
  const result = await run.result;
  assert.equal(result.code, 143, result.output);
  assert.match(await testbed.read('trace'), /java-term/);
  assert.match(await testbed.read('trace'), /tail-term/);
  await assertChildrenStopped(testbed);
  await assert.rejects(readFile(initialized.pidFile), { code: 'ENOENT' });
});

test('database environment supplies the default bounded dependency', { timeout: 12000 }, async t => {
  const testbed = await fixture(t, { DBSERVERIP: 'database', DBSERVERPORT: '3307' });
  const run = testbed.start();
  await waitForReady(run);
  assert.match(await testbed.read('trace'), /^dependency database:3307\n/);
  run.child.kill('SIGTERM');
  assert.equal((await run.result).code, 143);
});

test('an unavailable dependency times out without legacy initialization', { timeout: 10000 }, async t => {
  const testbed = await fixture(t, { MOCK_DEPENDENCY: 'down', TASK_PROBE_INTERVAL: '30' });
  const started = Date.now();
  const result = await testbed.start().result;
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /dependency timed out/);
  assert.equal(await testbed.read('initialize.json'), '');
  assert.ok(Date.now() - started < 6000, 'long probe interval must be capped by deadline');
});

for (const mode of ['hang', 'missing', 'invalid', 'foreign']) {
  test(`legacy ${mode} cannot be mistaken for a running Tomcat`, { timeout: 12000 }, async t => {
    const testbed = await fixture(t, {
      MOCK_LEGACY: mode === 'hang' ? 'hang' : '',
      MOCK_PID: mode, MOCK_FOREIGN_PID: String(process.pid),
    });
    const result = await testbed.start().result;
    assert.equal(result.code, 1, result.output);
    assert.doesNotMatch(result.output, /SAPAAS ready/);
    assert.match(result.output, mode === 'invalid' ? /invalid Tomcat PID/ :
      mode === 'foreign' ? /no longer running in the supervised group/ : /startup timed out/);
    await assertChildrenStopped(testbed);
    assert.equal(process.kill(process.pid, 0), true);
  });
}

test('legacy failure preserves its exit status', { timeout: 10000 }, async t => {
  const testbed = await fixture(t, { MOCK_LEGACY: 'exit' });
  const result = await testbed.start().result;
  assert.equal(result.code, 9, result.output);
  assert.match(result.output, /legacy entrypoint exited with status 9/);
});

test('a dead Java cannot be hidden by a live tail and a successful HTTP response', { timeout: 12000 }, async t => {
  const testbed = await fixture(t);
  const run = testbed.start();
  await waitForReady(run);
  const java = JSON.parse(await testbed.read('java.json'));
  const tail = JSON.parse(await testbed.read('tail.json'));
  run.child.kill('SIGSTOP');
  try {
    await testbed.write('crash-java', '');
    await waitFor(() => stopped(java.pid));
    assert.equal(stopped(tail.pid), false);
  } finally {
    run.child.kill('SIGCONT');
  }
  const result = await run.result;
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /Tomcat PID.*stopping legacy tail/);
  await assertChildrenStopped(testbed);
});

test('an early Java death fails before the startup deadline, without a ready HTTP response', { timeout: 12000 }, async t => {
  const testbed = await fixture(t, { MOCK_HTTP: '000', TASK_STARTUP_TIMEOUT: '30' });
  const run = testbed.start();
  await waitFor(async () => Boolean(await testbed.read('java.json')));
  await testbed.write('crash-java', '');
  const result = await run.result;
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /Tomcat PID.*stopping legacy tail/);
  assert.doesNotMatch(result.output, /SAPAAS ready|startup timed out/);
  await assertChildrenStopped(testbed);
});

test('live Java with failing SAPAAS HTTP exhausts the startup deadline', { timeout: 12000 }, async t => {
  const testbed = await fixture(t, { MOCK_HTTP: '404' });
  const result = await testbed.start().result;
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /startup timed out/);
  await assertChildrenStopped(testbed);
});

test('consecutive HTTP failures after readiness stop Java and tail', { timeout: 12000 }, async t => {
  const testbed = await fixture(t, { MOCK_HTTP: '200,503,503' });
  const result = await testbed.start().result;
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /SAPAAS ready/);
  assert.match(result.output, /HTTP lost for 2 consecutive probes/);
  await assertChildrenStopped(testbed);
});

test('a successful HTTP probe resets the consecutive-failure counter', { timeout: 12000 }, async t => {
  const testbed = await fixture(t, { MOCK_HTTP: '200,503,200,503,503' });
  const result = await testbed.start().result;
  assert.equal(result.code, 1, result.output);
  assert.equal(await testbed.read('http-count'), '5');
  assert.match(result.output, /HTTP lost for 2 consecutive probes/);
  await assertChildrenStopped(testbed);
});

test('tail exiting successfully is still a failure and stops the remaining Java', { timeout: 12000 }, async t => {
  const testbed = await fixture(t);
  const run = testbed.start();
  await waitForReady(run);
  await testbed.write('exit-legacy', '');
  const result = await run.result;
  assert.equal(result.code, 1, result.output);
  assert.match(result.output, /legacy entrypoint exited with status 0/);
  await assertChildrenStopped(testbed);
});

test('SIGINT exits 130 and TERM-resistant descendants receive bounded SIGKILL', { timeout: 12000 }, async t => {
  const testbed = await fixture(t, { MOCK_IGNORE_TERM: 'true' });
  const run = testbed.start();
  await waitForReady(run);
  run.child.kill('SIGINT');
  const result = await run.result;
  assert.equal(result.code, 130, result.output);
  assert.match(result.output, /shutdown timed out after 1s; sending SIGKILL/);
  await assertChildrenStopped(testbed);
});

test('SIGTERM during initialization stops its process group without waiting for startup timeout', { timeout: 12000 }, async t => {
  const testbed = await fixture(t, { MOCK_LEGACY: 'hang', TASK_STARTUP_TIMEOUT: '30' });
  const run = testbed.start();
  await waitFor(async () => Boolean(await testbed.read('tail.json')));
  run.child.kill('SIGTERM');
  const result = await run.result;
  assert.equal(result.code, 143, result.output);
  assert.doesNotMatch(result.output, /startup timed out/);
  await assertChildrenStopped(testbed);
});

for (const code of ['200', '302', '401', '403', '404', '503', '000']) {
  test(`healthcheck handles HTTP ${code} without initialization or dependency waits`, { timeout: 5000 }, async t => {
    const testbed = await fixture(t, { MOCK_HTTP: code, TASK_LEGACY_ENTRYPOINT: '/does-not-exist' });
    const result = await testbed.start(['--healthcheck']).result;
    assert.equal(result.code, ['200', '302', '401', '403'].includes(code) ? 0 : 1, result.output);
    assert.equal(await testbed.read('initialize.json'), '');
    assert.equal((await testbed.read('trace')).trim(), 'http');
    const args = JSON.parse(await testbed.read('curl.json'));
    assert.ok(args.includes('--noproxy'));
    assert.equal(args[args.indexOf('--max-time') + 1], '1');
    assert.equal(args.at(-1), 'http://127.0.0.1:8080/SAPAAS/');
    assert.ok(!args.includes('--location'));
  });
}

for (const override of [{ MOCK_BODY_BYTES: '0' }, { MOCK_CURL_EXIT: '28' }]) {
  test(`empty or truncated HTTP 200 cannot pass healthcheck: ${JSON.stringify(override)}`, async t => {
    const testbed = await fixture(t, override);
    const result = await testbed.start(['--healthcheck']).result;
    assert.equal(result.code, 1, result.output);
    assert.equal(await testbed.read('initialize.json'), '');
  });
}

for (const [name, value] of [
  ['TASK_STARTUP_TIMEOUT', '0'], ['TASK_DEPENDENCY_TIMEOUT', '-1'],
  ['TASK_SHUTDOWN_TIMEOUT', 'bad'], ['TASK_PROBE_INTERVAL', '08'],
  ['TASK_FAILURE_THRESHOLD', '0'], ['TASK_HTTP_TIMEOUT', '999999999999999999'],
  ['TASK_PORT', '65536'],
]) {
  test(`invalid ${name} fails before initialization`, { timeout: 5000 }, async t => {
    const testbed = await fixture(t, { [name]: value });
    const result = await testbed.start().result;
    assert.equal(result.code, 1, result.output);
    assert.match(result.output, new RegExp(name));
    assert.equal(await testbed.read('trace'), '');
  });
}

for (const args of [['mysql'], ['mysql:0'], ['--bad:3306'], ['mysql:3306', 'bad;host:3306'], ['--healthcheck', 'mysql:3306']]) {
  test(`rejects malformed arguments ${JSON.stringify(args)} before any side effects`, { timeout: 5000 }, async t => {
    const testbed = await fixture(t);
    const result = await testbed.start(args).result;
    assert.equal(result.code, 1, result.output);
    assert.equal(await testbed.read('trace'), '');
  });
}
