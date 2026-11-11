import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { PinnedDirectories } from '../native-candidate-files.mjs';
import { readNativeFiveDatasetContract } from '../native-five-dataset-contract.mjs';
import { createFixture } from '../prepare-run-owned-native-nonadmin-fixture.mjs';
import {
  editorDatasetRequest, editorPhysicalInventorySQL, editorPhysicalSnapshotSQL,
  executeOwnedEditorRegistryProbe, guardedEditorRuntime, main, normalizeEditorPhysicalSnapshot,
  ownedEditorRegistryRequest, runEditorRegistryChecks, validateEditorDatasetContract,
  validateEditorPhysicalInventory, validateEditorRegistryRequest, validateEditorSeedReceipt,
  verifyEditorBackendToken, verifyEditorCreateEvidence, verifyEditorDatasetResponse, verifyEditorSeedSnapshot,
  expectedNativeEditorSystemName,
} from '../probe-owned-editor-registry-http.mjs';

const digest = value => createHash('sha256').update(value).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const contract = readNativeFiveDatasetContract();
const { manifest, credentials } = createFixture({
  runId: 'abcdef012345', scenario: 'two-center', modelVersion: 816,
  uaaSchemaMode: 'legacy-views', passwordStorageMode: 'sm3', secret: () => 'a'.repeat(36),
});
const bindings = {
  deploymentInput: { path: '/owned/backend-runtime-unit/deployment-input.private.json', sha256: 'a'.repeat(64) },
  sourceImages: { path: '/owned/images/report.json', sha256: 'b'.repeat(64) },
};
const receipt = {
  contract: 'owned-editor-registry-native-seed-v1', runId: manifest.runId, status: 'passed-native-create-seeds',
  sourceContractSha256: digest(json(contract)), ...bindings,
  records: manifest.roots.flatMap(root => contract.datasets.map((dataset, index) => ({
    entity: dataset.entity, rootId: root.rootId, database: root.database, logicalSystemId: root.logicalSystemId,
    key: `${manifest.runId}_${root.side}_${index}`, name: `Native ${manifest.runId} ${root.side} ${dataset.entity}`,
    userTag: `seed_${manifest.runId}_${root.side}_${index}`,
    systemName: expectedNativeEditorSystemName(root, dataset),
    createEvidence: { path: `/owned/${root.side}-${index}.private.json`, sha256: 'c'.repeat(64) },
  }))),
};
const seedFor = (dataset, root) => receipt.records.find(row => row.entity === dataset.entity && row.rootId === root.rootId);
const rowFor = (dataset, root) => {
  const seed = seedFor(dataset, root);
  return { [dataset.keyField]: seed.key, [dataset.nameField]: seed.name,
    pssystemid: seed.logicalSystemId, pssystemname: seed.systemName, usertag: seed.userTag };
};
const okay = data => ({ status: 200, error: null, data });
const hex = value => value === null ? null : Buffer.from(String(value)).toString('hex').toUpperCase();

function physicalFixture() {
  const columns = new Map();
  const add = (table, field) => {
    if (!columns.has(table)) columns.set(table, new Set());
    columns.get(table).add(field.toLowerCase());
  };
  add('t_srfpssystem', 'pssystemid'); add('t_srfpssystem', 'pssystemname'); add('t_srfpssystem', 'modelver');
  for (const dataset of contract.datasets) {
    for (const field of dataset.sourceSchema.columns) add(dataset.table, field);
    const aliases = new Map(dataset.joins.map(row => [row.alias, row.table]));
    for (const relation of dataset.joins) {
      add(relation.table, 'id');
      if (relation.on) {
        add(aliases.get(relation.on.leftAlias), relation.on.leftField);
        add(aliases.get(relation.on.rightAlias), relation.on.rightField);
      }
    }
    for (const expression of [dataset.predicate, ...dataset.returnProjection.map(row => row.expression)]) {
      for (const match of expression.matchAll(/\b(t[0-9]+)\.`([A-Z][A-Z0-9_]*)`/g)) add(aliases.get(match[1]), match[2]);
    }
  }
  for (let index = columns.size; index < contract.schemaTables.mergedPhysicalTables; index++) {
    add(`t_owned_empty_${String(index).padStart(3, '0')}`, 'id');
  }
  const inventory = manifest.roots.flatMap(root => [...columns].sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([table, fields]) => [...fields].sort().map((field, index) => ({
      database: root.database, table, column: root.side === 'a' ? field : field.toUpperCase(),
      type: 'varchar', columnType: 'varchar(2000)', ordinal: index + 1,
      key: field === (contract.datasets.find(row => row.table === table)?.keyField ?? 'id') ? 'PRI' : '',
      nullable: 'YES', default: null, extra: '', charset: 'utf8mb4', collation: 'utf8mb4_general_ci',
    }))));
  const targets = validateEditorPhysicalInventory(manifest, contract, inventory);
  const rows = manifest.roots.flatMap(root => {
    const row = (table, values) => {
      const target = targets.find(target => target.database === root.database && target.table === table);
      return { database: root.database, table, row: Object.fromEntries(target.columns.map(column =>
        [column.column, hex(values[column.column.toLowerCase()] ?? null)])) };
    };
    return [
      row('t_srfpssystem', { pssystemid: root.logicalSystemId, pssystemname: root.sentinelSystemName, modelver: 826 }),
      ...contract.datasets.map(dataset => row(dataset.table, rowFor(dataset, root))),
    ];
  });
  return { inventory, targets, rows, snapshot: normalizeEditorPhysicalSnapshot(inventory, targets, rows) };
}
const physical = physicalFixture();
const user = manifest.users[0];
const root = manifest.roots[0];
const dataset = contract.datasets[0];
const applicationContext = { system: 'ibizmodeling', organization: `${user.centerId}_org` };
const jwt = (now, serial = 1) => `e30.${Buffer.from(JSON.stringify({ iat: Math.floor(now / 1000),
  exp: Math.floor(now / 1000) + 20, serial })).toString('base64url')}.c2ln`;

test('five native datasets use the source-published POST and exact root/body/context, never an invented GET alias', () => {
  assert.equal(validateEditorDatasetContract(contract), true);
  const spec = editorDatasetRequest(manifest, contract, dataset.entity, root.rootId, jwt(Date.now()), applicationContext);
  assert.equal(spec.method, 'POST');
  assert.equal(spec.path, dataset.fetchPath.replace('$ROOT_ID', root.rootId));
  assert.deepEqual(spec.data, { pssystemid: root.logicalSystemId, page: 0, size: 1000 });
  assert.equal(validateEditorRegistryRequest(manifest, contract, spec), true);
  for (const mutate of [
    s => { s.method = 'GET'; }, s => { s.method = 'DELETE'; }, s => { s.path += '?trymode=true'; },
    s => { s.path = s.path.replace(root.rootId, 'shared'); }, s => { s.peer = 'uaa'; },
    s => { s.data.page = 1; }, s => { s.data.pssystemid = 'foreign'; },
    s => { s.applicationContext.root = root.rootId; }, s => { s.applicationContext.system = 'other'; },
    s => { s.applicationContext.organization = 'other'; }, s => { s.headers = { appcontext: '{}' }; },
    s => { delete s.applicationContext; }, s => { delete s.token; },
  ]) {
    const changed = structuredClone(spec); mutate(changed);
    assert.throws(() => validateEditorRegistryRequest(manifest, contract, changed));
  }
  const wrongMethod = structuredClone(contract);
  wrongMethod.datasets[0].methods.FetchCurSys.method = 'GET';
  assert.throws(() => validateEditorDatasetContract(wrongMethod));
});

test('native seed receipt requires ten complete source/deployment/image-bound records and distinct physical sentinels', () => {
  assert.equal(validateEditorSeedReceipt(manifest, contract, receipt, bindings), true);
  for (const mutate of [
    r => { r.records.pop(); }, r => { r.status = 'sql-seeded'; }, r => { r.runId = '012345abcdef'; },
    r => { r.sourceContractSha256 = '0'.repeat(64); }, r => { r.sourceImages.sha256 = '0'.repeat(64); },
    r => { r.deploymentInput.path = '/shared'; }, r => { r.records[0].database = manifest.roots[1].database; },
    r => { r.records[0].logicalSystemId = 'foreign'; }, r => { r.records[0].systemName = manifest.roots[1].rootId; },
    r => { r.records[0].userTag = ''; }, r => { r.records[0].name = 'not-owned'; },
    r => { r.records[0].key = r.records[1].key; }, r => { r.records[0].userTag = r.records[1].userTag; },
    r => { r.records[0].entity = r.records[1].entity; }, r => { r.records[0].createEvidence.sha256 = 'invalid'; },
  ]) {
    const changed = structuredClone(receipt); mutate(changed);
    assert.throws(() => validateEditorSeedReceipt(manifest, contract, changed, bindings));
  }
});

function partialReceipt() {
  return {
    ...structuredClone(receipt), status: 'partial-native-create-seeds-app-config-blocked',
    records: receipt.records.filter(record => record.entity !== 'PSSysApp'),
    fullInitializationAcceptance: false,
    blocked: manifest.roots.map(root => ({ entity: 'PSSysApp', rootId: root.rootId })),
  };
}

test('partial coverage requires explicit opt-in, exact App-blocked status and exactly eight complete non-App records', () => {
  const partial = partialReceipt();
  assert.throws(() => validateEditorSeedReceipt(manifest, contract, partial, bindings));
  assert.equal(validateEditorSeedReceipt(manifest, contract, partial, bindings, { allowPartial: true }), true);
  for (const mutate of [
    changed => { changed.status = 'passed-native-create-seeds'; },
    changed => { changed.records.push(receipt.records.find(record => record.entity === 'PSSysApp')); },
    changed => { changed.records[0] = receipt.records.find(record => record.entity === 'PSSysApp'); },
    changed => { changed.records[0] = changed.records[1]; },
    changed => { changed.blocked.pop(); },
    changed => { changed.fullInitializationAcceptance = true; },
  ]) {
    const changed = structuredClone(partial);
    mutate(changed);
    assert.throws(() => validateEditorSeedReceipt(manifest, contract, changed, bindings, { allowPartial: true }));
  }
  const full = structuredClone(receipt);
  assert.equal(validateEditorSeedReceipt(manifest, contract, full, bindings, { allowPartial: true }), true);
  full.records.find(record => record.entity === 'PSSysApp').systemName = 'wrong';
  assert.throws(() => validateEditorSeedReceipt(manifest, contract, full, bindings, { allowPartial: true }));
});

test('native CREATE evidence binds exact POST collection, real response and either explicit or returned native key', () => {
  const record = seedFor(dataset, root);
  const evidence = {
    method: 'POST', path: dataset.collectionPath.replace('$ROOT_ID', root.rootId),
    status: 200, error: null, request: rowFor(dataset, root), response: rowFor(dataset, root),
  };
  assert.equal(verifyEditorCreateEvidence(manifest, contract, record, evidence), true);
  delete evidence.request[dataset.keyField];
  assert.equal(verifyEditorCreateEvidence(manifest, contract, record, evidence), true);
  for (const mutate of [
    e => { e.method = 'SQL'; }, e => { e.status = 201; }, e => { e.error = 'failed'; },
    e => { e.path += '/fetchcursys'; }, e => { e.response = []; },
    e => { e.response.usertag = 'foreign'; }, e => { e.request[dataset.keyField] = 'wrong'; },
    e => { e.response[dataset.nameField] = 'wrong'; },
  ]) {
    const changed = structuredClone(evidence); mutate(changed);
    assert.throws(() => verifyEditorCreateEvidence(manifest, contract, record, changed));
  }
});

test('physical inventory includes all tables/columns, lower/upper case without collisions and every native query dependency', () => {
  assert.equal(physical.targets.length, 848);
  const sql = editorPhysicalInventorySQL(manifest) + editorPhysicalSnapshotSQL(physical.targets);
  assert.ok(sql.includes("t.TABLE_TYPE='BASE TABLE'"));
  assert.ok(sql.includes('HEX(CAST('));
  assert.ok(!/\b(?:INSERT|UPDATE|DELETE|DROP|CREATE|GRANT|REPLACE|ALTER|TRUNCATE)\b/.test(sql));
  assert.equal(physical.snapshot.tables.length, 848);
  assert.ok(physical.snapshot.tables.some(table => table.rows.length === 0), 'Empty tables remain in the full inventory');
  assert.equal(verifyEditorSeedSnapshot(manifest, contract, receipt, physical.snapshot), true);
  for (const mutate of [
    rows => { rows.splice(0, 1); },
    rows => { rows[0].database = 'shared'; },
    rows => { rows[0].column = 'bad`;DROP'; },
    rows => {
      const first = rows.find(row => row.table === dataset.table);
      const second = rows.find(row => row.table === dataset.table && row.ordinal === 2);
      second.column = first.column.toUpperCase();
    },
    rows => { rows[0].ordinal = 3; },
    rows => { rows[0].nullable = 'unknown'; },
    rows => {
      const target = rows.find(row => row.table === dataset.table && row.column.toLowerCase() === dataset.keyField);
      target.key = '';
    },
  ]) {
    const changed = structuredClone(physical.inventory); mutate(changed);
    assert.throws(() => validateEditorPhysicalInventory(manifest, contract, changed));
  }
  const partial = structuredClone(physical.rows);
  delete partial[0].row[Object.keys(partial[0].row)[0]];
  assert.throws(() => normalizeEditorPhysicalSnapshot(physical.inventory, physical.targets, partial));
  const invalid = structuredClone(physical.rows);
  invalid[0].row[Object.keys(invalid[0].row)[0]] = 'partial-text';
  assert.throws(() => normalizeEditorPhysicalSnapshot(physical.inventory, physical.targets, invalid));
  const changed = structuredClone(physical.snapshot);
  const target = changed.tables.find(table => table.database === root.database && table.table === dataset.table);
  target.rows[0].usertag = hex('wrong');
  assert.throws(() => verifyEditorSeedSnapshot(manifest, contract, receipt, changed));
});

test('allowed reads require exact nonempty native sentinel and deny responses require exact 403 without leakage', () => {
  const response = okay([rowFor(dataset, root)]);
  assert.deepEqual(verifyEditorDatasetResponse(response, user, root, dataset, receipt, physical.snapshot, physical.snapshot),
    { expectedStatus: 200, returnedSentinels: 1 });
  for (const mutate of [
    r => { r.data = []; }, r => { r.status = 403; }, r => { r.error = 'transport-or-json-error'; },
    r => { r.data = [rowFor(dataset, manifest.roots[1])]; }, r => { r.data[0].usertag = 'wrong'; },
    r => { r.data[0].pssystemname = manifest.roots[1].sentinelSystemName; },
    r => { r.data[0].pssystemid = 'foreign'; }, r => { r.data.push(r.data[0]); },
    r => { r.data[0].extra = receipt.records.at(-1).userTag; },
  ]) {
    const changed = structuredClone(response); mutate(changed);
    assert.throws(() => verifyEditorDatasetResponse(changed, user, root, dataset, receipt, physical.snapshot, physical.snapshot));
  }
  const noAccess = manifest.users.find(user => user.role === 'no-access');
  for (const status of [null, 200, 401, 404, 429, 500]) {
    assert.throws(() => verifyEditorDatasetResponse({ status, error: null, data: null },
      noAccess, root, dataset, receipt, physical.snapshot, physical.snapshot));
  }
  assert.equal(verifyEditorDatasetResponse({ status: 403, error: null, data: { message: 'Denied' } },
    noAccess, root, dataset, receipt, physical.snapshot, physical.snapshot).expectedStatus, 403);
  assert.throws(() => verifyEditorDatasetResponse({ status: 403, error: null, data: { message: receipt.records[0].name } },
    noAccess, root, dataset, receipt, physical.snapshot, physical.snapshot));
  assert.throws(() => verifyEditorDatasetResponse(response, user, root, dataset, receipt, physical.snapshot,
    { ...physical.snapshot, encoding: 'partial' }));
});

test('real transport receives guard origins and emits only native scoped headers; bad routes never fetch', async () => {
  const live = { origins: { backend: 'http://10.92.0.9:30086', uaa: 'http://10.92.0.4:32666' } };
  const context = { manifest, guard: () => live };
  assert.equal(guardedEditorRuntime(context, [], null), live);
  const spec = editorDatasetRequest(manifest, contract, dataset.entity, root.rootId, jwt(Date.now()), applicationContext);
  let fetched = 0;
  const fetchImplementation = async (url, options) => {
    fetched++;
    assert.equal(url, live.origins.backend + spec.path);
    assert.equal(options.method, 'POST');
    assert.deepEqual(Object.keys(options.headers).sort(),
      ['accept', 'authorization', 'content-type', 'srforgid', 'srfsystemid']);
    assert.equal(options.headers.authorization, `Bearer ${spec.token}`);
    assert.equal(options.redirect, 'manual');
    assert.deepEqual(JSON.parse(options.body), spec.data);
    return Response.json([rowFor(dataset, root)]);
  };
  const result = await ownedEditorRegistryRequest(context, contract, spec, { fetchImplementation });
  assert.equal(result.status, 200); assert.equal(result.error, null); assert.equal(fetched, 1);
  await assert.rejects(ownedEditorRegistryRequest(context, contract, { ...spec, path: '/shared' }, { fetchImplementation }));
  assert.equal(fetched, 1);
  for (const response of [
    new Response(null, { status: 302, headers: { location: 'http://foreign' } }),
    new Response('html', { status: 200, headers: { 'content-type': 'text/html' } }),
    new Response('{invalid', { status: 200, headers: { 'content-type': 'application/json' } }),
    new Response('x'.repeat(2 * 1024 * 1024 + 1), { headers: { 'content-type': 'application/json' } }),
  ]) {
    const failed = await ownedEditorRegistryRequest(context, contract, spec, { fetchImplementation: async () => response });
    assert.notEqual(failed.error, null);
  }
});

function httpFixture({ empty = false, badDeniedStatus, mutation = false, expiry = false } = {}) {
  let clock = 1_800_000_000_000;
  let serial = 0;
  let snapshots = 0;
  let datasetRequests = 0;
  const sessions = new Map();
  const requests = [];
  const context = { manifest, credentials, guard: () => ({ origins: {} }) };
  const identity = user => ({
    id: user.personId, dc: user.centerId, organization_id: `${user.centerId}_org`, adminmode: 0,
    grants: [{ system_id: 'ibizmodeling', deploy_system_id: `${user.centerId}_deploy`,
      roles: [{ authority: 'ROLE_NATIVE_FIXTURE', role_id: `${user.centerId}_ordinary_role` }] }],
  });
  const send = async (_context, receivedContract, spec) => {
    assert.equal(receivedContract, contract);
    validateEditorRegistryRequest(manifest, contract, spec);
    requests.push(spec);
    if (spec.path.endsWith('/login')) {
      const user = manifest.users.find(user => user.loginname === spec.data.loginname);
      assert.equal(spec.data.password, credentials.users[user.loginname]);
      const token = jwt(clock, ++serial); sessions.set(token, user);
      return okay({ token, user: identity(user) });
    }
    const user = sessions.get(spec.token);
    assert.ok(user);
    if (spec.path === '/auths/user-info/self') return okay(identity(user));
    if (spec.path === '/uaa/oauth/userinfo') return okay({ sub: user.loginname });
    if (spec.path === '/appdata') return okay({ context: {
      srfsystemid: 'ibizmodeling', srforgid: `${user.centerId}_org`,
      srfuserid: user.personId, srfpersonid: user.personId, srfdcid: user.centerId,
    } });
    const root = manifest.roots.find(root => spec.path.includes(`/${root.rootId}/`));
    const dataset = contract.datasets.find(dataset => spec.path === dataset.fetchPath.replace('$ROOT_ID', root.rootId));
    assert.ok(JSON.parse(Buffer.from(spec.token.split('.')[1], 'base64url')).exp * 1000 > clock);
    datasetRequests++;
    if (expiry) clock += 16_000;
    if (user.rootId !== root.rootId || user.role === 'no-access') {
      return { status: badDeniedStatus ?? 403, error: null, data: { message: 'Denied' } };
    }
    return okay(empty ? [] : [rowFor(dataset, root)]);
  };
  const snapshot = async () => {
    snapshots++;
    const result = structuredClone(physical.snapshot);
    if (mutation && datasetRequests) result.tables[0].rows.push({ id: hex('unexpected-write') });
    return result;
  };
  return { context, send, snapshot, requests, now: () => clock, snapshots: () => snapshots };
}

test('six ordinary actors perform 60 exact source-native observations, 20 allowed and 40 denied, with every physical snapshot unchanged', async () => {
  const fixture = httpFixture();
  const report = await runEditorRegistryChecks({ ...fixture, contract, receipt });
  assert.equal(report.status, 'passed-bounded-editor-dataset-reads');
  assert.equal(report.checks.length, 60);
  assert.equal(report.checks.filter(row => row.httpStatus === 200).length, 20);
  assert.equal(report.checks.filter(row => row.httpStatus === 403).length, 40);
  assert.equal(report.authentication.length, 30);
  assert.equal(report.actors.length, 6);
  assert.ok(report.checks.every(row => row.method === 'POST' && row.status === 'passed' && row.physicalColumnsUnchanged));
  assert.equal(fixture.snapshots(), 122);
  assert.equal(report.boundedEditorDatasetReadAcceptance, true);
  assert.equal(report.nativeAcceptance, false); assert.equal(report.permissionAcceptance, false);
  assert.ok(!JSON.stringify(report).includes(credentials.users[user.loginname]));
  assert.ok(!JSON.stringify(report).includes('e30.'));
});

test('48 partial observations keep every full five-entity acceptance flag false', async () => {
  const report = await runEditorRegistryChecks({
    ...httpFixture(), contract, receipt: partialReceipt(), allowPartial: true,
  });
  assert.equal(report.status, 'passed-bounded-editor-dataset-reads-app-partial');
  assert.equal(report.checks.length, 48);
  assert.equal(report.expectedCheckCount, 48);
  assert.equal(report.checks.filter(row => row.httpStatus === 200).length, 16);
  assert.equal(report.checks.filter(row => row.httpStatus === 403).length, 32);
  assert.equal(report.boundedPartialEditorDatasetReadAcceptance, true);
  assert.equal(report.boundedEditorDatasetReadAcceptance, false);
  assert.equal(report.allFiveEditorDatasetReadAcceptance, false);
  assert.deepEqual(report.blockedEntities, ['PSSysApp']);
  assert.ok(!report.testedEntities.includes('PSSysApp'));
  const full = await runEditorRegistryChecks({ ...httpFixture(), contract, receipt, allowPartial: true });
  assert.equal(full.status, 'passed-bounded-editor-dataset-reads');
  assert.equal(full.checks.length, 60);
  assert.equal(full.allFiveEditorDatasetReadAcceptance, true);
  assert.equal(full.boundedPartialEditorDatasetReadAcceptance, false);
});

test('unmodified twenty-second tokens renew only by normal UAA/backend login and verified native bootstrap', async () => {
  const fixture = httpFixture({ expiry: true });
  const report = await runEditorRegistryChecks({ ...fixture, contract, receipt });
  assert.equal(report.status, 'passed-bounded-editor-dataset-reads');
  assert.ok(report.actors.every(actor => actor.normalLoginRenewals === 9));
  assert.equal(report.authentication.length, 300);
  const loginRequests = fixture.requests.filter(request => request.path.endsWith('/login'));
  assert.equal(loginRequests.length, 120);
  assert.ok(fixture.requests.every(request => !request.path.includes('refresh_token')));
  for (const request of fixture.requests.filter(request => request.token)) {
    const claims = JSON.parse(Buffer.from(request.token.split('.')[1], 'base64url'));
    assert.equal(claims.exp - claims.iat, 20);
  }
  const clock = 1_800_000_000_000;
  assert.equal(verifyEditorBackendToken(jwt(clock), clock), true);
  assert.throws(() => verifyEditorBackendToken(jwt(clock), clock + 16_000));
  const long = `e30.${Buffer.from(JSON.stringify({ iat: clock / 1000, exp: clock / 1000 + 3600 })).toString('base64url')}.c2ln`;
  assert.throws(() => verifyEditorBackendToken(long, clock));
});

test('empty 200s, non-403 denials and physical writes stop the matrix with no acceptance', async () => {
  for (const options of [{ empty: true }, { badDeniedStatus: 401 }, { badDeniedStatus: 404 },
    { badDeniedStatus: 500 }, { mutation: true }]) {
    const report = await runEditorRegistryChecks({ ...httpFixture(options), contract, receipt });
    assert.equal(report.status, 'failed-editor-dataset-reads');
    assert.equal(report.boundedEditorDatasetReadAcceptance, false);
    assert.ok(report.checks.some(row => row.status === 'failed'));
  }
});

test('pinned evidence detects in-place source drift and preserves exclusive private artifacts', () => {
  const root = mkdtempSync(join(tmpdir(), 'owned-editor-guard-'));
  const directories = new PinnedDirectories();
  try {
    const directory = directories.open(root);
    directories.write(directory, 'source.json', 'original');
    const binding = { parent: directory, name: 'source.json', sha256: digest('original'), privateInput: true };
    const live = { origins: { backend: 'http://10.0.0.1' } };
    assert.equal(guardedEditorRuntime({ guard: () => live }, [binding], directories), live);
    assert.throws(() => directories.write(directory, 'source.json', 'overwrite'));
    assert.equal(readFileSync(join(root, 'source.json'), 'utf8'), 'original');
    assert.throws(() => guardedEditorRuntime({ guard: () => live }, [{ ...binding, sha256: '0'.repeat(64) }], directories));
    writeFileSync(join(root, 'source.json'), 'changed-in-place');
    assert.throws(() => guardedEditorRuntime({ guard: () => live }, [binding], directories));
  } finally { directories.close(); rmSync(root, { recursive: true, force: true }); }
});

test('execution and CLI require explicit owner-only seed hash and reject shared URLs and duplicate flags before Docker', async () => {
  await assert.rejects(executeOwnedEditorRegistryProbe({ runId: manifest.runId, label: 'unit' }));
  await assert.rejects(executeOwnedEditorRegistryProbe({
    execute: true, runId: manifest.runId, label: 'unit', seedReceipt: '/shared/receipt.private.json', seedReceiptSha256: 'a'.repeat(64),
  }));
  for (const args of [[], ['--url=http://127.0.0.1:30250'], ['--execute-owned-editor-registry', '--execute-owned-editor-registry'],
    [`--run-id=${manifest.runId}`, `--run-id=${manifest.runId}`], ['--seed-receipt-sha256=invalid']]) {
    await assert.rejects(main(args));
  }
});
