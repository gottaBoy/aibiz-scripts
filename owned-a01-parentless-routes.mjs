import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';
import { PinnedDirectories, readPinnedFile } from './native-candidate-files.mjs';
import { r05ModelRoot, r05Files } from './prepare-r05-owned-model.mjs';
import { verifyStagedR05OwnedModelBinding } from './r05-owned-model-overlay.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const digest = value => hash(JSON.stringify(value));
const bindings = new WeakMap();
export const A01_PARENTLESS_ADAPTER_PATH =
  'libs/ibiz-cloud-core/src/main/java/net/ibizsys/central/cloud/core/service/StandardSysServiceAPIRequestMappingAdapter.java';
const reviewedAdapterSha256 = '1aa7173514d999081cade192228fe3388bfb4d7ba285d3b4ff70669310e9dba0';
const modelApiPath = `${r05ModelRoot}/${r05Files.api}`;

function childOf(workspace, value) {
  assert.equal(typeof value, 'string', 'A01 input path is required');
  assert.ok(value && !/[,\r\n\0\\]/.test(value), 'Unsafe A01 input path');
  const absolute = resolve(workspace, value);
  const child = relative(workspace, absolute);
  assert.ok(child && child !== '..' && !child.startsWith(`..${sep}`) && !child.startsWith(sep),
    'A01 input escapes workspace');
  return absolute;
}

function readInput(options, value) {
  const path = childOf(options.workspace, value);
  const directories = new PinnedDirectories();
  try {
    const bytes = readPinnedFile(directories, directories.open(dirname(path)), basename(path)).data;
    // The launcher's observer records provenance but cannot substitute file contents.
    if (options.read !== undefined) assert.deepEqual(options.read(path), bytes,
      'A01 input observer returned different bytes');
    return bytes;
  } finally { directories.close(); }
}

function one(rows, predicate, label) {
  assert.ok(Array.isArray(rows), `${label} inventory is missing`);
  const matches = rows.filter(predicate);
  assert.equal(matches.length, 1, `${label} must have exactly one match`);
  return matches[0];
}

function publishedMethods(api) {
  assert.equal(api.codeName, 'ModelAPI');
  assert.equal(api.serviceCodeName, 'ModelAPI');
  const service = one(api.getPSDEServiceAPIs, row => row.codeName === 'PSModule', 'PSModule API');
  assert.equal(service.aPIMode, 1, 'PSModule must remain MAJOR');
  assert.equal(service.name, 'PSMODULE');
  assert.deepEqual(service.getPSDataEntity, {
    modelref: true, path: 'PSMODULES/SysDesign/PSDATAENTITIES/PSModule.json',
  });
  const fetch = one(service.getPSDEServiceAPIMethods, row => row.name === 'FetchCurSys', 'FetchCurSys');
  const update = one(service.getPSDEServiceAPIMethods, row => row.name === 'Update', 'Update');
  assert.equal(Object.hasOwn(fetch, 'requestPath'), false, 'FetchCurSys path override is not reviewed');
  assert.equal(Object.hasOwn(update, 'requestPath'), false, 'Update path override is not reviewed');
  assert.deepEqual([fetch.requestMethod, fetch.methodType, fetch.dataAccessAction,
    fetch.needResourceKey === true, fetch.codeName],
  ['POST', 'FETCH', 'READ', false, 'FetchCurSys']);
  assert.deepEqual([update.requestMethod, update.methodType, update.dataAccessAction,
    update.needResourceKey === true, update.noServiceCodeName === true,
    update.getPSDEAction],
  ['PUT', 'DEACTION', 'UPDATE', true, true, {
    modelref: true, path: 'PSMODULES/SysDesign/PSDATAENTITIES/PSModule/PSDEACTIONS/Update.json',
  }]);
  const relationship = one(api.getPSDEServiceAPIRSs, row =>
    row.getMajorPSDEServiceAPI?.id === 'PSDevSlnSys' &&
    row.getMinorPSDEServiceAPI?.id === 'PSModule', 'PSDevSlnSys/PSModule relationship');
  return { service, relationship };
}

function bindAdapter(options) {
  const { images } = options;
  assert.equal(images.contract, 'isolated-backend-source-images-v1');
  assert.equal(images.status, 'passed-image-artifact-binding-only');
  assert.equal(images.imageArtifactBindingVerified, true);
  const packageBytes = readInput(options, images.packageReceipt.path);
  assert.equal(hash(packageBytes), images.packageReceipt.sha256, 'A01 package receipt drift');
  const build = JSON.parse(packageBytes);
  assert.equal(build.contract, 'isolated-backend-source-package-v1');
  assert.equal(build.status, 'passed-package-and-unit-only');
  assert.equal(build.sourcePackageVerified, true);
  assert.equal(build.unitRegression, true);
  assert.equal(images.packageReceipt.sourceFingerprint, build.sourceInputs.before.fingerprint);
  const component = one(images.components, row => row.name === 'provider', 'Provider image');
  assert.match(component.image.id, /^sha256:[a-f0-9]{64}$/);
  const jar = one(component.imageFiles, row => row.path === '/ibizservicerunner-provider.jar',
    'Provider image JAR');
  const archive = one(build.packages.archives, row =>
    row.path === 'ibiz-service-runner/ibizservicerunner-provider.jar', 'Provider package JAR');
  assert.match(jar.sha256, /^[a-f0-9]{64}$/);
  assert.ok(Number.isSafeInteger(jar.bytes) && jar.bytes > 0);
  assert.deepEqual([jar.sha256, jar.bytes], [archive.sha256, archive.bytes]);
  assert.deepEqual(archive.unknownOwnDependencies, []);
  const dependency = one(archive.embeddedLibraries,
    row => row.module === 'libs/ibiz-cloud-core', 'Cloud core source library');
  assert.equal(dependency.ownership, 'source-reactor');
  assert.equal(dependency.classification, 'reactor-source');
  assert.equal(dependency.sha256, dependency.targetSha256);
  assert.match(dependency.sha256, /^[a-f0-9]{64}$/);
  assert.match(dependency.path, /^BOOT-INF\/lib\/ibiz-cloud-core-[A-Za-z0-9_.-]+\.jar$/);
  const entry = one(build.sourceInputs.before.entries, row =>
    row.path === A01_PARENTLESS_ADAPTER_PATH, 'Standard adapter source');
  const current = readInput(options, join('ibiz-service-hub', A01_PARENTLESS_ADAPTER_PATH));
  const packaged = readInput(options, join(build.worktree, A01_PARENTLESS_ADAPTER_PATH));
  assert.deepEqual([hash(current), current.length], [entry.sha256, entry.bytes],
    'A01 current adapter differs from packaged source input');
  assert.deepEqual(packaged, current, 'A01 packaged adapter differs from current source');
  assert.equal(hash(current), reviewedAdapterSha256, 'A01 reviewed adapter source changed');
  const source = current.toString('utf8');
  const parentless = source.slice(source.indexOf('if(iDEServiceAPIRuntime.getAPIMode() == DEServiceAPIModes.MINOR)'));
  for (const fragment of [
    'return;', 'String strPath = String.format("/%1$s/%2$s/%3$s"',
    'String strRequestPath = strPath + "/" + iPSDEServiceAPIMethod.getCodeName().toLowerCase();',
    'String strRequestPath = strPath + getRequestPath(iPSDEServiceAPIMethod);',
    'RequestMethods.POST.equals(iPSDEServiceAPIMethod.getRequestMethod()) || RequestMethods.PUT.equals',
    'if (iPSDEServiceAPIMethod.isNeedResourceKey())',
    'if(iPSDEServiceAPIMethod.isNoServiceCodeName())',
    'invokeDEMethod(null, null, null, iDEServiceAPIRuntime.getPSDEServiceAPI().getName(), iPSDEServiceAPIMethod.getCodeName(), requestData, key, null)',
    'invokeDEMethod(null, null, null, iDEServiceAPIRuntime.getPSDEServiceAPI().getName(), iPSDEServiceAPIMethod.getPSDEActionMust().getCodeName(), requestData, key, null)',
    'MethodHandlerBase.getFetchMethod()', 'MethodHandlerBase.getPostMethod()',
  ]) assert.ok(parentless.includes(fragment), 'A01 native parentless adapter contract changed');
  return {
    path: A01_PARENTLESS_ADAPTER_PATH, bytes: current.length, sha256: hash(current),
    packageReceipt: { path: relative(options.workspace, childOf(options.workspace, images.packageReceipt.path)),
      sha256: hash(packageBytes) },
    imageId: component.image.id,
    providerJar: { path: jar.path, bytes: jar.bytes, sha256: jar.sha256 },
    embeddedLibrary: { path: dependency.path, sha256: dependency.sha256 },
  };
}

function derive(options) {
  const source = readInput(options, modelApiPath);
  const stagedPath = join(options.modelPath, r05Files.api);
  const staged = readInput(options, stagedPath);
  const sourceContract = publishedMethods(JSON.parse(source));
  const stageContract = publishedMethods(JSON.parse(staged));
  assert.deepEqual(stageContract, sourceContract, 'A01 complete PSModule contract changed');
  let r05;
  if (options.r05OwnedModelBinding !== undefined) {
    const binding = verifyStagedR05OwnedModelBinding(options.r05OwnedModelBinding);
    assert.equal(binding.staged.path, relative(options.workspace, options.modelPath),
      'A01 R05 binding references another model stage');
    const input = one(binding.candidate.inputs.entries, row => row.path === r05Files.api,
      'R05 ModelAPI source');
    const output = one(binding.candidate.outputs.entries, row => row.path === `model/${r05Files.api}`,
      'R05 ModelAPI output');
    assert.deepEqual([source.length, hash(source)], [input.bytes, input.sha256]);
    assert.deepEqual([staged.length, hash(staged)], [output.bytes, output.sha256]);
    r05 = { candidate: binding.candidate.path, fingerprint: binding.staged.fingerprint };
  } else assert.equal(staged.equals(source), true, 'A01 unbound staged ModelAPI differs from source');
  return {
    contract: 'owned-a01-parentless-route-binding-v1', runId: options.runId,
    providerOrigin: options.providerOrigin,
    sourceAdapter: bindAdapter(options),
    modelApi: { path: modelApiPath, sourceSha256: hash(source), stagedSha256: hash(staged),
      stagePath: relative(options.workspace, stagedPath), ...(r05 ? { r05 } : {}) },
    moduleContractUnchanged: true, routeContract: 'POST fetchcursys + PUT run-owned module only',
    nativeAcceptance: false, permissionAcceptance: false, acceptedForProduction: false,
  };
}

export function bindOwnedA01ParentlessRoutes({
  workspace, runId, modelPath, images, read, r05OwnedModelBinding,
}) {
  workspace = resolve(workspace);
  assert.match(runId ?? '', /^[a-f0-9]{12}$/);
  modelPath = childOf(workspace, modelPath);
  const stage = relative(workspace, modelPath).match(new RegExp(
    `^\\.artifacts/native-nonadmin-fixtures/${runId}/backend-runtime-([a-z0-9][a-z0-9-]{0,48})/model-input$`));
  assert.ok(stage, 'A01 model stage must belong to this owned backend run');
  assert.ok(read === undefined || typeof read === 'function');
  const options = { workspace, runId, modelPath, images: structuredClone(images), read, r05OwnedModelBinding,
    providerOrigin: `http://nf-${runId}-backend-${stage[1]}-provider:32002` };
  const binding = derive(options);
  bindings.set(binding, { options, digest: digest(binding) });
  return binding;
}

export function verifyOwnedA01ParentlessRouteBinding(binding) {
  const proof = binding && bindings.get(binding);
  assert.ok(proof, 'A freshly bound in-process A01 route proof is required');
  assert.equal(digest(binding), proof.digest, 'A01 route binding metadata changed');
  assert.deepEqual(derive(proof.options), binding, 'A01 route binding inputs changed');
  return binding;
}

function route(id, providerOrigin, path, method, order) {
  return {
    id, uri: providerOrigin, order,
    predicates: [
      { name: 'Path', args: { _genkey_0: path } },
      { name: 'Method', args: { _genkey_0: method } },
    ],
    filters: [
      { name: 'StripPrefix', args: { parts: '2' } },
      { name: 'PrefixPath', args: { prefix: '/ibizmodeling/modelapi' } },
    ],
  };
}

export function ownedA01ParentlessRoutes(binding, providerOrigin) {
  const { runId } = verifyOwnedA01ParentlessRouteBinding(binding);
  assert.equal(providerOrigin, binding.providerOrigin, 'A01 provider must match this exact owned stage');
  return [
    route('owned-a01-parentless-fetchcursys', providerOrigin,
      '/api/ibizmodeling__modeldesign/psmodules/fetchcursys', 'POST', 98),
    route('owned-a01-parentless-update', providerOrigin,
      `/api/ibizmodeling__modeldesign/psmodules/nf_${runId}_module`, 'PUT', 99),
  ];
}
