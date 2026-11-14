import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  buildApiReferenceFiles, createApiReferenceContract, renderApiReferenceFiles,
} from '../../plm/doc/tools/api-reference.mjs';

const workspace = new URL('../../', import.meta.url);
const modelBytes = await readFile(new URL('plm/model/PSSYSSERVICEAPIS/ServiceAPI.json', workspace));
const model = JSON.parse(modelBytes);
const contract = createApiReferenceContract(model);
const method = (name, verb, extra = {}) => ({
  name, requestMethod: verb, noServiceCodeName: true, ...extra,
});
const entity = (code, major = true, methods = []) => ({
  codeName: code, codeName2: `${code}s`, logicName: code, major,
  getPSDEServiceAPIFields: [], getPSDEServiceAPIMethods: methods,
});
const relation = (parent, child, methods, code = `${child}s`) => ({
  id: `${parent}-${child}`, codeName: code,
  getMajorPSDEServiceAPI: { id: parent }, getMinorPSDEServiceAPI: { id: child },
  getPSDEServiceAPIMethods: methods,
});
function fixture() {
  return {
    codeName: 'ServiceAPI', aPIType: 'RESTFUL',
    getPSDEServiceAPIs: [
      entity('page', true, [method('Get', 'GET', { needResourceKey: true, dataAccessAction: 'READ' })]),
      entity('comment', false, [method('Create', 'POST', { dataAccessAction: 'CREATE' })]),
      entity('attachment', false),
    ],
    getPSDEServiceAPIRSs: [
      relation('page', 'comment', [method('Create', 'POST')]),
      relation('comment', 'attachment', [method('Get', 'GET', { needResourceKey: true })]),
    ],
  };
}

test('all declared model entities, fields, operations and relationships are covered exactly once', () => {
  assert.deepEqual(contract.counts, {
    entities: 179, rootEntities: 163, fields: 3285,
    entityMethodDefinitions: 2489, relationships: 126,
    relationshipMethodDefinitions: 2364, unresolvedRelationships: 0,
  });
  assert.equal(contract.entities.reduce((sum, item) => sum + item.operations.length, 0), 2489);
  assert.equal(contract.entities.flatMap(item => item.relationships)
    .reduce((sum, item) => sum + item.operations.length, 0), 2364);
  for (const entity of contract.entities) {
    assert.equal(new Set([
      ...entity.operations,
      ...entity.relationships.flatMap(item => item.operations),
    ].map(item => item.anchor)).size,
    entity.operations.length + entity.relationships.reduce((sum, item) => sum + item.operations.length, 0));
  }
});

test('an unverified non-major comment never receives an invented bare comments endpoint', () => {
  const comment = contract.entities.find(entity => entity.code === 'comment');
  assert.equal(comment.major, false);
  assert.ok(comment.operations.every(operation => operation.path === null));
  const routes = comment.relationships.flatMap(relation => relation.operations.map(operation => operation.path));
  assert.ok(routes.some(path => path === '/article_pages/{article_page_key}/comments'));
  assert.ok(routes.every(path => path !== null && !path.startsWith('/comments')));
});

test('GET, keyed custom actions and representative multi-level paths retain declared model flags', () => {
  const f = fixture();
  f.getPSDEServiceAPIs[0].getPSDEServiceAPIMethods.push(method('publish_page', 'POST', {
    requestPath: '/publish_page', needResourceKey: true, dataAccessAction: 'UPDATE',
  }));
  const result = createApiReferenceContract(f);
  const page = result.entities.find(entity => entity.code === 'page');
  assert.equal(page.operations[0].path, '/pages/{key}');
  assert.equal(page.operations[1].path, '/pages/{key}/publish_page');
  assert.equal(page.operations[1].access, 'UPDATE');
  const attachment = result.entities.find(entity => entity.code === 'attachment');
  assert.equal(attachment.relationships[0].operations[0].path,
    '/pages/{page_key}/comments/{comment_key}/attachments/{key}');
});

test('relationship aliases cannot replace the child entity URL collection', () => {
  const f = fixture();
  f.getPSDEServiceAPIRSs[0].codeName = 'unrelated_alias';
  const result = createApiReferenceContract(f);
  const relation = result.entities.find(entity => entity.code === 'comment').relationships[0];
  assert.equal(relation.declaredCodeName, 'unrelated_alias');
  assert.equal(relation.collection, 'comments');
  assert.equal(relation.operations[0].path, '/pages/{page_key}/comments');
  const page = contract.entities.find(entity => entity.code === 'article_page');
  const actual = page.relationships.find(relation => relation.parent === 'space');
  assert.equal(actual.declaredCodeName, 'pages');
  assert.equal(actual.operations.find(operation => operation.code === 'Create').path,
    '/spaces/{space_key}/article_pages');
});

test('URL collection casing is normalized without changing persisted entity or collection codes', () => {
  const f = fixture();
  f.getPSDEServiceAPIs[0].codeName2 = 'PAGES';
  const result = createApiReferenceContract(f);
  const page = result.entities.find(entity => entity.code === 'page');
  assert.equal(page.collection, 'PAGES');
  assert.equal(page.routeCollection, 'pages');
  assert.equal(page.operations[0].path, '/pages/{key}');
  const mixed = contract.entities.find(entity => entity.code === 'REVIEW_CONTENT_IDEA');
  assert.equal(mixed.operations[0].path.split('/')[1], 'review_content_ideas');
});

test('major-only policy is explicitly conservative rather than a claim about API-mode export', () => {
  const f = fixture();
  f.getPSDEServiceAPIs[1].aPIMode = 0;
  const result = createApiReferenceContract(f);
  assert.equal(result.entities.find(entity => entity.code === 'comment').apiMode, 0);
  assert.equal(result.entities.find(entity => entity.code === 'comment').operations[0].path, null);
  assert.equal(result.routePolicy.runtimeMapperVerified, false);
  const files = renderApiReferenceFiles(result);
  assert.equal(JSON.parse(files.get('api-reference/manifest.json')).routePolicy.runtimeMapperVerified, false);
  assert.match(files.get('api-reference/en/entities/comment.md').toString(),
    /does not prove that the runtime exports no root/);
});

test('unreachable relation parents are explicitly unresolved, not invented as independent roots', () => {
  const f = fixture();
  f.getPSDEServiceAPIs[0].major = false;
  const result = createApiReferenceContract(f);
  assert.equal(result.counts.unresolvedRelationships, 2);
  assert.ok(result.entities.flatMap(entity => entity.relationships)
    .flatMap(relation => relation.operations).every(operation => operation.path === null));
});

test('rendered Chinese and English references have identical structural metadata and stable operation anchors', () => {
  const files = renderApiReferenceFiles(contract);
  assert.equal(files.size, 365);
  for (const entity of contract.entities) {
    const zh = files.get(`api-reference/zh-CN/entities/${entity.code}.md`).toString();
    const en = files.get(`api-reference/en/entities/${entity.code}.md`).toString();
    const anchors = markdown => [...markdown.matchAll(/:id=(op-[a-f0-9]{16})/g)].map(match => match[1]);
    assert.deepEqual(anchors(zh), anchors(en), entity.code);
    for (const operation of [
      ...entity.operations, ...entity.relationships.flatMap(relation => relation.operations),
    ]) {
      if (operation.path) {
        assert.ok(zh.includes(`\`${operation.path}\``));
        assert.ok(en.includes(`\`${operation.path}\``));
      }
    }
    for (const field of entity.fields) {
      assert.ok(zh.includes(`\`${field.code}\``));
      assert.ok(en.includes(`\`${field.code}\``));
    }
  }
  const manifest = JSON.parse(files.get('api-reference/manifest.json'));
  assert.deepEqual(manifest.counts, contract.counts);
  assert.equal(manifest.runtimeAcceptance, false);
  assert.equal(manifest.arbitraryApiExecution, false);
  assert.deepEqual(manifest.languages, ['zh-CN', 'en']);
  for (const file of manifest.files) {
    assert.equal(files.get(file.path).length, file.bytes);
    assert.equal(createHash('sha256').update(files.get(file.path)).digest('hex'), file.sha256);
  }
});

test('bilingual search entries resolve to real pages/anchors, including methods rather than labels only', () => {
  const files = renderApiReferenceFiles(contract);
  for (const language of ['zh-CN', 'en']) {
    const search = JSON.parse(files.get(`api-reference/${language}/search.json`));
    assert.equal(search.language, language);
    assert.ok(search.entries.some(entry => entry.code === 'publish_page' && entry.keywords.includes('UPDATE')));
    for (const entry of search.entries) {
      const [path, query] = entry.path.slice(2).split('?');
      const bytes = files.get(`${path}.md`);
      assert.ok(bytes, entry.path);
      if (query) assert.ok(bytes.toString().includes(`:id=${new URLSearchParams(query).get('id')}`), entry.path);
    }
  }
});

test('human text and curated translations are escaped without changing protocol codes', () => {
  const f = fixture();
  f.getPSDEServiceAPIs[0].logicName = '<img src=x onerror=alert(1)> | [label]';
  const result = renderApiReferenceFiles(createApiReferenceContract(f), {
    englishLabels: { [f.getPSDEServiceAPIs[0].logicName]: '<script>evil()</script>' },
  });
  const zh = result.get('api-reference/zh-CN/entities/page.md').toString();
  const en = result.get('api-reference/en/entities/page.md').toString();
  assert.ok(zh.includes('&lt;img'));
  assert.ok(en.includes('&lt;script&gt;'));
  assert.doesNotMatch(zh + en, /<(?:img|script)[\s>]/);
  assert.ok(en.includes('`/pages/{key}`'));
});

test('invalid model paths, verbs, duplicates and unresolved entity references fail generation', () => {
  const changes = [
    f => { f.getPSDEServiceAPIs[0].codeName = '../private'; },
    f => { f.getPSDEServiceAPIs[0].codeName2 = 'page?s'; },
    f => { f.getPSDEServiceAPIs.push(f.getPSDEServiceAPIs[0]); },
    f => { f.getPSDEServiceAPIs[0].getPSDEServiceAPIMethods[0].requestMethod = 'SCRIPT'; },
    f => { f.getPSDEServiceAPIs[0].getPSDEServiceAPIMethods[0].requestPath = '/../../secret'; },
    f => { delete f.getPSDEServiceAPIs[0].getPSDEServiceAPIMethods[0].noServiceCodeName; },
    f => { f.getPSDEServiceAPIRSs[0].getMajorPSDEServiceAPI.id = 'missing'; },
    f => { f.getPSDEServiceAPIRSs[0].codeName = '../comments'; },
  ];
  for (const change of changes) {
    const f = fixture();
    change(f);
    assert.throws(() => createApiReferenceContract(f));
  }
});

test('field metadata is typed rather than interpolated as untrusted Markdown or truthy flags', () => {
  for (const [property, values] of [
    ['stdDataType', ['<img src=x>', -1, 1.5, {}]],
    ['stringLength', ['100 | injected', -1, Infinity]],
    ['allowEmpty', ['false', 1]],
    ['enableCreate', ['true', 0]],
    ['enableModify', [{}, 1]],
    ['keyField', ['false', 0]],
  ]) {
    for (const value of values) {
      const f = fixture();
      f.getPSDEServiceAPIs[0].getPSDEServiceAPIFields = [{ codeName: 'name', [property]: value }];
      assert.throws(() => createApiReferenceContract(f), /metadata/);
    }
  }
  const f = fixture();
  f.getPSDEServiceAPIs[0].getPSDEServiceAPIFields = [{
    codeName: 'name', stdDataType: 25, stringLength: 200, allowEmpty: false,
    enableCreate: true, enableModify: false, keyField: false,
  }];
  const field = createApiReferenceContract(f).entities.find(entity => entity.code === 'page').fields[0];
  assert.equal(field.nullable, false);
  assert.equal(field.modify, false);
  assert.equal(field.length, 200);
});

test('the real build is deterministic, binds actual source inputs and does not write generated source files', async () => {
  const sourceDirectory = new URL('plm/doc/docsify', workspace).pathname;
  const [first, second] = await Promise.all([
    buildApiReferenceFiles({ sourceDirectory }), buildApiReferenceFiles({ sourceDirectory }),
  ]);
  assert.deepEqual(first, second);
  const manifest = JSON.parse(first.get('api-reference/manifest.json'));
  assert.equal(manifest.inputHashes.find(input => input.role === 'service-model').sha256,
    createHash('sha256').update(modelBytes).digest('hex'));
  assert.ok(manifest.inputHashes.some(input => input.role === 'generator'));
  await assert.rejects(readFile(join(sourceDirectory, 'api-reference/manifest.json')), { code: 'ENOENT' });
});

test('missing required model and symlinked model inputs cannot become a partial generated reference', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'plm-reference-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sourceDirectory = join(directory, 'plm/doc/docsify');
  const modelDirectory = join(directory, 'plm/model/PSSYSSERVICEAPIS');
  await mkdir(sourceDirectory, { recursive: true });
  await mkdir(modelDirectory, { recursive: true });
  await assert.rejects(buildApiReferenceFiles({ sourceDirectory }), { code: 'ENOENT' });
  const other = join(directory, 'other.json');
  await writeFile(other, JSON.stringify(fixture()));
  await symlink(other, join(modelDirectory, 'ServiceAPI.json'));
  await assert.rejects(buildApiReferenceFiles({ sourceDirectory }), /symlink/);
});
