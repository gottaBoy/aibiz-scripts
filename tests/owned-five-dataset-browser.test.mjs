import assert from 'node:assert/strict';
import test from 'node:test';
import {
  observedDatasetRequest, readOnlyBrowserRequestAllowed, runOwnedFiveDatasetBrowser, verifyBrowserSentinels,
} from '../../modelingweb/app/tests/owned-five-dataset.browser.mjs';

const origin = 'http://127.0.0.1:32459';
const root = { rootId: 'nf_unit_root_a', logicalSystemId: 'nf_unit_logical_system' };
const foreign = { rootId: 'nf_unit_root_b', logicalSystemId: 'nf_unit_logical_system' };
const dataset = {
  entity: 'PSSysApp', query: 'CurSys', keyField: 'pssysappid', nameField: 'pssysappname',
  fetchPath: '/api/ibizmodeling__modeldesign/psdevslnsys/$ROOT_ID/pssysapps/fetchcursys',
  methods: { FetchCurSys: { method: 'POST', permission: 'READ' } },
  returnProjection: [{ field: 'pssystemname' }],
};
const path = dataset.fetchPath.replace('$ROOT_ID', root.rootId);
const record = { entity: dataset.entity, rootId: root.rootId, key: 'native-key-a',
  name: 'Owned fixture app A', logicalSystemId: root.logicalSystemId,
  userTag: 'own-marker-a', systemName: 'Physical system A' };
const otherRecord = { ...record, rootId: foreign.rootId, key: 'native-key-b',
  name: 'Owned fixture app B', userTag: 'own-marker-b', systemName: 'Physical system B' };
const receipt = { records: [record, otherRecord] };
const request = () => ({
  url: `${origin}${path}`, method: 'POST', contentType: 'application/json',
  body: JSON.stringify({ pssystemid: root.logicalSystemId, page: 0, size: 20, sort: 'updatedate,desc' }),
  headers: { authorizationPresent: true, srfsystemid: 'ibizmodeling', srforgid: 'owned-org-a' },
});
const options = { origin, dataset, root, organization: 'owned-org-a' };

test('records the actual POST body and natural organization headers without returning a token', () => {
  const evidence = observedDatasetRequest(request(), options);
  assert.equal(evidence.publishedMethod, 'POST');
  assert.equal(evidence.observedMethod, 'POST');
  assert.equal(evidence.getAliasObserved, false);
  assert.deepEqual(evidence.body, JSON.parse(request().body));
  assert.equal(Object.hasOwn(evidence.headers, 'authorization'), false);
});

test('GET alias observations stay GET and retain the exact query instead of claiming published POST execution', () => {
  const observed = request();
  observed.url += `?pssystemid=${root.logicalSystemId}&page=0&size=20`;
  observed.method = 'GET';
  observed.body = null;
  const evidence = observedDatasetRequest(observed, options);
  assert.equal(evidence.observedMethod, 'GET');
  assert.equal(evidence.publishedMethod, 'POST');
  assert.equal(evidence.getAliasObserved, true);
  assert.equal(evidence.body, null);
  assert.deepEqual(evidence.query, { pssystemid: root.logicalSystemId, page: '0', size: '20' });
});

for (const [name, change] of [
  ['foreign origin', row => { row.url = `http://127.0.0.1:30250${path}`; }],
  ['foreign root', row => { row.url = `${origin}${dataset.fetchPath.replace('$ROOT_ID', foreign.rootId)}`; }],
  ['wrong dataset', row => { row.url = `${origin}${path.replace('fetchcursys', 'fetchdefault')}`; }],
  ['write method', row => { row.method = 'DELETE'; }],
  ['missing authentication', row => { row.headers.authorizationPresent = false; }],
  ['foreign organization', row => { row.headers.srforgid = 'another-org'; }],
  ['missing system filter', row => { row.body = '{"page":0,"size":20}'; }],
  ['root masquerading as logical system', row => { row.body = JSON.stringify({ pssystemid: root.rootId }); }],
  ['oversized page', row => { row.body = JSON.stringify({ pssystemid: root.logicalSystemId, size: 1001 }); }],
  ['hidden mutation payload', row => { row.body = JSON.stringify({ pssystemid: root.logicalSystemId, model: {} }); }],
  ['ambiguous duplicated query', row => { row.url += '?page=0&page=1'; }],
  ['GET with hidden body', row => { row.method = 'GET'; }],
]) {
  test(`dataset observation rejects ${name}`, () => {
    const row = request();
    change(row);
    assert.throws(() => observedDatasetRequest(row, options));
  });
}

const returned = () => ({
  pssysappid: record.key, pssysappname: record.name, pssystemid: record.logicalSystemId,
  usertag: record.userTag, pssystemname: record.systemName,
});

test('dataset acceptance requires the exact owned physical sentinel, including system name', () => {
  assert.deepEqual(verifyBrowserSentinels([returned()], dataset, root, receipt), record);
});

for (const [name, data] of [
  ['empty successful array', []],
  ['HTML-like fallback object', { data: [] }],
  ['duplicate row', [returned(), returned()]],
  ['unknown ID', [{ ...returned(), pssysappid: 'unknown' }]],
  ['foreign physical system name', [{ ...returned(), pssystemname: otherRecord.systemName }]],
  ['foreign root leakage in another field', [{ ...returned(), description: otherRecord.userTag }]],
]) {
  test(`sentinel verification rejects ${name}`, () => {
    assert.throws(() => verifyBrowserSentinels(data, dataset, root, receipt));
  });
}

test('read-only network policy permits source-published queries and normal login, never mutation methods', () => {
  const policy = { rootIds: [root.rootId, foreign.rootId],
    readFetchPaths: new Set(['pssysapps/fetchcursys']), readCollections: new Set(['pssysapps']) };
  assert.equal(readOnlyBrowserRequestAllowed({ method: 'POST', path }, policy), true);
  assert.equal(readOnlyBrowserRequestAllowed({ method: 'GET', path }, policy), true);
  assert.equal(readOnlyBrowserRequestAllowed({
    method: 'GET', path: `/api/ibizmodeling__modeldesign/psdevslnsys/${root.rootId}/pssysapps/native-key-a`,
  }, policy), true);
  assert.equal(readOnlyBrowserRequestAllowed({
    method: 'POST', path: '/api/ibizmodeling__modeldesign/v7/login',
  }, policy), true);
  assert.equal(readOnlyBrowserRequestAllowed({ method: 'GET', path: '/modeldesign/source-app/index.system.js' }, policy), true);
  for (const method of ['DELETE', 'PUT', 'PATCH']) {
    assert.equal(readOnlyBrowserRequestAllowed({ method, path }, policy), false);
  }
  for (const bad of [
    '/api/ibizmodeling__modeldesign/pssysapps', `${path}/extra`,
    path.replace(root.rootId, 'unowned-root'), path.replace('fetchcursys', 'importmodelv2'),
    '/api/ibizmodeling__central/pssysapps/fetchcursys',
  ]) assert.equal(readOnlyBrowserRequestAllowed({ method: 'POST', path: bad }, policy), false);
  assert.equal(readOnlyBrowserRequestAllowed({ method: 'GET', path: '/api/ibizmodeling__modeldesign/pssysapps/importmodelv2/anything' }, policy), false);
});

test('importing the browser module never starts execution and an absent explicit opt-in rejects immediately', async () => {
  await assert.rejects(runOwnedFiveDatasetBrowser({}), /Explicit --run-readonly-browser/);
});
