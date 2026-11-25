#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { rewriteGuardEntry, staticModuleReferences, resolveGuardResource } from './prepare-plm-guard-overlay.mjs';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = path.join(workspace, '.artifacts');
const require = createRequire(path.join(workspace, 'plm-web/package.json'));
const vueRequire = createRequire(require.resolve('vue'));
const parseHtml = vueRequire('@vue/compiler-dom').parse;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
export function captionHtmlEntries(html) {
  const entries = [];
  const visit = node => {
    if (node.type === 1 && node.tag === 'script') entries.push(node);
    for (const child of node.children ?? []) visit(child);
  };
  visit(parseHtml(html, { onError(error) {
    if (error.code === 11 && /^<!doctype/i.test(html.slice(error.loc.start.offset))) return;
    throw error;
  } }));
  const attr = (node, name) => node.props.find(prop => prop.type === 6 && prop.name === name)?.value?.content;
  const maps = entries.filter(node => attr(node, 'type') === 'systemjs-importmap');
  const apps = entries.filter(node => attr(node, 'id') === 'vite-legacy-entry');
  assert.equal(maps.length, 1); assert.equal(apps.length, 1);
  const relative = value => {
    assert.ok(value?.startsWith('./') && !value.includes('..') && !/[#\\\s]/.test(value));
    const parsed = new URL(value, 'http://candidate.invalid/');
    assert.equal(parsed.origin, 'http://candidate.invalid');
    assert.ok([...parsed.searchParams.keys()].every(key => key === 'time'));
    if (parsed.search) assert.match(parsed.searchParams.get('time'), /^\d+$/);
    return parsed.pathname.slice(1);
  };
  return { appEntry: relative(attr(apps[0], 'data-src')), importMap: relative(attr(maps[0], 'src')) };
}
export function prepareCaptionEntry({ build, output }) {
  assert.equal(fs.realpathSync(path.dirname(output)), artifacts);
  assert.equal(fs.realpathSync(path.dirname(build)), artifacts);
  const receiptBytes = fs.readFileSync(path.join(build, 'source-build.json'));
  const receipt = JSON.parse(receiptBytes);
  assert.equal(receipt.freshApplicationBuild, true);
  assert.equal(receipt.sharedDistUnchanged, true);
  const expected = {
    我负责的需求: 'Ideas Assigned to Me', 我创建的需求: 'Ideas Created by Me', 已归档的需求: 'Archived Ideas',
  };
  const dictionary = JSON.parse(fs.readFileSync(path.join(workspace, 'plm-web/src/locale/en.json')));
  for (const [source, target] of Object.entries(expected)) assert.equal(dictionary[source], target);
  const originalIndex = fs.readFileSync(path.join(workspace, 'plm-web/dist/index.html'));
  const old = captionHtmlEntries(originalIndex.toString());
  const fresh = captionHtmlEntries(fs.readFileSync(path.join(build, 'dist/index.html'), 'utf8'));
  assert.match(fresh.appEntry, /^static\/js\/index-legacy-[a-f0-9]+\.js$/);
  assert.notEqual(fresh.appEntry, old.appEntry);
  const originalMap = fs.readFileSync(path.join(workspace, 'plm-web/dist', old.importMap));
  const appBytes = fs.readFileSync(path.join(build, 'dist', fresh.appEntry));
  const entry = receipt.outputFiles.find(file => file.path === fresh.appEntry);
  assert.equal(digest(appBytes), entry.sha256);
  for (const target of Object.values(expected)) assert.ok(appBytes.includes(Buffer.from(target)));
  fs.mkdirSync(output, { mode: 0o700 });
  const write = (relative, bytes) => {
    const filename = path.join(output, relative);
    fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
    const fd = fs.openSync(filename, 'wx', 0o600);
    try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    return { path: relative, bytes: bytes.length, sha256: digest(bytes) };
  };
  for (const file of receipt.sourceFiles) {
    const bytes = fs.readFileSync(path.join(workspace, 'plm-web/src', file.path));
    assert.equal(digest(bytes), file.sha256, `Build input drifted: ${file.path}`);
    write(`snapshot/plm-web/src/${file.path}`, bytes);
  }
  write('source-build.private.json', receiptBytes);
  const script = fs.readFileSync(fileURLToPath(import.meta.url));
  write('executed-preparer.private.mjs', script);
  const files = [
    write(`overlay/${fresh.appEntry}`, appBytes),
    write('overlay/index.html', Buffer.from(rewriteGuardEntry(originalIndex.toString(),
      { appEntry: `./${fresh.appEntry}`, importMap: `./${old.importMap}` }))),
  ].map(file => ({ ...file, path: file.path.slice('overlay/'.length) }));
  write('rollback/index.html', originalIndex);
  write(`rollback/${old.importMap}`, originalMap);
  const references = staticModuleReferences(appBytes.toString(), fresh.appEntry);
  const activeMap = JSON.parse(originalMap);
  const inherited = references.references.map(reference => {
    const relative = resolveGuardResource(reference, fresh.appEntry, activeMap, old.importMap);
    const bytes = fs.readFileSync(path.join(workspace, 'plm-web/dist', relative));
    return { reference, path: relative, bytes: bytes.length, sha256: digest(bytes) };
  });
  const report = { contract: 'plm-caption-entry-candidate-v1', status: 'PREPARED-NOT-PUBLISHED',
    files, expected, build, sourceBuildSha256: digest(receiptBytes), source: [{ package: 'plm-web/src', files: receipt.sourceFiles }],
    preparerSha256: digest(script), originalIndexSha256: digest(originalIndex),
    originalMapSha256: digest(originalMap), activeOriginalEntries: old, mapPath: old.importMap,
    appEntry: fresh.appEntry, references, inherited, languageRuntimeUnchanged: true, functionalAcceptance: false,
    preparedAt: new Date().toISOString() };
  write('caption-entry-candidate.private.json', json(report));
  return report;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { build: { type: 'string' }, output: { type: 'string' } } });
  try {
    const report = prepareCaptionEntry(values);
    console.log(JSON.stringify({ status: report.status, appEntry: report.appEntry, files: report.files,
      literalReferences: report.references.references.length, dynamic: report.references.dynamic.length }));
  } catch (error) { console.error(error.stack); process.exitCode = 1; }
}
