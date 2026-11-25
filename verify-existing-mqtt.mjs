#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createToken } from './repair-existing-mqtt.mjs';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(workspace, 'plm-web/package.json'));
const mqtt = require('mqtt');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const encode = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const bounded = (operation, timeout, label) => Promise.race([
  operation,
  new Promise((_, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out`)), timeout);
    timer.unref();
    operation.finally(() => clearTimeout(timer)).catch(() => {});
  }),
]);

function privateRead(filename) {
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const info = fs.fstatSync(fd);
    assert.ok(info.isFile() && info.uid === process.geteuid() && info.nlink === 1 && !(info.mode & 0o077));
    return fs.readFileSync(fd);
  } finally { fs.closeSync(fd); }
}

function connect(url, username, password, reconnectPeriod = 0) {
  const client = mqtt.connect(url, {
    clientId: `aibiz-verified-${randomUUID()}`, username, password,
    clean: true, reconnectPeriod, connectTimeout: 5000, keepalive: 10,
  });
  client.on('error', () => {});
  const ready = bounded(new Promise((resolve, reject) => {
    client.once('connect', () => resolve(client));
    client.once('error', reject);
  }), 7000, 'MQTT authentication');
  return { client, ready };
}

const close = client => bounded(new Promise(resolve => client.end(true, resolve)), 4000, 'client close');
const subscribe = (client, topic) => bounded(new Promise((resolve, reject) =>
  client.subscribe(topic, { qos: 0 }, (error, grants) => error ? reject(error) : resolve(grants))), 5000, 'subscribe');
const publish = (client, topic, text) => bounded(new Promise((resolve, reject) =>
  client.publish(topic, text, { qos: 0, retain: false }, error => error ? reject(error) : resolve())), 5000, 'publish');

function message(client, expectedTopic, expectedText) {
  return bounded(new Promise(resolve => {
    const listener = (topic, bytes) => {
      if (topic === expectedTopic && bytes.toString() === expectedText) {
        client.removeListener('message', listener);
        resolve(true);
      }
    };
    client.on('message', listener);
  }), 6000, 'message delivery');
}

async function rejected(url, username, password) {
  const { client, ready } = connect(url, username, password);
  try {
    await assert.rejects(ready, /not authorized|bad user|Bad username|Not authorized|Connection refused/i);
    return true;
  } finally { await close(client); }
}

export async function verifyMqtt({ planPath, planSha256, output, proxyUrl }) {
  assert.equal(path.dirname(output), path.join(workspace, '.artifacts'));
  assert.match(path.basename(output), /^mqtt-verify-[a-z0-9-]+$/);
  fs.mkdirSync(output, { mode: 0o700 });
  const planBytes = privateRead(planPath);
  assert.equal(hash(planBytes), planSha256);
  const plan = JSON.parse(planBytes);
  const key = privateRead(path.join(path.dirname(planPath), 'private-key.private.pem')).toString();
  const result = spawnSync('docker', ['inspect', 'emqx'], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0);
  const container = JSON.parse(result.stdout)[0];
  assert.equal(container.Id, plan.before.runtime.containerId);
  assert.equal(container.Image, plan.before.runtime.imageId);
  assert.equal(container.State.StartedAt, plan.before.runtime.startedAt);
  const peer = container.NetworkSettings.Networks.compose_agent_network.IPAddress;
  assert.match(peer, /^\d+\.\d+\.\d+\.\d+$/);
  const urls = [`ws://${peer}:8085/mqtt`, ...(proxyUrl ? [proxyUrl] : [])];
  const report = {
    contract: 'existing-mqtt-authenticated-verification-v1',
    status: 'FAILED', epoch: plan.epoch, planSha256, cases: [],
    legacyListenerWrites: false, globalAuthnWrites: false,
    retainedPublishes: false, PLMTokenAcceptance: false, clientsClosed: false,
    sourceSha256: hash(fs.readFileSync(fileURLToPath(import.meta.url))),
  };
  const clients = new Set();
  const opened = async (url, identity, reconnectPeriod = 0) => {
    const { client, ready } = connect(url, identity.username,
      createToken(key, plan.epoch, identity), reconnectPeriod);
    clients.add(client);
    return ready;
  };
  try {
    const [owner, other] = plan.identities;
    for (const url of urls) {
      const row = { endpoint: url, correctIdentity: false, wrongTokenRejected: false,
        missingTokenRejected: false, crossIdentityRejected: false, expiredTokenRejected: false,
        subscribeOutsideDenied: false, publishOutsideDenied: false, reconnectDelivered: false };
      report.cases.push(row);
      const token = createToken(key, plan.epoch, owner);
      row.wrongTokenRejected = await rejected(url, owner.username, token.replace(/^./, 'x'));
      row.missingTokenRejected = await rejected(url, owner.username, '');
      row.crossIdentityRejected = await rejected(url, other.username, token);
      row.expiredTokenRejected = await rejected(url, owner.username, createToken(key, plan.epoch, owner, -1));
      const subscriber = await opened(url, owner, 250);
      const sender = await opened(url, owner);
      const ownerTopic = owner.topic.replace(/#$/, 'message');
      const otherTopic = other.topic.replace(/#$/, 'message');
      const grants = await subscribe(subscriber, ownerTopic);
      assert.equal(grants[0].qos, 0);
      const firstText = `valid-${randomUUID()}`;
      const received = message(subscriber, ownerTopic, firstText);
      await publish(sender, ownerTopic, firstText);
      assert.equal(await received, true);
      row.correctIdentity = true;
      const denied = await subscribe(subscriber, otherTopic);
      assert.equal(denied[0].qos, 128, 'A forbidden subscription must be rejected by SUBACK');
      row.subscribeOutsideDenied = true;
      const otherClient = await opened(url, other);
      await subscribe(otherClient, otherTopic);
      const control = `other-control-${randomUUID()}`;
      const controlReceived = message(otherClient, otherTopic, control);
      await publish(otherClient, otherTopic, control);
      await controlReceived;
      const forbiddenText = `forbidden-${randomUUID()}`;
      let leaked = false;
      const check = (topic, bytes) => { if (topic === otherTopic && bytes.toString() === forbiddenText) leaked = true; };
      otherClient.on('message', check);
      await publish(sender, otherTopic, forbiddenText);
      await new Promise(resolve => setTimeout(resolve, 1200));
      otherClient.removeListener('message', check);
      assert.equal(leaked, false, 'A rejected publish must not reach the other owned identity');
      row.publishOutsideDenied = true;
      const reconnect = bounded(new Promise(resolve => subscriber.once('connect', resolve)), 10000, 'reconnect');
      subscriber.stream.destroy();
      await reconnect;
      await subscribe(subscriber, ownerTopic);
      const reconnectText = `reconnected-${randomUUID()}`;
      const afterReconnect = message(subscriber, ownerTopic, reconnectText);
      await publish(sender, ownerTopic, reconnectText);
      assert.equal(await afterReconnect, true);
      row.reconnectDelivered = true;
      for (const client of [subscriber, sender, otherClient]) {
        await close(client);
        clients.delete(client);
      }
    }
    report.status = 'PASS-AUTHENTICATED-BROKER-ACL-WEBSOCKET-RECONNECT';
    return report;
  } finally {
    await Promise.all([...clients].map(client => close(client).catch(() => {})));
    report.clientsClosed = true;
    const filename = path.join(output, 'report.private.json');
    const fd = fs.openSync(filename, 'wx', 0o600);
    try { fs.writeFileSync(fd, encode(report)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    console.log(JSON.stringify({ status: report.status, cases: report.cases.length,
      reportSha256: hash(fs.readFileSync(filename)), clientsClosed: report.clientsClosed }));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: {
    plan: { type: 'string' }, 'plan-sha256': { type: 'string' }, output: { type: 'string' },
    'proxy-url': { type: 'string' },
  }, strict: true });
  verifyMqtt({ planPath: values.plan, planSha256: values['plan-sha256'], output: values.output,
    proxyUrl: values['proxy-url'] }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
