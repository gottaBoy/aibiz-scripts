#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifact = path.join(workspace, '.artifacts/runtime-ctrlparam-hotfix-20261129-r1');
const target = '/dist/extras/js/@ibiz-template/runtime/index.system.min.js';
const container = process.env.PLMWEB_CONTAINER || 'plmweb';
const baseUrl = process.env.PLM_E2E_BASE_URL || 'http://127.0.0.1:30250/ibizplm-plmweb/';
const sha = value => createHash('sha256').update(value).digest('hex');
const oldFragment = 'a.view.getController(i.codeName.toLowerCase());n?e.params[t]=n:ibiz.log.error(ibiz.i18n.t("runtime.uiLogic.viewLogicInitializationParameter",{codeName:i.codeName}))';
const newFragment = 'null==a.view?void 0:a.view.getController(i.codeName.toLowerCase());n?e.params[t]=n:ibiz.log.debug(ibiz.i18n.t("runtime.uiLogic.viewLogicInitializationParameter",{codeName:i.codeName}))';

function docker(args, input) {
  return execFileSync('docker', args, { input, encoding: input ? undefined : 'utf8',
    maxBuffer: 64 * 1024 * 1024 });
}

function write(name, value) {
  fs.mkdirSync(artifact, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(artifact, name), value, { flag: 'wx', mode: 0o600 });
}

async function main() {
  const current = docker(['exec', container, 'cat', target]);
  assert.equal((current.toString('utf8').match(new RegExp(oldFragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length, 1);
  assert.equal(current.toString('utf8').includes(newFragment), false);
  const patched = Buffer.from(current.toString('utf8').replace(oldFragment, newFragment));
  assert.notEqual(sha(current), sha(patched));
  write('original.index.system.min.js', current);
  write('patched.index.system.min.js', patched);
  write('plan.private.json', Buffer.from(`${JSON.stringify({
    contract: 'aibiz-existing-plm-runtime-ctrlparam-hotfix-v1',
    container, target, originalSha256: sha(current), patchedSha256: sha(patched),
    originalBytes: current.length, patchedBytes: patched.length,
    restartRequests: 0, imagePullRequests: 0, containerCreateRequests: 0,
  }, null, 2)}\n`));
  const temp = `/tmp/aibiz-runtime-ctrlparam-${process.pid}`;
  docker(['exec', '-i', '--user', '0', container, 'sh', '-c',
    `set -eu; cat > "${temp}"; install -o 101 -g 101 -m 0644 "${temp}" "${target}.pending"; mv -f "${target}.pending" "${target}"; rm -f "${temp}"`], patched);
  const served = Buffer.from(await (await fetch(new URL('extras/js/@ibiz-template/runtime/index.system.min.js', baseUrl))).arrayBuffer());
  assert.equal(sha(served), sha(patched));
  write('report.private.json', Buffer.from(`${JSON.stringify({
    contract: 'aibiz-existing-plm-runtime-ctrlparam-hotfix-v1',
    status: 'APPLIED-NO-RESTART', container, target,
    originalSha256: sha(current), patchedSha256: sha(patched),
    httpStatus: 200, servedSha256: sha(served),
    restartRequests: 0, imagePullRequests: 0, containerCreateRequests: 0,
  }, null, 2)}\n`));
  console.log(JSON.stringify({ status: 'APPLIED-NO-RESTART', originalSha256: sha(current),
    patchedSha256: sha(patched), servedSha256: sha(served), restartRequests: 0 }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
