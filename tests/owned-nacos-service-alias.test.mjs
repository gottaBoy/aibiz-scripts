import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ownedCloudUaaAlias, ownedUaaAlias, publishOwnedUaaAlias, removeOwnedUaaAlias, verifyOwnedUaaAlias,
} from '../owned-nacos-service-alias.mjs';

const runId = 'f01006abcdef';
const origin = 'http://10.91.0.6:8848';
const alias = ownedUaaAlias({ runId, origin: 'http://10.91.0.4:32666' });
const response = value => ({ status: 200, bytes: Buffer.from(
  typeof value === 'string' ? value : JSON.stringify(value)) });
const listing = hosts => ({ name: `nf_${runId}@@uaa-api`, hosts });
const cloudAlias = ownedCloudUaaAlias({
  runId, origin: 'http://10.91.0.8:30000', sourceFingerprint: 'c'.repeat(64),
  target: { containerId: 'a'.repeat(64), imageId: `sha256:${'b'.repeat(64)}`,
    name: `nf-${runId}-backend-control-allinone` },
});

test('Cloud UAA alias pins only the existing allinone identity and reviewed source, never standalone or log service', () => {
  assert.equal(cloudAlias.serviceName, 'ibizcloud-uaa');
  assert.equal(cloudAlias.port, 30000);
  assert.equal(cloudAlias.metadata['aibiz.native-service.container'], 'a'.repeat(64));
  assert.equal(cloudAlias.metadata['aibiz.native-service.source'], 'c'.repeat(64));
  for (const mutate of [
    value => { value.origin = 'http://10.91.0.8:32666'; },
    value => { value.target.name = 'ibiz-ebsx-allinone'; },
    value => { value.target.name = `nf-${runId}-backend-control-provider`; },
    value => { value.target.containerId = 'short'; },
    value => { value.target.imageId = 'aibiz/allinone:latest'; },
    value => { value.sourceFingerprint = 'unknown'; },
  ]) {
    const value = {
      runId, origin: 'http://10.91.0.8:30000', sourceFingerprint: 'c'.repeat(64),
      target: { containerId: 'a'.repeat(64), imageId: `sha256:${'b'.repeat(64)}`,
        name: `nf-${runId}-backend-control-allinone` },
    };
    mutate(value);
    assert.throws(() => ownedCloudUaaAlias(value));
  }
  assert.throws(() => verifyOwnedUaaAlias({}, { ...cloudAlias, serviceName: 'ibizcloud-log' }));
});

test('typed Cloud UAA publication and removal preserve exact target/source metadata with guarded readback', async () => {
  let present = false;
  let requests = 0;
  let guards = 0;
  const options = {
    guard() { guards++; },
    async request(_origin, path, input) {
      requests++;
      if (input?.method === 'POST') {
        assert.equal(input.body.get('serviceName'), 'ibizcloud-uaa');
        assert.deepEqual(JSON.parse(input.body.get('metadata')), cloudAlias.metadata);
        present = true;
        return response('ok');
      }
      if (input?.method === 'DELETE') {
        assert.equal(new URL(`http://owned${path}`).searchParams.get('serviceName'), 'ibizcloud-uaa');
        present = false;
        return response('ok');
      }
      return response({ name: `nf_${runId}@@ibizcloud-uaa`, hosts: present ? [cloudAlias] : [] });
    },
  };
  const result = await publishOwnedUaaAlias(origin, cloudAlias, options);
  assert.equal(result.contract, 'owned-nacos-cloud-uaa-alias-v1');
  assert.equal(result.created, true);
  assert.deepEqual(await removeOwnedUaaAlias(origin, cloudAlias, options), { removed: true, absent: true });
  assert.equal(guards, requests);
  const foreign = structuredClone(cloudAlias);
  foreign.metadata['aibiz.native-service.image'] = `sha256:${'f'.repeat(64)}`;
  let writes = 0;
  const changed = { guard() {}, request: async (_origin, _path, input) => {
    if (input?.method) writes++;
    return response({ name: `nf_${runId}@@ibizcloud-uaa`, hosts: [foreign] });
  } };
  await assert.rejects(publishOwnedUaaAlias(origin, cloudAlias, changed));
  await assert.rejects(removeOwnedUaaAlias(origin, cloudAlias, changed));
  assert.equal(writes, 0);
});

test('only the exact run group and private owned UAA endpoint are eligible', () => {
  assert.equal(alias.serviceName, 'uaa-api');
  assert.equal(alias.groupName, `nf_${runId}`);
  assert.equal(alias.ephemeral, false);
  for (const bad of [
    'http://uaa-api:32666', 'http://127.0.0.1:32666', 'http://8.8.8.8:32666',
    'http://10.91.0.4:30000', 'http://secret@10.91.0.4:32666',
    'http://10.91.0.4:32666/path', 'https://10.91.0.4:32666',
    'http://10.91.0.4:32666/?query=x',
  ]) assert.throws(() => ownedUaaAlias({ runId, origin: bad }));
  for (const bad of ['', 'shared', 'f01006ABCDEf', '../f01006abcdef']) {
    assert.throws(() => ownedUaaAlias({ runId: bad, origin: 'http://10.91.0.4:32666' }));
  }
});

test('alias creation guards every request and verifies the real healthy instance', async () => {
  const calls = [];
  let guards = 0;
  let created = false;
  const result = await publishOwnedUaaAlias(origin, alias, {
    guard: () => { guards++; },
    request: async (url, path, options) => {
      assert.equal(url, origin);
      calls.push({ path, options });
      if (options?.method === 'POST') {
        assert.equal(options.body.get('serviceName'), 'uaa-api');
        assert.equal(options.body.get('groupName'), `nf_${runId}`);
        assert.equal(options.body.get('ip'), alias.ip);
        assert.equal(options.body.get('ephemeral'), 'false');
        assert.deepEqual(JSON.parse(options.body.get('metadata')), alias.metadata);
        created = true;
        return response('ok');
      }
      return response(listing(created ? [alias] : []));
    },
  });
  assert.equal(result.created, true);
  assert.equal(result.refreshAcceptance, false);
  assert.equal(guards, calls.length);
  assert.equal(calls.length, 3);
});

test('an exactly matching preexisting alias is verified without reconfiguration', async () => {
  let writes = 0;
  const result = await publishOwnedUaaAlias(origin, alias, {
    guard() {},
    request: async (_url, _path, options) => {
      if (options?.method) writes++;
      return response(listing([alias]));
    },
  });
  assert.equal(result.created, false);
  assert.equal(writes, 0);
});

for (const [field, value] of [
  ['ip', '10.91.0.99'], ['port', 30000], ['enabled', false], ['ephemeral', true],
  ['clusterName', 'shared'], ['metadata', {}],
]) {
  test(`foreign or changed ${field} is never overwritten or deleted`, async () => {
    let writes = 0;
    const adapters = {
      guard() {},
      request: async (_origin, _path, options) => {
        if (options?.method) writes++;
        return response(listing([{ ...alias, [field]: value }]));
      },
    };
    await assert.rejects(publishOwnedUaaAlias(origin, alias, adapters));
    await assert.rejects(removeOwnedUaaAlias(origin, alias, adapters));
    assert.equal(writes, 0);
  });
}

test('missing, malformed, multiple and cross-group listings fail closed', () => {
  assert.equal(verifyOwnedUaaAlias(listing([]), alias, { allowMissing: true }), false);
  for (const body of [
    listing([]), listing([alias, alias]), { name: 'DEFAULT_GROUP@@uaa-api', hosts: [alias] },
    { name: `nf_${runId}@@uaa-api` }, null,
  ]) assert.throws(() => verifyOwnedUaaAlias(body, alias));
});

test('registration cannot claim readiness from missing or unhealthy readback', async () => {
  for (const hosts of [[], [{ ...alias, healthy: false }]]) {
    let reads = 0;
    let delays = 0;
    await assert.rejects(publishOwnedUaaAlias(origin, alias, {
      guard() {}, delay: async () => { delays++; }, readbackAttempts: 3,
      request: async (_origin, _path, options) => {
        if (options?.method === 'POST') return response('ok');
        return response(listing(reads++ ? hosts : []));
      },
    }), /did not become healthy/);
    assert.equal(reads, 4);
    assert.equal(delays, 2);
  }
});

test('new registration waits for Nacos persistence-policy propagation without adopting foreign instances', async () => {
  let reads = 0;
  const result = await publishOwnedUaaAlias(origin, alias, {
    guard() {}, delay: async () => {},
    request: async (_origin, _path, options) => {
      if (options?.method === 'POST') return response('ok');
      reads++;
      return response(listing(reads === 1 ? []
        : [{ ...alias, ephemeral: reads < 4 }]));
    },
  });
  assert.equal(result.readbackAttempts, 3);
  assert.equal(result.created, true);
});

test('live guard failure prevents publication and cleanup', async () => {
  let requests = 0;
  const adapters = {
    guard() { throw new Error('Owned peer mismatch'); },
    request: async () => { requests++; return response('ok'); },
  };
  await assert.rejects(publishOwnedUaaAlias(origin, alias, adapters), /Owned peer mismatch/);
  await assert.rejects(removeOwnedUaaAlias(origin, alias, adapters), /Owned peer mismatch/);
  assert.equal(requests, 0);
});

test('cleanup removes only the verified exact instance and requires absence readback', async () => {
  let present = true;
  const result = await removeOwnedUaaAlias(origin, alias, {
    guard() {},
    request: async (_origin, path, options) => {
      if (options?.method === 'DELETE') {
        const query = new URL(`http://owned${path}`).searchParams;
        assert.equal(query.get('ip'), alias.ip);
        assert.equal(query.get('groupName'), alias.groupName);
        assert.equal(query.get('ephemeral'), 'false');
        present = false;
        return response('ok');
      }
      return response(listing(present ? [alias] : []));
    },
  });
  assert.deepEqual(result, { removed: true, absent: true });
});

test('invalid or unsuccessful Nacos responses cannot be alias evidence', async () => {
  for (const result of [
    { status: 401, bytes: Buffer.from('{}') }, { status: 500, bytes: Buffer.from('ok') },
    response('not-json'),
  ]) {
    await assert.rejects(publishOwnedUaaAlias(origin, alias, {
      guard() {}, request: async () => result,
    }));
  }
  await assert.rejects(publishOwnedUaaAlias(origin, alias, { request: async () => response('ok') }));
});
