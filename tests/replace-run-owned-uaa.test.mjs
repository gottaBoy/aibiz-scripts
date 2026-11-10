import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ownedUaaNetworkAliases, ownedUaaRollbackInventory, verifyProtectedNativePeers,
} from '../replace-run-owned-uaa.mjs';

const peers = Array.from({ length: 7 }, (_, index) => ({
  Id: (index + 1).toString(16).padStart(64, '0'),
  Name: `/nf-owned-protected-${index}`, Image: `sha256:${'a'.repeat(64)}`,
  State: { Running: true, StartedAt: 'original-start' }, RestartCount: 0,
  Config: { Labels: { owner: 'fixture' } }, HostConfig: { ReadonlyRootfs: true },
  Mounts: [{ Type: 'bind', Source: '/owned/config', Destination: '/config', RW: false }],
  NetworkSettings: { Networks: { owned: { NetworkID: 'original-network' } } },
}));

test('UAA replacement preserves all seven other owned peers regardless of enumeration order', () => {
  assert.doesNotThrow(() => verifyProtectedNativePeers(peers, structuredClone(peers).reverse()));
  for (const before of [[], peers.slice(1)]) {
    assert.throws(() => verifyProtectedNativePeers(before, peers));
  }
});

for (const [name, change] of [
  ['identity', p => { p.Id = 'f'.repeat(64); }],
  ['image', p => { p.Image = `sha256:${'b'.repeat(64)}`; }],
  ['restart', p => { p.State.StartedAt = 'changed-start'; }],
  ['stopped service', p => { p.State.Running = false; }],
  ['configuration', p => { p.Config.Labels.owner = 'foreign'; }],
  ['writable mount', p => { p.Mounts[0].RW = true; }],
  ['network', p => { p.NetworkSettings.Networks.owned.NetworkID = 'foreign'; }],
]) {
  test(`replacement guard rejects protected-peer ${name} drift`, () => {
    const current = structuredClone(peers);
    change(current[0]);
    assert.throws(() => verifyProtectedNativePeers(peers, current));
  });
}

const runId = '5d3585516a77';
test('successive replacements preserve the configured original UAA name as well as current owned aliases', () => {
  const options = { runId, oldName: `nf-${runId}-uaa-second`,
    aliases: [`nf-${runId}-uaa-first`, `nf-${runId}-uaa-second`, 'shortid', 'foreign'],
    authenticationServiceUrl: `http://nf-${runId}-uaa-original:32666` };
  assert.deepEqual(ownedUaaNetworkAliases(options), [
    `nf-${runId}-uaa-first`, `nf-${runId}-uaa-original`, `nf-${runId}-uaa-second`,
  ]);
  for (const url of ['http://shared:32666', 'http://10.0.0.4:32666',
    `https://nf-${runId}-uaa-original:32666`, `http://nf-${runId}-uaa-original:32666/path`,
    `http://secret@nf-${runId}-uaa-original:32666`, 'http://nf-000000000000-uaa-original:32666']) {
    assert.throws(() => ownedUaaNetworkAliases({ ...options, authenticationServiceUrl: url }));
  }
});

const network = { Id: 'c'.repeat(64), Name: `nf-${runId}-private` };
const original = {
  ...structuredClone(peers[0]),
  Name: `/nf-${runId}-uaa-original`,
  Config: { Labels: { 'aibiz.native-fixture.run': runId } },
  NetworkSettings: { Networks: { [network.Name]: { NetworkID: network.Id } } },
};
const replacement = {
  ...structuredClone(original), Id: 'b'.repeat(64), Name: `/nf-${runId}-uaa-refresh-cache-r1`,
  Image: `sha256:${'d'.repeat(64)}`,
  Config: { Labels: {
    'aibiz.native-fixture.run': runId, 'aibiz.owned-uaa.replacement': 'refresh-cache-r1',
  } },
};
const inventory = (current, candidate) => ownedUaaRollbackInventory({
  original, current, replacement: candidate, network, runId, label: 'refresh-cache-r1',
  imageId: replacement.Image,
});

for (const running of [true, false]) {
  for (const attached of [true, false]) {
    test(`rollback derives actual state after uncertain Docker transition: running=${running}, attached=${attached}`, () => {
      const current = structuredClone(original);
      current.State.Running = running;
      current.State.StartedAt = 'transition';
      if (!attached) current.NetworkSettings.Networks = {};
      assert.deepEqual(inventory(current), {
        oldRunning: running, oldAttached: attached, replacementId: null,
      });
    });
  }
}

test('rollback discovers a created replacement even when Docker run did not return its id', () => {
  assert.equal(inventory(original, replacement).replacementId, replacement.Id);
  const created = structuredClone(replacement);
  created.State.Running = false;
  created.NetworkSettings.Networks = {};
  assert.equal(inventory(original, created).replacementId, created.Id);
});

test('rollback refuses configuration drift and foreign replacement identity or network', () => {
  const drift = structuredClone(original);
  drift.Config.Labels.foreign = true;
  assert.throws(() => inventory(drift));
  for (const mutate of [
    candidate => { candidate.Id = original.Id; },
    candidate => { candidate.Name = '/shared-uaa'; },
    candidate => { candidate.Image = original.Image; },
    candidate => { candidate.Config.Labels['aibiz.native-fixture.run'] = 'foreign'; },
    candidate => { candidate.Config.Labels['aibiz.owned-uaa.replacement'] = 'foreign'; },
    candidate => { candidate.NetworkSettings.Networks.shared = { NetworkID: network.Id }; },
    candidate => { candidate.NetworkSettings.Networks[network.Name].NetworkID = 'foreign'; },
  ]) {
    const candidate = structuredClone(replacement);
    mutate(candidate);
    assert.throws(() => inventory(original, candidate));
  }
});
