#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const require = createRequire(import.meta.url);
const { modify, applyEdits } = require(path.join(workspace,
  'ibiz-app-hub/node_modules/.pnpm/jsonc-parser@3.2.0/node_modules/jsonc-parser'));
const root = path.join(workspace,
  'ibiz-service-hub/libs/ibiz-cloud-saas-extension/src/main/resources/sysmodel/saas-extension');
const entity = 'PSMODULES/AppPersonalization/PSDATAENTITIES/app_view_theme.json';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const { values } = parseArgs({ strict: true, options: { output: { type: 'string' } } });
assert.equal(path.dirname(values.output), path.join(workspace, '.artifacts'));
assert.match(path.basename(values.output), /^view-theme-save-source-[a-z0-9-]+$/);
fs.mkdirSync(values.output, { mode: 0o700 });
const files = [
  { path: entity.replace('.json', '/PSDEACTIONS/Save.json'), locate: () => [] },
  { path: entity, locate: model => {
    const index = model.getAllPSDEActions.findIndex(item => item.codeName === 'Save');
    assert.ok(index >= 0); return ['getAllPSDEActions', index];
  } },
  ...['api', 'core'].map(name => ({ path: `PSSYSSERVICEAPIS/${name}.json`, locate: model => {
    const entities = model.getPSDEServiceAPIs.map((item, index) => ({ item, index }))
      .filter(row => row.item.getPSDataEntity?.path === entity);
    assert.equal(entities.length, 1);
    const index = entities[0].item.getPSDEServiceAPIMethods.findIndex(item => item.codeName === 'save');
    assert.ok(index >= 0);
    const method = entities[0].item.getPSDEServiceAPIMethods[index];
    assert.equal(method.requestPath, '/save'); assert.equal(method.needResourceKey, true);
    return ['getPSDEServiceAPIs', entities[0].index, 'getPSDEServiceAPIMethods', index];
  } })),
];
const report = { contract: 'view-theme-save-access-model-sync-v1', status: 'PREPARED', files: [] };
for (const [index, item] of files.entries()) {
  const filename = path.join(root, item.path), before = fs.readFileSync(filename, 'utf8');
  const model = JSON.parse(before);
  const parent = item.locate(model);
  let target = model;
  for (const key of parent) target = target[key];
  assert.ok(target.dataAccessAction === undefined || target.dataAccessAction === 'CREATE');
  fs.writeFileSync(path.join(values.output, `before-${index}.private.json`), before, { mode: 0o600, flag: 'wx' });
  const output = applyEdits(before, modify(before, [...parent, 'dataAccessAction'], 'CREATE', {
    formattingOptions: { insertSpaces: true, tabSize: 2, eol: '\n' },
  }));
  const expected = structuredClone(model);
  let expectedTarget = expected;
  for (const key of parent) expectedTarget = expectedTarget[key];
  expectedTarget.dataAccessAction = 'CREATE';
  assert.deepEqual(JSON.parse(output), expected, 'Only the existing Save access declaration may change');
  fs.writeFileSync(filename, output);
  report.files.push({ path: item.path, beforeSha256: hash(before), afterSha256: hash(output) });
}
report.status = 'SYNCHRONIZED-EXPLICIT-SAVE-ACCESS-ONLY';
fs.writeFileSync(path.join(values.output, 'report.private.json'), `${JSON.stringify(report, null, 2)}\n`,
  { mode: 0o600, flag: 'wx' });
console.log(JSON.stringify({ status: report.status, files: report.files.length }));
