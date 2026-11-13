import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import {
  createChapterIndex,
  domainGuides,
  manualRootId,
  readGuideCoverage,
  renderChapterIndex,
} from '../prepare-plm-manual-reference.mjs';

const docs = new URL('../docs/manual/', import.meta.url);
const read = name => readFileSync(new URL(name, docs), 'utf8');
const index = JSON.parse(read('chapter-index.json'));
const expectedDomains = {
  产品管理: 18, 项目管理: 43, 测试管理: 31, 知识管理: 11,
  效能度量: 6, 协作空间: 4, 管理员手册: 10, 第三方集成: 1,
};
const pageFields = [
  'id', 'title', 'path', 'parentId', 'children', 'domain', 'guide',
  'reportedVersion', 'sourcePublishedAt', 'sourceUpdatedAt',
  'contentSource', 'format', 'contentSha256', 'textSha256',
  'textCharacters', 'imageReferences', 'tableCount',
];

function fixture() {
  const page = (id, name, parentId, path, children) => ({
    id, name, parentId, path, children,
    version: '1', publishTime: '2026-01-01 12:00:00', updatedAt: '2026-01-02 12:00:00',
    published: 1, format: 'HTML', contentSource: 'publish_content',
    contentSha256: 'a'.repeat(64), characters: 4, text: 'text',
    images: [{ src: '/public-image' }], tables: [], links: [],
  });
  return {
    source: 'https://wiki.ibizlab.cn/plm/#/public-manual',
    rootId: manualRootId, fetchedAt: '2026-11-13T15:56:09.441Z',
    count: 2, failures: [], unindexedLinks: [],
    nodes: [
      page(manualRootId, '使用手册', null, ['使用手册'], ['product']),
      page('product', '产品管理', manualRootId, ['使用手册', '产品管理'], []),
    ],
  };
}

test('published snapshot indexes all 125 pages and eight domain totals without acceptance claims', () => {
  assert.equal(index.pageCount, 125);
  assert.equal(index.pages.length, 125);
  assert.deepEqual(index.domains, expectedDomains);
  assert.equal(index.textCharacters, 53042);
  assert.equal(index.textCharacters, index.pages.reduce((sum, page) => sum + page.textCharacters, 0));
  assert.equal(index.imageReferences, 801);
  assert.equal(index.imageReferences, index.pages.reduce((sum, page) => sum + page.imageReferences, 0));
  assert.equal(index.uniqueImages, 800);
  assert.equal(index.imagesIndividuallyReviewed, false);
  assert.equal(index.coverageKind, 'retrieved-published-text-and-structure');
  assert.equal(index.localFeatureAcceptance, 'not-assessed-by-this-index');
  assert.equal(index.capturedAt, '2026-11-13T15:56:09.441Z');
});

test('chapter parent/child structure and guide ownership have no gaps, cycles or orphans', () => {
  const pages = new Map(index.pages.map(page => [page.id, page]));
  assert.equal(pages.size, 125);
  assert.equal(pages.get(manualRootId).parentId, null);
  const seen = new Set();
  const visit = id => {
    assert.ok(!seen.has(id), id);
    seen.add(id);
    const page = pages.get(id);
    assert.ok(page, id);
    assert.deepEqual(Object.keys(page), pageFields);
    assert.equal(page.contentSource, 'publish_content');
    assert.equal(page.format, 'HTML');
    assert.match(page.contentSha256, /^[a-f0-9]{64}$/);
    assert.match(page.textSha256, /^[a-f0-9]{64}$/);
    const guide = id === manualRootId ? 'README.md' : domainGuides[page.domain];
    assert.equal(page.guide, guide);
    assert.ok(existsSync(new URL(guide, docs)), guide);
    for (const childId of page.children) {
      const child = pages.get(childId);
      assert.ok(child, childId);
      assert.equal(child.parentId, id);
      assert.deepEqual(child.path, [...page.path, child.title]);
      visit(childId);
    }
  };
  visit(manualRootId);
  assert.equal(seen.size, 125);
  for (const [domain, count] of Object.entries(expectedDomains)) {
    assert.equal(index.pages.filter(page => page.domain === domain).length, count);
  }
});

test('every source page is assigned once to the correct reviewed domain guide', () => {
  const seen = new Set();
  for (const guide of new Set(index.pages.map(page => page.guide))) {
    const ids = readGuideCoverage(read(guide));
    assert.deepEqual(ids.toSorted(),
      index.pages.filter(page => page.guide === guide).map(page => page.id).toSorted(), guide);
    for (const id of ids) {
      assert.ok(!seen.has(id), `Multiple guides claim source page ${id}`);
      seen.add(id);
    }
  }
  assert.equal(seen.size, 125);
});

test('readable generated index is byte-consistent and manual document links resolve', () => {
  assert.equal(read('CHAPTER-INDEX.md'), renderChapterIndex(index));
  const files = [
    'README.md', 'WORKSPACE-AGENTS.md', 'CHAPTER-INDEX.md',
    'VALIDATION-BACKLOG.md', ...new Set(Object.values(domainGuides)),
  ];
  for (const file of files) {
    const markdown = read(file);
    for (const match of markdown.matchAll(/\[[^\]]+\]\(([^)\s]+)\)/g)) {
      if (/^(?:https?:|#)/.test(match[1])) continue;
      const path = match[1].split('#')[0];
      assert.ok(existsSync(new URL(path, new URL(file, docs))), `${file}: ${path}`);
    }
  }
});

test('installed workspace AGENTS matches its tracked copy when present', t => {
  const installed = new URL('../../AGENTS.md', import.meta.url);
  if (!existsSync(installed)) {
    t.skip('Only independent scripts repository is present; workspace root installation is optional here');
    return;
  }
  assert.equal(readFileSync(installed, 'utf8'), read('WORKSPACE-AGENTS.md'));
});

test('generator exports an allowlist, not raw text, images, session headers or private fields', () => {
  const snapshot = fixture();
  snapshot.authorization = 'private-session-sentinel';
  snapshot.nodes[0].original = { token: 'private-session-sentinel' };
  snapshot.nodes[0].text = 'private-body-sentinel';
  snapshot.nodes[0].characters = snapshot.nodes[0].text.length;
  const result = createChapterIndex(snapshot);
  assert.equal(result.pageCount, 2);
  assert.equal(result.imageReferences, 2);
  assert.equal(result.uniqueImages, 1);
  assert.deepEqual(Object.keys(result.pages[0]), pageFields);
  assert.doesNotMatch(JSON.stringify(result), /private-(?:session|body)-sentinel|\/public-image/);
  assert.equal(result.localFeatureAcceptance, 'not-assessed-by-this-index');
});

test('generator rejects partial, draft, duplicate and escaped source snapshots', () => {
  const changes = [
    x => { x.failures = [{ id: 'missing' }]; },
    x => { x.unindexedLinks = ['missing']; },
    x => { x.count = 3; },
    x => { x.fetchedAt = ['2026-11-13T15:56:09.441Z']; },
    x => { x.nodes.push(x.nodes[1]); x.count = 3; },
    x => { x.nodes[1].contentSource = 'content'; },
    x => { x.nodes[1].published = 0; },
    x => { x.source = 'https://example.com/plm/'; },
    x => { x.source = 'https://secret@wiki.ibizlab.cn/plm/'; },
    x => { x.source = 'https://wiki.ibizlab.cn/plm/?token=secret'; },
    x => { x.nodes[1].version = { authorization: 'nested-secret' }; },
    x => { x.nodes[1].publishTime = { token: 'nested-secret' }; },
    x => { x.nodes[1].updatedAt = 'private-session-sentinel'; },
    x => { x.nodes[1].updatedAt = 'x'.repeat(129); },
  ];
  for (const change of changes) {
    const snapshot = fixture();
    change(snapshot);
    assert.throws(() => createChapterIndex(snapshot));
  }
});

test('generator canonicalizes the source URL and never exports fragments', () => {
  const snapshot = fixture();
  snapshot.source = 'https://wiki.ibizlab.cn/plm/#access_token=fragment-secret';
  const result = createChapterIndex(snapshot);
  assert.equal(result.source, 'https://wiki.ibizlab.cn/plm/');
  assert.doesNotMatch(JSON.stringify(result), /fragment-secret|access_token/);
});

test('generator rejects malformed tree/links/metadata and blank leaves', () => {
  const changes = [
    x => { x.nodes[0].children = []; },
    x => { x.nodes[0].children.push('product'); },
    x => { x.nodes[1].parentId = 'missing'; },
    x => { x.nodes[1].path = ['使用手册', 'wrong']; },
    x => { x.nodes[1].contentSha256 = 'bad'; },
    x => { x.nodes[1].characters = 100; },
    x => { x.nodes[1].links = [{ href: 'redirect://tree#missing' }]; },
    x => { x.nodes[1].text = ''; x.nodes[1].characters = 0; x.nodes[1].images = []; },
    x => { x.nodes[1].name = 'unknown'; x.nodes[1].path[1] = 'unknown'; },
  ];
  for (const change of changes) {
    const snapshot = fixture();
    change(snapshot);
    assert.throws(() => createChapterIndex(snapshot));
  }
});

test('guide coverage parser rejects missing, duplicate or malformed ID declarations', () => {
  const wrap = value => `<!-- manual-source-ids:start -->\n\`\`\`json\n${value}\n\`\`\`\n<!-- manual-source-ids:end -->`;
  assert.deepEqual(readGuideCoverage(wrap('["first","second"]')), ['first', 'second']);
  for (const markdown of ['', wrap('["same","same"]'), wrap('["bad/id"]'), wrap('{}'), wrap('[1]')]) {
    assert.throws(() => readGuideCoverage(markdown));
  }
});
