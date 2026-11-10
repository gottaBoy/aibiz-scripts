import assert from 'node:assert/strict';
import fs from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  createInternalMessageIO, executeOwnedInternalMessage, internalMessageActors,
  runOwnedInternalMessage, validateInternalMessageRequest,
  verifyInternalMessageAccounts, verifyInternalMessageAppData,
} from '../harness-owned-internal-message.mjs';

const runId = 'f01006abcdef';
const collection = '/extension/internal_messages';
const columns = ['ID', 'SENDER', 'RECEIVER', 'SYSTEM_TAG', 'OWNER_TYPE', 'OWNER_ID', 'CONTENT',
  'STATUS', 'TITLE', 'SHORT_CONTENT', 'CONTENT_TYPE', 'CREATE_TIME', 'CREATE_MAN',
  'UPDATE_TIME', 'UPDATE_MAN', 'UNEXPECTED_NATIVE_COLUMN'];
const clone = value => structuredClone(value);
const uuid = serial => `12345678-1234-4321-8888-${String(serial).padStart(12, '0')}`;

function fixture() {
  const users = ['a', 'b'].flatMap(side => [
    ['e', 'editor'], ['v', 'viewer'], ['n', 'no-access'],
  ].map(([suffix, role]) => ({
    personId: `nf_${runId}_person_${side}_${suffix}`, loginname: `nf_${runId}_${side}_${suffix}`,
    centerId: `nf_${runId}_center_${side}`, role, administrator: false,
  })));
  const manifest = { runId, users, schemas: { uaa: `nf_${runId}_uaa`, metadata: `nf_${runId}_meta` } };
  const source = users.map(user => ({
    id: user.personId, loginname: user.loginname, tenant: user.centerId,
    organization: `${user.centerId}_source_org`, organizationTenant: user.centerId,
    memberTenant: user.centerId, memberOrganization: `${user.centerId}_source_org`,
    roleTenant: user.centerId, roleId: `${user.centerId}_ordinary_role`,
    deploymentTenant: user.centerId, system: 'ibizmodeling', authority: 'ROLE_NATIVE_FIXTURE',
    personEnabled: 1, personStatus: '1', domainEnabled: 1, organizationEnabled: 1,
    roleEnabled: 1, deploymentEnabled: 1, deploymentDeleted: 0,
    developerTenant: user.centerId, developerAdminMode: 0,
    developerEnabled: 1, developerObjectEnabled: 1, developerValid: 1,
  }));
  return { manifest, source, credentials: {
    users: Object.fromEntries(users.map(user => [user.loginname, `private-password-${user.loginname}`])),
  } };
}

function fakeRuntime(options = {}) {
  const { manifest, source, credentials } = fixture();
  let clock = Date.UTC(2026, 10, 9);
  let guardSerial = 0;
  let lastIoGuard = -1;
  let uuidSerial = 0;
  let failInjected = false;
  let writes = 0;
  const records = [];
  const requests = [];
  const rows = new Map();
  if (options.existing) rows.set(uuid(99), { ID: uuid(99), CONTENT: 'preexisting-unowned' });
  const context = {
    manifest, resources: { mysqlId: 'a'.repeat(64) }, credentials, bindings: [], witness: {},
    guard() {
      if (options.guardFailure && rows.size) throw new Error('injected retained topology drift');
      guardSerial++;
      clock += options.guardTick ?? 0;
      return { origins: { backend: 'http://10.91.0.9:30086' } };
    },
  };
  const guarded = () => {
    assert.ok(guardSerial > lastIoGuard, 'Each fake HTTP/SQL operation must have a fresh guard');
    lastIoGuard = guardSerial;
  };
  const dto = row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key.toLowerCase(), value]));
  const response = (status, data, headers = {}) => ({
    status, data, headers, error: null, bytes: 1, responseSha256: 'b'.repeat(64), dispatched: true,
  });
  const expectJournal = (actor, operation) => {
    const entry = records.at(-1);
    assert.equal(entry.kind, 'journal', 'A private journal must be completed before every write');
    assert.equal(entry.value.actor, actor.personId);
    if (operation) assert.equal(entry.value.operation, operation);
    writes++;
  };
  const io = {
    sourceAccounts() { guarded(); return clone(source); },
    snapshot() {
      guarded();
      clock += options.snapshotTick ?? 0;
      return { columns: clone(columns), rows: [...rows.values()].toSorted((a, b) => a.ID.localeCompare(b.ID)).map(clone) };
    },
    async request(spec) {
      guarded();
      validateInternalMessageRequest(spec);
      requests.push(clone(spec));
      const tick = options.requestTick ?? 0;
      if (spec.path === '/v7/login') {
        const actor = manifest.users.find(user => user.loginname === spec.data?.loginname);
        assert.ok(actor);
        expectJournal(actor);
        assert.equal(records.at(-1).value.kind, 'normal-backend-login');
        assert.equal(spec.data.password, credentials.users[actor.loginname]);
        const claims = { sub: actor.loginname, exp: Math.floor((clock + 20_000) / 1000) };
        clock += tick;
        return response(200, { token: `header.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.signature` });
      }
      assert.ok(clock - spec.sessionStartedAt < 10_000, 'Fake dispatch must use a session younger than ten seconds');
      assert.ok(spec.sessionExpiresAt - clock > 5_000);
      const claims = JSON.parse(Buffer.from(spec.token.split('.')[1], 'base64url').toString('utf8'));
      const actor = manifest.users.find(user => user.loginname === claims.sub);
      const actual = source.find(row => row.id === actor.personId);
      assert.deepEqual(spec.applicationContext, { system: actual.system, organization: actual.organization });
      clock += tick;
      if (spec.path === '/appdata') return response(200, { context: {
        srfsystemid: actual.system, srfdcsystemid: options.wrongSystem ? `${actor.centerId}_deploy` : actual.system,
        srforgid: actual.organization, srfuserid: actual.id, srfpersonid: actual.id, srfdcid: actual.tenant,
      } });
      if (spec.path === collection) {
        expectJournal(actor, 'CREATE');
        const row = Object.fromEntries(columns.map(column => [column, null]));
        Object.assign(row, Object.fromEntries(Object.entries(spec.data).map(([key, value]) => [key.toUpperCase(), value])));
        Object.assign(row, { CREATE_TIME: '2026-11-09 00:00:00', UPDATE_TIME: '2026-11-09 00:00:00',
          CREATE_MAN: actor.personId, UPDATE_MAN: actor.personId, UNEXPECTED_NATIVE_COLUMN: 'native-extra' });
        assert.ok(!rows.has(row.ID));
        rows.set(row.ID, row);
        if (options.createTimeout && !failInjected) {
          failInjected = true;
          return { ...response(null, null), error: 'timeout' };
        }
        return response(200, dto(row));
      }
      if (spec.path === `${collection}/fetch_cur_receiver`) {
        const matches = [...rows.values()].filter(row => row.RECEIVER === actor.personId
          && row.SYSTEM_TAG === actual.system && (!spec.data.n_status_eq || row.STATUS === spec.data.n_status_eq));
        const body = matches.map(dto);
        return response(200, options.syntheticPage ? { content: body } : body,
          { 'x-total': String(matches.length), 'x-page': '0', 'x-per-page': '20' });
      }
      if (spec.path === `${collection}/mark_all_read`) {
        expectJournal(actor, 'MARK_ALL_READ');
        if (options.bodylessMarkAll && spec.data === undefined) return response(200, null);
        assert.deepEqual(spec.data, {}, 'The real native client sends an empty JSON object, not a zero-byte body');
        for (const row of rows.values()) {
          if (row.STATUS === 'RECEIVED' && (options.broadMarkAll || row.RECEIVER === actor.personId)) row.STATUS = 'READ';
        }
        return response(200, null);
      }
      const [id, action] = spec.path.slice(collection.length + 1).split('/');
      const row = rows.get(id);
      const operation = action ? 'MARK_READ' : { GET: 'GET', PUT: 'UPDATE', DELETE: 'REMOVE' }[spec.method ?? 'GET'];
      if (operation !== 'GET') expectJournal(actor, operation);
      if (!row) return response(404, { message: 'absent' });
      const foreign = row.RECEIVER !== actor.personId;
      if (foreign) {
        if (!failInjected && options.negativeMutation) {
          failInjected = true;
          row[options.negativeMutation === 'ownership' ? 'SENDER' : 'UNEXPECTED_NATIVE_COLUMN'] = 'foreign-write';
        }
        if (options.oldAllowAll) {
          if (operation === 'UPDATE') row.TITLE = spec.data.title;
          if (operation === 'MARK_READ') row.STATUS = 'READ';
          if (operation === 'REMOVE') rows.delete(id);
          return response(200, dto(row));
        }
        if (options.negativeLeak) return response(403, { forbidden: row.CONTENT });
        if (options.negativeTransport) return { ...response(403, null), error: 'transport-or-json-error' };
        return response(options.negativeStatus ?? 403, { message: 'Forbidden' });
      }
      if (operation === 'REMOVE') {
        if (options.blockCleanup && failInjected) return response(403, { message: 'denied' });
        rows.delete(id);
        return response(200, null);
      }
      if (operation === 'UPDATE') {
        for (const [key, value] of Object.entries(spec.data)) row[key.toUpperCase()] = value;
        row.UPDATE_TIME = '2026-11-09 00:00:01';
      }
      if (operation === 'MARK_READ') {
        row.STATUS = 'READ';
        row.UPDATE_TIME = '2026-11-09 00:00:01';
      }
      return response(200, dto(row));
    },
  };
  const record = (kind, value) => {
    if (options.journalFailure && kind === 'journal' && value.operation === 'CREATE') {
      throw new Error('injected journal fsync failure');
    }
    records.push({ kind, value: clone(value) });
    return { path: `${String(records.length).padStart(5, '0')}-${kind}.private.json`, sha256: 'c'.repeat(64) };
  };
  return {
    context, io, rows, records, requests, source, now: () => clock, uuid: () => uuid(++uuidSerial),
    record, get writes() { return writes; },
  };
}

const run = runtime => runOwnedInternalMessage({
  ...runtime, executeOwned: true, label: 'unit-security-r1',
});

test('source account proof uses actual organization and one logical system shared by both tenants', () => {
  const { manifest, source } = fixture();
  const actors = verifyInternalMessageAccounts(manifest, source);
  assert.equal(actors.length, 6);
  assert.equal(new Set(actors.map(actor => actor.source.system)).size, 1);
  assert.equal(new Set(actors.map(actor => actor.source.tenant)).size, 2);
  assert.ok(actors.every(actor => actor.source.organization.endsWith('_source_org')));
  for (const change of [
    rows => { rows.pop(); }, rows => { rows.push(rows[0]); },
    rows => { rows[0].authority = 'ROLE_SUPERUSER'; },
    rows => { rows[0].system = `${rows[0].tenant}_deploy`; },
    rows => { rows[0].memberTenant = rows.at(-1).tenant; },
    rows => { rows[0].organizationTenant = rows.at(-1).tenant; },
    rows => { rows[0].memberOrganization = 'foreign'; },
    rows => { rows[0].personEnabled = 0; },
    rows => { rows[0].deploymentDeleted = 1; },
    rows => { rows[0].developerAdminMode = 1; },
    rows => { rows[0].developerTenant = rows.at(-1).tenant; },
  ]) {
    const rows = clone(source);
    change(rows);
    assert.throws(() => verifyInternalMessageAccounts(manifest, rows));
  }
  const privileged = clone(manifest);
  privileged.users[0].administrator = true;
  assert.throws(() => internalMessageActors(privileged));
});

test('only reviewed canonical gateway notification/auth paths can reach the adapter', () => {
  for (const [path, method] of [
    ['/v7/login', 'POST'], ['/appdata', 'GET'], ['/uaa/oauth/userinfo', 'GET'],
    [collection, 'POST'], [`${collection}/${uuid(1)}`, 'GET'],
    [`${collection}/${uuid(1)}`, 'PUT'], [`${collection}/${uuid(1)}`, 'DELETE'],
    [`${collection}/${uuid(1)}/mark_read`, 'POST'],
    [`${collection}/fetch_cur_receiver`, 'POST'], [`${collection}/mark_all_read`, 'POST'],
  ]) assert.doesNotThrow(() => validateInternalMessageRequest({ path, method }));
  for (const [path, method] of [
    ['/extension/api/internal_messages', 'POST'], ['/api/extension/internal_messages', 'POST'],
    [`${collection}/${uuid(1)}?tenant=foreign`, 'GET'], [`${collection}/../admins`, 'GET'],
    [`${collection}/${uuid(1)}/mark_unread`, 'POST'], [`${collection}/batchdelete`, 'POST'],
    [`${collection}/${uuid(1)}/mark_read`, 'PUT'], [collection, 'GET'],
    ['/v7/login', 'GET'], ['/auths/login', 'POST'], ['https://shared/extension/internal_messages', 'POST'],
  ]) assert.throws(() => validateInternalMessageRequest({ path, method }));
});

test('all actual appdata identity fields must match source data, without privileged context flags', () => {
  const { manifest, source } = fixture();
  const actor = verifyInternalMessageAccounts(manifest, source)[0];
  const data = { context: { srfsystemid: 'ibizmodeling', srfdcsystemid: 'ibizmodeling',
    srforgid: actor.source.organization, srfuserid: actor.personId, srfpersonid: actor.personId,
    srfdcid: actor.centerId } };
  assert.doesNotThrow(() => verifyInternalMessageAppData({ status: 200, error: null, data }, actor));
  for (const field of Object.keys(data.context)) {
    const altered = clone(data);
    altered.context[field] = 'foreign';
    assert.throws(() => verifyInternalMessageAppData({ status: 200, error: null, data: altered }, actor));
  }
  assert.throws(() => verifyInternalMessageAppData({ status: 200, error: null,
    data: { ...data, superuser: 1 } }, actor));
});

test('execute opt-in is checked before opening a runtime, and each output label is exclusive', async () => {
  let opened = 0;
  await assert.rejects(executeOwnedInternalMessage({ runId, label: 'no-opt-in',
    deploymentInput: 'unused' }, { openContext() { opened++; } }), /execute-owned/);
  assert.equal(opened, 0);
  const base = fs.mkdtempSync(join(tmpdir(), 'owned-notification-exclusive-'));
  const destination = join(base, 'internal-message-http-already-used');
  fs.mkdirSync(destination);
  let closed = false;
  try {
    await assert.rejects(executeOwnedInternalMessage({ runId, label: 'already-used',
      deploymentInput: 'unused', executeOwned: true }, {
      openContext() { return { base, close() { closed = true; } }; },
    }), /Existing destination/);
    assert.equal(closed, true);
    assert.equal(fs.readdirSync(destination).length, 0);
  } finally { fs.rmSync(base, { recursive: true, force: true }); }
});

test('genuine fake model completes 120 negatives first and all 84 owner checks with zero physical rows', async () => {
  const runtime = fakeRuntime();
  const report = await run(runtime);
  assert.equal(report.status, 'passed-bounded-native-notification-http');
  assert.equal(report.boundedInternalMessageAcceptance, true);
  assert.equal(report.actualNegativeRequests, 120);
  assert.equal(report.passedNegativeRequests, 120);
  assert.equal(report.passedOwnerChecks, 84);
  assert.equal(report.actualRequests, runtime.requests.length);
  assert.equal(report.actualRequests, 246);
  assert.equal(report.negativeMatrix.filter(row => row.sameTenant).length, 48);
  assert.equal(report.negativeMatrix.filter(row => !row.sameTenant).length, 72);
  const native = report.requests.filter(row => row.path.startsWith(collection));
  assert.ok(native.slice(0, 6).every(row => row.operation === 'CREATE'));
  assert.ok(native.slice(6, 126).every(row => row.negative && row.httpStatus === 403));
  assert.ok(native.slice(126).every(row => !row.negative));
  assert.equal(runtime.rows.size, 0);
  assert.equal(report.baselineRestored, true);
  assert.ok(report.cleanup.every(row => row.status === 'already-absent'));
  assert.equal(report.nativeAcceptance, false);
  assert.equal(report.permissionAcceptance, false);
  assert.equal(report.composerAcceptance, false);
  assert.equal(report.backgroundDeliveryAcceptance, false);
  assert.ok(!JSON.stringify(report).includes('private-password-'));
  assert.ok(!JSON.stringify(report).includes('Bearer'));
  assert.ok(!JSON.stringify(report).includes('owned-internal-message:'));
  assert.ok(runtime.records.filter(row => row.kind === 'snapshot').every(row =>
    row.value.snapshot.columns.includes('UNEXPECTED_NATIVE_COLUMN')));
});

test('normal login is proactively renewed without UAA TTL or refresh-token modifications', async () => {
  const runtime = fakeRuntime({ requestTick: 500, snapshotTick: 150, guardTick: 25 });
  const report = await run(runtime);
  assert.equal(report.boundedInternalMessageAcceptance, true);
  assert.ok(runtime.requests.filter(row => row.path === '/v7/login').length > 18);
  assert.ok(runtime.requests.every(row => !row.path.includes('refresh_token')));
  assert.ok(runtime.requests.filter(row => row.token).every(row =>
    row.sessionExpiresAt - row.sessionStartedAt <= 21_000));
});

test('old allow-all source image fails on the first cross-actor read and still cleans only native owned UUIDs', async () => {
  const runtime = fakeRuntime({ oldAllowAll: true });
  const report = await run(runtime);
  assert.equal(report.boundedInternalMessageAcceptance, false);
  assert.equal(report.actualNegativeRequests, 1);
  assert.equal(report.passedNegativeRequests, 0);
  assert.equal(report.ownerChecks.length, 0);
  assert.ok(report.cleanup.every(row => row.status === 'native-owner-removed'));
  assert.equal(report.baselineRestored, true);
  assert.equal(runtime.rows.size, 0);
  const failure = runtime.records.find(record => record.kind === 'failure');
  assert.ok(failure?.value.error.stack.includes('AssertionError'));
  assert.ok(report.failureBinding?.path.endsWith('-failure.private.json'));
});

for (const status of [200, 204, 302, 400, 401, 404, 500, 503]) {
  test(`cross-actor HTTP ${status} is never counted as authorization proof`, async () => {
    const runtime = fakeRuntime({ negativeStatus: status });
    const report = await run(runtime);
    assert.equal(report.boundedInternalMessageAcceptance, false);
    assert.equal(report.actualNegativeRequests, 1);
    assert.equal(report.passedNegativeRequests, 0);
    assert.equal(report.baselineRestored, true);
    assert.equal(runtime.rows.size, 0);
  });
}

test('a 403 with foreign content leakage or transport failure does not pass', async () => {
  for (const options of [{ negativeLeak: true }, { negativeTransport: true }]) {
    const runtime = fakeRuntime(options);
    const report = await run(runtime);
    assert.equal(report.boundedInternalMessageAcceptance, false);
    assert.equal(report.passedNegativeRequests, 0);
    assert.equal(report.baselineRestored, true);
  }
});

test('all-column snapshots catch a denied request mutating an otherwise unknown native column', async () => {
  const runtime = fakeRuntime({ negativeMutation: 'audit' });
  const report = await run(runtime);
  assert.equal(report.boundedInternalMessageAcceptance, false);
  assert.equal(report.passedNegativeRequests, 0);
  const evidence = runtime.records.find(row => row.kind === 'snapshot'
    && row.value.snapshot.rows.some(item => item.UNEXPECTED_NATIVE_COLUMN === 'foreign-write'));
  assert.ok(evidence, 'Mutation evidence must be retained before native finally cleanup');
  assert.equal(report.baselineRestored, true);
});

test('cleanup refuses a UUID whose sender/receiver/marker ownership proof drifted', async () => {
  const runtime = fakeRuntime({ negativeMutation: 'ownership' });
  const report = await run(runtime);
  assert.equal(report.boundedInternalMessageAcceptance, false);
  assert.equal(report.baselineRestored, false);
  assert.equal(report.cleanup.filter(row => row.status === 'refused-ownership-or-run-marker-drift').length, 1);
  assert.equal(runtime.rows.size, 1);
  const retained = [...runtime.rows.values()][0];
  assert.equal(retained.SENDER, 'foreign-write');
  assert.ok(!runtime.requests.some(request => request.method === 'DELETE'
    && request.path === `${collection}/${retained.ID}`), 'Ownership-drifted UUID must never be deleted');
});

test('an ambiguous native create timeout is cleaned using the pre-write UUID intent', async () => {
  const runtime = fakeRuntime({ createTimeout: true });
  const report = await run(runtime);
  assert.equal(report.boundedInternalMessageAcceptance, false);
  assert.equal(report.actualNegativeRequests, 0);
  assert.equal(report.cleanup.length, 1);
  assert.equal(report.cleanup[0].status, 'native-owner-removed');
  assert.equal(report.baselineRestored, true);
  assert.equal(runtime.rows.size, 0);
});

test('native cleanup denial is retained as a failed gate, never replaced with SQL removal', async () => {
  const runtime = fakeRuntime({ createTimeout: true, blockCleanup: true });
  const report = await run(runtime);
  assert.equal(report.boundedInternalMessageAcceptance, false);
  assert.equal(report.cleanup[0].status, 'blocked-native-owner-cleanup');
  assert.equal(report.baselineRestored, false);
  assert.equal(runtime.rows.size, 1);
  assert.deepEqual(Object.keys(runtime.io).sort(), ['request', 'snapshot', 'sourceAccounts']);
});

test('pre-existing physical rows, wrong appdata system and journal failure all stop before message writes', async () => {
  for (const options of [{ existing: true }, { wrongSystem: true }, { journalFailure: true }]) {
    const runtime = fakeRuntime(options);
    const report = await run(runtime);
    assert.equal(report.boundedInternalMessageAcceptance, false);
    assert.equal(report.actualNegativeRequests, 0);
    assert.equal(report.cleanup.length, 0);
    assert.ok(!runtime.requests.some(row => row.path === collection));
    assert.equal(runtime.rows.size, options.existing ? 1 : 0);
  }
});

test('broad mark-all-read SQL and synthetic fetch page responses cannot pass owner semantics', async () => {
  for (const options of [{ broadMarkAll: true }, { syntheticPage: true }]) {
    const runtime = fakeRuntime(options);
    const report = await run(runtime);
    assert.equal(report.boundedInternalMessageAcceptance, false);
    assert.equal(report.passedNegativeRequests, 120);
    assert.equal(report.baselineRestored, true);
  }
});

test('a zero-byte mark-all request returning 200 without executing SQL remains a failed gate', async () => {
  const runtime = fakeRuntime({ bodylessMarkAll: true });
  const originalRequest = runtime.io.request;
  runtime.io.request = spec => originalRequest(spec.path === `${collection}/mark_all_read`
    ? { ...spec, data: undefined } : spec);
  const report = await run(runtime);
  assert.equal(report.boundedInternalMessageAcceptance, false);
  assert.equal(report.passedNegativeRequests, 120);
  assert.equal(report.passedOwnerChecks, 54);
  assert.equal(report.ownerChecks.at(-1).operation, 'MARK_ALL_READ');
  assert.equal(report.ownerChecks.at(-1).status, 'failed');
  assert.equal(report.baselineRestored, true);
});

test('a topology guard failure blocks further HTTP, SQL and native cleanup operations', async () => {
  const runtime = fakeRuntime({ guardFailure: true });
  const report = await run(runtime);
  assert.equal(report.boundedInternalMessageAcceptance, false);
  assert.equal(report.actualNegativeRequests, 0);
  assert.equal(report.cleanup[0].status, 'blocked-native-owner-cleanup');
  assert.equal(runtime.requests.filter(row => row.path.startsWith(collection)).length, 1);
  assert.equal(runtime.rows.size, 1);
});

function adapterFixture() {
  const data = fixture();
  let guards = 0;
  let executeCalls = 0;
  const input = [];
  const context = { ...data, resources: { mysqlId: 'd'.repeat(64) },
    guard() { guards++; return { origins: { backend: 'http://10.91.0.9:30086' } }; } };
  const execute = (command, args, options) => {
    executeCalls++;
    assert.equal(command, 'docker');
    assert.deepEqual(args.slice(0, 3), ['exec', '-i', context.resources.mysqlId]);
    assert.ok(guards >= executeCalls);
    input.push(options.input);
    let stdout;
    if (options.input.startsWith('SELECT JSON_OBJECT(') && options.input.includes('sys_person p')) {
      stdout = data.source.map(row => JSON.stringify(row)).join('\n');
    } else if (options.input.startsWith('SHOW COLUMNS')) {
      stdout = columns.map(column => `${column}\tvarchar(2000)\tYES\t\tNULL\t`).join('\n');
    } else {
      assert.match(options.input, /^SELECT JSON_OBJECT/);
      assert.match(options.input, /FROM `nf_f01006abcdef_platform`\.`INTERNAL_MESSAGE` ORDER BY `ID`;/);
      assert.ok(columns.every(column => options.input.includes(`'${column}',\`${column}\``)));
      stdout = '';
    }
    return { status: 0, stdout };
  };
  return { context, execute, input, get guards() { return guards; } };
}

test('real SQL adapter reads actual source joins and every native column/all rows, with no mutation interface', () => {
  const runtime = adapterFixture();
  const io = createInternalMessageIO(runtime.context, { execute: runtime.execute });
  assert.equal(io.sourceAccounts().length, 6);
  assert.deepEqual(io.snapshot(), { columns, physicalColumns: columns, rows: [] });
  assert.equal(runtime.input.length, 3);
  assert.equal(runtime.guards, 3);
  assert.ok(runtime.input[0].includes('JOIN `nf_f01006abcdef_uaa`.sys_role_member'));
  assert.ok(runtime.input[0].includes('JOIN `nf_f01006abcdef_uaa`.sys_deploy_system'));
  assert.ok(runtime.input.every(sql => !/\b(?:INSERT|UPDATE|DELETE|DROP|ALTER|CREATE)\b/.test(sql)));
  assert.deepEqual(Object.keys(io).sort(), ['request', 'snapshot', 'sourceAccounts']);
});

test('native lower/mixed-case columns retain real spelling and every value in canonical full-column snapshots', () => {
  for (const physicalColumns of [columns.map(column => column.toLowerCase()),
    columns.map((column, index) => index % 2 ? column.toLowerCase() : column)]) {
    const runtime = adapterFixture();
    let calls = 0;
    const row = Object.fromEntries(columns.map(column => [column, column === 'ID' ? uuid(1) : `native-${column}`]));
    const io = createInternalMessageIO(runtime.context, {
      execute(_command, _args, options) {
        calls++;
        if (calls === 1) {
          assert.match(options.input, /^SHOW COLUMNS/);
          return { status: 0, stdout: physicalColumns.map(column => `${column}\tvarchar(2000)`).join('\n') };
        }
        assert.match(options.input, new RegExp(`ORDER BY \`${physicalColumns[0]}\`;`));
        for (let index = 0; index < columns.length; index++) {
          assert.ok(options.input.includes(`'${columns[index]}',\`${physicalColumns[index]}\``));
        }
        return { status: 0, stdout: JSON.stringify(row) };
      },
    });
    assert.deepEqual(io.snapshot(), { columns, physicalColumns, rows: [row] });
    assert.equal(calls, 2);
    assert.equal(runtime.guards, 2);
  }
});

test('native snapshot rejects case-fold duplicate and unsafe physical column identifiers before row SQL', () => {
  for (const physicalColumns of [[...columns, 'id'], [...columns, 'unsafe`column']]) {
    const runtime = adapterFixture();
    let calls = 0;
    const io = createInternalMessageIO(runtime.context, {
      execute() {
        calls++;
        return { status: 0, stdout: physicalColumns.map(column => `${column}\tvarchar(2000)`).join('\n') };
      },
    });
    assert.throws(() => io.snapshot());
    assert.equal(calls, 1);
  }
});

test('adapter SQL guard failures and process failures never expose or bypass private details', () => {
  const runtime = adapterFixture();
  let called = 0;
  const io = createInternalMessageIO({ ...runtime.context, guard() { throw new Error('guard-refused'); } },
    { execute() { called++; } });
  assert.throws(() => io.sourceAccounts(), /guard-refused/);
  assert.throws(() => io.snapshot(), /guard-refused/);
  assert.equal(called, 0);
  const failed = createInternalMessageIO(runtime.context, {
    execute() { return { status: 1, stderr: 'private-database-password' }; },
  });
  assert.throws(() => failed.snapshot(), error =>
    /private output suppressed/.test(error.message) && !error.message.includes('private-database-password'));
});

test('HTTP adapter rejects unverified contexts and stale tokens, refuses redirects and bounds streamed data', async () => {
  const runtime = adapterFixture();
  let fetches = 0;
  let response = new Response('', { status: 302, headers: { location: 'http://foreign' } });
  const now = Date.UTC(2026, 10, 9);
  const io = createInternalMessageIO(runtime.context, {
    execute: runtime.execute, now: () => now,
    fetchImplementation: async (url, options) => {
      fetches++;
      assert.equal(url, 'http://10.91.0.9:30086/appdata');
      assert.equal(options.redirect, 'manual');
      assert.equal(options.headers.srfsystemid, 'ibizmodeling');
      assert.equal(options.headers.srforgid, runtime.context.source[0].organization);
      assert.equal(options.headers.authorization, 'Bearer header.payload.signature');
      return response;
    },
  });
  const spec = { path: '/appdata', token: 'header.payload.signature',
    sessionStartedAt: now, sessionExpiresAt: now + 20_000,
    applicationContext: { system: 'ibizmodeling', organization: runtime.context.source[0].organization } };
  await assert.rejects(io.request(spec), /source accounts/);
  io.sourceAccounts();
  await assert.rejects(io.request({ ...spec, applicationContext: {
    ...spec.applicationContext, organization: `nf_${runId}_foreign_org`,
  } }), /verified real source/);
  await assert.rejects(io.request({ ...spec, sessionStartedAt: now - 10_000 }), /aged ten seconds/);
  await assert.rejects(io.request({ ...spec, sessionExpiresAt: now + 5_000 }), /expiring/);
  await assert.rejects(io.request({ ...spec, token: 'token\r\ninjection' }));
  assert.equal(fetches, 0);
  const redirect = await io.request(spec);
  assert.equal(redirect.error, 'redirect-refused');
  assert.equal(redirect.dispatched, true);
  assert.equal(fetches, 1);
  response = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(2 * 1024 * 1024 + 1));
      controller.close();
    },
  }), { headers: { 'content-type': 'application/json' } });
  assert.equal((await io.request(spec)).error, 'response-too-large');
  response = new Response('<html>not-json</html>', { headers: { 'content-type': 'text/html' } });
  assert.equal((await io.request(spec)).error, 'transport-or-json-error');
  response = Response.json({ context: { safe: true } }, { headers: { 'x-total': '1' } });
  const valid = await io.request(spec);
  assert.equal(valid.error, null);
  assert.deepEqual(valid.data, { context: { safe: true } });
  assert.equal(valid.headers['x-total'], '1');
});
