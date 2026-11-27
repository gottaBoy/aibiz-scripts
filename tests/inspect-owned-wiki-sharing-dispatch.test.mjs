import assert from 'node:assert/strict';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { inspectOwnedWikiSharingDispatch } from '../inspect-owned-wiki-sharing-dispatch.mjs';

const workspace = path.resolve(new URL('../..', import.meta.url).pathname);

test('sealed old classes fail to return while both compiled current sources follow all 16 native cells', () => {
  const value = inspectOwnedWikiSharingDispatch({
    output: path.join(workspace, '.artifacts', `owned-wiki-dispatch-tests-${randomBytes(6).toString('hex')}`),
  });
  assert.equal(value.status, 'PASS_16_NATIVE_DISPATCH_CELLS');
  assert.equal(value.primaryCells, 16);
  assert.equal(value.HTTPExecuted, false);
  assert.equal(value.databaseExecuted, false);
  assert.equal(value.sharedRuntimeModified, false);
  assert.equal(value.businessAcceptance, false);
  assert.equal(value.sourceInputsStable, true);
  assert.equal(value.bytecodeTarget, '1.8');
  assert.deepEqual(value.compiledClasses.map(row => row.name), ['CheckShared', 'AccessPassword']);
  assert.ok(value.compiledClasses.every(row => row.classMajor === 52));
  for (const row of value.observed.sealedNative.rows) {
    assert.equal(row.resultNull, true);
    assert.deepEqual(row.trace, []);
  }
  for (const row of value.observed.currentSource.rows) {
    assert.equal(row.resultNull, false);
    assert.equal(row.resultIsOriginalDTO, true);
    assert.equal(row.effective, row.expired ? 0 : 1);
    const expected = ['RAWSFCODE1'];
    if (row.name === 'access_password' && !row.expired) expected.push(row.passwordCase ? 'PREPAREPARAM1' : 'PREPAREPARAM2');
    expected.push('END1');
    assert.deepEqual(row.trace, expected);
    assert.equal(String(row.checkPassword), row.name === 'check_shared'
      ? (row.passwordCase ? '1' : '0') : (!row.expired && row.passwordCase ? '1' : '0'));
  }
  assert.equal(value.executions.length, 3);
  assert.ok(value.executions.every(row => row.status === 0 && row.signal === null));
});
