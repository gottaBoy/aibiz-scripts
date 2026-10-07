import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync,
  statSync, symlinkSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { WORKSPACE } from '../harness-modeling-core-audit.mjs';
import {
  prepareNativeServiceCandidate, rewriteCentralMemberSessionBinding, rewriteCentralSchemeFetch,
  verifyNativeServiceCandidate,
} from '../prepare-native-service-candidate.mjs';

const fixturePath = 'scripts/fixtures/native-service-migration-contract.json';
const contract = JSON.parse(readFileSync(join(WORKSPACE, fixturePath)));
const documents = () => Object.fromEntries(Object.entries(contract.files).map(([key, file]) =>
  [key, JSON.parse(readFileSync(join(WORKSPACE, contract.sourceModelRoot, file.path)))]));
const bindingDocuments = () => ({
  ...documents(),
  ...Object.fromEntries(Object.entries(contract.memberBinding.files).map(([key, file]) =>
    [key, JSON.parse(readFileSync(join(WORKSPACE, contract.sourceModelRoot, file.path)))])),
});
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const backendFetch = model => model.service.getPSDEServiceAPIs
  .find(api => api.name === 'PSDEVSLN').getPSDEServiceAPIMethods
  .find(method => method.codeName === 'FetchCurDCSLNUser');
const handlerFetch = model => model.view.getPSControls[2]
  .getPSControlHandler.getPSHandlerActions[5];
const readPointer = (document, pointer) => pointer.slice(1).split('/')
  .reduce((value, key) => value[key], document);

function withCandidateWorkspace(run) {
  const workspace = mkdtempSync(join(tmpdir(), 'native-service-candidate-'));
  const fixture = join(workspace, fixturePath);
  const output = join(workspace, '.artifacts/native-service-migration/candidate');
  try {
    mkdirSync(dirname(fixture), { recursive: true });
    writeFileSync(fixture, `${JSON.stringify(contract, null, 2)}\n`);
    for (const file of Object.values({ ...contract.files, ...contract.memberBinding.files })) {
      const destination = join(workspace, contract.sourceModelRoot, file.path);
      mkdirSync(dirname(destination), { recursive: true });
      copyFileSync(join(WORKSPACE, contract.sourceModelRoot, file.path), destination);
    }
    return run({ workspace, fixture, output });
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

test('published query migration changes only both fetch references and leaves all inputs intact', () => {
  const model = documents();
  const before = structuredClone(model);
  const result = rewriteCentralSchemeFetch(model);
  assert.equal(result.getPSControls[2].getFetchPSControlAction.getPSAppDEMethod.id, 'FetchCurDCSLNUser');
  assert.equal(result.getPSControls[2].getPSControlHandler.getPSHandlerActions[5]
    .getPSAppDEMethod.id, 'FetchCurDCSLNUser');
  result.getPSControls[2].getFetchPSControlAction.getPSAppDEMethod.id = 'FetchDefault';
  result.getPSControls[2].getPSControlHandler.getPSHandlerActions[5]
    .getPSAppDEMethod.id = 'FetchDefault';
  assert.deepEqual(result, before.view);
  assert.deepEqual(model, before);
});

for (const [name, mutate] of [
  ['wrong view', model => { model.view.codeName = 'OtherGridView'; }],
  ['wrong entity', model => { model.view.getPSAppDataEntity.path = 'OtherEntity.json'; }],
  ['wrong control', model => { model.view.getPSControls[2].controlType = 'TREEVIEW'; }],
  ['already changed fetch', model => {
    model.view.getPSControls[2].getFetchPSControlAction.getPSAppDEMethod.id = 'FetchCurDC';
  }],
  ['already migrated primary fetch', model => {
    model.view.getPSControls[2].getFetchPSControlAction.getPSAppDEMethod.id = 'FetchCurDCSLNUser';
  }],
  ['missing primary method reference', model => {
    delete model.view.getPSControls[2].getFetchPSControlAction.getPSAppDEMethod;
  }],
  ['non-reference primary method', model => {
    model.view.getPSControls[2].getFetchPSControlAction.getPSAppDEMethod.modelref = false;
  }],
  ['wrong primary fetch identity', model => {
    model.view.getPSControls[2].getFetchPSControlAction.name = 'load';
  }],
  ['missing handler', model => { delete model.view.getPSControls[2].getPSControlHandler; }],
  ['missing handler actions', model => {
    delete model.view.getPSControls[2].getPSControlHandler.getPSHandlerActions;
  }],
  ['changed handler READ action', model => {
    model.view.getPSControls[2].getPSControlHandler.userDRAction = 'UPDATE';
  }],
  ['already migrated handler fetch', model => {
    handlerFetch(model).getPSAppDEMethod.id = 'FetchCurDCSLNUser';
  }],
  ['both fetches already migrated', model => {
    model.view.getPSControls[2].getFetchPSControlAction.getPSAppDEMethod.id = 'FetchCurDCSLNUser';
    handlerFetch(model).getPSAppDEMethod.id = 'FetchCurDCSLNUser';
  }],
  ['different handler dataset', model => { handlerFetch(model).getPSAppDEMethod.id = 'FetchCurDC'; }],
  ['missing handler method reference', model => { delete handlerFetch(model).getPSAppDEMethod; }],
  ['non-reference handler method', model => { handlerFetch(model).getPSAppDEMethod.modelref = false; }],
  ['wrong handler fetch type', model => { handlerFetch(model).actionType = 'DEACTION'; }],
  ['wrong handler fetch entity', model => {
    handlerFetch(model).getPSAppDataEntity.path = 'OtherEntity.json';
  }],
  ['missing handler fetch', model => {
    model.view.getPSControls[2].getPSControlHandler.getPSHandlerActions.pop();
  }],
  ['duplicate handler fetch', model => {
    model.view.getPSControls[2].getPSControlHandler.getPSHandlerActions
      .push(structuredClone(handlerFetch(model)));
  }],
  ['moved handler fetch', model => {
    model.view.getPSControls[2].getPSControlHandler.getPSHandlerActions.reverse();
  }],
  ['unpublished target', model => { backendFetch(model).codeName = 'OtherFetch'; }],
  ['wrong request verb', model => { backendFetch(model).requestMethod = 'GET'; }],
  ['missing READ action', model => { delete backendFetch(model).dataAccessAction; }],
  ['changed READ action', model => { backendFetch(model).dataAccessAction = 'UPDATE'; }],
  ['unfiltered backend dataset', model => { backendFetch(model).getPSDEDataSet.id = 'Default'; }],
  ['unfiltered app method', model => {
    model.entity.getAllPSAppDEMethods.find(method => method.codeName === 'FetchCurDCSLNUser')
      .requestPath = '/fetchdefault';
  }],
  ['changed published query union', model => {
    model.backendEntity.getAllPSDEDataSets.find(dataset => dataset.codeName === 'CurDCSLNUser')
      .getPSDEDataQueries = [{ id: 'Default' }];
  }],
  ['newly published default', model => {
    model.service.getPSDEServiceAPIs.find(api => api.name === 'PSDEVSLN')
      .getPSDEServiceAPIMethods.push({ codeName: 'FetchDefault' });
  }],
]) {
  test(`migration refuses ${name}`, () => {
    const model = documents();
    mutate(model);
    const before = structuredClone(model);
    assert.throws(() => rewriteCentralSchemeFetch(model), assert.AssertionError);
    assert.deepEqual(model, before, 'Rejected migrations must not partially mutate either reference');
  });
}

test('service candidate binds both diffs and hashes without accepting permissions or overwriting evidence', () => {
  withCandidateWorkspace(({ workspace, fixture, output }) => {
    const receipt = prepareNativeServiceCandidate({ workspace, output });
    assert.equal(receipt.contract, 'native-central-published-query-candidate');
    assert.equal(receipt.acceptedForProduction, false);
    assert.equal(receipt.status, 'prepared-not-accepted');
    assert.deepEqual(receipt.permissionAcceptance, {
      status: 'not-accepted', rowIsolationVerified: false, readActionProvesRowIsolation: false,
    });
    assert.match(receipt.semantics, /EXISTS of any scheme member, not SRFPERSONID/);
    assert.match(receipt.semantics, /READ is not proof of row isolation/);
    assert.ok(receipt.remainingAcceptance.includes(
      'current-user row isolation and cross-center permission negative cases'));
    assert.deepEqual(receipt.fixture, { path: fixturePath, sha256: hash(readFileSync(fixture)) });
    assert.equal(receipt.inputs.length, 4);
    assert.equal(receipt.outputs.length, 1);
    assert.deepEqual(receipt.changes, contract.changes.map(change =>
      ({ path: contract.files.view.path, ...change })));
    assert.equal(receipt.changes.length, 2);
    const original = JSON.parse(readFileSync(join(workspace, contract.sourceModelRoot, contract.files.view.path)));
    const candidate = JSON.parse(readFileSync(join(output, 'model', contract.files.view.path)));
    for (const change of receipt.changes) {
      assert.equal(change.from, readPointer(original, change.location));
      assert.equal(change.to, readPointer(candidate, change.location));
      assert.notEqual(change.from, change.to);
    }
    const restored = structuredClone(candidate);
    restored.getPSControls[2].getFetchPSControlAction.getPSAppDEMethod.id = 'FetchDefault';
    restored.getPSControls[2].getPSControlHandler.getPSHandlerActions[5]
      .getPSAppDEMethod.id = 'FetchDefault';
    assert.deepEqual(restored, original, 'Receipt must account for every semantic output change');
    for (const input of receipt.inputs) {
      assert.equal(hash(readFileSync(join(workspace, contract.sourceModelRoot, input.path))), input.sha256);
    }
    const target = receipt.outputs[0];
    assert.equal(hash(readFileSync(join(output, 'model', target.path))), target.sha256);
    assert.deepEqual(JSON.parse(readFileSync(join(output, 'receipt.json'))), receipt);
    assert.throws(() => prepareNativeServiceCandidate({ workspace, output }), /must not be overwritten/);
    assert.throws(() => prepareNativeServiceCandidate({ workspace, output: join(workspace, 'plm/model') }),
      /must stay under/);
  });
});

for (const [name, mutate] of [
  ['old authorized contract', fixture => { fixture.contract = 'native-central-authorized-scheme-fetch'; }],
  ['obsolete single-reference declaration', fixture => { fixture.change = fixture.changes[0]; }],
  ['missing change list', fixture => { delete fixture.changes; }],
  ['only one declared reference', fixture => { fixture.changes.pop(); }],
  ['duplicate diff pointer', fixture => { fixture.changes[1] = structuredClone(fixture.changes[0]); }],
  ['wrong primary diff pointer', fixture => { fixture.changes[0].location = '/other/id'; }],
  ['wrong handler diff pointer', fixture => { fixture.changes[1].location = '/other/id'; }],
  ['wrong primary original value', fixture => { fixture.changes[0].from = 'FetchCurDC'; }],
  ['wrong handler original value', fixture => { fixture.changes[1].from = 'FetchCurDC'; }],
  ['wrong primary target value', fixture => { fixture.changes[0].to = 'FetchDefault'; }],
  ['wrong handler target value', fixture => { fixture.changes[1].to = 'FetchDefault'; }],
  ['wrong request method', fixture => { fixture.request.method = 'GET'; }],
  ['wrong request path', fixture => { fixture.request.path = '/api/other/fetchdefault'; }],
  ['wrong backend request path', fixture => { fixture.request.backendPath = '/serviceapi/psdevslns/fetchdefault'; }],
  ['wrong request READ action', fixture => { fixture.request.dataAccessAction = 'UPDATE'; }],
  ['wrong request dataset', fixture => { fixture.request.dataset = 'Default'; }],
  ['claimed permission acceptance', fixture => { fixture.permissionAcceptance.status = 'accepted'; }],
  ['claimed row isolation', fixture => { fixture.permissionAcceptance.rowIsolationVerified = true; }],
  ['READ claimed as row-isolation proof', fixture => {
    fixture.permissionAcceptance.readActionProvesRowIsolation = true;
  }],
  ['claimed current-user-only semantics', fixture => {
    fixture.semantics = 'The scheme grid only lists schemes accessible to the current user.';
  }],
  ['missing pinned source', fixture => { delete fixture.files.backendEntity; }],
  ['wrong pinned view path', fixture => { fixture.files.view.path = 'OtherGridView.json'; }],
  ['changed source root', fixture => { fixture.sourceModelRoot = '../outside'; }],
  ['changed source commit', fixture => { fixture.sourceCommit = 'other'; }],
  ['forged original source hash', fixture => { fixture.files.backendEntity.sha256 = '0'.repeat(64); }],
]) {
  test(`prepare fails before writing for ${name}`, () => {
    withCandidateWorkspace(({ workspace, fixture, output }) => {
      const changed = structuredClone(contract);
      mutate(changed);
      writeFileSync(fixture, `${JSON.stringify(changed, null, 2)}\n`);
      assert.throws(() => prepareNativeServiceCandidate({ workspace, output }), assert.AssertionError);
      assert.equal(existsSync(output), false, 'Invalid evidence must not produce a candidate or receipt');
    });
  });
}

for (const [key, file] of Object.entries(contract.files)) {
  test(`prepare fails before writing when pinned ${key} bytes change`, () => {
    withCandidateWorkspace(({ workspace, output }) => {
      const source = join(workspace, contract.sourceModelRoot, file.path);
      writeFileSync(source, Buffer.concat([readFileSync(source), Buffer.from('\n')]));
      assert.throws(() => prepareNativeServiceCandidate({ workspace, output }),
        /Pinned native source changed/);
      assert.equal(existsSync(output), false, 'Hash mismatches must leave no candidate or receipt');
    });
  });
}

test('service compose overlays only the Central candidate view read-only', () => {
  const bytes = execFileSync('docker', [
    'compose', '--env-file', '.dev', '-f', 'docker-compose-dev.yml',
    '-f', 'docker-compose-modeling-native-candidate.yml',
    '-f', 'docker-compose-modeling-native-service-candidate.yml',
    '--profile', 'modeling', '--profile', 'modeling-native-candidate',
    'config', '--format', 'json',
  ], {
    cwd: join(WORKSPACE, 'plm/deploy/compose'), encoding: 'utf8', timeout: 30_000,
    env: { ...process.env, NATIVE_SERVICE_CANDIDATE_ROOT: '/tmp/native-service-contract-fixture' },
  });
  const config = JSON.parse(bytes);
  const target = `/app/model/${contract.files.view.path}`;
  const central = config.services['modelingweb-candidate-central'].volumes
    .filter(volume => volume.target === target);
  assert.equal(central.length, 1);
  assert.equal(central[0].read_only, true);
  assert.equal(central[0].source,
    `/tmp/native-service-contract-fixture/model/${contract.files.view.path}`);
  assert.ok(!config.services['modelingweb-candidate-modeldesign'].volumes
    .some(volume => volume.target === target));
  assert.equal(config.services['modelingweb-candidate-central'].volumes
    .filter(volume => volume.target.endsWith('.json')).length, 7);
});

const memberJoin = model => model.backendEntity.getAllPSDEDataQueries[3]
  .getPSDEDQMain.getChildPSDEDQJoins[0];
const memberSQLCond = model => model.memberSQL.getPSDEDataQueryCodeConds[0];
const bindingSourceFiles = { ...contract.files, ...contract.memberBinding.files };
const receiptPath = output => join(output, 'receipt.json');
const readCandidate = (output, path) => JSON.parse(readFileSync(join(output, 'model', path)));

function fileSnapshots(workspace, paths) {
  return paths.map(path => {
    const absolute = join(workspace, path);
    const stat = statSync(absolute);
    return { path, sha256: hash(readFileSync(absolute)), size: stat.size,
      mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, ino: stat.ino };
  });
}

function candidatePaths(output) {
  const result = ['receipt.json'];
  function walk(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else result.push(path.slice(output.length + 1));
    }
  }
  walk(join(output, 'model'));
  return result;
}

test('member-binding candidate changes exactly the two fetch refs, absent join condition and member SQL', () => {
  const model = bindingDocuments();
  const before = structuredClone(model);
  const candidate = rewriteCentralMemberSessionBinding(model);
  assert.deepEqual(model, before, 'All original model objects must remain read-only');
  assert.deepEqual(memberJoin(candidate).getPSDEDQGroupCondition, contract.memberBinding.changes[0].to);
  assert.equal(memberSQLCond(candidate).customCond, contract.memberBinding.changes[1].to);
  assert.match(memberSQLCond(candidate).customCond, /#\{ctx\.sessioncontext\.srfpersonid\}/);
  assert.doesNotMatch(memberSQLCond(candidate).customCond, /datacontext\.srfpersonid/);
  assert.deepEqual(candidate.backendEntity.getAllPSDEDataQueries.slice(0, 3),
    before.backendEntity.getAllPSDEDataQueries.slice(0, 3), 'Center/admin queries must remain unchanged');
  assert.deepEqual(candidate.backendEntity.getAllPSDEDataSets, before.backendEntity.getAllPSDEDataSets);
  assert.equal(backendFetch(model).dataAccessAction, 'READ');
  assert.equal(candidate.view.getPSControls[2].getFetchPSControlAction.getPSAppDEMethod.id,
    'FetchCurDCSLNUser');
  assert.equal(handlerFetch(candidate).getPSAppDEMethod.id, 'FetchCurDCSLNUser');
  delete memberJoin(candidate).getPSDEDQGroupCondition;
  memberSQLCond(candidate).customCond = contract.memberBinding.changes[1].from;
  candidate.view.getPSControls[2].getFetchPSControlAction.getPSAppDEMethod.id = 'FetchDefault';
  handlerFetch(candidate).getPSAppDEMethod.id = 'FetchDefault';
  assert.deepEqual(candidate, {
    view: before.view, backendEntity: before.backendEntity, memberSQL: before.memberSQL,
  }, 'The four recorded patch locations must account for every semantic change');
});

for (const [name, mutate] of [
  ['already added member conditions', model => {
    memberJoin(model).getPSDEDQGroupCondition = structuredClone(contract.memberBinding.changes[0].to);
  }],
  ['null member conditions', model => { memberJoin(model).getPSDEDQGroupCondition = null; }],
  ['empty member conditions', model => { memberJoin(model).getPSDEDQGroupCondition = {}; }],
  ['changed member join', model => { memberJoin(model).joinType = 'N1'; }],
  ['changed center scope', model => {
    model.backendEntity.getAllPSDEDataQueries[3].getPSDEDQMain
      .getPSDEDQGroupCondition.getPSDEDQConditions[0].condValue = 'other-center';
  }],
  ['changed center admin conditions', model => {
    model.backendEntity.getAllPSDEDataQueries[1].getPSDEDQMain.getChildPSDEDQJoins[0]
      .getChildPSDEDQJoins[0].getChildPSDEDQJoins[0]
      .getPSDEDQGroupCondition.getPSDEDQConditions[1].getPSVARTypeId = 'DATACONTEXT';
  }],
  ['changed scheme admin conditions', model => {
    model.backendEntity.getAllPSDEDataQueries[2].getPSDEDQMain
      .getPSDEDQGroupCondition.getPSDEDQConditions[1].condValue = 'other-user';
  }],
  ['missing admin branch', model => {
    model.backendEntity.getAllPSDEDataSets[1].getPSDEDataQueries.shift();
  }],
  ['duplicate structured member query', model => {
    model.backendEntity.getAllPSDEDataQueries.push(structuredClone(model.backendEntity.getAllPSDEDataQueries[3]));
  }],
  ['different actual SQL reference', model => {
    model.backendEntity.getAllPSDEDataQueries[3].getAllPSDEDataQueryCodes[0].path = 'other-sql.json';
  }],
  ['additional SQL reference', model => {
    model.backendEntity.getAllPSDEDataQueries[3].getAllPSDEDataQueryCodes.push({ path: 'other-sql.json' });
  }],
  ['wrong member SQL identity', model => { model.memberSQL.id = 'other-sql.json'; }],
  ['wrong SQL dialect', model => { model.memberSQL.dBType = 'POSTGRESQL'; }],
  ['reformatted original SQL', model => { memberSQLCond(model).customCond += ' '; }],
  ['already bound member SQL', model => {
    memberSQLCond(model).customCond = contract.memberBinding.changes[1].to;
  }],
  ['request-controlled identity binding', model => {
    memberSQLCond(model).customCond = contract.memberBinding.changes[1].to
      .replace('sessioncontext.srfpersonid', 'datacontext.srfpersonid');
  }],
  ['SQL center scope removed', model => { model.memberSQL.getPSDEDataQueryCodeConds.pop(); }],
  ['SQL center-admin identity removed', model => {
    model.centerAdminSQL.getPSDEDataQueryCodeConds[0].customCond = '1=1';
  }],
  ['SQL scheme-admin identity removed', model => {
    model.schemeAdminSQL.getPSDEDataQueryCodeConds[0].customCond = '1=1';
  }],
  ['changed backend READ', model => { backendFetch(model).dataAccessAction = 'NONE'; }],
  ['changed handler READ', model => { model.view.getPSControls[2].getPSControlHandler.userDRAction = 'NONE'; }],
  ['inconsistent primary fetch', model => {
    model.view.getPSControls[2].getFetchPSControlAction.getPSAppDEMethod.id = 'FetchCurDC';
  }],
  ['inconsistent handler fetch', model => { handlerFetch(model).getPSAppDEMethod.id = 'FetchCurDC'; }],
]) {
  test(`member-binding rewrite fails closed for ${name}`, () => {
    const model = bindingDocuments();
    mutate(model);
    const before = structuredClone(model);
    assert.throws(() => rewriteCentralMemberSessionBinding(model), assert.AssertionError);
    assert.deepEqual(model, before, 'Rejected inputs must not be partially patched');
  });
}

test('member receipt pins all actual referenced SQL before/after and verifies without touching originals or artifacts', () => {
  withCandidateWorkspace(({ workspace, output }) => {
    const originals = [fixturePath, ...Object.values(bindingSourceFiles)
      .map(file => join(contract.sourceModelRoot, file.path))];
    const originalSnapshot = fileSnapshots(workspace, originals);
    const receipt = prepareNativeServiceCandidate({ workspace, output, memberBinding: true });
    assert.equal(receipt.schemaVersion, 2);
    assert.equal(receipt.contract, contract.memberBinding.contract);
    assert.equal(receipt.status, 'prepared-member-binding-not-accepted');
    assert.equal(receipt.nativeAccepted, false);
    assert.equal(receipt.acceptedForProduction, false);
    assert.equal(receipt.originalsReadOnly, true);
    assert.deepEqual(receipt.permissionAcceptance, contract.permissionAcceptance);
    assert.equal(receipt.inputs.length, 7);
    assert.equal(receipt.outputs.length, 5);
    assert.equal(receipt.changes.length, 4);
    assert.deepEqual(receipt.changes.slice(2), contract.memberBinding.changes);
    assert.match(receipt.semantics, /Identity binding is not complete permission parity/);
    assert.match(receipt.trustBoundary, /writable-group/);
    assert.match(receipt.trustBoundary, /not an atomic multi-file snapshot/);
    assert.deepEqual(fileSnapshots(workspace, originals), originalSnapshot);
    const backend = readCandidate(output, contract.files.backendEntity.path);
    const originalBackend = JSON.parse(readFileSync(join(workspace, contract.sourceModelRoot,
      contract.files.backendEntity.path)));
    for (const binding of receipt.sqlBindings) {
      assert.equal(readPointer(originalBackend, binding.reference.location), binding.path);
      assert.equal(readPointer(backend, binding.reference.location), binding.path);
      assert.equal(binding.reference.from, binding.path);
      assert.equal(binding.reference.to, binding.path);
      assert.equal(binding.sourceSha256,
        hash(readFileSync(join(workspace, contract.sourceModelRoot, binding.path))));
      assert.equal(binding.candidateSha256, hash(readFileSync(join(output, 'model', binding.path))));
      assert.equal(binding.changed, binding.query === 'CurDCSLNUser');
      assert.equal(binding.sourceSha256 === binding.candidateSha256, !binding.changed);
      if (!binding.changed) {
        assert.ok(readFileSync(join(output, 'model', binding.path))
          .equals(readFileSync(join(workspace, contract.sourceModelRoot, binding.path))),
        'Both administrator SQL files must be copied byte-for-byte');
      }
    }
    const candidateSnapshot = fileSnapshots(output, candidatePaths(output));
    const verified = verifyNativeServiceCandidate({ workspace, receiptPath: receiptPath(output) });
    assert.equal(verified.status, 'verified-member-binding-candidate-not-accepted');
    assert.equal(verified.nativeAccepted, false);
    assert.equal(verified.acceptedForProduction, false);
    assert.deepEqual(verified.permissionAcceptance, contract.permissionAcceptance);
    assert.deepEqual(fileSnapshots(workspace, originals), originalSnapshot);
    assert.deepEqual(fileSnapshots(output, candidatePaths(output)), candidateSnapshot);
    assert.throws(() => prepareNativeServiceCandidate({ workspace, output, memberBinding: true }),
      /must not be overwritten/);
    assert.deepEqual(fileSnapshots(output, candidatePaths(output)), candidateSnapshot);
  });
});

test('legacy published-query candidate also has a read-only verifier and cannot pretend to bind member SQL', () => {
  withCandidateWorkspace(({ workspace, output }) => {
    const receipt = prepareNativeServiceCandidate({ workspace, output });
    assert.equal(receipt.outputs.length, 1);
    assert.equal(receipt.sqlBindings, undefined);
    const snapshot = fileSnapshots(output, candidatePaths(output));
    const verified = verifyNativeServiceCandidate({ workspace, receiptPath: receiptPath(output) });
    assert.equal(verified.status, 'verified-published-query-candidate-not-accepted');
    assert.equal(verified.permissionAcceptance.rowIsolationVerified, false);
    assert.deepEqual(fileSnapshots(output, candidatePaths(output)), snapshot);
  });
});

for (const [name, mutate] of [
  ['missing member-binding contract', fixture => { delete fixture.memberBinding; }],
  ['authorized contract name', fixture => { fixture.memberBinding.contract = 'authorized-current-user'; }],
  ['missing actual member SQL', fixture => { delete fixture.memberBinding.files.memberSQL; }],
  ['missing admin SQL', fixture => { delete fixture.memberBinding.files.centerAdminSQL; }],
  ['extra SQL source', fixture => { fixture.memberBinding.files.otherSQL = fixture.memberBinding.files.memberSQL; }],
  ['changed SQL path', fixture => { fixture.memberBinding.files.memberSQL.path = '../other.json'; }],
  ['forged SQL hash', fixture => { fixture.memberBinding.files.memberSQL.sha256 = '0'.repeat(64); }],
  ['wrong structured patch path', fixture => { fixture.memberBinding.changes[0].location = '/other'; }],
  ['invented original conditions', fixture => { fixture.memberBinding.changes[0].fromExists = true; }],
  ['weakened structured operator', fixture => { fixture.memberBinding.changes[0].to.condOp = 'OR'; }],
  ['request-controlled structured identity', fixture => {
    fixture.memberBinding.changes[0].to.getPSDEDQConditions[0].getPSVARTypeId = 'DATACONTEXT';
  }],
  ['wrong SQL patch path', fixture => { fixture.memberBinding.changes[1].location = '/queryCode'; }],
  ['forged original SQL', fixture => { fixture.memberBinding.changes[1].from = '1=1'; }],
  ['request-controlled SQL target', fixture => {
    fixture.memberBinding.changes[1].to = fixture.memberBinding.changes[1].to
      .replace('sessioncontext', 'datacontext');
  }],
  ['claimed member-binding acceptance', fixture => { fixture.memberBinding.acceptance = 'accepted'; }],
  ['claimed member-binding permissions', fixture => { fixture.memberBinding.semantics = 'Current user only'; }],
  ['weakened trust boundary', fixture => { fixture.memberBinding.trustBoundary = 'Safe against every writer'; }],
  ['claimed legacy acceptance', fixture => { fixture.acceptance = 'accepted'; }],
]) {
  test(`member-binding prepare refuses ${name} before any output`, () => {
    withCandidateWorkspace(({ workspace, fixture, output }) => {
      const changed = structuredClone(contract);
      mutate(changed);
      writeFileSync(fixture, `${JSON.stringify(changed, null, 2)}\n`);
      assert.throws(() => prepareNativeServiceCandidate({ workspace, output, memberBinding: true }),
        assert.AssertionError);
      assert.equal(existsSync(output), false);
    });
  });
}

for (const [key, file] of Object.entries(bindingSourceFiles)) {
  test(`member-binding prepare refuses changed ${key} source bytes`, () => {
    withCandidateWorkspace(({ workspace, output }) => {
      const source = join(workspace, contract.sourceModelRoot, file.path);
      writeFileSync(source, Buffer.concat([readFileSync(source), Buffer.from('\n')]));
      assert.throws(() => prepareNativeServiceCandidate({ workspace, output, memberBinding: true }),
        /Pinned native source changed/);
      assert.equal(existsSync(output), false);
    });
  });
}

const outputTamperCases = [
  ['member SQL identity binding', 'memberSQL', sql => {
    sql.getPSDEDataQueryCodeConds[0].customCond = contract.memberBinding.changes[1].from;
  }],
  ['member SQL center scope', 'memberSQL', sql => { sql.getPSDEDataQueryCodeConds.pop(); }],
  ['center-admin SQL', 'centerAdminSQL', sql => { sql.getPSDEDataQueryCodeConds[0].customCond = '1=1'; }],
  ['scheme-admin SQL', 'schemeAdminSQL', sql => { sql.getPSDEDataQueryCodeConds[0].customCond = '1=1'; }],
  ['structured member condition', 'backendEntity', backend => {
    backend.getAllPSDEDataQueries[3].getPSDEDQMain.getChildPSDEDQJoins[0]
      .getPSDEDQGroupCondition.getPSDEDQConditions[0].getPSVARTypeId = 'DATACONTEXT';
  }],
  ['structured member condition removed', 'backendEntity', backend => {
    delete backend.getAllPSDEDataQueries[3].getPSDEDQMain.getChildPSDEDQJoins[0].getPSDEDQGroupCondition;
  }],
  ['structured center scope', 'backendEntity', backend => {
    backend.getAllPSDEDataQueries[3].getPSDEDQMain.getPSDEDQGroupCondition.getPSDEDQConditions[0]
      .condValue = 'other-center';
  }],
  ['structured admin branch', 'backendEntity', backend => {
    backend.getAllPSDEDataQueries[2].getPSDEDQMain.getPSDEDQGroupCondition.getPSDEDQConditions.pop();
  }],
  ['dataset admin union', 'backendEntity', backend => { backend.getAllPSDEDataSets[1].getPSDEDataQueries.shift(); }],
  ['actual SQL reference', 'backendEntity', backend => {
    backend.getAllPSDEDataQueries[3].getAllPSDEDataQueryCodes[0].path = 'other.json';
  }],
  ['primary fetch consistency', 'view', view => {
    view.getPSControls[2].getFetchPSControlAction.getPSAppDEMethod.id = 'FetchDefault';
  }],
  ['handler fetch consistency', 'view', view => {
    view.getPSControls[2].getPSControlHandler.getPSHandlerActions[5].getPSAppDEMethod.id = 'FetchDefault';
  }],
  ['handler READ', 'view', view => { view.getPSControls[2].getPSControlHandler.userDRAction = 'NONE'; }],
];

for (const [name, key, mutate] of outputTamperCases) {
  for (const forgeHashes of [false, true]) {
    test(`verifier refuses altered ${name}${forgeHashes ? ' even with rewritten receipt hashes' : ''}`, () => {
      withCandidateWorkspace(({ workspace, output }) => {
        prepareNativeServiceCandidate({ workspace, output, memberBinding: true });
        const file = bindingSourceFiles[key];
        const candidate = readCandidate(output, file.path);
        mutate(candidate);
        const bytes = Buffer.from(`${JSON.stringify(candidate, null, 2)}\n`);
        writeFileSync(join(output, 'model', file.path), bytes);
        if (forgeHashes) {
          const receipt = JSON.parse(readFileSync(receiptPath(output)));
          receipt.outputs.find(item => item.path === file.path).sha256 = hash(bytes);
          for (const binding of receipt.sqlBindings.filter(item => item.path === file.path)) {
            binding.candidateSha256 = hash(bytes);
          }
          writeFileSync(receiptPath(output), `${JSON.stringify(receipt, null, 2)}\n`);
        }
        const snapshot = fileSnapshots(output, candidatePaths(output));
        assert.throws(() => verifyNativeServiceCandidate({ workspace, receiptPath: receiptPath(output) }),
          forgeHashes ? /Receipt must match/ : /Candidate output changed/);
        assert.deepEqual(fileSnapshots(output, candidatePaths(output)), snapshot,
          'Verification failure must preserve the candidate, never rewrite or remove it');
      });
    });
  }
}

for (const [name, mutate] of [
  ['production acceptance', receipt => { receipt.acceptedForProduction = true; }],
  ['native acceptance', receipt => { receipt.nativeAccepted = true; }],
  ['row isolation acceptance', receipt => { receipt.permissionAcceptance.rowIsolationVerified = true; }],
  ['permission acceptance', receipt => { receipt.permissionAcceptance.status = 'accepted'; }],
  ['source writable claim', receipt => { receipt.originalsReadOnly = false; }],
  ['accepted status', receipt => { receipt.status = 'accepted'; }],
  ['SQL binding source hash', receipt => { receipt.sqlBindings[2].sourceSha256 = '0'.repeat(64); }],
  ['SQL binding candidate hash', receipt => { receipt.sqlBindings[2].candidateSha256 = '0'.repeat(64); }],
  ['SQL binding reference pointer', receipt => { receipt.sqlBindings[2].reference.location = '/other'; }],
  ['SQL binding reference target', receipt => { receipt.sqlBindings[2].reference.to = '../other.json'; }],
  ['admin SQL falsely changed', receipt => { receipt.sqlBindings[0].changed = true; }],
  ['SQL binding omitted', receipt => { receipt.sqlBindings.pop(); }],
  ['structured diff omitted', receipt => { receipt.changes.splice(2, 1); }],
  ['SQL diff forged', receipt => { receipt.changes[3].to = '1=1'; }],
  ['extra diff', receipt => { receipt.changes.push(receipt.changes[0]); }],
  ['undeclared output', receipt => { receipt.outputs.push({ path: '../other', sha256: '0'.repeat(64) }); }],
  ['stale fixture hash', receipt => { receipt.fixture.sha256 = '0'.repeat(64); }],
  ['extra success claim', receipt => { receipt.rowIsolationVerified = true; }],
  ['invalid timestamp', receipt => { receipt.generatedAt = 'not-a-date'; }],
]) {
  test(`verifier refuses forged ${name} without writing`, () => {
    withCandidateWorkspace(({ workspace, output }) => {
      prepareNativeServiceCandidate({ workspace, output, memberBinding: true });
      const receipt = JSON.parse(readFileSync(receiptPath(output)));
      mutate(receipt);
      writeFileSync(receiptPath(output), `${JSON.stringify(receipt, null, 2)}\n`);
      const snapshot = fileSnapshots(output, candidatePaths(output));
      assert.throws(() => verifyNativeServiceCandidate({ workspace, receiptPath: receiptPath(output) }),
        assert.AssertionError);
      assert.deepEqual(fileSnapshots(output, candidatePaths(output)), snapshot);
    });
  });
}

for (const [key, file] of Object.entries(bindingSourceFiles)) {
  test(`verifier rejects stale ${key} original rather than accepting old candidate evidence`, () => {
    withCandidateWorkspace(({ workspace, output }) => {
      prepareNativeServiceCandidate({ workspace, output, memberBinding: true });
      const source = join(workspace, contract.sourceModelRoot, file.path);
      writeFileSync(source, Buffer.concat([readFileSync(source), Buffer.from('\n')]));
      const snapshot = fileSnapshots(output, candidatePaths(output));
      assert.throws(() => verifyNativeServiceCandidate({ workspace, receiptPath: receiptPath(output) }),
        /Pinned native source changed/);
      assert.deepEqual(fileSnapshots(output, candidatePaths(output)), snapshot);
    });
  });
}

for (const kind of ['file', 'empty directory']) {
  test(`verifier rejects an undeclared ${kind}`, () => {
    withCandidateWorkspace(({ workspace, output }) => {
      prepareNativeServiceCandidate({ workspace, output, memberBinding: true });
      if (kind === 'file') writeFileSync(join(output, 'other.json'), '{}');
      else mkdirSync(join(output, 'unexpected'));
      assert.throws(() => verifyNativeServiceCandidate({ workspace, receiptPath: receiptPath(output) }),
        /Exactly the declared|Undeclared empty/);
      assert.equal(existsSync(join(output, kind === 'file' ? 'other.json' : 'unexpected')), true);
    });
  });
}

test('verifier rejects missing member SQL and preserves the failed candidate receipt', () => {
  withCandidateWorkspace(({ workspace, output }) => {
    prepareNativeServiceCandidate({ workspace, output, memberBinding: true });
    rmSync(join(output, 'model', contract.memberBinding.files.memberSQL.path));
    const before = readFileSync(receiptPath(output));
    assert.throws(() => verifyNativeServiceCandidate({ workspace, receiptPath: receiptPath(output) }));
    assert.ok(readFileSync(receiptPath(output)).equals(before));
  });
});

test('generation rejects a symlinked artifact ancestor without writing into the original model', () => {
  withCandidateWorkspace(({ workspace, output }) => {
    const originalRoot = join(workspace, contract.sourceModelRoot);
    const snapshot = fileSnapshots(workspace, Object.values(bindingSourceFiles)
      .map(file => join(contract.sourceModelRoot, file.path)));
    mkdirSync(join(workspace, '.artifacts'));
    symlinkSync(originalRoot, dirname(output), 'dir');
    assert.throws(() => prepareNativeServiceCandidate({ workspace, output, memberBinding: true }),
      /ancestors must be real directories/);
    assert.equal(existsSync(join(originalRoot, 'candidate')), false);
    assert.deepEqual(fileSnapshots(workspace, Object.values(bindingSourceFiles)
      .map(file => join(contract.sourceModelRoot, file.path))), snapshot);
  });
});

test('verifier rejects a symlinked SQL output without touching its original target', () => {
  withCandidateWorkspace(({ workspace, output }) => {
    prepareNativeServiceCandidate({ workspace, output, memberBinding: true });
    const path = contract.memberBinding.files.memberSQL.path;
    const original = join(workspace, contract.sourceModelRoot, path);
    const snapshot = fileSnapshots(workspace, [join(contract.sourceModelRoot, path)]);
    const candidate = join(output, 'model', path);
    rmSync(candidate);
    symlinkSync(original, candidate);
    assert.throws(() => verifyNativeServiceCandidate({ workspace, receiptPath: receiptPath(output) }),
      /must not be symlinks/);
    assert.deepEqual(fileSnapshots(workspace, [join(contract.sourceModelRoot, path)]), snapshot);
  });
});

test('CLI generates and verifies a fresh member-binding candidate without deploying or granting acceptance', () => {
  withCandidateWorkspace(({ workspace, output }) => {
    const cli = join(workspace, 'scripts/prepare-native-service-candidate.mjs');
    copyFileSync(join(WORKSPACE, 'scripts/prepare-native-service-candidate.mjs'), cli);
    const generated = execFileSync(process.execPath, [cli, '--member-binding', '--output', output],
      { cwd: workspace, encoding: 'utf8', timeout: 30_000 });
    assert.match(generated, /Prepared Central service candidate/);
    assert.ok(generated.includes(receiptPath(output)));
    const verified = JSON.parse(execFileSync(process.execPath,
      [cli, '--verify-receipt', receiptPath(output)],
      { cwd: workspace, encoding: 'utf8', timeout: 30_000 }));
    assert.equal(verified.status, 'verified-member-binding-candidate-not-accepted');
    assert.equal(verified.nativeAccepted, false);
    const second = execFileSync(process.execPath, [cli, '--member-binding'],
      { cwd: workspace, encoding: 'utf8', timeout: 30_000 });
    assert.match(second, /member-session-binding-\d{4}-.*[a-f0-9-]{36}/);
    assert.equal(readdirSync(dirname(output)).length, 2, 'Default member-binding generation needs a fresh destination');
  });
});

for (const args of [
  ['--verify-receipt'], ['--output'], ['--member-binding', '--member-binding'],
  ['--unknown'], ['--output', '--member-binding'],
  ['--verify-receipt', 'receipt.json', '--member-binding'],
  ['--verify-receipt', 'receipt.json', '--output', 'other'],
]) {
  test(`CLI fails closed for invalid arguments ${args.join(' ')}`, () => {
    withCandidateWorkspace(({ workspace, output }) => {
      const cli = join(workspace, 'scripts/prepare-native-service-candidate.mjs');
      copyFileSync(join(WORKSPACE, 'scripts/prepare-native-service-candidate.mjs'), cli);
      assert.throws(() => execFileSync(process.execPath, [cli, ...args],
        { cwd: workspace, encoding: 'utf8', timeout: 30_000, stdio: 'pipe' }),
      error => error.status === 1 && /Usage:/.test(error.stderr));
      assert.equal(existsSync(output), false);
      assert.equal(existsSync(join(workspace, '.artifacts')), false);
    });
  });
}
