#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { modify, applyEdits } = require(path.join(workspace,
  'ibiz-app-hub/node_modules/.pnpm/jsonc-parser@3.2.0/node_modules/jsonc-parser'));
const base = path.join(workspace,
  'ibiz-service-hub/libs/ibiz-cloud-saas-extension/src/main/resources/sysmodel/saas-extension');
const entityPath = path.join(base, 'PSMODULES/AppPersonalization/PSDATAENTITIES/app_view_theme.json');
const role = JSON.parse(fs.readFileSync(path.join(base,
  'PSMODULES/AppPersonalization/PSDATAENTITIES/app_view_theme/PSDEUSERROLES/SystemRead.json')));
const before = fs.readFileSync(entityPath, 'utf8');
const original = JSON.parse(before);
const existing = original.getAllPSDEUserRoles.find(item => item.roleTag === 'SystemRead');
if (existing) {
  assert.deepEqual(existing, role);
  console.log('SystemRead model is already synchronized');
} else {
  const edits = modify(before, ['getAllPSDEUserRoles', 0], role, {
    isArrayInsertion: true, formattingOptions: { insertSpaces: true, tabSize: 2, eol: '\n' },
  });
  const output = applyEdits(before, edits);
  const expected = structuredClone(original);
  expected.getAllPSDEUserRoles.unshift(role);
  assert.deepEqual(JSON.parse(output), expected, 'Only the explicit read role may be added');
  fs.writeFileSync(entityPath, output);
  console.log('Synchronized one SystemRead role; unrelated model values preserved');
}
