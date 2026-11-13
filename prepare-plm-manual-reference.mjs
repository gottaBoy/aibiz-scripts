import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const manualRootId = 'plm_space_user_manual';
export const domainGuides = Object.freeze({
  产品管理: 'PRODUCT-PROJECT.md',
  项目管理: 'PRODUCT-PROJECT.md',
  测试管理: 'TEST-KNOWLEDGE.md',
  知识管理: 'TEST-KNOWLEDGE.md',
  效能度量: 'ADMIN-INTEGRATION-METRICS.md',
  协作空间: 'ADMIN-INTEGRATION-METRICS.md',
  管理员手册: 'ADMIN-INTEGRATION-METRICS.md',
  第三方集成: 'ADMIN-INTEGRATION-METRICS.md',
});

const sha256 = value => createHash('sha256').update(value).digest('hex');
const idPattern = /^[a-zA-Z0-9_-]+$/;
const hashPattern = /^[a-f0-9]{64}$/;

export function createChapterIndex(snapshot) {
  assert.equal(snapshot.rootId, manualRootId, 'Unexpected manual root');
  const source = new URL(snapshot.source);
  assert.equal(source.origin, 'https://wiki.ibizlab.cn');
  assert.equal(source.pathname, '/plm/');
  assert.equal(source.username, '');
  assert.equal(source.password, '');
  assert.equal(source.search, '', 'Do not publish session-bearing source queries');
  const publicSource = `${source.origin}${source.pathname}`;
  assert.equal(typeof snapshot.fetchedAt, 'string', 'Unsafe capture time');
  assert.match(snapshot.fetchedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  assert.ok(Number.isFinite(Date.parse(snapshot.fetchedAt)), 'Missing capture time');
  assert.deepEqual(snapshot.failures, [], 'Incomplete capture: request failures');
  assert.deepEqual(snapshot.unindexedLinks, [], 'Incomplete capture: unresolved links');
  assert.ok(Array.isArray(snapshot.nodes) && snapshot.nodes.length > 0);
  assert.equal(snapshot.count, snapshot.nodes.length);
  const nodes = new Map();
  for (const node of snapshot.nodes) {
    assert.match(node.id, idPattern);
    assert.ok(!nodes.has(node.id), `Duplicate page: ${node.id}`);
    nodes.set(node.id, node);
  }
  const root = nodes.get(manualRootId);
  assert.equal(root?.parentId, null);
  assert.deepEqual(root.path, [root.name]);
  const visited = new Set();
  const pages = [];
  const images = new Set();
  const visit = node => {
    assert.ok(!visited.has(node.id), `Repeated child/cycle: ${node.id}`);
    visited.add(node.id);
    assert.equal(typeof node.name, 'string');
    assert.ok(node.name.trim());
    assert.match(node.contentSha256, hashPattern);
    assert.equal(node.contentSource, 'publish_content', `Unpublished fallback: ${node.id}`);
    assert.equal(node.published, 1, `Unpublished page: ${node.id}`);
    assert.equal(node.format, 'HTML');
    for (const [key, value, pattern] of [
      ['version', node.version, /^\d{1,32}(?:\.\d{1,32})*$/],
      ['publishTime', node.publishTime, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/],
      ['updatedAt', node.updatedAt, /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/],
    ]) {
      assert.ok(value === null || value === undefined || typeof value === 'string',
        `Unsafe source metadata type: ${node.id}.${key}`);
      if (value !== null && value !== undefined) assert.ok(
        value.length <= 128 && pattern.test(value), `Unsafe source metadata: ${node.id}.${key}`);
    }
    assert.equal(typeof node.text, 'string');
    assert.equal(node.characters, node.text.length);
    assert.ok(Array.isArray(node.children));
    assert.ok(Array.isArray(node.images));
    assert.ok(Array.isArray(node.tables));
    assert.ok(node.text.trim() || node.images.length || node.children.length,
      `Blank leaf: ${node.id}`);
    for (const image of node.images) {
      assert.equal(typeof image.src, 'string');
      images.add(image.src);
    }
    for (const link of node.links ?? []) {
      if (link.href?.startsWith('redirect://tree#')) {
        assert.ok(nodes.has(link.href.slice('redirect://tree#'.length)),
          `Missing linked chapter: ${node.id}`);
      }
    }
    const domain = node.id === manualRootId ? '使用手册' : node.path[1];
    const guide = node.id === manualRootId ? 'README.md' : domainGuides[domain];
    assert.ok(guide, `Unknown domain: ${domain}`);
    pages.push({
      id: node.id,
      title: node.name,
      path: node.path,
      parentId: node.parentId,
      children: node.children,
      domain,
      guide,
      reportedVersion: node.version ?? null,
      sourcePublishedAt: node.publishTime ?? null,
      sourceUpdatedAt: node.updatedAt ?? null,
      contentSource: node.contentSource,
      format: node.format,
      contentSha256: node.contentSha256,
      textSha256: sha256(node.text),
      textCharacters: node.characters,
      imageReferences: node.images.length,
      tableCount: node.tables.length,
    });
    for (const childId of node.children) {
      const child = nodes.get(childId);
      assert.ok(child, `Missing child: ${childId}`);
      assert.equal(child.parentId, node.id, `Parent mismatch: ${childId}`);
      assert.deepEqual(child.path, [...node.path, child.name], `Path mismatch: ${childId}`);
      visit(child);
    }
  };
  visit(root);
  assert.equal(visited.size, nodes.size, 'Orphan chapters outside root traversal');
  return {
    schemaVersion: 1,
    source: publicSource,
    rootId: manualRootId,
    capturedAt: snapshot.fetchedAt,
    coverageKind: 'retrieved-published-text-and-structure',
    localFeatureAcceptance: 'not-assessed-by-this-index',
    imagesIndividuallyReviewed: false,
    pageCount: pages.length,
    textCharacters: pages.reduce((sum, page) => sum + page.textCharacters, 0),
    imageReferences: pages.reduce((sum, page) => sum + page.imageReferences, 0),
    uniqueImages: images.size,
    domains: Object.fromEntries(Object.keys(domainGuides).map(domain =>
      [domain, pages.filter(page => page.domain === domain).length])),
    pages,
  };
}

const cell = value => String(value).replaceAll('|', '\\|').replace(/[\r\n]+/g, ' ');

export function renderChapterIndex(index) {
  const lines = [
    '# PLM Manual Chapter Index',
    '',
    '<!-- Generated by prepare-plm-manual-reference.mjs; do not edit the table. -->',
    '',
    `Captured: ${index.capturedAt}. Pages: ${index.pageCount}.`,
    '',
    'This is a retrieval/traceability index, not a local feature acceptance report.',
    'Published HTML was selected instead of draft content. Version and timestamps',
    'are source-reported metadata; the version is not asserted to be a published revision.',
    'Original HTML hashes and decoded-text hashes are in `chapter-index.json`.',
    'Image references are counted, not a claim that every image was visually reviewed.',
    '',
    '| # | Chapter Path | Source Page ID | Guide | Text Characters | Images |',
    '| --- | --- | --- | --- | --- | --- |',
    ...index.pages.map((page, number) =>
      `| ${number + 1} | ${cell(page.path.join(' / '))} | \`${page.id}\` | ` +
      `[${page.guide}](${page.guide}) | ${page.textCharacters} | ${page.imageReferences} |`),
    '',
  ];
  return lines.join('\n');
}

export function readGuideCoverage(markdown) {
  const match = markdown.match(
    /<!-- manual-source-ids:start -->\s*```json\s*([\s\S]*?)\s*```\s*<!-- manual-source-ids:end -->/);
  assert.ok(match, 'Missing manual source ID coverage block');
  const ids = JSON.parse(match[1]);
  assert.ok(Array.isArray(ids) && ids.every(id => typeof id === 'string' && idPattern.test(id)));
  assert.equal(new Set(ids).size, ids.length, 'Duplicate source page IDs in guide');
  return ids;
}

const directory = dirname(fileURLToPath(import.meta.url));
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [input, ...rest] = process.argv.slice(2);
  assert.ok(input && !input.startsWith('--') && rest.every(arg => arg === '--check'),
    'Usage: node prepare-plm-manual-reference.mjs <private-capture.json> [--check]');
  const index = createChapterIndex(JSON.parse(readFileSync(resolve(input), 'utf8')));
  const outputs = {
    'chapter-index.json': `${JSON.stringify(index, null, 2)}\n`,
    'CHAPTER-INDEX.md': renderChapterIndex(index),
  };
  for (const [name, value] of Object.entries(outputs)) {
    const target = resolve(directory, 'docs/manual', name);
    if (rest.includes('--check')) {
      assert.equal(readFileSync(target, 'utf8'), value, `Outdated manual index: ${name}`);
    } else {
      writeFileSync(target, value);
    }
  }
  console.log(JSON.stringify({ pages: index.pageCount, domains: index.domains,
    imageReferences: index.imageReferences, uniqueImages: index.uniqueImages,
    checked: rest.includes('--check') }));
}
