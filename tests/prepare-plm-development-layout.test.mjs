import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  assertDevelopmentLayoutCss, developmentLayoutSourcePaths,
  prepareDevelopmentLayout, rewriteDevelopmentLayoutIndex,
} from '../prepare-plm-development-layout.mjs';
import { loadDevelopmentLayoutDeploymentCandidate } from '../deploy-existing-plm-development-layout.mjs';
import { captionHtmlEntries } from '../prepare-plm-caption-entry.mjs';

const workspace = path.resolve(new URL('../..', import.meta.url).pathname);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const css = fs.readFileSync(path.join(workspace, developmentLayoutSourcePaths[0]));
const html = Buffer.from('<!doctype html><html><head>' +
  '<script type="systemjs-importmap" src="./extras/json/current.json"></script></head><body>' +
  '<script id="vite-legacy-entry" data-src="./static/js/current.js"></script></body></html>');
const target = `static/css/plm-development-layout-${digest(css).slice(0, 16)}.css`;
function candidate(t) {
  const output = path.join(workspace, '.artifacts', `plm-development-layout-candidate-test-${randomUUID()}`);
  t.after(() => fs.rmSync(output, { recursive: true, force: true }));
  const manifest = prepareDevelopmentLayout({ output });
  return { output, manifest };
}

test('source CSS is limited to mobile Development header columns and main imports it exactly once', () => {
  assertDevelopmentLayoutCss(css);
  const main = fs.readFileSync(path.join(workspace, developmentLayoutSourcePaths[1]), 'utf8');
  assert.equal(main.split("import './runtime/development-layout.css';").length, 2);
});

test('unexpected selectors, desktop scope, imports, properties and important overrides refuse preparation', () => {
  for (const change of [
    text => text.replace('767px', '768px'),
    text => text.replace('.ibiz-view--ps_core_prd_func_second_dev_tav_exp_view', '.other_style'),
    text => text.replace('flex-direction: column', 'flex-direction: row'),
    text => text.replace('width: 100%', 'width: 100vw'),
    text => text.replace('flex-shrink: 0', 'flex-shrink: 0 !important'),
    text => text.replace('width: 100%', 'width: 100% !important'),
    text => `${text}\niframe { display: none; }`,
    text => `@import "https://example.invalid/style.css";\n${text}`,
    text => text.replace('min-width: 0;', 'min-width: 0; overflow: hidden;'),
  ]) assert.throws(() => assertDevelopmentLayoutCss(Buffer.from(change(css.toString()))));
});

test('index change is exactly one stylesheet insertion with application and import-map entries preserved', () => {
  const next = rewriteDevelopmentLayoutIndex(html, target);
  assert.deepEqual(captionHtmlEntries(next.toString()), captionHtmlEntries(html.toString()));
  assert.equal(next.toString().replace(
    `  <link rel="stylesheet" href="./${target}">\n  </head>`, '</head>'), html.toString());
  assert.throws(() => rewriteDevelopmentLayoutIndex(next, target));
  assert.throws(() => rewriteDevelopmentLayoutIndex(html, '../outside.css'));
  assert.throws(() => rewriteDevelopmentLayoutIndex(Buffer.from('<head></head></head>'), target));
});

test('private candidate binds current source and tools and contains only CSS plus root index', t => {
  const before = digest(fs.readFileSync(path.join(workspace, 'plm-web/dist/index.html')));
  const first = candidate(t);
  const second = candidate(t);
  assert.deepEqual(first.manifest, second.manifest);
  assert.equal(first.manifest.sharedWrites, 0);
  assert.equal(first.manifest.deployed, false);
  assert.deepEqual(first.manifest.files.map(file => file.path), [first.manifest.cssPath, 'index.html']);
  assert.equal(before, digest(fs.readFileSync(path.join(workspace, 'plm-web/dist/index.html'))));
  const sealed = loadDevelopmentLayoutDeploymentCandidate(first.output, first.manifest.manifestSha256);
  assert.equal(sealed.files.length, 2);
  assert.deepEqual(sealed.developmentLayoutApproval, {
    contract: 'plm-development-layout-candidate-v1', manifestSha256: first.manifest.manifestSha256,
  });
  assert.deepEqual(sealed.payload.get(sealed.manifest.cssPath), css);
  for (const source of sealed.manifest.sourceFiles) {
    assert.equal(digest(fs.readFileSync(path.join(workspace, source.path))), source.sha256);
    const snapshot = path.join(first.output, 'snapshot', source.path);
    assert.equal(fs.statSync(snapshot).mode & 0o777, 0o600);
    assert.equal(digest(fs.readFileSync(snapshot)), source.sha256);
  }
  assert.equal(fs.statSync(first.output).mode & 0o777, 0o700);
});

test('changed manifest, source snapshot, tool snapshot, payload or rollback bytes never load', t => {
  for (const kind of ['manifest', 'source', 'tool', 'payload', 'original-index', 'original-map']) {
    const { output, manifest } = candidate(t);
    const filename = kind === 'manifest' ? 'development-layout-candidate.private.json'
      : kind === 'source' ? `snapshot/${manifest.sourceFiles[0].path}`
        : kind === 'tool' ? manifest.tools[0].path
          : kind === 'payload' ? `overlay/${manifest.cssPath}`
            : kind === 'original-index' ? 'rollback/index.html'
              : `rollback/${manifest.activeOriginalEntries.importMap}`;
    fs.appendFileSync(path.join(output, filename), '\n');
    assert.throws(() => loadDevelopmentLayoutDeploymentCandidate(output, manifest.manifestSha256), kind);
  }
});

test('public, linked and mismatched private inputs are rejected before deployment IO', t => {
  for (const mode of ['public', 'symlink', 'hardlink', 'digest']) {
    const { output, manifest } = candidate(t);
    const filename = path.join(output, 'overlay', manifest.cssPath);
    if (mode === 'public') fs.chmodSync(filename, 0o644);
    if (mode === 'symlink' || mode === 'hardlink') {
      const copy = path.join(output, 'private-copy');
      fs.copyFileSync(filename, copy);
      fs.chmodSync(copy, 0o600);
      fs.unlinkSync(filename);
      if (mode === 'symlink') fs.symlinkSync(copy, filename);
      else fs.linkSync(copy, filename);
    }
    assert.throws(() => loadDevelopmentLayoutDeploymentCandidate(output,
      mode === 'digest' ? '0'.repeat(64) : manifest.manifestSha256), mode);
  }
});
