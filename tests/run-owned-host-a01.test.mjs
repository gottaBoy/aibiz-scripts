import assert from 'node:assert/strict';
import test from 'node:test';
import {
  executeOwnedHostA01, hostA01Endpoint, hostA01EndpointMappings, ownedA01LoginBody,
  validateOwnedHostA01Plan,
} from '../run-owned-host-a01.mjs';

const workspace = '/workspace';
const runId = '123456789abc';
const base = `${workspace}/.artifacts/native-nonadmin-fixtures/${runId}`;
const plan = {
  contract: 'owned-host-a01-plan-v1', runId, label: 'a01-host-r1', stage: 'authentication',
  dependencyDirectory: '.artifacts/host-dependencies',
  javaPath: '.artifacts/openjdk/bin/java',
  sourceBackendDirectory: `${base}/backend-runtime-owned-r1`,
  uaaConfigurationPath: `${base}/uaa-runtime-owned-r1/config/application.properties`,
  applicationAccountsPath: `${base}/application-accounts-owned-r1/accounts.private.json`,
  imageReportPath: '.artifacts/owned-images/report.json',
  uaaBuildReportPath: '.artifacts/owned-uaa-build/report.json',
};
plan.inputHashes = Object.fromEntries([
  `${base}/manifest.json`, `${base}/credentials.private.json`, plan.uaaConfigurationPath,
  plan.applicationAccountsPath, `${workspace}/${plan.imageReportPath}`,
  `${workspace}/${plan.uaaBuildReportPath}`,
  `${plan.sourceBackendDirectory}/nacos-configs.private.json`,
].map(path => [path, 'a'.repeat(64)]));

test('host A01 plans bind each original private input and only their own fixture run', () => {
  assert.equal(validateOwnedHostA01Plan(plan, workspace).directory, `${base}/backend-host-a01-host-r1`);
  for (const patch of [
    { stage: 'accepted' }, { runId: 'foreign' }, { javaPath: '/usr/bin/java' },
    { sourceBackendDirectory: `${workspace}/.artifacts/native-nonadmin-fixtures/000000000000/backend-runtime-r1` },
    { uaaConfigurationPath: '/shared/application.properties' },
    { applicationAccountsPath: `${base}/../shared/accounts.private.json` },
    { inputHashes: {} },
  ]) assert.throws(() => validateOwnedHostA01Plan({ ...plan, ...patch }, workspace));
  for (const path of Object.keys(plan.inputHashes)) {
    const changed = structuredClone(plan);
    delete changed.inputHashes[path];
    assert.throws(() => validateOwnedHostA01Plan(changed, workspace), /original SHA-256 binding/);
  }
});

test('host endpoint mapping changes only an identified fixture peer and its declared transport port', () => {
  const mappings = hostA01EndpointMappings(plan, workspace);
  assert.equal(hostA01Endpoint(`jdbc:mysql://nf-${runId}-mysql:3306/nf_${runId}_model_a?useUnicode=true`, mappings),
    `jdbc:mysql://127.0.0.1:13306/nf_${runId}_model_a?useUnicode=true`);
  assert.equal(hostA01Endpoint(`http://nf-${runId}-backend-owned-r1-allinone:30000/v7/login`, mappings),
    'http://127.0.0.1:13000/v7/login');
  assert.equal(hostA01Endpoint(`nf-${runId}-backend-owned-r1-nacos:8848`, mappings), '127.0.0.1:18848');
  assert.equal(hostA01Endpoint(`nf-${runId}-uaa-owned-r1-redis:6379`, mappings), '127.0.0.1:16379');
  for (const value of ['http://mysql:3306', `http://nf-${runId}-mysql:3307`,
    `http://user:password@nf-${runId}-mysql:3306`]) {
    assert.throws(() => hostA01Endpoint(value, mappings));
  }
  for (const value of [`nf_${runId}_root_a`, `lb://nf_${runId}_cloud_uaa`, '"quoted"\\line\nvalue']) {
    assert.equal(hostA01Endpoint(value, mappings), value);
  }
});

test('owned UAA and gateway login requests bind the actual fixture center', () => {
  const user = { loginname: `nf_${runId}_a_e`, centerId: `nf_${runId}_center_a` };
  assert.deepEqual(ownedA01LoginBody(user, 'private-password'), {
    loginname: user.loginname, password: 'private-password', dc: user.centerId,
  });
  for (const value of [
    { ...user, centerId: '' }, { ...user, centerId: undefined },
    { ...user, loginname: '' }, { ...user, loginname: undefined },
  ]) assert.throws(() => ownedA01LoginBody(value, 'private-password'));
  assert.throws(() => ownedA01LoginBody(user, ''));
});

test('host runner requires explicit execution before reading inputs or launching any process', async () => {
  for (const executeOwned of [undefined, false, 'true', 1]) {
    await assert.rejects(executeOwnedHostA01({ executeOwned }), /Explicit owned host A01 execution/);
  }
});
