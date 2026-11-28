#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { captionHtmlEntries } from './prepare-plm-caption-entry.mjs';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = path.join(workspace, '.artifacts');
const require = createRequire(path.join(workspace, 'plm-web/package.json'));
const postcss = createRequire(require.resolve('vite/package.json'))('postcss');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
export const developmentLayoutSourcePaths = Object.freeze([
  'plm-web/src/runtime/development-layout.css', 'plm-web/src/main.ts',
]);
export const developmentLayoutToolPaths = Object.freeze([
  'scripts/prepare-plm-development-layout.mjs',
  'scripts/deploy-existing-plm-development-layout.mjs',
  'scripts/tests/prepare-plm-development-layout.test.mjs',
  'scripts/tests/deploy-existing-plm-development-layout.test.mjs',
  'scripts/deploy-existing-plm-language-runtime.mjs',
  'scripts/tests/deploy-existing-plm-language-runtime.test.mjs',
  'scripts/deploy-existing-plm-notification-style.mjs',
  'scripts/deploy-existing-plm-guard-overlay.mjs',
  'scripts/prepare-plm-language-runtime-candidate.mjs',
  'scripts/prepare-plm-caption-entry.mjs',
  'scripts/prepare-plm-guard-overlay.mjs',
]);

export function assertDevelopmentLayoutCss(bytes) {
  const root = postcss.parse(bytes.toString('utf8'));
  assert.equal(root.nodes.length, 1, 'Only the mobile media query is eligible');
  const media = root.nodes[0];
  assert.equal(media.type, 'atrule');
  assert.equal(media.name, 'media');
  assert.equal(media.params, '(max-width: 767px)');
  assert.equal(media.nodes.length, 3);
  const expected = [
    ['.second_dev_tab_style .ibiz-panel-view-header',
      [['height', 'auto'], ['flex-shrink', '0']]],
    ['.second_dev_tab_style .ibiz-panel-view-header > .ibiz-row',
      [['flex-direction', 'column'], ['height', 'auto']]],
    ['.second_dev_tab_style .ibiz-panel-view-header > .ibiz-row > .ibiz-col',
      [['flex', '0 0 auto'], ['width', '100%'], ['min-width', '0']]],
  ];
  media.nodes.forEach((rule, index) => {
    assert.equal(rule.type, 'rule');
    assert.equal(rule.selector, expected[index][0]);
    assert.deepEqual(rule.nodes.map(node => {
      assert.equal(node.type, 'decl');
      assert.equal(Boolean(node.important), false);
      return [node.prop, node.value];
    }), expected[index][1]);
  });
}

export function rewriteDevelopmentLayoutIndex(original, cssPath) {
  assert.match(cssPath, /^static\/css\/plm-development-layout-[a-f0-9]{16}\.css$/);
  const html = original.toString('utf8');
  assert.ok(!html.includes('plm-development-layout-'), 'A development layout is already referenced');
  assert.equal(html.split('</head>').length, 2);
  const result = Buffer.from(html.replace('</head>',
    `  <link rel="stylesheet" href="./${cssPath}">\n  </head>`));
  assert.deepEqual(captionHtmlEntries(result.toString('utf8')), captionHtmlEntries(html));
  return result;
}

function sourceRead(filename) {
  assert.equal(fs.realpathSync(filename), filename);
  const descriptor = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const before = fs.fstatSync(descriptor);
    assert.ok(before.isFile() && before.nlink === 1);
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor);
    for (const key of ['ino', 'dev', 'size', 'mtimeMs', 'ctimeMs']) assert.equal(after[key], before[key]);
    return { bytes, sha256: digest(bytes), metadata: Object.fromEntries(
      ['ino', 'dev', 'size', 'mtimeMs', 'ctimeMs'].map(key => [key, after[key]])) };
  } finally { fs.closeSync(descriptor); }
}

export function prepareDevelopmentLayout({ output }) {
  assert.ok(output && path.isAbsolute(output));
  assert.equal(fs.realpathSync(path.dirname(output)), artifacts);
  assert.match(path.basename(output), /^plm-development-layout-candidate-[a-z0-9-]+$/);
  const paths = [...developmentLayoutSourcePaths, ...developmentLayoutToolPaths, 'plm-web/dist/index.html'];
  const inputs = new Map(paths.map(relative => [relative, sourceRead(path.join(workspace, relative))]));
  const css = inputs.get(developmentLayoutSourcePaths[0]).bytes;
  assertDevelopmentLayoutCss(css);
  const main = inputs.get(developmentLayoutSourcePaths[1]).bytes.toString('utf8');
  assert.equal(main.split("import './runtime/development-layout.css';").length, 2);
  const originalIndex = inputs.get('plm-web/dist/index.html').bytes;
  const entries = captionHtmlEntries(originalIndex.toString('utf8'));
  const mapSourcePath = `plm-web/dist/${entries.importMap}`;
  const map = sourceRead(path.join(workspace, mapSourcePath));
  inputs.set(mapSourcePath, map);
  JSON.parse(map.bytes);
  const revision = digest(css).slice(0, 16);
  const cssPath = `static/css/plm-development-layout-${revision}.css`;
  const index = rewriteDevelopmentLayoutIndex(originalIndex, cssPath);
  for (const [relative, input] of inputs) {
    const current = sourceRead(path.join(workspace, relative));
    assert.deepEqual(current, input, `Input changed during preparation: ${relative}`);
  }
  fs.mkdirSync(output, { mode: 0o700 });
  const write = (relative, bytes) => {
    const filename = path.join(output, relative);
    fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
    const descriptor = fs.openSync(filename, 'wx', 0o600);
    try { fs.writeFileSync(descriptor, bytes); fs.fsyncSync(descriptor); }
    finally { fs.closeSync(descriptor); }
    return { path: relative, bytes: bytes.length, sha256: digest(bytes) };
  };
  const files = [
    write(`overlay/${cssPath}`, css), write('overlay/index.html', index),
  ].map(file => ({ ...file, path: file.path.slice('overlay/'.length) }));
  write('rollback/index.html', originalIndex);
  write(`rollback/${entries.importMap}`, map.bytes);
  const sourceFiles = developmentLayoutSourcePaths.map(relative => {
    write(`snapshot/${relative}`, inputs.get(relative).bytes);
    return { path: relative, sha256: inputs.get(relative).sha256 };
  });
  const tools = developmentLayoutToolPaths.map(relative => ({
    sourcePath: relative, ...write(`tools/${relative}`, inputs.get(relative).bytes),
  }));
  const manifest = {
    contract: 'plm-development-layout-candidate-v1', status: 'PREPARED-NOT-PUBLISHED',
    revision, cssPath, files, sourceFiles, tools, source: [], inherited: [],
    activeOriginalEntries: entries, originalIndexSha256: digest(originalIndex),
    originalMapSha256: map.sha256, mobileOnly: true, runtimeRebuild: false,
    originalApplicationEntryPreserved: true, originalImportMapPreserved: true,
    deployed: false, sharedWrites: 0, functionalAcceptance: false,
  };
  for (const [relative, input] of inputs) {
    assert.deepEqual(sourceRead(path.join(workspace, relative)), input,
      `Input changed while writing the private candidate: ${relative}`);
  }
  write('development-layout-candidate.private.json', json(manifest));
  return { ...manifest, manifestSha256: digest(json(manifest)) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ strict: true, options: { output: { type: 'string' } } });
  try {
    const result = prepareDevelopmentLayout(values);
    console.log(JSON.stringify({ status: result.status, manifestSha256: result.manifestSha256,
      files: result.files, sharedWrites: 0, deployed: false }));
  } catch (error) { console.error(error.stack); process.exitCode = 1; }
}
