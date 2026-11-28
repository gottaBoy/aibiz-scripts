import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const tool = fs.readFileSync(path.join(root, 'scripts/deploy-existing-plm-vue3-util-runtime.mjs'), 'utf8');

test('runtime candidate is one-file, existing-container, no-restart publication', () => {
  assert.match(tool, /aibiz-existing-plm-vue3-util-runtime-v1/);
  assert.match(tool, /extras\/js\/@ibiz-template\/vue3-util\/index\.system\.min\.js/);
  assert.match(tool, /restartRequests: 0/);
  assert.match(tool, /imagePullRequests: 0/);
  assert.match(tool, /containerCreateRequests: 0/);
  assert.doesNotMatch(tool, /docker', \['restart/);
  assert.doesNotMatch(tool, /docker', \['pull/);
  assert.doesNotMatch(tool, /docker', \['create/);
  assert.match(tool, /assert\.deepEqual\(runtime, plan\.container/);
  assert.match(tool, /assert\.deepEqual\(before, plan\.target\.original/);
  assert.match(tool, /status: command === 'apply' \? 'APPLIED-NO-RESTART'/);
});
