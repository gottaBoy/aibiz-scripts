#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import { createServer } from 'node:net';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { PinnedDirectories, readPinnedFile, readTree } from './native-candidate-files.mjs';
import { verifyBackendSourceImages } from './harness-backend-source-images.mjs';
import {
  javaProperties, parseJavaProperties, privateContainerOrigin, UAA_CONSOLE_LOGGING,
  verifyOwnedNetwork, verifyProbeContainer,
} from './harness-run-owned-uaa-runtime.mjs';
import { readApplicationAccountInput, validateFixtureReceipt } from './provision-run-owned-native-application-accounts.mjs';
import { validateDeployment } from './run-owned-native-permission-http.mjs';
import { readOwnedWorkflowConfiguration } from './bootstrap-owned-workflow-schema.mjs';
import { readOwnedEbsxConfiguration } from './bootstrap-owned-ebsx-schema.mjs';
import { readOwnedPlatformConfiguration } from './bootstrap-owned-platform-schema.mjs';
import { parseOwnedNacosContent } from './run-owned-backend-configuration.mjs';
import {
  probeOwnedModelingApplicationRoutes, readCentralMemberModelOverlay, verifyStagedCentralMemberModel,
} from './owned-modeling-application-routes.mjs';
import { verifySelectedMysqlStorage } from './mysql-fixture-profiles.mjs';
import { inspectMysqlFixtureVolumes } from './owned-mysql-volume.mjs';
import {
  bindOwnedCloudUaaSource, ownedCloudUaaAlias, ownedUaaAlias, publishOwnedUaaAlias,
} from './owned-nacos-service-alias.mjs';
import {
  NACOS_IMAGE_ID, ZOOKEEPER_IMAGE_ID, OWNED_NACOS_TMPFS, OWNED_ZOOKEEPER_TMPFS,
  OWNED_SERVICE_TMPFS, verifyOwnedZookeeper,
} from './owned-backend-resources.mjs';
import {
  readNativeModelContextOverlay, verifyNativeModelContextOverlay,
} from './native-model-context-overlay.mjs';
import {
  bindStagedR05OwnedModel, readR05OwnedModelOverlay, verifyR05OwnedModelProviderMount,
  verifyStagedR05OwnedModelBinding,
} from './r05-owned-model-overlay.mjs';
import {
  bindOwnedA01ParentlessRoutes, verifyOwnedA01ParentlessRouteBinding,
} from './owned-a01-parentless-routes.mjs';

export { NACOS_IMAGE_ID, ZOOKEEPER_IMAGE_ID } from './owned-backend-resources.mjs';
const defaultWorkspace = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const labelKey = 'aibiz.native-fixture.run';
const launchLabelKey = 'aibiz.native-backend.launch';
const idPattern = /^[a-f0-9]{64}$/;
const imagePattern = /^sha256:[a-f0-9]{64}$/;
export const BACKEND_PORTS = Object.freeze({ allinone: 30000, provider: 32002, gateway: 30086 });
const modelRelativePath =
  'vendor-upstream/ibizmodeling-standard/modelapi-core/src/main/resources/model/net/ibizsys/modeling';
const jars = Object.freeze({
  allinone: '/ibiz-ebsx-allinone-rt.jar', gateway: '/ibiz-ebsx-gateway.jar',
});
const backendRoles = ['nacos', 'zookeeper', 'allinone', 'provider', 'gateway'];
const hostCommands = new WeakMap();
const hostNetworkBindings = new WeakMap();
const hostRuntimeHandles = new WeakMap();
const hostCommandDependencies = new WeakMap();
const hostLoopbackSource = String.raw`#define _GNU_SOURCE
#include <arpa/inet.h>
#include <dlfcn.h>
#include <errno.h>
#include <netinet/in.h>
#include <stdlib.h>
#include <string.h>
#include <sys/socket.h>

static int allowed_port(unsigned int port) {
    const char *cursor = getenv("AIBIZ_OWNED_TCP_PORTS");
    if (!cursor) return 0;
    while (*cursor) {
        char *end;
        unsigned long value = strtoul(cursor, &end, 10);
        if (end == cursor) return 0;
        if (value == port) return 1;
        if (!*end) return 0;
        if (*end != ',') return 0;
        cursor = end + 1;
    }
    return 0;
}

static int restrict_address(struct sockaddr *address, socklen_t size, int listener) {
    if (address->sa_family == AF_INET) {
        if (size < sizeof(struct sockaddr_in)) return 0;
        struct sockaddr_in *value = (struct sockaddr_in *) address;
        if (!allowed_port(ntohs(value->sin_port))) return 0;
        if (listener && value->sin_addr.s_addr == htonl(INADDR_ANY))
            value->sin_addr.s_addr = htonl(INADDR_LOOPBACK);
        return value->sin_addr.s_addr == htonl(INADDR_LOOPBACK);
    }
    if (address->sa_family == AF_INET6) {
        if (size < sizeof(struct sockaddr_in6)) return 0;
        struct sockaddr_in6 *value = (struct sockaddr_in6 *) address;
        if (!allowed_port(ntohs(value->sin6_port))) return 0;
        if (listener && IN6_IS_ADDR_UNSPECIFIED(&value->sin6_addr))
            value->sin6_addr = in6addr_loopback;
        if (IN6_IS_ADDR_LOOPBACK(&value->sin6_addr)) return 1;
        return IN6_IS_ADDR_V4MAPPED(&value->sin6_addr)
            && memcmp(&value->sin6_addr.s6_addr[12], "\x7f\x00\x00\x01", 4) == 0;
    }
    return address->sa_family == AF_UNIX;
}

int bind(int fd, const struct sockaddr *address, socklen_t size) {
    static int (*original)(int, const struct sockaddr *, socklen_t);
    if (!original) original = dlsym(RTLD_NEXT, "bind");
    if (!address || size > sizeof(struct sockaddr_storage)) { errno = EACCES; return -1; }
    struct sockaddr_storage owned;
    memset(&owned, 0, sizeof(owned));
    memcpy(&owned, address, size);
    int kind = 0;
    socklen_t kind_size = sizeof(kind);
    if (getsockopt(fd, SOL_SOCKET, SO_TYPE, &kind, &kind_size) != 0) return -1;
    if (kind == SOCK_DGRAM) {
        const char *configured = getenv("AIBIZ_OWNED_UDP_PORT");
        unsigned long port = configured ? strtoul(configured, NULL, 10) : 0;
        if (!port || port > 65535 || !allowed_port(port)) { errno = EACCES; return -1; }
        if (owned.ss_family == AF_INET && !((struct sockaddr_in *) &owned)->sin_port)
            ((struct sockaddr_in *) &owned)->sin_port = htons(port);
        if (owned.ss_family == AF_INET6 && !((struct sockaddr_in6 *) &owned)->sin6_port)
            ((struct sockaddr_in6 *) &owned)->sin6_port = htons(port);
    }
    if (!restrict_address((struct sockaddr *) &owned, size, 1)) { errno = EACCES; return -1; }
    return original(fd, (struct sockaddr *) &owned, size);
}

int connect(int fd, const struct sockaddr *address, socklen_t size) {
    static int (*original)(int, const struct sockaddr *, socklen_t);
    if (!original) original = dlsym(RTLD_NEXT, "connect");
    if (!address || size > sizeof(struct sockaddr_storage)) { errno = EACCES; return -1; }
    struct sockaddr_storage owned;
    memset(&owned, 0, sizeof(owned));
    memcpy(&owned, address, size);
    if (!restrict_address((struct sockaddr *) &owned, size, 0)) { errno = EACCES; return -1; }
    return original(fd, address, size);
}
`;

function validateRun(runId, label) {
  assert.match(runId, /^[a-f0-9]{12}$/);
  assert.match(label, /^[a-z0-9][a-z0-9-]{0,48}$/);
  for (const role of backendRoles) {
    const length = `nf-${runId}-backend-${label}-${role}`.length;
    assert.ok(length <= 63,
      `Generated owned backend ${role} hostname is ${length} characters and exceeds the 63-character DNS label limit; use a launch label of at most 29 characters`);
  }
}

export function ownedBackendNames(runId, label, retainedNames) {
  validateRun(runId, label);
  const prefix = `nf-${runId}-backend-${label}`;
  for (const role of ['uaa', 'redis']) {
    assert.match(retainedNames[role], new RegExp(`^nf-${runId}-uaa-[a-z0-9-]+${role === 'redis' ? '-redis' : ''}$`));
    assert.ok(retainedNames[role].length <= 63,
      `Retained owned ${role} hostname is ${retainedNames[role].length} characters and exceeds the 63-character DNS label limit`);
  }
  return {
    ...Object.fromEntries(backendRoles.map(role => [role, `${prefix}-${role}`])),
    uaa: retainedNames.uaa, redis: retainedNames.redis,
  };
}

function commonRun({ runId, label, networkName, name, imageId }) {
  validateRun(runId, label);
  assert.equal(networkName, `nf-${runId}-private`);
  assert.ok(name.startsWith(`nf-${runId}-backend-${label}-`));
  assert.match(name, /^[a-z0-9-]+$/);
  assert.ok(name.length <= 63,
    `Owned service hostname is ${name.length} characters and exceeds the 63-character DNS label limit`);
  assert.match(imageId, imagePattern);
  // Nacos's bounded tmpfs data also counts against the container memory limit.
  const memory = { allinone: '3g', provider: '3g', gateway: '1g', nacos: '2g', zookeeper: '384m' };
  const role = name.split('-').at(-1);
  assert.ok(Object.hasOwn(memory, role), 'Unknown owned backend role');
  return ['run', '--detach', '--pull=never', '--name', name, '--network', networkName,
    '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges',
    '--cpus=2', `--memory=${memory[role]}`, '--pids-limit=512',
    '--user', '65532:65532', '--label', `${labelKey}=${runId}`,
    '--label', `${launchLabelKey}=${label}`, '--tmpfs',
    OWNED_SERVICE_TMPFS];
}

function runInput(path, runId, label) {
  assert.ok(typeof path === 'string' && !/[,\r\n\0]/.test(path), 'Unsafe bind input');
  assert.equal(path, resolve(path), 'Bind input must be absolute');
  assert.ok(path.includes(`/.artifacts/native-nonadmin-fixtures/${runId}/backend-runtime-${label}/`),
    'Bind input must belong to this backend run');
  assert.ok(!path.split('/').some(part => part === '..' || part === '.'));
  return path;
}

export function nacosRunCommand(options) {
  assert.equal(options.imageId, NACOS_IMAGE_ID);
  return [...commonRun(options), '--workdir', '/tmp',
    ...OWNED_NACOS_TMPFS.slice(1).flatMap(value => ['--tmpfs', value]),
    '--env', 'MODE=standalone', '--env', 'SPRING_DATASOURCE_PLATFORM=',
    '--env', 'JAVA_OPT_EXT=-Xms128m -Xmx512m -XX:ActiveProcessorCount=2 -Duser.home=/tmp -Djava.io.tmpdir=/tmp/nacos-native',
    options.imageId];
}

export function zookeeperRunCommand(options) {
  assert.equal(options.imageId, ZOOKEEPER_IMAGE_ID);
  assert.equal(options.name, `nf-${options.runId}-backend-${options.label}-zookeeper`);
  return [...commonRun(options), '--workdir', '/tmp',
    ...OWNED_ZOOKEEPER_TMPFS.slice(1).flatMap(value => ['--tmpfs', value]),
    ...['ZOO_ADMINSERVER_ENABLED=false', 'ZOO_STANDALONE_ENABLED=true',
      'ZOO_4LW_COMMANDS_WHITELIST=srvr', 'ZOO_SERVERS=server.1=127.0.0.1:2888:3888;2181',
      'JVMFLAGS=-Xms32m -Xmx128m -Djava.io.tmpdir=/tmp',
    ].flatMap(value => ['--env', value]), options.imageId];
}

export function verifyZookeeperReadiness(result) {
  assert.ok(result.status === 0 && !result.error && !result.signal, 'ZooKeeper status command failed');
  assert.match(result.stdout, /^Mode: standalone\r?$/m, 'ZooKeeper must respond in standalone mode');
}

export function verifyBackendStartupLog(role, text) {
  assert.ok(Object.hasOwn(BACKEND_PORTS, role));
  assert.ok(typeof text === 'string' && text.trim(), 'Missing backend startup log');
  assert.doesNotMatch(text, /Application run failed|APPLICATION FAILED TO START|Error starting ApplicationContext/,
    'Backend reported a fatal initialization error after opening its HTTP port');
  return { noFatalStartupFailureObserved: true, bytes: Buffer.byteLength(text), sha256: hash(text) };
}

export function verifyBackendFinalState(container) {
  assert.equal(container.State?.Running, true, 'Owned service stopped after deployment verification');
  assert.equal(container.State.Status, 'running', 'Owned service is not in the running state');
  assert.equal(container.State.OOMKilled, false, 'Owned service was OOM-killed');
  assert.equal(container.State.Dead, false, 'Owned service is dead');
}

export function backendRunCommand(options) {
  const { role, configPath, loggingPath, modelPath, mysqlName, nacosName } = options;
  assert.ok(Object.hasOwn(BACKEND_PORTS, role));
  assert.equal(options.name.split('-').at(-1), role);
  const heap = role === 'gateway' ? '512m' : '1536m';
  const args = [...commonRun(options), '--workdir', '/tmp',
    '--mount', `type=bind,src=${runInput(configPath, options.runId, options.label)},dst=/app/config/application.properties,readonly`,
    '--mount', `type=bind,src=${runInput(loggingPath, options.runId, options.label)},dst=/app/config/logback.xml,readonly`,
    '--env', `JAVA_TOOL_OPTIONS=-Xms128m -Xmx${heap} -XX:ActiveProcessorCount=2 -Duser.home=/tmp -Dlogging.config=file:/app/config/logback.xml -Dcom.sun.xml.bind.v2.bytecode.ClassTailor.noOptimize=true --add-exports=java.naming/com.sun.jndi.ldap=ALL-UNNAMED`];
  if (role === 'provider') {
    assert.equal(mysqlName, `nf-${options.runId}-mysql`);
    assert.equal(nacosName, `nf-${options.runId}-backend-${options.label}-nacos`);
    args.push('--mount', `type=bind,src=${runInput(modelPath, options.runId, options.label)},dst=/app/model,readonly`,
      '--env', `MYSQL_HOST=${mysqlName}`, '--env', 'MYSQL_PORT=3306',
      '--env', `NACOS_HOST=${nacosName}`, '--env', 'WAIT_FOR_MYSQL=true',
      '--env', 'WAIT_FOR_NACOS_HEALTH=false', '--env', 'WAIT_FOR_TIMEOUT=120',
      options.imageId, `${mysqlName}:3306`, `${nacosName}:8848`, '--',
      '--spring.config.location=file:/app/config/application.properties');
  } else {
    args.push('--entrypoint', 'java', options.imageId,
      '--add-opens=java.base/java.lang=ALL-UNNAMED',
      '--add-opens=java.base/java.lang.reflect=ALL-UNNAMED',
      '-Duser.timezone=Asia/Shanghai', '-jar', jars[role],
      '--spring.config.location=file:/app/config/application.properties');
  }
  return args;
}

function hostArtifactInput(workspace, path) {
  assert.equal(typeof path, 'string', 'Host runtime input path is required');
  assert.equal(path, resolve(path), 'Host runtime input must be absolute');
  assert.ok(!/[\r\n\0]/.test(path));
  assert.ok(path.startsWith(`${join(workspace, '.artifacts')}/`),
    'Host runtime inputs must remain in private workspace artifacts');
  return path;
}

export function verifyHostRuntimeExecutable(bytes, platform = process.platform, architecture = process.arch) {
  assert.equal(platform, 'linux', 'Owned host runtime requires Linux');
  assert.ok(['arm64', 'x64'].includes(architecture), 'Unsupported host runtime architecture');
  assert.ok(Buffer.isBuffer(bytes) && bytes.length >= 20, 'Missing host ELF header');
  assert.deepEqual([...bytes.subarray(0, 6)], [0x7f, 0x45, 0x4c, 0x46, 2, 1],
    'Owned host executable must be a 64-bit little-endian ELF');
  assert.equal(bytes.readUInt16LE(18), architecture === 'arm64' ? 183 : 62,
    'Owned executable architecture differs from the host');
}

export function buildOwnedHostLoopbackShim({ workspace = defaultWorkspace, runId, label }) {
  validateRun(runId, label);
  workspace = resolve(workspace);
  const path = join(workspace, '.artifacts/native-nonadmin-fixtures', runId,
    `backend-host-${label}`, `network-${randomBytes(6).toString('hex')}`);
  const directories = new PinnedDirectories();
  try {
    const directory = directories.open(path, { create: true, exclusive: true });
    directories.write(directory, 'owned-loopback.c', hostLoopbackSource);
    const source = join(path, 'owned-loopback.c');
    const library = join(path, 'owned-loopback.so');
    const result = spawnSync('/usr/bin/cc', ['-shared', '-fPIC', '-O2', '-Wall', '-Wextra', '-Werror',
      '-o', library, source, '-ldl'], {
      cwd: path, env: { PATH: '/usr/bin:/bin', HOME: path, TMPDIR: path, LC_ALL: 'C' },
      encoding: 'utf8', timeout: 30000, maxBuffer: 1024 * 1024,
    });
    directories.write(directory, 'compile.private.log', `${result.stdout ?? ''}${result.stderr ?? ''}`);
    assert.ok(result.status === 0 && !result.error && !result.signal, 'Owned host network adapter compilation failed');
    fs.chmodSync(library, 0o600);
    const bytes = readPinnedFile(directories, directory, 'owned-loopback.so').data;
    verifyHostRuntimeExecutable(bytes);
    const binding = { contract: 'owned-host-dynamic-loopback-adapter-v1', source, library,
      sourceSha256: hash(hostLoopbackSource), librarySha256: hash(bytes),
      platform: process.platform, architecture: process.arch,
      boundary: 'Dynamic bind/connect adaptation only; not kernel isolation or an unbypassable network boundary.' };
    hostNetworkBindings.set(binding, hash(json(binding)));
    return binding;
  } finally { directories.close(); }
}

function verifyHostLoopbackShim(binding) {
  assert.equal(hostNetworkBindings.get(binding), hash(json(binding)), 'A fresh unchanged host network adapter is required');
  assert.equal(hash(fs.readFileSync(binding.source)), binding.sourceSha256);
  assert.equal(hash(fs.readFileSync(binding.library)), binding.librarySha256);
  assert.equal(binding.platform, process.platform);
  assert.equal(binding.architecture, process.arch);
}

export function ownedHostRuntimeCommand({
  workspace = defaultWorkspace, runId, label, role, executable, libraryPath,
  port, mysqlBase, jarPath, configPath, redisPath, networkBinding, allowedPorts, jarSha256,
  dependencies, classpathRoot,
}) {
  validateRun(runId, label);
  workspace = resolve(workspace);
  const directory = join(workspace, '.artifacts/native-nonadmin-fixtures', runId, `backend-host-${label}`);
  executable = hostArtifactInput(workspace, executable);
  assert.ok(['mysql-initialize', 'mysql', 'redis', 'nacos', 'zookeeper', 'uaa',
    ...Object.keys(BACKEND_PORTS)].includes(role),
    'Unreviewed owned host process role');
  assert.ok(Number.isSafeInteger(port) && port >= 1024 && port <= 65535);
  assert.ok(![3306, 6379, 8848, 2181, 32666, ...Object.values(BACKEND_PORTS)].includes(port),
    'Owned host processes require a distinct nondefault loopback port');
  const args = [];
  const env = { HOME: directory, TMPDIR: join(directory, 'tmp'), LANG: 'C.UTF-8', LC_ALL: 'C.UTF-8' };
  const inputs = [executable];
  const requiredHashes = {};
  const listenerPorts = role === 'nacos' ? [port, port - 1000, port + 1000, port + 1001] : [port];
  const udpPorts = role === 'nacos' || Object.hasOwn(BACKEND_PORTS, role) ? [port + 1] : [];
  if (networkBinding !== undefined) {
    verifyHostLoopbackShim(networkBinding);
    assert.equal(dirname(dirname(networkBinding.library)), directory);
    assert.ok(Array.isArray(allowedPorts) && allowedPorts.length > 0);
    for (const value of allowedPorts) {
      assert.ok(Number.isSafeInteger(value) && value >= 1024 && value <= 65535);
      assert.ok(![3306, 6379, 8848, 2181, 32666, ...Object.values(BACKEND_PORTS)].includes(value),
        'Shared service ports cannot enter the owned host network allowlist');
    }
    assert.ok(listenerPorts.every(value => allowedPorts.includes(value)));
    assert.ok(udpPorts.every(value => allowedPorts.includes(value)), 'Explicit owned Java UDP source ports are required');
    env.LD_PRELOAD = networkBinding.library;
    env.AIBIZ_OWNED_TCP_PORTS = [...new Set(allowedPorts)].sort((a, b) => a - b).join(',');
    if (udpPorts.length) env.AIBIZ_OWNED_UDP_PORT = String(udpPorts[0]);
    inputs.push(networkBinding.source, networkBinding.library);
    requiredHashes[networkBinding.source] = networkBinding.sourceSha256;
    requiredHashes[networkBinding.library] = networkBinding.librarySha256;
  }
  if (role === 'mysql' || role === 'mysql-initialize') {
    mysqlBase = hostArtifactInput(workspace, mysqlBase);
    libraryPath = hostArtifactInput(workspace, libraryPath);
    assert.equal(executable, join(mysqlBase, 'bin/mysqld'));
    assert.equal(libraryPath, join(mysqlBase, 'lib'));
    env.LD_LIBRARY_PATH = libraryPath;
    args.push('--no-defaults', `--basedir=${mysqlBase}`, `--datadir=${join(directory, 'mysql-data')}`,
      '--lower-case-table-names=1', '--character-set-server=utf8mb4',
      '--socket=./mysql.sock', `--pid-file=${join(directory, 'mysql.pid')}`,
      `--log-error=${join(directory, 'mysql.private.log')}`, '--innodb-buffer-pool-size=64M',
      '--innodb-log-file-size=16M', '--max-connections=80', '--performance-schema=OFF',
      '--innodb-use-native-aio=0');
    if (role === 'mysql-initialize') args.push('--initialize-insecure', '--skip-networking');
    else args.push('--bind-address=127.0.0.1', `--port=${port}`, '--skip-name-resolve');
  } else if (role === 'redis') {
    libraryPath = hostArtifactInput(workspace, libraryPath);
    assert.equal(executable, join(libraryPath, 'ld-musl-aarch64.so.1'));
    const redis = hostArtifactInput(workspace, redisPath);
    inputs.push(redis);
    args.push('--library-path', libraryPath, redis, '--bind', '127.0.0.1', '--port', String(port),
      '--protected-mode', 'yes', '--daemonize', 'no', '--save', '', '--appendonly', 'no',
      '--dir', directory, '--maxmemory', '64mb', '--maxmemory-policy', 'noeviction');
  } else if (role === 'nacos') {
    assert.ok(networkBinding, 'Nacos requires the exact owned loopback network adapter');
    jarPath = hostArtifactInput(workspace, jarPath);
    assert.match(jarSha256 ?? '', /^[a-f0-9]{64}$/, 'The original Nacos JAR hash is required');
    assert.equal(hash(fs.readFileSync(jarPath)), jarSha256);
    inputs.push(jarPath);
    requiredHashes[jarPath] = jarSha256;
    env.SPRING_DATASOURCE_PLATFORM = '';
    args.push('-Xms128m', '-Xmx512m', '-XX:ActiveProcessorCount=2',
      '-Djava.net.preferIPv4Stack=true', '-Dnacos.standalone=true',
      '-Dnacos.inetutils.ip-address=127.0.0.1', '-Dnacos.preferHostnameOverIp=false',
      `-Dnacos.home=${join(directory, 'nacos')}`, `-Duser.home=${directory}`,
      `-Djava.io.tmpdir=${env.TMPDIR}`, '-jar', jarPath,
      '--server.address=127.0.0.1', `--server.port=${port}`, '--server.servlet.context-path=/nacos',
      '--nacos.core.auth.enabled=false');
  } else if (role === 'uaa' || role === 'zookeeper') {
    assert.equal(configPath, join(directory, `${role}-config/application.properties`));
    classpathRoot = hostArtifactInput(workspace, classpathRoot);
    const roots = role === 'uaa' ? ['third-party', 'starters', 'packages'].map(name => join(classpathRoot, name))
      : [classpathRoot];
    const archives = roots.flatMap(root => fs.readdirSync(root).filter(name => name.endsWith('.jar'))
      .map(name => join(root, name))).sort();
    assert.ok(archives.length > 0, 'Original host runtime classpath archives are required');
    for (const path of archives) {
      inputs.push(path);
      requiredHashes[path] = hash(fs.readFileSync(path));
    }
    inputs.push(configPath);
    requiredHashes[configPath] = hash(fs.readFileSync(configPath));
    args.push('-Xms64m', role === 'uaa' ? '-Xmx1024m' : '-Xmx512m', '-XX:ActiveProcessorCount=2',
      '-Djava.net.preferIPv4Stack=true',
      `-Duser.home=${directory}`, `-Djava.io.tmpdir=${env.TMPDIR}`,
      '-Dcom.sun.xml.bind.v2.bytecode.ClassTailor.noOptimize=true');
    if (role === 'uaa') args.push('-Dspring.cloud.bootstrap.enabled=false',
      '-Dspring.cloud.nacos.config.enabled=false', '-Dspring.cloud.nacos.discovery.enabled=false',
      '-Dspring.cloud.discovery.enabled=false', '-Deureka.client.enabled=false',
      `-Dlogging.config=file:${join(dirname(configPath), 'logback.xml')}`);
    args.push('-cp', roots.map(path => `${path}/*`).join(':'));
    if (role === 'uaa') args.push('cn.ibizlab.BootApplication',
      `--spring.config.location=classpath:/,file:${configPath}`,
      '--server.address=127.0.0.1', `--server.port=${port}`);
    else args.push('org.apache.zookeeper.server.quorum.QuorumPeerMain', configPath);
  } else {
    jarPath = hostArtifactInput(workspace, jarPath);
    assert.equal(configPath, join(directory, `${role}-config/application.properties`),
      'Host backend configuration must belong to this exact run');
    inputs.push(jarPath, configPath);
    if (dependencies !== undefined) {
      assert.match(jarSha256 ?? '', /^[a-f0-9]{64}$/, 'The original host backend JAR hash is required');
      assert.equal(hash(fs.readFileSync(jarPath)), jarSha256);
      requiredHashes[jarPath] = jarSha256;
      requiredHashes[configPath] = hash(fs.readFileSync(configPath));
    }
    args.push('-Xms64m', `-Xmx${role === 'gateway' ? '512m' : '1536m'}`,
      '-XX:ActiveProcessorCount=2', '-Djava.net.preferIPv4Stack=true',
      `-Duser.home=${directory}`, `-Djava.io.tmpdir=${env.TMPDIR}`,
      '--add-opens=java.base/java.lang=ALL-UNNAMED',
      '--add-opens=java.base/java.lang.reflect=ALL-UNNAMED',
      '--add-exports=java.naming/com.sun.jndi.ldap=ALL-UNNAMED',
      '-Dcom.sun.xml.bind.v2.bytecode.ClassTailor.noOptimize=true',
      '-jar', jarPath, `--spring.config.location=file:${configPath}`,
      '--server.address=127.0.0.1', `--server.port=${port}`);
  }
  const command = { role, executable, args, cwd: directory, env, port, listenerPorts, udpPorts, inputs, requiredHashes };
  hostCommands.set(command, hash(json(command)));
  if (dependencies !== undefined) {
    const roles = role === 'uaa' ? ['mysql', 'redis'] : ['mysql', 'redis', 'nacos', 'uaa', 'zookeeper',
      ...(role === 'provider' || role === 'gateway' ? ['allinone'] : []),
      ...(role === 'gateway' ? ['provider'] : [])];
    assert.deepEqual(Object.keys(dependencies).sort(), roles.sort(), 'Exact owned host dependencies are required');
    for (const [role, handle] of Object.entries(dependencies)) {
      const witness = ownedHostRuntimeWitness(handle);
      assert.equal(witness.role, role);
      assert.equal(witness.directory, directory, 'Host dependencies must belong to this exact run');
    }
    hostCommandDependencies.set(command, { dependencies, runId, configPath });
    verifyHostBackendConfiguration(command);
  }
  return command;
}

function verifyHostBackendConfiguration(command) {
  const proof = hostCommandDependencies.get(command);
  assert.ok(proof, 'Backend host launch requires fresh owned dependency and configuration bindings; command construction alone is insufficient');
  assert.ok(command.env.LD_PRELOAD && command.env.AIBIZ_OWNED_TCP_PORTS,
    'Host Java services require the bound dynamic loopback adapter');
  const peers = Object.fromEntries(Object.entries(proof.dependencies)
    .map(([role, handle]) => [role, ownedHostRuntimeWitness(handle)]));
  const ports = new Set(Object.values(peers).map(peer => peer.port));
  ports.add(command.port);
  const config = parseJavaProperties(fs.readFileSync(proof.configPath));
  assert.equal(String(config['server.port']), String(command.port));
  assert.equal(config['server.address'], '127.0.0.1');
  for (const [key, value] of Object.entries(config)) {
    const text = String(value);
    if (/\.url$/.test(key) && text.startsWith('jdbc:')) {
      const url = new URL(text.slice('jdbc:'.length));
      assert.equal(url.protocol, 'mysql:');
      assert.equal(url.hostname, '127.0.0.1');
      assert.equal(url.port, String(peers.mysql.port));
      assert.match(url.pathname, new RegExp(`^/nf_${proof.runId}_(uaa|meta|model_a|model_b|ebsx|workflow)$`));
    } else if (/^https?:\/\//.test(text)) {
      const url = new URL(text);
      assert.equal(url.hostname, '127.0.0.1', 'Host service URL must use the verified owned loopback peer');
      assert.ok(ports.has(Number(url.port)));
    } else if (/^lb:\/\//.test(text)) {
      assert.ok(['lb://uaa-api', 'lb://ibizcloud-uaa'].includes(text)
        || new RegExp(`^lb://nf[_-]${proof.runId}[_-][a-z0-9_-]+$`).test(text));
    } else if (/(\.host|\.servicehost)$/.test(key)) {
      assert.equal(text, '127.0.0.1');
    } else if (/(\.server-addr|\.serviceurl)$/.test(key) && /^[^/]+:\d+$/.test(text)) {
      const url = new URL(`http://${text}`);
      assert.equal(url.hostname, '127.0.0.1');
      assert.ok(ports.has(Number(url.port)));
    }
    if (/(\.filefolder|\.tempfolder|\.modelpath)$/.test(key)) {
      assert.ok(text.startsWith(`${command.cwd}/`), 'Host writable/model paths must remain in this exact run');
    }
    if (/(\.updatedbschema|\.installdata|\.isSyncDBSchema)$/.test(key)) {
      assert.equal(text, 'false', 'Host backend cannot enable schema synchronization or seed installation');
    }
    if (/\.username$/.test(key)) assert.match(text, new RegExp(`^nf_${proof.runId}_[a-z0-9_]+$`));
  }
  assert.equal(config['spring.redis.host'], '127.0.0.1');
  assert.equal(String(config['spring.redis.port']), String(peers.redis.port));
  if (command.role !== 'uaa') {
    for (const purpose of ['config', 'discovery']) {
      assert.equal(config[`spring.cloud.nacos.${purpose}.enabled`], 'true');
      assert.equal(config[`spring.cloud.nacos.${purpose}.server-addr`], `127.0.0.1:${peers.nacos.port}`);
    }
  }
}

function verifyOwnedHostCommand(command) {
  assert.equal(hostCommands.get(command), hash(json(command)), 'A fresh unchanged owned host command is required');
  for (const [path, sha256] of Object.entries(command.requiredHashes)) {
    assert.equal(hash(fs.readFileSync(path)), sha256, 'Required host runtime input changed before execution');
  }
  if (command.role === 'uaa' || Object.hasOwn(BACKEND_PORTS, command.role)) verifyHostBackendConfiguration(command);
  if (command.role === 'zookeeper') {
    const config = parseJavaProperties(fs.readFileSync(command.inputs.find(path =>
      path.endsWith('/zookeeper-config/application.properties'))));
    assert.equal(config.clientPortAddress, '127.0.0.1');
    assert.equal(String(config.clientPort), String(command.port));
    assert.equal(config.dataDir, join(command.cwd, 'zookeeper-data'));
    assert.equal(config['admin.enableServer'], 'false');
    assert.equal(config.standaloneEnabled, 'true');
  }
  const libraryPath = command.role === 'redis' ? command.args[1] : command.env.LD_LIBRARY_PATH;
  for (const path of [...command.inputs, libraryPath].filter(Boolean)) {
    let current = '/';
    for (const part of path.split('/').filter(Boolean)) {
      current = join(current, part);
      assert.equal(fs.lstatSync(current).isSymbolicLink(), false, 'Host runtime input cannot traverse a symlink');
    }
  }
  const executables = [command.executable, ...(command.role === 'redis' ? [command.args[2]] : [])];
  for (const path of executables) {
    assert.equal(fs.statSync(path).isFile(), true, 'Host runtime executable must be a regular file');
    const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const bytes = Buffer.alloc(20);
      assert.equal(fs.readSync(fd, bytes, 0, 20, 0), 20);
      verifyHostRuntimeExecutable(bytes);
    } finally { fs.closeSync(fd); }
  }
  const libraries = libraryPath ? fs.readdirSync(libraryPath).filter(name => /\.so(?:\.|$)/.test(name)).map(name => {
    const path = join(libraryPath, name);
    assert.ok(fs.realpathSync(path).startsWith(`${libraryPath}/`),
      'Host shared libraries cannot resolve outside their private directory');
    assert.equal(fs.statSync(path).isFile(), true);
    return path;
  }).sort() : [];
  assert.ok(!['mysql', 'mysql-initialize', 'redis'].includes(command.role)
    || libraries.length > 0, 'Explicit private host shared libraries are required');
  return [...command.inputs, ...libraries].map(path => ({ path, sha256: hash(fs.readFileSync(path)) }));
}

export function ownedHostRuntimeWitness(handle) {
  const proof = hostRuntimeHandles.get(handle);
  assert.ok(proof && proof.active, 'A live in-process owned host runtime handle is required');
  assert.ok(proof.child.exitCode === null && proof.child.signalCode === null, 'Owned host dependency stopped');
  assert.equal(hostCommands.get(proof.command), hash(json(proof.command)), 'Owned host dependency command drift');
  const stat = fs.readFileSync(`/proc/${proof.child.pid}/stat`, 'utf8');
  const startTicks = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/)[19];
  assert.equal(startTicks, proof.startTicks, 'Owned host process identity changed');
  const cmdline = fs.readFileSync(`/proc/${proof.child.pid}/cmdline`);
  assert.equal(hash(cmdline), proof.cmdlineSha256, 'Owned host process arguments changed');
  let listener;
  try {
    listener = verifyOwnedHostListener(proof.child.pid, proof.command.port, proof.command.listenerPorts,
      proof.command.udpPorts);
  } catch (error) {
    error.message = `${proof.command.role}: ${error.message}`;
    throw error;
  }
  for (const input of proof.inputs) {
    assert.equal(hash(fs.readFileSync(input.path)), input.sha256, 'Owned host runtime input changed');
  }
  return { contract: 'owned-host-runtime-witness-v1', pid: proof.child.pid, role: proof.command.role,
    port: proof.command.port, directory: proof.command.cwd, startTicks, cmdlineSha256: proof.cmdlineSha256,
    executableSha256: proof.inputs.find(input => input.path === proof.command.executable).sha256,
    inputs: proof.inputs, listener, nativeAcceptance: false };
}

export function verifyOwnedHostListener(pid, port, additionalPorts = [], udpPorts = []) {
  assert.ok(Number.isSafeInteger(pid) && pid > 1);
  assert.ok(Number.isSafeInteger(port) && port >= 1024 && port <= 65535);
  const sockets = new Set(fs.readdirSync(`/proc/${pid}/fd`).flatMap(name => {
    try {
      const match = fs.readlinkSync(`/proc/${pid}/fd/${name}`).match(/^socket:\[(\d+)\]$/);
      return match ? [match[1]] : [];
    } catch (error) {
      if (error.code === 'ENOENT') return [];
      throw error;
    }
  }));
  assert.ok(Array.isArray(additionalPorts) && additionalPorts.every(value =>
    Number.isSafeInteger(value) && value >= 1024 && value <= 65535));
  assert.ok(Array.isArray(udpPorts) && udpPorts.every(value =>
    Number.isSafeInteger(value) && value >= 1024 && value <= 65535));
  const allowed = new Set([port, ...additionalPorts]);
  const listeners = ['tcp', 'tcp6'].flatMap(protocol => fs.readFileSync(`/proc/${pid}/net/${protocol}`, 'utf8')
    .trim().split('\n').slice(1).map(line => line.trim().split(/\s+/))
    .filter(row => row[3] === '0A' && sockets.has(row[9]))
    .map(row => ({ protocol, address: row[1].split(':')[0], port: Number.parseInt(row[1].split(':')[1], 16) })));
  assert.ok(listeners.length > 0 && listeners.every(row =>
    row.protocol === 'tcp' && row.address === '0100007F' && allowed.has(row.port)),
  'Owned host process must own only its declared IPv4 loopback listener');
  const datagrams = ['udp', 'udp6'].flatMap(protocol =>
    fs.readFileSync(`/proc/${pid}/net/${protocol}`, 'utf8').trim().split('\n').slice(1)
      .map(line => line.trim().split(/\s+/)).filter(row => sockets.has(row[9]))
      .map(row => ({ protocol, address: row[1].split(':')[0], port: Number.parseInt(row[1].split(':')[1], 16) })));
  if (!datagrams.every(row => row.protocol === 'udp'
    && row.address === '0100007F' && udpPorts.includes(row.port))) {
    const error = new Error('Owned host process has an unreviewed UDP address or source port');
    error.ownedSocketDiagnostic = { pid, port, listeners, datagrams };
    throw error;
  }
  return { pid, port, processOwnsLoopbackListener: true, listeners, datagrams };
}

async function requireUnusedHostPort(port) {
  const server = createServer();
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen({ host: '127.0.0.1', port, exclusive: true }, resolve);
    });
  } finally {
    if (server.listening) await new Promise((resolve, reject) =>
      server.close(error => error ? reject(error) : resolve()));
  }
}

export async function withOwnedHostRuntime(command, operation, { timeoutMs = 30000 } = {}) {
  assert.equal(typeof operation, 'function');
  assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs >= 100 && timeoutMs <= 600000);
  const inputs = verifyOwnedHostCommand(command);
  if (command.role !== 'mysql-initialize') {
    for (const port of command.listenerPorts) await requireUnusedHostPort(port);
  }
  const directories = new PinnedDirectories();
  let child;
  let log;
  let timer;
  let timeout;
  let closed;
  let runtimeProof;
  let failure;
  try {
    const directory = directories.open(command.cwd);
    directories.open(command.env.TMPDIR, { create: true });
    if (command.role.startsWith('mysql')) {
      directories.open(join(command.cwd, 'mysql-data'), {
        ...(command.role === 'mysql-initialize' ? { create: true, exclusive: true } : {}),
      });
    }
    if (command.role === 'nacos') {
      for (const name of ['nacos', 'nacos/data', 'nacos/logs', 'logs']) {
        directories.open(join(command.cwd, name), { create: true });
      }
    }
    if (command.role === 'zookeeper') directories.open(join(command.cwd, 'zookeeper-data'), { create: true });
    const name = `${command.role}-host-${randomBytes(6).toString('hex')}.private.log`;
    directories.write(directory, name, '');
    log = fs.openSync(directories.entry(directory, name),
      fs.constants.O_WRONLY | fs.constants.O_APPEND | fs.constants.O_NOFOLLOW);
    child = spawn(command.executable, command.args, {
      cwd: command.cwd, env: command.env, stdio: ['ignore', log, log], shell: false,
    });
    let spawnFailure;
    closed = new Promise(resolve => {
      child.once('error', error => { spawnFailure = error; });
      child.once('close', (code, signal) => resolve({ code, signal, spawnFailed: Boolean(spawnFailure) }));
    });
    const interrupted = new Promise((_resolve, reject) => {
      timer = setTimeout(() => {
        timeout = true;
        reject(new Error('Owned host process operation exceeded its deadline'));
      }, timeoutMs);
    });
    const handle = {
      pid: child.pid, port: command.port, directory: command.cwd,
      exited: closed,
      assertRunning: () => assert.ok(child.pid && child.exitCode === null && child.signalCode === null
        && !spawnFailure, 'Owned host process exited'),
      assertListening: () => verifyOwnedHostListener(child.pid, command.port, command.listenerPorts,
        command.udpPorts),
    };
    const run = async () => {
      if (command.role !== 'mysql-initialize') {
        for (;;) {
          handle.assertRunning();
          if (['nacos', 'uaa', 'zookeeper', ...Object.keys(BACKEND_PORTS)].includes(command.role)) {
            const text = fs.readFileSync(directories.entry(directory, name), 'utf8');
            assert.doesNotMatch(text, /Application run failed|APPLICATION FAILED TO START/,
              'Owned Java service reported a fatal startup failure; see its private log');
          }
          try { handle.assertListening(); break; } catch {}
          await new Promise(resolve => setTimeout(resolve, 50));
        }
      }
      const stat = fs.readFileSync(`/proc/${child.pid}/stat`, 'utf8');
      runtimeProof = { command, child, inputs, active: true,
        startTicks: stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/)[19],
        cmdlineSha256: hash(fs.readFileSync(`/proc/${child.pid}/cmdline`)) };
      hostRuntimeHandles.set(handle, runtimeProof);
      return operation(handle);
    };
    const value = await Promise.race([run(), interrupted]);
    if (['nacos', 'uaa', 'zookeeper', ...Object.keys(BACKEND_PORTS)].includes(command.role)) {
      assert.doesNotMatch(fs.readFileSync(directories.entry(directory, name), 'utf8'),
        /Application run failed|APPLICATION FAILED TO START/, 'Owned Java service reported a fatal startup failure');
    }
    for (const input of inputs) {
      assert.equal(hash(fs.readFileSync(input.path)), input.sha256, 'Owned host process input changed');
    }
    return { value, inputs, nativeAcceptance: false, permissionAcceptance: false };
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    clearTimeout(timer);
    if (runtimeProof) runtimeProof.active = false;
    if (failure?.ownedSocketDiagnostic?.pid === child?.pid) {
      try {
        const diagnostic = directories.open(command.cwd);
        directories.write(diagnostic, `${command.role}-socket-${randomBytes(6).toString('hex')}.private.json`,
          json({ role: command.role, ...failure.ownedSocketDiagnostic }));
      } catch {}
    }
    if (child) {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
      const force = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      }, 5000);
      try { await closed; } finally { clearTimeout(force); }
    }
    if (log !== undefined) fs.closeSync(log);
    directories.close();
    assert.ok(!timeout, 'Owned host process deadline exceeded; the exact child was cleaned up');
  }
}

export function retainedPeerWitness(container) {
  assert.match(container.Id, idPattern);
  return {
    id: container.Id, image: container.Image, name: container.Name,
    startedAt: container.State.StartedAt, restartCount: container.RestartCount,
    config: container.Config,
    mounts: [...container.Mounts].sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b))),
    hostConfig: container.HostConfig,
    networks: container.NetworkSettings.Networks,
  };
}

export function verifyRetainedPeer(previous, current) {
  assert.ok(current, 'Retained peer vanished');
  assert.equal(current.State.Running, true, 'Retained peer stopped');
  assert.deepEqual(retainedPeerWitness(current), retainedPeerWitness(previous),
    'Retained peer configuration, identity or lifecycle changed');
}

export function verifyRetainedPeers(before, after) {
  assert.equal(before.length, 3, 'Retained peers must be MySQL, UAA and Redis');
  assert.equal(after.length, before.length);
  for (const previous of before) {
    verifyRetainedPeer(previous, after.find(row => row.Id === previous.Id));
  }
}

export function deploymentInput({ manifest, resources, imageReceipt, services, auxiliaryContainers, containers, network,
  volumes = [], r05OwnedModelBinding }) {
  const endpoint = (role, port) => {
    const container = containers.find(row => row.Id === services[role].containerId);
    privateContainerOrigin(container, network, port);
    const attachment = container.NetworkSettings.Networks[network.Name];
    return {
      transport: 'private-inspected-ipv4', service: role, containerPort: port,
      containerId: container.Id, networkId: network.Id,
      endpointId: attachment.EndpointID, ipv4: attachment.IPAddress,
    };
  };
  const value = {
    contract: 'run-owned-native-permission-deployment-input-v2',
    runId: manifest.runId,
    imageReceipt: { path: imageReceipt.reportPath, sha256: imageReceipt.reportSha256 },
    services, auxiliaryContainers,
    endpoints: { uaa: endpoint('uaa', 32666), backend: endpoint('gateway', 30086) },
    ...(r05OwnedModelBinding ? {
      r05OwnedModelBinding: verifyStagedR05OwnedModelBinding(r05OwnedModelBinding),
    } : {}),
  };
  if (r05OwnedModelBinding) {
    const provider = containers.find(row => row.Id === services.provider.containerId);
    verifyR05OwnedModelProviderMount(r05OwnedModelBinding, provider);
  }
  validateDeployment(manifest, resources, value, containers, network, imageReceipt.report, volumes);
  return value;
}

async function http(origin, path, options = {}) {
  const response = await fetch(`${origin}${path}`, {
    ...options, redirect: 'error', signal: AbortSignal.timeout(5000),
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  assert.ok(bytes.length <= 4 * 1024 * 1024, 'HTTP startup response too large');
  return { status: response.status, bytes };
}

export async function publishOwnedNacos(origin, rows, {
  request = http, delay = ms => new Promise(resolve => setTimeout(resolve, ms)),
  readbackAttempts = 50,
} = {}) {
  assert.ok(Array.isArray(rows) && rows.length > 0, 'Owned Nacos configuration is required');
  assert.ok(Number.isSafeInteger(readbackAttempts) && readbackAttempts >= 1 && readbackAttempts <= 50);
  const keys = new Set();
  const bindings = [];
  for (const row of rows) {
    assert.match(row.dataId, /^[A-Za-z0-9_.-]+$/);
    assert.match(row.group, /^nf_[a-f0-9]{12}$/);
    const key = `${row.group}/${row.dataId}`;
    assert.ok(!keys.has(key), 'Duplicate Nacos input');
    keys.add(key);
    parseOwnedNacosContent(row.content);
  }
  assert.equal(new Set(rows.map(row => row.group)).size, 1, 'Nacos inputs must share this run group');
  for (const row of rows) {
    const body = new URLSearchParams({ dataId: row.dataId, group: row.group, content: row.content, type: 'yaml' });
    const sent = await request(origin, '/nacos/v1/cs/configs', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body,
    });
    assert.equal(sent.status, 200, 'Owned Nacos publish failed');
    assert.equal(sent.bytes.toString('utf8').trim(), 'true', 'Owned Nacos rejected configuration');
    const query = new URLSearchParams({ dataId: row.dataId, group: row.group });
    let attempts = 0;
    for (;;) {
      const fetched = await request(origin, `/nacos/v1/cs/configs?${query}`);
      attempts++;
      if (fetched.status === 404 && attempts < readbackAttempts) {
        await delay(100);
        continue;
      }
      assert.equal(fetched.status, 200, 'Owned Nacos configuration was not readable after publishing');
      assert.equal(fetched.bytes.toString('utf8'), row.content, 'Owned Nacos readback differs');
      break;
    }
    bindings.push({ dataId: row.dataId, group: row.group, bytes: Buffer.byteLength(row.content),
      sha256: hash(row.content), readbackAttempts: attempts });
  }
  return bindings;
}

export function stageOwnedModelInput({
  directories, source, outputPath, workspace = defaultWorkspace, centralMemberReceiptPath,
  modelContextOverlay = false, r05OwnedModelCandidate,
}) {
  assert.equal(typeof modelContextOverlay, 'boolean', 'Model context overlay selection must be boolean');
  const model = readTree(source, { jsonOnly: false });
  const overlay = centralMemberReceiptPath === undefined ? undefined
    : readCentralMemberModelOverlay({ workspace, receiptPath: centralMemberReceiptPath });
  const contextOverlay = modelContextOverlay ? readNativeModelContextOverlay({ workspace, sourceRoot: source }) : undefined;
  const r05Overlay = r05OwnedModelCandidate === undefined ? undefined : readR05OwnedModelOverlay({
    workspace, sourceRoot: source, candidatePath: r05OwnedModelCandidate, modelRoot: outputPath,
  });
  const replacements = [...(overlay?.contents ?? []), ...(contextOverlay?.contents ?? []),
    ...(r05Overlay?.contents ?? [])];
  assert.equal(new Set(replacements.map(file => file.path)).size, replacements.length,
    'Model overlays cannot conflict');
  if (overlay) {
    for (const input of overlay.inputs) {
      assert.equal(model.entries.find(row => row.path === input.path)?.sha256, input.sha256,
        'Central candidate does not match the actual backend model source');
    }
  }
  if (r05Overlay) {
    for (const input of r05Overlay.inputs) {
      assert.equal(model.entries.find(row => row.path === input.path)?.sha256, input.sha256,
        'R05 candidate does not match the actual backend model source');
    }
  }
  const targetRoot = directories.open(outputPath, { create: true, exclusive: true });
  for (const file of model.contents) {
    const target = directories.open(join(targetRoot.path, dirname(file.path)), { create: true });
    const replacement = replacements.find(row => row.path === file.path);
    directories.write(target, basename(file.path), replacement?.data ?? file.data);
    fs.chmodSync(directories.entry(target, basename(file.path)), 0o644);
  }
  for (const directory of directories.directories.values()) {
    if (directory.path === targetRoot.path || directory.path.startsWith(`${targetRoot.path}/`)) {
      fs.chmodSync(directory.access, 0o755);
    }
  }
  const staged = readTree(targetRoot.path, { jsonOnly: false });
  const expectedEntries = model.entries.map(file => {
    const replacement = replacements.find(row => row.path === file.path);
    return replacement ? { ...file, bytes: replacement.data.length, sha256: replacement.sha256 } : file;
  });
  assert.deepEqual(staged.entries, expectedEntries, 'Staged model input drifted');
  const current = readTree(source, { jsonOnly: false });
  assert.deepEqual(current.entries, model.entries, 'Model source changed during staging');
  return {
    directory: targetRoot, files: staged.files, bytes: staged.bytes, fingerprint: staged.fingerprint,
    ...(overlay ? { centralMemberBinding: verifyStagedCentralMemberModel({
      workspace, receiptPath: centralMemberReceiptPath, modelPath: targetRoot.path, modelContextOverlay,
      r05OwnedModelCandidate,
    }) } : {}),
    ...(contextOverlay ? { sourceFingerprint: model.fingerprint, modelContextOverlay: verifyNativeModelContextOverlay({
      workspace, sourceRoot: source, modelRoot: targetRoot.path, receipt: contextOverlay.receipt,
    }) } : {}),
    ...(r05Overlay ? { r05OwnedModelBinding: bindStagedR05OwnedModel({
      workspace, sourceRoot: source, candidatePath: r05OwnedModelCandidate,
      modelRoot: targetRoot.path, centralMemberReceiptPath, modelContextOverlay,
    }) } : {}),
  };
}

export async function launchOwnedNativeBackend({
  runId, imageReportPath, retainedUaaReportPath, label = randomBytes(6).toString('hex'),
  retainOwned = false, timeoutMs = 180000, workspace = defaultWorkspace, workflowReportPath, ebsxReportPath,
  platformReportPath, centralMemberReceiptPath,
  modelContextOverlay = false, r05OwnedModelCandidate, includeA01ParentlessAbsent = false,
}) {
  validateRun(runId, label);
  assert.equal(typeof modelContextOverlay, 'boolean', 'Model context overlay selection must be boolean');
  assert.equal(typeof includeA01ParentlessAbsent, 'boolean', 'A01 parentless route selection must be boolean');
  assert.ok(workflowReportPath, 'Explicit verified owned workflow schema report is required');
  assert.ok(ebsxReportPath, 'Explicit verified owned EBSX schema report is required');
  assert.ok(Number.isSafeInteger(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 600000);
  workspace = resolve(workspace);
  const directories = new PinnedDirectories();
  const base = join(workspace, '.artifacts/native-nonadmin-fixtures', runId);
  const output = join(base, `backend-runtime-${label}`);
  const created = [];
  let destination;
  let before;
  let resources;
  let r05OwnedModelBinding;
  let a01ParentlessBinding;
  const report = {
    contract: 'run-owned-native-backend-startup-v1', schemaVersion: 1, runId, label,
    status: 'failed', startedAt: new Date().toISOString(), inputs: [], checks: [], errors: [],
    sourceClosureVerified: false, nativeAcceptance: false, permissionAcceptance: false,
    actualBackendStarted: false, retainedPeerIntegrityVerified: false,
    applicationInitializationVerified: false, startupLogChecks: [],
    retainedOwned: false, services: {}, cleanup: [],
    limitations: [
      'Startup and exact deployment transport only; not permission, persistence, source-closure or release acceptance.',
      'Retained short-TTL UAA security evidence does not establish backend authorization or persistence.',
    ],
  };
  const docker = (args, allowFailure = false) => {
    const result = spawnSync('docker', args, {
      encoding: 'utf8', timeout: 60000, maxBuffer: 16 * 1024 * 1024,
    });
    if (!allowFailure) assert.ok(result.status === 0 && !result.error && !result.signal,
      'Owned Docker operation failed; private configuration and logs suppressed');
    return result;
  };
  const inspect = id => JSON.parse(docker(['inspect', id]).stdout)[0];
  const inspectNetwork = () => JSON.parse(docker(['network', 'inspect', resources.networkId]).stdout)[0];
  const read = (path, privateInput = false, parse = true) => {
    path = resolve(path);
    const child = relative(workspace, path);
    assert.ok(child && child !== '..' && !child.startsWith('../') && !child.startsWith('/'),
      'Input must remain in this workspace');
    const result = readPinnedFile(directories, directories.open(dirname(path)), basename(path));
    if (privateInput) assert.equal(result.identity.mode & 0o077, 0, 'Private input permissions are too broad');
    report.inputs.push({ path: child, bytes: result.data.length, sha256: hash(result.data) });
    if (!parse) return result.data;
    try { return JSON.parse(result.data); }
    catch { throw new Error('Input JSON is invalid; private values suppressed'); }
  };
  const write = (directory, name, bytes, readable = false) => {
    directories.write(directory, name, bytes);
    if (readable) fs.chmodSync(directories.entry(directory, name), 0o644);
  };
  const ensureNetwork = expectedPeers => {
    const network = inspectNetwork();
    verifyOwnedNetwork(manifest, resources, network, expectedPeers);
    return network;
  };
  let manifest;
  try {
    directories.open(base);
    destination = directories.open(output, { create: true, exclusive: true });
    manifest = read(join(base, 'manifest.json'));
    assert.equal(manifest.runId, runId);
    const sql = read(join(base, 'isolated-sql-report.json'));
    assert.equal(sql.inputs.modelSchemaSources?.length, 3, 'Explicit model-schema source bindings required');
    for (const source of sql.inputs.modelSchemaSources) {
      assert.ok(['DEFAULT', 'DB2', 'DB3'].includes(source.link));
      assert.equal(source.path, `${modelRelativePath}/PSSYSDBSCHEMES/${source.link}.json`);
      assert.equal(hash(read(join(workspace, source.path), false, false)), source.sha256,
        'Fixture model-schema source changed after SQL evidence');
    }
    validateFixtureReceipt(manifest, sql, report.inputs.find(row => row.path.endsWith('/manifest.json')).sha256);
    resources = read(join(base, 'owned-resources.json'));
    assert.equal(resources.mysqlId, sql.ownedMysqlId);
    assert.equal(resources.networkId, sql.ownedNetworkId);
    resources.mysqlImage ??= sql.mysqlImage;
    const retained = read(retainedUaaReportPath);
    assert.equal(retained.contract, 'run-owned-source-uaa-native-http-probe-v1');
    assert.equal(retained.runId, runId);
    assert.equal(retained.status, 'passed-scoped-native-uaa-http-only');
    assert.equal(retained.actualBootApplicationStarted, true);
    assert.equal(retained.actualHttpLoginVerified, true);
    assert.equal(retained.actualTokenSecurityVerified, true, 'Retained UAA requires real TokenStore security evidence');
    assert.equal(retained.retainedOwned, true);
    assert.ok(retained.checks.slice(0, 13).length === 13 &&
      retained.checks.slice(0, 13).every(row => row.status === 'pass'));
    assert.equal(retained.checks.length, 16, 'Require all login and stateful token security checks');
    assert.ok(retained.checks.every(row => row.status === 'pass'));
    assert.deepEqual(retained.checks.slice(13).map(row => row.id), [
      'signed-security-positive-control', 'tampered-signature-token-denied', 'expired-signed-token-denied',
    ]);
    assert.deepEqual(Object.keys(retained.services).sort(), ['redis', 'uaa']);
    before = [resources.mysqlId, retained.services.uaa.containerId, retained.services.redis.containerId].map(inspect);
    ensureNetwork(before.map(row => row.Id));
    for (const peer of before) {
      assert.match(peer.Id, idPattern);
      assert.equal(peer.State.Running, true);
      assert.equal(peer.Config.Labels?.[labelKey], runId);
      assert.equal(peer.HostConfig.Privileged, false);
      assert.ok(!peer.HostConfig.CapAdd?.length);
      assert.deepEqual(Object.keys(peer.NetworkSettings.Networks), [manifest.ownership.network]);
      assert.equal(peer.NetworkSettings.Networks[manifest.ownership.network].NetworkID, resources.networkId);
      assert.ok(Object.values(peer.HostConfig.PortBindings ?? {}).every(row => row === null));
      assert.ok(Object.values(peer.NetworkSettings.Ports ?? {}).every(row => row === null));
    }
    assert.equal(before[0].Image, resources.mysqlImage);
    verifySelectedMysqlStorage(resources.databaseProfile, before[0], {
      storage: resources.databaseStorage, volumes: inspectMysqlFixtureVolumes(resources),
    });
    for (const [role, container] of [['uaa', before[1]], ['redis', before[2]]]) {
      assert.equal(container.Image, retained.services[role].imageId);
    }
    const uaaMount = before[1].Mounts.filter(mount =>
      mount.Type === 'bind' && mount.RW === false && mount.Destination === '/opt/uaa/config');
    assert.equal(uaaMount.length, 1, 'Retained UAA configuration must be bound once');
    assert.equal(uaaMount[0].Source, join(dirname(resolve(retainedUaaReportPath)), 'config'));
    const retainedConfiguration = parseJavaProperties(read(join(uaaMount[0].Source, 'application.properties'), false, false));
    const accountInput = readApplicationAccountInput({
      workspace, runId, label: retained.applicationAccounts?.label, manifest,
    });
    assert.deepEqual(accountInput.binding, retained.applicationAccounts, 'Retained UAA account binding changed');
    const accounts = accountInput.accounts;
    report.applicationAccounts = accountInput.binding;
    const credentials = read(join(base, 'credentials.private.json'), true);
    const names = ownedBackendNames(runId, label, {
      uaa: before[1].Name.slice(1), redis: before[2].Name.slice(1),
    });
    const existingNames = new Set(docker(['container', 'ls', '--all', '--format', '{{.Names}}']).stdout.trim().split('\n'));
    for (const role of ['nacos', 'zookeeper', 'allinone', 'provider', 'gateway']) {
      assert.ok(!existingNames.has(names[role]), 'Backend container name already exists');
    }
    const imageReceipt = verifyBackendSourceImages({ workspace, reportPath: resolve(imageReportPath) });
    const cloudUaaSource = bindOwnedCloudUaaSource({
      workspace, images: imageReceipt.report, read: path => read(resolve(workspace, path), false, false),
    });
    report.cloudUaaAliasSource = cloudUaaSource;
    report.inputs.push({ path: relative(workspace, imageReceipt.reportPath), sha256: imageReceipt.reportSha256 });
    const nacosImage = JSON.parse(docker(['image', 'inspect', NACOS_IMAGE_ID]).stdout)[0];
    assert.equal(nacosImage.Id, NACOS_IMAGE_ID);
    assert.equal(nacosImage.Os, 'linux');
    assert.equal(nacosImage.Architecture, imageReceipt.report.base.architecture);
    assert.deepEqual(Object.keys(nacosImage.Config.Volumes ?? {}), []);
    assert.deepEqual(nacosImage.Config.Entrypoint, ['/usr/local/bin/nacos-jre17-startup.sh']);
    const zooImage = JSON.parse(docker(['image', 'inspect', ZOOKEEPER_IMAGE_ID]).stdout)[0];
    assert.equal(zooImage.Id, ZOOKEEPER_IMAGE_ID);
    assert.equal(zooImage.Os, 'linux');
    assert.equal(zooImage.Architecture, imageReceipt.report.base.architecture);
    assert.deepEqual(Object.keys(zooImage.Config.Volumes ?? {}).sort(), ['/data', '/datalog', '/logs']);
    assert.deepEqual(zooImage.Config.Entrypoint, ['/docker-entrypoint.sh']);
    const { createOwnedBackendConfiguration } = await import('./run-owned-backend-configuration.mjs');
    const workflowInput = readOwnedWorkflowConfiguration({
      workspace, runId, reportPath: workflowReportPath, packageReceipt: imageReceipt.report.packageReceipt,
    });
    report.workflowSchema = workflowInput.binding;
    const ebsxInput = readOwnedEbsxConfiguration({
      workspace, runId, reportPath: ebsxReportPath, packageReceipt: imageReceipt.report.packageReceipt,
    });
    report.ebsxSchema = ebsxInput.binding;
    const platformInput = platformReportPath === undefined ? undefined : readOwnedPlatformConfiguration({
      workspace, runId, reportPath: platformReportPath, packageReceipt: imageReceipt.report.packageReceipt,
    });
    if (platformInput) report.platformSchema = platformInput.binding;
    const model = stageOwnedModelInput({
      directories, source: join(workspace, modelRelativePath), outputPath: join(output, 'model-input'),
      workspace, centralMemberReceiptPath,
      modelContextOverlay, r05OwnedModelCandidate,
    });
    const modelDirectory = model.directory;
    report.modelInput = { source: modelRelativePath, files: model.files, bytes: model.bytes,
      fingerprint: model.fingerprint, stagedPath: relative(workspace, modelDirectory.path) };
    if (model.centralMemberBinding) report.modelInput.centralMemberBinding = model.centralMemberBinding;
    if (model.modelContextOverlay) report.modelInput.modelContextOverlay = model.modelContextOverlay;
    if (model.sourceFingerprint) report.modelInput.sourceFingerprint = model.sourceFingerprint;
    if (model.r05OwnedModelBinding) {
      r05OwnedModelBinding = model.r05OwnedModelBinding;
      report.modelInput.r05OwnedModelBinding = r05OwnedModelBinding;
    }
    const workflowReport = read(workflowReportPath);
    const helperImage = JSON.parse(docker(['image', 'inspect', workflowReport.image.reference]).stdout)[0];
    assert.equal(helperImage.Id, workflowReport.image.id);
    assert.equal(helperImage.Architecture, imageReceipt.report.base.architecture);
    const applicationRouting = probeOwnedModelingApplicationRoutes({
      workspace, runId, label, imageId: helperImage.Id,
      dependencies: join(dirname(resolve(workspace, workflowReportPath)), 'dependencies'),
      modelPath: modelDirectory.path, outputPath: join(output, 'model-route-probe'), directories, docker,
    });
    assert.equal(applicationRouting.modelFingerprint, model.fingerprint);
    report.modelingApplicationRouting = applicationRouting;
    if (includeA01ParentlessAbsent) {
      a01ParentlessBinding = bindOwnedA01ParentlessRoutes({
        workspace, runId, modelPath: modelDirectory.path, images: imageReceipt.report,
        read: path => read(resolve(workspace, path), false, false),
        r05OwnedModelBinding,
      });
      report.a01ParentlessRoutes = a01ParentlessBinding;
    }
    const configuration = createOwnedBackendConfiguration({
      manifest, accounts, credentials, retainedUaaConfiguration: retainedConfiguration, names,
      workflow: workflowInput.configuration,
      ebsx: ebsxInput.configuration,
      platform: platformInput?.configuration,
      modelingRouteProbe: applicationRouting.probe,
      centralMemberBinding: model.centralMemberBinding,
      includeA01ParentlessAbsent,
      a01ParentlessBinding,
    });
    assert.deepEqual(Object.keys(configuration.services).sort(), ['allinone', 'gateway', 'provider']);
    const configPaths = {};
    for (const role of ['allinone', 'provider', 'gateway']) {
      const config = directories.open(join(output, `${role}-config`), { create: true });
      const values = configuration.services[role];
      assert.equal(Number(values['server.port']), BACKEND_PORTS[role], 'Backend port must be explicit');
      write(config, 'application.properties', javaProperties(values), true);
      write(config, 'logback.xml', UAA_CONSOLE_LOGGING, true);
      configPaths[role] = {
        configPath: join(config.path, 'application.properties'), loggingPath: join(config.path, 'logback.xml'),
      };
    }
    write(destination, 'nacos-configs.private.json', json(configuration.nacosConfigs));
    const launch = (role, imageId, command) => {
      if (r05OwnedModelBinding) verifyStagedR05OwnedModelBinding(r05OwnedModelBinding);
      ensureNetwork([...before.map(row => row.Id), ...created.map(row => row.id)]);
      const id = docker(command).stdout.trim();
      assert.match(id, idPattern);
      created.push({ id, role, imageId, name: names[role] });
      const container = inspect(id);
      verifyProbeContainer(container, {
        imageId, runId, networkId: resources.networkId,
        networkName: manifest.ownership.network, name: names[role],
      });
      assert.equal(container.Config.Labels?.[launchLabelKey], label);
      if (role === 'zookeeper') verifyOwnedZookeeper(container, runId, label);
      ensureNetwork([...before.map(row => row.Id), ...created.map(row => row.id)]);
      return container;
    };
    const checkBackendLog = (peer, phase) => {
      const result = docker(['logs', peer.id], true);
      assert.ok(result.status === 0 && !result.error && !result.signal, 'Cannot inspect backend startup log');
      const text = `${result.stdout ?? ''}${result.stderr ?? ''}`;
      const row = { role: peer.role, phase, status: 'fail', bytes: Buffer.byteLength(text), sha256: hash(text) };
      report.startupLogChecks.push(row);
      verifyBackendStartupLog(peer.role, text);
      row.status = 'pass';
    };
    const wait = async (container, port, nacos = false) => {
      const network = ensureNetwork([...before.map(row => row.Id), ...created.map(row => row.id)]);
      const origin = privateContainerOrigin(container, network, port);
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        assert.equal(inspect(container.Id).State.Running, true, 'Owned service exited during startup');
        try {
          const result = await http(origin, nacos ? '/nacos/v1/console/health/readiness' : '/actuator/health');
          if (nacos ? result.status === 200 : [200, 401, 404].includes(result.status)) {
            report.checks.push({ id: `${container.Name.slice(1)}-http-transport`,
              status: 'pass', httpStatus: result.status, responseSha256: hash(result.bytes) });
            return origin;
          }
        } catch {}
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
      throw new Error('Owned service did not expose its HTTP transport within the startup deadline');
    };
    const shared = { runId, label, networkName: manifest.ownership.network };
    const zookeeper = launch('zookeeper', ZOOKEEPER_IMAGE_ID, zookeeperRunCommand({
      ...shared, name: names.zookeeper, imageId: ZOOKEEPER_IMAGE_ID,
    }));
    const zooDeadline = Date.now() + timeoutMs;
    for (;;) {
      verifyOwnedZookeeper(inspect(zookeeper.Id), runId, label);
      ensureNetwork([...before.map(row => row.Id), ...created.map(row => row.id)]);
      const result = docker(['exec', '--user', '65532:65532', zookeeper.Id, 'zkServer.sh', 'status'], true);
      try {
        verifyZookeeperReadiness(result);
        report.checks.push({ id: 'owned-zookeeper-standalone-ready', status: 'pass',
          containerId: zookeeper.Id, imageId: ZOOKEEPER_IMAGE_ID, responseSha256: hash(result.stdout) });
        break;
      } catch {
        assert.ok(Date.now() < zooDeadline, 'Owned ZooKeeper readiness deadline exceeded');
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }
    const nacos = launch('nacos', NACOS_IMAGE_ID, nacosRunCommand({
      ...shared, name: names.nacos, imageId: NACOS_IMAGE_ID,
    }));
    const nacosOrigin = await wait(nacos, 8848, true);
    if (a01ParentlessBinding) verifyOwnedA01ParentlessRouteBinding(a01ParentlessBinding);
    report.nacosConfigurationBindings = await publishOwnedNacos(nacosOrigin, configuration.nacosConfigs);
    const registryNetwork = ensureNetwork([...before.map(row => row.Id), ...created.map(row => row.id)]);
    const uaaOrigin = privateContainerOrigin(inspect(retained.services.uaa.containerId), registryNetwork, 32666);
    report.nacosServiceAliases = [await publishOwnedUaaAlias(nacosOrigin,
      ownedUaaAlias({ runId, origin: uaaOrigin }), {
        request: http,
        guard: () => ensureNetwork([...before.map(row => row.Id), ...created.map(row => row.id)]),
      })];
    for (const role of ['allinone', 'provider', 'gateway']) {
      const imageId = imageReceipt.report.components.find(row => row.name === role).image.id;
      const container = launch(role, imageId, backendRunCommand({
        ...shared, role, name: names[role], imageId, ...configPaths[role],
        modelPath: modelDirectory.path, mysqlName: manifest.ownership.mysqlContainer, nacosName: names.nacos,
      }));
      await wait(container, BACKEND_PORTS[role]);
      checkBackendLog(created.find(peer => peer.id === container.Id), 'after-http');
      report.services[role] = { containerId: container.Id, imageId };
      if (role === 'allinone') {
        const cloudUaaNetwork = ensureNetwork([...before.map(row => row.Id), ...created.map(row => row.id)]);
        const alias = ownedCloudUaaAlias({ runId,
          origin: privateContainerOrigin(container, cloudUaaNetwork, 30000),
          target: { containerId: container.Id, imageId, name: names.allinone },
          sourceFingerprint: cloudUaaSource.fingerprint });
        report.nacosServiceAliases.push(await publishOwnedUaaAlias(nacosOrigin, alias, {
          request: http,
          guard: () => {
            ensureNetwork([...before.map(row => row.Id), ...created.map(row => row.id)]);
            verifyRetainedPeer(container, inspect(container.Id));
            assert.deepEqual(bindOwnedCloudUaaSource({
              workspace, images: imageReceipt.report, read: path => read(resolve(workspace, path), false, false),
            }), cloudUaaSource, 'Cloud UAA source/package binding changed before alias publication');
          },
        }));
      }
    }
    for (const peer of created.filter(peer => Object.hasOwn(BACKEND_PORTS, peer.role))) {
      checkBackendLog(peer, 'whole-deployment-recheck');
    }
    report.services.uaa = retained.services.uaa;
    const auxiliaryContainers = [
      { ...retained.services.redis, role: 'redis' },
      { containerId: nacos.Id, imageId: NACOS_IMAGE_ID, role: 'nacos' },
      { containerId: zookeeper.Id, imageId: ZOOKEEPER_IMAGE_ID, role: 'zookeeper' },
    ];
    const network = ensureNetwork([...before.map(row => row.Id), ...created.map(row => row.id)]);
    const containers = [...before.map(row => inspect(row.Id)), ...created.map(row => inspect(row.id))];
    verifyRetainedPeers(before, containers.filter(row => before.some(peer => peer.Id === row.Id)));
    report.retainedPeerIntegrityVerified = true;
    const deployment = deploymentInput({
      manifest, resources, imageReceipt, services: report.services, auxiliaryContainers, containers, network,
      volumes: inspectMysqlFixtureVolumes(resources),
      r05OwnedModelBinding,
    });
    write(destination, 'deployment-input.private.json', json(deployment));
    report.deploymentInput = { path: relative(workspace, join(output, 'deployment-input.private.json')),
      sha256: hash(json(deployment)) };
    report.actualBackendStarted = true;
    report.status = 'passed-owned-backend-http-transport-only';
  } catch (error) {
    report.errors.push('Required owned deployment preflight, staging, startup or transport check failed; see private logs.');
    if (destination) write(destination, 'failure.private.log', `${error.stack ?? error.message}\n`);
  } finally {
    if (a01ParentlessBinding) {
      try {
        verifyOwnedA01ParentlessRouteBinding(a01ParentlessBinding);
        report.a01ParentlessRoutesReverified = true;
      } catch {
        report.status = 'failed';
        report.actualBackendStarted = false;
        report.a01ParentlessRoutesReverified = false;
        report.errors.push('A01 parentless source/model/package input changed; runtime acceptance is blocked.');
      }
    }
    if (r05OwnedModelBinding) {
      try {
        verifyStagedR05OwnedModelBinding(r05OwnedModelBinding);
        report.r05OwnedModelInputReverified = true;
      } catch {
        report.status = 'failed';
        report.actualBackendStarted = false;
        report.r05OwnedModelInputReverified = false;
        report.errors.push('R05 owned model input changed after staging; runtime acceptance is blocked.');
      }
    }
    for (const peer of created) {
      if (destination) {
        try {
          const finalInspection = inspect(peer.id);
          assert.equal(finalInspection.Name, `/${peer.name}`);
          assert.equal(finalInspection.Image, peer.imageId);
          assert.equal(finalInspection.Config.Labels?.[labelKey], runId);
          write(destination, `${peer.role}-inspection.private.json`, json(finalInspection));
          verifyBackendFinalState(finalInspection);
        } catch {
          report.status = 'failed';
          report.actualBackendStarted = false;
          report.errors.push(`Final ${peer.role} inspection was unavailable; cleanup remains ownership-guarded.`);
        }
        const result = docker(['logs', peer.id], true);
        const text = `${result.stdout ?? ''}${result.stderr ?? ''}`;
        write(destination, `${peer.role}.private.log`, text);
        if (Object.hasOwn(BACKEND_PORTS, peer.role)) {
          try {
            assert.ok(result.status === 0 && !result.error && !result.signal);
            const binding = verifyBackendStartupLog(peer.role, text);
            report.startupLogChecks.push({ role: peer.role, phase: 'final-log', status: 'pass', ...binding });
          } catch {
            report.startupLogChecks.push({ role: peer.role, phase: 'final-log', status: 'fail',
              bytes: Buffer.byteLength(text), sha256: hash(text) });
            report.status = 'failed';
            report.actualBackendStarted = false;
            report.errors.push(`Fatal or unavailable ${peer.role} startup log; HTTP transport is not initialization proof.`);
          }
        }
        if (peer.role === 'nacos') {
          const details = docker(['exec', peer.id, 'sh', '-c',
            'for f in /home/nacos/logs/protocol-raft.log /home/nacos/logs/alipay-jraft.log; do if [ -f "$f" ]; then tail -c 262144 "$f"; fi; done'], true);
          write(destination, 'nacos-raft.private.log', `${details.stdout ?? ''}${details.stderr ?? ''}`);
        }
      }
    }
    if (!retainOwned || report.status !== 'passed-owned-backend-http-transport-only') {
      for (const peer of created.toReversed()) {
        try {
          const current = inspect(peer.id);
          assert.equal(current.Name, `/${peer.name}`);
          assert.equal(current.Image, peer.imageId);
          assert.equal(current.Config.Labels?.[labelKey], runId);
          assert.equal(current.Config.Labels?.[launchLabelKey], label);
          const result = docker(['rm', '--force', peer.id], true);
          report.cleanup.push({ containerId: peer.id, role: peer.role, removed: result.status === 0 });
          assert.equal(result.status, 0);
        } catch { report.errors.push('Run-owned backend cleanup failed; no retained peer was removed.'); }
      }
    }
    report.retainedOwned = retainOwned && report.status === 'passed-owned-backend-http-transport-only';
    if (before) {
      try {
        verifyRetainedPeers(before, before.map(peer => inspect(peer.Id)));
        report.retainedPeerIntegrityVerified = true;
        verifyOwnedNetwork(manifest, resources, inspectNetwork(),
          [...before.map(peer => peer.Id), ...(report.retainedOwned ? created.map(peer => peer.id) : [])]);
      } catch {
        report.retainedPeerIntegrityVerified = false;
        report.status = 'failed';
        report.errors.push('Retained peer or private network integrity changed; final acceptance is blocked.');
      }
    }
    report.finishedAt = new Date().toISOString();
    if (destination) {
      write(destination, 'report.json', json(report));
      write(destination, 'report.sha256', `${hash(json(report))}\n`);
    }
    directories.close();
  }
  return { report, reportPath: destination ? join(output, 'report.json') : null };
}

export async function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({
    args: argv, options: {
      'execute-owned-backend': { type: 'boolean' }, 'run-id': { type: 'string' },
      'image-report': { type: 'string' }, 'retained-uaa-report': { type: 'string' },
      'workflow-report': { type: 'string' },
      'ebsx-report': { type: 'string' },
      'platform-report': { type: 'string' },
      'central-member-receipt': { type: 'string' },
      'model-context-overlay': { type: 'boolean' },
      'r05-owned-model': { type: 'string' },
      'include-parentless-absent': { type: 'boolean' },
      label: { type: 'string' }, 'retain-owned': { type: 'boolean' },
      'timeout-ms': { type: 'string' },
    },
  });
  assert.equal(values['execute-owned-backend'], true, 'Explicit owned backend execution required');
  assert.ok(values['run-id'] && values['image-report'] && values['retained-uaa-report']);
  const result = await launchOwnedNativeBackend({
    runId: values['run-id'], imageReportPath: values['image-report'],
    retainedUaaReportPath: values['retained-uaa-report'], label: values.label,
    retainOwned: values['retain-owned'], timeoutMs: values['timeout-ms'] ? Number(values['timeout-ms']) : undefined,
    workflowReportPath: values['workflow-report'],
    ebsxReportPath: values['ebsx-report'],
    platformReportPath: values['platform-report'],
    centralMemberReceiptPath: values['central-member-receipt'],
    modelContextOverlay: values['model-context-overlay'],
    r05OwnedModelCandidate: values['r05-owned-model'],
    includeA01ParentlessAbsent: values['include-parentless-absent'],
  });
  console.log(json({ reportPath: result.reportPath, status: result.report.status,
    actualBackendStarted: result.report.actualBackendStarted, nativeAcceptance: false }));
  return result.report.status === 'passed-owned-backend-http-transport-only' ? 0 : 1;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().then(code => { process.exitCode = code; }).catch(() => {
    console.error('Owned backend launch failed; private inputs suppressed.');
    process.exitCode = 1;
  });
}
