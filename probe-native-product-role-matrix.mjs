#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const origin = 'http://127.0.0.1:30250/api/ibizplm__plmweb';
const keys = ['ordinary', 'readonly', 'nonmember'];
const hash = value => createHash('sha256').update(value).digest('hex');
const bytes = value => `${JSON.stringify(value, null, 2)}\n`;

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

export function nativeIdeaStableProjection(value) {
  return Object.fromEntries(['id', 'title', 'product_id', 'state', 'create_man', 'update_man',
    'update_time', 'is_deleted', 'is_archived'].map(key => [key, value?.[key] ?? null]));
}

export function nativeRoleMatrixVerdict(checks) {
  return checks.length > 0 && checks.every(check => check.pass === true) ? 'PASS' : 'FAILED';
}

export function selectNativeProductOrganization(orgSystems, actualOrganizationId) {
  assert.ok(Array.isArray(orgSystems));
  const matches = orgSystems.filter(row => row.systemid === 'ibizplm'
    && row.dcsystemid === 'ibizplm' && row.orgid === actualOrganizationId);
  assert.equal(matches.length, 1, 'The actual native organization must be selectable exactly once');
  return { systemId: matches[0].systemid, orgId: matches[0].orgid,
    dcSystemId: matches[0].dcsystemid };
}

export function nativeIdeaEffectSnapshotSQL(productId, actorId, providedId, marker, titleMarker) {
  assert.match(productId, /^[a-f0-9]{32}$/);
  assert.match(providedId, /^[a-f0-9]{32}$/);
  assert.match(actorId, /^nat_[a-f0-9]{12}_(?:ordinary|readonly|nonmember|crossorg)$/);
  assert.match(marker, /^Native ACL native-product-role-matrix-[A-Za-z0-9-]+$/);
  assert.ok(titleMarker.startsWith(marker) && titleMarker.length <= 200
    && /^[A-Za-z0-9 -]+$/.test(titleMarker));
  const literal = value => `CONVERT(0x${Buffer.from(value).toString('hex')} USING utf8mb4)`;
  const product = literal(productId);
  const actor = literal(actorId);
  const id = literal(providedId);
  const prefix = literal(marker);
  const title = literal(titleMarker);
  const sequence = ' FROM `plm`.`SEQUENCE_GENERATOR`'
    + ` WHERE \`NAME\`='seq_idea_id' AND \`GROUP_TAG\`=${product}`;
  const entries = [
    "'sequenceRows',(SELECT COUNT(*)" + sequence + ')',
    "'sequenceMin',(SELECT MIN(`CURRENT_VALUE`)" + sequence + ')',
    "'sequenceMax',(SELECT MAX(`CURRENT_VALUE`)" + sequence + ')',
    "'ownProductIdeaRows',(SELECT COUNT(*) FROM `plm`.`IDEA` WHERE `PRODUCT_ID`=" + product + ')',
    "'ownPrefixIdeaRows',(SELECT COUNT(*) FROM `plm`.`IDEA` WHERE `PRODUCT_ID`=" + product
      + ` AND LOCATE(${prefix},\`TITLE\`)>0)`,
    "'plannedIdeaRows',(SELECT COUNT(*) FROM `plm`.`IDEA` WHERE `ID`=" + id + ')',
    "'actorIdeaRows',(SELECT COUNT(*) FROM `plm`.`IDEA` WHERE `PRODUCT_ID`=" + product
      + ` AND \`CREATE_MAN\`=${actor})`,
    "'actorVersionRows',(SELECT COUNT(*) FROM `plm`.`VERSION` WHERE `CREATE_MAN`=" + actor + ')',
    "'plannedVersionRows',(SELECT COUNT(*) FROM `plm`.`VERSION` WHERE `OWNER_ID`=" + id + ')',
    "'actorRecentRows',(SELECT COUNT(*) FROM `plm`.`RECENT` WHERE `CREATE_MAN`=" + actor
      + ` AND \`RECENT_PARENT\`=${product})`,
    "'plannedRecentRows',(SELECT COUNT(*) FROM `plm`.`RECENT` WHERE `OWNER_ID`=" + id + ')',
    "'plannedInternalMessageRows',(SELECT COUNT(*) FROM `a_lab01_3f9ebc219`.`INTERNAL_MESSAGE` WHERE `OWNER_ID`=" + id + ')',
    "'actorInternalMessageRows',(SELECT COUNT(*) FROM `a_lab01_3f9ebc219`.`INTERNAL_MESSAGE` WHERE `CREATE_MAN`=" + actor + ')',
    "'titleInternalMessageRows',(SELECT COUNT(*) FROM `a_lab01_3f9ebc219`.`INTERNAL_MESSAGE`"
      + ` WHERE LOCATE(${title},\`TITLE\`)>0 OR LOCATE(${title},\`SHORT_CONTENT\`)>0`
      + ` OR LOCATE(${title},\`CONTENT\`)>0)`,
  ];
  return `START TRANSACTION READ ONLY;\nSELECT JSON_OBJECT(${entries.join(',')});\nCOMMIT;\n`;
}

export function assertFreshNativeIdeaKey(snapshot) {
  for (const key of ['plannedIdeaRows', 'plannedVersionRows', 'plannedRecentRows',
    'plannedInternalMessageRows']) assert.equal(snapshot[key], 0, 'The own supplied idea key already exists');
}

function runtime() {
  const result = spawnSync('docker', ['inspect', 'ibizlab-uaa-api', 'plmweb', 'plmservice',
    'ibiz-ebsx-allinone', 'mysql'],
    { encoding: 'utf8', timeout: 10000, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(result.status, 0);
  return JSON.parse(result.stdout).map(row => {
    assert.equal(row.State.Status, 'running');
    return { name: row.Name, id: row.Id, image: row.Image, startedAt: row.State.StartedAt,
      restartCount: row.RestartCount, configSha256: hash(bytes(row.Config)),
      mountsSha256: hash(bytes([...row.Mounts].sort((a, b) =>
        a.Destination.localeCompare(b.Destination)))) };
  });
}

export async function probeNativeProductRoleMatrix({ fixtures, output, objectAdmin, crossOrg }) {
  const source = resolve(fixtures);
  assert.equal(dirname(source), join(root, '.artifacts'));
  assert.match(basename(source), /^native-actors-run-[A-Za-z0-9-]+$/);
  const destination = resolve(output);
  assert.equal(dirname(destination), join(root, '.artifacts'));
  assert.match(basename(destination), /^native-product-role-matrix-[A-Za-z0-9-]+$/);
  assert.ok(!fs.existsSync(destination));
  const fixtureBytes = readPrivate(join(source, 'report.private.json'));
  const fixture = JSON.parse(fixtureBytes);
  assert.equal(fixture.status, 'CREATED_READ_BACK_AND_MEMBER_ASSIGNED');
  assert.equal(fixture.retainedForMatrix, true);
  const productId = fixture.product.id;
  assert.ok(productId && fixture.product.createdByThisRun);
  const actors = Object.fromEntries(keys.map(key => {
    const data = readPrivate(join(source, `${key}.credentials.private.json`));
    assert.equal(hash(data), fixture.privateCredentialFiles[key].sha256);
    const credential = JSON.parse(data);
    assert.equal(credential.status, 'CREATED_LOGIN_AND_APPDATA_VERIFIED');
    assert.equal(credential.productId, productId);
    assert.equal(credential.personId, fixture.actors[key].issuedPersonId);
    return [key, credential];
  }));
  const matrixKeys = [...keys];
  let objectAdminReportSha256 = null;
  let crossOrgReportSha256 = null;
  if (objectAdmin) {
    const extraSource = resolve(objectAdmin);
    assert.equal(dirname(extraSource), join(root, '.artifacts'));
    assert.match(basename(extraSource), /^native-product-admin-[A-Za-z0-9-]+$/);
    const extraBytes = readPrivate(join(extraSource, 'report.private.json'));
    const extra = JSON.parse(extraBytes);
    assert.equal(extra.status, 'CREATED_NORMAL_USER_AND_NATIVE_PRODUCT_ADMIN');
    assert.equal(extra.productId, productId);
    assert.equal(extra.retainedForMatrix, true);
    const credentialBytes = readPrivate(join(extraSource, 'objectadmin.credentials.private.json'));
    assert.equal(hash(credentialBytes), extra.credentialFile.sha256);
    actors.objectadmin = JSON.parse(credentialBytes);
    assert.equal(actors.objectadmin.personId, extra.issuedPersonId);
    assert.equal(actors.objectadmin.productRole, 'admin');
    matrixKeys.push('objectadmin');
    objectAdminReportSha256 = hash(extraBytes);
  }
  if (crossOrg) {
    const extraSource = resolve(crossOrg);
    assert.equal(dirname(extraSource), join(root, '.artifacts'));
    assert.match(basename(extraSource), /^native-crossorg-[A-Za-z0-9-]+$/);
    const extraBytes = readPrivate(join(extraSource, 'report.private.json'));
    const extra = JSON.parse(extraBytes);
    assert.equal(extra.status, 'CREATED_CROSS_ORGANIZATION_AND_PRIVATE_READ_DENIED');
    assert.equal(extra.fixtureReportSha256, hash(fixtureBytes));
    assert.equal(extra.productId, productId);
    assert.equal(extra.retainedForMatrix, true);
    const credentialBytes = readPrivate(join(extraSource, 'crossorg.credentials.private.json'));
    assert.equal(hash(credentialBytes), extra.credentialFile.sha256);
    actors.crossorg = JSON.parse(credentialBytes);
    assert.equal(actors.crossorg.personId, extra.issuedPersonId);
    assert.equal(actors.crossorg.organizationId, extra.organization.id);
    assert.notEqual(actors.crossorg.organizationId, fixture.bindings.organizationId);
    assert.equal(actors.crossorg.productRole, null);
    matrixKeys.push('crossorg');
    crossOrgReportSha256 = hash(extraBytes);
  }
  const admin = JSON.parse(readPrivate(join(root,
    '.artifacts/current-business-actors-20261122-r1/credentials.private.json')));
  fs.mkdirSync(destination, { mode: 0o700 });
  const report = { contract: 'native-product-role-new-session-matrix-v1', status: 'RUNNING',
    startedAt: new Date().toISOString(), fixtureReportSha256: hash(fixtureBytes), productId,
    objectAdminReportSha256,
    crossOrgReportSha256,
    sourceSha256: hash(fs.readFileSync(fileURLToPath(import.meta.url))),
    runtimeBefore: runtime(), requests: [], checks: [], createdIdeas: [], cleanup: [],
    identityHeadersInjected: false, directDatabaseWrites: 0, readOnlySqlUsed: true,
    credentialsPersistedInReport: false };
  const tokens = {};
  const selectedOrganizations = {};
  const ownedIds = new Set();
  const marker = `Native ACL ${basename(destination)}`;
  const mysqlResult = spawnSync('docker', ['inspect', 'mysql'], {
    encoding: 'utf8', timeout: 10000, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(mysqlResult.status, 0);
  const mysql = JSON.parse(mysqlResult.stdout)[0];
  assert.equal(mysql.Id, fixture.extraRuntimeBefore.mysql.id);
  assert.equal(mysql.Name, '/mysql');
  assert.equal(mysql.State.Status, 'running');
  assert.equal(mysql.Mounts.find(mount => mount.Destination === '/var/lib/mysql')?.Name,
    'compose_mysql_data');
  report.effectSnapshotBindings = { sequenceName: 'seq_idea_id', groupTag: productId,
    groupSource: 'SysDESequenceRuntime.extFormatParams[0]=PRODUCT_ID',
    sequenceModelSha256: hash(fs.readFileSync(join(root, 'plm/model/PSSYSSEQUENCES/seq_idea_id.json'))),
    sequenceRuntimeSourceSha256: hash(fs.readFileSync(join(root,
      'ibiz-service-hub/libs/ibiz-runtime/src/main/java/net/ibizsys/runtime/res/SysDESequenceRuntime.java'))),
    mysqlId: mysql.Id, notificationsScope: 'INTERNAL_MESSAGE actual actor, provided owner ID and exact title marker',
    notificationSchema: 'a_lab01_3f9ebc219',
    messageQueueCoverage: false };
  const effectSnapshot = (key, providedId, title) => {
    const result = spawnSync('docker', ['exec', '-i', mysql.Id, 'sh', '-c',
      'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql --protocol=TCP -h127.0.0.1 -uroot'
        + ' --default-character-set=utf8mb4 --batch --raw --skip-column-names'],
    { input: nativeIdeaEffectSnapshotSQL(productId, actors[key].personId, providedId, marker, title),
      encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 });
    assert.equal(result.status, 0, 'Exact own effect snapshot failed');
    return JSON.parse(result.stdout.trim());
  };
  const headers = key => ({ accept: 'application/json', 'content-type': 'application/json',
    authorization: `Bearer ${tokens[key]}`,
    ...(selectedOrganizations[key] ? { srforgid: selectedOrganizations[key].orgId } : {}) });
  const recordCheck = (label, pass, detail = {}) => report.checks.push({ label, pass, ...detail });
  const call = async (label, key, path, method = 'GET', body, requestOrigin = origin, language) => {
    assert.ok(language === undefined || ['zh-CN', 'en-US'].includes(language));
    if (['POST', 'PUT', 'DELETE'].includes(method) && !/\/fetch_/.test(path)) {
      writePrivate(join(destination, `intent-${String(report.requests.length).padStart(3, '0')}.private.json`),
        bytes({ label, actor: key, path, method, recordedBeforeDispatch: true }));
    }
    const response = await fetch(`${requestOrigin}${path}`, { method, headers: {
      ...headers(key), ...(language ? { 'Accept-Language': language } : {}),
    },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'error', signal: AbortSignal.timeout(15000) });
    const raw = Buffer.from(await response.arrayBuffer());
    assert.ok(raw.length < 2 * 1024 * 1024);
    let data;
    try { data = JSON.parse(raw.toString()); } catch { data = null; }
    report.requests.push({ label, actor: key, path, method, status: response.status,
      origin: new URL(requestOrigin).origin, ...(language ? { language } : {}),
      bytes: raw.length, sha256: hash(raw) });
    return { status: response.status, data };
  };
  const findIdeas = async label => {
    const result = await call(label, 'admin', `/products/${encodeURIComponent(productId)}/ideas/fetch_normal`,
      'POST', { n_title_like: marker, page: 0, size: 100 });
    assert.equal(result.status, 200);
    assert.ok(Array.isArray(result.data));
    return result.data.filter(row => row.product_id === productId && row.title?.startsWith(marker));
  };
  const readIdea = async (label, key, id) =>
    call(label, key, `/products/${encodeURIComponent(productId)}/ideas/${encodeURIComponent(id)}`);
  try {
    for (const key of ['admin', ...matrixKeys]) {
      const credential = key === 'admin' ? admin : actors[key];
      const login = await fetch(`${origin}/v7/login`, { method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ loginname: credential.username, password: credential.password }),
        redirect: 'error', signal: AbortSignal.timeout(15000) });
      const raw = Buffer.from(await login.arrayBuffer());
      const data = JSON.parse(raw.toString());
      report.requests.push({ label: `fresh-login-${key}`, actor: key, path: '/v7/login',
        method: 'POST', status: login.status, bytes: raw.length, sha256: hash(raw), tokenPersisted: false });
      assert.equal(login.status, 200);
      assert.ok(typeof data.token === 'string' && data.token.length < 32768);
      tokens[key] = data.token;
      const orgSystems = await call(`native-selectable-organizations-${key}`, key,
        '/uaa/getbydcsystem/ibizplm');
      assert.equal(orgSystems.status, 200);
      const selection = selectNativeProductOrganization(orgSystems.data,
        key === 'admin' ? fixture.bindings.organizationId : credential.organizationId);
      const selectedAppdata = await call(`native-selected-appdata-${key}`, key, '/appdata/ibizplm',
        'GET', undefined, 'http://127.0.0.1:30000');
      assert.equal(selectedAppdata.status, 200);
      assert.equal(selectedAppdata.data?.context?.srforgid, selection.orgId);
      assert.equal(selectedAppdata.data?.context?.srfsystemid, selection.systemId);
      selectedOrganizations[key] = selection;
      report.organizationSelections ??= {};
      report.organizationSelections[key] = { ...selection, fromNativeOrgSystem: true,
        matchedNativeSelectedAppdata: true, forgedIdentityHeaders: false };
      const appdata = await call(`fresh-appdata-${key}`, key, '/appdata');
      assert.equal(appdata.status, 200);
      if (key !== 'admin') {
        recordCheck(`fresh-appdata-mapping-${key}`, appdata.data?.context?.srfuserid === credential.userId,
          { userId: credential.userId });
        recordCheck(`fresh-person-mapping-${key}`,
          appdata.data?.context?.srfpersonid === credential.personId, { personId: credential.personId });
      }
    }
    for (const key of matrixKeys) {
      const product = await call(`product-read-${key}`, key, `/products/${encodeURIComponent(productId)}`);
      recordCheck(`product-read-${key}`, ['nonmember', 'crossorg'].includes(key)
        ? [403, 404].includes(product.status)
        : product.status === 200 && product.data?.id === productId, { status: product.status });
    }
    if (actors.objectadmin) {
      const delegation = await call('objectadmin-native-role-delegation', 'objectadmin',
        `/sys_organizational_roles/${encodeURIComponent(fixture.organizationRole.id)}/roleauth`,
        'POST', {}, 'http://127.0.0.1:32666');
      const independent = await call('objectadmin-native-role-delegation-readback', 'admin',
        '/sys_role_members/fetchdefault', 'POST',
        { n_member_uid_eq: fixture.organizationRole.id }, 'http://127.0.0.1:32666');
      recordCheck('objectadmin-native-role-delegation-denied',
        delegation.status === 403 && independent.status === 200
        && Array.isArray(independent.data) && independent.data.length === 0,
      { status: delegation.status, emptyGrantRequest: true,
        persistedPermissionBindingRows: Array.isArray(independent.data) ? independent.data.length : null });
    }
    assert.equal((await findIdeas('own-idea-collision')).length, 0);
    const ordinaryProvidedId = randomBytes(16).toString('hex');
    const ordinaryTitle = `${marker} ordinary`;
    const ordinaryEffectsBefore = effectSnapshot('ordinary', ordinaryProvidedId, ordinaryTitle);
    assertFreshNativeIdeaKey(ordinaryEffectsBefore);
    let created;
    try {
      created = await call('ordinary-create-idea', 'ordinary',
        `/products/${encodeURIComponent(productId)}/ideas`, 'POST',
        { id: ordinaryProvidedId, title: ordinaryTitle, product_id: productId, state: '10' });
      if (created.status === 200 && typeof created.data?.id === 'string') {
        ownedIds.add(created.data.id);
        report.createdIdeas.push({ id: created.data.id, actor: 'ordinary' });
      }
    } finally {
      for (const row of await findIdeas('ordinary-create-independent-readback')) {
        ownedIds.add(row.id);
        if (!report.createdIdeas.some(entry => entry.id === row.id)) {
          report.createdIdeas.push({ id: row.id, actor: 'recovered' });
        }
      }
    }
    recordCheck('ordinary-create-idea', created?.status === 200 && ownedIds.size === 1,
      { status: created?.status ?? null, independentRows: ownedIds.size });
    const ordinaryEffectsAfter = effectSnapshot('ordinary', ordinaryProvidedId, ordinaryTitle);
    report.effectSnapshots = [{ actor: 'ordinary', providedId: ordinaryProvidedId,
      before: ordinaryEffectsBefore, after: ordinaryEffectsAfter }];
    recordCheck('ordinary-create-native-key-preserved',
      created?.status === 200 && created.data?.id === ordinaryProvidedId
      && ordinaryEffectsAfter.plannedIdeaRows === 1,
    { providedId: ordinaryProvidedId, returnedId: created?.data?.id ?? null });
    recordCheck('ordinary-create-sequence-positive-control',
      ordinaryEffectsAfter.sequenceRows === 1
      && ordinaryEffectsAfter.sequenceMin === ordinaryEffectsAfter.sequenceMax
      && ordinaryEffectsAfter.sequenceMin === (ordinaryEffectsBefore.sequenceRows === 0 ? 1
        : ordinaryEffectsBefore.sequenceMax + 1),
    { before: { rows: ordinaryEffectsBefore.sequenceRows, value: ordinaryEffectsBefore.sequenceMax },
      after: { rows: ordinaryEffectsAfter.sequenceRows, value: ordinaryEffectsAfter.sequenceMax } });
    if (ownedIds.size === 0) {
      const fallback = await call('admin-seed-after-ordinary-denial', 'admin',
        `/products/${encodeURIComponent(productId)}/ideas`, 'POST',
        { title: `${marker} admin seed`, product_id: productId, state: '10' });
      if (fallback.status === 200 && typeof fallback.data?.id === 'string') ownedIds.add(fallback.data.id);
      for (const row of await findIdeas('admin-seed-independent-readback')) ownedIds.add(row.id);
      report.adminSeedUsedAfterOrdinaryFailure = true;
      assert.equal(fallback.status, 200);
    }
    assert.equal(ownedIds.size, 1, 'Ordinary Create did not yield exactly one own idea');
    const ideaId = [...ownedIds][0];
    for (const key of matrixKeys) {
      const idea = await readIdea(`idea-read-${key}`, key, ideaId);
      recordCheck(`idea-read-${key}`, ['nonmember', 'crossorg'].includes(key) ? [403, 404].includes(idea.status)
        : idea.status === 200 && idea.data?.id === ideaId, { status: idea.status });
    }
    const ordinaryUpdate = await call('ordinary-update-idea', 'ordinary',
      `/products/${encodeURIComponent(productId)}/ideas/${encodeURIComponent(ideaId)}`, 'PUT',
      { id: ideaId, product_id: productId, title: `${marker} ordinary updated` });
    const updated = await readIdea('ordinary-update-independent-readback', 'admin', ideaId);
    recordCheck('ordinary-update-idea', ordinaryUpdate.status === 200 && updated.status === 200
      && updated.data?.title === `${marker} ordinary updated`, { status: ordinaryUpdate.status });
    const ordinarySave = await call('ordinary-save-existing-idea', 'ordinary', '/ideas/save', 'POST',
      { id: ideaId, title: `${marker} ordinary saved without parent override` });
    const saved = await readIdea('ordinary-save-independent-readback', 'admin', ideaId);
    recordCheck('ordinary-save-existing-idea', ordinarySave.status === 200 && saved.status === 200
      && saved.data?.title === `${marker} ordinary saved without parent override`
      && saved.data?.product_id === productId,
    { status: ordinarySave.status, parentOmittedFromRequest: true, originalParentPreserved:
      saved.data?.product_id === productId });
    let baseline = nativeIdeaStableProjection(saved.data);
    if (actors.objectadmin) {
      const objectAdminUpdate = await call('objectadmin-update-idea', 'objectadmin',
        `/products/${encodeURIComponent(productId)}/ideas/${encodeURIComponent(ideaId)}`, 'PUT',
        { id: ideaId, product_id: productId, title: `${marker} object administrator updated` });
      const independent = await readIdea('objectadmin-update-independent-readback', 'admin', ideaId);
      recordCheck('objectadmin-update-idea', objectAdminUpdate.status === 200 && independent.status === 200
        && independent.data?.title === `${marker} object administrator updated`,
      { status: objectAdminUpdate.status });
      baseline = nativeIdeaStableProjection(independent.data);
      const objectAdminSave = await call('objectadmin-save-existing-idea', 'objectadmin', '/ideas/save', 'POST',
        { id: ideaId, product_id: productId, title: `${marker} object administrator saved` });
      const savedByAdmin = await readIdea('objectadmin-save-independent-readback', 'admin', ideaId);
      recordCheck('objectadmin-save-existing-idea', objectAdminSave.status === 200
        && savedByAdmin.status === 200 && savedByAdmin.data?.title === `${marker} object administrator saved`
        && savedByAdmin.data?.product_id === productId, { status: objectAdminSave.status });
      baseline = nativeIdeaStableProjection(savedByAdmin.data);
    }
    for (const key of ['readonly', 'nonmember', ...(actors.crossorg ? ['crossorg'] : [])]) {
      const update = await call(`denied-update-${key}`, key,
        `/products/${encodeURIComponent(productId)}/ideas/${encodeURIComponent(ideaId)}`, 'PUT',
        { id: ideaId, product_id: productId, title: `${marker} unauthorized ${key}` });
      const afterUpdate = await readIdea(`denied-update-readback-${key}`, 'admin', ideaId);
      recordCheck(`denied-update-${key}`, [403, 404].includes(update.status)
        && afterUpdate.status === 200
        && JSON.stringify(nativeIdeaStableProjection(afterUpdate.data)) === JSON.stringify(baseline),
      { status: update.status, persistedBusinessFieldsUnchanged:
        JSON.stringify(nativeIdeaStableProjection(afterUpdate.data)) === JSON.stringify(baseline) });
      const beforeCreate = await findIdeas(`denied-create-before-${key}`);
      const providedId = randomBytes(16).toString('hex');
      const title = `${marker} unauthorized create ${key}`;
      const effectsBefore = effectSnapshot(key, providedId, title);
      assertFreshNativeIdeaKey(effectsBefore);
      const create = await call(`denied-create-${key}`, key,
        `/products/${encodeURIComponent(productId)}/ideas`, 'POST',
        { id: providedId, title, product_id: productId, state: '10' });
      const effectsAfter = effectSnapshot(key, providedId, title);
      report.effectSnapshots.push({ actor: key, providedId, before: effectsBefore, after: effectsAfter });
      recordCheck(`denied-create-sequence-${key}`,
        effectsAfter.sequenceRows === effectsBefore.sequenceRows
        && effectsAfter.sequenceMin === effectsBefore.sequenceMin
        && effectsAfter.sequenceMax === effectsBefore.sequenceMax,
      { before: { rows: effectsBefore.sequenceRows, value: effectsBefore.sequenceMax },
        after: { rows: effectsAfter.sequenceRows, value: effectsAfter.sequenceMax } });
      recordCheck(`denied-create-sideeffects-${key}`,
        JSON.stringify(effectsAfter) === JSON.stringify(effectsBefore),
      { allScopedCountsUnchanged: JSON.stringify(effectsAfter) === JSON.stringify(effectsBefore) });
      if (typeof create.data?.id === 'string') ownedIds.add(create.data.id);
      const afterCreate = await findIdeas(`denied-create-after-${key}`);
      for (const row of afterCreate) ownedIds.add(row.id);
      recordCheck(`denied-create-${key}`, [403, 404].includes(create.status)
        && afterCreate.length === beforeCreate.length,
      { status: create.status, beforeRows: beforeCreate.length, afterRows: afterCreate.length });
      const removal = await call(`denied-delete-${key}`, key,
        `/products/${encodeURIComponent(productId)}/ideas/${encodeURIComponent(ideaId)}`, 'DELETE');
      const afterRemoval = await readIdea(`denied-delete-readback-${key}`, 'admin', ideaId);
      recordCheck(`denied-delete-${key}`, [403, 404].includes(removal.status)
        && afterRemoval.status === 200
        && JSON.stringify(nativeIdeaStableProjection(afterRemoval.data)) === JSON.stringify(baseline),
      { status: removal.status, persistedBusinessFieldsUnchanged:
        JSON.stringify(nativeIdeaStableProjection(afterRemoval.data)) === JSON.stringify(baseline) });
      for (const language of ['zh-CN', 'en-US']) {
        const suppliedId = randomBytes(16).toString('hex');
        const title = `${marker} unauthorized localized ${language} ${key}`;
        const before = effectSnapshot(key, suppliedId, title);
        assertFreshNativeIdeaKey(before);
        const refusal = await call(`localized-create-refusal-${language}-${key}`, key,
          `/products/${encodeURIComponent(productId)}/ideas`, 'POST',
          { id: suppliedId, title, product_id: productId, state: '10' }, origin, language);
        const after = effectSnapshot(key, suppliedId, title);
        report.effectSnapshots.push({ actor: key, route: 'localized-create', language, providedId: suppliedId,
          before, after });
        if (typeof refusal.data?.id === 'string') ownedIds.add(refusal.data.id);
        for (const row of await findIdeas(`localized-create-discover-${language}-${key}`)) ownedIds.add(row.id);
        const expectedMessage = language === 'zh-CN' ? '需要产品写入权限' : 'Product write permission is required';
        recordCheck(`localized-create-refusal-${language}-${key}`, refusal.status === 403
          && refusal.data?.message === expectedMessage && JSON.stringify(before) === JSON.stringify(after),
        { status: refusal.status, language, localizedMessageMatched: refusal.data?.message === expectedMessage,
          allScopedCountsUnchanged: JSON.stringify(before) === JSON.stringify(after) });
      }
      for (const route of ['bare', 'save-new', 'save-existing']) {
        const suppliedId = route === 'save-existing' ? ideaId : randomBytes(16).toString('hex');
        const routeTitle = `${marker} unauthorized ${route} ${key}`;
        const beforeRoute = effectSnapshot(key, suppliedId, routeTitle);
        if (route !== 'save-existing') assertFreshNativeIdeaKey(beforeRoute);
        const response = await call(`denied-${route}-${key}`, key,
          route === 'bare' ? '/ideas' : '/ideas/save', 'POST',
          { id: suppliedId, title: routeTitle, product_id: productId, state: '10' });
        const afterRoute = effectSnapshot(key, suppliedId, routeTitle);
        report.effectSnapshots.push({ actor: key, route, providedId: suppliedId,
          before: beforeRoute, after: afterRoute });
        if (typeof response.data?.id === 'string') ownedIds.add(response.data.id);
        for (const row of await findIdeas(`denied-${route}-discover-${key}`)) ownedIds.add(row.id);
        const independent = await readIdea(`denied-${route}-readback-${key}`, 'admin', ideaId);
        recordCheck(`denied-${route}-${key}`,
          [403, 404].includes(response.status)
          && JSON.stringify(afterRoute) === JSON.stringify(beforeRoute)
          && independent.status === 200
          && JSON.stringify(nativeIdeaStableProjection(independent.data)) === JSON.stringify(baseline),
        { status: response.status, allScopedCountsUnchanged:
          JSON.stringify(afterRoute) === JSON.stringify(beforeRoute),
        existingIdeaBusinessFieldsUnchanged:
          JSON.stringify(nativeIdeaStableProjection(independent.data)) === JSON.stringify(baseline) });
      }
    }
    report.aclStatus = nativeRoleMatrixVerdict(report.checks);
    report.status = report.aclStatus;
  } catch (error) {
    report.status = 'FAILED';
    report.failure = { type: error.name, message: String(error.message).slice(0, 400) };
  } finally {
    if (tokens.admin) {
      try {
        for (const row of await findIdeas('cleanup-discover-own-ideas')) ownedIds.add(row.id);
        for (const id of ownedIds) {
          const current = await readIdea('cleanup-idea-before-delete', 'admin', id);
          if (current.status === 404) {
            report.cleanup.push({ id, alreadyAbsent: true });
            continue;
          }
          assert.equal(current.status, 200);
          assert.equal(current.data?.product_id, productId);
          assert.ok(current.data?.title?.startsWith(marker));
          const removed = await call('cleanup-idea-delete', 'admin',
            `/products/${encodeURIComponent(productId)}/ideas/${encodeURIComponent(id)}`, 'DELETE');
          const absent = await readIdea('cleanup-idea-absence', 'admin', id);
          report.cleanup.push({ id, deleteStatus: removed.status, readbackStatus: absent.status });
        }
        report.cleanupDatasetRows = {};
        for (const dataset of ['normal', 'archived', 'deleted']) {
          const result = await call(`cleanup-idea-dataset-${dataset}`, 'admin',
            `/products/${encodeURIComponent(productId)}/ideas/fetch_${dataset}`, 'POST',
            { n_title_like: marker, page: 0, size: 100 });
          assert.equal(result.status, 200);
          assert.ok(Array.isArray(result.data));
          report.cleanupDatasetRows[dataset] = result.data.filter(row => ownedIds.has(row.id)).length;
        }
        report.cleanupPhysicalCount = { ownRows: 0 };
        if (ownedIds.size > 0) {
          const mysqlResult = spawnSync('docker', ['inspect', 'mysql'], {
            encoding: 'utf8', timeout: 10000, maxBuffer: 4 * 1024 * 1024 });
          assert.equal(mysqlResult.status, 0);
          const mysql = JSON.parse(mysqlResult.stdout)[0];
          assert.equal(mysql.Id, fixture.extraRuntimeBefore.mysql.id);
          assert.equal(mysql.Name, '/mysql');
          assert.equal(mysql.State.Status, 'running');
          assert.equal(mysql.Mounts.find(mount => mount.Destination === '/var/lib/mysql')?.Name,
            'compose_mysql_data');
          assert.ok(ownedIds.size <= 10);
          for (const id of ownedIds) assert.match(id, /^[a-f0-9]{32}$/);
          const sql = 'START TRANSACTION READ ONLY;\nSELECT JSON_OBJECT(\'ownRows\',COUNT(*))'
            + ' FROM `plm`.`IDEA` WHERE BINARY `ID` IN ('
            + [...ownedIds].map(id => `CONVERT(0x${Buffer.from(id).toString('hex')} USING utf8mb4)`).join(',')
            + ');\nCOMMIT;\n';
          const count = spawnSync('docker', ['exec', '-i', mysql.Id, 'sh', '-c',
            'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql --protocol=TCP -h127.0.0.1 -uroot'
              + ' --default-character-set=utf8mb4 --batch --raw --skip-column-names'],
          { input: sql, encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 });
          assert.equal(count.status, 0);
          report.cleanupPhysicalCount = JSON.parse(count.stdout.trim());
        }
        report.cleanupVerified = report.cleanup.length === ownedIds.size
          && report.cleanup.every(row => row.alreadyAbsent || row.deleteStatus === 200)
          && Object.values(report.cleanupDatasetRows).every(value => value === 0)
          && report.cleanupPhysicalCount.ownRows === 0;
        report.nativeGetContractFailure = report.cleanup.some(row =>
          row.readbackStatus !== undefined && row.readbackStatus !== 404);
      } catch (error) {
        report.cleanupVerified = false;
        report.cleanupFailure = { type: error.name };
      }
    }
    report.finishedAt = new Date().toISOString();
    report.runtimeAfter = runtime();
    report.runtimeUnchanged = JSON.stringify(report.runtimeBefore) === JSON.stringify(report.runtimeAfter);
    if (!report.cleanupVerified || !report.runtimeUnchanged) report.status = 'FAILED';
    else if (report.aclStatus === 'PASS' && report.nativeGetContractFailure) {
      report.status = 'ACL_PASS_WITH_NATIVE_GET_CONTRACT_FAILURE';
    }
    writePrivate(join(destination, 'report.private.json'), bytes(report));
  }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { fixtures: { type: 'string' }, output: { type: 'string' },
    'object-admin': { type: 'string' }, 'cross-org': { type: 'string' } },
    strict: true });
  try {
    const report = await probeNativeProductRoleMatrix({ fixtures: values.fixtures, output: values.output,
      objectAdmin: values['object-admin'], crossOrg: values['cross-org'] });
    console.log(JSON.stringify({ status: report.status, checks: report.checks.length,
      aclStatus: report.aclStatus ?? 'FAILED',
      failed: report.checks.filter(check => !check.pass).map(check => check.label),
      cleanupVerified: report.cleanupVerified, runtimeUnchanged: report.runtimeUnchanged }));
    if (report.status !== 'PASS') process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ status: 'REFUSED', type: error.name, rawErrorWithheld: true }));
    process.exitCode = 1;
  }
}
