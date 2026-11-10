import assert from 'node:assert/strict';
import { isIP } from 'node:net';

function privateOrigin(origin, port) {
  const url = new URL(origin);
  assert.equal(url.origin, origin);
  assert.equal(url.protocol, 'http:');
  assert.equal(url.port, String(port));
  assert.equal(isIP(url.hostname), 4);
  const [a, b] = url.hostname.split('.').map(Number);
  assert.ok(a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168));
  return url;
}

export function ownedUaaAlias({ runId, origin }) {
  assert.match(runId ?? '', /^[a-f0-9]{12}$/);
  const url = privateOrigin(origin, 32666);
  return {
    serviceName: 'uaa-api', groupName: `nf_${runId}`,
    ip: url.hostname, port: 32666, clusterName: 'DEFAULT',
    enabled: true, healthy: true, ephemeral: false,
    metadata: { 'aibiz.native-fixture.run': runId, 'aibiz.native-service.role': 'uaa' },
  };
}

function validateAlias(alias) {
  const runId = alias?.metadata?.['aibiz.native-fixture.run'];
  assert.deepEqual(alias, ownedUaaAlias({ runId, origin: `http://${alias?.ip}:${alias?.port}` }));
}

function query(alias) {
  return new URLSearchParams({ serviceName: alias.serviceName, groupName: alias.groupName,
    clusters: alias.clusterName, healthyOnly: 'false' });
}

export function verifyOwnedUaaAlias(body, alias, {
  allowMissing = false, allowPendingEphemeral = false,
} = {}) {
  validateAlias(alias);
  assert.equal(body?.name, `${alias.groupName}@@${alias.serviceName}`);
  assert.ok(Array.isArray(body.hosts) && body.hosts.length <= 1,
    'A run-owned alias cannot adopt multiple or foreign instances');
  if (!body.hosts.length) {
    assert.equal(allowMissing, true, 'Owned UAA alias is missing');
    return false;
  }
  const host = body.hosts[0];
  for (const key of ['ip', 'port', 'clusterName', 'enabled']) {
    assert.equal(host[key], alias[key], 'Owned UAA alias target or policy differs');
  }
  assert.deepEqual(host.metadata, alias.metadata, 'Owned UAA alias ownership differs');
  if (allowPendingEphemeral) assert.equal(typeof host.ephemeral, 'boolean');
  else assert.equal(host.ephemeral, alias.ephemeral, 'Owned UAA alias persistence policy differs');
  return true;
}

async function readAlias(origin, alias, request, guard, allowMissing, allowPendingEphemeral = false) {
  await guard();
  const result = await request(origin, `/nacos/v1/ns/instance/list?${query(alias)}`);
  assert.equal(result.status, 200, 'Owned Nacos alias listing failed');
  const body = JSON.parse(result.bytes.toString('utf8'));
  const present = verifyOwnedUaaAlias(body, alias, { allowMissing, allowPendingEphemeral });
  return { present, body };
}

export async function publishOwnedUaaAlias(origin, alias, {
  request, guard, delay = ms => new Promise(resolve => setTimeout(resolve, ms)),
  readbackAttempts = 30, onCreated = () => {},
} = {}) {
  privateOrigin(origin, 8848);
  validateAlias(alias);
  assert.equal(typeof request, 'function');
  assert.equal(typeof guard, 'function', 'Live exact-peer inspection is mandatory');
  assert.equal(typeof onCreated, 'function');
  assert.ok(Number.isSafeInteger(readbackAttempts) && readbackAttempts > 0 && readbackAttempts <= 50);
  const before = await readAlias(origin, alias, request, guard, true);
  if (!before.present) {
    await guard();
    const body = new URLSearchParams(Object.entries(alias).map(([key, value]) => [
      key, key === 'metadata' ? JSON.stringify(value) : String(value),
    ]));
    const result = await request(origin, '/nacos/v1/ns/instance', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body,
    });
    assert.equal(result.status, 200, 'Owned Nacos alias registration failed');
    assert.equal(result.bytes.toString('utf8').trim(), 'ok', 'Owned Nacos rejected alias registration');
    onCreated();
  }
  for (let attempt = 1; attempt <= readbackAttempts; attempt++) {
    const current = await readAlias(origin, alias, request, guard, true, !before.present);
    if (current.present && current.body.hosts[0].healthy === true
        && current.body.hosts[0].ephemeral === alias.ephemeral) {
      return { contract: 'owned-nacos-uaa-alias-v1', status: 'passed-exact-owned-alias-readback',
        alias, created: !before.present, readbackAttempts: attempt,
        nativeAcceptance: false, refreshAcceptance: false };
    }
    assert.ok(attempt < readbackAttempts, 'Owned UAA alias did not become healthy');
    await delay(200);
  }
}

export async function removeOwnedUaaAlias(origin, alias, { request, guard } = {}) {
  privateOrigin(origin, 8848);
  validateAlias(alias);
  assert.equal(typeof request, 'function');
  assert.equal(typeof guard, 'function');
  const before = await readAlias(origin, alias, request, guard, true);
  if (!before.present) return { removed: false, absent: true };
  await guard();
  const parameters = new URLSearchParams({ serviceName: alias.serviceName, groupName: alias.groupName,
    clusterName: alias.clusterName, ip: alias.ip, port: String(alias.port), ephemeral: 'false' });
  const result = await request(origin, `/nacos/v1/ns/instance?${parameters}`, { method: 'DELETE' });
  assert.equal(result.status, 200, 'Owned Nacos alias removal failed');
  assert.equal(result.bytes.toString('utf8').trim(), 'ok', 'Owned Nacos rejected alias removal');
  const after = await readAlias(origin, alias, request, guard, true);
  assert.equal(after.present, false, 'Owned Nacos alias remains after removal');
  return { removed: true, absent: true };
}
