#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { PinnedDirectories, readPinnedFile } from './native-candidate-files.mjs';
import { readNativeFiveDatasetContract } from './native-five-dataset-contract.mjs';
import { ownedNativeRuntimeContext } from './owned-native-runtime-context.mjs';
import { ownedPlatformRequest, validateOwnedPlatformRequest } from './owned-platform-http.mjs';
import { validateMatrixFixture } from './prepare-run-owned-native-nonadmin-matrix.mjs';
import {
  modelingContextFromIdentity, requiresFreshBackendLogin, verifyModelingAppData, verifyUAAIdentity,
} from './run-owned-native-permission-http.mjs';

const workspaceDefault = fileURLToPath(new URL('../', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const jwtPattern = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const entities = ['PSSysDBScheme', 'PSSysApp', 'PSSysSFPub', 'PSSysServiceAPI', 'PSSubSysServiceAPI'];
const collections = ['pssysdbschemes', 'pssysapps', 'pssyssfpubs', 'pssysserviceapis', 'pssubsysserviceapis'];
const runtimeSources = [
  'libs/ibiz-modeling-core/src/main/java/net/ibizsys/modeling/core/util/PSModels.java',
  'libs/ibiz-modeling-core/src/main/java/net/ibizsys/modeling/core/security/SystemAccessManagerBase.java',
  'libs/ibiz-modeling-core/src/main/java/net/ibizsys/modeling/core/dataentity/security/PSModelDEAccessManager.java',
  'libs/ibiz-modeling-core/src/main/java/net/ibizsys/modeling/core/dataentity/DataEntityRuntimeBase.java',
  'libs/ibiz-runtime/src/main/java/net/ibizsys/runtime/dataentity/DataEntityRuntimeBase.java',
];
const id = value => {
  assert.match(value ?? '', /^[A-Za-z][A-Za-z0-9_]*$/);
  return `\`${value}\``;
};
const text = value => {
  assert.equal(typeof value, 'string');
  assert.ok(value && !/[\u0000\r\n]/.test(value));
  return `CONVERT(0x${Buffer.from(value).toString('hex')} USING utf8mb4)`;
};
const inside = (base, path) => {
  const child = relative(resolve(base), resolve(path));
  assert.ok(child && child !== '..' && !child.startsWith('../') && !child.startsWith('/'),
    'Evidence must remain inside the declared owned directory');
};
const folded = object => {
  const entries = Object.entries(object).map(([key, value]) => [key.toLowerCase(), value]);
  assert.equal(new Set(entries.map(([key]) => key)).size, entries.length, 'Case-folded field collision');
  return Object.fromEntries(entries);
};

export function expectedNativeEditorSystemName(root, dataset) {
  assert.ok(root && dataset);
  return ['PSSysApp', 'PSSysSFPub'].includes(dataset.entity)
    ? root.sentinelSystemName : root.rootId;
}

export function validateEditorDatasetContract(contract) {
  assert.equal(contract?.contract, 'native-five-dataset-readonly-sentinel-contract-v1');
  assert.deepEqual(contract.datasets.map(row => row.entity), entities);
  for (const [index, row] of contract.datasets.entries()) {
    assert.match(row.table, /^t_srf[a-z0-9_]+$/);
    assert.match(row.keyField, /^[a-z][a-z0-9_]*$/);
    assert.match(row.nameField, /^[a-z][a-z0-9_]*$/);
    assert.equal(row.query, index === 2 ? 'CurSys2' : 'CurSys');
    assert.equal(row.collectionPath,
      `/api/ibizmodeling__modeldesign/psdevslnsys/$ROOT_ID/${collections[index]}`);
    assert.equal(row.fetchPath, `${row.collectionPath}/fetch${row.query.toLowerCase()}`);
    assert.equal(row.methods[`Fetch${row.query}`].method, 'POST');
    assert.equal(row.methods[`Fetch${row.query}`].permission, 'READ');
    assert.deepEqual(row.fetchBody, { pssystemid: '$ACTUAL_ROOT_LOGICAL_SYSTEM_ID', page: 0, size: 1000 });
    assert.ok([row.keyField, row.nameField, 'pssystemid', 'usertag']
      .every(field => row.returnProjection.some(output => output.field === field)));
  }
  return true;
}

export function editorDatasetRequest(manifest, contract, entity, rootId, token, applicationContext) {
  validateMatrixFixture(manifest);
  validateEditorDatasetContract(contract);
  const root = manifest.roots.find(root => root.rootId === rootId);
  const dataset = contract.datasets.find(row => row.entity === entity);
  assert.ok(root && dataset);
  return {
    peer: 'backend', method: dataset.methods[`Fetch${dataset.query}`].method,
    path: dataset.fetchPath.replace('$ROOT_ID', root.rootId),
    data: { ...dataset.fetchBody, pssystemid: root.logicalSystemId }, token, applicationContext,
  };
}

export function validateEditorRegistryRequest(manifest, contract, spec) {
  validateMatrixFixture(manifest);
  validateEditorDatasetContract(contract);
  assert.ok(spec && Object.keys(spec).every(key =>
    ['peer', 'method', 'path', 'data', 'token', 'applicationContext'].includes(key)));
  const root = manifest.roots.find(root => contract.datasets.some(dataset =>
    spec.path === dataset.fetchPath.replace('$ROOT_ID', root.rootId)));
  if (!root) {
    assert.ok(['/auths/login', '/auths/user-info/self', '/v7/login', '/uaa/oauth/userinfo', '/appdata'].includes(spec.path));
    validateOwnedPlatformRequest(manifest.runId, spec.peer, spec.path, spec.method);
    assert.equal(spec.applicationContext !== undefined, spec.path === '/appdata');
    if (spec.path.endsWith('/login')) {
      const user = manifest.users.find(user => user.loginname === spec.data?.loginname);
      assert.ok(user);
      assert.deepEqual(Object.keys(spec.data).sort(),
        spec.peer === 'uaa' ? ['dc', 'loginname', 'password'] : ['loginname', 'password']);
      if (spec.peer === 'uaa') assert.equal(spec.data.dc, user.centerId);
      assert.ok(typeof spec.data.password === 'string' && spec.data.password);
    } else assert.equal(spec.data, undefined);
  } else {
    const dataset = contract.datasets.find(dataset =>
      spec.path === dataset.fetchPath.replace('$ROOT_ID', root.rootId));
    assert.equal(spec.peer, 'backend');
    assert.equal(spec.method, dataset.methods[`Fetch${dataset.query}`].method);
    assert.deepEqual(spec.data, { ...dataset.fetchBody, pssystemid: root.logicalSystemId });
    assert.ok(spec.applicationContext);
    assert.match(spec.token ?? '', jwtPattern);
  }
  if (spec.token !== undefined) assert.match(spec.token, jwtPattern);
  if (spec.applicationContext !== undefined) {
    assert.deepEqual(Object.keys(spec.applicationContext).sort(), ['organization', 'system']);
    assert.equal(spec.applicationContext.system, 'ibizmodeling');
    assert.ok(manifest.users.some(user =>
      spec.applicationContext.organization === `${user.centerId}_org`));
  }
  return Boolean(root);
}

export async function ownedEditorRegistryRequest(context, contract, spec, { fetchImplementation = fetch } = {}) {
  const dataset = validateEditorRegistryRequest(context.manifest, contract, spec);
  if (!dataset) return ownedPlatformRequest(context, spec, { fetchImplementation });
  const live = context.guard();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);
  const result = { status: null, error: null, bytes: 0, data: null };
  try {
    const response = await fetchImplementation(live.origins.backend + spec.path, {
      method: spec.method, redirect: 'manual', signal: controller.signal,
      headers: { accept: 'application/json', 'content-type': 'application/json',
        authorization: `Bearer ${spec.token}`, srfsystemid: spec.applicationContext.system,
        srforgid: spec.applicationContext.organization },
      body: JSON.stringify(spec.data),
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
}

export function validateEditorSeedReceipt(manifest, contract, receipt, bindings, { allowPartial = false } = {}) {
  validateMatrixFixture(manifest);
  validateEditorDatasetContract(contract);
  assert.equal(receipt?.contract, 'owned-editor-registry-native-seed-v1');
  assert.equal(receipt.runId, manifest.runId);
  const partial = receipt.status === 'partial-native-create-seeds-app-config-blocked';
  assert.ok(receipt.status === 'passed-native-create-seeds' || allowPartial && partial);
  assert.equal(receipt.sourceContractSha256, hash(json(contract)));
  for (const field of ['deploymentInput', 'sourceImages']) {
    assert.deepEqual(Object.keys(receipt[field] ?? {}).sort(), ['path', 'sha256']);
    assert.ok(typeof receipt[field].path === 'string' && receipt[field].path);
    assert.match(receipt[field].sha256, /^[a-f0-9]{64}$/);
  }
  assert.deepEqual(receipt.deploymentInput, bindings.deploymentInput);
  assert.deepEqual(receipt.sourceImages, bindings.sourceImages);
  assert.ok(Array.isArray(receipt.records));
  assert.equal(receipt.records.length, partial ? 8 : 10,
    'The receipt status must match its exact native-created coverage');
  if (partial) {
    assert.equal(receipt.fullInitializationAcceptance, false);
    assert.ok(receipt.records.every(record => record.entity !== 'PSSysApp'),
      'An App-blocked receipt cannot silently contain application rows');
    for (const root of manifest.roots) {
      assert.ok(receipt.blocked?.some(row => row.entity === 'PSSysApp' && row.rootId === root.rootId),
        'Both application roots must remain explicitly blocked');
    }
  }
  const uniqueKeys = new Set();
  const uniqueMarkers = new Set();
  for (const root of manifest.roots) for (const dataset of contract.datasets) {
    const records = receipt.records.filter(row => row.rootId === root.rootId && row.entity === dataset.entity);
    if (partial && dataset.entity === 'PSSysApp') continue;
    assert.equal(records.length, 1);
    const record = records[0];
    assert.equal(record.database, root.database);
    assert.equal(record.logicalSystemId, root.logicalSystemId);
    assert.equal(record.systemName, expectedNativeEditorSystemName(root, dataset),
      'Native model rows must retain the source-backed system-name projection');
    for (const field of ['key', 'name', 'userTag']) {
      assert.ok(typeof record[field] === 'string' && record[field].trim()
        && !/[\u0000\r\n]/.test(record[field]));
    }
    assert.ok(record.name.includes(manifest.runId) && record.userTag.includes(manifest.runId),
      'Seed marker must bind the owned fixture');
    assert.ok(!uniqueKeys.has(record.key) && !uniqueMarkers.has(record.userTag),
      'Distinct physical roots/entities require distinct seed keys and markers');
    uniqueKeys.add(record.key); uniqueMarkers.add(record.userTag);
    assert.ok(record.createEvidence && typeof record.createEvidence.path === 'string');
    assert.match(record.createEvidence.sha256 ?? '', /^[a-f0-9]{64}$/);
  }
  return true;
}

export function verifyEditorCreateEvidence(manifest, contract, record, evidence) {
  const root = manifest.roots.find(root => root.rootId === record.rootId);
  const dataset = contract.datasets.find(row => row.entity === record.entity);
  assert.ok(root && dataset);
  assert.equal(evidence?.method, 'POST');
  assert.equal(evidence.path, dataset.collectionPath.replace('$ROOT_ID', root.rootId));
  assert.equal(evidence.status, 200);
  assert.equal(evidence.error, null);
  for (const [index, body] of [evidence.request, evidence.response].entries()) {
    assert.ok(body && typeof body === 'object' && !Array.isArray(body));
    if (index === 1 || Object.hasOwn(body, dataset.keyField)) assert.equal(body[dataset.keyField], record.key);
    assert.equal(body[dataset.nameField], record.name);
    assert.equal(body.pssystemid, root.logicalSystemId);
    assert.equal(body.usertag, record.userTag);
  }
  assert.equal(record.systemName, expectedNativeEditorSystemName(root, dataset));
  assert.equal(evidence.response.pssystemname, record.systemName,
    'The native response must match its exact source-backed system-name projection');
  return true;
}

export function editorPhysicalInventorySQL(manifest) {
  validateMatrixFixture(manifest);
  return "SELECT JSON_OBJECT('database',c.TABLE_SCHEMA,'table',c.TABLE_NAME,'column',c.COLUMN_NAME,"
    + "'type',c.DATA_TYPE,'columnType',c.COLUMN_TYPE,'ordinal',c.ORDINAL_POSITION,'key',c.COLUMN_KEY,"
    + "'nullable',c.IS_NULLABLE,'default',c.COLUMN_DEFAULT,'extra',c.EXTRA,"
    + "'charset',c.CHARACTER_SET_NAME,'collation',c.COLLATION_NAME)"
    + ' FROM INFORMATION_SCHEMA.COLUMNS c JOIN INFORMATION_SCHEMA.TABLES t'
    + ' ON t.TABLE_SCHEMA=c.TABLE_SCHEMA AND t.TABLE_NAME=c.TABLE_NAME'
    + ` WHERE c.TABLE_SCHEMA IN (${manifest.roots.map(root => text(root.database)).join(',')})`
    + " AND t.TABLE_TYPE='BASE TABLE' ORDER BY c.TABLE_SCHEMA,c.TABLE_NAME,c.ORDINAL_POSITION;\n";
}

export function validateEditorPhysicalInventory(manifest, contract, rows) {
  validateMatrixFixture(manifest);
  validateEditorDatasetContract(contract);
  assert.ok(Array.isArray(rows) && rows.length > 0);
  const targets = [];
  assert.ok(rows.every(row => manifest.roots.some(root => root.database === row.database)));
  for (const root of manifest.roots) {
    const tables = [...new Set(rows.filter(row => row.database === root.database).map(row => row.table))].sort();
    assert.ok(tables.length >= contract.schemaTables.mergedPhysicalTables,
      'Every source-required model table must be present, not only the five editor tables');
    assert.equal(new Set(tables.map(table => table.toLowerCase())).size, tables.length);
    for (const table of tables) {
      id(table);
      const columns = rows.filter(row => row.database === root.database && row.table === table);
      assert.deepEqual(columns.map(row => row.ordinal), columns.map((_, index) => index + 1));
      assert.equal(new Set(columns.map(row => row.column.toLowerCase())).size, columns.length);
      for (const column of columns) {
        id(column.column); assert.match(column.type, /^[a-z0-9]+$/);
        assert.ok(['YES', 'NO'].includes(column.nullable));
      }
      targets.push({ database: root.database, table, columns });
    }
    for (const dataset of contract.datasets) {
      const target = targets.find(target => target.database === root.database
        && target.table.toLowerCase() === dataset.table);
      assert.ok(target);
      const names = target.columns.map(column => column.column.toLowerCase());
      assert.ok(dataset.sourceSchema.columns.every(column => names.includes(column.toLowerCase())),
        'The complete source/dump column union is required');
      assert.deepEqual(target.columns.filter(column => column.key === 'PRI').map(column => column.column.toLowerCase()),
        [dataset.keyField]);
      for (const relation of dataset.joins) {
        assert.ok(tables.some(table => table.toLowerCase() === relation.table), 'Every native LEFT JOIN table must exist');
      }
      const aliases = new Map(dataset.joins.map(relation => [relation.alias, relation.table]));
      const requireField = (alias, field) => {
        const joined = targets.find(target => target.database === root.database
          && target.table.toLowerCase() === aliases.get(alias));
        assert.ok(joined?.columns.some(column => column.column.toLowerCase() === field.toLowerCase()),
          'Every actual native query dependency must exist in the physical schema');
      };
      for (const relation of dataset.joins.filter(relation => relation.on)) {
        requireField(relation.on.leftAlias, relation.on.leftField);
        requireField(relation.on.rightAlias, relation.on.rightField);
      }
      for (const expression of [dataset.predicate, ...dataset.returnProjection.map(field => field.expression)]) {
        for (const match of expression.matchAll(/\b(t[0-9]+)\.`([A-Z][A-Z0-9_]*)`/g)) requireField(match[1], match[2]);
      }
    }
  }
  return targets;
}

export function editorPhysicalSnapshotSQL(targets) {
  assert.ok(Array.isArray(targets) && targets.length > 0);
  return targets.map(target => {
    const fields = target.columns.map(column =>
      `${text(column.column)},IF(${id(column.column)} IS NULL,NULL,HEX(CAST(${id(column.column)} AS BINARY)))`).join(',');
    return `SELECT JSON_OBJECT('database',${text(target.database)},'table',${text(target.table)},`
      + `'row',JSON_OBJECT(${fields})) FROM ${id(target.database)}.${id(target.table)};`;
  }).join('\n') + '\n';
}

export function normalizeEditorPhysicalSnapshot(inventory, targets, rows) {
  assert.ok(Array.isArray(rows));
  assert.ok(rows.every(row => targets.some(target =>
    row.database === target.database && row.table === target.table)));
  return {
    encoding: 'every-physical-column-null-or-hex-cast-binary-v1',
    inventory,
    tables: targets.map(target => {
      const values = rows.filter(row => row.database === target.database && row.table === target.table).map(item => {
        assert.ok(item.row && typeof item.row === 'object' && !Array.isArray(item.row));
        assert.deepEqual(Object.keys(item.row).sort(), target.columns.map(column => column.column).sort(),
          'Every physical column must be retained');
        for (const value of Object.values(item.row)) {
          assert.ok(value === null || typeof value === 'string' && /^(?:[A-F0-9]{2})*$/.test(value),
            'Physical values must be null or exact binary hex, not a partial projection');
        }
        return Object.fromEntries(Object.entries(item.row).sort(([a], [b]) => a.localeCompare(b)));
      }).sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
      return { database: target.database, table: target.table, rows: values };
    }),
  };
}

export function verifyEditorSeedSnapshot(manifest, contract, receipt, snapshot) {
  for (const record of receipt.records) {
    const dataset = contract.datasets.find(row => row.entity === record.entity);
    const table = snapshot.tables.find(row => row.database === record.database && row.table.toLowerCase() === dataset.table);
    assert.ok(table);
    const decoded = table.rows.map(row => Object.fromEntries(Object.entries(folded(row))
      .map(([field, value]) => [field, value === null ? null : Buffer.from(value, 'hex').toString('utf8')])));
    const found = decoded.filter(row => row[dataset.keyField] === record.key);
    assert.equal(found.length, 1, 'Require the actual nonempty full-column physical sentinel');
    for (const [field, expected] of [
      [dataset.nameField, record.name], ['pssystemid', record.logicalSystemId], ['usertag', record.userTag],
    ]) assert.equal(found[0][field], expected, 'Seed receipt must match the physical owned model row');
    for (const field of dataset.queryRowMinimum.requiredNull ?? []) assert.equal(found[0][field], null);
    const foreign = receipt.records.filter(row => row.rootId !== record.rootId);
    assert.ok(!decoded.some(row => foreign.some(item =>
      row[dataset.keyField] === item.key || row.usertag === item.userTag)), 'Foreign seed stored in the wrong physical schema');
  }
  for (const root of manifest.roots) {
    const table = snapshot.tables.find(row => row.database === root.database && row.table.toLowerCase() === 't_srfpssystem');
    assert.ok(table);
    const systems = table.rows.map(folded).filter(row =>
      Buffer.from(row.pssystemid ?? '', 'hex').toString('utf8') === root.logicalSystemId);
    assert.equal(systems.length, 1);
    assert.equal(Buffer.from(systems[0].pssystemname ?? '', 'hex').toString('utf8'), root.sentinelSystemName);
  }
  return true;
}

export function verifyEditorDatasetResponse(response, user, root, dataset, receipt, before, after) {
  assert.deepEqual(after, before, 'A dataset READ must not alter any physical table, row or column in either model schema');
  assert.equal(response.error, null);
  const allowed = user.rootId === root.rootId && ['editor', 'viewer'].includes(user.role);
  const serialized = JSON.stringify(response.data);
  if (!allowed) {
    assert.equal(response.status, 403, 'Only authenticated HTTP 403 establishes denial, never 401/404/500');
    for (const record of receipt.records) for (const field of ['key', 'name', 'userTag', 'systemName']) {
      assert.ok(!serialized?.includes(record[field]), 'Denied response leaked a physical sentinel');
    }
    return { expectedStatus: 403, returnedSentinels: 0 };
  }
  assert.equal(response.status, 200);
  assert.ok(Array.isArray(response.data) && response.data.length > 0, 'An empty HTTP 200 array is never acceptance');
  const expected = receipt.records.filter(row => row.rootId === root.rootId && row.entity === dataset.entity);
  assert.equal(expected.length, 1);
  assert.equal(response.data.length, expected.length, 'Every returned row must be the source-bound seeded row');
  const seen = new Set();
  for (const row of response.data) {
    assert.ok(row && typeof row === 'object' && !Array.isArray(row));
    const record = expected.find(record => record.key === row[dataset.keyField]);
    assert.ok(record && !seen.has(record.key), 'Unknown, duplicate or foreign physical row');
    seen.add(record.key);
    assert.equal(row[dataset.nameField], record.name);
    assert.equal(row.pssystemid, record.logicalSystemId);
    assert.equal(row.usertag, record.userTag);
    if (dataset.returnProjection.some(field => field.field === 'pssystemname')) assert.equal(row.pssystemname, record.systemName);
  }
  for (const record of receipt.records.filter(row => row.rootId !== root.rootId)) {
    for (const field of ['key', 'name', 'userTag', 'systemName']) {
      assert.ok(!serialized.includes(record[field]), 'Allowed response leaked a foreign physical sentinel');
    }
  }
  return { expectedStatus: 200, returnedSentinels: seen.size };
}

const tokenOf = response => {
  assert.equal(response.status, 200); assert.equal(response.error, null);
  const token = response.data?.token ?? response.data?.access_token;
  assert.match(token ?? '', jwtPattern);
  return token;
};

export function verifyEditorBackendToken(token, now = Date.now()) {
  assert.match(token ?? '', jwtPattern);
  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
  assert.ok(Number.isSafeInteger(claims.iat) && Number.isSafeInteger(claims.exp));
  assert.equal(claims.exp - claims.iat, 20, 'The owned backend native twenty-second lifetime must remain unchanged');
  assert.equal(requiresFreshBackendLogin(token, now), false, 'Fresh native token must not be expired or near expiry');
  return true;
}

export async function runEditorRegistryChecks({
  context, contract, receipt, snapshot, send = ownedEditorRegistryRequest, record = async () => {},
  now = Date.now, allowPartial = false,
}) {
  validateMatrixFixture(context.manifest);
  validateEditorDatasetContract(contract);
  validateEditorSeedReceipt(context.manifest, contract, receipt, {
    deploymentInput: receipt.deploymentInput, sourceImages: receipt.sourceImages,
  }, { allowPartial });
  const activeDatasets = contract.datasets.filter(dataset =>
    receipt.records.some(item => item.entity === dataset.entity));
  const partial = receipt.status === 'partial-native-create-seeds-app-config-blocked';
  const report = {
    contract: 'owned-editor-registry-http-matrix-v1', runId: context.manifest.runId,
    status: 'running', checks: [], authentication: [], actors: [],
    boundedEditorDatasetReadAcceptance: false, boundedPartialEditorDatasetReadAcceptance: false,
    allFiveEditorDatasetReadAcceptance: false, nativeAcceptance: false, permissionAcceptance: false,
    testedEntities: activeDatasets.map(dataset => dataset.entity),
    blockedEntities: contract.datasets.filter(dataset => !activeDatasets.includes(dataset)).map(dataset => dataset.entity),
    expectedCheckCount: activeDatasets.length * 12,
    sourceClosureVerified: false, backendDataMutationsRequested: false, sourcePublishedFetchMethod: 'POST',
    unresolved: [
      `${partial ? 'Bounded four-entity READ checks use the explicit App-blocked partial seed; ' : 'Bounded five-entity READ checks only; '}native CREATE/REMOVE, browser behavior and complete permissions are separate evidence.`,
      'GET aliases, malformed contexts, grant rotation, disabled actors, restart durability and localization are not accepted here.',
    ],
  };
  let serial = 0;
  const auth = async (user, phase) => {
    const observe = async (id, spec, verify) => {
      context.guard();
      const result = await send(context, contract, spec);
      context.guard();
      const check = { id: `${user.loginname}-${phase}-${id}`, method: spec.method, path: spec.path,
        httpStatus: result.status, error: result.error, status: 'failed' };
      report.authentication.push(check);
      verify(result); check.status = 'passed';
      return result;
    };
    const uaa = await observe('uaa-login', { peer: 'uaa', method: 'POST', path: '/auths/login',
      data: { loginname: user.loginname, password: context.credentials.users[user.loginname], dc: user.centerId } },
    response => { tokenOf(response); verifyUAAIdentity(response.data.user, user); });
    const applicationContext = modelingContextFromIdentity(uaa.data.user, user);
    await observe('uaa-self', { peer: 'uaa', method: 'GET', path: '/auths/user-info/self', token: tokenOf(uaa) },
      response => { assert.equal(response.status, 200); assert.equal(response.error, null); verifyUAAIdentity(response.data, user); });
    const backend = await observe('backend-login', { peer: 'backend', method: 'POST', path: '/v7/login',
      data: { loginname: user.loginname, password: context.credentials.users[user.loginname] } }, tokenOf);
    const token = tokenOf(backend);
    verifyEditorBackendToken(token, now());
    await observe('backend-self', { peer: 'backend', method: 'GET', path: '/uaa/oauth/userinfo', token },
      response => { assert.equal(response.status, 200); assert.equal(response.error, null); assert.equal(response.data?.sub, user.loginname); });
    await observe('appdata', { peer: 'backend', method: 'GET', path: '/appdata', token, applicationContext },
      response => verifyModelingAppData(response, user, applicationContext));
    verifyEditorBackendToken(token, now());
    return { token, applicationContext };
  };
  try {
    const baseline = await snapshot();
    verifyEditorSeedSnapshot(context.manifest, contract, receipt, baseline);
    const users = ['editor', 'viewer', 'no-access'].flatMap(role => context.manifest.roots.map(root =>
      context.manifest.users.find(user => user.role === role && user.rootId === root.rootId)));
    for (const user of users) {
      let session = await auth(user, 'initial');
      let renewals = 0;
      for (const dataset of activeDatasets) for (const relation of ['own', 'foreign']) {
        const root = context.manifest.roots.find(root => relation === 'own' ? root.rootId === user.rootId : root.rootId !== user.rootId);
        const check = { id: `${user.loginname}-${dataset.entity}-${relation}`, actor: user.personId,
          role: user.role, entity: dataset.entity, relation, rootId: root.rootId, status: 'failed' };
        report.checks.push(check);
        let before = await snapshot();
        assert.deepEqual(before, baseline, 'Physical baseline drift before dataset request');
        if (requiresFreshBackendLogin(session.token, now())) {
          session = await auth(user, `renewal-${++renewals}`);
          before = await snapshot();
          assert.deepEqual(before, baseline, 'Normal login renewal must not mutate physical model data');
        }
        assert.equal(requiresFreshBackendLogin(session.token, now()), false,
          'No expired/near-expiry JWT may be sent; token lifetime is never changed');
        verifyEditorSeedSnapshot(context.manifest, contract, receipt, before);
        const spec = editorDatasetRequest(context.manifest, contract, dataset.entity, root.rootId,
          session.token, session.applicationContext);
        check.method = spec.method; check.path = spec.path;
        context.guard();
        const response = await send(context, contract, spec);
        context.guard();
        const after = await snapshot();
        check.evidence = await record(`${String(++serial).padStart(3, '0')}-dataset.private.json`,
          { request: { method: spec.method, path: spec.path, data: spec.data },
            response, before, after });
        Object.assign(check, { httpStatus: response.status, error: response.error,
          responseSha256: response.responseSha256 ?? hash(json(response.data ?? null)) });
        Object.assign(check, verifyEditorDatasetResponse(response, user, root, dataset, receipt, before, after));
        check.physicalColumnsUnchanged = true; check.status = 'passed';
      }
      report.actors.push({ personId: user.personId, role: user.role, rootId: user.rootId,
        centerId: user.centerId, normalLoginRenewals: renewals });
    }
    const final = await snapshot();
    assert.deepEqual(final, baseline, 'Final complete physical-column baseline must be unchanged');
    const expectedChecks = activeDatasets.length * 12;
    assert.equal(report.checks.length, expectedChecks);
    assert.equal(report.checks.filter(check => check.httpStatus === 200).length, activeDatasets.length * 4);
    assert.equal(report.checks.filter(check => check.httpStatus === 403).length, activeDatasets.length * 8);
    report.physicalModelsUnchanged = true;
    report.boundedEditorDatasetReadAcceptance = !partial;
    report.allFiveEditorDatasetReadAcceptance = !partial;
    report.boundedPartialEditorDatasetReadAcceptance = partial;
    report.status = partial ? 'passed-bounded-editor-dataset-reads-app-partial'
      : 'passed-bounded-editor-dataset-reads';
  } catch {
    report.status = 'failed-editor-dataset-reads';
    report.unresolved.push('Execution stopped at the first identity, seed, exact HTTP, physical snapshot or integrity failure; no acceptance.');
  }
  return report;
}

export function guardedEditorRuntime(context, bindings, directories) {
  const live = context.guard();
  for (const binding of bindings) {
    const file = readEditorBinding(directories, binding.parent, binding.name);
    assert.equal(hash(file.data), binding.sha256, 'Editor source/seed/evidence drift');
    if (binding.privateInput) {
      assert.equal(file.identity.uid, process.geteuid());
      assert.equal(file.identity.mode & 0o077, 0);
    }
  }
  return live;
}

function readEditorBinding(directories, parent, name) {
  if (name !== 'sCloud9471c1eca.sql') return readPinnedFile(directories, parent, name);
  directories.verify(parent);
  const path = directories.entry(parent, name);
  const before = fs.lstatSync(path);
  assert.ok(before.isFile() && !before.isSymbolicLink() && before.size <= 128 * 1024 * 1024);
  const descriptor = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const identity = fs.fstatSync(descriptor);
    assert.equal(identity.dev, before.dev); assert.equal(identity.ino, before.ino);
    const data = fs.readFileSync(descriptor);
    for (const current of [fs.fstatSync(descriptor), fs.lstatSync(path)]) {
      for (const field of ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs']) assert.equal(current[field], identity[field]);
    }
    directories.verify(parent);
    return { data, identity };
  } finally { fs.closeSync(descriptor); }
}

export async function executeOwnedEditorRegistryProbe({
  workspace = workspaceDefault, runId, deploymentInput, seedReceipt, seedReceiptSha256, label, execute = false,
  allowPartial = false,
}) {
  assert.equal(execute, true, 'Explicit owned editor registry execution is required');
  assert.match(runId ?? '', /^[a-f0-9]{12}$/);
  assert.match(label ?? '', /^[a-z0-9][a-z0-9-]{0,48}$/);
  assert.match(seedReceiptSha256 ?? '', /^[a-f0-9]{64}$/);
  workspace = resolve(workspace);
  const receiptPath = resolve(workspace, seedReceipt ?? '');
  const base = join(workspace, '.artifacts/native-nonadmin-fixtures', runId);
  inside(base, receiptPath);
  assert.ok(receiptPath.endsWith('.private.json'), 'The native seed receipt must be owner-private');
  const context = ownedNativeRuntimeContext({ workspace, runId, deploymentInput });
  const directories = new PinnedDirectories();
  const bindings = [];
  let output;
  let report;
  let stage = 'output';
  let sqlSerial = 0;
  const read = (path, privateInput = false) => {
    inside(workspace, path);
    const parent = directories.open(dirname(path));
    const name = basename(path);
    const file = readEditorBinding(directories, parent, name);
    if (privateInput) {
      assert.equal(file.identity.uid, process.geteuid());
      assert.equal(file.identity.mode & 0o077, 0);
    }
    bindings.push({ path, parent, name, privateInput, sha256: hash(file.data), bytes: file.data.length });
    return file.data;
  };
  const guard = () => guardedEditorRuntime(context, bindings, directories);
  const write = (name, value) => {
    const bytes = json(value);
    directories.write(output, name, bytes);
    return { path: join(output.path, name), sha256: hash(bytes), bytes: Buffer.byteLength(bytes) };
  };
  const sql = statement => {
    guard();
    const result = spawnSync('docker', ['exec', '-i', context.resources.mysqlId, 'sh', '-c',
      'test -n "$MYSQL_ROOT_PASSWORD" && MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -h127.0.0.1 --protocol=TCP -uroot --default-character-set=utf8mb4 --batch --raw --skip-column-names',
    ], { input: statement, encoding: 'utf8', timeout: 60_000, maxBuffer: 64 * 1024 * 1024 });
    write(`sql-${String(++sqlSerial).padStart(4, '0')}.private.json`, {
      statementSha256: hash(statement), exitCode: result.status, signal: result.signal,
      stdoutSha256: hash(result.stdout ?? ''), stderr: result.stderr ?? '',
    });
    assert.ok(result.status === 0 && !result.error && !result.signal, 'Owned read-only physical snapshot failed');
    guard();
    const lines = result.stdout.trim().split('\n').filter(Boolean);
    assert.ok(lines.length <= 100_000);
    return lines.map(line => JSON.parse(line));
  };
  try {
    output = directories.open(join(base, `editor-registry-${label}`), { create: true, exclusive: true });
    stage = 'source-and-seed-binding';
    for (const path of ['scripts/probe-owned-editor-registry-http.mjs', 'scripts/native-five-dataset-contract.mjs',
      'scripts/owned-native-runtime-context.mjs', 'scripts/owned-platform-http.mjs',
      'scripts/run-owned-native-permission-http.mjs']) read(join(workspace, path));
    const contract = readNativeFiveDatasetContract({ workspace });
    validateEditorDatasetContract(contract);
    for (const input of contract.inputs) {
      const bytes = read(join(workspace, input.path));
      assert.equal(hash(bytes), input.sha256, 'Reviewed five-dataset source binding changed');
    }
    const images = JSON.parse(read(resolve(workspace, context.deployment.imageReceipt.path)));
    assert.equal(bindings.at(-1).sha256, context.deployment.imageReceipt.sha256);
    const build = JSON.parse(read(resolve(workspace, images.packageReceipt.path)));
    assert.equal(bindings.at(-1).sha256, images.packageReceipt.sha256);
    assert.equal(build.status, 'passed-package-and-unit-only');
    for (const path of runtimeSources) {
      const bytes = read(join(build.worktree, path));
      assert.equal(hash(bytes), build.sourceInputs.before.entries.find(entry => entry.path === path)?.sha256,
        'Registry/access/lifecycle source must be an actual deployed source-built input');
      const liveSource = read(join(workspace, 'ibiz-service-hub', path));
      assert.equal(hash(liveSource), hash(bytes), 'Maintained runtime source must match the deployed source package');
    }
    const registry = bindings.find(binding => binding.path === join(build.worktree, runtimeSources[0]));
    assert.ok(registry);
    const registryBytes = read(join(build.worktree, runtimeSources[0])).toString('utf8');
    for (const entity of entities) {
      assert.ok(registryBytes.includes(`registerModel(${entity.toUpperCase()});`),
        'The deployed registry must contain all five explicit model registrations');
    }
    const receiptBytes = read(receiptPath, true);
    assert.equal(hash(receiptBytes), seedReceiptSha256);
    const receipt = JSON.parse(receiptBytes);
    const deploymentPath = resolve(workspace, deploymentInput);
    const deploymentBinding = context.bindings.find(binding => binding.path === deploymentPath);
    assert.ok(deploymentBinding);
    validateEditorSeedReceipt(context.manifest, contract, receipt, {
      deploymentInput: { path: deploymentBinding.path, sha256: deploymentBinding.sha256 },
      sourceImages: context.deployment.imageReceipt,
    }, { allowPartial });
    for (const seed of receipt.records) {
      const path = resolve(workspace, seed.createEvidence.path);
      inside(base, path);
      assert.ok(path.endsWith('.private.json'));
      const bytes = read(path, true);
      assert.equal(hash(bytes), seed.createEvidence.sha256);
      verifyEditorCreateEvidence(context.manifest, contract, seed, JSON.parse(bytes));
    }
    stage = 'complete-physical-inventory';
    const inventorySQL = editorPhysicalInventorySQL(context.manifest);
    const inventory = sql(inventorySQL);
    const targets = validateEditorPhysicalInventory(context.manifest, contract, inventory);
    const snapshotSQL = editorPhysicalSnapshotSQL(targets);
    const snapshot = () => {
      const current = sql(inventorySQL);
      assert.deepEqual(current, inventory, 'Any physical schema drift invalidates the snapshot');
      return normalizeEditorPhysicalSnapshot(inventory, targets, sql(snapshotSQL));
    };
    stage = 'native-five-entity-six-actor-own-foreign-http';
    report = await runEditorRegistryChecks({
      context: { ...context, guard }, contract, receipt, snapshot,
      record: async (name, value) => write(name, value),
      allowPartial,
    });
    guard();
    report.sourceContract = write('source-contract.json', contract);
    report.inputs = [...context.bindings, ...bindings.map(({ parent, name, privateInput, ...binding }) => binding)];
    report.seedReceipt = { path: receiptPath, sha256: seedReceiptSha256 };
    report.physicalSnapshotCoverage = {
      schemas: context.manifest.roots.map(root => root.database), tables: targets.length,
      columns: inventory.length, encoding: 'every-physical-column-null-or-hex-cast-binary-v1',
      everyDatasetRequestBeforeAndAfter: true, emptyTablesIncludedInInventory: true,
    };
    report.stage = 'complete';
  } catch {
    report ??= { contract: 'owned-editor-registry-http-matrix-v1', runId, checks: [], authentication: [], actors: [],
      nativeAcceptance: false, permissionAcceptance: false, sourceClosureVerified: false, unresolved: [] };
    report.status = 'failed-editor-dataset-reads';
    report.boundedEditorDatasetReadAcceptance = false;
    report.stage = stage;
    report.unresolved.push('Source/runtime/seed/full-column integrity gate failed; no acceptance and no data mutation requested.');
  } finally {
    if (output) {
      report.completedAt = new Date().toISOString();
      write('report.json', report);
    }
    directories.close(); context.close();
  }
  return { report, reportPath: join(output.path, 'report.json') };
}

export async function main(argv = process.argv.slice(2)) {
  const options = {};
  for (const argument of argv) {
    if (argument === '--execute-owned-editor-registry') {
      assert.ok(!options.execute); options.execute = true; continue;
    }
    const match = /^--(run-id|deployment-input|seed-receipt|seed-receipt-sha256|label)=(.+)$/.exec(argument);
    if (match) {
      assert.ok(!Object.hasOwn(options, match[1]), 'Only explicit nonduplicate owned options are allowed');
      options[match[1]] = match[2];
      continue;
    }
    if (argument === '--allow-partial') {
      assert.ok(!options.allowPartial); options.allowPartial = true; continue;
    }
    assert.fail('Unknown owned editor registry option');
  }
  const result = await executeOwnedEditorRegistryProbe({
    runId: options['run-id'], deploymentInput: options['deployment-input'], seedReceipt: options['seed-receipt'],
    seedReceiptSha256: options['seed-receipt-sha256'], label: options.label, execute: options.execute ?? false,
    allowPartial: options.allowPartial ?? false,
  });
  console.log(json({ reportPath: result.reportPath, status: result.report.status, checks: result.report.checks.length,
    boundedAcceptance: result.report.boundedEditorDatasetReadAcceptance }));
  if (!result.report.boundedEditorDatasetReadAcceptance
    && !result.report.boundedPartialEditorDatasetReadAcceptance) process.exitCode = 1;
  return result;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(() => {
    console.error('Owned editor registry verification refused; private details suppressed.');
    process.exitCode = 1;
  });
}
