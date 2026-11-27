import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  customerScoreDispatchTarget as target, repairGeneratedCustomerScoreDispatch,
  repairGeneratedCustomerScoreSource,
} from '../repair-generated-customer-score-dispatch.mjs';

const workspace = path.resolve(new URL('../..', import.meta.url).pathname);
const read = relative => fs.readFileSync(path.join(workspace, relative));
const source = read(target.sourcePath).toString('utf8');
const modelBytes = read(target.modelPath);
const entityBytes = read(target.entityPath);
const entity = JSON.parse(entityBytes);
const digest = value => createHash('sha256').update(value).digest('hex');
const signature = '    private void executeRAWSFCODE1(IDELogicSession iDELogicSession, IPSDELogicNode iPSDELogicNode) throws Throwable {';
const delegated = `${signature}\n        super.onExecutePSDELogicNode(iDELogicSession, iPSDELogicNode, true)\n    }`;

function originalGeneratedSource() {
  const raw = JSON.parse(modelBytes).getPSDELogicNodes.find(row => row.codeName === 'RAWSFCODE1');
  const code = raw.code.replaceAll('\r\n', '\n').replaceAll('\n', '\n\t\t\t');
  const method = `${signature}
        // 执行Groovy脚本代码
        def objRet = { sys,logic ->
            ${code}
        }.call(iDELogicSession.getDELogicRuntime().getSystemRuntime(), iDELogicSession.getDELogicRuntime())
        //设置返回值
        iDELogicSession.setLastReturn(objRet);
        if(iPSDELogicNode.getRetPSDELogicParam() != null) {
            def retDELogicParamRuntime = this.getDELogicParamRuntime(iPSDELogicNode.getRetPSDELogicParam().getCodeName(), false);
            retDELogicParamRuntime.bind(iDELogicSession, objRet);
        }
        //super.onExecutePSDELogicNode(iDELogicSession, iPSDELogicNode, true)
    }`;
  const generated = source.replace(delegated, method);
  assert.equal(digest(generated), target.generatedSha256);
  return generated;
}

test('authority model reconstructs the original generation and reproduces the exact reviewed source', () => {
  const result = repairGeneratedCustomerScoreSource({ source: originalGeneratedSource(), modelBytes, entity });
  assert.equal(result.changed, true);
  assert.equal(result.source, source);
  assert.equal(digest(result.source), target.repairedSha256);
});

test('independent owned replay applies once and preserves both model inputs', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aibiz-owned-score-dispatch-'));
  try {
    for (const [relative, bytes] of [
      [target.sourcePath, originalGeneratedSource()], [target.modelPath, modelBytes], [target.entityPath, entityBytes],
    ]) {
      const filename = path.join(root, relative);
      fs.mkdirSync(path.dirname(filename), { recursive: true });
      fs.writeFileSync(filename, bytes, { flag: 'wx' });
    }
    assert.equal(repairGeneratedCustomerScoreDispatch({ root }).writeRequired, true);
    const applied = repairGeneratedCustomerScoreDispatch({ root, apply: true });
    assert.equal(applied.written, true);
    assert.equal(fs.readFileSync(path.join(root, target.sourcePath), 'utf8'), source);
    assert.equal(repairGeneratedCustomerScoreDispatch({ root, apply: true }).written, false);
    assert.deepEqual(fs.readFileSync(path.join(root, target.modelPath)), modelBytes);
    assert.deepEqual(fs.readFileSync(path.join(root, target.entityPath)), entityBytes);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('unknown source, formula/model bytes and embedded authority fail closed', () => {
  for (const value of [
    { source: `${source}\n`, modelBytes, entity },
    { source, modelBytes: Buffer.concat([modelBytes, Buffer.from('\n')]), entity },
    { source, modelBytes, entity: { ...entity, getAllPSDELogics: [] } },
    { source, modelBytes, entity: { ...entity, getAllPSDELogics: [{ codeName: 'get_customer_score' }] } },
  ]) assert.throws(() => repairGeneratedCustomerScoreSource(value));
  assert.equal(repairGeneratedCustomerScoreDispatch().written, false);
});
