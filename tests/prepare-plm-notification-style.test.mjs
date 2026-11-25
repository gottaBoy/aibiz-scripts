import assert from 'node:assert/strict';
import test from 'node:test';
import {
  addNotificationStyleLink, compileNotificationStyles, scopeNotificationCss,
} from '../prepare-plm-notification-style.mjs';

test('the narrow stylesheet scopes descendants and gives the real popover a stronger selector than later base CSS', () => {
  const result = scopeNotificationCss('.ibiz-user-message { width: 1px; }' +
    '.ibiz-user-message-popover { width:min(500px,calc(100vw - 24px)) !important; }' +
    '.ibiz-internal-message-group__action { z-index: 1; }' +
    '@media(hover:none) { .ibiz-internal-message-container-toolbar { display:flex; } }');
  assert.ok(!result.includes('.ibiz-user-message {'));
  assert.ok(result.includes('.ibiz-user-message-popover.el-popover {'));
  assert.ok(result.includes('.ibiz-user-message-popover.el-popover .ibiz-internal-message-group__action'));
  assert.ok(result.includes('.ibiz-user-message-popover.el-popover .ibiz-internal-message-container-toolbar'));
  assert.throws(() => scopeNotificationCss('@import "https://outside.example/style.css";'));
  assert.throws(() => scopeNotificationCss('.ibiz-user-message-popover { background:url("https://outside.example/pixel"); }'));
});

test('candidate HTML adds only one hash-named local stylesheet link while preserving all existing entry bytes', () => {
  const html = '<!doctype html><html><head><script src="./unchanged.js"></script></head><body></body></html>';
  const css = 'static/css/plm-notification-0123456789abcdef.css';
  const result = addNotificationStyleLink(html, css);
  assert.equal(result.replace(`    <link rel="stylesheet" href="./${css}" />\n  `, ''), html);
  for (const target of ['../outside.css', 'https://outside.example/style.css', 'static/css/unknown.css']) {
    assert.throws(() => addNotificationStyleLink(html, target));
  }
  assert.throws(() => addNotificationStyleLink(result, css));
  assert.throws(() => addNotificationStyleLink('<html><body></body></html>', css));
});

test('the candidate compiles the three actual SCSS sources with real theme mixins and records their inputs', () => {
  const output = compileNotificationStyles();
  assert.equal(output.sources.length, 3);
  assert.ok(output.dependencies.some(input => input.path.endsWith('packages/theme/style/global.scss')));
  assert.ok(output.dependencies.some(input => input.path.endsWith('packages/theme/style/tools/mixin.scss')));
  assert.ok(output.css.includes('100vw - 24px'));
  assert.ok(output.css.includes('100dvh - 24px'));
  assert.ok(output.css.includes('padding-right: calc(40px'));
  assert.ok(output.css.includes('@media (hover: none) and (pointer: coarse)'));
  assert.ok(!output.css.includes('.ibiz-user-message-notice'));
  for (const input of [...output.sources, ...output.dependencies]) assert.match(input.sha256, /^[a-f0-9]{64}$/);
});
