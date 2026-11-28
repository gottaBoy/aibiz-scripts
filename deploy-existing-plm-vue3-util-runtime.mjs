#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = path.join(workspace, '.artifacts');
const hostFile = path.join(workspace, 'plm-web/dist/extras/js/@ibiz-template/vue3-util/index.system.min.js');
const relative = 'extras/js/@ibiz-template/vue3-util/index.system.min.js';
const target = `/dist/${relative}`;
const defaultContainer = process.env.PLMWEB_CONTAINER || 'plmweb';
const defaultBaseUrl = process.env.PLM_E2E_BASE_URL || 'http://127.0.0.1:30250/ibizplm-plmweb/';
const digest = value => createHash('sha256').update(value).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;

function docker(args, input) {
  return execFileSync('docker', args, { input, encoding: input ? undefined : 'utf8',
    maxBuffer: 64 * 1024 * 1024 });
}

function inspect(container) {
  const raw = docker(['inspect', container]);
  const row = JSON.parse(raw)[0];
  return {
    name: container,
    id: row.Id,
    image: row.Image,
    status: row.State.Status,
    startedAt: row.State.StartedAt,
    restartCount: row.RestartCount,
  };
}

function remoteFile(container) {
  const output = docker(['exec', container, 'sh', '-c',
    `set -eu
     stat -c '%d:%i:%u:%g:%a:%s' '${target}'
     sha256sum '${target}' | awk '{print $1}'`]).trim().split(/\r?\n/);
  assert.equal(output.length, 2);
  const [deviceInode, sha256] = output;
  const [device, inode, uid, gid, mode, bytes] = deviceInode.split(':').map(Number);
  return { device, inode, uid, gid, mode, bytes, sha256 };
}

function writePrivate(filename, value) {
  fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
  fs.writeFileSync(filename, value, { flag: 'wx', mode: 0o600 });
}

function assertOutputDirectory(directory, prefix) {
  const resolved = path.resolve(directory);
  assert.equal(path.dirname(resolved), artifacts);
  assert.match(path.basename(resolved), new RegExp(`^${prefix}-[a-z0-9-]+$`));
  assert.equal(fs.existsSync(resolved), false);
  return resolved;
}

function prepare(directory, container = defaultContainer) {
  const output = assertOutputDirectory(directory, 'vue3-util-runtime-prepare');
  const runtime = inspect(container);
  assert.equal(runtime.status, 'running');
  const original = remoteFile(container);
  const payload = fs.readFileSync(hostFile);
  const candidate = { bytes: payload.length, sha256: digest(payload) };
  assert.notEqual(candidate.sha256, original.sha256, 'The candidate must change the current runtime');
  fs.mkdirSync(path.join(output, 'payload', path.dirname(relative)), { recursive: true, mode: 0o700 });
  fs.mkdirSync(path.join(output, 'rollback', path.dirname(relative)), { recursive: true, mode: 0o700 });
  writePrivate(path.join(output, 'payload', relative), payload);
  writePrivate(path.join(output, 'rollback', relative), docker(['exec', container, 'cat', target]));
  writePrivate(path.join(output, 'plan.private.json'), Buffer.from(json({
    contract: 'aibiz-existing-plm-vue3-util-runtime-v1',
    status: 'PREPARED-NOT-PUBLISHED',
    container: { name: container, ...runtime },
    target: { relative, path: target, original, candidate },
    hostSource: { path: 'plm-web/dist/extras/js/@ibiz-template/vue3-util/index.system.min.js',
      sha256: candidate.sha256, bytes: candidate.bytes },
    restartRequests: 0, imagePullRequests: 0, containerCreateRequests: 0,
  })));
  return output;
}

async function served(baseUrl, expected) {
  const response = await fetch(new URL(relative, baseUrl));
  const body = Buffer.from(await response.arrayBuffer());
  assert.equal(response.status, 200);
  assert.equal(digest(body), expected.sha256);
  assert.equal(body.length, expected.bytes);
  return { status: response.status, sha256: digest(body), bytes: body.length };
}

function loadPlan(directory) {
  const resolved = path.resolve(directory);
  assert.equal(path.dirname(resolved), artifacts);
  const plan = JSON.parse(fs.readFileSync(path.join(resolved, 'plan.private.json')));
  assert.equal(plan.contract, 'aibiz-existing-plm-vue3-util-runtime-v1');
  assert.equal(plan.status, 'PREPARED-NOT-PUBLISHED');
  return { resolved, plan };
}

async function mutate(command, directory, container = defaultContainer, baseUrl = defaultBaseUrl) {
  const { resolved, plan } = loadPlan(directory);
  assert.equal(plan.container.name, container);
  const runtime = inspect(container);
  assert.deepEqual(runtime, plan.container, 'Container identity or lifetime drifted');
  const before = remoteFile(container);
  assert.deepEqual(before, plan.target.original, 'Current target drifted before publication');
  const payload = fs.readFileSync(path.join(resolved, 'payload', relative));
  assert.equal(digest(payload), plan.target.candidate.sha256);
  const original = fs.readFileSync(path.join(resolved, 'rollback', relative));
  assert.equal(digest(original), plan.target.original.sha256);
  const pending = `/tmp/aibiz-${randomUUID()}.pending`;
  const install = `set -eu
    trap 'rm -f "${pending}" "${target}.aibiz-pending"' EXIT
    cat > "${pending}"
    install -o ${plan.target.original.uid} -g ${plan.target.original.gid} -m ${plan.target.original.mode.toString(8)} "${pending}" "${target}.aibiz-pending"
    mv -f "${target}.aibiz-pending" "${target}"`;
  const bytes = command === 'apply' ? payload : original;
  docker(['exec', '-i', container, 'sh', '-c', install], bytes);
  const after = remoteFile(container);
  const expected = command === 'apply' ? plan.target.candidate : plan.target.original;
  assert.equal(after.sha256, expected.sha256);
  const http = await served(baseUrl, expected);
  const report = {
    contract: 'aibiz-existing-plm-vue3-util-runtime-v1',
    status: command === 'apply' ? 'APPLIED-NO-RESTART' : 'ROLLED-BACK-NO-RESTART',
    container: { name: container, ...inspect(container) },
    target: { path: target, before, after, expected, http },
    restartRequests: 0, imagePullRequests: 0, containerCreateRequests: 0,
  };
  writePrivate(path.join(artifacts,
    `vue3-util-runtime-${command}-${randomUUID().replaceAll('-', '')}`), Buffer.from(json(report)));
  return report;
}

async function observe(directory, container = defaultContainer, baseUrl = defaultBaseUrl) {
  const { resolved, plan } = loadPlan(directory);
  assert.equal(plan.container.name, container);
  const runtime = inspect(container);
  assert.deepEqual(runtime, plan.container, 'Container identity or lifetime drifted');
  const current = remoteFile(container);
  assert.deepEqual(current, {
    ...plan.target.candidate,
    device: current.device,
    inode: current.inode,
    uid: plan.target.original.uid,
    gid: plan.target.original.gid,
    mode: plan.target.original.mode,
  }, 'The candidate is not the current target');
  const http = await served(baseUrl, plan.target.candidate);
  const report = {
    contract: 'aibiz-existing-plm-vue3-util-runtime-v1',
    status: 'OBSERVED-CANDIDATE-SERVED-NO-RESTART',
    container: { name: container, ...runtime },
    target: { path: target, current, http, original: plan.target.original,
      candidate: plan.target.candidate },
    restartRequests: 0, imagePullRequests: 0, containerCreateRequests: 0,
  };
  const reportPath = path.join(resolved, 'observed.private.json');
  writePrivate(reportPath, Buffer.from(json(report)));
  return report;
}

const [command, directory, container = defaultContainer, baseUrl = defaultBaseUrl] = process.argv.slice(2);
if (command === 'prepare') {
  console.log(JSON.stringify({ status: 'PREPARED-NOT-PUBLISHED',
    directory: prepare(directory, container) }));
} else if (command === 'observe') {
  observe(directory, container, baseUrl).then(report => console.log(JSON.stringify(report)));
} else if (command === 'apply' || command === 'rollback') {
  mutate(command, directory, container, baseUrl).then(report => console.log(JSON.stringify(report)));
} else {
  console.error('Usage: deploy-existing-plm-vue3-util-runtime.mjs prepare|observe|apply|rollback <candidate-dir> [container] [base-url]');
  process.exitCode = 2;
}
