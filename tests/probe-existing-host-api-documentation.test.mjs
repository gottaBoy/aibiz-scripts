import assert from 'node:assert/strict';
import test from 'node:test';
import {
  existingHostDocumentRequest, validateAppliedDocumentation,
} from '../probe-existing-host-api-documentation.browser.mjs';

test('shared documentation probes use only the observed static prefix and never business APIs or an alternate server', () => {
  for (const relative of ['index.html', 'script/docsify.js', 'api-reference/en/search.json']) {
    assert.equal(existingHostDocumentRequest(`http://127.0.0.1:30250/ibizplm-plmweb/doc/${relative}`, 'GET'), true);
  }
  for (const [url, method] of [
    ['http://127.0.0.1:30250/doc/', 'GET'],
    ['http://127.0.0.1:30250/api/ibizplm__plmweb/products', 'GET'],
    ['http://127.0.0.1:4173/ibizplm-plmweb/doc/', 'GET'],
    ['http://127.0.0.1:30250/ibizplm-plmweb/doc/index.html', 'POST'],
    ['https://example.invalid/doc/', 'GET'],
  ]) assert.equal(existingHostDocumentRequest(url, method), false);
});

test('actual served-document verification requires a complete matching apply receipt and retains parent gates', () => {
  const plan = { contract: 'api-documentation-exact-install-v1', epoch: 'own-epoch', releaseSha256: 'release',
    targets: Object.fromEntries(['host', 'container'].map(scope => [scope, [{ path: 'index.html', candidate: { sha256: 'new' } }]])) };
  const apply = { contract: 'api-documentation-exact-apply-v1',
    status: 'APPLIED-STATIC-DOCUMENTATION-NATIVE-ACCEPTANCE-PENDING', epoch: plan.epoch,
    planSha256: 'plan', releaseSha256: plan.releaseSha256, parentAcceptance: false, recovery: [], transportErrors: [],
    ledger: ['host', 'container'].map(scope => ({ scope, path: 'index.html', installed: true, restoring: false, staged: { sha256: 'new' } })) };
  validateAppliedDocumentation(plan, apply, 'plan');
  for (const change of [
    value => { value.status = 'FAILED-MUTATION-CONDITIONAL-RECOVERY'; },
    value => { value.parentAcceptance = true; },
    value => { value.ledger.pop(); },
    value => { value.ledger[0].staged.sha256 = 'different'; },
    value => { value.transportErrors.push({ reason: 'lost response' }); },
    value => { value.error = 'hidden error'; },
  ]) {
    const value = structuredClone(apply); change(value);
    assert.throws(() => validateAppliedDocumentation(plan, value, 'plan'));
  }
});
