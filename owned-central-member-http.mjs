#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { ownedNativeRuntimeContext } from './owned-native-runtime-context.mjs';
import { ownedPlatformRequest } from './owned-platform-http.mjs';
import { createInternalMessageIO } from './harness-owned-internal-message.mjs';
import {
  editorPhysicalInventorySQL, editorPhysicalSnapshotSQL,
  normalizeEditorPhysicalSnapshot, validateEditorPhysicalInventory,
} from './probe-owned-editor-registry-http.mjs';
import { readNativeFiveDatasetContract } from './native-five-dataset-contract.mjs';

const workspaceDefault = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const memberPath = '/api/ibizmodeling__central/psdevslns/fetchcurdcslnuser';
const sha = value => createHash('sha256').update(value).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;

async function ownedCentralTransport(context, spec) {
  const actor = spec.applicationContext
    ? context.manifest.users.find(user => `${user.centerId}_org` === spec.applicationContext.organization)
    : undefined;
  return ownedPlatformRequest(context, spec, {
    fetchImplementation: (url, init) => fetch(url, {
      ...init,
      headers: actor ? {
        ...init.headers,
        srfuserid: actor.personId,
        srfpersonid: actor.personId,
        srfdcid: actor.centerId,
      } : init.headers,
    }),
  });
}

export function validateCentralMemberRequest(spec, { centerId } = {}) {
  assert.deepEqual(Object.keys(spec).sort(), ['applicationContext', 'data', 'method', 'path', 'peer', 'token']);
  assert.equal(spec.peer, 'backend');
  assert.equal(spec.method, 'POST');
  assert.equal(spec.path, memberPath);
  assert.deepEqual(spec.data, { page: 0, size: 1000 });
  assert.equal(spec.applicationContext?.system, 'ibizmodeling');
  assert.equal(spec.applicationContext?.organization, `${centerId}_org`);
  assert.match(spec.token ?? '', /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  return true;
}

function validateRows(response, actor, expectedRoot) {
  assert.equal(response.status, 200);
  assert.equal(response.error, null);
  assert.ok(Array.isArray(response.data));
  const rows = response.data;
  for (const row of rows) {
    assert.ok(row && typeof row === 'object' && !Array.isArray(row));
    assert.equal(row.psdevcenterid, actor.centerId);
    assert.ok(typeof row.psdevslnid === 'string' && row.psdevslnid);
    if (expectedRoot) assert.equal(row.psdevslnid, expectedRoot.schemeId);
  }
  assert.equal(new Set(rows.map(row => row.psdevslnid)).size, rows.length);
  return rows;
}

function sourceActors(manifest, accounts) {
  assert.ok(Array.isArray(accounts) && accounts.length === 6);
  const byId = new Map(accounts.map(row => [row.id, row]));
  return manifest.users.toSorted((a, b) => a.personId.localeCompare(b.personId)).map(actor => {
    const source = byId.get(actor.personId);
    assert.ok(source, `Missing source account: ${actor.personId}`);
    assert.equal(source.system, 'ibizmodeling');
    assert.equal(source.tenant, actor.centerId);
    assert.equal(source.organization, `${actor.centerId}_org`);
    return { ...actor, source };
  });
}

function createReadOnlySnapshot(context, workspace = workspaceDefault) {
  const execute = statement => {
    const result = spawnSync('docker', ['exec', '-i', context.resources.mysqlId, 'sh', '-c',
      'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -h127.0.0.1 --protocol=TCP -uroot --default-character-set=utf8mb4 --batch --raw --skip-column-names'],
    { input: statement, encoding: 'utf8', timeout: 60_000, maxBuffer: 64 * 1024 * 1024 });
    assert.equal(result.status, 0, 'Read-only physical snapshot failed');
    return (result.stdout ?? '').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  };
  const contract = readNativeFiveDatasetContract({ workspace });
  const inventoryRows = execute(editorPhysicalInventorySQL(context.manifest));
  const targets = validateEditorPhysicalInventory(context.manifest, contract, inventoryRows);
  const statement = editorPhysicalSnapshotSQL(targets);
  return () => normalizeEditorPhysicalSnapshot(inventoryRows, targets, execute(statement));
}

export async function runOwnedCentralMemberHttp({
  context, accounts, transport = ownedPlatformRequest, snapshot, record = () => null,
  now = Date.now, requireNonempty = true,
} = {}) {
  assert.ok(context?.manifest && typeof context.guard === 'function');
  assert.equal(typeof snapshot, 'function', 'A complete physical snapshot reader is required');
  const actors = sourceActors(context.manifest, accounts);
  const roots = new Map(context.manifest.roots.map(root => [root.rootId, root]));
  const report = {
    contract: 'owned-central-member-http-v1', runId: context.manifest.runId,
    path: memberPath, method: 'POST', readOnly: true, nativeAcceptance: false,
    permissionAcceptance: false, navigationAcceptance: false, requests: [],
    snapshots: [], errors: [], outcomes: [], sourceClosureVerified: false,
  };
  const capture = (purpose) => {
    context.guard();
    const value = snapshot();
    const binding = { purpose, sha256: sha(json(value)), value };
    report.snapshots.push({ purpose, sha256: binding.sha256 });
    record('snapshot', binding);
    return binding;
  };
  const baseline = capture('initial');
  const request = async (actor, spec) => {
    validateCentralMemberRequest(spec, { centerId: actor.centerId });
    const before = capture(`before-${actor.personId}`);
    const response = await transport(context, spec);
    const after = capture(`after-${actor.personId}`);
    assert.deepEqual(after.value, before.value, 'Member READ changed physical model state');
    const row = {
      actor: actor.personId, role: actor.role, rootId: actor.rootId, centerId: actor.centerId,
      status: response.status, error: response.error, bytes: response.bytes,
      responseSha256: response.responseSha256 ?? sha(json(response.data ?? null)),
      rows: Array.isArray(response.data) ? response.data.length : null,
    };
    report.requests.push(row);
    return { response, row };
  };
  try {
    const expectedByActor = new Map();
    for (const actor of actors) {
      const login = await transport(context, { peer: 'backend', method: 'POST', path: '/v7/login',
        data: { loginname: actor.loginname, password: context.credentials.users[actor.loginname] } });
      assert.equal(login.status, 200);
      const token = login.data?.token;
      assert.match(token ?? '', /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
      const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
      assert.ok(claims.exp * 1000 - now() > 10_000 && claims.exp * 1000 - now() <= 21_000);
      const appdata = await transport(context, { peer: 'backend', method: 'GET', path: '/appdata',
        token, applicationContext: { system: 'ibizmodeling', organization: actor.source.organization } });
      assert.equal(appdata.status, 200);
      const appContext = appdata.data?.context;
      assert.equal(appContext?.srfpersonid, actor.source.id);
      assert.equal(appContext?.srfuserid, actor.source.id);
      assert.equal(appContext?.srfdcid, actor.source.tenant);
      assert.equal(appContext?.srforgid, actor.source.organization);
      assert.equal(appContext?.srfsystemid, 'ibizmodeling');
      const expectedRoot = roots.get(actor.rootId);
      const result = await request(actor, {
        peer: 'backend', method: 'POST', path: memberPath, token,
        applicationContext: { system: 'ibizmodeling', organization: actor.source.organization },
        data: { page: 0, size: 1000 },
      });
      const rows = validateRows(result.response, actor, actor.role === 'no-access' ? undefined : expectedRoot);
      if (actor.role === 'no-access') assert.equal(rows.length, 0);
      else if (requireNonempty) assert.ok(rows.length > 0, 'Authorized member list must be nonempty');
      expectedByActor.set(actor.personId, rows);
      result.row.outcome = actor.role === 'no-access' ? 'denied-empty' : 'authorized-nonempty';
    }
    const anonymous = await transport(context, { peer: 'backend', method: 'POST', path: memberPath,
      data: { page: 0, size: 1000 }, applicationContext: { system: 'ibizmodeling',
        organization: actors[0].source.organization } });
    assert.equal(anonymous.status, 401);
    report.outcomes.push({ kind: 'anonymous', status: anonymous.status });
    const byCenter = new Map(actors.filter(actor => actor.role !== 'no-access')
      .map(actor => [actor.centerId, expectedByActor.get(actor.personId)]));
    for (const [center, rows] of byCenter) {
      assert.ok(rows.every(row => row.psdevcenterid === center));
    }
    report.baseline = baseline.sha256;
    report.status = 'passed-central-member-read-not-accepted';
    report.completedAt = new Date(now()).toISOString();
    return report;
  } catch (error) {
    report.status = 'failed-central-member-read';
    report.errors.push(String(error.message ?? error));
    throw error;
  }
}

function readAccounts(path) {
  const value = JSON.parse(fs.readFileSync(path, 'utf8'));
  return Array.isArray(value) ? value : value.accounts;
}

export async function main(argv = process.argv.slice(2)) {
  const { values } = parseArgs({ args: argv, options: {
    'run-id': { type: 'string' }, 'deployment-input': { type: 'string' },
    accounts: { type: 'string' }, label: { type: 'string' }, output: { type: 'string' },
    help: { type: 'boolean', short: 'h' },
  } });
  if (values.help) {
    console.log('Owned read-only Central member runner requires a fresh deployment, six source accounts, and a complete physical snapshot adapter.');
    return 0;
  }
  assert.ok(values['run-id'] && values['deployment-input']);
  const context = ownedNativeRuntimeContext({
    workspace: workspaceDefault,
    runId: values['run-id'], deploymentInput: values['deployment-input'],
  });
  try {
    const io = createInternalMessageIO(context);
    const accounts = values.accounts ? readAccounts(resolve(values.accounts)) : io.sourceAccounts();
    const snapshot = createReadOnlySnapshot(context, workspaceDefault);
    const report = await runOwnedCentralMemberHttp({ context, accounts, snapshot,
      transport: ownedCentralTransport });
    const output = resolve(values.output ?? join(workspaceDefault, '.artifacts',
      `owned-central-member-${values.label ?? context.manifest.runId}`));
    fs.mkdirSync(output, { recursive: true, mode: 0o700 });
    fs.writeFileSync(join(output, 'report.private.json'), json(report), { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ status: report.status, output }, null, 2));
  } finally { context.close(); }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
