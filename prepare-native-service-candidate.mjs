#!/usr/bin/env node

import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import {
  closeSync, constants, fchmodSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync,
  readdirSync, writeFileSync,
} from 'node:fs';
import { dirname, join, parse, relative, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const workspaceRoot = fileURLToPath(new URL('../', import.meta.url));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const contractName = 'native-central-published-query-candidate';
const fixturePath = 'scripts/fixtures/native-service-migration-contract.json';
const viewPath = 'PSSYSAPPS/Central/PSAPPDEVIEWS/PSDevSlnGridView.json';
const entityPath = 'PSSYSAPPS/Central/PSAPPDATAENTITIES/PSDevSln.json';
const backendEntityPath = 'PSMODULES/SysDesign/PSDATAENTITIES/PSDevSln.json';
const fetchChanges = [
  {
    location: '/getPSControls/2/getFetchPSControlAction/getPSAppDEMethod/id',
    from: 'FetchDefault', to: 'FetchCurDCSLNUser',
  },
  {
    location: '/getPSControls/2/getPSControlHandler/getPSHandlerActions/5/getPSAppDEMethod/id',
    from: 'FetchDefault', to: 'FetchCurDCSLNUser',
  },
];
const requestContract = {
  method: 'POST',
  path: '/api/ibizmodeling__central/psdevslns/fetchcurdcslnuser',
  backendPath: '/ibizmodeling/modelapi/psdevslns/fetchcurdcslnuser',
  dataAccessAction: 'READ',
  dataset: 'CurDCSLNUser',
};
const permissionAcceptance = {
  status: 'not-accepted',
  rowIsolationVerified: false,
  readActionProvesRowIsolation: false,
};
const semantics = "Candidate only: Central's two grid fetch references use the existing published CurDCSLNUser query without changing the backend or its READ action. Current-user visibility and permissions are not accepted: the existing member SQL checks EXISTS of any scheme member, not SRFPERSONID. READ is not proof of row isolation.";
const acceptance = 'candidate-only; real browser navigation and published query response required; current-user visibility, row isolation and permissions are not accepted; READ action is not row-isolation proof; does not approve plugin sources or editor/save/readback';
const sourceModelRoot = 'vendor-upstream/ibizmodeling-standard/modelapi-core/src/main/resources/model/net/ibizsys/modeling';
const sourceCommit = '96e9e54e5a20c0eea7f9ada21bdd1a38177caf9f';
const pinnedFiles = {
  view: { path: viewPath, sha256: 'b4c04b664cbcd1508edcaa684fd510de7b2a885139367d6fe02b834b77c1e5ce' },
  entity: { path: entityPath, sha256: '7a447b9b968aad98c62e358418d5eaa17a7b37d0007222cb89762e6a53f21f4b' },
  service: { path: 'PSSYSSERVICEAPIS/ModelAPI.json', sha256: '9d149f310a527954d003dc7eff669a9cb34cf85e9d6c6b7b7c67233f99684428' },
  backendEntity: { path: backendEntityPath, sha256: 'e3be8184e95dc32b011d733416e89b04f746ffc556911ecc50695849839100e9' },
};
const sqlPath = query => `PSMODULES/SysDesign/PSDATAENTITIES/PSDevSln/PSDEDATAQUERIES/${query}/PSDEDQCODES/MYSQL5.json`;
const queryBaselines = [
  { key: 'centerAdminSQL', codeName: 'CurDCAdmin', index: 1,
    sha256: 'bdaf03403febd4b2fecd04919fa8bea4f58866ad7d4661eb47b55ab818708b29',
    sqlObjectSha256: '9262d386e4ddd7ec02f724769d684bd102614bea1180bc92093e00a380a6bd03',
    structuredSha256: '5c7453b29dd5a39e6a7bfcb2146e06e6673c2c0bfef3c91646eb9843f0afaf2c' },
  { key: 'schemeAdminSQL', codeName: 'CurDCSLNAdmin', index: 2,
    sha256: '84ff636105da5a55adf3d86036c3ff20e30d19d4db1f8a2efecfce93294566df',
    sqlObjectSha256: '7b0d2c9c1870ed43f9ad1c4a0b96d89d66f0465a7eca2ac1f77501a2d617598d',
    structuredSha256: '529d752e505452ea1ecbdb4a172a41dc6ce58bd8dc5c71033b816b3243e74c60' },
  { key: 'memberSQL', codeName: 'CurDCSLNUser', index: 3,
    sha256: 'd3bd98b9670bab408a9f4f60e41b052574b9bc40a9a99b85bad7ed1935e81844',
    sqlObjectSha256: '28572a59e94869a950fa35c7a98f7a3ef82d65ccf642bf0994d3a31512f7f2a6',
    structuredSha256: '1bbb86e03e6a1e22df27dedf075f40b7c84b6681e45afb24b54afa877d60811c' },
];
const pinnedSQLFiles = Object.fromEntries(queryBaselines.map(query =>
  [query.key, { path: sqlPath(query.codeName), sha256: query.sha256 }]));
const originalMemberSQL = 'EXISTS(SELECT * FROM `T_SRFPSDEVSLNUSER` t41 \n WHERE \n t1.`PSDEVSLNID` = t41.`PSDEVSLNID` )';
const boundMemberSQL = 'EXISTS(SELECT * FROM `T_SRFPSDEVSLNUSER` t41 \n WHERE \n t1.`PSDEVSLNID` = t41.`PSDEVSLNID`  AND  t41.`PSDEVUSEROBJID` = #{ctx.sessioncontext.srfpersonid} )';
const memberCondition = {
  condOp: 'AND', condType: 'GROUP', name: 'Member session binding',
  getPSDEDQConditions: [{
    condOp: 'EQ', condType: 'SINGLE', condValue: 'SRFPERSONID',
    fieldName: 'PSDEVUSEROBJID', name: 'PSDEVUSEROBJID = SESSIONCONTEXT(SRFPERSONID)',
    getPSDEField: { name: 'PSDEVUSEROBJID', codeName: 'PSDevUserObjId' },
    getPSVARTypeId: 'SESSIONCONTEXT',
  }],
};
const memberBindingContract = {
  contract: 'native-central-member-session-binding-candidate',
  files: pinnedSQLFiles,
  changes: [
    {
      path: backendEntityPath,
      location: '/getAllPSDEDataQueries/3/getPSDEDQMain/getChildPSDEDQJoins/0/getPSDEDQGroupCondition',
      op: 'add', fromExists: false, to: memberCondition,
    },
    {
      path: sqlPath('CurDCSLNUser'), location: '/getPSDEDataQueryCodeConds/0/customCond',
      op: 'replace', from: originalMemberSQL, to: boundMemberSQL,
    },
  ],
  semantics: 'Candidate only: bind the ordinary-member EXISTS to trusted SESSIONCONTEXT SRFPERSONID and synchronize its structured join. Preserve center scope, both admin branches, READ and both grid fetch references. Identity binding is not complete permission parity: identity mapping, expiry, access mode, target scope and live multi-user results remain unverified. READ is not proof of row isolation.',
  acceptance: 'candidate-only; row isolation, permissions, production and native editor acceptance remain false',
  trustBoundary: 'Trusted artifact ancestors, owning UID, writable-group actors and same-UID/root processes; cooperative single writer. Symlink checks and pinned readbacks are not an atomic multi-file snapshot or protection against a malicious ancestor rename. Preserve failed candidates and retry in a fresh destination.',
};
const remainingAcceptance = [
  'real native browser navigation and published query response',
  'current-user row isolation and cross-center permission negative cases',
  'all native plugin sources and source builds',
  'native editor operations/save/fresh-session readback',
];
const jsonBytes = document => Buffer.from(`${JSON.stringify(document, null, 2)}\n`);

function statIfPresent(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function checkAncestors(path, { create = false } = {}) {
  const absolute = resolve(path);
  let cursor = parse(absolute).root;
  for (const part of relative(cursor, absolute).split(sep).filter(Boolean)) {
    cursor = join(cursor, part);
    let stat = statIfPresent(cursor);
    if (!stat && create) {
      mkdirSync(cursor, { mode: 0o700 });
      stat = lstatSync(cursor);
    }
    assert.ok(!stat || (!stat.isSymbolicLink() && stat.isDirectory()),
      `Artifact/source ancestors must be real directories: ${cursor}`);
  }
}

function readRegularFile(path) {
  checkAncestors(dirname(path));
  const initial = lstatSync(path);
  assert.ok(!initial.isSymbolicLink() && initial.isFile(), `A regular file is required: ${path}`);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd);
    assert.ok(before.isFile() && initial.dev === before.dev && initial.ino === before.ino,
      `File changed before pinned read: ${path}`);
    const bytes = readFileSync(fd);
    const after = fstatSync(fd);
    const current = lstatSync(path);
    assert.ok(!current.isSymbolicLink()
      && before.dev === after.dev && before.ino === after.ino
      && before.size === after.size && before.mtimeMs === after.mtimeMs
      && before.ctimeMs === after.ctimeMs
      && after.dev === current.dev && after.ino === current.ino
      && after.size === current.size && after.mtimeMs === current.mtimeMs
      && after.ctimeMs === current.ctimeMs,
    `File changed during pinned read: ${path}`);
    return bytes;
  } finally {
    closeSync(fd);
  }
}

function writeExclusiveFile(path, bytes, { publicModel = false } = {}) {
  checkAncestors(dirname(path), { create: true });
  const fd = openSync(path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    writeFileSync(fd, bytes);
    if (publicModel) fchmodSync(fd, 0o644);
  } finally {
    closeSync(fd);
  }
  assert.ok(readRegularFile(path).equals(bytes), `Exclusive write readback failed: ${path}`);
}

function candidateOutput(workspace, output) {
  const allowedRoot = join(workspace, '.artifacts/native-service-migration');
  const destination = resolve(output);
  assert.ok(destination.startsWith(`${allowedRoot}${sep}`),
    'Service candidate output must stay under its artifact root');
  checkAncestors(destination);
  return destination;
}

function fetchMethodReferences(view) {
  const grid = view.getPSControls[2];
  return [
    grid.getFetchPSControlAction.getPSAppDEMethod,
    grid.getPSControlHandler.getPSHandlerActions[5].getPSAppDEMethod,
  ];
}

export function rewriteCentralSchemeFetch({ view, entity, service, backendEntity }) {
  assert.equal(view.codeName, 'PSDevSlnGridView', 'Only the Central scheme grid is supported');
  assert.equal(view.getPSAppDataEntity?.path, entityPath, 'Grid entity identity must match');
  assert.equal(entity.getPSDataEntity?.path, backendEntityPath, 'Backend entity identity must match');
  const grid = view.getPSControls?.[2];
  assert.equal(grid?.name, 'grid', 'The pinned grid position must match');
  assert.equal(grid.controlType, 'GRID', 'The pinned control must be a grid');
  const action = grid.getFetchPSControlAction;
  assert.equal(action?.actionType, 'DEDATASET', 'Only a dataset fetch reference may change');
  assert.equal(action.name, 'fetch', 'The primary fetch identity must match');
  assert.equal(action.getPSAppDataEntity?.path, entityPath, 'Fetch entity identity must match');
  assert.equal(action.getPSAppDEMethod?.modelref, true, 'The primary method must be a reference');
  assert.equal(action.getPSAppDEMethod?.id, 'FetchDefault', 'Original fetch reference must match');
  const handler = grid.getPSControlHandler;
  assert.equal(handler?.userDRAction, 'READ', 'The existing handler READ action must remain intact');
  const handlerActions = handler.getPSHandlerActions;
  assert.ok(Array.isArray(handlerActions), 'The existing handler action list is required');
  assert.equal(handlerActions.filter(item => item?.name === 'fetch').length, 1,
    'The handler fetch must be unique');
  const handlerFetch = handlerActions[5];
  assert.equal(handlerFetch?.name, 'fetch', 'The pinned handler fetch position must match');
  assert.equal(handlerFetch.actionType, 'DEDATASET', 'The handler fetch must be a dataset action');
  assert.equal(handlerFetch.getPSAppDataEntity?.path, entityPath, 'Handler fetch entity must match');
  assert.equal(handlerFetch.getPSAppDEMethod?.modelref, true, 'The handler method must be a reference');
  assert.equal(handlerFetch.getPSAppDEMethod?.id, 'FetchDefault',
    'Original handler fetch reference must match');

  const methods = entity.getAllPSAppDEMethods ?? [];
  const original = methods.filter(method => method.codeName === 'FetchDefault');
  assert.equal(original.length, 1, 'Original authoring dataset must be unique');
  assert.equal(original[0].dataSetType, 'DATAQUERY');
  assert.equal(original[0].requestMethod, undefined, 'An existing remote contract must not be replaced');
  const targets = methods.filter(method => method.codeName === 'FetchCurDCSLNUser');
  assert.equal(targets.length, 1, 'An existing, unique published-query app method is required');
  const target = targets[0];
  assert.equal(target.methodType, 'FETCH');
  assert.equal(target.requestMethod, 'POST');
  assert.equal(target.requestPath, '/fetchcurdcslnuser');
  assert.equal(target.dataSetTag, 'CurDCSLNUser');
  assert.equal(target.getPSAppDEMethodReturn?.type, 'PAGE');

  assert.equal(service.serviceCodeName, 'ModelAPI');
  const apis = (service.getPSDEServiceAPIs ?? []).filter(api => api.name === 'PSDEVSLN');
  assert.equal(apis.length, 1, 'Backend service entity must be unique');
  assert.equal(apis[0].codeName, 'PSDevSln');
  assert.equal(apis[0].getPSDataEntity?.path, backendEntityPath);
  const published = apis[0].getPSDEServiceAPIMethods ?? [];
  assert.ok(!published.some(method => method.codeName === 'FetchDefault'),
    'Reassess the migration if the original method becomes published');
  const fetches = published.filter(method => method.codeName === 'FetchCurDCSLNUser');
  assert.equal(fetches.length, 1, 'A published backend fetch is required');
  assert.equal(fetches[0].methodType, 'FETCH');
  assert.equal(fetches[0].requestMethod, 'POST');
  assert.equal(fetches[0].dataAccessAction, 'READ');
  assert.equal(fetches[0].getPSDEDataSet?.id, 'CurDCSLNUser');
  assert.equal(backendEntity.name, 'PSDEVSLN');
  const datasets = (backendEntity.getAllPSDEDataSets ?? [])
    .filter(dataset => dataset.codeName === 'CurDCSLNUser');
  assert.equal(datasets.length, 1);
  assert.deepEqual(datasets[0].getPSDEDataQueries?.map(query => query.id),
    ['CurDCAdmin', 'CurDCSLNAdmin', 'CurDCSLNUser'],
    'The pinned published query union must match; its names do not prove row isolation');

  const candidate = structuredClone(view);
  for (const reference of fetchMethodReferences(candidate)) {
    reference.id = target.codeName;
  }
  return candidate;
}

export function rewriteCentralMemberSessionBinding(documents) {
  const view = rewriteCentralSchemeFetch(documents);
  const queries = documents.backendEntity.getAllPSDEDataQueries;
  for (const baseline of queryBaselines) {
    assert.equal(queries.filter(query => query.codeName === baseline.codeName).length, 1,
      `A unique ${baseline.codeName} structured query is required`);
    const query = queries[baseline.index];
    assert.equal(query.codeName, baseline.codeName, 'Pinned structured query position must match');
    assert.deepEqual(query.getAllPSDEDataQueryCodes,
      [{ modelref: true, path: sqlPath(baseline.codeName) }],
      'The actual SQL reference must match its pinned source');
    assert.equal(hash(JSON.stringify(query)), baseline.structuredSha256,
      `Original structured query changed: ${baseline.codeName}`);
    const sql = documents[baseline.key];
    assert.equal(sql?.id, sqlPath(baseline.codeName), 'SQL identity must match its actual reference');
    assert.equal(sql.dBType, 'MYSQL5', 'Only the audited MYSQL5 query is supported');
    assert.equal(hash(JSON.stringify(sql)), baseline.sqlObjectSha256,
      `Original SQL document changed: ${baseline.codeName}`);
  }
  const join = queries[3].getPSDEDQMain.getChildPSDEDQJoins[0];
  assert.equal(Object.hasOwn(join, 'getPSDEDQGroupCondition'), false,
    'Original member join must have no group condition');
  assert.equal(documents.memberSQL.getPSDEDataQueryCodeConds[0].customCond, originalMemberSQL,
    'Original member SQL must match exactly before binding');
  const backendEntity = structuredClone(documents.backendEntity);
  backendEntity.getAllPSDEDataQueries[3].getPSDEDQMain.getChildPSDEDQJoins[0]
    .getPSDEDQGroupCondition = structuredClone(memberCondition);
  const memberSQL = structuredClone(documents.memberSQL);
  memberSQL.getPSDEDataQueryCodeConds[0].customCond = boundMemberSQL;
  return { view, backendEntity, memberSQL };
}

function loadContract(workspace, memberBinding) {
  const contractBytes = readRegularFile(join(workspace, fixturePath));
  const contract = JSON.parse(contractBytes);
  assert.equal(contract.schemaVersion, 1);
  assert.equal(contract.contract, contractName);
  assert.equal(contract.sourceModelRoot, sourceModelRoot, 'The original model root is pinned');
  assert.equal(contract.sourceCommit, sourceCommit, 'The original model commit is pinned');
  assert.equal(contract.change, undefined, 'The obsolete single-reference change is not supported');
  assert.deepEqual(contract.changes, fetchChanges, 'Both exact fetch changes must be declared');
  assert.deepEqual(contract.request, requestContract, 'The published query request must match');
  assert.deepEqual(contract.permissionAcceptance, permissionAcceptance,
    'This candidate must not claim permission or row-isolation acceptance');
  assert.equal(contract.semantics, semantics, 'Candidate semantics must disclose unverified permissions');
  assert.equal(contract.acceptance, acceptance, 'Candidate acceptance boundaries must not change');
  assert.deepEqual(contract.files, pinnedFiles, 'The four original source paths and hashes are pinned');
  if (memberBinding) {
    assert.deepEqual(contract.memberBinding, memberBindingContract,
      'The separate member-binding paths, original values and non-acceptance contract are pinned');
  }
  const files = { ...contract.files, ...(memberBinding ? contract.memberBinding.files : {}) };
  const documents = {};
  const sourceBytes = {};
  const inputs = [];
  for (const [key, file] of Object.entries(files)) {
    const bytes = readRegularFile(join(workspace, contract.sourceModelRoot, file.path));
    assert.equal(hash(bytes), file.sha256, `Pinned native source changed: ${file.path}`);
    documents[key] = JSON.parse(bytes);
    sourceBytes[key] = bytes;
    inputs.push({ path: file.path, sha256: hash(bytes) });
  }
  return { contract, contractBytes, documents, sourceBytes, inputs };
}

function expectedCandidate(workspace, memberBinding, generatedAt) {
  const { contract, contractBytes, documents, sourceBytes, inputs } = loadContract(workspace, memberBinding);
  const candidate = memberBinding ? rewriteCentralMemberSessionBinding(documents)
    : { view: rewriteCentralSchemeFetch(documents) };
  const outputs = [{ path: viewPath, bytes: jsonBytes(candidate.view) }];
  if (memberBinding) {
    outputs.push({ path: backendEntityPath, bytes: jsonBytes(candidate.backendEntity) });
    for (const query of queryBaselines) {
      outputs.push({ path: sqlPath(query.codeName), bytes: query.key === 'memberSQL'
        ? jsonBytes(candidate.memberSQL) : sourceBytes[query.key] });
    }
  }
  const originalReferences = fetchMethodReferences(documents.view);
  const candidateReferences = fetchMethodReferences(candidate.view);
  const receipt = {
    schemaVersion: 1, contract: contract.contract,
    status: 'prepared-not-accepted', acceptedForProduction: false,
    sourceCommit: contract.sourceCommit, sourceModelRoot: contract.sourceModelRoot,
    fixture: { path: fixturePath, sha256: hash(contractBytes) },
    inputs, outputs: outputs.map(file => ({ path: file.path, sha256: hash(file.bytes) })),
    changes: fetchChanges.map((change, index) => ({
      path: viewPath, location: change.location,
      from: originalReferences[index].id, to: candidateReferences[index].id,
    })),
    request: { ...requestContract }, semantics,
    permissionAcceptance: { ...permissionAcceptance },
    remainingAcceptance: [...remainingAcceptance],
  };
  if (memberBinding) {
    assert.ok(typeof generatedAt === 'string'
      && Number.isFinite(Date.parse(generatedAt))
      && new Date(generatedAt).toISOString() === generatedAt, 'A canonical UTC generation timestamp is required');
    Object.assign(receipt, {
      schemaVersion: 2, contract: memberBindingContract.contract,
      status: 'prepared-member-binding-not-accepted', generatedAt,
      nativeAccepted: false,
      originalsReadOnly: true,
      semantics: memberBindingContract.semantics,
      acceptance: memberBindingContract.acceptance,
      trustBoundary: memberBindingContract.trustBoundary,
      changes: [...receipt.changes, ...structuredClone(memberBindingContract.changes)],
      sqlBindings: queryBaselines.map(query => ({
        query: query.codeName, path: sqlPath(query.codeName),
        reference: {
          path: backendEntityPath,
          location: `/getAllPSDEDataQueries/${query.index}/getAllPSDEDataQueryCodes/0/path`,
          from: documents.backendEntity.getAllPSDEDataQueries[query.index].getAllPSDEDataQueryCodes[0].path,
          to: candidate.backendEntity.getAllPSDEDataQueries[query.index].getAllPSDEDataQueryCodes[0].path,
        },
        sourceSha256: hash(sourceBytes[query.key]),
        candidateSha256: hash(outputs.find(file => file.path === sqlPath(query.codeName)).bytes),
        changed: query.key === 'memberSQL',
      })),
      remainingAcceptance: [...remainingAcceptance,
        'trusted session identity equals the current development-user identity',
        'expiry, access mode, target scope and missing development-user fail-closed behavior'],
    });
  }
  return { receipt, outputs };
}

function verifyOriginals(workspace, receipt) {
  for (const input of receipt.inputs) {
    assert.equal(hash(readRegularFile(join(workspace, sourceModelRoot, input.path))), input.sha256,
      `Pinned native source changed: ${input.path}`);
  }
  assert.equal(hash(readRegularFile(join(workspace, fixturePath))), receipt.fixture.sha256,
    'Candidate fixture changed during verification');
}

function listOutputFiles(root) {
  const result = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    assert.ok(!entry.isSymbolicLink(), `Candidate entries must not be symlinks: ${path}`);
    if (entry.isDirectory()) {
      const children = listOutputFiles(path);
      assert.ok(children.length > 0, `Undeclared empty candidate directory: ${path}`);
      result.push(...children.map(child => `${entry.name}/${child}`));
    } else {
      assert.ok(entry.isFile(), `Candidate entries must be regular files: ${path}`);
      result.push(entry.name);
    }
  }
  return result;
}

export function verifyNativeServiceCandidate({
  workspace = workspaceRoot, receiptPath,
} = {}) {
  workspace = resolve(workspace);
  assert.ok(typeof receiptPath === 'string', 'A receipt path is required');
  receiptPath = resolve(receiptPath);
  const output = candidateOutput(workspace, dirname(receiptPath));
  assert.equal(receiptPath, join(output, 'receipt.json'), 'The candidate receipt basename must be receipt.json');
  const receiptBytes = readRegularFile(receiptPath);
  const recorded = JSON.parse(receiptBytes);
  assert.ok([contractName, memberBindingContract.contract].includes(recorded.contract),
    'Only the pinned published-query or member-binding candidate can be verified');
  const memberBinding = recorded.contract === memberBindingContract.contract;
  const { receipt, outputs } = expectedCandidate(workspace, memberBinding, recorded.generatedAt);
  assert.deepEqual(recorded, receipt, 'Receipt must match the recomputed candidate, diffs and non-acceptance flags');
  assert.deepEqual(listOutputFiles(output).sort(),
    ['receipt.json', ...outputs.map(file => `model/${file.path}`)].sort(),
    'Exactly the declared candidate files and receipt are required');
  for (const file of outputs) {
    assert.ok(readRegularFile(join(output, 'model', file.path)).equals(file.bytes),
      `Candidate output changed: ${file.path}`);
  }
  verifyOriginals(workspace, receipt);
  assert.ok(readRegularFile(receiptPath).equals(receiptBytes), 'Receipt changed during verification');
  return {
    status: memberBinding ? 'verified-member-binding-candidate-not-accepted'
      : 'verified-published-query-candidate-not-accepted',
    contract: receipt.contract, acceptedForProduction: false, nativeAccepted: false,
    permissionAcceptance: { ...permissionAcceptance }, inputs: receipt.inputs, outputs: receipt.outputs,
  };
}

export function prepareNativeServiceCandidate({
  workspace = workspaceRoot, output, memberBinding = false,
} = {}) {
  workspace = resolve(workspace);
  assert.equal(typeof memberBinding, 'boolean', 'memberBinding must be a boolean');
  const generatedAt = new Date().toISOString();
  output = candidateOutput(workspace, output || join(workspace, '.artifacts/native-service-migration',
    memberBinding ? `member-session-binding-${generatedAt.replaceAll(':', '-')}-${randomUUID()}` : 'current'));
  const present = statIfPresent(output);
  assert.ok(!present || readdirSync(output).length === 0,
    'Use a new empty candidate directory; existing evidence must not be overwritten');
  const { receipt, outputs } = expectedCandidate(workspace, memberBinding, generatedAt);
  verifyOriginals(workspace, receipt);
  for (const file of outputs) {
    writeExclusiveFile(join(output, 'model', file.path), file.bytes, { publicModel: true });
  }
  verifyOriginals(workspace, receipt);
  writeExclusiveFile(join(output, 'receipt.json'), jsonBytes(receipt));
  // Receipt existence alone is not success; failures preserve partial candidates for inspection.
  verifyNativeServiceCandidate({ workspace, receiptPath: join(output, 'receipt.json') });
  return receipt;
}

export function main(args = process.argv.slice(2)) {
  const usage = 'Usage: node prepare-native-service-candidate.mjs [--member-binding] [--output directory] | --verify-receipt receipt.json';
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--member-binding') {
      assert.equal(options.memberBinding, undefined, usage);
      options.memberBinding = true;
    } else {
      assert.ok(['--output', '--verify-receipt'].includes(arg), usage);
      const key = arg === '--output' ? 'output' : 'receiptPath';
      assert.equal(options[key], undefined, usage);
      const value = args[++index];
      assert.ok(value && !value.startsWith('--'), usage);
      options[key] = resolve(value);
    }
  }
  if (options.receiptPath) {
    assert.equal(options.output, undefined, usage);
    assert.equal(options.memberBinding, undefined, usage);
    const verified = verifyNativeServiceCandidate(options);
    console.log(JSON.stringify(verified, null, 2));
    return verified;
  }
  options.output ||= join(workspaceRoot, '.artifacts/native-service-migration',
    options.memberBinding
      ? `member-session-binding-${new Date().toISOString().replaceAll(':', '-')}-${randomUUID()}` : 'current');
  const receipt = prepareNativeServiceCandidate(options);
  console.log(`Prepared Central service candidate: ${options.output}`);
  console.log(`Receipt: ${join(options.output, 'receipt.json')}`);
  console.log(`Request: ${receipt.request.method} ${receipt.request.path}; production acceptance: false`);
  console.log('Permissions and native acceptance: false; mandatory --verify-receipt before deployment');
  return receipt;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    console.error(String(error));
    process.exitCode = 1;
  }
}
