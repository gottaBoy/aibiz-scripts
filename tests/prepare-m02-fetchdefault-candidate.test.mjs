import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareM02FetchDefaultCandidate } from '../prepare-m02-fetchdefault-candidate.mjs';

test('M02 source contract is structurally complete but refuses runtime acceptance before deployment', () => {
  const report = prepareM02FetchDefaultCandidate();
  assert.equal(report.status, 'SOURCE-CONTRACT-IMPLEMENTED-NOT-DEPLOYED');
  assert.equal(report.m02.serviceMethodPresent, true);
  assert.equal(report.m02.serviceMethod.codeName, 'FetchDefault');
  assert.deepEqual(report.m02.proposedServiceMethod, {
    codeName: 'FetchDefault', dataAccessAction: 'READ', methodType: 'FETCH',
    name: 'FetchDefault', getPSDEDataSet: { modelref: true, id: 'Default' },
    getPSDEServiceAPIMethodInput: {
      name: '输入对象', getPSDEMethodDTO: { modelref: true, id: 'PSDevCenterFilterDTO' }, type: 'DTO',
    },
    getPSDEServiceAPIMethodReturn: {
      name: '返回对象', getPSDEMethodDTO: { modelref: true, id: 'PSDevCenterDTO' }, type: 'PAGE',
    },
    requestMethod: 'POST',
  });
  assert.equal(report.m02.defaultDataset, 'Default');
  assert.equal(report.m02.defaultQuery.excludesCredentialFields, true);
  assert.deepEqual(report.m02.peerServices.map(peer => peer.codeName), ['PSDevUser', 'PSDevCenterDBInst']);
  for (const peer of report.m02.peerServices) {
    assert.equal(peer.method.dataAccessAction, 'READ');
    assert.equal(peer.method.methodType, 'FETCH');
    assert.equal(peer.method.requestMethod, 'POST');
    assert.equal(peer.method.returnType, 'PAGE');
  }
  assert.deepEqual(report.m02.missingGates, [
    'runtime route registration and access manager binding',
    'deployed HTTP/DTO/permission regression',
  ]);
});

test('M01 candidate keeps only the reusable person binding and explicitly refuses full authorization claims', () => {
  const report = prepareM02FetchDefaultCandidate();
  assert.equal(report.m01.deployable, false);
  assert.ok(report.m01.proposedCondition.includes('PSDEVUSEROBJID'));
  assert.ok(report.m01.proposedCondition.includes('ctx.sessioncontext.srfpersonid'));
  assert.deepEqual(report.m01.unresolvedAuthorization,
    ['ALLSYSFLAG', 'EXPIREDTIME', 'ACCMODE', 'PSDEVSLNSYSID', 'live role matrix']);
});

test('candidate preparation performs no vendor or shared writes', () => {
  const report = prepareM02FetchDefaultCandidate();
  assert.equal(report.writes, 0);
  assert.equal(report.sharedRequests, 0);
  assert.equal(report.dockerOperations, 0);
  assert.equal(report.vendorModified, false);
});
