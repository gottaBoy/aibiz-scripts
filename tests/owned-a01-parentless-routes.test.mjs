import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import { dirname, join, relative } from 'node:path';
import test from 'node:test';
import {
  A01_PARENTLESS_ADAPTER_PATH, bindOwnedA01ParentlessRoutes, ownedA01ParentlessRoutes,
  verifyOwnedA01ParentlessRouteBinding,
} from '../owned-a01-parentless-routes.mjs';
import { prepareR05OwnedModel, r05Files, r05ModelRoot } from '../prepare-r05-owned-model.mjs';
import { PinnedDirectories } from '../native-candidate-files.mjs';
import { stageOwnedModelInput } from '../launch-run-owned-native-backend.mjs';
import { createFixture } from '../prepare-run-owned-native-nonadmin-fixture.mjs';
import { createApplicationAccounts } from '../provision-run-owned-native-application-accounts.mjs';
import { runtimeConfiguration } from '../harness-run-owned-uaa-runtime.mjs';
import { createOwnedBackendConfiguration, parseOwnedNacosContent } from '../run-owned-backend-configuration.mjs';

const workspaceRoot = new URL('../../', import.meta.url).pathname;
const hash = value => createHash('sha256').update(value).digest('hex');
const runId = 'f01006abcdef';
const label = 'parentless-r1';
const origin = `http://nf-${runId}-backend-${label}-provider:32002`;
const encode = value => `${JSON.stringify(value, null, 2)}\n`;

function fixture(t, { r05 = false } = {}) {
  const workspace = fs.mkdtempSync(join(os.tmpdir(), 'aibiz-a01-parentless-'));
  const directories = new PinnedDirectories();
  t.after(() => { directories.close(); fs.rmSync(workspace, { recursive: true, force: true }); });
  const copy = (source, path) => {
    fs.mkdirSync(dirname(path), { recursive: true });
    fs.copyFileSync(source, path);
  };
  const sourceRoot = join(workspace, r05ModelRoot);
  for (const path of Object.values(r05Files)) {
    copy(join(workspaceRoot, r05ModelRoot, path), join(sourceRoot, path));
  }
  const currentSource = join(workspace, 'ibiz-service-hub', A01_PARENTLESS_ADAPTER_PATH);
  const worktree = join(workspace, '.artifacts/backend-source-package/worktree');
  const packagedSource = join(worktree, A01_PARENTLESS_ADAPTER_PATH);
  copy(join(workspaceRoot, 'ibiz-service-hub', A01_PARENTLESS_ADAPTER_PATH), currentSource);
  copy(currentSource, packagedSource);
  const adapter = fs.readFileSync(currentSource);
  const build = {
    contract: 'isolated-backend-source-package-v1', status: 'passed-package-and-unit-only',
    sourcePackageVerified: true, unitRegression: true, worktree,
    sourceInputs: { before: { fingerprint: '1'.repeat(64), entries: [{
      path: A01_PARENTLESS_ADAPTER_PATH, bytes: adapter.length, sha256: hash(adapter),
    }] } },
    packages: { archives: [{
      path: 'ibiz-service-runner/ibizservicerunner-provider.jar', bytes: 123, sha256: '2'.repeat(64),
      unknownOwnDependencies: [], embeddedLibraries: [{
        module: 'libs/ibiz-cloud-core', ownership: 'source-reactor', classification: 'reactor-source',
        path: 'BOOT-INF/lib/ibiz-cloud-core-8.1.0.584.1.jar',
        sha256: '3'.repeat(64), targetSha256: '3'.repeat(64),
      }],
    }] },
  };
  const packagePath = join(workspace, '.artifacts/backend-source-package/report.json');
  fs.writeFileSync(packagePath, encode(build));
  const images = {
    contract: 'isolated-backend-source-images-v1', status: 'passed-image-artifact-binding-only',
    imageArtifactBindingVerified: true,
    packageReceipt: { path: relative(workspace, packagePath),
      sha256: hash(fs.readFileSync(packagePath)), sourceFingerprint: '1'.repeat(64) },
    components: [{ name: 'provider', image: { id: `sha256:${'4'.repeat(64)}` },
      imageFiles: [{ path: '/ibizservicerunner-provider.jar', bytes: 123, sha256: '2'.repeat(64) }] }],
  };
  const outputPath = join(workspace,
    `.artifacts/native-nonadmin-fixtures/${runId}/backend-runtime-${label}/model-input`);
  const r05OwnedModelCandidate = r05 ? join(workspace, '.artifacts/r05-owned-model/candidate') : undefined;
  if (r05) prepareR05OwnedModel({ workspace, output: r05OwnedModelCandidate });
  const staged = stageOwnedModelInput({
    workspace, directories, source: sourceRoot, outputPath, r05OwnedModelCandidate,
  });
  return {
    workspace, runId, modelPath: staged.directory.path, images,
    r05OwnedModelBinding: staged.r05OwnedModelBinding,
    currentSource, packagedSource, packagePath, build,
    sourceApi: join(sourceRoot, r05Files.api), stagedApi: join(outputPath, r05Files.api),
  };
}

function configurationInput() {
  let sequence = 1;
  const secret = () => (sequence++).toString(16).padStart(36, '0');
  const { manifest, credentials } = createFixture({
    runId, scenario: 'two-center', passwordStorageMode: 'sm3', modelVersion: 816,
    uaaSchemaMode: 'legacy-views', secret,
  });
  const accounts = createApplicationAccounts(manifest, secret);
  const names = Object.fromEntries(['allinone', 'provider', 'gateway', 'nacos', 'zookeeper']
    .map(role => [role, `nf-${runId}-backend-${label}-${role}`]));
  names.uaa = `nf-${runId}-uaa-maintained-r7`;
  names.redis = `${names.uaa}-redis`;
  return {
    manifest, credentials, names,
    retainedUaaConfiguration: runtimeConfiguration(manifest, accounts.configuration, names.redis, 'a'.repeat(64)),
    accounts: { passwords: accounts.passwords, configuration: accounts.configuration,
      roleCredentialsPath: '../credentials.private.json' },
    modelingRouteProbe: {
      contract: 'owned-modeling-application-route-probe-v1', application: 'ModelDesign',
      disabledFactoryReturnedNull: true, enabledFactoryClass: 'net.ibizsys.central.app.ApplicationRuntime',
      canonicalRoute: {
        id: 'ibizmodeling__modeldesign__psdevslnsys', uri: 'lb://ibizmodeling-modelapi', order: 100,
        predicates: ['Path=/ibizmodeling__modeldesign/psdevslnsys/**'],
        filters: ['StripPrefix=1', 'PrefixPath=/ibizmodeling/modelapi'],
      },
      generatorOrigin: 'file:/dependencies/ibiz-cloud-core-8.1.0.584.1.jar',
      factoryOrigin: 'file:/dependencies/ibiz-cloud-core-8.1.0.584.1.jar',
    },
  };
}

test('fresh source/package/stage binding yields exactly two methods and no runtime acceptance', t => {
  const options = fixture(t);
  const observed = [];
  const binding = bindOwnedA01ParentlessRoutes({
    ...options, read: path => { observed.push(path); return fs.readFileSync(path); },
  });
  assert.equal(verifyOwnedA01ParentlessRouteBinding(binding), binding);
  assert.equal(binding.nativeAcceptance, false);
  assert.equal(binding.permissionAcceptance, false);
  assert.equal(binding.acceptedForProduction, false);
  assert.equal(binding.sourceAdapter.imageId, options.images.components[0].image.id);
  assert.ok(observed.includes(options.currentSource) && observed.includes(options.packagedSource));
  const routes = ownedA01ParentlessRoutes(binding, origin);
  assert.deepEqual(routes.map(row => row.predicates), [
    [{ name: 'Path', args: { _genkey_0: '/api/ibizmodeling__modeldesign/psmodules/fetchcursys' } },
      { name: 'Method', args: { _genkey_0: 'POST' } }],
    [{ name: 'Path', args: { _genkey_0: `/api/ibizmodeling__modeldesign/psmodules/nf_${runId}_module` } },
      { name: 'Method', args: { _genkey_0: 'PUT' } }],
  ]);
  for (const row of routes) {
    assert.equal(row.uri, origin);
    assert.deepEqual(row.filters, [
      { name: 'StripPrefix', args: { parts: '2' } },
      { name: 'PrefixPath', args: { prefix: '/ibizmodeling/modelapi' } },
    ]);
    assert.equal(JSON.stringify(row).includes('**'), false);
  }
});

test('configuration defaults unchanged and opt-in adds only those two routes', t => {
  const options = fixture(t);
  const source = configurationInput();
  const baseline = createOwnedBackendConfiguration(source);
  const binding = bindOwnedA01ParentlessRoutes(options);
  const selected = createOwnedBackendConfiguration({
    ...source, includeA01ParentlessAbsent: true, a01ParentlessBinding: binding,
  });
  assert.deepEqual(selected.services, baseline.services);
  const baseRouting = parseOwnedNacosContent(baseline.nacosConfigs[0].content);
  const selectedRouting = parseOwnedNacosContent(selected.nacosConfigs[0].content);
  assert.deepEqual(selectedRouting.routes.filter(row => !row.id.startsWith('owned-a01-parentless-')),
    baseRouting.routes);
  assert.deepEqual(selectedRouting.routes.filter(row => row.id.startsWith('owned-a01-parentless-')),
    ownedA01ParentlessRoutes(binding, origin));
  assert.deepEqual(selected.nacosConfigs.slice(1), baseline.nacosConfigs.slice(1));
});

test('JSON claims, cloned binding and mutated receipt cannot publish routes', t => {
  const options = fixture(t);
  const binding = bindOwnedA01ParentlessRoutes(options);
  for (const value of [undefined, {}, structuredClone(binding)]) {
    assert.throws(() => verifyOwnedA01ParentlessRouteBinding(value), /freshly bound/);
    assert.throws(() => ownedA01ParentlessRoutes(value, origin), /freshly bound/);
  }
  binding.routeContract = 'psmodules/**';
  assert.throws(() => verifyOwnedA01ParentlessRouteBinding(binding), /metadata changed/);
});

test('same-run but different provider, foreign run and nonowned stage fail closed', t => {
  const options = fixture(t);
  const binding = bindOwnedA01ParentlessRoutes(options);
  for (const invalid of [
    origin.replace(label, 'other'), origin.replace(runId, '123456789abc'),
    `${origin}/path`, origin.replace(':32002', ':30086'), 'http://127.0.0.1:32002',
  ]) assert.throws(() => ownedA01ParentlessRoutes(binding, invalid), /exact owned stage/);
  for (const invalid of [
    { ...options, runId: '123456789abc' },
    { ...options, modelPath: join(options.workspace, 'shared-model') },
    { ...options, modelPath: '/outside/model' },
  ]) assert.throws(() => bindOwnedA01ParentlessRoutes(invalid));
});

test('current source, packaged source, receipt and staged API drift invalidate fresh bindings', t => {
  const options = fixture(t);
  for (const path of [options.currentSource, options.packagedSource, options.packagePath,
    options.sourceApi, options.stagedApi]) {
    const binding = bindOwnedA01ParentlessRoutes(options);
    const original = fs.readFileSync(path);
    fs.appendFileSync(path, '\n');
    assert.throws(() => verifyOwnedA01ParentlessRouteBinding(binding), undefined, path);
    fs.writeFileSync(path, original);
  }
});

test('provider image/package/library linkage and duplicate adapter entries are mandatory', t => {
  const options = fixture(t);
  for (const change of [
    value => { value.status = 'passed'; },
    value => { value.components[0].name = 'allinone'; },
    value => { value.components[0].imageFiles[0].sha256 = '0'.repeat(64); },
    value => { value.packageReceipt.sourceFingerprint = '0'.repeat(64); },
  ]) {
    const images = structuredClone(options.images);
    change(images);
    assert.throws(() => bindOwnedA01ParentlessRoutes({ ...options, images }));
  }
  for (const change of [
    value => { value.packages.archives[0].unknownOwnDependencies = ['unknown']; },
    value => { value.packages.archives[0].embeddedLibraries[0].ownership = 'external'; },
    value => { value.packages.archives[0].embeddedLibraries[0].targetSha256 = '0'.repeat(64); },
    value => { value.sourceInputs.before.entries.push(value.sourceInputs.before.entries[0]); },
  ]) {
    const build = structuredClone(options.build);
    change(build);
    fs.writeFileSync(options.packagePath, encode(build));
    const images = structuredClone(options.images);
    images.packageReceipt.sha256 = hash(fs.readFileSync(options.packagePath));
    assert.throws(() => bindOwnedA01ParentlessRoutes({ ...options, images }));
  }
});

test('PSModule method/path/relationship changes reject even when both model files match', t => {
  const options = fixture(t);
  const original = JSON.parse(fs.readFileSync(options.sourceApi));
  for (const change of [
    api => { api.getPSDEServiceAPIs.find(row => row.codeName === 'PSModule').aPIMode = 2; },
    api => {
      const methods = api.getPSDEServiceAPIs.find(row => row.codeName === 'PSModule').getPSDEServiceAPIMethods;
      methods.push(methods.find(row => row.name === 'Update'));
    },
    api => {
      api.getPSDEServiceAPIs.find(row => row.codeName === 'PSModule')
        .getPSDEServiceAPIMethods.find(row => row.name === 'Update').requestPath = '/**';
    },
    api => {
      api.getPSDEServiceAPIs.find(row => row.codeName === 'PSModule')
        .getPSDEServiceAPIMethods.find(row => row.name === 'FetchCurSys').requestMethod = 'GET';
    },
    api => {
      api.getPSDEServiceAPIRSs = api.getPSDEServiceAPIRSs.filter(row =>
        !(row.getMajorPSDEServiceAPI?.id === 'PSDevSlnSys' && row.getMinorPSDEServiceAPI?.id === 'PSModule'));
    },
  ]) {
    const api = structuredClone(original);
    change(api);
    fs.writeFileSync(options.sourceApi, encode(api));
    fs.writeFileSync(options.stagedApi, encode(api));
    assert.throws(() => bindOwnedA01ParentlessRoutes(options));
  }
});

test('verified canonical R05 stage coexists without changing any PSModule field', t => {
  const options = fixture(t, { r05: true });
  const binding = bindOwnedA01ParentlessRoutes(options);
  assert.notEqual(binding.modelApi.sourceSha256, binding.modelApi.stagedSha256);
  assert.equal(binding.modelApi.r05.candidate, '.artifacts/r05-owned-model/candidate');
  assert.equal(ownedA01ParentlessRoutes(binding, origin).length, 2);
  assert.throws(() => bindOwnedA01ParentlessRoutes({ ...options, r05OwnedModelBinding: undefined }),
    /unbound staged ModelAPI/);
  assert.throws(() => bindOwnedA01ParentlessRoutes({
    ...options, r05OwnedModelBinding: structuredClone(options.r05OwnedModelBinding),
  }), /freshly bound/);
  options.r05OwnedModelBinding.candidate.nativeAcceptance = true;
  assert.throws(() => verifyOwnedA01ParentlessRouteBinding(binding), /metadata changed/);
});

test('complete R05 stage drift outside ModelAPI is rechecked before route publication', t => {
  const options = fixture(t, { r05: true });
  const binding = bindOwnedA01ParentlessRoutes(options);
  fs.appendFileSync(join(options.modelPath, r05Files.action), '\n');
  assert.throws(() => ownedA01ParentlessRoutes(binding, origin), /complete staged model drift/);
});
