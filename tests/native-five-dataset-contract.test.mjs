import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { readNativeFiveDatasetContract } from '../native-five-dataset-contract.mjs';

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const contract = readNativeFiveDatasetContract({ workspace });
const byName = name => contract.datasets.find(row => row.entity === name);
const digest = data => createHash('sha256').update(data).digest('hex');

test('source-only contract covers exact five native routes and real nested CREATE/REMOVE with no execution claim', () => {
  assert.equal(contract.contract, 'native-five-dataset-readonly-sentinel-contract-v1');
  assert.equal(contract.datasets.length, 5);
  assert.equal(contract.schemaTables.mergedPhysicalTables, 424);
  assert.equal(contract.nativeAcceptance, false);
  assert.equal(contract.permissionAcceptance, false);
  assert.equal(contract.sentinelInitializationPerformed, false);
  for (const row of contract.datasets) {
    assert.equal(row.dataSource, 'DB2');
    assert.match(row.collectionPath, /^\/api\/ibizmodeling__modeldesign\/psdevslnsys\/\$ROOT_ID\/[a-z]+$/);
    assert.match(row.fetchPath, /\/fetchcursys2?$/);
    assert.equal(row.removePath, `${row.collectionPath}/$RECEIPTED_KEY`);
    assert.deepEqual(row.fetchBody, { pssystemid: '$ACTUAL_ROOT_LOGICAL_SYSTEM_ID', page: 0, size: 1000 });
    assert.deepEqual([row.methods.Create.method, row.methods.Create.permission, row.methods.Create.returnType],
      ['POST', 'CREATE', 'DTO']);
    assert.deepEqual([row.methods.Remove.method, row.methods.Remove.permission, row.methods.Remove.returnType],
      ['DELETE', 'DELETE', 'VOID']);
    assert.equal(row.methods.Remove.needResourceKey, true);
    assert.equal(row.nativeActions.Create.mode, 'CREATE');
    assert.equal(row.nativeActions.Remove.mode, 'DELETE');
    assert.equal(row.methods[`Fetch${row.query}`].permission, 'READ');
    assert.equal(row.methods[`Fetch${row.query}`].returnType, 'PAGE');
  }
});

test('all native model, query, code-list, schema and lifecycle input bytes are bound without private fixture input', () => {
  assert.equal(contract.inputs.length, 35);
  for (const input of contract.inputs) {
    assert.equal(digest(readFileSync(join(workspace, input.path))), input.sha256, input.path);
    assert.ok(!input.path.includes('.artifacts/native-nonadmin-fixtures'));
    assert.ok(!input.path.includes('credentials'));
  }
  assert.ok(contract.inputs.some(row => row.path.endsWith('/modeling/core/dataentity/DataEntityRuntimeBase.java')));
  assert.ok(contract.inputs.some(row => row.path === 'modelingservice/sql/sCloud9471c1eca.sql'));
  assert.ok(contract.inputs.some(row => row.path.endsWith('/ServiceAPIType.json')));
  assert.ok(contract.inputs.some(row => row.path.endsWith('/SysDeployDBMode.json')));
});

test('minimal native payloads preserve true field requirements and only source-listed constant values', () => {
  const fields = name => byName(name).requiredPhysicalModelFields.map(row => row.field).sort();
  assert.deepEqual(fields('PSSysDBScheme'), [
    'dslink', 'pssysdbschemeid', 'pssysdbschemename', 'pssystemid', 'pssystemname',
  ]);
  assert.equal(byName('PSSysDBScheme').nativeCreatePayloadTemplate.dslink, 'DEFAULT');
  assert.deepEqual(fields('PSSysServiceAPI'), [
    'apitype', 'codename', 'pssysserviceapiid', 'pssysserviceapiname', 'pssystemid', 'validflag', 'ver',
  ]);
  assert.equal(byName('PSSysServiceAPI').nativeCreatePayloadTemplate.ver, 1);
  assert.equal(byName('PSSysServiceAPI').nativeCreatePayloadTemplate.apitype, 'RESTFUL');
  assert.equal(byName('PSSubSysServiceAPI').nativeCreatePayloadTemplate.apisource, 'NONE');
  assert.ok(!Object.hasOwn(byName('PSSubSysServiceAPI').nativeCreatePayloadTemplate, 'ver'));
  for (const row of contract.datasets) {
    assert.equal(row.nativeCreatePayloadTemplate[row.keyField], '$FRESH_CASE_UUID_OR_ACCEPT_NATIVE_RETURNED_ID');
    assert.equal(row.nativeCreatePayloadTemplate[row.nameField], '$RUN_SIDE_ENTITY_SPECIFIC_NAME');
    assert.equal(row.nativeCreatePayloadTemplate.usertag, '$RUN_SIDE_NONCE_MARKER');
    assert.equal(row.nativeCreatePayloadTemplate.pssystemid, '$ACTUAL_ROOT_LOGICAL_SYSTEM_ID');
    assert.equal(row.sourceSchema.dumpMandatoryLines.length, 1);
    assert.match(row.sourceSchema.dumpMandatoryLines[0], /NOT NULL/);
  }
});

test('application config prerequisites remain blocked, actual config SELECT paths are source-bound and not fabricated', () => {
  const app = byName('PSSysApp');
  assert.equal(app.nativeCreateReadiness, 'blocked-until-real-platform-style-app-type-config-is-observed');
  for (const name of ['pspfid', 'pspfstyleid', 'psapptypename']) {
    assert.ok(app.requiredPhysicalModelFields.some(row => row.field === name && row.required));
  }
  assert.ok(!app.requiredPhysicalModelFields.some(row => row.field === 'psapptypeid'));
  assert.equal(app.nativeCreatePayloadTemplate.pspfid, '$OBSERVED_PLATFORM_ID');
  assert.equal(app.nativeCreatePayloadTemplate.pspfstyleid, '$OBSERVED_STYLE_ID');
  assert.equal(app.nativeCreatePayloadTemplate.psapptypename, '$OBSERVED_APP_TYPE_NAME');
  assert.deepEqual(contract.applicationConfig.map(row => [row.entity, row.dataSource, row.method, row.readPath]), [
    ['PSPF', 'DEFAULT', 'POST', '/api/ibizmodeling__modeldesign/pspfs/fetchdefault'],
    ['PSPFStyle', 'DEFAULT', 'POST', '/api/ibizmodeling__modeldesign/pspfstyles/fetchdefault'],
    ['PSAppType', 'DEFAULT', 'POST', '/api/ibizmodeling__modeldesign/psapptypes/fetchdefault'],
  ]);
});

test('SFPub root-only CurSys2 needs null parent but nonphysical style display name is not a fabricated required input', () => {
  const row = byName('PSSysSFPub');
  assert.equal(row.query, 'CurSys2');
  assert.match(row.predicate, /PPSSYSSFPUBID` IS NULL/);
  assert.equal(row.nativeCreatePayloadTemplate.ppssyssfpubid, null);
  assert.deepEqual(row.queryRowMinimum.requiredNull, ['ppssyssfpubid']);
  assert.deepEqual(row.requiredPhysicalModelFields.map(row => row.field).sort(),
    ['pssyssfpubid', 'pssyssfpubname', 'pssystemid']);
  assert.ok(row.nonphysicalRequiredFields.some(field => field.field === 'pssfstylename' && field.fieldType === 3));
  assert.ok(!Object.hasOwn(row.nativeCreatePayloadTemplate, 'pssfstyleid'));
  assert.ok(!Object.hasOwn(row.nativeCreatePayloadTemplate, 'pssfstylename'));
});

test('source query dependencies are all LEFT JOINs and only App/SFPub project joined physical system names', () => {
  assert.deepEqual(contract.datasets.map(row => [row.entity, row.joins.length]), [
    ['PSSysDBScheme', 5], ['PSSysApp', 11], ['PSSysSFPub', 6],
    ['PSSysServiceAPI', 8], ['PSSubSysServiceAPI', 7],
  ]);
  for (const row of contract.datasets) {
    assert.equal(row.joins[0].table, row.table);
    assert.equal(row.joins[0].kind, 'FROM');
    assert.ok(row.joins.slice(1).every(join => join.kind === 'LEFT JOIN' && join.matchingRowRequiredForFetch === false));
    assert.ok(row.nonemptyReturnChecks.every(field => row.returnProjection.some(output => output.field === field)));
    if (['PSSysApp', 'PSSysSFPub'].includes(row.entity)) {
      const system = row.joins.find(join => join.table === 't_srfpssystem');
      assert.ok(system);
      assert.equal(row.systemNameProjection, `${system.alias}.\`PSSYSTEMNAME\``);
    } else {
      assert.equal(row.systemNameProjection, 't1.`PSSYSTEMNAME`');
      assert.ok(!row.joins.some(join => join.table === 't_srfpssystem'));
    }
  }
  assert.deepEqual(byName('PSSysDBScheme').modelExpressionsNotSelected, ['schemeparams']);
  assert.deepEqual(byName('PSSysApp').modelExpressionsNotSelected, ['bottominfo', 'headerinfo', 'pfstyleparam']);
  assert.ok(!byName('PSSysApp').returnProjection.some(row => row.field === 'headerinfo'));
  assert.deepEqual(byName('PSSysServiceAPI').modelExpressionsNotSelected, ['ignoreauthpatterns', 'serviceparams']);
  assert.deepEqual(byName('PSSubSysServiceAPI').modelExpressionsNotSelected,
    ['adddeparams', 'authcode', 'methodcode', 'serviceparams']);
});

test('native cleanup proposal retains version/log side effects instead of claiming complete baseline restoration', () => {
  assert.equal(contract.lifecycle.nativeCreatePreferred, true);
  assert.equal(contract.lifecycle.nativeRemovePreferred, true);
  assert.equal(contract.lifecycle.logicDelete, false);
  assert.ok(contract.lifecycle.expectedSourceEffects.some(item => item.includes('MODELVER')));
  assert.ok(contract.lifecycle.expectedSourceEffects.some(item => item.includes('PSSysModelLog')));
  assert.match(contract.lifecycle.baselineRule, /never SQL-reset/);
  assert.ok(contract.datasets.every(row => row.queryRowMinimum.acceptance.includes('no SQL seed')));
});

test('a changed native query predicate fails inspection without executing or weakening it', () => {
  const root = mkdtempSync(join(tmpdir(), 'native-five-readonly-'));
  try {
    for (const input of contract.inputs) {
      cpSync(join(workspace, input.path), join(root, input.path), { recursive: true });
    }
    const path = join(root, contract.sourceModelRoot, byName('PSSysSFPub').sourceQuery);
    const query = JSON.parse(readFileSync(path));
    query.getPSDEDataQueryCodeConds[0].customCond = '( 1=1 )';
    writeFileSync(path, JSON.stringify(query));
    assert.throws(() => readNativeFiveDatasetContract({ workspace: root }));
  } finally { rmSync(root, { recursive: true, force: true }); }
});
