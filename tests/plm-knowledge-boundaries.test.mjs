import assert from 'node:assert/strict';
import fs from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const entityPath = 'plm/model/PSMODULES/Wiki/PSDATAENTITIES/article_page.json';
const pageBase = 'plm/model/PSMODULES/Wiki/PSDATAENTITIES/article_page';
const model = path => JSON.parse(fs.readFileSync(join(workspace, path), 'utf8'));
const action = name => model(`${pageBase}/PSDEACTIONS/${name}.json`);
const logic = name => model(`${pageBase}/PSDELOGICS/${name}.json`);
const entity = model(entityPath);
const guard = logic('guard_locked_page');
const guardPath = 'PSMODULES/Wiki/PSDATAENTITIES/article_page/PSDELOGICS/guard_locked_page.json';

function runGuardCases(cases) {
  const repository = join(homedir(), '.m2/repository');
  const jars = [
    'org/codehaus/groovy/groovy/3.0.20/groovy-3.0.20.jar',
    'org/codehaus/groovy/groovy-json/3.0.20/groovy-json-3.0.20.jar',
    'cn/ibizlab/plugin/ibiz-runtime/8.1.0.584.1/ibiz-runtime-8.1.0.584.1.jar',
  ].map(path => join(repository, path));
  for (const jar of jars) assert.ok(fs.statSync(jar).isFile(), `Local compiler input missing: ${jar}`);
  const script = `
import groovy.json.JsonSlurper
import groovy.json.JsonOutput
import net.ibizsys.runtime.util.ErrorException
class PageFields {
    Map values
    Object get(String key) { values[key.toLowerCase()] }
    boolean contains(String key) { values.containsKey(key.toLowerCase()) }
    void set(String key, Object value) { values[key.toLowerCase()] = value }
}
def input = new JsonSlurper().parse(System.in)
def results = input.cases.collect { item ->
    def parameters = [
        Default: new PageFields(values: item.incoming),
        stored: new PageFields(values: item.stored),
        patch: new PageFields(values: [:])
    ]
    def bridge = [param: { String name -> [getReal: { -> parameters[name] }] }]
    def original = parameters.Default
    def before = JsonOutput.toJson([original.values, parameters.stored.values])
    if (item.project) {
        new GroovyShell(new Binding([logic: bridge])).evaluate(input.projector)
        parameters.Default = parameters.patch
    }
    def result = [id: item.id, allowed: true]
    try {
        new GroovyShell(new Binding([logic: bridge])).evaluate(input.code)
    } catch (ErrorException error) {
        result.allowed = false
        result.code = error.errorCode
    }
    result.unchanged = before == JsonOutput.toJson([original.values, parameters.stored.values])
    if (item.project) result.projected = parameters.patch.values
    result
}
println JsonOutput.toJson(results)
`;
  const result = spawnSync('java', ['-cp', jars.join(':'), 'groovy.ui.GroovyMain', '-e', script], {
    input: JSON.stringify({
      code: guard.getPSDELogicNodes.find(node => node.codeName === 'CheckStoredLock').code,
      projector: logic('share_metadata_patch').getPSDELogicNodes
        .find(node => node.codeName === 'ProjectMetadata').code,
      cases,
    }),
    encoding: 'utf8',
    timeout: 30_000,
    maxBuffer: 1024 * 1024,
  });
  assert.equal(result.status, 0, result.stderr || String(result.error));
  return JSON.parse(result.stdout.trim());
}

test('the real Update action checks persisted lock state before name sync and version writes', () => {
  const update = action('Update');
  const embedded = entity.getAllPSDEActions.find(item => item.name === 'Update');
  assert.deepEqual(embedded, update);
  assert.equal(update.getBeforePSDEActionLogics[0].getPSDELogic.path, guardPath);
  assert.equal(update.getBeforePSDEActionLogics[0].attachMode, 'BEFORE');
  assert.equal(update.getBeforePSDEActionLogics[1].getPSDELogic.path.endsWith('/sync_name.json'), true);
  assert.equal(update.getBeforePSDEActionLogics[2].getPSDELogic.path.endsWith('/commit_version.json'), true);
  assert.ok(entity.getAllPSDELogics.some(item => item.modelref && item.path === guardPath));
  assert.equal(guard.enableBackend, true);
  assert.equal(guard.enableFront, false);
});

test('the guard locks the PAGE row by a bound key and never reads lock state from the request', () => {
  const read = guard.getPSDELogicNodes.find(node => node.codeName === 'ReadStoredPage');
  assert.equal(read.logicNodeType, 'RAWSQLCALL');
  assert.equal(read.sql, 'select ID,IS_LOCK from PAGE where ID = ? for update');
  assert.doesNotMatch(read.sql, /\*|ACCESS_PASSWORD/i);
  assert.equal(read.fillDstLogicParam, true);
  assert.equal(read.getDstPSDELogicParam.id, 'stored');
  assert.deepEqual(read.getPSDELogicNodeParams.map(item =>
    [item.paramAction, item.srcFieldName, item.getSrcPSDELogicParam.id]), [['SQLPARAM', 'ID', 'Default']]);
  assert.doesNotMatch(read.sql, /\$\{|#\{/);
  const code = guard.getPSDELogicNodes.find(node => node.codeName === 'CheckStoredLock').code;
  assert.match(code, /stored\.get\('is_lock'\)/);
  assert.doesNotMatch(code, /incoming\.get\('is_lock'\).*==/);
  assert.equal(entity.name, 'PAGE');
  assert.equal(entity.tableName, 'PAGE');
});

test('actual Groovy guard rejects locked content, publication, version and inline unlock changes', () => {
  const fields = ['name', 'content', 'format_type', 'publish_content', 'publish_name', 'publish_time',
    'is_published', 'published', 'cur_version_id', 'parent_id', 'space_id', 'attachments', 'is_lock'];
  const cases = fields.map(field => ({
    id: field,
    stored: { id: 'owned-page', is_lock: 1, [field]: field === 'is_lock' ? 1 : 'before' },
    incoming: { id: 'owned-page', [field]: field === 'is_lock' ? 0 : 'after' },
  }));
  cases.push({
    id: 'forged-unlocked-with-body',
    stored: { id: 'owned-page', is_lock: '1', content: 'published' },
    incoming: { id: 'owned-page', is_lock: 0, content: 'draft overwrite' },
  }, {
    id: 'missing-persisted-page',
    stored: {},
    incoming: { id: 'missing-page', is_lock: 0, content: 'untrusted' },
  });
  for (const result of runGuardCases(cases)) {
    assert.equal(result.allowed, false, result.id);
    assert.equal(result.code, 2, result.id);
    assert.equal(result.unchanged, true, result.id);
  }
});

test('actual Groovy guard preserves unlocked Unicode writes and metadata-only locked share revocation', () => {
  const results = runGuardCases([{
    id: 'unlocked-unicode',
    stored: { id: 'owned-page', is_lock: 0, content: 'before' },
    incoming: { id: 'owned-page', content: '\u4e2d\u6587 \ud83d\ude00 e\u0301 \"quoted\" \\\\ \nnext' },
  }, {
    id: 'revoke-share-while-locked',
    stored: { id: 'owned-page', is_lock: 1, content: 'same', is_shared: '1' },
    incoming: { id: 'owned-page', is_shared: '0', expiration_date: null },
  }]);
  for (const result of results) {
    assert.equal(result.allowed, true, result.id);
    assert.equal(result.unchanged, true, result.id);
  }
});

test('locked no-op fields cannot trigger downstream name-sync or version hooks', () => {
  const results = runGuardCases(['content', 'name', 'type', 'is_published'].map(field => ({
    id: `same-${field}`,
    stored: { id: 'owned-page', is_lock: 1, [field]: 'same' },
    incoming: { id: 'owned-page', is_shared: '0', [field]: 'same' },
  })));
  for (const result of results) {
    assert.equal(result.allowed, false, result.id);
    assert.equal(result.code, 2, result.id);
  }
});

test('native sharing flows project a new DTO before Update and keep outer write authorization', () => {
  for (const name of ['closed_shared', 'shared_setting']) {
    const sharing = logic(name);
    assert.deepEqual(entity.getAllPSDELogics.find(item => item.codeName === name), sharing);
    assert.equal(action(name).dataAccessAction, 'UPDATE');
    const project = sharing.getPSDELogicNodes.find(node => node.codeName === 'PrepareSharePatch');
    assert.equal(project.logicNodeType, 'DELOGIC');
    assert.equal(project.getDstPSDELogic.path.endsWith('/share_metadata_patch.json'), true);
    assert.equal(project.getDstPSDELogicParam.id, 'Default');
    assert.equal(project.getRetPSDELogicParam.id, 'share_patch');
    assert.equal(project.getPSDELogicLinks[0].getDstPSDELogicNode.id, 'DEACTION1');
    const update = sharing.getPSDELogicNodes.find(node => node.codeName === 'DEACTION1');
    assert.equal(update.getDstPSDELogicParam.id, 'share_patch');
    assert.equal(update.getDstPSDEAction.path.endsWith('/Update.json'), true);
    assert.ok(sharing.getPSDELogicParams.some(param => param.codeName === 'share_patch'
      && param.entityParam && !param.default));
    const predecessor = name === 'closed_shared' ? 'PREPAREPARAM1' : 'RAWSFCODE1';
    assert.equal(sharing.getPSDELogicNodes.find(node => node.codeName === predecessor)
      .getPSDELogicLinks[0].getDstPSDELogicNode.id, 'PrepareSharePatch');
    const prepare = sharing.getPSDELogicNodes.find(node =>
      node.codeName === (name === 'closed_shared' ? 'PREPAREPARAM1' : 'PREPAREPARAM2'));
    assert.equal(prepare.getPSDELogicNodeParams.find(param =>
      param.dstFieldName === 'IS_SHARED').srcValue, name === 'closed_shared' ? '0' : '1');
  }
  assert.equal(action('shared_setting').getBeforePSDEActionLogics[0].getPSDELogic.path
    .endsWith('/encrypt_access_key.json'), true);
  const apiRuntime = fs.readFileSync(join(workspace,
    'ibiz-service-hub/libs/ibiz-runtime/src/main/java/net/ibizsys/central/dataentity/service/DEServiceAPIRuntime.java'), 'utf8');
  assert.match(apiRuntime, /iEntityDTO\.set\(parentIdPSDEField\.getLowerCaseName\(\), objValue\)/);
});

test('actual Groovy projection strips full DTO content and native SPACE_ID before locked share writes', () => {
  const injected = {
    id: 'owned-page', space_id: 'native-parent', name: 'do not rename', content: 'do not publish',
    type: '2', is_published: 1, is_lock: 0, publish_content: 'do not replace',
    attachments: [{ id: 'untrusted-attachment' }], custom_property: 'not a share field',
  };
  const cases = [{
    id: 'full-dto-revoke',
    stored: { id: 'owned-page', is_lock: 1 },
    incoming: {
      ...injected, is_shared: '0', is_shared_subset: 0, expiration_date: null,
      shared_by: null, shared_time: null, access_password: 'must-not-write-on-revoke',
    },
    project: true,
  }, {
    id: 'full-dto-password-update',
    stored: { id: 'owned-page', is_lock: 1 },
    incoming: {
      ...injected, is_shared: '1', is_shared_subset: 1, expiration_date: '2030-01-01',
      shared_by: 'owned-editor', shared_time: '2030-01-01', access_password: 'encrypted-fixture',
    },
    project: true,
  }];
  const results = runGuardCases(cases);
  for (const [index, result] of results.entries()) {
    assert.equal(result.allowed, true, result.id);
    assert.equal(result.unchanged, true, result.id);
    const expectedKeys = ['id', 'is_shared', 'is_shared_subset', 'expiration_date', 'shared_by', 'shared_time'];
    if (index === 1) expectedKeys.push('access_password');
    assert.deepEqual(Object.keys(result.projected).sort(), expectedKeys.sort());
    assert.equal(result.projected.space_id, undefined);
    assert.equal(result.projected.content, undefined);
    assert.equal(result.projected.is_published, undefined);
    assert.equal(result.projected.type, undefined);
    assert.equal(result.projected.is_lock, undefined);
    if (index === 0) assert.equal(result.projected.access_password, undefined);
    else assert.equal(result.projected.access_password, 'encrypted-fixture');
  }
});

test('the authorized unlock action ignores supplied body and updates only the persisted lock flag', () => {
  const unlock = logic('unlock_page');
  const embedded = entity.getAllPSDELogics.find(item => item.codeName === 'unlock_page');
  assert.deepEqual(embedded, unlock);
  assert.equal(action('unlock_page').dataAccessAction, 'UPDATE');
  const node = unlock.getPSDELogicNodes.find(item => item.codeName === 'DEACTION2');
  assert.equal(node.logicNodeType, 'RAWSQLCALL');
  assert.equal(node.sql, 'update PAGE set IS_LOCK = 0 where ID = ? and IS_DELETED = 0');
  assert.equal(node.getPSDELogicNodeParams[0].getSrcPSDELogicParam.id, 'page_obj');
  assert.equal(node.getPSDELogicNodeParams[0].srcFieldName, 'ID');
  assert.equal(node.getDstPSDEAction, undefined);
  assert.doesNotMatch(node.sql, /\b(?:CONTENT|PUBLISH_CONTENT|NAME)\s*=/i);
});

test('locking does not write the stale body returned by the preceding Get', () => {
  const lock = logic('lock_page');
  assert.deepEqual(entity.getAllPSDELogics.find(item => item.codeName === 'lock_page'), lock);
  assert.equal(action('lock_page').dataAccessAction, 'UPDATE');
  const node = lock.getPSDELogicNodes.find(item => item.codeName === 'DEACTION2');
  assert.equal(node.logicNodeType, 'RAWSQLCALL');
  assert.equal(node.sql, 'update PAGE set IS_LOCK = 1 where ID = ? and IS_DELETED = 0');
  assert.equal(node.getPSDELogicNodeParams[0].getSrcPSDELogicParam.id, 'page_obj');
  assert.equal(node.getDstPSDEAction, undefined);
});

test('the standard publication Save path routes existing pages to the guarded Update action', () => {
  const publish = logic('publish_page');
  const destinations = publish.getPSDELogicNodes
    .map(node => node.getDstPSDEAction?.path).filter(Boolean);
  assert.ok(destinations.some(path => path.endsWith('/Save.json')));
  const runtime = fs.readFileSync(join(workspace,
    'ibiz-service-hub/libs/ibiz-runtime/src/main/java/net/ibizsys/central/dataentity/DataEntityRuntime.java'), 'utf8');
  const saveBranch = runtime.slice(runtime.indexOf('if (this.getSystemPersistentAdapter() != null && ((DEActions.SAVE'));
  assert.match(saveBranch.slice(0, 6000), /return executeAction\(DEActions\.UPDATE, null, new Object\[\] \{ iEntityDTO, bGet \}\)/);
});

test('the password-bearing settings endpoint requires write access in every native API definition', () => {
  assert.equal(action('shared').dataAccessAction, 'UPDATE');
  assert.equal(action('shared').dataAccessAction, action('shared_setting').dataAccessAction);
  assert.equal(entity.getAllPSDEActions.find(item => item.name === 'shared').dataAccessAction, 'UPDATE');
  const settings = logic('get_shared_info');
  assert.ok(settings.getPSDELogicNodes.some(node =>
    node.sql?.includes('access_password')));
  const methods = [];
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    if (value.getPSDEAction?.path === `${pageBase.replace('plm/model/', '')}/PSDEACTIONS/shared.json`) {
      methods.push(value);
    }
    for (const child of Object.values(value)) visit(child);
  }
  visit(model('plm/model/PSSYSSERVICEAPIS/ServiceAPI.json'));
  assert.equal(methods.length, 3);
  for (const method of methods) {
    assert.equal(method.dataAccessAction, 'UPDATE');
    assert.equal(method.requestPath, '/shared');
    assert.equal(method.needResourceKey, true);
  }
  assert.equal(action('check_shared').dataAccessAction, 'READ');
  assert.equal(action('check_access_password').dataAccessAction, 'READ');
});

test('desktop app and generated sharing entries use the existing privilege bindings consistently', async () => {
  const app = model('plm/model/PSSYSAPPS/plmweb/PSAPPDATAENTITIES/article_page.json');
  const shared = app.getAllPSAppDEMethods.find(method => method.codeName === 'shared');
  const settings = app.getAllPSAppDEMethods.find(method => method.codeName === 'shared_setting');
  assert.deepEqual(shared.getPSDEOPPriv, settings.getPSDEOPPriv);
  assert.deepEqual(app.getAllPSAppDEActions.find(method => method.codeName === 'shared').getPSDEOPPriv,
    settings.getPSDEOPPriv);
  assert.equal(shared.getPSDEOPPriv.id, 'UPDATE');
  const source = fs.readFileSync(join(workspace,
    'plm-web/src/publish/model/entities/article-page.ts'), 'utf8');
  const generated = (await import(`data:text/javascript,${encodeURIComponent(source)}`)).default;
  for (const name of ['open_shared', 'open_shared_setting', 'open_shared_setting_management']) {
    const authoritative = app.getAllPSAppDEUIActions.find(item => item.codeName === name);
    const compiled = generated.appDEUIActions.find(item => item.codeName === name);
    assert.equal(authoritative.dataAccessAction, 'SHARED', name);
    assert.equal(authoritative.getPSDEOPPriv.id, 'space__SHARED', name);
    assert.equal(compiled.dataAccessAction, authoritative.dataAccessAction, name);
    assert.equal(compiled.deopprivId, authoritative.getPSDEOPPriv.id.toLowerCase(), name);
    assert.equal(compiled.caption, authoritative.caption, name);
  }
});

test('official model loader resolves the new server guard and the narrow unlock without generated-code injection', () => {
  const repository = join(homedir(), '.m2/repository');
  const jars = [
    'org/codehaus/groovy/groovy/3.0.20/groovy-3.0.20.jar',
    'cn/ibizlab/plugin/ibiz-model/8.1.0.584.1/ibiz-model-8.1.0.584.1.jar',
    'com/fasterxml/jackson/core/jackson-core/2.11.3/jackson-core-2.11.3.jar',
    'com/fasterxml/jackson/core/jackson-databind/2.11.3/jackson-databind-2.11.3.jar',
    'com/fasterxml/jackson/core/jackson-annotations/2.11.3/jackson-annotations-2.11.3.jar',
    'org/springframework/spring-core/5.3.1/spring-core-5.3.1.jar',
    'org/springframework/spring-jcl/5.3.1/spring-jcl-5.3.1.jar',
    'commons-io/commons-io/2.6/commons-io-2.6.jar',
  ].map(path => join(repository, path));
  for (const jar of jars) assert.ok(fs.statSync(jar).isFile(), `Local model input missing: ${jar}`);
  const script = `
import net.ibizsys.model.PSModelServiceImpl
import net.ibizsys.model.dataentity.IPSDataEntity
def service = new PSModelServiceImpl()
service.setPSModelFolderPath(args[0])
def page = service.getPSModelObject(null, IPSDataEntity.class, 'PSMODULES/Wiki/PSDATAENTITIES/article_page.json')
def base = 'PSMODULES/Wiki/PSDATAENTITIES/article_page'
def update = page.getPSDEAction(base + '/PSDEACTIONS/Update.json', false)
def guard = update.getBeforePSDEActionLogics()[0].getPSDELogic()
assert guard.codeName == 'guard_locked_page'
assert guard.getPSDELogicNodes().find { it.codeName == 'ReadStoredPage' }.sql.endsWith('where ID = ? for update')
assert page.getPSDELogic(base + '/PSDELOGICS/guard_locked_page.json', false).codeName == guard.codeName
def unlock = page.getPSDELogic(base + '/PSDELOGICS/unlock_page.json', false)
assert unlock.getPSDELogicNodes().find { it.codeName == 'DEACTION2' }.logicNodeType == 'RAWSQLCALL'
['closed_shared', 'shared_setting'].each { name ->
    def flow = page.getPSDELogic(base + '/PSDELOGICS/' + name + '.json', false)
    def project = flow.getPSDELogicNodes().find { it.codeName == 'PrepareSharePatch' }
    assert project.getDstPSDELogic().codeName == 'share_metadata_patch'
    assert project.getRetPSDELogicParam().codeName == 'share_patch'
    assert flow.getPSDELogicNodes().find { it.codeName == 'DEACTION1' }.getDstPSDELogicParam().codeName == 'share_patch'
}
assert page.getPSDEAction(base + '/PSDEACTIONS/shared.json', false).dataAccessAction == 'UPDATE'
println 'OFFICIAL-MODEL-PROBE-PASS'
`;
  const result = spawnSync('java', ['-cp', jars.join(':'), 'groovy.ui.GroovyMain', '-e', script,
    join(workspace, 'plm/model')], { encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024 });
  assert.equal(result.status, 0, result.stderr || String(result.error));
  assert.match(result.stdout, /OFFICIAL-MODEL-PROBE-PASS/);
});
