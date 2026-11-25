import assert from 'node:assert/strict';
import { generateKeyPairSync, verify } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  aclPatch, acquireMqttWriterLock, assertPreserved, createToken, listenerConfig, listenerId,
} from '../repair-existing-mqtt.mjs';

const identity = { username: 'aibiz_mqtt_0123456789ab_owner', topic: 'aibiz/acceptance/0123456789ab/owner/#' };
const original = { enable: true, type: 'file', rules: '{allow, all}.\n' };
const keys = generateKeyPairSync('rsa', {
  modulusLength: 2048, publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

test('ACL changes name only owned identities and preserve original rules byte for byte', () => {
  const changed = aclPatch(original, [identity]);
  assert.ok(changed.rules.endsWith(original.rules));
  assert.ok(changed.rules.startsWith(`{allow, {username, "${identity.username}"}`));
  assert.ok(changed.rules.includes(`{deny, {username, "${identity.username}"}, all, ["#"]}.`));
  assert.deepEqual(original, { enable: true, type: 'file', rules: '{allow, all}.\n' });
});

test('unowned username, namespace, wildcard scope or non-file sources are rejected', () => {
  for (const item of [
    { ...identity, username: 'shared-user' }, { ...identity, topic: '#' },
    { ...identity, topic: 'aibiz/acceptance/0123456789ab/#' },
  ]) assert.throws(() => aclPatch(original, [item]));
  assert.throws(() => aclPatch({ ...original, type: 'http' }, [identity]));
});

test('isolated listener starts disabled and leaves every legacy listener and global chain unmentioned', () => {
  const config = JSON.parse(listenerConfig({ epoch: 'owned-epoch' }, keys.publicKey));
  assert.deepEqual(Object.keys(config), ['listeners']);
  assert.deepEqual(Object.keys(config.listeners), ['ws']);
  assert.deepEqual(Object.keys(config.listeners.ws), ['aibiz_plm']);
  const listener = config.listeners.ws.aibiz_plm;
  assert.equal(listener.enable, false);
  assert.equal(listener.enable_authn, 'quick_deny_anonymous');
  assert.equal(listener.bind, '0.0.0.0:8085');
  assert.equal(listener.authentication[0].verify_claims.username, '${username}');
  assert.equal(listenerId, 'ws:aibiz_plm');
});

test('owned JWT binds username, audience, issuer, expiry and fail-closed object ACL', () => {
  const token = createToken(keys.privateKey, 'owned-epoch', identity);
  const [header, payload, signature] = token.split('.');
  assert.equal(verify('RSA-SHA256', Buffer.from(`${header}.${payload}`), keys.publicKey,
    Buffer.from(signature, 'base64url')), true);
  const claims = JSON.parse(Buffer.from(payload, 'base64url'));
  assert.equal(claims.username, identity.username);
  assert.equal(claims.aud, 'aibiz-owned-mqtt');
  assert.equal(claims.iss, 'owned-epoch');
  assert.equal(claims.exp - claims.iat, 120);
  assert.deepEqual(claims.acl, { pub: [identity.topic], sub: [identity.topic] });
  assert.throws(() => createToken(keys.privateKey, 'owned-epoch', identity, 10000));
});

function baseline() {
  return {
    runtime: { id: 'existing-runtime' }, authentication: [],
    authorizationSettings: { no_match: 'allow' },
    listeners: Object.fromEntries(['ssl:default', 'tcp:default', 'ws:default', 'wss:default']
      .map(id => [id, { id, enable_authn: true, current_connections: id === 'ws:default' ? 1 : 0 }])),
    clients: [{ clientid: 'known-client', connected: true, connected_at: 'before' }],
  };
}

test('preservation rejects changed legacy auth, global auth and reconnected existing client', () => {
  for (const change of [
    value => { value.authentication = [{ mechanism: 'jwt' }]; },
    value => { value.listeners['ws:default'].enable_authn = false; },
    value => { value.clients[0].connected_at = 'after'; },
    value => { value.clients = []; },
    value => { value.runtime.id = 'changed'; },
  ]) {
    const before = baseline(), after = structuredClone(before);
    change(after);
    assert.throws(() => assertPreserved(before, after));
  }
});

test('preservation allows only new isolated listeners and transient owned clients', () => {
  const before = baseline(), after = structuredClone(before);
  after.listeners[listenerId] = { id: listenerId };
  after.clients.push({ clientid: identity.username, connected: true, connected_at: 'new' });
  assert.doesNotThrow(() => assertPreserved(before, after));
});

test('proven IPv4 wildcard bind rendering is equivalent while concrete-address drift is rejected', () => {
  const before = baseline(), after = structuredClone(before);
  before.listeners['tcp:default'].bind = ':1883';
  after.listeners['tcp:default'].bind = '0.0.0.0:1883';
  assert.doesNotThrow(() => assertPreserved(before, after));
  after.listeners['tcp:default'].bind = '127.0.0.1:1883';
  assert.throws(() => assertPreserved(before, after));
});

test('shared writer lock rejects concurrent writers and never deletes a foreign replacement', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mqtt-lock-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const filename = path.join(dir, 'lock');
  const lock = acquireMqttWriterLock(filename);
  assert.throws(() => acquireMqttWriterLock(filename), /EEXIST/);
  fs.unlinkSync(filename);
  fs.writeFileSync(filename, 'foreign', { mode: 0o600 });
  assert.throws(() => lock.release());
  assert.equal(fs.readFileSync(filename, 'utf8'), 'foreign');
});
