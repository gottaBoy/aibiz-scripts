#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const artifacts = path.join(workspace, '.artifacts');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const encode = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const api = 'http://127.0.0.1:30250/api/ibizplm__plmweb';

function privateRead(filename) {
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    assert.ok(stat.isFile() && stat.uid === process.geteuid() && !(stat.mode & 0o077));
    return fs.readFileSync(fd);
  } finally { fs.closeSync(fd); }
}

export async function clean(output) {
  assert.equal(path.dirname(output), artifacts);
  assert.match(path.basename(output), /^native-role-association-cleanup-[a-z0-9-]+$/);
  fs.mkdirSync(output, { mode: 0o700 });
  const write = (name, value) => fs.writeFileSync(path.join(output, name), encode(value), { mode: 0o600, flag: 'wx' });
  const fixture = JSON.parse(privateRead(path.join(artifacts, 'native-actors-run-20261124-r7/report.private.json')));
  assert.equal(fixture.product.createdByThisRun, true);
  const inspected = spawnSync('docker', ['inspect', 'mysql'], { encoding: 'utf8', timeout: 10000,
    maxBuffer: 4 * 1024 * 1024 });
  assert.equal(inspected.status, 0);
  const mysql = JSON.parse(inspected.stdout)[0];
  assert.equal(mysql.Id, fixture.extraRuntimeBefore.mysql.id);
  assert.equal(mysql.State.Status, 'running');
  assert.equal(mysql.Mounts.find(mount => mount.Destination === '/var/lib/mysql')?.Name, 'compose_mysql_data');
  const productId = fixture.product.id;
  const owners = new Set();
  const sourceReceipts = [];
  for (const revision of [2, 3, 4, 5, 6, 7, 8, 9]) {
    const filename = path.join(artifacts, `native-product-role-matrix-20261124-r${revision}/report.private.json`);
    const bytes = privateRead(filename);
    const report = JSON.parse(bytes);
    assert.equal(report.contract, 'native-product-role-new-session-matrix-v1');
    assert.equal(report.productId, productId);
    let supplemental;
    if (report.cleanupVerified !== true) {
      assert.equal(revision, 2, 'An incomplete cleanup needs its exact independent absence receipt');
      const supplementalPath = path.join(artifacts, 'native-role-matrix-cleanup-20261124-r2/report.private.json');
      const supplementalBytes = privateRead(supplementalPath);
      const absence = JSON.parse(supplementalBytes);
      assert.equal(absence.status, 'PASS_EXACT_PERSISTENCE_ABSENCE');
      assert.equal(absence.matrixReportSha256, hash(bytes));
      assert.equal(absence.physicalCount.ownRows, 0);
      assert.deepEqual(absence.datasetRows, { normal: 0, archived: 0, deleted: 0 });
      supplemental = { path: supplementalPath, sha256: hash(supplementalBytes) };
    }
    for (const item of [...report.createdIdeas, ...report.cleanup]) {
      assert.match(item.id, /^[a-f0-9]{32}$/);
      owners.add(item.id);
    }
    sourceReceipts.push({ path: filename, sha256: hash(bytes), status: report.status,
      originalCleanupVerified: report.cleanupVerified, ...(supplemental ? { supplemental } : {}) });
  }
  assert.ok(owners.size > 0 && owners.size <= 20);
  const literal = value => `CONVERT(0x${Buffer.from(value).toString('hex')} USING utf8mb4)`;
  const ownerList = [...owners].map(literal).join(',');
  const product = literal(productId);
  const query = `SELECT JSON_OBJECT(
    'ideas',(SELECT COUNT(*) FROM plm.IDEA WHERE ID IN (${ownerList}) AND PRODUCT_ID=${product}),
    'versions',COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('id',ID,'owner_id',OWNER_ID,'owner_type',OWNER_TYPE))
      FROM plm.VERSION WHERE OWNER_ID IN (${ownerList})),JSON_ARRAY()),
    'recents',COALESCE((SELECT JSON_ARRAYAGG(JSON_OBJECT('id',ID,'owner_id',OWNER_ID,'owner_type',OWNER_SUBTYPE))
      FROM plm.RECENT WHERE OWNER_ID IN (${ownerList}) AND RECENT_PARENT=${product}),JSON_ARRAY()));`;
  const snapshot = () => {
    const result = spawnSync('docker', ['exec', '-i', 'mysql', 'sh', '-c',
      'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql --protocol=TCP -h127.0.0.1 -uroot'
        + ' --default-character-set=utf8mb4 --batch --raw --skip-column-names'],
    { input: query, encoding: 'utf8', timeout: 15000, maxBuffer: 2 * 1024 * 1024 });
    assert.equal(result.status, 0, 'The exact owned association snapshot failed');
    return JSON.parse(result.stdout.trim());
  };
  const report = { contract: 'native-role-matrix-association-cleanup-v1', status: 'FAILED',
    sourceReceipts, sourceSha256: hash(fs.readFileSync(fileURLToPath(import.meta.url))),
    preservedActors: 5, preservedProduct: true, sequenceWrite: false, directDatabaseWrites: 0,
    readOnlySqlUsed: true, deleted: [], requests: [] };
  try {
    report.before = snapshot();
    assert.equal(report.before.ideas, 0, 'Delete only associations of independently absent test ideas');
    assert.ok(report.before.versions.length + report.before.recents.length <= 100);
    const credentials = JSON.parse(privateRead(path.join(artifacts,
      'current-business-actors-20261122-r1/credentials.private.json')));
    const login = await fetch('http://127.0.0.1:30000/v7/login', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ loginname: credentials.username, password: credentials.password }),
      signal: AbortSignal.timeout(8000),
    });
    const authentication = await login.json();
    assert.equal(login.status, 200);
    assert.ok(authentication.token);
    const selectable = await fetch('http://127.0.0.1:30000/uaa/getbydcsystem/ibizplm', {
      headers: { Authorization: `Bearer ${authentication.token}` }, signal: AbortSignal.timeout(8000),
    });
    assert.equal(selectable.status, 200);
    const organizations = await selectable.json();
    const selected = organizations.filter(item => item.systemid === 'ibizplm'
      && item.dcsystemid === 'ibizplm' && item.orgid === fixture.bindings.organizationId);
    assert.equal(selected.length, 1);
    const headers = { Authorization: `Bearer ${authentication.token}`,
      srforgid: selected[0].orgid, srfsystemid: selected[0].systemid, Accept: 'application/json' };
    const appdata = await fetch('http://127.0.0.1:30000/appdata/ibizplm', {
      headers, signal: AbortSignal.timeout(8000),
    });
    assert.equal(appdata.status, 200);
    const identity = (await appdata.json()).context;
    assert.equal(identity.srforgid, selected[0].orgid);
    const request = async (relative, method = 'GET') => {
      const response = await fetch(`${api}${relative}`, { method, headers, signal: AbortSignal.timeout(8000) });
      const bytes = Buffer.from(await response.arrayBuffer());
      report.requests.push({ path: relative, method, status: response.status, bytes: bytes.length, sha256: hash(bytes) });
      let data;
      try { data = bytes.length ? JSON.parse(bytes) : null; } catch {}
      return { status: response.status, data };
    };
    write('prepared.private.json', { ...report, eligibleOwners: [...owners] });
    for (const kind of ['versions', 'recents']) for (const row of report.before[kind]) {
      assert.match(row.id, /^[A-Za-z0-9_-]{1,100}$/);
      assert.ok(owners.has(row.owner_id));
      assert.equal(String(row.owner_type).toUpperCase(), 'IDEA');
      const relative = `/${kind}/${row.id}`;
      const current = await request(relative);
      assert.equal(current.status, 200);
      assert.equal(current.data.id, row.id);
      assert.equal(current.data.owner_id, row.owner_id);
      if (kind === 'recents') assert.equal(current.data.recent_parent, productId);
      write(`intent-${report.deleted.length}.private.json`, { kind, id: row.id, ownerId: row.owner_id,
        independentNativeReadbackVerified: true });
      const deleted = await request(relative, 'DELETE');
      assert.equal(deleted.status, 200);
      const absent = await request(relative);
      assert.equal(absent.status, 404, 'A native absence response is required after deletion');
      report.deleted.push({ kind, id: row.id, ownerId: row.owner_id, deleteStatus: deleted.status,
        absenceStatus: absent.status });
    }
    report.after = snapshot();
    assert.equal(report.after.ideas, 0);
    assert.equal(report.after.versions.length, 0);
    assert.equal(report.after.recents.length, 0);
    report.status = 'PASS-EXACT-NATIVE-ASSOCIATION-CLEANUP';
    return report;
  } finally { write('report.private.json', report); }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ strict: true, options: { output: { type: 'string' } } });
  clean(values.output).then(report => console.log(JSON.stringify({ status: report.status,
    deleted: report.deleted.length, actorsPreserved: report.preservedActors })))
    .catch(error => { console.error(error.message); process.exitCode = 1; });
}
