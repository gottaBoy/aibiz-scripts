import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { join } from 'node:path';
import {
  describeNativeSystemAccess,
  NATIVE_SYSTEM_READ_CONTRACT,
} from '../native-system-read-contract.mjs';
import { workspace } from '../localization-baseline.mjs';

const modelRoot = 'vendor-upstream/ibizmodeling-standard/modelapi-core/src/main/resources/model/net/ibizsys/modeling';
const model = path => JSON.parse(fs.readFileSync(join(workspace, modelRoot, path), 'utf8'));

function systemApi() {
  return model('PSSYSSERVICEAPIS/ModelAPI.json');
}

test('R01/R02 keeps the published logical-system lookup observable but fail-closed', () => {
  const api = systemApi();
  const relation = api.getPSDEServiceAPIRSs.find(item =>
    item.getMajorPSDEServiceAPI?.id === 'PSDevSlnSys' &&
    item.getMinorPSDEServiceAPI?.id === 'PSSystem');
  assert.ok(relation, 'The source must declare the root-to-system relationship');
  const fetch = relation.getPSDEServiceAPIMethods.find(item =>
    (item.codeName ?? item.name) === 'FetchDefault');
  assert.deepEqual({
    method: fetch.requestMethod, access: fetch.dataAccessAction,
    parentKeyMode: fetch.parentKeyMode, input: fetch.getPSDEServiceAPIMethodInput.type,
  }, { method: 'POST', access: 'READ', parentKeyMode: 'DEFAULT', input: 'DTO' });

  assert.equal(NATIVE_SYSTEM_READ_CONTRACT.existingGenericReads.fetchDefault.narrow, false);
  for (const role of ['root-reader', 'root-editor']) {
    for (const profile of ['summary', 'settingsInfo', 'settingsEditor']) {
      const result = describeNativeSystemAccess(profile, role);
      assert.equal(result.allowed, false, `${role}/${profile} cannot become an implicit grant`);
    }
  }
});

test('R01/R02 rejects a logical-system URL/context as a substitute for root authorization', () => {
  const api = systemApi();
  const system = api.getPSDEServiceAPIs.find(item => item.codeName === 'PSSystem');
  const get = system.getPSDEServiceAPIMethods.find(item =>
    item.name === 'Get' && item.requestMethod === 'GET');
  assert.equal(get.dataAccessAction, 'READ');
  assert.equal(get.needResourceKey, true);

  const routing = NATIVE_SYSTEM_READ_CONTRACT.routingContext.sourceFields;
  assert.deepEqual(routing, ['psdevslnsys', 'pssystemid']);
  assert.equal(describeNativeSystemAccess('routingContext', 'root-reader').allowed, false);
  assert.equal(describeNativeSystemAccess('routingContext', 'root-editor').allowed, false);
});
