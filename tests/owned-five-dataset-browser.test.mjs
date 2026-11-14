import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  nativeReadCollections, observedDatasetRequest, readOnlyBrowserRequestAllowed,
  runOwnedFiveDatasetBrowser, verifyBrowserSentinels,
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

test('native module POST preserves an omitted client filter when the authorized parent binds the system', () => {
  const nativeDataset = { ...dataset, entity: 'PSModule',
    fetchPath: dataset.fetchPath.replace('pssysapps', 'psmodules') };
  const nativeRequest = { ...request(),
    url: `${origin}${nativeDataset.fetchPath.replace('$ROOT_ID', root.rootId)}`,
    body: '{"srftitle":"Modules","page":0,"size":20,"sort":"updatedate,desc"}' };
  const original = structuredClone(nativeRequest);
  const evidence = observedDatasetRequest(nativeRequest, {
    ...options, dataset: nativeDataset, nativeModuleRootBinding: true,
  });
  assert.equal(evidence.systemFilterBinding, 'native-authorized-parent-root');
  assert.deepEqual(evidence.body, JSON.parse(original.body));
  assert.equal(Object.hasOwn(evidence.body, 'pssystemid'), false);
  assert.deepEqual(nativeRequest, original, 'Validation must never fabricate an outgoing filter');
  for (const [changedRequest, changedOptions] of [
    [{ ...nativeRequest, method: 'GET', body: null }, { ...options, dataset: nativeDataset }],
    [request(), options],
    [{ ...nativeRequest, body: '{"pssystemid":"foreign"}' }, { ...options, dataset: nativeDataset }],
    [{ ...nativeRequest, body: '{"n_pssystemid_eq":"foreign"}' }, { ...options, dataset: nativeDataset }],
    [{ ...nativeRequest, body: '{"n_pssystemid_in":"foreign"}' }, { ...options, dataset: nativeDataset }],
  ]) assert.throws(() => observedDatasetRequest(changedRequest, {
    ...changedOptions, nativeModuleRootBinding: true,
  }));
  assert.throws(() => observedDatasetRequest(nativeRequest, {
    ...options, dataset: nativeDataset,
  }), 'Other lanes still require their original explicit-filter contract');
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
    readFetchPaths: new Set(['pssysapps/fetchcursys']), readCollections: new Set(['pssysapps']),
    readRecordKeys: new Set(['native-key-a']) };
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

const builtinGet = () => ({
  name: 'Get', methodType: 'DEACTION', requestMethod: 'GET', dataAccessAction: 'READ',
  needResourceKey: true, noServiceCodeName: true,
  getPSDEAction: { path: 'PSMODULES/SysDesign/PSDATAENTITIES/PSModule/PSDEACTIONS/Get.json' },
});
const collectionModel = method => ({ getPSDEServiceAPIs: [{
  codeName2: 'PSModules', getPSDEServiceAPIMethods: [method],
}] });

test('read collections use the exact built-in Get name only when its codeName is absent', () => {
  assert.deepEqual([...nativeReadCollections(collectionModel(builtinGet()))], ['psmodules']);
  assert.deepEqual([...nativeReadCollections(collectionModel({
    ...builtinGet(), codeName: 'Get', name: 'Localized label',
  }))], ['psmodules']);
  for (const mutation of [
    method => { method.codeName = 'Other'; },
    method => { method.codeName = ''; },
    method => { method.name = 'Update'; method.requestMethod = 'PUT'; method.dataAccessAction = 'UPDATE'; },
    method => { method.name = 'get'; },
    method => { method.requestMethod = 'POST'; },
    method => { method.dataAccessAction = 'UPDATE'; },
    method => { method.methodType = 'FETCH'; },
    method => { method.needResourceKey = false; },
    method => { method.noServiceCodeName = false; },
    method => { method.getPSDEAction.path = 'PSDEACTIONS/Other.json'; },
  ]) {
    const method = builtinGet();
    mutation(method);
    assert.deepEqual([...nativeReadCollections(collectionModel(method))], []);
  }
});

test('actual native name-only Get definitions permit only keyed reads, never create/update/delete', () => {
  const api = JSON.parse(readFileSync(new URL(
    '../../vendor-upstream/ibizmodeling-standard/modelapi-core/src/main/resources/model/net/ibizsys/modeling/PSSYSSERVICEAPIS/ModelAPI.json',
    import.meta.url), 'utf8'));
  const methods = api.getPSDEServiceAPIs.flatMap(entity => entity.getPSDEServiceAPIMethods ?? []);
  const actualGets = methods.filter(method => method.name === 'Get' &&
    method.requestMethod === 'GET' && method.dataAccessAction === 'READ');
  assert.ok(actualGets.length > 0);
  assert.ok(actualGets.every(method => !Object.hasOwn(method, 'codeName')));
  const readCollections = nativeReadCollections(api);
  assert.equal(readCollections.size, actualGets.length);
  const policy = { rootIds: [root.rootId], readFetchPaths: new Set(), readCollections,
    readRecordKeys: new Set(['owned-key']) };
  for (const collection of ['psmodules', 'pssystems', 'pssysapps', 'psdataentities']) {
    assert.equal(readCollections.has(collection), true, collection);
    const detail = `/api/ibizmodeling__modeldesign/psdevslnsys/${root.rootId}/${collection}/owned-key`;
    assert.equal(readOnlyBrowserRequestAllowed({ method: 'GET', path: detail }, policy), true);
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      assert.equal(readOnlyBrowserRequestAllowed({ method, path: detail }, policy), false);
    }
    assert.equal(readOnlyBrowserRequestAllowed({
      method: 'GET', path: `${detail}/remove`,
    }, policy), false);
  }
});

test('keyed READ requires an exact owned key, never an arbitrary GET action or identifier', () => {
  const api = JSON.parse(readFileSync(new URL(
    '../../vendor-upstream/ibizmodeling-standard/modelapi-core/src/main/resources/model/net/ibizsys/modeling/PSSYSSERVICEAPIS/ModelAPI.json',
    import.meta.url), 'utf8'));
  const readCollections = nativeReadCollections(api);
  const policy = { rootIds: [root.rootId], readFetchPaths: new Set(), readCollections,
    readRecordKeys: new Set(['owned-key']) };
  const nonReadGets = api.getPSDEServiceAPIs.flatMap(entity =>
    (entity.getPSDEServiceAPIMethods ?? []).filter(method =>
      method.requestMethod === 'GET' && method.dataAccessAction !== 'READ' && !method.needResourceKey)
      .map(method => ({ collection: entity.codeName2.toLowerCase(), action: (method.codeName ?? method.name).toLowerCase() })));
  assert.ok(nonReadGets.some(row => row.collection === 'psmodules' && row.action === 'getdraft'));
  for (const { collection, action } of nonReadGets) {
    for (const prefix of ['', `psdevslnsys/${root.rootId}/`]) {
      assert.equal(readOnlyBrowserRequestAllowed({
        method: 'GET', path: `/api/ibizmodeling__modeldesign/${prefix}${collection}/${action}`,
      }, policy), false);
    }
  }
  for (const method of ['GET', 'HEAD']) {
    const path = `/api/ibizmodeling__modeldesign/psmodules/owned-key`;
    assert.equal(readOnlyBrowserRequestAllowed({ method, path }, policy), true);
    assert.equal(readOnlyBrowserRequestAllowed({ method, path }, { ...policy, readRecordKeys: undefined }), false);
    assert.equal(readOnlyBrowserRequestAllowed({ method, path: path.replace('owned-key', 'foreign-key') }, policy), false);
  }
});

test('importing the browser module never starts execution and an absent explicit opt-in rejects immediately', async () => {
  await assert.rejects(runOwnedFiveDatasetBrowser({}), /Explicit --run-readonly-browser/);
});
