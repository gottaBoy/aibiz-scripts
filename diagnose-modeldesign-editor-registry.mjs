#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PinnedDirectories, readPinnedFile } from './native-candidate-files.mjs';

const workspaceRoot = fileURLToPath(new URL('../', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const modelRoot = 'vendor-upstream/ibizmodeling-standard/modelapi-core/src/main/resources/model/net/ibizsys/modeling';
export const REGISTRY_SOURCES = Object.freeze({
  maintained: 'ibiz-service-hub/libs/ibiz-modeling-core/src/main/java/net/ibizsys/modeling/core/util/PSModels.java',
  localFull: 'modelingservice/src/ibiz-modeling-core/net/ibizsys/modeling/core/util/PSModels.java',
  selection: 'ibiz-service-hub/libs/ibiz-modeling-core/src/main/java/net/ibizsys/modeling/core/security/SystemAccessManagerBase.java',
  rootManager: 'ibiz-service-hub/libs/ibiz-modeling-core/src/main/java/net/ibizsys/modeling/core/dataentity/security/PSModelDEAccessManager.java',
  genericManager: 'ibiz-service-hub/libs/ibiz-cloud-core/src/main/java/net/ibizsys/central/cloud/core/dataentity/security/DataEntityAccessManager.java',
});
export const EDITOR_ENTITIES = Object.freeze([
  { code: 'PSModule', route: 'psmodules', action: 'fetchcursys', control: true },
  { code: 'PSSysDBScheme', route: 'pssysdbschemes', action: 'fetchcursys' },
  { code: 'PSSysApp', route: 'pssysapps', action: 'fetchcursys' },
  { code: 'PSSysSFPub', route: 'pssyssfpubs', action: 'fetchcursys2' },
  { code: 'PSSysServiceAPI', route: 'pssysserviceapis', action: 'fetchcursys' },
  { code: 'PSSubSysServiceAPI', route: 'pssubsysserviceapis', action: 'fetchcursys' },
]);

// This intentionally recognizes only the two existing literal-registration
// grammars. It does not evaluate Java or claim a running manager observation.
export function extractModelRegistry(source, kind) {
  assert.ok(['maintained', 'localFull'].includes(kind));
  const constants = new Map();
  for (const match of source.matchAll(/public static final String (\w+) = "([^"\r\n]+)";/g)) {
    assert.ok(!constants.has(match[1]), 'Duplicate Java constant');
    constants.set(match[1], match[2]);
  }
  const result = new Map();
  const insert = (key, table) => {
    assert.match(key, /^[A-Z][A-Z0-9_]*$/);
    assert.match(table, /^(?:T_SRF|V_)[A-Z0-9_]+ *$/);
    if (result.has(key)) assert.equal(result.get(key), table, 'Conflicting table registrations');
    result.set(key, table);
  };
  if (kind === 'maintained') {
    const registrations = [...source.matchAll(/^\s+registerModel\((\w+)\);$/gm)];
    assert.equal(registrations.length, (source.match(/\bregisterModel\(/g) ?? []).length - 1,
      'Unexpected maintained registry expression; re-audit instead of evaluating Java');
    assert.ok(source.includes('MODEL_INSTANCE_DATA_ENTITIES.put(dataEntityName, "T_SRF" + dataEntityName)'));
    for (const match of registrations) {
      assert.ok(constants.has(match[1]));
      insert(constants.get(match[1]), `T_SRF${constants.get(match[1])}`);
    }
  } else {
    const registrations = [...source.matchAll(/^\s+ModelInstDataEntityMap\.put\((\w+|"[^"\r\n]+"), "([^"\r\n]+)"\);$/gm)];
    assert.equal(registrations.length, (source.match(/\bModelInstDataEntityMap\.put\(/g) ?? []).length,
      'Unexpected full-source registry expression; re-audit instead of evaluating Java');
    for (const match of registrations) {
      const key = match[1].startsWith('"') ? match[1].slice(1, -1) : constants.get(match[1]);
      assert.ok(key, 'Every registry name must resolve to a declared literal constant');
      insert(key, match[2]);
    }
  }
  assert.ok(result.size > 0);
  return result;
}

export function inspectEditorModels({ maintained, localFull, selection, rootManager, genericManager,
  serviceModel, entityModels }) {
  const current = extractModelRegistry(maintained, 'maintained');
  const full = extractModelRegistry(localFull, 'localFull');
  assert.ok(selection.includes('if (PSModels.isModelInstDataEntity(iDataEntityRuntime.getName()))'));
  assert.ok(selection.includes('iDataEntityAccessManager = new PSModelDEAccessManager()'));
  assert.ok(selection.includes('return super.createDataEntityAccessManager(iDataEntityRuntime)'));
  assert.ok(rootManager.includes('Object root = appContext.get(APPCONTEXT_PSDEVSLNSYS)'));
  assert.ok(rootManager.includes('getPSDevUserBase("SYS", solutionSystemId)'));
  assert.ok(rootManager.includes('systemUser == null || systemUser.isExpired() || systemUser.getAccMode() < 0'));
  assert.ok(rootManager.includes('"READ".equals(accessAction) && (systemUser.getAccMode() & 1) == 1'));
  assert.ok(genericManager.includes('getPSDEUserRoles((IEmployeeContext) iUserContext, strAccessAction)'));
  assert.ok(genericManager.includes('if (ObjectUtils.isEmpty(list)) {\n\t\t\treturn false;'));
  const rows = EDITOR_ENTITIES.map(definition => {
    const entity = entityModels[definition.code];
    assert.ok(entity && entity.name === definition.code.toUpperCase());
    assert.equal(entity.dataAccCtrlMode, 1, 'Only the actual SELF-controlled entities are diagnosed');
    const api = serviceModel.getPSDEServiceAPIs.filter(row => row.codeName === definition.code);
    assert.equal(api.length, 1);
    const expected = definition.action === 'fetchcursys2' ? 'FetchCurSys2' : 'FetchCurSys';
    const methods = api[0].getPSDEServiceAPIMethods.filter(row => row.codeName === expected);
    assert.equal(methods.length, 1);
    assert.equal(methods[0].dataAccessAction, 'READ', 'A different action is not this diagnosis');
    const name = entity.name;
    assert.ok(full.has(name), 'The local full source must contain a real table registration');
    const registered = current.has(name);
    return {
      entity: name, code: definition.code, route: definition.route, action: definition.action,
      modelDataAccessAction: 'READ', dataAccCtrlMode: entity.dataAccCtrlMode,
      maintainedModelRegistered: registered, maintainedTable: current.get(name) ?? null,
      localFullTable: full.get(name),
      staticManagerBranch: registered ? 'PSModelDEAccessManager' : 'generic-fallback',
      control: definition.control === true,
    };
  });
  return {
    maintainedUniqueEntries: current.size, localFullUniqueEntries: full.size, rows,
    missingFromMaintained: rows.filter(row => !row.maintainedModelRegistered).map(row => row.entity),
    missingHistoricalMappings: [...full].filter(([name]) => !current.has(name))
      .map(([entity, table]) => ({ entity, table })).sort((a, b) => a.entity.localeCompare(b.entity)),
    localMappingReviewWarnings: [...full].filter(([, table]) => table !== table.trim() || table.startsWith('V_'))
      .map(([entity, table]) => ({ entity, table, reason: table !== table.trim() ? 'literal-trailing-space' : 'view-not-table' })),
    boundary: 'Static extraction of actual literal Java registrations and published model objects; not JVM execution or proof of the live selected manager class',
  };
}

export function inspectBrowserEditorObservations(browser, rows) {
  const events = [];
  const walk = value => {
    if (!value || typeof value !== 'object') return;
    if (value.kind === 'response' && typeof value.path === 'string' && Number.isInteger(value.status)) events.push(value);
    if (Array.isArray(value)) value.forEach(walk);
    else Object.values(value).forEach(walk);
  };
  walk(browser);
  return rows.map(row => {
    const suffix = `/${row.route}/${row.action}`;
    const observations = events.filter(event => event.path.endsWith(suffix)
      && event.path.includes('/psdevslnsys/'));
    assert.ok(observations.length > 0, 'Each diagnosed editor route needs a real recorded response');
    const roots = [...new Set(observations.map(event => event.path.split('/psdevslnsys/')[1].split('/')[0]))];
    assert.deepEqual(roots, ['nf_96ff5681e447_root_a'], 'Do not mix actors/root fixtures into this diagnosis');
    return { entity: row.entity, observedRoot: roots[0],
      recordedStatuses: [...new Set(observations.map(event => event.status))].sort(),
      requests: observations.length };
  });
}

export function main(argv = process.argv.slice(2), workspace = workspaceRoot) {
  const options = {};
  for (const argument of argv) {
    const match = /^--(browser-report|output)=(.+)$/.exec(argument);
    assert.ok(match && !Object.hasOwn(options, match[1]), 'Only explicit nonduplicate read-only diagnostic options');
    options[match[1]] = match[2];
  }
  assert.ok(options['browser-report'] && options.output);
  workspace = resolve(workspace);
  const output = resolve(workspace, options.output);
  assert.equal(dirname(output), join(workspace, '.artifacts'));
  assert.match(output.split('/').at(-1), /^modeldesign-editor-registry-20261110-[a-z0-9-]+$/);
  const directories = new PinnedDirectories();
  const inputs = [];
  const read = path => {
    const absolute = resolve(workspace, path);
    const child = relative(workspace, absolute);
    assert.ok(child && !child.startsWith('../') && !child.startsWith('/'));
    const parent = directories.open(dirname(absolute));
    const name = absolute.split('/').at(-1);
    const file = readPinnedFile(directories, parent, name);
    inputs.push({ path: absolute, sha256: hash(file.data), bytes: file.data.length, parent, name });
    return file.data.toString('utf8');
  };
  try {
    const sources = Object.fromEntries(Object.entries(REGISTRY_SOURCES).map(([key, path]) => [key, read(path)]));
    const entityModels = Object.fromEntries(EDITOR_ENTITIES.map(row => [row.code,
      JSON.parse(read(`${modelRoot}/PSMODULES/SysDesign/PSDATAENTITIES/${row.code}.json`))]));
    const serviceModel = JSON.parse(read(`${modelRoot}/PSSYSSERVICEAPIS/ModelAPI.json`));
    const inspection = inspectEditorModels({ ...sources, entityModels, serviceModel });
    const browser = JSON.parse(read(options['browser-report']));
    const observations = inspectBrowserEditorObservations(browser, inspection.rows);
    for (const input of inputs) assert.equal(
      hash(readPinnedFile(directories, input.parent, input.name).data), input.sha256, 'Diagnostic input drift');
    const report = {
      contract: 'modeldesign-editor-registry-static-diagnosis-v1', status: 'source-and-recorded-http-diagnosis-only',
      createdAt: new Date().toISOString(), inspection, observations,
      inputs: inputs.map(({ parent, name, ...input }) => input),
      nativeAcceptance: false, permissionAcceptance: false, rootGrantChanged: false,
      historicalLocalFullSource: 'CFR-derived local source; not independently authenticated original source',
      recordedHttpDescribesCurrentSource: false,
      nextVerification: [
        ...(inspection.missingFromMaintained.length ? [
          'In a new source build, restore reviewed model/config registrations from local source with exact non-formula table names.',
        ] : [
          'Reviewed editor registrations are present in source; build fresh artifacts and do not relabel historical HTTP failures as current runtime evidence.',
        ]),
        'Prove actual factory selection with real model objects and keep ordinary person/root binding, expiry/access bits and canonical system rewrite.',
        'Replay all five GET datasets for editor/viewer/no-access and foreign roots with nonempty owned sentinels and full physical snapshots.',
        'Repeat the native browser editor load/save/new-session readback/restore; neither source presence nor HTTP200 empty arrays are acceptance.',
      ],
    };
    const target = directories.open(output, { create: true, exclusive: true });
    directories.write(target, 'report.json', `${JSON.stringify(report, null, 2)}\n`);
    return { output, missing: inspection.missingFromMaintained, nativeAcceptance: false };
  } finally { directories.close(); }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { console.log(JSON.stringify(main(), null, 2)); }
  catch {
    console.error('Editor registry static diagnosis refused; no HTTP, Docker or SQL commands are supported.');
    process.exitCode = 1;
  }
}
