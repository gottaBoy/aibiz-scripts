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
const entity = codeName => readJson({
  PSDevCenter: 'PSMODULES/DevCenter/PSDATAENTITIES/PSDevCenter.json',
  PSDevUser: 'PSMODULES/DevCenter/PSDATAENTITIES/PSDevUser.json',
  PSDevSln: 'PSMODULES/SysDesign/PSDATAENTITIES/PSDevSln.json',
}[codeName]);
const appEntity = codeName => readJson({
  PSDevCenter: 'PSSYSAPPS/ModelDesign/PSAPPDATAENTITIES/PSDevCenter.json',
  PSDevSln: 'PSSYSAPPS/ModelDesign/PSAPPDATAENTITIES/PSDevSln.json',
}[codeName]);

function serviceMethods(codeName) {
  const system = readJson('PSSYSSERVICEAPIS/ModelAPI.json').value;
  const item = system.getPSDEServiceAPIs.find(row => row.codeName === codeName);
  assert.ok(item, `Missing ModelAPI service entity ${codeName}`);
  return item.getPSDEServiceAPIMethods.map(method => ({
    codeName: method.codeName, name: method.name, requestMethod: method.requestMethod,
    serviceEntity: item.codeName,
    action: method.getPSDEAction?.codeName ?? null,
    dataSet: method.getPSDEDataSet?.codeName ?? null,
  }));
}

function appMethods(codeName) {
  const item = appEntity(codeName).value;
  return item.getAllPSAppDEMethods.map(method => ({
    codeName: method.codeName, dataSetTag: method.dataSetTag ?? null,
    requestMethod: method.requestMethod ?? null, requestPath: method.requestPath ?? null,
  }));
}

export function auditM01M02ModelContracts() {
  const centerService = serviceMethods('PSDevCenter');
  const centerApp = appMethods('PSDevCenter');
  const slnService = serviceMethods('PSDevSln');
  const slnApp = appMethods('PSDevSln');
  const userService = serviceMethods('PSDevUser');
  const centralMemberQuery = readJson(
    'PSMODULES/SysDesign/PSDATAENTITIES/PSDevSln/PSDEDATAQUERIES/' +
    'CurDCSLNUser/PSDEDQCODES/MYSQL5.json',
  );
  const conds = centralMemberQuery.value.getPSDEDataQueryCodeConds?.map(row => row.customCond)
    .filter(Boolean) ?? [];
  const hasCenterContext = conds.some(cond => cond.includes('ctx.datacontext.psdevcenterid'));
  const hasCurrentPersonPredicate = conds.some(cond =>
    /PSDEVUSEROBJID|SRFPERSONID|srfpersonid/i.test(cond));
  const centerFetchDefault = centerService.filter(method => method.codeName === 'FetchDefault');
  const centerAppFetchDefault = centerApp.filter(method => method.codeName === 'FetchDefault');
  const slnFetchCurDCSLNUser = slnService.find(method => method.codeName === 'FetchCurDCSLNUser');
  const slnAppFetchCurDCSLNUser = slnApp.find(method => method.codeName === 'FetchCurDCSLNUser');
  const findings = [
    {
      id: 'M02-PSDEVCENTER-FETCHDEFAULT-MISSING',
      severity: 'BLOCKER',
      status: centerFetchDefault.length === 0 && centerAppFetchDefault.length === 1 ? 'CONFIRMED' : 'NOT-CONFIRMED',
      evidence: {
        appEntity: appEntity('PSDevCenter').path,
        appEntitySha256: appEntity('PSDevCenter').sha256,
        appFetchDefault: centerAppFetchDefault,
        serviceEntity: entity('PSDevCenter').path,
        serviceEntitySha256: entity('PSDevCenter').sha256,
        publishedServiceMethods: centerService,
        serviceFetchDefault: centerFetchDefault,
      },
      implication: 'A native PSDevCenter FetchDefault request cannot resolve to a published ModelAPI method; current HTTP 500 is a model/API contract gap, not an empty dataset.',
      safeCandidate: 'Either remove the app FetchDefault declaration and use the reviewed published read method, or add a real PSDevCenter FetchDefault service method plus request/response/permission tests. Do not map it to PSDevUser or synthesize an empty page.',
      nativeRequest: {
        method: 'POST',
        path: '/api/ibizmodeling__modeldesign/psdevcenters/fetchdefault',
        expectedCurrentOutcome: 'HTTP 500 is retained as a failure until the service method exists and is deployed.',
      },
    },
    {
      id: 'M01-CURDCSLNUSER-MEMBER-ISOLATION',
      severity: 'BLOCKER',
      status: slnFetchCurDCSLNUser && slnAppFetchCurDCSLNUser && hasCenterContext
        ? (hasCurrentPersonPredicate ? 'PARTIAL-CURRENT-PERSON-PREDICATE' : 'CONFIRMED-MISSING-CURRENT-PERSON-PREDICATE')
        : 'NOT-CONFIRMED',
      evidence: {
        serviceEntity: entity('PSDevSln').path,
        serviceEntitySha256: entity('PSDevSln').sha256,
        serviceMethod: slnFetchCurDCSLNUser,
        appEntity: appEntity('PSDevSln').path,
        appEntitySha256: appEntity('PSDevSln').sha256,
        appMethod: slnAppFetchCurDCSLNUser,
        query: centralMemberQuery.path,
        querySha256: centralMemberQuery.sha256,
        conditions: conds,
        hasCenterContext,
        hasCurrentPersonPredicate,
      },
      implication: 'The published query requires a selected center context and only checks that any member row exists for a solution; a 200 empty array is not proof of current-user membership isolation.',
      safeCandidate: 'Keep the exact POST route and add a reviewed current-person predicate bound to the native session context, then test same-center member, same-center nonmember, cross-center and anonymous reads with persistence/no-side-effect checks. Do not add person headers in the client or treat a nonempty response as permission proof.',
      nativeRequest: {
        method: 'POST',
        path: '/api/ibizmodeling__central/psdevslns/fetchcurdcslnuser',
        body: { page: 0, size: 1000 },
        requiredContext: 'ctx.datacontext.psdevcenterid from native selected-center context',
        acceptance: '200 nonempty rows only after current-user and center isolation are independently verified.',
      },
    },
  ];
  return {
    contract: 'm01-m02-readonly-model-contract-audit-v1',
    generatedAt: new Date().toISOString(),
    workspace,
    source: {
      modelRoot,
      systemSha256: readJson('PSSYSSERVICEAPIS/ModelAPI.json').sha256,
      files: [
        entity('PSDevCenter'), entity('PSDevSln'), entity('PSDevUser'),
        appEntity('PSDevCenter'), appEntity('PSDevSln'), centralMemberQuery,
      ],
    },
    findings,
    runtimeEvidence: {
      m01: {
        report: '.artifacts/m01-native-navigation-20261125-r4/report.private.json',
        sha256: '26fa5a0ea2796849aaa39c84de4abf397d286ffb9121673a30e45fbe50e8c2cb',
        observed: 'native organization/appdata/menu pass; CurDCSLNUser returned 200 empty; full center/member workflow open',
      },
      m02: {
        report: '.artifacts/m02-modeling-center-context-20261126-r1/report.private.json',
        sha256: '62e241bce5dc1b838359f5c51544527d5cd21c2b1e8cb612526ce0853aacaacc',
        observed: 'PSDevCenter FetchDefault returned HTTP 500 with 106-byte body; no alternate route or write attempted',
      },
    },
    writes: 0,
    sharedRequests: 0,
    dockerOperations: 0,
    status: findings.every(finding => finding.status === 'CONFIRMED' || finding.status === 'CONFIRMED-MISSING-CURRENT-PERSON-PREDICATE')
      ? 'BLOCKED-CONTRACT-GAPS-READONLY' : 'PARTIAL-CONTRACT-AUDIT',
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = auditM01M02ModelContracts();
  const output = process.argv[2];
  if (output) {
    fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
    fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  }
  console.log(JSON.stringify({ status: report.status, findings: report.findings.map(f => [f.id, f.status]), writes: 0 }));
}
