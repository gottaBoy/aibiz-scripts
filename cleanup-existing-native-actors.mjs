#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { nativeActorCollisionSQL } from './provision-existing-native-actors.mjs';

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

export function nativeRetainedCleanupVerdict(report) {
  return report.persons.length === (report.expectedPersons ?? 3)
    && report.persons.every(person => person.deleteStatus === 200
    && person.readbackStatus === 404 && person.nativeMemberRows === 0 && person.nativeRoleRows === 0
    && person.physicalCounts?.activeRows === 0 && person.physicalCounts?.disabledRows === 1)
    && report.productMembers.length === (report.expectedProductMembers ?? 2)
    && report.productMembers.every(member => member.deleteStatus === 200 && member.remainingRows === 0)
    && report.productAbsent === true && report.organizationRoleAbsent === true
    && (!report.crossOrganizationId || report.crossOrganizationAbsent === true
      && report.crossOrganizationRoleAbsent === true) ? 'PASS' : 'FAILED';
}

export async function cleanupExistingNativeActors({ fixtures, output, objectAdmin, crossOrg }) {
  const source = resolve(fixtures);
  const destination = resolve(output);
  assert.equal(dirname(source), join(root, '.artifacts'));
  assert.match(basename(source), /^native-actors-run-[A-Za-z0-9-]+$/);
  assert.equal(dirname(destination), join(root, '.artifacts'));
  assert.match(basename(destination), /^native-actors-cleanup-[A-Za-z0-9-]+$/);
  assert.ok(!fs.existsSync(destination));
  const fixtureBytes = readPrivate(join(source, 'report.private.json'));
  const fixture = JSON.parse(fixtureBytes);
  assert.equal(fixture.status, 'CREATED_READ_BACK_AND_MEMBER_ASSIGNED');
  assert.equal(fixture.retainedForMatrix, true);
  assert.equal(fixture.product.createdByThisRun, true);
  assert.equal(fixture.organizationRole.createdByThisRun, true);
  if (objectAdmin) {
    const extraSource = resolve(objectAdmin);
    assert.equal(dirname(extraSource), join(root, '.artifacts'));
    assert.match(basename(extraSource), /^native-product-admin-[A-Za-z0-9-]+$/);
    const extraBytes = readPrivate(join(extraSource, 'report.private.json'));
    const extra = JSON.parse(extraBytes);
    assert.equal(extra.status, 'CREATED_NORMAL_USER_AND_NATIVE_PRODUCT_ADMIN');
    assert.equal(extra.productId, fixture.product.id);
    assert.equal(extra.retainedForMatrix, true);
    fixture.actors.objectadmin = { candidate: extra.candidate, issuedPersonId: extra.issuedPersonId,
      plmUserId: extra.plmUserId, productMemberId: extra.productMemberId, productRole: 'admin' };
    fixture.objectAdminReportSha256 = hash(extraBytes);
  }
  if (crossOrg) {
    const extraSource = resolve(crossOrg);
    assert.equal(dirname(extraSource), join(root, '.artifacts'));
    assert.match(basename(extraSource), /^native-crossorg-[A-Za-z0-9-]+$/);
    const extraBytes = readPrivate(join(extraSource, 'report.private.json'));
    const extra = JSON.parse(extraBytes);
    assert.equal(extra.status, 'CREATED_CROSS_ORGANIZATION_AND_PRIVATE_READ_DENIED');
    assert.equal(extra.fixtureReportSha256, hash(fixtureBytes));
    assert.equal(extra.productId, fixture.product.id);
    assert.equal(extra.retainedForMatrix, true);
    fixture.actors.crossorg = { candidate: extra.candidate, issuedPersonId: extra.issuedPersonId,
      plmUserId: extra.plmUserId, productMemberId: null, productRole: null,
      organizationId: extra.organization.id, organizationRoleId: extra.organizationRole.id };
    fixture.crossOrganization = extra.organization;
    fixture.crossOrganizationRole = extra.organizationRole;
    fixture.crossOrgReportSha256 = hash(extraBytes);
  }
  const mysql = JSON.parse(execute('docker', ['inspect', 'mysql']))[0];
  assert.equal(mysql.Name, '/mysql');
  assert.equal(mysql.State.Status, 'running');
  assert.equal(mysql.Id, fixture.extraRuntimeBefore.mysql.id);
  const volume = mysql.Mounts.find(mount => mount.Destination === '/var/lib/mysql');
  assert.equal(volume?.Name, 'compose_mysql_data');
  const admin = JSON.parse(readPrivate(join(root,
    '.artifacts/current-business-actors-20261122-r1/credentials.private.json')));
  fs.mkdirSync(destination, { mode: 0o700 });
  const report = { contract: 'native-retained-actors-exact-cleanup-v1', status: 'RUNNING',
    startedAt: new Date().toISOString(), fixtureReportSha256: hash(fixtureBytes), requests: [],
    persons: [], productMembers: [], directDatabaseWrites: 0, readOnlySqlUsed: true,
    expectedPersons: Object.keys(fixture.actors).length,
    expectedProductMembers: Object.values(fixture.actors).filter(actor => actor.productMemberId).length,
    objectAdminReportSha256: fixture.objectAdminReportSha256 ?? null,
    crossOrgReportSha256: fixture.crossOrgReportSha256 ?? null,
    crossOrganizationId: fixture.crossOrganization?.id ?? null,
    credentialsRetired: false, privateCredentialsRemoved: false };
  let token;
  const call = async (label, origin, path, method = 'GET', body, allow = [200]) => {
    if (method === 'DELETE') writePrivate(join(destination,
      `intent-${String(report.requests.length).padStart(3, '0')}.private.json`),
    serialize({ label, method, path, recordedBeforeDispatch: true }));
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
    token = (await login.json()).token;
    assert.ok(typeof token === 'string' && token.length < 32768);
    const product = await call('product-before-cleanup', plm,
      `/products/${encodeURIComponent(fixture.product.id)}`);
    assert.equal(product.data?.identifier, fixture.product.identifier);
    assert.equal(product.data?.name, fixture.product.name);
    const group = await call('group-before-cleanup', uaa,
      `/sys_organizational_roles/${encodeURIComponent(fixture.organizationRole.id)}`);
    assert.equal(group.data?.name, fixture.organizationRole.name);
    assert.equal(group.data?.organization_id, fixture.organizationRole.organizationId);
    for (const [key, actor] of Object.entries(fixture.actors)) {
      const person = await call(`person-before-cleanup-${key}`, uaa,
        `/sys_people/${encodeURIComponent(actor.issuedPersonId)}`);
      assert.equal(person.data?.uid, actor.candidate.plannedUid);
      assert.equal(person.data?.employee_number, actor.candidate.plannedUid);
      const actorOrganizationId = actor.organizationId ?? fixture.organizationRole.organizationId;
      const actorOrganizationRoleId = actor.organizationRoleId ?? fixture.organizationRole.id;
      assert.equal(person.data?.organization_id, actorOrganizationId);
      const ownMembers = person.data.member_of?.filter(member =>
        member.organization_id === actorOrganizationId
        && member.organizational_role_id === actorOrganizationRoleId) ?? [];
      assert.equal(ownMembers.length, 1);
    }
    for (const [key, actor] of Object.entries(fixture.actors)) {
      if (!actor.productMemberId) continue;
      const current = await call(`product-member-before-cleanup-${key}`, plm,
        `/product_members/${encodeURIComponent(actor.productMemberId)}`);
      assert.equal(current.data?.product_id, fixture.product.id);
      assert.equal(current.data?.user_id, actor.plmUserId);
      assert.equal(current.data?.role_id, actor.productRole);
      const removed = await call(`product-member-delete-${key}`, plm,
        `/product_members/${encodeURIComponent(actor.productMemberId)}`, 'DELETE');
      const remaining = await call(`product-member-absence-${key}`, plm, '/product_members/fetch_default',
        'POST', { n_product_id_eq: fixture.product.id, n_user_id_eq: actor.plmUserId });
      assert.ok(Array.isArray(remaining.data));
      report.productMembers.push({ actorKey: key, deleteStatus: removed.status,
        remainingRows: remaining.data.length });
    }
    await call('product-delete', plm, `/products/${encodeURIComponent(fixture.product.id)}`, 'DELETE');
    let remainingProducts = 0;
    for (const dataset of ['main', 'archived', 'deleted']) {
      const result = await call(`product-absence-${dataset}`, plm, `/products/fetch_${dataset}`,
        'POST', { n_identifier_eq: fixture.product.identifier, page: 0, size: 100 });
      assert.ok(Array.isArray(result.data));
      remainingProducts += result.data.filter(row => row.id === fixture.product.id).length;
    }
    report.productAbsent = remainingProducts === 0;
    for (const [key, actor] of Object.entries(fixture.actors)) {
      const removed = await call(`person-delete-${key}`, uaa,
        `/sys_people/${encodeURIComponent(actor.issuedPersonId)}`, 'DELETE');
      const absent = await call(`person-absence-${key}`, uaa,
        `/sys_people/${encodeURIComponent(actor.issuedPersonId)}`, 'GET', undefined, [404]);
      const roles = await call(`person-role-absence-${key}`, uaa, '/sys_role_members/fetchdefault',
        'POST', { n_member_uid_eq: actor.issuedPersonId });
      const members = await call(`person-member-absence-${key}`, uaa, '/sys_members/fetchdefault',
        'POST', { n_person_id_eq: actor.issuedPersonId });
      assert.ok(Array.isArray(roles.data) && Array.isArray(members.data));
      const countBytes = execute('docker', ['exec', '-i', mysql.Id, 'sh', '-c',
        'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql --protocol=TCP -h127.0.0.1 -uroot'
        + ' --default-character-set=utf8mb4 --batch --raw --skip-column-names'],
      nativeActorCollisionSQL(actor.candidate.plannedUid));
      report.persons.push({ actorKey: key, deleteStatus: removed.status,
        readbackStatus: absent.status, nativeRoleRows: roles.data.length,
        nativeMemberRows: members.data.length, physicalCounts: JSON.parse(countBytes.trim()) });
    }
    const members = await call('group-members-before-delete', uaa, '/sys_members/fetchdefault',
      'POST', { n_organizational_role_id_eq: fixture.organizationRole.id });
    assert.ok(Array.isArray(members.data) && members.data.length === 0);
    await call('group-delete', uaa,
      `/sys_organizational_roles/${encodeURIComponent(fixture.organizationRole.id)}`, 'DELETE');
    const absent = await call('group-absence', uaa,
      `/sys_organizational_roles/${encodeURIComponent(fixture.organizationRole.id)}`, 'GET', undefined, [404]);
    report.organizationRoleAbsent = absent.status === 404;
    if (fixture.crossOrganization) {
      const crossGroup = fixture.crossOrganizationRole;
      const crossOrganization = fixture.crossOrganization;
      const currentGroup = await call('cross-group-before-cleanup', uaa,
        `/sys_organizational_roles/${encodeURIComponent(crossGroup.id)}`);
      assert.equal(currentGroup.data?.name, crossGroup.name);
      assert.equal(currentGroup.data?.organization_id, crossOrganization.id);
      const remainingMembers = await call('cross-group-members-before-cleanup', uaa,
        '/sys_members/fetchdefault', 'POST', { n_organizational_role_id_eq: crossGroup.id });
      assert.ok(Array.isArray(remainingMembers.data) && remainingMembers.data.length === 0);
      await call('cross-group-delete', uaa,
        `/sys_organizational_roles/${encodeURIComponent(crossGroup.id)}`, 'DELETE');
      const groupAbsent = await call('cross-group-absence', uaa,
        `/sys_organizational_roles/${encodeURIComponent(crossGroup.id)}`, 'GET', undefined, [404]);
      report.crossOrganizationRoleAbsent = groupAbsent.status === 404;
      const currentOrganization = await call('cross-organization-before-cleanup', uaa,
        `/sys_organizations/${encodeURIComponent(crossOrganization.id)}`);
      assert.equal(currentOrganization.data?.organization_number, crossOrganization.number);
      assert.equal(currentOrganization.data?.organization_name, crossOrganization.name);
      assert.ok(!currentOrganization.data?.parent_id);
      await call('cross-organization-delete', uaa,
        `/sys_organizations/${encodeURIComponent(crossOrganization.id)}`, 'DELETE');
      const organizationAbsent = await call('cross-organization-absence', uaa,
        `/sys_organizations/${encodeURIComponent(crossOrganization.id)}`, 'GET', undefined, [404]);
      report.crossOrganizationAbsent = organizationAbsent.status === 404;
    }
    report.status = nativeRetainedCleanupVerdict(report);
    report.credentialsRetired = report.status === 'PASS';
  } catch (error) {
    report.status = 'FAILED';
    report.failure = { type: error.name, message: String(error.message).slice(0, 400) };
  } finally {
    report.finishedAt = new Date().toISOString();
    writePrivate(join(destination, 'report.private.json'), serialize(report));
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { fixtures: { type: 'string' }, output: { type: 'string' },
    'object-admin': { type: 'string' }, 'cross-org': { type: 'string' } },
    strict: true });
  try {
    const report = await cleanupExistingNativeActors({ fixtures: values.fixtures, output: values.output,
      objectAdmin: values['object-admin'], crossOrg: values['cross-org'] });
    console.log(JSON.stringify({ status: report.status, usersCleaned: report.persons.length,
      productMembersCleaned: report.productMembers.length, productAbsent: report.productAbsent,
      organizationRoleAbsent: report.organizationRoleAbsent }));
    if (report.status !== 'PASS') process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ status: 'REFUSED', type: error.name, rawErrorWithheld: true }));
    process.exitCode = 1;
  }
}
