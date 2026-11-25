#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { createMqttBrokerSession, readMqttBrokerSnapshot, assertPreserved } from './repair-existing-mqtt.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const mqtt = createRequire(path.join(root, 'plm-web/package.json'))('mqtt');
const hash = value => createHash('sha256').update(value).digest('hex');
const read = filename => {
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    assert.ok(stat.isFile() && stat.uid === process.geteuid() && stat.nlink === 1 && !(stat.mode & 0o077));
    return JSON.parse(fs.readFileSync(fd));
  } finally { fs.closeSync(fd); }
};
function bounded(promise, label) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(Error(`${label} timeout`)), 6000);
  })]).finally(() => clearTimeout(timer));
}
const opened = new Set();
async function connect(url, username, password) {
  const client = mqtt.connect(url, { clientId: `aibiz-legacy-boundary-${randomUUID()}`,
    username, password, reconnectPeriod: 0, clean: true, connectTimeout: 5000 });
  opened.add(client);
  client.on('error', () => {});
  return bounded(new Promise((resolve, reject) => {
    client.once('connect', () => resolve(client)); client.once('error', reject);
  }), 'connect');
}
const subscribe = (client, topic) => bounded(new Promise((resolve, reject) =>
  client.subscribe(topic, { qos: 0 }, (error, grants) => error ? reject(error) : resolve(grants))), 'subscribe');
const publish = (client, topic, text) => bounded(new Promise(resolve =>
  client.publish(topic, text, { retain: false, qos: 0 }, resolve)), 'publish');
function receive(client, expected, text) {
  return bounded(new Promise(resolve => {
    const handler = (topic, bytes) => {
      if (topic === expected && bytes.toString() === text) {
        client.removeListener('message', handler); resolve(true);
      }
    };
    client.on('message', handler);
  }), 'delivery');
}
const close = client => bounded(new Promise(resolve => client.end(true, resolve)), 'close');

export async function verifyLegacyBoundary({ credentials, output }) {
  assert.equal(fs.realpathSync(path.dirname(output)), path.join(root, '.artifacts'));
  assert.match(path.basename(output), /^mqtt-legacy-verify-[a-z0-9-]+$/);
  fs.mkdirSync(output, { mode: 0o700 });
  const actor = read(credentials), broker = await createMqttBrokerSession();
  const before = await readMqttBrokerSnapshot(broker.call);
  const report = { contract: 'mqtt-legacy-plm-namespace-verification-v1', status: 'FAILED',
    before, endpoints: [], clientsClosed: false, retainedPublishes: false };
  try {
    const login = await fetch('http://127.0.0.1:30250/api/ibizplm__plmweb/v7/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loginname: actor.username, password: actor.password }),
    });
    assert.equal(login.status, 200);
    const { token } = await login.json();
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url'));
    const app = await fetch('http://127.0.0.1:30000/appdata', {
      headers: { Authorization: `Bearer ${token}`, srfsystemid: 'ibizplm', srforgid: claims.organizationId },
    });
    assert.equal(app.status, 200);
    const data = await app.json();
    assert.equal(data.context.srfloginname, actor.username);
    const topic = data.mqtttopic;
    assert.match(topic, /^\/s[a-f0-9]{32}\/e[a-f0-9]{32}$/);
    report.namespaceSha256 = hash(topic.replace(/\/e[a-f0-9]{32}$/, '/#'));
    const native = await connect('ws://127.0.0.1:30250/api/ibizplm__plmweb/portal/mqtt/mqtt', topic, token);
    assert.equal((await subscribe(native, topic))[0].qos, 0);
    assert.equal((await subscribe(native, topic.replace(/\/e[a-f0-9]{32}$/, '/all')))[0].qos, 0);
    for (const url of ['mqtt://127.0.0.1:1883', 'ws://127.0.0.1:8083/mqtt']) {
      const client = await connect(url);
      const row = { endpoint: url, anonymousConnected: true,
        plmSubscribeDenied: false, plmPublishDenied: false, unrelatedTopicControlDelivered: false,
        nativePositiveDelivered: false };
      report.endpoints.push(row);
      assert.equal((await subscribe(client, topic))[0].qos, 128);
      assert.equal((await subscribe(client, topic.replace(/\/e[a-f0-9]{32}$/, '/all')))[0].qos, 128);
      row.plmSubscribeDenied = true;
      const unrelated = `aibiz/acceptance/legacy-control/${randomUUID()}`;
      assert.equal((await subscribe(client, unrelated))[0].qos, 0);
      const text = `unrelated-${randomUUID()}`;
      const control = receive(client, unrelated, text);
      await publish(client, unrelated, text);
      row.unrelatedTopicControlDelivered = await control;
      const forged = `forged-${randomUUID()}`;
      let leaked = false;
      const listener = (actual, bytes) => { if (actual === topic && bytes.toString() === forged) leaked = true; };
      native.on('message', listener);
      await publish(client, topic, forged);
      await new Promise(resolve => setTimeout(resolve, 1200));
      native.removeListener('message', listener);
      assert.equal(leaked, false);
      row.plmPublishDenied = true;
      const valid = `native-positive-${randomUUID()}`;
      const delivered = receive(native, topic, valid);
      await broker.call('/publish', { method: 'POST', body: { topic, payload: valid, qos: 0, retain: false } });
      row.nativePositiveDelivered = await delivered;
      await close(client);
      opened.delete(client);
    }
    report.status = 'PASS-LEGACY-ANONYMOUS-PLM-NAMESPACE-DENIED-NATIVE-PRESERVED';
  } finally {
    await Promise.all([...opened].map(client => close(client).catch(() => {})));
    opened.clear();
    report.clientsClosed = true;
    report.after = await readMqttBrokerSnapshot(broker.call);
    assertPreserved(before, report.after);
    const filename = path.join(output, 'report.private.json');
    fs.writeFileSync(filename, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    console.log(JSON.stringify({ status: report.status, endpoints: report.endpoints.length,
      reportSha256: hash(fs.readFileSync(filename)) }));
  }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { credentials: { type: 'string' }, output: { type: 'string' } },
    strict: true });
  verifyLegacyBoundary({ credentials: values.credentials, output: values.output })
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
