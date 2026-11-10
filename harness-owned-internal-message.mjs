#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { PinnedDirectories } from './native-candidate-files.mjs';
import { ownedNativeRuntimeContext } from './owned-native-runtime-context.mjs';

const workspaceDefault = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const collection = '/extension/internal_messages';
const uuidPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const tokenPattern = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const hash = value => createHash('sha256').update(value).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const protectedFields = ['SENDER', 'RECEIVER', 'SYSTEM_TAG', 'OWNER_TYPE', 'OWNER_ID', 'CONTENT'];

export function internalMessageActors(manifest) {
  assert.match(manifest.runId ?? '', /^[a-f0-9]{12}$/);
  assert.equal(manifest.schemas.uaa, `nf_${manifest.runId}_uaa`);
  assert.equal(manifest.schemas.metadata, `nf_${manifest.runId}_meta`);
  assert.equal(manifest.users.length, 6);
  assert.equal(new Set(manifest.users.map(user => user.personId)).size, 6);
  assert.equal(new Set(manifest.users.map(user => user.loginname)).size, 6);
  const users = manifest.users.toSorted((a, b) => a.personId.localeCompare(b.personId));
  for (const side of ['a', 'b']) {
    const members = users.filter(user => user.centerId === `nf_${manifest.runId}_center_${side}`);
    assert.deepEqual(members.map(user => user.role).sort(), ['editor', 'no-access', 'viewer']);
  }
  for (const user of users) {
    assert.match(user.personId, new RegExp(`^nf_${manifest.runId}_person_[ab]_[evn]$`));
    assert.equal(user.administrator, false);
    assert.match(user.loginname, /^[A-Za-z0-9_-]{1,128}$/);
  }
  return users;
}

export function verifyInternalMessageAccounts(manifest, rows) {
  const actors = internalMessageActors(manifest);
  assert.ok(Array.isArray(rows));
  assert.equal(rows.length, actors.length, 'Require exactly six real ordinary source accounts');
  for (const actor of actors) {
    const matching = rows.filter(row => row.id === actor.personId);
    assert.equal(matching.length, 1, 'Require one unambiguous source account and system grant');
    const source = matching[0];
    assert.equal(source.loginname, actor.loginname);
    assert.equal(source.tenant, actor.centerId);
    assert.match(source.organization ?? '', new RegExp(`^nf_${manifest.runId}_[A-Za-z0-9_]+$`));
    assert.equal(source.organizationTenant, source.tenant);
    assert.equal(source.memberTenant, source.tenant);
    assert.equal(source.memberOrganization, source.organization);
    assert.equal(source.roleTenant, source.tenant);
    assert.equal(source.deploymentTenant, source.tenant);
    assert.equal(source.developerTenant, source.tenant);
    assert.equal(source.system, 'ibizmodeling');
    assert.equal(source.authority, 'ROLE_NATIVE_FIXTURE');
    assert.equal(source.roleId, `${source.tenant}_ordinary_role`);
    for (const field of ['personEnabled', 'organizationEnabled', 'domainEnabled', 'roleEnabled',
      'deploymentEnabled', 'developerEnabled', 'developerObjectEnabled', 'developerValid']) {
      assert.equal(Number(source[field]), 1);
    }
    assert.equal(Number(source.developerAdminMode), 0);
    assert.equal(String(source.personStatus), '1');
    assert.equal(Number(source.deploymentDeleted), 0);
  }
  return actors.map(actor => ({ ...actor, source: rows.find(row => row.id === actor.personId) }));
}

export function validateInternalMessageRequest({ path, method = 'GET' }) {
  assert.equal(typeof path, 'string');
  const ordinary = { '/v7/login': 'POST', '/appdata': 'GET', '/uaa/oauth/userinfo': 'GET' }[path];
  if (ordinary) {
    assert.equal(method, ordinary);
    return;
  }
  if (path === collection) {
    assert.equal(method, 'POST');
    return;
  }
  if ([`${collection}/fetch_cur_receiver`, `${collection}/mark_all_read`].includes(path)) {
    assert.equal(method, 'POST');
    return;
  }
  assert.ok(path.startsWith(`${collection}/`), 'Only canonical native gateway routes are allowed');
  const parts = path.slice(collection.length + 1).split('/');
  assert.match(parts[0], uuidPattern);
  if (parts.length === 1) assert.ok(['GET', 'PUT', 'DELETE'].includes(method));
  else {
    assert.deepEqual(parts.slice(1), ['mark_read']);
    assert.equal(method, 'POST');
  }
}

export function verifyInternalMessageAppData(response, actor) {
  assert.equal(response.status, 200);
  assert.equal(response.error, null);
  const value = response.data?.context;
  assert.ok(value && typeof value === 'object' && !Array.isArray(value));
  for (const [field, expected] of [
    ['srfsystemid', actor.source.system], ['srfdcsystemid', actor.source.system],
    ['srforgid', actor.source.organization], ['srfuserid', actor.source.id],
    ['srfpersonid', actor.source.id], ['srfdcid', actor.source.tenant],
  ]) assert.equal(value[field], expected, `Actual appdata ${field} must match the real source account`);
  for (const object of [value, response.data]) {
    for (const key of ['superuser', 'super_user', 'apiuser', 'api_user', 'adminmode']) {
      if (Object.hasOwn(object, key)) assert.ok([0, '0', false, null].includes(object[key]));
    }
  }
  return value;
}

// SQL is deliberately not exposed: this adapter has only two read operations.
export function createInternalMessageIO(context, {
  execute = spawnSync, fetchImplementation = fetch, now = Date.now,
} = {}) {
  const actors = internalMessageActors(context.manifest);
  const runId = context.manifest.runId;
  assert.match(context.resources.mysqlId, /^[a-f0-9]{64}$/);
  const schema = `nf_${runId}_platform`;
  let verifiedAccounts;
  const sql = input => {
    context.guard();
    const result = execute('docker', ['exec', '-i', context.resources.mysqlId, 'sh', '-c',
      'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -h127.0.0.1 --protocol=TCP -uroot --default-character-set=utf8mb4 --batch --raw --skip-column-names'],
    { input, encoding: 'utf8', timeout: 30_000, maxBuffer: 16 * 1024 * 1024 });
    assert.ok(result.status === 0 && !result.error && !result.signal,
      'Owned notification read-only SQL failed; private output suppressed');
    assert.equal(typeof result.stdout, 'string');
    return result.stdout.trim();
  };
  const parseRows = text => text ? text.split('\n').map(row => JSON.parse(row)) : [];
  return {
    sourceAccounts() {
      const uaa = `\`${context.manifest.schemas.uaa}\``;
      const metadata = `\`${context.manifest.schemas.metadata}\``;
      const rows = parseRows(sql(`SELECT JSON_OBJECT(
        'id',p.ID,'loginname',p.UID,'tenant',p.DC,'organization',p.ORGANIZATION_ID,
        'personEnabled',p.ENABLED,'personStatus',p.STATUS,
        'organizationTenant',o.DC,'organizationEnabled',o.ENABLED,'domainEnabled',d.ENABLED,
        'memberTenant',m.DC,'memberOrganization',m.ORGANIZATION_ID,
        'roleTenant',r.DC,'roleId',r.ID,'authority',r.AUTHORITY,'roleEnabled',r.ENABLED,
        'deploymentTenant',ds.DC,'system',ds.SYSTEM_ID,'deploymentEnabled',ds.ENABLED,
        'deploymentDeleted',ds.DELETED,'developerTenant',duo.PSDEVCENTERID,
        'developerAdminMode',du.ADMINMODE,'developerEnabled',du.ENABLE,
        'developerObjectEnabled',duo.ENABLE,'developerValid',duo.VALIDFLAG)
        FROM ${uaa}.sys_person p
        JOIN ${uaa}.sys_domain d ON d.ID=p.DC
        JOIN ${uaa}.sys_organization o ON o.ID=p.ORGANIZATION_ID
        JOIN ${uaa}.sys_role_member m ON m.MEMBER_UID=p.ID AND m.MEMBER_TYPE='inetOrgPerson'
        JOIN ${uaa}.sys_role r ON r.ID=m.ROLE_ID
        JOIN ${uaa}.sys_deploy_system ds ON ds.ID=r.DEPLOY_SYSTEM_ID
        JOIN ${metadata}.t_srfpsdevuser du ON du.PSDEVUSERID=p.ID AND du.LOGINNAME=p.UID
        JOIN ${metadata}.t_srfpsdevuserobj duo ON duo.PSDEVUSEROBJID=du.PSDEVUSERID
        WHERE p.ID IN (${actors.map(actor => `'${actor.personId}'`).join(',')}) ORDER BY p.ID;\n`));
      verifiedAccounts = verifyInternalMessageAccounts(context.manifest, rows);
      return rows;
    },
    snapshot() {
      const table = `\`${schema}\`.\`INTERNAL_MESSAGE\``;
      const physicalColumns = sql(`SHOW COLUMNS FROM ${table};\n`).split('\n').map(line => line.split('\t')[0]);
      assert.ok(physicalColumns.length > 0
        && physicalColumns.every(column => /^[A-Za-z][A-Za-z0-9_]*$/.test(column)));
      const columns = physicalColumns.map(column => column.toUpperCase());
      assert.equal(new Set(columns).size, columns.length);
      for (const column of ['ID', 'STATUS', 'TITLE', 'SHORT_CONTENT', ...protectedFields]) {
        assert.ok(columns.includes(column), 'Native message schema is incomplete');
      }
      const fields = physicalColumns.map((column, index) => `'${columns[index]}',\`${column}\``).join(',');
      const key = physicalColumns[columns.indexOf('ID')];
      return { columns, physicalColumns,
        rows: parseRows(sql(`SELECT JSON_OBJECT(${fields}) FROM ${table} ORDER BY \`${key}\`;\n`)) };
    },
    async request(spec) {
      validateInternalMessageRequest(spec);
      assert.ok(verifiedAccounts, 'Real source accounts must be verified before HTTP');
      if (spec.path === '/v7/login') {
        assert.ok(actors.some(actor => actor.loginname === spec.data?.loginname
          && spec.data.password === context.credentials.users[actor.loginname]),
        'Login must use an actual owned ordinary account');
      } else {
        assert.match(spec.token ?? '', tokenPattern);
        assert.ok(spec.applicationContext, 'Actual source application context is required');
      }
      if (spec.token !== undefined) assert.match(spec.token, tokenPattern);
      if (spec.applicationContext) {
        assert.deepEqual(Object.keys(spec.applicationContext).sort(), ['organization', 'system']);
        assert.equal(spec.applicationContext.system, 'ibizmodeling');
        assert.ok(verifiedAccounts.some(actor => actor.source.organization === spec.applicationContext.organization
          && actor.source.system === spec.applicationContext.system),
        'Application headers must match verified real source accounts');
      }
      const body = spec.data === undefined ? undefined : JSON.stringify(spec.data);
      assert.ok(body === undefined || Buffer.byteLength(body) <= 64 * 1024);
      const live = context.guard();
      if (spec.token !== undefined) {
        assert.ok(Number.isFinite(spec.sessionStartedAt) && now() - spec.sessionStartedAt < 10_000,
          'Refuse a session aged ten seconds before HTTP dispatch');
        assert.ok(spec.sessionExpiresAt - now() > 5_000, 'Refuse an expiring backend token');
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);
      const result = { status: null, error: null, bytes: 0, data: null, headers: {}, dispatched: false };
      try {
        result.dispatched = true;
        const response = await fetchImplementation(live.origins.backend + spec.path, {
          method: spec.method ?? 'GET', redirect: 'manual', signal: controller.signal,
          headers: { accept: 'application/json', 'content-type': 'application/json',
            ...(spec.token ? { authorization: `Bearer ${spec.token}` } : {}),
            ...(spec.applicationContext ? { srfsystemid: spec.applicationContext.system,
              srforgid: spec.applicationContext.organization } : {}) },
          ...(body === undefined ? {} : { body }),
        });
        result.status = response.status;
        for (const name of ['x-page', 'x-per-page', 'x-total']) result.headers[name] = response.headers.get(name);
        if (response.status >= 300 && response.status < 400) {
          await response.body?.cancel();
          return { ...result, error: 'redirect-refused' };
        }
        const chunks = [];
        const reader = response.body?.getReader();
        if (reader) for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          result.bytes += value.length;
          if (result.bytes > 2 * 1024 * 1024) {
            controller.abort();
            await reader.cancel();
            return { ...result, error: 'response-too-large' };
          }
          chunks.push(value);
        }
        const bytes = Buffer.concat(chunks);
        result.responseSha256 = hash(bytes);
        if (bytes.length) {
          assert.match(response.headers.get('content-type') ?? '',
            /^application\/(?:json|[a-z0-9.+-]+\+json)(?:;|$)/i);
          result.data = JSON.parse(bytes.toString('utf8'));
        }
        return result;
      } catch {
        return { ...result, error: controller.signal.aborted ? 'timeout' : 'transport-or-json-error' };
      } finally { clearTimeout(timer); }
    },
  };
}

export function internalMessageOwnership(row, owned) {
  return row?.ID === owned.id && row.SENDER === owned.actor.source.id
    && row.RECEIVER === owned.actor.source.id && row.SYSTEM_TAG === owned.actor.source.system
    && row.OWNER_TYPE === 'PERSONAL' && row.OWNER_ID === owned.actor.source.id
    && row.CONTENT === owned.payload.content;
}

function requireSuccess(response) {
  assert.equal(response.dispatched, true, 'Only an actually dispatched HTTP request is evidence');
  assert.equal(response.error, null);
  assert.equal(response.status, 200);
}

function verifyDto(response, owned, expected) {
  requireSuccess(response);
  assert.equal(response.data?.id, owned.id);
  for (const field of ['sender', 'receiver', 'system_tag', 'owner_type', 'owner_id', 'content']) {
    assert.equal(response.data[field], owned.payload[field]);
  }
  for (const [field, value] of Object.entries(expected)) assert.equal(response.data[field], value);
}

function verifyOnlyOwnerChanged(before, after, owned, expected, allowed) {
  assert.deepEqual(after.columns, before.columns, 'Every native column must remain present');
  assert.deepEqual(after.physicalColumns, before.physicalColumns, 'Physical native column spelling must remain stable');
  assert.deepEqual(after.rows.filter(row => row.ID !== owned.id), before.rows.filter(row => row.ID !== owned.id),
    'No other actor message may change');
  const old = before.rows.find(row => row.ID === owned.id);
  const current = after.rows.find(row => row.ID === owned.id);
  assert.ok(old && internalMessageOwnership(current, owned), 'Owner identity/run marker must remain unchanged');
  for (const column of before.columns) {
    if (!allowed.includes(column)) assert.deepEqual(current[column], old[column], `Unexpected native ${column} mutation`);
  }
  for (const [field, value] of Object.entries(expected)) assert.equal(current[field], value);
}

export async function runOwnedInternalMessage({
  context, label, executeOwned = false, io = createInternalMessageIO(context),
  record, now = Date.now, uuid = randomUUID,
}) {
  assert.equal(executeOwned, true, 'Explicit owned notification execution opt-in is required');
  assert.match(label ?? '', /^[a-z0-9][a-z0-9-]{0,48}$/);
  assert.equal(typeof record, 'function', 'A durable private journal/snapshot sink is required');
  const report = {
    contract: 'owned-internal-message-http-v1', runId: context.manifest.runId, label,
    startedAt: new Date(now()).toISOString(), status: 'running', stage: 'initial',
    inputs: context.bindings, witness: context.witness, requests: [], snapshots: [], cleanup: [],
    negativeMatrix: [], ownerChecks: [], sourceAccountBinding: null, baselineWasEmpty: false,
    baselineRestored: false, boundedInternalMessageAcceptance: false,
    nativeAcceptance: false, permissionAcceptance: false,
    composerAcceptance: false, backgroundDeliveryAcceptance: false, unresolved: [],
  };
  const owned = new Map();
  const sessions = new Map();
  let baseline;
  let completed = false;
  let writeSerial = 0;
  const failure = (where, error) => record('failure', {
    where, stage: report.stage, at: new Date(now()).toISOString(),
    error: { name: error?.name, code: error?.code, message: error?.message, stack: error?.stack },
  });
  const journal = entry => record('journal', { sequence: ++writeSerial, at: new Date(now()).toISOString(), ...entry });
  const snapshot = purpose => {
    context.guard();
    const value = io.snapshot();
    assert.ok(Array.isArray(value.columns) && Array.isArray(value.rows));
    assert.equal(new Set(value.rows.map(row => row.ID)).size, value.rows.length);
    const binding = record('snapshot', { purpose, snapshot: value });
    report.snapshots.push({ purpose, rows: value.rows.length, binding });
    return value;
  };
  const request = async (id, spec, detail = {}) => {
    report.stage = id;
    const row = { id, ...detail, method: spec.method ?? 'GET', path: spec.path,
      status: 'failed', httpStatus: null };
    report.requests.push(row);
    context.guard();
    const response = await io.request(spec);
    Object.assign(row, { httpStatus: response.status, error: response.error,
      responseSha256: response.responseSha256, bytes: response.bytes, dispatched: response.dispatched === true });
    row.responseBinding = record('http-response', {
      id, method: row.method, path: spec.path, dispatched: row.dispatched,
      status: response.status, error: response.error, headers: response.headers,
      responseSha256: response.responseSha256, bytes: response.bytes,
      ...(spec.path === '/v7/login' ? {} : { data: response.data }),
    });
    row.status = 'observed';
    return { response, row };
  };
  const login = async actor => {
    const startedAt = now();
    journal({ kind: 'normal-backend-login', actor: actor.personId });
    const { response, row } = await request(`${actor.personId}-login-${report.requests.length}`, {
      path: '/v7/login', method: 'POST',
      data: { loginname: actor.loginname, password: context.credentials.users[actor.loginname] },
    }, { actor: actor.personId, operation: 'LOGIN' });
    requireSuccess(response);
    assert.match(response.data?.token ?? '', tokenPattern);
    const claims = JSON.parse(Buffer.from(response.data.token.split('.')[1], 'base64url').toString('utf8'));
    assert.ok(Number.isSafeInteger(claims.exp));
    const expiresAt = claims.exp * 1000;
    assert.ok(expiresAt - now() > 10_000 && expiresAt - startedAt <= 21_000,
      'Require the unmodified short-lived UAA token');
    const session = { token: response.data.token, sessionStartedAt: startedAt, sessionExpiresAt: expiresAt,
      applicationContext: { system: actor.source.system, organization: actor.source.organization } };
    sessions.set(actor.personId, session);
    row.status = 'passed';
    const boot = await request(`${actor.personId}-appdata-${report.requests.length}`, {
      path: '/appdata', ...session,
    }, { actor: actor.personId, operation: 'APPDATA' });
    verifyInternalMessageAppData(boot.response, actor);
    boot.row.status = 'passed';
    return session;
  };
  const ensureSession = async (actor, force = false) => {
    const session = sessions.get(actor.personId);
    if (force || !session || now() - session.sessionStartedAt >= 8_000
      || session.sessionExpiresAt - now() <= 10_000) return login(actor);
    return session;
  };
  const native = async (actor, target, operation, { data, cleanup = false, negative = false } = {}) => {
    const session = await ensureSession(actor);
    const spec = {
      CREATE: { path: collection, method: 'POST' },
      GET: { path: `${collection}/${target.id}` },
      UPDATE: { path: `${collection}/${target.id}`, method: 'PUT' },
      REMOVE: { path: `${collection}/${target.id}`, method: 'DELETE' },
      MARK_READ: { path: `${collection}/${target.id}/mark_read`, method: 'POST' },
      MARK_ALL_READ: { path: `${collection}/mark_all_read`, method: 'POST' },
      FETCH: { path: `${collection}/fetch_cur_receiver`, method: 'POST' },
    }[operation];
    assert.ok(spec);
    if (!['GET', 'FETCH'].includes(operation)) {
      journal({ kind: cleanup ? 'cleanup-write' : 'notification-write', actor: actor.personId,
        target: target.actor.personId, operation, id: target.id, method: spec.method,
        path: spec.path, data, ownership: {
          sender: target.actor.source.id, receiver: target.actor.source.id,
          system: target.actor.source.system, content: target.payload.content,
        } });
      if (operation === 'CREATE') owned.set(target.id, target);
    }
    return request(`${actor.personId}-${operation.toLowerCase()}-${report.requests.length}`,
      { ...spec, ...session, ...(data === undefined ? {} : { data }) },
      { actor: actor.personId, target: target.actor.personId, operation, cleanup, negative });
  };
  const ownerCheck = async (target, operation, data, verify) => {
    const actor = target.actor;
    const before = snapshot(`${actor.personId}-${operation}-before`);
    const event = { actor: actor.personId, operation, status: 'failed' };
    report.ownerChecks.push(event);
    const { response, row } = await native(actor, target, operation, { data });
    const after = snapshot(`${actor.personId}-${operation}-after`);
    requireSuccess(response);
    verify(response, before, after);
    row.status = event.status = 'passed';
  };
  const ownerGet = (target, expected) => ownerCheck(target, 'GET', undefined, (response, before, after) => {
    verifyDto(response, target, expected);
    assert.deepEqual(after, before, 'Native GET must not mutate any physical row');
  });
  const ownerUpdate = (target, data, expected) => ownerCheck(target, 'UPDATE', { id: target.id, ...data },
    (response, before, after) => {
      verifyDto(response, target, data);
      verifyOnlyOwnerChanged(before, after, target, expected,
        [...Object.keys(data).map(field => field.toUpperCase()), 'UPDATE_TIME', 'UPDATE_MAN']);
    });
  const ownerFetch = (target, unread, expectedStatus) => ownerCheck(target, 'FETCH',
    { page: 0, size: 20, sort: 'timestamp,desc', ...(unread ? { n_status_eq: 'RECEIVED' } : {}) },
    (response, before, after) => {
      assert.deepEqual(after, before, 'Native FETCH must not mutate any physical row');
      assert.ok(Array.isArray(response.data), 'Native fetch is an array, not a synthetic page object');
      const expectedCount = unread && expectedStatus === 'READ' ? 0 : 1;
      assert.equal(response.data.length, expectedCount);
      assert.equal(Number(response.headers?.['x-total']), expectedCount);
      assert.equal(String(response.headers?.['x-page']), '0');
      assert.equal(String(response.headers?.['x-per-page']), '20');
      if (expectedCount) verifyDto({ ...response, data: response.data[0] }, target, { status: expectedStatus });
    });
  try {
    context.guard();
    const sourceAccounts = io.sourceAccounts();
    report.sourceAccountBinding = record('source-accounts', sourceAccounts);
    const actors = verifyInternalMessageAccounts(context.manifest, sourceAccounts);
    baseline = snapshot('initial-full-table');
    assert.equal(baseline.rows.length, 0, 'The physical INTERNAL_MESSAGE baseline must be empty');
    report.baselineWasEmpty = true;
    const targets = actors.map(actor => {
      const id = uuid();
      assert.match(id, uuidPattern);
      const content = `owned-internal-message:${context.manifest.runId}:${label}:${id}:${actor.personId}`;
      return { id, actor, payload: {
        id, sender: actor.source.id, receiver: actor.source.id, system_tag: actor.source.system,
        owner_type: 'PERSONAL', owner_id: actor.source.id, status: 'RECEIVED', content_type: 'TEXT',
        title: `Owned notification ${context.manifest.runId} ${actor.role}`,
        short_content: `Owned native message ${id}`, content,
      } };
    });
    assert.equal(new Set(targets.map(target => target.id)).size, 6, 'Require six fresh distinct UUIDs');
    for (const target of targets) {
      const { response, row } = await native(target.actor, target, 'CREATE', { data: target.payload });
      verifyDto(response, target, { status: 'RECEIVED', title: target.payload.title });
      row.status = 'passed';
    }
    const six = snapshot('six-native-created-messages');
    assert.deepEqual(six.columns, baseline.columns);
    assert.equal(six.rows.length, 6);
    for (const target of targets) {
      const current = six.rows.find(row => row.ID === target.id);
      assert.ok(internalMessageOwnership(current, target));
      for (const field of ['status', 'title', 'short_content', 'content_type']) {
        assert.equal(current[field.toUpperCase()], target.payload[field]);
      }
    }
    for (const actor of actors) for (const target of targets) {
      if (actor.personId === target.actor.personId) continue;
      for (const operation of ['GET', 'UPDATE', 'REMOVE', 'MARK_READ']) {
        const event = { actor: actor.personId, target: target.actor.personId, operation,
          sameTenant: actor.source.tenant === target.actor.source.tenant, status: 'failed' };
        report.negativeMatrix.push(event);
        const data = operation === 'UPDATE' ? { id: target.id, title: `forbidden-${actor.personId}` }
          : operation === 'MARK_READ' ? { id: target.id } : undefined;
        const { response, row } = await native(actor, target, operation, { data, negative: true });
        event.requestId = row.id;
        event.dispatched = row.dispatched;
        event.httpStatus = response.status;
        const after = snapshot(`${actor.personId}-${target.id}-${operation}-denied`);
        assert.deepEqual(after, six, 'Every physical column of all six rows must survive each negative attempt');
        assert.equal(response.dispatched, true);
        assert.equal(response.error, null);
        assert.equal(response.status, 403, 'Only actual authenticated HTTP 403 proves authorization denial');
        const body = JSON.stringify(response.data);
        assert.ok(!body.includes(target.payload.content) && !body.includes(target.payload.title),
          'Denied response exposed the foreign message');
        row.status = event.status = 'passed';
      }
    }
    assert.equal(report.negativeMatrix.length, 120);
    for (const target of targets) {
      await ownerGet(target, { status: 'RECEIVED', title: target.payload.title });
      const title = `Updated owned notification ${target.id}`;
      await ownerUpdate(target, { title, short_content: 'Owner updated' },
        { TITLE: title, SHORT_CONTENT: 'Owner updated', STATUS: 'RECEIVED' });
      await ownerFetch(target, false, 'RECEIVED');
      await ownerCheck(target, 'MARK_READ', { id: target.id }, (_response, before, after) => {
        verifyOnlyOwnerChanged(before, after, target, { STATUS: 'READ' }, ['STATUS', 'UPDATE_TIME', 'UPDATE_MAN']);
      });
      await ownerGet(target, { status: 'READ', title });
      await ownerFetch(target, true, 'READ');
      await ownerUpdate(target, { status: 'RECEIVED' }, { STATUS: 'RECEIVED' });
      await ensureSession(target.actor, true);
      await ownerFetch(target, true, 'RECEIVED');
      await ownerGet(target, { status: 'RECEIVED', title });
    }
    for (const target of targets) {
      await ownerCheck(target, 'MARK_ALL_READ', {}, (_response, before, after) => {
        assert.ok(before.rows.every(row => row.STATUS === 'RECEIVED'),
          'Every mark_all_read test needs five still-unread foreign control rows');
        verifyOnlyOwnerChanged(before, after, target, { STATUS: 'READ' }, ['STATUS']);
      });
      await ensureSession(target.actor, true);
      await ownerGet(target, { status: 'READ' });
      await ownerFetch(target, true, 'READ');
      await ownerUpdate(target, { status: 'RECEIVED' }, { STATUS: 'RECEIVED' });
    }
    for (const target of targets) {
      await ownerCheck(target, 'REMOVE', undefined, (_response, before, after) => {
        assert.deepEqual(after.columns, before.columns);
        assert.deepEqual(after.physicalColumns, before.physicalColumns);
        assert.deepEqual(after.rows, before.rows.filter(row => row.ID !== target.id),
          'Native owner DELETE must physically remove only its UUID');
      });
    }
    assert.deepEqual(snapshot('native-delete-final'), baseline);
    completed = true;
  } catch (error) {
    try { report.failureBinding = failure('verification', error); }
    catch { report.unresolved.push('Private failure receipt could not be persisted'); }
    report.unresolved.push(`Bounded notification verification failed at ${report.stage}; private evidence retained`);
  } finally {
    for (const target of owned.values()) {
      const event = { id: target.id, actor: target.actor.personId, status: 'blocked' };
      report.cleanup.push(event);
      try {
        const before = snapshot(`cleanup-inspect-${target.id}`);
        const row = before.rows.find(row => row.ID === target.id);
        if (!row) { event.status = 'already-absent'; continue; }
        if (!internalMessageOwnership(row, target)) {
          event.status = 'refused-ownership-or-run-marker-drift';
          continue;
        }
        const result = await native(target.actor, target, 'REMOVE', { cleanup: true });
        const after = snapshot(`cleanup-verify-${target.id}`);
        requireSuccess(result.response);
        assert.deepEqual(after.columns, before.columns);
        assert.deepEqual(after.physicalColumns, before.physicalColumns);
        assert.deepEqual(after.rows, before.rows.filter(row => row.ID !== target.id));
        result.row.status = 'passed';
        event.status = 'native-owner-removed';
      } catch (error) {
        try { event.failureBinding = failure(`cleanup-${target.id}`, error); }
        catch { /* A failed journal cannot authorize any fallback mutation. */ }
        event.status = 'blocked-native-owner-cleanup';
      }
    }
    try {
      const final = snapshot('final-full-table');
      report.baselineRestored = !!baseline && baseline.rows.length === 0
        && JSON.stringify(final) === JSON.stringify(baseline);
      assert.equal(report.baselineRestored, true);
    } catch (error) {
      try { report.finalFailureBinding = failure('final-restoration', error); }
      catch { /* Keep the failed restoration gate even if private storage is unavailable. */ }
      report.unresolved.push('Final guarded full-column zero-row restoration failed; no SQL deletion fallback');
    }
  }
  report.actualRequests = report.requests.filter(row => row.dispatched).length;
  report.actualNegativeRequests = report.negativeMatrix.filter(row => row.dispatched).length;
  report.passedNegativeRequests = report.negativeMatrix.filter(row => row.status === 'passed').length;
  report.passedOwnerChecks = report.ownerChecks.filter(row => row.status === 'passed').length;
  report.boundedInternalMessageAcceptance = completed && report.baselineRestored
    && report.passedNegativeRequests === 120 && report.unresolved.length === 0;
  report.status = report.boundedInternalMessageAcceptance ? 'passed-bounded-native-notification-http' : 'failed';
  report.finishedAt = new Date(now()).toISOString();
  return report;
}

export async function executeOwnedInternalMessage({
  workspace = workspaceDefault, runId, deploymentInput, label, executeOwned = false,
}, { openContext = ownedNativeRuntimeContext } = {}) {
  assert.equal(executeOwned, true, 'Pass --execute-owned to enable bounded native writes');
  assert.match(runId ?? '', /^[a-f0-9]{12}$/);
  assert.match(label ?? '', /^[a-z0-9][a-z0-9-]{0,48}$/);
  assert.equal(typeof deploymentInput, 'string');
  const context = openContext({ workspace, runId, deploymentInput });
  const directories = new PinnedDirectories();
  const output = join(context.base, `internal-message-http-${label}`);
  try {
    const target = directories.open(output, { create: true, exclusive: true });
    let serial = 0;
    const record = (kind, value) => {
      assert.match(kind, /^[a-z-]+$/);
      const name = `${String(++serial).padStart(5, '0')}-${kind}.private.json`;
      const bytes = json(value);
      const identity = directories.write(target, name, bytes);
      const descriptor = fs.openSync(directories.entry(target, name), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
      try {
        const current = fs.fstatSync(descriptor);
        assert.equal(current.dev, identity.dev);
        assert.equal(current.ino, identity.ino);
        fs.fsyncSync(descriptor);
      } finally { fs.closeSync(descriptor); }
      fs.fsyncSync(target.descriptor);
      return { path: relative(workspace, join(output, name)), sha256: hash(bytes), bytes: Buffer.byteLength(bytes) };
    };
    const report = await runOwnedInternalMessage({ context, label, executeOwned, record });
    report.generator = { path: 'scripts/harness-owned-internal-message.mjs',
      sha256: hash(fs.readFileSync(fileURLToPath(import.meta.url))) };
    report.output = relative(workspace, output);
    directories.write(target, 'report.json', json(report), 0o644);
    return report;
  } finally {
    directories.close();
    context.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: {
      'execute-owned': { type: 'boolean', default: false }, 'run-id': { type: 'string' },
      'deployment-input': { type: 'string' }, label: { type: 'string' },
    }, strict: true, allowPositionals: false });
    const report = await executeOwnedInternalMessage({
      runId: values['run-id'], deploymentInput: values['deployment-input'],
      label: values.label, executeOwned: values['execute-owned'],
    });
    console.log(json({ status: report.status, output: report.output,
      actualRequests: report.actualRequests, actualNegativeRequests: report.actualNegativeRequests,
      passedNegativeRequests: report.passedNegativeRequests,
      boundedInternalMessageAcceptance: report.boundedInternalMessageAcceptance }));
    if (!report.boundedInternalMessageAcceptance) process.exitCode = 1;
  } catch {
    console.error('Owned notification harness refused or failed; private details suppressed');
    process.exitCode = 1;
  }
}
