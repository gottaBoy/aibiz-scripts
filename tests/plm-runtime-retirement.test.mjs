import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  RETIRED_PLM_RUNTIME_CONTRACT, main, runPlmBackendRuntimeRegression,
} from '../harness-plm-backend-runtime-regression.mjs';

test('retired PLM replay has no database, Docker or compiler execution implementation', () => {
  const source = readFileSync(new URL('../harness-plm-backend-runtime-regression.mjs', import.meta.url), 'utf8');
  assert.equal(RETIRED_PLM_RUNTIME_CONTRACT.executionAvailable, false);
  assert.equal(RETIRED_PLM_RUNTIME_CONTRACT.acceptedForProduction, false);
  assert.doesNotMatch(source, /node:(?:child_process|fs)|\bfetch\s*\(|\bDELETE FROM\b|docker.+rm.+-f/);
  assert.doesNotMatch(source, /Mysql@|123456|CODEX%/);
});

test('imported legacy function refuses before reading any caller-supplied target or dependency', async () => {
  let touched = false;
  const untrusted = new Proxy({}, {
    get() { touched = true; throw new Error('Caller input must never be consumed'); },
  });
  await assert.rejects(runPlmBackendRuntimeRegression(untrusted), {
    code: 'ERR_PLM_SHARED_RUNTIME_REPLAY_RETIRED',
  });
  assert.equal(touched, false);
});

test('retired CLI fails closed even with historical shared-environment overrides', () => {
  const cli = fileURLToPath(new URL('../harness-plm-backend-runtime-regression.mjs', import.meta.url));
  const result = spawnSync(process.execPath, [cli], {
    env: { ...process.env, PLM_BACKEND_REGRESSION_AUTH_URL: 'http://127.0.0.1:30100/v7/login',
      PLM_BACKEND_REGRESSION_OUTPUT: '/must-not-write-anywhere' },
    encoding: 'utf8', timeout: 5000,
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout, '');
  assert.match(result.stderr, /Historical PLM runtime replay is disabled/);
  assert.doesNotMatch(result.stderr, /ENOENT|ECONNREFUSED|docker|password=/i);
});

test('only help is available and no opt-in or arbitrary target can reactivate the retired runner', async () => {
  for (const args of [
    ['--execute'], ['--execute-owned'], ['--allow-shared'], ['--help', '--execute'],
    ['--url=http://127.0.0.1:30250'],
  ]) {
    await assert.rejects(main(args), /no execution flags/);
  }
  const cli = fileURLToPath(new URL('../harness-plm-backend-runtime-regression.mjs', import.meta.url));
  const help = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8', timeout: 5000 });
  assert.equal(help.status, 0);
  assert.deepEqual(JSON.parse(help.stdout), RETIRED_PLM_RUNTIME_CONTRACT);
});
