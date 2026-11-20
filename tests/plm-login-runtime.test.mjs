import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { workspace } from '../localization-baseline.mjs';
import { assemblePlmLoginCandidate, preparePlmLoginRuntime } from '../prepare-plm-login-runtime.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'plm-runtime-contract-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const dist = join(root, 'dist');
  await mkdir(dist);
  await writeFile(join(dist, 'index.html'), 'actual input bytes');
  const output = join(workspace, '.artifacts', `plm-reject-${randomUUID()}`);
  return { root, output };
}

test('runtime preparation refuses changed app bytes before creating outputs or compiling', async t => {
  const f = await fixture(t);
  await writeFile(join(f.root, 'source-build.json'), JSON.stringify({
    sharedDistUnchanged: true, outputFiles: [],
  }));
  await assert.rejects(preparePlmLoginRuntime({ candidate: f.root, output: f.output }),
    /Input candidate changed/);
  await assert.rejects(access(f.output), { code: 'ENOENT' });
});

test('runtime preparation refuses output inside a live project before writing a snapshot', async t => {
  const f = await fixture(t);
  await assert.rejects(preparePlmLoginRuntime({
    candidate: f.root, output: join(workspace, 'plm-web', `not-created-${randomUUID()}`),
  }), /Expected values to be strictly equal/);
});

test('candidate assembly refuses drift before any output is created', async t => {
  const f = await fixture(t);
  await writeFile(join(f.root, 'source-build.json'), JSON.stringify({
    sharedDistUnchanged: true, outputFiles: [],
  }));
  await assert.rejects(assemblePlmLoginCandidate({
    candidate: f.root, runtime: f.root, output: f.output,
  }), /Expected values to be strictly deep-equal/);
  await assert.rejects(access(f.output), { code: 'ENOENT' });
});
