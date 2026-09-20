#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

cd "$ROOT_DIR"

node <<'NODE'
const fs = require('fs');
const path = require('path');

const rootDir = process.cwd();
const modelDir = path.join(rootDir, 'plm', 'model');
const systemFile = path.join(modelDir, 'PSSYSTEM.json');
const aiModuleFile = path.join(modelDir, 'PSMODULES', 'ai.json');
const appEntityDir = path.join(
  modelDir,
  'PSSYSAPPS',
  'plmweb',
  'PSAPPDATAENTITIES',
);
const entities = [
  { codeName: 'ai_run', codeName2: 'ai_runs' },
  { codeName: 'ai_run_step', codeName2: 'ai_run_steps' },
  { codeName: 'ai_run_event', codeName2: 'ai_run_events' },
];
const codeLists = ['ai_run_status', 'ai_run_step_status'];
const harnessDbIndexes = {
  AI_RUN: [
    {
      codeName: 'IX_AI_RUN_TENANT_USER_CREATE',
      columns: ['TENANT_ID', 'USER_ID', 'CREATE_TIME'],
    },
    {
      codeName: 'IX_AI_RUN_CONVERSATION_CREATE',
      columns: ['CONVERSATION_ID', 'CREATE_TIME'],
    },
    {
      codeName: 'IX_AI_RUN_STATUS_DEADLINE_UPDATE',
      columns: ['STATUS', 'DEADLINE_AT', 'UPDATE_TIME'],
    },
    {
      codeName: 'IX_AI_RUN_RECOVERY_CANDIDATE',
      columns: ['STATUS', 'NEXT_ATTEMPT_AT', 'LEASE_UNTIL'],
    },
    {
      codeName: 'IX_AI_RUN_PARENT_CREATE',
      columns: ['PARENT_RUN_ID', 'CREATE_TIME'],
    },
  ],
  AI_RUN_STEP: [
    {
      codeName: 'IX_AI_RUN_STEP_RUN_SEQUENCE',
      columns: ['RUN_ID', 'SEQUENCE'],
    },
  ],
  AI_RUN_EVENT: [
    {
      codeName: 'IX_AI_RUN_EVENT_RUN_SEQUENCE',
      columns: ['RUN_ID', 'SEQUENCE'],
    },
    {
      codeName: 'IX_AI_RUN_EVENT_STEP_SEQUENCE',
      columns: ['STEP_ID', 'SEQUENCE'],
    },
  ],
};
const harnessUniqueIndexes = [
  'UK_AI_RUN_TENANT_IDEMPOTENCY',
  'UK_AI_RUN_STEP_RUN_SEQUENCE',
  'UK_AI_RUN_STEP_RUN_IDEMPOTENCY',
  'UK_AI_RUN_EVENT_RUN_SEQUENCE',
  'UK_AI_RUN_EVENT_RUN_IDEMPOTENCY',
];
const requiredCrudModes = ['CREATE', 'READ', 'DELETE', 'UPDATE'];
const recoveryFields = {
  lease_owner: { name: 'LEASE_OWNER', dataType: 'TEXT', stdDataType: 25, length: 200 },
  lease_until: { name: 'LEASE_UNTIL', dataType: 'DATETIME', stdDataType: 5 },
  recovery_attempts: { name: 'RECOVERY_ATTEMPTS', dataType: 'INT', stdDataType: 9 },
  next_attempt_at: { name: 'NEXT_ATTEMPT_AT', dataType: 'DATETIME', stdDataType: 5 },
};
const actionCodeNames = {
  CREATE: 'create',
  READ: 'get',
  DELETE: 'remove',
  UPDATE: 'update',
};

let checkCount = 0;
const failures = [];

function relative(file) {
  return path.relative(rootDir, file);
}

function check(condition, message) {
  checkCount += 1;
  if (!condition) {
    failures.push(message);
  }
}

function readJson(file, label) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    failures.push(`${label}: cannot parse ${relative(file)}: ${error.message}`);
    return null;
  }
}

function readModelJson(modelPath, label) {
  const file = path.join(modelDir, modelPath);
  check(fs.existsSync(file), `${label}: missing model reference ${modelPath}`);
  return fs.existsSync(file) ? readJson(file, label) : null;
}

function names(items, key = 'codeName') {
  return Array.isArray(items) ? items.map((item) => item?.[key]) : [];
}

function unique(items) {
  return new Set(items).size === items.length;
}

function sameArray(left, right) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function refId(value) {
  return value?.id || value?.codeName;
}

function dtoFieldNames(dto) {
  return (dto?.getPSDEMethodDTOFields || dto?.getPSDEFilterDTOFields || []).map(
    (field) => field.name,
  );
}

function appDtoFieldNames(dto) {
  return (dto?.getPSAppDEMethodDTOFields || []).map(
    (field) => field.codeName,
  );
}

function hasMethod(api, predicate) {
  return (api.getPSDEServiceAPIMethods || []).some(predicate);
}

const appRegistryFile = path.join(
  modelDir,
  'PSSYSAPPS',
  'plmweb',
  'PSSYSAPP.json',
);
const serviceApiFile = path.join(modelDir, 'PSSYSSERVICEAPIS', 'ServiceAPI.json');
const dbSchemeFile = path.join(
  modelDir,
  'PSSYSDBSCHEMES',
  'DEFAULT.json',
);
const harnessMigrationFile = path.join(
  rootDir,
  'plm',
  'deploy',
  'compose',
  'migrations',
  '001_ai_harness.sql',
);
const appRegistry = readJson(appRegistryFile, 'application registry');
const serviceRegistry = readJson(serviceApiFile, 'service API registry');
const appEntries = appRegistry?.getAllPSAppDataEntities || [];
const serviceApis = serviceRegistry?.getPSDEServiceAPIs || [];
const system = readJson(systemFile, 'system registry');
const aiModule = readJson(aiModuleFile, 'ai module');
const dbScheme = readJson(dbSchemeFile, 'default DB scheme');
let harnessMigration = null;
try {
  harnessMigration = fs.readFileSync(harnessMigrationFile, 'utf8');
} catch (error) {
  failures.push(
    `harness migration: cannot read ${relative(harnessMigrationFile)}: ${error.message}`,
  );
}
const systemEntities = system?.getAllPSDataEntities || [];
const systemCodeLists = system?.getAllPSCodeLists || [];
const dbTables = dbScheme?.getAllPSSysDBTables || [];
const embeddedAiModules = (system?.getAllPSSystemModules || []).filter(
  (module) => module?.codeName === 'ai',
);

check(Array.isArray(system?.getAllPSDataEntities), 'system registry: getAllPSDataEntities is not an array');
check(Array.isArray(system?.getAllPSCodeLists), 'system registry: getAllPSCodeLists is not an array');
check(Array.isArray(system?.getAllPSSystemModules), 'system registry: getAllPSSystemModules is not an array');
check(embeddedAiModules.length === 1, 'system registry: embedded ai module must exist exactly once');
check(
  Array.isArray(dbScheme?.getAllPSSysDBTables),
  'default DB scheme: getAllPSSysDBTables is not an array',
);

for (const entity of entities) {
  const expectedPath = `PSMODULES/ai/PSDATAENTITIES/${entity.codeName}.json`;
  const matches = systemEntities.filter((entry) => entry?.path === expectedPath);
  check(
    matches.length === 1,
    `system registry: ${expectedPath} must be registered exactly once`,
  );
}

for (const codeName of codeLists) {
  const expectedPath = `PSMODULES/ai/PSCODELISTS/${codeName}.json`;
  const matches = systemCodeLists.filter((entry) => entry?.path === expectedPath);
  check(
    matches.length === 1,
    `system registry: ${expectedPath} must be registered exactly once`,
  );
}

const embeddedAi = embeddedAiModules[0];
if (embeddedAi && aiModule) {
  const expectedEntityPaths = (aiModule.getAllPSDataEntities || []).map(
    (entry) => entry?.path,
  );
  const expectedCodeListPaths = (aiModule.getAllPSCodeLists || []).map(
    (entry) => entry?.path,
  );
  const actualEntityPaths = (embeddedAi.getAllPSDataEntities || []).map(
    (entry) => entry?.path,
  );
  const actualCodeListPaths = (embeddedAi.getAllPSCodeLists || []).map(
    (entry) => entry?.path,
  );

  check(
    sameArray(actualEntityPaths, expectedEntityPaths),
    'system registry: embedded ai entity references differ from PSMODULES/ai.json',
  );
  check(
    sameArray(actualCodeListPaths, expectedCodeListPaths),
    'system registry: embedded ai CodeList references differ from PSMODULES/ai.json',
  );
  for (const entity of entities) {
    const expectedPath = `PSMODULES/ai/PSDATAENTITIES/${entity.codeName}.json`;
    check(
      actualEntityPaths.filter((entry) => entry === expectedPath).length === 1,
      `embedded ai module: ${expectedPath} must be registered exactly once`,
    );
  }
  for (const codeName of codeLists) {
    const expectedPath = `PSMODULES/ai/PSCODELISTS/${codeName}.json`;
    check(
      actualCodeListPaths.filter((entry) => entry === expectedPath).length === 1,
      `embedded ai module: ${expectedPath} must be registered exactly once`,
    );
  }
}

check(Array.isArray(appRegistry?.getAllPSAppDataEntities), 'application registry: getAllPSAppDataEntities is not an array');
check(Array.isArray(serviceRegistry?.getPSDEServiceAPIs), 'service API registry: getPSDEServiceAPIs is not an array');

for (const entity of entities) {
  const sourcePath = `PSMODULES/ai/PSDATAENTITIES/${entity.codeName}.json`;
  const appPath = `PSSYSAPPS/plmweb/PSAPPDATAENTITIES/${entity.codeName}.json`;
  const sourceFile = path.join(modelDir, sourcePath);
  const appFile = path.join(modelDir, appPath);
  const source = readJson(sourceFile, `${entity.codeName} source entity`);
  const app = readJson(appFile, `${entity.codeName} application entity`);
  const api = serviceApis.find((item) => item?.codeName === entity.codeName);

  check(source !== null, `${entity.codeName}: source entity is readable`);
  check(app !== null, `${entity.codeName}: application entity is readable`);
  check(api !== undefined, `${entity.codeName}: service API is registered`);
  if (!source || !app || !api) {
    continue;
  }

  const sourceFields = source.getAllPSDEFields || [];
  const appFields = app.getAllPSAppDEFields || [];
  const serviceFields = api.getPSDEServiceAPIFields || [];
  const dbTableMatches = dbTables.filter(
    (table) => table?.codeName === source.name || table?.name === source.name,
  );
  const sourceFieldNames = names(sourceFields);
  const appFieldNames = names(appFields);
  const serviceFieldNames = names(serviceFields);
  if (entity.codeName === 'ai_run') {
    const sourceFieldByCodeName = new Map(sourceFields.map((field) => [field.codeName, field]));
    for (const [codeName, expected] of Object.entries(recoveryFields)) {
      const field = sourceFieldByCodeName.get(codeName);
      check(field !== undefined, `${entity.codeName}: recovery field ${codeName} is missing`);
      if (field) {
        check(field.name === expected.name, `${entity.codeName}: recovery field ${codeName} name mismatch`);
        check(field.dataType === expected.dataType, `${entity.codeName}: recovery field ${codeName} dataType must be ${expected.dataType}`);
        check(field.stdDataType === expected.stdDataType, `${entity.codeName}: recovery field ${codeName} stdDataType must be ${expected.stdDataType}`);
        if (expected.length !== undefined) {
          check(field.length === expected.length, `${entity.codeName}: recovery field ${codeName} length must be ${expected.length}`);
        }
      }
    }
  }
  const sourceDtos = source.getAllPSDEMethodDTOs || [];
  const appDtos = app.getAllPSAppDEMethodDTOs || [];
  const sourceDtoByName = new Map(sourceDtos.map((dto) => [dto.name, dto]));
  const appDtoByName = new Map(appDtos.map((dto) => [dto.codeName, dto]));
  const sourceActions = source.getAllPSDEActions || [];
  const appActions = app.getAllPSAppDEActions || [];
  const sourceDataSets = source.getAllPSDEDataSets || [];
  const appDataSets = app.getAllPSAppDEDataSets || [];
  const apiMethods = api.getPSDEServiceAPIMethods || [];
  const sourceActionByMode = new Map(
    sourceActions.map((action) => [action.actionMode, action]),
  );
  const appActionByMode = new Map(
    appActions.map((action) => [action.actionMode, action]),
  );
  const appMethods = app.getAllPSAppDEMethods || [];
  const appMethodNames = names(appMethods);
  const expectedCrudTags = requiredCrudModes.map(
    (mode) =>
      `${source.name}__DEACTION__${mode === 'DELETE' ? 'REMOVE' : mode}`,
  );
  const apiMethodTags = apiMethods.map((method) => method.uniqueTag);

  check(source.codeName === entity.codeName, `${entity.codeName}: source codeName mismatch`);
  check(app.codeName === entity.codeName, `${entity.codeName}: app codeName mismatch`);
  check(api.codeName === entity.codeName, `${entity.codeName}: service API codeName mismatch`);
  check(
    dbTableMatches.length === 1,
    `${entity.codeName}: default DB scheme table must exist exactly once`,
  );
  if (dbTableMatches.length === 1) {
    const dbTable = dbTableMatches[0];
    const dbColumns = dbTable.getAllPSSysDBColumns || [];
    const dbColumnNames = names(dbColumns);
    const expectedDbColumnNames = sourceFields.map((field) => field.name);
    const dbColumnByName = new Map(
      dbColumns.map((column) => [column.codeName || column.name, column]),
    );

    check(
      dbTable.codeName === source.name,
      `${entity.codeName}: default DB scheme table codeName mismatch`,
    );
    check(
      dbTable.name === source.name,
      `${entity.codeName}: default DB scheme table name mismatch`,
    );
    check(
      dbTable.logicName === source.logicName,
      `${entity.codeName}: default DB scheme table logicName mismatch`,
    );
    check(
      dbTable.autoExtendModel === true,
      `${entity.codeName}: default DB scheme table must enable autoExtendModel`,
    );
    check(
      dbTable.existingModel === false,
      `${entity.codeName}: default DB scheme table must set existingModel=false`,
    );
    check(
      unique(dbColumnNames),
      `${entity.codeName}: duplicate default DB scheme columns`,
    );
    check(
      sameArray([...dbColumnNames].sort(), [...expectedDbColumnNames].sort()),
      `${entity.codeName}: default DB scheme columns differ from source fields`,
    );

    for (const field of sourceFields) {
      const column = dbColumnByName.get(field.name);
      check(
        column !== undefined,
        `${entity.codeName}: default DB scheme column ${field.name} is missing`,
      );
      if (!column) {
        continue;
      }
      const expectedStdDataType =
        field.length === 1048576 ? 21 : field.stdDataType;
      check(
        column.name === field.name,
        `${entity.codeName}: DB column ${field.name} name mismatch`,
      );
      check(
        column.logicName === field.logicName,
        `${entity.codeName}: DB column ${field.name} logicName mismatch`,
      );
      check(
        column.stdDataType === expectedStdDataType,
        `${entity.codeName}: DB column ${field.name} stdDataType must be ${expectedStdDataType}`,
      );
      if (field.length !== null && field.length !== undefined) {
        check(
          column.length === field.length,
          `${entity.codeName}: DB column ${field.name} length must be ${field.length}`,
        );
      } else {
        check(
          column.length === undefined || column.length === null,
          `${entity.codeName}: DB column ${field.name} must not define a length`,
        );
      }
      if ([1, 6, 9].includes(expectedStdDataType)) {
        check(
          column.scale === 0,
          `${entity.codeName}: numeric DB column ${field.name} must define scale=0`,
        );
      }
    }

    const primaryKeyColumns = dbColumns
      .filter((column) => column.pKey === true)
      .map((column) => column.codeName || column.name);
    check(
      sameArray(primaryKeyColumns, ['ID']),
      `${entity.codeName}: default DB scheme primary key must be ID`,
    );

    const dbIndexes = dbTable.getAllPSSysDBIndices || [];
    const dbIndexByCodeName = new Map(
      dbIndexes.map((index) => [index.codeName || index.name, index]),
    );
    for (const expectedIndex of harnessDbIndexes[source.name] || []) {
      const index = dbIndexByCodeName.get(expectedIndex.codeName);
      check(
        index !== undefined,
        `${entity.codeName}: default DB scheme index ${expectedIndex.codeName} is missing`,
      );
      if (!index) {
        continue;
      }
      check(
        index.indexType === 'NORMAL',
        `${entity.codeName}: default DB scheme index ${expectedIndex.codeName} must be NORMAL`,
      );
      check(
        index.sourceType === 'DEDBINDEX',
        `${entity.codeName}: default DB scheme index ${expectedIndex.codeName} must be DEDBINDEX`,
      );
      const indexColumns = (index.getAllPSSysDBIndexColumns || []).map(
        (column) => column.name || column.getPSSysDBColumn?.id,
      );
      check(
        sameArray(indexColumns, expectedIndex.columns),
        `${entity.codeName}: default DB scheme index ${expectedIndex.codeName} columns differ`,
      );
      for (const columnName of expectedIndex.columns) {
        check(
          dbColumnByName.has(columnName),
          `${entity.codeName}: index ${expectedIndex.codeName} references missing column ${columnName}`,
        );
      }
    }
  }
  check(
    app.dEAPICodeName === entity.codeName,
    `${entity.codeName}: app dEAPICodeName mismatch`,
  );
  check(
    app.dEAPICodeName2 === entity.codeName2,
    `${entity.codeName}: app plural API name must be ${entity.codeName2}`,
  );
  check(
    api.codeName2 === entity.codeName2,
    `${entity.codeName}: service API plural API name must be ${entity.codeName2}`,
  );
  check(
    app.dEAPITag === source.name && api.name === source.name,
    `${entity.codeName}: application/service API tag must be ${source.name}`,
  );
  check(
    app.dynaModelFilePath === appPath,
    `${entity.codeName}: app dynaModelFilePath mismatch`,
  );
  check(
    app.getPSDataEntity?.path === sourcePath,
    `${entity.codeName}: app source entity reference mismatch`,
  );
  check(
    api.getPSDataEntity?.path === sourcePath,
    `${entity.codeName}: service API source entity reference mismatch`,
  );

  check(unique(sourceFieldNames), `${entity.codeName}: duplicate source field codeName`);
  check(unique(appFieldNames), `${entity.codeName}: duplicate app field codeName`);
  check(unique(serviceFieldNames), `${entity.codeName}: duplicate service API field codeName`);
  check(
    sameArray(sourceFieldNames, appFieldNames),
    `${entity.codeName}: source and app fields differ`,
  );
  check(
    sameArray(sourceFieldNames, serviceFieldNames),
    `${entity.codeName}: source and service API fields differ`,
  );

  const defaultDto = sourceDtoByName.get(`${entity.codeName}_dto`);
  const appDefaultDto = appDtoByName.get(`${entity.codeName}_dto`);
  check(
    defaultDto !== undefined,
    `${entity.codeName}: default source DTO is missing`,
  );
  check(
    appDefaultDto !== undefined,
    `${entity.codeName}: default app DTO is missing`,
  );
  if (defaultDto && appDefaultDto) {
    check(
      sameArray(dtoFieldNames(defaultDto), sourceFieldNames),
      `${entity.codeName}: source default DTO does not cover entity fields`,
    );
    check(
      sameArray(appDtoFieldNames(appDefaultDto), sourceFieldNames),
      `${entity.codeName}: app default DTO does not cover entity fields`,
    );
  }

  check(
    source.getDefaultPSDEMethodDTO?.id === `${entity.codeName}_dto`,
    `${entity.codeName}: default method DTO reference is invalid`,
  );
  check(
    source.getDefaultPSDEFilterDTO?.id === `${entity.codeName}_filter_dto`,
    `${entity.codeName}: default filter DTO reference is invalid`,
  );
  check(
    sourceDtoByName.has(source.getDefaultPSDEMethodDTO?.id),
    `${entity.codeName}: default method DTO target is missing`,
  );
  check(
    sourceDtoByName.has(source.getDefaultPSDEFilterDTO?.id),
    `${entity.codeName}: default filter DTO target is missing`,
  );

  const defaultDataSet = sourceDataSets.find((dataSet) => dataSet.codeName === 'Default');
  const appDefaultDataSet = appDataSets.find(
    (dataSet) => dataSet.codeName === 'fetch_default',
  );
  check(defaultDataSet !== undefined, `${entity.codeName}: Default source data set is missing`);
  check(
    appDefaultDataSet !== undefined,
    `${entity.codeName}: fetch_default app data set is missing`,
  );
  if (defaultDataSet && appDefaultDataSet) {
    check(
      refId(defaultDataSet.getPSDEDataSetInput?.getPSDEFilterDTO) ===
        `${entity.codeName}_filter_dto`,
      `${entity.codeName}: Default data set filter DTO reference is invalid`,
    );
    check(
      refId(defaultDataSet.getPSDEDataSetReturn?.getPSDEMethodDTO) ===
        `${entity.codeName}_dto`,
      `${entity.codeName}: Default data set return DTO reference is invalid`,
    );
    check(
      appDefaultDataSet.getPSAppDEMethodInput?.getPSAppDEMethodDTO?.id ===
        `${entity.codeName}_filter_dto`,
      `${entity.codeName}: app fetch_default input DTO reference is invalid`,
    );
    check(
      appDefaultDataSet.getPSAppDEMethodReturn?.getPSAppDEMethodDTO?.id ===
        `${entity.codeName}_dto`,
      `${entity.codeName}: app fetch_default return DTO reference is invalid`,
    );
  }

  for (const action of sourceActions) {
    check(
      Boolean(action.dynaModelFilePath),
      `${entity.codeName}: action ${action.codeName} has no model path`,
    );
    if (action.dynaModelFilePath) {
      readModelJson(action.dynaModelFilePath, `${entity.codeName} action ${action.codeName}`);
    }
    for (const argument of [
      action.getPSDEActionInput,
      action.getPSDEActionReturn,
    ]) {
      const dtoId = refId(argument?.getPSDEMethodDTO);
      if (dtoId) {
        check(
          sourceDtoByName.has(dtoId),
          `${entity.codeName}: action ${action.codeName} references missing DTO ${dtoId}`,
        );
      }
    }
  }

  for (const dataSet of sourceDataSets) {
    const filterDtoId = refId(dataSet.getPSDEDataSetInput?.getPSDEFilterDTO);
    const returnDtoId = refId(dataSet.getPSDEDataSetReturn?.getPSDEMethodDTO);
    check(
      sourceDtoByName.has(filterDtoId),
      `${entity.codeName}: data set ${dataSet.codeName} references missing filter DTO ${filterDtoId}`,
    );
    check(
      sourceDtoByName.has(returnDtoId),
      `${entity.codeName}: data set ${dataSet.codeName} references missing return DTO ${returnDtoId}`,
    );
  }

  for (const field of sourceFields) {
    const codeListPath = field.getPSCodeList?.path;
    if (!codeListPath) {
      continue;
    }
    const codeList = readModelJson(
      codeListPath,
      `${entity.codeName} field ${field.codeName} CodeList`,
    );
    if (codeList) {
      check(
        Array.isArray(codeList.getPSCodeItems),
        `${entity.codeName} field ${field.codeName}: CodeList items are missing`,
      );
    }
  }

  check(
    requiredCrudModes.every((mode) => sourceActionByMode.has(mode)),
    `${entity.codeName}: source CRUD actions are incomplete`,
  );
  check(
    requiredCrudModes.every((mode) => appActionByMode.has(mode)),
    `${entity.codeName}: app CRUD actions are incomplete`,
  );
  for (const mode of requiredCrudModes) {
    const appAction = appActionByMode.get(mode);
    if (!appAction) {
      continue;
    }
    check(
      appAction.codeName === actionCodeNames[mode],
      `${entity.codeName}: ${mode} app action codeName must be ${actionCodeNames[mode]}`,
    );
  }
  check(
    appMethodNames.includes('fetch_default'),
    `${entity.codeName}: app methods do not include fetch_default`,
  );
  check(
    requiredCrudModes.every((mode) => appMethodNames.includes(actionCodeNames[mode])),
    `${entity.codeName}: app methods do not include all CRUD methods`,
  );
  check(
    requiredCrudModes.every((mode) =>
      apiMethodTags.includes(
        `${source.name}__DEACTION__${mode === 'DELETE' ? 'REMOVE' : mode}`,
      ),
    ),
    `${entity.codeName}: service API CRUD tags are incomplete`,
  );
  check(
    apiMethodTags.includes(`${source.name}__FETCH__DEFAULT`),
    `${entity.codeName}: service API fetch_default tag is missing`,
  );
  check(
    unique(apiMethodTags),
    `${entity.codeName}: duplicate service API uniqueTag`,
  );

  for (const action of appActions) {
    const actionRef = action.getPSDEAction;
    if (actionRef?.path) {
      check(
        fs.existsSync(path.join(modelDir, actionRef.path)),
        `${entity.codeName}: app action ${action.codeName} references missing source action ${actionRef.path}`,
      );
    }
    for (const argument of [
      action.getPSAppDEMethodInput,
      action.getPSAppDEMethodReturn,
    ]) {
      const dtoId = argument?.getPSAppDEMethodDTO?.id;
      if (dtoId) {
        check(
          appDtoByName.has(dtoId),
          `${entity.codeName}: app action ${action.codeName} references missing DTO ${dtoId}`,
        );
      }
    }
  }

  const appRegistryMatches = appEntries.filter(
    (entry) => entry?.codeName === entity.codeName,
  );
  check(
    appRegistryMatches.length === 1,
    `${entity.codeName}: application registry must contain exactly one entry`,
  );
  if (appRegistryMatches.length === 1) {
    check(
      appRegistryMatches[0].path === appPath,
      `${entity.codeName}: application registry path mismatch`,
    );
  }

  const serviceRegistryMatches = serviceApis.filter(
    (item) => item?.codeName === entity.codeName,
  );
  check(
    serviceRegistryMatches.length === 1,
    `${entity.codeName}: service API registry must contain exactly one entry`,
  );
}

check(
  unique(appEntries.map((entry) => entry?.codeName).filter(Boolean)),
  'application registry: duplicate codeName entries',
);
check(
  unique(serviceApis.map((item) => item?.codeName).filter(Boolean)),
  'service API registry: duplicate codeName entries',
);
for (const tableName of Object.keys(harnessDbIndexes)) {
  const matches = dbTables.filter(
    (table) => table?.codeName === tableName || table?.name === tableName,
  );
  check(
    matches.length === 1,
    `default DB scheme: ${tableName} must be registered exactly once`,
  );
}
for (const indexName of harnessUniqueIndexes) {
  check(
    typeof harnessMigration === 'string' &&
      harnessMigration.includes(indexName),
    `harness migration: unique index ${indexName} is missing`,
  );
}
for (const columnName of Object.values(recoveryFields).map((field) => field.name)) {
  check(
    typeof harnessMigration === 'string' &&
      harnessMigration.includes(`\`${columnName}\``),
    `harness migration: recovery column ${columnName} is missing`,
  );
}
check(
  typeof harnessMigration === 'string' &&
    harnessMigration.includes('IX_AI_RUN_RECOVERY_CANDIDATE'),
  'harness migration: recovery candidate index is missing',
);

if (failures.length > 0) {
  process.stderr.write(`Harness model gate failed: ${failures.length} failure(s)\n`);
  for (const failure of failures) {
    process.stderr.write(`- ${failure}\n`);
  }
  process.exit(1);
}

process.stdout.write(
  `Harness model gate passed: ${checkCount} checks, ${entities.length} entities\n`,
);
NODE
