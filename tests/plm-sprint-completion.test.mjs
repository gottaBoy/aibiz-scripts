import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const workspace = new URL('../../', import.meta.url);
const read = path => readFileSync(new URL(path, workspace), 'utf8');
const json = path => JSON.parse(read(path));
const base = 'plm/model/PSMODULES/ProjMgmt/PSDATAENTITIES';
const logicPath = `${base}/sprint/PSDELOGICS/end_sprint.json`;
const logic = json(logicPath);
const embedded = json(`${base}/sprint.json`).getAllPSDELogics.find(item => item.codeName === 'end_sprint');
const nodeFrom = (model, id) => model.getPSDELogicNodes.find(node => node.codeName === id);
const guardFrom = model => nodeFrom(model, 'LOOPSUBCALL2').getPSDELogicLinks
  .find(link => link.getDstPSDELogicNode.id === 'RENEWPARAM1').getPSDELogicLinkGroupCond;
const field = (object, name) => Object.entries(object ?? {})
  .find(([key]) => key.toLowerCase() === name.toLowerCase())?.[1] ?? null;

// Only the operators used by this model are interpreted. This is not the Java runtime.
function conditionMatches(condition, params) {
  if (condition.logicType === 'GROUP') {
    assert.equal(condition.groupOP, 'AND');
    return condition.getPSDELogicLinkConds.every(child => conditionMatches(child, params));
  }
  assert.equal(condition.logicType, 'SINGLE');
  const value = field(params[condition.getDstLogicParam.id], condition.dstFieldName);
  if (condition.condOP === 'ISNOTNULL') return value !== null;
  const expected = condition.paramValue ?? null;
  if (condition.condOP === 'EQ') return value === expected;
  if (condition.condOP === 'NOTEQ') return value !== expected;
  assert.fail(`Unsupported model operator ${condition.condOP}`);
}

function itemUpdates(model, item, choice) {
  const params = { for_work_item_temp: item, for_sprint_temp: choice };
  const updates = [];
  const loopLink = nodeFrom(model, 'LOOPSUBCALL2').getPSDELogicLinks
    .find(link => link.getDstPSDELogicNode.id === 'RENEWPARAM1');
  if (!conditionMatches(loopLink.getPSDELogicLinkGroupCond, params)) return updates;
  let current = loopLink.getDstPSDELogicNode.id;
  for (let step = 0; current && step < 10; step++) {
    const node = nodeFrom(model, current);
    if (node.logicNodeType === 'RENEWPARAM') {
      params[node.getDstPSDELogicParam.id] = {};
    } else if (node.logicNodeType === 'PREPAREPARAM') {
      for (const assignment of node.getPSDELogicNodeParams) {
        assert.equal(assignment.paramAction, 'SETPARAMVALUE');
        let value;
        if (assignment.srcValueType === 'NULLVALUE') value = null;
        else if (assignment.srcValueType === 'SRCVALUE') value = assignment.srcValue;
        else if (assignment.srcValueType === 'SRCDLPARAM') {
          value = field(params[assignment.getSrcPSDELogicParam.id], assignment.srcFieldName);
        } else assert.fail(`Unsupported assignment ${assignment.srcValueType}`);
        params[assignment.getDstPSDELogicParam.id][assignment.dstFieldName] = value;
      }
    } else {
      assert.equal(node.codeName, 'DEACTION1');
      updates.push({ ...params[node.getDstPSDELogicParam.id] });
      return updates;
    }
    current = node.getPSDELogicLinks?.find(link =>
      !link.getPSDELogicLinkGroupCond || conditionMatches(link.getPSDELogicLinkGroupCond, params))
      ?.getDstPSDELogicNode.id;
  }
  assert.ok(!current, 'Unexpected loop in the isolated per-item model path');
  return updates;
}

test('standalone and embedded sprint completion models remain byte-equivalent as parsed data', () => {
  assert.deepEqual(logic, embedded);
  const loop = nodeFrom(logic, 'LOOPSUBCALL2');
  assert.equal(loop.getDstPSDELogicParam.id, 'for_work_item_temp');
  assert.equal(loop.getSrcPSDELogicParam.id, 'work_item_page');
  assert.equal(loop.getPSDELogicLinks.length, 1);
  assert.equal(loop.getPSDELogicLinks[0].subCallLink, true);
  const guard = guardFrom(logic);
  assert.equal(guard.groupOP, 'AND');
  assert.deepEqual(guard.getPSDELogicLinkConds.map(condition =>
    [condition.condOP, condition.dstFieldName, condition.getDstLogicParam.id, condition.paramValue ?? null]), [
    ['ISNOTNULL', 'STATE_TYPE', 'for_work_item_temp', null],
    ['NOTEQ', 'STATE_TYPE', 'for_work_item_temp', ''],
    ['NOTEQ', 'STATE_TYPE', 'for_work_item_temp', 'completed'],
    ['NOTEQ', 'STATE_TYPE', 'for_work_item_temp', 'closed'],
  ]);
});

test('framework source binds each item before testing subcall link conditions in both execution modes', () => {
  const runtimeBase = 'ibiz-service-hub/libs/ibiz-runtime/src/main/java/net/ibizsys';
  const loop = read(`${runtimeBase}/central/dataentity/logic/DELogicLoopSubCallNodeRuntime.java`);
  for (const session of ['cloneDELogicSession', 'iDELogicSession']) {
    const bind = `dstDELogicParamRuntime.bind(${session}, item)`;
    const check = `iDELogicRuntimeContext.testLinkCond(${session}, iPSDELogicLink.getPSDELogicLinkGroupCond())`;
    const execute = `iDELogicRuntimeContext.executeNode(${session}, iPSDELogicLink.getDstPSDELogicNodeMust())`;
    assert.ok(loop.indexOf(bind) >= 0);
    assert.ok(loop.indexOf(check) > loop.indexOf(bind));
    assert.ok(loop.indexOf(execute, loop.indexOf(check)) > loop.indexOf(check));
  }
  const runtime = read(`${runtimeBase}/central/dataentity/logic/DELogicRuntime.java`);
  assert.ok(runtime.includes('getGroupOP().equals(Conditions.AND)'));
  assert.ok(runtime.includes('return DataTypeUtils.testCond(objSrcValue, strOP, objDstValue)'));
  const types = read(`${runtimeBase}/runtime/util/DataTypeUtils.java`);
  assert.match(types, /Conditions\.ISNOTNULL\.equals\(strOp\)[\s\S]*?return objSrcValue != null;/);
  assert.match(types, /if \(objSrcValue == null\)[\s\S]*?Conditions\.NOTEQ\.equals\(strOp\)[\s\S]*?return \(objDstValue != null\)/);
  const getter = read('ibiz-service-hub/libs/ibiz-model/src/main/java/net/ibizsys/model/dataentity/logic/PSDELogicLinkSingleCondImpl.java');
  assert.match(getter, /String getParamValue\(\)[\s\S]*?get\(ATTR_GETPARAMVALUE\)[\s\S]*?return value\.asText\(\)/);
});

test('guard uses state type rather than state ID and excludes missing or empty types', () => {
  for (const model of [logic, embedded]) {
    const guard = guardFrom(model);
    for (const [item, expected] of [
      [{ state_type: 'pending', state: '40' }, true],
      [{ state_type: 'in_progress', state: 'custom-progress' }, true],
      [{ state_type: 'completed', state: 'custom-done' }, false],
      [{ state_type: 'closed', state: 'custom-closed' }, false],
      [{ state_type: null, state: '40' }, false],
      [{ state: '40' }, false],
      [{ state_type: '', state: '40' }, false],
      [{ state_type: 'future-custom-type', state: 'custom' }, true],
    ]) {
      assert.equal(conditionMatches(guard, { for_work_item_temp: item }), expected, JSON.stringify(item));
    }
  }
});

test('finish, move and backlog paths never update completed, closed or unknown-empty work items', () => {
  const choices = [
    { choose_finish: '1' },
    { choose_move: '1', target_sprint_id: 'target-sprint' },
    { choose_move: '1', target_sprint_id: '待分配工作项' },
  ];
  for (const model of [logic, embedded]) {
    for (const choice of choices) {
      for (const type of ['completed', 'closed', null, '', undefined]) {
        const item = { ID: 'preserved', STATE_TYPE: type, STATE: 'custom', SPRINT_ID: 'original' };
        const before = structuredClone(item);
        assert.deepEqual(itemUpdates(model, item, choice), []);
        assert.deepEqual(item, before);
      }
    }
  }
});

test('pending custom state 40 and in-progress work retain all three user-selected processing paths', () => {
  for (const model of [logic, embedded]) {
    for (const type of ['pending', 'in_progress']) {
      const item = { ID: 'unfinished', STATE_TYPE: type, STATE: '40', SPRINT_ID: 'original' };
      assert.deepEqual(itemUpdates(model, item, { choose_finish: '1' }),
        [{ STATE: '40', ID: 'unfinished' }], 'Existing completion-state value is intentionally unchanged');
      assert.deepEqual(itemUpdates(model, item, { choose_move: '1', target_sprint_id: 'target-sprint' }),
        [{ SPRINT_ID: 'target-sprint', ID: 'unfinished' }]);
      assert.deepEqual(itemUpdates(model, item, { choose_move: '1', target_sprint_id: '待分配工作项' }),
        [{ SPRINT_ID: null, ID: 'unfinished' }]);
      assert.deepEqual(itemUpdates(model, item, {}), [], 'No explicit choice never defaults to completed');
    }
  }
});

test('sprint/project filters, query data set and returned state-type contract remain intact', () => {
  const filters = nodeFrom(logic, 'PREPAREPARAM5').getPSDELogicNodeParams;
  assert.deepEqual(filters.map(item => [item.dstFieldName, item.srcFieldName, item.getSrcPSDELogicParam.id]), [
    ['n_sprint_id_eq', 'ID', 'for_sprint_temp'],
    ['n_project_id_eq', 'PROJECT_ID', 'for_sprint_temp'],
  ]);
  const dataset = nodeFrom(logic, 'DEDATASET1');
  assert.equal(dataset.getDstPSDEDataSet.id, 'normal');
  const workItem = json(`${base}/work_item.json`);
  const normal = workItem.getAllPSDEDataSets.find(item => item.codeName === 'normal');
  assert.equal(normal.getPSDEDataSetReturn.getPSDEMethodDTO.id, 'work_item_plan_dto');
  const dto = workItem.getAllPSDEMethodDTOs.find(item => item.name === 'work_item_plan_dto');
  assert.ok(dto.getPSDEMethodDTOFields.some(item => item.name === 'state_type'));
  const action = json(`${base}/sprint/PSDEACTIONS/end_sprint.json`);
  assert.equal(action.getPSDELogic.path, 'PSMODULES/ProjMgmt/PSDATAENTITIES/sprint/PSDELOGICS/end_sprint.json');
});

test('legacy BPMN represents the same guard without pretending its executor was exercised', () => {
  const result = spawnSync('python3', ['-c', `
import json, sys, xml.etree.ElementTree as ET
root = ET.fromstring(sys.stdin.read())
ns = {"b": "http://www.omg.org/spec/BPMN/20100524/MODEL"}
flow = root.find(".//b:sequenceFlow[@id='loopsubcall2_renewparam1']", ns)
condition = flow.find("b:conditionExpression", ns)
print(json.dumps({"source": flow.attrib["sourceRef"], "target": flow.attrib["targetRef"],
                 "expression": condition.text}))
`], { input: read(`${logicPath}.bpmn`), encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  const flow = JSON.parse(result.stdout);
  assert.equal(flow.source, 'loopsubcall2');
  assert.equal(flow.target, 'renewparam1');
  const matches = [...flow.expression.matchAll(
    /RuleUtils\.test\(\$sprintend_sprintfor_work_item_temp\.get\("([^"]+)"\),"([^"]+)",(null|"[^"]*")\)/g)];
  assert.equal(matches.length, 4);
  const legacyGuard = {
    logicType: 'GROUP', groupOP: 'AND',
    getPSDELogicLinkConds: matches.map(([, name, condOP, value]) => ({
      logicType: 'SINGLE', condOP, dstFieldName: name,
      getDstLogicParam: { id: 'for_work_item_temp' }, paramValue: JSON.parse(value),
    })),
  };
  for (const type of ['pending', 'in_progress', 'completed', 'closed', null, '', undefined]) {
    const params = { for_work_item_temp: { state_type: type } };
    assert.equal(conditionMatches(legacyGuard, params), conditionMatches(guardFrom(logic), params));
  }
  const groovy = read('plm/backend/plm-core/src/main/groovy/cn/ibizlab/plm/projmgmt/sprint/logic/EndSprint.groovy');
  assert.ok(groovy.includes('super.onExecutePSDELogicNode(iDELogicSession, iPSDELogicNode, true)'));
  const drl = read(`${logicPath}.drl`);
  assert.match(drl, /rule "loopsubcall2"[\s\S]*?when\s+then\s+update\(/);
});
