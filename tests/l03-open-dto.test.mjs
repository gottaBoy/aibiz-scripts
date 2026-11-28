import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { link, mkdir, mkdtemp, readFile, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  buildApiReferenceFiles, createApiReferenceContract, renderApiReferenceFiles,
} from '../../plm/doc/tools/api-reference.mjs';
import { openDtoRuntimeInputs } from '../../plm/doc/tools/api-reference-dto.mjs';

const workspace = fileURLToPath(new URL('../../', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const ideaPath = 'PSMODULES/ProdMgmt/PSDATAENTITIES/idea.json';
const settingPath = 'PSMODULES/Base/PSDATAENTITIES/view_theme_setting.json';
const ideaDto = 'idea_def_group_common_dto';
const settingDto = 'view_theme_setting_usr1014979662dto';
const oldGeneratorRevision = '8a13b29cdc21832366c31d7c1103dae7ce4018da';
const openObject = { type: 'object', additionalProperties: true };
const frontendRequire = createRequire(new URL('../../plm-web/package.json', import.meta.url));
const Ajv = createRequire(frontendRequire.resolve('eslint/package.json'))('ajv');
const json = async path => JSON.parse(await readFile(join(workspace, 'plm/model', path)));
const runtimeSources = new Map(await Promise.all(openDtoRuntimeInputs().map(async source =>
  [source.workspacePath, await readFile(join(workspace, source.workspacePath))])));
const idea = await json(ideaPath);
const setting = await json(settingPath);
const system = await json('PSSYSTEM.json');
const searchConds = setting.getAllPSDEMethodDTOs.find(dto => dto.name === 'view_theme_setting_dto')
  .getPSDEMethodDTOFields.find(field => field.name === 'search_conds');

function fixture() {
  const operation = dto => ({
    name: 'Read', requestMethod: 'GET', noServiceCodeName: true,
    getPSDEServiceAPIMethodReturn: { type: 'DTO', getPSDEMethodDTO: { id: dto } },
  });
  const serviceEntity = (code, path, dto) => ({
    codeName: code, codeName2: `${code}s`, major: true,
    getPSDataEntity: { path }, getPSDEServiceAPIMethods: [operation(dto)],
  });
  return {
    service: {
      codeName: 'ServiceAPI', getPSDEServiceAPIRSs: [],
      getPSDEServiceAPIs: [
        serviceEntity('idea', ideaPath, ideaDto),
        serviceEntity('view_theme_setting', settingPath, 'view_theme_setting_dto'),
      ],
    },
    models: structuredClone(new Map([
      [ideaPath, { getAllPSDEMethodDTOs: [idea.getAllPSDEMethodDTOs.find(dto => dto.name === ideaDto)] }],
      [settingPath, { getAllPSDEMethodDTOs: [
        { name: 'view_theme_setting_dto', type: 'DEFAULT', getPSDEMethodDTOFields: [searchConds] },
        setting.getAllPSDEMethodDTOs.find(dto => dto.name === settingDto),
      ] }],
      ['PSSYSTEM.json', { getAllPSSysMethodDTOs: [
        system.getAllPSSysMethodDTOs.find(dto => dto.name === 'Usr1014979662DTO'),
      ] }],
    ])),
    sources: new Map(runtimeSources),
  };
}

const build = f => createApiReferenceContract(f.service, {
  dtoModels: f.models, dtoRuntimeSources: f.sources,
});
const dto = (contract, name) => contract.dtoSchemas.find(schema => schema.name === name);

test('reviewed real declarations resolve as open objects without invented typed fields', () => {
  const contract = build(fixture());
  for (const name of [ideaDto, settingDto]) {
    const schema = dto(contract, name);
    assert.equal(schema.status, 'resolved');
    assert.deepEqual(schema.fields, []);
    assert.deepEqual(schema.jsonSchema, openObject);
    assert.deepEqual(schema.fieldDeclaration,
      { status: 'undeclared', reason: 'dto-fields-not-declared' });
    assert.equal(schema.openObject.runtimeSerializationVerified, false);
    for (const key of ['fieldNames', 'valueTypes', 'nullable', 'validation']) {
      assert.equal(schema.openObject[key], 'unspecified');
    }
    for (const source of schema.openObject.sources) {
      assert.equal(hash(runtimeSources.get(source.workspacePath)), source.sha256);
    }
  }
  assert.deepEqual(dto(contract, 'view_theme_setting_dto').fields[0].jsonSchema,
    { type: 'array', items: openObject });
  assert.equal(contract.dtoCoverage.unresolvedMethodReferences, 0);
  assert.equal(contract.dtoCoverage.unresolvedNestedReferences, 0);
  assert.equal(contract.dtoCoverage.openObjectSchemas, 2);
  assert.equal(contract.dtoCoverage.declaredFieldSchemas, 1);
  assert.equal(contract.dtoCoverage.fields, 1);
});

test('fieldless declarations, filters and source metadata drift never imply openness', async t => {
  const cases = [
    ['missing runtime evidence', f => { f.sources.clear(); }],
    ['changed runtime source', f => {
      const [path, bytes] = f.sources.entries().next().value;
      f.sources.set(path, Buffer.concat([bytes, Buffer.from('\n')]));
    }],
    ['unknown source type', f => { f.models.get(ideaPath).getAllPSDEMethodDTOs[0].sourceType = 'OTHER'; }],
    ['filter DTO', f => { f.models.get(ideaPath).getAllPSDEMethodDTOs[0].type = 'DEFILTER'; }],
    ['different entity path', f => {
      f.models.set(ideaPath.replace('idea', 'other'), f.models.get(ideaPath));
      f.models.delete(ideaPath);
    }],
    ['extra declaration metadata', f => {
      f.models.get(ideaPath).getAllPSDEMethodDTOs[0].readOnly = true;
    }],
  ];
  for (const [name, mutate] of cases) await t.test(name, () => {
    const f = fixture();
    mutate(f);
    const schema = dto(build(f), ideaDto);
    assert.equal(schema.status, 'unresolved');
    assert.equal(schema.openObject, undefined);
    assert.equal(schema.jsonSchema, undefined);
  });
});

test('every pinned source is required unchanged for its reviewed open object', async t => {
  for (const source of openDtoRuntimeInputs()) {
    for (const mode of ['missing', 'changed']) await t.test(`${mode}: ${source.workspacePath}`, () => {
      const f = fixture();
      if (mode === 'missing') f.sources.delete(source.workspacePath);
      else f.sources.set(source.workspacePath, Buffer.concat([
        f.sources.get(source.workspacePath), Buffer.from('\n'),
      ]));
      const name = source.workspacePath.includes('ViewThemeSettingUsr') ? settingDto : ideaDto;
      const schema = dto(build(f), name);
      assert.equal(schema.status, 'unresolved');
      assert.equal(schema.jsonSchema, undefined);
    });
  }
});

test('JSON Schema accepts empty and arbitrary objects without adding field validation promises', () => {
  const contract = build(fixture());
  const ajv = new Ajv({ allErrors: true });
  for (const name of [ideaDto, settingDto]) {
    const schema = dto(contract, name).jsonSchema;
    assert.equal(ajv.validateSchema(schema), true);
    const validate = ajv.compile(schema);
    for (const value of [{}, { arbitrary: null }, { nested: [1, '中文', {}, false] }]) {
      assert.equal(validate(value), true, JSON.stringify(validate.errors));
    }
    for (const value of [null, [], 'text', 1, false]) assert.equal(validate(value), false);
    for (const key of ['properties', 'required', 'nullable', 'patternProperties']) {
      assert.equal(Object.hasOwn(schema, key), false);
    }
  }
  const array = ajv.compile(dto(contract, 'view_theme_setting_dto').fields[0].jsonSchema);
  for (const value of [[], [{}], [{ extra: null }, { more: [1, {}] }]]) assert.equal(array(value), true);
  for (const value of [{}, [1], [null]]) assert.equal(array(value), false);
});

test('missing DTO targets and missing or changed system declarations remain unresolved', async t => {
  const cases = [
    ['missing target DTO', f => { f.models.get(settingPath).getAllPSDEMethodDTOs.pop(); }, 'dto-not-declared'],
    ['missing system model', f => { f.models.delete('PSSYSTEM.json'); }, 'dto-fields-not-declared'],
    ['missing system DTO', f => { f.models.get('PSSYSTEM.json').getAllPSSysMethodDTOs = []; }, 'dto-fields-not-declared'],
    ['changed system source type', f => {
      f.models.get('PSSYSTEM.json').getAllPSSysMethodDTOs[0].sourceType = 'DE';
    }, 'dto-fields-not-declared'],
    ['changed system source reference', f => {
      f.models.get(settingPath).getAllPSDEMethodDTOs[1].getSrcPSSysMethodDTO.id = 'MissingDTO';
    }, 'dto-fields-not-declared'],
  ];
  for (const [name, mutate, reason] of cases) await t.test(name, () => {
    const f = fixture();
    mutate(f);
    const contract = build(f);
    const target = dto(contract, settingDto);
    assert.equal(target.status, 'unresolved');
    assert.equal(target.reason, reason);
    assert.equal(target.jsonSchema, undefined);
    assert.equal(dto(contract, 'view_theme_setting_dto').fields[0].jsonSchema, undefined);
    assert.equal(contract.dtoCoverage.unresolvedNestedReferences, 1);
  });
});

test('explicit empty fields remain authoritative and open objects do not declare related fields', () => {
  const empty = fixture();
  empty.models.get(ideaPath).getAllPSDEMethodDTOs[0].getPSDEMethodDTOFields = [];
  const schema = dto(build(empty), ideaDto);
  assert.equal(schema.status, 'resolved');
  assert.deepEqual(schema.fields, []);
  assert.equal(schema.openObject, undefined);

  const related = fixture();
  related.models.get(settingPath).getAllPSDEMethodDTOs[0].getPSDEMethodDTOFields.push({
    name: 'projection', type: 'SIMPLE',
    getRelatedPSDataEntity: { path: settingPath },
    getRelatedPSDEMethodDTO: { id: settingDto },
    getRelatedPSDEMethodDTOField: { id: 'not_declared' },
  });
  const result = build(related);
  const link = dto(result, 'view_theme_setting_dto').fields[1].links[0];
  assert.equal(dto(result, settingDto).status, 'resolved');
  assert.equal(link.status, 'unresolved');
  assert.equal(link.reason, 'related-field-not-declared');
});

test('nested DTO and explicit map-list wrappers preserve their own model shape', () => {
  for (const [type, listMap, shape] of [
    ['DTO', undefined, openObject],
    ['DTOS', true, { type: 'object', additionalProperties: openObject }],
  ]) {
    const f = fixture();
    Object.assign(f.models.get(settingPath).getAllPSDEMethodDTOs[0].getPSDEMethodDTOFields[0],
      { type, ...(listMap === undefined ? {} : { listMap }) });
    assert.deepEqual(dto(build(f), 'view_theme_setting_dto').fields[0].jsonSchema, shape);
  }
});

test('bilingual documentation and full-text search include openness and retain undeclared-field evidence', () => {
  const files = renderApiReferenceFiles(build(fixture()));
  for (const [language, heading] of [['en', 'Open Object Structure'], ['zh-CN', '开放对象结构']]) {
    const page = files.get(`api-reference/${language}/entities/view_theme_setting.md`).toString();
    assert.ok(page.includes(heading));
    assert.match(page, /"additionalProperties": true/);
    assert.match(page, /"type": "array"/);
    assert.match(page, /system-dto-fields-not-declared/);
    assert.match(page, /dto-fields-not-declared/);
    const search = JSON.parse(files.get(`api-reference/${language}/search.json`));
    const entry = search.entries.find(entry => entry.code === settingDto);
    assert.ok(entry.body.includes(heading));
    assert.ok(entry.body.includes('additionalProperties'));
    assert.ok(page.includes(entry.body));
  }
  const manifest = JSON.parse(files.get('api-reference/manifest.json'));
  assert.equal(manifest.dtoCoverage.fields, 1);
  assert.equal(manifest.dtoCoverage.openObjectSchemas, 2);
  assert.equal(manifest.dtoPolicy.runtimeSerializationVerified, false);
  assert.equal(manifest.runtimeAcceptance, false);
});

test('old committed generator is a negative control for the same real declarations and source evidence', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'l03-open-dto-old-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  for (const name of ['api-reference.mjs', 'api-reference-dto.mjs', 'api-reference-logic.mjs']) {
    const bytes = execFileSync('git', ['show', `${oldGeneratorRevision}:doc/tools/${name}`], {
      cwd: join(workspace, 'plm'), maxBuffer: 32 * 1024 * 1024,
    });
    await writeFile(join(directory, name), bytes);
  }
  const old = await import(pathToFileURL(join(directory, 'api-reference.mjs')));
  const f = fixture();
  const contract = old.createApiReferenceContract(f.service, {
    dtoModels: f.models, dtoRuntimeSources: f.sources,
  });
  assert.equal(dto(contract, ideaDto).status, 'unresolved');
  assert.equal(dto(contract, settingDto).status, 'unresolved');
  assert.equal(contract.dtoCoverage.unresolvedMethodReferences, 1);
  assert.equal(contract.dtoCoverage.unresolvedNestedReferences, 1);
});

test('new source evidence obeys the existing symlink and hardlink input guards', async t => {
  for (const mode of ['symlink', 'hardlink']) await t.test(mode, async t => {
    const directory = await mkdtemp(join(tmpdir(), 'l03-open-dto-input-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const f = fixture();
    const put = async (path, bytes) => {
      const target = join(directory, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes);
    };
    await mkdir(join(directory, 'plm/doc/docsify'), { recursive: true });
    await put('plm/model/PSSYSSERVICEAPIS/ServiceAPI.json', JSON.stringify(f.service));
    for (const [path, value] of f.models) await put(`plm/model/${path}`, JSON.stringify(value));
    for (const [path, bytes] of f.sources) await put(path, bytes);
    const [path, bytes] = f.sources.entries().next().value;
    const source = join(directory, 'private-source-copy');
    const target = join(directory, path);
    await writeFile(source, bytes);
    await unlink(target);
    if (mode === 'symlink') await symlink(source, target);
    else await link(source, target);
    await assert.rejects(buildApiReferenceFiles({ sourceDirectory: join(directory, 'plm/doc/docsify') }),
      { code: 'ERR_ASSERTION' });
  });
});

test('independent clean committed-input exports rebuild identical candidate output and bind runtime sources', async t => {
  const current = await buildApiReferenceFiles({
    sourceDirectory: join(workspace, 'plm/doc/docsify'),
  });
  const inputs = JSON.parse(current.get('api-reference/manifest.json')).inputHashes;
  const exports = [];
  const revisions = new Map();
  for (let index = 0; index < 2; index++) {
    const directory = await mkdtemp(join(tmpdir(), 'l03-open-dto-clean-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    await mkdir(join(directory, 'plm/doc/docsify'), { recursive: true });
    const paths = new Set([
      'plm/model/PSSYSSERVICEAPIS/ServiceAPI.json',
      'plm-web/src/locale/en.json',
      ...inputs.flatMap(input => input.modelPath ? [`plm/model/${input.modelPath}`] : []),
      ...openDtoRuntimeInputs().map(input => input.workspacePath),
    ]);
    for (const path of [...paths].sort()) {
      const repositoryRoot = execFileSync('git', ['rev-parse', '--show-toplevel'], {
        cwd: dirname(join(workspace, path)),
      }).toString().trim();
      const repository = relative(workspace, repositoryRoot);
      const repositoryPath = relative(repositoryRoot, join(workspace, path));
      if (!revisions.has(repository)) revisions.set(repository,
        execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot }).toString().trim());
      const bytes = execFileSync('git', ['show', `${revisions.get(repository)}:${repositoryPath}`], {
        cwd: repositoryRoot, maxBuffer: 32 * 1024 * 1024,
      });
      const target = join(directory, path);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, bytes);
    }
    for (const name of ['api-reference.mjs', 'api-reference-dto.mjs', 'api-reference-logic.mjs']) {
      const target = join(directory, 'plm/doc/tools', name);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, await readFile(join(workspace, 'plm/doc/tools', name)));
    }
    const module = await import(pathToFileURL(join(directory, 'plm/doc/tools/api-reference.mjs')));
    exports.push(await module.buildApiReferenceFiles({ sourceDirectory: join(directory, 'plm/doc/docsify') }));
  }
  assert.deepEqual([...exports[0].keys()], [...exports[1].keys()]);
  for (const [path, bytes] of exports[0]) {
    assert.equal(hash(bytes), hash(exports[1].get(path)), path);
  }
  const manifest = JSON.parse(exports[0].get('api-reference/manifest.json'));
  assert.equal(exports[0].size, 365);
  assert.equal(manifest.dtoCoverage.openObjectSchemas, 2);
  assert.equal(manifest.dtoCoverage.fields, 5373);
  assert.equal(manifest.dtoCoverage.resolvedMethodReferences, 7829);
  assert.equal(manifest.dtoCoverage.unresolvedMethodReferences, 0);
  assert.equal(manifest.dtoCoverage.unresolvedNestedReferences, 0);
  const bound = manifest.inputHashes.filter(input => input.role === 'dto-open-object-source');
  assert.equal(bound.length, openDtoRuntimeInputs().length);
  for (const input of bound) {
    assert.equal(input.sha256, openDtoRuntimeInputs()
      .find(source => source.workspacePath === input.workspacePath).sha256);
  }
  const receiptDirectory = join(workspace, '.artifacts/l03-open-dto-20261128');
  await mkdir(receiptDirectory, { recursive: true });
  await writeFile(join(receiptDirectory, 'clean-rebuild-receipt.json'), JSON.stringify({
    schemaVersion: 1,
    scope: 'two-independent-clean-committed-input-exports-with-candidate-generators',
    sourceRevisions: Object.fromEntries(revisions),
    generatorHashes: Object.fromEntries(await Promise.all(
      ['api-reference.mjs', 'api-reference-dto.mjs', 'api-reference-logic.mjs'].map(async name =>
        [name, hash(await readFile(join(workspace, 'plm/doc/tools', name)))]))),
    files: [...exports[0]].map(([path, bytes]) => ({ path, sha256: hash(bytes), bytes: bytes.length })),
    dtoCoverage: manifest.dtoCoverage,
    boundRuntimeSources: bound,
    runtimeAcceptance: false,
  }, null, 2));
});
