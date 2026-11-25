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
import { selectNativeProductOrganization } from './probe-native-product-role-matrix.mjs';

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
export function nativeOrganizationNumberCollisionSQL(number) {
  assert.match(number, /^NORG[a-f0-9]{12}$/);
  return 'START TRANSACTION READ ONLY;\nSELECT JSON_OBJECT(\'organizationNumberRows\',COUNT(*))'
    + ' FROM `a_lab01_3f9ebc219`.`sys_organization` WHERE `ORGANIZATION_NUMBER`='
    + `CONVERT(0x${Buffer.from(number).toString('hex')} USING utf8mb4);\nCOMMIT;\n`;
}

export async function provisionNativeCrossOrganizationActor({ fixtures, output }) {
  const source = resolve(fixtures);
  const destination = resolve(output);
  assert.equal(dirname(source), join(root, '.artifacts'));
  assert.match(basename(source), /^native-actors-run-[A-Za-z0-9-]+$/);
  assert.equal(dirname(destination), join(root, '.artifacts'));
  assert.match(basename(destination), /^native-crossorg-[A-Za-z0-9-]+$/);
  assert.ok(!fs.existsSync(destination));
  const fixtureBytes = readPrivate(join(source, 'report.private.json'));
  const fixture = JSON.parse(fixtureBytes);
  assert.equal(fixture.status, 'CREATED_READ_BACK_AND_MEMBER_ASSIGNED');
  assert.equal(fixture.retainedForMatrix, true);
  assert.equal(fixture.product.createdByThisRun, true);
  const mysql = JSON.parse(execute('docker', ['inspect', 'mysql']))[0];
  assert.equal(mysql.Name, '/mysql');
  assert.equal(mysql.State.Status, 'running');
  assert.equal(mysql.Id, fixture.extraRuntimeBefore.mysql.id);
  assert.equal(mysql.Mounts.find(mount => mount.Destination === '/var/lib/mysql')?.Name,
    'compose_mysql_data');
  const runId = randomBytes(6).toString('hex');
  const candidate = { plannedUid: `nat_${runId}_crossorg`,
    plannedDisplayName: `Native cross organization ${runId}` };
  const plannedOrganization = { name: `Native isolated organization ${runId}`, number: `NORG${runId}` };
  const groupName = `Native cross organization group ${runId}`;
  const password = `${randomBytes(24).toString('base64url')}!Aa7`;
  const admin = JSON.parse(readPrivate(join(root,
    '.artifacts/current-business-actors-20261122-r1/credentials.private.json')));
  fs.mkdirSync(destination, { mode: 0o700 });
  const report = { contract: 'native-cross-organization-actor-v1', status: 'RUNNING',
    startedAt: new Date().toISOString(), fixtureReportSha256: hash(fixtureBytes), candidate,
    plannedOrganization, issuedPersonId: null, productId: fixture.product.id, productMemberCount: null,
    organization: null, organizationRole: null, requests: [], directDatabaseWrites: 0,
    readOnlySqlUsed: true, identityHeadersInjected: false, privilegedUaaRolesRequested: false };
  let adminToken;
  let actorToken;
  let selectedOrganization;
  const physical = sql => JSON.parse(execute('docker', ['exec', '-i', mysql.Id, 'sh', '-c',
    'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql --protocol=TCP -h127.0.0.1 -uroot'
      + ' --default-character-set=utf8mb4 --batch --raw --skip-column-names'], sql).trim());
  const call = async (label, origin, path, method = 'GET', body, token = adminToken, allow = [200]) => {
    if (['POST', 'DELETE'].includes(method) && !/fetchdefault|fetch_default/.test(path)) {
      writePrivate(join(destination, `intent-${String(report.requests.length).padStart(3, '0')}.private.json`),
        serialize({ label, method, path, uid: candidate.plannedUid, recordedBeforeDispatch: true }));
    }
    const response = await fetch(`${origin}${path}`, { method,
      headers: { accept: 'application/json', 'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        ...(token === actorToken && selectedOrganization ? { srforgid: selectedOrganization.orgId } : {}) },
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
    const product = await call('original-product-ownership', plm,
      `/products/${encodeURIComponent(fixture.product.id)}`);
    assert.equal(product.data?.identifier, fixture.product.identifier);
    report.personPreflightCounts = physical(nativeActorCollisionSQL(candidate.plannedUid));
    assertNoActorCollision(report.personPreflightCounts);
    report.organizationPreflightCounts = physical(
      nativeOrganizationNumberCollisionSQL(plannedOrganization.number));
    assert.equal(report.organizationPreflightCounts.organizationNumberRows, 0);
    try {
      const created = await call('organization-create', uaa, '/sys_organizations', 'POST',
        { organization_name: plannedOrganization.name, organization_number: plannedOrganization.number,
          description: `Own cross organization validation ${runId}`, sort: 1 });
      if (typeof created.data?.id === 'string') report.organization = {
        id: created.data.id, name: plannedOrganization.name, number: plannedOrganization.number };
      assert.ok(report.organization?.id);
    } catch (error) {
      const result = await call('failed-organization-create-readback', uaa,
        '/sys_organizations/fetchdefault', 'POST',
        { n_organization_number_like: plannedOrganization.number });
      assert.ok(Array.isArray(result.data));
      const matches = result.data.filter(row => row.organization_number === plannedOrganization.number
        && row.organization_name === plannedOrganization.name);
      if (matches.length === 1) report.organization = {
        id: matches[0].id, name: plannedOrganization.name, number: plannedOrganization.number };
      report.creationOutcomeUncertain = matches.length > 1;
      throw error;
    }
    const organization = await call('organization-readback', uaa,
      `/sys_organizations/${encodeURIComponent(report.organization.id)}`);
    assert.equal(organization.data?.organization_number, plannedOrganization.number);
    assert.equal(organization.data?.organization_name, plannedOrganization.name);
    assert.notEqual(organization.data?.id, fixture.bindings.organizationId);
    assert.ok(!organization.data?.parent_id, 'The own organization must be a separate root');
    try {
      const group = await call('organization-role-create', uaa, '/sys_organizational_roles', 'POST',
        { name: groupName, organization_id: report.organization.id, sort: 1 });
      if (typeof group.data?.id === 'string') report.organizationRole = {
        id: group.data.id, name: groupName, organizationId: report.organization.id };
      assert.ok(report.organizationRole?.id);
    } catch (error) {
      const result = await call('failed-organization-role-readback', uaa,
        '/sys_organizational_roles/fetchdefault', 'POST',
        { n_name_like: groupName, n_organization_id_eq: report.organization.id });
      assert.ok(Array.isArray(result.data));
      const matches = result.data.filter(row => row.name === groupName
        && row.organization_id === report.organization.id);
      if (matches.length === 1) report.organizationRole = {
        id: matches[0].id, name: groupName, organizationId: report.organization.id };
      report.creationOutcomeUncertain ||= matches.length > 1;
      throw error;
    }
    const group = await call('organization-role-readback', uaa,
      `/sys_organizational_roles/${encodeURIComponent(report.organizationRole.id)}`);
    assert.equal(group.data?.name, groupName);
    assert.equal(group.data?.organization_id, report.organization.id);
    const roleBindings = await call('organization-role-authorities', uaa,
      '/sys_role_members/fetchdefault', 'POST', { n_member_uid_eq: report.organizationRole.id });
    assert.ok(Array.isArray(roleBindings.data) && roleBindings.data.length === 0);
    report.organizationRole.permissionBindingCount = 0;
    assertNoActorCollision(physical(nativeActorCollisionSQL(candidate.plannedUid)));
    try {
      const person = await call('person-create', uaa, '/sys_people', 'POST',
        buildNativePersonBody(candidate, password, report.organization.id, report.organizationRole.id, null));
      if (typeof person.data?.id === 'string') report.issuedPersonId = person.data.id;
      assert.ok(report.issuedPersonId);
      assert.equal(person.data?.uid, candidate.plannedUid);
    } catch (error) {
      const result = await call('failed-person-create-readback', uaa, '/sys_people/fetchdefault',
        'POST', { n_uid_eq: candidate.plannedUid });
      assert.ok(Array.isArray(result.data));
      const matches = result.data.filter(row => row.uid === candidate.plannedUid);
      if (matches.length === 1) report.issuedPersonId = matches[0].id;
      report.failedPersonCreateCounts = physical(nativeActorCollisionSQL(candidate.plannedUid));
      report.creationOutcomeUncertain ||= matches.length > 1 || matches.length === 0
        && Object.values(report.failedPersonCreateCounts).some(value => value !== 0);
      throw error;
    }
    const person = await call('person-readback', uaa,
      `/sys_people/${encodeURIComponent(report.issuedPersonId)}`);
    assert.equal(person.data?.organization_id, report.organization.id);
    assert.equal(person.data?.uid, candidate.plannedUid);
    assert.equal(person.data?.employee_number, candidate.plannedUid);
    assert.ok(person.data.member_of?.some(member =>
      member.organization_id === report.organization.id
      && member.organizational_role_id === report.organizationRole.id
      && member.person_id === report.issuedPersonId));
    const actorLogin = await fetch(`${plm}/v7/login`, { method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ loginname: candidate.plannedUid, password }),
      redirect: 'error', signal: AbortSignal.timeout(15000) });
    assert.equal(actorLogin.status, 200);
    actorToken = (await actorLogin.json()).token;
    assert.ok(typeof actorToken === 'string' && actorToken.length < 32768);
    const self = await call('actor-native-self', uaa, '/auths/user-info/self',
      'GET', undefined, actorToken);
    assert.equal(self.data?.id, report.issuedPersonId);
    report.authorities = [...new Set((self.data?.roles ?? []).flatMap(system =>
      (system.roles ?? []).map(role => role.authority).filter(Boolean)))];
    assessAutomaticAuthorities(report.authorities);
    assert.ok(String(self.data?.super_user) !== '1' && String(self.data?.api_user) !== '1');
    const orgSystems = await call('actor-selectable-organizations', plm,
      '/uaa/getbydcsystem/ibizplm', 'GET', undefined, actorToken);
    selectedOrganization = selectNativeProductOrganization(orgSystems.data, report.organization.id);
    assert.ok(!orgSystems.data.some(row => row.orgid === fixture.bindings.organizationId),
      'Cross organization actor unexpectedly acquired the original organization');
    const appdata = await call('actor-native-selected-appdata', 'http://127.0.0.1:30000',
      '/appdata/ibizplm', 'GET', undefined, actorToken);
    assert.equal(appdata.data?.context?.srforgid, report.organization.id);
    assert.equal(appdata.data?.context?.srfuserid, report.issuedPersonId);
    assert.equal(appdata.data?.context?.srfpersonid, report.issuedPersonId);
    report.plmUserId = appdata.data.context.srfuserid;
    report.organizationSelection = { ...selectedOrganization, fromNativeOrgSystem: true,
      nativeSelectedAppdataMatched: true };
    const members = await call('original-product-no-membership', plm,
      '/product_members/fetch_default', 'POST',
      { n_product_id_eq: fixture.product.id, n_user_id_eq: report.plmUserId });
    assert.ok(Array.isArray(members.data) && members.data.length === 0);
    report.productMemberCount = 0;
    const denied = await call('cross-organization-private-product-read', plm,
      `/products/${encodeURIComponent(fixture.product.id)}`, 'GET', undefined, actorToken, [403]);
    report.privateProductReadStatus = denied.status;
    const credential = serialize({ contract: 'native-actor-created-credentials-v1',
      status: 'CREATED_LOGIN_AND_APPDATA_VERIFIED', actorKey: 'crossorg',
      username: candidate.plannedUid, password, userId: report.plmUserId,
      personId: report.issuedPersonId, organizationId: report.organization.id,
      organizationalRoleId: report.organizationRole.id, productId: fixture.product.id, productRole: null });
    writePrivate(join(destination, 'crossorg.credentials.private.json'), credential);
    report.credentialFile = { path: 'crossorg.credentials.private.json', sha256: hash(credential) };
    report.status = 'CREATED_CROSS_ORGANIZATION_AND_PRIVATE_READ_DENIED';
    report.retainedForMatrix = true;
  } catch (error) {
    report.status = 'FAILED';
    report.failure = { type: error.name, message: String(error.message).slice(0, 400) };
    report.cleanupRequired = Boolean(report.organization || report.organizationRole || report.issuedPersonId);
    if (adminToken) {
      try {
        if (report.issuedPersonId) {
          const current = await call('failed-person-before-cleanup', uaa,
            `/sys_people/${encodeURIComponent(report.issuedPersonId)}`);
          assert.equal(current.data?.uid, candidate.plannedUid);
          assert.equal(current.data?.employee_number, candidate.plannedUid);
          await call('failed-person-delete', uaa,
            `/sys_people/${encodeURIComponent(report.issuedPersonId)}`, 'DELETE');
          await call('failed-person-absence', uaa,
            `/sys_people/${encodeURIComponent(report.issuedPersonId)}`, 'GET', undefined, adminToken, [404]);
        }
        if (report.organizationRole) {
          const current = await call('failed-role-before-cleanup', uaa,
            `/sys_organizational_roles/${encodeURIComponent(report.organizationRole.id)}`);
          assert.equal(current.data?.name, groupName);
          assert.equal(current.data?.organization_id, report.organization.id);
          await call('failed-role-delete', uaa,
            `/sys_organizational_roles/${encodeURIComponent(report.organizationRole.id)}`, 'DELETE');
          await call('failed-role-absence', uaa,
            `/sys_organizational_roles/${encodeURIComponent(report.organizationRole.id)}`, 'GET',
            undefined, adminToken, [404]);
        }
        if (report.organization) {
          const current = await call('failed-organization-before-cleanup', uaa,
            `/sys_organizations/${encodeURIComponent(report.organization.id)}`);
          assert.equal(current.data?.organization_number, plannedOrganization.number);
          await call('failed-organization-delete', uaa,
            `/sys_organizations/${encodeURIComponent(report.organization.id)}`, 'DELETE');
          await call('failed-organization-absence', uaa,
            `/sys_organizations/${encodeURIComponent(report.organization.id)}`, 'GET',
            undefined, adminToken, [404]);
        }
        report.cleanupRequired = false;
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
    const report = await provisionNativeCrossOrganizationActor(values);
    console.log(JSON.stringify({ status: report.status, privateProductReadStatus: report.privateProductReadStatus,
      retainedForMatrix: report.retainedForMatrix, cleanupRequired: report.cleanupRequired ?? false }));
    if (report.status !== 'CREATED_CROSS_ORGANIZATION_AND_PRIVATE_READ_DENIED') process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ status: 'REFUSED', type: error.name, rawErrorWithheld: true }));
    process.exitCode = 1;
  }
}
