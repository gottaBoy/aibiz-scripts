import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { link, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
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

test('Markdown links use Docsify route paths while DOM search entries retain hash URLs', () => {
  const files = renderApiReferenceFiles(contract);
  for (const [path, bytes] of files) {
    if (path.endsWith('.md')) assert.doesNotMatch(bytes.toString(), /\]\(#\/api-reference\//, path);
  }
  const overview = files.get('api-reference/en/ServiceAPI.md').toString();
  assert.match(overview, /\]\(\/api-reference\/en\/entities\/article_page\)/);
  const entity = files.get('api-reference/en/entities/article_page.md').toString();
  assert.match(entity, /\]\(\/api-reference\/en\/entities\/article_page\?id=dto-[a-f0-9]{16}\)/);
  const search = JSON.parse(files.get('api-reference/en/search.json'));
  assert.ok(search.entries.every(entry => entry.path.startsWith('#/api-reference/en/')));
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

function dtoFixture() {
  const f = fixture();
  const pagePath = 'PSMODULES/Wiki/PSDATAENTITIES/page.json';
  const childPath = 'PSMODULES/Base/PSDATAENTITIES/child.json';
  const page = f.getPSDEServiceAPIs[0];
  page.getPSDataEntity = { path: pagePath };
  page.getPSDEServiceAPIFields = [
    { codeName: 'id' }, { codeName: 'all_entity_only' }, { codeName: 'content' },
  ];
  page.getPSDEServiceAPIMethods = [method('fetch_summary', 'POST', {
    requestPath: '/fetch_summary',
    getPSDEServiceAPIMethodInput: { type: 'DTO', getPSDEMethodDTO: { id: 'page_filter_dto' } },
    getPSDEServiceAPIMethodReturn: { type: 'PAGE', getPSDEMethodDTO: { id: 'page_summary_dto' } },
  })];
  const models = new Map([
    [pagePath, { getAllPSDEMethodDTOs: [
      { name: 'page_summary_dto', type: 'DEFAULT', sourceType: 'DE', getPSDEMethodDTOFields: [
        { name: 'id', type: 'SIMPLE', stdDataType: 25, stringLength: 100, allowEmpty: false,
          readOnly: false, getPSDEField: { codeName: 'id' } },
        { name: 'children', type: 'DTOS', getRefPSDataEntity: { path: pagePath },
          getRefPSDEMethodDTO: { id: 'page_summary_dto' } },
        { name: 'details', type: 'DTOS', getRefPSDataEntity: { path: childPath },
          getRefPSDEMethodDTO: { id: 'child_dto' }, defaultValue: 'private-default-must-not-publish' },
        { name: 'projection', type: 'SIMPLE', listMap: true,
          getRelatedPSDataEntity: { path: childPath }, getRelatedPSDEMethodDTO: { id: 'child_dto' },
          getRelatedPSDEMethodDTOField: { id: 'source_name' } },
      ] },
      { name: 'page_filter_dto', type: 'DEFILTER', sourceType: 'DE', getPSDEFilterDTOFields: [
        { name: 'n_name_like', type: 'SIMPLE', stdDataType: 25,
          getPSDEField: { codeName: 'name' }, getPSDEFSearchMode: { id: 'N_NAME_LIKE' } },
      ] },
    ] }],
    [childPath, { getAllPSDEMethodDTOs: [
      { name: 'child_dto', type: 'DEFAULT', sourceType: 'DE', getPSDEMethodDTOFields: [
        { name: 'source_name', type: 'SIMPLE', readOnly: true },
      ] },
    ] }],
  ]);
  return { model: f, models, pagePath, childPath };
}

test('method DTO subsets, filter inputs and PAGE wrappers do not fall back to full entity fields', () => {
  const f = dtoFixture();
  const result = createApiReferenceContract(f.model, { dtoModels: f.models });
  const page = result.entities.find(entity => entity.code === 'page');
  const operation = page.operations[0];
  assert.equal(operation.input.type, 'DTO');
  assert.equal(operation.output.type, 'PAGE');
  assert.equal(operation.input.status, 'resolved');
  const summary = result.dtoSchemas.find(dto => dto.name === 'page_summary_dto');
  const filter = result.dtoSchemas.find(dto => dto.name === 'page_filter_dto');
  assert.deepEqual(summary.fields.map(field => field.code), ['id', 'children', 'details', 'projection']);
  assert.deepEqual(filter.fields.map(field => field.code), ['n_name_like']);
  assert.equal(filter.kind, 'DEFILTER');
  assert.equal(filter.fields[0].modelField, 'name');
  assert.equal(filter.fields[0].searchMode, 'N_NAME_LIKE');
  assert.ok(!summary.fields.some(field => field.code === 'all_entity_only'));
  assert.equal(summary.fields[0].nullable, false);
  assert.equal(summary.fields[0].readOnly, false);
  assert.equal(summary.fields[1].nullable, null);
  assert.equal(summary.fields[1].readOnly, null);
  assert.ok(!Object.hasOwn(summary.fields[0], 'required'), 'Nullable is not request-required inference');
  assert.equal(result.dtoCoverage.resolvedMethodReferences, 2);
});

test('nested DTO cycles remain bounded links and projection sources are not substituted into fields', () => {
  const f = dtoFixture();
  const result = createApiReferenceContract(f.model, { dtoModels: f.models });
  assert.equal(result.dtoSchemas.length, 3);
  assert.equal(result.dtoCoverage.nestedReferences, 3);
  assert.equal(result.dtoCoverage.unresolvedNestedReferences, 0);
  const summary = result.dtoSchemas.find(dto => dto.name === 'page_summary_dto');
  const cycle = summary.fields.find(field => field.code === 'children').links[0];
  assert.equal(cycle.schemaId, summary.id);
  assert.equal(cycle.status, 'resolved');
  const projected = summary.fields.find(field => field.code === 'projection');
  assert.equal(projected.type, 'SIMPLE');
  assert.equal(projected.listMap, true);
  assert.equal(projected.links[0].kind, 'related-source');
  assert.equal(projected.links[0].field, 'source_name');
  assert.equal(summary.fields.find(field => field.code === 'details').links[0].kind, 'reference');
});

test('unavailable model, missing DTO and undeclared field list remain visibly unresolved', () => {
  for (const [change, reason] of [
    [f => f.models.delete(f.pagePath), 'entity-model-unavailable'],
    [f => { f.models.get(f.pagePath).getAllPSDEMethodDTOs = []; }, 'dto-not-declared'],
    [f => { delete f.models.get(f.pagePath).getAllPSDEMethodDTOs[0].getPSDEMethodDTOFields; }, 'dto-fields-not-declared'],
  ]) {
    const f = dtoFixture();
    change(f);
    const result = createApiReferenceContract(f.model, { dtoModels: f.models });
    const page = result.entities.find(entity => entity.code === 'page');
    assert.equal(page.operations[0].output.status, 'unresolved');
    assert.equal(page.operations[0].output.reason, reason);
    const schema = result.dtoSchemas.find(dto => dto.name === 'page_summary_dto');
    assert.deepEqual(schema.fields, []);
    const markdown = renderApiReferenceFiles(result).get('api-reference/en/entities/page.md').toString();
    assert.ok(markdown.includes(reason));
    assert.ok(markdown.includes('DTO field declaration cannot be resolved'));
  }
  const f = dtoFixture();
  f.models.get(f.childPath).getAllPSDEMethodDTOs[0].getPSDEMethodDTOFields = [];
  const result = createApiReferenceContract(f.model, { dtoModels: f.models });
  assert.equal(result.dtoCoverage.unresolvedNestedReferences, 1);
  assert.equal(result.dtoCoverage.unresolved[0].reason, 'related-field-not-declared');
});

test('DTO bilingual anchors, method links, field metadata and searchable schemas remain equivalent and safe', () => {
  const f = dtoFixture();
  f.models.get(f.pagePath).getAllPSDEMethodDTOs[0].getPSDEMethodDTOFields[0].logicName =
    '<img src=x onerror=alert(1)>|[unsafe]';
  const result = createApiReferenceContract(f.model, { dtoModels: f.models });
  const files = renderApiReferenceFiles(result);
  const zh = files.get('api-reference/zh-CN/entities/page.md').toString();
  const en = files.get('api-reference/en/entities/page.md').toString();
  const anchors = text => [...text.matchAll(/:id=(dto-[a-f0-9]{16})/g)].map(match => match[1]);
  assert.equal(anchors(zh).length, 3);
  assert.deepEqual(anchors(zh), anchors(en));
  for (const language of ['zh-CN', 'en']) {
    const markdown = files.get(`api-reference/${language}/entities/page.md`).toString();
    for (const schema of result.dtoSchemas) {
      assert.ok(markdown.includes(`?id=${schema.anchor}`));
      assert.ok(markdown.includes(`:id=${schema.anchor}`));
    }
    assert.doesNotMatch(markdown, /<img|private-default-must-not-publish/);
    assert.ok(markdown.includes('`PAGE` / [page_summary_dto]'));
    assert.ok(markdown.includes('`N_NAME_LIKE`'));
    const search = JSON.parse(files.get(`api-reference/${language}/search.json`));
    assert.ok(search.entries.some(entry => entry.code === 'page_summary_dto' && entry.path.includes('?id=dto-')));
  }
  assert.equal(JSON.parse(files.get('api-reference/manifest.json')).dtoPolicy.runtimeSerializationVerified, false);
});

test('malformed DTO paths, types, duplicate fields and typed metadata fail rather than inventing schemas', () => {
  const changes = [
    f => { f.model.getPSDEServiceAPIs[0].getPSDataEntity.path = 'PSMODULES/../secret.json'; },
    f => { f.models.get(f.pagePath).getAllPSDEMethodDTOs.push(f.models.get(f.pagePath).getAllPSDEMethodDTOs[0]); },
    f => { f.models.get(f.pagePath).getAllPSDEMethodDTOs[0].getPSDEMethodDTOFields.push({ name: 'ID', type: 'SIMPLE' }); },
    f => { f.models.get(f.pagePath).getAllPSDEMethodDTOs[0].getPSDEMethodDTOFields[0].name = '../id'; },
    f => { f.models.get(f.pagePath).getAllPSDEMethodDTOs[0].getPSDEMethodDTOFields[0].readOnly = 'false'; },
    f => { f.models.get(f.pagePath).getAllPSDEMethodDTOs[0].getPSDEMethodDTOFields[0].allowEmpty = 0; },
    f => { f.models.get(f.pagePath).getAllPSDEMethodDTOs[0].getPSDEMethodDTOFields[0].stdDataType = '<script>'; },
    f => { f.models.get(f.pagePath).getAllPSDEMethodDTOs[0].getPSDEMethodDTOFields[0].type = 'EXECUTE'; },
    f => { f.models.get(f.pagePath).getAllPSDEMethodDTOs[0].getPSDEMethodDTOFields[1].getRefPSDataEntity.path = '/private/file.json'; },
  ];
  for (const change of changes) {
    const f = dtoFixture();
    change(f);
    assert.throws(() => createApiReferenceContract(f.model, { dtoModels: f.models }));
  }
});

async function dtoBuildFixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'plm-dto-reference-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sourceDirectory = join(directory, 'plm/doc/docsify');
  await mkdir(sourceDirectory, { recursive: true });
  const f = dtoFixture();
  const inputs = new Map([
    ['PSSYSSERVICEAPIS/ServiceAPI.json', f.model],
    ...f.models,
  ]);
  for (const [path, value] of inputs) {
    const target = join(directory, 'plm/model', path);
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, JSON.stringify(value));
  }
  return { directory, sourceDirectory, ...f };
}

test('actual build binds only participating authority models and exposes the two real field-definition gaps', async () => {
  const files = await buildApiReferenceFiles({ sourceDirectory: new URL('plm/doc/docsify', workspace).pathname });
  const manifest = JSON.parse(files.get('api-reference/manifest.json'));
  assert.equal(files.size, 365);
  assert.deepEqual(manifest.dtoCoverage, {
    methodReferences: 7829, resolvedMethodReferences: 7827, unresolvedMethodReferences: 2,
    directSchemas: 390, schemas: 398, resolvedSchemas: 396, fields: 5373,
    filterSchemas: 171, nestedReferences: 131, unresolvedNestedReferences: 1,
    unresolved: [
      { modelPath: 'PSMODULES/Base/PSDATAENTITIES/view_theme_setting.json', dto: 'view_theme_setting_usr1014979662dto', reason: 'dto-fields-not-declared' },
      { modelPath: 'PSMODULES/ProdMgmt/PSDATAENTITIES/idea.json', dto: 'idea_def_group_common_dto', reason: 'dto-fields-not-declared' },
      { modelPath: 'PSMODULES/Base/PSDATAENTITIES/view_theme_setting.json', dto: 'view_theme_setting_usr1014979662dto', field: null, reason: 'dto-fields-not-declared' },
    ],
  });
  const inputs = manifest.inputHashes.filter(input => input.role === 'dto-model');
  assert.equal(inputs.length, 177);
  assert.equal(new Set(inputs.map(input => input.modelPath)).size, 177);
  assert.ok(manifest.inputHashes.some(input => input.role === 'dto-generator'));
  for (const input of inputs) {
    assert.match(input.modelPath, /^(?:PSSYSMODELGROUPS\/\w+\/)?PSMODULES\/\w+\/PSDATAENTITIES\/\w+\.json$/);
    const bytes = await readFile(new URL(`plm/model/${input.modelPath}`, workspace));
    assert.equal(input.sha256, createHash('sha256').update(bytes).digest('hex'));
    assert.equal(input.bytes, bytes.length);
  }
  const page = files.get('api-reference/en/entities/article_page.md').toString();
  assert.ok(page.includes('article_page_ai_info_dto'));
  assert.ok(page.includes('DTO Field Declarations'));
  const idea = files.get('api-reference/en/entities/idea.md').toString();
  assert.ok(idea.includes('dto-fields-not-declared'));
});

test('DTO model symlink and hardlink inputs cannot bypass authoritative reads', async t => {
  for (const mode of ['symlink', 'hardlink']) {
    const f = await dtoBuildFixture(t);
    const target = join(f.directory, 'plm/model', f.childPath);
    const bytes = await readFile(target);
    await rm(target);
    const other = join(f.directory, 'private.json');
    await writeFile(other, bytes);
    if (mode === 'symlink') await symlink(other, target);
    else await link(other, target);
    await assert.rejects(buildApiReferenceFiles({ sourceDirectory: f.sourceDirectory }));
  }
});

test('a missing referenced DTO authority file renders an unresolved dependency without entity-field fallback', async t => {
  const f = await dtoBuildFixture(t);
  await rm(join(f.directory, 'plm/model', f.childPath));
  const files = await buildApiReferenceFiles({ sourceDirectory: f.sourceDirectory });
  const manifest = JSON.parse(files.get('api-reference/manifest.json'));
  assert.equal(manifest.dtoCoverage.unresolvedNestedReferences, 2);
  assert.ok(manifest.dtoCoverage.unresolved.some(issue =>
    issue.modelPath === f.childPath && issue.reason === 'entity-model-unavailable'));
  assert.ok(!manifest.inputHashes.some(input => input.modelPath === f.childPath));
  const page = files.get('api-reference/en/entities/page.md').toString();
  assert.ok(page.includes('entity-model-unavailable'));
  assert.equal((page.match(/\| `source_name` \|/g) ?? []).length, 0);
});

test('multi-source final metadata validation rejects an input touched during graph loading', async t => {
  const f = await dtoBuildFixture(t);
  const modulePath = fileURLToPath(new URL('../../plm/doc/tools/api-reference.mjs', import.meta.url));
  const first = join(f.directory, 'plm/model', f.pagePath);
  const later = join(f.directory, 'plm/model', f.childPath);
  const script = `
    import fs from 'node:fs/promises';
    import { syncBuiltinESMExports } from 'node:module';
    const [modulePath, first, later, sourceDirectory] = process.argv.slice(1);
    const original = fs.open;
    let touched = false;
    fs.open = async function(path, ...args) {
      const handle = await original.call(this, path, ...args);
      if (path === later && !touched) {
        touched = true;
        const time = new Date(Date.now() + 60000);
        await fs.utimes(first, time, time);
      }
      return handle;
    };
    syncBuiltinESMExports();
    const { buildApiReferenceFiles } = await import(modulePath);
    try { await buildApiReferenceFiles({ sourceDirectory }); process.exitCode = 2; }
    catch (error) {
      if (!touched || !/metadata changed during multi-source generation/.test(error.message)) throw error;
      console.log('rejected-mixed-input-metadata');
    }
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', script,
    modulePath, first, later, f.sourceDirectory], { encoding: 'utf8', timeout: 10000 });
  assert.equal(result.status, 0, result.stderr || result.error?.message);
  assert.match(result.stdout, /rejected-mixed-input-metadata/);
});
