import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const tool = fs.readFileSync(path.join(root, 'scripts/patch-existing-plm-runtime-ctrlparam.mjs'), 'utf8');

test('runtime ctrlParam hotfix is an exact one-fragment no-restart patch', () => {
  assert.match(tool, /aibiz-existing-plm-runtime-ctrlparam-hotfix-v1/);
  assert.match(tool, /oldFragment/);
  assert.match(tool, /newFragment/);
  assert.match(tool, /match\(new RegExp/);
  assert.match(tool, /restartRequests: 0/);
  assert.doesNotMatch(tool, /docker', \['restart/);
  assert.doesNotMatch(tool, /docker', \['pull/);
  assert.doesNotMatch(tool, /docker', \['create/);
});
