#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const method = '    private void executeRAWSFCODE1(IDELogicSession iDELogicSession, IPSDELogicNode iPSDELogicNode) throws Throwable {';
const delegated = `${method}\n        super.onExecutePSDELogicNode(iDELogicSession, iPSDELogicNode, true)\n    }`;
const modelBase = 'plm/model/PSMODULES/Wiki/PSDATAENTITIES/article_page';
const sourceBase = 'plm/backend/plm-core/src/main/groovy/cn/ibizlab/plm/wiki/articlepage/logic';

export const wikiDispatchTargets = Object.freeze([
  Object.freeze({
    name: 'check_shared', className: 'CheckShared',
    modelPath: `${modelBase}/PSDELOGICS/check_shared.json`,
    sourcePath: `${sourceBase}/CheckShared.groovy`,
    modelSha256: '96f1af3cf6791c73407b7b988f0bb28323b3c80327b299d0fd4f48a1f974573e',
    generatedSha256: '84f84641c08679d7f99fac1519c960c1ec10d24c73b8d0f4937ffc8434e9b061',
    repairedSha256: '3d947068f28fd3171c75648c346ec7260000e7c1f7b27517d5109014d35ef9ee',
  }),
  Object.freeze({
    name: 'access_password', className: 'AccessPassword',
    modelPath: `${modelBase}/PSDELOGICS/access_password.json`,
    sourcePath: `${sourceBase}/AccessPassword.groovy`,
    modelSha256: 'e416cc1849469c1d0a1df00a32a207de627ae9cc7ad271e3c4750884fb05d8c9',
    generatedSha256: 'b557cb7a056f774fdefbfb739db30c99d337ae0ad438c07d9ca3372109318e56',
    repairedSha256: '0fc8635eaa45ca5a2fd03156af7a2bc7efd1a72f32280eaf12de040ad9e03fef',
  }),
]);

export function repairGeneratedWikiSharingSource({ target, source, modelBytes, entity }) {
  assert.ok(wikiDispatchTargets.includes(target), 'Only the two reviewed Wiki targets are allowed');
  assert.equal(hash(modelBytes), target.modelSha256, 'Authority model changed; review the native contract again');
  const model = JSON.parse(modelBytes);
  const embedded = entity.getAllPSDELogics.filter(row => row.codeName === target.name);
  assert.equal(embedded.length, 1);
  assert.deepEqual(embedded[0], model, 'Entity and dedicated logic models must agree');
  const raw = model.getPSDELogicNodes.filter(row => row.codeName === 'RAWSFCODE1');
  assert.equal(raw.length, 1);
  assert.equal(raw[0].logicNodeType, 'RAWSFCODE');
  const sourceHash = hash(source);
  assert.ok([target.generatedSha256, target.repairedSha256].includes(sourceHash),
    'Unreviewed generated or edited source; refusing to rewrite');
  if (sourceHash === target.repairedSha256) return { source, changed: false };
  assert.equal(source.split(method).length, 2, 'One reviewed raw method is required');
  const start = source.indexOf(method);
  const end = source.indexOf('\n    }\n', start);
  assert.ok(end > start);
  const repaired = source.slice(0, start) + delegated + source.slice(end + '\n    }'.length);
  assert.equal(hash(repaired), target.repairedSha256, 'Repair must match the reviewed complete source');
  return { source: repaired, changed: true };
}

function readRegular(filename) {
  assert.equal(fs.realpathSync(filename), path.resolve(filename));
  const state = fs.lstatSync(filename);
  assert.ok(state.isFile() && state.nlink === 1);
  const bytes = fs.readFileSync(filename);
  assert.equal(fs.lstatSync(filename).mtimeMs, state.mtimeMs);
  return bytes;
}

export function repairGeneratedWikiSharingDispatch({ root = workspace, apply = false } = {}) {
  const entityPath = path.join(root, `${modelBase}.json`);
  const entityBytes = readRegular(entityPath);
  const entity = JSON.parse(entityBytes);
  const plan = wikiDispatchTargets.map(target => {
    const filename = path.join(root, target.sourcePath);
    const original = readRegular(filename);
    const model = readRegular(path.join(root, target.modelPath));
    const result = repairGeneratedWikiSharingSource({
      target, source: original.toString('utf8'), modelBytes: model, entity,
    });
    return { target, filename, original, model, ...result };
  });
  assert.equal(hash(readRegular(entityPath)), hash(entityBytes));
  for (const row of plan) {
    assert.equal(hash(readRegular(row.filename)), hash(row.original));
    assert.equal(hash(readRegular(path.join(root, row.target.modelPath))), hash(row.model));
  }
  if (apply) {
    for (const row of plan.filter(row => row.changed)) fs.writeFileSync(row.filename, row.source);
  }
  return {
    status: apply ? 'APPLIED_REVIEWED_NATIVE_DELEGATION' : 'CHECKED_REVIEWED_NATIVE_DELEGATION',
    sharedRuntimeModified: false,
    targets: plan.map(row => ({
      name: row.target.name, path: row.target.sourcePath, modelPath: row.target.modelPath,
      beforeSha256: hash(row.original), afterSha256: hash(row.source),
      writeRequired: row.changed, written: apply && row.changed,
    })),
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const { values } = parseArgs({ options: { apply: { type: 'boolean', default: false } }, strict: true });
    console.log(JSON.stringify(repairGeneratedWikiSharingDispatch({ apply: values.apply }), null, 2));
  } catch (error) {
    console.error(JSON.stringify({ status: 'REFUSED_UNREVIEWED_WIKI_DISPATCH_REPAIR', message: error.message }));
    process.exitCode = 1;
  }
}
