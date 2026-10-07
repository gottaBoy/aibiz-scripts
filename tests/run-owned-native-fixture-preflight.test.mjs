import assert from 'node:assert/strict';
import test from 'node:test';
import { createFixture } from '../prepare-run-owned-native-nonadmin-fixture.mjs';
import {
  compareUAASchema, fixtureAuditSQL, main, verifyFixtureJoins, verifyPhysicalBindings,
} from '../audit-run-owned-native-fixture-preflight.mjs';

const { manifest } = createFixture({
  runId: 'f01006abcdef', scenario: 'two-center', passwordStorageMode: 'sm3',
  modelVersion: 816, uaaSchemaMode: 'legacy-views', secret: () => '1'.repeat(36),
});
const identities = () => manifest.users.map(user => ({
  loginname: user.loginname, personId: user.personId, centerId: user.centerId,
  developerId: user.developerId, userObjectId: user.userObjectId, objectCenterId: user.centerId,
  adminMode: 0, organizationId: `${user.centerId}_org`, status: '1', enabled: 1,
  passwordLength: 64, grantId: user.grantId, accessMode: user.accessMode,
  grantRootId: user.grantId ? user.rootId : null, grantSchemeId: user.grantId ? user.schemeId : null,
  allSystems: user.grantId ? 0 : null, expiresAt: null,
}));
const roles = () => manifest.users.map(user => ({
  loginname: user.loginname, personId: user.personId, centerId: user.centerId,
  roleId: `${user.centerId}_ordinary_role`, roleCenterId: user.centerId,
  authority: 'ROLE_NATIVE_FIXTURE', deployId: `${user.centerId}_deploy`,
  deployCenterId: user.centerId, systemId: 'ibizmodeling',
}));
const bindings = () => manifest.roots.map(root => ({
  rootId: root.rootId, schemeId: root.schemeId, centerId: root.centerId,
  systemId: root.logicalSystemId, modelInstanceId: root.modelInstanceId,
  instanceCenterId: root.centerId, database: root.database, jdbcUser: root.jdbcUser,
  modelVersion: root.modelVersion,
}));

test('read-only join audit includes every no-access user without an inherited model grant', () => {
  assert.equal(verifyFixtureJoins(manifest, identities(), roles()), true);
});

test('identity joins reject elevation, wrong centers, changed passwords, missing and inherited grants', () => {
  for (const mutate of [
    rows => { rows[0].adminMode = 1; },
    rows => { rows[0].objectCenterId = manifest.roots[1].centerId; },
    rows => { rows[0].personId = rows[1].personId; },
    rows => { rows[0].passwordLength = 36; },
    rows => { rows[0].grantId = null; },
    rows => { rows[0].grantRootId = manifest.roots[1].rootId; },
    rows => { rows[0].allSystems = 1; },
    rows => { rows[0].expiresAt = '2026-01-01'; },
    rows => { rows[2].grantId = 'inherited'; },
    rows => { rows.pop(); },
    rows => { rows[0] = rows[1]; },
  ]) {
    const rows = identities();
    mutate(rows);
    assert.throws(() => verifyFixtureJoins(manifest, rows, roles()));
  }
});

test('role joins reject reserved authority, foreign deployment, duplicate grant and non-person member mapping', () => {
  for (const mutate of [
    rows => { rows[0].authority = 'ROLE_SUPERADMIN'; },
    rows => { rows[0].roleId = 'ROLE_APIUSERS'; },
    rows => { rows[0].roleCenterId = manifest.roots[1].centerId; },
    rows => { rows[0].deployCenterId = manifest.roots[1].centerId; },
    rows => { rows[0].personId = manifest.users[0].loginname; },
    rows => { rows.push(rows[0]); },
    rows => { rows.pop(); },
  ]) {
    const rows = roles();
    mutate(rows);
    assert.throws(() => verifyFixtureJoins(manifest, identities(), rows));
  }
});

test('root audit rejects one-schema remaps, cross-center joins, different datasource users and model versions', () => {
  assert.equal(verifyPhysicalBindings(manifest, bindings()), true);
  for (const mutate of [
    rows => { rows[0].database = rows[1].database; },
    rows => { rows[0].instanceCenterId = rows[1].instanceCenterId; },
    rows => { rows[0].jdbcUser = rows[1].jdbcUser; },
    rows => { rows[0].modelVersion += 1; },
    rows => { rows[0].rootId = rows[1].rootId; },
    rows => { rows.pop(); },
  ]) {
    const rows = bindings();
    mutate(rows);
    assert.throws(() => verifyPhysicalBindings(manifest, rows));
  }
});

test('audit SQL observes wrong-center joins without filtering them out and never exports password bytes', () => {
  const sql = fixtureAuditSQL(manifest);
  for (const query of Object.values(sql)) {
    assert.match(query.trim(), /^SELECT /);
    assert.doesNotMatch(query, /\b(?:INSERT|UPDATE|DELETE|GRANT|CREATE|DROP|ALTER|TRUNCATE|OUTFILE)\b/i);
    assert.doesNotMatch(query, /\bPASSWD\b|\bCONNSTR\b/i);
  }
  assert.match(sql.joins, /LENGTH\(p\.USER_PASSWORD\)/);
  assert.doesNotMatch(sql.joins, /o\.PSDEVCENTERID\s*=\s*p\.DC/);
  assert.doesNotMatch(sql.roles, /r\.DC\s*=\s*p\.DC|ds\.DC\s*=\s*p\.DC/);
  assert.match(sql.roles, /m\.MEMBER_UID=p\.ID/);
});

test('audit CLI refuses implicit or mutation execution, duplicates, foreign runs and path traversal', () => {
  for (const argv of [
    [], ['--execute'], ['--run-id=mysql'], ['--run-id=f01006abcdef', '--label=../outside'],
    ['--run-id=f01006abcdef', '--run-id=f01006abcdef'],
    ['--run-id=f01006abcdef', '--account-label=../outside'],
  ]) assert.throws(() => main(argv));
});

const schemaModel = () => ({
  entities: [
    { entity_name: 'AUTH_PROVIDER', table_name: 'OPEN_ACCESS_PROVIDER', fields: [
      { fieldname: 'ID', physical_field: 1 },
      { fieldname: 'DC', physical_field: 1 },
      { fieldname: 'DERIVED', physical_field: 0 },
    ] },
    { entity_name: 'SYS_PERSON', table_name: 'SYS_PERSON', fields: [
      { fieldname: 'UID', physical_field: 1 },
      { fieldname: 'DC', physical_field: 1 },
    ] },
    { entity_name: 'AUTH_GRANTED', table_name: '', fields: [] },
  ],
});
const schemaTables = () => [
  { name: 'sys_person', kind: 'VIEW' }, { name: 'legacy_person', kind: 'BASE TABLE' },
];
const schemaColumns = () => [
  { table: 'sys_person', name: 'UID' }, { table: 'legacy_person', name: 'legacy_id' },
];

test('schema inventory preserves missing provider table and view column gaps without guessing unmapped entities', () => {
  const result = compareUAASchema(schemaModel(), schemaTables(), schemaColumns());
  assert.equal(result.entityCount, 3);
  assert.equal(result.mappedTableCount, 2);
  assert.deepEqual(result.missingTables, ['open_access_provider']);
  assert.deepEqual(result.unmappedEntities, ['AUTH_GRANTED']);
  assert.deepEqual(result.unmappedObservedTables, ['legacy_person']);
  assert.equal(result.incompleteTableCount, 1);
  assert.equal(result.missingColumnCount, 1);
  assert.deepEqual(result.mapped[0].expectedColumns, ['id', 'dc']);
  assert.deepEqual(result.mapped[0].missingColumns, []);
  assert.equal(result.mapped[1].kind, 'VIEW');
  assert.deepEqual(result.mapped[1].missingColumns, ['dc']);
  assert.match(result.scope, /not full runtime schema or readiness proof/);
});

test('an empty observed provider table can satisfy column presence but cannot prove authentication', () => {
  const result = compareUAASchema(schemaModel(),
    [...schemaTables(), { name: 'open_access_provider', kind: 'BASE TABLE' }],
    [...schemaColumns(), { table: 'sys_person', name: 'dc' },
      { table: 'open_access_provider', name: 'ID' }, { table: 'open_access_provider', name: 'DC' }]);
  assert.deepEqual(result.missingTables, []);
  assert.equal(result.incompleteTableCount, 0);
  assert.equal(result.missingColumnCount, 0);
  assert.equal(Object.hasOwn(result, 'nativeAcceptance'), false);
});

test('schema inventory rejects ambiguous mappings, duplicate fields and unknown physical-field flags', () => {
  for (const mutate of [
    model => { model.entities.push(model.entities[0]); },
    model => { model.entities[1].table_name = 'open_access_provider'; },
    model => { model.entities[0].fields.push({ fieldname: 'id', physical_field: 1 }); },
    model => { model.entities[0].fields[0].physical_field = '1'; },
    model => { model.entities[0].table_name = 'provider; DROP TABLE sys_person'; },
    model => { delete model.entities[0].fields; },
    model => { delete model.entities[0].table_name; },
  ]) {
    const model = schemaModel();
    mutate(model);
    assert.throws(() => compareUAASchema(model, schemaTables(), schemaColumns()));
  }
});

test('schema inventory rejects duplicate observations, orphan columns and unknown table kinds', () => {
  assert.throws(() => compareUAASchema(schemaModel(), [...schemaTables(), schemaTables()[0]], schemaColumns()));
  assert.throws(() => compareUAASchema(schemaModel(), schemaTables(), [...schemaColumns(), schemaColumns()[0]]));
  assert.throws(() => compareUAASchema(schemaModel(), schemaTables(), [{ table: 'unobserved', name: 'id' }]));
  assert.throws(() => compareUAASchema(schemaModel(), [{ name: 'sys_person', kind: 'UNKNOWN' }], []));
});
