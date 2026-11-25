#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = path.join(workspace, '.artifacts');
const api = 'http://127.0.0.1:30250/api/ibizplm__plmweb';
const collection = '/extension/app_view_themes';
const view = 'idea_all_grid_view';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const encode = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);

function read(filename) {
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    assert.ok(stat.isFile() && stat.uid === process.geteuid() && !(stat.mode & 0o077));
    return fs.readFileSync(fd);
  } finally { fs.closeSync(fd); }
}

const stable = row => Object.fromEntries(['id', 'name', 'caption', 'system_tag', 'app_tag',
  'app_view_tag', 'owner_type', 'create_man', 'theme_model', 'valid_flag', 'order_value',
  'update_man', 'update_time'].map(key => [key, row?.[key] ?? null]));

function runtimeWitness() {
  const result = spawnSync('docker', ['inspect', 'ibiz-ebsx-allinone', 'plmweb'], {
    encoding: 'utf8', timeout: 10000, maxBuffer: 4 * 1024 * 1024,
  });
  assert.equal(result.status, 0);
  const rows = JSON.parse(result.stdout);
  assert.equal(rows[0].Id, 'a1d148c646a44416cd5d8d0003ee128e83e192e83c8a95517d8fcce218f3c2f3');
  assert.equal(rows[1].Id, '70327c269425370bed8648bcaa90feadf441ff7a6c5f75b975889cf4c5416612');
  const jar = spawnSync('docker', ['exec', rows[0].Id, 'sha256sum', '/ibiz-ebsx-allinone-rt.jar'], {
    encoding: 'utf8', timeout: 10000,
  });
  assert.equal(jar.status, 0);
  const jarSha256 = jar.stdout.split(/\s/)[0];
  assert.equal(jarSha256, '1b25c2779dbe919165f275cdbd6a93b5273afdf5a4c609bab08a304fad4d6390');
  return { allinoneJarSha256: jarSha256,
    runtimes: rows.map(row => {
      assert.equal(row.State.Status, 'running');
      return { id: row.Id, image: row.Image, startedAt: row.State.StartedAt, restartCount: row.RestartCount,
        inputsSha256: hash(encode({ config: row.Config, host: row.HostConfig,
          mounts: row.Mounts.toSorted((a, b) => a.Destination.localeCompare(b.Destination)) })) };
    }),
    launcherSha256: hash(fs.readFileSync(path.join(workspace, 'scripts/allinone-entrypoint.sh'))),
    nginxSourceSha256: hash(fs.readFileSync(path.join(workspace, 'plm-web/nginx-local.conf'))) };
}

export async function probe(output) {
  assert.equal(path.dirname(output), artifacts);
  assert.match(path.basename(output), /^view-theme-role-access-[a-z0-9-]+$/);
  fs.mkdirSync(output, { mode: 0o700 });
  const write = (name, value) => fs.writeFileSync(path.join(output, name), encode(value), { mode: 0o600, flag: 'wx' });
  const fixture = JSON.parse(read(path.join(artifacts, 'native-actors-run-20261124-r7/report.private.json')));
  const paths = {
    admin: 'current-business-actors-20261122-r1/credentials.private.json',
    ordinary: 'native-actors-run-20261124-r7/ordinary.credentials.private.json',
    readonly: 'native-actors-run-20261124-r7/readonly.credentials.private.json',
    nonmember: 'native-actors-run-20261124-r7/nonmember.credentials.private.json',
    objectadmin: 'native-product-admin-20261124-r1/objectadmin.credentials.private.json',
    crossorg: 'native-crossorg-20261124-r1/crossorg.credentials.private.json',
  };
  const marker = `VT-ACL-${randomUUID()}`;
  const report = { contract: 'native-view-theme-real-role-matrix-v1', status: 'FAILED', marker,
    startedAt: new Date().toISOString(), runtimeBefore: runtimeWitness(),
    sourceSha256: hash(fs.readFileSync(fileURLToPath(import.meta.url))), checks: [], requests: [],
    credentialsPersisted: false, syntheticIdentityHeaders: false, directDatabaseWrites: 0,
    owned: [], cleanup: [], baselineSharedRows: [] };
  const actors = {};
  const owned = new Map();
  let unrelatedBefore;
  const check = (label, pass, detail = {}) => report.checks.push({ label, pass, ...detail });
  const call = async (key, relative, method = 'GET', body) => {
    const actor = actors[key];
    if (['POST', 'PUT', 'DELETE'].includes(method) && !relative.includes('/fetch_')) {
      write(`intent-${report.requests.length}.private.json`, { key, relative, method,
        bodySha256: body === undefined ? null : hash(encode(body)), recordedBeforeDispatch: true });
    }
    const response = await fetch(`${api}${relative}`, { method,
      headers: { Authorization: `Bearer ${actor.token}`, srforgid: actor.orgid,
        'Content-Type': 'application/json', Accept: 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(8000) });
    const bytes = Buffer.from(await response.arrayBuffer());
    let data = null;
    try { data = bytes.length ? JSON.parse(bytes) : null; } catch {}
    report.requests.push({ actor: key, path: relative, method, status: response.status,
      bytes: bytes.length, sha256: hash(bytes) });
    if (response.status >= 400) {
      fs.writeFileSync(path.join(output, `error-response-${report.requests.length}.private.json`),
        bytes, { mode: 0o600, flag: 'wx' });
    }
    return { status: response.status, data };
  };
  const directory = async key => {
    const result = await call(key, `${collection}/fetch_cur_user_all`, 'POST',
      { searchconds: [{ condop: 'EQ', condtype: 'DEFIELD', fieldname: 'app_view_tag', value: view }],
        sort: 'create_time,asc' });
    assert.equal(result.status, 200);
    assert.ok(Array.isArray(result.data));
    return result.data;
  };
  const discoverOwned = async () => {
    const rows = await directory('admin');
    for (const row of rows.filter(row => row.caption?.startsWith(marker))) {
      assert.equal(row.app_view_tag, view);
      assert.ok(row.name?.startsWith(`${view}___${marker}`));
      owned.set(row.id, { id: row.id, name: row.name, creator: row.create_man });
    }
    return rows;
  };
  const create = async (key, label, extra = {}) => {
    const body = { name: `${view}___${marker}-${label}`, caption: `${marker} ${label} 中文🙂 e\u0301`,
      app_tag: 'plmweb', app_view_tag: view, ...extra };
    const result = await call(key, collection, 'POST', body);
    await discoverOwned();
    if (result.status === 200 && result.data?.id) {
      const actual = await call('admin', `${collection}/${result.data.id}`);
      assert.equal(actual.status, 200);
      assert.equal(actual.data.name, body.name);
      assert.equal(actual.data.caption, body.caption);
      owned.set(actual.data.id, { id: actual.data.id, name: body.name, creator: actual.data.create_man });
      return { ...result, data: actual.data };
    }
    return result;
  };
  try {
    for (const [key, relative] of Object.entries(paths)) {
      const credentials = JSON.parse(read(path.join(artifacts, relative)));
      const login = await fetch('http://127.0.0.1:30000/v7/login', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ loginname: credentials.username, password: credentials.password }),
        signal: AbortSignal.timeout(8000),
      });
      const authentication = await login.json();
      assert.equal(login.status, 200);
      assert.ok(authentication.token);
      const choice = await fetch('http://127.0.0.1:30000/uaa/getbydcsystem/ibizplm', {
        headers: { Authorization: `Bearer ${authentication.token}` }, signal: AbortSignal.timeout(8000),
      });
      assert.equal(choice.status, 200);
      const expectedOrg = credentials.organizationId ?? fixture.bindings.organizationId;
      const choices = (await choice.json()).filter(row => row.orgid === expectedOrg && row.systemid === 'ibizplm');
      assert.equal(choices.length, 1);
      const context = await fetch('http://127.0.0.1:30000/appdata/ibizplm', {
        headers: { Authorization: `Bearer ${authentication.token}`, srfsystemid: choices[0].systemid,
          srforgid: choices[0].orgid }, signal: AbortSignal.timeout(8000),
      });
      assert.equal(context.status, 200);
      const appdata = await context.json();
      assert.equal(appdata.context.srforgid, choices[0].orgid);
      assert.ok(appdata.context.srfuserid && appdata.context.srfdcsystemid);
      actors[key] = { token: authentication.token, orgid: choices[0].orgid,
        userid: appdata.context.srfuserid, system: appdata.context.srfdcsystemid };
    }
    const initial = await directory('admin');
    unrelatedBefore = initial.map(stable);
    const shared = initial.filter(row => row.owner_type === 'SYSTEM');
    assert.equal(shared.length, 4, 'Bind the actual four shared model configurations');
    report.baselineSharedRows = shared.map(row => ({ id: row.id, captionSha256: hash(row.caption) }));
    for (const key of Object.keys(actors)) {
      const rows = await directory(key);
      check(`shared-directory-${key}`, shared.every(row => rows.some(item => item.id === row.id)),
        { expectedSystemRows: shared.length, actualSystemRows: rows.filter(row => row.owner_type === 'SYSTEM').length });
      const existing = await call(key, `${collection}/${shared[0].id}`);
      check(`shared-get-${key}`, existing.status === 200 && existing.data?.id === shared[0].id,
        { status: existing.status });
    }
    const personal = {};
    for (const key of ['ordinary', 'readonly']) {
      const created = await create(key, `${key}-personal`);
      check(`personal-create-${key}`, created.status === 200 && created.data?.owner_type === 'PERSONAL'
        && created.data?.create_man === actors[key].userid && created.data?.system_tag === actors[key].system,
      { status: created.status });
      assert.equal(created.status, 200);
      personal[key] = created.data;
      const savedCaption = `${marker} ${key} saved via native route 中文🙂`;
      const saved = await call(key, `${collection}/${created.data.id}/save`, 'POST',
        { id: created.data.id, name: created.data.name, caption: savedCaption,
          app_tag: 'plmweb', app_view_tag: view });
      const readback = await call('admin', `${collection}/${created.data.id}`);
      check(`personal-save-${key}`, saved.status === 200 && readback.status === 200
        && readback.data.caption === savedCaption
        && readback.data.create_man === actors[key].userid, { status: saved.status });
      personal[key] = readback.data;
    }
    const system = await create('admin', 'system', { owner_type: 'SYSTEM' });
    check('administrator-system-create', system.status === 200 && system.data?.owner_type === 'SYSTEM');
    assert.equal(system.status, 200);
    const privateGate = await call('ordinary', `${collection}/${personal.readonly.id}`);
    check('private-read-policy-active', privateGate.status === 403, { status: privateGate.status });
    assert.equal(privateGate.status, 403, 'Verify the scoped runtime before adversarial mutation cases');
    const writeGate = await call('ordinary', `${collection}/${system.data.id}`, 'PUT',
      { caption: system.data.caption });
    check('system-write-policy-active', writeGate.status === 403, { status: writeGate.status });
    assert.equal(writeGate.status, 403, 'Verify the system write guard before forged scope cases');
    for (const key of ['ordinary', 'readonly', 'nonmember', 'objectadmin', 'crossorg']) {
      const privateRecord = personal[key === 'ordinary' ? 'readonly' : 'ordinary'];
      const rows = await directory(key);
      check(`foreign-personal-hidden-${key}`, !rows.some(row => row.id === privateRecord.id));
      for (const method of ['GET', 'PUT', 'DELETE']) {
        const result = await call(key, `${collection}/${privateRecord.id}`, method,
          method === 'PUT' ? { caption: `${marker} rejected foreign change` } : undefined);
        const independent = await call('admin', `${collection}/${privateRecord.id}`);
        check(`foreign-personal-${method}-${key}`, result.status === 403
          && independent.status === 200 && JSON.stringify(stable(independent.data)) === JSON.stringify(stable(privateRecord)),
        { status: result.status, originalFieldsUnchanged:
          JSON.stringify(stable(independent.data)) === JSON.stringify(stable(privateRecord)) });
      }
      for (const method of ['PUT', 'DELETE']) {
        const result = await call(key, `${collection}/${system.data.id}`, method,
          method === 'PUT' ? { caption: `${marker} rejected system change` } : undefined);
        const independent = await call('admin', `${collection}/${system.data.id}`);
        check(`system-${method}-${key}`, result.status === 403
          && independent.status === 200 && JSON.stringify(stable(independent.data)) === JSON.stringify(stable(system.data)),
        { status: result.status });
      }
      const rejected = await create(key, `${key}-rejected-system`, { owner_type: 'SYSTEM' });
      check(`system-create-denied-${key}`, rejected.status === 403, { status: rejected.status });
      const foreignScope = await create(key, `${key}-rejected-scope`, { system_tag: 'owned-foreign-system' });
      check(`system-spoof-denied-${key}`, foreignScope.status === 403, { status: foreignScope.status });
      const saved = await call(key, `${collection}/${privateRecord.id}/save`, 'POST',
        { id: privateRecord.id, name: privateRecord.name, caption: `${marker} rejected Save`,
          app_tag: 'plmweb', app_view_tag: view });
      const independent = await call('admin', `${collection}/${privateRecord.id}`);
      check(`foreign-personal-save-${key}`, saved.status === 403 && independent.status === 200
        && JSON.stringify(stable(independent.data)) === JSON.stringify(stable(privateRecord)),
      { status: saved.status });
    }
    const ordinary = personal.ordinary;
    const promoted = await call('admin', `${collection}/${ordinary.id}`, 'PUT', { owner_type: 'SYSTEM' });
    assert.equal(promoted.status, 200);
    const afterPromotion = await call('admin', `${collection}/${ordinary.id}`);
    assert.equal(afterPromotion.data.owner_type, 'SYSTEM');
    const revoked = await call('ordinary', `${collection}/${ordinary.id}`, 'PUT',
      { caption: `${marker} old token must not edit promoted system config` });
    const afterRefusal = await call('admin', `${collection}/${ordinary.id}`);
    check('same-token-write-revoked-after-promotion', revoked.status === 403
      && JSON.stringify(stable(afterRefusal.data)) === JSON.stringify(stable(afterPromotion.data)),
    { status: revoked.status, originalTokenReused: true });
    const restored = await call('admin', `${collection}/${ordinary.id}`, 'PUT', { owner_type: 'PERSONAL' });
    assert.equal(restored.status, 200);
    const ownSave = await call('ordinary', `${collection}/${ordinary.id}`, 'PUT',
      { caption: `${marker} ordinary personal restored 中文🙂` });
    const ownReadback = await call('ordinary', `${collection}/${ordinary.id}`);
    check('same-token-personal-write-restored', ownSave.status === 200 && ownReadback.status === 200
      && ownReadback.data.caption === `${marker} ordinary personal restored 中文🙂`,
    { status: ownSave.status });
    report.status = report.checks.every(item => item.pass) ? 'PASS' : 'FAILED';
  } catch (error) {
    report.error = error.message;
  } finally {
    if (actors.admin) {
      try {
        await discoverOwned();
        report.owned = [...owned.values()];
        for (const row of owned.values()) {
          const current = await call('admin', `${collection}/${row.id}`);
          if (current.status === 404) continue;
          assert.equal(current.status, 200);
          assert.equal(current.data.name, row.name);
          assert.ok(current.data.caption.startsWith(marker));
          write(`cleanup-intent-${report.cleanup.length}.private.json`, { id: row.id, name: row.name });
          const removed = await call('admin', `${collection}/${row.id}`, 'DELETE');
          const missing = await call('admin', `${collection}/${row.id}`);
          report.cleanup.push({ id: row.id, deleteStatus: removed.status, absenceStatus: missing.status });
          assert.equal(removed.status, 200); assert.equal(missing.status, 404);
        }
        const after = await directory('admin');
        assert.equal(after.filter(row => row.caption?.startsWith(marker)).length, 0);
        if (unrelatedBefore) {
          for (const original of unrelatedBefore) {
            assert.deepEqual(stable(after.find(row => row.id === original.id)), original);
          }
        }
        report.cleanupVerified = true;
      } catch (error) { report.cleanupError = error.message; report.status = 'FAILED'; }
    }
    try {
      report.runtimeAfter = runtimeWitness();
      assert.deepEqual(report.runtimeAfter, report.runtimeBefore);
      report.runtimeUnchanged = true;
    } catch (error) { report.runtimeFailure = error.message; report.status = 'FAILED'; }
    report.finishedAt = new Date().toISOString();
    write('report.private.json', report);
  }
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ strict: true, options: { output: { type: 'string' } } });
  probe(values.output).then(report => {
    console.log(JSON.stringify({ status: report.status, checks: report.checks.length,
      failed: report.checks.filter(item => !item.pass).map(item => item.label),
      cleanupVerified: report.cleanupVerified, failureRecorded: Boolean(report.error) }));
    if (report.status !== 'PASS') process.exitCode = 1;
  }).catch(error => { console.error(JSON.stringify({ status: 'REFUSED', type: error.name,
    rawErrorWithheld: true })); process.exitCode = 1; });
}
