#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  closeSync, constants, lstatSync, mkdirSync, openSync, readFileSync, writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { validateMatrixFixture } from './prepare-run-owned-native-nonadmin-matrix.mjs';
import {
  modelingContextFromIdentity, moduleRequest, request, verifyDenied, verifyModelingAppData,
  verifyRead, verifyUAAIdentity,
} from './run-owned-native-permission-http.mjs';

const workspaceRoot = fileURLToPath(new URL('../', import.meta.url));
const planContract = 'owned-authorization-grant-variants-plan-v1';
const fields = ['PSDEVSLNUSERID', 'PSDEVSLNID', 'PSDEVSLNSYSID', 'PSDEVUSEROBJID', 'ALLSYSFLAG', 'ACCMODE', 'EXPIREDTIME'];
const mutableFields = ['ACCMODE', 'EXPIREDTIME'];
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const variants = [
  { id: 'zero', accessMode: 0, expiredTime: null, read: 'deny' },
  { id: 'negative', accessMode: -1, expiredTime: null, read: 'deny' },
  { id: 'expired', accessMode: 3, expiredTime: '2000-01-01 00:00:00', read: 'deny' },
  { id: 'read-only', accessMode: 1, expiredTime: null, read: 'allow' },
];

function ownedTarget(manifest, target) {
  validateMatrixFixture(manifest);
  const root = manifest.roots.find(root => root.rootId === target.rootId);
  assert.ok(root, 'Variant must select one exact fixture root');
  const user = manifest.users.find(user => user.loginname === target.loginname);
  assert.ok(user && user.role === 'editor' && user.administrator === false);
  assert.equal(user.rootId, root.rootId);
  assert.equal(target.grantId, user.grantId);
  assert.equal(target.personId, user.personId);
  assert.equal(target.schemeId, root.schemeId);
  assert.equal(target.centerId, root.centerId);
  assert.equal(target.database, manifest.schemas.metadata);
  return { root, user };
}

function variantTarget(manifest, root) {
  const user = manifest.users.find(user => user.rootId === root.rootId && user.role === 'editor');
  return { rootId: root.rootId, loginname: user.loginname, personId: user.personId,
    centerId: user.centerId, schemeId: root.schemeId, grantId: user.grantId,
    database: manifest.schemas.metadata };
}

export function createAuthorizationVariantPlan(manifest) {
  validateMatrixFixture(manifest);
  return {
    contract: planContract, runId: manifest.runId, scenario: manifest.scenario,
    status: 'planned-not-executed', nativeAcceptance: false, permissionAcceptance: false,
    grantVariantAcceptance: false, ownership: structuredClone(manifest.ownership),
    httpBinding: {
      contract: 'owned-native-module-parent-url-v1',
      rootTransport: 'psdevslnsys-url-parent',
      applicationContextTransport: 'verified-uaa-system-and-organization',
      arbitraryHeadersAllowed: false,
    },
    cases: manifest.roots.flatMap(root => variants.map(variant => ({
      id: `${root.side}-${variant.id}`, target: variantTarget(manifest, root),
      variant: structuredClone(variant),
      operations: ['FETCH_CUR_SYS', 'GET', 'CREATE', 'UPDATE', 'REMOVE'],
      writeExpectation: 'deny',
      beforeAfterBothModelSchemasRequired: true, executionStatus: 'not-run',
      restoration: 'exact-original-grant-compare-and-set-in-finally',
    }))),
    requirements: [
      'Explicit allowOwnedGrantMutations=true; default planning performs no SQL/Docker/HTTP',
      'Live preflight must validate exact fixture, deployment, image IDs and all network peers before every operation',
      'Persist the full original grant and pending compare-and-set journal before every grant mutation',
      'Mutate ACCMODE/EXPIREDTIME only on the exact current-run editor grant; never admin/root/identity rows',
      'Distinct backend token bytes and verified UAA person/center/appdata are required after each grant change',
      'Only authenticated HTTP 403 plus unchanged full model projections proves denial',
      'Restore exact original values with a full-row compare-and-set even after a failed HTTP check',
    ],
    unverified: [
      { id: 'same-token-cache-revocation', reason: 'No reviewed cache invalidation protocol; fresh token rotation is not same-token revocation' },
      { id: 'session-holder-frames', reason: 'No native session/holder instrumentation or proven HTTP context binding' },
      { id: 'invalid-null-numeric-root', reason: 'URL parent binding cannot establish typed/null AppContext values; no headers are invented' },
      { id: 'canonical-remap-connection-rotation', reason: 'Grant rotation does not change physical schema/model-instance routing' },
      { id: 'service-oauth-alias-paths', reason: 'The module application path does not prove every service alias or OAuth path' },
    ],
  };
}

export function validateAuthorizationVariantPlan(manifest, plan) {
  assert.deepEqual(plan, createAuthorizationVariantPlan(manifest),
    'Execution accepts only the canonical plan for this exact fixture');
  return true;
}

function sqlIdentifier(value) {
  assert.match(value, /^[a-z][a-z0-9_]*$/i);
  return `\`${value}\``;
}

function sqlValue(value) {
  if (value === null) return 'NULL';
  if (typeof value === 'number') {
    assert.ok(Number.isSafeInteger(value));
    return String(value);
  }
  assert.equal(typeof value, 'string');
  assert.ok(!/[\u0000\r\n]/.test(value), 'Control characters cannot enter fixture SQL');
  return `CONVERT(0x${Buffer.from(value).toString('hex')} USING utf8mb4)`;
}

function grantTable(manifest, target) {
  ownedTarget(manifest, target);
  return `${sqlIdentifier(manifest.schemas.metadata)}.\`t_srfpsdevslnuser\``;
}

export function validateGrantSnapshot(manifest, target, snapshot, { original = false } = {}) {
  ownedTarget(manifest, target);
  assert.ok(snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot));
  assert.ok(fields.every(field => Object.hasOwn(snapshot, field)), 'All grant binding/value columns are required');
  for (const key of Object.keys(snapshot)) {
    sqlIdentifier(key);
    const value = snapshot[key];
    assert.ok(value === null || typeof value === 'string' || Number.isSafeInteger(value),
      'Grant snapshots must retain exact SQL scalar values');
  }
  assert.equal(snapshot.PSDEVSLNUSERID, target.grantId);
  assert.equal(snapshot.PSDEVSLNID, target.schemeId);
  assert.equal(snapshot.PSDEVSLNSYSID, target.rootId);
  assert.equal(snapshot.PSDEVUSEROBJID, target.personId);
  assert.equal(snapshot.ALLSYSFLAG, 0, 'Only the explicit root-specific grant may be changed');
  assert.ok(Number.isSafeInteger(snapshot.ACCMODE));
  assert.ok(snapshot.EXPIREDTIME === null
    || /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/.test(snapshot.EXPIREDTIME));
  if (original) {
    assert.equal(snapshot.ACCMODE, 3, 'Only the original owned editor grant is accepted');
    assert.equal(snapshot.EXPIREDTIME, null);
  }
  return true;
}

export function grantSelectSQL(manifest, target, columns = fields) {
  const table = grantTable(manifest, target);
  assert.ok(Array.isArray(columns) && columns.length >= fields.length);
  assert.equal(new Set(columns).size, columns.length);
  assert.ok(fields.every(field => columns.includes(field)));
  const values = columns.map(column => `${sqlValue(column)},${sqlIdentifier(column)}`).join(',');
  return `SELECT JSON_OBJECT(${values}) FROM ${table} WHERE `
    + `PSDEVSLNUSERID=${sqlValue(target.grantId)} AND PSDEVSLNID=${sqlValue(target.schemeId)} `
    + `AND PSDEVSLNSYSID=${sqlValue(target.rootId)} AND PSDEVUSEROBJID=${sqlValue(target.personId)} `
    + 'AND ALLSYSFLAG=0;\n';
}

export function grantCompareAndSetSQL(manifest, target, before, after) {
  const table = grantTable(manifest, target);
  validateGrantSnapshot(manifest, target, before);
  validateGrantSnapshot(manifest, target, after);
  assert.deepEqual(Object.keys(before).sort(), Object.keys(after).sort(), 'Do not omit original columns');
  for (const column of Object.keys(before).filter(column => !mutableFields.includes(column))) {
    assert.deepEqual(after[column], before[column], 'Only grant access mode and expiry may change');
  }
  assert.ok(mutableFields.some(column => before[column] !== after[column]), 'No-op writes are not variants');
  const conditions = Object.keys(before).sort()
    .map(column => `${sqlIdentifier(column)} <=> ${sqlValue(before[column])}`).join(' AND ');
  return `UPDATE ${table} SET ${mutableFields.map(column => `${sqlIdentifier(column)}=${sqlValue(after[column])}`).join(',')} `
    + `WHERE ${conditions} LIMIT 1;\nSELECT ROW_COUNT();\n`;
}

export function validatePhysicalProjection(manifest, snapshot, inventory) {
  validateMatrixFixture(manifest);
  assert.deepEqual(Object.keys(inventory ?? {}).sort(), manifest.roots.map(root => root.database).sort());
  assert.ok(Array.isArray(snapshot) && snapshot.length === 4,
    'Grant-only variants require the four original module/system sentinel rows');
  for (const root of manifest.roots) {
    assert.deepEqual(Object.keys(inventory[root.database]).sort(), ['t_srfpsmodule', 't_srfpssystem']);
    for (const table of ['t_srfpsmodule', 't_srfpssystem']) {
      const columns = inventory[root.database][table];
      assert.ok(Array.isArray(columns) && columns.length > 0);
      assert.equal(new Set(columns).size, columns.length);
      for (const column of columns) sqlIdentifier(column);
      const rows = snapshot.filter(item => item.database === root.database && item.table === table);
      assert.equal(rows.length, 1);
      const row = rows[0].row;
      assert.ok(row && typeof row === 'object' && !Array.isArray(row));
      assert.deepEqual(Object.keys(row).sort(), [...columns].sort(), 'Every physical column must be projected');
      assert.equal(row.PSSYSTEMID, root.logicalSystemId);
      if (table === 't_srfpsmodule') {
        assert.equal(row.PSMODULEID, root.sentinelId);
        assert.equal(row.PSMODULENAME, root.sentinelName);
        assert.equal(row.MODTAG, root.sentinelTag);
      } else {
        assert.equal(row.PSSYSTEMNAME, root.sentinelSystemName);
        assert.equal(row.PSDEVSLNSYSID, root.rootId);
        assert.equal(row.PSSYSMODELINSTID, root.modelInstanceId);
        assert.equal(row.PSDEVCENTERID, root.centerId);
        assert.equal(row.PSDEVSLNID, root.schemeId);
        assert.ok(Number.isSafeInteger(row.MODELVER) && row.MODELVER >= root.modelVersion,
          'Read-only grant variants may use a restored, monotonically advanced model version');
      }
    }
  }
  return true;
}

function tokenOf(response) {
  assert.equal(response.status, 200, 'Native login must succeed');
  assert.equal(response.error, null);
  const token = response.data?.token ?? response.data?.access_token;
  assert.ok(typeof token === 'string' && token.trim() && !/[\u0000\r\n]/.test(token));
  return token;
}

function loginCredentials(credentials, manifest, user) {
  if (Object.hasOwn(credentials, 'runId')) assert.equal(credentials.runId, manifest.runId);
  assert.deepEqual(Object.keys(credentials.users ?? {}).sort(), manifest.users.map(user => user.loginname).sort(),
    'Credentials must contain exactly the six owned fixture logins');
  assert.equal(typeof credentials.users?.[user.loginname], 'string');
  assert.ok(credentials.users[user.loginname].length > 0);
  return credentials.users[user.loginname];
}

/**
 * Candidate runner: the caller supplies a reviewed live-owned preflight, SQL and
 * full-column snapshot adapter. This module owns all HTTP paths and grant SQL.
 * Injected adapters are not independently certified as live Docker evidence.
 */
export async function executeAuthorizationVariants({
  manifest, plan, io, credentials, allowOwnedGrantMutations = false,
}) {
  validateAuthorizationVariantPlan(manifest, plan);
  assert.equal(allowOwnedGrantMutations, true, 'Owned grant mutation requires explicit opt-in');
  for (const method of ['preflight', 'readGrant', 'executeSQL', 'snapshotModels', 'persist']) {
    assert.equal(typeof io?.[method], 'function', `Reviewed owned IO requires ${method}`);
  }
  assert.ok(Array.isArray(io.grantColumns) && io.grantColumns.length >= fields.length);
  assert.equal(new Set(io.grantColumns).size, io.grantColumns.length);
  assert.ok(fields.every(field => io.grantColumns.includes(field)));
  for (const column of io.grantColumns) sqlIdentifier(column);
  assert.equal(typeof io.endpoints?.uaa, 'string');
  assert.equal(typeof io.endpoints?.backend, 'string');
  for (const origin of Object.values(io.endpoints)) {
    const url = new URL(origin);
    assert.equal(url.protocol, 'http:');
    assert.equal(url.pathname + url.search + url.hash + url.username + url.password, '/');
  }
  const send = io.request ?? request;
  const report = {
    contract: 'owned-authorization-grant-variants-adapter-run-v1', runId: manifest.runId,
    scenario: manifest.scenario, status: 'running-adapter-candidate',
    nativeAcceptance: false, permissionAcceptance: false, grantVariantAcceptance: false,
    evidenceBoundary: 'Adapter-bound observations; reviewed live ownership/source binding must be certified separately',
    sameTokenCacheRevocationVerified: false, freshTokenGrantRotationVerified: false,
    checks: [], cleanup: [], journals: [], normalLoginRenewals: [], unverified: structuredClone(plan.unverified),
  };
  const tokenHashes = new Set();
  let journalSerial = 0;
  let initialModels;
  const guarded = async operation => { await io.preflight(); return operation(); };
  const snapshotModels = async () => guarded(() => io.snapshotModels());
  const readGrant = async target => {
    const value = await guarded(() => io.readGrant(target));
    validateGrantSnapshot(manifest, target, value);
    assert.deepEqual(Object.keys(value).sort(), [...io.grantColumns].sort(),
      'Grant snapshots must include every inventoried physical column');
    return value;
  };
  const sameGrant = (actual, expected) => {
    const normalized = value => ({
      ...value, EXPIREDTIME: value.EXPIREDTIME?.replace(/\.0{1,6}$/, '') ?? null,
    });
    return isDeepStrictEqual(normalized(actual), normalized(expected));
  };
  const persist = async (kind, value) => {
    const bytes = json(value);
    const artifact = await io.persist(`${String(++journalSerial).padStart(3, '0')}-${kind}.private.json`, bytes);
    assert.ok(artifact && typeof artifact.path === 'string' && artifact.sha256 === digest(bytes),
      'The private journal must be durable and return its exact content hash before mutation');
    report.journals.push(artifact);
    return artifact;
  };
  const observe = async (id, operation, verify) => {
    const row = { id, status: 'failed', httpStatus: null };
    report.checks.push(row);
    const before = await snapshotModels();
    validatePhysicalProjection(manifest, before, io.modelColumns);
    const response = await guarded(operation);
    row.httpStatus = response.status;
    const after = await snapshotModels();
    row.snapshots = await persist('model-snapshots', { before, after });
    validatePhysicalProjection(manifest, after, io.modelColumns);
    verify(response, before, after);
    row.status = 'passed';
    return response;
  };
  const freshLogin = async (target, id) => {
    const { user } = ownedTarget(manifest, target);
    const password = loginCredentials(credentials, manifest, user);
    const login = await observe(`${id}-uaa-login`, () => send(io.endpoints.uaa, {
      method: 'POST', path: '/auths/login',
      data: { loginname: user.loginname, password, dc: user.centerId },
    }), (response, before, after) => {
      tokenOf(response);
      verifyUAAIdentity(response.data.user, user);
      assert.deepEqual(after, before);
    });
    const context = modelingContextFromIdentity(login.data.user, user);
    await observe(`${id}-uaa-self`, () => send(io.endpoints.uaa,
      { method: 'GET', path: '/auths/user-info/self' }, tokenOf(login)),
    (response, before, after) => {
      assert.equal(response.status, 200);
      assert.equal(response.error, null);
      verifyUAAIdentity(response.data, user);
      assert.deepEqual(after, before);
    });
    const backend = await observe(`${id}-backend-login`, () => send(io.endpoints.backend, {
      method: 'POST', path: '/v7/login', data: { loginname: user.loginname, password },
    }), (response, before, after) => {
      const token = tokenOf(response);
      const hash = digest(token);
      assert.ok(!tokenHashes.has(hash), 'Fresh grant checks require distinct backend token bytes, not repeated JWT login');
      tokenHashes.add(hash);
      assert.deepEqual(after, before);
    });
    const token = tokenOf(backend);
    await observe(`${id}-backend-self`, () => send(io.endpoints.backend,
      { method: 'GET', path: '/uaa/oauth/userinfo' }, token),
    (response, before, after) => {
      assert.equal(response.status, 200);
      assert.equal(response.error, null);
      assert.equal(response.data?.sub, user.loginname);
      assert.deepEqual(after, before);
    });
    await observe(`${id}-appdata`, () => send(io.endpoints.backend,
      { method: 'GET', path: '/appdata', applicationContext: context }, token),
    (response, before, after) => {
      verifyModelingAppData(response, user, context);
      assert.deepEqual(after, before);
    });
    return { token, context };
  };
  const ensureFreshSession = async (target, session, id) => {
    if (io.tokenRequiresFreshLogin === undefined) return session;
    assert.equal(typeof io.tokenRequiresFreshLogin, 'function');
    const renew = io.tokenRequiresFreshLogin(session.token);
    assert.equal(typeof renew, 'boolean');
    if (!renew) return session;
    const renewalId = `${id}-normal-relogin-${report.normalLoginRenewals.length + 1}`;
    const fresh = await freshLogin(target, renewalId);
    report.normalLoginRenewals.push({ id: renewalId, personId: target.personId });
    return fresh;
  };
  const readBack = async (target, id) => {
    const { root } = ownedTarget(manifest, target);
    let session = await freshLogin(target, id);
    for (const operation of ['GET', 'FETCH_CUR_SYS']) {
      session = await ensureFreshSession(target, session, `${id}-${operation}`);
      await observe(`${id}-${operation}`, () => send(io.endpoints.backend, {
        ...moduleRequest(root, operation, root.sentinelId), applicationContext: session.context,
      }, session.token), (response, before, after) => {
        verifyRead(response, root, operation);
        assert.deepEqual(after, before);
      });
    }
    return session;
  };
  try {
    initialModels = await snapshotModels();
    await persist('initial-models', initialModels);
    validatePhysicalProjection(manifest, initialModels, io.modelColumns);
    for (const item of plan.cases) {
      const { root } = ownedTarget(manifest, item.target);
      const original = await readGrant(item.target);
      validateGrantSnapshot(manifest, item.target, original, { original: true });
      await persist('original-grant', { caseId: item.id, target: item.target, original });
      await readBack(item.target, `${item.id}-before`);
      let changed = { ...original, ACCMODE: item.variant.accessMode, EXPIREDTIME: item.variant.expiredTime };
      const updateSQL = grantCompareAndSetSQL(manifest, item.target, original, changed);
      const restoreSQL = grantCompareAndSetSQL(manifest, item.target, changed, original);
      const cleanup = { caseId: item.id, grantId: item.target.grantId, status: 'not-needed' };
      report.cleanup.push(cleanup);
      try {
        await persist('pending-grant-update', {
          caseId: item.id, target: item.target, original, intended: changed, updateSQL, restoreSQL,
        });
        cleanup.status = 'restore-required';
        const affected = await guarded(() => io.executeSQL(updateSQL));
        assert.equal(affected, 1, 'The exact grant compare-and-set must affect exactly one row');
        const actual = await readGrant(item.target);
        assert.ok(sameGrant(actual, changed), 'Grant update must preserve every non-mutable column');
        changed = actual;
        let session = await freshLogin(item.target, `${item.id}-changed`);
        for (const operation of item.operations) {
          session = await ensureFreshSession(item.target, session, `${item.id}-${operation}`);
          const data = {
            psmoduleid: operation === 'CREATE' ? `nf_${manifest.runId}_denied_${root.side}` : root.sentinelId,
            pssystemid: root.logicalSystemId, codename: 'DeniedGrantVariant',
            psmodulename: `Denied grant variant ${item.id}`, modtag: `nf_${manifest.runId}_denied`,
          };
          await observe(`${item.id}-${operation}`, () => send(io.endpoints.backend, {
            ...moduleRequest(root, operation, root.sentinelId, data), applicationContext: session.context,
          }, session.token), (response, before, after) => {
            if (['GET', 'FETCH_CUR_SYS'].includes(operation) && item.variant.read === 'allow') {
              verifyRead(response, root, operation);
              assert.deepEqual(after, before);
            } else verifyDenied(response, before, after, manifest.roots);
          });
        }
        const foreign = manifest.roots.find(row => row.rootId !== root.rootId);
        session = await ensureFreshSession(item.target, session, `${item.id}-foreign-root`);
        await observe(`${item.id}-foreign-root`, () => send(io.endpoints.backend, {
          ...moduleRequest(foreign, 'GET', foreign.sentinelId), applicationContext: session.context,
        }, session.token), (response, before, after) => verifyDenied(response, before, after, manifest.roots));
      } finally {
        if (cleanup.status === 'restore-required') {
          try {
            const current = await readGrant(item.target);
            if (isDeepStrictEqual(current, original)) cleanup.status = 'already-original';
            else {
              assert.ok(sameGrant(current, changed), 'Concurrent/unrecognized grant edits are not overwritten');
              const exactRestoreSQL = grantCompareAndSetSQL(manifest, item.target, current, original);
              await persist('pending-grant-restore', { caseId: item.id, current, original, restoreSQL: exactRestoreSQL });
              assert.equal(await guarded(() => io.executeSQL(exactRestoreSQL)), 1);
              assert.deepEqual(await readGrant(item.target), original);
              cleanup.status = 'restored-exact-original';
            }
          } catch {
            cleanup.status = 'blocked-exact-restore';
          }
        }
      }
      assert.ok(['restored-exact-original', 'already-original'].includes(cleanup.status),
        'Unrestored grant blocks all further cases');
      await readBack(item.target, `${item.id}-restored`);
    }
    report.freshTokenGrantRotationVerified = true;
    report.status = 'passed-adapter-candidate-observations';
  } catch {
    report.status = 'failed-adapter-candidate';
    report.unverified.push({ id: 'first-failure', reason: 'Inspect failed check and private journals; diagnostic values are intentionally suppressed' });
  }
  try {
    const final = await snapshotModels();
    await persist('final-models', final);
    validatePhysicalProjection(manifest, final, io.modelColumns);
    assert.ok(initialModels);
    assert.deepEqual(final, initialModels, 'All physical model columns must remain unchanged');
    assert.ok(report.cleanup.every(row => ['restored-exact-original', 'already-original'].includes(row.status)));
  } catch {
    report.status = 'failed-adapter-candidate';
    report.freshTokenGrantRotationVerified = false;
    report.unverified.push({ id: 'final-restoration', reason: 'Exact grant/model restoration or live ownership check failed' });
  }
  if (report.status !== 'passed-adapter-candidate-observations') report.freshTokenGrantRotationVerified = false;
  await persist('report', report);
  return report;
}

function writePrivate(path, bytes) {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, bytes); } finally { closeSync(fd); }
}

export function main(argv = process.argv.slice(2), workspace = workspaceRoot) {
  const options = {};
  for (const arg of argv) {
    const match = /^--(run-id|output)=(.+)$/.exec(arg);
    assert.ok(match && !Object.hasOwn(options, match[1]), 'Only explicit non-duplicate planning options are supported');
    options[match[1]] = match[2];
  }
  assert.match(options['run-id'], /^[a-f0-9]{12}$/);
  const base = join(resolve(workspace), '.artifacts', 'native-nonadmin-fixtures', options['run-id']);
  const output = resolve(options.output ?? join(base, 'authorization-variants-plan'));
  const child = relative(base, output);
  assert.ok(child && !child.startsWith('..') && !child.includes('/'),
    'Plan output must be a new immediate child of this owned run');
  for (let path = base; path !== dirname(path); path = dirname(path)) {
    const stat = lstatSync(path);
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), 'Owned fixture ancestors cannot be symlinks');
  }
  const input = join(base, 'manifest.json');
  assert.ok(lstatSync(input).isFile() && !lstatSync(input).isSymbolicLink());
  const bytes = readFileSync(input);
  const manifest = JSON.parse(bytes);
  assert.equal(manifest.runId, options['run-id']);
  const plan = createAuthorizationVariantPlan(manifest);
  mkdirSync(output, { mode: 0o700 });
  writePrivate(join(output, 'plan.json'), json(plan));
  writePrivate(join(output, 'inputs.json'), json({ manifest: { path: input, sha256: digest(bytes) } }));
  return { output, cases: plan.cases.length, status: plan.status };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { console.log(json(main())); } catch {
    console.error('Owned authorization planning failed; no SQL, Docker or HTTP execution is supported by the planning CLI.');
    process.exitCode = 1;
  }
}
