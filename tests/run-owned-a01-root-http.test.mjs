import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { PinnedDirectories, readPinnedFile } from '../native-candidate-files.mjs';
import { prepareR05OwnedModel, r05Files, r05ModelRoot } from '../prepare-r05-owned-model.mjs';
import { stageOwnedModelInput } from '../launch-run-owned-native-backend.mjs';
import { createFixture } from '../prepare-run-owned-native-nonadmin-fixture.mjs';
import { editorPhysicalInventorySQL, editorPhysicalSnapshotSQL } from '../probe-owned-editor-registry-http.mjs';
import {
  a01MountedModelPath, assertA01ReadOnlySQL, executeOwnedA01, guardA01Bindings, main,
  verifyA01MountedModelAPI, verifyA01ParentlessMethods, verifyA01PublishedMethods,
} from '../run-owned-a01-root-http.mjs';

const { manifest } = createFixture({ runId: 'abcdef012345', scenario: 'two-center', modelVersion: 816,
  uaaSchemaMode: 'legacy-views', passwordStorageMode: 'sm3', secret: () => 'a'.repeat(36) });
const hash = value => createHash('sha256').update(value).digest('hex');
const actualWorkspace = new URL('../../', import.meta.url).pathname;

function modelStage(t, { r05 = false } = {}) {
  const workspace = mkdtempSync(join(tmpdir(), 'a01-r05-model-api-'));
  const directories = new PinnedDirectories();
  t.after(() => { directories.close(); rmSync(workspace, { recursive: true, force: true }); });
  const source = join(workspace, r05ModelRoot);
  for (const path of Object.values(r05Files)) {
    mkdirSync(dirname(join(source, path)), { recursive: true });
    copyFileSync(join(actualWorkspace, r05ModelRoot, path), join(source, path));
  }
  writeFileSync(join(source, 'unrelated.json'), '{"mustRemain":"unchanged"}\n');
  const candidate = join(workspace, '.artifacts/r05-owned-model/candidate');
  prepareR05OwnedModel({ workspace, output: candidate });
  const base = join(workspace, '.artifacts/native-nonadmin-fixtures', manifest.runId);
  const deploymentInput = join(base, 'backend-runtime-a01-r05-r1/deployment-input.private.json');
  const stage = join(dirname(deploymentInput), 'model-input');
  const result = stageOwnedModelInput({
    workspace, source, outputPath: stage, directories,
    r05OwnedModelCandidate: r05 ? candidate : undefined,
  });
  const provider = { Id: 'pinned-provider', Mounts: [{
    Destination: '/app/model', Source: stage, Type: 'bind', RW: false,
  }] };
  const context = {
    base, manifest, deployment: {
      services: { provider: { containerId: provider.Id } },
      ...(r05 ? { r05OwnedModelBinding: JSON.parse(JSON.stringify(result.r05OwnedModelBinding)) } : {}),
    },
  };
  return {
    workspace, source, stage, candidate, context, provider, deploymentInput,
    live: { containers: [provider] },
    read: path => readPinnedFile(directories, directories.open(dirname(path)), basename(path)).data,
  };
}

test('actual ModelAPI publishes native nested GET/POST Fetch/PUT update with READ/UPDATE permissions', () => {
  const api = JSON.parse(readFileSync(new URL('../../vendor-upstream/ibizmodeling-standard/modelapi-core/src/main/resources/model/net/ibizsys/modeling/PSSYSSERVICEAPIS/ModelAPI.json', import.meta.url)));
  assert.equal(verifyA01PublishedMethods(api), true);
  const relation = api.getPSDEServiceAPIRSs.find(row =>
    row.getMajorPSDEServiceAPI.id === 'PSDevSlnSys' && row.getMinorPSDEServiceAPI.id === 'PSModule');
  relation.getPSDEServiceAPIMethods.find(row => row.name === 'FetchCurSys').requestMethod = 'GET';
  assert.throws(() => verifyA01PublishedMethods(api));
});

test('parentless probes require the actual MAJOR model declarations and native adapter source contract', () => {
  const api = JSON.parse(readFileSync(new URL('../../vendor-upstream/ibizmodeling-standard/modelapi-core/src/main/resources/model/net/ibizsys/modeling/PSSYSSERVICEAPIS/ModelAPI.json', import.meta.url)));
  const adapter = readFileSync(new URL('../../ibiz-service-hub/libs/ibiz-cloud-core/src/main/java/net/ibizsys/central/cloud/core/service/StandardSysServiceAPIRequestMappingAdapter.java', import.meta.url), 'utf8');
  assert.equal(verifyA01ParentlessMethods(api, adapter), true);
  for (const change of [
    value => { value.aPIMode = 0; },
    value => { value.codeName = 'Other'; },
    value => { value.getPSDEServiceAPIMethods.find(row => row.name === 'FetchCurSys').requestMethod = 'GET'; },
    value => { value.getPSDEServiceAPIMethods.find(row => row.name === 'Update').needResourceKey = false; },
    value => { value.getPSDEServiceAPIMethods.find(row => row.name === 'Update').noServiceCodeName = false; },
    value => { value.getPSDEServiceAPIMethods.find(row => row.name === 'Update').requestPath = '/alternate'; },
    value => { value.getPSDEServiceAPIMethods.push(value.getPSDEServiceAPIMethods.find(row => row.name === 'Update')); },
  ]) {
    const changed = structuredClone(api);
    change(changed.getPSDEServiceAPIs.find(row => row.codeName === 'PSModule'));
    assert.throws(() => verifyA01ParentlessMethods(changed, adapter));
  }
  assert.throws(() => verifyA01ParentlessMethods(api,
    adapter.replaceAll('invokeDEMethod(null, null, null,', 'invokeDEMethod(null, "root", "fallback",')));
});

test('native model contract selects only the exact provider readonly own-deployment model mount', () => {
  const base = `/workspace/.artifacts/native-nonadmin-fixtures/${manifest.runId}`;
  const deploymentInput = `${base}/backend-runtime-unit/deployment-input.private.json`;
  const context = { base, deployment: { services: { provider: { containerId: 'pinned-provider' } } } };
  const provider = { Id: 'pinned-provider', Mounts: [{
    Destination: '/app/model', Source: `${base}/backend-runtime-unit/model-input`, Type: 'bind', RW: false,
  }] };
  const live = { containers: [provider] };
  assert.equal(a01MountedModelPath(context, live, deploymentInput),
    `${base}/backend-runtime-unit/model-input/PSSYSSERVICEAPIS/ModelAPI.json`);
  for (const mutate of [
    p => { p.Id = 'other'; }, p => { p.Mounts[0].RW = true; },
    p => { p.Mounts[0].Source = '/shared'; }, p => { p.Mounts.push(p.Mounts[0]); },
  ]) {
    const changed = structuredClone(provider); mutate(changed);
    assert.throws(() => a01MountedModelPath(context, { containers: [changed] }, deploymentInput));
  }
});

test('without an R05 declaration A01 still requires the exact authoritative ModelAPI bytes', t => {
  const fixture = modelStage(t);
  const checked = verifyA01MountedModelAPI(fixture);
  assert.equal(checked.binding.mode, 'exact-authoritative-model-api-bytes');
  assert.equal(checked.binding.sourceSha256, checked.binding.stagedSha256);
  assert.equal(checked.binding.r05Selected, false);
  assert.equal(checked.binding.moduleContractUnchanged, true);
  assert.equal(checked.binding.fullA01Acceptance, false);
  const path = join(fixture.stage, r05Files.api);
  const original = readFileSync(path);
  writeFileSync(path, `${original}\n`);
  assert.throws(() => verifyA01MountedModelAPI(fixture), /match the reviewed source/);
});

test('a freshly rederived canonical R05 ModelAPI coexists with the complete unchanged A01 module contract', t => {
  const fixture = modelStage(t, { r05: true });
  const checked = verifyA01MountedModelAPI(fixture);
  assert.equal(checked.binding.mode, 'fresh-canonical-r05-overlay-with-unchanged-a01-module');
  assert.equal(checked.binding.r05Selected, true);
  assert.notEqual(checked.binding.sourceSha256, checked.binding.stagedSha256);
  assert.equal(checked.binding.moduleContractUnchanged, true);
  assert.equal(checked.binding.nativeAcceptance, false);
  assert.equal(checked.binding.fullA01Acceptance, false);
  const source = JSON.parse(readFileSync(join(fixture.source, r05Files.api)));
  assert.deepEqual(checked.api.getPSDEServiceAPIs.find(row => row.codeName === 'PSModule'),
    source.getPSDEServiceAPIs.find(row => row.codeName === 'PSModule'));
  const observation = checked.api.getPSDEServiceAPIs.find(row => row.codeName === 'ModelObservation');
  assert.equal(observation.getPSDEServiceAPIMethods.find(row => row.codeName === 'SysOverviewCnt')
    .getPSDEServiceAPIMethodReturn.type, 'DTO');
  assert.equal(source.getPSDEServiceAPIs.find(row => row.codeName === 'ModelObservation')
    .getPSDEServiceAPIMethods.find(row => row.codeName === 'SysOverviewCnt')
    .getPSDEServiceAPIMethodReturn.type, 'VOID');
});

for (const target of ['module', 'module-major', 'relationship', 'observation', 'unrelated-api', 'unrelated-stage']) {
  test(`canonical R05 approval cannot admit an additional ${target} change`, t => {
    const fixture = modelStage(t, { r05: true });
    if (target === 'unrelated-stage') {
      writeFileSync(join(fixture.stage, 'unrelated.json'), '{"changed":true}\n');
    } else {
      const file = join(fixture.stage, r05Files.api);
      const api = JSON.parse(readFileSync(file));
      if (target === 'module') api.getPSDEServiceAPIs.find(row => row.codeName === 'PSModule')
        .getPSDEServiceAPIMethods.find(row => row.name === 'Update').dataAccessAction = 'READ';
      if (target === 'module-major') api.getPSDEServiceAPIs.find(row => row.codeName === 'PSModule').aPIMode = 0;
      if (target === 'relationship') api.getPSDEServiceAPIRSs.find(row =>
        row.getMajorPSDEServiceAPI.id === 'PSDevSlnSys' && row.getMinorPSDEServiceAPI.id === 'PSModule')
        .getPSDEServiceAPIMethods.find(row => row.name === 'FetchCurSys').requestMethod = 'GET';
      if (target === 'observation') api.getPSDEServiceAPIs.find(row => row.codeName === 'ModelObservation')
        .getPSDEServiceAPIMethods.find(row => row.codeName === 'SysOverviewCnt').dataAccessAction = 'NONE';
      if (target === 'unrelated-api') api.unreviewedSelection = true;
      writeFileSync(file, `${JSON.stringify(api, null, 2)}\n`);
    }
    assert.throws(() => verifyA01MountedModelAPI(fixture));
  });
}

test('R05 JSON flags, modified candidate receipts, and binding deletion cannot replace a current proof', t => {
  const fixture = modelStage(t, { r05: true });
  const original = structuredClone(fixture.context.deployment.r05OwnedModelBinding);
  fixture.context.deployment.r05OwnedModelBinding.runtimeBindingVerified = true;
  assert.throws(() => verifyA01MountedModelAPI(fixture));
  fixture.context.deployment.r05OwnedModelBinding = original;
  const receipt = join(fixture.candidate, 'receipt.json');
  const bytes = readFileSync(receipt);
  const changed = JSON.parse(bytes);
  changed.nativeAcceptance = true;
  writeFileSync(receipt, `${JSON.stringify(changed, null, 2)}\n`);
  assert.throws(() => verifyA01MountedModelAPI(fixture));
  writeFileSync(receipt, bytes);
  delete fixture.context.deployment.r05OwnedModelBinding;
  assert.throws(() => verifyA01MountedModelAPI(fixture), /match the reviewed source/);
});

test('R05 consumption requires the exact inspected provider mount in the selected deployment', t => {
  const fixture = modelStage(t, { r05: true });
  for (const mutate of [
    value => { value.Mounts[0].Source = join(fixture.context.base, 'backend-runtime-other/model-input'); },
    value => { value.Mounts[0].RW = true; },
    value => { value.Mounts.push({ ...value.Mounts[0] }); },
    value => { value.Mounts = []; },
  ]) {
    const provider = structuredClone(fixture.provider);
    mutate(provider);
    assert.throws(() => verifyA01MountedModelAPI({ ...fixture, live: { containers: [provider] } }));
  }
});
test('snapshot SQL is SELECT-only and cannot be replaced with data/schema/credential mutation', () => {
  assert.equal(assertA01ReadOnlySQL(editorPhysicalInventorySQL(manifest)), true);
  assert.equal(assertA01ReadOnlySQL(editorPhysicalSnapshotSQL([
    { database: manifest.roots[0].database, table: 't_srfpsmodule', columns: [{ column: 'psmoduleid' }] },
  ])), true);
  for (const sql of ['DELETE FROM t;', 'SELECT 1;', 'SELECT JSON_OBJECT(1); DROP TABLE t;',
    'SELECT JSON_OBJECT(1) INTO OUTFILE "/tmp/leak";', 'SELECT JSON_OBJECT(1); -- bypass',
    'CALL procedure();', 'SELECT JSON_OBJECT(1) /*mutation*/;']) assert.throws(() => assertA01ReadOnlySQL(sql));
});

test('source guard returns inspected live origins and rejects changed bytes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'a01-binding-'));
  const directories = new PinnedDirectories();
  try {
    const parent = directories.open(directory);
    directories.write(parent, 'source.txt', 'original');
    const bindings = [{ parent, name: 'source.txt', sha256: hash('original') }];
    const live = { origins: { backend: 'http://10.91.0.9:30086' } };
    assert.equal(guardA01Bindings({ guard: () => live }, directories, bindings), live);
    writeFileSync(join(directory, 'source.txt'), 'changed');
    assert.throws(() => guardA01Bindings({ guard: () => live }, directories, bindings));
  } finally { directories.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('retired/unavailable peer cannot authorize SQL or HTTP using a historical deployment receipt', async () => {
  let commands = 0;
  let closed = false;
  const result = await executeOwnedA01({
    workspace: '/unavailable', runId: manifest.runId, label: 'unit',
    deploymentInput: 'historical.private.json', executeOwned: true, allowDeniedUpdates: true,
    execute: () => { commands++; assert.fail('No command after a failed fresh guard'); },
    contextFactory: () => ({ guard: () => { throw new Error('retired'); }, close: () => { closed = true; } }),
  });
  assert.equal(result.report.status, 'failed-owned-a01-http');
  assert.equal(result.report.fullA01Acceptance, false);
  assert.equal(result.report.stage, 'fresh-owned-runtime-inspection');
  assert.equal(result.reportPath, null);
  assert.equal(commands, 0); assert.equal(closed, true);
});

test('an explicit R05 requirement reaches the runtime context factory and fails closed before output or commands', async () => {
  let commands = 0;
  let closed = false;
  let required;
  const result = await executeOwnedA01({
    workspace: '/unavailable', runId: manifest.runId, label: 'unit',
    deploymentInput: 'historical.private.json', executeOwned: true, allowDeniedUpdates: true,
    requireR05Binding: true,
    execute: () => { commands++; assert.fail('No Docker, HTTP or SQL after missing required binding'); },
    contextFactory(options) {
      required = options.requireR05Binding;
      return { guard: () => assert.fail('Missing R05 binding must fail before the delegated guard'),
        close: () => { closed = true; } };
    },
  });
  assert.equal(required, true);
  assert.equal(result.report.status, 'failed-owned-a01-http');
  assert.equal(result.report.stage, 'fresh-owned-runtime-inspection');
  assert.equal(result.reportPath, null);
  assert.equal(closed, true);
  assert.equal(commands, 0);
  await assert.rejects(executeOwnedA01({
    executeOwned: true, allowDeniedUpdates: true, requireR05Binding: 'true',
    contextFactory: () => assert.fail('Invalid option must not open a runtime context'),
  }), /boolean/);
});

test('CLI has no implicit target, shared URL, lifecycle flags or denied UPDATE opt-in fallback', async () => {
  await assert.rejects(executeOwnedA01());
  let opened = 0;
  await assert.rejects(executeOwnedA01({ executeOwned: true, runId: manifest.runId, label: 'unit',
    deploymentInput: 'input.private.json', contextFactory() { opened++; } }));
  assert.equal(opened, 0);
  for (const args of [[], ['--url=http://127.0.0.1:30250'], ['--restart-owned-provider'],
    ['--execute-owned-a01', '--execute-owned-a01'], ['--allow-owned-denied-updates', '--allow-owned-denied-updates'],
    ['--include-parentless-absent', '--include-parentless-absent'],
    ['--require-r05-binding', '--require-r05-binding'],
    [`--run-id=${manifest.runId}`, `--run-id=${manifest.runId}`]]) await assert.rejects(main(args));
});
