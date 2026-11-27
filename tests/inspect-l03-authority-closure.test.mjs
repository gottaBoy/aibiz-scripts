import assert from 'node:assert/strict';
import test from 'node:test';
import { inspectL03AuthorityClosure } from '../inspect-l03-authority-closure.mjs';

test('L03 authority closure retains the two missing DTO declarations and one unresolved nested target', () => {
  const report = inspectL03AuthorityClosure();
  assert.equal(report.candidate.status, 'BLOCKED_NO_AUTHORITATIVE_FIELD_DEFINITION');
  assert.equal(report.counts.unresolvedMethodDTODeclarations, 2);
  assert.equal(report.counts.unresolvedNestedDTOReferences, 1);
  assert.deepEqual(report.candidate.idea.forbiddenGuess.sort(),
    ['customer_score', 'customer_score_precent'].sort());
  assert.deepEqual(report.candidate.nested.forbiddenGuess.sort(),
    ['diagnostic_payload', 'searchconds item fields'].sort());
  assert.equal(report.sourceConsensus.vendorUpstreamMatchesCurrent, true);
  assert.equal(report.sourceConsensus.publishedFrontendRetainsMissingDTO, true);
});
