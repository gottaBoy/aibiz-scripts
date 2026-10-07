#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { validateOwnedTarget } from './prepare-run-owned-native-nonadmin-fixture.mjs';
import { validateMatrixFixture } from './prepare-run-owned-native-nonadmin-matrix.mjs';
import { validateApplicationGrants, validateFixtureReceipt } from './provision-run-owned-native-application-accounts.mjs';

const workspace = fileURLToPath(new URL('../', import.meta.url));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceRoot = '.artifacts/standalone-uaa-editable-20261006-E1/build-MGQ6RI/source';
const sourcePaths = [
  'uaa-api/src/main/java/cn/ibizlab/config/BootSecurityConfig.java',
  'uaa-user/src/main/java/cn/ibizlab/core/authentication/provider/ServiceApiAuthenticationProvider.java',
  'uaa-user/src/main/java/cn/ibizlab/core/authentication/provider/LdapAuthenticationProvider.java',
  'uaa-user/src/main/java/cn/ibizlab/core/authentication/service/impl/AuthProviderServiceImpl.java',
  'uaa-core/src/main/resources/mapper/authentication/AuthProvider/AuthProviderMapper.xml',
  'uaa-user/src/main/java/cn/ibizlab/core/oauth2/config/OAuth2TokenAdapter.java',
  'uaa-user/src/main/java/cn/ibizlab/core/oauth2/config/OAuth2AuthorizationServerConfig.java',
  'uaa-user/src/main/java/cn/ibizlab/core/oauth2/service/impl/OauthClientDetailsServiceImpl.java',
  'uaa-core/src/main/java/cn/ibizlab/core/authentication/domain/AuthProvider.java',
  'uaa-core/src/main/resources/sysmodel/uaa.json',
];

export function compareUAASchema(model, tables, columns) {
  assert.ok(model && Array.isArray(model.entities) && model.entities.length > 0);
  const identifier = value => {
    assert.match(value, /^[a-z][a-z0-9_]*$/i, 'Schema identifiers must be explicit');
    return value.toLowerCase();
  };
  const observed = new Map();
  for (const row of tables) {
    const name = identifier(row.name);
    assert.ok(!observed.has(name), 'Ambiguous observed table');
    assert.ok(['BASE TABLE', 'VIEW'].includes(row.kind));
    observed.set(name, { kind: row.kind, columns: new Set() });
  }
  for (const row of columns) {
    const table = observed.get(identifier(row.table));
    assert.ok(table, 'Column belongs to an unobserved table');
    const name = identifier(row.name);
    assert.ok(!table.columns.has(name), 'Ambiguous observed column');
    table.columns.add(name);
  }
  const mapped = [];
  const unmappedEntities = [];
  const entities = new Set();
  const mappings = new Set();
  for (const entity of model.entities) {
    const name = identifier(entity.entity_name);
    assert.ok(!entities.has(name), 'Ambiguous source entity');
    entities.add(name);
    assert.equal(typeof entity.table_name, 'string');
    assert.ok(Array.isArray(entity.fields));
    if (entity.table_name === '') {
      unmappedEntities.push(entity.entity_name);
      continue;
    }
    const table = identifier(entity.table_name);
    assert.ok(!mappings.has(table), 'Ambiguous source table mapping');
    mappings.add(table);
    const expectedColumns = [];
    for (const field of entity.fields) {
      assert.ok([0, 1].includes(field.physical_field), 'Unknown source physical-field flag');
      if (field.physical_field === 1) expectedColumns.push(identifier(field.fieldname));
    }
    assert.equal(new Set(expectedColumns).size, expectedColumns.length, 'Ambiguous source field');
    const actual = observed.get(table);
    mapped.push({
      entity: entity.entity_name, table, present: Boolean(actual), kind: actual?.kind ?? null,
      expectedColumns, observedColumnCount: actual?.columns.size ?? 0,
      missingColumns: actual ? expectedColumns.filter(name => !actual.columns.has(name)) : [],
    });
  }
  const missingTables = mapped.filter(row => !row.present).map(row => row.table);
  const incompleteTables = mapped.filter(row => row.present && row.missingColumns.length > 0);
  return {
    scope: 'Explicit sysmodel table/physical-field presence only; not full runtime schema or readiness proof',
    entityCount: model.entities.length, mappedTableCount: mapped.length,
    unmappedEntities, observedTableCount: tables.length,
    missingTables, incompleteTableCount: incompleteTables.length,
    missingColumnCount: incompleteTables.reduce((count, row) => count + row.missingColumns.length, 0),
    unmappedObservedTables: [...observed.keys()].filter(name => !mappings.has(name)),
    mapped,
  };
}

export function verifyFixtureJoins(manifest, rows, roleRows) {
  validateMatrixFixture(manifest);
  assert.equal(rows.length, manifest.users.length, 'Require exactly six identity/grant joins');
  assert.equal(roleRows.length, manifest.users.length, 'Require exactly six ordinary UAA role joins');
  for (const user of manifest.users) {
    const matches = rows.filter(row => row.loginname === user.loginname);
    const roles = roleRows.filter(row => row.loginname === user.loginname);
    assert.equal(matches.length, 1);
    assert.equal(roles.length, 1);
    const row = matches[0];
    for (const [field, value] of Object.entries({
      personId: user.personId, centerId: user.centerId, developerId: user.developerId,
      userObjectId: user.userObjectId, objectCenterId: user.centerId, adminMode: 0,
      organizationId: `${user.centerId}_org`, status: '1', enabled: 1, passwordLength: 64,
      grantId: user.grantId, accessMode: user.accessMode,
      grantRootId: user.grantId ? user.rootId : null,
      grantSchemeId: user.grantId ? user.schemeId : null,
      allSystems: user.grantId ? 0 : null, expiresAt: null,
    })) assert.equal(row[field], value, `Fixture join mismatch: ${field}`);
    for (const [field, value] of Object.entries({
      personId: user.personId, centerId: user.centerId,
      roleId: `${user.centerId}_ordinary_role`, roleCenterId: user.centerId,
      authority: 'ROLE_NATIVE_FIXTURE', deployId: `${user.centerId}_deploy`,
      deployCenterId: user.centerId, systemId: 'ibizmodeling',
    })) assert.equal(roles[0][field], value, `UAA role mismatch: ${field}`);
  }
  return true;
}

export function verifyPhysicalBindings(manifest, rows) {
  validateMatrixFixture(manifest);
  assert.equal(rows.length, manifest.roots.length);
  for (const root of manifest.roots) {
    const matches = rows.filter(row => row.rootId === root.rootId);
    assert.equal(matches.length, 1);
    for (const [field, value] of Object.entries({
      schemeId: root.schemeId, centerId: root.centerId, systemId: root.logicalSystemId,
      modelInstanceId: root.modelInstanceId, instanceCenterId: root.centerId,
      database: root.database, jdbcUser: root.jdbcUser, modelVersion: root.modelVersion,
    })) assert.equal(matches[0][field], value, `Physical root mismatch: ${field}`);
  }
  return true;
}

export function fixtureAuditSQL(manifest) {
  validateMatrixFixture(manifest);
  const { uaa, metadata } = manifest.schemas;
  return {
    joins: `SELECT JSON_OBJECT('personId',p.ID,'loginname',p.UID,'centerId',p.DC,
      'status',p.STATUS,'enabled',p.ENABLED,'organizationId',p.ORGANIZATION_ID,
      'passwordLength',LENGTH(p.USER_PASSWORD),'developerId',d.PSDEVUSERID,
      'adminMode',d.ADMINMODE,'userObjectId',o.PSDEVUSEROBJID,'objectCenterId',o.PSDEVCENTERID,
      'grantId',g.PSDEVSLNUSERID,'accessMode',g.ACCMODE,'grantRootId',g.PSDEVSLNSYSID,
      'grantSchemeId',g.PSDEVSLNID,'allSystems',g.ALLSYSFLAG,'expiresAt',g.EXPIREDTIME)
      FROM \`${uaa}\`.sys_person p JOIN \`${metadata}\`.t_srfpsdevuser d ON d.LOGINNAME=p.UID
      JOIN \`${metadata}\`.t_srfpsdevuserobj o ON o.PSDEVUSEROBJID=d.PSDEVUSERID
      LEFT JOIN \`${metadata}\`.t_srfpsdevslnuser g ON g.PSDEVUSEROBJID=o.PSDEVUSEROBJID ORDER BY p.UID;`,
    roles: `SELECT JSON_OBJECT('personId',p.ID,'loginname',p.UID,'centerId',p.DC,
      'roleId',r.ID,'roleCenterId',r.DC,'authority',r.AUTHORITY,'deployId',ds.ID,
      'deployCenterId',ds.DC,'systemId',ds.SYSTEM_ID)
      FROM \`${uaa}\`.sys_person p JOIN \`${uaa}\`.sys_role_member m
      ON m.MEMBER_UID=p.ID AND m.MEMBER_TYPE='inetOrgPerson'
      JOIN \`${uaa}\`.sys_role r ON r.ID=m.ROLE_ID
      JOIN \`${uaa}\`.sys_deploy_system ds ON ds.ID=r.DEPLOY_SYSTEM_ID ORDER BY p.UID;`,
    bindings: `SELECT JSON_OBJECT('rootId',s.PSDEVSLNSYSID,'schemeId',sl.PSDEVSLNID,
      'centerId',sl.PSDEVCENTERID,'systemId',s.PSSYSTEMID,'modelInstanceId',i.PSSYSMODELINSTID,
      'instanceCenterId',i.PSDEVCENTERID,'database',i.DBNAME,'jdbcUser',i.USERNAME,'modelVersion',i.MODELVER)
      FROM \`${metadata}\`.t_srfpsdevslnsys s
      JOIN \`${metadata}\`.t_srfpsdevsln sl ON sl.PSDEVSLNID=s.PSDEVSLNID
      JOIN \`${metadata}\`.t_srfpssysmodelinst i ON i.PSSYSMODELINSTID=s.PSSYSMODELINSTID
      ORDER BY s.PSDEVSLNSYSID;`,
    tables: `SELECT JSON_OBJECT('name',TABLE_NAME,'kind',TABLE_TYPE) FROM information_schema.TABLES
      WHERE TABLE_SCHEMA='${uaa}' ORDER BY TABLE_NAME;`,
    columns: `SELECT JSON_OBJECT('table',TABLE_NAME,'name',COLUMN_NAME)
      FROM information_schema.COLUMNS WHERE TABLE_SCHEMA='${uaa}' ORDER BY TABLE_NAME,ORDINAL_POSITION;`,
  };
}

function docker(args, options = {}) {
  const result = spawnSync('docker', args, {
    encoding: 'utf8', timeout: 60_000, maxBuffer: 4 * 1024 * 1024, ...options,
  });
  assert.ok(!result.error && result.status === 0, 'Owned read-only Docker check failed; raw diagnostics suppressed');
  return result.stdout.trim();
}

export function auditOwnedFixture({ runId, accountLabel, label = randomBytes(6).toString('hex') }) {
  assert.match(runId, /^[a-f0-9]{12}$/);
  for (const value of [accountLabel, label]) assert.match(value, /^[a-z0-9][a-z0-9-]{0,63}$/);
  let base = resolve(workspace);
  for (const part of ['.artifacts', 'native-nonadmin-fixtures', runId]) {
    base = join(base, part);
    const stat = lstatSync(base);
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink());
  }
  const inputs = [];
  const read = (name, privateInput = false) => {
    const path = join(base, name);
    let current = base;
    for (const part of name.split('/')) {
      current = join(current, part);
      assert.ok(!lstatSync(current).isSymbolicLink(), 'Input ancestors must not be symlinks');
    }
    const stat = lstatSync(path);
    assert.ok(stat.isFile());
    if (privateInput) assert.equal(stat.mode & 0o077, 0);
    const bytes = readFileSync(path);
    inputs.push({ path, sha256: digest(bytes), bytes: bytes.length });
    return JSON.parse(bytes);
  };
  const manifest = read('manifest.json');
  const fixtureReceipt = read('isolated-sql-report.json');
  const resources = read('owned-resources.json');
  validateFixtureReceipt(manifest, fixtureReceipt, inputs[0].sha256);
  assert.equal(manifest.runId, runId);
  for (const row of fixtureReceipt.inputs.fixtureTools) {
    assert.match(row.path, /^scripts\/(?:tests\/)?[a-z0-9.-]+\.mjs$/);
    assert.equal(digest(readFileSync(join(workspace, row.path))), row.sha256);
  }
  const accountReceipt = read(`application-accounts-${accountLabel}/report.json`);
  assert.equal(accountReceipt.contract, 'run-owned-native-application-accounts-v1');
  assert.equal(accountReceipt.runId, runId);
  assert.equal(accountReceipt.status, 'passed-owned-application-account-sql-only');
  const accountInput = read(`application-accounts-${accountLabel}/accounts.private.json`, true);
  assert.equal(inputs.at(-1).sha256, accountReceipt.outputs['accounts.private.json'].sha256);
  for (const binding of accountReceipt.inputs) {
    assert.equal(inputs.find(row => row.path === join(base, binding.name))?.sha256, binding.sha256);
  }
  const containers = JSON.parse(docker(['inspect', resources.mysqlId]));
  const network = JSON.parse(docker(['network', 'inspect', resources.networkId]))[0];
  const peerIds = Object.keys(network.Containers).filter(id => id !== resources.mysqlId);
  const peers = peerIds.length ? JSON.parse(docker(['inspect', ...peerIds])) : [];
  validateOwnedTarget(manifest, containers[0], network, peers);
  assert.equal(containers[0].Id, fixtureReceipt.ownedMysqlId);
  assert.equal(network.Id, fixtureReceipt.ownedNetworkId);
  assert.equal(containers[0].Image, fixtureReceipt.mysqlImage);
  const rootSQL = input => docker(['exec', '-i', resources.mysqlId, 'sh', '-c',
    'test -n "$MYSQL_ROOT_PASSWORD" && MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -h127.0.0.1 --protocol=TCP -uroot --batch --raw --skip-column-names'],
  { input });
  const rows = input => rootSQL(input).split('\n').filter(Boolean).map(row => JSON.parse(row));
  assert.equal(rootSQL('SELECT @@lower_case_table_names;'), '1');
  const sql = fixtureAuditSQL(manifest);
  verifyFixtureJoins(manifest, rows(sql.joins), rows(sql.roles));
  verifyPhysicalBindings(manifest, rows(sql.bindings));
  const checks = ['current-six-identity-and-role-joins', 'current-two-physical-root-bindings'];
  for (const account of accountReceipt.accounts) {
    assert.ok(['uaa', 'metadata'].includes(account.kind));
    assert.equal(account.username, `nf_${runId}_${account.kind === 'uaa' ? 'uaa' : 'meta'}_app`);
    assert.equal(account.database, manifest.schemas[account.kind]);
    assert.equal(account.privileges, account.kind === 'uaa' ? 'SELECT, INSERT, UPDATE, DELETE' : 'SELECT');
    validateApplicationGrants(account, rootSQL(`SHOW GRANTS FOR '${account.username}'@'%';`));
    assert.match(accountInput.passwords[account.username], /^[a-f0-9]{36}$/);
    assert.equal(docker(['exec', '-i', '-e', 'MYSQL_PWD', resources.mysqlId, 'mysql',
      '-h127.0.0.1', '--protocol=TCP', `-u${account.username}`, '--batch', '--skip-column-names'],
    { env: { ...process.env, MYSQL_PWD: accountInput.passwords[account.username] },
      input: `SELECT COUNT(*) FROM \`${account.database}\`.${account.kind === 'uaa' ? 'sys_person' : 't_srfpsdevuser'};` }), '6');
    checks.push(`current-${account.kind}-application-grants-and-password-auth`);
  }
  assert.equal(accountReceipt.accounts.length, 2);
  const tables = rows(sql.tables);
  const modelPath = join(workspace, sourceRoot, 'uaa-core/src/main/resources/sysmodel/uaa.json');
  const schemaInventory = compareUAASchema(JSON.parse(readFileSync(modelPath)), tables, rows(sql.columns));
  const missing = ['open_access_provider', 'oauth_client_details', 'oauth_access_token', 'oauth_refresh_token']
    .filter(name => !tables.some(row => row.name.toLowerCase() === name));
  const blocked = missing.includes('open_access_provider');
  const output = join(base, `independent-preflight-${label}`);
  mkdirSync(output, { mode: 0o700 });
  const report = {
    contract: 'run-owned-native-fixture-readonly-preflight-v1', runId,
    observedAt: new Date().toISOString(), status: blocked ? 'blocked-native-login-schema' : 'passed-readonly-fixture-only',
    nativeAcceptance: false, permissionAcceptance: false, sourceNativeAcceptance: false,
    actualUAALoginVerified: false, actualBackendHTTPVerified: false,
    inputBindingVerified: true, readonlyFixtureChecksVerified: true,
    nativeSchemaPrerequisitesVerified: false, inputs,
    generator: { path: 'scripts/audit-run-owned-native-fixture-preflight.mjs',
      sha256: digest(readFileSync(fileURLToPath(import.meta.url))) },
    candidateSources: sourcePaths.map(path => ({
      path: join(sourceRoot, path), sha256: digest(readFileSync(join(workspace, sourceRoot, path))),
    })),
    topology: { networkId: network.Id, mysqlId: containers[0].Id,
      peers: [containers[0], ...peers].map(row => ({ id: row.Id, name: row.Name, imageId: row.Image })) },
    checks: checks.map(id => ({ id, status: 'passed' })), tables, schemaInventory,
    missingDependencies: missing,
    blockingDependencies: blocked ? ['open_access_provider'] : [],
    boundary: 'Read-only owned SQL/identity/account observations; not deployment readiness or native HTTP proof',
    protocolNotes: [
      'MGQ6RI API/LDAP provider supports() consult OPEN_ACCESS_PROVIDER before the DAO provider',
      'ibzuaa client is predefined; missing oauth_client_details does not alone block /auths/login',
      'Explicit cacheLevel=L2 plus owned Redis avoids JDBC token tables, not other missing schema',
      'Full schema, source provenance/license, backend trust, refresh/logout and HTTP denial behavior remain unverified',
    ],
  };
  const reportPath = join(output, 'report.json');
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
  return { report, reportPath };
}

export function main(argv = process.argv.slice(2)) {
  const options = {};
  for (const arg of argv) {
    const match = /^--(run-id|account-label|label)=(.+)$/.exec(arg);
    assert.ok(match && !Object.hasOwn(options, match[1]), 'Explicit non-duplicate audit options required');
    options[match[1]] = match[2];
  }
  const result = auditOwnedFixture({ runId: options['run-id'], accountLabel: options['account-label'], label: options.label });
  console.log(JSON.stringify({ reportPath: result.reportPath, status: result.report.status,
    sha256: digest(readFileSync(result.reportPath)), nativeAcceptance: false }));
  if (result.report.blockingDependencies.length) process.exitCode = 2;
  return result;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { main(); } catch {
    console.error('Read-only fixture audit failed; credential-bearing diagnostics suppressed');
    process.exitCode = 1;
  }
}
