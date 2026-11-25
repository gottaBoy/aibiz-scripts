#!/usr/bin/env node
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = 'plm-web/src/runtime/view-theme-layout.css';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const encode = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);

export function prepare(output) {
  assert.equal(path.dirname(output), path.join(workspace, '.artifacts'));
  assert.match(path.basename(output), /^plm-view-theme-layout-candidate-[a-z0-9-]+$/);
  fs.mkdirSync(output, { mode: 0o700 });
  const write = (relative, bytes) => {
    const filename = path.join(output, relative);
    fs.mkdirSync(path.dirname(filename), { recursive: true, mode: 0o700 });
    fs.writeFileSync(filename, bytes, { mode: 0o600, flag: 'wx' });
  };
  const originalIndex = fs.readFileSync(path.join(workspace, 'plm-web/dist/index.html'));
  assert.equal(hash(originalIndex), 'ed62777f1bb743fdd9e1c2ac1592c3f48947e7c865e70229356541851b22b8de');
  const css = fs.readFileSync(path.join(workspace, source));
  assert.ok(css.toString().startsWith('@media (max-width: 767px)'));
  assert.ok(!css.toString().includes('url('));
  const cssPath = `static/css/plm-view-theme-${hash(css).slice(0, 16)}.css`;
  const html = originalIndex.toString();
  assert.equal(html.split('</head>').length, 2);
  assert.ok(!html.includes('plm-view-theme-'));
  const candidateIndex = Buffer.from(html.replace('</head>',
    `  <link rel="stylesheet" href="./${cssPath}">\n  </head>`));
  const mapMatch = html.match(/type="systemjs-importmap"\s+src="([^"]+)"/);
  assert.ok(mapMatch);
  const map = new URL(mapMatch[1], 'http://local/').pathname.slice(1);
  assert.ok(map.startsWith('extras/json/') && !map.includes('..'));
  const originalMap = fs.readFileSync(path.join(workspace, 'plm-web/dist', map));
  write('rollback/index.html', originalIndex);
  write(`rollback/${map}`, originalMap);
  write(`overlay/${cssPath}`, css);
  write('overlay/index.html', candidateIndex);
  write('executed-preparer.private.mjs', fs.readFileSync(fileURLToPath(import.meta.url)));
  const sourceFiles = [source, 'plm-web/src/main.ts'].map(relative => {
    const bytes = fs.readFileSync(path.join(workspace, relative));
    write(`snapshot/${relative}`, bytes);
    return { path: relative, sha256: hash(bytes) };
  });
  const manifest = {
    contract: 'plm-view-theme-layout-candidate-v1', status: 'PREPARED-NOT-PUBLISHED',
    revision: hash(css).slice(0, 16), cssPath, source: [], sourceFiles, inherited: [],
    preparerSha256: hash(fs.readFileSync(fileURLToPath(import.meta.url))),
    activeOriginalEntries: { importMap: map }, originalIndexSha256: hash(originalIndex),
    originalMapSha256: hash(originalMap),
    files: [{ path: cssPath, bytes: css.length, sha256: hash(css) },
      { path: 'index.html', bytes: candidateIndex.length, sha256: hash(candidateIndex) }],
    runtimeRebuild: false, originalApplicationEntryPreserved: true, functionalAcceptance: false,
  };
  write('view-theme-layout-candidate.private.json', encode(manifest));
  return { status: manifest.status, manifestSha256: hash(encode(manifest)), cssPath,
    newIndexSha256: hash(candidateIndex) };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ strict: true, options: { output: { type: 'string' } } });
  try { console.log(JSON.stringify(prepare(values.output))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
