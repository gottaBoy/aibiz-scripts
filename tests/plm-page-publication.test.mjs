import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const workspace = new URL('../../', import.meta.url);
const read = path => readFileSync(new URL(path, workspace), 'utf8');
const json = path => JSON.parse(read(path));
const base = 'plm/model/PSMODULES/Wiki/PSDATAENTITIES/article_page';
const logic = json(`${base}/PSDELOGICS/publish_page.json`);
const action = json(`${base}/PSDEACTIONS/publish_page.json`);
const nodeFrom = (model, id) => model.getPSDELogicNodes.find(node => node.codeName === id);
const timestamp = '2030-01-02T03:04:05.000Z';
const actor = 'owned-publication-editor';
const field = (object, name) => object[name.toLowerCase()] ?? null;
const identifiers = ['7', 'not-a-number', null, '0'];

test('standalone and entity-embedded publication definitions remain identical', () => {
  const entity = json('plm/model/PSMODULES/Wiki/PSDATAENTITIES/article_page.json');
  assert.deepEqual(entity.getAllPSDEActions.find(item => item.codeName === 'publish_page'), action);
  assert.deepEqual(entity.getAllPSDELogics.find(item => item.codeName === 'publish_page'), logic);
});

test('desktop, wiki, mobile and generated desktop clients keep publication out of CREATE mode', () => {
  for (const app of ['plmweb', 'plmwiki', 'plmmob']) {
    const entity = json(`plm/model/PSSYSAPPS/${app}/PSAPPDATAENTITIES/article_page.json`);
    const methods = entity.getAllPSAppDEActions.filter(item => item.codeName === 'publish_page');
    assert.equal(methods.length, 1);
    assert.equal(methods[0].actionMode, 'CUSTOM', app);
    assert.equal(methods[0].getPSDEOPPriv.id, 'UPDATE', app);
    assert.equal(methods[0].requestPath, '/publish_page', app);
  }
  const require = createRequire(new URL('ibiz-app-hub/package.json', workspace));
  const ts = require('typescript');
  const source = ts.createSourceFile('article-page.ts',
    read('plm-web/src/publish/model/entities/article-page.ts'),
    ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  assert.deepEqual(source.parseDiagnostics, []);
  const property = (node, name) => node.properties.find(item => item.name?.text === name)?.initializer;
  const methods = [];
  const visit = node => {
    if (ts.isObjectLiteralExpression(node) && property(node, 'id')?.text === 'publish_page'
      && property(node, 'requestPath')?.text === '/publish_page') methods.push(node);
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.equal(methods.length, 1);
  assert.equal(property(methods[0], 'actionMode').text, 'CUSTOM');
  assert.equal(property(methods[0], 'requestMethod').text, 'POST');
});

function localJars(includeModel = false) {
  const paths = [
    'org/codehaus/groovy/groovy/3.0.20/groovy-3.0.20.jar',
    'org/codehaus/groovy/groovy-json/3.0.20/groovy-json-3.0.20.jar',
    'cn/ibizlab/plugin/ibiz-runtime/8.1.0.584.1/ibiz-runtime-8.1.0.584.1.jar',
    'org/springframework/spring-core/5.3.1/spring-core-5.3.1.jar',
    'org/springframework/spring-jcl/5.3.1/spring-jcl-5.3.1.jar',
  ];
  if (includeModel) paths.push(
    'cn/ibizlab/plugin/ibiz-model/8.1.0.584.1/ibiz-model-8.1.0.584.1.jar',
    'com/fasterxml/jackson/core/jackson-core/2.11.3/jackson-core-2.11.3.jar',
    'com/fasterxml/jackson/core/jackson-databind/2.11.3/jackson-databind-2.11.3.jar',
    'com/fasterxml/jackson/core/jackson-annotations/2.11.3/jackson-annotations-2.11.3.jar',
    'commons-io/commons-io/2.6/commons-io-2.6.jar',
  );
  return paths.map(path => {
    const jar = join(homedir(), '.m2/repository', path);
    assert.ok(statSync(jar).isFile(), `Missing local compiler input: ${jar}`);
    return jar;
  });
}

function groovy(script, input, args = [], includeModel = false) {
  const result = spawnSync('java', ['-cp', localJars(includeModel).join(':'),
    'groovy.ui.GroovyMain', '-e', script, ...args], {
    input: JSON.stringify(input), encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stderr || String(result.error));
  return result.stdout.trim();
}

// Execute the actual sequence script once per identifier, not a rewritten JS approximation.
const sequenceResults = JSON.parse(groovy(`
import groovy.json.JsonSlurper
import groovy.json.JsonOutput
class Fields {
    Map values
    Object get(String key) { values[key.toLowerCase()] }
    void set(String key, Object value) { values[key.toLowerCase()] = value }
}
def input = new JsonSlurper().parse(System.in)
def values = input.identifiers.collect { identifier ->
    def fields = new Fields(values: [identifier: identifier, sentinel: 'preserved'])
    def bridge = [param: { String name ->
        assert name == 'Default'
        [getReal: { -> fields }]
    }]
    new GroovyShell(new Binding([logic: bridge])).evaluate(input.code)
    fields.values
}
println JsonOutput.toJson(values)
`, { code: nodeFrom(logic, 'RAWSFCODE_01').code, identifiers }));

function matches(condition, data) {
  if (!condition) return true;
  if (condition.logicType === 'GROUP') {
    const children = condition.getPSDELogicLinkConds;
    assert.ok(Array.isArray(children) && children.length);
    let result;
    if (condition.groupOP === 'AND') result = children.every(child => matches(child, data));
    else if (condition.groupOP === 'OR') result = children.some(child => matches(child, data));
    else assert.fail(`Unsupported group ${condition.groupOP}`);
    return condition.notMode ? !result : result;
  }
  assert.equal(condition.logicType, 'SINGLE');
  assert.equal(condition.getDstLogicParam.id, 'Default');
  const value = field(data, condition.dstFieldName);
  if (condition.condOP === 'ISNULL') return value === null;
  if (condition.condOP === 'ISNOTNULL') return value !== null;
  const expected = condition.paramValue ?? null;
  const equal = value === null ? expected === null : String(value) === String(expected);
  if (condition.condOP === 'EQ') return equal;
  if (condition.condOP === 'NOTEQ') return !equal;
  assert.fail(`Unsupported condition ${condition.condOP}`);
}

// Bounded model-graph interpreter. Storage is an observable boundary, not a real provider.
function publish(model, incoming, storedIds = new Set()) {
  const data = structuredClone(incoming);
  const trace = [];
  const saves = [];
  let result;
  let steps = 0;
  function execute(id) {
    assert.ok(++steps < 30, 'Unexpected loop or duplicate publication chain');
    const node = nodeFrom(model, id);
    assert.ok(node, `Missing node ${id}`);
    trace.push(id);
    if (node.logicNodeType === 'PREPAREPARAM') {
      for (const assignment of node.getPSDELogicNodeParams ?? []) {
        assert.equal(assignment.paramAction, 'SETPARAMVALUE');
        assert.equal(assignment.getDstPSDELogicParam.id, 'Default');
        let value;
        if (assignment.srcValueType === 'NULLVALUE') value = null;
        else if (assignment.srcValueType === 'SRCVALUE') value = assignment.srcValue;
        else if (assignment.srcValueType === 'SESSION') {
          assert.equal(assignment.srcFieldName, 'srfpersonid');
          value = actor;
        } else if (assignment.srcValueType === 'SRCDLPARAM') {
          assert.equal(assignment.getSrcPSDELogicParam.id, 'Default');
          value = field(data, assignment.srcFieldName);
        } else assert.fail(`Unsupported assignment ${assignment.srcValueType}`);
        data[assignment.dstFieldName.toLowerCase()] = value;
      }
    } else if (node.logicNodeType === 'RAWSFCODE') {
      if (node.codeType === 'JavaScript') {
        class Clock extends Date { constructor() { super(timestamp); } }
        runInNewContext(node.code, {
          Date: Clock,
          logic: { getParam(name) {
            assert.equal(name.toLowerCase(), 'default');
            return { set(key, value) { data[key.toLowerCase()] = value; } };
          } },
        }, { timeout: 1000 });
      } else {
        assert.equal(node.codeType, 'Groovy');
        assert.equal(node.code, nodeFrom(logic, 'RAWSFCODE_01').code);
        const index = identifiers.indexOf(field(data, 'identifier'));
        assert.notEqual(index, -1, 'A sequence input must have actual Groovy evidence');
        assert.equal(sequenceResults[index].sentinel, 'preserved');
        data.sequence = sequenceResults[index].sequence;
      }
    } else if (node.logicNodeType === 'DEACTION') {
      assert.equal(node.getDstPSDELogicParam.id, 'Default');
      assert.equal(node.getDstPSDEAction.path, `${base.replace('plm/model/', '')}/PSDEACTIONS/Save.json`);
      saves.push({ node: id, mode: storedIds.has(data.id) ? 'UPDATE' : 'CREATE',
        input: structuredClone(data) });
      if (data.id == null || data.id === 'undefined') data.id = 'new-owned-page';
    } else if (node.logicNodeType === 'END') {
      assert.equal(node.returnType, 'LOGICPARAM');
      assert.equal(node.getReturnParam.id, 'Default');
      result = data;
    } else {
      assert.ok(['BEGIN', 'DEBUGPARAM'].includes(node.logicNodeType));
    }
    const links = node.getPSDELogicLinks ?? [];
    for (const link of links) {
      assert.ok(!link.catchLink && !link.subCallLink);
      if (!matches(link.getPSDELogicLinkGroupCond, data)) continue;
      execute(link.getDstPSDELogicNode.id);
      if (!node.parallelOutput || links.length <= 1) return;
    }
  }
  execute(model.getStartPSDELogicNode.id);
  return { data, trace, saves, result };
}

test('publication remains a write-authorized CUSTOM logic with two standard Save destinations', () => {
  assert.equal(action.actionMode, 'CUSTOM');
  assert.equal(action.dataAccessAction, 'UPDATE');
  assert.equal(action.actionType, 'DELOGIC');
  assert.equal(action.getPSDELogic.path, `${base.replace('plm/model/', '')}/PSDELOGICS/publish_page.json`);
  for (const id of ['DEACTION2', 'DEACTION3']) {
    assert.equal(nodeFrom(logic, id).getDstPSDEAction.path.endsWith('/Save.json'), true);
  }
  assert.equal(logic.enableBackend, true);
  assert.equal(logic.enableFront, false);
  const runtime = read('ibiz-service-hub/libs/ibiz-runtime/src/main/java/net/ibizsys/central/dataentity/DataEntityRuntime.java');
  const branch = runtime.slice(runtime.indexOf('if (this.getSystemPersistentAdapter() != null && ((DEActions.SAVE'));
  assert.match(branch.slice(0, 6000), /return executeAction\(DEActions\.UPDATE, null, new Object\[\] \{ iEntityDTO, bGet \}\)/);
  assert.match(branch.slice(0, 6000), /return executeAction\(DEActions\.CREATE, null, new Object\[\] \{ iEntityDTO, bGet \}\)/);
});

test('framework condition and parallel-output semantics match the bounded interpreter', () => {
  const runtime = read('ibiz-service-hub/libs/ibiz-runtime/src/main/java/net/ibizsys/central/dataentity/logic/DELogicRuntime.java');
  assert.match(runtime, /boolean bParallelOutput = iPSDELogicNode\.isParallelOutput\(\)/);
  assert.match(runtime, /executePSDELogicNode\(iDELogicSession, iPSDELogicLink\.getDstPSDELogicNodeMust\(\)\);[\s\S]*?if\(!bParallelOutput\) \{\s*return;/);
  assert.match(runtime, /if\(iPSDELogicLinkGroupCond\.isNotMode\(\)\) \{\s*bRet = !bRet;/);
  const cases = [null, 0, 1, '0', '1', 'undefined', 'draft-id'].flatMap(value =>
    ['EQ', 'NOTEQ', 'ISNULL', 'ISNOTNULL'].map(op => ({ value, op, expected: '1' })));
  const actual = JSON.parse(groovy(`
import groovy.json.JsonSlurper
import groovy.json.JsonOutput
import net.ibizsys.runtime.util.DataTypeUtils
def input = new JsonSlurper().parse(System.in)
println JsonOutput.toJson(input.collect { DataTypeUtils.testCond(it.value, it.op, it.expected) })
`, cases));
  for (const [index, item] of cases.entries()) {
    assert.equal(matches({
      logicType: 'SINGLE', getDstLogicParam: { id: 'Default' },
      dstFieldName: 'value', condOP: item.op, paramValue: item.expected,
    }, { value: item.value }), actual[index]);
  }
});

test('all ID and publication flag combinations save once with the correct metadata and flags', () => {
  const ids = [undefined, null, 'undefined', 'draft-id', 'published-id', 'new-client-id', ''];
  const flags = [undefined, null, 0, 1, '0', '1'];
  const storedIds = new Set(['draft-id', 'published-id']);
  let count = 0;
  for (const id of ids) for (const first of flags) for (const second of flags) {
    for (const identifier of identifiers) {
      const incoming = { id, is_published: first, published: second, identifier,
        name: '\u4e2d\u6587 \ud83d\ude00 e\u0301 "title" \\',
        content: 'body\n\u4e2d\u6587 \ud83d\ude00 e\u0301 "quoted" \\', space_id: 'owned-space' };
      const before = structuredClone(incoming);
      const result = publish(logic, incoming, storedIds);
      const label = JSON.stringify([id, first, second, identifier]);
      assert.equal(result.saves.length, 1, label);
      assert.equal(String(result.data.is_published), '1', label);
      assert.equal(String(result.data.published), '1', label);
      assert.equal(result.data.publish_name, incoming.name, label);
      assert.equal(result.data.publish_content, incoming.content, label);
      assert.equal(result.data.publish_man, actor, label);
      assert.equal(result.data.publish_time.toISOString(), timestamp, label);
      assert.equal(result.data.space_id, incoming.space_id, label);
      assert.equal(result.result, result.data, label);
      assert.equal(result.saves[0].mode, storedIds.has(id) ? 'UPDATE' : 'CREATE', label);
      assert.equal(result.data.id, id == null || id === 'undefined' ? 'new-owned-page' : id, label);
      assert.deepEqual(incoming, before, 'The controlled interpreter must not mutate its caller');
      if (id != null && id !== 'undefined' && String(first) === '1' && String(second) === '1') {
        assert.equal(result.saves[0].node, 'DEACTION3', label);
      } else {
        assert.ok(result.trace.includes('PREPAREPARAM2'), label);
        assert.equal(result.saves[0].node, 'DEACTION2', label);
        assert.equal(result.data.sequence, identifier === '7' ? 700 : identifier === '0' ? 0 : 1, label);
      }
      count += 1;
    }
  }
  assert.equal(count, 1008);
});

test('new/existing links are exhaustive and exclusive even when parallel output is enabled', () => {
  const links = nodeFrom(logic, 'RAWSFCODE_01').getPSDELogicLinks;
  assert.equal(links.length, 2);
  assert.equal(nodeFrom(logic, 'RAWSFCODE_01').parallelOutput, true);
  for (const id of [null, undefined, 'undefined', '', 'draft-id', 'unpersisted-id']) {
    assert.equal(links.filter(link => matches(link.getPSDELogicLinkGroupCond, { id })).length, 1);
    for (const link of links) assert.equal(link.getDstPSDELogicNode.id, 'PREPAREPARAM2');
  }
  const regressed = structuredClone(logic);
  delete nodeFrom(regressed, 'RAWSFCODE_01').getPSDELogicLinks[1].getPSDELogicLinkGroupCond;
  const duplicate = publish(regressed, { id: 'draft-id', is_published: 0, published: 0,
    identifier: '7', name: 'owned', content: 'owned' }, new Set(['draft-id']));
  assert.equal(duplicate.saves.length, 2, 'An unconditional fallback recreates the original double-save failure');
});

test('official loader resolves standalone publication conditions and both Save references', () => {
  const output = groovy(`
import net.ibizsys.model.PSModelServiceImpl
import net.ibizsys.model.dataentity.logic.IPSDELogic
import net.ibizsys.model.dataentity.action.IPSDEAction
def service = new PSModelServiceImpl()
service.setPSModelFolderPath(args[0])
def base = 'PSMODULES/Wiki/PSDATAENTITIES/article_page'
def action = service.getPSModelObject(null, IPSDEAction.class, base + '/PSDEACTIONS/publish_page.json')
def flow = service.getPSModelObject(null, IPSDELogic.class, base + '/PSDELOGICS/publish_page.json')
assert action.actionMode == 'CUSTOM'
assert action.dataAccessAction == 'UPDATE'
def decision = flow.getPSDELogicNodes().find { it.codeName == 'PREPAREPARAM5' }
assert decision.getPSDELogicLinks()[1].getPSDELogicLinkGroupCond().notMode
['DEACTION2', 'DEACTION3'].each { name ->
    def node = flow.getPSDELogicNodes().find { it.codeName == name }
    assert node.getDstPSDEAction().codeName == 'Save'
}
assert flow.getPSDELogicNodes().find { it.codeName == 'RAWSFCODE_01' }.getPSDELogicLinks().size() == 2
println 'OFFICIAL-PUBLICATION-MODEL-PASS'
`, {}, [new URL('plm/model', workspace).pathname], true);
  assert.match(output, /OFFICIAL-PUBLICATION-MODEL-PASS/);
});
