import assert from 'node:assert/strict';
import test from 'node:test';
import {
  apiDocumentationDelta, apiDocumentationRuntimeWitness,
} from '../prepare-existing-api-documentation-release.mjs';

const h = value => value.repeat(64);
const row = (path, sha256) => ({ path, sha256, bytes: 1, uid: '101', gid: '101', mode: '644', dev: '1', ino: '2' });
const root = '/workspace';
const runtime = {
  Id: '70327c269425370bed8648bcaa90feadf441ff7a6c5f75b975889cf4c5416612',
  Image: 'sha256:027de06a1f8d8d5e44e17b849d44d39a421c6fe0787433b5e229ba00655ca99c',
  Name: '/plmweb', State: { Status: 'running', StartedAt: '2026-11-22T03:37:30Z' },
  RestartCount: 0, HostConfig: { Tmpfs: { '/dist': 'mode=0755' } },
  Config: { Env: ['LOCAL_DIST_SOURCE=/opt/aibiz/local-dist', 'PRIVATE_INPUT=must-not-appear'] },
  Mounts: [
    ['plm-web/dist', '/opt/aibiz/local-dist'], ['plm-web/public/plugins', '/opt/aibiz/local-plugins'],
    ['plm/model', '/app/model'],
  ].map(([source, destination]) => ({ Type: 'bind', Source: `${root}/${source}`, Destination: destination, RW: false })),
};

test('release differences preserve existing-only Data Model files and install only changed candidates with the index last', () => {
  const candidate = [row('index.html', h('a')), row('script/docsify.js', h('b')),
    row('api-reference/en/search.json', h('c'))];
  const host = [row('index.html', h('d')), row('script/docsify.js', h('b')),
    row('module/original.md', h('f'))];
  const container = [row('index.html', h('d')), row('script/docsify.js', h('e')),
    row('module/original.md', h('f'))];
  const original = structuredClone({ candidate, host, container });
  const delta = apiDocumentationDelta(candidate, host, container);
  assert.deepEqual(delta.host.map(row => row.path), ['api-reference/en/search.json', 'index.html']);
  assert.deepEqual(delta.container.map(row => row.path), ['api-reference/en/search.json', 'script/docsify.js', 'index.html']);
  assert.equal(delta.host.some(row => row.path === 'module/original.md'), false);
  assert.deepEqual(delta.host[0].previous, { exists: false });
  assert.deepEqual(delta.host.at(-1).previous, host[0]);
  assert.deepEqual({ candidate, host, container }, original);
});

test('unsafe or ambiguous release file inputs fail before emitting a delta', () => {
  for (const path of ['../outside', '/doc/index.html', 'doc/../index.html', 'doc\\index.html', 'doc/\nindex.html']) {
    assert.throws(() => apiDocumentationDelta([row(path, h('a'))], [], []));
  }
  assert.throws(() => apiDocumentationDelta([row('index.html', h('a')), row('index.html', h('b'))], [], []));
  assert.throws(() => apiDocumentationDelta([row('index.html', 'bad-digest')], [], []));
});

test('runtime binding requires the exact existing PLM image, readonly source mounts and tmpfs serving directory without exposing environment values', () => {
  const witness = apiDocumentationRuntimeWitness(runtime, root);
  assert.equal(witness.id, runtime.Id);
  assert.equal(witness.configurationSha256.length, 64);
  assert.doesNotMatch(JSON.stringify(witness), /PRIVATE_INPUT|must-not-appear/);
  assert.deepEqual(apiDocumentationRuntimeWitness({ ...runtime, Mounts: [...runtime.Mounts].reverse() }, root), witness);
  for (const change of [
    value => { value.Id = '0'.repeat(64); },
    value => { value.Image = `sha256:${'0'.repeat(64)}`; },
    value => { value.State.Status = 'exited'; },
    value => { value.Mounts[0].RW = true; },
    value => { value.Mounts[0].Source = '/other-project/dist'; },
    value => { delete value.HostConfig.Tmpfs['/dist']; },
    value => { value.Config.Env = []; },
  ]) {
    const value = structuredClone(runtime); change(value);
    assert.throws(() => apiDocumentationRuntimeWitness(value, root));
  }
});
