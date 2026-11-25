#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { acquireMqttWriterLock, assertPreserved, createMqttBrokerSession,
  readMqttBrokerSnapshot } from './repair-existing-mqtt.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const encode = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const managedAcl = '/opt/emqx/data/authz/acl.conf';
const read = filename => {
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    assert.ok(stat.isFile() && stat.uid === process.geteuid() && stat.nlink === 1 && !(stat.mode & 0o077));
    return fs.readFileSync(fd);
  } finally { fs.closeSync(fd); }
};
const write = (dir, filename, value) => {
  const fd = fs.openSync(path.join(dir, filename), 'wx', 0o600);
  try { fs.writeFileSync(fd, encode(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
};
const sourceSeal = () => [
  fileURLToPath(import.meta.url), path.join(root, 'scripts/tests/protect-existing-mqtt-plm-namespace.test.mjs'),
].map(filename => ({ path: filename, sha256: hash(fs.readFileSync(filename)) }));
const output = dir => {
  assert.equal(fs.realpathSync(path.dirname(dir)), path.join(root, '.artifacts'));
  assert.match(path.basename(dir), /^mqtt-namespace-(?:prepare|apply|rollback)-[a-z0-9-]+$/);
  fs.mkdirSync(dir, { mode: 0o700 });
};

export function namespaceAcl(original, namespace, publisherAddress) {
  assert.equal(original.type, 'file');
  assert.equal(original.enable, true);
  assert.equal(typeof original.rules, 'string');
  assert.match(namespace, /^\/s[a-f0-9]{32}\/#$/);
  assert.match(publisherAddress, /^172\.21\.0\.[1-9][0-9]{0,2}$/);
  return { ...original, rules:
    `{allow, {ipaddr, "${publisherAddress}"}, publish, ["${namespace}"]}.\n`
    + `{deny, all, all, ["${namespace}"]}.\n${original.rules}` };
}

async function nativeNamespace(filename) {
  const credentials = JSON.parse(read(filename));
  const login = await fetch('http://127.0.0.1:30250/api/ibizplm__plmweb/v7/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ loginname: credentials.username, password: credentials.password }),
    signal: AbortSignal.timeout(7000),
  });
  assert.equal(login.status, 200);
  const { token } = await login.json();
  assert.equal(typeof token, 'string');
  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url'));
  const self = await fetch('http://127.0.0.1:30000/uaa/oauth/userinfo', {
    headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(5000),
  });
  assert.equal(self.status, 200);
  assert.equal((await self.json()).sub, credentials.username);
  const app = await fetch('http://127.0.0.1:30000/appdata', {
    headers: { Authorization: `Bearer ${token}`, srfsystemid: 'ibizplm', srforgid: claims.organizationId },
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(app.status, 200);
  const data = await app.json();
  assert.equal(data.context.srfloginname, credentials.username);
  assert.equal(data.context.srfsystemid, 'ibizplm');
  assert.equal(data.context.srforgid, claims.organizationId);
  assert.match(data.mqtttopic, /^\/s[a-f0-9]{32}\/e[a-f0-9]{32}$/);
  return data.mqtttopic.replace(/\/e[a-f0-9]{32}$/, '/#');
}

export async function prepareNamespace(dir, credentials) {
  output(dir);
  const { call } = await createMqttBrokerSession();
  const before = await readMqttBrokerSnapshot(call);
  assert.ok(before.listenerConfig.includes('http://172.21.0.1:18085/authn'));
  assert.equal(before.authorization.sources.length, 1);
  assert.equal(before.aclFiles[managedAcl].exists, false);
  const inspected = spawnSync('docker', ['inspect', 'ibiz-ebsx-allinone'], { encoding: 'utf8', timeout: 5000 });
  assert.equal(inspected.status, 0);
  const publisher = JSON.parse(inspected.stdout)[0];
  assert.equal(publisher.Id, 'a1d148c646a44416cd5d8d0003ee128e83e192e83c8a95517d8fcce218f3c2f3');
  assert.equal(publisher.State.Status, 'running');
  const publisherAddress = publisher.NetworkSettings.Networks.compose_agent_network.IPAddress;
  assert.ok(before.clients.some(client => client.ip_address === publisherAddress
    && client.listener === 'ws:default' && client.connected === true));
  const namespace = await nativeNamespace(credentials);
  const plan = { contract: 'mqtt-plm-namespace-protection-plan-v1', status: 'PREPARED-NOT-APPLIED',
    sourceSeal: sourceSeal(), before, namespace,
    publisher: { containerId: publisher.Id, imageId: publisher.Image, address: publisherAddress,
      startedAt: publisher.State.StartedAt },
    nextAcl: namespaceAcl(before.authorization.sources[0], namespace, publisherAddress),
    globalAnonymousDisabled: false, legacyListenerChanged: false,
    rollback: 'Restore exact original ACL source path while current source content and inode match this plan',
  };
  write(dir, 'prepared.private.json', plan);
  assert.deepEqual(await readMqttBrokerSnapshot(call), before);
  return { status: plan.status, planSha256: hash(encode(plan)) };
}

export async function applyNamespace({ filename, expectedHash, dir, trusted, rollback, appliedPath, appliedHash }) {
  assert.equal(trusted, true);
  const raw = read(filename);
  assert.equal(hash(raw), expectedHash);
  const plan = JSON.parse(raw);
  assert.equal(plan.contract, 'mqtt-plm-namespace-protection-plan-v1');
  assert.deepEqual(plan.sourceSeal, sourceSeal());
  assert.deepEqual(plan.nextAcl, namespaceAcl(plan.before.authorization.sources[0],
    plan.namespace, plan.publisher.address));
  output(dir);
  const { call } = await createMqttBrokerSession();
  let expected = plan.before;
  if (rollback) {
    const receipt = read(appliedPath);
    assert.equal(hash(receipt), appliedHash);
    const applied = JSON.parse(receipt);
    assert.equal(applied.status, 'APPLIED-PLM-NAMESPACE-BOUNDARY');
    assert.equal(applied.planSha256, expectedHash);
    expected = applied.after;
  }
  const before = await readMqttBrokerSnapshot(call);
  assert.deepEqual(before, expected);
  write(dir, 'intent.private.json', { planSha256: expectedHash, before, rollback: Boolean(rollback) });
  if (rollback) {
    await call('/configs?mode=merge', { method: 'PUT', text: true, body: plan.before.authorizationConfig });
  } else {
    await call('/authorization/sources/file', { method: 'PUT', body: plan.nextAcl });
  }
  const after = await readMqttBrokerSnapshot(call);
  assertPreserved(plan.before, after);
  assert.equal(after.listenerConfig, plan.before.listenerConfig);
  assert.deepEqual(after.authorization.sources,
    rollback ? plan.before.authorization.sources : [plan.nextAcl]);
  const report = { contract: 'mqtt-plm-namespace-protection-receipt-v1',
    status: rollback ? 'RESTORED-ORIGINAL-ACL-SOURCE' : 'APPLIED-PLM-NAMESPACE-BOUNDARY',
    planSha256: expectedHash, after, originalPublisherConnectionPreserved: true,
    globalAnonymousDisabled: false, globalAuthenticationChanged: false,
    rollbackManagedFileRetainedForReview: Boolean(rollback),
  };
  write(dir, 'report.private.json', report);
  return { status: report.status, reportSha256: hash(encode(report)) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: {
    prepare: { type: 'boolean' }, apply: { type: 'boolean' }, rollback: { type: 'boolean' },
    credentials: { type: 'string' }, output: { type: 'string' }, plan: { type: 'string' },
    'plan-sha256': { type: 'string' }, 'apply-report': { type: 'string' }, 'apply-sha256': { type: 'string' },
    'trusted-exclusive-writer-window': { type: 'boolean' },
  }, strict: true });
  assert.equal([values.prepare, values.apply, values.rollback].filter(Boolean).length, 1);
  const lock = acquireMqttWriterLock();
  try {
    const result = values.prepare ? await prepareNamespace(values.output, values.credentials)
      : await applyNamespace({ filename: values.plan, expectedHash: values['plan-sha256'],
        dir: values.output, trusted: values['trusted-exclusive-writer-window'], rollback: values.rollback,
        appliedPath: values['apply-report'], appliedHash: values['apply-sha256'] });
    console.log(JSON.stringify(result));
  } finally { lock.release(); }
}
