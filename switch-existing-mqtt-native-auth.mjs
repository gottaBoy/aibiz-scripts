#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { acquireMqttWriterLock, assertPreserved,
  createMqttBrokerSession, readMqttBrokerSnapshot } from './repair-existing-mqtt.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const encode = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const unit = 'aibiz-mqtt-native-auth.service';

function unitWitness() {
  const result = spawnSync('systemctl', ['--user', 'show', unit,
    '--property=ActiveState,SubState,MainPID,InvocationID,ExecStart,NRestarts'], { encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 0);
  assert.ok(result.stdout.includes('ActiveState=active\n') && result.stdout.includes('SubState=running\n'));
  return result.stdout;
}
const seals = () => [
  fileURLToPath(import.meta.url), path.join(root, 'scripts/mqtt-native-auth-adapter.mjs'),
  path.join(root, 'scripts/tests/mqtt-native-auth-adapter.test.mjs'),
  path.join(root, 'scripts/repair-existing-mqtt.mjs'),
].map(filename => ({ path: filename, sha256: hash(fs.readFileSync(filename)) }));

function write(dir, filename, value) {
  const fd = fs.openSync(path.join(dir, filename), 'wx', 0o600);
  try { fs.writeFileSync(fd, encode(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}
function read(filename) {
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const info = fs.fstatSync(fd);
    assert.ok(info.isFile() && info.uid === process.geteuid() && info.nlink === 1 && !(info.mode & 0o077));
    return fs.readFileSync(fd);
  } finally { fs.closeSync(fd); }
}
function output(dir) {
  assert.equal(fs.realpathSync(path.dirname(dir)), path.join(root, '.artifacts'));
  assert.match(path.basename(dir), /^mqtt-native-(?:prepare|apply|rollback)-[a-z0-9-]+$/);
  fs.mkdirSync(dir, { mode: 0o700 });
}
async function health() {
  const response = await fetch('http://172.21.0.1:18085/health', { signal: AbortSignal.timeout(3000) });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, 'ready');
}

export async function prepareNativeSwitch(dir) {
  output(dir);
  const { call } = await createMqttBrokerSession();
  const before = await readMqttBrokerSnapshot(call);
  assert.equal(before.listeners['ws:aibiz_plm']?.running, true);
  assert.deepEqual(before.authentication, []);
  await health();
  const listener = structuredClone(before.listeners['ws:aibiz_plm']);
  for (const key of ['id', 'type', 'running', 'current_connections']) delete listener[key];
  const plan = {
    contract: 'mqtt-native-auth-switch-plan-v1', status: 'PREPARED-NOT-APPLIED',
    before, adapterUnit: unit, unitWitness: unitWitness(), sourceSeal: seals(),
    change: { listeners: { ws: { aibiz_plm: { ...listener, authentication: [{
      mechanism: 'password_based', backend: 'http', method: 'post',
      url: 'http://172.21.0.1:18085/authn',
      body: { username: '${username}', password: '${password}' },
      headers: { 'content-type': 'application/json' }, request_timeout: '10s',
      connect_timeout: '2s', pool_size: 4, enable_pipelining: 1,
      ssl: { enable: false }, enable: true,
    }] } } } },
    globalAuthnChanged: false, oldListenerChanged: false, frontendEnabled: false,
    rollback: 'Restore exact previous listener HOCON only while current raw configuration matches successful apply',
    PLMTokenAcceptance: false,
  };
  write(dir, 'prepared.private.json', plan);
  assert.deepEqual(await readMqttBrokerSnapshot(call), before);
  return { status: plan.status, planSha256: hash(encode(plan)) };
}

export async function applyNativeSwitch({ dir, filename, expectedHash, rollback, receiptPath, receiptHash, trusted }) {
  assert.equal(trusted, true);
  const raw = read(filename);
  assert.equal(hash(raw), expectedHash);
  const plan = JSON.parse(raw);
  assert.equal(plan.contract, 'mqtt-native-auth-switch-plan-v1');
  assert.equal(plan.status, 'PREPARED-NOT-APPLIED');
  assert.deepEqual(plan.sourceSeal, seals());
  assert.equal(unitWitness(), plan.unitWitness);
  await health();
  output(dir);
  const { call } = await createMqttBrokerSession();
  let before = plan.before;
  if (rollback) {
    const receipt = read(receiptPath);
    assert.equal(hash(receipt), receiptHash);
    const applied = JSON.parse(receipt);
    assert.equal(applied.status, 'APPLIED-NATIVE-AUTH-ACCEPTANCE-PENDING');
    assert.equal(applied.planSha256, expectedHash);
    before = applied.after;
  }
  assert.deepEqual(await readMqttBrokerSnapshot(call), before);
  write(dir, 'intent.private.json', { planSha256: expectedHash, before, rollback: Boolean(rollback) });
  await call('/configs?mode=merge', {
    method: 'PUT', text: true,
    body: rollback ? plan.before.listenerConfig : JSON.stringify(plan.change),
  });
  const after = await readMqttBrokerSnapshot(call);
  assertPreserved(plan.before, after);
  assert.deepEqual(after.authorization, plan.before.authorization);
  if (rollback) assert.equal(after.listenerConfig, plan.before.listenerConfig);
  else {
    assert.ok(after.listenerConfig.includes('http://172.21.0.1:18085/authn'));
    assert.ok(after.listenerConfig.includes('authentication'));
    assert.equal(after.listeners['ws:aibiz_plm'].running, true);
  }
  const report = {
    contract: 'mqtt-native-auth-switch-receipt-v1',
    status: rollback ? 'RESTORED-EXACT-PREVIOUS-LISTENER-AUTH' : 'APPLIED-NATIVE-AUTH-ACCEPTANCE-PENDING',
    planSha256: expectedHash, after, unitWitness: unitWitness(), sourceSeal: seals(),
    frontendEnabled: false, PLMTokenAcceptance: false,
  };
  write(dir, 'report.private.json', report);
  return { status: report.status, reportSha256: hash(encode(report)) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: {
    prepare: { type: 'boolean' }, apply: { type: 'boolean' }, rollback: { type: 'boolean' },
    output: { type: 'string' }, plan: { type: 'string' }, 'plan-sha256': { type: 'string' },
    'apply-report': { type: 'string' }, 'apply-sha256': { type: 'string' },
    'trusted-exclusive-writer-window': { type: 'boolean' },
  }, strict: true });
  assert.equal([values.prepare, values.apply, values.rollback].filter(Boolean).length, 1);
  const lock = acquireMqttWriterLock();
  try {
    const result = values.prepare ? await prepareNativeSwitch(values.output)
      : await applyNativeSwitch({ dir: values.output, filename: values.plan,
        expectedHash: values['plan-sha256'], rollback: values.rollback,
        receiptPath: values['apply-report'], receiptHash: values['apply-sha256'],
        trusted: values['trusted-exclusive-writer-window'] });
    console.log(JSON.stringify(result));
  } finally { lock.release(); }
}
