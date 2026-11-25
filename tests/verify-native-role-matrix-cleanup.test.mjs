import assert from 'node:assert/strict';
import test from 'node:test';
import { exactOwnIdeaCountSQL } from '../verify-native-role-matrix-cleanup.mjs';

test('cleanup physical check is a bounded exact read-only count without row data', () => {
  const sql = exactOwnIdeaCountSQL(['1234567890abcdef1234567890abcdef']);
  assert.match(sql, /^START TRANSACTION READ ONLY;/);
  assert.match(sql, /COUNT\(\*\)/);
  assert.match(sql, /BINARY `ID` IN/);
  assert.doesNotMatch(sql, /SELECT\s+\*|\b(?:DELETE|INSERT|UPDATE|DROP|ALTER)\b/i);
  assert.throws(() => exactOwnIdeaCountSQL([]));
  assert.throws(() => exactOwnIdeaCountSQL(["123';DELETE"]));
  assert.throws(() => exactOwnIdeaCountSQL(new Array(11).fill('1234567890abcdef1234567890abcdef')));
});
