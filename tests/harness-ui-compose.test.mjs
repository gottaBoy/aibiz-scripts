import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const workspace = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const composeFile = join(workspace, 'plm/deploy/compose/docker-compose-dev.yml');
const envFile = join(workspace, 'plm/deploy/compose/.dev');

function renderCompose() {
  return spawnSync(
    'docker',
    [
      'compose',
      '-f',
      composeFile,
      '--env-file',
      envFile,
      '--profile',
      'modeling',
      'config',
      '--format',
      'json',
    ],
    {
      cwd: workspace,
      encoding: 'utf8',
      timeout: 15000,
    },
  );
}

function environmentObject(environment) {
  if (!Array.isArray(environment)) return environment || {};
  return Object.fromEntries(
    environment.map(value => {
      const separator = value.indexOf('=');
      return separator < 0
        ? [value, null]
        : [value.slice(0, separator), value.slice(separator + 1)];
    }),
  );
}

function assertReadOnlyMount(mount, source, target) {
  assert.ok(mount, `${target} mount must be present`);
  assert.equal(mount.type, 'bind');
  assert.equal(mount.source, source);
  assert.equal(mount.target, target);
  assert.equal(mount.read_only, true);
}

test('harness-ui mounts project reports read-only and advertises container roots', () => {
  assert.equal(existsSync(composeFile), true);
  assert.equal(existsSync(envFile), true);
  const rendered = renderCompose();
  assert.equal(rendered.status, 0, rendered.stderr || rendered.error?.message);
  const service = JSON.parse(rendered.stdout).services['harness-ui'];
  assert.ok(service, 'harness-ui service must be present');

  const mounts = service.volumes.filter(volume => volume.type === 'bind');
  assertReadOnlyMount(
    mounts.find(volume => volume.target === '/app/plm-e2e/playwright-report'),
    join(workspace, 'plm-e2e/playwright-report'),
    '/app/plm-e2e/playwright-report',
  );
  assertReadOnlyMount(
    mounts.find(volume => volume.target === '/app/.artifacts'),
    join(workspace, '.artifacts'),
    '/app/.artifacts',
  );
  assertReadOnlyMount(
    mounts.find(volume => volume.target === '/app/scripts'),
    join(workspace, 'scripts'),
    '/app/scripts',
  );

  const environment = environmentObject(service.environment);
  assert.equal(
    environment.AIBIZ_HARNESS_REPORT_ROOTS,
    '/app/plm-e2e/playwright-report,/app/.artifacts',
  );
});
