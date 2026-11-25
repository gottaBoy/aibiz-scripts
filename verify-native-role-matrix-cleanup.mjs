#!/usr/bin/env node
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { selectNativeProductOrganization } from './probe-native-product-role-matrix.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const origin = 'http://127.0.0.1:30250/api/ibizplm__plmweb';
const hash = value => createHash('sha256').update(value).digest('hex');

function readPrivate(path) {
  const fd = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const stat = fs.fstatSync(fd);
    assert.ok(stat.isFile() && stat.uid === process.geteuid() && (stat.mode & 0o077) === 0);
    return fs.readFileSync(fd);
  } finally { fs.closeSync(fd); }
}

export function exactOwnIdeaCountSQL(ids) {
  assert.ok(Array.isArray(ids) && ids.length > 0 && ids.length <= 10);
  for (const id of ids) assert.match(id, /^[a-f0-9]{32}$/);
  return 'START TRANSACTION READ ONLY;\nSELECT JSON_OBJECT(\'ownRows\',COUNT(*))'
    + ' FROM `plm`.`IDEA` WHERE BINARY `ID` IN ('
    + ids.map(id => `CONVERT(0x${Buffer.from(id).toString('hex')} USING utf8mb4)`).join(',')
    + ');\nCOMMIT;\n';
}

export async function verifyNativeRoleMatrixCleanup({ matrix, output }) {
  const source = resolve(matrix);
  const destination = resolve(output);
  assert.equal(dirname(source), join(root, '.artifacts'));
  assert.match(basename(source), /^native-product-role-matrix-[A-Za-z0-9-]+$/);
  assert.equal(dirname(destination), join(root, '.artifacts'));
  assert.match(basename(destination), /^native-role-matrix-cleanup-[A-Za-z0-9-]+$/);
  assert.ok(!fs.existsSync(destination));
  const matrixBytes = readPrivate(join(source, 'report.private.json'));
  const previous = JSON.parse(matrixBytes);
  const ids = [...new Set(previous.cleanup.map(row => row.id))];
  const sql = exactOwnIdeaCountSQL(ids);
  const fixtureBytes = readPrivate(join(root,
    '.artifacts/native-actors-run-20261124-r7/report.private.json'));
  const fixture = JSON.parse(fixtureBytes);
  assert.equal(previous.productId, fixture.product.id);
  const admin = JSON.parse(readPrivate(join(root,
    '.artifacts/current-business-actors-20261122-r1/credentials.private.json')));
  const report = { contract: 'native-role-matrix-independent-cleanup-readback-v1',
    startedAt: new Date().toISOString(), matrixReportSha256: hash(matrixBytes),
    directDatabaseWrites: 0, readOnlySqlUsed: true, idsChecked: ids.length, requests: [],
    previousGetStatuses: previous.cleanup.map(row => row.readbackStatus) };
  const login = await fetch(`${origin}/v7/login`, { method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ loginname: admin.username, password: admin.password }),
    redirect: 'error', signal: AbortSignal.timeout(15000) });
  assert.equal(login.status, 200);
  const token = (await login.json()).token;
  const headers = { accept: 'application/json', 'content-type': 'application/json',
    authorization: `Bearer ${token}` };
  const orgResponse = await fetch(`${origin}/uaa/getbydcsystem/ibizplm`, { headers,
    redirect: 'error', signal: AbortSignal.timeout(15000) });
  assert.equal(orgResponse.status, 200);
  const selected = selectNativeProductOrganization(await orgResponse.json(), fixture.bindings.organizationId);
  const appdataResponse = await fetch('http://127.0.0.1:30000/appdata/ibizplm', {
    headers, redirect: 'error', signal: AbortSignal.timeout(15000) });
  assert.equal(appdataResponse.status, 200);
  const selectedAppdata = await appdataResponse.json();
  assert.equal(selectedAppdata.context?.srforgid, selected.orgId);
  headers.srforgid = selected.orgId;
  report.datasetRows = {};
  for (const dataset of ['normal', 'archived', 'deleted']) {
    const response = await fetch(`${origin}/products/${encodeURIComponent(previous.productId)}/ideas/fetch_${dataset}`, {
      method: 'POST', headers, body: JSON.stringify({ n_title_like: `Native ACL ${basename(source)}`,
        page: 0, size: 100 }), redirect: 'error', signal: AbortSignal.timeout(15000),
    });
    const raw = Buffer.from(await response.arrayBuffer());
    report.requests.push({ dataset, status: response.status, bytes: raw.length, sha256: hash(raw) });
    if (response.status !== 200) {
      report.datasetRows[dataset] = null;
      continue;
    }
    const rows = JSON.parse(raw.toString());
    assert.ok(Array.isArray(rows));
    report.datasetRows[dataset] = rows.filter(row => ids.includes(row.id)).length;
  }
  const inspected = spawnSync('docker', ['inspect', 'mysql'], {
    encoding: 'utf8', timeout: 10000, maxBuffer: 4 * 1024 * 1024 });
  assert.equal(inspected.status, 0);
  const mysql = JSON.parse(inspected.stdout)[0];
  assert.equal(mysql.Id, fixture.extraRuntimeBefore.mysql.id);
  assert.equal(mysql.Name, '/mysql');
  assert.equal(mysql.State.Status, 'running');
  assert.equal(mysql.Mounts.find(mount => mount.Destination === '/var/lib/mysql')?.Name,
    'compose_mysql_data');
  const count = spawnSync('docker', ['exec', '-i', mysql.Id, 'sh', '-c',
    'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql --protocol=TCP -h127.0.0.1 -uroot'
      + ' --default-character-set=utf8mb4 --batch --raw --skip-column-names'],
  { input: sql, encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024 });
  assert.equal(count.status, 0);
  report.physicalCount = JSON.parse(count.stdout.trim());
  report.nativeDatasetsComplete = Object.values(report.datasetRows).every(value => value === 0);
  report.status = report.physicalCount.ownRows !== 0 ? 'FAILED'
    : report.nativeDatasetsComplete ? 'PASS_EXACT_PERSISTENCE_ABSENCE'
      : 'PASS_EXACT_PHYSICAL_ABSENCE_DATASET_READ_PARTIAL';
  report.nativeGetReturned500 = report.previousGetStatuses.includes(500);
  report.finishedAt = new Date().toISOString();
  fs.mkdirSync(destination, { mode: 0o700 });
  const fd = fs.openSync(join(destination, 'report.private.json'), fs.constants.O_WRONLY
    | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
  try { fs.writeFileSync(fd, `${JSON.stringify(report, null, 2)}\n`); fs.fsyncSync(fd); }
  finally { fs.closeSync(fd); }
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { matrix: { type: 'string' }, output: { type: 'string' } },
    strict: true });
  try {
    const report = await verifyNativeRoleMatrixCleanup(values);
    console.log(JSON.stringify({ status: report.status, datasetRows: report.datasetRows,
      physicalCount: report.physicalCount, nativeGetReturned500: report.nativeGetReturned500 }));
    if (!report.status.startsWith('PASS_EXACT_')) process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ status: 'REFUSED', type: error.name, rawErrorWithheld: true }));
    process.exitCode = 1;
  }
}
