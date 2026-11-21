#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { fingerprint, PinnedDirectories, readPinnedFile, readTree } from './native-candidate-files.mjs';

const script = fileURLToPath(import.meta.url);
const workspaceRoot = resolve(dirname(script), '..');
const hash = value => createHash('sha256').update(value).digest('hex');
const encode = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const dtoName = 'ModelObservationOverviewDTO';
export const r05ModelRoot = 'vendor-upstream/ibizmodeling-standard/modelapi-core/src/main/resources/model/net/ibizsys/modeling';
export const r05Files = Object.freeze({
  action: 'PSMODULES/AppStudio/PSDATAENTITIES/ModelObservation/PSDEACTIONS/SysOverviewCnt.json',
  entity: 'PSMODULES/AppStudio/PSDATAENTITIES/ModelObservation.json',
  app: 'PSSYSAPPS/ModelDesign/PSAPPDATAENTITIES/ModelObservation.json',
  api: 'PSSYSSERVICEAPIS/ModelAPI.json',
});
export const r05InputHashes = Object.freeze({
  action: 'bdf2807e6b2f670b96400fd2b6c77b3d1d50935ca14f3635dfe1199e86263c11',
  entity: 'ce71f4d6a034ca54a0e2b20dbaf3bc03431c963e0d7c0aa8d1fd487ae5525023',
  app: 'b73fe05b07dd3a27f6f236b0c862e697b850ddc1fcc7ab14448d628839520eaf',
  api: '9d149f310a527954d003dc7eff669a9cb34cf85e9d6c6b7b7c67233f99684428',
});
export const r05Counters = Object.freeze([
  'sysappcnt', 'sysdecnt', 'serviceapicnt', 'pfplugincnt', 'sfplugincnt',
]);

function one(items, predicate, label) {
  assert.ok(Array.isArray(items), `${label}: expected a collection`);
  const found = items.filter(predicate);
  assert.equal(found.length, 1, `${label}: expected exactly one declaration`);
  return found[0];
}

const overview = item => item?.codeName?.toLowerCase() === 'sysoverviewcnt';
const named = name => item => item?.name?.toLowerCase() === name.toLowerCase();

function legacyInput(input, refKey, label) {
  assert.equal(input?.type, 'DTO', `${label}: single DTO input required`);
  assert.ok(!input.output, `${label}: output input is not supported`);
  assert.deepEqual(input[refKey], { modelref: true, id: 'ModelObservationDTO' },
    `${label}: input DTO identity differs`);
}

function legacyReturn(result, label) {
  assert.equal(result?.type, 'VOID', `${label}: reviewed legacy VOID return required`);
  assert.deepEqual(Object.keys(result).sort(), ['name', 'type'],
    `${label}: unexpected return metadata`);
}

function rewriteReturn(result, refKey) {
  result.type = 'DTO';
  result[refKey] = { modelref: true, id: dtoName };
}

function counterDTO(app = false) {
  return {
    ...(app ? { codeName: dtoName } : {}),
    name: dtoName,
    [app ? 'getPSAppDEMethodDTOFields' : 'getPSDEMethodDTOFields']: r05Counters.map(name => ({
      ...(app ? { codeName: name } : {}),
      name, type: 'SIMPLE', stdDataType: 1, readOnly: true, allowEmpty: false,
    })),
    sourceType: 'DYNAMODEL',
    type: 'DEFAULT',
  };
}

// Only explicit, reviewed declarations are rewritten. No recursive name match
// can accidentally change another entity's method, permissions or logic.
export function compileR05OwnedModel(inputs) {
  const model = structuredClone(inputs);
  const { action, entity, app, api } = model;
  assert.equal(entity?.name, 'MODELOBSERVATION', 'Expected ModelObservation entity');
  assert.equal(app?.getPSDEName, 'MODELOBSERVATION', 'Expected ModelObservation app entity');
  assert.equal(api?.codeName, 'ModelAPI', 'Expected ModelAPI');
  const embedded = one(entity.getAllPSDEActions, overview, 'Embedded overview action');
  assert.deepEqual(embedded, action, 'Standalone and embedded action metadata differ');
  assert.equal(action?.codeName, 'SysOverviewCnt');
  assert.equal(action.name, 'SysOverviewCnt');
  assert.equal(action.actionType, 'DELOGIC');
  assert.equal(action.dataAccessAction, 'READ');
  assert.ok(!action.batchAction, 'Batch overview action is not supported');
  legacyInput(action.getPSDEActionInput, 'getPSDEMethodDTO', 'Action');
  legacyReturn(action.getPSDEActionReturn, 'Action');
  assert.equal(action.dynaModelFilePath, r05Files.action);
  assert.deepEqual(action.getPSDELogic, {
    modelref: true,
    path: 'PSMODULES/AppStudio/PSDATAENTITIES/ModelObservation/PSDELOGICS/SysOverviewCnt.json',
  }, 'Original action logic identity differs');
  one(entity.getAllPSDEMethodDTOs, named('ModelObservationDTO'), 'Input DTO');
  assert.ok(!entity.getAllPSDEMethodDTOs.some(named(dtoName)),
    'Overview DTO already exists');
  entity.getAllPSDEMethodDTOs.push(counterDTO());
  rewriteReturn(action.getPSDEActionReturn, 'getPSDEMethodDTO');
  rewriteReturn(embedded.getPSDEActionReturn, 'getPSDEMethodDTO');

  one(app.getAllPSAppDEMethodDTOs, named('ModelObservationDTO'), 'App input DTO');
  assert.ok(!app.getAllPSAppDEMethodDTOs.some(named(dtoName)),
    'App overview DTO already exists');
  app.getAllPSAppDEMethodDTOs.push(counterDTO(true));
  for (const key of ['getAllPSAppDEActions', 'getAllPSAppDEMethods']) {
    const method = one(app[key], overview, `App ${key}`);
    assert.equal(method.methodType, 'DEACTION');
    assert.equal(method.requestMethod, 'POST');
    assert.equal(method.requestPath, '/sysoverviewcnt');
    legacyInput(method.getPSAppDEMethodInput, 'getPSAppDEMethodDTO', `App ${key}`);
    legacyReturn(method.getPSAppDEMethodReturn, `App ${key}`);
    rewriteReturn(method.getPSAppDEMethodReturn, 'getPSAppDEMethodDTO');
  }

  const service = one(api.getPSDEServiceAPIs,
    item => item.codeName?.toLowerCase() === 'modelobservation', 'Observation service');
  assert.deepEqual(service.getPSDataEntity, { modelref: true, path: r05Files.entity });
  const relation = one(api.getPSDEServiceAPIRSs,
    item => item.getMinorPSDEServiceAPI?.id?.toLowerCase() === 'modelobservation',
    'Observation parent relationship');
  assert.deepEqual(relation.getMajorPSDEServiceAPI, { modelref: true, id: 'PSDevSlnSys' });
  assert.equal(relation.getParentIdPSDEField?.name, 'PSDEVSLNSYSID');
  for (const [label, owner] of [['API', service], ['Parent API', relation]]) {
    const method = one(owner.getPSDEServiceAPIMethods, overview, label);
    assert.equal(method.methodType, 'DEACTION');
    assert.equal(method.requestMethod, 'POST');
    assert.equal(method.dataAccessAction, 'READ');
    assert.deepEqual(method.getPSDEAction, { modelref: true, path: r05Files.action });
    legacyInput(method.getPSDEServiceAPIMethodInput, 'getPSDEMethodDTO', label);
    legacyReturn(method.getPSDEServiceAPIMethodReturn, label);
    rewriteReturn(method.getPSDEServiceAPIMethodReturn, 'getPSDEMethodDTO');
  }
  return model;
}

function readInputs(workspace) {
  const directories = new PinnedDirectories();
  const inputs = {};
  const entries = [];
  try {
    for (const [key, path] of Object.entries(r05Files)) {
      const absolute = join(workspace, r05ModelRoot, path);
      const { data } = readPinnedFile(directories, directories.open(dirname(absolute)),
        relative(dirname(absolute), absolute));
      assert.equal(hash(data), r05InputHashes[key], `Reviewed R05 input drift: ${path}`);
      inputs[key] = JSON.parse(data);
      entries.push({ path, bytes: data.length, sha256: hash(data) });
    }
  } finally { directories.close(); }
  return { inputs, entries: entries.sort((left, right) => left.path.localeCompare(right.path)) };
}

function candidate(workspace) {
  const source = readInputs(workspace);
  const compiled = compileR05OwnedModel(source.inputs);
  const files = Object.entries(r05Files).map(([key, path]) => ({
    path: `model/${path}`, data: encode(compiled[key]),
  })).sort((left, right) => left.path.localeCompare(right.path));
  const outputs = files.map(({ path, data }) => ({ path, bytes: data.length, sha256: hash(data) }));
  const receipt = {
    schemaVersion: 1,
    contract: 'r05-owned-model-overlay',
    status: 'prepared-metadata-only-not-bound',
    nativeAcceptance: false,
    acceptedForProduction: false,
    generatorSha256: hash(readFileSync(script)),
    sourceModelRoot: r05ModelRoot,
    inputs: { entries: source.entries, ...fingerprint(source.entries) },
    outputs: { entries: outputs, ...fingerprint(outputs) },
    response: { dto: dtoName, counters: [...r05Counters], stdDataType: 1 },
    expectedRuntime: 'net.ibizsys.modeling.core.dataentity.service.ModelObservationDEServiceAPIRuntime',
    runtimeBindingVerified: false,
    scope: 'four-file-overlay-not-a-complete-model-or-runtime-delivery',
    remainingAcceptance: [
      'complete base-model and backend artifact identity',
      'loaded native runtime selection and DTO relationship parsing',
      'actual role authorization and five real nonzero counts over HTTP',
      'browser locale refresh deep-link mobile and cleanup',
    ],
  };
  assert.deepEqual(readInputs(workspace).entries, source.entries,
    'Reviewed R05 inputs changed during candidate preparation');
  return { files, receipt };
}

function ownedOutput(workspace, output) {
  const allowed = join(workspace, '.artifacts/r05-owned-model');
  const child = relative(allowed, output);
  assert.ok(child && child !== '..' && !child.startsWith(`..${sep}`) && !child.startsWith(sep),
    'R05 output must be a child of .artifacts/r05-owned-model');
}

export function prepareR05OwnedModel({ workspace = workspaceRoot, output } = {}) {
  workspace = resolve(workspace);
  assert.ok(typeof output === 'string' && output, 'Explicit new owned output directory required');
  output = resolve(output);
  ownedOutput(workspace, output);
  const prepared = candidate(workspace);
  const directories = new PinnedDirectories();
  try {
    const destination = directories.open(output, { create: true, exclusive: true });
    for (const { path, data } of prepared.files) {
      const file = join(destination.path, path);
      const parent = directories.open(dirname(file), { create: true });
      directories.write(parent, relative(parent.path, file), data);
    }
    directories.write(destination, 'receipt.json', encode(prepared.receipt));
  } finally { directories.close(); }
  verifyR05OwnedModel({ workspace, output });
  return prepared.receipt;
}

export function verifyR05OwnedModel({ workspace = workspaceRoot, output } = {}) {
  workspace = resolve(workspace);
  assert.ok(typeof output === 'string' && output, 'Explicit owned candidate directory required');
  output = resolve(output);
  ownedOutput(workspace, output);
  const expected = candidate(workspace);
  const actual = readTree(output);
  const entries = [...expected.files, { path: 'receipt.json', data: encode(expected.receipt) }]
    .map(({ path, data }) => ({ path, bytes: data.length, sha256: hash(data) }))
    .sort((left, right) => left.path.localeCompare(right.path));
  assert.deepEqual(actual.entries, entries, 'R05 candidate or receipt differs from reviewed generation');
  return expected.receipt;
}

export function main(args = process.argv.slice(2)) {
  const { values } = parseArgs({ args, options: {
    output: { type: 'string' }, verify: { type: 'boolean' },
    help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) {
    console.log('Usage: node prepare-r05-owned-model.mjs --output .artifacts/r05-owned-model/NAME [--verify]');
    console.log('Four-file private metadata overlay only; does not bind, deploy or accept R05.');
    return;
  }
  const receipt = (values.verify ? verifyR05OwnedModel : prepareR05OwnedModel)({
    output: values.output,
  });
  console.log(JSON.stringify(receipt, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === script) {
  try { main(); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
