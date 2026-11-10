import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createFixture } from '../prepare-run-owned-native-nonadmin-fixture.mjs';
import {
  createAuthorizationVariantPlan, executeAuthorizationVariants, grantCompareAndSetSQL, grantSelectSQL,
} from '../owned-authorization-variants.mjs';
import {
  authorizationInventorySQL, authorizationModelSnapshotSQL, createOwnedAuthorizationIO,
  executeOwnedAuthorizationVariants, main, validateAuthorizationHTTP, validateAuthorizationInventory,
} from '../run-owned-authorization-variants.mjs';

const runId = '123456abcdef';
const { manifest, credentials } = createFixture({
  runId, scenario: 'two-center', modelVersion: 816, uaaSchemaMode: 'legacy-views',
  passwordStorageMode: 'sm3', secret: () => '1'.repeat(36),
});
const plan = createAuthorizationVariantPlan(manifest);
const copy = value => structuredClone(value);
const origins = { uaa: 'http://10.20.0.2:32666', backend: 'http://10.20.0.3:30086' };
const sourceNames = [
  'run-owned-authorization-variants.mjs', 'owned-authorization-variants.mjs',
  'owned-native-runtime-context.mjs', 'run-owned-native-permission-http.mjs',
  'prepare-run-owned-native-nonadmin-matrix.mjs',
];
const grant = target => ({
  ACCMODE: 3, ALLSYSFLAG: 0, CREATEDATE: null, CREATEMAN: null, DEFAULTFLAG: null,
  EXPIREDTIME: null, MEMO: null, PSDEVSLNID: target.schemeId, PSDEVSLNSYSDYNAINSTID: null,
  PSDEVSLNSYSID: target.rootId, PSDEVSLNTEMPLID: null, PSDEVSLNUSERID: target.grantId,
  PSDEVSLNUSERNAME: target.loginname, PSDEVUSEROBJID: target.personId,
  UPDATEDATE: null, UPDATEMAN: null,
});

function physicalRows() {
  return manifest.roots.flatMap(root => [
    { database: root.database, table: 't_srfpsmodule', row: {
      PSMODULEID: root.sentinelId, PSSYSTEMID: root.logicalSystemId,
      PSMODULENAME: root.sentinelName, MODTAG: root.sentinelTag, CREATEDATE: null,
    } },
    { database: root.database, table: 't_srfpssystem', row: {
      PSSYSTEMID: root.logicalSystemId, PSSYSTEMNAME: root.sentinelSystemName,
      PSDEVSLNSYSID: root.rootId, PSSYSMODELINSTID: root.modelInstanceId,
      PSDEVCENTERID: root.centerId, PSDEVSLNID: root.schemeId, MODELVER: 819,
    } },
  ]);
}

function inventoryRows() {
  const descriptions = [
    { database: manifest.schemas.metadata, table: 't_srfpsdevslnuser',
      key: 'PSDEVSLNUSERID', columns: Object.keys(grant(plan.cases[0].target)) },
    ...physicalRows().map(row => ({
      database: row.database, table: row.table,
      key: row.table === 't_srfpsmodule' ? 'PSMODULEID' : 'PSSYSTEMID',
      columns: Object.keys(row.row),
    })),
  ];
  return descriptions.flatMap(target => target.columns.map((column, index) => ({
    database: target.database, table: target.table, column, ordinal: index + 1,
    type: ['EXPIREDTIME', 'CREATEDATE', 'UPDATEDATE'].includes(column) ? 'datetime'
      : ['ACCMODE', 'ALLSYSFLAG', 'DEFAULTFLAG', 'MODELVER'].includes(column) ? 'int' : 'varchar',
    key: column === target.key ? 'PRI' : '',
  })));
}

function uaaIdentity(user) {
  return {
    id: user.personId, dc: user.centerId, organization_id: `${user.centerId}_org`,
    adminmode: 0, grants: [{
      system_id: 'ibizmodeling', deploy_system_id: `${user.centerId}_deploy`,
      roles: [{ authority: 'ROLE_NATIVE_FIXTURE', role_id: `${user.centerId}_ordinary_role` }],
    }],
  };
}

function fixture(options = {}) {
  const workspace = mkdtempSync(join(tmpdir(), 'live-owned-authorization-'));
  const base = join(workspace, '.artifacts', 'native-nonadmin-fixtures', runId);
  mkdirSync(base, { recursive: true });
  mkdirSync(join(workspace, 'scripts'));
  for (const name of sourceNames) writeFileSync(join(workspace, 'scripts', name), `// source fixture ${name}\n`);
  const context = {
    base, manifest: copy(manifest), credentials: copy(credentials), bindings: [],
    resources: { mysqlId: 'a'.repeat(64) }, witness: { owned: runId },
    guard() {
      guards++;
      if (drift) return { origins: { ...origins, backend: 'http://10.20.0.99:30086' } };
      return { origins: copy(origins) };
    },
  };
  const inventory = validateAuthorizationInventory(manifest, inventoryRows());
  const rows = physicalRows();
  const grants = new Map(plan.cases.map(item => [item.target.grantId, grant(item.target)]));
  const originals = copy([...grants]);
  const cases = new Map();
  for (const item of plan.cases) {
    const original = grant(item.target);
    const changed = { ...original, ACCMODE: item.variant.accessMode, EXPIREDTIME: item.variant.expiredTime };
    cases.set(grantCompareAndSetSQL(manifest, item.target, original, changed),
      { target: item.target, before: original, after: changed });
    cases.set(grantCompareAndSetSQL(manifest, item.target, changed, original),
      { target: item.target, before: changed, after: original });
  }
  const sqlCalls = [];
  const httpCalls = [];
  const tokens = new Map();
  const waits = [];
  let guards = 0;
  let drift = false;
  let serial = 0;
  let priorBackend;
  let duplicated = false;
  const execute = (command, args, config) => {
    assert.equal(command, 'docker');
    assert.deepEqual(args.slice(0, 5), ['exec', '-i', context.resources.mysqlId, 'sh', '-c']);
    assert.ok(args[5].includes('MYSQL_PWD="$MYSQL_ROOT_PASSWORD"'));
    assert.ok(!args[5].includes(credentials.users[plan.cases[0].target.loginname]));
    const sql = config.input;
    sqlCalls.push(sql);
    let values;
    if (sql === authorizationInventorySQL(manifest)) values = inventoryRows();
    else if (sql === authorizationModelSnapshotSQL(manifest, inventory)) values = copy(rows);
    else if (cases.has(sql)) {
      const mutation = cases.get(sql);
      assert.deepEqual(grants.get(mutation.target.grantId), mutation.before);
      grants.set(mutation.target.grantId, copy(mutation.after));
      return { status: 0, stdout: '1\n', stderr: '' };
    } else {
      const target = plan.cases.map(item => item.target)
        .find(target => sql === grantSelectSQL(manifest, target, inventory.grantColumns));
      assert.ok(target, `Unexpected SQL operation: ${sql}`);
      values = [copy(grants.get(target.grantId))];
    }
    return { status: 0, stdout: values.map(value => JSON.stringify(value)).join('\n') + '\n', stderr: '' };
  };
  const send = async (origin, spec, token) => {
    httpCalls.push({ origin, spec: copy(spec), token });
    const okay = data => ({ status: 200, error: null, data });
    if (spec.path === '/auths/login' || spec.path === '/v7/login') {
      const user = manifest.users.find(user => user.loginname === spec.data.loginname);
      let next = `e30.${Buffer.from(JSON.stringify({
        sub: user.loginname, serial: ++serial, exp: Math.floor(Date.now() / 1000) + 3600,
      })).toString('base64url')}.c2ln`;
      if (spec.path === '/v7/login') {
        if (options.duplicateOnce && priorBackend && !duplicated) { next = priorBackend; duplicated = true; }
        else priorBackend = next;
      }
      tokens.set(next, user);
      return okay({ token: next, user: uaaIdentity(user) });
    }
    const user = tokens.get(token);
    assert.ok(user);
    if (spec.path === '/auths/user-info/self') return okay(uaaIdentity(user));
    if (spec.path === '/uaa/oauth/userinfo') return okay({ sub: user.loginname });
    if (spec.path === '/appdata') return okay({ context: {
      srfsystemid: 'ibizmodeling', srforgid: `${user.centerId}_org`,
      srfuserid: user.personId, srfpersonid: user.personId, srfdcid: user.centerId,
    } });
    const root = manifest.roots.find(root => spec.path.includes(`/psdevslnsys/${root.rootId}/`));
    const row = grants.get(user.grantId);
    const readable = root.rootId === user.rootId && row.ACCMODE >= 0 && (row.ACCMODE & 1) === 1
      && row.EXPIREDTIME === null && (spec.method === 'GET' || spec.path.endsWith('/fetchcursys'));
    if (!readable) return { status: 403, error: null, data: { message: 'Denied' } };
    const value = {
      psmoduleid: root.sentinelId, pssystemid: root.logicalSystemId,
      psmodulename: root.sentinelName, pssystemname: root.sentinelSystemName,
    };
    return okay(spec.path.endsWith('/fetchcursys') ? [value] : value);
  };
  const output = join(base, 'authorization-http-test');
  const create = extra => createOwnedAuthorizationIO({
    context, workspace, output, execute, send, sleep: async ms => { waits.push(ms); },
    allowOwnedGrantMutations: true, ...extra,
  });
  return {
    workspace, base, output, context, inventory, grants, originals, sqlCalls, httpCalls, waits,
    guards: () => guards, drift: () => { drift = true; }, create,
    cleanup: () => rmSync(workspace, { recursive: true, force: true }),
  };
}

test('inventory SQL is read-only and bound to only the exact current-run metadata and model tables', () => {
  const sql = authorizationInventorySQL(manifest);
  assert.equal(sql.split('\n').filter(Boolean).length, 5);
  assert.ok(!/\b(?:UPDATE|DELETE|INSERT|DROP|CREATE|GRANT)\b/.test(sql));
  const inventory = validateAuthorizationInventory(manifest, inventoryRows());
  assert.equal(inventory.grantColumns.length, 16);
  const snapshots = authorizationModelSnapshotSQL(manifest, inventory);
  assert.equal(snapshots.split('\n').filter(Boolean).length, 4);
  assert.ok(snapshots.includes('ORDER BY `PSMODULEID`'));
  assert.ok(snapshots.includes('`CREATEDATE`'));
  assert.ok(snapshots.includes('ORDER BY `PSSYSTEMID`'));
});

test('inventory rejects foreign tables, duplicate/missing columns, wrong PK and non-temporal expiry', () => {
  for (const mutate of [
    rows => { rows[0].database = 'shared'; },
    rows => { rows[0].table = 't_srfpsdevuser'; },
    rows => { rows[0].column = 'DROP TABLE'; },
    rows => { rows[1].column = rows[0].column; },
    rows => { rows.splice(1, 1); },
    rows => { rows.find(row => row.column === 'PSDEVSLNUSERID').key = ''; },
    rows => { rows.find(row => row.column === 'EXPIREDTIME').type = 'varchar'; },
    rows => { rows[0].key = 'PRI'; },
  ]) {
    const changed = inventoryRows();
    mutate(changed);
    assert.throws(() => validateAuthorizationInventory(manifest, changed));
  }
});

test('adapter creation performs only guarded inventory SELECT and writes private exclusive bindings', () => {
  const state = fixture();
  let adapter;
  try {
    adapter = state.create();
    assert.equal(state.sqlCalls.length, 1);
    assert.equal(state.httpCalls.length, 0);
    assert.ok(state.sqlCalls[0].includes('INFORMATION_SCHEMA.COLUMNS'));
    assert.equal(statSync(join(state.output, 'adapter-inputs.private.json')).mode & 0o077, 0);
    assert.equal(statSync(state.output).mode & 0o077, 0);
    assert.throws(() => state.create());
    assert.throws(() => adapter.io.executeSQL('UPDATE shared.t_srfpsdevuser SET ADMINMODE=1'));
    assert.equal(state.sqlCalls.length, 1);
  } finally { adapter?.close(); state.cleanup(); }
});

test('live adapter and candidate runner execute all eight cases with guarded protocols and restore exact grants', async () => {
  const state = fixture();
  let adapter;
  try {
    adapter = state.create();
    const report = await executeAuthorizationVariants({
      manifest, plan: adapter.plan, io: adapter.io, credentials, allowOwnedGrantMutations: true,
    });
    assert.equal(report.status, 'passed-adapter-candidate-observations');
    assert.equal(report.checks.length, 200);
    assert.equal(state.httpCalls.length, 200);
    assert.deepEqual([...state.grants], state.originals);
    assert.equal(state.sqlCalls.filter(sql => sql.startsWith('UPDATE ')).length, 16);
    assert.ok(state.guards() > 2000);
    assert.ok(report.cleanup.every(row => row.status === 'restored-exact-original'));
    assert.equal(report.sameTokenCacheRevocationVerified, false);
    const receipt = adapter.writeReport({ report, nativeAcceptance: false });
    assert.equal(receipt.path, join(state.output, 'report.json'));
    assert.ok(readdirSync(state.output).some(name => name.includes('-http.private.json')));
    assert.ok(readdirSync(state.output).some(name => name.includes('pending-grant-update')));
    const publicData = readFileSync(receipt.path, 'utf8');
    assert.ok(!publicData.includes(credentials.users[plan.cases[0].target.loginname]));
    assert.ok(!publicData.includes('e30.'));
  } finally { adapter?.close(); state.cleanup(); }
});

test('duplicate normal backend login tokens wait for the issuer and retry without forging a token', async () => {
  const state = fixture({ duplicateOnce: true });
  let adapter;
  try {
    adapter = state.create();
    const report = await executeAuthorizationVariants({
      manifest, plan: adapter.plan, io: adapter.io, credentials, allowOwnedGrantMutations: true,
    });
    assert.equal(report.status, 'passed-adapter-candidate-observations');
    assert.deepEqual(state.waits, [1100]);
    assert.equal(state.httpCalls.length, 201);
    assert.deepEqual([...state.grants], state.originals);
  } finally { adapter?.close(); state.cleanup(); }
});

test('adapter executes only exact CAS SQL registered by a valid durable journal, at most once', async () => {
  const state = fixture();
  let adapter;
  try {
    adapter = state.create();
    const item = plan.cases[0];
    const original = grant(item.target);
    const intended = { ...original, ACCMODE: item.variant.accessMode, EXPIREDTIME: item.variant.expiredTime };
    const updateSQL = grantCompareAndSetSQL(manifest, item.target, original, intended);
    const restoreSQL = grantCompareAndSetSQL(manifest, item.target, intended, original);
    assert.throws(() => adapter.io.executeSQL(updateSQL));
    const entry = { caseId: item.id, target: item.target, original, intended, updateSQL, restoreSQL };
    assert.throws(() => adapter.io.persist('001-pending-grant-update.private.json',
      JSON.stringify({ ...entry, updateSQL: 'UPDATE mysql.user SET Super_priv=1' })));
    assert.throws(() => adapter.io.executeSQL(updateSQL));
    adapter.io.persist('001-pending-grant-update.private.json', JSON.stringify(entry));
    assert.equal(adapter.io.executeSQL(updateSQL), 1);
    assert.throws(() => adapter.io.executeSQL(updateSQL));
    assert.equal(adapter.io.executeSQL(restoreSQL), 1);
    assert.deepEqual([...state.grants], state.originals);
    assert.throws(() => adapter.io.persist('002-pending-grant-update.private.json', JSON.stringify(entry)));
  } finally { adapter?.close(); state.cleanup(); }
});

test('private journal path traversal, reused files and unrecognized restore originals fail closed', () => {
  const state = fixture();
  let adapter;
  try {
    adapter = state.create();
    assert.throws(() => adapter.io.persist('../escape.private.json', '{}'));
    adapter.io.persist('001-original-grant.private.json', '{}');
    assert.throws(() => adapter.io.persist('001-original-grant.private.json', '{}'));
    assert.throws(() => adapter.io.persist('002-pending-grant-restore.private.json', JSON.stringify({
      caseId: plan.cases[0].id, original: grant(plan.cases[0].target),
      current: grant(plan.cases[0].target), restoreSQL: 'unreviewed',
    })));
    assert.equal(state.sqlCalls.filter(sql => sql.startsWith('UPDATE ')).length, 0);
  } finally { adapter?.close(); state.cleanup(); }
});

test('source drift and endpoint drift stop every subsequent SQL/HTTP operation', async () => {
  for (const kind of ['source', 'origin']) {
    const state = fixture();
    let adapter;
    try {
      adapter = state.create();
      if (kind === 'source') writeFileSync(join(state.workspace, 'scripts', sourceNames[0]), '// changed\n');
      else state.drift();
      assert.throws(() => adapter.io.preflight());
      assert.throws(() => adapter.io.snapshotModels());
      await assert.rejects(adapter.io.request(origins.backend,
        { method: 'POST', path: '/v7/login', data: {
          loginname: plan.cases[0].target.loginname, password: credentials.users[plan.cases[0].target.loginname],
        } }));
      assert.equal(state.httpCalls.length, 0);
      assert.equal(state.sqlCalls.length, 1);
    } finally { adapter?.close(); state.cleanup(); }
  }
});

test('HTTP guard rejects unbound origins, arbitrary root headers, wrong actors and foreign IDs', () => {
  const user = manifest.users.find(user => user.loginname === plan.cases[0].target.loginname);
  const token = 'e30.e30.c2ln';
  const sessions = new Map([[token, { peer: 'backend', user }]]);
  const root = manifest.roots[0];
  const context = { system: 'ibizmodeling', organization: `${user.centerId}_org` };
  const spec = {
    method: 'GET', path: `/api/ibizmodeling__modeldesign/psdevslnsys/${root.rootId}/psmodules/${root.sentinelId}`,
    applicationContext: context,
  };
  assert.equal(validateAuthorizationHTTP(manifest, origins, origins.backend, spec, token, sessions, credentials).user, user);
  for (const changed of [
    { ...spec, headers: { PSDEVSLNSYS: root.rootId } },
    { ...spec, path: spec.path.replace(root.rootId, 'shared') },
    { ...spec, path: spec.path.replace(root.sentinelId, 'foreign') },
    { ...spec, applicationContext: { ...context, organization: 'shared_org' } },
    { ...spec, method: 'POST' },
  ]) assert.throws(() => validateAuthorizationHTTP(manifest, origins, origins.backend, changed, token, sessions, credentials));
  assert.throws(() => validateAuthorizationHTTP(manifest, origins, 'http://127.0.0.1:30086', spec, token, sessions, credentials));
  assert.throws(() => validateAuthorizationHTTP(manifest, origins, origins.backend, spec, 'e30.unknown.c2ln', sessions, credentials));
  const viewer = manifest.users.find(user => user.role === 'viewer');
  assert.throws(() => validateAuthorizationHTTP(manifest, origins, origins.backend, {
    method: 'POST', path: '/v7/login', data: { loginname: viewer.loginname, password: credentials.users[viewer.loginname] },
  }, undefined, sessions, credentials));
});

test('CLI requires both explicit opt-ins and rejects ambiguous/shared options before Docker access', async () => {
  for (const argv of [
    [], ['--execute-owned-authorization-variants'], ['--allow-owned-grant-mutations'],
    ['--service-url=http://127.0.0.1:30086'], ['--execute-owned-authorization-variants', '--execute-owned-authorization-variants'],
    ['--run-id=shared', '--run-id=shared'], ['--allow-owned-grant-mutations', '--allow-owned-grant-mutations'],
  ]) await assert.rejects(main(argv));
  await assert.rejects(executeOwnedAuthorizationVariants({ label: 'test', allowOwnedGrantMutations: true }));
  await assert.rejects(executeOwnedAuthorizationVariants({ label: 'test', executeOwnedAuthorizationVariants: true }));
  await assert.rejects(executeOwnedAuthorizationVariants({
    label: '../shared', executeOwnedAuthorizationVariants: true, allowOwnedGrantMutations: true,
  }));
});
