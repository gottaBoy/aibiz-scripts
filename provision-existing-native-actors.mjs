#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { nativeActorRuntimeIdentity } from './probe-existing-native-actor-contract.mjs';
import {
  nativeHttpRuntimeComparable, nativeHttpRuntimeIdentity,
} from './probe-existing-native-actor-http-preflight.mjs';

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const uaaOrigin = 'http://127.0.0.1:32666';
const plmOrigin = 'http://127.0.0.1:30250/api/ibizplm__plmweb';
const uaaContainer = 'ibizlab-uaa-api';
const services = ['ibizlab-uaa-api', 'plmweb', 'ibiz-ebsx-allinone'];
const candidatePath = '.artifacts/native-actors-prepare-20261124-r2/candidate.private.json';
const credentialPath = '.artifacts/native-actors-prepare-20261124-r2/credentials.planned.private.json';
const adminCredentialPath = '.artifacts/current-business-actors-20261122-r1/credentials.private.json';
const selfReportPath = '.artifacts/native-actor-self-20261124-r1/report.private.json';
const sha = value => createHash('sha256').update(value).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const actorKeys = ['ordinary', 'readonly', 'nonmember'];

function readPrivate(path) {
  const absolute = resolve(workspace, path);
  const child = relative(join(workspace, '.artifacts'), absolute);
  assert.ok(child && !child.startsWith('..') && !child.startsWith('/'));
  const fd = fs.openSync(absolute, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    assert.ok(stat.isFile() && stat.uid === process.geteuid() && (stat.mode & 0o077) === 0);
    return fs.readFileSync(fd);
  } finally { fs.closeSync(fd); }
}

function writePrivate(path, bytes) {
  const fd = fs.openSync(path, fs.constants.O_WRONLY | fs.constants.O_CREAT
    | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function runtimeSnapshot(execute) {
  const result = execute('docker', ['inspect', ...services]);
  assert.ok(result.status === 0 && !result.error && !result.signal);
  const rows = JSON.parse(result.stdout);
  assert.equal(rows.length, services.length);
  const map = new Map(rows.map(row => [row.Name.slice(1), row]));
  assert.deepEqual([...map.keys()].sort(), [...services].sort());
  const identities = {};
  for (const row of rows) {
    assert.equal(row.State.Status, 'running');
    const identity = row.Name === `/${uaaContainer}`
      ? nativeActorRuntimeIdentity(row, workspace)
      : nativeHttpRuntimeIdentity(row, workspace);
    identities[row.Name.slice(1)] = row.Name === `/${uaaContainer}`
      ? identity : nativeHttpRuntimeComparable(identity);
  }
  return identities;
}

function readJsonBody(bytes) {
  try { return bytes.length ? JSON.parse(bytes.toString()) : null; } catch { return null; }
}

function safeSummary(response, body) {
  return { status: response.status, bytes: body.length, sha256: sha(body),
    contentType: response.headers.get('content-type'),
    nativeCode: Number.isSafeInteger(response.data?.code) ? response.data.code : null,
    nativeType: typeof response.data?.type === 'string' ? response.data.type : null };
}

function boundedId(value) {
  assert.ok(typeof value === 'string' && value.length > 0 && value.length <= 120
    && !/[\u0000-\u0020\u007f/?#%\\]/.test(value));
  return value;
}

export function buildNativePersonBody(candidate, password, organizationId, organizationRoleId, dc) {
  assert.ok(!['ROLE_SUPERADMIN', 'ROLE_APIUSERS'].includes(organizationRoleId));
  const body = { uid: candidate.plannedUid, display_name: candidate.plannedDisplayName,
    employee_number: candidate.plannedUid, user_password: password, organization_id: organizationId,
    status: '1' };
  if (organizationRoleId !== null) body.organizational_role_id = boundedId(organizationRoleId);
  else body.member_of = [{ organization_id: organizationId, sort: 1 }];
  if (dc !== null) body.dc = dc;
  return body;
}

export function nativeActorCollisionSQL(uid) {
  assert.match(uid, /^nat_[a-f0-9]{12}_(?:ordinary|readonly|nonmember|objectadmin|crossorg)$/);
  const literal = `CONVERT(0x${Buffer.from(uid).toString('hex')} USING utf8mb4)`;
  return 'START TRANSACTION READ ONLY;\n'
    + 'SELECT JSON_OBJECT('
    + "'uidRows',COUNT(IF(`UID`=" + literal + ',1,NULL)),'
    + "'idRows',COUNT(IF(`ID`=" + literal + ',1,NULL)),'
    + "'employeeNumberRows',COUNT(IF(`EMPLOYEE_NUMBER`=" + literal + ',1,NULL)),'
    + "'activeRows',COUNT(IF(`ENABLED`=1,1,NULL)),"
    + "'disabledRows',COUNT(IF(`ENABLED`=0,1,NULL)))"
    + ' FROM `a_lab01_3f9ebc219`.`sys_person`'
    + ` WHERE \`UID\`=${literal} OR \`ID\`=${literal}`
    + ` OR \`EMPLOYEE_NUMBER\`=${literal};\nCOMMIT;\n`;
}

export function assertNoActorCollision(counts) {
  assert.deepEqual(Object.keys(counts).sort(),
    ['uidRows', 'idRows', 'employeeNumberRows', 'activeRows', 'disabledRows'].sort());
  for (const value of Object.values(counts)) assert.equal(value, 0,
    'UID, issued ID, employee number or tombstone already exists');
}

export function projectNativeActorEvidence(entry) {
  return { candidate: { actorKey: entry.candidate.actorKey,
    plannedUid: entry.candidate.plannedUid, status: 'NOT_CREATED' },
  credentialStatus: 'PRIVATE_SEPARATE_FILE', issuedPersonId: entry.issuedPersonId,
  plmUserId: entry.plmUserId, memberId: entry.memberId ?? null,
  productMemberId: entry.productMemberId, organizationRoleId: entry.organizationRoleId ?? null,
  automaticAuthorities: entry.automaticAuthorities ?? [],
  effectiveSelfAuthorities: entry.effectiveSelfAuthorities ?? [],
  plmContext: entry.plmContext ?? null, cleanup: entry.cleanup,
  productMemberCount: entry.productMemberCount ?? null, productRole: entry.productRole ?? null,
  persistenceAfterFailedCreate: entry.persistenceAfterFailedCreate ?? null };
}

export function nativeActorCleanupVerdict(report, entries) {
  return report.usersCreated > 0 && report.usersCreated === report.usersCleaned
    && !report.creationOutcomeUncertain && !report.productCreationOutcomeUncertain
    && Object.values(entries).every(entry =>
    !entry.issuedPersonId || entry.cleanup.personDeleteStatus === 200
      && entry.cleanup.personReadbackStatus === 404
      && entry.cleanup.nativeMemberRows === 0 && entry.cleanup.nativeRoleRows === 0)
    && report.productMembersCreated === report.productMembersCleaned
    && (!report.product?.createdByThisRun || report.product.cleanupVerified === true)
    && (!report.organizationRole?.createdByThisRun || report.organizationRole.cleanupVerified === true)
    ? 'PASS_NATIVE_LOGICAL_DELETE' : 'BLOCKED';
}

export function assessAutomaticAuthorities(authorities) {
  assert.ok(Array.isArray(authorities));
  assert.ok(authorities.includes('ROLE_USERS'), 'ROLE_USERS was not created automatically');
  assert.ok(!authorities.includes('ROLE_SUPERADMIN') && !authorities.includes('ROLE_APIUSERS'),
    'A privileged role was unexpectedly assigned');
  return { roleUsers: true, privilegedRoles: false };
}

export function assessProductMemberCount(actorKey, count) {
  assert.ok(actorKeys.includes(actorKey));
  assert.equal(count, actorKey === 'nonmember' ? 0 : 1,
    `${actorKey} product membership count changed`);
  return { expected: actorKey === 'nonmember' ? 0 : 1, actual: count };
}

export async function provisionExistingNativeActors(options = {}) {
  assert.ok(Object.keys(options).every(key =>
    ['output', 'root', 'execute', 'request', 'retainForMatrix'].includes(key)),
  'No identity headers, role overrides, account overrides or apply adapters are accepted');
  assert.ok(options.retainForMatrix === undefined || typeof options.retainForMatrix === 'boolean');
  const { root = workspace, execute = (program, args, input) => spawnSync(program, args,
    { input, encoding: 'utf8', timeout: 20000, maxBuffer: 8 * 1024 * 1024 }), request = fetch } = options;
  assert.equal(typeof options.output, 'string');
  const output = resolve(options.output);
  assert.equal(dirname(output), join(root, '.artifacts'));
  assert.match(basename(output), /^native-actors-run-[A-Za-z0-9-]+$/);
  assert.ok(!fs.existsSync(output), 'An exclusive output is required');
  for (let current = dirname(output); ; current = dirname(current)) {
    const stat = fs.lstatSync(current);
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink());
    if (dirname(current) === current) break;
  }
  const run = (program, args, input) => {
    const result = execute(program, args, input);
    assert.ok(result.status === 0 && !result.error && !result.signal,
      'Read-only runtime inspection failed');
    return Buffer.from(result.stdout);
  };
  const initialRuntime = runtimeSnapshot(execute);
  const candidateBytes = readPrivate(candidatePath);
  const credentialBytes = readPrivate(credentialPath);
  const adminCredentialBytes = readPrivate(adminCredentialPath);
  const selfBytes = readPrivate(selfReportPath);
  const candidate = JSON.parse(candidateBytes);
  const planned = JSON.parse(credentialBytes);
  const adminCredentials = JSON.parse(adminCredentialBytes);
  const selfReport = JSON.parse(selfBytes);
  assert.equal(candidate.status, 'NOT_CREATED');
  assert.equal(planned.status, 'NOT_CREATED');
  assert.equal(selfReport.status, 'NATIVE_SELF_AND_OWN_PERSON_READ_PROVEN');
  const organizationId = boundedId(selfReport.result.person.organizationId);
  let organizationRoleId = null;
  const dc = selfReport.result.person.dc ?? null;
  const entries = Object.fromEntries(actorKeys.map(key => [key,
    { candidate: candidate.actors.find(actor => actor.actorKey === key),
      credentials: planned.entries[key], issuedPersonId: null, plmUserId: null,
      productMemberId: null, cleanup: {} }]));
  for (const key of actorKeys) {
    assert.ok(entries[key].candidate && entries[key].credentials);
    assert.equal(entries[key].candidate.status, 'NOT_CREATED');
    assert.equal(entries[key].credentials.status, 'NOT_CREATED');
  }
  fs.mkdirSync(output, { mode: 0o700 });
  fs.mkdirSync(join(output, 'source'), { mode: 0o700 });
  const report = { contract: 'existing-native-actors-real-run-v1', status: 'RUNNING',
    startedAt: new Date().toISOString(), runtimeBefore: initialRuntime,
    runtimeContractVerified: false, authenticationUsable: false,
    usersCreated: 0, usersCleaned: 0, rolesChanged: 0, productMembersCreated: 0,
    productMembersCleaned: 0, directDatabaseWrites: 0, sqlUsed: true, readOnlySqlUsed: true,
    identityHeadersInjected: false, privilegedRolesRequested: false,
    preparedCandidatesModified: false, requests: [], collisions: [], actors: {},
    bindings: { candidateSha256: sha(candidateBytes), plannedCredentialSha256: sha(credentialBytes),
      adminCredentialSha256: sha(adminCredentialBytes), selfReportSha256: sha(selfBytes),
      organizationId, organizationRoleId, dcPresent: dc !== null },
    product: null, cleanup: { status: 'PENDING', persons: [], productMembers: [] } };
  const sources = [
    'scripts/provision-existing-native-actors.mjs',
    'scripts/tests/provision-existing-native-actors.test.mjs',
    'standalone-uaa/source/uaa-user/src/main/java/cn/ibizlab/core/ad/service/impl/SysPersonServiceImpl.java',
    'standalone-uaa/source/uaa-core/src/main/java/cn/ibizlab/core/ad/service/impl/AbstractSysPersonService.java',
    'standalone-uaa/source/uaa-core/src/main/java/cn/ibizlab/core/ad/service/impl/AbstractSysMemberService.java',
    'standalone-uaa/source/uaa-core/src/main/resources/mapper/ad/SysMember/SysMemberMapper.xml',
    'standalone-uaa/source/uaa-core/src/main/resources/mapper/ad/SysOrganizationalRole/SysOrganizationalRoleMapper.xml',
  ].map(path => ({ path, bytes: fs.readFileSync(join(root, path)), sha256: sha(fs.readFileSync(join(root, path))) }));
  for (const [index, source] of sources.entries()) {
    writePrivate(join(output, 'source', `${index}-${basename(source.path)}`), source.bytes);
  }
  const mysql = JSON.parse(run('docker', ['inspect', 'mysql']).toString())[0];
  assert.equal(mysql.Name, '/mysql');
  assert.deepEqual(mysql.Mounts.map(mount => ({ type: mount.Type, name: mount.Name,
    destination: mount.Destination })),
  [{ type: 'volume', name: 'compose_mysql_data', destination: '/var/lib/mysql' }]);
  const mysqlVolume = JSON.parse(run('docker', ['volume', 'inspect', 'compose_mysql_data']).toString())[0];
  assert.equal(mysqlVolume.Labels?.['com.docker.compose.project'], 'compose');
  assert.equal(mysqlVolume.Labels?.['com.docker.compose.volume'], 'mysql_data');
  const mysqlNetwork = JSON.parse(run('docker', ['network', 'inspect', 'compose_agent_network']).toString())[0];
  assert.equal(mysqlNetwork.Labels?.['com.docker.compose.project'], 'compose');
  assert.equal(mysqlNetwork.Labels?.['com.docker.compose.network'], 'agent_network');
  assert.equal(mysql.NetworkSettings.Networks.compose_agent_network?.NetworkID, mysqlNetwork.Id);
  assert.equal(mysql.State.Status, 'running');
  const mysqlId = mysql.Id;
  assert.match(mysqlId, /^[a-f0-9]{64}$/);
  const extraIdentity = row => {
    assert.equal(row.State.Status, 'running');
    if (row.Name !== '/mysql') assert.equal(row.Config.Labels?.['com.docker.compose.project.working_dir'],
      join(workspace, 'plm/deploy/compose'));
    return { id: row.Id, image: row.Image, startedAt: row.State.StartedAt,
      restartCount: row.RestartCount, configurationSha256: sha(json(row.Config)),
      mountsSha256: sha(json([...row.Mounts].sort((a, b) => a.Destination.localeCompare(b.Destination)))) };
  };
  const plm = JSON.parse(run('docker', ['inspect', 'plmservice']).toString())[0];
  assert.equal(plm.Config.Labels?.['com.docker.compose.service'], 'plmservice');
  assert.equal(plm.NetworkSettings.Networks.compose_agent_network?.NetworkID, mysqlNetwork.Id);
  const datasource = plm.Config.Env.find(value => value.startsWith('SPRING_DATASOURCE_URL='));
  assert.ok(datasource?.startsWith('SPRING_DATASOURCE_URL=jdbc:mysql://mysql:3306/plm?'));
  const extraBefore = { mysql: extraIdentity(mysql), plmservice: extraIdentity(plm) };
  report.extraRuntimeBefore = extraBefore;
  report.mysqlOwnership = { containerName: '/mysql', volume: 'compose_mysql_data',
    network: 'compose_agent_network', volumeLabelsSha256: sha(json(mysqlVolume.Labels)),
    networkLabelsSha256: sha(json(mysqlNetwork.Labels)), plmserviceDatasourceTargetsMysql: true };
  const physicalCounts = uid => {
    const sql = nativeActorCollisionSQL(uid);
    const bytes = run('docker', ['exec', '-i', mysqlId, 'sh', '-c',
      'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql --protocol=TCP -h127.0.0.1 -uroot'
        + ' --default-character-set=utf8mb4 --batch --raw --skip-column-names'], sql);
    const values = bytes.toString().trim().split('\n');
    assert.equal(values.length, 1);
    return JSON.parse(values[0]);
  };
  const guard = () => {
    assert.deepEqual(runtimeSnapshot(execute), initialRuntime, 'Shared runtime changed during native actor run');
    const extra = JSON.parse(run('docker', ['inspect', mysqlId, plm.Id]).toString());
    assert.deepEqual({ mysql: extraIdentity(extra[0]), plmservice: extraIdentity(extra[1]) }, extraBefore);
    for (const source of sources) assert.equal(sha(fs.readFileSync(join(root, source.path))), source.sha256);
    assert.equal(sha(readPrivate(candidatePath)), sha(candidateBytes));
    assert.equal(sha(readPrivate(credentialPath)), sha(credentialBytes));
  };
  const call = async (label, url, init, { allowStatus = [200], parse = true } = {}) => {
    guard();
    const method = init.method ?? 'GET';
    if (['POST', 'PUT', 'DELETE'].includes(method)
      && !/fetch|checkkey/.test(new URL(url).pathname)) {
      writePrivate(join(output, `intent-${String(report.requests.length).padStart(3, '0')}.private.json`),
        json({ label, method, path: new URL(url).pathname, recordedBeforeDispatch: true,
          candidateSha256: sha(candidateBytes), credentialsRecorded: false }));
    }
    const response = await request(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(10000) });
    const body = Buffer.from(await response.arrayBuffer());
    assert.ok(body.length <= 2 * 1024 * 1024, 'Native response exceeded read budget');
    const data = parse ? readJsonBody(body) : null;
    const summary = { label, method: init.method ?? 'GET', path: new URL(url).pathname,
      ...safeSummary({ status: response.status, headers: response.headers, data }, body) };
    report.requests.push(summary);
    guard();
    if (!allowStatus.includes(response.status)) {
      const error = new Error(`Native request failed: ${label} HTTP ${response.status}`);
      error.summary = summary;
      throw error;
    }
    return { response, body, data, summary };
  };
  let adminToken;
  let phase = 'admin-login';
  try {
    const adminLogin = await request(`${plmOrigin}/v7/login`, {
      method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' },
      body: JSON.stringify({ loginname: adminCredentials.username, password: adminCredentials.password }),
      redirect: 'error', signal: AbortSignal.timeout(10000),
    });
    const adminLoginBody = Buffer.from(await adminLogin.arrayBuffer());
    const adminLoginData = readJsonBody(adminLoginBody);
    assert.equal(adminLogin.status, 200);
    adminToken = adminLoginData?.token;
    assert.ok(typeof adminToken === 'string' && adminToken.length < 32768);
    report.authenticationUsable = true;
    report.requests.push({ label: 'admin-login', method: 'POST', path: '/v7/login',
      status: adminLogin.status, bytes: adminLoginBody.length, sha256: sha(adminLoginBody),
      tokenPersisted: false });
    const adminHeaders = { accept: 'application/json', authorization: `Bearer ${adminToken}` };
    phase = 'preflight-collision';
    for (const key of actorKeys) {
      const uid = entries[key].candidate.plannedUid;
      const collision = await call(`collision-${key}`, `${uaaOrigin}/sys_people/fetchdefault`, {
        method: 'POST', headers: { ...adminHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({ n_uid_eq: uid }),
      });
      const rows = Array.isArray(collision.data) ? collision.data : [];
      assert.equal(rows.length, 0, `Active UID collision for ${key}`);
      const counts = physicalCounts(uid);
      assertNoActorCollision(counts);
      report.collisions.push({ actorKey: key, uidSha256: sha(uid),
        physicalCounts: counts, globalRealmAndTombstonesIncluded: true });
    }
    phase = 'own-organization-role';
    const organizationRoleName = `Native ordinary group ${candidate.runId}`;
    const organizationRoleBefore = await call('own-org-role-collision',
      `${uaaOrigin}/sys_organizational_roles/fetchdefault`, {
        method: 'POST', headers: { ...adminHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({ n_name_like: organizationRoleName, n_organization_id_eq: organizationId }),
      });
    assert.ok(Array.isArray(organizationRoleBefore.data) && organizationRoleBefore.data.length === 0);
    try {
      const created = await call('own-org-role-create', `${uaaOrigin}/sys_organizational_roles`, {
        method: 'POST', headers: { ...adminHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({ name: organizationRoleName, organization_id: organizationId,
          description: `Own native actor acceptance ${candidate.runId}`, sort: 1 }),
      });
      organizationRoleId = boundedId(created.data?.id);
      report.organizationRole = { id: organizationRoleId, name: organizationRoleName,
        organizationId, createdByThisRun: true, cleanupVerified: false };
      assert.equal(created.data?.name, organizationRoleName);
    } catch (error) {
      const readback = await call('failed-own-org-role-readback',
        `${uaaOrigin}/sys_organizational_roles/fetchdefault`, {
          method: 'POST', headers: { ...adminHeaders, 'content-type': 'application/json' },
          body: JSON.stringify({ n_name_like: organizationRoleName, n_organization_id_eq: organizationId }),
        });
      assert.ok(Array.isArray(readback.data));
      const matches = readback.data.filter(row => row.name === organizationRoleName
        && row.organization_id === organizationId);
      report.creationOutcomeUncertain ||= matches.length > 1;
      if (matches.length === 1) report.organizationRole = {
        id: boundedId(matches[0].id), name: organizationRoleName,
        organizationId, createdByThisRun: true, cleanupVerified: false };
      throw error;
    }
    const organizationRoleRead = await call('own-org-role-read',
      `${uaaOrigin}/sys_organizational_roles/${encodeURIComponent(organizationRoleId)}`,
      { method: 'GET', headers: adminHeaders });
    assert.equal(organizationRoleRead.data?.name, organizationRoleName);
    assert.equal(organizationRoleRead.data?.organization_id, organizationId);
    const organizationRolePermissions = await call('own-org-role-authorities',
      `${uaaOrigin}/sys_role_members/fetchdefault`, {
        method: 'POST', headers: { ...adminHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({ n_member_uid_eq: organizationRoleId }),
      });
    assert.ok(Array.isArray(organizationRolePermissions.data));
    assert.equal(organizationRolePermissions.data.length, 0);
    report.organizationRole.permissionBindingCount = 0;
    report.bindings.organizationRoleId = organizationRoleId;
    phase = 'owned-product-read';
    const adminAppdata = await call('admin-appdata', `${plmOrigin}/appdata`, {
      method: 'GET', headers: adminHeaders,
    });
    const adminPlmUserId = adminAppdata.data?.context?.srfuserid;
    assert.ok(typeof adminPlmUserId === 'string' && adminPlmUserId);
    const products = await call('owned-product-list', `${plmOrigin}/products/fetch_main`, {
      method: 'POST', headers: { ...adminHeaders, 'content-type': 'application/json' },
      body: JSON.stringify({ size: 100, page: 0 }),
    });
    const productRows = Array.isArray(products.data) ? products.data
      : Array.isArray(products.data?.items) ? products.data.items
        : Array.isArray(products.data?.data) ? products.data.data : [];
    report.product = { status: 'NEW_EXCLUSIVE_PRODUCT_REQUIRED', adminPlmUserId,
      activeProductCount: productRows.filter(row => row.is_deleted === 0 && row.is_archived === 0).length };
    if (!report.product?.id) {
      const identifier = `NA${candidate.runId.toUpperCase()}`;
      const name = `Native role acceptance ${candidate.runId}`;
      report.plannedProduct = { identifier, name, adminPlmUserId };
      const before = await call('owned-product-collision', `${plmOrigin}/products/fetch_main`, {
        method: 'POST', headers: { ...adminHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({ n_identifier_eq: identifier, page: 0, size: 100 }),
      });
      assert.ok(Array.isArray(before.data) && before.data.length === 0);
      let created;
      try {
        created = await call('owned-product-create', `${plmOrigin}/products`, {
          method: 'POST', headers: { ...adminHeaders, 'content-type': 'application/json' },
          body: JSON.stringify({ name, identifier, visibility: 'private',
            members: [{ user_id: adminPlmUserId, role_id: 'admin' }] }),
        });
        report.product = { id: boundedId(created.data?.id), identifier, name, adminPlmUserId,
          createdByThisRun: true, cleanupVerified: false };
        assert.equal(created.data?.identifier, identifier);
        assert.equal(created.data?.name, name);
      } catch (error) {
        const readback = await call('failed-product-create-readback', `${plmOrigin}/products/fetch_main`, {
          method: 'POST', headers: { ...adminHeaders, 'content-type': 'application/json' },
          body: JSON.stringify({ n_identifier_eq: identifier, page: 0, size: 100 }),
        });
        assert.ok(Array.isArray(readback.data));
        const matches = readback.data.filter(row => row.identifier === identifier && row.name === name
          && row.create_man === adminPlmUserId);
        report.productCreationOutcomeUncertain = matches.length > 1;
        if (matches.length === 1) report.product = { id: boundedId(matches[0].id),
          identifier, name, adminPlmUserId, createdByThisRun: true, cleanupVerified: false };
        throw error;
      }
      const readback = await call('owned-product-readback',
        `${plmOrigin}/products/${encodeURIComponent(report.product.id)}`,
        { method: 'GET', headers: adminHeaders });
      assert.equal(readback.data?.name, name);
      assert.equal(readback.data?.identifier, identifier);
      assert.equal(readback.data?.create_man, adminPlmUserId);
    }
    phase = 'create-and-readback';
    for (const key of actorKeys) {
      const entry = entries[key];
      const body = buildNativePersonBody(entry.candidate, entry.credentials.candidatePassword,
        organizationId, organizationRoleId, dc);
      assertNoActorCollision(physicalCounts(entry.candidate.plannedUid));
      let created;
      try {
        created = await call(`person-create-${key}`, `${uaaOrigin}/sys_people`, {
          method: 'POST', headers: { ...adminHeaders, 'content-type': 'application/json' },
          body: JSON.stringify(body),
        });
        entry.issuedPersonId = boundedId(created.data?.id);
        report.usersCreated += 1;
        assert.equal(created.data?.uid, entry.candidate.plannedUid);
      } catch (error) {
        const readback = await call(`failed-person-create-readback-${key}`,
          `${uaaOrigin}/sys_people/fetchdefault`, {
            method: 'POST', headers: { ...adminHeaders, 'content-type': 'application/json' },
            body: JSON.stringify({ n_uid_eq: entry.candidate.plannedUid }),
          });
        const matches = Array.isArray(readback.data) ? readback.data
          .filter(row => row.uid === entry.candidate.plannedUid) : [];
        entry.persistenceAfterFailedCreate = physicalCounts(entry.candidate.plannedUid);
        report.creationOutcomeUncertain ||= matches.length > 1
          || matches.length === 0 && Object.values(entry.persistenceAfterFailedCreate).some(value => value !== 0);
        if (matches.length === 1 && !entry.issuedPersonId) {
          entry.issuedPersonId = boundedId(matches[0].id);
          report.usersCreated += 1;
        }
        throw error;
      }
      const personId = entry.issuedPersonId;
      const person = await call(`person-read-${key}`, `${uaaOrigin}/sys_people/${encodeURIComponent(personId)}`, {
        method: 'GET', headers: adminHeaders,
      });
      assert.equal(person.data?.id, personId);
      assert.equal(person.data?.uid, entry.candidate.plannedUid);
      assert.equal(person.data?.organization_id, organizationId);
      const members = Array.isArray(person.data?.member_of) ? person.data.member_of : [];
      const ownMember = members.find(member => member.organization_id === organizationId);
      assert.ok(ownMember?.id && ownMember.person_id === personId);
      entry.memberId = boundedId(ownMember.id);
      entry.organizationRoleId = ownMember.organizational_role_id ?? null;
      assert.equal(entry.organizationRoleId, organizationRoleId);
      const roles = await call(`role-member-read-${key}`, `${uaaOrigin}/sys_role_members/fetchdefault`, {
        method: 'POST', headers: { ...adminHeaders, 'content-type': 'application/json' },
        body: JSON.stringify({ n_member_uid_eq: personId }),
      });
      const roleRows = Array.isArray(roles.data) ? roles.data : [];
      const authorities = [];
      for (const role of roleRows) {
        if (role.role_id) {
          const roleRead = await call(`role-read-${key}`, `${uaaOrigin}/sys_roles/${encodeURIComponent(role.role_id)}`, {
            method: 'GET', headers: adminHeaders,
          });
          if (typeof roleRead.data?.authority === 'string') authorities.push(roleRead.data.authority);
        }
      }
      assessAutomaticAuthorities(authorities);
      entry.automaticAuthorities = authorities.sort();
      const login = await request(`${plmOrigin}/v7/login`, {
        method: 'POST', headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ loginname: entry.candidate.plannedUid,
          password: entry.credentials.candidatePassword }),
        redirect: 'error', signal: AbortSignal.timeout(10000),
      });
      const loginBody = Buffer.from(await login.arrayBuffer());
      const loginData = readJsonBody(loginBody);
      assert.equal(login.status, 200, `Created actor login failed: ${key}`);
      const actorToken = loginData?.token;
      assert.ok(typeof actorToken === 'string' && actorToken.length < 32768);
      report.requests.push({ label: `actor-login-${key}`, method: 'POST', path: '/v7/login',
        status: login.status, bytes: loginBody.length, sha256: sha(loginBody), tokenPersisted: false });
      const actorSelf = await call(`actor-native-self-${key}`, `${uaaOrigin}/auths/user-info/self`, {
        method: 'GET', headers: { accept: 'application/json', authorization: `Bearer ${actorToken}` },
      });
      assert.equal(actorSelf.data?.id, personId);
      const effectiveSelfAuthorities = [...new Set((actorSelf.data.roles ?? []).flatMap(system =>
        (system.roles ?? []).map(role => role.authority).filter(Boolean)))];
      assessAutomaticAuthorities(effectiveSelfAuthorities);
      assert.ok(String(actorSelf.data.super_user) !== '1' && String(actorSelf.data.api_user) !== '1');
      entry.effectiveSelfAuthorities = effectiveSelfAuthorities;
      const appdata = await call(`actor-appdata-${key}`, `${plmOrigin}/appdata`, {
        method: 'GET', headers: { accept: 'application/json', authorization: `Bearer ${actorToken}` },
      });
      const context = appdata.data?.context ?? {};
      assert.ok(typeof context.srfuserid === 'string' && context.srfuserid);
      assert.equal(context.srfpersonid, personId);
      entry.plmUserId = context.srfuserid;
      entry.plmContext = { srfuseridPresent: true, srfpersonidPresent: Boolean(context.srfpersonid),
        srfpersonidMatchesIssuedId: true,
        srforgid: context.srforgid ?? null, srfdcsystemid: context.srfdcsystemid ?? null };
      if (report.product?.id && key !== 'nonmember') {
        const roleId = key === 'readonly' ? 'reader' : 'user';
        let productMember;
        try {
          productMember = await call(`product-member-create-${key}`, `${plmOrigin}/product_members`, {
            method: 'POST', headers: { ...adminHeaders, 'content-type': 'application/json' },
            body: JSON.stringify({ product_id: report.product.id, user_id: entry.plmUserId, role_id: roleId }),
          });
          entry.productMemberId = boundedId(productMember.data?.id);
          entry.productRole = roleId;
          report.productMembersCreated += 1;
          assert.equal(productMember.data?.product_id, report.product.id);
          assert.equal(productMember.data?.user_id, entry.plmUserId);
          assert.equal(productMember.data?.role_id, roleId);
        } catch (error) {
          const recovery = await call(`failed-product-member-readback-${key}`,
            `${plmOrigin}/product_members/fetch_default`, {
              method: 'POST', headers: { ...adminHeaders, 'content-type': 'application/json' },
              body: JSON.stringify({ n_product_id_eq: report.product.id, n_user_id_eq: entry.plmUserId }),
            });
          assert.ok(Array.isArray(recovery.data));
          const matches = recovery.data.filter(row => row.product_id === report.product.id
            && row.user_id === entry.plmUserId && row.role_id === roleId);
          report.creationOutcomeUncertain ||= matches.length > 1;
          if (matches.length === 1 && !entry.productMemberId) {
            entry.productMemberId = boundedId(matches[0].id);
            entry.productRole = roleId;
            report.productMembersCreated += 1;
          }
          throw error;
        }
      }
      if (report.product?.id) {
        const productMembers = await call(`product-member-read-${key}`,
          `${plmOrigin}/product_members/fetch_default`, {
            method: 'POST', headers: { ...adminHeaders, 'content-type': 'application/json' },
            body: JSON.stringify({ n_product_id_eq: report.product.id, n_user_id_eq: entry.plmUserId }),
          });
        const productRowsForUser = Array.isArray(productMembers.data) ? productMembers.data : [];
        entry.productMemberCount = productRowsForUser.length;
        assessProductMemberCount(key, entry.productMemberCount);
        for (const row of productRowsForUser) {
          assert.equal(row.id, entry.productMemberId);
          assert.equal(row.product_id, report.product.id);
          assert.equal(row.user_id, entry.plmUserId);
          assert.equal(row.role_id, entry.productRole);
        }
      } else {
        entry.productMemberCount = null;
        entry.productMembershipBlocked = true;
      }
      const privateCredential = { contract: 'native-actor-created-credentials-v1',
        status: 'CREATED_LOGIN_AND_APPDATA_VERIFIED', actorKey: key,
        username: entry.candidate.plannedUid, password: entry.credentials.candidatePassword,
        userId: entry.plmUserId, personId: entry.issuedPersonId,
        productId: report.product.id, productRole: entry.productRole ?? null,
        organizationId, organizationalRoleId: organizationRoleId };
      const credentialBytes = json(privateCredential);
      writePrivate(join(output, `${key}.credentials.private.json`), credentialBytes);
      entry.credentialFile = { path: `${key}.credentials.private.json`, sha256: sha(credentialBytes) };
    }
    report.status = report.product?.id
      ? 'CREATED_READ_BACK_AND_MEMBER_ASSIGNED'
      : 'CREATED_READ_BACK_PRODUCT_MEMBERSHIP_BLOCKED';
  } catch (error) {
    report.status = 'FAILED_DURING_NATIVE_ACTOR_RUN';
    report.failedPhase = phase;
    report.failure = { type: error.name, message: String(error.message).slice(0, 500),
      summary: error.summary ?? null };
  } finally {
    const adminHeaders = adminToken ? { accept: 'application/json', authorization: `Bearer ${adminToken}` } : null;
    const retainedForMatrix = options.retainForMatrix
      && report.status === 'CREATED_READ_BACK_AND_MEMBER_ASSIGNED'
      && report.usersCreated === 3 && report.productMembersCreated === 2;
    if (retainedForMatrix) {
      report.retainedForMatrix = true;
      report.privateCredentialFiles = Object.fromEntries(Object.entries(entries)
        .map(([key, entry]) => [key, entry.credentialFile]));
    }
    if (adminHeaders && !retainedForMatrix) {
      for (const key of actorKeys) {
        const entry = entries[key];
        if (entry.productMemberId) {
          try {
            const current = await call(`product-member-before-delete-${key}`,
              `${plmOrigin}/product_members/${encodeURIComponent(entry.productMemberId)}`,
              { method: 'GET', headers: adminHeaders });
            assert.equal(current.data?.user_id, entry.plmUserId);
            assert.equal(current.data?.product_id, report.product.id);
            const removed = await call(`product-member-delete-${key}`,
              `${plmOrigin}/product_members/${encodeURIComponent(entry.productMemberId)}`, {
                method: 'DELETE', headers: adminHeaders,
              }, { allowStatus: [200, 204], parse: false });
            entry.cleanup.productMemberDeleteStatus = removed.response.status;
            report.productMembersCleaned += 1;
          } catch (error) {
            entry.cleanup.productMemberDeleteError = error.name;
          }
        }
      }
      if (report.product?.createdByThisRun) {
        try {
          const product = report.product;
          const current = await call('owned-product-before-cleanup',
            `${plmOrigin}/products/${encodeURIComponent(product.id)}`,
            { method: 'GET', headers: adminHeaders });
          assert.equal(current.data?.identifier, product.identifier);
          assert.equal(current.data?.name, product.name);
          await call('owned-product-delete',
            `${plmOrigin}/products/${encodeURIComponent(product.id)}`,
            { method: 'DELETE', headers: adminHeaders }, { allowStatus: [200, 204], parse: false });
          let remain = 0;
          for (const dataset of ['main', 'archived', 'deleted']) {
            const readback = await call(`owned-product-absence-${dataset}`,
              `${plmOrigin}/products/fetch_${dataset}`, {
                method: 'POST', headers: { ...adminHeaders, 'content-type': 'application/json' },
                body: JSON.stringify({ n_identifier_eq: product.identifier, page: 0, size: 100 }),
              });
            assert.ok(Array.isArray(readback.data));
            remain += readback.data.filter(row => row.id === product.id).length;
          }
          product.cleanupVerified = remain === 0;
        } catch (error) { report.product.cleanupError = error.name; }
      }
      for (const key of actorKeys) {
        const entry = entries[key];
        if (entry.issuedPersonId) {
          try {
            const current = await call(`person-before-delete-${key}`,
              `${uaaOrigin}/sys_people/${encodeURIComponent(entry.issuedPersonId)}`,
              { method: 'GET', headers: adminHeaders });
            assert.equal(current.data?.uid, entry.candidate.plannedUid);
            assert.equal(current.data?.display_name, entry.candidate.plannedDisplayName);
            assert.equal(current.data?.employee_number, entry.candidate.plannedUid);
            const removed = await call(`person-delete-${key}`,
              `${uaaOrigin}/sys_people/${encodeURIComponent(entry.issuedPersonId)}`, {
                method: 'DELETE', headers: adminHeaders,
              }, { allowStatus: [200, 204], parse: false });
            entry.cleanup.personDeleteStatus = removed.response.status;
            report.usersCleaned += 1;
          } catch (error) {
            entry.cleanup.personDeleteError = error.name;
          }
        }
      }
      for (const key of actorKeys) {
        const entry = entries[key];
        if (entry.issuedPersonId) {
          try {
            const readback = await call(`person-cleanup-read-${key}`,
              `${uaaOrigin}/sys_people/${encodeURIComponent(entry.issuedPersonId)}`, {
                method: 'GET', headers: adminHeaders,
              }, { allowStatus: [404], parse: false });
            entry.cleanup.personReadbackStatus = readback.response.status;
          } catch (error) { entry.cleanup.personReadbackError = error.name; }
          try {
            entry.cleanup.physicalCounts = physicalCounts(entry.candidate.plannedUid);
            const roleRows = await call(`person-cleanup-roles-${key}`,
              `${uaaOrigin}/sys_role_members/fetchdefault`, {
                method: 'POST', headers: { ...adminHeaders, 'content-type': 'application/json' },
                body: JSON.stringify({ n_member_uid_eq: entry.issuedPersonId }),
              });
            assert.ok(Array.isArray(roleRows.data));
            entry.cleanup.nativeRoleRows = roleRows.data.length;
            const members = await call(`person-cleanup-members-${key}`,
              `${uaaOrigin}/sys_members/fetchdefault`, {
                method: 'POST', headers: { ...adminHeaders, 'content-type': 'application/json' },
                body: JSON.stringify({ n_person_id_eq: entry.issuedPersonId }),
              });
            assert.ok(Array.isArray(members.data));
            entry.cleanup.nativeMemberRows = members.data.length;
          } catch (error) { entry.cleanup.relationReadbackError = error.name; }
        }
      }
      if (report.organizationRole?.createdByThisRun) {
        try {
          const group = report.organizationRole;
          const current = await call('own-org-role-before-cleanup',
            `${uaaOrigin}/sys_organizational_roles/${encodeURIComponent(group.id)}`,
            { method: 'GET', headers: adminHeaders });
          assert.equal(current.data?.name, group.name);
          assert.equal(current.data?.organization_id, group.organizationId);
          const members = await call('own-org-role-members-before-cleanup',
            `${uaaOrigin}/sys_members/fetchdefault`, {
              method: 'POST', headers: { ...adminHeaders, 'content-type': 'application/json' },
              body: JSON.stringify({ n_organizational_role_id_eq: group.id }),
            });
          assert.ok(Array.isArray(members.data) && members.data.length === 0);
          await call('own-org-role-delete',
            `${uaaOrigin}/sys_organizational_roles/${encodeURIComponent(group.id)}`,
            { method: 'DELETE', headers: adminHeaders }, { allowStatus: [200], parse: false });
          const absent = await call('own-org-role-cleanup-absence',
            `${uaaOrigin}/sys_organizational_roles/${encodeURIComponent(group.id)}`,
            { method: 'GET', headers: adminHeaders }, { allowStatus: [404], parse: false });
          group.cleanupVerified = absent.response.status === 404;
        } catch (error) { report.organizationRole.cleanupError = error.name; }
      }
    }
    report.cleanup.status = retainedForMatrix ? 'PENDING_ROLE_MATRIX'
      : nativeActorCleanupVerdict(report, entries);
    report.actors = Object.fromEntries(Object.entries(entries).map(([key, entry]) =>
      [key, projectNativeActorEvidence(entry)]));
    report.finishedAt = new Date().toISOString();
    report.runtimeAfter = runtimeSnapshot(execute);
    report.runtimeUnchanged = JSON.stringify(report.runtimeAfter) === JSON.stringify(initialRuntime);
    report.preparedCandidatesModified = sha(readPrivate(candidatePath)) !== sha(candidateBytes)
      || sha(readPrivate(credentialPath)) !== sha(credentialBytes);
    writePrivate(join(output, 'report.private.json'), json(report));
    for (const path of [join(output, 'source'), output]) {
      const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_DIRECTORY);
      try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    }
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { output: { type: 'string' },
    'retain-for-matrix': { type: 'boolean', default: false } }, strict: true });
  try {
    const report = await provisionExistingNativeActors({ output: values.output,
      retainForMatrix: values['retain-for-matrix'] });
    console.log(JSON.stringify({ status: report.status, cleanup: report.cleanup.status,
      usersCreated: report.usersCreated, usersCleaned: report.usersCleaned,
      productMembersCreated: report.productMembersCreated,
      productMembersCleaned: report.productMembersCleaned, runtimeUnchanged: report.runtimeUnchanged,
      preparedCandidatesModified: report.preparedCandidatesModified }));
    if (!['PASS_NATIVE_LOGICAL_DELETE', 'PENDING_ROLE_MATRIX'].includes(report.cleanup.status)
      || report.status !== 'CREATED_READ_BACK_AND_MEMBER_ASSIGNED') process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ status: 'REFUSED', type: error.name, rawErrorWithheld: true }));
    process.exitCode = 1;
  }
}
