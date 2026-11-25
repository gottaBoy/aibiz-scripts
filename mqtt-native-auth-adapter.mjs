#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const hash = value => createHash('sha256').update(value).digest('hex');
const deny = () => ({ result: 'deny' });
const ownTopicPattern = /^\/s[a-f0-9]{32}\/e[a-f0-9]{32}$/;
const exactTopicPattern = /^[A-Za-z0-9_.:/-]{1,512}$/;

export async function authenticateNativeMqtt(input, nativeRead, now = Math.floor(Date.now() / 1000)) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return deny();
  const { username, password } = input;
  if (typeof username !== 'string' || !ownTopicPattern.test(username)
      || typeof password !== 'string' || password.length > 8192 || password.split('.').length !== 3) return deny();
  let claims;
  try { claims = JSON.parse(Buffer.from(password.split('.')[1], 'base64url')); } catch { return deny(); }
  if (typeof claims.sub !== 'string' || !claims.sub || !Number.isInteger(claims.exp) || claims.exp <= now
      || typeof claims.organizationId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(claims.organizationId)) return deny();

  try {
    const self = await nativeRead('/uaa/oauth/userinfo', { Authorization: `Bearer ${password}` });
    if (self.status !== 200 || self.data?.sub !== claims.sub) return deny();
    const app = await nativeRead('/appdata', {
      Authorization: `Bearer ${password}`, srfsystemid: 'ibizplm', srforgid: claims.organizationId,
    });
    const data = app.data;
    if (app.status !== 200 || !data || data.mqtttopic !== username
        || data.context?.srfsystemid !== 'ibizplm'
        || data.context?.srforgid !== claims.organizationId
        || data.context?.srfloginname !== self.data.sub) return deny();
    const allTopic = username.replace(/\/e[a-f0-9]{32}$/, '/all');
    const topics = new Set([username, allTopic]);
    if (data.extmqtttopic !== undefined) {
      if (!data.extmqtttopic || typeof data.extmqtttopic !== 'object' || Array.isArray(data.extmqtttopic)) return deny();
      for (const topic of Object.values(data.extmqtttopic)) {
        if (typeof topic !== 'string' || !exactTopicPattern.test(topic)) return deny();
        topics.add(topic);
      }
    }
    return {
      result: 'allow', is_superuser: false, expire_at: claims.exp,
      acl: [
        ...[...topics].map(topic => ({ permission: 'allow', action: 'subscribe', topic })),
        { permission: 'deny', action: 'all', topic: '#' },
      ],
    };
  } catch { return deny(); }
}

export function makeNativeReader(origin) {
  const url = new URL(origin);
  assert.equal(url.protocol, 'http:');
  assert.equal(url.hostname, '127.0.0.1');
  assert.equal(url.pathname + url.search + url.hash, '/');
  return async (suffix, headers) => {
    assert.ok(['/uaa/oauth/userinfo', '/appdata'].includes(suffix));
    const response = await fetch(new URL(suffix, url), {
      headers, redirect: 'error', signal: AbortSignal.timeout(4000),
    });
    const bytes = Buffer.from(await response.arrayBuffer());
    assert.ok(bytes.length <= 1024 * 1024);
    return { status: response.status, data: bytes.length ? JSON.parse(bytes) : null };
  };
}

export function createNativeAuthServer({ brokerAddress, bindAddress, nativeRead }) {
  assert.match(brokerAddress, /^\d+\.\d+\.\d+\.\d+$/);
  assert.match(bindAddress, /^\d+\.\d+\.\d+\.\d+$/);
  const counts = { allowed: 0, denied: 0, rejectedPeer: 0, active: 0 };
  const server = http.createServer(async (request, response) => {
    const reply = (status, body) => {
      response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
      response.end(JSON.stringify(body));
    };
    if (request.method === 'GET' && request.url === '/health') {
      reply(200, { status: 'ready', ...counts });
      return;
    }
    if (request.socket.remoteAddress !== brokerAddress) {
      counts.rejectedPeer++;
      request.resume();
      reply(403, deny());
      return;
    }
    if (request.method !== 'POST' || request.url !== '/authn' || counts.active >= 8) {
      request.resume();
      reply(403, deny());
      return;
    }
    counts.active++;
    try {
      const parts = [];
      let bytes = 0;
      for await (const part of request) {
        bytes += part.length;
        if (bytes > 16384) throw Error('bounded-request');
        parts.push(part);
      }
      const result = await authenticateNativeMqtt(JSON.parse(Buffer.concat(parts)), nativeRead);
      if (result.result === 'allow') counts.allowed++; else counts.denied++;
      reply(200, result);
    } catch {
      counts.denied++;
      reply(200, deny());
    } finally { counts.active--; }
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 5000;
  server.maxHeadersCount = 20;
  return { server, counts, bindAddress };
}

function runtimeAddresses() {
  const result = spawnSync('docker', ['inspect', 'emqx', 'ibiz-ebsx-allinone'], {
    encoding: 'utf8', timeout: 10000, maxBuffer: 4 * 1024 * 1024,
  });
  assert.equal(result.status, 0);
  const [broker, allinone] = JSON.parse(result.stdout);
  assert.equal(broker.Id, 'cedaa102a56f114ec4b3a731feae20e406dbb4fca846d0bdb71bbbba3b968eeb');
  assert.equal(allinone.Id, 'a1d148c646a44416cd5d8d0003ee128e83e192e83c8a95517d8fcce218f3c2f3');
  for (const item of [broker, allinone]) assert.equal(item.State.Status, 'running');
  const network = broker.NetworkSettings.Networks.compose_agent_network;
  const published = allinone.NetworkSettings.Ports['30000/tcp'];
  assert.equal(published.length >= 1, true);
  const port = published[0].HostPort;
  assert.match(port, /^\d{1,5}$/);
  return { brokerAddress: network.IPAddress, bindAddress: network.Gateway,
    nativeOrigin: `http://127.0.0.1:${port}/`,
    runtime: { brokerId: broker.Id, brokerImage: broker.Image,
      allinoneId: allinone.Id, allinoneImage: allinone.Image } };
}

export async function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, strict: true, options: { port: { type: 'string', default: '18085' } } });
  assert.equal(values.port, '18085');
  const addresses = runtimeAddresses();
  const { server } = createNativeAuthServer({
    ...addresses, nativeRead: makeNativeReader(addresses.nativeOrigin),
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(Number(values.port), addresses.bindAddress, resolve);
  });
  console.log(JSON.stringify({
    contract: 'native-mqtt-self-auth-adapter-v1', status: 'LISTENING-NOT-YET-CONFIGURED-IN-BROKER',
    bindAddress: addresses.bindAddress, port: Number(values.port),
    runtime: addresses.runtime,
    subjectPolicy: 'native-Bearer-self-then-appdata-with-validated-token-organization',
    credentialsLogged: false,
  }));
  const stop = () => server.close(() => process.exit(0));
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  return server;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
