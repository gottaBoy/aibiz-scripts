#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const workspaceDefault = resolve(new URL('../', import.meta.url).pathname);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => `${JSON.stringify(value, null, 2)}\n`;
const configTables = ['t_srfpspf', 't_srfpspfstyle', 't_srfpsapptype'];

function safeRead(path) {
  const info = fs.lstatSync(path);
  assert.ok(info.isFile() && !info.isSymbolicLink());
  const bytes = fs.readFileSync(path);
  return { bytes, sha256: hash(bytes) };
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

function scanCurrentReports(base, runId) {
  const root = join(base, runId);
  const reports = [];
  if (!fs.existsSync(root)) return reports;
  for (const name of fs.readdirSync(root)) {
    if (!/(?:editor-config|modeling-config-blocked)-/.test(name)) continue;
    const path = join(root, name, 'report.json');
    if (!fs.existsSync(path)) continue;
    const { bytes, sha256 } = safeRead(path);
    let value;
    try { value = JSON.parse(bytes); } catch { continue; }
    reports.push({
      path: path.replace(`${resolve(base, '..', '..')}/`, ''), sha256, bytes: bytes.length,
      contract: value.contract, status: value.status,
      configRows: value.checks ? Object.fromEntries(Object.entries(value.checks)
        .filter(([entity]) => configTables.some(table => entity.toLowerCase().includes(table.slice(5))))
        .map(([entity, check]) => [entity, { status: check.status, rows: check.rows }])) : undefined,
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
  const sharedInitPath = join(workspace, 'modelingservice/sql/init.sql');
  const shared = safeRead(sharedInitPath);
  const sharedCounts = tableInsertCounts(shared.bytes.toString('utf8'));
  const ownedSeeds = scanOwnedSeedFiles(base);
  const reports = scanCurrentReports(base, runId);
  const currentConfig = reports.find(row => row.contract === 'owned-editor-config-read-v1');
  const currentRows = currentConfig?.configRows
    ? Object.values(currentConfig.configRows).map(value => value.rows).filter(Number.isInteger)
    : [];
  const sourceModelPaths = [
    'vendor-upstream/ibizmodeling-standard/modelapi-core/src/main/resources/model/net/ibizsys/modeling/PSSYSSERVICEAPIS/ModelAPI.json',
    'vendor-upstream/ibizmodeling-standard/modelapi-core/src/main/resources/model/net/ibizsys/modeling/PSMODULES/Config/PSDATAENTITIES/PSPF.json',
    'vendor-upstream/ibizmodeling-standard/modelapi-core/src/main/resources/model/net/ibizsys/modeling/PSMODULES/Config/PSDATAENTITIES/PSPFStyle.json',
    'vendor-upstream/ibizmodeling-standard/modelapi-core/src/main/resources/model/net/ibizsys/modeling/PSMODULES/Config/PSDATAENTITIES/PSAppType.json',
  ];
  const sourceModels = sourceModelPaths.map(path => {
    const file = safeRead(join(workspace, path));
    return { path, bytes: file.bytes.length, sha256: file.sha256, rows: 0,
      eligible: false, reason: 'Model metadata only; no persisted configuration rows' };
  });
  return {
    contract: 'owned-modeling-config-source-audit-v1', runId,
    status: currentRows.length === 3 && currentRows.every(count => count === 0)
      ? 'blocked-no-owned-config-rows' : 'blocked-source-not-owned',
    inspectedAt: new Date().toISOString(),
    sharedInit: {
      path: 'modelingservice/sql/init.sql', bytes: shared.bytes.length, sha256: shared.sha256,
      tableInsertCounts: sharedCounts, eligible: false,
      reason: 'Shared historical development SQL; never copied into owned fixture',
    },
    ownedSeedFiles: ownedSeeds,
    currentOwnedReports: reports,
    sourceModels,
    decision: {
      ownedRowsAvailable: false,
      nativeConfigCreateExecuted: false,
      sqlMutation: false,
      appCreateUnblocked: false,
      reasons: [
        'No source-bound PSPF/PSPFStyle/PSAppType row receipt exists in owned artifacts',
        'Shared init.sql rows are not an owned, current, source-bound data source',
        'Current authenticated config reads are 200 with zero rows',
      ],
      repair: [
        'Publish exact owned POST FetchDefault routes and retain route readback',
        'Fetch actual coherent PSPF/PSPFStyle/PSAppType rows under ordinary owned editor',
        'Only then native-create PSSysApp with observed IDs; never send synthetic IDs',
        'Snapshot all config/model columns and native-remove owned rows in reverse dependency order',
      ],
    },
    nativeAcceptance: false, permissionAcceptance: false, productionAcceptance: false,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: {
    'run-id': { type: 'string', default: '25dd6a7232c7' },
  }, strict: true, allowPositionals: false });
  console.log(json(auditOwnedModelingConfigSources({ runId: values['run-id'] })));
}
