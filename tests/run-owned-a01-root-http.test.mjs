import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { PinnedDirectories } from '../native-candidate-files.mjs';
import { createFixture } from '../prepare-run-owned-native-nonadmin-fixture.mjs';
import { editorPhysicalInventorySQL, editorPhysicalSnapshotSQL } from '../probe-owned-editor-registry-http.mjs';
import {
  a01MountedModelPath, assertA01ReadOnlySQL, executeOwnedA01, guardA01Bindings, main, verifyA01PublishedMethods,
} from '../run-owned-a01-root-http.mjs';

const { manifest } = createFixture({ runId: 'abcdef012345', scenario: 'two-center', modelVersion: 816,
  uaaSchemaMode: 'legacy-views', passwordStorageMode: 'sm3', secret: () => 'a'.repeat(36) });
const hash = value => createHash('sha256').update(value).digest('hex');

test('actual ModelAPI publishes native nested GET/POST Fetch/PUT update with READ/UPDATE permissions', () => {
  const api = JSON.parse(readFileSync(new URL('../../vendor-upstream/ibizmodeling-standard/modelapi-core/src/main/resources/model/net/ibizsys/modeling/PSSYSSERVICEAPIS/ModelAPI.json', import.meta.url)));
  assert.equal(verifyA01PublishedMethods(api), true);
  const relation = api.getPSDEServiceAPIRSs.find(row =>
    row.getMajorPSDEServiceAPI.id === 'PSDevSlnSys' && row.getMinorPSDEServiceAPI.id === 'PSModule');
  relation.getPSDEServiceAPIMethods.find(row => row.name === 'FetchCurSys').requestMethod = 'GET';
  assert.throws(() => verifyA01PublishedMethods(api));
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

test('CLI has no implicit target, shared URL, lifecycle flags or denied UPDATE opt-in fallback', async () => {
  await assert.rejects(executeOwnedA01());
  let opened = 0;
  await assert.rejects(executeOwnedA01({ executeOwned: true, runId: manifest.runId, label: 'unit',
    deploymentInput: 'input.private.json', contextFactory() { opened++; } }));
  assert.equal(opened, 0);
  for (const args of [[], ['--url=http://127.0.0.1:30250'], ['--restart-owned-provider'],
    ['--execute-owned-a01', '--execute-owned-a01'], ['--allow-owned-denied-updates', '--allow-owned-denied-updates'],
    [`--run-id=${manifest.runId}`, `--run-id=${manifest.runId}`]]) await assert.rejects(main(args));
});
