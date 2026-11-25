import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const base = 'plm/model/PSMODULES/ProdMgmt/PSDATAENTITIES/idea';
const readJson = relative => JSON.parse(fs.readFileSync(path.join(workspace, relative)));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

test('the authoritative create guard runs before sequence assignment and leaves existing role semantics intact', () => {
  const entity = readJson(`${base}.json`);
  const action = readJson(`${base}/PSDEACTIONS/Create.json`);
  const logic = readJson(`${base}/PSDELOGICS/guard_create_product_access.json`);
  assert.deepEqual(entity.getAllPSDEActions.find(item => item.codeName === 'Create'), action);
  assert.deepEqual(entity.getAllPSDELogics.find(item => item.codeName === logic.codeName), logic);
  assert.equal(action.getPreparePSDEActionLogics[0].getPSDELogic.path,
    `${base.replace('plm/model/', '')}/PSDELOGICS/guard_create_product_access.json`);
  assert.equal(action.getPreparePSDEActionLogics[0].attachMode, 'PREPARE');
  assert.equal(action.getBeforePSDEActionLogics[0].getPSDELogic.path,
    `${base.replace('plm/model/', '')}/PSDELOGICS/set_sequence.json`);
  assert.equal(action.getPreparePSDEActionLogics[0].internalLogic, true);
  assert.equal(entity.dataAccCtrlMode, 1);
  assert.equal(logic.enableBackend, true);
  assert.equal(logic.enableFront, false);
  const check = logic.getPSDELogicNodes.find(node => node.codeName === 'CheckProductAccess');
  assert.equal(check.getPSDELogicLinks[0].getDstPSDELogicNode.id, 'End');
  const save = readJson(`${base}/PSDEACTIONS/Save.json`);
  const update = readJson(`${base}/PSDEACTIONS/Update.json`);
  const saveLogic = readJson(`${base}/PSDELOGICS/guard_save_product_access.json`);
  assert.deepEqual(entity.getAllPSDEActions.find(item => item.codeName === 'Save'), save);
  assert.deepEqual(entity.getAllPSDELogics.find(item => item.codeName === saveLogic.codeName), saveLogic);
  assert.equal(save.getPreparePSDEActionLogics, undefined);
  assert.deepEqual(entity.getAllPSDEActions.find(item => item.codeName === 'Update'), update);
  assert.equal(update.getPreparePSDEActionLogics[0].getPSDELogic.path,
    `${base.replace('plm/model/', '')}/PSDELOGICS/guard_save_product_access.json`);
  assert.equal(update.getPreparePSDEActionLogics[0].attachMode, 'PREPARE');
});

test('the real Groovy guard uses native parent SUBDATA authorization and rejects before any mutation', () => {
  const receiptBytes = fs.readFileSync(path.join(workspace,
    '.artifacts/plm-publication-provider-candidate-20261123-r4/report.private.json'));
  assert.equal(hash(receiptBytes), '57b4be760a3f0ec4e90d14fa851bee318ad337206b65fe5df74fa2fbabe65b24');
  const receipt = JSON.parse(receiptBytes);
  for (const item of receipt.dependencies) assert.equal(hash(fs.readFileSync(item.file)), item.sha256);
  const logic = readJson(`${base}/PSDELOGICS/guard_create_product_access.json`);
  const code = logic.getPSDELogicNodes.find(node => node.codeName === 'CheckProductAccess').code;
  const script = String.raw`
import groovy.json.JsonOutput
import groovy.json.JsonSlurper
import java.lang.reflect.InvocationHandler
import java.lang.reflect.Proxy
import net.ibizsys.central.dataentity.IDataEntityRuntime
import net.ibizsys.central.dataentity.security.IDataEntityAccessManager
import net.ibizsys.runtime.security.IUserContext
import net.ibizsys.runtime.security.UserContext
import net.ibizsys.runtime.dataentity.action.CheckKeyStates
import org.springframework.context.i18n.LocaleContextHolder
import net.ibizsys.runtime.util.ErrorException
import net.ibizsys.runtime.util.Errors
import net.ibizsys.model.PSModelServiceImpl
import net.ibizsys.model.dataentity.action.IPSDEAction
import net.ibizsys.model.dataentity.IPSDataEntity

def body = new JsonSlurper().parse(System.in)
def models = new PSModelServiceImpl()
models.setPSModelFolderPath(body.modelRoot)
def entity = models.getPSModelObject(null, IPSDataEntity.class,
  'PSMODULES/ProdMgmt/PSDATAENTITIES/idea.json')
def create = entity.allPSDEActions.find { it.codeName == 'Create' }
assert create.preparePSDEActionLogics.size() == 1
assert create.preparePSDEActionLogics[0].attachMode == 'PREPARE'
assert create.preparePSDEActionLogics[0].internalLogic
assert create.preparePSDEActionLogics[0].PSDELogicMust.codeName == 'guard_create_product_access'
def rows = [
  [role:'ordinary', present:true, org:'owned-org', user:'owned-user', parent:'owned-product', allowed:true],
  [role:'objectadmin', present:true, org:'owned-org', user:'owned-admin', parent:'owned-product', allowed:true],
  [role:'readonly', present:true, org:'owned-org', user:'owned-reader', parent:'owned-product', allowed:false],
  [role:'nonmember', present:true, org:'owned-org', user:'owned-other', parent:'owned-product', allowed:false],
  [role:'crossorg', present:true, org:'other-org', user:'owned-cross', parent:'owned-product', allowed:false],
  [role:'missing-parent', present:true, org:'owned-org', user:'owned-user', parent:null, allowed:false],
  [role:'blank-parent', present:true, org:'owned-org', user:'owned-user', parent:' ', allowed:false],
  [role:'missing-org', present:true, org:null, user:'owned-user', parent:'owned-product', allowed:false],
  [role:'missing-user', present:true, org:'owned-org', user:null, parent:'owned-product', allowed:false],
  [role:'missing-context', present:false, org:null, user:null, parent:'owned-product', allowed:false],
  [role:'anonymous', present:true, org:'owned-org', user:'owned-anonymous', anonymous:true, parent:'owned-product', allowed:false],
  [role:'missing-product', present:true, org:'owned-org', user:'owned-user', parent:'missing-product', allowed:false],
  [role:'readonly-zh', present:true, org:'owned-org', user:'owned-reader', parent:'owned-product', allowed:false, language:'zh']
]
def results = rows.collect { row ->
    def calls = []
    IUserContext actor = row.present ? ([
        getUserid:{ -> row.user }, getOrgid:{ -> row.org }, isAnonymoususer:{ -> row.anonymous == true }
    ] as IUserContext) : null
    UserContext.setCurrent(actor)
    LocaleContextHolder.setLocale(new Locale(row.language ?: 'en'))
    def access = Proxy.newProxyInstance(this.class.classLoader,
      [IDataEntityAccessManager] as Class[], { proxy, method, arguments ->
        assert method.name == 'testDataAccessActionIf'
        assert arguments.length == 3
        assert arguments[0].is(actor)
        assert arguments[1] == 'owned-product'
        assert arguments[2] == 'SUBDATA'
        calls.add('native-parent-subdata')
        row.allowed
      } as InvocationHandler)
    def product = Proxy.newProxyInstance(this.class.classLoader,
      [IDataEntityRuntime] as Class[], { proxy, method, arguments ->
        if (method.name == 'checkKeyState') {
          return arguments[0] == 'owned-product' ? CheckKeyStates.EXIST : CheckKeyStates.NOTEXIST
        }
        assert method.name == 'getDataEntityAccessManager'
        access
      } as InvocationHandler)
    def sys = [getDataEntityRuntime:{ tag -> assert tag == 'product'; product }]
    def incoming = new net.ibizsys.central.util.EntityDTO()
    if (row.parent != null) incoming.set('product_id', row.parent)
    incoming.set('title', 'owned-title')
    def before = new LinkedHashMap(incoming.any())
    def logic = [param:{ name -> assert name == 'Default'; [getReal:{ -> incoming }] }]
    boolean accepted = false
    try {
      new GroovyShell(new Binding([sys:sys, logic:logic])).evaluate(body.code)
      accepted = true
    } catch (ErrorException error) {
      assert error.errorCode == Errors.ACCESSDENY
      assert error.message == (row.language == 'zh' ? '需要产品写入权限' : 'Product write permission is required')
    } finally { UserContext.setCurrent(null); LocaleContextHolder.resetLocaleContext() }
    assert accepted == row.allowed
    assert incoming.any() == before
    [role:row.role, accepted:accepted, parentChecks:calls.size(), unchanged:true]
}
println JsonOutput.toJson([rows:results, nativeInterfaces:true, httpExecuted:false,
    databaseExecuted:false, businessAcceptance:false])
`;
  const result = spawnSync(receipt.compilation.command.executable, [
    '-Xmx512m', '-XX:ActiveProcessorCount=2', '-Dgroovy.grape.enable=false',
    '-cp', receipt.dependencies.map(item => item.file).join(path.delimiter),
    'groovy.ui.GroovyMain', '-e', script,
  ], { cwd: workspace, input: JSON.stringify({ code, modelRoot: path.join(workspace, 'plm/model') }), encoding: 'utf8',
    timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr);
  const observed = JSON.parse(result.stdout.trim().split('\n').at(-1));
  assert.equal(observed.rows.length, 13);
  assert.equal(observed.rows.filter(row => row.accepted).length, 2);
  assert.ok(observed.rows.every(row => row.unchanged));
  assert.equal(observed.businessAcceptance, false);
});

test('Save authorizes the persisted parent and cannot retarget a foreign idea to an accessible product', () => {
  const receipt = readJson('.artifacts/plm-publication-provider-candidate-20261123-r4/report.private.json');
  for (const item of receipt.dependencies) assert.equal(hash(fs.readFileSync(item.file)), item.sha256);
  const logic = readJson(`${base}/PSDELOGICS/guard_save_product_access.json`);
  const code = logic.getPSDELogicNodes.find(node => node.codeName === 'CheckProductAccess').code;
  const script = String.raw`
import groovy.json.JsonSlurper
import groovy.json.JsonOutput
import net.ibizsys.central.util.EntityDTO
import net.ibizsys.runtime.security.IUserContext
import net.ibizsys.runtime.security.UserContext
import net.ibizsys.runtime.util.ErrorException
import net.ibizsys.runtime.util.Errors
import net.ibizsys.runtime.dataentity.action.CheckKeyStates
def body = new JsonSlurper().parse(System.in)
def cases = [
 [name:'ordinary-update',existing:true,incoming:'owned-product',stored:'owned-product',allowed:['owned-product'],pass:true],
 [name:'objectadmin-update-omitted-parent',existing:true,incoming:null,stored:'owned-product',allowed:['owned-product'],pass:true],
 [name:'readonly-update',existing:true,incoming:'owned-product',stored:'owned-product',allowed:[],pass:false],
 [name:'nonmember-update',existing:true,incoming:'owned-product',stored:'owned-product',allowed:[],pass:false],
 [name:'crossorg-update',existing:true,incoming:'owned-product',stored:'owned-product',allowed:[],pass:false],
 [name:'retarget-foreign',existing:true,incoming:'owned-product',stored:'foreign-product',allowed:['owned-product'],pass:false],
 [name:'retarget-even-both-writable',existing:true,incoming:'other-product',stored:'owned-product',allowed:['owned-product','other-product'],pass:false],
 [name:'ordinary-save-new',existing:false,incoming:'owned-product',stored:null,allowed:['owned-product'],pass:true],
 [name:'readonly-save-new',existing:false,incoming:'owned-product',stored:null,allowed:[],pass:false],
 [name:'save-new-no-parent',existing:false,incoming:null,stored:null,allowed:['owned-product'],pass:false],
 [name:'save-missing-parent',existing:false,incoming:'missing-product',stored:null,allowed:['owned-product'],pass:false]
]
def results = cases.collect { row ->
 def actor = [getUserid:{ -> 'owned-user' }, getOrgid:{ -> 'owned-org' }, isAnonymoususer:{ -> false }] as IUserContext
 UserContext.setCurrent(actor)
 def incoming = new EntityDTO()
 incoming.set('id','owned-idea')
 incoming.set('title','owned-title')
 if(row.incoming != null) incoming.set('product_id',row.incoming)
 def before = new LinkedHashMap(incoming.any())
 def checks=[]
 def product = [
  checkKeyState:{ id -> id=='missing-product' ? CheckKeyStates.NOTEXIST : CheckKeyStates.EXIST },
  getDataEntityAccessManager:{ -> [testDataAccessActionIf:{ actual, id, op ->
    assert actual.is(actor); assert op=='SUBDATA'; checks.add(id); row.allowed.contains(id)
  }] }
 ]
 def idea = [
  checkKeyState:{ id -> assert id=='owned-idea'; row.existing ? CheckKeyStates.EXIST : CheckKeyStates.NOTEXIST },
  getSimpleEntity:{ id -> assert id=='owned-idea'; def value=new EntityDTO();value.set('product_id',row.stored);value }
 ] as net.ibizsys.central.dataentity.IDataEntityRuntime
 def sys = [getDataEntityRuntime:{ tag -> assert tag in ['idea','product']; tag=='idea' ? idea : product }]
 def logic = [param:{ name -> assert name=='Default'; [getReal:{ -> incoming }] }]
 boolean accepted=false
 try { new GroovyShell(new Binding([sys:sys,logic:logic])).evaluate(body.code); accepted=true }
 catch(ErrorException error) { assert error.errorCode==Errors.ACCESSDENY }
 finally { UserContext.setCurrent(null) }
 assert accepted==row.pass: row.name
 assert incoming.any()==before
 [name:row.name,accepted:accepted,unchanged:true,checks:checks]
}
println JsonOutput.toJson(results)
`;
  const result = spawnSync(receipt.compilation.command.executable, [
    '-Xmx512m', '-XX:ActiveProcessorCount=2', '-Dgroovy.grape.enable=false',
    '-cp', receipt.dependencies.map(item => item.file).join(path.delimiter),
    'groovy.ui.GroovyMain', '-e', script,
  ], { cwd: workspace, input: JSON.stringify({ code }), encoding: 'utf8',
    timeout: 30000, maxBuffer: 2 * 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr);
  const observed = JSON.parse(result.stdout.trim().split('\n').at(-1));
  assert.equal(observed.length, 11);
  assert.equal(observed.filter(row => row.accepted).length, 3);
});
