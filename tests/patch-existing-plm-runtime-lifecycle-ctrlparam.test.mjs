import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const tool = fs.readFileSync(path.join(root, 'scripts/patch-existing-plm-runtime-lifecycle-ctrlparam.mjs'), 'utf8');

test('lifecycle runtime hotfix binds the served versioned asset and forbids restart or image operations', () => {
  assert.match(tool, /lifecycle-529c247dced450f2/);
  assert.match(tool, /oldFragment/);
  assert.match(tool, /newFragment/);
  assert.match(tool, /restartRequests: 0/);
  assert.doesNotMatch(tool, /docker', \['restart/);
  assert.doesNotMatch(tool, /docker', \['pull/);
  assert.doesNotMatch(tool, /docker', \['create/);
});
