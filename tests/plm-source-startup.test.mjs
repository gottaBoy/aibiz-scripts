import assert from 'node:assert/strict';
import test from 'node:test';
import { startupCellPassed, startupCells } from '../check-plm-source-startup.mjs';

test('startup matrix covers both languages on desktop/mobile without claiming native acceptance', () => {
  const cells = startupCells();
  assert.equal(cells.length, 4);
  assert.equal(new Set(cells.map(cell => `${cell.language}/${cell.device}`)).size, 4);
});

const clean = () => ({
  loginVisible: true, entryIdentityVerified: true, closed: true,
  pageErrors: [], consoleErrors: [], httpErrors: [], failedRequests: [],
  externalRequests: [], errors: [],
});

test('only a clean, closed, byte-bound actual startup can pass', () => {
  assert.equal(startupCellPassed(clean()), true);
  for (const field of ['loginVisible', 'entryIdentityVerified', 'closed']) {
    assert.equal(startupCellPassed({ ...clean(), [field]: false }), false, field);
  }
  for (const field of ['pageErrors', 'consoleErrors', 'httpErrors', 'failedRequests',
    'externalRequests', 'errors']) {
    assert.equal(startupCellPassed({ ...clean(), [field]: ['retained failure'] }), false, field);
  }
});
