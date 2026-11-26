import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { createServer } from 'node:net';
import { createSocket } from 'node:dgram';
import { join } from 'node:path';
import test from 'node:test';
import { PinnedDirectories, readTree } from '../native-candidate-files.mjs';
import { ownedNacosContent } from '../run-owned-backend-configuration.mjs';
import {
  backendRunCommand, nacosRunCommand, NACOS_IMAGE_ID, ownedBackendNames,
  publishOwnedNacos, retainedPeerWitness, stageOwnedModelInput, verifyRetainedPeer, verifyRetainedPeers,
  verifyZookeeperReadiness, zookeeperRunCommand, ZOOKEEPER_IMAGE_ID,
  verifyBackendFinalState, verifyBackendStartupLog,
  launchOwnedNativeBackend, ownedHostRuntimeCommand, verifyHostRuntimeExecutable, withOwnedHostRuntime,
  verifyOwnedHostListener, buildOwnedHostLoopbackShim,
} from '../launch-run-owned-native-backend.mjs';

const runId = '123456789abc';
const label = 'startup-r1';
const imageId = `sha256:${'a'.repeat(64)}`;
const retainedNames = {
  uaa: `nf-${runId}-uaa-maintained-r7`, redis: `nf-${runId}-uaa-maintained-r7-redis`,
};
const names = ownedBackendNames(runId, label, retainedNames);
const base = `/workspace/.artifacts/native-nonadmin-fixtures/${runId}/backend-runtime-${label}`;
const shared = { runId, label, networkName: `nf-${runId}-private` };

test('parentless route selection rejects nonboolean values before opening inputs or invoking Docker', async () => {
  for (const includeA01ParentlessAbsent of ['true', 1, null, {}]) {
    await assert.rejects(launchOwnedNativeBackend({
      runId, label, includeA01ParentlessAbsent,
    }), /A01 parentless route selection must be boolean/);
  }
});

function backend(role) {
  return {
    ...shared, role, name: names[role], imageId,
    configPath: `${base}/${role}-config/application.properties`,
    loggingPath: `${base}/${role}-config/logback.xml`, modelPath: `${base}/model-input`,
    mysqlName: `nf-${runId}-mysql`, nacosName: names.nacos,
  };
}

test('backend names preserve retained peers and reject foreign identities', () => {
  assert.equal(names.uaa, retainedNames.uaa);
  assert.equal(names.redis, retainedNames.redis);
  assert.equal(names.provider, `nf-${runId}-backend-${label}-provider`);
  assert.throws(() => ownedBackendNames(runId, label, { ...retainedNames, uaa: 'shared-uaa' }));
  assert.throws(() => ownedBackendNames(runId, label, { ...retainedNames, redis: 'redis' }));
  assert.throws(() => ownedBackendNames(runId, '../../escape', retainedNames));
  assert.throws(() => ownedBackendNames('invalid', label, retainedNames));
});

test('owned backend hostnames accept the 63-character boundary and reject longer generated peers', async () => {
  const boundary = ownedBackendNames(runId, 'x'.repeat(29), retainedNames);
  assert.equal(boundary.zookeeper.length, 63);
  assert.ok(Object.values(boundary).every(name => name.length <= 63));
  for (const tooLong of ['x'.repeat(30), 'converge-backend-parentless-20261122-r1']) {
    assert.throws(() => ownedBackendNames(runId, tooLong, retainedNames), /63-character DNS label/);
    await assert.rejects(launchOwnedNativeBackend({
      runId, label: tooLong, includeA01ParentlessAbsent: true,
    }), /63-character DNS label/);
  }
  assert.throws(() => ownedBackendNames(runId, label, {
    ...retainedNames, uaa: `nf-${runId}-uaa-${'x'.repeat(48)}`,
  }), /63-character DNS label/);
  assert.throws(() => ownedBackendNames(runId, label, {
    ...retainedNames, redis: `nf-${runId}-uaa-${'x'.repeat(43)}-redis`,
  }), /63-character DNS label/);
});

test('all startup commands preserve boundary names and refuse an overlong launch label', () => {
  const boundaryLabel = 'x'.repeat(29);
  const boundary = ownedBackendNames(runId, boundaryLabel, retainedNames);
  const commands = {
    nacos: options => nacosRunCommand({ ...options, imageId: NACOS_IMAGE_ID }),
    zookeeper: options => zookeeperRunCommand({ ...options, imageId: ZOOKEEPER_IMAGE_ID }),
    ...Object.fromEntries(['allinone', 'provider', 'gateway'].map(role => [role, backendRunCommand])),
  };
  for (const [role, command] of Object.entries(commands)) {
    const options = {
      ...backend(role), label: boundaryLabel, name: boundary[role], nacosName: boundary.nacos,
      configPath: `${base.replace(label, boundaryLabel)}/${role}-config/application.properties`,
      loggingPath: `${base.replace(label, boundaryLabel)}/${role}-config/logback.xml`,
      modelPath: `${base.replace(label, boundaryLabel)}/model-input`,
    };
    const args = command(options);
    assert.equal(args[args.indexOf('--name') + 1], boundary[role]);
    assert.throws(() => command({
      ...options, label: 'x'.repeat(30), name: `nf-${runId}-backend-${'x'.repeat(30)}-${role}`,
    }), /zookeeper hostname is 64 characters.*63-character DNS label.*at most 29 characters/);
  }
});

test('command construction checks the supplied service name as well as its launch label', () => {
  const name = `nf-${runId}-backend-${label}-${'x'.repeat(64)}-nacos`;
  assert.throws(() => nacosRunCommand({
    ...shared, name, imageId: NACOS_IMAGE_ID,
  }), /Owned service hostname is \d+ characters.*63-character DNS label/);
});

function hostOptions(role) {
  return {
    workspace: '/workspace', runId, label, role, port: 13306,
    executable: '/workspace/.artifacts/host-dependencies/mysql/bin/mysqld',
    mysqlBase: '/workspace/.artifacts/host-dependencies/mysql',
    libraryPath: '/workspace/.artifacts/host-dependencies/mysql/lib',
  };
}

test('owned host MySQL starts without global config and keeps every writable path in one run', () => {
  const command = ownedHostRuntimeCommand(hostOptions('mysql'));
  const directory = `/workspace/.artifacts/native-nonadmin-fixtures/${runId}/backend-host-${label}`;
  assert.equal(command.cwd, directory);
  assert.equal(command.args[0], '--no-defaults');
  for (const arg of [
    '--bind-address=127.0.0.1', '--port=13306', `--datadir=${directory}/mysql-data`,
    '--socket=./mysql.sock', `--pid-file=${directory}/mysql.pid`,
    `--log-error=${directory}/mysql.private.log`,
  ]) assert.ok(command.args.includes(arg));
  assert.deepEqual(Object.keys(command.env).sort(), ['HOME', 'LANG', 'LC_ALL', 'LD_LIBRARY_PATH', 'TMPDIR']);
  const init = ownedHostRuntimeCommand(hostOptions('mysql-initialize'));
  assert.ok(init.args.includes('--initialize-insecure'));
  assert.ok(init.args.includes('--skip-networking'));
  assert.ok(!init.args.some(arg => arg.startsWith('--port=')));
});

test('owned host Redis uses its copied musl loader with bounded loopback-only ephemeral storage', () => {
  const command = ownedHostRuntimeCommand({
    ...hostOptions('redis'), port: 16379,
    executable: '/workspace/.artifacts/host-dependencies/redis-lib/ld-musl-aarch64.so.1',
    libraryPath: '/workspace/.artifacts/host-dependencies/redis-lib',
    redisPath: '/workspace/.artifacts/host-dependencies/redis-server',
  });
  assert.deepEqual(command.args.slice(0, 7), [
    '--library-path', '/workspace/.artifacts/host-dependencies/redis-lib',
    '/workspace/.artifacts/host-dependencies/redis-server', '--bind', '127.0.0.1', '--port', '16379',
  ]);
  assert.ok(command.args.includes('64mb'));
  assert.equal(command.args[command.args.indexOf('--daemonize') + 1], 'no');
  assert.equal(command.args[command.args.indexOf('--appendonly') + 1], 'no');
  assert.equal(command.args[command.args.indexOf('--save') + 1], '');
});

test('host runtime refuses unreviewed roles, source paths, shared ports and edited process descriptors', async () => {
  for (const patch of [
    { role: 'unreviewed' }, { port: 3306 }, { port: 8848 }, { port: 30000 },
    { port: 0 }, { port: 65536 }, { port: '13306' }, { executable: '/usr/bin/mysqld' },
    { executable: '/workspace/.artifacts/../../usr/bin/mysqld' },
    { libraryPath: '/workspace/.artifacts/other-libraries' },
    { label: 'converge-backend-parentless-20261122-r1' },
  ]) assert.throws(() => ownedHostRuntimeCommand({ ...hostOptions('mysql'), ...patch }));
  const command = ownedHostRuntimeCommand(hostOptions('mysql'));
  command.args.push('--bind-address=0.0.0.0');
  await assert.rejects(withOwnedHostRuntime(command, async () => {}),
    /fresh unchanged owned host command/);
  await assert.rejects(withOwnedHostRuntime(structuredClone(
    ownedHostRuntimeCommand(hostOptions('mysql'))), async () => {}), /fresh unchanged owned host command/);
});

test('host backend command construction never authorizes execution without actual owned dependencies and config proof', async () => {
  const directory = `/workspace/.artifacts/native-nonadmin-fixtures/${runId}/backend-host-${label}`;
  for (const role of ['allinone', 'provider', 'gateway']) {
    const command = ownedHostRuntimeCommand({
      ...hostOptions(role), executable: '/workspace/.artifacts/openjdk/bin/java', port: 13202,
      jarPath: `/workspace/.artifacts/backend/${role}.jar`,
      configPath: `${directory}/${role}-config/application.properties`,
    });
    assert.ok(command.args.includes('--server.address=127.0.0.1'));
    assert.ok(command.args.includes('--server.port=13202'));
    await assert.rejects(withOwnedHostRuntime(command, async () => {}),
      /fresh owned dependency and configuration bindings/);
    assert.throws(() => ownedHostRuntimeCommand({
      ...hostOptions(role), executable: '/workspace/.artifacts/openjdk/bin/java', port: 13202,
      jarPath: `/workspace/.artifacts/backend/${role}.jar`, configPath: '/shared/application.properties',
    }), /configuration must belong to this exact run/);
  }
});

test('host runtime checks ELF operating system and machine before starting any executable', () => {
  const elf = Buffer.alloc(20);
  Buffer.from([0x7f, 0x45, 0x4c, 0x46, 2, 1]).copy(elf);
  elf.writeUInt16LE(183, 18);
  verifyHostRuntimeExecutable(elf, 'linux', 'arm64');
  assert.throws(() => verifyHostRuntimeExecutable(elf, 'darwin', 'arm64'), /requires Linux/);
  assert.throws(() => verifyHostRuntimeExecutable(elf, 'linux', 'x64'), /architecture differs/);
  assert.throws(() => verifyHostRuntimeExecutable(elf, 'linux', 'riscv64'), /Unsupported/);
  assert.throws(() => verifyHostRuntimeExecutable(Buffer.from('#!/bin/sh'), 'linux', 'arm64'));
  elf[5] = 2;
  assert.throws(() => verifyHostRuntimeExecutable(elf, 'linux', 'arm64'), /little-endian ELF/);
});

test('host listener proof requires the exact process socket and refuses wildcard binding', async () => {
  const server = createServer();
  const close = () => new Promise((resolve, reject) =>
    server.close(error => error ? reject(error) : resolve()));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const { port } = server.address();
    assert.equal(verifyOwnedHostListener(process.pid, port).processOwnsLoopbackListener, true);
    assert.throws(() => verifyOwnedHostListener(process.pid, port === 65535 ? port - 1 : port + 1),
      /own only its declared/);
  } finally { await close(); }
  await new Promise(resolve => server.listen(0, '0.0.0.0', resolve));
  try {
    assert.throws(() => verifyOwnedHostListener(process.pid, server.address().port), /IPv4 loopback/);
  } finally { await close(); }
});

test('compiled host adapter binds approved TCP and UDP to loopback and refuses shared destinations', async t => {
  const workspace = fs.mkdtempSync(join(os.tmpdir(), 'aibiz-host-loopback-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const directory = join(workspace, '.artifacts/native-nonadmin-fixtures', runId, `backend-host-${label}`);
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const binding = buildOwnedHostLoopbackShim({ workspace, runId, label });
  const tcp = createServer();
  await new Promise(resolve => tcp.listen(0, '127.0.0.1', resolve));
  const tcpPort = tcp.address().port;
  await new Promise(resolve => tcp.close(resolve));
  const udp = createSocket('udp4');
  await new Promise(resolve => udp.bind(0, '127.0.0.1', resolve));
  const udpPort = udp.address().port;
  await new Promise(resolve => udp.close(resolve));
  const script = `
    import assert from 'node:assert/strict';
    import fs from 'node:fs';
    import { createServer, createConnection } from 'node:net';
    import { createSocket } from 'node:dgram';
    const server = createServer();
    await new Promise(resolve => server.listen(${tcpPort}, '0.0.0.0', resolve));
    assert.equal(server.address().address, '127.0.0.1');
    const socket = createSocket('udp4');
    await new Promise(resolve => socket.bind(0, '0.0.0.0', resolve));
    assert.deepEqual(socket.address(), { address: '127.0.0.1', family: 'IPv4', port: ${udpPort} });
    for (const [host, port] of [['127.0.0.1', 3306], ['127.0.0.1', 6379], ['192.0.2.1', ${tcpPort}]]) {
      const code = await new Promise(resolve => {
        const peer = createConnection({ host, port });
        peer.once('connect', () => { peer.destroy(); resolve('UNEXPECTED_CONNECTION'); });
        peer.once('error', error => { peer.destroy(); resolve(error.code); });
      });
      assert.equal(code, 'EACCES');
    }
    assert.ok(fs.readFileSync('/proc/self/maps', 'utf8').includes(process.env.LD_PRELOAD));
    await new Promise(resolve => socket.close(resolve));
    await new Promise(resolve => server.close(resolve));
    console.log('owned-loopback-adapter-verified');
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script], {
    env: { LD_PRELOAD: binding.library, AIBIZ_OWNED_TCP_PORTS: `${tcpPort},${udpPort}`,
      AIBIZ_OWNED_UDP_PORT: String(udpPort), HOME: directory, TMPDIR: directory },
    encoding: 'utf8', timeout: 10000, maxBuffer: 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.signal, null);
  assert.equal(result.stdout.trim(), 'owned-loopback-adapter-verified');
});

test('Nacos is pinned and isolated with only declared ephemeral writable paths', () => {
  const args = nacosRunCommand({ ...shared, name: names.nacos, imageId: NACOS_IMAGE_ID });
  assert.equal(args.at(-1), NACOS_IMAGE_ID);
  for (const flag of ['--pull=never', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges']) {
    assert.ok(args.includes(flag));
  }
  assert.equal(args[args.indexOf('--network') + 1], shared.networkName);
  assert.equal(args[args.indexOf('--user') + 1], '65532:65532');
  assert.equal(args[args.indexOf('--workdir') + 1], '/tmp');
  assert.ok(args.includes(`aibiz.native-fixture.run=${runId}`));
  assert.ok(args.includes(`aibiz.native-backend.launch=${label}`));
  assert.ok(args.includes('SPRING_DATASOURCE_PLATFORM='));
  assert.ok(!args.some(value => value.includes('mysql') || value === '-p' || value === '--publish'));
  assert.ok(args.includes('/home/nacos/data:rw,nosuid,nodev,uid=65532,gid=65532,size=1073741824'));
  assert.ok(args.includes('/home/nacos/logs:rw,nosuid,nodev,uid=65532,gid=65532,size=268435456'));
  assert.ok(args.includes('/tmp/nacos-native:rw,nosuid,nodev,exec,uid=65532,gid=65532,mode=0700,size=67108864'));
  assert.ok(args.includes('JAVA_OPT_EXT=-Xms128m -Xmx512m -XX:ActiveProcessorCount=2 -Duser.home=/tmp -Djava.io.tmpdir=/tmp/nacos-native'));
  assert.deepEqual(args.filter(arg => arg.includes(',exec,')).length, 1);
});

test('ZooKeeper uses an immutable non-root standalone instance with only bounded temporary storage', () => {
  const args = zookeeperRunCommand({ ...shared, name: names.zookeeper, imageId: ZOOKEEPER_IMAGE_ID });
  assert.equal(args.at(-1), ZOOKEEPER_IMAGE_ID);
  for (const flag of ['--pull=never', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges']) {
    assert.ok(args.includes(flag));
  }
  assert.equal(args[args.indexOf('--network') + 1], shared.networkName);
  assert.equal(args[args.indexOf('--user') + 1], '65532:65532');
  assert.ok(args.includes('ZOO_ADMINSERVER_ENABLED=false'));
  assert.ok(args.includes('ZOO_4LW_COMMANDS_WHITELIST=srvr'));
  assert.ok(args.includes('ZOO_SERVERS=server.1=127.0.0.1:2888:3888;2181'));
  assert.equal(args.filter(arg => arg === '--tmpfs').length, 5);
  assert.ok(!args.some(arg => ['-p', '--publish', '--mount', '--volume', '--privileged'].includes(arg)));
  for (const change of [
    o => { o.imageId = NACOS_IMAGE_ID; }, o => { o.name = 'zoo1'; },
    o => { o.networkName = 'compose_agent_network'; },
  ]) {
    const o = { ...shared, name: names.zookeeper, imageId: ZOOKEEPER_IMAGE_ID };
    change(o);
    assert.throws(() => zookeeperRunCommand(o));
  }
});

test('ZooKeeper readiness requires a successful exact standalone status, not a listening socket', () => {
  verifyZookeeperReadiness({ status: 0, stdout: 'Client port found: 2181\nMode: standalone\n' });
  for (const value of [
    { status: 1, stdout: 'Mode: standalone\n' }, { status: 0, stdout: 'Mode: leader\n' },
    { status: 0, stdout: 'Error contacting service\n' }, { status: 0, signal: 'SIGTERM', stdout: 'Mode: standalone\n' },
  ]) assert.throws(() => verifyZookeeperReadiness(value));
});

test('a listening HTTP port and Started line cannot hide a delayed ApplicationRunner failure', () => {
  const initial = 'Tomcat started on port(s): 30000\nStarted EBSXAllInOneApplication in 4 seconds\n';
  assert.equal(verifyBackendStartupLog('allinone', initial).noFatalStartupFailureObserved, true);
  for (const fatal of ['Application run failed', 'APPLICATION FAILED TO START', 'Error starting ApplicationContext']) {
    assert.throws(() => verifyBackendStartupLog('allinone', `${initial}\n${fatal}\nprivate details suppressed`));
  }
  assert.throws(() => verifyBackendStartupLog('allinone', ''));
  assert.throws(() => verifyBackendStartupLog('unreviewed', initial));
});

test('startup diagnostics preserve the exact container state before ephemeral failed peers are removed', () => {
  const source = fs.readFileSync(new URL('../launch-run-owned-native-backend.mjs', import.meta.url), 'utf8');
  const capture = source.indexOf('const finalInspection = inspect(peer.id)');
  const archive = source.indexOf('`${peer.role}-inspection.private.json`', capture);
  const removal = source.indexOf("docker(['rm', '--force', peer.id]", archive);
  assert.ok(capture > 0 && archive > capture && removal > archive);
  assert.match(source.slice(capture, archive), /finalInspection\.Image, peer\.imageId/);
  assert.match(source.slice(capture, archive), /finalInspection\.Config\.Labels\?\.\[labelKey\], runId/);
  const stateCheck = source.indexOf('verifyBackendFinalState(finalInspection)', archive);
  assert.ok(stateCheck > archive && stateCheck < removal);
});

test('final startup state rejects post-verification exits and OOM before retaining the owned stack', () => {
  const container = { State: { Running: true, Status: 'running', OOMKilled: false, Dead: false } };
  verifyBackendFinalState(container);
  for (const mutate of [
    value => { value.State.Running = false; },
    value => { value.State.Status = 'exited'; },
    value => { value.State.OOMKilled = true; },
    value => { value.State.Dead = true; },
    value => { delete value.State; },
  ]) {
    const changed = structuredClone(container);
    mutate(changed);
    assert.throws(() => verifyBackendFinalState(changed));
  }
});

for (const [name, mutate] of [
  ['mutable image tag', o => { o.imageId = 'aibiz/nacos-server:latest'; }],
  ['other immutable Nacos image', o => { o.imageId = imageId; }],
  ['shared network', o => { o.networkName = 'compose_default'; }],
  ['foreign name', o => { o.name = 'nacos'; }],
]) {
  test(`Nacos command rejects ${name}`, () => {
    const options = { ...shared, name: names.nacos, imageId: NACOS_IMAGE_ID };
    mutate(options);
    assert.throws(() => nacosRunCommand(options));
  });
}

for (const role of ['allinone', 'provider', 'gateway']) {
  test(`${role} runs the exact candidate with only individual read-only run-owned inputs`, () => {
    const args = backendRunCommand(backend(role));
    assert.ok(args.includes(imageId));
    assert.ok(args.includes('--read-only'));
    assert.ok(args.includes('--cap-drop=ALL'));
    assert.ok(args.includes('--security-opt=no-new-privileges'));
    assert.equal(args[args.indexOf('--network') + 1], shared.networkName);
    assert.equal(args[args.indexOf('--workdir') + 1], '/tmp');
    const heap = role === 'gateway' ? '512m' : '1536m';
    assert.ok(args.includes(`JAVA_TOOL_OPTIONS=-Xms128m -Xmx${heap} -XX:ActiveProcessorCount=2 -Duser.home=/tmp -Dlogging.config=file:/app/config/logback.xml -Dcom.sun.xml.bind.v2.bytecode.ClassTailor.noOptimize=true --add-exports=java.naming/com.sun.jndi.ldap=ALL-UNNAMED`));
    const mounts = args.flatMap((arg, index) => arg === '--mount' ? [args[index + 1]] : []);
    assert.equal(mounts.length, role === 'provider' ? 3 : 2);
    assert.ok(mounts.every(mount => mount.startsWith(`type=bind,src=${base}/`) && mount.endsWith(',readonly')));
    assert.ok(!args.some(arg => arg === '--publish' || arg === '-p' || arg.includes('password=')));
    if (role === 'provider') {
      assert.deepEqual(args.slice(args.indexOf(imageId) + 1), [
        `nf-${runId}-mysql:3306`, `${names.nacos}:8848`, '--',
        '--spring.config.location=file:/app/config/application.properties',
      ]);
      assert.ok(args.includes('WAIT_FOR_NACOS_HEALTH=false'));
      assert.ok(args.includes(`MYSQL_HOST=nf-${runId}-mysql`));
      assert.ok(args.includes(`NACOS_HOST=${names.nacos}`));
      assert.ok(!args.includes('--entrypoint'));
    } else {
      assert.equal(args[args.indexOf('--entrypoint') + 1], 'java');
      assert.ok(args.includes(`-jar`));
      assert.ok(args.includes(`/ibiz-ebsx-${role === 'allinone' ? 'allinone-rt' : role}.jar`));
    }
  });
}

for (const [name, mutate] of [
  ['unknown role', o => { o.role = 'uaa'; }],
  ['wrong component name', o => { o.name = names.gateway; }],
  ['mutable backend tag', o => { o.imageId = 'backend:latest'; }],
  ['shared network', o => { o.networkName = 'compose_default'; }],
  ['shared model mount', o => { o.modelPath = '/app/model'; }],
  ['fixture root mount', o => { o.configPath = `/workspace/.artifacts/native-nonadmin-fixtures/${runId}`; }],
  ['foreign fixture mount', o => { o.configPath = o.configPath.replace(runId, '000000000000'); }],
  ['older run mount', o => { o.configPath = o.configPath.replace(label, 'retained-r0'); }],
  ['relative mount', o => { o.configPath = 'application.properties'; }],
  ['mount option injection', o => { o.loggingPath += ',rw'; }],
  ['unresolved traversal', o => { o.loggingPath += '/../input'; }],
  ['shared MySQL', o => { o.mysqlName = 'mysql'; }],
  ['shared Nacos', o => { o.nacosName = 'nacos'; }],
]) {
  test(`provider command rejects ${name}`, () => {
    const options = backend('provider');
    mutate(options);
    assert.throws(() => backendRunCommand(options));
  });
}

function peer(character, role) {
  return {
    Id: character.repeat(64), Name: `/nf-${runId}-${role}`, Image: imageId,
    State: { Running: true, StartedAt: '2026-10-06T08:00:00.000Z' }, RestartCount: 0,
    Config: { Labels: { 'aibiz.native-fixture.run': runId }, Env: ['private=hidden'] },
    HostConfig: { ReadonlyRootfs: true, PortBindings: {} }, Mounts: [],
    NetworkSettings: { Networks: { [shared.networkName]: { NetworkID: 'b'.repeat(64), EndpointID: character.repeat(64) } } },
  };
}
const peers = [peer('1', 'mysql'), peer('2', 'uaa'), peer('3', 'redis')];

test('the cloud UAA alias guard verifies one exact running target without relaxing the three retained peers', () => {
  const previous = peer('4', 'allinone');
  const current = structuredClone(previous);
  current.State.Pid = 123;
  verifyRetainedPeer(previous, current);
  assert.throws(() => verifyRetainedPeers([previous], [current]), /MySQL, UAA and Redis/);
  for (const mutate of [
    row => { row.Id = '5'.repeat(64); },
    row => { row.Image = `sha256:${'b'.repeat(64)}`; },
    row => { row.State.Running = false; },
    row => { row.State.StartedAt = 'changed'; },
    row => { row.RestartCount++; },
    row => { row.Config.Env.push('UNREVIEWED=true'); },
    row => { row.HostConfig.ReadonlyRootfs = false; },
    row => { row.NetworkSettings.Networks[shared.networkName].EndpointID = '6'.repeat(64); },
  ]) {
    const changed = structuredClone(previous);
    mutate(changed);
    assert.throws(() => verifyRetainedPeer(previous, changed));
  }
  assert.throws(() => verifyRetainedPeer(previous, undefined), /vanished/);
  const source = fs.readFileSync(new URL('../launch-run-owned-native-backend.mjs', import.meta.url), 'utf8');
  assert.match(source, /verifyRetainedPeer\(container, inspect\(container\.Id\)\)/);
  assert.doesNotMatch(source, /verifyRetainedPeers\(\[container\]/);
});

test('retained witness compares lifecycle/configuration without depending on transient runtime statistics', () => {
  const current = structuredClone(peers);
  current[0].State.Pid = 123;
  verifyRetainedPeers(peers, current.toReversed());
  assert.equal(retainedPeerWitness(peers[0]).startedAt, peers[0].State.StartedAt);
  assert.throws(() => verifyRetainedPeers(peers, current.slice(0, 2)));
  assert.throws(() => verifyRetainedPeers([], []));
});

test('retained mount enumeration order is immaterial but changed mount content remains rejected', () => {
  const previous = structuredClone(peers);
  previous[0].Mounts = [
    { Type: 'tmpfs', Destination: '/tmp' }, { Type: 'tmpfs', Destination: '/data' },
  ];
  const current = structuredClone(previous);
  current[0].Mounts.reverse();
  verifyRetainedPeers(previous, current);
  current[0].Mounts[0].Destination = '/other';
  assert.throws(() => verifyRetainedPeers(previous, current));
});

for (const [name, mutate] of [
  ['recreated container', p => { p.Id = '4'.repeat(64); }],
  ['restart', p => { p.RestartCount = 1; }],
  ['stop', p => { p.State.Running = false; }],
  ['changed startup', p => { p.State.StartedAt = '2026-10-06T09:00:00.000Z'; }],
  ['new image', p => { p.Image = `sha256:${'4'.repeat(64)}`; }],
  ['changed environment', p => { p.Config.Env.push('shared=true'); }],
  ['changed mounts', p => { p.Mounts.push({ Type: 'bind', Source: '/shared' }); }],
  ['changed host configuration', p => { p.HostConfig.ReadonlyRootfs = false; }],
  ['changed attachment', p => { p.NetworkSettings.Networks[shared.networkName].EndpointID = '4'.repeat(64); }],
]) {
  test(`retained-peer guard rejects ${name}`, () => {
    const current = structuredClone(peers);
    mutate(current[0]);
    assert.throws(() => verifyRetainedPeers(peers, current));
  });
}

test('Nacos publication uses structured encoding and compares exact readback without logging values', async () => {
  const content = ownedNacosContent({ 'private-key': 'a&b=x\n#still data', nested: { enabled: false } });
  const calls = [];
  const rows = [{ dataId: 'servicehub-owned', group: `nf_${runId}`, content }];
  const request = async (origin, path, options) => {
    calls.push({ origin, path, options });
    return { status: 200, bytes: Buffer.from(options?.method === 'POST' ? 'true' : content) };
  };
  const result = await publishOwnedNacos('http://172.28.0.10:8848', rows, { request });
  assert.equal(calls.length, 2);
  assert.equal(calls[0].options.body.get('content'), content);
  assert.equal(calls[0].options.body.get('group'), `nf_${runId}`);
  assert.equal(calls[0].options.body.get('type'), 'yaml');
  assert.equal(calls[0].options.headers['content-type'], 'application/x-www-form-urlencoded');
  assert.ok(calls[1].path.includes('dataId=servicehub-owned'));
  assert.deepEqual(result, [{
    dataId: rows[0].dataId, group: rows[0].group, bytes: Buffer.byteLength(content),
    sha256: createHash('sha256').update(content).digest('hex'), readbackAttempts: 1,
  }]);
  assert.ok(!JSON.stringify(result).includes('private-key'));
});

test('Nacos accepts only bounded missing-after-publish retries followed by exact content', async () => {
  const row = { dataId: 'owned', group: `nf_${runId}`, content: ownedNacosContent({ owned: true }) };
  let reads = 0;
  let waits = 0;
  const bindings = await publishOwnedNacos('http://172.28.0.10:8848', [row], {
    delay: async ms => { assert.equal(ms, 100); waits++; },
    request: async (_origin, _path, options) => {
      if (options?.method === 'POST') return { status: 200, bytes: Buffer.from('true') };
      reads++;
      return reads < 3 ? { status: 404, bytes: Buffer.from('not visible') }
        : { status: 200, bytes: Buffer.from(row.content) };
    },
  });
  assert.equal(reads, 3);
  assert.equal(waits, 2);
  assert.equal(bindings[0].readbackAttempts, 3);
  for (const status of [404, 401, 500]) {
    let reads = 0;
    await assert.rejects(publishOwnedNacos('http://172.28.0.10:8848', [row], {
      readbackAttempts: 3, delay: async () => {},
      request: async (_origin, _path, options) => options?.method === 'POST'
        ? { status: 200, bytes: Buffer.from('true') }
        : (reads++, { status, bytes: Buffer.from('not a config') }),
    }));
    assert.equal(reads, status === 404 ? 3 : 1);
  }
});

for (const [name, input, response] of [
  ['empty input', [], {}],
  ['shared group', [{ dataId: 'x', group: 'DEFAULT_GROUP', content: '{}' }], {}],
  ['unsafe dataId', [{ dataId: 'x&group=shared', group: `nf_${runId}`, content: '{}' }], {}],
  ['unstructured payload', [{ dataId: 'x', group: `nf_${runId}`, content: 'hello' }], {}],
  ['array payload', [{ dataId: 'x', group: `nf_${runId}`, content: '[]' }], {}],
  ['bare JSON payload', [{ dataId: 'x', group: `nf_${runId}`, content: '{}' }], {}],
  ['YAML array payload', [{ dataId: 'x', group: `nf_${runId}`, content: '---\n[]' }], {}],
  ['failed publish status', [{ dataId: 'x', group: `nf_${runId}`, content: ownedNacosContent({}) }], { status: 500, bytes: Buffer.from('true') }],
  ['failed publish result', [{ dataId: 'x', group: `nf_${runId}`, content: ownedNacosContent({}) }], { status: 200, bytes: Buffer.from('false') }],
]) {
  test(`Nacos publication rejects ${name}`, async () => {
    await assert.rejects(publishOwnedNacos('http://172.28.0.10:8848', input, { request: async () => response }));
  });
}

test('Nacos publication rejects substituted readback and duplicate input rows', async () => {
  const row = { dataId: 'x', group: `nf_${runId}`, content: ownedNacosContent({ owned: true }) };
  await assert.rejects(publishOwnedNacos('http://172.28.0.10:8848', [row], {
    request: async (origin, path, options) => ({
      status: 200, bytes: Buffer.from(options?.method === 'POST' ? 'true' : '{}'),
    }),
  }));
  let called = false;
  const request = async () => { called = true; throw new Error('Preflight must prevent publication'); };
  await assert.rejects(publishOwnedNacos('http://172.28.0.10:8848', [row, row], { request }));
  assert.equal(called, false);
  await assert.rejects(publishOwnedNacos('http://172.28.0.10:8848', [
    row, { ...row, dataId: 'other', group: 'nf_000000000000' },
  ], { request }));
  assert.equal(called, false);
});

function modelFixture(t) {
  const root = fs.mkdtempSync(join(os.tmpdir(), 'aibiz-owned-model-stage-'));
  const directories = new PinnedDirectories();
  t.after(() => { directories.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const source = join(root, 'source');
  fs.mkdirSync(join(source, 'actions'), { recursive: true });
  fs.writeFileSync(join(source, 'model.json'), '{"id":"owned-model"}\n');
  fs.writeFileSync(join(source, 'actions/Get.json.after.bpmn'), '<definitions />\n');
  return { root, source, directories, outputPath: join(root, 'staged') };
}

test('model staging retains JSON and BPMN with exact file hashes and container-readable scoped modes', t => {
  const fixture = modelFixture(t);
  const result = stageOwnedModelInput(fixture);
  const source = readTree(fixture.source, { jsonOnly: false });
  const staged = readTree(fixture.outputPath, { jsonOnly: false });
  assert.equal(result.files, 2);
  assert.equal(result.fingerprint, source.fingerprint);
  assert.deepEqual(staged.entries, source.entries);
  assert.equal(fs.statSync(fixture.outputPath).mode & 0o777, 0o755);
  assert.equal(fs.statSync(join(fixture.outputPath, 'actions')).mode & 0o777, 0o755);
  assert.equal(fs.statSync(join(fixture.outputPath, 'model.json')).mode & 0o777, 0o644);
});

test('model staging rejects symlink resources and refuses to overwrite retained snapshots', t => {
  const fixture = modelFixture(t);
  stageOwnedModelInput(fixture);
  assert.throws(() => stageOwnedModelInput(fixture));
  fs.symlinkSync(join(fixture.source, 'model.json'), join(fixture.source, 'linked.json'));
  assert.throws(() => stageOwnedModelInput({ ...fixture, outputPath: join(fixture.root, 'another') }));
  assert.equal(fs.existsSync(join(fixture.root, 'another')), false);
});

test('R05 backend selection defaults off and binds deployment plus prelaunch and final stage verification', () => {
  const source = fs.readFileSync(new URL('../launch-run-owned-native-backend.mjs', import.meta.url), 'utf8');
  assert.match(source, /'r05-owned-model': \{ type: 'string' \}/);
  assert.match(source, /r05OwnedModelCandidate: values\['r05-owned-model'\]/);
  assert.match(source, /r05OwnedModelCandidate === undefined \? undefined : readR05OwnedModelOverlay/);
  const launch = source.indexOf('const launch = (role, imageId, command) =>');
  const verification = source.indexOf('verifyStagedR05OwnedModelBinding(r05OwnedModelBinding)', launch);
  const execution = source.indexOf('const id = docker(command)', launch);
  assert.ok(launch > 0 && verification > launch && execution > verification);
  assert.match(source, /r05OwnedModelBinding: verifyStagedR05OwnedModelBinding\(r05OwnedModelBinding\)/);
  assert.match(source, /report\.modelInput\.r05OwnedModelBinding = r05OwnedModelBinding/);
  assert.match(source, /verifyR05OwnedModelProviderMount\(r05OwnedModelBinding, provider\)/);
  assert.match(source, /report\.r05OwnedModelInputReverified = true/);
  assert.match(source, /R05 owned model input changed after staging/);
});
