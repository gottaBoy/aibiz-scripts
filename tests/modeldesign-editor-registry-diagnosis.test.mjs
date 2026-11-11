import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  EDITOR_ENTITIES, REGISTRY_SOURCES, extractModelRegistry, inspectBrowserEditorObservations,
  inspectEditorModels, main,
} from '../diagnose-modeldesign-editor-registry.mjs';

const root = new URL('../../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const sources = Object.fromEntries(Object.entries(REGISTRY_SOURCES).map(([key, path]) => [key, read(path)]));
const modelRoot = 'vendor-upstream/ibizmodeling-standard/modelapi-core/src/main/resources/model/net/ibizsys/modeling';
const entityModels = Object.fromEntries(EDITOR_ENTITIES.map(row => [row.code,
  JSON.parse(read(`${modelRoot}/PSMODULES/SysDesign/PSDATAENTITIES/${row.code}.json`))]));
const serviceModel = JSON.parse(read(`${modelRoot}/PSSYSSERVICEAPIS/ModelAPI.json`));
const values = { ...sources, entityModels, serviceModel };

test('actual maintained registry restores only the five reviewed editor mappings and keeps the module control', () => {
  const report = inspectEditorModels(values);
  assert.equal(report.maintainedUniqueEntries, 26);
  assert.equal(report.localFullUniqueEntries, 387);
  assert.deepEqual(report.missingFromMaintained, []);
  assert.equal(report.rows[0].staticManagerBranch, 'PSModelDEAccessManager');
  assert.equal(report.rows[0].maintainedTable, 'T_SRFPSMODULE');
  for (const row of report.rows.slice(1)) {
    assert.equal(row.staticManagerBranch, 'PSModelDEAccessManager');
    assert.equal(row.maintainedTable, row.localFullTable);
    assert.equal(row.localFullTable, `T_SRF${row.entity}`);
    assert.equal(row.modelDataAccessAction, 'READ');
  }
  const registry = extractModelRegistry(sources.maintained, 'maintained');
  assert.equal(registry.has('PSSYSSFPUBPKG'), false);
  assert.equal(registry.has('UNKNOWN_ENTITY'), false);
});

test('the historical five-entry omission still reproduces the generic-fallback source branch', () => {
  const repaired = ['PSSYSDBSCHEME', 'PSSYSAPP', 'PSSYSSFPUB', 'PSSYSSERVICEAPI', 'PSSUBSYSSERVICEAPI'];
  const maintained = repaired.reduce((source, name) => {
    const registration = `        registerModel(${name});\n`;
    assert.ok(source.includes(registration));
    return source.replace(registration, '');
  }, sources.maintained);
  const report = inspectEditorModels({ ...values, maintained });
  assert.equal(report.maintainedUniqueEntries, 21);
  assert.deepEqual(report.missingFromMaintained, repaired);
  assert.ok(report.rows.slice(1).every(row => row.staticManagerBranch === 'generic-fallback'));
});

test('local mapping extraction preserves non-formula aliases instead of inventing tables', () => {
  const full = extractModelRegistry(sources.localFull, 'localFull');
  assert.equal(full.get('PSDEUTILDE'), 'T_SRFPSDEUTILDE');
  assert.equal(full.get('PSSYSPF'), 'T_SRFPSPF');
  assert.equal(full.get('PSSYSSF'), 'T_SRFPSSF');
  assert.equal(full.get('PSSYSDBCHGLOG'), 'T_SRFPSSYSDBCHGLOG');
  assert.equal(full.get('PSDELISTLOGIC'), 'T_SRFPSDELISTLOGIC ');
  assert.equal(full.has('UNKNOWN_ENTITY'), false);
});

test('bounded registration grammar rejects unparsed expressions and conflicting local mappings', () => {
  assert.throws(() => extractModelRegistry(sources.localFull
    + '\n ModelInstDataEntityMap.put(PSMODULE, "T_SRFWRONG");\n', 'localFull'));
  assert.throws(() => extractModelRegistry(sources.localFull
    + '\n ModelInstDataEntityMap.put(dynamic(), lookup());\n', 'localFull'));
  assert.throws(() => extractModelRegistry(sources.maintained
    + '\n registerModel(dynamic());\n', 'maintained'));
});

test('actual model objects reject a higher action or different access architecture diagnosis', () => {
  for (const mutate of [
    data => { data.entityModels.PSSysApp.dataAccCtrlMode = 0; },
    data => { data.entityModels.PSSysDBScheme.name = 'OTHER'; },
    data => {
      data.serviceModel.getPSDEServiceAPIs.find(row => row.codeName === 'PSSysApp')
        .getPSDEServiceAPIMethods.find(row => row.codeName === 'FetchCurSys').dataAccessAction = 'MANAGE';
    },
  ]) {
    const changed = structuredClone(values);
    mutate(changed);
    assert.throws(() => inspectEditorModels(changed));
  }
});

test('registry diagnosis cannot silently drop strict root/person grant lookup or read-bit/expiry policy', () => {
  for (const [before, after] of [
    ['getPSDevUserBase("SYS", solutionSystemId)', 'getPSDevUserBase("SYS", "default")'],
    ['systemUser == null || systemUser.isExpired() || systemUser.getAccMode() < 0', 'systemUser == null'],
    ['"READ".equals(accessAction) && (systemUser.getAccMode() & 1) == 1', 'true'],
    ['Object root = appContext.get(APPCONTEXT_PSDEVSLNSYS)', 'Object root = "default"'],
  ]) assert.throws(() => inspectEditorModels({ ...values,
    rootManager: sources.rootManager.replace(before, after) }));
});

test('recorded HTTP observations preserve real root and statuses without turning them into authorization proof', () => {
  const rows = inspectEditorModels(values).rows;
  const browser = { events: rows.map(row => ({
    kind: 'response', path: `/api/ibizmodeling__modeldesign/psdevslnsys/nf_96ff5681e447_root_a/${row.route}/${row.action}`,
    method: 'POST', status: row.control ? 200 : 403,
  })) };
  const observations = inspectBrowserEditorObservations(browser, rows);
  assert.equal(observations[0].recordedStatuses[0], 200);
  assert.ok(observations.slice(1).every(row => row.recordedStatuses[0] === 403));
  const changed = structuredClone(browser);
  changed.events[1].path = changed.events[1].path.replace('root_a', 'root_b');
  assert.throws(() => inspectBrowserEditorObservations(changed, rows));
  assert.throws(() => inspectBrowserEditorObservations({}, rows));
});

test('diagnostic CLI has no HTTP, mutation or implicit artifact options', () => {
  for (const args of [[], ['--execute'], ['--service-url=http://shared'],
    ['--output=a', '--output=b'], ['--browser-report=x', '--output=/tmp/shared']]) {
    assert.throws(() => main(args));
  }
});
