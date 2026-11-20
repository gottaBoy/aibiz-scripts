import assert from 'node:assert/strict';
import test from 'node:test';
import { startupCellPassed, startupCells, verifyLoginLanguageSwitch } from '../check-plm-source-startup.mjs';

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

test('requested language switching cannot pass from a clean startup alone', () => {
  assert.equal(startupCellPassed({ ...clean(), languageSwitchRequested: true }), false);
  assert.equal(startupCellPassed({
    ...clean(), languageSwitchRequested: true, languageSwitchVerified: false,
  }), false);
  assert.equal(startupCellPassed({
    ...clean(), languageSwitchRequested: true, languageSwitchVerified: true,
  }), true);
});

function languagePage({ resetAfterRefresh = false } = {}) {
  let language = 'zh-CN';
  let menu = false;
  let pendingLanguage;
  const operations = [];
  const page = {
    getByRole(role, options) {
      assert.equal(options.exact, true);
      return { async click(...args) {
        assert.deepEqual(args, [], 'ordinary clicks must not use force');
        if (role === 'button') {
          assert.equal(options.name, 'Language / 语言');
          menu = true;
          operations.push('open-menu');
        } else {
          assert.equal(role, 'menuitem');
          assert.equal(menu, true);
          pendingLanguage = options.name === 'English' ? 'en' : 'zh-CN';
          menu = false;
          operations.push(`select-${pendingLanguage}`);
        }
      } };
    },
    async waitForFunction(_condition, requested) { assert.equal(language, requested); },
    async waitForLoadState(state) { assert.equal(state, 'networkidle'); },
    locator(selector) {
      if (selector === '.el-message-box.ibiz-confirm') return {
        async waitFor(options) {
          assert.equal(options.state, 'visible');
          assert.ok(pendingLanguage);
        },
        getByRole(role, options) {
          assert.equal(role, 'button');
          assert.ok(options.name.test('OK'));
          return { async click(...args) {
            assert.deepEqual(args, []);
            assert.ok(pendingLanguage);
            language = pendingLanguage;
            pendingLanguage = undefined;
            operations.push('confirm');
          } };
        },
      };
      if (selector === '.plm-language-switch__label') return {
        async textContent() { return language === 'en' ? 'English' : '中文'; },
      };
      if (selector === 'html') return {
        async getAttribute(name) { assert.equal(name, 'lang'); return language; },
      };
      assert.equal(selector, 'input[type="password"]');
      return { first: () => ({ isVisible: async () => true }) };
    },
    async reload(options) {
      assert.equal(options.waitUntil, 'networkidle');
      operations.push('reload');
      if (resetAfterRefresh) language = 'zh-CN';
    },
  };
  return { page, operations };
}

test('language workflow uses ordinary menu clicks and verifies both directions after refresh', async () => {
  const fixture = languagePage();
  const screenshots = [];
  const result = await verifyLoginLanguageSwitch(fixture.page, 'zh-CN',
    name => screenshots.push(name));
  assert.deepEqual(result, [
    { target: 'en', confirmationAccepted: true, changed: true, persistedAfterRefresh: true },
    { target: 'zh-CN', confirmationAccepted: true, changed: true, persistedAfterRefresh: true },
  ]);
  assert.deepEqual(fixture.operations,
    ['open-menu', 'select-en', 'confirm', 'reload', 'open-menu', 'select-zh-CN', 'confirm', 'reload']);
  assert.deepEqual(screenshots,
    ['confirmation-en', 'switched-en', 'confirmation-zh-CN', 'switched-zh-CN']);
});

test('a language that resets on refresh never receives successful workflow evidence', async () => {
  const fixture = languagePage({ resetAfterRefresh: true });
  await assert.rejects(verifyLoginLanguageSwitch(fixture.page, 'zh-CN', () => {}),
    /must survive a normal refresh/);
});
