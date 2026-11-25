import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { createRequire } from 'node:module';
import test from 'node:test';

const workspace = path.resolve(new URL('../..', import.meta.url).pathname);
const require = createRequire(path.join(workspace, 'ibiz-app-hub/package.json'));
const ts = require('typescript');
const { Window } = require('happy-dom');
const sources = [
  'ibiz-app-hub/components/ibiz-next-vue3/src/util/user-message-util/internal-message-locale.ts',
  'ibiz-app-hub/components/ibiz-next-mob-vue3/src/panel-component/user-message/internal-message-locale.ts',
];
const functions = sources.map(relative => {
  const source = fs.readFileSync(path.join(workspace, relative), 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
    reportDiagnostics: true, fileName: relative,
  });
  assert.deepEqual(compiled.diagnostics, []);
  const window = new Window();
  const exports = {};
  vm.runInNewContext(compiled.outputText, {
    exports, DOMParser: window.DOMParser, document: window.document,
  }, { filename: relative });
  return exports.localizeInternalMessageHtml;
});
const cases = [
  ['product_member_create', '把你加入了产品', 'Added you to the product'],
  ['product_member_remove', '把你移除了产品', 'Removed you from the product'],
  ['product_archived_or_activate', '归档了产品', 'Archived the product'],
  ['product_archived_or_activate', '激活了产品', 'Activated the product'],
  ['product_remove_or_recover', '删除了产品', 'Deleted the product'],
  ['product_remove_or_recover', '恢复了产品', 'Restored the product'],
];
const name = '产品管理 把你加入了产品 🙂 e\u0301 " \' \\ \n';
const card = event => `<div class="notice-card"><span class="notice-card__event-name">产品管理</span>` +
  `<span class="notice-card__event-desc">${event}</span>` +
  `<span class="notice-card__object-id">ORIGINAL-ID</span>` +
  `<span class="notice-card__object-name" title="unchanged-attribute">` +
  name.replaceAll('&', '&amp;').replaceAll('<', '&lt;') + '</span>' +
  '<span class="notice-pilot-time">2026-11-24 12:34:56</span>' +
  '<span class="notice-pilot-info"> · 产品管理 · 产品管理</span></div>';

test('both real utility sources translate the six declared product events in English', () => {
  for (const localize of functions) {
    for (const [type, event, expected] of cases) {
      const raw = card(event);
      for (const language of ['en', 'en-US', 'EN_gb']) {
        const localized = localize(raw, language, type);
        const document = new Window().document;
        document.body.innerHTML = localized;
        assert.equal(document.querySelector('.notice-card__event-desc').textContent, expected);
        assert.equal(document.querySelector('.notice-pilot-info').textContent, ' · Product Management · 产品管理');
        assert.equal(document.querySelector('.notice-card__object-name').textContent, name);
        assert.equal(document.querySelector('.notice-card__event-name').textContent, '产品管理');
        assert.equal(document.querySelector('.notice-card__object-id').textContent, 'ORIGINAL-ID');
        assert.equal(document.querySelector('.notice-pilot-time').textContent, '2026-11-24 12:34:56');
        assert.equal(document.querySelector('.notice-card__object-name').getAttribute('title'), 'unchanged-attribute');
      }
      assert.equal(raw, card(event));
      assert.equal(functions[0](raw, 'en', type), functions[1](raw, 'en', type));
    }
  }
});

test('Chinese, unknown templates, mismatched events and custom names remain byte-identical', () => {
  for (const localize of functions) {
    const raw = card('把你加入了产品');
    for (const lang of ['zh-CN', 'zh_CN', 'zh', 'fr', '']) assert.equal(localize(raw, lang, 'product_member_create'), raw);
    for (const type of ['custom', '', 'idea_assignee', 'product_member_remove', '__proto__', 'constructor']) {
      assert.equal(localize(raw, 'en', type), raw);
    }
    const unknown = card('自定义通知：把你加入了产品');
    assert.equal(localize(unknown, 'en', 'product_member_create'), unknown);
    assert.equal(localize('', 'en', 'product_member_create'), '');
  }
});

test('ambiguous or nested event markup is retained without rewriting user-controlled descendants', () => {
  for (const localize of functions) {
    for (const raw of [
      card('<strong>把你加入了产品</strong>'),
      card('把你加入了产品') + card('把你加入了产品'),
      '<code>' + card('把你加入了产品') + '</code>',
      '<span class="notice-card__event-desc">把你加入了产品</span>',
    ]) assert.equal(localize(raw, 'en', 'product_member_create'), raw);
  }
});

test('pilot translation matches only the fixed leading category and preserves any later same-name product text', () => {
  for (const localize of functions) {
    const raw = card('把你加入了产品');
    for (const pilot of ['用户产品管理文本', ' · Other · 产品管理', '产品管理用户文本']) {
      const input = raw.replace(' · 产品管理 · 产品管理', pilot);
      const document = new Window().document;
      document.body.innerHTML = localize(input, 'en', 'product_member_create');
      assert.equal(document.querySelector('.notice-pilot-info').textContent, pilot);
    }
  }
});

test('desktop leaf/group and native mobile provider invoke the same template-aware display contract', () => {
  for (const relative of [
    'ibiz-app-hub/components/ibiz-next-vue3/src/panel-component/user-message/internal-message/internal-message-html/internal-message-html.tsx',
    'ibiz-app-hub/components/ibiz-next-vue3/src/panel-component/user-message/internal-message/internal-message-group/internal-message-group.tsx',
    'ibiz-app-hub/components/ibiz-next-mob-vue3/src/panel-component/user-message/internal-message-html/internal-message-html.tsx',
  ]) {
    const source = fs.readFileSync(path.join(workspace, relative), 'utf8');
    assert.match(source, /localizeInternalMessageHtml\(/);
    assert.match(source, /ibiz\.i18n\.getLang\(\)/);
    assert.match(source, /props\.message\.message_type/);
    assert.doesNotMatch(source, /props\.message\.content\s*=/);
  }
});
