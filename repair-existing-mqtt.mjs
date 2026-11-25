#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = path.join(workspace, '.artifacts');
export const listenerId = 'ws:aibiz_plm';
const oldListenerIds = ['ssl:default', 'tcp:default', 'ws:default', 'wss:default'];
const encode = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const identityHash = value => hash(encode(canonical(value)));
const containerId = 'cedaa102a56f114ec4b3a731feae20e406dbb4fca846d0bdb71bbbba3b968eeb';
const imageId = 'sha256:32420d4da58c2a82f4342b5cdf160d08984d6e6c7f7efbdb2db8b1ee9add2932';

export function acquireMqttWriterLock(filename = path.join(artifacts, '.emqx-config-writer.lock')) {
  const bytes = encode({ contract: 'aibiz-emqx-local-writer-v1', pid: process.pid, epoch: randomUUID() });
  const fd = fs.openSync(filename, fs.constants.O_WRONLY | fs.constants.O_CREAT
    | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  fs.writeFileSync(fd, bytes);
  fs.fsyncSync(fd);
  const expected = fs.fstatSync(fd);
  const assertHeld = () => {
    const actual = fs.lstatSync(filename);
    assert.ok(actual.isFile() && !actual.isSymbolicLink());
    assert.equal(actual.dev, expected.dev);
    assert.equal(actual.ino, expected.ino);
    assert.equal(hash(privateRead(filename)), hash(bytes));
  };
  return { assertHeld, release() {
    try { assertHeld(); fs.unlinkSync(filename); } finally { fs.closeSync(fd); }
  } };
}

function run(args, options = {}) {
  const result = spawnSync('docker', args, { timeout: 15000, maxBuffer: 8 * 1024 * 1024, ...options });
  assert.equal(result.status, 0, `Existing MQTT operation failed: ${args[0]}`);
  return Buffer.from(result.stdout ?? '');
}

function inspect() {
  const raw = JSON.parse(run(['inspect', containerId]))[0];
  assert.equal(raw.Id, containerId);
  assert.equal(raw.Image, imageId);
  assert.equal(raw.Name, '/emqx');
  assert.equal(raw.State.Status, 'running');
  const env = Object.fromEntries(raw.Config.Env.map(value => {
    const index = value.indexOf('=');
    return [value.slice(0, index), value.slice(index + 1)];
  }));
  return {
    raw,
    env,
    binding: {
      containerId, imageId,
      startedAt: raw.State.StartedAt,
      restartCount: raw.RestartCount,
      configurationSha256: identityHash({ Config: raw.Config, HostConfig: raw.HostConfig,
        Mounts: [...raw.Mounts].sort((a, b) => a.Destination.localeCompare(b.Destination)) }),
    },
  };
}

export function clientWitness(value) {
  return {
    clientid: value.clientid,
    username: value.username,
    listener: value.listener,
    connected: value.connected,
    connected_at: value.connected_at,
    created_at: value.created_at,
    ip_address: value.ip_address,
  };
}

function sourceSeal() {
  return [
    fileURLToPath(import.meta.url),
    path.join(workspace, 'scripts/tests/repair-existing-mqtt.test.mjs'),
  ].map(filename => ({ path: filename, sha256: hash(fs.readFileSync(filename)) }));
}

function privateRead(filename) {
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const info = fs.fstatSync(fd);
    assert.ok(info.isFile() && info.uid === process.geteuid() && info.nlink === 1 && !(info.mode & 0o077));
    return fs.readFileSync(fd);
  } finally { fs.closeSync(fd); }
}

function write(output, filename, bytes) {
  assert.ok(/^[A-Za-z0-9_.-]+$/.test(filename));
  const fd = fs.openSync(path.join(output, filename),
    fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  const dir = fs.openSync(output, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
  try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
}

function makeOutput(output) {
  assert.ok(path.isAbsolute(output));
  assert.equal(fs.realpathSync(path.dirname(output)), artifacts);
  assert.match(path.basename(output), /^mqtt-(?:prepare|apply|rollback)-[a-z0-9-]+$/);
  fs.mkdirSync(output, { mode: 0o700 });
}

async function apiSession() {
  const current = inspect();
  const credentials = {
    username: current.env.EMQX_DASHBOARD__DEFAULT_USERNAME,
    password: current.env.EMQX_DASHBOARD__DEFAULT_PASSWORD,
  };
  assert.ok(credentials.username && credentials.password);
  const login = await fetch('http://127.0.0.1:18083/api/v5/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(credentials), signal: AbortSignal.timeout(10000),
  });
  assert.equal(login.status, 200, 'Existing dashboard credentials failed');
  const result = await login.json();
  assert.ok(typeof result.token === 'string' && result.token.length > 20);
  const call = async (suffix, { method = 'GET', body, text = false } = {}) => {
    assert.ok(suffix.startsWith('/') && !suffix.includes('..'));
    const response = await fetch(`http://127.0.0.1:18083/api/v5${suffix}`, {
      method,
      headers: { Authorization: `Bearer ${result.token}`,
        Accept: text ? 'text/plain' : 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': text ? 'text/plain' : 'application/json' }) },
      ...(body === undefined ? {} : { body: text ? body : JSON.stringify(body) }),
      signal: AbortSignal.timeout(15000),
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    if (!response.ok) throw new Error(`EMQX ${method} ${suffix} returned ${response.status}; body SHA ${hash(bytes)}`);
    return text ? bytes.toString() : bytes.length ? JSON.parse(bytes) : null;
  };
  return { call, binding: current.binding };
}

async function readSnapshot(call) {
  const listeners = await call('/listeners');
  const details = {};
  for (const item of listeners) details[item.id] = await call(`/listeners/${encodeURIComponent(item.id)}`);
  const clients = await call('/clients?page=1&limit=1000');
  assert.equal(clients.meta?.hasnext, false, 'All active clients must be bound');
  return {
    runtime: inspect().binding,
    authentication: await call('/authentication'),
    authorization: await call('/authorization/sources'),
    authorizationConfig: await call('/configs?key=authorization', { text: true }),
    authorizationSettings: await call('/authorization/settings'),
    listeners: details,
    clients: clients.data.map(clientWitness).sort((a, b) => a.clientid.localeCompare(b.clientid)),
    listenerConfig: await call('/configs?key=listeners', { text: true }),
    aclFiles: aclFileWitness(),
  };
}

function aclFileWitness() {
  const result = {};
  for (const filename of ['/opt/emqx/etc/acl.conf', '/opt/emqx/data/authz/acl.conf']) {
    const text = run(['exec', containerId, 'sh', '-c', `set -eu
test ! -L "$1"
if test ! -e "$1"; then printf 'ABSENT\\n'; exit 0; fi
test -f "$1"
before=$(stat -c '%d %i %u %g %a %h %s' "$1")
digest=$(sha256sum "$1")
test "$before" = "$(stat -c '%d %i %u %g %a %h %s' "$1")"
printf '%s\\n%s\\n' "$before" "$digest"
`, 'aibiz-mqtt', filename]).toString().trim();
    if (text === 'ABSENT') { result[filename] = { exists: false }; continue; }
    const [metadata, digest] = text.split('\n');
    const [dev, ino, uid, gid, mode, nlink, size] = metadata.split(' ');
    assert.match(digest, /^[a-f0-9]{64}  /);
    result[filename] = { exists: true, dev, ino, uid, gid, mode, nlink, bytes: Number(size),
      sha256: digest.slice(0, 64) };
  }
  return result;
}

function removeOwnedAclFile(expected) {
  assert.equal(expected.exists, true);
  assert.equal(expected.nlink, '1');
  const filename = '/opt/emqx/data/authz/acl.conf';
  const signature = ['dev', 'ino', 'uid', 'gid', 'mode', 'nlink', 'bytes'].map(key => expected[key]).join(' ');
  run(['exec', containerId, 'sh', '-c', `set -eu
test ! -L "$1" && test -f "$1"
test "$(stat -c '%d %i %u %g %a %h %s' "$1")" = "$2"
digest=$(sha256sum "$1")
test "\${digest%% *}" = "$3"
rm -- "$1"
test ! -e "$1"
`, 'aibiz-mqtt', filename, signature, expected.sha256]);
}

export function assertPreserved(before, after) {
  assert.deepEqual(after.runtime, before.runtime, 'EMQX runtime changed');
  assert.deepEqual(after.authentication, before.authentication, 'Global authentication changed');
  assert.deepEqual(after.authorizationSettings, before.authorizationSettings, 'Global ACL settings changed');
  if (before.aclFiles) {
    assert.deepEqual(after.aclFiles['/opt/emqx/etc/acl.conf'], before.aclFiles['/opt/emqx/etc/acl.conf'],
      'Original ACL source file changed');
  }
  for (const id of oldListenerIds) {
    const strip = value => {
      const copy = structuredClone(value);
      delete copy.current_connections;
      if (/^:\d+$/.test(copy.bind ?? '')) copy.bind = `0.0.0.0${copy.bind}`;
      return copy;
    };
    assert.deepEqual(strip(after.listeners[id]), strip(before.listeners[id]), `Existing listener changed: ${id}`);
  }
  for (const client of before.clients) {
    assert.deepEqual(after.clients.find(row => row.clientid === client.clientid), client,
      'An existing client disconnected or changed lifetime');
  }
}

export function aclPatch(original, identities) {
  assert.equal(original.type, 'file');
  assert.equal(original.enable, true);
  assert.equal(typeof original.rules, 'string');
  for (const identity of identities) {
    assert.match(identity.username, /^aibiz_mqtt_[a-f0-9]{12}_(?:owner|other)$/);
    assert.match(identity.topic, /^aibiz\/acceptance\/[a-f0-9]{12}\/(?:owner|other)\/#$/);
  }
  const prefix = identities.map(identity =>
    `{allow, {username, "${identity.username}"}, all, ["${identity.topic}"]}.\n`
      + `{deny, {username, "${identity.username}"}, all, ["#"]}.\n`).join('');
  return { ...original, rules: `${prefix}${original.rules}` };
}

export function listenerConfig(plan, publicKey) {
  assert.ok(publicKey.startsWith('-----BEGIN PUBLIC KEY-----'));
  const value = {
    bind: '0.0.0.0:8085', enable: false, enable_authn: 'quick_deny_anonymous',
    acceptors: 2, max_connections: 100, websocket: { mqtt_path: '/mqtt' },
    authentication: [{
      mechanism: 'jwt', algorithm: 'public-key', public_key: publicKey, use_jwks: false,
      verify_claims: { username: '${username}', aud: 'aibiz-owned-mqtt', iss: plan.epoch },
      acl_claim_name: 'acl', from: 'password', disconnect_after_expire: true, enable: true,
    }],
  };
  return JSON.stringify({ listeners: { ws: { aibiz_plm: value } } });
}

export function createToken(privateKey, epoch, identity, ttl = 120) {
  assert.ok(Number.isInteger(ttl) && ttl >= -120 && ttl <= 600);
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    sub: identity.username, username: identity.username, aud: 'aibiz-owned-mqtt',
    iss: epoch, iat: now, exp: now + ttl,
    acl: { pub: [identity.topic], sub: [identity.topic] },
  })).toString('base64url');
  const input = `${header}.${payload}`;
  return `${input}.${sign('RSA-SHA256', Buffer.from(input), privateKey).toString('base64url')}`;
}

export async function prepare(output) {
  makeOutput(output);
  const { call } = await apiSession();
  const before = await readSnapshot(call);
  assert.equal(before.listeners[listenerId], undefined, 'The owned listener already exists');
  assert.deepEqual(Object.keys(before.listeners).sort(), oldListenerIds);
  assert.deepEqual(before.authentication, []);
  assert.equal(before.authorization.sources.length, 1);
  assert.equal(before.aclFiles['/opt/emqx/data/authz/acl.conf'].exists, false,
    'An existing managed ACL file cannot be adopted or overwritten');
  assert.equal(before.aclFiles['/opt/emqx/etc/acl.conf'].sha256,
    hash(before.authorization.sources[0].rules));
  assert.ok(before.authorizationConfig.includes('path = "${EMQX_ETC_DIR}/acl.conf"'));
  const epoch = randomUUID();
  const runId = epoch.replaceAll('-', '').slice(0, 12);
  const identities = ['owner', 'other'].map(role => ({
    username: `aibiz_mqtt_${runId}_${role}`, topic: `aibiz/acceptance/${runId}/${role}/#`,
  }));
  const keys = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    publicKeyEncoding: { type: 'spki', format: 'pem' },
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
  });
  const plan = {
    contract: 'existing-mqtt-isolated-plan-v1', status: 'PREPARED-NOT-APPLIED', epoch, runId,
    sourceSeal: sourceSeal(), before,
    identities,
    listener: { id: listenerId, bind: '0.0.0.0:8085', hostPortAdded: false },
    newAcl: aclPatch(before.authorization.sources[0], identities),
    publicKeySha256: hash(keys.publicKey),
    rollback: 'Delete exact owned listener; restore original ACL configuration path; remove only exact created ACL inode',
    legacyListenerWrites: false, globalAuthnWrites: false,
    concurrency: { localLockOnly: true, trustedExclusiveWriterWindowRequired: true,
      atomicCompareAndSwapClaimed: false },
    PLMTokenAcceptance: false, functionalAcceptance: false,
  };
  write(output, 'private-key.private.pem', keys.privateKey);
  write(output, 'public-key.pem', keys.publicKey);
  write(output, 'listener.private.hocon', listenerConfig(plan, keys.publicKey));
  write(output, 'before.private.json', encode(before));
  write(output, 'prepared.private.json', encode(plan));
  assert.deepEqual(await readSnapshot(call), before, 'Configuration changed during prepare');
  return { status: plan.status, epoch, planSha256: hash(encode(plan)),
    activeClients: before.clients.length, listener: listenerId };
}

function loadPlan(filename, expectedSha256, epoch, knownPredecessor = false) {
  const bytes = privateRead(filename);
  assert.equal(hash(bytes), expectedSha256);
  const plan = JSON.parse(bytes);
  assert.equal(plan.contract, 'existing-mqtt-isolated-plan-v1');
  assert.equal(plan.status, 'PREPARED-NOT-APPLIED');
  assert.equal(plan.epoch, epoch);
  if (knownPredecessor) {
    assert.deepEqual(plan.sourceSeal.map(row => row.sha256), [
      'f7d8fe4a45ca1b58d8b9d9ffea2eae709ba1776ce4f2ac5d59cde906bdbe727e',
      '38be71670479c27159f5e42558d951c146c1755c4a5d1f3e9f6a6064dc83c077',
    ]);
  } else assert.deepEqual(plan.sourceSeal, sourceSeal());
  assert.equal(plan.legacyListenerWrites, false);
  assert.equal(plan.globalAuthnWrites, false);
  const dir = path.dirname(filename);
  assert.equal(hash(privateRead(path.join(dir, 'public-key.pem'))), plan.publicKeySha256);
  assert.deepEqual(JSON.parse(privateRead(path.join(dir, 'before.private.json'))), plan.before);
  assert.equal(privateRead(path.join(dir, 'listener.private.hocon')).toString(),
    listenerConfig(plan, privateRead(path.join(dir, 'public-key.pem')).toString()));
  assert.deepEqual(plan.newAcl, aclPatch(plan.before.authorization.sources[0], plan.identities));
  return plan;
}

export async function continueApply({ output, filename, expectedSha256, epoch, applied, applySha256,
  trustedExclusiveWriterWindow, lock }) {
  assert.equal(trustedExclusiveWriterWindow, true);
  lock.assertHeld();
  const plan = loadPlan(filename, expectedSha256, epoch, true);
  const failedBytes = privateRead(applied);
  assert.equal(hash(failedBytes), applySha256);
  const failed = JSON.parse(failedBytes);
  assert.equal(failed.status, 'FAILED-RETAINED-FOR-REVIEW');
  assert.equal(failed.planSha256, expectedSha256);
  assert.equal(failed.epoch, epoch);
  assert.deepEqual(failed.events, ['owned-disabled-listener-created']);
  makeOutput(output);
  const { call } = await apiSession();
  const report = { contract: 'existing-mqtt-isolated-apply-v1', epoch, planSha256: expectedSha256,
    continuedFromSha256: applySha256, sourceSeal: sourceSeal(),
    status: 'VALIDATING', events: [], PLMTokenAcceptance: false, functionalAcceptance: false,
    observedBindNormalization: { ':1883': '0.0.0.0:1883', ':8083': '0.0.0.0:8083' } };
  try {
    const current = await readSnapshot(call);
    assert.deepEqual(current, failed.observed, 'Failed apply state changed');
    assertPreserved(plan.before, current);
    assert.deepEqual(current.authorization, plan.before.authorization);
    assert.equal(current.listeners[listenerId].enable, false);
    write(output, 'intent.private.json', encode({ plan, failed, current, sourceSeal: sourceSeal() }));
    lock.assertHeld();
    await call('/authorization/sources/file', { method: 'PUT', body: plan.newAcl });
    report.events.push('owned-identities-only-acl-prefix-created');
    const snapshot = await readSnapshot(call);
    assertPreserved(plan.before, snapshot);
    assert.deepEqual(snapshot.authorization.sources, [plan.newAcl]);
    lock.assertHeld();
    await call(`/listeners/${encodeURIComponent(listenerId)}/start`, { method: 'POST' });
    report.events.push('owned-listener-started');
    report.after = await readSnapshot(call);
    assertPreserved(plan.before, report.after);
    assert.equal(report.after.listeners[listenerId].running, true);
    assert.equal(report.after.listeners[listenerId].enable, true);
    report.status = 'APPLIED-ISOLATED-BROKER-ONLY-ACCEPTANCE-PENDING';
    return report;
  } catch (error) {
    report.status = 'FAILED-RETAINED-FOR-REVIEW';
    report.error = error.message;
    report.observed = await readSnapshot(call).catch(() => null);
    throw error;
  } finally { write(output, 'report.private.json', encode(report)); }
}

export async function apply({ output, filename, expectedSha256, epoch, trustedExclusiveWriterWindow, lock }) {
  assert.equal(trustedExclusiveWriterWindow, true);
  lock.assertHeld();
  const plan = loadPlan(filename, expectedSha256, epoch);
  makeOutput(output);
  const { call } = await apiSession();
  const report = { contract: 'existing-mqtt-isolated-apply-v1', epoch, planSha256: expectedSha256,
    status: 'VALIDATING', events: [], PLMTokenAcceptance: false, functionalAcceptance: false };
  try {
    assert.deepEqual(await readSnapshot(call), plan.before, 'The prepared MQTT inputs drifted');
    lock.assertHeld();
    write(output, 'intent.private.json', encode({ epoch, expectedSha256, before: plan.before }));
    await call('/configs?mode=merge', {
      method: 'PUT', text: true,
      body: privateRead(path.join(path.dirname(filename), 'listener.private.hocon')).toString(),
    });
    report.events.push('owned-disabled-listener-created');
    let snapshot = await readSnapshot(call);
    assertPreserved(plan.before, snapshot);
    assert.equal(snapshot.listeners[listenerId]?.enable, false);
    lock.assertHeld();
    await call('/authorization/sources/file', { method: 'PUT', body: plan.newAcl });
    report.events.push('owned-identities-only-acl-prefix-created');
    snapshot = await readSnapshot(call);
    assertPreserved(plan.before, snapshot);
    assert.deepEqual(snapshot.authorization.sources, [plan.newAcl]);
    lock.assertHeld();
    await call(`/listeners/${encodeURIComponent(listenerId)}/start`, { method: 'POST' });
    report.events.push('owned-listener-started');
    report.after = await readSnapshot(call);
    assertPreserved(plan.before, report.after);
    assert.equal(report.after.listeners[listenerId]?.running, true);
    assert.equal(report.after.listeners[listenerId]?.enable, true);
    report.status = 'APPLIED-ISOLATED-BROKER-ONLY-ACCEPTANCE-PENDING';
    return report;
  } catch (error) {
    report.status = 'FAILED-RETAINED-FOR-REVIEW';
    report.error = error.message;
    report.observed = await readSnapshot(call).catch(() => null);
    throw Object.assign(error, { evidence: report });
  } finally {
    write(output, 'report.private.json', encode(report));
  }
}

export async function rollback({ output, filename, expectedSha256, epoch, applied, applySha256,
  trustedExclusiveWriterWindow, lock, recover = false }) {
  assert.equal(trustedExclusiveWriterWindow, true);
  lock.assertHeld();
  const plan = loadPlan(filename, expectedSha256, epoch,
    JSON.parse(privateRead(filename)).sourceSeal[0].sha256 === 'f7d8fe4a45ca1b58d8b9d9ffea2eae709ba1776ce4f2ac5d59cde906bdbe727e');
  const appliedBytes = privateRead(applied);
  assert.equal(hash(appliedBytes), applySha256);
  const receipt = JSON.parse(appliedBytes);
  assert.equal(receipt.epoch, epoch);
  assert.equal(receipt.planSha256, expectedSha256);
  assert.equal(receipt.status, recover ? 'FAILED-RETAINED-FOR-REVIEW'
    : 'APPLIED-ISOLATED-BROKER-ONLY-ACCEPTANCE-PENDING');
  makeOutput(output);
  const { call } = await apiSession();
  const current = await readSnapshot(call);
  assertPreserved(plan.before, current);
  const witnessed = recover ? receipt.observed : receipt.after;
  assert.ok(witnessed);
  assert.equal(current.listenerConfig, witnessed.listenerConfig, 'Listener auth config drifted');
  assert.equal(current.authorizationConfig, witnessed.authorizationConfig, 'ACL source path drifted');
  assert.deepEqual(current.authorization, witnessed.authorization);
  assert.deepEqual(current.aclFiles, witnessed.aclFiles, 'ACL file identities drifted');
  const aclChanged = identityHash(current.authorization.sources) === identityHash([plan.newAcl]);
  if (!aclChanged) assert.deepEqual(current.authorization, plan.before.authorization);
  const strip = value => {
    const copy = structuredClone(value); delete copy.current_connections; return copy;
  };
  if (witnessed.listeners[listenerId]) {
    assert.deepEqual(strip(current.listeners[listenerId]), strip(witnessed.listeners[listenerId]));
  } else assert.equal(current.listeners[listenerId], undefined);
  assert.equal(current.clients.filter(client => client.listener === listenerId).length, 0,
    'Disconnect all owned validation clients before rollback');
  write(output, 'intent.private.json', encode({ planSha256: expectedSha256, applySha256, current }));
  lock.assertHeld();
  if (current.listeners[listenerId]) await call(`/listeners/${encodeURIComponent(listenerId)}`, { method: 'DELETE' });
  const removed = await readSnapshot(call);
  assert.equal(removed.listeners[listenerId], undefined);
  assertPreserved(plan.before, removed);
  assert.deepEqual(removed.authorization, current.authorization);
  lock.assertHeld();
  if (aclChanged) await call('/configs?mode=merge', {
    method: 'PUT', text: true, body: plan.before.authorizationConfig,
  });
  const restored = await readSnapshot(call);
  assert.equal(restored.authorizationConfig, plan.before.authorizationConfig, 'Original ACL path was not restored');
  assert.deepEqual(restored.authorization, plan.before.authorization);
  const managedPath = '/opt/emqx/data/authz/acl.conf';
  if (!plan.before.aclFiles[managedPath].exists && current.aclFiles[managedPath].exists) {
    assert.deepEqual(restored.aclFiles[managedPath], current.aclFiles[managedPath]);
    removeOwnedAclFile(current.aclFiles[managedPath]);
  }
  const after = await readSnapshot(call);
  assert.deepEqual(after, plan.before);
  const report = { contract: 'existing-mqtt-isolated-rollback-v1', status: 'RESTORED-EXACT-EFFECTIVE-BROKER-CONFIG',
    epoch, planSha256: expectedSha256, applySha256, after, serviceRestart: false };
  write(output, 'report.private.json', encode(report));
  return report;
}

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, strict: true, options: {
    prepare: { type: 'boolean' }, apply: { type: 'boolean' }, rollback: { type: 'boolean' },
    recover: { type: 'boolean' }, continue: { type: 'boolean' },
    'trusted-exclusive-writer-window': { type: 'boolean' },
    output: { type: 'string' }, plan: { type: 'string' }, epoch: { type: 'string' },
    'plan-sha256': { type: 'string' }, 'apply-report': { type: 'string' },
    'apply-sha256': { type: 'string' },
  } });
  assert.equal([values.prepare, values.apply, values.rollback, values.recover, values.continue].filter(Boolean).length, 1);
  assert.ok(path.isAbsolute(values.output ?? ''));
  const lock = acquireMqttWriterLock();
  try {
    const result = values.prepare ? await prepare(values.output)
      : await (values.continue ? continueApply : values.rollback || values.recover ? rollback : apply)({
        output: values.output, filename: values.plan, expectedSha256: values['plan-sha256'], epoch: values.epoch,
        applied: values['apply-report'], applySha256: values['apply-sha256'],
        recover: Boolean(values.recover), lock,
        trustedExclusiveWriterWindow: values['trusted-exclusive-writer-window'],
      });
    console.log(JSON.stringify({ status: result.status, epoch: result.epoch,
      ...(result.planSha256 ? { planSha256: result.planSha256 } : {}),
      ...(result.activeClients !== undefined ? { activeClients: result.activeClients } : {}) }));
  } finally { lock.release(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}

export { apiSession as createMqttBrokerSession, readSnapshot as readMqttBrokerSnapshot };
