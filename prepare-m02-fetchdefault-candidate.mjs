#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspectM02ModelApiCandidate } from './m02-candidate-modelapi-inspector.mjs';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const modelRoot = path.join(workspace,
  'vendor-upstream/ibizmodeling-standard/modelapi-core/src/main/resources/model/net/ibizsys/modeling');
const hash = value => createHash('sha256').update(value).digest('hex');
const privateRead = relative => {
  const filename = path.join(modelRoot, relative);
  const bytes = fs.readFileSync(filename);
  return { path: relative, bytes, sha256: hash(bytes), value: JSON.parse(bytes) };
};

const entityPath = 'PSMODULES/DevCenter/PSDATAENTITIES/PSDevCenter.json';
const appPath = 'PSSYSAPPS/ModelDesign/PSAPPDATAENTITIES/PSDevCenter.json';
const apiPath = 'PSSYSSERVICEAPIS/ModelAPI.json';
const defaultQueryPath = 'PSMODULES/DevCenter/PSDATAENTITIES/PSDevCenter/PSDEDATAQUERIES/Default/PSDEDQCODES/MYSQL5.json';
const memberQueryPath = 'PSMODULES/SysDesign/PSDATAENTITIES/PSDevSln/PSDEDATAQUERIES/CurDCSLNUser/PSDEDQCODES/MYSQL5.json';
const personSourcePath = 'PSMODULES/SysDesign/PSDATAENTITIES/PSDevSlnSys/PSDEDATAQUERIES/CurUser4/PSDEDQCODES/MYSQL5.json';

export function prepareM02FetchDefaultCandidate({ output } = {}) {
  const audit = inspectM02ModelApiCandidate();
  const entity = privateRead(entityPath);
  const app = privateRead(appPath);
  const api = privateRead(apiPath);
  const defaultQuery = privateRead(defaultQueryPath);
  const memberQuery = privateRead(memberQueryPath);
  const personSource = privateRead(personSourcePath);
  const serviceMethods = api.value.getPSDEServiceAPIs
    .find(item => item.codeName === 'PSDevCenter')?.getPSDEServiceAPIMethods ?? [];
  const peerServices = ['PSDevUser', 'PSDevCenterDBInst'].map(codeName => {
    const service = api.value.getPSDEServiceAPIs.find(item => item.codeName === codeName);
    const fetch = service?.getPSDEServiceAPIMethods.find(item => item.codeName === 'FetchDefault');
    assert.ok(service && fetch, `Missing peer FetchDefault contract: ${codeName}`);
    return {
      codeName, codeName2: service.codeName2, major: service.major, aPIMode: service.aPIMode,
      method: { codeName: fetch.codeName, dataAccessAction: fetch.dataAccessAction,
        methodType: fetch.methodType, requestMethod: fetch.requestMethod,
        dataset: fetch.getPSDEDataSet?.id ?? null,
        inputDto: fetch.getPSDEServiceAPIMethodInput?.getPSDEMethodDTO?.id ?? null,
        returnType: fetch.getPSDEServiceAPIMethodReturn?.type ?? null,
        returnDto: fetch.getPSDEServiceAPIMethodReturn?.getPSDEMethodDTO?.id ?? null },
    };
  });
  assert.equal(serviceMethods.some(method => method.codeName === 'FetchDefault'), false);
  const filterDto = entity.value.getAllPSDEMethodDTOs.find(dto => dto.type === 'DEFILTER');
  const defaultDto = entity.value.getAllPSDEMethodDTOs.find(dto => dto.type === 'DEFAULT');
  assert.equal(filterDto.name, 'PSDevCenterFilterDTO');
  assert.equal(defaultDto.name, 'PSDevCenterDTO');
  const proposedServiceMethod = {
    codeName: 'FetchDefault',
    dataAccessAction: 'READ',
    methodType: 'FETCH',
    name: 'FetchDefault',
    getPSDEDataSet: { modelref: true, id: 'Default' },
    getPSDEServiceAPIMethodInput: {
      name: '输入对象', getPSDEMethodDTO: { modelref: true, id: 'PSDevCenterFilterDTO' }, type: 'DTO',
    },
    getPSDEServiceAPIMethodReturn: {
      name: '返回对象', getPSDEMethodDTO: { modelref: true, id: 'PSDevCenterDTO' }, type: 'PAGE',
    },
    requestMethod: 'POST',
  };
  const originalMemberCondition = memberQuery.value.getPSDEDataQueryCodeConds?.[0]?.customCond;
  const proposedMemberCondition = 'EXISTS(SELECT * FROM `T_SRFPSDEVSLNUSER` t41 \\n'
    + ' WHERE \\n t1.`PSDEVSLNID` = t41.`PSDEVSLNID`'
    + '  AND  t41.`PSDEVUSEROBJID` = #{ctx.sessioncontext.srfpersonid} )';
  const report = {
    contract: 'm02-fetchdefault-readonly-candidate-v1',
    status: 'PREPARED-BLOCKED-SERVICE-SOURCE',
    generatedAt: new Date().toISOString(),
    writes: 0, sharedRequests: 0, dockerOperations: 0, vendorModified: false,
    inputs: [entity, app, api, defaultQuery, memberQuery, personSource].map(item => ({
      path: item.path, sha256: item.sha256,
    })),
    m02: {
      appDeclaration: app.value.getAllPSAppDEMethods.find(method => method.codeName === 'FetchDefault'),
      serviceMethodPresent: false,
      proposedServiceMethod,
      defaultDataset: entity.value.getAllPSDEDataSets.find(dataset => dataset.codeName === 'Default')?.codeName,
      defaultQuery: { path: defaultQuery.path, sha256: defaultQuery.sha256,
        selectedFields: ['CREATEDATE', 'CREATEMAN', 'PSDEVCENTERID', 'PSDEVCENTERNAME', 'UPDATEDATE', 'UPDATEMAN'],
        excludesCredentialFields: true },
      defaultAccessMode: entity.value.getAllPSDEACModes.find(mode => mode.defaultMode)?.codeName,
      peerServices,
      route: { method: 'POST', path: '/api/ibizmodeling__modeldesign/psdevcenters/fetchdefault',
        generatedRouteSourceAvailable: false },
      missingGates: ['authoritative ModelAPI service source insertion',
        'runtime route registration and access manager binding', 'deployed HTTP/DTO/permission regression'],
      refusal: 'Do not emit a deployable candidate or synthetic empty response until those gates exist.',
    },
    m01: {
      originalQuery: { path: memberQuery.path, sha256: memberQuery.sha256, condition: originalMemberCondition },
      personPredicateSource: { path: personSource.path, sha256: personSource.sha256,
        conditions: personSource.value.getPSDEDataQueryCodeConds?.map(row => row.customCond).filter(Boolean) ?? [] },
      proposedCondition: proposedMemberCondition,
      unresolvedAuthorization: ['ALLSYSFLAG', 'EXPIREDTIME', 'ACCMODE', 'PSDEVSLNSYSID', 'live role matrix'],
      deployable: false,
    },
    sourceAuditStatus: audit.status,
  };
  if (output) {
    assert.ok(path.isAbsolute(output));
    fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
    fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = prepareM02FetchDefaultCandidate({ output: process.argv[2] });
  console.log(JSON.stringify({ status: report.status, serviceMethodPresent: report.m02.serviceMethodPresent,
    vendorModified: report.vendorModified, writes: report.writes }));
}
