#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import {
  createMqttBrokerSession, readMqttBrokerSnapshot, assertPreserved,
} from './repair-existing-mqtt.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(path.join(root, 'plm-e2e/package.json'));
const { chromium } = require('@playwright/test');
const mqtt = createRequire(path.join(root, 'plm-web/package.json'))('mqtt');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const proxy = 'ws://127.0.0.1:30250/api/ibizplm__plmweb/portal/mqtt/mqtt';
const api = '/api/ibizplm__plmweb';
const timeout = (promise, ms, label) => {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(Error(`${label} timeout`)), ms);
  })]).finally(() => clearTimeout(timer));
};
function credential(filename) {
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    assert.ok(stat.isFile() && stat.uid === process.geteuid() && stat.nlink === 1 && !(stat.mode & 0o077));
    const value = JSON.parse(fs.readFileSync(fd));
    assert.ok(value.username && value.password);
    return value;
  } finally { fs.closeSync(fd); }
}
const connect = (topic, token, reconnectPeriod = 0) => {
  const client = mqtt.connect(proxy, { clientId: `aibiz-native-${randomUUID()}`,
    username: topic, password: token, clean: true, reconnectPeriod, connectTimeout: 5000, keepalive: 10 });
  client.on('error', () => {});
  return { client, ready: timeout(new Promise((resolve, reject) => {
    client.once('connect', () => resolve(client)); client.once('error', reject);
  }), 7000, 'native connect') };
};
const close = client => timeout(new Promise(resolve => client.end(true, resolve)), 4000, 'close');
const subscribe = (client, topic) => timeout(new Promise((resolve, reject) =>
  client.subscribe(topic, { qos: 0 }, (error, grants) => error ? reject(error) : resolve(grants))), 5000, 'subscribe');
function receive(client, topic, marker) {
  return timeout(new Promise(resolve => {
    const handler = (actual, bytes) => {
      if (actual === topic && bytes.toString().includes(marker)) {
        client.removeListener('message', handler); resolve(true);
      }
    };
    client.on('message', handler);
  }), 6000, 'native delivery');
}
async function rejects(topic, token) {
  const { client, ready } = connect(topic, token);
  try {
    await assert.rejects(ready, /not authorized|bad user|Bad username|Not authorized|Connection refused/i);
    return true;
  } finally { await close(client); }
}

export async function verifyNative({ credentialPaths, output }) {
  assert.equal(fs.realpathSync(path.dirname(output)), path.join(root, '.artifacts'));
  assert.match(path.basename(output), /^mqtt-native-verify-[a-z0-9-]+$/);
  fs.mkdirSync(output, { mode: 0o700 });
  const broker = await createMqttBrokerSession();
  const before = await readMqttBrokerSnapshot(broker.call);
  const report = { contract: 'native-mqtt-browser-identity-verification-v1', status: 'FAILED',
    sourceSha256: hash(fs.readFileSync(fileURLToPath(import.meta.url))),
    users: [], crossUser: [], before,
    credentialsLogged: false, syntheticPersonHeaders: false, retainedPublishes: false,
    clientsClosed: false, PLMTokenAcceptance: false };
  const browser = await chromium.launch({ headless: true });
  const actors = [], clients = new Set();
  try {
    for (const filename of credentialPaths) {
      const data = credential(filename);
      const context = await browser.newContext({ locale: 'zh-CN', serviceWorkers: 'block',
        viewport: { width: 1440, height: 900 } });
      try {
        const page = await context.newPage();
        await page.goto('http://127.0.0.1:30250/ibizplm-plmweb/', { waitUntil: 'domcontentloaded' });
        await page.locator('input[type="text"]').first().fill(data.username);
        await page.locator('input[type="password"]').first().fill(data.password);
        const loginWait = page.waitForResponse(response => response.request().method() === 'POST'
          && new URL(response.url()).pathname === `${api}/v7/login`).then(response => response.status());
        const appWait = page.waitForResponse(response => response.status() === 200
          && new URL(response.url()).pathname === `${api}/appdata`).then(async response => ({
            appdata: await response.json(), headers: await response.request().allHeaders(),
          }));
        loginWait.catch(() => {});
        appWait.catch(() => {});
        await page.getByRole('button', { name: /^(?:登录|登陆|Log\s?in|Sign\s?in)$/i }).first().click();
        assert.equal(await loginWait, 200);
        const { appdata, headers } = await appWait;
        assert.ok(headers.authorization?.startsWith('Bearer '));
        const token = headers.authorization.slice('Bearer '.length);
        assert.equal(typeof token, 'string');
        const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url'));
        assert.equal(claims.sub, data.username);
        assert.equal(appdata.context.srfloginname, data.username);
        assert.equal(appdata.context.srforgid, claims.organizationId);
        assert.equal(headers.srforgid, claims.organizationId);
        assert.equal(headers.srfsystemid, 'ibizplm');
        assert.match(appdata.mqtttopic, /^\/s[a-f0-9]{32}\/e[a-f0-9]{32}$/);
        const actor = { username: data.username, token, topic: appdata.mqtttopic,
          organization: headers.srforgid,
          namespace: appdata.mqtttopic.replace(/\/e[a-f0-9]{32}$/, '/#') };
        actors.push(actor);
        const row = { usernameSha256: hash(data.username), topicSha256: hash(actor.topic),
          namespaceSha256: hash(actor.namespace), organizationSha256: hash(actor.organization),
          actualBrowserLogin: true, bootstrapOrganizationMatchesSignedToken: true,
          bootstrapSystem: headers.srfsystemid, nativeConnected: false, wrongTokenDenied: false,
          missingTokenDenied: false, forbiddenSubscribeDenied: false, forbiddenPublishDenied: false,
          ownDelivery: false, reconnectDelivery: false };
        report.users.push(row);
        const parts = token.split('.');
        parts[2] = `${parts[2][0] === 'A' ? 'B' : 'A'}${parts[2].slice(1)}`;
        row.wrongTokenDenied = await rejects(actor.topic, parts.join('.'));
        row.missingTokenDenied = await rejects(actor.topic, '');
        const opened = connect(actor.topic, token, 250);
        clients.add(opened.client);
        actor.client = await opened.ready;
        row.nativeConnected = true;
        assert.equal((await subscribe(actor.client, actor.topic))[0].qos, 0);
        const allTopic = actor.topic.replace(/\/e[a-f0-9]{32}$/, '/all');
        assert.equal((await subscribe(actor.client, allTopic))[0].qos, 0);
        const unrelated = `aibiz/native-denial/${randomUUID()}`;
        assert.equal((await subscribe(actor.client, unrelated))[0].qos, 128);
        row.forbiddenSubscribeDenied = true;
        const marker = `native-positive-${randomUUID()}`;
        const delivery = receive(actor.client, actor.topic, marker);
        await broker.call('/publish', { method: 'POST',
          body: { topic: actor.topic, payload: JSON.stringify({ type: 'CONSOLE', content: marker }),
            qos: 0, retain: false } });
        row.ownDelivery = await delivery;
        const forbidden = `native-forbidden-${randomUUID()}`;
        let unexpected = false;
        const monitor = (topic, bytes) => {
          if (topic === actor.topic && bytes.toString().includes(forbidden)) unexpected = true;
        };
        actor.client.on('message', monitor);
        await new Promise(resolve => actor.client.publish(actor.topic, forbidden, { qos: 0, retain: false }, resolve));
        await new Promise(resolve => setTimeout(resolve, 1000));
        actor.client.removeListener('message', monitor);
        assert.equal(unexpected, false);
        row.forbiddenPublishDenied = true;
        const reconnected = timeout(new Promise(resolve => actor.client.once('connect', resolve)), 12000, 'reconnect');
        actor.client.stream.destroy();
        await reconnected;
        await subscribe(actor.client, actor.topic);
        const after = `native-reconnect-${randomUUID()}`;
        const reconnectDelivery = receive(actor.client, actor.topic, after);
        await broker.call('/publish', { method: 'POST',
          body: { topic: actor.topic, payload: JSON.stringify({ type: 'CONSOLE', content: after }),
            qos: 0, retain: false } });
        row.reconnectDelivery = await reconnectDelivery;
      } finally { await context.close(); }
    }
    for (const actor of actors) for (const other of actors.filter(value => value !== actor)) {
      const tokenTopicMismatchDenied = await rejects(other.topic, actor.token);
      const grants = await subscribe(actor.client, other.topic);
      assert.equal(grants[0].qos, 128);
      report.crossUser.push({
        actorSha256: hash(actor.username), targetSha256: hash(other.username),
        sameNamespace: actor.namespace === other.namespace,
        sameOrganization: actor.organization === other.organization,
        tokenTopicMismatchDenied, subscriptionDenied: true,
      });
    }
    report.status = 'PASS-NATIVE-PLM-TOKEN-MULTIUSER-ACL-PROXY-RECONNECT';
    report.PLMTokenAcceptance = true;
    return report;
  } catch (error) {
    report.error = error.message;
    throw error;
  } finally {
    await Promise.all([...clients].map(client => close(client).catch(() => {})));
    await browser.close();
    report.clientsClosed = true;
    report.after = await readMqttBrokerSnapshot(broker.call);
    assertPreserved(before, report.after);
    const filename = path.join(output, 'report.private.json');
    fs.writeFileSync(filename, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    console.log(JSON.stringify({ status: report.status, users: report.users.length,
      crossUser: report.crossUser.length, clientsClosed: true,
      reportSha256: hash(fs.readFileSync(filename)) }));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { credentials: { type: 'string', multiple: true },
    output: { type: 'string' } }, strict: true });
  verifyNative({ credentialPaths: values.credentials, output: values.output })
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
