import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { createFixture } from '../prepare-run-owned-native-nonadmin-fixture.mjs';
import { readNativeFiveDatasetContract } from '../native-five-dataset-contract.mjs';
import { validateEditorSeedReceipt, verifyEditorCreateEvidence } from '../probe-owned-editor-registry-http.mjs';
import {
  chooseNativeEditorAppConfig, createOwnedEditorNativeSeedIO, editorNativeSeedPayload, executeOwnedEditorNativeSeeds,
  runOwnedEditorNativeSeeds, validateEditorNativeSeedRequest, verifyEditorNativeSeedInitial,
  verifyEditorNativeSeedMutation,
} from '../seed-owned-editor-registry-native.mjs';

const contract = readNativeFiveDatasetContract();
const runId = 'f01006abcdef';
const hash = value => createHash('sha256').update(value).digest('hex');
const clone = value => structuredClone(value);
const hex = value => value === null ? null : Buffer.from(String(value)).toString('hex').toUpperCase();
const encoded = object => Object.fromEntries(Object.entries(object).map(([key, value]) => [key, hex(value)]));
const decoded = object => Object.fromEntries(Object.entries(object).map(([key, value]) =>
  [key, value === null ? null : Buffer.from(value, 'hex').toString('utf8')]));
const fixture = () => createFixture({
  runId, scenario: 'two-center', modelVersion: 816, uaaSchemaMode: 'legacy-views',
  passwordStorageMode: 'sm3', secret: () => '1'.repeat(36),
});

function sourceAccounts(manifest) {
  return manifest.users.map(user => ({
    id: user.personId, loginname: user.loginname, tenant: user.centerId,
    organization: `${user.centerId}_org`, organizationTenant: user.centerId,
    memberTenant: user.centerId, memberOrganization: `${user.centerId}_org`,
    roleTenant: user.centerId, roleId: `${user.centerId}_ordinary_role`,
    deploymentTenant: user.centerId, system: 'ibizmodeling', authority: 'ROLE_NATIVE_FIXTURE',
    personEnabled: 1, personStatus: '1', domainEnabled: 1, organizationEnabled: 1,
    roleEnabled: 1, deploymentEnabled: 1, deploymentDeleted: 0,
    developerTenant: user.centerId, developerAdminMode: 0, developerEnabled: 1,
    developerObjectEnabled: 1, developerValid: 1,
  }));
}

const realConfig = actor => ({
  PSPF: [{ pspfid: 'real-platform', pspfname: 'Observed platform', psapptypeid: 'real-type', validflag: 1 }],
  PSPFStyle: [{ pspfstyleid: 'real-style', pspfstylename: 'Observed style',
    pspfid: 'real-platform', psdevcenterid: actor.centerId }],
  PSAppType: [{ psapptypeid: 'real-type', psapptypename: 'Observed application type' }],
});

function fakeRuntime(options = {}) {
  const { manifest, credentials } = fixture();
  const accounts = sourceAccounts(manifest);
  let clock = Date.UTC(2026, 10, 11);
  let guards = 0;
  let lastGuard = 0;
  let serial = 0;
  let created = 0;
  const records = [];
  const requests = [];
  const tables = manifest.roots.flatMap(root => [
    ...contract.datasets.map(dataset => ({ database: root.database, table: dataset.table, rows: [] })),
    { database: root.database, table: 't_srfpsmodule', rows: [encoded({
      psmoduleid: root.sentinelId, pssystemid: root.logicalSystemId,
      psmodulename: root.sentinelName, modtag: root.sentinelTag, nullable: null, binary_evidence: '\u0000\u0001',
    })] },
    { database: root.database, table: 't_srfpssystem', rows: [encoded({
      pssystemid: root.logicalSystemId, pssystemname: root.sentinelSystemName,
      psdevslnsysid: root.rootId, pssysmodelinstid: root.modelInstanceId,
      psdevcenterid: root.centerId, modelver: root.modelVersion, unexpected_column: 'unchanged',
    })] },
    { database: root.database, table: 't_srfpssysmodellog', rows: [] },
    { database: root.database, table: 't_srfpssysmodelfolderitem', rows: [] },
    { database: root.database, table: 't_srfpssystask', rows: [] },
  ]);
  if (options.existing) tables[0].rows.push(encoded({ pssysdbschemeid: 'foreign-old-row' }));
  const state = () => ({ encoding: 'every-physical-column-null-or-hex-cast-binary-v1',
    inventory: [{ binary: 'complete-test-inventory' }], tables: clone(tables) });
  const context = { manifest, credentials, guard() {
    guards++;
    clock += options.guardTick ?? 0;
    if (options.guardFailure && created > 0) throw new Error('owned topology drift');
    return { origins: { backend: 'http://10.93.0.4:30086' } };
  } };
  const guarded = () => {
    assert.ok(guards > lastGuard, 'Every HTTP/SQL operation needs a fresh owned guard');
    lastGuard = guards;
  };
  const response = (status, data, error = null) => ({
    status, data, error, dispatched: true, responseSha256: 'a'.repeat(64),
  });
  const io = {
    accounts() { guarded(); return clone(accounts); },
    snapshot() { guarded(); return state(); },
    async request(spec) {
      guarded();
      validateEditorNativeSeedRequest(manifest, contract, spec);
      requests.push(clone(spec));
      const actor = manifest.users.find(user => user.personId === spec.actorId);
      assert.equal(actor.role, 'editor');
      if (spec.path === '/v7/login') {
        assert.equal(records.at(-1).kind, 'login-intent');
        assert.equal(spec.data.password, credentials.users[actor.loginname]);
        const claims = { iat: Math.floor(clock / 1000), exp: Math.floor(clock / 1000) + 20, sub: actor.loginname };
        clock += options.requestTick ?? 0;
        return response(200, { token: `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature` });
      }
      assert.ok(clock - spec.sessionStartedAt < 10_000);
      clock += options.requestTick ?? 0;
      if (spec.path === '/appdata') return response(200, { context: {
        srfuserid: actor.personId, srfpersonid: actor.personId, srfdcid: actor.centerId,
        srforgid: `${actor.centerId}_org`, srfsystemid: 'ibizmodeling', srfdcsystemid: 'ibizmodeling',
      } });
      if (spec.path === '/uaa/oauth/userinfo') return response(200, { sub: actor.loginname });
      const config = contract.applicationConfig.find(config => config.readPath === spec.path);
      if (config) {
        if (options.configStatus) return response(options.configStatus, { message: 'actual config failure' });
        return response(200, options.noConfig ? [] : realConfig(actor)[config.entity]);
      }
      const root = manifest.roots.find(root => root.rootId === actor.rootId);
      const dataset = contract.datasets.find(row => row.collectionPath.replace('$ROOT_ID', root.rootId) === spec.path);
      assert.ok(dataset);
      assert.equal(records.at(-1).kind, 'mutation-intent');
      assert.deepEqual(records.at(-1).value.request, spec.data);
      assert.equal(spec.data[dataset.keyField], undefined, 'Use actual native generated keys');
      created++;
      if (options.failCreate === created && !options.timeoutAfterWrite) {
        return response(options.failStatus ?? 500, { message: 'actual native failure' });
      }
      const key = `native_generated_${created}`;
      const dto = { ...spec.data, [dataset.keyField]: key,
        ...(dataset.entity === 'PSSysApp' || dataset.entity === 'PSSysSFPub'
          ? { pssystemname: root.sentinelSystemName } : {}) };
      const own = tables.find(table => table.database === root.database && table.table === dataset.table);
      own.rows.push(encoded(dto));
      const system = tables.find(table => table.database === root.database && table.table === 't_srfpssystem');
      const version = Number(decoded(system.rows[0]).modelver);
      system.rows[0].modelver = hex(version + (options.noVersion ? 0 : 1));
      const logs = tables.find(table => table.database === root.database && table.table === 't_srfpssysmodellog');
      if (!options.noLog) logs.rows.push(encoded({
        pssysmodellogid: `log_${created}`, pssysmodellogname: dataset.entity.toUpperCase(),
        pssystemid: root.logicalSystemId, pssystemname: '(N/A)', createman: actor.personId,
      }));
      if (options.foreignMutation) {
        const foreign = tables.find(table => table.database !== root.database && table.table === 't_srfpsmodule');
        foreign.rows[0].modtag = hex('forbidden');
      }
      if (options.unrelatedMutation) {
        const folder = tables.find(table => table.database === root.database && table.table === 't_srfpssysmodelfolderitem');
        folder.rows.push(encoded({ id: 'unexpected-folder-write' }));
      }
      if (options.failCreate === created && options.timeoutAfterWrite) return response(null, null, 'timeout');
      return response(200, options.wrongDto ? { ...dto, usertag: 'foreign' } : dto);
    },
  };
  const bindings = {
    deploymentInput: { path: '/owned/deployment-input.private.json', sha256: 'd'.repeat(64) },
    sourceImages: { path: '/owned/source-images.json', sha256: 'e'.repeat(64) },
    sourceContractSha256: hash(`${JSON.stringify(contract, null, 2)}\n`),
  };
  const record = (kind, value) => {
    if (options.journalFailure && kind === 'mutation-intent') throw new Error('private journal failed');
    records.push({ kind, value: clone(value) });
    return { path: `/owned/${records.length}-${kind}.private.json`, sha256: 'f'.repeat(64) };
  };
  return { context, contract, bindings, io, record, records, requests, tables,
    state, now: () => clock, nonce: () => (++serial).toString(16).padStart(12, '0') };
}

const run = runtime => runOwnedEditorNativeSeeds({ ...runtime, executeOwned: true });

test('only actual coherent active platform/style/type rows are eligible for application creation', () => {
  const actor = fixture().manifest.users[0];
  assert.deepEqual(chooseNativeEditorAppConfig(realConfig(actor), actor), {
    pspfid: 'real-platform', pspfstyleid: 'real-style', psapptypeid: 'real-type',
    psapptypename: 'Observed application type',
  });
  for (const change of [
    rows => { rows.PSPF = []; }, rows => { rows.PSPF[0].validflag = '1'; },
    rows => { rows.PSPF[0].validflag = 0; }, rows => { rows.PSPFStyle[0].pspfid = 'foreign'; },
    rows => { rows.PSPFStyle[0].psdevcenterid = 'foreign'; }, rows => { rows.PSAppType[0].psapptypename = ''; },
    rows => { rows.PSPF[0].psapptypeid = 'foreign'; },
  ]) {
    const rows = realConfig(actor);
    change(rows);
    assert.equal(chooseNativeEditorAppConfig(rows, actor), null);
  }
  const duplicate = realConfig(actor);
  duplicate.PSPF.push(clone(duplicate.PSPF[0]));
  assert.throws(() => chooseNativeEditorAppConfig(duplicate, actor));
});

test('native payloads use owned markers and backend key generation, never unresolved fake config IDs', () => {
  const { manifest } = fixture();
  for (const root of manifest.roots) for (const dataset of contract.datasets) {
    const payload = editorNativeSeedPayload(manifest, root, dataset, '123456abcdef',
      chooseNativeEditorAppConfig(realConfig(manifest.users[0]), manifest.users[0]));
    assert.equal(payload[dataset.keyField], undefined);
    assert.ok(payload.usertag.includes(manifest.runId));
    assert.ok(payload[dataset.nameField].includes(manifest.runId));
    assert.equal(payload.pssystemid, root.logicalSystemId);
    assert.ok(!JSON.stringify(payload).includes('$'));
  }
  assert.throws(() => editorNativeSeedPayload(manifest, manifest.roots[0],
    contract.datasets[1], '123456abcdef', null), /fabricated/);
});

test('route boundary permits editor own-root Create/config/identity only, never foreign writes/removal/direct fallback', () => {
  const runtime = fakeRuntime();
  const actor = runtime.context.manifest.users.find(user => user.role === 'editor');
  const root = runtime.context.manifest.roots.find(root => root.rootId === actor.rootId);
  const spec = { path: contract.datasets[0].collectionPath.replace('$ROOT_ID', root.rootId),
    method: 'POST', actorId: actor.personId,
    data: editorNativeSeedPayload(runtime.context.manifest, root, contract.datasets[0], '123456abcdef'),
    token: 'header.payload.signature', applicationContext: { system: 'ibizmodeling', organization: `${actor.centerId}_org` } };
  assert.doesNotThrow(() => validateEditorNativeSeedRequest(runtime.context.manifest, contract, spec));
  for (const bad of [
    { ...spec, method: 'DELETE' }, { ...spec, path: `${spec.path}/some-key` },
    { ...spec, path: spec.path.replace(root.rootId, runtime.context.manifest.roots[1].rootId) },
    { ...spec, actorId: runtime.context.manifest.users.find(user => user.role === 'viewer').personId },
    { ...spec, path: '/extension/api/pssysdbschemes' }, { ...spec, data: { pssystemid: 'foreign' } },
    { ...spec, token: 'token\r\ninjection' },
    { ...spec, data: { ...spec.data, servicepath: 'http://foreign' } },
    { ...spec, data: { ...spec.data, usertag: 'foreign-marker' } },
    { ...spec, data: { ...spec.data, dslink: 'UNREVIEWED' } },
    { ...spec, headers: { superuser: 1 } },
  ]) assert.throws(() => validateEditorNativeSeedRequest(runtime.context.manifest, contract, bad));
});

test('full native fake run retains ten source-bound generated keys and only exact audited version/log effects', async () => {
  const runtime = fakeRuntime();
  const before = runtime.state();
  const report = await run(runtime);
  assert.equal(report.status, 'passed-native-create-seeds');
  assert.equal(report.fullInitializationAcceptance, true);
  assert.equal(report.records.length, 10);
  assert.equal(report.mutationJournals.length, 10);
  assert.equal(new Set(report.records.map(record => record.key)).size, 10);
  assert.equal(new Set(report.records.map(record => record.userTag)).size, 10);
  assert.equal(report.nativeAcceptance, false);
  assert.equal(report.permissionAcceptance, false);
  assert.equal(report.sqlWritesRequested, false);
  assert.equal(report.nativeCleanupPerformed, false);
  validateEditorSeedReceipt(runtime.context.manifest, contract, report, runtime.bindings);
  for (const record of report.records) {
    const evidence = runtime.records.find(item => item.kind === 'create-evidence'
      && item.value.response[contract.datasets.find(dataset => dataset.entity === record.entity).keyField] === record.key);
    assert.ok(evidence);
    verifyEditorCreateEvidence(runtime.context.manifest, contract, record, evidence.value);
    assert.equal(record.sideEffects.version.delta, 1);
  }
  for (const root of runtime.context.manifest.roots) {
    const modules = snapshot => snapshot.tables.find(table => table.database === root.database && table.table === 't_srfpsmodule');
    assert.deepEqual(modules(runtime.state()), modules(before));
    const system = runtime.state().tables.find(table => table.database === root.database && table.table === 't_srfpssystem');
    assert.equal(Number(decoded(system.rows[0]).modelver), 821);
  }
  assert.ok(!JSON.stringify(report).includes('header.'));
  assert.ok(runtime.requests.every(request => !request.path.includes('refresh_token')));
});

test('missing or failed real config yields eight native rows and an explicitly rejected partial receipt', async () => {
  for (const options of [{ noConfig: true }, { configStatus: 403 }, { configStatus: 500 }]) {
    const runtime = fakeRuntime(options);
    const report = await run(runtime);
    assert.equal(report.status, 'partial-native-create-seeds-app-config-blocked');
    assert.equal(report.records.length, 8);
    assert.equal(report.fullInitializationAcceptance, false);
    assert.ok(report.blocked.length >= 2);
    assert.ok(report.records.every(record => record.entity !== 'PSSysApp'));
    assert.throws(() => validateEditorSeedReceipt(runtime.context.manifest, contract, report, runtime.bindings));
    assert.ok(!runtime.requests.some(request => request.path.endsWith('/pssysapps')));
  }
});

test('existing rows and private journal failures stop before any native Create without adopting or deleting rows', async () => {
  for (const options of [{ existing: true }, { journalFailure: true }]) {
    const runtime = fakeRuntime(options);
    const report = await run(runtime);
    assert.equal(report.status, 'failed-native-create-seeds');
    assert.equal(report.records.length, 0);
    assert.ok(!runtime.requests.some(request => contract.datasets.some(dataset =>
      runtime.context.manifest.roots.some(root => request.path === dataset.collectionPath.replace('$ROOT_ID', root.rootId)))));
    if (options.existing) assert.equal(runtime.tables[0].rows.length, 1);
    assert.ok(runtime.requests.every(request => request.method !== 'DELETE'));
  }
});

test('caller-supplied resume records cannot bypass empty-table or original-system baseline checks', async () => {
  for (const existing of [true, false]) {
    const runtime = fakeRuntime({ existing });
    if (!existing) {
      runtime.tables.find(table => table.table === 't_srfpssystem').rows[0].modelver = hex('999');
    }
    const report = await runOwnedEditorNativeSeeds({
      ...runtime, executeOwned: true,
      resumeRecords: [{ entity: 'PSSysDBScheme', key: 'claimed-existing-row' }],
    });
    assert.equal(report.status, 'failed-native-create-seeds');
    assert.equal(report.records.length, 0);
    assert.equal(report.mutationJournals.length, 0);
    assert.equal(runtime.requests.length, 0);
  }
});

test('an asynchronous mutation journal cannot authorize a native Create before durable completion', async () => {
  const runtime = fakeRuntime();
  const original = runtime.record;
  runtime.record = (kind, value) => kind === 'mutation-intent'
    ? Promise.resolve({ path: '/owned/not-yet-durable.private.json', sha256: 'f'.repeat(64) })
    : original(kind, value);
  const report = await run(runtime);
  assert.equal(report.status, 'failed-native-create-seeds');
  assert.equal(report.records.length, 0);
  assert.equal(report.mutationJournals.length, 0);
  assert.ok(!runtime.requests.some(request => request.path.includes('/psdevslnsys/')));
});

test('native failure and ambiguous timeout stop further writes and preserve prewrite journal plus physical evidence', async () => {
  for (const options of [{ failCreate: 2 }, { failCreate: 2, timeoutAfterWrite: true }]) {
    const runtime = fakeRuntime(options);
    const report = await run(runtime);
    assert.equal(report.status, 'failed-native-create-seeds');
    assert.equal(report.records.length, 1);
    assert.equal(report.mutationJournals.length, 2);
    assert.equal(report.mutationJournals.at(-1).status, 'journalled-before-dispatch');
    assert.ok(report.failure);
    assert.ok(report.snapshots.some(snapshot => snapshot.purpose === 'failure-retained-all-model-tables'));
    assert.equal(runtime.requests.filter(request => request.path.includes('/psdevslnsys/')).length, 2);
    assert.ok(runtime.requests.every(request => request.method !== 'DELETE'));
  }
});

for (const options of [
  { foreignMutation: true }, { unrelatedMutation: true }, { noVersion: true }, { noLog: true }, { wrongDto: true },
]) {
  test(`native side-effect/DTO violation ${Object.keys(options)[0]} cannot be hidden by general audit allowances`, async () => {
    const runtime = fakeRuntime(options);
    const report = await run(runtime);
    assert.equal(report.status, 'failed-native-create-seeds');
    assert.equal(report.fullInitializationAcceptance, false);
    assert.equal(report.records.length, 0);
    assert.equal(report.mutationJournals.length, 1);
    assert.ok(report.failure);
  });
}

test('normal twenty-second token renewal stays under ten-second session age without changing backend TTL', async () => {
  const runtime = fakeRuntime({ requestTick: 900, guardTick: 30 });
  const report = await run(runtime);
  assert.equal(report.status, 'passed-native-create-seeds');
  assert.ok(runtime.requests.filter(request => request.path === '/v7/login').length > 2);
});

test('guard drift after one write stops every later HTTP mutation and retains failed pending ownership evidence', async () => {
  const runtime = fakeRuntime({ guardFailure: true });
  const report = await run(runtime);
  assert.equal(report.status, 'failed-native-create-seeds');
  assert.equal(report.records.length, 0);
  assert.equal(report.mutationJournals.length, 1);
  assert.equal(report.failureSnapshotUnavailable, true);
  assert.equal(runtime.requests.filter(request => request.path.includes('/psdevslnsys/')).length, 1);
});

test('seed initial baseline and native response keys refuse unauthorized baseline adoption or unsafe keys', () => {
  const runtime = fakeRuntime();
  const state = runtime.state();
  verifyEditorNativeSeedInitial(runtime.context.manifest, contract, state);
  const changed = clone(state);
  changed.tables.find(table => table.table === 't_srfpssystem').rows[0].modelver = hex('900');
  assert.throws(() => verifyEditorNativeSeedInitial(runtime.context.manifest, contract, changed));
  assert.throws(() => verifyEditorNativeSeedMutation(runtime.context.manifest, contract,
    runtime.context.manifest.roots[0], contract.datasets[0], {}, { pssysdbschemeid: '../escape' }, state, state));
});

test('explicit owned execution opt-in is required before opening a runtime context', async () => {
  await assert.rejects(executeOwnedEditorNativeSeeds({ runId, label: 'no-run',
    deploymentInput: 'unused' }), /execute-owned/);
});

test('guarded native adapter verifies source accounts, expiry and context before dispatch and refuses redirect/invalid JSON', async () => {
  const { manifest, credentials } = fixture();
  const accounts = sourceAccounts(manifest);
  const actor = manifest.users.find(user => user.role === 'editor');
  const now = Date.UTC(2026, 10, 11);
  const claims = { iat: Math.floor(now / 1000), exp: Math.floor(now / 1000) + 20 };
  const token = `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature`;
  let calls = 0;
  let guardFailure = false;
  let reply = new Response('', { status: 302, headers: { location: 'http://foreign' } });
  const context = { manifest, credentials, resources: { mysqlId: 'a'.repeat(64) },
    guard() {
      if (guardFailure) throw new Error('topology changed');
      return { origins: { backend: 'http://10.93.0.4:30086' } };
    } };
  const io = createOwnedEditorNativeSeedIO(context, contract, {
    now: () => now,
    execute(_command, _args, options) {
      assert.match(options.input, /FROM `nf_f01006abcdef_uaa`\.sys_person p/);
      return { status: 0, stdout: accounts.map(row => JSON.stringify(row)).join('\n') };
    },
    fetchImplementation: async (url, options) => {
      calls++;
      assert.equal(url, 'http://10.93.0.4:30086/appdata');
      assert.equal(options.redirect, 'manual');
      assert.equal(options.headers.authorization, `Bearer ${token}`);
      return reply;
    },
  });
  const spec = { path: '/appdata', actorId: actor.personId, token, sessionStartedAt: now,
    sessionExpiresAt: now + 20_000,
    applicationContext: { system: 'ibizmodeling', organization: `${actor.centerId}_org` } };
  await assert.rejects(io.request(spec), /source identity/);
  io.accounts();
  await assert.rejects(io.request({ ...spec, sessionStartedAt: now - 10_000 }), /aged/);
  await assert.rejects(io.request({ ...spec, sessionStartedAt: now + 1 }), /future/);
  await assert.rejects(io.request({ ...spec, applicationContext: { system: 'ibizmodeling', organization: 'foreign' } }));
  assert.equal(calls, 0);
  assert.equal((await io.request(spec)).error, 'redirect-refused');
  reply = new Response('<html>not-json</html>', { headers: { 'content-type': 'text/html' } });
  assert.equal((await io.request(spec)).error, 'transport-or-json-error');
  guardFailure = true;
  await assert.rejects(io.request(spec), /topology changed/);
  assert.equal(calls, 2);
});
