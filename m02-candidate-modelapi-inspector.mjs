#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modelRoot = path.join(workspace,
  'vendor-upstream/ibizmodeling-standard/modelapi-core/src/main/resources/model/net/ibizsys/modeling');
const digest = value => createHash('sha256').update(value).digest('hex');
const readJson = relative => {
  const filename = path.join(modelRoot, relative);
  const bytes = fs.readFileSync(filename);
  return { path: relative, sha256: digest(bytes), value: JSON.parse(bytes) };
};
const entityPaths = {
  PSDevCenter: 'PSMODULES/DevCenter/PSDATAENTITIES/PSDevCenter.json',
  PSAppType: 'PSMODULES/Config/PSDATAENTITIES/PSAppType.json',
  PSSF: 'PSMODULES/Config/PSDATAENTITIES/PSSF.json',
  PSPFStyle: 'PSMODULES/Config/PSDATAENTITIES/PSPFStyle.json',
  PSDevSln: 'PSMODULES/SysDesign/PSDATAENTITIES/PSDevSln.json',
  PSDevSlnSys: 'PSMODULES/SysDesign/PSDATAENTITIES/PSDevSlnSys.json',
};
const appEntityPaths = {
  PSDevCenter: 'PSSYSAPPS/ModelDesign/PSAPPDATAENTITIES/PSDevCenter.json',
  PSDevSln: 'PSSYSAPPS/ModelDesign/PSAPPDATAENTITIES/PSDevSln.json',
};
const queryPaths = {
  PSDevCenterDefault: 'PSMODULES/DevCenter/PSDATAENTITIES/PSDevCenter/PSDEDATAQUERIES/Default/PSDEDQCODES/MYSQL5.json',
  CurDCSLNUser: 'PSMODULES/SysDesign/PSDATAENTITIES/PSDevSln/PSDEDATAQUERIES/CurDCSLNUser/PSDEDQCODES/MYSQL5.json',
  CurUser4: 'PSMODULES/SysDesign/PSDATAENTITIES/PSDevSlnSys/PSDEDATAQUERIES/CurUser4/PSDEDQCODES/MYSQL5.json',
};

function entity(name) {
  return readJson(entityPaths[name]);
}
function serviceApi() {
  return readJson('PSSYSSERVICEAPIS/ModelAPI.json').value;
}
function method(entityName, codeName) {
  const api = serviceApi().getPSDEServiceAPIs.find(item => item.codeName === entityName);
  assert.ok(api, `Missing ModelAPI service entity: ${entityName}`);
  const result = api.getPSDEServiceAPIMethods.find(item => item.codeName === codeName);
  return result ? {
    codeName: result.codeName, name: result.name, requestMethod: result.requestMethod,
    dataAccessAction: result.dataAccessAction, methodType: result.methodType,
    dataSet: result.getPSDEDataSet?.id ?? null,
    inputDto: result.getPSDEServiceAPIMethodInput?.getPSDEMethodDTO?.id ?? null,
    returnType: result.getPSDEServiceAPIMethodReturn?.type ?? null,
    returnDto: result.getPSDEServiceAPIMethodReturn?.getPSDEMethodDTO?.id ?? null,
  } : null;
}
function appMethod(entityName, codeName) {
  const item = readJson(appEntityPaths[entityName]).value;
  const result = item.getAllPSAppDEMethods.find(value => value.codeName === codeName);
  return result ? { codeName: result.codeName, dataSetTag: result.dataSetTag ?? null,
    requestMethod: result.requestMethod ?? null, requestPath: result.requestPath ?? null } : null;
}
function queryConditions(relative) {
  return readJson(relative).value.getPSDEDataQueryCodeConds?.map(row => row.customCond).filter(Boolean) ?? [];
}

export function inspectM02ModelApiCandidate() {
  const serviceModel = serviceApi();
  const configPeers = ['PSAppType', 'PSSF', 'PSPFStyle'].map(name => ({
    name, entity: entity(name), fetchDefault: method(name, 'FetchDefault'),
  }));
  const centerEntity = entity('PSDevCenter');
  const centerDefaultQuery = readJson(queryPaths.PSDevCenterDefault);
  const centerFields = centerDefaultQuery.value.getPSDEDataQueryCodeExps.map(row => row.name);
  const selectedFields = centerDefaultQuery.value.queryCode.match(/t1\.`([A-Z0-9_]+)`/g)
    ?.map(value => value.match(/`([A-Z0-9_]+)`/)?.[1]).filter(Boolean) ?? [];
  const centerAppFetch = appMethod('PSDevCenter', 'FetchDefault');
  const currentMember = readJson(queryPaths.CurDCSLNUser);
  const currentPersonReference = readJson(queryPaths.CurUser4);
  const memberConditions = queryConditions(queryPaths.CurDCSLNUser);
  const reusablePersonConditions = queryConditions(queryPaths.CurUser4);
  const findings = {
    m02: {
      status: centerAppFetch && !method('PSDevCenter', 'FetchDefault') ? 'BLOCKED-MISSING-SERVICE-METHOD' : 'NOT-CONFIRMED',
      appMethod: centerAppFetch,
      serviceMethod: method('PSDevCenter', 'FetchDefault'),
      serviceEntity: { path: centerEntity.path, sha256: centerEntity.sha256,
        tableName: centerEntity.value.tableName, dataAccCtrlMode: centerEntity.value.dataAccCtrlMode,
        enableCreate: centerEntity.value.enableCreate, enableModify: centerEntity.value.enableModify,
        enableRemove: centerEntity.value.enableRemove,
        datasets: centerEntity.value.getAllPSDEDataSets.map(item => item.codeName),
        actions: centerEntity.value.getAllPSDEActions.map(item => ({
          codeName: item.codeName, actionMode: item.actionMode, actionType: item.actionType,
        })) },
      defaultQuery: { path: centerDefaultQuery.path, sha256: centerDefaultQuery.sha256,
        declaredFields: centerFields, selectedFields, queryCode: centerDefaultQuery.value.queryCode,
        excludesCredentialFields: !selectedFields.includes('LICKEY') && !selectedFields.includes('LICINFO') },
      peerFetchDefaultContracts: configPeers.map(peer => ({
        name: peer.name, serviceMethod: peer.fetchDefault,
        entitySha256: peer.entity.sha256,
        accessMode: peer.entity.value.dataAccCtrlMode,
        defaultDataset: peer.entity.value.getAllPSDEDataSets.find(item => item.defaultMode)?.codeName ?? null,
        defaultAccessMode: peer.entity.value.getAllPSDEACModes.find(item => item.defaultMode)?.codeName ?? null,
      })),
      exactNativeRequest: { method: 'POST', path: '/api/ibizmodeling__modeldesign/psdevcenters/fetchdefault',
        body: { page: 0, size: 1000 }, currentObservedOutcome: 'HTTP 500/106 bytes from retained runtime receipt' },
      safeCandidate: 'Add a source-declared PSDevCenter FetchDefault service method with READ/FETCH/PAGE DTO contract matching the peer entities, then rebuild and deploy. Bind the Default dataset/query and PSDevCenter access manager explicitly; do not return a synthetic empty page or expose LICKEY/LICINFO.',
      missingInputs: [
        'authoritative service API/model generator source for PSDevCenter method declaration',
        'current runtime access-manager and route registration proof',
        'fresh deployed HTTP 200/readback and permission matrix',
      ],
    },
    m01: {
      status: reusablePersonConditions.some(cond => /PSDEVUSEROBJID\s*`?\s*=\s*#\{ctx\.sessioncontext\.srfpersonid\}/i.test(cond))
        ? 'PARTIAL-REUSABLE-PERSON-PREDICATE' : 'BLOCKED-NO-REUSABLE-PERSON-PREDICATE',
      currentMember: { path: currentMember.path, sha256: currentMember.sha256, conditions: memberConditions },
      reusableSource: { path: currentPersonReference.path, sha256: currentPersonReference.sha256,
        conditions: reusablePersonConditions },
      currentMemberHasPersonPredicate: memberConditions.some(cond => /PSDEVUSEROBJID|SRFPERSONID|srfpersonid/i.test(cond)),
      currentMemberHasCenterContext: memberConditions.some(cond => /psdevcenterid/i.test(cond)),
      proposedPredicate: 'EXISTS(SELECT * FROM `T_SRFPSDEVSLNUSER` t41 WHERE t1.`PSDEVSLNID` = t41.`PSDEVSLNID` AND t41.`PSDEVUSEROBJID` = #{ctx.sessioncontext.srfpersonid})',
      missingAuthorizationSemantics: ['ALLSYSFLAG=0 vs global membership', 'EXPIREDTIME/non-expired membership', 'ACCMODE viewer/editor', 'PSDEVSLNSYSID/root scope', 'live current-person and cross-center matrix'],
      safeCandidate: 'Reuse only the field/context binding shape PSDEVUSEROBJID = SESSIONCONTEXT(SRFPERSONID) from CurUser4 and the existing candidate; do not claim full permission parity until ALLSYSFLAG, expiry, ACCMODE, root scope and live role tests are bound.',
    },
  };
  return {
    contract: 'm02-modelapi-candidate-and-m01-person-predicate-inspector-v1',
    generatedAt: new Date().toISOString(),
    modelApiSha256: digest(Buffer.from(JSON.stringify(serviceModel))),
    findings,
    writes: 0, sharedRequests: 0, dockerOperations: 0, sourceModified: false,
    status: findings.m02.status === 'BLOCKED-MISSING-SERVICE-METHOD' &&
      findings.m01.status === 'PARTIAL-REUSABLE-PERSON-PREDICATE'
      ? 'BLOCKED-M02-SERVICE-INPUTS-MISSING-M01-PREDICATE-ONLY-PARTIAL' : 'PARTIAL',
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = inspectM02ModelApiCandidate();
  const output = process.argv[2];
  if (output) {
    fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
    fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  }
  console.log(JSON.stringify({ status: report.status, m02: report.findings.m02.status,
    m01: report.findings.m01.status, writes: 0 }));
}
