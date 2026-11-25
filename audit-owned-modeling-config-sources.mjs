#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { readOwnedModelingConfigPolicy } from './owned-modeling-config-policy.mjs';

const workspaceDefault = resolve(new URL('../', import.meta.url).pathname);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const configTables = ['t_srfpspf', 't_srfpspfstyle', 't_srfpsapptype'];
const configEntities = ['PSPF', 'PSPFStyle', 'PSAppType'];

function safeRead(path) {
  for (let directory = dirname(resolve(path)); ; directory = dirname(directory)) {
    const stat = fs.lstatSync(directory);
    assert.ok(stat.isDirectory() && !stat.isSymbolicLink(),
      'Configuration source ancestry must not contain symlinks');
    if (dirname(directory) === directory) break;
  }
  const info = fs.lstatSync(path);
  assert.ok(info.isFile() && !info.isSymbolicLink() && info.size <= 128 * 1024 * 1024);
  const descriptor = fs.openSync(path, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(descriptor);
    assert.equal(opened.dev, info.dev);
    assert.equal(opened.ino, info.ino);
    const bytes = fs.readFileSync(descriptor);
    for (const current of [fs.fstatSync(descriptor), fs.lstatSync(path)]) {
      for (const key of ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs']) {
        assert.equal(current[key], opened[key], 'Configuration source changed during inspection');
      }
    }
    assert.equal(bytes.length, opened.size);
    return { bytes, sha256: hash(bytes) };
  } finally { fs.closeSync(descriptor); }
}

function tableInsertCounts(text) {
  return Object.fromEntries(configTables.map(table => [
    table, (text.match(new RegExp(
      '(?:INSERT\\s+INTO|LOCK\\s+TABLES)\\s+' +
      '(?:(?:`[^`]+`|[A-Za-z0-9_$-]+)\\s*\\.\\s*)?' +
      '(?:`?' + table.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '`?)' +
      '(?=\\s|\\(|$)',
      'gi',
    )) ?? []).length,
  ]));
}

function scanOwnedSeedFiles(base) {
  const entries = [];
  if (!fs.existsSync(base)) return entries;
  for (const runId of fs.readdirSync(base).filter(name => /^[a-f0-9]{12}$/.test(name))) {
    const path = join(base, runId, '01-seed.private.sql');
    if (!fs.existsSync(path)) continue;
    const { bytes, sha256 } = safeRead(path);
    const counts = tableInsertCounts(bytes.toString('utf8'));
    entries.push({
      runId, path: path.replace(`${resolve(base, '..', '..')}/`, ''),
      bytes: bytes.length, sha256, tableInsertCounts: counts,
      eligible: false,
      reason: 'Owned nonadmin seed contract excludes global PSPF/PSPFStyle/PSAppType configuration rows',
    });
  }
  return entries.sort((a, b) => a.runId.localeCompare(b.runId));
}

export function assessModelingConfigReadEvidence(value, runId) {
  const reasons = [];
  if (value?.contract !== 'owned-editor-config-read-v1') reasons.push('wrong-contract');
  if (value?.runId !== runId) reasons.push('wrong-run');
  if (value?.status !== 'passed-authenticated-config-route-read') reasons.push('read-not-passed');
  if (!value?.checks || !configEntities.every(entity => Object.hasOwn(value.checks, entity))
    || Object.keys(value.checks ?? {}).length !== configEntities.length) reasons.push('incomplete-entities');
  for (const entity of configEntities) {
    const check = value?.checks?.[entity];
    if (check?.status !== 200 || !Number.isSafeInteger(check?.rows) || check.rows < 0
      || !/^[a-f0-9]{64}$/.test(check?.responseSha256 ?? '')) reasons.push(`invalid-read-${entity}`);
  }
  return { valid: reasons.length === 0, empty: reasons.length === 0
    && configEntities.every(entity => value.checks[entity].rows === 0), reasons,
  liveRuntimeVerified: false, evidenceKind: 'historical-source-bound-report-only' };
}

function scanCurrentReports(base, runId) {
  const root = join(base, runId);
  const reports = [];
  if (!fs.existsSync(root)) return reports;
  for (const name of fs.readdirSync(root).sort()) {
    if (!/^(?:editor-config|modeling-config-blocked)-[A-Za-z0-9-]+$/.test(name)) continue;
    const directory = fs.lstatSync(join(root, name));
    assert.ok(directory.isDirectory() && !directory.isSymbolicLink(),
      'Configuration evidence directories must not be symlinks');
    const path = join(root, name, 'report.json');
    if (!fs.existsSync(path)) continue;
    const { bytes, sha256 } = safeRead(path);
    let value;
    try { value = JSON.parse(bytes); } catch { continue; }
    reports.push({
      path: path.replace(`${resolve(base, '..', '..')}/`, ''), sha256, bytes: bytes.length,
      contract: value.contract, status: value.status, runId: value.runId ?? null,
      evidence: assessModelingConfigReadEvidence(value, runId),
      configRows: value.checks ? Object.fromEntries(Object.entries(value.checks)
        .filter(([entity]) => configTables.some(table => entity.toLowerCase().includes(table.slice(5))))
        .map(([entity, check]) => [entity, { status: check?.status, rows: check?.rows }])) : undefined,
      sqlMutation: value.sqlMutation ?? null, nativeCreateExecuted: value.nativeCreateExecuted ?? null,
    });
  }
  return reports;
}

export function auditOwnedModelingConfigSources({
  workspace = workspaceDefault, runId = '25dd6a7232c7',
} = {}) {
  workspace = resolve(workspace);
  assert.match(runId, /^[a-f0-9]{12}$/);
  const base = join(workspace, '.artifacts/native-nonadmin-fixtures');
  const sharedSources = ['modelingservice/sql/init.sql', 'modelingservice/sql/sCloud9471c1eca.sql']
    .map(path => {
      const source = safeRead(join(workspace, path));
      return {
        path, bytes: source.bytes.length, sha256: source.sha256,
        tableInsertCounts: tableInsertCounts(source.bytes.toString('utf8')),
        countMeaning: 'INSERT/LOCK statement mentions, not persisted row counts or coherent configuration triples',
        eligible: false, ownershipVerified: false, licenseVerified: false,
        nativeImportPathVerified: false, rowValuesExported: false,
        reason: 'Shared historical development SQL; never copied into owned fixture',
      };
    });
  const runtimePolicy = readOwnedModelingConfigPolicy({
    read: path => safeRead(join(workspace, path)).bytes,
  });
  const ownedSeeds = scanOwnedSeedFiles(base);
  const reports = scanCurrentReports(base, runId);
  const reads = reports.filter(row => row.evidence.valid);
  const conflictingReads = reads.length > 1 && reads.some(row =>
    JSON.stringify(row.configRows) !== JSON.stringify(reads[0].configRows));
  const emptyReadEstablished = reads.length > 0 && !conflictingReads
    && reads.every(row => row.evidence.empty);
  const sourceModelPaths = [
    'vendor-upstream/ibizmodeling-standard/modelapi-core/src/main/resources/model/net/ibizsys/modeling/PSSYSSERVICEAPIS/ModelAPI.json',
    'vendor-upstream/ibizmodeling-standard/modelapi-core/src/main/resources/model/net/ibizsys/modeling/PSMODULES/Config/PSDATAENTITIES/PSPF.json',
    'vendor-upstream/ibizmodeling-standard/modelapi-core/src/main/resources/model/net/ibizsys/modeling/PSMODULES/Config/PSDATAENTITIES/PSPFStyle.json',
    'vendor-upstream/ibizmodeling-standard/modelapi-core/src/main/resources/model/net/ibizsys/modeling/PSMODULES/Config/PSDATAENTITIES/PSAppType.json',
  ];
  const sourceModels = sourceModelPaths.map(path => {
    const file = safeRead(join(workspace, path));
    return { path, bytes: file.bytes.length, sha256: file.sha256, rows: null,
      eligible: false, reason: 'Model metadata only; no persisted configuration rows' };
  });
  return {
    contract: 'owned-modeling-config-source-audit-v1', runId,
    status: emptyReadEstablished
      ? 'blocked-no-owned-config-rows' : 'blocked-source-not-owned',
    inspectedAt: new Date().toISOString(),
    sharedInit: sharedSources[0],
    sharedSources,
    ownedSeedFiles: ownedSeeds,
    currentOwnedReports: reports,
    historicalReadEvidence: { validReports: reads.length, conflictingReads,
      emptyReadEstablished, liveRuntimeVerified: false },
    sourceModels, runtimePolicy,
    decision: {
      ownedRowsAvailable: false,
      nativeConfigCreateExecuted: false,
      sqlMutation: false,
      appCreateUnblocked: false,
      reasons: [
        'No source-bound PSPF/PSPFStyle/PSAppType row receipt exists in this owned fixture; shared current configuration is a separate scope',
        'Historical SQL statement presence is not ownership, license, coherent-row or native-import approval',
        emptyReadEstablished
          ? 'The validated historical owned report records authenticated 200 responses with zero rows; it is not a current runtime read'
          : 'No complete empty-config read report is established for this run; source audit is not a live database result',
        'Default configuration record policy denies CREATE/UPDATE/DELETE, including administrators',
      ],
      repair: [
        'Verify the exact non-parent owned POST FetchDefault routes and retain route readback',
        'Establish a reviewed configuration source and legitimate maintenance/import path before any configuration mutation',
        'Fetch actual coherent PSPF/PSPFStyle/PSAppType rows under ordinary owned editor',
        'Only then native-create PSSysApp with observed IDs; never send synthetic IDs',
        'Snapshot all config/model columns, native-remove owned application rows, and keep fetched configuration unchanged',
      ],
    },
    nativeAcceptance: false, permissionAcceptance: false, productionAcceptance: false,
  };
}

export async function probeExistingModelingConfigRoutes({ output,
  credentialPath = '.artifacts/current-business-actors-20261122-r1/credentials.private.json',
  request = fetch, execute = (command, args) => spawnSync(command, args,
    { encoding: 'utf8', timeout: 15000, maxBuffer: 4 * 1024 * 1024 }) } = {}) {
  const destination = resolve(output);
  assert.equal(dirname(destination), join(workspaceDefault, '.artifacts'));
  assert.match(basename(destination), /^m02-config-probe-[A-Za-z0-9-]+$/);
  assert.ok(!fs.existsSync(destination));
  assert.equal(credentialPath,
    '.artifacts/current-business-actors-20261122-r1/credentials.private.json');
  const credentialFile = join(workspaceDefault, credentialPath);
  assert.equal(fs.lstatSync(credentialFile).mode & 0o077, 0);
  const credential = JSON.parse(safeRead(credentialFile).bytes);
  const inspect = () => {
    const result = execute('docker', ['inspect', 'modelingservice',
      'compose-modelingweb-candidate-modeldesign-1', 'ibiz-ebsx-allinone']);
    assert.equal(result.status, 0, 'Existing Modeling runtime inspection failed');
    const rows = JSON.parse(result.stdout);
    assert.equal(rows.length, 3);
    return rows.map(row => {
      assert.equal(row.State.Status, 'running');
      assert.ok(row.Config.Labels?.['com.docker.compose.project.working_dir']
        === join(workspaceDefault, 'plm/deploy/compose'));
      return { name: row.Name, id: row.Id, image: row.Image, startedAt: row.State.StartedAt,
        restartCount: row.RestartCount, configSha256: hash(json(row.Config)),
        mountsSha256: hash(json([...row.Mounts].sort((a, b) => a.Destination.localeCompare(b.Destination)))) };
    });
  };
  const report = { contract: 'existing-modeling-config-read-probe-v1', status: 'RUNNING',
    startedAt: new Date().toISOString(), requests: [], checks: {}, httpMutations: 0,
    normalLoginRequests: 0, sqlUsed: false, configurationChanged: false, containersChanged: false,
    nativeAcceptance: false, permissionAcceptance: false, runtimeBefore: inspect() };
  let token;
  let organization;
  let phase = 'normal-login';
  let stoppedOnForbidden = false;
  const invoke = async (label, url, method = 'GET', body, login = false) => {
    assert.ok(!stoppedOnForbidden, 'A forbidden native response ends this session probe');
    const response = await request(url, { method,
      headers: { accept: 'application/json', 'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(organization ? { srforgid: organization } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'error', signal: AbortSignal.timeout(10000) });
    const raw = Buffer.from(await response.arrayBuffer());
    assert.ok(raw.length <= 2 * 1024 * 1024);
    let data;
    try { data = JSON.parse(raw.toString()); } catch { data = null; }
    report.requests.push({ label, path: new URL(url).pathname, method,
      status: response.status, bytes: raw.length, sha256: hash(raw), rawResponseRetained: false });
    if (login) report.normalLoginRequests += 1;
    if (response.status === 403) stoppedOnForbidden = true;
    assert.equal(response.status, 200, `${label}: HTTP ${response.status}`);
    return data;
  };
  fs.mkdirSync(destination, { mode: 0o700 });
  try {
    const login = await invoke('normal-login',
      'http://127.0.0.1:32009/api/ibizmodeling__modeldesign/v7/login', 'POST',
      { loginname: credential.username, password: credential.password }, true);
    assert.ok(typeof login?.token === 'string' && login.token.length < 32768);
    token = login.token;
    phase = 'native-organization-selection';
    const orgs = await invoke('native-organization-selection',
      'http://127.0.0.1:32009/api/ibizmodeling__modeldesign/uaa/getbydcsystem/ibizmodeling');
    assert.ok(Array.isArray(orgs) && orgs.length > 0);
    const selected = await invoke('native-selected-appdata', 'http://127.0.0.1:30000/appdata/ibizmodeling');
    organization = selected?.context?.srforgid;
    assert.ok(typeof organization === 'string' && organization.length > 0);
    assert.ok(orgs.some(org => org.orgid === organization && org.systemid === 'ibizmodeling'));
    report.nativeOrganizationSelected = true;
    report.identityHeadersInjected = false;
    phase = 'configuration-fetch';
    for (const [entity, route] of [['PSPF', 'pspfs'], ['PSPFStyle', 'pspfstyles'], ['PSAppType', 'psapptypes']]) {
      const data = await invoke(`native-fetch-${entity}`,
        `http://127.0.0.1:32009/api/ibizmodeling__modeldesign/${route}/fetchdefault`,
        'POST', { page: 0, size: 1000 });
      assert.ok(Array.isArray(data), 'Native configuration fetch must return actual rows');
      report.checks[entity] = { status: 200, rows: data.length,
        rowsExported: false, coherentTripleVerified: false };
    }
    report.status = 'READ_COMPLETE_CONFIGURATION_PROVENANCE_UNVERIFIED';
  } catch (error) {
    report.status = stoppedOnForbidden ? 'STOPPED_NATIVE_HTTP_403' : 'BLOCKED_CURRENT_NATIVE_READ';
    report.failedPhase = phase;
    report.failure = { type: error.name, message: String(error.message).slice(0, 200) };
  } finally {
    report.stoppedOnForbidden = stoppedOnForbidden;
    report.alternateSessionAttempted = false;
    report.runtimeAfter = inspect();
    report.runtimeUnchanged = JSON.stringify(report.runtimeBefore) === JSON.stringify(report.runtimeAfter);
    report.finishedAt = new Date().toISOString();
    const descriptor = fs.openSync(join(destination, 'report.private.json'),
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | fs.constants.O_NOFOLLOW, 0o600);
    try { fs.writeFileSync(descriptor, json(report)); fs.fsyncSync(descriptor); }
    finally { fs.closeSync(descriptor); }
  }
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: {
    'run-id': { type: 'string', default: '25dd6a7232c7' },
    'probe-existing': { type: 'boolean', default: false }, output: { type: 'string' },
  }, strict: true, allowPositionals: false });
  if (values['probe-existing']) {
    const report = await probeExistingModelingConfigRoutes({ output: values.output });
    console.log(json({ status: report.status, requests: report.requests.length,
      checks: report.checks, runtimeUnchanged: report.runtimeUnchanged,
      stoppedOnForbidden: report.stoppedOnForbidden, nativeAcceptance: false }));
    if (report.status !== 'READ_COMPLETE_CONFIGURATION_PROVENANCE_UNVERIFIED') process.exitCode = 1;
  } else {
    assert.equal(values.output, undefined, 'Only the existing native probe writes a private output');
    console.log(json(auditOwnedModelingConfigSources({ runId: values['run-id'] })));
  }
}
