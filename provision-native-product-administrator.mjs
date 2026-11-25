#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { assertNoActorCollision, assessAutomaticAuthorities, buildNativePersonBody,
  nativeActorCollisionSQL } from './provision-existing-native-actors.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const plm = 'http://127.0.0.1:30250/api/ibizplm__plmweb';
const uaa = 'http://127.0.0.1:32666';
const hash = value => createHash('sha256').update(value).digest('hex');
const serialize = value => `${JSON.stringify(value, null, 2)}\n`;

function readPrivate(path) {
  const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    assert.ok(stat.isFile() && stat.uid === process.geteuid() && (stat.mode & 0o077) === 0);
    return fs.readFileSync(fd);
  } finally { fs.closeSync(fd); }
}

function writePrivate(path, data) {
  const fd = fs.openSync(path, fs.constants.O_WRONLY | fs.constants.O_CREAT
    | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try { fs.writeFileSync(fd, data); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
}

function execute(program, args, input) {
  const result = spawnSync(program, args, { input, encoding: 'utf8', timeout: 20000,
    maxBuffer: 4 * 1024 * 1024 });
  assert.ok(result.status === 0 && !result.error && !result.signal);
  return result.stdout;
}

export function assertNativeProductAdministratorBinding(member, productId, userId) {
  assert.ok(typeof member?.id === 'string' && member.id.length > 0);
  assert.equal(member.product_id, productId);
  assert.equal(member.user_id, userId);
  assert.equal(member.role_id, 'admin');
}

export async function provisionNativeProductAdministrator({ fixtures, output }) {
  const source = resolve(fixtures);
  const destination = resolve(output);
  assert.equal(dirname(source), join(root, '.artifacts'));
  assert.match(basename(source), /^native-actors-run-[A-Za-z0-9-]+$/);
  assert.equal(dirname(destination), join(root, '.artifacts'));
  assert.match(basename(destination), /^native-product-admin-[A-Za-z0-9-]+$/);
  assert.ok(!fs.existsSync(destination));
  const fixtureBytes = readPrivate(join(source, 'report.private.json'));
  const fixture = JSON.parse(fixtureBytes);
  assert.equal(fixture.status, 'CREATED_READ_BACK_AND_MEMBER_ASSIGNED');
  assert.equal(fixture.retainedForMatrix, true);
  assert.equal(fixture.product.createdByThisRun, true);
  assert.equal(fixture.organizationRole.createdByThisRun, true);
  const mysql = JSON.parse(execute('docker', ['inspect', 'mysql']))[0];
  assert.equal(mysql.Name, '/mysql');
  assert.equal(mysql.State.Status, 'running');
  assert.equal(mysql.Id, fixture.extraRuntimeBefore.mysql.id);
  assert.equal(mysql.Mounts.find(mount => mount.Destination === '/var/lib/mysql')?.Name,
    'compose_mysql_data');
  const candidate = { plannedUid: `nat_${randomBytes(6).toString('hex')}_objectadmin`,
    plannedDisplayName: `Native product administrator ${randomBytes(6).toString('hex')}` };
  const password = `${randomBytes(24).toString('base64url')}!Aa7`;
  const admin = JSON.parse(readPrivate(join(root,
    '.artifacts/current-business-actors-20261122-r1/credentials.private.json')));
  fs.mkdirSync(destination, { mode: 0o700 });
  const report = { contract: 'native-product-administrator-create-v1', status: 'RUNNING',
    startedAt: new Date().toISOString(), fixtureReportSha256: hash(fixtureBytes),
    candidate, issuedPersonId: null, productMemberId: null,
    productId: fixture.product.id, productRole: 'admin', requests: [], directDatabaseWrites: 0,
    readOnlySqlUsed: true, identityHeadersInjected: false, privilegedUaaRolesRequested: false };
  let adminToken;
  const counts = () => JSON.parse(execute('docker', ['exec', '-i', mysql.Id, 'sh', '-c',
    'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql --protocol=TCP -h127.0.0.1 -uroot'
      + ' --default-character-set=utf8mb4 --batch --raw --skip-column-names'],
  nativeActorCollisionSQL(candidate.plannedUid)).trim());
  const call = async (label, origin, path, method = 'GET', body, token = adminToken, allow = [200]) => {
    if (['POST', 'DELETE'].includes(method) && !/fetchdefault|fetch_default/.test(path)) {
      writePrivate(join(destination, `intent-${String(report.requests.length).padStart(3, '0')}.private.json`),
        serialize({ label, method, path, uid: candidate.plannedUid, recordedBeforeDispatch: true }));
    }
    const response = await fetch(`${origin}${path}`, { method,
      headers: { accept: 'application/json', 'content-type': 'application/json',
        authorization: `Bearer ${token}` },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'error', signal: AbortSignal.timeout(15000) });
    const raw = Buffer.from(await response.arrayBuffer());
    let data;
    try { data = JSON.parse(raw.toString()); } catch { data = null; }
    report.requests.push({ label, path, method, status: response.status,
      bytes: raw.length, sha256: hash(raw) });
    assert.ok(allow.includes(response.status), `${label}: HTTP ${response.status}`);
    return { status: response.status, data };
  };
  try {
    const login = await fetch(`${plm}/v7/login`, { method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ loginname: admin.username, password: admin.password }),
      redirect: 'error', signal: AbortSignal.timeout(15000) });
    assert.equal(login.status, 200);
    adminToken = (await login.json()).token;
    assert.ok(typeof adminToken === 'string' && adminToken.length < 32768);
    const product = await call('product-ownership', plm,
      `/products/${encodeURIComponent(fixture.product.id)}`);
    assert.equal(product.data?.identifier, fixture.product.identifier);
    const group = await call('group-ownership', uaa,
      `/sys_organizational_roles/${encodeURIComponent(fixture.organizationRole.id)}`);
    assert.equal(group.data?.name, fixture.organizationRole.name);
    assert.equal(group.data?.organization_id, fixture.organizationRole.organizationId);
    const bindings = await call('group-authorities', uaa, '/sys_role_members/fetchdefault',
      'POST', { n_member_uid_eq: fixture.organizationRole.id });
    assert.ok(Array.isArray(bindings.data) && bindings.data.length === 0);
    report.preflightCounts = counts();
    assertNoActorCollision(report.preflightCounts);
    try {
      const created = await call('person-create', uaa, '/sys_people', 'POST',
        buildNativePersonBody(candidate, password, fixture.organizationRole.organizationId,
          fixture.organizationRole.id, null));
      if (typeof created.data?.id === 'string') report.issuedPersonId = created.data.id;
      assert.equal(created.data?.uid, candidate.plannedUid);
    } catch (error) {
      const readback = await call('failed-create-readback', uaa, '/sys_people/fetchdefault',
        'POST', { n_uid_eq: candidate.plannedUid });
      assert.ok(Array.isArray(readback.data));
      const matches = readback.data.filter(row => row.uid === candidate.plannedUid);
      report.failedCreateCounts = counts();
      if (matches.length === 1) report.issuedPersonId = matches[0].id;
      report.creationOutcomeUncertain = matches.length > 1
        || matches.length === 0 && Object.values(report.failedCreateCounts).some(value => value !== 0);
      throw error;
    }
    assert.ok(report.issuedPersonId);
    const person = await call('person-readback', uaa,
      `/sys_people/${encodeURIComponent(report.issuedPersonId)}`);
    assert.equal(person.data?.uid, candidate.plannedUid);
    assert.equal(person.data?.employee_number, candidate.plannedUid);
    assert.equal(person.data?.organization_id, fixture.organizationRole.organizationId);
    assert.ok(person.data?.member_of?.some(member =>
      member.organizational_role_id === fixture.organizationRole.id
      && member.person_id === report.issuedPersonId));
    const actorLogin = await fetch(`${plm}/v7/login`, { method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ loginname: candidate.plannedUid, password }),
      redirect: 'error', signal: AbortSignal.timeout(15000) });
    assert.equal(actorLogin.status, 200);
    const actorToken = (await actorLogin.json()).token;
    assert.ok(typeof actorToken === 'string' && actorToken.length < 32768);
    const self = await call('native-self', uaa, '/auths/user-info/self', 'GET', undefined, actorToken);
    assert.equal(self.data?.id, report.issuedPersonId);
    report.authorities = [...new Set((self.data?.roles ?? []).flatMap(system =>
      (system.roles ?? []).map(role => role.authority).filter(Boolean)))];
    assessAutomaticAuthorities(report.authorities);
    assert.ok(String(self.data?.super_user) !== '1' && String(self.data?.api_user) !== '1');
    const appdata = await call('normal-appdata', plm, '/appdata', 'GET', undefined, actorToken);
    assert.equal(appdata.data?.context?.srfpersonid, report.issuedPersonId);
    assert.equal(appdata.data?.context?.srfuserid, report.issuedPersonId);
    report.plmUserId = appdata.data.context.srfuserid;
    const membershipBefore = await call('member-before-create', plm, '/product_members/fetch_default',
      'POST', { n_product_id_eq: fixture.product.id, n_user_id_eq: report.plmUserId });
    assert.ok(Array.isArray(membershipBefore.data) && membershipBefore.data.length === 0);
    try {
      const member = await call('member-create', plm, '/product_members', 'POST',
        { product_id: fixture.product.id, user_id: report.plmUserId, role_id: 'admin' });
      if (typeof member.data?.id === 'string') report.productMemberId = member.data.id;
      assert.ok(report.productMemberId);
    } finally {
      const readback = await call('member-independent-readback', plm, '/product_members/fetch_default',
        'POST', { n_product_id_eq: fixture.product.id, n_user_id_eq: report.plmUserId });
      assert.ok(Array.isArray(readback.data));
      const matches = readback.data.filter(row => row.product_id === fixture.product.id
        && row.user_id === report.plmUserId && row.role_id === 'admin');
      if (matches.length === 1) report.productMemberId = matches[0].id;
      assert.equal(matches.length, 1);
      assertNativeProductAdministratorBinding(matches[0], fixture.product.id, report.plmUserId);
      report.productMemberCount = 1;
    }
    const credential = serialize({ contract: 'native-actor-created-credentials-v1',
      status: 'CREATED_LOGIN_AND_APPDATA_VERIFIED', actorKey: 'objectadmin',
      username: candidate.plannedUid, password, userId: report.plmUserId,
      personId: report.issuedPersonId, organizationId: fixture.organizationRole.organizationId,
      organizationalRoleId: fixture.organizationRole.id, productId: fixture.product.id, productRole: 'admin' });
    writePrivate(join(destination, 'objectadmin.credentials.private.json'), credential);
    report.credentialFile = { path: 'objectadmin.credentials.private.json', sha256: hash(credential) };
    report.status = 'CREATED_NORMAL_USER_AND_NATIVE_PRODUCT_ADMIN';
    report.retainedForMatrix = true;
  } catch (error) {
    report.status = 'FAILED';
    report.failure = { type: error.name, message: String(error.message).slice(0, 400) };
    if (adminToken) {
      try {
        if (report.productMemberId) {
          const member = await call('failed-member-before-delete', plm,
            `/product_members/${encodeURIComponent(report.productMemberId)}`);
          assert.equal(member.data?.user_id, report.plmUserId);
          assert.equal(member.data?.product_id, fixture.product.id);
          await call('failed-member-delete', plm,
            `/product_members/${encodeURIComponent(report.productMemberId)}`, 'DELETE');
        }
        if (report.issuedPersonId) {
          const person = await call('failed-person-before-delete', uaa,
            `/sys_people/${encodeURIComponent(report.issuedPersonId)}`);
          assert.equal(person.data?.uid, candidate.plannedUid);
          assert.equal(person.data?.employee_number, candidate.plannedUid);
          await call('failed-person-delete', uaa,
            `/sys_people/${encodeURIComponent(report.issuedPersonId)}`, 'DELETE');
          const absent = await call('failed-person-absence', uaa,
            `/sys_people/${encodeURIComponent(report.issuedPersonId)}`, 'GET', undefined, adminToken, [404]);
          report.cleanup = { readbackStatus: absent.status, physicalCounts: counts() };
        }
      } catch (cleanupError) { report.cleanupFailure = { type: cleanupError.name }; }
    }
  } finally {
    report.finishedAt = new Date().toISOString();
    writePrivate(join(destination, 'report.private.json'), serialize(report));
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { fixtures: { type: 'string' }, output: { type: 'string' } },
    strict: true });
  try {
    const report = await provisionNativeProductAdministrator(values);
    console.log(JSON.stringify({ status: report.status, productRole: report.productRole,
      retainedForMatrix: report.retainedForMatrix, cleanup: report.cleanup?.readbackStatus }));
    if (report.status !== 'CREATED_NORMAL_USER_AND_NATIVE_PRODUCT_ADMIN') process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ status: 'REFUSED', type: error.name, rawErrorWithheld: true }));
    process.exitCode = 1;
  }
}
