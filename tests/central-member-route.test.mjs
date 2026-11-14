import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { PinnedDirectories, readTree } from '../native-candidate-files.mjs';
import { prepareNativeServiceCandidate } from '../prepare-native-service-candidate.mjs';
import * as routing from '../owned-modeling-application-routes.mjs';
import { stageOwnedModelInput } from '../launch-run-owned-native-backend.mjs';
import { createFixture } from '../prepare-run-owned-native-nonadmin-fixture.mjs';
import { createApplicationAccounts } from '../provision-run-owned-native-application-accounts.mjs';
import { runtimeConfiguration } from '../harness-run-owned-uaa-runtime.mjs';
import { createOwnedBackendConfiguration, parseOwnedNacosContent } from '../run-owned-backend-configuration.mjs';

const workspace = new URL('../../', import.meta.url).pathname;
const provider = 'http://nf-123456789abc-backend-central-r1-provider:32002';
const centralCanonicalRoute = () => ({
  id: 'ibizmodeling__central__psdevsln',
  uri: 'lb://ibizmodeling-modelapi', order: 100,
  predicates: ['Path=/ibizmodeling__central/psdevslns/**'],
  filters: ['StripPrefix=1', 'PrefixPath=/ibizmodeling/modelapi'],
});
const probe = () => ({
  contract: 'owned-modeling-application-route-probe-v1', application: 'ModelDesign',
  disabledFactoryReturnedNull: true, enabledFactoryClass: 'net.ibizsys.central.app.ApplicationRuntime',
  canonicalRoute: { id: 'ibizmodeling__modeldesign__psdevslnsys',
    uri: 'lb://ibizmodeling-modelapi', order: 100,
    predicates: ['Path=/ibizmodeling__modeldesign/psdevslnsys/**'],
    filters: ['StripPrefix=1', 'PrefixPath=/ibizmodeling/modelapi'] },
  generatorOrigin: 'file:/dependencies/ibiz-cloud-core-8.1.0.584.1.jar',
  factoryOrigin: 'file:/dependencies/ibiz-cloud-core-8.1.0.584.1.jar',
  centralCanonicalRoute: centralCanonicalRoute(),
});

function fixture(t, memberBinding = true) {
  const root = fs.mkdtempSync(join(os.tmpdir(), 'central-route-'));
  const directories = new PinnedDirectories();
  t.after(() => { directories.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const contractPath = 'scripts/fixtures/native-service-migration-contract.json';
  const contract = JSON.parse(fs.readFileSync(join(workspace, contractPath)));
  fs.mkdirSync(dirname(join(root, contractPath)), { recursive: true });
  fs.copyFileSync(join(workspace, contractPath), join(root, contractPath));
  const source = join(root, contract.sourceModelRoot);
  for (const file of Object.values({ ...contract.files, ...contract.memberBinding.files })) {
    const target = join(source, file.path);
    fs.mkdirSync(dirname(target), { recursive: true });
    fs.copyFileSync(join(workspace, contract.sourceModelRoot, file.path), target);
  }
  const output = join(root, '.artifacts/native-service-migration/owned');
  prepareNativeServiceCandidate({ workspace: root, output, memberBinding });
  return { root, source, directories, outputPath: join(root, '.artifacts/staged'),
    centralMemberReceiptPath: join(output, 'receipt.json'), workspace: root };
}

test('no route is available without a staged full member-binding candidate', () => {
  assert.equal(typeof routing.ownedCentralMemberRoute, 'function');
  assert.throws(() => routing.ownedCentralMemberRoute(probe(), provider));
});

test('a view-only candidate is rejected before any backend model is staged', t => {
  const options = fixture(t, false);
  assert.throws(() => stageOwnedModelInput(options));
  assert.equal(fs.existsSync(options.outputPath), false);
});

test('verified five-file member candidate is overlaid on actual staged model without source mutation', t => {
  const options = fixture(t);
  const before = readTree(options.source, { jsonOnly: false });
  const staged = stageOwnedModelInput(options);
  assert.equal(staged.centralMemberBinding.contract, 'staged-native-central-member-binding-v1');
  assert.equal(staged.centralMemberBinding.outputs.length, 5);
  assert.equal(staged.centralMemberBinding.modelFingerprint, staged.fingerprint);
  assert.deepEqual(readTree(options.source, { jsonOnly: false }).entries, before.entries);
  const sql = JSON.parse(fs.readFileSync(join(options.outputPath,
    'PSMODULES/SysDesign/PSDATAENTITIES/PSDevSln/PSDEDATAQUERIES/CurDCSLNUser/PSDEDQCODES/MYSQL5.json')));
  assert.match(sql.getPSDEDataQueryCodeConds[0].customCond,
    /PSDEVUSEROBJID.*ctx\.sessioncontext\.srfpersonid/);
  const route = routing.ownedCentralMemberRoute(probe(), provider, staged.centralMemberBinding);
  assert.deepEqual(route.predicates, [
    { name: 'Path', args: { _genkey_0: '/api/ibizmodeling__central/psdevslns/fetchcurdcslnuser' } },
    { name: 'Method', args: { _genkey_0: 'POST' } },
  ]);
  assert.deepEqual(route.filters, [
    { name: 'StripPrefix', args: { parts: '2' } },
    { name: 'PrefixPath', args: { prefix: '/ibizmodeling/modelapi' } },
  ]);
  assert.equal(route.uri, provider);
  assert.equal(JSON.stringify(route).includes('AddRequestHeader'), false);
  assert.equal(JSON.stringify(route.predicates).includes('**'), false);
  for (const mutate of [
    value => { delete value.centralCanonicalRoute; },
    value => { value.centralCanonicalRoute.uri = 'http://shared'; },
    value => { value.centralCanonicalRoute.predicates = ['Path=/**']; },
  ]) {
    const changed = structuredClone(probe());
    mutate(changed);
    assert.throws(() => routing.ownedCentralMemberRoute(changed, provider, staged.centralMemberBinding));
  }
});

test('a changed candidate or mismatched model input fails before staging or route publication', t => {
  const options = fixture(t);
  fs.appendFileSync(join(options.source, 'PSSYSSERVICEAPIS/ModelAPI.json'), '\n');
  assert.throws(() => stageOwnedModelInput(options));
  assert.equal(fs.existsSync(options.outputPath), false);
});

test('a tampered backend candidate cannot be published using its old receipt', t => {
  const options = fixture(t);
  const sql = join(dirname(options.centralMemberReceiptPath),
    'model/PSMODULES/SysDesign/PSDATAENTITIES/PSDevSln/PSDEDATAQUERIES/CurDCSLNUser/PSDEDQCODES/MYSQL5.json');
  const value = JSON.parse(fs.readFileSync(sql));
  value.getPSDEDataQueryCodeConds[0].customCond = '1=1';
  fs.writeFileSync(sql, JSON.stringify(value));
  assert.throws(() => stageOwnedModelInput(options));
  assert.equal(fs.existsSync(options.outputPath), false);
});

test('all-valid-hash JSON metadata and a traversal receipt cannot forge a stage proof', t => {
  const options = fixture(t);
  const staged = stageOwnedModelInput(options);
  const forged = JSON.parse(JSON.stringify(staged.centralMemberBinding));
  assert.throws(() => routing.ownedCentralMemberRoute(probe(), provider, forged));
  assert.throws(() => routing.verifyStagedCentralMemberModel({
    workspace: options.root, modelPath: options.outputPath,
    receiptPath: join(options.root, '.artifacts/native-service-migration/owned/../../../receipt.json'),
  }));
  fs.appendFileSync(join(options.outputPath, 'PSSYSSERVICEAPIS/ModelAPI.json'), '\n');
  assert.throws(() => routing.ownedCentralMemberRoute(probe(), provider, staged.centralMemberBinding));
});

test('owned configuration publishes only the opt-in exact read route and no authentication bypass', t => {
  const options = fixture(t);
  const staged = stageOwnedModelInput(options);
  let sequence = 1;
  const secret = () => (sequence++).toString(16).padStart(36, '0');
  const { manifest, credentials } = createFixture({
    runId: '123456789abc', scenario: 'two-center', passwordStorageMode: 'sm3',
    modelVersion: 816, uaaSchemaMode: 'legacy-views', secret,
  });
  const accounts = createApplicationAccounts(manifest, secret);
  const names = Object.fromEntries(['allinone', 'provider', 'gateway', 'nacos', 'zookeeper']
    .map(role => [role, `nf-${manifest.runId}-backend-central-r1-${role}`]));
  names.uaa = `nf-${manifest.runId}-uaa-current`;
  names.redis = `${names.uaa}-redis`;
  const input = { manifest, credentials, names, modelingRouteProbe: probe(),
    retainedUaaConfiguration: runtimeConfiguration(manifest, accounts.configuration, names.redis, 'a'.repeat(64)),
    accounts: { passwords: accounts.passwords, configuration: accounts.configuration,
      roleCredentialsPath: '../credentials.private.json' } };
  const routes = configuration => parseOwnedNacosContent(configuration.nacosConfigs
    .find(row => row.dataId === 'appgateway-default').content).routes;
  const original = routes(createOwnedBackendConfiguration(input));
  assert.equal(original.some(route => route.id.includes('__central__')), false);
  const selected = routes(createOwnedBackendConfiguration({
    ...input, centralMemberBinding: staged.centralMemberBinding,
  }));
  assert.equal(selected.length, original.length + 1);
  const central = selected.filter(route => route.id.includes('__central__'));
  assert.equal(central.length, 1);
  assert.deepEqual(central[0], routing.ownedCentralMemberRoute(probe(), provider, staged.centralMemberBinding));
  for (const binding of [null, {}, { ...staged.centralMemberBinding, outputs: [] },
    { ...staged.centralMemberBinding, contract: 'view-only' }]) {
    assert.throws(() => createOwnedBackendConfiguration({ ...input, centralMemberBinding: binding }));
  }
  const access = fs.readFileSync(join(workspace,
    'ibiz-service-hub/libs/ibiz-modeling-core/src/main/java/net/ibizsys/modeling/core/dataentity/security/PSDevSlnDEAccessManager.java'), 'utf8');
  assert.match(access, /if \("CREATE"\.equals\(accessAction\)\) \{\s*return false;/);
});
