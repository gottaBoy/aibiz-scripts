import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import test from 'node:test';

const execute = promisify(execFile);
const source = await readFile(new URL('../../modelingweb/start.sh', import.meta.url), 'utf8');
const nativeNginx = await readFile(new URL('../../modelingweb/nginx-native.conf', import.meta.url), 'utf8');

async function fixture(t, host) {
  const root = await mkdtemp(join(tmpdir(), 'native-platform-upstream-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'dist/environments'), { recursive: true });
  await mkdir(join(root, 'bin'));
  const paths = {
    '/opt/aibiz/nginx-native.conf': join(root, 'native.conf'),
    '/etc/nginx/conf.d/nginx.conf': join(root, 'served.conf'),
    '/environment.config': join(root, 'environment.config'),
    '/dist': join(root, 'dist'),
  };
  let script = source;
  for (const [from, to] of Object.entries(paths)) script = script.replaceAll(from, to);
  await writeFile(join(root, 'start.sh'), script);
  await writeFile(paths['/opt/aibiz/nginx-native.conf'], nativeNginx);
  await writeFile(paths['/environment.config'], '');
  await writeFile(join(root, 'dist/environments/environment.js'), 'window.Environment = {};\n');
  await writeFile(join(root, 'bin/nginx'), '#!/bin/sh\nexit 0\n', { mode: 0o755 });
  return {
    root,
    run: () => execute('sh', [join(root, 'start.sh')], {
      env: {
        PATH: `${join(root, 'bin')}:${process.env.PATH}`,
        APPCODE: 'central', APICODE: 'ibizmodeling__central', NATIVE_MODEL_APP: 'Central',
        ...(host !== undefined ? { NATIVE_PLATFORM_HOST: host } : {}),
      },
      timeout: 10000,
    }),
  };
}

for (const [host, expected] of [
  [undefined, 'ibiz-ebsx-allinone'], ['', 'ibiz-ebsx-allinone'],
  ['ibiz-ebsx-allinone-local', 'ibiz-ebsx-allinone-local'],
]) {
  test(`native platform startup explicitly selects ${host || 'the original default'}`, async t => {
    const app = await fixture(t, host);
    await app.run();
    const served = await readFile(join(app.root, 'served.conf'), 'utf8');
    assert.ok(served.includes(`set $native_auth http://${expected}:30000;`));
    assert.ok(served.includes('set $native_service http://modelingservice:32002;'));
    assert.ok(served.includes('set $native_uaa http://ibizlab-uaa-api:32666;'));
    assert.ok(served.includes('/api/ibizmodeling__central/configs/'));
    await app.run();
    assert.equal(await readFile(join(app.root, 'served.conf'), 'utf8'), served);
  });
}

for (const host of ['http://other:30000', 'other:80', '-other', '.', 'a#b', 'a&b', 'a b', 'a\nb', '$(id)']) {
  test(`native platform rejects unsafe hostname ${JSON.stringify(host)} before writing config`, async t => {
    const app = await fixture(t, host);
    await assert.rejects(app.run, error => {
      assert.match(error.stderr, /Invalid NATIVE_PLATFORM_HOST/);
      return true;
    });
    await assert.rejects(readFile(join(app.root, 'served.conf')), { code: 'ENOENT' });
    assert.equal(await readFile(join(app.root, 'dist/environments/environment.js'), 'utf8'),
      'window.Environment = {};\n');
  });
}

test('source-platform overlay is restricted to the two native candidate entries', async () => {
  const overlay = await readFile(new URL(
    '../../plm/deploy/compose/docker-compose-modeling-native-isolated-platform.yml', import.meta.url), 'utf8');
  assert.equal((overlay.match(/NATIVE_PLATFORM_HOST: ibiz-ebsx-allinone-local/g) || []).length, 2);
  assert.match(overlay, /^  modelingweb-candidate-central:/m);
  assert.match(overlay, /^  modelingweb-candidate-modeldesign:/m);
  assert.doesNotMatch(overlay, /^  modelingweb-native-/m);
});
