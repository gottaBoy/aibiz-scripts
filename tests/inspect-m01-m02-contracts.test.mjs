import assert from 'node:assert/strict';
import test from 'node:test';
import { auditM01M02ModelContracts } from '../inspect-m01-m02-contracts.mjs';

test('M01/M02 audit binds the published model files and identifies both contract gaps without writes', () => {
  const report = auditM01M02ModelContracts();
  assert.equal(report.contract, 'm01-m02-readonly-model-contract-audit-v1');
  assert.equal(report.writes, 0);
  assert.equal(report.sharedRequests, 0);
  assert.equal(report.dockerOperations, 0);
  const center = report.findings.find(finding => finding.id === 'M02-PSDEVCENTER-FETCHDEFAULT-MISSING');
  assert.equal(center.status, 'CONFIRMED');
  assert.equal(center.evidence.appFetchDefault.length, 1);
  assert.equal(center.evidence.serviceFetchDefault.length, 0);
  assert.equal(center.nativeRequest.path, '/api/ibizmodeling__modeldesign/psdevcenters/fetchdefault');
  const member = report.findings.find(finding => finding.id === 'M01-CURDCSLNUSER-MEMBER-ISOLATION');
  assert.equal(member.status, 'CONFIRMED-MISSING-CURRENT-PERSON-PREDICATE');
  assert.equal(member.evidence.hasCenterContext, true);
  assert.equal(member.evidence.hasCurrentPersonPredicate, false);
  assert.equal(member.nativeRequest.path, '/api/ibizmodeling__central/psdevslns/fetchcurdcslnuser');
});

test('M01/M02 safe candidates preserve the native route and reject client identity injection', () => {
  const report = auditM01M02ModelContracts();
  for (const finding of report.findings) {
    assert.match(finding.safeCandidate, /Do not|Do not add|Do not map/);
    assert.equal(finding.nativeRequest.method, 'POST');
  }
  assert.match(report.findings.find(f => f.id.startsWith('M01')).safeCandidate, /current-person predicate/);
  assert.match(report.findings.find(f => f.id.startsWith('M02')).safeCandidate, /real PSDevCenter FetchDefault/);
});
