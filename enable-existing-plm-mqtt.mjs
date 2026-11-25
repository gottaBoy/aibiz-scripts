#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const host = path.join(workspace, 'plm-web/dist/environments/environment.js');
const live = '/dist/environments/environment.js';
const container = '70327c269425370bed8648bcaa90feadf441ff7a6c5f75b975889cf4c5416612';
const image = 'sha256:027de06a1f8d8d5e44e17b849d44d39a421c6fe0787433b5e229ba00655ca99c';
const nativeReceipt = path.join(workspace, '.artifacts/mqtt-native-verify-20261124-r5/report.private.json');
const nativeSha = 'e0641a2f862e3875a33ee74de722c8490230e7c34ff333d78e030b2d17f65a86';
const hash = value => createHash('sha256').update(value).digest('hex');
const encode = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);

export function readEnvironment(bytes) {
  const sandbox = { window: {} };
  vm.runInNewContext(bytes.toString(), sandbox, { timeout: 100 });
  return JSON.parse(JSON.stringify(sandbox.window.Environment));
}

export function enabledEnvironment(bytes) {
  const before = readEnvironment(bytes);
  assert.equal(before.enableMqtt, false);
  const text = bytes.toString();
  const matches = [...text.matchAll(/\benableMqtt:\s*false\b/g)];
  assert.equal(matches.length, 1, 'Only one reviewed boolean property may be changed');
  const after = Buffer.from(text.replace(/(\benableMqtt:\s*)false\b/, '$1true'));
  assert.deepEqual(readEnvironment(after), { ...before, enableMqtt: true });
  return after;
}

function docker(args, input) {
  const result = spawnSync('docker', args, { input, timeout: 10000, maxBuffer: 2 * 1024 * 1024 });
  assert.equal(result.status, 0,
    `Existing PLM operation failed: ${args.join(' ')}; stderr SHA ${hash(result.stderr ?? '')}`);
  return Buffer.from(result.stdout ?? '');
}

function runtime() {
  const item = JSON.parse(docker(['inspect', container]))[0];
  assert.equal(item.Image, image);
  assert.equal(item.Name, '/plmweb');
  assert.equal(item.State.Status, 'running');
  assert.ok(item.Mounts.some(mount => mount.Source === path.join(workspace, 'plm-web/dist')
    && mount.Destination === '/opt/aibiz/local-dist' && mount.RW === false));
  assert.ok(!item.Config.Env.some(value => /^ENABLEMQTT=.+/.test(value)),
    'An explicit startup override requires separate review');
  assert.equal(item.HostConfig.Tmpfs['/dist'], 'uid=101,gid=101,mode=0755');
  return { id: item.Id, image: item.Image, startedAt: item.State.StartedAt, restartCount: item.RestartCount };
}

function write(output, name, bytes) {
  const fd = fs.openSync(path.join(output, name), 'wx', 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function readPrivate(filename) {
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    assert.ok(stat.isFile() && stat.uid === process.geteuid() && stat.nlink === 1 && !(stat.mode & 0o077));
    return fs.readFileSync(fd);
  } finally { fs.closeSync(fd); }
}

export function prepare(output, recoverFrom) {
  assert.equal(path.dirname(output), path.join(workspace, '.artifacts'));
  assert.match(path.basename(output), /^plm-mqtt-environment-[a-z0-9-]+$/);
  fs.mkdirSync(output, { mode: 0o700 });
  const receiptBytes = readPrivate(nativeReceipt);
  assert.equal(hash(receiptBytes), nativeSha);
  const native = JSON.parse(receiptBytes);
  assert.equal(native.status, 'PASS-NATIVE-PLM-TOKEN-THREE-USER-ACL-PROXY-RECONNECT');
  assert.equal(native.clientsClosed, true);
  assert.equal(native.PLMTokenAcceptance, true);
  const beforeRuntime = runtime();
  let hostBefore = fs.readFileSync(host);
  let recovery;
  if (recoverFrom) {
    assert.equal(path.dirname(recoverFrom), path.join(workspace, '.artifacts'));
    const previousBytes = readPrivate(path.join(recoverFrom, 'report.private.json'));
    const previous = JSON.parse(previousBytes);
    const previousPlanBytes = readPrivate(path.join(recoverFrom, 'prepared.private.json'));
    assert.equal(previous.planSha256, hash(previousPlanBytes));
    assert.equal(previous.status, 'FAILED-EXACT-RECOVERY-REQUIRED');
    assert.equal(previous.liveInstalled, false);
    assert.deepEqual(previous.runtime, beforeRuntime);
    hostBefore = readPrivate(path.join(recoverFrom, 'host-before.private.js'));
    assert.equal(hash(fs.readFileSync(host)), hash(enabledEnvironment(hostBefore)));
    recovery = { previousReportSha256: hash(previousBytes),
      previousPlanSha256: hash(previousPlanBytes),
      previousArchiveWritesNotVisibleInLiveTmpfs: true };
  }
  const liveBefore = docker(['exec', container, 'cat', live]);
  assert.equal(hash(hostBefore), '1759a8af7f80c630ba1c2c2646a5f1548a161ecb62bcdbfd2a8a607d300de0ab');
  assert.equal(hash(liveBefore), '75a7ea14a3d2e9bccbba906b2905a93b30957c0107f5d6a8f586bdc163837c5d');
  const hostAfter = enabledEnvironment(hostBefore);
  const liveAfter = enabledEnvironment(liveBefore);
  for (const [name, bytes] of Object.entries({
    'host-before.private.js': hostBefore, 'host-after.private.js': hostAfter,
    'live-before.private.js': liveBefore, 'live-after.private.js': liveAfter,
  })) write(output, name, bytes);
  const plan = {
    contract: 'existing-plm-mqtt-environment-v1', status: 'PREPARED-NOT-APPLIED',
    runtime: beforeRuntime, nativeReceiptSha256: nativeSha,
    executorSha256: hash(fs.readFileSync(fileURLToPath(import.meta.url))),
    hostBeforeSha256: hash(hostBefore), hostAfterSha256: hash(hostAfter),
    liveBeforeSha256: hash(liveBefore), liveAfterSha256: hash(liveAfter),
    restart: false, imagePull: false, onlyChangedProperty: 'enableMqtt',
    existingStartupOverridesPreserved: true, trustedExclusiveWriterWindowRequired: true,
    ...(recovery ? { recovery } : {}),
  };
  assert.deepEqual(runtime(), beforeRuntime);
  write(output, 'prepared.private.json', encode(plan));
  return { status: plan.status, planSha256: hash(encode(plan)) };
}

export async function apply(directory) {
  const plan = JSON.parse(readPrivate(path.join(directory, 'prepared.private.json')));
  assert.equal(plan.contract, 'existing-plm-mqtt-environment-v1');
  assert.equal(plan.executorSha256, hash(fs.readFileSync(fileURLToPath(import.meta.url))));
  assert.deepEqual(runtime(), plan.runtime);
  assert.equal(hash(fs.readFileSync(host)), plan.hostAfterSha256,
    'Apply the reviewed host source change before installing its live counterpart');
  assert.equal(hash(docker(['exec', container, 'cat', live])), plan.liveBeforeSha256);
  const candidate = readPrivate(path.join(directory, 'live-after.private.js'));
  const original = readPrivate(path.join(directory, 'live-before.private.js'));
  assert.equal(hash(candidate), plan.liveAfterSha256);
  assert.equal(hash(original), plan.liveBeforeSha256);
  const stage = `${live}.aibiz-mqtt-20261124.pending`;
  const report = { contract: 'existing-plm-mqtt-environment-apply-v1', status: 'VALIDATING',
    planSha256: hash(readPrivate(path.join(directory, 'prepared.private.json'))), runtime: plan.runtime,
    nativeReceiptSha256: nativeSha, restart: false, businessPushAcceptance: false };
  let installed = false;
  try {
    docker(['exec', container, 'sh', '-c',
      'test ! -e /dist/environments/environment.js.aibiz-mqtt-20261124.pending']);
    const metadata = docker(['exec', container, 'stat', '-c', '%u:%g:%a', live]).toString().trim();
    assert.match(metadata, /^\d+:\d+:[0-7]{3,4}$/);
    docker(['exec', '-i', '--user', '0', container, 'sh', '-c', `set -eu
test ! -e '${stage}' && test ! -L '${stage}'
umask 077
set -C
exec 3>'${stage}'
dd conv=fsync status=none >&3
exec 3>&-`], candidate);
    assert.equal(hash(docker(['exec', '--user', '0', container, 'cat', stage])), plan.liveAfterSha256);
    const [uid, gid, mode] = metadata.split(':');
    docker(['exec', '--user', '0', container, 'chown', `${uid}:${gid}`, stage]);
    docker(['exec', '--user', '0', container, 'chmod', mode, stage]);
    assert.deepEqual(runtime(), plan.runtime);
    assert.equal(hash(docker(['exec', container, 'cat', live])), plan.liveBeforeSha256);
    docker(['exec', '--user', '0', container, 'mv', stage, live]);
    installed = true;
    const response = await fetch('http://127.0.0.1:30250/ibizplm-plmweb/environments/environment.js', {
      signal: AbortSignal.timeout(8000),
    });
    assert.equal(response.status, 200);
    assert.equal(hash(Buffer.from(await response.arrayBuffer())), plan.liveAfterSha256);
    assert.deepEqual(runtime(), plan.runtime);
    assert.equal(hash(fs.readFileSync(host)), plan.hostAfterSha256);
    assert.equal(hash(fs.readFileSync(path.join(workspace, 'plm-web/public/environments/environment.js'))),
      plan.hostAfterSha256, 'The build source must match the enabled startup input');
    report.status = 'APPLIED-MQTT-ENABLED-UI-BUSINESS-PUSH-PENDING';
    report.liveSha256 = plan.liveAfterSha256;
    report.hostSha256 = plan.hostAfterSha256;
    report.buildSourceEqualsStartupInput = true;
    report.liveTmpfsWriteVerified = true;
    return report;
  } catch (error) {
    report.status = 'FAILED-EXACT-RECOVERY-REQUIRED';
    report.error = error.message;
    report.liveInstalled = installed;
    throw error;
  } finally { write(directory, 'report.private.json', encode(report)); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ strict: true, options: {
    prepare: { type: 'boolean' }, apply: { type: 'boolean' }, directory: { type: 'string' },
    'recover-from': { type: 'string' },
  } });
  assert.equal([values.prepare, values.apply].filter(Boolean).length, 1);
  Promise.resolve(values.prepare ? prepare(values.directory, values['recover-from']) : apply(values.directory))
    .then(value => console.log(JSON.stringify(value))).catch(error => {
      console.error(error.message); process.exitCode = 1;
    });
}
