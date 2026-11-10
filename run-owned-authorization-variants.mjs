#!/usr/bin/env node

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { PinnedDirectories, readPinnedFile } from './native-candidate-files.mjs';
import { ownedNativeRuntimeContext } from './owned-native-runtime-context.mjs';
import {
  createAuthorizationVariantPlan, executeAuthorizationVariants, grantCompareAndSetSQL,
  grantSelectSQL, validateGrantSnapshot,
} from './owned-authorization-variants.mjs';
import { validateMatrixFixture } from './prepare-run-owned-native-nonadmin-matrix.mjs';
import { request, requiresFreshBackendLogin } from './run-owned-native-permission-http.mjs';

const workspaceRoot = fileURLToPath(new URL('../', import.meta.url));
const hash = value => createHash('sha256').update(value).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const jwt = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/;
const sourceFiles = [
  'scripts/run-owned-authorization-variants.mjs',
  'scripts/owned-authorization-variants.mjs',
  'scripts/owned-native-runtime-context.mjs',
  'scripts/run-owned-native-permission-http.mjs',
  'scripts/prepare-run-owned-native-nonadmin-matrix.mjs',
];

const identifier = value => {
  assert.match(value, /^[A-Za-z][A-Za-z0-9_]*$/);
  return `\`${value}\``;
};
const text = value => {
  assert.equal(typeof value, 'string');
  assert.ok(!/[\u0000\r\n]/.test(value));
  return `CONVERT(0x${Buffer.from(value).toString('hex')} USING utf8mb4)`;
};

function tables(manifest) {
  validateMatrixFixture(manifest);
  return [
    { database: manifest.schemas.metadata, table: 't_srfpsdevslnuser', key: 'PSDEVSLNUSERID' },
    ...manifest.roots.flatMap(root => [
      { database: root.database, table: 't_srfpsmodule', key: 'PSMODULEID' },
      { database: root.database, table: 't_srfpssystem', key: 'PSSYSTEMID' },
    ]),
  ];
}

export function authorizationInventorySQL(manifest) {
  return tables(manifest).map(({ database, table }) =>
    "SELECT JSON_OBJECT('database',TABLE_SCHEMA,'table',TABLE_NAME,'column',COLUMN_NAME,"
    + "'type',DATA_TYPE,'ordinal',ORDINAL_POSITION,'key',COLUMN_KEY) FROM INFORMATION_SCHEMA.COLUMNS WHERE "
    + `TABLE_SCHEMA=${text(database)} AND TABLE_NAME=${text(table)} ORDER BY ORDINAL_POSITION;`).join('\n') + '\n';
}

export function validateAuthorizationInventory(manifest, rows) {
  const targets = tables(manifest);
  assert.ok(Array.isArray(rows) && rows.length > 0);
  assert.ok(rows.every(row => targets.some(target => target.database === row.database && target.table === row.table)),
    'Column inventory may contain only the five declared owned tables');
  const result = { grantColumns: [], modelColumns: {} };
  for (const target of targets) {
    const columns = rows.filter(row => row.database === target.database && row.table === target.table);
    assert.ok(columns.length > 0);
    assert.equal(new Set(columns.map(row => row.column.toUpperCase())).size, columns.length);
    assert.deepEqual(columns.map(row => row.ordinal), columns.map((_, index) => index + 1));
    for (const column of columns) {
      identifier(column.column);
      assert.match(column.type, /^[a-z0-9]+$/);
    }
    assert.deepEqual(columns.filter(row => row.key === 'PRI').map(row => row.column.toUpperCase()), [target.key],
      'Exactly the declared original primary key is required');
    const names = columns.map(row => row.column.toUpperCase());
    if (target.table === 't_srfpsdevslnuser') {
      for (const name of ['PSDEVSLNUSERID', 'PSDEVSLNID', 'PSDEVSLNSYSID', 'PSDEVUSEROBJID', 'ALLSYSFLAG', 'ACCMODE', 'EXPIREDTIME']) {
        assert.ok(names.includes(name));
      }
      assert.ok(['datetime', 'timestamp'].includes(columns.find(row => row.column.toUpperCase() === 'EXPIREDTIME').type));
      result.grantColumns = names;
    } else {
      result.modelColumns[target.database] ??= {};
      result.modelColumns[target.database][target.table] = names;
    }
  }
  return result;
}

export function authorizationModelSnapshotSQL(manifest, inventory) {
  return tables(manifest).filter(target => target.table !== 't_srfpsdevslnuser').map(target => {
    const columns = inventory.modelColumns[target.database]?.[target.table];
    assert.ok(Array.isArray(columns) && columns.length);
    const fields = columns.map(column => `${text(column)},${identifier(column)}`).join(',');
    return `SELECT JSON_OBJECT('database',${text(target.database)},'table',${text(target.table)},`
      + `'row',JSON_OBJECT(${fields})) FROM ${identifier(target.database)}.${identifier(target.table)} `
      + `ORDER BY ${identifier(target.key)};`;
  }).join('\n') + '\n';
}

function parseJSONRows(output) {
  const value = output.trim();
  if (!value) return [];
  const lines = value.split('\n');
  assert.ok(lines.length <= 20_000);
  return lines.map(line => JSON.parse(line));
}

function normalizeExpiry(row) {
  return { ...row, EXPIREDTIME: row.EXPIREDTIME?.replace(/\.0{1,6}$/, '') ?? null };
}

function journalMutation(manifest, plan, inventory, name, bytes, originals) {
  if (!name.includes('pending-grant-update') && !name.includes('pending-grant-restore')) return [];
  const entry = JSON.parse(bytes);
  const item = plan.cases.find(item => item.id === entry.caseId);
  assert.ok(item, 'Only canonical case-owned grant journals are executable');
  const original = entry.original;
  validateGrantSnapshot(manifest, item.target, original, { original: true });
  assert.deepEqual(Object.keys(original).sort(), [...inventory.grantColumns].sort());
  if (name.includes('pending-grant-update')) {
    assert.deepEqual(entry.target, item.target);
    const expected = { ...original, ACCMODE: item.variant.accessMode, EXPIREDTIME: item.variant.expiredTime };
    assert.deepEqual(entry.intended, expected);
    assert.equal(entry.updateSQL, grantCompareAndSetSQL(manifest, item.target, original, expected));
    assert.equal(entry.restoreSQL, grantCompareAndSetSQL(manifest, item.target, expected, original));
    assert.ok(!originals.has(item.id), 'Each case may register only one original grant journal');
    return [
      { sql: entry.updateSQL, item, original, before: original, after: expected, kind: 'update' },
      { sql: entry.restoreSQL, item, original, before: expected, after: original, kind: 'restore' },
    ];
  }
  assert.deepEqual(original, originals.get(item.id), 'Restore must use the already-journaled original bytes');
  validateGrantSnapshot(manifest, item.target, entry.current);
  const intended = { ...original, ACCMODE: item.variant.accessMode, EXPIREDTIME: item.variant.expiredTime };
  assert.ok(isDeepStrictEqual(normalizeExpiry(entry.current), normalizeExpiry(intended)),
    'Unrecognized concurrent changes cannot be registered for restoration');
  assert.equal(entry.restoreSQL, grantCompareAndSetSQL(manifest, item.target, entry.current, original));
  return [{ sql: entry.restoreSQL, item, original, before: entry.current, after: original, kind: 'restore' }];
}

export function validateAuthorizationHTTP(manifest, origins, suppliedOrigin, spec, token, sessions, credentials) {
  validateMatrixFixture(manifest);
  assert.ok(spec && typeof spec === 'object' && !Array.isArray(spec));
  assert.ok(Object.keys(spec).every(key => ['method', 'path', 'data', 'applicationContext'].includes(key)),
    'Arbitrary HTTP headers/options are forbidden');
  const loginPeer = spec.path === '/auths/login' ? 'uaa' : spec.path === '/v7/login' ? 'backend' : null;
  if (loginPeer) {
    assert.equal(suppliedOrigin, origins[loginPeer]);
    assert.equal(spec.method, 'POST');
    assert.equal(token, undefined);
    assert.equal(spec.applicationContext, undefined);
    const expectedKeys = loginPeer === 'uaa' ? ['dc', 'loginname', 'password'] : ['loginname', 'password'];
    assert.deepEqual(Object.keys(spec.data ?? {}).sort(), expectedKeys);
    const user = manifest.users.find(user => user.loginname === spec.data.loginname && user.role === 'editor');
    assert.ok(user && user.administrator === false);
    assert.equal(spec.data.password, credentials.users[user.loginname]);
    if (loginPeer === 'uaa') assert.equal(spec.data.dc, user.centerId);
    return { peer: loginPeer, user, login: true };
  }
  assert.match(token ?? '', jwt);
  const session = sessions.get(token);
  assert.ok(session, 'Only tokens from this guarded adapter login are accepted');
  if (spec.path === '/auths/user-info/self') {
    assert.equal(session.peer, 'uaa');
    assert.equal(suppliedOrigin, origins.uaa);
    assert.equal(spec.method, 'GET');
    assert.equal(spec.data, undefined);
    assert.equal(spec.applicationContext, undefined);
    return { ...session, login: false };
  }
  assert.equal(session.peer, 'backend');
  assert.equal(suppliedOrigin, origins.backend);
  if (spec.path === '/uaa/oauth/userinfo') {
    assert.equal(spec.method, 'GET');
    assert.equal(spec.data, undefined);
    assert.equal(spec.applicationContext, undefined);
    return { ...session, login: false };
  }
  assert.deepEqual(spec.applicationContext, {
    system: 'ibizmodeling', organization: `${session.user.centerId}_org`,
  });
  if (spec.path === '/appdata') {
    assert.equal(spec.method, 'GET');
    assert.equal(spec.data, undefined);
    return { ...session, login: false };
  }
  const root = manifest.roots.find(root =>
    spec.path === `/api/ibizmodeling__modeldesign/psdevslnsys/${root.rootId}/psmodules`
    || spec.path.startsWith(`/api/ibizmodeling__modeldesign/psdevslnsys/${root.rootId}/psmodules/`));
  assert.ok(root, 'Only the exact declared parent-URL roots are allowed');
  const collection = `/api/ibizmodeling__modeldesign/psdevslnsys/${root.rootId}/psmodules`;
  if (spec.path === collection) assert.equal(spec.method, 'POST');
  else if (spec.path === `${collection}/fetchcursys`) assert.equal(spec.method, 'POST');
  else {
    assert.equal(spec.path, `${collection}/${root.sentinelId}`, 'No arbitrary module IDs may be requested');
    assert.ok(['GET', 'PUT', 'DELETE'].includes(spec.method));
  }
  if (spec.method === 'GET' || spec.method === 'DELETE') assert.equal(spec.data, undefined);
  else {
    assert.ok(spec.data && typeof spec.data === 'object' && !Array.isArray(spec.data));
    assert.equal(spec.data.pssystemid, root.logicalSystemId);
    if (spec.path === `${collection}/fetchcursys`) {
      assert.equal(spec.data.size, 1000);
      if (Object.keys(spec.data).length === 2) {
        assert.deepEqual(Object.keys(spec.data).sort(), ['pssystemid', 'size']);
      } else {
        assert.deepEqual(Object.keys(spec.data).sort(), ['codename', 'modtag', 'psmoduleid', 'psmodulename', 'pssystemid', 'size']);
        assert.equal(spec.data.psmoduleid, root.sentinelId);
        assert.equal(spec.data.codename, 'DeniedGrantVariant');
        assert.equal(spec.data.modtag, `nf_${manifest.runId}_denied`);
        assert.ok(planCaseNames(manifest).some(id => spec.data.psmodulename === `Denied grant variant ${id}`));
      }
    } else {
      assert.deepEqual(Object.keys(spec.data).sort(), ['codename', 'modtag', 'psmoduleid', 'psmodulename', 'pssystemid']);
      assert.equal(spec.data.psmoduleid, spec.method === 'POST' ? `nf_${manifest.runId}_denied_${root.side}` : root.sentinelId);
      assert.equal(spec.data.codename, 'DeniedGrantVariant');
      assert.equal(spec.data.modtag, `nf_${manifest.runId}_denied`);
      assert.ok(planCaseNames(manifest).some(id => spec.data.psmodulename === `Denied grant variant ${id}`));
    }
  }
  return { ...session, login: false };
}

function planCaseNames(manifest) {
  return createAuthorizationVariantPlan(manifest).cases.map(item => item.id);
}

export function createOwnedAuthorizationIO({
  context, workspace, output, execute = spawnSync, send = request,
  sleep = ms => new Promise(resolve => setTimeout(resolve, ms)),
  allowOwnedGrantMutations = false,
}) {
  assert.equal(allowOwnedGrantMutations, true, 'Live IO requires the explicit owned grant mutation opt-in');
  validateMatrixFixture(context.manifest);
  assert.equal(output, join(context.base, output.split('/').at(-1)));
  assert.match(output.split('/').at(-1), /^authorization-http-[a-z0-9][a-z0-9-]{0,48}$/);
  const directories = new PinnedDirectories();
  const plan = createAuthorizationVariantPlan(context.manifest);
  let sources = [];
  let destination;
  const allowedSQL = new Map();
  const executedSQL = new Set();
  const originals = new Map();
  const sessions = new Map();
  const backendTokenHashes = new Set();
  let httpSerial = 0;
  let sqlSerial = 0;
  let origins;
  const guard = () => {
    const live = context.guard();
    assert.deepEqual(live.origins, origins, 'Owned endpoint binding drift');
    for (const source of sources) {
      const file = readPinnedFile(directories, source.parent, source.name);
      assert.equal(hash(file.data), source.sha256, 'Authorization runner source drift');
    }
    return live;
  };
  const write = (name, bytes) => {
    directories.verify(destination);
    const identity = directories.write(destination, name, bytes);
    const file = readPinnedFile(directories, destination, name, identity);
    assert.equal(hash(file.data), hash(bytes));
    const descriptor = fs.openSync(directories.entry(destination, name),
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
    fs.fsyncSync(destination.descriptor);
    directories.verify(destination);
    return { path: join(output, name), bytes: file.data.length, sha256: hash(file.data) };
  };
  const rootSQL = sql => {
    guard();
    const args = ['exec', '-i', context.resources.mysqlId, 'sh', '-c',
      'test -n "$MYSQL_ROOT_PASSWORD" && MYSQL_PWD="$MYSQL_ROOT_PASSWORD" exec mysql -h127.0.0.1 --protocol=TCP -uroot --default-character-set=utf8mb4 --batch --raw --skip-column-names'];
    const result = execute('docker', args, {
      input: sql, encoding: 'utf8', timeout: 30_000, maxBuffer: 32 * 1024 * 1024,
    });
    const artifact = write(`adapter-${String(++sqlSerial).padStart(4, '0')}-sql.private.json`, json({
      operationSha256: hash(sql), mysqlId: context.resources.mysqlId,
      exitStatus: result.status, signal: result.signal ?? null,
      stdoutSha256: hash(result.stdout ?? ''), stderrSha256: hash(result.stderr ?? ''),
    }));
    assert.ok(result.status === 0 && !result.error && !result.signal,
      `Owned SQL failed; inspect owner-private adapter receipt ${artifact.path}`);
    guard();
    return result.stdout;
  };
  try {
    sources = sourceFiles.map(path => {
      const absolute = join(workspace, path);
      const parent = directories.open(dirname(absolute));
      const file = readPinnedFile(directories, parent, path.split('/').at(-1));
      return { path: absolute, parent, name: path.split('/').at(-1), sha256: hash(file.data) };
    });
    origins = structuredClone(context.guard().origins);
    destination = directories.open(output, { create: true, exclusive: true });
    const inventoryRows = parseJSONRows(rootSQL(authorizationInventorySQL(context.manifest)));
    const inventory = validateAuthorizationInventory(context.manifest, inventoryRows);
    write('adapter-column-inventory.private.json', json(inventoryRows));
    write('adapter-inputs.private.json', json({
      contract: 'owned-authorization-variants-io-v1', runId: context.manifest.runId,
      inputs: context.bindings, sources: sources.map(({ path, sha256 }) => ({ path, sha256 })),
      topologyWitnessSha256: hash(json(context.witness)), origins,
    }));
    const snapshotSQL = authorizationModelSnapshotSQL(context.manifest, inventory);
    return {
      plan, output, inventory, sources: sources.map(({ path, sha256 }) => ({ path, sha256 })),
      io: {
        endpoints: origins, ...inventory, preflight: guard,
        readGrant(target) {
          const rows = parseJSONRows(rootSQL(grantSelectSQL(context.manifest, target, inventory.grantColumns)));
          assert.equal(rows.length, 1, 'Exactly one full-column grant row is required');
          validateGrantSnapshot(context.manifest, target, rows[0]);
          return rows[0];
        },
        executeSQL(sql) {
          assert.equal(typeof sql, 'string');
          const registered = allowedSQL.get(sql);
          assert.ok(registered && !executedSQL.has(sql),
            'Only one execution of exact durably journaled owned CAS SQL is allowed');
          executedSQL.add(sql);
          const output = rootSQL(sql).trim();
          assert.match(output, /^[01]$/, 'Grant CAS must return exactly one numeric ROW_COUNT result');
          return Number(output);
        },
        snapshotModels() { return parseJSONRows(rootSQL(snapshotSQL)); },
        tokenRequiresFreshLogin(token) {
          assert.ok(sessions.has(token) && sessions.get(token).peer === 'backend');
          return requiresFreshBackendLogin(token, Date.now() + 5000);
        },
        persist(name, bytes) {
          assert.match(name, /^[0-9]{3,}-[a-z0-9-]+\.private\.json$/);
          assert.equal(typeof bytes, 'string');
          const mutations = journalMutation(context.manifest, plan, inventory, name, bytes, originals);
          guard();
          const artifact = write(name, bytes);
          for (const mutation of mutations) {
            assert.ok(!executedSQL.has(mutation.sql), 'Executed CAS statements cannot be rearmed');
            const previous = allowedSQL.get(mutation.sql);
            if (previous) assert.equal(previous.item.id, mutation.item.id);
            allowedSQL.set(mutation.sql, mutation);
            if (mutation.kind === 'update') originals.set(mutation.item.id, mutation.original);
          }
          return artifact;
        },
        async request(origin, spec, token) {
          let last;
          for (let attempt = 0; attempt < 3; attempt++) {
            const live = guard();
            const binding = validateAuthorizationHTTP(context.manifest, live.origins, origin, spec, token, sessions, context.credentials);
            last = await send(origin, spec, token);
            guard();
            write(`adapter-${String(++httpSerial).padStart(4, '0')}-http.private.json`, json({
              peer: binding.peer, path: spec.path, method: spec.method, attempt,
              authenticatedTokenSha256: token ? hash(token) : null,
              httpStatus: last.status, error: last.error,
              parsedResponseSha256: hash(json(last.data ?? null)),
            }));
            const next = last.data?.token ?? last.data?.access_token;
            if (binding.login && last.status === 200 && last.error === null && typeof next === 'string') {
              assert.match(next, jwt);
              if (binding.peer === 'backend') {
                if (backendTokenHashes.has(hash(next))) {
                  assert.ok(attempt < 2, 'Normal owned login could not issue distinct token bytes');
                  await sleep(1100);
                  continue;
                }
                backendTokenHashes.add(hash(next));
              }
              sessions.set(next, { peer: binding.peer, user: binding.user });
            }
            return last;
          }
          return last;
        },
      },
      writeReport(value) { guard(); return write('report.json', json(value)); },
      close() { directories.close(); },
    };
  } catch {
    directories.close();
    throw new Error('Owned authorization IO refused; private details suppressed');
  }
}

export async function executeOwnedAuthorizationVariants({
  workspace = workspaceRoot, runId, deploymentInput, label,
  executeOwnedAuthorizationVariants: executeOptIn = false, allowOwnedGrantMutations = false,
}) {
  assert.equal(executeOptIn, true, 'Explicit owned authorization execution opt-in is required');
  assert.equal(allowOwnedGrantMutations, true, 'Explicit owned grant mutation opt-in is required');
  assert.match(label ?? '', /^[a-z0-9][a-z0-9-]{0,48}$/);
  const context = ownedNativeRuntimeContext({ workspace, runId, deploymentInput });
  let adapter;
  try {
    adapter = createOwnedAuthorizationIO({
      context, workspace, output: join(context.base, `authorization-http-${label}`),
      allowOwnedGrantMutations: true,
    });
    const candidate = await executeAuthorizationVariants({
      manifest: context.manifest, credentials: context.credentials, plan: adapter.plan, io: adapter.io,
      allowOwnedGrantMutations: true,
    });
    const passed = candidate.status === 'passed-adapter-candidate-observations'
      && candidate.freshTokenGrantRotationVerified;
    const report = {
      contract: 'owned-authorization-grant-variants-live-http-v1',
      runId, label, completedAt: new Date().toISOString(),
      status: passed ? 'passed-bounded-owned-grant-variants' : 'failed-owned-grant-variants',
      boundedGrantVariantsVerified: passed, freshTokenGrantRotationVerified: passed,
      nativeAcceptance: false, permissionAcceptance: false, sourceNativeAcceptance: false,
      sameTokenCacheRevocationVerified: false, sessionHolderFramesVerified: false,
      sharedServicesChanged: false, inputs: context.bindings, sources: adapter.sources,
      candidate, boundary: 'Only the eight ordinary-editor grant variants in this exact owned scenario; not full permission/source/browser/release acceptance',
    };
    return { report, reportPath: adapter.writeReport(report).path };
  } finally {
    adapter?.close();
    context.close();
  }
}

export async function main(argv = process.argv.slice(2)) {
  const options = {};
  for (const arg of argv) {
    if (arg === '--execute-owned-authorization-variants') {
      assert.ok(!options.execute); options.execute = true; continue;
    }
    if (arg === '--allow-owned-grant-mutations') {
      assert.ok(!options.mutations); options.mutations = true; continue;
    }
    const match = /^--(run-id|deployment-input|label)=(.+)$/.exec(arg);
    assert.ok(match && !Object.hasOwn(options, match[1]), 'Explicit non-duplicate owned options are required');
    options[match[1]] = match[2];
  }
  const result = await executeOwnedAuthorizationVariants({
    runId: options['run-id'], deploymentInput: options['deployment-input'], label: options.label,
    executeOwnedAuthorizationVariants: options.execute ?? false,
    allowOwnedGrantMutations: options.mutations ?? false,
  });
  console.log(json({
    reportPath: result.reportPath, status: result.report.status,
    checks: result.report.candidate.checks.length, nativeAcceptance: false,
  }));
  if (!result.report.boundedGrantVariantsVerified) process.exitCode = 1;
  return result;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(() => {
    console.error('Owned authorization run failed; private credential-bearing diagnostics are suppressed.');
    process.exitCode = 1;
  });
}
