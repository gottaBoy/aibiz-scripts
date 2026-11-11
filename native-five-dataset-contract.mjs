import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dumpTableDefinitions, mergeModelSchema } from './model-fixture-schema.mjs';
import { PinnedDirectories, readPinnedFile } from './native-candidate-files.mjs';

const workspaceDefault = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const modelRoot = 'vendor-upstream/ibizmodeling-standard/modelapi-core/src/main/resources/model/net/ibizsys/modeling';
const hash = value => createHash('sha256').update(value).digest('hex');
const dumpPath = 'modelingservice/sql/sCloud9471c1eca.sql';
const specs = [
  { entity: 'PSSysDBScheme', query: 'CurSys', collection: 'pssysdbschemes',
    nativeExtras: { dslink: 'DEFAULT' } },
  { entity: 'PSSysApp', query: 'CurSys', collection: 'pssysapps',
    nativeExtras: { apppkgname: '$UNIQUE_IDENTIFIER_PACKAGE',
      pspfid: '$OBSERVED_PLATFORM_ID', pspfstyleid: '$OBSERVED_STYLE_ID',
      psapptypeid: '$OBSERVED_APP_TYPE_ID', psapptypename: '$OBSERVED_APP_TYPE_NAME' } },
  { entity: 'PSSysSFPub', query: 'CurSys2', collection: 'pssyssfpubs',
    nativeExtras: { ppssyssfpubid: null } },
  { entity: 'PSSysServiceAPI', query: 'CurSys', collection: 'pssysserviceapis',
    nativeExtras: { codename: '$UNIQUE_IDENTIFIER_MAX40', apitype: 'RESTFUL', validflag: 1, ver: 1 } },
  { entity: 'PSSubSysServiceAPI', query: 'CurSys', collection: 'pssubsysserviceapis',
    nativeExtras: { codename: '$UNIQUE_IDENTIFIER_MAX60', apitype: 'RESTFUL',
      validflag: 1, apisource: 'NONE' } },
];

function queryRelations(sql) {
  const relations = [];
  for (const line of sql.split('\n').filter(line => /^(?:FROM|LEFT JOIN)\b/.test(line))) {
    const base = /^FROM `([A-Z][A-Z0-9_]*)` (t[0-9]+)\s*$/.exec(line);
    if (base) {
      relations.push({ kind: 'FROM', table: base[1].toLowerCase(), alias: base[2] });
      continue;
    }
    const joined = /^LEFT JOIN `([A-Z][A-Z0-9_]*)` (t[0-9]+) ON (t[0-9]+)\.`([A-Z][A-Z0-9_]*)` = (t[0-9]+)\.`([A-Z][A-Z0-9_]*)`\s*$/.exec(line);
    assert.ok(joined, 'Unreviewed five-dataset SQL join grammar');
    relations.push({ kind: 'LEFT JOIN', table: joined[1].toLowerCase(), alias: joined[2],
      on: { leftAlias: joined[3], leftField: joined[4], rightAlias: joined[5], rightField: joined[6] },
      matchingRowRequiredForFetch: false });
  }
  assert.equal(relations.filter(row => row.kind === 'FROM').length, 1);
  assert.equal(new Set(relations.map(row => row.alias)).size, relations.length);
  return relations;
}

function describeField(field) {
  return {
    field: field.name.toLowerCase(), nativeField: field.name, fieldType: field.dEFType,
    required: field.allowEmpty === false, length: field.stringLength,
    predefinedType: field.predefinedType, linkField: field.linkDEField === true,
    defaultValue: field.defaultValue, defaultValueType: field.defaultValueType,
    relatedEntity: field.getRelatedPSDataEntity?.path,
    codeList: field.getPSCodeList?.path,
  };
}

function readLargePinnedDump(directories, directory, name) {
  assert.equal(name, 'sCloud9471c1eca.sql');
  directories.verify(directory);
  const path = directories.entry(directory, name);
  const before = fs.lstatSync(path);
  assert.ok(before.isFile() && !before.isSymbolicLink() && before.size <= 128 * 1024 * 1024);
  const descriptor = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(descriptor);
    assert.equal(opened.dev, before.dev);
    assert.equal(opened.ino, before.ino);
    const data = fs.readFileSync(descriptor);
    for (const current of [fs.fstatSync(descriptor), fs.lstatSync(path)]) {
      for (const field of ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs']) {
        assert.equal(current[field], opened[field], 'Source SQL dump changed during read-only inspection');
      }
    }
    assert.equal(data.length, opened.size);
    directories.verify(directory);
    return { data };
  } finally { fs.closeSync(descriptor); }
}

export function readNativeFiveDatasetContract({ workspace = workspaceDefault } = {}) {
  workspace = resolve(workspace);
  const directories = new PinnedDirectories();
  const inputs = new Map();
  const read = path => {
    assert.ok(path.startsWith(`${workspace}/`));
    const previous = inputs.get(path);
    if (previous) return previous.bytes;
    const directory = directories.open(dirname(path));
    const file = path === join(workspace, dumpPath) ? readLargePinnedDump(directories, directory, basename(path))
      : readPinnedFile(directories, directory, basename(path));
    inputs.set(path, { bytes: file.data, sha256: hash(file.data) });
    return file.data;
  };
  const model = path => JSON.parse(read(join(workspace, modelRoot, path)));
  try {
    const api = model('PSSYSSERVICEAPIS/ModelAPI.json');
    const schemaSources = ['DEFAULT', 'DB2', 'DB3'].map(link => ({
      link, model: model(`PSSYSDBSCHEMES/${link}.json`),
    }));
    const merged = mergeModelSchema(schemaSources);
    const dump = dumpTableDefinitions(read(join(workspace, dumpPath)).toString('utf8'));
    const allColumns = new Map([...merged].map(([table, fields]) =>
      [table, new Set([...(dump.get(table)?.columns ?? []), ...fields.keys()])]));
    const databaseModes = model('PSMODULES/Config/PSCODELISTS/SysDeployDBMode.json');
    assert.ok(databaseModes.getPSCodeItems.some(item => item.value === 'DEFAULT'));
    const apiTypes = model('PSMODULES/Config/PSCODELISTS/ServiceAPIType.json');
    assert.ok(apiTypes.getPSCodeItems.some(item => item.value === 'RESTFUL'));
    const datasets = specs.map(spec => {
      const entityPath = `PSMODULES/SysDesign/PSDATAENTITIES/${spec.entity}.json`;
      const entity = model(entityPath);
      assert.equal(entity.dSLink, 'DB2');
      assert.equal(entity.logicValid, false);
      assert.equal(entity.enableCreate, true);
      assert.equal(entity.enableRemove, true);
      const nativeActions = {};
      for (const name of ['Create', 'Remove']) {
        const action = entity.getAllPSDEActions.find(row => row.name === name);
        assert.ok(action?.dynaModelFilePath);
        assert.deepEqual(model(action.dynaModelFilePath), action, 'Standalone/embedded native action model drift');
        assert.equal(action.actionType, 'BUILTIN');
        nativeActions[name] = {
          sourcePath: action.dynaModelFilePath, mode: action.actionMode,
          prepareLast: action.prepareLast === true, batch: action.batchAction === true,
          lifecycle: 'Native common runtime hooks still apply; absence of inline action logics is not zero-side-effect proof',
        };
      }
      const queryPath = `PSMODULES/SysDesign/PSDATAENTITIES/${spec.entity}/PSDEDATAQUERIES/${spec.query}/PSDEDQCODES/MYSQL5.json`;
      const query = model(queryPath);
      assert.equal(query.dBType, 'MYSQL5');
      assert.equal(query.getPSDEDataQueryCodeConds.length, 1);
      const predicate = query.getPSDEDataQueryCodeConds[0].customCond;
      assert.equal(predicate, spec.query === 'CurSys2'
        ? '( t1.`PSSYSTEMID` = #{ctx.datacontext.pssystemid}  AND  t1.`PPSSYSSFPUBID` IS NULL )'
        : '( t1.`PSSYSTEMID` = #{ctx.datacontext.pssystemid} )');
      const dataset = entity.getAllPSDEDataSets.find(row => row.name === spec.query);
      assert.deepEqual(dataset.getPSDEDataQueries.map(row => row.id), [spec.query]);
      const published = api.getPSDEServiceAPIs.find(row => row.name === entity.name);
      const relation = api.getPSDEServiceAPIRSs.filter(row =>
        row.getMajorPSDEServiceAPI.id === 'PSDevSlnSys' && row.getMinorPSDEServiceAPI.id === spec.entity);
      assert.equal(relation.length, 1);
      const methods = {};
      for (const method of ['Create', 'Remove', `Fetch${spec.query}`]) {
        const matches = relation[0].getPSDEServiceAPIMethods.filter(row => row.name === method);
        assert.equal(matches.length, 1);
        const entry = matches[0];
        assert.equal(published.getPSDEServiceAPIMethods.filter(row => row.name === method).length, 1);
        methods[method] = {
          method: entry.requestMethod, permission: entry.dataAccessAction,
          inputType: entry.getPSDEServiceAPIMethodInput.type,
          returnType: entry.getPSDEServiceAPIMethodReturn.type, needResourceKey: entry.needResourceKey === true,
          dto: entry.getPSDEServiceAPIMethodReturn.getPSDEMethodDTO?.id,
        };
      }
      assert.deepEqual([methods.Create.method, methods.Create.permission, methods.Create.returnType],
        ['POST', 'CREATE', 'DTO']);
      assert.deepEqual([methods.Remove.method, methods.Remove.permission, methods.Remove.returnType],
        ['DELETE', 'DELETE', 'VOID']);
      assert.deepEqual([methods[`Fetch${spec.query}`].method, methods[`Fetch${spec.query}`].permission],
        ['POST', 'READ']);
      const table = entity.tableName.toLowerCase();
      const relations = queryRelations(query.queryCode);
      assert.equal(relations[0].table, table);
      const aliases = new Map(relations.map(row => [row.alias, row.table]));
      for (const [full, alias, field] of (query.queryCode + predicate).matchAll(/\b(t[0-9]+)\.`([A-Z][A-Z0-9_]*)`/g)) {
        assert.ok(allColumns.get(aliases.get(alias))?.has(field), `Missing source schema dependency ${full}`);
      }
      const definition = dump.get(table);
      assert.ok(definition, 'Require an actual dump CREATE TABLE, never dump seed rows');
      const mandatoryDDL = definition.ddl.split('\n').filter(line => /^  `/.test(line) && /\bNOT NULL\b/.test(line));
      assert.equal(mandatoryDDL.length, 1, 'Reassess minimum SQL prerequisites after schema changes');
      assert.ok(mandatoryDDL[0].startsWith(`  \`${entity.getKeyPSDEField.name}\``));
      const dto = entity.getAllPSDEMethodDTOs.find(row => row.name === `${spec.entity}DTO`);
      assert.ok(dto?.getPSDEMethodDTOFields);
      const dtoNames = new Set(dto.getPSDEMethodDTOFields.map(field => field.name.toLowerCase()));
      const key = entity.getKeyPSDEField.name.toLowerCase();
      const major = entity.getMajorPSDEField.name.toLowerCase();
      const nativePayload = {
        [key]: '$FRESH_CASE_UUID_OR_ACCEPT_NATIVE_RETURNED_ID',
        [major]: '$RUN_SIDE_ENTITY_SPECIFIC_NAME',
        pssystemid: '$ACTUAL_ROOT_LOGICAL_SYSTEM_ID',
        pssystemname: '$ACTUAL_ROOT_PHYSICAL_SYSTEM_NAME',
        usertag: '$RUN_SIDE_NONCE_MARKER',
        ...spec.nativeExtras,
      };
      assert.ok(Object.keys(nativePayload).every(field => dtoNames.has(field)));
      const select = query.queryCode.slice(0, query.queryCode.indexOf('\nFROM ')).split('\n');
      assert.equal(select.shift(), 'SELECT');
      const projection = select.map(line => {
        const expression = /^(t[0-9]+)\.`([A-Z][A-Z0-9_]*)`(?: AS `([A-Z][A-Z0-9_]*)`)?[,]?$/.exec(line);
        assert.ok(expression, 'Unreviewed native SELECT projection');
        const field = (expression[3] ?? expression[2]).toLowerCase();
        const sql = `${expression[1]}.\`${expression[2]}\``;
        assert.ok(query.getPSDEDataQueryCodeExps.some(row =>
          row.name.toLowerCase() === field && row.expression === sql));
        return { field, expression: sql };
      });
      assert.ok([key, major, 'pssystemid', 'usertag'].every(field =>
        projection.some(item => item.field === field)));
      return {
        entity: spec.entity, table, sourceEntity: entityPath, sourceQuery: queryPath,
        dataSource: 'DB2', query: spec.query, predicate, methods, nativeActions,
        collectionPath: `/api/ibizmodeling__modeldesign/psdevslnsys/$ROOT_ID/${spec.collection}`,
        fetchPath: `/api/ibizmodeling__modeldesign/psdevslnsys/$ROOT_ID/${spec.collection}/fetch${spec.query.toLowerCase()}`,
        removePath: `/api/ibizmodeling__modeldesign/psdevslnsys/$ROOT_ID/${spec.collection}/$RECEIPTED_KEY`,
        fetchBody: { pssystemid: '$ACTUAL_ROOT_LOGICAL_SYSTEM_ID', page: 0, size: 1000 },
        keyField: key, nameField: major, nativeCreatePayloadTemplate: nativePayload,
        requiredPhysicalModelFields: entity.getAllPSDEFields.filter(field =>
          field.allowEmpty === false && field.dEFType === 1 && !field.predefinedType).map(describeField),
        nonphysicalRequiredFields: entity.getAllPSDEFields.filter(field =>
          field.allowEmpty === false && field.dEFType !== 1 && !field.predefinedType).map(describeField),
        sourceDefaults: entity.getAllPSDEFields.filter(field => Object.hasOwn(field, 'defaultValue')).map(describeField),
        nativeCreateReadiness: spec.entity === 'PSSysApp'
          ? 'blocked-until-real-platform-style-app-type-config-is-observed'
          : 'published-native-contract-live-create-not-yet-verified',
        queryRowMinimum: {
          fields: [key, major, 'pssystemid', 'usertag'],
          ...(spec.query === 'CurSys2' ? { requiredNull: ['ppssyssfpubid'] } : {}),
          acceptance: 'SELECT-sentinel-only, not native CREATE validation; no SQL seed is emitted or authorized',
        },
        joins: relations, returnProjection: projection,
        modelExpressionsNotSelected: query.getPSDEDataQueryCodeExps.filter(field =>
          !projection.some(output => output.field === field.name.toLowerCase()))
          .map(field => field.name.toLowerCase()),
        nonemptyReturnChecks: [key, major, 'pssystemid', 'usertag'],
        systemNameProjection: projection.find(field => field.field === 'pssystemname')?.expression,
        sourceSchema: { columns: [...allColumns.get(table)].sort(), dumpMandatoryLines: mandatoryDDL },
      };
    });
    const config = ['PSPF', 'PSPFStyle', 'PSAppType'].map(name => {
      const entityPath = `PSMODULES/Config/PSDATAENTITIES/${name}.json`;
      const entity = model(entityPath);
      const queryPath = `PSMODULES/Config/PSDATAENTITIES/${name}/PSDEDATAQUERIES/Default/PSDEDQCODES/MYSQL5.json`;
      const query = model(queryPath);
      return {
        entity: name, sourceEntity: entityPath, sourceQuery: queryPath, dataSource: entity.dSLink,
        table: entity.tableName.toLowerCase(), key: entity.getKeyPSDEField.name.toLowerCase(),
        name: entity.getMajorPSDEField.name.toLowerCase(),
        readPath: `/api/ibizmodeling__modeldesign/${name.toLowerCase()}s/fetchdefault`,
        method: 'POST', body: { page: 0, size: 1000 }, predicate: query.getPSDEDataQueryCodeConds ?? [],
        joins: queryRelations(query.queryCode),
        warning: 'Read actual native rows under the owned context; this file supplies no fake IDs or rows',
      };
    });
    const runtimePath = 'ibiz-service-hub/libs/ibiz-modeling-core/src/main/java/net/ibizsys/modeling/core/dataentity/DataEntityRuntimeBase.java';
    const runtime = read(join(workspace, runtimePath)).toString('utf8');
    for (const spec of specs) {
      assert.ok(runtime.includes(`sysModelVerMap.put("${spec.entity.toUpperCase()}", "PSSYSTEMID")`));
      assert.ok(runtime.includes(`sysModelLogMap.put("${spec.entity.toUpperCase()}", "")`));
    }
    const fieldCheckPath = 'ibiz-service-hub/libs/ibiz-runtime/src/main/java/net/ibizsys/runtime/dataentity/DataEntityRuntimeBase.java';
    const checks = read(join(workspace, fieldCheckPath)).toString('utf8');
    assert.ok(checks.includes('if (!iPSDEField.isPhisicalDEField())'));
    for (const [path, input] of inputs) {
      const directory = directories.open(dirname(path));
      const current = path === join(workspace, dumpPath) ? readLargePinnedDump(directories, directory, basename(path))
        : readPinnedFile(directories, directory, basename(path));
      assert.equal(hash(current.data), input.sha256, 'Five-dataset source changed during read-only inspection');
    }
    return {
      contract: 'native-five-dataset-readonly-sentinel-contract-v1',
      sourceModelRoot: modelRoot, inputs: [...inputs].map(([path, input]) =>
        ({ path: relative(workspace, path), sha256: input.sha256, bytes: input.bytes.length })),
      schemaTables: { mergedPhysicalTables: merged.size,
        coverage: 'DB2 fixture includes merged DEFAULT/DB2/DB3 native columns plus actual dump columns' },
      datasets, applicationConfig: config,
      lifecycle: {
        nativeCreatePreferred: true, nativeRemovePreferred: true, logicDelete: false,
        expectedSourceEffects: [
          'onAfterCreate and onBeforeRemove call logDEModelVerChanged: native system MODELVER increments',
          'onAfterCreate/onBeforeRemove call logSysModelChanged: PSSysModelLog may be saved',
          'DELETE also attempts case-key PSOBJTYPE/PSOBJID cleanup in T_SRFPSSYSMODELFOLDERITEM',
          'related model cascades and syncSysTask require actual full-column evidence; no blanket audit allowance',
        ],
        baselineRule: 'Existing module/system sentinel identity columns and every unrelated row stay unchanged; record exact observed audit/version deltas separately, never SQL-reset them',
      },
      nativeAcceptance: false, permissionAcceptance: false, sentinelInitializationPerformed: false,
      boundary: 'Read-only source contract and payload templates only; no HTTP, Docker, SQL or database writes',
    };
  } finally { directories.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  assert.equal(process.argv.length, 2, 'Read-only inspection accepts no execution or target options');
  console.log(JSON.stringify(readNativeFiveDatasetContract(), null, 2));
}
