import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../../', import.meta.url));
const composeDir = join(root, 'plm/deploy/compose');
const services = ['ibiz-ebsx-allinone', 'plmservice', 'plmweb'];
const doctor = await readFile(join(root, 'scripts/local-runtime-doctor.sh'), 'utf8');
const boundary = doctor.indexOf('# Existing manual containers.');
assert.ok(boundary > 0, 'doctor definitions must have an explicit boundary');

for (const sourceLocal of [false, true]) {
  test(`${sourceLocal ? 'source-local overlays' : 'development Compose'} preserve core service restart policies`, () => {
    const args = [
      'compose', '--env-file', join(composeDir, '.dev'),
      '-f', join(composeDir, 'docker-compose-dev.yml'),
    ];
    if (sourceLocal) {
      args.push(
        '--env-file', join(composeDir, 'source-local.env'),
        '-f', join(composeDir, 'docker-compose-plm-local.yml'),
        '-f', join(composeDir, 'docker-compose-modeling-native-candidate.yml'),
        '--profile', 'modeling', '--profile', 'modeling-native-candidate',
      );
    }
    args.push('config', '--format', 'json');
    const result = spawnSync('docker', args, {
      cwd: root, encoding: 'utf8', timeout: 10000,
    });
    assert.equal(result.status, 0, result.stderr || result.error?.message);
    const config = JSON.parse(result.stdout);
    for (const name of services) {
      assert.equal(config.services[name].restart, 'unless-stopped', name);
    }
  });
}

function inspectPolicy(policy, inspectExit = 0) {
  return spawnSync('/bin/bash', ['-s'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 5000,
    env: {
      ...process.env,
      MOCK_RESTART_POLICY: policy,
      MOCK_INSPECT_EXIT: String(inspectExit),
    },
    input: `
docker() {
  if [ "$1" = info ]; then
    return 0
  fi
  if [ "$1" != inspect ]; then
    return 99
  fi
  if [ "$MOCK_INSPECT_EXIT" -ne 0 ]; then
    return "$MOCK_INSPECT_EXIT"
  fi
  printf '%s\\n' "$MOCK_RESTART_POLICY"
}
${doctor.slice(0, boundary)}
check_restart_policy plmweb unless-stopped
exit "$FAILED"
`,
  });
}

test('runtime doctor accepts the expected restart policy', () => {
  const result = inspectPolicy('unless-stopped');
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stdout, /PASS container plmweb restart=unless-stopped/);
});

for (const policy of ['no', 'on-failure', 'always', '']) {
  test(`runtime doctor rejects unexpected restart policy ${policy || '(empty)'}`, () => {
    const result = inspectPolicy(policy);
    assert.equal(result.status, 1, result.stdout + result.stderr);
    assert.match(result.stdout, /FAIL container plmweb restart=.*expected=unless-stopped/);
  });
}

test('runtime doctor fails when restart policy inspection fails', () => {
  const result = inspectPolicy('unless-stopped', 1);
  assert.equal(result.status, 1, result.stdout + result.stderr);
  assert.match(result.stdout, /FAIL container plmweb restart policy unavailable/);
});

test('runtime doctor checks restart policies on all core services', () => {
  for (const name of services) {
    assert.ok(doctor.includes(`check_restart_policy ${name} unless-stopped`), name);
  }
});
