import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  repairGeneratedWikiSharingDispatch, repairGeneratedWikiSharingSource, wikiDispatchTargets,
} from '../repair-generated-wiki-sharing-dispatch.mjs';

const workspace = path.resolve(new URL('../..', import.meta.url).pathname);
const read = relative => fs.readFileSync(path.join(workspace, relative));
const entity = JSON.parse(read('plm/model/PSMODULES/Wiki/PSDATAENTITIES/article_page.json'));
const signature = '    private void executeRAWSFCODE1(IDELogicSession iDELogicSession, IPSDELogicNode iPSDELogicNode) throws Throwable {';
const delegate = `${signature}\n        super.onExecutePSDELogicNode(iDELogicSession, iPSDELogicNode, true)\n    }`;
const digest = value => createHash('sha256').update(value).digest('hex');

function generatedMethod(model) {
  const raw = model.getPSDELogicNodes.find(row => row.codeName === 'RAWSFCODE1');
  const code = raw.code.replaceAll('\r\n', '\n').replaceAll('\n', '\n\t\t\t');
  return `${signature}
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
}

test('reviewed generated methods repair deterministically from authority model scripts', () => {
  for (const target of wikiDispatchTargets) {
    const modelBytes = read(target.modelPath);
    const source = read(target.sourcePath).toString('utf8');
    const generated = source.replace(delegate, generatedMethod(JSON.parse(modelBytes)));
    assert.equal(digest(generated), target.generatedSha256);
    const result = repairGeneratedWikiSharingSource({ target, source: generated, modelBytes, entity });
    assert.equal(result.changed, true);
    assert.equal(result.source, source);
    assert.equal(digest(result.source), target.repairedSha256);
  }
});

test('already repaired sources are idempotent and check mode does not write', () => {
  const before = wikiDispatchTargets.map(target => read(target.sourcePath));
  const result = repairGeneratedWikiSharingDispatch();
  assert.equal(result.status, 'CHECKED_REVIEWED_NATIVE_DELEGATION');
  assert.ok(result.targets.every(row => !row.writeRequired && !row.written));
  wikiDispatchTargets.forEach((target, index) => assert.deepEqual(read(target.sourcePath), before[index]));
});

test('source, model, embedded authority and unsupported targets fail closed', () => {
  const target = wikiDispatchTargets[0];
  const source = read(target.sourcePath).toString('utf8');
  const modelBytes = read(target.modelPath);
  for (const value of [
    { target: { ...target }, source, modelBytes, entity },
    { target, source: `${source}\n`, modelBytes, entity },
    { target, source, modelBytes: Buffer.concat([modelBytes, Buffer.from('\n')]), entity },
    { target, source, modelBytes, entity: { ...entity, getAllPSDELogics: [] } },
  ]) assert.throws(() => repairGeneratedWikiSharingSource(value));
});
