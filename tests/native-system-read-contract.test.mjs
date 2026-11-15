import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import {
  describeNativeSystemAccess,
  NATIVE_SYSTEM_FIELDS,
  NATIVE_SYSTEM_READ_CONTRACT,
  validateProposedNativeSystemSummary,
} from '../native-system-read-contract.mjs';
import { workspace } from '../localization-baseline.mjs';

const root = 'vendor-upstream/ibizmodeling-standard/modelapi-core/src/main/resources/model/net/ibizsys/modeling';
const hub = 'ibiz-service-hub/libs/ibiz-modeling-core/src/main/java/net/ibizsys/modeling/core';
const runtime = 'modelingweb/packages-latest/@ibiz-template';
const read = path => fs.readFileSync(join(workspace, path), 'utf8');
const json = path => JSON.parse(read(`${root}/${path}`));
const view = name => json(`PSSYSAPPS/ModelDesign/PSAPPDEVIEWS/${name}.json`);
const entity = name => json(`PSMODULES/SysDesign/PSDATAENTITIES/${name}.json`);
const appEntity = name => json(`PSSYSAPPS/ModelDesign/PSAPPDATAENTITIES/${name}.json`);
function all(value, predicate) {
  if (!value || typeof value !== 'object') return [];
  return [
    ...(predicate(value) ? [value] : []),
    ...Object.values(value).flatMap(child => Array.isArray(child)
      ? child.flatMap(item => all(item, predicate))
      : all(child, predicate)),
  ];
}
const formItems = value => all(value, node => node.detailType === 'FORMITEM' &&
  node.getPSAppDEField && node.getPSEditor?.editorType !== 'HIDDEN');
const fieldNames = items => items.map(item => item.getPSAppDEField.name.toLowerCase());
const sources = [
  [`${root}/PSSYSAPPS/ModelDesign/PSAPPDEVIEWS/PSSystemDashboardView.json`, '0669d6115ae326b7757e17523b1716773cd6c0bf6778ae571d3edbedd5078cac'],
  [`${root}/PSSYSAPPS/ModelDesign/PSAPPDEVIEWS/PSSystemDashboardView_SysInfo.json`, 'f65a8762c0ef4d3ab699be9d55d124cefd7d2092dbf9f2a5d0a1992dc74c492f'],
  [`${root}/PSSYSAPPS/ModelDesign/PSAPPDEVIEWS/PSSystemSettingInfoView.json`, '5e6dd224e90fc8d1d1d8b1d140926733171d8c46e97b8b113b81811127911fcb'],
  [`${root}/PSSYSAPPS/ModelDesign/PSAPPDEVIEWS/PSSystemSettingCfgView.json`, 'd30c7d7d9504a158d36d088d47035030bbb84f775dcc404653ac66ae24dee079'],
  [`${root}/PSMODULES/SysDesign/PSDATAENTITIES/PSSystem.json`, '1d8a63f08741b0fe506dcec70cba171957a7570cd655f4855319eed64419ff20'],
  [`${root}/PSSYSAPPS/ModelDesign/PSAPPDATAENTITIES/PSSystem.json`, '8055afa6023675bf00029a8abede37fdf7b2c9e8711b76664b0b581a8a05c6ff'],
  [`${root}/PSMODULES/SysDesign/PSDATAENTITIES/PSDevSlnSys.json`, '086a109e199507d57e4e1d483581d6f8329efa958130cfc00fe51b70db191ce0'],
  [`${runtime}/vue3-components/src/view-engine/portal-view-engine.ts`, 'a13650970252a9129e155387f19f3bfcc23d9341d9084a7e46f6626e27eb0e5e'],
  [`${runtime}/runtime/src/engine/view-base.engine.ts`, '6366034d00aaac7ba998dcb97702fd05f1eff17e3e27e6462f5f14e0d8c43029'],
  [`${hub}/security/SystemAccessManagerBase.java`, '5298ac71c2fc6ebd7af75fa6035cb0fa7674846c5443501be427f7d1f4458712'],
  [`${hub}/dataentity/dto/PSSystemDTO.java`, '07a78023d9c690340314c06262222bee231f0782318428e5cde012e96087e936'],
  [`${hub}/database/ModelSysDBSchemeRuntimeBase.java`, '9205cff6780f2e4463b5518ad331404fa4906c1284d8cda45bf010b759801b2d'],
];
for (const [path, sha256] of sources) {
  test(`system contract source binding: ${path}`, () => {
    assert.equal(createHash('sha256').update(read(path)).digest('hex'), sha256);
  });
}

test('both dashboard portals load the parent PSSYSTEM record, not only their child widgets', () => {
  for (const name of ['PSSystemDashboardView', 'PSSystemDashboardView_SysInfo']) {
    const model = view(name);
    assert.equal(model.getPSAppViewEngines[0].engineType, 'PortalView');
    assert.ok(model.getPSAppDataEntity.path.endsWith('/PSSystem.json'));
    const context = model.getPSAppViewNavContexts.find(value => value.key === 'PSSYSTEM');
    assert.equal(context.rawValue, true);
    assert.equal(context.value, '2C40DFCD-0DF5-47BF-91A5-C45F810B0001');
  }
  const portal = read(sources[7][0]);
  assert.match(portal, /async onMounted\(\)[\s\S]*await this\.loadEntityData\(\)/);
  const engine = read(sources[8][0]);
  const load = engine.slice(engine.indexOf('async loadEntityData('));
  assert.match(load, /app\.deService\.exec\(\s*appDataEntityId,\s*'get',/);
});

test('settings info is a SPAN-only display form with exactly the observed 22 settings', () => {
  const model = view('PSSystemSettingInfoView');
  const form = model.getPSControls.find(control => control.controlType === 'FORM');
  assert.equal(form.infoFormMode, true);
  const items = formItems(form);
  assert.deepEqual(fieldNames(items), NATIVE_SYSTEM_FIELDS.observedSettingsInfo);
  assert.ok(items.every(item => item.getPSEditor.editorType === 'SPAN'));
  assert.equal(form.getGetPSControlAction.getPSAppDEMethod.id, 'Get');
  assert.equal(form.getGetPSControlAction.dataAccessAction, 'READ');
  const configAction = all(model, node => node.codeName === 'SettingCfg' && node.uIActionType)[0];
  assert.ok(configAction.getFrontPSAppView.path.endsWith('/PSSystemSettingCfgView.json'));
  assert.match(read(`${runtime}/runtime/src/controller/control/form/edit-form/edit-form.controller.ts`),
    /res = await this\.service\.get\(context, queryParams\)/);
});

test('settings drawer has a distinct edit form and extra fields; visible controls are not write authorization', () => {
  const model = view('PSSystemSettingCfgView');
  const form = model.getPSControls.find(control => control.controlType === 'FORM');
  assert.equal(model.openMode, 'DRAWER_RIGHT');
  assert.equal(form.codeName, 'Setting');
  assert.notEqual(form.infoFormMode, true);
  const fields = form.getPSDEFormItems.filter(item => item.getPSAppDEField &&
    !item.id.startsWith('srf') && item.id !== 'pssystemid').map(item => item.getPSAppDEField.name.toLowerCase());
  const expected = [...NATIVE_SYSTEM_FIELDS.observedSettingsInfo,
    ...NATIVE_SYSTEM_FIELDS.observedSettingsEditorExtra];
  assert.deepEqual([...new Set(fields)].sort(), [...expected].sort());
  assert.equal(form.getUpdatePSControlAction.dataAccessAction, 'UPDATE');
  assert.equal(form.getUpdatePSControlAction.getPSAppDEMethod.id, 'Update');
  const disabled = all(form, item => item.detailType === 'FORMITEM' &&
    ['SAASMODE', 'ENABLEDYNASYS'].includes(item.getPSAppDEField?.name));
  assert.ok(disabled.every(item => item.enableCond === 0));
  const settings = read(`${root}/PSSYSAPPS/ModelDesign/PSAPPDATAENTITIES/PSSystem/PSFORMS/Setting.json`);
  assert.match(settings, /"valueItemName" : "pslanguageid"/);
  assert.match(settings, /"valueItemName" : "clemptytextpslanresid"/);
});

test('SysInfo embeds a root info form with 11 displayed fields, distinct from its outer PSSYSTEM Get', () => {
  const form = all(view('PSSystemDashboardView_SysInfo'), node => node.controlType === 'FORM')[0];
  assert.ok(form.getPSAppDataEntity.path.endsWith('/PSDevSlnSys.json'));
  assert.deepEqual(fieldNames(formItems(form)), NATIVE_SYSTEM_FIELDS.observedRootInfo);
  assert.equal(form.getGetPSControlAction.getPSAppDEMethod.id, 'Get');
  const dto = entity('PSDevSlnSys').getAllPSDEMethodDTOs.find(value => value.name === 'PSDevSlnSysDTO');
  const returned = dto.getPSDEMethodDTOFields.map(field => field.name.toLowerCase());
  assert.ok(returned.includes('connstr'));
  assert.ok(returned.includes('dbname'));
  assert.ok(returned.includes('pssysmodelinstid'));
  assert.ok(returned.includes('deploysysid'));
  assert.equal(NATIVE_SYSTEM_FIELDS.observedRootInfo.includes('connstr'), false);
  assert.equal(form.getPSControlHandler.enableDEFieldPrivilege, false);
});

test('generic Get and FetchDefault publish full system DTOs, not a narrowed settings contract', () => {
  const app = appEntity('PSSystem');
  const get = app.getAllPSAppDEActions.find(action => action.codeName === 'Get');
  assert.equal(get.requestMethod, 'GET');
  assert.equal(get.needResourceKey, true);
  assert.equal(get.getPSAppDEMethodReturn.getPSAppDEMethodDTO.id, 'PSSystemDTO');
  const fetch = app.getAllPSAppDEDataSets.find(action => action.codeName === 'FetchDefault');
  assert.equal(fetch.requestMethod, 'POST');
  assert.equal(fetch.requestPath, '/fetchdefault');
  assert.equal(fetch.getPSAppDEMethodReturn.getPSAppDEMethodDTO.id, 'PSSystemDTO');
  const fields = app.getAllPSAppDEMethodDTOs.find(value => value.name === 'PSSystemDTO')
    .getPSAppDEMethodDTOFields.map(field => field.name.toLowerCase());
  for (const field of NATIVE_SYSTEM_FIELDS.notSummarySystemFields) assert.ok(fields.includes(field), field);
  assert.equal(fields.includes('password'), false);
  assert.equal(fields.includes('connstr'), false);
  assert.equal(NATIVE_SYSTEM_READ_CONTRACT.existingGenericReads.get.narrow, false);
});

test('GetCur is a backend-only full-DTO logic, not a published minimal projection fallback', () => {
  const action = json('PSMODULES/SysDesign/PSDATAENTITIES/PSSystem/PSDEACTIONS/GetCur.json');
  assert.equal(action.enableFront, false);
  assert.equal(action.getPSDEActionReturn.getPSDEMethodDTO.id, 'PSSystemDTO');
  assert.equal(appEntity('PSSystem').getAllPSAppDEActions.some(value => value.codeName === 'GetCur'), false);
  const service = read(`${root}/PSSYSSERVICEAPIS/ModelAPI.json`);
  assert.equal(service.includes('PSSystem/PSDEACTIONS/GetCur.json'), false);
  const logic = json('PSMODULES/SysDesign/PSDATAENTITIES/PSSystem/PSDELOGICS/getCur.json');
  assert.ok(all(logic, node => node.getDstPSDEAction?.path?.endsWith('/PSSystem/PSDEACTIONS/Get.json')).length);
});

test('default authorizer registry and SELF entity metadata explain why root grants do not supply generic READ', () => {
  const model = entity('PSSystem');
  assert.equal(model.dataAccCtrlMode, 1);
  assert.equal(model.getAllPSDEUserRoles, undefined);
  assert.equal(model.getAllPSDEOPPrivs, undefined);
  const registry = read(`${hub}/util/PSModels.java`);
  assert.doesNotMatch(registry, /registerModel\(PSSYSTEM\)/);
  const authorizer = read(sources[9][0]);
  assert.match(authorizer, /String\.format\("%sDEAccessManager", iDataEntityRuntime\.getPSDataEntity\(\)\.getCodeName\(\)\)/);
  assert.match(authorizer, /if \(iSysSFPluginRuntime != null\)/);
  assert.doesNotMatch(authorizer, /case "PSSYSTEM"/);
  assert.match(authorizer, /return super\.createDataEntityAccessManager\(iDataEntityRuntime\)/);
  const generic = read('ibiz-service-hub/libs/ibiz-cloud-core/src/main/java/net/ibizsys/central/cloud/core/dataentity/security/DataEntityAccessManager.java');
  assert.match(generic, /getPSDEUserRoles\(\(IEmployeeContext\) iUserContext, strAccessAction\)/);
  assert.match(generic, /if \(ObjectUtils\.isEmpty\(list\)\) \{\s*return false;/);
});

test('effective generic roles include runtime entity authorities and cached dynamic system-role assignment', () => {
  const generic = read('ibiz-service-hub/libs/ibiz-cloud-core/src/main/java/net/ibizsys/central/cloud/core/dataentity/security/DataEntityAccessManager.java');
  assert.match(generic, /getDefaultDEUserRoleRuntimes\(\)/);
  assert.match(generic, /getUserSysUserRoleRuntimes\(\)/);
  assert.match(generic, /getAdminSysUserRoleRuntimes\(\)/);
  assert.match(generic, /getSysUserRoleRuntimes\(iEmployeeContext\)/);
  assert.match(generic, /grantedAuthority instanceof UAADEAuthority/);
  assert.match(generic, /uaadeAuthority\.getEntity\(\)\.equals\(this\.getDataEntityRuntime\(\)\.getName\(\)\)/);
  assert.match(generic, /uaadeAuthority\.getDeAction\(\)/);
  assert.match(generic, /uaadeAuthority\.getBscope\(\)/);
  const manager = read('ibiz-service-hub/libs/ibiz-cloud-core/src/main/java/net/ibizsys/central/cloud/core/security/SystemAccessManagerBase.java');
  assert.match(manager, /ga instanceof UAARoleAuthority/);
  assert.match(manager, /getAuthenticationUserCat\(iAuthenticationUser\.getUsername\(\), iAuthenticationUser\.getToken\(\)\)/);
  assert.match(manager, /getUserDynaRolesTag\(iEmployeeContext\.getDcsystemid\(\)\)/);
  assert.match(manager, /iSysUserRoleRuntime\.testUser\(iUserContext\)/);
  assert.match(manager, /getSysCacheUtilRuntime\(\)\.set\(/);
  assert.equal(NATIVE_SYSTEM_READ_CONTRACT.defaultAuthorization.effectiveRoleSources.length, 6);
});

test('routing projection exposes exactly two identifiers and the proposed summary sources only grant-bound labels', () => {
  const manager = read(sources[9][0]);
  const prepare = manager.slice(manager.indexOf('protected void prepareModelContext('),
    manager.indexOf('protected IPSDevUser getPSDevUser('));
  assert.deepEqual([...prepare.matchAll(/context\.put\("([^"]+)"/g)].map(match => match[1]),
    NATIVE_SYSTEM_FIELDS.routingContext);
  assert.match(prepare, /actor\.getPSDevUserId\(\)\.equalsIgnoreCase\(user\.getPSDevUserId\(\)\)/);
  assert.match(prepare, /actor\.getPSDevCenterId\(\)\.equalsIgnoreCase\(user\.getPSDevCenterId\(\)\)/);
  assert.match(manager, /psDevUser\.setPSDevSlnSysCodeName\(psDevSlnSysDTO\.getCodeName\(\)\)/);
  assert.match(manager, /psDevUser\.setPSDevSlnSysLogicName\(psDevSlnSysDTO\.getLogicName\(\)\)/);
  assert.match(manager, /psDevUser\.setPSSystemName\(psDevSlnSysDTO\.getPSDevSlnSysName\(\)\)/);
  assert.equal(NATIVE_SYSTEM_READ_CONTRACT.summary.published, false);
});

test('existing appdata wrapper can enqueue upgrades, so helper purity is not blanket GET-side-effect evidence', () => {
  const manager = read(sources[9][0]);
  const appdata = manager.slice(manager.indexOf('protected AppData onGetAppData('),
    manager.indexOf('protected void prepareModelContext('));
  assert.match(appdata, /isModelAutoUpgrate\(\)/);
  assert.match(appdata, /executeAction\("X_ADDUPGRATESYSMODELTASK"/);
  const helper = manager.slice(manager.indexOf('protected void prepareModelContext('),
    manager.indexOf('protected IPSDevUser getPSDevUser('));
  assert.doesNotMatch(helper, /executeAction|\.update\(|\.create\(|\.save\(/);
});

test('credential exclusion is backed by actual datasource use, not by claiming nonexistent PSSystem password fields', () => {
  const scheme = read(sources[11][0]);
  assert.match(scheme, /dataSource\.setJdbcUrl\(asString\(readProperty\(modelInst, "getConnStr"\)\)\)/);
  assert.match(scheme, /dataSource\.setUsername\(asString\(readProperty\(modelInst, "getUserName"\)\)\)/);
  assert.match(scheme, /dataSource\.setPassword\(asString\(readProperty\(modelInst, "getPassword"\)\)\)/);
  const dto = read(sources[10][0]);
  assert.doesNotMatch(dto, /DTOFIELD_(?:PASSWORD|CONNSTR|USERNAME)\s*=/);
  const instance = read(`${hub}/dataentity/dto/PSSysModelInstDTO.java`);
  assert.match(instance, /FIELD_PASSWORD = "PASSWD"/);
  assert.match(instance, /DTOFIELD_PASSWORD = "password"/);
  assert.match(instance, /public String getPassword\(\)/);
});

for (const role of ['root-reader', 'root-editor']) {
  for (const profile of ['routingContext', 'summary', 'settingsInfo', 'settingsEditor']) {
    test(`${role} ${profile} read remains design metadata, not live authorization`, () => {
      const result = describeNativeSystemAccess(profile, role);
      assert.equal(result.allowed, false);
      assert.equal(result.roleEligibleForProposal, true);
      assert.ok(result.requiredGates.includes('explicit-typed-projection-not-DTO-or-entity-bag-serialization'));
    });
  }
}
test('reader and editor write prerequisites are separate and neither has an implemented field allowlist', () => {
  const reader = describeNativeSystemAccess('settingsEditor', 'root-reader', 'update');
  const editor = describeNativeSystemAccess('settingsEditor', 'root-editor', 'update');
  assert.equal(reader.roleEligibleForProposal, false);
  assert.equal(editor.roleEligibleForProposal, true);
  assert.equal(reader.allowed, false);
  assert.equal(editor.allowed, false);
  assert.deepEqual(editor.fields, []);
  assert.deepEqual(NATIVE_SYSTEM_READ_CONTRACT.settingsEditor.reviewedWriteAllowlist, []);
  assert.equal(describeNativeSystemAccess('summary', 'root-editor', 'update').roleEligibleForProposal, false);
});
for (const args of [
  ['fullDTO', 'root-editor'], ['summary', 'admin'], ['summary', 'anonymous'],
  ['summary', 'root-editor', 'deploy'], ['summary', 'root-reader', 'compile'],
]) {
  test(`unknown profile/role/operation cannot acquire access: ${args.join(' ')}`, () => {
    assert.equal(describeNativeSystemAccess(...args).allowed, false);
    assert.equal(describeNativeSystemAccess(...args).roleEligibleForProposal, false);
  });
}

const binding = { rootId: 'own-root', logicalSystemId: 'own-system' };
const summary = {
  psdevslnsys: 'own-root', pssystemid: 'own-system', pssystemname: 'Own System',
  psdevslnsysname: 'Own Library', codename: 'OwnLibrary', logicname: 'Own Library',
};
test('proposed summary schema preserves text and validates only the exact server-bound identifiers', () => {
  assert.equal(validateProposedNativeSystemSummary(summary, binding), true);
  assert.equal(validateProposedNativeSystemSummary({
    ...summary, pssystemname: '中文 \u{1f680} e\u0301 "\' \\\n', logicname: null,
  }, binding), true);
  assert.throws(() => validateProposedNativeSystemSummary({ ...summary, pssystemid: 'foreign' }, binding));
  assert.throws(() => validateProposedNativeSystemSummary({ ...summary, psdevslnsys: 'foreign' }, binding));
});
for (const field of [
  ...NATIVE_SYSTEM_FIELDS.notSummarySystemFields,
  ...NATIVE_SYSTEM_FIELDS.notSummaryRootFields,
  'password', 'passwd', 'username', 'adminmode', 'accmode', 'config', 'srfreadonly',
]) {
  test(`summary schema refuses extra ${field} rather than silently serializing or dropping it`, () => {
    assert.throws(() => validateProposedNativeSystemSummary({ ...summary, [field]: 'not-returned' }, binding),
      /exactly the reviewed projection fields/);
  });
}
test('summary schema rejects getters without evaluating them and cannot authorize by itself', () => {
  let getters = 0;
  const data = { ...summary };
  Object.defineProperty(data, 'pssystemname', { get() { getters += 1; return 'not-evaluated'; } });
  assert.throws(() => validateProposedNativeSystemSummary(data, binding), /own data properties/);
  assert.equal(getters, 0);
  assert.throws(() => validateProposedNativeSystemSummary({ ...summary, codename: {} }, binding), /plain text/);
  assert.equal(validateProposedNativeSystemSummary(summary, binding), true);
  assert.equal(describeNativeSystemAccess('summary', 'root-reader').allowed, false);
});
