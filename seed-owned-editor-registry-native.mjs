#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { PinnedDirectories, readPinnedFile } from './native-candidate-files.mjs';
import { readNativeFiveDatasetContract } from './native-five-dataset-contract.mjs';
import { ownedNativeRuntimeContext } from './owned-native-runtime-context.mjs';
import {
  createInternalMessageIO, verifyInternalMessageAccounts, verifyInternalMessageAppData,
} from './harness-owned-internal-message.mjs';
import {
  editorPhysicalInventorySQL, editorPhysicalSnapshotSQL, normalizeEditorPhysicalSnapshot,
  validateEditorPhysicalInventory, verifyEditorBackendToken, verifyEditorCreateEvidence,
  expectedNativeEditorSystemName,
} from './probe-owned-editor-registry-http.mjs';

const workspaceDefault = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const hash = value => createHash('sha256').update(value).digest('hex');
const jwt = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const runtimeSources = [
  'libs/ibiz-modeling-core/src/main/java/net/ibizsys/modeling/core/util/PSModels.java',
  'libs/ibiz-modeling-core/src/main/java/net/ibizsys/modeling/core/security/SystemAccessManagerBase.java',
  'libs/ibiz-modeling-core/src/main/java/net/ibizsys/modeling/core/dataentity/security/PSModelDEAccessManager.java',
  'libs/ibiz-modeling-core/src/main/java/net/ibizsys/modeling/core/dataentity/DataEntityRuntimeBase.java',
  'libs/ibiz-runtime/src/main/java/net/ibizsys/runtime/dataentity/DataEntityRuntimeBase.java',
];
const decode = row => Object.fromEntries(Object.entries(row).map(([field, value]) =>
  [field.toLowerCase(), value === null ? null : Buffer.from(value, 'hex').toString('utf8')]));
const tableOf = (snapshot, database, table) => {
  const rows = snapshot.tables.filter(row => row.database === database && row.table.toLowerCase() === table);
  assert.equal(rows.length, 1, 'Require one unambiguous actual physical table');
  return rows[0];
};
const sameExcept = (before, after, fields) => {
  assert.deepEqual(Object.keys(after).sort(), Object.keys(before).sort());
  for (const field of Object.keys(before)) {
    if (!fields.includes(field.toLowerCase())) assert.equal(after[field], before[field],
      `Unreviewed physical field change: ${field}`);
  }
};

export function validateEditorNativeSeedRequest(manifest, contract, spec) {
  assert.ok(spec && Object.keys(spec).every(key => [
    'path', 'method', 'data', 'actorId', 'token', 'applicationContext',
    'sessionStartedAt', 'sessionExpiresAt',
  ].includes(key)), 'Only reviewed native seed request fields');
  const login = spec.path === '/v7/login';
  const identity = ['/appdata', '/uaa/oauth/userinfo'].includes(spec.path);
  const config = contract.applicationConfig.find(row => row.readPath === spec.path);
  const root = manifest.roots.find(root => contract.datasets.some(row =>
    row.collectionPath.replace('$ROOT_ID', root.rootId) === spec.path));
  assert.ok(login || identity || config || root, 'Only ordinary identity/config and exact own-root native Create routes');
  assert.equal(spec.method ?? 'GET', login || config || root ? 'POST' : 'GET');
  if (root) {
    const actor = manifest.users.find(user => user.personId === spec.actorId);
    const dataset = contract.datasets.find(row => row.collectionPath.replace('$ROOT_ID', root.rootId) === spec.path);
    assert.ok(actor && actor.role === 'editor' && actor.rootId === root.rootId,
      'Only an actual own-root ordinary editor may create');
    assert.equal(spec.data?.pssystemid, root.logicalSystemId);
    // The native runtime rewrites model-instance DTO system names from the
    // authenticated PSDevSlnSys context. The physical T_SRFPSSYSTEM row keeps
    // its source-backed display name; newly created model rows use the owned
    // developer-root name returned by that context.
    assert.equal(spec.data.pssystemname, root.rootId);
    const fields = Object.keys(dataset.nativeCreatePayloadTemplate).filter(field => field !== dataset.keyField);
    assert.deepEqual(Object.keys(spec.data).sort(), fields.sort(), 'No unreviewed native mutation fields');
    assert.ok(spec.data[dataset.nameField].includes(manifest.runId));
    assert.match(spec.data.usertag, new RegExp(`^nf_${manifest.runId}_${root.side}_[a-f0-9]{12}$`));
    if (dataset.entity === 'PSSysDBScheme') assert.equal(spec.data.dslink, 'DEFAULT');
    if (dataset.entity === 'PSSysSFPub') assert.equal(spec.data.ppssyssfpubid, null);
    if (['PSSysServiceAPI', 'PSSubSysServiceAPI'].includes(dataset.entity)) {
      assert.match(spec.data.codename, /^[A-Za-z][A-Za-z0-9_]*$/);
      assert.ok(spec.data.codename.length <= (dataset.entity === 'PSSysServiceAPI' ? 40 : 60));
      assert.equal(spec.data.apitype, 'RESTFUL');
      assert.equal(spec.data.validflag, 1);
      if (dataset.entity === 'PSSysServiceAPI') assert.equal(spec.data.ver, 1);
      else assert.equal(spec.data.apisource, 'NONE');
    }
  }
  if (config) assert.deepEqual(spec.data, config.body);
  if (login) {
    const user = manifest.users.find(user => user.personId === spec.actorId);
    assert.ok(user?.role === 'editor');
    assert.equal(spec.data?.loginname, user.loginname);
    assert.deepEqual(Object.keys(spec.data).sort(), ['loginname', 'password']);
  } else {
    assert.match(spec.token ?? '', jwt);
    assert.deepEqual(Object.keys(spec.applicationContext ?? {}).sort(), ['organization', 'system']);
    assert.equal(spec.applicationContext.system, 'ibizmodeling');
  }
  return { login, identity, config, root };
}

export function createOwnedEditorNativeSeedIO(context, contract, {
  execute = spawnSync, fetchImplementation = fetch, now = Date.now,
} = {}) {
  const identity = createInternalMessageIO(context, { execute });
  let accounts;
  let inventory;
  let targets;
  const sql = statement => {
    context.guard();
    const result = execute('docker', ['exec', '-i', context.resources.mysqlId, 'sh', '-c',
      'MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -h127.0.0.1 --protocol=TCP -uroot --default-character-set=utf8mb4 --batch --raw --skip-column-names'],
    { input: statement, encoding: 'utf8', timeout: 60_000, maxBuffer: 64 * 1024 * 1024 });
    assert.ok(result.status === 0 && !result.error && !result.signal,
      'Owned read-only editor SQL failed; raw output suppressed');
    return result.stdout.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
  };
  return {
    accounts() {
      const rows = identity.sourceAccounts();
      accounts = verifyInternalMessageAccounts(context.manifest, rows);
      return rows;
    },
    snapshot() {
      const current = sql(editorPhysicalInventorySQL(context.manifest));
      if (inventory) assert.deepEqual(current, inventory, 'Any physical inventory drift invalidates native seeding');
      else {
        targets = validateEditorPhysicalInventory(context.manifest, contract, current);
        inventory = current;
      }
      return normalizeEditorPhysicalSnapshot(inventory, targets, sql(editorPhysicalSnapshotSQL(targets)));
    },
    async request(spec) {
      const route = validateEditorNativeSeedRequest(context.manifest, contract, spec);
      assert.ok(accounts, 'Real source identity must be verified before HTTP');
      const actor = accounts.find(user => user.personId === spec.actorId);
      assert.ok(actor?.role === 'editor');
      if (route.login) assert.equal(spec.data.password, context.credentials.users[actor.loginname]);
      else assert.deepEqual(spec.applicationContext,
        { system: actor.source.system, organization: actor.source.organization });
      const body = spec.data === undefined ? undefined : JSON.stringify(spec.data);
      assert.ok(body === undefined || Buffer.byteLength(body) < 64 * 1024);
      const live = context.guard();
      if (!route.login) {
        const age = now() - spec.sessionStartedAt;
        assert.ok(Number.isFinite(age) && age >= 0 && age < 10_000,
          'Refuse an aged or future-dated editor session before dispatch');
        assert.ok(spec.sessionExpiresAt - now() > 5_000, 'Refuse an expiring editor token');
        verifyEditorBackendToken(spec.token, now());
      }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15_000);
      const result = { status: null, error: null, data: null, bytes: 0, dispatched: false };
      try {
        result.dispatched = true;
        const response = await fetchImplementation(live.origins.backend + spec.path, {
          method: spec.method ?? 'GET', redirect: 'manual', signal: controller.signal,
          headers: { accept: 'application/json', 'content-type': 'application/json',
            ...(spec.token ? { authorization: `Bearer ${spec.token}` } : {}),
            ...(spec.applicationContext ? { srfsystemid: spec.applicationContext.system,
              srforgid: spec.applicationContext.organization } : {}) },
          ...(body === undefined ? {} : { body }),
        });
        result.status = response.status;
        if (response.status >= 300 && response.status < 400) {
          await response.body?.cancel();
          return { ...result, error: 'redirect-refused' };
        }
        const chunks = [];
        const reader = response.body?.getReader();
        if (reader) for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          result.bytes += value.length;
          if (result.bytes > 2 * 1024 * 1024) {
            controller.abort();
            await reader.cancel();
            return { ...result, error: 'response-too-large' };
          }
          chunks.push(value);
        }
        const bytes = Buffer.concat(chunks);
        result.responseSha256 = hash(bytes);
        if (bytes.length) {
          assert.match(response.headers.get('content-type') ?? '',
            /^application\/(?:json|[a-z0-9.+-]+\+json)(?:;|$)/i);
          result.data = JSON.parse(bytes.toString('utf8'));
        }
        return result;
      } catch {
        return { ...result, error: controller.signal.aborted ? 'timeout' : 'transport-or-json-error' };
      } finally { clearTimeout(timer); }
    },
  };
}

export function chooseNativeEditorAppConfig(rows, actor) {
  assert.deepEqual(Object.keys(rows).sort(), ['PSAppType', 'PSPF', 'PSPFStyle']);
  assert.ok(Object.values(rows).every(Array.isArray));
  for (const [entity, key] of [['PSPF', 'pspfid'], ['PSPFStyle', 'pspfstyleid'], ['PSAppType', 'psapptypeid']]) {
    assert.equal(new Set(rows[entity].map(row => row[key])).size, rows[entity].length, 'Ambiguous native config IDs');
  }
  const choices = [];
  for (const platform of rows.PSPF) {
    if (platform.validflag !== 1 || typeof platform.pspfid !== 'string' || !platform.pspfid
      || typeof platform.psapptypeid !== 'string' || !platform.psapptypeid) continue;
    const type = rows.PSAppType.find(type => type.psapptypeid === platform.psapptypeid);
    if (typeof type?.psapptypename !== 'string' || !type.psapptypename.trim()) continue;
    for (const style of rows.PSPFStyle) {
      if (style.pspfid !== platform.pspfid || typeof style.pspfstyleid !== 'string' || !style.pspfstyleid
        || typeof style.pspfstylename !== 'string' || !style.pspfstylename.trim()) continue;
      if (style.psdevcenterid != null && style.psdevcenterid !== actor.centerId) continue;
      choices.push({ pspfid: platform.pspfid, pspfstyleid: style.pspfstyleid,
        psapptypeid: type.psapptypeid, psapptypename: type.psapptypename });
    }
  }
  choices.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
  return choices[0] ?? null;
}

export function editorNativeSeedPayload(manifest, root, dataset, nonce, appConfig) {
  assert.match(nonce, /^[a-f0-9]{12}$/);
  assert.ok(manifest.roots.some(value => value.rootId === root.rootId && value.database === root.database));
  const name = `Owned ${manifest.runId} ${root.side} ${dataset.entity} ${nonce}`;
  const code = `Owned${root.side}${nonce}`;
  const payload = {
    [dataset.nameField]: name, pssystemid: root.logicalSystemId,
    pssystemname: root.rootId, usertag: `nf_${manifest.runId}_${root.side}_${nonce}`,
  };
  if (dataset.entity === 'PSSysDBScheme') payload.dslink = 'DEFAULT';
  else if (dataset.entity === 'PSSysSFPub') payload.ppssyssfpubid = null;
  else if (dataset.entity === 'PSSysApp') {
    assert.ok(appConfig, 'No fabricated platform/style/type IDs are permitted');
    Object.assign(payload, { apppkgname: code }, appConfig);
  } else {
    Object.assign(payload, { codename: code, apitype: 'RESTFUL', validflag: 1 });
    if (dataset.entity === 'PSSysServiceAPI') payload.ver = 1;
    else { assert.equal(dataset.entity, 'PSSubSysServiceAPI'); payload.apisource = 'NONE'; }
  }
  // Native Create owns key generation. The intent is journalled by unique name
  // and marker before dispatch; the actual returned key is then bound to SQL.
  assert.equal(Object.hasOwn(payload, dataset.keyField), false);
  return payload;
}

export function verifyEditorNativeSeedInitial(manifest, contract, snapshot) {
  assert.equal(snapshot.encoding, 'every-physical-column-null-or-hex-cast-binary-v1');
  for (const root of manifest.roots) {
    for (const dataset of contract.datasets) {
      assert.equal(tableOf(snapshot, root.database, dataset.table).rows.length, 0,
        'Any pre-existing editor registry row requires a separate reviewed cleanup, never retry/adoption');
    }
    const modules = tableOf(snapshot, root.database, 't_srfpsmodule').rows.map(decode);
    const systems = tableOf(snapshot, root.database, 't_srfpssystem').rows.map(decode);
    assert.equal(modules.length, 1);
    assert.equal(systems.length, 1);
    for (const [field, expected] of [
      ['psmoduleid', root.sentinelId], ['pssystemid', root.logicalSystemId],
      ['psmodulename', root.sentinelName], ['modtag', root.sentinelTag],
    ]) assert.equal(modules[0][field], expected);
    for (const [field, expected] of [
      ['pssystemid', root.logicalSystemId], ['pssystemname', root.sentinelSystemName],
      ['psdevslnsysid', root.rootId], ['pssysmodelinstid', root.modelInstanceId],
      ['psdevcenterid', root.centerId],
    ]) assert.equal(systems[0][field], expected);
    assert.equal(Number(systems[0].modelver), root.modelVersion, 'Do not silently adopt a mutated fixed baseline');
  }
  return true;
}

export function verifyEditorNativeSeedMutation(manifest, contract, root, dataset, payload, response, before, after) {
  assert.deepEqual(after.inventory, before.inventory);
  assert.equal(after.encoding, before.encoding);
  assert.deepEqual(after.tables.map(row => [row.database, row.table]), before.tables.map(row => [row.database, row.table]));
  const key = response?.[dataset.keyField];
  assert.match(key ?? '', /^[A-Za-z0-9_-]{1,100}$/, 'Require a safe actual native key, never a route fragment');
  const ownBefore = tableOf(before, root.database, dataset.table);
  const ownAfter = tableOf(after, root.database, dataset.table);
  assert.equal(ownBefore.rows.length, 0);
  assert.equal(ownAfter.rows.length, 1, 'Exactly one actual native-created primary row is required');
  const value = decode(ownAfter.rows[0]);
  assert.equal(value[dataset.keyField], key);
  for (const [field, expected] of Object.entries(payload)) {
    if (Object.hasOwn(value, field)) {
      const actualExpected = field === 'pssystemname'
        ? expectedNativeEditorSystemName(root, dataset) : expected;
      assert.equal(value[field], actualExpected === null ? null : String(actualExpected));
    }
  }
  for (const field of dataset.queryRowMinimum.requiredNull ?? []) assert.equal(value[field], null);
  const systemBefore = tableOf(before, root.database, 't_srfpssystem');
  const systemAfter = tableOf(after, root.database, 't_srfpssystem');
  assert.equal(systemBefore.rows.length, 1);
  assert.equal(systemAfter.rows.length, 1);
  sameExcept(systemBefore.rows[0], systemAfter.rows[0], ['modelver']);
  const oldVersion = Number(decode(systemBefore.rows[0]).modelver);
  const newVersion = Number(decode(systemAfter.rows[0]).modelver);
  assert.ok(Number.isSafeInteger(oldVersion) && Number.isSafeInteger(newVersion));
  assert.equal(newVersion, oldVersion + 1, 'Exactly one source-backed native system version increment');
  const logTable = 't_srfpssysmodellog';
  const logBefore = tableOf(before, root.database, logTable);
  const logAfter = tableOf(after, root.database, logTable);
  const matches = row => {
    const value = decode(row);
    return value.pssystemid === root.logicalSystemId && value.pssysmodellogname === dataset.entity.toUpperCase();
  };
  assert.deepEqual(logAfter.rows.filter(row => !matches(row)), logBefore.rows.filter(row => !matches(row)),
    'Unrelated native audit log rows must remain byte-identical');
  const oldLogs = logBefore.rows.filter(matches);
  const newLogs = logAfter.rows.filter(matches);
  assert.ok(oldLogs.length <= 1);
  assert.equal(newLogs.length, 1, 'Require exactly the source-backed entity/system model log');
  if (oldLogs.length) sameExcept(oldLogs[0], newLogs[0], ['updatedate', 'updateman']);
  assert.equal(decode(newLogs[0]).pssystemname, '(N/A)');
  for (const table of before.tables) {
    if (table.database === root.database && [dataset.table, 't_srfpssystem', logTable].includes(table.table.toLowerCase())) continue;
    assert.deepEqual(tableOf(after, table.database, table.table.toLowerCase()), table,
      'No foreign-root, baseline module, unrelated table, task, folder or extra audit mutation is allowed');
  }
  return { version: { database: root.database, before: oldVersion, after: newVersion, delta: 1 },
    nativeModelLog: { database: root.database, table: logTable,
      key: decode(newLogs[0]).pssysmodellogid, entity: dataset.entity.toUpperCase(),
      beforeRows: oldLogs.length, afterRows: 1 } };
}

export async function runOwnedEditorNativeSeeds({
  context, contract, bindings, io, record, executeOwned = false, now = Date.now,
  nonce = () => randomBytes(6).toString('hex'),
}) {
  assert.equal(executeOwned, true);
  assert.equal(typeof record, 'function');
  for (const name of ['deploymentInput', 'sourceImages']) {
    assert.deepEqual(Object.keys(bindings[name] ?? {}).sort(), ['path', 'sha256']);
    assert.equal(typeof bindings[name].path, 'string');
    assert.match(bindings[name].sha256, /^[a-f0-9]{64}$/);
  }
  assert.equal(bindings.sourceContractSha256, hash(json(contract)));
  const report = {
    contract: 'owned-editor-registry-native-seed-v1', runId: context.manifest.runId,
    status: 'running-native-create-seeds', ...bindings, records: [], requests: [], snapshots: [],
    mutationJournals: [], blocked: [], nativeAcceptance: false, permissionAcceptance: false,
    fullInitializationAcceptance: false, sqlWritesRequested: false, nativeCleanupPerformed: false,
    startedAt: new Date(now()).toISOString(),
  };
  const sessions = new Map();
  let last;
  let stage = 'source-account-and-empty-baseline';
  const save = (kind, value) => {
    const result = record(kind, value);
    assert.ok(result && typeof result.path === 'string' && /^[a-f0-9]{64}$/.test(result.sha256)
      && typeof result.then !== 'function', 'Private evidence must be synchronously persisted before writes');
    return result;
  };
  const snapshot = purpose => {
    context.guard();
    const value = io.snapshot();
    report.snapshots.push({ purpose, binding: save('snapshot', { purpose, snapshot: value }) });
    return value;
  };
  const request = async (actor, spec) => {
    context.guard();
    const result = await io.request({ ...spec, actorId: actor.personId });
    const item = { actor: actor.personId, method: spec.method ?? 'GET', path: spec.path,
      status: result.status, error: result.error, dispatched: result.dispatched === true,
      responseSha256: result.responseSha256 };
    report.requests.push(item);
    item.evidence = save('http', { ...item,
      ...(spec.path === '/v7/login' ? {} : { request: spec.data, response: result.data }) });
    return result;
  };
  const success = response => {
    assert.equal(response.dispatched, true);
    assert.equal(response.error, null);
    assert.equal(response.status, 200);
  };
  const login = async actor => {
    const startedAt = now();
    save('login-intent', { actor: actor.personId, method: 'POST', path: '/v7/login' });
    const response = await request(actor, { method: 'POST', path: '/v7/login',
      data: { loginname: actor.loginname, password: context.credentials.users[actor.loginname] } });
    success(response);
    const token = response.data?.token;
    verifyEditorBackendToken(token, now());
    const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
    assert.ok(claims.exp * 1000 - now() > 10_000);
    const session = { token, sessionStartedAt: startedAt, sessionExpiresAt: claims.exp * 1000,
      applicationContext: { system: actor.source.system, organization: actor.source.organization } };
    sessions.set(actor.personId, session);
    const appdata = await request(actor, { path: '/appdata', ...session });
    success(appdata);
    verifyInternalMessageAppData(appdata, actor);
    const self = await request(actor, { path: '/uaa/oauth/userinfo', ...session });
    success(self);
    assert.equal(self.data?.sub, actor.loginname);
    return session;
  };
  const session = async actor => {
    const current = sessions.get(actor.personId);
    return !current || now() - current.sessionStartedAt >= 4_000
      || current.sessionExpiresAt - now() <= 10_000 ? login(actor) : current;
  };
  try {
    context.guard();
    const accounts = io.accounts();
    report.sourceAccounts = save('source-accounts', accounts);
    const actors = verifyInternalMessageAccounts(context.manifest, accounts);
    const editors = context.manifest.roots.map(root => {
      const users = actors.filter(actor => actor.rootId === root.rootId && actor.role === 'editor');
      assert.equal(users.length, 1);
      return { root, actor: users[0] };
    });
    last = snapshot('initial-all-model-tables');
    verifyEditorNativeSeedInitial(context.manifest, contract, last);
    report.initialBaseline = report.snapshots.at(-1).binding;
    const configs = new Map();
    for (const { root, actor } of editors) {
      stage = `read-real-app-config-${root.side}`;
      const rows = {};
      const evidence = [];
      for (const config of contract.applicationConfig) {
        const response = await request(actor, { method: 'POST', path: config.readPath,
          data: config.body, ...await session(actor) });
        evidence.push(report.requests.at(-1).evidence);
        if (response.error !== null || response.status !== 200 || !Array.isArray(response.data)) {
          rows[config.entity] = [];
          report.blocked.push({ entity: 'PSSysApp', rootId: root.rootId,
            reason: 'Actual config HTTP/schema failed; no synthetic config IDs', evidence: evidence.at(-1) });
        } else rows[config.entity] = response.data;
      }
      const selected = chooseNativeEditorAppConfig(rows, actor);
      if (!selected) report.blocked.push({ entity: 'PSSysApp', rootId: root.rootId,
        reason: 'No observed coherent active platform/style/type triple', evidence });
      configs.set(root.rootId, selected);
    }
    assert.deepEqual(snapshot('after-read-only-config'), last, 'Config/login must not mutate either physical model schema');
    for (const { root, actor } of editors) for (const dataset of contract.datasets) {
      if (dataset.entity === 'PSSysApp' && !configs.get(root.rootId)) continue;
      stage = `native-create-${root.side}-${dataset.entity}`;
      const before = snapshot(`${stage}-before`);
      assert.deepEqual(before, last, 'Unexpected concurrent database mutation before native Create');
      const payload = editorNativeSeedPayload(context.manifest, root, dataset, nonce(), configs.get(root.rootId));
      assert.ok(!report.mutationJournals.some(row => row.userTag === payload.usertag
        || row.name === payload[dataset.nameField]), 'Never retry or reuse an earlier mutation intent');
      const auth = await session(actor);
      assert.deepEqual(snapshot(`${stage}-after-normal-login`), before,
        'Normal login immediately before mutation must not change the physical prewrite baseline');
      const path = dataset.collectionPath.replace('$ROOT_ID', root.rootId);
      const intent = { entity: dataset.entity, rootId: root.rootId, database: root.database,
        actor: actor.personId, method: 'POST', path, request: payload,
        name: payload[dataset.nameField], userTag: payload.usertag, status: 'journalled-before-dispatch' };
      const journal = save('mutation-intent', intent);
      report.mutationJournals.push({ entity: intent.entity, rootId: intent.rootId,
        name: intent.name, userTag: intent.userTag, binding: journal, status: intent.status });
      const response = await request(actor, { method: 'POST', path, data: payload, ...auth });
      const after = snapshot(`${stage}-after`);
      const evidence = { method: 'POST', path, status: response.status, error: response.error,
        request: payload, response: response.data };
      const createEvidence = save('create-evidence', evidence);
      success(response);
      const candidate = { entity: dataset.entity, rootId: root.rootId, database: root.database,
        logicalSystemId: root.logicalSystemId, key: response.data?.[dataset.keyField],
        name: intent.name, userTag: intent.userTag,
        systemName: response.data?.pssystemname ?? expectedNativeEditorSystemName(root, dataset),
        createEvidence };
      verifyEditorCreateEvidence(context.manifest, contract, candidate, evidence);
      const effects = verifyEditorNativeSeedMutation(context.manifest, contract, root, dataset,
        payload, response.data, before, after);
      report.records.push({ ...candidate, sideEffects: effects, mutationJournal: journal });
      report.mutationJournals.at(-1).status = 'native-create-and-physical-effects-verified';
      last = after;
    }
    const final = snapshot('final-retained-native-seeds');
    assert.deepEqual(final, last);
    report.finalSnapshot = report.snapshots.at(-1).binding;
    report.fullInitializationAcceptance = report.records.length === 10 && report.blocked.length === 0;
    report.status = report.fullInitializationAcceptance
      ? 'passed-native-create-seeds' : 'partial-native-create-seeds-app-config-blocked';
  } catch (error) {
    report.status = 'failed-native-create-seeds';
    report.failure = save('failure', { stage, name: error.name, code: error.code,
      message: error.message, stack: error.stack });
    try { snapshot('failure-retained-all-model-tables'); }
    catch { report.failureSnapshotUnavailable = true; }
  }
  report.stage = stage;
  report.actualDispatchedRequests = report.requests.filter(row => row.dispatched).length;
  report.finishedAt = new Date(now()).toISOString();
  return report;
}

export async function executeOwnedEditorNativeSeeds({
  workspace = workspaceDefault, runId, deploymentInput, label, executeOwned = false,
}) {
  assert.equal(executeOwned, true, 'Explicit --execute-owned is required');
  assert.match(runId ?? '', /^[a-f0-9]{12}$/);
  assert.match(label ?? '', /^[a-z0-9][a-z0-9-]{0,48}$/);
  assert.equal(typeof deploymentInput, 'string');
  workspace = resolve(workspace);
  const context = ownedNativeRuntimeContext({ workspace, runId, deploymentInput });
  const directories = new PinnedDirectories();
  const pins = [];
  let output;
  let serial = 0;
  const read = path => {
    path = resolve(workspace, path);
    const parent = directories.open(dirname(path));
    const file = readPinnedFile(directories, parent, basename(path));
    pins.push({ path, parent, name: basename(path), sha256: hash(file.data) });
    return file.data;
  };
  const guard = () => {
    const live = context.guard();
    for (const pin of pins) assert.equal(hash(readPinnedFile(directories, pin.parent, pin.name).data),
      pin.sha256, 'Native seed source/input binding drift');
    return live;
  };
  const record = (kind, value, explicitName) => {
    const name = explicitName ?? `${String(++serial).padStart(5, '0')}-${kind}.private.json`;
    const bytes = json(value);
    const identity = directories.write(output, name, bytes);
    const descriptor = fs.openSync(directories.entry(output, name), fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const current = fs.fstatSync(descriptor);
      assert.equal(current.dev, identity.dev);
      assert.equal(current.ino, identity.ino);
      fs.fsyncSync(descriptor);
    } finally { fs.closeSync(descriptor); }
    fs.fsyncSync(output.descriptor);
    return { path: join(output.path, name), sha256: hash(bytes) };
  };
  try {
    output = directories.open(join(context.base, `editor-registry-native-seed-${label}`),
      { create: true, exclusive: true });
    for (const path of ['scripts/seed-owned-editor-registry-native.mjs', 'scripts/native-five-dataset-contract.mjs',
      'scripts/probe-owned-editor-registry-http.mjs', 'scripts/harness-owned-internal-message.mjs']) read(path);
    const contract = readNativeFiveDatasetContract({ workspace });
    // The 85MB immutable source dump is rechecked by its own guarded source
    // reader. Smaller source models are also pinned across native dispatches.
    for (const input of contract.inputs.filter(input => input.bytes <= 64 * 1024 * 1024)) {
      assert.equal(hash(read(input.path)), input.sha256);
    }
    const images = JSON.parse(read(context.deployment.imageReceipt.path));
    assert.equal(pins.at(-1).sha256, context.deployment.imageReceipt.sha256);
    const build = JSON.parse(read(images.packageReceipt.path));
    assert.equal(pins.at(-1).sha256, images.packageReceipt.sha256);
    assert.equal(build.status, 'passed-package-and-unit-only');
    for (const path of runtimeSources) {
      const bytes = read(join(build.worktree, path));
      assert.equal(hash(bytes), build.sourceInputs.before.entries.find(entry => entry.path === path)?.sha256);
      assert.equal(hash(read(join('ibiz-service-hub', path))), hash(bytes));
      if (path.endsWith('/PSModels.java')) {
        for (const dataset of contract.datasets) assert.ok(bytes.includes(
          Buffer.from(`registerModel(${dataset.entity.toUpperCase()});`)));
      }
    }
    const deployment = context.bindings.find(binding => binding.path === resolve(workspace, deploymentInput));
    assert.ok(deployment);
    const guarded = { ...context, guard };
    const report = await runOwnedEditorNativeSeeds({
      context: guarded, contract, executeOwned, record,
      bindings: {
        deploymentInput: { path: deployment.path, sha256: deployment.sha256 },
        sourceImages: context.deployment.imageReceipt, sourceContractSha256: hash(json(contract)),
      },
      io: createOwnedEditorNativeSeedIO(guarded, contract),
    });
    try {
      guard();
      assert.equal(hash(json(readNativeFiveDatasetContract({ workspace }))), report.sourceContractSha256);
    } catch (error) {
      report.status = 'failed-native-create-seeds';
      report.fullInitializationAcceptance = false;
      report.finalBindingFailure = record('failure', {
        stage: 'final-source-and-runtime-binding', message: error.message, stack: error.stack,
      });
    }
    record('receipt', report, 'receipt.private.json');
    return { report, receiptPath: join(output.path, 'receipt.private.json'),
      receiptSha256: hash(json(report)) };
  } finally {
    directories.close();
    context.close();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { values } = parseArgs({ options: {
      'execute-owned': { type: 'boolean', default: false }, 'run-id': { type: 'string' },
      'deployment-input': { type: 'string' }, label: { type: 'string' },
    }, strict: true, allowPositionals: false });
    const result = await executeOwnedEditorNativeSeeds({
      runId: values['run-id'], deploymentInput: values['deployment-input'],
      label: values.label, executeOwned: values['execute-owned'],
    });
    console.log(json({ status: result.report.status, records: result.report.records.length,
      blocked: result.report.blocked.length, receiptPath: result.receiptPath,
      receiptSha256: result.receiptSha256, fullInitializationAcceptance: result.report.fullInitializationAcceptance }));
    if (!result.report.fullInitializationAcceptance) process.exitCode = 1;
  } catch {
    console.error('Owned native editor seed refused or failed; private details suppressed');
    process.exitCode = 1;
  }
}
