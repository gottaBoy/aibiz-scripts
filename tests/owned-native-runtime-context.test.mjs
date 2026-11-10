import assert from 'node:assert/strict';
import test from 'node:test';
import { ownedNativeRuntimeContext } from '../owned-native-runtime-context.mjs';

test('owned platform contexts have no implicit fixture, URL or shared deployment fallback', () => {
  let executions = 0;
  const execute = () => { executions++; throw new Error('No Docker access allowed'); };
  for (const options of [
    {}, { runId: 'shared' },
    { runId: 'f01006abcdef', deploymentInput: '/tmp/deployment-input.private.json' },
    { runId: 'f01006abcdef', deploymentInput:
      '.artifacts/native-nonadmin-fixtures/000000000000/backend-runtime-test/deployment-input.private.json' },
    { runId: 'f01006abcdef', deploymentInput:
      '.artifacts/native-nonadmin-fixtures/f01006abcdef/backend-runtime-test/shared.json' },
  ]) assert.throws(() => ownedNativeRuntimeContext({ workspace: '/workspace', execute, ...options }));
  assert.equal(executions, 0);
});
