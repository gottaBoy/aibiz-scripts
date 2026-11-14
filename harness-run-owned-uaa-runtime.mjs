#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import fs from 'node:fs';
import { isIP } from 'node:net';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { PinnedDirectories, readPinnedFile } from './native-candidate-files.mjs';
import { validateMatrixFixture } from './prepare-run-owned-native-nonadmin-matrix.mjs';
import { readApplicationAccountInput, validateFixtureReceipt } from './provision-run-owned-native-application-accounts.mjs';
import { verifyUAAIdentity } from './run-owned-native-permission-http.mjs';
import { prepareOwnedTokenWitness } from './owned-uaa-token-witness.mjs';
import { verifySelectedMysqlStorage } from './mysql-fixture-profiles.mjs';
import { inspectMysqlFixtureVolumes } from './owned-mysql-volume.mjs';

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const imagePattern = /^sha256:[a-f0-9]{64}$/;
const ownershipLabel = 'aibiz.native-fixture.run';
export const UAA_ENTRYPOINT = Object.freeze([
  'java', '-Djava.awt.headless=true', '-cp',
  '/opt/uaa/third-party/*:/opt/uaa/starters/*:/opt/uaa/packages/*', 'cn.ibizlab.BootApplication',
]);
export const REDIS_IMAGE_ID =
  'sha256:59c08762bdbcf53fa132aa0bae464a57a1309dc3fff8a034bb3e16d7a0b30ec5';
export const UAA_JAVA_OPTIONS = [
  '-Xms128m', '-Xmx1024m', '-XX:ActiveProcessorCount=2',
  '-Dspring.cloud.bootstrap.enabled=false',
  '-Dspring.cloud.nacos.config.enabled=false',
  '-Dspring.cloud.nacos.discovery.enabled=false',
  '-Dspring.cloud.discovery.enabled=false',
  '-Deureka.client.enabled=false',
  '-Dlogging.config=file:/opt/uaa/config/logback.xml',
  '-Dcom.sun.xml.bind.v2.bytecode.ClassTailor.noOptimize=true',
].join(' ');
export const UAA_CONSOLE_LOGGING = `<?xml version="1.0" encoding="UTF-8"?>
<configuration>
  <appender name="Console" class="ch.qos.logback.core.ConsoleAppender">
    <encoder><pattern>%d{yyyy-MM-dd HH:mm:ss.SSS} [%-5level] %logger{40} : %msg%n</pattern></encoder>
  </appender>
  <root level="INFO"><appender-ref ref="Console" /></root>
</configuration>
`;

export function runtimeConfiguration(manifest, accountConfiguration, redisName, jwtSecret) {
  validateMatrixFixture(manifest);
  assert.equal(manifest.passwordStorageMode, 'sm3', 'This probe requires the declared SM3 fixture');
  assert.match(redisName, /^nf-[a-f0-9]{12}-uaa-[a-z0-9-]+-redis$/);
  assert.ok(redisName.startsWith(`nf-${manifest.runId}-uaa-`), 'Redis must belong to this fixture');
  assert.match(jwtSecret, /^[a-f0-9]{64}$/);
  const uaa = accountConfiguration.uaa;
  assert.equal(uaa['spring.datasource.username'], `nf_${manifest.runId}_uaa_app`);
  assert.equal(uaa['spring.datasource.defaultSchema'], manifest.schemas.uaa);
  assert.ok(/^[a-f0-9]{36}$/.test(uaa['spring.datasource.password']),
    'Invalid private scoped application password');
  assert.equal(uaa['spring.datasource.url'],
    `jdbc:mysql://${manifest.ownership.mysqlContainer}:3306/${manifest.schemas.uaa}?useUnicode=true&characterEncoding=UTF-8&useSSL=false`);
  const values = {
    ...uaa,
    'spring.profiles.include': 'sys,api,dev',
    'spring.profiles.active': 'isolated-native',
    'spring.cloud.bootstrap.enabled': false,
    'spring.cloud.nacos.config.enabled': false,
    'spring.cloud.nacos.discovery.enabled': false,
    'spring.cloud.discovery.enabled': false,
    'eureka.client.enabled': false,
    'spring.main.allow-bean-definition-overriding': true,
    'spring.main.allow-circular-references': true,
    'spring.liquibase.enabled': false,
    'spring.datasource.isSyncDBSchema': false,
    'spring.datasource.dynamic.datasource.master.isSyncDBSchema': false,
    'spring.datasource.driver-class-name': 'com.mysql.jdbc.Driver',
    'spring.redis.host': redisName,
    'spring.redis.port': 6379,
    'spring.redis.database': 0,
    'ibiz.cacheLevel': 'L2',
    'ibiz.auth.passwordStorageMode': 'sm3',
    'ibiz.auth.passwordEncryptMode': 'none',
    'ibiz.auth.imageCaptcha.enable': false,
    'ibiz.ref.service.rt.version': 'ISOLATED_NATIVE_NO_SYNC',
    'ibiz.jwt.signature': 'MAC',
    'ibiz.jwt.secret': jwtSecret,
    'ibiz.jwt.expiration': 7200000,
    'server.port': 32666,
    'server.uaa.port': 32666,
    'jobs.enabled': false,
    'logging.level.cn.ibizlab': 'INFO',
  };
  return values;
}

export function javaProperties(values) {
  return Object.entries(values).sort(([a], [b]) => a.localeCompare(b)).map(([key, value]) => {
    assert.match(key, /^[A-Za-z0-9_.-]+$/, 'Unsafe configuration key');
    assert.ok(['string', 'boolean', 'number'].includes(typeof value), 'Scalar configuration required');
    const text = String(value);
    assert.ok(!/[\r\n\0]/.test(text), 'Configuration cannot contain a new property');
    return `${key}=${text.replaceAll('\\', '\\\\').replace(/^ /, '\\ ')}\n`;
  }).join('');
}

export function parseJavaProperties(bytes) {
  const text = Buffer.isBuffer(bytes) ? bytes.toString('utf8') : String(bytes);
  const values = {};
  for (const [index, line] of text.split(/\r?\n/).entries()) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('!')) continue;
    const match = /^([A-Za-z0-9_.-]+)=(.*)$/.exec(line);
    assert.ok(match, `Invalid Java properties line ${index + 1}`);
    const [, key, value] = match;
    assert.equal(values[key], undefined, `Duplicate Java properties key: ${key}`);
    values[key] = value.replaceAll('\\\\', '\\');
  }
  return values;
}

function base64urlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

export function signedMacToken(secret, claims, header = { alg: 'HS512', cty: 'JWS' }) {
  assert.match(secret, /^[a-f0-9]{64}$/);
  assert.equal(header.alg, 'HS512');
  const payload = base64urlJson(claims);
  const signingInput = `${base64urlJson(header)}.${payload}`;
  const signature = createHmac('sha512', secret).update(signingInput).digest('base64url');
  return `${signingInput}.${signature}`;
}

export function tamperTokenSignature(token) {
  const parts = token.split('.');
  assert.equal(parts.length, 3);
  const last = parts[2];
  assert.ok(last.length > 0);
  const replacement = last[0] === 'A' ? 'B' : 'A';
  return `${parts[0]}.${parts[1]}.${replacement}${last.slice(1)}`;
}

export function securityTokenVariants(token, secret, now = Math.floor(Date.now() / 1000)) {
  assert.match(secret, /^[a-f0-9]{64}$/);
  assert.match(token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.ok(Number.isSafeInteger(now) && now > 7200);
  const [headerPart, payloadPart, signaturePart] = token.split('.');
  const header = JSON.parse(Buffer.from(headerPart, 'base64url'));
  const claims = JSON.parse(Buffer.from(payloadPart, 'base64url'));
  assert.equal(header.alg, 'HS512');
  assert.ok(typeof claims.sub === 'string' && claims.sub.length > 0);
  assert.ok(Number.isSafeInteger(claims.iat) && claims.iat <= now);
  assert.ok(Number.isSafeInteger(claims.exp) && claims.exp > now,
    'Security negatives require a current authenticated token');
  const actual = Buffer.from(signaturePart, 'base64url');
  const expected = createHmac('sha512', secret).update(`${headerPart}.${payloadPart}`).digest();
  assert.equal(actual.length, expected.length);
  assert.ok(timingSafeEqual(actual, expected), 'Signing secret does not match the running UAA');
  // OAuth2 stores the exact issued token; re-signing creates an unstored token.
  return { valid: token, tampered: tamperTokenSignature(token), expiresAt: claims.exp };
}

export function verifyCandidate(report, image) {
  assert.equal(report.contract, 'standalone-uaa-recovered-source-runtime-packaging-v1');
  assert.equal(report.status, 'runtime-image-byte-bound-not-started-not-native-accepted');
  assert.equal(report.nativeAcceptance, false);
  assert.equal(report.sourceClosureVerified, false);
  assert.deepEqual(report.errors, []);
  assert.match(report.image.id, imagePattern);
  assert.equal(image.Id, report.image.id);
  assert.deepEqual(image.Config.Entrypoint, UAA_ENTRYPOINT);
  assert.equal(image.Config.User, '65532:65532');
  assert.equal(image.Config.Labels['aibiz.source-build-receipt-sha256'], report.inputBuild.sha256);
  assert.equal(image.Config.Labels['aibiz.source-fingerprint'], report.sourceFingerprint);
  assert.deepEqual(report.binding.actual, report.binding.expected, 'Packaged runtime bytes differ');
  assert.ok(report.binding.expected.length > 0);
}

export function verifyOwnedNetwork(manifest, resources, network, expectedPeers) {
  validateMatrixFixture(manifest);
  assert.equal(resources.runId, manifest.runId);
  assert.equal(network.Id, resources.networkId);
  assert.equal(network.Name, manifest.ownership.network);
  assert.equal(network.Internal, true);
  assert.equal(network.Driver, 'bridge');
  assert.equal(network.Labels?.[ownershipLabel], manifest.runId);
  assert.deepEqual(Object.keys(network.Containers).sort(), expectedPeers.toSorted(),
    'Do not attach to a network with undeclared or shared peers');
}

export function verifyProbeContainer(container, { imageId, runId, networkId, networkName, name }) {
  assert.equal(container.Name, `/${name}`);
  assert.equal(container.Image, imageId);
  assert.equal(container.State.Running, true);
  assert.equal(container.Config.Labels?.[ownershipLabel], runId);
  assert.equal(container.HostConfig.Privileged, false);
  assert.equal(container.HostConfig.ReadonlyRootfs, true);
  assert.ok(!container.HostConfig.CapAdd?.length);
  assert.ok(container.HostConfig.SecurityOpt?.includes('no-new-privileges'));
  assert.deepEqual(Object.keys(container.NetworkSettings.Networks), [networkName]);
  assert.equal(container.NetworkSettings.Networks[networkName].NetworkID, networkId);
  for (const entries of Object.values(container.HostConfig.PortBindings ?? {})) {
    for (const binding of entries ?? []) assert.equal(binding.HostIp, '127.0.0.1');
  }
}

function ipv4Number(address) {
  assert.equal(isIP(address), 4, 'Private service requires an unambiguous IPv4 address');
  return address.split('.').reduce((value, byte) => value * 256 + Number(byte), 0);
}

export function privateContainerOrigin(container, network, containerPort) {
  assert.ok(Number.isInteger(containerPort) && containerPort > 0 && containerPort <= 65535,
    'Invalid private container port');
  assert.equal(network.Internal, true);
  assert.equal(network.Driver, 'bridge');
  assert.match(container.Id ?? '', /^[a-f0-9]{64}$/);
  const networks = container.NetworkSettings?.Networks ?? {};
  assert.deepEqual(Object.keys(networks), [network.Name], 'Private service must have one owned network');
  const endpoint = networks[network.Name];
  assert.equal(endpoint.NetworkID, network.Id);
  assert.match(endpoint.EndpointID ?? '', /^[a-f0-9]{64}$/);
  const address = endpoint.IPAddress;
  const ip = ipv4Number(address);
  assert.ok(address.startsWith('10.') || address.startsWith('192.168.')
    || (address.startsWith('172.') && Number(address.split('.')[1]) >= 16
      && Number(address.split('.')[1]) <= 31), 'Inspected bridge address must be private');
  const peer = network.Containers?.[container.Id];
  assert.ok(peer, 'Target must be an exact inspected network peer');
  assert.equal(peer.Name, container.Name.slice(1));
  assert.equal(peer.EndpointID, endpoint.EndpointID);
  assert.equal(peer.IPv4Address, `${address}/${endpoint.IPPrefixLen}`);
  const subnet = network.IPAM?.Config?.find(row =>
    row.Subnet?.endsWith(`/${endpoint.IPPrefixLen}`)
      && (!endpoint.Gateway || row.Gateway === endpoint.Gateway)
      && Math.floor(ip / 2 ** (32 - endpoint.IPPrefixLen))
        === Math.floor(ipv4Number(row.Subnet.split('/')[0]) / 2 ** (32 - endpoint.IPPrefixLen)));
  assert.ok(subnet, 'Container subnet must match the inspected bridge IPAM');
  assert.ok(Number.isInteger(endpoint.IPPrefixLen) && endpoint.IPPrefixLen > 0
    && endpoint.IPPrefixLen <= 30);
  const block = 2 ** (32 - endpoint.IPPrefixLen);
  const base = ipv4Number(subnet.Subnet.split('/')[0]);
  assert.equal(base % block, 0, 'Bridge subnet must have an exact network address');
  assert.ok(ip > base && ip < base + block - 1, 'Container IP must be inside its bridge subnet');
  assert.notEqual(address, subnet.Gateway, 'Do not connect to the bridge gateway');
  assert.ok(Object.values(container.HostConfig.PortBindings ?? {}).every(row => row === null),
    'Private HTTP transport cannot publish a host port');
  assert.ok(Object.values(container.NetworkSettings.Ports ?? {}).every(row => row === null),
    'Private HTTP transport cannot use published ports');
  return `http://${address}:${containerPort}`;
}

async function request(origin, path, { method = 'GET', body, token } = {}) {
  const response = await fetch(`${origin}${path}`, {
    method, redirect: 'error', signal: AbortSignal.timeout(10_000),
    headers: {
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  let data;
  try { data = JSON.parse(bytes); } catch {}
  return { status: response.status, data, responseSha256: digest(bytes) };
}

export function verifyNoDeniedIdentity(data) {
  const forbidden = new Set([
    'token', 'accesstoken', 'refreshtoken', 'user', 'users', 'grants', 'roles', 'authorities',
    'id', 'userid', 'personid', 'dc', 'centerid', 'username', 'loginname', 'displayname',
    'adminmode', 'superuser', 'apiuser', 'organizationid', 'departmentid', 'memberof',
  ]);
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      assert.ok(!forbidden.has(key.replaceAll('_', '').toLowerCase()),
        'Denied response must not expose authenticated identity or privileges');
      visit(child);
    }
  };
  visit(data);
}

function verifyStoredWitness(witness, token, user) {
  assert.ok(witness && typeof witness === 'object', 'Real TokenStore evidence is required');
  assert.equal(witness.tokenSha256, digest(token), 'TokenStore witness must bind exact HTTP token bytes');
  assert.equal(witness.stored, true, 'A store miss cannot prove signature or expiry rejection');
  assert.equal(witness.authenticationUsername, `${user.loginname}|${user.centerId}`);
  assert.ok(Number.isSafeInteger(witness.expiresAt) && witness.expiresAt > Date.now(),
    'Store metadata must remain current to distinguish JWT expiry');
  return witness;
}

export async function probeUaaHttp(origin, manifest, credentials, onCheck = () => {},
  { jwtSecret, securityStore, maxExpiryWaitMs = 0 } = {}) {
  const checks = [];
  const check = async (id, work) => {
    const row = { id, status: 'fail' };
    try {
      Object.assign(row, await work());
      row.status = 'pass';
    } catch (error) {
      row.reason = `Required HTTP status, token or scoped identity contract failed: ${error.message}`;
    }
    checks.push(row);
    onCheck(row);
  };
  await check('anonymous-user-info-self-denied', async () => {
    const response = await request(origin, '/auths/user-info/self');
    assert.equal(response.status, 401);
    verifyNoDeniedIdentity(response.data);
    return { httpStatus: response.status, responseSha256: response.responseSha256 };
  });
  for (const user of manifest.users) {
    await check(`${user.loginname}-wrong-password-denied`, async () => {
      const response = await request(origin, '/auths/login', {
        method: 'POST', body: { loginname: user.loginname, password: 'invalid-fixture-password', dc: user.centerId },
      });
      assert.ok([400, 401, 403].includes(response.status), 'Server/transport errors do not prove password denial');
      verifyNoDeniedIdentity(response.data);
      return { httpStatus: response.status, responseSha256: response.responseSha256 };
    });
    await check(`${user.loginname}-login-and-self`, async () => {
      const response = await request(origin, '/auths/login', {
        method: 'POST', body: {
          loginname: user.loginname, password: credentials.users[user.loginname], dc: user.centerId,
        },
      });
      assert.equal(response.status, 200);
      assert.match(response.data?.token ?? '', /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
      verifyUAAIdentity(response.data.user, user);
      const self = await request(origin, '/auths/user-info/self', { token: response.data.token });
      assert.equal(self.status, 200);
      verifyUAAIdentity(self.data, user);
      return { httpStatus: 200, loginResponseSha256: response.responseSha256,
        selfResponseSha256: self.responseSha256, tokenSha256: digest(response.data.token) };
    });
  }
  if (jwtSecret) {
    let variants;
    let signingControlPassed = false;
    const user = manifest.users[0];
    await check('signed-security-positive-control', async () => {
      const response = await request(origin, '/auths/login', {
        method: 'POST', body: {
          loginname: user.loginname, password: credentials.users[user.loginname], dc: user.centerId,
        },
      });
      assert.equal(response.status, 200);
      assert.match(response.data?.token ?? '', /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
      verifyUAAIdentity(response.data.user, user);
      variants = securityTokenVariants(response.data.token, jwtSecret);
      const self = await request(origin, '/auths/user-info/self', { token: variants.valid });
      assert.equal(self.status, 200);
      verifyUAAIdentity(self.data, user);
      signingControlPassed = true;
      return { httpStatus: self.status, tokenSha256: digest(variants.valid),
        tokenOrigin: 'exact-server-issued-token-not-resigned',
        loginResponseSha256: response.responseSha256, selfResponseSha256: self.responseSha256 };
    });
    await check('tampered-signature-token-denied', async () => {
      assert.ok(signingControlPassed, 'A rejected positive control cannot prove signature denial');
      assert.ok(securityStore?.storeVariant && securityStore?.read,
        'Signature denial requires an independent owned TokenStore fixture');
      await securityStore.storeVariant(variants.valid, variants.tampered);
      const before = verifyStoredWitness(await securityStore.read(variants.tampered), variants.tampered, user);
      const response = await request(origin, '/auths/user-info/self', {
        token: variants.tampered,
      });
      assert.equal(response.status, 401);
      verifyNoDeniedIdentity(response.data);
      const after = verifyStoredWitness(await securityStore.read(variants.tampered), variants.tampered, user);
      return { httpStatus: response.status, tokenSha256: digest(variants.tampered),
        tokenStoreBefore: before, tokenStoreAfter: after, proof: 'stored-signature-invalid-token-denied',
        responseSha256: response.responseSha256 };
    });
    await check('expired-signed-token-denied', async () => {
      assert.ok(signingControlPassed, 'A rejected positive control cannot prove expiry denial');
      assert.ok(securityStore?.retain && securityStore?.read,
        'Expiry denial requires an independent short-TTL owned TokenStore fixture');
      assert.ok(Number.isSafeInteger(maxExpiryWaitMs) && maxExpiryWaitMs > 0 && maxExpiryWaitMs <= 60000);
      const wait = variants.expiresAt * 1000 + 30 - Date.now();
      assert.ok(wait > 0 && wait <= maxExpiryWaitMs, 'Use a fresh independent short-TTL fixture, not r7');
      await securityStore.retain(variants.valid);
      const before = verifyStoredWitness(await securityStore.read(variants.valid), variants.valid, user);
      await new Promise(resolve => setTimeout(resolve, Math.max(0, variants.expiresAt * 1000 + 30 - Date.now())));
      assert.ok(Date.now() >= variants.expiresAt * 1000, 'Issued JWT has not expired');
      const response = await request(origin, '/auths/user-info/self', { token: variants.valid });
      assert.equal(response.status, 401);
      verifyNoDeniedIdentity(response.data);
      const after = verifyStoredWitness(await securityStore.read(variants.valid), variants.valid, user);
      const login = await request(origin, '/auths/login', { method: 'POST', body: {
        loginname: user.loginname, password: credentials.users[user.loginname], dc: user.centerId,
      } });
      assert.equal(login.status, 200);
      verifyUAAIdentity(login.data.user, user);
      assert.notEqual(login.data.token, variants.valid);
      const self = await request(origin, '/auths/user-info/self', { token: login.data.token });
      assert.equal(self.status, 200);
      verifyUAAIdentity(self.data, user);
      return { httpStatus: response.status, tokenSha256: digest(variants.valid),
        tokenStoreBefore: before, tokenStoreAfter: after, proof: 'exact-issued-jwt-expired-while-still-stored',
        expiresAt: variants.expiresAt, observedAt: Math.floor(Date.now() / 1000),
        freshLoginResponseSha256: login.responseSha256, freshSelfResponseSha256: self.responseSha256,
        responseSha256: response.responseSha256 };
    });
  }
  return checks;
}

export async function runOwnedUaaRuntime({
  runId, runtimeReportPath, label = randomBytes(5).toString('hex'), retainOwned = false,
  timeoutMs = 120_000, accountLabel,
}) {
  assert.match(runId, /^[a-f0-9]{12}$/);
  assert.match(label, /^[a-z0-9][a-z0-9-]{0,48}$/);
  const directories = new PinnedDirectories();
  const fixturePath = join(workspace, '.artifacts/native-nonadmin-fixtures', runId);
  const name = `nf-${runId}-uaa-${label}`;
  const created = [];
  let output;
  let destination;
  const report = {
    contract: 'run-owned-source-uaa-native-http-probe-v1', schemaVersion: 1, runId,
    status: 'failed', startedAt: new Date().toISOString(),
    sourceClosureVerified: false, nativeAcceptance: false, permissionAcceptance: false,
    actualBootApplicationStarted: false, actualHttpLoginVerified: false, actualTokenSecurityVerified: false,
    checks: [], inputs: [], cleanup: [], errors: [],
    limitations: [
      'Reconstructed candidate, not authenticated original source or confirmed redistribution rights.',
      'This probe does not verify backend fine-grant consumption, physical model isolation or feature workflows.',
      'A successful probe is scoped UAA HTTP evidence, not full source or release acceptance.',
    ],
  };
  const write = (directory, name, bytes, privateFile = false) => {
    directories.write(directory, name, bytes);
    if (privateFile) fs.chmodSync(directories.entry(directory, name), 0o600);
  };
  const read = (path, privateInput = false) => {
    const result = readPinnedFile(directories, directories.open(dirname(path)), path.split('/').at(-1));
    if (privateInput) assert.equal(fs.lstatSync(path).mode & 0o077, 0, 'Credentials must be private');
    report.inputs.push({ path: relative(workspace, path), bytes: result.data.length, sha256: digest(result.data) });
    try { return JSON.parse(result.data); }
    catch {
      throw new Error(privateInput ? 'Private credential input is not valid JSON' : 'Receipt is not valid JSON');
    }
  };
  const docker = (args, allowFailure = false, input) => {
    const result = spawnSync('docker', args, { input, encoding: 'utf8', timeout: 60_000, maxBuffer: 16 * 1024 * 1024 });
    if (!allowFailure) assert.ok(result.status === 0 && !result.error && !result.signal,
      `Owned Docker ${args[0]} failed; credential-bearing output suppressed`);
    return result;
  };
  const inspect = id => JSON.parse(docker(['inspect', id]).stdout)[0];
  try {
    output = join(fixturePath, `uaa-runtime-${label}`);
    destination = directories.open(output, { create: true, exclusive: true });
    fs.chmodSync(output, 0o700);
    const manifest = read(join(fixturePath, 'manifest.json'));
    validateMatrixFixture(manifest);
    assert.equal(manifest.runId, runId);
    const sqlReceipt = read(join(fixturePath, 'isolated-sql-report.json'));
    validateFixtureReceipt(manifest, sqlReceipt, report.inputs.find(input =>
      input.path.endsWith('/manifest.json')).sha256);
    const resources = read(join(fixturePath, 'owned-resources.json'));
    const runtime = read(resolve(runtimeReportPath));
    const accountInput = readApplicationAccountInput({ workspace, runId, label: accountLabel, manifest });
    const accounts = accountInput.accounts;
    report.applicationAccounts = accountInput.binding;
    const credentials = read(join(fixturePath, 'credentials.private.json'), true);
    const network = JSON.parse(docker(['network', 'inspect', resources.networkId]).stdout)[0];
    verifyOwnedNetwork(manifest, resources, network, [resources.mysqlId]);
    const mysql = inspect(resources.mysqlId);
    verifySelectedMysqlStorage(resources.databaseProfile, mysql, {
      storage: resources.databaseStorage, volumes: inspectMysqlFixtureVolumes(resources),
    });
    assert.equal(mysql.State.Running, true);
    assert.equal(mysql.Image, sqlReceipt.mysqlImage);
    assert.equal(mysql.Config.Labels[ownershipLabel], runId);
    assert.deepEqual(Object.keys(mysql.NetworkSettings.Networks), [manifest.ownership.network]);
    assert.ok(Object.values(mysql.HostConfig.PortBindings ?? {}).every(value => value === null));
    const image = JSON.parse(docker(['image', 'inspect', runtime.image.id]).stdout)[0];
    verifyCandidate(runtime, image);
    const build = read(runtime.inputBuild.path);
    const { data: buildBytes } = readPinnedFile(directories,
      directories.open(dirname(runtime.inputBuild.path)), 'report.json');
    assert.equal(digest(buildBytes), runtime.inputBuild.sha256, 'Source-build receipt changed');
    assert.equal(build.sourceInputs.before.fingerprint, runtime.sourceFingerprint);
    assert.equal(build.javaCompilationVerified, true);
    assert.equal(build.compilerBuildInDockerVerified, true);
    assert.equal(build.focusedSourceContractVerified, true);
    assert.deepEqual(build.errors, []);
    const { assertCurrentSource } = await import('../standalone-uaa/tools/token-security.mjs');
    assertCurrentSource(build);
    const witness = prepareOwnedTokenWitness({
      directories, output, workspace, imageId: image.Id, runId, redisName: `${name}-redis`, docker,
    });
    report.tokenStoreWitness = witness.evidence;
    const config = directories.open(join(output, 'config'), { create: true });
    const emptyRedis = directories.open(join(output, 'redis-data'), { create: true });
    const configuration = runtimeConfiguration(manifest, accounts.configuration, `${name}-redis`,
      randomBytes(32).toString('hex'));
    configuration['ibiz.jwt.expiration'] = 20000;
    configuration['ibiz.auth.security'] = 'oauth2';
    configuration['ibiz.systemid'] = 'uaa';
    report.tokenExpirationMilliseconds = 20000;
    // The file is readable by the image's fixed non-root UID; the parent is private on the host.
    write(config, 'application.properties', javaProperties(configuration));
    write(config, 'logback.xml', UAA_CONSOLE_LOGGING);
    fs.chmodSync(config.path, 0o755);
    fs.chmodSync(directories.entry(config, 'application.properties'), 0o644);
    fs.chmodSync(directories.entry(config, 'logback.xml'), 0o644);
    const common = ['--detach', '--pull=never', '--network', network.Name, '--read-only',
      '--cap-drop=ALL', '--security-opt=no-new-privileges', '--label', `${ownershipLabel}=${runId}`,
      '--tmpfs', '/tmp:rw,nosuid,nodev,size=268435456'];
    const redisId = docker(['run', ...common, '--cpus=1', '--memory=256m', '--pids-limit=128',
      '--name', `${name}-redis`, '--user', '65532:65532',
      '--mount', `type=bind,src=${emptyRedis.path},dst=/data,readonly`,
      REDIS_IMAGE_ID, 'redis-server', '--save', '', '--appendonly', 'no', '--dir', '/tmp']).stdout.trim();
    created.push(redisId);
    assert.match(redisId, /^[a-f0-9]{64}$/);
    const uaaId = docker(['run', ...common, '--cpus=2', '--memory=2g', '--pids-limit=512', '--name', name,
      '--mount', `type=bind,src=${config.path},dst=/opt/uaa/config,readonly`,
      '--mount', `type=bind,src=${witness.classesPath},dst=/opt/uaa/witness,readonly`,
      '--env', 'SPRING_CLOUD_BOOTSTRAP_ENABLED=false',
      '--env', 'SPRING_CLOUD_NACOS_CONFIG_ENABLED=false',
      '--env', 'SPRING_CLOUD_NACOS_DISCOVERY_ENABLED=false',
      '--env', `JAVA_TOOL_OPTIONS=${UAA_JAVA_OPTIONS}`,
      image.Id, '--spring.config.location=classpath:/,file:/opt/uaa/config/application.properties']).stdout.trim();
    created.push(uaaId);
    assert.match(uaaId, /^[a-f0-9]{64}$/);
    const uaa = inspect(uaaId);
    const redis = inspect(redisId);
    for (const [container, expectedImage, expectedName] of [
      [uaa, image.Id, name], [redis, REDIS_IMAGE_ID, `${name}-redis`],
    ]) verifyProbeContainer(container, {
      imageId: expectedImage, runId, networkId: network.Id, networkName: network.Name, name: expectedName,
    });
    const runningNetwork = JSON.parse(docker(['network', 'inspect', resources.networkId]).stdout)[0];
    verifyOwnedNetwork(manifest, resources, runningNetwork, [resources.mysqlId, redisId, uaaId]);
    report.services = { uaa: { containerId: uaaId, imageId: image.Id },
      redis: { containerId: redisId, imageId: REDIS_IMAGE_ID } };
    const origin = privateContainerOrigin(uaa, runningNetwork, 32666);
    report.origin = origin;
    report.transport = { kind: 'inspected-owned-private-bridge-ipv4',
      networkId: network.Id, endpointId: uaa.NetworkSettings.Networks[network.Name].EndpointID,
      containerPort: 32666, hostPublished: false };
    report.sourceFingerprint = runtime.sourceFingerprint;
    const deadline = Date.now() + timeoutMs;
    let ready = false;
    while (Date.now() < deadline) {
      assert.equal(inspect(uaaId).State.Running, true, 'Source-built BootApplication exited during startup');
      try {
        const response = await request(origin, '/auths/user-info/self');
        if (response.status === 401) { ready = true; break; }
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    assert.ok(ready, 'Source-built BootApplication did not become ready within the startup deadline');
    report.actualBootApplicationStarted = true;
    const guardWitness = () => {
      const currentNetwork = JSON.parse(docker(['network', 'inspect', resources.networkId]).stdout)[0];
      verifyOwnedNetwork(manifest, resources, currentNetwork, [resources.mysqlId, redisId, uaaId]);
      for (const [id, expectedImage, expectedName] of [
        [uaaId, image.Id, name], [redisId, REDIS_IMAGE_ID, `${name}-redis`],
      ]) verifyProbeContainer(inspect(id), {
        imageId: expectedImage, runId, networkId: network.Id, networkName: network.Name, name: expectedName,
      });
    };
    report.checks = await probeUaaHttp(origin, manifest, credentials, undefined,
      { jwtSecret: configuration['ibiz.jwt.secret'], maxExpiryWaitMs: 60000,
        securityStore: witness.forContainer(uaaId, guardWitness) });
    witness.recheck();
    assertCurrentSource(build);
    report.actualHttpLoginVerified = report.checks.slice(0, 13).length === 13
      && report.checks.slice(0, 13).every(check => check.status === 'pass');
    report.actualTokenSecurityVerified = report.checks.length === 16
      && report.checks.slice(13).every(check => check.status === 'pass');
    assert.ok(report.actualHttpLoginVerified, 'Source-built UAA native HTTP contract failed');
    assert.ok(report.actualTokenSecurityVerified, 'Source-built UAA native token security contract failed');
    report.status = 'passed-scoped-native-uaa-http-only';
  } catch (error) {
    report.errors.push(error.message);
  } finally {
    for (const id of created) {
      if (destination) {
        const result = docker(['logs', id], true);
        write(destination, `${id.slice(0, 12)}.private.log`,
          `${result.stdout ?? ''}${result.stderr ?? ''}`, true);
      }
    }
    if (!retainOwned || report.status !== 'passed-scoped-native-uaa-http-only') {
      for (const id of created.toReversed()) {
        const result = docker(['rm', '--force', id], true);
        report.cleanup.push({ containerId: id, removed: result.status === 0 });
        if (result.status !== 0) report.errors.push('Run-owned container cleanup failed');
      }
    }
    report.retainedOwned = retainOwned && report.status === 'passed-scoped-native-uaa-http-only';
    report.finishedAt = new Date().toISOString();
    if (destination) {
      const bytes = `${JSON.stringify(report, null, 2)}\n`;
      write(destination, 'report.json', bytes);
      write(destination, 'report.sha256', `${digest(bytes)}\n`);
    }
    directories.close();
  }
  return { report, reportPath: output ? join(output, 'report.json') : null };
}

export async function replayRetainedUaaRuntime({
  runId, retainedReportPath, runtimeReportPath,
  label = 'security-r1',
}) {
  assert.match(runId, /^[a-f0-9]{12}$/);
  assert.match(label, /^[a-z0-9][a-z0-9-]{0,48}$/);
  const directories = new PinnedDirectories();
  const fixturePath = join(workspace, '.artifacts/native-nonadmin-fixtures', runId);
  const output = join(fixturePath, `uaa-runtime-retained-replay-${label}`);
  let destination;
  const report = {
    contract: 'run-owned-source-uaa-native-http-replay-v1',
    schemaVersion: 1,
    runId,
    status: 'failed',
    startedAt: new Date().toISOString(),
    sourceClosureVerified: false,
    nativeAcceptance: false,
    permissionAcceptance: false,
    actualBootApplicationStarted: false,
    actualHttpLoginVerified: false,
    actualTokenSecurityVerified: false,
    checks: [],
    inputs: [],
    errors: [],
    limitations: [
      'Read-only replay against an already retained run-owned service; no container restart or network mutation.',
      'Reconstructed candidate, not authenticated original source or confirmed redistribution rights.',
      'This replay verifies UAA HTTP/token behavior only, not backend fine-grants or feature workflows.',
    ],
  };
  const readBytes = (path, privateInput = false) => {
    const resolved = resolve(path);
    assert.ok(resolved === workspace || resolved.startsWith(`${workspace}/`),
      'Replay input must remain inside the workspace');
    const parent = directories.open(dirname(resolved));
    const result = readPinnedFile(directories, parent, resolved.split('/').at(-1));
    if (privateInput) {
      assert.equal(fs.lstatSync(resolved).mode & 0o077, 0,
        'Private replay input permissions are too broad');
    }
    report.inputs.push({
      path: relative(workspace, resolved),
      bytes: result.data.length,
      sha256: digest(result.data),
    });
    return result.data;
  };
  const readJson = (path, privateInput = false) =>
    JSON.parse(readBytes(path, privateInput));
  const docker = (args, allowFailure = false) => {
    const result = spawnSync('docker', args, {
      encoding: 'utf8', timeout: 60_000, maxBuffer: 16 * 1024 * 1024,
    });
    if (!allowFailure) {
      assert.ok(result.status === 0 && !result.error && !result.signal,
        `Owned Docker ${args[0]} failed; replay output suppressed`);
    }
    return result;
  };
  const inspect = id => JSON.parse(docker(['inspect', id]).stdout)[0];
  const write = (name, bytes) => {
    directories.write(destination, name, bytes);
    fs.chmodSync(directories.entry(destination, name), 0o600);
  };
  try {
    destination = directories.open(output, { create: true, exclusive: true });
    fs.chmodSync(output, 0o700);

    const retained = readJson(retainedReportPath);
    assert.equal(retained.contract, 'run-owned-source-uaa-native-http-probe-v1');
    assert.equal(retained.runId, runId);
    assert.equal(retained.status, 'passed-scoped-native-uaa-http-only');
    assert.equal(retained.retainedOwned, true);
    assert.equal(retained.actualBootApplicationStarted, true);
    assert.equal(retained.actualHttpLoginVerified, true);
    assert.equal(retained.checks.length, 13);
    assert.ok(retained.checks.every(check => check.status === 'pass'));

    const manifest = readJson(join(fixturePath, 'manifest.json'));
    validateMatrixFixture(manifest);
    assert.equal(manifest.runId, runId);
    const sqlReceipt = readJson(join(fixturePath, 'isolated-sql-report.json'));
    validateFixtureReceipt(manifest, sqlReceipt, report.inputs.find(input =>
      input.path.endsWith('/manifest.json')).sha256);
    const resources = readJson(join(fixturePath, 'owned-resources.json'));
    const runtime = readJson(resolve(runtimeReportPath));
    const accounts = readJson(join(fixturePath,
      'application-accounts-20261006-integration-r1/accounts.private.json'), true);
    const credentials = readJson(join(fixturePath, 'credentials.private.json'), true);
    const retainedContainerId = retained.services?.uaa?.containerId;
    const retainedRedisId = retained.services?.redis?.containerId;
    assert.match(retainedContainerId ?? '', /^[a-f0-9]{64}$/);
    assert.match(retainedRedisId ?? '', /^[a-f0-9]{64}$/);

    const network = JSON.parse(docker(['network', 'inspect', resources.networkId]).stdout)[0];
    verifyOwnedNetwork(manifest, resources, network,
      [resources.mysqlId, retainedRedisId, retainedContainerId]);
    const mysql = inspect(resources.mysqlId);
    verifySelectedMysqlStorage(resources.databaseProfile, mysql, {
      storage: resources.databaseStorage, volumes: inspectMysqlFixtureVolumes(resources),
    });
    assert.equal(mysql.State.Running, true);
    assert.equal(mysql.Image, sqlReceipt.mysqlImage);
    assert.equal(mysql.Config.Labels[ownershipLabel], runId);
    const redis = inspect(retainedRedisId);
    const uaa = inspect(retainedContainerId);
    assert.equal(redis.Image, REDIS_IMAGE_ID);
    verifyProbeContainer(redis, {
      imageId: REDIS_IMAGE_ID, runId, networkId: network.Id,
      networkName: network.Name, name: `${retainedContainerId ? uaa.Name.slice(1) : ''}-redis`,
    });
    const image = JSON.parse(docker(['image', 'inspect', runtime.image.id]).stdout)[0];
    verifyCandidate(runtime, image);
    assert.equal(uaa.Image, image.Id);
    assert.equal(uaa.Config.Labels[ownershipLabel], runId);
    assert.equal(uaa.Config.Labels['aibiz.source-fingerprint'], runtime.sourceFingerprint);
    verifyProbeContainer(uaa, {
      imageId: image.Id, runId, networkId: network.Id,
      networkName: network.Name, name: uaa.Name.slice(1),
    });
    assert.deepEqual(uaa.Config.Entrypoint, UAA_ENTRYPOINT);
    assert.deepEqual(uaa.Config.Cmd, [
      '--spring.config.location=classpath:/,file:/opt/uaa/config/application.properties',
    ]);
    assert.equal(uaa.Config.User, '65532:65532');
    assert.deepEqual(uaa.Mounts.map(mount => ({
      Type: mount.Type, Source: mount.Source, Destination: mount.Destination, RW: mount.RW,
    })), [{
      Type: 'bind',
      Source: join(dirname(resolve(retainedReportPath)), 'config'),
      Destination: '/opt/uaa/config',
      RW: false,
    }]);

    const buildBytes = readBytes(runtime.inputBuild.path);
    assert.equal(digest(buildBytes), runtime.inputBuild.sha256,
      'Source-build receipt changed during retained replay');
    const build = JSON.parse(buildBytes);
    assert.equal(build.sourceInputs.before.fingerprint, runtime.sourceFingerprint);
    assert.equal(build.javaCompilationVerified, true);
    assert.equal(build.compilerBuildInDockerVerified, true);
    assert.equal(build.focusedSourceContractVerified, true);
    assert.deepEqual(build.errors, []);

    const configPath = join(dirname(resolve(retainedReportPath)), 'config',
      'application.properties');
    const configBytes = readBytes(configPath);
    const configuration = parseJavaProperties(configBytes);
    const jwtSecret = configuration['ibiz.jwt.secret'];
    assert.match(jwtSecret ?? '', /^[a-f0-9]{64}$/);
    assert.equal(configuration['ibiz.jwt.signature'], 'MAC');
    assert.equal(configuration['ibiz.auth.passwordStorageMode'], 'sm3');
    assert.equal(configuration['spring.datasource.username'],
      accounts.configuration.uaa['spring.datasource.username']);
    assert.equal(configuration['spring.datasource.defaultSchema'], manifest.schemas.uaa);
    assert.equal(configuration['spring.datasource.url'],
      accounts.configuration.uaa['spring.datasource.url']);
    assert.equal(configuration['spring.redis.host'], `${uaa.Name.slice(1)}-redis`);
    assert.equal(configuration['spring.redis.port'], '6379');
    assert.equal(configuration['server.port'], '32666');

    const env = new Set(uaa.Config.Env ?? []);
    for (const setting of [
      'SPRING_CLOUD_BOOTSTRAP_ENABLED=false',
      'SPRING_CLOUD_NACOS_CONFIG_ENABLED=false',
      'SPRING_CLOUD_NACOS_DISCOVERY_ENABLED=false',
    ]) assert.ok(env.has(setting), `Retained UAA bootstrap setting missing: ${setting}`);
    const origin = privateContainerOrigin(uaa, network, 32666);
    report.origin = origin;
    report.transport = {
      kind: 'inspected-owned-private-bridge-ipv4-replay',
      networkId: network.Id,
      endpointId: uaa.NetworkSettings.Networks[network.Name].EndpointID,
      containerPort: 32666,
      hostPublished: false,
    };
    report.services = {
      uaa: { containerId: retainedContainerId, imageId: image.Id },
      redis: { containerId: retainedRedisId, imageId: REDIS_IMAGE_ID },
    };
    report.sourceFingerprint = runtime.sourceFingerprint;
    report.configSha256 = digest(configBytes);
    report.actualBootApplicationStarted = uaa.State.Running;
    assert.equal(report.actualBootApplicationStarted, true);
    report.checks = await probeUaaHttp(origin, manifest, credentials, undefined, { jwtSecret });
    report.actualHttpLoginVerified = report.checks.slice(0, 13).every(check => check.status === 'pass');
    report.actualTokenSecurityVerified = report.checks.length === 16
      && report.checks.slice(13).every(check => check.status === 'pass');
    assert.equal(report.checks.length, 16);
    assert.ok(report.actualHttpLoginVerified,
      'Retained UAA HTTP contract failed during read-only replay');
    assert.ok(report.actualTokenSecurityVerified,
      'Retained UAA token security contract failed during read-only replay');
    report.status = 'passed-scoped-native-uaa-http-replay';
  } catch (error) {
    report.errors.push(error.message);
  } finally {
    report.finishedAt = new Date().toISOString();
    if (destination) {
      const bytes = `${JSON.stringify(report, null, 2)}\n`;
      write('report.json', bytes);
      write('report.sha256', `${digest(bytes)}\n`);
    }
    directories.close();
  }
  return { report, reportPath: join(output, 'report.json') };
}

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: {
    'run-id': { type: 'string' }, 'runtime-report': { type: 'string' },
    'account-label': { type: 'string' },
    'retained-report': { type: 'string' }, 'replay-retained': { type: 'boolean', default: false },
    label: { type: 'string' }, 'retain-owned': { type: 'boolean', default: false },
    help: { type: 'boolean', default: false },
  } });
  if (values.help) {
    console.log('Usage: node scripts/harness-run-owned-uaa-runtime.mjs --run-id=<fixture> --account-label=<account run> --runtime-report=<packaging report> [--label=<new label>] [--retain-owned]');
    console.log('       node scripts/harness-run-owned-uaa-runtime.mjs --replay-retained --run-id=<fixture> --retained-report=<retained report> --runtime-report=<packaging report> [--label=<replay label>]');
    return 0;
  }
  if (values['replay-retained']) {
    assert.ok(values['run-id'] && values['retained-report'] && values['runtime-report'],
      'Retained replay requires run, retained report and runtime report');
    const result = await replayRetainedUaaRuntime({
      runId: values['run-id'], retainedReportPath: values['retained-report'],
      runtimeReportPath: values['runtime-report'], label: values.label,
    });
    console.log(JSON.stringify(result, null, 2));
    return result.report.status === 'passed-scoped-native-uaa-http-replay'
      && result.report.errors.length === 0 ? 0 : 1;
  }
  assert.ok(values['run-id'] && values['runtime-report'], 'Explicit run-owned fixture and runtime receipt required');
  const result = await runOwnedUaaRuntime({
    runId: values['run-id'], runtimeReportPath: values['runtime-report'],
    label: values.label, retainOwned: values['retain-owned'], accountLabel: values['account-label'],
  });
  console.log(JSON.stringify(result, null, 2));
  return result.report.status === 'passed-scoped-native-uaa-http-only' && result.report.errors.length === 0 ? 0 : 1;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().then(code => { process.exitCode = code; }).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
