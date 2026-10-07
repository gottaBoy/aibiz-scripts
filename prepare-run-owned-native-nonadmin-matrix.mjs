#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import {
  constants, closeSync, lstatSync, mkdirSync, openSync, readFileSync, writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const workspaceRoot = fileURLToPath(new URL('../', import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const fixtureTools = [
  'scripts/prepare-run-owned-native-nonadmin-fixture.mjs',
  'scripts/tests/run-owned-native-nonadmin-fixture.sql.mjs',
  'scripts/tests/run-owned-native-nonadmin-fixture.test.mjs',
];
const operations = [
  ['FETCH_CUR_SYS', 'READ'], ['GET', 'READ'], ['CREATE', 'CREATE'],
  ['UPDATE', 'UPDATE'], ['REMOVE', 'DELETE'],
];

export function validateMatrixFixture(manifest) {
  assert.equal(manifest.contract, 'run-owned-native-nonadmin-fixture-candidate-v1');
  assert.match(manifest.runId, /^[a-f0-9]{12}$/);
  assert.ok(['same-center', 'two-center'].includes(manifest.scenario));
  for (const key of ['nativeAcceptance', 'permissionAcceptance', 'sourceNativeAcceptance']) {
    assert.equal(manifest[key], false, 'A fixture candidate must not claim native acceptance');
  }
  const prefix = `nf_${manifest.runId}`;
  assert.deepEqual(manifest.schemas, {
    uaa: `${prefix}_uaa`, metadata: `${prefix}_meta`,
    modelA: `${prefix}_model_a`, modelB: `${prefix}_model_b`,
  });
  assert.equal(manifest.ownership.mysqlContainer, `nf-${manifest.runId}-mysql`);
  assert.equal(manifest.ownership.network, `nf-${manifest.runId}-private`);
  assert.equal(manifest.ownership.label, 'aibiz.native-fixture.run');
  assert.equal(manifest.ownership.value, manifest.runId);
  assert.equal(manifest.roots.length, 2);
  const roles = { editor: ['e', 3], viewer: ['v', 1], 'no-access': ['n', null] };
  for (const [index, side] of ['a', 'b'].entries()) {
    const root = manifest.roots[index];
    assert.equal(root.side, side);
    for (const [field, suffix] of [
      ['rootId', `root_${side}`], ['schemeId', `scheme_${side}`],
      ['database', `model_${side}`], ['modelInstanceId', `inst_${side}`],
      ['jdbcUser', side], ['logicalSystemId', 'system'], ['sentinelId', 'module'],
    ]) assert.equal(root[field], `${prefix}_${suffix}`);
    assert.equal(root.centerId, `${prefix}_center_${manifest.scenario === 'same-center' ? 'a' : side}`);
    assert.equal(root.sentinelTag, `${prefix}_${side}_before`);
    assert.equal(root.sentinelName, `Physical ${side.toUpperCase()} ${manifest.runId}`);
    assert.equal(root.sentinelSystemName, `Physical ${side.toUpperCase()} System ${manifest.runId}`);
    assert.ok(Number.isSafeInteger(root.modelVersion) && root.modelVersion > 0);
    assert.equal(root.modelVersion, manifest.modelVersion);
    assert.equal(root.jdbcUrl,
      `jdbc:mysql://${manifest.ownership.mysqlContainer}:3306/${root.database}?useUnicode=true&characterEncoding=UTF-8&useSSL=false`);
    const users = manifest.users.filter(user => user.rootId === root.rootId);
    assert.equal(users.length, 3);
    assert.deepEqual(users.map(user => user.role).sort(), Object.keys(roles).sort());
    for (const user of users) {
      const [suffix, mode] = roles[user.role];
      assert.equal(user.loginname, `${prefix}_${side}_${suffix}`);
      assert.equal(user.personId, `${prefix}_person_${side}_${suffix}`);
      for (const field of ['id', 'developerId', 'userObjectId']) assert.equal(user[field], user.personId);
      assert.equal(user.centerId, root.centerId);
      assert.equal(user.schemeId, root.schemeId);
      assert.equal(user.accessMode, mode);
      assert.equal(user.administrator, false);
      assert.equal(user.grantId, mode === null ? null : `${prefix}_grant_${side}_${suffix}`);
    }
  }
  assert.equal(manifest.users.length, 6);
  assert.equal(manifest.expected.explicitGrantRows, 4);
  assert.equal(manifest.expected.administrativeDeveloperRows, 0);
  assert.equal(manifest.expected.ownedSchemeRows, 0);
  assert.equal(manifest.expected.explicitZeroNegativeExpiredGrantCoverage, false);
  return true;
}

export function createNativeMatrix(manifest) {
  validateMatrixFixture(manifest);
  const prefix = `nf_${manifest.runId}`;
  const credentialsPath = `.artifacts/native-nonadmin-fixtures/${manifest.runId}/credentials.private.json`;
  const roleRootCases = [];
  const authenticationCases = [];
  const invalidRootCases = [];
  const forgedSystemCases = [];
  for (const user of manifest.users) {
    const principal = {
      loginname: user.loginname, personId: user.personId, centerId: user.centerId,
      role: user.role, administrator: false,
    };
    for (const [id, endpoint, expected, credentialMode] of [
      ['uaa-login', '/auths/login', 'authenticated-nonadmin', 'correct-password-with-dc'],
      ['uaa-self', '/auths/user-info/self', 'same-person-and-center', 'token-from-uaa-login'],
      ['uaa-wrong-password', '/auths/login', 'authentication-denied', 'wrong-password-with-dc'],
      ['uaa-wrong-dc', '/auths/login', 'authentication-denied', 'correct-password-with-foreign-dc'],
      ['backend-login', 'v7/login', 'authenticated-nonadmin', 'correct-password-bare-unique-login'],
    ]) {
      authenticationCases.push({
        id: `${user.loginname}-${id}`, principal, endpoint, credentialMode,
        fields: id === 'uaa-self' ? [] : id === 'backend-login' ? ['loginname', 'password'] : ['loginname', 'password', 'dc'],
        foreignDc: manifest.roots.find(root => root.centerId !== user.centerId)?.centerId
          ?? `${prefix}_unknown_center`,
        expected, executionStatus: 'not-run',
      });
    }
    for (const root of manifest.roots) {
      for (const [operation, accessAction] of operations) {
        const ownRoot = user.rootId === root.rootId;
        const allowed = ownRoot && (user.role === 'editor'
          || (user.role === 'viewer' && accessAction === 'READ'));
        const mutation = accessAction !== 'READ';
        roleRootCases.push({
          id: `${user.loginname}-${root.side}-${operation}`,
          principal, operation, accessAction,
          target: {
            rootId: root.rootId, centerId: root.centerId, physicalSchema: root.database,
            canonicalSystemId: root.logicalSystemId,
          },
          appContext: { PSDEVSLNSYS: root.rootId },
          requestRecordId: allowed && operation === 'REMOVE'
            ? `${prefix}_probe_${user.loginname.slice(-3)}_${root.side}` : root.sentinelId,
          createRecordId: `${prefix}_probe_${user.loginname.slice(-3)}_${root.side}`,
          removeSetup: allowed && operation === 'REMOVE' ? 'create-case-owned-probe-with-same-editor' : 'none',
          expected: {
            authorization: allowed ? 'allow' : 'deny',
            physicalMutation: allowed && mutation ? 'target-schema-only' : 'neither-schema',
            ...(allowed && accessAction === 'READ' ? {
              readSentinel: {
                psmoduleid: root.sentinelId, pssystemid: root.logicalSystemId,
                psmodulename: root.sentinelName, pssystemname: root.sentinelSystemName,
              },
            } : {}),
          },
          bothDatabaseProjectionsRequired: true,
          executionStatus: 'not-run', httpBindingVerified: false,
        });
      }
    }
    for (const [kind, value] of [
      ['absent', undefined], ['null', null], ['empty', ''], ['number-zero', 0],
      ['whitespace', `${user.rootId} `], ['system-id-as-root', `${prefix}_system`],
      ['unknown-root', `${prefix}_unknown_root`],
    ]) {
      for (const action of ['READ', 'UPDATE']) {
        invalidRootCases.push({
          id: `${user.loginname}-${kind}-${action}`, principal,
          rootKind: kind, appContext: value === undefined ? {} : { PSDEVSLNSYS: value },
          accessAction: action,
          expected: { authorization: 'deny-or-bounded-input-rejection', physicalMutation: 'neither-schema' },
          bothDatabaseProjectionsRequired: true, executionStatus: 'not-run',
        });
      }
    }
    if (user.role !== 'no-access') {
      forgedSystemCases.push({
        id: `${user.loginname}-forged-system-read`, principal,
        appContext: { PSDEVSLNSYS: user.rootId }, submittedSystemId: `${prefix}_unknown_system`,
        expected: {
          canonicalSystemId: `${prefix}_system`, physicalSchema: manifest.roots
            .find(root => root.rootId === user.rootId).database,
          physicalMutation: 'neither-schema',
          policy: 'canonical-system-rewrite-after-root-authorization',
        },
        bothDatabaseProjectionsRequired: true, executionStatus: 'not-run',
      });
    }
  }
  return {
    contract: 'run-owned-native-nonadmin-role-root-matrix-v1',
    runId: manifest.runId, scenario: manifest.scenario, status: 'planned-not-executed',
    nativeAcceptance: false, permissionAcceptance: false, sourceNativeAcceptance: false,
    actualUAALoginVerified: false, actualBackendHTTPVerified: false,
    boundary: 'Logical acceptance inputs only; this tool reads no credentials and sends no Docker/SQL/HTTP commands',
    credentialsPath, ownership: manifest.ownership, schemas: manifest.schemas,
    topology: 'Two independent model schemas and schema-scoped JDBC users in one run-owned MySQL instance',
    authenticationCases, roleRootCases, invalidRootCases, forgedSystemCases,
    caseCounts: {
      authentication: authenticationCases.length, roleRoot: roleRootCases.length,
      roleRootAllow: roleRootCases.filter(row => row.expected.authorization === 'allow').length,
      roleRootDeny: roleRootCases.filter(row => row.expected.authorization === 'deny').length,
      invalidRoot: invalidRootCases.length, forgedSystem: forgedSystemCases.length,
    },
    acceptanceRequirements: [
      'All six accounts authenticate but remain non-admin; no-access is not an authentication failure',
      'Bind actual source-built image IDs and source/build receipts separately from this workspace matrix',
      'Native API adapter must prove root transport, URL/action mappings, authenticated person and center',
      'Read all module/system rows in both schemas immediately before/after every operation; compare ordered projections',
      'Denied reads expose no sentinel; denied writes change neither schema; HTTP 404/500/network errors are not authorization proof',
      'Allowed writes persist only in the selected schema and are read back in a fresh authenticated session',
      'Use case-owned probe rows for successful deletes; retain both baseline sentinels and record cleanup independently',
      'Same-center and two-center runs are mandatory; they detect different grant and center bypasses',
    ],
    blockedRequirements: [
      { id: 'actual-uaa', reason: 'No isolated UAA login/self execution in the SQL receipt; starter compilation is not a complete UAA build' },
      { id: 'application-db-users', reason: 'Existing fixture creates model JDBC users only, not non-root UAA/metadata application accounts' },
      { id: 'complete-native-schema', reason: 'Bounded published identity/root/module query schemas are not the complete application schema' },
      { id: 'uaa-token-store', reason: 'Choose isolated Redis L2 or provide required JDBC OAuth tables for L1; neither is established by this fixture' },
      { id: 'zero-negative-expired-grants', reason: 'Not seeded; require separate owned grant variants and cache invalidation/fresh-session proof' },
      { id: 'session-holder-frames', reason: 'Requires isolated native server instrumentation for conflicting session/fresh roots and legitimate nested-holder restore; no production hooks added here' },
      { id: 'canonical-remap-cache-rotation', reason: 'Requires separate owned remap/version/connection-rotation fixture and repeated fresh-session readback' },
    ],
  };
}

export function snapshotSQL(manifest) {
  validateMatrixFixture(manifest);
  return [
    '-- Read-only before/after projections. Compare every ordered row in both physical schemas.',
    ...manifest.roots.flatMap(root => [
      `SELECT '${root.database}' AS physical_schema, PSMODULEID, PSSYSTEMID, PSMODULENAME, MODTAG FROM \`${root.database}\`.t_srfpsmodule ORDER BY PSMODULEID;`,
      `SELECT '${root.database}' AS physical_schema, PSSYSTEMID, PSSYSTEMNAME, PSDEVSLNSYSID, PSSYSMODELINSTID, PSDEVCENTERID FROM \`${root.database}\`.t_srfpssystem ORDER BY PSSYSTEMID;`,
    ]), '',
  ].join('\n');
}

function writeExclusive(path, contents) {
  const descriptor = openSync(path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(descriptor, contents); }
  finally { closeSync(descriptor); }
}

export function writeNativeMatrix({ runId, label = randomBytes(6).toString('hex'), workspace = workspaceRoot }) {
  assert.match(runId, /^[a-f0-9]{12}$/);
  assert.match(label, /^[a-z0-9][a-z0-9-]{0,63}$/);
  let base = resolve(workspace);
  for (const part of ['.artifacts', 'native-nonadmin-fixtures', runId]) {
    base = join(base, part);
    const stat = lstatSync(base);
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), 'Fixture ancestors must be real directories');
  }
  const read = name => {
    const path = join(base, name);
    const stat = lstatSync(path);
    assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'Fixture inputs must be regular files');
    const bytes = readFileSync(path);
    return { value: JSON.parse(bytes), binding: { name, bytes: bytes.length, sha256: digest(bytes) } };
  };
  const manifestInput = read('manifest.json');
  const sqlInput = read('isolated-sql-report.json');
  const manifest = manifestInput.value;
  const sqlReport = sqlInput.value;
  assert.equal(manifest.runId, runId);
  const matrix = createNativeMatrix(manifest);
  assert.equal(sqlReport.contract, 'run-owned-native-nonadmin-isolated-sql-smoke-v1');
  assert.equal(sqlReport.runId, runId);
  assert.equal(sqlReport.scenario, manifest.scenario);
  assert.equal(sqlReport.status, 'passed-isolated-sql-fixture-only');
  for (const key of ['nativeAcceptance', 'permissionAcceptance', 'sourceNativeAcceptance',
    'actualUAALoginVerified', 'actualBackendHTTPVerified']) assert.equal(sqlReport[key], false);
  assert.ok(sqlReport.checks.length >= 54, 'Require the completed identity/query/grant/sentinel SQL baseline');
  assert.ok(sqlReport.checks.every(check => check.status === 'passed'));
  assert.equal(sqlReport.outputs['manifest.json'].sha256, manifestInput.binding.sha256);
  assert.deepEqual(sqlReport.inputs.fixtureTools.map(row => row.path), fixtureTools);
  for (const input of sqlReport.inputs.fixtureTools) {
    assert.equal(digest(readFileSync(join(workspace, input.path))), input.sha256,
      `SQL fixture tool changed since receipt: ${input.path}`);
  }
  // A retained SQL receipt is historical evidence, never a live container check.
  matrix.fixtureLiveStateVerified = false;
  matrix.fixtureRetainedAtSQLCompletion = sqlReport.retainOwned;
  const bindings = [manifestInput.binding, sqlInput.binding];
  const report = {
    contract: 'run-owned-native-nonadmin-matrix-generation-v1', runId,
    generatedAt: new Date().toISOString(), status: 'matrix-generated-not-executed',
    nativeAcceptance: false, permissionAcceptance: false, sourceNativeAcceptance: false,
    inputs: bindings, fixtureTools: sqlReport.inputs.fixtureTools,
    generator: { path: 'scripts/prepare-run-owned-native-nonadmin-matrix.mjs', sha256: digest(readFileSync(fileURLToPath(import.meta.url))) },
    caseCounts: matrix.caseCounts, liveResourcesInspected: false, outputs: {},
  };
  const output = join(base, `native-matrix-${label}`);
  mkdirSync(output, { mode: 0o700 });
  for (const [name, contents] of [
    ['matrix.json', json(matrix)], ['04-snapshot-models.sql', snapshotSQL(manifest)],
  ]) {
    writeExclusive(join(output, name), contents);
    report.outputs[name] = { bytes: Buffer.byteLength(contents), sha256: digest(contents) };
  }
  writeExclusive(join(output, 'report.json'), json(report));
  return { reportPath: join(output, 'report.json'), report };
}

export function main(args = process.argv.slice(2)) {
  const options = {};
  for (const arg of args) {
    const match = /^--(run-id|label)=(.+)$/.exec(arg);
    assert.ok(match, 'Only existing-run matrix generation is supported; no SQL/HTTP/deploy command');
    assert.equal(options[match[1]], undefined, 'Duplicate option');
    options[match[1]] = match[2];
  }
  const result = writeNativeMatrix({ runId: options['run-id'], label: options.label });
  return {
    reportPath: result.reportPath, status: result.report.status,
    caseCounts: result.report.caseCounts, nativeAcceptance: false,
  };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { console.log(json(main()).trim()); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
