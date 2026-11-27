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

export const customerScoreDispatchTarget = Object.freeze({
  sourcePath: 'plm/backend/plm-core/src/main/groovy/cn/ibizlab/plm/prodmgmt/idea/logic/GetCustomerScore.groovy',
  entityPath: 'plm/model/PSMODULES/ProdMgmt/PSDATAENTITIES/idea.json',
  modelPath: 'plm/model/PSMODULES/ProdMgmt/PSDATAENTITIES/idea/PSDELOGICS/get_customer_score.json',
  modelSha256: '2443c042869be1c901023dde87c6d6920ae7814f0d93fe4ce555c5f01857b849',
  generatedSha256: 'ee0f4ea9eae79078afc9ad22da3204a0603d01e3b768ea4bb93534bbd34b56da',
  repairedSha256: 'a7868d0a6f3685cfd19e85c6513c841b930b02257466cddfb2d1db3138456905',
});

export function repairGeneratedCustomerScoreSource({ source, modelBytes, entity }) {
  const target = customerScoreDispatchTarget;
  assert.equal(hash(modelBytes), target.modelSha256, 'Authority score model changed; review again');
  const model = JSON.parse(modelBytes);
  const embedded = entity.getAllPSDELogics.filter(row => row.codeName === 'get_customer_score');
  assert.equal(embedded.length, 1);
  assert.deepEqual(embedded[0], model, 'Entity and dedicated score logic models must agree');
  const raw = model.getPSDELogicNodes.filter(row => row.codeName === 'RAWSFCODE1');
  assert.equal(raw.length, 1);
  assert.equal(raw[0].logicNodeType, 'RAWSFCODE');
  assert.equal(raw[0].getPSDELogicLinks[0].getDstPSDELogicNode.id, 'END1');
  const end = model.getPSDELogicNodes.find(row => row.codeName === 'END1');
  assert.equal(end.returnType, 'LOGICPARAM');
  assert.equal(end.getReturnParam.id, 'result');
  const sourceHash = hash(source);
  assert.ok([target.generatedSha256, target.repairedSha256].includes(sourceHash),
    'Unreviewed generated or edited customer-score source; refusing to rewrite');
  if (sourceHash === target.repairedSha256) return { source, changed: false };
  assert.equal(source.split(method).length, 2);
  const start = source.indexOf(method);
  const endOffset = source.indexOf('\n    }\n', start);
  assert.ok(endOffset > start);
  const repaired = source.slice(0, start) + delegated + source.slice(endOffset + '\n    }'.length);
  assert.equal(hash(repaired), target.repairedSha256);
  return { source: repaired, changed: true };
}

function readRegular(filename) {
  assert.equal(fs.realpathSync(filename), path.resolve(filename));
  const before = fs.lstatSync(filename);
  assert.ok(before.isFile() && before.nlink === 1);
  const descriptor = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const bytes = fs.readFileSync(descriptor);
    for (const after of [fs.fstatSync(descriptor), fs.lstatSync(filename)]) {
      for (const key of ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs']) assert.equal(after[key], before[key]);
    }
    return bytes;
  } finally { fs.closeSync(descriptor); }
}

export function repairGeneratedCustomerScoreDispatch({ root = workspace, apply = false } = {}) {
  const target = customerScoreDispatchTarget;
  const inputs = [target.sourcePath, target.modelPath, target.entityPath]
    .map(relative => ({ relative, filename: path.join(root, relative) }))
    .map(item => ({ ...item, bytes: readRegular(item.filename) }));
  const [original, modelBytes, entityBytes] = inputs.map(item => item.bytes);
  const result = repairGeneratedCustomerScoreSource({
    source: original.toString('utf8'), modelBytes, entity: JSON.parse(entityBytes),
  });
  for (const item of inputs) assert.equal(hash(readRegular(item.filename)), hash(item.bytes));
  if (apply && result.changed) fs.writeFileSync(inputs[0].filename, result.source);
  return {
    status: apply ? 'APPLIED_REVIEWED_CUSTOMER_SCORE_DELEGATION' : 'CHECKED_REVIEWED_CUSTOMER_SCORE_DELEGATION',
    path: target.sourcePath, modelPath: target.modelPath, modelSha256: target.modelSha256,
    beforeSha256: hash(original), afterSha256: hash(result.source),
    writeRequired: result.changed, written: apply && result.changed,
    sharedRuntimeModified: false,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const { values } = parseArgs({ options: { apply: { type: 'boolean', default: false } }, strict: true });
    console.log(JSON.stringify(repairGeneratedCustomerScoreDispatch({ apply: values.apply }), null, 2));
  } catch (error) {
    console.error(JSON.stringify({ status: 'REFUSED_UNREVIEWED_CUSTOMER_SCORE_REPAIR', message: error.message }));
    process.exitCode = 1;
  }
}
