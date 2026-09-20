#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const plmDir = path.join(rootDir, 'plm');
const moduleDir = path.join(plmDir, 'model', 'PSMODULES', 'ai', 'PSDATAENTITIES');
const appEntityDir = path.join(
  plmDir,
  'model',
  'PSSYSAPPS',
  'plmweb',
  'PSAPPDATAENTITIES',
);
const appRegistryFile = path.join(
  plmDir,
  'model',
  'PSSYSAPPS',
  'plmweb',
  'PSSYSAPP.json',
);
const serviceApiFile = path.join(plmDir, 'model', 'PSSYSSERVICEAPIS', 'ServiceAPI.json');
const systemFile = path.join(plmDir, 'model', 'PSSYSTEM.json');
const aiModuleFile = path.join(plmDir, 'model', 'PSMODULES', 'ai.json');

const entities = [
  { codeName: 'ai_run', codeName2: 'ai_runs' },
  { codeName: 'ai_run_step', codeName2: 'ai_run_steps' },
  { codeName: 'ai_run_event', codeName2: 'ai_run_events' },
];

const codeLists = [
  { codeName: 'ai_run_status', name: 'AI Run状态' },
  { codeName: 'ai_run_step_status', name: 'AI Run步骤状态' },
];

const standardActionCodeNames = {
  CREATE: 'create',
  READ: 'get',
  DELETE: 'remove',
  UPDATE: 'update',
  GETDRAFT: 'get_draft',
  CHECKKEY: 'check_key',
  SAVE: 'save',
};

const standardServiceMethodIds = new Set(['CREATE', 'READ', 'DELETE', 'UPDATE']);
const filterActionNames = [
  'FilterCreate',
  'FilterFetch',
  'FilterGet',
  'FilterGetDraft',
  'FilterRemove',
  'FilterSearch',
  'FilterUpdate',
];

function fail(message) {
  throw new Error(message);
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    fail(`Cannot read JSON ${path.relative(rootDir, file)}: ${error.message}`);
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const content = `${JSON.stringify(value, null, 2)}\n`;
  if (fs.existsSync(file) && fs.readFileSync(file, 'utf8') === content) {
    return false;
  }
  fs.writeFileSync(file, content);
  return true;
}

function renderCompactModel(value) {
  return JSON.stringify(value).replace(/":/g, '": ');
}

function ref(id) {
  return { modelref: true, id };
}

function pathRef(modelPath) {
  return { modelref: true, path: modelPath };
}

function fieldRef(field) {
  return { name: field.name, codeName: field.codeName };
}

function copyIfDefined(target, source, key) {
  if (source[key] !== undefined) {
    target[key] = source[key];
  }
}

function toSnakeCase(value) {
  return value
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();
}

function getActionCodeName(action) {
  return standardActionCodeNames[action.actionMode] || toSnakeCase(action.codeName);
}

function getServiceMethodId(action) {
  if (standardServiceMethodIds.has(action.actionMode)) {
    return action.codeName;
  }
  return getActionCodeName(action);
}

function getActionUniquePart(action) {
  if (action.actionMode === 'DELETE') {
    return 'REMOVE';
  }
  return action.actionMode;
}

function getApiRequest(action) {
  const keyField = action.getPSDEActionInput?.getKeyPSDEField;
  const request = {};

  switch (action.actionMode) {
    case 'CREATE':
      request.requestMethod = 'POST';
      request.requestParamType = 'ENTITY';
      break;
    case 'UPDATE':
      request.requestMethod = 'PUT';
      request.requestParamType = 'ENTITY';
      request.needResourceKey = true;
      break;
    case 'DELETE':
      request.requestField = keyField?.name || 'ID';
      request.requestMethod = 'DELETE';
      request.requestParamType = 'FIELD';
      request.enableBatchAction = true;
      request.needResourceKey = true;
      break;
    case 'READ':
      request.requestField = keyField?.name || 'ID';
      request.requestMethod = 'GET';
      request.requestParamType = 'FIELD';
      request.needResourceKey = true;
      break;
    case 'GETDRAFT':
      request.requestMethod = 'GET';
      request.requestParamType = 'NONE';
      request.requestPath = '/get_draft';
      break;
    case 'CHECKKEY':
      request.requestMethod = 'POST';
      request.requestParamType = 'ENTITY';
      request.requestPath = '/check_key';
      break;
    case 'SAVE':
      request.requestMethod = 'POST';
      request.requestParamType = 'ENTITY';
      request.requestPath = '/save';
      break;
    default:
      request.requestMethod = 'POST';
      request.requestParamType = 'ENTITY';
      request.requestPath = `/${getActionCodeName(action)}`;
      break;
  }

  return request;
}

function mapAppMethodArg(argument) {
  if (!argument) {
    return undefined;
  }

  const result = {};
  if (argument.getKeyPSDEField) {
    result.getKeyPSAppDEField = fieldRef(argument.getKeyPSDEField);
  }
  if (argument.getPSDEMethodDTO) {
    result.getPSAppDEMethodDTO = ref(argument.getPSDEMethodDTO.id);
  }
  copyIfDefined(result, argument, 'name');
  copyIfDefined(result, argument, 'stdDataType');
  copyIfDefined(result, argument, 'type');
  copyIfDefined(result, argument, 'output');
  return result;
}

function mapServiceMethodArg(argument) {
  if (!argument) {
    return undefined;
  }

  const result = {};
  if (argument.getKeyPSDEField) {
    result.getKeyPSDEServiceAPIField = ref(argument.getKeyPSDEField.codeName);
  }
  if (argument.getPSDEMethodDTO) {
    result.getPSDEMethodDTO = ref(argument.getPSDEMethodDTO.id);
  }
  copyIfDefined(result, argument, 'name');
  copyIfDefined(result, argument, 'stdDataType');
  copyIfDefined(result, argument, 'type');
  copyIfDefined(result, argument, 'output');
  return result;
}

function mapAppField(field) {
  const result = {
    codeName: field.codeName,
  };

  if (field.getAllPSDEFUIModes) {
    result.getAllPSAppDEFUIModes = field.getAllPSDEFUIModes;
  }
  copyIfDefined(result, field, 'getLNPSLanguageRes');
  copyIfDefined(result, field, 'logicName');
  copyIfDefined(result, field, 'name');
  copyIfDefined(result, field, 'predefinedType');
  copyIfDefined(result, field, 'stdDataType');
  copyIfDefined(result, field, 'stringLength');
  copyIfDefined(result, field, 'precision');
  copyIfDefined(result, field, 'scale');
  copyIfDefined(result, field, 'minValueString');
  copyIfDefined(result, field, 'maxValueString');
  copyIfDefined(result, field, 'valueFormat');
  copyIfDefined(result, field, 'enableQuickSearch');
  if (field.keyDEField) {
    result.keyField = true;
  }
  if (field.majorDEField) {
    result.majorField = true;
  }
  return result;
}

function mapAppDtoField(dtoField, sourceFields) {
  const sourceField = sourceFields.get(dtoField.getPSDEField?.codeName);
  const result = {
    codeName: dtoField.name,
  };

  copyIfDefined(result, dtoField, 'jsonFormat');
  result.logicName = dtoField.logicName || sourceField?.logicName;
  copyIfDefined(result, dtoField, 'name');
  if (dtoField.getPSDEField) {
    result.getPSAppDEField = fieldRef(dtoField.getPSDEField);
  }
  copyIfDefined(result, dtoField, 'sourceType');
  copyIfDefined(result, dtoField, 'stdDataType');
  copyIfDefined(result, dtoField, 'stringLength');
  copyIfDefined(result, dtoField, 'precision');
  copyIfDefined(result, dtoField, 'scale');
  copyIfDefined(result, dtoField, 'type');
  copyIfDefined(result, dtoField, 'allowEmpty');
  return result;
}

function mapAppDto(dto, sourceFields) {
  const dtoFields =
    dto.getPSDEMethodDTOFields || dto.getPSDEFilterDTOFields || [];
  const fieldKey = dto.getPSDEMethodDTOFields
    ? 'getPSAppDEMethodDTOFields'
    : 'getPSAppDEMethodDTOFields';

  const result = {
    codeName: dto.name,
    name: dto.name,
    [fieldKey]: dtoFields.map((field) => mapAppDtoField(field, sourceFields)),
  };
  copyIfDefined(result, dto, 'sourceType');
  copyIfDefined(result, dto, 'type');
  return result;
}

function mapAppAction(action) {
  const result = {
    actionMode: action.actionMode,
    actionTag: action.codeName,
    codeName: getActionCodeName(action),
    methodType: 'DEACTION',
    name: action.name,
    getPSAppDEMethodInput: mapAppMethodArg(action.getPSDEActionInput),
    getPSAppDEMethodReturn: mapAppMethodArg(action.getPSDEActionReturn),
    getPSDEAction: pathRef(action.dynaModelFilePath),
    getPSDEOPPriv: ref(action.dataAccessAction),
    getPSDEServiceAPIMethod: ref(getServiceMethodId(action)),
    ...getApiRequest(action),
    builtinMethod: false,
  };

  if (action.batchAction) {
    result.enableBatchAction = true;
  }
  if (standardServiceMethodIds.has(action.actionMode)) {
    result.noServiceCodeName = true;
  }
  return result;
}

function mapAppDataSet(dataSet) {
  const codeName = `fetch_${dataSet.codeName.toLowerCase()}`;
  const inputDto = dataSet.getPSDEDataSetInput?.getPSDEFilterDTO?.id;
  const returnDto = dataSet.getPSDEDataSetReturn?.getPSDEMethodDTO?.id;
  return {
    codeName,
    dataSetName: dataSet.name,
    dataSetTag: dataSet.codeName,
    methodType: 'FETCH',
    name: codeName,
    getPSAppDEMethodInput: {
      name: '输入对象',
      getPSAppDEMethodDTO: ref(inputDto),
      type: 'DTO',
    },
    getPSAppDEMethodReturn: {
      name: '返回对象',
      getPSAppDEMethodDTO: ref(returnDto),
      type: 'PAGE',
    },
    getPSDEDataSet: ref(dataSet.codeName),
    getPSDEOPPriv: ref('READ'),
    getPSDEServiceAPIMethod: ref(codeName),
    requestMethod: 'POST',
    requestParamType: 'ENTITY',
    requestPath: `/${codeName}`,
    builtinMethod: false,
  };
}

function mapAppACMode(mode, entity) {
  const result = {
    codeName: mode.codeName,
    logicName: mode.logicName,
    name: mode.name,
    getPSAppDataEntity: pathRef(
      `PSSYSAPPS/plmweb/PSAPPDATAENTITIES/${entity.codeName}.json`,
    ),
  };
  if (mode.getPSDEACModeDataItems) {
    result.getPSDEACModeDataItems = mode.getPSDEACModeDataItems.map((item) => {
      const mapped = { ...item };
      if (item.getPSDEField) {
        mapped.getPSAppDEField = fieldRef(item.getPSDEField);
      }
      return mapped;
    });
  }
  copyIfDefined(result, mode, 'pagingSize');
  if (mode.getPSDEACModeDataItems) {
    const value = mode.getPSDEACModeDataItems.find((item) => item.name === 'value');
    const text = mode.getPSDEACModeDataItems.find((item) => item.name === 'text');
    if (text?.getPSDEField) {
      result.getTextPSAppDEField = fieldRef(text.getPSDEField);
    }
    if (value?.getPSDEField) {
      result.getValuePSAppDEField = fieldRef(value.getPSDEField);
    }
  }
  copyIfDefined(result, mode, 'defaultMode');
  copyIfDefined(result, mode, 'enablePagingBar');
  return result;
}

function buildAppEntity(source, entity) {
  const sourceFields = new Map(
    source.getAllPSDEFields.map((field) => [field.codeName, field]),
  );
  const appActions = source.getAllPSDEActions
    .map(mapAppAction)
    .sort((left, right) => left.codeName.localeCompare(right.codeName));
  const appDataSets = source.getAllPSDEDataSets.map(mapAppDataSet);
  const appMethods = [
    ...appActions,
    ...appDataSets,
    ...filterActionNames.map((name) => ({
      codeName: name,
      methodType: 'FILTERACTION',
      name: name.toUpperCase(),
      builtinMethod: true,
    })),
  ];

  const quickSearchFields = source.getAllPSDEFields
    .filter((field) => field.enableQuickSearch)
    .map(fieldRef);

  const result = {
    getAllPSAppDEACModes: (source.getAllPSDEACModes || []).map((mode) =>
      mapAppACMode(mode, entity),
    ),
    getAllPSAppDEActions: appActions,
    getAllPSAppDEDataSets: appDataSets,
    getAllPSAppDEFields: source.getAllPSDEFields.map(mapAppField),
    getAllPSAppDEMethodDTOs: source.getAllPSDEMethodDTOs.map((dto) =>
      mapAppDto(dto, sourceFields),
    ),
    getAllPSAppDEMethods: appMethods,
    getAllPSDEOPPrivs: source.getAllPSDEOPPrivs,
    codeName: source.codeName,
    dEAPICodeName: source.codeName,
    dEAPICodeName2: entity.codeName2,
    dEAPITag: source.name,
    dataAccCtrlArch: source.dataAccCtrlArch,
    dataAccCtrlMode: source.dataAccCtrlMode,
    dynaModelFilePath: `PSSYSAPPS/plmweb/PSAPPDATAENTITIES/${entity.codeName}.json`,
    enableUIActions: source.enableUIActions,
    getKeyPSAppDEField: fieldRef(source.getKeyPSDEField),
    getLNPSLanguageRes: source.getLNPSLanguageRes,
    logicName: source.logicName,
    getMajorPSAppDEField: fieldRef(source.getMajorPSDEField),
    name: source.name,
    getPSDEName: source.name,
    getPSDEServiceAPI: ref(source.codeName),
    getPSDataEntity: pathRef(source.dynaModelFilePath),
    getPSSysServiceAPI: pathRef('PSSYSSERVICEAPIS/ServiceAPI.json'),
    getQuickSearchPSAppDEFields: quickSearchFields,
    storageMode: 0,
    sysAPITag: 'ServiceAPI',
    defaultMode: true,
    enableFilterActions: true,
    enableUICreate: source.enableCreate === true,
    enableUIModify: source.enableModify === true,
    enableUIRemove: source.enableRemove === true,
    enableWFActions: false,
    major: true,
  };

  return result;
}

function mapServiceAPIField(field) {
  const result = {
    codeName: field.codeName,
    codeName2: field.serviceCodeName || field.codeName,
  };
  copyIfDefined(result, field, 'getLNPSLanguageRes');
  copyIfDefined(result, field, 'logicName');
  copyIfDefined(result, field, 'name');
  copyIfDefined(result, field, 'orderValue');
  copyIfDefined(result, field, 'precision');
  copyIfDefined(result, field, 'scale');
  copyIfDefined(result, field, 'stdDataType');
  copyIfDefined(result, field, 'stringLength');
  copyIfDefined(result, field, 'allowEmpty');
  result.enableCreate = true;
  result.enableModify = true;
  result.keyField = field.keyDEField === true;
  result.majorField = field.majorDEField === true;
  return result;
}

function replaceExistingServiceAPIFields(file, serviceApiCodeName, fields) {
  const original = fs.readFileSync(file, 'utf8');
  const registry = readJson(file);
  const serviceApis = registry.getPSDEServiceAPIs;
  if (!Array.isArray(serviceApis)) {
    fail(`${path.relative(rootDir, file)}.getPSDEServiceAPIs is not an array`);
  }

  const apiIndex = serviceApis.findIndex(
    (serviceApi) => serviceApi?.codeName === serviceApiCodeName,
  );
  if (apiIndex < 0) {
    return 0;
  }

  const registryRange = findArrayRange(original, 'getPSDEServiceAPIs');
  const apiRanges = findObjectRangesInArray(original, registryRange);
  const apiRange = apiRanges[apiIndex];
  if (!apiRange) {
    fail(
      `${path.relative(rootDir, file)} cannot locate service API ${serviceApiCodeName}`,
    );
  }

  const apiText = original.slice(apiRange.openIndex, apiRange.closeIndex + 1);
  const fieldRange = findArrayRange(apiText, 'getPSDEServiceAPIFields');
  const arrayIndent = getLineIndent(
    original,
    apiRange.openIndex + fieldRange.propertyIndex,
  );
  const entryIndent = `${arrayIndent}  `;
  const renderedEntries = fields
    .map((field) =>
      JSON.stringify(field, null, 2)
        .split('\n')
        .map((line) => `${entryIndent}${line}`)
        .join('\n'),
    )
    .join(',\n');
  const rendered =
    fields.length === 0
      ? '[]'
      : `[\n${renderedEntries}\n${arrayIndent}]`;
  const absoluteOpenIndex = apiRange.openIndex + fieldRange.openIndex;
  const absoluteCloseIndex = apiRange.openIndex + fieldRange.closeIndex;
  const currentText = original.slice(
    absoluteOpenIndex,
    absoluteCloseIndex + 1,
  );
  if (currentText === rendered) {
    return 0;
  }

  const updated =
    original.slice(0, absoluteOpenIndex) +
    rendered +
    original.slice(absoluteCloseIndex + 1);
  readJson(file);
  fs.writeFileSync(file, updated);
  readJson(file);
  return 1;
}

function mapServiceAPIMethod(action, entityTag) {
  const method = {
    codeName: getActionCodeName(action),
    dataAccessAction: action.dataAccessAction,
    methodType: 'DEACTION',
    name: action.name,
    getPSDEAction: pathRef(action.dynaModelFilePath),
    getPSDEServiceAPIMethodInput: mapServiceMethodArg(action.getPSDEActionInput),
    getPSDEServiceAPIMethodReturn: mapServiceMethodArg(action.getPSDEActionReturn),
    ...getApiRequest(action),
    uniqueTag: `${entityTag}__DEACTION__${getActionUniquePart(action)}`,
  };

  if (standardServiceMethodIds.has(action.actionMode)) {
    method.noServiceCodeName = true;
  }
  return method;
}

function replaceExistingServiceAPIMethods(file, serviceApiCodeName, methods) {
  const original = fs.readFileSync(file, 'utf8');
  const registry = readJson(file);
  const serviceApis = registry.getPSDEServiceAPIs;
  if (!Array.isArray(serviceApis)) {
    fail(`${path.relative(rootDir, file)}.getPSDEServiceAPIs is not an array`);
  }

  const apiIndex = serviceApis.findIndex(
    (serviceApi) => serviceApi?.codeName === serviceApiCodeName,
  );
  if (apiIndex < 0 || methods.length === 0) {
    return 0;
  }

  const registryRange = findArrayRange(original, 'getPSDEServiceAPIs');
  const apiRanges = findObjectRangesInArray(original, registryRange);
  const apiRange = apiRanges[apiIndex];
  if (!apiRange) {
    fail(
      `${path.relative(rootDir, file)} cannot locate service API ${serviceApiCodeName}`,
    );
  }

  const apiText = original.slice(apiRange.openIndex, apiRange.closeIndex + 1);
  const methodRangeInApi = findArrayRange(apiText, 'getPSDEServiceAPIMethods');
  const methodRanges = findObjectRangesInArray(apiText, methodRangeInApi);
  const existingMethods =
    serviceApis[apiIndex].getPSDEServiceAPIMethods || [];
  const replacements = [];

  for (const method of methods) {
    const existingIndex = existingMethods.findIndex(
      (existingMethod) => existingMethod?.uniqueTag === method.uniqueTag,
    );
    if (existingIndex < 0) {
      continue;
    }
    const methodRange = methodRanges[existingIndex];
    if (!methodRange) {
      fail(
        `${path.relative(rootDir, file)} cannot locate method ` +
          `${method.uniqueTag} in service API ${serviceApiCodeName}`,
      );
    }
    const current = existingMethods[existingIndex];
    const absoluteOpenIndex =
      apiRange.openIndex + methodRange.openIndex;
    const absoluteCloseIndex =
      apiRange.openIndex + methodRange.closeIndex;
    const indent = getLineIndent(original, absoluteOpenIndex);
    const rendered = JSON.stringify(method, null, 2)
      .split('\n')
      .map((line, lineIndex) =>
        lineIndex === 0 ? line : `${indent}${line}`,
      )
      .join('\n');
    const currentText = original.slice(
      absoluteOpenIndex,
      absoluteCloseIndex + 1,
    );
    if (current.codeName === method.codeName && currentText === rendered) {
      continue;
    }
    replacements.push({
      openIndex: absoluteOpenIndex,
      closeIndex: absoluteCloseIndex,
      rendered,
    });
  }

  if (replacements.length === 0) {
    return 0;
  }

  let updated = original;
  for (const replacement of replacements.sort(
    (left, right) => right.openIndex - left.openIndex,
  )) {
    updated =
      updated.slice(0, replacement.openIndex) +
      replacement.rendered +
      updated.slice(replacement.closeIndex + 1);
  }
  readJson(file);
  fs.writeFileSync(file, updated);
  readJson(file);
  return replacements.length;
}

function mapServiceAPIDataset(dataSet, entityTag) {
  const codeName = `fetch_${dataSet.codeName.toLowerCase()}`;
  const inputDto = dataSet.getPSDEDataSetInput?.getPSDEFilterDTO?.id;
  const returnDto = dataSet.getPSDEDataSetReturn?.getPSDEMethodDTO?.id;
  return {
    codeName,
    dataAccessAction: 'READ',
    methodType: 'FETCH',
    name: codeName,
    getPSDEDataSet: ref(dataSet.codeName),
    getPSDEServiceAPIMethodInput: {
      name: '输入对象',
      getPSDEMethodDTO: ref(inputDto),
      type: 'DTO',
    },
    getPSDEServiceAPIMethodReturn: {
      name: '返回对象',
      getPSDEMethodDTO: ref(returnDto),
      type: 'PAGE',
    },
    requestMethod: 'POST',
    requestParamType: 'ENTITY',
    requestPath: `/${codeName}`,
    uniqueTag: `${entityTag}__FETCH__${dataSet.codeName.toUpperCase()}`,
  };
}

function buildServiceAPI(source, entity) {
  const actionOrder = {
    CREATE: 1,
    READ: 2,
    DELETE: 3,
    UPDATE: 4,
  };
  const actions = [...source.getAllPSDEActions].sort((left, right) => {
    const leftOrder = actionOrder[left.actionMode] || 10;
    const rightOrder = actionOrder[right.actionMode] || 10;
    return leftOrder - rightOrder || left.codeName.localeCompare(right.codeName);
  });
  const entityTag = source.name;
  return {
    aPIMode: source.serviceAPIMode || 1,
    codeName: source.codeName,
    codeName2: entity.codeName2,
    getLNPSLanguageRes: source.getLNPSLanguageRes,
    logicName: source.logicName,
    name: source.name,
    getPSDEServiceAPIFields: source.getAllPSDEFields.map(mapServiceAPIField),
    getPSDEServiceAPIMethods: [
      ...actions.map((action) => mapServiceAPIMethod(action, entityTag)),
      ...source.getAllPSDEDataSets.map((dataSet) =>
        mapServiceAPIDataset(dataSet, entityTag),
      ),
    ],
    getPSDataEntity: pathRef(source.dynaModelFilePath),
    enableDataExport: true,
    enableDataImport: true,
    major: true,
  };
}

function findArrayRange(text, propertyName) {
  const property = new RegExp(`"${propertyName}"\\s*:\\s*\\[`).exec(text);
  if (!property) {
    fail(`Cannot find array property ${propertyName}`);
  }

  const openIndex = text.indexOf('[', property.index);
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = openIndex; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === '\\') {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }
    if (character === '"') {
      inString = true;
    } else if (character === '[') {
      depth += 1;
    } else if (character === ']') {
      depth -= 1;
      if (depth === 0) {
        return { openIndex, closeIndex: index, propertyIndex: property.index };
      }
    }
  }
  fail(`Cannot find closing bracket for ${propertyName}`);
}

function getLineIndent(text, index) {
  const lineStart = text.lastIndexOf('\n', index) + 1;
  const line = text.slice(lineStart, index);
  return line.match(/^\s*/)?.[0] || '';
}

function appendUniqueArrayEntries(file, propertyName, entries, uniqueKey) {
  if (entries.length === 0) {
    return 0;
  }

  const original = fs.readFileSync(file, 'utf8');
  const parsed = readJson(file);
  const array = parsed[propertyName];
  if (!Array.isArray(array)) {
    fail(`${path.relative(rootDir, file)}.${propertyName} is not an array`);
  }

  const existing = new Set(array.map((item) => item?.[uniqueKey]));
  const missing = entries.filter((entry) => !existing.has(entry[uniqueKey]));
  if (missing.length === 0) {
    return 0;
  }

  const range = findArrayRange(original, propertyName);
  const arrayIndent = getLineIndent(original, range.propertyIndex);
  const entryIndent = `${arrayIndent}  `;
  const contentBeforeClose = original.slice(0, range.closeIndex).replace(/\s+$/, '');
  const hasExistingEntries = contentBeforeClose.endsWith('[') === false;
  const renderedEntries = missing
    .map((entry) =>
      JSON.stringify(entry, null, 2)
        .split('\n')
        .map((line) => `${entryIndent}${line}`)
        .join('\n'),
    )
    .join(',\n');
  const insertion = `${hasExistingEntries ? ',\n' : '\n'}${renderedEntries}\n${arrayIndent}`;
  const updated =
    contentBeforeClose + insertion + original.slice(range.closeIndex);
  fs.writeFileSync(file, updated);
  readJson(file);
  return missing.length;
}

function appendUniqueCompactArrayEntries(file, propertyName, entries, uniqueKey) {
  if (entries.length === 0) {
    return 0;
  }

  const original = fs.readFileSync(file, 'utf8');
  const parsed = readJson(file);
  const array = parsed[propertyName];
  if (!Array.isArray(array)) {
    fail(`${path.relative(rootDir, file)}.${propertyName} is not an array`);
  }

  const existing = new Set(array.map((item) => item?.[uniqueKey]));
  const missing = entries.filter((entry) => !existing.has(entry[uniqueKey]));
  if (missing.length === 0) {
    return 0;
  }

  const range = findArrayRange(original, propertyName);
  const contentBeforeClose = original.slice(0, range.closeIndex).replace(/\s+$/, '');
  const hasExistingEntries = contentBeforeClose.endsWith('[') === false;
  const renderedEntries = missing.map(renderCompactModel).join(',');
  const insertion = `${hasExistingEntries ? ',' : ''}${renderedEntries}`;
  const updated =
    contentBeforeClose + insertion + original.slice(range.closeIndex);
  fs.writeFileSync(file, updated);
  readJson(file);
  return missing.length;
}

function findObjectRangesInArray(text, range) {
  const ranges = [];
  let index = range.openIndex + 1;
  while (index < range.closeIndex) {
    while (index < range.closeIndex && /[\s,]/.test(text[index])) {
      index += 1;
    }
    if (index >= range.closeIndex) {
      break;
    }
    if (text[index] !== '{') {
      fail(`Expected an object in array near index ${index}`);
    }

    const openIndex = index;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (; index < range.closeIndex; index += 1) {
      const character = text[index];
      if (inString) {
        if (escaped) {
          escaped = false;
        } else if (character === '\\') {
          escaped = true;
        } else if (character === '"') {
          inString = false;
        }
        continue;
      }
      if (character === '"') {
        inString = true;
      } else if (character === '{') {
        depth += 1;
      } else if (character === '}') {
        depth -= 1;
        if (depth === 0) {
          ranges.push({ openIndex, closeIndex: index });
          index += 1;
          break;
        }
      }
    }
    if (depth !== 0) {
      fail(`Cannot find closing brace for array object near index ${openIndex}`);
    }
  }
  return ranges;
}

function replaceEmbeddedAiModule() {
  const original = fs.readFileSync(systemFile, 'utf8');
  const system = readJson(systemFile);
  const aiModule = readJson(aiModuleFile);
  const moduleRange = findArrayRange(original, 'getAllPSSystemModules');
  const moduleRanges = findObjectRangesInArray(original, moduleRange);
  const aiMatches = moduleRanges.filter((range) => {
    const value = JSON.parse(original.slice(range.openIndex, range.closeIndex + 1));
    return value.codeName === 'ai';
  });

  if (aiMatches.length !== 1) {
    fail(
      `${path.relative(rootDir, systemFile)} must contain exactly one embedded ai module; ` +
        `found ${aiMatches.length}`,
    );
  }

  const aiRange = aiMatches[0];
  const updated =
    original.slice(0, aiRange.openIndex) +
    renderCompactModel(aiModule) +
    original.slice(aiRange.closeIndex + 1);
  readJson(systemFile);
  if (updated === original) {
    return 0;
  }
  fs.writeFileSync(systemFile, updated);
  readJson(systemFile);
  return 1;
}

function main() {
  const sources = entities.map((entity) => {
    const file = path.join(moduleDir, `${entity.codeName}.json`);
    const source = readJson(file);
    if (source.codeName !== entity.codeName) {
      fail(`${path.relative(rootDir, file)} has unexpected codeName ${source.codeName}`);
    }
    return { entity, source };
  });

  let changedFiles = 0;
  for (const { entity, source } of sources) {
    const appEntityFile = path.join(appEntityDir, `${entity.codeName}.json`);
    const appEntity = buildAppEntity(source, entity);
    const serviceAPI = buildServiceAPI(source, entity);
    if (writeJson(appEntityFile, appEntity)) {
      changedFiles += 1;
    }
    const addedAPI = appendUniqueArrayEntries(
      serviceApiFile,
      'getPSDEServiceAPIs',
      [serviceAPI],
      'codeName',
    );
    const updatedFields = replaceExistingServiceAPIFields(
      serviceApiFile,
      entity.codeName,
      serviceAPI.getPSDEServiceAPIFields,
    );
    const updatedMethods = replaceExistingServiceAPIMethods(
      serviceApiFile,
      entity.codeName,
      serviceAPI.getPSDEServiceAPIMethods,
    );
    const addedEntity = appendUniqueArrayEntries(
      appRegistryFile,
      'getAllPSAppDataEntities',
      [
        {
          modelref: true,
          path: `PSSYSAPPS/plmweb/PSAPPDATAENTITIES/${entity.codeName}.json`,
          name: source.name,
          codeName: entity.codeName,
        },
      ],
      'codeName',
    );
    changedFiles += addedAPI + updatedMethods + addedEntity;
    process.stdout.write(
      `${entity.codeName}: app=${changedFiles ? 'written/checked' : 'checked'}, ` +
        `service_api=${addedAPI ? 'registered' : 'already registered'}, ` +
        `service_fields=${updatedFields ? 'updated' : 'checked'}, ` +
        `service_methods=${updatedMethods ? `updated ${updatedMethods}` : 'checked'}, ` +
        `app_registry=${addedEntity ? 'registered' : 'already registered'}\n`,
    );
  }

  const systemEntityEntries = sources.map(({ entity, source }) => ({
    modelref: true,
    path: source.dynaModelFilePath,
    name: source.name,
  }));
  const systemCodeListEntries = codeLists.map((codeList) => ({
    modelref: true,
    path: `PSMODULES/ai/PSCODELISTS/${codeList.codeName}.json`,
  }));
  changedFiles += appendUniqueCompactArrayEntries(
    systemFile,
    'getAllPSDataEntities',
    systemEntityEntries,
    'path',
  );
  changedFiles += appendUniqueCompactArrayEntries(
    systemFile,
    'getAllPSCodeLists',
    systemCodeListEntries,
    'path',
  );
  changedFiles += replaceEmbeddedAiModule();

  process.stdout.write(`Harness model generation complete; changed entries/files: ${changedFiles}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
}
