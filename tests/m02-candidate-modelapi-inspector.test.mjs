import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectM02ModelApiCandidate } from '../m02-candidate-modelapi-inspector.mjs';

test('M02 publishes a PSDevCenter FetchDefault PAGE contract matching its peer entities', () => {
  const report = inspectM02ModelApiCandidate();
  assert.equal(report.status, 'SOURCE-CONTRACT-IMPLEMENTED-M02-RUNTIME-PENDING-M01-PREDICATE-ONLY-PARTIAL');
  const m02 = report.findings.m02;
  assert.equal(m02.status, 'SOURCE-CONTRACT-IMPLEMENTED-NOT-DEPLOYED');
  assert.equal(m02.serviceMethod.codeName, 'FetchDefault');
  assert.equal(m02.serviceMethod.dataAccessAction, 'READ');
  assert.equal(m02.serviceMethod.methodType, 'FETCH');
  assert.equal(m02.serviceMethod.dataSet, 'Default');
  assert.equal(m02.serviceMethod.inputDto, 'PSDevCenterFilterDTO');
  assert.equal(m02.serviceMethod.returnType, 'PAGE');
  assert.equal(m02.serviceMethod.returnDto, 'PSDevCenterDTO');
  assert.equal(m02.serviceMethod.requestMethod, 'POST');
  assert.equal(m02.appMethod.codeName, 'FetchDefault');
  for (const peer of m02.peerFetchDefaultContracts) {
    assert.equal(peer.serviceMethod.requestMethod, 'POST');
    assert.equal(peer.serviceMethod.dataAccessAction, 'READ');
    assert.equal(peer.serviceMethod.methodType, 'FETCH');
    assert.equal(peer.serviceMethod.returnType, 'PAGE');
  }
  assert.deepEqual(m02.defaultQuery.selectedFields,
    ['CREATEDATE', 'CREATEMAN', 'PSDEVCENTERID', 'PSDEVCENTERNAME', 'UPDATEDATE', 'UPDATEMAN']);
  assert.equal(m02.defaultQuery.excludesCredentialFields, true);
});

test('M01 can reuse only the current-person predicate shape, while authorization semantics remain open', () => {
  const report = inspectM02ModelApiCandidate();
  const m01 = report.findings.m01;
  assert.equal(m01.status, 'PARTIAL-REUSABLE-PERSON-PREDICATE');
  assert.equal(m01.currentMemberHasPersonPredicate, false);
  assert.equal(m01.currentMemberHasCenterContext, true);
  assert.ok(m01.reusableSource.conditions.some(value => value.includes('PSDEVUSEROBJID')));
  for (const required of ['ALLSYSFLAG=0', 'EXPIREDTIME', 'ACCMODE', 'PSDEVSLNSYSID']) {
    assert.ok(m01.missingAuthorizationSemantics.some(value => value.includes(required)));
  }
});

test('candidate inspector performs no writes or live service operations', () => {
  const report = inspectM02ModelApiCandidate();
  assert.equal(report.writes, 0);
  assert.equal(report.sharedRequests, 0);
  assert.equal(report.dockerOperations, 0);
  assert.equal(report.sourceModified, false);
});
