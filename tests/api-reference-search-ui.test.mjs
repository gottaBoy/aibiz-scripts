import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const require = createRequire(new URL('../../ibiz-app-hub/package.json', import.meta.url));
const { Window } = require('happy-dom');
const script = await readFile(new URL('../../plm/doc/docsify/script/aibiz-api-reference.js', import.meta.url), 'utf8');

async function searchFixture(t, { body = '访问密码', segmenter = true } = {}) {
  const window = new Window({ url: 'http://127.0.0.1/doc/#/api-reference/zh-CN/entities/article_page' });
  t.after(() => window.close());
  window.document.body.innerHTML = '<aside class="sidebar"></aside>';
  window.$docsify = {};
  let render;
  runInNewContext(script, {
    window, document: window.document, location: window.location,
    localStorage: window.localStorage, sessionStorage: window.sessionStorage, URLSearchParams,
    Intl: segmenter === 'missing-intl' ? undefined : segmenter ? Intl : {},
    fetch: async () => ({
      ok: true,
      json: async () => ({
        schemaVersion: 2, language: 'zh-CN', contractSha256: 'a'.repeat(64),
        entries: [{ label: '访问密码', code: 'article_page', keywords: 'article_page',
          body, path: '#/api-reference/zh-CN/entities/article_page?id=fields-1234567890abcdef' }],
      }),
    }),
  });
  window.$docsify.plugins[0]({ doneEach(callback) { render = callback; } });
  render();
  await new Promise(resolve => setImmediate(resolve));
  const input = window.document.querySelector('[data-aibiz-api-search]');
  assert.equal(input.disabled, false);
  input.value = 'article_page';
  input.dispatchEvent(new window.Event('input'));
  const result = window.document.querySelector('[data-aibiz-api-results] a');
  assert.ok(result);
  let navigations = 0;
  window.document.querySelector('[data-aibiz-api-results]').addEventListener('click', event => {
    if (event.target.closest('a')) { event.preventDefault(); navigations += 1; }
  });
  return { window, input, navigations: () => navigations };
}

test('IME candidate confirmation never opens a documentation search result', async t => {
  for (const mode of ['composition-lifecycle', 'isComposing', 'legacy-keycode']) {
    await t.test(mode, async t => {
      const fixture = await searchFixture(t);
      const { window, input } = fixture;
      if (mode === 'composition-lifecycle') input.dispatchEvent(new window.CompositionEvent('compositionstart'));
      const event = new window.KeyboardEvent('keydown', {
        key: 'Enter', bubbles: true, cancelable: true,
        ...(mode === 'isComposing' ? { isComposing: true } : {}),
        ...(mode === 'legacy-keycode' ? { keyCode: 229 } : {}),
      });
      input.dispatchEvent(event);
      assert.equal(fixture.navigations(), 0, 'Confirming an IME candidate must not navigate');
      assert.equal(event.defaultPrevented, false, 'The browser retains the composition key');
      if (mode === 'composition-lifecycle') input.dispatchEvent(new window.CompositionEvent('compositionend'));
      input.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
      assert.equal(fixture.navigations(), 1, 'A normal Enter still follows the first result');
    });
  }
});

test('normalization changes never displace the matched original text from its search snippet', async t => {
  for (const [name, prefix] of [
    ['NFKC expansion', 'ﬃ'.repeat(100)],
    ['combining contraction', 'e\u0301'.repeat(200)],
    ['lowercase expansion', 'İ'.repeat(150)],
  ]) await t.test(name, async t => {
    const { window, input } = await searchFixture(t, { body: `${prefix} needle ${'x'.repeat(250)}` });
    input.value = 'NEEDLE';
    input.dispatchEvent(new window.Event('input'));
    const snippet = window.document.querySelector('.aibiz-api-search-snippet').textContent;
    assert.ok(snippet.includes('needle'), 'The displayed window contains the actual match');
    assert.ok(snippet.includes(prefix.slice(0, prefix.length > 1 ? 2 : 1)),
      'The display preserves the source form instead of replacing it with normalized text');
  });
});

test('snippet limits preserve complete emoji and combining graphemes', async t => {
  for (const grapheme of ['🙂', '👩🏽‍💻', 'e\u0301']) await t.test(grapheme, async t => {
    const { window } = await searchFixture(t, { body: `${'x'.repeat(179)}${grapheme}suffix` });
    const snippet = window.document.querySelector('.aibiz-api-search-snippet').textContent;
    assert.equal(snippet.isWellFormed(), true, 'A snippet cannot end with an isolated UTF-16 surrogate');
    assert.equal(snippet, `${'x'.repeat(179)}${grapheme}…`);
  });
});

test('without Intl.Segmenter short text stays whole and long previews are omitted without losing search navigation', async t => {
  for (const segmenter of [false, 'missing-intl']) for (const body of [
    '🙂 e\u0301 👩🏽‍💻', `${'x'.repeat(179)}👩🏽‍💻suffix`,
  ]) await t.test(`${segmenter || 'missing-Segmenter'}/${body.length < 180 ? 'short' : 'long'}`, async t => {
    const fixture = await searchFixture(t, { body, segmenter });
    const snippet = fixture.window.document.querySelector('.aibiz-api-search-snippet');
    if (body.length <= 180) assert.equal(snippet.textContent, body);
    else assert.equal(snippet, null, 'The fallback does not cut Unicode or render an unbounded body');
    fixture.input.dispatchEvent(new fixture.window.KeyboardEvent('keydown', { key: 'Enter', cancelable: true }));
    assert.equal(fixture.navigations(), 1);
  });
});
