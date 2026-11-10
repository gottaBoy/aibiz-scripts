import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import {
  centralBindingDependencies, centralMemberBindingInput, executeCentralMemberBindingSql,
  verifyCentralProbeContainer,
} from '../harness-central-member-binding-sql.mjs';

const workspace = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const binding = 'scripts/fixtures/native-service-migration-contract.json';

test('existing pinned member-binding candidate changes only ordinary identity binding and both grid fetches', () => {
  const input = centralMemberBindingInput({ workspace });
  assert.equal(input.bindings.length, 14);
  for (const entry of input.bindings) {
    assert.equal(digest(readFileSync(join(workspace, entry.path))), entry.sha256);
  }
  const { original, candidate } = input.document;
  assert.deepEqual(candidate.centerAdminSQL, original.centerAdminSQL);
  assert.deepEqual(candidate.schemeAdminSQL, original.schemeAdminSQL);
  assert.equal(candidate.memberSQL.queryCode, original.memberSQL.queryCode);
  assert.deepEqual(candidate.memberSQL.getPSDEDataQueryCodeConds[1],
    original.memberSQL.getPSDEDataQueryCodeConds[1]);
  assert.doesNotMatch(original.memberSQL.getPSDEDataQueryCodeConds[0].customCond, /srfpersonid/i);
  assert.match(candidate.memberSQL.getPSDEDataQueryCodeConds[0].customCond,
    /t41\.`PSDEVUSEROBJID` = #\{ctx\.sessioncontext\.srfpersonid\}/);
  const group = candidate.backendEntity.getAllPSDEDataQueries[3].getPSDEDQMain
    .getChildPSDEDQJoins[0].getPSDEDQGroupCondition;
  assert.equal(group.condOp, 'AND');
  assert.deepEqual(group.getPSDEDQConditions.map(value => ({
    field: value.fieldName, source: value.getPSVARTypeId, value: value.condValue,
  })), [{ field: 'PSDEVUSEROBJID', source: 'SESSIONCONTEXT', value: 'SRFPERSONID' }]);
  assert.equal(group.getPSDEDQConditions[0].ignoreEmpty, undefined);
  assert.deepEqual(candidate.backendEntity.getAllPSDEDataQueries.slice(0, 3),
    original.backendEntity.getAllPSDEDataQueries.slice(0, 3));
  assert.equal(JSON.parse(readFileSync(join(workspace, binding))).permissionAcceptance.rowIsolationVerified, false);
});

test('input reads full actual native entity models and refuses pinned source drift before Docker', () => {
  const input = centralMemberBindingInput({ workspace });
  assert.deepEqual(input.document.entities.map(entry => entry.model.tableName), [
    'T_SRFPSDEVSLN', 'T_SRFPSDEVSLNUSER', 'T_SRFPSDEVUSER', 'T_SRFPSDEVUSEROBJ',
    'T_SRFPSDEVCENTER', 'T_SRFPSDCDEPLOYCENTER',
  ]);
  const root = mkdtempSync(join(tmpdir(), 'central-member-sql-model-'));
  try {
    for (const entry of input.bindings) {
      cpSync(join(workspace, entry.path), join(root, entry.path), { recursive: true });
    }
    const member = input.bindings.find(entry => entry.path.includes('/CurDCSLNUser/'));
    writeFileSync(join(root, member.path), `${readFileSync(join(root, member.path), 'utf8')} `);
    assert.throws(() => centralMemberBindingInput({ workspace: root }), /Pinned native Central source drift/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

function helperFixture() {
  const expected = {
    id: 'a'.repeat(64), name: 'central-member-sql-unit', imageId: `sha256:${'b'.repeat(64)}`,
    user: '1000:1000', nonce: 'unit-nonce',
    mounts: [['/workspace/probe.java', '/source/CentralMemberBindingSqlProbe.java'],
      ['/workspace/deps', '/dependencies'], ['/workspace/input', '/input']],
  };
  const container = {
    Id: expected.id, Name: `/${expected.name}`, Image: expected.imageId,
    Config: { User: expected.user, Labels: { 'aibiz.central-member-sql.nonce': expected.nonce } },
    HostConfig: { NetworkMode: 'none', ReadonlyRootfs: true, Privileged: false,
      CapDrop: ['ALL'], SecurityOpt: ['no-new-privileges'] },
    NetworkSettings: { Networks: { none: {} } },
    Mounts: expected.mounts.map(([Source, Destination]) => ({ Source, Destination, Type: 'bind', RW: false })),
  };
  return { expected, container };
}

test('probe runs without an application network or writable source/dependency bind', () => {
  const { expected, container } = helperFixture();
  assert.doesNotThrow(() => verifyCentralProbeContainer(container, expected));
  for (const mutate of [
    value => { value.Id = 'c'.repeat(64); },
    value => { value.Name = '/shared'; },
    value => { value.Image = `sha256:${'d'.repeat(64)}`; },
    value => { value.Config.User = '0'; },
    value => { value.Config.Labels['aibiz.central-member-sql.nonce'] = 'foreign'; },
    value => { value.HostConfig.NetworkMode = 'owned-backend'; },
    value => { value.NetworkSettings.Networks = { owned: {} }; },
    value => { value.HostConfig.ReadonlyRootfs = false; },
    value => { value.HostConfig.Privileged = true; },
    value => { value.HostConfig.CapDrop = []; },
    value => { value.HostConfig.SecurityOpt = []; },
    value => { value.Mounts[0].RW = true; },
    value => { value.Mounts[1].Source = '/foreign/deps'; },
    value => { value.Mounts.pop(); },
  ]) {
    const changed = structuredClone(container);
    mutate(changed);
    assert.throws(() => verifyCentralProbeContainer(changed, expected));
  }
});

test('compiler/dependency inputs are explicit and immutable, with no service URL or arbitrary image fallback', async () => {
  assert.equal(new Set(centralBindingDependencies).size, 8);
  assert.ok(centralBindingDependencies.includes('ibiz-model-8.1.0.584.1.jar'));
  assert.ok(centralBindingDependencies.includes('h2-1.4.200.jar'));
  let commands = 0;
  for (const options of [
    {}, { label: '../escape' }, { label: 'unit', compilerImage: 'jdk:latest' },
    { label: 'unit', compilerImage: `sha256:${'a'.repeat(64)}` },
    { label: 'unit', compilerImage: `sha256:${'a'.repeat(64)}`, dependencies: '/shared' },
  ]) {
    await assert.rejects(executeCentralMemberBindingSql(options, { execute() { commands++; } }));
  }
  assert.equal(commands, 0);
});
