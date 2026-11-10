import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createFixture } from '../prepare-run-owned-native-nonadmin-fixture.mjs';
import {
  createAuthorizationVariantPlan, executeAuthorizationVariants, grantCompareAndSetSQL,
  grantSelectSQL, main, validateAuthorizationVariantPlan, validateGrantSnapshot, validatePhysicalProjection,
} from '../owned-authorization-variants.mjs';

const runId = 'abcdef135790';
const { manifest, credentials } = createFixture({
  runId, scenario: 'two-center', passwordStorageMode: 'sm3', modelVersion: 816,
  uaaSchemaMode: 'legacy-views', secret: () => 'a'.repeat(36),
});
const plan = createAuthorizationVariantPlan(manifest);
const target = plan.cases[0].target;
const digest = value => createHash('sha256').update(value).digest('hex');
const copy = value => structuredClone(value);

function originalGrant(selected = target) {
  return {
    PSDEVSLNUSERID: selected.grantId, PSDEVSLNID: selected.schemeId,
    PSDEVSLNSYSID: selected.rootId, PSDEVUSEROBJID: selected.personId,
    ALLSYSFLAG: 0, ACCMODE: 3, EXPIREDTIME: null, PSDEVSLNUSERNAME: selected.loginname,
  };
}

function fixtureProjection() {
  return manifest.roots.flatMap(root => [
    { database: root.database, table: 't_srfpsmodule', row: {
      PSMODULEID: root.sentinelId, PSSYSTEMID: root.logicalSystemId,
      PSMODULENAME: root.sentinelName, MODTAG: root.sentinelTag, CODENAME: 'NativeFixture',
    } },
    { database: root.database, table: 't_srfpssystem', row: {
      PSSYSTEMID: root.logicalSystemId, PSSYSTEMNAME: root.sentinelSystemName,
      PSDEVSLNSYSID: root.rootId, PSSYSMODELINSTID: root.modelInstanceId,
      PSDEVCENTERID: root.centerId, PSDEVSLNID: root.schemeId, MODELVER: 819,
    } },
  ]);
}

function fixtureInventory(projection = fixtureProjection()) {
  return Object.fromEntries(manifest.roots.map(root => [root.database,
    Object.fromEntries(projection.filter(item => item.database === root.database)
      .map(item => [item.table, Object.keys(item.row)]))]));
}

function identity(user) {
  return {
    id: user.personId, dc: user.centerId, organization_id: `${user.centerId}_org`,
    adminmode: 0, grants: [{
      system_id: 'ibizmodeling', deploy_system_id: `${user.centerId}_deploy`,
      roles: [{ authority: 'ROLE_NATIVE_FIXTURE', role_id: `${user.centerId}_ordinary_role` }],
    }],
  };
}

function fakeIO(options = {}) {
  const grants = new Map(plan.cases.map(item => [item.target.grantId, originalGrant(item.target)]));
  const originals = copy([...grants]);
  const records = [];
  const sqlCalls = [];
  const httpCalls = [];
  const pending = new Map();
  const tokens = new Map();
  const projection = fixtureProjection();
  let tokenSerial = 0;
  let preflights = 0;
  let casSerial = 0;
  const result = data => ({ status: 200, error: null, data });
  const io = {
    endpoints: { uaa: 'http://127.0.0.1:32666', backend: 'http://127.0.0.1:30086' },
    grantColumns: Object.keys(originalGrant()), modelColumns: fixtureInventory(projection),
    async preflight() {
      preflights++;
      if (options.failPreflight?.(preflights)) throw new Error('owned topology drift');
    },
    async readGrant(selected) {
      if (options.unknownGrant && casSerial > 0) {
        return { ...copy(grants.get(selected.grantId)), PSDEVSLNUSERNAME: 'changed-outside-runner' };
      }
      return copy(grants.get(selected.grantId));
    },
    async executeSQL(sql) {
      sqlCalls.push(sql);
      casSerial++;
      const change = pending.get(sql);
      assert.ok(change, 'SQL must be journaled before mutation');
      const current = grants.get(change.target.grantId);
      assert.deepEqual(current, change.before);
      if (options.casReturnsZero && casSerial === 1) return 0;
      grants.set(change.target.grantId, copy(change.after));
      if (options.throwAfterUpdate && casSerial === 1) throw new Error('connection lost after commit');
      return 1;
    },
    async snapshotModels() { return copy(projection); },
    async persist(path, bytes) {
      if (options.failPendingJournal && path.includes('pending-grant-update')) throw new Error('disk full');
      const value = JSON.parse(bytes);
      records.push({ path, value });
      if (path.includes('pending-grant-update')) {
        pending.set(value.updateSQL, { target: value.target, before: value.original, after: value.intended });
        pending.set(value.restoreSQL, { target: value.target, before: value.intended, after: value.original });
      } else if (path.includes('pending-grant-restore')) {
        const selected = plan.cases.find(item => item.id === value.caseId).target;
        pending.set(value.restoreSQL, { target: selected, before: value.current, after: value.original });
      }
      if (options.badJournalHash) return { path, sha256: '0'.repeat(64) };
      return { path, sha256: digest(bytes) };
    },
    async request(origin, spec, token) {
      httpCalls.push({ origin, spec: copy(spec), tokenHash: token ? digest(token) : null });
      if (spec.path === '/auths/login' || spec.path === '/v7/login') {
        const user = manifest.users.find(user => user.loginname === spec.data.loginname);
        assert.ok(user && spec.data.password === credentials.users[user.loginname]);
        const next = options.sameBackendToken && spec.path === '/v7/login'
          ? 'same-backend-token' : `test-token-${++tokenSerial}`;
        tokens.set(next, user);
        return result({ token: next, user: identity(user) });
      }
      const user = tokens.get(token);
      assert.ok(user);
      if (spec.path === '/auths/user-info/self') return result(identity(user));
      if (spec.path === '/uaa/oauth/userinfo') return result({ sub: user.loginname });
      if (spec.path === '/appdata') return result({ context: {
        srfsystemid: 'ibizmodeling', srforgid: `${user.centerId}_org`,
        srfuserid: user.personId, srfpersonid: user.personId, srfdcid: user.centerId,
      } });
      const root = manifest.roots.find(root => spec.path.includes(`/psdevslnsys/${root.rootId}/`));
      assert.ok(root, 'Only the actual parent-URL root binding is used');
      assert.deepEqual(spec.applicationContext, { system: 'ibizmodeling', organization: `${user.centerId}_org` });
      assert.ok(!Object.hasOwn(spec, 'headers'), 'No synthetic grant/root/security headers');
      const grant = grants.get(user.grantId);
      const allow = user.rootId === root.rootId && grant.ACCMODE >= 0 && (grant.ACCMODE & 1) === 1
        && grant.EXPIREDTIME === null && (spec.method === 'GET' || spec.path.endsWith('/fetchcursys'));
      if (!allow) {
        if (options.deniedStatus) return { status: options.deniedStatus, error: null, data: { message: 'Not authorized' } };
        if (options.mutateOnDeny) projection[0].row.MODTAG = 'unexpected-side-effect';
        return { status: 403, error: null, data: { message: 'Not authorized' } };
      }
      const row = {
        psmoduleid: root.sentinelId, pssystemid: root.logicalSystemId,
        psmodulename: root.sentinelName, pssystemname: root.sentinelSystemName,
      };
      return result(spec.path.endsWith('/fetchcursys') ? [row] : row);
    },
  };
  return { io, grants, originals, records, sqlCalls, httpCalls, preflights: () => preflights };
}

function execute(io, extra = {}) {
  return executeAuthorizationVariants({
    manifest: copy(manifest), plan: copy(plan), credentials: copy(credentials),
    allowOwnedGrantMutations: true, io, ...extra,
  });
}

test('canonical plans bind eight variants to the two exact nonadmin editor grants', () => {
  assert.equal(plan.cases.length, 8);
  assert.deepEqual(plan.cases.map(item => item.id), [
    'a-zero', 'a-negative', 'a-expired', 'a-read-only',
    'b-zero', 'b-negative', 'b-expired', 'b-read-only',
  ]);
  assert.equal(new Set(plan.cases.map(item => item.target.grantId)).size, 2);
  assert.ok(plan.cases.every(item => item.target.database === `nf_${runId}_meta`));
  assert.equal(plan.httpBinding.arbitraryHeadersAllowed, false);
  assert.equal(plan.grantVariantAcceptance, false);
  assert.ok(plan.unverified.some(item => item.id === 'same-token-cache-revocation'));
  assert.ok(plan.unverified.some(item => item.id === 'session-holder-frames'));
  assert.equal(validateAuthorizationVariantPlan(manifest, copy(plan)), true);
});

test('root, actor, grant and transport changes cannot be inserted into a canonical plan', () => {
  for (const mutate of [
    value => { value.runId = '111111111111'; },
    value => { value.cases[0].target.rootId = manifest.roots[1].rootId; },
    value => { value.cases[0].target.loginname = manifest.users.find(user => user.role === 'no-access').loginname; },
    value => { value.cases[0].target.personId = 'admin'; },
    value => { value.cases[0].target.database = 'shared'; },
    value => { value.cases[0].target.grantId = `${target.grantId}_foreign`; },
    value => { value.httpBinding.rootTransport = 'x-app-context-header'; },
    value => { value.cases[0].variant.accessMode = 19; },
    value => { value.unverified = []; },
  ]) {
    const changed = copy(plan);
    mutate(changed);
    assert.throws(() => validateAuthorizationVariantPlan(manifest, changed));
  }
});

test('grant select SQL cannot select a different actor, root, schema or inherited all-system grant', () => {
  const sql = grantSelectSQL(manifest, target, Object.keys(originalGrant()));
  assert.match(sql, new RegExp(`FROM \`nf_${runId}_meta\`\\.\`t_srfpsdevslnuser\``));
  assert.ok(sql.includes('AND ALLSYSFLAG=0'));
  assert.ok(!sql.includes('UPDATE'));
  for (const changed of [
    { ...target, database: 'mysql' }, { ...target, rootId: manifest.roots[1].rootId },
    { ...target, personId: 'administrator' }, { ...target, grantId: 'foreign' },
    { ...target, loginname: manifest.users.find(user => user.role === 'viewer').loginname },
  ]) assert.throws(() => grantSelectSQL(manifest, changed));
  assert.throws(() => grantSelectSQL(manifest, target, ['ACCMODE']));
  assert.throws(() => grantSelectSQL(manifest, target, [...Object.keys(originalGrant()), 'A;DELETE']));
});

test('full-row grant compare-and-set mutates only access and expiry and is exactly reversible', () => {
  const original = originalGrant();
  const changed = { ...original, ACCMODE: -1, EXPIREDTIME: '2000-01-01 00:00:00' };
  const sql = grantCompareAndSetSQL(manifest, target, original, changed);
  assert.match(sql, /SET `ACCMODE`=-1,`EXPIREDTIME`=CONVERT\(0x/);
  assert.match(sql, /`ACCMODE` <=> 3/);
  assert.match(sql, /`EXPIREDTIME` <=> NULL/);
  assert.match(sql, /`PSDEVSLNUSERNAME` <=> CONVERT\(0x/);
  assert.match(sql, /LIMIT 1;\nSELECT ROW_COUNT\(\);\n$/);
  const restore = grantCompareAndSetSQL(manifest, target, changed, original);
  assert.match(restore, /SET `ACCMODE`=3,`EXPIREDTIME`=NULL/);
  assert.match(restore, /`ACCMODE` <=> -1/);
  assert.throws(() => grantCompareAndSetSQL(manifest, target, original, { ...changed, PSDEVSLNSYSID: 'foreign' }));
  assert.throws(() => grantCompareAndSetSQL(manifest, target, original, { ...changed, PSDEVSLNUSERNAME: 'administrator' }));
  assert.throws(() => grantCompareAndSetSQL(manifest, target, original, original));
});

test('original grant validation rejects absent, inherited, downgraded or expired original grants', () => {
  assert.equal(validateGrantSnapshot(manifest, target, originalGrant(), { original: true }), true);
  for (const change of [
    { ACCMODE: 0 }, { ACCMODE: -1 }, { ACCMODE: 19 }, { ACCMODE: '3' },
    { ALLSYSFLAG: 1 }, { EXPIREDTIME: '2000-01-01 00:00:00' },
    { EXPIREDTIME: 'yesterday' }, { PSDEVUSEROBJID: 'administrator' },
  ]) {
    assert.throws(() => validateGrantSnapshot(manifest, target, { ...originalGrant(), ...change }, { original: true }));
  }
});

test('full physical projection inventory permits monotonic baseline versions but not missing columns or rows', () => {
  const baseline = fixtureProjection();
  assert.equal(validatePhysicalProjection(manifest, baseline, fixtureInventory()), true);
  for (const mutate of [
    rows => { rows.pop(); }, rows => { delete rows[0].row.CODENAME; },
    rows => { rows[0].database = 'shared'; }, rows => { rows[1].row.MODELVER = 815; },
    rows => { rows[1].row.PSDEVSLNSYSID = manifest.roots[1].rootId; },
    rows => { rows[0].row.MODTAG = 'not-restored'; },
  ]) {
    const changed = copy(baseline);
    mutate(changed);
    assert.throws(() => validatePhysicalProjection(manifest, changed, fixtureInventory()));
  }
});

test('explicit mutation opt-in and complete reviewed IO are mandatory before any command', async () => {
  const state = fakeIO();
  await assert.rejects(execute(state.io, { allowOwnedGrantMutations: false }));
  assert.equal(state.preflights(), 0);
  assert.equal(state.sqlCalls.length, 0);
  await assert.rejects(execute({ ...state.io, preflight: undefined }));
  await assert.rejects(execute({ ...state.io, grantColumns: ['ACCMODE'] }));
  await assert.rejects(execute({ ...state.io, endpoints: { uaa: 'https://foreign/', backend: 'http://127.0.0.1:30086' } }));
});

test('eight cases execute proven HTTP protocol, rotate distinct tokens and restore both exact original grants', async () => {
  const state = fakeIO();
  const report = await execute(state.io);
  assert.equal(report.status, 'passed-adapter-candidate-observations');
  assert.equal(report.checks.length, 200);
  assert.ok(report.checks.every(row => row.status === 'passed'));
  assert.equal(report.freshTokenGrantRotationVerified, true);
  assert.equal(report.sameTokenCacheRevocationVerified, false);
  assert.equal(report.grantVariantAcceptance, false);
  assert.equal(report.nativeAcceptance, false);
  assert.equal(report.permissionAcceptance, false);
  assert.equal(report.cleanup.length, 8);
  assert.ok(report.cleanup.every(row => row.status === 'restored-exact-original'));
  assert.equal(state.sqlCalls.length, 16);
  assert.deepEqual([...state.grants], state.originals);
  assert.ok(state.preflights() > report.checks.length * 3);
  const denied = report.checks.filter(row => row.httpStatus === 403);
  assert.equal(denied.length, 44);
  assert.equal(state.records.filter(row => row.path.includes('pending-grant-update')).length, 8);
  assert.equal(state.records.filter(row => row.path.includes('pending-grant-restore')).length, 8);
  assert.ok(state.httpCalls.every(row => !Object.hasOwn(row.spec, 'headers')));
  assert.ok(!JSON.stringify(report).includes('test-token-'));
  assert.ok(!JSON.stringify(report).includes(credentials.users[target.loginname]));
});

test('fresh-login returning the same cached backend token fails closed and restores the changed grant', async () => {
  const state = fakeIO({ sameBackendToken: true });
  const report = await execute(state.io);
  assert.equal(report.status, 'failed-adapter-candidate');
  assert.equal(report.freshTokenGrantRotationVerified, false);
  assert.ok(report.checks.some(row => row.id === 'a-zero-changed-backend-login' && row.status === 'failed'));
  assert.equal(report.cleanup[0].status, 'restored-exact-original');
  assert.deepEqual([...state.grants], state.originals);
});

test('normal login renewal remains explicit in check receipts without changing token validity', async () => {
  const state = fakeIO();
  let checks = 0;
  state.io.tokenRequiresFreshLogin = () => ++checks === 1;
  const report = await execute(state.io);
  assert.equal(report.status, 'passed-adapter-candidate-observations');
  assert.equal(report.checks.length, 205);
  assert.equal(report.normalLoginRenewals.length, 1);
  assert.equal(report.normalLoginRenewals[0].personId, target.personId);
  assert.ok(report.checks.some(row => row.id.includes('normal-relogin-1-backend-login')));
  assert.deepEqual([...state.grants], state.originals);
});

test('connection failure after grant commit still uses journaled exact restore', async () => {
  const state = fakeIO({ throwAfterUpdate: true });
  const report = await execute(state.io);
  assert.equal(report.status, 'failed-adapter-candidate');
  assert.equal(report.cleanup[0].status, 'restored-exact-original');
  assert.equal(state.sqlCalls.length, 2);
  assert.deepEqual([...state.grants], state.originals);
});

test('zero-row grant CAS fails closed without performing a blind restore', async () => {
  const state = fakeIO({ casReturnsZero: true });
  const report = await execute(state.io);
  assert.equal(report.status, 'failed-adapter-candidate');
  assert.equal(report.cleanup[0].status, 'already-original');
  assert.equal(state.sqlCalls.length, 1);
  assert.deepEqual([...state.grants], state.originals);
});

test('failed journal write prevents grant updates', async () => {
  const state = fakeIO({ failPendingJournal: true });
  const report = await execute(state.io);
  assert.equal(report.status, 'failed-adapter-candidate');
  assert.equal(state.sqlCalls.length, 0);
  assert.deepEqual([...state.grants], state.originals);
});

test('incorrect journal content hash prevents every grant mutation', async () => {
  const state = fakeIO({ badJournalHash: true });
  await assert.rejects(execute(state.io));
  assert.equal(state.sqlCalls.length, 0);
});

test('unexpected concurrent edits are retained and marked blocked instead of overwritten', async () => {
  const state = fakeIO({ unknownGrant: true });
  const report = await execute(state.io);
  assert.equal(report.status, 'failed-adapter-candidate');
  assert.equal(report.cleanup[0].status, 'blocked-exact-restore');
  assert.equal(state.sqlCalls.length, 1);
  assert.ok(report.unverified.some(row => row.id === 'final-restoration'));
  assert.ok(state.records.some(row => row.path.includes('pending-grant-update')));
});

test('401, 404, 500 and empty-route errors never become authorization PASS', async () => {
  for (const status of [401, 404, 500]) {
    const state = fakeIO({ deniedStatus: status });
    const report = await execute(state.io);
    assert.equal(report.status, 'failed-adapter-candidate');
    assert.equal(report.cleanup[0].status, 'restored-exact-original');
    assert.deepEqual([...state.grants], state.originals);
  }
});

test('denied-request physical mutation fails and is never repaired with arbitrary model SQL', async () => {
  const state = fakeIO({ mutateOnDeny: true });
  const report = await execute(state.io);
  assert.equal(report.status, 'failed-adapter-candidate');
  assert.equal(report.cleanup[0].status, 'restored-exact-original');
  assert.ok(state.sqlCalls.every(sql => sql.startsWith(`UPDATE \`nf_${runId}_meta\`.\`t_srfpsdevslnuser\``)));
  assert.equal(report.freshTokenGrantRotationVerified, false);
});

test('unknown root header plans and incomplete snapshot inventories never reach grant mutation', async () => {
  const state = fakeIO();
  const changed = copy(plan);
  changed.httpBinding.rootTransport = 'X-AppContext';
  await assert.rejects(execute(state.io, { plan: changed }));
  const report = await execute({ ...state.io, modelColumns: {} });
  assert.equal(report.status, 'failed-adapter-candidate');
  assert.equal(state.sqlCalls.length, 0);
});

test('planning CLI writes exclusive private artifacts and refuses execution/mutation flags', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'owned-authorization-plan-'));
  try {
    const base = join(workspace, '.artifacts', 'native-nonadmin-fixtures', runId);
    mkdirSync(base, { recursive: true });
    writeFileSync(join(base, 'manifest.json'), JSON.stringify(manifest));
    const result = main([`--run-id=${runId}`], workspace);
    assert.equal(result.status, 'planned-not-executed');
    assert.equal(result.cases, 8);
    assert.deepEqual(JSON.parse(readFileSync(join(result.output, 'plan.json'))), plan);
    assert.equal(statSync(join(result.output, 'plan.json')).mode & 0o077, 0);
    assert.throws(() => main([`--run-id=${runId}`], workspace));
    assert.throws(() => main([`--run-id=${runId}`, '--execute-owned-grant-variants'], workspace));
    assert.throws(() => main([`--run-id=${runId}`, '--allow-owned-grant-mutations'], workspace));
    assert.throws(() => main([`--run-id=${runId}`, `--output=${join(workspace, 'outside')}`], workspace));
    assert.throws(() => main([`--run-id=${runId}`, `--output=${join(base, 'nested', 'plan')}`], workspace));
  } finally { rmSync(workspace, { recursive: true, force: true }); }
});

test('planning CLI rejects manifest/fixture symlinks and foreign run manifests', () => {
  const workspace = mkdtempSync(join(tmpdir(), 'owned-authorization-links-'));
  try {
    const base = join(workspace, '.artifacts', 'native-nonadmin-fixtures', runId);
    mkdirSync(base, { recursive: true });
    const outside = join(workspace, 'outside.json');
    writeFileSync(outside, JSON.stringify(manifest));
    symlinkSync(outside, join(base, 'manifest.json'));
    assert.throws(() => main([`--run-id=${runId}`], workspace));
    rmSync(join(base, 'manifest.json'));
    writeFileSync(join(base, 'manifest.json'), JSON.stringify({ ...manifest, runId: '111111111111' }));
    assert.throws(() => main([`--run-id=${runId}`], workspace));
  } finally { rmSync(workspace, { recursive: true, force: true }); }
});
