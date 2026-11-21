import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  compileR05OwnedModel, prepareR05OwnedModel, r05Counters, r05Files, r05InputHashes,
  r05ModelRoot, verifyR05OwnedModel,
} from '../prepare-r05-owned-model.mjs';

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const originals = Object.fromEntries(Object.entries(r05Files).map(([key, path]) => [
  key, JSON.parse(readFileSync(join(workspace, r05ModelRoot, path))),
]));
const overview = item => item.codeName === 'SysOverviewCnt';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const dtoName = 'ModelObservationOverviewDTO';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'aibiz-r05-model-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const path of Object.values(r05Files)) {
    const destination = join(root, r05ModelRoot, path);
    mkdirSync(dirname(destination), { recursive: true });
    cpSync(join(workspace, r05ModelRoot, path), destination);
  }
  return { workspace: root, output: join(root, '.artifacts/r05-owned-model/candidate') };
}

function setVoid(result, key) {
  result.type = 'VOID';
  delete result[key];
}

test('rewrites all six return declarations and two exact five-field DTOs without mutating input', () => {
  const before = structuredClone(originals);
  const result = compileR05OwnedModel(originals);
  assert.deepEqual(originals, before);
  const action = result.entity.getAllPSDEActions.find(overview);
  assert.deepEqual(result.action, action);
  const declarations = [
    [result.action.getPSDEActionReturn, 'getPSDEMethodDTO'],
    [action.getPSDEActionReturn, 'getPSDEMethodDTO'],
    ...['getAllPSAppDEActions', 'getAllPSAppDEMethods'].map(key => [
      result.app[key].find(overview).getPSAppDEMethodReturn, 'getPSAppDEMethodDTO',
    ]),
    ...['getPSDEServiceAPIs', 'getPSDEServiceAPIRSs'].map(key => [
      result.api[key].find(item => item.getPSDEServiceAPIMethods?.some(overview))
        .getPSDEServiceAPIMethods.find(overview).getPSDEServiceAPIMethodReturn, 'getPSDEMethodDTO',
    ]),
  ];
  assert.equal(declarations.length, 6);
  for (const [declaration, key] of declarations) {
    assert.equal(declaration.type, 'DTO');
    assert.deepEqual(declaration[key], { modelref: true, id: dtoName });
  }
  for (const [dto, key] of [
    [result.entity.getAllPSDEMethodDTOs.at(-1), 'getPSDEMethodDTOFields'],
    [result.app.getAllPSAppDEMethodDTOs.at(-1), 'getPSAppDEMethodDTOFields'],
  ]) {
    assert.equal(dto.name, dtoName);
    assert.deepEqual(dto[key].map(field => field.name), r05Counters);
    for (const field of dto[key]) {
      assert.equal(field.stdDataType, 1, 'Native BIGINT, not a narrowed INT counter');
      assert.equal(field.type, 'SIMPLE');
      assert.equal(field.readOnly, true);
      assert.equal(field.allowEmpty, false);
      assert.ok(!field.getPSDEField && !field.getPSAppDEField);
    }
  }

  // Reverse only the documented changes. Everything else, including role
  // policy, plugins and the original logic, must remain structurally identical.
  for (const [declaration, key] of declarations) setVoid(declaration, key);
  result.entity.getAllPSDEMethodDTOs.pop();
  result.app.getAllPSAppDEMethodDTOs.pop();
  assert.deepEqual(result, originals);
});

test('rejects duplicate, missing and inconsistent overview declarations', () => {
  const variants = [
    value => value.entity.getAllPSDEActions.push(value.entity.getAllPSDEActions.find(overview)),
    value => value.entity.getAllPSDEActions.splice(value.entity.getAllPSDEActions.findIndex(overview), 1),
    value => { value.action.dataAccessAction = 'UPDATE'; },
    value => value.app.getAllPSAppDEActions.push(value.app.getAllPSAppDEActions.find(overview)),
    value => value.api.getPSDEServiceAPIs.push(value.api.getPSDEServiceAPIs.find(item =>
      item.codeName === 'ModelObservation')),
    value => {
      const service = value.api.getPSDEServiceAPIs.find(item => item.codeName === 'ModelObservation');
      service.getPSDEServiceAPIMethods.push(service.getPSDEServiceAPIMethods.find(overview));
    },
    value => value.entity.getAllPSDEMethodDTOs.push({ name: dtoName }),
    value => value.app.getAllPSAppDEMethodDTOs.push({ name: dtoName }),
    value => value.entity.getAllPSDEMethodDTOs.push({ name: dtoName.toLowerCase() }),
    value => value.app.getAllPSAppDEMethodDTOs.push({ name: 'modelobservationdto' }),
  ];
  for (const change of variants) {
    const input = structuredClone(originals);
    change(input);
    assert.throws(() => compileR05OwnedModel(input));
  }
});

test('rejects changed request, input, action, parent and legacy-return contracts', () => {
  const variants = [
    value => { value.app.getAllPSAppDEMethods.find(overview).requestMethod = 'GET'; },
    value => { value.app.getAllPSAppDEActions.find(overview).requestPath = '/other'; },
    value => { value.app.getAllPSAppDEMethods.find(overview).getPSAppDEMethodInput.output = true; },
    value => { value.app.getAllPSAppDEMethods.find(overview).getPSAppDEMethodReturn.type = 'DTO'; },
    value => { value.api.getPSDEServiceAPIs[1].getPSDEServiceAPIMethods.find(overview).dataAccessAction = 'UPDATE'; },
    value => { value.api.getPSDEServiceAPIRSs[1].getParentIdPSDEField.name = 'PSSYSTEMID'; },
    value => { value.api.getPSDEServiceAPIRSs[1].getMajorPSDEServiceAPI.id = 'ForeignRoot'; },
    value => { value.api.getPSDEServiceAPIs[1].getPSDEServiceAPIMethods.find(overview).getPSDEAction.path = 'other.json'; },
    value => {
      value.action.batchAction = true;
      value.entity.getAllPSDEActions.find(overview).batchAction = true;
    },
  ];
  for (const change of variants) {
    const input = structuredClone(originals);
    change(input);
    assert.throws(() => compileR05OwnedModel(input));
  }
});

test('rejects already rewritten inputs rather than silently layering another DTO', () => {
  assert.throws(() => compileR05OwnedModel(compileR05OwnedModel(originals)));
});

test('prepares and independently verifies a deterministic private four-file overlay', t => {
  const options = fixture(t);
  const receipt = prepareR05OwnedModel(options);
  assert.equal(receipt.status, 'prepared-metadata-only-not-bound');
  assert.equal(receipt.nativeAcceptance, false);
  assert.equal(receipt.acceptedForProduction, false);
  assert.equal(receipt.runtimeBindingVerified, false);
  assert.equal(receipt.outputs.files, 4);
  assert.deepEqual(verifyR05OwnedModel(options), receipt);
  for (const [key, path] of Object.entries(r05Files)) {
    const source = join(options.workspace, r05ModelRoot, path);
    assert.equal(hash(readFileSync(source)), r05InputHashes[key]);
    assert.equal(statSync(join(options.output, 'model', path)).mode & 0o777, 0o600);
  }
  const second = prepareR05OwnedModel({ ...options, output: `${options.output}-second` });
  assert.deepEqual(second, receipt);
});

test('requires explicit new output under the private R05 root and never overwrites', t => {
  const options = fixture(t);
  for (const output of [
    undefined, join(options.workspace, 'shared-model'),
    join(options.workspace, '.artifacts/r05-owned-model'),
    join(options.workspace, '.artifacts/r05-owned-model/../escape'),
  ]) {
    assert.throws(() => prepareR05OwnedModel({ ...options, output }));
  }
  prepareR05OwnedModel(options);
  const before = readFileSync(join(options.output, 'receipt.json'));
  assert.throws(() => prepareR05OwnedModel(options), /Existing destination/);
  assert.deepEqual(readFileSync(join(options.output, 'receipt.json')), before);
});

test('input hash drift fails before creating any candidate output', t => {
  const options = fixture(t);
  writeFileSync(join(options.workspace, r05ModelRoot, r05Files.action), '{}\n');
  assert.throws(() => prepareR05OwnedModel(options), /Reviewed R05 input drift/);
  assert.equal(existsSync(options.output), false);
});

test('rejects symlinked sources and output ancestors', t => {
  const options = fixture(t);
  const source = join(options.workspace, r05ModelRoot, r05Files.action);
  const target = `${source}.original`;
  cpSync(source, target);
  rmSync(source);
  symlinkSync(target, source);
  assert.throws(() => prepareR05OwnedModel(options), /Symlink resource/);
  rmSync(source);
  cpSync(target, source);
  const destination = join(options.workspace, 'outside-owned');
  mkdirSync(destination);
  mkdirSync(join(options.workspace, '.artifacts'), { recursive: true });
  symlinkSync(destination, join(options.workspace, '.artifacts/r05-owned-model'));
  assert.throws(() => prepareR05OwnedModel(options), /Symlink directory/);
  assert.equal(existsSync(join(destination, 'candidate')), false);
});

test('verification detects changed candidate bytes and changed receipt claims', t => {
  const options = fixture(t);
  prepareR05OwnedModel(options);
  const path = join(options.output, 'model', r05Files.action);
  const original = readFileSync(path);
  writeFileSync(path, Buffer.concat([original, Buffer.from('\n')]));
  assert.throws(() => verifyR05OwnedModel(options), /differs from reviewed generation/);
  writeFileSync(path, original);
  const receiptPath = join(options.output, 'receipt.json');
  const receipt = JSON.parse(readFileSync(receiptPath));
  receipt.nativeAcceptance = true;
  writeFileSync(receiptPath, JSON.stringify(receipt));
  assert.throws(() => verifyR05OwnedModel(options), /differs from reviewed generation/);
});

test('verification rejects extra output files and subsequently drifted source inputs', t => {
  const options = fixture(t);
  prepareR05OwnedModel(options);
  const extra = join(options.output, 'extra.json');
  writeFileSync(extra, '{}\n');
  assert.throws(() => verifyR05OwnedModel(options), /differs from reviewed generation/);
  rmSync(extra);
  writeFileSync(join(options.workspace, r05ModelRoot, r05Files.action), '{}\n');
  assert.throws(() => verifyR05OwnedModel(options), /Reviewed R05 input drift/);
});
