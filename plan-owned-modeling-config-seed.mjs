#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { PinnedDirectories, readPinnedFile } from './native-candidate-files.mjs';

const workspaceDefault = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const modelRoot = 'vendor-upstream/ibizmodeling-standard/modelapi-core/src/main/resources/model/net/ibizsys/modeling';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const contract = 'owned-modeling-config-seed-plan-v1';
const specs = [
  {
    entity: 'PSPF', codeName: 'PSPF', table: 't_srfpspf', route: 'pspfs',
    required: ['PSPFID'], key: 'PSPFID', name: 'PSPFNAME', scope: 'global',
    fetchDataset: 'Default', config: 'platform',
  },
  {
    entity: 'PSPFStyle', codeName: 'PSPFStyle', table: 't_srfpspfstyle', route: 'pspfstyles',
    required: ['PSPFSTYLEID', 'PSPFSTYLENAME'], key: 'PSPFSTYLEID', name: 'PSPFSTYLENAME',
    scope: 'center-or-shared', center: 'PSDEVCENTERID', parent: 'PSPFID',
    fetchDataset: 'Default', config: 'style',
  },
  {
    entity: 'PSAppType', codeName: 'PSAppType', table: 't_srfpsapptype', route: 'psapptypes',
    required: ['PSAPPTYPEID', 'PSAPPTYPENAME'], key: 'PSAPPTYPEID', name: 'PSAPPTYPENAME',
    scope: 'global', fetchDataset: 'Default', config: 'app-type',
  },
];

function readJSON(directories, path) {
  const parent = directories.open(dirname(path));
  return JSON.parse(readPinnedFile(directories, parent, basename(path)).data);
}

function sourcePath(path) {
  return join(modelRoot, path);
}

function appModelPath(codeName) {
  return sourcePath(`PSSYSAPPS/ModelDesign/PSAPPDATAENTITIES/${codeName}.json`);
}

function entityModelPath(codeName) {
  return sourcePath(`PSMODULES/Config/PSDATAENTITIES/${codeName}.json`);
}

function sysDesignEntityModelPath(codeName) {
  return sourcePath(`PSMODULES/SysDesign/PSDATAENTITIES/${codeName}.json`);
}
function defaultQueryPath(codeName) {
  return sourcePath(`PSMODULES/Config/PSDATAENTITIES/${codeName}/PSDEDATAQUERIES/Default/PSDEDATAQUERIES/MYSQL5.json`);
}

function fallbackDefaultQueryPath(codeName) {
  return sourcePath(`PSMODULES/Config/PSDATAENTITIES/${codeName}/PSDEDATAQUERIES/Default/PSDEDQCODES/MYSQL5.json`);
}

function readSource(directories, workspace, path, bindings) {
  const absolute = join(workspace, path);
  const parent = directories.open(dirname(absolute));
  const file = readPinnedFile(directories, parent, basename(absolute));
  const binding = { path: relative(workspace, absolute), sha256: hash(file.data), bytes: file.data.length };
  bindings.push(binding);
  return { value: JSON.parse(file.data), binding };
}

function requestPath(spec, rootId) {
  return `/api/ibizmodeling__modeldesign/psdevslnsys/${rootId}/${spec.route}`;
}

function readModelSchemaPlan(directories, workspace, runId, bindings) {
  const path = join(workspace, '.artifacts/native-nonadmin-fixtures', runId, 'model-schema-plan.json');
  const parent = directories.open(dirname(path));
  const file = readPinnedFile(directories, parent, basename(path));
  const binding = { path: relative(workspace, path), sha256: hash(file.data), bytes: file.data.length };
  bindings.push(binding);
  return JSON.parse(file.data);
}

export function buildOwnedModelingConfigSeedPlan({
  workspace = workspaceDefault, manifestPath, outputPath,
} = {}) {
  workspace = resolve(workspace);
  assert.equal(typeof manifestPath, 'string');
  const directories = new PinnedDirectories();
  const bindings = [];
  try {
    const manifest = readSource(directories, workspace, manifestPath, bindings).value;
    assert.match(manifest.runId ?? '', /^[a-f0-9]{12}$/);
    assert.equal(manifest.scenario, 'two-center');
    assert.equal(manifest.schemas.metadata, `nf_${manifest.runId}_meta`);
    assert.equal(manifest.users.length, 6);
    const schemaPlan = readModelSchemaPlan(directories, workspace, manifest.runId, bindings);
    const tables = new Map(schemaPlan.tables.map(table => [table.name.toLowerCase(), table]));
    const source = [];
    const records = [];
    const entities = specs.map(spec => {
      const module = readSource(directories, workspace, entityModelPath(spec.codeName), bindings);
      const app = readSource(directories, workspace, appModelPath(spec.codeName), bindings);
      let queryPath = defaultQueryPath(spec.codeName);
      if (!fs.existsSync(join(workspace, queryPath))) queryPath = fallbackDefaultQueryPath(spec.codeName);
      const query = readSource(directories, workspace, queryPath, bindings);
      const model = module.value;
      const appModel = app.value;
      const queryModel = query.value;
      assert.equal(model.tableName.toLowerCase(), spec.table);
      assert.equal(model.getKeyPSDEField.name, spec.key);
      assert.equal(model.getMajorPSDEField.name, spec.name);
      assert.equal(model.dSLink, 'DEFAULT');
      assert.equal(appModel.sysAPITag, 'ModelAPI');
      assert.equal(appModel.dEAPICodeName2, spec.route);
      const fetch = appModel.getAllPSAppDEMethods.find(row =>
        row.codeName === 'FetchDefault' && row.requestMethod === 'POST');
      assert.ok(fetch, `Missing source ModelDesign FetchDefault for ${spec.entity}`);
      assert.equal(fetch.requestPath, '/fetchdefault');
      assert.equal(fetch.dataSetTag, 'Default');
      assert.equal(queryModel.dBType, 'MYSQL5');
      assert.ok(queryModel.queryCode.toUpperCase().includes(`FROM \`${spec.table.toUpperCase()}\``),
        `Default config query must read ${spec.table}`);
      const table = tables.get(spec.table);
      assert.ok(table, `Missing metadata source table ${spec.table}`);
      const requiredFields = spec.required.map(name => {
        const field = model.getAllPSDEFields.find(row => row.name === name);
        assert.ok(field, `Missing source required field ${spec.entity}.${name}`);
        assert.equal(field.dEFType, 1, `Required field ${spec.entity}.${name} must be physical`);
        assert.ok(table.columns.includes(name), `Metadata table misses ${spec.table}.${name}`);
        return { name, length: field.stringLength ?? null, defaultValue: field.defaultValue ?? null };
      });
      const config = {
        entity: spec.entity, codeName: spec.codeName, table: spec.table, route: spec.route,
        storage: 'metadata', database: manifest.schemas.metadata, scope: spec.scope,
        centerField: spec.center ?? null, parentField: spec.parent ?? null, key: spec.key, name: spec.name,
        requiredPhysicalFields: requiredFields,
        fetch: { method: fetch.requestMethod, path: '/fetchdefault', dataset: 'Default',
          permission: 'READ', body: { page: 0, size: 1000 } },
        create: { method: 'POST', path: `/${spec.route}`, permission: 'CREATE',
          input: 'DTO', return: 'VOID' },
        remove: { method: 'DELETE', path: `/${spec.route}/$RECEIPTED_KEY`, permission: 'DELETE',
          input: 'KEYFIELDS', return: 'VOID' },
        sourceBindings: { module: module.binding, app: app.binding, query: query.binding },
        physicalColumns: table.columns.toSorted(),
        evidence: {
          required: true,
          readPath: `/api/ibizmodeling__modeldesign/psdevslnsys/$ROOT_ID/${spec.route}/fetchdefault`,
          unresolved: 'No synthetic config row or ID is provided by this plan',
        },
      };
      for (const root of manifest.roots) records.push({
        entity: spec.entity, rootId: root.rootId, database: root.database,
        scope: spec.scope, status: 'blocked-awaiting-real-config-evidence',
        key: '$NATIVE_RETURNED_KEY', name: `$OBSERVED_${spec.codeName}_NAME`,
        center: spec.center ? root.centerId : null,
      });
      return config;
    });
    const app = entities.find(entity => entity.entity === 'PSSysApp');
    const appModel = readSource(directories, workspace, sysDesignEntityModelPath('PSSysApp'), bindings);
    const appFields = appModel.value.getAllPSDEFields;
    const configReferences = ['PSPFID', 'PSPFSTYLEID', 'PSAPPTYPENAME'].map(name => {
      const field = appFields.find(row => row.name === name);
      assert.ok(field?.allowEmpty === false && field.dEFType === 1);
      return { field: name, sourceRelation: field.getRelatedPSDataEntity?.path ?? null,
        actualReadRequired: true };
    });
    const style = entities.find(entity => entity.entity === 'PSPFStyle');
    const plan = {
      contract: 'owned-modeling-config-seed-plan-v1',
      status: 'blocked-awaiting-real-config-evidence',
      runId: manifest.runId, scenario: manifest.scenario,
      databases: { metadata: manifest.schemas.metadata },
      centers: manifest.roots.map(root => ({ rootId: root.rootId, database: root.database,
        centerId: root.centerId, logicalSystemId: root.logicalSystemId })),
      inputs: bindings,
      schemaPlan: { path: relative(workspace, join(workspace, '.artifacts/native-nonadmin-fixtures',
        manifest.runId, 'model-schema-plan.json')), sha256: bindings.find(binding =>
        binding.path.endsWith('/model-schema-plan.json')).sha256 },
      entities, records,
      applicationPrerequisites: {
        physicalRequired: configReferences,
        platform: entities.find(entity => entity.entity === 'PSPF'),
        style,
        appType: entities.find(entity => entity.entity === 'PSAppType'),
        coherence: [
          'Observed PSPF must have VALIDFLAG=1 and a real PSAPPTYPEID.',
          'Observed PSPFStyle must reference that PSPFID and either the actor center or shared null center.',
          'Observed PSAppType must match PSPF.PSAPPTYPEID and have a nonempty name.',
          'No literal $OBSERVED_* token may be sent to native CREATE.',
        ],
      },
      twoCenterScope: {
        global: ['PSPF', 'PSAppType'],
        centerOrShared: ['PSPFStyle'],
        duplicateRule: 'One observed key cannot be reused across two center-scoped style intents.',
        unknownCenter: 'Reject; do not map a style to an invented center or production ID.',
      },
      snapshot: {
        mode: 'read-only-full-column-all-row',
        database: manifest.schemas.metadata,
        tables: entities.map(entity => ({ entity: entity.entity, table: entity.table,
          columns: entity.physicalColumns })),
        baseline: 'Require each table empty before config seed; retain every row/column after each native operation.',
        sqlMutation: false,
      },
      cleanup: {
        method: 'native-owner-remove-only', sqlFallback: false,
        order: ['PSSysApp', 'PSPFStyle', 'PSPF', 'PSAppType'],
        proof: ['actual returned key', 'run marker/name', 'metadata schema', 'observed owner/session'],
        baseline: 'Record MODELVER/PSSysModelLog deltas; never SQL-reset audit/version rows.',
      },
      blockedReasons: [
        'Current owned wrapper may publish only psdevslnsys routes; exact config routes must be reviewed and bound before HTTP.',
        'No source config rows/IDs are synthesized by this plan.',
        'PSSysApp native CREATE remains blocked until a coherent real PSPF/PSPFStyle/PSAppType triple is fetched.',
      ],
      sourceBound: true, nativeCreateExecuted: false, appNativeCreateExecuted: false,
      permissionAcceptance: false, fullColumnSnapshotExecuted: false,
    };
    if (outputPath) {
      const output = resolve(workspace, outputPath);
      assert.ok(output.startsWith(`${workspace}/.artifacts/`));
      const parent = directories.open(dirname(output));
      directories.write(parent, basename(output), json(plan), 0o600);
    }
    return plan;
  } finally { directories.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: {
    'manifest-path': { type: 'string' }, 'output-path': { type: 'string' },
  }, strict: true, allowPositionals: false });
  assert.equal(typeof values['manifest-path'], 'string',
    'Read-only config seed plan requires explicit --manifest-path');
  console.log(json(buildOwnedModelingConfigSeedPlan({
    manifestPath: values['manifest-path'], outputPath: values['output-path'],
  })));
}
