import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  allowOwnedNativePortalRequest,
  assessOwnedNativePortalRequest,
  NATIVE_PORTAL_APPLICATION,
  NATIVE_PORTAL_CONTRACTS,
} from '../owned-native-portal-contract.mjs';
import { workspace } from '../localization-baseline.mjs';

const scope = {
  origin: 'http://127.0.0.1:32118',
  applicationId: NATIVE_PORTAL_APPLICATION,
  rootId: 'own-root',
  dashboardId: 'owned-dashboard-person-editor',
  openDataKey: 'pssystemindexview@own-root',
};
const prefix = `${scope.origin}/api/${scope.applicationId}`;
const rooted = `${prefix}/psdevslnsys/${scope.rootId}`;
const request = (method, path) => ({ method, url: path });
const mark = action => `${prefix}/portal/markopendata/pssystem/pssystemindexview%40own-root${action ? `/${action}` : ''}`;
const modelRoot = 'vendor-upstream/ibizmodeling-standard/modelapi-core/src/main/resources/model/net/ibizsys/modeling';
const hubRoot = 'ibiz-service-hub/libs';
const read = path => fs.readFileSync(join(workspace, path), 'utf8');
const model = path => JSON.parse(read(`${modelRoot}/${path}`));
const sources = [
  [`${hubRoot}/ibiz-cloud-portal-core/src/main/java/net/ibizsys/central/cloud/portal/core/spring/controller/PortalRestController.java`, '4115e61410c7258f6f3ab018df17d97786e3819df62d08c3a2d751e75a1e0183'],
  [`${hubRoot}/ibiz-cloud-portal-core/src/main/java/net/ibizsys/central/cloud/portal/core/cloudutil/CloudPortalUtilRuntimeBase.java`, 'ad7418cc4cbfe95a81bd3897f9d70dd1d7eea20cd426262952d4a689b61b6845'],
  [`${hubRoot}/ibiz-cloud-core/src/main/java/net/ibizsys/central/cloud/core/spring/util/GatewayUtils.java`, '339ed06f83d437db25e49731c9c6133a69fcec4cbdb97cf018c480c98f0f9f20'],
  [`${hubRoot}/ibiz-cloud-core/src/main/java/net/ibizsys/central/cloud/core/HubSystemRuntime.java`, 'c4c34177117715b9dd35e5254e3ce5227583dd500c802ceda9a7ac7909163e16'],
  [`${hubRoot}/ibiz-cloud-core/src/main/java/net/ibizsys/central/cloud/core/util/CloudCacheTagUtils.java`, '3cfe0ec5a5433d7d7ed5f69de8f9edce5620aa267055b60c6603125db14bf135'],
  [`${hubRoot}/ibiz-modeling-core/src/main/java/net/ibizsys/modeling/core/security/SystemAccessManagerBase.java`, '5298ac71c2fc6ebd7af75fa6035cb0fa7674846c5443501be427f7d1f4458712'],
  [`${hubRoot}/ibiz-modeling-core/src/main/java/net/ibizsys/modeling/core/util/PSModels.java`, '89b6920de43aa0a1fb76aa6a827a24de8f2b3bf44af321b29d0483576c711e85'],
  [`${hubRoot}/ibiz-cloud-core/src/main/java/net/ibizsys/central/cloud/core/dataentity/security/DataEntityAccessManager.java`, '110797ab610e3de7c2bedf43280444f78dd24fe16535f1b5add0a811511a3a4a'],
  [`${modelRoot}/PSSYSAPPS/ModelDesign/PSAPPDATAENTITIES/DynaDashboard.json`, 'cdc0826b86ad56d8101aa962e99e65b9f5b4b7991932b0ce4944113c89dd2f37'],
  [`${modelRoot}/PSSYSAPPS/ModelDesign/PSAPPDATAENTITIES/ModelObservation.json`, 'b73fe05b07dd3a27f6f236b0c862e697b850ddc1fcc7ab14448d628839520eaf'],
  [`${modelRoot}/PSMODULES/AppStudio/PSDATAENTITIES/DynaDashboard.json`, '3ce3f0cef100d3ad6b4ddeecb3d989289cf3cbca2829ead8d7d4fa15d9ebb29d'],
  [`${modelRoot}/PSMODULES/AppStudio/PSDATAENTITIES/ModelObservation/PSDEACTIONS/SysOverviewCnt.json`, 'bdf2807e6b2f670b96400fd2b6c77b3d1d50935ca14f3635dfe1199e86263c11'],
  [`${modelRoot}/PSMODULES/AppStudio/PSDATAENTITIES/ModelObservation/PSDELOGICS/SysOverviewCnt.json`, '08100121b6caafc1f8c0dbc23e59ab95dde5b09a09df7da3ce6348df3f4da4f4'],
  [`${modelRoot}/PSMODULES/AppStudio/PSDATAENTITIES/DynaDashboard/PSDEDATAQUERIES/Default/PSDEDQCODES/MYSQL5.json`, 'a11c7fb4260a46a0de135b4d8876a35b02fcb8bbf7631e29299e9cda03dfe2af'],
];

for (const [path, expected] of sources) {
  test(`reviewed source binding: ${path}`, () => {
    assert.equal(createHash('sha256').update(read(path)).digest('hex'), expected,
      'Re-review changed source; do not turn an old audit into current runtime evidence');
  });
}

for (const action of ['', 'VIEW', 'EDIT', 'UPDATE', 'CLOSE']) {
  for (const method of ['GET', 'POST']) {
    test(`${method} markopendata ${action || 'implicit VIEW'} is recognized but remains side-effect blocked`, () => {
      const result = assessOwnedNativePortalRequest(request(method, mark(action)), scope);
      assert.equal(result.kind, 'markOpenData');
      assert.equal(result.operation, action || 'VIEW');
      assert.equal(result.effectClass, 'cache-write-and-possible-notification');
      assert.equal(result.allowed, false);
      assert.equal(allowOwnedNativePortalRequest(request(method, mark(action)), scope), false);
    });
  }
}

for (const [method, suffix, operation] of [
  ['GET', `/${scope.dashboardId}`, 'record-read'],
  ['POST', '/fetchdefault', 'dataset-read'],
  ['POST', '', 'create'],
  ['GET', '/getdraft', 'draft-create-permission'],
  ['POST', '/checkkey', 'key-check-create-permission'],
  ['POST', '/save', 'save'],
  ['PUT', `/${scope.dashboardId}`, 'update'],
  ['DELETE', `/${scope.dashboardId}`, 'remove'],
]) {
  test(`${method} exact dashboard ${operation} does not imply verified user/root isolation`, () => {
    const result = assessOwnedNativePortalRequest(
      request(method, `${rooted}/dynadashboards${suffix}`), scope);
    assert.equal(result.kind, 'dynamicDashboard');
    assert.equal(result.operation, operation);
    assert.equal(result.allowed, false);
    assert.equal(result.reason, NATIVE_PORTAL_CONTRACTS.dynamicDashboard.reason);
  });
}

test('the POST/READ overview action remains blocked despite an own-root route and plausible body', () => {
  const result = assessOwnedNativePortalRequest({
    ...request('POST', `${rooted}/modelobservations/sysoverviewcnt`),
    body: { psdevslnsysid: scope.rootId, pssystemid: 'owned-logical-system' },
    optIn: true, sourceReviewed: true, admin: true,
  }, scope);
  assert.equal(result.kind, 'systemOverviewCount');
  assert.equal(result.allowed, false);
  assert.equal(result.reason, NATIVE_PORTAL_CONTRACTS.systemOverviewCount.reason);
});

for (const [method, path, reason] of [
  ['GET', `${rooted}/modelobservations/sysoverviewcnt`, 'UNPUBLISHED-OVERVIEW-METHOD-OR-SHAPE'],
  ['POST', `${rooted}/modelobservations/sysoverviewcnt/extra`, 'UNPUBLISHED-OVERVIEW-METHOD-OR-SHAPE'],
  ['GET', `${rooted}/dynadashboards/foreign-dashboard`, 'UNBOUND-DASHBOARD-METHOD-KEY-OR-ACTION'],
  ['GET', `${rooted}/dynadashboards/save`, 'UNBOUND-DASHBOARD-METHOD-KEY-OR-ACTION'],
  ['GET', `${rooted}/dynadashboards/checkkey`, 'UNBOUND-DASHBOARD-METHOD-KEY-OR-ACTION'],
  ['POST', `${rooted}/dynadashboards/arbitrary`, 'UNBOUND-DASHBOARD-METHOD-KEY-OR-ACTION'],
  ['POST', `${prefix}/psdevslnsys/foreign-root/modelobservations/sysoverviewcnt`, 'OUTSIDE-EXACT-OWNED-ROOT'],
  ['GET', `${prefix}/portal/markopendata/pssystem/foreign-key/VIEW`, 'UNBOUND-MARK-OPEN-DATA-ENTITY-KEY-OR-ACTION'],
  ['GET', `${prefix}/portal/markopendata/psmodule/pssystemindexview%40own-root/VIEW`, 'UNBOUND-MARK-OPEN-DATA-ENTITY-KEY-OR-ACTION'],
  ['GET', mark('DELETE'), 'UNBOUND-MARK-OPEN-DATA-ENTITY-KEY-OR-ACTION'],
  ['PUT', mark('VIEW'), 'UNREVIEWED-MARK-OPEN-DATA-METHOD-OR-SHAPE'],
  ['GET', `${prefix}/portal/markopendata/pssystem`, 'UNREVIEWED-MARK-OPEN-DATA-METHOD-OR-SHAPE'],
  ['GET', `${scope.origin}/api/foreign/portal/markopendata/pssystem/key/VIEW`, 'OUTSIDE-REVIEWED-APPLICATION'],
  ['GET', `${rooted}/psmodules/own-module`, 'OUTSIDE-REVIEWED-ROUTES'],
]) {
  test(`no suffix/verb/foreign-key admission: ${method} ${path}`, () => {
    const result = assessOwnedNativePortalRequest(request(method, path), scope);
    assert.equal(result.allowed, false);
    assert.equal(result.reason, reason);
  });
}

for (const url of [
  mark('VIEW').replace('127.0.0.1', '127.0.0.2'),
  mark('VIEW').replace(':32118', ':32119'),
  mark('VIEW').replace('http:', 'https:'),
  `${mark('VIEW')}?root=foreign`, `${mark('VIEW')}#fragment`,
  `${prefix}/psdevslnsys/other/../own-root/modelobservations/sysoverviewcnt`,
  mark('VIEW').replace('pssystemindexview%40own-root', 'x%2FVIEW'),
  mark('VIEW').replace('pssystemindexview%40own-root', 'x%2540root'),
  mark('VIEW').replace('pssystemindexview%40own-root', '%zz'),
  `/api/${scope.applicationId}/portal/markopendata/pssystem/key/VIEW`,
  'file:///api', 'javascript:alert(1)', `http://user:secret@127.0.0.1:32118/api/${scope.applicationId}`,
]) {
  test(`malformed or unbound URL stays denied: ${url}`, () => {
    assert.equal(assessOwnedNativePortalRequest(request('GET', url), scope).reason,
      'MALFORMED-OR-UNBOUND-REQUEST');
  });
}

test('accessor-backed request/scope identities are not executed and cannot open a route', () => {
  for (const [target, key] of [['request', 'url'], ['scope', 'rootId']]) {
    let getters = 0;
    const ownedRequest = request('GET', mark('VIEW'));
    const ownedScope = { ...scope };
    Object.defineProperty(target === 'request' ? ownedRequest : ownedScope, key, {
      get() { getters += 1; return 'untrusted'; },
    });
    const result = assessOwnedNativePortalRequest(ownedRequest, ownedScope);
    assert.equal(result.allowed, false);
    assert.equal(result.reason, 'MALFORMED-OR-UNBOUND-REQUEST');
    assert.equal(getters, 0);
  }
});

for (const key of ['getdraft', 'save', 'checkkey', 'fetchdefault']) {
  test(`a caller cannot turn published dashboard action ${key} into a keyed READ`, () => {
    const result = assessOwnedNativePortalRequest(
      request('GET', `${rooted}/dynadashboards/${key}`), { ...scope, dashboardId: key });
    assert.equal(result.allowed, false);
    assert.notEqual(result.operation, 'record-read');
  });
}

for (const malformed of [null, 7, '', {}, []]) {
  test(`typed scope identifiers remain strict for ${JSON.stringify(malformed)}`, () => {
    const result = assessOwnedNativePortalRequest(
      request('GET', mark('VIEW')), { ...scope, rootId: malformed });
    assert.equal(result.allowed, false);
    assert.equal(result.reason, 'MALFORMED-OR-UNBOUND-REQUEST');
  });
}

test('a body or flag getter is not inspected to decide authorization', () => {
  let getters = 0;
  const input = request('POST', `${rooted}/modelobservations/sysoverviewcnt`);
  for (const key of ['body', 'admin', 'optIn']) {
    Object.defineProperty(input, key, { get() { getters += 1; throw new Error('Not identity evidence'); } });
  }
  assert.equal(allowOwnedNativePortalRequest(input, scope), false);
  assert.equal(getters, 0);
});

test('returned contracts are immutable, pure decisions cannot be overwritten to allow a request', () => {
  assert.throws(() => { NATIVE_PORTAL_CONTRACTS.markOpenData.actions.push('DELETE'); }, TypeError);
  const result = assessOwnedNativePortalRequest(request('GET', mark('VIEW')), scope);
  assert.throws(() => { result.allowed = true; }, TypeError);
  assert.equal(result.requiredGates, NATIVE_PORTAL_CONTRACTS.markOpenData.requiredGates);
});

test('portal source publishes GET and POST, uses employee identity, mutates cache and can notify', () => {
  const controller = read(sources[0][0]);
  assert.match(controller, /RequestMethod\.GET.*\/portal\/markopendata/);
  assert.match(controller, /RequestMethod\.POST.*\/portal\/markopendata/);
  const runtime = read(sources[1][0]);
  const action = runtime.slice(runtime.indexOf('protected List<PortalMessage> onMarkOpenData'),
    runtime.indexOf('public PortalAsyncAction createAsyncAction'));
  assert.match(action, /AuthenticationUser\.getCurrentMust\(\)/);
  assert.match(action, /EmployeeContext\.getCurrentMust\(\)/);
  assert.match(action, /getPortalOpenDataCat\(iEmployeeContext\.getDcsystemid\(\), strEntity, strKey\)/);
  assert.match(action, /getApiuser\(\) == 1/);
  assert.match(action, /getSysCacheUtilRuntime\(\)\.getAll\(strCat\)/);
  assert.match(action, /getSysCacheUtilRuntime\(\)\.set\(strCat, strMqttTopic/);
  assert.match(action, /getInformAgent\(\)\.send\(entry\.getKey\(\)/);
  assert.doesNotMatch(action, /testDataAccessAction|PSDevSlnSys|PSSYSTEMID/);
  const close = action.indexOf('OPENDATAACTION_CLOSE.equals(strAction)');
  const reset = action.indexOf('.reset(strCat, strMqttTopic)', close);
  const set = action.indexOf('.set(strCat, strMqttTopic', reset);
  assert.ok(close >= 0 && reset > close && set > reset,
    'CLOSE can reset and then write again; do not assume it is a cleanup endpoint');
});

test('GatewayUtils publishes only the reviewed portal route to the portal service with a single prefix strip', () => {
  const gateway = read(sources[2][0]);
  const route = gateway.slice(gateway.indexOf('//cloud-portal'), gateway.indexOf('//cloud-portal-collaborate'));
  assert.match(route, /id", String\.format\("%1\$s__cloud_portal", strAPIPrefix\)/);
  assert.match(route, /uri", String\.format\("lb:\/\/%1\$s", ICloudUtilRuntime\.CLOUDSERVICEURL_PORTAL\)/);
  assert.match(route, /Path=\/%1\$s\/portal\/markopendata\/\*\*/);
  assert.match(route, /filtersNode\.add\("StripPrefix=1"\)/);
  assert.doesNotMatch(route, /PrefixPath|Header=|Method=/,
    'The generated route does not add an unreviewed prefix, identity bypass or verb rewrite');
  assert.equal((gateway.match(/CLOUDSERVICEURL_PORTAL/g) || []).length >= 4, true,
    'Portal service identity is a shared constant, not an arbitrary host');
});

test('all-in-one registers the EBSX Portal runtime and the controller exposes only the two reviewed verbs', () => {
  const hub = read(sources[3][0]);
  assert.match(hub, /registerSysUtilTypeIf\(ICloudPortalUtilRuntime\.class,\s*"USER:CLOUD_PORTAL",\s*"net\.ibizsys\.central\.cloud\.portal\.ebsx\.cloudutil\.EBSXCloudPortalUtilRuntime"\)/);
  const controller = read(sources[0][0]);
  const endpoint = controller.slice(
    controller.indexOf('@RequestMapping(method = {RequestMethod.GET}, value = {"/portal/markopendata'),
    controller.indexOf('@RequestMapping(method = {RequestMethod.POST}, value = {"/portal/asyncaction'),
  );
  assert.match(endpoint, /RequestMethod\.GET/);
  assert.match(endpoint, /RequestMethod\.POST/);
  assert.match(endpoint, /\/portal\/markopendata\/\{entity\}\/\{key\}\/\{action\}/);
  assert.doesNotMatch(endpoint, /RequestMethod\.PUT|RequestMethod\.DELETE/);
});

test('recognized portal VIEW remains a plan-only decision until every cache, audience, cleanup and record gate is supplied', () => {
  const result = assessOwnedNativePortalRequest(request('GET', mark('VIEW')), scope);
  assert.equal(result.allowed, false);
  assert.deepEqual(result.requiredGates, [
    'owned-employee-and-mqtt-topic-binding',
    'entity-key-root-read-authorization',
    'exact-cache-before-after-and-timeout-observation',
    'notification-audience-isolation',
    'cleanup-contract-not-close-assumption',
  ]);
  assert.equal(result.effectClass, 'cache-write-and-possible-notification');
  assert.equal(NATIVE_PORTAL_CONTRACTS.markOpenData.reason,
    'OPEN-DATA-CACHE-AND-NOTIFICATION-CONTRACT-UNVERIFIED');
});

test('dynamic dashboard source has a physical user field but no physical root field or fixed query ownership', () => {
  const dashboard = model('PSMODULES/AppStudio/PSDATAENTITIES/DynaDashboard.json');
  assert.equal(dashboard.tableName, NATIVE_PORTAL_CONTRACTS.dynamicDashboard.table);
  assert.equal(dashboard.enableDataVer, false);
  assert.equal(dashboard.enableEntityCache, false);
  assert.equal(dashboard.dataChangeLogMode, 0);
  const root = dashboard.getAllPSDEFields.find(field => field.name === 'PSDEVSLNSYSID');
  assert.equal(root.phisicalDEField, false);
  assert.equal(root.uIAssistDEField, true);
  const physical = dashboard.getAllPSDEDBTables[0].getAllPSDEFields.map(field => field.name);
  assert.deepEqual(physical, NATIVE_PORTAL_CONTRACTS.dynamicDashboard.physicalFields);
  assert.ok(physical.includes('USERID'));
  assert.equal(physical.includes('PSDEVSLNSYSID'), false);
  const query = model('PSMODULES/AppStudio/PSDATAENTITIES/DynaDashboard/PSDEDATAQUERIES/Default/PSDEDQCODES/MYSQL5.json');
  assert.match(query.queryCode, /FROM `T_DYNADASHBOARD`/);
  assert.doesNotMatch(query.queryCode, /WHERE|PSDEVSLNSYSID/i);
  const dto = dashboard.getAllPSDEMethodDTOs.find(value => value.name === 'DynaDashboardDTO');
  assert.equal(dto.getPSDEMethodDTOFields.find(field => field.name === 'UserId').readOnly, undefined);
  const filter = dashboard.getAllPSDEMethodDTOs.find(value => value.name === 'DynaDashboardFilterDTO');
  assert.equal(filter.getPSDEFilterDTOFields.some(field => field.name.includes('USERID')), false);
});

test('dashboard route operations match the actual published methods and native access actions', () => {
  const appEntity = model('PSSYSAPPS/ModelDesign/PSAPPDATAENTITIES/DynaDashboard.json');
  const entity = model('PSMODULES/AppStudio/PSDATAENTITIES/DynaDashboard.json');
  for (const [name, verb, suffix, access] of [
    ['Get', 'GET', undefined, 'READ'],
    ['Create', 'POST', undefined, 'CREATE'],
    ['Update', 'PUT', undefined, 'UPDATE'],
    ['Remove', 'DELETE', undefined, 'DELETE'],
    ['Save', 'POST', '/save', 'CREATE'],
    ['GetDraft', 'GET', '/getdraft', 'CREATE'],
    ['CheckKey', 'POST', '/checkkey', 'CREATE'],
  ]) {
    const published = appEntity.getAllPSAppDEActions.find(action => action.codeName === name);
    const native = entity.getAllPSDEActions.find(action => action.codeName === name);
    assert.equal(published.requestMethod, verb);
    assert.equal(published.requestPath, suffix);
    assert.equal(native.dataAccessAction, access);
    if (['Get', 'Update', 'Remove'].includes(name)) assert.equal(published.needResourceKey, true);
  }
  const dataset = appEntity.getAllPSAppDEDataSets.find(value => value.codeName === 'FetchDefault');
  assert.equal(dataset.requestMethod, 'POST');
  assert.equal(dataset.requestPath, '/fetchdefault');
  assert.equal(dataset.getPSAppDEMethodReturn.type, 'PAGE');
  assert.equal(appEntity.getMinorPSAppDERSs[0].getParentPSAppDEField.name, 'PSDEVSLNSYSID');
  assert.equal(appEntity.getMinorPSAppDERSs[0].actionRSMode, 1);
});

test('native dashboard client naming and payload ownership are not substituted for server authorization', () => {
  const base = 'modelingweb/packages-latest/@ibiz-template/runtime/src';
  const dashboard = read(`${base}/controller/control/dashboard/custom-dashboard.controller.ts`);
  assert.match(dashboard, /case 'personal':\s*return `\$\{base\}_\$\{this\.context\.srfpersonid\}`/);
  const util = read(`${base}/service/service/util/util.service.ts`);
  assert.match(util, /tempData\[userIdAppDEFieldId as string\] = tempContext\.srfpersonid/);
  const loadMethod = util.slice(util.indexOf('async load('), util.indexOf('async save('));
  assert.match(loadMethod, /catch \(error\) \{\s*return \{\};/);
});

test('overview source is POST READ/VOID but the logic forces a template logical system before five dataset reads', () => {
  const appEntity = model('PSSYSAPPS/ModelDesign/PSAPPDATAENTITIES/ModelObservation.json');
  const published = appEntity.getAllPSAppDEActions.find(action => action.codeName === 'SysOverviewCnt');
  assert.equal(published.requestMethod, 'POST');
  assert.equal(published.requestPath, '/sysoverviewcnt');
  assert.equal(published.getPSAppDEMethodReturn.type, 'VOID');
  const action = model('PSMODULES/AppStudio/PSDATAENTITIES/ModelObservation/PSDEACTIONS/SysOverviewCnt.json');
  assert.equal(action.dataAccessAction, 'READ');
  assert.equal(action.actionType, 'DELOGIC');
  assert.equal(action.getPSDEActionReturn.type, 'VOID');
  const logic = model('PSMODULES/AppStudio/PSDATAENTITIES/ModelObservation/PSDELOGICS/SysOverviewCnt.json');
  const assignment = logic.getPSDELogicNodes.flatMap(node => node.getPSDELogicNodeParams || [])
    .find(param => param.dstFieldName === 'pssystemid');
  assert.equal(assignment.srcValueType, 'SRCVALUE');
  assert.equal(assignment.srcValue, '2C40DFCD-0DF5-47BF-91A5-C45F810B0001');
  const datasets = logic.getPSDELogicNodes.filter(node => node.logicNodeType === 'DEDATASET');
  assert.equal(datasets.length, 5);
  assert.ok(datasets.every(node => node.getDstPSDEDataSet.id === 'CurSys'));
  assert.deepEqual(datasets.map(node => node.getDstPSDataEntity.path.split('/').at(-1).replace('.json', '')).sort(),
    [...NATIVE_PORTAL_CONTRACTS.systemOverviewCount.queriedEntities].sort());
  assert.ok(logic.getPSDELogicNodes.every(node =>
    ['BEGIN', 'PREPAREPARAM', 'DEDATASET', 'END'].includes(node.logicNodeType)));
  assert.equal(logic.getPSDELogicNodes.find(node => node.logicNodeType === 'END').getReturnParam.id, 'Default');
});

test('neither entity is in the default native model-instance authorizer registry', () => {
  const registry = read(sources[6][0]);
  assert.doesNotMatch(registry, /registerModel\((?:DYNADASHBOARD|MODELOBSERVATION)\)/);
  const authorizer = read(sources[5][0]);
  assert.match(authorizer, /if \(PSModels\.isModelInstDataEntity\(iDataEntityRuntime\.getName\(\)\)\)/);
  assert.match(authorizer, /return super\.createDataEntityAccessManager\(iDataEntityRuntime\)/);
  assert.doesNotMatch(authorizer, /case "(?:DYNADASHBOARD|MODELOBSERVATION)"/);
  const generic = read(sources[7][0]);
  assert.match(generic, /getPSDEUserRoles\(\(IEmployeeContext\) iUserContext, strAccessAction\)/);
  assert.match(generic, /if \(ObjectUtils\.isEmpty\(list\)\) \{\s*return false;/);
});
