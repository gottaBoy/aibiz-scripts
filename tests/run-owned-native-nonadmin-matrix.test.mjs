import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { createFixture } from '../prepare-run-owned-native-nonadmin-fixture.mjs';
import {
  createNativeMatrix, main, snapshotSQL, validateMatrixFixture, writeNativeMatrix,
} from '../prepare-run-owned-native-nonadmin-matrix.mjs';

const runId = 'f01006abcdef';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const fixture = scenario => createFixture({
  runId, scenario, passwordStorageMode: 'sm3', modelVersion: 816,
  uaaSchemaMode: 'legacy-views', secret: () => '1'.repeat(36),
});
const toolPaths = [
  'scripts/prepare-run-owned-native-nonadmin-fixture.mjs',
  'scripts/tests/run-owned-native-nonadmin-fixture.sql.mjs',
  'scripts/tests/run-owned-native-nonadmin-fixture.test.mjs',
];

test('same-center and two-center role/root matrices contain all 60 cases with 14 allows and 46 denials', () => {
  for (const scenario of ['same-center', 'two-center']) {
    const { manifest } = fixture(scenario);
    const matrix = createNativeMatrix(manifest);
    assert.deepEqual(matrix.caseCounts, {
      authentication: 30, roleRoot: 60, roleRootAllow: 14, roleRootDeny: 46,
      invalidRoot: 84, forgedSystem: 4,
    });
    assert.equal(new Set(matrix.roleRootCases.map(row => row.id)).size, 60);
    for (const user of manifest.users) {
      const cases = matrix.roleRootCases.filter(row => row.principal.loginname === user.loginname);
      assert.equal(cases.length, 10);
      for (const row of cases) {
        const own = user.rootId === row.target.rootId;
        const allowed = own && (user.role === 'editor' || (user.role === 'viewer' && row.accessAction === 'READ'));
        assert.equal(row.expected.authorization, allowed ? 'allow' : 'deny');
        assert.equal(row.expected.physicalMutation,
          allowed && row.accessAction !== 'READ' ? 'target-schema-only' : 'neither-schema');
        assert.equal(row.bothDatabaseProjectionsRequired, true);
        assert.equal(row.executionStatus, 'not-run');
        assert.equal(row.httpBindingVerified, false);
      }
    }
    assert.equal(matrix.status, 'planned-not-executed');
    assert.equal(matrix.nativeAcceptance, false);
    assert.equal(matrix.permissionAcceptance, false);
    assert.equal(matrix.sourceNativeAcceptance, false);
  }
});

test('no-access can authenticate; both UAA dc-qualified and backend bare-name protocol cases are explicit', () => {
  const { manifest } = fixture('two-center');
  const matrix = createNativeMatrix(manifest);
  for (const user of manifest.users) {
    const cases = matrix.authenticationCases.filter(row => row.principal.loginname === user.loginname);
    assert.equal(cases.length, 5);
    const login = cases.find(row => row.id.endsWith('-uaa-login'));
    assert.equal(login.expected, 'authenticated-nonadmin');
    assert.deepEqual(login.fields, ['loginname', 'password', 'dc']);
    const backend = cases.find(row => row.id.endsWith('-backend-login'));
    assert.deepEqual(backend.fields, ['loginname', 'password']);
    assert.notEqual(cases.find(row => row.id.endsWith('-uaa-wrong-dc')).foreignDc, user.centerId);
  }
  const secret = fixture('two-center').credentials.users[manifest.users[0].loginname];
  assert.ok(!JSON.stringify(matrix).includes(secret));
});

test('same logical/record IDs retain distinct physical sentinels and successful deletes use case-owned rows', () => {
  const { manifest } = fixture('two-center');
  const matrix = createNativeMatrix(manifest);
  for (const root of manifest.roots) {
    const reads = matrix.roleRootCases.filter(row =>
      row.target.rootId === root.rootId && row.expected.readSentinel);
    assert.equal(reads.length, 4);
    for (const row of reads) assert.deepEqual(row.expected.readSentinel, {
      psmoduleid: root.sentinelId, pssystemid: root.logicalSystemId,
      psmodulename: root.sentinelName, pssystemname: root.sentinelSystemName,
    });
  }
  for (const row of matrix.roleRootCases.filter(row => row.operation === 'REMOVE')) {
    if (row.expected.authorization === 'allow') {
      assert.equal(row.removeSetup, 'create-case-owned-probe-with-same-editor');
      assert.equal(row.requestRecordId, row.createRecordId);
      assert.notEqual(row.requestRecordId, manifest.roots[0].sentinelId);
    } else assert.equal(row.requestRecordId, manifest.roots[0].sentinelId);
  }
});

test('invalid root variants require denial/non-mutation while forged system respects canonical rewrite', () => {
  const matrix = createNativeMatrix(fixture('two-center').manifest);
  assert.equal(new Set(matrix.invalidRootCases.map(row => row.id)).size, 84);
  for (const row of matrix.invalidRootCases) {
    assert.equal(row.expected.physicalMutation, 'neither-schema');
    assert.equal(row.expected.authorization, 'deny-or-bounded-input-rejection');
    if (row.rootKind === 'absent') assert.deepEqual(row.appContext, {});
  }
  for (const row of matrix.forgedSystemCases) {
    assert.notEqual(row.submittedSystemId, row.expected.canonicalSystemId);
    assert.equal(row.expected.policy, 'canonical-system-rewrite-after-root-authorization');
    assert.equal(row.executionStatus, 'not-run');
  }
  for (const id of ['actual-uaa', 'application-db-users', 'complete-native-schema', 'uaa-token-store',
    'zero-negative-expired-grants', 'session-holder-frames', 'canonical-remap-cache-rotation']) {
    assert.ok(matrix.blockedRequirements.some(row => row.id === id));
  }
  assert.ok(matrix.acceptanceRequirements.some(value => value.includes('404/500/network')));
});

test('matrix fails closed for foreign schemas, elevated/misjoined users, changed root mapping or promoted claims', () => {
  for (const mutate of [
    m => { m.schemas.modelA = 'shared'; },
    m => { m.roots[0].database = m.roots[1].database; },
    m => { m.roots[0].centerId = m.roots[1].centerId; },
    m => { m.roots[0].jdbcUrl = 'jdbc:mysql://mysql/shared'; },
    m => { m.roots[0].logicalSystemId = 'foreign'; },
    m => { m.users[0].administrator = true; },
    m => { m.users[0].accessMode = 7; },
    m => { m.users[0].personId = m.users[1].personId; },
    m => { m.users[2].grantId = 'inherited'; },
    m => { m.nativeAcceptance = true; },
    m => { m.sourceNativeAcceptance = true; },
    m => { m.expected.explicitZeroNegativeExpiredGrantCoverage = true; },
  ]) {
    const m = fixture('two-center').manifest;
    mutate(m);
    assert.throws(() => validateMatrixFixture(m));
  }
});

test('snapshot captures every ordered module/system row in both owned schemas, without credentials or DML', () => {
  const { manifest } = fixture('two-center');
  const sql = snapshotSQL(manifest);
  assert.equal(sql.split('\n').filter(line => line.startsWith('SELECT')).length, 4);
  for (const root of manifest.roots) {
    assert.ok(sql.includes(`\`${root.database}\`.t_srfpsmodule ORDER BY PSMODULEID`));
    assert.ok(sql.includes(`\`${root.database}\`.t_srfpssystem ORDER BY PSSYSTEMID`));
  }
  assert.doesNotMatch(sql, /USER_PASSWORD|PASSWD|CONNSTR|INSERT|UPDATE|DELETE|DROP|GRANT|CREATE/);
});

function temporaryRun(t) {
  const workspace = mkdtempSync(join(tmpdir(), 'native-matrix-'));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  const base = join(workspace, '.artifacts', 'native-nonadmin-fixtures', runId);
  mkdirSync(base, { recursive: true });
  const { manifest } = fixture('two-center');
  const manifestBytes = `${JSON.stringify(manifest)}\n`;
  const sqlReport = {
    contract: 'run-owned-native-nonadmin-isolated-sql-smoke-v1', runId, scenario: manifest.scenario,
    status: 'passed-isolated-sql-fixture-only', retainOwned: true, nativeAcceptance: false,
    permissionAcceptance: false, sourceNativeAcceptance: false,
    actualUAALoginVerified: false, actualBackendHTTPVerified: false,
    checks: Array.from({ length: 54 }, (_, index) => ({ name: `controlled-${index}`, status: 'passed' })),
    outputs: { 'manifest.json': { sha256: digest(manifestBytes) } },
    inputs: { fixtureTools: toolPaths.map(path => ({ path, sha256: digest(path) })) },
  };
  for (const path of toolPaths) {
    mkdirSync(join(workspace, path, '..'), { recursive: true });
    writeFileSync(join(workspace, path), path);
  }
  writeFileSync(join(base, 'manifest.json'), manifestBytes);
  const saveReport = () => writeFileSync(join(base, 'isolated-sql-report.json'), JSON.stringify(sqlReport));
  saveReport();
  return { workspace, base, sqlReport, saveReport };
}

test('generator writes new private, hash-bound matrix evidence, not a live readiness or HTTP acceptance report', t => {
  const { workspace } = temporaryRun(t);
  const result = writeNativeMatrix({ workspace, runId, label: 'contract' });
  assert.equal(result.report.status, 'matrix-generated-not-executed');
  assert.equal(result.report.liveResourcesInspected, false);
  assert.equal(result.report.inputs.length, 2);
  assert.equal(result.report.nativeAcceptance, false);
  const output = join(workspace, '.artifacts', 'native-nonadmin-fixtures', runId, 'native-matrix-contract');
  assert.equal(statSync(output).mode & 0o777, 0o700);
  for (const [name, metadata] of Object.entries(result.report.outputs)) {
    assert.equal(statSync(join(output, name)).mode & 0o777, 0o600);
    assert.equal(digest(readFileSync(join(output, name))), metadata.sha256);
  }
  assert.equal(statSync(result.reportPath).mode & 0o777, 0o600);
  const matrix = JSON.parse(readFileSync(join(output, 'matrix.json')));
  assert.equal(matrix.fixtureRetainedAtSQLCompletion, true);
  assert.equal(matrix.fixtureLiveStateVerified, false);
  assert.throws(() => writeNativeMatrix({ workspace, runId, label: 'contract' }), /EEXIST/);
});

test('failed/skipped/changed SQL evidence or changed tool bytes cannot generate a passing input matrix', t => {
  const { workspace, sqlReport, saveReport } = temporaryRun(t);
  const original = structuredClone(sqlReport);
  for (const mutate of [
    r => { r.status = 'failed-isolated-sql-fixture'; },
    r => { r.actualUAALoginVerified = true; },
    r => { r.outputs['manifest.json'].sha256 = '0'.repeat(64); },
    r => { r.checks[0].status = 'skipped'; },
    r => { r.checks.pop(); },
    r => { r.inputs.fixtureTools[0].path = '../../foreign'; },
  ]) {
    Object.assign(sqlReport, structuredClone(original));
    mutate(sqlReport);
    saveReport();
    assert.throws(() => writeNativeMatrix({ workspace, runId, label: 'invalid' }));
  }
  Object.assign(sqlReport, structuredClone(original));
  saveReport();
  writeFileSync(join(workspace, toolPaths[0]), 'changed');
  assert.throws(() => writeNativeMatrix({ workspace, runId, label: 'changed' }), /tool changed/);
});

test('symlink inputs and duplicate or execution-like CLI options are refused', t => {
  const { workspace, base } = temporaryRun(t);
  const path = join(base, 'manifest.json');
  const backup = join(base, 'backup.json');
  writeFileSync(backup, readFileSync(path));
  rmSync(path);
  symlinkSync(backup, path);
  assert.throws(() => writeNativeMatrix({ workspace, runId, label: 'symlink' }), /regular files/);
  for (const args of [
    ['--execute'], [`--run-id=${runId}`, `--run-id=${runId}`],
    [`--run-id=${runId}`, '--label=../outside'], ['--run-id=mysql'],
  ]) assert.throws(() => main(args));
});
