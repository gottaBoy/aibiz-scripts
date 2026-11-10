import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createFixture } from '../prepare-run-owned-native-nonadmin-fixture.mjs';
import {
  OPERATOR_PATH, executeOwnedOperatorDictionary, main, operatorDirectorySQL,
  guardedOperatorRuntime, runOperatorDictionaryChecks, verifyOperatorDirectory, verifyOperatorResponse, verifyOperatorSourceDefinitions,
} from '../harness-owned-operator-dictionary.mjs';
import { ownedPlatformRequest, validateOwnedPlatformRequest } from '../owned-platform-http.mjs';

const { manifest, credentials } = createFixture({
  runId: 'abcdef012345', scenario: 'two-center', modelVersion: 816,
  uaaSchemaMode: 'legacy-views', passwordStorageMode: 'sm3', secret: () => 'a'.repeat(36),
});
const sourcePaths = [
  'libs/ibiz-cloud-conf-core/src/main/java/net/ibizsys/central/cloud/conf/core/spring/controller/ConfRestController.java',
  'libs/ibiz-cloud-conf-core/src/main/java/net/ibizsys/central/cloud/conf/core/cloudutil/CloudConfUtilRuntimeBase.java',
  'libs/ibiz-cloud-saas-core/src/main/java/net/ibizsys/central/cloud/saas/core/cloudutil/CloudSaaSUtilRuntimeBase.java',
  'libs/ibiz-cloud-saas-ebsx/src/main/java/net/ibizsys/central/cloud/saas/ebsx/cloudutil/EBSXCloudSaaSUtilRuntime.java',
  'ibiz-ebsx-runtime/src/main/resources/sysmodel/saas-ebsx/PSMODULES/ou/PSDATAENTITIES/Employee/PSDEDATAQUERIES/Default/PSDEDQCODES/MYSQL5.json',
  'libs/ibiz-cloud-core/src/main/java/net/ibizsys/central/cloud/core/util/domain/CodeItem.java',
];
const sources = sourcePaths.map(path => readFileSync(new URL(`../../ibiz-service-hub/${path}`, import.meta.url), 'utf8'));
const sourceRows = manifest.users.flatMap(user => ['source', 'operator'].map(kind => ({
  kind, personId: user.personId, centerId: user.centerId, organizationId: `${user.centerId}_org`,
  text: user.loginname, loginname: user.loginname, employeeNumber: `code_${user.loginname}`, enabled: 1,
})));
const directory = verifyOperatorDirectory(manifest, sourceRows);
const user = manifest.users[0];
const response = selected => ({
  status: 200, error: null, data: { code: 'SysOperator',
    items: directory.filter(row => row.centerId === selected.centerId).map(row => ({
      id: row.value, label: row.text, value: row.value, text: row.text, iconclass: null,
    })) },
});

test('audited native operator path uses USERID/person name and tenant/org cache rather than model USERCODE', () => {
  const query = verifyOperatorSourceDefinitions(sources);
  assert.ok(query.includes('t1.ID as USERID'));
  const sql = operatorDirectorySQL(manifest, query);
  assert.ok(sql.includes("'personId',e.USERID"));
  assert.ok(sql.includes("'text',e.PERSONNAME"));
  assert.ok(sql.includes(`\`${manifest.schemas.uaa}\`.sys_person`));
  assert.ok(!/\b(?:UPDATE|DELETE|INSERT|GRANT|DROP)\b/.test(sql));
  assert.throws(() => operatorDirectorySQL(manifest, 'SELECT\n1; DELETE FROM sys_person'));
  const drift = [...sources];
  drift[1] = drift[1].replaceAll('codeItem.setValue(employee.getUserId())', 'codeItem.setValue(employee.getUserCode())');
  assert.throws(() => verifyOperatorSourceDefinitions(drift));
  const aliasDrift = [...sources];
  aliasDrift[5] = aliasDrift[5].replaceAll('this.set("id", val)', 'this.set("id", "other")');
  assert.throws(() => verifyOperatorSourceDefinitions(aliasDrift));
});

test('the new GET allowlist accepts only the exact reviewed SysOperator backend endpoint', () => {
  assert.doesNotThrow(() => validateOwnedPlatformRequest(manifest.runId, 'backend', OPERATOR_PATH, 'GET'));
  for (const path of [
    `${OPERATOR_PATH}?size=1`, `${OPERATOR_PATH}?trymode=true`, `${OPERATOR_PATH}/items`,
    '/dictionaries/codelist/sysoperator', '/dictionarys/codelist/SysOperator',
    '/dictionaries/codelist/Other', '/dictionaries/codelist/../admin',
  ]) assert.throws(() => validateOwnedPlatformRequest(manifest.runId, 'backend', path, 'GET'));
  assert.throws(() => validateOwnedPlatformRequest(manifest.runId, 'uaa', OPERATOR_PATH, 'GET'));
  assert.throws(() => validateOwnedPlatformRequest(manifest.runId, 'backend', OPERATOR_PATH, 'POST'));
});

test('source guard returns the inspected live origins to the real native HTTP transport', async () => {
  const live = { origins: { backend: 'http://10.92.0.9:30086', uaa: 'http://10.92.0.4:32666' } };
  const context = { manifest, guard: () => live };
  assert.equal(guardedOperatorRuntime(context, [], null), live);
  let fetched = false;
  const result = await ownedPlatformRequest({
    ...context, guard: () => guardedOperatorRuntime(context, [], null),
  }, { peer: 'backend', path: OPERATOR_PATH }, {
    fetchImplementation: async url => {
      fetched = true;
      assert.equal(url, `${live.origins.backend}${OPERATOR_PATH}`);
      return Response.json(response(user).data);
    },
  });
  assert.equal(fetched, true);
  assert.equal(result.status, 200);
  assert.equal(result.error, null);
  verifyOperatorResponse(result, user, directory);
});

test('directory proof requires six enabled authoritative persons and matching native projections', () => {
  assert.equal(directory.length, 6);
  for (const mutate of [
    rows => rows.pop(),
    rows => { rows[0].organizationId = `${manifest.roots[1].centerId}_org`; },
    rows => { rows[0].centerId = manifest.roots[1].centerId; },
    rows => { rows[0].employeeNumber = null; },
    rows => { rows[0].enabled = 0; },
    rows => { rows[1].text = 'invented'; },
    rows => { rows[1].personId = rows[3].personId; },
  ]) {
    const changed = structuredClone(sourceRows);
    mutate(changed);
    assert.throws(() => verifyOperatorDirectory(manifest, changed));
  }
});

test('operator values are exact nonempty person IDs, not the distinct model-level employee code', () => {
  const actual = verifyOperatorResponse(response(user), user, directory);
  assert.equal(actual.length, 3);
  assert.ok(actual.some(row => row.value === user.personId));
  const wrong = response(user);
  wrong.data.items[0].value = directory.find(row => row.personId === wrong.data.items[0].value).employeeNumber;
  assert.throws(() => verifyOperatorResponse(wrong, user, directory));
});

test('empty, duplicated, foreign-tenant, incorrect text and sensitive response fields never pass', () => {
  for (const mutate of [
    r => { r.status = 404; }, r => { r.error = 'timeout'; }, r => { r.data.items = []; },
    r => { r.data.code = 'Other'; }, r => { r.data = null; },
    r => { r.data.items[0] = structuredClone(r.data.items[1]); },
    r => { r.data.items[0].text = 'wrong-person'; },
    r => { r.data.items[0].id = 'different-id'; },
    r => { r.data.items[0].label = 'different-label'; },
    r => { delete r.data.items[0].id; },
    r => { r.data.items[0] = response(manifest.users[3]).data.items[0]; },
    r => { r.data.items[0].password = 'must-not-leak'; },
    r => { r.data.items[0].iconclass = { token: 'unexpected' }; },
    r => { r.data.token = 'unexpected'; },
  ]) {
    const changed = response(user);
    mutate(changed);
    assert.throws(() => verifyOperatorResponse(changed, user, directory));
  }
});

function fixture({ empty = false, foreign = false, serverError = false } = {}) {
  const sessions = new Map();
  let serial = 0;
  let guards = 0;
  const requests = [];
  const context = { manifest, credentials, guard() { guards++; } };
  const identity = selected => ({
    id: selected.personId, dc: selected.centerId, organization_id: `${selected.centerId}_org`,
    adminmode: 0, grants: [{ system_id: 'ibizmodeling', deploy_system_id: `${selected.centerId}_deploy`,
      roles: [{ authority: 'ROLE_NATIVE_FIXTURE', role_id: `${selected.centerId}_ordinary_role` }] }],
  });
  const send = async (_context, spec) => {
    requests.push(spec);
    const okay = data => ({ status: 200, error: null, data });
    if (spec.path === '/auths/login' || spec.path === '/v7/login') {
      const selected = manifest.users.find(user => user.loginname === spec.data.loginname);
      assert.equal(spec.data.password, credentials.users[selected.loginname]);
      const value = `e30.user${++serial}.c2ln`;
      sessions.set(value, selected);
      return okay({ token: value, user: identity(selected) });
    }
    if (spec.path === OPERATOR_PATH && !spec.token) return { status: 401, error: null, data: null };
    const selected = sessions.get(spec.token);
    assert.ok(selected);
    if (spec.path === '/auths/user-info/self') return okay(identity(selected));
    if (spec.path === '/uaa/oauth/userinfo') return okay({ sub: selected.loginname });
    if (spec.path === '/appdata') return okay({ context: {
      srfsystemid: 'ibizmodeling', srforgid: `${selected.centerId}_org`, srfuserid: selected.personId,
      srfpersonid: selected.personId, srfdcid: selected.centerId,
    } });
    assert.equal(spec.path, OPERATOR_PATH);
    assert.deepEqual(spec.applicationContext, { system: 'ibizmodeling', organization: `${selected.centerId}_org` });
    const result = response(selected);
    if (empty) result.data.items = [];
    if (foreign) result.data.items = response(manifest.users.find(user => user.centerId !== selected.centerId)).data.items;
    if (serverError) result.status = 500;
    return result;
  };
  return { context, send, requests, guards: () => guards };
}

test('all six ordinary roles exercise source-bound identity, list values and interleaved tenant repeats', async () => {
  const state = fixture();
  const report = await runOperatorDictionaryChecks({ ...state, directory });
  assert.equal(report.status, 'passed-bounded-native-sysoperator');
  assert.equal(report.checks.length, 43);
  assert.equal(report.actors.length, 6);
  assert.ok(report.checks.every(row => row.status === 'passed'));
  assert.equal(report.boundedOperatorDictionaryAcceptance, true);
  assert.deepEqual(report.actors.map(actor => actor.role), ['editor', 'editor', 'viewer', 'viewer', 'no-access', 'no-access']);
  assert.deepEqual(report.actors.map(actor => actor.centerId), [
    manifest.roots[0].centerId, manifest.roots[1].centerId,
    manifest.roots[0].centerId, manifest.roots[1].centerId,
    manifest.roots[0].centerId, manifest.roots[1].centerId,
  ]);
  assert.equal(report.nativeAcceptance, false);
  assert.equal(report.permissionAcceptance, false);
  assert.equal(state.guards(), 86);
  assert.ok(!JSON.stringify(report).includes(credentials.users[user.loginname]));
  assert.ok(!JSON.stringify(report).includes('e30.'));
  assert.ok(state.requests.every(spec => spec.method !== 'PUT' && spec.method !== 'DELETE'));
});

test('empty lists, foreign cache contents and upstream failures stop real acceptance', async () => {
  for (const options of [{ empty: true }, { foreign: true }, { serverError: true }]) {
    const state = fixture(options);
    const report = await runOperatorDictionaryChecks({ ...state, directory });
    assert.equal(report.status, 'failed-native-sysoperator');
    assert.equal(report.boundedOperatorDictionaryAcceptance, false);
    assert.ok(report.checks.some(row => row.status === 'failed'));
  }
});

test('owned execution and CLI refuse implicit execution, shared URLs and duplicate flags before Docker', async () => {
  await assert.rejects(executeOwnedOperatorDictionary({ runId: manifest.runId, label: 'unit' }));
  for (const args of [[], ['--service-url=http://shared'], ['--execute-owned-operator-dictionary', '--execute-owned-operator-dictionary'],
    [`--run-id=${manifest.runId}`, `--run-id=${manifest.runId}`]]) await assert.rejects(main(args));
});
