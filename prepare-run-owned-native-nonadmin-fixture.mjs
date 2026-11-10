#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import {
  constants, closeSync, lstatSync, mkdirSync, openSync, writeFileSync,
} from 'node:fs';
import { join, parse, relative, resolve, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const workspaceRoot = fileURLToPath(new URL('../', import.meta.url));
export const ownershipLabel = 'aibiz.native-fixture.run';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const runPattern = /^[a-f0-9]{12}$/;
const sqlId = value => {
  assert.match(value, /^[a-z][a-z0-9_]*$/, 'Unsafe SQL identifier');
  return `\`${value}\``;
};
const sqlValue = value => {
  if (value === null) return 'NULL';
  if (Number.isInteger(value)) return String(value);
  assert.equal(typeof value, 'string');
  return `CONVERT(X'${Buffer.from(value, 'utf8').toString('hex')}' USING utf8mb4)`;
};

function insert(schema, table, row) {
  return `INSERT INTO ${sqlId(schema)}.${sqlId(table)} (${Object.keys(row)
    .map(key => sqlId(key.toLowerCase())).join(', ')}) VALUES (${Object.values(row)
    .map(sqlValue).join(', ')});`;
}

export function encodeFixturePassword(password, storageMode) {
  // Sm3Util.encrypt uses an uppercase hex digest. Generated passwords are ASCII,
  // so its platform-default getBytes and UTF-8 give the same input bytes.
  assert.match(password, /^[a-f0-9]{36}$/, 'Fixture passwords must be 36 ASCII hex characters');
  assert.ok(['none', 'sm3'].includes(storageMode), 'Explicit none/sm3 password mode required');
  return storageMode === 'none' ? password
    : createHash('sm3').update(password, 'utf8').digest('hex').toUpperCase();
}

export function createFixture({
  runId = randomBytes(6).toString('hex'), scenario = 'two-center',
  passwordStorageMode, modelVersion, uaaSchemaMode = 'standalone-tables',
  secret = () => randomBytes(18).toString('hex'),
} = {}) {
  assert.match(runId, runPattern, 'Run ID must contain exactly 12 lowercase hex characters');
  assert.ok(['same-center', 'two-center'].includes(scenario), 'Unknown fixture scenario');
  assert.ok(['none', 'sm3'].includes(passwordStorageMode), 'Explicit none/sm3 password mode required');
  assert.ok(Number.isSafeInteger(modelVersion) && modelVersion > 0, 'Explicit positive model version required');
  assert.ok(['standalone-tables', 'legacy-views'].includes(uaaSchemaMode), 'Unknown UAA schema mode');
  const prefix = `nf_${runId}`;
  const schema = { uaa: `${prefix}_uaa`, metadata: `${prefix}_meta` };
  const mysqlContainer = `nf-${runId}-mysql`;
  const network = `nf-${runId}-private`;
  const logicalSystemId = `${prefix}_system`;
  const sentinelId = `${prefix}_module`;
  const centerA = `${prefix}_center_a`;
  const centers = scenario === 'same-center' ? [centerA] : [centerA, `${prefix}_center_b`];
  const roots = ['a', 'b'].map((side, index) => ({
    side, rootId: `${prefix}_root_${side}`, schemeId: `${prefix}_scheme_${side}`,
    centerId: centers[index] ?? centerA, modelInstanceId: `${prefix}_inst_${side}`,
    database: `${prefix}_model_${side}`, jdbcUser: `${prefix}_${side}`,
    jdbcUrl: `jdbc:mysql://${mysqlContainer}:3306/${prefix}_model_${side}?useUnicode=true&characterEncoding=UTF-8&useSSL=false`,
    modelVersion, logicalSystemId, sentinelId,
    sentinelName: `Physical ${side.toUpperCase()} ${runId}`,
    sentinelSystemName: `Physical ${side.toUpperCase()} System ${runId}`,
    sentinelTag: `${prefix}_${side}_before`,
  }));
  const credentials = { users: {}, databases: {} };
  const users = [];
  for (const root of roots) {
    credentials.databases[root.jdbcUser] = secret();
    encodeFixturePassword(credentials.databases[root.jdbcUser], 'none');
    assert.ok(root.jdbcUrl.length <= 250);
    for (const [role, suffix, accessMode] of [
      ['editor', 'e', 3], ['viewer', 'v', 1], ['no-access', 'n', null],
    ]) {
      const loginname = `${prefix}_${root.side}_${suffix}`;
      assert.ok(loginname.length <= 30, 'Published/live LOGINNAME limit exceeded');
      const id = `${prefix}_person_${root.side}_${suffix}`;
      credentials.users[loginname] = secret();
      encodeFixturePassword(credentials.users[loginname], passwordStorageMode);
      users.push({
        id, personId: id, developerId: id, userObjectId: id,
        loginname, role, centerId: root.centerId, rootId: root.rootId, schemeId: root.schemeId,
        accessMode, administrator: false,
        grantId: accessMode === null ? null : `${prefix}_grant_${root.side}_${suffix}`,
      });
    }
  }
  const rows = [];
  for (const centerId of centers) {
    const organizationId = `${centerId}_org`;
    const deployId = `${centerId}_deploy`;
    const roleId = `${centerId}_ordinary_role`;
    const domain = uaaSchemaMode === 'legacy-views'
      ? ['ibzcenter', { centerid: centerId, centername: centerId }]
      : ['sys_domain', { id: centerId, domain_name: centerId, enabled: 1 }];
    const deployment = uaaSchemaMode === 'legacy-views'
      ? ['ibzdcsystem', {
        dcsystemid: deployId, systemid: 'ibizmodeling', srfdcid: centerId,
        dcsystemname: 'Native nonadmin fixture', enabled: 1, deleted: 0,
      }]
      : ['sys_deploy_system', {
        id: deployId, system_id: 'ibizmodeling', dc: centerId,
        display_name: 'Native nonadmin fixture', enabled: 1, deleted: 0,
      }];
    const ordinaryRole = uaaSchemaMode === 'legacy-views'
      ? ['ibzrole', {
        sys_roleid: roleId, roletag: 'ROLE_NATIVE_FIXTURE', srfdcid: centerId,
        dcsystemid: deployId, sys_rolename: 'Native fixture ordinary user', enabled: 1,
        authorizeall: 0, globalflag: 0, systemflag: 0,
      }]
      : ['sys_role', {
        id: roleId, authority: 'ROLE_NATIVE_FIXTURE', dc: centerId,
        deploy_system_id: deployId, name: 'Native fixture ordinary user', enabled: 1,
      }];
    rows.push(
      [schema.uaa, ...domain],
      [schema.uaa, 'sys_organization', {
        id: organizationId, organization_name: organizationId, organization_number: `${prefix}_org`,
        dc: centerId, enabled: 1,
      }],
      [schema.uaa, ...deployment],
      [schema.uaa, ...ordinaryRole],
      [schema.metadata, 't_srfpsdevcenter', {
        psdevcenterid: centerId, psdevcentername: centerId, dctype: 'DEVCENTER',
        domainname: centerId, fulldomainname: centerId, validflag: 1, studiover: 'S0600',
      }],
    );
  }
  for (const user of users) {
    rows.push(
      [schema.uaa, 'sys_person', {
        id: user.personId, uid: user.loginname, employee_number: user.loginname,
        user_password: encodeFixturePassword(credentials.users[user.loginname], passwordStorageMode),
        display_name: user.loginname, status: '1', enabled: 1, dc: user.centerId,
        organization_id: `${user.centerId}_org`,
      }],
      [schema.uaa, 'sys_role_member', {
        id: `${user.id}_role`, dc: user.centerId, role_id: `${user.centerId}_ordinary_role`,
        member_type: 'inetOrgPerson', member_uid: user.personId,
        organization_id: `${user.centerId}_org`, member_name: user.loginname,
      }],
      [schema.metadata, 't_srfpsdevuserobj', {
        psdevuserobjid: user.userObjectId, psdevuserobjname: user.loginname,
        psdevcenterid: user.centerId, psdevuserobjtype: 'USER', enable: 1, validflag: 1,
      }],
      [schema.metadata, 't_srfpsdevuser', {
        psdevuserid: user.developerId, psdevusername: user.loginname, loginname: user.loginname,
        fullloginname: user.loginname, adminmode: 0, enable: 1,
      }],
    );
  }
  for (const root of roots) {
    rows.push(
      [schema.metadata, 't_srfpsdevsln', {
        psdevslnid: root.schemeId, psdevslnname: root.schemeId, psdevcenterid: root.centerId,
        adminpsdevuserid: null, slntype: 'DEVSYS', studiover: 'S0600',
      }],
      [schema.metadata, 't_srfpssysmodelinst', {
        pssysmodelinstid: root.modelInstanceId, pssysmodelinstname: root.modelInstanceId,
        psdevcenterid: root.centerId, connstr: root.jdbcUrl, username: root.jdbcUser,
        passwd: credentials.databases[root.jdbcUser], dbname: root.database,
        dbtype: 'MYSQL5', modelver: modelVersion,
      }],
      [schema.metadata, 't_srfpsdevslnsys', {
        psdevslnsysid: root.rootId, psdevslnsysname: root.rootId, psdevslnid: root.schemeId,
        pssystemid: logicalSystemId, pssysmodelinstid: root.modelInstanceId,
        devsysstate: 1, validflag: 1, studiover: 'S0600', expriedtime: null,
      }],
      [root.database, 't_srfpssystem', {
        pssystemid: logicalSystemId, pssystemname: root.sentinelSystemName,
        codename: 'NativeFixture', psdevcenterid: root.centerId, psdevslnid: root.schemeId,
        psdevslnsysid: root.rootId, pssysmodelinstid: root.modelInstanceId, modelver: modelVersion,
      }],
      [root.database, 't_srfpsmodule', {
        psmoduleid: sentinelId, psmodulename: root.sentinelName, codename: 'NativeFixture',
        pssystemid: logicalSystemId, modtag: root.sentinelTag,
      }],
    );
  }
  for (const user of users.filter(user => user.grantId)) {
    rows.push([schema.metadata, 't_srfpsdevslnuser', {
      psdevslnuserid: user.grantId, psdevslnusername: user.loginname,
      psdevuserobjid: user.userObjectId, psdevslnid: user.schemeId, psdevslnsysid: user.rootId,
      allsysflag: 0, accmode: user.accessMode, expiredtime: null,
    }]);
  }

  const tables = {};
  for (const [database, table, row] of rows) {
    const key = `${database}.${table}`;
    tables[key] ??= { schema: database, table, columns: {}, expectedRows: 0 };
    tables[key].expectedRows++;
    for (const [name, value] of Object.entries(row)) {
      const column = name.toLowerCase();
      const previous = tables[key].columns[column] ?? { minimumLength: 0 };
      tables[key].columns[column] = {
        minimumLength: Math.max(previous.minimumLength, typeof value === 'string' ? value.length : 0),
      };
    }
  }
  const manifest = {
    contract: 'run-owned-native-nonadmin-fixture-candidate-v1',
    runId, scenario, status: 'sql-candidate-only', nativeAcceptance: false,
    permissionAcceptance: false, sourceNativeAcceptance: false,
    schemas: { ...schema, modelA: roots[0].database, modelB: roots[1].database },
    ownership: {
      label: ownershipLabel, value: runId, mysqlContainer, network,
      privateInternalNetworkRequired: true, publishedMysqlPortsAllowed: false,
      bindMountsAllowed: false, exclusiveOwnedSchemasRequired: true,
    },
    uaaSchemaMode,
    uaaSchemaEvidence: 'Explicit seed mapping only; schema-only capture and actual UAA execution still required',
    passwordStorageMode, passwordModeEvidence: 'caller-declared; isolated UAA bean/runtime proof still required',
    modelVersion, modelVersionEvidence: 'caller-declared; schema/model version proof still required',
    identity: {
      login: 'sys_person.UID = PSDevUser.LOGINNAME; UAA DC = PSDevUserObj.PSDEVCENTERID',
      developerJoin: 'PSDevUser.PSDEVUSERID = PSDevUserObj.PSDEVUSEROBJID',
      membershipJoin: 'PSDevSlnUser.PSDEVUSEROBJID = PSDevUserObj.PSDEVUSEROBJID',
      uaaRoleJoin: 'sys_role_member.MEMBER_UID = sys_person.ID, not UID',
      personEqualsDeveloperId: 'Fixture choice for SRFPERSONID joins, not a general platform invariant',
      backendLoginUsesBareGloballyUniqueName: true,
    },
    roots, users, tableRequirements: Object.values(tables),
    schemaScope: 'Bounded identity/root/grant/module query fixture, not a complete native application schema',
    expected: {
      developerRows: 6, uaaPersonRows: 6, uaaRoleMemberRows: 6, explicitGrantRows: 4,
      administrativeDeveloperRows: 0, ownedSchemeRows: 0,
      sameLogicalSystemAndRecordIdsAcrossPhysicalDatabases: true,
      explicitZeroNegativeExpiredGrantCoverage: false,
    },
    prerequisites: [
      'Main-owned isolated MySQL/UAA/backend/cache/registry network, no shared service routing',
      'Four run-owned schemas initialized from pinned schema-only inputs; no demo/account dump data',
      'Preserve auxiliary tables used by published queries even when their foreign keys are NULL',
      'MYSQL lower_case_table_names=1 and transactional InnoDB tables',
      'Proven isolated UAA PasswordEncoder matches declared none/sm3 mode; never infer shared live mode',
      'Seed SQL and JDBC-account SQL are secret-bearing; apply only after run-owned guard succeeds',
    ],
    remainingAcceptance: [
      'Actual isolated UAA /auths/login, /auths/user-info/self, and backend authenticated appdata',
      'Nonadmin CRUD own/foreign roots in same-center and two-center runs',
      'Both physical database before/after row checks including denied-operation non-mutation',
      'Explicit zero/negative/expired/absent grants and forged root/system IDs',
      'Session vs scoped holder conflict, legitimate nested holder restore, canonical remap/cache rotation',
      'Separate authentic-source/build/native receipts; SQL generation cannot satisfy them',
    ],
  };
  const seedSQL = [
    '-- Secret-bearing candidate. No schema DDL, demo rows, upsert, update, or delete.',
    'SET NAMES utf8mb4;', 'START TRANSACTION;',
    ...rows.map(([database, table, row]) => insert(database, table, row)),
    'COMMIT;', '',
  ].join('\n');
  const accountSQL = [
    '-- Nontransactional: run only in the labeled private MySQL after all schema checks pass.',
    '-- Never retry a partial provision against the same run; preserve evidence and retire the run.',
    ...roots.flatMap(root => [
      `CREATE USER '${root.jdbcUser}'@'%' IDENTIFIED BY '${credentials.databases[root.jdbcUser]}';`,
      // Database-level GRANT treats "_" as a wildcard. Escape generated schema
      // underscores so A's JDBC principal cannot inherit access to a lookalike DB.
      `GRANT SELECT, INSERT, UPDATE, DELETE ON \`${root.database.replaceAll('_', '\\_')}\`.* TO '${root.jdbcUser}'@'%';`,
    ]), '',
  ].join('\n');
  const dev = `${sqlId(schema.metadata)}.${sqlId('t_srfpsdevuser')}`;
  const objects = `${sqlId(schema.metadata)}.${sqlId('t_srfpsdevuserobj')}`;
  const grants = `${sqlId(schema.metadata)}.${sqlId('t_srfpsdevslnuser')}`;
  const person = `${sqlId(schema.uaa)}.${sqlId('sys_person')}`;
  const member = `${sqlId(schema.uaa)}.${sqlId('sys_role_member')}`;
  const roles = `${sqlId(schema.uaa)}.${sqlId('sys_role')}`;
  const deploy = `${sqlId(schema.uaa)}.${sqlId('sys_deploy_system')}`;
  const verifySQL = [
    '-- Read-only join/routing evidence. This does not exercise HTTP authorization.',
    `SELECT p.ID AS person_id, p.UID, p.DC, d.PSDEVUSERID, d.ADMINMODE, o.PSDEVCENTERID,`,
    'g.PSDEVSLNSYSID, g.ALLSYSFLAG, g.ACCMODE, g.EXPIREDTIME',
    `FROM ${person} p JOIN ${dev} d ON d.LOGINNAME=p.UID`,
    `JOIN ${objects} o ON o.PSDEVUSEROBJID=d.PSDEVUSERID AND o.PSDEVCENTERID=p.DC`,
    `LEFT JOIN ${grants} g ON g.PSDEVUSEROBJID=o.PSDEVUSEROBJID ORDER BY p.UID;`,
    `SELECT p.UID, p.DC, r.ID AS role_id, r.AUTHORITY, ds.ID AS deploy_id, ds.SYSTEM_ID`,
    `FROM ${person} p JOIN ${member} m ON m.MEMBER_UID=p.ID AND m.MEMBER_TYPE='inetOrgPerson'`,
    `JOIN ${roles} r ON r.ID=m.ROLE_ID AND r.DC=p.DC`,
    `JOIN ${deploy} ds ON ds.ID=r.DEPLOY_SYSTEM_ID AND ds.DC=p.DC ORDER BY p.UID;`,
    `SELECT s.PSDEVSLNSYSID, sl.PSDEVCENTERID, s.PSSYSTEMID, s.PSSYSMODELINSTID, i.DBNAME, i.USERNAME, i.MODELVER`,
    `FROM ${sqlId(schema.metadata)}.t_srfpsdevslnsys s`,
    `JOIN ${sqlId(schema.metadata)}.t_srfpsdevsln sl ON sl.PSDEVSLNID=s.PSDEVSLNID`,
    `JOIN ${sqlId(schema.metadata)}.t_srfpssysmodelinst i ON i.PSSYSMODELINSTID=s.PSSYSMODELINSTID`,
    'ORDER BY s.PSDEVSLNSYSID;',
    ...roots.map(root => `SELECT '${root.database}' AS physical_schema, PSMODULEID, PSSYSTEMID, PSMODULENAME, MODTAG FROM ${sqlId(root.database)}.t_srfpsmodule;`),
    ...Object.values(tables).map(table =>
      `SELECT '${table.schema}.${table.table}' AS fixture_table, COUNT(*) AS row_count FROM ${sqlId(table.schema)}.${sqlId(table.table)};`),
    ...roots.map(root => `SHOW GRANTS FOR '${root.jdbcUser}'@'%';`),
    '',
  ].join('\n');
  return { manifest, credentials, seedSQL, accountSQL, verifySQL };
}

export function validateOwnedTarget(manifest, container, network, peers = [], volumes = []) {
  const owner = manifest.ownership;
  assert.match(manifest.runId, runPattern);
  assert.equal(owner.label, ownershipLabel);
  assert.equal(owner.value, manifest.runId);
  assert.equal(owner.mysqlContainer, `nf-${manifest.runId}-mysql`);
  assert.equal(owner.network, `nf-${manifest.runId}-private`);
  assert.equal(container.Name, `/${owner.mysqlContainer}`, 'Only the exact run-owned MySQL is allowed');
  assert.equal(container.Config?.Labels?.[ownershipLabel], manifest.runId, 'MySQL lacks run ownership');
  assert.equal(container.State?.Running, true, 'Run-owned MySQL must be running');
  assert.equal(container.HostConfig?.Privileged, false, 'Privileged MySQL is not an isolated target');
  assert.ok(!Object.values(container.HostConfig?.PortBindings ?? {}).some(value => value?.length),
    'Published MySQL ports are forbidden');
  assert.ok(!Object.values(container.NetworkSettings?.Ports ?? {}).some(value => value?.length),
    'Published MySQL ports are forbidden');
  assert.deepEqual(Object.keys(container.NetworkSettings?.Networks ?? {}), [owner.network],
    'MySQL must connect only to its private network');
  assert.equal(network.Name, owner.network);
  assert.equal(container.NetworkSettings.Networks[owner.network].NetworkID, network.Id);
  assert.equal(network.Labels?.[ownershipLabel], manifest.runId, 'Network lacks run ownership');
  assert.equal(network.Internal, true, 'Private network must be internal');
  assert.equal(network.Driver, 'bridge', 'Only an isolated bridge network is supported');
  assert.ok(!container.HostConfig?.Binds?.length, 'Host bind mounts are forbidden');
  assert.ok(!container.HostConfig?.VolumesFrom?.length, 'Inherited mounts are forbidden');
  assert.ok(network.Containers?.[container.Id], 'MySQL missing from network membership');
  const known = new Map([container, ...peers].map(peer => [peer.Id, peer]));
  for (const id of Object.keys(network.Containers ?? {})) {
    const peer = known.get(id);
    assert.ok(peer, 'Uninspected network peer');
    assert.equal(peer.Config?.Labels?.[ownershipLabel], manifest.runId, 'Foreign network peer');
    assert.equal(peer.State?.Running, true, 'Unready network peer');
    assert.deepEqual(Object.keys(peer.NetworkSettings?.Networks ?? {}), [owner.network],
      'A run-owned peer must not bridge a shared/external network');
  }
  for (const mount of container.Mounts ?? []) {
    assert.ok(['volume', 'tmpfs'].includes(mount.Type), 'Bind/unknown MySQL mounts are forbidden');
    if (mount.Type === 'volume') {
      assert.ok(mount.Name?.startsWith(`nf-${manifest.runId}-`), 'Foreign volume name');
      const volume = volumes.find(value => value.Name === mount.Name);
      assert.equal(volume?.Driver, 'local');
      assert.equal(volume?.Labels?.[ownershipLabel], manifest.runId, 'Volume lacks run ownership');
      assert.ok(!Object.keys(volume?.Options ?? {}).length, 'Mounted device/NFS volumes forbidden');
    }
  }
  return true;
}

function docker(execute, args, input) {
  const result = execute('docker', args, {
    input, encoding: 'utf8', timeout: 60_000, maxBuffer: 32 * 1024 * 1024,
  });
  assert.ok(!result.error && result.status === 0, 'Read-only Docker preflight failed (credentials suppressed)');
  return result.stdout;
}

export function preflightOwnedMysql(manifest, execute = spawnSync) {
  const name = manifest.ownership.mysqlContainer;
  const container = JSON.parse(docker(execute, ['inspect', name]))[0];
  const network = JSON.parse(docker(execute, ['network', 'inspect', manifest.ownership.network]))[0];
  const peers = Object.keys(network.Containers ?? {}).filter(id => id !== container.Id);
  const inspectedPeers = peers.length ? JSON.parse(docker(execute, ['inspect', ...peers])) : [];
  const mounts = (container.Mounts ?? []).filter(mount => mount.Type === 'volume');
  const volumes = mounts.length
    ? JSON.parse(docker(execute, ['volume', 'inspect', ...mounts.map(mount => mount.Name)])) : [];
  validateOwnedTarget(manifest, container, network, inspectedPeers, volumes);
  const readSQL = sql => docker(execute, [
    'exec', '-i', container.Id, 'sh', '-c',
    'test -n "$MYSQL_ROOT_PASSWORD" && MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -uroot --batch --raw --skip-column-names',
  ], sql);
  const version = readSQL('SELECT @@lower_case_table_names, @@version;\n').trim().split('\t');
  assert.equal(version[0], '1', 'Published uppercase queries and lowercase dump require lower_case_table_names=1');
  const schemas = Object.values(manifest.schemas);
  for (const schema of schemas) {
    assert.ok(schema.startsWith(`nf_${manifest.runId}_`), 'Foreign schema is forbidden');
    sqlId(schema);
  }
  const metadataSQL = [
    'SELECT c.TABLE_SCHEMA, c.TABLE_NAME, c.COLUMN_NAME, c.DATA_TYPE,',
    'COALESCE(c.CHARACTER_MAXIMUM_LENGTH,0), c.IS_NULLABLE,',
    "IF(c.COLUMN_DEFAULT IS NULL, 'NO_DEFAULT', 'HAS_DEFAULT'), c.EXTRA, t.ENGINE",
    'FROM information_schema.COLUMNS c JOIN information_schema.TABLES t',
    'ON t.TABLE_SCHEMA=c.TABLE_SCHEMA AND t.TABLE_NAME=c.TABLE_NAME',
    `WHERE c.TABLE_SCHEMA IN (${schemas.map(sqlValue).join(',')});`,
    '',
  ].join('\n');
  const lines = readSQL(metadataSQL).trim();
  const tables = new Map();
  for (const line of lines ? lines.split('\n') : []) {
    const [schema, table, column, type, length, nullable, defaultValue, extra, engine] = line.split('\t');
    const key = `${schema}.${table.toLowerCase()}`;
    tables.set(key, [...(tables.get(key) ?? []), {
      column: column.toLowerCase(), type, length: Number(length), nullable, defaultValue, extra, engine,
    }]);
  }
  for (const table of manifest.tableRequirements) {
    const columns = tables.get(`${table.schema}.${table.table}`);
    assert.ok(columns, `Missing schema-only table: ${table.schema}.${table.table}`);
    for (const column of columns) {
      assert.equal(column.engine, 'InnoDB', 'Transactional table required');
      const input = table.columns[column.column];
      assert.ok(input || column.nullable === 'YES' || column.defaultValue === 'HAS_DEFAULT'
        || column.extra?.includes('auto_increment') || column.extra?.includes('GENERATED'),
      `Additional mandatory column needs provisioning: ${table.table}.${column.column}`);
    }
    for (const [name, requirement] of Object.entries(table.columns)) {
      const column = columns.find(column => column.column === name);
      assert.ok(column, `Missing required column: ${table.table}.${name}`);
      assert.ok(!column.length || column.length >= requirement.minimumLength,
        `Column too short: ${table.table}.${name}`);
    }
  }
  // Check every table in all four schemas, not only directly seeded tables:
  // inherited member/authority/demo data would invalidate the nonadmin premise.
  for (const key of tables.keys()) {
    const [schema, table] = key.split('.');
    const count = readSQL(`SELECT COUNT(*) FROM ${sqlId(schema)}.${sqlId(table)};\n`).trim();
    assert.equal(count, '0', `Schema-only target must be empty: ${key}`);
  }
  const jdbcUsers = manifest.roots.map(root => root.jdbcUser);
  const existingUsers = readSQL(`SELECT COUNT(*) FROM mysql.user WHERE User IN (${jdbcUsers.map(sqlValue).join(',')});\n`).trim();
  assert.equal(existingUsers, '0', 'JDBC accounts already exist; use a fresh run');
  return {
    status: 'passed-read-only-owned-schema-preflight', mysqlId: container.Id, networkId: network.Id,
    mysqlVersion: version[1], checkedTables: tables.size, provisioned: false,
    nativeAcceptance: false, permissionAcceptance: false,
    boundary: 'Labels are a cooperative ownership contract, not a defense against same-UID/root actors or concurrent target changes. Recheck immediately before main-owned provisioning.',
  };
}

function assertDirectories(path, create = false) {
  const absolute = resolve(path);
  let cursor = parse(absolute).root;
  for (const part of relative(cursor, absolute).split(sep).filter(Boolean)) {
    cursor = join(cursor, part);
    try {
      const stat = lstatSync(cursor);
      assert.ok(!stat.isSymbolicLink() && stat.isDirectory(), 'Artifact ancestors must be real directories');
    } catch (error) {
      if (error.code !== 'ENOENT' || !create) throw error;
      mkdirSync(cursor, { mode: 0o700 });
    }
  }
}

function writePrivate(path, bytes) {
  const descriptor = openSync(path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    writeFileSync(descriptor, bytes);
  } finally {
    closeSync(descriptor);
  }
}

export function writeFixtureCandidate(fixture, { workspace = workspaceRoot } = {}) {
  const base = join(workspace, '.artifacts', 'native-nonadmin-fixtures');
  assertDirectories(base, true);
  const output = join(base, fixture.manifest.runId);
  // A repeated run never overwrites evidence or secret material.
  mkdirSync(output, { mode: 0o700 });
  const files = {
    'manifest.json': json(fixture.manifest), 'credentials.private.json': json(fixture.credentials),
    '01-seed.private.sql': fixture.seedSQL, '02-jdbc-accounts.private.sql': fixture.accountSQL,
    '03-verify.sql': fixture.verifySQL,
  };
  const receipt = {
    contract: fixture.manifest.contract, runId: fixture.manifest.runId,
    status: 'sql-candidate-only', createdAt: new Date().toISOString(),
    provisioned: false, nativeAcceptance: false, permissionAcceptance: false,
    files: {},
  };
  for (const [name, contents] of Object.entries(files)) {
    writePrivate(join(output, name), contents);
    receipt.files[name] = { bytes: Buffer.byteLength(contents), sha256: hash(contents) };
  }
  writePrivate(join(output, 'report.json'), json(receipt));
  return { output, receipt };
}

function parseArguments(args) {
  const options = {};
  for (const arg of args) {
    if (arg === '--check-owned-mysql') {
      assert.equal(options.checkOwnedMysql, undefined, 'Duplicate option');
      options.checkOwnedMysql = true;
      continue;
    }
    const match = /^--(run-id|scenario|password-storage-mode|model-version|uaa-schema-mode)=(.+)$/.exec(arg);
    assert.ok(match, 'Only candidate generation and read-only --check-owned-mysql are supported; no apply');
    const key = match[1];
    assert.equal(options[key], undefined, 'Duplicate option');
    options[key] = match[2];
  }
  assert.ok(/^[1-9][0-9]*$/.test(options['model-version'] ?? ''), 'Explicit positive model version required');
  assert.ok(['standalone-tables', 'legacy-views'].includes(options['uaa-schema-mode']),
    'Explicit --uaa-schema-mode=standalone-tables|legacy-views required');
  return options;
}

export function main(args = process.argv.slice(2)) {
  const options = parseArguments(args);
  const fixture = createFixture({
    runId: options['run-id'], scenario: options.scenario,
    passwordStorageMode: options['password-storage-mode'],
    modelVersion: Number(options['model-version']),
    uaaSchemaMode: options['uaa-schema-mode'],
  });
  const { output } = writeFixtureCandidate(fixture);
  if (options.checkOwnedMysql) {
    try {
      writePrivate(join(output, 'owned-preflight.json'), json(preflightOwnedMysql(fixture.manifest)));
    } catch (error) {
      writePrivate(join(output, 'owned-preflight.json'), json({
        status: 'failed-read-only-owned-preflight', error: error.message,
        provisioned: false, nativeAcceptance: false, permissionAcceptance: false,
      }));
      throw error;
    }
  }
  return { output, status: 'sql-candidate-only', provisioned: false, nativeAcceptance: false };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try {
    console.log(json(main()).trim());
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
