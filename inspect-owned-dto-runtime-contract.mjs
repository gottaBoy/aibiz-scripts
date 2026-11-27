#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = path.join(workspace, '.artifacts');
const receiptPath = '.artifacts/plm-publication-provider-candidate-20261123-r4/report.private.json';
const receiptHash = '57b4be760a3f0ec4e90d14fa851bee318ad337206b65fe5df74fa2fbabe65b24';
const javaHash = '0cd543f9949605b5eccb1d2b98c2b8637bb0953f0b5087208393b4b7ded73c1a';
const ideaPath = 'PSMODULES/ProdMgmt/PSDATAENTITIES/idea.json';
const settingPath = 'PSMODULES/Base/PSDATAENTITIES/view_theme_setting.json';
const logicPath = 'PSMODULES/ProdMgmt/PSDATAENTITIES/idea/PSDELOGICS/get_customer_score.json';
const scoreSource = 'plm/backend/plm-core/src/main/groovy/cn/ibizlab/plm/prodmgmt/idea/logic/GetCustomerScore.groovy';
const sources = [
  'scripts/inspect-owned-dto-runtime-contract.mjs',
  'scripts/tests/inspect-owned-dto-runtime-contract.test.mjs',
  `plm/model/${ideaPath}`, `plm/model/${settingPath}`,
  'plm/model/PSSYSTEM.json', 'plm/model/PSSYSDYNAMODELS/Usr1014979662.json',
  `plm/model/${logicPath}`,
  'plm/model/PSMODULES/ProdMgmt/PSDATAENTITIES/idea/PSDEACTIONS/get_customer_score.json',
  'plm/backend/plm-core/src/main/groovy/cn/ibizlab/plm/prodmgmt/idea/dto/IdeaDefGroupCommonDTO.groovy',
  'plm/backend/plm-core/src/main/groovy/cn/ibizlab/plm/base/viewthemesetting/dto/ViewThemeSettingUsr1014979662DTO.groovy',
  'plm/backend/plm-core/src/main/groovy/cn/ibizlab/plm/base/viewthemesetting/dto/ViewThemeSettingDTO.groovy',
  scoreSource,
];
const hash = value => createHash('sha256').update(value).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;

function regularRead(file) {
  assert.equal(fs.realpathSync(file), path.resolve(file), 'DTO contract inputs cannot traverse symlinks');
  const before = fs.lstatSync(file);
  assert.ok(before.isFile() && before.nlink === 1 && before.size < 64 * 1024 * 1024);
  const descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const bytes = fs.readFileSync(descriptor);
    for (const after of [fs.fstatSync(descriptor), fs.lstatSync(file)]) {
      for (const key of ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs']) assert.equal(after[key], before[key]);
    }
    return bytes;
  } finally { fs.closeSync(descriptor); }
}

function write(directory, relative, bytes) {
  assert.ok(!path.isAbsolute(relative) && !relative.split('/').includes('..'));
  const file = path.join(directory, relative);
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  fs.writeFileSync(file, bytes, { flag: 'wx', mode: 0o600 });
  return { path: relative, sha256: hash(bytes), bytes: Buffer.byteLength(bytes) };
}

export function inspectDtoAuthorities({ idea, setting, system, dynamicModel, logic, action }) {
  const find = (list, predicate, message) => {
    const rows = list.filter(predicate);
    assert.equal(rows.length, 1, message);
    return rows[0];
  };
  const ideaDTO = find(idea.getAllPSDEMethodDTOs, row => row.name === 'idea_def_group_common_dto', 'Exact idea DTO');
  const dynamicDTO = find(setting.getAllPSDEMethodDTOs, row => row.name === 'view_theme_setting_usr1014979662dto',
    'Exact dynamic DTO');
  const shared = find(system.getAllPSSysMethodDTOs, row => row.name === dynamicDTO.getSrcPSSysMethodDTO?.id,
    'Exact source system DTO');
  const fields = find(setting.getAllPSDEMethodDTOs, row => row.name === 'view_theme_setting_dto',
    'Exact settings DTO').getPSDEMethodDTOFields;
  const nested = find(fields, row => row.name === 'search_conds', 'Declared nested settings field');
  const group = find(idea.getAllPSDEFGroups, row => row.codeName === 'DEFGroup_common', 'Exact common group');
  const declared = value => Object.hasOwn(value, 'getPSDEMethodDTOFields') ? value.getPSDEMethodDTOFields : null;
  const sourceFields = Object.hasOwn(shared, 'getPSSysMethodDTOFields') ? shared.getPSSysMethodDTOFields : null;
  assert.equal(nested.type, 'DTOS');
  assert.equal(nested.getRefPSDEMethodDTO.id, dynamicDTO.name);
  assert.equal(action.getPSDEActionReturn.type, 'DTO');
  assert.equal(action.getPSDEActionReturn.getPSDEMethodDTO.id, ideaDTO.name);
  assert.equal(action.getPSDELogic.path, logicPath);
  const raw = find(logic.getPSDELogicNodes, row => row.codeName === 'RAWSFCODE1', 'Exact score calculation node');
  const end = find(logic.getPSDELogicNodes, row => row.codeName === 'END1', 'Exact return node');
  assert.equal(raw.getPSDELogicLinks[0].getDstPSDELogicNode.id, 'END1');
  assert.equal(end.getReturnParam.id, 'result');
  assert.equal(end.returnType, 'LOGICPARAM');
  const outputKeys = [...raw.code.matchAll(/result\.set\("(customer_score(?:_precent)?)",/g)]
    .map(match => match[1]);
  assert.deepEqual([...new Set(outputKeys)].sort(), ['customer_score', 'customer_score_precent']);
  return {
    idea: { dto: ideaDTO.name, declaredFields: declared(ideaDTO),
      commonGroupFields: group.getPSDEFGroupDetails ?? null },
    setting: { dto: dynamicDTO.name, declaredFields: declared(dynamicDTO),
      sourceSystemDTO: shared.name, sourceSystemFields: sourceFields,
      dynamicModelName: dynamicModel.name,
      dynamicModelAttributes: dynamicModel.getPSDynaModelAttrs ?? null },
    nested: { code: nested.name, wrapper: nested.type, targetDTO: nested.getRefPSDEMethodDTO.id },
    scoreLogic: { outputKeys: [...new Set(outputKeys)], fieldsAreDTODeclarations: false,
      rawScriptSha256: hash(raw.code), returnParam: end.getReturnParam.id },
    fieldDeclarationsClosed: declared(ideaDTO) !== null && declared(dynamicDTO) !== null && sourceFields !== null,
  };
}

const probeSource = String.raw`
import groovy.json.JsonOutput
import groovy.json.JsonSlurper
import net.ibizsys.central.ISystemRuntime
import net.ibizsys.central.SystemRuntime
import net.ibizsys.central.dataentity.logic.DELogicEndNodeRuntime
import net.ibizsys.central.dataentity.logic.IDELogicNodeRuntime
import net.ibizsys.central.dataentity.logic.IDELogicParamRuntime
import net.ibizsys.central.dataentity.logic.IDELogicSession
import net.ibizsys.model.PSModelServiceImpl
import net.ibizsys.model.dataentity.logic.IPSDELogic
import net.ibizsys.model.dataentity.logic.IPSDELogicNode
import net.ibizsys.central.cloud.core.service.util.MethodHandlerBase
import cn.ibizlab.plm.prodmgmt.idea.dto.IdeaDefGroupCommonDTO
import cn.ibizlab.plm.base.viewthemesetting.dto.ViewThemeSettingDTO
import cn.ibizlab.plm.base.viewthemesetting.dto.ViewThemeSettingUsr1014979662DTO
import cn.ibizlab.plm.prodmgmt.idea.logic.GetCustomerScore

class DtoScoreSystem extends SystemRuntime {
    List infoCalls = []
    void info(Object value, String name) { infoCalls.add([value, name]) }
}
class DtoScoreProbe extends GetCustomerScore {
    DtoScoreSystem system
    IdeaDefGroupCommonDTO resultDTO
    List customers
    List trace = []
    boolean followFramework
    ISystemRuntime getSystemRuntime() { system }
    Object param(String name) {
        assert name in ['result', 'relation_page']
        [getReal: { -> name == 'result' ? resultDTO : [content: customers] }]
    }
    IDELogicParamRuntime getDELogicParamRuntime(String name, boolean optional) {
        assert name == 'result'
        [getParamObject: { session -> resultDTO }] as IDELogicParamRuntime
    }
    protected IDELogicNodeRuntime getDELogicNodeRuntime(IPSDELogicNode node) {
        [execute: { context, session, actual ->
            trace.add(actual.codeName)
            if (actual.codeName == 'END1') new DELogicEndNodeRuntime().execute(context, session, actual)
            else new GroovyShell(new Binding([sys: system, logic: this])).evaluate(actual.code)
        }] as IDELogicNodeRuntime
    }
    protected void onExecutePSDELogicNode(IDELogicSession session, IPSDELogicNode node) {
        if (followFramework && node.codeName == 'RAWSFCODE1') super.onExecutePSDELogicNode(session, node, true)
        else super.onExecutePSDELogicNode(session, node)
    }
    void dispatch(IDELogicSession session, IPSDELogicNode node) { onExecutePSDELogicNode(session, node) }
}

def payload = new JsonSlurper().parse(new File(args[0]))
def mapper = MethodHandlerBase.MAPPER
def unicode = payload.unicode
def idea = mapper.readValue(JsonOutput.toJson([
    customer_score: unicode, customer_score_precent: new BigDecimal('0.5')
]), IdeaDefGroupCommonDTO)
assert idea.get('customer_score') == unicode
def ideaJSON = mapper.writeValueAsString(idea)
def ideaReadback = new JsonSlurper().parseText(ideaJSON)
assert ideaReadback.customer_score == unicode
assert ideaReadback.customer_score_precent == 0.5
idea.set('customer_score_precent', null)
def nullJSON = mapper.writeValueAsString(idea)
def nullTree = new JsonSlurper().parseText(nullJSON)
assert nullTree.containsKey('customer_score_precent')
assert nullTree.customer_score_precent == null

// diagnostic_payload tests an open container, not an asserted domain field.
def nestedJSON = JsonOutput.toJson([
    id: 'owned-dto-contract', caption: unicode,
    search_conds: [[diagnostic_payload: unicode]]
])
def setting = mapper.readValue(nestedJSON, ViewThemeSettingDTO)
assert setting.searchConds.size() == 1
assert setting.searchConds[0] instanceof ViewThemeSettingUsr1014979662DTO
assert setting.searchConds[0].get('diagnostic_payload') == unicode
def serializedSetting = mapper.writeValueAsString(setting)
def settingsTree = new JsonSlurper().parseText(serializedSetting)
assert settingsTree.caption == unicode
assert settingsTree.search_conds[0].diagnostic_payload == unicode
def secondRead = mapper.readValue(serializedSetting, ViewThemeSettingDTO)
assert secondRead.searchConds[0] instanceof ViewThemeSettingUsr1014979662DTO
assert secondRead.searchConds[0].get('diagnostic_payload') == unicode

def models = new PSModelServiceImpl()
models.setPSModelFolderPath(args[1])
def flow = models.getPSModelObject(null, IPSDELogic.class,
    'PSMODULES/ProdMgmt/PSDATAENTITIES/idea/PSDELOGICS/get_customer_score.json')
def raw = flow.getPSDELogicNodes().find { it.codeName == 'RAWSFCODE1' }
def rows = []
[[], ['10', '20', '30', '40', '50']].each { levels ->
    [false, true].each { framework ->
        def probe = new DtoScoreProbe(system: new DtoScoreSystem(),
            resultDTO: new IdeaDefGroupCommonDTO(),
            customers: levels.collect { [level: it] }, followFramework: framework)
        def state = [next: null, lastReturn: null, result: null]
        def session = [
            getDELogicRuntime: { -> probe },
            getNext: { -> state.next }, setNext: { value -> state.next = value },
            getLastReturn: { -> state.lastReturn }, setLastReturn: { value -> state.lastReturn = value },
            getResult: { -> state.result }, setResult: { value -> state.result = value },
            debugEnterNode: { runtime, node -> }, debugExitNode: { runtime, node -> },
            debugEnterLink: { runtime, node, link -> }
        ] as IDELogicSession
        probe.dispatch(session, raw)
        def serialized = mapper.writeValueAsString(probe.resultDTO)
        def fields = new JsonSlurper().parseText(serialized)
        assert fields.customer_score == (levels.isEmpty() ? '0分' : '7分')
        assert fields.customer_score_precent == (levels.isEmpty() ? 0 : 7 / 15)
        rows.add([levels: levels, followFramework: framework, trace: probe.trace,
            resultIsOriginalDTO: state.result?.is(probe.resultDTO) ?: false,
            resultNull: state.result == null, serializedFields: fields,
            observedTypes: [score: probe.resultDTO.get('customer_score').class.name,
                percentage: probe.resultDTO.get('customer_score_precent').class.name]])
    }
}
println JsonOutput.toJson([
    mode: args[2], mapper: [ideaUnicodeRoundtrip: true, nestedTypedListRoundtrip: true,
        explicitNullPreserved: true, diagnosticDynamicKeyIsDomainDeclaration: false,
        unicode: unicode, serializedIdea: ideaJSON, serializedSettings: serializedSetting],
    calculation: [rows: rows, databaseExecuted: false, HTTPExecuted: false, calculationNodeOnly: true],
    classes: [
        ideaDTO: IdeaDefGroupCommonDTO.protectionDomain.codeSource.location.toString(),
        settingsDTO: ViewThemeSettingDTO.protectionDomain.codeSource.location.toString(),
        childDTO: ViewThemeSettingUsr1014979662DTO.protectionDomain.codeSource.location.toString(),
        mapperOwner: MethodHandlerBase.protectionDomain.codeSource.location.toString(),
        scoreLogic: GetCustomerScore.protectionDomain.codeSource.location.toString(),
        centralDispatcher: net.ibizsys.central.dataentity.logic.DELogicRuntime.protectionDomain.codeSource.location.toString(),
        endNode: DELogicEndNodeRuntime.protectionDomain.codeSource.location.toString()
    ],
    javaVersion: System.getProperty('java.version'), businessAcceptance: false
])
`;

export function inspectOwnedDtoRuntimeContract({ output }) {
  const directory = path.resolve(output);
  assert.equal(fs.realpathSync(path.dirname(directory)), fs.realpathSync(artifacts));
  assert.match(path.basename(directory), /^owned-dto-runtime-[A-Za-z0-9-]+$/);
  assert.equal(fs.existsSync(directory), false);
  fs.mkdirSync(directory, { mode: 0o700 });
  const report = { contract: 'owned-dto-native-runtime-contract-v1', status: 'FAILED',
    startedAt: new Date().toISOString(), sourceBindings: [], executions: [], HTTPExecuted: false,
    databaseExecuted: false, sharedRuntimeModified: false, businessAcceptance: false,
    declarationGapsClosed: false };
  let failure;
  try {
    for (const relative of sources) {
      const bytes = regularRead(path.join(workspace, relative));
      const snapshot = write(directory, `source/${relative}`, bytes);
      report.sourceBindings.push({ path: relative, sha256: snapshot.sha256, snapshot: snapshot.path });
    }
    const sourceRead = relative => regularRead(path.join(directory, 'source', relative));
    report.authority = inspectDtoAuthorities({
      idea: JSON.parse(sourceRead(`plm/model/${ideaPath}`)),
      setting: JSON.parse(sourceRead(`plm/model/${settingPath}`)),
      system: JSON.parse(sourceRead('plm/model/PSSYSTEM.json')),
      dynamicModel: JSON.parse(sourceRead('plm/model/PSSYSDYNAMODELS/Usr1014979662.json')),
      logic: JSON.parse(sourceRead(`plm/model/${logicPath}`)),
      action: JSON.parse(sourceRead('plm/model/PSMODULES/ProdMgmt/PSDATAENTITIES/idea/PSDEACTIONS/get_customer_score.json')),
    });
    const receiptBytes = regularRead(path.join(workspace, receiptPath));
    assert.equal(hash(receiptBytes), receiptHash);
    const receipt = JSON.parse(receiptBytes);
    assert.equal(receipt.contract, 'plm-publication-provider-candidate-v1');
    const dependencies = receipt.dependencies;
    assert.equal(dependencies.length, 488);
    const java = receipt.compilation.command.executable;
    assert.equal(hash(regularRead(java)), javaHash);
    const verify = () => {
      assert.equal(hash(regularRead(path.join(workspace, receiptPath))), receiptHash);
      assert.equal(hash(regularRead(java)), javaHash);
      for (const item of dependencies) assert.equal(hash(regularRead(item.file)), item.sha256);
      for (const item of report.sourceBindings) {
        assert.equal(hash(regularRead(path.join(workspace, item.path))), item.sha256);
        assert.equal(hash(regularRead(path.join(directory, item.snapshot))), item.sha256);
      }
    };
    verify();
    report.dependencies = dependencies.map(item => ({ file: item.file, sha256: item.sha256 }));
    report.receipt = { path: receiptPath, sha256: receiptHash };
    report.java = { path: java, sha256: javaHash };
    write(directory, 'native-probe.private.groovy', probeSource);
    const payload = { unicode: '中文🙂 e\u0301 \' " \\\nSecond line' };
    write(directory, 'probe-input.private.json', json(payload));
    const classes = path.join(directory, 'classes');
    fs.mkdirSync(classes, { mode: 0o700 });
    const classpath = dependencies.map(item => item.file).join(path.delimiter);
    const run = (name, args) => {
      const command = { executable: java, args: ['-Xmx768m', '-XX:ActiveProcessorCount=2',
        '-Dgroovy.grape.enable=false', ...args], cwd: directory };
      const result = spawnSync(command.executable, command.args, {
        cwd: directory, encoding: 'utf8', timeout: 60000, maxBuffer: 4 * 1024 * 1024,
      });
      const stdout = write(directory, `${name}.stdout.private.log`, result.stdout ?? '');
      const stderr = write(directory, `${name}.stderr.private.log`, result.stderr ?? '');
      report.executions.push({ name, command, status: result.status, signal: result.signal, stdout, stderr });
      assert.equal(result.error, undefined, result.error?.message);
      assert.equal(result.signal, null);
      assert.equal(result.status, 0, `${name} failed; inspect its private stderr`);
      verify();
      return result.stdout;
    };
    const argumentsFor = mode => [
      'groovy.ui.GroovyMain', path.join(directory, 'native-probe.private.groovy'),
      path.join(directory, 'probe-input.private.json'), path.join(directory, 'source/plm/model'), mode,
    ];
    const legacy = JSON.parse(run('sealed-native', ['-cp', classpath, ...argumentsFor('sealed-native')])
      .trim().split('\n').at(-1));
    run('compile-current-source', ['-Dgroovy.target.bytecode=11', '-cp', classpath,
      'org.codehaus.groovy.tools.FileSystemCompiler', '--classpath', classpath,
      '-d', classes, path.join(directory, 'source', scoreSource)]);
    const source = JSON.parse(run('current-source', ['-cp', `${classes}${path.delimiter}${classpath}`,
      ...argumentsFor('current-source')]).trim().split('\n').at(-1));
    const sealed = new Map(dependencies.map(item => [path.resolve(item.file), item]));
    for (const [mode, observed] of [['sealed', legacy], ['source', source]]) {
      for (const [role, location] of Object.entries(observed.classes)) {
        const file = path.resolve(fileURLToPath(location));
        if (mode === 'source' && role === 'scoreLogic') assert.equal(file, classes);
        else assert.ok(sealed.has(file), `${role} was loaded outside the sealed native dependencies`);
      }
    }
    const outputs = [];
    const visit = folder => {
      for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
        const file = path.join(folder, entry.name);
        if (entry.isDirectory()) visit(file);
        else {
          fs.chmodSync(file, 0o600);
          outputs.push({ path: path.relative(directory, file), sha256: hash(regularRead(file)) });
        }
      }
    };
    visit(classes);
    report.compiledClasses = outputs;
    report.observed = { sealedNative: legacy, currentSource: source };
    report.sourceInputsStable = true;
    report.mapperSerializationVerified = source.mapper.ideaUnicodeRoundtrip &&
      source.mapper.nestedTypedListRoundtrip && source.mapper.explicitNullPreserved;
    report.currentSourceReturnsDTO = source.calculation.rows.filter(row => !row.followFramework)
      .every(row => row.resultIsOriginalDTO);
    report.status = report.mapperSerializationVerified && report.currentSourceReturnsDTO
      ? 'PASS_NATIVE_MAPPER_AND_CURRENT_SOURCE_RETURN_CONTRACT'
      : 'FAILED_CURRENT_SOURCE_RETURN_NOT_REACHED';
    verify();
  } catch (error) {
    failure = error;
    report.failure = { name: error.name, message: error.message };
  } finally {
    report.finishedAt = new Date().toISOString();
    write(directory, 'report.private.json', json(report));
  }
  if (failure) throw failure;
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { output: { type: 'string' } }, strict: true });
  try {
    const report = inspectOwnedDtoRuntimeContract({ output: values.output });
    console.log(json({ status: report.status, mapperSerializationVerified: report.mapperSerializationVerified,
      currentSourceReturnsDTO: report.currentSourceReturnsDTO, declarationGapsClosed: false }));
    if (!report.status.startsWith('PASS_')) process.exitCode = 1;
  } catch (error) {
    console.error(json({ status: 'FAILED_NATIVE_DTO_CONTRACT', message: error.message }));
    process.exitCode = 1;
  }
}
