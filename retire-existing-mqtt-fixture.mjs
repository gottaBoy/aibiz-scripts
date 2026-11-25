#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { acquireMqttWriterLock, assertPreserved, createMqttBrokerSession,
  readMqttBrokerSnapshot } from './repair-existing-mqtt.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const encode = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const managed = '/opt/emqx/data/authz/acl.conf';
const read = filename => {
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    assert.ok(stat.isFile() && stat.uid === process.geteuid() && stat.nlink === 1 && !(stat.mode & 0o077));
    return fs.readFileSync(fd);
  } finally { fs.closeSync(fd); }
};
const write = (dir, name, value) => {
  const fd = fs.openSync(path.join(dir, name), 'wx', 0o600);
  try { fs.writeFileSync(fd, encode(value)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
};

export async function retireFixture({ filename, expectedHash, output, trusted }) {
  assert.equal(trusted, true);
  const bytes = read(filename);
  assert.equal(hash(bytes), expectedHash);
  const plan = JSON.parse(bytes);
  assert.equal(plan.contract, 'existing-mqtt-isolated-plan-v1');
  assert.equal(plan.before.aclFiles[managed].exists, false);
  assert.equal(fs.realpathSync(path.dirname(output)), path.join(root, '.artifacts'));
  assert.match(path.basename(output), /^mqtt-native-retire-[a-z0-9-]+$/);
  fs.mkdirSync(output, { mode: 0o700 });
  const lock = acquireMqttWriterLock();
  try {
    const { call } = await createMqttBrokerSession();
    const before = await readMqttBrokerSnapshot(call);
    assertPreserved(plan.before, before);
    assert.ok(before.listenerConfig.includes('http://172.21.0.1:18085/authn'));
    assert.deepEqual(before.authorization.sources, [plan.newAcl]);
    for (const client of before.clients) {
      assert.ok(!plan.identities.some(value => value.username === client.username),
        'The fixture still owns an active client');
    }
    const file = before.aclFiles[managed];
    assert.equal(file.exists, true);
    assert.equal(file.sha256, hash(plan.newAcl.rules));
    assert.equal(file.nlink, '1');
    write(output, 'intent.private.json', { planSha256: expectedHash, before,
      sourceSha256: hash(fs.readFileSync(fileURLToPath(import.meta.url))) });
    lock.assertHeld();
    await call('/configs?mode=merge', { method: 'PUT', text: true, body: plan.before.authorizationConfig });
    const restored = await readMqttBrokerSnapshot(call);
    assertPreserved(plan.before, restored);
    assert.deepEqual(restored.authorization, plan.before.authorization);
    assert.equal(restored.authorizationConfig, plan.before.authorizationConfig);
    assert.equal(restored.listenerConfig, before.listenerConfig);
    assert.deepEqual(restored.aclFiles[managed], file);
    const signature = ['dev', 'ino', 'uid', 'gid', 'mode', 'nlink', 'bytes'].map(key => file[key]).join(' ');
    lock.assertHeld();
    const removed = spawnSync('docker', ['exec', plan.before.runtime.containerId,
      'sh', '-c', `set -eu
test ! -L "$1" && test -f "$1"
test "$(stat -c '%d %i %u %g %a %h %s' "$1")" = "$2"
digest=$(sha256sum "$1")
test "\${digest%% *}" = "$3"
rm -- "$1"
test ! -e "$1"
`, 'aibiz-mqtt-retire', managed, signature, file.sha256], { timeout: 10000 });
    assert.equal(removed.status, 0);
    const after = await readMqttBrokerSnapshot(call);
    assertPreserved(plan.before, after);
    assert.deepEqual(after.authorization, plan.before.authorization);
    assert.equal(after.listenerConfig, before.listenerConfig);
    assert.equal(after.aclFiles[managed].exists, false);
    const report = { contract: 'mqtt-fixture-retirement-v1',
      status: 'RETIRED-OWNED-JWT-ACL-PRESERVED-NATIVE-LISTENER',
      planSha256: expectedHash, before, after,
      privateKeysRetainedForHistoricalRollbackEvidence: true, oldClientsPreserved: true };
    write(output, 'report.private.json', report);
    console.log(JSON.stringify({ status: report.status, reportSha256: hash(encode(report)) }));
    return report;
  } finally { lock.release(); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: {
    plan: { type: 'string' }, 'plan-sha256': { type: 'string' }, output: { type: 'string' },
    'trusted-exclusive-writer-window': { type: 'boolean' },
  }, strict: true });
  retireFixture({ filename: values.plan, expectedHash: values['plan-sha256'],
    output: values.output, trusted: values['trusted-exclusive-writer-window'] })
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
