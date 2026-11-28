#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifact = path.join(workspace, '.artifacts/runtime-lifecycle-ctrlparam-hotfix-20261129-r1');
const target = '/dist/extras/js/@ibiz-template/runtime/lifecycle-529c247dced450f2/index.system.min.js';
const container = process.env.PLMWEB_CONTAINER || 'plmweb';
const baseUrl = process.env.PLM_E2E_BASE_URL || 'http://127.0.0.1:30250/ibizplm-plmweb/';
const sha = value => createHash('sha256').update(value).digest('hex');
const oldFragment = 'a.view.getController(i.codeName.toLowerCase());n?e.params[t]=n:ibiz.log.error(ibiz.i18n.t("runtime.uiLogic.viewLogicInitializationParameter",{codeName:i.codeName}))';
const newFragment = 'null==a.view?void 0:a.view.getController(i.codeName.toLowerCase());n?e.params[t]=n:ibiz.log.debug(ibiz.i18n.t("runtime.uiLogic.viewLogicInitializationParameter",{codeName:i.codeName}))';
const docker = (args, input) => execFileSync('docker', args, { input, encoding: input ? undefined : 'utf8',
  maxBuffer: 64 * 1024 * 1024 });
const write = (name, value) => {
  fs.mkdirSync(artifact, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(artifact, name), value, { flag: 'wx', mode: 0o600 });
};

async function main() {
  const current = docker(['exec', container, 'cat', target]);
  const text = current.toString('utf8');
  assert.equal((text.match(new RegExp(oldFragment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')) || []).length, 1);
  const patched = Buffer.from(text.replace(oldFragment, newFragment));
  write('original.index.system.min.js', current);
  write('patched.index.system.min.js', patched);
  const originalSha256 = sha(current);
  const patchedSha256 = sha(patched);
  write('plan.private.json', Buffer.from(`${JSON.stringify({ contract: 'aibiz-existing-plm-runtime-lifecycle-ctrlparam-hotfix-v1',
    container, target, originalSha256, patchedSha256, restartRequests: 0, imagePullRequests: 0,
    containerCreateRequests: 0 }, null, 2)}\n`));
  docker(['exec', '-i', '--user', '0', container, 'sh', '-c',
    'set -eu; t=/tmp/aibiz-runtime-lifecycle-ctrlparam; cat > "$t"; install -o 101 -g 101 -m 0644 "$t" "$1.pending"; mv -f "$1.pending" "$1"; rm -f "$t"',
    '--', target], patched);
  const response = await fetch(new URL('extras/js/@ibiz-template/runtime/lifecycle-529c247dced450f2/index.system.min.js', baseUrl));
  const served = Buffer.from(await response.arrayBuffer());
  assert.equal(response.status, 200);
  assert.equal(sha(served), patchedSha256);
  write('report.private.json', Buffer.from(`${JSON.stringify({ contract: 'aibiz-existing-plm-runtime-lifecycle-ctrlparam-hotfix-v1',
    status: 'APPLIED-NO-RESTART', container, target, originalSha256, patchedSha256,
    servedSha256: sha(served), restartRequests: 0, imagePullRequests: 0, containerCreateRequests: 0 }, null, 2)}\n`));
  console.log(JSON.stringify({ status: 'APPLIED-NO-RESTART', originalSha256, patchedSha256,
    servedSha256: sha(served), restartRequests: 0 }));
}
main().catch(error => { console.error(error); process.exitCode = 1; });
