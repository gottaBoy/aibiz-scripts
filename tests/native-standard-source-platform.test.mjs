import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const composeRoot = fileURLToPath(new URL('../../plm/deploy/compose/', import.meta.url));
const overlay = 'docker-compose-modeling-native-source-platform.yml';
const entries = ['modelingweb-native-central', 'modelingweb-native-modeldesign'];

function render(extra = []) {
  return JSON.parse(execFileSync('docker', [
    'compose', '--env-file', '.dev', '--env-file', 'source-built-local.env',
    '--profile', 'modeling', '--profile', 'modeling-native',
    '-f', 'docker-compose-dev.yml', '-f', 'docker-compose-modeling-native.yml',
    ...extra.flatMap(file => ['-f', file]), 'config', '--format', 'json',
  ], { cwd: composeRoot, encoding: 'utf8', timeout: 30_000, maxBuffer: 4 * 1024 * 1024 }));
}

test('standard native source-platform overlay only selects the two standard upstreams', () => {
  const source = readFileSync(new URL(
    `../../plm/deploy/compose/${overlay}`, import.meta.url), 'utf8');
  assert.deepEqual([...source.matchAll(/^  ([\w-]+):$/gm)].map(match => match[1]), entries);
  assert.equal((source.match(/NATIVE_PLATFORM_HOST: ibiz-ebsx-allinone-local/g) || []).length, 2);
  assert.doesNotMatch(source, /volumes:|ports:|image:|modelingweb-candidate-/);
});

test('rendered source-platform overlay preserves every setting except the selected upstream', () => {
  const baseline = render();
  const selected = render([overlay]);
  for (const name of entries) {
    baseline.services[name].environment.NATIVE_PLATFORM_HOST = 'ibiz-ebsx-allinone-local';
  }
  assert.deepEqual(selected, baseline);
  for (const [index, name] of entries.entries()) {
    const service = selected.services[name];
    assert.equal(service.environment.NATIVE_PLATFORM_HOST, 'ibiz-ebsx-allinone-local');
    assert.equal(service.ports[0].host_ip, '127.0.0.1');
    assert.equal(service.ports[0].published, String(32006 + index));
    assert.equal(service.ports[0].target, 8080);
    const modelMount = service.volumes.find(volume => volume.target === '/app/model');
    assert.equal(modelMount.read_only, true);
    assert.match(modelMount.source,
      /vendor-upstream\/ibizmodeling-standard\/modelapi-core\/src\/main\/resources\/model\/net\/ibizsys\/modeling$/);
    assert.equal(service.volumes.some(volume =>
      /native-candidate-plugins|\/PSSYSAPP(?:\.simple|\.hubsubapp)?\.json$/.test(volume.target)), false);
  }
});

test('standard source selection does not expand or alter the existing candidate-only overlay', () => {
  const source = readFileSync(new URL(
    '../../plm/deploy/compose/docker-compose-modeling-native-platform-local.yml',
    import.meta.url), 'utf8');
  assert.deepEqual([...source.matchAll(/^  ([\w-]+):$/gm)].map(match => match[1]), [
    'modelingweb-candidate-central', 'modelingweb-candidate-modeldesign',
  ]);
  assert.doesNotMatch(source, /^  modelingweb-native-/m);
});
