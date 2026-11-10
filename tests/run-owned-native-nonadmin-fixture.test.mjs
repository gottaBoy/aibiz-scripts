import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  createFixture, encodeFixturePassword, ownershipLabel, preflightOwnedMysql,
  validateOwnedTarget, writeFixtureCandidate,
} from '../prepare-run-owned-native-nonadmin-fixture.mjs';
import {
  createSchemaBootstrap, extractModelDDL, modelSchemaTables, publishedQueries,
  remapObservedView, validateCleanupResources,
} from './run-owned-native-nonadmin-fixture.sql.mjs';

const runId = 'f01006abcdef';
const workspace = fileURLToPath(new URL('../../', import.meta.url));
const modelDump = 'modelingservice/sql/sCloud9471c1eca.sql';
const options = { runId, passwordStorageMode: 'sm3', modelVersion: 124, secret: () => '1'.repeat(36) };
const candidate = () => createFixture(options);

function ownedTarget(manifest) {
  const container = {
    Id: 'owned-container-id', Name: `/${manifest.ownership.mysqlContainer}`,
    Config: { Labels: { [ownershipLabel]: runId } }, State: { Running: true },
    HostConfig: { Privileged: false, PortBindings: {} }, Mounts: [],
    NetworkSettings: {
      Ports: { '3306/tcp': null }, Networks: { [manifest.ownership.network]: { NetworkID: 'owned-network-id' } },
    },
  };
  const network = {
    Id: 'owned-network-id', Name: manifest.ownership.network, Internal: true, Driver: 'bridge',
    Labels: { [ownershipLabel]: runId }, Containers: { [container.Id]: {} },
  };
  return { container, network };
}

function mockDocker(manifest, { count = '0', mutate, columnMutate } = {}) {
  const target = ownedTarget(manifest);
  mutate?.(target);
  const calls = [];
  const execute = (command, args, options) => {
    calls.push({ command, args, input: options.input });
    assert.equal(command, 'docker');
    if (args[0] === 'inspect') return { status: 0, stdout: JSON.stringify([target.container]) };
    if (args[0] === 'network') return { status: 0, stdout: JSON.stringify([target.network]) };
    assert.equal(args[0], 'exec');
    assert.equal(args[2], target.container.Id, 'Read by inspected ID, never re-resolved name');
    const sql = options.input;
    assert.ok(/^(SELECT|[\s\n]*SELECT)/.test(sql));
    assert.doesNotMatch(sql, /(?:^|\s)(INSERT|UPDATE|DELETE|DROP|CREATE|GRANT|ALTER)\s/i);
    if (sql.includes('@@lower_case_table_names')) return { status: 0, stdout: '1\t5.7.26\n' };
    if (sql.includes('information_schema.COLUMNS')) {
      const rows = manifest.tableRequirements.flatMap(table =>
        Object.keys(table.columns).map(column => [
          table.schema, table.table, column, 'varchar', '512', 'YES', 'NO_DEFAULT', '', 'InnoDB',
        ]));
      columnMutate?.(rows);
      return { status: 0, stdout: `${rows.map(row => row.join('\t')).join('\n')}\n` };
    }
    return { status: 0, stdout: `${count}\n` };
  };
  return { execute, calls };
}

test('explicit proven-mode selection and positive model version are mandatory', () => {
  for (const override of [
    { passwordStorageMode: undefined }, { passwordStorageMode: 'md5' }, { modelVersion: undefined },
    { modelVersion: 0 }, { runId: 'opensource' }, { scenario: 'other' }, { uaaSchemaMode: 'unknown' },
  ]) assert.throws(() => createFixture({ ...options, ...override }));
});

test('SM3 uses the source uppercase digest, with no default encoder inference', () => {
  const password = '1'.repeat(36);
  assert.equal(encodeFixturePassword(password, 'sm3'),
    createHash('sm3').update(password).digest('hex').toUpperCase());
  assert.equal(encodeFixturePassword(password, 'none'), password);
  assert.throws(() => encodeFixturePassword('x'.repeat(64), 'sm3'));
});

test('two-center and same-center independently retain two physical model databases', () => {
  for (const scenario of ['same-center', 'two-center']) {
    const { manifest } = createFixture({ ...options, scenario });
    assert.equal(new Set(manifest.roots.map(root => root.database)).size, 2);
    assert.equal(new Set(manifest.roots.map(root => root.centerId)).size, scenario === 'same-center' ? 1 : 2);
    assert.equal(new Set(manifest.roots.map(root => root.logicalSystemId)).size, 1);
    assert.equal(new Set(manifest.roots.map(root => root.sentinelId)).size, 1);
    assert.equal(new Set(manifest.roots.map(root => root.sentinelName)).size, 2);
    assert.equal(manifest.nativeAcceptance, false);
    assert.equal(manifest.permissionAcceptance, false);
  }
});

test('six globally unique bare users join by person/object ID; no admin or owner shortcut', () => {
  const { manifest, seedSQL } = candidate();
  assert.equal(manifest.users.length, 6);
  assert.equal(new Set(manifest.users.map(user => user.loginname)).size, 6);
  for (const user of manifest.users) {
    assert.equal(user.administrator, false);
    assert.ok(user.loginname.length <= 30);
    assert.doesNotMatch(user.loginname, /[|]|admin|aibizhi/i);
    assert.equal(user.personId, user.developerId);
    assert.equal(user.developerId, user.userObjectId);
    assert.equal(user.grantId === null, user.role === 'no-access');
    assert.equal(user.accessMode, { editor: 3, viewer: 1, 'no-access': null }[user.role]);
  }
  assert.equal(manifest.expected.explicitGrantRows, 4);
  assert.doesNotMatch(seedSQL, /ROLE_SUPERADMIN|ROLE_APIUSERS|WXMP_USERS|demo_admin/i);
  assert.equal(manifest.expected.explicitZeroNegativeExpiredGrantCoverage, false);
});

test('generated DML is transaction-only without DDL/upserts or credential output in manifest', () => {
  const { manifest, credentials, seedSQL, verifySQL } = candidate();
  assert.match(seedSQL, /START TRANSACTION;[\s\S]*COMMIT;/);
  assert.doesNotMatch(seedSQL, /(?:^|\n)(CREATE|DROP|UPDATE|DELETE|REPLACE|GRANT|ALTER)\s/);
  assert.doesNotMatch(seedSQL, /ON DUPLICATE KEY/);
  assert.doesNotMatch(JSON.stringify(manifest), new RegExp(credentials.users[manifest.users[0].loginname]));
  assert.match(verifySQL, /m\.MEMBER_UID=p\.ID AND m\.MEMBER_TYPE='inetOrgPerson'/);
  assert.match(verifySQL, /o\.PSDEVCENTERID=p\.DC/);
  assert.doesNotMatch(verifySQL, /USER_PASSWORD|PASSWD|CONNSTR/);
  assert.match(seedSQL, /`organization_name`/);
  assert.doesNotMatch(seedSQL, /`org_name`/);
});

test('new fixture people have actual operator codes rather than projection fallback values', () => {
  const { manifest, seedSQL } = candidate();
  const people = seedSQL.split('\n').filter(line => line.includes('.`sys_person` '));
  assert.equal(people.length, 6);
  const sqlText = value => `CONVERT(X'${Buffer.from(value).toString('hex')}' USING utf8mb4)`;
  for (const user of manifest.users) {
    const row = people.find(line => line.includes(sqlText(user.personId)));
    assert.ok(row);
    assert.match(row, /`uid`, `employee_number`/);
    assert.ok(row.includes(`${sqlText(user.loginname)}, ${sqlText(user.loginname)}`));
  }
  const columns = manifest.tableRequirements.find(row => row.table === 'sys_person').columns;
  assert.ok(Object.hasOwn(columns, 'employee_number'));
});

test('metadata bootstrap includes the complete scheme-view deployment-center dependency', () => {
  assert.ok(modelSchemaTables.metadata.includes('t_srfpsdcdeploycenter'));
  const { manifest } = candidate();
  const dump = readFileSync(join(workspace, modelDump), 'utf8');
  const ddl = extractModelDDL(dump, 't_srfpsdcdeploycenter');
  assert.match(ddl, /`PSDCDEPLOYCENTERID` varchar\(100\) NOT NULL/);
  assert.match(createSchemaBootstrap(manifest, [], dump), /CREATE TABLE `t_srfpsdcdeploycenter`/);
});

test('physical-model bootstrap includes real validation and model-change-log dependencies', () => {
  const dump = readFileSync(join(workspace, modelDump), 'utf8');
  for (const table of ['t_srfpsdbvalueop', 't_srfpssysmodellog']) {
    assert.ok(modelSchemaTables.physicalModel.includes(table));
    const ddl = extractModelDDL(dump, table);
    assert.match(ddl, /PRIMARY KEY/);
    assert.doesNotMatch(ddl, /\nINSERT/);
  }
});

test('legacy UAA seeds true backing tables and never writes computed domain ENABLED via a view', () => {
  const { manifest, seedSQL } = createFixture({ ...options, uaaSchemaMode: 'legacy-views' });
  assert.equal(manifest.uaaSchemaMode, 'legacy-views');
  for (const table of ['ibzcenter', 'ibzdcsystem', 'ibzrole']) {
    assert.ok(manifest.tableRequirements.some(requirement => requirement.table === table));
    assert.ok(seedSQL.includes(`.\`${table}\``));
  }
  for (const view of ['sys_domain', 'sys_role', 'sys_deploy_system', 'sys_granted_authority']) {
    assert.ok(!manifest.tableRequirements.some(requirement => requirement.table === view));
    assert.ok(!seedSQL.includes(`.\`${view}\``));
  }
  assert.match(seedSQL, /`authorizeall`, `globalflag`, `systemflag`/);
  assert.equal(manifest.nativeAcceptance, false);
});

test('observed view remapping preserves the SELECT and definer-security contract without shared references', () => {
  const original = 'CREATE ALGORITHM=UNDEFINED DEFINER=`source`@`%` SQL SECURITY DEFINER VIEW '
    + '`source`.`sys_domain` AS select `t1`.`CENTERID` AS `ID`,1 AS `ENABLED` from `source`.`ibzcenter` `t1`';
  const output = `sys_domain\t${original}\tutf8mb4\tutf8mb4_general_ci\n`;
  const options = { view: 'sys_domain', sourceSchema: 'source', targetSchema: 'nf_target_uaa' };
  const remapped = remapObservedView(output, options);
  assert.ok(!remapped.includes('`source`.'));
  assert.ok(remapped.startsWith('CREATE ALGORITHM=UNDEFINED DEFINER=CURRENT_USER SQL SECURITY DEFINER VIEW '));
  assert.equal(remapped.split(' AS select ')[1],
    `${original.split(' AS select ')[1].replaceAll('`source`.', '`nf_target_uaa`.')};`);
  for (const bad of [
    output.replace('SQL SECURITY DEFINER', 'SQL SECURITY INVOKER'),
    output.replace('`source`.`ibzcenter`', '`shared`.`ibzcenter`'),
    output.replace('`source`.`ibzcenter`', '`source`.`ibzdcsystem`'),
    output.replace('AS select ', 'AS select sleep(1),'),
    output.replace('utf8mb4_general_ci', 'latin1_swedish_ci'),
  ]) assert.throws(() => remapObservedView(bad, options));
  assert.throws(() => remapObservedView(output, { ...options, view: 'arbitrary' }));
});

test('model schema extraction copies only allowlisted CREATE TABLE statements, never dump rows', () => {
  const dump = readFileSync(new URL('../../modelingservice/sql/sCloud9471c1eca.sql', import.meta.url), 'utf8');
  const ddl = extractModelDDL(dump, 't_srfpsmodule');
  assert.ok(ddl.startsWith('CREATE TABLE `t_srfpsmodule` ('));
  assert.match(ddl, /ENGINE=InnoDB/);
  assert.doesNotMatch(ddl, /\n(?:INSERT|UPDATE|DELETE|DROP)\s/i);
  assert.throws(() => extractModelDDL(dump, 'mysql.user'));
});

test('bounded schema covers grant-template and module joins in the correct physical databases', () => {
  const { manifest } = candidate();
  const dump = readFileSync(new URL('../../modelingservice/sql/sCloud9471c1eca.sql', import.meta.url), 'utf8');
  const bootstrap = createSchemaBootstrap(manifest, [], dump);
  const metadata = bootstrap.split(`USE \`${manifest.schemas.metadata}\`;`)[1]
    .split(`USE \`${manifest.schemas.modelA}\`;`)[0];
  const physicalA = bootstrap.split(`USE \`${manifest.schemas.modelA}\`;`)[1]
    .split(`USE \`${manifest.schemas.modelB}\`;`)[0];
  const physicalB = bootstrap.split(`USE \`${manifest.schemas.modelB}\`;`)[1];
  assert.ok(modelSchemaTables.metadata.includes('t_srfpsdevslntempl'));
  for (const table of modelSchemaTables.metadata) {
    assert.ok(metadata.includes(`CREATE TABLE \`${table}\``));
  }
  for (const table of modelSchemaTables.physicalModel) {
    if (!modelSchemaTables.metadata.includes(table)) assert.ok(!metadata.includes(`CREATE TABLE \`${table}\``));
    for (const sql of [physicalA, physicalB]) assert.ok(sql.includes(`CREATE TABLE \`${table}\``));
  }
  assert.doesNotMatch(bootstrap, /\n(?:INSERT|UPDATE|DELETE|DROP|LOCK|UNLOCK)\s/i);
  assert.throws(() => createSchemaBootstrap({
    ...manifest, schemas: { ...manifest.schemas, modelA: 'shared_business' },
  }, [], dump), /Foreign schema/);
});

test('every reviewed published identity/root/grant/module query has its schema-only dependencies', () => {
  const base = new URL('../../vendor-upstream/ibizmodeling-standard/modelapi-core/src/main/resources/model/net/ibizsys/modeling/', import.meta.url);
  assert.deepEqual(publishedQueries.map(query => query.entity),
    ['PSDevUser', 'PSDevUserObj', 'PSDevSlnSys', 'PSDevSlnUser', 'PSModule']);
  for (const specification of publishedQueries) {
    const query = JSON.parse(readFileSync(new URL(specification.path, base))).queryCode;
    const dependencies = [...query.matchAll(/(?:FROM|JOIN)\s+`([^`]+)`/g)]
      .map(([, table]) => table.toLowerCase());
    assert.ok(dependencies.length > 0);
    for (const table of dependencies) {
      assert.ok(modelSchemaTables[specification.target].includes(table),
        `${specification.entity} requires ${table} in ${specification.target}`);
    }
  }
});

test('both physical system rows preserve identical logical ID and distinct joined sentinels', () => {
  const { manifest, seedSQL } = candidate();
  for (const root of manifest.roots) {
    const requirement = manifest.tableRequirements.find(table =>
      table.schema === root.database && table.table === 't_srfpssystem');
    assert.equal(requirement.expectedRows, 1);
    assert.ok(seedSQL.includes(`INSERT INTO \`${root.database}\`.\`t_srfpssystem\``));
    assert.ok(requirement.columns.psdevslnsysid);
    assert.ok(requirement.columns.psdevcenterid);
  }
  assert.equal(new Set(manifest.roots.map(root => root.sentinelSystemName)).size, 2);
  assert.match(manifest.schemaScope, /not a complete native application schema/);
  assert.equal(manifest.sourceNativeAcceptance, false);
});

test('JDBC grants escape schema underscores and are restricted to each physical schema', () => {
  const { manifest, accountSQL } = candidate();
  for (const root of manifest.roots) {
    assert.ok(root.jdbcUrl.length <= 250);
    assert.match(root.jdbcUrl, /\?useUnicode=true/);
    assert.ok(accountSQL.includes(`\`${root.database.replaceAll('_', '\\_')}\`.*`));
  }
  assert.doesNotMatch(accountSQL, /GRANT (ALL|.*\*\.|.*WITH GRANT)/);
  assert.doesNotMatch(accountSQL, /IF NOT EXISTS|ALTER USER|DROP USER/);
});

test('run-owned guard accepts the exact isolated target and rejects shared/foreign targets', () => {
  const { manifest } = candidate();
  const good = ownedTarget(manifest);
  assert.equal(validateOwnedTarget(manifest, good.container, good.network), true);
  for (const change of [
    target => { target.container.Name = '/mysql'; },
    target => { target.container.Config.Labels = {}; },
    target => { target.container.HostConfig.PortBindings = { '3306/tcp': [{ HostPort: '3306' }] }; },
    target => { target.container.HostConfig.Privileged = true; },
    target => { target.container.HostConfig.Binds = ['/shared:/var/lib/mysql']; },
    target => { target.container.HostConfig.VolumesFrom = ['mysql']; },
    target => { target.container.Mounts = [{ Type: 'bind', Source: '/shared', Destination: '/var/lib/mysql' }]; },
    target => { target.container.NetworkSettings.Networks.shared = {}; },
    target => { target.network.Internal = false; },
    target => { target.network.Labels = {}; },
    target => { target.network.Containers.foreign = {}; },
    target => { target.container.NetworkSettings.Networks[manifest.ownership.network].NetworkID = 'foreign'; },
  ]) {
    const target = ownedTarget(manifest);
    change(target);
    assert.throws(() => validateOwnedTarget(manifest, target.container, target.network));
  }
});

test('labeled peers cannot silently bridge a shared network', () => {
  const { manifest } = candidate();
  const { container, network } = ownedTarget(manifest);
  const peer = structuredClone(container);
  peer.Id = 'owned-uaa-id';
  network.Containers[peer.Id] = {};
  assert.equal(validateOwnedTarget(manifest, container, network, [peer]), true);
  peer.NetworkSettings.Networks.shared = { NetworkID: 'shared-network' };
  assert.throws(() => validateOwnedTarget(manifest, container, network, [peer]));
});
test('unlabeled or external-backed Docker volumes cannot establish ownership', () => {
  const { manifest } = candidate();
  const { container, network } = ownedTarget(manifest);
  const name = `nf-${runId}-mysql-data`;
  container.Mounts = [{ Type: 'volume', Name: name }];
  const volume = { Name: name, Driver: 'local', Labels: { [ownershipLabel]: runId }, Options: {} };
  assert.equal(validateOwnedTarget(manifest, container, network, [], [volume]), true);
  assert.throws(() => validateOwnedTarget(manifest, container, network, [], []));
  assert.throws(() => validateOwnedTarget(manifest, container, network, [], [{ ...volume, Options: { device: '/shared' } }]));
});

test('retained-run cleanup validates immutable IDs/ownership and refuses integration peers', () => {
  const { manifest } = candidate();
  const target = ownedTarget(manifest);
  target.container.Id = 'a'.repeat(64);
  target.network.Id = 'b'.repeat(64);
  target.container.NetworkSettings.Networks[manifest.ownership.network].NetworkID = target.network.Id;
  target.network.Containers = { [target.container.Id]: {} };
  const resources = {
    contract: 'run-owned-native-fixture-resources-v1', runId,
    mysqlId: target.container.Id, networkId: target.network.Id,
    mysqlName: manifest.ownership.mysqlContainer, networkName: manifest.ownership.network,
    schemas: manifest.schemas,
  };
  assert.equal(validateCleanupResources(manifest, resources, target.container, target.network), true);
  for (const mutate of [
    value => { value.container.Id = 'c'.repeat(64); },
    value => { value.network.Id = 'c'.repeat(64); },
    value => { value.network.Containers.integration = {}; },
    value => { value.container.Config.Labels = {}; },
  ]) {
    const clone = structuredClone(target);
    mutate(clone);
    assert.throws(() => validateCleanupResources(manifest, resources, clone.container, clone.network));
  }
  assert.throws(() => validateCleanupResources(manifest,
    { ...resources, schemas: { ...resources.schemas, uaa: 'shared' } }, target.container, target.network));
});
test('read-only preflight checks all tables and never issues provisioning SQL', () => {
  const { manifest } = candidate();
  const { execute, calls } = mockDocker(manifest);
  const receipt = preflightOwnedMysql(manifest, execute);
  assert.equal(receipt.status, 'passed-read-only-owned-schema-preflight');
  assert.equal(receipt.provisioned, false);
  assert.equal(receipt.nativeAcceptance, false);
  assert.equal(receipt.checkedTables, manifest.tableRequirements.length);
  assert.ok(calls.some(call => call.input?.includes('mysql.user')));
});

test('ownership failure occurs before any SQL reaches a target', () => {
  const { manifest } = candidate();
  const { execute, calls } = mockDocker(manifest, {
    mutate: ({ container }) => { container.Name = '/mysql'; },
  });
  assert.throws(() => preflightOwnedMysql(manifest, execute));
  assert.equal(calls.filter(call => call.args[0] === 'exec').length, 0);
});

test('dirty schema, missing/short/additional mandatory columns fail rather than weaken checks', () => {
  const { manifest } = candidate();
  assert.throws(() => preflightOwnedMysql(manifest, mockDocker(manifest, { count: '1' }).execute));
  for (const columnMutate of [
    rows => rows.splice(0, 1),
    rows => { rows[0][4] = '1'; },
    rows => rows.push([rows[0][0], rows[0][1], 'mandatory_new_field', 'varchar', '100', 'NO', 'NO_DEFAULT', '', 'InnoDB']),
    rows => { rows[0][8] = 'MyISAM'; },
  ]) assert.throws(() => preflightOwnedMysql(manifest, mockDocker(manifest, { columnMutate }).execute));
});

test('private exclusive artifacts preserve prior receipts and refuse symlink ancestors', t => {
  const workspace = mkdtempSync(join(tmpdir(), 'native-nonadmin-'));
  t.after(() => rmSync(workspace, { recursive: true, force: true }));
  const fixture = candidate();
  const { output, receipt } = writeFixtureCandidate(fixture, { workspace });
  assert.equal(statSync(output).mode & 0o777, 0o700);
  for (const [name, input] of Object.entries(receipt.files)) {
    const path = join(output, name);
    assert.equal(statSync(path).mode & 0o777, 0o600);
    assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'), input.sha256);
  }
  assert.throws(() => writeFixtureCandidate(fixture, { workspace }), /EEXIST/);
  const other = join(workspace, 'other');
  mkdirSync(other);
  symlinkSync(join(workspace, '.artifacts'), join(other, '.artifacts'));
  assert.throws(() => writeFixtureCandidate(fixture, { workspace: other }), /real directories/);
});
