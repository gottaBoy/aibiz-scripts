import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { RUNTIME_SOURCE_LEDGER } from '../version-ledger.mjs';

const workspace = new URL('../../', import.meta.url);
const read = path => readFile(new URL(path, workspace), 'utf8');
const env = await read('plm/deploy/compose/source-built-local.env');

function setting(name) {
  const matches = [...env.matchAll(new RegExp(`^${name}=([^\\r\\n]+)$`, 'gm'))];
  assert.equal(matches.length, 1, `${name} must be pinned exactly once`);
  return matches[0][1];
}

test('local platform env and runtime ledger refer to the same real source build', async () => {
  const allinone = RUNTIME_SOURCE_LEDGER['ibiz-ebsx-allinone-local'];
  const gateway = RUNTIME_SOURCE_LEDGER['ibiz-ebsx-gateway-local'];
  assert.equal(allinone.mode, 'image-receipt');
  assert.equal(gateway.mode, 'image-receipt');
  assert.equal(allinone.receipt, gateway.receipt);
  assert.ok(env.includes(`# Build receipt (UTC date): ${allinone.receipt}\n`));
  const receipt = JSON.parse(await read(allinone.receipt));
  assert.match(receipt.source.sha256, /^[a-f0-9]{64}$/);
  assert.match(receipt.source.git_commit, /^[a-f0-9]{40}$/);
  assert.equal(receipt.build.platform, 'linux/arm64');
  assert.equal(setting('IBIZ_JAVA_IMAGE'), receipt.build.java.resolved);
  assert.match(receipt.build.java.resolved, /@sha256:[a-f0-9]{64}$/);
  assert.match(receipt.build.maven.resolved, /@sha256:[a-f0-9]{64}$/);
  assert.equal(setting('IBIZ_LOCAL_VERSION'), receipt.reactor.version);
  assert.equal(receipt.reactor.runtime_version, receipt.reactor.version);
  assert.equal(receipt.reactor.gateway_version, receipt.reactor.version);
  for (const [metadata, variable] of [
    [allinone, 'IBIZ_LOCAL_ALLINONE_IMAGE'], [gateway, 'IBIZ_LOCAL_GATEWAY_IMAGE'],
  ]) {
    const image = receipt.images[metadata.imageKey];
    assert.equal(setting(variable), image.reference);
    assert.equal(image.version_label, receipt.reactor.version);
    assert.equal(image.platform, receipt.build.platform);
    assert.match(image.image_id, /^sha256:[a-f0-9]{64}$/);
    assert.ok(image.reference.endsWith(`:${receipt.images.tag}`));
    assert.match(receipt.artifacts[metadata.imageKey].sha256, /^[a-f0-9]{64}$/);
  }
});

test('local platform stays on isolated ports and does not opt into formal services', async () => {
  assert.equal(setting('IBIZ_LOCAL_ALLINONE_PORT'), '30100');
  assert.equal(setting('IBIZ_LOCAL_GATEWAY_PORT'), '30186');
  assert.doesNotMatch(env, /^COMPOSE_PROFILES=/m);
  const compose = await read('plm/deploy/compose/docker-compose-platform-local.yml');
  for (const name of ['ibiz-ebsx-allinone', 'ibiz-ebsx-gateway', 'ibizlab-uaa-api']) {
    assert.ok(compose.includes(`  ${name}:\n    profiles:\n      - formal\n`));
  }
  assert.ok(compose.includes('${IBIZ_LOCAL_ALLINONE_PORT:-30100}:30000'));
  assert.ok(compose.includes('${IBIZ_LOCAL_GATEWAY_PORT:-30186}:30086'));
  assert.ok(compose.includes('name: ibiz-ebsx-allinone-local-data'));
});

test('native source-platform routing is an explicit candidate-only overlay', async () => {
  const overlay = await read('plm/deploy/compose/docker-compose-modeling-native-isolated-platform.yml');
  assert.deepEqual([...overlay.matchAll(/^  ([\w-]+):$/gm)].map(match => match[1]), [
    'modelingweb-candidate-central', 'modelingweb-candidate-modeldesign',
  ]);
  assert.equal((overlay.match(/NATIVE_PLATFORM_HOST: ibiz-ebsx-allinone-local/g) || []).length, 2);
  const checklist = await read('scripts/docs/FULL-LINK-REGRESSION-CHECKLIST.md');
  assert.match(checklist, /--profile modeling --profile modeling-native-candidate/);
  assert.match(checklist, /-f docker-compose-modeling-native-service-candidate\.yml/);
  assert.match(checklist, /-f docker-compose-modeling-native-platform-local\.yml/);
  assert.match(checklist, /npm run test:native-platform-api/);
});
