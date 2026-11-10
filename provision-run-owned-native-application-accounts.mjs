#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  closeSync, constants, lstatSync, mkdirSync, openSync, readFileSync, writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { snapshotSQL, validateMatrixFixture } from './prepare-run-owned-native-nonadmin-matrix.mjs';
import { validateCleanupResources } from './tests/run-owned-native-nonadmin-fixture.sql.mjs';
import {
  mysqlFixtureProfile, verifyMysqlFixtureState, verifySelectedMysqlStorage,
} from './mysql-fixture-profiles.mjs';
import { inspectMysqlFixtureVolumes } from './owned-mysql-volume.mjs';

const workspaceRoot = fileURLToPath(new URL('../', import.meta.url));
const toolPath = 'scripts/provision-run-owned-native-application-accounts.mjs';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const privileges = { uaa: 'SELECT, INSERT, UPDATE, DELETE', metadata: 'SELECT' };

export function createApplicationAccounts(manifest, secret = () => randomBytes(18).toString('hex')) {
  validateMatrixFixture(manifest);
  const accounts = ['uaa', 'metadata'].map(kind => ({
    kind, username: `nf_${manifest.runId}_${kind === 'uaa' ? 'uaa' : 'meta'}_app`,
    host: '%', database: manifest.schemas[kind], privileges: privileges[kind],
    jdbcUrl: `jdbc:mysql://${manifest.ownership.mysqlContainer}:3306/${manifest.schemas[kind]}?useUnicode=true&characterEncoding=UTF-8&useSSL=false`,
  }));
  const passwords = Object.fromEntries(accounts.map(account => {
    const password = secret();
    assert.match(password, /^[a-f0-9]{36}$/, 'Generated SQL passwords must be 18-byte hex');
    return [account.username, password];
  }));
  const accountSQL = accounts.map(account => [
    `CREATE USER '${account.username}'@'%' IDENTIFIED BY '${passwords[account.username]}';`,
    `GRANT ${account.privileges} ON \`${account.database.replaceAll('_', '\\_')}\`.* TO '${account.username}'@'%';`,
  ].join('\n')).join('\n') + '\n';
  return {
    accounts, passwords, accountSQL,
    configuration: {
      uaa: {
        'spring.datasource.url': accounts[0].jdbcUrl,
        'spring.datasource.username': accounts[0].username,
        'spring.datasource.password': passwords[accounts[0].username],
        'spring.datasource.defaultSchema': accounts[0].database,
        'spring.datasource.isSyncDBSchema': false,
        'spring.liquibase.enabled': false,
        'ibiz.auth.passwordStorageMode': 'sm3',
        'ibiz.auth.imageCaptcha.enable': false,
        'spring.cloud.nacos.config.enabled': false,
        'spring.cloud.nacos.discovery.enabled': false,
        'spring.cloud.discovery.enabled': false,
      },
      metadata: {
        jdbcUrl: accounts[1].jdbcUrl, username: accounts[1].username,
        password: passwords[accounts[1].username], readOnly: true,
      },
      unresolved: [
        'Isolated token/cache store and password transport mode must be configured by the service owner',
        'Disable RT2 AppSyncJob; this file is not a complete runnable UAA configuration',
        'Metadata SQL is read-only; app/provider datasource configuration names require native integration',
      ],
    },
    rootRequests: manifest.roots.map(root => ({
      rootId: root.rootId, centerId: root.centerId, physicalSchema: root.database,
      method: 'POST',
      path: `/api/ibizmodeling__modeldesign/psdevslnsys/${root.rootId}/psmodules/fetchcursys`,
      body: { pssystemid: root.logicalSystemId, size: 1000 },
      appContext: { PSDEVSLNSYS: root.rootId }, nativeHTTPVerified: false,
    })),
    freshSessionCases: createFreshSessionCases(manifest),
  };
}

export function createFreshSessionCases(manifest) {
  validateMatrixFixture(manifest);
  return manifest.roots.map(root => {
    const editor = manifest.users.find(user => user.rootId === root.rootId && user.role === 'editor');
    const probeId = `nf_${manifest.runId}_relogin_probe_${root.side}`;
    return {
      id: `${manifest.runId}-${root.side}-native-relogin-persistence`,
      rootId: root.rootId, physicalSchema: root.database, probeId,
      baselineSentinelId: root.sentinelId, editorLoginname: editor.loginname,
      mutationContract: {
        create: { psmoduleid: probeId, pssystemid: root.logicalSystemId, psmodulename: `Relogin ${root.side} ${manifest.runId}` },
        update: { psmoduleid: probeId, modtag: `nf_${manifest.runId}_relogin_${root.side}_updated` },
        removeId: probeId,
      },
      freshSessionReadbacks: manifest.users.map(user => ({
        loginname: user.loginname, personId: user.personId, centerId: user.centerId,
        administrator: false,
        expectedAuthorization: user.rootId === root.rootId && user.role !== 'no-access' ? 'allow' : 'deny',
        requireNewBackendLoginRequest: true, reusePriorAuthorizationHeader: false,
        requireDifferentTokenBytes: false,
      })),
      order: [
        'Authenticate editor; snapshot all ordered module/system rows in both physical schemas',
        'CREATE case-owned probe in selected root; read and snapshot both schemas',
        'UPDATE only that probe; read and snapshot both schemas',
        'Discard prior client auth state; authenticate each of the six identities anew and GET/FETCH that root',
        'Authorized editor/viewer see the persisted updated probe; all other identities see no probe or sentinel',
        'Fresh-login editor removes only the case-owned probe; snapshot both schemas',
        'Fresh-login editor verifies probe absence and both unchanged baseline sentinels',
      ],
      acceptance: {
        bothDatabaseProjectionsRequiredAtEveryStep: true, unrelatedRowsMustBeUnchanged: true,
        http404500OrNetworkFailureIsNotAuthorizationProof: true,
        durableRestartAcceptance: false,
      },
      apiActionMappingVerified: false, executionStatus: 'not-run', nativeAcceptance: false,
    };
  });
}

export function validateApplicationGrants(account, output) {
  const lines = output.trim().split('\n').sort();
  const quotedUser = `'${account.username}'@'%'`;
  const escaped = account.database.replaceAll('_', '\\_');
  assert.deepEqual(lines, [
    `GRANT USAGE ON *.* TO ${quotedUser}`,
    `GRANT ${account.privileges} ON \`${escaped}\`.* TO ${quotedUser}`,
  ].sort(), 'Application account must have only the exact declared schema privileges');
  return true;
}

export function validateFixtureReceipt(manifest, receipt, manifestSha256) {
  validateMatrixFixture(manifest);
  assert.equal(receipt.contract, 'run-owned-native-nonadmin-isolated-sql-smoke-v1');
  assert.equal(receipt.runId, manifest.runId);
  assert.equal(receipt.scenario, manifest.scenario);
  assert.equal(receipt.status, 'passed-isolated-sql-fixture-only');
  assert.equal(receipt.retainOwned, true, 'Application accounts require an intentionally retained fixture');
  for (const key of ['nativeAcceptance', 'permissionAcceptance', 'sourceNativeAcceptance',
    'actualUAALoginVerified', 'actualBackendHTTPVerified']) assert.equal(receipt[key], false);
  assert.equal(receipt.outputs['manifest.json'].sha256, manifestSha256);
  assert.ok(receipt.checks.length >= 54 && receipt.checks.every(row => row.status === 'passed'));
  assert.equal(receipt.cleanup.mysqlRemoved, false);
  assert.equal(receipt.cleanup.networkRemoved, false);
  return true;
}

function writePrivate(path, contents) {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { writeFileSync(fd, contents); }
  finally { closeSync(fd); }
}

function fixtureDirectory(workspace, runId) {
  assert.match(runId, /^[a-f0-9]{12}$/);
  let path = resolve(workspace);
  for (const part of ['.artifacts', 'native-nonadmin-fixtures', runId]) {
    path = join(path, part);
    const stat = lstatSync(path);
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink(), 'Fixture ancestors must be real directories');
  }
  return path;
}

function readInput(base, name) {
  const path = join(base, name);
  const stat = lstatSync(path);
  assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'Receipt inputs must be regular non-symlink files');
  const bytes = readFileSync(path);
  return { value: JSON.parse(bytes), binding: { name, sha256: digest(bytes), bytes: bytes.length } };
}

export function readApplicationAccountInput({ workspace = workspaceRoot, runId, label, manifest }) {
  assert.match(label ?? '', /^[a-z0-9][a-z0-9-]{0,63}$/, 'Explicit application account label required');
  validateMatrixFixture(manifest);
  assert.equal(manifest.runId, runId);
  const base = fixtureDirectory(workspace, runId);
  const directory = join(base, `application-accounts-${label}`);
  const info = lstatSync(directory);
  assert.ok(info.isDirectory() && !info.isSymbolicLink(), 'Account directory must be a real directory');
  assert.equal(info.mode & 0o077, 0, 'Account directory must be private');
  const receipt = readInput(directory, 'report.json');
  const input = readInput(directory, 'accounts.private.json');
  assert.equal(lstatSync(join(directory, 'accounts.private.json')).mode & 0o077, 0,
    'Account input must be private');
  const report = receipt.value;
  assert.equal(report.contract, 'run-owned-native-application-accounts-v1');
  assert.equal(report.runId, runId);
  assert.equal(report.status, 'passed-owned-application-account-sql-only');
  assert.equal(report.nativeAcceptance, false);
  assert.equal(report.permissionAcceptance, false);
  assert.ok(report.checks.length >= 32 && report.checks.every(row => row.status === 'passed'));
  const expected = createApplicationAccounts(manifest).accounts;
  assert.deepEqual(report.accounts, expected);
  assert.deepEqual(report.createdUsers.toSorted(), expected.map(row => row.username).sort());
  assert.deepEqual(report.outputs['accounts.private.json'],
    { bytes: input.binding.bytes, sha256: input.binding.sha256 }, 'Account input receipt drift');
  const manifestInput = readInput(base, 'manifest.json');
  assert.deepEqual(report.inputs.find(row => row.name === 'manifest.json'), manifestInput.binding,
    'Account receipt must bind the current fixture manifest');
  assert.deepEqual(manifestInput.value, manifest);
  assert.deepEqual(report.generator, { path: toolPath, sha256: digest(readFileSync(join(workspace, toolPath))) },
    'Application account generator drift');
  return {
    accounts: input.value,
    binding: {
      label, path: join(directory, 'accounts.private.json'), sha256: input.binding.sha256,
      reportPath: join(directory, 'report.json'), reportSha256: receipt.binding.sha256,
    },
  };
}

function docker(args, { input, env, allowFailure = false } = {}) {
  const result = spawnSync('docker', args, {
    input, encoding: 'utf8', env: { ...process.env, ...env },
    timeout: 60_000, maxBuffer: 4 * 1024 * 1024,
  });
  if (!allowFailure) assert.ok(!result.error && result.status === 0,
    `Owned Docker ${args[0]} failed (credential-bearing output suppressed)`);
  return result;
}

export function validateApplicationTarget(manifest, resources, container, network, volumes = []) {
  validateCleanupResources(manifest, resources, container, network, volumes);
  assert.equal(container.Id, resources.mysqlId);
  verifySelectedMysqlStorage(resources.databaseProfile, container, { storage: resources.databaseStorage, volumes });
  return {
    verifiedAt: new Date().toISOString(), mysqlId: container.Id, imageId: container.Image,
    networkId: network.Id, privateInternalNetwork: true, onlyPeer: container.Id,
    publishedMysqlPorts: false, bindMounts: false, tmpfs: container.HostConfig.Tmpfs,
  };
}

function inspectExclusiveTarget(manifest, resources) {
  const container = JSON.parse(docker(['inspect', resources.mysqlId]).stdout)[0];
  const network = JSON.parse(docker(['network', 'inspect', resources.networkId]).stdout)[0];
  return validateApplicationTarget(manifest, resources, container, network, inspectMysqlFixtureVolumes(resources));
}

function rootSQL(containerId, input) {
  return docker(['exec', '-i', containerId, 'sh', '-c',
    'test -n "$MYSQL_ROOT_PASSWORD" && MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -h127.0.0.1 --protocol=TCP -uroot --default-character-set=utf8mb4 --batch --raw --skip-column-names',
  ], { input }).stdout.trim();
}

function accountSQL(containerId, account, password, input) {
  return docker(['exec', '-i', '-e', 'MYSQL_PWD', containerId, 'mysql',
    '-h127.0.0.1', '--protocol=TCP', `-u${account.username}`,
    '--default-character-set=utf8mb4', '--batch', '--raw', '--skip-column-names',
  ], { input, env: { MYSQL_PWD: password }, allowFailure: true });
}

function loadFixture(workspace, runId) {
  const base = fixtureDirectory(workspace, runId);
  const manifestInput = readInput(base, 'manifest.json');
  const receiptInput = readInput(base, 'isolated-sql-report.json');
  const resourcesInput = readInput(base, 'owned-resources.json');
  validateFixtureReceipt(manifestInput.value, receiptInput.value, manifestInput.binding.sha256);
  assert.equal(manifestInput.value.runId, runId);
  for (const row of receiptInput.value.inputs.fixtureTools) {
    assert.match(row.path, /^scripts\/(?:tests\/)?[a-z0-9.-]+\.mjs$/);
    assert.equal(digest(readFileSync(join(workspace, row.path))), row.sha256, 'Fixture tool changed since SQL proof');
  }
  const resources = resourcesInput.value;
  assert.equal(resources.mysqlId, receiptInput.value.ownedMysqlId);
  assert.equal(resources.networkId, receiptInput.value.ownedNetworkId);
  return {
    base, manifest: manifestInput.value, resources,
    bindings: [manifestInput.binding, receiptInput.binding, resourcesInput.binding],
  };
}

export function provisionApplicationAccounts({ runId, label = randomBytes(6).toString('hex'), workspace = workspaceRoot }) {
  assert.match(label, /^[a-z0-9][a-z0-9-]{0,63}$/);
  const { base, manifest, resources, bindings } = loadFixture(workspace, runId);
  const liveState = inspectExclusiveTarget(manifest, resources);
  const candidate = createApplicationAccounts(manifest);
  const output = join(base, `application-accounts-${label}`);
  mkdirSync(output, { mode: 0o700 });
  const report = {
    contract: 'run-owned-native-application-accounts-v1', runId,
    status: 'running-owned-account-sql-only', startedAt: new Date().toISOString(),
    nativeAcceptance: false, permissionAcceptance: false, sourceNativeAcceptance: false,
    actualUAALoginVerified: false, actualBackendHTTPVerified: false,
    inputs: bindings, generator: { path: toolPath, sha256: digest(readFileSync(join(workspace, toolPath))) },
    liveState, accounts: candidate.accounts, rootRequests: candidate.rootRequests,
    freshSessionCases: candidate.freshSessionCases, checks: [], createdUsers: [],
    cleanupCommand: `node ${toolPath} --cleanup-owned-application-accounts --run-id=${runId} --label=${label}`,
    boundary: 'Only run-owned SQL account/grant verification; not native application login or model permissions',
    persistenceBoundary: 'Retained tmpfs MySQL supports fresh-session checks while alive, not durable restart proof',
    remainingNativePrerequisites: [
      'Main-owned isolated sys_person UAA and source-built backend with immutable IDs and source receipts',
      'Owned token/cache store plus complete schema required by those exact services',
      'Actual six-user direct UAA login/self and backend fresh-login HTTP verification',
      'Popper root-context transport plus positive/negative HTTP cases with both DB projections',
      'Native write/readback after relogin; durable DB restart requires a separate owned volume fixture',
    ],
    outputs: {},
  };
  const record = (name, actual, expected) => {
    assert.equal(actual, expected, name);
    report.checks.push({ name, status: 'passed' });
  };
  const snapshot = () => rootSQL(resources.mysqlId, snapshotSQL(manifest));
  try {
    writePrivate(join(output, 'accounts.private.json'), json({
      passwords: candidate.passwords, configuration: candidate.configuration,
      roleCredentialsPath: `../credentials.private.json`,
    }));
    writePrivate(join(output, '05-application-accounts.private.sql'), candidate.accountSQL);
    if (resources.databaseProfile === undefined) {
      record('owned MySQL version/case mapping', rootSQL(resources.mysqlId,
        'SELECT @@lower_case_table_names,@@version;'), '1\t5.7.26');
    } else {
      const state = JSON.parse(rootSQL(resources.mysqlId,
        "SELECT JSON_OBJECT('version', VERSION(), 'lowerCaseTableNames', @@lower_case_table_names, 'characterSet', @@character_set_server);"));
      verifyMysqlFixtureState(mysqlFixtureProfile(resources.databaseProfile.name), state);
      report.databaseState = state;
      report.checks.push({ name: 'owned MySQL version/case mapping', status: 'passed' });
    }
    const before = snapshot();
    const baselineRows = before.split('\n');
    assert.equal(baselineRows.length, 4, 'Require exactly two module and two system baseline sentinels');
    for (const [index, root] of manifest.roots.entries()) {
      record(`exact ${root.side} physical module baseline`, baselineRows[index * 2],
        [root.database, root.sentinelId, root.logicalSystemId, root.sentinelName, root.sentinelTag].join('\t'));
      record(`exact ${root.side} physical system/root baseline`, baselineRows[index * 2 + 1],
        [root.database, root.logicalSystemId, root.sentinelSystemName,
          root.rootId, root.modelInstanceId, root.centerId].join('\t'));
    }
    record('six nonadmin developer identities', rootSQL(resources.mysqlId,
      `SELECT COUNT(*) FROM \`${manifest.schemas.metadata}\`.t_srfpsdevuser WHERE ADMINMODE=0 AND ENABLE=1;`), '6');
    for (const account of candidate.accounts) {
      record(`no existing application principal ${account.kind}`, rootSQL(resources.mysqlId,
        `SELECT COUNT(*) FROM mysql.user WHERE User='${account.username}';`), '0');
    }
    // DDL is nontransactional. Journal each successful CREATE before granting;
    // on failure retain the exact created principals for explicit owned cleanup.
    for (const account of candidate.accounts) {
      inspectExclusiveTarget(manifest, resources);
      rootSQL(resources.mysqlId,
        `CREATE USER '${account.username}'@'%' IDENTIFIED BY '${candidate.passwords[account.username]}';`);
      report.createdUsers.push(account.username);
      rootSQL(resources.mysqlId,
        `GRANT ${account.privileges} ON \`${account.database.replaceAll('_', '\\_')}\`.* TO '${account.username}'@'%';`);
      const grants = rootSQL(resources.mysqlId, `SHOW GRANTS FOR '${account.username}'@'%';`);
      validateApplicationGrants(account, grants);
      report.checks.push({ name: `exact escaped schema grants ${account.kind}`, status: 'passed', grantsSha256: digest(grants) });
      const read = sql => accountSQL(resources.mysqlId, account, candidate.passwords[account.username], sql);
      const identity = read('SELECT CURRENT_USER();');
      record(`${account.kind} TCP authentication`, identity.status, 0);
      record(`${account.kind} actual SQL principal`, identity.stdout.trim(), `${account.username}@%`);
      const targetTable = account.kind === 'uaa' ? 'sys_person' : 't_srfpsdevuser';
      const count = read(`SELECT COUNT(*) FROM \`${account.database}\`.\`${targetTable}\`;`);
      record(`${account.kind} own identity query`, count.status, 0);
      record(`${account.kind} own identity count`, count.stdout.trim(), '6');
      for (const database of Object.values(manifest.schemas).filter(schema => schema !== account.database)) {
        const table = database === manifest.schemas.uaa ? 'sys_person'
          : database === manifest.schemas.metadata ? 't_srfpsdevuser' : 't_srfpsmodule';
        const key = database === manifest.schemas.uaa ? 'ID'
          : database === manifest.schemas.metadata ? 'PSDEVUSERID' : 'PSMODULEID';
        for (const [operation, sql] of [
          ['SELECT', `SELECT COUNT(*) FROM \`${database}\`.\`${table}\`;`],
          ['UPDATE', `UPDATE \`${database}\`.\`${table}\` SET \`${key}\`=\`${key}\` WHERE 1=0;`],
        ]) {
          const denied = read(sql);
          assert.ok(!denied.error && denied.status !== 0 && /ERROR (1044|1142)/.test(denied.stderr),
            `${account.kind} foreign ${operation} must fail by SQL authorization, not parser/network failure`);
          report.checks.push({ name: `${account.kind} ${operation} denied on ${database}`, status: 'passed' });
        }
      }
      if (account.kind === 'metadata') {
        const denied = read(`UPDATE \`${account.database}\`.t_srfpsdevuser SET ADMINMODE=ADMINMODE WHERE 1=0;`);
        assert.ok(!denied.error && denied.status !== 0 && /ERROR (1044|1142)/.test(denied.stderr));
        report.checks.push({ name: 'metadata own writes denied', status: 'passed' });
      }
    }
    record('both physical model module/system projections unchanged', snapshot(), before);
    report.liveState = inspectExclusiveTarget(manifest, resources);
    report.status = 'passed-owned-application-account-sql-only';
  } catch (error) {
    report.status = 'failed-owned-application-account-sql';
    report.error = error.message;
  } finally {
    report.finishedAt = new Date().toISOString();
    for (const name of ['accounts.private.json', '05-application-accounts.private.sql']) {
      try {
        const bytes = readFileSync(join(output, name));
        report.outputs[name] = { bytes: bytes.length, sha256: digest(bytes) };
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    writePrivate(join(output, 'report.json'), json(report));
  }
  return { reportPath: join(output, 'report.json'), report };
}

export function cleanupApplicationAccounts({ runId, label, workspace = workspaceRoot }) {
  assert.match(label, /^[a-z0-9][a-z0-9-]{0,63}$/);
  const { base, manifest, resources } = loadFixture(workspace, runId);
  const output = join(base, `application-accounts-${label}`);
  const stat = lstatSync(output);
  assert.ok(stat.isDirectory() && !stat.isSymbolicLink());
  const input = readInput(output, 'report.json');
  const receipt = input.value;
  assert.equal(receipt.contract, 'run-owned-native-application-accounts-v1');
  assert.equal(receipt.runId, runId);
  assert.equal(receipt.nativeAcceptance, false);
  const expected = createApplicationAccounts(manifest).accounts;
  assert.deepEqual(receipt.accounts, expected);
  assert.equal(new Set(receipt.createdUsers).size, receipt.createdUsers.length);
  assert.ok(receipt.createdUsers.every(name => expected.some(row => row.username === name)));
  const liveState = inspectExclusiveTarget(manifest, resources);
  for (const name of receipt.createdUsers) {
    assert.equal(rootSQL(resources.mysqlId,
      `SELECT COUNT(*) FROM information_schema.PROCESSLIST WHERE USER='${name}';`), '0',
    'Stop the owned application peers/connections before cleanup');
    const account = expected.find(row => row.username === name);
    const grants = rootSQL(resources.mysqlId, `SHOW GRANTS FOR '${name}'@'%';`);
    if (receipt.status === 'passed-owned-application-account-sql-only') validateApplicationGrants(account, grants);
    else {
      assert.ok([`GRANT USAGE ON *.* TO '${name}'@'%'`,
        `GRANT USAGE ON *.* TO '${name}'@'%'\nGRANT ${account.privileges} ON \`${account.database.replaceAll('_', '\\_')}\`.* TO '${name}'@'%'`,
      ].includes(grants), 'Partial DDL cleanup refuses unrecognized principal grants');
    }
  }
  const path = join(output, `cleanup-${randomBytes(6).toString('hex')}.json`);
  const report = {
    contract: 'run-owned-native-application-account-cleanup-v1', runId, liveState,
    inputReceipt: input.binding, status: 'running-owned-account-cleanup', removedUsers: [],
    nativeAcceptance: false, permissionAcceptance: false,
    boundary: 'Removes only the exact two receipt-journaled SQL users; never schemas, containers or role identities',
  };
  try {
    for (const name of receipt.createdUsers) {
      inspectExclusiveTarget(manifest, resources);
      rootSQL(resources.mysqlId, `DROP USER '${name}'@'%';`);
      report.removedUsers.push(name);
    }
    report.status = 'passed-owned-application-account-cleanup';
  } catch (error) {
    report.status = 'failed-owned-application-account-cleanup';
    report.error = error.message;
  } finally { writePrivate(path, json(report)); }
  return { reportPath: path, report };
}

export function main(args = process.argv.slice(2)) {
  const options = {};
  for (const arg of args) {
    if (['--provision-owned-application-accounts', '--cleanup-owned-application-accounts'].includes(arg)) {
      assert.equal(options.action, undefined, 'One explicit action is required');
      options.action = arg;
    } else {
      const match = /^--(run-id|label)=(.+)$/.exec(arg);
      assert.ok(match, 'Unsupported application-account option');
      assert.equal(options[match[1]], undefined, 'Duplicate option');
      options[match[1]] = match[2];
    }
  }
  assert.ok(options.action, 'Explicit provision or cleanup opt-in is required');
  const operation = options.action === '--provision-owned-application-accounts'
    ? provisionApplicationAccounts : cleanupApplicationAccounts;
  const result = operation({ runId: options['run-id'], label: options.label });
  if (result.report.status.startsWith('failed')) process.exitCode = 1;
  return {
    reportPath: result.reportPath, status: result.report.status,
    checks: result.report.checks?.length, nativeAcceptance: false,
  };
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  try { console.log(json(main()).trim()); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
