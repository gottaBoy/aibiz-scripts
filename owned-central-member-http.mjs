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

export function currentCentralReadRequest({ origin, method, pathname }, expectedOrigin) {
  if (origin !== expectedOrigin || typeof pathname !== 'string' || /[%\\?#\s]/.test(pathname)) return false;
  if (pathname.split('/').some(part => part === '.' || part === '..')) return false;
  if (['GET', 'HEAD'].includes(method) && (pathname === '/' || pathname.startsWith('/central/'))) return true;
  const prefix = '/api/ibizmodeling__central/';
  if (!pathname.startsWith(prefix)) return false;
  const suffix = pathname.slice(prefix.length);
  if (method === 'POST') {
    return suffix === 'v7/login' || suffix === 'work_items/count_my_todo' ||
      /^[a-z][a-z0-9_]*(?:\/[A-Za-z0-9_-]+)*\/fetch[a-z0-9_]+$/i.test(suffix);
  }
  if (!['GET', 'HEAD'].includes(method)) return false;
  return /^(?:remotemodel|jsonschema|dictionaries|configs)\//.test(suffix) ||
    ['appdata', 'uaa/getbydcsystem/ibizmodeling', 'uaa/oauth/userinfo'].includes(suffix) ||
    /^uaa\/refresh_token\/[a-f0-9-]{36}$/.test(suffix) ||
    /^(?:psdevcenters|psdevslns)\/[A-Za-z0-9_-]{1,100}$/.test(suffix);
}

export function validateCurrentCentralOrganization({ choices, context, headers, credential }) {
  assert.ok(Array.isArray(choices) && choices.length > 0, 'Native organization choice response must be nonempty');
  const selected = choices.filter(item => item && item.orgid === context?.srforgid &&
    item.systemid === context?.srfsystemid);
  assert.equal(selected.length, 1, 'Authenticated appdata must bind exactly one native returned organization');
  assert.equal(context.srfsystemid, 'ibizmodeling');
  assert.ok(typeof context.srfuserid === 'string' && context.srfuserid);
  assert.ok(typeof context.srfpersonid === 'string' && context.srfpersonid);
  assert.equal(headers.srforgid, selected[0].orgid, 'Normal request organization differs from native selection');
  assert.equal(headers.srfsystemid, selected[0].systemid);
  if (credential.modelingUserId) assert.equal(context.srfuserid, credential.modelingUserId);
  if (credential.personId) assert.equal(context.srfpersonid, credential.personId);
  if (context.srfloginname) assert.equal(context.srfloginname, credential.username);
  for (const field of ['srfuserid', 'srfpersonid', 'srfdcid', 'srfusername', 'x-user-id', 'x-principal']) {
    assert.equal(Object.hasOwn(headers, field), false, 'Caller supplied identity header is not allowed');
  }
  return { organizationSha256: sha(String(selected[0].orgid)),
    system: selected[0].systemid, userSha256: sha(context.srfuserid),
    personSha256: sha(context.srfpersonid), source: 'normal-ui-native-choice-and-authenticated-appdata',
    identityBinding: 'native-person-and-returned-loginname', userIdScope: 'current-modeling-application' };
}

export function currentCentralDenial(response) {
  return response?.status === 403 ? {
    stop: true, reason: 'native-403-same-session-stop-no-fallback',
    path: response.path, method: response.method,
  } : { stop: false };
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

export function createCentralMemberPhysicalSnapshot(context, workspace = workspaceDefault) {
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
    identityOrHeaderInjection: false,
    transport: transport === ownedPlatformRequest
      ? 'native-issued-session-only' : 'controlled-transport-not-live-evidence',
  };
  const capture = (purpose) => {
    context.guard();
    const value = snapshot();
    const binding = { purpose, sha256: sha(json(value)), value };
    report.snapshots.push({ purpose, sha256: binding.sha256 });
    record('snapshot', binding);
    if (purpose !== 'initial') {
      assert.deepEqual(value, baseline.value, 'Member workflow changed initial physical model state');
    }
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
    const beforeAnonymous = capture('before-anonymous');
    const anonymous = await transport(context, { peer: 'backend', method: 'POST', path: memberPath,
      data: { page: 0, size: 1000 }, applicationContext: { system: 'ibizmodeling',
        organization: actors[0].source.organization } });
    report.outcomes.push({ kind: 'anonymous', status: anonymous.status });
    const afterAnonymous = capture('after-anonymous');
    assert.deepEqual(afterAnonymous.value, beforeAnonymous.value, 'Anonymous member denial changed physical model state');
    assert.equal(anonymous.status, 401);
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
    error.evidence = report;
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
  let report;
  let failure;
  const output = resolve(values.output ?? join(workspaceDefault, '.artifacts',
    `owned-central-member-${values.label ?? values['run-id']}`));
  assert.equal(fs.existsSync(output), false, 'Member evidence output must be new');
  const context = ownedNativeRuntimeContext({
    workspace: workspaceDefault,
    runId: values['run-id'], deploymentInput: values['deployment-input'],
  });
  try {
    const io = createInternalMessageIO(context);
    const accounts = values.accounts ? readAccounts(resolve(values.accounts)) : io.sourceAccounts();
    const snapshot = createCentralMemberPhysicalSnapshot(context, workspaceDefault);
    report = await runOwnedCentralMemberHttp({ context, accounts, snapshot });
  } catch (error) {
    failure = error;
    report = error.evidence ?? {
      contract: 'owned-central-member-http-v1', runId: context.manifest.runId,
      status: 'failed-central-member-preflight', nativeAcceptance: false,
      permissionAcceptance: false, navigationAcceptance: false,
      identityOrHeaderInjection: false, errors: [String(error.message ?? error)],
    };
  } finally {
    context.close();
    fs.mkdirSync(output, { recursive: true, mode: 0o700 });
    fs.writeFileSync(join(output, 'report.private.json'), json(report), { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ status: report.status, output }, null, 2));
  }
  if (failure) throw failure;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
