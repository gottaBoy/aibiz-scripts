#!/usr/bin/env node
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import mqtt from '/home/my/workspace/ainfra/aibiz/plm-web/node_modules/.pnpm/mqtt@2.18.9/node_modules/mqtt/mqtt.js';

const topic = `aibiz/harness/${randomUUID()}`;
const payload = JSON.stringify({ marker: topic, at: new Date().toISOString() });
const connect = url => new Promise((resolve, reject) => {
  const client = mqtt.connect(url, { clientId: `aibiz-harness-${randomUUID()}`, reconnectPeriod: 0, connectTimeout: 5000 });
  const onError = error => { client.end(true); reject(error); };
  client.once('error', onError);
  client.once('connect', () => { client.removeListener('error', onError); resolve(client); });
});
const waitMessage = (client, timeout = 5000) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('MQTT message timeout')), timeout);
  client.once('message', (name, bytes) => { clearTimeout(timer); resolve({ topic: name, payload: bytes.toString() }); });
});
const close = client => new Promise(resolve => client.end(true, resolve));

const result = { contract: 'existing-emqx-mqtt-runtime-v1', topic, anonymousConfigObserved: true,
  tcp: {}, websocket: {}, reconnect: {}, errors: [], changedDeployment: false };
let tcp;
try {
  tcp = await connect('mqtt://127.0.0.1:1883');
  await new Promise((resolve, reject) => tcp.subscribe(topic, error => error ? reject(error) : resolve()));
  const message = waitMessage(tcp);
  tcp.publish(topic, payload);
  assert.deepEqual(await message, { topic, payload });
  result.tcp = { connected: true, subscribed: true, published: true, received: true };
  await close(tcp);
  tcp = await connect('mqtt://127.0.0.1:1883');
  const reconnectMessage = waitMessage(tcp);
  await new Promise((resolve, reject) => tcp.subscribe(topic, error => error ? reject(error) : resolve()));
  tcp.publish(topic, payload);
  assert.deepEqual(await reconnectMessage, { topic, payload });
  result.reconnect = { connectedAfterClose: true, subscribed: true, published: true, received: true };
} catch (error) {
  result.errors.push({ phase: 'tcp', type: error.name, message: error.message });
} finally {
  if (tcp) await close(tcp);
}
let ws;
try {
  ws = await connect('ws://127.0.0.1:8083/mqtt');
  const wsMessage = waitMessage(ws);
  await new Promise((resolve, reject) => ws.subscribe(topic, error => error ? reject(error) : resolve()));
  ws.publish(topic, payload);
  assert.deepEqual(await wsMessage, { topic, payload });
  result.websocket = { connected: true, subscribed: true, published: true, received: true };
} catch (error) {
  result.errors.push({ phase: 'websocket', type: error.name, message: error.message });
} finally {
  if (ws) await close(ws);
}
result.status = result.errors.length === 0 ? 'PASS-ANONYMOUS-TCP-WEBSOCKET-RECONNECT' : 'FAILED';
console.log(JSON.stringify(result, null, 2));
if (result.errors.length) process.exitCode = 1;
